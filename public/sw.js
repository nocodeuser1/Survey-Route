/// <reference lib="webworker" />

const TILE_CACHE = 'map-tiles-v1';
const STATIC_CACHE = 'static-assets-v1';
const TILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_TILE_CACHE_ENTRIES = 2000;

// Tile URL patterns to cache
const TILE_PATTERNS = [
  /^https?:\/\/[a-c]\.tile\.openstreetmap\.org\//,
  /^https?:\/\/[a-d]\.basemaps\.cartocdn\.com\//,
  /^https?:\/\/tile\.openstreetmap\.org\//,
  /^https?:\/\/[a-c]\.tile\.thunderforest\.com\//,
  /^https?:\/\/mt[0-3]\.google\.com\/vt\//,
  /^https?:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\//,
  /^https?:\/\/[a-c]\.tile\.opentopomap\.org\//,
];

function isTileRequest(url) {
  return TILE_PATTERNS.some(function (pattern) {
    return pattern.test(url);
  });
}

// Install: activate immediately
self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting());
});

// Activate: clean up old caches
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key !== TILE_CACHE && key !== STATIC_CACHE;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

// Fetch: cache-first for tiles, network-first for everything else
self.addEventListener('fetch', function (event) {
  var request = event.request;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  if (isTileRequest(request.url)) {
    event.respondWith(handleTileRequest(request));
  }
  // Let all other requests pass through to network normally
});

async function handleTileRequest(request) {
  var cache = await caches.open(TILE_CACHE);

  // Try cache first
  var cached = await cache.match(request);
  if (cached) {
    // Check if cached response is still fresh
    var cachedDate = cached.headers.get('sw-cached-at');
    if (cachedDate) {
      var age = Date.now() - parseInt(cachedDate, 10);
      if (age < TILE_MAX_AGE_MS) {
        return cached;
      }
    } else {
      // No timestamp, still return it but refresh in background
      refreshTile(request, cache);
      return cached;
    }
  }

  // Cache miss or stale - fetch from network
  try {
    var response = await fetch(request);
    if (response.ok) {
      await cacheTile(request, response.clone(), cache);
    }
    return response;
  } catch (err) {
    // Network failed - return stale cache if available
    if (cached) return cached;
    throw err;
  }
}

async function cacheTile(request, response, cache) {
  // Add timestamp header for freshness checking
  var headers = new Headers(response.headers);
  headers.set('sw-cached-at', Date.now().toString());

  var timedResponse = new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: headers,
  });

  await cache.put(request, timedResponse);
  await trimTileCache(cache);
}

async function refreshTile(request, cache) {
  try {
    var response = await fetch(request);
    if (response.ok) {
      await cacheTile(request, response, cache);
    }
  } catch (_e) {
    // Silently fail background refresh
  }
}

async function trimTileCache(cache) {
  var keys = await cache.keys();
  if (keys.length > MAX_TILE_CACHE_ENTRIES) {
    // Remove oldest entries (FIFO)
    var toDelete = keys.slice(0, keys.length - MAX_TILE_CACHE_ENTRIES);
    await Promise.all(
      toDelete.map(function (key) {
        return cache.delete(key);
      })
    );
  }
}
