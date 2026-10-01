import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { applyUpdate, onUpdateAvailable } from '../lib/registerSW';
import ModalPortal from './ModalPortal';

/**
 * "A new version is ready — Reload."
 *
 * sw.js holds a newly installed build in `waiting` instead of activating it
 * under an open page (see registerSW.ts). Without this prompt that wait is
 * invisible and effectively permanent on a phone, which is how a field tech
 * ends up running a build from several deploys ago.
 *
 * Portaled to document.body on purpose: the sticky nav is z-[70] and several
 * panels create their own stacking contexts, so a banner rendered in place
 * would be painted over no matter what z-index it claimed.
 */
export default function UpdateAvailableBanner() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => onUpdateAvailable(setAvailable), []);

  if (!available || dismissed) return null;

  return (
    <ModalPortal>
      <div
        role="status"
        aria-live="polite"
        // bottom-24 clears the mobile tab bar; safe-area keeps it off the
        // home-indicator strip on notched iPhones.
        className="fixed inset-x-0 bottom-24 z-[100] flex justify-center px-4 sm:bottom-6"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
            <RefreshCw className={`h-4 w-4 ${reloading ? 'animate-spin' : ''}`} />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              New version available
            </p>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
              Reload to pick up the latest fixes.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setReloading(true);
              applyUpdate();
            }}
            disabled={reloading}
            className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {reloading ? 'Reloading…' : 'Reload'}
          </button>

          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss update notice"
            title="Dismiss"
            className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
