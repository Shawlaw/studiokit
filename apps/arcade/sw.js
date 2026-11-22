/*
 * 街机厅 Arcade Service Worker（0.14.0）
 * - 作用域：apps/arcade/；同时缓存 Arcade 页面引用的 shared/site.css 与 site-shell.js。
 * - 安装时缓存中心页外壳；16 款游戏由中心页「预载全部游戏」按钮按需缓存。
 * - 0.9 挑战数据（./challenge/<gameId>.js，13 个）随外壳预缓存，保证离线可玩挑战模式；
 *   缓存 VERSION 与引擎/注册表保持一致。
 * - 导航网络优先（离线回退缓存），静态资源缓存优先；跨域请求一律不拦截。
 * - 0.11.2 更新检测：安装新版本后主动通知所有受控页面（arcade-sw-update-ready），
 *   页面通过 arcade-sw-version 查询当前 SW 版本；不再让已安装 PWA 静默停留在旧版本。
 * - 不使用任何远程资源、分析或第三方 API（AGENTS.md 约束 4）。
 */
const VERSION = '0.15.0';
const CACHE_PREFIX = 'studiokit-arcade-';
/* 缓存键 = `studiokit-arcade-${VERSION}-v1`（0.14.0 → studiokit-arcade-0.14.0-v1），
   全部读写都用 CACHE_NAME 常量，没有第二处硬编码的旧缓存名；
   激活时按 CACHE_PREFIX 前缀清理非当前版本缓存。 */
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}-v1`;
const BASE = new URL('./', self.location.href);
const SCOPE_PATH = BASE.pathname;
const SHARED_PATH = new URL('../../shared/', BASE).pathname;
const INDEX_URL = new URL('./index.html', BASE).href;
/* 页面「检查更新」会 fetch 这个脚本读取线上发布版本（VERSION），
   必须交给网络而不是用当前缓存回答，否则页面永远只能看到已安装版本。 */
const SW_PATH = new URL('./sw.js', BASE).pathname;

const CORE_PATHS = [
  './',
  './index.html',
  './engine.js',
  './arcade.css',
  './manifest.webmanifest',
  './career/bridge.js',
  './career/router.js',
  './career/registry.js',
  './career/discovery.js',
  './career/career-core.js',
  './career/career-db.js',
  './career/entry-router.js',
  './career/backup.js',
  './career/content/registry.json',
  './career/content/clues.json',
  './career/ui/clue-surface.js',
  './career/ui/clue-surface.css',
  './career/ui/mailbox.js',
  './career/ui/settings.js',
  './challenge/shadow-leap.js',
  './challenge/snowbells.js',
  './challenge/star-raid.js',
  './challenge/pendulum-tower.js',
  './challenge/block-drop.js',
  './challenge/road-rush.js',
  './challenge/gold-miner.js',
  './challenge/brick-breaker.js',
  './challenge/gravity-flip.js',
  './challenge/snake-run.js',
  './challenge/mole-whack.js',
  './challenge/memory-flip.js',
  './challenge/merge-2048.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  '../../shared/site.css',
  '../../shared/site-shell.js',
];

const CORE = CORE_PATHS.map((path) => new URL(path, BASE).href);

function allowedUrl(url) {
  if (!url || url.origin !== self.location.origin) return false;
  return url.pathname.startsWith(SCOPE_PATH) || url.pathname.startsWith(SHARED_PATH);
}

function cacheableResponse(response) {
  return response && response.ok && response.type === 'basic';
}

async function cacheCore() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    CORE.map(async (url) => {
      try {
        const existing = await cache.match(url, { ignoreSearch: true });
        if (existing) return;
        const response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
        if (cacheableResponse(response)) await cache.put(url, response.clone());
      } catch (err) {
        /* 单个资源失败不应阻止 Service Worker 安装 */
      }
    })
  );
}

async function precache(urls, port) {
  const cache = await caches.open(CACHE_NAME);
  const list = Array.from(new Set(urls))
    .map((raw) => {
      try {
        return new URL(raw, BASE);
      } catch (err) {
        return null;
      }
    })
    .filter((url) => url && allowedUrl(url))
    .map((url) => url.href);
  let done = 0;
  let failed = 0;
  let bytes = 0;
  for (const url of list) {
    let ok = false;
    try {
      const request = new Request(url, { cache: 'reload', credentials: 'same-origin' });
      const response = await fetch(request);
      if (cacheableResponse(response)) {
        const length = Number(response.headers.get('content-length')) || 0;
        await cache.put(request, response.clone());
        bytes += length;
        ok = true;
      }
    } catch (err) {
      ok = false;
    }
    if (!ok) failed += 1;
    done += 1;
    if (port) {
      port.postMessage({
        type: 'arcade-precache-progress',
        done,
        total: list.length,
        failed,
        bytes,
      });
    }
  }
  if (port) {
    port.postMessage({
      type: 'arcade-precache-done',
      done,
      total: list.length,
      failed,
      bytes,
    });
  }
}

function offlinePage() {
  const html =
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>尚未预载 · 街机厅</title><style>' +
    'html,body{height:100%}body{margin:0;display:grid;place-items:center;background:#0b1020;color:#e8ecff;' +
    'font:16px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px}' +
    'main{max-width:420px;padding:24px;border:1px solid #2b3557;border-radius:16px;background:#151d3a;text-align:center}' +
    'h1{margin:0 0 10px;font-size:20px;color:#ffd23f}p{margin:0 0 16px;color:#a7b0d0}' +
    'a{display:inline-block;padding:10px 18px;border-radius:10px;background:#ffd23f;color:#1a1405;font-weight:700;text-decoration:none}' +
    '</style></head><body><main><h1>这个页面还没有预载</h1>' +
    '<p>当前处于离线状态，这个页面尚未缓存。请联网打开一次，或在街机厅中心页点「预载全部游戏」。</p>' +
    `<p><a href="${BASE.href}">返回街机厅中心页</a></p></main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (cacheableResponse(response)) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const path = new URL(request.url).pathname;
    if (path.indexOf('/games/') === -1) {
      const index = (await cache.match(INDEX_URL, { ignoreSearch: true })) || (await cache.match(BASE.href));
      if (index) return index;
    }
    return offlinePage();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (cacheableResponse(response)) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

