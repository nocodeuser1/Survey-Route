# BMAD Handoff Notes

## 2026-10-17 - Quinn to Marco: Route status reset

**Gate:** NO-GO until the focused requirements below are implemented and verified.

### Must fix first

1. Replace every route-map inspection predicate that treats `spcc_completion_type` alone as current completion. A type is valid only with a current date/status. Use one shared classifier based on `getFacilityInspectionExpiry` or an equivalent pure helper for:
   - route markers
   - non-route/search markers
   - completed visibility IDs
2. Do not wire the new button only to `startNewRun()` and call it done. The current main marker check is still driven by compliance, so the existing Plan reset cannot clear it.
3. Decouple the main route check from compliance. Route check = current route-status run/stop. Compliance badges/details = durable inspection/plan facts.

### Exact functional requirements

1. Add `Reset route status` to Route actions.
2. Use an in-app confirmation modal with exact scope choices: `SPCC Inspection`, `SPCC Plan`, `All Facilities`.
3. Default scope to the active route-mode tab. Show route name, team, and affected current-route stop count.
4. Scope state by account ID + current saved route ID + team number + normalized route-status scope.
5. If there is no `currentRouteId`, do not perform an account-wide reset. Require the route to be saved first.
6. Inspection reset clears only current-route Inspection checks. Plan reset clears only current-route Plan checks. All Facilities clears both atomically for this route/team.
7. Custom survey types remain unchanged.
8. After success, selected-scope route stops are pending and no main route check is visible until a new completion is recorded in the active run.
9. Inspection stop completion must be attached to successful inspection/manual completion after the reset. Plan stop completion must use the existing outing stop state, not five-year plan validity.
10. Preserve inspection rows, completion dates/types, plan files/dates/workflow, photos, photo history, schedules, visibility preferences, day assignments, route membership, and route geometry.
11. Persist server-side. Require online commit for reset; local storage is validated recovery cache only.
12. Make retries idempotent and prevent double-submit races.
13. Update inline and fullscreen maps from the committed result without requiring a page reload.
14. Keep due/overdue/expiring compliance warnings visible after a route reset.

### Database and tenant requirements

1. Validate `auth.uid()` and `user_has_account_access(account_id)` in the RPC.
2. Lock/verify the route row belongs to the same account before resetting.
3. Verify every referenced facility belongs to that account and current route.
4. Include account/route/team/scope in rows, indexes, reads, cache keys, and uniqueness.
5. If reusing `plan_route_runs`, widen the Plan-only model carefully and change the active-run unique index to include scope/survey type. The current `(route_plan_id, team_number)` index is insufficient.
6. Enable RLS and account-access SELECT policy; keep writes behind `SECURITY DEFINER SET search_path = public, pg_temp`; revoke PUBLIC/anon and grant authenticated only.
7. Reject cross-account route/run/facility substitution in automated tests.

### UX copy requirement

Confirmation body should state: `This clears route completion checks and starts fresh route status. Inspection records, SPCC plans, photos, schedules, and route assignments are not changed.`

Use `Cancel` and `Reset route status`. Keep the modal open on failure. Disable the action while saving. The colored confirm action must include explicit `text-white`.

### Minimum verification before handback to Quinn

- unit tests for current/expired/manual inspection classification and newest-completed selection
- scope-isolation tests for Inspection, Plan, All, route, team, and account
- RPC cross-tenant substitution tests
- refresh/second-device persistence check
- offline/failure check proving no false local reset
- idempotent double-submit check
- inline/fullscreen map parity
- route list and map parity
- `npm run typecheck`
- focused tests plus production build

See `bmad/qa_report_quinn.md` for evidence, source references, and the full regression matrix.

## 2026-10-17 - Marco to Dev: Route status reset implementation

**Architecture:** `bmad/architecture_marco.md`

Implement this as a focused extension of the existing Plan route-run pattern. Do not add a client-only reset flag and do not create a second unrelated progress subsystem.

### Required implementation order

