/*
  # Collapse runs of 2+ spaces in facility names to a single space

  Some Camino-imported names landed with internal double-spaces:

    "Tom Horn  9H, 10H, 11H"
    "Mount Scott  1WXH | Cowabunga 1MXH"
    "Little Sahara  4MXHR, 6MXH (EAST)"

  This migration replaces any run of two or more ASCII spaces with a
  single space (in both `name` and `historical_name`) and trims any
  leading/trailing whitespace. Tabs and newlines are NOT touched — names
  shouldn't contain those, and changing them silently would mask bugs.

  Idempotent — re-running on a normalized table is a no-op (the WHERE
  clause skips rows where the rewrite would be identical to the original).

  Touches 8 known rows from the recent Camino import (Tom Horn 9-11 and
  6-8, Mount Scott + Cowabunga, Little Sahara 4 and 2, Grant 2-4, Black
  Mesa 4-5 and 2-3) plus any pre-existing rows with the same pattern.

  Run AFTER 20260425010000_normalize_facility_name_separators.sql so the
  pipe-separator normalization isn't undone (this migration's regex
  doesn't touch single spaces).
*/

-- 1. Live `name` column.
WITH normalized AS (
  SELECT
    id,
    name AS old_name,
    btrim(regexp_replace(name, ' {2,}', ' ', 'g')) AS new_name
  FROM public.facilities
  WHERE name ~ ' {2,}' OR name <> btrim(name)
)
UPDATE public.facilities f
SET name = n.new_name
FROM normalized n
WHERE f.id = n.id
  AND n.old_name <> n.new_name;

-- 2. Same for historical_name so the toggleable column stays clean.
WITH normalized AS (
  SELECT
    id,
    historical_name AS old_name,
    btrim(regexp_replace(historical_name, ' {2,}', ' ', 'g')) AS new_name
  FROM public.facilities
  WHERE historical_name IS NOT NULL
    AND (historical_name ~ ' {2,}' OR historical_name <> btrim(historical_name))
)
UPDATE public.facilities f
SET historical_name = n.new_name
FROM normalized n
WHERE f.id = n.id
  AND n.old_name <> n.new_name;

-- 3. Surface a count so the migration log shows what changed.
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT count(*) INTO remaining
  FROM public.facilities
  WHERE name ~ ' {2,}' OR name <> btrim(name)
     OR (historical_name IS NOT NULL
         AND (historical_name ~ ' {2,}' OR historical_name <> btrim(historical_name)));
  IF remaining > 0 THEN
    RAISE NOTICE 'Facility-name space-collapse: % rows still have double spaces or surrounding whitespace (unexpected — please investigate).', remaining;
  ELSE
    RAISE NOTICE 'Facility-name space-collapse complete — all multi-space runs are now single spaces.';
  END IF;
END $$;
