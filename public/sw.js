const CACHE = "sol-gate-shell-v8";
const SHELL = ["/", "/manifest.webmanifest", "/logo.webp", "/brandmark.png", "/favicon.png", "/appleicon.png", "/icon192.png", "/icon512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window" });
    await Promise.all(clients.map((client) => client.navigate(client.url)));
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    const network = fetch(event.request).then(async (response) => {
      if (response.ok) await (await caches.open(CACHE)).put(event.request, response.clone());
      return response;
    }).catch(() => null);
    return cached || await network || Response.error();
  })());
});
