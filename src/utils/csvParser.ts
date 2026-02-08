import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ParsedFacility {
  name: string;
  latitude?: number;
  longitude?: number;
  // Well information
  matched_facility_name?: string;
  well_name_1?: string;
  well_name_2?: string;
  well_name_3?: string;
  well_name_4?: string;
  well_name_5?: string;
  well_name_6?: string;
  // API numbers
  well_api_1?: string;
  well_api_2?: string;
  well_api_3?: string;
  well_api_4?: string;
  well_api_5?: string;
  well_api_6?: string;
  api_numbers_combined?: string;
  // Alternative coordinates
  lat_well_sheet?: number;
  long_well_sheet?: number;
  // Date fields
  first_prod_date?: string;
  spcc_due_date?: string;
  spcc_inspection_date?: string;
  // New detail fields
  photos_taken?: boolean;
  field_visit_date?: string;
  estimated_oil_per_day?: number;
  berm_depth_inches?: number;
  berm_length?: number;
  berm_width?: number;
  initial_inspection_completed?: string;
  company_signature_date?: string;
  recertified_date?: string;
  county?: string;
  spcc_pe_stamp_date?: string;
}

export interface ColumnMapping {
  name: string | null;
  latitude: string | null;
  longitude: string | null;
  matched_facility_name?: string | null;
  well_name_1?: string | null;
  well_name_2?: string | null;
  well_name_3?: string | null;
  well_name_4?: string | null;
  well_name_5?: string | null;
  well_name_6?: string | null;
  well_api_1?: string | null;
  well_api_2?: string | null;
  well_api_3?: string | null;
  well_api_4?: string | null;
  well_api_5?: string | null;
  well_api_6?: string | null;
  api_numbers_combined?: string | null;
  lat_well_sheet?: string | null;
  long_well_sheet?: string | null;
  first_prod_date?: string | null;
  spcc_due_date?: string | null;
  spcc_inspection_date?: string | null;
  // New fields
  photos_taken?: string | null;
  field_visit_date?: string | null;
  estimated_oil_per_day?: string | null;
  berm_depth_inches?: string | null;
  berm_length?: string | null;
  berm_width?: string | null;
  initial_inspection_completed?: string | null;
  company_signature_date?: string | null;
  recertified_date?: string | null;
  county?: string | null;
  spcc_pe_stamp_date?: string | null;
}

export interface ParseResult {
  data: ParsedFacility[];
  columnMapping: ColumnMapping;
  errors: string[];
  warnings: string[];
  /** True when the import has no coordinates — existing facilities are matched by name */
  isUpdateOnly: boolean;
}

const nameVariations = [
  'name', 'facility', 'facility name', 'location', 'site', 'site name',
  'facility_name', 'location_name', 'site_name', 'facilityname',
  'well name'
];

const latVariations = [
  'lat', 'latitude', 'lat.', 'y', 'lat_deg', 'latitude_deg'
];

const lonVariations = [
  'lon', 'lng', 'long', 'longitude', 'lon.', 'lng.', 'long.',
  'x', 'lon_deg', 'lng_deg', 'longitude_deg'
];

const matchedFacilityNameVariations = [
  'matched facility name', 'matched facility name from well list', 'matched_facility_name',
  'matched name', 'facility match'
];

const wellNameVariations = (num: number) => [
  `well_name_${num}`, `well name ${num}`, `well_${num}`, `well${num}`,
  `wellname_${num}`, `wellname${num}`
];

const wellApiVariations = (num: number) => [
  `well ${num} api`, `well_${num}_api`, `well${num}_api`, `well_api_${num}`,
  `api_${num}`, `api${num}`, `well${num}api`
];

const apiCombinedVariations = [
  'api numbers (combined)', 'api numbers', 'combined api', 'api_numbers_combined',
  'api_combined', 'combined_api_numbers'
];

const latWellSheetVariations = [
  'lat_well sheet', 'lat well sheet', 'latitude well sheet', 'well sheet lat',
  'well sheet latitude', 'lat_well_sheet'
];

