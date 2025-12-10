import { useState } from 'react';
import { Navigation, MapPin, Globe, Copy, Check } from 'lucide-react';

interface NavigationPopupProps {
  latitude: number;
  longitude: number;
  facilityName: string;
  mapPreference: 'google' | 'apple';
  includeGoogleEarth: boolean;
  onClose: () => void;
  onShowOnMap?: () => void;
}

export default function NavigationPopup({
  latitude,
  longitude,
  facilityName,
  mapPreference,
  includeGoogleEarth,
  onClose,
  onShowOnMap,
}: NavigationPopupProps) {
  const [showCopyPrompt, setShowCopyPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const openGoogleMaps = () => {
    window.open(`https://maps.google.com/?q=${latitude},${longitude}`, '_blank');
    onClose();
  };

  const openAppleMaps = () => {
    window.open(`http://maps.apple.com/?daddr=${latitude},${longitude}`, '_blank');
    onClose();
  };

  const openGoogleEarth = () => {
    setShowCopyPrompt(true);
  };

  const copyCoordinates = async () => {
    const coords = `${latitude},${longitude}`;
    try {
      await navigator.clipboard.writeText(coords);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy coordinates:', err);
      alert(`Copy failed. Coordinates: ${coords}`);
    }
  };

  const proceedToGoogleEarth = () => {
    window.open(`https://earth.google.com/web/search/${latitude},${longitude}`, '_blank');
    setShowCopyPrompt(false);
    onClose();
  };

  const preferredMapLabel = mapPreference === 'google' ? 'Google Maps' : 'Apple Maps';
  const preferredMapIcon = <MapPin className="w-5 h-5" />;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h3 className="text-lg font-semibold mb-2">Navigate to</h3>
        <p className="text-sm text-gray-600 mb-4">{facilityName}</p>

        <div className="space-y-2">
          {/* Show on App Map */}
          {onShowOnMap && (
            <button
              onClick={() => {
                onShowOnMap();
                onClose();
              }}
              className="w-full flex items-center gap-3 p-4 border-2 border-green-600 bg-green-50 rounded-lg hover:bg-green-100 transition-colors text-left"
            >
              <MapPin className="w-5 h-5 text-green-600" />
              <div className="flex-1">
                <div className="font-semibold text-gray-900 dark:text-white">Show on App Map</div>
                <div className="text-xs text-gray-600">View in route map view</div>
              </div>
            </button>
          )}

          {/* Preferred Map */}
          <button
            onClick={mapPreference === 'google' ? openGoogleMaps : openAppleMaps}
            className="w-full flex items-center gap-3 p-4 border-2 border-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors text-left"
          >
            {preferredMapIcon}
            <div className="flex-1">
              <div className="font-semibold text-gray-900 dark:text-white">{preferredMapLabel}</div>
              <div className="text-xs text-gray-600">Your preferred map app</div>
            </div>
          </button>

          {/* Google Earth */}
          {includeGoogleEarth && !showCopyPrompt && (
            <button
              onClick={openGoogleEarth}
              className="w-full flex items-center gap-3 p-4 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-left"
            >
              <Globe className="w-5 h-5 text-green-600" />
              <div className="flex-1">
                <div className="font-semibold text-gray-900 dark:text-white">Google Earth</div>
                <div className="text-xs text-gray-600">View in 3D satellite</div>
              </div>
            </button>
          )}

          {/* Google Earth Copy Prompt */}
          {includeGoogleEarth && showCopyPrompt && (
            <div className="p-4 border-2 border-green-600 bg-green-50 rounded-lg">
              <div className="flex items-start gap-3 mb-3">
                <Globe className="w-5 h-5 text-green-600 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold text-gray-900 dark:text-white mb-1">Opening Google Earth</div>
                  <div className="text-sm text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-2">
                    Coordinates: <span className="font-mono">{latitude},{longitude}</span>
                  </div>
                  <div className="text-xs text-gray-600">
                    Would you like to copy these coordinates to your clipboard first?
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={copyCoordinates}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    copied
                      ? 'bg-green-600 text-white'
                      : 'bg-white border-2 border-green-600 text-green-700 hover:bg-green-50'
                  }`}
                  disabled={copied}
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy
                    </>
                  )}
                </button>
                <button
                  onClick={proceedToGoogleEarth}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  Continue to Google Earth
                </button>
              </div>
              <button
                onClick={() => setShowCopyPrompt(false)}
                className="w-full mt-2 text-sm text-gray-600 hover:text-gray-800 dark:text-white"
              >
                Back
              </button>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="w-full mt-4 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
