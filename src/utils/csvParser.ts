import Papa from 'papaparse';

export interface ParsedFacility {
  name: string;
  latitude: number;
  longitude: number;
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
}

export interface ParseResult {
  data: ParsedFacility[];
  columnMapping: ColumnMapping;
  errors: string[];
  warnings: string[];
}

const nameVariations = [
  'name', 'facility', 'facility name', 'location', 'site', 'site name',
  'facility_name', 'location_name', 'site_name', 'facilityname'
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
  'due date', 'spcc deadline'
];

const spccCompletedVariations = [
  'spcc completed date', 'spcc_inspection_date', 'spcc complete date',
  'completed date', 'spcc completion'
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
          });
          return;
        }

        const columnMapping = detectColumns(headers);

        if (!columnMapping.name) {
          errors.push('Could not detect facility name column');
        }
        if (!columnMapping.latitude) {
          errors.push('Could not detect latitude column');
        }
        if (!columnMapping.longitude) {
          errors.push('Could not detect longitude column');
        }

        if (!columnMapping.name || !columnMapping.latitude || !columnMapping.longitude) {
          resolve({
            data: [],
            columnMapping,
            errors,
            warnings: [],
          });
          return;
        }

        const facilities: ParsedFacility[] = [];

        results.data.forEach((row: any, index: number) => {
          const name = row[columnMapping.name!]?.trim();
          const latStr = row[columnMapping.latitude!];
          const lonStr = row[columnMapping.longitude!];

          if (!name) {
            warnings.push(`Row ${index + 2}: Missing facility name - skipped`);
            return;
          }

          const latitude = parseFloat(latStr);
          const longitude = parseFloat(lonStr);

          if (!isValidCoordinate(latitude, longitude)) {
            warnings.push(
              `Row ${index + 2}: Invalid coordinates for "${name}" (${latStr || ''}, ${lonStr || ''}) - skipped`
            );
            return;
          }

          // Extract all optional fields
          const facility: ParsedFacility = {
            name,
            latitude,
            longitude,
          };

          // Add well information if available
          if (columnMapping.matched_facility_name && row[columnMapping.matched_facility_name]) {
            facility.matched_facility_name = row[columnMapping.matched_facility_name]?.trim();
          }

          for (let i = 1; i <= 6; i++) {
            const wellNameKey = `well_name_${i}` as keyof ColumnMapping;
            if (columnMapping[wellNameKey] && row[columnMapping[wellNameKey]!]) {
              (facility as any)[wellNameKey] = row[columnMapping[wellNameKey]!]?.trim();
            }
          }

          // Add API numbers if available
          for (let i = 1; i <= 6; i++) {
            const wellApiKey = `well_api_${i}` as keyof ColumnMapping;
            if (columnMapping[wellApiKey] && row[columnMapping[wellApiKey]!]) {
              (facility as any)[wellApiKey] = row[columnMapping[wellApiKey]!]?.trim();
            }
          }

          if (columnMapping.api_numbers_combined && row[columnMapping.api_numbers_combined]) {
            facility.api_numbers_combined = row[columnMapping.api_numbers_combined]?.trim();
          }

          // Add alternative coordinates if available
          if (columnMapping.lat_well_sheet && row[columnMapping.lat_well_sheet]) {
            const latWellSheet = parseFloat(row[columnMapping.lat_well_sheet]);
            if (!isNaN(latWellSheet)) {
              facility.lat_well_sheet = latWellSheet;
            }
          }

          if (columnMapping.long_well_sheet && row[columnMapping.long_well_sheet]) {
            const longWellSheet = parseFloat(row[columnMapping.long_well_sheet]);
            if (!isNaN(longWellSheet)) {
              facility.long_well_sheet = longWellSheet;
            }
          }

          // Add date fields if available
          if (columnMapping.first_prod_date && row[columnMapping.first_prod_date]) {
            facility.first_prod_date = row[columnMapping.first_prod_date]?.trim();
          }

          if (columnMapping.spcc_due_date && row[columnMapping.spcc_due_date]) {
            facility.spcc_due_date = row[columnMapping.spcc_due_date]?.trim();
          }

          if (columnMapping.spcc_inspection_date && row[columnMapping.spcc_inspection_date]) {
            facility.spcc_inspection_date = row[columnMapping.spcc_inspection_date]?.trim();
          }

          facilities.push(facility);
        });

        if (facilities.length === 0 && errors.length === 0) {
          errors.push('No valid facility data found in CSV');
        }

        resolve({
          data: facilities,
          columnMapping,
          errors,
          warnings,
        });
      },
      error: (error) => {
        resolve({
          data: [],
          columnMapping: { name: null, latitude: null, longitude: null },
          errors: [`Failed to parse CSV: ${error.message}`],
          warnings: [],
        });
      },
    });
  });
}
