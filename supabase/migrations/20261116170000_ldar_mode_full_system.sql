/*
  # Comprehensive LDAR Mode System (LeakTracker Pro Parity)

  1. Widens `survey_types.system_kind` to support `'ldar'` and seeds the default
     `'LDAR'` system survey mode for all existing and future accounts.
  2. Adds LDAR scheduling, regulatory applicability, component inventory,
     denormalized open/DOR leak counters, and LDAR invoice columns to `facilities`,
     plus `ldar_visit_duration_minutes` to `user_settings`.
  3. Creates `ldar_equipment_certifications` (OGI cameras, Method 21 analyzers,
     calibration gas, and inspector certifications + Appendix K QA checks).
  4. Creates `ldar_surveys` (OGI, Appendix K OGI, AVO, Method 21, Acoustic,
     Flyover surveys with start/end weather logs, daily QA, deviations) +
     automatic facility schedule sync trigger.
  5. Creates `ldar_leaks` (4-stage leak repair lifecycle, multi-regulation
     FAAR / Repair / Confirmation due dates, repair attempt audit trail, and
     Delay of Repair governance) + automatic facility leak counter trigger.
  6. Widens route-status run constraints and RPCs (`sync_route_status_run_stops`,
     `reset_route_status`, `complete_ldar_route_stop`) to support `'ldar'`.
*/

-- ============================================================================
-- 1. User Settings & Facility LDAR Columns
-- ============================================================================
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS ldar_visit_duration_minutes integer DEFAULT 45;

ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS ldar_applicable_regulations text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS ldar_survey_frequency text DEFAULT 'quarterly',
  ADD COLUMN IF NOT EXISTS ldar_primary_method text DEFAULT 'OGI',
  ADD COLUMN IF NOT EXISTS ldar_last_survey_date date,
  ADD COLUMN IF NOT EXISTS ldar_next_survey_due date,
  ADD COLUMN IF NOT EXISTS ldar_earliest_window_date date,
  ADD COLUMN IF NOT EXISTS ldar_facility_type text DEFAULT 'Well Site',
  ADD COLUMN IF NOT EXISTS ldar_region_basin text,
  ADD COLUMN IF NOT EXISTS ldar_planned_shutdown_date date,
  ADD COLUMN IF NOT EXISTS ldar_open_leaks_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ldar_dor_leaks_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ldar_equipment_inventory jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ldar_invoiced boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ldar_invoiced_at timestamptz,
  ADD COLUMN IF NOT EXISTS ldar_paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ldar_paid_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_facilities_ldar_next_due
  ON public.facilities(account_id, ldar_next_survey_due);

-- ============================================================================
-- 2. Survey Types: Widen system_kind & Seed Default LDAR Mode
-- ============================================================================
ALTER TABLE public.survey_types
  DROP CONSTRAINT IF EXISTS survey_types_system_kind_check;

ALTER TABLE public.survey_types
  ADD CONSTRAINT survey_types_system_kind_check
  CHECK (system_kind IS NULL OR system_kind IN ('spcc_plan', 'spcc_inspection', 'ldar'));

DO $$
DECLARE
  acc RECORD;
