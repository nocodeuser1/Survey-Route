-- Backfill default survey_types for any account that's missing them, and
-- install a trigger so newly-created accounts get them automatically.
--
-- Why this exists:
-- The original 20260214170000_create_custom_surveys_system.sql migration
-- iterated `SELECT id FROM accounts` once, at migration time, to seed each
-- existing account with the SPCC Plan + SPCC Inspection rows. Any account
-- created AFTER that migration ran never got those rows — which surfaced
-- as the Route Planning mode switcher showing only "All Facilities" and
-- the SPCC sub-tabs disappearing entirely (see App.tsx routeModeTypes,
-- which filters survey_types on enabled && show_as_route_mode).
--
-- This migration:
--   1. Backfills the two SPCC system rows for every existing account that
--      doesn't already have them (idempotent — ON CONFLICT DO NOTHING).
--   2. Adds an AFTER INSERT trigger on `accounts` that runs the same
--      insert so the issue can't reappear when an agency creates a new
--      sub-account.
--
-- Note: the original seed also populated `survey_fields` for the two
-- SPCC system rows. Those fields are only used by the custom-survey data-
-- capture UI (SurveyMode), not by the route-mode tabs or the legacy
-- facilityNeedsInspection / facilityNeedsSPCCPlan helpers. Leaving the
-- fields out keeps this migration focused on the immediate symptom; if a
-- user wants the full SurveyMode field set on a newly-seeded account
-- they can re-run the seed_default_survey_fields helper separately.

-- ============================================
-- 1. Backfill SPCC system rows for existing accounts
-- ============================================
DO $$
DECLARE
  acc RECORD;
BEGIN
  FOR acc IN SELECT id FROM accounts LOOP
    INSERT INTO survey_types (
      account_id, name, description, icon, color,
      is_system, enabled, sort_order, system_kind,
      visit_duration_minutes, show_as_route_mode
    )
    VALUES (
      acc.id, 'SPCC Plan',
      'Spill Prevention, Control, and Countermeasure Plan documentation',
      'file-text', '#3B82F6',
      true, true, 0, 'spcc_plan',
      60, true
    )
    ON CONFLICT (account_id, name) DO NOTHING;

    INSERT INTO survey_types (
      account_id, name, description, icon, color,
      is_system, enabled, sort_order, system_kind,
      visit_duration_minutes, show_as_route_mode
    )
    VALUES (
      acc.id, 'SPCC Inspection',
      'SPCC compliance inspection checklist',
      'clipboard-check', '#10B981',
      true, true, 1, 'spcc_inspection',
      30, true
    )
    ON CONFLICT (account_id, name) DO NOTHING;
  END LOOP;
END $$;

-- ============================================
-- 2. Seed-on-create trigger for future accounts
-- ============================================
CREATE OR REPLACE FUNCTION seed_default_survey_types() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO survey_types (
    account_id, name, description, icon, color,
    is_system, enabled, sort_order, system_kind,
    visit_duration_minutes, show_as_route_mode
  )
  VALUES
    (NEW.id, 'SPCC Plan',
     'Spill Prevention, Control, and Countermeasure Plan documentation',
     'file-text', '#3B82F6',
     true, true, 0, 'spcc_plan',
     60, true),
    (NEW.id, 'SPCC Inspection',
     'SPCC compliance inspection checklist',
     'clipboard-check', '#10B981',
     true, true, 1, 'spcc_inspection',
     30, true)
  ON CONFLICT (account_id, name) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS seed_default_survey_types_trigger ON accounts;
CREATE TRIGGER seed_default_survey_types_trigger
  AFTER INSERT ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION seed_default_survey_types();

COMMENT ON FUNCTION seed_default_survey_types() IS
  'Seeds SPCC Plan + SPCC Inspection survey_types rows when an account is created. Without this, accounts created after 2026-02-14 had no route-mode tabs.';
