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
// This ensures that if the network is down, we serve the last cached version of the page.
const navigationHandler = new NetworkFirst({
  cacheName: 'tillix-nav',
  networkTimeoutSeconds: 5, // give it 5s before falling back to cache
  plugins: [
    new ExpirationPlugin({
      maxEntries: 50,
      maxAgeSeconds: 7 * 24 * 60 * 60, // 1 week
    }),
  ],
});
registerRoute(new NavigationRoute(navigationHandler));

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
