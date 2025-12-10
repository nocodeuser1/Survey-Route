import { AlertTriangle, Trash2, X } from 'lucide-react';

interface DeletedFacilitiesAlertProps {
  deletedFacilities: Array<{ name: string; day: number }>;
  onRemoveDeleted: () => void;
  onKeepAll: () => void;
  onClose: () => void;
}

export default function DeletedFacilitiesAlert({
  deletedFacilities,
  onRemoveDeleted,
  onKeepAll,
  onClose
}: DeletedFacilitiesAlertProps) {
  const groupedByDay = deletedFacilities.reduce((acc, facility) => {
    if (!acc[facility.day]) {
      acc[facility.day] = [];
    }
    acc[facility.day].push(facility.name);
    return acc;
  }, {} as Record<number, string[]>);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-start gap-3 p-4 sm:p-6 border-b border-gray-200">
          <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 bg-orange-100 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 text-orange-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg sm:text-xl font-bold text-gray-900">
              Deleted Facilities Found
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              This route contains {deletedFacilities.length} {deletedFacilities.length === 1 ? 'facility' : 'facilities'} that {deletedFacilities.length === 1 ? 'has' : 'have'} been deleted from your facility list.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="space-y-3">
            {Object.entries(groupedByDay)
              .sort(([dayA], [dayB]) => Number(dayA) - Number(dayB))
              .map(([day, facilityNames]) => (
                <div key={day} className="bg-gray-50 rounded-lg p-3 sm:p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs sm:text-sm font-semibold text-gray-700 dark:text-gray-200">
                      Day {day}
                    </span>
                    <span className="text-xs text-gray-500">
                      ({facilityNames.length} {facilityNames.length === 1 ? 'facility' : 'facilities'})
                    </span>
                  </div>
                  <div className="space-y-1">
                    {facilityNames.map((name, idx) => (
                      <div
                        key={idx}
                        className="text-xs sm:text-sm text-gray-600 pl-3 border-l-2 border-orange-300"
                      >
                        {name}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>

          <div className="mt-4 p-3 sm:p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs sm:text-sm text-blue-800">
              <strong>Note:</strong> These facilities no longer exist in your facility list. You can either remove them from this route or keep them for reference.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 p-4 sm:p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onKeepAll}
            className="flex-1 px-4 py-2.5 sm:py-3 text-sm sm:text-base font-medium text-gray-700 dark:text-gray-200 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Keep All
          </button>
          <button
            onClick={onRemoveDeleted}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 sm:py-3 text-sm sm:text-base font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Remove Deleted
          </button>
        </div>
      </div>
    </div>
  );
}
