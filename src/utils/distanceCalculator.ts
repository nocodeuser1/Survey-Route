import { Facility } from '../lib/supabase';
import { isInspectionValid } from './inspectionUtils';

export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return distance;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

export interface NearbyFacilityWithDistance {
  facility: Facility;
  distance: number;
}

export function findNearbyFacilities(
  currentFacility: Facility,
  allFacilities: Facility[],
  radiusMeters: number = 200,
  inspections: any[] = []
): NearbyFacilityWithDistance[] {
  const nearby: NearbyFacilityWithDistance[] = [];

  for (const facility of allFacilities) {
    if (facility.id === currentFacility.id) {
      continue;
    }

    const hasSPCCCompletion =
      facility.spcc_completion_type === 'internal' ||
      facility.spcc_completion_type === 'external';

    const facilityInspections = inspections.filter(
      (i) => i.facility_id === facility.id
    );
    const latestInspection =
      facilityInspections.length > 0
        ? facilityInspections.sort(
            (a, b) =>
              new Date(b.conducted_at).getTime() -
              new Date(a.conducted_at).getTime()
          )[0]
        : undefined;
    const hasValidInspection = isInspectionValid(latestInspection);

    if (hasSPCCCompletion || hasValidInspection) {
      continue;
    }

    const distance = calculateDistance(
      currentFacility.latitude,
      currentFacility.longitude,
      facility.latitude,
      facility.longitude
    );

    if (distance <= radiusMeters) {
      nearby.push({ facility, distance });
    }
  }

  nearby.sort((a, b) => a.distance - b.distance);

  return nearby.slice(0, 5);
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  } else {
    return `${(meters / 1000).toFixed(2)}km`;
  }
}

export function formatDistanceWithFeet(meters: number): string {
  const feet = Math.round(meters * 3.28084);
  if (meters < 1000) {
    return `${Math.round(meters)}m (${feet}ft)`;
  } else {
    const miles = (feet / 5280).toFixed(2);
    return `${(meters / 1000).toFixed(2)}km (${miles}mi)`;
  }
}
