import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface ExtractionRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FieldExtractionConfig {
  page: number;
  anchor_text: string;
  anchor_region: ExtractionRegion;
  value_offset: { dx: number; dy: number };
  value_size: { width: number; height: number };
  multi_line?: boolean;
}

export interface ExtractionConfig {
  facility_name: FieldExtractionConfig;
  pe_stamp_date: FieldExtractionConfig;
}

export interface PdfExtractionResult {
  file: File;
  text: string | null;
  error: string | null;
  pageCount: number;
  regionTexts?: {
    facilityName: string | null;
    peStampDate: string | null;
  };
}

/** Find the position of anchor text within a page's text content.
 *  Returns the position in relative coordinates (0-1). */
function findAnchorInTextContent(
  textContent: any,
  viewport: any,
  anchorText: string
): { x: number; y: number } | null {
  const anchorLower = anchorText.toLowerCase().trim();
  if (!anchorLower) return null;

  const items = (textContent.items as any[]).filter(
    (item: any) => item.transform && item.str
  );

  // Single item match
  for (const item of items) {
    if (item.str.toLowerCase().includes(anchorLower)) {
      const [, , , , tx, ty] = item.transform;
      return {
        x: tx / viewport.width,
        y: (viewport.height - ty) / viewport.height,
      };
    }
  }

  // Multi-item match: try combining adjacent items on the same line
  for (let i = 0; i < items.length; i++) {
    let combined = '';
    const startTy = items[i].transform[5];

    for (let j = i; j < items.length; j++) {
      if (Math.abs(items[j].transform[5] - startTy) > 5) break;
      combined += (j > i ? ' ' : '') + items[j].str;

      if (combined.toLowerCase().includes(anchorLower)) {
        const [, , , , tx, ty] = items[i].transform;
        return {
          x: tx / viewport.width,
          y: (viewport.height - ty) / viewport.height,
        };
      }
    }
  }

  return null;
}

/** Extract text from a specific region of a PDF page. */
function extractTextFromRegion(
  textContent: any,
  viewport: any,
  region: ExtractionRegion
): string {
  const regionLeft = region.x * viewport.width;
  const regionTop = region.y * viewport.height;
  const regionRight = (region.x + region.width) * viewport.width;
  const regionBottom = (region.y + region.height) * viewport.height;

  const matchingItems = (textContent.items as any[]).filter((item: any) => {
    if (!item.transform) return false;
    const [, , , , tx, ty] = item.transform;
    const itemHeight = item.height || 12;
    const itemTop = viewport.height - ty;
    const itemBottom = itemTop + itemHeight;
    const itemLeft = tx;
    const itemRight = tx + (item.width || 0);

    return itemLeft < regionRight && itemRight > regionLeft &&
           itemTop < regionBottom && itemBottom > regionTop;
  });

  return matchingItems.map((item: any) => item.str).join(' ').trim();
}

/** Extract a field value using anchor-relative positioning.
 *  Finds the anchor text on the page, then uses the offset to locate the value region. */
async function extractFieldValue(
  pdf: pdfjsLib.PDFDocumentProxy,
  fieldConfig: FieldExtractionConfig
): Promise<string> {
  if (fieldConfig.page < 1 || fieldConfig.page > pdf.numPages) return '';

  const page = await pdf.getPage(fieldConfig.page);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();

  // Find anchor text position in this PDF
  const anchorPos = findAnchorInTextContent(textContent, viewport, fieldConfig.anchor_text);

  // Use found anchor position, or fall back to the original anchor position from config
  const baseX = anchorPos ? anchorPos.x : fieldConfig.anchor_region.x;
  const baseY = anchorPos ? anchorPos.y : fieldConfig.anchor_region.y;

  let valueRegion: ExtractionRegion = {
    x: baseX + fieldConfig.value_offset.dx,
    y: baseY + fieldConfig.value_offset.dy,
    width: fieldConfig.value_size.width,
    height: fieldConfig.value_size.height,
  };

  // Expand height for multi-line fields
  if (fieldConfig.multi_line) {
    valueRegion = { ...valueRegion, height: valueRegion.height * 1.5 };
  }

  return extractTextFromRegion(textContent, viewport, valueRegion);
}

export async function extractTextFromPdf(
  file: File,
  config?: ExtractionConfig | null
): Promise<PdfExtractionResult> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    if (config) {
      const facilityName = await extractFieldValue(pdf, config.facility_name);
      const peStampDate = await extractFieldValue(pdf, config.pe_stamp_date);

      // Also get full page 1 text as fallback
      const page = await pdf.getPage(1);
      const textContent = await page.getTextContent();
      const text = textContent.items.map((item: any) => item.str).join(' ');

      return {
        file,
        text,
        error: null,
        pageCount: pdf.numPages,
        regionTexts: { facilityName, peStampDate },
      };
    }

    // Default: extract all text from page 1
    const page = await pdf.getPage(1);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    return { file, text, error: null, pageCount: pdf.numPages };
  } catch (err: any) {
    return { file, text: null, error: err.message || 'Failed to parse PDF', pageCount: 0 };
  }
}

export async function extractTextFromPdfs(
  files: File[],
  concurrency: number = 3,
  onProgress?: (completed: number, total: number) => void,
  config?: ExtractionConfig | null
): Promise<PdfExtractionResult[]> {
  const results: PdfExtractionResult[] = [];
  let completed = 0;

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(f => extractTextFromPdf(f, config)));
    results.push(...batchResults);
    completed += batchResults.length;
    onProgress?.(completed, files.length);
  }

  return results;
}
