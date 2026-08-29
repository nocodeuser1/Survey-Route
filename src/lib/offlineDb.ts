import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type {
  Facility,
  RoutePlan,
  HomeBase,
  Inspection,
  UserSettings,
} from './supabase';

/**
 * One account-scoped recovery point for a Safari/WebKit cold restart.
 *
 * iOS may discard the entire page process while the phone is locked. The
 * normalized stores below are still used by the sync queue, but this snapshot
 * lets the UI restore the exact open route atomically without first asking the
 * network which route was last viewed.
 */
export interface OfflineAccountSnapshot {
  accountId: string;
  userId: string;
  facilities: Facility[];
  homeBases: HomeBase[];
  inspections: Inspection[];
  routePlan: RoutePlan | null;
  settings: UserSettings | null;
  teamCount: number;
  userTeamAssignment: number | null;
  routeFacilityIds: string[] | null;
  showOnlyRouteFacilities: boolean;
  savedAt: number;
}

type StoredOfflineAccountSnapshot = OfflineAccountSnapshot & {
  scopeKey: string;
};

const getSnapshotScopeKey = (userId: string, accountId: string): string =>
  `${userId}:${accountId}`;

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
  account_snapshots: {
    key: string;
    value: StoredOfflineAccountSnapshot;
    indexes: {
      'by-user': string;
    };
  };
}

const DB_NAME = 'survey-route-offline';
const DB_VERSION = 2;

let dbInstance: IDBPDatabase<SurveyRouteDB> | null = null;

export async function getDb(): Promise<IDBPDatabase<SurveyRouteDB>> {
  if (dbInstance) return dbInstance;

  try {
    dbInstance = await openDB<SurveyRouteDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Every creation is guarded so upgrades from an existing v1 database
        // do not try to recreate its stores.
        if (!db.objectStoreNames.contains('facilities')) {
          const facilityStore = db.createObjectStore('facilities', { keyPath: 'id' });
          facilityStore.createIndex('by-user', 'user_id');
          facilityStore.createIndex('by-account', 'account_id');
        }

        if (!db.objectStoreNames.contains('route_plans')) {
          const routeStore = db.createObjectStore('route_plans', { keyPath: 'id' });
          routeStore.createIndex('by-user', 'user_id');
        }

        if (!db.objectStoreNames.contains('home_bases')) {
          const homeBaseStore = db.createObjectStore('home_bases', { keyPath: 'id' });
          homeBaseStore.createIndex('by-user', 'user_id');
        }

        if (!db.objectStoreNames.contains('sync_queue')) {
          const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
          syncStore.createIndex('by-table', 'table');
          syncStore.createIndex('by-timestamp', 'timestamp');
        }

        if (!db.objectStoreNames.contains('account_snapshots')) {
          const snapshotStore = db.createObjectStore('account_snapshots', {
            keyPath: 'scopeKey',
          });
          snapshotStore.createIndex('by-user', 'userId');
        }
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
  const accountIds = Array.from(
    new Set(
      facilities
        .map((facility) => facility.account_id)
        .filter((accountId): accountId is string => !!accountId)
    )
  );
  const existingForAccounts = (
    await Promise.all(
      accountIds.map((accountId) =>
        db.getAllFromIndex('facilities', 'by-account', accountId)
      )
    )
  ).flat();
  const incomingIds = new Set(facilities.map((facility) => facility.id));
  const tx = db.transaction('facilities', 'readwrite');
  const now = Date.now();
  await Promise.all([
    ...facilities.map((f) => tx.store.put({ ...f, _localUpdatedAt: now })),
    ...existingForAccounts
      .filter((facility) => !incomingIds.has(facility.id))
      .map((facility) => tx.store.delete(facility.id)),
    tx.done,
  ]);
}

/**
 * Replace one account's normalized facility cache, including with an empty
 * authoritative result. The older array-only helper cannot infer an account
 * from [], which allowed deleted facilities to reappear on the next offline
 * launch.
 */
export async function replaceFacilitiesForAccount(
  accountId: string,
  facilities: Facility[]
): Promise<void> {
  const foreignFacility = facilities.find(
    (facility) => facility.account_id && facility.account_id !== accountId
  );
  if (foreignFacility) {
    throw new Error('Cannot cache facilities from multiple accounts in one replacement');
  }

  const db = await getDb();
  const existing = await db.getAllFromIndex('facilities', 'by-account', accountId);
  const scopedFacilities = facilities.map((facility) => ({
    ...facility,
    account_id: facility.account_id ?? accountId,
  }));
  const incomingIds = new Set(scopedFacilities.map((facility) => facility.id));
  const tx = db.transaction('facilities', 'readwrite');
  const now = Date.now();

  await Promise.all([
    ...scopedFacilities.map((facility) =>
      tx.store.put({ ...facility, _localUpdatedAt: now })
    ),
    ...existing
      .filter((facility) => !incomingIds.has(facility.id))
      .map((facility) => tx.store.delete(facility.id)),
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

// --- Atomic account recovery snapshots ---

export async function saveAccountSnapshot(
  snapshot: OfflineAccountSnapshot
): Promise<void> {
  const db = await getDb();
  await db.put('account_snapshots', {
    ...snapshot,
    scopeKey: getSnapshotScopeKey(snapshot.userId, snapshot.accountId),
  });
}

export async function getAccountSnapshot(
  accountId: string,
  userId: string
): Promise<OfflineAccountSnapshot | null> {
  const db = await getDb();
  const snapshot = await db.get(
    'account_snapshots',
    getSnapshotScopeKey(userId, accountId)
  );

  if (!snapshot || snapshot.userId !== userId || snapshot.accountId !== accountId) {
    return null;
  }

  // Reject any snapshot written by an older cross-account race rather than
  // hydrating foreign facilities into the selected account.
  if (
    snapshot.facilities.some(
      (facility) => facility.account_id && facility.account_id !== accountId
    )
    || snapshot.inspections.some((inspection) => inspection.account_id !== accountId)
    || (snapshot.settings?.account_id && snapshot.settings.account_id !== accountId)
  ) {
    return null;
  }

  const { scopeKey: _, ...accountSnapshot } = snapshot;
  return accountSnapshot;
}

export async function deleteAccountSnapshot(
  accountId: string,
  userId: string
): Promise<void> {
  const db = await getDb();
  await db.delete('account_snapshots', getSnapshotScopeKey(userId, accountId));
}

export async function deleteAccountSnapshotsForUser(userId: string): Promise<void> {
  const db = await getDb();
  const snapshots = await db.getAllFromIndex('account_snapshots', 'by-user', userId);
  const tx = db.transaction('account_snapshots', 'readwrite');
  await Promise.all([
    ...snapshots.map((snapshot) => tx.store.delete(snapshot.scopeKey)),
    tx.done,
  ]);
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
