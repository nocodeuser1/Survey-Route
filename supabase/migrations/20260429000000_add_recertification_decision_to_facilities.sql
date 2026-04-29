/*
  # Add SPCC Recertification Decision fields to facilities

  Recertification reviews happen in the 90-day window before the 5-year
  PE-stamp anniversary. During that window the operator must record one of
  two outcomes:
    - 'no_changes'    : the existing plan is still accurate, no updates needed
    - 'changes_found' : something at the facility has changed; the plan must
                        be revised. A free-text notes column captures what.

  These columns are *informational only*. They do NOT auto-bump
  `recertified_date` — that field stays a separate manual action so an
  operator who finds changes can still pick "Changes Found" without
  pretending the recertification is complete.

  ## Columns

  - `recertification_decision`        text, CHECK (no_changes | changes_found | NULL)
  - `recertification_decision_notes`  text, free-form (only meaningful when 'changes_found')
  - `recertification_decision_at`     timestamptz, when the decision was recorded

  ## RLS / triggers

  No new policies — these columns ride on the existing `facilities` row-level
  security. No triggers, no recalculation: the UI gates visibility on
  `getSPCCPlanStatus()` returning 'expiring' / 'expired' / 'recertified'.
*/

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS recertification_decision text
    CHECK (recertification_decision IN ('no_changes', 'changes_found')),
  ADD COLUMN IF NOT EXISTS recertification_decision_notes text,
  ADD COLUMN IF NOT EXISTS recertification_decision_at timestamptz;

COMMENT ON COLUMN facilities.recertification_decision IS
  'Operator''s self-certification at SPCC plan recertification time: no_changes or changes_found. Informational only — does not bump recertified_date.';
COMMENT ON COLUMN facilities.recertification_decision_notes IS
  'Free-text notes describing what changed. Only meaningful when recertification_decision = changes_found.';
COMMENT ON COLUMN facilities.recertification_decision_at IS
  'When the recertification_decision was last set. Used to detect stale decisions across cycles.';
