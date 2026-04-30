/**
 * Shared SPCC Plan status calculation - single source of truth.
 * Used by all components across every tab for consistent status display.
 */
import { parseLocalDate } from './dateUtils';

export type SPCCPlanStatus =
  | 'no_ip_date'       // No first production date
  | 'no_plan'          // Has IP date, plan not yet due (>30 days out)
  | 'initial_due'      // Within 30 days of 6-month deadline, no plan
  | 'initial_overdue'  // Past 6-month deadline, no plan
  | 'valid'            // Plan on file, >90 days until recertification
  | 'recertified'      // Recertified within last 5 years
  | 'expiring'         // Plan valid but <90 days until 5-year recertification
  | 'expired'          // Plan past 5-year recertification date
  | 'renewal_due';     // Alias for expiring (used in compliance tracking)

export interface SPCCStatusResult {
  status: SPCCPlanStatus;
  message: string;
  isCompliant: boolean;
  isUrgent: boolean;
  daysUntilDue: number | null;
  peStampDate: Date | null;
  recertificationDate: Date | null;
  hasPlan: boolean;
}

export type SPCCWorkflowStatus =
  | 'awaiting_pe_stamp'
  | 'site_visited'
  | 'pe_stamped'
  | 'completed_uploaded';

export interface SPCCStatusFacility {
  first_prod_date?: string | null;
  spcc_plan_url?: string | null;
  spcc_pe_stamp_date?: string | null;
  recertified_date?: string | null;
  spcc_workflow_status?: SPCCWorkflowStatus | null;
  spcc_workflow_status_overridden?: boolean | null;
  field_visit_date?: string | null;
  photos_taken?: boolean | null;
}

export type RecertificationDecision = 'no_changes' | 'changes_found';

/**
 * True when a facility is in (or past) the SPCC plan recertification window:
 * has an existing plan AND the 5-year clock is within 90 days of expiry, has
 * already expired, or has been recertified in the last 5 years.
 *
 * Drives visibility of the "Recertification Status" UI everywhere — Facilities
 * tab column, FacilityDetailModal, SPCCPlanDetailModal, and the map popup.
 * Facilities still on their initial plan (no PE stamp yet) are deliberately
 * excluded — recertification only applies once a plan exists.
 */
export function isRecertificationActive(facility: SPCCStatusFacility): boolean {
  const result = getSPCCPlanStatus(facility);
  if (!result.hasPlan) return false;
  return result.status === 'expiring' || result.status === 'expired' || result.status === 'recertified';
}

/** Per-berm recertification window check. Mirrors `isRecertificationActive`
 *  but operates on a single SPCCPlan row instead of the facility-level mirror.
 *  In-window when a plan PDF exists AND the 5-year clock from the latest
 *  recertification (or the original PE stamp) is within 90 days, past, or
 *  recently rolled. */
