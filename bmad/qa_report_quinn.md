# Quinn Third/Final Gate: Route Status Reset

## Gate

**Recommendation: GO WITH CONDITIONS**

All previously identified static blockers are corrected. The implementation now has consistent current-route semantics across the map, route list, and Survey Mode; server-persisted scoped resets; formal and manual Inspection completion linkage; Plan legacy preservation; re-added-stop recovery; and queued same-key retry for bulk manual-completion partial failures.

This is a static/build gate, not authorization to apply SQL or deploy. The additive migration has not been compiled or exercised against PostgreSQL, RLS, real concurrency, or a browser in this environment. Release must follow the staged conditions below.

No production SQL, deployment, commit, or push was performed.

## Acceptance and correction audit

| Item | Result | Evidence |
|---|---|---|
| Inspection, Plan, and All reset scope | PASS (static) | Reset is account + saved route + team scoped. All expands to Inspection and Plan in one server transaction rather than storing a third domain. |
| Compliance/history preservation | PASS (static) | Reset writes only route-run, stop, and reset-journal state; it does not rewrite inspections, facility SPCC fields, plans, photos, schedules, assignments, route membership, or preferences. |
| Tenant and object isolation | PASS (static) | RPCs validate authenticated account access and bind account, route, team, run, facility, domain, and stop relationships server-side. Runtime RLS/adversarial tests remain required. |
| Idempotency | PASS (static) | Request UUIDs are journaled and route-locked; retries reuse the same action key. Real simultaneous-request behavior remains a runtime gate. |
| Current-route/off-route checks | PASS (static) | Active, non-removed stops drive route checks. Compliance stays separate. Off-route completion saves compliance without inventing route progress. |
| Offline/server reset failure | PASS (static) | Client rejects offline reset before mutation and updates local run state only after server success; modal remains recoverable on failure. Browser/offline simulation remains required. |
| Plan legacy behavior | PASS (static) | Stage 1 adds the required Plan scope filter, and the generalized Plan completion path retains existing photo/stop behavior behind guarded account/route/team/offline checks. |
| Formal/manual completion wiring | PASS (static) | Current formal evidence and action-bound private manual evidence explicitly complete a matching active Inspection stop. Stale/expiring/draft evidence is excluded. |
| QF-1 RouteResults parity | PASS | Shared `getRouteStatusRenderModel` is used for route rows and completed panels; compliance is informational only. |
| QF-2 Survey Mode parity | PASS (static) | Inspection, Plan, and All use the shared two-domain model and canonical Inspection classifier. |
| QF-3 initialized-run synchronization | PASS (static) | Saved-route changes call authoritative sync; the SQL conflict path now preserves completed stops and restores every other re-added stop to pending for both domains. |
| QF-4 evidence freshness | PASS (static) | Formal completion must be completed, current, and updated during the run; manual evidence is action-bound, current, and run-fresh. |
| QF-5 partial-failure recovery | PASS (static) | Failed route completion retains facility/source/evidence/request UUID, exposes Retry, and reuses the same key. |
| QF-6 newest evidence selection | PASS | Completed manual and formal candidates are compared by effective date; drafts are excluded. |
| QF-7 Plan mutation guard | PASS | Missing account/route/team and offline state are rejected before lookup; fallback errors stay within the guarded mutation. |
| QF-8 staged rollout | PASS | Stage 1 patch applies to `origin/main`, builds independently, and reverse-applies against the combined tree. |
| RQ-1 remove/re-add semantics | PASS (static) | `_sync_plan_route_run_stops` now sets a conflicted current-route stop to `pending` unless its existing status is `completed`; `v_run.survey_type` makes this common to Inspection and Plan. Focused tests cover removed/pending/completed transitions in both domains. |
| RQ-2 Facilities bulk manual completion | PASS (static) | `FacilitiesManager` now awaits the shared manual coordinator per facility. Failures retain only affected selections, keep the modal open, and queue exact evidence/request tuples for same-key retry. |

## Final focused review

### Re-added stop semantics

The generalized sync conflict branch now performs the required transition:

```sql
status = CASE
  WHEN plan_route_run_stops.status = 'completed' THEN 'completed'
  ELSE 'pending'
END,
removed_at = NULL
```

Consequences:

- removed then re-added becomes pending and is visible/completable again;
- already-pending remains pending;
- completed history remains completed;
- the same logic applies to Inspection and Plan through the active run's `survey_type`.

This is correct by static inspection and source-contract tests. It remains unverified against a live PostgreSQL schema.

### Bulk manual completion, retry queue, and modal

- The bulk handler no longer directly writes the facility completion columns.
- It calls `recordManualInspectionCompletion` sequentially for each selected facility, so each successful compliance save attempts active-stop completion through the shared path.
- Functional state updates prevent sequential successful completions from overwriting one another.
- Each failed route-status completion queues its exact facility, source, evidence ID, and request UUID. Retry uses that same UUID; success removes only that entry and advances the notice to the next queued failure.
- Facilities without an active, non-removed Inspection stop return success after the compliance/evidence save and do not receive route progress.
- While processing, submit, cancel, backdrop close, and close controls cannot trigger a duplicate or dismiss the modal. Partial failures keep the modal open, retain failed facility selections, and explain that compliance was saved.

