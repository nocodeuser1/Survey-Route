/*
  # Fix user_settings table for multi-tenant support

  1. Changes
    - Drop the unique constraint on user_id column
    - Add unique constraint on account_id column instead
    - Ensures one settings record per account, not per user
  
  2. Security
    - RLS policies remain unchanged
    - Existing data is preserved
*/

-- Drop the unique constraint on user_id if it exists
DO $$
BEGIN
  -- Drop unique constraint on user_id
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'user_settings_user_id_key' 
    AND table_name = 'user_settings'
  ) THEN
    ALTER TABLE user_settings DROP CONSTRAINT user_settings_user_id_key;
  END IF;
END $$;

-- Make account_id unique instead (one settings per account)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'user_settings_account_id_key' 
    AND table_name = 'user_settings'
  ) THEN
    ALTER TABLE user_settings ADD CONSTRAINT user_settings_account_id_key UNIQUE (account_id);
  END IF;
END $$;