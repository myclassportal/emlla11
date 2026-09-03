const CACHE_NAME = 'emla-lesson-11-v1';

const SOUND_ASSETS = [
  'intro_sec_1', 'intro_sec_2', 'intro_sec_3',
  'word_1', 'word_2', 'word_3', 'word_4', 'word_5', 'word_6',
  'word_7', 'word_8', 'word_9', 'word_10', 'word_11', 'word_12',
  'word_13', 'word_14', 'word_15', 'word_16', 'word_17', 'word_18',
  'word_19', 'word_20', 'word_21', 'word_22', 'word_23', 'word_24',
  'word_25', 'word_26', 'word_27', 'word_28', 'word_29', 'word_30',
  'word_31'
].map(name => `./sounds/${name}.mp3`);

const ASSETS = [
  './',
  './index.html',
  './game-db.js',
  './supabase.js',
  './game-audio.js',
  './Vazirmatn-Regular.woff2',
  './Vazirmatn-Bold.woff2',
  ...SOUND_ASSETS
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        ASSETS.map((url) => {
          return fetch(url).then((response) => {
            if (response.ok) {
              return cache.put(url, response);
            }
          }).catch((err) => {
            console.warn('Failed to cache game asset:', url, err);
          });
        })
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') {
    return;
  }

  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, responseToCache);
        });
        return networkResponse;
      });
    }).catch(() => {
      return caches.match('./index.html');
    })
  );
});