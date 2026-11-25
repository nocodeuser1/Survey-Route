import type { Inspection, InspectionResponse } from '../lib/supabase';

/**
 * Findings from a completed inspection, as shown in the Facilities table's
 * "Last Inspection Findings" column and its modal.
 *
 * A finding is any item answered "No" (the same rule InspectionForm uses for
 * flagged_items_count) or marked "Action required". Action-required items are
 * the only ones the UI emphasizes; plain flags are a neutral count.
 */
export function getInspectionFindings(inspection: Inspection | null | undefined): InspectionResponse[] {
  if (!inspection || !Array.isArray(inspection.responses)) return [];
  return inspection.responses.filter((r) => r && (r.answer === 'no' || r.action_required));
}

export interface InspectionFindingsSummary {
  total: number;
  actionRequired: number;
  done: number;
  open: number;
}

export function summarizeInspectionFindings(
  inspection: Inspection | null | undefined,
  doneQuestionIds: ReadonlySet<string> | undefined,
): InspectionFindingsSummary {
  const findings = getInspectionFindings(inspection);
  const done = findings.filter((r) => doneQuestionIds?.has(r.question_id)).length;
  return {
    total: findings.length,
    actionRequired: findings.filter((r) => r.action_required).length,
    done,
    open: findings.length - done,
  };
}
