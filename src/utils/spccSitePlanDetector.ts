import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * Detect which page of an SPCC plan PDF is the "Facility Site Plan" figure.
 *
 * SPCC plans from Baber Environmental (and most other consultants) follow a
 * predictable pattern around figures:
 *
 *   Page N    — minimal title page reading just:
 *                  "Figure 1"
 *                  "Facility Site Plan"
 *               (rest of the page blank)
 *
 *   Page N+1  — the actual figure: an aerial photo of the wellsite with
 *               yellow callout labels for each piece of equipment, plus a
 *               title block at the bottom containing "FACILITY SITE PLAN"
 *               and "FIGURE NO.: 1".
 *
 * Detection strategy is text-based — pdfjs.getTextContent() extracts the
 * embedded text from each page. We score each page on two patterns:
 *
 *   200 pts — the figure itself: text contains BOTH "Facility Site Plan"
 *             AND "Figure No" (the title block).
 *   150 pts — the title page: short page (<60 visible chars) containing
 *             "Figure N" + "Facility Site Plan". Detected page is the
 *             page AFTER this one.
 *
 * If neither pattern matches, returns { detectedPage: null } and the
 * caller surfaces a manual page picker.
 *
 * Limitation: scanned (image-only) SPCC PDFs with no embedded text layer
 * will return nothing — no text to scan. For V1 we assume modern OCR'd
 * PDFs, which is the universal standard for SPCC plans.
 */

export interface SitePlanCandidate {
  /** 1-based page number. */
  page: number;
  score: number;
  reason: string;
  /** True if this is a "Figure N / [Title]" title page — the actual
   *  figure is then on `page + 1`. */
  isTitlePage: boolean;
}

export interface SitePlanDetectionResult {
  /** 1-based page number of the facility site plan. Null when no
   *  candidate scored above 0 (e.g. scanned PDF without text). */
  detectedPage: number | null;
  /** Reason string for the user-facing "we picked this because…" hint. */
  reason: string;
  /** All scored pages, highest first. Useful for power-user overrides. */
  candidates: SitePlanCandidate[];
  /** Total page count, for the manual page picker. */
  numPages: number;
}

/**
 * Run detection on a PDF loaded from a URL. Caller owns the URL fetch
 * lifetime — we re-fetch ourselves here for a simple API surface, and so
 * a bad URL fails with a readable error message instead of pdfjs'
 * internals.
 */
export async function detectSitePlanPage(pdfUrl: string): Promise<SitePlanDetectionResult> {
  const resp = await fetch(pdfUrl);
  if (!resp.ok) {
    throw new Error(`Failed to fetch SPCC PDF (${resp.status})`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return await detectSitePlanInLoadedPdf(pdf);
}

export async function detectSitePlanInLoadedPdf(
  pdf: pdfjsLib.PDFDocumentProxy,
): Promise<SitePlanDetectionResult> {
  const candidates: SitePlanCandidate[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = (textContent.items as Array<{ str?: string }>)
      .map((item) => item.str ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    let score = 0;
    const reasonParts: string[] = [];
    let isTitlePage = false;

    const hasFigureNo = /figure\s*no/i.test(text);
    const hasFacilitySitePlan = /facility\s+site\s+plan/i.test(text);
    const hasFigureN = /figure\s+\d+/i.test(text);

    // Pattern 1: the actual figure page — title block carries both
    // "Facility Site Plan" and "Figure No." text.
    if (hasFacilitySitePlan && hasFigureNo) {
      score += 200;
      reasonParts.push('title block reads "Facility Site Plan" + "Figure No."');
    }

    // Pattern 2: the title page — very short, "Figure N" + "Facility Site Plan".
    const isShort = text.length < 60;
    if (isShort && hasFigureN && hasFacilitySitePlan) {
      score += 150;
      isTitlePage = true;
      reasonParts.push('minimal title page introducing the figure');
    }

    if (score > 0) {
      candidates.push({
        page: i,
        score,
        reason: reasonParts.join('; '),
        isTitlePage,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  let detectedPage: number | null = null;
  let reason = 'No facility site plan figure detected in this SPCC PDF.';
  if (best) {
    if (best.isTitlePage && best.page < pdf.numPages) {
      detectedPage = best.page + 1;
      reason = `Page ${best.page} is the "Figure" title page; the site plan figure is on page ${detectedPage}.`;
    } else {
      detectedPage = best.page;
      reason = `Page ${detectedPage}'s ${best.reason}.`;
    }
  }

  return {
    detectedPage,
    reason,
    candidates,
    numPages: pdf.numPages,
  };
}
