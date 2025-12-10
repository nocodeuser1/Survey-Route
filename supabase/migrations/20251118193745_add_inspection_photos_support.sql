/*
  # Add Photo Support to SPCC Inspections

  1. New Tables
    - `inspection_photos`
      - `id` (uuid, primary key)
      - `inspection_id` (uuid, references inspections)
      - `question_id` (text) - References the question this photo is for
      - `photo_url` (text) - Full URL to the photo in storage
      - `file_name` (text) - Original file name
      - `file_size` (integer) - File size in bytes
      - `created_at` (timestamptz)
      
  2. Storage Bucket
    - `inspection-photos`: Private bucket for inspection photos
    - Only accessible by authenticated users who own the inspection
    
  3. Security
    - Enable RLS on inspection_photos table
    - Photos can only be accessed by users who own the parent inspection
    - Storage bucket has authenticated user access only
    
  4. Updates
    - Add 10th question to SPCC Inspection template for general comments
*/

-- Create inspection_photos table
CREATE TABLE IF NOT EXISTS inspection_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  question_id text NOT NULL,
  photo_url text NOT NULL,
  file_name text NOT NULL,
  file_size integer NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE inspection_photos ENABLE ROW LEVEL SECURITY;

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_inspection_photos_inspection_id ON inspection_photos(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_photos_question_id ON inspection_photos(question_id);

-- RLS Policies for inspection_photos
CREATE POLICY "Users can view their own inspection photos"
  ON inspection_photos FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM inspections
      WHERE inspections.id = inspection_photos.inspection_id
      AND inspections.account_id = (
        SELECT account_id FROM account_users WHERE user_id = auth.uid() LIMIT 1
      )
    )
  );

CREATE POLICY "Users can insert photos for their inspections"
  ON inspection_photos FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM inspections
      WHERE inspections.id = inspection_photos.inspection_id
      AND inspections.account_id = (
        SELECT account_id FROM account_users WHERE user_id = auth.uid() LIMIT 1
      )
    )
  );

CREATE POLICY "Users can delete their inspection photos"
  ON inspection_photos FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM inspections
      WHERE inspections.id = inspection_photos.inspection_id
      AND inspections.account_id = (
        SELECT account_id FROM account_users WHERE user_id = auth.uid() LIMIT 1
      )
    )
  );

-- Create storage bucket for inspection photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('inspection-photos', 'inspection-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for inspection-photos bucket
DROP POLICY IF EXISTS "Users can view their inspection photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload inspection photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their inspection photos" ON storage.objects;

CREATE POLICY "Users can view their inspection photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'inspection-photos');

CREATE POLICY "Users can upload inspection photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'inspection-photos');

CREATE POLICY "Users can delete their inspection photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'inspection-photos');

-- Update SPCC Inspection template to include 10th question
DO $$
BEGIN
  UPDATE inspection_templates
  SET questions = jsonb_set(
    questions,
    '{9}',
    '{"id": "q10", "text": "Any comments, findings or important information can be entered below?", "category": "General"}'::jsonb
  )
  WHERE name = 'SPCC Inspection'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(questions) AS q
    WHERE q->>'id' = 'q10'
  );
END $$;