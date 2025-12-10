import { useState, useEffect } from 'react';
import { supabase, UserSettings } from '../lib/supabase';

interface NavigationSettingsProps {
  accountId: string;
  authUserId: string;
}

export default function NavigationSettings({ accountId, authUserId }: NavigationSettingsProps) {
  const [settings, setSettings] = useState<UserSettings>({
    id: '',
    user_id: accountId,
    map_preference: 'google_maps',
    include_google_earth: false,
    speed_unit: 'mph',
    map_rotation_sensitivity: 0.7,
    show_road_routes: false,
    dark_mode: false,
    updated_at: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, [accountId]);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('account_id', accountId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettings({
          ...data,
          speed_unit: data.speed_unit ?? 'mph',
          map_rotation_sensitivity: data.map_rotation_sensitivity ?? 0.7,
          show_road_routes: data.show_road_routes ?? false,
          dark_mode: data.dark_mode ?? false,
        });
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const { error } = await supabase
        .from('user_settings')
        .upsert({
          user_id: authUserId,
          account_id: accountId,
          map_preference: settings.map_preference,
          include_google_earth: settings.include_google_earth,
          speed_unit: settings.speed_unit,
          map_rotation_sensitivity: settings.map_rotation_sensitivity,
          show_road_routes: settings.show_road_routes,
          dark_mode: settings.dark_mode,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'account_id',
          ignoreDuplicates: false,
        });

      if (error) throw error;

      setSaveMessage('Settings saved successfully!');
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err: any) {
      const errorMsg = err.message || JSON.stringify(err);
      console.error('Error saving settings:', err);
      setSaveMessage(`Failed to save settings: ${errorMsg}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-4">Navigation App Preference</h4>
        <div className="space-y-2">
          <label className="flex items-center gap-3 p-3 border border-gray-300 dark:border-gray-600 rounded-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 bg-white dark:bg-gray-800 transition-colors duration-200">
            <input
              type="radio"
              name="map-preference"
              value="google_maps"
              checked={settings.map_preference === 'google_maps' || settings.map_preference === 'google'}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  map_preference: 'google_maps' as any,
                })
              }
              className="w-4 h-4 text-blue-600"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200">Google Maps</span>
          </label>
          <label className="flex items-center gap-3 p-3 border border-gray-300 dark:border-gray-600 rounded-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 bg-white dark:bg-gray-800 transition-colors duration-200">
            <input
              type="radio"
              name="map-preference"
              value="apple_maps"
              checked={settings.map_preference === 'apple_maps' || settings.map_preference === 'apple'}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  map_preference: 'apple_maps' as any,
                })
              }
              className="w-4 h-4 text-blue-600"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200">Apple Maps</span>
          </label>
        </div>

        <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-md transition-colors duration-200">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.include_google_earth}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  include_google_earth: e.target.checked,
                })
              }
              className="mt-0.5 w-4 h-4 text-blue-600 rounded"
            />
            <div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200">Include Google Earth</span>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                Show Google Earth as an additional navigation option
              </p>
            </div>
          </label>
        </div>
      </div>

      <div className="border-t dark:border-gray-700 pt-6">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-4">Map Display Options</h4>
        <div className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer p-3 bg-gray-50 dark:bg-gray-700 rounded-md transition-colors duration-200">
            <input
              type="checkbox"
              checked={settings.show_road_routes ?? false}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  show_road_routes: e.target.checked,
                })
              }
              className="mt-0.5 w-4 h-4 text-blue-600 rounded"
            />
            <div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200">Show Road Routes</span>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                Display road-based routing paths on the map instead of straight lines
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer p-3 bg-gray-50 dark:bg-gray-700 rounded-md transition-colors duration-200">
            <input
              type="checkbox"
              checked={settings.dark_mode ?? false}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  dark_mode: e.target.checked,
                })
              }
              className="mt-0.5 w-4 h-4 text-blue-600 rounded"
            />
            <div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200">Dark Mode Map</span>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                Use dark theme for map tiles (easier on eyes in low light)
              </p>
            </div>
          </label>
        </div>
      </div>

      <div className="border-t dark:border-gray-700 pt-6">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-4">Driving Mode Settings</h4>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-2">
              Speed Unit
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 border border-gray-300 dark:border-gray-600 rounded-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 bg-white dark:bg-gray-800 transition-colors duration-200">
                <input
                  type="radio"
                  name="speed-unit"
                  value="mph"
                  checked={settings.speed_unit === 'mph' || !settings.speed_unit}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      speed_unit: e.target.value as 'mph' | 'kmh',
                    })
                  }
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200">Miles per Hour (MPH)</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-gray-300 dark:border-gray-600 rounded-md cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 bg-white dark:bg-gray-800 transition-colors duration-200">
                <input
                  type="radio"
                  name="speed-unit"
                  value="kmh"
                  checked={settings.speed_unit === 'kmh'}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      speed_unit: e.target.value as 'mph' | 'kmh',
                    })
                  }
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200">Kilometers per Hour (KM/H)</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-2">
              Map Rotation Sensitivity: {((settings.map_rotation_sensitivity ?? 0.7) * 100).toFixed(0)}%
            </label>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.1"
              value={settings.map_rotation_sensitivity ?? 0.7}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  map_rotation_sensitivity: parseFloat(e.target.value),
                })
              }
              className="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer transition-colors duration-200"
            />
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
              <span>Smooth (10%)</span>
              <span>Balanced (70%)</span>
              <span>Responsive (100%)</span>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
              Controls how quickly the map rotates based on your heading in navigation mode
            </p>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg p-4 transition-colors duration-200">
            <h5 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">About Driving Mode</h5>
            <p className="text-xs text-blue-800 dark:text-blue-200">
              When enabled in full-screen map view, Driving Mode provides:
            </p>
            <ul className="list-disc list-inside text-xs text-blue-800 dark:text-blue-200 mt-2 space-y-1 ml-2">
              <li>GPS speed display in real-time</li>
              <li>Map rotation based on your heading direction</li>
              <li>Faster location updates (0.5s)</li>
              <li>Auto-centering on your current location</li>
              <li>Next facility navigation button</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="pt-6 border-t">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
        >
          {isSaving ? 'Saving...' : 'Save Navigation Settings'}
        </button>

        {saveMessage && (
          <p className={`mt-3 text-sm text-center font-medium ${saveMessage.includes('success') ? 'text-green-600' : 'text-red-600'}`}>
            {saveMessage}
          </p>
        )}
      </div>
    </div>
  );
}
