const CACHE_PREFIX = 'xburguer-entregas-';
const CACHE_NAME = `${CACHE_PREFIX}pwa-v9`;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './styles-core.css',
  './readability.css',
  './visual-polish.css',
  './panel-gradients.css',
  './hero-compact.css',
  './system-update.css',
  './ticket-average.css',
  './app.js',
  './app-core.js',
  './supabase-config.js',
  './cloud-auth-guard.js',
  './database-prep.js',
  './confirm-ui.js',
  './system-production-v2.js',
  './system-update.js',
  './closing-summary.js',
  './ticket-average.js',
  './system-audit.js',
  './simple-payment-flow.js',
  './delivery-edit-plus.js',
  './payment-confirmation-pro.js',
  './operations-pro.js',
  './closing-history.js',
  './production-hardening.js',
  './database-cloud-v2.js',
  './atomic-delivery-code.js',
  './auth-onboarding.js',
  './performance-mode.js',
  './currency-inputs.js',
  './pwa-app.js',
  './manifest.webmanifest',
  './assets/app-icon-192.png',
  './assets/app-icon-512.png',
  './assets/xburguer-logo.jpg'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(APP_SHELL.map(url => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return (await cache.match(request, { ignoreSearch: true })) ||
      (request.mode === 'navigate' ? await cache.match('./index.html') : Response.error());
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Nunca intercepta Supabase, autenticação, APIs ou CDNs externas.
  // Assim respostas do banco não ficam presas no cache do aplicativo.
  if (!isSameOrigin) return;

  const isCode = /\.(?:html?|js|css|webmanifest)$/i.test(url.pathname);

  if (request.mode === 'navigate' || isCode) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
