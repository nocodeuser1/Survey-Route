# Marco Retrofit Architecture: Reset Route Status

## 1. Decision summary

This is a focused retrofit, not a new route subsystem.

Extend the existing `plan_route_runs` and `plan_route_run_stops` pattern so a run has one normalized domain:

- `spcc_inspection`
- `spcc_plan`

`All Facilities` is an atomic command that resets both domains. It is not stored as a third run domain.

The reset operation creates a new active run with pending stops for the selected domain or domains. Previous active runs are ended as `completed` or `abandoned` and remain historical. The operation never updates compliance, facility, schedule, route-plan, photo, or visibility-preference rows.

The visible main check on a current-route marker is authoritative from the active run stop whenever that domain has been initialized. Compliance stays visible through badges, warnings, and details. A reset therefore removes route checks without erasing evidence or hiding due/overdue warnings.

For backward compatibility, a domain with no route-status run yet may continue to show the existing canonical compliance result. The first reset or first route-associated completion initializes that domain. Once a run exists, the client must never fall back to historical compliance for its main route check. This avoids silently clearing every customer's current checks on deployment while still making the reset durable and explicit. A later data migration may initialize all saved routes if product chooses to remove this compatibility state.

## 2. Architecture Decision Records

### ADR-1: Generalize the existing run tables in place

**Decision:** Keep the physical table names `plan_route_runs` and `plan_route_run_stops` for rollout compatibility, but widen their contract from Plan-only to route-status runs keyed by `survey_type`.

**Why:** The existing implementation already provides the needed durable run history, pending/completed stops, account-scoped RLS, saved-route membership derivation, route-row locking, cache recovery, and hardened Plan photo transitions. A new parallel reset table would duplicate those guarantees and create two sources of truth.

**Constraint:** The legacy table names are implementation details. New TypeScript types and helpers should use `RouteStatusRun` and `RouteStatusRunStop`. Do not rename the database tables in this feature because migrations are manually applied and an immediate rename would break older deployed clients.

### ADR-2: Two stored domains, one atomic All command

**Decision:** Store only `spcc_inspection` and `spcc_plan`. `all` is accepted by the reset RPC and expanded to both domains inside one transaction.

**Why:** A third `all` run would drift from its children and make scope isolation ambiguous. An atomic two-domain reset gives All the expected union semantics while Inspection-only and Plan-only remain independent.

### ADR-3: Route progress overrides, but never rewrites, compliance

**Decision:** For a current-route stop:

1. If an active run exists for the displayed domain, the main check is `stop.status = 'completed'`.
2. If the domain has never been initialized, use the shared canonical compliance classifier only as a legacy display fallback.
3. After any reset, the new active run exists, every selected-domain stop is pending, and the fallback is impossible for that domain.

Inspection due/overdue/expiring state and Plan validity remain separate visual facts. They do not become stop completion after a reset.

For `all`, a current-route check is present when either active domain stop is completed. After an All reset both are pending, so no main check is shown. If the UI can support two small domain indicators later, that can clarify which domain completed, but it is not required for this update.

**Off-route markers:** Never render the main current-route completion check from route-run state. They may retain compliance colors/pips and descriptive badges, but must use a non-check marker glyph so they cannot be read as completed stops on the loaded route.

### ADR-4: Reset is one server transaction with request idempotency

**Decision:** Add `reset_route_status(...)` as a `SECURITY DEFINER` RPC and a private request journal. The RPC locks the saved route row, validates account access, derives authoritative stops from `route_plans.plan_data`, ends matching active runs, creates new pending runs, and returns their committed stops.

**Why:** Client-side clear flags, timestamps, or bulk stop updates cannot provide atomic All behavior, tenant safety, retry safety, or second-device persistence.

### ADR-5: Completion is explicit after reset

**Decision:** A post-reset inspection stop is completed only by an explicit route-associated completion callback after a formal inspection or dated internal/external completion succeeds. A Plan stop remains driven by the existing `set_plan_route_stop_photos` RPC.

Do not infer completion by comparing `facilities.spcc_inspection_date` to `run.started_at`. That field is date-oriented and same-day/time-zone comparisons are ambiguous. The explicit stop transition is the durable fact.

## 3. System diagram

