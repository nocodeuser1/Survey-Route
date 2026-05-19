/*
  # Agency co-owners, cross-account user management, and last-login visibility

  ## What this migration adds

  1. **agency_co_owners** table
     Lets the primary agency owner share agency-level powers without transferring
     ownership. Co-owners get `users.is_agency_owner = true` (Agency Dashboard
     access) and `account_admin` on every account under the agency. The primary
     owner (still uniquely identified by `agencies.owner_email`) cannot be
     removed by co-owners.

  2. **Triggers**
     - On insert into agency_co_owners: flip `users.is_agency_owner = true` and
       grant `account_admin` on every existing account under the agency.
     - On delete from agency_co_owners: revoke account access under the agency
       and clear `is_agency_owner` if the user is not a co-owner of any other
       agency and is not a primary owner anywhere.
     - On insert into accounts: auto-grant every current co-owner of the parent
       agency `account_admin` on the new account.

  3. **get_account_team_members** RPC extended
     Now returns `last_sign_in_at` (from auth.users) and `is_agency_owner`.

  4. **Helper RPCs** (all SECURITY DEFINER, bypass RLS, enforce authorization
     internally — caller must be primary owner or co-owner of the agency):
     - `get_agency_accounts_for_user(agency_id, user_id)` — feeds the
       "Manage Accounts" modal: every account in the agency + the target user's
       current role (NULL if not a member).
     - `manage_user_account_access(target_user_id, target_account_id, new_role)`
       — upserts an account_users row.
     - `revoke_user_account_access(target_user_id, target_account_id)` —
       deletes an account_users row.
     - `list_agency_co_owners(agency_id)` — feeds the "Co-Owners" section in
       Agency Settings.
     - `add_agency_co_owner(agency_id, target_email)` — primary owner only.
     - `remove_agency_co_owner(agency_id, target_user_id)` — primary owner
       only.
*/

---------------------------------------------------------------------------
-- 1. agency_co_owners table + RLS
---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agency_co_owners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id   uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  granted_by  uuid NOT NULL REFERENCES users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_agency_co_owners_agency_id ON agency_co_owners(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_co_owners_user_id  ON agency_co_owners(user_id);

ALTER TABLE agency_co_owners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Primary owner and co-owners can read co-owner list" ON agency_co_owners;
CREATE POLICY "Primary owner and co-owners can read co-owner list"
  ON agency_co_owners FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies a
       WHERE a.id = agency_co_owners.agency_id
         AND a.owner_email = (SELECT auth.jwt()->>'email')
    )
    OR user_id IN (SELECT id FROM users WHERE auth_user_id = auth.uid())
  );

-- Inserts/deletes go through SECURITY DEFINER RPCs below, so we deny direct
-- writes from authenticated clients.
DROP POLICY IF EXISTS "No direct inserts" ON agency_co_owners;
CREATE POLICY "No direct inserts" ON agency_co_owners FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "No direct updates" ON agency_co_owners;
CREATE POLICY "No direct updates" ON agency_co_owners FOR UPDATE TO authenticated USING (false);

DROP POLICY IF EXISTS "No direct deletes" ON agency_co_owners;
CREATE POLICY "No direct deletes" ON agency_co_owners FOR DELETE TO authenticated USING (false);

---------------------------------------------------------------------------
-- 2. Triggers: sync downstream side-effects of co-ownership
---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_co_owner_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE users SET is_agency_owner = true WHERE id = NEW.user_id;

  INSERT INTO account_users (account_id, user_id, role, invited_by)
  SELECT a.id, NEW.user_id, 'account_admin', NEW.granted_by
    FROM accounts a
   WHERE a.agency_id = NEW.agency_id
  ON CONFLICT (account_id, user_id) DO UPDATE SET role = 'account_admin';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_co_owner_on_insert ON agency_co_owners;
CREATE TRIGGER trigger_sync_co_owner_on_insert
  AFTER INSERT ON agency_co_owners
  FOR EACH ROW EXECUTE FUNCTION sync_co_owner_on_insert();

