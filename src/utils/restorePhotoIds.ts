// Restoring a backup re-inserts inspection_photos rows, so every photo gets a
// new id. Events (response.events[].photo_ids) reference photos by id; without
// remapping, every restored photo would fall back to Event 1.

import type { InspectionEvent } from './inspectionEvents.ts';

interface ResponseWithEvents {
  events?: InspectionEvent[] | null;
}

/**
 * Rewrites event photo ids from the backup's ids to the restored ones. Ids
 * with no restored photo (upload failed, file missing from the zip) are
 * dropped. Returns null when nothing changed, so callers can skip the update.
 */
export function remapResponsePhotoIds<R extends ResponseWithEvents>(
  responses: readonly R[] | null | undefined,
  photoIdMap: ReadonlyMap<string, string>,
): R[] | null {
  if (!Array.isArray(responses)) return null;
  let changed = false;
  const remapped = responses.map((response) => {
    const original: InspectionEvent[] = response?.events ?? [];
    if (original.length === 0) return response;
    const events = original.map((event: InspectionEvent) => {
      const oldIds: string[] = event.photo_ids ?? [];
      const photoIds = oldIds.flatMap((oldId: string) => {
        const newId = photoIdMap.get(oldId);
        return newId ? [newId] : [];
      });
      if (photoIds.length !== oldIds.length || photoIds.some((id, i) => id !== oldIds[i])) {
        changed = true;
      }
      return { ...event, photo_ids: photoIds };
    });
    return { ...response, events };
  });
  return changed ? remapped : null;
}
