/*
  # Create Storage Bucket for Account Assets

  1. New Storage Bucket
    - `account-assets`: Public bucket for company logos and other account assets
    
  2. Security
    - Public read access for all files
    - Write access only for authenticated users
    - Public URLs for easy access in inspection reports
    
  3. Notes
    - Files organized by account_id in logos/ folder
    - 2MB file size limit enforced in application code
*/

-- Create the storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('account-assets', 'account-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Public read access for account assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload account assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete their account assets" ON storage.objects;

-- Allow public read access to all files
CREATE POLICY "Public read access for account assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'account-assets');

-- Allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload account assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'account-assets');

-- Allow authenticated users to delete files
CREATE POLICY "Authenticated users can delete their account assets"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'account-assets');