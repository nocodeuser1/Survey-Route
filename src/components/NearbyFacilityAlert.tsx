import { CheckCircle, MapPin, Navigation, X } from 'lucide-react';
import { Facility } from '../lib/supabase';
import { NearbyFacilityWithDistance } from '../utils/distanceCalculator';
import { formatDistanceWithFeet } from '../utils/distanceCalculator';
import { createPortal } from 'react-dom';

interface NearbyFacilityAlertProps {
  currentFacility: Facility;
  nearbyFacilities: NearbyFacilityWithDistance[];
  onSelectFacility: (facility: Facility) => void;
  onClose: () => void;
}

export default function NearbyFacilityAlert({
  currentFacility,
  nearbyFacilities,
  onSelectFacility,
  onClose,
}: NearbyFacilityAlertProps) {
  const modalContent = (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[9999999]"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-green-600 to-green-700 text-white p-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
                <CheckCircle className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">Inspection Completed!</h2>
                <p className="text-green-100 text-sm mt-0.5">
                  {currentFacility.name}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:bg-white hover:bg-opacity-20 p-2 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Nearby Facilities Detected
            </h3>
          </div>

          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            {nearbyFacilities.length === 1
              ? 'There is 1 facility'
              : `There are ${nearbyFacilities.length} facilities`}{' '}
            within 200 meters. Would you like to view one?
          </p>

          <div className="space-y-2 max-h-80 overflow-y-auto">
            {nearbyFacilities.map(({ facility, distance }) => (
              <button
                key={facility.id}
                onClick={() => onSelectFacility(facility)}
                className="w-full flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900 border-2 border-gray-200 dark:border-gray-600 hover:border-blue-500 rounded-lg transition-colors text-left group"
              >
                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-800 group-hover:bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors">
                  <Navigation className="w-5 h-5 text-blue-600 dark:text-blue-300 group-hover:text-white transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white truncate">
                    {facility.name}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {formatDistanceWithFeet(distance)} away
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                    {Number(facility.latitude).toFixed(6)},{' '}
                    {Number(facility.longitude).toFixed(6)}
                  </p>
                </div>
                <div className="text-blue-600 dark:text-blue-400 group-hover:text-blue-700 dark:group-hover:text-blue-300">
                  <Navigation className="w-5 h-5" />
                </div>
              </button>
            ))}
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg font-medium transition-colors"
            >
              No Thanks
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
