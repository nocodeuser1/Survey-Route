-- Add override flag so the app can distinguish user-chosen status from auto-assigned
ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS spcc_workflow_status_overridden boolean DEFAULT false;

-- Expand the workflow status constraint to include the new 'site_visited' value
ALTER TABLE public.facilities
  DROP CONSTRAINT IF EXISTS facilities_spcc_workflow_status_check;

ALTER TABLE public.facilities
  ADD CONSTRAINT facilities_spcc_workflow_status_check
  CHECK (
    spcc_workflow_status IS NULL
    OR spcc_workflow_status IN (
      'awaiting_pe_stamp',
      'site_visited',
      'pe_stamped',
      'completed_uploaded'
    )
  );

COMMENT ON COLUMN public.facilities.spcc_workflow_status_overridden IS
  'True when the user has manually overridden the auto-computed workflow status.
   When false the app auto-applies the status derived from field data (visit date,
   photos_taken, PE stamp date, plan URL).';
