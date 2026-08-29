import { createRoot } from 'react-dom/client';
import AppRouter from './AppRouter.tsx';
import { registerServiceWorker } from './lib/registerSW';
import { initAutoSync } from './lib/syncQueue';
import ContextualHelpProvider from './components/ContextualHelpProvider';
import 'leaflet/dist/leaflet.css';
import './index.css';

// Which build is this browser actually running? Logged first thing and
// pinned on window so a support question never has to guess at deploys,
// CDN caches, or service-worker staleness again.
console.log(`[build] survey-route @ ${__BUILD_COMMIT__}`);
(window as unknown as { __BUILD_COMMIT__: string }).__BUILD_COMMIT__ = __BUILD_COMMIT__;

// Register the offline app shell, static assets, and map tile caches.
registerServiceWorker();

// Start automatic sync queue processing.
// initAutoSync() returns a cleanup function, but we intentionally don't call it
// because sync runs for the entire app lifetime and is cleaned up on page unload.
initAutoSync();

createRoot(document.getElementById('root')!).render(
  <ContextualHelpProvider>
    <AppRouter />
  </ContextualHelpProvider>
);
