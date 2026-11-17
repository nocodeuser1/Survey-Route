import type { PlanRouteRunStop, RouteStatusScope } from '../lib/supabase';

export type RouteSurveyTypeKind = 'all' | 'spcc_inspection' | 'spcc_plan' | 'ldar' | 'custom';

interface RouteStatusRenderInput {
  surveyTypeKind: RouteSurveyTypeKind;
  isCurrentRouteStop: boolean;
  inspectionRunInitialized: boolean;
  planRunInitialized: boolean;
  ldarRunInitialized?: boolean;
  inspectionStop?: PlanRouteRunStop;
  planStop?: PlanRouteRunStop;
  ldarStop?: PlanRouteRunStop;
  inspectionComplianceCurrent: boolean;
  planComplianceCurrent: boolean;
  ldarComplianceCurrent?: boolean;
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
  const ldar = domainStatus(
    Boolean(input.ldarRunInitialized),
    input.ldarStop,
    Boolean(input.ldarComplianceCurrent),
  );

  if (!input.isCurrentRouteStop || input.surveyTypeKind === 'custom') {
    return {
      showRouteCheck: false,
      routeStatusByDomain: { spcc_inspection: inspection, spcc_plan: plan, ldar },
      markerRole: 'off-route',
    };
  }

  const hasInitializedDomain =
    input.inspectionRunInitialized || input.planRunInitialized || Boolean(input.ldarRunInitialized);
  const showRouteCheck = input.surveyTypeKind === 'spcc_inspection'
    ? inspection === 'completed'
    : input.surveyTypeKind === 'spcc_plan'
      ? plan === 'completed'
      : input.surveyTypeKind === 'ldar'
        ? ldar === 'completed'
        : hasInitializedDomain
          ? (input.inspectionRunInitialized && inspection === 'completed') ||
            (input.planRunInitialized && plan === 'completed') ||
            (Boolean(input.ldarRunInitialized) && ldar === 'completed')
          : inspection === 'completed' || plan === 'completed' || ldar === 'completed';

  return {
    showRouteCheck,
    routeStatusByDomain: { spcc_inspection: inspection, spcc_plan: plan, ldar },
    markerRole: 'current-route',
  };
}
