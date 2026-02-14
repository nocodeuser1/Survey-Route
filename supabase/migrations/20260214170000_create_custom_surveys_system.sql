-- Custom Surveys System - Phase 1
-- Creates survey_types, survey_fields, and facility_survey_data tables
-- ADDITIVE ONLY - no destructive operations

-- ============================================
-- 1. survey_types table
-- ============================================
CREATE TABLE IF NOT EXISTS survey_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT 'clipboard',
  color TEXT DEFAULT '#3B82F6',
  is_system BOOLEAN DEFAULT false,
  enabled BOOLEAN DEFAULT true,
  hands_free_enabled BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE survey_types ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_survey_types_account_id ON survey_types(account_id);
CREATE INDEX IF NOT EXISTS idx_survey_types_enabled ON survey_types(account_id, enabled);

-- RLS Policies
CREATE POLICY "Users can view their account survey types"
  ON survey_types FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT au.account_id FROM account_users au WHERE au.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can insert survey types"
  ON survey_types FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id IN (
      SELECT au.account_id FROM account_users au
      WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Admins can update survey types"
  ON survey_types FOR UPDATE
  TO authenticated
  USING (
    account_id IN (
      SELECT au.account_id FROM account_users au
      WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT au.account_id FROM account_users au
      WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Admins can delete custom survey types"
  ON survey_types FOR DELETE
  TO authenticated
  USING (
    is_system = false AND
    account_id IN (
      SELECT au.account_id FROM account_users au
      WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')
    )
  );

-- ============================================
-- 2. survey_fields table
-- ============================================
CREATE TABLE IF NOT EXISTS survey_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_type_id UUID NOT NULL REFERENCES survey_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  field_type TEXT NOT NULL CHECK (field_type IN (
    'text', 'textarea', 'number', 'date', 'datetime',
    'select', 'multi_select', 'checkbox', 'photo', 'signature',
    'location', 'rating'
  )),
  options JSONB,
  required BOOLEAN DEFAULT false,
  is_system BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  voice_input_enabled BOOLEAN DEFAULT true,
  photo_capture_enabled BOOLEAN DEFAULT false,
  voice_keywords TEXT[],
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE survey_fields ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_survey_fields_survey_type_id ON survey_fields(survey_type_id);
CREATE INDEX IF NOT EXISTS idx_survey_fields_sort_order ON survey_fields(survey_type_id, sort_order);

-- RLS Policies (inherit access from survey_types -> account)
CREATE POLICY "Users can view survey fields for their account"
  ON survey_fields FOR SELECT
  TO authenticated
  USING (
    survey_type_id IN (
      SELECT st.id FROM survey_types st
      JOIN account_users au ON au.account_id = st.account_id
      WHERE au.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can insert survey fields"
  ON survey_fields FOR INSERT
  TO authenticated
  WITH CHECK (
    survey_type_id IN (
      SELECT st.id FROM survey_types st
      JOIN account_users au ON au.account_id = st.account_id
      WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Admins can update survey fields"
  ON survey_fields FOR UPDATE
  TO authenticated
  USING (
    survey_type_id IN (
      SELECT st.id FROM survey_types st
      JOIN account_users au ON au.account_id = st.account_id
      WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    survey_type_id IN (
      SELECT st.id FROM survey_types st
      JOIN account_users au ON au.account_id = st.account_id
      WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Admins can delete non-system survey fields"
  ON survey_fields FOR DELETE
  TO authenticated
  USING (
    is_system = false AND
    survey_type_id IN (
      SELECT st.id FROM survey_types st
      JOIN account_users au ON au.account_id = st.account_id
      WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')
    )
  );

-- ============================================
-- 3. facility_survey_data table
-- ============================================
CREATE TABLE IF NOT EXISTS facility_survey_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  survey_type_id UUID NOT NULL REFERENCES survey_types(id),
  field_id UUID NOT NULL REFERENCES survey_fields(id),
  value JSONB,
  photos JSONB,
  completed_by UUID,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(facility_id, survey_type_id, field_id)
);

ALTER TABLE facility_survey_data ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_facility_survey_data_facility_id ON facility_survey_data(facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_survey_data_survey_type_id ON facility_survey_data(survey_type_id);
CREATE INDEX IF NOT EXISTS idx_facility_survey_data_field_id ON facility_survey_data(field_id);
CREATE INDEX IF NOT EXISTS idx_facility_survey_data_composite ON facility_survey_data(facility_id, survey_type_id);

-- RLS Policies
CREATE POLICY "Users can view facility survey data for their account"
  ON facility_survey_data FOR SELECT
  TO authenticated
  USING (
    facility_id IN (
      SELECT f.id FROM facilities f
      JOIN account_users au ON au.account_id = f.account_id
      WHERE au.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert facility survey data"
  ON facility_survey_data FOR INSERT
  TO authenticated
  WITH CHECK (
    facility_id IN (
      SELECT f.id FROM facilities f
      JOIN account_users au ON au.account_id = f.account_id
      WHERE au.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update facility survey data"
  ON facility_survey_data FOR UPDATE
  TO authenticated
  USING (
    facility_id IN (
      SELECT f.id FROM facilities f
      JOIN account_users au ON au.account_id = f.account_id
      WHERE au.user_id = auth.uid()
    )
  )
  WITH CHECK (
    facility_id IN (
      SELECT f.id FROM facilities f
      JOIN account_users au ON au.account_id = f.account_id
      WHERE au.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can delete facility survey data"
  ON facility_survey_data FOR DELETE
  TO authenticated
  USING (
    facility_id IN (
      SELECT f.id FROM facilities f
      JOIN account_users au ON au.account_id = f.account_id
      WHERE au.user_id = auth.uid() AND au.role IN ('owner', 'admin')
    )
  );

-- ============================================
-- 4. Updated_at triggers
-- ============================================
CREATE OR REPLACE FUNCTION update_survey_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER survey_types_updated_at
  BEFORE UPDATE ON survey_types
  FOR EACH ROW EXECUTE FUNCTION update_survey_updated_at();

CREATE TRIGGER survey_fields_updated_at
  BEFORE UPDATE ON survey_fields
  FOR EACH ROW EXECUTE FUNCTION update_survey_updated_at();

CREATE TRIGGER facility_survey_data_updated_at
  BEFORE UPDATE ON facility_survey_data
  FOR EACH ROW EXECUTE FUNCTION update_survey_updated_at();

-- ============================================
-- 5. Seed system survey types for all accounts
-- ============================================
DO $$
DECLARE
  acc RECORD;
  spcc_plan_id UUID;
  spcc_inspection_id UUID;
BEGIN
  FOR acc IN SELECT id FROM accounts LOOP
    -- SPCC Plan
    INSERT INTO survey_types (account_id, name, description, icon, color, is_system, enabled, sort_order)
    VALUES (acc.id, 'SPCC Plan', 'Spill Prevention, Control, and Countermeasure Plan documentation', 'file-text', '#3B82F6', true, true, 0)
    ON CONFLICT DO NOTHING
    RETURNING id INTO spcc_plan_id;

    IF spcc_plan_id IS NOT NULL THEN
      -- SPCC Plan fields
      INSERT INTO survey_fields (survey_type_id, name, description, field_type, required, is_system, sort_order, voice_keywords) VALUES
        (spcc_plan_id, 'Facility Name', 'Name of the facility', 'text', true, true, 1, ARRAY['facility', 'name', 'site']),
        (spcc_plan_id, 'County', 'County where facility is located', 'text', false, true, 2, ARRAY['county', 'location']),
        (spcc_plan_id, 'First Production Date', 'Date of first oil production', 'date', false, true, 3, ARRAY['first', 'production', 'date']),
        (spcc_plan_id, 'SPCC Due Date', 'When SPCC plan is due', 'date', true, true, 4, ARRAY['due', 'date', 'spcc']),
        (spcc_plan_id, 'PE Stamp Date', 'Professional Engineer stamp date', 'date', false, true, 5, ARRAY['stamp', 'engineer', 'PE']),
        (spcc_plan_id, 'Estimated Oil Per Day', 'Estimated barrels of oil per day', 'number', false, true, 6, ARRAY['oil', 'barrels', 'production', 'per day']),
        (spcc_plan_id, 'Berm Depth (inches)', 'Secondary containment berm depth', 'number', false, true, 7, ARRAY['berm', 'depth', 'inches']),
        (spcc_plan_id, 'Berm Length', 'Secondary containment berm length', 'number', false, true, 8, ARRAY['berm', 'length']),
        (spcc_plan_id, 'Berm Width', 'Secondary containment berm width', 'number', false, true, 9, ARRAY['berm', 'width']),
        (spcc_plan_id, 'Company Signature Date', 'Date company signed the plan', 'date', false, true, 10, ARRAY['signature', 'company', 'signed']),
        (spcc_plan_id, 'Initial Inspection Completed', 'Date of initial inspection', 'date', false, true, 11, ARRAY['initial', 'inspection', 'completed']),
        (spcc_plan_id, 'Recertified Date', 'Date plan was recertified', 'date', false, true, 12, ARRAY['recertified', 'recertification']),
        (spcc_plan_id, 'SPCC Plan Document', 'Uploaded SPCC plan PDF', 'text', false, true, 13, ARRAY['plan', 'document', 'pdf', 'upload']),
        (spcc_plan_id, 'Photos Taken', 'Whether site photos have been taken', 'checkbox', false, true, 14, ARRAY['photos', 'pictures', 'taken']),
        (spcc_plan_id, 'Field Visit Date', 'Date of field visit', 'date', false, true, 15, ARRAY['field', 'visit', 'date']),
        (spcc_plan_id, 'Notes', 'Additional notes about the SPCC plan', 'textarea', false, true, 16, ARRAY['notes', 'comments']);
    END IF;

    -- SPCC Inspection
    INSERT INTO survey_types (account_id, name, description, icon, color, is_system, enabled, sort_order)
    VALUES (acc.id, 'SPCC Inspection', 'SPCC compliance inspection checklist', 'clipboard-check', '#10B981', true, true, 1)
    ON CONFLICT DO NOTHING
    RETURNING id INTO spcc_inspection_id;

    IF spcc_inspection_id IS NOT NULL THEN
      -- SPCC Inspection fields (based on inspection template questions)
      INSERT INTO survey_fields (survey_type_id, name, description, field_type, required, is_system, sort_order, voice_keywords, photo_capture_enabled) VALUES
        (spcc_inspection_id, 'Inspector Name', 'Name of the inspector', 'text', true, true, 1, ARRAY['inspector', 'name'], false),
        (spcc_inspection_id, 'Inspection Date', 'Date inspection was conducted', 'date', true, true, 2, ARRAY['date', 'inspection', 'when'], false),
        (spcc_inspection_id, 'Tank/Container Integrity', 'Are tanks and containers in good condition with no visible leaks or corrosion?', 'select', true, true, 3, ARRAY['tank', 'container', 'integrity', 'condition', 'leak', 'corrosion'], true),
        (spcc_inspection_id, 'Secondary Containment', 'Is secondary containment (berms, dikes) intact and adequate?', 'select', true, true, 4, ARRAY['containment', 'berm', 'dike', 'secondary'], true),
        (spcc_inspection_id, 'Piping & Valves', 'Are all piping connections and valves in good condition?', 'select', true, true, 5, ARRAY['piping', 'valves', 'connections', 'pipes'], true),
        (spcc_inspection_id, 'Loading/Unloading Areas', 'Are loading/unloading areas properly maintained?', 'select', true, true, 6, ARRAY['loading', 'unloading', 'area'], true),
        (spcc_inspection_id, 'Drainage Controls', 'Are drainage controls and diversions functioning?', 'select', true, true, 7, ARRAY['drainage', 'controls', 'diversion'], true),
        (spcc_inspection_id, 'Security Measures', 'Are security fencing and locks adequate?', 'select', true, true, 8, ARRAY['security', 'fence', 'lock', 'fencing'], false),
        (spcc_inspection_id, 'Signage', 'Is required signage present and legible?', 'select', true, true, 9, ARRAY['signage', 'signs', 'labels'], false),
        (spcc_inspection_id, 'Spill Response Equipment', 'Is spill response equipment available and in good condition?', 'select', true, true, 10, ARRAY['spill', 'response', 'equipment', 'kit'], true),
        (spcc_inspection_id, 'Overall Condition', 'Overall facility condition rating', 'rating', false, true, 11, ARRAY['overall', 'condition', 'rating'], false),
        (spcc_inspection_id, 'Corrective Actions Needed', 'Description of any corrective actions required', 'textarea', false, true, 12, ARRAY['corrective', 'actions', 'fix', 'repair'], false),
        (spcc_inspection_id, 'Inspector Signature', 'Inspector signature', 'signature', true, true, 13, ARRAY['signature', 'sign'], false),
        (spcc_inspection_id, 'Inspection Photos', 'Photos taken during inspection', 'photo', false, true, 14, ARRAY['photos', 'pictures', 'images'], true);

      -- Set options for select fields
      UPDATE survey_fields
      SET options = '["Pass", "Fail", "N/A"]'::jsonb
      WHERE survey_type_id = spcc_inspection_id
        AND field_type = 'select';
    END IF;
  END LOOP;
END $$;
