# Multi-berm bulk-upload workflow — plan

> Author: Claude · 2026-04-23
> Status: Phase 1 shipped (defaults to Berm 1); Phase 2 pending.
> Related: `SPCC_DATA_MODEL.md`, `supabase/migrations/20260423000000_create_spcc_plans_table.sql`

## Background

Survey-Route's `BulkSPCCUploadModal` lets a user drop 1..50 SPCC plan PDFs
and auto-matches each one to a facility via OCR text extraction + fuzzy
facility-name matching. Pre-multi-berm, every facility had exactly one plan
slot, so each matched PDF had a single, unambiguous destination:
`facilities.spcc_plan_url`.

After the multi-berm migration, one facility can have up to 6 berms, each
with its own plan row, PDF, PE stamp date, workflow status, and well
coverage. This raises a new question at upload time: **which berm does this
PDF belong to?**

## Phase 1 (shipped, 2026-04-23)

**Always target Berm 1.** Every bulk-uploaded PDF is written to the
facility's `berm_index = 1` row — the default berm that the migration's
backfill step creates for every facility.

- **Why it's safe for single-berm facilities**: they only have Berm 1, so
  there's no ambiguity.
- **Why it's tolerable for multi-berm facilities**: multi-berm is a minority
  case and the user can reassign the PDF afterwards via the plan-detail
  modal's "Replace" button on the correct berm card (or re-run the matcher
  on a smaller subset).
- **Consistency with the data model**: writes go to `spcc_plans`, not
  `facilities`. The mirror trigger then propagates the plan URL + PE date
  back to the legacy `facilities.spcc_*` columns so legacy readers keep
  working.

A safety net: if the backfill somehow missed a facility (shouldn't happen,
but defensive), the bulk upload code creates the berm-1 row on the fly.

## Phase 2 — in-flight berm picker + post-upload review

Phase 1 is correct for ~90% of users but leaves two gaps:

1. **No per-upload berm picker.** A user who knows PDF #3 belongs to Berm 2
   has to remember to move it manually afterwards.
2. **No post-upload audit trail.** After a bulk upload of 30 PDFs, the user
   has no easy way to see *which facilities were touched* so they can review
   berm assignments.

The phase-2 plan below addresses both, designed to match the existing
Survey-Route patterns (inline review tables, non-blocking yellow-highlight
warnings, optimistic updates).

### 2A. Berm picker in the review phase

Today the review table has columns:
`[Status] [PDF file] [Matched facility] [PE stamp date] [Override]`

Add a `[Berm]` column that only renders when the matched facility has ≥ 2
berms:

```
| ✓ | plan_pad17.pdf | Pad 17 (3 berms) | 07/12/2025 | [Berm 1 ▾]|
| ✓ | plan_pad4.pdf  | Pad 4            | 01/05/2025 |   —       |
| ✓ | plan_pad9N.pdf | Pad 9  (2 berms) | 03/30/2025 | [Berm 2 ▾]|
```

- Default: Berm 1.
- Selection: native `<select>` with `Berm 1`, `Berm 2`, …, up to that
  facility's berm count, showing the optional `berm_label` when set
  (`Berm 1 — North`). No free-text — berms are picked, not created.
- Persists per row in `matchResults` (extend `PdfMatchResult` with
  `overrideBermIndex?: number`, default `1`).
- Facilities with 1 berm show `—` (no dropdown).
- Requirement for the "Apply" button: every ready row must have a selected
  facility + PE date AND a chosen berm (defaults to 1 so usually already
  valid).

**Data flow on Apply**: same write pattern as phase 1, but target
`spcc_plans` row by `(facility_id, berm_index = chosen)` instead of always
`berm_index = 1`. Keep the "create-on-the-fly" safety net for the picked
berm too (shouldn't trigger unless the user picked a berm that was deleted
between review and apply — rare, but the write should fail gracefully).

### 2B. Post-upload review "receipt" screen

The current "done" phase shows a count ("Uploaded 30 plans, 2 errors"). In
phase 2, upgrade this to a scrollable table of every facility that was
touched:

```
✅ 30 plans uploaded · 2 errors · [Download log] [Review assignments]

| Facility | Berm | PE stamp date | PDF             |
|----------|------|---------------|-----------------|
| Pad 17   | 1    | 07/12/2025    | plan_pad17.pdf  |
| Pad 4    | 1    | 01/05/2025    | plan_pad4.pdf   |
...
```

Each row is a link that opens the facility's plan-detail modal (same
`SPCCPlanDetailModal` used elsewhere), so the user can immediately review
well assignments for multi-berm facilities. For facilities with ≥ 2 berms,
show a subtle "Review berm assignments" chip that opens the modal
pre-scrolled to the just-uploaded berm's card.

The "Review assignments" button at the top is a shortcut that filters the
list down to only multi-berm facilities (typically a handful out of a large
batch), which is where reassignment might be needed.

### 2C. Audit column in FacilitiesManager

Optional follow-on: add a "Last bulk upload" column to the facility list
that stores `spcc_plans.updated_at` for the most recent bulk-upload write.
Lets the user sort/filter "facilities I've recently bulk-updated" to sanity
check their work over time.

