/**
 * Defaults to spread into every `pdfjsLib.getDocument(...)` call across
 * the app. Centralized so we never miss one (the symptom is silent: pdf.js
 * fails to decode the asset and either skips the painted image, throws
 * deep in the worker, or returns garbled glyph mappings — all without a
 * top-level error).
 *
 * Currently only sets `wasmUrl`, but anything else pdf.js needs sniffed
 * (cMapUrl, standardFontDataUrl) belongs here.
 *
 * ── wasmUrl: '/pdfjs-wasm/' ───────────────────────────────────────────
 * pdf.js 5.x decodes JPEG 2000 raster images (commonly used as page
 * backgrounds in aerial / drone facility photos) via an OpenJPEG WASM
 * module loaded at runtime. Without a wasmUrl pointing at where those
 * files live, the worker logs
 *
 *   JpxImage#instantiateWasm: UnknownErrorException:
 *     Ensure that the `wasmUrl` API parameter is provided.
 *   Unable to decode image "img_p17_1": "JpxError: OpenJPEG failed to
 *     initialize".
 *
 * and silently drops the image — vector overlays still paint so the
 * page looks "rendered" but the background photo is missing. Affected
 * a handful of Camino SPCC plans (Will Rogers, Garth Brooks).
 *
 * The WASM bundle lives at `node_modules/pdfjs-dist/wasm/` and is
 * copied to `public/pdfjs-wasm/` by the `sync-pdfjs-wasm` npm script
 * (auto-run via `postinstall`).
 */
export const pdfjsDocumentDefaults = {
  wasmUrl: '/pdfjs-wasm/',
} as const;
