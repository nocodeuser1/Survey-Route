export interface InspectionIdentityInput {
  fullName?: string | null;
  inspectionEmail?: string | null;
}

export function normalizeInspectionIdentity(input: InspectionIdentityInput) {
  return {
    fullName: input.fullName?.trim() || '',
    inspectionEmail: input.inspectionEmail?.trim().toLowerCase() || null,
  };
}

export function resolveInspectionIdentity(
  profile: InspectionIdentityInput | null | undefined,
  signatureName?: string | null,
  existingInspectorName?: string | null,
) {
  const normalized = normalizeInspectionIdentity(profile || {});
  return {
    inspectorName:
      normalized.fullName ||
      signatureName?.trim() ||
      existingInspectorName?.trim() ||
      'Draft',
    inspectorEmail: normalized.inspectionEmail,
  };
}

interface StoredAuthorship {
  inspector_name?: string | null;
  inspector_email?: string | null;
}

/**
 * Name and email written on a save. Drafts are shared across the workspace:
 * while anyone edits one it keeps the name of whoever started it, so others
 * can see whose draft it is. Submitting always records the submitter, who
 * signs it, never the person who started the draft.
 */
export function inspectionAuthorship(
  status: 'draft' | 'completed',
  me: { inspectorName: string; inspectorEmail: string | null },
  existingDraft?: StoredAuthorship | null,
) {
  const starter = existingDraft?.inspector_name?.trim();
  if (status === 'completed' || !starter || starter === 'Draft') return me;
  return { inspectorName: starter, inspectorEmail: existingDraft?.inspector_email ?? null };
}
