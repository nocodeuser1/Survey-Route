-- Remember which page of the multi-page SPCC plan the LDAR source was
-- extracted from. Set when the user picks a page in the LDAR source selector
-- (or by the first auto-detection). The editor's "Generate with AI" step uses
-- this instead of re-detecting, so a manual page choice is no longer silently
-- overwritten by the auto-detected page.

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS ldar_site_plan_source_page INTEGER;
