import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle,
  Loader2,
  FileText,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Facility, SPCCPlan } from '../lib/supabase';
import { supabase } from '../lib/supabase';
import { useDarkMode } from '../contexts/DarkModeContext';
import {
  fetchTemplate,
  stampRecertificationPage,
  replacePageInPDF,
  findApprovalByManagementPageIndex,
  formatRecertificationDate,
  buildLocationString,
} from '../utils/recertificationPDF';
import { getBermShortLabel } from '../utils/spccPlans';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * Recertification page picker + generator.
 *
 * Loads the existing per-berm SPCC plan PDF, lets the user navigate to the
 * "Approval by Management" page (auto-jumped on open via text search), and
 * on confirm:
 *
 *   1. Stamps the bundled recertification template with this facility's
 *      name, formatted location, and the operator's site-visit date.
 *   2. Replaces the chosen page in the source PDF with the stamped one.
 *   3. Overwrites the file at plan.plan_url in Supabase Storage (URL stays
 *      the same per Israel — only the file at it changes).
 *   4. Marks the berm recertified (recertified_date = site-visit date) and
 *      clears the in-window decision so the next 5-year cycle starts clean.
 *   5. Drops a system comment in facility_comments logging the swap.
 */

interface RecertificationPagePickerModalProps {
  facility: Facility;
  plan: SPCCPlan;
  userId: string;
  onClose: () => void;
  /** Called after the workflow completes successfully (parent should refetch). */
  onComplete: () => void;
  /**
   * Regenerate mode — used to re-stamp a previously-recertified berm (e.g.
   * to pick up an updated template or fixed text positioning) without
   * starting a new recertification cycle.
   *
   * Default mode: reads the date from `recertification_decision_at`,
   * clears the in-window decision after success, sets `recertified_date`.
   *
   * Regenerate mode: reads the date from `recertified_date`, leaves
   * decision/recertified_date untouched, drops a different audit comment.
   */
  regenerate?: boolean;
}

