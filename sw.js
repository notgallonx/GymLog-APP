const CACHE_NAME = "gym-log-cache-v9";
const LOCAL_FILES = ["./", "./index.html", "./manifest.json", "./icon.png"];
const CDN_FILES = ["https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(LOCAL_FILES);
      // Chart.js versione fissata da CDN: se fallisce offline l'installazione non si interrompe
      await Promise.allSettled(CDN_FILES.map((u) => cache.add(u)));
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stale-while-revalidate: risposta immediata dalla cache e aggiornamento silente in background
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((response) => {
          if (response && (response.ok || response.type === "opaque")) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
