import { CheckCircle, X } from 'lucide-react';

interface CompletionTypeModalProps {
  facilityCount: number;
  onSelectInternal: () => void;
  onSelectExternal: () => void;
  onClose: () => void;
}

export default function CompletionTypeModal({ facilityCount, onSelectInternal, onSelectExternal, onClose }: CompletionTypeModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white">
            Mark Completion Type
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          Choose how to mark {facilityCount} selected {facilityCount === 1 ? 'facility' : 'facilities'}:
        </p>

        <div className="space-y-3">
          <button
            onClick={onSelectInternal}
            className="w-full flex items-center gap-3 px-4 py-4 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border-2 border-blue-200 dark:border-blue-700 hover:border-blue-400 rounded-lg transition-all group"
          >
            <div className="flex-shrink-0 w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 text-left">
              <div className="font-semibold text-gray-900 dark:text-white group-hover:text-blue-900 dark:group-hover:text-blue-300">
                Mark as Completed Internally
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                SPCC completed by your team
              </div>
            </div>
          </button>

          <button
            onClick={onSelectExternal}
            className="w-full flex items-center gap-3 px-4 py-4 bg-yellow-50 dark:bg-yellow-900/30 hover:bg-yellow-100 dark:hover:bg-yellow-900/50 border-2 border-yellow-200 dark:border-yellow-700 hover:border-yellow-400 rounded-lg transition-all group"
          >
            <div className="flex-shrink-0 w-10 h-10 bg-yellow-600 rounded-full flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 text-left">
              <div className="font-semibold text-gray-900 dark:text-white group-hover:text-yellow-900 dark:group-hover:text-yellow-300">
                Mark as Completed Externally
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                SPCC completed by another company
              </div>
            </div>
          </button>

          <button
            onClick={onClose}
            className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg transition-colors font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