```text
Route actions
  -> ResetRouteStatusModal
       account + saved route + effective team + selected scope + request UUID
  -> reset_route_status RPC
       auth/account check
       lock route_plans row
       replay or reserve idempotency request
       derive route/team stops from saved plan_data
       end old active scope run(s)
       create pending scope run(s)
       return committed run(s) + stop(s)
  -> useRouteStatusRuns
       replace in-memory scope maps from RPC response
       write validated read-only recovery cache
       feed the same state to route list, inline map, fullscreen map, Survey Mode

Compliance sources                         Route-display sources
  inspections                               plan_route_runs
  facilities.spcc_*                         plan_route_run_stops
  spcc_plans                                explicit completion RPCs
        |                                           |
        +-> badges, warnings, detail                 +-> main current-route check
```

There is intentionally no reset path from the route RPC to the compliance side of the diagram.

## 4. Exact database changes

Create one additive migration, suggested name:

`supabase/migrations/20261017043000_route_status_reset.sql`

### 4.1 Widen run scope and active uniqueness

```sql
ALTER TABLE public.plan_route_runs
  DROP CONSTRAINT IF EXISTS plan_route_runs_survey_type_check;

ALTER TABLE public.plan_route_runs
  ADD CONSTRAINT plan_route_runs_survey_type_check
  CHECK (survey_type IN ('spcc_inspection', 'spcc_plan')) NOT VALID;

ALTER TABLE public.plan_route_runs
  VALIDATE CONSTRAINT plan_route_runs_survey_type_check;

DROP INDEX IF EXISTS public.idx_plan_route_runs_one_active_per_plan;

CREATE UNIQUE INDEX idx_plan_route_runs_one_active_per_scope
  ON public.plan_route_runs (
    account_id,
    route_plan_id,
    team_number,
    survey_type
  )
  WHERE status = 'active' AND route_plan_id IS NOT NULL;

CREATE INDEX idx_plan_route_runs_scope_lookup
  ON public.plan_route_runs (
    account_id,
    route_plan_id,
    team_number,
    survey_type,
    status
  );
```

Every Plan query and function must add `survey_type = 'spcc_plan'`. Every new Inspection query uses `survey_type = 'spcc_inspection'`. A `.maybeSingle()` query without scope is invalid after this migration.

### 4.2 Carry isolation dimensions on stop rows

The run remains authoritative, but denormalizing the dimensions makes every stop auditable and indexable by the complete isolation tuple.

```sql
ALTER TABLE public.plan_route_run_stops
  ADD COLUMN IF NOT EXISTS route_plan_id uuid
    REFERENCES public.route_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_number integer,
  ADD COLUMN IF NOT EXISTS survey_type text;

UPDATE public.plan_route_run_stops stop
SET route_plan_id = run.route_plan_id,
    team_number = run.team_number,
    survey_type = run.survey_type
FROM public.plan_route_runs run
WHERE run.id = stop.route_run_id
  AND (
    stop.route_plan_id IS DISTINCT FROM run.route_plan_id OR
    stop.team_number IS DISTINCT FROM run.team_number OR
    stop.survey_type IS DISTINCT FROM run.survey_type
  );

ALTER TABLE public.plan_route_run_stops
  ADD CONSTRAINT plan_route_run_stops_team_check
    CHECK (team_number IS NULL OR team_number > 0),
  ADD CONSTRAINT plan_route_run_stops_survey_type_check
    CHECK (survey_type IS NULL OR survey_type IN ('spcc_inspection', 'spcc_plan'));

CREATE INDEX idx_plan_route_run_stops_scope_status
  ON public.plan_route_run_stops (
    account_id,
    route_plan_id,
    team_number,
    survey_type,
    route_run_id,
    status
  );
```

Update `_sync_plan_route_run_stops` so every insert copies `route_plan_id`, `team_number`, and `survey_type` from the locked run. Add a private `BEFORE INSERT OR UPDATE OF route_run_id` trigger that overwrites those fields from the referenced run. The trigger prevents a future function from creating a mixed-scope row. Keep `route_plan_id` nullable only because saved-route deletion preserves historical runs and sets the parent route reference to null.

### 4.3 Reset request journal

