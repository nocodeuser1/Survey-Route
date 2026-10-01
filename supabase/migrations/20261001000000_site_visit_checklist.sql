/*
  # Site visit checklist

  What a tech confirms while standing at a facility. Two columns, kept apart
  on purpose:

    accounts.site_visit_checklist            the template — the items
    facilities.site_visit_checklist_progress which items are done, per site

  Progress is keyed by item id rather than copying the template onto every
  facility. Editing the template in Settings then takes effect everywhere at
  once: new items appear unticked, removed items disappear, and items that
  stayed keep the tick they already had. A per-facility snapshot would freeze
  each site on whatever the list looked like the first time it was opened.

  NULL template = "never configured", and the app falls back to the built-in
  SPCC field-work defaults (see src/utils/siteVisitChecklist.ts). An account
  that deliberately saves an empty list gets '[]', which is respected.

  No RLS change: both are ordinary columns on tables that already have
  policies, and the app writes them through the normal account/facility paths.

  Idempotent.
*/

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS site_visit_checklist jsonb;

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS site_visit_checklist_progress jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN accounts.site_visit_checklist IS
  'Site-visit checklist template: [{"id":"ground_photos","label":"Take updated ground photos"}]. NULL means never configured — the app uses its built-in defaults.';

COMMENT ON COLUMN facilities.site_visit_checklist_progress IS
  'Per-facility checklist ticks: {"<item id>":"<ISO timestamp>"}. Keys reference accounts.site_visit_checklist ids.';
