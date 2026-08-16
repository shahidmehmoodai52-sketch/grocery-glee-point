/**
 * Tillix Service Worker
 * Managed via vite-plugin-pwa (InjectManifest)
 */
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// cleanup old caches
cleanupOutdatedCaches();

// The __WB_MANIFEST variable is a placeholder that Workbox will replace with the precache manifest.
precacheAndRoute(self.__WB_MANIFEST);

// Navigation route: NetworkFirst with offline fallback
// This ensures that if the network is down (or DNS fails), we serve the precached /offline.html
// which is designed to boot the SPA shell.
registerRoute(
  ({ request }) => request.mode === 'navigate',
  async (options) => {
    const networkHandler = new NetworkFirst({
      cacheName: 'tillix-nav',
      networkTimeoutSeconds: 5,
      plugins: [
        new ExpirationPlugin({
          maxEntries: 50,
          maxAgeSeconds: 7 * 24 * 60 * 60,
        }),
      ],
    });

    try {
      const response = await networkHandler.handle(options);
      if (response) return response;
    } catch (error) {
      console.log('SW: Network navigation failed, serving offline shell', error);
    }
    
    // Fallback to the precached shell for all navigations when offline
    return caches.match('/offline.html');
  }
);

// Cache static assets (JS, CSS, fonts) with CacheFirst
registerRoute(
  ({ request }) => request.destination === 'script' || request.destination === 'style' || request.destination === 'font',
  new CacheFirst({
    cacheName: 'tillix-static',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
      }),
    ],
  })
);

// Cache images with StaleWhileRevalidate
registerRoute(
  ({ request }) => request.destination === 'image',
  new StaleWhileRevalidate({
    cacheName: 'tillix-images',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    ],
  })
);

// Handle offline page fallback
self.addEventListener('install', (event) => {
  const offlinePagePath = '/offline.html';
  event.waitUntil(
    caches.open('tillix-offline-fallback').then((cache) => cache.add(offlinePagePath))
  );
});
