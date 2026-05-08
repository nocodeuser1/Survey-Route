/**
 * Custom filter system for the Facilities list.
 *
 * Each rule is { fieldId, operatorId, value }. Rules are AND-combined when
 * applied. The field registry below is the single source of truth for what
 * can be filtered on, what operators are available per field, and how to
 * read the field's value off a Facility row. UI walks the registry; the
 * evaluator walks the rules.
 *
 * Why a registry instead of one big switch: adding a new filterable field
 * is one entry in FILTER_FIELDS. The dropdown, the value editor, and the
 * evaluator all derive from it without UI/logic edits scattered across
 * the codebase.
 */

import type { Facility } from '../lib/supabase';
import { getSPCCPlanStatus } from './spccStatus';
import { getFacilityPhotosState } from './spccPlans';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CustomRuleValue = string | null;

export interface CustomRule {
  /** Stable client-side id so React keys don't bounce. */
  id: string;
  fieldId: string;
  operatorId: string;
  value: CustomRuleValue;
}

export type ValueInputType = 'none' | 'select' | 'date' | 'text';

export interface CustomFilterOperator {
  id: string;
  label: string;
  /** Tells the UI whether to render a value editor for this operator. */
  needsValue: boolean;
  /** When `needsValue` is true, the kind of editor to render. */
  valueInputType?: ValueInputType;
  /** Choices when valueInputType === 'select'. */
  valueChoices?: { value: string; label: string }[];
}

export interface CustomFilterField {
  id: string;
  label: string;
  /** Used to group fields under headers in the dropdown. */
  group: 'photos' | 'spcc' | 'dates' | 'identity' | 'misc';
  operators: CustomFilterOperator[];
  /** Reads the value from a facility — only used by date/text/numeric
   *  comparisons. Photos and SPCC status fields evaluate via custom
   *  predicates wired in the evaluator below. */
  getValue?: (facility: Facility) => string | null;
}

// ---------------------------------------------------------------------------
// Reusable operator presets
// ---------------------------------------------------------------------------

/** "is set" / "is empty" — for fields where the user typically only cares
 *  whether a value exists, not what it is. */
const PRESENCE_OPS: CustomFilterOperator[] = [
  { id: 'is_set', label: 'is set', needsValue: false },
  { id: 'is_empty', label: 'is empty', needsValue: false },
];

const DATE_OPS: CustomFilterOperator[] = [
  ...PRESENCE_OPS,
  {
    id: 'before',
    label: 'is before',
    needsValue: true,
    valueInputType: 'date',
  },
  {
    id: 'after',
    label: 'is after',
    needsValue: true,
    valueInputType: 'date',
  },
];

// ---------------------------------------------------------------------------
// Field registry
// ---------------------------------------------------------------------------

export const FILTER_FIELDS: CustomFilterField[] = [
  // -- Photos -----------------------------------------------------------------
  {
    id: 'photos_status',
    label: 'Photos Status',
    group: 'photos',
    operators: [
      {
        id: 'is',
        label: 'is',
        needsValue: true,
        valueInputType: 'select',
        valueChoices: [
          { value: 'all', label: 'All berms photographed' },
          {
            value: 'any_missing',
            label: 'Any berm missing photos (incl. partial)',
          },
          { value: 'partial', label: 'Partial — some berms missing' },
          { value: 'none', label: 'No berms photographed' },
        ],
      },
    ],
  },
  // -- SPCC -------------------------------------------------------------------
  {
    id: 'spcc_plan_status',
    label: 'SPCC Plan Status',
    group: 'spcc',
    operators: [
      {
        id: 'is',
        label: 'is',
        needsValue: true,
        valueInputType: 'select',
        valueChoices: [
          { value: 'initial_overdue', label: 'Initial Plan Overdue' },
          { value: 'awaiting_pe_stamp', label: 'Awaiting PE Stamp' },
          { value: 'expired', label: 'Expired' },
          { value: 'expiring', label: 'Expiring Soon' },
          { value: 'renewal_due', label: 'Renewal Due' },
          { value: 'initial_due', label: 'Initial Due' },
          { value: 'no_plan', label: 'No Plan' },
          { value: 'valid', label: 'Valid' },
          { value: 'recertified', label: 'Recertified' },
          { value: 'no_ip_date', label: 'No IP Date' },
        ],
      },
    ],
  },
  {
    id: 'spcc_workflow_status',
    label: 'SPCC Workflow',
    group: 'spcc',
    operators: [
      ...PRESENCE_OPS,
      {
        id: 'is',
        label: 'is',
        needsValue: true,
        valueInputType: 'select',
        valueChoices: [
          { value: 'awaiting_pe_stamp', label: 'Awaiting PE Stamp' },
          { value: 'site_visited', label: 'Site Visited' },
          { value: 'pe_stamped', label: 'PE Stamped' },
          { value: 'completed_uploaded', label: 'Completed / Uploaded' },
        ],
      },
    ],
    getValue: (f) => f.spcc_workflow_status ?? null,
  },
  // -- Dates ------------------------------------------------------------------
  {
    id: 'first_prod_date',
    label: 'Initial Production Date',
    group: 'dates',
    operators: DATE_OPS,
    getValue: (f) => f.first_prod_date ?? null,
  },
  {
    id: 'spcc_pe_stamp_date',
    label: 'PE Stamp Date',
    group: 'dates',
    operators: DATE_OPS,
    getValue: (f) => f.spcc_pe_stamp_date ?? null,
  },
  {
    id: 'field_visit_date',
    label: 'Field Visit Date',
    group: 'dates',
    operators: DATE_OPS,
    getValue: (f) => f.field_visit_date ?? null,
  },
  {
    id: 'recertified_date',
    label: 'Recertified Date',
    group: 'dates',
    operators: DATE_OPS,
    getValue: (f) => f.recertified_date ?? null,
  },
  // -- Identity ---------------------------------------------------------------
  {
    id: 'camino_facility_id',
    label: 'Camino Facility ID',
    group: 'identity',
    operators: [
      ...PRESENCE_OPS,
      {
        id: 'contains',
        label: 'contains',
        needsValue: true,
        valueInputType: 'text',
      },
    ],
    getValue: (f) => f.camino_facility_id ?? null,
  },
  {
    id: 'county',
    label: 'County',
    group: 'identity',
    operators: [
      ...PRESENCE_OPS,
      {
        id: 'contains',
        label: 'contains',
        needsValue: true,
        valueInputType: 'text',
      },
    ],
    getValue: (f) => f.county ?? null,
  },
  // -- Misc -------------------------------------------------------------------
  {
    id: 'estimated_oil_per_day',
    label: 'Est. Oil per Day',
    group: 'misc',
    operators: PRESENCE_OPS,
    getValue: (f) =>
      f.estimated_oil_per_day != null ? String(f.estimated_oil_per_day) : null,
  },
];

