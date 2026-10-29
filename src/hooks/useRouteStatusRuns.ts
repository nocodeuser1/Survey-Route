import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OptimizationResult } from '../services/routeOptimizer';
import {
  supabase,
  type Facility,
  type PlanRouteRunStop,
  type ResetRouteStatusScope,
  type RouteStatusResetResult,
  type RouteStatusRun,
  type RouteStatusRunStop,
  type RouteStatusScope,
} from '../lib/supabase';
import { useOnlineStatus } from './useOnlineStatus';

interface Options {
  accountId?: string;
  routePlanId?: string;
  teamNumber: number;
  result: OptimizationResult | null;
  facilities: Facility[];
  onFacilityPatch?: (facilityId: string, patch: Partial<Facility>) => void;
}

interface CachedScope {
  version: 2;
  accountId: string;
  routePlanId: string;
  teamNumber: number;
  scope: RouteStatusScope;
  run: RouteStatusRun;
  stops: RouteStatusRunStop[];
}

export interface PendingInspectionRouteCompletion {
  facilityId: string;
  source: 'inspection' | 'manual_internal' | 'manual_external';
  sourceRecordId: string;
  requestId: string;
  message: string;
}

const SCOPES: RouteStatusScope[] = ['spcc_inspection', 'spcc_plan'];
const cacheKey = (accountId: string, routePlanId: string, team: number, scope: RouteStatusScope) =>
  `surveyroute:route-status:v2:${accountId}:${routePlanId}:${team}:${scope}`;

const readCache = (accountId: string, routePlanId: string, team: number, scope: RouteStatusScope) => {
  try {
    const key = cacheKey(accountId, routePlanId, team, scope);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as CachedScope;
    const valid = value.version === 2 && value.accountId === accountId &&
      value.routePlanId === routePlanId && value.teamNumber === team && value.scope === scope &&
      value.run?.account_id === accountId && value.run.route_plan_id === routePlanId &&
      value.run.team_number === team && value.run.survey_type === scope && value.run.status === 'active' &&
      Array.isArray(value.stops) && value.stops.every(stop =>
        stop.account_id === accountId && stop.route_run_id === value.run.id &&
        (!stop.route_plan_id || stop.route_plan_id === routePlanId) &&
        (!stop.team_number || stop.team_number === team) &&
        (!stop.survey_type || stop.survey_type === scope));
    if (!valid) {
      window.localStorage.removeItem(key);
      return null;
    }
    return value;
  } catch {
    return null;
  }
};

const writeCache = (value: CachedScope) => {
  try {
    window.localStorage.setItem(
      cacheKey(value.accountId, value.routePlanId, value.teamNumber, value.scope),
      JSON.stringify(value),
    );
  } catch (error) {
    console.warn('[RouteStatus] Unable to cache committed route status:', error);
  }
};

const clearCache = (accountId: string, routePlanId: string, team: number, scope: RouteStatusScope) => {
  try { window.localStorage.removeItem(cacheKey(accountId, routePlanId, team, scope)); } catch { /* noop */ }
};

const isMissingSchemaError = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error && (error.code === '42P01' || error.code === '42883' || error.code === 'PGRST202' || error.message?.includes('schema cache')));

const errorDetails = (error: unknown): { code?: string; message?: string } => {
  if (!error || typeof error !== 'object') return {};
  const candidate = error as Record<string, unknown>;
  return {
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    message: typeof candidate.message === 'string' ? candidate.message : undefined,
  };
};

