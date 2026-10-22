# Story 001: Reset current-route status without changing compliance

## User story

As a route planner, I want to reset visible completion checks for SPCC Inspection, SPCC Plan, or both domains on the current saved route/team so a new field outing starts pending while all compliance evidence and route planning data remain intact.

## Acceptance criteria

- `Reset route status` is available from Route actions for built-in SPCC modes.
- The modal shows route, team, affected stop count, and exactly Inspection, Plan, and All choices.
- Reset requires a saved route and network connection, is idempotent, and adopts only the committed server response.
- Inspection-only and Plan-only resets are isolated; All creates both fresh runs atomically.
- The RPC derives current team stops from locked saved-route data and validates account access.
- Previous active runs become completed/abandoned history; old stops are never reopened.
- Reset writes only run/stop/reset-request rows. Compliance, plans, photos/history, schedules, assignments, route data, and visibility preferences are unchanged.
- Current-route check glyphs use active run stops after initialization. Off-route facilities never show a current-route completion check.
- Formal and manual Inspection completions explicitly complete an active Inspection stop; Plan completion retains the photo RPC.
- The newest completed inspection controls compliance fallback; newer drafts and undated/expired/expiring manual completions do not show completed checks.
- Inline/fullscreen maps, route list, and Survey Mode consume the shared run coordinator.
- Initialized Inspection and Plan runs resynchronize stops from locked, authoritative saved-route membership after route edits.
- Formal and manual Inspection route completion require action-bound evidence created during the active run and still current beyond the canonical 60-day warning threshold.
- A compliance save followed by route-status failure remains visible with an idempotent same-key Retry action.
- A removed stop that is re-added to the saved route becomes pending again in either domain, while completed history remains completed.
- Facilities-tab bulk manual completion uses the same per-facility evidence and active Inspection-stop pathway as single completion, with queued visible retries and no compliance rollback.

## Implementation

- Added additive migration `20261017043000_route_status_reset.sql` with scoped uniqueness, stop dimensions/trigger, reset journal, atomic reset RPC, Inspection stop completion RPC, and explicit Plan guards.
- Added `useRouteStatusRuns` with tuple-validated v2 recovery caches and shared state for both domains.
- Added a portaled reset modal and Route actions entry with explicit `text-white` on colored controls.
- Added pure route render and inspection compliance classifiers.
- Attached formal/manual Inspection saves to explicit route-stop completion callbacks.
- Added a private manual-completion evidence journal, scoped run-stop synchronization RPC, and canonical server completion validation.
- Updated RouteResults and Survey Mode to consume the same Inspection/Plan/All route render model used by both maps.
- Added visible partial-failure recovery that retains the completion request UUID for retry.
- Made synchronization restore re-added non-completed stops to pending for both Inspection and Plan.
- Wired Facilities bulk completion through `record_manual_inspection_completion`; route-status failures queue per-facility evidence/request pairs for retry.
- Preserved `usePlanRouteRun` with the required Plan-scope read guard for compatibility.
- Packaged the compatibility-only guard as `bmad/stages/stage_1_compatibility.patch` with staged rollout and rollback instructions in `bmad/stages/README.md`.

## Verification

- `npm run test:route-status`: PASS, 20/20.
- `npm run build`: PASS.
- Focused ESLint on new hook/modal/utilities: PASS.
- `git diff --check`: PASS.
- Stage 1 patch validation: PASS with `git apply --reverse --check bmad/stages/stage_1_compatibility.patch` against the combined worktree.
- `npm run typecheck`: BLOCKED by 121 existing repository-wide TypeScript errors; no errors were reported for the new route-status hook/modal/notice/utilities/types in focused output.
- Touched-file ESLint remains blocked by existing debt in legacy touched files (92 errors, 29 warnings); the focused new route-status module lint passes.

## Deployment note

The migration file is additive but was not applied to any database. Deploy the Plan-scope compatibility guard before applying the migration, then deploy the generalized client/UI. Runtime SQL, browser parity, offline, cross-tenant, concurrency, and second-device checks still require an isolated QA environment.
