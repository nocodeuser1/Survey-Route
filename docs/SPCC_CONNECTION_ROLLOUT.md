# Draft deployment handoff

Paired drafts: [Survey Route #2](https://github.com/nocodeuser1/Survey-Route/pull/2) and [myScribe #12](https://github.com/nocodeuser1/myscribe/pull/12).

No production schema, key, source record or document was changed, and no manual deployment was run during implementation. GitHub pushes triggered automatic Netlify frontend deploy previews; hosting secret/flag scope metadata remains unverified.

Requires separate scoped approval before activation:
- Resolve the pre-existing source profile-link authority weakness identified during read-only catalog review. Current intended source Auth identity and account administration were verified, but reusable key issuance must not rely on the unsafe direct unlinked-profile UPDATE path. Detailed synthetic reproduction and private authority evidence stay in the local handoff, outside this repository.
- Verify production-only hosting secret/flag scope metadata without exposing values. The paired myScribe endpoint and assistant tool now require trusted Netlify runtime production/published context; automatic previews cannot enable the integration merely by inheriting its flag.
- Review and apply `supabase/migrations/20261006182947_spcc_readonly_api.sql`.
- Deploy only `spcc-read-api` with gateway JWT verification disabled (its `/keys` route verifies user JWTs with Auth; `/export` authenticates hashed `spcc:read` keys). Enable `SPCC_READ_API_ENABLED=true` only after staging validation.
- Ship the matching myScribe draft and its migration/configuration, then the web frontend for authenticated `/connected-spcc/:facilityId?plan=:planId` links.
- Have the source account administrator create the scoped key in the new UI and securely enter it in myScribe, reviewing both consent controls. No agent should extract or provision it.

Key access is revalidated against the creator's current confirmed Auth email, agency ownership/co-ownership or account_admin membership on every export. Anonymous/browser roles cannot read the key table. The endpoint accepts no source mutation. The application link uses normal signed-in RLS reads, never either existing public SPCC RPC. Existing public sharing/storage behavior is outside this change.

Date semantics: `created_at`/`updated_at` are database record timestamps, not document issuance, submission, upload or completion dates. `pe_stamp_date` is the recorded calendar date; no certification verification is claimed. `management_signature_applied_at` and `recertification_pdf_generated_at` remain distinct. Workflow values are exported verbatim; `completed_uploaded` is the user's manual client-upload milestone, and `pe_stamped` can be inferred by existing source code from file presence. Neither is PE evidence.

Rollback: turn off `SPCC_READ_API_ENABLED`; revoke the integration key. No source facility/plan rollback is needed because the API never writes them. Do not drop tables containing keys without a separate retention decision.
