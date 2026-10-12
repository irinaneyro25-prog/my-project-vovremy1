// Service worker показывает уведомления, но не планирует фоновые таймеры.
const CACHE = 'vovremya-shell-v1';
const ASSETS = ['./', './index.html', './static/styles.css', './static/app.js',
  './static/icons.js', './static/planner-api.js', './static/planner-core.js', './static/reminders.js',
  './static/fonts/manrope.ttf', './static/fonts/inter.ttf', './manifest.webmanifest',
  './icons/logo.svg', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('vovremya-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Ответы API никогда не кэшируем. Статическая версия может открываться офлайн.
  if (url.pathname.startsWith(new URL('api/', self.registration.scope).pathname)) {
    if (url.pathname.endsWith('/health')) {
      event.respondWith(fetch(event.request).catch(() => new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'content-type': 'application/json' } })));
    }
    return;
  }
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && ASSETS.some(asset => new URL(asset, self.registration.scope).href === url.href)) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? await caches.match(new URL('./', self.registration.scope)) : undefined) || Response.error()));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope);
  if (!url.href.startsWith(self.registration.scope)) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const client = clients.find(c => c.url.startsWith(self.registration.scope));
    if (client) { await client.navigate(url.href); return client.focus(); }
    return self.clients.openWindow(url.href);
  }));
});