export default function RecertificationPagePickerModal({
  facility,
  plan,
  userId,
  onClose,
  onComplete,
  regenerate = false,
}: RecertificationPagePickerModalProps) {
  const { darkMode } = useDarkMode();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  // Hold the source PDF bytes in a ref so we don't trigger re-renders when
  // they're loaded (the bytes are large) and so the generate handler can
  // read the latest copy without prop-drilling.
  const sourceBytesRef = useRef<ArrayBuffer | null>(null);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0); // 0-based
  const [autoDetectedPage, setAutoDetectedPage] = useState<number | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(true);
  const [renderingPage, setRenderingPage] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // ---- Load + auto-detect on mount --------------------------------------
  useEffect(() => {
    if (!plan.plan_url) {
      setError('This berm has no plan PDF uploaded yet. Upload a plan before recertifying.');
      setLoadingPdf(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        // Fetch with cache-buster so we always pick up the latest version
        // (in case the user swapped recently from another device).
        const res = await fetch(`${plan.plan_url}?v=${Date.now()}`);
        if (!res.ok) throw new Error(`Could not fetch plan PDF (${res.status}).`);
        const bytes = await res.arrayBuffer();
        if (cancelled) return;
        sourceBytesRef.current = bytes;

        const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setPageCount(doc.numPages);

        const auto = await findApprovalByManagementPageIndex(bytes);
        if (cancelled) return;
        setAutoDetectedPage(auto);
        setCurrentPage(auto ?? 0);
        setLoadingPdf(false);
      } catch (err: any) {
        if (cancelled) return;
        console.error('Failed to load plan PDF:', err);
        setError(err?.message || 'Could not load the plan PDF.');
        setLoadingPdf(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
    // plan.plan_url is the only dep — the rest are stable refs/setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.plan_url]);

  // ---- Render the current page whenever it changes ----------------------
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;

    const render = async () => {
      setRenderingPage(true);
      // Cancel any in-flight render before starting a new one.
      try {
        renderTaskRef.current?.cancel?.();
      } catch {
        // ignore
      }

      try {
        const page = await pdfDoc.getPage(currentPage + 1);
        if (cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        // Fit roughly to a 720px-wide column, scaled for retina sharpness.
        const baseWidth = 720;
        const unscaledViewport = page.getViewport({ scale: 1 });
        const fitScale = baseWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale: fitScale * dpr });

        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
        if (cancelled) return;
      } catch (err: any) {
        // pdfjs throws "Rendering cancelled" when superseded — ignore those.
        if (err?.name !== 'RenderingCancelledException' && !cancelled) {
          console.error('Page render failed:', err);
        }
      } finally {
        if (!cancelled) setRenderingPage(false);
      }
    };

    render();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, currentPage]);

  // ---- Generate handler -------------------------------------------------
  const generate = async () => {
    setError(null);

    if (!sourceBytesRef.current) {
      setError('Plan PDF is still loading.');
      return;
    }
    if (!plan.plan_url) {
      setError('This berm has no plan PDF.');
      return;
    }
    // Date source differs by mode:
    // - default flow: use the in-window site-visit date (decision_at)
    // - regenerate: use the original recertified_date (already on file)
    const sourceDate = regenerate
      ? plan.recertified_date
      : plan.recertification_decision_at;
    if (!sourceDate) {
      setError(
        regenerate
          ? 'No recertified date on this berm — nothing to regenerate from.'
          : 'Site-visit date is missing — re-record the recertification decision.'
      );
      return;
    }

    // Build the three field values
    const decisionDate = sourceDate;
    const dateField = formatRecertificationDate(decisionDate);
    const location = buildLocationString({
      latitude: facility.latitude,
      longitude: facility.longitude,
      county: facility.county,
      stateCode: facility.state_code,
    });
    if (!location) {
      setError(
        'Facility is missing latitude/longitude, county, or state. Fill these in on the General tab before generating.'
      );
      return;
    }

    setGenerating(true);
    try {
      // 1. Stamp the template
      const templateBytes = await fetchTemplate();
      const stamped = await stampRecertificationPage(templateBytes, {
        facilityName: facility.name,
        location,
        date: dateField,
      });

      // 2. Replace the chosen page in the source PDF
      const merged = await replacePageInPDF(sourceBytesRef.current, currentPage, stamped);

      // 3. Overwrite the file at the existing Storage path. URL stays
      //    identical per Israel's stable-URL rule. The filename baked
      //    into the URL won't change to reflect "Renewal" — the
      //    Standardize Plan Filenames tool in account settings handles
      //    one-time naming; recerts just update file content.
      const storagePath = plan.plan_url.replace(/^.*\/spcc-plans\//, '');
      const { error: uploadErr } = await supabase.storage
        .from('spcc-plans')
        .upload(storagePath, new Blob([merged], { type: 'application/pdf' }), {
          contentType: 'application/pdf',
          upsert: true,
          // Short cache TTL so phones drop the stale file quickly.
          cacheControl: '60',
        });
      if (uploadErr) throw uploadErr;

      // 4. Update spcc_plans. Always stamps `recertification_pdf_generated_at`
      //    — that's the canonical "this berm has a stamped recertification
      //    page in its PDF" flag the BermPlanCard's Regenerate button gates
      //    on. Default flow additionally marks the berm recertified and
      //    clears the in-window decision so the next 5-year cycle surfaces
      //    a fresh prompt. Regenerate mode leaves recertified_date and the
      //    decision fields alone.
      const generatedAt = new Date().toISOString();
      if (!regenerate) {
        const decisionDateOnly = decisionDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
        const recertifiedIsoDate = decisionDateOnly
          ? `${decisionDateOnly[1]}-${decisionDateOnly[2]}-${decisionDateOnly[3]}`
          : null;
        const { error: planUpdErr } = await supabase
          .from('spcc_plans')
          .update({
            recertified_date: recertifiedIsoDate,
            recertification_decision: null,
            recertification_decision_notes: null,
            recertification_decision_at: null,
            recertification_pdf_generated_at: generatedAt,
          })
          .eq('id', plan.id);
        if (planUpdErr) throw planUpdErr;
      } else {
        const { error: planUpdErr } = await supabase
          .from('spcc_plans')
          .update({ recertification_pdf_generated_at: generatedAt })
          .eq('id', plan.id);
        if (planUpdErr) throw planUpdErr;
      }

      // 5. System comment on the facility comments thread
      const today = new Date().toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      });
      const bermLabel = getBermShortLabel(plan);
      const commentBody = regenerate
        ? `[SYSTEM] Regenerated recertification PDF for ${bermLabel} on ${today}. ` +
          `Re-stamped page ${currentPage + 1} of the plan PDF using the existing ` +
          `recertified date (${dateField}). No change to recertification cycle.`
        : `[SYSTEM] SPCC plan recertified for ${bermLabel} on ${today}. ` +
          `Decision: No Significant Changes. Site-visit date: ${dateField}. ` +
          `Replaced page ${currentPage + 1} of the plan PDF (Approval by Management) ` +
          `with a freshly stamped recertification page.`;
      // user_id is the current operator — facility_comments.user_id has
      // an FK to public.users, so we can't use a synthetic NULL system id.
      const { error: commentErr } = await supabase
        .from('facility_comments')
        .insert({
          facility_id: facility.id,
          user_id: userId,
          author_name: 'System',
          body: commentBody,
        });
      if (commentErr) {
        // Don't fail the whole flow on a comment failure — log and continue.
        console.warn('Failed to add system comment:', commentErr);
      }

      setDone(true);
      // Give the user a beat to see "Done" before closing.
      setTimeout(() => {
        onComplete();
        onClose();
      }, 1200);
    } catch (err: any) {
      console.error('Recertification generation failed:', err);
      setError(err?.message || 'Could not generate the recertification plan.');
    } finally {
      setGenerating(false);
    }
  };

  // ---- Render -----------------------------------------------------------
  // Stacks above SPCCPlanDetailModal (the parent), matching the
  // InspectionViewer nested-modal z-tier convention used elsewhere.
  const overlayClass = darkMode
    ? 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[1000001] p-2'
    : 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[1000001] p-2';
  const panelClass = darkMode
    ? 'bg-gray-900 text-gray-100 rounded-xl shadow-2xl w-full max-w-3xl max-h-[95vh] flex flex-col'
    : 'bg-white text-gray-900 rounded-xl shadow-2xl w-full max-w-3xl max-h-[95vh] flex flex-col';

  const goPrev = () => setCurrentPage((p) => Math.max(0, p - 1));
  const goNext = () => setCurrentPage((p) => Math.min(pageCount - 1, p + 1));

  return createPortal(
    <div className={overlayClass} onClick={onClose}>
      <div className={panelClass} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              {regenerate ? 'Regenerate' : 'Create'} Recertification Plan — {getBermShortLabel(plan)}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {regenerate
                ? 'Re-stamps the recertification page using the existing recertified date. Pick the page to replace.'
                : 'Pick the "Approval by Management" page to replace, then generate.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={generating}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loadingPdf && (
            <div className="flex items-center justify-center py-12 text-gray-500 dark:text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading plan PDF…
            </div>
          )}

          {!loadingPdf && error && !done && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700 text-red-800 dark:text-red-200 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!loadingPdf && pdfDoc && (
            <>
              {/* Auto-detect hint */}
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {autoDetectedPage !== null ? (
                  <>
                    Auto-jumped to page <span className="font-semibold">{autoDetectedPage + 1}</span> —
                    matched “Approval by Management”. Verify it's the right page, or use the arrows
                    to pick a different one.
                  </>
                ) : (
                  <>
                    Couldn't find “Approval by Management” in this PDF. Browse to the right page
                    manually.
                  </>
                )}
              </div>

              {/* Pager */}
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={currentPage === 0 || renderingPage || generating}
                  className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="text-sm font-medium">
                  Page{' '}
                  <input
                    type="number"
                    min={1}
                    max={pageCount}
                    value={currentPage + 1}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (Number.isFinite(n) && n >= 1 && n <= pageCount) {
                        setCurrentPage(n - 1);
                      }
                    }}
                    disabled={generating}
                    className="w-14 px-2 py-1 text-center border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 disabled:opacity-50"
                  />{' '}
                  of {pageCount}
                </div>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={currentPage === pageCount - 1 || renderingPage || generating}
                  className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              {/* Canvas */}
              <div className="flex justify-center">
                <div
                  className="relative inline-block border border-gray-200 dark:border-gray-700 bg-white"
                  style={{ minHeight: 200 }}
                >
                  <canvas ref={canvasRef} />
                  {renderingPage && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-gray-900/60">
                      <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {done && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-700 text-green-800 dark:text-green-200 text-sm">
              <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Recertification plan generated and uploaded.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        {!done && (
          <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              disabled={generating}
              className="px-4 py-2 text-sm rounded text-gray-600 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={loadingPdf || generating || !pdfDoc || !!error}
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {generating && <Loader2 className="w-4 h-4 animate-spin" />}
              {generating
                ? 'Generating…'
                : regenerate
                  ? 'Regenerate Recertification Plan'
                  : 'Create Recertification Plan'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
