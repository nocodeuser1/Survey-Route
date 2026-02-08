import { useState } from 'react';
import { X, ClipboardList, FileCheck, Eye, RefreshCw } from 'lucide-react';

export interface CompletedVisibility {
  // Inspection-related
  hideAllCompleted: boolean;
  hideInternallyCompleted: boolean;
  hideExternallyCompleted: boolean;
  // Plan-related
  hideValidPlans: boolean;
  hideExpiringPlans: boolean;
}

interface CompletedFacilitiesVisibilityModalProps {
  visibility: CompletedVisibility;
  surveyType: 'all' | 'spcc_inspection' | 'spcc_plan';
  onClose: () => void;
  onApply: (visibility: CompletedVisibility) => void;
  onApplyAndRefreshRoute?: (visibility: CompletedVisibility) => void;
}

export default function CompletedFacilitiesVisibilityModal({
  visibility,
  surveyType,
  onClose,
  onApply,
  onApplyAndRefreshRoute,
}: CompletedFacilitiesVisibilityModalProps) {
  const [localVisibility, setLocalVisibility] = useState(visibility);

  const handleApply = () => {
    onApply(localVisibility);
    onClose();
  };

  const handleApplyAndRefresh = () => {
    if (onApplyAndRefreshRoute) {
      onApplyAndRefreshRoute(localVisibility);
    }
    onClose();
  };

  const handleReset = () => {
    setLocalVisibility({
      hideAllCompleted: false,
      hideInternallyCompleted: false,
      hideExternallyCompleted: false,
      hideValidPlans: false,
      hideExpiringPlans: false,
    });
  };

  // Check if anything is hidden (for the reset button)
  const hasAnyHidden =
    localVisibility.hideAllCompleted ||
    localVisibility.hideInternallyCompleted ||
    localVisibility.hideExternallyCompleted ||
    localVisibility.hideValidPlans ||
    localVisibility.hideExpiringPlans;

  const title =
    surveyType === 'spcc_inspection'
      ? 'Inspection Visibility'
      : surveyType === 'spcc_plan'
        ? 'Plan Visibility'
        : 'Map Visibility';

  const description =
    surveyType === 'spcc_inspection'
      ? 'Hide completed inspections from the map so you can focus on remaining work.'
      : surveyType === 'spcc_plan'
        ? 'Hide facilities with current SPCC plans from the map so you can focus on those needing attention.'
        : 'Choose which completed facilities to hide from the map view.';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000] p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {description}
          </p>

          {/* Inspections section - show in All and Inspections modes */}
          {(surveyType === 'all' || surveyType === 'spcc_inspection') && (
            <div>
              {surveyType === 'all' && (
                <div className="flex items-center gap-2 mb-2">
                  <ClipboardList className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                    Inspections
                  </p>
                </div>
              )}

              {surveyType === 'spcc_inspection' && (
                <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={localVisibility.hideAllCompleted}
                    onChange={() => {
                      const newValue = !localVisibility.hideAllCompleted;
                      setLocalVisibility({
                        ...localVisibility,
                        hideAllCompleted: newValue,
                        hideInternallyCompleted: newValue,
                        hideExternallyCompleted: newValue,
                      });
                    }}
                    className="mt-0.5 w-4 h-4 text-blue-600 rounded"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      Hide All Completed
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Hides all facilities with any type of inspection completion
                    </div>
                  </div>
                </label>
              )}

              {surveyType === 'spcc_inspection' && (
                <div className="border-t border-gray-100 dark:border-gray-700/50 mt-2 pt-2">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 px-3">
                    Or choose specific types:
                  </p>
                </div>
              )}

              <div className={surveyType === 'spcc_inspection' ? 'pl-2' : ''}>
                <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
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
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Facilities with completed inspections or marked as internally completed
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
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
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Facilities marked as completed by external inspectors
                    </div>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Divider between sections in All mode */}
          {surveyType === 'all' && (
            <div className="border-t border-gray-200 dark:border-gray-700" />
          )}

          {/* Plans section - show in All and Plans modes */}
          {(surveyType === 'all' || surveyType === 'spcc_plan') && (
            <div>
              {surveyType === 'all' && (
                <div className="flex items-center gap-2 mb-2">
                  <FileCheck className="w-4 h-4 text-green-600 dark:text-green-400" />
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                    SPCC Plans
                  </p>
                </div>
              )}

              <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <input
                  type="checkbox"
                  checked={localVisibility.hideValidPlans}
                  onChange={(e) =>
                    setLocalVisibility({
                      ...localVisibility,
                      hideValidPlans: e.target.checked,
                    })
                  }
                  className="mt-0.5 w-4 h-4 text-green-600 rounded"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    Hide Valid Plans
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Facilities with a current, active SPCC plan (not due for renewal)
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <input
                  type="checkbox"
                  checked={localVisibility.hideExpiringPlans}
                  onChange={(e) =>
                    setLocalVisibility({
                      ...localVisibility,
                      hideExpiringPlans: e.target.checked,
                    })
                  }
                  className="mt-0.5 w-4 h-4 text-amber-600 rounded"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    Hide Expiring Plans
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Facilities with plans expiring within 90 days (still valid but nearing renewal)
                  </div>
                </div>
              </label>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
          <div className="flex gap-3">
            {hasAnyHidden && (
              <button
                onClick={handleReset}
                className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                Reset
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Apply
            </button>
          </div>
          {onApplyAndRefreshRoute && (
            <button
              onClick={handleApplyAndRefresh}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors font-medium text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              Apply & Refresh Route
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
