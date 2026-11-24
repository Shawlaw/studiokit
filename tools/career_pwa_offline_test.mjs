#!/usr/bin/env node
/**
 * Arcade Life 0.15 PWA 缓存与 GH/CF 兼容路由门禁（D15-13，离线可读信箱）
 *
 * 用真实 Chrome + Service Worker 覆盖：
 * - P01/P02 中心页注册 SW 并等待 ready；线上 sw.js 的 VERSION / CACHE_PREFIX 推导缓存键
 *   `studiokit-arcade-0.18.1-v3`，`caches.keys()` 含该键，SW 版本握手一致
 * - P03 sw.js `CORE_PATHS` 全量在核心缓存中，且 career 运行时/内容/UI 14 项逐个存在
 *   （按 registration.scope 相对 URL 断言）
 * - P04 中心页基线：16 张游戏卡 + 版本 0.18.1（career 不破坏中心页）
 * - P05/P06 在线游戏页（`?careerTest=1#test`）发现前无剧透 DOM，真实 `observe()`×2 +
 *   `finish()` 产出一条线索（CL-memory-flip / reason=event），并直接读 IndexedDB
 *   断言 discovery 行与 state 快照都已落库
 * - P07~P11 CDP `Network.emulateNetworkConditions({offline:true})` 置离线后 reload：
 *   导航由 SW 缓存兜底（离线期间服务器零文档请求）、engine 版本 0.18.1、
 *   `ArcadeCareer.available===true`（career 资源来自缓存）、`openMailbox()` 可打开并显示
 *   已发现线索、无未捕获异常/console error（区分并忽略离线网络噪声）、离线中心页 16 卡正常
 * - P12 恢复在线；P13 Cloudflare 兼容无后缀 URL（`games/memory-flip`）gameId / 生涯事件正常
 * - P14 GitHub Pages 子路径（`/studiokit/apps/arcade/...`）SW scope 与 career 资源零 404
 * - P15 缓存内容审计：全部条目同源、无跨域/CDN、HTML 无外链资源、JS 无外部 fetch、
 *   内容文件之外不含 clueId / 信件地址（不提前泄漏剧透）
 * - P16 模拟 SW 升级/重装（伪造旧版本缓存 → 注销 → 重装）不会清掉 career IndexedDB，
 *   额外 caches 读写也不影响 DB；P17 收尾 deleteDatabase + 注销 SW + 清空本测试缓存
 *
 * 零 npm 依赖：复用 tools/lib/arcade_cdp.mjs。端口显式 `CAREER_PWA_PORT=8839` /
 * `CAREER_PWA_CDP_PORT=9439`（`arcade_pwa_update_test` 用 8797/9367，互不冲突）。
 * 运行：node tools/career_pwa_offline_test.mjs
 * 退出码：0 全部通过；1 有 FAIL；2 环境/装配失败（服务器 / Chrome / CDP）。
 */
import path from 'node:path';
import { CDP, REPO_ROOT, createRecorder, envPort, launchChrome, openPage, sleep, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const ARTIFACTS = path.join(REPO_ROOT, 'test-artifacts');
const DB_NAME = 'studiokit:arcade:career';
const SW_VERSION = '0.18.1';
const CACHE_PREFIX = 'studiokit-arcade-';
const CACHE_KEY = `${CACHE_PREFIX}${SW_VERSION}-v3`;
const OLD_CACHE_KEY = 'studiokit-arcade-0.14.0-v1';
/* 任务卡点名的 career 运行时 / 内容 / UI 资源（sw.js CORE_PATHS 中的 14 项）。 */
const CAREER_CORE_PATHS = [
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
];
const CLUE_ID = 'CL-memory-flip';
const CLUE_TITLE = '牌背纸条';
const CLUE_ADDRESS = '折光港旧码头C段';
const GAME_URL_PATH = '/apps/arcade/games/memory-flip.html?careerTest=1#test';
const HUB_URL_PATH = '/apps/arcade/';
const NO_SUFFIX_GAME_PATH = '/apps/arcade/games/memory-flip';
const GH_HUB_PATH = '/studiokit/apps/arcade/';
const GH_GAME_PATH = '/studiokit/apps/arcade/games/memory-flip.html?careerTest=1#test';

/* 缓存条目允许的路径前缀：根 scope（CF）/ GH 子路径 scope / 共享运行时（两种前缀）。 */
const ALLOWED_CACHE_PREFIXES = ['/apps/arcade/', '/shared/', '/studiokit/apps/arcade/', '/studiokit/shared/'];
/* 离线期间浏览器对失败请求的正常日志：只当噪声，不当页面缺陷。 */
const OFFLINE_NOISE_RE = /(net::ERR_(?:INTERNET_DISCONNECTED|CONNECTION_REFUSED|CONNECTION_CLOSED|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE|TIMED_OUT)|ERR_INTERNET_DISCONNECTED|Failed to fetch|Load failed)/;

const { record, assert, summary } = createRecorder();

function arg(name, fallback = null) {
  const prefix = '--' + name + '=';
  const hit = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function positivePort(raw, label) {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label} 必须是 1-65535 的整数端口，当前值 ${JSON.stringify(raw)}`);
  return port;
}

const SERVER_PORT = arg('port') === null ? envPort('CAREER_PWA_PORT', 8839) : positivePort(arg('port'), '--port');
const CDP_PORT = arg('cdp-port') === null ? envPort('CAREER_PWA_CDP_PORT', 9439) : positivePort(arg('cdp-port'), '--cdp-port');
if (SERVER_PORT === CDP_PORT) throw new Error(`CAREER_PWA_PORT 与 CAREER_PWA_CDP_PORT 不能相同（${SERVER_PORT}）`);
const BASE = `http://127.0.0.1:${SERVER_PORT}`;
const ARCADE_BASE = BASE + '/apps/arcade/';
const HUB_URL = BASE + HUB_URL_PATH;
const GAME_URL = BASE + GAME_URL_PATH;
const NO_SUFFIX_GAME_URL = BASE + NO_SUFFIX_GAME_PATH;
const GH_HUB_URL = BASE + GH_HUB_PATH;
const GH_GAME_URL = BASE + GH_GAME_PATH;

function detail(value) {
  if (value === undefined || value === null) return '';
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 320 ? text.slice(0, 320) + '…' : text;
  } catch (err) {
    return String(value);
  }
}

async function check(name, fn) {
  try {
    const info = await fn();
    record(name, true, detail(info));
    return true;
  } catch (err) {
    record(name, false, err && err.message ? err.message : String(err));
    return false;
  }
}

/**
 * 真实刷新当前页（Page.reload）。
 * 不能用 Page.navigate 到「完全相同的 URL + 相同 hash」——那是同文档片段导航，不会重新加载页面，
 * 无法证明「离线 reload 由 Service Worker 缓存兜底」。这里用 nonce 判定文档确实被替换。
 */
async function reloadCurrentPage(cdp, label) {
  const nonce = 'd1513-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  await cdp.evaluate(`window.__d1513ReloadNonce = ${JSON.stringify(nonce)}; true`);
  cdp.errors = [];
  await cdp.send('Page.reload', { ignoreCache: false });
  const end = Date.now() + 30000;
  let last = null;
  while (Date.now() < end) {
    await sleep(100);
    try {
      const state = await cdp.evaluate(`(() => ({ ready: document.readyState, fresh: window.__d1513ReloadNonce !== ${JSON.stringify(nonce)} }))()`);
      last = state;
      if (state && state.ready === 'complete' && state.fresh === true) return true;
    } catch (err) {
      /* 导航过程中执行上下文会被销毁：继续轮询 */
    }
  }
  throw new Error('刷新页面超时（' + label + '）: ' + detail(last));
}

/**
 * 连接同一个 SW 的 DevTools target（type=service_worker）。
 * 为什么必要：页面 target 上的 `Network.emulateNetworkConditions({offline:true})` 只拦页面自己的
 * 网络请求，SW 内部的 `fetch()` 走 SW target 的网络栈仍能联网（实测离线 reload 时服务器仍收到
 * 文档请求）。要让「离线导航回退缓存」成为真实证据，必须在 SW target 上也开 offline 模拟。
 * @returns {Promise<CDP|null>}
 */
async function attachServiceWorkerSession(cdpPort, swUrl) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let targets = [];
    try {
      targets = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((res) => res.json());
    } catch (err) {
      targets = [];
    }
    const match = (Array.isArray(targets) ? targets : []).filter((target) => target.type === 'service_worker' && target.url === swUrl)[0];
    if (match && match.webSocketDebuggerUrl) {
      const session = new CDP(match.webSocketDebuggerUrl, { artifactsDir: ARTIFACTS });
      try {
        await session.ready();
        await session.send('Network.enable');
        return session;
      } catch (err) {
        session.close();
        return null;
      }
    }
    await sleep(300);
  }
  return null;
}

