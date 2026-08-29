/// <reference lib="webworker" />

const BUILD_VERSION = '__SURVEY_ROUTE_BUILD__';
const SAFE_BUILD_VERSION = BUILD_VERSION.replace(/[^A-Za-z0-9_-]/g, '_');
const TILE_CACHE = 'map-tiles-v1';
const STATIC_CACHE = 'static-assets-' + SAFE_BUILD_VERSION;
const APP_SHELL_CACHE = 'app-shell-' + SAFE_BUILD_VERSION;
const TILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_TILE_CACHE_ENTRIES = 2000;

const APP_SHELL_URLS = ['/favicon.svg'];

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

// Install an atomic app shell. Caching index.html by itself is not enough: the
// first page load happens before a new worker controls the tab, so its hashed
// JS/CSS may never pass through this worker. Parse the built HTML and cache the
// exact Vite assets it references before activating.
self.addEventListener('install', function (event) {
  // Do not call skipWaiting(). An older open page may still need one of its
  // content-hashed lazy chunks. Let the new worker activate only after those
  // clients close so activation can safely remove the prior build caches.
  event.waitUntil(precacheAppShell());
});

async function precacheAppShell() {
  var indexResponse = await fetch('/index.html', { cache: 'no-store' });
  if (!indexResponse || !indexResponse.ok) {
    throw new Error('Unable to fetch the app shell');
  }

  var html = await indexResponse.clone().text();
  var assetUrls = [];
  var attributePattern = /(?:src|href)=["']([^"']+)["']/gi;
  var match;

  while ((match = attributePattern.exec(html))) {
    try {
      var assetUrl = new URL(match[1], self.location.origin);
      if (
        assetUrl.origin === self.location.origin &&
        isCacheableStatic(assetUrl.pathname)
      ) {
        assetUrls.push(assetUrl.pathname + assetUrl.search);
      }
    } catch (_e) {
      // Ignore malformed or non-URL attributes.
    }
  }

  if (!assetUrls.some(function (url) { return /\.js(?:\?|$)/i.test(url); })) {
    throw new Error('Built JavaScript asset was not found in index.html');
  }

  var staticCache = await caches.open(STATIC_CACHE);
  var shellAssetUrls = Array.from(new Set(APP_SHELL_URLS.concat(assetUrls)));
  await Promise.all(
    shellAssetUrls.map(async function (assetUrl) {
      // Hashed build assets are immutable and may already be in Safari's HTTP
      // cache from the page that registered this worker. Reuse that copy when
      // available instead of downloading the multi-megabyte bundle twice.
      var assetRequest = new Request(assetUrl);
      var assetResponse = await fetch(assetRequest);
      if (!isValidStaticResponse(assetRequest, assetResponse)) {
        throw new Error('Invalid app-shell asset response for ' + assetUrl);
      }
      await staticCache.put(assetRequest, assetResponse);
    })
  );

  // Publish the new HTML only after every referenced build asset exists. If a
  // deploy is mid-flight or the connection fails, the prior shell stays intact.
  var shellCache = await caches.open(APP_SHELL_CACHE);
  await Promise.all([
    shellCache.put('/', indexResponse.clone()),
    shellCache.put('/index.html', indexResponse.clone()),
  ]);
}

// Activate: clean up old caches
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return (
                key !== TILE_CACHE &&
                key !== STATIC_CACHE &&
                key !== APP_SHELL_CACHE
              );
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

// Fetch routing:
//  - Tiles: cache-first with 7-day staleness window.
//  - SPA navigations (Accept: text/html): cached shell first. A navigation must
//    never wait for the network when iOS cold-restarts a locked Safari tab.
//  - Content-hashed Vite assets: cache-first. Other same-origin static assets
//    use stale-while-revalidate after rejecting Netlify HTML fallbacks.
//  - Everything else (Supabase, Google APIs, ORS): pass through untouched so
//    we never serve stale auth or route data.
self.addEventListener('fetch', function (event) {
  var request = event.request;

  if (request.method !== 'GET') return;

  if (isTileRequest(request.url)) {
    event.respondWith(handleTileRequest(request));
    return;
  }

  var url;
  try {
    url = new URL(request.url);
  } catch (_e) {
    return;
  }

  // SPA navigations — restore immediately from the atomic cached shell.
  var isNavigation =
    request.mode === 'navigate' ||
    (request.headers.get('accept') || '').indexOf('text/html') !== -1;
  if (isNavigation && url.origin === self.location.origin) {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  // Same-origin static assets — stale-while-revalidate.
  if (url.origin === self.location.origin && isCacheableStatic(url.pathname)) {
    event.respondWith(
      handleStaticRequest(request, url.pathname.indexOf('/assets/') === 0)
    );
    return;
  }

  // Everything else passes through to the network.
});

function isCacheableStatic(pathname) {
  return /\.(?:js|mjs|css|svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|wasm|pdf)$/i.test(
    pathname
  );
}

function isValidStaticResponse(request, response) {
  if (!response || !response.ok || response.type !== 'basic') return false;

  // Netlify's SPA fallback can return index.html with status 200 for a missing
  // hashed asset. Never cache that response under a JS/CSS/image/wasm URL.
  var contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.indexOf('text/html') !== -1) return false;

  try {
    var requestUrl = new URL(request.url);
    var responseUrl = response.url ? new URL(response.url) : null;
    if (
      responseUrl &&
      responseUrl.origin === requestUrl.origin &&
      responseUrl.pathname !== requestUrl.pathname
    ) {
      return false;
    }
  } catch (_e) {
    return false;
  }

  return true;
}

async function handleNavigationRequest(request) {
  var cache = await caches.open(APP_SHELL_CACHE);
  var cached = await cache.match('/index.html');
  if (!cached) cached = await cache.match('/');
  if (cached) {
    // A locked-phone resume must not redownload the app bundle. The stamped
    // service-worker registration performs deploy discovery after the cached
    // app is already usable.
    return cached;
  }

  // First-ever visit before installation completed: network is the only
  // source available. A successful response seeds the navigation fallback.
  try {
    var response = await fetch(request);
    if (response && response.ok) {
      cache.put('/index.html', response.clone()).catch(function () {});
    }
    return response;
  } catch (_e) {
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title><body style="font-family:system-ui;padding:24px"><h1>Offline</h1><p>Survey Route is offline and the cached app shell is unavailable. Reconnect to load.</p></body>',
      { status: 503, headers: { 'Content-Type': 'text/html' } }
    );
  }
}

async function handleStaticRequest(request, immutableBuildAsset) {
  var cache = await caches.open(STATIC_CACHE);
  var cached = await cache.match(request);

  // Vite filenames are content-hashed. If this exact URL is cached, a network
  // revalidation cannot produce a newer version and only wastes connectivity.
  if (cached && immutableBuildAsset) return cached;

  var networkFetch = fetch(request)
    .then(function (response) {
      if (isValidStaticResponse(request, response)) {
        cache.put(request, response.clone()).catch(function () {});
        return response;
      }
      return null;
    })
    .catch(function () {
      return null;
    });

  if (cached) {
    // Kick off refresh in background, return cached immediately.
    networkFetch;
    return cached;
  }

  var fresh = await networkFetch;
  if (fresh) return fresh;
  return new Response('', { status: 504, statusText: 'Asset unavailable offline' });
}

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
    return new Response('', { status: 408, statusText: 'Tile unavailable offline' });
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
