/*
  # Inspection item follow-ups + Inspections column layout

  1. inspection_item_followups
     One row per flagged inspection item that has been checked off from the
     Facilities table's "Last Inspection Findings" modal. Row present = done;
     unchecking deletes it. Kept in its own table so the signed inspection
     record (inspections.responses) is never edited by a to-do check-off.

     Access mirrors inspection_photos: anyone who can access the parent
     inspection's account (public.user_has_account_access).

  2. Saved Inspections-mode column layouts
     In every saved '_inspection' layout: drop recertification_status (it is
     an SPCC *plan* field) and show the new inspection_findings column right
     after inspection_status.

  Not applied automatically: paste into the Supabase SQL editor and run.
*/

CREATE TABLE IF NOT EXISTS public.inspection_item_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  question_id text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid DEFAULT auth.uid(),
  UNIQUE (inspection_id, question_id)
);

CREATE INDEX IF NOT EXISTS inspection_item_followups_inspection_id_idx
  ON public.inspection_item_followups (inspection_id);

ALTER TABLE public.inspection_item_followups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Account members can view inspection follow-ups" ON public.inspection_item_followups;
DROP POLICY IF EXISTS "Account members can add inspection follow-ups" ON public.inspection_item_followups;
DROP POLICY IF EXISTS "Account members can remove inspection follow-ups" ON public.inspection_item_followups;

CREATE POLICY "Account members can view inspection follow-ups"
  ON public.inspection_item_followups FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.inspections i
    WHERE i.id = inspection_item_followups.inspection_id
      AND public.user_has_account_access(i.account_id)
  ));

CREATE POLICY "Account members can add inspection follow-ups"
  ON public.inspection_item_followups FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.inspections i
    WHERE i.id = inspection_item_followups.inspection_id
      AND public.user_has_account_access(i.account_id)
  ));

CREATE POLICY "Account members can remove inspection follow-ups"
  ON public.inspection_item_followups FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.inspections i
    WHERE i.id = inspection_item_followups.inspection_id
      AND public.user_has_account_access(i.account_id)
  ));

-- Saved Inspections layouts: drop recertification_status, add inspection_findings.
CREATE OR REPLACE FUNCTION pg_temp.fix_inspection_cols(arr jsonb) RETURNS jsonb
LANGUAGE sql AS $$
  WITH base AS (
    SELECT elem, ord FROM jsonb_array_elements_text(arr) WITH ORDINALITY AS t(elem, ord)
    WHERE elem NOT IN ('recertification_status', 'inspection_findings')
  ),
  anchor AS (
    SELECT COALESCE((SELECT ord FROM base WHERE elem = 'inspection_status'), (SELECT max(ord) FROM base), 0) AS a
  )
  SELECT COALESCE(jsonb_agg(elem ORDER BY sort_key), '[]'::jsonb) FROM (
    SELECT elem, ord::numeric AS sort_key FROM base
    UNION ALL
    SELECT 'inspection_findings', (SELECT a FROM anchor) + 0.5
  ) x
$$;

UPDATE public.user_settings us
SET facilities_ui_preferences = jsonb_set(
  us.facilities_ui_preferences,
  '{columns}',
  (
    SELECT jsonb_object_agg(
      e.k,
      CASE WHEN e.k LIKE '%\_inspection' AND jsonb_typeof(e.v) = 'object' THEN
        e.v
        || CASE WHEN jsonb_typeof(e.v->'visible') = 'array'
                THEN jsonb_build_object('visible', pg_temp.fix_inspection_cols(e.v->'visible')) ELSE '{}'::jsonb END
        || CASE WHEN jsonb_typeof(e.v->'order') = 'array'
                THEN jsonb_build_object('order', pg_temp.fix_inspection_cols(e.v->'order')) ELSE '{}'::jsonb END
      ELSE e.v END
    )
    FROM jsonb_each(us.facilities_ui_preferences->'columns') AS e(k, v)
  )
)
WHERE jsonb_typeof(us.facilities_ui_preferences->'columns') = 'object'
  AND EXISTS (
    SELECT 1 FROM jsonb_object_keys(us.facilities_ui_preferences->'columns') k
    WHERE k LIKE '%\_inspection'
  );