function isOfflineNoise(entry) {
  /* 未捕获异常永远是缺陷；只有「网络层面的离线失败日志」算噪声。 */
  if (/^exception:/.test(entry)) return false;
  return OFFLINE_NOISE_RE.test(entry);
}

function splitErrors(errors) {
  const noise = [];
  const real = [];
  errors.forEach((entry) => (isOfflineNoise(entry) ? noise : real).push(entry));
  return { noise, real };
}

function parseSwCorePaths(source) {
  const match = source.match(/const\s+CORE_PATHS\s*=\s*\[([\s\S]*?)\];/);
  if (!match) return [];
  /* 兼容单/双引号；只看数组字面量里的字符串字面量，不执行脚本。 */
  return Array.from(match[1].matchAll(/'([^']+)'|"([^"]+)"/g)).map((item) => item[1] || item[2]);
}

function absoluteFromScope(scope, relative) {
  return new URL(relative, scope).href;
}

/* ---------------------------------------------------------------- 页面片段 */

const SW_STATE_SRC = String.raw`(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  let ready = null;
  try { ready = await navigator.serviceWorker.ready; } catch (err) { ready = null; }
  return {
    hasRegistration: !!reg,
    scope: reg ? reg.scope : null,
    activeScript: reg && reg.active ? reg.active.scriptURL : null,
    controller: !!navigator.serviceWorker.controller,
    controllerScript: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null,
    readyScope: ready ? ready.scope : null,
    arcadeVersion: window.Arcade ? Arcade.version : null,
    hallCards: document.querySelectorAll('.hall-card').length
  };
})()`;

const CACHE_PROBE_SRC = String.raw`(async () => {
  const keys = await caches.keys();
  const expectedKey = ${JSON.stringify(CACHE_KEY)};
  const key = keys.includes(expectedKey) ? expectedKey : null;
  const reg = await navigator.serviceWorker.getRegistration();
  const scope = reg ? reg.scope : null;
  if (!key) return { keys, key: null, scope, urls: [] };
  const cache = await caches.open(key);
  const requests = await cache.keys();
  return { keys, key, scope, urls: requests.map((request) => request.url) };
})()`;

const HALL_SRC = String.raw`(() => ({
  cards: document.querySelectorAll('.hall-card').length,
  versionText: (document.querySelector('[data-hall-version]') || {}).textContent || '',
  arcadeVersion: window.Arcade ? Arcade.version : null,
  offlineFallback: (document.body.innerText || '').indexOf('这个页面还没有预载') !== -1,
  careerPanel: !!document.querySelector('[data-career-panel]'),
  controller: !!navigator.serviceWorker.controller
}))()`;

const PRE_DISCOVERY_SRC = String.raw`(() => {
  const text = document.body.innerText || '';
  const C = window.ArcadeCareer;
  return {
    cluePanel: !!document.querySelector('[data-career-panel]') || !!document.querySelector('[data-career-clue]'),
    hasClueTitle: text.indexOf('牌背纸条') !== -1,
    hasClueAddress: text.indexOf('折光港旧码头C段') !== -1,
    gameId: C ? C.gameId : null,
    available: C ? C.available : null,
    discovered: C ? Object.keys(C.state().clues || {}).length : -1,
    clueCount: C ? C.info().clueCount : -1,
    cluesEnabled: C ? C.info().cluesEnabled : null,
    base: C ? C.info().base : null
  };
})()`;

const DISCOVERY_SRC = String.raw`(async () => {
  const C = window.ArcadeCareer;
  await C.ready;
  const first = C.observe('pair.match', { symbol: 'A', level: 1, moves: 3 });
  const second = C.observe('pair.match', { symbol: 'B', level: 1, moves: 6 });
  const beforeFinish = C.info().eventCount;
  const settled = await C.finish({ mode: 'classic', outcome: 'won', stats: { level: 1, moves: 6, score: 120 } });
  const state = C.state();
  const info = C.info();
  return {
    accepted: [first, second],
    eventCountBeforeFinish: beforeFinish,
    settled: settled ? { clueId: settled.clueId, reason: settled.reason, persisted: settled.persisted, stateHasClue: !!(settled.state && settled.state.clues && settled.state.clues['CL-memory-flip']) } : null,
    stateClues: Object.keys(state.clues || {}),
    lastClueId: state.lastClueId,
    stage: state.stage,
    dbWriteMethod: info.dbWriteMethod,
    dbUsable: info.dbUsable,
    stateLoadedFromDb: info.stateLoadedFromDb,
    eventCount: info.eventCount,
    finishReason: info.finishCount
  };
})()`;

/* 直接读 IndexedDB（不经 bridge），用 JSON 字符串返回便于逐字节比较。 */
const READ_DB_SRC = String.raw`(async () => {
  const DB = 'studiokit:arcade:career';
  const openDb = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb-open-error'));
    req.onblocked = () => reject(new Error('idb-open-blocked'));
  });
  const db = await openDb();
  const names = Array.from(db.objectStoreNames).slice().sort();
  const readAll = (name) => new Promise((resolve) => {
    if (names.indexOf(name) < 0) { resolve(null); return; }
    try {
      const req = db.transaction([name], 'readonly').objectStore(name).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve(null);
    } catch (err) { resolve(null); }
  });
  const state = await readAll('state');
  const discovery = await readAll('discovery');
  const runs = await readAll('runs');
  db.close();
  let databases = null;
  try { databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : null; } catch (err) { databases = null; }
  return JSON.stringify({ names: names, state: state, discovery: discovery, runCount: Array.isArray(runs) ? runs.length : null, databases: databases });
})()`;

const OFFLINE_PAGE_SRC = String.raw`(() => {
  const C = window.ArcadeCareer;
  const info = C ? C.info() : null;
  const nav = performance.getEntriesByType('navigation')[0] || null;
  return {
    readyState: document.readyState,
    title: document.title,
    href: location.href,
    engineVersion: window.Arcade ? Arcade.version : null,
    offlineFallback: (document.body.innerText || '').indexOf('这个页面还没有预载') !== -1,
    controller: !!navigator.serviceWorker.controller,
    careerAvailable: C ? C.available === true : false,
    careerGameId: C ? C.gameId : null,
    careerInfo: info,
    transferSize: nav ? nav.transferSize : null,
    workerStart: nav ? nav.workerStart : null
  };
})()`;

