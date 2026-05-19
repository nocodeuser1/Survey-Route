/*
  # Create Validus account, import 30 operated facilities, grant 3 admins cross-account access

  ## Scope
  - Creates a "Validus" account under the existing "My AI Leads Agency"
  - Imports 30 OPERATED='Y' facilities from the Validus Sites OCC data request
    (operator: RIMROCK RESOURCE OPERATING LLC, surveying client: Validus)
  - Grants three users `account_admin` on BOTH the new Validus account AND the
    existing Camino account so they can switch between them in the UI:
      - contact@myaileads.co
      - scott@baberenvironmental.com
      - israel@baberenvironmental.com

  ## Notes
  - The Camino account is located by finding the account_id of any facility
    that already has a `camino_facility_id` set (from migration 20260425000000).
  - Idempotent: re-running skips facilities that already exist (matched by
    UPPER(TRIM(name)) within the Validus account) and upserts account_users
    role to 'account_admin'.
  - If any of the three admin emails does NOT yet exist in `public.users`,
    a NOTICE is raised and that email is skipped. Use Agency Settings →
    Invite User for those emails (it goes through the proper auth/email flow).
  - `first_prod_date` is populated from the spreadsheet's DSU_PSD column
    (Drilling Spacing Unit Production Start Date).
  - Pre-creates `accounts.default_state_code` and `facilities.state_code`
    columns if missing (the standalone state-code migration may not have
    been applied yet).
*/

-- Prerequisite: ensure state-code columns exist (no-op if already applied)
ALTER TABLE accounts   ADD COLUMN IF NOT EXISTS default_state_code text;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS state_code         text;

DO $$
DECLARE
  v_agency_id            uuid;
  v_owner_user_id        uuid;
  v_validus_account_id   uuid;
  v_camino_account_id    uuid;
  v_batch_id             uuid := gen_random_uuid();
  v_user_id              uuid;
  v_email                text;
  v_facilities_inserted  int  := 0;
