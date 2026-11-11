const CACHE = "sticky-board-v10";
const ASSETS = [
  "./",
  "./app.html",
  "./login.html",
  "./feedback.html",
  "./styles.css",
  "./vendor/supabase-js-2.119.0.min.js",
  "./fonts/fonts.css",
  "./fonts/worksans-latin.woff2",
  "./fonts/caveat-latin.woff2",
  "./fonts/fraunces-latin.woff2",
  "./js/constants.js",
  "./js/helpers.js",
  "./js/state.js",
  "./js/render.js",
  "./js/popout.js",
  "./js/events.js",
  "./js/reminders.js",
  "./js/toast.js",
  "./js/shortcuts.js",
  "./js/sync-status.js",
  "./js/config-loader.js",
  "./js/sync.js",
  "./js/app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./favicon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Only same-origin static assets are ever cached. This deliberately excludes:
//   * /api/*            -- server functions must never be served stale.
//   * cross-origin URLs -- previously every 200 was cached, which meant one account's
//     Supabase REST responses (including their board JSON) could sit in Cache Storage on a
//     shared browser and be handed back later. The Cache API ignores the Authorization
//     header, so it had no way to tell two users apart.
//   * opaque/error responses -- nothing useful to store.
function isCacheable(request, url) {
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  return true;
}

// Keeps the offline cache from growing without limit as the app gets new versions.
async function trimCache(name, maxEntries) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  for (const key of keys.slice(0, keys.length - maxEntries)) await cache.delete(key);
}

// Network-first: always fetch the latest version when online, so app updates
// show up immediately on the next load. Only falls back to the cached copy
// when there's no network at all (true offline use).
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!isCacheable(event.request, url)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === "basic") {
          const copy = response.clone();
          caches
            .open(CACHE)
            .then((cache) => cache.put(event.request, copy))
            .then(() => trimCache(CACHE, 80))
            .catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
