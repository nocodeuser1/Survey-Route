import { useState, useEffect } from 'react';
import { Clock, MapPin, ChevronDown, ChevronUp, RefreshCw, Zap } from 'lucide-react';
import { supabase, UserSettings } from '../lib/supabase';
import { convertTo12Hour } from '../utils/timeFormat';

interface RoutePlanningSettingsProps {
  accountId: string;
  authUserId: string;
  onVisitDurationChange?: (duration: number) => void;
  onApplyWithTimeRefresh?: () => void;
  onApplyWithFullOptimization?: () => void;
}

export default function RoutePlanningSettings({ accountId, authUserId, onVisitDurationChange, onApplyWithTimeRefresh, onApplyWithFullOptimization }: RoutePlanningSettingsProps) {
  const [settings, setSettings] = useState<UserSettings>({
    id: '',
    user_id: accountId,
    max_facilities_per_day: 8,
    max_hours_per_day: 8,
    default_visit_duration_minutes: 30,
    use_facilities_constraint: true,
    use_hours_constraint: true,
    clustering_tightness: 0.5,
    cluster_balance_weight: 0.5,
    start_time: '08:00',
    team_count: 1,
    updated_at: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

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
          max_hours_per_day: Number(data.max_hours_per_day),
          clustering_tightness: data.clustering_tightness ?? 0.5,
          cluster_balance_weight: data.cluster_balance_weight ?? 0.5,
          start_time: data.start_time ?? '08:00',
          team_count: data.team_count ?? 1,
        });
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    }
  };

  const saveSettingsToDb = async () => {
    const { error } = await supabase
      .from('user_settings')
      .upsert({
        user_id: authUserId,
        account_id: accountId,
        max_facilities_per_day: settings.max_facilities_per_day,
        max_hours_per_day: settings.max_hours_per_day,
        default_visit_duration_minutes: settings.default_visit_duration_minutes,
        use_facilities_constraint: settings.use_facilities_constraint,
        use_hours_constraint: settings.use_hours_constraint,
        clustering_tightness: settings.clustering_tightness,
        cluster_balance_weight: settings.cluster_balance_weight,
        start_time: settings.start_time,
        sunset_offset_minutes: settings.sunset_offset_minutes ?? 0,
        auto_refresh_route: settings.auto_refresh_route ?? false,
        exclude_completed_facilities: settings.exclude_completed_facilities ?? false,
        exclude_externally_completed: settings.exclude_externally_completed ?? false,
        team_count: settings.team_count,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'account_id',
        ignoreDuplicates: false,
      });

    if (error) throw error;
  };

  const handleApplyAndRefreshTimes = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      await saveSettingsToDb();
      if (onApplyWithTimeRefresh) {
        onApplyWithTimeRefresh();
      }
    } catch (err: any) {
      const errorMsg = err.message || JSON.stringify(err);
      console.error('Error saving settings:', err);
      setSaveMessage(`Failed to save settings: ${errorMsg}`);
      setIsSaving(false);
    }
  };

  const handleApplyAndReoptimize = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      await saveSettingsToDb();
      if (onApplyWithFullOptimization) {
        onApplyWithFullOptimization();
      }
    } catch (err: any) {
      const errorMsg = err.message || JSON.stringify(err);
      console.error('Error saving settings:', err);
      setSaveMessage(`Failed to save settings: ${errorMsg}`);
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-2">
          <Clock className="inline w-4 h-4 mr-1" />
          Route Start Time
        </label>
        <input
          type="time"
          value={settings.start_time || '08:00'}
          onChange={(e) => {
            setSettings({
              ...settings,
              start_time: e.target.value,
            });
          }}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Time when daily routes should begin (displayed as {convertTo12Hour(settings.start_time || '08:00')})
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-2">
          <Clock className="inline w-4 h-4 mr-1" />
          Default Visit Duration (minutes)
        </label>
        <input
          type="number"
          min="5"
          max="480"
          value={settings.default_visit_duration_minutes}
          onChange={(e) => {
            const newDuration = parseInt(e.target.value) || 30;
            setSettings({
              ...settings,
              default_visit_duration_minutes: newDuration,
            });
            if (onVisitDurationChange) {
              onVisitDurationChange(newDuration);
            }
          }}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Applied to newly imported facilities
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-2">
          <Clock className="inline w-4 h-4 mr-1" />
          Sunset Time Offset (minutes)
        </label>
        <input
          type="number"
          min="-120"
          max="120"
          value={settings.sunset_offset_minutes ?? 0}
          onChange={(e) => {
            setSettings({
              ...settings,
              sunset_offset_minutes: parseInt(e.target.value) || 0,
            });
          }}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Adjust sunset time for route indicators (positive = later, negative = earlier)
        </p>
      </div>

      <div className="border-t dark:border-gray-700 pt-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.auto_refresh_route ?? false}
            onChange={(e) => {
              setSettings({
                ...settings,
                auto_refresh_route: e.target.checked,
              });
            }}
            className="w-4 h-4 text-blue-600 rounded"
          />
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200">
              Refresh Route When Updating Facilities
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              When checked, updating facility durations will recalculate routes. When unchecked, only times are updated while keeping facilities on their assigned days.
            </div>
          </div>
        </label>
      </div>

      <div className="border-t dark:border-gray-700 pt-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.exclude_completed_facilities ?? false}
            onChange={(e) => {
              setSettings({
                ...settings,
                exclude_completed_facilities: e.target.checked,
              });
            }}
            className="w-4 h-4 text-blue-600 rounded"
          />
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200">
              Ignore Completed Facilities
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              When checked, facilities with completed inspections or marked as internally completed will not be included in route optimization.
            </div>
          </div>
        </label>
      </div>

      <div className="border-t dark:border-gray-700 pt-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.exclude_externally_completed ?? false}
            onChange={(e) => {
              setSettings({
                ...settings,
                exclude_externally_completed: e.target.checked,
              });
            }}
            className="w-4 h-4 text-blue-600 rounded"
          />
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200">
              Ignore Externally Completed Facilities
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              When checked, facilities marked as externally completed will not be included in route optimization. This setting works independently from the above option.
            </div>
          </div>
        </label>
      </div>

      <div className="border-t dark:border-gray-700 pt-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-2">
          <MapPin className="inline w-4 h-4 mr-1" />
          Number of Field Teams
        </label>
        <select
          value={settings.team_count || 1}
          onChange={(e) => {
            setSettings({
              ...settings,
              team_count: parseInt(e.target.value) || 1,
            });
          }}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200"
        >
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
            <option key={num} value={num}>
              {num} {num === 1 ? 'Team' : 'Teams'}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Optimized routes will be distributed across this many teams. Each team will see only their assigned facilities.
        </p>
      </div>

      <div className="border-t dark:border-gray-700 pt-6">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-4">Daily Constraints</h4>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="settings-use-facilities"
              checked={settings.use_facilities_constraint}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  use_facilities_constraint: e.target.checked,
                })
              }
              className="mt-1 w-4 h-4 text-blue-600 rounded"
            />
            <div className="flex-1">
              <label htmlFor="settings-use-facilities" className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 cursor-pointer">
                <MapPin className="inline w-4 h-4 mr-1" />
                Maximum Facilities Per Day
              </label>
              <input
                type="number"
                min="1"
                max="50"
                value={settings.max_facilities_per_day}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    max_facilities_per_day: parseInt(e.target.value) || 8,
                  })
                }
                disabled={!settings.use_facilities_constraint}
                className="w-full mt-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-800 transition-colors duration-200"
              />
            </div>
          </div>

          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="settings-use-hours"
              checked={settings.use_hours_constraint}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  use_hours_constraint: e.target.checked,
                })
              }
              className="mt-1 w-4 h-4 text-blue-600 rounded"
            />
            <div className="flex-1">
              <label htmlFor="settings-use-hours" className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 cursor-pointer">
                <Clock className="inline w-4 h-4 mr-1" />
                Maximum Hours Per Day
              </label>
              <input
                type="number"
                min="1"
                max="24"
                step="0.5"
                value={settings.max_hours_per_day}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    max_hours_per_day: parseFloat(e.target.value) || 8,
                  })
                }
                disabled={!settings.use_hours_constraint}
                className="w-full mt-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-800 transition-colors duration-200"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="border-t dark:border-gray-700 pt-6">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center justify-between w-full text-left mb-4 hover:text-blue-600 transition-colors"
        >
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200">Advanced Route Optimization</h4>
          {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showAdvanced && (
          <div className="space-y-6">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4 transition-colors duration-200">
              <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
                <strong>How it works:</strong> Routes are optimized by grouping nearby facilities together into geographic clusters, then creating daily routes within each area.
              </p>
              <p className="text-sm text-blue-800 dark:text-blue-200 mt-2">
                <strong>Tightness:</strong> Controls how strictly facilities must be near each other. Higher = visits facilities in tight loops within areas.<br/>
                <strong>Balance:</strong> Controls whether to keep geographic groups intact or split them for even day sizes.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-2">
                Geographic Clustering Tightness: {((settings.clustering_tightness ?? 0.5) * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={settings.clustering_tightness ?? 0.5}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    clustering_tightness: parseFloat(e.target.value),
                  })
                }
                className="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer transition-colors duration-200"
              />
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                <span>Looser (0%)</span>
                <span>Balanced (50%)</span>
                <span>Tighter (100%)</span>
              </div>
              <p className="text-xs text-gray-600 mt-2">
                <strong>Recommended: 70-80%</strong> - Higher values prevent long straight-line routes. Routes will loop through geographic areas instead of passing by nearby facilities.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-2">
                Cluster Balance Weight: {((settings.cluster_balance_weight ?? 0.5) * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={settings.cluster_balance_weight ?? 0.5}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    cluster_balance_weight: parseFloat(e.target.value),
                  })
                }
                className="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer transition-colors duration-200"
              />
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                <span>Geography Priority (0%)</span>
                <span>Balanced (50%)</span>
                <span>Even Days Priority (100%)</span>
              </div>
              <p className="text-xs text-gray-600 mt-2">
                <strong>Recommended: 30-40%</strong> - Lower values keep geographic areas together (better for tight routes). Higher values split areas to balance day sizes.
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-4 transition-colors duration-200">
              <h5 className="text-sm font-semibold text-gray-800 dark:text-white mb-2">Quick Presets</h5>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() =>
                    setSettings({
                      ...settings,
                      clustering_tightness: 0.8,
                      cluster_balance_weight: 0.3,
                    })
                  }
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium"
                >
                  Tight Geographic Loops (Recommended)
                </button>
                <button
                  onClick={() =>
                    setSettings({
                      ...settings,
                      clustering_tightness: 0.5,
                      cluster_balance_weight: 0.5,
                    })
                  }
                  className="px-3 py-1 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  Balanced
                </button>
                <button
                  onClick={() =>
                    setSettings({
                      ...settings,
                      clustering_tightness: 0.3,
                      cluster_balance_weight: 0.8,
                    })
                  }
                  className="px-3 py-1 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  Even Day Sizes
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="pt-6 space-y-3">
        <div className="bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-200 dark:text-gray-200 transition-colors duration-200">
          <p className="font-medium text-blue-900 dark:text-blue-200 mb-1">Choose how to apply settings:</p>
          <ul className="space-y-1 text-xs">
            <li className="flex items-start gap-2">
              <RefreshCw className="w-3 h-3 mt-0.5 text-blue-600 flex-shrink-0" />
              <span><strong>Refresh Times:</strong> Update times while keeping current route assignments</span>
            </li>
            <li className="flex items-start gap-2">
              <Zap className="w-3 h-3 mt-0.5 text-green-600 flex-shrink-0" />
              <span><strong>Re-optimize:</strong> Completely rebuild route for best optimization</span>
            </li>
          </ul>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={handleApplyAndRefreshTimes}
            disabled={isSaving}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium text-sm"
            title="Apply settings and refresh route times without reassigning facilities to different days"
          >
            <RefreshCw className="w-4 h-4" />
            {isSaving ? 'Applying...' : 'Apply & Refresh Times'}
          </button>
          <button
            onClick={handleApplyAndReoptimize}
            disabled={isSaving}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium text-sm"
            title="Apply settings and fully re-optimize route, reassigning facilities for best results"
          >
            <Zap className="w-4 h-4" />
            {isSaving ? 'Applying...' : 'Apply & Re-optimize'}
          </button>
        </div>

        {saveMessage && (
          <p className={`mt-2 text-sm text-center font-medium ${saveMessage.includes('success') || saveMessage.includes('refreshing') || saveMessage.includes('optimizing') ? 'text-green-600' : 'text-red-600'}`}>
            {saveMessage}
          </p>
        )}
      </div>
    </div>
  );
}
