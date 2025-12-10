import { Inspection } from '../lib/supabase';

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
