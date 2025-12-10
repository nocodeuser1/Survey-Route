export interface Location {
  latitude: number;
  longitude: number;
}

export interface DistanceMatrix {
  distances: number[][];
  durations: number[][];
}

const OSRM_SERVER = 'https://router.project-osrm.org';
const MAX_LOCATIONS_PER_REQUEST = 100;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function calculateDistanceMatrix(
  locations: Location[]
): Promise<DistanceMatrix> {
  if (locations.length === 0) {
    return { distances: [], durations: [] };
  }

  // If under the limit, process normally
  if (locations.length <= MAX_LOCATIONS_PER_REQUEST) {
    return calculateDistanceMatrixBatch(locations);
  }

  // For large sets, use batched approach with approximation
  console.log(`Processing ${locations.length} locations using batched distance matrix calculation`);
  return calculateLargeDistanceMatrix(locations);
}

async function calculateDistanceMatrixBatch(
  locations: Location[]
): Promise<DistanceMatrix> {
  if (locations.length === 0) {
    return { distances: [], durations: [] };
  }

  const coordinates = locations
    .map(loc => `${loc.longitude},${loc.latitude}`)
    .join(';');

  const url = `${OSRM_SERVER}/table/v1/driving/${coordinates}?annotations=distance,duration`;

  let retries = 3;
  while (retries > 0) {
    try {
      const response = await fetch(url);

      if (response.status === 429) {
        if (retries > 1) {
          await sleep(2000);
          retries--;
          continue;
        }
        throw new Error('OSRM rate limit exceeded. Please try again in a moment.');
      }

      if (!response.ok) {
        throw new Error(`OSRM request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.code !== 'Ok') {
        throw new Error(`OSRM error: ${data.message || 'Unknown error'}`);
      }

      const distances = data.distances.map((row: number[]) =>
        row.map((dist: number) => dist / 1609.34)
      );

      const durations = data.durations.map((row: number[]) =>
        row.map((dur: number) => Math.round(dur / 60))
      );

      return { distances, durations };
    } catch (error) {
      if (retries === 1) {
        throw error;
      }
      await sleep(1000);
      retries--;
    }
  }

  throw new Error('Failed to calculate distance matrix after retries');
}

export interface RouteGeometry {
  coordinates: [number, number][];
}

export async function getRouteGeometry(
  locations: Location[]
): Promise<RouteGeometry | null> {
  if (locations.length < 2) {
    return null;
  }

  const coordinates = locations
    .map(loc => `${loc.longitude},${loc.latitude}`)
    .join(';');

  const url = `${OSRM_SERVER}/route/v1/driving/${coordinates}?overview=full&geometries=geojson`;

  let retries = 3;
  while (retries > 0) {
    try {
      const response = await fetch(url);

      if (response.status === 429) {
        if (retries > 1) {
          await sleep(2000);
          retries--;
          continue;
        }
        return null;
      }

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        return null;
      }

      const geometry = data.routes[0].geometry;

      return {
        coordinates: geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]] as [number, number])
      };
    } catch (error) {
      if (retries === 1) {
        console.error('Route geometry error:', error);
        return null;
      }
      await sleep(1000);
      retries--;
    }
  }

  return null;
}

// Haversine formula to calculate distance between two coordinates
function haversineDistance(loc1: Location, loc2: Location): number {
  const R = 3958.8; // Earth's radius in miles
  const dLat = (loc2.latitude - loc1.latitude) * Math.PI / 180;
  const dLon = (loc2.longitude - loc1.longitude) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(loc1.latitude * Math.PI / 180) * Math.cos(loc2.latitude * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// For large sets, calculate distance matrix using batching with strategic sampling
async function calculateLargeDistanceMatrix(
  locations: Location[]
): Promise<DistanceMatrix> {
  const n = locations.length;
  const distances: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
  const durations: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));

  // Batch size for OSRM requests
  const batchSize = MAX_LOCATIONS_PER_REQUEST;

  // Process in batches - calculate exact distances for nearby locations
  // Use haversine approximation for distant locations
  console.log(`Calculating distance matrix for ${n} locations in batches...`);

  for (let i = 0; i < n; i += batchSize) {
    const batchEnd = Math.min(i + batchSize, n);
    const batch = locations.slice(i, batchEnd);

    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(n / batchSize)}: locations ${i} to ${batchEnd - 1}`);

    try {
      // Get exact distances within this batch
      const batchMatrix = await calculateDistanceMatrixBatch(batch);

      // Fill in the batch results
      for (let row = 0; row < batch.length; row++) {
        for (let col = 0; col < batch.length; col++) {
          distances[i + row][i + col] = batchMatrix.distances[row][col];
          durations[i + row][i + col] = batchMatrix.durations[row][col];
        }
      }

      // Add delay to avoid rate limiting
      if (batchEnd < n) {
        await sleep(1000);
      }
    } catch (error) {
      console.error(`Error processing batch ${i}-${batchEnd}:`, error);
      // Fall back to haversine for this batch
      for (let row = 0; row < batch.length; row++) {
        for (let col = 0; col < batch.length; col++) {
          const dist = haversineDistance(locations[i + row], locations[i + col]);
          distances[i + row][i + col] = dist;
          durations[i + row][i + col] = Math.round(dist / 45 * 60); // Assume 45 mph average
        }
      }
    }
  }

  // For cross-batch distances, use haversine approximation with driving factor
  // This is reasonably accurate for route optimization purposes
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (distances[i][j] === 0 && i !== j) {
        const straightLine = haversineDistance(locations[i], locations[j]);
        // Apply a 1.3x factor to account for road routing (typical detour factor)
        distances[i][j] = straightLine * 1.3;
        durations[i][j] = Math.round(distances[i][j] / 45 * 60); // Assume 45 mph average
      }
    }
  }

  console.log(`Distance matrix calculation complete for ${n} locations`);
  return { distances, durations };
}

export async function geocodeAddress(address: string): Promise<Location | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      address
    )}&format=json&limit=1`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Route-Optimization-App',
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.length === 0) {
      return null;
    }

    return {
      latitude: parseFloat(data[0].lat),
      longitude: parseFloat(data[0].lon),
    };
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
}
