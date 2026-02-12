import { supabase } from './supabase';
import {
  getSyncQueue,
  removeSyncQueueEntry,
  updateSyncQueueEntry,
  addToSyncQueue,
  saveFacility,
  saveRoutePlan,
  saveHomeBase,
  deleteFacility,
  deleteRoutePlan,
  deleteHomeBase,
  type SyncQueueEntry,
} from './offlineDb';
import type { Facility, RoutePlan, HomeBase } from './supabase';

const MAX_RETRIES = 5;
let isSyncing = false;
let syncListeners: Array<() => void> = [];
let syncFailedListeners: Array<(entry: SyncQueueEntry) => void> = [];

export function onSyncFailed(listener: (entry: SyncQueueEntry) => void): () => void {
  syncFailedListeners.push(listener);
  return () => {
    syncFailedListeners = syncFailedListeners.filter((l) => l !== listener);
  };
}

export function onSyncChange(listener: () => void): () => void {
  syncListeners.push(listener);
  return () => {
    syncListeners = syncListeners.filter((l) => l !== listener);
  };
}

function notifySyncListeners(): void {
  syncListeners.forEach((l) => l());
}

/**
 * Queue a route change for sync. Saves to IndexedDB immediately,
 * and queues the change for server sync when online.
 */
export async function queueRouteChange(
  table: SyncQueueEntry['table'],
  operation: SyncQueueEntry['operation'],
  data: Record<string, unknown>
): Promise<void> {
  // Save locally first (optimistic update)
  if (operation === 'upsert') {
    switch (table) {
      case 'facilities':
        await saveFacility(data as unknown as Facility);
        break;
      case 'route_plans':
        await saveRoutePlan(data as unknown as RoutePlan);
        break;
      case 'home_bases':
        await saveHomeBase(data as unknown as HomeBase);
        break;
    }
  } else if (operation === 'delete') {
    switch (table) {
      case 'facilities':
        await deleteFacility(data.id as string);
        break;
      case 'route_plans':
        await deleteRoutePlan(data.id as string);
        break;
      case 'home_bases':
        await deleteHomeBase(data.id as string);
        break;
    }
  }

  // Deduplicate: update existing pending entry for same table+record instead of creating a new one
  const recordId = data.id as string | undefined;
  if (recordId) {
    const queue = await getSyncQueue();
    const existing = queue.find(
      (e) => e.table === table && (e.data as Record<string, unknown>).id === recordId
    );
    if (existing) {
      await updateSyncQueueEntry({ ...existing, operation, data, timestamp: Date.now() });
      notifySyncListeners();
      if (navigator.onLine) processQueue();
      return;
    }
  }

  // Add to sync queue
  await addToSyncQueue({ table, operation, data });
  notifySyncListeners();

  // Try to sync immediately if online
  if (navigator.onLine) {
    processQueue();
  }
}

/**
 * Process all pending sync queue entries.
 * Uses last-write-wins conflict resolution based on timestamps.
 */
export async function processQueue(): Promise<{ processed: number; failed: number }> {
  if (isSyncing) return { processed: 0, failed: 0 };
  isSyncing = true;

  let processed = 0;
  let failed = 0;

  try {
    const queue = await getSyncQueue();

    for (const entry of queue) {
      if (entry.retries >= MAX_RETRIES) {
        console.warn(
          `[syncQueue] Permanently failed sync entry after ${MAX_RETRIES} retries:`,
          { table: entry.table, operation: entry.operation, id: (entry.data as Record<string, unknown>).id }
        );
        syncFailedListeners.forEach((l) => l(entry));
        await removeSyncQueueEntry(entry.id);
        failed++;
        continue;
      }

      try {
        await processEntry(entry);
        await removeSyncQueueEntry(entry.id);
        processed++;
      } catch {
        // Increment retry count on failure
        await updateSyncQueueEntry({ ...entry, retries: entry.retries + 1 });
        failed++;
      }
    }
  } finally {
    isSyncing = false;
    if (processed > 0) {
      notifySyncListeners();
    }
  }

  return { processed, failed };
}

async function processEntry(entry: SyncQueueEntry): Promise<void> {
  const { table, operation, data, timestamp } = entry;
  const supabaseTable = getSupabaseTable(table);

  if (operation === 'delete') {
    const { error } = await supabase.from(supabaseTable).delete().eq('id', data.id as string);
    if (error) throw error;
    return;
  }

  // Upsert with last-write-wins conflict resolution
  // Check server version first
  const { data: serverRecord, error: fetchError } = await supabase
    .from(supabaseTable)
    .select('*')
    .eq('id', data.id as string)
    .maybeSingle();

  if (fetchError) throw fetchError;

  if (serverRecord) {
    // Compare timestamps for conflict resolution (last-write-wins)
    const serverTime = new Date(
      (serverRecord as Record<string, string>).updated_at ||
      (serverRecord as Record<string, string>).created_at
    ).getTime();
    if (serverTime > timestamp) {
      // Server version is newer - skip this update (server wins)
      return;
    }
  }

  // Our version is newer or record doesn't exist on server - push our changes
  const cleanData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith('_')) {
      cleanData[key] = value;
    }
  }

  const { error } = await supabase
    .from(supabaseTable)
    .upsert(cleanData, { onConflict: 'id' });

  if (error) throw error;
}

function getSupabaseTable(table: SyncQueueEntry['table']): string {
  switch (table) {
    case 'facilities': return 'facilities';
    case 'route_plans': return 'route_plans';
    case 'home_bases': return 'home_bases';
  }
}

/**
 * Set up automatic sync when coming back online.
 */
export function initAutoSync(): () => void {
  const handleOnline = () => {
    processQueue();
  };

  window.addEventListener('online', handleOnline);

  // Also try to sync periodically when online (every 30 seconds)
  const interval = setInterval(() => {
    if (navigator.onLine) {
      processQueue();
    }
  }, 30_000);

  return () => {
    window.removeEventListener('online', handleOnline);
    clearInterval(interval);
  };
}
