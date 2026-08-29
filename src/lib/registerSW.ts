export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      // A commit-specific script URL forces an install check on every deploy,
      // even when sw.js itself did not change. That install atomically caches
      // the new index.html plus its exact hashed Vite assets.
      const workerUrl = `/sw.js?v=${encodeURIComponent(__BUILD_COMMIT__)}`;
      const registration = await navigator.serviceWorker.register(workerUrl, {
        scope: '/',
        updateViaCache: 'none',
      });
      console.log('[SW] Registered:', registration.scope);
    } catch (err) {
      console.warn('[SW] Registration failed:', err);
    }
  });
}
