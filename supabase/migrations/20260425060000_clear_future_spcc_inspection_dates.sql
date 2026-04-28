/*
  # Null out future-dated facilities.spcc_inspection_date values

  `spcc_inspection_date` represents the LAST completed annual SPCC
  inspection (40 CFR §112.7(c) — annual visual inspection of the SPCC
  plan and containment). It cannot logically be in the future.

  In production we found rows with `spcc_inspection_date` set to dates
  5 years out (e.g. 2030-10-24, 2030-09-30) that line up with
  PE_stamp_date + 5 years — i.e. the SPCC Plan recertification deadline
  (40 CFR §112.5), which is a totally different compliance event.
  Those values appear to have been written by an older import or
  trigger that conflated "annual inspection" with "5-year plan
  recertification".

  Concrete impact: the inspection-status badge logic says "valid if
  last inspection was within the last year." A row with 2030-10-24 in
  spcc_inspection_date currently reads as "valid" — masking a real
  annual-inspection-overdue state. That's a compliance correctness bug.

  This migration:
    1. Logs how many rows are about to be touched (NOTICE, no email).
    2. Sets spcc_inspection_date = NULL where it's in the future
       (relative to CURRENT_DATE).
    3. Clears spcc_completion_type for those same rows so the "marked
       internal/external" badge doesn't linger pointing at a phantom date.

  Idempotent — re-running on already-cleaned data is a no-op.
*/

DO $$
DECLARE
  bad_count int;
BEGIN
  SELECT count(*) INTO bad_count
  FROM public.facilities
  WHERE spcc_inspection_date IS NOT NULL
    AND spcc_inspection_date > CURRENT_DATE;

  IF bad_count > 0 THEN
    RAISE NOTICE 'Clearing future-dated spcc_inspection_date on % facility row(s).', bad_count;
  ELSE
    RAISE NOTICE 'No future-dated spcc_inspection_date values to clear.';
  END IF;
END $$;

UPDATE public.facilities
SET
  spcc_inspection_date = NULL,
  spcc_completion_type = NULL
WHERE spcc_inspection_date IS NOT NULL
  AND spcc_inspection_date > CURRENT_DATE;
