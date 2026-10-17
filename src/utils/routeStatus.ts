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

  const showRouteCheck = input.surveyTypeKind === 'spcc_inspection'
    ? inspection === 'completed'
    : input.surveyTypeKind === 'spcc_plan'
      ? plan === 'completed'
      : inspection === 'completed' || plan === 'completed';

  return {
    showRouteCheck,
    routeStatusByDomain: { spcc_inspection: inspection, spcc_plan: plan },
    markerRole: 'current-route',
  };
}