export const FIELD_GROUP_LABELS: Record<CustomFilterField['group'], string> = {
  photos: 'Photos',
  spcc: 'SPCC',
  dates: 'Dates',
  identity: 'Facility Info',
  misc: 'Other',
};

export function findField(fieldId: string): CustomFilterField | undefined {
  return FILTER_FIELDS.find((f) => f.id === fieldId);
}

export function findOperator(
  field: CustomFilterField,
  operatorId: string
): CustomFilterOperator | undefined {
  return field.operators.find((o) => o.id === operatorId);
}

// ---------------------------------------------------------------------------
// Rule evaluator
// ---------------------------------------------------------------------------

/** Evaluate a single rule against one facility. Unknown rules pass-through
 *  rather than reject — keeps the list usable if a saved rule references a
 *  field/operator that's been removed from the registry. */
export function evaluateRule(facility: Facility, rule: CustomRule): boolean {
  const field = findField(rule.fieldId);
  if (!field) return true;
  const op = findOperator(field, rule.operatorId);
  if (!op) return true;

  // -- Field-specific predicates that don't fit the simple getValue model.

  if (field.id === 'photos_status' && op.id === 'is') {
    const state = getFacilityPhotosState(facility);
    switch (rule.value) {
      case 'all':
        return state === 'all';
      case 'partial':
        return state === 'partial';
      case 'none':
        return state === 'none';
      case 'any_missing':
        // "Any berm missing photos" — facilities that need a site visit,
        // including partial. This is the headline use case the user
        // described: SPCC overdue + any berm missing photos.
        return state !== 'all';
      default:
        return true;
    }
  }

  if (field.id === 'spcc_plan_status' && op.id === 'is') {
    const result = getSPCCPlanStatus(facility);
    return result.status === rule.value;
  }

  // -- Generic getValue-driven predicates.

  const raw = field.getValue ? field.getValue(facility) : null;

  if (op.id === 'is_set') return raw != null && raw !== '';
  if (op.id === 'is_empty') return raw == null || raw === '';

  if (op.id === 'is') {
    return rule.value != null && raw === rule.value;
  }
  if (op.id === 'is_not') {
    return rule.value != null && raw !== rule.value;
  }

  if (op.id === 'contains') {
    if (rule.value == null || rule.value === '') return true;
    return (
      raw != null && raw.toLowerCase().includes(rule.value.toLowerCase())
    );
  }

  if (op.id === 'before') {
    if (raw == null || rule.value == null) return false;
    return raw < rule.value; // ISO yyyy-mm-dd compares lexically
  }
  if (op.id === 'after') {
    if (raw == null || rule.value == null) return false;
    return raw > rule.value;
  }

  return true;
}

/** AND-combine: a facility must satisfy every rule to pass. Empty rule list
 *  returns true (no constraint). */
export function evaluateAllRules(
  facility: Facility,
  rules: CustomRule[]
): boolean {
  for (const r of rules) {
    if (!evaluateRule(facility, r)) return false;
  }
  return true;
}

/** Tiny helper for `Array.filter` callsites. Captures the rules so the
 *  hot-loop callback doesn't carry them in the closure shape every render. */
export function makeRulesPredicate(rules: CustomRule[]) {
  return (f: Facility) => evaluateAllRules(f, rules);
}

/** Builds a description of the current rule that's safe to render in a
 *  short pill (e.g. "Photos Status is Partial"). Returns null if the rule
 *  is incomplete (no value chosen for an op that needs one). */
export function describeRule(rule: CustomRule): string | null {
  const field = findField(rule.fieldId);
  if (!field) return null;
  const op = findOperator(field, rule.operatorId);
  if (!op) return null;

  if (!op.needsValue) {
    return `${field.label} ${op.label}`;
  }
  if (rule.value == null || rule.value === '') return null;

  // Try to resolve a select value to its human label.
  let valueLabel = rule.value;
  if (op.valueInputType === 'select' && op.valueChoices) {
    const match = op.valueChoices.find((c) => c.value === rule.value);
    if (match) valueLabel = match.label;
  }

  return `${field.label} ${op.label} ${valueLabel}`;
}

/** Crypto.randomUUID() works in modern browsers; cheap fallback for older
 *  envs. ID is only used for React keys + remove-by-id, so it doesn't have
 *  to be cryptographically strong. */
export function newRuleId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof (crypto as any).randomUUID === 'function'
  ) {
    return (crypto as any).randomUUID();
  }
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
