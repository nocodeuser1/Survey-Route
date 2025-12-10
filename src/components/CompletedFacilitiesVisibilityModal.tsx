import { useState } from 'react';
import { X } from 'lucide-react';

interface CompletedFacilitiesVisibilityModalProps {
  visibility: {
    hideAllCompleted: boolean;
    hideInternallyCompleted: boolean;
    hideExternallyCompleted: boolean;
  };
  onClose: () => void;
  onApply: (visibility: {
    hideAllCompleted: boolean;
    hideInternallyCompleted: boolean;
    hideExternallyCompleted: boolean;
  }) => void;
}

export default function CompletedFacilitiesVisibilityModal({
  visibility,
  onClose,
  onApply,
}: CompletedFacilitiesVisibilityModalProps) {
  const [localVisibility, setLocalVisibility] = useState(visibility);

  const handleApply = () => {
    onApply(localVisibility);
    onClose();
  };

  const handleToggleAll = () => {
    const newValue = !localVisibility.hideAllCompleted;
    setLocalVisibility({
      hideAllCompleted: newValue,
      hideInternallyCompleted: newValue,
      hideExternallyCompleted: newValue,
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000] p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Completed Facilities Visibility
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Choose which completed facilities to hide from the map view. This does not affect route optimization.
          </p>

          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            <input
              type="checkbox"
              checked={localVisibility.hideAllCompleted}
              onChange={handleToggleAll}
              className="mt-0.5 w-4 h-4 text-blue-600 rounded"
            />
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Hide All Completed Facilities
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Hides all facilities with any type of completion (inspections, internal, or external)
              </div>
            </div>
          </label>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-3">
              Or choose specific types:
            </p>

            <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <input
                type="checkbox"
                checked={localVisibility.hideInternallyCompleted}
                onChange={(e) =>
                  setLocalVisibility({
                    ...localVisibility,
                    hideInternallyCompleted: e.target.checked,
                    hideAllCompleted: false,
                  })
                }
                className="mt-0.5 w-4 h-4 text-blue-600 rounded"
              />
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  Hide Internally Completed
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Facilities with completed inspections or marked as internally completed
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <input
                type="checkbox"
                checked={localVisibility.hideExternallyCompleted}
                onChange={(e) =>
                  setLocalVisibility({
                    ...localVisibility,
                    hideExternallyCompleted: e.target.checked,
                    hideAllCompleted: false,
                  })
                }
                className="mt-0.5 w-4 h-4 text-blue-600 rounded"
              />
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  Hide Externally Completed
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Facilities marked as completed by external inspectors
                </div>
              </div>
            </label>
          </div>
        </div>

        <div className="flex gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="flex-1 px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
