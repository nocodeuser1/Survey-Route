import { CheckCircle, Loader2, X } from 'lucide-react';

interface CompletionTypeModalProps {
  facilityCount: number;
  onSelectInternal: () => void | Promise<void>;
  onSelectExternal: () => void | Promise<void>;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
}

export default function CompletionTypeModal({ facilityCount, onSelectInternal, onSelectExternal, onClose, busy = false, error }: CompletionTypeModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white">
            Mark Completion Type
          </h3>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          Choose how to mark {facilityCount} selected {facilityCount === 1 ? 'facility' : 'facilities'}:
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-400 p-3 text-sm text-red-700 dark:text-red-300" role="alert">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={onSelectInternal}
            disabled={busy}
            className="w-full flex items-center gap-3 px-4 py-4 border-2 border-blue-300 hover:border-blue-700 hover:bg-blue-700 hover:text-white rounded-lg transition-all group disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="flex-shrink-0 w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center">
              {busy ? <Loader2 className="w-6 h-6 animate-spin text-white" /> : <CheckCircle className="w-6 h-6 text-white" />}
            </div>
            <div className="flex-1 text-left">
              <div className="font-semibold text-gray-900 dark:text-white group-hover:text-white">
                Mark as Completed Internally
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 group-hover:text-white">
                SPCC completed by your team
              </div>
            </div>
          </button>

          <button
            onClick={onSelectExternal}
            disabled={busy}
            className="w-full flex items-center gap-3 px-4 py-4 border-2 border-yellow-400 hover:border-yellow-700 hover:bg-yellow-700 hover:text-white rounded-lg transition-all group disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="flex-shrink-0 w-10 h-10 bg-yellow-600 text-white rounded-full flex items-center justify-center">
              {busy ? <Loader2 className="w-6 h-6 animate-spin text-white" /> : <CheckCircle className="w-6 h-6 text-white" />}
            </div>
            <div className="flex-1 text-left">
              <div className="font-semibold text-gray-900 dark:text-white group-hover:text-white">
                Mark as Completed Externally
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 group-hover:text-white">
                SPCC completed by another company
              </div>
            </div>
          </button>

          <button
            onClick={onClose}
            disabled={busy}
            className="w-full px-4 py-3 border border-gray-300 hover:bg-gray-700 hover:text-white text-gray-700 dark:text-gray-200 rounded-lg transition-colors font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
