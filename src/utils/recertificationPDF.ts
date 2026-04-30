/**
 * SPCC recertification PDF workflow.
 *
 * Three steps the UI orchestrates:
 *
 *   1. fetchTemplate()
 *      Pulls the bundled "Approval by Management" template from /public.
 *
 *   2. stampRecertificationPage(templateBytes, fields)
 *      Overlays Facility Name, Location, and Date onto the blank lines on
 *      the template. Field positions are discovered dynamically by reading
 *      the template's text-layer with pdfjs-dist and locating the labels
 *      "Facility Name:", "Location:", and "Date:" — so the template can be
 *      swapped out without re-calibrating coordinates.
 *
 *   3. replacePageInPDF(sourceBytes, pageIndex, replacementPageBytes)
 *      Swaps a single page of the existing SPCC plan PDF for the freshly
 *      stamped page produced by step 2. Returns the merged document bytes
 *      ready to upload back to the same Supabase Storage URL.
 *
 * The page-picker UI separately uses `findApprovalByManagementPageIndex` to
 * suggest which page of the source to replace.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/** Bundled template lives in /public and is fetched with a relative URL. */
export const RECERTIFICATION_TEMPLATE_URL = '/spcc-recertification-template.pdf';

export interface RecertificationFieldValues {
  facilityName: string;
  /** Pre-formatted location string, e.g. "35.123456,-97.654321  |  Canadian County, OK" */
  location: string;
  /** Pre-formatted date string, e.g. "Apr 30, 2026" */
  date: string;
}

export interface FieldPosition {
  /** PDF points, bottom-left origin. Where the baseline of stamped text sits. */
  x: number;
  y: number;
}

/** Position of each label's stamping anchor on a single template page. */
export interface TemplateFieldPositions {
  facilityName: FieldPosition;
  location: FieldPosition;
  date: FieldPosition;
}

/** Fetch the bundled recertification template as bytes. */
export async function fetchTemplate(): Promise<ArrayBuffer> {
  const res = await fetch(RECERTIFICATION_TEMPLATE_URL);
  if (!res.ok) throw new Error(`Failed to fetch recertification template (${res.status})`);
  return res.arrayBuffer();
}

/**
 * Find the (x,y) baseline anchor for each fillable field on the template.
 *
 * Strategy: locate the label text item (e.g. "Facility Name:") and stamp
 * just to the right of it, on the same baseline. The X offset puts the
 * stamped text where the underline begins; the Y offset is zero (same
 * baseline as the label).
 *
 * pdfjs reports each text item with a `transform` matrix: [a,b,c,d,e,f]
 * where (e,f) is the position of the text in PDF points (bottom-left
 * origin) and `a` is the font scale. We pick the FIRST occurrence of each
 * label on the page since the template only renders each label once.
 */
export async function findTemplateFieldPositions(
  templateBytes: ArrayBuffer
): Promise<TemplateFieldPositions> {
  const pdf = await pdfjsLib.getDocument({ data: templateBytes.slice(0) }).promise;
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();

  // Distance from the right edge of the label to the start of the underline.
  // The template renders labels with a fixed gap before the blank line; this
  // gap is consistent across the three fields based on visual inspection.
  const X_GAP_AFTER_LABEL = 6;
  const Y_BASELINE_NUDGE = 0; // sit on the same baseline as the label

  type TextItem = { str: string; transform: number[]; width: number };
  const items = (content.items as unknown as TextItem[]).filter(it => typeof it.str === 'string');

  function findLabelEnd(label: string): FieldPosition {
    const it = items.find(i => i.str.trim().startsWith(label));
    if (!it) {
      throw new Error(
        `Recertification template missing expected label "${label}". The template may have been replaced — re-run findTemplateFieldPositions after re-uploading.`
      );
    }
    const x = it.transform[4] + (it.width ?? 0) + X_GAP_AFTER_LABEL;
    const y = it.transform[5] + Y_BASELINE_NUDGE;
    return { x, y };
  }

  return {
    facilityName: findLabelEnd('Facility Name:'),
    location: findLabelEnd('Location:'),
    date: findLabelEnd('Date:'),
  };
}

/**
 * Stamp the three values onto the template and return the resulting
 * single-page PDF as bytes.
 */
