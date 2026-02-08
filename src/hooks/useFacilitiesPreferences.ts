import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface FacilitiesPreferences {
  sort_column: string | null;
  sort_direction: 'asc' | 'desc';
  hide_empty_fields: boolean;
  columns: Record<string, { visible: string[]; order: string[] }>;
}

const DEFAULT_PREFS: FacilitiesPreferences = {
  sort_column: 'name',
  sort_direction: 'asc',
  hide_empty_fields: false,
  columns: {},
};

const CACHE_KEY = (accountId: string) => `facilities_prefs_${accountId}`;

function readCache(accountId: string): FacilitiesPreferences | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY(accountId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(accountId: string, prefs: FacilitiesPreferences) {
  try {
    localStorage.setItem(CACHE_KEY(accountId), JSON.stringify(prefs));
  } catch {
    // localStorage full or unavailable
  }
}

export function useFacilitiesPreferences(accountId: string, userId: string) {
  const [preferences, setPreferences] = useState<FacilitiesPreferences>(() => {
    return readCache(accountId) || DEFAULT_PREFS;
  });
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPrefsRef = useRef(preferences);
  const hasLocalChanges = useRef(false);

  // Keep ref in sync
  latestPrefsRef.current = preferences;

  // Load from Supabase on mount
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { data, error } = await supabase
          .from('user_settings')
          .select('facilities_ui_preferences')
          .eq('account_id', accountId)
          .maybeSingle();

        if (cancelled) return;
        if (error) throw error;

        if (data?.facilities_ui_preferences) {
          const remote = {
            ...DEFAULT_PREFS,
            ...data.facilities_ui_preferences,
          } as FacilitiesPreferences;

          // Only apply remote if user hasn't made local changes since mount
          if (!hasLocalChanges.current) {
            setPreferences(remote);
            writeCache(accountId, remote);
          }
        }
      } catch (err) {
        console.error('[useFacilitiesPreferences] Failed to load:', err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [accountId]);

  // Debounced save to Supabase
  const saveToSupabase = useCallback((prefs: FacilitiesPreferences) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(async () => {
      try {
        await supabase
          .from('user_settings')
          .upsert({
            account_id: accountId,
            user_id: userId,
            facilities_ui_preferences: prefs,
          }, {
            onConflict: 'account_id',
          });
      } catch (err) {
        console.error('[useFacilitiesPreferences] Failed to save:', err);
      }
    }, 1000);
  }, [accountId, userId]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const updatePreferences = useCallback((partial: Partial<FacilitiesPreferences>) => {
    hasLocalChanges.current = true;
    setPreferences(prev => {
      const next = { ...prev, ...partial };
      writeCache(accountId, next);
      saveToSupabase(next);
      return next;
    });
  }, [accountId, saveToSupabase]);

  // Migrate old global localStorage keys on first load
  useEffect(() => {
    const migrated = localStorage.getItem(`facilities_prefs_migrated_${accountId}`);
    if (migrated) return;

    const oldSortCol = localStorage.getItem('facilities_sort_column');
    const oldSortDir = localStorage.getItem('facilities_sort_direction');
    const oldHideEmpty = localStorage.getItem('facilities_hide_empty_fields');

    if (oldSortCol || oldSortDir || oldHideEmpty) {
      const migrationData: Partial<FacilitiesPreferences> = {};
      if (oldSortCol) migrationData.sort_column = oldSortCol;
      if (oldSortDir === 'desc' || oldSortDir === 'asc') migrationData.sort_direction = oldSortDir;
      if (oldHideEmpty) migrationData.hide_empty_fields = oldHideEmpty === 'true';

      // Only apply if no cache exists yet for this account
      if (!readCache(accountId)) {
        updatePreferences(migrationData);
      }

      // Clean up old keys
      localStorage.removeItem('facilities_sort_column');
      localStorage.removeItem('facilities_sort_direction');
      localStorage.removeItem('facilities_hide_empty_fields');
    }

    localStorage.setItem(`facilities_prefs_migrated_${accountId}`, 'true');
  }, [accountId, updatePreferences]);

  return { preferences, loaded, updatePreferences };
}
