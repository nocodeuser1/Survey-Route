import { createRoot } from 'react-dom/client';
import AppRouter from './AppRouter.tsx';
import { registerServiceWorker } from './lib/registerSW';
import { initAutoSync } from './lib/syncQueue';
import './index.css';

// Register service worker for map tile caching
registerServiceWorker();

// Start automatic sync queue processing
initAutoSync();

createRoot(document.getElementById('root')!).render(
  <AppRouter />
);
