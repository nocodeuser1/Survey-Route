/**
 * Management-signature stamping for SPCC plan PDFs.
 *
 * Stamps the user's saved signature image plus the PE-stamp date onto two
 * pages of an existing SPCC plan PDF:
 *
 *   §5.2  Approval by Management
 *         - "Signature:" line  → signature image
 *         - "Date:" line       → PE-stamp date (mm/dd/yy)
 *
 *   §5.3  Certification of the Applicability of the Substantial Harm Criteria
 *         - "Signature:" line  → signature image
 *         - "Date:" line       → PE-stamp date (mm/dd/yy)
 *
 * Pages are identified by content text (case-insensitive substring) so the
 * template's actual page numbers don't matter. Label positions on each page
 * are discovered with pdfjs' text-content extraction so we don't have to
 * hand-calibrate coordinates per template variant.
 *
 * Separate from `recertificationPDF.ts` because the recert flow REPLACES a
 * whole page with a fresh stamped page; the management-signature flow only
 * overlays a couple of marks on existing pages.
 */

import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

/** Find pages by content keywords. 0-based indices, null when not present. */
export async function findSignaturePagesInPDF(pdfBytes: ArrayBuffer): Promise<{
  managementApprovalIndex: number | null;
  substantialHarmIndex: number | null;
}> {
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
  let mgmt: number | null = null;
  let harm: number | null = null;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = (content.items as Array<{ str?: string }>)
      .map((it) => it.str ?? '')
      .join(' ');
    if (mgmt === null && /approval by management/i.test(pageText)) mgmt = i - 1;
    if (harm === null && /substantial harm criteria/i.test(pageText)) harm = i - 1;
    if (mgmt !== null && harm !== null) break;
  }
  return { managementApprovalIndex: mgmt, substantialHarmIndex: harm };
}

/**
 * Pull the (x,y) baseline + width of a label on a specific page, or null
 * if the label isn't there. Uses pdfjs' text-content transform matrix:
 * transform[4]=x, transform[5]=y (PDF points, bottom-left origin).
 *
 * We deliberately match the FIRST occurrence of the label. Both signing
 * pages have exactly one "Signature:" and one "Date:" each.
 */
async function findLabelAnchor(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNumOneBased: number,
  label: string,
): Promise<{ x: number; y: number; width: number } | null> {
  const page = await pdf.getPage(pageNumOneBased);
  const content = await page.getTextContent();
  const items = (content.items as unknown as TextItem[]).filter(
    (it) => typeof it.str === 'string',
  );
  const target = items.find((i) =>
    i.str.trim().toLowerCase().startsWith(label.toLowerCase()),
  );
  if (!target) return null;
  return {
    x: target.transform[4],
    y: target.transform[5],
    width: target.width || 0,
  };
}

/** `data:image/png;base64,...` → raw PNG bytes. */
function dataUrlToPngBytes(dataUrl: string): Uint8Array {
  const idx = dataUrl.indexOf(',');
  if (idx < 0) throw new Error('signature_data is not a data URL');
  const b64 = dataUrl.slice(idx + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** ISO YYYY-MM-DD → "mm/dd/yy" matching Israel's hand-written sample. */
export function formatPeDateShort(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1].slice(2)}`;
}

/**
 * Stamp signature + PE-stamp date onto §5.2 and §5.3 of an SPCC plan PDF.
 * Returns the merged bytes ready to re-upload to Supabase Storage.
 *
 * Calibration notes:
 *   - SIG_WIDTH/HEIGHT picked so the saved signature fits within the
 *     underline width without overflow on either page. 110×22 is the same
 *     ratio inspections use.
 *   - X gaps after each label match the recertification template's
 *     calibration pass (~6pt). Tweak per-template if the line doesn't
 *     line up — the position function returns the underline start.
 *   - Y nudge raises the signature image so its baseline sits on the
 *     underline rather than on top of it (PNG images draw bottom-up).
 */
export async function stampManagementSignature(opts: {
  sourcePdfBytes: ArrayBuffer;
  signatureDataUrl: string;
  peStampDateIso: string; // YYYY-MM-DD
}): Promise<Uint8Array> {
  const { sourcePdfBytes, signatureDataUrl, peStampDateIso } = opts;
  const dateLabel = formatPeDateShort(peStampDateIso);

  const pages = await findSignaturePagesInPDF(sourcePdfBytes);
  if (pages.managementApprovalIndex === null && pages.substantialHarmIndex === null) {
    throw new Error(
      'Neither the Approval by Management page (§5.2) nor the Substantial Harm Criteria page (§5.3) was found in this PDF.',
    );
  }

  // Two doc handles: pdfjs for text-position scanning, pdf-lib for stamping.
  const pdfjsDoc = await pdfjsLib.getDocument({ data: sourcePdfBytes.slice(0) }).promise;
  const pdfDoc = await PDFDocument.load(sourcePdfBytes);
  const sigImage = await pdfDoc.embedPng(dataUrlToPngBytes(signatureDataUrl));
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const SIG_WIDTH = 110;
  const SIG_HEIGHT = 22;
  const SIG_X_GAP = 6;
  const SIG_VERTICAL_NUDGE = -4; // negative = lower; tunes baseline alignment
  const DATE_X_GAP = 6;
  const DATE_FONT_SIZE = 10;

  const stampPage = async (zeroBasedIndex: number) => {
    const page = pdfDoc.getPage(zeroBasedIndex);
    const sigPos = await findLabelAnchor(pdfjsDoc, zeroBasedIndex + 1, 'Signature:');
    const datePos = await findLabelAnchor(pdfjsDoc, zeroBasedIndex + 1, 'Date:');
    if (sigPos) {
      page.drawImage(sigImage, {
        x: sigPos.x + sigPos.width + SIG_X_GAP,
        y: sigPos.y + SIG_VERTICAL_NUDGE,
        width: SIG_WIDTH,
        height: SIG_HEIGHT,
      });
    }
    if (datePos) {
      page.drawText(dateLabel, {
        x: datePos.x + datePos.width + DATE_X_GAP,
        y: datePos.y,
        size: DATE_FONT_SIZE,
        font,
      });
    }
  };

  if (pages.managementApprovalIndex !== null) {
    await stampPage(pages.managementApprovalIndex);
  }
  if (pages.substantialHarmIndex !== null) {
    await stampPage(pages.substantialHarmIndex);
  }

  return pdfDoc.save();
}
