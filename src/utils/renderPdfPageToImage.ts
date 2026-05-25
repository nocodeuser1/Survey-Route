import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface RenderedPdfPage {
  /** Base64-encoded PNG data URL of the rendered page. */
  dataUrl: string;
  /** Rendered pixel width (= page.viewport(scale).width). */
  width: number;
  /** Rendered pixel height (= page.viewport(scale).height). */
  height: number;
  /** 1-based page number that was rendered. */
  page: number;
  /** Total page count of the source PDF, for the caller's reference. */
  numPages: number;
}

/**
 * Fetch a PDF from a URL and render a single page to a PNG data URL.
 *
 * Used by the LDAR Observation Path editor: page 1 of the site plan is fed
 * to Gemini Vision (for AI generation) and also rendered as the SVG
 * background image (for display).
 *
 * The default scale of 2 gives Gemini enough detail to read the small
 * yellow callout labels while keeping the resulting PNG well under
 * Gemini's 7 MB inline-image limit. Bump to 3 for very dense plans if
 * the model has trouble reading labels.
 */
export async function renderPdfPageToImage(
  pdfUrl: string,
  options: { page?: number; scale?: number } = {},
): Promise<RenderedPdfPage> {
  const pageNum = options.page ?? 1;
  const scale = options.scale ?? 2;

  // We pass the URL through fetch ourselves so a bad URL fails fast with a
  // readable error message (pdfjs' getDocument({ url }) buries network
  // errors deep in its internals).
  const resp = await fetch(pdfUrl);
  if (!resp.ok) {
    throw new Error(`Failed to fetch PDF (${resp.status}): ${pdfUrl}`);
  }
  const arrayBuffer = await resp.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  if (pageNum < 1 || pageNum > pdf.numPages) {
    throw new Error(`Page ${pageNum} out of range (PDF has ${pdf.numPages} pages)`);
  }

  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  // OffscreenCanvas would be nicer (no DOM attach) but isn't available in
  // all the browsers Capacitor wraps. A regular <canvas> stays detached
  // from the DOM and the browser GCs it after we extract the data URL.
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d canvas context for PDF rendering');

  // Pre-fill with white. Defensive: some PDFs (notably aerial-photo site
  // plans with raster XObjects) silently fail to paint the background
  // image, leaving the canvas transparent — the user then sees only the
  // vector overlays (labels, boxes, arrows) on what looks like a blank
  // page. A white pre-fill gives us a deterministic background regardless
  // of how the page paints, AND matches what pdf.js' built-in default is
  // supposed to provide but doesn't always honor on every PDF.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // pdfjs 5.x uses `canvasContext` as the property name; older 4.x used
  // `canvas`. We're on 5.4 per package.json so this is stable, but the
  // shipped .d.ts under 5.4 still types `RenderParameters` as requiring
  // a `canvas` field instead of `canvasContext`, so we cast.
  //
  // `background: 'white'` is the documented way to ask pdf.js to use a
  // white page background instead of transparent — belt + braces with
  // the pre-fill above.
  //
  // `intent: 'print'` swaps a few defaults that tend to render more
  // images faithfully on tricky PDFs (e.g. annotations, soft masks)
  // without changing how normal vector content paints.
  try {
    await page.render({
      canvasContext: ctx,
      viewport,
      background: '#ffffff',
      intent: 'print',
    } as Parameters<typeof page.render>[0]).promise;
  } catch (err: any) {
    // Surface the underlying pdf.js error rather than silently returning
    // a blank/partial canvas. The caller can decide what to do (retry at
    // a lower scale, show an error UI, etc.).
    console.error('[renderPdfPageToImage] pdf.js render failed:', err);
    throw new Error(`PDF render failed: ${err?.message || String(err)}`);
  }

  const dataUrl = canvas.toDataURL('image/png');

  return {
    dataUrl,
    width: canvas.width,
    height: canvas.height,
    page: pageNum,
    numPages: pdf.numPages,
  };
}
