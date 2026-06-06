-- Retro-set the LDAR "document date" to 6/4/2026 on completed plans that
-- have an observation path. The document date shown in the LDAR Site Plan
-- section (and stamped in the editor's title block) reads from
-- ldar_observation_path_data.dateValueOverride first, so seeding it here makes
-- existing completed plans display 6/4/2026.
--
-- Guard: only sets it where no custom date is already present, so any
-- user-entered date is never clobbered. create_missing=true adds the key.

UPDATE facilities
SET ldar_observation_path_data = jsonb_set(
  ldar_observation_path_data,
  '{dateValueOverride}',
  '"6/4/26"'::jsonb,
  true
)
WHERE ldar_site_plan_completed = true
  AND ldar_observation_path_data IS NOT NULL
  AND (ldar_observation_path_data->>'dateValueOverride') IS NULL;
