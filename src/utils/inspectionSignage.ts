import { escapeHtml } from './escapeHtml.ts';

/** Reserved attachment slot, not a template answer. Uses existing photo RLS. */
export const FACILITY_SIGNAGE_QUESTION_ID = '__facility_signage__';

export interface SignagePhoto {
  id: string;
  question_id: string;
  photo_url: string;
  created_at?: string;
}

/** Deterministic selection also handles older clients/concurrent uploads. */
export function getFacilitySignagePhoto<T extends SignagePhoto>(photos: readonly T[]): T | undefined {
  return photos.filter(photo => photo.question_id === FACILITY_SIGNAGE_QUESTION_ID)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || b.id.localeCompare(a.id))[0];
}

/** Select before downloads: a failed replacement must not revive an older image. */
export function reportPhotosWithLatestSignage<T extends SignagePhoto & { inspection_id: string }>(photos: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const photo of photos) {
    if (photo.question_id !== FACILITY_SIGNAGE_QUESTION_ID) continue;
    const previous = latest.get(photo.inspection_id);
    latest.set(photo.inspection_id, getFacilitySignagePhoto(previous ? [previous, photo] : [photo])!);
  }
  return photos.filter(photo => photo.question_id !== FACILITY_SIGNAGE_QUESTION_ID || latest.get(photo.inspection_id)?.id === photo.id);
}

export function renderFacilitySignageHtml(photos: readonly SignagePhoto[]): string {
  const photo = getFacilitySignagePhoto(photos);
  // Callers resolve private storage paths before rendering. Never emit raw paths
  // or active-content data URLs into a downloadable report.
  if (!photo || !/^(?:https:\/\/|data:image\/(?:jpeg|png|webp|gif);base64,)/i.test(photo.photo_url)) return '';
  return `<figure class="facility-signage"><figcaption>Facility signage</figcaption><img src="${escapeHtml(photo.photo_url)}" alt="Facility signage" onerror="this.closest('figure').remove()" /></figure>`;
}

/** Shared by standalone, combined, ZIP and bulk HTML / browser-print PDFs. */
export const facilitySignageCss = `
  .facility-signage { margin: 16px 0; break-inside: avoid; page-break-inside: avoid; }
  .facility-signage figcaption { color: #6b7280; font-size: 11px; font-weight: 600; margin-bottom: 6px; }
  .facility-signage img { display: block; width: auto; height: auto; max-width: min(220px, 100%); max-height: 140px; object-fit: contain; border: 1px solid #e5e7eb; border-radius: 4px; }
`;
