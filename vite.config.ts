import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const buildCommit = (process.env.COMMIT_REF || 'local-dev').slice(0, 7);

function stampServiceWorker(): Plugin {
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    async closeBundle() {
      const workerPath = resolve(process.cwd(), 'dist/sw.js');
      const workerSource = await readFile(workerPath, 'utf8');
      const buildToken = '__SURVEY_ROUTE_BUILD__';

      if (!workerSource.includes(buildToken)) {
        throw new Error('Service worker build token is missing');
      }

      await writeFile(
        workerPath,
        workerSource.replaceAll(buildToken, buildCommit),
        'utf8'
      );
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  // Build stamp: Netlify exposes the deployed commit as COMMIT_REF. Baked
  // into the bundle and logged at startup so "which code is this browser
  // actually running?" is a console check, not a forensic exercise.
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
  plugins: [react(), stampServiceWorker()],
  optimizeDeps: {
    // mupdf ships its WASM via `new URL('mupdf-wasm.wasm', import.meta.url)`.
    // Excluding it keeps Vite from pre-bundling and breaking the WASM path.
    exclude: ['lucide-react', 'mupdf'],
  },
  assetsInclude: ['**/*.wasm'],
  server: {
    hmr: {
      overlay: false,
    },
  },
  build: {
    sourcemap: false,
    // mupdf's ESM entrypoint uses top-level await to initialize the WASM module.
    // The default Vite target (es2020 + browser defaults) doesn't allow it, so
    // the build fails during transpile. esnext allows top-level await and is
    // supported in every browser Capacitor targets (iOS 15+, Chrome 89+).
    target: 'esnext',
  },
});
