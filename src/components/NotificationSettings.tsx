import { useState, useEffect } from 'react';
import { Bell, Mail, Clock, Users, Save, AlertCircle, CheckCircle, AlertTriangle } from 'lucide-react';
import { supabase, NotificationPreferences } from '../lib/supabase';

interface NotificationSettingsProps {
  userId: string;
  accountId: string;
}

const DEFAULT_REMINDER_DAYS = [30, 14, 7, 1];

export default function NotificationSettings({ userId, accountId }: NotificationSettingsProps) {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [customDays, setCustomDays] = useState('');

  useEffect(() => {
    loadPreferences();
  }, [userId, accountId]);

  const loadPreferences = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .eq('account_id', accountId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setPreferences(data);
      } else {
        const defaultPrefs: Partial<NotificationPreferences> = {
          user_id: userId,
          account_id: accountId,
          receive_spcc_reminders: true,
          receive_inspection_reminders: true,
          reminder_days_before: DEFAULT_REMINDER_DAYS,
          email_enabled: true,
          in_app_enabled: true,
          daily_digest_enabled: false,
          daily_digest_time: '08:00:00',
          notify_for_team_only: false,
        };
        setPreferences(defaultPrefs as NotificationPreferences);
      }
    } catch (error) {
      console.error('Error loading preferences:', error);
      setMessage({ type: 'error', text: 'Failed to load notification preferences' });
    } finally {
      setLoading(false);
    }
  };

  const savePreferences = async () => {
    if (!preferences) return;

    try {
      setSaving(true);
      setMessage(null);

      const updateData: any = {
        user_id: userId,
        account_id: accountId,
        receive_spcc_reminders: preferences.receive_spcc_reminders,
        receive_inspection_reminders: preferences.receive_inspection_reminders,
        reminder_days_before: preferences.reminder_days_before,
        email_enabled: preferences.email_enabled,
        in_app_enabled: preferences.in_app_enabled,
        daily_digest_enabled: preferences.daily_digest_enabled,
        daily_digest_time: preferences.daily_digest_time,
        notify_for_team_only: preferences.notify_for_team_only,
      };

      // If user is re-enabling emails and was previously unsubscribed, clear unsubscribe flags
      if (preferences.email_enabled && (preferences as any).email_unsubscribed) {
        updateData.email_unsubscribed = false;
        updateData.unsubscribed_at = null;
      }

      const { error } = await supabase
        .from('notification_preferences')
        .upsert(updateData, {
          onConflict: 'user_id,account_id'
        });

      if (error) throw error;

      setMessage({ type: 'success', text: 'Notification preferences saved successfully' });
      setTimeout(() => setMessage(null), 3000);

      // Reload preferences to get updated state
      await loadPreferences();
    } catch (error) {
      console.error('Error saving preferences:', error);
      setMessage({ type: 'error', text: 'Failed to save preferences' });
    } finally {
      setSaving(false);
    }
  };

  const toggleReminderDay = (day: number) => {
    if (!preferences) return;

    const currentDays = preferences.reminder_days_before || [];
    const newDays = currentDays.includes(day)
      ? currentDays.filter(d => d !== day)
      : [...currentDays, day].sort((a, b) => b - a);

    setPreferences({ ...preferences, reminder_days_before: newDays });
  };

  const addCustomReminderDay = () => {
    if (!preferences) return;

    const day = parseInt(customDays);
    if (isNaN(day) || day <= 0 || day > 365) {
      setMessage({ type: 'error', text: 'Please enter a valid number of days (1-365)' });
      return;
    }

    const currentDays = preferences.reminder_days_before || [];
    if (currentDays.includes(day)) {
      setMessage({ type: 'error', text: 'This reminder day is already added' });
      return;
    }

    const newDays = [...currentDays, day].sort((a, b) => b - a);
    setPreferences({ ...preferences, reminder_days_before: newDays });
    setCustomDays('');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!preferences) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg">
        Failed to load notification preferences
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {message && (
        <div className={`p-4 rounded-lg flex items-center gap-2 ${
          message.type === 'success'
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
        }`}>
          {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <span>{message.text}</span>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Bell className="w-5 h-5" />
          Notification Types
        </h3>

        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.receive_spcc_reminders}
              onChange={(e) => setPreferences({ ...preferences, receive_spcc_reminders: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <div className="font-medium">SPCC Compliance Reminders</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Receive notifications for SPCC plan due dates and renewals
              </div>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.receive_inspection_reminders}
              onChange={(e) => setPreferences({ ...preferences, receive_inspection_reminders: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <div className="font-medium">Inspection Due Date Reminders</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Receive notifications for upcoming facility inspections
              </div>
            </div>
          </label>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5" />
          Reminder Timing
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Send reminders this many days before due date:
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
              {[30, 14, 7, 3, 1].map(day => (
                <button
                  key={day}
                  onClick={() => toggleReminderDay(day)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    preferences.reminder_days_before?.includes(day)
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {day} day{day !== 1 ? 's' : ''}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                max="365"
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                placeholder="Custom days"
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
              <button
                onClick={addCustomReminderDay}
                disabled={!customDays}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>

            {preferences.reminder_days_before && preferences.reminder_days_before.length > 0 && (
              <div className="mt-3 text-sm text-gray-600 dark:text-gray-400">
                Active reminders: {preferences.reminder_days_before.sort((a, b) => b - a).join(', ')} days before
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Mail className="w-5 h-5" />
          Delivery Methods
        </h3>

        <div className="space-y-4">
          {(preferences as any).email_unsubscribed && (
            <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium text-yellow-800 dark:text-yellow-200 mb-1">
                    Email Notifications Disabled
                  </div>
                  <div className="text-sm text-yellow-700 dark:text-yellow-300 mb-2">
                    You previously unsubscribed from all email notifications.
                    {(preferences as any).unsubscribed_at && (
                      <span className="block mt-1">
                        Unsubscribed on: {new Date((preferences as any).unsubscribed_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-yellow-700 dark:text-yellow-300 mb-3">
                    To receive email notifications again, enable "Email Notifications" below and save your preferences.
                  </div>
                </div>
              </div>
            </div>
          )}

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.email_enabled}
              onChange={(e) => setPreferences({ ...preferences, email_enabled: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <div className="font-medium">Email Notifications</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {(preferences as any).email_unsubscribed
                  ? 'Re-enable email notifications (you will need to save to confirm)'
                  : 'Send reminders to your email address'}
              </div>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.in_app_enabled}
              onChange={(e) => setPreferences({ ...preferences, in_app_enabled: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <div className="font-medium">In-App Notifications</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Show notifications in the application
              </div>
            </div>
          </label>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={preferences.daily_digest_enabled}
                onChange={(e) => setPreferences({ ...preferences, daily_digest_enabled: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1">
                <div className="font-medium">Daily Digest Email</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Receive a single daily summary of all upcoming items
                </div>
              </div>
            </label>

            {preferences.daily_digest_enabled && (
              <div className="mt-3 ml-7">
                <label className="block text-sm font-medium mb-1">Send daily digest at:</label>
                <input
                  type="time"
                  value={preferences.daily_digest_time?.substring(0, 5) || '08:00'}
                  onChange={(e) => setPreferences({ ...preferences, daily_digest_time: e.target.value + ':00' })}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Users className="w-5 h-5" />
          Notification Scope
        </h3>

        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.notify_for_team_only}
              onChange={(e) => setPreferences({ ...preferences, notify_for_team_only: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <div className="font-medium">Only notify for my team's facilities</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Only receive notifications for facilities assigned to your team
              </div>
            </div>
          </label>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={savePreferences}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Preferences'}
        </button>
      </div>
    </div>
  );
}
