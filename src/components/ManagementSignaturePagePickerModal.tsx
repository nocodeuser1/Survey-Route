import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Check,
  AlertTriangle,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { pdfjsDocumentDefaults } from '../utils/pdfjsDocumentDefaults';
import type { SPCCPlan } from '../lib/supabase';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * Manual fallback when stampManagementSignature can't auto-detect §5.2 and
 * §5.3 from the plan PDF (added 2026-05-22).
 *
 * Loads the plan PDF, renders pages with prev/next nav (modeled on
 * RecertificationPagePickerModal), and lets the user designate the current
 * page as §5.2 (Approval by Management) and/or §5.3 (Substantial Harm
 * Criteria). At least one must be assigned before "Stamp" enables.
 *
 * Returns the chosen indices to BermPlanCard which then retries the stamp
 * with those values as overrides.
 */

interface ManagementSignaturePagePickerModalProps {
  plan: SPCCPlan;
  darkMode: boolean;
  onCancel: () => void;
  /** Called with the user's 0-based page selections (null = skip that section). */
  onConfirm: (indices: {
    managementApprovalIndex: number | null;
    substantialHarmIndex: number | null;
  }) => void;
}

export default function ManagementSignaturePagePickerModal({
  plan,
  darkMode,
  onCancel,
  onConfirm,
}: ManagementSignaturePagePickerModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0); // 0-based
  const [section52Page, setSection52Page] = useState<number | null>(null);
  const [section53Page, setSection53Page] = useState<number | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(true);
  const [renderingPage, setRenderingPage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Container width drives canvas scale so the PDF fits on narrow viewports
  // (phones). Defaults to 720 so desktop matches the prior fixed-width look;
  // on mobile, ResizeObserver shrinks this to the actual flex column width.
  const [containerWidth, setContainerWidth] = useState<number>(720);

  // ---- Load PDF on mount -----------------------------------------------
  useEffect(() => {
    if (!plan.plan_url) {
      setError('This berm has no plan PDF uploaded yet.');
      setLoadingPdf(false);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${plan.plan_url}?v=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Could not fetch plan PDF (${res.status}).`);
        const bytes = await res.arrayBuffer();
        if (cancelled) return;

        const doc = await pdfjsLib.getDocument({ ...pdfjsDocumentDefaults, data: bytes.slice(0) }).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setPageCount(doc.numPages);
        setCurrentPage(0);
        setLoadingPdf(false);
      } catch (err: any) {
        if (cancelled) return;
        console.error('[MgmtSigPicker] Failed to load PDF:', err);
        setError(err?.message || 'Could not load the plan PDF.');
        setLoadingPdf(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [plan.plan_url]);

  // ---- Track container width so the canvas can shrink on narrow viewports
  useEffect(() => {
    if (!canvasContainerRef.current || typeof ResizeObserver === 'undefined') return;
    const el = canvasContainerRef.current;
    const ro = new ResizeObserver(() => {
      // Subtract a little padding so the canvas doesn't kiss the modal edge.
      const w = Math.max(220, el.clientWidth - 8);
      setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- Render the current page whenever it changes ---------------------
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;

    (async () => {
      setRenderingPage(true);
      try {
        renderTaskRef.current?.cancel?.();
      } catch {
        /* ignore */
      }

      try {
        const page = await pdfDoc.getPage(currentPage + 1);
        if (cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        // Cap at 720 (the desktop quality target) but shrink to the actual
        // container on smaller screens so the canvas never overflows the
        // modal on mobile.
        const baseWidth = Math.min(720, containerWidth);
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
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException' && !cancelled) {
          console.error('[MgmtSigPicker] Page render failed:', err);
        }
      } finally {
        if (!cancelled) setRenderingPage(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, currentPage, containerWidth]);

  const goPrev = () => setCurrentPage((p) => Math.max(0, p - 1));
  const goNext = () => setCurrentPage((p) => Math.min(pageCount - 1, p + 1));

  const isCurrent52 = section52Page === currentPage;
  const isCurrent53 = section53Page === currentPage;

  const canConfirm = section52Page !== null || section53Page !== null;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm({
      managementApprovalIndex: section52Page,
      substantialHarmIndex: section53Page,
    });
  };

  const content = (
    // SPCCPlanDetailModal uses inline zIndex: 999999, so this picker — which
    // is meant to sit ABOVE that modal — needs to go one tier higher. Using
    // an inline style (not a Tailwind utility) so we don't have to extend the
    // Tailwind z-index scale just for this case.
    <div
      className="fixed inset-0 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm"
      style={{ zIndex: 9999999 }}
    >
      <div
        className={`relative w-full max-w-4xl max-h-[95vh] sm:max-h-[92vh] flex flex-col rounded-2xl shadow-2xl border ${
          darkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-start justify-between px-4 sm:px-5 py-3 sm:py-4 border-b ${
            darkMode ? 'border-gray-700' : 'border-gray-200'
          }`}
        >
          <div className="min-w-0">
            <h3 className={`text-base font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Select pages manually
            </h3>
            <p className={`text-xs mt-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              The auto-detector couldn't find §5.2 or §5.3 in this PDF. Browse to each
              page, then assign it to the matching section. At least one assignment is
              required.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className={`p-1.5 rounded-lg flex-shrink-0 ${
              darkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'
            }`}
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Assignment summary chips */}
        <div className={`px-4 sm:px-5 py-2 sm:py-3 border-b flex flex-wrap items-center gap-2 ${
          darkMode ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-gray-50'
        }`}>
          <AssignmentChip
            label="§5.2 Approval by Management"
            page={section52Page}
            onClear={() => setSection52Page(null)}
            darkMode={darkMode}
          />
          <AssignmentChip
            label="§5.3 Substantial Harm Criteria"
            page={section53Page}
            onClear={() => setSection53Page(null)}
            darkMode={darkMode}
          />
        </div>

        {/* Body: viewer or loading/error */}
        <div ref={canvasContainerRef} className="flex-1 overflow-auto p-3 sm:p-5">
          {loadingPdf ? (
            <div className={`flex items-center gap-2 justify-center py-12 ${
              darkMode ? 'text-gray-400' : 'text-gray-500'
            }`}>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading PDF…</span>
            </div>
          ) : error ? (
            <div
              className={`flex items-start gap-2 px-4 py-3 rounded-lg ${
                darkMode ? 'bg-red-900/30 text-red-200' : 'bg-red-50 text-red-700'
              }`}
            >
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="text-sm">{error}</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              {/* Page nav */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={currentPage <= 0}
                  className={`p-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed ${
                    darkMode
                      ? 'hover:bg-gray-800 text-gray-300'
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className={`text-sm font-medium tabular-nums ${
                  darkMode ? 'text-gray-200' : 'text-gray-800'
                }`}>
                  Page {currentPage + 1} of {pageCount}
                </span>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={currentPage >= pageCount - 1}
                  className={`p-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed ${
                    darkMode
                      ? 'hover:bg-gray-800 text-gray-300'
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                  aria-label="Next page"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                {renderingPage && (
                  <Loader2 className={`w-4 h-4 animate-spin ${
                    darkMode ? 'text-gray-500' : 'text-gray-400'
                  }`} />
                )}
              </div>

              {/* Per-page assign buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSection52Page(currentPage)}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    isCurrent52
                      ? darkMode
                        ? 'bg-emerald-700 text-emerald-100'
                        : 'bg-emerald-600 text-white'
                      : darkMode
                        ? 'bg-blue-900/40 text-blue-300 hover:bg-blue-900/60'
                        : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                  }`}
                >
                  {isCurrent52 ? <Check className="w-3.5 h-3.5" /> : null}
                  Set this page as §5.2
                </button>
                <button
                  type="button"
                  onClick={() => setSection53Page(currentPage)}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    isCurrent53
                      ? darkMode
                        ? 'bg-emerald-700 text-emerald-100'
                        : 'bg-emerald-600 text-white'
                      : darkMode
                        ? 'bg-blue-900/40 text-blue-300 hover:bg-blue-900/60'
                        : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                  }`}
                >
                  {isCurrent53 ? <Check className="w-3.5 h-3.5" /> : null}
                  Set this page as §5.3
                </button>
              </div>

              {/* Canvas — max-w-full ensures the bitmap shrinks via CSS on
                  narrow viewports even before ResizeObserver kicks in. */}
              <div
                className={`rounded-lg overflow-hidden shadow max-w-full ${
                  darkMode ? 'bg-gray-800' : 'bg-white'
                }`}
              >
                <canvas ref={canvasRef} className="block max-w-full h-auto" />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className={`flex items-center justify-end gap-2 px-4 sm:px-5 py-3 border-t ${
            darkMode ? 'border-gray-700' : 'border-gray-200'
          }`}
        >
          <button
            type="button"
            onClick={onCancel}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              darkMode
                ? 'text-gray-300 hover:bg-gray-800'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${
              canConfirm
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-blue-600/40 cursor-not-allowed'
            }`}
          >
            Stamp with selected pages
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

/** Small read-only chip showing the current assignment for one section. */
function AssignmentChip({
  label,
  page,
  onClear,
  darkMode,
}: {
  label: string;
  page: number | null;
  onClear: () => void;
  darkMode: boolean;
}) {
  const isSet = page !== null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
        isSet
          ? darkMode
            ? 'bg-emerald-900/40 text-emerald-300 ring-1 ring-emerald-700/60'
            : 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300'
          : darkMode
            ? 'bg-gray-800 text-gray-400 ring-1 ring-gray-700'
            : 'bg-white text-gray-500 ring-1 ring-gray-300'
      }`}
    >
      <span>
        {label}: {isSet ? `Page ${(page as number) + 1}` : 'not set'}
      </span>
      {isSet && (
        <button
          type="button"
          onClick={onClear}
          className={`p-0.5 rounded-full ${
            darkMode ? 'hover:bg-emerald-900/60' : 'hover:bg-emerald-200'
          }`}
          aria-label="Clear assignment"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}
