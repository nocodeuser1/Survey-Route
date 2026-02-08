-- Add new detail fields to facilities table
ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS photos_taken boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS field_visit_date date,
  ADD COLUMN IF NOT EXISTS estimated_oil_per_day numeric,
  ADD COLUMN IF NOT EXISTS berm_depth_inches numeric,
  ADD COLUMN IF NOT EXISTS berm_length numeric,
  ADD COLUMN IF NOT EXISTS berm_width numeric,
  ADD COLUMN IF NOT EXISTS initial_inspection_completed date,
  ADD COLUMN IF NOT EXISTS company_signature_date date,
  ADD COLUMN IF NOT EXISTS recertified_date date,
  ADD COLUMN IF NOT EXISTS county text;
