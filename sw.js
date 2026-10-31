const CACHE_NAME = "gym-log-cache-v13";
const LOCAL_FILES = ["./", "./index.html", "./manifest.json", "./icon.png"];
const CDN_FILES = [
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(LOCAL_FILES);
      await Promise.allSettled(
        CDN_FILES.map(async (url) => {
          try {
            const res = await fetch(url, { mode: "cors" });
            if (res && (res.ok || res.type === "opaque")) {
              await cache.put(url, res);
            }
          } catch (_) {
            // Ignora errori di rete in install per non bloccare l'installazione offline-first
          }
        })
      );
      // Attiva subito solo alla prima installazione (nessun client già controllato);
      // negli aggiornamenti successivi attende conferma dell'utente tramite SKIP_WAITING.
      const existingClients = await self.clients.matchAll({ type: "window" });
      if (existingClients.length === 0) {
        await self.skipWaiting();
      }
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  const isImmutableCdn = CDN_FILES.includes(req.url) || url.hostname === "cdnjs.cloudflare.com";

  // 1. Librerie CDN versionate: Cache-First pura (nessun refetch inutile in background)
  if (isImmutableCdn) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req, { mode: "cors" })
          .then((res) => {
            if (res && (res.ok || res.type === "opaque")) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => cached || Response.error());
      })
    );
    return;
  }

  // 2. Risorse locali / App Shell: Stale-While-Revalidate con fallback offline a index.html
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const networkFetch = fetch(req)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(networkFetch);
        return cached;
      }

      return networkFetch.then((res) => {
        if (res) return res;
        if (req.mode === "navigate") {
          return caches.match("./index.html");
        }
        return Response.error();
      });
    })
  );
});
