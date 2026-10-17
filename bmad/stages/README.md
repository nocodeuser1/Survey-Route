# Route-status staged rollout and rollback

The combined development tree is **not** the Stage 1 artifact. Stage 1 is the isolated one-line patch in `stage_1_compatibility.patch`.

## Stage 1 — old-schema-compatible client guard

From a clean `origin/main` checkout:

1. Apply only `bmad/stages/stage_1_compatibility.patch`.
2. Verify the only application change is `src/hooks/usePlanRouteRun.ts`.
3. Run `npm run build` and the existing Plan outing smoke test against the old schema.
4. Commit/deploy that one file. Do not include `App.tsx`, `useRouteStatusRuns.ts`, the migration, or reset UI.

This release keeps the old coordinator active and adds `survey_type = 'spcc_plan'` to its active-run lookup. It works before and after the additive migration.

**Stage 1 rollback:** before the migration, revert the Stage 1 client commit. After the migration, keep Stage 1 deployed; reverting to an unscoped `.maybeSingle()` becomes unsafe once Inspection runs can exist.

## Stage 2A — additive database migration

After Stage 1 is confirmed live, apply `supabase/migrations/20261017043000_route_status_reset.sql` to an isolated QA database, run SQL isolation/idempotency/evidence tests, then apply it to production through the approved manual SQL workflow.

**Stage 2A rollback:** do not drop the new tables/columns/functions. Leave the additive schema in place and keep/restore the Stage 1 client. Disable access to the generalized reset UI by rolling back Stage 2B. Existing Plan behavior remains scoped to `spcc_plan`.

## Stage 2B — generalized client/UI

Deploy all Story 001 application/test files except the already-deployed Stage 1 line. The client may now use `sync_route_status_run_stops`, `reset_route_status`, `record_manual_inspection_completion`, and `complete_inspection_route_stop`.

**Stage 2B rollback:** restore the Stage 1 client build while leaving the additive migration installed. Do not roll back to pre-Stage-1 code if any Inspection run exists. Route-status run history remains intact and compliance data is unaffected.

## Release gate

- Never apply Stage 2A before Stage 1 is live.
- Never deploy Stage 2B before Stage 2A succeeds.
- Verify a Plan-only old client during the Stage 1/2A boundary.
- Verify reset scope, route edits, same-key retry, cross-account rejection, and second-device reload before production Stage 2B.