```sql
CREATE TABLE public.route_status_reset_requests (
  idempotency_key uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  route_plan_id uuid NOT NULL REFERENCES public.route_plans(id) ON DELETE CASCADE,
  team_number integer NOT NULL CHECK (team_number > 0),
  requested_scope text NOT NULL
    CHECK (requested_scope IN ('spcc_inspection', 'spcc_plan', 'all')),
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_route_status_reset_requests_scope
  ON public.route_status_reset_requests (
    account_id,
    route_plan_id,
    team_number,
    created_at DESC
  );

ALTER TABLE public.route_status_reset_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.route_status_reset_requests
  FROM PUBLIC, anon, authenticated;
```

The journal is RPC-private. It is not a user-facing audit table and needs no direct SELECT policy.

### 4.4 Generalize the existing stop-action journal

Keep the physical `plan_route_stop_action_requests` name for compatibility, but widen it for explicit inspection stop completion:

```sql
ALTER TABLE public.plan_route_stop_action_requests
  ADD COLUMN IF NOT EXISTS route_plan_id uuid
    REFERENCES public.route_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_number integer,
  ADD COLUMN IF NOT EXISTS survey_type text NOT NULL DEFAULT 'spcc_plan',
  ADD COLUMN IF NOT EXISTS action_kind text NOT NULL DEFAULT 'plan_photos',
  ADD COLUMN IF NOT EXISTS source_record_id uuid;

ALTER TABLE public.plan_route_stop_action_requests
  ADD CONSTRAINT plan_route_stop_action_scope_check
    CHECK (survey_type IN ('spcc_inspection', 'spcc_plan')),
  ADD CONSTRAINT plan_route_stop_action_kind_check
    CHECK (action_kind IN ('plan_photos', 'inspection_complete'));
```

Backfill route/team from the referenced run and have both stop RPCs insert the full tuple. Update the table comment to state that this is the private idempotency journal for all route-status stop actions. A table rename is deliberately deferred.

### 4.5 Permissions on generalized run tables

Preserve the existing account-access SELECT policies. Make the write boundary explicit:

```sql
REVOKE INSERT, UPDATE, DELETE
  ON public.plan_route_runs, public.plan_route_run_stops
  FROM PUBLIC, anon, authenticated;

GRANT SELECT
  ON public.plan_route_runs, public.plan_route_run_stops
  TO authenticated;
```

All writes remain behind fixed-search-path `SECURITY DEFINER` functions.

## 5. Exact RPC contracts

### 5.1 `reset_route_status`

```sql
public.reset_route_status(
  target_account_id uuid,
  target_route_plan_id uuid,
  target_team_number integer,
  target_scope text,
  target_idempotency_key uuid
) RETURNS jsonb
```

Required behavior, in order:

1. Reject a null `auth.uid()`.
2. Reject a null/invalid team or a scope outside `spcc_inspection`, `spcc_plan`, `all`.
3. Require `user_has_account_access(target_account_id)`.
4. Lock exactly the route row matching both `id` and `account_id` with `FOR UPDATE`. A route substitution from another account must return no row and fail.
5. Check the request journal. If the key exists, require the same account/route/team/scope tuple and return its stored response. Reject reuse for another tuple.
6. Derive the authoritative current route/team stop set through `_route_plan_assignments_from_data(target_account_id, locked_plan_data)`. Never accept a facility list from the client.
7. Expand the requested scope to one or both stored domains.
8. For each selected domain, end the prior active run on the exact account/route/team/domain tuple. Mark it `completed` only if all non-removed stops were completed; otherwise mark it `abandoned`. Set `ended_at` and `ended_by`.
9. Insert one new active run per selected domain and sync only the authoritative stops assigned to the effective team. Every inserted stop starts `pending` with completion fields null.
10. Return and journal one response shaped as:

```json
{
  "account_id": "uuid",
  "route_plan_id": "uuid",
  "team_number": 1,
  "requested_scope": "all",
  "runs": [
    {
      "survey_type": "spcc_inspection",
      "run": { "id": "uuid", "status": "active" },
      "stops": [
        { "id": "uuid", "facility_id": "uuid", "status": "pending" }
      ]
    },
    {
      "survey_type": "spcc_plan",
      "run": { "id": "uuid", "status": "active" },
      "stops": []
    }
  ],
  "unique_facility_count": 12,
  "domain_stop_count": 24
}
```

The request-journal insert and response update occur in the same transaction as the reset. PostgreSQL function execution supplies the transaction boundary. `all` either commits both domains or neither.

Security and grants:

