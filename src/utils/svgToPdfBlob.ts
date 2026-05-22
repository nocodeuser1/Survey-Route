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
 * IMPORTANT — foreignObject taints the canvas. SVG with HTML embedded
 * via <foreignObject> taints the rasterization canvas in Chrome (and
 * other Blink browsers) when loaded through the `<img>` route. Calling
 * canvas.toBlob() on a tainted canvas throws SecurityError. To work
 * around this without dropping the nice HTML-driven word-wrap in the
 * live editor, we walk the cloned SVG before serialization and replace
 * every foreignObject with an equivalent <text>+<tspan> tree (manual
 * word wrap). The live editor's foreignObjects are untouched — only
 * the export clone gets stripped.
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

  // Strip foreignObjects in the clone so the SVG rasterizes without
  // tainting the canvas. Must happen BEFORE serialization.
  replaceForeignObjectsWithSvgText(clone);

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

// ============================================================
// foreignObject → pure SVG text replacement
// ============================================================
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Walk an SVG tree and replace each <foreignObject> with an equivalent
 * <text>+<tspan> element so the resulting SVG rasterizes without
 * tainting the export canvas. Best-effort: extracts visible text from
 * the foreignObject's inner HTML (span / input / textarea), reads font
 * styles off the inner element's style attribute, and wraps lines based
 * on a chars-per-line estimate using the foreignObject's width.
 *
 * Mutates the passed-in clone in place. The live editor SVG is not
 * touched — call this only on a cloned tree.
 */
function replaceForeignObjectsWithSvgText(clone: SVGSVGElement): void {
  // Snapshot the list before mutating — replaceChild during iteration
  // would otherwise skip siblings.
  const foreignObjects = Array.from(clone.querySelectorAll('foreignObject'));
  for (const fo of foreignObjects) {
    const x = parseFloat(fo.getAttribute('x') || '0');
    const y = parseFloat(fo.getAttribute('y') || '0');
    const w = parseFloat(fo.getAttribute('width') || '0');
    const h = parseFloat(fo.getAttribute('height') || '0');

    const inner = fo.firstElementChild as HTMLElement | null;
    // Resolve visible text + font styling from whichever HTML element is
    // inside (input / textarea while editing, span / div otherwise).
    const text = extractVisibleText(inner);
    if (!inner || !text.trim()) {
      // Nothing meaningful to render — drop the foreignObject. (Empty
      // editing-state textareas hit this path; the saved JSON has the
      // canonical value so the next reload renders fine.)
      fo.parentNode?.removeChild(fo);
      continue;
    }

    const { fontSize, fontWeight, color, textAlign } = extractFontStyle(inner);

    // Word wrap based on the foreignObject width. 0.62 of font size is a
    // reasonable average glyph width for system-ui at semi-bold — slightly
    // generous so we don't overflow.
    const charsPerLine = Math.max(6, Math.floor(w / (fontSize * 0.6)));
    const lines = wrapText(text, charsPerLine);
    const lineHeight = fontSize * 1.25;
    const totalTextHeight = lines.length * lineHeight;
    // Vertical center within the foreignObject's height — same as the
    // editor's flex-align-items-center div.
    const firstLineBaseline = y + (h - totalTextHeight) / 2 + fontSize * 0.9;

    const isLeftAligned = textAlign !== 'center';
    const textX = isLeftAligned ? x : x + w / 2;
    const anchor = isLeftAligned ? 'start' : 'middle';

    const textEl = document.createElementNS(SVG_NS, 'text');
    textEl.setAttribute('x', textX.toFixed(2));
    textEl.setAttribute('y', firstLineBaseline.toFixed(2));
    textEl.setAttribute('font-size', String(fontSize));
    textEl.setAttribute('font-weight', String(fontWeight));
    textEl.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    textEl.setAttribute('fill', color);
    textEl.setAttribute('text-anchor', anchor);

    lines.forEach((line, i) => {
      const tspan = document.createElementNS(SVG_NS, 'tspan');
      tspan.setAttribute('x', textX.toFixed(2));
      if (i > 0) tspan.setAttribute('dy', lineHeight.toFixed(2));
      tspan.textContent = line;
      textEl.appendChild(tspan);
    });

    fo.parentNode?.replaceChild(textEl, fo);
  }
}

/**
 * Pull the visible text from whatever HTML element sits inside a
 * <foreignObject>. Handles three cases the editor produces:
 *   - <span>{label}</span> for normal legend items
 *   - <textarea> when a legend item is being edited
 *   - <input> when the legend title is being edited
 * Plus any other HTML — falls back to textContent.
 */
function extractVisibleText(inner: HTMLElement | null): string {
  if (!inner) return '';
  const textarea = inner.querySelector('textarea');
  if (textarea) return textarea.value;
  const input = inner.querySelector('input');
  if (input) return input.value;
  // Prefer the span if present — it's the canonical label container.
  const span = inner.querySelector('span');
  if (span) return span.textContent ?? '';
  return inner.textContent ?? '';
}

/**
 * Read inline font styling off the foreignObject's inner element.
 * React's style prop serializes to `style="font-size: 14px; ..."` so
 * `.style.fontSize` etc. return parseable values.
 */
function extractFontStyle(inner: HTMLElement): {
  fontSize: number;
  fontWeight: number;
  color: string;
  textAlign: string;
} {
  const fontSize = parseFloat(inner.style.fontSize || '14') || 14;
  const fontWeightRaw = inner.style.fontWeight || '400';
  const fontWeight =
    fontWeightRaw === 'bold' ? 700 : parseInt(fontWeightRaw, 10) || 400;
  const color = inner.style.color || '#111827';
  const textAlign = inner.style.textAlign || 'start';
  return { fontSize, fontWeight, color, textAlign };
}

/** Greedy word-wrap: pack words onto each line until adding the next one
 *  would exceed maxCharsPerLine. Doesn't break words mid-character —
 *  long single tokens (e.g. URLs) end up on their own line and may
 *  visually overflow the box, which matches the editor's CSS behavior
 *  with overflowWrap: break-word in practice for our short labels. */
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
