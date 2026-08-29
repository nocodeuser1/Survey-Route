import type { PhotoVisitEvent, PhotoVisitEventRevision } from '../lib/supabase';
import { instantToZonedParts } from './dateUtils';

export interface EffectivePhotoHistoryItem {
  event: PhotoVisitEvent;
  latestRevision: PhotoVisitEventRevision | null;
  occurredOn: string;
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
  const supersededIds = new Set(
    events.map(event => event.supersedes_event_id).filter((id): id is string => Boolean(id)),
  );
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

  return events
    .filter(event => event.event_type !== 'route_reopened' && !supersededIds.has(event.id))
    .map(event => {
      const latestRevision = latestByEvent.get(event.id) || null;
      let occurredOn = event.occurred_on || '';
      let occurredTime = event.occurred_time || null;

      if (!occurredOn && event.occurred_at) {
        const parts = instantToZonedParts(event.occurred_at, event.account_timezone || undefined);
        occurredOn = parts.date;
        occurredTime = occurredTime || parts.time;
      }
      if (!occurredOn) occurredOn = event.recorded_at.slice(0, 10);

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
        latestRevision,
        occurredOn,
        occurredTime,
        deleted: latestRevision?.action === 'delete',
        corrected: latestRevision?.action === 'edit',
      };
    })
    .sort((a, b) => {
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