```sql
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.reset_route_status(uuid, uuid, integer, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_route_status(uuid, uuid, integer, text, uuid)
  TO authenticated;
```

### 5.2 Existing Plan RPC hardening

Update these functions without changing their public signatures:

- `start_plan_route_run`: every select/update includes `account_id` and `survey_type = 'spcc_plan'`; inserts remain Plan scope. Keep `force_new` for older clients, but the new reset UI must not use it.
- `sync_plan_route_run_stops`: reject a run whose `survey_type <> 'spcc_plan'`.
- `set_plan_route_stop_photos`: reject a run whose `survey_type <> 'spcc_plan'`; keep photo snapshot/history behavior unchanged.
- `_sync_plan_route_run_stops`: derive stops from the saved route as today and populate all denormalized scope fields. Do not trust `target_stops`.

### 5.3 Inspection stop completion RPC

```sql
public.complete_inspection_route_stop(
  target_run_id uuid,
  target_facility_id uuid,
  target_source text,
  target_source_record_id uuid,
  target_idempotency_key uuid
) RETURNS jsonb
```

Allowed sources are `inspection`, `manual_internal`, and `manual_external`.

The function must:

1. Load and lock an active `spcc_inspection` run.
2. Validate auth and account access from the run, not from a client account field.
3. Lock the active stop and require that its account/route/team/scope tuple equals the run tuple.
4. Require the facility to belong to the run account and the stop to belong to the active saved-route run.
5. For source `inspection`, require `source_record_id` to identify a completed inspection for that facility/account. For manual sources, require the facility currently has the matching completion type and a non-null inspection date. This validation proves the compliance write succeeded, but the explicit stop transition, not date comparison, proves route completion.
6. Reserve/replay the full request in the generalized action journal.
7. Set only the stop to `completed`, with `completed_at = now()`, `completed_by = auth.uid()`, and `updated_at = now()`.
8. Return the committed stop payload.

This RPC must never write `inspections`, `facilities`, schedules, or plans. If the route-status call fails after a compliance save, compliance remains correct and the UI reports that route status could not be updated. Retrying with the same key is safe.

## 6. Client state flow

### 6.1 One coordinator at `App.tsx`

Replace the Plan-only top-level coordination with `useRouteStatusRuns` keyed by:

```text
accountId + currentRouteId + effectiveTeam + scope
```

The hook loads active runs for both stored domains with one scoped query. It exposes:

```ts
type RouteStatusScope = 'spcc_inspection' | 'spcc_plan';
type ResetRouteStatusScope = RouteStatusScope | 'all';

{
  runsByScope,
  stopsByScope,
  resetRouteStatus(scope, requestId),
  completeInspectionStop(...),
  setPlanStopCompleted(...),
  resetting,
  savingFacilityIdByScope,
  loading,
  error,
  reload
}
```

Keep `usePlanRouteRun.ts` temporarily as a thin compatibility adapter if needed, but there must be one in-memory source for map and list state. Do not mount separate hooks for inline and fullscreen maps.

### 6.2 Read-only recovery cache

Use versioned keys:

```text
surveyroute:route-status:v2:{accountId}:{routePlanId}:{teamNumber}:{scope}
```

Validate the key tuple against the run and every stop before hydration. Cache only active runs. On account/route/team change, synchronously clear in-memory maps before reading another key. A mixed-account payload is deleted and ignored.

Offline state is read-only. The modal submit is disabled offline. Never clear checks optimistically. After the RPC commits, replace both selected-scope maps from the returned server payload, then write cache. If the follow-up cache write fails, the committed in-memory state remains valid.

### 6.3 Reset sequence

1. User opens the modal from Route actions.
2. Generate one request UUID and retain it for retries while route/team/scope are unchanged.
3. Validate online state and a stable `currentRouteId`.
4. Submit once; disable Cancel and Reset only while the request is in flight.
5. Call `reset_route_status` with no facility IDs.
6. Validate the returned account/route/team/scope tuple before adopting it.
7. Replace selected scope state in one React state update. For All, replace both maps together.
8. Close the modal and announce success only after the shared state has updated. Both maps and the route list re-render from that same state.
9. On error, keep the modal open, keep old checks, display the error, and reuse the request UUID on retry.

### 6.4 Completion sequence

**Formal inspection:** `InspectionForm` must return the saved completed inspection ID. After the inspection commit succeeds, the route-aware parent calls `completeInspectionStop` for the active Inspection run. Refresh compliance data and route status independently.

