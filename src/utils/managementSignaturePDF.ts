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
 * Tries three matching strategies in order so the function copes with
 * different SPCC plan templates:
 *   1. A single text item that starts with the label (e.g. "Signature: ___").
 *   2. A single text item whose trimmed value EQUALS the label
 *      (e.g. just "Signature:" with the underline rendered separately).
 *   3. Adjacent items whose concatenated value starts with the label
 *      (e.g. "Signature" + ":" split across font-run boundaries).
 *
 * The first match wins. Returns null if none of the strategies hit.
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
  const labelLower = label.toLowerCase();
  const labelLowerNoColon = labelLower.replace(/:\s*$/, '');

  // Strategy 1: single item starts with the label.
  const startsWith = items.find((i) =>
    i.str.trim().toLowerCase().startsWith(labelLower),
  );
  if (startsWith) {
    return {
      x: startsWith.transform[4],
      y: startsWith.transform[5],
      width: startsWith.width || 0,
    };
  }

  // Strategy 2: single item equals the label (with or without the trailing colon).
  const equals = items.find((i) => {
    const t = i.str.trim().toLowerCase();
    return t === labelLower || t === labelLowerNoColon;
  });
  if (equals) {
    return {
      x: equals.transform[4],
      y: equals.transform[5],
      width: equals.width || 0,
    };
  }

  // Strategy 3: adjacent items concatenated start with the label
  //   (e.g. "Signature" + ":" + " " split across runs).
  for (let i = 0; i < items.length; i++) {
    let combined = items[i].str.trim().toLowerCase();
    if (combined.length === 0) continue;
    let widthSum = items[i].width || 0;
    for (let j = i + 1; j < Math.min(i + 5, items.length); j++) {
      combined += items[j].str.trim().toLowerCase();
      widthSum += items[j].width || 0;
      if (combined.startsWith(labelLower)) {
        return {
          x: items[i].transform[4],
          y: items[i].transform[5],
          width: widthSum,
        };
      }
      // Stop expanding once we've outgrown the label length to keep it cheap.
      if (combined.length > labelLower.length + 4) break;
    }
  }

  return null;
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

  let stampsApplied = 0;
  const missReport: string[] = [];

  const stampPage = async (zeroBasedIndex: number, sectionLabel: string) => {
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
      stampsApplied++;
    } else {
      missReport.push(`${sectionLabel}: "Signature:" label not found`);
    }
    if (datePos) {
      page.drawText(dateLabel, {
        x: datePos.x + datePos.width + DATE_X_GAP,
        y: datePos.y,
        size: DATE_FONT_SIZE,
        font,
      });
      stampsApplied++;
    } else {
      missReport.push(`${sectionLabel}: "Date:" label not found`);
    }

    if (!sigPos || !datePos) {
      // Dump the first chunk of text items so the user can paste the console
      // output back and we can calibrate to whatever the template actually
      // uses. Cheap to log; only fires on misses.
      try {
        const p = await pdfjsDoc.getPage(zeroBasedIndex + 1);
        const content = await p.getTextContent();
        const items = (content.items as Array<{ str?: string }>)
          .map((it) => (it.str ?? '').trim())
          .filter((s) => s.length > 0)
          .slice(0, 80);
        // eslint-disable-next-line no-console
        console.warn(
          `[managementSignaturePDF] ${sectionLabel} (page ${zeroBasedIndex + 1}) — labels missed. First text items:`,
          items,
        );
      } catch {
        /* logging best-effort */
      }
    }
  };

  if (pages.managementApprovalIndex !== null) {
    await stampPage(pages.managementApprovalIndex, '§5.2 Approval by Management');
  }
  if (pages.substantialHarmIndex !== null) {
    await stampPage(pages.substantialHarmIndex, '§5.3 Substantial Harm Criteria');
  }

  if (stampsApplied === 0) {
    throw new Error(
      `Couldn't find any "Signature:" or "Date:" labels on §5.2 or §5.3 of this PDF, so nothing was stamped. The template may differ from the expected layout. Details: ${missReport.join('; ')}. Open the browser console for the list of text items extracted from the matched pages.`,
    );
  }

  return pdfDoc.save();
}