CREATE OR REPLACE FUNCTION cleanup_co_owner_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_email text;
BEGIN
  DELETE FROM account_users
   WHERE user_id = OLD.user_id
     AND account_id IN (SELECT id FROM accounts WHERE agency_id = OLD.agency_id);

  SELECT email INTO v_user_email FROM users WHERE id = OLD.user_id;

  IF NOT EXISTS (SELECT 1 FROM agency_co_owners WHERE user_id = OLD.user_id)
     AND NOT EXISTS (
       SELECT 1 FROM agencies WHERE LOWER(owner_email) = LOWER(v_user_email)
     )
  THEN
    UPDATE users SET is_agency_owner = false WHERE id = OLD.user_id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trigger_cleanup_co_owner_on_delete ON agency_co_owners;
CREATE TRIGGER trigger_cleanup_co_owner_on_delete
  AFTER DELETE ON agency_co_owners
  FOR EACH ROW EXECUTE FUNCTION cleanup_co_owner_on_delete();

CREATE OR REPLACE FUNCTION add_co_owners_to_new_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO account_users (account_id, user_id, role, invited_by)
  SELECT NEW.id, co.user_id, 'account_admin', NEW.created_by
    FROM agency_co_owners co
   WHERE co.agency_id = NEW.agency_id
  ON CONFLICT (account_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_add_co_owners_to_new_account ON accounts;
CREATE TRIGGER trigger_add_co_owners_to_new_account
  AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION add_co_owners_to_new_account();

---------------------------------------------------------------------------
-- 3. Extend get_account_team_members with last_sign_in_at + is_agency_owner
---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_account_team_members(uuid) CASCADE;

CREATE FUNCTION get_account_team_members(target_account_id uuid)
RETURNS TABLE (
  user_id            uuid,
  email              text,
  full_name          text,
  role               text,
  signature_completed boolean,
  joined_at          timestamptz,
  last_sign_in_at    timestamptz,
  is_agency_owner    boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.full_name,
    au.role,
    COALESCE(u.signature_completed, false),
    au.joined_at,
    a.last_sign_in_at,
    COALESCE(u.is_agency_owner, false)
  FROM users u
  INNER JOIN account_users au ON au.user_id = u.id
  LEFT  JOIN auth.users a    ON a.id = u.auth_user_id
  WHERE au.account_id = target_account_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_account_team_members(uuid) TO authenticated;

---------------------------------------------------------------------------
-- 4. Authorization helper
---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _is_agency_admin(target_agency_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM agencies a
     WHERE a.id = target_agency_id
       AND LOWER(a.owner_email) = LOWER((auth.jwt()->>'email'))
  ) OR EXISTS (
    SELECT 1
      FROM agency_co_owners co
      JOIN users u ON u.id = co.user_id
     WHERE co.agency_id = target_agency_id
       AND u.auth_user_id = auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION _is_primary_agency_owner(target_agency_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM agencies a
     WHERE a.id = target_agency_id
       AND LOWER(a.owner_email) = LOWER((auth.jwt()->>'email'))
  );
END;
$$;

---------------------------------------------------------------------------
-- 5. Manage-Accounts modal RPCs
---------------------------------------------------------------------------
-- Note: `current_role` is a reserved Postgres keyword (returns the active
-- role name), so the column is named `member_role` instead.
CREATE OR REPLACE FUNCTION get_agency_accounts_for_user(
  target_agency_id uuid,
  target_user_id   uuid
)
RETURNS TABLE (
  account_id   uuid,
  account_name text,
  member_role  text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF NOT _is_agency_admin(target_agency_id) THEN
    RAISE EXCEPTION 'Not authorized to manage accounts for this agency';
  END IF;

  RETURN QUERY
  SELECT a.id, a.account_name, au.role
    FROM accounts a
    LEFT JOIN account_users au
      ON au.account_id = a.id AND au.user_id = target_user_id
   WHERE a.agency_id = target_agency_id
   ORDER BY a.account_name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_agency_accounts_for_user(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION manage_user_account_access(
  target_user_id    uuid,
  target_account_id uuid,
  new_role          text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agency_id  uuid;
  v_caller_id  uuid;
BEGIN
  IF new_role NOT IN ('account_admin', 'user') THEN
    RAISE EXCEPTION 'Invalid role: %', new_role;
  END IF;

  SELECT agency_id INTO v_agency_id FROM accounts WHERE id = target_account_id;
  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF NOT _is_agency_admin(v_agency_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this account';
  END IF;

  SELECT id INTO v_caller_id FROM users WHERE auth_user_id = auth.uid();

  INSERT INTO account_users (account_id, user_id, role, invited_by)
  VALUES (target_account_id, target_user_id, new_role, v_caller_id)
  ON CONFLICT (account_id, user_id) DO UPDATE SET role = new_role;
END;
$$;

GRANT EXECUTE ON FUNCTION manage_user_account_access(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION revoke_user_account_access(
  target_user_id    uuid,
  target_account_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agency_id     uuid;
  v_owner_email   text;
  v_target_email  text;
BEGIN
  SELECT agency_id INTO v_agency_id FROM accounts WHERE id = target_account_id;
  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF NOT _is_agency_admin(v_agency_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this account';
  END IF;

  -- Block removing the primary agency owner from their own agency's accounts
  SELECT owner_email INTO v_owner_email FROM agencies WHERE id = v_agency_id;
  SELECT email INTO v_target_email FROM users WHERE id = target_user_id;
  IF LOWER(v_owner_email) = LOWER(v_target_email) THEN
    RAISE EXCEPTION 'Cannot remove the primary agency owner from an account';
  END IF;

  DELETE FROM account_users
   WHERE account_id = target_account_id
     AND user_id    = target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION revoke_user_account_access(uuid, uuid) TO authenticated;

---------------------------------------------------------------------------
-- 6. Co-owner management RPCs
---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_agency_co_owners(target_agency_id uuid)
RETURNS TABLE (
  user_id         uuid,
  email           text,
  full_name       text,
  granted_at      timestamptz,
  last_sign_in_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF NOT _is_agency_admin(target_agency_id) THEN
    RAISE EXCEPTION 'Not authorized to view co-owners for this agency';
  END IF;

  RETURN QUERY
  SELECT u.id, u.email, u.full_name, co.granted_at, au.last_sign_in_at
    FROM agency_co_owners co
    JOIN users u      ON u.id = co.user_id
    LEFT JOIN auth.users au ON au.id = u.auth_user_id
   WHERE co.agency_id = target_agency_id
   ORDER BY co.granted_at;
END;
$$;

GRANT EXECUTE ON FUNCTION list_agency_co_owners(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION add_agency_co_owner(
  target_agency_id uuid,
  target_email     text
)
RETURNS uuid  -- the new agency_co_owners.id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id    uuid;
  v_target_id    uuid;
  v_owner_email  text;
  v_new_id       uuid;
BEGIN
  IF NOT _is_primary_agency_owner(target_agency_id) THEN
    RAISE EXCEPTION 'Only the primary agency owner can add co-owners';
  END IF;

  SELECT owner_email INTO v_owner_email FROM agencies WHERE id = target_agency_id;
  IF LOWER(v_owner_email) = LOWER(target_email) THEN
    RAISE EXCEPTION 'User is already the primary agency owner';
  END IF;

  SELECT id INTO v_target_id FROM users WHERE LOWER(email) = LOWER(target_email);
  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'No user exists with email %. They must sign in once before being made a co-owner.', target_email;
  END IF;

  SELECT id INTO v_caller_id FROM users WHERE auth_user_id = auth.uid();

  INSERT INTO agency_co_owners (agency_id, user_id, granted_by)
  VALUES (target_agency_id, v_target_id, v_caller_id)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION add_agency_co_owner(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION remove_agency_co_owner(
  target_agency_id uuid,
  target_user_id   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT _is_primary_agency_owner(target_agency_id) THEN
    RAISE EXCEPTION 'Only the primary agency owner can remove co-owners';
  END IF;

  DELETE FROM agency_co_owners
   WHERE agency_id = target_agency_id
     AND user_id   = target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_agency_co_owner(uuid, uuid) TO authenticated;
