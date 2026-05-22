import { PDFDocument } from 'pdf-lib';

/**
 * Convert an inline `<svg>` element to a single-page PDF Blob.
 *
 * Used by the LDAR Observation Path editor when saving: the editor's SVG
 * already contains the rendered PDF page (as `<image>`) plus all the
 * walking-path overlay (numbered circles, smooth path curve, legend,
 * title-block text replacement). Rasterizing the whole SVG → PNG → PDF
 * bakes the overlay into a flat downloadable file the user can share or
 * print.
 *
 * Pipeline:
 *   1. Clone + namespace the SVG so it serializes as a standalone
 *      document (`xmlns` attrs are required for the browser's image
 *      loader to parse it).
 *   2. Serialize → Blob → blob URL → `<img>`.
 *   3. Draw into an offscreen `<canvas>` at the given pixel size
 *      (we use the original PDF page's render size, which is already 2x).
 *   4. `canvas.toBlob('image/png')` to get the rasterized image.
 *   5. pdf-lib creates a fresh single-page PDF, embeds the PNG, draws
 *      it filling the page.
 *
 * Why rasterize instead of redrawing in pdf-lib primitives: the editor
 * has fine-grained details (smooth bezier path, foreignObject-wrapped
 * legend items, text replacement overlays) — replicating all of that
 * with pdf-lib's drawing API would mean maintaining a second rendering
 * path. Rasterizing at 2x of the source page keeps quality high (the
 * source itself is rendered at 2x scale, so the resulting PDF page is
 * effectively pixel-perfect with the editor view).
 *
 * Known caveat: SVG with foreignObject + HTML rasterizes in modern
 * Chrome and Firefox; some older Safari versions had issues but
 * current versions handle it. If a future browser drops support, fall
 * back to rendering the legend in pure SVG primitives for the export.
 */
export async function svgToPdfBlob(
  svgEl: SVGSVGElement,
  /** Pixel dimensions for the rasterized canvas. Match the source page's
   *  rendered size so 1 source pixel = 1 output pixel. */
  pixelWidth: number,
  pixelHeight: number,
): Promise<Blob> {
  // 1. Clone + namespace the SVG. We clone so we don't mutate the live
  //    editor DOM (the editor's onClick / drag handlers stay intact).
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  if (!clone.getAttribute('xmlns:xlink')) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }
  // Force explicit width/height attrs — without these, the browser may
  // load the SVG at its viewBox CSS size (1px × 1px) and the resulting
  // canvas is empty.
  clone.setAttribute('width', String(pixelWidth));
  clone.setAttribute('height', String(pixelHeight));

  const serialized = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  let pngBlob: Blob;
  try {
    // 2. Load via <img> so the browser parses + renders the SVG.
    const img = new Image();
    img.src = url;
    // decode() resolves once the image is parseable + paintable.
    await img.decode();

    // 3. Rasterize to canvas at the target pixel size.
    const canvas = document.createElement('canvas');
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2d canvas context');
    // White background so any transparent SVG areas render as paper-
    // white instead of black/transparent (PDF viewers vary on
    // transparent PNGs in PDFs).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pixelWidth, pixelHeight);
    ctx.drawImage(img, 0, 0, pixelWidth, pixelHeight);

    // 4. Get PNG.
    pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
        'image/png',
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }

  // 5. Wrap PNG in a single-page PDF.
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
  const pdfDoc = await PDFDocument.create();
  // Use the pixel size as the page's PDF unit size (1 pt = 1 px). For
  // letter-style PDFs this means a ~24" wide page at native 72dpi, but
  // the on-screen / on-print rendering uses the embedded image's
  // pixels directly and scales to the viewer's chosen size, so the
  // result is crisp regardless of the abstract "page size".
  const page = pdfDoc.addPage([pixelWidth, pixelHeight]);
  const pngImage = await pdfDoc.embedPng(pngBytes);
  page.drawImage(pngImage, { x: 0, y: 0, width: pixelWidth, height: pixelHeight });

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
}
