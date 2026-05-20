/*
  # Per-berm management signature timestamp

  Adds a marker column on spcc_plans recording when the management
  signature was successfully stamped onto each berm's plan PDF. Combined
  with the per-berm workflow_status flip to 'completed_uploaded' that
  BermPlanCard now writes after a successful stamp, this lets the
  existing mirror trigger (sync_facility_from_spcc_plans) automatically
  progress a facility to 'completed_uploaded' once EVERY berm on it has
  the signature applied.

  ## Rollup behavior (unchanged trigger — relies on its existing
  worst-case logic)

    - Single-berm facility: signing the only berm sets that berm's
      workflow_status to 'completed_uploaded' → mirror trigger sets
      facility to 'completed_uploaded'.
    - Multi-berm facility, ALL berms signed: every berm is
      'completed_uploaded' → facility is 'completed_uploaded'.
    - Multi-berm facility, only SOME berms signed: unsigned berms stay
      at 'pe_stamped' (or earlier), worst-case wins, facility stays at
      the lower status until every berm is done.

  ## Why a column instead of inferring from facility_comments

  BermPlanCard's existing stamp flow drops a [SYSTEM] audit comment in
  facility_comments after each stamp, but querying that table to derive
  per-berm signed/unsigned state is fragile (text-string match) and
  expensive. A dedicated timestamp column is precise and indexable.

  Backfill: not done. Existing plans that were stamped before this
  column existed will appear unsigned in the UI until the next stamp.
  That's acceptable — users can re-stamp to refresh the timestamp.
*/

ALTER TABLE public.spcc_plans
  ADD COLUMN IF NOT EXISTS management_signature_applied_at timestamptz;

COMMENT ON COLUMN public.spcc_plans.management_signature_applied_at IS
  'Timestamp of the most recent successful management-signature stamp on this berm''s plan PDF. NULL = signature has not been applied. BermPlanCard sets this together with workflow_status = ''completed_uploaded'' on stamp success; the existing sync_facility_from_spcc_plans trigger then rolls workflow_status up to the facility row.';
