/*!
 * StudioKit Arcade Life — 职业等级与订单选择（0.17，D17-22）
 *
 * 职责：把「已交差委托 / 已领取收据」折算成本季 16 职业各自的学徒/熟练/专家
 * 等级（职业数量来自内容，代码不写死 16），并给出该职业当前可选的内容
 * （订单/外观/路线标签）与展示文本。同一生涯可并行多职业、自由切换；等级只
 * 影响可选内容与展示，不自动通关、不写任何游戏内数值。
 *
 * 接口：configure({commissions, registry}) / progress({professionId, quests, claims}) /
 *      profile({quests, claims, wallet}) / orderOptions({professionId, quests, claims}) /
 *      validate({commissions, registry})；create() 生成隔离实例。
 *
 * 等级规则（冻结，见 tools/career_professions_test.mjs）：
 *   cleared 0–2 → level 1 apprentice 学徒
 *   cleared 3–5 → level 2 veteran  熟练
 *   cleared ≥6 → level 3 expert   专家
 * 各职业域共用同一阈值（不做域内微调）；将来若要按域调整，必须先改测试冻结值。
 *
 * 计数口径（只认真实已清内容）：
 * - quests：status === 'cleared' 且 kind 缺省或为 'commission' 的行，取
 *   commissionId / nodeId 中能解析到本职业已配置委托的稳定 ID（0.16 委托行
 *   写的是 nodeId = commissionId；story/alternative 行永远不计）；
 * - claims：claims 表行（commissionId 在行或 receipt 内）；claims 只在真实交差
 *   成功后写入，因此视为已清；
 * - 同一委托在 quests 与 claims、多次重复行中只计一次；未 cleared、未知 ID、
 *   别的职业、时间/分数/钱包/run stats 一律不参与等级。
 *
 * 边界（不得越界）：
 * - 纯 UMD：浏览器挂 window.ArcadeCareerProfessions，并镜像到
 *   window.ArcadeCareer.professions（bridge 的依赖装载约定）；Node 中
 *   module.exports 返回同一套 API（可在测试里直接 require）。
 * - 无 DOM / IndexedDB / 网络 / 宿主存储 / 时钟 / 随机数；不写库、不扣款、
 *   不发奖、不改经典或挑战玩法；所有内容由 configure 注入。
 * - 所有查询都是纯读：同一输入永远得到同一输出（顺序按 professionId /
 *   tier / commissionId 稳定排序）；不修改调用方传入的对象。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory(root, true);
    return;
  }
  var api = factory(root, false);
  root.ArcadeCareerProfessions = api;
  /* bridge 的统一依赖装载约定：模块镜像到 window.ArcadeCareer.<global>。
     hangar/town/route-planner 也可以直接用 window.ArcadeCareerProfessions。 */
  var career = root.ArcadeCareer;
  if (!career || typeof career !== 'object') career = root.ArcadeCareer = {};
  if (career.professions !== api) {
    try {
      career.professions = api;
    } catch (err) {
      /* 只读宿主：忽略 */
    }
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root, isNode) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 常量（等级规则与展示目录；数值只在这里定义一次）
   * ------------------------------------------------------------------ */

  var MODULE_VERSION = '0.17.0';
  var SCHEMA_VERSION = 1;

  /* 稳定 ID：URL / IndexedDB 双端安全，不含冒号。 */
  var ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
  /* 证据 token 允许冒号（与 career-core 的 TOKEN_RE 一致，但长度上限收紧）。 */
  var TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
  var TITLE_MAX = 120;

  /* 等级阈值冻结：clearedCount 达到下界即进入该等级。 */
  var THRESHOLDS = Object.freeze({
    apprentice: 0,
    veteran: 3,
    expert: 6,
  });

  var LEVELS = Object.freeze([
    Object.freeze({ level: 1, id: 'apprentice', name: '学徒' }),
    Object.freeze({ level: 2, id: 'veteran', name: '熟练' }),
    Object.freeze({ level: 3, id: 'expert', name: '专家' }),
  ]);

  /* 订单分流：T1–T2 学徒、T3–T4 熟练、T5–T6 专家（与内容 6 tier 对齐）。 */
  var TIER_GROUPS = Object.freeze([
    Object.freeze({ minTier: 1, maxTier: 2, level: 1 }),
    Object.freeze({ minTier: 3, maxTier: 4, level: 2 }),
    Object.freeze({ minTier: 5, maxTier: 6, level: 3 }),
  ]);

  /* 外观/路线标签只是展示目录：unlocked 由等级推导，不参与任何战斗/得分数值。 */
  var APPEARANCES = Object.freeze([
    Object.freeze({ appearanceId: 'harbor-badge', name: '旧港工牌', minLevel: 1 }),
    Object.freeze({ appearanceId: 'duty-pin', name: '值班铜徽', minLevel: 2 }),
    Object.freeze({ appearanceId: 'gold-stripe', name: '金线肩章', minLevel: 3 }),
  ]);

  var ROUTES = Object.freeze([
    Object.freeze({ routeId: 'steady-shift', label: '稳单路线', minLevel: 1, note: '从学徒工单开始' }),
    Object.freeze({ routeId: 'mixed-field', label: '混合路线', minLevel: 2, note: '熟练后同时接两类工单' }),
    Object.freeze({ routeId: 'specialist', label: '专精路线', minLevel: 3, note: '专家只挑高 tier 工单' }),
  ]);

  var REASONS = Object.freeze({
    contentMissing: 'content-missing',
    unknownProfession: 'unknown-profession',
    badProfessionId: 'bad-profession-id',
    badInput: 'bad-input',
  });

  /* ------------------------------------------------------------------ *
   * 基础工具（纯 JS；不抛异常给调用方）
   * ------------------------------------------------------------------ */

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isFunction(value) {
    return typeof value === 'function';
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function nonNegInt(value, fallback) {
    var num = Number(value);
    if (!Number.isFinite(num)) return typeof fallback === 'number' ? fallback : 0;
    var floored = Math.floor(num);
    return floored < 0 ? 0 : floored;
  }

  function trimText(value, max) {
    if (typeof value !== 'string') return '';
    var text = value.trim();
    if (max && text.length > max) text = text.slice(0, max);
    return text;
  }

  /** 职业域：'research.archivist' → 'research'；无点号时整段就是域。 */
  function domainOf(professionId) {
    var text = String(professionId || '');
    var dot = text.indexOf('.');
    if (dot > 0) return text.slice(0, dot);
    return text;
  }

  function failure(reason, extra) {
    var out = { ok: false, reason: reason };
    if (isObject(extra)) {
      Object.keys(extra).forEach(function (key) {
        out[key] = extra[key];
      });
    }
    return out;
  }

  function compareCommission(a, b) {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.commissionId === b.commissionId) return 0;
    return a.commissionId < b.commissionId ? -1 : 1;
  }

  function compareProfession(a, b) {
    if (a.professionId === b.professionId) return 0;
    return a.professionId < b.professionId ? -1 : 1;
  }

  function sortCommissions(list) {
    return list.slice().sort(compareCommission);
  }

  function sortProfessions(list) {
    return list.slice().sort(compareProfession);
  }

  /* ------------------------------------------------------------------ *
   * 等级推导（唯一实现；所有查询都走这里）
   * ------------------------------------------------------------------ */

  function levelForCount(count) {
    var n = nonNegInt(count, 0);
    if (n >= THRESHOLDS.expert) return LEVELS[2];
    if (n >= THRESHOLDS.veteran) return LEVELS[1];
    return LEVELS[0];
  }

  function nextThresholdForCount(count) {
    var n = nonNegInt(count, 0);
    if (n < THRESHOLDS.veteran) return THRESHOLDS.veteran;
    if (n < THRESHOLDS.expert) return THRESHOLDS.expert;
    return null;
  }

  function groupForTier(tier) {
    for (var i = 0; i < TIER_GROUPS.length; i += 1) {
      if (tier >= TIER_GROUPS[i].minTier && tier <= TIER_GROUPS[i].maxTier) return TIER_GROUPS[i];
    }
    return TIER_GROUPS[0];
  }

  /* ------------------------------------------------------------------ *
   * 输入规整（configure / validate 共用；不修改调用方对象）
   * ------------------------------------------------------------------ */

  /** 接受裸数组或内容包 { commissions: [...] }；无法识别时返回 null。 */
  function readCommissionInput(value) {
    if (Array.isArray(value)) return value;
    if (isObject(value) && Array.isArray(value.commissions)) return value.commissions;
    if (isObject(value) && isObject(value.content) && Array.isArray(value.content.commissions)) {
      return value.content.commissions;
    }
    return null;
  }

  /**
   * registry 可以是：
   * - 原始内容包 { professions: [...] }（content/registry.json）；
   * - 职业数组本身；
   * - registry.js 实例（有 listProfessions()）。
   * 缺省/null 视为「未提供」，由委托内容反推职业目录（bridge 的装载路径）；
   * 此时 displayName 回退为 professionId，集成方应补传 registry 才有中文名。
   */
  function readRegistryInput(value, errors) {
    if (value === undefined || value === null) return { provided: false, records: [] };
    var rawList = null;
    if (Array.isArray(value)) {
      rawList = value;
    } else if (isObject(value)) {
      if (isFunction(value.listProfessions)) {
        try {
          rawList = value.listProfessions();
        } catch (err) {
          rawList = null;
        }
      } else if (Array.isArray(value.professions)) {
        rawList = value.professions;
      }
    }
    if (!Array.isArray(rawList)) {
      errors.push('registry:professions-missing');
      return { provided: false, records: [] };
    }
    var records = [];
    var seen = Object.create(null);
    for (var i = 0; i < rawList.length; i += 1) {
      var raw = rawList[i];
      if (!isObject(raw)) {
        errors.push('registry:bad-profession[' + i + ']');
        continue;
      }
      var professionId = raw.professionId;
      if (typeof professionId !== 'string' || !ID_RE.test(professionId)) {
        errors.push('registry:bad-profession[' + i + ']');
        continue;
      }
      if (seen[professionId]) {
        errors.push('registry:duplicate-profession-' + professionId);
        continue;
      }
      seen[professionId] = true;
      var displayName = trimText(raw.displayName, 80);
      var domain = trimText(raw.domain, 40);
      records.push({
        professionId: professionId,
        displayName: displayName || professionId,
        domain: domain || domainOf(professionId),
      });
    }
    return { provided: true, records: sortProfessions(records) };
  }

  /**
   * 单条委托：commissionId / professionId / gameId 必须是稳定 ID，tier 必须是
   * 1..6 整数；title 展示用（缺省回退 commissionId）。任何一项非法返回 null。
   */
  function sanitizeCommission(raw, index, errors) {
    if (!isObject(raw)) {
      errors.push('commission[' + index + ']:not-object');
      return null;
    }
    var commissionId = raw.commissionId;
    if (typeof commissionId !== 'string' || !ID_RE.test(commissionId)) {
      errors.push('commission[' + index + ']:bad-commissionId');
      return null;
    }
    var professionId = raw.professionId;
    if (typeof professionId !== 'string' || !ID_RE.test(professionId)) {
      errors.push('commission ' + commissionId + ':bad-professionId');
      return null;
    }
    var gameId = raw.gameId;
    if (typeof gameId !== 'string' || !ID_RE.test(gameId)) {
      errors.push('commission ' + commissionId + ':bad-gameId');
      return null;
    }
    var tier = raw.tier;
    if (!isFiniteNumber(tier) || Math.floor(tier) !== tier || tier < 1 || tier > 6) {
      errors.push('commission ' + commissionId + ':bad-tier');
      return null;
    }
    var title = trimText(raw.title, TITLE_MAX);
    return {
      commissionId: commissionId,
      professionId: professionId,
      gameId: gameId,
      tier: tier,
      title: title || commissionId,
    };
  }

  /* ------------------------------------------------------------------ *
   * 读取 quests / claims（数组或 byKey 映射都接受；不修改输入）
   * ------------------------------------------------------------------ */

  function readRows(value) {
    if (Array.isArray(value)) return value;
    if (isObject(value)) {
      var out = [];
      var keys = Object.keys(value);
      for (var i = 0; i < keys.length; i += 1) out.push(value[keys[i]]);
      return out;
    }
    return [];
  }

  /** 本职业已配置委托的索引：commissionId -> record。 */
  function knownCommissionsOf(list) {
    var known = Object.create(null);
    for (var i = 0; i < list.length; i += 1) known[list[i].commissionId] = list[i];
    return known;
  }

  function rowMentionsKnown(row, known) {
    if (!isObject(row)) return false;
    if (typeof row.commissionId === 'string' && known[row.commissionId]) return true;
    if (typeof row.nodeId === 'string' && known[row.nodeId]) return true;
    if (isObject(row.receipt) && typeof row.receipt.commissionId === 'string' && known[row.receipt.commissionId]) return true;
    return false;
  }

  /**
   * 汇总本职业真实 cleared 委托：去重后的 commissionId 集合 + 最高 tier。
   * 规则见文件头；story/alternative 行、未 cleared 行、未知 ID 一律不计。
   */
  function collectCleared(list, quests, claims) {
    var known = knownCommissionsOf(list);
    var seen = Object.create(null);
    var count = 0;

    function add(commissionId) {
      if (typeof commissionId !== 'string' || !known[commissionId] || seen[commissionId]) return;
      seen[commissionId] = true;
      count += 1;
    }

    readRows(quests).forEach(function (row) {
      if (!isObject(row)) return;
      if (typeof row.kind === 'string' && row.kind && row.kind !== 'commission') return;
      if (row.status !== 'cleared') return;
      add(row.commissionId);
      add(row.nodeId);
    });

    readRows(claims).forEach(function (row) {
      if (!isObject(row)) return;
      add(row.commissionId);
      if (isObject(row.receipt)) add(row.receipt.commissionId);
    });

    var maxTier = 0;
    for (var i = 0; i < list.length; i += 1) {
      var record = list[i];
      if (seen[record.commissionId] && record.tier > maxTier) maxTier = record.tier;
    }
    return { ids: seen, clearedCount: count, maxTier: maxTier };
  }

  /**
   * 本职业证据 token 数（去重）：只统计属于本职业 cleared 委托的 quest/claim
   * evidence；仅用于 profile 展示，绝不参与等级。story/alternative 行不计。
   */
  function collectEvidence(list, quests, claims) {
    var known = knownCommissionsOf(list);
    var tokens = Object.create(null);
    var count = 0;

    function addTokens(source) {
      if (!Array.isArray(source)) return;
      for (var i = 0; i < source.length; i += 1) {
        var token = source[i];
        if (typeof token !== 'string' || !TOKEN_RE.test(token) || tokens[token]) continue;
        tokens[token] = true;
        count += 1;
      }
    }

    readRows(quests).forEach(function (row) {
      if (!isObject(row)) return;
      if (typeof row.kind === 'string' && row.kind && row.kind !== 'commission') return;
      if (row.status !== 'cleared') return;
      if (!rowMentionsKnown(row, known)) return;
      addTokens(row.evidence);
    });

    readRows(claims).forEach(function (row) {
      if (!isObject(row)) return;
      if (!rowMentionsKnown(row, known)) return;
      addTokens(row.evidence);
      if (isObject(row.receipt)) addTokens(row.receipt.evidence);
    });

    return { tokens: tokens, evidenceCount: count };
  }

  function walletCredits(wallet) {
    if (!isObject(wallet)) return 0;
    return nonNegInt(wallet.credits, 0);
  }

  /* ------------------------------------------------------------------ *
   * 实例工厂（默认单例之外，测试/集成可 create() 拿隔离实例）
   * ------------------------------------------------------------------ */

  function createProfessions() {
    function emptyState() {
      return {
        configured: false,
        commissions: [],
        byProfession: Object.create(null),
        professions: [],
      };
    }

    var state = emptyState();

    /**
     * 建立 professionId → 委托列表映射。
     * @param {{commissions:Array|object, registry?:object|Array}} input
     * @returns {{ok:boolean, professionCount:number, errors:string[]}}
     */
    function configure(input) {
      var options = isObject(input) ? input : {};
      var errors = [];
      var rawList = readCommissionInput(options.commissions);
      var registry = readRegistryInput(options.registry, errors);

      if (rawList === null) {
        errors.push('commissions-missing');
      } else if (rawList.length === 0) {
        errors.push('commissions-empty');
      }

      var accepted = [];
      var seen = Object.create(null);
      if (rawList !== null) {
        for (var i = 0; i < rawList.length; i += 1) {
          var record = sanitizeCommission(rawList[i], i, errors);
          if (!record) continue;
          if (seen[record.commissionId]) {
            errors.push('commission ' + record.commissionId + ':duplicate-commissionId');
            continue;
          }
          seen[record.commissionId] = true;
          accepted.push(record);
        }
      }

      /* registry 提供时，委托里出现未登记职业视为内容错误（仍然索引，fail-open）。 */
      var registryMap = Object.create(null);
      for (var r = 0; r < registry.records.length; r += 1) {
        registryMap[registry.records[r].professionId] = registry.records[r];
      }
      if (registry.provided) {
        for (var a = 0; a < accepted.length; a += 1) {
          if (!registryMap[accepted[a].professionId]) {
            errors.push('commission ' + accepted[a].commissionId + ':unknown-profession ' + accepted[a].professionId);
          }
        }
      }

      var byProfession = Object.create(null);
      for (var c = 0; c < accepted.length; c += 1) {
        var item = accepted[c];
        if (!byProfession[item.professionId]) byProfession[item.professionId] = [];
        byProfession[item.professionId].push(item);
      }
      Object.keys(byProfession).forEach(function (professionId) {
        byProfession[professionId] = Object.freeze(sortCommissions(byProfession[professionId]));
      });

      /* 职业目录 = registry 全量 ∪ 委托实际引用；不硬编码 16 / 96 / 五域。 */
      var catalog = Object.create(null);
      for (var p = 0; p < registry.records.length; p += 1) {
        var entry = registry.records[p];
        catalog[entry.professionId] = {
          professionId: entry.professionId,
          displayName: entry.displayName,
          domain: entry.domain,
        };
      }
      for (var d = 0; d < accepted.length; d += 1) {
        var professionId = accepted[d].professionId;
        if (!catalog[professionId]) {
          catalog[professionId] = {
            professionId: professionId,
            displayName: professionId,
            domain: domainOf(professionId),
          };
        }
      }
      var professions = [];
      Object.keys(catalog).sort().forEach(function (id) {
        professions.push(Object.freeze(catalog[id]));
      });

      state = {
        configured: accepted.length > 0,
        commissions: Object.freeze(accepted.slice()),
        byProfession: Object.freeze(byProfession),
        professions: Object.freeze(professions),
      };

      return {
        ok: errors.length === 0,
        professionCount: professions.length,
        errors: errors.slice(),
      };
    }

    /** 清空内容（等价于未 configure；不触碰任何宿主状态）。 */
    function reset() {
      state = emptyState();
      return { ok: true, professionCount: 0, errors: [] };
    }

    /**
     * 单职业进度：只按真实 cleared 委托/claims 计数。
     * @returns {{level:number, clearedCount:number, maxTier:number, nextThreshold:number|null}}
     */
    function progress(input) {
      var options = isObject(input) ? input : {};
      var professionId = typeof options.professionId === 'string' ? options.professionId : '';
      var list = professionId && hasOwn(state.byProfession, professionId) ? state.byProfession[professionId] : [];
      var collected = collectCleared(list, options.quests, options.claims);
      var level = levelForCount(collected.clearedCount);
      return {
        level: level.level,
        clearedCount: collected.clearedCount,
        maxTier: collected.maxTier,
        nextThreshold: nextThresholdForCount(collected.clearedCount),
      };
    }

    /**
     * 全职业档案：多职业并存，每个职业独立等级/进度；钱包只做只读展示上下文，
     * 不参与任何等级判断。
     */
    function profile(input) {
      var options = isObject(input) ? input : {};
      var quests = options.quests;
      var claims = options.claims;
      var professions = [];
      var totals = { apprentice: 0, veteran: 0, expert: 0, cleared: 0 };

      for (var i = 0; i < state.professions.length; i += 1) {
        var meta = state.professions[i];
        var list = hasOwn(state.byProfession, meta.professionId) ? state.byProfession[meta.professionId] : [];
        var collected = collectCleared(list, quests, claims);
        var evidence = collectEvidence(list, quests, claims);
        var level = levelForCount(collected.clearedCount);
        var nextThreshold = nextThresholdForCount(collected.clearedCount);
        professions.push({
          professionId: meta.professionId,
          displayName: meta.displayName,
          domain: meta.domain,
          level: level.level,
          levelId: level.id,
          levelName: level.name,
          clearedCount: collected.clearedCount,
          maxTier: collected.maxTier,
          nextThreshold: nextThreshold,
          missingToNext: nextThreshold === null ? 0 : nextThreshold - collected.clearedCount,
          commissionCount: list.length,
          evidenceCount: evidence.evidenceCount,
        });
        if (level.level === 1) totals.apprentice += 1;
        else if (level.level === 2) totals.veteran += 1;
        else totals.expert += 1;
        totals.cleared += collected.clearedCount;
      }

      var result = {
        ok: state.configured,
        professionCount: state.professions.length,
        professions: professions,
        totals: totals,
        wallet: { credits: walletCredits(options.wallet) },
      };
      if (!state.configured) result.reason = REASONS.contentMissing;
      return result;
    }

    /**
     * 该职业当前可选内容：订单分组（按 tier）、外观、路线标签与展示文本。
     * 等级只决定 unlocked / state 文本；返回值不含任何倍率、加成、奖励或
     * 自动通关字段（测试会冻结键集合）。
     */
    function orderOptions(input) {
      var options = isObject(input) ? input : {};
      var professionId = typeof options.professionId === 'string' ? options.professionId : '';
      if (!professionId || !ID_RE.test(professionId)) {
        return failure(REASONS.badProfessionId, { professionId: professionId || null });
      }
      if (!state.configured) return failure(REASONS.contentMissing, { professionId: professionId });

      var meta = null;
      for (var i = 0; i < state.professions.length; i += 1) {
        if (state.professions[i].professionId === professionId) {
          meta = state.professions[i];
          break;
        }
      }
      if (!meta) return failure(REASONS.unknownProfession, { professionId: professionId });

      var list = hasOwn(state.byProfession, professionId) ? state.byProfession[professionId] : [];
      var collected = collectCleared(list, options.quests, options.claims);
      var level = levelForCount(collected.clearedCount);
      var orders = [];

      for (var o = 0; o < list.length; o += 1) {
        var record = list[o];
        var group = groupForTier(record.tier);
        var orderState;
        if (collected.ids[record.commissionId]) orderState = 'cleared';
        else if (group.level <= level.level) orderState = 'available';
        else orderState = 'locked';
        orders.push({
          commissionId: record.commissionId,
          tier: record.tier,
          title: record.title,
          group: LEVELS[group.level - 1].id,
          state: orderState,
        });
      }

      var appearances = APPEARANCES.map(function (item) {
        return {
          appearanceId: item.appearanceId,
          name: item.name,
          minLevel: item.minLevel,
          unlocked: level.level >= item.minLevel,
        };
      });

      var routes = ROUTES.map(function (item) {
        return {
          routeId: item.routeId,
          label: item.label,
          minLevel: item.minLevel,
          unlocked: level.level >= item.minLevel,
          note: item.note,
        };
      });

      var nextThreshold = nextThresholdForCount(collected.clearedCount);
      var nextLevel = nextThreshold === null ? null : LEVELS[level.level];
      var display = {
        headline: meta.displayName + ' · ' + level.name,
        progressText: '已交差 ' + collected.clearedCount + '/' + list.length + ' 条委托',
        nextText: nextLevel === null
          ? '已达到专家等级'
          : '再完成 ' + (nextThreshold - collected.clearedCount) + ' 条升至' + nextLevel.name,
      };

      return {
        ok: true,
        professionId: meta.professionId,
        displayName: meta.displayName,
        domain: meta.domain,
        level: level.level,
        levelId: level.id,
        levelName: level.name,
        clearedCount: collected.clearedCount,
        nextThreshold: nextThreshold,
        orders: orders,
        appearances: appearances,
        routes: routes,
        display: display,
      };
    }

    /**
     * 内容校验（不修改内容、不改变当前配置）：
     * - 每职业恰好 6 条委托，tier 1..6 各一条；
     * - 职业可跨游戏、同一游戏可多职业、不硬编码 16 / 96；
     * - ID / tier / gameId / professionId 形状校验与重复检测。
     * @returns {{ok:boolean, errors:string[], warnings:string[], professionCount:number, commissionCount:number}}
     */
    function validate(input) {
      var options;
      if (input === undefined || input === null) options = {};
      else if (isObject(input)) options = input;
      else {
        return { ok: false, errors: [REASONS.badInput], warnings: [], professionCount: 0, commissionCount: 0 };
      }

      var errors = [];
      var warnings = [];
      var hasCommissions = hasOwn(options, 'commissions');
      var hasRegistry = hasOwn(options, 'registry');
      var rawList = hasCommissions ? readCommissionInput(options.commissions) : state.commissions.slice();
      var registry;

      if (hasRegistry) {
        registry = readRegistryInput(options.registry, errors);
      } else if (hasCommissions) {
        /* 显式传入内容时只校验该内容：绝不混入上一个 configure 的职业目录。 */
        registry = { provided: false, records: [] };
      } else {
        var current = [];
        for (var p = 0; p < state.professions.length; p += 1) {
          current.push({
            professionId: state.professions[p].professionId,
            displayName: state.professions[p].displayName,
            domain: state.professions[p].domain,
          });
        }
        registry = { provided: current.length > 0, records: sortProfessions(current) };
      }

      if (rawList === null) {
        errors.push('commissions-missing');
      } else if (rawList.length === 0) {
        errors.push('commissions-empty');
      }

      var registryMap = Object.create(null);
      for (var r = 0; r < registry.records.length; r += 1) {
        registryMap[registry.records[r].professionId] = registry.records[r];
      }
      if (!registry.provided) warnings.push('registry-missing');

      var accepted = [];
      var seen = Object.create(null);
      if (rawList !== null) {
        for (var i = 0; i < rawList.length; i += 1) {
          var record = sanitizeCommission(rawList[i], i, errors);
          if (!record) continue;
          if (seen[record.commissionId]) {
            errors.push('commission ' + record.commissionId + ':duplicate-commissionId');
            continue;
          }
          seen[record.commissionId] = true;
          if (registry.provided && !registryMap[record.professionId]) {
            errors.push('commission ' + record.commissionId + ':unknown-profession ' + record.professionId);
          }
          accepted.push(record);
        }
      }

      var byProfession = Object.create(null);
      for (var a = 0; a < accepted.length; a += 1) {
        var item = accepted[a];
        if (!byProfession[item.professionId]) byProfession[item.professionId] = [];
        byProfession[item.professionId].push(item);
      }
      if (registry.provided) {
        for (var k = 0; k < registry.records.length; k += 1) {
          var id = registry.records[k].professionId;
          if (!byProfession[id]) byProfession[id] = [];
        }
      }

      var professionIds = Object.keys(byProfession).sort();
      for (var m = 0; m < professionIds.length; m += 1) {
        var professionId = professionIds[m];
        var rows = byProfession[professionId];
        if (rows.length !== 6) {
          errors.push('profession ' + professionId + ':expected-6-found-' + rows.length);
        }
        var tiers = Object.create(null);
        for (var t = 0; t < rows.length; t += 1) {
          var tier = rows[t].tier;
          if (tiers[tier]) {
            errors.push('profession ' + professionId + ':duplicate-tier-' + tier);
          }
          tiers[tier] = true;
        }
        for (var need = 1; need <= 6; need += 1) {
          if (!tiers[need]) {
            errors.push('profession ' + professionId + ':missing-tier-' + need);
          }
        }
      }

      var professionCount = registry.provided ? registry.records.length : professionIds.length;
      return {
        ok: errors.length === 0,
        errors: errors,
        warnings: warnings,
        professionCount: professionCount,
        commissionCount: accepted.length,
      };
    }

    var api = {
      MODULE_VERSION: MODULE_VERSION,
      SCHEMA_VERSION: SCHEMA_VERSION,
      LEVELS: LEVELS,
      THRESHOLDS: THRESHOLDS,
      REASONS: REASONS,
      configure: configure,
      reset: reset,
      progress: progress,
      profile: profile,
      orderOptions: orderOptions,
      validate: validate,
    };
    return api;
  }

  /* ------------------------------------------------------------------ *
   * 默认实例（浏览器全局 / Node module.exports）
   * ------------------------------------------------------------------ */

  var api = createProfessions();
  api.create = createProfessions;
  return api;
});
