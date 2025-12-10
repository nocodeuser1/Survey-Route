import { useState, useEffect } from 'react';
import { Calendar, Clock, CheckCircle, AlertTriangle } from 'lucide-react';
import { supabase, UserSettings } from '../lib/supabase';

interface ReportDisplaySettingsProps {
  userId: string;
  accountId: string;
}

export default function ReportDisplaySettings({ userId, accountId }: ReportDisplaySettingsProps) {
  const [hideReportTimestamps, setHideReportTimestamps] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadSettings();
  }, [accountId]);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('user_settings')
        .select('hide_report_timestamps')
        .eq('account_id', accountId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setHideReportTimestamps(data.hide_report_timestamps || false);
      }
    } catch (err) {
      console.error('Error loading report display settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const { error } = await supabase
        .from('user_settings')
        .upsert({
          account_id: accountId,
          user_id: userId,
          hide_report_timestamps: hideReportTimestamps,
        }, {
          onConflict: 'account_id'
        });

      if (error) throw error;

      setSaveMessage({ type: 'success', text: 'Report display settings saved successfully!' });

      setTimeout(() => {
        setSaveMessage(null);
      }, 3000);
    } catch (err: any) {
      console.error('Error saving report display settings:', err);
      setSaveMessage({ type: 'error', text: err.message || 'Failed to save settings' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Report Display Settings</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Control how timestamps appear on inspection reports throughout the application
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="space-y-6">
          <div>
            <h4 className="text-base font-medium text-gray-900 dark:text-white mb-4">Timestamp Display</h4>

            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="hideReportTimestamps"
                checked={hideReportTimestamps}
                onChange={(e) => setHideReportTimestamps(e.target.checked)}
                className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <div className="flex-1">
                <label htmlFor="hideReportTimestamps" className="text-sm font-medium text-gray-900 dark:text-white cursor-pointer">
                  Show date only on reports (hide time)
                </label>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  When enabled, inspection reports will display only the date without the time. This applies to all report views and exports.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-3">
              <Calendar className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Preview</span>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600 dark:text-gray-400">Current format:</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {hideReportTimestamps
                    ? new Date().toLocaleDateString()
                    : `${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
                  }
                </span>
              </div>
            </div>
          </div>

          {saveMessage && (
            <div className={`p-4 rounded-lg flex items-start gap-3 ${
              saveMessage.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
            }`}>
              {saveMessage.type === 'success' ? (
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              )}
              <span className={`text-sm ${
                saveMessage.type === 'success'
                  ? 'text-green-800 dark:text-green-200'
                  : 'text-red-800 dark:text-red-200'
              }`}>
                {saveMessage.text}
              </span>
            </div>
          )}

          <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleSaveSettings}
              disabled={isSaving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Saving...
                </>
              ) : (
                'Save Settings'
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex gap-3">
          <div className="flex-shrink-0">
            <Calendar className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="text-sm text-blue-800 dark:text-blue-200">
            <p className="font-medium mb-1">About Timestamp Display</p>
            <p>
              This setting controls how timestamps appear on all inspection reports, including:
              report previews, exports, and printed documents. The setting is applied site-wide
              to ensure consistency across all report views.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
