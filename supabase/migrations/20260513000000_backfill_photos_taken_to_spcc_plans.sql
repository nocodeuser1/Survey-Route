/*
  # Backfill photos_taken / field_visit_date from facilities → spcc_plans

  ## Context
  Several toggle paths in the app (FacilityDetailModal.togglePhotosTaken,
  the RouteMap pin popups, the mobile-edit form in FacilitiesManager)
  write `facilities.photos_taken = true` directly without also writing
  `spcc_plans.photos_taken = true` for the matching berm row. The
  sync_facility_from_spcc_plans trigger only mirrors spcc_plans → facilities
  (not the reverse), so the per-berm aggregate (berms_with_photos_count)
  stays at 0 even though the facility flag says photos were taken.

  Result the user reported: in the Facilities list, the Field Visit column
  shows a recent date but the Photos Taken status badge says
  "No Photos Yet" because the badge uses berms_with_photos_count instead
  of the facility flag.

  ## What this does
  One-time sync for single-berm facilities: if facilities.photos_taken
  is true but the only berm's spcc_plans.photos_taken is false, flip the
  berm to true. Same for field_visit_date — copy facility's value into
  the berm row if the berm is missing one.

  Multi-berm facilities are left alone: with 2+ berms there's no obvious
  way to decide which berm got the photos, and the user should be
  setting that per-berm in the SPCC Plan modal anyway.

  After the UPDATE the existing sync_facility_from_spcc_plans trigger
  fires automatically, repopulating berms_with_photos_count and pushing
  the corrected state back to facilities — so badge state heals in one
  pass.

  ## Idempotent
  Only writes when the berm's value disagrees with the facility's. Safe
  to re-run.
*/

UPDATE public.spcc_plans p
SET
  photos_taken = TRUE,
  field_visit_date = COALESCE(p.field_visit_date, f.field_visit_date)
FROM public.facilities f
WHERE p.facility_id = f.id
  AND f.photos_taken = TRUE
  AND p.photos_taken = FALSE
  -- Only single-berm facilities. Multi-berm is per-berm user territory.
  AND (
    SELECT COUNT(*) FROM public.spcc_plans p2
    WHERE p2.facility_id = f.id
  ) = 1;
