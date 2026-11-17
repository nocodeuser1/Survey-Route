/**
 * LDAR Site Plan applicability + status helpers.
 *
 * Regulatory background: a facility needs an LDAR Site Plan if it
 * "commenced construction" after Dec 6, 2022. We don't track a
 * commenced-construction date, so we PROXY it with the Initial Production
 * (IP) date (`first_prod_date`). That's an approximation — a facility's IP
 * date is later than when construction began — so this flags a superset is
 * possible, but in practice IP date is the closest signal we have. Any UI
 * that surfaces "Needed" should carry that caveat (see the note strings
 * below) so the user knows it's an IP-date proxy, not the literal rule.
 */

import type {
  Facility,
  LDARFacilityInventory,
  LDARLeak,
  LDARLeakStatus,
  LDARSurveyFrequency,
  LDARSurveyMethod,
} from '../lib/supabase';
import { parseLocalDate, formatDate, instantToZonedParts } from './dateUtils';
import { pickFacilityFilenameName } from './spccPlans';

/** Cutoff for LDAR Site Plan applicability (commenced-construction rule,
 *  proxied by IP date). Facilities with an IP date strictly after this need
 *  a plan. */
export const LDAR_CUTOFF_ISO = '2022-12-06';

/** Human-friendly cutoff for labels/tooltips. */
export const LDAR_CUTOFF_LABEL = '12/6/2022';

/** Shared caveat shown in tooltips so users know "Needed" is derived from
 *  the IP date, not the literal "commenced construction" date. */
export const LDAR_PROXY_NOTE =
  `LDAR Site Plans are required for facilities that commenced construction after ${LDAR_CUTOFF_LABEL}. ` +
  `That date isn't tracked, so this uses the Initial Production (IP) date as a proxy — verify against the actual construction date before relying on it.`;

export type LdarSitePlanState = 'completed' | 'uploaded' | 'needed' | 'not_required';

type LdarFacilityFields = Pick<
  Facility,
  'first_prod_date' | 'ldar_site_plan_completed' | 'ldar_site_plan_url'
>;

/** True when the facility's IP date is strictly after the LDAR cutoff (our
 *  proxy for "commenced construction after the cutoff"). Facilities with no
 *  IP date can't be assessed and return false. */
export function isLdarSitePlanRequired(
  facility: Pick<Facility, 'first_prod_date'>,
): boolean {
  if (!facility.first_prod_date) return false;
  const ip = parseLocalDate(facility.first_prod_date).getTime();
  const cutoff = parseLocalDate(LDAR_CUTOFF_ISO).getTime();
  return ip > cutoff;
}

/**
 * Resolve a facility's LDAR Site Plan state:
 *  - 'completed'    — marked complete (work done, with or without a file)
 *  - 'uploaded'     — a file is on record but it's not marked complete yet
 *  - 'needed'       — required (IP after cutoff) and no plan on file
 *  - 'not_required' — IP on/before the cutoff (or no IP date) and no plan
 */
export function getLdarSitePlanState(
  facility: LdarFacilityFields,
): LdarSitePlanState {
  if (facility.ldar_site_plan_completed) return 'completed';
  if (facility.ldar_site_plan_url) return 'uploaded';
  if (isLdarSitePlanRequired(facility)) return 'needed';
  return 'not_required';
}

/**
 * Resolve the date for the download filename, formatted MM-DD-YY. The right
 * date depends on which file we're naming:
 *  - kind 'path' (the annotated observation-path report): the date stamped on
 *    the plan — dateValueOverride → annotated bake date → source upload date.
 *  - kind 'plan' (the source site-plan PDF): the source plan's OWN upload date
 *    first (annotated bake date as a fallback), since the source PDF isn't
 *    stamped with the editor's title-block date.
 * Returns '' when nothing is resolvable.
 */
