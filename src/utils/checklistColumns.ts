import { getContainerInventory, inventorySummary } from './containerInventory.ts';
import {
  DAY_TANKS_ITEM_ID,
  DRUMS_ITEM_ID,
  DRAIN_VALVES_ITEM_ID,
  getChecklistAnswer,
  isInventoryItem,
  isYesNoItem,
  normalizeProgress,
  type ChecklistItem,
  type ChecklistProgress,
} from './siteVisitChecklist.ts';

export type ChecklistColumnId = `checklist:${string}`;
export interface ChecklistColumn {
  id: ChecklistColumnId;
  label: string;
  /** The template wording is searchable even when the column has a short label. */
  searchText: string;
  kind: 'answer' | 'completion' | 'text' | 'number' | 'date';
  getValue: (progress: ChecklistProgress) => string | number | null;
}

/** Namespaced, stable IDs keep renames from resetting a user's column layout. */
export const checklistColumnId = (itemId: string, field = 'answer'): ChecklistColumnId =>
  `checklist:${encodeURIComponent(itemId)}:${field}`;

/** All values come from the same visit-bound metadata the checklist itself reads. */
export function buildChecklistColumns(items: ChecklistItem[]): ChecklistColumn[] {
  const columns: ChecklistColumn[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const inventory = isInventoryItem(item);
    const yesNo = inventory || isYesNoItem(item);
    const name = item.id === DRUMS_ITEM_ID ? 'Drums'
      : item.id === DAY_TANKS_ITEM_ID ? 'Day Tanks'
      : item.id === DRAIN_VALVES_ITEM_ID ? 'Berm Drain Valves'
      : item.label;
    const add = (field: string, label: string, kind: ChecklistColumn['kind'], getValue: ChecklistColumn['getValue']) => {
      columns.push({ id: checklistColumnId(item.id, field), label, searchText: `Checklist ${item.label} ${label}`, kind, getValue });
    };
    add('answer', yesNo ? `${name} Present` : `Checklist: ${item.label}`, yesNo ? 'answer' : 'completion', progress => {
      if (!yesNo) return progress[item.id] ? 'Completed' : 'Not completed';
      const answer = getChecklistAnswer(progress, item.id);
      return answer === 'yes' ? 'Yes' : answer === 'no' ? 'No' : null;
    });
    if (inventory) {
      add('inventory', `${name} Sizes & Quantities`, 'text', progress => {
        const value = getContainerInventory(progress, item.id);
        return value ? inventorySummary(value) : null;
      });
      add('quantity', `${name} Total Quantity`, 'number', progress => {
        const value = getContainerInventory(progress, item.id);
        if (!value || (value.answer === 'yes' && !value.containers.length)) return null;
        return value.containers.reduce((total, row) => total + row.quantity, 0);
      });
      add('gallons', `${name} Total Gallons`, 'number', progress => {
        const value = getContainerInventory(progress, item.id);
        if (!value || (value.answer === 'yes' && !value.containers.length)) return null;
        return value.containers.reduce((total, row) => total + row.gallons * row.quantity, 0);
      });
      if (item.id === DAY_TANKS_ITEM_ID) {
        add('fluids', 'Day Tank Fluid Descriptions', 'text', progress => {
          const value = getContainerInventory(progress, item.id);
          if (!value) return null;
          if (value.answer === 'no') return 'No';
          if (!value.containers.length) return 'Details not recorded';
          return value.containers.map(row => `${row.contents || 'Description not recorded'} (${row.gallons} gal × ${row.quantity})`).join(' · ');
        });
      }
    }
    // Include the saved completion/answer time rather than dropping this part
    // of the data. A legacy presence tick is not an answered Yes/No response.
    add('completed_at', `${name} ${yesNo ? 'Answered At' : 'Completed At'}`, 'date', progress => {
      if (yesNo && !getChecklistAnswer(progress, item.id)) return null;
      const at = progress[item.id];
      return at && Number.isFinite(Date.parse(at)) ? at : null;
    });
  }
  return columns;
}

export function getChecklistColumnValue(column: ChecklistColumn, rawProgress: unknown): string | number | null {
  return column.getValue(normalizeProgress(rawProgress));
}

/** Shared by cells, search, CSV, XLSX, and clipboard output; never emits JSON. */
export function getChecklistColumnText(column: ChecklistColumn, rawProgress: unknown): string {
  const value = getChecklistColumnValue(column, rawProgress);
  if (value !== null) return String(value);
  return column.kind === 'answer' ? 'Unanswered' : 'Not recorded';
}

export function checklistMatchesSearch(columns: ChecklistColumn[], rawProgress: unknown, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return columns.some(column => `${column.label} ${getChecklistColumnText(column, rawProgress)}`.toLowerCase().includes(normalized));
}

/** Feed the existing filter builder/evaluator instead of creating a second UI. */
export function buildChecklistFilterFields(columns: ChecklistColumn[]): import('./customFilters').CustomFilterField[] {
  return columns.map(column => {
    const presence: import('./customFilters').CustomFilterOperator[] = [
      { id: 'is_set', label: 'is recorded', needsValue: false },
      { id: 'is_empty', label: 'is not recorded', needsValue: false },
    ];
    const choices = column.kind === 'answer' ? ['Yes', 'No'] : ['Completed', 'Not completed'];
    const operators: import('./customFilters').CustomFilterOperator[] = column.kind === 'answer' || column.kind === 'completion'
      ? [{ id: 'is', label: 'is', needsValue: true, valueInputType: 'select', valueChoices: choices.map(value => ({ value, label: value })) }, ...presence]
      : column.kind === 'number'
      ? [
        ...presence,
        { id: 'number_equal', label: 'equals', needsValue: true, valueInputType: 'number' },
        { id: 'number_greater', label: 'is greater than', needsValue: true, valueInputType: 'number' },
        { id: 'number_less', label: 'is less than', needsValue: true, valueInputType: 'number' },
      ]
      : column.kind === 'date'
      ? [
        ...presence,
        { id: 'before', label: 'is before', needsValue: true, valueInputType: 'date' },
        { id: 'after', label: 'is after', needsValue: true, valueInputType: 'date' },
      ]
      : [...presence, { id: 'contains', label: 'contains', needsValue: true, valueInputType: 'text' }];
    return {
      id: column.id, label: column.label, group: 'checklist', operators,
      getValue: facility => {
        const value = getChecklistColumnValue(column, facility.site_visit_checklist_progress);
        return value === null ? null : column.kind === 'date' ? String(value).slice(0, 10) : String(value);
      },
    };
  });
}
