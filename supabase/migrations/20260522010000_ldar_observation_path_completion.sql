-- LDAR Observation Path — completion tracking
--
-- Adds a parallel completion-status surface to the editable JSONB overlay
-- already in `ldar_observation_path_data`. Lets the user mark the
-- observation path "Completed" without going through AI generation /
-- in-app drawing — useful when the LDAR document (with the walking path
-- already drawn) exists on the client's end and there's no need to
-- redraw it in-app.
--
-- Mirrors the ldar_site_plan_completed_* triple introduced in
-- 20260521010000_ldar_site_plans.sql so the two completion surfaces
-- behave identically.
--
-- ADDITIVE / idempotent. Safe to re-run.

ALTER TABLE facilities ADD COLUMN IF NOT EXISTS ldar_observation_path_completed     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS ldar_observation_path_completed_at  TIMESTAMPTZ NULL;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS ldar_observation_path_completed_by  UUID NULL;

COMMENT ON COLUMN facilities.ldar_observation_path_completed IS
  'True when the LDAR observation path has been marked completed for this facility, either implicitly (a walking path has been drawn + saved into ldar_observation_path_data) or explicitly (user toggled completed without drawing — handled outside the system).';