1. First add `survey_type = 'spcc_plan'` to every existing Plan active-run query/RPC path. This compatibility guard must ship before multiple active domains can exist.
2. Add `supabase/migrations/20261017043000_route_status_reset.sql` with:
   - active uniqueness on account + route + team + `survey_type`
   - allowed domains `spcc_inspection` and `spcc_plan`
   - stop scope dimensions populated from the parent run
   - private `route_status_reset_requests`
   - `reset_route_status(...)` with route locking, authoritative server-side stop derivation, scope expansion, history preservation, idempotency, fixed `search_path`, and authenticated-only execution
   - `complete_inspection_route_stop(...)` with run/stop/facility/account validation and idempotency
   - explicit Plan-scope checks in all existing Plan RPCs
3. Replace Plan-only client coordination with one account/route/team/scope-aware `useRouteStatusRuns` source. Its local cache is read-only recovery state and must validate account, route, team, scope, run, and stops.
4. Add `Reset route status` under Route actions. Use an in-app modal, not `window.confirm`. Choices are exactly SPCC Inspection, SPCC Plan, and All Facilities. Use the required copy from Quinn's handoff. Disable without a saved route or connection. Keep errors in the open modal. Use explicit `text-white` on the colored confirm action.
5. Feed the committed state from the one hook to RouteResults, inline RouteMap, fullscreen RouteMap, and SurveyMode. Do not optimistically clear checks.
6. Extract one pure route-status render model and one canonical inspection classifier. The newest completed inspection, not a newer draft, controls compliance. A manual type without a current date is never completed. Visibility filters remain compliance-based and are never reset.
7. After a successful formal or manual Inspection completion, explicitly complete that facility's stop only when it belongs to the active Inspection run. Keep Plan completion on the existing photo RPC. Never infer post-reset completion from an old facility snapshot or date-only comparison.
8. Off-route markers may show compliance urgency but must not show the current-route completion check glyph.

### Hard constraints

- Reset may write only route run/stop rows and the private reset request journal.
- Do not update inspections, facility SPCC fields, SPCC plans, photos/history, schedules, notifications, route membership/geometry, day/team assignments, or visibility preferences.
- All is one transaction that creates fresh Inspection and Plan runs. It is not a stored third scope.
- Custom survey types are unchanged.
- Preserve ended runs as completed/abandoned history; never bulk-reopen prior stops.
- Reject account, route, team, run, stop, and facility substitution server-side.

### Gate before Quinn re-test

- Same-key retry and rapid double-submit create one logical reset.
- Failed/offline reset leaves prior checks visible.
- Inspection-only, Plan-only, and All scope isolation pass across another route, team, and account.
- Refresh and second-device state match the committed server result.
- Inline map, fullscreen map, route list, and Survey Mode agree.
- Expired/null-date manual completion and newer-draft cases do not get compliance checks.
- `npm run typecheck`, focused route-status tests, and `npm run build` pass.

## 2026-10-17 - Dev to Quinn: implementation complete

Implemented Story 001 on `miles/reset-route-status-20261017` without applying SQL, committing, pushing, or deploying.

### QA focus

- Apply the additive migration only in an isolated QA database before exercising the UI.
- Verify Inspection, Plan, and All reset isolation across a second route, team, and account.
- Retry the same reset request and double-submit; confirm one logical reset and one active run per domain tuple.
- Confirm offline/server failure leaves prior checks visible and the modal open.
- Confirm refresh and another authorized client load the same committed runs.
- Confirm inline/fullscreen maps, route list, and Survey Mode agree after reset and after a new completion.
- Confirm expired/expiring/undated manual completions and a newer draft do not create completed checks.
- Confirm reset does not change inspections, facility SPCC fields, plan records, photos/history, schedules, assignments, route data, or visibility preferences.
- Confirm custom survey modes do not expose the reset action.

### Verification evidence

- Focused route-status tests: 10 passed, 0 failed.
- Production build: passed.
- Focused ESLint for all newly added TypeScript modules: passed.
- Diff whitespace check: passed.
- Full typecheck remains red on pre-existing repository-wide errors; focused output contains no new route-status module errors.

### Known release constraint

The generalized client expects the new stop scope columns and RPCs. Follow Marco's staged order: deploy the one-line Plan active-run scope guard first, apply the migration, then deploy the generalized client/UI.

