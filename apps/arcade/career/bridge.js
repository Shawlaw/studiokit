/*!
 * StudioKit Arcade Life — 游戏页唯一入口脚本（0.15，D15-04）
 *
 * 游戏页只加载 `<script src="../career/bridge.js"></script>`（且必须在 engine.js 之后、
 * 页内脚本之前）。本文件：
 *   1) 同步定义 window.ArcadeCareer（版本、gameId 占位、全部安全桩方法）；
 *   2) 异步串行装载依赖：router → registry → discovery → career-core → career-db →
 *      entry-router → ui/clue-surface → ui/mailbox → ui/settings；
 *   3) fetch content/registry.json 与 content/clues.json（cache: 'no-store'）并校验；
 *   4) 提供只读 observe()、单次 finish()、信箱/偏好入口与 ?careerTest=1 专用测试钩子。
 *
 * 硬约束（docs/arcade-life/ADR-interfaces.md §2/§3/§9/§13/§14）：
 * - 任何失败 fail-open：不抛异常到游戏脚本、不阻塞结算、不写引擎既有存储；
 * - observe 只读：不写 DB、不发货币/物品、payload 只接受原始值并截断；
 * - finish 每 run 只处理一次；#test 且无 ?careerTest=1 时整体静默（不持久化/不渲染）；
 * - 生涯数据只写独立 IndexedDB（studiokit:arcade:career），不碰 studiokit:arcade:*:v1。
 *
 * 与并行任务（D15-03 career-db/career-core、D15-05/06/07 ui）的衔接说明：
 * - 本文件对 career-db 采用「按候选方法名探测 + 原始 IDBDatabase 回退」的适配层，
 *   期望顺序见 dbWrite()/readDbStateRecord()/resetDb()；缺失或全部失败时 fail-open。
 * - ui.clueSurface.render 期望签名 render({ clue, onOpen, host, placement, anchor, state })，
 *   host/placement 由本文件选择（overlay 内结果文案下方 / .game-page 右下角），
 *   DOM 与样式完全由 UI 模块负责（本文件不创建任何弹窗/遮罩）。
 * - 0.15 不涉及货币与委托 ticket；career-core 会被装载但不由本文件调用（0.16 起使用）。
 */
