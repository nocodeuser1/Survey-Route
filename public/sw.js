/// <reference lib="webworker" />

const TILE_CACHE = 'map-tiles-v1';
const STATIC_CACHE = 'static-assets-v2';
const APP_SHELL_CACHE = 'app-shell-v2';
const TILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_TILE_CACHE_ENTRIES = 2000;

// Minimal app shell — index.html is the SPA entrypoint. Hashed JS/CSS get
// cached opportunistically on first fetch (see handleStaticRequest below).
const APP_SHELL_URLS = ['/', '/index.html', '/favicon.svg'];

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

// Install: precache the app shell so iOS can re-render the SPA even when the
// WebKit process was purged after backgrounding and the network is offline.
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then(function (cache) {
        return cache.addAll(APP_SHELL_URLS).catch(function () {
          // Non-fatal: missing assets shouldn't block SW install.
        });
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
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
//  - SPA navigations (Accept: text/html): network-first, fall back to cached
//    index.html so a backgrounded → offline reopen doesn't blank the app.
//  - Same-origin static assets (JS/CSS/images/wasm/pdf): stale-while-revalidate
//    so cached bundles render instantly while a newer copy refreshes in bg.
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

  // SPA navigations — always try network first, fall back to cached shell.
  var isNavigation =
    request.mode === 'navigate' ||
    (request.headers.get('accept') || '').indexOf('text/html') !== -1;
  if (isNavigation && url.origin === self.location.origin) {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  // Same-origin static assets — stale-while-revalidate.
  if (url.origin === self.location.origin && isCacheableStatic(url.pathname)) {
    event.respondWith(handleStaticRequest(request));
    return;
  }

  // Everything else passes through to the network.
});

function isCacheableStatic(pathname) {
  return /\.(?:js|mjs|css|svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|wasm|pdf)$/i.test(
    pathname
  );
}

async function handleNavigationRequest(request) {
  try {
    var response = await fetch(request);
    if (response && response.ok) {
      var cache = await caches.open(APP_SHELL_CACHE);
      cache.put('/index.html', response.clone()).catch(function () {});
    }
    return response;
  } catch (_e) {
    var cache2 = await caches.open(APP_SHELL_CACHE);
    var cached = await cache2.match('/index.html');
    if (cached) return cached;
    var fallback = await cache2.match('/');
    if (fallback) return fallback;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title><body style="font-family:system-ui;padding:24px"><h1>Offline</h1><p>Survey Route is offline and the cached app shell is unavailable. Reconnect to load.</p></body>',
      { status: 503, headers: { 'Content-Type': 'text/html' } }
    );
  }
}

async function handleStaticRequest(request) {
  var cache = await caches.open(STATIC_CACHE);
  var cached = await cache.match(request);

  var networkFetch = fetch(request)
    .then(function (response) {
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone()).catch(function () {});
      }
      return response;
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
