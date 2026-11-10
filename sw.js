// Service worker Odškrtníku: umožní instalaci aplikace a její spuštění i při slabém signálu.
// Strategie „nejdřív síť“: vždy se zkusí nová verze z webu, mezipaměť je jen záloha,
// takže aktualizace se projeví hned. Volání Googlu (přihlášení, Disk, Tabulky) se nikdy neukládají.
const VERSION = '20261110-1119';
const CACHE = `odskrtnik-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('odskrtnik-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  // Jen GET požadavky na vlastní soubory aplikace; Google API a přihlášení jdou mimo.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Jste offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