/* 通知所有受控页面：有新版本 SW 已激活，供页面提示用户「刷新以更新」。
   必须在 activate 清理旧缓存之前判断「本次激活是否替换了旧版本」：旧版缓存还在
   （前缀相同、名字不同）说明是升级接管；首次安装没有任何旧缓存，不打扰用户。
   旧实现用模块级 firstActivation 标志判断，但每个 SW 实例的该标志都从 true 开始、
   activate 只调用一次，导致广播永远不会发出（0.13.1 及以前「检查更新」拿不到新版本号）。 */
async function isUpdateActivation() {
  try {
    const keys = await caches.keys();
    return keys.some((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
  } catch (err) {
    return false;
  }
}

async function notifyUpdateReady() {
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: false });
    for (const client of clients) {
      client.postMessage({ type: 'arcade-sw-update-ready', version: VERSION });
    }
  } catch (err) {
    /* 扩展页面不可用时不影响 SW 生命周期 */
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await cacheCore();
      await self.skipWaiting();
      // skipWaiting 后新 SW 立即进入 activate；activate 里再通知受控页面。
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 先取「是否替换旧版本」的证据，再删旧缓存（顺序不能反）。
      const replacedOldVersion = await isUpdateActivation();
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
      if (replacedOldVersion) await notifyUpdateReady();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }
  if (!allowedUrl(url)) return;
  /* SW 脚本本身一律交给网络：页面读取 sw.js 是为了知道「线上最新版本」，
     若在这里用 cacheFirst 回答，拿到的会是已安装版本的旧脚本。
     （浏览器自己的 SW 更新检查不会触发 fetch 事件，与此无关。） */
  if (url.pathname === SW_PATH) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'arcade-sw-version') {
    const port = event.ports && event.ports[0];
    if (port) port.postMessage({ type: 'arcade-sw-version', version: VERSION });
    return;
  }
  if (data.type === 'arcade-sw-skip-waiting') {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (data.type !== 'arcade-precache' || !Array.isArray(data.urls)) return;
  const port = event.ports && event.ports[0] ? event.ports[0] : null;
  event.waitUntil(precache(data.urls, port));
});
