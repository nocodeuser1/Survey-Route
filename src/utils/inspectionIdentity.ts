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
