const CACHE = "sticky-board-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./js/constants.js",
  "./js/helpers.js",
  "./js/state.js",
  "./js/render.js",
  "./js/popout.js",
  "./js/events.js",
  "./js/reminders.js",
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

// Network-first: always fetch the latest version when online, so app updates
// show up immediately on the next load. Only falls back to the cached copy
// when there's no network at all (true offline use).
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
