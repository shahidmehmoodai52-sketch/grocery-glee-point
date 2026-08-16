/**
 * Tillix Service Worker
 * Managed via vite-plugin-pwa (InjectManifest)
 */
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// Cleanup old caches
cleanupOutdatedCaches();

// Precache all assets provided by Vite
// The __WB_MANIFEST variable is a placeholder that Workbox will replace.
precacheAndRoute(self.__WB_MANIFEST || []);

// Navigation route: NetworkFirst with offline fallback
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
      if (response && response.ok) return response;
    } catch (error) {
      console.log('SW: Network navigation failed, serving offline shell', error);
    }
    
    // Fallback to the precached shell for all navigations when offline
    const cachedResponse = await caches.match('/offline.html');
    if (cachedResponse) return cachedResponse;
    
    // Last resort: return the index if offline.html isn't found for some reason
    return caches.match('/');
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

// Force immediate activation
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
