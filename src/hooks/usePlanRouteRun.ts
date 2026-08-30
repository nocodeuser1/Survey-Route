import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OptimizationResult } from '../services/routeOptimizer';
import {
  supabase,
  type Facility,
  type PlanRouteRun,
  type PlanRouteRunStop,
} from '../lib/supabase';
import { useOnlineStatus } from './useOnlineStatus';

export interface PlannedRouteStopInput {
  facility_id: string;
  facility_name: string;
  planned_day: number;
  planned_position: number;
}

interface UsePlanRouteRunOptions {
  accountId?: string;
  routePlanId?: string;
  teamNumber: number;
  result: OptimizationResult | null;
  facilities: Facility[];
  enabled: boolean;
  onFacilityPatch?: (facilityId: string, patch: Partial<Facility>) => void;
}

interface CachedPlanRouteRun {
  version: 1;
  accountId: string;
  routePlanId: string;
  teamNumber: number;
  savedAt: string;
  run: PlanRouteRun;
  stops: PlanRouteRunStop[];
}

const routeRunCacheKey = (accountId: string, routePlanId: string, teamNumber: number) =>
  `surveyroute:plan-route-run:v1:${accountId}:${routePlanId}:${teamNumber}`;

function readCachedRouteRun(
  accountId: string,
  routePlanId: string,
  teamNumber: number,
): CachedPlanRouteRun | null {
  try {
    const raw = window.localStorage.getItem(routeRunCacheKey(accountId, routePlanId, teamNumber));
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<CachedPlanRouteRun>;
    if (
      cached.version !== 1 ||
      cached.accountId !== accountId ||
      cached.routePlanId !== routePlanId ||
      cached.teamNumber !== teamNumber ||
      !cached.run ||
      cached.run.account_id !== accountId ||
      cached.run.route_plan_id !== routePlanId ||
      cached.run.team_number !== teamNumber ||
      cached.run.status !== 'active' ||
      !Array.isArray(cached.stops) ||
      cached.stops.some(stop => stop.route_run_id !== cached.run?.id || stop.account_id !== accountId)
    ) {
      window.localStorage.removeItem(routeRunCacheKey(accountId, routePlanId, teamNumber));
      return null;
    }
    return cached as CachedPlanRouteRun;
  } catch (cacheError) {
    console.warn('[PlanRouteRun] Unable to read cached outing progress:', cacheError);
    return null;
  }
}

function writeCachedRouteRun(
  accountId: string,
  routePlanId: string,
  teamNumber: number,
  run: PlanRouteRun,
  stops: PlanRouteRunStop[],
) {
  try {
    const cached: CachedPlanRouteRun = {
      version: 1,
      accountId,
      routePlanId,
      teamNumber,
      savedAt: new Date().toISOString(),
      run,
      stops,
    };
    window.localStorage.setItem(routeRunCacheKey(accountId, routePlanId, teamNumber), JSON.stringify(cached));
  } catch (cacheError) {
    console.warn('[PlanRouteRun] Unable to cache outing progress:', cacheError);
  }
}

function clearCachedRouteRun(accountId: string, routePlanId: string, teamNumber: number) {
  try {
    window.localStorage.removeItem(routeRunCacheKey(accountId, routePlanId, teamNumber));
  } catch (cacheError) {
    console.warn('[PlanRouteRun] Unable to clear cached outing progress:', cacheError);
  }
}

const isMissingSchemaError = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(
    error &&
      (error.code === '42P01' ||
        error.code === '42883' ||
        error.code === 'PGRST202' ||
        error.message?.includes('schema cache')),
  );

/**
 * Route-only progress for an SPCC Plan outing.
 *
 * The facility and berm photos_taken fields remain the durable current
 * snapshot. Reopening a stop changes only this run's stop row. Completing a
 * stop writes both the route progress and the immutable photo event through a
 * single database RPC.
 */
