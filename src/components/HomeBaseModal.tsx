import { useState, useEffect, useRef, useCallback } from 'react';
import { Home, Search, MapPin, X, Check, Loader2, LocateFixed, RefreshCw } from 'lucide-react';
import { geocodeAddress } from '../services/osrm';
import { supabase, type HomeBase } from '../lib/supabase';
import { requestMapLocation } from '../utils/mapLocation';

interface HomeBaseModalProps {
  userId: string;
  accountId: string;
  teamCount: number;
  onTeamCountChange: (count: number) => void;
  onSaved: () => void;
  onClose: () => void;
  contextMessage?: string;
}

interface HomeBaseForm {
  teamNumber: number;
  teamLabel: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  locating: 'address' | 'device' | null;
  error: string | null;
}

const TEAM_OPTIONS = [1, 2, 3, 4] as const;
const validLocation = (form: HomeBaseForm) =>
  form.latitude !== null && Number.isFinite(form.latitude) && Math.abs(form.latitude) <= 90 &&
  form.longitude !== null && Number.isFinite(form.longitude) && Math.abs(form.longitude) <= 180;

function createForms(bases: HomeBase[] = []): HomeBaseForm[] {
  return TEAM_OPTIONS.map(teamNumber => {
    const base = bases.find(candidate => candidate.team_number === teamNumber);
    return {
      teamNumber,
      teamLabel: base?.team_label || `Team ${teamNumber}`,
      address: base?.address || '',
      latitude: base ? Number(base.latitude) : null,
      longitude: base ? Number(base.longitude) : null,
      locating: null,
      error: null,
    };
  });
}

function describeSaveError(err: unknown): string {
  const error = err as { code?: string; message?: string } | null;
  if (error?.code === '23505') return 'A home base already exists for this team. Close and reopen settings to load it before trying again.';
  return error?.message || 'Please check your connection and try again.';
}

