export function resolveInspectionInspectorName(
  signatureName?: string | null,
  existingInspectorName?: string | null,
): string {
  return signatureName?.trim() || existingInspectorName?.trim() || 'Draft';
}
