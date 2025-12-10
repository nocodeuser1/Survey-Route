/*
  # Fix Inspection Templates RLS Policy

  1. Changes
    - Update RLS policy to allow reading global templates (those with NULL account_id)
    - This allows the shared SPCC Inspection template to be accessible to all users
    - Account-specific templates still require account membership

  2. Security
    - Global templates (account_id IS NULL) are readable by all authenticated users
    - Account-specific templates are only readable by members of that account
*/

-- Drop existing read policy
DROP POLICY IF EXISTS "Account members can view templates in their account" ON inspection_templates;

-- Create new policy that allows reading global templates OR account-specific templates
CREATE POLICY "Users can view global and account templates"
  ON inspection_templates FOR SELECT
  TO authenticated
  USING (
    account_id IS NULL
    OR account_id IN (
      SELECT account_id FROM account_users
      WHERE user_id = auth.uid()
    )
  );