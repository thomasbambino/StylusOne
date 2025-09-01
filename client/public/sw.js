// Cache version - update this when cache structure changes
const CACHE_VERSION = 'v1';
const CACHE_NAME = `homelab-dashboard-${CACHE_VERSION}`;

// Assets to cache on install
const STATIC_CACHE_URLS = [
  '/',
  '/index.html',
  '/src/main.tsx',
  '/src/index.css',
  '/vite.svg'
];

// Install service worker and cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_CACHE_URLS);
    })
  );
});

// Clean up old caches when a new service worker takes over
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('homelab-dashboard-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
});

// Function to check if the cached response is still valid based on refreshInterval
function isCacheValid(cachedResponse, refreshInterval = 30) {
  if (!cachedResponse) return false;

  const cachedTime = new Date(cachedResponse.headers.get('sw-cache-timestamp'));
  const now = new Date();
  return (now.getTime() - cachedTime.getTime()) < (refreshInterval * 1000);
}

// Fetch handler with different strategies for different requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Special handling for game servers endpoint
  if (url.pathname === '/api/game-servers') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        // Always try to get from cache first
        const cachedResponse = await caches.match(event.request);

        // If we have any cached response, serve it immediately
        if (cachedResponse) {
          // Fetch fresh data in the background
          fetch(event.request)
            .then(async (networkResponse) => {
              const clonedResponse = networkResponse.clone();

              // Add timestamp header for cache validation
              const headers = new Headers(clonedResponse.headers);
              headers.append('sw-cache-timestamp', new Date().toISOString());

              // Create a new response with the timestamp header
              const responseToCache = new Response(await clonedResponse.blob(), {
                status: clonedResponse.status,
                statusText: clonedResponse.statusText,
                headers: headers
              });

              // Update the cache with fresh data
              cache.put(event.request, responseToCache);
            })
            .catch(console.error); // Silently handle background fetch errors

          return cachedResponse;
        }

        // If no cache exists yet, fetch from network
        try {
          const networkResponse = await fetch(event.request);
          const clonedResponse = networkResponse.clone();

          // Add timestamp header for cache validation
          const headers = new Headers(clonedResponse.headers);
          headers.append('sw-cache-timestamp', new Date().toISOString());

          // Create a new response with the timestamp header
          const responseToCache = new Response(await clonedResponse.blob(), {
            status: clonedResponse.status,
            statusText: clonedResponse.statusText,
            headers: headers
          });

          // Cache the response
          cache.put(event.request, responseToCache);

          return networkResponse;
        } catch (error) {
          // If all fails, return an offline response
          return new Response(
            JSON.stringify({
              error: 'You are offline and no cached data is available.',
              offline: true
            }),
            {
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
      })
    );
  } 
  // Network-first strategy for other API calls
  else if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Clone the response before caching it
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          // If network request fails, try to get from cache
          return caches.match(event.request).then((response) => {
            if (response) {
              return response;
            }
            // If no cached response, return a basic offline response
            return new Response(
              JSON.stringify({
                error: 'You are offline and no cached data is available.',
                offline: true
              }),
              {
                headers: { 'Content-Type': 'application/json' }
              }
            );
          });
        })
    );
  } else {
    // Cache-first strategy for static assets
    event.respondWith(
      caches.match(event.request).then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request).then((response) => {
          // Cache new static assets
          if (response.ok && (
            event.request.url.includes('.js') ||
            event.request.url.includes('.css') ||
            event.request.url.includes('.png') ||
            event.request.url.includes('.svg') ||
            event.request.url.includes('fonts') ||  // Cache font files
            event.request.url.includes('icons')     // Cache icon files
          )) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        });
      })
    );
  }
});