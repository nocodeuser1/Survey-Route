import { useEffect, useState } from 'react';
import { BadgeCheck, Mail, Save, UserRound } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { normalizeInspectionIdentity } from '../utils/inspectionIdentity';

export default function InspectionIdentitySettings() {
  const { user, reloadUserProfile } = useAuth();
  const [fullName, setFullName] = useState('');
  const [inspectionEmail, setInspectionEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setFullName(user?.fullName || '');
    setInspectionEmail(user?.inspectionEmail || '');
  }, [user?.fullName, user?.inspectionEmail]);

  const save = async () => {
    if (!user) return;
    setMessage(null);
    const normalized = normalizeInspectionIdentity({ fullName, inspectionEmail });
    if (!normalized.fullName) {
      setMessage({ type: 'error', text: 'Enter the name that should appear on inspections.' });
      return;
    }
    if (normalized.inspectionEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.inspectionEmail)) {
      setMessage({ type: 'error', text: 'Enter a valid inspection email address.' });
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .update({
          full_name: normalized.fullName,
          inspection_email: normalized.inspectionEmail,
        })
        .eq('auth_user_id', user.authUserId)
        .select('id')
        .single();
      if (error) throw error;

      // Keep the visible signature label aligned with the inspection profile.
      const { error: signatureError } = await supabase
        .from('user_signatures')
        .update({ signature_name: normalized.fullName })
        .eq('user_id', data.id);
      if (signatureError) throw signatureError;

      await reloadUserProfile();
      setFullName(normalized.fullName);
      setInspectionEmail(normalized.inspectionEmail || '');
      setMessage({ type: 'success', text: 'Inspection profile saved.' });
    } catch (error: any) {
      console.error('Failed to save inspection profile:', error);
      setMessage({ type: 'error', text: error.message || 'Failed to save inspection profile.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
          <BadgeCheck className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">My Inspection Profile</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            This name and email are saved with new SPCC inspections. Your login email does not change.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
            <UserRound className="h-4 w-4" /> Inspection name
          </span>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            autoComplete="name"
            placeholder="Israel Hindman"
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
            <Mail className="h-4 w-4" /> Inspection email
          </span>
          <input
            value={inspectionEmail}
            onChange={(event) => setInspectionEmail(event.target.value)}
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoComplete="email"
            placeholder="israel@baberenvironmental.com"
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
        </label>
      </div>

      {message && (
        <p className={`mt-4 rounded-xl px-3 py-2 text-sm ${message.type === 'success'
          ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
          : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
          {message.text}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60 sm:w-auto"
      >
        <Save className="h-4 w-4" />
        {saving ? 'Saving…' : 'Save Inspection Profile'}
      </button>
    </section>
  );
}
