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
precacheAndRoute(self.__WB_MANIFEST);

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
      console.log('SW: Network navigation failed, serving cached app shell', error);
    }

    // Reuse a real, previously-cached SSR'd page from this exact build as the
    // offline hydration shell. It already carries the correct <script> tag
    // for this build's JS entry (TanStack Start's script src changes on
    // every deploy, so a static hand-written HTML file can't reference it
    // reliably) — and once that JS boots, the client-side router reads
    // window.location and renders whatever URL is actually in the address
    // bar, regardless of which route this cached page was originally for.
    // This is the standard SPA offline-fallback pattern. offline.html
    // (a static "Loading..." page with no script tag at all, so the app
    // never actually booted) is now only the last-resort fallback for a
    // shop's very first-ever offline visit, before anything is cached yet.
    const navCache = await caches.open('tillix-nav');
    let shellResponse = await navCache.match('/');
    if (!shellResponse) {
      const keys = await navCache.keys();
      if (keys.length > 0) shellResponse = await navCache.match(keys[0]);
    }
    if (shellResponse) return shellResponse;

    const offlineResponse = await caches.match('/offline.html');
    if (offlineResponse) return offlineResponse;
    return Response.error();
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
