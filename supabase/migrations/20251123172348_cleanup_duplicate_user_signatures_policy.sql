/*
  # Cleanup Duplicate user_signatures SELECT Policy

  1. Issue
    - Two SELECT policies exist on user_signatures table
    - "Users can view own signatures" - uses helper function (correct)
    - "Users can view their own signatures" - uses old subquery pattern (incorrect)

  2. Solution
    - Remove the old policy with the subquery pattern
    - Keep the new policy that uses the helper function
*/

DROP POLICY IF EXISTS "Users can view their own signatures" ON user_signatures;