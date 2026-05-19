import { Plus, X, Filter as FilterIcon } from 'lucide-react';
import {
  FILTER_FIELDS,
  FIELD_GROUP_LABELS,
  findField,
  findOperator,
  getFieldDisplayLabel,
  newRuleId,
  type CustomFilterField,
  type CustomRule,
} from '../utils/customFilters';
import { useFacilityIdLabel } from '../hooks/useFacilityIdLabel';

/**
 * Custom-filter builder rendered inside the Facilities → Filters dropdown.
 *
 * Each rule is three controls — Field, Operator, Value — laid out as a row.
 * Add/remove buttons let the user grow or shrink the rule list. All active
 * rules AND together. The data shape lives in CustomRule[] and is persisted
 * via the Facilities prefs hook.
 *
 * Why split this out: the dropdown is already long and the rule rows have
 * their own state-shape. Keeping the builder in its own file keeps
 * FacilitiesManager.tsx digestible.
 */

interface CustomFilterBuilderProps {
  rules: CustomRule[];
  onChange: (next: CustomRule[]) => void;
}

export default function CustomFilterBuilder({
  rules,
  onChange,
}: CustomFilterBuilderProps) {
  // Brand-aware override for the "Camino Facility ID" field in the rule
  // builder. Threaded down to the row component which renders the
  // <option> list. See useFacilityIdLabel for the fallback rules.
  const brandedFacilityIdLabel = useFacilityIdLabel().long;
  const addRule = () => {
    // Default to the first field with the first operator. The user almost
    // always edits at least one of these on add anyway, so picking sensible
    // defaults keeps the UX one-click.
    const field = FILTER_FIELDS[0];
    const op = field.operators[0];
    onChange([
      ...rules,
      {
        id: newRuleId(),
        fieldId: field.id,
        operatorId: op.id,
        value: null,
      },
    ]);
  };

  const removeRule = (id: string) => {
    onChange(rules.filter((r) => r.id !== id));
  };

  const updateRule = (id: string, patch: Partial<CustomRule>) => {
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  // When the field changes we have to reset the operator + value because
  // the previous values may not be valid for the new field.
  const onFieldChange = (rule: CustomRule, fieldId: string) => {
    const field = findField(fieldId);
    if (!field) return;
    const op = field.operators[0];
    updateRule(rule.id, {
      fieldId,
      operatorId: op.id,
      value: null,
    });
  };

  // When the operator changes, keep the field but clear the value if the
  // new operator doesn't need one (or expects a different input type).
  const onOperatorChange = (rule: CustomRule, operatorId: string) => {
    const field = findField(rule.fieldId);
    if (!field) return;
    const op = findOperator(field, operatorId);
    if (!op) return;
    const prevOp = findOperator(field, rule.operatorId);
    const sameInputType =
      prevOp?.valueInputType === op.valueInputType && op.needsValue;
    updateRule(rule.id, {
      operatorId,
      value: sameInputType ? rule.value : null,
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 inline-flex items-center gap-1.5">
          <FilterIcon className="w-3 h-3" />
          Custom Filters
        </p>
        {rules.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            title="Remove all custom filters"
          >
            Clear all
          </button>
        )}
      </div>

      {rules.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic">
          No custom filters. Click "Add Filter" to combine conditions like
          "SPCC Overdue" + "Any berm missing photos".
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((rule) => (
            <CustomFilterRuleRow
              key={rule.id}
              rule={rule}
              brandedFacilityIdLabel={brandedFacilityIdLabel}
              onFieldChange={(id) => onFieldChange(rule, id)}
              onOperatorChange={(id) => onOperatorChange(rule, id)}
              onValueChange={(v) => updateRule(rule.id, { value: v })}
              onRemove={() => removeRule(rule.id)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addRule}
        className="self-start inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 px-2 py-1 rounded transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Add Filter
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One row in the rule list
// ---------------------------------------------------------------------------

interface RuleRowProps {
  rule: CustomRule;
  /** Brand-aware override forwarded from the parent. Substituted for the
   *  static "Camino Facility ID" label of that one registry entry. */
  brandedFacilityIdLabel?: string;
  onFieldChange: (fieldId: string) => void;
  onOperatorChange: (operatorId: string) => void;
  onValueChange: (value: string | null) => void;
  onRemove: () => void;
}

function CustomFilterRuleRow({
  rule,
  brandedFacilityIdLabel,
  onFieldChange,
  onOperatorChange,
  onValueChange,
  onRemove,
}: RuleRowProps) {
  const field = findField(rule.fieldId);
  const op = field ? findOperator(field, rule.operatorId) : undefined;

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 p-2">
      <div className="flex items-start gap-1.5">
        <div className="flex-1 grid grid-cols-1 gap-1.5">
          {/* Field selector — grouped <optgroup>s so it reads nicely as the
              registry grows. */}
          <select
            value={rule.fieldId}
            onChange={(e) => onFieldChange(e.target.value)}
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            title="Choose the field to filter on"
          >
            {groupFields().map(([group, fields]) => (
              <optgroup
                key={group}
                label={FIELD_GROUP_LABELS[group as CustomFilterField['group']]}
              >
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {getFieldDisplayLabel(f, brandedFacilityIdLabel)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          {/* Operator + Value — placed side-by-side on wider rows. */}
          <div className="flex items-center gap-1.5">
            {field && (
              <select
                value={rule.operatorId}
                onChange={(e) => onOperatorChange(e.target.value)}
                className="flex-shrink-0 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                title="Choose how to compare"
              >
                {field.operators.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
            {op?.needsValue && (
              <RuleValueInput
                op={op}
                value={rule.value}
                onChange={onValueChange}
              />
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
          title="Remove this filter"
          aria-label="Remove filter"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Value editor — shape determined by the operator's valueInputType
// ---------------------------------------------------------------------------

function RuleValueInput({
  op,
  value,
  onChange,
}: {
  op: NonNullable<ReturnType<typeof findOperator>>;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const baseClass =
    'min-w-0 flex-1 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500';

  if (op.valueInputType === 'select' && op.valueChoices) {
    return (
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={baseClass}
      >
        <option value="">Choose…</option>
        {op.valueChoices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    );
  }

  if (op.valueInputType === 'date') {
    return (
      <input
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={baseClass}
      />
    );
  }

  // text fallback
  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      placeholder="Value…"
      className={baseClass}
    />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Group the registry by `group` so the field <select> can use <optgroup>. */
function groupFields(): [string, CustomFilterField[]][] {
  const map = new Map<string, CustomFilterField[]>();
  for (const f of FILTER_FIELDS) {
    if (!map.has(f.group)) map.set(f.group, []);
    map.get(f.group)!.push(f);
  }
  return Array.from(map.entries());
}
