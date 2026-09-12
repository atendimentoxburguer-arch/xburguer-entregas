const CACHE_PREFIX = 'xburguer-entregas-';
const CACHE_NAME = `${CACHE_PREFIX}pwa-v18`;

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
  './deliveries-fit.css',
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
  './report-date-filter.js',
  './closing-history.js',
  './production-hardening.js',
  './database-cloud-v2.js',
  './atomic-delivery-code.js',
  './auth-onboarding.js',
  './performance-mode.js',
  './currency-inputs.js',
  './change-calculator.js',
  './business-rules-v2.js',
  './courier-fee-consistency.js',
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
    const response = await fetch(request, { cache: 'no-store' });
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return (await cache.match(request)) ||
      (await cache.match(request, { ignoreSearch: true })) ||
      (request.mode === 'navigate' ? await cache.match('./index.html') : Response.error());
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true }));
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

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const refresh = fetch(request).then(response => {
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => null);

  event.waitUntil(refresh.then(() => undefined).catch(() => undefined));
  if (cached) return cached;

  const response = await refresh;
  if (response) return response;
  return (await cache.match(request, { ignoreSearch: true })) || Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  if (!isSameOrigin) return;

  const isCode = /\.(?:html?|js|css|webmanifest)$/i.test(url.pathname);
  const isLoader = /\/app\.js$/i.test(url.pathname);

  if (request.mode === 'navigate' || isLoader) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isCode) {
    event.respondWith(staleWhileRevalidate(request, event));
    return;
  }

  event.respondWith(cacheFirst(request));
});
