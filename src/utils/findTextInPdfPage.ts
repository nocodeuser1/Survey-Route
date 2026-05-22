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

    // pdfjs text-item transform = [scaleX, skewY, skewX, scaleY, tx, ty]
    // tx/ty are in PDF coords (origin bottom-left, y up). Item height comes
    // from |scaleY| since pdfjs stores the typographic height there.
    const scaleY = Math.abs(transform[3]) || 12;
    const tx = transform[4];
    const ty = transform[5];
    const itemHeight =
      typeof raw.height === 'number' && raw.height > 0 ? raw.height : scaleY;
    const itemWidth =
      typeof raw.width === 'number' && raw.width > 0
        ? raw.width
        : str.length * itemHeight * 0.55;
    // Convert PDF (y-up from bottom) to image (y-down from top) and
    // normalize to 0..1 against the page viewport.
    const imgYTop = viewport.height - ty - itemHeight * 0.15; // small lift so the rect overlay covers descenders cleanly
    return {
      x: tx / viewport.width,
      y: imgYTop / viewport.height,
      w: itemWidth / viewport.width,
      h: (itemHeight * 1.2) / viewport.height,
      matchedText: str,
    };
  }

  return null;
}
