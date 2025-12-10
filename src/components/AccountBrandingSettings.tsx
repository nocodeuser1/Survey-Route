import { useState, useEffect } from 'react';
import { Image, Upload, CheckCircle, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface AccountBrandingSettingsProps {
  accountId: string;
}

export default function AccountBrandingSettings({ accountId }: AccountBrandingSettingsProps) {
  const [companyName, setCompanyName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [logoUploading, setLogoUploading] = useState(false);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingMessage, setBrandingMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadBranding();
  }, [accountId]);

  const loadBranding = async () => {
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('company_name, logo_url')
        .eq('id', accountId)
        .single();

      if (error) throw error;

      if (data) {
        setCompanyName(data.company_name || '');
        setLogoUrl(data.logo_url || '');
      }
    } catch (err) {
      console.error('Error loading branding:', err);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setBrandingMessage({ type: 'error', text: 'File size must be less than 2MB' });
      return;
    }

    setLogoUploading(true);
    setBrandingMessage(null);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${accountId}-logo-${Date.now()}.${fileExt}`;
      const filePath = `${accountId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('account-assets')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('account-assets')
        .getPublicUrl(filePath);

      setLogoUrl(publicUrl);
      setBrandingMessage({ type: 'success', text: 'Logo uploaded successfully! Remember to save changes.' });
    } catch (err: any) {
      console.error('Error uploading logo:', err);
      setBrandingMessage({ type: 'error', text: err.message || 'Failed to upload logo' });
    } finally {
      setLogoUploading(false);
    }
  };

  const handleSaveBranding = async () => {
    setBrandingSaving(true);
    setBrandingMessage(null);

    try {
      const { error } = await supabase
        .from('accounts')
        .update({
          company_name: companyName,
          logo_url: logoUrl,
        })
        .eq('id', accountId);

      if (error) throw error;

      setBrandingMessage({ type: 'success', text: 'Branding saved successfully!' });
    } catch (err: any) {
      console.error('Error saving branding:', err);
      setBrandingMessage({ type: 'error', text: err.message || 'Failed to save branding' });
    } finally {
      setBrandingSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <Image className="w-5 h-5 text-gray-700 dark:text-gray-200 dark:text-gray-300" />
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Account Branding</h3>
      </div>

      <p className="text-gray-600 dark:text-gray-300">
        Customize your account branding. This logo will appear on all inspections and reports for this account.
      </p>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-2">
            Company Name
          </label>
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200"
            placeholder="Enter company name"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Used in inspection reports (e.g., &quot;Camino&quot; becomes &quot;Camino SPCC Inspection&quot;)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-2">
            Company Logo
          </label>
          <div className="space-y-3">
            {logoUrl && (
              <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 transition-colors duration-200">
                <img
                  src={logoUrl}
                  alt="Company logo"
                  className="h-16 w-auto object-contain"
                />
                <button
                  onClick={() => setLogoUrl('')}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Remove
                </button>
              </div>
            )}
            <div className="flex items-center gap-3">
              <label className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-400 dark:hover:border-blue-500 transition-colors cursor-pointer bg-white dark:bg-gray-700">
                <Upload className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  {logoUploading ? 'Uploading...' : 'Upload Logo'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  disabled={logoUploading}
                  className="hidden"
                />
              </label>
            </div>
            <p className="text-xs text-gray-500">
              Recommended: PNG or JPG, max 2MB. Logo will appear on all inspections and reports.
            </p>
          </div>
        </div>

        {brandingMessage && (
          <div className={`flex items-center gap-2 p-3 rounded-lg transition-colors duration-200 ${
            brandingMessage.type === 'success'
              ? 'bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 text-green-800 dark:text-green-200'
              : 'bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-200'
          }`}>
            {brandingMessage.type === 'success' ? (
              <CheckCircle className="w-5 h-5 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            )}
            <p className="text-sm">{brandingMessage.text}</p>
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleSaveBranding}
            disabled={brandingSaving}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {brandingSaving ? 'Saving...' : 'Save Branding'}
          </button>
        </div>
      </div>
    </div>
  );
}
