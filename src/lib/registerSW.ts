/**
 * Service-worker registration and update discovery.
 *
 * sw.js deliberately does not call skipWaiting() on install: a page that is
 * already open may still need to lazy-load one of its content-hashed chunks,
 * and swapping the worker underneath it turns a tab switch into a chunk-load
 * error. The new worker therefore sits in `waiting` until every tab closes.
 *
 * On a desk that resolves itself. On a field phone it does not — the app is
 * never really closed, so an inspector could run weeks-old code while each
 * deploy quietly pre-caches another unused generation of assets. Nothing told
 * them, and nothing let them ask for the update.
 *
 * So: keep the no-skipWaiting safety, but surface the waiting worker and give
 * the user a deliberate way to take it. Activation still never happens behind
 * their back — it happens when they tap Reload.
 */

type UpdateListener = (available: boolean) => void;

const listeners = new Set<UpdateListener>();
let waitingWorker: ServiceWorker | null = null;
let registration: ServiceWorkerRegistration | null = null;

/** Set only by applyUpdate(), so a worker that activates on its own — because
 *  the user happened to close the other tabs — never reloads this page out
 *  from under them mid-form. */
let userRequestedUpdate = false;
let reloading = false;

/** Minimum gap between deploy checks, so refocusing the tab isn't chatty. */
const CHECK_THROTTLE_MS = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
let lastCheck = 0;

function announce(): void {
  for (const listener of listeners) listener(!!waitingWorker);
}

/** Subscribe to "a newer build is installed and waiting". Fires immediately
 *  if one is already waiting. Returns an unsubscribe function. */
export function onUpdateAvailable(listener: UpdateListener): () => void {
  listeners.add(listener);
  if (waitingWorker) listener(true);
  return () => listeners.delete(listener);
}

/** Hand control to the waiting worker and reload onto the new build. */
export function applyUpdate(): void {
  if (!waitingWorker) return;
  userRequestedUpdate = true;
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}

/** Ask the server whether a newer build has been deployed.
 *
 *  The registered URL is commit-stamped (/sw.js?v=<commit>), but the query
 *  string is just a cache-buster — a static host serves the *current* deploy's
 *  sw.js at that path, stamped with its own commit. So re-fetching the old URL
 *  is exactly how a newer worker gets discovered without a page reload. */
function checkForUpdate(force = false): void {
  if (!registration) return;
  const now = Date.now();
  if (!force && now - lastCheck < CHECK_THROTTLE_MS) return;
  lastCheck = now;
  registration.update().catch(() => {
    // Offline, or the deploy is mid-flight. The next check retries.
  });
}

function track(reg: ServiceWorkerRegistration): void {
  registration = reg;

  // controller == null means this is the first-ever install, not an update:
  // nothing is being replaced, so there is nothing to prompt about.
  const isUpdate = () => !!navigator.serviceWorker.controller;

  if (reg.waiting && isUpdate()) {
    waitingWorker = reg.waiting;
    announce();
  }

  reg.addEventListener('updatefound', () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      // 'installed' here means precacheAppShell() finished: the new shell and
      // every asset it references are on disk, so Reload cannot strand the
      // user on a half-cached build.
      if (installing.state === 'installed' && isUpdate()) {
        waitingWorker = reg.waiting ?? installing;
        announce();
      }
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!userRequestedUpdate || reloading) return;
    reloading = true;
    window.location.reload();
  });

  // A long-lived field session never re-runs 'load', so poll, and check again
  // whenever the app comes back to the foreground.
  window.setInterval(() => checkForUpdate(true), CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkForUpdate();
  });
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      // A commit-specific script URL forces an install check on every deploy,
      // even when sw.js itself did not change. That install atomically caches
      // the new index.html plus its exact hashed Vite assets.
      const workerUrl = `/sw.js?v=${encodeURIComponent(__BUILD_COMMIT__)}`;
      const reg = await navigator.serviceWorker.register(workerUrl, {
        scope: '/',
        updateViaCache: 'none',
      });
      console.log('[SW] Registered:', reg.scope);
      track(reg);
    } catch (err) {
      console.warn('[SW] Registration failed:', err);
    }
  });
}