const longWellSheetVariations = [
  'long_well sheet', 'long well sheet', 'longitude well sheet', 'well sheet long',
  'well sheet longitude', 'long_well_sheet'
];

const firstProdVariations = [
  'first_prod', 'first prod', 'first production', 'first production date',
  'first_prod_date', 'prod_date'
];

const spccDueDateVariations = [
  'spcc due date', 'spcc due date (on or before)', 'spcc_due_date',
  'due date', 'spcc deadline',
  'pe stamp due date'
];

const spccCompletedVariations = [
  'spcc completed date', 'spcc_inspection_date', 'spcc complete date',
  'completed date', 'spcc completion'
];

// New field variations
const photosTakenVariations = [
  'photos taken', 'photos_taken', 'photos', 'photo taken'
];

const fieldVisitVariations = [
  'field visit', 'field_visit', 'field visit date', 'field_visit_date',
  'visit date', 'site visit'
];

const estimatedOilVariations = [
  'estimated oil bopd', 'estimated oil', 'est oil', 'bopd',
  'estimated_oil_per_day', 'oil per day', 'estimated oil per day',
  'oil bopd', 'est. oil/day'
];

const bermDepthVariations = [
  'berm depth', 'berm depth / height', 'berm depth / height (inches)',
  'berm depth/height', 'berm_depth_inches', 'berm height',
  'berm depth (inches)', 'berm depth inches'
];

const bermLengthVariations = [
  'berm length', 'berm_length'
];

const bermWidthVariations = [
  'berm width', 'berm_width'
];

const initialInspectionVariations = [
  'initial inspection completed', 'initial inspection', 'initial_inspection_completed',
  'initial_inspection', 'first inspection'
];

const companySignatureVariations = [
  'camino signature date', 'company signature date', 'company_signature_date',
  'signature date', 'company signature', 'camino signature'
];

const recertifiedVariations = [
  'recertified date', 'recertified_date', 'recertified',
  'recertification date'
];

const countyVariations = [
  'county', 'county name'
];

const peStampDateVariations = [
  'pe stamp date', 'pe_stamp_date', 'spcc_pe_stamp_date',
  'pe stamp', 'pe date'
];

function findColumn(headers: string[], variations: string[]): string | null {
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());

  for (const variation of variations) {
    const index = lowerHeaders.indexOf(variation);
    if (index !== -1) {
      return headers[index];
    }
  }

  for (const variation of variations) {
    const index = lowerHeaders.findIndex(h => h.includes(variation));
    if (index !== -1) {
      return headers[index];
    }
  }

  return null;
}

export function detectColumns(headers: string[]): ColumnMapping {
  return {
    name: findColumn(headers, nameVariations),
    latitude: findColumn(headers, latVariations),
    longitude: findColumn(headers, lonVariations),
    matched_facility_name: findColumn(headers, matchedFacilityNameVariations),
    well_name_1: findColumn(headers, wellNameVariations(1)),
    well_name_2: findColumn(headers, wellNameVariations(2)),
    well_name_3: findColumn(headers, wellNameVariations(3)),
    well_name_4: findColumn(headers, wellNameVariations(4)),
    well_name_5: findColumn(headers, wellNameVariations(5)),
    well_name_6: findColumn(headers, wellNameVariations(6)),
    well_api_1: findColumn(headers, wellApiVariations(1)),
    well_api_2: findColumn(headers, wellApiVariations(2)),
    well_api_3: findColumn(headers, wellApiVariations(3)),
    well_api_4: findColumn(headers, wellApiVariations(4)),
    well_api_5: findColumn(headers, wellApiVariations(5)),
    well_api_6: findColumn(headers, wellApiVariations(6)),
    api_numbers_combined: findColumn(headers, apiCombinedVariations),
    lat_well_sheet: findColumn(headers, latWellSheetVariations),
    long_well_sheet: findColumn(headers, longWellSheetVariations),
    first_prod_date: findColumn(headers, firstProdVariations),
    spcc_due_date: findColumn(headers, spccDueDateVariations),
    spcc_inspection_date: findColumn(headers, spccCompletedVariations),
    photos_taken: findColumn(headers, photosTakenVariations),
    field_visit_date: findColumn(headers, fieldVisitVariations),
    estimated_oil_per_day: findColumn(headers, estimatedOilVariations),
    berm_depth_inches: findColumn(headers, bermDepthVariations),
    berm_length: findColumn(headers, bermLengthVariations),
    berm_width: findColumn(headers, bermWidthVariations),
    initial_inspection_completed: findColumn(headers, initialInspectionVariations),
    company_signature_date: findColumn(headers, companySignatureVariations),
    recertified_date: findColumn(headers, recertifiedVariations),
    county: findColumn(headers, countyVariations),
    spcc_pe_stamp_date: findColumn(headers, peStampDateVariations),
  };
}

