/*
  # Scope inspection-photos storage access to the inspection's account

  The policies from 20251118193745_add_inspection_photos_support.sql let any
  authenticated user read, upload, or delete ANY object in the private
  'inspection-photos' bucket (they only checked bucket_id).

  Every object is stored as `${inspectionId}/${questionId}/<file>`, so the
  first path segment is the inspection id. These replacement policies require
  that segment to be a real inspection whose account the user can access
  (public.user_has_account_access, the same check inspection_photos rows use).

  A first segment that is not a uuid simply fails the check: the CASE only
  casts after the format test passes, so a bad path never raises an error.

  Not applied automatically: paste into the Supabase SQL editor and run.
*/

DROP POLICY IF EXISTS "Users can view their inspection photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload inspection photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their inspection photos" ON storage.objects;

CREATE POLICY "Users can view their inspection photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'inspection-photos'
    AND EXISTS (
      SELECT 1
      FROM public.inspections i
      WHERE i.id = CASE
          WHEN (storage.foldername(objects.name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN ((storage.foldername(objects.name))[1])::uuid
        END
        AND public.user_has_account_access(i.account_id)
    )
  );

CREATE POLICY "Users can upload inspection photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'inspection-photos'
    AND EXISTS (
      SELECT 1
      FROM public.inspections i
      WHERE i.id = CASE
          WHEN (storage.foldername(objects.name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN ((storage.foldername(objects.name))[1])::uuid
        END
        AND public.user_has_account_access(i.account_id)
    )
  );

CREATE POLICY "Users can delete their inspection photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'inspection-photos'
    AND EXISTS (
      SELECT 1
      FROM public.inspections i
      WHERE i.id = CASE
          WHEN (storage.foldername(objects.name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN ((storage.foldername(objects.name))[1])::uuid
        END
        AND public.user_has_account_access(i.account_id)
    )
  );
