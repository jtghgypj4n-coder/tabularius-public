// The installed app's service worker: keeps the web client's own files (pages, scripts, styles, icons) so the app
// opens without a connection. Only /app/ files are kept; no record, layout or other data from the server is,
// so nothing of a file's data stays on the device through it. Each file is fetched fresh when there is a
// connection (the copy kept is the last one fetched), and the kept copy is used when there isn't.

const CACHE = 'tabularius-app-v1';
const SHELL = ['./', 'index.html', 'tokens.css', 'app.css', 'manifest.webmanifest', 'icon.svg', 'favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => (k.startsWith('tabularius-app-') || k.startsWith('openhbam-app-')) && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// The page tells the worker which of the app's files it loaded before the worker was running (its scripts, on a
// first visit), so those are kept too.
self.addEventListener('message', (event) => {
  const urls = Array.isArray(event.data?.keep) ? event.data.keep : [];
  const scope = new URL(self.registration.scope);
  const ours = urls.map((u) => new URL(String(u), scope)).filter((u) => u.origin === scope.origin && u.pathname.startsWith(scope.pathname));
  event.waitUntil(caches.open(CACHE).then((c) => Promise.all(ours.map((u) => c.match(u.href, { ignoreSearch: true }).then((had) => had
    || fetch(u.href).then((res) => (res.ok && res.type === 'basic' ? c.put(u.href, res) : undefined))).catch(() => {})))));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (req.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const kept = await caches.match(req, { ignoreSearch: true })
        ?? (req.mode === 'navigate' ? await caches.match('index.html', { ignoreSearch: true }) ?? await caches.match('./') : undefined);
      if (kept) return kept;
      throw err;
    }
  })());
});