const MAILBOX_SRC = String.raw`(async () => {
  const C = window.ArcadeCareer;
  const opened = await C.openMailbox();
  await new Promise((resolve) => setTimeout(resolve, 800));
  const panel = document.querySelector('[data-career-panel="mailbox"]');
  const item = panel ? panel.querySelector('[data-clue-id="CL-memory-flip"]') : null;
  const letterTitle = panel ? panel.querySelector('.ac-career-letter__title') : null;
  const letterAddress = panel ? panel.querySelector('.ac-career-letter__address') : null;
  const letterSender = panel ? panel.querySelector('.ac-career-letter__sender') : null;
  return {
    opened: opened,
    hasPanel: !!panel,
    panelText: panel ? panel.textContent.slice(0, 160) : null,
    itemIds: panel ? Array.from(panel.querySelectorAll('[data-clue-id]')).map((node) => node.getAttribute('data-clue-id')) : [],
    itemText: item ? item.textContent : null,
    letterTitle: letterTitle ? letterTitle.textContent : null,
    letterAddress: letterAddress ? letterAddress.textContent : null,
    letterSender: letterSender ? letterSender.textContent : null,
    stateLoadedFromDb: C.info().stateLoadedFromDb,
    stateClues: Object.keys(C.state().clues || {}),
    dbUsable: C.info().dbUsable
  };
})()`;

const NO_SUFFIX_SRC = String.raw`(async () => {
  const C = window.ArcadeCareer;
  await C.ready;
  const detected = C.router && typeof C.router.detectGameId === 'function' ? C.router.detectGameId(location) : null;
  const info = C.info();
  const first = C.observe('pair.match', { symbol: 'C', level: 1, moves: 2 });
  const second = C.observe('pair.match', { symbol: 'D', level: 1, moves: 5 });
  const eventCountBefore = C.info().eventCount;
  const settled = await C.finish({ mode: 'classic', outcome: 'quit', stats: { level: 1, moves: 5, score: 40 } });
  const state = C.state();
  const afterInfo = C.info();
  return {
    href: location.href,
    detected: detected,
    gameId: C.gameId,
    available: C.available,
    base: info.base,
    careerDir: info.careerDir,
    matches: [first, second],
    eventCountBefore: eventCountBefore,
    settledHasClue: !!settled,
    eventCountAfter: afterInfo.eventCount,
    runs: (state.runs || {})['memory-flip'] || null,
    loadErrors: afterInfo.loadErrors
  };
})()`;

const GH_PAGE_SRC = String.raw`(async () => {
  const C = window.ArcadeCareer;
  await C.ready;
  const info = C.info();
  const failures = Object.keys(info.loadedScripts).filter((key) => !info.loadedScripts[key].ok);
  return {
    href: location.href,
    gameId: C.gameId,
    available: C.available,
    base: info.base,
    careerDir: info.careerDir,
    loadErrors: info.loadErrors,
    failedScripts: failures,
    clueCount: info.clueCount,
    cluesEnabled: info.cluesEnabled,
    contentUrls: [C.router ? C.router.contentUrl('registry.json', { location: location, currentScript: { src: location.origin + '/studiokit/apps/arcade/career/bridge.js' } }) : null]
  };
})()`;

const CACHE_AUDIT_SRC = String.raw`(async () => {
  const clueRe = /CL-[a-z0-9-]+/gi;
  const out = {
    keys: [],
    entries: [],
    external: [],
    htmlExternal: [],
    jsExternal: [],
    clueOutsideContent: [],
    spoilerOutsideContent: [],
    missingBodies: []
  };
  out.keys = await caches.keys();
  for (const key of out.keys) {
    const cache = await caches.open(key);
    const requests = await cache.keys();
    for (const request of requests) {
      const url = new URL(request.url);
      out.entries.push({ cache: key, url: request.url, origin: url.origin, path: url.pathname });
      if (url.origin !== location.origin) out.external.push(request.url);
      const response = await cache.match(request);
      if (!response) { out.missingBodies.push(request.url); continue; }
      const type = response.headers.get('content-type') || '';
      const isContent = url.pathname.indexOf('/career/content/') !== -1;
      if (type.indexOf('text/html') !== -1) {
        const text = await response.clone().text();
        const externalRefs = text.match(/(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\/[^"']*/gi) || [];
        if (externalRefs.length) out.htmlExternal.push({ url: request.url, refs: externalRefs.slice(0, 4) });
        if (!isContent) {
          const clues = text.match(clueRe) || [];
          if (clues.length) out.clueOutsideContent.push({ url: request.url, clues: clues.slice(0, 4) });
          if (text.indexOf('折光港旧码头C段') !== -1) out.spoilerOutsideContent.push(request.url);
        }
      } else if (type.indexOf('javascript') !== -1) {
        const text = await response.clone().text();
        const externalRefs = text.match(/(?:fetch|import)\s*\(\s*["'](?:https?:)?\/\/[^"']*/gi) || [];
        if (externalRefs.length) out.jsExternal.push({ url: request.url, refs: externalRefs.slice(0, 4) });
        const clues = text.match(clueRe) || [];
        if (clues.length) out.clueOutsideContent.push({ url: request.url, clues: clues.slice(0, 4) });
        if (text.indexOf('折光港旧码头C段') !== -1) out.spoilerOutsideContent.push(request.url);
      } else if (type.indexOf('json') !== -1) {
        const text = await response.clone().text();
        if (!isContent) {
          const clues = text.match(clueRe) || [];
          if (clues.length) out.clueOutsideContent.push({ url: request.url, clues: clues.slice(0, 4) });
          if (text.indexOf('折光港旧码头C段') !== -1) out.spoilerOutsideContent.push(request.url);
        }
      }
    }
  }
  return out;
})()`;

const DELETE_DB_SRC = String.raw`new Promise((resolve) => {
  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    resolve(value);
  };
  try {
    const req = indexedDB.deleteDatabase('studiokit:arcade:career');
    req.onsuccess = () => finish('ok');
    req.onerror = () => finish('error');
    req.onblocked = () => finish('blocked');
    setTimeout(() => finish('timeout'), 5000);
  } catch (err) {
    finish('threw:' + (err && err.message ? err.message : 'unknown'));
  }
})`;

const FAKE_OLD_CACHE_SRC = String.raw`(async () => {
  const cache = await caches.open('studiokit-arcade-0.14.0-v1');
  await cache.put(new Request(location.origin + '/apps/arcade/__d1513_old_cache_probe__.txt'), new Response('old-version-probe'));
  return caches.keys();
})()`;

const CACHE_CHURN_SRC = String.raw`(async () => {
  const cache = await caches.open('studiokit-d1513-churn');
  await cache.put(new Request(location.origin + '/apps/arcade/__d1513_churn__.txt'), new Response('churn'));
  const wrote = await cache.match(location.origin + '/apps/arcade/__d1513_churn__.txt');
  const deleted = await caches.delete('studiokit-d1513-churn');
  return { wrote: !!wrote, deleted: deleted, keys: await caches.keys() };
})()`;

const UNREGISTER_ALL_SRC = String.raw`navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations.map((registration) => registration.unregister()))).then((results) => results.length)`;

