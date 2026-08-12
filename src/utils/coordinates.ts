// Single source of truth for "does this record have usable coordinates?".
//
// Two things can mean "no coordinates" in this data set:
//   1. NULL latitude/longitude — the modern representation, written when a
//      user clears the coordinates on a facility.
//   2. The 0,0 sentinel — left behind by older CSV imports that had no
//      coordinate columns. 0,0 is in the Gulf of Guinea, so no real facility
//      lives there and treating it as "missing" is safe.
//
// Anything that maps, navigates to, or measures distance between facilities
// should go through these helpers rather than reading .latitude directly.

export interface MaybeCoords {
  latitude?: number | null;
  longitude?: number | null;
}

export interface Coords {
  lat: number;
  lng: number;
}

/** Parsed lat/lng, or null when the record has no usable coordinates. */
export function getCoords(record: MaybeCoords | null | undefined): Coords | null {
  if (!record) return null;
  const lat = record.latitude == null ? NaN : Number(record.latitude);
  const lng = record.longitude == null ? NaN : Number(record.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

export function hasCoords(record: MaybeCoords | null | undefined): boolean {
  return getCoords(record) !== null;
}
