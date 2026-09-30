/*
  # Free-form tags on facilities

  Adds a multi-value `tags` column so facilities can be labelled in bulk from
  the facilities table ("Tag" in the selection bar) and then sorted by the new
  Tags column.

  - text[] rather than a join table: tags here are lightweight labels with no
    attributes of their own, and every read already pulls the facility row, so
    a join table would add a query for no gain.
  - GIN index so `tags @> ARRAY['x']` / `'x' = ANY(tags)` stay fast once
    filtering by tag gets added.

  No RLS change: tagging is a normal UPDATE on facilities, already covered by
  the existing facilities policies.

  Idempotent.
*/

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS tags text[];

CREATE INDEX IF NOT EXISTS idx_facilities_tags
  ON facilities USING GIN (tags);

COMMENT ON COLUMN facilities.tags IS
  'Free-form labels applied in bulk from the facilities table. Case is preserved as typed; the app de-dupes case-insensitively.';
