import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