const CLEAR_CACHES_SRC = String.raw`(async () => {
  const keys = await caches.keys();
  for (const key of keys) {
    try { await caches.delete(key); } catch (err) { /* ignore */ }
  }
  return caches.keys();
})()`;

/* ---------------------------------------------------------------- 主流程 */

async function main() {
  let server = null;
  let launched = null;
  let cdp = null;
  const requestLog = [];
  const responseLog = [];
  const loadingFailures = [];

  async function cleanupBrowser() {
    if (!cdp) return;
    try {
      await cdp.evaluate(UNREGISTER_ALL_SRC);
    } catch (err) {
      /* 页面可能已不可用：尽力而为 */
    }
    try {
      await cdp.evaluate(CLEAR_CACHES_SRC);
    } catch (err) {
      /* ignore */
    }
    try {
      cdp.close();
    } catch (err) {
      /* ignore */
    }
    cdp = null;
  }

  /* ---------- 装配（失败 = 退出码 2） ---------- */
  try {
    server = await listenServer();
    launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'arcade-career-pwa-' });
    cdp = await openPage({ port: CDP_PORT, width: 390, height: 844, deviceScaleFactor: 2, mobile: true, artifactsDir: ARTIFACTS });
    await cdp.send('Network.enable');
    cdp.on('Network.responseReceived', (params) => {
      responseLog.push({ url: params.response.url, status: params.response.status, mime: params.response.mimeType });
    });
    cdp.on('Network.loadingFailed', (params) => {
      loadingFailures.push(params.errorText + (params.blockedReason ? ' [' + params.blockedReason + ']' : ''));
    });
  } catch (err) {
    console.error('CAREER PWA OFFLINE TEST SETUP FAILED:', err && err.stack ? err.stack : err);
    process.exitCode = 2;
    if (server) server.close();
    await stopChrome(launched || {});
    return;
  }

  let swSource = '';
  let swCorePaths = [];
  let startDeleteStatus = 'not-run';
  let swSession = null;
  let offlineTransport = '';

  /* 重新挂上服务器请求计数监听（离线兜底会短暂停掉/恢复监听）。 */
  function attachRequestLog(target) {
    if (!target) return;
    target.on('request', (req) => requestLog.push({ at: Date.now(), url: req.url || '' }));
  }

  async function listenServer() {
    const next = await startServer({ root: REPO_ROOT, port: SERVER_PORT });
    attachRequestLog(next);
    return next;
  }

  try {
    /* ============================================================ 在线：注册与核心缓存 */
    await cdp.navigate(HUB_URL);
    await cdp.waitFor('!!(window.Arcade)', { timeout: 25000 });
    await cdp.waitFor('document.querySelectorAll(".hall-card").length === 16', { timeout: 20000 });
    await cdp.waitFor('!!(navigator.serviceWorker && navigator.serviceWorker.controller)', { timeout: 30000 });
    await cdp.waitFor('navigator.serviceWorker.getRegistration().then((reg) => !!(reg && reg.active))', { timeout: 30000 });

    /* 测试隔离：开始先删生涯库（临时 profile 里通常为空，但保持可复跑）。 */
    startDeleteStatus = await cdp.evaluate(DELETE_DB_SRC);

    await check('P01 中心页注册 SW 并等待 ready（scope=/apps/arcade/，页面已被控制）', async () => {
      const state = await cdp.evaluate(SW_STATE_SRC);
      assert(state.hasRegistration === true, '中心页没有 SW 注册: ' + detail(state));
      assert(state.activeScript === ARCADE_BASE + 'sw.js', 'SW 脚本 URL 应为 ' + ARCADE_BASE + 'sw.js，实际 ' + state.activeScript);
      assert(state.scope === ARCADE_BASE, 'SW scope 应为 ' + ARCADE_BASE + '，实际 ' + JSON.stringify(state.scope));
      assert(state.readyScope === ARCADE_BASE, 'navigator.serviceWorker.ready 的 scope 应为 ' + ARCADE_BASE + '，实际 ' + JSON.stringify(state.readyScope));
      assert(state.controller === true && state.controllerScript === ARCADE_BASE + 'sw.js',
        '页面未被 SW 控制（controller=' + state.controller + '，script=' + state.controllerScript + '）');
      assert(state.arcadeVersion === '0.18.1', '中心页 Arcade.version 应为 0.18.1，实际 ' + JSON.stringify(state.arcadeVersion));
      assert(startDeleteStatus === 'ok', '测试开始时 deleteDatabase(' + DB_NAME + ') 未成功: ' + startDeleteStatus);
      return { scope: state.scope, controllerScript: state.controllerScript, startDelete: startDeleteStatus };
    });

    await check(`P02 sw.js VERSION=${SW_VERSION} 且缓存键 ${CACHE_KEY} 存在 + SW 版本握手`, async () => {
      const fetched = await cdp.evaluate(`fetch('${BASE}/apps/arcade/sw.js', { cache: 'no-store', credentials: 'same-origin' }).then((res) => res.ok ? res.text() : 'http-' + res.status).catch((err) => 'fetch-error:' + err.message)`);
      assert(typeof fetched === 'string' && fetched.indexOf('const VERSION') !== -1, '读取线上 sw.js 失败: ' + detail(fetched));
      swSource = fetched;
      const versionMatch = swSource.match(/const\s+VERSION\s*=\s*['"]([^'"]+)['"]/);
      const prefixMatch = swSource.match(/const\s+CACHE_PREFIX\s*=\s*['"]([^'"]+)['"]/);
      assert(versionMatch && versionMatch[1] === SW_VERSION, 'sw.js VERSION 应为 ' + SW_VERSION + '，实际 ' + detail(versionMatch && versionMatch[1]));
      assert(prefixMatch && prefixMatch[1] === CACHE_PREFIX, 'sw.js CACHE_PREFIX 应为 ' + CACHE_PREFIX + '，实际 ' + detail(prefixMatch && prefixMatch[1]));
      swCorePaths = parseSwCorePaths(swSource);
      assert(swCorePaths.length >= 38, 'sw.js CORE_PATHS 解析异常（应为 38 项）: ' + swCorePaths.length);
      const pageState = await cdp.evaluate(`(async () => ({
        keys: await caches.keys(),
        swVersion: await (window.Arcade && Arcade.Offline ? Arcade.Offline.swVersion() : Promise.resolve(null))
      }))()`);
      assert(pageState.keys.indexOf(CACHE_KEY) !== -1, 'caches.keys() 缺少 ' + CACHE_KEY + '：' + detail(pageState.keys));
      assert(pageState.swVersion === SW_VERSION, 'SW 版本握手应为 ' + SW_VERSION + '，实际 ' + detail(pageState.swVersion));
      return { cacheKey: CACHE_KEY, keys: pageState.keys, swVersion: pageState.swVersion, corePaths: swCorePaths.length };
    });

    await check('P03 career 运行时/内容/UI 14 项与 sw.js CORE_PATHS 全量都在核心缓存（scope 相对 URL）', async () => {
      const probe = await cdp.evaluate(CACHE_PROBE_SRC);
      assert(probe.key === CACHE_KEY, '核心缓存键不对: ' + detail(probe.key));
      assert(probe.scope === ARCADE_BASE, 'SW scope 应为 ' + ARCADE_BASE + '，实际 ' + detail(probe.scope));
      const cached = new Set(probe.urls);
      const missingCareer = CAREER_CORE_PATHS
        .map((relative) => absoluteFromScope(probe.scope, relative))
        .filter((url) => !cached.has(url));
      assert(missingCareer.length === 0, 'career 资源未进核心缓存: ' + detail(missingCareer));
      const missingCore = swCorePaths
        .map((relative) => absoluteFromScope(probe.scope, relative))
        .filter((url) => !cached.has(url));
      assert(missingCore.length === 0, 'sw.js CORE_PATHS 有未缓存项: ' + detail(missingCore));
      assert(cached.size >= swCorePaths.length, '缓存条目数 ' + cached.size + ' 少于 CORE_PATHS ' + swCorePaths.length);
      return { cacheKey: probe.key, entries: cached.size, career: CAREER_CORE_PATHS.length, corePaths: swCorePaths.length };
    });

    await check('P04 中心页基线：16 张游戏卡 + 版本 0.18.1（career 不破坏中心页）', async () => {
      const hall = await cdp.evaluate(HALL_SRC);
      assert(hall.cards === 16, '中心页游戏卡应为 16，实际 ' + hall.cards);
      assert(hall.arcadeVersion === '0.18.1', 'Arcade.version 应为 0.18.1，实际 ' + JSON.stringify(hall.arcadeVersion));
      assert(hall.versionText.indexOf('0.18.1') !== -1, '中心页版本文案应含 0.18.1，实际 ' + JSON.stringify(hall.versionText));
      assert(hall.offlineFallback === false, '中心页命中了离线兜底页');
      return { cards: hall.cards, version: hall.arcadeVersion, versionText: hall.versionText.trim() };
    });

    /* ============================================================ 在线：真实事件产生线索并落库 */
    await cdp.navigate(GAME_URL);
    await cdp.waitFor('!!(window.ArcadeCareer && window.__arcadeCareerTest)', { timeout: 25000 });
    await cdp.evaluate('window.ArcadeCareer.ready');
    await cdp.waitFor('window.ArcadeCareer.available === true', { timeout: 20000 });

    await check('P05 游戏页（?careerTest=1#test）发现前无剧透：无生涯弹层、无线索标题/地址文案', async () => {
      const pre = await cdp.evaluate(PRE_DISCOVERY_SRC);
      assert(pre.gameId === 'memory-flip', 'bridge gameId 应为 memory-flip，实际 ' + JSON.stringify(pre.gameId));
      assert(pre.available === true, 'career 应可用，实际 ' + JSON.stringify({ available: pre.available, cluesEnabled: pre.cluesEnabled }));
      assert(pre.clueCount === 16, 'clues.json 线索数应为 16，实际 ' + pre.clueCount);
      assert(pre.discovered === 0, '发现前不应有已发现线索，实际 ' + JSON.stringify(pre.discovered));
      assert(pre.cluePanel === false, '发现前不应出现生涯弹层/线索 chip');
      assert(pre.hasClueTitle === false, '发现前页面正文泄漏线索标题「' + CLUE_TITLE + '」');
      assert(pre.hasClueAddress === false, '发现前页面正文泄漏信件地址「' + CLUE_ADDRESS + '」');
      return { gameId: pre.gameId, clueCount: pre.clueCount, discovered: pre.discovered, base: pre.base };
    });

    await check('P06 真实 observe()×2 + finish() 产出一条线索并写入 IndexedDB（CL-memory-flip）', async () => {
      const run = await cdp.evaluate(DISCOVERY_SRC);
      assert(run.accepted[0] === true && run.accepted[1] === true, 'observe(pair.match) 未被接受: ' + detail(run.accepted));
      assert(run.eventCountBeforeFinish === 2, '结算前事件缓冲应为 2，实际 ' + run.eventCountBeforeFinish);
      assert(run.settled && run.settled.clueId === CLUE_ID, 'finish 未产出 ' + CLUE_ID + '：' + detail(run.settled));
      assert(run.settled.reason === 'event', '线索触发原因应为 event（真实事件），实际 ' + JSON.stringify(run.settled.reason));
      assert(run.settled.persisted === true, '线索未写库（persisted=false）: ' + detail(run.settled));
      assert(run.stateClues.indexOf(CLUE_ID) !== -1, 'bridge 状态缺线索: ' + detail(run.stateClues));
      assert(run.eventCount === 0, '结算后事件缓冲应清空，实际 ' + run.eventCount);

      const snapshot = JSON.parse(await cdp.evaluate(READ_DB_SRC));
      const discoveryRow = (snapshot.discovery || []).filter((row) => row && row.clueId === CLUE_ID)[0] || null;
      const stateRow = (snapshot.state || []).filter((row) => row && row.key === 'discovery')[0] || null;
      const stateValue = stateRow && stateRow.value && typeof stateRow.value === 'object' ? stateRow.value : stateRow;
      assert(discoveryRow, 'IDB discovery 表无 ' + CLUE_ID + ' 行: ' + detail(snapshot.discovery));
      assert(stateValue && stateValue.clues && stateValue.clues[CLUE_ID], 'IDB state 快照缺线索记录: ' + detail(stateValue && stateValue.clues));
      const REQUIRED_STORES = ['state', 'discovery', 'runs', 'profiles', 'claims', 'ledgers', 'balances', 'inventory', 'equipment', 'quests', 'migrations'];
      const missingStores = REQUIRED_STORES.filter((name) => (snapshot.names || []).indexOf(name) < 0);
      assert(missingStores.length === 0, '生涯 DB 缺 store: ' + detail(missingStores));
      return {
        clue: run.settled,
        sourceId: discoveryRow.sourceGame,
        stores: snapshot.names.length,
        dbWriteMethod: run.dbWriteMethod,
        /* 口径说明：0.15 的 bridge 结算只持久化 state（discovery 快照）+ discovery 行；
           runs/claims 等经济 store 由 0.16 的 career-core 路径写入，这里不断言其内容。 */
        runsRows: snapshot.runCount
      };
    });

    /* ============================================================ 离线：CDP 断网 + reload 回退缓存 */
    loadingFailures.length = 0;
    /* 页面 target 的 offline 只管页面自身的请求；SW 内部 fetch 要连上 SW target 才能一起断网
       （否则 networkFirst 会「在线」成功，离线回退缓存就失去证据意义）。 */
    swSession = await attachServiceWorkerSession(launched ? launched.port : CDP_PORT, ARCADE_BASE + 'sw.js');
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    let swOfflineApplied = false;
    if (swSession) {
      try {
        await swSession.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
        swOfflineApplied = true;
      } catch (err) {
        swOfflineApplied = false;
      }
    }
    if (!swOfflineApplied && server) {
      /* 兜底：拿不到 SW target 时，直接停掉本地服务器，保证 SW 的 fetch 也真的失败。 */
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
    offlineTransport = swOfflineApplied ? 'cdp-page+cdp-service-worker' : 'cdp-page+server-closed';
    const offlineFence = await cdp.evaluate(`fetch('/tools/validate_site.py', { cache: 'no-store' }).then((res) => 'status:' + res.status, (err) => 'rejected:' + err.name + ':' + err.message)`);
    const offlineRequestStart = requestLog.length;
    /* 同一 URL + 同一 hash 的 Page.navigate 只是片段导航，这里必须用 Page.reload 才是真实重新加载。 */
    await reloadCurrentPage(cdp, 'offline reload 游戏页');
    await cdp.waitFor('!!(window.ArcadeCareer && window.ArcadeCareer.available === true)', { timeout: 25000 });
    await sleep(300);

    await check('P07 CDP offline 生效且离线 reload 由 SW 缓存兜底（离线期间服务器零文档请求）', async () => {
      assert(typeof offlineFence === 'string' && offlineFence.indexOf('rejected:') === 0,
        'CDP offline 未生效：页面在断网后仍能访问网络（' + offlineFence + '）');
      assert(offlineTransport === 'cdp-page+cdp-service-worker' || offlineTransport === 'cdp-page+server-closed',
        '离线传输通道未知: ' + offlineTransport);
      const duringOffline = requestLog.slice(offlineRequestStart).map((entry) => entry.url);
      const documentHits = duringOffline.filter((url) => url.indexOf('/games/') !== -1 || url.indexOf('/career/') !== -1 || url.indexOf('/apps/arcade/engine.js') !== -1);
      assert(documentHits.length === 0, '离线期间服务器仍收到页面资源请求（说明未真正离线）: ' + detail(documentHits));
      const page = await cdp.evaluate(OFFLINE_PAGE_SRC);
      assert(page.readyState === 'complete', '离线页未加载完成: ' + page.readyState);
      assert(page.offlineFallback === false, '离线页命中了 SW 未预载兜底页: ' + JSON.stringify(page.title));
      assert(page.title.indexOf('记忆翻牌') !== -1, '离线页标题不是记忆翻牌（可能被别页缓存回答）: ' + JSON.stringify(page.title));
      assert(page.controller === true, '离线页未被 SW 控制');
      /* 离线时页面发起的网络请求确实失败（浏览器日志里能看到 net::ERR_INTERNET_DISCONNECTED）。
         这些是离线模拟的正常噪声，单独归类，不计入缺陷。 */
      const offlineFailures = loadingFailures.filter((entry) => /ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED/.test(entry));
      return {
        offlineTransport,
        fence: offlineFence,
        serverHitsDuringOffline: duringOffline,
        offlineNetworkFailures: offlineFailures.length,
        title: page.title,
        transferSize: page.transferSize,
        workerStart: page.workerStart
      };
    });

    await check('P08 离线页 engine 0.18.1 + career 资源全部来自缓存（available/info 无加载错误）', async () => {
      const page = await cdp.evaluate(OFFLINE_PAGE_SRC);
      assert(page.engineVersion === '0.18.1', '离线页 Arcade.version 应为 0.18.1，实际 ' + JSON.stringify(page.engineVersion));
      assert(page.careerAvailable === true, '离线页 ArcadeCareer.available 应为 true（career 资源来自缓存），实际 ' +
        detail({ available: page.careerAvailable, reason: page.careerInfo && page.careerInfo.reason }));
      assert(page.careerGameId === 'memory-flip', '离线页 gameId 应为 memory-flip，实际 ' + JSON.stringify(page.careerGameId));
      const info = page.careerInfo || {};
      assert(Array.isArray(info.loadErrors) && info.loadErrors.length === 0, '离线页 career 依赖加载错误: ' + detail(info.loadErrors));
      const failed = Object.keys(info.loadedScripts || {}).filter((key) => !info.loadedScripts[key].ok);
      assert(failed.length === 0, '离线页有未成功装载的 career 脚本: ' + detail(failed));
      assert(info.cluesEnabled === true, '离线页 clues.json 未生效（应来自缓存内容）');
      assert(info.clueCount === 16, '离线页线索数应为 16，实际 ' + info.clueCount);
      assert(info.dbUsable === true, '离线页 career DB 不可用: ' + detail({ dbUsable: info.dbUsable, reason: info.reason }));
      assert(info.stateLoadedFromDb === true, '离线页发现状态不是从 IDB 读回的（stateLoadedFromDb=false）');
      assert(typeof info.base === 'string' && info.base === ARCADE_BASE, '离线页 career base 应为 ' + ARCADE_BASE + '，实际 ' + detail(info.base));
      return {
        engine: page.engineVersion,
        available: page.careerAvailable,
        loadedScripts: Object.keys(info.loadedScripts || {}).length,
        loadErrors: (info.loadErrors || []).length,
        stateLoadedFromDb: info.stateLoadedFromDb,
        base: info.base
      };
    });

    await check('P09 离线 openMailbox() 可打开并显示已发现线索（标题/信件地址来自缓存内容 + IDB 状态）', async () => {
      const box = await cdp.evaluate(MAILBOX_SRC);
      assert(box.opened && box.opened.ok === true, 'openMailbox() 离线失败: ' + detail(box.opened));
      assert(box.hasPanel === true, '信箱面板未出现（离线 UI 模块未装载）: ' + detail(box.panelText));
      assert(box.itemIds.indexOf(CLUE_ID) !== -1, '信箱未列出已发现线索 ' + CLUE_ID + '：' + detail(box.itemIds));
      assert(typeof box.itemText === 'string' && box.itemText.indexOf(CLUE_TITLE) !== -1,
        '信箱条目标题应含「' + CLUE_TITLE + '」，实际 ' + detail(box.itemText));
      assert(typeof box.letterTitle === 'string' && box.letterTitle.indexOf(CLUE_TITLE) !== -1,
        '信件标题应含「' + CLUE_TITLE + '」，实际 ' + detail(box.letterTitle));
      assert(typeof box.letterAddress === 'string' && box.letterAddress.indexOf(CLUE_ADDRESS) !== -1,
        '信件地址应含「' + CLUE_ADDRESS + '」，实际 ' + detail(box.letterAddress));
      assert(box.stateLoadedFromDb === true, '信箱状态不是从 IDB 读回（离线不可读）');
      const shot = await cdp.screenshot('career-pwa-offline-mailbox.png');
      return { itemIds: box.itemIds, itemText: box.itemText, address: box.letterAddress, screenshot: path.basename(shot) };
    });

    await check('P10 离线页无未捕获异常 / console error（离线网络日志单独归类，不算缺陷）', async () => {
      /* 主动制造一次「离线请求失败」：用于证明分类器真的把 net::ERR_INTERNET_DISCONNECTED
         这类正常离线日志归为噪声，而不是因为一条都没看到才通过。 */
      const noiseProbe = await cdp.evaluate(`fetch('/tools/validate_site.py', { cache: 'no-store' }).then((res) => 'status:' + res.status, (err) => 'rejected:' + err.name + ':' + err.message)`);
      await sleep(300);
      const split = splitErrors(cdp.errors.slice());
      assert(typeof noiseProbe === 'string' && noiseProbe.indexOf('rejected:') === 0, '离线主动探针未被网络拒绝: ' + detail(noiseProbe));
      assert(split.real.length === 0, '离线页存在真实错误: ' + detail(split.real));
      assert(split.noise.length >= 1, '离线网络失败没有被归类为可忽略噪声（分类器失效）: ' + detail(cdp.errors));
      return { real: 0, offlineNetworkNoise: split.noise.length, sample: split.noise.slice(0, 2) };
    });

    await check('P11 离线中心页：16 张卡 + 版本 0.18.1，career 不破坏中心页且无错误', async () => {
      await cdp.navigate(HUB_URL);
      await cdp.waitFor('document.querySelectorAll(".hall-card").length === 16', { timeout: 20000 });
      const hall = await cdp.evaluate(HALL_SRC);
      assert(hall.cards === 16, '离线中心页游戏卡应为 16，实际 ' + hall.cards);
      assert(hall.arcadeVersion === '0.18.1', '离线中心页 Arcade.version 应为 0.18.1，实际 ' + JSON.stringify(hall.arcadeVersion));
      assert(hall.versionText.indexOf('0.18.1') !== -1, '离线中心页版本文案应含 0.18.1，实际 ' + JSON.stringify(hall.versionText));
      assert(hall.offlineFallback === false, '离线中心页命中了 SW 未预载兜底页');
      assert(hall.careerPanel === false, '中心页不应出现生涯面板（0.15 无显眼入口）');
      const split = splitErrors(cdp.errors.slice());
      assert(split.real.length === 0, '离线中心页存在真实错误: ' + detail(split.real));
      await cdp.screenshot('career-pwa-offline-hub.png');
      return { cards: hall.cards, version: hall.arcadeVersion, noise: split.noise.length, real: split.real.length };
    });

    /* ============================================================ 恢复在线 + CF 无后缀 + GH 子路径 */
    if (swSession) {
      try {
        await swSession.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      } catch (err) {
        /* SW 可能在离线期间被换掉：恢复失败不影响后续在线断言 */
      }
      swSession.close();
      swSession = null;
    }
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    if (!server) server = await listenServer();
    const onlineAgain = await cdp.evaluate(`fetch('/tools/validate_site.py', { cache: 'no-store' }).then((res) => 'status:' + res.status, (err) => 'rejected:' + err.message)`);
    await check('P12 恢复在线（emulateNetworkConditions offline:false 后网络可用）', async () => {
      assert(onlineAgain === 'status:200', '恢复在线后同源 fetch 应 200，实际 ' + detail(onlineAgain));
      return { probe: onlineAgain };
    });

    responseLog.length = 0;
    await cdp.navigate(NO_SUFFIX_GAME_URL);
    await cdp.waitFor('!!(window.ArcadeCareer && window.ArcadeCareer.available === true)', { timeout: 25000 });
    await check('P13 Cloudflare 兼容无后缀 URL（games/memory-flip）：gameId / 基址 / 生涯事件正常且零 404', async () => {
      const probe = await cdp.evaluate(NO_SUFFIX_SRC);
      assert(probe.detected === 'memory-flip', 'router.detectGameId(无后缀 URL) 应为 memory-flip，实际 ' + detail(probe.detected));
      assert(probe.gameId === 'memory-flip', 'bridge gameId 应为 memory-flip，实际 ' + detail(probe.gameId));
      assert(probe.available === true, '无后缀页 career 应可用: ' + detail({ available: probe.available, errors: probe.loadErrors }));
      assert(probe.base === ARCADE_BASE, 'career base 应为 ' + ARCADE_BASE + '，实际 ' + detail(probe.base));
      assert(probe.careerDir === ARCADE_BASE + 'career/', 'careerDir 应为 ' + ARCADE_BASE + 'career/，实际 ' + detail(probe.careerDir));
      assert(probe.matches[0] === true && probe.matches[1] === true, '无后缀页 observe 未被接受: ' + detail(probe.matches));
      assert(probe.eventCountBefore === 2, '无后缀页结算前事件数应为 2，实际 ' + probe.eventCountBefore);
      assert(probe.eventCountAfter === 0, '无后缀页结算后事件缓冲应清空，实际 ' + probe.eventCountAfter);
      assert(probe.runs && probe.runs.eligibleRuns >= 2, '无后缀页生涯局数未按 memory-flip 计入: ' + detail(probe.runs));
      const bad = responseLog.filter((entry) => entry.status >= 400 && entry.url.indexOf('favicon') === -1);
      assert(bad.length === 0, '无后缀页出现 4xx/5xx 响应: ' + detail(bad));
      const careerResponses = responseLog.filter((entry) => entry.url.indexOf('/apps/arcade/career/') !== -1);
      return { href: probe.href, runs: probe.runs, careerResponses: careerResponses.length, bad: bad.length };
    });

    responseLog.length = 0;
    await cdp.navigate(GH_HUB_URL);
    await cdp.waitFor('!!(window.Arcade)', { timeout: 25000 });
    await cdp.waitFor('document.querySelectorAll(".hall-card").length === 16', { timeout: 20000 });
    await cdp.waitFor(`navigator.serviceWorker.getRegistration().then((reg) => !!(reg && reg.active && reg.scope === ${JSON.stringify(BASE + '/studiokit/apps/arcade/')}))`, { timeout: 30000 });
    const ghHub = await cdp.evaluate(HALL_SRC);
    responseLog.length = 0;
    await cdp.navigate(GH_GAME_URL);
    await cdp.waitFor('!!(window.ArcadeCareer && window.ArcadeCareer.available === true)', { timeout: 25000 });
    await check('P14 GitHub Pages 子路径（/studiokit/apps/arcade/...）：SW scope / career 基址 / 资源零 404', async () => {
      const hubScope = await cdp.evaluate(`navigator.serviceWorker.getRegistration().then((reg) => reg ? reg.scope : null)`);
      assert(hubScope === BASE + '/studiokit/apps/arcade/', 'GH 子路径 SW scope 应为 ' + BASE + '/studiokit/apps/arcade/，实际 ' + detail(hubScope));
      assert(ghHub.cards === 16 && ghHub.arcadeVersion === '0.18.1' && ghHub.offlineFallback === false,
        'GH 子路径中心页异常: ' + detail({ cards: ghHub.cards, version: ghHub.arcadeVersion, fallback: ghHub.offlineFallback }));
      const gh = await cdp.evaluate(GH_PAGE_SRC);
      assert(gh.gameId === 'memory-flip', 'GH 子路径 gameId 应为 memory-flip，实际 ' + detail(gh.gameId));
      assert(gh.available === true, 'GH 子路径 career 应可用: ' + detail({ loadErrors: gh.loadErrors, failed: gh.failedScripts }));
      assert(gh.base === BASE + '/studiokit/apps/arcade/', 'GH 子路径 career base 应为 ' + BASE + '/studiokit/apps/arcade/，实际 ' + detail(gh.base));
      assert(gh.careerDir === BASE + '/studiokit/apps/arcade/career/', 'GH 子路径 careerDir 不对: ' + detail(gh.careerDir));
      assert(Array.isArray(gh.loadErrors) && gh.loadErrors.length === 0, 'GH 子路径 career 依赖加载错误: ' + detail(gh.loadErrors));
      assert((gh.failedScripts || []).length === 0, 'GH 子路径有未成功装载的 career 脚本: ' + detail(gh.failedScripts));
      assert(gh.clueCount === 16 && gh.cluesEnabled === true, 'GH 子路径内容未生效: ' + detail({ clueCount: gh.clueCount, cluesEnabled: gh.cluesEnabled }));
      assert(typeof gh.contentUrls[0] === 'string' && gh.contentUrls[0].indexOf(BASE + '/studiokit/apps/arcade/career/content/registry.json') === 0,
        'GH 子路径内容 URL 不对: ' + detail(gh.contentUrls[0]));
      const bad = responseLog.filter((entry) => entry.status >= 400 && entry.url.indexOf('favicon') === -1);
      assert(bad.length === 0, 'GH 子路径出现 4xx/5xx 响应: ' + detail(bad));
      const notOk = responseLog.filter((entry) => entry.url.indexOf('/studiokit/apps/arcade/career/') !== -1 && entry.status !== 200);
      assert(notOk.length === 0, 'GH 子路径 career 资源非 200: ' + detail(notOk));
      await cdp.screenshot('career-pwa-gh-subpath.png');
      return { scope: hubScope, base: gh.base, careerRequests: responseLog.filter((e) => e.url.indexOf('/studiokit/apps/arcade/career/') !== -1).length };
    });

    /* ============================================================ 缓存内容审计 */
    await check('P15 缓存内容审计：全部同源、无跨域/CDN/外链资源，内容文件外无 clueId 与信件地址（无剧透泄漏）', async () => {
      const audit = await cdp.evaluate(CACHE_AUDIT_SRC);
      assert(audit.external.length === 0, '缓存中存在跨域 URL: ' + detail(audit.external));
      const outside = audit.entries.filter((entry) => {
        if (entry.origin !== BASE) return true;
        return !ALLOWED_CACHE_PREFIXES.some((prefix) => entry.path.indexOf(prefix) === 0);
      });
      assert(outside.length === 0, '缓存条目超出 arcade/shared 允许范围: ' + detail(outside));
      assert(audit.missingBodies.length === 0, '缓存条目缺响应体: ' + detail(audit.missingBodies));
      assert(audit.htmlExternal.length === 0, '缓存 HTML 含外链资源（src/href 指向外部域）: ' + detail(audit.htmlExternal));
      assert(audit.jsExternal.length === 0, '缓存 JS 含外部 fetch/import: ' + detail(audit.jsExternal));
      assert(audit.clueOutsideContent.length === 0, 'career/content 之外出现 clueId（剧透重复/泄漏）: ' + detail(audit.clueOutsideContent));
      assert(audit.spoilerOutsideContent.length === 0, 'career/content 之外出现信件地址文案（剧透泄漏）: ' + detail(audit.spoilerOutsideContent));
      const careerEntries = audit.entries.filter((entry) => entry.path.indexOf('/career/') !== -1);
      const rootCareer = careerEntries.filter((entry) => entry.path.indexOf('/apps/arcade/career/') === 0);
      const ghCareer = careerEntries.filter((entry) => entry.path.indexOf('/studiokit/apps/arcade/career/') === 0);
      assert(rootCareer.length >= CAREER_CORE_PATHS.length, '根 scope career 缓存条目不足: ' + rootCareer.length);
      assert(ghCareer.length >= CAREER_CORE_PATHS.length, 'GH 子路径 career 缓存条目不足: ' + ghCareer.length);
      return {
        caches: audit.keys,
        entries: audit.entries.length,
        careerEntries: careerEntries.length,
        sameOrigin: audit.external.length === 0,
        externalRefs: 0,
        clueLeaks: 0
      };
    });

    /* ============================================================ SW 升级不清 IDB */
    const dbBeforeUpgrade = await cdp.evaluate(READ_DB_SRC);
    await cdp.evaluate(FAKE_OLD_CACHE_SRC);
    const registeredBefore = await cdp.evaluate(`navigator.serviceWorker.getRegistrations().then((regs) => regs.length)`);
    await cdp.evaluate(UNREGISTER_ALL_SRC);
    await cdp.navigate(GAME_URL);
    await cdp.waitFor('!!(window.ArcadeCareer && window.ArcadeCareer.available === true)', { timeout: 25000 });
    await cdp.waitFor('!!navigator.serviceWorker.controller', { timeout: 30000 });
    await cdp.waitFor(`caches.keys().then((keys) => keys.indexOf('${OLD_CACHE_KEY}') === -1)`, { timeout: 20000 }).catch(() => {});
    await sleep(400);

    await check('P16 模拟 SW 升级/重装（伪造旧缓存 → 注销 → 重装）不会清掉 career IndexedDB', async () => {
      const keysAfter = await cdp.evaluate(`caches.keys()`);
      assert(keysAfter.indexOf(OLD_CACHE_KEY) === -1, 'activate 未清理旧版本缓存 ' + OLD_CACHE_KEY + '：' + detail(keysAfter));
      assert(keysAfter.indexOf(CACHE_KEY) !== -1, '升级后缺少当前版本缓存 ' + CACHE_KEY + '：' + detail(keysAfter));
      assert(registeredBefore >= 1, '升级前应有 SW 注册，实际 ' + registeredBefore);
      const controller = await cdp.evaluate('!!navigator.serviceWorker.controller');
      assert(controller === true, '重装后页面未被 SW 接管');
      const afterUpgrade = await cdp.evaluate(READ_DB_SRC);
      assert(afterUpgrade === dbBeforeUpgrade, 'SW 升级/重装后 career DB 数据发生变化: ' +
        detail({ before: dbBeforeUpgrade.slice(0, 120), after: afterUpgrade.slice(0, 120) }));
      const churn = await cdp.evaluate(CACHE_CHURN_SRC);
      assert(churn.wrote === true && churn.deleted === true, '缓存读写/删除自检失败: ' + detail(churn));
      const afterChurn = await cdp.evaluate(READ_DB_SRC);
      assert(afterChurn === afterUpgrade, 'caches 读写影响了 career DB: ' + detail({ before: afterUpgrade.slice(0, 120), after: afterChurn.slice(0, 120) }));
      const parsed = JSON.parse(afterChurn);
      assert(Array.isArray(parsed.databases) && parsed.databases.some((item) => item && item.name === DB_NAME && item.version === 1),
        'indexedDB.databases() 缺少 ' + DB_NAME + ' v1：' + detail(parsed.databases));
      const discoveryRow = (parsed.discovery || []).filter((row) => row && row.clueId === CLUE_ID)[0] || null;
      assert(discoveryRow, '升级后 IDB discovery 表丢失 ' + CLUE_ID + '：' + detail(parsed.discovery));
      return {
        oldCacheRemoved: true,
        currentCachePresent: true,
        caches: keysAfter,
        dbUnchanged: true,
        databases: parsed.databases,
        stores: parsed.names.length
      };
    });

    /* ============================================================ 收尾清理（记录 + finally 兜底） */
    await cdp.navigate(HUB_URL);
    await cdp.waitFor('!!(window.Arcade)', { timeout: 20000 });
    await check('P17 收尾清理：deleteDatabase 成功、SW 全部注销、本测试缓存清空', async () => {
      const deleted = await cdp.evaluate(DELETE_DB_SRC);
      assert(deleted === 'ok', '收尾 deleteDatabase(' + DB_NAME + ') 未成功: ' + deleted);
      const databases = await cdp.evaluate(`indexedDB.databases().then((items) => items.map((item) => item.name))`);
      assert(databases.indexOf(DB_NAME) === -1, 'deleteDatabase 后仍存在 ' + DB_NAME + '：' + detail(databases));
      const unregistered = await cdp.evaluate(UNREGISTER_ALL_SRC);
      const remainingRegs = await cdp.evaluate(`navigator.serviceWorker.getRegistrations().then((regs) => regs.length)`);
      assert(remainingRegs === 0, '仍有 SW 注册未注销: ' + remainingRegs);
      const remainingCaches = await cdp.evaluate(CLEAR_CACHES_SRC);
      assert(Array.isArray(remainingCaches) && remainingCaches.length === 0, '测试缓存未清空: ' + detail(remainingCaches));
      return { deleted, unregistered, remainingCaches: remainingCaches.length };
    });
  } finally {
    /* 任何失败路径都尽力清理，避免影响后续复用同一 profile 的调试。 */
    if (swSession) {
      try {
        await swSession.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      } catch (err) {
        /* ignore */
      }
      swSession.close();
      swSession = null;
    }
    if (cdp) {
      try {
        await cdp.evaluate(DELETE_DB_SRC);
      } catch (err) {
        /* ignore */
      }
    }
    await cleanupBrowser();
    if (server) server.close();
    await stopChrome(launched || {});
  }

  const outcome = summary();
  if (outcome.failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('CAREER PWA OFFLINE TEST FAILED:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
