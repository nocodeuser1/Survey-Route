import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { CustomRule } from '../utils/customFilters';

export interface FacilitiesPreferences {
  sort_column: string | null;
  sort_direction: 'asc' | 'desc';
  hide_empty_fields: boolean;
  columns: Record<string, { visible: string[]; order: string[] }>;
  search_query: string;
  status_filter: string;
  spcc_plan_filter: string;
  show_sold_facilities: boolean;
  /** User-built rule list applied as AND on top of the dropdown's preset
   *  filters. Stored as JSON inside facilities_ui_preferences (no schema
   *  change needed). See src/utils/customFilters.ts for the rule shape. */
  custom_filter_rules: CustomRule[];
  /** Per-column pixel widths chosen via the drag-resize / double-click
   *  auto-fit interaction on the Facilities table. Keyed by columnId,
   *  shared across all spccMode/reportType combinations because a
   *  column means the same thing regardless of which mode is showing
   *  it. Missing entries fall back to the browser's natural sizing. */
  column_widths: Record<string, number>;
}

const DEFAULT_PREFS: FacilitiesPreferences = {
  sort_column: 'name',
  sort_direction: 'asc',
  hide_empty_fields: false,
  columns: {},
  search_query: '',
  status_filter: 'all',
  spcc_plan_filter: 'all',
  show_sold_facilities: false,
  custom_filter_rules: [],
  column_widths: {},
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

/**
 * Per-account facilities-table preferences.
 *
 * Storage model: one shared row per account in `user_settings`
 * (`account_id` carries the unique constraint, see migration
 * 20251112164811_fix_user_settings_unique_constraint.sql). That row holds
 * the canonical view — visible columns per mode, column order, column
 * widths, sort, saved filters, etc.
 *
 * `isAgencyOwner` gates writes to the shared row (added 2026-05-23 per
 * Israel: "make the agency owner's view the default for all users").
 * Behavior:
 *   - Agency owner: tweaks save to localStorage AND to Supabase, so the
 *     view they curate becomes the team-wide default.
 *   - Anyone else: tweaks save to localStorage only. Their current session
 *     stays responsive (filters, column drags, etc. all work), but the
 *     shared DB row is left alone — so a fresh load on another device, or
 *     after the cache is cleared, falls back to the agency owner's view.
 *
 * Default this to false so a caller that hasn't been updated yet won't
 * accidentally start writing as if it were an owner.
 */
export function useFacilitiesPreferences(accountId: string, userId: string, isAgencyOwner: boolean = false) {
  const [preferences, setPreferences] = useState<FacilitiesPreferences>(() => {
    return readCache(accountId) || DEFAULT_PREFS;
  });
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPrefsRef = useRef(preferences);
  const hasLocalChanges = useRef(false);
  // Track the accountId the current `preferences` snapshot belongs to so we
  // can detect cross-account contamination. Without this, the useState
  // initializer's `readCache(accountId)` only runs once — switching from
  // Camino → Validus leaves Camino's filters/columns in state until the
  // async Supabase load completes (or never, if `hasLocalChanges` was set
  // before the switch).
  const prefsAccountRef = useRef(accountId);

  // Keep ref in sync
  latestPrefsRef.current = preferences;

  // Reset local state when the active account changes. This is the cure for
  // the "stale filter on account switch" bug: any custom_filter_rules,
  // status_filter, etc. saved against the previous account were leaking
  // through and making the new account's facility list appear empty.
  useEffect(() => {
    if (prefsAccountRef.current === accountId) return;
    prefsAccountRef.current = accountId;
    hasLocalChanges.current = false;
    setLoaded(false);
    setPreferences(readCache(accountId) || DEFAULT_PREFS);
  }, [accountId]);

  // Load from Supabase on mount (and whenever the account changes — the
  // reset above re-runs this load with a clean slate).
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

          // Only apply remote if user hasn't made local changes since mount.
          // The account-switch effect above resets this ref so we always
          // honour the new account's persisted prefs.
          if (!hasLocalChanges.current) {
            setPreferences(remote);
            writeCache(accountId, remote);
          }
        } else if (!hasLocalChanges.current) {
          // No saved prefs for this account → ensure we're sitting on a
          // clean default snapshot rather than whatever the previous
          // account's cache may have seeded.
          setPreferences(DEFAULT_PREFS);
          writeCache(accountId, DEFAULT_PREFS);
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

  // Debounced save to Supabase. Gated on isAgencyOwner so a non-owner's
  // session-local tweaks (filter, sort, hidden cols, etc.) never overwrite
  // the curated team-wide row. Non-owners still get the writeCache call
  // upstream so their view stays consistent until the next page load.
  const saveToSupabase = useCallback((prefs: FacilitiesPreferences) => {
    if (!isAgencyOwner) return;
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
  }, [accountId, userId, isAgencyOwner]);

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
