import type { Inspection } from '../lib/supabase';
import { parseLocalDate } from './dateUtils';
import { isFacilityInspectionCurrentAt } from './inspectionCompletion';
export { getNewestCompletedInspection } from './inspectionCompletion';

export function isInspectionValid(inspection: Inspection | undefined): boolean {
  if (!inspection || inspection.status !== 'completed') {
    return false;
  }

  const inspectionDate = new Date(inspection.conducted_at);
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  return inspectionDate >= oneYearAgo;
}

export function getInspectionStatus(inspection: Inspection | undefined): {
  isValid: boolean;
  daysUntilExpiry: number | null;
  inspectionDate: Date | null;
} {
  if (!inspection || inspection.status !== 'completed') {
    return { isValid: false, daysUntilExpiry: null, inspectionDate: null };
  }

  const inspectionDate = new Date(inspection.conducted_at);
  const oneYearFromInspection = new Date(inspectionDate);
  oneYearFromInspection.setFullYear(oneYearFromInspection.getFullYear() + 1);

  const now = new Date();
  const daysUntilExpiry = Math.ceil((oneYearFromInspection.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const isValid = daysUntilExpiry > 0;

  return { isValid, daysUntilExpiry, inspectionDate };
}

export type InspectionExpiryStatus =
  | 'valid'             // Inspected, > INSPECTION_EXPIRING_DAYS until 1-yr expiry
  | 'expiring'          // Inspected, ≤ INSPECTION_EXPIRING_DAYS until 1-yr expiry
  | 'expired'           // Inspected, past 1-yr expiry
  | 'initial_upcoming'  // Never inspected, IP date set, > INSPECTION_EXPIRING_DAYS until 1-yr-from-IP
  | 'initial_due'       // Never inspected, IP date set, ≤ INSPECTION_EXPIRING_DAYS until 1-yr-from-IP
  | 'initial_overdue'   // Never inspected, IP date set, past 1-yr-from-IP
  | 'no_ip_date';       // Never inspected, no IP date — can't compute a deadline

/**
 * Days-out at which an inspection switches from "valid" → "expiring" in the
 * UI. SPCC inspections are annual (40 CFR §112.7(c)) so we have one year of
 * runway between inspections; this constant defines how early the expiring
 * warning lights up.
 */
export const INSPECTION_EXPIRING_DAYS = 60;

/**
 * Days-out at which the inspection-status pill starts showing a "X days left"
 * countdown. Above this threshold the badge stays a plain "Inspected" pill —
 * the count would just be visual noise that far out.
 */
export const INSPECTION_COUNTDOWN_DAYS = 90;

/**
 * Comprehensive inspection expiry check for a facility.
 * Considers (in order):
 *   1/2. The newer of the completion-type date (internal/external) and the
 *      latest inspection record → annual cycle from that date.
 *   3. First production date with no inspection yet → "initial inspection"
 *      lifecycle (upcoming/due/overdue) using the same 1-year clock.
 *   4. Nothing → no_ip_date.
 *
 * The "initial" branch mirrors plan mode's no_plan/initial_due/initial_overdue
 * lifecycle so brand-new facilities aren't lumped in with truly-unknown ones.
 * 40 CFR is performance-based (no federal calendar interval — the PE plan
 * defines cadence), but production-facility plans almost universally use
 * annual visual integrity inspections, so we hardcode 365d for v1.
 */
export function getFacilityInspectionExpiry(
  facility: {
    spcc_completion_type?: string | null;
    spcc_inspection_date?: string | null;
    first_prod_date?: string | null;
  },
  latestInspection?: Inspection
): {
  status: InspectionExpiryStatus;
  daysUntilExpiry: number | null;
  expiryDate: Date | null;
} {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Whichever evidence is newest wins: a fresh signed inspection supersedes
  // an older internal/external manual completion, and vice versa.
  const evidenceDate = getCurrentCompletionSource(facility, latestInspection) === 'inspection'
    ? new Date(latestInspection!.conducted_at)
    : facility.spcc_completion_type && facility.spcc_inspection_date
      ? parseLocalDate(facility.spcc_inspection_date)
      : null;

  if (evidenceDate) {
    const expiryDate = new Date(evidenceDate);
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    const daysUntilExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry <= 0) return { status: 'expired', daysUntilExpiry, expiryDate };
    if (daysUntilExpiry <= INSPECTION_EXPIRING_DAYS) return { status: 'expiring', daysUntilExpiry, expiryDate };
    return { status: 'valid', daysUntilExpiry, expiryDate };
  }

  // No inspection on record. If we know first production, run the "initial
  // inspection" lifecycle off that date; otherwise we genuinely don't have
  // enough info to say anything.
  if (facility.first_prod_date) {
    const ipDate = parseLocalDate(facility.first_prod_date);
    const expiryDate = new Date(ipDate);
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    const daysUntilExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry <= 0) return { status: 'initial_overdue', daysUntilExpiry, expiryDate };
    if (daysUntilExpiry <= INSPECTION_EXPIRING_DAYS) return { status: 'initial_due', daysUntilExpiry, expiryDate };
    return { status: 'initial_upcoming', daysUntilExpiry, expiryDate };
  }

  return { status: 'no_ip_date', daysUntilExpiry: null, expiryDate: null };
}

/**
 * Which evidence currently governs the facility's SPCC inspection status:
 * the manual completion mark (spcc_completion_type + spcc_inspection_date) or
 * the newest completed inspection record. The newer date wins; ties go to the
 * inspection record since it carries the actual report.
 */
export function getCurrentCompletionSource(
  facility: {
    spcc_completion_type?: string | null;
    spcc_inspection_date?: string | null;
  },
  latestInspection?: Inspection
): 'manual' | 'inspection' | null {
  const hasInspection = latestInspection?.status === 'completed';
  const hasManual = Boolean(facility.spcc_completion_type && facility.spcc_inspection_date);
  if (!hasInspection) return hasManual ? 'manual' : null;
  if (!hasManual) return 'inspection';
  const manualTime = parseLocalDate(facility.spcc_inspection_date!).getTime();
  const inspectionTime = parseLocalDate(latestInspection!.conducted_at).getTime();
  return manualTime > inspectionTime ? 'manual' : 'inspection';
}

/** True when the external completion mark is the facility's current evidence. */
export function isExternalCompletionCurrent(
  facility: {
    spcc_completion_type?: string | null;
    spcc_inspection_date?: string | null;
  },
  latestInspection?: Inspection
): boolean {
  return facility.spcc_completion_type === 'external' &&
    getCurrentCompletionSource(facility, latestInspection) === 'manual';
}

/** Canonical compliance predicate used by visibility and route-display fallback. */
export function isFacilityInspectionCurrent(
  facility: {
    spcc_completion_type?: string | null;
    spcc_inspection_date?: string | null;
    first_prod_date?: string | null;
  },
  inspections: Inspection[] = [],
): boolean {
  return isFacilityInspectionCurrentAt(facility, inspections, new Date(), INSPECTION_EXPIRING_DAYS);
}
