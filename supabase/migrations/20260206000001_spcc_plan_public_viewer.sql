/*
  # Public SPCC Plan Viewer

  Creates a SECURITY DEFINER function accessible by the anon role
  that returns minimal facility info needed to display an SPCC plan
  in the public viewer page (for QR code use).

  Only returns: facility name, plan URL, PE stamp date, and account company name.
  No sensitive data is exposed.
*/

CREATE OR REPLACE FUNCTION get_spcc_plan_public(p_facility_id uuid)
RETURNS TABLE (
  facility_name text,
  plan_url text,
  pe_stamp_date date,
  company_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.name::text AS facility_name,
    f.spcc_plan_url::text AS plan_url,
    f.spcc_pe_stamp_date::date AS pe_stamp_date,
    a.company_name::text AS company_name
  FROM facilities f
  LEFT JOIN accounts a ON a.id = f.account_id
  WHERE f.id = p_facility_id
    AND f.spcc_plan_url IS NOT NULL;
END;
$$;

-- Grant execute permission to the anon role so unauthenticated users can call it
GRANT EXECUTE ON FUNCTION get_spcc_plan_public(uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_spcc_plan_public(uuid) TO authenticated;
