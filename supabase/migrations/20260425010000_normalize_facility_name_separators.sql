/*
  # Normalize facility-name separators

  After the Camino backfill some facility names landed with inconsistent
  whitespace around the "|" separator that joins multi-lease facilities:

    "Tyler 4MXH, 5WXH |Michael 1WH"        ← no space after |
    "Roberts 1MXH |Tyler 1XH, 1UXH, 2MXH"  ← no space after |
    "Mount Scott  1WXH | Cowabunga 1MXH"   ← double space before |
    "Sayonara 2MH |Broken Bow 4MXH..."     ← no space after |

  Canonical form is exactly one space on each side of every "|":

    "X | Y" — never "X|Y", "X |Y", "X| Y", or "X  |  Y".

  This migration rewrites `name` and `historical_name` for every row whose
  current value would change under that rule. Skipping no-op rows keeps
  `updated_at` clean and makes the migration safe to re-run.

  Why historical_name too: a small number of historical names also contain
  "|" (carried over from the prior facility-naming convention) and benefit
  from the same normalization for consistent display.

  Idempotent — re-running on a fully normalized table is a no-op.
*/

-- 1. Normalize the live `name` column.
WITH normalized AS (
  SELECT
    id,
    name AS old_name,
    regexp_replace(name, '\s*\|\s*', ' | ', 'g') AS new_name
  FROM public.facilities
  WHERE name LIKE '%|%'
)
UPDATE public.facilities f
SET name = n.new_name
FROM normalized n
WHERE f.id = n.id
  AND n.old_name <> n.new_name;

-- 2. Same treatment for historical_name so the toggleable column reads cleanly.
WITH normalized AS (
  SELECT
    id,
    historical_name AS old_name,
    regexp_replace(historical_name, '\s*\|\s*', ' | ', 'g') AS new_name
  FROM public.facilities
  WHERE historical_name LIKE '%|%'
)
UPDATE public.facilities f
SET historical_name = n.new_name
FROM normalized n
WHERE f.id = n.id
  AND n.old_name <> n.new_name;

-- 3. Surface a count so the migration log shows how many rows were normalized.
DO $$
DECLARE
  remaining_bad int;
BEGIN
  SELECT count(*) INTO remaining_bad
  FROM public.facilities
  WHERE name LIKE '%|%'
    AND name <> regexp_replace(name, '\s*\|\s*', ' | ', 'g');
  IF remaining_bad > 0 THEN
    RAISE NOTICE 'Facility-name normalization: % rows still need attention (unexpected — please investigate).', remaining_bad;
  ELSE
    RAISE NOTICE 'Facility-name normalization complete — all "|" separators are now " | ".';
  END IF;
END $$;
