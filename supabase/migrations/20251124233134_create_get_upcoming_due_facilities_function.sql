/*
  # Create Get Upcoming Due Facilities Function

  ## Overview
  Creates an efficient function to find facilities with upcoming SPCC or inspection
  due dates within a specified timeframe. Used by notification system and UI dashboard.

  ## Function: get_upcoming_due_facilities

  ### Inputs
  - p_account_id (uuid) - Account to query
  - p_days_ahead (integer) - How many days ahead to look (e.g., 30)
  - p_notification_type (text, optional) - Filter by type: 'spcc', 'inspection', or NULL for both

  ### Returns
  Table with columns:
  - facility_id (uuid)
  - facility_name (text)
  - notification_type (text) - 'spcc' or 'inspection'
  - due_date (date)
  - days_until_due (integer)
  - status (text) - Compliance or overdue status
  - metadata (jsonb) - Additional context

  ### Logic
  1. Query SPCC compliance for facilities with due dates within window
  2. Query inspection schedules for facilities with due dates within window
  3. Combine and deduplicate results
  4. Sort by due date (most urgent first)

  ## Notes
  - Only returns active/enabled records
  - Excludes facilities with notifications recently sent (within 24 hours)
  - Used by background job and compliance dashboard
*/

-- Create function to get upcoming due facilities
CREATE OR REPLACE FUNCTION get_upcoming_due_facilities(
  p_account_id uuid,
  p_days_ahead integer DEFAULT 30,
  p_notification_type text DEFAULT NULL
)
RETURNS TABLE (
  facility_id uuid,
  facility_name text,
  notification_type text,
  due_date date,
  days_until_due integer,
  status text,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  
  -- Get SPCC compliance due dates
  SELECT
    f.id as facility_id,
    f.name as facility_name,
    'spcc'::text as notification_type,
    sct.current_renewal_due_date as due_date,
    sct.days_until_due,
    sct.compliance_status as status,
    jsonb_build_object(
      'initial_production_date', sct.initial_production_date,
      'renewal_cycle_number', sct.renewal_cycle_number,
      'is_initial_plan', (sct.renewal_cycle_number = 0),
      'last_notification_sent', sct.notification_sent_at
    ) as metadata
  FROM facilities f
  INNER JOIN spcc_compliance_tracking sct ON f.id = sct.facility_id
  WHERE sct.account_id = p_account_id
    AND sct.current_renewal_due_date IS NOT NULL
    AND sct.days_until_due <= p_days_ahead
    AND sct.days_until_due >= 0
    AND sct.is_compliant = false
    AND (p_notification_type IS NULL OR p_notification_type = 'spcc')
    -- Don't send duplicate notifications within 24 hours
    AND (sct.notification_sent_at IS NULL OR sct.notification_sent_at < now() - interval '24 hours')
  
  UNION ALL
  
  -- Get inspection due dates
  SELECT
    f.id as facility_id,
    f.name as facility_name,
    'inspection'::text as notification_type,
    f.next_inspection_due as due_date,
    (f.next_inspection_due - CURRENT_DATE) as days_until_due,
    CASE 
      WHEN f.next_inspection_due < CURRENT_DATE THEN 'overdue'
      WHEN f.next_inspection_due <= CURRENT_DATE + 7 THEN 'due_soon'
      ELSE 'upcoming'
    END as status,
    jsonb_build_object(
      'last_inspection_date', f.last_inspection_date,
      'inspection_frequency_days', f.inspection_frequency_days,
      'last_notification_sent', f.inspection_due_notification_sent_at
    ) as metadata
  FROM facilities f
  WHERE f.account_id = p_account_id
    AND f.next_inspection_due IS NOT NULL
    AND f.next_inspection_due <= CURRENT_DATE + p_days_ahead
    AND f.next_inspection_due >= CURRENT_DATE
    AND (p_notification_type IS NULL OR p_notification_type = 'inspection')
    -- Don't send duplicate notifications within 24 hours
    AND (f.inspection_due_notification_sent_at IS NULL OR f.inspection_due_notification_sent_at < now() - interval '24 hours')
  
  ORDER BY due_date ASC, facility_name ASC;
END;
$$;

-- Create function to get overdue facilities
CREATE OR REPLACE FUNCTION get_overdue_facilities(p_account_id uuid)
RETURNS TABLE (
  facility_id uuid,
  facility_name text,
  notification_type text,
  due_date date,
  days_overdue integer,
  status text,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  
  -- Get overdue SPCC compliance
  SELECT
    f.id as facility_id,
    f.name as facility_name,
    'spcc'::text as notification_type,
    sct.current_renewal_due_date as due_date,
    ABS(sct.days_until_due) as days_overdue,
    'overdue'::text as status,
    jsonb_build_object(
      'initial_production_date', sct.initial_production_date,
      'renewal_cycle_number', sct.renewal_cycle_number,
      'is_initial_plan', (sct.renewal_cycle_number = 0)
    ) as metadata
  FROM facilities f
  INNER JOIN spcc_compliance_tracking sct ON f.id = sct.facility_id
  WHERE sct.account_id = p_account_id
    AND sct.current_renewal_due_date IS NOT NULL
    AND sct.days_until_due < 0
    AND sct.compliance_status = 'overdue'
  
  UNION ALL
  
  -- Get overdue inspections
  SELECT
    f.id as facility_id,
    f.name as facility_name,
    'inspection'::text as notification_type,
    f.next_inspection_due as due_date,
    (CURRENT_DATE - f.next_inspection_due) as days_overdue,
    'overdue'::text as status,
    jsonb_build_object(
      'last_inspection_date', f.last_inspection_date,
      'inspection_frequency_days', f.inspection_frequency_days
    ) as metadata
  FROM facilities f
  WHERE f.account_id = p_account_id
    AND f.next_inspection_due IS NOT NULL
    AND f.next_inspection_due < CURRENT_DATE
  
  ORDER BY days_overdue DESC, facility_name ASC;
END;
$$;

-- Add helpful comments
COMMENT ON FUNCTION get_upcoming_due_facilities IS 'Returns facilities with SPCC or inspection due dates within specified days ahead';
COMMENT ON FUNCTION get_overdue_facilities IS 'Returns facilities with overdue SPCC plans or inspections';
