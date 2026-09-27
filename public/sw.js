// Service worker for the installed app.
//
// Deliberately caches NOTHING that holds data: prices, setups, your journal and
// portfolio always come live from the network, so an installed app can never
// show you a stale setup as if it were today's. The only thing kept offline is
// a small page that says you are offline.

const OFFLINE = "/offline.html";
const CACHE = "swing-desk-shell-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/icon-192.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return; // let the browser handle everything else normally
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