function isValidCoordinate(lat: number, lon: number): boolean {
  return (
    !isNaN(lat) &&
    !isNaN(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/**
 * Normalize a date value to YYYY-MM-DD.
 * Handles Excel serial numbers, Date objects, and common string formats.
 */
function normalizeDate(value: any): string | undefined {
  if (value == null || value === '') return undefined;

  // Excel serial date number
  if (typeof value === 'number' && value > 1000) {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) {
      const y = date.y;
      const m = String(date.m).padStart(2, '0');
      const d = String(date.d).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  // Already a Date object (xlsx can return these)
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return undefined;
    return value.toISOString().split('T')[0];
  }

  const str = String(value).trim();
  if (!str || str.toLowerCase() === 'nan' || str.toLowerCase() === 'nat') return undefined;

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.substring(0, 10);
  }

  // MM/DD/YY or MM/DD/YYYY or M/D/YY
  const match = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (match) {
    const month = match[1].padStart(2, '0');
    const day = match[2].padStart(2, '0');
    let year = match[3];
    if (year.length === 2) {
      const num = parseInt(year);
      year = (num > 50 ? '19' : '20') + year;
    }
    return `${year}-${month}-${day}`;
  }

  // Try native Date parse as last resort
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return undefined;
}

/** Parse a numeric value, returning undefined for non-numeric or garbage values */
function parseNumeric(value: any): number | undefined {
  if (value == null || value === '') return undefined;
  const str = String(value).trim();
  if (!str || str === '??' || str.toLowerCase() === 'nan') return undefined;
  const num = parseFloat(str);
  return isNaN(num) ? undefined : num;
}

/** Parse a boolean-ish value from the spreadsheet */
function parseBool(value: any): boolean | undefined {
  if (value == null || value === '') return undefined;
  const str = String(value).trim().toLowerCase();
  if (!str || str === 'nan') return undefined;
  return str === 'true' || str === 'yes' || str === 'y' || str === '1' || str === 'x';
}

/**
 * Process a single row of data into a ParsedFacility.
 * Returns the facility, or null if the row should be skipped.
 */
function processRow(
  row: Record<string, any>,
  columnMapping: ColumnMapping,
  rowIndex: number,
  hasCoords: boolean,
  warnings: string[]
): ParsedFacility | null {
  const name = row[columnMapping.name!]?.toString().trim();

  if (!name) {
    warnings.push(`Row ${rowIndex}: Missing facility name - skipped`);
    return null;
  }

  const facility: ParsedFacility = { name };

  // Coordinates (optional for update-only imports)
  if (hasCoords && columnMapping.latitude && columnMapping.longitude) {
    const latStr = row[columnMapping.latitude];
    const lonStr = row[columnMapping.longitude];
    const latitude = parseFloat(latStr);
    const longitude = parseFloat(lonStr);

    if (!isValidCoordinate(latitude, longitude)) {
      warnings.push(
        `Row ${rowIndex}: Invalid coordinates for "${name}" (${latStr || ''}, ${lonStr || ''}) - skipped`
      );
      return null;
    }
    facility.latitude = latitude;
    facility.longitude = longitude;
  }

  // Well information
  if (columnMapping.matched_facility_name && row[columnMapping.matched_facility_name]) {
    facility.matched_facility_name = row[columnMapping.matched_facility_name]?.toString().trim();
  }
  for (let i = 1; i <= 6; i++) {
    const wellNameKey = `well_name_${i}` as keyof ColumnMapping;
    if (columnMapping[wellNameKey] && row[columnMapping[wellNameKey]!]) {
      (facility as any)[wellNameKey] = row[columnMapping[wellNameKey]!]?.toString().trim();
    }
  }
  for (let i = 1; i <= 6; i++) {
    const wellApiKey = `well_api_${i}` as keyof ColumnMapping;
    if (columnMapping[wellApiKey] && row[columnMapping[wellApiKey]!]) {
      (facility as any)[wellApiKey] = row[columnMapping[wellApiKey]!]?.toString().trim();
    }
  }
  if (columnMapping.api_numbers_combined && row[columnMapping.api_numbers_combined]) {
    facility.api_numbers_combined = row[columnMapping.api_numbers_combined]?.toString().trim();
  }

  // Well sheet coordinates
  if (columnMapping.lat_well_sheet && row[columnMapping.lat_well_sheet]) {
    const val = parseNumeric(row[columnMapping.lat_well_sheet]);
    if (val !== undefined) facility.lat_well_sheet = val;
  }
  if (columnMapping.long_well_sheet && row[columnMapping.long_well_sheet]) {
    const val = parseNumeric(row[columnMapping.long_well_sheet]);
    if (val !== undefined) facility.long_well_sheet = val;
  }

  // Date fields
  if (columnMapping.first_prod_date && row[columnMapping.first_prod_date] != null) {
    facility.first_prod_date = normalizeDate(row[columnMapping.first_prod_date]);
  }
  if (columnMapping.spcc_due_date && row[columnMapping.spcc_due_date] != null) {
    facility.spcc_due_date = normalizeDate(row[columnMapping.spcc_due_date]);
  }
  if (columnMapping.spcc_inspection_date && row[columnMapping.spcc_inspection_date] != null) {
    facility.spcc_inspection_date = normalizeDate(row[columnMapping.spcc_inspection_date]);
  }

  // New detail fields
  if (columnMapping.photos_taken && row[columnMapping.photos_taken] != null) {
    facility.photos_taken = parseBool(row[columnMapping.photos_taken]);
  }
  if (columnMapping.field_visit_date && row[columnMapping.field_visit_date] != null) {
    facility.field_visit_date = normalizeDate(row[columnMapping.field_visit_date]);
  }
  if (columnMapping.estimated_oil_per_day && row[columnMapping.estimated_oil_per_day] != null) {
    facility.estimated_oil_per_day = parseNumeric(row[columnMapping.estimated_oil_per_day]);
  }
  if (columnMapping.berm_depth_inches && row[columnMapping.berm_depth_inches] != null) {
    facility.berm_depth_inches = parseNumeric(row[columnMapping.berm_depth_inches]);
  }
  if (columnMapping.berm_length && row[columnMapping.berm_length] != null) {
    facility.berm_length = parseNumeric(row[columnMapping.berm_length]);
  }
  if (columnMapping.berm_width && row[columnMapping.berm_width] != null) {
    facility.berm_width = parseNumeric(row[columnMapping.berm_width]);
  }
  if (columnMapping.initial_inspection_completed && row[columnMapping.initial_inspection_completed] != null) {
    facility.initial_inspection_completed = normalizeDate(row[columnMapping.initial_inspection_completed]);
  }
  if (columnMapping.company_signature_date && row[columnMapping.company_signature_date] != null) {
    facility.company_signature_date = normalizeDate(row[columnMapping.company_signature_date]);
  }
  if (columnMapping.recertified_date && row[columnMapping.recertified_date] != null) {
    facility.recertified_date = normalizeDate(row[columnMapping.recertified_date]);
  }
  if (columnMapping.county && row[columnMapping.county] != null) {
    const county = row[columnMapping.county]?.toString().trim();
    if (county && county.toLowerCase() !== 'nan') facility.county = county;
  }
  if (columnMapping.spcc_pe_stamp_date && row[columnMapping.spcc_pe_stamp_date] != null) {
    facility.spcc_pe_stamp_date = normalizeDate(row[columnMapping.spcc_pe_stamp_date]);
  }

  return facility;
}

export function parseCSV(file: File): Promise<ParseResult> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const errors: string[] = [];
        const warnings: string[] = [];
        const headers = results.meta.fields || [];

        if (headers.length === 0) {
          resolve({
            data: [],
            columnMapping: { name: null, latitude: null, longitude: null },
            errors: ['CSV file has no headers'],
            warnings: [],
            isUpdateOnly: false,
          });
          return;
        }

        const columnMapping = detectColumns(headers);

        if (!columnMapping.name) {
          errors.push('Could not detect facility name column');
          resolve({ data: [], columnMapping, errors, warnings: [], isUpdateOnly: false });
          return;
        }

        const hasCoords = !!(columnMapping.latitude && columnMapping.longitude);
        if (!hasCoords) {
          // No coordinates columns — this is an update-only import
          warnings.push('No coordinate columns found — facilities will be matched by name to update existing records.');
        }

        const facilities: ParsedFacility[] = [];

        results.data.forEach((row: any, index: number) => {
          const facility = processRow(row, columnMapping, index + 2, hasCoords, warnings);
          if (facility) facilities.push(facility);
        });

        if (facilities.length === 0 && errors.length === 0) {
          errors.push('No valid facility data found in file');
        }

        resolve({
          data: facilities,
          columnMapping,
          errors,
          warnings,
          isUpdateOnly: !hasCoords,
        });
      },
      error: (error) => {
        resolve({
          data: [],
          columnMapping: { name: null, latitude: null, longitude: null },
          errors: [`Failed to parse CSV: ${error.message}`],
          warnings: [],
          isUpdateOnly: false,
        });
      },
    });
  });
}

