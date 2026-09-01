const CACHE = "pub-jukebox-v9";
const ASSETS = [
  "/static/common.css",
  "/static/guest.js",
  "/static/join.js",
  "/static/install.js",
  "/static/manifest.webmanifest",
  "/static/tv.webmanifest",
  "/static/admin.webmanifest",
  "/static/icon-180.png",
  "/static/icon-192.png",
  "/static/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
