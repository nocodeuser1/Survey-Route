/*
  # Add West Wichita Gas Gathering facilities

  Adds a lightweight facility_group column that can be used by the Facilities
  custom filters, then seeds the West Wichita Gathering field list into the
  Cimarron / IACX account.

  Idempotent:
  - Column/index additions are guarded.
  - Facilities are inserted only when the same account/name pair does not
    already exist.
  - Existing matching rows are tagged with the requested group.
*/

ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS facility_group text;

COMMENT ON COLUMN public.facilities.facility_group IS
  'Account-visible grouping tag used to filter facility lists, route planning batches, and field campaigns.';

CREATE INDEX IF NOT EXISTS idx_facilities_account_facility_group
  ON public.facilities (account_id, facility_group);

DO $$
DECLARE
  target_account_id uuid;
  target_user_id uuid;
  target_batch_id uuid;
BEGIN
  SELECT a.id
    INTO target_account_id
    FROM public.accounts a
   WHERE lower(coalesce(a.account_name, '')) IN ('cimarron / iacx', 'cimarron', 'iacx')
      OR lower(coalesce(a.company_name, '')) IN ('cimarron / iacx', 'cimarron', 'iacx')
      OR lower(concat_ws(' / ', nullif(a.company_name, ''), nullif(a.account_name, ''))) = 'cimarron / iacx'
      OR lower(concat_ws(' / ', nullif(a.account_name, ''), nullif(a.company_name, ''))) = 'cimarron / iacx'
   ORDER BY
     CASE
       WHEN lower(coalesce(a.company_name, '')) = 'cimarron' AND lower(coalesce(a.account_name, '')) = 'iacx' THEN 0
       WHEN lower(coalesce(a.account_name, '')) = 'cimarron / iacx' THEN 1
       WHEN lower(coalesce(a.company_name, '')) = 'cimarron / iacx' THEN 2
       ELSE 3
     END
   LIMIT 1;

  IF target_account_id IS NULL THEN
    RAISE NOTICE 'West Wichita import skipped: Cimarron / IACX account was not found.';
    RETURN;
  END IF;

  SELECT f.user_id, f.upload_batch_id
    INTO target_user_id, target_batch_id
    FROM public.facilities f
   WHERE f.account_id = target_account_id
   ORDER BY f.created_at NULLS LAST, f.id
   LIMIT 1;

  IF target_user_id IS NULL THEN
    SELECT au.user_id
      INTO target_user_id
      FROM public.account_users au
     WHERE au.account_id = target_account_id
     ORDER BY
       CASE WHEN au.role = 'account_admin' THEN 0 ELSE 1 END,
       au.joined_at NULLS LAST,
       au.id
     LIMIT 1;
  END IF;

  IF target_user_id IS NULL THEN
    RAISE NOTICE 'West Wichita import skipped: no user/member found for Cimarron / IACX account.';
    RETURN;
  END IF;

  target_batch_id := coalesce(target_batch_id, gen_random_uuid());

  CREATE TEMP TABLE _west_wichita_facilities (
    name text PRIMARY KEY,
    latitude numeric(10, 7) NOT NULL,
    longitude numeric(10, 7) NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _west_wichita_facilities (name, latitude, longitude) VALUES
    ('Attica Compressor Station', 37.2614, -98.2388),
    ('Attica Receiving Tanks', 37.3559, -98.2396),
    ('Crooked Bridge Super Drip Tank', 37.3237, -98.2578),
    ('Hazelton Compressor Station', 37.1526, -98.4037),
    ('Key West Compressor Station', 37.4562, -98.2097),
    ('Panhandle North Delivery Point', 37.6762, -98.0091),
    ('Panhandle South Delivery Point', 37.3775, -98.2100),
    ('Sandplum Compressor Station', 37.2460, -98.3862),
    ('Sharon Compressor Station', 37.3065, -98.3126),
    ('Spivey Compressor Station', 37.4574, -98.1148),
    ('Trenton Compressor Station', 37.4869, -98.0612),
    ('Voran Junction Tank', 37.5021, -98.0628),
    ('Whitmer Super Drip Tank', 37.4435, -98.2427);

  UPDATE public.facilities f
     SET facility_group = 'West Wichita Gas Gathering',
         state_code = 'KS'
    FROM _west_wichita_facilities w
   WHERE f.account_id = target_account_id
     AND lower(trim(f.name)) = lower(trim(w.name));

  INSERT INTO public.facilities (
    user_id,
    account_id,
    name,
    latitude,
    longitude,
    visit_duration_minutes,
    upload_batch_id,
    facility_group,
    state_code
  )
  SELECT
    target_user_id,
    target_account_id,
    w.name,
    w.latitude,
    w.longitude,
    30,
    target_batch_id,
    'West Wichita Gas Gathering',
    'KS'
  FROM _west_wichita_facilities w
  WHERE NOT EXISTS (
    SELECT 1
      FROM public.facilities f
     WHERE f.account_id = target_account_id
       AND lower(trim(f.name)) = lower(trim(w.name))
  );
END $$;
