import { DistanceMatrix } from './osrm';
import { haversineDistance, kMeansClustering, balanceClusters, findOptimalClusters, GeoPoint, Cluster } from '../utils/geoClustering';

export interface FacilityWithIndex {
  index: number;
  name: string;
  latitude: number;
  longitude: number;
  visitDuration: number;
}

export interface DailyRoute {
  day: number;
  facilities: FacilityWithIndex[];
  sequence: number[];
  totalMiles: number;
  totalDriveTime: number;
  totalVisitTime: number;
  totalTime: number;
  startTime: string;
  endTime: string;
  lastFacilityDepartureTime: string;
  segments: RouteSegment[];
}

export interface RouteSegment {
  from: string;
  to: string;
  distance: number;
  duration: number;
  arrivalTime: string;
  departureTime: string;
}

export interface OptimizationResult {
  routes: DailyRoute[];
  totalDays: number;
  totalMiles: number;
  totalFacilities: number;
  totalDriveTime: number;
  totalVisitTime: number;
  totalTime: number;
}

export interface OptimizationConstraints {
  maxFacilitiesPerDay?: number;
  maxHoursPerDay?: number;
  useFacilitiesConstraint: boolean;
  useHoursConstraint: boolean;
  startTime: string;
  clusteringTightness?: number;
  clusterBalanceWeight?: number;
  defaultVisitDuration?: number;
}

function nearestNeighborTSP(
  distanceMatrix: number[][],
  startIndex: number,
  availableIndices: number[]
): number[] {
  if (availableIndices.length === 0) return [];

  const route: number[] = [];
  const remaining = new Set(availableIndices);
  let current = startIndex;

  while (remaining.size > 0) {
    let nearest = -1;
    let minDistance = Infinity;

    for (const candidate of remaining) {
      const distance = distanceMatrix[current][candidate];
      if (distance < minDistance) {
        minDistance = distance;
        nearest = candidate;
      }
    }

    if (nearest === -1) break;

    route.push(nearest);
    remaining.delete(nearest);
    current = nearest;
  }

  return route;
}

export function optimizeRouteOrder(
  distanceMatrix: number[][],
  route: number[],
  homeIndex: number
): number[] {
  if (route.length <= 2) return route;

  let bestRoute = [...route];
  let bestDistance = calculateRouteDistance(distanceMatrix, bestRoute, homeIndex);

  // Apply 2-opt optimization to improve the route
  // This looks for crossing paths and uncrosses them by reversing segments
  let improved = true;
  let iterations = 0;
  const maxIterations = 200;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 0; i < bestRoute.length - 1; i++) {
      for (let j = i + 1; j < bestRoute.length; j++) {
        // Get the four edges involved in this 2-opt swap
        // Edge 1: from previous location to route[i]
        // Edge 2: from route[i] to route[i+1]
        // Edge 3: from route[j] to route[j+1] (or back to home)
        // Edge 4: from route[j-1] to route[j]

        const prevI = i === 0 ? homeIndex : bestRoute[i - 1];
        const currI = bestRoute[i];
        // nextI unused

        const currJ = bestRoute[j];
        const nextJ = j + 1 < bestRoute.length ? bestRoute[j + 1] : homeIndex;

        // Current distance: prevI -> currI + currJ -> nextJ
        const currentDist = distanceMatrix[prevI][currI] + distanceMatrix[currJ][nextJ];

        // New distance after swap: prevI -> currJ + currI -> nextJ
        const newDist = distanceMatrix[prevI][currJ] + distanceMatrix[currI][nextJ];

        if (newDist < currentDist - 0.001) {
          // Perform 2-opt swap: reverse the segment between i and j
          const newRoute = [...bestRoute];
          let left = i;
          let right = j;

          while (left < right) {
            const temp = newRoute[left];
            newRoute[left] = newRoute[right];
            newRoute[right] = temp;
            left++;
            right--;
          }

          const newTotalDistance = calculateRouteDistance(distanceMatrix, newRoute, homeIndex);

          if (newTotalDistance < bestDistance) {
            bestRoute = newRoute;
            bestDistance = newTotalDistance;
            improved = true;
          }
        }
      }
    }
  }

  return bestRoute;
}

function calculateRouteDistance(
  distanceMatrix: number[][],
  route: number[],
  homeIndex: number
): number {
  let distance = distanceMatrix[homeIndex][route[0]];
  for (let i = 0; i < route.length - 1; i++) {
    distance += distanceMatrix[route[i]][route[i + 1]];
  }
  distance += distanceMatrix[route[route.length - 1]][homeIndex];
  return distance;
}

