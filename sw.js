const CACHE_NAME = 'scoretracker-v8';
const CORE_ASSETS = [
    'index.html',
    'styles.css',
    'app.js',
    'manifest.json',
    'icon-192.png',
    'icon-512.png'
];
const OPTIONAL_ASSETS = [
    'https://fonts.googleapis.com/css2?family=Inter:wght@900&display=swap'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(CORE_ASSETS).then(() => {
                // Cross-origin assets are best-effort: don't let a font-fetch
                // failure (offline, flaky network) sink caching of core assets.
                return Promise.all(
                    OPTIONAL_ASSETS.map((url) =>
                        cache.add(url).catch((err) => console.warn('[SW] optional asset failed:', url, err))
                    )
                );
            });
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(
                names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;

            return fetch(event.request).then((response) => {
                if (response && response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                }
                return response;
            }).catch(() => {
                if (event.request.mode === 'navigate') {
                    return caches.match('index.html');
                }
                return Response.error();
            });
        })
    );
});
