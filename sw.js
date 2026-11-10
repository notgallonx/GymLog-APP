const CACHE_NAME = "gym-log-cache-v17";
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

      // Pre-cache opzionale e non bloccante delle librerie CDN solo se online
      if (!self.navigator || self.navigator.onLine !== false) {
        Promise.allSettled(
          CDN_FILES.map(async (url) => {
            try {
              const res = await fetch(url, { mode: "cors" });
              if (res && (res.ok || res.type === "opaque")) {
                await cache.put(url, res);
              }
            } catch (_) {
              // Ignora errori di rete: le librerie CDN vengono caricate on-demand e cachate al primo uso
            }
          })
        );
      }

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
      if (self.registration && self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch (_) {}
      }
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

  const isOffline = self.navigator && self.navigator.onLine === false;
  const isImmutableCdn = CDN_FILES.includes(req.url) || url.hostname === "cdnjs.cloudflare.com";

  // 1. Librerie CDN versionate: Cache-First pura (nessun refetch inutile in background)
  if (isImmutableCdn) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (isOffline) return Response.error();
        try {
          const res = await fetch(req, { mode: "cors" });
          if (res && (res.ok || res.type === "opaque")) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        } catch (_) {
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // 2. Risorse locali / App Shell: Stale-While-Revalidate + navigationPreload, zero fetch inutili offline
  event.respondWith(
    (async () => {
      const cached = await caches.match(req, { ignoreSearch: true });

      const revalidateFromNetwork = async () => {
        if (isOffline) return null;
        try {
          const preloadRes = await event.preloadResponse;
          if (preloadRes && preloadRes.ok) {
            const copy = preloadRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
            return preloadRes;
          }
          const networkRes = await fetch(req);
          if (networkRes && networkRes.ok) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return networkRes;
        } catch (_) {
          return null;
        }
      };

      if (cached) {
        if (!isOffline) {
          event.waitUntil(revalidateFromNetwork());
        }
        return cached;
      }

      const res = await revalidateFromNetwork();
      if (res) return res;
      if (req.mode === "navigate") {
        const fallback = await caches.match("./index.html");
        if (fallback) return fallback;
      }
      return Response.error();
    })()
  );
});
