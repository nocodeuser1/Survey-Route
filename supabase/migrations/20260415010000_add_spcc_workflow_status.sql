alter table public.facilities
  add column if not exists spcc_workflow_status text;

alter table public.facilities
  drop constraint if exists facilities_spcc_workflow_status_check;

alter table public.facilities
  add constraint facilities_spcc_workflow_status_check
  check (
    spcc_workflow_status is null
    or spcc_workflow_status in (
      'awaiting_pe_stamp',
      'pe_stamped',
      'completed_uploaded'
    )
  );

comment on column public.facilities.spcc_workflow_status is
  'Manual SPCC workflow state. Separate from automatic compliance/renewal status calculated from PE stamp and recert dates.';
