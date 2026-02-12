import { useState, useEffect, useCallback } from 'react';
import { getSyncQueueCount } from '../lib/offlineDb';
import { onSyncChange } from '../lib/syncQueue';

interface OnlineStatus {
  isOnline: boolean;
  pendingSyncCount: number;
  refreshPendingCount: () => void;
}

export function useOnlineStatus(): OnlineStatus {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  const refreshPendingCount = useCallback(() => {
    getSyncQueueCount().then(setPendingSyncCount).catch(() => {});
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      refreshPendingCount();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Listen for sync queue changes
    const unsubscribe = onSyncChange(refreshPendingCount);

    // Initial count
    refreshPendingCount();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, [refreshPendingCount]);

  return { isOnline, pendingSyncCount, refreshPendingCount };
}
