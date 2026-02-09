-- Add timezone column to accounts table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'accounts' AND column_name = 'timezone'
  ) THEN
    ALTER TABLE accounts ADD COLUMN timezone text;
  END IF;
END $$;
