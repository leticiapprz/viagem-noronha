// App-shell offline cache. Só mexe em requisições do próprio domínio —
// Firebase, fontes, Leaflet, Chart.js, tiles do OSM ficam de fora (não dá
// pra promissoravelmente cachear tudo isso às cegas; o index.html já
// degrada bem sem eles, ver PROJECT_MAP.md).
const CACHE_VERSION = 'v2';
const CACHE_NAME = 'noronha-shell-' + CACHE_VERSION;
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './foto1.jpg',
  './foto2.png',
  './foto3.jpg',
  './nos1.jpg',
  './nos2.jpg',
  './nos3.jpg',
  './nos4.jpg',
  './nos5.jpg',
  './nos6.jpg',
  './nos7.jpg',
  './nos8.png',
  './nos9.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // não mexe em Firebase/CDN/tiles

  const isAppShell = req.mode === 'navigate' || url.pathname.endsWith('/index.html');

  if (isAppShell) {
    // network-first: pega a versão mais nova quando tem internet, cai pro
    // cache quando não tem (é o caso que importa: abrir o app sem sinal).
    event.respondWith(
      fetch(req)
        .then((res) => {
          // só guarda em cache se a resposta parecer completa/válida — com
          // sinal ruim (comum na ilha) uma conexão pode cair no meio do
          // download; cachear isso "poison"aria o cache com uma página
          // quebrada que passaria a ser servida offline dali pra frente.
          if (isCompleteHtmlResponse(res)) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((res) => res || caches.match('./index.html')))
    );
    return;
  }

  // cache-first pros assets estáticos próprios (ícones, fotos)
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      }
      return res;
    }))
  );
});

function isCompleteHtmlResponse(res) {
  if (!res.ok) return false;
  const len = res.headers.get('content-length');
  // index.html tem dezenas de KB; qualquer coisa bem menor que isso quase
  // certamente é um download cortado no meio, não a página de verdade.
  if (len && Number(len) < 20000) return false;
  return true;
}