export async function stampRecertificationPage(
  templateBytes: ArrayBuffer,
  values: RecertificationFieldValues
): Promise<Uint8Array> {
  const positions = await findTemplateFieldPositions(templateBytes);

  const pdfDoc = await PDFDocument.load(templateBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.getPage(0);

  const FONT_SIZE = 11;
  const COLOR = rgb(0, 0, 0);

  page.drawText(values.facilityName, {
    x: positions.facilityName.x,
    y: positions.facilityName.y,
    size: FONT_SIZE,
    font,
    color: COLOR,
  });

  page.drawText(values.location, {
    x: positions.location.x,
    y: positions.location.y,
    size: FONT_SIZE,
    font,
    color: COLOR,
  });

  page.drawText(values.date, {
    x: positions.date.x,
    y: positions.date.y,
    size: FONT_SIZE,
    font,
    color: COLOR,
  });

  return pdfDoc.save();
}

/**
 * Replace a single page in `sourceBytes` with the (single-page) PDF in
 * `replacementPageBytes`. Returns the merged document bytes.
 *
 * `pageIndex` is 0-based.
 */
export async function replacePageInPDF(
  sourceBytes: ArrayBuffer,
  pageIndex: number,
  replacementPageBytes: Uint8Array
): Promise<Uint8Array> {
  const sourceDoc = await PDFDocument.load(sourceBytes);
  if (pageIndex < 0 || pageIndex >= sourceDoc.getPageCount()) {
    throw new Error(
      `Page index ${pageIndex + 1} is out of range for a ${sourceDoc.getPageCount()}-page document.`
    );
  }

  const replacementDoc = await PDFDocument.load(replacementPageBytes);
  if (replacementDoc.getPageCount() !== 1) {
    throw new Error(
      `Replacement PDF must have exactly 1 page, got ${replacementDoc.getPageCount()}.`
    );
  }

  const [copiedPage] = await sourceDoc.copyPages(replacementDoc, [0]);
  sourceDoc.removePage(pageIndex);
  sourceDoc.insertPage(pageIndex, copiedPage);

  return sourceDoc.save();
}

/**
 * Find the 0-based page index whose text contains "Approval by Management"
 * (case-insensitive). Returns null if not found.
 *
 * Used to auto-jump the page picker to the most likely target page so the
 * user only has to confirm.
 */
export async function findApprovalByManagementPageIndex(
  pdfBytes: ArrayBuffer
): Promise<number | null> {
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
  const target = /approval by management/i;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = (content.items as Array<{ str?: string }>)
      .map(it => it.str ?? '')
      .join(' ');
    if (target.test(pageText)) {
      return i - 1; // 0-based
    }
  }
  return null;
}

/** Helper: format a date string for the PDF Date field (e.g. "Apr 30, 2026"). */
export function formatRecertificationDate(isoOrTimestamp: string): string {
  const m = isoOrTimestamp.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return isoOrTimestamp;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[parseInt(m[2], 10) - 1];
  const day = parseInt(m[3], 10);
  const year = parseInt(m[1], 10);
  return `${month} ${day}, ${year}`;
}

/**
 * Build the location string in Israel's exact format:
 *   `35.123456,-97.654321  |  Canadian County, OK`
 *
 * - lat/long: 6 decimal places
 * - separator: two spaces, pipe, two spaces
 * - county: title-case + " County" suffix appended (unless already present)
 * - state: 2-letter uppercase code
 *
 * Returns null when essential pieces are missing — caller should refuse to
 * stamp rather than ship a half-formed location.
 */
export function buildLocationString(opts: {
  latitude: number | string | null | undefined;
  longitude: number | string | null | undefined;
  county: string | null | undefined;
  stateCode: string | null | undefined;
}): string | null {
  const lat = Number(opts.latitude);
  const lng = Number(opts.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const stateRaw = (opts.stateCode || '').trim().toUpperCase();
  if (stateRaw.length !== 2) return null;

  const countyRaw = (opts.county || '').trim();
  if (!countyRaw) return null;

  // Strip a trailing " County" if already present, then re-append once.
  const countyBase = countyRaw.replace(/\s+county\s*$/i, '');
  const county = `${countyBase} County`;

  return `${lat.toFixed(6)},${lng.toFixed(6)}  |  ${county}, ${stateRaw}`;
}
