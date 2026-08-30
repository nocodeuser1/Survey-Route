import type { PhotoVisitEvent, PhotoVisitEventRevision } from '../lib/supabase';
import { instantToZonedParts } from './dateUtils';

export interface EffectivePhotoHistoryItem {
  event: PhotoVisitEvent;
  /** All immutable events in this correction group, parents before children. */
  chainEvents: PhotoVisitEvent[];
  latestRevision: PhotoVisitEventRevision | null;
  occurredOn: string | null;
  occurredTime: string | null;
  deleted: boolean;
  corrected: boolean;
}

/**
 * Resolve the append-only photo ledger into the records a user should see.
 * Timestamp-correction events supersede their original events, while admin
 * revisions alter the effective date or tombstone a record without erasing it.
 */
export function resolveEffectivePhotoHistory(
  events: PhotoVisitEvent[],
  revisions: PhotoVisitEventRevision[],
): EffectivePhotoHistoryItem[] {
  // A route reopen is an audit fact about the outing checklist, not a
  // correction to the physical photo occurrence. Timestamp corrections form
  // a version chain. Resolve each connected chain to its most recently
  // recorded leaf so older data that accidentally branched cannot surface two
  // effective occurrences or win Latest Photos Date.
  const historyEvents = events.filter(event => event.event_type !== 'route_reopened');
  const eventsById = new Map(historyEvents.map(event => [event.id, event]));
  const rootIdFor = (event: PhotoVisitEvent): string => {
    let current = event;
    const seen = new Set<string>([event.id]);
    while (current.supersedes_event_id) {
      const parent = eventsById.get(current.supersedes_event_id);
      if (
        !parent ||
        seen.has(parent.id) ||
        parent.account_id !== current.account_id ||
        parent.facility_id !== current.facility_id
      ) break;
      seen.add(parent.id);
      current = parent;
    }
    return current.id;
  };
  const eventsByRoot = new Map<string, PhotoVisitEvent[]>();
  for (const event of historyEvents) {
    const rootId = rootIdFor(event);
    const group = eventsByRoot.get(rootId) || [];
    group.push(event);
    eventsByRoot.set(rootId, group);
  }

  // A transaction gives every automatic correction the same recorded_at, so
  // timestamp/UUID ordering alone can select an ancestor at random. Only
  // structural leaves are eligible to represent a physical occurrence. The
  // recorded fields are a deterministic tie-breaker for old branched data.
  const effectiveEventByRoot = new Map<string, PhotoVisitEvent>();
  const orderedEventsByRoot = new Map<string, PhotoVisitEvent[]>();
  for (const [rootId, group] of eventsByRoot) {
    const groupIds = new Set(group.map(event => event.id));
    const parentIds = new Set(
      group
        .map(event => event.supersedes_event_id)
        .filter((id): id is string => Boolean(id) && groupIds.has(id as string)),
    );
    const leaves = group.filter(event => !parentIds.has(event.id));
    const candidates = leaves.length > 0 ? leaves : group;
    const effective = candidates.slice().sort(
      (a, b) => b.recorded_at.localeCompare(a.recorded_at) || b.id.localeCompare(a.id),
    )[0];
    effectiveEventByRoot.set(rootId, effective);

    const depthFor = (event: PhotoVisitEvent): number => {
      let depth = 0;
      let current = event;
      const seen = new Set<string>([event.id]);
      while (current.supersedes_event_id && groupIds.has(current.supersedes_event_id)) {
        const parent = eventsById.get(current.supersedes_event_id);
        if (!parent || seen.has(parent.id)) break;
        seen.add(parent.id);
        current = parent;
        depth += 1;
      }
      return depth;
    };
    orderedEventsByRoot.set(
      rootId,
      group.slice().sort((a, b) =>
        depthFor(a) - depthFor(b)
        || a.recorded_at.localeCompare(b.recorded_at)
        || a.id.localeCompare(b.id)),
    );
  }
  const latestByEvent = new Map<string, PhotoVisitEventRevision>();

  for (const revision of revisions) {
    const current = latestByEvent.get(revision.event_id);
    if (
      !current ||
      revision.changed_at > current.changed_at ||
      (revision.changed_at === current.changed_at && revision.id > current.id)
    ) {
      latestByEvent.set(revision.event_id, revision);
    }
  }

  return Array.from(effectiveEventByRoot.entries())
    .map(([rootId, event]) => {
      const latestRevision = latestByEvent.get(event.id) || null;
      const chainEvents = orderedEventsByRoot.get(rootId) || [event];
      let occurredOn: string | null = event.occurred_on || null;
      let occurredTime = event.occurred_time || null;

      if (!occurredOn && event.occurred_at) {
        const parts = instantToZonedParts(event.occurred_at, event.account_timezone || undefined);
        occurredOn = parts.date;
        occurredTime = occurredTime || parts.time;
      }
      if (latestRevision?.action === 'edit') {
        occurredOn = latestRevision.occurred_on || occurredOn;
        occurredTime = latestRevision.occurred_time || null;
      } else if (latestRevision?.action === 'delete') {
        const previousOn = latestRevision.previous_values?.occurred_on;
        const previousTime = latestRevision.previous_values?.occurred_time;
        if (typeof previousOn === 'string' && previousOn) occurredOn = previousOn;
        occurredTime = typeof previousTime === 'string' && previousTime ? previousTime : null;
      }

      return {
        event,
        chainEvents,
        latestRevision,
        occurredOn,
        occurredTime,
        deleted: latestRevision?.action === 'delete',
        corrected: chainEvents.length > 1 || latestRevision?.action === 'edit',
      };
    })
    .sort((a, b) => {
      if (a.occurredOn && !b.occurredOn) return -1;
      if (!a.occurredOn && b.occurredOn) return 1;
      const aKey = `${a.occurredOn}T${a.occurredTime || '00:00'}`;
      const bKey = `${b.occurredOn}T${b.occurredTime || '00:00'}`;
      return bKey.localeCompare(aKey) || b.event.recorded_at.localeCompare(a.event.recorded_at);
    });
}

export function getLatestPhotoDatesByFacility(
  events: PhotoVisitEvent[],
  revisions: PhotoVisitEventRevision[],
): Map<string, string> {
  const latestDates = new Map<string, string>();
  for (const item of resolveEffectivePhotoHistory(events, revisions)) {
    const facilityId = item.event.facility_id;
    if (!item.deleted && facilityId && item.occurredOn && !latestDates.has(facilityId)) {
      latestDates.set(facilityId, item.occurredOn);
    }
  }
  return latestDates;
}

/**
 * Facilities that have a real base record in the photo ledger, including
 * records currently hidden by an admin tombstone. Consumers use this to
 * distinguish "the ledger has no record yet" from "the ledger record was
 * deliberately removed from active history". Route-reopen audit events alone
 * do not establish a physical photo visit.
 */
export function getFacilitiesWithPhotoHistory(
  events: PhotoVisitEvent[],
): Set<string> {
  return new Set(
    events
      .filter(event => event.event_type !== 'route_reopened' && Boolean(event.facility_id))
      .map(event => event.facility_id as string),
  );
}
