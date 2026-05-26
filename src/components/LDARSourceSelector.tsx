import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, AlertCircle, CheckCircle2, FileText, ArrowLeft, Sparkles } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { pdfjsDocumentDefaults } from '../utils/pdfjsDocumentDefaults';
import { supabase, type Facility } from '../lib/supabase';
import {
  detectSitePlanInLoadedPdf,
  type SitePlanDetectionResult,
} from '../utils/spccSitePlanDetector';
import { extractPageAsPdf } from '../utils/extractPdfPage';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * LDAR Source Selector dialog.
 *
 * Shown when the user clicks "Generate Walking Path" on a facility that has
 * NO uploaded LDAR site plan PDF but DOES have an SPCC plan PDF — the SPCC
 * plan virtually always contains a "Figure 1 - Facility Site Plan" page,
 * and there's no reason to make the user upload the same image twice.
 *
 * Flow:
 *   1. Load the SPCC PDF → run text-based detection (see
 *      utils/spccSitePlanDetector.ts).
 *   2. Show the detected page as a large preview thumbnail with a
 *      one-line explanation of why we picked it.
 *   3. User clicks "Use this page" → extract that page as a new
 *      single-page PDF → upload to ldar-site-plans bucket → patch the
 *      facility row → callback.
 *   4. If detection picked wrong (or didn't find anything), the user
 *      can click "Choose a different page" to flip to a scrollable
 *      thumbnail grid of every page and pick manually.
 *
 * After this dialog closes, the parent reopens with the editor — the
 * facility now has an ldar_site_plan_url and the editor's existing PDF
 * loading code Just Works.
 */

interface PageThumb {
  page: number;
  dataUrl: string;
  width: number;
  height: number;
}

interface LDARSourceSelectorProps {
  facility: Facility;
  darkMode: boolean;
  onClose: () => void;
  /** Called after the page has been extracted + uploaded + the facility
   *  row patched. Parent should then open the editor. */
  onConfirmed: () => void;
}

export default function LDARSourceSelector({
  facility,
  darkMode,
  onClose,
  onConfirmed,
}: LDARSourceSelectorProps) {
  // pdf-bytes + loaded-pdf live in a ref because pdf objects aren't reactive
  // and re-loading on every render would be wasteful.
  const pdfBytesRef = useRef<ArrayBuffer | null>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detection, setDetection] = useState<SitePlanDetectionResult | null>(null);
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [previewThumb, setPreviewThumb] = useState<PageThumb | null>(null);

  // Grid state — only fetched when user opens the "all pages" view.
  const [showGrid, setShowGrid] = useState(false);
  const [gridThumbs, setGridThumbs] = useState<PageThumb[]>([]);
  const [gridLoading, setGridLoading] = useState(false);

  // Save state.
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // -----------------------------------------------------------
  // Render a single page to a PNG data URL at the given scale.
  // Mirrors the defenses in src/utils/renderPdfPageToImage.ts —
  // pre-fill with white + background:white + intent:'print' + try/
  // catch — so PDFs with picky raster XObjects (aerial photos in
  // some Camino site plans, etc.) don't silently return a canvas
  // with only the vector overlays and an empty / transparent
  // background image.
  // -----------------------------------------------------------
  const renderPageThumb = useCallback(
    async (page: number, scale: number): Promise<PageThumb> => {
      const pdf = pdfRef.current!;
      const pdfPage = await pdf.getPage(page);
      const viewport = pdfPage.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d')!;
      // Defensive white pre-fill — a transparent paint composites onto
      // white instead of disappearing.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      try {
        await pdfPage.render({
          canvasContext: ctx,
          viewport,
          background: '#ffffff',
          intent: 'print',
        } as Parameters<typeof pdfPage.render>[0]).promise;
      } catch (err: any) {
        console.error(`[LDARSourceSelector] page ${page} render failed:`, err);
        throw new Error(`PDF render failed on page ${page}: ${err?.message || String(err)}`);
      }
      return {
        page,
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
      };
    },
    [],
  );

  // -----------------------------------------------------------
  // Load SPCC PDF + run detection on mount.
  // -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        if (!facility.spcc_plan_url) {
          throw new Error('No SPCC plan uploaded on this facility.');
        }
        const resp = await fetch(facility.spcc_plan_url);
        if (!resp.ok) throw new Error(`Could not fetch SPCC plan (${resp.status})`);
        const buf = await resp.arrayBuffer();
        if (cancelled) return;
        pdfBytesRef.current = buf;

        // Load via pdfjs for text detection + thumbnail rendering. pdf-lib
        // is used later, at extract time, on the same bytes.
        const pdf = await pdfjsLib.getDocument({ ...pdfjsDocumentDefaults, data: buf.slice(0) }).promise;
        if (cancelled) return;
        pdfRef.current = pdf;

        const result = await detectSitePlanInLoadedPdf(pdf);
        if (cancelled) return;
        setDetection(result);

        // Pre-select the detected page (or page 1 if nothing detected) and
        // render its preview thumbnail.
        const initialPage = result.detectedPage ?? 1;
        setSelectedPage(initialPage);
        const thumb = await renderPageThumb(initialPage, 1.2);
        if (cancelled) return;
        setPreviewThumb(thumb);
      } catch (err) {
        if (cancelled) return;
        console.error('LDAR source selector load failed', err);
        setLoadError(err instanceof Error ? err.message : 'Failed to load SPCC plan.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [facility.spcc_plan_url, renderPageThumb]);

  // -----------------------------------------------------------
  // Render thumbnail grid lazily when user opens it.
  // -----------------------------------------------------------
  useEffect(() => {
    if (!showGrid || gridThumbs.length > 0 || !pdfRef.current) return;
    let cancelled = false;
    async function build() {
      setGridLoading(true);
      const pdf = pdfRef.current!;
      const thumbs: PageThumb[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        if (cancelled) return;
        try {
          const t = await renderPageThumb(i, 0.35);
          thumbs.push(t);
          // Push incrementally so the grid populates progressively.
          setGridThumbs([...thumbs]);
        } catch (err) {
          console.warn(`Failed to render thumb for page ${i}`, err);
        }
      }
      if (!cancelled) setGridLoading(false);
    }
    build();
    return () => {
      cancelled = true;
    };
  }, [showGrid, gridThumbs.length, renderPageThumb]);

  // -----------------------------------------------------------
  // Re-render the big preview when selectedPage changes.
  // -----------------------------------------------------------
  useEffect(() => {
    if (!selectedPage || !pdfRef.current) return;
    let cancelled = false;
    (async () => {
      const t = await renderPageThumb(selectedPage, 1.2);
      if (!cancelled) setPreviewThumb(t);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPage, renderPageThumb]);

  // -----------------------------------------------------------
  // Extract page → upload → patch facility row → callback.
  // -----------------------------------------------------------
  const handleConfirm = useCallback(async () => {
    if (!selectedPage || !pdfBytesRef.current) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      // 1. Extract the chosen page as a new single-page PDF.
      const blob = await extractPageAsPdf(pdfBytesRef.current, selectedPage);

      // 2. Upload to the ldar-site-plans bucket. Deterministic path so any
      //    future re-upload overwrites this one (mirrors
      //    InlineLDARSitePlanUpload).
      const storagePath = `${facility.id}/site-plan.pdf`;
      const { error: uploadError } = await supabase.storage
        .from('ldar-site-plans')
        .upload(storagePath, blob, {
          contentType: 'application/pdf',
          upsert: true,
          cacheControl: '60',
        });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from('ldar-site-plans').getPublicUrl(storagePath);

      // 3. Patch the facility row. Same shape as InlineLDARSitePlanUpload —
      //    uploading the file auto-marks the LDAR side completed.
      const nowIso = new Date().toISOString();
      const { data: userData } = await supabase.auth.getUser();
      const completedBy = userData?.user?.id ?? null;
      // Filename is derived: "facility name - site plan from SPCC.pdf" makes
      // it obvious in the LDAR section what the source was.
      const filename = `${facility.name || 'Facility'} — Site Plan (from SPCC).pdf`;
      const patch = {
        ldar_site_plan_url: publicUrl,
        ldar_site_plan_filename: filename,
        ldar_site_plan_uploaded_at: nowIso,
        ldar_site_plan_completed: true,
        ldar_site_plan_completed_at: facility.ldar_site_plan_completed_at ?? nowIso,
        ldar_site_plan_completed_by: facility.ldar_site_plan_completed_by ?? completedBy,
      };
      const { error: updateError } = await supabase
        .from('facilities')
        .update(patch)
        .eq('id', facility.id);
      if (updateError) throw updateError;

      // Mutate the prop so the parent's next render sees the new URL
      // immediately. Mirrors the updateFacilityField pattern used elsewhere.
      Object.assign(facility, patch);

      onConfirmed();
    } catch (err) {
      console.error('LDAR source selector save failed', err);
      setSaveError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setIsSaving(false);
    }
  }, [selectedPage, facility, onConfirmed]);

  // =========================================================
  // RENDER
  // =========================================================
  // createPortal + a z-index above FacilityDetailModal's 999999 so this
  // dialog always sits on top of the parent modal it was opened from.
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" style={{ zIndex: 1000001 }}>
      <div
        className={`w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden ${
          darkMode ? 'bg-gray-900' : 'bg-white'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-5 py-4 border-b ${
            darkMode ? 'border-gray-800' : 'border-gray-200'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-600 to-blue-600 text-white flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className={`text-base font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Use Site Plan from SPCC Plan
              </h2>
              <p className={`text-xs truncate ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {facility.name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className={`p-2 rounded-lg ${
              darkMode ? 'hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-100 text-gray-700'
            } disabled:opacity-50`}
            title="Cancel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <Loader2 className={`w-8 h-8 animate-spin ${darkMode ? 'text-purple-400' : 'text-purple-600'}`} />
              <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Reading SPCC plan…
              </p>
            </div>
          ) : loadError ? (
            <div className={`flex items-start gap-2 p-4 rounded-lg ${
              darkMode ? 'bg-red-900/20 text-red-300 border border-red-900/50'
                       : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Could not load SPCC plan</p>
                <p className="text-xs mt-1">{loadError}</p>
              </div>
            </div>
          ) : !showGrid ? (
            <>
              {/* Detection result banner */}
              {detection && (
                <div
                  className={`flex items-start gap-2 p-3 rounded-lg mb-4 text-sm ${
                    detection.detectedPage
                      ? darkMode
                        ? 'bg-emerald-900/20 text-emerald-300 border border-emerald-900/50'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : darkMode
                        ? 'bg-yellow-900/20 text-yellow-300 border border-yellow-900/50'
                        : 'bg-yellow-50 text-yellow-700 border border-yellow-200'
                  }`}
                >
                  {detection.detectedPage ? (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  )}
                  <span>{detection.reason}</span>
                </div>
              )}

              {/* Big preview of the selected page */}
              {previewThumb && (
                <div className="flex flex-col items-center">
                  <div
                    className={`mb-2 px-2 py-1 rounded text-xs font-medium ${
                      darkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    Page {previewThumb.page}{detection?.numPages ? ` of ${detection.numPages}` : ''}
                  </div>
                  <img
                    src={previewThumb.dataUrl}
                    alt={`Page ${previewThumb.page} preview`}
                    className={`max-h-[55vh] w-auto border ${
                      darkMode ? 'border-gray-700' : 'border-gray-300'
                    } shadow-md`}
                  />
                </div>
              )}
            </>
          ) : (
            /* Grid view */
            <div>
              <button
                type="button"
                onClick={() => setShowGrid(false)}
                className={`inline-flex items-center gap-1 mb-3 text-sm ${
                  darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <ArrowLeft className="w-4 h-4" />
                Back to detected page
              </button>
              {gridLoading && gridThumbs.length === 0 && (
                <div className="flex items-center justify-center py-12 gap-2">
                  <Loader2 className={`w-5 h-5 animate-spin ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                  <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Rendering page thumbnails…
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {gridThumbs.map((t) => {
                  const isSelected = selectedPage === t.page;
                  return (
                    <button
                      key={t.page}
                      type="button"
                      onClick={() => {
                        setSelectedPage(t.page);
                        setShowGrid(false);
                      }}
                      className={`flex flex-col items-stretch rounded-lg overflow-hidden border-2 transition-all ${
                        isSelected
                          ? darkMode
                            ? 'border-purple-500 ring-2 ring-purple-500/40'
                            : 'border-purple-600 ring-2 ring-purple-300'
                          : darkMode
                            ? 'border-gray-700 hover:border-gray-500'
                            : 'border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      <img
                        src={t.dataUrl}
                        alt={`Page ${t.page}`}
                        className="w-full h-auto bg-white"
                      />
                      <div
                        className={`text-xs font-medium py-1 ${
                          isSelected
                            ? 'bg-purple-600 text-white'
                            : darkMode
                              ? 'bg-gray-800 text-gray-300'
                              : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        Page {t.page}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {saveError && (
            <div
              className={`mt-3 flex items-start gap-2 p-3 rounded-lg text-sm ${
                darkMode
                  ? 'bg-red-900/20 text-red-300 border border-red-900/50'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{saveError}</span>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {!loading && !loadError && (
          <div
            className={`flex items-center justify-between gap-3 px-5 py-3 border-t ${
              darkMode ? 'border-gray-800 bg-gray-900/60' : 'border-gray-200 bg-gray-50'
            }`}
          >
            <button
              type="button"
              onClick={() => setShowGrid((v) => !v)}
              disabled={isSaving}
              className={`text-sm font-medium ${
                darkMode ? 'text-gray-300 hover:text-white' : 'text-gray-700 hover:text-gray-900'
              } disabled:opacity-50`}
            >
              {showGrid ? 'Use detected page' : 'Choose a different page…'}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  darkMode
                    ? 'bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700'
                    : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-300'
                } disabled:opacity-50`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isSaving || !selectedPage}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium text-white ${
                  isSaving || !selectedPage
                    ? 'bg-emerald-500/40 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4" />
                    Use page {selectedPage} →
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
