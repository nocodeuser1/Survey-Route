/*
  # Create Storage Bucket for SPCC Plans

  1. New Storage Bucket
    - `spcc-plans`: Public bucket for SPCC plan PDFs attached to facilities

  2. Security
    - Public read access (matches the getPublicUrl flow used in the app)
    - Write/delete access only for authenticated users
    - Files organized by facility_id/ folder

  3. Notes
    - 2MB file size limit enforced in application code
    - Referenced by:
        src/components/SPCCPlanUploadModal.tsx
        src/components/SPCCPlanDetailModal.tsx (InlineSPCCPlanUpload)
        src/components/BulkSPCCUploadModal.tsx
*/

-- Create the storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('spcc-plans', 'spcc-plans', true)
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies if they exist (idempotent re-runs)
DROP POLICY IF EXISTS "Public read access for spcc plans" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload spcc plans" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update spcc plans" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete spcc plans" ON storage.objects;

-- Allow public read access to all files
CREATE POLICY "Public read access for spcc plans"
ON storage.objects FOR SELECT
USING (bucket_id = 'spcc-plans');

-- Allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload spcc plans"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'spcc-plans');

-- Allow authenticated users to update files (for new plan versions)
CREATE POLICY "Authenticated users can update spcc plans"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'spcc-plans');

-- Allow authenticated users to delete files
CREATE POLICY "Authenticated users can delete spcc plans"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'spcc-plans');
