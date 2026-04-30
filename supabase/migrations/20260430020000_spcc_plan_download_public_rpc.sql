/*
  # Public RPC for the per-berm SPCC Plan Download landing page

  Powers `/spcc-plan/<facility_id>/berm/<berm_index>/download`. Returns
  the minimal fields the landing page needs to:
    - Build the canonical filename ("Name - Camino ID - SPCC Plan|Renewal (MM-DD-YY).pdf")
    - Fetch the PDF from Storage and trigger a Blob download

  SECURITY DEFINER + GRANT to anon: the URL is intentionally shareable
  externally (e.g. with PE engineers), so unauthenticated callers must
  be able to resolve a plan from facility_id + berm_index.
*/

CREATE OR REPLACE FUNCTION get_spcc_plan_for_download(
  p_facility_id uuid,
  p_berm_index integer
)
RETURNS TABLE (
  facility_name text,
  matched_facility_name text,
  camino_facility_id text,
  plan_url text,
  pe_stamp_date date,
  recertified_date date,
  berm_index integer,
  berm_label text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $func_get_plan_for_download$
BEGIN
  RETURN QUERY
  SELECT
    f.name::text,
    f.matched_facility_name::text,
    f.camino_facility_id::text,
    p.plan_url::text,
    p.pe_stamp_date::date,
    p.recertified_date::date,
    p.berm_index::integer,
    p.berm_label::text
  FROM spcc_plans p
  JOIN facilities f ON f.id = p.facility_id
  WHERE p.facility_id = p_facility_id
    AND p.berm_index = p_berm_index
    AND p.plan_url IS NOT NULL;
END;
$func_get_plan_for_download$;

GRANT EXECUTE ON FUNCTION get_spcc_plan_for_download(uuid, integer) TO anon;
GRANT EXECUTE ON FUNCTION get_spcc_plan_for_download(uuid, integer) TO authenticated;

COMMENT ON FUNCTION get_spcc_plan_for_download(uuid, integer) IS
  'Public read used by the per-berm SPCC plan download landing page. Returns the canonical-filename inputs + plan_url for unauthenticated callers.';
