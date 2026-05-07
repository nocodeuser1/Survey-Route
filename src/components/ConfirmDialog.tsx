import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';

/**
 * App-themed confirmation modal — drop-in replacement for window.confirm().
 *
 * Why not window.confirm: it's a generic browser dialog (different on Mac
 * vs Windows vs Safari iOS), can't be styled, blocks the entire window,
 * and doesn't honor dark mode. This component matches the rest of the
 * app's modal design language (backdrop, rounded card, dark mode).
 *
 * Behavior:
 *  - Renders nothing when `open` is false.
 *  - Esc key triggers Cancel, Enter triggers Confirm.
 *  - Auto-focuses the Cancel button (safer default — a stray Enter on a
 *    destructive action shouldn't fire it).
 *  - Click on the backdrop = Cancel.
 *  - Renders via portal so it always sits above other modals.
 *
 * Usage:
 *   const [confirmState, setConfirmState] = useState<{...} | null>(null);
 *   <ConfirmDialog
 *     open={!!confirmState}
 *     title="Delete this signature?"
 *     message="This cannot be undone."
 *     confirmLabel="Delete"
 *     danger
 *     onConfirm={() => { doDelete(); setConfirmState(null); }}
 *     onCancel={() => setConfirmState(null)}
 *   />
 */

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, the confirm button is red (destructive action). */
  danger?: boolean;
  /** Disables both buttons (e.g. while the action is in flight). */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Auto-focus Cancel on open. Cancel is the safer default — a stray
  // keypress shouldn't trigger a destructive Confirm.
  useEffect(() => {
    if (open) {
      // Defer one tick so the element is mounted before we focus it.
      const t = setTimeout(() => cancelRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Keyboard shortcuts: Esc cancels, Enter confirms.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel, onConfirm]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={busy ? undefined : onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start gap-4">
            {danger ? (
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
            ) : null}
            <div className="flex-1 min-w-0">
              <h3
                id="confirm-dialog-title"
                className="text-lg font-semibold text-gray-900 dark:text-white"
              >
                {title}
              </h3>
              {message && (
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">
                  {message}
                </p>
              )}
            </div>
            <button
              onClick={onCancel}
              disabled={busy}
              aria-label="Close"
              className="flex-shrink-0 -mt-1 -mr-2 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/40 border-t border-gray-200 dark:border-gray-700 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              danger
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
