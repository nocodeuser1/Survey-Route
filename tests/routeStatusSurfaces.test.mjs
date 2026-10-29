import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routeResults = await readFile(new URL('../src/components/RouteResults.tsx', import.meta.url), 'utf8');
const surveyMode = await readFile(new URL('../src/components/SurveyMode.tsx', import.meta.url), 'utf8');
const routeMap = await readFile(new URL('../src/components/RouteMap.tsx', import.meta.url), 'utf8');
const hook = await readFile(new URL('../src/hooks/useRouteStatusRuns.ts', import.meta.url), 'utf8');
const facilitiesManager = await readFile(new URL('../src/components/FacilitiesManager.tsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('all three current-route surfaces consume the shared render model', () => {
  for (const source of [routeResults, surveyMode, routeMap]) {
    assert.match(source, /getRouteStatusRenderModel/);
    assert.match(source, /showRouteCheck/);
  }
});

test('Survey Mode turns a reset Inspection stop into actionable pending status', () => {
  assert.match(surveyMode, /resolveInspectionDisplayStatus/);
  assert.match(surveyMode, /routeStatusByDomain\.spcc_inspection/);
});

test('initialized domain runs synchronize through the authoritative RPC', () => {
  assert.match(hook, /sync_route_status_run_stops/);
  assert.match(hook, /plannedStopsSignature/);
});

test('partial inspection completion retains its request key for retry', () => {
  assert.match(hook, /queuePendingInspectionCompletion\(\{ facilityId, source, sourceRecordId, requestId, message \}\)/);
  assert.match(hook, /pendingInspectionCompletion\.requestId/);
  assert.match(hook, /retryInspectionCompletion/);
  assert.match(hook, /pendingInspectionCompletions\[0\]/);
});

test('bulk manual completion uses evidence and active-stop completion with queued retry', () => {
  const bulkBody = facilitiesManager.split('const handleBulkMarkComplete')[1]
    .split('  /**\n   * Add or remove one tag')[0];
  assert.match(bulkBody, /onManualInspectionCompletion\(facilityId, completionType\)/);
  assert.doesNotMatch(bulkBody, /from\('facilities'\)[\s\S]*\.update/);
  assert.match(app, /onManualInspectionCompletion=\{routeStatusRuns\.recordManualInspectionCompletion\}/);
  assert.match(hook, /record_manual_inspection_completion/);
  assert.match(hook, /activeStop/);
  assert.match(hook, /pendingInspectionCompletionCount/);
});

test('Plan mutation guards saved-route identity before fallback lookup', () => {
  const guard = hook.indexOf("if (!accountId || !routePlanId || teamNumber < 1)");
  const fallback = hook.indexOf("data: fallbackRun");
  assert.ok(guard >= 0 && fallback > guard);
  assert.match(hook.slice(guard, fallback + 500), /fallbackError/);
});

test('settings-only route toolbar mounts the reset dialog it opens', () => {
  const branchStart = routeResults.indexOf('if (showOnlySettings)');
  const branchEnd = routeResults.indexOf(
    'return (\n    <div className="relative space-y-4',
    branchStart,
  );
  assert.ok(branchStart >= 0 && branchEnd > branchStart);

  const settingsOnlyBranch = routeResults.slice(branchStart, branchEnd);
  assert.match(settingsOnlyBranch, /setShowResetRouteStatus\(true\)/);
  assert.match(settingsOnlyBranch, /<ResetRouteStatusModal/);
  assert.match(settingsOnlyBranch, /aria-live="polite"/);
});