## 2026-10-17 - Quinn final gate to Dev

**Gate: NO-GO**

The main RouteMap path now uses durable route status correctly, but eight issues remain before release:

1. RouteResults current-route inspection icons and completed-panel All semantics still use compliance/ad hoc logic instead of the shared route-status model.
2. Survey Mode only consults Inspection run state; Plan and All remain compliance-derived, and Inspection fallback still disagrees with the canonical classifier.
3. `useRouteStatusRuns` dropped the old active Plan run synchronization. Route additions after initialization cannot be completed because no stop exists; synchronize initialized domains from locked saved-route data.
4. `complete_inspection_route_stop` accepts any completed formal record and manual dates up to one year old. Reject expired and expiring evidence using the same canonical threshold as rendering.
5. Formal/manual route-status completion failures are not visibly surfaced and there is no same-key retry path. Preserve compliance success, show partial failure, and retain the request UUID for retry.
6. The canonical classifier gives any manual type/date absolute precedence, so stale manual evidence can hide a newer valid formal completion. Compare all completed evidence by effective date.
7. Guard Plan mutation against missing account/saved route before the fallback query and handle query errors inside the mutation path.
8. Split rollout into two actual deployable artifacts: compatibility-only old client guard, then migration, then generalized client. The current combined tree cannot serve as stage 1.

Re-test requirements are in `bmad/qa_report_quinn.md`. Runtime SQL, cross-tenant, concurrency, browser parity, offline, second-device, and completion flows remain unverified because no isolated QA database/browser harness was available.

## 2026-10-17 - Dev to Quinn: QF-1 through QF-8 correction handoff

All eight static gate findings have been addressed in the working tree; no SQL was applied and nothing was committed, pushed, or deployed.

### Corrections

1. **QF-1:** RouteResults completed panels and current-route icons now use `getRouteStatusRenderModel` for Inspection, Plan, and All.
2. **QF-2:** Survey Mode now uses the same two-domain render model and canonical inspection classifier; compliance badges remain separate from route progress.
3. **QF-3:** `sync_route_status_run_stops` derives active-run membership from the locked saved route, and the coordinator resynchronizes initialized domains after planned-stop changes.
4. **QF-4:** Formal completion must reference a completed inspection updated during the active run and current beyond the 60-day warning threshold. Manual completion uses private, action-bound evidence recorded during the run and revalidates facility state.
5. **QF-5:** Partial route-status failure after a successful compliance save produces a visible global notice and retains the same request UUID/source record for Retry.
6. **QF-6:** The canonical classifier compares every completed manual/formal candidate by newest effective date before applying expiry/warning status.
7. **QF-7:** Plan mutation rejects missing account/saved-route/team/offline state before fallback lookup; the scoped fallback query and errors remain inside the mutation path.
8. **QF-8:** `bmad/stages/stage_1_compatibility.patch` is a valid compatibility-only patch, and `bmad/stages/README.md` documents exact Stage 1, Stage 2A, Stage 2B, and rollback boundaries.

### Verification

- `npm run test:route-status`: PASS, 18 passed, 0 failed.
- `npm run build`: PASS (existing bundle-size, browser-data, and mixed dynamic/static import warnings only).
- Focused ESLint for the new route-status hook, modal, notice, classifiers, and inspection utility: PASS.
- `git diff --check`: PASS.
- Stage 1 patch reverse-apply check against the combined tree: PASS.
- Full `npm run typecheck`: repository baseline remains red with 121 errors; focused output contains no new route-status module errors.
- Full touched-file ESLint remains red on existing legacy debt: 92 errors and 29 warnings.

### Required runtime re-test

Use an isolated QA database/browser harness to compile/apply the migration and verify cross-tenant substitution rejection, atomic All reset, same-key concurrency, server-authoritative route-edit synchronization, formal/manual evidence validation, visible Retry, offline behavior, refresh/second-device persistence, and inline/fullscreen/list/Survey Mode parity. Production remains unchanged.

## 2026-10-17 - Quinn correction re-test to Dev

**Gate: NO-GO**

QF-1, QF-2, QF-4, QF-5, QF-6, QF-7, and QF-8 pass static re-review. QF-3 remains incomplete, and one additional manual-completion surface is not wired.