**Manual internal/external completion:** after the facility update succeeds, pass the facility ID and completion kind to the same route-aware parent, which calls `completeInspectionStop`.

**Plan:** retain `set_plan_route_stop_photos`. The hook updates the Plan stop only after the RPC response. Photo history and facility photo snapshots keep their existing semantics.

Completion from an off-route facility or with no active matching run does not create or mutate current-route status. Custom survey completion does not touch either built-in domain.

## 7. Shared rendering and compliance classification

Create a pure `src/utils/routeStatus.ts` render model and use it in route list, inline map, fullscreen map, and Survey Mode.

Required inputs include:

- normalized `surveyTypeKind`, never a raw UUID/literal comparison
- whether the facility is in the current loaded route
- active Inspection and Plan stop states
- canonical inspection compliance status
- canonical Plan compliance status

Required outputs include:

- `showRouteCheck`
- `routeStatusByDomain`
- compliance badge/pip configuration
- current-route vs off-route marker role

Also fix the canonical inspection classifier in `inspectionUtils.ts`:

1. Choose the newest **completed** inspection, not the newest row of any status.
2. A manual internal/external completion is current only when it has a date and `getFacilityInspectionExpiry(...).status === 'valid'`.
3. `expiring`, `expired`, `initial_due`, `initial_overdue`, and unknown are not completed checks.
4. Use this classifier for compliance visibility IDs and compliance badges. Route resets must not alter Hide Completed settings.

Do not copy completion predicates back into each RouteMap marker branch.

## 8. Modal UX contract

Add `Reset route status` to the existing Route actions menu. Remove the Plan-only `Reset for new outing` action and its `window.confirm` path.

The portaled application modal contains:

- Title: `Reset route status`
- Current route name
- `Team {effectiveTeam}`
- Radio choices exactly:
  - `SPCC Inspection`
  - `SPCC Plan`
  - `All Facilities`
- Affected current-route stop count. For All, show both the unique facility count and that both status domains will reset.
- Copy: `This clears route completion checks and starts fresh route status. Inspection records, SPCC plans, photos, schedules, and route assignments are not changed.`
- `Cancel`
- `Reset route status`
- Inline error region with `role="alert"`
- Loading label such as `Resetting...`

Default Inspection and Plan to the active normalized mode. Default the built-in All mode to All. In a custom survey mode, disable or omit the action with a short explanation that custom survey status is unchanged; do not silently map a custom UUID to Inspection.

Disable reset when:

- there is no `currentRouteId` and explain `Save this route before resetting route status.`
- offline
- no effective account/team
- another reset is in flight

The destructive-colored confirm button must include explicit `text-white`.

## 9. Isolation and failure properties

### Tenant, route, team, and scope isolation

- Account identity is checked from `auth.uid()` via `user_has_account_access`.
- The route is selected and locked with both account and route ID.
- Stop membership comes from locked saved `plan_data` and facilities in the same account.
- Team filtering occurs server-side from authoritative assignments.
- Run uniqueness and reads include account, route, team, and stored domain.
- Inspection and Plan resets only end/create their selected domain.
- All expands to both domains under the same route lock and transaction.
- Custom scopes are rejected by the database.
- Stop mutation starts from a run ID, then revalidates run, stop, facility, account, and domain.

### Idempotency and concurrency

- One modal instance owns one request UUID.
- Submit is disabled while saving.
- Same-key retry returns the stored response.
- Same key with another tuple fails.
- The route-row lock serializes route save, sync, and reset in the existing lock order.
- The partial unique index prevents two active runs for one exact domain tuple.
- An old tab trying to mutate the ended run fails and reloads the active run.
- No client-only success state exists.

### Data that reset is forbidden to update

- `inspections` and inspection responses/signatures
- `facilities.spcc_completion_type` and `facilities.spcc_inspection_date`
- `spcc_plans` files, dates, recertification, and workflow
- facility/berm photo snapshots and `photo_visit_events`
- schedules, due dates, notifications, day/team assignment
- `route_plans.plan_data`, route geometry, or route membership
- completed-visibility preferences

Automated database tests should assert the reset transaction touches only run, stop, and reset-request rows.

## 10. Concrete implementation stories

### Story 0: Compatibility guard before widening the index

Files:

