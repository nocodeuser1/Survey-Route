import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(new URL('../supabase/migrations/20261017043000_route_status_reset.sql', import.meta.url), 'utf8');

test('active-run uniqueness includes the complete isolation tuple', () => {
  assert.match(sql, /account_id, route_plan_id, team_number, survey_type/);
  assert.match(sql, /WHERE status = 'active'/);
});

test('reset derives membership from the locked saved route and supports atomic all', () => {
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /_route_plan_assignments_from_data/);
  assert.match(sql, /ARRAY\['spcc_inspection', 'spcc_plan'\]/);
  assert.match(sql, /route_status_reset_requests/);
});

test('reset migration contains no compliance or route-plan mutation', () => {
  const resetBody = sql.split('CREATE FUNCTION public.reset_route_status')[1]
    .split('CREATE FUNCTION public.complete_inspection_route_stop')[0];
  assert.doesNotMatch(resetBody, /UPDATE\s+public\.facilities/i);
  assert.doesNotMatch(sql, /UPDATE\s+public\.inspections/i);
  assert.doesNotMatch(sql, /UPDATE\s+public\.spcc_plans/i);
  assert.doesNotMatch(sql, /UPDATE\s+public\.route_plans/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+public\.(facilities|inspections|spcc_plans|route_plans)/i);
});

test('inspection completion is explicit and Plan photo writes are scope guarded', () => {
  assert.match(sql, /complete_inspection_route_stop/);
  assert.match(sql, /survey_type = 'spcc_inspection'/);
  assert.match(sql, /survey_type = 'spcc_plan'/);
  assert.match(sql, /_set_plan_route_stop_photos_legacy/);
});

test('initialized domains resynchronize from authoritative saved-route membership', () => {
  assert.match(sql, /sync_route_status_run_stops/);
  assert.match(sql, /PERFORM public\._sync_plan_route_run_stops\(v_run\.id, '\[\]'::jsonb\)/);
  assert.match(sql, /FROM public\.route_plans[\s\S]*FOR UPDATE/);
});

test('re-added Inspection and Plan stops restore pending without reopening completed history', () => {
  const syncBody = sql.split('CREATE OR REPLACE FUNCTION public._sync_plan_route_run_stops')[1]
    .split('REVOKE ALL ON FUNCTION public._sync_plan_route_run_stops')[0];
  assert.match(syncBody, /status = CASE\s+WHEN plan_route_run_stops\.status = 'completed' THEN 'completed'\s+ELSE 'pending'\s+END/);
  assert.match(syncBody, /v_run\.survey_type/);

  const synchronizedStatus = (status) => status === 'completed' ? 'completed' : 'pending';
  for (const domain of ['spcc_inspection', 'spcc_plan']) {
    assert.equal(synchronizedStatus('removed'), 'pending', `${domain} re-added removed stop`);
    assert.equal(synchronizedStatus('pending'), 'pending', `${domain} pending stop`);
    assert.equal(synchronizedStatus('completed'), 'completed', `${domain} completed history`);
  }
});

test('inspection completion evidence is fresh, action-bound, and uses the 60-day threshold', () => {
  assert.match(sql, /record_manual_inspection_completion/);
  assert.match(sql, /inspection_route_completion_evidence/);
  assert.match(sql, /v_inspection\.updated_at < v_run\.started_at/);
  assert.match(sql, /v_inspection\.conducted_at IS NULL/);
  assert.match(sql, /v_evidence\.recorded_at < v_run\.started_at/);
  assert.match(sql, /INTERVAL '60 days'/);
});
