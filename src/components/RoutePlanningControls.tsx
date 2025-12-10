import { useState, useEffect } from 'react';
import { Settings, Clock, MapPin } from 'lucide-react';
import { supabase, UserSettings } from '../lib/supabase';

interface RoutePlanningControlsProps {
  userId: string;
  onGenerate: (settings: UserSettings) => void;
  onVisitDurationChange: (duration: number) => void;
  isGenerating: boolean;
  disabled?: boolean;
  lastUsedSettings?: UserSettings | null;
}

export default function RoutePlanningControls({
  userId,
  onGenerate,
  onVisitDurationChange,
  isGenerating,
  disabled = false,
  lastUsedSettings,
}: RoutePlanningControlsProps) {
  const [settings, setSettings] = useState<UserSettings>({
    id: '',
    user_id: userId,
    max_facilities_per_day: 8,
    max_hours_per_day: 8,
    default_visit_duration_minutes: 30,
    use_facilities_constraint: true,
    use_hours_constraint: true,
    updated_at: '',
  });

  useEffect(() => {
    // If lastUsedSettings is provided, use that instead of loading from database
    if (lastUsedSettings) {
      setSettings(lastUsedSettings);
    } else {
      loadSettings();
    }
  }, [userId, lastUsedSettings]);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('account_id', userId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettings({
          ...data,
          max_hours_per_day: Number(data.max_hours_per_day),
        });
      } else {
        const defaultSettings = {
          user_id: userId,
          account_id: userId,
          max_facilities_per_day: 8,
          max_hours_per_day: 8,
          default_visit_duration_minutes: 30,
          use_facilities_constraint: true,
          use_hours_constraint: true,
        };

        const { data: newSettings, error: insertError } = await supabase
          .from('user_settings')
          .upsert(defaultSettings, {
            onConflict: 'account_id',
            ignoreDuplicates: false,
          })
          .select()
          .single();

        if (insertError && insertError.code !== '23505') throw insertError;

        if (newSettings) {
          setSettings({
            ...newSettings,
            max_hours_per_day: Number(newSettings.max_hours_per_day),
          });
        } else {
          setSettings({
            id: '',
            ...defaultSettings,
            updated_at: '',
          });
        }
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    }
  };

  const handleSaveSettings = async () => {
    try {
      const { error } = await supabase
        .from('user_settings')
        .update({
          max_facilities_per_day: settings.max_facilities_per_day,
          max_hours_per_day: settings.max_hours_per_day,
          default_visit_duration_minutes: settings.default_visit_duration_minutes,
          use_facilities_constraint: settings.use_facilities_constraint,
          use_hours_constraint: settings.use_hours_constraint,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', userId);

      if (error) throw error;
    } catch (err) {
      console.error('Error saving settings:', err);
    }
  };

  const handleGenerate = async () => {
    await handleSaveSettings();
    onGenerate(settings);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 transition-colors duration-200">
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Generate Routes</h2>
      </div>

      <div className="space-y-4">
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4 transition-colors duration-200">
          <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-3">Current Settings</h3>
          <div className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
            <div className="flex justify-between">
              <span>Visit Duration:</span>
              <span className="font-medium">{settings.default_visit_duration_minutes} mins</span>
            </div>
            <div className="flex justify-between">
              <span>Max Facilities/Day:</span>
              <span className="font-medium">
                {settings.use_facilities_constraint ? settings.max_facilities_per_day : 'Unlimited'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Max Hours/Day:</span>
              <span className="font-medium">
                {settings.use_hours_constraint ? `${settings.max_hours_per_day}h` : 'Unlimited'}
              </span>
            </div>
          </div>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('navigate-to-settings'))}
            className="mt-3 text-xs text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100 underline font-medium"
          >
            Change settings →
          </button>
        </div>

        <button
          onClick={handleGenerate}
          disabled={disabled || isGenerating}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
        >
          {isGenerating ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              Generating Routes...
            </>
          ) : (
            <>
              <MapPin className="w-5 h-5" />
              Generate Optimized Routes
            </>
          )}
        </button>
      </div>
    </div>
  );
}