- `src/hooks/usePlanRouteRun.ts`
- `src/lib/supabase.ts`

Work:

- Add `survey_type = 'spcc_plan'` to every existing Plan active-run read.
- Preserve current behavior. This can deploy before the migration so older and newer schemas both work.

### Story 1: Add scoped schema and atomic RPC

Files:

- `supabase/migrations/20261017043000_route_status_reset.sql`

Work:

- Apply Sections 4 and 5 exactly.
- Add SQL assertions or a repeatable test script for account/route/team/scope substitution, All atomicity, and idempotent replay.
- Do not backfill a new active Inspection run for every route in this focused release.

### Story 2: Generalize the client run coordinator

Files:

- `src/hooks/useRouteStatusRuns.ts` (new)
- `src/hooks/usePlanRouteRun.ts` (thin adapter or remove after all callers move)
- `src/lib/supabase.ts`
- `src/App.tsx`

Work:

- Add normalized run types and scope-aware cache validation.
- Load both active domains by the full tuple.
- Expose atomic reset and explicit Inspection completion.
- Pass the same scope maps into all route/list/map surfaces.

### Story 3: Centralize route check and compliance classification

Files:

- `src/utils/routeStatus.ts` (new)
- `src/utils/inspectionUtils.ts`
- `src/components/RouteMap.tsx`
- `src/components/RouteResults.tsx`
- `src/components/SurveyMode.tsx`

Work:

- Fix newest-completed and manual date validity.
- Replace duplicated marker predicates with the shared render model.
- Keep compliance visibility separate from route stop state.
- Remove check glyphs from off-route markers.
- Use `surveyTypeKind` rather than literal strings in all touched branches.

### Story 4: Route actions modal

Files:

- `src/components/ResetRouteStatusModal.tsx` (new)
- `src/components/RouteResults.tsx`
- `src/App.tsx`

Work:

- Add the menu item, modal, defaults, count, disabled states, exact copy, error retention, and success announcement.
- Remove the old Plan-only `window.confirm` reset path.
- Ensure the confirm button has `text-white`.

### Story 5: Attach successful Inspection actions to the active run

Files:

- `src/components/InspectionForm.tsx`
- `src/components/FacilityDetailModal.tsx`
- `src/components/RouteMap.tsx`
- `src/components/SurveyMode.tsx`
- `src/App.tsx`

Work:

- Return a saved inspection ID on formal completion.
- After compliance success, call the explicit Inspection stop RPC only when the facility is a stop in the active Inspection run.
- Surface a route-status error without rolling back or misreporting the compliance save.

### Story 6: Focused verification and staged release

Files:

- `tests/routeStatus.test.ts` or repository-consistent Node test files
- `tests/routeStatusReset.integration.mjs`
- package script only if needed for the existing test harness

Work:

- Unit tests: current/expired/null-date manual completion, newest completed inspection with newer draft, all-domain render semantics.
- RPC tests: scope isolation, route/team/account substitution, authoritative saved-route membership, All atomicity, same-key replay, stale-run mutation rejection.
- UI tests: no saved route, offline failure, modal retry, inline/fullscreen/list parity, custom mode unchanged.
- Run `npm run typecheck`, focused tests, and `npm run build`.

Deployment order:

1. Deploy Story 0 scope filters.
2. Apply the additive migration through the Supabase SQL editor.
3. Deploy Stories 2 through 5.
4. Run the focused cross-device and offline checks.

This order prevents the widened active-run index from making an older Plan-only `.maybeSingle()` query ambiguous after Inspection runs begin to exist.

## 11. Acceptance criteria

- Inspection reset clears only current saved route/team Inspection checks.
- Plan reset clears only current saved route/team Plan checks.
- All clears both atomically.
- A second route, team, or account is unchanged.
- Old runs and completed stop history remain queryable.
- Compliance records, plans, photos, schedules, assignments, route data, and preferences are byte-for-byte unchanged by reset.
- Refresh, mobile process restart, and a second authorized device load the same active run.
- Offline or server failure leaves existing checks in place.
- Same request replay returns one committed reset result.
- Formal/manual Inspection completion and Plan outing completion update only their active domain stop.
- Inline map, fullscreen map, route list, and Survey Mode consume the same stop maps.
- Due/overdue/expiring warnings remain visible after reset.
- Custom survey types are unchanged.
