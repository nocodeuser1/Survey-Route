-- Survey types as first-class route modes
-- Adds the columns needed for custom survey types to participate in route planning
-- alongside the previously hardwired SPCC plan / SPCC inspection modes.
--
-- ADDITIVE ONLY - new nullable columns + a boolean default + a one-time backfill of
-- the SPCC system rows. Safe to re-run.

-- ============================================
-- 1. Add new columns to survey_types
-- ============================================

-- Discriminator for legacy SPCC-specific filter/duration logic.
-- NULL for custom (user-created) types; they use generic completion-based filtering.
-- 'spcc_plan' / 'spcc_inspection' on the two seeded system rows preserves the
-- existing hardwired behavior (facilityNeedsInspection, getSPCCPlanStatus, etc.).
ALTER TABLE survey_types
  ADD COLUMN IF NOT EXISTS system_kind TEXT
    CHECK (system_kind IS NULL OR system_kind IN ('spcc_plan', 'spcc_inspection'));

-- Per-type visit duration override for route planning, in minutes.
-- NULL = fall back to facility.visit_duration_minutes, then account default.
-- Backfilled to match the previously hardcoded values in App.tsx (getVisitDuration):
--   SPCC Inspection = 30, SPCC Plan = 60.
ALTER TABLE survey_types
  ADD COLUMN IF NOT EXISTS visit_duration_minutes INTEGER
    CHECK (visit_duration_minutes IS NULL OR visit_duration_minutes > 0);

-- Whether this type renders as a tab in the Route Results screen.
-- Defaults to true so newly-created types become route modes automatically;
-- can be turned off for types that are only used for per-facility data capture.
ALTER TABLE survey_types
  ADD COLUMN IF NOT EXISTS show_as_route_mode BOOLEAN NOT NULL DEFAULT true;

-- Helpful for the dynamic tab query
CREATE INDEX IF NOT EXISTS idx_survey_types_route_mode
  ON survey_types(account_id, enabled, show_as_route_mode);

-- ============================================
-- 2. Backfill the two seeded SPCC system rows
-- ============================================
-- These rows were seeded for every account by the original
-- 20260214170000_create_custom_surveys_system.sql migration. We tag them with
-- system_kind so the frontend knows to dispatch to the legacy SPCC logic for
-- filtering and visit-duration, and we set their visit_duration_minutes to
-- match what the App.tsx getVisitDuration helper was previously hardcoding.

UPDATE survey_types
SET system_kind = 'spcc_plan',
    visit_duration_minutes = COALESCE(visit_duration_minutes, 60)
WHERE is_system = true
  AND name = 'SPCC Plan'
  AND system_kind IS NULL;

UPDATE survey_types
SET system_kind = 'spcc_inspection',
    visit_duration_minutes = COALESCE(visit_duration_minutes, 30)
WHERE is_system = true
  AND name = 'SPCC Inspection'
  AND system_kind IS NULL;

-- ============================================
-- 3. Comments for future readers
-- ============================================
COMMENT ON COLUMN survey_types.system_kind IS
  'Discriminator for legacy SPCC-specific logic. NULL for custom types (generic completion-based filtering). ''spcc_plan'' or ''spcc_inspection'' on the two seeded system rows.';

COMMENT ON COLUMN survey_types.visit_duration_minutes IS
  'Per-type visit-duration override (minutes) used by route planning. NULL falls back to facility.visit_duration_minutes then account default.';

COMMENT ON COLUMN survey_types.show_as_route_mode IS
  'If true, this type renders as a tab in Route Results alongside All Facilities. If false, the type is still usable in the Facilities tab but not as a route filter.';
