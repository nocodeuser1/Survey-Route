import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * Find the bounding box of a target string inside a single PDF page's text
 * content, normalized to 0..1 against the page viewport (top-left origin to
 * match the LDAR editor's coordinate system).
 *
 * Used by the LDAR editor to locate "FACILITY SITE PLAN" inside the title
 * block of the source PDF so an overlay can cover it and substitute
 * "LDAR OBSERVATION PLAN" in the exported version.
 *
 * Returns null if the text isn't found in a single pdfjs text item. We
 * don't currently support multi-item matches because real-world title
 * blocks have "FACILITY SITE PLAN" rendered as one drawing-call.
 *
 * @param pdfPage    A pdfjs PDFPageProxy (already loaded).
 * @param searchText Case-insensitive substring to find.
 */
export interface TextBoundingBox {
  /** Normalized 0..1 with origin at top-left of the page. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The actual text the match was found in (may be a longer string
   *  containing the search substring). */
  matchedText: string;
}

export async function findTextInPdfPage(
  pdfPage: pdfjsLib.PDFPageProxy,
  searchText: string,
): Promise<TextBoundingBox | null> {
  const viewport = pdfPage.getViewport({ scale: 1 });
  const textContent = await pdfPage.getTextContent();
  const target = searchText.toLowerCase().trim();
  if (!target) return null;

  for (const raw of textContent.items as Array<Record<string, unknown>>) {
    const str = typeof raw.str === 'string' ? raw.str : '';
    const transform = raw.transform as number[] | undefined;
    if (!str || !transform || transform.length < 6) continue;
    if (!str.toLowerCase().includes(target)) continue;
    return textItemToBoundingBox(raw, transform, str, viewport);
  }

  return null;
}

/**
 * Find a date value in the bottom portion of the page, matching common
 * formats (`M/D/YY`, `MM/DD/YYYY`, etc). Used to locate the "DATE:" value
 * cell of the title block so the export can substitute today's date.
 *
 * Restricted to the bottom 30% of the page by default — most facility
 * site plans have date cells in the title block at the very bottom, and
 * limiting the search prevents false positives from other dates that
 * might appear elsewhere on the page.
 */
export async function findDateInPdfPage(
  pdfPage: pdfjsLib.PDFPageProxy,
  options: { minNormalizedY?: number } = {},
): Promise<TextBoundingBox | null> {
  const minY = options.minNormalizedY ?? 0.7;
  const viewport = pdfPage.getViewport({ scale: 1 });
  const textContent = await pdfPage.getTextContent();
  // Match the entire item — anchor at start/end so we don't accidentally
  // catch a date embedded inside other text. Trim whitespace tolerantly.
  const datePattern = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*$/;

  for (const raw of textContent.items as Array<Record<string, unknown>>) {
    const str = typeof raw.str === 'string' ? raw.str : '';
    const transform = raw.transform as number[] | undefined;
    if (!str || !transform || transform.length < 6) continue;
    if (!datePattern.test(str)) continue;
    // Only accept matches in the bottom band — title-block dates only.
    const ty = transform[5];
    const normalizedBaseline = (viewport.height - ty) / viewport.height;
    if (normalizedBaseline < minY) continue;
    return textItemToBoundingBox(raw, transform, str, viewport);
  }
  return null;
}

/**
 * Shared helper: convert a pdfjs text item into a normalized 0..1
 * bounding box with origin at the page's top-left.
 *
 * The Y math is the tricky bit. pdfjs reports `transform[5]` (ty) as the
 * BASELINE position in PDF coords (origin bottom-left, Y axis up).
 * `item.height` (or |scaleY|) is the typographic height of the glyphs.
 * To convert to image coords (origin top-left, Y axis down):
 *   imageY_baseline = viewport.height - ty
 *   imageY_top_of_text = imageY_baseline - itemHeight
 *
 * Earlier this function used `viewport.height - ty - itemHeight * 0.15`
 * which placed the rect's TOP near the BASELINE — then the height
 * (1.2 * itemHeight) extended downward and covered the line below.
 * The fix is conceptually trivial: subtract the full itemHeight to
 * land at the actual top of the text, with a small bleed for ascenders.
 */
function textItemToBoundingBox(
  raw: Record<string, unknown>,
  transform: number[],
  str: string,
  viewport: { width: number; height: number },
): TextBoundingBox {
  const scaleY = Math.abs(transform[3]) || 12;
  const tx = transform[4];
  const ty = transform[5];
  const itemHeight =
    typeof raw.height === 'number' && raw.height > 0 ? raw.height : scaleY;
  const itemWidth =
    typeof raw.width === 'number' && raw.width > 0
      ? raw.width
      : str.length * itemHeight * 0.55;

  // Top of the actual text (top of the cap), with a tiny upward bleed
  // (~5% of itemHeight) so antialiased ascenders are fully covered.
  const baselineImgY = viewport.height - ty;
  const topImgY = baselineImgY - itemHeight - itemHeight * 0.05;
  // Total cover height = ascender bleed (top) + cap (itemHeight) + small
  // descender pad (bottom). 1.15 * itemHeight is enough for the
  // descender of letters like 'p', 'y' without bleeding into the next line.
  const coverH = itemHeight * 1.15;

  return {
    x: tx / viewport.width,
    y: topImgY / viewport.height,
    w: itemWidth / viewport.width,
    h: coverH / viewport.height,
    matchedText: str,
  };
}
