# Survey-Route authentication emails

`recovery.html` is the production Supabase password-reset email, styled to match
`supabase/functions/send-invite-email/index.ts`.

- Project: `rbjvcwgmqnubxixneitb` (survey-route)
- Subject: `Reset your Survey-Route password`
- Dashboard: https://supabase.com/dashboard/project/rbjvcwgmqnubxixneitb/auth/templates
- Applied and read back through the Supabase Management API on 2026-09-11.

All app password-reset requests use `resetPassword` in `src/contexts/AuthContext.tsx`.
Keep `{{ .ConfirmationURL }}` in the Outlook button, standard button, and fallback
link so Supabase supplies the recovery token and the caller's redirect URL.

Pushing this file does not update Supabase. Apply the subject and HTML in the
hosted project's Reset Password template, or PATCH only
`mailer_subjects_recovery` and `mailer_templates_recovery_content` at
`/v1/projects/rbjvcwgmqnubxixneitb/config/auth`, then read them back to verify.
Never put management credentials in this repository.

Custom SMTP is not configured as of the application date. The subject and body
are branded, but changing the default Supabase sender requires a verified custom
SMTP provider. Do not change delivery settings without valid provider credentials.

## Brand spelling

Visible product name: **Survey-Route**. Visible domain: **Survey-Route.com**.
URL hostnames and sender addresses remain lowercase. Internal storage keys and
app identifiers are unchanged so existing sessions and offline data remain valid.

The page and emails use `/survey-route-logo-v2.png` to avoid cached old artwork.
The older public logo filenames also contain the corrected artwork.

Logo edited with the built-in image generation tool from the previous logo.
Prompt: Change only the main text from SurveyRoute to exactly Survey-Route,
preserving the blue route mark, bold typography, white background, and
“by BEAR DATA” subtitle.
