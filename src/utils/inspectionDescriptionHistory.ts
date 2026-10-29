import type { InspectionResponse } from '../lib/supabase';

export interface RecentInspectionDescription {
  text: string;
  usedAt: string;
}

export type InspectionDescriptionHistory = Record<string, RecentInspectionDescription[]>;

export const MAX_RECENT_DESCRIPTIONS_PER_QUESTION = 8;

interface InspectionDescriptionSource {
  responses?: InspectionResponse[] | null;
  updated_at?: string | null;
}

const comparisonKey = (text: string) => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

function candidatesFromResponses(responses: InspectionResponse[] | null | undefined, usedAt: string) {
  const candidates: Array<{ questionId: string; text: string; usedAt: string }> = [];
  for (const response of responses ?? []) {
    if (response.answer !== 'no') continue;
    candidates.push({ questionId: response.question_id, text: response.comments, usedAt });
    for (const event of response.events ?? []) {
      candidates.push({ questionId: response.question_id, text: event.description, usedAt });
    }
  }
  return candidates.filter(candidate => candidate.text.trim().length > 0);
}

export function mergeInspectionDescriptionHistory(
  history: InspectionDescriptionHistory,
  candidates: ReadonlyArray<{ questionId: string; text: string; usedAt: string }>,
): InspectionDescriptionHistory {
  const next: InspectionDescriptionHistory = {};
  const questionIds = new Set([...Object.keys(history), ...candidates.map(candidate => candidate.questionId)]);

  for (const questionId of questionIds) {
    const combined = [
      ...(history[questionId] ?? []),
      ...candidates
        .filter(candidate => candidate.questionId === questionId)
        .map(candidate => ({ text: candidate.text.trim(), usedAt: candidate.usedAt })),
    ].filter(entry => entry.text.trim().length > 0 && !Number.isNaN(new Date(entry.usedAt).getTime()));

    const newestByText = new Map<string, RecentInspectionDescription>();
    for (const entry of combined) {
      const key = comparisonKey(entry.text);
      const current = newestByText.get(key);
      if (!current || new Date(entry.usedAt).getTime() > new Date(current.usedAt).getTime()) {
        newestByText.set(key, { text: entry.text.trim(), usedAt: entry.usedAt });
      }
    }
    const entries = [...newestByText.values()]
      .sort((a, b) => new Date(b.usedAt).getTime() - new Date(a.usedAt).getTime())
      .slice(0, MAX_RECENT_DESCRIPTIONS_PER_QUESTION);
    if (entries.length > 0) next[questionId] = entries;
  }

  return next;
}

export function collectInspectionDescriptionHistory(rows: InspectionDescriptionSource[]): InspectionDescriptionHistory {
  const candidates = rows.flatMap(row => candidatesFromResponses(row.responses, row.updated_at ?? new Date(0).toISOString()));
  return mergeInspectionDescriptionHistory({}, candidates);
}

export function rememberInspectionDescription(
  history: InspectionDescriptionHistory,
  questionId: string,
  text: string,
  usedAt = new Date().toISOString(),
): InspectionDescriptionHistory {
  return mergeInspectionDescriptionHistory(history, [{ questionId, text, usedAt }]);
}

export function parseInspectionDescriptionHistory(value: string | null): InspectionDescriptionHistory {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as InspectionDescriptionHistory;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const candidates = Object.entries(parsed).flatMap(([questionId, entries]) =>
      Array.isArray(entries)
        ? entries
          .filter(entry => entry && typeof entry.text === 'string' && typeof entry.usedAt === 'string')
          .map(entry => ({ questionId, text: entry.text, usedAt: entry.usedAt }))
        : [],
    );
    return mergeInspectionDescriptionHistory({}, candidates);
  } catch {
    return {};
  }
}
