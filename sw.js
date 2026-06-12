const CACHE_VERSION = "sixbpm-v29";
const ASSETS = [
  "./",
  "index.html",
  "about.html",
  "vagal-tone.html",
  "operator-manifesto.html",
  "app.js?v=cache-v29",
  "state.js",
  "audio.js",
  "sensors.js",
  "breath-detector.js",
  "diagnostics.js",
  "storage.js",
  "ui.js",
  "style.css?v=cache-v29",
  "manifest.json?v=cache-v29",
  "favicon.ico",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !["http:", "https:"].includes(url.protocol)
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        if (!response.ok || response.type !== "basic") {
          return response;
        }
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
