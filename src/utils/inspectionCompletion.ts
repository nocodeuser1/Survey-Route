import type { Inspection } from '../lib/supabase';

export interface InspectionCompletionFacility {
  spcc_completion_type?: string | null;
  spcc_inspection_date?: string | null;
}

/** Newest completed record only. A newer draft must not mask valid evidence. */
export function getNewestCompletedInspection(inspections: Inspection[]): Inspection | undefined {
  return inspections
    .filter(inspection => inspection.status === 'completed')
    .sort((a, b) => new Date(b.conducted_at).getTime() - new Date(a.conducted_at).getTime())[0];
}

const isDateBeyondWarningWindow = (value: string, now: Date, warningDays: number) => {
  const completed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  if (Number.isNaN(completed.getTime())) return false;
  const expiry = new Date(completed);
  expiry.setFullYear(expiry.getFullYear() + 1);
  const normalizedNow = new Date(now);
  normalizedNow.setHours(0, 0, 0, 0);
  const daysUntilExpiry = Math.ceil((expiry.getTime() - normalizedNow.getTime()) / 86_400_000);
  return daysUntilExpiry > warningDays;
};

const evidenceTime = (value: string) => {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? Number.NEGATIVE_INFINITY : parsed.getTime();
};

/** Canonical completed-check predicate; expiring evidence is not route-complete. */
export function isFacilityInspectionCurrentAt(
  facility: InspectionCompletionFacility,
  inspections: Inspection[] = [],
  now = new Date(),
  warningDays = 60,
): boolean {
  const evidence: string[] = inspections
    .filter(inspection => inspection.status === 'completed')
    .map(inspection => inspection.conducted_at);
  if (facility.spcc_completion_type && facility.spcc_inspection_date) {
    evidence.push(facility.spcc_inspection_date);
  }
  const newestEvidence = evidence.sort((a, b) => evidenceTime(b) - evidenceTime(a))[0];
  return Boolean(newestEvidence && isDateBeyondWarningWindow(newestEvidence, now, warningDays));
}
