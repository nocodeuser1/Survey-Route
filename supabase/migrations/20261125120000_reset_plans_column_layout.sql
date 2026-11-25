-- Overwrite every account's saved Plans-mode column layout with the standard
-- Plans layout (Israel's Camino layout, 2026-11-25). Matches
-- PLAN_DEFAULT_VISIBLE_COLUMNS in src/components/FacilitiesManager.tsx.
--
-- Column layouts live in user_settings.facilities_ui_preferences->'columns',
-- keyed `${reportType}_${spccMode}`; every Plans-mode key ends in '_plan'.
-- Existing '_plan' keys are replaced and 'spcc_plan_plan' is written for
-- every row (so a browser-local layout can't win over it). Other modes and
-- other prefs are untouched. `order` lists just the six columns; the app
-- appends the rest on load.

WITH layout AS (
  SELECT '{"visible": ["name","spcc_status","spcc_due_date","latest_photo_date","photos_taken","spcc_inspection_date"],
           "order":   ["name","spcc_status","spcc_due_date","latest_photo_date","photos_taken","spcc_inspection_date"]}'::jsonb AS v
)
UPDATE user_settings us
SET facilities_ui_preferences = jsonb_set(
  COALESCE(us.facilities_ui_preferences, '{}'::jsonb),
  '{columns}',
  COALESCE(
    (
      SELECT jsonb_object_agg(e.k, CASE WHEN e.k LIKE '%\_plan' THEN layout.v ELSE e.v END)
      FROM jsonb_each(
        CASE WHEN jsonb_typeof(us.facilities_ui_preferences->'columns') = 'object'
             THEN us.facilities_ui_preferences->'columns' ELSE '{}'::jsonb END
      ) AS e(k, v)
    ),
    '{}'::jsonb
  ) || jsonb_build_object('spcc_plan_plan', layout.v)
)
FROM layout;
