/*!
 * StudioKit Arcade Life — 委托生命周期（0.16，D16-02）
 *
 * 职责：委托目录规范化、可接委托列表、ticket 签发/校验、本页事件缓冲、
 * 目标判定编排、奖励计划编排、结算/放弃/恢复（docs/arcade-life/ADR-interfaces.md §7/§8/§18）。
 *
 * 边界（不得越界）：
 * - 纯 UMD：浏览器挂 window.ArcadeCareerCommission（并镜像 window.ArcadeCareer.commission，
 *   供 bridge 的 readGlobal('commission') 取得）；Node 中 module.exports 返回同一 API。
 * - 无网络、无 localStorage、无 DOM：内容由调用方注入（configure），ticket 走注入的
 *   Storage（默认 window.sessionStorage，缺失时静默降级）。
 * - 不自己写 IndexedDB：所有持久化只经 career-db 的公开方法；奖励金额只由
 *   career-core.rewardPlan 计算，本模块不发明数字、不按 score 换算。
 * - 所有公开方法异常捕获后返回结构化失败，绝不向调用方抛。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory(root, true);
    return;
  }
  var api = factory(root, false);
  root.ArcadeCareerCommission = api;
  /* bridge 按 DEPENDENCIES 的 global:'commission' 从 window.ArcadeCareer.commission 取模块；
     这里镜像挂载，保证 api.commission / ctx.commission 可用。 */
  var career = root.ArcadeCareer;
  if (!career || typeof career !== 'object') career = root.ArcadeCareer = {};
  if (career.commission !== api) {
    try {
      career.commission = api;
    } catch (err) {
      /* 只读宿主：忽略 */
    }
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root, isNode) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 常量
   * ------------------------------------------------------------------ */

  var VERSION = '0.16.0';
  var MODULE_VERSION = '0.16.0';
  /* 运行时内容版本：ticket / 收据上的 contentVersion（与 ADR §18.1 一致）。 */
  var CONTENT_VERSION = '0.16.0';
  var SCHEMA_VERSION = 1;
  var RULESET_VERSION = 1;
  var TICKET_SCHEMA_VERSION = 1;

  var MODE = 'commission';
  var TICKET_STORAGE_KEY = 'studiokit:arcade:career:ticket.v1';
  var TICKET_PARAM = 'career';
  var RUN_PREFIX = 'commission';
  /* 每 run 事件缓冲上限（ADR §18：本页事件只在内存，超限丢弃并计数）。 */
  var BUFFER_LIMIT = 400;
  var PAYLOAD_MAX_KEYS = 32;
  var PAYLOAD_MAX_BYTES = 2048;
  var STORED_TICKET_MAX_BYTES = 8192;

  /* 与 career-core 一致的 ID 形状（run/career 需可安全放进 URL 与 IndexedDB）。 */
  var RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
  var STABLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,119}$/;
  var GAME_ID_RE = /^[a-z0-9][a-z0-9._-]{1,79}$/;
  var NONCE_RE = /^[0-9a-f]{32,128}$/;

  var LIVE_STATUS = ['issued', 'active'];
  var SETTLED_STATUS = ['claimed', 'settled', 'claiming'];
  var FAILED_STATUS = ['failed', 'abandoned', 'cancelled', 'expired'];

  var RISK_VALUES = ['low', 'medium', 'high'];

  var REASONS = Object.freeze({
    coreUnavailable: 'core-unavailable',
    dbUnavailable: 'db-unavailable',
    contentUnavailable: 'content-unavailable',
    contentInvalid: 'content-invalid',
    unsupportedContent: 'unsupported-content',
    badCommissionId: 'bad-commission-id',
    missingCommission: 'missing-commission',
    locked: 'locked',
    runConflict: 'run-conflict',
    runCreateFailed: 'run-create-failed',
    noRun: 'no-run',
    badRun: 'bad-run',
    modeMismatch: 'mode-mismatch',
    gameMismatch: 'game-mismatch',
    ticketMismatch: 'ticket-mismatch',
    settled: 'settled',
    runFailed: 'run-failed',
    abandoned: 'abandoned',
    receiptUnavailable: 'receipt-unavailable',
    planFailed: 'plan-failed',
    claimFailed: 'claim-failed',
    careerUnavailable: 'career-unavailable',
    updateFailed: 'update-failed',
    exception: 'exception',
  });

  /* ------------------------------------------------------------------ *
   * 基础工具（纯 JS）
   * ------------------------------------------------------------------ */

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isFunction(value) {
    return typeof value === 'function';
  }

  function clone(value) {
    if (value === undefined) return undefined;
    try {
      var text = JSON.stringify(value);
      if (typeof text !== 'string') return null;
      return JSON.parse(text);
    } catch (err) {
      return null;
    }
  }

  function errorText(err) {
    if (!err) return 'unknown-error';
    if (typeof err === 'string') return err;
    try {
      if (err.name && err.message) return String(err.name) + ': ' + String(err.message);
      return String(err.message || err.name || 'unknown-error');
    } catch (e) {
      return 'unknown-error';
    }
  }

  function byteLength(text) {
    try {
      if (typeof TextEncoder === 'function') return new TextEncoder().encode(String(text)).length;
    } catch (err) {
      /* ignore */
    }
    return String(text).length;
  }

  function toNonNegInt(value, fallback) {
    var num = Number(value);
    if (!Number.isFinite(num)) return typeof fallback === 'number' ? fallback : 0;
    var floored = Math.floor(num);
    return floored < 0 ? 0 : floored;
  }

  function toPositiveInt(value, fallback) {
    var num = Number(value);
    if (!Number.isFinite(num) || Math.floor(num) < 1) return typeof fallback === 'number' ? fallback : 1;
    return Math.floor(num);
  }

  function trimText(value, max) {
    if (typeof value !== 'string') return '';
    var text = value.trim();
    if (max && text.length > max) text = text.slice(0, max);
    return text;
  }

  /**
   * 兼容主键：0.x 预发布版本链把 “0.<minor>” 当主键（0.15 与 0.16 不兼容，
   * 0.16.0/0.16.9 互相兼容）；>=1.0 只比 major。ADR §9 要求版本不一致拒绝委托结算。
   */
  function versionKey(version) {
    if (typeof version !== 'string') return null;
    var match = /^v?(\d+)\.(\d+)/.exec(version.trim());
    if (!match) return null;
    var major = parseInt(match[1], 10);
    var minor = parseInt(match[2], 10);
    if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
    return major === 0 ? '0.' + minor : String(major);
  }

  function versionsCompatible(version) {
    var a = versionKey(version);
    var b = versionKey(CONTENT_VERSION);
    return a !== null && b !== null && a === b;
  }

  function isRunId(value) {
    return typeof value === 'string' && RUN_ID_RE.test(value);
  }

  function isStableId(value) {
    return typeof value === 'string' && STABLE_ID_RE.test(value);
  }

  function isGameId(value) {
    return typeof value === 'string' && GAME_ID_RE.test(value);
  }

  function isLiveStatus(status) {
    return !status || LIVE_STATUS.indexOf(status) >= 0;
  }

  function isSettledStatus(status) {
    return SETTLED_STATUS.indexOf(status) >= 0;
  }

  function isFailedStatus(status) {
    return FAILED_STATUS.indexOf(status) >= 0;
  }

  function cryptoRef() {
    try {
      if (root && root.crypto) return root.crypto;
      if (typeof crypto !== 'undefined' && crypto) return crypto;
    } catch (err) {
      /* 隐私模式 / 非安全上下文 */
    }
    return null;
  }

  function hexFallback(length) {
    var out = '';
    while (out.length < length) {
      out += Math.floor(Math.random() * 0x100000000)
        .toString(16)
        .slice(-8);
    }
    return out.slice(0, length).replace(/[^0-9a-f]/g, '0');
  }

  /** ticket nonce：ADR §3.3 要求 >=32 hex；crypto 不可用时退化为确定性随机（非安全用途）。 */
  function makeNonce() {
    var api = cryptoRef();
    if (api && isFunction(api.getRandomValues)) {
      try {
        var buffer = new Uint8Array(16);
        api.getRandomValues(buffer);
        var out = '';
        for (var i = 0; i < buffer.length; i += 1) {
          out += (buffer[i] + 256).toString(16).slice(1);
        }
        if (NONCE_RE.test(out)) return out;
      } catch (err) {
        /* 落到回退 */
      }
    }
    var fallback = hexFallback(32);
    return NONCE_RE.test(fallback) ? fallback : '00000000000000000000000000000000';
  }

  function makeSeed() {
    return 'seed-' + hexFallback(16);
  }

  /* ------------------------------------------------------------------ *
   * 内容目录规范化（commissions.json → 不可变委托对象）
   * ------------------------------------------------------------------ */

  function normalizeReward(raw, id, errors) {
    var reward = { credits: 0, items: {}, evidence: [], flags: [] };
    if (raw === undefined || raw === null) return reward;
    if (!isObject(raw)) {
      errors.push('reward-invalid:' + id);
      return reward;
    }
    reward.credits = Math.floor(toNonNegInt(raw.credits, 0));
    if (isObject(raw.items)) {
      Object.keys(raw.items).forEach(function (itemId) {
        if (!isStableId(itemId)) return;
        var count = toNonNegInt(raw.items[itemId], 0);
        if (count > 0) reward.items[itemId] = count;
      });
    } else if (raw.items !== undefined && raw.items !== null) {
      errors.push('reward-items-invalid:' + id);
    }
    reward.evidence = normalizeTokenList(raw.evidence);
    reward.flags = normalizeTokenList(raw.flags);
    return reward;
  }

  function normalizeTokenList(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length; i += 1) {
      var value = raw[i];
      if (!isStableId(value)) continue;
      if (out.indexOf(value) >= 0) continue;
      out.push(value);
    }
    return out;
  }

  function normalizeObjective(raw, id, errors) {
    if (!isObject(raw)) {
      errors.push('objective-invalid:' + id);
      return null;
    }
    if (!isStableId(raw.kind)) {
      errors.push('objective-kind-invalid:' + id);
      return null;
    }
    var context = {};
    if (raw.context !== undefined && raw.context !== null) {
      if (!isObject(raw.context)) {
        errors.push('objective-context-invalid:' + id);
        return null;
      }
      var fields = Object.keys(raw.context);
      for (var i = 0; i < fields.length; i += 1) {
        var field = fields[i];
        var value = raw.context[field];
        if (!isStableId(field)) {
          errors.push('objective-context-field-invalid:' + id);
          return null;
        }
        /* career-core.validateCommission 的 context 只支持原始值相等（区间 {gte,lte} 不支持），
           遇到区间直接判为非法条目，避免“内容以为能过、运行时永远不匹配”。 */
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
          errors.push('objective-context-unsupported:' + id);
          return null;
        }
        context[field] = value;
      }
    }
    return { kind: raw.kind, atLeast: toPositiveInt(raw.atLeast, 1), context: context };
  }

  var UNLOCK_PREDICATE_KEYS = [
    'all',
    'any',
    'capability',
    'evidence',
    'chapterFlag',
    'commissionCleared',
    'item',
    'credits',
  ];

  /** unlock 条件：支持 §18.2 的 {kind,value} 描述符与 §6 的谓词 JSON。无法识别返回 null。 */
  function normalizeUnlockNode(raw) {
    if (!isObject(raw)) return null;
    if (raw.all !== undefined) {
      if (!Array.isArray(raw.all)) return null;
      var all = [];
      for (var i = 0; i < raw.all.length; i += 1) {
        var childAll = normalizeUnlockNode(raw.all[i]);
        if (!childAll) return null;
        all.push(childAll);
      }
      return { all: all };
    }
    if (raw.any !== undefined) {
      if (!Array.isArray(raw.any)) return null;
      var any = [];
      for (var j = 0; j < raw.any.length; j += 1) {
        var childAny = normalizeUnlockNode(raw.any[j]);
        if (!childAny) return null;
        any.push(childAny);
      }
      return { any: any };
    }
    if (typeof raw.kind === 'string') {
      var value = raw.value;
      var atLeast = Number(raw.atLeast);
      var need = Number.isFinite(atLeast) && atLeast > 0 ? Math.floor(atLeast) : 1;
      if (raw.kind === 'chapterFlag' || raw.kind === 'evidence' || raw.kind === 'capability' || raw.kind === 'commissionCleared') {
        if (!isStableId(value)) return null;
        var single = {};
        single[raw.kind] = value;
        return single;
      }
      if (raw.kind === 'item') {
        if (!isStableId(value)) return null;
        return { item: value, atLeast: need };
      }
      if (raw.kind === 'credits') {
        var creditsNeed = Number.isFinite(atLeast) && atLeast > 0 ? Math.floor(atLeast) : 0;
        return { credits: { atLeast: creditsNeed } };
      }
      return null;
    }
    /* 原生谓词直接声明（如 {"chapterFlag":"C1.work_done"}） */
    if (isStableId(raw.chapterFlag)) return { chapterFlag: raw.chapterFlag };
    if (isStableId(raw.evidence)) return { evidence: raw.evidence };
    if (isStableId(raw.capability)) return { capability: raw.capability };
    if (isStableId(raw.commissionCleared)) return { commissionCleared: raw.commissionCleared };
    if (isStableId(raw.item)) {
      var itemNeed = Number(raw.atLeast);
      return { item: raw.item, atLeast: Number.isFinite(itemNeed) && itemNeed > 0 ? Math.floor(itemNeed) : 1 };
    }
    if (isObject(raw.credits)) {
      var creditNeed = Number(raw.credits.atLeast);
      return { credits: { atLeast: Number.isFinite(creditNeed) && creditNeed > 0 ? Math.floor(creditNeed) : 0 } };
    }
    return null;
  }

  function normalizeUnlock(raw, id, errors, warnings) {
    if (raw === undefined || raw === null) return { all: [] };
    if (!isObject(raw)) {
      errors.push('unlock-invalid:' + id);
      return null;
    }
    if (!Object.keys(raw).length) return { all: [] };
    var node = normalizeUnlockNode(raw);
    if (!node) {
      errors.push('unlock-invalid:' + id);
      return null;
    }
    var unknown = Object.keys(raw).filter(function (key) {
      return key !== 'kind' && key !== 'value' && key !== 'atLeast' && UNLOCK_PREDICATE_KEYS.indexOf(key) < 0;
    });
    if (unknown.length) warnings.push('unlock-ignored-keys:' + id + ':' + unknown.join(','));
    return node;
  }

  function tierOf(raw, commissionId) {
    var tier = Number(raw.tier);
    if (Number.isFinite(tier) && tier > 0) return Math.floor(tier);
    var match = /\.T(\d+)$/.exec(commissionId);
    return match ? parseInt(match[1], 10) : 1;
  }

  /**
   * 单条委托规范化；非法条目返回 null 并把原因写入 errors（绝不抛）。
   * @returns {object|null}
   */
  function normalizeCommission(raw, errors, warnings) {
    if (!isObject(raw)) {
      errors.push('commission-not-object');
      return null;
    }
    var commissionId = typeof raw.commissionId === 'string' ? raw.commissionId : '';
    if (!isStableId(commissionId)) {
      errors.push('commission-id-invalid:' + (commissionId || '<empty>'));
      return null;
    }
    if (!isGameId(raw.gameId)) {
      errors.push('commission-game-invalid:' + commissionId);
      return null;
    }
    if (!isGameId(raw.professionId)) {
      errors.push('commission-profession-invalid:' + commissionId);
      return null;
    }
    var objective = normalizeObjective(raw.objective, commissionId, errors);
    if (!objective) return null;
    var unlock = normalizeUnlock(raw.unlock, commissionId, errors, warnings);
    if (!unlock) return null;

    var title = trimText(raw.title, 80);
    var summary = trimText(raw.summary, 200);
    var issuer = trimText(raw.issuer, 80);
    if (!title) {
      errors.push('commission-title-missing:' + commissionId);
      return null;
    }
    if (!summary) {
      errors.push('commission-summary-missing:' + commissionId);
      return null;
    }
    if (!issuer) {
      errors.push('commission-issuer-missing:' + commissionId);
      return null;
    }
    if (typeof raw.title === 'string' && raw.title.trim().length > 80) warnings.push('title-truncated:' + commissionId);
    if (typeof raw.summary === 'string' && raw.summary.trim().length > 200) warnings.push('summary-truncated:' + commissionId);
    if (!isObject(raw.startParams) && raw.startParams !== undefined && raw.startParams !== null) {
      warnings.push('start-params-ignored:' + commissionId);
    }

    var risk = typeof raw.risk === 'string' && RISK_VALUES.indexOf(raw.risk) >= 0 ? raw.risk : 'low';
    if (raw.risk !== undefined && risk !== raw.risk) warnings.push('risk-normalized:' + commissionId);

    var startParams = {};
    if (isObject(raw.startParams)) {
      Object.keys(raw.startParams).forEach(function (key) {
        if (!isStableId(key)) return;
        var value = raw.startParams[key];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') startParams[key] = value;
      });
    }

    return {
      commissionId: commissionId,
      gameId: raw.gameId,
      professionId: raw.professionId,
      tier: tierOf(raw, commissionId),
      title: title,
      summary: summary,
      issuer: issuer,
      objective: objective,
      objectiveBonus: Math.floor(toNonNegInt(raw.objectiveBonus, 0)),
      startParams: startParams,
      reward: normalizeReward(raw.reward, commissionId, errors),
      repeatSalaryCredits: Math.floor(toNonNegInt(raw.repeatSalaryCredits, 0)),
      unlock: unlock,
      risk: risk,
      durationHint: trimText(raw.durationHint, 80),
    };
  }

  /**
   * 目录规范化。接受 {contentVersion, commissions:[...]} 或裸数组。
   * 返回 {contentVersion, commissions, errors, warnings, usable}；usable=false 时接单/结算都应拒绝。
   */
  function normalizeContent(raw) {
    var errors = [];
    var warnings = [];
    var contentVersion = '';
    var usable = true;
    var list = [];

    if (Array.isArray(raw)) {
      list = raw;
    } else if (isObject(raw)) {
      if (typeof raw.contentVersion === 'string' && raw.contentVersion) {
        contentVersion = raw.contentVersion.trim();
      } else {
        warnings.push('content-version-missing');
      }
      if (Array.isArray(raw.commissions)) {
        list = raw.commissions;
      } else {
        errors.push('commissions-not-array');
        usable = false;
      }
    } else if (raw === undefined || raw === null) {
      errors.push('content-missing');
      usable = false;
    } else {
      errors.push('content-invalid');
      usable = false;
    }

    if (contentVersion && !versionsCompatible(contentVersion)) {
      errors.push('content-version-mismatch:' + contentVersion);
      usable = false;
    }

    var commissions = [];
    var seen = Object.create(null);
    for (var i = 0; i < list.length; i += 1) {
      var clean = normalizeCommission(list[i], errors, warnings);
      if (!clean) continue;
      if (seen[clean.commissionId]) {
        errors.push('commission-duplicate:' + clean.commissionId);
        continue;
      }
      seen[clean.commissionId] = true;
      commissions.push(clean);
    }
    return {
      contentVersion: contentVersion || CONTENT_VERSION,
      commissions: commissions,
      errors: errors,
      warnings: warnings,
      usable: usable && errors.length === 0,
    };
  }

  /* ------------------------------------------------------------------ *
   * 工厂
   * ------------------------------------------------------------------ */

  function createCommissionCore(options) {
    var opts = isObject(options) ? options : {};

    var injectedDb = opts.db || null;
    var injectedCore = opts.core || null;
    var injectedStorage = opts.storage !== undefined ? opts.storage : undefined;
    var injectedNow = isFunction(opts.now) ? opts.now : null;

    var nodeCore = null;
    if (isNode && typeof require === 'function') {
      try {
        nodeCore = require('./career-core.js');
      } catch (err) {
        nodeCore = null;
      }
    }

    var state = {
      content: null,
      contentErrors: [],
      contentWarnings: [],
      runs: Object.create(null),
      currentTicketId: null,
      lastResult: null,
      lastEventAt: null,
    };

    /* ---------------- 依赖解析 ---------------- */

    function resolveCore() {
      if (injectedCore) return injectedCore;
      if (nodeCore) return nodeCore;
      if (root && root.ArcadeCareer && root.ArcadeCareer.core) return root.ArcadeCareer.core;
      return null;
    }

    function resolveDb() {
      if (injectedDb) return injectedDb;
      if (root && root.ArcadeCareer && root.ArcadeCareer.db) return root.ArcadeCareer.db;
      return null;
    }

    function nowIso() {
      if (injectedNow) {
        try {
          var value = injectedNow();
          if (typeof value === 'string' && value) return value;
        } catch (err) {
          /* 落到系统时间 */
        }
      }
      return new Date().toISOString();
    }

    function storageRef() {
      if (injectedStorage !== undefined) return injectedStorage;
      try {
        if (root && root.sessionStorage) return root.sessionStorage;
      } catch (err) {
        /* 隐私模式 / 沙箱 */
      }
      return null;
    }

    /* ---------------- 内容 ---------------- */

    function applyContent(raw) {
      var normalized = normalizeContent(raw);
      state.content = {
        contentVersion: normalized.contentVersion,
        commissions: normalized.commissions,
        usable: normalized.usable,
      };
      state.contentErrors = normalized.errors.slice();
      state.contentWarnings = normalized.warnings.slice();
      return normalized;
    }

    /** 未显式 configure 时，尝试从宿主读 0.16 内容（bridge 若导出则可用；不发起网络请求）。 */
    function ensureContent() {
      if (state.content) return state.content;
      var career = root && root.ArcadeCareer ? root.ArcadeCareer : null;
      if (!career) return null;
      var candidate = career.commissions || career.commissionContent || null;
      if (candidate) applyContent(candidate);
      return state.content;
    }

    function findCommission(commissionId) {
      var content = ensureContent();
      if (!content || !isStableId(commissionId)) return null;
      for (var i = 0; i < content.commissions.length; i += 1) {
        if (content.commissions[i].commissionId === commissionId) return clone(content.commissions[i]);
      }
      return null;
    }

    /* ---------------- ticket 存储 ---------------- */

    function readStoredTicket() {
      var storage = storageRef();
      if (!storage || !isFunction(storage.getItem)) return null;
      try {
        var raw = storage.getItem(TICKET_STORAGE_KEY);
        if (!raw || typeof raw !== 'string' || raw.length > STORED_TICKET_MAX_BYTES) return null;
        var parsed = JSON.parse(raw);
        return isObject(parsed) ? parsed : null;
      } catch (err) {
        return null;
      }
    }

    function writeStoredTicket(ticket) {
      var storage = storageRef();
      if (!storage || !isFunction(storage.setItem)) return false;
      try {
        var text = JSON.stringify(ticket);
        if (typeof text !== 'string' || text.length > STORED_TICKET_MAX_BYTES) return false;
        storage.setItem(TICKET_STORAGE_KEY, text);
        return true;
      } catch (err) {
        return false;
      }
    }

    function clearStoredTicket(ticketId) {
      var storage = storageRef();
      if (!storage || !isFunction(storage.removeItem)) return false;
      try {
        if (ticketId) {
          var current = readStoredTicket();
          if (current && current.ticketId && current.ticketId !== ticketId) return false;
        }
        storage.removeItem(TICKET_STORAGE_KEY);
        return true;
      } catch (err) {
        return false;
      }
    }

    /* ---------------- 内存 run 登记 / 事件缓冲 ---------------- */

    function entryOf(ticketId) {
      return ticketId && state.runs[ticketId] ? state.runs[ticketId] : null;
    }

    function rememberRun(ticket, run) {
      var ticketId = ticket && ticket.ticketId ? ticket.ticketId : null;
      if (!ticketId) return null;
      var entry = state.runs[ticketId] || { ticketId: ticketId, buffer: [], dropped: 0 };
      entry.careerId = ticket.careerId || (run && run.careerId) || null;
      entry.commissionId = ticket.commissionId || (run && run.commissionId) || null;
      entry.gameId = ticket.gameId || (run && run.gameId) || null;
      entry.mode = MODE;
      entry.ticket = clone(ticket);
      if (run) entry.run = clone(run);
      state.runs[ticketId] = entry;
      state.currentTicketId = ticketId;
      return entry;
    }

    function forgetTicket(ticketId) {
      var entry = entryOf(ticketId);
      if (entry) {
        entry.buffer = [];
        entry.dropped = 0;
        entry.run = null;
      }
      clearStoredTicket(ticketId);
    }

    function sanitizePayload(raw) {
      if (!isObject(raw)) return {};
      var out = {};
      var keys = Object.keys(raw);
      var used = 0;
      for (var i = 0; i < keys.length && used < PAYLOAD_MAX_KEYS; i += 1) {
        var key = keys[i];
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        if (!isStableId(key)) continue;
        var value = raw[key];
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
        if (typeof value === 'string' && value.length > 120) continue;
        out[key] = value;
        used += 1;
      }
      try {
        if (byteLength(JSON.stringify(out)) > PAYLOAD_MAX_BYTES) return {};
      } catch (err) {
        return {};
      }
      return out;
    }

    /* ---------------- 生涯上下文 / unlock ---------------- */

    function isQuestCleared(questState, commissionId) {
      if (!isObject(questState) || !isStableId(commissionId)) return false;
      var byNode = isObject(questState.byNode) ? questState.byNode : null;
      if (byNode && byNode[commissionId] && byNode[commissionId].status === 'cleared') return true;
      var list = Array.isArray(questState.quests) ? questState.quests : [];
      for (var i = 0; i < list.length; i += 1) {
        var row = list[i];
        if (!isObject(row)) continue;
        if (row.nodeId !== commissionId && row.commissionId !== commissionId) continue;
        if (row.status === 'cleared') return true;
      }
      return false;
    }

    async function readCareerContext(careerId) {
      var core = resolveCore();
      var db = resolveDb();
      var questState = { ok: false, quests: [] };
      var wallet = null;
      var profile = null;
      if (db && careerId) {
        try {
          var quests = await db.readQuestState(careerId);
          if (quests && quests.ok) questState = quests;
        } catch (err) {
          questState = { ok: false, quests: [] };
        }
        if (isFunction(db.readWallet)) {
          try {
            var readWallet = await db.readWallet(careerId);
            if (readWallet && readWallet.ok) wallet = readWallet;
          } catch (err) {
            wallet = null;
          }
        }
        if (isFunction(db.getProfile)) {
          try {
            profile = await db.getProfile(careerId);
          } catch (err) {
            profile = null;
          }
        }
      }
      var context = null;
      if (core && isFunction(core.storyContextFrom)) {
        try {
          context = core.storyContextFrom({
            profile: isObject(profile) ? profile : {},
            wallet: isObject(wallet) ? wallet : {},
            quests: Array.isArray(questState.quests) ? questState.quests : [],
          });
        } catch (err) {
          context = null;
        }
      }
      return { careerId: careerId || null, questState: questState, wallet: wallet, profile: profile, context: context };
    }

    function isUnlocked(commission, context) {
      var core = resolveCore();
      if (!isObject(commission) || !isObject(commission.unlock)) return false;
      if (!core || !isFunction(core.resolveStory)) return false;
      try {
        return core.resolveStory(commission.unlock, context || {}) === true;
      } catch (err) {
        return false;
      }
    }

    async function resolveCareer(input, ensureWanted) {
      var core = resolveCore();
      var db = resolveDb();
      var requested = input && isRunIdSafe(input.careerId) ? input.careerId : null;
      if (!requested && ensureWanted) {
        if (!db) return { ok: false, reason: REASONS.dbUnavailable, careerId: null };
        var originGameId = input && typeof input.originGameId === 'string' ? input.originGameId : null;
        var ensured = null;
        try {
          ensured = await db.ensureCareer({ originGameId: originGameId, now: nowIso() });
        } catch (err) {
          ensured = null;
        }
        if (!ensured || !ensured.ok || !core || !core.isValidCareerId(ensured.careerId)) {
          return { ok: false, reason: (ensured && ensured.reason) || REASONS.careerUnavailable, careerId: null };
        }
        requested = ensured.careerId;
        var createdCtx = await readCareerContext(requested);
        createdCtx.created = ensured.created === true;
        return Object.assign({ ok: true }, createdCtx);
      }
      var context = await readCareerContext(requested);
      return Object.assign({ ok: true, created: false }, context);
    }

    function isRunIdSafe(value) {
      var core = resolveCore();
      if (core && isFunction(core.isValidCareerId)) return core.isValidCareerId(value);
      return isRunId(value);
    }

    /* ---------------- ticket 形状 ---------------- */

    function ticketUrl(ticket) {
      try {
        return '../games/' + ticket.gameId + '.html?' + TICKET_PARAM + '=' + encodeURIComponent(ticket.ticketId);
      } catch (err) {
        return '../games/' + ticket.gameId + '.html?' + TICKET_PARAM + '=' + ticket.ticketId;
      }
    }

    function ticketFromRun(run, commission) {
      if (!isObject(run)) return null;
      var ticketId = typeof run.ticketId === 'string' && run.ticketId ? run.ticketId : run.runId;
      if (!isRunId(ticketId)) return null;
      return {
        schemaVersion: TICKET_SCHEMA_VERSION,
        ticketId: ticketId,
        runId: run.runId || ticketId,
        careerId: run.careerId || null,
        commissionId: run.commissionId || null,
        gameId: run.gameId || null,
        mode: MODE,
        startParams: isObject(run.startParams) ? clone(run.startParams) : isObject(commission && commission.startParams) ? clone(commission.startParams) : {},
        seed: typeof run.seed === 'string' ? run.seed : '',
        issuedAt: typeof run.issuedAt === 'string' ? run.issuedAt : run.createdAt || nowIso(),
        expiresAt: null,
        rulesetVersion: RULESET_VERSION,
        contentVersion: typeof run.contentVersion === 'string' && run.contentVersion ? run.contentVersion : CONTENT_VERSION,
        attempt: toPositiveInt(run.attempt, 1),
        nonce: typeof run.nonce === 'string' ? run.nonce : '',
      };
    }

    /** 页面内存储的 ticket 只带恢复所需字段（ADR §18.3；bridge 只读 ticketId/gameId/nonce）。 */
    function storedTicketOf(ticket) {
      return {
        schemaVersion: TICKET_SCHEMA_VERSION,
        ticketId: ticket.ticketId,
        runId: ticket.runId,
        careerId: ticket.careerId,
        commissionId: ticket.commissionId,
        gameId: ticket.gameId,
        mode: MODE,
        startParams: clone(ticket.startParams) || {},
        seed: ticket.seed,
        issuedAt: ticket.issuedAt,
        expiresAt: null,
        rulesetVersion: ticket.rulesetVersion,
        contentVersion: ticket.contentVersion,
        attempt: ticket.attempt,
        nonce: ticket.nonce,
      };
    }

    /* ---------------- 结果记录 ---------------- */

    function recordResult(result) {
      state.lastResult = clone(result) || null;
      return result;
    }

    function failure(reason, extra) {
      var out = { ok: false, reason: reason || 'failed' };
      if (isObject(extra)) {
        Object.keys(extra).forEach(function (key) {
          if (key !== 'ok' && key !== 'reason') out[key] = extra[key];
        });
      }
      return out;
    }

    function failureMessage(commission, check) {
      var issuer = isObject(commission) && commission.issuer ? commission.issuer : '主顾';
      var title = isObject(commission) && commission.title ? commission.title : '这单活';
      if (check && check.reason === 'context-mismatch') return '这一趟的情况和' + issuer + '要的不一样，' + title + '没法交差。';
      if (check && check.reason === 'game-mismatch') return '走错了地方，' + title + '不在这一页。';
      var observed = check && Number.isFinite(Number(check.observed)) ? Math.floor(Number(check.observed)) : 0;
      var objective = check && isObject(check.objective) ? check.objective : null;
      if (!objective) return title + '没能交差。';
      return title + '：这趟只做到 ' + observed + ' / ' + objective.atLeast + '，' + issuer + '不收。';
    }

    function receiptFromClaimRow(row) {
      if (!isObject(row)) return null;
      return {
        receiptId: row.receiptId || row.runId || null,
        careerId: row.careerId || null,
        commissionId: row.commissionId || null,
        credits: Number.isFinite(Number(row.credits)) ? Math.max(0, Math.floor(Number(row.credits))) : 0,
        items: isObject(row.items) ? clone(row.items) : {},
        evidence: Array.isArray(row.evidence) ? row.evidence.slice() : [],
        flags: Array.isArray(row.flags) ? row.flags.slice() : [],
        txIds: Array.isArray(row.txIds) ? row.txIds.slice() : [],
        claimedAt: typeof row.claimedAt === 'string' ? row.claimedAt : null,
        rulesetVersion: Number.isFinite(Number(row.rulesetVersion)) ? Math.floor(Number(row.rulesetVersion)) : RULESET_VERSION,
        contentVersion: typeof row.contentVersion === 'string' && row.contentVersion ? row.contentVersion : CONTENT_VERSION,
      };
    }

    async function readClaim(db, ticketId) {
      if (!db || !isFunction(db.getClaim)) return null;
      try {
        var row = await db.getClaim(ticketId);
        return receiptFromClaimRow(row);
      } catch (err) {
        return null;
      }
    }

    async function safeGetRun(db, ticketId) {
      if (!db || !isFunction(db.getRun)) return null;
      try {
        var run = await db.getRun(ticketId);
        return isObject(run) ? run : null;
      } catch (err) {
        return null;
      }
    }

    async function safeUpdateRun(db, ticketId, patch) {
      if (!db || !isFunction(db.updateRun)) return null;
      try {
        return await db.updateRun(ticketId, patch);
      } catch (err) {
        return null;
      }
    }

    /* ---------------- 公开方法：configure ---------------- */

    function configure(input) {
      try {
        var content = null;
        if (isObject(input) && Object.prototype.hasOwnProperty.call(input, 'content')) content = input.content;
        else if (Array.isArray(input) || isObject(input)) content = input;
        else content = null;
        var core = resolveCore();
        if (!core && content !== null && content !== undefined) {
          return { ok: false, contentVersion: CONTENT_VERSION, count: 0, errors: [REASONS.coreUnavailable], warnings: [], usable: false };
        }
        var normalized = applyContent(content);
        return {
          ok: normalized.errors.length === 0,
          contentVersion: normalized.contentVersion,
          count: normalized.commissions.length,
          errors: normalized.errors.slice(),
          warnings: normalized.warnings.slice(),
          usable: normalized.usable,
        };
      } catch (err) {
        return { ok: false, contentVersion: CONTENT_VERSION, count: 0, errors: [errorText(err)], warnings: [], usable: false };
      }
    }

    function getCommissions() {
      try {
        var content = ensureContent();
        if (!content) return [];
        return clone(content.commissions) || [];
      } catch (err) {
        return [];
      }
    }

    function getCommission(commissionId) {
      try {
        return findCommission(commissionId);
      } catch (err) {
        return null;
      }
    }

    function getContentVersion() {
      return CONTENT_VERSION;
    }

    /* ---------------- 公开方法：getWallet（只读诊断 / 告示板钱包行） ---------------- */

    /**
     * 只读钱包快照。careerId 缺省时读 state store 的生涯指针（不创建生涯、不写库）。
     * 追加方法：career/ui/town.js 会调 commission.getWallet({careerId})。
     */
    async function getWalletSafe(input) {
      var opts = isObject(input) ? input : {};
      var core = resolveCore();
      var db = resolveDb();
      if (!core) return { ok: false, reason: REASONS.coreUnavailable, credits: 0, items: {} };
      if (!db) return { ok: false, reason: REASONS.dbUnavailable, credits: 0, items: {} };
      var careerId = core.isValidCareerId(opts.careerId) ? opts.careerId : null;
      if (!careerId && isFunction(db.getState)) {
        try {
          var pointer = await db.getState('career');
          var pointerId = pointer && isObject(pointer.value) ? pointer.value.careerId : pointer && pointer.careerId;
          if (core.isValidCareerId(pointerId)) careerId = pointerId;
        } catch (err) {
          careerId = null;
        }
      }
      if (!careerId) return { ok: false, reason: 'no-career', credits: 0, items: {} };
      if (!isFunction(db.readWallet)) return { ok: false, reason: 'wallet-unavailable', careerId: careerId, credits: 0, items: {} };
      try {
        var wallet = await db.readWallet(careerId);
        if (!wallet || !wallet.ok) {
          return { ok: false, reason: (wallet && wallet.reason) || 'wallet-unavailable', careerId: careerId, credits: 0, items: {} };
        }
        return {
          ok: true,
          careerId: careerId,
          credits: Number.isFinite(Number(wallet.credits)) ? Math.max(0, Math.floor(Number(wallet.credits))) : 0,
          items: isObject(wallet.items) ? clone(wallet.items) : {},
          equipment: isObject(wallet.equipment) ? clone(wallet.equipment) : {},
        };
      } catch (err) {
        return { ok: false, reason: REASONS.exception, careerId: careerId, credits: 0, items: {} };
      }
    }

    function getWallet(input) {
      return guardAsync('get-wallet', getWalletSafe(input), { ok: false, reason: REASONS.exception, credits: 0, items: {} });
    }

    /* ---------------- 公开方法：listAvailable ---------------- */

    async function listAvailableSafe(input) {
      var opts = isObject(input) ? input : {};
      var core = resolveCore();
      if (!core) return failure(REASONS.coreUnavailable, { careerId: null, commissions: [] });
      var content = ensureContent();
      if (!content) return failure(REASONS.contentUnavailable, { careerId: null, commissions: [] });
      if (!content.usable) {
        return failure(REASONS.unsupportedContent, {
          careerId: null,
          commissions: [],
          errors: state.contentErrors.slice(),
        });
      }
      var career = await resolveCareer({ careerId: opts.careerId, originGameId: typeof opts.originGameId === 'string' ? opts.originGameId : null }, opts.ensure === true);
      if (!career.ok) {
        return failure(career.reason || REASONS.careerUnavailable, { careerId: null, commissions: [] });
      }
      var commissions = content.commissions.map(function (commission) {
        return {
          commissionId: commission.commissionId,
          gameId: commission.gameId,
          professionId: commission.professionId,
          title: commission.title,
          summary: commission.summary,
          issuer: commission.issuer,
          reward: clone(commission.reward),
          repeatSalaryCredits: commission.repeatSalaryCredits,
          durationHint: commission.durationHint,
          risk: commission.risk,
          startParams: clone(commission.startParams),
          unlocked: isUnlocked(commission, career.context),
        };
      });
      return {
        ok: true,
        careerId: career.careerId || null,
        created: career.created === true,
        commissions: commissions,
        contentVersion: CONTENT_VERSION,
      };
    }

    function listAvailable(input) {
      return guardAsync('list-available', listAvailableSafe(input), { ok: false, reason: REASONS.exception, careerId: null, commissions: [] });
    }

    /* ---------------- 公开方法：start ---------------- */

    async function startSafe(input) {
      var opts = isObject(input) ? input : {};
      var core = resolveCore();
      if (!core) return failure(REASONS.coreUnavailable);
      var db = resolveDb();
      if (!db) return failure(REASONS.dbUnavailable);
      var content = ensureContent();
      if (!content) return failure(REASONS.contentUnavailable);
      if (!content.usable) return failure(REASONS.unsupportedContent, { errors: state.contentErrors.slice() });
      var commissionId = typeof opts.commissionId === 'string' ? opts.commissionId : '';
      if (!isStableId(commissionId)) return failure(REASONS.badCommissionId, { commissionId: commissionId || null });
      var commission = findCommission(commissionId);
      if (!commission) return failure(REASONS.missingCommission, { commissionId: commissionId });

      var career = await resolveCareer({ careerId: opts.careerId, originGameId: commission.gameId }, true);
      if (!career.ok || !career.careerId) return failure(career.reason || REASONS.careerUnavailable);
      if (!isUnlocked(commission, career.context)) {
        return failure(REASONS.locked, { commissionId: commissionId, careerId: career.careerId, message: '港口的告示还没换成这一张。' });
      }

      /* 幂等：同 career + 同委托已有未结算 run → 返回原 ticket（不重复建 run）。 */
      var stored = readStoredTicket();
      if (
        stored &&
        isObject(stored) &&
        stored.commissionId === commissionId &&
        stored.careerId === career.careerId &&
        isRunId(stored.ticketId)
      ) {
        var existingRun = await safeGetRun(db, stored.ticketId);
        if (existingRun && existingRun.commissionId === commissionId && isLiveStatus(existingRun.status)) {
          var reusedTicket = ticketFromRun(existingRun, commission) || stored;
          reusedTicket.startParams = clone(commission.startParams) || reusedTicket.startParams || {};
          writeStoredTicket(storedTicketOf(reusedTicket));
          rememberRun(reusedTicket, existingRun);
          return {
            ok: true,
            reused: true,
            ticket: reusedTicket,
            ticketId: reusedTicket.ticketId,
            runId: reusedTicket.runId,
            careerId: reusedTicket.careerId,
            commissionId: commissionId,
            url: ticketUrl(reusedTicket),
          };
        }
      }

      var runId = isFunction(core.newId) ? core.newId(RUN_PREFIX) : RUN_PREFIX + '-' + hexFallback(24);
      if (!isRunId(runId)) runId = RUN_PREFIX + '-' + hexFallback(24);
      var nonce = makeNonce();
      var issuedAt = nowIso();
      var ticket = {
        schemaVersion: TICKET_SCHEMA_VERSION,
        ticketId: runId,
        runId: runId,
        careerId: career.careerId,
        commissionId: commissionId,
        gameId: commission.gameId,
        mode: MODE,
        startParams: clone(commission.startParams) || {},
        seed: makeSeed(),
        issuedAt: issuedAt,
        expiresAt: null,
        rulesetVersion: RULESET_VERSION,
        contentVersion: CONTENT_VERSION,
        attempt: 1,
        nonce: nonce,
      };

      var created = null;
      try {
        created = await db.createRun({
          runId: runId,
          careerId: career.careerId,
          gameId: commission.gameId,
          mode: MODE,
          sourceMode: MODE,
          commissionId: commissionId,
          ticketId: runId,
          nonce: nonce,
          startParams: clone(ticket.startParams),
          seed: ticket.seed,
          status: 'issued',
          issuedAt: issuedAt,
          rulesetVersion: RULESET_VERSION,
          contentVersion: CONTENT_VERSION,
          schemaVersion: SCHEMA_VERSION,
          /* 目录快照：仅在游戏页没有注入内容时用于校验/判定（内容可用时目录优先）。 */
          commissionSnapshot: clone(commission),
        });
      } catch (err) {
        return failure(REASONS.runCreateFailed, { error: errorText(err) });
      }
      if (!created || !created.ok) {
        var createReason = created && created.reason === 'conflict' ? REASONS.runConflict : REASONS.runCreateFailed;
        return failure(createReason, { error: (created && (created.error || created.reason)) || null });
      }
      writeStoredTicket(storedTicketOf(ticket));
      rememberRun(ticket, created.run || null);
      return {
        ok: true,
        ticket: ticket,
        ticketId: ticket.ticketId,
        runId: ticket.runId,
        careerId: ticket.careerId,
        commissionId: ticket.commissionId,
        gameId: ticket.gameId,
        url: ticketUrl(ticket),
      };
    }

    function start(input) {
      return guardAsync('start', startSafe(input), failure(REASONS.exception));
    }

    /* ---------------- 公开方法：validateTicket ---------------- */

    async function validateTicketSafe(input) {
      var opts = isObject(input) ? input : {};
      var core = resolveCore();
      if (!core) return failure(REASONS.coreUnavailable);
      var db = resolveDb();
      if (!db) return failure(REASONS.dbUnavailable);
      var ticketId = typeof opts.ticketId === 'string' ? opts.ticketId : '';
      if (!isRunId(ticketId)) return failure(REASONS.noRun);
      var run = await safeGetRun(db, ticketId);
      if (!run) return failure(REASONS.noRun);
      if (run.mode !== MODE) return failure(REASONS.modeMismatch, { runId: ticketId });
      if (!isLiveStatus(run.status)) {
        return failure(REASONS.settled, { runId: ticketId, status: typeof run.status === 'string' ? run.status : null });
      }
      var requestedGameId = typeof opts.gameId === 'string' && opts.gameId ? opts.gameId : null;
      if (requestedGameId && run.gameId !== requestedGameId) return failure(REASONS.gameMismatch, { runId: ticketId });

      var ticket = isObject(opts.ticket) ? opts.ticket : null;
      if (ticket) {
        if (ticket.ticketId !== undefined && ticket.ticketId !== ticketId) return failure(REASONS.ticketMismatch, { field: 'ticketId' });
        if (ticket.runId !== undefined && ticket.runId !== ticketId) return failure(REASONS.ticketMismatch, { field: 'runId' });
        if (ticket.careerId !== undefined && ticket.careerId !== run.careerId) return failure(REASONS.ticketMismatch, { field: 'careerId' });
        if (ticket.commissionId !== undefined && ticket.commissionId !== run.commissionId) return failure(REASONS.ticketMismatch, { field: 'commissionId' });
        if (ticket.nonce !== undefined && run.nonce !== undefined && ticket.nonce !== run.nonce) return failure(REASONS.ticketMismatch, { field: 'nonce' });
        if (ticket.gameId !== undefined && ticket.gameId !== run.gameId) return failure(REASONS.gameMismatch, { field: 'gameId' });
      }

      var ticketVersion = (ticket && typeof ticket.contentVersion === 'string' && ticket.contentVersion) ||
        (typeof run.contentVersion === 'string' && run.contentVersion) ||
        '';
      if (ticketVersion && !versionsCompatible(ticketVersion)) {
        return failure(REASONS.unsupportedContent, { contentVersion: ticketVersion });
      }

      var commission = findCommission(run.commissionId);
      var commissionSource = 'content';
      if (!commission) {
        commission = snapshotCommission(run);
        commissionSource = commission ? 'run-snapshot' : 'none';
      }
      if (!commission) return failure(REASONS.missingCommission, { commissionId: run.commissionId || null });
      if (commission.gameId && run.gameId && commission.gameId !== run.gameId) return failure(REASONS.gameMismatch, { runId: ticketId });

      rememberRun(ticket || ticketFromRun(run, commission), run);
      return {
        ok: true,
        run: run,
        commission: commission,
        ticket: ticket,
        commissionSource: commissionSource,
      };
    }

    function validateTicket(input) {
      return guardAsync('validate-ticket', validateTicketSafe(input), failure(REASONS.exception));
    }

    /** 没有注入内容时的兜底：用 run 里 start 时写入的目录快照（DB 权威记录，游戏页无需内容）。 */
    function snapshotCommission(run) {
      if (!isObject(run) || !isObject(run.commissionSnapshot)) return null;
      var errors = [];
      var warnings = [];
      var commission = normalizeCommission(run.commissionSnapshot, errors, warnings);
      if (!commission) return null;
      if (commission.commissionId !== run.commissionId) return null;
      return commission;
    }

    function commissionForRun(run) {
      if (!isObject(run)) return null;
      var commission = findCommission(run.commissionId);
      if (commission) return { commission: commission, source: 'content' };
      var fallback = snapshotCommission(run);
      if (fallback) return { commission: fallback, source: 'run-snapshot' };
      return null;
    }

    /* ---------------- 公开方法：markActive ---------------- */

    async function markActiveSafe(ticketId) {
      var core = resolveCore();
      var db = resolveDb();
      if (!core || !db || !isRunId(ticketId)) return false;
      var run = await safeGetRun(db, ticketId);
      if (!run || run.mode !== MODE) return false;
      /* 只把 issued 推进到 active；绝不覆盖 claimed/settled（避免与结算竞态）。 */
      if (!isLiveStatus(run.status)) return false;
      if (run.status === 'active') {
        var activeEntry = entryOf(ticketId);
        if (activeEntry) activeEntry.run = clone(run);
        return true;
      }
      var patched = await safeUpdateRun(db, ticketId, { status: 'active', startedAt: nowIso() });
      if (patched && patched.ok && patched.run) {
        var entry = entryOf(ticketId);
        if (entry) entry.run = clone(patched.run);
        return true;
      }
      return false;
    }

    function markActive(ticketId) {
      return guardAsync('mark-active', markActiveSafe(ticketId), false);
    }

    /* ---------------- 公开方法：recordEvent（同步、纯内存） ---------------- */

    function recordEvent(ticketId, event) {
      try {
        var core = resolveCore();
        if (!core || !isObject(event)) return false;
        if (event.sourceMode !== MODE) return false;
        if (!isFunction(core.isKind) || !core.isKind(event.kind)) return false;
        var entry = entryOf(ticketId);
        if (!entry || entry.mode !== MODE) return false;
        if (entry.buffer.length >= BUFFER_LIMIT) {
          entry.dropped += 1;
          return false;
        }
        var seq = Number(event.seq);
        entry.buffer.push({
          kind: event.kind,
          payload: sanitizePayload(event.payload),
          seq: Number.isFinite(seq) ? Math.floor(seq) : entry.buffer.length + 1,
          sourceMode: MODE,
          at: typeof event.at === 'string' && event.at ? event.at : nowIso(),
        });
        state.lastEventAt = nowIso();
        return true;
      } catch (err) {
        return false;
      }
    }

    /* ---------------- 公开方法：getState ---------------- */

    function getState(ticketId) {
      try {
        var id = typeof ticketId === 'string' && ticketId ? ticketId : state.currentTicketId;
        var entry = entryOf(id);
        return {
          ticketId: id || null,
          run: entry && entry.run ? clone(entry.run) : null,
          events: entry ? clone(entry.buffer) || [] : [],
          bufferCount: entry ? entry.buffer.length : 0,
          dropped: entry ? entry.dropped : 0,
          lastResult: state.lastResult ? clone(state.lastResult) : null,
          contentVersion: CONTENT_VERSION,
          contentConfigured: !!state.content,
        };
      } catch (err) {
        return {
          ticketId: null,
          run: null,
          events: [],
          bufferCount: 0,
          dropped: 0,
          lastResult: null,
          contentVersion: CONTENT_VERSION,
          contentConfigured: false,
        };
      }
    }

    /* ---------------- 公开方法：settle ---------------- */

    async function settleSafe(input) {
      var opts = isObject(input) ? input : {};
      var core = resolveCore();
      if (!core) return recordResult(failure(REASONS.coreUnavailable));
      var db = resolveDb();
      if (!db) return recordResult(failure(REASONS.dbUnavailable));
      var ticketId = typeof opts.ticketId === 'string' ? opts.ticketId : '';
      if (!isRunId(ticketId)) return recordResult(failure(REASONS.noRun, { ticketId: ticketId || null }));
      var run = await safeGetRun(db, ticketId);
      if (!run) return recordResult(failure(REASONS.noRun, { ticketId: ticketId }));

      var status = typeof run.status === 'string' ? run.status : '';

      /* 幂等：已结算 → 原收据，零增量（DB claims 唯一）。 */
      if (isSettledStatus(status)) {
        var existingReceipt = await readClaim(db, ticketId);
        if (!existingReceipt) {
          return recordResult(failure(REASONS.receiptUnavailable, { ticketId: ticketId, status: status, duplicate: true }));
        }
        forgetTicket(ticketId);
        return recordResult({
          ok: true,
          duplicate: true,
          receipt: existingReceipt,
          credits: existingReceipt.credits,
          items: existingReceipt.items,
          runId: ticketId,
          careerId: run.careerId || null,
          commissionId: existingReceipt.commissionId || run.commissionId || null,
          status: status,
        });
      }
      if (isFailedStatus(status)) {
        forgetTicket(ticketId);
        var failedReason = status === 'abandoned' ? REASONS.abandoned : status === 'failed' ? REASONS.runFailed : REASONS.settled;
        return recordResult(failure(failedReason, {
          ticketId: ticketId,
          status: status,
          runId: ticketId,
          message: status === 'abandoned' ? '这一趟已经收工了。' : '这一趟已经结束，不能再交差。',
        }));
      }
      if (run.mode !== MODE) return recordResult(failure(REASONS.modeMismatch, { ticketId: ticketId }));
      if (!run.careerId || !core.isValidCareerId(run.careerId)) return recordResult(failure(REASONS.badRun, { ticketId: ticketId }));
      var runVersion = typeof run.contentVersion === 'string' && run.contentVersion ? run.contentVersion : '';
      if (runVersion && !versionsCompatible(runVersion)) {
        return recordResult(failure(REASONS.unsupportedContent, { ticketId: ticketId, contentVersion: runVersion }));
      }

      var found = commissionForRun(run);
      if (!found) {
        return recordResult(failure(REASONS.missingCommission, { ticketId: ticketId, commissionId: run.commissionId || null }));
      }
      var commission = found.commission;
      var gameId = typeof run.gameId === 'string' && run.gameId ? run.gameId : commission.gameId;
      var stats = isObject(opts.stats) ? clone(opts.stats) : {};
      var outcome = typeof opts.outcome === 'string' && opts.outcome ? opts.outcome : 'lost';
      var entry = entryOf(ticketId);
      /* 只汇总本页真实事件；缓冲为空就按空摘要判定，绝不伪造事件。 */
      var events = entry ? clone(entry.buffer) || [] : [];

      var check = null;
      try {
        check = core.validateCommission(commission, events, { mode: MODE, gameId: gameId, stats: stats });
      } catch (err) {
        return recordResult(failure(REASONS.planFailed, { error: errorText(err) }));
      }
      if (!check || !check.ok) {
        var reason = (check && check.reason) || REASONS.planFailed;
        var failurePatch = {
          status: 'failed',
          outcome: outcome,
          reason: reason,
          observed: check && Number.isFinite(Number(check.observed)) ? Math.floor(Number(check.observed)) : 0,
          objective: check && isObject(check.objective) ? check.objective : null,
          stats: stats,
          settledAt: nowIso(),
          gameId: gameId,
        };
        var patchedFail = await safeUpdateRun(db, ticketId, failurePatch);
        forgetTicket(ticketId);
        return recordResult(failure(reason, {
          runId: ticketId,
          careerId: run.careerId,
          commissionId: commission.commissionId,
          observed: failurePatch.observed,
          objective: failurePatch.objective,
          message: failureMessage(commission, check),
          runUpdated: !!(patchedFail && patchedFail.ok),
        }));
      }

      var repeat = false;
      try {
        var questState = await db.readQuestState(run.careerId);
        repeat = isQuestCleared(questState, commission.commissionId);
      } catch (err) {
        repeat = false;
      }

      var plan = null;
      try {
        plan = core.rewardPlan(commission, events, { mode: MODE, repeat: repeat, gameId: gameId, stats: stats });
      } catch (err) {
        return recordResult(failure(REASONS.planFailed, { error: errorText(err) }));
      }
      if (!plan || !plan.ok) {
        return recordResult(failure((plan && plan.reason) || REASONS.planFailed, {
          runId: ticketId,
          observed: check.observed,
          objective: check.objective,
        }));
      }

      var claim = null;
      try {
        claim = await db.settleAndClaim({
          runId: ticketId,
          careerId: run.careerId,
          nonce: run.nonce,
          plan: {
            credits: plan.credits,
            items: plan.items,
            evidence: plan.evidence,
            flags: plan.flags,
          },
          /* 只声明身份字段；金额/物品/流水由 DB 依 plan + core.buildReceipt 自行生成。
             注意：不要传 receiptId——career-db.receiptMismatch 拿 expected.runId 比对，
             而 core.buildReceipt 的返回没有 runId 字段，任何 receiptId 都会被判 receipt-mismatch。 */
          receipt: {
            commissionId: commission.commissionId,
          },
          outcome: outcome,
          stats: stats,
          now: nowIso(),
          contentVersion: CONTENT_VERSION,
        });
      } catch (err) {
        return recordResult(failure(REASONS.claimFailed, { error: errorText(err), retryable: true }));
      }
      if (!claim || !claim.ok) {
        var claimReason = (claim && claim.reason) || REASONS.claimFailed;
        return recordResult(failure(claimReason, { retryable: true, message: '交差手续没办成，稍后再试一次。' }));
      }

      var receipt = receiptFromClaimRow(claim.receipt);
      forgetTicket(ticketId);
      return recordResult({
        ok: true,
        duplicate: claim.duplicate === true,
        receipt: receipt,
        credits: receipt ? receipt.credits : plan.credits,
        items: receipt ? receipt.items : plan.items,
        evidence: receipt ? receipt.evidence : plan.evidence,
        flags: receipt ? receipt.flags : plan.flags,
        runId: ticketId,
        careerId: run.careerId,
        commissionId: commission.commissionId,
        repeat: repeat === true,
      });
    }

    function settle(input) {
      return guardAsync('settle', settleSafe(input), recordResult(failure(REASONS.exception)));
    }

    /* ---------------- 公开方法：abandon ---------------- */

    async function abandonSafe(ticketId) {
      var core = resolveCore();
      var db = resolveDb();
      if (!core) return failure(REASONS.coreUnavailable);
      if (!db) return failure(REASONS.dbUnavailable);
      if (!isRunId(ticketId)) return failure(REASONS.noRun);
      var run = await safeGetRun(db, ticketId);
      if (!run) return failure(REASONS.noRun, { ticketId: ticketId });
      var status = typeof run.status === 'string' ? run.status : '';
      if (isSettledStatus(status)) return failure(REASONS.settled, { ticketId: ticketId, status: status });
      if (status === 'abandoned') return { ok: true, duplicate: true, ticketId: ticketId, status: status };
      if (isFailedStatus(status)) return { ok: true, duplicate: true, ticketId: ticketId, status: status };
      var patched = await safeUpdateRun(db, ticketId, { status: 'abandoned', abandonedAt: nowIso() });
      if (!patched || !patched.ok) {
        return failure((patched && patched.reason) || REASONS.updateFailed, { ticketId: ticketId });
      }
      forgetTicket(ticketId);
      return { ok: true, ticketId: ticketId, runId: ticketId, status: 'abandoned' };
    }

    function abandon(ticketId) {
      return guardAsync('abandon', abandonSafe(ticketId), failure(REASONS.exception));
    }

    /* ---------------- 诊断 / 重置 ---------------- */

    function reset() {
      try {
        state.content = null;
        state.contentErrors = [];
        state.contentWarnings = [];
        state.runs = Object.create(null);
        state.currentTicketId = null;
        state.lastResult = null;
        state.lastEventAt = null;
        clearStoredTicket(null);
        return { ok: true };
      } catch (err) {
        return failure(REASONS.exception, { error: errorText(err) });
      }
    }

    /* ---------------- 异常兜底 ---------------- */

    /** 把可能同步抛异常的调用包成 Promise；任何异常 → 结构化 fallback。 */
    function guardAsync(label, value, fallback) {
      try {
        return Promise.resolve(value).catch(function (err) {
          return isObject(fallback) ? Object.assign({ label: label }, fallback) : fallback;
        });
      } catch (err) {
        return Promise.resolve(isObject(fallback) ? Object.assign({ label: label }, fallback) : fallback);
      }
    }

    var api = {
      VERSION: VERSION,
      MODULE_VERSION: MODULE_VERSION,
      CONTENT_VERSION: CONTENT_VERSION,
      SCHEMA_VERSION: SCHEMA_VERSION,
      RULESET_VERSION: RULESET_VERSION,
      TICKET_SCHEMA_VERSION: TICKET_SCHEMA_VERSION,
      MODE: MODE,
      TICKET_STORAGE_KEY: TICKET_STORAGE_KEY,
      TICKET_PARAM: TICKET_PARAM,
      BUFFER_LIMIT: BUFFER_LIMIT,
      REASONS: REASONS,
      __commissionCoreMounted: true,
      configure: configure,
      getCommissions: getCommissions,
      getCommission: getCommission,
      getContentVersion: getContentVersion,
      getWallet: getWallet,
      listAvailable: listAvailable,
      start: start,
      validateTicket: validateTicket,
      markActive: markActive,
      recordEvent: recordEvent,
      getState: getState,
      settle: settle,
      abandon: abandon,
      reset: reset,
    };
    return api;
  }

  /* ------------------------------------------------------------------ *
   * 默认单例（浏览器 window.ArcadeCareerCommission / Node module.exports）
   * ------------------------------------------------------------------ */

  var singleton = createCommissionCore({});
  singleton.createCommissionCore = createCommissionCore;
  return singleton;
});
