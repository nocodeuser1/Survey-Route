/*
  # Add Advanced Route Optimization Parameters

  1. Changes
    - Add clustering_tightness column to user_settings table
      - Controls how tightly facilities should be grouped geographically
      - Range: 0.0 to 1.0, where higher values create tighter geographic clusters
      - Default: 0.5 (balanced approach)

    - Add cluster_balance_weight column to user_settings table
      - Controls importance of balanced cluster sizes vs tight geographic grouping
      - Range: 0.0 to 1.0, where higher values prioritize balanced cluster sizes
      - Default: 0.5 (balanced approach)

  2. Notes
    - Both parameters are optional with sensible defaults
    - Existing records are not affected (NULL values use defaults in application)
    - Parameters can be adjusted in Route Settings Advanced Options
*/

-- Add clustering_tightness parameter
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'clustering_tightness'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN clustering_tightness numeric DEFAULT 0.5;
  END IF;
END $$;

-- Add cluster_balance_weight parameter
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'cluster_balance_weight'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN cluster_balance_weight numeric DEFAULT 0.5;
  END IF;
END $$;

-- Add check constraints to ensure values are between 0 and 1
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clustering_tightness_range'
  ) THEN
    ALTER TABLE user_settings ADD CONSTRAINT clustering_tightness_range
      CHECK (clustering_tightness IS NULL OR (clustering_tightness >= 0 AND clustering_tightness <= 1));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cluster_balance_weight_range'
  ) THEN
    ALTER TABLE user_settings ADD CONSTRAINT cluster_balance_weight_range
      CHECK (cluster_balance_weight IS NULL OR (cluster_balance_weight >= 0 AND cluster_balance_weight <= 1));
  END IF;
END $$;
