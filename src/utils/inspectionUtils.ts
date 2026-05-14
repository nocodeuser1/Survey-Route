import { Inspection } from '../lib/supabase';
import { parseLocalDate } from './dateUtils';

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
 *   1. Completion-type date (internal/external) → annual cycle from there.
 *   2. Latest inspection record → annual cycle from conducted_at.
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

  // Check completion type date first (internal/external)
  if (facility.spcc_completion_type && facility.spcc_inspection_date) {
    const completedDate = parseLocalDate(facility.spcc_inspection_date);
    const expiryDate = new Date(completedDate);
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    const daysUntilExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry <= 0) return { status: 'expired', daysUntilExpiry, expiryDate };
    if (daysUntilExpiry <= INSPECTION_EXPIRING_DAYS) return { status: 'expiring', daysUntilExpiry, expiryDate };
    return { status: 'valid', daysUntilExpiry, expiryDate };
  }

  // Fall back to inspection record
  if (latestInspection && latestInspection.status === 'completed') {
    const inspectionDate = new Date(latestInspection.conducted_at);
    const expiryDate = new Date(inspectionDate);
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
