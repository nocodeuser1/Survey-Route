/*
  # Scope home base uniqueness to the account, not the user

  ## Why
  `home_base` originally predated multi-account support and was keyed
  `UNIQUE (user_id, team_number)`. Once accounts arrived, the app started
  loading and saving home bases by `account_id` alone — but the constraint was
  never updated.

  The result: a user who belongs to more than one account (e.g. an agency owner
  managing several operator accounts) can only ever have ONE Team 1 home base
  across ALL of their accounts. Setting a home base on a second account finds no
  existing row for that account, takes the INSERT path, and collides with the
  row belonging to a different account — surfacing as HTTP 409 and
  "Failed to save" in the Home Base modal.

  ## Changes
  - Drop `home_base_user_team_unique` UNIQUE (user_id, team_number)
  - Remove any pre-existing duplicate (account_id, team_number) rows, keeping
    the most recently updated one
  - Add `home_base_account_team_unique` UNIQUE (account_id, team_number)

  ## Notes
  - Rows with a NULL account_id (legacy, pre-accounts) are left alone. Postgres
    treats NULLs as distinct in a UNIQUE constraint, so they neither block the
    new constraint nor conflict with each other. The account-scoped app never
    reads them.
  - This matches how the UI already behaves: HomeBaseModal selects from
    home_base filtered by account_id with no user filter, so a home base is
    account-wide, shared by everyone in the account.
*/

-- 1. Drop the old user-scoped constraint.
ALTER TABLE home_base DROP CONSTRAINT IF EXISTS home_base_user_team_unique;

-- 2. Collapse any existing duplicates so the new constraint can be created.
--    Keeps the most recently updated row per (account_id, team_number).
DELETE FROM home_base h
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY account_id, team_number
           ORDER BY updated_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM home_base
  WHERE account_id IS NOT NULL
) dupes
WHERE h.id = dupes.id
  AND dupes.rn > 1;

-- 3. Add the account-scoped constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'home_base_account_team_unique'
  ) THEN
    ALTER TABLE home_base
      ADD CONSTRAINT home_base_account_team_unique UNIQUE (account_id, team_number);
  END IF;
END $$;
