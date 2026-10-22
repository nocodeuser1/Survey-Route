import { getChecklistAnswer, setChecklistAnswer, type ChecklistProgress } from './siteVisitChecklist.ts';

export interface ContainerCount { gallons: number; quantity: number; contents?: string }
export interface ContainerInventory { answer: 'yes' | 'no'; containers: ContainerCount[] }
const inventoryKey = (id: string) => `__inventory:${id}`;

export function validateContainerCounts(rows: ContainerCount[]): string | null {
  if (rows.length > 50) return 'Use no more than 50 sizes.';
  const seen = new Set<string>();
  for (const row of rows) {
    if (!Number.isFinite(row.gallons) || row.gallons <= 0 || row.gallons > 1000000) return 'Enter a size greater than zero in gallons.';
    if (!Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 1000000) return 'Enter a whole-number quantity greater than zero.';
    if (row.contents !== undefined && (typeof row.contents !== 'string' || !row.contents.trim() || row.contents.length > 120)) return 'Enter a description up to 120 characters.';
    const key = `${row.gallons}:${(row.contents || '').trim().toLowerCase()}`;
    if (seen.has(key)) return 'Combine quantities for the same size into one row.';
    seen.add(key);
  }
  return null;
}

export function getContainerInventory(progress: ChecklistProgress, id: string): ContainerInventory | null {
  const answer = getChecklistAnswer(progress, id);
  if (answer === 'no') return { answer, containers: [] };
  if (answer !== 'yes') return null;
  // Presence is an independent saved answer, even if no details were entered.
  const presenceOnly: ContainerInventory = { answer, containers: [] };
  try {
    const value = JSON.parse(progress[inventoryKey(id)] || 'null');
    if (!value || value.recordedAt !== progress[id] || !Array.isArray(value.containers)) return presenceOnly;
    const rows: ContainerCount[] = value.containers.map((row: ContainerCount) => ({ gallons: row?.gallons, quantity: row?.quantity, ...(row?.contents ? { contents: row.contents } : {}) }));
    if (validateContainerCounts(rows)) return presenceOnly;
    return { answer, containers: rows };
  } catch { return presenceOnly; }
}

export function setContainerInventory(progress: ChecklistProgress, id: string, value: ContainerInventory | null, at = new Date().toISOString()): ChecklistProgress {
  if (value?.answer === 'yes') {
    const error = validateContainerCounts(value.containers);
    if (error) throw new Error(error);
  }
  const next = setChecklistAnswer(progress, id, value?.answer ?? null, at);
  delete next[inventoryKey(id)];
  if (value?.answer === 'yes' && value.containers.length) next[inventoryKey(id)] = JSON.stringify({ recordedAt: at, containers: value.containers });
  return next;
}

export function inventorySummary(value: ContainerInventory): string {
  return value.answer === 'no' ? 'No' : !value.containers.length ? 'Yes · details not recorded' : value.containers.map(row => `${row.gallons.toLocaleString()} gal × ${row.quantity.toLocaleString()}${row.contents ? ` (${row.contents})` : ''}`).join(' · ');
}
