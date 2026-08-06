/**
 * Service Worker for FishLog PWA
 * オフラインキャッシング + IndexedDB バックアップ
 */

const CACHE_VERSION = `fishlog-${Date.now()}`;
const APP_SHELL_URL = './index.html?v=3.0.1';
const ASSETS_TO_CACHE = [
  APP_SHELL_URL,
  './manifest.json',
  'https://cdn.tailwindcss.com'
];

/**
 * Install Event - キャッシュの準備
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      console.log('[SW] Caching app shell');
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err);
        // 部分的な失敗を許容
      });
    }).then(() => {
      console.log('[SW] Install complete');
      return self.skipWaiting(); // 即座にアクティベート
    })
  );
});

/**
 * Activate Event - 古いキャッシュの削除
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_VERSION) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[SW] Claiming clients');
      return self.clients.claim(); // 全クライアントを制御下に
    })
  );
});

/**
 * Fetch Event - キャッシュファースト戦略
 * ネットワーク優先、オフラインならキャッシュ使用
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // HTML は常に最新を優先（PWA での旧版固定を防止）
  if (request.method === 'GET' && (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html'))) {
    event.respondWith(
      fetch(APP_SHELL_URL, { cache: 'no-store' })
        .then((response) => {
          if (response && response.status === 200 && response.type !== 'error') {
            const responseToCache = response.clone();
            caches.open(CACHE_VERSION).then((cache) => {
              cache.put(APP_SHELL_URL, responseToCache);
            });
          }
          return response;
        })
        .catch(() => caches.match(APP_SHELL_URL).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }
  
  // GAS への POST リクエストはネットワーク優先
  if (request.method === 'POST' && request.url.includes('script.google.com')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          console.log('[SW] POST request successful:', request.url);
          return response;
        })
        .catch(err => {
          console.warn('[SW] POST request failed, offline:', request.url);
          return new Response(
            JSON.stringify({ ok: false, error: 'Offline - POST not available' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }

  // GET リクエストはキャッシュファースト
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        console.log('[SW] Serving from cache:', request.url);
        return cachedResponse;
      }

      return fetch(request)
        .then((response) => {
          // ネットワークレスポンスをキャッシュに保存
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }

          const responseToCache = response.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(request, responseToCache);
            console.log('[SW] Cached:', request.url);
          });

          return response;
        })
        .catch((err) => {
          console.warn('[SW] Fetch failed, returning cached:', request.url);
          // フォールバック：キャッシュがなければオフラインページ
          return caches.match(APP_SHELL_URL).then((cached) => cached || caches.match('./index.html'));
        });
    })
  );
});

/**
 * Message Handler - クライアントからのメッセージ処理
 * クライアント側からキャッシュクリアなどを指示可能
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    console.log('[SW] Clearing cache...');
    caches.delete(CACHE_VERSION).then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }
});
