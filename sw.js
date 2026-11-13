/* FormPilot AI service worker: network-first with a versioned per-file cache, so updates show up on the next online load
   and the app (including the sandbox sites) still opens offline. */
const VERSION = 'formpilot-v3';
const FILES = ['./', './index.html', './styles.css', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './js/llm.js', './js/snapshot.js', './js/guard.js', './js/goal.js', './js/planner.js', './js/llmplanner.js', './js/agent.js', './js/env.js', './js/recorder.js', './js/ics.js', './js/report.js', './js/store.js', './js/webllm.js', './js/app.js',
  './sandbox/common.js', './sandbox/site.css', './sandbox/dental/index.html', './sandbox/dental/site.js', './sandbox/salon/index.html', './sandbox/salon/site.js', './sandbox/permit/index.html', './sandbox/permit/site.js', './sandbox/rsvp/index.html', './sandbox/rsvp/site.js', './sandbox/clinic/index.html', './sandbox/clinic/site.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => Promise.all(FILES.map((f) => c.add(new Request(f, { cache: 'reload' })).catch(() => null)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('formpilot-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin) return;
  const key = url.origin + url.pathname; /* ignore ?r= cache-busters so sandbox reloads work offline */
  e.respondWith(fetch(req).then((res) => { if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(key, copy)); } return res; })
    .catch(() => caches.open(VERSION).then((c) => c.match(key).then((m) => m || (req.mode === 'navigate' ? c.match(new URL('./index.html', self.registration.scope).href) : undefined)).then((m) => m || new Response('Offline and not cached yet.', { status: 503, headers: { 'content-type': 'text/plain' } })))));
});
