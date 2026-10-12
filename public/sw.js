// public/sw.js - AniFlix PWA Service Worker for Offline Thumbnail & Image Caching
const CACHE_NAME = 'aniflix-thumbnails-v1';

// Install event - immediately take over
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate event - clean up old versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('aniflix-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Intercept image requests (AniList covers, episode thumbnails, banners)
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = request.url;

  // Only intercept GET requests
  if (request.method !== 'GET') return;

  const isImageRequest = 
    request.destination === 'image' ||
    url.includes('s4.anilist.co') ||
    url.includes('/api/proxy/image') ||
    /\.(png|jpg|jpeg|webp|avif|gif|svg)(\?.*)?$/i.test(url);

  if (isImageRequest) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        // 1. Check cache first
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }

        // 2. Fetch from network and save to cache
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch (err) {
          // If offline and not in cache, fallback gracefully
          return cachedResponse || new Response('', { status: 408 });
        }
      })
    );
  }
});

// Message listener to clear cache from settings
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'clear-image-cache') {
    caches.delete(CACHE_NAME).then(() => {
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ success: true });
      }
    });
  }
});

// Notification Click handler for Mobile Android & iOS PWA
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const animeId = event.notification.data?.animeId;
  const targetUrl = animeId ? `/?anime=${animeId}` : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a window is already open, focus it and notify client
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          client.focus();
          if (animeId) {
            client.postMessage({ type: 'aniflix:open_anime', animeId });
          }
          return;
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
