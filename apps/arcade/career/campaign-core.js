/*!
 * StudioKit Arcade Life — 六章故事图 / 三终局可达核心（0.18，D18-01）
 *
 * 职责（docs/arcade-life/ADR-interfaces.md §20.1 / §20.2）：
 * - 把 campaign.json（六章入口/路线/旗标、三终局、后日常）与 chapter-0X / npc /
 *   side-stories / commissions 内容装进一个纯函数实例，推导章节与终局状态；
 * - 只补齐 C0/C1（C0 由信箱打开证据、C1 由 C1 任一路线要求满足），C2–C4 只读
 *   story-evidence 落库的旗标行，C5 / ending.* 只读 ending-reducer 落库的旗标行；
 * - 所有内容问题结构化返回（errors/warnings），configure/validate 绝不抛。
 *
 * 硬约束（本模块不越界）：
 * - 纯 UMD：浏览器挂全局 ArcadeCareerCampaign 并镜像到 ArcadeCareer.campaign；
 *   Node 中 module.exports 返回同一 API；没有 DOM / IndexedDB / 网络 / 浏览器本地存储，
 *   不读全局时钟（时间只由调用方 now 注入），不写任何存储。
 * - 唯一写路径是 syncFlags 且只经调用方注入的 db（readQuestState / putQuests）；
 *   单事务、幂等、失败结构化返回，绝不谎报成功；除 C0/C1 外不写任何旗标。
 * - 视觉/入口归 ui/world-state.js；终局汇合归 ending-reducer.js；本模块只做状态推导。
 *
 * 状态模型（state()）：
 * - 章节状态 locked / available / active / complete：
 *   complete = 该章里程碑旗标已在库；locked = 入口要求未满足；
 *   active   = 当前正在推进的一章（入口满足、尚未完成、之前章节都已完成）；
 *   available= 入口满足但前面仍有未完成章节（只会在旗标乱序/跳章时出现）。
 *   C5 特殊：入口（C4）满足且终局内容可用时是 available（终局三选一开放），
 *   终局汇合旗标落库后为 complete；没有终局内容时即使 C4 完成也保持 locked。
 * - endings[i].available = 终局入口满足且尚未选定主线终局（同一生涯只能有一个主线通关）。
 *
 * 旗标来源（只读合并，顺序无关、确定性排序输出）：
 * - quests 行（含 story-evidence 的 story:<flag> / 证据行 flags、ending-reducer 的
 *   story:ending.<approach> 或 {kind:'ending', approach} 行）；
 * - claims 收据 flags / commissionId（已领奖的委托视为已通关）；
 * - profile.flags / profile.evidence；wallet 只用于上下文透传。
 */

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory(typeof globalThis !== 'undefined' ? globalThis : this, true);
    return;
  }
  var api = factory(root, false);
  root.ArcadeCareerCampaign = api;
  var career = root.ArcadeCareer;
  if (!career || typeof career !== 'object') career = root.ArcadeCareer = {};
  if (career.campaign !== api) {
    try {
      career.campaign = api;
    } catch (err) {
      /* 只读宿主：忽略镜像失败，窗口级名字仍可用。 */
    }
  }
})(typeof window !== 'undefined' ? window : globalThis, function campaignFactory(root, isNode) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 常量（与 content/campaign.json、ADR §20.1 冻结值对齐）
   * ------------------------------------------------------------------ */

  var VERSION = '0.18.0';
  var MODULE_VERSION = '0.18.0';
  var CONTENT_VERSION = '0.18.0';
  var SCHEMA_VERSION = 1;

  var CHAPTER_IDS = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'];
  var FINALE_CHAPTER = 'C5';
  var EPILOGUE_HANDOFF = 'EPILOGUE';
  var ENDING_APPROACHES = ['combat', 'research', 'rescue'];

  /** 每章里程碑旗标（ADR §20.1 冻结，不随内容漂移）。 */
  var CHAPTER_FLAGS = Object.freeze({
    C0: 'C0.port_seen',
    C1: 'C1.signal_fragment',
    C2: 'C2.research_complete',
    C3: 'C3.truth_found',
    C4: 'C4.city_power_restored',
    C5: 'C5.star_tower_resolved',
  });

  /** campaign-core 只允许补写这两面旗标；C2–C4 归 story-evidence，C5 归 ending-reducer。 */
  var SYNCABLE_FLAGS = Object.freeze([CHAPTER_FLAGS.C0, CHAPTER_FLAGS.C1]);

  /* 剧情旗标：C<0..5>.<小写稳定名>；结局旗标：ending.<approach>。 */
  var CHAPTER_FLAG_RE = /^C[0-5]\.[a-z0-9][a-z0-9._-]{0,60}$/;
  var ENDING_FLAG_RE = /^ending\.[a-z0-9][a-z0-9._-]{0,39}$/;
  var STABLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
  var TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
  var GAME_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

  /* 路线要求允许的键：六个声明式原子 + 两个嵌套组合器（AND / OR 组合）。 */
  var REQUIREMENT_LIST_KEYS = ['allFlags', 'anyFlags', 'anyCommissions', 'anyChaosFlags', 'evidenceAll', 'evidenceAny'];
  var REQUIREMENT_NODE_KEYS = ['all', 'any'];
  var REQUIREMENT_KEYS = REQUIREMENT_LIST_KEYS.concat(REQUIREMENT_NODE_KEYS);

  /* 每章最少可玩路线数：C0 是序章单路线，C5 由三终局承担（ADR §20.2「C5 为三终局」）。 */
  /**
   * 主线推荐的固定候选顺序（只引用真实委托与真实 storyEvidence 旗标）。
   * 只是候选顺序，不复制通关公式；候选是否能完成一律回到章节路线要求、
   * commission reward 与 storyEvidence 状态验算。
   */
  var RECOMMEND_ROUTES = Object.freeze([
    Object.freeze({ chapterId: 'C1', prefer: ['pendulum-tower.T1'], alternatives: ['star-raid.T1'] }),
    Object.freeze({ chapterId: 'C2', prefer: ['memory-flip.T1', 'memory-flip.T2', 'shadow-leap.T1'], alternatives: [] }),
    Object.freeze({ chapterId: 'C3', prefer: ['shadow-leap.T1', 'shadow-leap.T2', 'memory-flip.T1', 'memory-flip.T2'], alternatives: [] }),
    Object.freeze({ chapterId: 'C4', prefer: ['pendulum-tower.T2', 'gomoku.T1', 'gomoku.T2'], alternatives: [] }),
  ]);

  var MIN_ROUTES = Object.freeze({ C0: 1, C1: 2, C2: 2, C3: 2, C4: 2, C5: 3 });
  var MAX_REQUIREMENT_DEPTH = 4;
  var MAX_TOKENS_PER_LIST = 32;
  var MAX_CHAPTERS = 12;
  var MAX_ROUTES_PER_CHAPTER = 24;

  var REASONS = Object.freeze({
    notConfigured: 'not-configured',
    badInput: 'bad-input',
    badCareerId: 'bad-career-id',
    dbUnavailable: 'db-unavailable',
    dbReadFailed: 'db-read-failed',
    dbWriteFailed: 'db-write-failed',
    contentInvalid: 'content-invalid',
    unknownApproach: 'unknown-approach',
    exception: 'exception',
  });

  /* 静态边界检查用：运行时拼接，避免本文件自身出现连续敏感字符串。 */
  var FORBIDDEN_SOURCE = Object.freeze([
    Object.freeze(['docu' + 'ment.', 'DOM 访问']),
    Object.freeze(['win' + 'dow.', 'DOM 访问']),
    Object.freeze(['indexed' + 'DB.', '直连 IndexedDB']),
    Object.freeze(['fet' + 'ch(', '网络请求']),
    Object.freeze(['XMLHttp' + 'Request', '网络请求']),
    Object.freeze(['Web' + 'Socket', '网络请求']),
    Object.freeze(['send' + 'Beacon', '网络请求']),
    Object.freeze(['local' + 'Storage', '浏览器本地存储']),
    Object.freeze(['session' + 'Storage', '会话存储']),
    Object.freeze(['naviga' + 'tor.', '宿主环境探测']),
  ]);

  /* ------------------------------------------------------------------ *
   * 基础工具（纯函数）
   * ------------------------------------------------------------------ */

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function hasOwn(object, key) {
    return !!object && Object.prototype.hasOwnProperty.call(object, key);
  }

  function isArray(value) {
    return Array.isArray(value);
  }

  function isFunction(value) {
    return typeof value === 'function';
  }

  function trimText(value, max) {
    if (typeof value !== 'string') return '';
    var text = value.replace(/^\s+|\s+$/g, '');
    return max && text.length > max ? text.slice(0, max) : text;
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
    if (!err) return 'unknown';
    if (typeof err === 'string') return err;
    return err.message ? String(err.message) : String(err);
  }

  function tokenArray(value) {
    var list = [];
    if (isArray(value)) list = value.slice();
    else if (typeof value === 'string') list = [value];
    else if (typeof Set !== 'undefined' && value instanceof Set) list = Array.from(value);
    else if (value && typeof value.forEach === 'function' && !isObject(value)) list = Array.from(value);
    else if (isObject(value)) {
      Object.keys(value).forEach(function (key) {
        if (value[key]) list.push(key);
      });
    }
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < list.length; i += 1) {
      var token = typeof list[i] === 'string' ? trimText(list[i]) : '';
      if (!token || seen[token]) continue;
      seen[token] = true;
      out.push(token);
    }
    return out;
  }

  function sortedTokens(value) {
    var list = tokenArray(value);
    list.sort();
    return list;
  }

  function addTokens(set, value) {
    tokenArray(value).forEach(function (token) {
      set.add(token);
    });
  }

  function isFlagToken(value) {
    return typeof value === 'string' && (CHAPTER_FLAG_RE.test(value) || ENDING_FLAG_RE.test(value));
  }

  function isApproach(value) {
    return ENDING_APPROACHES.indexOf(value) >= 0;
  }

  /** 只有冻结的里程碑旗标算“章节旗标”；C1.work_done 这类委托奖励旗标只是普通剧情旗标。 */
  function milestoneIndexOf(flag) {
    if (typeof flag !== 'string') return -1;
    for (var i = 0; i < CHAPTER_IDS.length; i += 1) {
      if (CHAPTER_FLAGS[CHAPTER_IDS[i]] === flag) return i;
    }
    return -1;
  }

  function chapterFlagOf(chapterId) {
    return CHAPTER_FLAGS[chapterId] || null;
  }

  function isRequirementObject(value) {
    return isObject(value);
  }

  function errorItem(code, message, extra) {
    var item = { code: code, message: message };
    if (isObject(extra)) {
      Object.keys(extra).forEach(function (key) {
        if (key === 'code' || key === 'message') return;
        item[key] = extra[key];
      });
    }
    return item;
  }

  /* ------------------------------------------------------------------ *
   * 上下文：quests / claims / profile / wallet → 旗标、证据、已通关委托
   * （语义对齐 career-core.storyContextFrom；额外兼容 story-evidence / ending-reducer 行）
   * ------------------------------------------------------------------ */

  function questRowsOf(value) {
    var out = [];
    if (!value) return out;
    if (isArray(value)) {
      value.forEach(function (row) {
        if (isObject(row)) out.push(row);
      });
      return out;
    }
    if (!isObject(value)) return out;
    if (isArray(value.quests)) weirdPush(value.quests, out);
    if (isObject(value.byNode)) {
      Object.keys(value.byNode).forEach(function (nodeId) {
        if (isObject(value.byNode[nodeId])) out.push(value.byNode[nodeId]);
      });
    }
    return out;
  }

  function weirdPush(list, out) {
    list.forEach(function (row) {
      if (isObject(row)) out.push(row);
    });
  }

  function claimRowsOf(value) {
    var out = [];
    if (!value) return out;
    if (isArray(value)) {
      value.forEach(function (row) {
        if (isObject(row)) out.push(row);
      });
      return out;
    }
    if (!isObject(value)) return out;
    if (isArray(value.claims)) weirdPush(value.claims, out);
    if (isObject(value.byRun)) {
      Object.keys(value.byRun).forEach(function (runId) {
        if (isObject(value.byRun[runId])) out.push(value.byRun[runId]);
      });
    }
    return out;
  }

  function walletView(value) {
    var wallet = isObject(value) ? value : {};
    var items = {};
    var rawItems = isObject(wallet.items) ? wallet.items : {};
    Object.keys(rawItems).forEach(function (itemId) {
      var count = Number(rawItems[itemId]);
      if (Number.isFinite(count) && count > 0) items[itemId] = Math.floor(count);
    });
    var credits = Number(wallet.credits);
    return {
      credits: Number.isFinite(credits) && credits > 0 ? Math.floor(credits) : 0,
      items: items,
    };
  }

  /**
   * 把 {quests, claims, profile, wallet, flags, evidence, cleared} 归一成
   * {flags:Set, evidence:Set, cleared:Set, capabilities:Set, credits, wallet}。
   */
  function contextFrom(input) {
    var options = isObject(input) ? input : {};
    var ctx = {
      flags: new Set(),
      evidence: new Set(),
      cleared: new Set(),
      capabilities: new Set(),
      items: new Map(),
      credits: 0,
      wallet: { credits: 0, items: {} },
    };
    var profile = isObject(options.profile) ? options.profile : {};
    addTokens(ctx.flags, options.flags);
    addTokens(ctx.evidence, options.evidence);
    addTokens(ctx.cleared, options.cleared);
    addTokens(ctx.cleared, options.clearedCommissions);
    addTokens(ctx.cleared, options.commissions);
    addTokens(ctx.capabilities, options.capabilities);
    addTokens(ctx.flags, profile.flags);
    addTokens(ctx.evidence, profile.evidence);
    addTokens(ctx.capabilities, profile.capabilities);

    questRowsOf(options.quests).forEach(function (row) {
      addTokens(ctx.flags, row.flags);
      addTokens(ctx.evidence, row.evidence);
      addTokens(ctx.capabilities, row.capabilities);
      var nodeId = typeof row.nodeId === 'string' ? row.nodeId : '';
      if (nodeId.indexOf('story:') === 0) {
        var nodeFlag = nodeId.slice('story:'.length);
        if (isFlagToken(nodeFlag)) ctx.flags.add(nodeFlag);
      }
      if (nodeId.indexOf('ending:') === 0) {
        var nodeApproach = nodeId.slice('ending:'.length);
        if (isApproach(nodeApproach)) ctx.flags.add('ending.' + nodeApproach);
      }
      /* 兼容另一种写法：nodeId 本身就是旗标名（ending-reducer 的 marker 行同时带 flags，双保险）。 */
      if (isFlagToken(nodeId)) ctx.flags.add(nodeId);
      if (row.kind === 'ending' && isApproach(row.approach) && row.status === 'cleared') {
        ctx.flags.add('ending.' + row.approach);
      }
      if (row.status === 'cleared') {
        if (typeof row.nodeId === 'string' && STABLE_ID_RE.test(row.nodeId)) ctx.cleared.add(row.nodeId);
        if (typeof row.commissionId === 'string' && STABLE_ID_RE.test(row.commissionId)) ctx.cleared.add(row.commissionId);
      }
    });

    claimRowsOf(options.claims).forEach(function (claim) {
      var receipt = isObject(claim.receipt) ? claim.receipt : claim;
      addTokens(ctx.flags, receipt.flags);
      addTokens(ctx.evidence, receipt.evidence);
      if (typeof receipt.commissionId === 'string' && STABLE_ID_RE.test(receipt.commissionId)) {
        ctx.cleared.add(receipt.commissionId);
      }
      if (isApproach(receipt.approach)) ctx.flags.add('ending.' + receipt.approach);
    });

    var wallet = walletView(options.wallet || options.wallets || {});
    ctx.credits = wallet.credits;
    ctx.wallet = wallet;
    Object.keys(wallet.items).forEach(function (itemId) {
      ctx.items.set(itemId, wallet.items[itemId]);
    });
    return ctx;
  }

  /** 已有 storyContextFrom 风格 ctx 或纯 {flags,evidence,cleared} 输入 → 标准 ctx。 */
  function ensureContext(input) {
    if (!isObject(input)) return contextFrom({});
    var looksDerived = input.flags instanceof Set
      || input.evidence instanceof Set
      || input.cleared instanceof Set
      || (isObject(input.flags) && !isArray(input.flags))
      || hasOwn(input, 'quests')
      || hasOwn(input, 'claims')
      || hasOwn(input, 'profile')
      || hasOwn(input, 'wallet');
    if (looksDerived && !hasOwn(input, 'quests') && !hasOwn(input, 'claims') && !hasOwn(input, 'profile')) {
      return contextFrom({
        flags: setLikeToArray(input.flags),
        evidence: setLikeToArray(input.evidence),
        cleared: setLikeToArray(input.cleared || input.commissions),
        wallet: input.wallet,
      });
    }
    return contextFrom(input);
  }

  function resolveContext(input) {
    if (!isObject(input)) return contextFrom({});
    if (hasOwn(input, 'quests') || hasOwn(input, 'claims') || hasOwn(input, 'profile') || hasOwn(input, 'wallet')) {
      return contextFrom(input);
    }
    return ensureContext(input);
  }

  function setLikeToArray(value) {
    if (!value) return [];
    if (isArray(value)) return value.slice();
    if (value instanceof Set) return Array.from(value);
    if (typeof value === 'string') return [value];
    if (isObject(value)) return Object.keys(value).filter(function (key) {
      return value[key];
    });
    return [];
  }

  /* ------------------------------------------------------------------ *
   * 路线要求：归一化 / 求值 / 取叶子 / 单游戏无关可达性
   * ------------------------------------------------------------------ */

  /**
   * 归一化路线要求。非法键/形状只记录错误并丢弃该键，保留其余可判定部分。
   * @returns {object} 归一化后的要求对象（始终是普通对象）
   */
  function normalizeRequirement(raw, depth, errors, context) {
    if (!isRequirementObject(raw)) {
      if (raw !== undefined && raw !== null) {
        errors.push(errorItem('requirement-invalid', '路线要求必须是对象。', context));
      }
      return {};
    }
    if (depth > MAX_REQUIREMENT_DEPTH) {
      errors.push(errorItem('requirement-too-deep', '路线要求嵌套超过 ' + MAX_REQUIREMENT_DEPTH + ' 层。', context));
      return {};
    }
    var req = {};
    Object.keys(raw).forEach(function (key) {
      if (REQUIREMENT_LIST_KEYS.indexOf(key) < 0 && REQUIREMENT_NODE_KEYS.indexOf(key) < 0) {
        errors.push(errorItem('requirement-key-unknown', '未知路线要求键：' + key, Object.assign({ key: key }, context)));
        return;
      }
      var value = raw[key];
      if (REQUIREMENT_NODE_KEYS.indexOf(key) >= 0) {
        if (!isArray(value) || value.length === 0) {
          errors.push(errorItem('requirement-invalid', '组合器 ' + key + ' 必须是非空数组。', Object.assign({ key: key }, context)));
          return;
        }
        var children = [];
        for (var i = 0; i < value.length && i < MAX_TOKENS_PER_LIST; i += 1) {
          children.push(normalizeRequirement(value[i], depth + 1, errors, context));
        }
        req[key] = children;
        return;
      }
      var tokens = tokenArray(value);
      if (!isArray(value)) {
        errors.push(errorItem('requirement-invalid', key + ' 必须是数组。', Object.assign({ key: key }, context)));
        return;
      }
      if (tokens.length > MAX_TOKENS_PER_LIST) {
        errors.push(errorItem('requirement-invalid', key + ' 条目过多（上限 ' + MAX_TOKENS_PER_LIST + '）。', Object.assign({ key: key }, context)));
        tokens = tokens.slice(0, MAX_TOKENS_PER_LIST);
      }
      var clean = [];
      for (var t = 0; t < tokens.length; t += 1) {
        var token = tokens[t];
        var okShape = true;
        if (key === 'allFlags' || key === 'anyFlags' || key === 'anyChaosFlags') okShape = isFlagToken(token);
        else if (key === 'anyCommissions') okShape = STABLE_ID_RE.test(token);
        else okShape = TOKEN_RE.test(token);
        if (!okShape) {
          errors.push(errorItem('requirement-token-invalid', '路线要求 token 形状非法：' + token, Object.assign({ key: key, token: token }, context)));
          continue;
        }
        clean.push(token);
      }
      req[key] = clean;
    });
    return req;
  }

  function requirementTokenAll(tokens, set) {
    var list = tokenArray(tokens);
    if (!list.length) return true;
    for (var i = 0; i < list.length; i += 1) {
      if (!set.has(list[i])) return false;
    }
    return true;
  }

  function requirementTokenAny(tokens, set) {
    var list = tokenArray(tokens);
    if (!list.length) return false;
    for (var i = 0; i < list.length; i += 1) {
      if (set.has(list[i])) return true;
    }
    return false;
  }

  /**
   * 求值路线要求（AND across keys，OR within lists；支持嵌套 all/any）。
   * 空对象 = 无前置（true）；任何键判定失败即整体失败。
   */
  function evalRequirement(req, ctxInput) {
    if (!isRequirementObject(req)) return false;
    var ctx = ctxInput && ctxInput.flags instanceof Set ? ctxInput : ensureContext(ctxInput);
    var ok = true;
    if (hasOwn(req, 'allFlags')) ok = ok && requirementTokenAll(req.allFlags, ctx.flags);
    if (ok && hasOwn(req, 'anyFlags')) ok = ok && requirementTokenAny(req.anyFlags, ctx.flags);
    if (ok && hasOwn(req, 'anyCommissions')) ok = ok && requirementTokenAny(req.anyCommissions, ctx.cleared);
    if (ok && hasOwn(req, 'anyChaosFlags')) ok = ok && requirementTokenAny(req.anyChaosFlags, ctx.flags);
    if (ok && hasOwn(req, 'evidenceAll')) ok = ok && requirementTokenAll(req.evidenceAll, ctx.evidence);
    if (ok && hasOwn(req, 'evidenceAny')) ok = ok && requirementTokenAny(req.evidenceAny, ctx.evidence);
    if (ok && isArray(req.all)) {
      for (var i = 0; i < req.all.length; i += 1) {
        if (!evalRequirement(req.all[i], ctx)) {
          ok = false;
          break;
        }
      }
    }
    if (ok && isArray(req.any)) {
      var anyHit = false;
      for (var j = 0; j < req.any.length; j += 1) {
        if (evalRequirement(req.any[j], ctx)) {
          anyHit = true;
          break;
        }
      }
      ok = anyHit;
    }
    return ok;
  }

  function collectRequirementTokens(req, sink) {
    var out = sink || { flags: [], commissions: [], evidence: [] };
    if (!isRequirementObject(req)) return out;
    ['allFlags', 'anyFlags', 'anyChaosFlags'].forEach(function (key) {
      tokenArray(req[key]).forEach(function (token) {
        out.flags.push(token);
      });
    });
    tokenArray(req.anyCommissions).forEach(function (token) {
      out.commissions.push(token);
    });
    ['evidenceAll', 'evidenceAny'].forEach(function (key) {
      tokenArray(req[key]).forEach(function (token) {
        out.evidence.push(token);
      });
    });
    ['all', 'any'].forEach(function (key) {
      if (!isArray(req[key])) return;
      req[key].forEach(function (child) {
        collectRequirementTokens(child, out);
      });
    });
    return out;
  }

  function commissionGameOf(commissionId) {
    var text = String(commissionId || '');
    var dot = text.indexOf('.');
    if (dot <= 0) return '';
    var gameId = text.slice(0, dot);
    return GAME_ID_RE.test(gameId) ? gameId : '';
  }

  /* ------------------------------------------------------------------ *
   * 实例
   * ------------------------------------------------------------------ */

  function createCampaign(options) {
    var settings = isObject(options) ? options : {};

    var state = {
      configured: false,
      contentVersion: CONTENT_VERSION,
      campaign: null,
      chapters: [],
      chapterIndex: Object.create(null),
      endings: [],
      epilogue: null,
      npc: { characters: [] },
      sideStories: { families: [], policy: '' },
      commissions: [],
      commissionIndex: Object.create(null),
      gameIds: [],
      flagProducers: Object.create(null),
      evidenceProducers: Object.create(null),
      evidence: new Set(),
      evidenceConfigured: false,
      chapterFiles: Object.create(null),
      contentErrors: [],
      contentWarnings: [],
      signature: '',
    };

    function reset() {
      state.configured = false;
      state.contentVersion = CONTENT_VERSION;
      state.campaign = null;
      state.chapters = [];
      state.chapterIndex = Object.create(null);
      state.endings = [];
      state.epilogue = null;
      state.npc = { characters: [] };
      state.sideStories = { families: [], policy: '' };
      state.commissions = [];
      state.commissionIndex = Object.create(null);
      state.gameIds = [];
      state.flagProducers = Object.create(null);
      state.evidenceProducers = Object.create(null);
      state.evidence = new Set();
      state.evidenceConfigured = false;
      state.chapterFiles = Object.create(null);
      state.contentErrors = [];
      state.contentWarnings = [];
      state.signature = '';
      return { ok: true };
    }

    /* ---------------- 内容归一化 ---------------- */

    function normalizeChapterFiles(input, errors, warnings) {
      var files = Object.create(null);
      var list = [];
      if (isArray(input)) list = input.slice();
      else if (isObject(input) && isArray(input.chapters)) list = input.chapters.slice();
      else if (isObject(input)) {
        Object.keys(input).forEach(function (key) {
          if (isObject(input[key])) list.push(input[key]);
        });
      } else if (input !== undefined && input !== null) {
        errors.push(errorItem('chapter-files-invalid', 'chapters 输入必须是数组或按 chapterId 的对象。'));
      }
      list.forEach(function (raw) {
        if (!isObject(raw)) return;
        var chapterId = typeof raw.chapterId === 'string' ? trimText(raw.chapterId) : '';
        if (CHAPTER_IDS.indexOf(chapterId) < 0) {
          warnings.push(errorItem('chapter-file-unknown', '忽略无法识别的章节文件 chapterId。', { chapterId: chapterId || null }));
          return;
        }
        if (files[chapterId]) {
          warnings.push(errorItem('chapter-file-duplicate', '章节文件重复，保留第一份。', { chapterId: chapterId }));
          return;
        }
        files[chapterId] = {
          chapterId: chapterId,
          title: trimText(raw.title, 120),
          body: trimText(raw.body, 2000),
          /* 可选戏内身份/角色说明：旧章节文件没有该字段时安全缺省为空。 */
          role: trimText(raw.role, 240),
          contentVersion: trimText(raw.contentVersion, 32),
        };
      });
      return files;
    }

    function normalizeRoute(raw, chapterId, index, errors, warnings) {
      var routeContext = { chapterId: chapterId, routeId: isObject(raw) && typeof raw.routeId === 'string' ? raw.routeId : null };
      if (!isObject(raw)) {
        errors.push(errorItem('route-invalid', '路线必须是对象。', routeContext));
        return null;
      }
      var routeId = typeof raw.routeId === 'string' ? trimText(raw.routeId) : '';
      if (!routeId || !STABLE_ID_RE.test(routeId)) {
        errors.push(errorItem('route-id-invalid', '路线 routeId 缺失或形状非法。', routeContext));
        routeId = 'route-' + index;
      }
      var label = trimText(raw.label, 120);
      if (!label) warnings.push(errorItem('route-label-missing', '路线缺少 label，使用 routeId 兜底。', Object.assign({ routeId: routeId }, routeContext)));
      var rawRequires = raw.requires === undefined || raw.requires === null ? {} : raw.requires;
      if (!isRequirementObject(rawRequires)) {
        errors.push(errorItem('route-requires-invalid', '路线 requires 必须是对象。', Object.assign({ routeId: routeId }, routeContext)));
        rawRequires = {};
      }
      var requires = normalizeRequirement(rawRequires, 0, errors, Object.assign({ routeId: routeId }, routeContext));
      var rewardFlags = [];
      tokenArray(raw.rewardFlags).forEach(function (flag) {
        if (isFlagToken(flag)) rewardFlags.push(flag);
        else errors.push(errorItem('route-flag-invalid', '路线 rewardFlags 形状非法：' + flag, Object.assign({ routeId: routeId }, routeContext)));
      });
      return {
        routeId: routeId,
        label: label || routeId,
        hint: trimText(raw.hint, 240),
        requires: requires,
        requiresRaw: clone(rawRequires) || {},
        rewardFlags: sortedTokens(rewardFlags),
        index: index,
      };
    }

    function normalizeChapters(campaign, chapterInput, errors, warnings) {
      var rawList = isArray(campaign && campaign.chapters) ? campaign.chapters : null;
      if (!rawList) {
        errors.push(errorItem('missing-chapters', 'campaign.chapters 必须是数组（C0–C5）。'));
        return [];
      }
      var files = normalizeChapterFiles(chapterInput, errors, warnings);
      state.chapterFiles = files;
      var out = [];
      var seen = Object.create(null);
      rawList.forEach(function (raw, index) {
        if (!isObject(raw)) {
          errors.push(errorItem('chapter-invalid', '章节必须是对象。', { index: index }));
          return;
        }
        var chapterId = typeof raw.chapterId === 'string' ? trimText(raw.chapterId) : '';
        if (CHAPTER_IDS.indexOf(chapterId) < 0) {
          errors.push(errorItem('chapter-id-invalid', '章节 chapterId 必须是 C0–C5。', { index: index, chapterId: chapterId || null }));
          return;
        }
        if (seen[chapterId]) {
          errors.push(errorItem('chapter-duplicate', '章节重复定义。', { chapterId: chapterId }));
          return;
        }
        seen[chapterId] = true;
        var entryRaw = raw.entry;
        var entry = {};
        if (!isRequirementObject(entryRaw)) {
          errors.push(errorItem('chapter-entry-missing', '章节缺少入口要求 entry。', { chapterId: chapterId }));
        } else {
          entry = normalizeRequirement(entryRaw, 0, errors, { chapterId: chapterId });
        }
        var rawRoutes = raw.routes;
        var routes = [];
        if (!isArray(rawRoutes)) {
          errors.push(errorItem('chapter-routes-missing', '章节 routes 必须是数组。', { chapterId: chapterId }));
        } else {
          if (rawRoutes.length > MAX_ROUTES_PER_CHAPTER) {
            errors.push(errorItem('chapter-routes-too-many', '章节路线过多。', { chapterId: chapterId }));
          }
          rawRoutes.forEach(function (routeRaw, routeIndex) {
            var route = normalizeRoute(routeRaw, chapterId, routeIndex, errors, warnings);
            if (route) routes.push(route);
          });
        }
        var file = files[chapterId] || null;
        if (!file) {
          errors.push(errorItem('chapter-file-missing', '缺少章节文件（chapter-0X.json）。', { chapterId: chapterId }));
        } else {
          var campaignTitle = trimText(raw.title, 120);
          if (file.title && campaignTitle && file.title !== campaignTitle) {
            warnings.push(errorItem('chapter-title-mismatch', '章节文件标题与 campaign 不一致。', {
              chapterId: chapterId,
              campaignTitle: campaignTitle,
              fileTitle: file.title,
            }));
          }
          if (file.contentVersion && file.contentVersion !== CONTENT_VERSION) {
            warnings.push(errorItem('chapter-content-version', '章节文件 contentVersion 与 0.18.0 不一致。', {
              chapterId: chapterId,
              contentVersion: file.contentVersion,
            }));
          }
        }
        out.push({
          chapterId: chapterId,
          index: CHAPTER_IDS.indexOf(chapterId),
          title: trimText(raw.title, 120) || (file && file.title) || chapterId,
          body: file && file.body ? file.body : '',
          /* 可选、向后兼容：从章节文件读取，缺省为空串；不参与 validate/signature。 */
          role: file && file.role ? file.role : '',
          entry: entry,
          entryRaw: isObject(entryRaw) ? clone(entryRaw) || {} : {},
          routes: routes,
          mustKnow: tokenArray(raw.mustKnow).map(function (text) {
            return trimText(text, 240);
          }).filter(function (text) {
            return text !== '';
          }),
          handoff: trimText(raw.handoff, 32),
          fallback: trimText(raw.fallback, 240),
        });
      });
      out.sort(function (left, right) {
        return left.index - right.index;
      });
      return out;
    }

    function normalizeEndings(rawList, errors, warnings) {
      if (!isArray(rawList)) {
        errors.push(errorItem('missing-endings', 'campaign.endings 必须是数组（三终局）。'));
        return [];
      }
      var out = [];
      rawList.forEach(function (raw, index) {
        if (!isObject(raw)) {
          errors.push(errorItem('ending-invalid', '终局必须是对象。', { index: index }));
          return;
        }
        var approach = typeof raw.approach === 'string' ? trimText(raw.approach) : '';
        var entryRaw = raw.entry;
        var entry = {};
        if (!isRequirementObject(entryRaw)) {
          errors.push(errorItem('ending-entry-missing', '终局缺少入口要求 entry。', { approach: approach || null }));
        } else {
          entry = normalizeRequirement(entryRaw, 0, errors, { approach: approach || null });
        }
        var flags = [];
        tokenArray(raw.flags).forEach(function (flag) {
          if (isFlagToken(flag)) flags.push(flag);
          else errors.push(errorItem('ending-flag-invalid', '终局 flags 形状非法：' + flag, { approach: approach || null }));
        });
        out.push({
          approach: approach,
          index: index,
          title: trimText(raw.title, 120),
          summary: trimText(raw.summary, 240),
          entry: entry,
          entryRaw: isObject(entryRaw) ? clone(entryRaw) || {} : {},
          flags: sortedTokens(flags),
        });
      });
      return out;
    }

    function normalizeEpilogue(raw, errors) {
      if (!isObject(raw)) {
        errors.push(errorItem('missing-epilogue', 'campaign.epilogue 必须是对象（base + 三终局差异）。'));
        return { base: '', combat: '', research: '', rescue: '' };
      }
      var out = { base: trimText(raw.base, 600) };
      ENDING_APPROACHES.forEach(function (approach) {
        out[approach] = trimText(raw[approach], 600);
      });
      return out;
    }

    function normalizeNpc(raw, errors, warnings) {
      var characters = [];
      var list = isArray(raw) ? raw : (isObject(raw) && isArray(raw.characters) ? raw.characters : null);
      if (!list) {
        errors.push(errorItem('missing-npc', 'npc 内容缺失（至少每章一条回信）。'));
        return { characters: characters };
      }
      list.forEach(function (rawCharacter) {
        if (!isObject(rawCharacter)) return;
        var characterId = trimText(rawCharacter.characterId, 80);
        if (!characterId) {
          warnings.push(errorItem('npc-character-invalid', '忽略缺少 characterId 的回信角色。'));
          return;
        }
        var replies = [];
        var rawReplies = isArray(rawCharacter.replies) ? rawCharacter.replies : [];
        if (!isArray(rawCharacter.replies)) {
          warnings.push(errorItem('npc-replies-missing', '回信角色缺少 replies 数组。', { characterId: characterId }));
        }
        rawReplies.forEach(function (reply) {
          if (!isObject(reply)) return;
          replies.push({
            chapterId: trimText(reply.chapterId, 8),
            text: trimText(reply.text, 400),
          });
        });
        characters.push({
          characterId: characterId,
          name: trimText(rawCharacter.name, 80) || characterId,
          role: trimText(rawCharacter.role, 120),
          replies: replies,
        });
      });
      return { characters: characters };
    }

    function normalizeSideStories(raw, errors, warnings) {
      var families = [];
      var list = isArray(raw) ? raw : (isObject(raw) && isArray(raw.families) ? raw.families : null);
      if (!list) {
        errors.push(errorItem('missing-side-stories', 'side-stories 内容缺失（可选解释家族）。'));
        return { families: families, policy: '' };
      }
      list.forEach(function (rawFamily) {
        if (!isObject(rawFamily)) return;
        var familyId = trimText(rawFamily.familyId, 80);
        if (!familyId) {
          warnings.push(errorItem('side-story-invalid', '忽略缺少 familyId 的支线家族。'));
          return;
        }
        families.push({
          familyId: familyId,
          title: trimText(rawFamily.title, 120),
          links: sortedTokens(rawFamily.links),
          text: trimText(rawFamily.text, 600),
        });
      });
      return {
        families: families,
        policy: isObject(raw) ? trimText(raw.policy, 400) : '',
      };
    }

    function normalizeCommissions(raw, errors, warnings) {
      var list = null;
      if (isArray(raw)) list = raw;
      else if (isObject(raw) && isArray(raw.commissions)) list = raw.commissions;
      else if (isObject(raw)) {
        list = Object.keys(raw).map(function (key) {
          return raw[key];
        });
      }
      if (!list) {
        warnings.push(errorItem('commissions-missing', '未提供 commissions 内容：委托旗标可达性与单游戏前置检查降级为警告。'));
        return [];
      }
      var out = [];
      list.forEach(function (rawCommission) {
        if (!isObject(rawCommission)) return;
        var commissionId = trimText(rawCommission.commissionId, 120);
        if (!STABLE_ID_RE.test(commissionId)) {
          warnings.push(errorItem('commission-invalid', '忽略 commissionId 形状非法的委托。'));
          return;
        }
        var reward = isObject(rawCommission.reward) ? rawCommission.reward : {};
        out.push({
          commissionId: commissionId,
          gameId: trimText(rawCommission.gameId, 40),
          tier: Number(rawCommission.tier) || 0,
          title: trimText(rawCommission.title, 120),
          unlock: isObject(rawCommission.unlock) ? clone(rawCommission.unlock) : null,
          rewardFlags: sortedTokens(reward.flags),
          rewardEvidence: sortedTokens(reward.evidence),
        });
      });
      return out;
    }

    function normalizeEvidence(raw) {
      var tokens = [];
      if (isArray(raw)) tokens = tokenArray(raw);
      else if (typeof raw === 'string') tokens = tokenArray(raw);
      else if (isObject(raw)) {
        if (isArray(raw.tokens)) tokens = tokenArray(raw.tokens);
        else if (isArray(raw.evidence)) tokens = tokenArray(raw.evidence);
        else {
          tokens = Object.keys(raw).filter(function (key) {
            return raw[key];
          });
        }
      }
      state.evidenceConfigured = tokens.length > 0;
      return new Set(tokens);
    }

    function buildIndexes() {
      state.chapterIndex = Object.create(null);
      state.chapters.forEach(function (chapter) {
        if (!state.chapterIndex[chapter.chapterId]) state.chapterIndex[chapter.chapterId] = chapter;
      });
      state.commissionIndex = Object.create(null);
      state.flagProducers = Object.create(null);
      state.evidenceProducers = Object.create(null);
      var games = Object.create(null);
      state.commissions.forEach(function (commission) {
        if (!state.commissionIndex[commission.commissionId]) state.commissionIndex[commission.commissionId] = commission;
        var gameId = commission.gameId;
        if (GAME_ID_RE.test(gameId)) games[gameId] = true;
        commission.rewardFlags.forEach(function (flag) {
          if (!state.flagProducers[flag]) state.flagProducers[flag] = [];
          if (state.flagProducers[flag].indexOf(gameId) < 0) state.flagProducers[flag].push(gameId);
        });
        commission.rewardEvidence.forEach(function (token) {
          if (!state.evidenceProducers[token]) state.evidenceProducers[token] = [];
          if (state.evidenceProducers[token].indexOf(gameId) < 0) state.evidenceProducers[token].push(gameId);
        });
      });
      state.gameIds = Object.keys(games).sort();
      state.signature = contentSignature();
    }

    function contentSignature() {
      try {
        var parts = [
          CONTENT_VERSION,
          state.chapters.map(function (chapter) {
            return chapter.chapterId + ':' + chapter.routes.map(function (route) {
              return route.routeId + '=' + JSON.stringify(route.requires);
            }).join(',');
          }).join('|'),
          state.endings.map(function (ending) {
            return ending.approach + '=' + JSON.stringify(ending.entry) + '=' + ending.flags.join('+');
          }).join('|'),
          state.npc.characters.length,
          state.sideStories.families.length,
          state.commissions.length,
        ];
        var text = parts.join('::');
        var hash = 2166136261;
        for (var i = 0; i < text.length; i += 1) {
          hash ^= text.charCodeAt(i);
          hash = (hash * 16777619) >>> 0;
        }
        return text.length + ':' + hash.toString(16);
      } catch (err) {
        return '';
      }
    }

    /* ---------------- configure ---------------- */

    function chapterSummaries() {
      return state.chapters.map(function (chapter) {
        return {
          chapterId: chapter.chapterId,
          title: chapter.title,
          routeCount: chapter.routes.length,
          completionFlag: chapterFlagOf(chapter.chapterId),
          handoff: chapter.handoff,
        };
      });
    }

    function endingSummaries() {
      return state.endings.map(function (ending) {
        return {
          approach: ending.approach,
          title: ending.title,
          flags: ending.flags.slice(),
        };
      });
    }

    function configure(input) {
      try {
        reset();
        var options = isObject(input) ? input : {};
        var errors = [];
        var warnings = [];
        var campaign = isObject(options.campaign) ? options.campaign : null;
        if (!campaign) {
          errors.push(errorItem('missing-campaign', '缺少 campaign 内容（六章 / 三终局 / 后日常）。'));
          state.contentErrors = errors;
          state.contentWarnings = warnings;
          return {
            ok: false,
            chapterCount: 0,
            endingCount: 0,
            chapters: [],
            endings: [],
            errors: clone(errors) || [],
            warnings: clone(warnings) || [],
            contentVersion: null,
            version: MODULE_VERSION,
            signature: '',
          };
        }
        state.campaign = {
          contentVersion: trimText(campaign.contentVersion, 32),
          world: trimText(campaign.world, 120),
        };
        state.contentVersion = state.campaign.contentVersion || CONTENT_VERSION;
        if (state.campaign.contentVersion && state.campaign.contentVersion !== CONTENT_VERSION) {
          warnings.push(errorItem('content-version-mismatch', 'campaign.contentVersion 与 0.18.0 不一致。', {
            contentVersion: state.campaign.contentVersion,
          }));
        }
        state.chapters = normalizeChapters(campaign, options.chapters, errors, warnings);
        state.endings = normalizeEndings(campaign.endings, errors, warnings);
        state.epilogue = normalizeEpilogue(campaign.epilogue, errors);
        state.npc = normalizeNpc(options.npc, errors, warnings);
        state.sideStories = normalizeSideStories(options.sideStories, errors, warnings);
        state.commissions = normalizeCommissions(options.commissions, errors, warnings);
        state.evidence = normalizeEvidence(options.evidence);
        /* 证据白名单的第二来源：委托奖励里真实产出的 E-/BP-/MAP-/DEC- token。
           内容路线可以直接引用这些 token，避免要求调用方再维护一份平行白名单。 */
        state.commissions.forEach(function (commission) {
          (commission.rewardEvidence || []).forEach(function (token) {
            state.evidence.add(token);
          });
        });
        state.evidenceConfigured = state.evidence.size > 0;
        if (state.chapters.length > MAX_CHAPTERS) {
          errors.push(errorItem('chapter-count-invalid', '章节数超过上限。', { chapterCount: state.chapters.length }));
        }
        buildIndexes();
        var report = validateContent();
        state.contentErrors = errors.concat(report.errors);
        state.contentWarnings = warnings.concat(report.warnings);
        state.configured = true;
        return {
          ok: state.contentErrors.length === 0,
          chapterCount: state.chapters.length,
          endingCount: state.endings.length,
          chapters: chapterSummaries(),
          endings: endingSummaries(),
          errors: clone(state.contentErrors) || [],
          warnings: clone(state.contentWarnings) || [],
          contentVersion: state.contentVersion,
          world: state.campaign.world,
          version: MODULE_VERSION,
          signature: state.signature,
        };
      } catch (err) {
        reset();
        return {
          ok: false,
          chapterCount: 0,
          endingCount: 0,
          chapters: [],
          endings: [],
          errors: [errorItem(REASONS.exception, 'configure 失败：' + errorText(err))],
          warnings: [],
          contentVersion: null,
          version: MODULE_VERSION,
          signature: '',
        };
      }
    }

    /* ---------------- 校验 ---------------- */

    function routeSelfReferential(chapter, route) {
      var flag = chapterFlagOf(chapter.chapterId);
      if (!flag) return false;
      if (route.rewardFlags.indexOf(flag) < 0) return false;
      var leaves = collectRequirementTokens(route.requires, { flags: [], commissions: [], evidence: [] });
      return leaves.flags.indexOf(flag) >= 0;
    }

    function productiveRoutes(chapter) {
      return chapter.routes.filter(function (route) {
        return !routeSelfReferential(chapter, route);
      });
    }

    function routeGameDependencies(route) {
      var games = [];
      function addGame(gameId) {
        if (!gameId) return;
        if (games.indexOf(gameId) < 0) games.push(gameId);
      }
      var leaves = collectRequirementTokens(route.requires, { flags: [], commissions: [], evidence: [] });
      leaves.commissions.forEach(function (commissionId) {
        addGame(commissionGameOf(commissionId));
      });
      leaves.flags.forEach(function (flag) {
        var producers = state.flagProducers[flag];
        if (producers && producers.length) producers.forEach(addGame);
      });
      leaves.evidence.forEach(function (token) {
        var producers = state.evidenceProducers[token];
        if (producers && producers.length) producers.forEach(addGame);
      });
      return games;
    }

    function originsOf() {
      var games = state.gameIds.slice();
      state.chapters.forEach(function (chapter) {
        chapter.routes.forEach(function (route) {
          var leaves = collectRequirementTokens(route.requires, { flags: [], commissions: [], evidence: [] });
          leaves.commissions.forEach(function (commissionId) {
            var gameId = commissionGameOf(commissionId);
            if (gameId && games.indexOf(gameId) < 0) games.push(gameId);
          });
        });
      });
      games.sort();
      return games;
    }

    function flagSatisfiableWithout(flag, gameId, chapterIndex) {
      var flagChapter = milestoneIndexOf(flag);
      if (flagChapter >= 0) return flagChapter < chapterIndex;
      var producers = state.flagProducers[flag];
      if (!producers || !producers.length) return true;
      return producers.some(function (game) {
        return game !== gameId;
      });
    }

    function evidenceSatisfiableWithout(token, gameId) {
      var producers = state.evidenceProducers[token];
      if (!producers || !producers.length) return true;
      return producers.some(function (game) {
        return game !== gameId;
      });
    }

    /** 去掉某一 origin 游戏后，这条要求是否仍可满足（用于 16 起源 × 3 终局可达性）。 */
    function requirementSatisfiableWithout(req, gameId, chapterIndex) {
      if (!isRequirementObject(req)) return true;
      var ok = true;
      if (ok && isArray(req.allFlags)) {
        ok = req.allFlags.every(function (flag) {
          return flagSatisfiableWithout(flag, gameId, chapterIndex);
        });
      }
      if (ok && isArray(req.anyFlags)) {
        ok = req.anyFlags.length > 0 && req.anyFlags.some(function (flag) {
          return flagSatisfiableWithout(flag, gameId, chapterIndex);
        });
      }
      if (ok && isArray(req.anyChaosFlags)) {
        ok = req.anyChaosFlags.length > 0 && req.anyChaosFlags.some(function (flag) {
          return flagSatisfiableWithout(flag, gameId, chapterIndex);
        });
      }
      if (ok && isArray(req.anyCommissions)) {
        ok = req.anyCommissions.length > 0 && req.anyCommissions.some(function (commissionId) {
          var gameIdOfCommission = commissionGameOf(commissionId);
          return !gameIdOfCommission || gameIdOfCommission !== gameId;
        });
      }
      if (ok && isArray(req.evidenceAll)) {
        ok = req.evidenceAll.every(function (token) {
          return evidenceSatisfiableWithout(token, gameId);
        });
      }
      if (ok && isArray(req.evidenceAny)) {
        ok = req.evidenceAny.length > 0 && req.evidenceAny.some(function (token) {
          return evidenceSatisfiableWithout(token, gameId);
        });
      }
      if (ok && isArray(req.all)) {
        for (var i = 0; i < req.all.length; i += 1) {
          if (!requirementSatisfiableWithout(req.all[i], gameId, chapterIndex)) {
            ok = false;
            break;
          }
        }
      }
      if (ok && isArray(req.any)) {
        var hit = false;
        for (var j = 0; j < req.any.length; j += 1) {
          if (requirementSatisfiableWithout(req.any[j], gameId, chapterIndex)) {
            hit = true;
            break;
          }
        }
        ok = hit;
      }
      return ok;
    }

    function validateContent() {
      var errors = [];
      var warnings = [];
      function err(code, message, extra) {
        errors.push(errorItem(code, message, extra));
      }
      function warn(code, message, extra) {
        warnings.push(errorItem(code, message, extra));
      }

      /* 1. 六章齐备、顺序、入口 / 出口 / 必须事实。 */
      CHAPTER_IDS.forEach(function (chapterId, index) {
        if (!state.chapterIndex[chapterId]) {
          err('chapter-missing', '缺少章节 ' + chapterId + '。', { chapterId: chapterId, index: index });
        }
      });
      if (state.chapters.length === CHAPTER_IDS.length) {
        for (var oi = 0; oi < CHAPTER_IDS.length; oi += 1) {
          if (!state.chapters[oi] || state.chapters[oi].chapterId !== CHAPTER_IDS[oi]) {
            err('chapter-order', '章节顺序必须为 C0→C5。', {
              expected: CHAPTER_IDS[oi],
              actual: state.chapters[oi] ? state.chapters[oi].chapterId : null,
            });
            break;
          }
        }
      }
      state.chapters.forEach(function (chapter) {
        if (!chapter.mustKnow.length) {
          err('chapter-must-know-missing', '章节缺少 mustKnow 必须知道的事实。', { chapterId: chapter.chapterId });
        }
        var expectedHandoff = chapter.index < CHAPTER_IDS.length - 1 ? CHAPTER_IDS[chapter.index + 1] : EPILOGUE_HANDOFF;
        if (chapter.handoff !== expectedHandoff) {
          err('chapter-handoff-wrong', '章节出口 handoff 不正确。', {
            chapterId: chapter.chapterId,
            expected: expectedHandoff,
            actual: chapter.handoff || null,
          });
        }
        if (chapter.chapterId === FINALE_CHAPTER) return;
        var minRoutes = MIN_ROUTES[chapter.chapterId] || 2;
        var productive = productiveRoutes(chapter);
        if (chapter.routes.length < minRoutes || productive.length < minRoutes) {
          err('chapter-too-few-routes', '章节可玩路线不足（需要 ≥' + minRoutes + ' 条替代路线）。', {
            chapterId: chapter.chapterId,
            routes: chapter.routes.length,
            productive: productive.length,
            min: minRoutes,
          });
        }
      });

      /* 2. 入口旗标不得自指或倒指（循环旗标）。 */
      state.chapters.forEach(function (chapter) {
        var leaves = collectRequirementTokens(chapter.entry, { flags: [], commissions: [], evidence: [] });
        leaves.flags.forEach(function (flag) {
          var flagChapter = milestoneIndexOf(flag);
          if (flagChapter < 0) return;
          if (flagChapter >= chapter.index) {
            err('cyclic-chapter-entry', '章节入口引用了自身或后续章节的旗标（循环旗标）。', {
              chapterId: chapter.chapterId,
              flag: flag,
              requiresChapter: CHAPTER_IDS[flagChapter],
            });
          }
        });
      });

      /* 3. 路线：旗标授予、未知委托、自指、倒指。 */
      state.chapters.forEach(function (chapter) {
        var chapterFlag = chapterFlagOf(chapter.chapterId);
        chapter.routes.forEach(function (route) {
          var leaves = collectRequirementTokens(route.requires, { flags: [], commissions: [], evidence: [] });
          leaves.commissions.forEach(function (commissionId) {
            if (!state.commissionIndex[commissionId] && state.commissions.length) {
              err('route-unknown-commission', '路线引用了不存在的委托。', {
                chapterId: chapter.chapterId,
                routeId: route.routeId,
                commissionId: commissionId,
              });
            }
          });
          leaves.evidence.forEach(function (token) {
            if (!state.evidenceConfigured) {
              warn('evidence-unverified', '未提供证据白名单，evidence 要求无法静态校验。', {
                chapterId: chapter.chapterId,
                routeId: route.routeId,
                token: token,
              });
            } else if (!state.evidence.has(token)) {
              err('unknown-evidence', '路线引用了白名单外的证据 token。', {
                chapterId: chapter.chapterId,
                routeId: route.routeId,
                token: token,
              });
            }
          });
          if (chapterFlag) {
            if (route.rewardFlags.length && route.rewardFlags.indexOf(chapterFlag) < 0) {
              err('route-flag-mismatch', '路线奖励旗标未包含本章里程碑旗标。', {
                chapterId: chapter.chapterId,
                routeId: route.routeId,
                flag: chapterFlag,
              });
            }
            if (!route.rewardFlags.length) {
              warn('route-flag-missing', '路线没有奖励旗标。', { chapterId: chapter.chapterId, routeId: route.routeId });
            }
            if (routeSelfReferential(chapter, route)) {
              warn('route-self-reference', '路线要求了它自己授予的本章旗标（只作为完成后确认路径）。', {
                chapterId: chapter.chapterId,
                routeId: route.routeId,
                flag: chapterFlag,
              });
            }
          }
          leaves.flags.forEach(function (flag) {
            var flagChapter = milestoneIndexOf(flag);
            if (flagChapter > chapter.index) {
              err('route-cycle', '路线引用了后续章节的旗标（循环依赖）。', {
                chapterId: chapter.chapterId,
                routeId: route.routeId,
                flag: flag,
                requiresChapter: CHAPTER_IDS[flagChapter],
              });
            }
          });
        });
        if (chapterFlag && chapter.chapterId !== FINALE_CHAPTER) {
          var granted = chapter.routes.some(function (route) {
            return route.rewardFlags.indexOf(chapterFlag) >= 0;
          });
          if (!granted) {
            err('chapter-flag-ungranted', '章节里程碑旗标没有任何路线授予。', {
              chapterId: chapter.chapterId,
              flag: chapterFlag,
            });
          }
        }
      });

      /* 4. 每章至少一条路线不依赖任一单一游戏（16 起源 × 3 终局可达的前提）。 */
      var origins = originsOf();
      if (!origins.length) {
        warn('origins-unknown', '没有可识别的游戏起源（未提供 commissions 内容）。');
      }
      origins.forEach(function (gameId) {
        ['C1', 'C2', 'C3', 'C4'].forEach(function (chapterId) {
          var chapter = state.chapterIndex[chapterId];
          if (!chapter) return;
          var productive = productiveRoutes(chapter);
          var reachable = productive.some(function (route) {
            return requirementSatisfiableWithout(route.requires, gameId, chapter.index);
          });
          if (!reachable) {
            err('single-game-lock', '章节被单一游戏硬锁：去掉该游戏后无可达路线。', {
              chapterId: chapterId,
              gameId: gameId,
            });
          }
        });
      });

      /* 5. 三终局：数量、approach、旗标、入口（C4 之后可选、不得依赖委托/单一游戏）。 */
      var seenApproach = Object.create(null);
      state.endings.forEach(function (ending) {
        if (!isApproach(ending.approach)) {
          err('ending-approach-invalid', '终局 approach 必须是 combat/research/rescue。', { approach: ending.approach || null });
          return;
        }
        if (seenApproach[ending.approach]) {
          err('ending-duplicate', '终局 approach 重复。', { approach: ending.approach });
          return;
        }
        seenApproach[ending.approach] = ending;
        if (!ending.title) warn('ending-title-missing', '终局缺少标题。', { approach: ending.approach });
        if (!ending.summary) warn('ending-summary-missing', '终局缺少摘要。', { approach: ending.approach });
        var expectedFlags = [CHAPTER_FLAGS.C5, 'ending.' + ending.approach];
        expectedFlags.forEach(function (flag) {
          if (ending.flags.indexOf(flag) < 0) {
            err('ending-flag-mismatch', '终局旗标缺少 ' + flag + '。', { approach: ending.approach, flag: flag });
          }
        });
        var leaves = collectRequirementTokens(ending.entry, { flags: [], commissions: [], evidence: [] });
        if (leaves.flags.indexOf(CHAPTER_FLAGS.C4) < 0) {
          err('ending-entry-missing-c4', '终局入口必须要求 C4.city_power_restored。', { approach: ending.approach });
        }
        if (leaves.commissions.length || leaves.evidence.length) {
          err('ending-entry-game-dependent', '终局入口不得依赖委托或证据（任一起源都必须可选）。', {
            approach: ending.approach,
            commissions: leaves.commissions,
            evidence: leaves.evidence,
          });
        }
      });
      ENDING_APPROACHES.forEach(function (approach) {
        if (!seenApproach[approach]) {
          err('ending-missing', '缺少终局 ' + approach + '。', { approach: approach });
        }
      });
      if (state.endings.length !== ENDING_APPROACHES.length) {
        err('ending-count-wrong', '终局数量必须为 3。', {
          endingCount: state.endings.length,
          expected: ENDING_APPROACHES.length,
        });
      }

      /* 6. 后日常：base + 三条差异文本。 */
      if (!state.epilogue || !state.epilogue.base) {
        err('epilogue-missing', '后日常缺少 base 文本。');
      } else {
        var seenText = Object.create(null);
        ENDING_APPROACHES.forEach(function (approach) {
          var text = state.epilogue[approach];
          if (!text) {
            err('epilogue-missing', '后日常缺少 ' + approach + ' 差异文本。', { approach: approach });
            return;
          }
          if (seenText[text]) {
            err('epilogue-not-distinct', '后日常差异文本重复。', { approach: approach, sameAs: seenText[text] });
          } else {
            seenText[text] = approach;
          }
        });
      }

      /* 7. side-stories：可选解释，不提供唯一必需资源。 */
      if (!state.sideStories.families.length) {
        err('side-stories-empty', 'side-stories 至少需要一个可选解释家族。');
      }
      var sideLinks = Object.create(null);
      state.sideStories.families.forEach(function (family) {
        if (!family.text) err('side-story-text-missing', '支线家族缺少 text。', { familyId: family.familyId });
        if (!family.links.length) warn('side-story-links-missing', '支线家族没有 links。', { familyId: family.familyId });
        family.links.forEach(function (link) {
          if (sideLinks[link]) {
            warn('side-story-link-duplicate', '支线 link 重复。', { link: link, familyId: family.familyId });
          }
          sideLinks[link] = family.familyId;
        });
      });
      var requiredSink = { flags: [], commissions: [], evidence: [] };
      state.chapters.forEach(function (chapter) {
        collectRequirementTokens(chapter.entry, requiredSink);
        chapter.routes.forEach(function (route) {
          collectRequirementTokens(route.requires, requiredSink);
        });
      });
      state.endings.forEach(function (ending) {
        collectRequirementTokens(ending.entry, requiredSink);
      });
      var requiredTokens = tokenArray(requiredSink.flags)
        .concat(tokenArray(requiredSink.commissions))
        .concat(tokenArray(requiredSink.evidence));
      requiredTokens.forEach(function (token) {
        if (sideLinks[token]) {
          err('side-story-required', '必需前置引用了只属于 side-stories 的 token。', {
            token: token,
            familyId: sideLinks[token],
          });
        }
      });

      /* 8. npc：每章至少一条回信。 */
      if (!state.npc.characters.length) {
        err('npc-empty', 'npc 内容没有任何角色回信。');
      }
      CHAPTER_IDS.forEach(function (chapterId) {
        var hasReply = state.npc.characters.some(function (character) {
          return character.replies.some(function (reply) {
            return reply.chapterId === chapterId && reply.text !== '';
          });
        });
        if (!hasReply) {
          err('npc-missing-chapter', '章节缺少 npc 回信。', { chapterId: chapterId });
        }
      });
      state.npc.characters.forEach(function (character) {
        if (!character.replies.length) {
          warn('npc-character-empty', 'npc 角色没有回信。', { characterId: character.characterId });
        }
      });

      /* 9. 证据要求：白名单缺失只降级为警告（configure 允许无证据内容）。 */
      if (requiredSink.evidence.length && !state.evidenceConfigured) {
        warn('evidence-missing-whitelist', '内容使用 evidence 前置但未提供证据白名单。');
      }

      return { errors: errors, warnings: warnings };
    }

    function validate() {
      if (!state.configured) {
        return {
          ok: false,
          configured: false,
          errors: [errorItem(REASONS.notConfigured, 'campaign-core 尚未 configure。')],
          warnings: [],
          chapterCount: 0,
          endingCount: 0,
          chapters: [],
          endings: [],
          origins: [],
          alternatives: {},
          version: MODULE_VERSION,
        };
      }
      try {
        var report = validateContent();
        var alternatives = {};
        state.chapters.forEach(function (chapter) {
          alternatives[chapter.chapterId] = chapter.chapterId === FINALE_CHAPTER
            ? state.endings.length
            : productiveRoutes(chapter).length;
        });
        return {
          ok: report.errors.length === 0,
          configured: true,
          errors: clone(report.errors) || [],
          warnings: clone(report.warnings) || [],
          chapterCount: state.chapters.length,
          endingCount: state.endings.length,
          chapters: chapterSummaries(),
          endings: endingSummaries(),
          origins: originsOf(),
          alternatives: alternatives,
          signature: state.signature,
          version: MODULE_VERSION,
        };
      } catch (err) {
        return {
          ok: false,
          configured: true,
          errors: [errorItem(REASONS.exception, 'validate 失败：' + errorText(err))],
          warnings: [],
          chapterCount: state.chapters.length,
          endingCount: state.endings.length,
          chapters: chapterSummaries(),
          endings: endingSummaries(),
          origins: [],
          alternatives: {},
          version: MODULE_VERSION,
        };
      }
    }

    /* ---------------- 状态推导 ---------------- */

    function endingChosenOf(ctx) {
      for (var i = 0; i < ENDING_APPROACHES.length; i += 1) {
        var approach = ENDING_APPROACHES[i];
        if (ctx.flags.has('ending.' + approach)) return approach;
      }
      return null;
    }

    function chapterCompleted(chapter, ctx, endingChosen) {
      var flag = chapterFlagOf(chapter.chapterId);
      if (chapter.chapterId === FINALE_CHAPTER) {
        if (endingChosen) return true;
        if (ctx.flags.has(flag)) return true;
        return false;
      }
      return ctx.flags.has(flag);
    }

    function chapterStatuses(ctx, endingChosen) {
      var completed = [];
      state.chapters.forEach(function (chapter) {
        completed.push(chapterCompleted(chapter, ctx, endingChosen));
      });
      var statuses = [];
      var earlierIncomplete = false;
      state.chapters.forEach(function (chapter, index) {
        var entryMet = evalRequirement(chapter.entry, ctx);
        var status;
        if (completed[index]) {
          status = 'complete';
        } else if (!entryMet) {
          status = 'locked';
        } else if (chapter.chapterId === FINALE_CHAPTER) {
          status = state.endings.length ? 'available' : 'locked';
        } else if (earlierIncomplete) {
          status = 'available';
        } else {
          status = 'active';
        }
        statuses.push(status);
        if (!completed[index]) earlierIncomplete = true;
      });
      return { statuses: statuses, completed: completed };
    }

    function npcRepliesFor(chapterId) {
      var replies = [];
      state.npc.characters.forEach(function (character) {
        character.replies.forEach(function (reply) {
          if (reply.chapterId !== chapterId || !reply.text) return;
          replies.push({
            characterId: character.characterId,
            name: character.name,
            role: character.role,
            text: reply.text,
          });
        });
      });
      return replies;
    }

    function routeView(route, ctx, chapterComplete) {
      var met = evalRequirement(route.requires, ctx);
      return {
        routeId: route.routeId,
        label: route.label,
        hint: route.hint,
        requires: clone(route.requires) || {},
        rewardFlags: route.rewardFlags.slice(),
        missions: collectRequirementTokens(route.requires, { flags: [], commissions: [], evidence: [] }).commissions,
        met: met,
        available: met && !chapterComplete,
        complete: chapterComplete,
        confirmed: chapterComplete,
        selfReferential: false,
      };
    }

    function endingRouteViews(ctx, endingChosen) {
      return state.endings.map(function (ending) {
        var entryMet = evalRequirement(ending.entry, ctx);
        var chosen = endingChosen === ending.approach;
        return {
          routeId: 'ending.' + ending.approach,
          label: ending.title || ending.approach,
          hint: ending.summary,
          requires: clone(ending.entry) || {},
          rewardFlags: ending.flags.slice(),
          missions: [],
          met: entryMet && !endingChosen,
          available: entryMet && !endingChosen,
          complete: chosen,
          selfReferential: false,
          approach: ending.approach,
        };
      });
    }

    function chapterViews(ctx, endingChosen, statuses) {
      return state.chapters.map(function (chapter, index) {
        var chapterComplete = statuses.completed[index];
        var views;
        if (chapter.chapterId === FINALE_CHAPTER) {
          views = endingRouteViews(ctx, endingChosen);
        } else {
          views = chapter.routes.map(function (route) {
            var view = routeView(route, ctx, chapterComplete);
            view.selfReferential = routeSelfReferential(chapter, route);
            return view;
          });
        }
        return {
          chapterId: chapter.chapterId,
          title: chapter.title,
          body: chapter.body,
          /* 可选字段：旧档/旧内容读到空串，town 可直接安全使用。 */
          role: chapter.role || '',
          state: statuses.statuses[index],
          entryMet: evalRequirement(chapter.entry, ctx),
          completionFlag: chapterFlagOf(chapter.chapterId),
          routes: views,
          mustKnow: chapter.mustKnow.slice(),
          handoff: chapter.handoff,
          fallback: chapter.fallback,
          replies: npcRepliesFor(chapter.chapterId),
        };
      });
    }

    function endingViews(ctx, endingChosen) {
      return state.endings.map(function (ending) {
        var entryMet = evalRequirement(ending.entry, ctx);
        return {
          approach: ending.approach,
          title: ending.title,
          summary: ending.summary,
          available: entryMet && !endingChosen,
          chosen: endingChosen === ending.approach,
          entryMet: entryMet,
          requirements: clone(ending.entry) || {},
          flags: ending.flags.slice(),
        };
      });
    }

    function currentChapterOf(chapters) {
      var i;
      for (i = 0; i < chapters.length; i += 1) {
        if (chapters[i].state === 'active') return chapters[i].chapterId;
      }
      for (i = 0; i < chapters.length; i += 1) {
        if (chapters[i].state === 'available') return chapters[i].chapterId;
      }
      return null;
    }

    function failure(reason, extra) {
      var out = {
        ok: false,
        reason: reason,
        chapters: [],
        currentChapter: null,
        endings: [],
        endingChosen: null,
        epilogue: null,
      };
      if (isObject(extra)) {
        Object.keys(extra).forEach(function (key) {
          out[key] = extra[key];
        });
      }
      return out;
    }

    /**
     * 只读状态推导。
     * @param {{quests?:*, claims?:*, profile?:object, wallet?:object, flags?:*, evidence?:*, cleared?:*}} input
     */
    function stateFn(input) {
      if (!state.configured) return failure(REASONS.notConfigured);
      try {
        var ctx = resolveContext(input);
        var endingChosen = endingChosenOf(ctx);
        var statuses = chapterStatuses(ctx, endingChosen);
        var chapters = chapterViews(ctx, endingChosen, statuses);
        var endings = endingViews(ctx, endingChosen);
        var epilogue = endingChosen ? epilogueFor(endingChosen) : null;
        return {
          ok: true,
          chapters: chapters,
          currentChapter: currentChapterOf(chapters),
          endings: endings,
          endingChosen: endingChosen,
          epilogue: epilogue,
          flags: sortedTokens(Array.from(ctx.flags)),
          cleared: sortedTokens(Array.from(ctx.cleared)),
          evidenceCount: ctx.evidence.size,
          contentErrors: clone(state.contentErrors) || [],
          warnings: clone(state.contentWarnings) || [],
          version: MODULE_VERSION,
        };
      } catch (err) {
        return failure(REASONS.exception, { error: errorText(err) });
      }
    }

    function endingOptions(input) {
      if (!state.configured) return [];
      try {
        var ctx = resolveContext(input);
        var chosen = endingChosenOf(ctx);
        return endingViews(ctx, chosen);
      } catch (err) {
        return [];
      }
    }

    /**
     * 后日常文本：base + 该 approach 的差异句。返回值同时带上 combat/research/rescue
     * 三条差异文本（campaign.epilogue 的三键口径），便于 ui/world-state 直接归一。
     */
    function epilogueFor(approach) {
      var base = state.epilogue && state.epilogue.base ? state.epilogue.base : '';
      var perApproach = function () {
        var out = {};
        ENDING_APPROACHES.forEach(function (item) {
          out[item] = state.epilogue && state.epilogue[item] ? state.epilogue[item] : '';
        });
        return out;
      };
      if (!isApproach(approach)) {
        var fallback = {
          ok: false,
          reason: REASONS.unknownApproach,
          approach: approach === undefined ? null : approach,
          base: base,
          extra: '',
          text: base,
          known: false,
        };
        var fallbackTexts = perApproach();
        ENDING_APPROACHES.forEach(function (item) {
          fallback[item] = fallbackTexts[item];
        });
        return fallback;
      }
      var extra = state.epilogue && state.epilogue[approach] ? state.epilogue[approach] : '';
      var epilogue = {
        ok: true,
        approach: approach,
        base: base,
        extra: extra,
        text: base + extra,
        known: true,
      };
      var texts = perApproach();
      ENDING_APPROACHES.forEach(function (item) {
        epilogue[item] = texts[item];
      });
      return epilogue;
    }

    /* ---------------- 旗标同步（唯一写路径） ---------------- */

    function mailboxEvidence(input, quests, ctx) {
      var options = isObject(input) ? input : {};
      if (options.mailboxOpened === true || options.mailOpened === true || options.letterRead === true) return true;
      if (!isArray(quests)) return false;
      for (var i = 0; i < quests.length; i += 1) {
        var row = quests[i];
        if (!isObject(row)) continue;
        var nodeId = typeof row.nodeId === 'string' ? row.nodeId : '';
        if (nodeId.indexOf('mailbox:') === 0 || nodeId.indexOf('letter:') === 0 || nodeId.indexOf('mail:') === 0) return true;
        if ((row.kind === 'mailbox' || row.kind === 'letter') && row.status === 'cleared') return true;
      }
      return ctx.flags.has(CHAPTER_FLAGS.C0);
    }

    function firstMetRoute(chapter, ctx) {
      if (!chapter) return null;
      for (var i = 0; i < chapter.routes.length; i += 1) {
        var route = chapter.routes[i];
        if (routeSelfReferential(chapter, route)) continue;
        if (evalRequirement(route.requires, ctx)) return route.routeId;
      }
      return null;
    }

    function syncRows(careerId, flags, at) {
      return flags.map(function (flag) {
        var row = {
          careerId: careerId,
          nodeId: 'story:' + flag,
          kind: 'story-flag',
          status: 'cleared',
          flags: [flag],
          source: 'campaign',
          schemaVersion: SCHEMA_VERSION,
        };
        if (at) row.clearedAt = at;
        return row;
      });
    }

    /**
     * 只补 C0.port_seen（信箱打开证据）与 C1.signal_fragment（C1 任一路线要求满足）。
     * 幂等：没有待补旗标时零写入；写入是单次 putQuests 事务；失败返回结构化错误。
     */
    async function syncFlags(input) {
      try {
        var options = isObject(input) ? input : {};
        if (!state.configured) return failure(REASONS.notConfigured, { added: [], skipped: [], written: 0 });
        /* 内容骨架不可用（缺 C1）时拒绝写库：宁可零写入，也不在半配置内容上发旗标。 */
        if (!state.chapterIndex.C1) {
          return failure(REASONS.contentInvalid, {
            detail: 'missing-chapter-C1',
            errors: clone(state.contentErrors) || [],
            added: [],
            skipped: [],
            written: 0,
          });
        }
        var careerId = options.careerId;
        if (typeof careerId !== 'string' || !STABLE_ID_RE.test(careerId)) {
          return failure(REASONS.badCareerId, { careerId: careerId === undefined ? null : careerId, added: [], skipped: [], written: 0 });
        }
        var db = isObject(options.db) ? options.db : null;
        if (!db || !isFunction(db.putQuests)) {
          return failure(REASONS.dbUnavailable, { careerId: careerId, added: [], skipped: [], written: 0 });
        }
        var quests = null;
        if (isArray(options.quests) || isObject(options.quests)) {
          quests = questRowsOf(options.quests);
        } else if (isFunction(db.readQuestState)) {
          var read;
          try {
            read = await db.readQuestState(careerId);
          } catch (err) {
            return failure(REASONS.dbReadFailed, { careerId: careerId, error: errorText(err), added: [], skipped: [], written: 0 });
          }
          if (isObject(read) && read.ok === false) {
            return failure(REASONS.dbReadFailed, {
              careerId: careerId,
              detail: read.reason || null,
              added: [],
              skipped: [],
              written: 0,
            });
          }
          quests = questRowsOf(read);
        } else {
          return failure(REASONS.dbUnavailable, {
            careerId: careerId,
            detail: 'read-quest-state-missing',
            added: [],
            skipped: [],
            written: 0,
          });
        }

        var ctx = contextFrom({
          quests: quests,
          claims: options.claims,
          profile: options.profile,
          flags: options.flags,
          evidence: options.evidence,
        });
        var virtualFlags = new Set(ctx.flags);
        var added = [];
        var skipped = [];
        var grantedVia = null;

        /* C0：只由信箱打开证据补；已存在则跳过。 */
        if (virtualFlags.has(CHAPTER_FLAGS.C0)) {
          skipped.push({ flag: CHAPTER_FLAGS.C0, reason: 'already-present' });
        } else if (mailboxEvidence(options, quests, ctx)) {
          added.push(CHAPTER_FLAGS.C0);
          virtualFlags.add(CHAPTER_FLAGS.C0);
        } else {
          skipped.push({ flag: CHAPTER_FLAGS.C0, reason: 'no-mailbox-evidence' });
        }

        /* C1：本章入口满足 + 任一路线要求满足（同一事务内可用刚补的 C0 旗标）。 */
        if (virtualFlags.has(CHAPTER_FLAGS.C1)) {
          skipped.push({ flag: CHAPTER_FLAGS.C1, reason: 'already-present' });
        } else {
          var chapterC1 = state.chapterIndex.C1;
          var virtualCtx = {
            flags: virtualFlags,
            evidence: ctx.evidence,
            cleared: ctx.cleared,
          };
          if (!chapterC1 || !evalRequirement(chapterC1.entry, virtualCtx)) {
            skipped.push({ flag: CHAPTER_FLAGS.C1, reason: 'entry-not-met' });
          } else {
            var viaRoute = firstMetRoute(chapterC1, virtualCtx);
            if (viaRoute) {
              added.push(CHAPTER_FLAGS.C1);
              virtualFlags.add(CHAPTER_FLAGS.C1);
              grantedVia = viaRoute;
            } else {
              skipped.push({ flag: CHAPTER_FLAGS.C1, reason: 'requirements-not-met' });
            }
          }
        }

        /* C2–C4 / C5 绝不写：任何非 C0/C1 的旗标在写库前再次过滤。 */
        var writable = added.filter(function (flag) {
          return SYNCABLE_FLAGS.indexOf(flag) >= 0;
        });
        var rows = syncRows(careerId, writable, trimText(options.now, 40));
        var flagsSnapshot = sortedTokens(Array.from(virtualFlags));
        if (!rows.length) {
          return {
            ok: true,
            changed: false,
            careerId: careerId,
            written: 0,
            added: [],
            skipped: skipped,
            via: grantedVia,
            flags: flagsSnapshot,
          };
        }
        var write;
        try {
          if (options.guard && isFunction(db.putQuestsGuarded)) {
            write = await db.putQuestsGuarded(careerId, rows, options.guard);
          } else {
            write = await db.putQuests(careerId, rows);
          }
        } catch (err) {
          return failure(REASONS.dbWriteFailed, {
            careerId: careerId,
            error: errorText(err),
            wrote: 0,
            attempted: rows.length,
            added: writable.slice(),
            skipped: skipped,
          });
        }
        if (isObject(write) && write.ok === false) {
          return failure(REASONS.dbWriteFailed, {
            careerId: careerId,
            detail: write.reason || null,
            wrote: 0,
            attempted: rows.length,
            added: writable.slice(),
            skipped: skipped,
          });
        }
        return {
          ok: true,
          changed: true,
          careerId: careerId,
          written: rows.length,
          added: writable.slice(),
          skipped: skipped,
          via: grantedVia,
          flags: flagsSnapshot,
        };
      } catch (err) {
        return failure(REASONS.exception, { error: errorText(err), added: [], skipped: [], written: 0 });
      }
    }

    /* ---------------- 主线推荐（只读） ---------------- */

    /**
     * 推荐只认调用方注入的 storyEvidence 模块（真实 storyFlags 函数）；浏览器里
     * 也接受镜像到 ArcadeCareer.storyEvidence 的同一实现。缺接口一律降级 null。
     */
    function recommendedEvidenceModule(input) {
      var options = isObject(input) ? input : {};
      var direct = options.storyEvidence;
      if (isObject(direct) && isFunction(direct.storyFlags)) return direct;
      var exported = root && isObject(root.ArcadeCareer) ? root.ArcadeCareer.storyEvidence : null;
      if (isObject(exported) && isFunction(exported.storyFlags)) {
        if (isFunction(exported.isConfigured) && exported.isConfigured() !== true) return null;
        return exported;
      }
      return null;
    }

    /**
     * 调真实 storyEvidence.storyFlags 并把 flags/evidence 换成投影集合。
     * 用于“模拟本单 reward 后是否真的授予章节旗标”的验算，不复制任何规则。
     */
    function storySnapshot(evidenceModule, input, flags, evidence) {
      if (!evidenceModule || !isFunction(evidenceModule.storyFlags)) return null;
      var story;
      try {
        story = evidenceModule.storyFlags({
          quests: input && input.quests,
          claims: input && input.claims,
          profile: input && input.profile,
          wallet: input && input.wallet,
          flags: Array.from(flags),
          evidence: Array.from(evidence),
        });
      } catch (err) {
        return null;
      }
      if (!isObject(story) || story.ok !== true) return null;
      var derived = new Set();
      tokenArray(story.flags).forEach(function (flag) {
        if (isFlagToken(flag)) derived.add(flag);
      });
      tokenArray(story.allFlags).forEach(function (flag) {
        if (isFlagToken(flag)) derived.add(flag);
      });
      return {
        flags: derived,
        missing: isObject(story.missing) ? story.missing : Object.create(null),
      };
    }

    function projectedContext(ctx, commission) {
      return {
        flags: new Set(Array.from(ctx.flags).concat(commission.rewardFlags)),
        evidence: new Set(Array.from(ctx.evidence).concat(commission.rewardEvidence)),
        cleared: new Set(Array.from(ctx.cleared).concat([commission.commissionId])),
      };
    }

    function producesForChapter(commission, chapterId) {
      if (!commission) return false;
      if (chapterId === 'C1') {
        return commission.rewardFlags.length > 0 || commission.rewardEvidence.length > 0;
      }
      return commission.rewardEvidence.length > 0;
    }

    function unlockRequiresCommission(unlock, commissionId) {
      if (!isObject(unlock)) return false;
      var nodes = (isArray(unlock.all) ? unlock.all : []).concat(isArray(unlock.any) ? unlock.any : []);
      for (var i = 0; i < nodes.length; i += 1) {
        if (isObject(nodes[i]) && nodes[i].commissionCleared === commissionId) return true;
      }
      return false;
    }

    /** 把若干委托的真实 reward 投影到证据集合（不写库、不复制规则）。 */
    function projectEvidence(evidenceSet, commissions) {
      var out = new Set(Array.from(evidenceSet));
      commissions.forEach(function (commission) {
        if (!commission) return;
        commission.rewardEvidence.forEach(function (token) {
          out.add(token);
        });
        commission.rewardFlags.forEach(function (flag) {
          out.add(flag);
        });
      });
      return out;
    }

    /** 从当前章真实缺口取可补缺的证据/旗标 token（排除泛化的 class 计数项之外的具体候选）。 */
    function gapTokens(missing) {
      var tokens = [];
      (missing || []).forEach(function (item) {
        if (!isObject(item)) return;
        if (typeof item.token === 'string') tokens.push(item.token);
        if (typeof item.flag === 'string') tokens.push(item.flag);
        if (isArray(item.candidates)) tokens = tokens.concat(item.candidates);
      });
      return tokens;
    }

    function missingSignature(missing) {
      var parts = [];
      (missing || []).forEach(function (item) {
        if (!isObject(item)) return;
        parts.push([
          item.kind || '',
          item.class || '',
          item.token || item.flag || item.game || '',
          item.atLeast === undefined ? '' : item.atLeast,
          item.have === undefined ? '' : item.have,
          item.need === undefined ? '' : item.need,
        ].join(':'));
      });
      parts.sort();
      return parts.join('|');
    }

    function missingForChapter(evidenceModule, chapterId, flags, evidence) {
      var flag = chapterFlagOf(chapterId);
      if (!flag || !evidenceModule || !isFunction(evidenceModule.missingFor)) return null;
      try {
        var result = evidenceModule.missingFor(flag, {
          flags: Array.from(flags),
          evidence: Array.from(evidence),
        });
        if (!isObject(result) || result.ok !== true || !isArray(result.missing)) return null;
        return {
          unlocked: result.unlocked === true,
          missing: result.missing,
          signature: missingSignature(result.missing),
          tokens: gapTokens(result.missing),
        };
      } catch (err) {
        return null;
      }
    }

    /** 某单（及其必要下游）的 reward 是否真能减少当前章缺口或授予本章旗标。 */
    function closesGap(chapterId, chain, baseline, gap, evidenceModule, input) {
      if (!gap) return false;
      var evidence = projectEvidence(baseline.evidence, chain);
      var snapshot = storySnapshot(evidenceModule, input, baseline.flags, evidence);
      if (!snapshot || snapshot.flags.has(chapterFlagOf(chapterId))) return !!snapshot && snapshot.flags.has(chapterFlagOf(chapterId));
      var after = missingForChapter(evidenceModule, chapterId, baseline.flags, evidence);
      if (!after) return false;
      if (!after.missing.length) return true;
      if (after.missing.length < gap.missing.length) return true;
      if (after.signature !== gap.signature) {
        /* 计数类缺口：need 减少即为真实进展；token 类缺口：补进具体候选也算。 */
        for (var i = 0; i < gap.missing.length; i += 1) {
          var beforeItem = gap.missing[i];
          var afterItem = after.missing.filter(function (item) {
            return isObject(item) && item.kind === beforeItem.kind
              && item.class === beforeItem.class
              && (item.token || item.flag || item.game) === (beforeItem.token || beforeItem.flag || beforeItem.game);
          })[0];
          if (!afterItem) return true;
          if (typeof beforeItem.need === 'number' && typeof afterItem.need === 'number'
              && afterItem.need < beforeItem.need) return true;
        }
        var gained = gap.tokens.filter(function (token) {
          return evidence.has(token);
        });
        if (gained.length) return true;
      }
      return false;
    }

    /**
     * 找一条从本单开始的真实下游链，其全部 reward 投影后能减少当前章缺口。
     * T1 本身不产证时允许带上下游单，但只接受确实补当前章缺口的下游。
     */
    function gapClosingChain(commissionId, chapterId, baseline, gap, evidenceModule, input, depth, seen, allowedDownstream) {
      if (depth > 3) return null;
      var commission = state.commissionIndex[commissionId];
      if (!commission || seen[commissionId]) return null;
      var chainSeen = Object.create(null);
      Object.keys(seen).forEach(function (key) { chainSeen[key] = true; });
      chainSeen[commissionId] = true;
      var chain = [commission];
      if (closesGap(chapterId, chain, baseline, gap, evidenceModule, input)) return chain;
      for (var i = 0; i < state.commissions.length; i += 1) {
        var other = state.commissions[i];
        if (allowedDownstream && !allowedDownstream[other.commissionId]) continue;
        if (!unlockRequiresCommission(other.unlock, commissionId)) continue;
        var downstream = gapClosingChain(other.commissionId, chapterId, baseline, gap, evidenceModule, input, depth + 1, chainSeen, allowedDownstream);
        if (downstream) return chain.concat(downstream);
      }
      return null;
    }

    /** 首选/次选单本身必须足以补当前章缺口，不能靠“下游也许会产证”放行。 */
    function usefulDirectCandidate(chapterId, commission, baseline, gap, evidenceModule, input) {
      if (!commission || !producesForChapter(commission, chapterId)) return false;
      return closesGap(chapterId, [commission], baseline, gap, evidenceModule, input);
    }

    /** 一般路线候选可带必要下游，但整条链必须真实减少当前章缺口。 */
    function usefulCandidate(chapterId, commission, baseline, gap, evidenceModule, input, allowedDownstream) {
      if (!commission) return false;
      if (!producesForChapter(commission, chapterId)) {
        var chain = gapClosingChain(commission.commissionId, chapterId, baseline, gap, evidenceModule, input, 0, Object.create(null), allowedDownstream);
        return !!chain;
      }
      return closesGap(chapterId, [commission], baseline, gap, evidenceModule, input);
    }

    /**
     * 只有“模拟本单真实 reward 后，当前章节旗标确实被授予”才是 milestone。
     * C1 直接复用 syncFlags 的入口 + 首条可达路线判定；C2–C4 把投影后的证据喂给
     * 真实 storyEvidence.storyFlags。本单 reward 无任何贡献时一律只标 step。
     */
    function candidateMilestone(chapterId, commission, projected, evidenceModule, input) {
      var flag = chapterFlagOf(chapterId);
      if (!flag || !commission || !producesForChapter(commission, chapterId)) return false;
      if (chapterId === 'C1') {
        var chapter = state.chapterIndex.C1;
        return !!chapter && evalRequirement(chapter.entry, projected) && !!firstMetRoute(chapter, projected);
      }
      var snapshot = storySnapshot(evidenceModule, input, projected.flags, projected.evidence);
      return !!snapshot && snapshot.flags.has(flag);
    }

    /** 从 missingFor 的真实缺口（证据 token / 旗标）反推能补缺口的真实委托。 */
    function alternativeCommissionIds(missing, ctx, chapterId) {
      var out = [];
      (missing || []).forEach(function (item) {
        if (!isObject(item)) return;
        var tokens = [];
        if (typeof item.token === 'string') tokens.push(item.token);
        if (typeof item.flag === 'string') tokens.push(item.flag);
        if (isArray(item.candidates)) tokens = tokens.concat(item.candidates);
        tokens.forEach(function (token) {
          if (typeof token !== 'string') return;
          var games = (state.evidenceProducers[token] || []).concat(state.flagProducers[token] || []);
          games.forEach(function (gameId) {
            state.commissions.forEach(function (commission) {
              if (commission.gameId !== gameId) return;
              if (commission.rewardEvidence.indexOf(token) < 0 && commission.rewardFlags.indexOf(token) < 0) return;
              out.push(commission.commissionId);
            });
          });
        });
      });
      var seen = Object.create(null);
      return out.filter(function (id) {
        var pass = !seen[id] && !ctx.cleared.has(id) && !!state.commissionIndex[id] && producesForChapter(state.commissionIndex[id], chapterId);
        if (!pass) return false;
        seen[id] = true;
        return true;
      });
    }

    function recommendationReason(chapterId, commission, isMilestone) {
      var chapter = state.chapterIndex[chapterId];
      var title = commission.title;
      var name = chapter ? chapter.title : chapterId;
      if (isMilestone) return '你愿意先接「' + title + '」吗？完成后「' + name + '」就能往前推进。';
      return '你愿意先做「' + title + '」吗？这样能把这一段需要的记录带回来。';
    }

    /**
     * 同步只读推荐：null 或 {commissionId, goal, reason, kind}。
     * availableIds 必须是调用方 commission.listAvailable 校验过的可接单 id；
     * 只从中挑未清、未锁、真实产证/真实前置的单。不写任何存储。
     */
    function recommend(input) {
      try {
        if (!state.configured || !state.chapterIndex.C1) return null;
        var options = isObject(input) ? input : {};
        var evidenceModule = recommendedEvidenceModule(options);
        if (!evidenceModule || !isFunction(evidenceModule.storyFlags)) return null;
        if (isFunction(evidenceModule.isConfigured) && evidenceModule.isConfigured() !== true) return null;

        var available = tokenArray(options.availableIds).filter(function (id) {
          return !!state.commissionIndex[id];
        });
        if (!available.length) return null;
        var availableSet = new Set(available);
        var ctx = resolveContext(options);
        var baseline = storySnapshot(evidenceModule, options, ctx.flags, ctx.evidence);
        if (!baseline) return null;
        var routeFlags = new Set(Array.from(ctx.flags).concat(Array.from(baseline.flags)));

        /* 让 campaign.state 看见 story-evidence 真实派生的旗标，避免阶段误判。 */
        var viewInput = Object.assign({}, options, {
          flags: Array.from(routeFlags),
          evidence: Array.from(ctx.evidence),
        });
        var view = stateFn(viewInput);
        if (!view.ok || !Array.isArray(view.chapters)) return null;
        var current = view.currentChapter;
        if (current === FINALE_CHAPTER || current === EPILOGUE_HANDOFF || !current) return null;

        var chapterOrder = current === 'C0' ? ['C1'] : [current];
        for (var c = 0; c < chapterOrder.length; c += 1) {
          var chapterId = chapterOrder[c];
          var chapter = state.chapterIndex[chapterId];
          if (!chapter) return null;
          var chapterView = view.chapters.filter(function (item) {
            return item.chapterId === chapterId;
          })[0];
          if (!chapterView || chapterView.state === 'complete' || chapterView.state === 'locked') return null;
          var flag = chapterFlagOf(chapterId);
          if (!flag || routeFlags.has(flag)) return null;

          var gapBase = {
            flags: routeFlags,
            evidence: new Set(Array.from(ctx.evidence)),
            cleared: ctx.cleared,
          };
          var gap = chapterId === 'C1'
            ? null
            : missingForChapter(evidenceModule, chapterId, gapBase.flags, gapBase.evidence);
          if (chapterId !== 'C1' && !gap) return null;
          var routeSpec = RECOMMEND_ROUTES.filter(function (item) {
            return item.chapterId === chapterId;
          })[0];
          var prefer = routeSpec ? routeSpec.prefer : [];
          var fallbacks = routeSpec ? routeSpec.alternatives : [];
          var candidates = [];
          var seenCandidates = Object.create(null);
          var preferIndex = Object.create(null);
          prefer.forEach(function (id) { preferIndex[id] = true; });

          function push(id, allowDownstream, routeOnly) {
            if (!id || seenCandidates[id]) return;
            var commission = state.commissionIndex[id];
            if (!commission || !commission.title) return;
            if (!availableSet.has(id) || ctx.cleared.has(id)) return;
            var direct = chapterId === 'C1'
              ? producesForChapter(commission, chapterId)
              : usefulDirectCandidate(chapterId, commission, gapBase, gap, evidenceModule, options);
            var useful = chapterId === 'C1'
              ? direct
              : (direct || (allowDownstream
                ? usefulCandidate(chapterId, commission, gapBase, gap, evidenceModule, options, routeOnly ? preferIndex : null)
                : false));
            if (!useful) return;
            seenCandidates[id] = true;
            candidates.push({
              id: id,
              direct: direct,
              milestone: candidateMilestone(chapterId, commission, projectedContext(ctx, commission), evidenceModule, options),
            });
          }

          function hasDirect() {
            return candidates.some(function (item) { return item.direct; });
          }
          prefer.forEach(function (id) {
            push(id, true, true);
          });
          if (!hasDirect()) {
            chapter.routes.forEach(function (route) {
              var leaves = collectRequirementTokens(route.requires, { flags: [], commissions: [], evidence: [] });
              leaves.commissions.forEach(function (id) {
                push(id, true);
              });
              leaves.evidence.forEach(function (token) {
                (state.evidenceProducers[token] || []).forEach(function (gameId) {
                  state.commissions.forEach(function (commission) {
                    if (commission.gameId === gameId && commission.rewardEvidence.indexOf(token) >= 0) {
                      push(commission.commissionId, true);
                    }
                  });
                });
              });
            });
          }
          if (!hasDirect()) {
            fallbacks.forEach(function (id) {
              push(id, true);
            });
          }
          /* 真实缺口派生候选始终检查：即使 prefer 里只有“先做前置”的步骤，
             只要当前可用单里有本单就能补缺口的委托，就不能推荐伪进展步骤。 */
          if (gap) {
            alternativeCommissionIds(gap.missing, ctx, chapterId).forEach(function (id) {
              push(id, true);
            });
          }
          if (!candidates.length) return null;

          var picked = candidates[0];
          var pickedCommission = state.commissionIndex[picked.id];
          return {
            commissionId: picked.id,
            goal: pickedCommission.title,
            reason: recommendationReason(chapterId, pickedCommission, picked.milestone),
            kind: picked.milestone ? 'milestone' : 'step',
          };
        }
        return null;
      } catch (err) {
        return null;
      }
    }

    /* ---------------- 只读诊断 ---------------- */

    function moduleSource() {
      try {
        return String(campaignFactory);
      } catch (err) {
        return '';
      }
    }

    function forbiddenSource() {
      return FORBIDDEN_SOURCE.map(function (pair) {
        return pair[0];
      });
    }

    function configuration() {
      return {
        configured: state.configured,
        contentVersion: state.contentVersion,
        chapterCount: state.chapters.length,
        endingCount: state.endings.length,
        commissionCount: state.commissions.length,
        origins: originsOf(),
        evidenceCount: state.evidence.size,
        evidenceConfigured: state.evidenceConfigured,
        signature: state.signature,
        version: MODULE_VERSION,
        settings: clone(settings) || {},
      };
    }

    var api = {
      VERSION: VERSION,
      MODULE_VERSION: MODULE_VERSION,
      CONTENT_VERSION: CONTENT_VERSION,
      SCHEMA_VERSION: SCHEMA_VERSION,
      CHAPTER_IDS: CHAPTER_IDS.slice(),
      CHAPTER_FLAGS: Object.assign({}, CHAPTER_FLAGS),
      SYNCABLE_FLAGS: SYNCABLE_FLAGS.slice(),
      ENDING_APPROACHES: ENDING_APPROACHES.slice(),
      REQUIREMENT_KEYS: REQUIREMENT_KEYS.slice(),
      MIN_ROUTES: Object.assign({}, MIN_ROUTES),
      REASONS: REASONS,
      __campaignMounted: true,
      configure: configure,
      reset: reset,
      isConfigured: function () {
        return state.configured === true;
      },
      state: stateFn,
      recommend: recommend,
      routeRequirementsMet: routeRequirementsMet,
      contextFrom: contextFrom,
      syncFlags: syncFlags,
      endingOptions: endingOptions,
      epilogueFor: epilogueFor,
      validate: validate,
      configuration: configuration,
      moduleSource: moduleSource,
      forbiddenSource: forbiddenSource,
    };
    return api;
  }

  /**
   * 路线要求是否满足（AND across keys / OR inside lists；支持嵌套 all/any）。
   * route 可以是内容里的路线对象（{routeId, requires}）、终局对象（{approach, entry}）
   * 或直接的要求对象（{anyFlags:[...]}）。
   */
  function routeRequirementsMet(route, ctxInput) {
    try {
      if (!isObject(route)) return false;
      var req = null;
      if (isRequirementObject(route.requires)) req = route.requires;
      else if (isRequirementObject(route.entry)) req = route.entry;
      else req = route;
      if (!isRequirementObject(req)) return false;
      var ctx = resolveContext(ctxInput);
      return evalRequirement(req, ctx);
    } catch (err) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ *
   * 默认单例（浏览器全局 ArcadeCareerCampaign / ArcadeCareer.campaign；
   * Node module.exports）
   * ------------------------------------------------------------------ */

  var singleton = createCampaign({});
  singleton.createCampaign = createCampaign;
  singleton.routeRequirementsMet = routeRequirementsMet;
  return singleton;
});
