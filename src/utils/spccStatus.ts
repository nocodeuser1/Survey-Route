/**
 * Shared SPCC Plan status calculation - single source of truth.
 * Used by all components across every tab for consistent status display.
 */

export type SPCCPlanStatus =
  | 'no_ip_date'       // No first production date
  | 'no_plan'          // Has IP date, plan not yet due (>30 days out)
  | 'initial_due'      // Within 30 days of 6-month deadline, no plan
  | 'initial_overdue'  // Past 6-month deadline, no plan
  | 'valid'            // Plan on file, >90 days until renewal
  | 'expiring'         // Plan valid but <90 days until 5-year renewal
  | 'expired'          // Plan past 5-year renewal date
  | 'renewal_due';     // Alias for expiring (used in compliance tracking)

export interface SPCCStatusResult {
  status: SPCCPlanStatus;
  message: string;
  isCompliant: boolean;
  isUrgent: boolean;
  daysUntilDue: number | null;
  peStampDate: Date | null;
  renewalDate: Date | null;
  hasPlan: boolean;
}

export interface SPCCStatusFacility {
  first_prod_date?: string | null;
  spcc_plan_url?: string | null;
  spcc_pe_stamp_date?: string | null;
}

export function getSPCCPlanStatus(facility: SPCCStatusFacility): SPCCStatusResult {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // PE stamp date is the ONLY source for SPCC plan completion
  // (spcc_inspection_date is separate and used for SPCC inspection tracking)
  const hasPlan = !!(facility.spcc_plan_url && facility.spcc_pe_stamp_date);

  // Case 1: Has a PE stamp date -> check renewal status
  if (facility.spcc_pe_stamp_date) {
    const effectiveDateStr = facility.spcc_pe_stamp_date;
    const peStampDate = new Date(effectiveDateStr);
    peStampDate.setHours(0, 0, 0, 0);
    const renewalDate = new Date(peStampDate);
    renewalDate.setFullYear(renewalDate.getFullYear() + 5);

    const daysUntilRenewal = Math.ceil(
      (renewalDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysUntilRenewal < 0) {
      return {
        status: 'expired',
        message: `Expired ${Math.abs(daysUntilRenewal)}d ago`,
        isCompliant: false,
        isUrgent: true,
        daysUntilDue: daysUntilRenewal,
        peStampDate,
        renewalDate,
        hasPlan,
      };
    }

    if (daysUntilRenewal <= 90) {
      return {
        status: 'expiring',
        message: `Renewal in ${daysUntilRenewal}d`,
        isCompliant: true,
        isUrgent: true,
        daysUntilDue: daysUntilRenewal,
        peStampDate,
        renewalDate,
        hasPlan,
      };
    }

    return {
      status: 'valid',
      message: 'Plan Active',
      isCompliant: true,
      isUrgent: false,
      daysUntilDue: daysUntilRenewal,
      peStampDate,
      renewalDate,
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
      renewalDate: null,
      hasPlan: false,
    };
  }

  // Has IP date but no plan
  const ipDate = new Date(facility.first_prod_date);
  ipDate.setHours(0, 0, 0, 0);
  const sixMonthsDue = new Date(ipDate);
  sixMonthsDue.setMonth(sixMonthsDue.getMonth() + 6);

  const daysUntilInitialDue = Math.ceil(
    (sixMonthsDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysUntilInitialDue < 0) {
    return {
      status: 'initial_overdue',
      message: `Overdue ${Math.abs(daysUntilInitialDue)}d`,
      isCompliant: false,
      isUrgent: true,
      daysUntilDue: daysUntilInitialDue,
      peStampDate: null,
      renewalDate: null,
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
      renewalDate: null,
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
    renewalDate: null,
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
        label: 'Pending',
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

/** Returns true if the facility needs SPCC plan attention (for filtering) */
export function facilityNeedsSPCCPlan(facility: SPCCStatusFacility): boolean {
  const { status } = getSPCCPlanStatus(facility);
  return ['initial_overdue', 'initial_due', 'expired', 'expiring', 'renewal_due'].includes(status);
}

/** Returns a CSV-friendly status string */
export function getSPCCPlanStatusText(facility: SPCCStatusFacility): string {
  const result = getSPCCPlanStatus(facility);
  switch (result.status) {
    case 'valid': return 'Current';
    case 'expiring': return 'Expiring';
    case 'expired': return 'Expired';
    case 'initial_due': return 'Due Soon';
    case 'initial_overdue': return 'Overdue';
    case 'no_plan': return 'Pending';
    case 'no_ip_date': return 'No Date';
    case 'renewal_due': return 'Renewal Due';
  }
}
