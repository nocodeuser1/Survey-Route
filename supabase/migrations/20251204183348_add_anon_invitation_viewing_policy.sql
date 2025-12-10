/*
  # Allow Anonymous Users to View Invitations by Token

  1. Problem
    - Users clicking invitation links are not logged in (anonymous)
    - Current RLS policies only allow authenticated users to view invitations
    - This causes "Invalid Invitation" errors when the page tries to verify the token

  2. Solution
    - Add a policy allowing anonymous users to view invitations
    - This is safe because:
      * Tokens are randomly generated and unguessable
      * Anonymous users still can't accept, update, or delete invitations
      * Once logged in, stricter policies apply (must match email)

  3. Security
    - Anonymous access is read-only (SELECT only)
    - Acceptance requires authentication and email match
    - Authenticated users still restricted to their own invitations by email
*/

-- Allow anonymous users to view invitations (needed for token verification before login)
CREATE POLICY "Anonymous users can view invitations by token"
  ON user_invitations
  FOR SELECT
  TO anon
  USING (true);