export function isPlanRecertificationActive(plan: {
  plan_url: string | null;
  pe_stamp_date: string | null;
  recertified_date: string | null;
}): boolean {
  if (!plan.plan_url || !plan.pe_stamp_date) return false;
  const baseStr = plan.recertified_date || plan.pe_stamp_date;
  if (!baseStr) return false;
  const base = parseLocalDate(baseStr);
  const recertDate = new Date(base);
  recertDate.setFullYear(recertDate.getFullYear() + 5);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntil = Math.ceil((recertDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return daysUntil <= 90;
}

/**
 * Derives the workflow status that the system would automatically assign
 * based on facility field values. Priority (highest wins):
 *   1. completed_uploaded  — plan URL is present
 *   2. pe_stamped          — PE stamp date is set
 *   3. site_visited        — visit date OR photos_taken flag is set
 *   4. null                — nothing qualifying is set
 * `awaiting_pe_stamp` is never auto-assigned; it is always a manual selection.
 */
export function getAutoWorkflowStatus(
  facility: Pick<SPCCStatusFacility, 'spcc_plan_url' | 'spcc_pe_stamp_date' | 'field_visit_date' | 'photos_taken'>
): SPCCWorkflowStatus | null {
  if (facility.spcc_plan_url) return 'completed_uploaded';
  if (facility.spcc_pe_stamp_date) return 'pe_stamped';
  if (facility.field_visit_date || facility.photos_taken) return 'site_visited';
  return null;
}

export interface SPCCWorkflowBadgeConfig {
  label: string;
  colorClass: string;
  darkColorClass: string;
}

export function getSPCCWorkflowBadgeConfig(status: SPCCWorkflowStatus): SPCCWorkflowBadgeConfig {
  switch (status) {
    case 'awaiting_pe_stamp':
      return {
        label: 'Awaiting PE Stamp',
        colorClass: 'bg-blue-100 text-blue-700',
        darkColorClass: 'bg-blue-900/30 text-blue-300',
      };
    case 'site_visited':
      return {
        label: 'Site Visited',
        colorClass: 'bg-amber-100 text-amber-700',
        darkColorClass: 'bg-amber-900/30 text-amber-300',
      };
    case 'pe_stamped':
      return {
        label: 'PE Stamped',
        colorClass: 'bg-violet-100 text-violet-700',
        darkColorClass: 'bg-violet-900/30 text-violet-300',
      };
    case 'completed_uploaded':
      return {
        label: 'Completed / Uploaded',
        colorClass: 'bg-emerald-100 text-emerald-700',
        darkColorClass: 'bg-emerald-900/30 text-emerald-300',
      };
  }
}

export function shouldShowSPCCWorkflowStatus(facility: SPCCStatusFacility): boolean {
  return !!facility.spcc_workflow_status;
}

/** Format a day count into a readable duration (e.g. "2y 45d" or "23d") */
export function formatDayCount(totalDays: number): string {
  const absDays = Math.abs(totalDays);
  if (absDays < 365) return `${absDays}d`;
  const years = Math.floor(absDays / 365);
  const remainingDays = absDays % 365;
  if (remainingDays === 0) return `${years}y`;
  return `${years}y ${remainingDays}d`;
}

export function getSPCCPlanStatus(facility: SPCCStatusFacility): SPCCStatusResult {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // PE stamp date is the ONLY source for SPCC plan completion
  // (spcc_inspection_date is separate and used for SPCC inspection tracking)
  const hasPlan = !!(facility.spcc_plan_url && facility.spcc_pe_stamp_date);
  const peStampDate = facility.spcc_pe_stamp_date ? parseLocalDate(facility.spcc_pe_stamp_date) : null;

  // Case 0: Has a recertified_date -> use recert date + 5 years as the recertification window
  if (facility.recertified_date) {
    const recertDate = parseLocalDate(facility.recertified_date);
    const recertRecertificationDate = new Date(recertDate);
    recertRecertificationDate.setFullYear(recertRecertificationDate.getFullYear() + 5);
    const daysUntilRecertRecertification = Math.ceil(
      (recertRecertificationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysUntilRecertRecertification > 90) {
      return {
        status: 'recertified',
        message: 'SPCC Recertified',
        isCompliant: true,
        isUrgent: false,
        daysUntilDue: daysUntilRecertRecertification,
        peStampDate,
        recertificationDate: recertRecertificationDate,
        hasPlan,
      };
    }

    // Recert is expiring or expired — use the recert recertification date for the countdown
    if (daysUntilRecertRecertification < 0) {
      return {
        status: 'expired',
        message: `Expired ${formatDayCount(daysUntilRecertRecertification)} ago`,
        isCompliant: false,
        isUrgent: true,
        daysUntilDue: daysUntilRecertRecertification,
        peStampDate,
        recertificationDate: recertRecertificationDate,
        hasPlan,
      };
    }

    return {
      status: 'expiring',
      message: `Recertification in ${formatDayCount(daysUntilRecertRecertification)}`,
      isCompliant: true,
      isUrgent: true,
      daysUntilDue: daysUntilRecertRecertification,
      peStampDate,
      recertificationDate: recertRecertificationDate,
      hasPlan,
    };
  }

  // Case 1: Has a PE stamp date -> check recertification status
  if (facility.spcc_pe_stamp_date && peStampDate) {
    const recertificationDate = new Date(peStampDate);
    recertificationDate.setFullYear(recertificationDate.getFullYear() + 5);

    const daysUntilRecertification = Math.ceil(
      (recertificationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysUntilRecertification < 0) {
      return {
        status: 'expired',
        message: `Expired ${formatDayCount(daysUntilRecertification)} ago`,
        isCompliant: false,
        isUrgent: true,
        daysUntilDue: daysUntilRecertification,
        peStampDate,
        recertificationDate,
        hasPlan,
      };
    }

    if (daysUntilRecertification <= 90) {
      return {
        status: 'expiring',
        message: `Recertification in ${formatDayCount(daysUntilRecertification)}`,
        isCompliant: true,
        isUrgent: true,
        daysUntilDue: daysUntilRecertification,
        peStampDate,
        recertificationDate,
        hasPlan,
      };
    }

    return {
      status: 'valid',
      message: 'Plan Active',
      isCompliant: true,
      isUrgent: false,
      daysUntilDue: daysUntilRecertification,
      peStampDate,
      recertificationDate,
      hasPlan,
    };
  }

  // Case 2: No plan, check if one is needed
  if (!facility.first_prod_date) {
    return {
      status: 'no_ip_date',
      message: 'No IP Date',
      isCompliant: true,
      isUrgent: false,
      daysUntilDue: null,
      peStampDate: null,
      recertificationDate: null,
      hasPlan: false,
    };
  }

  // Has IP date but no plan
  const ipDate = parseLocalDate(facility.first_prod_date);
  const sixMonthsDue = new Date(ipDate);
  sixMonthsDue.setMonth(sixMonthsDue.getMonth() + 6);

  const daysUntilInitialDue = Math.ceil(
    (sixMonthsDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysUntilInitialDue < 0) {
    return {
      status: 'initial_overdue',
      message: `Overdue ${formatDayCount(daysUntilInitialDue)}`,
      isCompliant: false,
      isUrgent: true,
      daysUntilDue: daysUntilInitialDue,
      peStampDate: null,
      recertificationDate: null,
      hasPlan: false,
    };
  }

  if (daysUntilInitialDue <= 30) {
    return {
      status: 'initial_due',
      message: `Due in ${daysUntilInitialDue}d`,
      isCompliant: true,
      isUrgent: true,
      daysUntilDue: daysUntilInitialDue,
      peStampDate: null,
      recertificationDate: null,
      hasPlan: false,
    };
  }

  return {
    status: 'no_plan',
    message: `Due ${sixMonthsDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    isCompliant: true,
    isUrgent: false,
    daysUntilDue: daysUntilInitialDue,
    peStampDate: null,
    recertificationDate: null,
    hasPlan: false,
  };
}

export interface StatusBadgeConfig {
  colorClass: string;
  darkColorClass: string;
  icon: 'check' | 'clock' | 'alert' | 'file';
  label: string;
}

export function getStatusBadgeConfig(status: SPCCPlanStatus): StatusBadgeConfig {
  switch (status) {
    case 'valid':
      return {
        colorClass: 'bg-green-100 text-green-700',
        darkColorClass: 'bg-green-900/30 text-green-400',
        icon: 'check',
        label: 'SPCC Valid',
      };
    case 'recertified':
      return {
        colorClass: 'bg-green-100 text-green-700',
        darkColorClass: 'bg-green-900/30 text-green-400',
        icon: 'check',
        label: 'SPCC Recertified',
      };
    case 'expiring':
    case 'renewal_due':
      return {
        colorClass: 'bg-amber-100 text-amber-700',
        darkColorClass: 'bg-amber-900/30 text-amber-400',
        icon: 'clock',
        label: 'Expiring',
      };
    case 'expired':
      return {
        colorClass: 'bg-red-100 text-red-700',
        darkColorClass: 'bg-red-900/30 text-red-400',
        icon: 'alert',
        label: 'Expired',
      };
    case 'initial_due':
      return {
        colorClass: 'bg-amber-100 text-amber-700',
        darkColorClass: 'bg-amber-900/30 text-amber-400',
        icon: 'clock',
        label: 'Due Soon',
      };
    case 'initial_overdue':
      return {
        colorClass: 'bg-red-100 text-red-700',
        darkColorClass: 'bg-red-900/30 text-red-400',
        icon: 'alert',
        label: 'Overdue',
      };
    case 'no_plan':
      return {
        colorClass: 'bg-blue-50 text-blue-600',
        darkColorClass: 'bg-blue-900/30 text-blue-400',
        icon: 'clock',
        label: 'Upcoming',
      };
    case 'no_ip_date':
      return {
        colorClass: 'bg-gray-100 text-gray-500',
        darkColorClass: 'bg-gray-700 text-gray-400',
        icon: 'file',
        label: 'No IP Date',
      };
  }
}

/** Returns true if the facility needs SPCC plan attention (for filtering).
 *  Includes upcoming plans (no_plan = has IP date but plan not yet due) so they
 *  appear in SPCC Plans mode counts, day lists, and map when selected for a route. */
export function facilityNeedsSPCCPlan(facility: SPCCStatusFacility): boolean {
  const { status } = getSPCCPlanStatus(facility);
  return ['no_plan', 'initial_overdue', 'initial_due', 'expired', 'expiring', 'renewal_due'].includes(status);
}

/** Returns a CSV-friendly status string */
export function getSPCCPlanStatusText(facility: SPCCStatusFacility): string {
  const result = getSPCCPlanStatus(facility);
  switch (result.status) {
    case 'valid': return 'Current';
    case 'recertified': return 'Recertified';
    case 'expiring': return 'Expiring';
    case 'expired': return 'Expired';
    case 'initial_due': return 'Due Soon';
    case 'initial_overdue': return 'Overdue';
    case 'no_plan': return 'Upcoming';
    case 'no_ip_date': return 'No Date';
    case 'renewal_due': return 'Recertification Due';
  }
}