export function usePlanRouteRun({
  accountId,
  routePlanId,
  teamNumber,
  result,
  facilities,
  enabled,
  onFacilityPatch,
}: UsePlanRouteRunOptions) {
  const { isOnline } = useOnlineStatus();
  const [run, setRun] = useState<PlanRouteRun | null>(null);
  const [stops, setStops] = useState<PlanRouteRunStop[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingFacilityId, setSavingFacilityId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schemaUnavailable, setSchemaUnavailable] = useState(false);
  const loadSequence = useRef(0);

  const facilitiesByName = useMemo(() => {
    const grouped = new Map<string, Facility[]>();
    for (const facility of facilities) {
      const matches = grouped.get(facility.name) || [];
      matches.push(facility);
      grouped.set(facility.name, matches);
    }
    return grouped;
  }, [facilities]);

  const plannedStops = useMemo<PlannedRouteStopInput[]>(() => {
    if (!result) return [];
    const seen = new Set<string>();
    const next: PlannedRouteStopInput[] = [];

    for (const route of result.routes) {
      route.facilities.forEach((routeFacility, position) => {
        const legacyMatches = routeFacility.id
          ? []
          : facilitiesByName.get(routeFacility.name) || [];
        const facilityId = routeFacility.id
          ?? (legacyMatches.length === 1 ? legacyMatches[0].id : undefined);
        if (!facilityId || seen.has(facilityId)) return;
        seen.add(facilityId);
        next.push({
          facility_id: facilityId,
          facility_name: routeFacility.name,
          planned_day: route.day,
          planned_position: position + 1,
        });
      });
    }

    return next;
  }, [facilitiesByName, result]);

  const plannedStopsSignature = useMemo(() => JSON.stringify(plannedStops), [plannedStops]);

  const loadStops = useCallback(async (runId: string) => {
    const { data, error: stopsError } = await supabase
      .from('plan_route_run_stops')
      .select('*')
      .eq('route_run_id', runId)
      .order('planned_day', { ascending: true, nullsFirst: false })
      .order('planned_position', { ascending: true, nullsFirst: false });

    if (stopsError) throw stopsError;
    return (data ?? []) as PlanRouteRunStop[];
  }, []);

  const loadActiveRun = useCallback(async () => {
    const sequence = ++loadSequence.current;
    if (!enabled || !accountId || !routePlanId) {
      setRun(null);
      setStops([]);
      setError(null);
      return;
    }

    // Hydrate the exact account/route/team scope before touching the network.
    // Offline state is intentionally read-only; online success below is the
    // only path that refreshes this cache.
    const cached = readCachedRouteRun(accountId, routePlanId, teamNumber);
    if (cached) {
      setRun(cached.run);
      setStops(cached.stops);
    } else {
      setRun(null);
      setStops([]);
    }
    if (!isOnline) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: runError } = await supabase
        .from('plan_route_runs')
        .select('*')
        .eq('account_id', accountId)
        .eq('route_plan_id', routePlanId)
        .eq('team_number', teamNumber)
        .eq('status', 'active')
        .maybeSingle();

      if (runError) throw runError;
      if (sequence !== loadSequence.current) return;

      const activeRun = (data as PlanRouteRun | null) ?? null;
      setRun(activeRun);
      setSchemaUnavailable(false);
      if (activeRun) {
        const { error: syncError } = await supabase.rpc('sync_plan_route_run_stops', {
          target_run_id: activeRun.id,
          target_stops: plannedStops,
        });
        if (syncError) throw syncError;
        const loadedStops = await loadStops(activeRun.id);
        if (sequence !== loadSequence.current) return;
        setStops(loadedStops);
        writeCachedRouteRun(accountId, routePlanId, teamNumber, activeRun, loadedStops);
      } else {
        setStops([]);
        clearCachedRouteRun(accountId, routePlanId, teamNumber);
      }
    } catch (loadError: any) {
      console.warn('[PlanRouteRun] Unable to load route progress:', loadError?.message ?? loadError);
      if (sequence !== loadSequence.current) return;
      if (cached) {
        setRun(cached.run);
        setStops(cached.stops);
      } else {
        setRun(null);
        setStops([]);
      }
      setSchemaUnavailable(isMissingSchemaError(loadError));
      setError(
        isMissingSchemaError(loadError)
          ? 'Route progress is waiting for the database update.'
          : loadError?.message ?? 'Unable to load route progress.',
      );
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [accountId, enabled, isOnline, loadStops, plannedStopsSignature, routePlanId, teamNumber]);

  useEffect(() => {
    void loadActiveRun();
  }, [loadActiveRun]);

  const startRun = useCallback(
    async (forceNew = false): Promise<PlanRouteRun | null> => {
      if (!enabled || !accountId || !routePlanId || plannedStops.length === 0) return null;
      if (!isOnline) {
        setError('Route progress changes need a connection.');
        return null;
      }
      // Explicit starts/resets supersede any background load already in flight.
      // A later load may in turn supersede this request, but an older load can
      // never overwrite the run returned by Reset for new outing.
      const sequence = ++loadSequence.current;
      setLoading(true);
      setError(null);
      let committedRunId: string | null = null;
      try {
        const { data: runId, error: startError } = await supabase.rpc('start_plan_route_run', {
          target_account_id: accountId,
          target_route_plan_id: routePlanId,
          target_team_number: teamNumber,
          target_stops: plannedStops,
          force_new: forceNew,
        });
        if (startError) throw startError;
        if (sequence !== loadSequence.current) return null;
        if (typeof runId !== 'string' || !runId) {
          throw new Error('The route outing started, but no outing ID was returned.');
        }
        committedRunId = runId;

        // A forced reset is committed inside start_plan_route_run before these
        // follow-up reads occur. Retire the ended outing immediately so a
        // transient read failure can never leave its stale checklist visible
        // or cached as if it were still active.
        if (forceNew) {
          setRun(null);
          setStops([]);
          clearCachedRouteRun(accountId, routePlanId, teamNumber);
        }

        const { data: runData, error: runError } = await supabase
          .from('plan_route_runs')
          .select('*')
          .eq('id', runId)
          .single();
        if (runError) throw runError;
        if (sequence !== loadSequence.current) return null;

        const activeRun = runData as PlanRouteRun;
        setRun(activeRun);
        setSchemaUnavailable(false);
        const loadedStops = await loadStops(activeRun.id);
        if (sequence !== loadSequence.current) return null;
        setStops(loadedStops);
        writeCachedRouteRun(accountId, routePlanId, teamNumber, activeRun, loadedStops);
        return activeRun;
      } catch (startError: any) {
        if (sequence !== loadSequence.current) return null;
        console.error('[PlanRouteRun] Unable to start route:', startError);
        setSchemaUnavailable(isMissingSchemaError(startError));
        setError(startError?.message ?? 'Unable to start this route.');
        if (committedRunId) {
          // Recover the committed outing through the normal active-run loader.
          // This also repopulates the durable cache when the transient read
          // that followed the RPC was the only failed step.
          void loadActiveRun();
        }
        return null;
      } finally {
        if (sequence === loadSequence.current) setLoading(false);
      }
    },
    [accountId, enabled, isOnline, loadActiveRun, loadStops, plannedStops, routePlanId, teamNumber],
  );

  const setFacilityCompleted = useCallback(
    async (facilityId: string, completed: boolean) => {
      if (!isOnline) {
        setError('Route progress changes need a connection. Saved progress is available read-only.');
        return false;
      }
      let activeRun = run;
      if (!activeRun) activeRun = await startRun(false);
      if (!activeRun) return false;

      setSavingFacilityId(facilityId);
      setError(null);
      try {
        const occurredAt = new Date().toISOString();
        const { data, error: saveError } = await supabase.rpc('set_plan_route_stop_photos', {
          target_run_id: activeRun.id,
          target_facility_id: facilityId,
          target_completed: completed,
          target_occurred_at: occurredAt,
          target_source: 'route_planning',
          target_idempotency_key: crypto.randomUUID(),
        });
        if (saveError) throw saveError;

        const savedStatus: PlanRouteRunStop['status'] =
          data?.status === 'completed' || data?.status === 'pending'
            ? data.status
            : completed
              ? 'completed'
              : 'pending';
        const savedCompletedAt = savedStatus === 'completed'
          ? data?.completed_at || occurredAt
          : null;

        setStops(current => {
          const nextStops: PlanRouteRunStop[] = current.map(stop =>
            stop.facility_id === facilityId
              ? {
                  ...stop,
                  status: savedStatus,
                  completed_at: savedCompletedAt,
                  updated_at: new Date().toISOString(),
                }
              : stop,
          );
          if (accountId && routePlanId && activeRun) {
            writeCachedRouteRun(accountId, routePlanId, teamNumber, activeRun, nextStops);
          }
          return nextStops;
        });

        if (savedStatus === 'completed' && data && onFacilityPatch) {
          onFacilityPatch(facilityId, {
            photos_taken: true,
            field_visit_date: data.field_visit_date ?? undefined,
            field_visit_time: data.field_visit_time ?? undefined,
          });
        }
        return true;
      } catch (saveError: any) {
        console.error('[PlanRouteRun] Unable to update stop:', saveError);
        setError(saveError?.message ?? 'Unable to update route progress.');
        // Another administrator may have reset this outing while this tab was
        // open. Rebind to the current active run so the next tap does not keep
        // retrying the ended run. The server sync derives membership from the
        // locked saved route, so this recovery cannot replay stale local stops.
        void loadActiveRun();
        return false;
      } finally {
        setSavingFacilityId(null);
      }
    },
    [accountId, isOnline, loadActiveRun, onFacilityPatch, routePlanId, run, startRun, teamNumber],
  );

  const stopsByFacilityId = useMemo(
    () => new Map(
      stops
        .filter(stop => stop.facility_id && !stop.removed_at && stop.status !== 'removed')
        .map(stop => [stop.facility_id as string, stop]),
    ),
    [stops],
  );
  const activeStops = useMemo(
    () => stops.filter(stop =>
      Boolean(stop.facility_id) && !stop.removed_at && stop.status !== 'removed'
    ),
    [stops],
  );
  const completedCount = activeStops.filter(stop => stop.status === 'completed').length;
  const startNewRun = useCallback(() => startRun(true), [startRun]);

  return {
    run,
    stops,
    stopsByFacilityId,
    plannedStops,
    completedCount,
    totalCount: activeStops.length || plannedStops.length,
    loading,
    savingFacilityId,
    error,
    schemaUnavailable,
    startRun,
    startNewRun,
    setFacilityCompleted,
    reload: loadActiveRun,
  };
}