export default function HomeBaseModal({
  userId, accountId, teamCount, onTeamCountChange, onSaved, onClose, contextMessage,
}: HomeBaseModalProps) {
  const [localTeamCount, setLocalTeamCount] = useState(Math.max(1, Math.min(4, teamCount || 1)));
  const [homeBases, setHomeBases] = useState<HomeBase[]>([]);
  const [forms, setForms] = useState<HomeBaseForm[]>(() => createForms());
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const requestVersions = useRef<number[]>([0, 0, 0, 0]);
  const locationCancels = useRef<Array<(() => void) | undefined>>([]);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const savingRef = useRef(false);

  const loadHomeBases = useCallback(async () => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setIsLoading(true);
    setLoadError(null);
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const { data, error } = await supabase.from('home_base').select('*')
        .eq('account_id', accountId).order('team_number', { ascending: true })
        .abortSignal(controller.signal);
      if (loadAbortRef.current !== controller) return;
      if (error || controller.signal.aborted) throw error || new Error('Timed out');
      setHomeBases(data || []);
      setForms(createForms(data || []));
    } catch {
      if (loadAbortRef.current === controller) {
        setLoadError('Could not load saved home bases. Try again before making changes.');
      }
    } finally {
      clearTimeout(timeout);
      if (loadAbortRef.current === controller) setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void loadHomeBases();
    return () => {
      const controller = loadAbortRef.current;
      loadAbortRef.current = null;
      controller?.abort();
      locationCancels.current.forEach(cancel => cancel?.());
      requestVersions.current = requestVersions.current.map(version => version + 1);
      clearTimeout(closeTimer.current);
    };
  }, [loadHomeBases]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    modalRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]',
      ) || []).filter(element => element.getClientRects().length > 0 && !element.closest('fieldset:disabled'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === modalRef.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === modalRef.current)) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const updateForm = (index: number, updates: Partial<HomeBaseForm>) => {
    setSaveError(null);
    setForms(previous => previous.map((form, i) => i === index ? { ...form, ...updates } : form));
  };
  const cancelLocation = (index: number) => {
    locationCancels.current[index]?.();
    return ++requestVersions.current[index];
  };
  const editAddress = (index: number, address: string) => {
    cancelLocation(index);
    updateForm(index, { address, latitude: null, longitude: null, locating: null, error: null });
  };
  const handleGeocode = async (index: number) => {
    const address = forms[index].address.trim();
    if (!address) return;
    const version = cancelLocation(index);
    updateForm(index, { locating: 'address', error: null, latitude: null, longitude: null });
    // Bound a stalled address lookup, and ignore responses after edits or close.
    const timeout = setTimeout(() => {
      if (requestVersions.current[index] !== version) return;
      requestVersions.current[index]++;
      updateForm(index, { locating: null, error: 'Finding that address took too long. Try again or use coordinates.' });
    }, 12000);
    locationCancels.current[index] = () => clearTimeout(timeout);
    try {
      const location = await geocodeAddress(address);
      if (requestVersions.current[index] !== version) return;
      if (!location || !validLocation({ ...forms[index], ...location })) {
        updateForm(index, { locating: null, error: 'Could not find that address. Include the city and state, or use coordinates.' });
      } else {
        updateForm(index, { ...location, locating: null, error: null });
      }
    } catch {
      if (requestVersions.current[index] === version) {
        updateForm(index, { locating: null, error: 'Could not find that address. Please try again.' });
      }
    } finally { clearTimeout(timeout); }
  };
  const handleCurrentLocation = (index: number) => {
    const version = cancelLocation(index);
    updateForm(index, { locating: 'device', error: null });
    locationCancels.current[index] = requestMapLocation(navigator.geolocation,
      ({ coords: { latitude, longitude } }) => {
        if (requestVersions.current[index] !== version) return;
        updateForm(index, { latitude, longitude, address: `Current location (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`, locating: null, error: null });
      },
      message => {
        if (requestVersions.current[index] === version) updateForm(index, { locating: null, error: message });
      });
  };

  const activeForms = forms.slice(0, localTeamCount);
  const busy = isLoading || isSaving || saveSuccess;
  const canSave = !busy && !loadError && activeForms.every(form => validLocation(form) && !form.locating);
  const handleSave = async () => {
    if (!canSave || savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    try {
      for (const form of activeForms) {
        const values = {
          address: form.address.trim() || `Coordinates (${form.latitude}, ${form.longitude})`,
          latitude: form.latitude!, longitude: form.longitude!,
          team_label: form.teamLabel.trim() || `Team ${form.teamNumber}`,
        };
        const existing = homeBases.find(base => base.team_number === form.teamNumber);
        const query = existing
          ? supabase.from('home_base').update({ ...values, updated_at: new Date().toISOString() })
            .eq('id', existing.id).eq('account_id', accountId)
          : supabase.from('home_base').insert({ ...values, user_id: userId, account_id: accountId, team_number: form.teamNumber });
        const { data, error } = await query.select('*').single();
        if (error) throw error;
        if (!data) throw new Error('The home base was not saved. Please try again.');
        // Keep successful teams available for a retry if another team fails.
        setHomeBases(previous => [...previous.filter(base => base.team_number !== form.teamNumber), data]);
      }
      setSaveSuccess(true);
      onTeamCountChange(localTeamCount);
      onSaved();
      closeTimer.current = setTimeout(onClose, 600);
    } catch (error) {
      setSaveError(`Could not save home base. ${describeSaveError(error)}`);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const inputClass = 'w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white disabled:opacity-60';
  return (
    <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={event => { if (event.target === event.currentTarget && !savingRef.current && !saveSuccess) onClose(); }}>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="home-base-title" aria-describedby="home-base-description" tabIndex={-1}
        className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none dark:bg-gray-800 sm:max-h-[90dvh] sm:max-w-xl sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white"><Home className="h-5 w-5" /></div>
            <div>
              <h2 id="home-base-title" className="text-lg font-semibold text-gray-900 dark:text-white">Home base settings</h2>
              <p id="home-base-description" className="text-xs text-gray-500 dark:text-gray-400">Choose where each team's routes start and end.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving || saveSuccess} aria-label="Close home base settings" title="Close without saving"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
          {contextMessage && <p className="text-sm text-gray-700 dark:text-gray-300">{contextMessage}</p>}
          {isLoading && <p role="status" className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"><Loader2 className="h-4 w-4 animate-spin" />Loading saved home bases...</p>}
          {loadError && <div role="alert" className="space-y-2 rounded-lg border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-300">
            <p>{loadError}</p>
            <button type="button" onClick={() => void loadHomeBases()} title="Reload saved home bases" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-3 font-medium text-white hover:bg-blue-700"><RefreshCw className="h-4 w-4" />Try again</button>
          </div>}
          <fieldset disabled={busy || !!loadError} className="min-w-0 space-y-4 disabled:opacity-60">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Number of teams</legend>
            <div className="grid grid-cols-4 gap-1 rounded-xl border border-gray-200 p-1 dark:border-gray-600">
              {TEAM_OPTIONS.map(count => <button key={count} type="button" aria-pressed={localTeamCount === count}
                title={`Set up ${count === 1 ? 'one team' : `${count} teams`}`} onClick={() => setLocalTeamCount(count)}
                className={`min-h-11 rounded-lg px-1 text-sm font-medium transition-colors ${localTeamCount === count ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-blue-600 dark:text-gray-300 dark:hover:text-white'}`}>
                {count} {count === 1 ? 'Team' : 'Teams'}
              </button>)}
            </div>
            {activeForms.map((form, index) => <div key={form.teamNumber} className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-600">
              {localTeamCount > 1 && <label className="block text-sm font-medium text-gray-800 dark:text-gray-200">Team {form.teamNumber} name
                <input value={form.teamLabel} onChange={event => updateForm(index, { teamLabel: event.target.value })} className={`${inputClass} mt-1`} />
              </label>}
              <button type="button" onClick={() => handleCurrentLocation(index)} disabled={!!form.locating} title="Use this device's location for this home base"
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">
                {form.locating === 'device' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                {form.locating === 'device' ? 'Finding your location...' : 'Use my current location'}
              </button>
              <p className="text-center text-xs text-gray-500 dark:text-gray-400">or enter a street address</p>
              <label htmlFor={`home-address-${index}`} className="block text-sm font-medium text-gray-800 dark:text-gray-200">Home base address</label>
              <div className="flex gap-2">
                <input id={`home-address-${index}`} value={form.address} onChange={event => editAddress(index, event.target.value)}
                  placeholder="Street address, city, state" className={`${inputClass} flex-1`} autoComplete="street-address"
                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void handleGeocode(index); } }} />
                <button type="button" onClick={() => void handleGeocode(index)} disabled={!!form.locating || !form.address.trim()} title="Find the coordinates for this address"
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
                  {form.locating === 'address' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Find
                </button>
              </div>
              {validLocation(form) ? <p role="status" className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400"><MapPin className="h-4 w-4 shrink-0" />Location ready: {form.latitude!.toFixed(5)}, {form.longitude!.toFixed(5)}</p>
                : <p className="text-xs text-gray-500 dark:text-gray-400">Find the address, use your location, or enter coordinates below.</p>}
              <details className="text-sm text-gray-600 dark:text-gray-300">
                <summary className="cursor-pointer py-1 font-medium">Enter or edit coordinates</summary>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {(['latitude', 'longitude'] as const).map(coordinate => <label key={coordinate} className="min-w-0 text-xs capitalize">{coordinate}
                    <input type="number" step="any" min={coordinate === 'latitude' ? -90 : -180} max={coordinate === 'latitude' ? 90 : 180}
                      value={form[coordinate] ?? ''} onChange={event => {
                        cancelLocation(index);
                        updateForm(index, { [coordinate]: event.target.value === '' ? null : Number(event.target.value), locating: null, error: null });
                      }} className={`${inputClass} mt-1`} />
                  </label>)}
                </div>
              </details>
              {form.error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{form.error}</p>}
            </div>)}
          </fieldset>
          {saveError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}
          <p className="text-xs text-gray-500 dark:text-gray-400">Changes apply when you save. Update your route afterward to use the new home base.</p>
        </div>
        <div className="flex shrink-0 gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-700">
          <button type="button" onClick={onClose} disabled={isSaving || saveSuccess} title="Close without saving changes" className="min-h-11 flex-1 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 dark:border-gray-600 dark:text-gray-200 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => void handleSave()} disabled={!canSave} title="Save home bases for the selected teams"
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            {saveSuccess ? <Check className="h-4 w-4" /> : isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saveSuccess ? 'Saved' : isSaving ? 'Saving...' : 'Save home base'}
          </button>
        </div>
      </div>
    </div>
  );
}