function resolveLdarPlanDateMMDDYY(facility: Facility, kind: 'path' | 'plan' = 'path'): string {
  const data = facility.ldar_observation_path_data;
  if (kind === 'path') {
    const override = data?.dateValueOverride?.trim();
    if (override) {
      const m = override.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
      if (m) {
        const mo = m[1].padStart(2, '0');
        const d = m[2].padStart(2, '0');
        const y = m[3].length === 4 ? m[3].slice(2) : m[3].padStart(2, '0');
        return `${mo}-${d}-${y}`;
      }
      // Non-standard custom text — make it filename-safe and use as-is.
      return override.replace(/[/\\:*?"<>|]/g, '-').trim();
    }
  }
  const iso =
    kind === 'plan'
      ? facility.ldar_site_plan_uploaded_at ?? data?.annotated_pdf_uploaded_at ?? null
      : data?.annotated_pdf_uploaded_at ?? facility.ldar_site_plan_uploaded_at ?? null;
  const dm = iso ? String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  return dm ? `${dm[2]}-${dm[3]}-${dm[1].slice(2)}` : '';
}

/**
 * The "document date" stamped on the LDAR observation plan, formatted for
 * display (M/D/YYYY). This is the date shown in the editor's title block:
 *  1. The user's custom date (dateValueOverride, "M/D/YY" or "M/D/YYYY").
 *  2. The date the annotated PDF was baked.
 *  3. The source-PDF upload date as a last resort.
 * Returns null when nothing is resolvable.
 */
export function getLdarPlanDocumentDate(facility: Facility): string | null {
  const override = facility.ldar_observation_path_data?.dateValueOverride?.trim();
  if (override) {
    const m = override.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (m) {
      const mo = parseInt(m[1], 10);
      const d = parseInt(m[2], 10);
      let y = parseInt(m[3], 10);
      if (m[3].length <= 2) y += 2000;
      return `${mo}/${d}/${y}`;
    }
    return override; // non-standard custom text — show as typed
  }
  const iso =
    facility.ldar_observation_path_data?.annotated_pdf_uploaded_at ??
    facility.ldar_site_plan_uploaded_at ??
    null;
  return iso ? formatDate(iso) : null;
}

/**
 * Canonical download filename for an LDAR PDF — mirrors the SPCC plan
 * convention, with the plan's own stamped date:
 *
 *   kind 'path' (the annotated observation-path report):
 *     "{Facility Name} - {Camino Facility ID} - LDAR Site Path (MM-DD-YY).pdf"
 *   kind 'plan' (the source site-plan PDF):
 *     "{Facility Name} - {Camino Facility ID} - LDAR Site Plan (MM-DD-YY).pdf"
 *
 * Facility name + Camino ID resolved the same way as SPCC filenames
 * (pickFacilityFilenameName; "NoID" placeholder when the ID is missing).
 * Defaults to 'path' for backward compatibility with the single-file download.
 */
export function buildLdarSitePlanFilename(
  facility: Facility,
  kind: 'path' | 'plan' = 'path',
): string {
  const sanitize = (s: string) =>
    s.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  const name = sanitize(pickFacilityFilenameName(facility)) || 'Unnamed Facility';
  const id = facility.camino_facility_id
    ? sanitize(facility.camino_facility_id) || 'NoID'
    : 'NoID';
  const dateStr = resolveLdarPlanDateMMDDYY(facility, kind);
  const datePart = dateStr ? ` (${dateStr})` : '';
  const label = kind === 'plan' ? 'LDAR Site Plan' : 'LDAR Site Path';
  return `${name} - ${id} - ${label}${datePart}.pdf`;
}

// ============================================================================
// Full LDAR Mode: Regulatory Engine, Schedule Windows, Leak Lifecycle & GHG
// ============================================================================

/**
 * Preview access gate: until Israel approves LDAR Mode for remaining accounts,
 * only `contact@myaileads.co` sees the LDAR mode switcher, hub, surveys & leaks UI.
 */
export const LDAR_MODE_PREVIEW_EMAIL = 'contact@myaileads.co';

export function canUserAccessLdarMode(email?: string | null): boolean {
  return typeof email === 'string' && email.trim().toLowerCase() === LDAR_MODE_PREVIEW_EMAIL;
}

export interface LDARRegulationSpec {
  code: string;
  label: string;
  jurisdiction: 'Federal' | 'State';
  faarDays: number;
  finalRepairDays: number;
  confirmationDaysFromRepair: number;
  confirmationDaysFromAttempt?: number;
  defaultFrequency: LDARSurveyFrequency;
  defaultMethod: LDARSurveyMethod;
  reportingPeriodNote?: string;
}

export const LDAR_REGULATIONS_CATALOG: LDARRegulationSpec[] = [
  {
    code: 'EPA NSPS OOOOb',
    label: 'EPA 40 CFR 60 Subpart OOOOb (Quad Ob)',
    jurisdiction: 'Federal',
    faarDays: 15,
    finalRepairDays: 30,
    confirmationDaysFromRepair: 15,
    confirmationDaysFromAttempt: 30,
    defaultFrequency: 'quarterly',
    defaultMethod: 'OGI',
    reportingPeriodNote: 'Annual CEDRI Period: May 7 – May 6',
  },
  {
    code: 'EPA NSPS OOOOa',
    label: 'EPA 40 CFR 60 Subpart OOOOa (Quad Oa)',
    jurisdiction: 'Federal',
    faarDays: 30,
    finalRepairDays: 30,
    confirmationDaysFromRepair: 30,
    confirmationDaysFromAttempt: 30,
    defaultFrequency: 'semi_annual',
    defaultMethod: 'OGI',
    reportingPeriodNote: 'Annual CEDRI Period: Aug 2 – Aug 1',
  },
  {
    code: 'EPA NSPS OOOO',
    label: 'EPA 40 CFR 60 Subpart OOOO (Quad O)',
    jurisdiction: 'Federal',
    faarDays: 5,
    finalRepairDays: 15,
    confirmationDaysFromRepair: 15,
    defaultFrequency: 'annual',
    defaultMethod: 'AVO',
  },
  {
    code: 'EPA EG OOOOc',
    label: 'EPA 40 CFR 60 Subpart OOOOc (Existing Sources)',
    jurisdiction: 'Federal',
    faarDays: 15,
    finalRepairDays: 30,
    confirmationDaysFromRepair: 15,
    defaultFrequency: 'quarterly',
    defaultMethod: 'OGI',
  },
  {
    code: 'EPA Appendix K',
    label: 'EPA Appendix K (OGI Protocol)',
    jurisdiction: 'Federal',
    faarDays: 5,
    finalRepairDays: 15,
    confirmationDaysFromRepair: 15,
    defaultFrequency: 'bi_monthly',
    defaultMethod: 'Appendix K OGI',
  },
  {
    code: 'EPA Subpart W',
    label: 'EPA 40 CFR 98 Subpart W (GHG Reporting)',
    jurisdiction: 'Federal',
    faarDays: 30,
    finalRepairDays: 30,
    confirmationDaysFromRepair: 30,
    defaultFrequency: 'annual',
    defaultMethod: 'OGI',
    reportingPeriodNote: 'Calendar Year GHG Inventory (Jan 1 – Dec 31)',
  },
  {
    code: 'OK OAC 252:100',
    label: 'Oklahoma DEQ OAC 252:100 (Oil & Gas Fugitives)',
    jurisdiction: 'State',
    faarDays: 15,
    finalRepairDays: 30,
    confirmationDaysFromRepair: 15,
    defaultFrequency: 'quarterly',
    defaultMethod: 'OGI',
  },
  {
    code: 'CO Reg 7',
    label: 'Colorado CDPHE Regulation 7',
    jurisdiction: 'State',
    faarDays: 5,
    finalRepairDays: 30,
    confirmationDaysFromRepair: 15,
    defaultFrequency: 'monthly',
    defaultMethod: 'OGI',
  },
  {
    code: 'NM NMED Part 50',
    label: 'New Mexico 20.2.50 NMAC (Ozone Precursor Rule)',
    jurisdiction: 'State',
    faarDays: 5,
    finalRepairDays: 15,
    confirmationDaysFromRepair: 15,
    defaultFrequency: 'quarterly',
    defaultMethod: 'OGI',
  },
  {
    code: 'NM OCD Rule 27',
    label: 'New Mexico EMNRD OCD Waste Rule (19.15.27)',
    jurisdiction: 'State',
    faarDays: 5,
    finalRepairDays: 15,
    confirmationDaysFromRepair: 15,
    defaultFrequency: 'monthly',
    defaultMethod: 'AVO',
  },
  {
    code: 'TX 30 TAC 115',
    label: 'Texas TCEQ 30 TAC Chapter 115 / PBR',
    jurisdiction: 'State',
    faarDays: 5,
    finalRepairDays: 15,
    confirmationDaysFromRepair: 15,
    defaultFrequency: 'quarterly',
    defaultMethod: 'OGI',
  },
  {
    code: 'WY Chapter 6',
    label: 'Wyoming WDEQ Chapter 6 Section 2',
    jurisdiction: 'State',
    faarDays: 15,
    finalRepairDays: 30,
    confirmationDaysFromRepair: 30,
    defaultFrequency: 'quarterly',
    defaultMethod: 'OGI',
  },
  {
    code: 'PA GP-5 / GP-5A',
    label: 'Pennsylvania DEP GP-5 / GP-5A',
    jurisdiction: 'State',
    faarDays: 5,
    finalRepairDays: 15,
    confirmationDaysFromRepair: 15,
    defaultFrequency: 'quarterly',
    defaultMethod: 'OGI',
  },
  {
    code: 'UT R307-509',
    label: 'Utah DAQ R307-509 LDAR',
    jurisdiction: 'State',
    faarDays: 5,
    finalRepairDays: 15,
    confirmationDaysFromRepair: 15,
    defaultFrequency: 'semi_annual',
    defaultMethod: 'OGI',
  },
];

export const LDAR_FREQUENCY_LABELS: Record<LDARSurveyFrequency, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  bi_monthly: 'Bi-Monthly (60d)',
  quarterly: 'Quarterly (90d)',
  semi_annual: 'Semi-Annual (180d)',
  annual: 'Annual (365d)',
  exempt: 'Exempt / Inactive',
};

export const LDAR_FREQUENCY_DAYS: Record<Exclude<LDARSurveyFrequency, 'exempt'>, { dueDays: number; windowOpenDays: number }> = {
  weekly: { dueDays: 7, windowOpenDays: 4 },
  monthly: { dueDays: 30, windowOpenDays: 15 },
  bi_monthly: { dueDays: 60, windowOpenDays: 40 },
  quarterly: { dueDays: 90, windowOpenDays: 60 },
  semi_annual: { dueDays: 180, windowOpenDays: 120 },
  annual: { dueDays: 365, windowOpenDays: 300 },
};

export const LDAR_SURVEY_METHODS: LDARSurveyMethod[] = [
  'OGI',
  'Appendix K OGI',
  'AVO',
  'Method 21',
  'Acoustic',
  'Flyover',
];

export const LDAR_FACILITY_TYPES = [
  'Well Site',
  'Tank Battery',
  'Compressor Station',
  'Central Delivery Point',
  'Gathering Station',
  'Gas Processing Plant',
];

export const LDAR_COMPONENT_TYPES: Array<{
  type: string;
  subtypes: string[];
  defaultScfhFactor: number;
}> = [
  { type: 'Valve', subtypes: ['Ball Valve', 'Gate Valve', 'Needle Valve', 'Plug Valve', 'Check Valve', 'Control Valve', 'Dump Valve'], defaultScfhFactor: 4.9 },
  { type: 'Connector', subtypes: ['Threaded Union', 'Tubing Fitting', 'Compression Fitting', 'Quick Connect', 'Nipple / Coupling'], defaultScfhFactor: 1.3 },
  { type: 'Flange', subtypes: ['Raised Face Flange', 'Ring-Type Joint (RTJ)', 'Blind Flange', 'Manway Flange'], defaultScfhFactor: 3.1 },
  { type: 'Thief Hatch / Tank Vent', subtypes: ['Enardo Thief Hatch', 'Weighted Hatch Gasket', 'Tank Vent / PVRV', 'Gauge Hatch'], defaultScfhFactor: 18.4 },
  { type: 'Pressure Relief Device (PRV)', subtypes: ['Spring PSV', 'Pilot-Operated PRV', 'Rupture Disk', 'Backpressure Regulator'], defaultScfhFactor: 12.6 },
  { type: 'Pneumatic Device', subtypes: ['Low-Bleed Controller', 'Intermittent Vent Controller', 'Pneumatic Level Dump', 'Zero-Bleed Actuator'], defaultScfhFactor: 6.8 },
  { type: 'Compressor', subtypes: ['Rod Packing', 'Wet Seal', 'Blowdown Valve', 'Distance Piece'], defaultScfhFactor: 14.2 },
  { type: 'Pump', subtypes: ['Chemical Injection Pump', 'Transfer Pump Seal', 'Glycol Pump'], defaultScfhFactor: 5.5 },
  { type: 'Open-Ended Line', subtypes: ['Uncapped Sample Port', 'Bleed Valve', 'Drain Line'], defaultScfhFactor: 2.8 },
  { type: 'Meter / Instrument', subtypes: ['Orifice Meter Tap', 'Pressure Transmitter', 'Sight Glass', 'Thermowell'], defaultScfhFactor: 2.1 },
  { type: 'Cover', subtypes: ['Vessel Access Cover', 'Filter Separator Closure'], defaultScfhFactor: 3.9 },
  { type: 'Other', subtypes: ['Flare / Combustor Pilot', 'Piping Weld / Body', 'Other Fugitive'], defaultScfhFactor: 4.0 },
];

export const LDAR_COMPONENT_SIZES = [
  '1/8"', '1/4"', '3/8"', '1/2"', '3/4"', '1"', '1.5"', '2"', '3"', '4"', '6"', '8"', '10"', '12"', '> 12"',
];

export const LDAR_GAS_STREAMS = [
  'Sales Gas',
  'Fuel Gas',
  'Flash Gas',
  'Crude Oil / Condensate',
  'Produced Water',
  'NGL',
];

export const LDAR_REPAIR_METHODS = [
  'Tightened Packing / Gland Nut',
  'Torqued Flange / Union Bolts',
  'Cleaned & Reseated Thief Hatch Gasket',
  'Replaced Thief Hatch Seal / Spring',
  'Replaced Valve / Component',
  'Replaced O-Ring / Thread Sealant',
  'Installed Cap / Plug on Open-Ended Line',
  'Rebuilt Regulator / Pneumatic Controller',
  'Isolated Process Line',
  'Other Mechanical Repair',
];

export const LDAR_DOR_REASONS = [
  'Requires Facility / Process Unit Shutdown',
  'Parts Ordered / Awaiting Delivery',
  'Unsafe to Repair While Operating',
  'Technically Infeasible Without Greater Emissions',
];

export function getTodayInAccountTimeZone(): string {
  const zoned = instantToZonedParts(new Date()).date;
  if (zoned) return zoned;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function normalizeLdarInventory(
  raw: LDARFacilityInventory | unknown,
): LDARFacilityInventory {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return raw as LDARFacilityInventory;
}

export function addDaysToIso(isoDate: string, days: number): string {
  const base = parseLocalDate(isoDate);
  base.setDate(base.getDate() + days);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function diffDaysFromToday(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const target = parseLocalDate(isoDate);
  if (Number.isNaN(target.getTime())) return null;
  const today = parseLocalDate(getTodayInAccountTimeZone());
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Multi-Regulation Strictness Calculator (LeakTracker Pro parity).
 * Evaluates all applicable regulations on a facility/leak and returns the
 * most restrictive (earliest) FAAR, Final Repair, Confirmation, and DOR deadlines.
 */
export function calculateStrictestLeakDeadlines(params: {
  detectedAt: string;
  applicableRegulations?: string[] | null;
  firstAttemptDate?: string | null;
  repairedDate?: string | null;
  dorApproved?: boolean;
  plannedShutdownDate?: string | null;
}): {
  faarDays: number;
  finalRepairDays: number;
  confirmationDays: number;
  governingRule: string;
  faarDueDate: string;
  finalRepairDueDate: string;
  confirmationDueDate: string;
  dorExtendedDueDate: string;
} {
  const {
    detectedAt,
    applicableRegulations,
    firstAttemptDate,
    repairedDate,
    plannedShutdownDate,
  } = params;

  const matchedSpecs = (applicableRegulations || [])
    .map(code => LDAR_REGULATIONS_CATALOG.find(r => r.code === code))
    .filter((r): r is LDARRegulationSpec => Boolean(r));

  // Default to EPA NSPS OOOOb rules if none selected
  const specs = matchedSpecs.length > 0 ? matchedSpecs : [LDAR_REGULATIONS_CATALOG[0]];

  let faarDays = Infinity;
  let finalRepairDays = Infinity;
  let confirmationDaysFromRepair = Infinity;
  let confirmationDaysFromAttempt = Infinity;
  let governingRule = specs[0].code;

  for (const spec of specs) {
    if (spec.faarDays < faarDays) {
      faarDays = spec.faarDays;
      governingRule = spec.code;
    }
    if (spec.finalRepairDays < finalRepairDays) {
      finalRepairDays = spec.finalRepairDays;
    }
    if (spec.confirmationDaysFromRepair < confirmationDaysFromRepair) {
      confirmationDaysFromRepair = spec.confirmationDaysFromRepair;
    }
    if (spec.confirmationDaysFromAttempt != null && spec.confirmationDaysFromAttempt < confirmationDaysFromAttempt) {
      confirmationDaysFromAttempt = spec.confirmationDaysFromAttempt;
    }
  }

  const baseDetected = detectedAt || getTodayInAccountTimeZone();
  const faarDueDate = addDaysToIso(baseDetected, faarDays);
  const finalRepairDueDate = addDaysToIso(baseDetected, finalRepairDays);

  // Confirmation window: min(repair + confirmationDaysFromRepair, attempt + confirmationDaysFromAttempt, finalRepairDueDate + confirmationDaysFromRepair)
  const candidates: string[] = [];
  if (repairedDate) {
    candidates.push(addDaysToIso(repairedDate, confirmationDaysFromRepair));
  }
  if (firstAttemptDate && Number.isFinite(confirmationDaysFromAttempt)) {
    candidates.push(addDaysToIso(firstAttemptDate, confirmationDaysFromAttempt));
  }
  if (candidates.length === 0) {
    candidates.push(addDaysToIso(finalRepairDueDate, confirmationDaysFromRepair));
  }
  candidates.sort();
  const confirmationDueDate = candidates[0];

  // DOR extended deadline: min(Next Planned Shutdown Date, Detection Date + 2 years)
  const twoYearMax = addDaysToIso(baseDetected, 730);
  const dorExtendedDueDate =
    plannedShutdownDate && plannedShutdownDate < twoYearMax
      ? plannedShutdownDate
      : twoYearMax;

  return {
    faarDays,
    finalRepairDays,
    confirmationDays: confirmationDaysFromRepair,
    governingRule,
    faarDueDate,
    finalRepairDueDate,
    confirmationDueDate,
    dorExtendedDueDate,
  };
}

/**
 * Estimate fugitive leak rate in scfh and annualized metric tons CO2e/yr
 * (using EPA Subpart W methane density 0.0192 kg/scf, ~78% CH4 gas fraction, GWP=28).
 */
export function estimateLeakEmissions(params: {
  componentType: string;
  flowRateValue?: number | null;
  flowRateUnit?: string | null;
}): { scfh: number; mtCo2ePerYear: number } {
  const { componentType, flowRateValue, flowRateUnit } = params;
  let scfh = 0;

  if (flowRateValue != null && Number.isFinite(flowRateValue) && flowRateValue > 0) {
    switch (flowRateUnit) {
      case 'scfh':
        scfh = flowRateValue;
        break;
      case 'scfm':
        scfh = flowRateValue * 60;
        break;
      case 'slpm':
        scfh = flowRateValue * 2.11888;
        break;
      case 'g/hr':
        // ~19.2 g/scf methane
        scfh = flowRateValue / 19.2;
        break;
      case 'ppm':
        // EPA correlation approximation for Method 21 screening value (ppm) -> scfh
        scfh = Math.min(25, Math.max(0.05, 0.0018 * Math.pow(flowRateValue, 0.74)));
        break;
      default:
        scfh = flowRateValue;
    }
  } else {
    const spec = LDAR_COMPONENT_TYPES.find(c => c.type === componentType);
    scfh = spec ? spec.defaultScfhFactor : 4.0;
  }

  // Annualized MT CO2e/yr (assuming 8,760 hrs/yr if unmitigated; used as emission rate KPI)
  // scfh * 8760 scf/yr * 0.78 CH4 * 0.0192 kg/scf / 1000 t/kg * 28 GWP
  const mtCo2ePerYear = Number((scfh * 8760 * 0.78 * 0.0192 * 0.001 * 28).toFixed(2));
  return { scfh: Number(scfh.toFixed(2)), mtCo2ePerYear };
}

export type FacilityLdarComplianceStatus =
  | 'overdue'
  | 'due_soon_30'
  | 'due_60'
  | 'current'
  | 'pending_initial'
  | 'exempt';

export interface FacilityLdarComplianceResult {
  status: FacilityLdarComplianceStatus;
  label: string;
  shortLabel: string;
  detail: string;
  frequency: LDARSurveyFrequency;
  method: LDARSurveyMethod;
  lastSurveyDate: string | null;
  nextDueDate: string | null;
  windowStartDate: string | null;
  daysUntilDue: number | null;
  openLeaksCount: number;
  dorLeaksCount: number;
  sitePlanState: LdarSitePlanState;
  applicableRegulations: string[];
  isUrgent: boolean;
  needsRouting: boolean;
  severityRank: number;
}

/**
 * Computes a facility's real-time LDAR schedule & leak compliance summary
 * (mirrors LeakTracker Pro's Overdue / <30d / 30-60d / >60d / Exempt windows).
 */
export function getFacilityLdarCompliance(facility: Facility): FacilityLdarComplianceResult {
  const frequency: LDARSurveyFrequency = facility.ldar_survey_frequency || 'quarterly';
  const method: LDARSurveyMethod = facility.ldar_primary_method || 'OGI';
  const openLeaksCount = facility.ldar_open_leaks_count ?? 0;
  const dorLeaksCount = facility.ldar_dor_leaks_count ?? 0;
  const sitePlanState = getLdarSitePlanState(facility);

  const defaultRegs = isLdarSitePlanRequired(facility) ? ['EPA NSPS OOOOb'] : [];
  const applicableRegulations =
    facility.ldar_applicable_regulations && facility.ldar_applicable_regulations.length > 0
      ? facility.ldar_applicable_regulations
      : defaultRegs;

  if (frequency === 'exempt') {
    return {
      status: 'exempt',
      label: 'Exempt',
      shortLabel: 'Exempt',
      detail: 'Facility marked exempt from routine LDAR surveys',
      frequency,
      method,
      lastSurveyDate: facility.ldar_last_survey_date ?? null,
      nextDueDate: null,
      windowStartDate: null,
      daysUntilDue: null,
      openLeaksCount,
      dorLeaksCount,
      sitePlanState,
      applicableRegulations,
      isUrgent: openLeaksCount > 0,
      needsRouting: openLeaksCount > 0,
      severityRank: openLeaksCount > 0 ? 1 : 6,
    };
  }

  const freqCfg = LDAR_FREQUENCY_DAYS[frequency] || LDAR_FREQUENCY_DAYS.quarterly;
  const lastSurveyDate = facility.ldar_last_survey_date ?? null;

  let nextDueDate = facility.ldar_next_survey_due ?? null;
  let windowStartDate = facility.ldar_earliest_window_date ?? null;

  if (!nextDueDate && lastSurveyDate) {
    nextDueDate = addDaysToIso(lastSurveyDate, freqCfg.dueDays);
  }
  if (!windowStartDate && lastSurveyDate) {
    windowStartDate = addDaysToIso(lastSurveyDate, freqCfg.windowOpenDays);
  }

  // If no survey has ever been recorded, check initial OOOOb 90-day startup deadline from IP date
  if (!nextDueDate && !lastSurveyDate && facility.first_prod_date && isLdarSitePlanRequired(facility)) {
    nextDueDate = addDaysToIso(facility.first_prod_date, 90);
    windowStartDate = addDaysToIso(facility.first_prod_date, 30);
  }

  const daysUntilDue = diffDaysFromToday(nextDueDate);

  if (!lastSurveyDate && daysUntilDue === null) {
    return {
      status: 'pending_initial',
      label: 'Initial Survey Needed',
      shortLabel: 'Initial Needed',
      detail: 'No LDAR survey logged yet',
      frequency,
      method,
      lastSurveyDate: null,
      nextDueDate: null,
      windowStartDate: null,
      daysUntilDue: null,
      openLeaksCount,
      dorLeaksCount,
      sitePlanState,
      applicableRegulations,
      isUrgent: openLeaksCount > 0,
      needsRouting: true,
      severityRank: openLeaksCount > 0 ? 1 : 3,
    };
  }

  if (daysUntilDue !== null && daysUntilDue < 0) {
    const daysLate = Math.abs(daysUntilDue);
    return {
      status: 'overdue',
      label: `Overdue (${daysLate}d)`,
      shortLabel: 'Overdue',
      detail: `${method} survey ${daysLate} day${daysLate === 1 ? '' : 's'} past due`,
      frequency,
      method,
      lastSurveyDate,
      nextDueDate,
      windowStartDate,
      daysUntilDue,
      openLeaksCount,
      dorLeaksCount,
      sitePlanState,
      applicableRegulations,
      isUrgent: true,
      needsRouting: true,
      severityRank: 0,
    };
  }

  if (daysUntilDue !== null && daysUntilDue <= 30) {
    return {
      status: 'due_soon_30',
      label: daysUntilDue === 0 ? 'Due Today' : `Due in ${daysUntilDue}d`,
      shortLabel: '< 30 Days',
      detail: `${method} survey due ${formatDate(nextDueDate!)}`,
      frequency,
      method,
      lastSurveyDate,
      nextDueDate,
      windowStartDate,
      daysUntilDue,
      openLeaksCount,
      dorLeaksCount,
      sitePlanState,
      applicableRegulations,
      isUrgent: true,
      needsRouting: true,
      severityRank: 1,
    };
  }

  if (daysUntilDue !== null && daysUntilDue <= 60) {
    return {
      status: 'due_60',
      label: `Due in ${daysUntilDue}d`,
      shortLabel: '30–60 Days',
      detail: `${method} survey due ${formatDate(nextDueDate!)}`,
      frequency,
      method,
      lastSurveyDate,
      nextDueDate,
      windowStartDate,
      daysUntilDue,
      openLeaksCount,
      dorLeaksCount,
      sitePlanState,
      applicableRegulations,
      isUrgent: openLeaksCount > 0,
      needsRouting: openLeaksCount > 0 || (windowStartDate != null && (diffDaysFromToday(windowStartDate) ?? 1) <= 0),
      severityRank: 2,
    };
  }

  return {
    status: 'current',
    label: daysUntilDue != null ? `Current (${daysUntilDue}d)` : 'Current',
    shortLabel: '> 60 Days',
    detail: nextDueDate ? `Next ${method} due ${formatDate(nextDueDate)}` : 'Survey schedule current',
    frequency,
    method,
    lastSurveyDate,
    nextDueDate,
    windowStartDate,
    daysUntilDue,
    openLeaksCount,
    dorLeaksCount,
    sitePlanState,
    applicableRegulations,
    isUrgent: openLeaksCount > 0,
    needsRouting: openLeaksCount > 0,
    severityRank: openLeaksCount > 0 ? 1 : 5,
  };
}

/**
 * Used by Route Planning (`App.tsx`) to decide whether a facility needs a visit
 * in LDAR mode: overdue survey, survey window open / <= 30d due, pending initial
 * survey, open leaks requiring repair/re-monitoring, or missing required Quad Ob site plan.
 */
export function facilityNeedsLdarAttention(facility: Facility): boolean {
  const compliance = getFacilityLdarCompliance(facility);
  if (compliance.needsRouting) return true;
  if (compliance.sitePlanState === 'needed') return true;
  return false;
}

export function getLeakStatusMeta(status: LDARLeakStatus): {
  label: string;
  stage: 1 | 2 | 3 | 4;
  badgeClass: string;
} {
  switch (status) {
    case 'detected':
      return {
        label: 'Initial Attempt Needed',
        stage: 1,
        badgeClass: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
      };
    case 'repair_attempted':
      return {
        label: 'Repair Needed',
        stage: 2,
        badgeClass: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
      };
    case 'pending_confirmation':
      return {
        label: 'Confirmation Needed',
        stage: 3,
        badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      };
    case 'dor_pending':
      return {
        label: 'DOR Pending Approval',
        stage: 2,
        badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
      };
    case 'dor_approved':
      return {
        label: 'Delay of Repair (DOR)',
        stage: 2,
        badgeClass: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
      };
    case 'repaired':
      return {
        label: 'Confirmed Repaired',
        stage: 4,
        badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
      };
  }
}

export function getNextActionDeadlineForLeak(leak: LDARLeak): {
  label: string;
  dueDate: string | null;
  daysLeft: number | null;
  isOverdue: boolean;
} {
  if (leak.status === 'repaired') {
    return { label: 'Closed', dueDate: leak.confirmed_date || leak.repaired_date || null, daysLeft: null, isOverdue: false };
  }
  if (leak.status === 'dor_approved') {
    const due = leak.dor_extended_due_date || leak.final_repair_due_date || null;
    const d = diffDaysFromToday(due);
    return { label: 'DOR Extended Due', dueDate: due, daysLeft: d, isOverdue: d !== null && d < 0 };
  }
  if (leak.status === 'pending_confirmation') {
    const due = leak.confirmation_due_date || null;
    const d = diffDaysFromToday(due);
    return { label: 'Confirmation Due', dueDate: due, daysLeft: d, isOverdue: d !== null && d < 0 };
  }
  if (leak.status === 'detected' && !leak.first_attempt_date) {
    const due = leak.faar_due_date || leak.final_repair_due_date || null;
    const d = diffDaysFromToday(due);
    return { label: 'First Attempt (FAAR)', dueDate: due, daysLeft: d, isOverdue: d !== null && d < 0 };
  }
  const due = leak.final_repair_due_date || null;
  const d = diffDaysFromToday(due);
  return { label: 'Final Repair Due', dueDate: due, daysLeft: d, isOverdue: d !== null && d < 0 };
}
