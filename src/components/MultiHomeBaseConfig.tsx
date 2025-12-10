import { useState, useEffect } from 'react';
import { Home, Search, MapPin, Save, Plus, Trash2 } from 'lucide-react';
import { geocodeAddress } from '../services/osrm';
import { supabase, HomeBase } from '../lib/supabase';

interface MultiHomeBaseConfigProps {
  userId: string;
  accountId: string;
  teamCount: number;
  onSaved?: () => void;
}

interface HomeBaseForm {
  teamNumber: number;
  teamLabel: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  isGeocoding: boolean;
  error: string | null;
}

export default function MultiHomeBaseConfig({ userId, accountId, teamCount, onSaved }: MultiHomeBaseConfigProps) {
  const [homeBases, setHomeBases] = useState<HomeBase[]>([]);
  const [forms, setForms] = useState<HomeBaseForm[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadHomeBases();
  }, [userId, teamCount]);

  const loadHomeBases = async () => {
    try {
      const { data, error } = await supabase
        .from('home_base')
        .select('*')
        .eq('account_id', accountId)
        .order('team_number', { ascending: true });

      if (error) throw error;

      setHomeBases(data || []);

      const newForms: HomeBaseForm[] = [];
      for (let i = 1; i <= teamCount; i++) {
        const existing = data?.find(hb => hb.team_number === i);
        newForms.push({
          teamNumber: i,
          teamLabel: existing?.team_label || `Team ${i}`,
          address: existing?.address || '',
          latitude: existing ? Number(existing.latitude) : null,
          longitude: existing ? Number(existing.longitude) : null,
          isGeocoding: false,
          error: null,
        });
      }
      setForms(newForms);
    } catch (err) {
      console.error('Error loading home bases:', err);
    }
  };

  const updateForm = (index: number, updates: Partial<HomeBaseForm>) => {
    setForms(prev => prev.map((form, i) => i === index ? { ...form, ...updates } : form));
  };

  const handleGeocode = async (index: number) => {
    const form = forms[index];
    if (!form.address.trim()) {
      updateForm(index, { error: 'Please enter an address' });
      return;
    }

    updateForm(index, { isGeocoding: true, error: null });

    try {
      const location = await geocodeAddress(form.address);

      if (!location) {
        updateForm(index, {
          error: 'Could not find location. Please try a more specific address.',
          latitude: null,
          longitude: null,
          isGeocoding: false,
        });
      } else {
        updateForm(index, {
          latitude: location.latitude,
          longitude: location.longitude,
          error: null,
          isGeocoding: false,
        });
      }
    } catch (err) {
      updateForm(index, {
        error: 'Failed to geocode address',
        isGeocoding: false,
      });
    }
  };

  const handleSaveAll = async () => {
    const invalidForms = forms.filter(f => !f.latitude || !f.longitude);
    if (invalidForms.length > 0) {
      alert('Please geocode all addresses before saving');
      return;
    }

    setIsSaving(true);

    try {
      for (const form of forms) {
        const existing = homeBases.find(hb => hb.team_number === form.teamNumber);

        if (existing) {
          await supabase
            .from('home_base')
            .update({
              address: form.address,
              latitude: form.latitude!,
              longitude: form.longitude!,
              team_label: form.teamLabel,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
        } else {
          await supabase.from('home_base').insert({
            user_id: userId,
            account_id: accountId,
            address: form.address,
            latitude: form.latitude!,
            longitude: form.longitude!,
            team_number: form.teamNumber,
            team_label: form.teamLabel,
          });
        }
      }

      await loadHomeBases();
      if (onSaved) onSaved();
    } catch (err) {
      console.error('Error saving home bases:', err);
      alert('Failed to save home bases');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center gap-2 mb-4">
        <Home className="w-5 h-5 text-blue-600" />
        <h2 className="text-xl font-semibold text-gray-800">Home Base Configuration</h2>
      </div>

      <p className="text-sm text-gray-600 mb-6">
        Configure a home base for each team. Each team will start and end their routes from their assigned home base.
      </p>

      <div className="space-y-6">
        {forms.map((form, index) => (
          <div key={form.teamNumber} className="p-4 border border-gray-200 rounded-lg">
            <h3 className="font-semibold text-gray-800 mb-3">{form.teamLabel}</h3>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  Team Label (Optional)
                </label>
                <input
                  type="text"
                  value={form.teamLabel}
                  onChange={(e) => updateForm(index, { teamLabel: e.target.value })}
                  placeholder={`Team ${form.teamNumber}`}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  Home Address
                </label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => updateForm(index, { address: e.target.value })}
                  placeholder="Enter address"
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleGeocode(index);
                    }
                  }}
                />
              </div>

              <button
                onClick={() => handleGeocode(index)}
                disabled={form.isGeocoding || !form.address.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                <Search className="w-4 h-4" />
                {form.isGeocoding ? 'Searching...' : 'Find Location'}
              </button>

              {form.latitude && form.longitude && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                  <p className="text-sm font-medium text-green-800">Location Found</p>
                  <p className="text-sm text-green-700 mt-1">
                    {form.latitude.toFixed(6)}, {form.longitude.toFixed(6)}
                  </p>
                </div>
              )}

              {form.error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                  {form.error}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={handleSaveAll}
        disabled={isSaving || forms.some(f => !f.latitude || !f.longitude)}
        className="w-full mt-6 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
      >
        <Save className="w-5 h-5" />
        {isSaving ? 'Saving...' : 'Save All Home Bases'}
      </button>
    </div>
  );
}
