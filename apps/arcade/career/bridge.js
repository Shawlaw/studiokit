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
  var STORY_TEXT_LIMIT = 160;
  /* 结算剧情反馈的同步等待上限：超时也要把收据交到玩家手里（不静默吞错，显示未记）。 */
  var STORY_PIPELINE_TIMEOUT_MS = 8000;
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
    { file: 'profession-state.js', global: 'professionState', required: true },
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
    { file: 'profession-view.js', global: 'professionView', required: false, lazy: true },
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
    discoveryGeneration: 0,
    registryFailed: false,
    cluesEnabled: false,
    hubPanel: false,
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
    worldWorkContent: null,
    contentRequested: false,
    contentPromise: null,
    commissionRun: null,
    commissionEvents: [],
    commissionSeq: 0,
    commissionLastResult: null,
    commissionActivated: false,
    commissionConfigured: false,
    commissionLastCareerId: null,
    commissionUiFacade: null,
    commissionUiSource: null,
    professionViewLoaded: false,
    careerDataListeners: [],
    endingEvents: [],
    careerArchived: false,
    careerArchiveCareerId: null,
    careerArchivedAt: null,
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
    professionView: { file: 'profession-view.js', global: 'professionView' },
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
          || def.global === 'professionView' || def.global === 'storyEvidence' || def.global === 'routePlanner'
          || def.global === 'campaign' || def.global === 'ending') {
          api[def.global] = mod;
          if (def.global === 'professionView') internal.professionViewLoaded = true;
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
      one('world-work.json', 'worldWorkContent', function (data) {
        return data && Array.isArray(data.commissionIds) && Array.isArray(data.entries) ? data : null;
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
      worldWorkIds: internal.worldWorkContent && Array.isArray(internal.worldWorkContent.commissionIds)
        ? internal.worldWorkContent.commissionIds.slice() : [],
      worldWork: internal.worldWorkContent || null,
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

  /**
   * 0.20 生涯连续性只读查询（告示板 UI 在打开面板时用，Discover live run 不建数据）。
   *
   * API 形状（与 commission-core.continuations 一致，UI 既可 ctx.commission.continuations()
   * 也可 ctx.careerContinuations()）：
   *   ({ careerId? }) -> Promise<{
   *     ok: true, careerId: string|null,
   *     runs: [{ runId, ticketId, commissionId, gameId,
   *              status:'issued'|'active', issuedAt, startedAt }]
   *   }>
   *   失败（读失败 / 无生涯指针 / module 未装载）：
   *     {ok:false, reason, careerId, runs:[]}
   *   UI 必须先看 ok：ok:false 表示「可能读失败」，不可当作「没有可继续的 run」。
   *
   * 只读、不 ensureCareer、不写 sessionStorage；继续必须玩家显式点击「接单」，
   * 由 commission.start({commissionId, careerId}) 复用 live run 并恢复 ticket，UI 只用返回的 url 导航。
   */
  function careerContinuations(input) {
    var mod = commissionModule();
    if (!mod || typeof mod.continuations !== 'function') {
      return Promise.resolve({ ok: false, reason: 'commission-module-missing', careerId: null, runs: [] });
    }
    /* 不吞掉 core 的 ok:false：读失败必须让 UI 看到，不能被当成空列表。 */
    try {
      return Promise.resolve(mod.continuations(input));
    } catch (err) {
      return Promise.resolve({ ok: false, reason: 'exception', careerId: null, runs: [] });
    }
  }

  /** 把 commissions.json 交给 commission-core（只配置一次；缺失/失败保持 fail-open）。 */
  function configureCommissionContent() {
    var mod = commissionModule();
    if (!mod || typeof mod.configure !== 'function') return mod;
    if (internal.commissionConfigured) return mod;
    if (!internal.commissionContent) return mod;
    try {
      var result = mod.configure({
        content: internal.commissionContent,
        arcadeBase: api.gameId ? '../' : internal.base || './',
        worldWorkIds: internal.worldWorkContent && Array.isArray(internal.worldWorkContent.commissionIds)
          ? internal.worldWorkContent.commissionIds.slice() : [],
        worldWork: internal.worldWorkContent || null,
      });
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
    if (internal.careerArchived) return Promise.resolve();
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
        return Promise.resolve(mod.validateTicket({ ticketId: ticketId, ticket: stored, gameId: api.gameId })).then(async function (result) {
          if (!result || !result.ok || !result.commission || !result.run) {
            addReason('commission-ticket-rejected:' + ((result && result.reason) || 'unknown'));
            return null;
          }
          if (typeof result.commission.commissionId !== 'string' || result.commission.commissionId.indexOf('ending.') !== 0) {
            var gate = await careerEntryGate({
              commissionId: result.commission.commissionId,
              gameId: result.commission.gameId || api.gameId || null,
              activeRuns: [result.run],
              history: [result.run],
            });
            if (!gate || gate.ok !== true) {
              addReason('commission-ticket-gate-rejected:' + ((gate && gate.reason) || 'unknown'));
              return null;
            }
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
          /* 终局也走同一条剧情反馈管线：等真实记录结果，再展示收据（不静默吞错）。 */
          return withStoryTimeout(storyFeedbackPipeline(normalized, run))
            .then(function (feedback) {
              renderCommissionReceipt(normalized, feedback);
              return normalized;
            })
            .catch(function (err) {
              warnOnce('story-evidence', err);
              renderCommissionReceipt(normalized, storyFeedbackFailure(normalized));
              return normalized;
            });
        })
        .catch(function (err) {
          warnOnce('ending-settle', err);
          return commissionFailure('ending-settle-error');
        });
    }
    var photoWasLocked = false;
    var beforeSettlement = run.commissionId === 'memory-flip.T1'
      ? withTimeout(readArchivePhotoCommission(mod, run.careerId), 1000, 'receipt-follow-up')
      : Promise.resolve(null);
    return beforeSettlement.catch(function () { return null; })
      .then(function (photo) {
        photoWasLocked = !!photo && photo.unlocked === false;
        return mod.settle({ ticketId: run.ticketId, outcome: outcome, stats: stats || {} });
      })
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
        /* 0.17：把收据里的剧情证据登记为只读 evidence token（失败不影响结算结果）。 */
        return withStoryTimeout(storyFeedbackPipeline(normalized, run).then(function (feedback) {
          return attachArchiveFollowUp(feedback, normalized, mod, run.careerId, photoWasLocked);
        }))
          .then(function (storyFeedback) {
            renderCommissionReceipt(normalized, storyFeedback);
            return normalized;
          })
          .catch(function (err) {
            warnOnce('story-evidence', err);
            renderCommissionReceipt(normalized, storyFeedbackFailure(normalized));
            return normalized;
          });
      })
      .catch(function (err) {
        warnOnce('commission-settle', err);
        return commissionFailure('commission-settle-error');
      });
  }

  function readArchivePhotoCommission(mod, careerId) {
    if (typeof mod.listAvailable !== 'function') return Promise.resolve(null);
    return safeAsync('receipt-follow-up', function () {
      return Promise.resolve(mod.listAvailable({
        careerId: careerId,
        state: currentStateSnapshot(),
        catalog: careerCatalog(),
        context: careerContext(null, 'receipt'),
        ensure: false,
      })).then(function (listing) {
        if (!listing || listing.ok !== true || !Array.isArray(listing.commissions)) return null;
        return listing.commissions.find(function (row) { return row.commissionId === 'memory-flip.T2'; }) || null;
      });
    }, null);
  }

  /** 只有本次首通前锁定、结算后真的可接，才报出这一份后续。 */
  function attachArchiveFollowUp(feedback, result, mod, careerId, photoWasLocked) {
    if (!photoWasLocked || !feedback || result.ok !== true || result.firstClear !== true || result.duplicate === true) return feedback;
    return readArchivePhotoCommission(mod, careerId).then(function (photo) {
      var title = photo && photo.unlocked === true ? cleanStoryText(photo.title, 60) : '';
      if (title) feedback.nextStep = '档案夹已整理好。回告示板接「' + title + '」，去找缺的那张照片。';
      return feedback;
    });
  }

  /** 剧情反馈同步等待上限：模块/DB 卡住不能挡住结算收据；超时按「工钱已结、剧情未记」如实展示。 */
  function withStoryTimeout(promise) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        warnOnce('story-feedback-timeout');
        resolve(storyFeedbackFailure({ ok: true }));
      }, STORY_PIPELINE_TIMEOUT_MS);
      Promise.resolve(promise).then(function (value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }, function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * 结算后先等 recordFromReceipt 的真实结果，再补 C1 旗标与章节快照，最后渲染收据。
   * 任何一步失败都不影响已结清的工钱，但必须如实显示剧情未记（不伪造成功）。
   */
  function storyFeedbackPipeline(result, run) {
    var db = api.db || readGlobal('db');
    return Promise.all([ensureLazyModule('campaign'), ensureLazyModule('storyEvidence'), loadCareerContent()])
      .catch(function () { return null; })
      .then(function () {
        configureCareerModules();
        if (!result || result.ok !== true || !result.receipt || typeof result.receipt !== 'object') {
          /* 结算本身失败也要做幂等 C1 同步，让下一单不必等玩家打开面板。 */
          return Promise.resolve(syncCampaignFlags(false)).catch(function () { return null; })
            .then(function () { return null; });
        }
        var evidenceModule = readGlobal('storyEvidence');
        if (!db || !evidenceModule || typeof evidenceModule.recordFromReceipt !== 'function') {
          return storyFeedbackFailure(result);
        }
        return Promise.resolve(evidenceModule.recordFromReceipt({
          careerId: run.careerId,
          receipt: result.receipt,
          db: db,
          now: nowIso(),
        })).then(function (storyRecord) {
          return storyFeedbackFor(result, storyRecord);
        }).catch(function (err) {
          warnOnce('story-evidence', err);
          return storyFeedbackFailure(result);
        });
      })
      .then(function (feedback) {
        if (!feedback || (feedback.status !== 'recorded' && feedback.status !== 'new')) return feedback;
        /* C1 同步 + 快照都放在 recordFromReceipt 之后，快照必须看见真实剧情结果。 */
        return Promise.resolve(syncCampaignFlags(false))
          .then(function (syncResult) {
            return loadStorySnapshot().then(function (snapshot) {
              return attachCampaignProgress(feedback, snapshot, syncResult);
            });
          })
          .catch(function (err) {
            warnOnce('story-campaign-progress', err);
            return feedback;
          });
      });
  }

  function cleanStoryText(value, limit) {
    if (typeof value !== 'string') return '';
    return clipText(value.replace(/\s+/g, ' ').trim(), limit || STORY_TEXT_LIMIT);
  }

  /** 工钱已结、剧情未记：失败路径必须明确告诉玩家，绝不静默吞错。 */
  function storyFeedbackFailure(result) {
    return {
      status: 'unavailable',
      discovered: [],
      replies: [],
      chapter: null,
      nextStep: '',
      unavailable: result && result.ok === false
        ? '这趟活儿没结成；工钱还没进账，剧情也没记。'
        : '工钱已结，剧情这会儿没能记进账。',
    };
  }

  /**
   * 从真实记录结果推导玩家语言的剧情所得。
   * - discovered 只取本次新获得的有效证据（newTokens），重复领取为空；
   * - newFlags 只作内部推导使用，不进入玩家可见文案；
   * - NPC 回信按本次涉及章级旗标匹配，最多两条，名字统一为玩家称呼。
   */
  function storyFeedbackFor(result, storyRecord) {
    var feedback = storyFeedbackFailure(result);
    if (!result || result.ok !== true || !storyRecord || storyRecord.ok !== true) return feedback;
    var duplicate = result.duplicate === true || storyRecord.duplicate === true;
    feedback.status = duplicate ? 'recorded' : 'new';
    feedback.unavailable = '';
    var newTokens = !duplicate && Array.isArray(storyRecord.newTokens) ? storyRecord.newTokens.slice() : [];
    var discovered = [];
    for (var t = 0; t < newTokens.length && discovered.length < 2; t += 1) {
      var label = evidenceLabelOf(newTokens[t]);
      if (label && discovered.indexOf(label) < 0) discovered.push(label);
    }
    feedback.discovered = discovered;
    var receiptFlags = Array.isArray(result.receipt.flags) ? result.receipt.flags : [];
    var newFlags = !duplicate && Array.isArray(storyRecord.newFlags) ? storyRecord.newFlags.slice() : [];
    /* 终局事务已写入完成旗标，证据登记不会再把它列为新增。 */
    if (!duplicate && result.settled === true && receiptFlags.indexOf('C5.star_tower_resolved') >= 0
      && newFlags.indexOf('C5.star_tower_resolved') < 0) newFlags.push('C5.star_tower_resolved');
    var replies = [];
    var npcContent = internal.npcContent;
    if (npcContent && Array.isArray(npcContent.characters)) {
      for (var f = 0; f < newFlags.length && replies.length < 2; f += 1) {
        var chapterId = chapterOfFlag(newFlags[f]);
        if (!chapterId || chapterId === 'C0') continue; /* C0 由读信推进，不是工单结算所得 */
        for (var c = 0; c < npcContent.characters.length && replies.length < 2; c += 1) {
          var character = npcContent.characters[c];
          if (!character || !Array.isArray(character.replies)) continue;
          for (var r = 0; r < character.replies.length && replies.length < 2; r += 1) {
            var reply = character.replies[r];
            if (!reply || reply.chapterId !== chapterId) continue;
            var text = cleanStoryText(reply.text);
            var name = cleanStoryText(npcNameOf(character), 40);
            if (!text || !name) continue;
            replies.push({ name: name, text: text });
          }
        }
      }
    }
    feedback.replies = replies;
    /* C1 由随后的 syncCampaignFlags 补写；还要用本次收据旗标确认它来自这一单。 */
    feedback.__newChapterFlags = newFlags.filter(function (flag) { return !!chapterOfFlag(flag); });
    feedback.__receiptFlags = duplicate ? [] : receiptFlags.slice();
    return feedback;
  }

  /** 章级旗标 → C0..C5；非章级旗标、未知旗标返回 null。 */
  function chapterOfFlag(flag) {
    var match = /^C([0-5])\./.exec(typeof flag === 'string' ? flag : '');
    return match ? 'C' + match[1] : null;
  }

  /** 证据 token → 玩家语言物件名；按来源游戏/委托给出具体物件，不泄漏 E/BP/MAP/DEC token。 */
  var EVIDENCE_LABELS = {
    'patrol': '异常航报',
    'flight': '异常航报',
    'site': '工地记录',
    'memory-flip': '档案照片与记录',
    'gomoku': '布局推演',
    'shadow-leap': '失落的卷轴拓片',
    'scroll': '失落的卷轴拓片',
    'solitaire': '码头调度记录',
    'snowbells': '雪线观测记录',
    'snake-run': '生态样本',
    'mole-whack': '检修记录',
    'block-drop': '仓库档案',
    'merge-2048': '晶格现场记录',
    'gravity-flip': '相位频率记录',
    'road-rush': '遗迹驿站记录',
    'star-raid': '巡航航报',
    'blackjack': '风控记录',
    'brick-breaker': '砖阵勘察记录',
    'gold-miner': '矿场记录',
    'pendulum-tower': '工地记录',
  };

  function evidenceLabelOf(token) {
    var text = typeof token === 'string' ? token : '';
    if (!/^(E|BP|MAP|DEC)-/.test(text)) return '';
    for (var key in EVIDENCE_LABELS) {
      if (Object.prototype.hasOwnProperty.call(EVIDENCE_LABELS, key) && text.indexOf(key) >= 0) {
        return EVIDENCE_LABELS[key];
      }
    }
    /* 未知 token 按类别给通用物件名，不回显原始 token。 */
    var kind = text.slice(0, text.indexOf('-'));
    if (kind === 'BP') return '现场记录';
    if (kind === 'MAP') return '一份路线图';
    if (kind === 'DEC') return '一份决议文书';
    return '一份现场记录';
  }

  /** NPC 显示名统一玩家语言：内部代号改成戏内称呼。 */
  function npcNameOf(character) {
    if (!character) return '';
    var name = typeof character.name === 'string' ? character.name : '';
    if (name === 'E-7') return '旧港口的来信';
    return name;
  }

  /**
   * 只把本次真实新完成的章节写进收据；旧章节一律不冒充本次所得。
   * 一次连跳时列出全部新完成章节（玩家语言标题），并用最后一章的交接作为下一步。
   * 成功结算即使没有新章节旗标（中间单），也读真实 campaign.state 给出下一步，
   * 但不设置 feedback.chapter、不冒充任何章节完成。
   */
  function attachCampaignProgress(feedback, snapshot, syncResult) {
    if (!feedback || (feedback.status !== 'recorded' && feedback.status !== 'new')) return feedback;
    var campaign = readGlobal('campaign');
    var state = null;
    if (campaign && typeof campaign.state === 'function' && snapshot) {
      try { state = campaign.state(snapshot); } catch (err) { state = null; }
    }
    var validState = state && state.ok === true && Array.isArray(state.chapters) ? state : null;

    /* 只展示本次结算新完成的段落。C1 需同时有本次的收据旗标和实际补写结果。 */
    var claimed = [];
    if (validState) {
      var newFlags = Array.isArray(feedback.__newChapterFlags) ? feedback.__newChapterFlags : [];
      var receiptFlags = Array.isArray(feedback.__receiptFlags) ? feedback.__receiptFlags : [];
      var syncedFlags = syncResult && syncResult.ok === true && Array.isArray(syncResult.added) ? syncResult.added : [];
      validState.chapters.forEach(function (chapter) {
        if (!chapter || chapter.state !== 'complete') return;
        var flag = chapter.completionFlag;
        if (newFlags.indexOf(flag) >= 0) { claimed.push(chapter); return; }
        if (chapter.chapterId === 'C1' && syncedFlags.indexOf(flag) >= 0 && c1RouteMetByReceipt(receiptFlags)) {
          claimed.push(chapter);
        }
      });
    }
    if (claimed.length) {
      var titles = claimed.map(function (chapter) { return cleanStoryText(chapterTitleOf(chapter), 80); }).filter(Boolean);
      var latest = claimed[claimed.length - 1];
      feedback.chapter = { id: latest.chapterId, title: titles.join('、') };
      feedback.chapterCount = claimed.length;
      /* 里程碑完成后才用最近完成章的 handoff 指向下一章。 */
      feedback.nextStep = nextStepOf(latest, validState);
      return feedback;
    }
    /* 中间单：只报线索/NPC 回应 + 当前进行章自身的下一步（不跳 handoff，不设 chapter）。 */
    feedback.nextStep = nextStepOfCurrent(validState);
    return feedback;
  }

  /** 本次 C1 收据旗标是否满足 C1 任一路线（work_done/flight_done/signal/records）。 */
  function c1RouteMetByReceipt(receiptFlags) {
    if (!Array.isArray(receiptFlags)) return false;
    var flags = Object.create(null);
    receiptFlags.forEach(function (flag) { if (typeof flag === 'string') flags[flag] = true; });
    if (flags['C1.work_done'] || flags['C1.flight_done']) return true;
    if (flags['C1.signal'] || flags['C1.records']) return true;
    return false;
  }

  /**
   * 当前进行章的下一步：指向当前章自身（提示继续做这一章），而不是它的下一章 handoff。
   * campaign.state.currentChapter 是字符串 chapterId（见 campaign-core.currentChapterOf），
   * 兼容对象形状时取其 chapterId；绝不按数组下标或标题猜测。
   */
  function nextStepOfCurrent(state) {
    if (!state || !Array.isArray(state.chapters)) return '去告示板看看下一张单。';
    var raw = state.currentChapter;
    var currentId = typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? raw.chapterId : '';
    if (!currentId) return '去告示板看看下一张单。';
    for (var i = 0; i < state.chapters.length; i += 1) {
      var chapter = state.chapters[i];
      if (!chapter || chapter.chapterId !== currentId || chapter.state === 'complete') continue;
      return '继续当前这段「' + cleanStoryText(chapterTitleOf(chapter), 60) + '」，去告示板看看还差哪张单。';
    }
    return '去告示板看看下一张单。';
  }

  function chapterTitleOf(chapter) {
    if (chapter && chapter.title) return chapter.title;
    var chapterId = chapter && chapter.chapterId ? chapter.chapterId : '';
    var file = (internal.chapterFiles || {})[chapterId];
    if (file && file.title) return file.title;
    var campaignContent = internal.campaignContent;
    if (campaignContent && Array.isArray(campaignContent.chapters)) {
      for (var i = 0; i < campaignContent.chapters.length; i += 1) {
        var candidate = campaignContent.chapters[i];
        if (candidate && candidate.chapterId === chapterId && candidate.title) return candidate.title;
      }
    }
    return chapterId;
  }

  /** 章节交接 → 玩家语言的下一步（不显示 C1/C2 这类内部记号）。 */
  function nextStepOf(chapter, state) {
    if (!chapter) return '';
    if (chapter.chapterId === 'C5' || state.endingChosen) {
      return '读一读港口的后日谈，或回告示板自由接单。';
    }
    if (chapter.chapterId === 'C4' && Array.isArray(state.endings)
      && state.endings.some(function (ending) { return ending.available; })) {
      return '在武力解除、理性重启和运输救援中选一条终局路线。';
    }
    var handoff = chapter.handoff;
    var chapters = Array.isArray(state.chapters) ? state.chapters : [];
    for (var i = 0; i < chapters.length; i += 1) {
      if (chapters[i] && chapters[i].chapterId === handoff) {
        return '去告示板看看「' + cleanStoryText(chapterTitleOf(chapters[i]), 60) + '」有什么新活儿。';
      }
    }
    return '去告示板或信箱看看下一封信。';
  }

  function storyFeedbackForUi(feedback) {
    if (!feedback) return null;
    var out = clone(feedback);
    /* 内部字段只用于章节比对，不进入 UI/日志。 */
    delete out.__newChapterFlags;
    delete out.__receiptFlags;
    return out;
  }

  function renderCommissionReceipt(result, feedback) {
    var payload = {
      api: api,
      result: clone(result),
      careerId: internal.commissionLastCareerId || null,
      announce: announceToUser,
      reducedMotion: reducedMotionPreferred(),
      professionView: professionViewModule(),
      careerView: null,
      storyFeedback: storyFeedbackForUi(feedback),
      openTown: openTown,
      openCampaign: openCampaign,
      openMailbox: openMailbox,
    };
    function show() {
      var receiptUi = readUi('receipt');
      if (!receiptUi || typeof receiptUi.show !== 'function') {
        /* receipt.js 是 lazy 依赖：玩家本局没开过钱包时也要在结算后加载并展示收据。 */
        return ensureLazyModule('receipt')
          .then(function (loaded) {
            if (!loaded || typeof loaded.show !== 'function') return;
            try {
              loaded.show(payload);
            } catch (err) {
              warnOnce('commission-receipt-ui', err);
            }
          })
          .catch(function () {});
      }
      try {
        receiptUi.show(payload);
      } catch (err) {
        warnOnce('commission-receipt-ui', err);
      }
      return Promise.resolve();
    }
    return Promise.resolve(careerView({ surface: 'receipt' }))
      .then(function (view) {
        payload.careerView = view || null;
        return show();
      })
      .catch(function () {
        payload.careerView = null;
        return show();
      });
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

  /**
   * 发现写入只走 career-db 的公共事务 API。任何 career extension 的写入都由
   * mergeDiscoveryState(action.professionEvents) 或 applyProfessionEvent 完成；
   * bridge 不再有 raw IDB / 通用 put / 多步写回退。
   */
  function dbWrite(state, discoveryRecords, action) {
    return Promise.resolve()
      .then(function () {
        var dbModule = readGlobal('db');
        if (!dbModule || typeof dbModule.mergeDiscoveryState !== 'function') {
          return { ok: false, error: 'merge-discovery-api-missing' };
        }
        return dbModule.mergeDiscoveryState(state, normalizeDiscoveryRecords(discoveryRecords), {
          action: action && isObject(action) ? action : { type: 'SAVE_STATE', generation: internal.discoveryGeneration || 0 },
        });
      })
      .catch(function (err) {
        warnOnce('db-write', err);
        return { ok: false, error: 'db-write-exception' };
      });
  }

  function isStaleGenerationResult(result) {
    return !!result && (result.reason === 'stale-generation' || result.error === 'stale-generation');
  }

  function reloadAfterStaleGeneration() {
    return loadDiscoveryStateFromDb().then(function () { return true; }).catch(function () { return false; });
  }

  function archiveSnapshotOf(raw) {
    var value = unwrapRecord(raw);
    if (!isObject(value)) return { archived: false, careerId: null, archivedAt: null };
    var marker = isObject(value.value) ? value.value : value;
    return {
      archived: marker.archived === true,
      careerId: typeof marker.careerId === 'string' ? marker.careerId : null,
      archivedAt: typeof marker.archivedAt === 'string' ? marker.archivedAt : null,
    };
  }

  function applyArchiveSnapshot(snapshot) {
    var normalized = archiveSnapshotOf(snapshot);
    internal.careerArchived = normalized.archived;
    internal.careerArchiveCareerId = normalized.careerId;
    internal.careerArchivedAt = normalized.archivedAt;
    api.careerArchived = normalized.archived;
    return normalized;
  }

  function readCareerArchive() {
    var dbModule = readGlobal('db');
    if (!dbModule) return Promise.resolve(applyArchiveSnapshot(null));
    if (typeof dbModule.getArchiveState === 'function') {
      return Promise.resolve(dbModule.getArchiveState()).then(applyArchiveSnapshot).catch(function () {
        return { archived: internal.careerArchived, careerId: internal.careerArchiveCareerId, archivedAt: internal.careerArchivedAt };
      });
    }
    var getter = pickMethod(dbModule, ['getState']);
    if (getter) {
      return callMaybeAsync(getter, dbModule, ['career-archive']).then(applyArchiveSnapshot).catch(function () {
        return { archived: internal.careerArchived, careerId: internal.careerArchiveCareerId, archivedAt: internal.careerArchivedAt };
      });
    }
    return Promise.resolve(applyArchiveSnapshot(null));
  }

  function requireCareerWritable() {
    if (!internal.careerArchived) return Promise.resolve({ ok: true });
    return Promise.resolve({
      ok: false,
      reason: 'career-archived',
      error: 'career-archived',
      message: '生涯已封存。要留下新线索或继续委托，请先在生涯设置里解冻。',
    });
  }

  function writeDbState(state, discoveryRecords, action) {
    return requireCareerWritable().then(function (gate) {
      if (!gate.ok) return gate;
      return writeDbStateUnlocked(state, discoveryRecords, action);
    });
  }

  function writeDbStateUnlocked(state, discoveryRecords, action) {
    var actionWithGeneration = action && isObject(action) ? Object.assign({}, action) : null;
    if (actionWithGeneration) actionWithGeneration.generation = internal.discoveryGeneration || 0;
    /* career-db 是唯一落盘 owner；没有事务合并 API 时不得自行拼装多步写入。 */

    var dbModule = readGlobal('db');
    if (!dbModule || typeof dbModule.mergeDiscoveryState !== 'function') {
      return Promise.resolve({ ok: false, error: 'merge-discovery-api-missing' });
    }
    return dbWrite(state, discoveryRecords, actionWithGeneration || { type: 'SAVE_STATE', generation: internal.discoveryGeneration || 0 });
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
            var gen = raw && Number.isFinite(Number(raw.generation)) ? Math.floor(Number(raw.generation)) : null;
            return normalized.ok ? { ok: true, method: reset.name, generation: gen } : { ok: false, method: reset.name, error: normalized.error };
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
    return readCareerArchive().then(function () {
      return loadDiscoveryStateFromDbUnlocked();
    });
  }

  function loadDiscoveryStateFromDbUnlocked() {
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
    var dbModule = readGlobal('db');
    if (dbModule && typeof dbModule.getDiscoverySnapshot === 'function') {
      return Promise.resolve()
        .then(function () { return dbModule.getDiscoverySnapshot(); })
        .then(function (snapshot) {
          if (!snapshot || snapshot.ok !== true) return readDbStateRecord().then(function (record) {
            internal.discoveryState = discovery.normalizeState(record || null);
            internal.stateLoadedFromDb = !!record;
          });
          internal.discoveryState = discovery.normalizeState(snapshot.state || null);
          internal.stateLoadedFromDb = !!snapshot.state;
          if (Number.isFinite(Number(snapshot.generation))) internal.discoveryGeneration = Math.floor(Number(snapshot.generation));
        })
        .catch(function () {
          return readDbStateRecord().then(function (record) {
            internal.discoveryState = discovery.normalizeState(record || null);
            internal.stateLoadedFromDb = !!record;
          });
        });
    }
    return Promise.all([
      readDbStateRecord(),
      typeof dbGetDiscoveryGeneration === 'function' ? dbGetDiscoveryGeneration() : Promise.resolve({ ok: false }),
    ]).then(function (values) {
      var record = values[0];
      var genResult = values[1];
      internal.discoveryState = discovery.normalizeState(record || null);
      internal.stateLoadedFromDb = !!record;
      if (genResult && genResult.ok && Number.isFinite(Number(genResult.generation))) {
        internal.discoveryGeneration = Math.floor(Number(genResult.generation));
      }
    });
  }

  function dbGetDiscoveryGeneration() {
    var db = readGlobal('db');
    if (!db || typeof db.getDiscoveryGeneration !== 'function') return null;
    try {
      return Promise.resolve(db.getDiscoveryGeneration()).catch(function () { return { ok: false }; });
    } catch (err) {
      return Promise.resolve({ ok: false });
    }
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

  var snapshotGenerations = typeof WeakMap === 'function' ? new WeakMap() : null;

  function rememberSnapshot(value) {
    if (snapshotGenerations && value && typeof value === 'object') {
      snapshotGenerations.set(value, internal.discoveryGeneration);
      try {
        value.__snapshotGeneration = internal.discoveryGeneration;
      } catch (err) {
        /* 只读对象：WeakMap 仍可保证对象身份路径 */
      }
    }
    return value;
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
        return rememberSnapshot(clone(currentStateSnapshot()) || clone(fallbackInitialState()));
      },
      rememberSnapshot(clone(fallbackInitialState()))
    );
  }

  /**
   * 0.22 catalog 始终由注册表/真实线索/真实委托拼装，不按展示名或固定 16 推导。
   * UI 与 gate 共享同一份快照；纯模块不直接读 bridge 内部。
   */
  function careerCatalog() {
    var base = isObject(internal.registryContent) ? clone(internal.registryContent) : null;
    var catalog = base || { schemaVersion: 1, contentVersion: '', games: [], professions: [], commissions: [] };
    if (!Array.isArray(catalog.games)) catalog.games = [];
    if (!Array.isArray(catalog.professions)) catalog.professions = [];
    catalog.clues = clone(internal.clues) || [];
    catalog.commissions = internal.commissionContent && Array.isArray(internal.commissionContent.commissions)
      ? clone(internal.commissionContent.commissions)
      : Array.isArray(catalog.commissions) ? catalog.commissions : [];
    if (internal.worldWorkContent) {
      catalog.worldWorkIds = Array.isArray(internal.worldWorkContent.commissionIds)
        ? internal.worldWorkContent.commissionIds.slice() : [];
      catalog.worldWork = clone(internal.worldWorkContent);
    }
    catalog.tools = [
      { toolId: 'wallet', name: '钱包', introducedOnAccept: true },
      { toolId: 'shop', name: '商店', introducedOnAccept: true },
      { toolId: 'workshop', name: '工作台', introducedOnAccept: true },
      { toolId: 'hangar', name: '机库', introducedOnAccept: true },
    ];
    return catalog;
  }

  /**
   * bridge 只提供展示收窄，不构造授权事实。世界旗标、故事证据、已清委托、历史与
   * 可接集合均由 T04 commission-core 从 DB 推导；调用方传入的同名字段一律丢弃。
   */
  function careerContext(extra, surface) {
    var source = isObject(extra) ? extra : {};
    var state = currentStateSnapshot();
    var opened = [];
    var records = isObject(state.clues) ? state.clues : {};
    Object.keys(records).forEach(function (clueId) {
      if (isObject(records[clueId]) && records[clueId].openedAt) opened.push(clueId);
    });
    var context = {
      now: typeof source.now === 'string' ? source.now : nowIso(),
      surface: typeof source.surface === 'string' && source.surface ? source.surface : surface || 'work',
      gameId: source.gameId !== undefined ? source.gameId : api.gameId || null,
      openedClueIds: opened,
      activeRuns: source.activeRuns !== undefined
        ? clone(source.activeRuns)
        : (internal.commissionRun ? [clone(internal.commissionRun)] : []),
      walletKnown: internal.careerArchived !== true && !!internal.commissionLastCareerId,
      archived: internal.careerArchived === true,
      bridgeDisplayOnly: true,
      authority: 'commission-core',
    };
    if (typeof source.careerId === 'string') context.careerId = source.careerId;
    return context;
  }

  /**
   * 所有 UI 消费者拿到的是受控门面：只读列表强制 ensure:false 并附带 state/catalog/context；
   * start 也把当前状态交给 T04 核心 gate，不能靠 UI 过滤绕过披露。
   */
  function commissionForUi() {
    var mod = commissionModule();
    if (!mod) return null;
    if (internal.commissionUiSource === mod && internal.commissionUiFacade) return internal.commissionUiFacade;
    var facade = {};
    Object.keys(mod).forEach(function (key) {
      var fn = mod[key];
      if (typeof fn !== 'function') {
        facade[key] = fn;
        return;
      }
      facade[key] = function () {
        var args = Array.prototype.slice.call(arguments);
        if (key === 'listAvailable' || key === 'start' || key === 'validateTicket') {
          var input = isObject(args[0]) ? Object.assign({}, args[0]) : {};
          var surface = typeof input.surface === 'string' ? input.surface : 'work';
          input.ensure = false;
          input.state = input.state || currentStateSnapshot();
          input.catalog = input.catalog || careerCatalog();
          input.context = careerContext(input.context, surface);
          if (key === 'listAvailable' && internal.commissionLastCareerId && !input.careerId) {
            input.careerId = internal.commissionLastCareerId;
          }
          args[0] = input;
        }
        return fn.apply(mod, args);
      };
    });
    internal.commissionUiSource = mod;
    internal.commissionUiFacade = facade;
    return facade;
  }

  function professionViewModule() {
    var mod = readGlobal('professionView');
    if (mod && internal.professionViewLoaded !== true) internal.professionViewLoaded = true;
    return mod || null;
  }

  function commissionIdsFromListing(listing) {
    if (!listing || listing.ok !== true || !Array.isArray(listing.commissions)) return [];
    return listing.commissions
      .filter(function (row) { return row && typeof row.commissionId === 'string' && row.unlocked !== false; })
      .map(function (row) { return row.commissionId; });
  }

  /**
   * 核心权威事实：只从 commission-core 的 DB-backed listAvailable / continuations 取得。
   * bridge context 不被允许改写 worldFlags/storyEvidence/clearedCommissions/history；
   * 返回 context 只携带核心已裁决的 availableIds/history 与展示字段。
   */
  function careerCoreFacts(context, surface) {
    var display = careerContext(context, surface);
    return Promise.all([ensureLazyModule('commission'), loadCareerContent()]).then(function () {
      configureCommissionContent();
      var mod = commissionModule();
      if (!mod || typeof mod.listAvailable !== 'function') return { listing: null, context: display };
      var input = {
        careerId: internal.commissionLastCareerId || null,
        state: currentStateSnapshot(),
        catalog: careerCatalog(),
        context: display,
        ensure: false,
      };
      return Promise.resolve(mod.listAvailable(input)).then(function (listing) {
        var ids = listing && listing.ok && Array.isArray(listing.availableIds)
          ? listing.availableIds.slice()
          : commissionIdsFromListing(listing);
        display.availableIds = ids;
        display.bridgeCoreAuthority = !!(listing && listing.ok);
        if (listing && typeof listing.careerId === 'string') display.careerId = listing.careerId;
        var continuations = typeof mod.continuations === 'function'
          ? Promise.resolve(mod.continuations({ careerId: display.careerId || null })).catch(function () { return null; })
          : Promise.resolve(null);
        return continuations.then(function (result) {
          if (result && result.ok !== true && result.ok !== false) return { listing: listing, context: display };
          if (result && result.ok === true && Array.isArray(result.runs)) {
            display.history = clone(result.runs);
          }
          return { listing: listing, context: display };
        });
      }).catch(function () {
        display.availableIds = [];
        display.bridgeCoreAuthority = false;
        return { listing: null, context: display };
      });
    });
  }

  /** 只读投影；模块不可用时返回 null，不编造投影、不创建身份。 */
  function careerView(context) {
    return waitReady(READY_TIMEOUT_MS).then(function () {
      return ensureLazyModule('professionView');
    }).then(function () {
      var view = professionViewModule();
      if (!view || typeof view.projectCareerView !== 'function') return null;
      var surface = isObject(context) && context.surface ? context.surface : 'work';
      return careerCoreFacts(context, surface).then(function (facts) {
        var projection = view.projectCareerView({
          state: currentStateSnapshot(),
          catalog: careerCatalog(),
          context: facts.context,
        });
        if (!projection) return null;
        /* 可接/可见集合只认核心裁决，投影模块不得凭空扩大。 */
        if (facts.listing && facts.listing.ok && Array.isArray(facts.listing.commissions)) {
          projection.commissions = clone(facts.listing.commissions);
        }
        return projection;
      });
    }).catch(function (err) {
      warnOnce('career-view', err);
      return null;
    });
  }

  /** 深链/旧链接/搜索/调试入口的统一只读 gate；模块不可用时 fail closed。 */
  function careerEntryGate(request) {
    return waitReady(READY_TIMEOUT_MS).then(function () {
      return Promise.all([ensureLazyModule('professionView'), careerCoreFacts(request, 'deep-link')]);
    }).then(function (values) {
      var view = values[0];
      var facts = values[1];
      var router = readGlobal('entryRouter');
      if (!view || !router || typeof router.gateCareerEntry !== 'function') {
        return { ok: false, reason: 'profession-view-unavailable' };
      }
      var input = isObject(request) ? Object.assign({}, request) : {};
      input.context = facts.context;
      input.coreAuthoritative = facts.context.bridgeCoreAuthority === true;
      return router.gateCareerEntry(input, view, currentStateSnapshot(), careerCatalog(), facts.context);
    }).catch(function () {
      return { ok: false, reason: 'gate-failed' };
    });
  }

  /** 职业写门面：只允许 career-db.applyProfessionEvent，失败不修改本页状态，成功后重读。 */
  function applyProfessionAction(action, input) {
    return waitReady(READY_TIMEOUT_MS).then(function () {
      if (internal.careerArchived) return { ok: false, reason: 'career-archived' };
      var db = api.db || readGlobal('db');
      if (!db || typeof db.applyProfessionEvent !== 'function') {
        return { ok: false, reason: 'profession-event-api-missing' };
      }
      var at = nowIso();
      var payloadInput = isObject(input) ? Object.assign({}, input) : {};
      payloadInput.catalog = careerCatalog();
      return Promise.resolve(db.applyProfessionEvent({
        action: action,
        input: payloadInput,
        generation: internal.discoveryGeneration || 0,
        now: at,
      })).then(function (result) {
        if (!result || result.ok !== true) return result || { ok: false, reason: 'profession-event-failed' };
        if (result.careerId) internal.commissionLastCareerId = result.careerId;
        return loadDiscoveryStateFromDb().then(function () {
          notifyCareerDataChanged(action.toLowerCase().replace(/_/g, '-'));
          return result;
        });
      }).catch(function (err) {
        warnOnce('profession-event', err);
        return { ok: false, reason: 'profession-event-error' };
      });
    });
  }

  function acceptProfessionInvitation(input) {
    var request = isObject(input) ? input : {};
    var professionId = typeof request.professionId === 'string' ? request.professionId : null;
    var gameId = typeof request.gameId === 'string' ? request.gameId : null;
    if (!gameId && professionId) {
      /* 重复点击可能不带 gameId：只从已持久化状态 + 注册表映射恢复，不猜测新起源。 */
      var state = currentStateSnapshot();
      var catalog = careerCatalog();
      var mapping = Array.isArray(catalog.games)
        ? catalog.games.filter(function (game) {
          return game && Array.isArray(game.professions) && game.professions.indexOf(professionId) >= 0;
        })
        : [];
      var accepted = state.professionProgress && isObject(state.professionProgress[professionId])
        ? state.professionProgress[professionId] : null;
      var duplicate = accepted && ['accepted', 'developed', 'completed'].indexOf(accepted.state) >= 0;
      var origin = mapping.find(function (game) { return game.gameId === state.acceptedOriginGameId; });
      /* 重复调用只借映射做探测；起源不得被替换，未接受职业仍必须显式给 gameId。 */
      gameId = origin ? origin.gameId : duplicate && mapping.length ? mapping[0].gameId : null;
    }
    return applyProfessionAction('ACCEPT_INVITATION', {
      professionId: professionId,
      gameId: gameId,
    });
  }

  function setActiveProfession(input) {
    var request = isObject(input) ? input : {};
    return applyProfessionAction('SET_ACTIVE', {
      professionId: typeof request.professionId === 'string' ? request.professionId : null,
    });
  }

  function onCareerDataChanged(listener) {
    if (typeof listener !== 'function') return function () {};
    internal.careerDataListeners.push(listener);
    return function () {
      internal.careerDataListeners = internal.careerDataListeners.filter(function (item) { return item !== listener; });
    };
  }

  function notifyCareerDataChanged(reason) {
    internal.careerDataListeners.slice().forEach(function (listener) {
      try {
        var result = listener({ reason: typeof reason === 'string' ? reason : 'changed', at: nowIso() });
        if (result && typeof result.catch === 'function') result.catch(function () {});
      } catch (err) {
        warnOnce('career-data-listener', err);
      }
    });
  }

  function invalidateCareerData(input) {
    var request = isObject(input) ? input : {};
    var reason = typeof request.reason === 'string' ? request.reason : 'changed';
    notifyCareerDataChanged(reason);
    return { ok: true, reason: reason };
  }

  function invitationForClue(clueId) {
    try {
      if (internal.careerArchived) return null;
      var clue = findClue(clueId);
      if (!clue || !clue.gameId) return null;
      var catalog = careerCatalog();
      var game = Array.isArray(catalog.games)
        ? catalog.games.find(function (row) { return row && row.gameId === clue.gameId; })
        : null;
      var state = currentStateSnapshot();
      var view = professionViewModule();
      var professionIds = game && Array.isArray(game.professions) ? game.professions.slice() : [];
      for (var i = 0; i < professionIds.length; i += 1) {
        var professionId = professionIds[i];
        var row = state.professionProgress && isObject(state.professionProgress[professionId])
          ? state.professionProgress[professionId] : null;
        if (!row || ['glimpsed', 'read'].indexOf(row.state) < 0) continue;
        var reveal = view && typeof view.canRevealProfession === 'function'
          ? view.canRevealProfession({ state: state, catalog: catalog, context: { surface: 'letter', gameId: clue.gameId }, professionId: professionId, surface: 'letter' })
          : null;
        if (!reveal || reveal.ok !== true) continue;
        var profession = Array.isArray(catalog.professions)
          ? catalog.professions.find(function (item) { return item && item.professionId === professionId; })
          : null;
        return {
          professionId: professionId,
          gameId: clue.gameId,
          displayName: profession && profession.displayName ? profession.displayName : '',
          state: row.state,
          canAccept: row.state === 'read',
        };
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  function setProfessionPaused(input) {
    var request = isObject(input) ? input : {};
    return applyProfessionAction('SET_PAUSED', {
      professionId: typeof request.professionId === 'string' ? request.professionId : null,
      paused: request.paused === true,
    });
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
      if (internal.careerArchived) return false;
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
    if (internal.careerArchived) {
      internal.lastFinish = { input: summarizeInput(input), result: null, reason: 'career-archived', at: nowIso(), runId: null };
      return Promise.resolve(null);
    }
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
        reduced = discovery.reduce(baseState, { type: 'RUN_ENDED', run: runSummary, at: nowIso() }, {
          clueConfigs: clueConfigs,
          catalog: careerCatalog(),
        });
      } catch (err) {
        warnOnce('discovery-reduce', err);
        internal.lastFinish.reason = 'reduce-error';
        return null;
      }
      var nextState = reduced && reduced.state ? reduced.state : baseState;
      var clue = reduced && reduced.clue ? reduced.clue : null;
      internal.discoveryState = nextState;

      function finalizeResult(persisted, writeError) {
        var result = null;
        if (clue) {
          result = {
            clueId: clue.clueId,
            reason: clue.reason,
            clue: clue.clue,
            state: clone(nextState),
            persisted: !!persisted,
            writeError: persisted ? null : (typeof writeError === 'string' ? writeError : null),
          };
        }
        internal.finishedResult = result;
        internal.finished = true;
        internal.lastFinish.result = result;
        return result;
      }

      function afterPersist(persisted, writeError) {
        var result = finalizeResult(persisted, writeError);
        if (!persisted) {
          /* DB 写失败/不可用：返回 clue 结果但绝不渲染（fail-open）。 */
          return result;
        }
        if (nextState.hintsEnabled === false) return result;
        /* Replay a persisted unread clue for this game using the merged state. */
        var records = isObject(nextState.clues) ? nextState.clues : {};
        var latestRecord;
        var replayClue = null;
        if (clue && isObject(clue.clue) && clue.clue.clueId) {
          latestRecord = records[clue.clue.clueId];
          if (isObject(latestRecord) && !latestRecord.openedAt) replayClue = clue.clue;
        }
        if (!replayClue) {
          for (var i = 0; i < internal.clues.length; i += 1) {
            var candidate = internal.clues[i];
            if (!candidate || candidate.gameId !== api.gameId) continue;
            latestRecord = records[candidate.clueId];
            if (!isObject(latestRecord) || latestRecord.openedAt) continue;
            replayClue = candidate;
            break;
          }
        }
        if (!replayClue) return result;
        /* 玩家已进入生涯：预热 backup.js（D15-14），失败静默。 */
        warmLazyModules();
        return renderClue(replayClue, nextState).then(function () {
          return result;
        });
      }

      if (!internal.dbUsable) {
        addReason('db-unavailable');
        warnOnce('persist-unavailable', 'db unavailable; clue result kept in memory only');
        return afterPersist(false, 'db-unavailable');
      }
      var discoveryAction = {
        type: 'RUN_ENDED',
        run: runSummary,
        baseRuns: baseState.runs || {},
        catalog: careerCatalog(),
        gameId: api.gameId || null,
        clueId: clue ? clue.clueId : null,
        clueOpened: false,
      };
      if (reduced && reduced.professionEvents) {
        discoveryAction.professionEvents = reduced.professionEvents;
        if (reduced.professionEvent) discoveryAction.professionEvent = reduced.professionEvent;
      }
      return writeDbState(nextState, clue ? clue.discovery || null : null, discoveryAction).then(function (writeResult) {
        var persisted = !!(writeResult && writeResult.ok);
        if (!persisted) {
          addReason('db-write-failed');
          warnOnce('db-write', (writeResult && writeResult.error) || 'write-failed');
          if (isStaleGenerationResult(writeResult)) {
            return reloadAfterStaleGeneration().then(function () { return afterPersist(false, 'stale-generation'); });
          }
        } else if (isObject(writeResult.value)) {
          /* 页面采用事务合并后的结果（保留其它标签的已读时间/线索并集）。 */
          var normalizedApplied = discovery.normalizeState(writeResult.value);
          internal.discoveryState = normalizedApplied;
          nextState = normalizedApplied;
        }
        return afterPersist(persisted, writeResult && (writeResult.error || writeResult.reason));
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
          var capturedGeneration = snapshotGenerations ? snapshotGenerations.get(nextState) : undefined;
          var inlineGeneration = Number.isFinite(Number(nextState.__snapshotGeneration)) ? Number(nextState.__snapshotGeneration) : undefined;
          var snapshotGeneration = capturedGeneration !== undefined ? capturedGeneration : inlineGeneration;
          if (snapshotGeneration !== undefined && snapshotGeneration !== internal.discoveryGeneration) {
            return reloadAfterStaleGeneration().then(function () { return { ok: false, error: 'stale-generation' }; });
          }
          if (snapshotGeneration === undefined) {
            return reloadAfterStaleGeneration().then(function () { return { ok: false, error: 'missing-snapshot-generation' }; });
          }
          var discovery = readGlobal('discovery');
          var normalized = discovery && typeof discovery.normalizeState === 'function' ? discovery.normalizeState(nextState) : clone(nextState);
          if (normalized && typeof normalized === 'object') delete normalized.__snapshotGeneration;
          if (isSilentTestOnly()) return { ok: false, error: 'test-silent' };
          if (!internal.dbUsable) return { ok: false, error: 'db-unavailable' };
          return writeDbState(normalized, null, { type: 'SAVE_STATE' }).then(function (writeResult) {
            if (isStaleGenerationResult(writeResult)) {
              return reloadAfterStaleGeneration().then(function () { return { ok: false, error: 'stale-generation' }; });
            }
            if (!writeResult || !writeResult.ok) {
              return reloadAfterStaleGeneration().then(function () {
                return { ok: false, error: (writeResult && (writeResult.error || writeResult.reason)) || 'write-failed' };
              });
            }
            if (isObject(writeResult.value)) internal.discoveryState = discovery && typeof discovery.normalizeState === 'function' ? discovery.normalizeState(writeResult.value) : writeResult.value;
            return { ok: true };
          });
        });
      },
      { ok: false, error: 'exception' }
    );
  }

  function setHintsEnabledDetailed(enabled) {
    return safeAsync(
      'set-hints',
      function () {
        var wanted = enabled !== false;
        /* 未 ready 时排队（等待 ready，而不是丢弃）。 */
      return waitReady(READY_TIMEOUT_MS).then(function () {
        return readCareerArchive();
      }).then(function (archive) {
        if (archive.archived) {
          var settings = readUi('settings');
          if (settings && typeof settings.apply === 'function') {
            try {
              settings.apply({
                hintsEnabled: currentStateSnapshot().hintsEnabled !== false,
                state: clone(currentStateSnapshot()),
                backup: backupFacade(),
                reducedMotion: reducedMotionPreferred(),
                api: api,
                archived: true,
                archiveState: archive,
                getCareerArchive: readCareerArchive,
                freezeCareer: freezeCareer,
                unfreezeCareer: unfreezeCareer,
                resetAllCareer: uiResetAllCareer,
              });
            } catch (err) {
              warnOnce('settings-apply', err);
            }
          }
          return { ok: false, error: 'career-archived', hintsEnabled: currentStateSnapshot().hintsEnabled !== false };
        }
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
          var applyHintsState = function (state) {
            var latest = isObject(state) ? state : next;
            internal.discoveryState = latest;
            var settings = readUi('settings');
            if (settings && typeof settings.apply === 'function') {
              try {
                var careerArchive = readCareerArchive();
                Promise.resolve(careerArchive).then(function (archive) {
                  settings.apply({
                    hintsEnabled: latest.hintsEnabled !== false,
                    state: clone(latest),
                    backup: backupFacade(),
                    reducedMotion: reducedMotionPreferred(),
                    api: api,
                    archived: archive.archived === true,
                    archiveState: archive,
                    getCareerArchive: readCareerArchive,
                    freezeCareer: freezeCareer,
                    unfreezeCareer: unfreezeCareer,
                    resetAllCareer: uiResetAllCareer,
                  });
                }).catch(function (err) {
                  warnOnce('settings-apply', err);
                });
              } catch (err) {
                warnOnce('settings-apply', err);
              }
            }
            return latest;
          };
          if (isSilentTestOnly() || !internal.dbUsable) {
            var local = applyHintsState(next);
            return { ok: true, hintsEnabled: local.hintsEnabled !== false, state: clone(local) };
          }
          return writeDbState(next, null, { type: 'SET_HINTS' }).then(function (writeResult) {
            if (!writeResult || writeResult.ok !== true || isStaleGenerationResult(writeResult)) {
              /* 代次冲突或普通写入失败：恢复 DB 最后已保存内容，不允许 UI/内存停在拟写入值。 */
              var error = isStaleGenerationResult(writeResult)
                ? 'stale-generation'
                : (writeResult && (writeResult.error || writeResult.reason)) || 'write-failed';
              if (!isStaleGenerationResult(writeResult)) warnOnce('db-write', error);
              return reloadAfterStaleGeneration().then(function () {
                var latest = applyHintsState(currentStateSnapshot());
                return { ok: false, error: error, hintsEnabled: latest.hintsEnabled !== false, state: clone(latest) };
              });
            }
            var applied = applyHintsState(isObject(writeResult.value) ? writeResult.value : next);
            return { ok: true, hintsEnabled: applied.hintsEnabled !== false, state: clone(applied) };
          });
        });
      },
      { ok: false, error: 'exception' }
    );
  }

  /** 公开 API 保持 ADR 的布尔返回；面板使用详细结果以区分“关闭成功”和“未保存”。 */
  function setHintsEnabled(enabled) {
    return Promise.resolve(setHintsEnabledDetailed(enabled)).then(function (result) {
      return !!(result && result.ok && result.hintsEnabled);
    });
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
    if (internal.careerArchived) return Promise.resolve({ ok: false, reason: 'career-archived' });
    var id = typeof clueId === 'string' ? clueId : isObject(clueId) && typeof clueId.clueId === 'string' ? clueId.clueId : '';
    if (!id) return Promise.resolve({ ok: false, reason: 'invalid-clue-id' });
    var state = currentStateSnapshot();
    if (!isObject(state.clues) || !state.clues[id]) return Promise.resolve({ ok: false, reason: 'not-discovered' });
    var discovery = readGlobal('discovery');
    var next = state;
    var professionEvents = [];
    if (discovery && typeof discovery.reduce === 'function') {
      try {
        var reduced = discovery.reduce(state, { type: 'CLUE_OPENED', clueId: id, at: nowIso() }, { clueConfigs: internal.clues, catalog: careerCatalog() });
        if (reduced && reduced.state) next = reduced.state;
        if (reduced && Array.isArray(reduced.professionEvents)) professionEvents = reduced.professionEvents;
      } catch (err) {
        warnOnce('open-clue-reduce', err);
        return Promise.resolve({ ok: false, reason: 'reduce-failed' });
      }
    }
    next.clues[id].openedAt = next.clues[id].openedAt || nowIso();
    if (!internal.dbUsable || isSilentTestOnly()) {
      internal.discoveryState = next;
      return Promise.resolve({ ok: true, clueId: id, state: clone(next) });
    }
    var clueAction = {
      type: 'CLUE_OPENED',
      clueId: id,
      gameId: state.clues[id].sourceGame || null,
      clueOpened: true,
      catalog: careerCatalog(),
      at: nowIso(),
      professionEvents: professionEvents,
    };
    if (professionEvents.length) clueAction.professionEvent = professionEvents[0];
    return Promise.resolve(writeDbState(next, null, clueAction)).then(function (writeResult) {
      if (!writeResult || writeResult.ok !== true) {
        var error = isStaleGenerationResult(writeResult) ? 'stale-generation' : (writeResult && (writeResult.error || writeResult.reason)) || 'write-failed';
        return reloadAfterStaleGeneration().then(function () { return { ok: false, reason: error }; });
      }
      if (isObject(writeResult.value)) {
        internal.discoveryState = discovery && typeof discovery.normalizeState === 'function' ? discovery.normalizeState(writeResult.value) : writeResult.value;
      } else {
        internal.discoveryState = next;
      }
      return { ok: true, clueId: id, state: clone(internal.discoveryState) };
    }).catch(function () {
      return { ok: false, reason: 'write-failed' };
    });
  }

  /** 投递信件（LETTER_FOLLOWED）：标记 LOCAL 并持久化；返回 {ok}，信箱据此显示告示。 */
  function followLetter() {
    return safeAsync(
      'follow-letter',
      function () {
        if (internal.careerArchived) return { ok: false, reason: 'career-archived', error: '生涯已封存，暂时不能投递新信。' };
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
        if (!internal.dbUsable || isSilentTestOnly()) {
          internal.discoveryState = next;
          return Promise.resolve({ ok: true, persisted: false, portSeenAt: next.portSeenAt, stage: next.stage });
        }
        return writeDbState(next, null, { type: 'LETTER_FOLLOWED' }).then(function (writeResult) {
          var persisted = !!(writeResult && writeResult.ok);
          if (!persisted) {
            var error = isStaleGenerationResult(writeResult) ? 'stale-generation' : (writeResult && (writeResult.error || writeResult.reason)) || 'write-failed';
            warnOnce('db-write', error);
            return reloadAfterStaleGeneration().then(function () {
              return { ok: false, persisted: false, error: error, portSeenAt: (internal.discoveryState && internal.discoveryState.portSeenAt) || null, stage: internal.discoveryState && internal.discoveryState.stage };
            });
          }
          if (isObject(writeResult.value)) {
            internal.discoveryState = discovery && typeof discovery.normalizeState === 'function' ? discovery.normalizeState(writeResult.value) : writeResult.value;
          } else {
            internal.discoveryState = next;
          }
          return { ok: true, persisted: true, portSeenAt: internal.discoveryState.portSeenAt, stage: internal.discoveryState.stage };
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
        return readCareerArchive().then(function (archive) {
          if (archive.archived) return { ok: false, error: 'career-archived', state: stateSnapshot() };
          if (!internal.dbUsable) return { ok: false, error: 'db-unavailable', state: stateSnapshot() };
          return resetDb().then(function (result) {
          var ok = !!(result && result.ok);
          if (!ok) {
            /* 清除失败：保留/恢复最后已保存线索，绝不先清空当页内存。 */
            return reloadAfterStaleGeneration().then(function () {
              return {
                ok: false,
                error: (result && (result.error || result.method)) || 'reset-failed',
                method: (result && result.method) || null,
                state: stateSnapshot(),
              };
            });
          }
          var discovery = readGlobal('discovery');
          internal.events = [];
          internal.seq = 0;
          internal.finished = false;
          internal.finishedResult = null;
          internal.rendered = {};
          internal.discoveryState = discovery && typeof discovery.initialState === 'function' ? discovery.initialState() : fallbackInitialState();
          if (Number.isFinite(Number(result.generation))) internal.discoveryGeneration = Math.floor(Number(result.generation));
          var surface = readUi('clueSurface');
          if (surface && typeof surface.clear === 'function') {
            try {
              surface.clear();
            } catch (err) {
              warnOnce('clue-clear', err);
            }
          }
          return {
            ok: true,
            error: null,
            method: (result && result.method) || null,
            state: stateSnapshot(),
          };
        });
        });
      },
      { ok: false, error: 'exception' }
    );
  }

  function freezeCareer() {
    return safeAsync('freeze-career', function () {
      var db = api.db || readGlobal('db');
      if (!db || typeof db.setCareerArchived !== 'function') return { ok: false, reason: 'archive-api-missing' };
      return Promise.resolve(db.setCareerArchived(true, { careerId: internal.commissionLastCareerId || null })).then(function (result) {
        if (!result || result.ok !== true) return result || { ok: false, reason: 'archive-failed' };
        applyArchiveSnapshot({ archived: true, careerId: result.careerId || internal.commissionArchiveCareerId, archivedAt: nowIso() });
        internal.commissionRun = null;
        api.commissionRun = null;
        clearStoredTicket();
        clearRentalMarker();
        internal.events = [];
        internal.seq = 0;
        var surface = readUi('clueSurface');
        if (surface && typeof surface.clear === 'function') surface.clear();
        notifyCareerDataChanged('career-archived');
        return { ok: true, archived: true, careerId: result.careerId || null, generation: result.generation };
      });
    }, { ok: false, reason: 'exception' });
  }

  function unfreezeCareer() {
    return safeAsync('unfreeze-career', function () {
      var db = api.db || readGlobal('db');
      if (!db || typeof db.setCareerArchived !== 'function') return { ok: false, reason: 'archive-api-missing' };
      return Promise.resolve(db.setCareerArchived(false, { careerId: internal.commissionLastCareerId || null })).then(function (result) {
        if (!result || result.ok !== true) return result || { ok: false, reason: 'archive-failed' };
        applyArchiveSnapshot({ archived: false, careerId: result.careerId || null, archivedAt: null });
        return loadDiscoveryStateFromDb().then(function () {
          notifyCareerDataChanged('career-unarchived');
          return { ok: true, archived: false, careerId: result.careerId || null, generation: result.generation };
        });
      });
    }, { ok: false, reason: 'exception' });
  }

  function uiResetAllCareer() {
    return safeAsync('reset-all-career', function () {
      var db = api.db || readGlobal('db');
      if (!db || typeof db.resetAllCareer !== 'function') return { ok: false, reason: 'reset-api-missing' };
      return Promise.resolve(db.resetAllCareer()).then(function (result) {
        if (!result || result.ok !== true) return result || { ok: false, reason: 'reset-failed' };
        internal.events = [];
        internal.commissionEvents = [];
        internal.endingEvents = [];
        internal.seq = 0;
        internal.commissionSeq = 0;
        internal.commissionRun = null;
        api.commissionRun = null;
        internal.commissionLastCareerId = null;
        internal.finished = false;
        internal.finishedResult = null;
        internal.rendered = {};
        clearStoredTicket();
        clearRentalMarker();
        applyArchiveSnapshot({ archived: false, careerId: null, archivedAt: null });
        if (Number.isFinite(Number(result.generation))) internal.discoveryGeneration = Math.floor(Number(result.generation));
        var discovery = readGlobal('discovery');
        internal.discoveryState = discovery && typeof discovery.initialState === 'function' ? discovery.initialState() : fallbackInitialState();
        var surface = readUi('clueSurface');
        if (surface && typeof surface.clear === 'function') surface.clear();
        notifyCareerDataChanged('career-reset');
        return { ok: true, generation: result.generation };
      });
    }, { ok: false, reason: 'exception' });
  }

  /** bridge 传给 UI 模块的统一上下文（mailbox/settings 只读消费，缺字段按空处理）。 */
  function uiContext(extra) {
    var context = {
      state: stateSnapshot(),
      clues: cluesSnapshot(),
      originIntro: originIntro,
      /* 0.20 首封信身份/正文：mailbox/town 用稳定字段，不必在 UI 侧翻 chapters map。 */
      chapterZero: internal.chapterFiles && internal.chapterFiles.C0 ? clone(internal.chapterFiles.C0) : null,
      originLetter: originLetter,
      openClue: markClueOpened,
      followLetter: followLetter,
      setHintsEnabled: setHintsEnabledDetailed,
      resetDiscovery: uiResetDiscovery,
      careerArchived: internal.careerArchived,
      careerArchiveCareerId: internal.careerArchiveCareerId,
      careerArchivedAt: internal.careerArchivedAt,
      getCareerArchive: readCareerArchive,
      freezeCareer: freezeCareer,
      unfreezeCareer: unfreezeCareer,
      resetAllCareer: uiResetAllCareer,
      archived: internal.careerArchived === true,
      archiveState: {
        archived: internal.careerArchived === true,
        careerId: internal.careerArchiveCareerId || null,
        archivedAt: internal.careerArchivedAt || null,
      },
      announce: announceToUser,
      backup: backupFacade(),
      reducedMotion: reducedMotionPreferred(),
      api: api,
      commission: commissionForUi(),
      professionView: professionViewModule(),
      careerView: careerView,
      invitationForClue: invitationForClue,
      onCareerDataChanged: onCareerDataChanged,
      invalidateCareerData: invalidateCareerData,
      careerCatalog: careerCatalog,
      /* 0.20 只读 continuation 查询：告示板可直接 ctx.careerContinuations({careerId})，
         也可经 ctx.commission.continuations；两者是同一只读方法，无新 ctx 字段依赖。 */
      careerContinuations: careerContinuations,
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
        if (internal.careerArchived) return uiUnavailable('career-archived');
        warmLazyModules();
        var mailbox = readUi('mailbox');
        if (!mailbox) return uiUnavailable('ui-unavailable');
        var target = typeof mailbox.open === 'function' ? mailbox.open : typeof mailbox.show === 'function' ? mailbox.show : null;
        if (!target) return uiUnavailable('ui-unavailable');
        try {
          var returned = target.call(mailbox, uiContext());
          addHubReturnLink(returned);
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
        var settingsContext = uiContext({
          hintsEnabled: currentStateSnapshot().hintsEnabled !== false,
          getCareerArchive: readCareerArchive,
          freezeCareer: freezeCareer,
          unfreezeCareer: unfreezeCareer,
          resetAllCareer: uiResetAllCareer,
        });
        return readCareerArchive().then(function (archive) {
          settingsContext.archived = archive.archived === true;
          settingsContext.archiveState = archive;
          try {
            var returned = target.call(settings, settingsContext);
            if (returned && typeof returned.then === 'function') {
              Promise.resolve(returned).catch(function (err) {
                warnOnce('open-settings', err);
              });
            }
            return { ok: true };
          } catch (err) {
            warnOnce('open-settings', err);
            return uiUnavailable('ui-error');
          }
        }).catch(function (err) {
          warnOnce('open-settings', err);
          return uiUnavailable('archive-read-failed');
        });
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

  /** 读信和告示板只沿用已确认身份；全新档返回 identityIssue，绝不 ensureCareer。 */
  function resolveStoryCareer(db) {
    if (internal.commissionLastCareerId) return Promise.resolve({ careerId: internal.commissionLastCareerId });
    if (!db || typeof db.readHubEntry !== 'function') return Promise.resolve({ issue: 'hub-entry-unavailable' });
    return Promise.resolve(db.readHubEntry()).then(function (entry) {
      if (!entry || !entry.ok) return { issue: 'hub-entry-unavailable' };
      if (entry.archived) return { issue: 'career-archived' };
      if (entry.careerId) return { careerId: entry.careerId };
      if (entry.started) return { issue: entry.issue || 'incomplete-career' };
      return { issue: 'no-career' };
    }).catch(function () {
      return { issue: 'hub-entry-unavailable' };
    });
  }

  /** 章节/信箱打开前的剧情快照：真实 quests/wallet/equipment（失败不阻塞 UI）。 */
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
    return resolveStoryCareer(db).then(function (career) {
      if (career && career.careerId) {
        internal.commissionLastCareerId = career.careerId;
        return read(career.careerId);
      }
      if (career && career.issue) return { identityIssue: career.issue };
      return read(null);
    }).catch(function () { return { identityIssue: 'hub-entry-unavailable' }; });
  }

  /** 当前 DB 是否仍有至少一条发现线索；C0 只允许在真实有效读信后推进。 */
  function hasCurrentDiscoveryClue() {
    var db = api.db || readGlobal('db');
    if (db && typeof db.getDiscoverySnapshot === 'function') {
      try {
        return Promise.resolve(db.getDiscoverySnapshot()).then(function (snapshot) {
          return !!(snapshot && snapshot.ok === true && snapshot.state && isObject(snapshot.state.clues) && Object.keys(snapshot.state.clues).length > 0);
        }).catch(function () { return false; });
      } catch (err) {
        return Promise.resolve(false);
      }
    }
    var state = currentStateSnapshot();
    return Promise.resolve(!!(state && isObject(state.clues) && Object.keys(state.clues).length > 0));
  }

  /** 打开信箱/告示板后同步 C0/C1 章节旗标（幂等；缺模块/DB 时静默）。 */
  function syncCampaignFlags(mailboxOpened) {
    if (internal.careerArchived) return Promise.resolve(null);
    var mod = readGlobal('campaign');
    var db = api.db || readGlobal('db');
    if (!mod || typeof mod.syncFlags !== 'function' || !db) return null;
    var gate = mailboxOpened === true ? hasCurrentDiscoveryClue() : Promise.resolve(true);
    try {
      return Promise.resolve(gate)
        .then(function (allowed) {
          if (!allowed) return null;
          return resolveStoryCareer(db)
            .then(function (career) {
              if (!career || !career.careerId) return null;
              internal.commissionLastCareerId = career.careerId;
              return mod.syncFlags({
                careerId: career.careerId,
                db: db,
                mailboxOpened: mailboxOpened === true,
                guard: mailboxOpened === true ? { generation: internal.discoveryGeneration, requireClue: true } : null,
              });
            });
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
        /* 兼容性空导入（旧经典档/无生涯）preserved:true 或 mode:none 必须零写入：
           不能在 ensureCareer/推进代次/重载之前产生任何写。 */
        if (result.preserved === true || result.mode === 'none') return result;
        /* 替换导入可能换生涯：同步当前页缓存的 careerId，章节/任务面板不能继续读旧生涯。 */
        var db = readGlobal('db');
        internal.commissionLastCareerId = null;
        var syncCareer = db && typeof db.readHubEntry === 'function'
          ? Promise.resolve(db.readHubEntry()).then(function (entry) {
              if (entry && entry.ok) internal.commissionLastCareerId = entry.careerId || null;
            }).catch(function () {})
          : Promise.resolve();
        return syncCareer
          .then(function () { return loadDiscoveryStateFromDb(); })
          .then(function () {
            notifyCareerDataChanged('career-imported');
            return result;
          });
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
    var route = readGlobal('router') && typeof readGlobal('router').careerEntryRequest === 'function'
      ? readGlobal('router').careerEntryRequest(inlineLocation())
      : { professionId: '', commissionId: '' };
    var requested = {
      professionId: isObject(extra) && extra.professionId ? extra.professionId : route.professionId,
      commissionId: isObject(extra) && extra.commissionId ? extra.commissionId : route.commissionId,
    };
    var gateCheck = requested.professionId || requested.commissionId
      ? careerEntryGate(Object.assign({}, requested, { gameId: api.gameId || null }))
      : Promise.resolve({ ok: true });
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
    /* 告示板首屏推荐由 campaign.recommend 推导，它要求已配置的 storyEvidence
       （isConfigured + storyFlags 真实规则），否则返回 null、没有 data-town-recommend-id。
       routePlanner 同属推荐/缺口链路，一并预装以保持一致（若后续 recommend 依赖它）。 */
    if (name === 'town') {
      extraModules.push('storyEvidence');
      extraModules.push('routePlanner');
    }
    var preloadList = [ensureLazyModule('commission'), ensureLazyModule('alternatives'), loadCareerContent()];
    extraModules.forEach(function (moduleName) {
      preloadList.push(ensureLazyModule(moduleName));
    });
    var preload = gateCheck.then(function (gate) {
      if (!gate || gate.ok !== true) return { __gateDenied: true, reason: (gate && gate.reason) || 'not-available' };
      return Promise.all(preloadList);
    }).then(function (preloaded) {
      if (preloaded && preloaded.__gateDenied) return preloaded;
      /* 必须在 loadStorySnapshot / UI ctx 之前用真实 commissions/campaign 内容配置
          storyEvidence 与 campaign；否则 campaign.recommend 因 evidence 模块未配置返回 null。 */
      configureCommissionContent();
      configureCareerModules();
      return configureRentalModule();
    }).then(function (prepared) {
      if (prepared && prepared.__gateDenied) return prepared;
      return loadStorySnapshot();
    });
    return preload.then(function (storySnapshot) {
      if (storySnapshot && storySnapshot.__gateDenied) return { ok: false, reason: storySnapshot.reason };
      if (storySnapshot && storySnapshot.identityIssue) return showHubEntryIssue(storySnapshot.identityIssue);
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
            commission: commissionForUi(),
            professionView: professionViewModule(),
            careerView: careerView,
            careerCatalog: careerCatalog,
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
            addHubReturnLink(returned);
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

  function openTown(input) {
    return requireCareerWritable().then(function (gate) {
      if (!gate.ok) {
        announceToUser(gate.message);
        return gate;
      }
      return openCareerUi('town', input);
    });
  }

  function openHangar(input) {
    return requireCareerWritable().then(function (gate) {
      if (!gate.ok) return gate;
      return openCareerUi('hangar', input);
    });
  }

  function openReceipt(input) {
    return openCareerUi('receipt', input);
  }

  function openMarket(input) {
    return requireCareerWritable().then(function (gate) {
      if (!gate.ok) return gate;
      return openCareerUi('market', input);
    });
  }

  function openWorkshop(input) {
    return requireCareerWritable().then(function (gate) {
      if (!gate.ok) return gate;
      return openCareerUi('workshop', input);
    });
  }

  function openCampaign(input) {
    return requireCareerWritable().then(function (gate) {
      if (!gate.ok) {
        announceToUser(gate.message);
        return gate;
      }
      return openCareerUi('worldState', input);
    });
  }

  function startEnding(approach) {
    return requireCareerWritable().then(function (gate) {
      if (!gate.ok) {
        announceToUser(gate.message);
        return gate;
      }
      return startEndingUnlocked(approach);
    });
  }

  function startEndingUnlocked(approach) {
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
        return Promise.resolve(marked).then(function (markResult) {
          if (!markResult || markResult.ok !== true) return markResult || uiUnavailable('not-discovered');
          var mailbox = readUi('mailbox');
          var surface = readUi('clueSurface');
          var targetHost = null;
          if (mailbox && (typeof mailbox.openClue === 'function' || typeof mailbox.open === 'function')) targetHost = mailbox;
          else if (surface && typeof surface.openClue === 'function') targetHost = surface;
          if (!targetHost) {
            /* 线索内容仍标记已读，只是没有可打开的 UI。 */
            return uiUnavailable('ui-unavailable');
          }
          var context = uiContext({ clue: clone(clue), clueId: clueId });
          try {
            var returned = null;
            if (typeof targetHost.openClue === 'function') returned = targetHost.openClue(clueId, context);
            else returned = targetHost.open(context);
            addHubReturnLink(returned);
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
        });
      },
      uiUnavailable('ui-unavailable')
    )).then(function (result) {
      /* 线索 chip 打开信箱是玩家的真实读信入口：成功打开后才补一次 C0（syncFlags 幂等）。 */
      if (result && result.ok === true) syncCampaignAtMailbox();
      return result;
    });
  }

  /**
   * 0.20 首封信身份与来源正文（叙事复审/告示板、信箱 Agent 的稳定只读字段）。
   *
   * 只从既有内容读取、不创建生涯、不改 IDB/localStorage/Schema：
   * - 依据 currentStateSnapshot().firstSourceGame 在 chapter-01.json 的 origins 找同 gameId 条目；
   * - 返回 { sourceGame, professionId, opening, c0Letter:{from,body,address}, firstStep }；
   * - 找不到首源游戏 / 内容未装载 / 条目缺 c0Letter.body 时返回 null（lead 冻结，不编造正文）。
   *
   * 注意 c0Letter.body 直接取 origins[i].c0Letter.body，保证玩家可读到首封来信正文；
   * originIntro() 仍是旧的 clues.json 派生短文案入口，两者互不覆盖。
   */
  function originLetter() {
    return safe(
      'origin-letter',
      function () {
        var state = currentStateSnapshot();
        if (!isObject(state)) return null;
        var sourceGame = typeof state.firstSourceGame === 'string' ? state.firstSourceGame : '';
        if (!sourceGame) return null;
        var chapter = internal.chapterContent;
        if (!isObject(chapter) || !Array.isArray(chapter.origins)) return null;
        var origin = null;
        for (var i = 0; i < chapter.origins.length; i += 1) {
          var candidate = chapter.origins[i];
          if (isObject(candidate) && candidate.gameId === sourceGame) {
            origin = candidate;
            break;
          }
        }
        if (!origin || !isObject(origin.c0Letter) || typeof origin.c0Letter.body !== 'string' || !origin.c0Letter.body) return null;
        return {
          sourceGame: sourceGame,
          professionId: typeof origin.professionId === 'string' ? origin.professionId : null,
          opening: typeof origin.opening === 'string' ? origin.opening : null,
          c0Letter: {
            from: typeof origin.c0Letter.from === 'string' ? origin.c0Letter.from : null,
            body: origin.c0Letter.body,
            address: typeof origin.c0Letter.address === 'string' ? origin.c0Letter.address : null,
          },
          firstStep: typeof origin.firstStep === 'string' ? origin.firstStep : null,
        };
      },
      null
    );
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
          careerArchived: internal.careerArchived,
          careerArchiveCareerId: internal.careerArchiveCareerId,
          careerArchivedAt: internal.careerArchivedAt,
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
            catalog: careerCatalog(),
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
          return writeDbState(normalized, records.length ? records : null, { type: 'SEED_STATE' }).then(function (writeResult) {
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
            if (resetResult && resetResult.ok && Number.isFinite(Number(resetResult.generation))) {
              internal.discoveryGeneration = Math.floor(Number(resetResult.generation));
            }
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
        var catalogClue = findClue(clue.clueId);
        if (!catalogClue || catalogClue.gameId !== clue.gameId) return { rendered: false, reason: 'unknown-clue' };
        var state = currentStateSnapshot();
        if (!isObject(state.clues) || !state.clues[clue.clueId]) return { rendered: false, reason: 'not-discovered' };
        return renderClue(catalogClue, state);
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

  function addHubReturnLink(opened) {
    if (!internal.hubPanel || !opened) return;
    var sheet = opened.panel || opened;
    if (typeof sheet.querySelector !== 'function') return;
    var head = sheet.querySelector('.ac-career-sheet__head');
    var back = sheet.ownerDocument.querySelector('.game-topbar .ac-back[href]');
    if (!head || !back || head.querySelector('.ac-career-hub-back')) return;
    var link = sheet.ownerDocument.createElement('a');
    link.className = 'ac-career-hub-back';
    link.href = back.href;
    link.textContent = '‹ 街机厅';
    link.setAttribute('aria-label', '返回街机厅');
    head.insertBefore(link, head.querySelector('.ac-career-close'));
  }

  function openLetterFromHub() {
    if (internal.careerArchived) return Promise.resolve({ ok: false, reason: 'career-archived' });
    if (isSilentTestOnly() || !api.available) return Promise.resolve(null);
    return waitReady(READY_TIMEOUT_MS).then(function () {
      var state = currentStateSnapshot();
      var records = isObject(state.clues) ? state.clues : {};
      var ids = Object.keys(records).filter(function (id) {
        return isObject(records[id]) && !!records[id].sourceGame && !!findClue(id);
      });
      if (!ids.length) return null;
      var unread = ids.filter(function (id) { return !records[id].openedAt; });
      var stage = state.stage;
      var pendingDelivery = !state.portSeenAt && (stage === 'GLIMPSED' || stage === 'CURIOUS');
      var clueId = null;
      if (unread.length) {
        clueId = typeof state.lastClueId === 'string' && unread.indexOf(state.lastClueId) >= 0
          ? state.lastClueId
          : (typeof state.firstClueId === 'string' && unread.indexOf(state.firstClueId) >= 0 ? state.firstClueId : unread[unread.length - 1]);
      } else if (pendingDelivery) {
        clueId = typeof state.firstClueId === 'string' && ids.indexOf(state.firstClueId) >= 0 ? state.firstClueId : ids[0];
      }
      if (!clueId) return null;
      internal.hubPanel = true;
      return openClue(clueId).then(function (result) {
        if (!result || result.ok !== true) internal.hubPanel = false;
        return result;
      }).catch(function () {
        internal.hubPanel = false;
        return null;
      });
    }).catch(function () { return null; });
  }

  function showHubEntryIssue(reason) {
    var messages = {
      'career-archived': '旧港生涯已封存。可以在街机厅的生涯设置里解冻。',
      'incomplete-career': '找到了旧港记录，但缺少接单所需的档案或工钱账册。可以在街机厅的生涯设置里导入原档备份。',
      'ambiguous-career': '本机有多份旧港记录，暂时无法确认要打开哪份。可以在街机厅的生涯设置里导入要继续的档案。',
      'no-career': '本机已找不到可以打开的旧港生涯。',
    };
    if (DOC && !DOC.querySelector('[data-career-hub-error]')) {
      var topbar = DOC.querySelector('.game-topbar');
      var back = DOC.querySelector('.game-topbar .ac-back[href]');
      var notice = DOC.createElement('section');
      notice.className = 'ac-noscript';
      notice.setAttribute('data-career-hub-error', reason);
      notice.setAttribute('role', 'alert');
      var text = DOC.createElement('p');
      text.textContent = messages[reason] || '暂时打不开旧港生涯，请稍后重试。';
      notice.appendChild(text);
      var homeEntry = DOC.querySelector('[data-career-entry]');
      if (homeEntry) {
        homeEntry.insertAdjacentElement('afterend', notice);
      } else {
        var link = DOC.createElement('a');
        link.className = 'ac-btn ac-btn-secondary';
        link.href = back ? back.href : '../index.html';
        link.textContent = '返回街机厅';
        notice.appendChild(link);
        if (topbar) topbar.insertAdjacentElement('afterend', notice);
        else DOC.body.appendChild(notice);
      }
    }
    return { ok: false, reason: reason };
  }

  async function openHubCareerPanel(panel) {
    await readyPromise;
    var db = api.db || readGlobal('db');
    if (panel === 'settings') {
      if (!api.available || !db) return;
      internal.hubPanel = true;
      return openSettings();
    }
    if (!api.available || !db || typeof db.readHubEntry !== 'function') return showHubEntryIssue('hub-entry-unavailable');
    try {
      var entry = await db.readHubEntry();
      if (!entry.ok) return showHubEntryIssue('hub-entry-unavailable');
      if (entry.archived || internal.careerArchived) return showHubEntryIssue('career-archived');
      if (!entry.careerId) return showHubEntryIssue(entry.issue || 'no-career');
      internal.hubPanel = true;
      internal.commissionLastCareerId = entry.careerId;
      var result = await (panel === 'town' ? openTown() : panel === 'mailbox' ? openCareerUi('mailbox') : openCampaign());
      return result && result.ok ? result : showHubEntryIssue('hub-entry-unavailable');
    } catch (err) {
      warnOnce('hub-career-panel', err);
      return showHubEntryIssue('hub-entry-unavailable');
    }
  }

  function finalizeReady() {
    try {
      api.gameId = api.gameId || null;
      api.reason = api.available ? null : internal.reason || 'unavailable';
      resolveReady({ available: !!api.available, reason: api.available ? undefined : api.reason });
      /* 中心页「旧港来信」回流入口：?story=1 时自动打开章节面板（仅真实 C0 后才有内容）。 */
      try {
        var route = readGlobal('router') && typeof readGlobal('router').careerEntryRequest === 'function'
          ? readGlobal('router').careerEntryRequest(WINDOW.location)
          : null;
        if (route && route.rawPanel) {
          if (!route.panel) {
            Promise.resolve().then(function () { return showHubEntryIssue('hub-entry-unavailable'); }).catch(function (err) { warnOnce('hub-career-panel', err); });
          } else {
            Promise.resolve().then(function () { return openHubCareerPanel(route.panel); }).catch(function (err) { warnOnce('hub-career-panel', err); });
          }
        } else if (route && route.careerLetter) {
          Promise.resolve().then(function () { return openLetterFromHub(); }).catch(function (err) { warnOnce('hub-career-letter', err); });
        } else if (route && route.story) {
          if (internal.careerArchived) announceToUser('生涯已封存。要读旧港来信，请先在生涯设置里解冻。');
          else Promise.resolve().then(function () { return openCampaign(); }).catch(function () {});
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
        if (internal.careerArchived) {
          internal.commissionRun = null;
          api.commissionRun = null;
          clearStoredTicket();
          clearRentalMarker();
        }
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
    api.getCareerArchive = readCareerArchive;
    api.freezeCareer = freezeCareer;
    api.unfreezeCareer = unfreezeCareer;
    api.resetAllCareer = uiResetAllCareer;
    api.setHintsEnabled = setHintsEnabled;
    api.saveState = saveState;
    api.originIntro = originIntro;
    /* 0.20 首封信身份/正文只读入口（与 ctx.originLetter 同函数）。 */
    api.originLetter = originLetter;
    /* 0.16 职业委托（向后兼容扩展）：无 ticket 时 commissionRun=null，行为与 0.15 相同。 */
    api.commission = commissionModule() || null;
    api.professionView = professionViewModule();
    api.careerView = careerView;
    api.invitationForClue = invitationForClue;
    api.onCareerDataChanged = onCareerDataChanged;
    api.invalidateCareerData = invalidateCareerData;
    api.acceptProfessionInvitation = acceptProfessionInvitation;
    api.setActiveProfession = setActiveProfession;
    api.setProfessionPaused = setProfessionPaused;
    api.careerArchived = false;
    /* 0.20 只读 continuation 查询：与 ctx.careerContinuations 同函数；不建 run、不自动导航。 */
    api.careerContinuations = careerContinuations;
    api.commissionRun = null;
    api.items = null;
    api.alternatives = readGlobal('alternatives') || null;
    api.rental = readGlobal('rental') || null;
    api.isCommissionRun = function () {
      return !!internal.commissionRun;
    };
    api.openTown = openTown;
    api.openHubCareerPanel = openHubCareerPanel;
    api.openHangar = openHangar;
    api.openReceipt = openReceipt;
    api.openMarket = openMarket;
    api.openWorkshop = openWorkshop;
    api.openCampaign = openCampaign;
    api.startEnding = startEnding;
    api.campaign = readGlobal('campaign') || null;
    api.ending = readGlobal('ending') || null;
    api.materials = readGlobal('materials') || null;
    api.crafting = readGlobal('crafting') || null;
    api.professions = readGlobal('professions') || null;
    api.storyEvidence = readGlobal('storyEvidence') || null;
    api.routePlanner = readGlobal('routePlanner') || null;
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
      'pageshow',
      function () {
        readCareerArchive().then(function () {
          if (internal.careerArchived) {
            internal.commissionRun = null;
            api.commissionRun = null;
            clearStoredTicket();
            clearRentalMarker();
          }
        });
      },
      false
    );
    WINDOW.addEventListener(
      'visibilitychange',
      function () {
        if (!DOC.hidden) readCareerArchive();
      },
      false
    );
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
