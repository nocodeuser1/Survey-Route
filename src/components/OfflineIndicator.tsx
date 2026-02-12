import { WifiOff, Wifi, CloudOff, RefreshCw } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { processQueue } from '../lib/syncQueue';
import { useState } from 'react';

export default function OfflineIndicator() {
  const { isOnline, pendingSyncCount } = useOnlineStatus();
  const [isSyncing, setIsSyncing] = useState(false);

  const handleManualSync = async () => {
    if (!isOnline || isSyncing) return;
    setIsSyncing(true);
    try {
      await processQueue();
    } finally {
      setIsSyncing(false);
    }
  };

  // When online with no pending changes, don't show anything
  if (isOnline && pendingSyncCount === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[1500] flex items-center gap-2">
      {/* Connection status badge */}
      <div
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium shadow-lg transition-colors ${
          isOnline
            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
            : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
        }`}
      >
        {isOnline ? (
          <Wifi className="w-3.5 h-3.5" />
        ) : (
          <WifiOff className="w-3.5 h-3.5" />
        )}
        {isOnline ? 'Online' : 'Offline'}
      </div>

      {/* Pending sync badge */}
      {pendingSyncCount > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium shadow-lg bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
          <CloudOff className="w-3.5 h-3.5" />
          {pendingSyncCount} pending
          {isOnline && (
            <button
              onClick={handleManualSync}
              disabled={isSyncing}
              className="ml-1 p-0.5 rounded hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors disabled:opacity-50"
              title="Sync now"
            >
              <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
