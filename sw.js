/* Service worker: permite instalar la app y abrirla sin conexión.
 * - Archivos propios: "network first" (siempre la versión más reciente si hay red; caché como respaldo).
 * - Librerías y fuentes de CDN: "stale-while-revalidate".
 * - Supabase: nunca se guarda en caché (datos siempre en vivo).
 * Cambia VERSION al publicar cambios grandes para limpiar cachés viejas.
 */
const VERSION = "v1";
const CACHE = `elemental-gasto-${VERSION}`;
const SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/config.js",
  "./js/budget.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("elemental-gasto-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Datos en vivo: no tocar
  if (url.hostname.endsWith("supabase.co") || url.protocol.startsWith("ws")) return;

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  if (/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname)) {
    event.respondWith(
      caches.open(CACHE).then(async (c) => {
        const cached = await c.match(req);
        const network = fetch(req).then((res) => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
