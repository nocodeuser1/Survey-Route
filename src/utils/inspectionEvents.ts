// Events group a question's photos under their own description: "Event 1"
// is the question's existing comments plus every photo not claimed by a
// later event, so inspections saved before events existed read unchanged.
// Later events live in the response JSON and claim photos by id; the photo
// rows themselves (inspection_photos) are untouched.

export interface InspectionEvent {
  id: string;
  description: string;
  photo_ids: string[];
}

interface ResponseWithEvents {
  comments?: string | null;
  events?: InspectionEvent[] | null;
}

export interface EventGroup<P> {
  /** null for the first event, which is stored as the response's comments. */
  eventId: string | null;
  description: string;
  photos: P[];
}

/** The question's events in order, each with its photos (input order kept). */
export function groupResponseEvents<P extends { id: string }>(
  response: ResponseWithEvents | null | undefined,
  photos: readonly P[],
): EventGroup<P>[] {
  const events = response?.events ?? [];
  const ownerByPhoto = new Map<string, string>();
  for (const event of events) {
    for (const photoId of event.photo_ids ?? []) {
      if (!ownerByPhoto.has(photoId)) ownerByPhoto.set(photoId, event.id);
    }
  }
  return [
    { eventId: null, description: response?.comments ?? '', photos: photos.filter((photo) => !ownerByPhoto.has(photo.id)) },
    ...events.map((event) => ({
      eventId: event.id,
      description: event.description ?? '',
      photos: photos.filter((photo) => ownerByPhoto.get(photo.id) === event.id),
    })),
  ];
}

/** Events worth printing: the first always (it may be blank), later ones only if used. */
export function reportableEvents<P>(groups: EventGroup<P>[]): EventGroup<P>[] {
  return groups.filter((group, index) => index === 0 || group.description.trim() !== '' || group.photos.length > 0);
}

export function createInspectionEvent(): InspectionEvent {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return { id: random, description: '', photo_ids: [] };
}

/** Photos attach to an event by id; newest batch first, matching photo order. */
export function claimPhotosForEvent(events: InspectionEvent[] | undefined, eventId: string, photoIds: string[]): InspectionEvent[] {
  return (events ?? []).map((event) =>
    event.id === eventId ? { ...event, photo_ids: [...photoIds, ...event.photo_ids.filter((id) => !photoIds.includes(id))] } : event,
  );
}

export function releasePhoto(events: InspectionEvent[] | undefined, photoId: string): InspectionEvent[] | undefined {
  return events?.map((event) => (event.photo_ids.includes(photoId) ? { ...event, photo_ids: event.photo_ids.filter((id) => id !== photoId) } : event));
}

/** A cloned report starts a new inspection: keep the words, not the source's photos. */
export function stripPhotosForClone<R extends ResponseWithEvents & { photos?: unknown[] }>(response: R): R {
  return {
    ...response,
    photos: [],
    ...(response.events ? { events: response.events.map((event) => ({ ...event, photo_ids: [] })) } : {}),
  };
}
