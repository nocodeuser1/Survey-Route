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

export type InspectionExpiryStatus = 'valid' | 'expiring' | 'expired' | 'pending';

/**
 * Days-out at which an inspection switches from "valid" → "expiring" in the
 * UI. SPCC inspections are annual (40 CFR §112.7(c)) so we have one year of
 * runway between inspections; this constant defines how early the expiring
 * warning lights up.
 */
export const INSPECTION_EXPIRING_DAYS = 60;

/**
 * Comprehensive inspection expiry check for a facility.
 * Considers both the facility's completion date (spcc_inspection_date)
 * and the latest inspection record from the inspections table.
 * Returns 'expiring' when within INSPECTION_EXPIRING_DAYS of 1-year expiry.
 */
export function getFacilityInspectionExpiry(
  facility: { spcc_completion_type?: string | null; spcc_inspection_date?: string | null },
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

  return { status: 'pending', daysUntilExpiry: null, expiryDate: null };
}
