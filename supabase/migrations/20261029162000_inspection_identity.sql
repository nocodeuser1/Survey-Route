-- Keep inspection attribution separate from login and agency-owner identity.
-- These nullable snapshot fields preserve the identity used when an inspection
-- was created without rewriting historical records.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS inspection_email text;

ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS inspector_email text;
