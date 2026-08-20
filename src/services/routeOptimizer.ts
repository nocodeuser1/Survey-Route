import { DistanceMatrix } from './osrm';
import {
  haversineDistance,
  kMeansClustering,
  balanceClusters,
  findOptimalClusters,
  validateGeographicCohesion,
  maxPairwiseDistance,
  calculateCentroid,
  MAX_MERGE_CENTROID_DISTANCE_MILES,
  MIN_VIABLE_DAY_FACILITIES,
  MAX_INTRA_CLUSTER_PAIRWISE_MILES,
  GeoPoint,
  Cluster,
} from '../utils/geoClustering';

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
  lunchBreakMinutes?: number;
  maxDriveTimeMinutes?: number;
  returnByTime?: string;
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

  // Neighbours of a position within the day; home base sits at both ends.
  const nodeBefore = (seq: number[], i: number) => (i <= 0 ? homeIndex : seq[i - 1]);
  const nodeAfter = (seq: number[], i: number) =>
    (i >= seq.length - 1 ? homeIndex : seq[i + 1]);

  // Accept a candidate ordering only if a full recompute agrees it's shorter.
  // The delta arithmetic below assumes a symmetric matrix; real OSRM matrices
  // are only near-symmetric, so every proposed move gets confirmed for real
  // before it's kept.
  const tryCandidate = (candidate: number[]): boolean => {
    const candidateDistance = calculateRouteDistance(distanceMatrix, candidate, homeIndex);
    if (candidateDistance < bestDistance - 0.001) {
      bestRoute = candidate;
      bestDistance = candidateDistance;
      return true;
    }
    return false;
  };

  let improved = true;
  let iterations = 0;
  const maxIterations = 300;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    // --- 2-opt: find crossing paths and uncross them by reversing a run ---
    twoOpt:
    for (let i = 0; i < bestRoute.length - 1; i++) {
      for (let j = i + 1; j < bestRoute.length; j++) {
        const prev = nodeBefore(bestRoute, i);
        const next = nodeAfter(bestRoute, j);
        const delta =
          distanceMatrix[prev][bestRoute[j]] + distanceMatrix[bestRoute[i]][next] -
          distanceMatrix[prev][bestRoute[i]] - distanceMatrix[bestRoute[j]][next];

        if (delta >= -0.001) continue;

        const candidate = [...bestRoute];
        let left = i;
        let right = j;
        while (left < right) {
          const temp = candidate[left];
          candidate[left] = candidate[right];
          candidate[right] = temp;
          left++;
          right--;
        }

        if (tryCandidate(candidate)) {
          improved = true;
          break twoOpt;
        }
      }
    }

    // --- Or-opt: lift a run of 1-3 stops out and drop it somewhere better ---
    // 2-opt alone can't fix "this stop is on the way to that one but sits at
    // the wrong end of the day" — reversing a contiguous run is all it can do.
    // Or-opt relocates a stop (or a short chain) to its cheapest insertion
    // point, in either orientation, which is what actually straightens out a
    // drive-past within a single day.
    orOpt:
    for (let segLen = 1; segLen <= 3 && segLen < bestRoute.length; segLen++) {
      for (let start = 0; start + segLen <= bestRoute.length; start++) {
        const segment = bestRoute.slice(start, start + segLen);
        const without = [
          ...bestRoute.slice(0, start),
          ...bestRoute.slice(start + segLen),
        ];

        const prev = start === 0 ? homeIndex : bestRoute[start - 1];
        const next =
          start + segLen >= bestRoute.length ? homeIndex : bestRoute[start + segLen];
        const removalGain =
          distanceMatrix[prev][segment[0]] +
          distanceMatrix[segment[segLen - 1]][next] -
          distanceMatrix[prev][next];

        const orientations = segLen === 1 ? [segment] : [segment, [...segment].reverse()];

        for (let pos = 0; pos <= without.length; pos++) {
          if (pos === start) continue; // right back where it came from

          const a = pos === 0 ? homeIndex : without[pos - 1];
          const b = pos === without.length ? homeIndex : without[pos];

          for (const oriented of orientations) {
            const insertionCost =
              distanceMatrix[a][oriented[0]] +
              distanceMatrix[oriented[segLen - 1]][b] -
              distanceMatrix[a][b];

            if (removalGain - insertionCost <= 0.001) continue;

            const candidate = [
              ...without.slice(0, pos),
              ...oriented,
              ...without.slice(pos),
            ];
            if (tryCandidate(candidate)) {
              improved = true;
              break orOpt;
            }
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
  startTime: string,
  lunchBreakMinutes: number = 0
): DailyRoute {
  const segments: RouteSegment[] = [];
  let totalMiles = 0;
  let totalDriveTime = 0;
  let totalVisitTime = 0;
  let currentTime = startTime;
  const lunchAfterFacility = lunchBreakMinutes > 0 ? Math.floor(sequence.length / 2) : -1;
  let lunchAdded = false;

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
    // Insert lunch break after midpoint facility
    if (!lunchAdded && lunchBreakMinutes > 0 && i === lunchAfterFacility) {
      currentTime = addMinutesToTime(currentTime, lunchBreakMinutes);
      lunchAdded = true;
    }

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

  // Capture last-facility departure BEFORE we add the drive-home time. The
  // previous code set both `endTime` and `lastFacilityDepartureTime` to the
  // post-drive `currentTime`, which made `lastFacilityDepartureTime` actually
  // mean "arrival at home" — and the UI's day summary, which reads that
  // field, displayed the wrong time. Now: lastFacilityDepartureTime = when
  // you leave the final facility; endTime = when you're back at home base
  // (after the return drive). The return-by-time constraint still uses
  // endTime so "home by 4pm" actually means home, with drive included.
  const lastFacilityDepartureTime = currentTime;
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
    totalTime: totalDriveTime + totalVisitTime + (lunchAdded ? lunchBreakMinutes : 0),
    startTime,
    endTime: currentTime,
    lastFacilityDepartureTime,
    segments,
  };
}

export function recalculateRouteTimes(route: DailyRoute): DailyRoute {
  // Empty-day placeholders (from a reassign that left a day with no
  // facilities) have `segments: []`. Bailing here prevents the crash at
  // `segments[segments.length - 1].arrivalTime` further down — that
  // unguarded access was killing route loads for users whose saved
  // routes contained an empty placeholder day. Empty placeholders
  // already carry sane default times (startTime === endTime ===
  // settings.start_time) so there's nothing to recalculate.
  if (!route.segments || route.segments.length === 0) {
    return route;
  }

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

      // Distance ceiling. Default cap is 30 miles — keeps two genuinely-
      // viable clusters from fusing into one bimodal day. BUT relax that
      // when at least one of the two clusters is sub-viable on its own
      // (< MIN_VIABLE_DAY_FACILITIES): a 1-facility cluster 50 miles from
      // a 2-facility cluster shouldn't become two solo/two-stop days when
      // they could be one productive day. Time/facility constraints below
      // still bound the result.
      const eitherSubViable =
        currentCluster.points.length < MIN_VIABLE_DAY_FACILITIES ||
        candidateCluster.points.length < MIN_VIABLE_DAY_FACILITIES;
      if (!eitherSubViable && centroidDistance > MAX_MERGE_CENTROID_DISTANCE_MILES) continue;
      // Relative check: clusters are adjacent only if centroid distance is
      // within 2x average intra-cluster distance. Skipped when both
      // clusters are size-1 because the relative measure is undefined; the
      // hard ceiling above already gates that case.
      if (avgIntraDistance > 0 && centroidDistance > avgIntraDistance * 2) continue;

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

/**
 * After clustering + merging, some clusters may still be bimodal — points
 * legitimately split across two distant areas — but too small to split
 * cleanly into viable days on their own. The right answer in that case
 * is usually to PUSH each subgroup into a different day-cluster that's
 * already in its area (e.g. the Watonga half of a Day 2 stub joins
 * Day 1 which is already around El Reno; the Chickasha half joins Day 3
 * which is already in Chickasha).
 *
 * This pass walks the cluster list, detects any cluster whose max
 * pairwise distance exceeds the cohesion ceiling, k-means-splits it into
 * 2 subgroups, and tries to absorb each subgroup into the nearest
 * EXISTING cluster — but only if doing so:
 *   1. fits within maxFacilitiesPerDay,
 *   2. doesn't push the target cluster's max-pairwise above the ceiling
 *      (i.e. the target stays cohesive after absorption).
 *
 * If both subgroups can be absorbed, the original bimodal cluster is
 * removed. If even one subgroup has nowhere to go, we leave the original
 * intact — better one bimodal day than orphaned mini-days. Same
 * minimum-viable-day intuition the user surfaced.
 */
function absorbBimodalIntoNeighbors(
  clusters: Cluster[],
  maxFacilitiesPerDay: number
): Cluster[] {
  const out: Cluster[] = [...clusters];

  // Walk in reverse so splice() doesn't shift indices we're about to look at.
  for (let i = out.length - 1; i >= 0; i--) {
    const cluster = out[i];
    if (cluster.points.length < 2) continue;

    const maxPair = maxPairwiseDistance(cluster.points);
    if (maxPair <= MAX_INTRA_CLUSTER_PAIRWISE_MILES) continue;

    // Bimodal — try to dissolve it into neighbors. K-means split first.
    const split = kMeansClustering(cluster.points, 2, 30, 0.85);
    if (split.length < 2) continue;

    type Plan = { targetIdx: number; subgroup: Cluster };
    const plans: Plan[] = [];
    const claimedTargetIdx = new Set<number>();

    for (const sub of split) {
      let bestTarget = -1;
      let bestDist = Infinity;
      for (let j = 0; j < out.length; j++) {
        if (j === i) continue;
        if (claimedTargetIdx.has(j)) continue;
        const tgt = out[j];
        if (tgt.points.length + sub.points.length > maxFacilitiesPerDay) continue;
        // Absorption mustn't introduce new bimodality in the target.
        const combinedPoints = [...tgt.points, ...sub.points];
        if (maxPairwiseDistance(combinedPoints) > MAX_INTRA_CLUSTER_PAIRWISE_MILES) continue;
        const d = haversineDistance(
          tgt.centroid.latitude,
          tgt.centroid.longitude,
          sub.centroid.latitude,
          sub.centroid.longitude
        );
        if (d < bestDist) {
          bestDist = d;
          bestTarget = j;
        }
      }
      if (bestTarget < 0) {
        // No home for this subgroup — abandon redistribution for this cluster.
        plans.length = 0;
        break;
      }
      plans.push({ targetIdx: bestTarget, subgroup: sub });
      claimedTargetIdx.add(bestTarget);
    }

    if (plans.length === split.length) {
      // Every subgroup found a home. Commit absorptions and drop original.
      for (const { targetIdx, subgroup } of plans) {
        const tgt = out[targetIdx];
        tgt.points = [...tgt.points, ...subgroup.points];
        tgt.centroid = calculateCentroid(tgt.points);
      }
      out.splice(i, 1);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Shared day builder
// ---------------------------------------------------------------------------

/**
 * The one way a day's route gets (re)built: order the stops, then clock the
 * day. Every entry point — first generation, drag-and-drop reassign, bulk
 * reassign, remove-from-day, the Refresh Times button — goes through here so
 * they can't drift apart. They used to: some call sites passed the lunch
 * break to calculateDayRoute and some didn't, so the same set of stops came
 * out with different arrival times depending on which button produced it.
 */
export function rebuildDayRoute(
  facilities: FacilityWithIndex[],
  sequence: number[],
  distanceMatrix: DistanceMatrix,
  homeIndex: number,
  startTime: string,
  lunchBreakMinutes: number = 0
): DailyRoute {
  const optimized = optimizeRouteOrder(distanceMatrix.distances, sequence, homeIndex);
  return calculateDayRoute(
    facilities,
    optimized,
    distanceMatrix,
    homeIndex,
    startTime,
    lunchBreakMinutes
  );
}

// ---------------------------------------------------------------------------
// Cross-day refinement
// ---------------------------------------------------------------------------

// How many nearby stops each facility considers as "who else is around here".
// Cross-day moves are only ever proposed between days that already have a
// stop in each other's neighbourhood, which is what keeps this pass from
// being an O(days^2 * stops^2) sweep.
const CROSS_DAY_NEIGHBORS = 12;
// Minimum drive-time saving (minutes) before a move is worth the churn.
const CROSS_DAY_MIN_GAIN = 1;
const CROSS_DAY_MAX_PASSES = 60;
// What each stop a day is short of MIN_VIABLE_DAY_FACILITIES is "worth", in
// drive-minutes. Pure distance minimization will happily strip a day down to
// one stop to shave a few miles off its neighbour — a whole working day for a
// single facility, which is not the trade the user wants. Charging for
// underfilled days means a move has to save real driving before it's allowed
// to thin a day out, and conversely makes topping a thin day back up cheap.
const CROSS_DAY_UNDERFILL_PENALTY_MINUTES = 45;

function timeToMinutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

/**
 * What a day costs us. Drive time is the real currency — it's what the
 * "you drove right past that stop" complaint is actually about — with
 * mileage as a tie-breaker so two equal-time orderings pick the shorter one,
 * plus a charge for days that come out under-loaded (see the constant).
 */
function dayCost(route: DailyRoute): number {
  const underfill = Math.max(0, MIN_VIABLE_DAY_FACILITIES - route.facilities.length);
  return route.totalDriveTime
    + route.totalMiles * 0.01
    + underfill * CROSS_DAY_UNDERFILL_PENALTY_MINUTES;
}

/**
 * How badly a day breaks the user's constraints, in roughly-comparable
 * penalty units. A move is never allowed to make the pair of days it touches
 * worse on this score — but days that were ALREADY over (clustering sometimes
 * has no choice) can still be improved, which a hard feasible/infeasible gate
 * would forbid.
 */
function dayViolation(route: DailyRoute, constraints: OptimizationConstraints): number {
  let violation = 0;

  if (constraints.useHoursConstraint && constraints.maxHoursPerDay) {
    violation += Math.max(0, route.totalTime / 60 - constraints.maxHoursPerDay) * 60;
  }
  if (constraints.useFacilitiesConstraint && constraints.maxFacilitiesPerDay) {
    violation += Math.max(0, route.facilities.length - constraints.maxFacilitiesPerDay) * 1000;
  }
  const maxDriveTime = constraints.maxDriveTimeMinutes || 0;
  if (maxDriveTime > 0) {
    violation += Math.max(0, route.totalDriveTime - maxDriveTime);
  }
  const returnByTime = constraints.returnByTime || '';
  if (returnByTime && route.endTime > returnByTime) {
    violation += timeToMinutes(route.endTime) - timeToMinutes(returnByTime);
  }

  return violation;
}

/**
 * Clustering decides which stops belong together by looking at where they
 * sit on a map. It cannot see the roads, and it cannot see the shape of the
 * finished day — so it regularly produces two days whose routes run down the
 * same corridor, and you end up driving past a Day 1 stop on your way to a
 * Day 2 stop.
 *
 * This pass fixes that after the fact, the way vehicle-routing solvers do:
 * repeatedly try (a) relocating one stop into another day and (b) swapping a
 * stop between two days, keeping any move that shortens total driving without
 * breaking that pair of days' constraints. Because it works off the real
 * distance matrix and the fully-built day (drive + visit + lunch + return),
 * "is this stop on the way?" is answered by actual road time rather than by
 * how the clusterer felt about it.
 *
 * Deliberately NOT done here: emptying a day. A day is never allowed to drop
 * to zero stops, so this pass changes which stops go together, never how many
 * days the trip takes. Deciding the trip is a day shorter is the clustering
 * phase's call, not a local-search side effect.
 */
export function improveAcrossDays(
  routes: DailyRoute[],
  facilities: FacilityWithIndex[],
  distanceMatrix: DistanceMatrix,
  constraints: OptimizationConstraints,
  homeIndex: number = 0,
  lunchBreakMinutes: number = 0
): DailyRoute[] {
  const empties = routes.filter(r => r.sequence.length === 0);
  const working = routes.filter(r => r.sequence.length > 0).map(r => ({ ...r }));

  // Nothing to trade between.
  if (working.length < 2) return routes;

  const distances = distanceMatrix.distances;
  const durations = distanceMatrix.durations;
  const driveTime = (from: number, to: number): number => durations[from]?.[to] ?? 0;

  // Candidate lists: for each stop, the handful of stops physically nearest
  // to it. Those are the only stops whose days are worth trading with.
  const allStops = working.flatMap(r => r.sequence);
  const neighbors = new Map<number, number[]>();
  for (const stop of allStops) {
    const ranked = allStops
      .filter(other => other !== stop)
      .sort((x, y) => (distances[stop]?.[x] ?? Infinity) - (distances[stop]?.[y] ?? Infinity))
      .slice(0, CROSS_DAY_NEIGHBORS);
    neighbors.set(stop, ranked);
  }

  const dayOfStop = new Map<number, number>();
  const reindex = () => {
    dayOfStop.clear();
    working.forEach((route, idx) => route.sequence.forEach(stop => dayOfStop.set(stop, idx)));
  };
  reindex();

  // Cheap screens — what we'd save by pulling a stop out, and what the
  // cheapest place to drop it into another day would cost. Only proposals
  // that look like a win here get built and checked for real.
  const removalGain = (sequence: number[], position: number): number => {
    const prev = position === 0 ? homeIndex : sequence[position - 1];
    const next = position === sequence.length - 1 ? homeIndex : sequence[position + 1];
    return driveTime(prev, sequence[position]) + driveTime(sequence[position], next)
      - driveTime(prev, next);
  };

  const bestInsertionCost = (sequence: number[], stop: number): number => {
    let best = Infinity;
    for (let pos = 0; pos <= sequence.length; pos++) {
      const before = pos === 0 ? homeIndex : sequence[pos - 1];
      const after = pos === sequence.length ? homeIndex : sequence[pos];
      const cost = driveTime(before, stop) + driveTime(stop, after) - driveTime(before, after);
      if (cost < best) best = cost;
    }
    return best;
  };

  const rebuild = (sequence: number[], template: DailyRoute): DailyRoute | null => {
    if (sequence.length === 0) return null;
    try {
      const rebuilt = rebuildDayRoute(
        facilities,
        sequence,
        distanceMatrix,
        homeIndex,
        template.startTime,
        lunchBreakMinutes
      );
      rebuilt.day = template.day;
      return rebuilt;
    } catch (err) {
      console.warn('[routeOptimizer] cross-day move rejected, could not rebuild day', err);
      return null;
    }
  };

  const accept = (
    oldA: DailyRoute,
    oldB: DailyRoute,
    newA: DailyRoute | null,
    newB: DailyRoute | null
  ): boolean => {
    if (!newA || !newB) return false;
    const gain = (dayCost(oldA) + dayCost(oldB)) - (dayCost(newA) + dayCost(newB));
    if (gain < CROSS_DAY_MIN_GAIN) return false;
    const oldViolation = dayViolation(oldA, constraints) + dayViolation(oldB, constraints);
    const newViolation = dayViolation(newA, constraints) + dayViolation(newB, constraints);
    return newViolation <= oldViolation + 1e-6;
  };

  let passes = 0;
  let movedSomething = true;

  while (movedSomething && passes < CROSS_DAY_MAX_PASSES) {
    movedSomething = false;
    passes++;

    scan:
    for (let a = 0; a < working.length; a++) {
      const routeA = working[a];
      // Never empty a day — see the note above about day count.
      if (routeA.sequence.length <= 1) continue;

      for (let posA = 0; posA < routeA.sequence.length; posA++) {
        const stopA = routeA.sequence[posA];
        const gainOutA = removalGain(routeA.sequence, posA);
        const sequenceAWithout = routeA.sequence.filter(s => s !== stopA);

        for (const neighbor of neighbors.get(stopA) || []) {
          const b = dayOfStop.get(neighbor);
          if (b === undefined || b === a) continue;
          const routeB = working[b];

          // (a) Relocate: stopA moves from day A into day B.
          if (gainOutA - bestInsertionCost(routeB.sequence, stopA) > CROSS_DAY_MIN_GAIN) {
            const newA = rebuild(sequenceAWithout, routeA);
            const newB = rebuild([...routeB.sequence, stopA], routeB);
            if (accept(routeA, routeB, newA, newB)) {
              working[a] = newA!;
              working[b] = newB!;
              reindex();
              movedSomething = true;
              continue scan;
            }
          }

          // (b) Swap: stopA and its neighbour trade days.
          const posB = routeB.sequence.indexOf(neighbor);
          if (posB < 0) continue;
          const gainOutB = removalGain(routeB.sequence, posB);
          const sequenceBWithout = routeB.sequence.filter(s => s !== neighbor);
          const swapScreen = gainOutA + gainOutB
            - bestInsertionCost(sequenceBWithout, stopA)
            - bestInsertionCost(sequenceAWithout, neighbor);

          if (swapScreen > CROSS_DAY_MIN_GAIN) {
            const newA = rebuild([...sequenceAWithout, neighbor], routeA);
            const newB = rebuild([...sequenceBWithout, stopA], routeB);
            if (accept(routeA, routeB, newA, newB)) {
              working[a] = newA!;
              working[b] = newB!;
              reindex();
              movedSomething = true;
              continue scan;
            }
          }
        }
      }
    }
  }

  return [...working, ...empties];
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

  const lunchBreak = constraints.lunchBreakMinutes || 0;
  const maxDriveTime = constraints.maxDriveTimeMinutes || 0;
  const returnByTime = constraints.returnByTime || '';

  // Adjust k based on clustering tightness - tighter clustering = more clusters for better grouping
  const clusteringTightness = constraints.clusteringTightness ?? 0.75;
  const clusterBalanceWeight = constraints.clusterBalanceWeight ?? 0.35;

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

  // For any bimodal cluster that survived merging (typically because both
  // halves are individually sub-viable, like a 2+2 stub), try to dissolve
  // it into neighboring clusters that are already in those areas. This is
  // the "the Watonga pair should join Day 1, the Chickasha pair should
  // join Day 3" case — better than either keeping a bimodal day or
  // splitting into two undersized days.
  clusters = absorbBimodalIntoNeighbors(clusters, maxFacilitiesPerDay);

  // Belt-and-suspenders: re-run cohesion validation AFTER merge +
  // absorption. Even with the gates above, edge cases can still produce
  // a bimodal cluster (e.g. when two ~adjacent clusters both happen to
  // have legitimate avgIntraDistance values, then merging them produces a
  // cluster whose own pairwise span exceeds the cohesion ceiling).
  // Re-running the validator catches those before they become a day.
  clusters = validateGeographicCohesion(clusters, homeBase);

  // Re-sort by distance from home so day numbering stays "closer first".
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
      constraints.startTime,
      lunchBreak
    );

    const exceedsTime = constraints.useHoursConstraint &&
      constraints.maxHoursPerDay &&
      fullRoute.totalTime / 60 > constraints.maxHoursPerDay;

    const exceedsFacilities = constraints.useFacilitiesConstraint &&
      constraints.maxFacilitiesPerDay &&
      fullClusterRoute.length > constraints.maxFacilitiesPerDay;

    const exceedsDriveTime = maxDriveTime > 0 &&
      fullRoute.totalDriveTime > maxDriveTime;

    const exceedsReturnBy = returnByTime &&
      fullRoute.endTime > returnByTime;

    if (!exceedsTime && !exceedsFacilities && !exceedsDriveTime && !exceedsReturnBy) {
      // Entire cluster fits in one day - perfect!
      const optimizedRoute = optimizeRouteOrder(distanceMatrix.distances, fullClusterRoute, homeIndex);
      const dayRoute = calculateDayRoute(
        facilities,
        optimizedRoute,
        distanceMatrix,
        homeIndex,
        constraints.startTime,
        lunchBreak
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
            constraints.startTime,
            lunchBreak
          );

          const wouldExceedTime = constraints.useHoursConstraint &&
            constraints.maxHoursPerDay &&
            testDayRoute.totalTime / 60 > constraints.maxHoursPerDay;

          const wouldExceedFacilities = constraints.useFacilitiesConstraint &&
            constraints.maxFacilitiesPerDay &&
            testRoute.length >= constraints.maxFacilitiesPerDay;

          const wouldExceedDriveTime = maxDriveTime > 0 &&
            testDayRoute.totalDriveTime > maxDriveTime;

          const wouldExceedReturnBy = returnByTime &&
            testDayRoute.endTime > returnByTime;

          if (wouldExceedTime || wouldExceedFacilities || wouldExceedDriveTime || wouldExceedReturnBy) {
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
          constraints.startTime,
          lunchBreak
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
        constraints.startTime,
        lunchBreak
      );

      dayRoute.day = dayNumber;
      routes.push(dayRoute);
      dayNumber++;
    }
  }

  // Clustering picked which stops share a day by looking at a map; this pass
  // re-checks those choices against real road time now that every day is
  // fully built. It's what stops the "I drove right past a Day 1 stop on my
  // way out to a Day 2 stop" case — that stop now gets picked up en route.
  const refinedRoutes = improveAcrossDays(
    routes,
    facilities,
    distanceMatrix,
    constraints,
    homeIndex,
    lunchBreak
  );

  // Membership shifted, so re-establish the "nearest days first" numbering
  // the clustering phase set up. Without this, a day that gave up its close-in
  // stops could keep a low day number while sitting far out.
  refinedRoutes.sort((a, b) => {
    const distanceFromHome = (route: DailyRoute): number => {
      if (route.facilities.length === 0) return Infinity;
      const centroid = calculateCentroid(
        route.facilities.map(f => ({ latitude: f.latitude, longitude: f.longitude }))
      );
      return haversineDistance(
        homeBase.latitude,
        homeBase.longitude,
        centroid.latitude,
        centroid.longitude
      );
    };
    return distanceFromHome(a) - distanceFromHome(b);
  });
  refinedRoutes.forEach((route, idx) => {
    route.day = idx + 1;
  });

  const totalMiles = refinedRoutes.reduce((sum, route) => sum + route.totalMiles, 0);
  const totalDriveTime = refinedRoutes.reduce((sum, route) => sum + route.totalDriveTime, 0);

  const totalVisitTime = refinedRoutes.reduce((sum, route) => sum + route.totalVisitTime, 0);
  const totalTime = refinedRoutes.reduce((sum, route) => sum + route.totalTime, 0);

  return {
    routes: refinedRoutes,
    totalDays: refinedRoutes.length,
    totalMiles,
    totalFacilities: facilities.length,
    totalDriveTime,
    totalVisitTime,
    totalTime,
  };
}