export async function parseExcelFile(file: File): Promise<ParseResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return {
        data: [],
        columnMapping: { name: null, latitude: null, longitude: null },
        errors: ['Excel file has no sheets'],
        warnings: [],
        isUpdateOnly: false,
      };
    }

    const sheet = workbook.Sheets[sheetName];
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) {
      return {
        data: [],
        columnMapping: { name: null, latitude: null, longitude: null },
        errors: ['Excel sheet is empty'],
        warnings: [],
        isUpdateOnly: false,
      };
    }

    // Normalize row keys: collapse whitespace/newlines so "Camino\r\nSignature Date" → "Camino Signature Date"
    const normalizedRows = rows.map(row => {
      const clean: Record<string, any> = {};
      for (const [key, value] of Object.entries(row)) {
        const normalizedKey = key.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
        if (!normalizedKey.startsWith('__EMPTY')) {
          clean[normalizedKey] = value;
        }
      }
      return clean;
    });

    const headers = Object.keys(normalizedRows[0] || {});
    const columnMapping = detectColumns(headers);

    if (!columnMapping.name) {
      errors.push('Could not detect facility name column');
      return { data: [], columnMapping, errors, warnings: [], isUpdateOnly: false };
    }

    const hasCoords = !!(columnMapping.latitude && columnMapping.longitude);
    if (!hasCoords) {
      warnings.push('No coordinate columns found — facilities will be matched by name to update existing records.');
    }

    const facilities: ParsedFacility[] = [];

    normalizedRows.forEach((row, index) => {
      const facility = processRow(row, columnMapping, index + 2, hasCoords, warnings);
      if (facility) facilities.push(facility);
    });

    if (facilities.length === 0 && errors.length === 0) {
      errors.push('No valid facility data found in file');
    }

    return {
      data: facilities,
      columnMapping,
      errors,
      warnings,
      isUpdateOnly: !hasCoords,
    };
  } catch (err: any) {
    return {
      data: [],
      columnMapping: { name: null, latitude: null, longitude: null },
      errors: [`Failed to parse Excel file: ${err.message || 'Unknown error'}`],
      warnings: [],
      isUpdateOnly: false,
    };
  }
}
