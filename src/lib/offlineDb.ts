import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { Facility, RoutePlan, HomeBase } from './supabase';

export interface SyncQueueEntry {
  id: string;
  table: 'facilities' | 'route_plans' | 'home_bases';
  operation: 'upsert' | 'delete';
  data: Record<string, unknown>;
  timestamp: number;
  retries: number;
}

interface SurveyRouteDB extends DBSchema {
  facilities: {
    key: string;
    value: Facility & { _localUpdatedAt: number };
    indexes: {
      'by-user': string;
      'by-account': string;
    };
  };
  route_plans: {
    key: string;
    value: RoutePlan & { _localUpdatedAt: number };
    indexes: {
      'by-user': string;
    };
  };
  home_bases: {
    key: string;
    value: HomeBase & { _localUpdatedAt: number };
    indexes: {
      'by-user': string;
    };
  };
  sync_queue: {
    key: string;
    value: SyncQueueEntry;
    indexes: {
      'by-table': string;
      'by-timestamp': number;
    };
  };
}

const DB_NAME = 'survey-route-offline';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<SurveyRouteDB> | null = null;

export async function getDb(): Promise<IDBPDatabase<SurveyRouteDB>> {
  if (dbInstance) return dbInstance;

  try {
    dbInstance = await openDB<SurveyRouteDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Facilities store
        const facilityStore = db.createObjectStore('facilities', { keyPath: 'id' });
        facilityStore.createIndex('by-user', 'user_id');
        facilityStore.createIndex('by-account', 'account_id');

        // Route plans store
        const routeStore = db.createObjectStore('route_plans', { keyPath: 'id' });
        routeStore.createIndex('by-user', 'user_id');

        // Home bases store
        const homeBaseStore = db.createObjectStore('home_bases', { keyPath: 'id' });
        homeBaseStore.createIndex('by-user', 'user_id');

        // Sync queue store
        const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
        syncStore.createIndex('by-table', 'table');
        syncStore.createIndex('by-timestamp', 'timestamp');
      },
    });

    return dbInstance;
  } catch (err) {
    console.error('[offlineDb] IndexedDB unavailable (private browsing or storage quota exceeded):', err);
    throw new Error('IndexedDB is unavailable. Offline features are disabled.');
  }
}

// --- Facilities ---

export async function saveFacilities(facilities: Facility[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('facilities', 'readwrite');
  const now = Date.now();
  await Promise.all([
    ...facilities.map((f) => tx.store.put({ ...f, _localUpdatedAt: now })),
    tx.done,
  ]);
}

export async function getFacilitiesByUser(userId: string): Promise<Facility[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('facilities', 'by-user', userId);
  return all.map(({ _localUpdatedAt: _, ...rest }) => rest as unknown as Facility);
}

export async function getFacilitiesByAccount(accountId: string): Promise<Facility[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('facilities', 'by-account', accountId);
  return all.map(({ _localUpdatedAt: _, ...rest }) => rest as unknown as Facility);
}

export async function saveFacility(facility: Facility): Promise<void> {
  const db = await getDb();
  await db.put('facilities', { ...facility, _localUpdatedAt: Date.now() });
}

export async function deleteFacility(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('facilities', id);
}

// --- Route Plans ---

export async function saveRoutePlans(plans: RoutePlan[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('route_plans', 'readwrite');
  const now = Date.now();
  await Promise.all([
    ...plans.map((p) => tx.store.put({ ...p, _localUpdatedAt: now })),
    tx.done,
  ]);
}

export async function getRoutePlansByUser(userId: string): Promise<RoutePlan[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('route_plans', 'by-user', userId);
  return all.map(({ _localUpdatedAt: _, ...rest }) => rest as unknown as RoutePlan);
}

export async function saveRoutePlan(plan: RoutePlan): Promise<void> {
  const db = await getDb();
  await db.put('route_plans', { ...plan, _localUpdatedAt: Date.now() });
}

export async function deleteRoutePlan(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('route_plans', id);
}

// --- Home Bases ---

export async function saveHomeBases(bases: HomeBase[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('home_bases', 'readwrite');
  const now = Date.now();
  await Promise.all([
    ...bases.map((b) => tx.store.put({ ...b, _localUpdatedAt: now })),
    tx.done,
  ]);
}

export async function getHomeBasesByUser(userId: string): Promise<HomeBase[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('home_bases', 'by-user', userId);
  return all.map(({ _localUpdatedAt: _, ...rest }) => rest as unknown as HomeBase);
}

export async function saveHomeBase(base: HomeBase): Promise<void> {
  const db = await getDb();
  await db.put('home_bases', { ...base, _localUpdatedAt: Date.now() });
}

export async function deleteHomeBase(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('home_bases', id);
}

// --- Sync Queue ---

export async function addToSyncQueue(entry: Omit<SyncQueueEntry, 'id' | 'timestamp' | 'retries'>): Promise<void> {
  const db = await getDb();
  const recordId = (entry.data as Record<string, string>).id ?? crypto.randomUUID();
  const queueEntry: SyncQueueEntry = {
    ...entry,
    id: `${entry.table}_${recordId}_${Date.now()}`,
    timestamp: Date.now(),
    retries: 0,
  };
  await db.put('sync_queue', queueEntry);
}

export async function getSyncQueue(): Promise<SyncQueueEntry[]> {
  const db = await getDb();
  return db.getAllFromIndex('sync_queue', 'by-timestamp');
}

export async function removeSyncQueueEntry(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('sync_queue', id);
}

export async function updateSyncQueueEntry(entry: SyncQueueEntry): Promise<void> {
  const db = await getDb();
  await db.put('sync_queue', entry);
}

export async function getSyncQueueCount(): Promise<number> {
  const db = await getDb();
  return db.count('sync_queue');
}

export async function clearSyncQueue(): Promise<void> {
  const db = await getDb();
  await db.clear('sync_queue');
}

// --- Storage Estimate ---

export interface StorageEstimate {
  usageMB: number;
  quotaMB: number;
  percentUsed: number;
}

/**
 * Check storage usage so the UI can warn users when storage is getting full.
 * Returns null if the Storage API is unavailable.
 */
export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage ?? 0;
    const quota = estimate.quota ?? 0;
    return {
      usageMB: Math.round((usage / (1024 * 1024)) * 100) / 100,
      quotaMB: Math.round((quota / (1024 * 1024)) * 100) / 100,
      percentUsed: quota > 0 ? Math.round((usage / quota) * 10000) / 100 : 0,
    };
  } catch {
    return null;
  }
}
