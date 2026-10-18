# Draft profile linking repair

The legacy direct UPDATE policy does not bind linking to an invitation or the authenticated email. Remove that one policy. Keep the existing `accept_user_invitation(text)` path, already used by `AcceptInvitePage`, which validates the pending unexpired token and authenticated email before linking the original profile and adding the invited account membership.

The migration changes one policy only; it does not edit profiles, Auth records, memberships, grants, functions, or SPCC integration tables. Existing own-profile edits and normal signup inserts remain unchanged. This repair is a separate review and approval from the SPCC integration.

Validation: `PGLITE_MODULE=<local module> node scripts/verify-profile-link-policy.mjs` reproduces the old behavior on synthetic data, then applies the actual migration twice and exercises the actual existing invitation function. It verifies blocked direct claims, valid recipient linking without a duplicate profile, preserved prior memberships, existing/fresh invitees, and wrong/expired/reused token denial.

No live exploitation, policy changes or credential/identity edits were performed. This migration has NOT been applied. Applying the access-policy change requires separate explicit approval. Do not restore the unsafe policy as a rollback; investigate legitimate failures through the existing invitation path instead.
