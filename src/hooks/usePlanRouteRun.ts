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

  const facilityByName = useMemo(
    () => new Map(facilities.map(facility => [facility.name, facility])),
    [facilities],
  );

  const plannedStops = useMemo<PlannedRouteStopInput[]>(() => {
    if (!result) return [];
    const seen = new Set<string>();
    const next: PlannedRouteStopInput[] = [];

    for (const route of result.routes) {
      route.facilities.forEach((routeFacility, position) => {
        const facilityId = routeFacility.id ?? facilityByName.get(routeFacility.name)?.id;
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
  }, [facilityByName, result]);

  const plannedStopsSignature = useMemo(() => JSON.stringify(plannedStops), [plannedStops]);

  const loadStops = useCallback(async (runId: string) => {
    const { data, error: stopsError } = await supabase
      .from('plan_route_run_stops')
      .select('*')
      .eq('route_run_id', runId)
      .order('planned_day', { ascending: true, nullsFirst: false })
      .order('planned_position', { ascending: true, nullsFirst: false });

    if (stopsError) throw stopsError;
    setStops((data ?? []) as PlanRouteRunStop[]);
  }, []);

  const loadActiveRun = useCallback(async () => {
    const sequence = ++loadSequence.current;
    if (!enabled || !accountId || !routePlanId) {
      setRun(null);
      setStops([]);
      setError(null);
      return;
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
        await loadStops(activeRun.id);
      } else {
        setStops([]);
      }
    } catch (loadError: any) {
      console.warn('[PlanRouteRun] Unable to load route progress:', loadError?.message ?? loadError);
      if (sequence !== loadSequence.current) return;
      setRun(null);
      setStops([]);
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
      setLoading(true);
      setError(null);
      try {
        const { data: runId, error: startError } = await supabase.rpc('start_plan_route_run', {
          target_account_id: accountId,
          target_route_plan_id: routePlanId,
          target_team_number: teamNumber,
          target_stops: plannedStops,
          force_new: forceNew,
        });
        if (startError) throw startError;

        const { data: runData, error: runError } = await supabase
          .from('plan_route_runs')
          .select('*')
          .eq('id', runId)
          .single();
        if (runError) throw runError;

        const activeRun = runData as PlanRouteRun;
        setRun(activeRun);
        setSchemaUnavailable(false);
        await loadStops(activeRun.id);
        return activeRun;
      } catch (startError: any) {
        console.error('[PlanRouteRun] Unable to start route:', startError);
        setSchemaUnavailable(isMissingSchemaError(startError));
        setError(startError?.message ?? 'Unable to start this route.');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [accountId, enabled, isOnline, loadStops, plannedStops, routePlanId, teamNumber],
  );

  const setFacilityCompleted = useCallback(
    async (facilityId: string, completed: boolean) => {
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

        setStops(current =>
          current.map(stop =>
            stop.facility_id === facilityId
              ? {
                  ...stop,
                  status: completed ? 'completed' : 'pending',
                  completed_at: completed ? occurredAt : null,
                  updated_at: new Date().toISOString(),
                }
              : stop,
          ),
        );

        if (completed && data && onFacilityPatch) {
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
        return false;
      } finally {
        setSavingFacilityId(null);
      }
    },
    [onFacilityPatch, run, startRun],
  );

  const stopsByFacilityId = useMemo(
    () => new Map(stops.filter(stop => stop.facility_id).map(stop => [stop.facility_id as string, stop])),
    [stops],
  );
  const activeStops = useMemo(() => stops.filter(stop => stop.status !== 'removed'), [stops]);
  const completedCount = activeStops.filter(stop => stop.status === 'completed').length;

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
    startNewRun: () => startRun(true),
    setFacilityCompleted,
    reload: loadActiveRun,
  };
}
