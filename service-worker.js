const CACHE_PREFIX = 'xburguer-entregas-';
const CACHE_NAME = `${CACHE_PREFIX}pwa-v40`;

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
  './core-safety.js',
  './supabase-config.js',
  './cloud-auth-guard.js',
  './database-prep.js',
  './performance-mode.js',
  './confirm-ui.js',
  './system-production-v2.js',
  './system-update.js',
  './closing-summary.js',
  './system-audit.js',
  './system-integrity-v3.js',
  './metrics-consistency-v4.js',
  './closing-continuity.js',
  './final-integrity-guards.js',
  './past-day-guard.js',
  './simple-payment-flow.js',
  './delivery-edit-plus.js',
  './payment-confirmation-pro.js',
  './production-hardening.js',
  './database-cloud-v2.js',
  './courier-fee-consistency.js',
  './atomic-delivery-code.js',
  './delivery-recovery.js',
  './auth-onboarding.js',
  './currency-inputs.js',
  './change-calculator.js',
  './business-rules-v2.js',
  './delivery-date-scope.js',
  './ticket-average.js',
  './operations-pro.js',
  './report-date-filter.js',
  './closing-history.js',
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
    const response = await fetch(request, { cache: 'no-store' });
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
  if (url.origin !== self.location.origin) return;

  const isCode = /\.(?:html?|js|css|webmanifest)$/i.test(url.pathname);

  // Código e estilos sempre tentam a rede primeiro. Assim dois computadores
  // conectados nunca ficam presos em versões diferentes do painel.
  if (request.mode === 'navigate' || isCode) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
