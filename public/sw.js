import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// Precache assets injected by vite-plugin-pwa
precacheAndRoute(self.__WB_MANIFEST || []);

// Navigation caching (App Shell)
const navigationHandler = new NetworkFirst({
  cacheName: 'html-nav',
  networkTimeoutSeconds: 3,
  plugins: [
    new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 7 * 24 * 60 * 60 }),
  ],
});
registerRoute(new NavigationRoute(navigationHandler));

// Static assets caching
registerRoute(
  ({ url, sameOrigin }) => sameOrigin && /\.(?:js|css|woff2?|png|svg|ico|webmanifest)$/.test(url.pathname),
  new CacheFirst({
    cacheName: 'static-assets',
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  })
);

// Fallback for offline navigation
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open('static-assets').then((cache) => cache.add('/offline.html')));
});