BEGIN
  ---------------------------------------------------------------------------
  -- 1. Locate the agency + agency owner user
  ---------------------------------------------------------------------------
  SELECT id INTO v_agency_id
    FROM agencies
   WHERE owner_email = 'contact@myaileads.co';

  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION 'Agency with owner_email contact@myaileads.co not found';
  END IF;

  SELECT id INTO v_owner_user_id
    FROM users
   WHERE LOWER(email) = 'contact@myaileads.co';

  IF v_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'User contact@myaileads.co not found in public.users';
  END IF;

  ---------------------------------------------------------------------------
  -- 2. Find the existing Camino account (by any facility carrying a camino_facility_id)
  ---------------------------------------------------------------------------
  SELECT DISTINCT account_id INTO v_camino_account_id
    FROM facilities
   WHERE camino_facility_id IS NOT NULL
   LIMIT 1;

  IF v_camino_account_id IS NULL THEN
    SELECT id INTO v_camino_account_id
      FROM accounts
     WHERE agency_id = v_agency_id
       AND account_name ILIKE '%camino%'
     LIMIT 1;
  END IF;

  IF v_camino_account_id IS NULL THEN
    RAISE NOTICE 'Camino account not found — cross-account admin grants will only apply to the new Validus account.';
  ELSE
    RAISE NOTICE 'Camino account located: %', v_camino_account_id;
  END IF;

  ---------------------------------------------------------------------------
  -- 3. Create the Validus account (idempotent)
  ---------------------------------------------------------------------------
  SELECT id INTO v_validus_account_id
    FROM accounts
   WHERE agency_id = v_agency_id
     AND account_name = 'Validus';

  IF v_validus_account_id IS NULL THEN
    INSERT INTO accounts (agency_id, account_name, created_by, status, default_state_code)
    VALUES (v_agency_id, 'Validus', v_owner_user_id, 'active', 'OK')
    RETURNING id INTO v_validus_account_id;
    RAISE NOTICE 'Created Validus account: %', v_validus_account_id;
  ELSE
    RAISE NOTICE 'Validus account already exists: %', v_validus_account_id;
  END IF;

  ---------------------------------------------------------------------------
  -- 4. Insert the 30 facilities (skip any that already exist under Validus)
  ---------------------------------------------------------------------------
  WITH src(name, lat, lon, api, county, first_prod) AS (
    VALUES
      ('HERRIN 1-32-29UWH',       34.597788, -97.438836,  '3504925092', 'Garvin',  '2017-08-01'::date),
      ('THOROUGHBRED 1-18-07UWH', 34.819055, -97.560000,  '3504925115', 'Garvin',  '2017-08-01'::date),
      ('MOTE 1-26-23UWH',         34.609400, -97.386200,  '3504925108', 'Garvin',  '2017-09-01'::date),
      ('MCCAA 1-30-19UWH',        34.611710, -97.455830,  '3504925109', 'Garvin',  '2017-10-01'::date),
      ('JENNIE 1-21LSH',          34.622312, -97.4131066, '3504925139', 'Garvin',  '2017-10-01'::date),
      ('PERCHERON 1-15UWH',       34.724300, -97.600200,  '3504925140', 'Garvin',  '2017-12-01'::date),
      ('GRIMES 1-01-36UWH',       34.577800, -97.366000,  '3504925149', 'Garvin',  '2018-01-01'::date),
      ('COLWELL 1-31-30LWH',      34.594800, -97.456300,  '3504925161', 'Garvin',  '2018-01-01'::date),
      ('JOHN KENT 1-21-16UWH',    34.622500, -97.409500,  '3504925134', 'Garvin',  '2018-02-01'::date),
      ('CLYDESDALE 1-29-20UWH',   34.775660, -97.642256,  '3504925129', 'Garvin',  '2018-03-01'::date),
      ('MORGAN 1-19UWH',          34.790206, -97.659666,  '3504925165', 'Garvin',  '2018-04-01'::date),
      ('MALOPOLSKI 1-36-01UWH',   34.862531, -97.556155,  '3508722099', 'Mcclain', '2018-04-01'::date),
      ('LINDSEY 1-03-34LWH',      34.582700, -97.395700,  '3504925164', 'Garvin',  '2018-04-01'::date),
      ('BALUCHI 1-13UWH',         34.724200, -97.563600,  '3504925184', 'Garvin',  '2018-06-01'::date),
      ('BALUCHI 1-13LWH',         34.724100, -97.563800,  '3504925153', 'Garvin',  '2018-06-01'::date),
      ('BULLARD 1-18-07UWH',      34.636600, -97.443300,  '3504925192', 'Garvin',  '2018-08-01'::date),
      ('CAMPOLINA 1-29-20USH',    34.784510, -97.647507,  '3504925203', 'Garvin',  '2018-10-01'::date),
      ('MUSTANG 1-13USH',         34.743650, -97.575770,  '3504925213', 'Garvin',  '2018-11-01'::date),
      ('GEORGE 1-28USH',          34.607100, -97.404200,  '3504925189', 'Garvin',  '2018-12-01'::date),
      ('MUSTANG 0304-13-3SH',     34.725426, -97.569915,  '3504925384', 'Garvin',  '2023-07-01'::date),
      ('MUSTANG 0304-13-2SH',     34.725560, -97.574218,  '3504925383', 'Garvin',  '2023-07-01'::date),
      ('BALUCHI 0304 -13-03WH',   34.725529, -97.579454,  '3504925378', 'Garvin',  '2023-07-01'::date),
      ('BALUCHI 0304 -13-7WH',    34.725265, -97.570179,  '3504925381', 'Garvin',  '2023-07-01'::date),
      ('BALUCHI 0304 -13-04WH',   34.725522, -97.577486,  '3504925379', 'Garvin',  '2023-07-01'::date),
      ('BALUCHI 0304 -13-5WH',    34.725515, -97.575330,  '3504925377', 'Garvin',  '2023-07-01'::date),
      ('BALUCHI 0304 -13-6WH',    34.725429, -97.572801,  '3504925380', 'Garvin',  '2023-07-01'::date),
      ('LILY 0404-29-20-2XGD',    34.783764, -97.642737,  '3504925420', 'Garvin',  '2023-12-01'::date),
      ('LILY 0404-29-20-1XGD',    34.783666, -97.649036,  '3504925419', 'Garvin',  '2023-12-01'::date),
      ('PERCHERON 0304-15-03WD',  34.725560, -97.612157,  NULL,         'Garvin',  '2024-08-01'::date),
      ('PERCHERON 0304-15-02WD',  34.725489, -97.614406,  '3504925400', 'Garvin',  '2024-08-01'::date)
  ),
  ins AS (
    INSERT INTO facilities (
      account_id, user_id, name, latitude, longitude,
      well_api_1, api_numbers_combined, county, first_prod_date,
      upload_batch_id, state_code
    )
    SELECT
      v_validus_account_id,
      v_owner_user_id,
      src.name,
      src.lat,
      src.lon,
      src.api,
      src.api,
      src.county,
      src.first_prod,
      v_batch_id,
      'OK'
    FROM src
    WHERE NOT EXISTS (
      SELECT 1
        FROM facilities f
       WHERE f.account_id = v_validus_account_id
         AND UPPER(TRIM(f.name)) = UPPER(TRIM(src.name))
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_facilities_inserted FROM ins;

  RAISE NOTICE 'Inserted % new Validus facilities (% rows in source; rest already present).',
    v_facilities_inserted, 30;

  ---------------------------------------------------------------------------
  -- 5. Grant the three admins access to BOTH accounts
  ---------------------------------------------------------------------------
  FOREACH v_email IN ARRAY ARRAY[
    'contact@myaileads.co',
    'scott@baberenvironmental.com',
    'israel@baberenvironmental.com'
  ] LOOP
    SELECT id INTO v_user_id
      FROM users
     WHERE LOWER(email) = LOWER(v_email);

    IF v_user_id IS NULL THEN
      RAISE NOTICE 'User % not found in public.users — skipping. Invite them via Agency Settings → Invite User to add to both accounts.', v_email;
      CONTINUE;
    END IF;

    -- Validus: upsert to account_admin
    INSERT INTO account_users (account_id, user_id, role, invited_by)
    VALUES (v_validus_account_id, v_user_id, 'account_admin', v_owner_user_id)
    ON CONFLICT (account_id, user_id) DO UPDATE
      SET role = 'account_admin';

    -- Camino: upsert to account_admin (only if account was found)
    IF v_camino_account_id IS NOT NULL THEN
      INSERT INTO account_users (account_id, user_id, role, invited_by)
      VALUES (v_camino_account_id, v_user_id, 'account_admin', v_owner_user_id)
      ON CONFLICT (account_id, user_id) DO UPDATE
        SET role = 'account_admin';
    END IF;

    RAISE NOTICE 'Granted % account_admin on Validus%', v_email,
      CASE WHEN v_camino_account_id IS NOT NULL THEN ' + Camino' ELSE '' END;
  END LOOP;

  RAISE NOTICE 'Validus setup complete.';
END $$;
