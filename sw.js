const CACHE_NAME = 'scoretracker-v20';
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
            // cache:'reload' bypasses the browser HTTP cache so a new install never
            // stores stale copies of the files it is meant to replace.
            return cache.addAll(CORE_ASSETS.map((u) => new Request(u, { cache: 'reload' }))).then(() => {
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
        // Network-first: online always gets the latest files (no mixed-version
        // html/js); the cache is only the offline fallback.
        fetch(event.request, { cache: 'no-cache' }).then((response) => {
            if (response && response.ok) {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            }
            return response;
        }).catch(() =>
            caches.match(event.request).then((cached) => {
                if (cached) return cached;
                if (event.request.mode === 'navigate') return caches.match('index.html');
                return Response.error();
            })
        )
    );
});