function addMinutesToTime(time: string, minutes: number): string {
  const [hours, mins] = time.split(':').map(Number);
  const totalMinutes = Math.round(hours * 60 + mins + minutes);
  const newHours = Math.floor(totalMinutes / 60) % 24;
  const newMins = totalMinutes % 60;
  return `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`;
}

export function calculateDayRoute(
  facilities: FacilityWithIndex[],
  sequence: number[],
  distanceMatrix: DistanceMatrix,
  homeIndex: number,
  startTime: string
): DailyRoute {
  const segments: RouteSegment[] = [];
  let totalMiles = 0;
  let totalDriveTime = 0;
  let totalVisitTime = 0;
  let currentTime = startTime;

  const driveToFirst = distanceMatrix.distances[homeIndex][sequence[0]] || 0;
  const driveTimeToFirst = distanceMatrix.durations[homeIndex][sequence[0]] || 0;
  totalMiles += driveToFirst;
  totalDriveTime += driveTimeToFirst;

  currentTime = addMinutesToTime(currentTime, driveTimeToFirst);

  const firstFacility = facilities[sequence[0] - 1];
  if (!firstFacility) {
    throw new Error(`Facility not found at index ${sequence[0] - 1}`);
  }

  segments.push({
    from: 'Home Base',
    to: firstFacility.name,
    distance: driveToFirst,
    duration: driveTimeToFirst,
    arrivalTime: currentTime,
    departureTime: addMinutesToTime(currentTime, firstFacility.visitDuration),
  });

  totalVisitTime += firstFacility.visitDuration || 0;
  currentTime = addMinutesToTime(currentTime, firstFacility.visitDuration || 0);

  for (let i = 0; i < sequence.length - 1; i++) {
    const from = sequence[i];
    const to = sequence[i + 1];
    const distance = distanceMatrix.distances[from][to] || 0;
    const duration = distanceMatrix.durations[from][to] || 0;

    const fromFacility = facilities[from - 1];
    const toFacility = facilities[to - 1];

    if (!fromFacility || !toFacility) {
      throw new Error(`Facility not found: from=${from - 1}, to=${to - 1}`);
    }

    totalMiles += distance;
    totalDriveTime += duration;
    currentTime = addMinutesToTime(currentTime, duration);

    segments.push({
      from: fromFacility.name,
      to: toFacility.name,
      distance,
      duration,
      arrivalTime: currentTime,
      departureTime: addMinutesToTime(currentTime, toFacility.visitDuration),
    });

    totalVisitTime += toFacility.visitDuration || 0;
    currentTime = addMinutesToTime(currentTime, toFacility.visitDuration || 0);
  }

  const lastFacility = facilities[sequence[sequence.length - 1] - 1];
  if (!lastFacility) {
    throw new Error(`Last facility not found at index ${sequence[sequence.length - 1] - 1}`);
  }

  const driveHome = distanceMatrix.distances[sequence[sequence.length - 1]][homeIndex] || 0;
  const driveTimeHome = distanceMatrix.durations[sequence[sequence.length - 1]][homeIndex] || 0;
  totalMiles += driveHome;
  totalDriveTime += driveTimeHome;
  currentTime = addMinutesToTime(currentTime, driveTimeHome);

  segments.push({
    from: lastFacility.name,
    to: 'Home Base',
    distance: driveHome,
    duration: driveTimeHome,
    arrivalTime: currentTime,
    departureTime: currentTime,
  });

  return {
    day: 0,
    facilities: sequence.map(idx => facilities[idx - 1]),
    sequence,
    totalMiles,
    totalDriveTime,
    totalVisitTime,
    totalTime: totalDriveTime + totalVisitTime,
    startTime,
    endTime: currentTime,
    lastFacilityDepartureTime: currentTime,
    segments,
  };
}