### Required corrections

1. In `_sync_plan_route_run_stops`, restore a re-added non-completed stop to `pending`. The conflict branch currently clears `removed_at` but leaves `status = 'removed'`, so Inspection completion rejects the re-added stop. Preserve `completed`; set every other re-added state to `pending`. Add remove/re-add tests for Inspection and Plan.
2. Route `FacilitiesManager.handleBulkMarkComplete` through the evidence/route-status completion contract. It currently writes facility completion fields directly and leaves active Inspection stops pending. Provide per-facility partial-failure/retry behavior or disable the action when it cannot honor active route status.

### Verification

- 18/18 focused tests passed.
- Combined build passed.
- Focused route-status lint passed.
- Diff check passed.
- Stage 1 patch clean-applied to `origin/main`, changed only one line/file, built successfully in isolation, and reverse-applied cleanly against the combined tree.
- SQL remains static-only; isolated database compile/RLS/concurrency tests are still mandatory.

See `bmad/qa_report_quinn.md` for exact evidence, SQL runtime caveats, and deployment conditions.

## 2026-10-17 - Dev to Quinn: second correction handoff

The two remaining static blockers are corrected in the working tree.

### RQ-1 — remove/re-add synchronization

- `_sync_plan_route_run_stops` now sets a conflicted current-route stop to `pending` unless its existing status is `completed`.
- The generalized function uses `v_run.survey_type`, so the same transition applies to Inspection and Plan runs.
- The focused contract test covers removed → pending, pending → pending, and completed → completed for both domains.

### RQ-2 — Facilities bulk manual completion

- `FacilitiesManager.handleBulkMarkComplete` no longer directly updates facility completion columns.
- App injects the shared coordinator's `recordManualInspectionCompletion` callback.
- Every selected facility records account-scoped manual evidence and completes its matching active Inspection stop. Off-route facilities save compliance without inventing route progress.
- Multiple route-status failures queue their facility/evidence/request tuples. The global notice exposes one facility at a time, preserves the same request UUID for Retry, and advances through the queue.
- The bulk modal stays open with the affected facilities selected and explains that saved compliance remains intact. It blocks duplicate submission while processing.
- Successful bulk stop completions accumulate through a functional state update, avoiding stale-closure loss across sequential facilities.

### Verification

- `npm run test:route-status`: PASS, 20 passed, 0 failed.
- `npm run build`: PASS with only the established bundle/browser-data/mixed-import warnings.
- Focused route-status/component ESLint: PASS.
- `git diff --check`: PASS.
- Full typecheck remains at the same 121 repository errors; focused output shows only established App/FacilitiesManager unused-symbol debt and no new errors.

No SQL was applied. No commit, push, or deployment occurred. Migration compilation, real remove/re-add behavior, bulk partial failures, RLS, concurrency, offline, browser parity, refresh, and second-device behavior still require the isolated QA gate.

## 2026-10-17 - Quinn third/final gate

**Gate: GO WITH CONDITIONS**

All QF-1 through QF-8 findings and both second-gate blockers now pass static review.

- Re-added non-completed stops return to pending for both Inspection and Plan; completed stops remain completed.
- Facilities bulk manual completion uses the shared evidence/active-stop pathway rather than direct facility updates.
- Multiple failures retain exact per-facility evidence and request UUIDs, retry with the same key, and advance one notice at a time.
- The bulk modal blocks duplicate/close actions while busy and remains open with failed selections after partial failure.
- Off-route facilities save compliance without creating route progress.
- 20/20 focused tests, combined build, focused lint, diff check, Stage 1 clean apply/build, and combined-tree reverse-apply passed.
- Full typecheck remains red with the same 121 established repository errors; no focused route-status module errors were reported.

The gate is conditional because the migration was not compiled or executed against PostgreSQL and no real RLS, concurrency, offline, partial-failure, refresh/second-device, or browser-parity harness was available. Follow the Stage 1 -> isolated Stage 2A QA -> production Stage 2A -> Stage 2B order in `bmad/qa_report_quinn.md`. This gate does not authorize production SQL or deployment.
