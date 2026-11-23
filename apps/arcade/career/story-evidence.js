/*!
 * StudioKit Arcade Life — C2–C4 剧情证据标记接口（0.17，D17-23）
 *
 * 职责：把职业委托结算收据里的稳定 evidence token（E-/MAP-/BP-/DEC-）登记为
 * quests 里的只读证据行；按“证据组合”推导 C2–C4 剧情旗标；为 storyContextFrom /
 * resolveStory 提供只读上下文。ADR 依据：docs/arcade-life/ADR-interfaces.md
 * §6（故事条件谓词）、§8（领奖收据）、§19.2（96 委托 schema）、§19.6（证据/路线）。
 *
 * 硬约束（本模块不越界）：
 * - 纯 UMD：浏览器挂全局 ArcadeCareerStoryEvidence，并镜像到 ArcadeCareer.storyEvidence；
 *   Node 中 module.exports 返回同一 API；不碰 DOM、不发网络请求、不写任何浏览器存储。
 * - 证据不可消耗、不可重放发奖：本模块只写 quests 证据行/旗标行，永不发钱、发材料、
 *   写 ledger/balances/claims；重复收据只返回 duplicate 且零写入。
 * - 不信任任意字符串：token 必须同时满足 E-/MAP-/BP-/DEC- 结构规则 + 由内容声明
 *   （configure 白名单）；recordFromReceipt 在可用时以 claims store 的收据为权威，
 *   调用方自带 receipt 只能作为 claims 的子集，不能新增 token。
 * - 剧情旗标只由证据组合授予：收据里的 flags 字段不参与 C2–C4 授予；旗标依赖的内容
 *   章节规则可在 configure({chapter}) 覆盖（未提供时使用本文件的内置保守规则）。
 * - 单游戏不得成为唯一前置：内置规则每条都有多分支，validate() 会逐游戏做
 *   “去掉该游戏后仍可解锁”的可达性检查（T4–T6 chapterGate 只读检查同源）。
 * - 所有公开方法捕获异常返回结构化失败；库表事务与幂等语义由注入的 db 负责。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory(typeof globalThis !== 'undefined' ? globalThis : this, true);
    return;
  }
  var api = factory(root, false);
  root.ArcadeCareerStoryEvidence = api;
  var career = root.ArcadeCareer;
  if (!career || typeof career !== 'object') career = root.ArcadeCareer = {};
  if (career.storyEvidence !== api) {
    try {
      career.storyEvidence = api;
    } catch (err) {
      /* 只读宿主：忽略镜像失败，窗口级名字仍可用。 */
    }
  }
})(typeof window !== 'undefined' ? window : globalThis, function storyEvidenceFactory(root, isNode) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 常量与形状（与 content/commissions.json、commission-schema 对齐）
   * ------------------------------------------------------------------ */

  var VERSION = '0.18.0';
  var MODULE_VERSION = '0.18.0';
  var CONTENT_VERSION = '0.18.0';
  var SCHEMA_VERSION = 1;

  /* ADR §19.2：reward.evidence 只放稳定 token；与 commission-schema.js 的 EVIDENCE_RE 一致。 */
  var EVIDENCE_PREFIXES = Object.freeze(['E', 'MAP', 'BP', 'DEC']);
  var EVIDENCE_RE = /^(E|MAP|BP|DEC)-[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
  /* 剧情旗标 token：C<章号>.<小写稳定名>（C1 来自委托奖励；C2–C4 由本模块推导）。 */
  var FLAG_RE = /^C[1-9]\.[a-z0-9][a-z0-9._-]{0,60}$/;
  var STORY_FLAG_RE = /^C[234]\.[a-z0-9][a-z0-9._-]{0,60}$/;
  /* careerId / runId / receiptId / nodeId：与 career-core 的 ID 形状一致（nodeId 额外允许冒号）。 */
  var ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
  var TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
  var GAME_ID_RE = /^[a-z0-9][a-z0-9._-]{1,79}$/;
  var PROFESSION_ID_RE = /^[a-z0-9][a-z0-9._-]{1,79}$/;

  var MAX_TOKENS_PER_RECEIPT = 24; /* 与 career-core.RULESET.evidenceCap 对齐 */
  var MAX_RECEIPT_ENTRIES = 64;
  var MAX_REQUIREMENT_DEPTH = 8;
  var MAX_REQUIREMENT_NODES = 64;
  var MAX_RULES = 16;
  var MAX_RULE_CSV = 8;
  var MAX_CANDIDATES = 24;
  var MAX_SUGGESTIONS = 12;
  var MAX_ORDER_ROWS = 32;

  /* 内容作者可用的类名别名（默认规则只用 E/MAP/BP/DEC 四个前缀）。 */
  var CLASS_ALIASES = Object.freeze({
    witness: 'E',
    record: 'E',
    research: 'E',
    route: 'MAP',
    map: 'MAP',
    blueprint: 'BP',
    plan: 'BP',
    decision: 'DEC',
    decree: 'DEC',
  });

  var REASONS = Object.freeze({
    notConfigured: 'not-configured',
    badCareerId: 'bad-career-id',
    badReceipt: 'bad-receipt',
    badEvidence: 'bad-evidence',
    careerMismatch: 'career-mismatch',
    receiptMismatch: 'receipt-mismatch',
    receiptNotClaimed: 'receipt-not-claimed',
    dbUnavailable: 'db-unavailable',
    dbReadFailed: 'db-read-failed',
    dbWriteFailed: 'db-write-failed',
    exception: 'exception',
    noCommissions: 'no-commissions',
    noEvidenceTokens: 'no-evidence-tokens',
    noStoryRules: 'no-story-rules',
    alreadyRecorded: 'already-recorded',
    unknownFlag: 'unknown-flag',
    unknownChapterGate: 'unknown-chapter-gate',
    noContext: 'no-context',
    gateNotMet: 'gate-not-met',
    noChapterGate: 'no-chapter-gate',
    unknownTier: 'unknown-tier',
    missingCommission: 'missing-commission',
    badChapterGate: 'bad-chapter-gate',
  });

  /* ------------------------------------------------------------------ *
   * 内置 C2–C4 规则（内容未提供章节规则时的保守兜底）
   *
   * 证据来自真实委托收据：
   * - T1/T2 已有 E-C1-site / E-C1-patrol 等现场记录；T2/T3 补充 E-/BP- 记录；
   * - MAP- 多在 T4/T5（chapterGate C3/C4），DEC- 在 T6（C5）——因此 C2–C4 的
   *   默认规则只要求“未门禁即可获得”的 E-/BP- 证据，MAP/DEC 仅作为未来内容或
   *   章节覆盖时的替代分支，避免把 C4 门禁写在 C4 自己的证据里（循环依赖）。
   * - 每条规则都至少两条互不依赖的路径；validate() 会对每个 gameId 做
   *   “移除该游戏仍可解锁”的反例检查。
   * ------------------------------------------------------------------ */

  var DEFAULT_RULES_RAW = [
    {
      flag: 'C2.research_complete',
      chapter: 'C2',
      label: '研究完成',
      require: {
        any: [
          { all: [{ class: 'E', atLeast: 2, distinctGames: true }] },
          { all: [{ class: 'E', atLeast: 1 }, { class: 'BP', atLeast: 1 }] },
          { all: [{ class: 'E', atLeast: 1 }, { class: 'MAP', atLeast: 1 }] },
        ],
      },
    },
    {
      flag: 'C3.truth_found',
      chapter: 'C3',
      label: '真相拼合',
      require: {
        all: [
          { flag: 'C2.research_complete' },
          {
            any: [
              { all: [{ class: 'E', atLeast: 3 }] },
              { all: [{ class: 'BP', atLeast: 1 }] },
              { all: [{ class: 'E', atLeast: 2, distinctGames: true }, { class: 'MAP', atLeast: 1 }] },
              { all: [{ class: 'MAP', atLeast: 2, distinctGames: true }] },
              { all: [{ class: 'E', atLeast: 1 }, { class: 'BP', atLeast: 1 }] },
            ],
          },
        ],
      },
    },
    {
      flag: 'C4.city_power_restored',
      chapter: 'C4',
      label: '城市供电恢复',
      require: {
        all: [
          { flag: 'C3.truth_found' },
          {
            any: [
              { all: [{ class: 'E', atLeast: 5 }] },
              { all: [{ class: 'E', atLeast: 2, distinctGames: true }, { class: 'BP', atLeast: 1 }] },
              { all: [{ class: 'BP', atLeast: 2, distinctGames: true }] },
              { all: [{ class: 'MAP', atLeast: 2, distinctGames: true }] },
              { all: [{ class: 'E', atLeast: 1 }, { class: 'MAP', atLeast: 1 }, { class: 'BP', atLeast: 1 }] },
            ],
          },
        ],
      },
    },
  ];

  /* 静态边界检查用的禁止片段：运行时拼接，避免本文件自身出现连续敏感字符串。 */
  var FORBIDDEN_SOURCE = Object.freeze([
    Object.freeze(['local' + 'Storage', '浏览器本地存储']),
    Object.freeze(['session' + 'Storage', '会话存储']),
    Object.freeze(['docu' + 'ment.', 'DOM 访问']),
    Object.freeze(['win' + 'dow.', 'DOM 访问']),
    Object.freeze(['fet' + 'ch(', '网络请求']),
    Object.freeze(['XMLHttp' + 'Request', '网络请求']),
    Object.freeze(['Web' + 'Socket', '网络请求']),
    Object.freeze(['send' + 'Beacon', '网络请求']),
    Object.freeze(['indexed' + 'DB.open', '绕过 db 注入直连存储']),
    Object.freeze(['settle' + 'AndClaim', '领奖入口']),
    Object.freeze(['pu' + 'rchase(', '购买入口']),
    Object.freeze(['sell' + 'Items(', '卖材料入口']),
    Object.freeze(['.del' + 'ete(', '删除证据行']),
    Object.freeze(['ArcadeCareer.' + 'db', '绕过注入直连全局 DB']),
  ]);

  /* 公开 API 上不允许出现经济写入口（防越界）。 */
  var FORBIDDEN_API_RE = /(purchase|sell|settle|grant|ledger|balance|wallet)/i;

  /* ------------------------------------------------------------------ *
   * 基础工具
   * ------------------------------------------------------------------ */

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isFunction(value) {
    return typeof value === 'function';
  }

  function hasOwn(object, key) {
    return !!object && Object.prototype.hasOwnProperty.call(object, key);
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

  function toPositiveInt(value, fallback) {
    var num = Number(value);
    if (!Number.isFinite(num) || Math.floor(num) < 1) return typeof fallback === 'number' ? fallback : 1;
    return Math.floor(num);
  }

  function toNonNegInt(value, fallback) {
    var num = Number(value);
    if (!Number.isFinite(num)) return typeof fallback === 'number' ? fallback : 0;
    var floored = Math.floor(num);
    return floored < 0 ? 0 : floored;
  }

  function isEvidenceToken(value) {
    return typeof value === 'string' && EVIDENCE_RE.test(value);
  }

  function isFlagToken(value) {
    return typeof value === 'string' && FLAG_RE.test(value);
  }

  function isStoryFlagToken(value) {
    return typeof value === 'string' && STORY_FLAG_RE.test(value);
  }

  function isStableId(value) {
    return typeof value === 'string' && ID_RE.test(value);
  }

  function isNodeToken(value) {
    return typeof value === 'string' && TOKEN_RE.test(value);
  }

  function tokenArray(value) {
    var out = [];
    if (!Array.isArray(value)) return out;
    for (var i = 0; i < value.length; i += 1) {
      if (typeof value[i] === 'string' && value[i]) out.push(value[i]);
    }
    return out;
  }

  function sortedUnique(values) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < values.length; i += 1) {
      var value = values[i];
      if (typeof value !== 'string' || !value) continue;
      if (seen[value]) continue;
      seen[value] = true;
      out.push(value);
    }
    out.sort();
    return out;
  }

  function sortedSetValues(setLike) {
    var out = [];
    if (!setLike) return out;
    if (typeof setLike.forEach === 'function') {
      setLike.forEach(function (value) {
        if (typeof value === 'string' && value) out.push(value);
      });
    } else if (Array.isArray(setLike)) {
      for (var i = 0; i < setLike.length; i += 1) {
        if (typeof setLike[i] === 'string' && setLike[i]) out.push(setLike[i]);
      }
    }
    out.sort();
    return out;
  }

  function toSet(value) {
    var set = new Set();
    if (!value) return set;
    if (typeof value.forEach === 'function') {
      value.forEach(function (item) {
        if (typeof item === 'string' && item) set.add(item);
      });
      return set;
    }
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i += 1) {
        if (typeof value[i] === 'string' && value[i]) set.add(value[i]);
      }
    }
    return set;
  }

  function uniqueGames(entries) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < entries.length; i += 1) {
      var gameId = entries[i] && entries[i].gameId;
      if (typeof gameId !== 'string' || !gameId || seen[gameId]) continue;
      seen[gameId] = true;
      out.push(gameId);
    }
    out.sort();
    return out;
  }

  function failure(reason, extra) {
    var out = { ok: false, reason: reason };
    if (isObject(extra)) {
      Object.keys(extra).forEach(function (key) {
        if (key !== 'ok' && key !== 'reason') out[key] = extra[key];
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 收据 / 行 / 钱包的形状归一（不信任任意字段名）
   * ------------------------------------------------------------------ */

  /**
   * 收据视图：只认 receiptId/runId、careerId、commissionId、evidence[]、flags[]。
   * settle 结果（{ok,receipt}）与 claims 行（扁平收据）都走这里。
   */
  function receiptView(value) {
    if (!isObject(value)) return null;
    var source = value;
    if (isObject(source.receipt)) source = source.receipt;
    var evidence = null;
    var evidenceInvalid = false;
    if (hasOwn(source, 'evidence')) {
      if (Array.isArray(source.evidence)) evidence = source.evidence.slice(0, MAX_RECEIPT_ENTRIES);
      else evidenceInvalid = true;
    }
    var receiptId = null;
    if (isStableId(source.receiptId)) receiptId = source.receiptId;
    else if (isStableId(source.runId)) receiptId = source.runId;
    return {
      receiptId: receiptId,
      careerId: isStableId(source.careerId) ? source.careerId : null,
      commissionId: isStableId(source.commissionId) ? source.commissionId : null,
      evidence: evidence,
      evidenceInvalid: evidenceInvalid,
      flags: tokenArray(source.flags).filter(isFlagToken),
      source: source,
    };
  }

  /** quests 输入：数组 / {quests:[]} / {byNode:{}} / 以 nodeId 为键的对象，都归一成行数组。 */
  function questRowsOf(value) {
    var out = [];
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i += 1) if (isObject(value[i])) out.push(value[i]);
      return out;
    }
    if (!isObject(value)) return out;
    if (Array.isArray(value.quests)) return questRowsOf(value.quests);
    if (isObject(value.byNode)) {
      Object.keys(value.byNode).forEach(function (key) {
        if (isObject(value.byNode[key])) out.push(value.byNode[key]);
      });
      return out;
    }
    Object.keys(value).forEach(function (key) {
      var row = value[key];
      if (isObject(row) && (typeof row.nodeId === 'string' || typeof row.commissionId === 'string')) out.push(row);
    });
    return out;
  }

  /** claims 输入：数组 / {claims:[]} / settle 结果 {receipt} / 以 runId 为键的对象。 */
  function claimRowsOf(value) {
    var out = [];
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i += 1) if (isObject(value[i])) out.push(value[i]);
      return out;
    }
    if (!isObject(value)) return out;
    if (Array.isArray(value.claims)) return claimRowsOf(value.claims);
    if (isObject(value.receipt)) return [value];
    if (isObject(value.claim)) return [value.claim];
    Object.keys(value).forEach(function (key) {
      var row = value[key];
      if (isObject(row) && (hasOwn(row, 'evidence') || isObject(row.receipt) || typeof row.commissionId === 'string')) out.push(row);
    });
    return out;
  }

  function walletView(value) {
    var source = isObject(value) ? value : {};
    if (isObject(source.wallet)) source = source.wallet;
    var credits = toNonNegInt(source.credits, 0);
    if (credits > 1000000) credits = 1000000;
    var items = {};
    if (isObject(source.items)) {
      Object.keys(source.items).forEach(function (itemId) {
        if (!isNodeToken(itemId)) return;
        var count = toNonNegInt(source.items[itemId], 0);
        if (count > 0) items[itemId] = count > 999 ? 999 : count;
      });
    }
    return { credits: credits, items: items };
  }

  /* ------------------------------------------------------------------ *
   * 条件表达式：解析、求值、缺失归因
   * ------------------------------------------------------------------ */

  function normalizeClass(value) {
    if (typeof value !== 'string' || !value) return null;
    var upper = value.toUpperCase();
    if (EVIDENCE_PREFIXES.indexOf(upper) >= 0) return upper;
    var alias = CLASS_ALIASES[value.toLowerCase()];
    return alias || null;
  }

  function allowedKeys(object, keys) {
    var names = Object.keys(object);
    for (var i = 0; i < names.length; i += 1) {
      if (keys.indexOf(names[i]) < 0) return false;
    }
    return true;
  }

  function requirementNodeCount(req) {
    if (!req) return 0;
    if (req.all) {
      var total = 1;
      for (var i = 0; i < req.all.length; i += 1) total += requirementNodeCount(req.all[i]);
      return total;
    }
    if (req.any) {
      var sum = 1;
      for (var j = 0; j < req.any.length; j += 1) sum += requirementNodeCount(req.any[j]);
      return sum;
    }
    return 1;
  }

  /**
   * 解析 AND/OR 条件表达式（ADR §6 的纯 JSON 形状 + 证据类扩展）：
   * {all:[...]} | {any:[...]} | {class:'E'|'MAP'|'BP'|'DEC', atLeast, distinctGames?}
   * | {token:'E-…'} | {flag:'C2.…'} | {game:'memory-flip', atLeast}
   * 非法/超深/超宽返回 null（调用方保守失败，不猜）。
   */
  function parseRequirement(raw, depth) {
    if (depth > MAX_REQUIREMENT_DEPTH || !isObject(raw)) return null;
    if (requirementNodeCount(raw) > MAX_REQUIREMENT_NODES) return null;
    if (hasOwn(raw, 'all')) {
      if (!allowedKeys(raw, ['all'])) return null;
      if (!Array.isArray(raw.all) || raw.all.length < 1 || raw.all.length > 16) return null;
      var all = [];
      for (var i = 0; i < raw.all.length; i += 1) {
        var child = parseRequirement(raw.all[i], depth + 1);
        if (!child) return null;
        all.push(child);
      }
      return { all: all };
    }
    if (hasOwn(raw, 'any')) {
      if (!allowedKeys(raw, ['any'])) return null;
      if (!Array.isArray(raw.any) || raw.any.length < 1 || raw.any.length > 16) return null;
      var any = [];
      for (var j = 0; j < raw.any.length; j += 1) {
        var item = parseRequirement(raw.any[j], depth + 1);
        if (!item) return null;
        any.push(item);
      }
      return { any: any };
    }
    if (hasOwn(raw, 'class')) {
      if (!allowedKeys(raw, ['class', 'atLeast', 'distinctGames'])) return null;
      var cls = normalizeClass(raw.class);
      if (!cls) return null;
      var classAtLeast = toPositiveInt(raw.atLeast, 1);
      if (classAtLeast > MAX_TOKENS_PER_RECEIPT) return null;
      return { class: cls, atLeast: classAtLeast, distinctGames: raw.distinctGames === true };
    }
    if (hasOwn(raw, 'token')) {
      if (!allowedKeys(raw, ['token'])) return null;
      if (!isEvidenceToken(raw.token)) return null;
      return { token: raw.token };
    }
    if (hasOwn(raw, 'flag')) {
      if (!allowedKeys(raw, ['flag'])) return null;
      if (!isFlagToken(raw.flag)) return null;
      return { flag: raw.flag };
    }
    if (hasOwn(raw, 'game')) {
      if (!allowedKeys(raw, ['game', 'atLeast'])) return null;
      if (typeof raw.game !== 'string' || !GAME_ID_RE.test(raw.game)) return null;
      var gameAtLeast = toPositiveInt(raw.atLeast, 1);
      if (gameAtLeast > MAX_TOKENS_PER_RECEIPT) return null;
      return { game: raw.game, atLeast: gameAtLeast };
    }
    return null;
  }

  function parseRule(raw) {
    if (!isObject(raw) || !allowedKeys(raw, ['flag', 'chapter', 'label', 'require', 'requires'])) return null;
    if (!isStoryFlagToken(raw.flag)) return null;
    var requireRaw = hasOwn(raw, 'require') ? raw.require : raw.requires;
    var require = parseRequirement(requireRaw, 0);
    if (!require) return null;
    var chapter = typeof raw.chapter === 'string' && raw.chapter ? raw.chapter.slice(0, 16) : raw.flag.slice(0, 2);
    return {
      flag: raw.flag,
      chapter: chapter,
      label: typeof raw.label === 'string' ? raw.label.slice(0, 60) : '',
      require: require,
    };
  }

  /* ------------------------------------------------------------------ *
   * API 工厂
   * ------------------------------------------------------------------ */

  function createStoryEvidence(options) {
    var opts = isObject(options) ? options : {};

    var state = {
      configured: false,
      db: opts.db || null,
      nowSource: opts.now || null,
      tokenIndex: Object.create(null),
      tokenList: [],
      declarations: Object.create(null),
      duplicateTokens: Object.create(null),
      tokensByClass: Object.create(null),
      byGame: Object.create(null),
      commissions: [],
      commissionIndex: Object.create(null),
      materials: Object.create(null),
      knownFlags: Object.create(null),
      rewardFlagGates: Object.create(null),
      rules: [],
      ruleIndex: Object.create(null),
      flags: [],
      chapters: [],
      warnings: [],
      evidenceCount: 0,
      signature: '',
    };

    function resetContentState() {
      state.configured = false;
      state.tokenIndex = Object.create(null);
      state.tokenList = [];
      state.declarations = Object.create(null);
      state.duplicateTokens = Object.create(null);
      state.tokensByClass = Object.create(null);
      state.byGame = Object.create(null);
      state.commissions = [];
      state.commissionIndex = Object.create(null);
      state.materials = Object.create(null);
      state.knownFlags = Object.create(null);
      state.rewardFlagGates = Object.create(null);
      state.rules = [];
      state.ruleIndex = Object.create(null);
      state.flags = [];
      state.chapters = [];
      state.warnings = [];
      state.evidenceCount = 0;
      state.signature = '';
    }

    function pushWarning(message) {
      if (typeof message === 'string' && message && state.warnings.indexOf(message) < 0) {
        state.warnings.push(message);
      }
    }

    /* ---------------- 核心依赖（只用于 ID 校验；缺失时用本地形状） ---------------- */

    var cachedCore;
    function coreRef() {
      if (cachedCore !== undefined) return cachedCore;
      cachedCore = null;
      if (isNode && typeof require === 'function') {
        try {
          cachedCore = require('./career-core.js');
        } catch (err) {
          cachedCore = null;
        }
      }
      if (!cachedCore && root && root.ArcadeCareer && isObject(root.ArcadeCareer.core)) cachedCore = root.ArcadeCareer.core;
      return cachedCore;
    }

    function isValidCareerId(value) {
      var core = coreRef();
      if (core && isFunction(core.isValidCareerId)) {
        try {
          return core.isValidCareerId(value);
        } catch (err) {
          return false;
        }
      }
      return isStableId(value);
    }

    function isValidNodeToken(value) {
      var core = coreRef();
      if (core && isFunction(core.isToken)) {
        try {
          if (core.isToken(value)) return true;
        } catch (err) {
          /* 落到本地形状检查 */
        }
      }
      return isNodeToken(value);
    }

    function resolveNow(value) {
      var source = value !== undefined && value !== null ? value : state.nowSource;
      if (isFunction(source)) {
        try {
          var produced = source();
          if (typeof produced === 'string' && produced) return produced;
        } catch (err) {
          return 'now-error';
        }
      }
      if (typeof source === 'string' && source) return source;
      return new Date().toISOString();
    }

    /* ---------------- configure：内容 → 白名单 + 规则 ---------------- */

    function materialIndexFromItems(items) {
      var index = Object.create(null);
      if (!isObject(items)) return index;
      if (Array.isArray(items.materials)) {
        items.materials.forEach(function (material) {
          if (isObject(material) && typeof material.itemId === 'string' && material.itemId) index[material.itemId] = true;
        });
      }
      if (isObject(items.materialAliases)) {
        Object.keys(items.materialAliases).forEach(function (alias) {
          if (alias) index[alias] = true;
        });
      }
      return index;
    }

    function applyCommissions(rawCommissions) {
      var list = [];
      if (Array.isArray(rawCommissions)) list = rawCommissions.slice();
      else if (isObject(rawCommissions) && Array.isArray(rawCommissions.commissions)) list = rawCommissions.commissions.slice();
      if (!list.length) return false;
      list = list.filter(isObject);
      list.sort(function (a, b) {
        var left = typeof a.commissionId === 'string' ? a.commissionId : '';
        var right = typeof b.commissionId === 'string' ? b.commissionId : '';
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
      });

      list.forEach(function (raw) {
        var commissionId = raw.commissionId;
        if (!isStableId(commissionId)) {
          pushWarning('commission-id-invalid:' + String(commissionId));
          return;
        }
        if (typeof raw.gameId !== 'string' || !GAME_ID_RE.test(raw.gameId)) {
          pushWarning('commission-game-invalid:' + commissionId);
          return;
        }
        if (state.commissionIndex[commissionId]) {
          pushWarning('commission-duplicate:' + commissionId);
          return;
        }
        var gameId = raw.gameId;
        var professionId = typeof raw.professionId === 'string' && PROFESSION_ID_RE.test(raw.professionId) ? raw.professionId : '';
        var domain = professionId.indexOf('.') > 0 ? professionId.split('.')[0] : '';
        var tier = toPositiveInt(raw.tier, 1);
        var chapterGate = typeof raw.chapterGate === 'string' && raw.chapterGate ? raw.chapterGate : null;
        if (chapterGate && !isFlagToken(chapterGate)) {
          pushWarning('chapter-gate-invalid:' + commissionId);
          chapterGate = null;
        }
        var reward = isObject(raw.reward) ? raw.reward : {};
        var evidence = [];
        if (Array.isArray(reward.evidence)) {
          reward.evidence.forEach(function (token) {
            if (typeof token === 'string' && EVIDENCE_RE.test(token)) {
              evidence.push(token);
            } else {
              pushWarning('evidence-token-invalid:' + commissionId + ':' + String(token));
            }
          });
        } else if (reward.evidence !== undefined) {
          pushWarning('evidence-not-array:' + commissionId);
        }
        var flags = tokenArray(reward.flags).filter(isFlagToken);
        var itemIds = isObject(reward.items) ? Object.keys(reward.items) : [];

        var summary = {
          commissionId: commissionId,
          gameId: gameId,
          professionId: professionId,
          domain: domain,
          tier: tier,
          chapterGate: chapterGate,
          evidence: evidence.slice(),
          flags: flags.slice(),
          items: itemIds,
        };
        state.commissions.push(summary);
        state.commissionIndex[commissionId] = summary;

        flags.forEach(function (flag) {
          state.knownFlags[flag] = true;
          if (!state.rewardFlagGates[flag]) state.rewardFlagGates[flag] = [];
          state.rewardFlagGates[flag].push(chapterGate);
        });

        evidence.forEach(function (token) {
          var declarations = state.declarations[token];
          if (!declarations) declarations = state.declarations[token] = [];
          declarations.push(commissionId);
          if (declarations.length > 1) {
            state.duplicateTokens[token] = declarations.slice();
            pushWarning('evidence-declared-twice:' + token);
            return;
          }
          var prefix = token.slice(0, token.indexOf('-'));
          if (EVIDENCE_PREFIXES.indexOf(prefix) < 0) {
            pushWarning('evidence-prefix-invalid:' + token);
            return;
          }
          var entry = {
            token: token,
            prefix: prefix,
            className: prefix,
            commissionId: commissionId,
            gameId: gameId,
            tier: tier,
            professionId: professionId,
            domain: domain,
            chapterGate: chapterGate,
          };
          if (!state.tokensByClass[prefix]) state.tokensByClass[prefix] = [];
          state.tokensByClass[prefix].push(entry);
          state.tokenIndex[token] = entry;
          state.tokenList.push(token);
          if (!state.byGame[gameId]) state.byGame[gameId] = [];
          state.byGame[gameId].push(entry);
        });
      });

      state.tokenList.sort();
      EVIDENCE_PREFIXES.forEach(function (prefix) {
        var entries = state.tokensByClass[prefix] || [];
        entries.sort(function (a, b) {
          if (a.token < b.token) return -1;
          if (a.token > b.token) return 1;
          return 0;
        });
        state.tokensByClass[prefix] = entries;
      });
      Object.keys(state.byGame).forEach(function (gameId) {
        state.byGame[gameId].sort(function (a, b) {
          if (a.token < b.token) return -1;
          if (a.token > b.token) return 1;
          return 0;
        });
      });
      return state.commissions.length > 0;
    }

    function collectChapterRuleCandidates(chapter) {
      var out = [];
      if (!isObject(chapter)) return out;
      ['storyRules', 'evidenceRules', 'storyFlags', 'flags'].forEach(function (key) {
        if (!Array.isArray(chapter[key])) return;
        chapter[key].forEach(function (item) {
          if (isObject(item)) out.push(item);
        });
      });
      if (isObject(chapter.story) && Array.isArray(chapter.story.rules)) {
        chapter.story.rules.forEach(function (item) {
          if (isObject(item)) out.push(item);
        });
      }
      return out;
    }

    function applyChapterRules(chapterInput, rawRules) {
      var chapters = [];
      if (Array.isArray(chapterInput)) chapters = chapterInput.slice();
      else if (isObject(chapterInput)) chapters = [chapterInput];
      var candidates = [];
      chapters.forEach(function (chapter) {
        collectChapterRuleCandidates(chapter).forEach(function (rule) {
          candidates.push({ rule: rule, chapterId: isObject(chapter) && typeof chapter.chapterId === 'string' ? chapter.chapterId : '' });
        });
      });
      candidates.forEach(function (item) {
        var parsed = parseRule(item.rule);
        if (!parsed) {
          pushWarning('chapter-rule-invalid:' + (item.chapterId || '?'));
          return;
        }
        if (!item.rule.chapter && item.chapterId) parsed.chapter = item.chapterId;
        rawRules[parsed.flag] = parsed;
      });
    }

    function buildRules(chapterInput) {
      var rawRules = Object.create(null);
      for (var i = 0; i < DEFAULT_RULES_RAW.length; i += 1) {
        var parsed = parseRule(DEFAULT_RULES_RAW[i]);
        if (parsed) rawRules[parsed.flag] = parsed;
      }
      applyChapterRules(chapterInput, rawRules);
      var rules = [];
      Object.keys(rawRules).forEach(function (flag) {
        rules.push(rawRules[flag]);
      });
      rules.sort(function (a, b) {
        if (a.flag < b.flag) return -1;
        if (a.flag > b.flag) return 1;
        return 0;
      });
      if (rules.length > MAX_RULES) rules = rules.slice(0, MAX_RULES);
      state.rules = rules;
      state.ruleIndex = Object.create(null);
      state.flags = [];
      state.chapters = [];
      rules.forEach(function (rule) {
        state.ruleIndex[rule.flag] = rule;
        state.flags.push(rule.flag);
        if (rule.chapter && state.chapters.indexOf(rule.chapter) < 0) state.chapters.push(rule.chapter);
      });
      state.chapters.sort();
      return rules.length > 0;
    }

    function computeSignature() {
      var parts = [];
      state.tokenList.forEach(function (token) {
        var entry = state.tokenIndex[token];
        parts.push(token + '@' + entry.commissionId + '@' + entry.gameId + '@' + (entry.chapterGate || '-'));
      });
      state.rules.forEach(function (rule) {
        parts.push('rule:' + rule.flag + ':' + JSON.stringify(rule.require));
      });
      var text = parts.join('|');
      var hash = 2166136261;
      for (var i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = (hash * 16777619) >>> 0;
      }
      return text.length + ':' + hash.toString(16);
    }

    function configure(input) {
      try {
        var incoming = input;
        var commissionsInput = null;
        var chapterInput = null;
        var itemsInput = null;
        var previousDb = state.db;
        var previousNow = state.nowSource;
        var nextDb = previousDb;
        var nextNow = previousNow;
        if (Array.isArray(incoming)) {
          commissionsInput = incoming;
        } else if (isObject(incoming)) {
          if (incoming.commissions !== undefined) commissionsInput = incoming.commissions;
          else if (isObject(incoming.content) && incoming.content.commissions !== undefined) commissionsInput = incoming.content.commissions;
          if (incoming.chapter !== undefined) chapterInput = incoming.chapter;
          else if (incoming.chapters !== undefined) chapterInput = incoming.chapters;
          if (incoming.items !== undefined) itemsInput = incoming.items;
          else if (isObject(incoming.content) && incoming.content.items !== undefined) itemsInput = incoming.content.items;
          if (incoming.db !== undefined) nextDb = incoming.db || null;
          if (incoming.now !== undefined) nextNow = incoming.now || null;
        }

        resetContentState();
        state.db = nextDb;
        state.nowSource = nextNow;

        var errors = [];
        if (commissionsInput === null || commissionsInput === undefined) {
          errors.push(REASONS.noCommissions);
          pushWarning(REASONS.noCommissions);
          return {
            ok: false,
            evidenceCount: 0,
            flags: [],
            chapters: [],
            rules: 0,
            usable: false,
            errors: errors,
            warnings: state.warnings.slice(),
          };
        }
        state.materials = materialIndexFromItems(itemsInput);
        var hasCommissions = applyCommissions(commissionsInput);
        if (!hasCommissions) errors.push(REASONS.noCommissions);
        var hasRules = buildRules(chapterInput);
        if (!hasRules) errors.push(REASONS.noStoryRules);
        state.evidenceCount = state.tokenList.length;
        if (!state.evidenceCount) errors.push(REASONS.noEvidenceTokens);
        state.signature = computeSignature();
        state.configured = true;
        return {
          ok: errors.length === 0,
          evidenceCount: state.evidenceCount,
          flags: state.flags.slice(),
          chapters: state.chapters.slice(),
          rules: state.rules.length,
          usable: errors.length === 0,
          errors: errors,
          warnings: state.warnings.slice(),
        };
      } catch (err) {
        resetContentState();
        return {
          ok: false,
          evidenceCount: 0,
          flags: [],
          chapters: [],
          rules: 0,
          usable: false,
          errors: [REASONS.exception + ':' + errorText(err)],
          warnings: [],
        };
      }
    }

    function reset() {
      resetContentState();
      state.db = null;
      state.nowSource = null;
      return { ok: true };
    }

    function isConfigured() {
      return state.configured === true;
    }

    /* ---------------- token 白名单 / 收据解析 ---------------- */

    function tokenFromReceipt(receipt, options) {
      try {
        if (!state.configured) {
          return { ok: false, tokens: [], rejected: [{ reason: REASONS.notConfigured }], reason: REASONS.notConfigured };
        }
        var tokenOptions = isObject(options) ? options : {};
        var requireDeclared = tokenOptions.requireDeclared !== false;
        var view = receiptView(receipt);
        if (!view) {
          return failure(REASONS.badReceipt, { tokens: [], rejected: [{ reason: REASONS.badReceipt }] });
        }
        var tokens = [];
        var rejected = [];
        if (view.evidenceInvalid) rejected.push({ index: null, reason: REASONS.badEvidence });
        var list = view.evidence === null ? [] : view.evidence;
        for (var i = 0; i < list.length; i += 1) {
          var item = list[i];
          if (typeof item !== 'string') {
            rejected.push({ index: i, reason: 'not-a-string' });
            continue;
          }
          if (!isEvidenceToken(item)) {
            rejected.push({ index: i, token: item.slice(0, 120), reason: 'bad-shape' });
            continue;
          }
          if (requireDeclared && !state.tokenIndex[item]) {
            rejected.push({ index: i, token: item, reason: 'not-declared' });
            continue;
          }
          if (tokens.indexOf(item) >= 0) {
            rejected.push({ index: i, token: item, reason: 'duplicate' });
            continue;
          }
          if (tokens.length >= MAX_TOKENS_PER_RECEIPT) {
            rejected.push({ index: i, token: item, reason: 'over-cap' });
            continue;
          }
          tokens.push(item);
        }
        return { ok: rejected.length === 0, tokens: tokens, rejected: rejected };
      } catch (err) {
        return { ok: false, tokens: [], rejected: [{ reason: REASONS.exception }], reason: REASONS.exception, error: errorText(err) };
      }
    }

    /* ---------------- 条件求值（含证据门禁折叠） ---------------- */

    /**
     * 证据是否在当前阶段可用：无 chapterGate 直接可用；chapterGate 是本模块能推导的
     * 剧情旗标时，必须该旗标已解锁；外部章节（如 C5）门禁的证据在本模块阶段不可用。
     */
    function gateAllows(entry, flags) {
      if (!entry) return false;
      if (!entry.chapterGate) return true;
      if (state.ruleIndex[entry.chapterGate]) return flags.has(entry.chapterGate);
      return false;
    }

    function classMatches(className, evidenceSet, flags) {
      var entries = state.tokensByClass[className] || [];
      var out = [];
      for (var i = 0; i < entries.length; i += 1) {
        var entry = entries[i];
        if (evidenceSet.has(entry.token) && gateAllows(entry, flags)) out.push(entry);
      }
      return out;
    }

    function classCandidates(className, evidenceSet, flags, matched) {
      var entries = state.tokensByClass[className] || [];
      var have = Object.create(null);
      for (var i = 0; i < matched.length; i += 1) have[matched[i].token] = true;
      var matchedGames = Object.create(null);
      for (var j = 0; j < matched.length; j += 1) matchedGames[matched[j].gameId] = true;
      var fresh = [];
      var remaining = [];
      entries.forEach(function (entry) {
        if (have[entry.token]) return;
        if (!gateAllows(entry, flags)) return;
        if (evidenceSet.has(entry.token)) return;
        if (matchedGames[entry.gameId]) fresh.push(entry.token);
        else remaining.push(entry.token);
      });
      var out = fresh.concat(remaining);
      return out.slice(0, MAX_CANDIDATES);
    }

    function evalRequirement(req, evidenceSet, flags, path) {
      var here = typeof path === 'string' ? path : '';
      if (!req) return { ok: false, missing: [{ kind: 'invalid', path: here }] };
      if (req.all) {
        var missing = [];
        var ok = true;
        for (var i = 0; i < req.all.length; i += 1) {
          var result = evalRequirement(req.all[i], evidenceSet, flags, here + '.all[' + i + ']');
          if (!result.ok) {
            ok = false;
            missing = missing.concat(result.missing);
          }
        }
        return { ok: ok, missing: missing };
      }
      if (req.any) {
        var best = null;
        for (var j = 0; j < req.any.length; j += 1) {
          var branch = evalRequirement(req.any[j], evidenceSet, flags, here + '.any[' + j + ']');
          if (branch.ok) return { ok: true, missing: [] };
          if (!best || branch.missing.length < best.length) best = branch.missing;
        }
        return { ok: false, missing: best || [] };
      }
      if (req.class) {
        var matched = classMatches(req.class, evidenceSet, flags);
        var have = req.distinctGames ? uniqueGames(matched).length : matched.length;
        if (have >= req.atLeast) return { ok: true, missing: [] };
        return {
          ok: false,
          missing: [
            {
              kind: 'class',
              path: here,
              class: req.class,
              atLeast: req.atLeast,
              have: have,
              need: req.atLeast - have,
              distinctGames: !!req.distinctGames,
              games: uniqueGames(matched),
              candidates: classCandidates(req.class, evidenceSet, flags, matched),
            },
          ],
        };
      }
      if (req.token) {
        var entry = state.tokenIndex[req.token];
        if (entry && evidenceSet.has(req.token) && gateAllows(entry, flags)) return { ok: true, missing: [] };
        return {
          ok: false,
          missing: [
            {
              kind: 'token',
              path: here,
              token: req.token,
              atLeast: 1,
              have: 0,
              need: 1,
              candidates: entry && gateAllows(entry, flags) ? [req.token] : [],
            },
          ],
        };
      }
      if (req.game) {
        var gameEntries = (state.byGame[req.game] || []).filter(function (item) {
          return evidenceSet.has(item.token) && gateAllows(item, flags);
        });
        if (gameEntries.length >= req.atLeast) return { ok: true, missing: [] };
        return {
          ok: false,
          missing: [
            {
              kind: 'game',
              path: here,
              game: req.game,
              atLeast: req.atLeast,
              have: gameEntries.length,
              need: req.atLeast - gameEntries.length,
              candidates: (state.byGame[req.game] || [])
                .filter(function (item) {
                  return gateAllows(item, flags) && !evidenceSet.has(item.token);
                })
                .map(function (item) {
                  return item.token;
                })
                .slice(0, MAX_CANDIDATES),
            },
          ],
        };
      }
      if (req.flag) {
        if (flags.has(req.flag)) return { ok: true, missing: [] };
        return {
          ok: false,
          missing: [
            {
              kind: 'flag',
              path: here,
              flag: req.flag,
              atLeast: 1,
              have: 0,
              need: 1,
              candidates: [],
            },
          ],
        };
      }
      return { ok: false, missing: [{ kind: 'invalid', path: here }] };
    }

    /**
     * 从证据集合推导剧情旗标（不动 db）：按规则顺序做定点，门禁证据随旗标解锁逐轮生效。
     * 只把非本模块规则的旗标（如 C1 奖励旗标）作为种子；C2–C4 必须由证据组合重新推导，
     * 即使存储里被塞入同名行也不会被当成授予依据（“只由证据组合授予”）。这是只读函数；
     * 授予/持久化由 recordFromReceipt 负责。
     */
    function deriveFlagSet(evidenceSet, seedFlags) {
      var flags = new Set();
      if (seedFlags && typeof seedFlags.forEach === 'function') {
        seedFlags.forEach(function (flag) {
          if (isFlagToken(flag) && !state.ruleIndex[flag]) flags.add(flag);
        });
      }
      var guard = 0;
      var changed = true;
      var limit = state.rules.length + 2;
      while (changed && guard <= limit) {
        changed = false;
        guard += 1;
        for (var i = 0; i < state.rules.length; i += 1) {
          var rule = state.rules[i];
          if (flags.has(rule.flag)) continue;
          var result = evalRequirement(rule.require, evidenceSet, flags, rule.flag);
          if (result.ok) {
            flags.add(rule.flag);
            changed = true;
          }
        }
      }
      return flags;
    }

    function orderedStoryFlags(flagSet) {
      var out = [];
      for (var i = 0; i < state.flags.length; i += 1) {
        if (flagSet.has(state.flags[i])) out.push(state.flags[i]);
      }
      return out;
    }

    function missingSuggestions(missing) {
      var suggestions = [];
      var seen = Object.create(null);
      (missing || []).forEach(function (item) {
        var candidates = item && Array.isArray(item.candidates) ? item.candidates : [];
        candidates.forEach(function (token) {
          if (typeof token !== 'string' || seen[token]) return;
          seen[token] = true;
          suggestions.push(token);
        });
      });
      suggestions.sort();
      return suggestions.slice(0, MAX_SUGGESTIONS);
    }

    function normalizeEvalContext(input) {
      var direct = isObject(input) && (input.evidence instanceof Set || Array.isArray(input.evidence)) && (input.flags instanceof Set || Array.isArray(input.flags));
      var isolated = direct && !hasOwn(input, 'quests') && !hasOwn(input, 'claims') && !hasOwn(input, 'wallet') && !hasOwn(input, 'profile');
      if (isolated) {
        var evidence = new Set();
        toSet(input.evidence).forEach(function (token) {
          if (isEvidenceToken(token)) evidence.add(token);
        });
        return { evidence: evidence, flags: toSet(input.flags) };
      }
      var ctx = contextFor(input);
      return { evidence: ctx.evidence, flags: ctx.flags };
    }

    /* ---------------- 只读上下文 ---------------- */

    /**
     * 把 quests/claims/wallet/profile 归一成 career-core.storyContextFrom 的输入，
     * 同时直接给出 registry.resolveStory 需要的谓词上下文：
     * {capabilities:Set, evidence:Set, flags:Set, items:Map, credits, cleared:Set}。
     * 返回值同时包含 profile/wallet/quests/claims，因此可以直接再喂给 storyContextFrom（往返稳定）。
     */
    function contextFor(input) {
      try {
        var options = isObject(input) ? input : {};
        var quests = questRowsOf(options.quests).map(function (row) {
          return clone(row) || {};
        });
        var claims = claimRowsOf(options.claims).map(function (row) {
          return clone(row) || {};
        });
        var wallet = walletView(options.wallet);
        var profileInput = isObject(options.profile) ? options.profile : {};
        var capabilities = new Set();
        var evidence = new Set();
        var storedFlags = new Set();
        var cleared = new Set();

        function addCapabilities(value) {
          toSet(value).forEach(function (id) {
            if (isNodeToken(id)) capabilities.add(id);
          });
        }
        function addEvidence(value) {
          toSet(value).forEach(function (token) {
            if (isEvidenceToken(token)) evidence.add(token);
          });
        }
        function addFlags(value) {
          toSet(value).forEach(function (flag) {
            if (isFlagToken(flag)) storedFlags.add(flag);
          });
        }

        addCapabilities(profileInput.capabilities);
        addEvidence(profileInput.evidence);
        addFlags(profileInput.flags);
        addCapabilities(options.capabilities);
        addEvidence(options.evidence);
        addFlags(options.flags);

        quests.forEach(function (row) {
          addEvidence(row.evidence);
          if (row.kind === 'evidence') {
            var rowToken = typeof row.token === 'string' ? row.token : '';
            if (isEvidenceToken(rowToken)) evidence.add(rowToken);
          }
          if (typeof row.nodeId === 'string' && row.nodeId.indexOf('evidence:') === 0) {
            var nodeToken = row.nodeId.slice('evidence:'.length);
            if (isEvidenceToken(nodeToken)) evidence.add(nodeToken);
          }
          addFlags(row.flags);
          if (typeof row.nodeId === 'string' && row.nodeId.indexOf('story:') === 0) {
            var nodeFlag = row.nodeId.slice('story:'.length);
            if (isFlagToken(nodeFlag)) storedFlags.add(nodeFlag);
          }
          addCapabilities(row.capabilities);
          if (row.status === 'cleared') {
            if (isNodeToken(row.nodeId)) cleared.add(row.nodeId);
            if (isNodeToken(row.commissionId)) cleared.add(row.commissionId);
          }
        });

        claims.forEach(function (row) {
          var receipt = isObject(row.receipt) ? row.receipt : row;
          addEvidence(receipt.evidence);
          addFlags(receipt.flags);
          if (isNodeToken(receipt.commissionId)) cleared.add(receipt.commissionId);
        });

        var derived = deriveFlagSet(evidence, storedFlags);
        var derivedFlags = orderedStoryFlags(derived).filter(function (flag) {
          return !storedFlags.has(flag);
        });
        var ctx = {
          ok: true,
          capabilities: capabilities,
          evidence: evidence,
          flags: derived,
          items: new Map(),
          credits: wallet.credits,
          cleared: cleared,
          profile: {
            capabilities: sortedSetValues(capabilities),
            evidence: sortedSetValues(evidence),
            flags: sortedSetValues(derived),
          },
          wallet: { credits: wallet.credits, items: wallet.items },
          quests: quests,
          claims: claims,
          storedFlags: sortedSetValues(storedFlags),
          derivedFlags: derivedFlags,
          resolvedFlags: orderedStoryFlags(derived),
          evidenceCount: evidence.size,
          readOnly: true,
        };
        Object.keys(wallet.items).forEach(function (itemId) {
          ctx.items.set(itemId, wallet.items[itemId]);
        });
        ctx.snapshot = {
          capabilities: sortedSetValues(capabilities),
          evidence: sortedSetValues(evidence),
          flags: sortedSetValues(derived),
          cleared: sortedSetValues(cleared),
          items: clone(wallet.items) || {},
          credits: wallet.credits,
          storedFlags: ctx.storedFlags.slice(),
          derivedFlags: derivedFlags.slice(),
          resolvedFlags: ctx.resolvedFlags.slice(),
        };
        return ctx;
      } catch (err) {
        return {
          ok: false,
          reason: REASONS.exception,
          error: errorText(err),
          capabilities: new Set(),
          evidence: new Set(),
          flags: new Set(),
          items: new Map(),
          credits: 0,
          cleared: new Set(),
          profile: { capabilities: [], evidence: [], flags: [] },
          wallet: { credits: 0, items: {} },
          quests: [],
          claims: [],
          storedFlags: [],
          derivedFlags: [],
          resolvedFlags: [],
          evidenceCount: 0,
        };
      }
    }

    function storyUnlocked(flag, ctxInput) {
      try {
        if (!state.configured || typeof flag !== 'string' || !state.ruleIndex[flag]) return false;
        var evalCtx = normalizeEvalContext(ctxInput);
        var flags = deriveFlagSet(evalCtx.evidence, evalCtx.flags);
        return flags.has(flag);
      } catch (err) {
        return false;
      }
    }

    function missingFor(flag, ctxInput) {
      try {
        if (!state.configured) {
          return { ok: false, flag: flag, known: false, unlocked: false, missing: [], suggestions: [], reason: REASONS.notConfigured };
        }
        var rule = state.ruleIndex[flag];
        if (!rule) {
          return {
            ok: true,
            flag: flag,
            known: false,
            unlocked: false,
            missing: [{ kind: 'flag', flag: flag, reason: REASONS.unknownFlag, candidates: [] }],
            suggestions: [],
          };
        }
        var evalCtx = normalizeEvalContext(ctxInput);
        var flags = deriveFlagSet(evalCtx.evidence, evalCtx.flags);
        if (flags.has(flag)) {
          return { ok: true, flag: flag, known: true, unlocked: true, missing: [], suggestions: [] };
        }
        var result = evalRequirement(rule.require, evalCtx.evidence, flags, flag);
        return {
          ok: true,
          flag: flag,
          known: true,
          unlocked: false,
          missing: result.missing,
          suggestions: missingSuggestions(result.missing),
        };
      } catch (err) {
        return { ok: false, flag: flag, known: !!state.ruleIndex[flag], unlocked: false, missing: [], suggestions: [], reason: REASONS.exception };
      }
    }

    function storyFlags(input) {
      try {
        if (input === undefined) {
          return {
            ok: true,
            configured: state.configured === true,
            flags: state.flags.slice(),
            chapters: state.chapters.slice(),
            evidenceCount: state.evidenceCount,
            rules: state.rules.length,
            readOnly: true,
          };
        }
        if (!state.configured) {
          return { ok: false, configured: false, flags: [], reason: REASONS.notConfigured, readOnly: true };
        }
        var ctx = contextFor(input);
        var unlocked = {};
        var missing = {};
        state.flags.forEach(function (flag) {
          var isOn = ctx.flags.has(flag);
          unlocked[flag] = isOn;
          missing[flag] = isOn ? [] : missingFor(flag, ctx).missing;
        });
        return {
          ok: true,
          configured: true,
          flags: state.flags.filter(function (flag) {
            return ctx.flags.has(flag);
          }),
          storedFlags: ctx.storedFlags.slice(),
          derivedFlags: ctx.derivedFlags.slice(),
          allFlags: sortedSetValues(ctx.flags),
          evidenceCount: ctx.evidence.size,
          tokens: sortedSetValues(ctx.evidence),
          unlocked: unlocked,
          missing: missing,
          chapters: state.chapters.slice(),
          readOnly: true,
        };
      } catch (err) {
        return { ok: false, configured: false, flags: [], reason: REASONS.exception, error: errorText(err), readOnly: true };
      }
    }

    function chapterGate(input, ctxInput) {
      try {
        if (!state.configured) return { ok: false, reason: REASONS.notConfigured, readOnly: true };
        var gate = null;
        var commissionId = null;
        var gameId = null;
        var tier = null;
        if (typeof input === 'string') {
          gate = input;
        } else if (typeof input === 'number' && Number.isFinite(input)) {
          tier = toPositiveInt(input, 0);
          var byTier = null;
          for (var i = 0; i < state.commissions.length; i += 1) {
            if (state.commissions[i].tier === tier) {
              byTier = state.commissions[i];
              break;
            }
          }
          if (byTier) {
            gate = byTier.chapterGate;
            commissionId = byTier.commissionId;
            gameId = byTier.gameId;
          } else {
            return { ok: false, reason: REASONS.unknownTier, readOnly: true, tier: tier };
          }
        } else if (isObject(input)) {
          commissionId = typeof input.commissionId === 'string' ? input.commissionId : null;
          if (commissionId && state.commissionIndex[commissionId]) {
            var summary = state.commissionIndex[commissionId];
            gate = summary.chapterGate;
            gameId = summary.gameId;
            tier = summary.tier;
          } else if (commissionId) {
            return { ok: false, reason: REASONS.missingCommission, readOnly: true, commissionId: commissionId };
          } else {
            if (typeof input.chapterGate === 'string') gate = input.chapterGate;
            else if (typeof input.gate === 'string') gate = input.gate;
            if (input.tier !== undefined) tier = toPositiveInt(input.tier, 0);
          }
        }
        if (gate === null) {
          return {
            ok: true,
            readOnly: true,
            commissionId: commissionId,
            gameId: gameId,
            tier: tier,
            gate: null,
            known: true,
            unlocked: true,
            missing: [],
            reason: REASONS.noChapterGate,
          };
        }
        if (!isFlagToken(gate)) {
          return { ok: false, reason: REASONS.badChapterGate, readOnly: true, gate: String(gate) };
        }
        var known = !!state.ruleIndex[gate];
        var result = {
          ok: true,
          readOnly: true,
          commissionId: commissionId,
          gameId: gameId,
          tier: tier,
          gate: gate,
          known: known,
          unlocked: false,
          missing: [],
          reason: null,
        };
        if (!known) {
          result.reason = REASONS.unknownChapterGate;
          result.missing = [{ kind: 'flag', flag: gate, reason: REASONS.unknownChapterGate, candidates: [] }];
          return result;
        }
        if (ctxInput === undefined) {
          result.reason = REASONS.noContext;
          result.missing = [{ kind: 'flag', flag: gate, reason: REASONS.noContext, candidates: [] }];
          return result;
        }
        var missing = missingFor(gate, ctxInput);
        result.unlocked = missing.unlocked === true;
        result.missing = missing.missing || [];
        result.reason = result.unlocked ? null : REASONS.gateNotMet;
        return result;
      } catch (err) {
        return { ok: false, reason: REASONS.exception, error: errorText(err), readOnly: true };
      }
    }

    /* ---------------- 记录收据（唯一写入路径） ---------------- */

    function duplicateResult(fields, reason) {
      var out = {
        ok: true,
        duplicate: true,
        reason: reason || REASONS.alreadyRecorded,
        written: 0,
        zeroWrite: true,
        economy: { credits: 0, items: {} },
      };
      if (isObject(fields)) {
        Object.keys(fields).forEach(function (key) {
          out[key] = fields[key];
        });
      }
      return out;
    }

    /**
     * 唯一写入路径：receipt → quests 证据行（+ 一次性收据标记行 + 必要时的旗标行）。
     * - claims 可用时以 claims 收据为权威，调用方 receipt 只能是其子集；
     * - 同一 receipt 已记录 → duplicate:true 且零写入；
     * - 不发钱/不发材料/不写 claims/ledger/balances；DB 失败结构化返回且不谎报成功。
     */
    async function recordFromReceipt(input) {
      try {
        var options = isObject(input) ? input : {};
        var careerId = options.careerId;
        if (!isValidCareerId(careerId)) return failure(REASONS.badCareerId);
        if (!state.configured) return failure(REASONS.notConfigured);
        var db = options.db || state.db || null;
        if (!db) return failure(REASONS.dbUnavailable);
        if (!isFunction(db.readQuestState) || !isFunction(db.putQuests)) return failure(REASONS.dbUnavailable);
        var rawReceipt = isObject(options.receipt) ? options.receipt : null;
        if (!rawReceipt) return failure(REASONS.badReceipt);
        var at = resolveNow(options.now);
        var warnings = [];
        var provided = receiptView(rawReceipt);
        if (!provided) return failure(REASONS.badReceipt);
        if (provided.careerId && provided.careerId !== careerId) return failure(REASONS.careerMismatch);

        var claimVerified = false;
        if (isFunction(db.getClaim)) {
          var claimResult;
          try {
            claimResult = await db.getClaim(provided.receiptId);
          } catch (err) {
            return failure(REASONS.dbReadFailed, { error: errorText(err) });
          }
          if (isObject(claimResult) && claimResult.ok === false) {
            return failure(REASONS.dbReadFailed, { detail: claimResult.reason || null });
          }
          if (!claimResult) return failure(REASONS.receiptNotClaimed, { receiptId: provided.receiptId || null });
          var claimView = receiptView(claimResult);
          if (!claimView) return failure(REASONS.dbReadFailed, { detail: 'claim-shape' });
          if (claimView.careerId && claimView.careerId !== careerId) return failure(REASONS.careerMismatch);
          if (provided.receiptId && claimView.receiptId && provided.receiptId !== claimView.receiptId) {
            return failure(REASONS.receiptMismatch, { field: 'receiptId' });
          }
          if (provided.commissionId && claimView.commissionId && provided.commissionId !== claimView.commissionId) {
            return failure(REASONS.receiptMismatch, { field: 'commissionId' });
          }
          var claimTokens = tokenFromReceipt(claimView);
          if (!claimTokens.ok) return failure(REASONS.badEvidence, { rejected: claimTokens.rejected, source: 'claim' });
          if (provided.evidence !== null || provided.evidenceInvalid) {
            var providedTokens = tokenFromReceipt(provided);
            if (!providedTokens.ok) return failure(REASONS.badEvidence, { rejected: providedTokens.rejected, source: 'receipt' });
            for (var pi = 0; pi < providedTokens.tokens.length; pi += 1) {
              if (claimTokens.tokens.indexOf(providedTokens.tokens[pi]) < 0) {
                return failure(REASONS.receiptMismatch, { token: providedTokens.tokens[pi], field: 'evidence' });
              }
            }
          }
          claimVerified = true;
          provided = claimView;
        } else {
          warnings.push('claim-not-verified');
        }

        var tokenResult = tokenFromReceipt(provided);
        if (!tokenResult.ok) return failure(REASONS.badEvidence, { rejected: tokenResult.rejected, source: 'receipt' });
        var tokens = tokenResult.tokens.slice();
        if (provided.commissionId) {
          for (var ti = 0; ti < tokens.length; ti += 1) {
            var entry = state.tokenIndex[tokens[ti]];
            if (entry && entry.commissionId !== provided.commissionId) {
              return failure(REASONS.receiptMismatch, { token: tokens[ti], expected: provided.commissionId });
            }
          }
        }

        var questRead;
        try {
          questRead = await db.readQuestState(careerId);
        } catch (err) {
          return failure(REASONS.dbReadFailed, { error: errorText(err) });
        }
        if (!questRead) return failure(REASONS.dbReadFailed, { detail: 'empty-read' });
        if (isObject(questRead) && questRead.ok === false) {
          return failure(REASONS.dbReadFailed, { detail: questRead.reason || null });
        }
        var quests = questRowsOf(questRead);

        var existingEvidenceRows = Object.create(null);
        var trustedEvidence = Object.create(null);
        var storedFlags = Object.create(null);
        var markerId = provided.receiptId && isValidNodeToken('receipt:' + provided.receiptId) ? 'receipt:' + provided.receiptId : null;
        if (!markerId) warnings.push('receipt-id-missing');
        var markerFound = false;
        quests.forEach(function (row) {
          if (!isObject(row)) return;
          var nodeId = typeof row.nodeId === 'string' ? row.nodeId : '';
          if (markerId && nodeId === markerId) markerFound = true;
          if (row.kind === 'evidence' || nodeId.indexOf('evidence:') === 0) {
            var rowToken = nodeId.indexOf('evidence:') === 0 ? nodeId.slice('evidence:'.length) : typeof row.token === 'string' ? row.token : '';
            if (isEvidenceToken(rowToken) && state.tokenIndex[rowToken]) existingEvidenceRows[rowToken] = true;
          }
          tokenArray(row.evidence).forEach(function (token) {
            if (isEvidenceToken(token) && state.tokenIndex[token]) trustedEvidence[token] = true;
          });
          tokenArray(row.flags).forEach(function (flag) {
            if (isFlagToken(flag)) storedFlags[flag] = true;
          });
          if (nodeId.indexOf('story:') === 0) {
            var nodeFlag = nodeId.slice('story:'.length);
            if (isFlagToken(nodeFlag)) storedFlags[nodeFlag] = true;
          }
        });

        if (markerFound) {
          var existingEvidenceCount = Object.keys(trustedEvidence).length;
          return duplicateResult(
            {
              careerId: careerId,
              receiptId: provided.receiptId || null,
              commissionId: provided.commissionId || null,
              tokens: tokens.slice(),
              newTokens: [],
              newFlags: [],
              evidenceCount: existingEvidenceCount,
              flags: orderedStoryFlags(deriveFlagSet(new Set(Object.keys(trustedEvidence)), new Set(Object.keys(storedFlags)))),
              claimVerified: claimVerified,
              warnings: warnings.slice(),
            },
            REASONS.alreadyRecorded
          );
        }

        tokens.forEach(function (token) {
          trustedEvidence[token] = true;
        });
        var evidenceSet = new Set(Object.keys(trustedEvidence));
        var storedFlagSet = new Set(Object.keys(storedFlags));
        var derived = deriveFlagSet(evidenceSet, storedFlagSet);
        var storyFlagList = orderedStoryFlags(derived);
        var newFlags = storyFlagList.filter(function (flag) {
          return !storedFlagSet.has(flag);
        });
        var newEvidenceTokens = tokens.filter(function (token) {
          return !existingEvidenceRows[token];
        });
        newEvidenceTokens.sort();

        var rows = [];
        if (markerId) {
          rows.push({
            careerId: careerId,
            nodeId: markerId,
            kind: 'receipt',
            status: 'cleared',
            receiptId: provided.receiptId || null,
            commissionId: provided.commissionId || null,
            tokens: tokens.slice(),
            clearedAt: at,
            updatedAt: at,
            schemaVersion: SCHEMA_VERSION,
          });
        }
        newEvidenceTokens.forEach(function (token, index) {
          rows.push({
            careerId: careerId,
            nodeId: 'evidence:' + token,
            kind: 'evidence',
            status: 'cleared',
            token: token,
            evidence: [token],
            flags: index === 0 ? newFlags.slice() : [],
            sourceReceipt: provided.receiptId || null,
            clearedAt: at,
            updatedAt: at,
            schemaVersion: SCHEMA_VERSION,
          });
        });
        if (newFlags.length && newEvidenceTokens.length === 0) {
          newFlags.slice(0, MAX_ORDER_ROWS).forEach(function (flag) {
            rows.push({
              careerId: careerId,
              nodeId: 'story:' + flag,
              kind: 'story-flag',
              status: 'cleared',
              flags: [flag],
              evidence: sortedSetValues(evidenceSet).slice(0, MAX_TOKENS_PER_RECEIPT),
              sourceReceipt: provided.receiptId || null,
              clearedAt: at,
              updatedAt: at,
              schemaVersion: SCHEMA_VERSION,
            });
          });
        }

        if (!rows.length) {
          return duplicateResult(
            {
              careerId: careerId,
              receiptId: provided.receiptId || null,
              commissionId: provided.commissionId || null,
              tokens: tokens.slice(),
              newTokens: [],
              newFlags: [],
              evidenceCount: evidenceSet.size,
              flags: storyFlagList,
              claimVerified: claimVerified,
              warnings: warnings.slice(),
            },
            REASONS.alreadyRecorded
          );
        }

        var writeResult;
        try {
          writeResult = await db.putQuests(careerId, rows);
        } catch (err) {
          return failure(REASONS.dbWriteFailed, { error: errorText(err), wrote: 0, attempted: rows.length });
        }
        if (isObject(writeResult) && writeResult.ok === false) {
          return failure(REASONS.dbWriteFailed, {
            detail: writeResult.reason || null,
            wrote: 0,
            attempted: rows.length,
          });
        }

        return {
          ok: true,
          duplicate: false,
          careerId: careerId,
          receiptId: provided.receiptId || null,
          commissionId: provided.commissionId || null,
          tokens: tokens.slice(),
          newTokens: newEvidenceTokens,
          newFlags: newFlags,
          written: rows.length,
          evidenceCount: evidenceSet.size,
          flags: storyFlagList,
          claimVerified: claimVerified,
          economy: { credits: 0, items: {} },
          warnings: warnings.slice(),
        };
      } catch (err) {
        return failure(REASONS.exception, { error: errorText(err) });
      }
    }

    /* ---------------- 静态校验（validate） ---------------- */

    function collectFlagLeaves(req, out) {
      if (!req) return;
      if (req.flag) {
        out.push(req.flag);
        return;
      }
      if (req.all) {
        req.all.forEach(function (child) {
          collectFlagLeaves(child, out);
        });
        return;
      }
      if (req.any) {
        req.any.forEach(function (child) {
          collectFlagLeaves(child, out);
        });
      }
    }

    function collectClassLeaves(req, out) {
      if (!req) return;
      if (req.class) {
        out.push(req.class);
        return;
      }
      if (req.all) {
        req.all.forEach(function (child) {
          collectClassLeaves(child, out);
        });
        return;
      }
      if (req.any) {
        req.any.forEach(function (child) {
          collectClassLeaves(child, out);
        });
      }
    }

    function hasAlternative(req) {
      if (!req) return false;
      if (req.any) {
        if (req.any.length >= 2) return true;
        for (var i = 0; i < req.any.length; i += 1) if (hasAlternative(req.any[i])) return true;
        return false;
      }
      if (req.all) {
        for (var j = 0; j < req.all.length; j += 1) if (hasAlternative(req.all[j])) return true;
        return false;
      }
      return false;
    }

    function rewardFlagAvailable(flag, unlockedFlags) {
      var gates = state.rewardFlagGates[flag];
      if (!gates || !gates.length) return false;
      for (var i = 0; i < gates.length; i += 1) {
        var gate = gates[i];
        if (!gate) return true;
        if (state.ruleIndex[gate] && unlockedFlags.has(gate)) return true;
      }
      return false;
    }

    function reqSatisfiableAt(req, available, unlockedFlags, stack) {
      if (!req) return false;
      if (stack.length > MAX_REQUIREMENT_DEPTH) return false;
      if (req.all) {
        for (var i = 0; i < req.all.length; i += 1) {
          if (!reqSatisfiableAt(req.all[i], available, unlockedFlags, stack)) return false;
        }
        return true;
      }
      if (req.any) {
        for (var j = 0; j < req.any.length; j += 1) {
          if (reqSatisfiableAt(req.any[j], available, unlockedFlags, stack)) return true;
        }
        return false;
      }
      if (req.class) {
        var entries = state.tokensByClass[req.class] || [];
        var usable = [];
        for (var k = 0; k < entries.length; k += 1) {
          if (available[entries[k].token]) usable.push(entries[k]);
        }
        if (req.distinctGames) return uniqueGames(usable).length >= req.atLeast;
        return usable.length >= req.atLeast;
      }
      if (req.token) return !!available[req.token];
      if (req.game) {
        var gameEntries = (state.byGame[req.game] || []).filter(function (item) {
          return available[item.token];
        });
        return gameEntries.length >= req.atLeast;
      }
      if (req.flag) {
        if (unlockedFlags.has(req.flag)) return true;
        var rule = state.ruleIndex[req.flag];
        if (rule) {
          if (stack.indexOf(req.flag) >= 0) return false;
          return reqSatisfiableAt(rule.require, available, unlockedFlags, stack.concat([req.flag]));
        }
        return rewardFlagAvailable(req.flag, unlockedFlags);
      }
      return false;
    }

    function availableTokensAt(unlockedFlags) {
      var available = Object.create(null);
      state.tokenList.forEach(function (token) {
        var entry = state.tokenIndex[token];
        if (gateAllows(entry, unlockedFlags)) available[token] = true;
      });
      return available;
    }

    function witnessAt(req, available, unlockedFlags, stack) {
      var tokens = [];
      function pick(node) {
        if (!node || stack.length > MAX_REQUIREMENT_DEPTH) return false;
        if (node.all) {
          for (var i = 0; i < node.all.length; i += 1) if (!pick(node.all[i])) return false;
          return true;
        }
        if (node.any) {
          var length = tokens.length;
          for (var j = 0; j < node.any.length; j += 1) {
            if (pick(node.any[j])) return true;
            tokens.length = length;
          }
          return false;
        }
        if (node.class) {
          var entries = (state.tokensByClass[node.class] || []).filter(function (entry) {
            return available[entry.token] && tokens.indexOf(entry.token) < 0;
          });
          var picked = 0;
          if (node.distinctGames) {
            var usedGames = Object.create(null);
            for (var k = 0; k < tokens.length; k += 1) {
              var existing = state.tokenIndex[tokens[k]];
              if (existing) usedGames[existing.gameId] = true;
            }
            for (var m = 0; m < entries.length && picked < node.atLeast; m += 1) {
              if (usedGames[entries[m].gameId]) continue;
              usedGames[entries[m].gameId] = true;
              tokens.push(entries[m].token);
              picked += 1;
            }
          } else {
            for (var n = 0; n < entries.length && picked < node.atLeast; n += 1) {
              tokens.push(entries[n].token);
              picked += 1;
            }
          }
          return picked >= node.atLeast;
        }
        if (node.token) {
          if (!available[node.token]) return false;
          if (tokens.indexOf(node.token) < 0) tokens.push(node.token);
          return true;
        }
        if (node.game) {
          var gameEntries = (state.byGame[node.game] || []).filter(function (entry) {
            return available[entry.token] && tokens.indexOf(entry.token) < 0;
          });
          var count = 0;
          for (var q = 0; q < gameEntries.length && count < node.atLeast; q += 1) {
            tokens.push(gameEntries[q].token);
            count += 1;
          }
          return count >= node.atLeast;
        }
        if (node.flag) {
          if (unlockedFlags.has(node.flag)) return true;
          var rule = state.ruleIndex[node.flag];
          if (!rule) return rewardFlagAvailable(node.flag, unlockedFlags);
          if (stack.indexOf(node.flag) >= 0) return false;
          return pick(rule.require) && reqSatisfiableAt(rule.require, available, unlockedFlags, stack);
        }
        return false;
      }
      return pick(req) ? tokens.slice() : [];
    }

    /** factory 源码（含全部内部函数）：静态边界检查用，仅同上文 FORBIDDEN_SOURCE 比对。 */
    var cachedSource = null;
    function moduleSource() {
      if (cachedSource === null) {
        try {
          cachedSource = String(storyEvidenceFactory);
        } catch (err) {
          cachedSource = '';
        }
      }
      return cachedSource;
    }

    function validate() {
      var errors = [];
      var warnings = [];
      var checks = [];
      function check(id, ok, detail) {
        var text = detail === undefined || detail === null ? '' : String(detail);
        checks.push({ id: id, ok: !!ok, detail: text });
        if (!ok) errors.push(text ? id + ': ' + text : id);
      }
      if (!state.configured) {
        checks.push({ id: 'configured', ok: false, detail: REASONS.notConfigured });
        return {
          ok: false,
          configured: false,
          evidenceCount: 0,
          flags: [],
          chapters: [],
          errors: [REASONS.notConfigured],
          warnings: [],
          checks: checks,
          checksTotal: 1,
          checksPassed: 0,
          gates: {},
          witnesses: {},
        };
      }

      /* 1. 已配置且可用 */
      check('configured', state.evidenceCount > 0 && state.rules.length > 0, 'evidence=' + state.evidenceCount + ', rules=' + state.rules.length);

      /* 2. token 结构 */
      var badShape = state.tokenList.filter(function (token) {
        return !isEvidenceToken(token);
      });
      check('evidence-token-shape', badShape.length === 0, badShape.slice(0, MAX_RULE_CSV).join(','));

      /* 3. token 唯一（同一 token 不得由两条委托声明） */
      var duplicateTokens = Object.keys(state.duplicateTokens);
      check('evidence-unique', duplicateTokens.length === 0, duplicateTokens.slice(0, MAX_RULE_CSV).join(','));

      /* 4. token ↔ 委托归属（后缀恰是某委托 id 时必须由该委托声明） */
      var scopedMismatch = [];
      state.tokenList.forEach(function (token) {
        var dash = token.indexOf('-');
        var suffix = dash >= 0 ? token.slice(dash + 1) : '';
        var entry = state.tokenIndex[token];
        var declared = state.commissionIndex[suffix];
        if (declared && declared.commissionId !== entry.commissionId) scopedMismatch.push(token);
      });
      check('evidence-commission-scope', scopedMismatch.length === 0, scopedMismatch.slice(0, MAX_RULE_CSV).join(','));

      /* 5. 剧情旗标只能由证据组合授予：不得直写在 reward.flags */
      var handGranted = [];
      state.commissions.forEach(function (commission) {
        commission.flags.forEach(function (flag) {
          if (state.ruleIndex[flag]) handGranted.push(commission.commissionId + ':' + flag);
        });
      });
      check('flags-derived-only', handGranted.length === 0, handGranted.slice(0, MAX_RULE_CSV).join(','));

      /* 6. 剧情旗标不得混进 evidence token */
      var flagAsEvidence = [];
      state.tokenList.forEach(function (token) {
        if (state.ruleIndex[token]) flagAsEvidence.push(token);
      });
      check('flags-not-in-evidence', flagAsEvidence.length === 0, flagAsEvidence.join(','));

      /* 7. 证据不得是可交易材料 / 出现在 reward.items */
      var tradable = [];
      state.tokenList.forEach(function (token) {
        if (state.materials[token]) tradable.push(token + '(material)');
      });
      state.commissions.forEach(function (commission) {
        commission.items.forEach(function (itemId) {
          if (state.tokenIndex[itemId]) tradable.push(commission.commissionId + ':' + itemId);
        });
      });
      check('evidence-not-tradable', tradable.length === 0, tradable.slice(0, MAX_RULE_CSV).join(','));

      /* 8. 规则形状与唯一性 */
      var badRuleFlags = state.rules.filter(function (rule) {
        return !isStoryFlagToken(rule.flag);
      });
      check('rules-c2-c4', badRuleFlags.length === 0, badRuleFlags.length ? 'invalid flags' : '');
      var seenRuleFlags = Object.create(null);
      var duplicateRules = [];
      state.rules.forEach(function (rule) {
        if (seenRuleFlags[rule.flag]) duplicateRules.push(rule.flag);
        seenRuleFlags[rule.flag] = true;
      });
      check('rules-unique', duplicateRules.length === 0, duplicateRules.join(','));

      /* 9. 规则旗标引用可解析且无环 */
      var unknownFlagRefs = [];
      var seenUnknown = Object.create(null);
      state.rules.forEach(function (rule) {
        var leaves = [];
        collectFlagLeaves(rule.require, leaves);
        leaves.forEach(function (flag) {
          if (state.ruleIndex[flag]) return;
          if (state.knownFlags[flag]) return;
          if (seenUnknown[flag]) return;
          seenUnknown[flag] = true;
          unknownFlagRefs.push(rule.flag + '->' + flag);
        });
      });
      check('rules-flag-refs', unknownFlagRefs.length === 0, unknownFlagRefs.slice(0, MAX_RULE_CSV).join(','));
      var cycles = [];
      function detectsCycle(ruleFlag, stack) {
        if (stack.indexOf(ruleFlag) >= 0) return true;
        var rule = state.ruleIndex[ruleFlag];
        if (!rule) return false;
        var leaves = [];
        collectFlagLeaves(rule.require, leaves);
        for (var ci = 0; ci < leaves.length; ci += 1) {
          if (!state.ruleIndex[leaves[ci]]) continue;
          if (detectsCycle(leaves[ci], stack.concat([ruleFlag]))) return true;
        }
        return false;
      }
      state.rules.forEach(function (rule) {
        if (detectsCycle(rule.flag, [])) cycles.push(rule.flag);
      });
      check('rules-acyclic', cycles.length === 0, cycles.slice(0, MAX_RULE_CSV).join(','));

      /* 10. 每条规则至少一条替代路径（AND/OR 中 any 分支 ≥2） */
      var noAlternatives = [];
      state.rules.forEach(function (rule) {
        if (!hasAlternative(rule.require)) noAlternatives.push(rule.flag);
      });
      check('rules-alternatives', noAlternatives.length === 0, noAlternatives.join(','));

      /* 11. 分阶段可达性 + 逐游戏反例（单游戏不得成为唯一前置） */
      var unlocked = new Set();
      var unreachable = [];
      var singleGame = [];
      var witnesses = {};
      var gatesSeen = { 4: [], 5: [], 6: [] };
      var gateErrors = [];
      var gateWarnings = [];
      state.commissions.forEach(function (commission) {
        if (commission.tier < 4) return;
        if (!gatesSeen[commission.tier]) gatesSeen[commission.tier] = [];
        if (!commission.chapterGate) {
          gateErrors.push(commission.commissionId + ':missing');
          return;
        }
        if (!isFlagToken(commission.chapterGate)) {
          gateErrors.push(commission.commissionId + ':invalid');
          return;
        }
        if (gatesSeen[commission.tier].indexOf(commission.chapterGate) < 0) {
          gatesSeen[commission.tier].push(commission.chapterGate);
        }
        if (!state.ruleIndex[commission.chapterGate]) {
          gateWarnings.push('T' + commission.tier + '=' + commission.chapterGate);
        }
      });
      state.rules.forEach(function (rule) {
        var available = availableTokensAt(unlocked);
        if (!reqSatisfiableAt(rule.require, available, unlocked, [rule.flag])) {
          unreachable.push(rule.flag);
        } else {
          var picked = witnessAt(rule.require, available, unlocked, [rule.flag]);
          witnesses[rule.flag] = picked;
          var games = Object.keys(state.byGame).sort();
          games.forEach(function (gameId) {
            var without = Object.create(null);
            Object.keys(available).forEach(function (token) {
              if (available[token] && state.tokenIndex[token].gameId !== gameId) without[token] = true;
            });
            if (!reqSatisfiableAt(rule.require, without, unlocked, [rule.flag])) {
              singleGame.push(rule.flag + ' requires ' + gameId);
            }
          });
        }
        unlocked.add(rule.flag);
      });
      check('rules-reachable', unreachable.length === 0, unreachable.join(','));
      check('rules-no-single-game', singleGame.length === 0, singleGame.slice(0, MAX_RULE_CSV).join('; '));
      check('chapter-gates-declared', gateErrors.length === 0, gateErrors.slice(0, MAX_RULE_CSV).join(','));
      var mixedGates = [];
      Object.keys(gatesSeen).forEach(function (tier) {
        var unique = sortedUnique(gatesSeen[tier]);
        if (unique.length > 1) mixedGates.push('T' + tier + ':' + unique.join('|'));
      });
      check('chapter-gates-uniform', mixedGates.length === 0, mixedGates.join(','));
      gateWarnings = sortedUnique(gateWarnings);
      gateWarnings.forEach(function (item) {
        if (warnings.indexOf('gate-out-of-scope:' + item) < 0) warnings.push('gate-out-of-scope:' + item);
      });

      /* 12. C2–C4 规则不得依赖被更后章节门禁的证据（例如 DEC 只能来自 C5 门禁的 T6） */
      var gatedRules = [];
      state.rules.forEach(function (rule) {
        var classes = [];
        collectClassLeaves(rule.require, classes);
        if (classes.indexOf('DEC') < 0) return;
        var decEntries = state.tokensByClass.DEC || [];
        var derivable = decEntries.some(function (entry) {
          return !entry.chapterGate || !!state.ruleIndex[entry.chapterGate];
        });
        if (!derivable) gatedRules.push(rule.flag);
      });
      check('rules-no-gated-evidence', gatedRules.length === 0, gatedRules.join(','));

      /* 13. 确定性签名 */
      var signature = computeSignature();
      check('deterministic-content', signature === state.signature, signature === state.signature ? '' : 'signature-mismatch');

      /* 14. contextFor 形状可被 career-core.storyContextFrom / registry.resolveStory 消费 */
      var ctxCheck = true;
      var ctxDetail = '';
      try {
        var ctx = contextFor({ wallet: { credits: 80, items: { alloy: 1 } } });
        ctxCheck =
          ctx.ok === true &&
          ctx.capabilities instanceof Set &&
          ctx.evidence instanceof Set &&
          ctx.flags instanceof Set &&
          ctx.items instanceof Map &&
          ctx.cleared instanceof Set &&
          typeof ctx.credits === 'number' &&
          isObject(ctx.profile) &&
          isObject(ctx.wallet) &&
          Array.isArray(ctx.quests) &&
          Array.isArray(ctx.claims);
        if (!ctxCheck) ctxDetail = 'shape';
      } catch (err) {
        ctxCheck = false;
        ctxDetail = 'exception';
      }
      check('context-shape', ctxCheck, ctxDetail);

      /* 15. 静态边界：无 DOM/网络/浏览器存储/经济写入口 */
      var source = moduleSource();
      var hits = [];
      FORBIDDEN_SOURCE.forEach(function (pair) {
        if (source.indexOf(pair[0]) >= 0) hits.push(pair[1]);
      });
      check('static-boundaries', hits.length === 0, hits.join(','));
      var economySurface = Object.keys(api).filter(function (name) {
        return FORBIDDEN_API_RE.test(name);
      });
      check('no-economy-surface', economySurface.length === 0, economySurface.join(','));

      /* 16. 收据 token 守卫：伪造 token 必须被拒绝，声明过的 token 必须被接受 */
      var forgedReceipt = { receiptId: 'commission-forged-guard', evidence: ['E-D17-23-forged-token'] };
      var forged = tokenFromReceipt(forgedReceipt);
      var forgedRejected = forged.ok === false && forged.rejected.length === 1 && forged.rejected[0].reason === 'not-declared';
      var sampleToken = state.tokenList[0] || '';
      var sampleAccepted = false;
      if (sampleToken) {
        var sample = tokenFromReceipt({ receiptId: 'commission-sample-guard', evidence: [sampleToken] });
        sampleAccepted = sample.ok === true && sample.tokens.length === 1;
      }
      check('receipt-token-guard', forgedRejected && sampleAccepted, forgedRejected ? '' : 'forgery-accepted');

      /* 17. 必需 API 面 */
      var requiredApi = [
        'configure',
        'tokenFromReceipt',
        'recordFromReceipt',
        'contextFor',
        'storyFlags',
        'storyUnlocked',
        'missingFor',
        'chapterGate',
        'validate',
      ];
      var missingApi = requiredApi.filter(function (name) {
        return !isFunction(api[name]);
      });
      check('api-surface', missingApi.length === 0, missingApi.join(','));

      var mergedWarnings = sortedUnique(state.warnings.concat(warnings));
      var checksPassed = checks.filter(function (item) {
        return item.ok;
      }).length;
      return {
        ok: errors.length === 0,
        configured: true,
        evidenceCount: state.evidenceCount,
        flags: state.flags.slice(),
        chapters: state.chapters.slice(),
        errors: errors,
        warnings: mergedWarnings,
        checks: checks,
        checksTotal: checks.length,
        checksPassed: checksPassed,
        gates: gatesSeen,
        witnesses: witnesses,
      };
    }

    /* ---------------- 只读诊断 ---------------- */

    function evidenceWhitelist() {
      return state.tokenList.map(function (token) {
        var entry = state.tokenIndex[token];
        return {
          token: token,
          prefix: entry.prefix,
          class: entry.className,
          commissionId: entry.commissionId,
          gameId: entry.gameId,
          professionId: entry.professionId,
          domain: entry.domain,
          tier: entry.tier,
          chapterGate: entry.chapterGate,
        };
      });
    }

    function getDefaultRules() {
      return clone(DEFAULT_RULES_RAW) || [];
    }

    var api = {
      VERSION: VERSION,
      MODULE_VERSION: MODULE_VERSION,
      CONTENT_VERSION: CONTENT_VERSION,
      SCHEMA_VERSION: SCHEMA_VERSION,
      EVIDENCE_PREFIXES: EVIDENCE_PREFIXES,
      EVIDENCE_RE: EVIDENCE_RE,
      FLAG_RE: FLAG_RE,
      STORY_FLAG_RE: STORY_FLAG_RE,
      REASONS: REASONS,
      MAX_TOKENS_PER_RECEIPT: MAX_TOKENS_PER_RECEIPT,
      __storyEvidenceMounted: true,
      configure: configure,
      reset: reset,
      isConfigured: isConfigured,
      tokenFromReceipt: tokenFromReceipt,
      recordFromReceipt: recordFromReceipt,
      contextFor: contextFor,
      storyFlags: storyFlags,
      storyUnlocked: storyUnlocked,
      missingFor: missingFor,
      chapterGate: chapterGate,
      validate: validate,
      evidenceWhitelist: evidenceWhitelist,
      getDefaultRules: getDefaultRules,
    };

    return api;
  }

  /* ------------------------------------------------------------------ *
   * 默认单例（浏览器全局 ArcadeCareerStoryEvidence / Node module.exports）
   * ------------------------------------------------------------------ */

  var singleton = createStoryEvidence({});
  singleton.createStoryEvidence = createStoryEvidence;
  return singleton;
});