export function recalculateRouteTimes(route: DailyRoute): DailyRoute {
  // Recalculate times based on current visit durations without changing facility assignments
  const segments: RouteSegment[] = [];
  let totalVisitTime = 0;
  let currentTime = route.startTime;

  // Process each segment in order
  for (let i = 0; i < route.segments.length; i++) {
    const segment = route.segments[i];
    const facility = route.facilities[i];
    const visitDuration = facility?.visitDuration || 0;

    // For non-home segments, update arrival time
    const arrivalTime = currentTime;

    // Calculate departure time based on visit duration
    let departureTime: string;
    if (segment.to === 'Home Base') {
      // Last segment - no visit time at home
      departureTime = currentTime;
    } else {
      // Regular facility visit
      departureTime = addMinutesToTime(currentTime, visitDuration);
      totalVisitTime += visitDuration;
      currentTime = departureTime;
    }

    segments.push({
      ...segment,
      arrivalTime,
      departureTime,
    });

    // Add drive time to next location
    if (i < route.segments.length - 1) {
      currentTime = addMinutesToTime(currentTime, segment.duration);
    }
  }

  const endTime = segments[segments.length - 1].arrivalTime;
  const totalTime = route.totalDriveTime + totalVisitTime;

  // Get departure time from last facility (second to last segment, before returning home)
  const lastFacilityDepartureTime = segments.length > 1
    ? segments[segments.length - 2].departureTime
    : endTime;

  return {
    ...route,
    segments,
    totalVisitTime,
    totalTime,
    endTime,
    lastFacilityDepartureTime,
  };
}

function mergeAdjacentClusters(
  clusters: Cluster[],
  maxFacilitiesPerDay: number,
  constraints: OptimizationConstraints,
  homeBase: GeoPoint
): Cluster[] {
  // Try to merge small clusters that are geographically adjacent
  // This reduces total days when compatible clusters can be combined
  const merged: Cluster[] = [];
  const processed = new Set<number>();

  for (let i = 0; i < clusters.length; i++) {
    if (processed.has(i)) continue;

    let currentCluster = clusters[i];
    processed.add(i);

    // Try to merge with adjacent clusters
    for (let j = i + 1; j < clusters.length; j++) {
      if (processed.has(j)) continue;

      const candidateCluster = clusters[j];
      const combinedSize = currentCluster.points.length + candidateCluster.points.length;

      // Check if combined size would fit
      if (combinedSize > maxFacilitiesPerDay) continue;

      // Check if clusters are geographically adjacent
      const centroidDistance = haversineDistance(
        currentCluster.centroid.latitude,
        currentCluster.centroid.longitude,
        candidateCluster.centroid.latitude,
        candidateCluster.centroid.longitude
      );

      // Calculate average intra-cluster distance for both clusters
      const getAvgIntraDistance = (cluster: Cluster): number => {
        if (cluster.points.length <= 1) return 0;
        let totalDist = 0;
        let count = 0;
        for (let p1 = 0; p1 < cluster.points.length; p1++) {
          for (let p2 = p1 + 1; p2 < cluster.points.length; p2++) {
            totalDist += haversineDistance(
              cluster.points[p1].latitude,
              cluster.points[p1].longitude,
              cluster.points[p2].latitude,
              cluster.points[p2].longitude
            );
            count++;
          }
        }
        return count > 0 ? totalDist / count : 0;
      };

      const avgDist1 = getAvgIntraDistance(currentCluster);
      const avgDist2 = getAvgIntraDistance(candidateCluster);
      const avgIntraDistance = (avgDist1 + avgDist2) / 2;

      // Clusters are adjacent if centroid distance is within 2x average intra-cluster distance
      if (centroidDistance > avgIntraDistance * 2 && avgIntraDistance > 0) continue;

      // Estimate if combined route would fit time constraint
      if (constraints.useHoursConstraint && constraints.maxHoursPerDay) {
        // combinedFacilityIds unused

        // Quick time estimate: assume 30 minutes per facility + travel time
        const estimatedVisitTime = combinedSize * (constraints.defaultVisitDuration || 30);
        // Rough travel time estimate based on average inter-facility distance
        const estimatedTravelTime = combinedSize * 15; // 15 min average between facilities
        const totalEstimatedMinutes = estimatedVisitTime + estimatedTravelTime;

        if (totalEstimatedMinutes > constraints.maxHoursPerDay * 60) continue;
      }

      // Merge the clusters
      currentCluster = {
        id: currentCluster.id,
        centroid: {
          latitude: (currentCluster.centroid.latitude * currentCluster.points.length +
            candidateCluster.centroid.latitude * candidateCluster.points.length) /
            combinedSize,
          longitude: (currentCluster.centroid.longitude * currentCluster.points.length +
            candidateCluster.centroid.longitude * candidateCluster.points.length) /
            combinedSize,
        },
        points: [...currentCluster.points, ...candidateCluster.points]
      };
      processed.add(j);
    }

    merged.push(currentCluster);
  }

  // Re-sort by distance from home base
  merged.sort((a, b) => {
    const distA = haversineDistance(
      homeBase.latitude,
      homeBase.longitude,
      a.centroid.latitude,
      a.centroid.longitude
    );
    const distB = haversineDistance(
      homeBase.latitude,
      homeBase.longitude,
      b.centroid.latitude,
      b.centroid.longitude
    );
    return distA - distB;
  });

  return merged;
}