(function () {
  'use strict';

  var WINDOW = typeof window !== 'undefined' ? window : null;
  var DOC = typeof document !== 'undefined' ? document : null;
  if (!WINDOW || typeof WINDOW !== 'object') return;

  var VERSION = '0.18.0';
  var CAREER_DB_NAME = 'studiokit:arcade:career';
  var STATE_KEY = 'discovery';
  var VALID_MODES = ['classic', 'challenge', 'zen', 'commission'];
  var VALID_SOURCE_MODES = ['classic', 'challenge', 'zen', 'mow', 'commission'];
  var VALID_OUTCOMES = ['won', 'lost', 'quit', 'abandoned'];
  var EVENT_BUFFER_LIMIT = 200;
  var PAYLOAD_BYTE_LIMIT = 2048;
  var PAYLOAD_MAX_KEYS = 16;
  var STATS_MAX_KEYS = 24;
  var TEXT_FIELD_LIMIT = 120;
  var READY_TIMEOUT_MS = 3000;
  var BOOT_GUARD_MS = 4500;
  var LOAD_TIMEOUT_MS = 4000;
  var FETCH_TIMEOUT_MS = 5000;
  var DB_OPEN_TIMEOUT_MS = 2500;
  var OVERLAY_WAIT_MS = 2000;
  var OVERLAY_POLL_MS = 100;
  /* 同一结算出口被重复调用的防抖窗口（期间无新的 observe 事件才忽略）。 */
  var FINISH_DEBOUNCE_MS = 800;
  /* 0.16 职业委托 ticket：仅当前标签页 sessionStorage，不是 localStorage 存档。 */
  var TICKET_KEY = 'studiokit:arcade:career:ticket.v1';
  var RENTAL_KEY = 'studiokit:arcade:career:rental.v1';
  var TICKET_PARAM = 'career';

  /* 游戏页不得自填的事件信封/金额字段：静默丢弃，不算错误。 */
  var RESERVED_PAYLOAD_KEYS = {
    eventId: 1,
    eventID: 1,
    runId: 1,
    careerRunId: 1,
    gameId: 1,
    sourceMode: 1,
    seq: 1,
    txId: 1,
    txid: 1,
    credits: 1,
    credit: 1,
    amount: 1,
    money: 1,
    currency: 1,
    reward: 1,
    rewards: 1,
    balance: 1,
    price: 1,
    careerId: 1,
    wallet: 1,
  };

  var DEPENDENCIES = [
    { file: 'router.js', global: 'router', required: true },
    { file: 'registry.js', global: 'registry', required: true },
    { file: 'discovery.js', global: 'discovery', required: true },
    { file: 'career-core.js', global: 'core', required: false },
    { file: 'career-db.js', global: 'db', required: false },
    /* backup.js（D15-14）按需装载：慢一步加载可避免未发布时在普通游戏页产生 404 资源错误
       （既有 smoke 会把 404 记为 console error）。首次发现线索/打开信箱/偏好面板时自动加载。 */
    { file: 'backup.js', global: 'backup', required: false, lazy: true },
    { file: 'entry-router.js', global: 'entryRouter', required: false },
    /* 0.16 运行时按需装载：普通游戏页（尤其 #test）不请求未使用模块，避免 404 噪声。 */
    { file: 'commission-core.js', global: 'commission', required: false, lazy: true },
    { file: 'star-combat-config.js', global: 'combatConfig', required: false, lazy: true },
    { file: 'rental.js', global: 'rental', required: false, lazy: true },
    { file: 'alternatives.js', global: 'alternatives', required: false, lazy: true },
    { file: 'materials.js', global: 'materials', required: false, lazy: true },
    { file: 'crafting.js', global: 'crafting', required: false, lazy: true },
    { file: 'professions.js', global: 'professions', required: false, lazy: true },
    { file: 'story-evidence.js', global: 'storyEvidence', required: false, lazy: true },
    { file: 'route-planner.js', global: 'routePlanner', required: false, lazy: true },
    { file: 'campaign-core.js', global: 'campaign', required: false, lazy: true },
    { file: 'ending-reducer.js', global: 'ending', required: false, lazy: true },
    { file: 'ui/clue-surface.js', global: 'ui.clueSurface', required: false },
    { file: 'ui/mailbox.js', global: 'ui.mailbox', required: false },
    { file: 'ui/settings.js', global: 'ui.settings', required: false },
    { file: 'ui/town.js', global: 'ui.town', required: false, lazy: true },
    { file: 'ui/hangar.js', global: 'ui.hangar', required: false, lazy: true },
    { file: 'ui/receipt.js', global: 'ui.receipt', required: false, lazy: true },
    { file: 'ui/market.js', global: 'ui.market', required: false, lazy: true },
    { file: 'ui/workshop.js', global: 'ui.workshop', required: false, lazy: true },
    { file: 'ui/world-state.js', global: 'ui.worldState', required: false, lazy: true },
  ];

  var OVERLAY_ANCHOR_SELECTORS = [
    '[data-result]',
    '[data-settlement]',
    '[data-overlay-result]',
    '.overlay-result',
    '.result-card',
    '.settle-card',
    '[data-overlay] .overlay-card',
  ];

  /* ---------------------------------------------------------------- 重复注入保护 */

  var existing = WINDOW.ArcadeCareer;
  if (existing && existing.__arcadeBridgeMounted) return;
  var api = existing && typeof existing === 'object' ? existing : {};

  /* 同步捕获 bridge.js 自身 URL，供异步装载推理相对基址。 */
  var SELF_SRC = '';
  try {
    SELF_SRC = (DOC && DOC.currentScript && DOC.currentScript.src) || '';
  } catch (err) {
    SELF_SRC = '';
  }

  var internal = {
    bootDone: false,
    readyResolve: null,
    ready: null,
    readyGuard: null,
    reason: null,
    base: '',
    careerDir: '',
    contentBase: '',
    registryInstance: null,
    registryContent: null,
    registryFailed: false,
    cluesEnabled: false,
    clues: [],
    clueBundle: null,
    dbLoaded: false,
    dbUsable: false,
    dbOpenTried: false,
    dbWriteMethod: null,
    discoveryState: null,
    stateLoadedFromDb: false,
    loadedScripts: {},
    loadErrors: [],
    deferredModules: [],
    lazyPending: {},
    events: [],
    dropped: 0,
    seq: 0,
    runId: null,
    sourceMode: 'classic',
    finished: false,
    finishedResult: null,
    finishQueue: null,
    finishCount: 0,
    lastFinishAt: 0,
    lastFinishSignature: null,
    lastRunId: null,
    runSummary: null,
    lastFinish: null,
    rendered: {},
    liveRegion: null,
    warned: {},
    warnings: [],
    testMode: false,
    hashTest: false,
    testApi: null,
    /* 0.16 职业委托 */
    commissionContent: null,
    itemsContent: null,
    chapterContent: null,
    contentRequested: false,
    contentPromise: null,
    commissionRun: null,
    commissionEvents: [],
    commissionSeq: 0,
    commissionLastResult: null,
    commissionActivated: false,
    commissionConfigured: false,
    commissionLastCareerId: null,
    endingEvents: [],
  };

  /* ---------------------------------------------------------------- 基础工具 */

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function nowIso() {
    try {
      return new Date().toISOString();
    } catch (err) {
      return '';
    }
  }

  function clone(value) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      return null;
    }
  }

  function byteLength(text) {
    var value = String(text == null ? '' : text);
    try {
      /* 等价于 UTF-8 字节数，且不依赖 TextEncoder。 */
      return encodeURIComponent(value).replace(/%[0-9A-F]{2}/gi, 'x').length;
    } catch (err) {
      return value.length;
    }
  }

  function codePoints(text) {
    return Array.from(String(text == null ? '' : text));
  }

  function clipText(text, max) {
    var chars = codePoints(text);
    if (chars.length <= max) return String(text);
    return chars.slice(0, max).join('') + '…';
  }

  function warnOnce(key, detail) {
    try {
      if (internal.warned[key]) return;
      internal.warned[key] = true;
      var message = detail && detail.message ? detail.message : detail ? String(detail) : '';
      internal.warnings.push({ key: key, detail: message, at: nowIso() });
      if (WINDOW.console && typeof WINDOW.console.warn === 'function') {
        WINDOW.console.warn('[ArcadeCareer] ' + key + (message ? '：' + message : ''));
      }
    } catch (err) {
      /* 连 console 都不可用时保持静默 */
    }
  }

  function safe(key, fn, fallback) {
    try {
      return fn();
    } catch (err) {
      warnOnce(key, err);
      return fallback;
    }
  }

  function safeAsync(key, factory, fallback) {
    try {
      return Promise.resolve(factory()).catch(function (err) {
        warnOnce(key, err);
        return fallback;
      });
    } catch (err) {
      warnOnce(key, err);
      return Promise.resolve(fallback);
    }
  }

  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('timeout:' + (label || ms)));
      }, ms);
      Promise.resolve(promise).then(
        function (value) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        function (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function joinUrl(base, path) {
    if (!base) return '';
    return String(base).replace(/\/+$/, '') + '/' + String(path == null ? '' : path).replace(/^\/+/, '');
  }

  function newRunId() {
    try {
      if (WINDOW.crypto && typeof WINDOW.crypto.randomUUID === 'function') return WINDOW.crypto.randomUUID();
    } catch (err) {
      /* 回退 */
    }
    var rnd = '';
    try {
      if (WINDOW.crypto && typeof WINDOW.crypto.getRandomValues === 'function') {
        var buf = new Uint32Array(4);
        WINDOW.crypto.getRandomValues(buf);
        rnd = Array.prototype.map.call(buf, function (n) { return n.toString(16); }).join('');
      }
    } catch (err) {
      rnd = '';
    }
    if (!rnd) rnd = Math.random().toString(16).slice(2) + Date.now().toString(16);
    return 'run-' + rnd;
  }

  /* ----------------------------------------------------------- 同步定位（router 未装载前） */

  function inlineLocation() {
    try {
      return WINDOW.location || null;
    } catch (err) {
      return null;
    }
  }

  function inlineCareerTest() {
    try {
      var search = inlineLocation() && typeof inlineLocation().search === 'string' ? inlineLocation().search : '';
      if (!search) return false;
      if (search.charAt(0) === '?') search = search.slice(1);
      var pairs = search.split('&');
      for (var i = 0; i < pairs.length; i += 1) {
        var pair = pairs[i];
        if (!pair) continue;
        var eq = pair.indexOf('=');
        var key = eq < 0 ? pair : pair.slice(0, eq);
        var value = eq < 0 ? '' : pair.slice(eq + 1);
        try {
          key = decodeURIComponent(key);
          value = decodeURIComponent(value);
        } catch (err) {
          /* 保留原值 */
        }
        if (key === 'careerTest' && value === '1') return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  function inlineHashTest() {
    try {
      var loc = inlineLocation();
      var hash = loc && typeof loc.hash === 'string' ? loc.hash : '';
      if (!hash) return false;
      if (hash.charAt(0) !== '#') hash = '#' + hash;
      return hash.indexOf('#test') !== -1;
    } catch (err) {
      return false;
    }
  }

  function inlineDetectGameId() {
    try {
      var loc = inlineLocation();
      var pathname = loc && typeof loc.pathname === 'string' ? loc.pathname : '';
      try {
        pathname = decodeURIComponent(pathname);
      } catch (err) {
        /* 保留原值 */
      }
      var marker = pathname.lastIndexOf('/games/');
      if (marker < 0) return null;
      var raw = pathname.slice(marker + '/games/'.length).replace(/\/+$/, '');
      if (!raw) return null;
      var slug = raw.replace(/\.html$/i, '').toLowerCase();
      if (!slug || slug.indexOf('/') >= 0) return null;
      return slug;
    } catch (err) {
      return null;
    }
  }

  function resolveCareerDir() {
    try {
      if (SELF_SRC) return new URL('.', SELF_SRC).href;
    } catch (err) {
      /* 回退 */
    }
    try {
      var loc = inlineLocation();
      if (loc && loc.href) return new URL('../career/', loc.href).href;
    } catch (err) {
      /* 回退 */
    }
    return '';
  }

  /* 同步标记：既有的「仅 #test」探针必须整体静默（不持久化/不渲染/不发奖励）。 */
  internal.testMode = inlineCareerTest();
  internal.hashTest = inlineHashTest();

  /* ---------------------------------------------------------------- Promise / ready */

  var readyPromise = new Promise(function (resolve) {
    internal.readyResolve = resolve;
  });
  internal.ready = readyPromise;
  internal.finishQueue = Promise.resolve();

  function resolveReady(result) {
    if (internal.bootDone) return;
    internal.bootDone = true;
    try {
      if (internal.readyGuard) clearTimeout(internal.readyGuard);
    } catch (err) {
      /* ignore */
    }
    try {
      internal.readyResolve(result || { available: api.available, reason: api.reason || undefined });
    } catch (err) {
      /* ignore */
    }
  }

  function addReason(reason) {
    if (!internal.reason) internal.reason = reason;
  }

  function waitReady(ms) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve({ available: api.available, reason: 'ready-timeout' });
      }, ms || READY_TIMEOUT_MS);
      readyPromise.then(
        function (result) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result || { available: api.available });
        },
        function () {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ available: false, reason: 'ready-rejected' });
        }
      );
    });
  }

  function isSilentTestOnly() {
    return internal.hashTest && !internal.testMode;
  }

  /* ---------------------------------------------------------------- 依赖装载 */

  function readGlobal(path) {
    var parts = String(path || '').split('.');
    /* UI 模块按既有约定挂到 window.ArcadeCareerUI.*（见 ui/*.js 头注释），
       同时镜像到 api.ui 便于契约字段 ui:{} 使用。 */
    if (parts[0] === 'ui') {
      var uiRoot = WINDOW.ArcadeCareerUI && typeof WINDOW.ArcadeCareerUI === 'object' ? WINDOW.ArcadeCareerUI : null;
      var currentUi = uiRoot || (api.ui && typeof api.ui === 'object' ? api.ui : null);
      for (var uiIndex = 1; uiIndex < parts.length; uiIndex += 1) {
        if (!currentUi) return null;
        currentUi = currentUi[parts[uiIndex]];
      }
      if (currentUi && uiRoot && api.ui && typeof api.ui === 'object') {
        try {
          api.ui[parts[1]] = currentUi;
        } catch (err) {
          /* ignore */
        }
      }
      return currentUi || null;
    }
    var current = api;
    for (var i = 0; i < parts.length; i += 1) {
      if (!current) return null;
      current = current[parts[i]];
    }
    return current || null;
  }

  /**
   * 读取 UI 模块。约定：UI 模块挂到 window.ArcadeCareerUI.*，bridge 镜像到 api.ui；
   * 若调用方（含 QA）显式把 api.ui[name] 换成不同对象，则以 api.ui 为准（便于注入与降级测试）。
   */
  function readUi(name) {
    var local = api.ui && typeof api.ui === 'object' ? api.ui[name] : null;
    var rootUi = WINDOW.ArcadeCareerUI && typeof WINDOW.ArcadeCareerUI === 'object' ? WINDOW.ArcadeCareerUI : null;
    var globalUi = rootUi ? rootUi[name] : null;
    if (local && local !== globalUi) return local;
    if (globalUi) {
      if (api.ui && typeof api.ui === 'object' && api.ui[name] !== globalUi) {
        try {
          api.ui[name] = globalUi;
        } catch (err) {
          /* ignore */
        }
      }
      return globalUi;
    }
    return local || null;
  }

  function syncUiRefs() {
    ['clueSurface', 'mailbox', 'settings'].forEach(function (name) {
      readGlobal('ui.' + name);
    });
  }

  function recordLoad(dep, ok, extra) {
    var entry = { file: dep.file, ok: !!ok, required: !!dep.required, detail: extra || '' };
    internal.loadedScripts[dep.file] = entry;
    if (!ok) {
      internal.loadErrors.push({ file: dep.file, reason: extra || 'unknown', required: !!dep.required });
      if (dep.required) addReason('dependency:' + dep.file + ':' + (extra || 'failed'));
    }
  }

  function injectScript(url) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = null;
      function done(result) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(result);
      }
      timer = setTimeout(function () {
        done({ ok: false, reason: 'timeout' });
      }, LOAD_TIMEOUT_MS);
      try {
        var script = DOC.createElement('script');
        script.src = url;
        script.async = false;
        script.defer = false;
        script.onload = function () {
          done({ ok: true });
        };
        script.onerror = function () {
          done({ ok: false, reason: 'load-error' });
        };
        (DOC.head || DOC.documentElement).appendChild(script);
      } catch (err) {
        done({ ok: false, reason: 'inject-error:' + (err && err.message ? err.message : 'unknown') });
      }
    });
  }

  var LAZY_MODULES = {
    backup: { file: 'backup.js', global: 'backup' },
    commission: { file: 'commission-core.js', global: 'commission' },
    combatConfig: { file: 'star-combat-config.js', global: 'combatConfig' },
    rental: { file: 'rental.js', global: 'rental' },
    alternatives: { file: 'alternatives.js', global: 'alternatives' },
    materials: { file: 'materials.js', global: 'materials' },
    crafting: { file: 'crafting.js', global: 'crafting' },
    professions: { file: 'professions.js', global: 'professions' },
    storyEvidence: { file: 'story-evidence.js', global: 'storyEvidence' },
    routePlanner: { file: 'route-planner.js', global: 'routePlanner' },
    campaign: { file: 'campaign-core.js', global: 'campaign' },
    ending: { file: 'ending-reducer.js', global: 'ending' },
    town: { file: 'ui/town.js', global: 'ui.town' },
    hangar: { file: 'ui/hangar.js', global: 'ui.hangar' },
    receipt: { file: 'ui/receipt.js', global: 'ui.receipt' },
    market: { file: 'ui/market.js', global: 'ui.market' },
    workshop: { file: 'ui/workshop.js', global: 'ui.workshop' },
    worldState: { file: 'ui/world-state.js', global: 'ui.worldState' },
  };

  function loadDependency(dep) {
    if (dep.lazy) {
      /* 延迟装载：不在 boot 阶段请求（未发布时也不产生 404 资源错误）。 */
      internal.deferredModules.push(dep.file);
      return Promise.resolve();
    }
    var url = joinUrl(internal.careerDir, dep.file);
    if (!url) {
      recordLoad(dep, false, 'no-base');
      return Promise.resolve();
    }
    if (readGlobal(dep.global)) {
      recordLoad(dep, true, 'preloaded');
      return Promise.resolve();
    }
    return injectScript(url).then(function (result) {
      var mod = readGlobal(dep.global);
      if (result.ok && mod) {
        recordLoad(dep, true, 'loaded');
        return;
      }
      recordLoad(dep, false, result.ok ? 'module-missing' : result.reason || 'load-error');
    });
  }

  function loadDependencies() {
    return DEPENDENCIES.reduce(function (chain, dep) {
      return chain.then(function () {
        return loadDependency(dep);
      });
    }, Promise.resolve());
  }

  /**
   * career UI 样式：ADR §17 规定全部集中在 ui/clue-surface.css，由 bridge 只装载一次
   * （游戏页不额外加 <link>）。仅 #test 静默模式跳过，避免给既有 smoke 增加资源/DOM。
   */
  function loadCareerStyles() {
    if (isSilentTestOnly()) return Promise.resolve();
    var href = joinUrl(internal.careerDir, 'ui/clue-surface.css');
    if (!href) return Promise.resolve();
    try {
      var existingLinks = DOC.querySelectorAll('link[rel="stylesheet"]');
      for (var i = 0; i < existingLinks.length; i += 1) {
        if (existingLinks[i].href === href) {
          internal.loadedScripts['ui/clue-surface.css'] = { file: 'ui/clue-surface.css', ok: true, required: false, detail: 'preloaded' };
          return Promise.resolve();
        }
      }
    } catch (err) {
      /* ignore */
    }
    return new Promise(function (resolve) {
      var settled = false;
      var timer = null;
      function done(ok, detail) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        internal.loadedScripts['ui/clue-surface.css'] = { file: 'ui/clue-surface.css', ok: !!ok, required: false, detail: detail || '' };
        if (!ok) internal.loadErrors.push({ file: 'ui/clue-surface.css', reason: detail || 'load-error', required: false });
        resolve();
      }
      timer = setTimeout(function () {
        done(false, 'timeout');
      }, LOAD_TIMEOUT_MS);
      try {
        var link = DOC.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = function () {
          done(true, 'loaded');
        };
        link.onerror = function () {
          done(false, 'load-error');
        };
        (DOC.head || DOC.documentElement).appendChild(link);
      } catch (err) {
        done(false, 'inject-error');
      }
    });
  }

  /* ---------------------------------------------------------------- 内容 / DB 装载 */

  /**
   * bridge.js 自身脚本在异步阶段无法再用 document.currentScript（脚本执行结束后为 null），
   * 因此用同步捕获的 SELF_SRC 构造稳定的 docLike 供 router 使用。
   */
  function bridgeDocLike() {
    return { currentScript: SELF_SRC ? { src: SELF_SRC } : null, location: inlineLocation() };
  }

  function resolveBase() {
    var router = readGlobal('router');
    if (router && typeof router.careerBase === 'function') {
      try {
        var base = router.careerBase(bridgeDocLike());
        if (base) return base;
      } catch (err) {
        warnOnce('router-career-base', err);
      }
    }
    try {
      if (SELF_SRC) return new URL('../', SELF_SRC).href;
    } catch (err) {
      /* ignore */
    }
    return '';
  }

  function contentUrlSafe(name) {
    var router = readGlobal('router');
    if (router && typeof router.contentUrl === 'function') {
      try {
        var url = router.contentUrl(name, bridgeDocLike());
        if (url) return url;
      } catch (err) {
        warnOnce('router-content-url', err);
      }
    }
    if (internal.base) return joinUrl(internal.base, 'career/content/' + name);
    return 'career/content/' + name;
  }

  function detectGameIdSafe() {
    var router = readGlobal('router');
    if (router && typeof router.detectGameId === 'function') {
      try {
        return router.detectGameId(inlineLocation()) || null;
      } catch (err) {
        warnOnce('router-detect-game', err);
      }
    }
    return inlineDetectGameId();
  }

  function fetchJson(url) {
    if (!url || typeof WINDOW.fetch !== 'function') return Promise.resolve({ ok: false, reason: 'fetch-unavailable' });
    var controller = null;
    try {
      if (typeof WINDOW.AbortController === 'function') controller = new WINDOW.AbortController();
    } catch (err) {
      controller = null;
    }
    var timer = setTimeout(function () {
      try {
        if (controller) controller.abort();
      } catch (err) {
        /* ignore */
      }
    }, FETCH_TIMEOUT_MS);
    var options = { cache: 'no-store', credentials: 'same-origin' };
    if (controller) options.signal = controller.signal;
    return Promise.resolve()
      .then(function () {
        return WINDOW.fetch(url, options);
      })
      .then(function (response) {
        if (!response || !response.ok) return { ok: false, reason: 'http-' + (response ? response.status : 'unknown') };
        return Promise.resolve()
          .then(function () {
            return response.json();
          })
          .then(function (data) {
            if (!isObject(data)) return { ok: false, reason: 'not-object' };
            return { ok: true, data: data };
          })
          .catch(function (err) {
            return { ok: false, reason: 'json-error:' + (err && err.message ? err.message : 'unknown') };
          });
      })
      .catch(function (err) {
        return { ok: false, reason: 'fetch-error:' + (err && err.message ? err.message : 'unknown') };
      })
      .then(function (result) {
        clearTimeout(timer);
        return result;
      });
  }

  /** 按需装载延迟模块（backup.js 等）；缺失只记一次 loadErrors，绝不抛异常。 */
  function ensureLazyModule(name) {
    var def = LAZY_MODULES[name];
    if (!def) return Promise.resolve(null);
    var existing = readGlobal(def.global);
    if (existing) return Promise.resolve(existing);
    if (internal.lazyPending[name]) return internal.lazyPending[name];
    var url = joinUrl(internal.careerDir, def.file);
    if (!url) return Promise.resolve(null);
    var pending = injectScript(url).then(function (result) {
      var mod = readGlobal(def.global) || null;
      if (result.ok && mod) {
        internal.loadedScripts[def.file] = { file: def.file, ok: true, required: false, detail: 'lazy-loaded' };
        if (def.global === 'backup') api.backup = backupFacade(mod);
        else if (def.global === 'commission') {
          api.commission = mod;
          configureCommissionContent();
        } else if (def.global === 'rental' || def.global === 'alternatives' || def.global === 'combatConfig'
          || def.global === 'materials' || def.global === 'crafting' || def.global === 'professions'
          || def.global === 'storyEvidence' || def.global === 'routePlanner'
          || def.global === 'campaign' || def.global === 'ending') {
          api[def.global] = mod;
          configureCareerModules();
        } else if (def.global.indexOf('ui.') === 0) syncUiRefs();
        return mod;
      }
      internal.loadedScripts[def.file] = { file: def.file, ok: false, required: false, detail: 'deferred-unavailable' };
      internal.loadErrors.push({ file: def.file, reason: result.ok ? 'module-missing' : result.reason || 'load-error', required: false, lazy: true });
      return null;
    });
    internal.lazyPending[name] = pending;
    return pending;
  }

  /** career 已被真实使用（发现线索/打开信箱或偏好）时预热延迟模块；失败静默。 */
  function warmLazyModules() {
    try {
      var pending = ensureLazyModule('backup');
      if (pending && typeof pending.catch === 'function') pending.catch(function () {});
      /* 0.16：玩家已进入生涯后，预取告示板内容（失败静默）。 */
      var contentWarm = loadCareerContent();
      if (contentWarm && typeof contentWarm.catch === 'function') contentWarm.catch(function () {});
    } catch (err) {
      warnOnce('lazy-warm', err);
    }
  }

  function loadContent() {
    return fetchJson(contentUrlSafe('registry.json')).then(function (registryResult) {
      var registryModule = readGlobal('registry');
      if (!registryResult.ok) {
        internal.registryFailed = true;
        addReason('registry-fetch:' + registryResult.reason);
        return;
      }
      if (!registryModule || typeof registryModule.createRegistry !== 'function') {
        internal.registryFailed = true;
        addReason('registry-module-missing');
        return;
      }
      try {
        var instance = registryModule.createRegistry(registryResult.data);
        if (!instance || !Array.isArray(instance.errors) || instance.errors.length > 0) {
          internal.registryFailed = true;
          addReason('registry-invalid');
          if (instance && instance.errors && instance.errors.length) warnOnce('registry-invalid', instance.errors.join('; '));
          return;
        }
        internal.registryInstance = instance;
        internal.registryFailed = false;
        internal.registryContent = registryResult.data;
      } catch (err) {
        internal.registryFailed = true;
        addReason('registry-throw');
        warnOnce('registry-create', err);
      }
    }).then(function () {
      return fetchJson(contentUrlSafe('clues.json')).then(function (clueResult) {
        var discoveryModule = readGlobal('discovery');
        if (!clueResult.ok) {
          internal.cluesEnabled = false;
          addReason('clues-fetch:' + clueResult.reason);
          return;
        }
        if (!discoveryModule || typeof discoveryModule.normalizeClueBundle !== 'function') {
          internal.cluesEnabled = false;
          addReason('clues-module-missing');
          return;
        }
        try {
          var bundle = discoveryModule.normalizeClueBundle(clueResult.data);
          internal.clueBundle = bundle;
          if (!bundle || (bundle.errors && bundle.errors.length > 0)) {
            internal.cluesEnabled = false;
            addReason('clues-invalid');
            if (bundle && bundle.errors && bundle.errors.length) warnOnce('clues-invalid', bundle.errors.join('; '));
            return;
          }
          internal.clues = Array.isArray(bundle.clues) ? bundle.clues : [];
          internal.cluesEnabled = true;
        } catch (err) {
          internal.cluesEnabled = false;
          addReason('clues-throw');
          warnOnce('clues-normalize', err);
        }
      });
    });
  }

  /* ---------------------------------------------------------------- 0.16 职业委托内容/ticket */

  /** 可选内容：不存在/坏档都不影响经典与 0.15 线索（fail-open）。 */
  function loadCareerContent() {
    if (internal.contentRequested) return internal.contentPromise || Promise.resolve();
    internal.contentRequested = true;
    function one(name, key, pick) {
      return fetchJson(contentUrlSafe(name))
        .then(function (result) {
          if (result.ok && result.data) {
            var value = pick(result.data);
            if (value) internal[key] = result.data;
          }
        })
        .catch(function () {});
    }
    var all = Promise.all([
      one('commissions.json', 'commissionContent', function (data) {
        return Array.isArray(data.commissions) ? data.commissions : null;
      }),
      one('items.json', 'itemsContent', function (data) {
        return Array.isArray(data.ships) || Array.isArray(data.modules) ? data : null;
      }),
      one('chapter-01.json', 'chapterContent', function (data) {
        return data && typeof data === 'object' ? data : null;
      }),
      one('campaign.json', 'campaignContent', function (data) {
        return data && Array.isArray(data.chapters) ? data : null;
      }),
      one('chapter-00.json', 'c00', function (data) { return data && data.chapterId ? data : null; }),
      one('chapter-02.json', 'c02', function (data) { return data && data.chapterId ? data : null; }),
      one('chapter-03.json', 'c03', function (data) { return data && data.chapterId ? data : null; }),
      one('chapter-04.json', 'c04', function (data) { return data && data.chapterId ? data : null; }),
      one('chapter-05.json', 'c05', function (data) { return data && data.chapterId ? data : null; }),
      one('side-stories.json', 'sideStoriesContent', function (data) {
        return data && Array.isArray(data.families) ? data : null;
      }),
      one('npc.json', 'npcContent', function (data) {
        return data && Array.isArray(data.characters) ? data : null;
      }),
      one('ending-combat.json', 'endingCombatContent', function (data) {
        return data && data.approach ? data : null;
      }),
      one('ending-research.json', 'endingResearchContent', function (data) {
        return data && data.approach ? data : null;
      }),
      one('ending-rescue.json', 'endingRescueContent', function (data) {
        return data && data.approach ? data : null;
      }),
    ]).then(function () {
      internal.chapterFiles = {
        C0: internal.c00 || null,
        C1: internal.chapterContent || null,
        C2: internal.c02 || null,
        C3: internal.c03 || null,
        C4: internal.c04 || null,
        C5: internal.c05 || null,
      };
      if (internal.itemsContent) api.items = clone(internal.itemsContent);
      if (commissionModule()) configureCommissionContent();
      configureCareerModules();
    });
    internal.contentPromise = all;
    return all;
  }

  function configureCareerModules() {
    var payload = {
      items: internal.itemsContent || null,
      commissions: internal.commissionContent || null,
      chapter: internal.chapterContent || null,
      registry: internal.registryContent || null,
      campaign: internal.campaignContent || null,
      chapters: internal.chapterFiles || null,
      sideStories: internal.sideStoriesContent || null,
      npc: internal.npcContent || null,
      endings: [internal.endingCombatContent, internal.endingResearchContent, internal.endingRescueContent].filter(Boolean),
      evidence: internal.registryContent || null,
      db: api.db || null,
    };
    ['materials', 'crafting', 'professions', 'storyEvidence', 'routePlanner', 'campaign', 'ending'].forEach(function (name) {
      var mod = readGlobal(name);
      if (!mod || typeof mod.configure !== 'function') return;
      try {
        mod.configure(payload);
      } catch (err) {
        warnOnce('career-module-configure:' + name, err);
      }
    });
  }

  function commissionModule() {
    return readGlobal('commission') || null;
  }

  /** 把 commissions.json 交给 commission-core（只配置一次；缺失/失败保持 fail-open）。 */
  function configureCommissionContent() {
    var mod = commissionModule();
    if (!mod || typeof mod.configure !== 'function') return mod;
    if (internal.commissionConfigured) return mod;
    if (!internal.commissionContent) return mod;
    try {
      var result = mod.configure({ content: internal.commissionContent });
      internal.commissionConfigured = true;
      if (result && result.errors && result.errors.length) {
        warnOnce('commission-content', result.errors.join('; '));
      }
    } catch (err) {
      warnOnce('commission-configure', err);
    }
    return mod;
  }

  function readStorage(storageName) {
    try {
      var storage = WINDOW[storageName];
      return storage || null;
    } catch (err) {
      return null;
    }
  }

  function readStoredTicket() {
    var storage = readStorage('sessionStorage');
    if (!storage) return null;
    try {
      var raw = storage.getItem(TICKET_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return isObject(parsed) ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  /** 0.16 D16-07：本标签页的免费租机标记（不落 DB、不改变拥有）。 */
  function readRentalMarker() {
    var storage = readStorage('sessionStorage');
    if (!storage) return null;
    try {
      var raw = storage.getItem(RENTAL_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return isObject(parsed) && typeof parsed.shipId === 'string' ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function clearStoredTicket() {
    var storage = readStorage('sessionStorage');
    if (!storage) return;
    try {
      storage.removeItem(TICKET_KEY);
    } catch (err) {
      /* ignore */
    }
  }

  function clearRentalMarker() {
    var storage = readStorage('sessionStorage');
    if (!storage) return;
    try {
      storage.removeItem(RENTAL_KEY);
    } catch (err) {
      /* ignore */
    }
  }

  function readTicketParam() {
    try {
      var search = (WINDOW.location && WINDOW.location.search) || '';
      if (!search) return '';
      if (search.charAt(0) === '?') search = search.slice(1);
      var pairs = search.split('&');
      for (var i = 0; i < pairs.length; i += 1) {
        var pair = pairs[i];
        if (!pair) continue;
        var eq = pair.indexOf('=');
        var key = eq < 0 ? pair : pair.slice(0, eq);
        var value = eq < 0 ? '' : pair.slice(eq + 1);
        try {
          key = decodeURIComponent(key);
          value = decodeURIComponent(value);
        } catch (err) {
          /* keep raw */
        }
        if (key === TICKET_PARAM && value) return value;
      }
    } catch (err) {
      return '';
    }
    return '';
  }

  /** 根据 URL ticket + DB run 激活职业 mode；失败静默回到经典。 */
  function activateCommissionRun() {
    if (internal.commissionActivated) return Promise.resolve();
    internal.commissionActivated = true;
    var ticketId = readTicketParam();
    if (!ticketId) return Promise.resolve();
    if (!internal.dbUsable) {
      addReason('commission-db-unavailable');
      return Promise.resolve();
    }
    /* commission-core 按需装载；内容目录用于 validate 时读取委托与 startParams。 */
    return loadCareerContent()
      .then(function () {
        return ensureLazyModule('commission');
      })
      .then(function () {
        var mod = commissionModule();
        if (!mod || typeof mod.validateTicket !== 'function') {
          addReason('commission-module-missing');
          warnOnce('commission-module', 'commission-core.js unavailable; classic fallback');
          return null;
        }
        configureCommissionContent();
        var stored = readStoredTicket();
        return Promise.resolve(mod.validateTicket({ ticketId: ticketId, ticket: stored, gameId: api.gameId })).then(function (result) {
          if (!result || !result.ok || !result.commission || !result.run) {
            addReason('commission-ticket-rejected:' + ((result && result.reason) || 'unknown'));
            return null;
          }
          /* 游戏页已按经典开局（慢启动超时）后，late ticket 不再切换模式，避免一局两套结算。 */
          try {
            if (internal.bootTimedOut || (WINDOW && WINDOW.__arcadeMode === 'classic')) {
              addReason(internal.bootTimedOut ? 'boot-timeout-classic-committed' : 'classic-mode-committed');
              return null;
            }
          } catch (err) {
            /* ignore */
          }
          internal.commissionRun = {
            ticketId: ticketId,
            careerId: result.run.careerId,
            commissionId: result.commission.commissionId,
            gameId: result.commission.gameId,
            startParams: isObject(result.commission.startParams) ? clone(result.commission.startParams) : {},
            commission: clone(result.commission),
            status: 'active',
          };
          internal.sourceMode = 'commission';
          api.commissionRun = clone(internal.commissionRun);
          /* 免费租机：同一 careerId 的 marker 只影响本次出击，不改装备/拥有。 */
          try {
            var rental = readRentalMarker();
            if (rental && (!rental.careerId || rental.careerId === result.run.careerId)) {
              internal.commissionRun.startParams.rentalShipId = rental.shipId;
              internal.commissionRun.rentalShipId = rental.shipId;
              api.commissionRun = clone(internal.commissionRun);
            }
          } catch (err) {
            warnOnce('commission-rental', err);
          }
          try {
            if (typeof mod.markActive === 'function') mod.markActive(ticketId);
          } catch (err) {
            warnOnce('commission-active', err);
          }
          /* 0.18 终局：新页面重新装载 ending 实例并接管 ticket，否则事件缓冲不共享。 */
          if (typeof result.commission.commissionId === 'string' && result.commission.commissionId.indexOf('ending.') === 0) {
            var endingLoads = [ensureLazyModule('ending'), loadCareerContent()];
            if (result.commission.gameId === 'star-raid') endingLoads.push(ensureLazyModule('combatConfig'));
            return Promise.all(endingLoads)
              .then(function () {
                configureCareerModules();
                var endingModule = readGlobal('ending');
                if (endingModule && typeof endingModule.attach === 'function') {
                  endingModule.attach({
                    ticketId: ticketId,
                    ticket: stored,
                    run: result.run,
                    commissionId: result.commission.commissionId,
                    gameId: result.commission.gameId,
                    careerId: result.run.careerId,
                  });
                }
                var mainModule = commissionModule();
                if (mainModule && typeof mainModule.adoptRun === 'function') {
                  mainModule.adoptRun(stored || { ticketId: ticketId, runId: ticketId, commissionId: result.commission.commissionId, gameId: result.commission.gameId, careerId: result.run.careerId, mode: 'commission' }, result.run);
                }
                return true;
              });
          }
          /* 星海职业战斗需要机体配置模块（缺失时游戏回退默认旧翼）。 */
          if (result.commission.gameId === 'star-raid') {
            return ensureLazyModule('combatConfig').then(function () {
              return true;
            });
          }
          return true;
        });
      })
      .catch(function (err) {
        addReason('commission-activate-error');
        warnOnce('commission-activate', err);
      });
  }

  /** 职业 run 的观察事件：不进发现缓冲、不渲染微线索。 */
  function observeCommission(kind, payload) {
    var mod = commissionModule();
    if (!internal.commissionRun) return false;
    var clean = sanitizeFlat(payload, { maxBytes: PAYLOAD_BYTE_LIMIT, maxKeys: PAYLOAD_MAX_KEYS, filterReserved: true });
    if (!clean.ok) return false;
    internal.commissionSeq += 1;
    var event = { kind: kind, payload: clean.value, seq: internal.commissionSeq, sourceMode: 'commission', at: nowIso() };
    var accepted = false;
    /* 0.18 终局 run：事件同时写入 ending 实例，并在结算前可重放（两实例缓冲不共享）。 */
    if (typeof internal.commissionRun.commissionId === 'string' && internal.commissionRun.commissionId.indexOf('ending.') === 0) {
      internal.endingEvents.push(event);
      var endingModule = readGlobal('ending');
      if (endingModule && typeof endingModule.recordEvent === 'function') {
        try {
          accepted = endingModule.recordEvent(internal.commissionRun.ticketId, event);
        } catch (err) {
          warnOnce('ending-observe', err);
        }
      }
      /* 同时记入主实例缓冲，供 info().commissionEvents 与通用 UI 统计。 */
      if (mod && typeof mod.recordEvent === 'function') {
        try { mod.recordEvent(internal.commissionRun.ticketId, event); } catch (err) { /* ignore */ }
      }
      return accepted !== false;
    }
    if (!mod || typeof mod.recordEvent !== 'function') return false;
    try {
      accepted = mod.recordEvent(internal.commissionRun.ticketId, event);
    } catch (err) {
      warnOnce('commission-observe', err);
      return false;
    }
    return accepted !== false;
  }

  function commissionFailure(reason, extra) {
    var out = { ok: false, reason: reason || 'commission-failed' };
    if (isObject(extra)) {
      Object.keys(extra).forEach(function (key) {
        out[key] = extra[key];
      });
    }
    internal.commissionLastResult = clone(out);
    return out;
  }

  /** 职业结算：目标判定 → settleAndClaim → 收据；幂等由 DB 保证。 */
  function settleCommissionRun(modeName, outcome, stats) {
    var mod = commissionModule();
    if (!mod || typeof mod.settle !== 'function') return Promise.resolve(commissionFailure('commission-module-missing'));
    var run = internal.commissionRun;
    if (!run) return Promise.resolve(null);
    internal.commissionLastCareerId = run.careerId;
    internal.sourceMode = 'commission';
    /* 0.18 终局 run 使用 ending-reducer 的独立 commission 实例，不能交给 96 告示板实例结算。 */
    if (typeof run.commissionId === 'string' && run.commissionId.indexOf('ending.') === 0) {
      return ensureLazyModule('ending')
        .then(function (endingModule) {
          if (!endingModule || typeof endingModule.settleEnding !== 'function') {
            return commissionFailure('ending-module-missing');
          }
          /* 重放本页真实事件到 ending 实例（去重由记录入口按 seq 容忍）。 */
          if (typeof endingModule.recordEvent === 'function') {
            internal.endingEvents.forEach(function (event) {
              try { endingModule.recordEvent(run.ticketId, event); } catch (err) { /* ignore */ }
            });
          }
          return endingModule.settleEnding({ ticketId: run.ticketId });
        })
        .then(function (result) {
          var normalized = result && typeof result === 'object' ? result : commissionFailure('ending-settle-empty');
          internal.commissionLastResult = clone(normalized);
          internal.lastFinish = {
            input: { mode: modeName, outcome: outcome, stats: stats || {} },
            result: normalized,
            reason: normalized.ok ? 'ending' : normalized.reason || 'ending-failed',
            at: nowIso(),
            runId: normalized.runId || run.ticketId,
          };
          internal.commissionEvents = [];
          internal.commissionSeq = 0;
          internal.endingEvents = [];
          api.commissionRun = null;
          clearStoredTicket();
          clearRentalMarker();
          internal.finished = true;
          internal.finishedResult = normalized;
          renderCommissionReceipt(normalized);
          return normalized;
        })
        .catch(function (err) {
          warnOnce('ending-settle', err);
          return commissionFailure('ending-settle-error');
        });
    }
    return Promise.resolve(mod.settle({
      ticketId: run.ticketId,
      outcome: outcome,
      stats: stats || {},
    }))
      .then(function (result) {
        if (!result || typeof result !== 'object') {
          return commissionFailure('commission-settle-empty');
        }
        var normalized = result;
        internal.commissionLastResult = clone(normalized);
        internal.lastFinish = {
          input: { mode: modeName, outcome: outcome, stats: stats || {} },
          result: normalized,
          reason: normalized.ok ? 'commission' : normalized.reason || 'commission-failed',
          at: nowIso(),
          runId: normalized.runId || (normalized.receipt && normalized.receipt.receiptId) || run.ticketId,
        };
        /* 结算（成功或可归因失败）都消费 ticket；后续同页再结算回到经典发现。 */
        internal.commissionRun = null;
        internal.commissionEvents = [];
        internal.commissionSeq = 0;
        api.commissionRun = null;
        clearStoredTicket();
        clearRentalMarker();
        internal.finished = true;
        internal.finishedResult = normalized;
        renderCommissionReceipt(normalized);
        /* 0.17：把收据里的剧情证据登记为只读 evidence token（失败不影响结算结果）。 */
        if (normalized.ok && normalized.receipt && typeof normalized.receipt === 'object') {
          var db = api.db || readGlobal('db');
          return ensureLazyModule('storyEvidence')
            .then(function (evidenceModule) {
              if (!evidenceModule || typeof evidenceModule.recordFromReceipt !== 'function' || !db) return normalized;
              return Promise.resolve(evidenceModule.recordFromReceipt({
                careerId: run.careerId,
                receipt: normalized.receipt,
                db: db,
                now: nowIso(),
              })).then(function () {
                return normalized;
              });
            })
            .catch(function (err) {
              warnOnce('story-evidence', err);
              return normalized;
            });
        }
        return normalized;
      })
      .catch(function (err) {
        warnOnce('commission-settle', err);
        return commissionFailure('commission-settle-error');
      });
  }

  function renderCommissionReceipt(result) {
    var receiptUi = readUi('receipt');
    if (!receiptUi || typeof receiptUi.show !== 'function') {
      /* receipt.js 是 lazy 依赖：玩家本局没开过钱包时也要在结算后加载并展示收据。 */
      ensureLazyModule('receipt')
        .then(function (loaded) {
          if (!loaded || typeof loaded.show !== 'function') return;
          try {
            loaded.show({
              api: api,
              result: clone(result),
              careerId: internal.commissionLastCareerId || null,
              announce: announceToUser,
              reducedMotion: reducedMotionPreferred(),
            });
          } catch (err) {
            warnOnce('commission-receipt-ui', err);
          }
        })
        .catch(function () {});
      return;
    }
    try {
      receiptUi.show({
        api: api,
        result: clone(result),
        careerId: internal.commissionLastCareerId || null,
        announce: announceToUser,
        reducedMotion: reducedMotionPreferred(),
      });
    } catch (err) {
      warnOnce('commission-receipt-ui', err);
    }
  }

  function pickMethod(target, names) {
    if (!target) return null;
    for (var i = 0; i < names.length; i += 1) {
      var fn = target[names[i]];
      if (typeof fn === 'function') return { name: names[i], fn: fn };
    }
    return null;
  }

  function isIdbLike(value) {
    return !!value && typeof value === 'object' && typeof value.transaction === 'function' && typeof value.objectStoreNames !== 'undefined';
  }

  function rawIdb(dbModule) {
    if (!dbModule) return null;
    var keys = ['db', 'idb', 'handle', 'database', 'connection'];
    for (var i = 0; i < keys.length; i += 1) {
      if (isIdbLike(dbModule[keys[i]])) return dbModule[keys[i]];
    }
    return isIdbLike(dbModule) ? dbModule : null;
  }

  function callMaybeAsync(descriptor, target, args) {
    return new Promise(function (resolve, reject) {
      var returned;
      try {
        returned = descriptor.fn.apply(target, args || []);
      } catch (err) {
        reject(err);
        return;
      }
      if (returned && typeof returned.then === 'function') {
        returned.then(resolve, reject);
        return;
      }
      resolve(returned);
    });
  }

  function normalizeWriteResult(raw) {
    if (raw === undefined || raw === null || raw === true) return { ok: true };
    if (raw === false) return { ok: false, error: 'writer-returned-false' };
    if (isObject(raw)) {
      if (raw.ok === false) return { ok: false, error: typeof raw.error === 'string' ? raw.error : raw.reason || 'writer-failed' };
      return { ok: true };
    }
    return { ok: true };
  }

  function openDb() {
    var dbModule = readGlobal('db');
    internal.dbLoaded = !!dbModule;
    if (!dbModule) {
      internal.dbUsable = false;
      addReason('db-module-missing');
      return Promise.resolve();
    }
    if (internal.hashTest && !internal.testMode) {
      /* 仅 #test 探针：不触碰 IndexedDB（既有 smoke 不得被污染）。 */
      internal.dbUsable = false;
      return Promise.resolve();
    }
    internal.dbOpenTried = true;
    var openTask = null;
    try {
      if (dbModule.ready && typeof dbModule.ready.then === 'function') {
        return withTimeout(dbModule.ready, DB_OPEN_TIMEOUT_MS, 'db-ready').then(
          function (opened) {
            if (opened && opened.ok === false) {
              internal.dbUsable = false;
              addReason('db-open-failed');
              warnOnce('db-open', opened.error || opened.reason || 'open-failed');
              return;
            }
            internal.dbUsable = true;
          },
          function (err) {
            internal.dbUsable = false;
            addReason('db-open-failed');
            warnOnce('db-open', err);
          }
        );
      }
      if (typeof dbModule.open === 'function') {
        openTask = Promise.resolve().then(function () {
          return dbModule.open();
        });
        return withTimeout(openTask, DB_OPEN_TIMEOUT_MS, 'db-open').then(
          function (opened) {
            if (opened && opened.ok === false) {
              internal.dbUsable = false;
              addReason('db-open-failed');
              warnOnce('db-open', opened.error || opened.reason || 'open-failed');
              return;
            }
            internal.dbUsable = true;
          },
          function (err) {
            internal.dbUsable = false;
            addReason('db-open-failed');
            warnOnce('db-open', err);
          }
        );
      }
      /* 没有 ready/open：假定模块自带惰性打开，写时再判定。 */
      internal.dbUsable = true;
      return Promise.resolve();
    } catch (err) {
      internal.dbUsable = false;
      addReason('db-open-threw');
      warnOnce('db-open', err);
      return Promise.resolve();
    }
  }

  /* ---------------------------------------------------------------- DB 适配层 */

  function buildStateRecord(state) {
    var record = clone(state) || {};
    record.key = STATE_KEY;
    return record;
  }

  function normalizeDiscoveryRecords(records) {
    if (!records) return [];
    var list = Array.isArray(records) ? records : [records];
    var out = [];
    list.forEach(function (record) {
      if (!isObject(record)) return;
      if (typeof record.clueId !== 'string' || !record.clueId) return;
      out.push(clone(record));
    });
    return out;
  }

  function idbWrite(idb, pairs) {
    return new Promise(function (resolve, reject) {
      var storeNames = [];
      pairs.forEach(function (pair) {
        if (storeNames.indexOf(pair[0]) < 0) storeNames.push(pair[0]);
      });
      var names = idb.objectStoreNames;
      var usable = storeNames.filter(function (name) {
        if (!names) return true;
        if (typeof names.contains === 'function') return names.contains(name);
        try {
          return Array.prototype.indexOf.call(names, name) >= 0;
        } catch (err) {
          return true;
        }
      });
      if (!usable.length) {
        reject(new Error('idb-stores-missing'));
        return;
      }
      var tx;
      try {
        tx = idb.transaction(usable, 'readwrite');
      } catch (err) {
        reject(err);
        return;
      }
      var settled = false;
      tx.oncomplete = function () {
        if (settled) return;
        settled = true;
        resolve({ ok: true, method: 'idb-transaction' });
      };
      tx.onerror = function () {
        if (settled) return;
        settled = true;
        reject(tx.error || new Error('idb-error'));
      };
      tx.onabort = function () {
        if (settled) return;
        settled = true;
        reject(tx.error || new Error('idb-abort'));
      };
      try {
        pairs.forEach(function (pair) {
          if (usable.indexOf(pair[0]) < 0) return;
          tx.objectStore(pair[0]).put(pair[1]);
        });
      } catch (err) {
        try {
          tx.abort();
        } catch (abortErr) {
          /* ignore */
        }
        if (!settled) {
          settled = true;
          reject(err);
        }
      }
    });
  }

  function runStrategies(strategies) {
    if (!strategies.length) return Promise.resolve({ ok: false, error: 'db-api-unsupported' });
    var index = 0;
    var lastError = null;
    function next() {
      if (index >= strategies.length) return Promise.resolve({ ok: false, error: lastError || 'db-api-unsupported' });
      var strategy = strategies[index];
      index += 1;
      return Promise.resolve()
        .then(function () {
          return strategy();
        })
        .then(
          function (result) {
            if (result && result.ok) return result;
            lastError = (result && result.error) || 'writer-failed';
            return next();
          },
          function (err) {
            lastError = err && err.message ? err.message : 'writer-threw';
            return next();
          }
        );
    }
    return next();
  }

  function pairValues(pairs, store) {
    return pairs.filter(function (pair) { return pair[0] === store; }).map(function (pair) { return pair[1]; });
  }

  function chainPairs(pairs, handler) {
    return pairs
      .reduce(
        function (chain, pair) {
          return chain.then(function () {
            return callMaybeAsync({ fn: handler }, null, [pair[0], pair[1]]).then(function (raw) {
              var normalized = normalizeWriteResult(raw);
              if (!normalized.ok) throw new Error(normalized.error || 'writer-failed');
              return normalized;
            });
          });
        },
        Promise.resolve()
      )
      .then(function () {
        return { ok: true };
      });
  }

  /**
   * 写入发现状态与线索记录。按生涯 DB 模块公开接口逐级探测，全部失败返回 {ok:false}。
   * 优先 D15-03 career-db 的 putDiscovery(records[]) + saveDiscoveryState(state)（线索行先写、
   * state 后写，state 是 UI/intro 的门闩；0.15 无线索时只写 state），
   * 其次组合 API / 通用 put / 原始 IDBDatabase 单事务。
   */
  function dbWrite(state, discoveryRecords) {
    return Promise.resolve()
      .then(function () {
        var dbModule = readGlobal('db');
        if (!dbModule) return { ok: false, error: 'db-module-missing' };
        var records = normalizeDiscoveryRecords(discoveryRecords);
        var stateRecord = buildStateRecord(state);
        var pairs = [['state', stateRecord]].concat(
          records.map(function (record) {
            return ['discovery', record];
          })
        );
        var strategies = [];

        var stateSave = pickMethod(dbModule, ['saveDiscoveryState', 'saveState', 'putState', 'writeState', 'setState']);
        var discoverySaveMany = pickMethod(dbModule, ['putDiscovery', 'putDiscoveries', 'saveDiscoveries']);
        var discoverySaveOne = pickMethod(dbModule, ['saveDiscovery', 'writeDiscovery', 'addDiscovery']);
        if (stateSave) {
          strategies.push(function () {
            var chain = Promise.resolve();
            if (records.length) {
              if (discoverySaveMany) {
                chain = chain.then(function () {
                  return callMaybeAsync(discoverySaveMany, dbModule, [records]).then(function (raw) {
                    var normalized = normalizeWriteResult(raw);
                    if (!normalized.ok) throw new Error(normalized.error || 'discovery-write-failed');
                  });
                });
              } else if (discoverySaveOne) {
                chain = chain.then(function () {
                  return records.reduce(function (step, record) {
                    return step.then(function () {
                      return callMaybeAsync(discoverySaveOne, dbModule, [record]).then(function (raw) {
                        var normalized = normalizeWriteResult(raw);
                        if (!normalized.ok) throw new Error(normalized.error || 'discovery-write-failed');
                      });
                    });
                  }, Promise.resolve());
                });
              } else {
                chain = chain.then(function () {
                  throw new Error('no-discovery-writer');
                });
              }
            }
            return chain.then(function () {
              /* career-db.saveDiscoveryState 期望发现状态本体（DB 层自己包 {key,value}）。 */
              var payload = stateSave.name === 'saveDiscoveryState' ? state : stateRecord;
              return callMaybeAsync(stateSave, dbModule, [payload]).then(function (raw) {
                var normalized = normalizeWriteResult(raw);
                if (!normalized.ok) throw new Error(normalized.error || 'state-write-failed');
                return { ok: true, method: 'career-db:' + stateSave.name };
              });
            });
          });
        }

        /* 通用 per-store 写：record 形态带 keyPath 字段。 */
        var genericWrite = pickMethod(dbModule, ['put', 'set', 'write', 'upsert']);
        if (genericWrite) {
          strategies.push(function () {
            return chainPairs(pairs, function (store, record) {
              return callMaybeAsync(genericWrite, dbModule, [store, record]);
            });
          });
        }

        /* 原始 IDBDatabase：单事务写入（ADR §7 的原子性要求）。 */
        var idb = rawIdb(dbModule);
        if (idb) {
          strategies.push(function () {
            return idbWrite(idb, pairs);
          });
        }

        return runStrategies(strategies).then(function (result) {
          if (result && result.ok) internal.dbWriteMethod = result.method || 'module-api';
          return result;
        });
      })
      .catch(function (err) {
        warnOnce('db-write', err);
        return { ok: false, error: 'db-write-exception' };
      });
  }

  function writeDbState(state, discoveryRecords, action) {
    /* 多标签/多游戏页并发：优先走 DB 同事务读-合并-写，避免两页都先读旧状态再依次覆盖。
       无 merge 能力的旧 DB/测试注入仍退回普通写入（空 clues 的显式重置也走普通写入）。 */
    var dbModule = readGlobal('db');
    var hasClues = isObject(state) && isObject(state.clues) && Object.keys(state.clues).length > 0;
    /* 普通保存一律同事务合并；显式清空走 db.resetDiscovery，不能靠空 clues 区分。 */
    if (dbModule && typeof dbModule.mergeDiscoveryState === 'function') {
      return Promise.resolve(dbModule.mergeDiscoveryState(state, discoveryRecords, { action: action || null })).catch(function () {
        return { ok: false, error: 'merge-discovery-failed' };
      });
    }
    return Promise.resolve().then(function () {
      var getter = dbModule && pickMethod(dbModule, ['getDiscoveryState', 'getState']);
      if (!getter || !hasClues) return state;
      return callMaybeAsync(getter, dbModule, []).then(function (raw) {
        var existing = unwrapRecord(raw);
        if (!isObject(existing) || !isObject(existing.clues)) return state;
        var merged = Object.assign({}, state);
        merged.clues = Object.assign({}, existing.clues, state.clues);
        return merged;
      }).catch(function () { return state; });
    }).then(function (mergedState) {
      return dbWrite(mergedState, discoveryRecords);
    });
  }

  function unwrapRecord(raw) {
    if (!isObject(raw)) return null;
    if (isObject(raw.result)) return raw.result;
    return raw;
  }

  function idbGet(idb, store, key) {
    return new Promise(function (resolve, reject) {
      try {
        var tx = idb.transaction([store], 'readonly');
        var request = tx.objectStore(store).get(key);
        request.onsuccess = function () {
          resolve(request.result || null);
        };
        request.onerror = function () {
          reject(request.error || new Error('idb-get-error'));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  function readDbStateRecord() {
    return Promise.resolve()
      .then(function () {
        var dbModule = readGlobal('db');
        if (!dbModule) return null;
        /* D15-03 career-db：直接返回发现状态本体（内部行结构 {key,value} 由 DB 层封装）。 */
        var discoveryGetter = pickMethod(dbModule, ['getDiscoveryState']);
        if (discoveryGetter) return callMaybeAsync(discoveryGetter, dbModule, []).then(unwrapRecord);
        var getter = pickMethod(dbModule, ['getState', 'readState', 'loadState', 'fetchState']);
        if (getter) return callMaybeAsync(getter, dbModule, [STATE_KEY]).then(unwrapRecord);
        var generic = pickMethod(dbModule, ['get', 'read', 'load']);
        if (generic) return callMaybeAsync(generic, dbModule, ['state', STATE_KEY]).then(unwrapRecord);
        var idb = rawIdb(dbModule);
        if (idb) return idbGet(idb, 'state', STATE_KEY).then(unwrapRecord);
        return null;
      })
      .catch(function (err) {
        warnOnce('db-read', err);
        return null;
      });
  }

  function resetDb() {
    return Promise.resolve()
      .then(function () {
        var dbModule = readGlobal('db');
        if (!dbModule) return { ok: false, error: 'db-module-missing' };
        var reset = pickMethod(dbModule, ['resetDiscovery', 'clearAll', 'deleteDatabase', 'resetCareer']);
        if (reset) {
          return callMaybeAsync(reset, dbModule, []).then(function (raw) {
            var normalized = normalizeWriteResult(raw);
            return normalized.ok ? { ok: true, method: reset.name } : { ok: false, method: reset.name, error: normalized.error };
          });
        }
        var dbName = dbModule.DB_NAME || dbModule.dbName || dbModule.databaseName || CAREER_DB_NAME;
        var idbFactory = WINDOW.indexedDB;
        if (idbFactory && typeof idbFactory.deleteDatabase === 'function') {
          return new Promise(function (resolve) {
            var settled = false;
            function finish(result) {
              if (settled) return;
              settled = true;
              resolve(result);
            }
            try {
              var request = idbFactory.deleteDatabase(dbName);
              request.onsuccess = function () {
                finish({ ok: true, method: 'indexedDB.deleteDatabase' });
              };
              request.onerror = function () {
                finish({ ok: false, error: 'delete-error' });
              };
              request.onblocked = function () {
                finish({ ok: false, error: 'delete-blocked' });
              };
              setTimeout(function () {
                finish({ ok: false, error: 'delete-timeout' });
              }, 3000);
            } catch (err) {
              finish({ ok: false, error: 'delete-threw' });
            }
          });
        }
        return { ok: false, error: 'reset-api-missing' };
      })
      .catch(function (err) {
        warnOnce('db-reset', err);
        return { ok: false, error: 'db-reset-exception' };
      });
  }

  function loadDiscoveryStateFromDb() {
    var discovery = readGlobal('discovery');
    if (internal.hashTest && !internal.testMode) {
      /* 仅 #test：不读也不写生涯 DB。 */
      internal.discoveryState = fallbackInitialState();
      internal.dbUsable = false;
      return Promise.resolve();
    }
    if (!discovery || typeof discovery.normalizeState !== 'function') {
      internal.discoveryState = fallbackInitialState();
      return Promise.resolve();
    }
    if (internal.hashTest && !internal.testMode) {
      internal.discoveryState = discovery.normalizeState(null);
      return Promise.resolve();
    }
    if (!internal.dbUsable) {
      internal.discoveryState = discovery.normalizeState(null);
      return Promise.resolve();
    }
    return readDbStateRecord().then(function (record) {
      internal.discoveryState = discovery.normalizeState(record || null);
      internal.stateLoadedFromDb = !!record;
    });
  }

  /* ---------------------------------------------------------------- 状态 / 内容快照 */

  function fallbackInitialState() {
    return {
      schemaVersion: 1,
      stage: 'DORMANT',
      firstSourceGame: null,
      firstClueId: null,
      hintsEnabled: true,
      portSeenAt: null,
      careerSignedAt: null,
      explorerAt: null,
      updatedAt: nowIso(),
      clues: {},
      runs: {},
    };
  }

  function currentStateSnapshot() {
    var discovery = readGlobal('discovery');
    var raw = internal.discoveryState;
    if (!raw) {
      if (discovery && typeof discovery.initialState === 'function') return discovery.initialState();
      return fallbackInitialState();
    }
    if (discovery && typeof discovery.normalizeState === 'function') return discovery.normalizeState(raw);
    return clone(raw) || fallbackInitialState();
  }

  function stateSnapshot() {
    return safe(
      'state',
      function () {
        return clone(currentStateSnapshot()) || clone(fallbackInitialState());
      },
      clone(fallbackInitialState())
    );
  }

  function cluesSnapshot() {
    return safe(
      'clues',
      function () {
        return clone(internal.clues) || [];
      },
      []
    );
  }

  function findClue(clueId) {
    if (typeof clueId !== 'string' || !clueId) return null;
    for (var i = 0; i < internal.clues.length; i += 1) {
      if (internal.clues[i] && internal.clues[i].clueId === clueId) return internal.clues[i];
    }
    return null;
  }

  function firstClueForGame(gameId) {
    if (typeof gameId !== 'string' || !gameId) return null;
    for (var i = 0; i < internal.clues.length; i += 1) {
      if (internal.clues[i] && internal.clues[i].gameId === gameId) return internal.clues[i];
    }
    return null;
  }

  /* ---------------------------------------------------------------- 事件缓冲 */

  function sanitizeFlat(value, options) {
    var opts = options || {};
    var maxBytes = opts.maxBytes || PAYLOAD_BYTE_LIMIT;
    var maxKeys = opts.maxKeys || PAYLOAD_MAX_KEYS;
    var filterReserved = opts.filterReserved === true;
    if (value === undefined || value === null) return { ok: true, value: {} };
    if (!isObject(value)) return { ok: false, reason: 'not-object' };
    var keys = Object.keys(value);
    var out = {};
    var used = 0;
    for (var i = 0; i < keys.length && used < maxKeys; i += 1) {
      var key = keys[i];
      if (!key || key.length > 64) continue;
      if (filterReserved && RESERVED_PAYLOAD_KEYS[key]) continue;
      var raw = value[key];
      if (typeof raw === 'string') {
        out[key] = clipText(raw, TEXT_FIELD_LIMIT);
      } else if (typeof raw === 'number' && Number.isFinite(raw)) {
        out[key] = raw;
      } else if (typeof raw === 'boolean') {
        out[key] = raw;
      } else {
        continue;
      }
      var candidate = JSON.stringify(out);
      if (byteLength(candidate) > maxBytes) {
        delete out[key];
        continue;
      }
      used += 1;
    }
    return { ok: true, value: out };
  }

  function normalizeMode(value) {
    if (typeof value !== 'string') return null;
    var mode = value.trim().toLowerCase();
    return VALID_MODES.indexOf(mode) >= 0 ? mode : null;
  }

  function normalizeSourceMode(value) {
    if (typeof value !== 'string') return null;
    var mode = value.trim().toLowerCase();
    return VALID_SOURCE_MODES.indexOf(mode) >= 0 ? mode : null;
  }

  function normalizeOutcome(value) {
    if (typeof value !== 'string') return 'quit';
    var outcome = value.trim().toLowerCase();
    return VALID_OUTCOMES.indexOf(outcome) >= 0 ? outcome : 'quit';
  }

  function watchMapFor(gameId) {
    if (!gameId || !internal.registryInstance) return null;
    var game = null;
    try {
      game = internal.registryInstance.getGame(gameId);
    } catch (err) {
      game = null;
    }
    if (!game) return null;
    var map = {};
    (Array.isArray(game.watch) ? game.watch : []).forEach(function (item) {
      if (!item || typeof item.kind !== 'string' || !item.kind) return;
      map[item.kind] = { modes: Array.isArray(item.modes) ? item.modes.slice() : null };
    });
    return map;
  }

  function eventEnvelopes(finalMode) {
    var mode = finalMode || internal.sourceMode;
    return internal.events.map(function (event) {
      return {
        schemaVersion: 1,
        eventId: internal.runId + ':' + event.seq,
        runId: internal.runId,
        careerRunId: null,
        gameId: api.gameId,
        kind: event.kind,
        stage: 'run',
        seq: event.seq,
        payload: clone(event.payload || {}) || {},
        sourceMode: mode,
      };
    });
  }

  function countEvents(finalMode, eventList) {
    var counts = {};
    var accepted = 0;
    var dropped = 0;
    var list = Array.isArray(eventList) ? eventList : internal.events;
    var watch = api.gameId ? watchMapFor(api.gameId) : null;
    list.forEach(function (event) {
      if (!watch) {
        dropped += 1;
        return;
      }
      var meta = watch[event.kind];
      if (!meta) {
        dropped += 1;
        return;
      }
      if (meta.modes && meta.modes.length && meta.modes.indexOf(finalMode) < 0) {
        dropped += 1;
        return;
      }
      counts[event.kind] = (counts[event.kind] || 0) + 1;
      accepted += 1;
    });
    return { counts: counts, accepted: accepted, dropped: dropped };
  }

  function observe(kind, payload, modeHint) {
    try {
      /* 仅 #test 探针：完全静默（不缓冲、不写库、不发奖励）。 */
      if (isSilentTestOnly()) return false;
      if (typeof kind !== 'string' || !kind || kind.length > 80) return false;
      /* 0.16 职业委托：只进本 run 的委托缓冲，不进发现判定、不渲染微线索。 */
      if (internal.commissionRun) return observeCommission(kind, payload);
      var hint = normalizeSourceMode(typeof modeHint === 'string' ? modeHint : isObject(modeHint) ? modeHint.mode || modeHint.sourceMode : null);
      if (hint) internal.sourceMode = hint;
      /* mow（星海割草）与未知模式不进入任何发现判定。 */
      if (VALID_MODES.indexOf(internal.sourceMode) < 0) return false;
      if (internal.events.length >= EVENT_BUFFER_LIMIT) {
        internal.dropped += 1;
        return false;
      }
      var registryLoaded = !!internal.registryInstance;
      if (registryLoaded) {
        if (!api.gameId) return false;
        var watch = watchMapFor(api.gameId);
        if (!watch || !watch[kind]) return false;
        var modes = watch[kind].modes;
        if (modes && modes.length && modes.indexOf(internal.sourceMode) < 0) return false;
      }
      var clean = sanitizeFlat(payload, { maxBytes: PAYLOAD_BYTE_LIMIT, maxKeys: PAYLOAD_MAX_KEYS, filterReserved: true });
      if (!clean.ok) return false;
      internal.seq += 1;
      internal.events.push({
        kind: kind,
        payload: clean.value,
        seq: internal.seq,
        sourceMode: internal.sourceMode,
        at: nowIso(),
        unverified: !registryLoaded,
      });
      return true;
    } catch (err) {
      warnOnce('observe', err);
      return false;
    }
  }

  function setSourceMode(mode) {
    return safe(
      'set-source-mode',
      function () {
        var normalized = normalizeSourceMode(mode);
        if (!normalized) return false;
        internal.sourceMode = normalized;
        return true;
      },
      false
    );
  }

  /* ---------------------------------------------------------------- 线索渲染 host */

  function isElementVisible(element) {
    try {
      if (!element) return false;
      if (typeof element.isConnected === 'boolean' && !element.isConnected) return false;
      if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false;
      var style = WINDOW.getComputedStyle ? WINDOW.getComputedStyle(element) : null;
      if (style) {
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
        if (String(style.opacity) === '0') return false;
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  function findOverlayAnchor(overlay) {
    if (!overlay) return null;
    for (var i = 0; i < OVERLAY_ANCHOR_SELECTORS.length; i += 1) {
      var selector = OVERLAY_ANCHOR_SELECTORS[i];
      try {
        var found = overlay.querySelector(selector);
        if (found) return found;
      } catch (err) {
        /* 非法选择器：继续 */
      }
    }
    return null;
  }

  function buildOverlayTarget(overlay) {
    return {
      host: overlay,
      placement: 'overlay',
      anchor: findOverlayAnchor(overlay),
    };
  }

  function pageCornerTarget() {
    try {
      var page = DOC.querySelector('.game-page');
      if (page) return { host: page, placement: 'page-corner', anchor: null };
      var overlay = DOC.querySelector('[data-overlay]');
      if (overlay) return { host: overlay, placement: 'page-corner', anchor: null };
    } catch (err) {
      /* ignore */
    }
    return null;
  }

  /**
   * 结算安全点：部分游戏在 ui.show() 之前调用 finish，此时 [data-overlay] 尚不可见。
   * 短轮询（100ms，最多 2s）等待可见 overlay；超时回退 .game-page 右下角。
   */
  function waitForClueHost() {
    var deadline = Date.now() + OVERLAY_WAIT_MS;
    function attempt() {
      var overlay = null;
      try {
        overlay = DOC.querySelector('[data-overlay]');
      } catch (err) {
        overlay = null;
      }
      if (overlay && isElementVisible(overlay)) return Promise.resolve(buildOverlayTarget(overlay));
      if (Date.now() >= deadline) return Promise.resolve(pageCornerTarget());
      return sleep(OVERLAY_POLL_MS).then(attempt);
    }
    return attempt();
  }

  function renderClue(clue, state) {
    return Promise.resolve()
      .then(function () {
        if (!clue || typeof clue.clueId !== 'string' || !clue.clueId) return { rendered: false, reason: 'invalid-clue' };
        if (internal.rendered[clue.clueId]) return { rendered: false, reason: 'duplicate' };
        var surface = readUi('clueSurface');
        if (!surface || typeof surface.render !== 'function') return { rendered: false, reason: 'ui-missing' };
        return waitForClueHost().then(function (target) {
          if (!target) return { rendered: false, reason: 'no-host' };
          internal.rendered[clue.clueId] = true;
          var options = {
            clue: clone(clue),
            onOpen: function () {
              try {
                api.openClue(clue.clueId);
              } catch (err) {
                warnOnce('clue-open', err);
              }
            },
            host: target.host,
            placement: target.placement,
            anchor: target.anchor,
            state: clone(state || stateSnapshot()),
          };
          var returned;
          try {
            returned = surface.render(options);
          } catch (err) {
            warnOnce('clue-render', err);
            return { rendered: false, reason: 'render-threw', placement: target.placement };
          }
          if (returned && typeof returned.then === 'function') {
            return Promise.resolve(returned).then(
              function () {
                return { rendered: true, placement: target.placement };
              },
              function (err) {
                warnOnce('clue-render', err);
                return { rendered: true, placement: target.placement, warned: true };
              }
            );
          }
          return { rendered: true, placement: target.placement };
        });
      })
      .catch(function (err) {
        warnOnce('clue-render', err);
        return { rendered: false, reason: 'exception' };
      });
  }

  /* ---------------------------------------------------------------- finish */

  function summarizeInput(input) {
    var obj = isObject(input) ? input : {};
    return {
      mode: typeof obj.mode === 'string' ? obj.mode : null,
      outcome: typeof obj.outcome === 'string' ? obj.outcome : null,
      hasStats: isObject(obj.stats),
    };
  }

  function makeRunId() {
    var gameId = api.gameId || 'run';
    return gameId + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /**
   * 结算入口：按「每局一次」处理，而不是「每页一次」。
   * 玩家点「再来一局」后在同一页面继续游玩时，后续 finish 会生成新的 runId 并作为新局结算。
   * 防重复：距上次结算 < FINISH_DEBOUNCE_MS 且期间没有新的 observe 事件 → 视为同一结算出口
   * 的重复调用，忽略（不是全局 latch；新事件或被观察到的间隔都会开启新局）。
   * finish 串行排队，避免并发结算交错写库。
   */
  function finish(input) {
    var scheduled = internal.finishQueue.then(function () {
      return safeAsync(
        'finish',
        function () {
          return doFinish(input);
        },
        null
      );
    });
    internal.finishQueue = scheduled.then(
      function () {},
      function () {}
    );
    return scheduled;
  }

  function doFinish(input) {
    /* 仅既有 #test 探针（无 ?careerTest=1）：整体静默，绝不污染 smoke 的存储与 DOM。 */
    if (isSilentTestOnly()) {
      internal.lastFinish = { input: summarizeInput(input), result: null, reason: 'test-silent', at: nowIso(), runId: null };
      return Promise.resolve(null);
    }

    var obj = isObject(input) ? input : {};
    var mode = normalizeMode(obj.mode);
    var outcome = normalizeOutcome(obj.outcome);
    var cleanStats = sanitizeFlat(obj.stats, { maxBytes: PAYLOAD_BYTE_LIMIT, maxKeys: STATS_MAX_KEYS, filterReserved: false });
    var lastInput = {
      mode: typeof obj.mode === 'string' ? obj.mode : null,
      outcome: outcome,
      stats: cleanStats.ok ? cleanStats.value : {},
    };
    internal.lastFinish = { input: lastInput, result: null, reason: null, at: nowIso(), runId: null };

    if (!mode) {
      internal.lastFinish.reason = 'invalid-mode';
      return Promise.resolve(null);
    }

    /* 0.16 职业委托：只结算委托（目标/收据/幂等），不进入发现与线索。 */
    if (internal.commissionRun) {
      var commissionStats = cleanStats.ok ? cleanStats.value : {};
      return settleCommissionRun(mode, outcome, commissionStats);
    }

    /* 防抖：同一结算出口重复调用（<800ms 且没有新的观察事件）只计 1 局。 */
    var startedAt = Date.now();
    var signature = mode + '|' + outcome + '|' + JSON.stringify(lastInput.stats);
    internal.lastFinishSignature = signature;
    if (internal.lastFinishAt && startedAt - internal.lastFinishAt < FINISH_DEBOUNCE_MS && internal.seq === 0) {
      internal.lastFinish.reason = 'duplicate-settle';
      internal.lastFinish.runId = internal.lastRunId;
      return Promise.resolve(null);
    }
    internal.lastFinishAt = startedAt;
    internal.sourceMode = mode;

    /* 新局开始：清掉上一局残留的微线索 chip（避免旧线索挂到新一局结算处）。 */
    var clueSurfaceUi = readUi('clueSurface');
    if (clueSurfaceUi && typeof clueSurfaceUi.clear === 'function') {
      try {
        clueSurfaceUi.clear();
      } catch (err) {
        warnOnce('clue-clear', err);
      }
    }

    /* 每局独立 runId；本局观察事件在结算时消费，eventId = <runId>:<seq> 保持唯一。 */
    var runId = makeRunId();
    internal.runId = runId;
    internal.lastRunId = runId;
    internal.lastFinish.runId = runId;
    internal.finishCount += 1;
    var consumedEvents = internal.events.slice();
    internal.events = [];
    internal.seq = 0;

    return waitReady(READY_TIMEOUT_MS).then(function () {
      if (!api.available) {
        internal.lastFinish.reason = 'unavailable:' + (api.reason || 'unknown');
        return null;
      }
      if (!api.gameId) {
        internal.lastFinish.reason = 'no-game';
        return null;
      }
      if (internal.registryInstance && !internal.registryInstance.getGame(api.gameId)) {
        /* 页面不在注册表里（新游戏尚未注册）：不产生任何生涯发现。 */
        internal.lastFinish.reason = 'game-not-registered';
        return null;
      }
      var discovery = readGlobal('discovery');
      if (!discovery || typeof discovery.reduce !== 'function') {
        internal.lastFinish.reason = 'discovery-missing';
        return null;
      }
      var baseState = discovery.normalizeState(internal.discoveryState || null);
      var events = countEvents(mode, consumedEvents);
      var runSummary = {
        gameId: api.gameId,
        runId: runId,
        mode: mode,
        outcome: outcome,
        events: events.counts,
      };
      internal.runSummary = runSummary;
      var clueConfigs = internal.cluesEnabled ? internal.clues : [];
      var reduced = null;
      try {
        reduced = discovery.reduce(baseState, { type: 'RUN_ENDED', run: runSummary, at: nowIso() }, { clueConfigs: clueConfigs });
      } catch (err) {
        warnOnce('discovery-reduce', err);
        internal.lastFinish.reason = 'reduce-error';
        return null;
      }
      var nextState = reduced && reduced.state ? reduced.state : baseState;
      var clue = reduced && reduced.clue ? reduced.clue : null;
      var alreadyDiscovered = !!(clue && baseState.clues && baseState.clues[clue.clueId]);
      internal.discoveryState = nextState;

      function finalizeResult(persisted) {
        var result = null;
        if (clue) {
          result = {
            clueId: clue.clueId,
            reason: clue.reason,
            clue: clue.clue,
            state: clone(nextState),
            persisted: !!persisted,
          };
        }
        internal.finishedResult = result;
        internal.finished = true;
        internal.lastFinish.result = result;
        return result;
      }

      function afterPersist(persisted) {
        var result = finalizeResult(persisted);
        if (!clue) return result;
        if (!persisted) {
          /* DB 写失败/不可用：返回 clue 结果但绝不渲染（fail-open）。 */
          return result;
        }
        if (alreadyDiscovered) return result;
        if (nextState.hintsEnabled === false) return result;
        /* 玩家已进入生涯：预热 backup.js（D15-14），失败静默。 */
        warmLazyModules();
        return renderClue(clue.clue, nextState).then(function () {
          return result;
        });
      }

      if (!internal.dbUsable) {
        addReason('db-unavailable');
        warnOnce('persist-unavailable', 'db unavailable; clue result kept in memory only');
        return afterPersist(false);
      }
      return writeDbState(nextState, clue ? clue.discovery || null : null, { type: 'RUN_ENDED', run: runSummary, baseRuns: baseState.runs || {} }).then(function (writeResult) {
        var persisted = !!(writeResult && writeResult.ok);
        if (!persisted) {
          addReason('db-write-failed');
          warnOnce('db-write', (writeResult && writeResult.error) || 'write-failed');
        }
        return afterPersist(persisted);
      });
    });
  }

  /* ---------------------------------------------------------------- 其余公开方法 */

  function saveState(nextState) {
    return safeAsync(
      'save-state',
      function () {
        return waitReady(READY_TIMEOUT_MS).then(function () {
          if (!isObject(nextState)) return { ok: false, error: 'invalid-state' };
          var discovery = readGlobal('discovery');
          var normalized = discovery && typeof discovery.normalizeState === 'function' ? discovery.normalizeState(nextState) : clone(nextState);
          internal.discoveryState = normalized;
          if (isSilentTestOnly()) return { ok: false, error: 'test-silent' };
          if (!internal.dbUsable) return { ok: false, error: 'db-unavailable' };
          return writeDbState(normalized, null).then(function (writeResult) {
            return writeResult && writeResult.ok ? { ok: true } : { ok: false, error: (writeResult && writeResult.error) || 'write-failed' };
          });
        });
      },
      { ok: false, error: 'exception' }
    );
  }

  function setHintsEnabled(enabled) {
    return safeAsync(
      'set-hints',
      function () {
        var wanted = enabled !== false;
        /* 未 ready 时排队（等待 ready，而不是丢弃）。 */
        return waitReady(READY_TIMEOUT_MS).then(function () {
          var discovery = readGlobal('discovery');
          var current = currentStateSnapshot();
          var next = current;
          if (discovery && typeof discovery.reduce === 'function') {
            try {
              var reduced = discovery.reduce(current, { type: 'SET_HINTS', enabled: wanted, at: nowIso() });
              if (reduced && reduced.state) next = reduced.state;
            } catch (err) {
              warnOnce('set-hints-reduce', err);
            }
          }
          next.hintsEnabled = wanted;
          internal.discoveryState = next;
          var settings = readUi('settings');
          if (settings && typeof settings.apply === 'function') {
            try {
              settings.apply({
                hintsEnabled: wanted,
                state: clone(next),
                backup: backupFacade(),
                reducedMotion: reducedMotionPreferred(),
                api: api,
              });
            } catch (err) {
              warnOnce('settings-apply', err);
            }
          }
          if (isSilentTestOnly() || !internal.dbUsable) return wanted;
          return writeDbState(next, null, { type: 'SET_HINTS' }).then(function (writeResult) {
            if (!writeResult || !writeResult.ok) warnOnce('db-write', (writeResult && writeResult.error) || 'write-failed');
            return wanted;
          });
        });
      },
      false
    );
  }

  /* UI 未加载/静默时的统一结构化返回（lead 冻结：openMailbox/openClue/openSettings）。 */
  function uiUnavailable(reason) {
    return { ok: false, reason: reason || 'ui-unavailable' };
  }

  function reducedMotionPreferred() {
    try {
      return !!(WINDOW.matchMedia && WINDOW.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (err) {
      return false;
    }
  }

  /** 记录已读（CLUE_OPENED）——供信箱内部调用；不再打开 UI，避免递归。 */
  function markClueOpened(clueId) {
    return safe(
      'mark-clue-opened',
      function () {
        var id = typeof clueId === 'string' ? clueId : isObject(clueId) && typeof clueId.clueId === 'string' ? clueId.clueId : '';
        if (!id) return { ok: false, reason: 'invalid-clue-id' };
        var state = currentStateSnapshot();
        if (!isObject(state.clues) || !state.clues[id]) return { ok: false, reason: 'not-discovered' };
        var discovery = readGlobal('discovery');
        if (discovery && typeof discovery.reduce === 'function') {
          try {
            var reduced = discovery.reduce(state, { type: 'CLUE_OPENED', clueId: id, at: nowIso() });
            if (reduced && reduced.state) {
              internal.discoveryState = reduced.state;
              if (internal.dbUsable) {
                writeDbState(reduced.state, null, { type: 'CLUE_OPENED' }).then(function (writeResult) {
                  if (!writeResult || !writeResult.ok) warnOnce('db-write', (writeResult && writeResult.error) || 'write-failed');
                });
              }
            }
          } catch (err) {
            warnOnce('open-clue-reduce', err);
          }
        }
        return { ok: true, clueId: id };
      },
      { ok: false, reason: 'exception' }
    );
  }

  /** 投递信件（LETTER_FOLLOWED）：标记 LOCAL 并持久化；返回 {ok}，信箱据此显示告示。 */
  function followLetter() {
    return safeAsync(
      'follow-letter',
      function () {
        var discovery = readGlobal('discovery');
        var state = currentStateSnapshot();
        var next = state;
        if (discovery && typeof discovery.reduce === 'function') {
          try {
            var reduced = discovery.reduce(state, { type: 'LETTER_FOLLOWED', at: nowIso() });
            if (reduced && reduced.state) next = reduced.state;
          } catch (err) {
            warnOnce('follow-letter-reduce', err);
          }
        }
        next.portSeenAt = next.portSeenAt || nowIso();
        internal.discoveryState = next;
        if (!internal.dbUsable || isSilentTestOnly()) {
          return Promise.resolve({ ok: true, persisted: false, portSeenAt: next.portSeenAt, stage: next.stage });
        }
        return writeDbState(next, null, { type: 'LETTER_FOLLOWED' }).then(function (writeResult) {
          var persisted = !!(writeResult && writeResult.ok);
          if (!persisted) warnOnce('db-write', (writeResult && writeResult.error) || 'write-failed');
          return { ok: persisted, persisted: persisted, portSeenAt: next.portSeenAt, stage: next.stage };
        });
      },
      { ok: false, reason: 'exception' }
    );
  }

  /** 读屏/轻提示：优先引擎 A.showToast，否则退到隐藏 aria-live 区域；都没有则不报错。 */
  function announceToUser(text) {
    return safe(
      'announce',
      function () {
        var message = typeof text === 'string' ? text : '';
        if (!message) return false;
        var arcade = WINDOW.Arcade;
        if (arcade && typeof arcade.showToast === 'function') {
          try {
            arcade.showToast(message);
            return true;
          } catch (err) {
            warnOnce('announce-toast', err);
          }
        }
        var region = internal.liveRegion;
        if (!region || (typeof region.isConnected === 'boolean' && !region.isConnected)) {
          region = DOC.createElement('div');
          region.setAttribute('role', 'status');
          region.setAttribute('aria-live', 'polite');
          region.setAttribute('aria-atomic', 'true');
          region.style.position = 'absolute';
          region.style.width = '1px';
          region.style.height = '1px';
          region.style.overflow = 'hidden';
          region.style.clip = 'rect(0 0 0 0)';
          region.style.whiteSpace = 'nowrap';
          (DOC.body || DOC.documentElement).appendChild(region);
          internal.liveRegion = region;
        }
        try {
          region.textContent = '';
        } catch (err) {
          /* ignore */
        }
        setTimeout(function () {
          try {
            region.textContent = message;
          } catch (err) {
            /* ignore */
          }
        }, 30);
        return true;
      },
      false
    );
  }

  /** settings「确认清除本机线索记录」：清 discovery（不碰钱包/身份），返回 {ok,error?}。 */
  function uiResetDiscovery() {
    return safeAsync(
      'reset-discovery-ui',
      function () {
        if (isSilentTestOnly()) return { ok: false, error: 'test-silent' };
        var discovery = readGlobal('discovery');
        internal.events = [];
        internal.seq = 0;
        internal.finished = false;
        internal.finishedResult = null;
        internal.rendered = {};
        internal.discoveryState = discovery && typeof discovery.initialState === 'function' ? discovery.initialState() : fallbackInitialState();
        var surface = readUi('clueSurface');
        if (surface && typeof surface.clear === 'function') {
          try {
            surface.clear();
          } catch (err) {
            warnOnce('clue-clear', err);
          }
        }
        if (!internal.dbUsable) return { ok: false, error: 'db-unavailable', state: stateSnapshot() };
        return resetDb().then(function (result) {
          var ok = !!(result && result.ok);
          return {
            ok: ok,
            error: ok ? null : (result && (result.error || result.method)) || 'reset-failed',
            method: (result && result.method) || null,
            state: stateSnapshot(),
          };
        });
      },
      { ok: false, error: 'exception' }
    );
  }

  /** bridge 传给 UI 模块的统一上下文（mailbox/settings 只读消费，缺字段按空处理）。 */
  function uiContext(extra) {
    var context = {
      state: stateSnapshot(),
      clues: cluesSnapshot(),
      originIntro: originIntro,
      openClue: markClueOpened,
      followLetter: followLetter,
      setHintsEnabled: setHintsEnabled,
      resetDiscovery: uiResetDiscovery,
      announce: announceToUser,
      backup: backupFacade(),
      reducedMotion: reducedMotionPreferred(),
      api: api,
      commission: commissionModule() || null,
      alternatives: readGlobal('alternatives') || null,
      rental: readGlobal('rental') || null,
      materials: readGlobal('materials') || null,
      crafting: readGlobal('crafting') || null,
      professions: readGlobal('professions') || null,
      storyEvidence: readGlobal('storyEvidence') || null,
      routePlanner: readGlobal('routePlanner') || null,
      campaign: readGlobal('campaign') || null,
      ending: readGlobal('ending') || null,
      npc: internal.npcContent ? clone(internal.npcContent) : null,
      sideStories: internal.sideStoriesContent ? clone(internal.sideStoriesContent) : null,
      chapters: internal.chapterFiles ? clone(internal.chapterFiles) : null,
      openCampaign: openCampaign,
      startEnding: startEnding,
      openMarket: openMarket,
      openWorkshop: openWorkshop,
      commissionRun: internal.commissionRun ? clone(internal.commissionRun) : null,
      commissions: internal.commissionContent ? clone(internal.commissionContent) : null,
      items: internal.itemsContent ? clone(internal.itemsContent) : null,
      chapter: internal.chapterContent ? clone(internal.chapterContent) : null,
      openTown: openTown,
      openMailbox: openMailbox,
      openHangar: openHangar,
      openReceipt: openReceipt,
    };
    if (isObject(extra)) {
      Object.keys(extra).forEach(function (key) {
        context[key] = extra[key];
      });
    }
    return context;
  }

  function openMailbox() {
    return Promise.resolve(safe(
      'open-mailbox',
      function () {
        if (isSilentTestOnly()) return uiUnavailable('test-silent');
        warmLazyModules();
        var mailbox = readUi('mailbox');
        if (!mailbox) return uiUnavailable('ui-unavailable');
        var target = typeof mailbox.open === 'function' ? mailbox.open : typeof mailbox.show === 'function' ? mailbox.show : null;
        if (!target) return uiUnavailable('ui-unavailable');
        try {
          var returned = target.call(mailbox, uiContext());
          if (returned && typeof returned.then === 'function') {
            Promise.resolve(returned).catch(function (err) {
              warnOnce('open-mailbox', err);
            });
          }
        } catch (err) {
          warnOnce('open-mailbox', err);
          return uiUnavailable('ui-error');
        }
        return { ok: true };
      },
      uiUnavailable('ui-unavailable')
    )).then(function (result) {
      /* 信箱是 C0 的真实入口：确保章节模块/内容就绪后再补旗标。 */
      return Promise.all([ensureLazyModule('campaign'), loadCareerContent()])
        .then(function () {
          configureCareerModules();
          return syncCampaignFlags(true);
        })
        .catch(function () {})
        .then(function () {
          return result;
        });
    });
  }

  /** 线索提示偏好入口：信箱角落的「线索提示」调用（settings 面板由 D15-07 实现）。 */
  function openSettings() {
    return safe(
      'open-settings',
      function () {
        if (isSilentTestOnly()) return uiUnavailable('test-silent');
        warmLazyModules();
        var settings = readUi('settings');
        if (!settings) return uiUnavailable('ui-unavailable');
        var target = typeof settings.open === 'function' ? settings.open : typeof settings.show === 'function' ? settings.show : null;
        if (!target) return uiUnavailable('ui-unavailable');
        try {
          var returned = target.call(settings, uiContext({ hintsEnabled: currentStateSnapshot().hintsEnabled !== false }));
          if (returned && typeof returned.then === 'function') {
            Promise.resolve(returned).catch(function (err) {
              warnOnce('open-settings', err);
            });
          }
        } catch (err) {
          warnOnce('open-settings', err);
          return uiUnavailable('ui-error');
        }
        return { ok: true };
      },
      uiUnavailable('ui-unavailable')
    );
  }

  /** 0.16 D16-07：租机模块按需装载并注入 items + 本标签页 storage（不落 DB）。 */
  function configureRentalModule() {
    return ensureLazyModule('rental')
      .then(function (mod) {
        return loadCareerContent().then(function () {
          if (mod && typeof mod.configure === 'function') {
            mod.configure({ items: internal.itemsContent || null, storage: readStorage('sessionStorage') });
          }
          if (mod) api.rental = mod;
          return mod;
        });
      })
      .catch(function () {
        return null;
      });
  }

  /** 0.16：港口告示板/飞船商店/钱包收据入口；UI 缺失时结构化失败，不做替代渲染。 */
  /** 章节/信箱打开前的只读剧情快照：真实 quests/wallet/equipment（失败不阻塞 UI）。 */
  function loadStorySnapshot() {
    var db = api.db || readGlobal('db');
    var careerId = internal.commissionLastCareerId || null;
    if (!db) {
      return Promise.resolve({ careerId: careerId, quests: [], claims: [], profile: null, wallet: null, equipment: null });
    }
    function read(careerIdValue) {
      var safeCall = function (fn) {
        try {
          return Promise.resolve(fn()).catch(function () { return null; });
        } catch (err) {
          return Promise.resolve(null);
        }
      };
      return Promise.resolve()
        .then(function () {
          if (!careerIdValue || typeof db.repairEndingRecords !== 'function') return null;
          return safeCall(function () { return db.repairEndingRecords({ careerId: careerIdValue }); });
        })
        .then(function () {
          return Promise.all([
            careerIdValue ? safeCall(function () { return db.readQuestState(careerIdValue); }) : Promise.resolve(null),
            careerIdValue ? safeCall(function () { return db.readWallet(careerIdValue); }) : Promise.resolve(null),
            careerIdValue ? safeCall(function () { return db.getEquipment(careerIdValue); }) : Promise.resolve(null),
          ]);
        })
        .then(function (values) {
        var questState = values[0];
        var wallet = values[1];
        var equipment = values[2];
        return {
          careerId: careerIdValue,
          quests: questState && Array.isArray(questState.quests) ? questState.quests : [],
          claims: [],
          profile: null,
          wallet: wallet && wallet.ok ? { credits: wallet.credits, items: wallet.items || {} } : null,
          equipment: equipment && equipment.ok ? equipment.equipment || {} : null,
        };
      });
    }
    if (careerId) return read(careerId);
    /* ?story=1 等直接打开章节时没有 run 指针：解析已存在的生涯（不新建空内容）。 */
    if (typeof db.ensureCareer !== 'function') return read(null);
    return Promise.resolve(db.ensureCareer({}))
      .then(function (career) {
        if (career && career.careerId) {
          internal.commissionLastCareerId = career.careerId;
          return read(career.careerId);
        }
        return read(null);
      })
      .catch(function () { return read(null); });
  }

  /** 打开信箱/告示板后同步 C0/C1 章节旗标（幂等；缺模块/DB 时静默）。 */
  function syncCampaignFlags(mailboxOpened) {
    var mod = readGlobal('campaign');
    var db = api.db || readGlobal('db');
    if (!mod || typeof mod.syncFlags !== 'function' || !db || typeof db.ensureCareer !== 'function') return null;
    try {
      return Promise.resolve(db.ensureCareer({}))
        .then(function (career) {
          if (!career || !career.careerId) return null;
          internal.commissionLastCareerId = career.careerId;
          return mod.syncFlags({ careerId: career.careerId, db: db, mailboxOpened: mailboxOpened === true });
        })
        .catch(function (err) {
          warnOnce('campaign-sync', err);
          return null;
        });
    } catch (err) {
      warnOnce('campaign-sync', err);
      return null;
    }
  }

  /** 备份模块门面：导入成功后立即把 DB 恢复结果同步回当前页内存，避免旧快照覆盖恢复数据。 */
  function backupFacade(source) {
    var mod = source || readGlobal('backup');
    if (!mod) return null;
    if (mod.__bridgeFacade === true) return mod;
    var api = {};
    Object.keys(mod).forEach(function (key) { api[key] = mod[key]; });
    api.importCareerLife = function (text, opts) {
      return Promise.resolve(mod.importCareerLife(text, opts)).then(function (result) {
        if (!result || result.ok === false) return result;
        /* 替换导入可能换生涯：同步当前页缓存的 careerId，章节/任务面板不能继续读旧生涯。 */
        var db = readGlobal('db');
        var ensure = db && pickMethod(db, ['ensureCareer']);
        var syncCareer = ensure
          ? Promise.resolve(callMaybeAsync(ensure, db, [{}])).then(function (raw) {
              var career = unwrapRecord(raw);
              if (career && typeof career.careerId === 'string' && career.careerId) {
                internal.commissionLastCareerId = career.careerId;
              }
            }).catch(function () {})
          : Promise.resolve();
        return syncCareer
          .then(function () { return loadDiscoveryStateFromDb(); })
          .then(function () { return result; });
      });
    };
    api.__bridgeFacade = true;
    return api;
  }

  /** 真实读信入口（openClue/openMailbox）统一补 C0：先确保章节模块/内容就绪，失败静默。 */
  function syncCampaignAtMailbox() {
    return Promise.all([ensureLazyModule('campaign'), loadCareerContent()])
      .then(function () {
        configureCareerModules();
        return syncCampaignFlags(true);
      })
      .catch(function () { return null; });
  }

  function openCareerUi(name, extra) {
    if (isSilentTestOnly()) return uiUnavailable('test-silent');
    warmLazyModules();
    /* town/hangar/receipt 都需要 commission-core 与委托目录在 ctx 里可用；机库还需要租机模块，
       商店需要材料模块，制造台需要制造模块。 */
    var extraModules = [];
    if (name === 'market') extraModules.push('materials');
    if (name === 'workshop') {
      extraModules.push('crafting');
      extraModules.push('materials');
    }
    if (name === 'worldState') {
      extraModules.push('campaign');
      extraModules.push('ending');
    }
    if (name === 'mailbox' || name === 'town') {
      extraModules.push('campaign');
      extraModules.push('ending');
    }
    var preloadList = [ensureLazyModule('commission'), ensureLazyModule('alternatives'), loadCareerContent()];
    extraModules.forEach(function (moduleName) {
      preloadList.push(ensureLazyModule(moduleName));
    });
    var preload = Promise.all(preloadList).then(function () {
      configureCommissionContent();
      configureCareerModules();
      return configureRentalModule();
    }).then(function () {
      if (name !== 'worldState' && name !== 'mailbox' && name !== 'town') return null;
      return loadStorySnapshot();
    });
    return preload.then(function (storySnapshot) {
      var uiModule = readUi(name);
      if (!uiModule) {
        return ensureLazyModule(name).then(function (loaded) {
          if (!loaded) return uiUnavailable('ui-unavailable');
          return openCareerUi(name, extra);
        });
      }
      return safe(
        'open-career-ui:' + name,
        function () {
          var target = typeof uiModule.open === 'function' ? uiModule.open : typeof uiModule.show === 'function' ? uiModule.show : null;
          if (!target) return uiUnavailable('ui-unavailable');
          var context = uiContext({
            commission: commissionModule() || null,
            alternatives: readGlobal('alternatives') || null,
            rental: readGlobal('rental') || null,
            materials: readGlobal('materials') || null,
            crafting: readGlobal('crafting') || null,
            professions: readGlobal('professions') || null,
            storyEvidence: readGlobal('storyEvidence') || null,
            campaignState: storySnapshot || null,
            quests: storySnapshot ? storySnapshot.quests : null,
            claims: storySnapshot ? storySnapshot.claims : null,
            profile: storySnapshot ? storySnapshot.profile : null,
            wallet: storySnapshot ? storySnapshot.wallet : null,
            careerId: storySnapshot ? storySnapshot.careerId : null,
            routePlanner: readGlobal('routePlanner') || null,
            campaign: readGlobal('campaign') || null,
            ending: readGlobal('ending') || null,
            openCampaign: openCampaign,
            startEnding: startEnding,
            openMarket: openMarket,
            openWorkshop: openWorkshop,
            commissionRun: internal.commissionRun ? clone(internal.commissionRun) : null,
            commissions: internal.commissionContent ? clone(internal.commissionContent) : null,
            items: internal.itemsContent ? clone(internal.itemsContent) : null,
            chapter: internal.chapterContent ? clone(internal.chapterContent) : null,
            openTown: openTown,
            openHangar: openHangar,
            openReceipt: openReceipt,
            openSettings: openSettings,
          });
          if (isObject(extra)) {
            Object.keys(extra).forEach(function (key) {
              context[key] = extra[key];
            });
          }
          try {
            var returned = target.call(uiModule, context);
            if (returned && typeof returned.then === 'function') {
              Promise.resolve(returned).catch(function (err) {
                warnOnce('open-career-ui', err);
              });
            }
          } catch (err) {
            warnOnce('open-career-ui', err);
            return uiUnavailable('ui-error');
          }
          return { ok: true };
        },
        uiUnavailable('ui-unavailable')
      );
    }).then(function (result) {
      if (name === 'mailbox') syncCampaignFlags(true);
      else if (name === 'town') syncCampaignFlags(false);
      return result;
    });
  }

  function openTown() {
    return openCareerUi('town');
  }

  function openHangar() {
    return openCareerUi('hangar');
  }

  function openReceipt() {
    return openCareerUi('receipt');
  }

  function openMarket() {
    return openCareerUi('market');
  }

  function openWorkshop() {
    return openCareerUi('workshop');
  }

  function openCampaign() {
    return openCareerUi('worldState');
  }

  function startEnding(approach) {
    /* 任何入口（告示板/章节面板）都必须能在未预载时懒加载终局模块。 */
    return Promise.all([ensureLazyModule('ending'), loadCareerContent()])
      .then(function () {
        configureCareerModules();
        var endingModule = readGlobal('ending');
        if (!endingModule || typeof endingModule.startEnding !== 'function') {
          return { ok: false, reason: 'ending-module-missing' };
        }
        return endingModule.startEnding({ approach: approach, careerId: internal.commissionLastCareerId || null });
      })
      .then(function (result) {
        if (result && result.ok && result.url) {
          try {
            if (WINDOW && WINDOW.location && typeof WINDOW.location.assign === 'function') WINDOW.location.assign(result.url);
          } catch (err) {
            warnOnce('ending-navigate', err);
          }
        }
        return result;
      })
      .catch(function (err) {
        warnOnce('ending-start', err);
        return { ok: false, reason: 'ending-error' };
      });
  }

  /** 0.16：职业 run 的只读装备/钱包快照，供星海生涯战斗读取（不写库、不改旧机库）。 */
  function getCommissionLoadout() {
    return safeAsync(
      'commission-loadout',
      function () {
        var dbModule = readGlobal('db');
        var run = internal.commissionRun;
        if (!dbModule || !run) return Promise.resolve({ ok: false, reason: 'no-commission-run' });
        var tasks = [];
        tasks.push(
          typeof dbModule.getEquipment === 'function'
            ? Promise.resolve(dbModule.getEquipment(run.careerId)).catch(function () {
                return { ok: false };
              })
            : Promise.resolve({ ok: false, reason: 'no-get-equipment' })
        );
        tasks.push(
          typeof dbModule.readWallet === 'function'
            ? Promise.resolve(dbModule.readWallet(run.careerId)).catch(function () {
                return { ok: false };
              })
            : Promise.resolve({ ok: false, reason: 'no-read-wallet' })
        );
        return Promise.all(tasks).then(function (list) {
          var equipment = list[0] && list[0].ok && isObject(list[0].equipment) ? list[0].equipment : {};
          var wallet = list[1] && list[1].ok ? list[1] : { ok: false };
          return {
            ok: true,
            careerId: run.careerId,
            equipment: clone(equipment),
            rentalShipId: run.rentalShipId || null,
            wallet: { credits: wallet.credits || 0, items: clone(wallet.items || {}), equipment: clone(wallet.equipment || {}) },
          };
        });
      },
      Promise.resolve({ ok: false, reason: 'exception' })
    );
  }

  function openClue(clueId) {
    return Promise.resolve(safe(
      'open-clue',
      function () {
        if (typeof clueId !== 'string' || !clueId) return uiUnavailable('invalid-clue-id');
        if (isSilentTestOnly()) return uiUnavailable('test-silent');
        var clue = findClue(clueId);
        if (!clue) return uiUnavailable('unknown-clue');
        warmLazyModules();
        var state = currentStateSnapshot();
        if (!isObject(state.clues) || !state.clues[clueId]) return uiUnavailable('not-discovered');
        var marked = markClueOpened(clueId);
        var mailbox = readUi('mailbox');
        var surface = readUi('clueSurface');
        var targetHost = null;
        if (mailbox && (typeof mailbox.openClue === 'function' || typeof mailbox.open === 'function')) targetHost = mailbox;
        else if (surface && typeof surface.openClue === 'function') targetHost = surface;
        if (!targetHost) {
          /* 线索内容仍标记已读，只是没有可打开的 UI。 */
          return marked && marked.ok === true ? uiUnavailable('ui-unavailable') : marked;
        }
        var context = uiContext({ clue: clone(clue), clueId: clueId });
        try {
          var returned = null;
          if (typeof targetHost.openClue === 'function') returned = targetHost.openClue(clueId, context);
          else returned = targetHost.open(context);
          if (returned && typeof returned.then === 'function') {
            Promise.resolve(returned).catch(function (err) {
              warnOnce('open-clue-ui', err);
            });
          }
        } catch (err) {
          warnOnce('open-clue-ui', err);
          return uiUnavailable('ui-error');
        }
        return { ok: true, clueId: clueId };
      },
      uiUnavailable('ui-unavailable')
    )).then(function (result) {
      /* 线索 chip 打开信箱是玩家的真实读信入口：成功打开后才补一次 C0（syncFlags 幂等）。 */
      if (result && result.ok === true) syncCampaignAtMailbox();
      return result;
    });
  }

  /**
   * 首源短文案入口：只从 clues.json 派生（entry-router），地址取首条线索 letter.address。
   * 无首条线索（或内容缺失）返回 null（lead 冻结）。
   */
  function originIntro() {
    return safe(
      'origin-intro',
      function () {
        var state = currentStateSnapshot();
        if (!isObject(state)) return null;
        var clue = null;
        if (typeof state.firstClueId === 'string' && state.firstClueId) clue = findClue(state.firstClueId);
        if (!clue && typeof state.firstSourceGame === 'string' && state.firstSourceGame) clue = firstClueForGame(state.firstSourceGame);
        if (!clue) return null;
        var entryRouter = readGlobal('entryRouter');
        if (!entryRouter || typeof entryRouter.entryForClue !== 'function') return null;
        var entry = null;
        try {
          entry = entryRouter.entryForClue(clue, state);
        } catch (err) {
          warnOnce('origin-intro', err);
          return null;
        }
        if (!entry) return null;
        return {
          sourceGame: entry.sourceGame,
          greeting: entry.greeting,
          address: entry.address == null ? null : entry.address,
        };
      },
      null
    );
  }

  function info() {
    return safe(
      'info',
      function () {
        return {
          version: VERSION,
          gameId: api.gameId || null,
          available: !!api.available,
          reason: api.reason || null,
          base: internal.base,
          careerDir: internal.careerDir,
          testMode: internal.testMode,
          hashTest: internal.hashTest,
          silentTestOnly: isSilentTestOnly(),
          loadedScripts: clone(internal.loadedScripts) || {},
          loadErrors: clone(internal.loadErrors) || [],
          deferredModules: clone(internal.deferredModules) || [],
          cluesEnabled: internal.cluesEnabled,
          clueCount: internal.clues.length,
          uiLoaded: {
            clueSurface: !!readUi('clueSurface'),
            mailbox: !!readUi('mailbox'),
            settings: !!readUi('settings'),
            town: !!readUi('town'),
            hangar: !!readUi('hangar'),
            receipt: !!readUi('receipt'),
          },
          commissionRun: internal.commissionRun ? clone(internal.commissionRun) : null,
          commissionContent: internal.commissionContent ? internal.commissionContent.commissions.length : 0,
          commissionEvents: internal.commissionSeq,
          commissionLastResult: internal.commissionLastResult ? clone(internal.commissionLastResult) : null,
          commissionModuleLoaded: !!commissionModule(),
          backupLoaded: !!readGlobal('backup'),
          dbLoaded: internal.dbLoaded,
          dbUsable: internal.dbUsable,
          dbWriteMethod: internal.dbWriteMethod,
          stateLoadedFromDb: internal.stateLoadedFromDb,
          eventCount: internal.events.length,
          droppedEvents: internal.dropped,
          sourceMode: internal.sourceMode,
          finished: internal.finished,
          finishCount: internal.finishCount,
          lastFinishAt: internal.lastFinishAt || null,
          lastRunId: internal.lastRunId,
          warnings: clone(internal.warnings) || [],
        };
      },
      { version: VERSION }
    );
  }

  /* ---------------------------------------------------------------- 测试钩子（仅 ?careerTest=1） */

  function simulateRun(summary) {
    return safe(
      'simulate-run',
      function () {
        var discovery = readGlobal('discovery');
        if (!discovery || typeof discovery.evaluateRun !== 'function') return null;
        var input = isObject(summary) ? summary : {};
        var mode = normalizeMode(input.mode) || 'classic';
        var events = isObject(input.events) ? clone(input.events) : Array.isArray(input.events) ? clone(input.events) : {};
        var runSummary = {
          gameId: typeof input.gameId === 'string' && input.gameId ? input.gameId : api.gameId,
          runId: typeof input.runId === 'string' && input.runId ? input.runId : 'sim-' + (internal.seq + 1) + '-' + Date.now().toString(36),
          mode: mode,
          outcome: normalizeOutcome(input.outcome),
          events: events,
        };
        var snapshot = currentStateSnapshot();
        return clone(
          discovery.evaluateRun({
            state: snapshot,
            clueConfigs: internal.clues,
            runSummary: runSummary,
            hintsEnabled: snapshot.hintsEnabled !== false,
            now: nowIso(),
          })
        );
      },
      null
    );
  }

  function seedState(patch) {
    return safeAsync(
      'seed-state',
      function () {
        return waitReady(READY_TIMEOUT_MS).then(function () {
          var discovery = readGlobal('discovery');
          if (!discovery || typeof discovery.normalizeState !== 'function') return { ok: false, error: 'discovery-missing' };
          var merged = isObject(patch) ? clone(patch) : {};
          var base = clone(currentStateSnapshot()) || fallbackInitialState();
          Object.keys(merged).forEach(function (key) {
            base[key] = merged[key];
          });
          if (isObject(merged.clues)) base.clues = clone(merged.clues);
          var normalized = discovery.normalizeState(base);
          internal.discoveryState = normalized;
          var records = Object.keys(normalized.clues || {}).map(function (clueId) {
            return normalized.clues[clueId];
          });
          if (!internal.dbUsable) return { ok: true, persisted: false, state: clone(normalized) };
          return writeDbState(normalized, records.length ? records : null).then(function (writeResult) {
            var persisted = !!(writeResult && writeResult.ok);
            return {
              ok: persisted,
              persisted: persisted,
              error: persisted ? null : (writeResult && writeResult.error) || 'write-failed',
              state: clone(normalized),
            };
          });
        });
      },
      { ok: false, error: 'exception' }
    );
  }

  function resetAll() {
    return safeAsync(
      'reset-all',
      function () {
        return waitReady(READY_TIMEOUT_MS).then(function () {
          internal.events = [];
          internal.seq = 0;
          internal.dropped = 0;
          internal.finished = false;
          internal.finishedResult = null;
          internal.runSummary = null;
          internal.lastFinish = null;
          internal.lastFinishAt = 0;
          internal.lastFinishSignature = null;
          internal.lastRunId = null;
          internal.finishCount = 0;
          internal.runId = newRunId();
          internal.rendered = {};
          var discovery = readGlobal('discovery');
          internal.discoveryState = discovery && typeof discovery.initialState === 'function' ? discovery.initialState() : fallbackInitialState();
          internal.stateLoadedFromDb = false;
          return resetDb().then(function (resetResult) {
            return {
              ok: !!(resetResult && resetResult.ok),
              method: (resetResult && resetResult.method) || null,
              error: (resetResult && resetResult.error) || null,
              state: stateSnapshot(),
            };
          });
        });
      },
      { ok: false, error: 'exception' }
    );
  }

  function renderDebug(clueOrId) {
    return safeAsync(
      'render-debug',
      function () {
        var clue = typeof clueOrId === 'string' ? findClue(clueOrId) : clueOrId;
        if (!isObject(clue) || typeof clue.clueId !== 'string' || !clue.clueId) return { rendered: false, reason: 'unknown-clue' };
        return renderClue(clue, currentStateSnapshot());
      },
      { rendered: false, reason: 'exception' }
    );
  }

  function installTestApi() {
    if (!internal.testMode) return;
    internal.testApi = {
      ready: readyPromise,
      state: stateSnapshot,
      clues: cluesSnapshot,
      simulateRun: simulateRun,
      seedState: seedState,
      resetAll: resetAll,
      lastFinish: function () {
        return clone(internal.lastFinish);
      },
      registry: function () {
        return internal.registryInstance || null;
      },
      db: function () {
        return readGlobal('db') || null;
      },
      setHintsEnabled: setHintsEnabled,
      openMailbox: openMailbox,
      /* 以下为 QA 诊断用的追加钩子（仅 ?careerTest=1 暴露，生产 URL 不存在）。 */
      info: info,
      events: function () {
        return clone(internal.events) || [];
      },
      envelopes: function () {
        return clone(eventEnvelopes(internal.sourceMode)) || [];
      },
      runSummary: function () {
        return clone(internal.runSummary);
      },
      setSourceMode: setSourceMode,
      originIntro: originIntro,
      renderDebug: renderDebug,
      /* 0.16 职业委托测试钩子（仅 ?careerTest=1）。 */
      commissionRun: function () {
        return internal.commissionRun ? clone(internal.commissionRun) : null;
      },
      commissionState: function () {
        var mod = commissionModule();
        if (!mod || typeof mod.getState !== 'function') return null;
        try {
          return clone(mod.getState());
        } catch (err) {
          return null;
        }
      },
      settleNow: function (outcome) {
        return finish({ mode: 'classic', outcome: outcome || 'lost', stats: {} });
      },
      openTown: openTown,
      openHangar: openHangar,
      openReceipt: openReceipt,
    };
    try {
      WINDOW.__arcadeCareerTest = internal.testApi;
    } catch (err) {
      warnOnce('install-test-api', err);
    }
  }

  /* ---------------------------------------------------------------- boot */

  function finalizeReady() {
    try {
      api.gameId = api.gameId || null;
      api.reason = api.available ? null : internal.reason || 'unavailable';
      resolveReady({ available: !!api.available, reason: api.available ? undefined : api.reason });
      /* 中心页「旧港来信」回流入口：?story=1 时自动打开章节面板（仅真实 C0 后才有内容）。 */
      try {
        if (WINDOW && WINDOW.location && /(?:^|[?&])story=1(?:&|$)/.test(WINDOW.location.search || '')) {
          Promise.resolve().then(function () { return openCampaign(); }).catch(function () {});
        }
      } catch (err) {
        warnOnce('auto-story', err);
      }
    } catch (err) {
      warnOnce('ready', err);
    }
  }

  function boot() {
    /* 仅既有 #test 探针（无 ?careerTest=1）：完全静默。
       连依赖/内容都不装载——既有 smoke/回归把资源 404 记为 console error，
       而生涯在探针模式下本就不允许持久化、渲染或发奖励（ADR §13）。 */
    if (isSilentTestOnly()) {
      addReason('test-silent');
      api.gameId = inlineDetectGameId();
      api.available = false;
      finalizeReady();
      return Promise.resolve();
    }
    internal.careerDir = resolveCareerDir();
    return loadDependencies()
      .then(function () {
        /* 依赖装载完成后补齐 UI / backup / commission 引用（模块在执行时才挂到 window 上）。 */
        syncUiRefs();
        api.backup = backupFacade();
        api.commission = commissionModule();
        internal.base = resolveBase();
        return loadCareerStyles();
      })
      .then(function () {
        return loadContent();
      })
      .then(function () {
        return openDb();
      })
      .then(function () {
        return loadDiscoveryStateFromDb();
      })
      .then(function () {
        var registryReady = !!(internal.registryInstance && Array.isArray(internal.registryInstance.errors) && internal.registryInstance.errors.length === 0);
        var gameId = detectGameIdSafe();
        api.gameId = gameId || null;
        api.available = registryReady && !internal.registryFailed;
        if (!api.available) addReason(internal.registryFailed ? 'registry-unavailable' : 'registry-invalid');
        if (registryReady && gameId && !internal.registryInstance.getGame(gameId)) {
          addReason('game-not-registered');
        }
        return activateCommissionRun();
      })
      .then(function () {
        finalizeReady();
      })
      .catch(function (err) {
        warnOnce('boot', err);
        addReason('boot-error');
        api.available = false;
        finalizeReady();
      });
  }

  /* ---------------------------------------------------------------- 同步装配公开 API */

  function definePublicApi() {
    var previousUi = isObject(api.ui) ? api.ui : null;
    api.version = VERSION;
    if (!('gameId' in api) || api.gameId === undefined) api.gameId = null;
    api.available = false;
    api.ready = readyPromise;
    api.observe = observe;
    api.finish = finish;
    api.state = stateSnapshot;
    api.openMailbox = openMailbox;
    api.openClue = openClue;
    api.openSettings = openSettings;
    api.setHintsEnabled = setHintsEnabled;
    api.saveState = saveState;
    api.originIntro = originIntro;
    /* 0.16 职业委托（向后兼容扩展）：无 ticket 时 commissionRun=null，行为与 0.15 相同。 */
    api.commission = null;
    api.commissionRun = null;
    api.items = null;
    api.alternatives = null;
    api.rental = null;
    api.isCommissionRun = function () {
      return !!internal.commissionRun;
    };
    api.openTown = openTown;
    api.openHangar = openHangar;
    api.openReceipt = openReceipt;
    api.openMarket = openMarket;
    api.openWorkshop = openWorkshop;
    api.openCampaign = openCampaign;
    api.startEnding = startEnding;
    api.campaign = null;
    api.ending = null;
    api.materials = null;
    api.crafting = null;
    api.professions = null;
    api.storyEvidence = null;
    api.routePlanner = null;
    api.getCommissionLoadout = getCommissionLoadout;
    api.ui = previousUi || (isObject(api.ui) ? api.ui : {});
    /* backup.js（D15-14）异步装载：模块会自行挂到 ArcadeCareer.backup；缺失时为 null。 */
    api.backup = backupFacade();
    /* 追加（相对冻结接口的向后兼容扩展，见证据 DEVIATIONS）：
       - setSourceMode(mode)：让割草/挑战页显式声明当前局模式，使 observe 模式门禁可判定；
       - openSettings()：UI 未加载时返回结构化 {ok:false, reason:'ui-unavailable'}；
       - info()：只读诊断快照。 */
    api.setSourceMode = setSourceMode;
    api.info = info;
    api.reason = null;
    api.__arcadeBridgeMounted = true;
    WINDOW.ArcadeCareer = api;
  }

  definePublicApi();
  internal.runId = newRunId();
  installTestApi();

  /* ready 兜底：即使 boot 卡住也必须在有限时间内 resolve（fail-open）。 */
  internal.readyGuard = setTimeout(function () {
    if (internal.bootDone) return;
    internal.bootTimedOut = true;
    addReason('boot-timeout');
    api.available = false;
    resolveReady({ available: false, reason: internal.reason || 'boot-timeout' });
  }, BOOT_GUARD_MS);

  try {
    WINDOW.addEventListener(
      'pagehide',
      function () {
        /* 无本地写：缓冲仅存内存，页面隐藏即丢弃（不 flush、不阻塞）。 */
        try {
          internal.events.length = 0;
        } catch (err) {
          /* ignore */
        }
      },
      false
    );
  } catch (err) {
    /* ignore */
  }

  /* 异步启动，不阻塞游戏脚本执行。 */
  Promise.resolve()
    .then(function () {
      return boot();
    })
    .catch(function (err) {
      warnOnce('boot-async', err);
      addReason('boot-error');
      api.available = false;
      resolveReady({ available: false, reason: internal.reason || 'boot-error' });
    });
})();
