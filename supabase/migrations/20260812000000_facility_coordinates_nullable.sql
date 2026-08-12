/*
  # Allow facilities to have no coordinates

  ## Why
  Users need to be able to clear a facility's latitude/longitude when the
  coordinates on file are wrong or unknown, rather than being forced to leave a
  bad value in place. The original schema declared both columns NOT NULL, so the
  "Clear coordinates" action in the facility detail modal fails with a
  not_null_violation (23502) until this runs.

  ## Changes
  - `facilities.latitude`  — drop NOT NULL
  - `facilities.longitude` — drop NOT NULL

  ## Notes
  - Nothing is backfilled and no existing row changes; this only widens what the
    column will accept.
  - The app treats NULL and the legacy 0,0 sentinel as equivalent ("no
    coordinates on file") via src/utils/coordinates.ts. Facilities without
    coordinates are excluded from route optimization and from map markers, and
    navigation shows a "No coordinates" message instead of opening Maps.
  - `home_base.latitude` / `home_base.longitude` are deliberately left NOT NULL —
    a home base with no location has no meaning.
*/

ALTER TABLE facilities ALTER COLUMN latitude DROP NOT NULL;
ALTER TABLE facilities ALTER COLUMN longitude DROP NOT NULL;