export function optimizeRoutes(
  facilities: FacilityWithIndex[],
  distanceMatrix: DistanceMatrix,
  constraints: OptimizationConstraints,
  homeBaseCoords?: { latitude: number; longitude: number }
): OptimizationResult {
  const homeIndex = 0;
  const routes: DailyRoute[] = [];

  const homeBase: GeoPoint = homeBaseCoords || {
    latitude: 39.8283,
    longitude: -98.5795,
  };

  const maxFacilitiesPerDay = constraints.useFacilitiesConstraint && constraints.maxFacilitiesPerDay
    ? constraints.maxFacilitiesPerDay
    : facilities.length;

  const geoPoints: GeoPoint[] = facilities.map((f, idx) => ({
    latitude: f.latitude,
    longitude: f.longitude,
    id: idx + 1,
  }));

  // Adjust k based on clustering tightness - tighter clustering = more clusters for better grouping
  const clusteringTightness = constraints.clusteringTightness ?? 0.5;
  const clusterBalanceWeight = constraints.clusterBalanceWeight ?? 0.5;

  const baseK = findOptimalClusters(geoPoints, maxFacilitiesPerDay);
  // Higher tightness creates more clusters, preventing distant facilities from being grouped
  const kAdjustment = Math.floor(baseK * (0.5 + clusteringTightness));
  const optimalK = Math.max(baseK, kAdjustment);

  let clusters = kMeansClustering(geoPoints, optimalK, 50, clusteringTightness);

  clusters = balanceClusters(clusters, maxFacilitiesPerDay, homeBase, clusterBalanceWeight);

  clusters.sort((a, b) => {
    const distA = haversineDistance(
      homeBase.latitude,
      homeBase.longitude,
      a.centroid.latitude,
      a.centroid.longitude
    );
    const distB = haversineDistance(
      homeBase.latitude,
      homeBase.longitude,
      b.centroid.latitude,
      b.centroid.longitude
    );
    return distA - distB;
  });

  // Merge small adjacent clusters before day building
  clusters = mergeAdjacentClusters(clusters, maxFacilitiesPerDay, constraints, homeBase);

  let dayNumber = 1;

  // SIMPLE APPROACH: Process each cluster completely before moving to the next
  // Only split a cluster if it exceeds time/facility constraints
  for (const cluster of clusters) {
    const clusterFacilityIds = cluster.points
      .map(p => p.id as number)
      .filter(id => id !== undefined);

    if (clusterFacilityIds.length === 0) continue;

    // Build optimized route for entire cluster using nearest-neighbor
    const buildNearestNeighborRoute = (facilityIds: number[]): number[] => {
      if (facilityIds.length === 0) return [];

      const remaining = new Set(facilityIds);
      const route: number[] = [];

      // Start with facility closest to home
      let minDist = Infinity;
      let startIdx = facilityIds[0];
      for (const idx of facilityIds) {
        const dist = distanceMatrix.distances[homeIndex][idx];
        if (dist < minDist) {
          minDist = dist;
          startIdx = idx;
        }
      }

      route.push(startIdx);
      remaining.delete(startIdx);
      let currentPos = startIdx;

      // Build route with nearest neighbor
      while (remaining.size > 0) {
        let nearestIdx = -1;
        let nearestDist = Infinity;

        for (const idx of remaining) {
          const dist = distanceMatrix.distances[currentPos][idx];
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestIdx = idx;
          }
        }

        if (nearestIdx === -1) break;
        route.push(nearestIdx);
        remaining.delete(nearestIdx);
        currentPos = nearestIdx;
      }

      return route;
    };

    const fullClusterRoute = buildNearestNeighborRoute(clusterFacilityIds);

    // Check if entire cluster fits in one day
    const fullRoute = calculateDayRoute(
      facilities,
      fullClusterRoute,
      distanceMatrix,
      homeIndex,
      constraints.startTime
    );

    const exceedsTime = constraints.useHoursConstraint &&
      constraints.maxHoursPerDay &&
      fullRoute.totalTime / 60 > constraints.maxHoursPerDay;

    const exceedsFacilities = constraints.useFacilitiesConstraint &&
      constraints.maxFacilitiesPerDay &&
      fullClusterRoute.length > constraints.maxFacilitiesPerDay;

    if (!exceedsTime && !exceedsFacilities) {
      // Entire cluster fits in one day - perfect!
      const optimizedRoute = optimizeRouteOrder(distanceMatrix.distances, fullClusterRoute, homeIndex);
      const dayRoute = calculateDayRoute(
        facilities,
        optimizedRoute,
        distanceMatrix,
        homeIndex,
        constraints.startTime
      );
      dayRoute.day = dayNumber;
      routes.push(dayRoute);
      dayNumber++;
    } else {
      // Cluster needs to be split across multiple days
      // Use greedy filling: keep adding facilities until constraints hit
      let remainingInCluster = [...fullClusterRoute];

      while (remainingInCluster.length > 0) {
        const dayFacilities: number[] = [];

        // Start with first facility in remaining
        dayFacilities.push(remainingInCluster[0]);

        // Add facilities one by one using nearest-neighbor until constraint hit
        for (let i = 1; i < remainingInCluster.length; i++) {
          const testRoute = [...dayFacilities, remainingInCluster[i]];

          const testDayRoute = calculateDayRoute(
            facilities,
            testRoute,
            distanceMatrix,
            homeIndex,
            constraints.startTime
          );

          const wouldExceedTime = constraints.useHoursConstraint &&
            constraints.maxHoursPerDay &&
            testDayRoute.totalTime / 60 > constraints.maxHoursPerDay;

          const wouldExceedFacilities = constraints.useFacilitiesConstraint &&
            constraints.maxFacilitiesPerDay &&
            testRoute.length >= constraints.maxFacilitiesPerDay;

          if (wouldExceedTime || wouldExceedFacilities) {
            break; // Stop adding to this day
          }

          dayFacilities.push(remainingInCluster[i]);
        }

        // Create the day route
        const optimizedRoute = optimizeRouteOrder(distanceMatrix.distances, dayFacilities, homeIndex);
        const dayRoute = calculateDayRoute(
          facilities,
          optimizedRoute,
          distanceMatrix,
          homeIndex,
          constraints.startTime
        );
        dayRoute.day = dayNumber;
        routes.push(dayRoute);
        dayNumber++;

        // Remove assigned facilities from remaining
        remainingInCluster = remainingInCluster.filter(id => !dayFacilities.includes(id));
      }
    }
  }

  // Validate that all facilities are included in the routes
  const assignedFacilityIds = new Set<number>();
  routes.forEach(route => {
    route.facilities.forEach(facility => {
      assignedFacilityIds.add(facility.index);
    });
  });

  const allFacilityIds = new Set(facilities.map((_, idx) => idx + 1));
  const missingFacilities = [...allFacilityIds].filter(id => !assignedFacilityIds.has(id));

  // If any facilities are missing, add them to their own day(s)
  if (missingFacilities.length > 0) {
    console.warn(`Found ${missingFacilities.length} unassigned facilities, adding them now`);

    const missingGeoPoints: GeoPoint[] = missingFacilities.map(id => {
      const facility = facilities[id - 1];
      return {
        latitude: facility.latitude,
        longitude: facility.longitude,
        id
      };
    });

    // Cluster missing facilities to keep them geographically organized
    const missingClusters = kMeansClustering(
      missingGeoPoints,
      Math.ceil(missingFacilities.length / (constraints.maxFacilitiesPerDay || 10)),
      30,
      0.7
    );

    let dayNumber = routes.length + 1;
    for (const cluster of missingClusters) {
      const clusterIndices = cluster.points.map(p => p.id as number);
      if (clusterIndices.length === 0) continue;

      const sequence = nearestNeighborTSP(distanceMatrix.distances, homeIndex, clusterIndices);
      const optimizedSequence = optimizeRouteOrder(distanceMatrix.distances, sequence, homeIndex);

      const dayRoute = calculateDayRoute(
        facilities,
        optimizedSequence,
        distanceMatrix,
        homeIndex,
        constraints.startTime
      );

      dayRoute.day = dayNumber;
      routes.push(dayRoute);
      dayNumber++;
    }
  }

  const totalMiles = routes.reduce((sum, route) => sum + route.totalMiles, 0);
  const totalDriveTime = routes.reduce((sum, route) => sum + route.totalDriveTime, 0);

  const totalVisitTime = routes.reduce((sum, route) => sum + route.totalVisitTime, 0);
  const totalTime = routes.reduce((sum, route) => sum + route.totalTime, 0);

  return {
    routes,
    totalDays: routes.length,
    totalMiles,
    totalFacilities: facilities.length,
    totalDriveTime,
    totalVisitTime,
    totalTime,
  };
}
