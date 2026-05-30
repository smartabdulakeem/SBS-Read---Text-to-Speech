// Self-unregistering service worker.
//
// The previous version was cache-first with a hardcoded cache name that never
// updated. After each deploy it kept serving a stale index.html that referenced
// old (now-missing) hashed assets, which broke the app. This version takes over,
// clears ALL caches, unregisters itself, and reloads open tabs so every client
// recovers automatically. (Offline support for the web is intentionally dropped;
// the Android APK is the offline target.)
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    })()
  );
});