BEGIN
  FOR acc IN SELECT id FROM public.accounts LOOP
    INSERT INTO public.survey_types (
      account_id, name, description, icon, color,
      is_system, enabled, sort_order, system_kind,
      visit_duration_minutes, show_as_route_mode
    )
    VALUES (
      acc.id, 'LDAR',
      'Leak Detection and Repair (OGI / AVO / Method 21) monitoring, leak repair & regulatory compliance',
      'wind', '#0D9488',
      true, true, 2, 'ldar',
      45, true
    )
    ON CONFLICT (account_id, name) DO UPDATE
      SET system_kind = 'ldar',
          is_system = true,
          show_as_route_mode = true;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.seed_default_survey_types() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.survey_types (
    account_id, name, description, icon, color,
    is_system, enabled, sort_order, system_kind,
    visit_duration_minutes, show_as_route_mode
  )
  VALUES
    (NEW.id, 'SPCC Plan',
     'Spill Prevention, Control, and Countermeasure Plan documentation',
     'file-text', '#3B82F6',
     true, true, 0, 'spcc_plan',
     60, true),
    (NEW.id, 'SPCC Inspection',
     'SPCC compliance inspection checklist',
     'clipboard-check', '#10B981',
     true, true, 1, 'spcc_inspection',
     30, true),
    (NEW.id, 'LDAR',
     'Leak Detection and Repair (OGI / AVO / Method 21) monitoring, leak repair & regulatory compliance',
     'wind', '#0D9488',
     true, true, 2, 'ldar',
     45, true)
  ON CONFLICT (account_id, name) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 3. LDAR Equipment & Inspector Certifications (Cameras, FID/TVA, Certs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ldar_equipment_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  item_category text NOT NULL DEFAULT 'ogi_camera'
    CHECK (item_category IN ('ogi_camera', 'method21_analyzer', 'cal_gas', 'inspector_cert')),
  name text NOT NULL,
  model text,
  serial_number text,
  assigned_to text,
  certification_date date,
  expiration_date date,
  daily_qa_verified_date date,
  daily_qa_notes text,
  operating_envelope jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expiring', 'expired', 'maintenance')),
  notes text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ldar_equipment_account
  ON public.ldar_equipment_certifications(account_id, item_category);

ALTER TABLE public.ldar_equipment_certifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ldar_equipment_certifications'
      AND policyname = 'Users can view ldar equipment for accessible accounts'
  ) THEN
    CREATE POLICY "Users can view ldar equipment for accessible accounts"
      ON public.ldar_equipment_certifications FOR SELECT
      USING (public.user_has_account_access(account_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ldar_equipment_certifications'
      AND policyname = 'Users can insert ldar equipment for accessible accounts'
  ) THEN
    CREATE POLICY "Users can insert ldar equipment for accessible accounts"
      ON public.ldar_equipment_certifications FOR INSERT
      WITH CHECK (public.user_has_account_access(account_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ldar_equipment_certifications'
      AND policyname = 'Users can update ldar equipment for accessible accounts'
  ) THEN
    CREATE POLICY "Users can update ldar equipment for accessible accounts"
      ON public.ldar_equipment_certifications FOR UPDATE
      USING (public.user_has_account_access(account_id))
      WITH CHECK (public.user_has_account_access(account_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ldar_equipment_certifications'
      AND policyname = 'Users can delete ldar equipment for accessible accounts'
  ) THEN
    CREATE POLICY "Users can delete ldar equipment for accessible accounts"
      ON public.ldar_equipment_certifications FOR DELETE
      USING (public.user_has_account_access(account_id));
  END IF;
END $$;

-- ============================================================================
-- 4. LDAR Surveys (OGI, Appendix K OGI, AVO, Method 21, Acoustic, Flyover)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ldar_surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  sub_facility_name text,
  survey_method text NOT NULL DEFAULT 'OGI',
  survey_reason text NOT NULL DEFAULT 'Routine',
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('draft', 'completed')),
  inspector_name text NOT NULL,
  additional_inspectors text[] DEFAULT '{}'::text[],
  survey_date date NOT NULL DEFAULT CURRENT_DATE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  equipment_id uuid REFERENCES public.ldar_equipment_certifications(id) ON DELETE SET NULL,
  camera_model text,
  camera_serial text,
  daily_qa_completed boolean NOT NULL DEFAULT true,
  daily_qa_mode text DEFAULT 'operating_envelope',
  delta_t_f numeric,
  max_viewing_distance_ft numeric,
  qa_gas_flow_rate_ghr numeric,
  qa_video_reference text,
  temp_start_f numeric,
  temp_end_f numeric,
  humidity_pct numeric,
  wind_speed_avg_mph numeric,
  wind_speed_max_mph numeric,
  wind_direction text,
  sky_conditions text DEFAULT 'Clear',
  deviated_from_plan boolean NOT NULL DEFAULT false,
  deviation_justification text,
  leaks_found_count integer NOT NULL DEFAULT 0,
  leaks_repaired_during_survey integer NOT NULL DEFAULT 0,
  site_photo_url text,
  signature_data text,
  notes text,
  weather_log jsonb DEFAULT '[]'::jsonb,
  attachments jsonb DEFAULT '[]'::jsonb,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ldar_surveys_facility
  ON public.ldar_surveys(facility_id, survey_date DESC);
CREATE INDEX IF NOT EXISTS idx_ldar_surveys_account
  ON public.ldar_surveys(account_id, survey_date DESC);

ALTER TABLE public.ldar_surveys ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ldar_surveys'
      AND policyname = 'Users can view ldar surveys for accessible accounts'
  ) THEN
    CREATE POLICY "Users can view ldar surveys for accessible accounts"
      ON public.ldar_surveys FOR SELECT
      USING (public.user_has_account_access(account_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ldar_surveys'
      AND policyname = 'Users can insert ldar surveys for accessible accounts'
  ) THEN
    CREATE POLICY "Users can insert ldar surveys for accessible accounts"
      ON public.ldar_surveys FOR INSERT
      WITH CHECK (public.user_has_account_access(account_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ldar_surveys'
      AND policyname = 'Users can update ldar surveys for accessible accounts'
  ) THEN
    CREATE POLICY "Users can update ldar surveys for accessible accounts"
      ON public.ldar_surveys FOR UPDATE
      USING (public.user_has_account_access(account_id))
      WITH CHECK (public.user_has_account_access(account_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ldar_surveys'
      AND policyname = 'Users can delete ldar surveys for accessible accounts'
  ) THEN
    CREATE POLICY "Users can delete ldar surveys for accessible accounts"
      ON public.ldar_surveys FOR DELETE
      USING (public.user_has_account_access(account_id));
  END IF;
END $$;

-- Trigger to auto-update facility LDAR schedule dates when routine surveys complete
CREATE OR REPLACE FUNCTION public._recompute_facility_ldar_survey_dates(target_facility_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_latest_date date;
  v_freq text;
  v_next_due date;
  v_window_start date;
BEGIN
  IF target_facility_id IS NULL THEN RETURN; END IF;

  SELECT MAX(survey_date) INTO v_latest_date
  FROM public.ldar_surveys
  WHERE facility_id = target_facility_id
    AND status = 'completed'
    AND survey_reason IN ('Routine', 'Initial');

  SELECT COALESCE(ldar_survey_frequency, 'quarterly') INTO v_freq
  FROM public.facilities WHERE id = target_facility_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_latest_date IS NULL THEN
    UPDATE public.facilities
    SET ldar_last_survey_date = NULL,
        ldar_next_survey_due = NULL,
        ldar_earliest_window_date = NULL
    WHERE id = target_facility_id;
  ELSIF v_freq = 'exempt' THEN
    UPDATE public.facilities
    SET ldar_last_survey_date = v_latest_date,
        ldar_next_survey_due = NULL,
        ldar_earliest_window_date = NULL
    WHERE id = target_facility_id;
  ELSE
    v_next_due := CASE v_freq
      WHEN 'weekly' THEN (v_latest_date + INTERVAL '7 days')::date
      WHEN 'monthly' THEN (v_latest_date + INTERVAL '30 days')::date
      WHEN 'bi_monthly' THEN (v_latest_date + INTERVAL '60 days')::date
      WHEN 'quarterly' THEN (v_latest_date + INTERVAL '90 days')::date
      WHEN 'semi_annual' THEN (v_latest_date + INTERVAL '180 days')::date
      WHEN 'annual' THEN (v_latest_date + INTERVAL '365 days')::date
      ELSE (v_latest_date + INTERVAL '90 days')::date
    END;
    v_window_start := CASE v_freq
      WHEN 'weekly' THEN (v_latest_date + INTERVAL '4 days')::date
      WHEN 'monthly' THEN (v_latest_date + INTERVAL '15 days')::date
      WHEN 'bi_monthly' THEN (v_latest_date + INTERVAL '40 days')::date
      WHEN 'quarterly' THEN (v_latest_date + INTERVAL '60 days')::date
      WHEN 'semi_annual' THEN (v_latest_date + INTERVAL '120 days')::date
      WHEN 'annual' THEN (v_latest_date + INTERVAL '300 days')::date
      ELSE (v_latest_date + INTERVAL '60 days')::date
    END;

    UPDATE public.facilities
    SET ldar_last_survey_date = v_latest_date,
        ldar_next_survey_due = v_next_due,
        ldar_earliest_window_date = v_window_start
    WHERE id = target_facility_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._recompute_facility_ldar_survey_dates(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_facility_ldar_survey_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.facility_id IS DISTINCT FROM NEW.facility_id THEN
    PERFORM public._recompute_facility_ldar_survey_dates(OLD.facility_id);
  END IF;
  PERFORM public._recompute_facility_ldar_survey_dates(COALESCE(NEW.facility_id, OLD.facility_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_facility_ldar_survey_dates ON public.ldar_surveys;
CREATE TRIGGER trg_sync_facility_ldar_survey_dates
  AFTER INSERT OR UPDATE OR DELETE ON public.ldar_surveys
  FOR EACH ROW EXECUTE FUNCTION public.sync_facility_ldar_survey_dates();

-- ============================================================================
-- 5. LDAR Leaks (4-Stage Repair Lifecycle + Multi-Reg Deadlines + DOR)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ldar_leaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  survey_id uuid REFERENCES public.ldar_surveys(id) ON DELETE SET NULL,
  leak_tag_id text NOT NULL,
  sub_facility_name text,
  equipment_unit text,
  component_type text NOT NULL DEFAULT 'Valve',
  component_subtype text,
  component_size text,
  gas_stream_type text DEFAULT 'Sales Gas',
  detection_method text NOT NULL DEFAULT 'OGI',
  detected_at date NOT NULL DEFAULT CURRENT_DATE,
  detected_by text,
  flow_rate_value numeric,
  flow_rate_unit text DEFAULT 'scfh',
  estimated_co2e_mt_yr numeric,
  location_description text,
  latitude numeric,
  longitude numeric,
  optical_photo_url text,
  infrared_photo_url text,
  infrared_video_url text,
  status text NOT NULL DEFAULT 'detected'
    CHECK (status IN ('detected', 'repair_attempted', 'pending_confirmation', 'repaired', 'dor_pending', 'dor_approved')),
  applicable_regulations text[] DEFAULT '{}'::text[],
  faar_due_date date,
  final_repair_due_date date,
  confirmation_due_date date,
  first_attempt_date date,
  first_attempt_by text,
  first_attempt_notes text,
  repaired_date date,
  repaired_by text,
  repair_method text,
  repair_attempts jsonb DEFAULT '[]'::jsonb,
  confirmed_date date,
  confirmed_by text,
  confirmation_method text,
  confirmation_reading numeric,
  confirmation_unit text,
  confirmation_passed boolean,
  dor_requested_at timestamptz,
  dor_requested_by text,
  dor_status text NOT NULL DEFAULT 'none'
    CHECK (dor_status IN ('none', 'pending', 'approved', 'denied')),
  dor_reason_code text,
  dor_justification text,
  dor_parts_order_number text,
  dor_parts_eta date,
  dor_planned_shutdown_date date,
  dor_extended_due_date date,
  dor_reviewed_by text,
  dor_reviewed_at timestamptz,
  dor_review_notes text,
  notes text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ldar_leaks_facility
  ON public.ldar_leaks(facility_id, status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_ldar_leaks_account
  ON public.ldar_leaks(account_id, status, final_repair_due_date);

ALTER TABLE public.ldar_leaks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ldar_leaks'
      AND policyname = 'Users can view ldar leaks for accessible accounts'
  ) THEN
    CREATE POLICY "Users can view ldar leaks for accessible accounts"
      ON public.ldar_leaks FOR SELECT
      USING (public.user_has_account_access(account_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ldar_leaks'
      AND policyname = 'Users can insert ldar leaks for accessible accounts'
  ) THEN
    CREATE POLICY "Users can insert ldar leaks for accessible accounts"
      ON public.ldar_leaks FOR INSERT
      WITH CHECK (public.user_has_account_access(account_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ldar_leaks'
      AND policyname = 'Users can update ldar leaks for accessible accounts'
  ) THEN
    CREATE POLICY "Users can update ldar leaks for accessible accounts"
      ON public.ldar_leaks FOR UPDATE
      USING (public.user_has_account_access(account_id))
      WITH CHECK (public.user_has_account_access(account_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ldar_leaks'
      AND policyname = 'Users can delete ldar leaks for accessible accounts'
  ) THEN
    CREATE POLICY "Users can delete ldar leaks for accessible accounts"
      ON public.ldar_leaks FOR DELETE
      USING (public.user_has_account_access(account_id));
  END IF;
END $$;

-- Trigger to maintain denormalized open & DOR leak counts on facilities
CREATE OR REPLACE FUNCTION public._recompute_facility_ldar_leak_counts(target_facility_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_open_count integer;
  v_dor_count integer;
BEGIN
  IF target_facility_id IS NULL THEN RETURN; END IF;

  SELECT
    COUNT(*) FILTER (WHERE status <> 'repaired')::integer,
    COUNT(*) FILTER (WHERE status IN ('dor_pending', 'dor_approved'))::integer
  INTO v_open_count, v_dor_count
  FROM public.ldar_leaks
  WHERE facility_id = target_facility_id;

  UPDATE public.facilities
  SET ldar_open_leaks_count = COALESCE(v_open_count, 0),
      ldar_dor_leaks_count = COALESCE(v_dor_count, 0)
  WHERE id = target_facility_id;
END;
$$;
REVOKE ALL ON FUNCTION public._recompute_facility_ldar_leak_counts(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_facility_ldar_leak_counts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.facility_id IS DISTINCT FROM NEW.facility_id THEN
    PERFORM public._recompute_facility_ldar_leak_counts(OLD.facility_id);
  END IF;
  PERFORM public._recompute_facility_ldar_leak_counts(COALESCE(NEW.facility_id, OLD.facility_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_facility_ldar_leak_counts ON public.ldar_leaks;
CREATE TRIGGER trg_sync_facility_ldar_leak_counts
  AFTER INSERT OR UPDATE OR DELETE ON public.ldar_leaks
  FOR EACH ROW EXECUTE FUNCTION public.sync_facility_ldar_leak_counts();

-- ============================================================================
-- 6. Widen Route Status Run Constraints & RPCs for LDAR Mode
-- ============================================================================
ALTER TABLE public.plan_route_runs
  DROP CONSTRAINT IF EXISTS plan_route_runs_survey_type_check;
ALTER TABLE public.plan_route_runs
  ADD CONSTRAINT plan_route_runs_survey_type_check
  CHECK (survey_type IN ('spcc_inspection', 'spcc_plan', 'ldar'));

ALTER TABLE public.plan_route_run_stops
  DROP CONSTRAINT IF EXISTS plan_route_run_stops_survey_type_check;
ALTER TABLE public.plan_route_run_stops
  ADD CONSTRAINT plan_route_run_stops_survey_type_check
  CHECK (survey_type IS NULL OR survey_type IN ('spcc_inspection', 'spcc_plan', 'ldar'));

ALTER TABLE public.plan_route_stop_action_requests
  DROP CONSTRAINT IF EXISTS plan_route_stop_action_scope_check,
  DROP CONSTRAINT IF EXISTS plan_route_stop_action_kind_check;
ALTER TABLE public.plan_route_stop_action_requests
  ADD CONSTRAINT plan_route_stop_action_scope_check
    CHECK (survey_type IN ('spcc_inspection', 'spcc_plan', 'ldar')),
  ADD CONSTRAINT plan_route_stop_action_kind_check
    CHECK (action_kind IN ('plan_photos', 'inspection_complete', 'ldar_survey_complete'));

ALTER TABLE public.route_status_reset_requests
  DROP CONSTRAINT IF EXISTS route_status_reset_requests_requested_scope_check;
ALTER TABLE public.route_status_reset_requests
  ADD CONSTRAINT route_status_reset_requests_requested_scope_check
  CHECK (requested_scope IN ('spcc_inspection', 'spcc_plan', 'ldar', 'all'));

CREATE OR REPLACE FUNCTION public.sync_route_status_run_stops(target_run_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_run public.plan_route_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.plan_route_runs
  WHERE id = target_run_id AND status = 'active'
    AND survey_type IN ('spcc_inspection', 'spcc_plan', 'ldar');
  IF v_run.id IS NULL OR auth.uid() IS NULL OR NOT public.user_has_account_access(v_run.account_id) THEN
    RAISE EXCEPTION 'Not authorized for this route status run';
  END IF;
  PERFORM 1 FROM public.route_plans
  WHERE id = v_run.route_plan_id AND account_id = v_run.account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Route plan not found for this account'; END IF;
  SELECT * INTO v_run FROM public.plan_route_runs
  WHERE id = target_run_id AND status = 'active'
    AND survey_type IN ('spcc_inspection', 'spcc_plan', 'ldar') FOR UPDATE;
  IF v_run.id IS NULL THEN RETURN; END IF;
  PERFORM public._sync_plan_route_run_stops(v_run.id, '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.sync_route_status_run_stops(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_route_status_run_stops(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reset_route_status(
  target_account_id uuid, target_route_plan_id uuid, target_team_number integer,
  target_scope text, target_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan_data jsonb;
  v_existing public.route_status_reset_requests%ROWTYPE;
  v_domain text;
  v_domains text[];
  v_run public.plan_route_runs%ROWTYPE;
  v_stops jsonb;
  v_runs jsonb := '[]'::jsonb;
  v_response jsonb;
  v_unique integer;
  v_domain_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF target_team_number IS NULL OR target_team_number < 1 THEN RAISE EXCEPTION 'Invalid team number'; END IF;
  IF target_scope NOT IN ('spcc_inspection', 'spcc_plan', 'ldar', 'all') THEN RAISE EXCEPTION 'Invalid route status scope'; END IF;
  IF target_idempotency_key IS NULL THEN RAISE EXCEPTION 'Idempotency key is required'; END IF;
  IF NOT public.user_has_account_access(target_account_id) THEN RAISE EXCEPTION 'Not authorized for this account'; END IF;

  SELECT plan_data INTO v_plan_data FROM public.route_plans
  WHERE id = target_route_plan_id AND account_id = target_account_id FOR UPDATE;
  IF v_plan_data IS NULL THEN RAISE EXCEPTION 'Route plan not found for this account'; END IF;

  SELECT * INTO v_existing FROM public.route_status_reset_requests WHERE idempotency_key = target_idempotency_key;
  IF v_existing.idempotency_key IS NOT NULL THEN
    IF v_existing.account_id IS DISTINCT FROM target_account_id
      OR v_existing.route_plan_id IS DISTINCT FROM target_route_plan_id
      OR v_existing.team_number IS DISTINCT FROM target_team_number
      OR v_existing.requested_scope IS DISTINCT FROM target_scope
    THEN RAISE EXCEPTION 'Idempotency key is already used for another route status reset'; END IF;
    RETURN v_existing.response;
  END IF;

  v_domains := CASE WHEN target_scope = 'all'
    THEN ARRAY['spcc_inspection', 'spcc_plan', 'ldar']::text[] ELSE ARRAY[target_scope]::text[] END;

  FOREACH v_domain IN ARRAY v_domains LOOP
    UPDATE public.plan_route_runs current_run
    SET status = CASE WHEN EXISTS (
      SELECT 1 FROM public.plan_route_run_stops stop
      WHERE stop.route_run_id = current_run.id AND stop.removed_at IS NULL AND stop.status <> 'completed'
    ) THEN 'abandoned' ELSE 'completed' END,
    ended_at = now(), ended_by = auth.uid()
    WHERE current_run.account_id = target_account_id
      AND current_run.route_plan_id = target_route_plan_id
      AND current_run.team_number = target_team_number
      AND current_run.survey_type = v_domain
      AND current_run.status = 'active';

    INSERT INTO public.plan_route_runs(account_id, route_plan_id, survey_type, team_number, status, started_by)
    VALUES(target_account_id, target_route_plan_id, v_domain, target_team_number, 'active', auth.uid())
    RETURNING * INTO v_run;
    PERFORM public._sync_plan_route_run_stops(v_run.id, '[]'::jsonb);
    SELECT COALESCE(jsonb_agg(to_jsonb(stop) ORDER BY stop.planned_day, stop.planned_position), '[]'::jsonb), COUNT(*)::integer
    INTO v_stops, v_domain_count
    FROM public.plan_route_run_stops stop
    WHERE stop.route_run_id = v_run.id AND stop.removed_at IS NULL AND stop.status <> 'removed';
    v_runs := v_runs || jsonb_build_array(jsonb_build_object(
      'survey_type', v_domain, 'run', to_jsonb(v_run), 'stops', v_stops
    ));
  END LOOP;

  SELECT COUNT(DISTINCT assignment.facility_id)::integer INTO v_unique
  FROM jsonb_to_recordset(public._route_plan_assignments_from_data(target_account_id, v_plan_data))
    AS assignment(facility_id uuid, facility_name text, day_assignment integer,
      planned_day integer, team_assignment integer, planned_position integer)
  WHERE assignment.team_assignment = target_team_number;

  SELECT COUNT(*)::integer INTO v_domain_count
  FROM public.plan_route_run_stops stop
  JOIN public.plan_route_runs run ON run.id = stop.route_run_id
  WHERE run.id IN (
    SELECT (item.value->'run'->>'id')::uuid
    FROM jsonb_array_elements(v_runs) AS item(value)
  )
    AND stop.removed_at IS NULL AND stop.status <> 'removed';

  v_response := jsonb_build_object(
    'account_id', target_account_id, 'route_plan_id', target_route_plan_id,
    'team_number', target_team_number, 'requested_scope', target_scope,
    'runs', v_runs, 'unique_facility_count', COALESCE(v_unique, 0),
    'domain_stop_count', COALESCE(v_domain_count, 0)
  );
  INSERT INTO public.route_status_reset_requests(
    idempotency_key, account_id, route_plan_id, team_number, requested_scope, requested_by, response
  ) VALUES(target_idempotency_key, target_account_id, target_route_plan_id, target_team_number, target_scope, auth.uid(), v_response);
  RETURN v_response;
END;
$$;
REVOKE ALL ON FUNCTION public.reset_route_status(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_route_status(uuid, uuid, integer, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_ldar_route_stop(
  target_run_id uuid, target_facility_id uuid,
  target_survey_id uuid, target_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.plan_route_runs%ROWTYPE;
  v_stop public.plan_route_run_stops%ROWTYPE;
  v_survey public.ldar_surveys%ROWTYPE;
  v_request public.plan_route_stop_action_requests%ROWTYPE;
  v_response jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF target_idempotency_key IS NULL THEN RAISE EXCEPTION 'Idempotency key is required'; END IF;
  IF target_survey_id IS NULL THEN RAISE EXCEPTION 'Completed LDAR survey ID is required'; END IF;

  SELECT * INTO v_run FROM public.plan_route_runs
  WHERE id = target_run_id AND status = 'active' AND survey_type = 'ldar' FOR UPDATE;
  IF v_run.id IS NULL OR NOT public.user_has_account_access(v_run.account_id) THEN
    RAISE EXCEPTION 'Not authorized for this LDAR route run';
  END IF;

  SELECT * INTO v_stop FROM public.plan_route_run_stops
  WHERE route_run_id = v_run.id AND facility_id = target_facility_id
    AND account_id = v_run.account_id AND route_plan_id = v_run.route_plan_id
    AND team_number = v_run.team_number AND survey_type = 'ldar'
    AND removed_at IS NULL AND status <> 'removed' FOR UPDATE;
  IF v_stop.id IS NULL THEN
    RAISE EXCEPTION 'Facility is not an active stop on this LDAR route run';
  END IF;

  SELECT * INTO v_survey FROM public.ldar_surveys
  WHERE id = target_survey_id AND facility_id = target_facility_id
    AND account_id = v_run.account_id AND status = 'completed';
  IF v_survey.id IS NULL THEN
    RAISE EXCEPTION 'Completed LDAR survey not found for this route stop';
  END IF;
  IF v_survey.updated_at IS NULL OR v_survey.updated_at < v_run.started_at THEN
    RAISE EXCEPTION 'LDAR survey predates the active route status run';
  END IF;

  SELECT * INTO v_request FROM public.plan_route_stop_action_requests WHERE idempotency_key = target_idempotency_key;
  IF v_request.idempotency_key IS NOT NULL THEN
    IF v_request.account_id IS DISTINCT FROM v_run.account_id
      OR v_request.route_run_id IS DISTINCT FROM v_run.id
      OR v_request.facility_id IS DISTINCT FROM target_facility_id
      OR v_request.action_kind IS DISTINCT FROM 'ldar_survey_complete'
      OR v_request.source_record_id IS DISTINCT FROM target_survey_id
    THEN
      RAISE EXCEPTION 'Idempotency key is already used for another route stop action';
    END IF;
    RETURN v_request.response;
  END IF;

  UPDATE public.plan_route_run_stops
  SET status = 'completed',
      completed_at = COALESCE(completed_at, now()),
      completed_by = COALESCE(completed_by, auth.uid()),
      updated_at = now()
  WHERE id = v_stop.id RETURNING * INTO v_stop;

  v_response := jsonb_build_object(
    'run_id', v_run.id, 'stop_id', v_stop.id,
    'facility_id', target_facility_id, 'status', v_stop.status, 'completed_at', v_stop.completed_at
  );
  INSERT INTO public.plan_route_stop_action_requests(
    idempotency_key, account_id, route_run_id, route_plan_id, team_number, survey_type,
    facility_id, requested_completed, action_kind, source_record_id, response
  ) VALUES(
    target_idempotency_key, v_run.account_id, v_run.id, v_run.route_plan_id,
    v_run.team_number, v_run.survey_type, target_facility_id, true,
    'ldar_survey_complete', target_survey_id, v_response
  );
  RETURN v_response;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_ldar_route_stop(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_ldar_route_stop(uuid, uuid, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
