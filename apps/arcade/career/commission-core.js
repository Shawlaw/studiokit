/*!
 * StudioKit Arcade Life — 委托生命周期（0.16，D16-02）
 *
 * 职责：委托目录规范化、已接受职业的可接委托列表、ticket 签发/校验、本页事件缓冲、
 * 目标判定编排、奖励计划编排、结算/放弃/恢复（docs/arcade-life/ADR-interfaces.md §7/§8/§18/§23）。
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

  var VERSION = '0.18.0';
  var MODULE_VERSION = '0.18.0';
  /* 运行时内容版本：ticket / 收据上的 contentVersion（与 ADR §18.1 一致）。 */
  var CONTENT_VERSION = '0.18.0';
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
  /* 只有 ADR §20 的三条已注册终局可免职业 gate；前缀本身不是授权凭据。 */
  var ENDING_IDS = Object.freeze(['ending.combat', 'ending.research', 'ending.rescue']);
  var WORLD_WORK_TITLE = '旧港通用工作';
  var WORLD_WORK_SUMMARY = '这是一项旧港通用工作，当前生涯可直接承接。';

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
    noCareer: 'no-career',
    catalogUnavailable: 'catalog-unavailable',
    careerStateUnavailable: 'career-state-unavailable',
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
   * 0.18.0/0.16.9 互相兼容）；>=1.0 只比 major。ADR §9 要求版本不一致拒绝委托结算。
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
    var objectiveOut = { kind: raw.kind, atLeast: toPositiveInt(raw.atLeast, 1), context: context };
    /* 0.17：达到阈值型目标（距离/高度/格子值/连击），由 career-core 用 payload 最大值判定。 */
    if (raw.minValue !== undefined) {
      if (!isObject(raw.minValue) || !isStableId(raw.minValue.field)) {
        errors.push('objective-minvalue-invalid:' + id);
        return null;
      }
      var minValue = Number(raw.minValue.value);
      if (!isFinite(minValue)) {
        errors.push('objective-minvalue-invalid:' + id);
        return null;
      }
      objectiveOut.minValue = { field: raw.minValue.field, value: minValue };
    }
    return objectiveOut;
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
      category: raw.category === 'world' || raw.worldWork === true ? 'world' : 'profession',
      worldWork: raw.category === 'world' || raw.worldWork === true,
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
    var arcadeBase = '../';

    var nodeCore = null;
    var nodeProfessionView = null;
    if (isNode && typeof require === 'function') {
      try {
        nodeCore = require('./career-core.js');
      } catch (err) {
        nodeCore = null;
      }
      try {
        nodeProfessionView = require('./profession-view.js');
      } catch (err) {
        nodeProfessionView = null;
      }
    }

    var state = {
      content: null,
      contentErrors: [],
      contentWarnings: [],
      catalog: null,
      worldWorkIds: [],
      worldWorkTexts: Object.create(null),
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

    /** 0.18：把已落库的 ticket/run 重新登记到本实例缓冲（跨页恢复终局 run）。 */
    function adoptRun(ticket, run) {
      try {
        if (!isObject(ticket) || !isStableId(ticket.ticketId)) return false;
        rememberRun(ticket, isObject(run) ? run : null);
        return true;
      } catch (err) {
        return false;
      }
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

    function isRegisteredEnding(commissionId) {
      return ENDING_IDS.indexOf(commissionId) >= 0 && !!findCommission(commissionId);
    }

    function resolveProfessionView() {
      if (nodeProfessionView) return nodeProfessionView;
      if (root && root.ArcadeCareer && root.ArcadeCareer.professionView) return root.ArcadeCareer.professionView;
      if (root && root.ArcadeCareerProfessionView) return root.ArcadeCareerProfessionView;
      return null;
    }

    async function resolveCareer(input) {
      var core = resolveCore();
      var db = resolveDb();
      var requested = input && isRunIdSafe(input.careerId) ? input.careerId : null;
      if (!requested && db && isFunction(db.getState)) {
        try {
          var pointer = await db.getState('career');
          var pointerId = pointer && isObject(pointer.value) ? pointer.value.careerId : pointer && pointer.careerId;
          if (isRunIdSafe(pointerId)) requested = pointerId;
        } catch (err) {
          requested = null;
        }
      }
      /* 0.22：核心永不隐式 ensureCareer；身份只能由显式接受邀请事务建立。 */
      if (!requested) return { ok: false, reason: REASONS.noCareer, careerId: null };
      if (!db) return { ok: false, reason: REASONS.dbUnavailable, careerId: null };
      var context = await readCareerContext(requested);
      return Object.assign({ ok: true, created: false }, context);
    }

    /** 核心授权真源只来自 career-db；opts.state 只能供纯 UI 投影，绝不参与写门面。 */
    async function readProfessionState() {
      var db = resolveDb();
      if (!db) return { ok: false, reason: REASONS.careerStateUnavailable };
      try {
        if (isFunction(db.getDiscoveryState)) {
          var state = await db.getDiscoveryState();
          if (isObject(state)) return { ok: true, state: state };
        }
        if (isFunction(db.getState)) {
          var row = await db.getState('discovery');
          var value = row && isObject(row.value) ? row.value : row;
          if (isObject(value) && value.key !== 'discovery') return { ok: true, state: value };
        }
        if (isFunction(db.getDiscoverySnapshot)) {
          var snapshot = await db.getDiscoverySnapshot();
          if (isObject(snapshot) && snapshot.state) return { ok: true, state: snapshot.state };
        }
      } catch (err) {
        return { ok: false, reason: REASONS.careerStateUnavailable };
      }
      return { ok: false, reason: REASONS.careerStateUnavailable };
    }

    /** 职业 ID 与 gameId 映射只来自 configure 注入的 registry catalog。 */
    function readCatalog() {
      return isObject(state.catalog) ? state.catalog : null;
    }

    async function readCareerGuard(careerId, context) {
      if (isObject(context) && context.archived === true) return { ok: false, reason: 'archived' };
      var db = resolveDb();
      if (!db) return { ok: false, reason: REASONS.dbUnavailable };
      try {
        if (isFunction(db.getArchiveState)) {
          var archive = await db.getArchiveState();
          if (archive && archive.ok === false) return { ok: false, reason: 'db-unavailable' };
          if (archive && archive.archived === true) return { ok: false, reason: 'archived' };
        }
        if (isFunction(db.getState)) {
          var retired = await db.getState('former-career:' + careerId);
          if (retired) return { ok: false, reason: 'career-reset' };
        }
      } catch (err) {
        return { ok: false, reason: REASONS.dbUnavailable };
      }
      return { ok: true };
    }

    function worldCommission(commission) {
      if (!isObject(commission)) return false;
      return state.worldWorkIds.indexOf(commission.commissionId) >= 0
        || commission.category === 'world'
        || commission.worldWork === true;
    }

    function setValuesToArray(set) {
      if (!set || typeof set.forEach !== 'function') return [];
      var out = [];
      set.forEach(function (value) { out.push(value); });
      return out;
    }

    function trustedContext(input) {
      var source = isObject(input) ? input : {};
      /* surface/history 只能收窄展示；story/world 事实必须由 DB profile/quests/wallet 推导。 */
      return {
        surface: typeof source.surface === 'string' ? source.surface : 'work',
        archived: source.archived === true,
        history: source.history,
      };
    }

    function projectionContext(career, context) {
      var source = isObject(context) ? context : {};
      var base = isObject(career.context) ? career.context : {};
      var flags = setValuesToArray(base.flags).concat(tokensOf(source.worldFlags));
      var evidence = setValuesToArray(base.evidence).concat(tokensOf(source.storyEvidence));
      var cleared = setValuesToArray(base.cleared).concat(tokensOf(source.clearedCommissions));
      var wallet = isObject(career.wallet) ? career.wallet : {};
      return Object.assign({}, source, {
        surface: typeof source.surface === 'string' && source.surface ? source.surface : 'work',
        worldFlags: uniqueTokens(flags),
        storyEvidence: uniqueTokens(evidence),
        clearedCommissions: uniqueTokens(cleared),
        capabilities: uniqueTokens(setValuesToArray(base.capabilities).concat(tokensOf(source.capabilities))),
        walletKnown: source.walletKnown === true || !!career.wallet,
        wallet: {
          credits: Number.isFinite(Number(wallet.credits)) ? Number(wallet.credits) : 0,
          items: isObject(wallet.items) ? clone(wallet.items) : {},
        },
        worldWorkIds: state.worldWorkIds.slice(),
      });
    }

    function tokensOf(value) {
      var out = [];
      if (Array.isArray(value)) {
        value.forEach(function (item) { if (typeof item === 'string') out.push(item); });
      } else if (isObject(value)) {
        Object.keys(value).forEach(function (item) { if (value[item] === true) out.push(item); });
      }
      return out;
    }

    function uniqueTokens(list) {
      var out = [];
      list.forEach(function (item) {
        if (typeof item === 'string' && out.indexOf(item) < 0) out.push(item);
      });
      return out;
    }

    function storyContextForUnlock(career, context) {
      var source = isObject(context) ? context : {};
      var base = isObject(career.context) ? career.context : {};
      var flags = new Set(setValuesToArray(base.flags).concat(tokensOf(source.worldFlags)));
      var evidence = new Set(setValuesToArray(base.evidence).concat(tokensOf(source.storyEvidence)));
      var cleared = new Set(setValuesToArray(base.cleared).concat(tokensOf(source.clearedCommissions)));
      var capabilities = new Set(setValuesToArray(base.capabilities).concat(tokensOf(source.capabilities)));
      var items = new Map();
      if (base.items && typeof base.items.forEach === 'function') {
        base.items.forEach(function (value, key) { items.set(key, value); });
      }
      if (isObject(source.items)) Object.keys(source.items).forEach(function (key) { items.set(key, source.items[key]); });
      var wallet = isObject(career.wallet) ? career.wallet : {};
      return {
        flags: flags,
        evidence: evidence,
        cleared: cleared,
        capabilities: capabilities,
        items: items,
        credits: Number.isFinite(Number(wallet.credits)) ? Number(wallet.credits) : 0,
      };
    }

    function publicCommission(commission, world, clearedIds) {
      var clearedList = Array.isArray(clearedIds) ? clearedIds : [];
      var publicText = world && isObject(state.worldWorkTexts[commission.commissionId])
        ? state.worldWorkTexts[commission.commissionId]
        : {};
      var out = {
        commissionId: commission.commissionId,
        gameId: commission.gameId,
        gameName: function () {
          var games = state.catalog && Array.isArray(state.catalog.games) ? state.catalog.games : [];
          var game = games.find(function (row) { return row && row.gameId === commission.gameId; });
          return game && typeof game.displayName === 'string' && game.displayName ? game.displayName : commission.gameId;
        }(),
        objective: commission.objective && typeof commission.objective.kind === 'string'
          ? { kind: commission.objective.kind, atLeast: commission.objective.atLeast }
          : null,
        category: world ? 'world' : 'profession',
        worldWork: world,
        title: world
          ? (typeof publicText.title === 'string' && publicText.title ? publicText.title : WORLD_WORK_TITLE)
          : commission.title,
        summary: world
          ? (typeof publicText.summary === 'string' && publicText.summary ? publicText.summary : WORLD_WORK_SUMMARY)
          : commission.summary,
        issuer: world ? '旧港' : commission.issuer,
        reward: world
          ? { credits: commission.reward && Number.isFinite(Number(commission.reward.credits)) ? Number(commission.reward.credits) : 0, items: {}, evidence: [], flags: [] }
          : clone(commission.reward),
        repeatSalaryCredits: commission.repeatSalaryCredits,
        durationHint: commission.durationHint,
        risk: commission.risk,
        startParams: clone(commission.startParams),
        tier: commission.tier,
        cleared: clearedList.indexOf(commission.commissionId) >= 0,
        unlocked: true,
        historicalOnly: false,
        readOnly: false,
      };
      if (!world) out.professionId = commission.professionId;
      return out;
    }

    function buildGateCatalog(catalog) {
      var out = clone(catalog);
      out.commissions = (ensureContent() ? ensureContent().commissions : []).map(function (row) { return clone(row); });
      out.worldWorkIds = state.worldWorkIds.slice();
      out.worldWork = Object.assign({}, isObject(out.worldWork) ? out.worldWork : {}, {
        commissionIds: state.worldWorkIds.slice(),
      });
      return out;
    }

    function isRunIdSafe(value) {
      var core = resolveCore();
      if (core && isFunction(core.isValidCareerId)) return core.isValidCareerId(value);
      return isRunId(value);
    }

    /* ---------------- ticket 形状 ---------------- */

    function ticketUrl(ticket) {
      var gameUrl = arcadeBase + 'games/' + ticket.gameId + '.html?' + TICKET_PARAM + '=';
      try {
        return gameUrl + encodeURIComponent(ticket.ticketId);
      } catch (err) {
        return gameUrl + ticket.ticketId;
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
      if (objective.minValue && check && check.reason === 'value-not-met') {
        var reached = Number.isFinite(Number(check.reached)) ? Number(check.reached) : 0;
        return title + '：这趟只做到 ' + reached + ' / ' + objective.minValue.value + '，' + issuer + '不收。';
      }
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

    async function safeUpdateRun(db, ticketId, patch, expectedStatus) {
      if (!db || !isFunction(db.updateRun)) return null;
      try {
        return await db.updateRun(ticketId, patch, expectedStatus);
      } catch (err) {
        return null;
      }
    }

    /* ---------------- 公开方法：configure ---------------- */

    function collectWorldTexts(raw) {
      var texts = Object.create(null);
      if (!isObject(raw)) return texts;
      var addRow = function (row) {
        if (!isObject(row)) return;
        var id = typeof row.commissionId === 'string' ? row.commissionId : typeof row.id === 'string' ? row.id : '';
        if (!isStableId(id)) return;
        texts[id] = {
          title: typeof row.title === 'string' ? row.title : '',
          summary: typeof row.summary === 'string' ? row.summary : typeof row.description === 'string' ? row.description : '',
        };
      };
      ['works', 'commissions', 'entries', 'list'].forEach(function (key) {
        if (Array.isArray(raw[key])) raw[key].forEach(addRow);
      });
      ['byId', 'entries', 'texts'].forEach(function (key) {
        if (isObject(raw[key])) Object.keys(raw[key]).forEach(function (id) {
          addRow(Object.assign({ commissionId: id }, isObject(raw[key][id]) ? raw[key][id] : {}));
        });
      });
      return texts;
    }

    function configureWorldWork(source) {
      var candidates = [];
      var add = function (id) {
        if (!isStableId(id)) return false;
        if (candidates.indexOf(id) < 0) candidates.push(id);
        return true;
      };
      var valid = true;
      var worldWorkSources = [];
      if (source && isObject(source.catalog) && isObject(source.catalog.worldWork)) worldWorkSources.push(source.catalog.worldWork);
      if (source && isObject(source.worldWork)) worldWorkSources.push(source.worldWork);
      worldWorkSources.forEach(function (worldWork) {
        ['commissionIds', 'ids'].forEach(function (key) {
          if (worldWork[key] === undefined) return;
          if (!Array.isArray(worldWork[key])) valid = false;
          else worldWork[key].forEach(function (id) { if (!add(id)) valid = false; });
        });
      });
      if (source && Object.prototype.hasOwnProperty.call(source, 'worldWorkIds')) {
        if (!Array.isArray(source.worldWorkIds)) valid = false;
        else source.worldWorkIds.forEach(function (id) { if (!add(id)) valid = false; });
      }
      if (!valid) return { ok: false, ids: [], texts: Object.create(null) };
      var texts = Object.create(null);
      worldWorkSources.forEach(function (worldWork) {
        var collected = collectWorldTexts(worldWork);
        Object.keys(collected).forEach(function (id) { texts[id] = collected[id]; });
      });
      return { ok: true, ids: candidates, texts: texts };
    }

    function configure(input) {
      try {
        var source = isObject(input) ? input : null;
        var hasContent = !!source && Object.prototype.hasOwnProperty.call(source, 'content');
        var content = null;
        var configOnlyKeys = ['worldWorkIds', 'catalog', 'arcadeBase', 'worldWork'];
        if (hasContent) content = source.content;
        else if (Array.isArray(input)) content = input;
        else if (isObject(input) && !hasContent && !configOnlyKeys.some(function (key) { return Object.prototype.hasOwnProperty.call(input, key); })) content = input;
        else if (input === undefined || input === null) content = null;
        var hasConfiguration = hasContent || Array.isArray(input) || (isObject(input) && !configOnlyKeys.some(function (key) { return Object.prototype.hasOwnProperty.call(input, key); }));
        var core = resolveCore();
        if (!core && content !== null && content !== undefined && (hasContent || hasConfiguration)) {
          return { ok: false, contentVersion: CONTENT_VERSION, count: 0, errors: [REASONS.coreUnavailable], warnings: [], usable: false };
        }
        var normalized = hasConfiguration ? applyContent(content) : null;
        var configErrors = normalized ? normalized.errors.slice() : state.contentErrors.slice();
        if (source && Object.prototype.hasOwnProperty.call(source, 'catalog')) {
          state.catalog = isObject(source.catalog) ? clone(source.catalog) : null;
          if (!state.catalog) configErrors.push('catalog-invalid');
        }
        var hasWorldConfiguration = !!source && ['worldWorkIds', 'worldWork'].some(function (key) {
          return Object.prototype.hasOwnProperty.call(source, key);
        }) || !!(source && isObject(source.catalog) && isObject(source.catalog.worldWork));
        if (hasWorldConfiguration) {
          var world = configureWorldWork(source);
          if (!world.ok) configErrors.push('world-work-ids-invalid');
          else {
            state.worldWorkIds = world.ids.slice();
            state.worldWorkTexts = world.texts;
          }
        }
        if (source && typeof source.arcadeBase === 'string') arcadeBase = source.arcadeBase;
        var configurationOnly = !!source && !hasContent && !hasConfiguration;
        if (!normalized && !state.content && !configurationOnly) {
          var empty = applyContent(null);
          configErrors = configErrors.concat(empty.errors);
        }
        var contentState = ensureContent();
        var contentReady = !!contentState && contentState.usable && configErrors.length === 0;
        var response = {
          ok: contentReady,
          contentVersion: contentState ? contentState.contentVersion : CONTENT_VERSION,
          count: contentState ? contentState.commissions.length : 0,
          errors: configErrors,
          warnings: normalized ? normalized.warnings.slice() : state.contentWarnings.slice(),
          usable: contentReady,
          contentReady: contentReady,
          worldWorkCount: state.worldWorkIds.length,
        };
        if (!contentReady && configurationOnly && !contentState) response.reason = 'content-not-configured';
        return response;
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

    /* ---------------- 公开方法：continuations（只读生涯连续性查询） ---------------- */

    /**
     * 关闭标签页后 sessionStorage ticket 丢失时的只读发现入口（0.20 生涯首航 V2）。
     *
     * API 形状（对告示板/主 Agent 冻结，bridge 在 ctx.commission 与 ctx.careerContinuations 上暴露）：
     *   commission.continuations({ careerId? }) -> Promise<{
     *     ok: true, careerId: string|null,
     *     runs: [{
     *       runId, ticketId, commissionId, gameId,
     *       status: 'issued'|'active',
     *       issuedAt, startedAt: string|null
     *     }]
     *   }>
     *   失败：{ ok:false, reason, careerId:null, runs:[] }
     *
     * - 只读：不 ensureCareer、不 createRun、不写 sessionStorage；仅按 status 集合
     *   ['issued','active'] 过滤 DB runs（失败/放弃/结算都不算），不创建任何数据。
     * - careerId 缺省时读 state store 的生涯指针；指针也不存在时返回 {ok:true, careerId:null, runs:[]}。
     * - 排序稳定：active 优先，再按 issuedAt 升序，再按 runId 字典序；多 live run 时 UI 可稳定选择。
     * - 明确继续由玩家动作触发：UI 用本 run 的 commissionId 调 commission.start（已支持
     *   DB live run 复用并恢复 ticket），只用返回的 url 导航；本方法永不自动接管或建票。
     * - C5 终局 run 的 commissionId 形如 'ending.<approach>'，UI 可按需过滤，不在这里改语义。
     */
    async function continuationsSafe(input) {
      var opts = isObject(input) ? input : {};
      var core = resolveCore();
      var db = resolveDb();
      if (!core) return failure(REASONS.coreUnavailable, { careerId: null, runs: [] });
      if (!db) return failure(REASONS.dbUnavailable, { careerId: null, runs: [] });
      var careerId = isRunIdSafe(opts.careerId) ? opts.careerId : null;
      if (!careerId && isFunction(db.getState)) {
        try {
          var pointer = await db.getState('career');
          var pointerId = pointer && isObject(pointer.value) ? pointer.value.careerId : pointer && pointer.careerId;
          if (isRunIdSafe(pointerId)) careerId = pointerId;
        } catch (err) {
          careerId = null;
        }
      }
      if (!careerId) return { ok: true, careerId: null, runs: [] };
      if (!isFunction(db.listRuns)) return failure(REASONS.dbUnavailable, { careerId: careerId, runs: [] });
      var listed = null;
      try {
        listed = await db.listRuns({ careerId: careerId, statuses: LIVE_STATUS.slice(), mode: MODE });
      } catch (err) {
        return failure(REASONS.exception, { careerId: careerId, runs: [] });
      }
      /* 兼容两种 listRuns 返回形状：新形状 {ok,runs} 能区分「读失败」与「没有 run」；
         旧形状 Array 兼容注入的测试 DB。读失败必须 ok:false，不能伪装成空列表。 */
      var rows = null;
      if (isObject(listed) && Object.prototype.hasOwnProperty.call(listed, 'ok')) {
        if (listed.ok !== true) return failure(listed.reason || REASONS.dbUnavailable, { careerId: careerId, runs: [] });
        rows = Array.isArray(listed.runs) ? listed.runs : [];
      } else if (Array.isArray(listed)) {
        rows = listed;
      } else {
        return failure(REASONS.dbUnavailable, { careerId: careerId, runs: [] });
      }
      var runs = [];
      for (var i = 0; i < rows.length; i += 1) {
        var row = rows[i];
        if (!isObject(row) || row.careerId !== careerId || row.mode !== MODE) continue;
        if (LIVE_STATUS.indexOf(row.status) < 0) continue;
        var runId = typeof row.runId === 'string' ? row.runId : typeof row.ticketId === 'string' ? row.ticketId : '';
        if (!isRunId(runId)) continue;
        runs.push({
          runId: runId,
          ticketId: typeof row.ticketId === 'string' && row.ticketId ? row.ticketId : runId,
          commissionId: typeof row.commissionId === 'string' ? row.commissionId : null,
          gameId: typeof row.gameId === 'string' ? row.gameId : null,
          status: row.status === 'active' ? 'active' : 'issued',
          issuedAt: typeof row.issuedAt === 'string' ? row.issuedAt : typeof row.createdAt === 'string' ? row.createdAt : null,
          startedAt: typeof row.startedAt === 'string' ? row.startedAt : null,
        });
      }
      runs.sort(function (a, b) {
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
        var left = a.issuedAt || '';
        var right = b.issuedAt || '';
        if (left !== right) return left < right ? -1 : 1;
        if (a.runId === b.runId) return 0;
        return a.runId < b.runId ? -1 : 1;
      });
      return { ok: true, careerId: careerId, runs: runs };
    }

    function continuations(input) {
      return guardAsync('continuations', continuationsSafe(input), { ok: false, reason: REASONS.exception, careerId: null, runs: [] });
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
      /* 显式 ensure:true 也不再创建身份；无身份是结构化失败。 */
      var career = await resolveCareer({ careerId: opts.careerId });
      if (!career.ok || !career.careerId) {
        return failure(career.reason || REASONS.careerUnavailable, { careerId: null, commissions: [] });
      }
      var guard = await readCareerGuard(career.careerId, opts.context);
      if (!guard.ok) return failure(guard.reason, { careerId: career.careerId, commissions: [] });
      var stateRead = await readProfessionState();
      if (!stateRead.ok) return failure(stateRead.reason, { careerId: career.careerId, commissions: [] });
      var catalog = readCatalog();
      var view = resolveProfessionView();
      if (!catalog || !view) return failure(REASONS.catalogUnavailable, { careerId: career.careerId, commissions: [] });
      var gateCatalog = buildGateCatalog(catalog);
      var context = projectionContext(career, trustedContext(opts.context));
      if (futureVersionOf(stateRead.state)) {
        return failure('future-version', { careerId: career.careerId, commissions: [] });
      }

      var candidateIds = [];
      content.commissions.forEach(function (commission) {
        var world = worldCommission(commission);
        var shown = view.canShowCommission({
          state: stateRead.state,
          catalog: gateCatalog,
          context: context,
          commissionId: commission.commissionId,
        });
        if (!shown.ok || shown.historicalOnly === true) return;
        /* 原 commission-core 谓词仍逐单重算，availableIds 不能绕过 world/story gate。 */
        if (!isUnlocked(commission, storyContextForUnlock(career, context))) return;
        candidateIds.push(commission.commissionId);
      });
      context.availableIds = candidateIds.slice();
      var commissions = [];
      content.commissions.forEach(function (commission) {
        if (candidateIds.indexOf(commission.commissionId) < 0) return;
        var accepted = view.canAcceptCommission({
          state: stateRead.state,
          catalog: gateCatalog,
          context: context,
          commissionId: commission.commissionId,
        });
        if (!accepted.ok) return;
        var world = worldCommission(commission);
        commissions.push(publicCommission(commission, world, context.clearedCommissions));
      });
      commissions.sort(function (a, b) {
        if (a.commissionId === b.commissionId) return 0;
        return a.commissionId < b.commissionId ? -1 : 1;
      });
      return {
        ok: true,
        careerId: career.careerId,
        created: false,
        commissions: commissions,
        availableIds: commissions.map(function (commission) { return commission.commissionId; }),
        contentVersion: CONTENT_VERSION,
      };
    }

    function listAvailable(input) {
      return guardAsync('list-available', listAvailableSafe(input), { ok: false, reason: REASONS.exception, careerId: null, commissions: [] });
    }

    /* ---------------- 公开方法：start ---------------- */

    /**
     * start 幂等命中 DB live run 时组装复用结果（不修改 DB；只恢复本标签页 sessionStorage ticket）。
     *
     * 原票语义保持：nonce / rulesetVersion / contentVersion / startParams / seed / attempt
     * 全部来自 run 行（签票时写入的权威快照），不因当前内容版本变化而重写：
     *   - 旧内容签名的新票不得被当前内容覆盖，否则游戏页 validateTicket 的版本/nonce 会拒收；
     *   - startParams 只在 run 行完全没有时回退到当前 commission（旧档兼容），有则原样保留。
     */
    function reuseResult(run, commission, careerId, via) {
      var ticket = ticketFromRun(run, commission);
      if (!ticket) return null;
      if (!isObject(run.startParams) || Object.keys(run.startParams).length === 0) {
        ticket.startParams = clone(commission.startParams) || {};
      } else {
        ticket.startParams = clone(run.startParams);
      }
      if (typeof run.rulesetVersion === 'number') ticket.rulesetVersion = run.rulesetVersion;
      if (typeof run.contentVersion === 'string' && run.contentVersion) ticket.contentVersion = run.contentVersion;
      if (typeof run.seed === 'string') ticket.seed = run.seed;
      if (Number.isFinite(Number(run.attempt))) ticket.attempt = toPositiveInt(run.attempt, 1);
      if (!ticket.careerId) ticket.careerId = careerId || run.careerId || null;
      /* DB 是 nonce 权威；旧/缺 nonce 的 run 不可伪造票，避免桥接层 validateTicket 拒收。 */
      if (!NONCE_RE.test(ticket.nonce || '')) return null;
      writeStoredTicket(storedTicketOf(ticket));
      rememberRun(ticket, run);
      return {
        ok: true,
        reused: true,
        via: via,
        ticket: ticket,
        ticketId: ticket.ticketId,
        runId: ticket.runId,
        careerId: ticket.careerId,
        commissionId: commission.commissionId,
        gameId: ticket.gameId,
        url: ticketUrl(ticket),
      };
    }

    async function findAuthoritativeLiveRun(db, careerId, commissionId) {
      if (!db || !isFunction(db.listRuns)) return null;
      var listed = null;
      try {
        listed = await db.listRuns({ careerId: careerId, statuses: LIVE_STATUS.slice(), mode: MODE, commissionId: commissionId });
      } catch (err) {
        return null;
      }
      var rows = isObject(listed) && Object.prototype.hasOwnProperty.call(listed, 'ok')
        ? (listed.ok === true && Array.isArray(listed.runs) ? listed.runs : [])
        : (Array.isArray(listed) ? listed : []);
      var live = null;
      for (var i = 0; i < rows.length; i += 1) {
        var candidate = rows[i];
        if (!isObject(candidate) || candidate.careerId !== careerId || candidate.commissionId !== commissionId) continue;
        if (candidate.mode !== MODE || !isLiveStatus(candidate.status)) continue;
        var full = await safeGetRun(db, typeof candidate.ticketId === 'string' && candidate.ticketId ? candidate.ticketId : candidate.runId);
        if (!full || full.careerId !== careerId || full.commissionId !== commissionId || full.mode !== MODE || !isLiveStatus(full.status)) continue;
        if (!live || (full.status === 'active' && live.status !== 'active')) live = full;
      }
      return live;
    }

    function mayContinueAcceptedRun(stateRead, gateCatalog, view, commission) {
      if (!view || !stateRead || !stateRead.ok) return false;
      if (futureVersionOf(stateRead.state)) return false;
      var context = { surface: 'port' };
      if (worldCommission(commission)) {
        return gateCatalog.professions.some(function (profession) {
          return isObject(profession) && typeof profession.professionId === 'string' && profession.professionId
            && view.canRevealProfession({ state: stateRead.state, catalog: gateCatalog, context: context, professionId: profession.professionId }).ok;
        });
      }
      return view.canRevealProfession({
        state: stateRead.state,
        catalog: gateCatalog,
        context: context,
        professionId: commission.professionId,
      }).ok;
    }

    function futureVersionOf(state) {
      return isObject(state) && Number.isInteger(state.professionVersion) && state.professionVersion > 1;
    }

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

      var career = await resolveCareer({ careerId: opts.careerId });
      if (!career.ok || !career.careerId) return failure(career.reason || REASONS.careerUnavailable);
      var guard = await readCareerGuard(career.careerId, opts.context);
      if (!guard.ok) return failure(guard.reason, { commissionId: commissionId, careerId: career.careerId });
      var context = projectionContext(career, trustedContext(opts.context));
      var isEnding = isRegisteredEnding(commissionId);
      var stateRead = isEnding ? { ok: true, state: null } : await readProfessionState();
      var catalog = isEnding ? null : readCatalog();
      var view = isEnding ? null : resolveProfessionView();
      var gateCatalog = catalog ? buildGateCatalog(catalog) : null;

      /* 冻结语义：已有 live run 是“继续”，先按 DB 权威字段校验并复用原票。
         只有签票后短期 story/world 前置变化、搁置职业等均不得阻塞既有任务。 */
      var liveRun = await findAuthoritativeLiveRun(db, career.careerId, commissionId);
      if (liveRun) {
        if (!isEnding && !mayContinueAcceptedRun(stateRead, gateCatalog, view, commission)) {
          return failure('not-accepted', { commissionId: commissionId, careerId: career.careerId });
        }
        var recoveredRun = reuseResult(liveRun, commission, career.careerId, 'db-live-run');
        if (recoveredRun) return recoveredRun;
      }

      /* 本标签页仍有原票时也必须回 DB 验证 run 字段，不能仅凭 sessionStorage 复用。 */
      var stored = readStoredTicket();
      if (
        stored &&
        isObject(stored) &&
        stored.commissionId === commissionId &&
        stored.careerId === career.careerId &&
        isRunId(stored.ticketId)
      ) {
        var storedRun = await safeGetRun(db, stored.ticketId);
        if (
          storedRun && storedRun.careerId === career.careerId && storedRun.commissionId === commissionId
          && storedRun.mode === MODE && isLiveStatus(storedRun.status)
        ) {
          if (!isEnding && !mayContinueAcceptedRun(stateRead, gateCatalog, view, commission)) {
            return failure('not-accepted', { commissionId: commissionId, careerId: career.careerId });
          }
          var reused = reuseResult(storedRun, commission, career.careerId, 'stored-ticket');
          if (reused) return reused;
        }
      }

      /* 未命中任何权威 live run，才执行新接单的 story/world 与职业 gate。 */
      if (!isEnding) {
        if (!stateRead.ok) return failure(stateRead.reason, { commissionId: commissionId, careerId: career.careerId });
        if (!gateCatalog || !view) return failure(REASONS.catalogUnavailable, { commissionId: commissionId, careerId: career.careerId });
        var gateOptions = {
          state: stateRead.state,
          catalog: gateCatalog,
          context: context,
          commissionId: commissionId,
        };
        var shown = view.canShowCommission(gateOptions);
        if (!shown.ok) return failure(shown.reason, { commissionId: commissionId, careerId: career.careerId });
        if (shown.historicalOnly === true) {
          return failure('historical-only', { commissionId: commissionId, careerId: career.careerId });
        }
        if (!isUnlocked(commission, storyContextForUnlock(career, context))) {
          return failure(REASONS.locked, { commissionId: commissionId, careerId: career.careerId, message: '港口的告示还没换成这一张。' });
        }
        /* 核心再次执行统一可接受 gate；调用方传入的 availableIds 不作为授权凭据。 */
        gateOptions.context = Object.assign({}, context, { availableIds: [commissionId] });
        var accepted = view.canAcceptCommission(gateOptions);
        if (!accepted.ok) return failure(accepted.reason, { commissionId: commissionId, careerId: career.careerId });
      } else if (!isUnlocked(commission, storyContextForUnlock(career, context))) {
        /* 三条已注册终局只检查 C4 世界条件，不要求接受任何特定职业。 */
        return failure(REASONS.locked, { commissionId: commissionId, careerId: career.careerId, message: '港口的告示还没换成这一张。' });
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
      /* 多标签并发兜底：DB 在同一事务发现既有 live run 时返回 duplicate（不插入新行），复用原票。 */
      if (created.duplicate === true && created.run) {
        var raced = reuseResult(created.run, commission, career.careerId, 'create-run-duplicate');
        if (raced) return raced;
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
      var patched = await safeUpdateRun(db, ticketId, { status: 'active', startedAt: nowIso() }, run.status);
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
        var seq = Number(event.seq);
        var payload = sanitizePayload(event.payload);
        if (entry.buffer.length >= BUFFER_LIMIT) {
          /* 0.18：缓冲满后不再丢弃真实事件，按 kind 汇总计数/数值最大值/最后上下文，
             结算时以合成事件并入摘要；内存只随 kind×字段数增长。 */
          entry.dropped += 1;
          if (!isObject(entry.overflow)) entry.overflow = { counts: {}, maxima: {}, last: {}, contexts: {} };
          var kind = event.kind;
          entry.overflow.counts[kind] = (entry.overflow.counts[kind] || 0) + 1;
          entry.overflow.last[kind] = payload;
          if (!isObject(entry.overflow.maxima[kind])) entry.overflow.maxima[kind] = {};
          Object.keys(payload).forEach(function (field) {
            var value = payload[field];
            if (typeof value !== 'number' || !Number.isFinite(value)) return;
            var prev = entry.overflow.maxima[kind][field];
            if (!Number.isFinite(prev) || value > prev) entry.overflow.maxima[kind][field] = value;
          });
          /* 上下文维度（theme/level 等）不能只留最后一条：按字符串上下文字段分组保留。 */
          var contextFields = Object.keys(payload).filter(function (field) { return typeof payload[field] === 'string'; }).sort();
          if (contextFields.length) {
            var contextKey = contextFields.map(function (field) { return field + '=' + payload[field]; }).join('|');
            if (!isObject(entry.overflow.contexts[kind])) entry.overflow.contexts[kind] = {};
            var group = entry.overflow.contexts[kind][contextKey];
            if (!group) {
              group = { count: 0, payload: {}, maxima: {} };
              entry.overflow.contexts[kind][contextKey] = group;
            }
            group.count += 1;
            Object.keys(payload).forEach(function (field) {
              var value = payload[field];
              if (typeof value === 'number' && Number.isFinite(value)) {
                if (!Number.isFinite(group.maxima[field]) || value > group.maxima[field]) group.maxima[field] = value;
              } else if (typeof payload[field] === 'string') {
                group.payload[field] = payload[field];
              }
            });
          }
          state.lastEventAt = nowIso();
          return true;
        }
        entry.buffer.push({
          kind: event.kind,
          payload: payload,
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
      /* 只汇总本页真实事件；缓冲为空就按空摘要判定，绝不伪造事件。
         缓冲溢出的事件以合成事件（count + 最大值 + 最后上下文）并入，长局达标不被丢弃。 */
      var events = entry ? clone(entry.buffer) || [] : [];
      if (entry && isObject(entry.overflow)) {
        var overflowEvents = [];
        var overflowCounts = entry.overflow.counts || {};
        var overflowContexts = entry.overflow.contexts || {};
        Object.keys(overflowCounts).forEach(function (kind) {
          var groups = overflowContexts[kind] || {};
          var groupKeys = Object.keys(groups);
          if (groupKeys.length) {
            groupKeys.forEach(function (groupKey) {
              var group = groups[groupKey];
              var payload = Object.assign({}, group.payload || {});
              Object.keys(group.maxima || {}).forEach(function (field) { payload[field] = group.maxima[field]; });
              overflowEvents.push({
                kind: kind,
                payload: payload,
                count: Math.max(1, Math.floor(Number(group.count) || 1)),
                seq: 0,
                sourceMode: MODE,
                at: nowIso(),
              });
            });
            return;
          }
          var count = Number(overflowCounts[kind]);
          if (!Number.isFinite(count) || count <= 0) return;
          var payload = Object.assign({}, (entry.overflow.last && entry.overflow.last[kind]) || {});
          var maxima = (entry.overflow.maxima && entry.overflow.maxima[kind]) || {};
          Object.keys(maxima).forEach(function (field) { payload[field] = maxima[field]; });
          overflowEvents.push({
            kind: kind,
            payload: payload,
            count: Math.floor(count),
            seq: 0,
            sourceMode: MODE,
            at: nowIso(),
          });
        });
        /* 上下文事件排在摘要前面：core 的 facet 上限不会让关键 theme/level 被长局数值淹没。 */
        events = overflowEvents.concat(events);
      }

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
          reached: check && Number.isFinite(Number(check.reached)) ? Number(check.reached) : null,
          objective: check && isObject(check.objective) ? check.objective : null,
          stats: stats,
          settledAt: nowIso(),
          gameId: gameId,
        };
        var patchedFail = await safeUpdateRun(db, ticketId, failurePatch, run.status);
        if (!patchedFail || patchedFail.ok !== true) {
          /* 迟到失败遇到 claimed：以已提交收据为准，不把失败写回，也不释放任何终局。 */
          var racedClaim = await readClaim(db, ticketId);
          if (racedClaim) {
            forgetTicket(ticketId);
            return recordResult({
              ok: true,
              duplicate: true,
              receipt: racedClaim,
              credits: racedClaim.credits,
              items: racedClaim.items,
              runId: ticketId,
              careerId: run.careerId,
              commissionId: commission.commissionId,
              repeat: true,
              stateRaced: true,
            });
          }
        }
        forgetTicket(ticketId);
        return recordResult(failure(reason, {
          runId: ticketId,
          careerId: run.careerId,
          commissionId: commission.commissionId,
          observed: failurePatch.observed,
          reached: failurePatch.reached,
          objective: failurePatch.objective,
          message: failureMessage(commission, check),
          runUpdated: !!(patchedFail && patchedFail.ok),
        }));
      }

      var plan = null;
      var repeatPlan = null;
      try {
        plan = core.rewardPlan(commission, events, { mode: MODE, repeat: false, gameId: gameId, stats: stats });
        repeatPlan = core.rewardPlan(commission, events, { mode: MODE, repeat: true, gameId: gameId, stats: stats });
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
      if (!repeatPlan || !repeatPlan.ok) {
        return recordResult(failure((repeatPlan && repeatPlan.reason) || REASONS.planFailed, {
          runId: ticketId,
          observed: check.observed,
          objective: check.objective,
        }));
      }
      if (opts.deferCommit === true) {
        return recordResult({
          ok: true,
          deferred: true,
          runId: ticketId,
          careerId: run.careerId,
          commissionId: commission.commissionId,
          gameId: gameId,
          plan: {
            credits: plan.credits,
            items: plan.items,
            evidence: plan.evidence,
            flags: plan.flags,
          },
          outcome: outcome,
          stats: stats,
        });
      }

      var priorRepeat = null;
      try {
        if (db && typeof db.readQuestState === 'function') {
          var priorQuestState = await db.readQuestState(run.careerId);
          priorRepeat = isQuestCleared(priorQuestState, commission.commissionId);
        }
      } catch (err) {
        priorRepeat = null;
      }
      var retroFirstClear = false;
      try {
        if (typeof db.hasPendingFirstClear === 'function') {
          var pendingFirst = await db.hasPendingFirstClear({
            careerId: run.careerId,
            commissionId: commission.commissionId,
            repeatCredits: repeatPlan.credits,
            firstCredits: plan.credits,
          });
          retroFirstClear = !!(pendingFirst && pendingFirst.ok === true && pendingFirst.pending === true);
        }
      } catch (err) {
        retroFirstClear = false;
      }
      var claim = null;
      try {
        claim = await db.settleAndClaim({
          runId: ticketId,
          careerId: run.careerId,
          nonce: run.nonce,
          retroFirstClear: retroFirstClear,
          plan: {
            credits: plan.credits,
            items: plan.items,
            evidence: plan.evidence,
            flags: plan.flags,
          },
          repeatPlan: {
            credits: repeatPlan.credits,
            items: repeatPlan.items,
            evidence: repeatPlan.evidence,
            flags: repeatPlan.flags,
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
        repeat: typeof claim.repeat === 'boolean' ? claim.repeat : priorRepeat === true,
        firstClear: claim.firstClear === true,
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
      var patched = await safeUpdateRun(db, ticketId, { status: 'abandoned', abandonedAt: nowIso() }, status);
      if (!patched || !patched.ok) {
        if (patched && patched.reason === 'run-state') {
          var racedClaim = await readClaim(db, ticketId);
          if (racedClaim) return failure(REASONS.settled, { ticketId: ticketId, status: 'claimed', receipt: racedClaim, duplicate: true });
        }
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
        state.catalog = null;
        state.worldWorkIds = [];
        state.worldWorkTexts = Object.create(null);
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
      continuations: continuations,
      start: start,
      validateTicket: validateTicket,
      markActive: markActive,
      adoptRun: adoptRun,
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
