-- Invoice tracking for SPCC plans and SPCC inspections.
--
-- Plans and inspections are billed separately, so we track them as two
-- independent state machines per facility:
--
--   plan_invoice_status:        not_invoiced → invoiced → paid
--   inspection_invoice_status:  not_invoiced → invoiced → paid
--
-- The boolean + timestamp pair lets the UI render "Invoiced 2026-06-01" /
-- "Paid 2026-06-15" without an extra join. The (paid implies invoiced)
-- check stops the row from getting into a paid-but-not-invoiced state via
-- direct DB writes; UI guards the same on the way in.

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS plan_invoiced            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS plan_invoiced_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_paid                BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS plan_paid_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inspection_invoiced      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS inspection_invoiced_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inspection_paid          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS inspection_paid_at       TIMESTAMPTZ;

-- Invariant: paid can only be true if invoiced is also true.
ALTER TABLE facilities
  DROP CONSTRAINT IF EXISTS facilities_plan_paid_requires_invoiced;
ALTER TABLE facilities
  ADD  CONSTRAINT facilities_plan_paid_requires_invoiced
       CHECK (plan_paid = FALSE OR plan_invoiced = TRUE);

ALTER TABLE facilities
  DROP CONSTRAINT IF EXISTS facilities_inspection_paid_requires_invoiced;
ALTER TABLE facilities
  ADD  CONSTRAINT facilities_inspection_paid_requires_invoiced
       CHECK (inspection_paid = FALSE OR inspection_invoiced = TRUE);

-- Index the booleans so the "Awaiting Invoice" chip's count + filter
-- (typical pattern: WHERE plan_invoiced = false) stays fast even at scale.
CREATE INDEX IF NOT EXISTS idx_facilities_plan_invoiced
  ON facilities (account_id, plan_invoiced)
  WHERE plan_invoiced = FALSE;

CREATE INDEX IF NOT EXISTS idx_facilities_inspection_invoiced
  ON facilities (account_id, inspection_invoiced)
  WHERE inspection_invoiced = FALSE;