These behaviors pass static review and focused source-contract tests. Real Supabase partial failures and browser interaction remain unverified.

## SQL static review

### Verified statically

- Referenced pre-existing tables, columns, helpers, and the legacy Plan photo RPC signature are compatible with prior migrations.
- Function signatures and grants are internally consistent.
- `SECURITY DEFINER` functions set `search_path = public, pg_temp`.
- Reset locks the account-bound saved route, derives server-authoritative membership, and performs All atomically.
- Account/route/team/domain/run/stop/facility substitution checks are present across reset, sync, Plan mutation, manual evidence, and Inspection completion.
- Reset and explicit completion are separated: reset cannot mutate compliance records.
- The re-add upsert's table-qualified status reference is legal PostgreSQL `ON CONFLICT DO UPDATE` syntax by static inspection.

### Runtime-only risks and caveats

- PostgreSQL did not parse or execute the migration here; focused tests inspect contracts/source rather than a live database.
- Migration DDL uses non-concurrent table/index/constraint operations. Measure locks on production-sized data before production application.
- The one-shot `ALTER FUNCTION ... RENAME TO _set_plan_route_stop_photos_legacy` assumes the exact prior six-argument signature and is not a rerunnable migration.
- Generalized sync selects an active run before locking the route. A concurrent reset could end that run before sync continues; concurrency testing must confirm stale-run results are not cached and that the final active run is synchronized.
- Completion idempotency replay occurs after current run/evidence validation. Confirm the intended stale-action rejection and client reload behavior if the run ends or evidence changes before a retry.
- Cross-account substitution, same-key simultaneous reset/completion, All rollback, old-tab mutation, and RLS behavior are not proven by static review.

## Verification rerun

- `npm run test:route-status`: **PASS, 20/20**.
- Combined `npm run build`: **PASS** with established browser-data, mixed-import, and chunk-size warnings.
- Focused ESLint for route-status hook, modal, completion notice, completion modal, classifiers, and Inspection utilities: **PASS**.
- `git diff --check`: **PASS**.
- Stage 1 patch reverse-apply against the combined tree: **PASS**.
- Stage 1 patch clean apply to detached `origin/main` (`9caa8353307287fd42f64a6acf1d36519a24eed8`): **PASS**.
- Stage 1 isolated `npm run build`: **PASS**.
- Full `npm run typecheck`: **FAIL with 121 established repository errors**; none reference the focused new route-status modules.
- Whole-file lint of legacy `FacilitiesManager.tsx` remains red on established debt (unused symbols, `any`, and hook warnings). The focused changed route-status/component modules are clean; this gate does not claim the legacy file is globally lint-clean.

The 20 focused tests are predominantly pure/source-contract tests. They do not replace migration compile, RLS, concurrency, or browser tests.

## Mandatory release conditions

1. **Stage 1 only:** isolate `bmad/stages/stage_1_compatibility.patch` into its own deployable commit and deploy it while the old schema is still active. Smoke-test existing Plan outing completion.
2. **Stage 2A isolated QA database:** compile/apply the migration to a production-equivalent disposable schema. Run tenant/object substitution, same-key concurrent reset and completion, atomic All rollback, remove/sync/re-add for both domains, and migration lock-duration tests.
3. In the same QA environment, test formal completion, single and bulk manual completion, multiple queued failures, same-key retries, off-route completion, modal busy/partial-failure behavior, offline failure, refresh/process restart, and second-device convergence.
4. Confirm byte-for-byte that reset leaves compliance records, plans, photos/history, schedules, notifications, assignments, saved-route data, and preferences unchanged.
5. **Stage 2A production:** apply the additive migration through the approved manual SQL workflow only after all isolated database gates pass, with Stage 1 client still deployed.
6. **Stage 2B:** deploy the generalized client/UI and smoke-test Inspection, Plan, and All in inline map, fullscreen map, route list, and Survey Mode.
7. Rollback target after Stage 2A is the Stage 1 client, not pre-Stage-1 code. Leave additive schema/history intact unless a separately reviewed recovery migration is required.

## Final recommendation

**GO WITH CONDITIONS.** All known static acceptance blockers, including re-added-stop recovery and Facilities bulk completion/retry integration, are resolved. Stage 1 is independently buildable. Stage 2A/2B must not proceed to production until the isolated PostgreSQL and browser conditions above pass.

## 2026-10-17 isolated PostgreSQL runtime verification

The additive migration compiled against a fresh PostgreSQL 17 database with a production-shaped minimal baseline. Runtime assertions passed for account-scoped Inspection, Plan, and atomic All resets; team/route stop derivation; same-key reset and completion replay; cross-account rejection; manual evidence completion; remove/re-add synchronization; and simultaneous same-key reset requests.

The concurrent result contained one reset-journal row and exactly one active run per stored domain. This closes the isolated SQL compilation, core account-access, idempotency, and concurrency conditions. Browser/offline/second-device verification remains required before Stage 2B production release.

## 2026-10-17 browser component verification

A real Chromium run mounted the production reset modal and partial-completion notice. It verified three reset scopes; route, team, and 138-stop copy; All-domain copy; offline button disablement and explanation; modal persistence after a simulated server failure; queued partial-failure messaging; and successful Retry dismissal. Screenshots were visually inspected. Full authenticated map/list/Survey Mode parity and second-device convergence still require the migrated app environment.
