/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string
    readonly VITE_SUPABASE_ANON_KEY: string
    readonly VITE_APP_URL: string
    // more env variables...
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

// Injected at build time (vite.config.ts define) — short commit hash of the
// deployed code, 'local-d' for local dev builds.
declare const __BUILD_COMMIT__: string;
