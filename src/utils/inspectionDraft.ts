export function resolveInspectionInspectorName(
  signatureName?: string | null,
  existingInspectorName?: string | null,
): string {
  return signatureName?.trim() || existingInspectorName?.trim() || 'Draft';
}

interface DraftLike {
  facility_id: string;
  status: string;
  updated_at?: string | null;
  created_at?: string | null;
}

const time = (value?: string | null) => {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
};

/** Most recently saved unsubmitted draft for a facility, if any. */
export function pickLatestDraft<T extends DraftLike>(inspections: readonly T[], facilityId: string): T | null {
  let latest: T | null = null;
  for (const inspection of inspections) {
    if (inspection.facility_id !== facilityId || inspection.status !== 'draft') continue;
    if (!latest || time(inspection.updated_at ?? inspection.created_at) > time(latest.updated_at ?? latest.created_at)) {
      latest = inspection;
    }
  }
  return latest;
}

interface SavedResponse {
  question_id: string;
}

/**
 * One response per template question, in template order. Saved answers are
 * matched by question id, so a draft saved against an older template still
 * opens with every answer it has a question for.
 */
export function alignResponses<R extends SavedResponse>(
  questions: readonly { id: string }[],
  saved: readonly R[] | null | undefined,
  blank: (questionId: string) => R,
): R[] {
  const byQuestion = new Map((saved ?? []).map((response) => [response.question_id, response]));
  return questions.map((question) => byQuestion.get(question.id) ?? blank(question.id));
}

/**
 * Device backups are written right after every server autosave, so a backup
 * only counts as newer when it is meaningfully newer than the server copy.
 */
export function isDeviceBackupNewer(backupSavedAt: string, draftUpdatedAt?: string | null): boolean {
  return time(backupSavedAt) - time(draftUpdatedAt) > 5000;
}

/** "Today 9:14 AM", "Yesterday 4:02 PM", or "Oct 27, 4:02 PM". */
export function formatDraftTimestamp(value: string | Date, now: Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return 'unknown';
  const clock = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (days === 0) return `Today ${clock}`;
  if (days === 1) return `Yesterday ${clock}`;
  const day = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
  return `${day}, ${clock}`;
}

/** Who started a shared draft; its stored name stays theirs until submitted. */
export function draftStarterName(draft: { inspector_name?: string | null }): string | null {
  const name = draft.inspector_name?.trim();
  return name && name !== 'Draft' ? name : null;
}