## Open questions (defer to v3 if ever)

- **Auto-inferring berm from PDF text**: the OCR pipeline already extracts
  text — could we key off phrases like "berm 2" or "north berm" to
  pre-populate the picker? Possible, but high false-positive risk if plans
  don't follow a naming convention. Skip unless user demand is clear.
- **Bulk upload that *creates* berms**: if a user has a 2-berm facility but
  only the berm-1 row exists, should dropping a PDF marked "berm 2" create
  berm 2 on the fly? No — berm creation should always go through the
  explicit `BermWellAssignmentModal` flow so well assignments are
  intentional. The bulk upload is for filling in existing berms only.
- **Per-berm PE date overrides when a single PDF covers multiple berms**:
  out of scope. The user uploads one PDF per berm if they have separate
  plans.

## Phase 3 — bulk actions history tab (deferred, design only)

User requested: "afterwards I've done a bulk upload I can click on like a
bulk actions tab and see the progress for one of the bulk upload like if any
errors occurred and which errors occurred on which files and a workflow to
connect the matched wells for each facility one by one."

Phase 2's post-upload receipt screen already covers the within-session view.
A persistent **Bulk Actions** tab covers the across-session need: open the
app the next morning, click the tab, see "yesterday I uploaded 30 plans, 2
errored, here are the matched-wells workflows still pending."

### Schema sketch

```sql
-- Header row per bulk run.
CREATE TABLE bulk_upload_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),
  kind            text NOT NULL CHECK (kind IN ('spcc_pdf')),
  status          text NOT NULL CHECK (status IN ('in_progress','done','aborted')),
  files_attempted int  NOT NULL DEFAULT 0,
  files_succeeded int  NOT NULL DEFAULT 0,
  files_errored   int  NOT NULL DEFAULT 0,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

-- One row per file the user attempted to upload in a run.
CREATE TABLE bulk_upload_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES bulk_upload_runs(id) ON DELETE CASCADE,
  pdf_filename  text NOT NULL,
  facility_id   uuid REFERENCES facilities(id) ON DELETE SET NULL,
  berm_index    int,
  match_source  text,  -- 'camino_id_filename' | 'filename_text' | 'pdf_text' | manual
  status        text NOT NULL CHECK (status IN ('uploaded','error','skipped')),
  error_message text,
  -- For the well-assignment workflow:
  wells_review_state text NOT NULL DEFAULT 'pending'
    CHECK (wells_review_state IN ('pending','reviewed','skipped')),
  reviewed_at   timestamptz
);

CREATE INDEX bulk_upload_items_run ON bulk_upload_items(run_id);
CREATE INDEX bulk_upload_items_pending_wells
  ON bulk_upload_items(facility_id) WHERE wells_review_state = 'pending';
```

RLS mirrors `account_users` pattern.

### UI sketch

Add a **Bulk Actions** entry to the FacilitiesManager top-bar menu (next to
the Bulk SPCC Upload entry). Opens a modal with a list of recent runs:

```
2026-04-25 14:32 · 30 PDFs · ✅ 28 uploaded · ⚠ 2 errors · 4 facilities awaiting wells review

  [Continue review]   [View errors]   [Re-run 2 errored]
```

Click into a run → list of items grouped by status. The "wells review"
column shows the workflow: clicking a `pending` item opens the
`SPCCPlanDetailModal` for that facility; closing the modal marks the item
`reviewed` (or "skip for now" leaves it `pending` with a flag). The
workflow loops: when item N is closed, the next pending item auto-opens
unless the user dismissed the loop.

### Wiring

- The current `handleApply` in `BulkSPCCUploadModal` would create a
  `bulk_upload_runs` row at the start, an `items` row per file as it
  succeeds/errors, and update the run's counts at the end.
- The phase-2 receipt screen becomes a thin shell over the run detail —
  same data, just rendered in two contexts (just-finished vs. historical).
- Errored items become re-runnable: a "Retry" button on the row re-opens
  the file picker with that one file pre-loaded.

### Why deferred

This needs a new schema + new UI surface and a polished workflow loop. It's
high value for users running weekly batches but not blocking for the
initial Camino import. Worth one focused branch on its own.

## Open checklist

- [x] Phase 1: bulk upload writes to `spcc_plans` (berm 1) — shipped.
- [x] Phase 2A: filename-based matching with Camino ID + filename text — shipped.
- [ ] Phase 2A: berm picker in review table for multi-berm facilities.
- [ ] Phase 2A: extend `PdfMatchResult` with `overrideBermIndex`.
- [ ] Phase 2A: update `handleApply` to honor the override.
- [x] Phase 2B: post-upload receipt screen with per-facility rows — shipped.
- [x] Phase 2B: "Review berms" deep-link from receipt to plan-detail modal — shipped.
- [ ] Phase 3: persistent `bulk_upload_runs` schema + Bulk Actions tab.
- [ ] Phase 3: workflow loop (auto-advance through pending wells reviews).
- [ ] Phase 3: errored-item retry.
