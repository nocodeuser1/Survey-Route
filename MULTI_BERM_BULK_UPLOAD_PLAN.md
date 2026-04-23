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

## Open checklist

- [x] Phase 1: bulk upload writes to `spcc_plans` (berm 1) — shipped.
- [ ] Phase 2A: berm picker in review table.
- [ ] Phase 2A: extend `PdfMatchResult` with `overrideBermIndex`.
- [ ] Phase 2A: update `handleApply` to honor the override.
- [ ] Phase 2B: post-upload receipt screen with per-facility rows.
- [ ] Phase 2B: "Review assignments" shortcut filters to multi-berm rows.
- [ ] Phase 2C: FacilitiesManager "Last bulk upload" column (optional).
