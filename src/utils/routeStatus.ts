import type { PlanRouteRunStop, RouteStatusScope } from '../lib/supabase';

export type RouteSurveyTypeKind = 'all' | 'spcc_inspection' | 'spcc_plan' | 'custom';

interface RouteStatusRenderInput {
  surveyTypeKind: RouteSurveyTypeKind;
  isCurrentRouteStop: boolean;
  inspectionRunInitialized: boolean;
  planRunInitialized: boolean;
  inspectionStop?: PlanRouteRunStop;
  planStop?: PlanRouteRunStop;
  inspectionComplianceCurrent: boolean;
  planComplianceCurrent: boolean;
}

export interface RouteStatusRenderModel {
  showRouteCheck: boolean;
  routeStatusByDomain: Record<RouteStatusScope, 'completed' | 'pending' | 'legacy'>;
  markerRole: 'current-route' | 'off-route';
}

export type InspectionDisplayStatus = 'completed' | 'incomplete' | 'expired' | 'draft';

/**
 * A fresh current-route Inspection run is the active work cycle. Historical
 * compliance remains in History, but a pending stop must look actionable in
 * Survey Mode instead of continuing to look completed from last year's data.
 * Preserve an in-progress draft so the user can resume it rather than start a
 * duplicate inspection.
 */
export function resolveInspectionDisplayStatus(
  lifecycleStatus: InspectionDisplayStatus,
  currentRouteStatus?: 'completed' | 'pending' | 'legacy',
): InspectionDisplayStatus {
  if (currentRouteStatus === 'pending') {
    return lifecycleStatus === 'draft' ? 'draft' : 'incomplete';
  }
  return lifecycleStatus;
}

const domainStatus = (
  initialized: boolean,
  stop: PlanRouteRunStop | undefined,
  complianceCurrent: boolean,
): 'completed' | 'pending' | 'legacy' => {
  if (initialized) return stop?.status === 'completed' ? 'completed' : 'pending';
  return complianceCurrent ? 'completed' : 'legacy';
};

/** Pure render model. Compliance is fallback-only until a domain run exists. */
export function getRouteStatusRenderModel(input: RouteStatusRenderInput): RouteStatusRenderModel {
  const inspection = domainStatus(
    input.inspectionRunInitialized,
    input.inspectionStop,
    input.inspectionComplianceCurrent,
  );
  const plan = domainStatus(
    input.planRunInitialized,
    input.planStop,
    input.planComplianceCurrent,
  );

  if (!input.isCurrentRouteStop || input.surveyTypeKind === 'custom') {
    return {
      showRouteCheck: false,
      routeStatusByDomain: { spcc_inspection: inspection, spcc_plan: plan },
      markerRole: 'off-route',
    };
  }

  const hasInitializedDomain = input.inspectionRunInitialized || input.planRunInitialized;
  const showRouteCheck = input.surveyTypeKind === 'spcc_inspection'
    ? inspection === 'completed'
    : input.surveyTypeKind === 'spcc_plan'
      ? plan === 'completed'
      : hasInitializedDomain
        // Once a route cycle exists, legacy compliance from a domain without
        // an active run must not make a freshly reset stop look completed.
        ? (input.inspectionRunInitialized && inspection === 'completed') ||
          (input.planRunInitialized && plan === 'completed')
        : inspection === 'completed' || plan === 'completed';

  return {
    showRouteCheck,
    routeStatusByDomain: { spcc_inspection: inspection, spcc_plan: plan },
    markerRole: 'current-route',
  };
}
