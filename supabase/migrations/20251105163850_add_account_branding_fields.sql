/*
  # Add Account Branding Fields

  1. Changes
    - Add `company_name` column to accounts table for inspection branding
    - Add `logo_url` column to accounts table for storing company logo
    
  2. Details
    - `company_name` (text): Used in inspection reports (e.g., "Camino SPCC Inspection")
    - `logo_url` (text): URL to company logo stored in Supabase Storage
    
  3. Notes
    - Both fields are optional (nullable)
    - Existing accounts will have NULL values initially
    - Logo will be stored in Supabase Storage and URL saved here
*/

-- Add company_name column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'accounts' AND column_name = 'company_name'
  ) THEN
    ALTER TABLE accounts ADD COLUMN company_name text;
  END IF;
END $$;

-- Add logo_url column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'accounts' AND column_name = 'logo_url'
  ) THEN
    ALTER TABLE accounts ADD COLUMN logo_url text;
  END IF;
END $$;