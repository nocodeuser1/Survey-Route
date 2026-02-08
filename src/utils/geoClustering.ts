export interface GeoPoint {
  latitude: number;
  longitude: number;
  id?: string | number;
}

export interface Cluster {
  centroid: GeoPoint;
  points: GeoPoint[];
  id: number;
}

export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateCentroid(points: GeoPoint[]): GeoPoint {
  if (points.length === 0) {
    return { latitude: 0, longitude: 0 };
  }

  let x = 0;
  let y = 0;
  let z = 0;

  for (const point of points) {
    const latRad = (point.latitude * Math.PI) / 180;
    const lonRad = (point.longitude * Math.PI) / 180;

    x += Math.cos(latRad) * Math.cos(lonRad);
    y += Math.cos(latRad) * Math.sin(lonRad);
    z += Math.sin(latRad);
  }

  x /= points.length;
  y /= points.length;
  z /= points.length;

  const lonRad = Math.atan2(y, x);
  const hyp = Math.sqrt(x * x + y * y);
  const latRad = Math.atan2(z, hyp);

  return {
    latitude: (latRad * 180) / Math.PI,
    longitude: (lonRad * 180) / Math.PI,
  };
}

export function kMeansClustering(
  points: GeoPoint[],
  k: number,
  maxIterations: number = 50,
  tightness: number = 0.75
): Cluster[] {
  if (points.length === 0) return [];
  if (points.length <= k) {
    return points.map((point, index) => ({
      centroid: point,
      points: [point],
      id: index,
    }));
  }

  const clusters: Cluster[] = [];
  const initialCentroids: GeoPoint[] = [];

  // Use K-means++ initialization for better and varied starting centroids
  // Pick first centroid randomly
  const firstIndex = Math.floor(Math.random() * points.length);
  initialCentroids.push(points[firstIndex]);

  // Pick remaining centroids with probability proportional to distance from nearest existing centroid
  for (let i = 1; i < k; i++) {
    const distances: number[] = [];
    let totalDistance = 0;

    for (const point of points) {
      let minDist = Infinity;
      for (const centroid of initialCentroids) {
        const dist = haversineDistance(
          point.latitude,
          point.longitude,
          centroid.latitude,
          centroid.longitude
        );
        minDist = Math.min(minDist, dist);
      }
      distances.push(minDist * minDist); // Square the distance for better spread
      totalDistance += minDist * minDist;
    }

    // Pick a point with probability proportional to its distance
    let random = Math.random() * totalDistance;
    for (let j = 0; j < points.length; j++) {
      random -= distances[j];
      if (random <= 0) {
        initialCentroids.push(points[j]);
        break;
      }
    }

    // Fallback if we didn't pick a point
    if (initialCentroids.length === i) {
      const fallbackIndex = Math.floor((i * points.length) / k);
      initialCentroids.push(points[fallbackIndex]);
    }
  }

  for (let i = 0; i < k; i++) {
    clusters.push({
      centroid: initialCentroids[i],
      points: [],
      id: i,
    });
  }

  // Tightness affects how much we penalize distance from centroid
  // Higher tightness = stronger penalty = tighter clusters
  // Exponential scaling makes the effect more pronounced
  const distancePenalty = 1 + (tightness * 4); // Increased from 2 to 4 for stronger effect

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    for (const cluster of clusters) {
      cluster.points = [];
    }

    for (const point of points) {
      let minScore = Infinity;
      let closestCluster = 0;

      for (let i = 0; i < clusters.length; i++) {
        const distance = haversineDistance(
          point.latitude,
          point.longitude,
          clusters[i].centroid.latitude,
          clusters[i].centroid.longitude
        );

        // Apply distance penalty based on tightness
        // Higher tightness means distance matters more
        const score = Math.pow(distance, distancePenalty);

        if (score < minScore) {
          minScore = score;
          closestCluster = i;
        }
      }

      clusters[closestCluster].points.push(point);
    }

    let converged = true;
    for (const cluster of clusters) {
      if (cluster.points.length === 0) continue;

      const newCentroid = calculateCentroid(cluster.points);
      const shift = haversineDistance(
        cluster.centroid.latitude,
        cluster.centroid.longitude,
        newCentroid.latitude,
        newCentroid.longitude
      );

      if (shift > 0.001) {
        converged = false;
      }

      cluster.centroid = newCentroid;
    }

    if (converged) break;
  }

  return clusters.filter((cluster) => cluster.points.length > 0);
}

