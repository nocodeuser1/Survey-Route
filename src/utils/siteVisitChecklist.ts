import { getContainerInventory } from './containerInventory.ts';
/**
 * Site-visit checklist — what a tech confirms while standing at a facility.
 *
 * Two pieces of state, deliberately kept apart:
 *
 *   accounts.site_visit_checklist          the account's template (the items)
 *   facilities.site_visit_checklist_progress   which items are done, per facility
 *
 * Progress is keyed by item id rather than storing a copy of the template on
 * each facility. So when the template is edited in Settings, every facility
 * immediately reflects the new list: added items show up unchecked, removed
 * items disappear, and anything still on the list keeps the tick it already
 * had. A per-facility snapshot would instead freeze each site on whatever
 * the list looked like the first time someone opened it.
 */

export interface ChecklistItem {
  /** Stable key. Progress is stored against this, so never reuse or rewrite
   *  an id when renaming an item — rename the label and keep the id. */
  id: string;
  label: string;
}

/**
 * itemId -> ISO completion timestamp. Reserved `__answer:<itemId>` keys hold
 * JSON-encoded Yes/No responses. Keep every value a string: older web/native
 * clients discard object values when saving an unrelated checkbox.
 */
export type ChecklistProgress = Record<string, string | undefined>;

export type ChecklistAnswer = 'yes' | 'no';
export const DRUMS_ITEM_ID = 'containers_over_55';
export const DAY_TANKS_ITEM_ID = 'day_tanks_inventory';
export const isInventoryItem = (item: ChecklistItem) => item.id === DRUMS_ITEM_ID || item.id === DAY_TANKS_ITEM_ID;
export const DRAIN_VALVES_ITEM_ID = 'drain_valves_presence';

const answerKey = (itemId: string) => `__answer:${itemId}`;

/** Stable ids also upgrade templates saved before Yes/No was introduced. */
export function isYesNoItem(item: ChecklistItem): boolean {
  return item.id === DRAIN_VALVES_ITEM_ID;
}

export function getChecklistAnswer(progress: ChecklistProgress, itemId: string): ChecklistAnswer | null {
  const raw = progress[answerKey(itemId)];
  if (!raw) return null;
  try {
    const response: unknown = JSON.parse(raw);
    if (!response || typeof response !== 'object') return null;
    const { answer, answeredAt } = response as Record<string, unknown>;
    // Bind the answer to this visit's completion timestamp. An old client
    // clearing/rechecking the checkbox must not revive a previous answer.
    return (answer === 'yes' || answer === 'no')
      && typeof answeredAt === 'string'
      && Number.isFinite(Date.parse(answeredAt))
      && answeredAt === progress[itemId]
      ? answer : null;
  } catch {
    return null;
  }
}

/** Set/clear one response without touching other items or legacy records. */
export function setChecklistAnswer(
  progress: ChecklistProgress,
  itemId: string,
  answer: ChecklistAnswer | null,
  answeredAt = new Date().toISOString(),
): ChecklistProgress {
  const next = { ...progress };
  if (answer === null) {
    delete next[itemId];
    delete next[answerKey(itemId)];
  } else {
    next[itemId] = answeredAt;
    next[answerKey(itemId)] = JSON.stringify({ answer, answeredAt });
  }
  return next;
}

/**
 * The out-of-the-box list, derived from Israel's 2026-09-23 "West Wichita
 * Field Work" scope email to Sheila Baber. Accounts that have never saved a
 * template get this.
 */
export const DEFAULT_SITE_VISIT_CHECKLIST: ChecklistItem[] = [
  { id: DRUMS_ITEM_ID, label: 'Are drums present on site?' },
  { id: DAY_TANKS_ITEM_ID, label: 'Are day tanks present on site?' },
  { id: 'containment_measurements', label: 'Record containment measurements for each container' },
  { id: 'berm_dimensions', label: 'Measure berm dimensions (length, width, depth)' },
  { id: DRAIN_VALVES_ITEM_ID, label: 'Are drain valves present on the berms?' },
  { id: 'drain_valve_condition', label: 'Photograph condition and position of any drain valves present' },
  { id: 'ground_photos', label: 'Take updated ground photos' },
  { id: 'aerial_photos', label: 'Take updated drone / aerial photos' },
  { id: 'tank_plates', label: 'Photograph tank plates' },
  { id: 'related_equipment', label: 'Photograph related equipment' },
];

/** Tolerant of nulls and of rows written before this feature existed. */
export function normalizeChecklist(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) return DEFAULT_SITE_VISIT_CHECKLIST;
  const items = raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({ id: String(r.id ?? '').trim(), label: String(r.label ?? '').trim() }))
    .filter((r) => r.id && r.label && !r.id.startsWith('__answer:') && !r.id.startsWith('__inventory:'));
  // An account that deliberately saved an empty list keeps it empty; only a
  // malformed/missing value falls back to the defaults.
  if (raw.length > 0 && items.length === 0) return DEFAULT_SITE_VISIT_CHECKLIST;
  const index = items.findIndex(item => item.id === DRUMS_ITEM_ID);
  if (index >= 0) {
    items[index] = { ...items[index], label: 'Are drums present on site?' };
    if (!items.some(item => item.id === DAY_TANKS_ITEM_ID)) items.splice(index + 1, 0, { id: DAY_TANKS_ITEM_ID, label: 'Are day tanks present on site?' });
  }
  return items;
}

export function normalizeProgress(raw: unknown): ChecklistProgress {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: ChecklistProgress = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

export function countDone(items: ChecklistItem[], progress: ChecklistProgress): number {
  return items.reduce((n, item) => {
    const done = isInventoryItem(item)
      ? getContainerInventory(progress, item.id) !== null
      : isYesNoItem(item)
      ? getChecklistAnswer(progress, item.id) !== null
      : !!progress[item.id];
    return done ? n + 1 : n;
  }, 0);
}

/** Slugged id from a label, uniquified against ids already in use. */
export function makeItemId(label: string, taken: Set<string>): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'item';
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
