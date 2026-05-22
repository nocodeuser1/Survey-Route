import { PDFDocument } from 'pdf-lib';

/**
 * Copy a single page from an existing PDF into a new single-page PDF and
 * return it as a Blob. Used by the LDAR source-selector to extract the
 * facility-site-plan page from a multi-page SPCC plan and save it into
 * the ldar-site-plans bucket as a standalone artifact.
 *
 * Why pdf-lib (not pdfjs): pdfjs is a renderer, not an editor — it can't
 * write a new PDF. pdf-lib is already a dep (used by the recertification
 * + management-signature pipelines) and `copyPages` preserves the source
 * page exactly: fonts, embedded images, vector graphics, the title
 * block, everything. Re-rendering through canvas would lose the embedded
 * text layer (the AI's text-based detection wouldn't work later, and the
 * site-plan callout labels would be rasterized).
 *
 * @param sourceBytes  The source PDF bytes (typically `await fetch(url).then(r => r.arrayBuffer())`).
 * @param pageNumber   1-based page number to extract.
 * @returns A Blob of type `application/pdf` containing just that one page.
 */
export async function extractPageAsPdf(
  sourceBytes: ArrayBuffer | Uint8Array,
  pageNumber: number,
): Promise<Blob> {
  const sourceDoc = await PDFDocument.load(sourceBytes);
  if (pageNumber < 1 || pageNumber > sourceDoc.getPageCount()) {
    throw new Error(`Page ${pageNumber} out of range (PDF has ${sourceDoc.getPageCount()} pages)`);
  }
  const newDoc = await PDFDocument.create();
  const [copied] = await newDoc.copyPages(sourceDoc, [pageNumber - 1]);
  newDoc.addPage(copied);
  const bytes = await newDoc.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
