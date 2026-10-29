import assert from 'node:assert/strict';
import test from 'node:test';
import { getRouteStatusRenderModel, resolveInspectionDisplayStatus } from '../src/utils/routeStatus.ts';
import { getNewestCompletedInspection, isFacilityInspectionCurrentAt } from '../src/utils/inspectionCompletion.ts';

const pending = { id: 'pending', status: 'pending' };
const completed = { id: 'completed', status: 'completed' };

test('inspection reset state overrides historical compliance', () => {
  const model = getRouteStatusRenderModel({
    surveyTypeKind: 'spcc_inspection',
    isCurrentRouteStop: true,
    inspectionRunInitialized: true,
    planRunInitialized: false,
    inspectionStop: pending,
    inspectionComplianceCurrent: true,
    planComplianceCurrent: false,
  });
  assert.equal(model.showRouteCheck, false);
  assert.equal(model.routeStatusByDomain.spcc_inspection, 'pending');
  assert.equal(resolveInspectionDisplayStatus('completed', model.routeStatusByDomain.spcc_inspection), 'incomplete');
  assert.equal(resolveInspectionDisplayStatus('expired', model.routeStatusByDomain.spcc_inspection), 'incomplete');
});

test('unresolved saved-route hydration stays pending instead of flashing historical completion', () => {
  const hydrating = getRouteStatusRenderModel({
    surveyTypeKind: 'spcc_inspection',
    isCurrentRouteStop: true,
    inspectionRunInitialized: true,
    planRunInitialized: false,
    inspectionComplianceCurrent: true,
    planComplianceCurrent: false,
  });
  assert.equal(hydrating.showRouteCheck, false);
  assert.equal(hydrating.routeStatusByDomain.spcc_inspection, 'pending');

  const submitted = getRouteStatusRenderModel({
    surveyTypeKind: 'spcc_inspection',
    isCurrentRouteStop: true,
    inspectionRunInitialized: true,
    planRunInitialized: false,
    inspectionStop: completed,
    inspectionComplianceCurrent: true,
    planComplianceCurrent: false,
  });
  assert.equal(submitted.showRouteCheck, true);
  assert.equal(submitted.routeStatusByDomain.spcc_inspection, 'completed');
});

test('inspection reset preserves a draft and completed route work wins after saving', () => {
  assert.equal(resolveInspectionDisplayStatus('draft', 'pending'), 'draft');
  assert.equal(resolveInspectionDisplayStatus('completed', 'completed'), 'completed');
  assert.equal(resolveInspectionDisplayStatus('expired', 'legacy'), 'expired');
});

test('legacy compliance remains a fallback before first reset', () => {
  const model = getRouteStatusRenderModel({
    surveyTypeKind: 'spcc_inspection',
    isCurrentRouteStop: true,
    inspectionRunInitialized: false,
    planRunInitialized: false,
    inspectionComplianceCurrent: true,
    planComplianceCurrent: false,
  });
  assert.equal(model.showRouteCheck, true);
});

test('All Facilities is the union of committed domain stops', () => {
  const model = getRouteStatusRenderModel({
    surveyTypeKind: 'all',
    isCurrentRouteStop: true,
    inspectionRunInitialized: true,
    planRunInitialized: true,
    inspectionStop: pending,
    planStop: completed,
    inspectionComplianceCurrent: true,
    planComplianceCurrent: false,
  });
  assert.equal(model.showRouteCheck, true);
  assert.deepEqual(model.routeStatusByDomain, {
    spcc_inspection: 'pending',
    spcc_plan: 'completed',
  });
});

test('All ignores legacy completion from a domain without an active route cycle', () => {
  const resetInspectionOnly = getRouteStatusRenderModel({
    surveyTypeKind: 'all',
    isCurrentRouteStop: true,
    inspectionRunInitialized: true,
    planRunInitialized: false,
    inspectionStop: pending,
    inspectionComplianceCurrent: true,
    planComplianceCurrent: true,
  });
  assert.equal(resetInspectionOnly.showRouteCheck, false);

  const submittedInspection = getRouteStatusRenderModel({
    surveyTypeKind: 'all',
    isCurrentRouteStop: true,
    inspectionRunInitialized: true,
    planRunInitialized: false,
    inspectionStop: completed,
    inspectionComplianceCurrent: true,
    planComplianceCurrent: true,
  });
  assert.equal(submittedInspection.showRouteCheck, true);
});

test('off-route facilities never render a current-route completion check', () => {
  const model = getRouteStatusRenderModel({
    surveyTypeKind: 'spcc_plan',
    isCurrentRouteStop: false,
    inspectionRunInitialized: true,
    planRunInitialized: true,
    inspectionStop: completed,
    planStop: completed,
    inspectionComplianceCurrent: true,
    planComplianceCurrent: true,
  });
  assert.equal(model.showRouteCheck, false);
  assert.equal(model.markerRole, 'off-route');
});

test('manual completion requires a date and expires before the warning window', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  assert.equal(isFacilityInspectionCurrentAt({ spcc_completion_type: 'external' }, [], now), false);
  assert.equal(isFacilityInspectionCurrentAt({
    spcc_completion_type: 'external', spcc_inspection_date: '2025-12-01',
  }, [], now), false);
  assert.equal(isFacilityInspectionCurrentAt({
    spcc_completion_type: 'internal', spcc_inspection_date: '2026-08-01',
  }, [], now), true);
});

test('a newer draft does not mask the newest completed inspection', () => {
  const completed = { id: 'done', status: 'completed', conducted_at: '2026-08-01T12:00:00Z' };
  const draft = { id: 'draft', status: 'draft', conducted_at: '2026-10-16T12:00:00Z' };
  assert.equal(getNewestCompletedInspection([draft, completed])?.id, 'done');
  assert.equal(isFacilityInspectionCurrentAt({}, [draft, completed], new Date('2026-10-17T12:00:00Z')), true);
});

test('newer formal evidence supersedes stale manual facility evidence', () => {
  const formal = { id: 'formal', status: 'completed', conducted_at: '2026-08-15T12:00:00Z' };
  assert.equal(isFacilityInspectionCurrentAt({
    spcc_completion_type: 'external', spcc_inspection_date: '2025-01-01',
  }, [formal], new Date('2026-10-17T12:00:00Z')), true);
});

test('Inspection, Plan, and All use the same initialized-domain semantics', () => {
  const base = {
    isCurrentRouteStop: true,
    inspectionRunInitialized: true,
    planRunInitialized: true,
    inspectionStop: pending,
    planStop: completed,
    inspectionComplianceCurrent: true,
    planComplianceCurrent: false,
  };
  assert.equal(getRouteStatusRenderModel({ ...base, surveyTypeKind: 'spcc_inspection' }).showRouteCheck, false);
  assert.equal(getRouteStatusRenderModel({ ...base, surveyTypeKind: 'spcc_plan' }).showRouteCheck, true);
  assert.equal(getRouteStatusRenderModel({ ...base, surveyTypeKind: 'all' }).showRouteCheck, true);
});
