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
  // Mutable fields for the review UI
  selectedFacilityId: string | null;
  overridePeDate: string; // YYYY-MM-DD or empty
  status: 'matched' | 'unmatched' | 'error';
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
  return extractions.map(extraction => {
    if (extraction.error || !extraction.text) {
      return {
        file: extraction.file,
        extractedText: extraction.text,
        extractionError: extraction.error,
        matchedFacility: null,
        matchConfidence: 'none' as const,
        matchedSubstring: null,
        detectedPeDate: null,
        selectedFacilityId: null,
        overridePeDate: '',
        status: 'error' as const,
      };
    }

    // If region-based extraction provided specific text, use that for matching
    let facilityMatchText = extraction.text;
    let peDateText = extraction.text;

    if (extraction.regionTexts) {
      if (extraction.regionTexts.facilityName) {
        facilityMatchText = extraction.regionTexts.facilityName;
      }
      if (extraction.regionTexts.peStampDate) {
        peDateText = extraction.regionTexts.peStampDate;
      }
    }

    const { facility, confidence, matchedSubstring } = matchFacilityFromText(facilityMatchText, facilities);

    // For PE date: if region text is available, try to parse it directly as a date first
    let detectedPeDate: string | null = null;
    if (extraction.regionTexts?.peStampDate) {
      // Try direct date parse from region text
      const dateMatch = peDateText.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
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
    if (!detectedPeDate) {
      detectedPeDate = extractPeStampDate(extraction.text);
    }

    return {
      file: extraction.file,
      extractedText: extraction.text,
      extractionError: null,
      matchedFacility: facility,
      matchConfidence: confidence,
      matchedSubstring,
      detectedPeDate,
      selectedFacilityId: facility?.id || null,
      overridePeDate: detectedPeDate || '',
      status: facility ? 'matched' as const : 'unmatched' as const,
    };
  });
}