export function balanceClusters(
  clusters: Cluster[],
  maxPointsPerCluster: number,
  homeBase: GeoPoint,
  balanceWeight: number = 0.35
): Cluster[] {
  const overloadedClusters = clusters.filter(
    (c) => c.points.length > maxPointsPerCluster
  );

  if (overloadedClusters.length === 0) {
    // Even if no clusters are overloaded, validate geographic cohesion
    return validateGeographicCohesion(clusters, homeBase);
  }

  const newClusters: Cluster[] = [];
  let nextId = 0;

  for (const cluster of clusters) {
    if (cluster.points.length <= maxPointsPerCluster) {
      newClusters.push({ ...cluster, id: nextId++ });
      continue;
    }

    const numSubClusters = Math.ceil(cluster.points.length / maxPointsPerCluster);

    // Use K-means to properly re-cluster the overloaded cluster
    // This ensures geographic cohesion within each sub-cluster
    const subClusters = kMeansClustering(
      cluster.points,
      numSubClusters,
      30,
      0.8 // Use very high tightness for sub-clustering to keep them compact
    );

    // Balance the sub-clusters based on balance weight
    // Lower weight = prioritize geography, Higher weight = prioritize even distribution
    const balancedSubClusters = redistributePoints(
      subClusters,
      maxPointsPerCluster,
      homeBase,
      balanceWeight
    );

    for (const subCluster of balancedSubClusters) {
      if (subCluster.points.length > 0) {
        newClusters.push({
          ...subCluster,
          id: nextId++,
        });
      }
    }
  }

  return validateGeographicCohesion(newClusters, homeBase);
}

function validateGeographicCohesion(
  clusters: Cluster[],
  homeBase: GeoPoint
): Cluster[] {
  // Check each cluster to ensure points aren't on opposite sides of home base
  const validatedClusters: Cluster[] = [];

  for (const cluster of clusters) {
    if (cluster.points.length <= 1) {
      validatedClusters.push(cluster);
      continue;
    }

    // Also check if cluster has points too far from its centroid
    const distances = cluster.points.map(p =>
      haversineDistance(p.latitude, p.longitude, cluster.centroid.latitude, cluster.centroid.longitude)
    );
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDistance = Math.max(...distances);

    // If max distance is more than 3x average, cluster is too spread out
    if (maxDistance > avgDistance * 3) {
      // Split this cluster into two
      const sortedByDist = cluster.points
        .map((p, idx) => ({ p, dist: distances[idx] }))
        .sort((a, b) => a.dist - b.dist);

      const midpoint = Math.floor(sortedByDist.length / 2);
      const close = sortedByDist.slice(0, midpoint).map(x => x.p);
      const far = sortedByDist.slice(midpoint).map(x => x.p);

      if (close.length > 0) {
        validatedClusters.push({
          centroid: calculateCentroid(close),
          points: close,
          id: cluster.id,
        });
      }

      if (far.length > 0) {
        validatedClusters.push({
          centroid: calculateCentroid(far),
          points: far,
          id: cluster.id + 0.5,
        });
      }
      continue;
    }

    // Calculate bearing from home base to each point
    const bearings = cluster.points.map(point => {
      const lat1 = homeBase.latitude * Math.PI / 180;
      const lat2 = point.latitude * Math.PI / 180;
      const dLon = (point.longitude - homeBase.longitude) * Math.PI / 180;

      const y = Math.sin(dLon) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) -
                Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

      let bearing = Math.atan2(y, x) * 180 / Math.PI;
      bearing = (bearing + 360) % 360; // Normalize to 0-360

      return { point, bearing };
    });

    // Check if bearings span more than 100 degrees (indicates opposite sides)
    bearings.sort((a, b) => a.bearing - b.bearing);
    const bearingSpan = Math.max(
      bearings[bearings.length - 1].bearing - bearings[0].bearing,
      360 - (bearings[bearings.length - 1].bearing - bearings[0].bearing)
    );

    // Reduced from 120 to 100 degrees for tighter geographic grouping
    if (bearingSpan > 100) {
      // Split into two clusters based on bearing
      const midBearing = (bearings[0].bearing + bearings[bearings.length - 1].bearing) / 2;

      const cluster1Points: GeoPoint[] = [];
      const cluster2Points: GeoPoint[] = [];

      bearings.forEach(({ point, bearing }) => {
        const diff = Math.abs(bearing - midBearing);
        const wrappedDiff = Math.min(diff, 360 - diff);

        if (wrappedDiff < 90) {
          cluster1Points.push(point);
        } else {
          cluster2Points.push(point);
        }
      });

      if (cluster1Points.length > 0) {
        validatedClusters.push({
          centroid: calculateCentroid(cluster1Points),
          points: cluster1Points,
          id: cluster.id,
        });
      }

      if (cluster2Points.length > 0) {
        validatedClusters.push({
          centroid: calculateCentroid(cluster2Points),
          points: cluster2Points,
          id: cluster.id + 0.5, // Temporary ID, will be reassigned
        });
      }
    } else {
      validatedClusters.push(cluster);
    }
  }

  // Reassign IDs
  return validatedClusters.map((c, idx) => ({ ...c, id: idx }));
}

