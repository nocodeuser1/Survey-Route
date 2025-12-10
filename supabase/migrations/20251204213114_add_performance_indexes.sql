/*
  # Add Performance Indexes for Faster Page Loading

  1. Changes
    - Add composite indexes for common RLS policy checks
    - Add indexes for foreign key lookups
    - Optimize query performance for account loading

  2. Impact
    - Significantly faster page load times when entering accounts
    - More efficient RLS policy evaluations
    - Better database query performance
*/

-- Composite index for account_users (account_id, user_id) - most common RLS check
CREATE INDEX IF NOT EXISTS idx_account_users_account_user
  ON account_users(account_id, user_id);

-- Composite index for facilities account_id queries
CREATE INDEX IF NOT EXISTS idx_facilities_account_id
  ON facilities(account_id);

-- Composite index for home_base account_id queries
CREATE INDEX IF NOT EXISTS idx_home_base_account_id
  ON home_base(account_id);

-- Composite index for user_settings account_id queries
CREATE INDEX IF NOT EXISTS idx_user_settings_account_id
  ON user_settings(account_id);

-- Composite index for inspections account_id queries
CREATE INDEX IF NOT EXISTS idx_inspections_account_id
  ON inspections(account_id);

-- Composite index for route_plans (account_id, is_last_viewed)
CREATE INDEX IF NOT EXISTS idx_route_plans_account_last_viewed
  ON route_plans(account_id, is_last_viewed)
  WHERE is_last_viewed = true;

-- Index for users auth_user_id lookup (critical for user profile queries)
CREATE INDEX IF NOT EXISTS idx_users_auth_user_id
  ON users(auth_user_id);

-- Composite index for agencies owner_email lookup
CREATE INDEX IF NOT EXISTS idx_agencies_owner_email
  ON agencies(owner_email);

-- Composite index for accounts (agency_id, status)
CREATE INDEX IF NOT EXISTS idx_accounts_agency_status
  ON accounts(agency_id, status);
