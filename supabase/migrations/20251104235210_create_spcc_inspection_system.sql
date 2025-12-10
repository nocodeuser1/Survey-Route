/*
  # Create SPCC Inspection System

  1. New Tables
    - `inspection_templates`
      - `id` (uuid, primary key)
      - `name` (text) - e.g., "SPCC Inspection"
      - `questions` (jsonb) - Array of inspection questions
      - `created_at` (timestamptz)
    
    - `team_signatures`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `team_number` (integer) - 1-4
      - `inspector_name` (text)
      - `signature_data` (text) - Base64 encoded signature image
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `inspections`
      - `id` (uuid, primary key)
      - `facility_id` (uuid, references facilities)
      - `user_id` (uuid, references auth.users)
      - `team_number` (integer)
      - `template_id` (uuid, references inspection_templates)
      - `inspector_name` (text)
      - `conducted_at` (timestamptz)
      - `responses` (jsonb) - Question responses with answers, comments, actions
      - `signature_data` (text) - Base64 signature applied to this inspection
      - `status` (text) - 'draft', 'completed'
      - `flagged_items_count` (integer)
      - `actions_count` (integer)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Users can only access their own data
*/

-- Create inspection_templates table
CREATE TABLE IF NOT EXISTS inspection_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE inspection_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read templates"
  ON inspection_templates FOR SELECT
  TO public
  USING (true);

-- Create team_signatures table
CREATE TABLE IF NOT EXISTS team_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  team_number integer NOT NULL CHECK (team_number >= 1 AND team_number <= 4),
  inspector_name text NOT NULL,
  signature_data text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, team_number)
);

ALTER TABLE team_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own team signatures"
  ON team_signatures FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Allow demo user access
CREATE POLICY "Demo user can manage team signatures"
  ON team_signatures FOR ALL
  TO public
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- Create inspections table
CREATE TABLE IF NOT EXISTS inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  team_number integer DEFAULT 1 CHECK (team_number >= 1 AND team_number <= 4),
  template_id uuid REFERENCES inspection_templates(id),
  inspector_name text NOT NULL,
  conducted_at timestamptz DEFAULT now(),
  responses jsonb NOT NULL DEFAULT '[]'::jsonb,
  signature_data text,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  flagged_items_count integer DEFAULT 0,
  actions_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own inspections"
  ON inspections FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Allow demo user access
CREATE POLICY "Demo user can manage inspections"
  ON inspections FOR ALL
  TO public
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- Insert default SPCC inspection template
INSERT INTO inspection_templates (name, questions) VALUES (
  'SPCC Inspection',
  '[
    {
      "id": "q1",
      "text": "Are drains, dumps, drip pans, compressor rails and secondary containment free of accumulation of oil and water?",
      "category": "Audit"
    },
    {
      "id": "q2",
      "text": "Are valves free of signs of corrosion, leaks, or improper operation?",
      "category": "Audit"
    },
    {
      "id": "q3",
      "text": "Are tanks properly vented?",
      "category": "Audit"
    },
    {
      "id": "q4",
      "text": "Is equipment free of visible signs of corrosion, damaged paint, or leaks?",
      "category": "Audit"
    },
    {
      "id": "q5",
      "text": "Are piping, flanges, and joints free of visible signs of corrosion, damaged paint, or leaks?",
      "category": "Audit"
    },
    {
      "id": "q6",
      "text": "Is secondary containment free of visible signs of cracks, low spots, holes, animal burrows or erosion?",
      "category": "Audit"
    },
    {
      "id": "q7",
      "text": "If the flow through process vessel does NOT have sized secondary containment, is the vessel or its components free of visible signs of corrosion, leaks, or defects?",
      "category": "Audit"
    },
    {
      "id": "q8",
      "text": "Does all applicable oil filled containers have properly sized secondary containment?",
      "category": "Audit"
    },
    {
      "id": "q9",
      "text": "Are all on-site storage containers and equipment properly labeled?",
      "category": "Audit"
    }
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- Create index for faster facility lookups
CREATE INDEX IF NOT EXISTS idx_inspections_facility_id ON inspections(facility_id);
CREATE INDEX IF NOT EXISTS idx_inspections_user_id ON inspections(user_id);
CREATE INDEX IF NOT EXISTS idx_inspections_status ON inspections(status);