function redistributePoints(
  clusters: Cluster[],
  maxPointsPerCluster: number,
  homeBase: GeoPoint,
  balanceWeight: number
): Cluster[] {
  // Calculate target size for each cluster
  const totalPoints = clusters.reduce((sum, c) => sum + c.points.length, 0);
  const avgSize = totalPoints / clusters.length;

  // Sort clusters by distance from home base
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

  // If balance weight is low, prioritize keeping points in their geographic cluster
  // Only do redistribution if balance weight is above 0.6
  if (balanceWeight < 0.6) {
    return clusters;
  }

  // Calculate maximum allowed distance for geographic cohesion
  // A point should not be more than this far from the cluster centroid
  const calculateMaxClusterRadius = (cluster: Cluster): number => {
    if (cluster.points.length === 0) return 0;

    const distances = cluster.points.map(p =>
      haversineDistance(p.latitude, p.longitude, cluster.centroid.latitude, cluster.centroid.longitude)
    );

    // Use 95th percentile of current distances as max radius
    distances.sort((a, b) => a - b);
    const percentile95Index = Math.floor(distances.length * 0.95);
    return distances[percentile95Index] || distances[distances.length - 1];
  };

  // For higher balance weights, try to even out cluster sizes
  for (let i = 0; i < clusters.length - 1; i++) {
    const currentCluster = clusters[i];
    const nextCluster = clusters[i + 1];

    // Calculate max radius for next cluster to maintain geographic cohesion
    const maxNextRadius = calculateMaxClusterRadius(nextCluster) * 1.5; // Allow 50% expansion

    // If current cluster is much larger than next, move some points
    while (
      currentCluster.points.length > avgSize &&
      nextCluster.points.length < maxPointsPerCluster &&
      currentCluster.points.length > nextCluster.points.length + 1
    ) {
      // Find the point in current cluster closest to next cluster
      let closestPoint: GeoPoint | null = null;
      let minDist = Infinity;
      let closestIdx = -1;

      currentCluster.points.forEach((point, idx) => {
        const dist = haversineDistance(
          point.latitude,
          point.longitude,
          nextCluster.centroid.latitude,
          nextCluster.centroid.longitude
        );
        if (dist < minDist) {
          minDist = dist;
          closestPoint = point;
          closestIdx = idx;
        }
      });

      if (closestPoint && closestIdx >= 0) {
        // Check if moving this point would break geographic cohesion
        const distToNextCentroid = haversineDistance(
          closestPoint.latitude,
          closestPoint.longitude,
          nextCluster.centroid.latitude,
          nextCluster.centroid.longitude
        );

        // Only move if the point would maintain geographic cohesion
        if (distToNextCentroid <= maxNextRadius) {
          // Move the point
          currentCluster.points.splice(closestIdx, 1);
          nextCluster.points.push(closestPoint);

          // Update centroids
          currentCluster.centroid = calculateCentroid(currentCluster.points);
          nextCluster.centroid = calculateCentroid(nextCluster.points);
        } else {
          // Can't move this point without breaking cohesion, stop trying
          break;
        }
      } else {
        break;
      }
    }
  }

  return clusters;
}

export function findOptimalClusters(
  points: GeoPoint[],
  maxPointsPerCluster: number,
  maxClusters?: number
): number {
  if (points.length <= maxPointsPerCluster) {
    return 1;
  }

  const minClusters = Math.ceil(points.length / maxPointsPerCluster);

  if (maxClusters && minClusters > maxClusters) {
    return maxClusters;
  }

  return minClusters;
}