export function useRouteStatusRuns({
  accountId,
  routePlanId,
  teamNumber,
  result,
  facilities,
  onFacilityPatch,
}: Options) {
  const { isOnline } = useOnlineStatus();
  const [runsByScope, setRunsByScope] = useState<Partial<Record<RouteStatusScope, RouteStatusRun>>>({});
  const [stopsByScope, setStopsByScope] = useState<Record<RouteStatusScope, RouteStatusRunStop[]>>({
    spcc_inspection: [], spcc_plan: [],
  });
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [savingFacilityIdByScope, setSavingFacilityIdByScope] = useState<Partial<Record<RouteStatusScope, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [schemaUnavailable, setSchemaUnavailable] = useState(false);
  const [pendingInspectionCompletions, setPendingInspectionCompletions] = useState<PendingInspectionRouteCompletion[]>([]);
  const loadSequence = useRef(0);
  const identityKey = `${accountId ?? ''}:${routePlanId ?? ''}:${teamNumber}`;
  const [stateIdentityKey, setStateIdentityKey] = useState(identityKey);
  const [resolvedIdentityByScope, setResolvedIdentityByScope] = useState<Partial<Record<RouteStatusScope, string>>>({});

  const facilitiesByName = useMemo(() => {
    const map = new Map<string, Facility[]>();
    facilities.forEach(facility => map.set(facility.name, [...(map.get(facility.name) || []), facility]));
    return map;
  }, [facilities]);

  const plannedStops = useMemo(() => {
    const seen = new Set<string>();
    return (result?.routes || []).flatMap(route => route.facilities.map((routeFacility, position) => {
      const matches = routeFacility.id ? [] : facilitiesByName.get(routeFacility.name) || [];
      const facilityId = routeFacility.id ?? (matches.length === 1 ? matches[0].id : undefined);
      if (!facilityId || seen.has(facilityId)) return null;
      seen.add(facilityId);
      return { facility_id: facilityId, facility_name: routeFacility.name, planned_day: route.day, planned_position: position + 1 };
    }).filter((stop): stop is NonNullable<typeof stop> => Boolean(stop)));
  }, [facilitiesByName, result]);
  const plannedStopsSignature = useMemo(() => JSON.stringify(plannedStops), [plannedStops]);

  const adoptScope = useCallback((scope: RouteStatusScope, run: RouteStatusRun, stops: RouteStatusRunStop[]) => {
    setRunsByScope(current => ({ ...current, [scope]: run }));
    setStopsByScope(current => ({ ...current, [scope]: stops }));
    setResolvedIdentityByScope(current => ({ ...current, [scope]: identityKey }));
    if (accountId && routePlanId) writeCache({ version: 2, accountId, routePlanId, teamNumber, scope, run, stops });
  }, [accountId, identityKey, routePlanId, teamNumber]);

  const queuePendingInspectionCompletion = useCallback((pending: PendingInspectionRouteCompletion) => {
    setPendingInspectionCompletions(current => {
      const withoutSameRequest = current.filter(item => item.requestId !== pending.requestId);
      return [...withoutSameRequest, pending];
    });
  }, []);

  const reload = useCallback(async () => {
    // The saved route payload remains server-authoritative; this signature is
    // only a local signal that a route edit should trigger another sync.
    void plannedStopsSignature;
    const sequence = ++loadSequence.current;
    setRunsByScope({});
    setStopsByScope({ spcc_inspection: [], spcc_plan: [] });
    setResolvedIdentityByScope({});
    setStateIdentityKey(identityKey);
    setError(null);
    if (!accountId || !routePlanId) return;

    const cachedRuns: Partial<Record<RouteStatusScope, RouteStatusRun>> = {};
    const cachedStops: Record<RouteStatusScope, RouteStatusRunStop[]> = { spcc_inspection: [], spcc_plan: [] };
    SCOPES.forEach(scope => {
      const cached = readCache(accountId, routePlanId, teamNumber, scope);
      if (cached) { cachedRuns[scope] = cached.run; cachedStops[scope] = cached.stops; }
    });
    setRunsByScope(cachedRuns);
    setStopsByScope(cachedStops);
    setResolvedIdentityByScope(Object.fromEntries(
      SCOPES.filter(scope => Boolean(cachedRuns[scope])).map(scope => [scope, identityKey]),
    ));
    if (!isOnline) return;

    setLoading(true);
    try {
      const { data, error: runError } = await supabase.from('plan_route_runs').select('*')
        .eq('account_id', accountId).eq('route_plan_id', routePlanId).eq('team_number', teamNumber)
        .eq('status', 'active').in('survey_type', SCOPES);
      if (runError) throw runError;
      const nextRuns: Partial<Record<RouteStatusScope, RouteStatusRun>> = {};
      const nextStops: Record<RouteStatusScope, RouteStatusRunStop[]> = { spcc_inspection: [], spcc_plan: [] };
      for (const row of (data || []) as RouteStatusRun[]) {
        if (!SCOPES.includes(row.survey_type)) continue;
        const { error: syncError } = await supabase.rpc('sync_route_status_run_stops', {
          target_run_id: row.id,
        });
        if (syncError) throw syncError;
        nextRuns[row.survey_type] = row;
        const { data: stopRows, error: stopError } = await supabase.from('plan_route_run_stops').select('*')
          .eq('account_id', accountId).eq('route_run_id', row.id)
          .eq('route_plan_id', routePlanId).eq('team_number', teamNumber).eq('survey_type', row.survey_type)
          .order('planned_day', { ascending: true, nullsFirst: false })
          .order('planned_position', { ascending: true, nullsFirst: false });
        if (stopError) throw stopError;
        nextStops[row.survey_type] = (stopRows || []) as RouteStatusRunStop[];
      }
      if (sequence !== loadSequence.current) return;
      setRunsByScope(nextRuns);
      setStopsByScope(nextStops);
      setResolvedIdentityByScope({ spcc_inspection: identityKey, spcc_plan: identityKey });
      setSchemaUnavailable(false);
      SCOPES.forEach(scope => {
        const run = nextRuns[scope];
        if (run) writeCache({ version: 2, accountId, routePlanId, teamNumber, scope, run, stops: nextStops[scope] });
        else clearCache(accountId, routePlanId, teamNumber, scope);
      });
    } catch (loadError: unknown) {
      if (sequence !== loadSequence.current) return;
      const details = errorDetails(loadError);
      setSchemaUnavailable(isMissingSchemaError(details));
      setError(isMissingSchemaError(details) ? 'Route status is waiting for the database update.' : details.message ?? 'Unable to load route status.');
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [accountId, identityKey, isOnline, plannedStopsSignature, routePlanId, teamNumber]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setPendingInspectionCompletions([]); }, [identityKey]);

  const resetRouteStatus = useCallback(async (scope: ResetRouteStatusScope, requestId: string) => {
    if (!accountId || !routePlanId) throw new Error('Save this route before resetting route status.');
    if (!isOnline) throw new Error('A network connection is required to reset route status.');
    setResetting(true);
    setError(null);
    try {
      const { data, error: resetError } = await supabase.rpc('reset_route_status', {
        target_account_id: accountId,
        target_route_plan_id: routePlanId,
        target_team_number: teamNumber,
        target_scope: scope,
        target_idempotency_key: requestId,
      });
      if (resetError) throw resetError;
      const response = data as RouteStatusResetResult;
      if (response.account_id !== accountId || response.route_plan_id !== routePlanId ||
          response.team_number !== teamNumber || response.requested_scope !== scope) {
        throw new Error('The server returned route status for a different route scope.');
      }
      const expectedScopes: RouteStatusScope[] = scope === 'all' ? SCOPES : [scope];
      const responseScopes = response.runs.map(item => item.survey_type);
      const invalidPayload = response.runs.length !== expectedScopes.length ||
        expectedScopes.some(domain => !responseScopes.includes(domain)) ||
        response.runs.some(item =>
          item.run.account_id !== accountId || item.run.route_plan_id !== routePlanId ||
          item.run.team_number !== teamNumber || item.run.survey_type !== item.survey_type ||
          item.run.status !== 'active' || item.stops.some(stop =>
            stop.account_id !== accountId || stop.route_run_id !== item.run.id ||
            stop.route_plan_id !== routePlanId || stop.team_number !== teamNumber ||
            stop.survey_type !== item.survey_type));
      if (invalidPayload) {
        throw new Error('The server returned invalid route-status run data.');
      }
      const replacements = new Map(response.runs.map(item => [item.survey_type, item]));
      setRunsByScope(current => {
        const next = { ...current };
        replacements.forEach((item, domain) => { next[domain] = item.run; });
        return next;
      });
      setStopsByScope(current => {
        const next = { ...current };
        replacements.forEach((item, domain) => { next[domain] = item.stops; });
        return next;
      });
      replacements.forEach((item, domain) => writeCache({ version: 2, accountId, routePlanId, teamNumber, scope: domain, run: item.run, stops: item.stops }));
      setResolvedIdentityByScope(current => {
        const next = { ...current };
        replacements.forEach((_item, domain) => { next[domain] = identityKey; });
        return next;
      });
      return response;
    } catch (resetError: unknown) {
      const message = errorDetails(resetError).message ?? 'Unable to reset route status.';
      setError(message);
      throw new Error(message);
    } finally {
      setResetting(false);
    }
  }, [accountId, identityKey, isOnline, routePlanId, teamNumber]);

  const startPlanRun = useCallback(async () => {
    if (!accountId || !routePlanId || !isOnline || plannedStops.length === 0) return null;
    const { data: runId, error: startError } = await supabase.rpc('start_plan_route_run', {
      target_account_id: accountId, target_route_plan_id: routePlanId, target_team_number: teamNumber,
      target_stops: plannedStops, force_new: false,
    });
    if (startError) throw startError;
    await reload();
    return typeof runId === 'string' ? runId : null;
  }, [accountId, isOnline, plannedStops, reload, routePlanId, teamNumber]);

  const setPlanStopCompleted = useCallback(async (facilityId: string, completed: boolean) => {
    if (!accountId || !routePlanId || teamNumber < 1) {
      setError('Save this route before changing Plan route status.');
      return false;
    }
    if (!isOnline) { setError('Route progress changes need a connection.'); return false; }
    let run = runsByScope.spcc_plan;
    if (run && (run.account_id !== accountId || run.route_plan_id !== routePlanId || run.team_number !== teamNumber)) {
      run = undefined;
    }
    setSavingFacilityIdByScope(current => ({ ...current, spcc_plan: facilityId }));
    try {
      if (!run) { await startPlanRun(); run = undefined; }
      if (!run) {
        const { data: fallbackRun, error: fallbackError } = await supabase.from('plan_route_runs').select('*')
          .eq('account_id', accountId).eq('route_plan_id', routePlanId).eq('team_number', teamNumber)
          .eq('survey_type', 'spcc_plan').eq('status', 'active').maybeSingle();
        if (fallbackError) throw fallbackError;
        run = fallbackRun as RouteStatusRun | undefined;
      }
      if (!run) throw new Error('Unable to start Plan route status for this saved route.');
      const occurredAt = new Date().toISOString();
      const { data, error: saveError } = await supabase.rpc('set_plan_route_stop_photos', {
        target_run_id: run.id, target_facility_id: facilityId, target_completed: completed,
        target_occurred_at: occurredAt, target_source: 'route_planning', target_idempotency_key: crypto.randomUUID(),
      });
      if (saveError) throw saveError;
      const status: PlanRouteRunStop['status'] = data?.status === 'completed' ? 'completed' : 'pending';
      const next = stopsByScope.spcc_plan.map(stop => stop.facility_id === facilityId
        ? { ...stop, status, completed_at: status === 'completed' ? data?.completed_at || occurredAt : null }
        : stop);
      adoptScope('spcc_plan', run, next);
      if (status === 'completed' && onFacilityPatch) onFacilityPatch(facilityId, {
        photos_taken: true, field_visit_date: data?.field_visit_date, field_visit_time: data?.field_visit_time,
      });
      return true;
    } catch (saveError: unknown) {
      setError(errorDetails(saveError).message ?? 'Unable to update route progress.');
      void reload();
      return false;
    } finally {
      setSavingFacilityIdByScope(current => ({ ...current, spcc_plan: undefined }));
    }
  }, [accountId, adoptScope, isOnline, onFacilityPatch, reload, routePlanId, runsByScope.spcc_plan, startPlanRun, stopsByScope.spcc_plan, teamNumber]);

  const completeInspectionStop = useCallback(async (
    facilityId: string,
    source: 'inspection' | 'manual_internal' | 'manual_external',
    sourceRecordId: string,
    requestId: string = crypto.randomUUID(),
  ) => {
    const run = runsByScope.spcc_inspection;
    if (!run) return true;
    if (run.account_id !== accountId || run.route_plan_id !== routePlanId || run.team_number !== teamNumber) {
      const message = 'Inspection saved, but the active route status belongs to a different route scope.';
      queuePendingInspectionCompletion({ facilityId, source, sourceRecordId, requestId, message });
      void reload();
      return false;
    }
    const activeStop = stopsByScope.spcc_inspection.find(stop =>
      stop.facility_id === facilityId && !stop.removed_at && stop.status !== 'removed'
    );
    if (!activeStop) return true;
    if (!isOnline) {
      const message = 'Inspection saved, but route status needs a network connection. Retry when online.';
      setError(message);
      queuePendingInspectionCompletion({ facilityId, source, sourceRecordId, requestId, message });
      return false;
    }
    setSavingFacilityIdByScope(current => ({ ...current, spcc_inspection: facilityId }));
    try {
      const { data, error: completionError } = await supabase.rpc('complete_inspection_route_stop', {
        target_run_id: run.id, target_facility_id: facilityId, target_source: source,
        target_source_record_id: sourceRecordId, target_idempotency_key: requestId,
      });
      if (completionError) throw completionError;
      setStopsByScope(current => {
        const nextStops = current.spcc_inspection.map(stop => stop.facility_id === facilityId
          ? { ...stop, status: 'completed' as const, completed_at: data?.completed_at || new Date().toISOString() }
          : stop);
        if (accountId && routePlanId) {
          writeCache({ version: 2, accountId, routePlanId, teamNumber, scope: 'spcc_inspection', run, stops: nextStops });
        }
        return { ...current, spcc_inspection: nextStops };
      });
      setPendingInspectionCompletions(current => current.filter(item => item.requestId !== requestId));
      return true;
    } catch (completionError: unknown) {
      const message = `Inspection saved, but route status could not be updated: ${errorDetails(completionError).message ?? 'unknown error'}`;
      setError(message);
      queuePendingInspectionCompletion({ facilityId, source, sourceRecordId, requestId, message });
      void reload();
      return false;
    } finally {
      setSavingFacilityIdByScope(current => ({ ...current, spcc_inspection: undefined }));
    }
  }, [accountId, isOnline, queuePendingInspectionCompletion, reload, routePlanId, runsByScope.spcc_inspection, stopsByScope.spcc_inspection, teamNumber]);

  const recordManualInspectionCompletion = useCallback(async (
    facilityId: string,
    completionType: 'internal' | 'external',
  ) => {
    if (!isOnline) {
      setError('A network connection is required to save manual inspection completion.');
      return false;
    }
    try {
      const evidenceRequestId = crypto.randomUUID();
      const { data, error: evidenceError } = await supabase.rpc('record_manual_inspection_completion', {
        target_facility_id: facilityId,
        target_completion_type: completionType,
        target_idempotency_key: evidenceRequestId,
      });
      if (evidenceError) throw evidenceError;
      const evidenceId = typeof data?.id === 'string' ? data.id : null;
      if (!evidenceId) throw new Error('Manual completion saved without an evidence ID.');
      onFacilityPatch?.(facilityId, {
        spcc_completion_type: completionType,
        spcc_inspection_date: data.completed_on ?? new Date().toISOString().slice(0, 10),
      });
      if (runsByScope.spcc_inspection) {
        return await completeInspectionStop(
          facilityId,
          completionType === 'internal' ? 'manual_internal' : 'manual_external',
          evidenceId,
          crypto.randomUUID(),
        );
      }
      return true;
    } catch (manualError: unknown) {
      setError(errorDetails(manualError).message ?? 'Unable to save manual inspection completion.');
      return false;
    }
  }, [completeInspectionStop, isOnline, onFacilityPatch, runsByScope.spcc_inspection]);

  const pendingInspectionCompletion = pendingInspectionCompletions[0] ?? null;

  const retryInspectionCompletion = useCallback(async () => {
    if (!pendingInspectionCompletion) return false;
    return completeInspectionStop(
      pendingInspectionCompletion.facilityId,
      pendingInspectionCompletion.source,
      pendingInspectionCompletion.sourceRecordId,
      pendingInspectionCompletion.requestId,
    );
  }, [completeInspectionStop, pendingInspectionCompletion]);

  const stopsMapByScope = useMemo(() => ({
    spcc_inspection: new Map(stopsByScope.spcc_inspection.filter(stop => stop.facility_id && !stop.removed_at && stop.status !== 'removed').map(stop => [stop.facility_id as string, stop])),
    spcc_plan: new Map(stopsByScope.spcc_plan.filter(stop => stop.facility_id && !stop.removed_at && stop.status !== 'removed').map(stop => [stop.facility_id as string, stop])),
  }), [stopsByScope]);

  const identityMatches = stateIdentityKey === identityKey;
  const visibleRunsByScope = identityMatches ? runsByScope : {};
  const visibleStopsByScope = identityMatches
    ? stopsByScope
    : { spcc_inspection: [], spcc_plan: [] };
  const visibleStopsMapByScope = identityMatches
    ? stopsMapByScope
    : { spcc_inspection: new Map<string, RouteStatusRunStop>(), spcc_plan: new Map<string, RouteStatusRunStop>() };
  // While a saved route's active-run lookup is unresolved, route status must
  // remain authoritative. Falling back to historical compliance during this
  // gap briefly paints last year's checks before a reset run hydrates.
  const authoritativeByScope: Record<RouteStatusScope, boolean> = {
    spcc_inspection: Boolean(visibleRunsByScope.spcc_inspection) || Boolean(
      accountId && routePlanId && resolvedIdentityByScope.spcc_inspection !== identityKey
    ),
    spcc_plan: Boolean(visibleRunsByScope.spcc_plan) || Boolean(
      accountId && routePlanId && resolvedIdentityByScope.spcc_plan !== identityKey
    ),
  };

  return {
    runsByScope: visibleRunsByScope,
    stopsByScope: visibleStopsByScope,
    stopsMapByScope: visibleStopsMapByScope,
    authoritativeByScope,
    plannedStops, loading, resetting,
    savingFacilityIdByScope, error, schemaUnavailable, isOnline,
    pendingInspectionCompletion, pendingInspectionCompletionCount: pendingInspectionCompletions.length,
    resetRouteStatus, completeInspectionStop, recordManualInspectionCompletion,
    retryInspectionCompletion,
    dismissInspectionCompletionError: () => setPendingInspectionCompletions(current => current.slice(1)),
    setPlanStopCompleted, reload,
  };
}
