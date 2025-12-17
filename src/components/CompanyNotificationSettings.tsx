import { useState, useEffect } from 'react';
import { Bell, Save, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface CompanyNotificationSettingsProps {
    accountId: string;
}

interface CompanySettings {
    spcc_plan_creation_reminders: number[];
    spcc_plan_renewal_reminders: number[];
    spcc_annual_inspection_reminders: number[];
}

const AVAILABLE_INTERVALS = [90, 60, 30, 15, 7, 3, 1];

export default function CompanyNotificationSettings({ accountId }: CompanyNotificationSettingsProps) {
    const [settings, setSettings] = useState<CompanySettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        loadSettings();
    }, [accountId]);

    const loadSettings = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('company_notification_settings')
                .select('*')
                .eq('account_id', accountId)
                .maybeSingle();

            if (error) throw error;

            if (data) {
                setSettings(data);
            } else {
                // Default settings
                setSettings({
                    spcc_plan_creation_reminders: [60, 30, 15, 1],
                    spcc_plan_renewal_reminders: [60, 30, 15, 1],
                    spcc_annual_inspection_reminders: [30, 14, 7, 1],
                });
            }
        } catch (error) {
            console.error('Error loading company settings:', error);
            setMessage({ type: 'error', text: 'Failed to load notification settings' });
        } finally {
            setLoading(false);
        }
    };

    const saveSettings = async () => {
        if (!settings) return;

        try {
            setSaving(true);
            setMessage(null);

            const { error } = await supabase
                .from('company_notification_settings')
                .upsert({
                    account_id: accountId,
                    ...settings,
                    updated_at: new Date().toISOString(),
                });

            if (error) throw error;

            setMessage({ type: 'success', text: 'Settings saved successfully' });
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            console.error('Error saving settings:', error);
            setMessage({ type: 'error', text: 'Failed to save settings' });
        } finally {
            setSaving(false);
        }
    };

    const toggleInterval = (
        category: keyof CompanySettings,
        day: number
    ) => {
        if (!settings) return;

        const current = settings[category] || [];
        const updated = current.includes(day)
            ? current.filter(d => d !== day)
            : [...current, day].sort((a, b) => b - a);

        setSettings({ ...settings, [category]: updated });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    if (!settings) return null;

    const renderIntervalSelector = (
        title: string,
        description: string,
        category: keyof CompanySettings
    ) => (
        <div className="mb-6 last:mb-0">
            <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                {title}
            </label>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                {description}
            </p>
            <div className="flex flex-wrap gap-2">
                {AVAILABLE_INTERVALS.map(day => (
                    <button
                        key={day}
                        onClick={() => toggleInterval(category, day)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${settings[category]?.includes(day)
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                    >
                        {day} day{day !== 1 ? 's' : ''} before
                    </button>
                ))}
            </div>
        </div>
    );

    return (
        <div className="space-y-6">
            {message && (
                <div className={`p-4 rounded-lg flex items-center gap-2 ${message.type === 'success'
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                        : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                    }`}>
                    {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                    <span>{message.text}</span>
                </div>
            )}

            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-900 dark:text-white">
                    <Clock className="w-5 h-5" />
                    Notification Schedules
                </h3>

                <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                    Configure when notification reminders should be sent for various compliance deadlines.
                    These settings apply to all users in the account who have enabled notifications.
                </p>

                {renderIntervalSelector(
                    "SPCC Plan Creation",
                    "Reminders for new facilities that need an SPCC plan (due 6 months after Initial Production).",
                    "spcc_plan_creation_reminders"
                )}

                {renderIntervalSelector(
                    "SPCC Plan Renewal",
                    "Reminders for existing SPCC plans that need renewal (every 5 years).",
                    "spcc_plan_renewal_reminders"
                )}

                {renderIntervalSelector(
                    "Annual Inspections",
                    "Reminders for annual facility inspections.",
                    "spcc_annual_inspection_reminders"
                )}
            </div>

            <div className="flex justify-end">
                <button
                    onClick={saveSettings}
                    disabled={saving}
                    className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    <Save className="w-4 h-4" />
                    {saving ? 'Saving...' : 'Save Settings'}
                </button>
            </div>
        </div>
    );
}
