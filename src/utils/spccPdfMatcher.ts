import { Facility } from '../lib/supabase';
import { PdfExtractionResult } from './pdfExtractor';

export interface PdfMatchResult {
  file: File;
  extractedText: string | null;
  extractionError: string | null;
  matchedFacility: Facility | null;
  matchConfidence: 'exact' | 'partial' | 'none';
  matchedSubstring: string | null;
  detectedPeDate: string | null; // YYYY-MM-DD
  /**
   * How the matcher arrived at its choice. Surfaced in the review UI so the
   * user can quickly tell e.g. "this one matched on Camino ID — trust it"
   * vs "this one is a fuzzy text match — double-check".
   */
  matchSource: 'camino_id_filename' | 'filename_text' | 'pdf_text' | 'none';
  // Mutable fields for the review UI
  selectedFacilityId: string | null;
  overridePeDate: string; // YYYY-MM-DD or empty
  status: 'matched' | 'unmatched' | 'error';
}

/**
 * Pull a Camino facility id (like `OC20180067`) out of a PDF filename. The
 * Camino export format is `<Facility Name> - <CaminoID> - SPCC Plan/Renewal
 * (mm-dd-yy).pdf`. Returns null if no id pattern is present.
 */
export function extractCaminoIdFromFilename(filename: string): string | null {
  // OC followed by 6-12 digits — accommodates the OC[YYYY][NNN] convention.
  const m = filename.match(/\b(OC\d{6,12})\b/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Pull a date from a parenthesized filename suffix like `(01-13-25)`. Used to
 * pre-populate the PE-stamp / recertified date field in the review UI when
 * the PDF text extraction is noisy or empty.
 */
export function extractDateFromFilename(filename: string): string | null {
  const m = filename.match(/\((\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\)/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Try to match a filename's leading text (before " - OC..."). */
export function matchFacilityFromFilename(
  filename: string,
  facilities: Facility[]
): { facility: Facility | null; matchedSubstring: string | null } {
  // Strip extension + the "- OC..." suffix to get just the facility-name prefix.
  const base = filename.replace(/\.[a-z0-9]+$/i, '');
  const prefix = base.split(/\s*-\s*OC\d{6,12}\b/i)[0].trim();
  if (!prefix) return { facility: null, matchedSubstring: null };
  return {
    ...matchFacilityFromText(prefix, facilities),
    matchedSubstring: prefix,
  };
}

export function matchFacilityFromText(
  text: string,
  facilities: Facility[]
): { facility: Facility | null; confidence: 'exact' | 'partial' | 'none'; matchedSubstring: string | null } {
  const textLower = text.toLowerCase();
  let bestMatch: Facility | null = null;
  let bestMatchLength = 0;
  let bestConfidence: 'exact' | 'partial' | 'none' = 'none';
  let bestSubstring: string | null = null;

  for (const facility of facilities) {
    const facilityNameLower = facility.name.toLowerCase();
    if (textLower.includes(facilityNameLower)) {
      if (facilityNameLower.length > bestMatchLength) {
        bestMatch = facility;
        bestMatchLength = facilityNameLower.length;
        bestConfidence = 'exact';
        bestSubstring = facility.name;
      }
    }
  }

  if (!bestMatch) {
    for (const facility of facilities) {
      const words = facility.name.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      if (words.length === 0) continue;
      const matchingWords = words.filter(w => textLower.includes(w));
      const matchRatio = matchingWords.length / words.length;

      if (matchRatio >= 0.6 && matchingWords.length >= 2) {
        const score = matchingWords.join(' ').length;
        if (score > bestMatchLength) {
          bestMatch = facility;
          bestMatchLength = score;
          bestConfidence = 'partial';
          bestSubstring = matchingWords.join(' ');
        }
      }
    }
  }

  return { facility: bestMatch, confidence: bestConfidence, matchedSubstring: bestSubstring };
}

export function extractPeStampDate(text: string): string | null {
  const dateRegex = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/g;
  const keywordRegex = /\b(PE|P\.E\.|stamp|stamped|certified|professional engineer|seal)\b/gi;

  const keywordPositions: number[] = [];
  let km;
  while ((km = keywordRegex.exec(text)) !== null) {
    keywordPositions.push(km.index);
  }

  if (keywordPositions.length === 0) return null;

  let bestDate: string | null = null;
  let bestDistance = Infinity;
  let dm;

  while ((dm = dateRegex.exec(text)) !== null) {
    const datePos = dm.index;
    const minDistance = Math.min(...keywordPositions.map(kp => Math.abs(datePos - kp)));

    if (minDistance < bestDistance) {
      bestDistance = minDistance;
      const month = parseInt(dm[1], 10);
      const day = parseInt(dm[2], 10);
      let year = parseInt(dm[3], 10);
      if (year < 100) year += 2000;
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        bestDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
  }

  if (bestDistance > 300) return null;
  return bestDate;
}

export function matchPdfsToFacilities(
  extractions: PdfExtractionResult[],
  facilities: Facility[]
): PdfMatchResult[] {
  // Pre-build a lookup so the per-PDF Camino-ID match is O(1).
  const byCaminoId = new Map<string, Facility>();
  for (const f of facilities) {
    if (f.camino_facility_id) byCaminoId.set(f.camino_facility_id.toUpperCase(), f);
  }

  return extractions.map(extraction => {
    // Filename-based matching is tried first AND survives PDF-extraction
    // errors — when the file is named in the Camino export convention
    // (`<Facility> - OC<id> - SPCC Plan (mm-dd-yy).pdf`), both the id and
    // date are deterministic, so an unparseable PDF body doesn't block
    // matching the file to its destination facility.
    const filename = extraction.file.name;
    const caminoId = extractCaminoIdFromFilename(filename);
    let matched: Facility | null = null;
    let confidence: 'exact' | 'partial' | 'none' = 'none';
    let matchedSubstring: string | null = null;
    let matchSource: PdfMatchResult['matchSource'] = 'none';

    if (caminoId && byCaminoId.has(caminoId)) {
      matched = byCaminoId.get(caminoId)!;
      confidence = 'exact';
      matchedSubstring = caminoId;
      matchSource = 'camino_id_filename';
    }

    if (!matched) {
      const fnMatch = matchFacilityFromFilename(filename, facilities);
      if (fnMatch.facility) {
        matched = fnMatch.facility;
        confidence = 'exact';
        matchedSubstring = fnMatch.matchedSubstring;
        matchSource = 'filename_text';
      }
    }

    // PE date: filename's parenthesized date is the most reliable source
    // (Camino exports include it). Fall through to region-text + keyword
    // searching through extracted PDF text only when the filename has no date.
    let detectedPeDate: string | null = extractDateFromFilename(filename);

    if (!detectedPeDate && extraction.regionTexts?.peStampDate) {
      const dateMatch = extraction.regionTexts.peStampDate.match(
        /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/
      );
      if (dateMatch) {
        const month = parseInt(dateMatch[1], 10);
        const day = parseInt(dateMatch[2], 10);
        let year = parseInt(dateMatch[3], 10);
        if (year < 100) year += 2000;
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          detectedPeDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      }
    }
    if (!detectedPeDate && extraction.text) {
      detectedPeDate = extractPeStampDate(extraction.text);
    }

    // If neither filename matching nor the user-side extraction worked, we're
    // left with no facility match. Fall back to PDF-text matching when text
    // is available; otherwise return an unmatched/error result.
    if (!matched && extraction.text) {
      let facilityMatchText = extraction.text;
      if (extraction.regionTexts?.facilityName) {
        facilityMatchText = extraction.regionTexts.facilityName;
      }
      const r = matchFacilityFromText(facilityMatchText, facilities);
      if (r.facility) {
        matched = r.facility;
        confidence = r.confidence;
        matchedSubstring = r.matchedSubstring;
        matchSource = 'pdf_text';
      }
    }

    // Status: 'error' only when the extraction failed AND filename matching
    // also failed (i.e. there's nothing the user can act on without manual
    // facility selection). 'matched'/'unmatched' when filename matching gave
    // us at least a destination, even if the PDF body is unreadable.
    const status: PdfMatchResult['status'] = matched
      ? 'matched'
      : (extraction.error || !extraction.text)
        ? 'error'
        : 'unmatched';

    return {
      file: extraction.file,
      extractedText: extraction.text,
      extractionError: extraction.error,
      matchedFacility: matched,
      matchConfidence: confidence,
      matchedSubstring,
      detectedPeDate,
      matchSource,
      selectedFacilityId: matched?.id || null,
      overridePeDate: detectedPeDate || '',
      status,
    };
  });
}
