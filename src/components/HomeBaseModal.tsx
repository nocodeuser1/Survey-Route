import { useState, useEffect, useRef } from 'react';
import { Home, Search, MapPin, X, Check, ChevronRight, Loader2 } from 'lucide-react';
import { geocodeAddress } from '../services/osrm';
import { supabase, HomeBase } from '../lib/supabase';

interface HomeBaseModalProps {
  userId: string;
  accountId: string;
  teamCount: number;
  onTeamCountChange: (count: number) => void;
  onSaved: () => void;
  onClose: () => void;
}

interface HomeBaseForm {
  teamNumber: number;
  teamLabel: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  isGeocoding: boolean;
  isSaved: boolean;
  error: string | null;
}

const TEAM_OPTIONS = [1, 2, 3, 4] as const;

export default function HomeBaseModal({
  userId,
  accountId,
  teamCount,
  onTeamCountChange,
  onSaved,
  onClose,
}: HomeBaseModalProps) {
  const [localTeamCount, setLocalTeamCount] = useState(teamCount);
  const [homeBases, setHomeBases] = useState<HomeBase[]>([]);
  const [forms, setForms] = useState<HomeBaseForm[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Sliding selector state
  const selectorRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartIndexRef = useRef(0);

  useEffect(() => {
    loadHomeBases();
  }, [accountId]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
      for (let i = 1; i <= TEAM_OPTIONS.length; i++) {
        const existing = data?.find(hb => hb.team_number === i);
        newForms.push({
          teamNumber: i,
          teamLabel: existing?.team_label || `Team ${i}`,
          address: existing?.address || '',
          latitude: existing ? Number(existing.latitude) : null,
          longitude: existing ? Number(existing.longitude) : null,
          isGeocoding: false,
          isSaved: !!existing,
          error: null,
        });
      }
      setForms(newForms);
    } catch (err) {
      console.error('Error loading home bases:', err);
    }
  };

  const updateForm = (index: number, updates: Partial<HomeBaseForm>) => {
    setForms(prev =>
      prev.map((form, i) => (i === index ? { ...form, ...updates } : form))
    );
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
          error: 'Could not find location. Try a more specific address.',
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
    } catch {
      updateForm(index, {
        error: 'Failed to geocode address',
        isGeocoding: false,
      });
    }
  };

  const handleSave = async () => {
    // Validate: at least team 1 must have a location
    if (!forms[0]?.latitude || !forms[0]?.longitude) {
      updateForm(0, { error: 'Please find a location for your home base' });
      return;
    }

    // For multi-team, validate all active teams
    const activeForms = forms.filter(f => f.teamNumber <= localTeamCount);
    if (localTeamCount > 1) {
      const invalid = activeForms.filter(f => !f.latitude || !f.longitude);
      if (invalid.length > 0) {
        invalid.forEach(f => {
          const idx = forms.indexOf(f);
          updateForm(idx, { error: 'Please find a location for this team' });
        });
        return;
      }
    }

    setIsSaving(true);

    try {
      for (const form of activeForms) {
        const existing = homeBases.find(hb => hb.team_number === form.teamNumber);

        if (existing) {
          const { error } = await supabase
            .from('home_base')
            .update({
              address: form.address,
              latitude: form.latitude!,
              longitude: form.longitude!,
              team_label: form.teamLabel,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);

          if (error) throw error;
        } else {
          const { error } = await supabase.from('home_base').insert({
            user_id: userId,
            account_id: accountId,
            address: form.address,
            latitude: form.latitude!,
            longitude: form.longitude!,
            team_number: form.teamNumber,
            team_label: form.teamLabel,
          });

          if (error) throw error;
        }
      }

      setSaveSuccess(true);
      onTeamCountChange(localTeamCount);
      onSaved();

      // Auto-close after brief success indicator
      setTimeout(() => {
        onClose();
      }, 600);
    } catch (err) {
      console.error('Error saving home bases:', err);
      updateForm(0, {
        error: `Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const activeForms = forms.filter(f => f.teamNumber <= localTeamCount);
  const anyLocated = activeForms.some(f => f.latitude && f.longitude);

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-start sm:items-center justify-center z-[10000] p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="bg-white dark:bg-gray-800 w-full sm:max-w-lg sm:rounded-2xl shadow-2xl max-h-screen sm:max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
              <Home className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Home Base
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Routes start and end here
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {/* Team count selector - sliding segmented control */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              Number of Teams
            </label>
            <div
              ref={selectorRef}
              className="relative flex bg-gray-100 dark:bg-gray-700 rounded-xl p-1 select-none"
              onPointerMove={(e) => {
                if (!isDraggingRef.current || !selectorRef.current) return;
                const el = selectorRef.current;
                const rect = el.getBoundingClientRect();
                const padding = 4;
                const trackWidth = rect.width - padding * 2;
                const segmentWidth = trackWidth / TEAM_OPTIONS.length;
                const relativeX = e.clientX - rect.left - padding;
                const newIndex = Math.max(0, Math.min(TEAM_OPTIONS.length - 1, Math.floor(relativeX / segmentWidth)));
                const newCount = TEAM_OPTIONS[newIndex];
                if (newCount !== localTeamCount) {
                  setLocalTeamCount(newCount);
                }
              }}
              onPointerUp={() => {
                isDraggingRef.current = false;
              }}
            >
              {/* Sliding glass indicator */}
              <div
                className="absolute top-1 bottom-1 rounded-lg backdrop-blur-md bg-white/40 dark:bg-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),0_2px_8px_rgba(0,0,0,0.08)] border border-white/50 dark:border-white/15 transition-transform duration-300 ease-out"
                style={{
                  width: `calc((100% - 8px) / ${TEAM_OPTIONS.length})`,
                  transform: `translateX(${(TEAM_OPTIONS.indexOf(localTeamCount as typeof TEAM_OPTIONS[number])) * 100}%)`,
                }}
                onPointerDown={(e) => {
                  isDraggingRef.current = true;
                  e.currentTarget.parentElement?.setPointerCapture(e.pointerId);
                }}
              />
              {TEAM_OPTIONS.map(n => (
                <button
                  key={n}
                  onClick={() => setLocalTeamCount(n)}
                  className={`relative z-10 flex-1 py-2 text-sm font-medium rounded-lg transition-colors duration-200 ${
                    localTeamCount === n
                      ? 'text-blue-700 dark:text-blue-300'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                >
                  {n === 1 ? '1 Team' : `${n} Teams`}
                </button>
              ))}
            </div>
          </div>

          {/* Home base forms */}
          {forms.map((form, index) => {
            const isVisible = form.teamNumber <= localTeamCount;
            return (
              <div
                key={form.teamNumber}
                className="grid transition-all duration-300 ease-out"
                style={{
                  gridTemplateRows: isVisible ? '1fr' : '0fr',
                  opacity: isVisible ? 1 : 0,
                  marginTop: isVisible ? undefined : 0,
                }}
              >
                <div className="overflow-hidden min-h-0">
                  <div
                    className={`rounded-xl border transition-colors ${
                      form.latitude && form.longitude
                        ? 'border-green-200 dark:border-green-800/50 bg-green-50/50 dark:bg-green-900/10'
                        : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50'
                    } p-4`}
                  >
                    {/* Team header - only show for multi-team */}
                    {localTeamCount > 1 && (
                      <div className="flex items-center gap-2 mb-3">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            form.latitude && form.longitude
                              ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                              : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
                          }`}
                        >
                          {form.latitude && form.longitude ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : (
                            form.teamNumber
                          )}
                        </div>
                        <input
                          type="text"
                          value={form.teamLabel}
                          onChange={(e) => updateForm(index, { teamLabel: e.target.value })}
                          className="text-sm font-semibold text-gray-800 dark:text-white bg-transparent border-none p-0 focus:outline-none focus:ring-0 flex-1"
                          placeholder={`Team ${form.teamNumber}`}
                        />
                      </div>
                    )}

                    {/* Address input with integrated search */}
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          value={form.address}
                          onChange={(e) =>
                            updateForm(index, { address: e.target.value })
                          }
                          placeholder={localTeamCount === 1 ? 'Enter your home address' : 'Enter team address'}
                          className="w-full pl-3 pr-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleGeocode(index);
                            }
                          }}
                        />
                      </div>
                      <button
                        onClick={() => handleGeocode(index)}
                        disabled={form.isGeocoding || !form.address.trim()}
                        className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors shrink-0 flex items-center gap-2"
                      >
                        {form.isGeocoding ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Search className="w-4 h-4" />
                        )}
                        <span className="hidden sm:inline text-sm">
                          {form.isGeocoding ? 'Finding...' : 'Find'}
                        </span>
                      </button>
                    </div>

                    {/* Location found indicator */}
                    {form.latitude && form.longitude && (
                      <div className="flex items-center gap-2 mt-2.5 px-1">
                        <MapPin className="w-3.5 h-3.5 text-green-600 dark:text-green-400 shrink-0" />
                        <span className="text-xs text-green-700 dark:text-green-400 font-medium">
                          {form.latitude.toFixed(5)}, {form.longitude.toFixed(5)}
                        </span>
                      </div>
                    )}

                    {/* Error */}
                    {form.error && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-2 px-1">
                        {form.error}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 shrink-0 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !anyLocated}
            className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2 ${
              saveSuccess
                ? 'bg-green-600 text-white'
                : 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed'
            }`}
          >
            {saveSuccess ? (
              <>
                <Check className="w-4 h-4" />
                Saved
              </>
            ) : isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                Save
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
