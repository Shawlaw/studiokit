/*!
 * StudioKit Arcade Life — 非战斗「代办」路径（0.16，D16-10）
 *
 * 纯 UMD 逻辑模块：浏览器挂 window.ArcadeCareerAlternatives，并按 bridge.js 的
 * DEPENDENCIES 约定镜像到 window.ArcadeCareer.alternatives（global: 'alternatives'）；
 * Node 中 module.exports 返回同一 API，供确定性测试 require()。
 *
 * 不发起网络请求、不读写浏览器存储、不触碰 DOM；只经调用方注入（或宿主默认）的
 * career-db 公开方法持久化，测试可注入内存假实现。
 *
 * 职责（docs/arcade-life/ADR-interfaces.md §6 / §18.1 / §18.4）：
 * - 明码标价的代办清单：configure({content?}) 载入内容（缺省用内置两条默认 offer），
 *   listOffers({careerId}) 只读钱包/任务/装备后给出 affordabe/missing/alreadyDone/unlocked；
 * - buy({careerId, offerId})：先只读判断「是否已完成 / 余额与材料是否足够」，再由
 *   db.purchase 原子扣费（事务内失败即零写入），成功后用一次 db.putQuests 写两行：
 *   kind:'alternative'（nodeId = offerId）与 kind:'story'（nodeId = offer.flags[0]）；
 * - 幂等：已完成的 offer 直接返回 duplicate 且不再扣费；db.purchase 的 purchaseId
 *   （alt:<careerId>:<offerId>）幂等兜底；扣费成功而任务行写入失败时返回
 *   quest-write-failed，并明确提示「钱已扣、旗标未记」，绝不静默成功；
 * - 没有真实时间等待：offer 内容禁止 wait/cooldown/deadline 字段，buy 立即完成。
 *
 * 边界（不得越界）：
 * - 只做「扣费 + 记旗标/证据」，不发放信用点、材料、装备，也不产生任何战斗奖章；
 * - 只写 kind:'alternative' / kind:'story' 两行；绝不写委托类任务行；
 * - 不写任何战斗路线专属旗标（清单见 FORBIDDEN_FLAGS，内容含之即整体拒收）；
 * - 不调用任何领奖/结算接口；购买流水只由 db.purchase 在自己的事务内写入；
 * - 不创建生涯（没有 ensure 路径）、不写发现状态；所有跨表写入都由 career-db 负责；
 * - 所有公开方法捕获异常并返回结构化结果，绝不向调用方抛。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory(root, true);
    return;
  }
  var api = factory(root, false);
  root.ArcadeCareerAlternatives = api;
  var career = root.ArcadeCareer;
  if (!career || typeof career !== 'object') career = root.ArcadeCareer = {};
  if (career.alternatives !== api) {
    try {
      career.alternatives = api;
    } catch (err) {
      /* 只读宿主：忽略 */
    }
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root, isNode) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 常量
   * ------------------------------------------------------------------ */

  var VERSION = '0.17.0';
  var MODULE_VERSION = '0.17.0';
  var CONTENT_VERSION = '0.17.0';
  var SCHEMA_VERSION = 1;

  var OFFER_KIND = 'alternative';
  var STORY_KIND = 'story';

  var MAX_TITLE = 80;
  var MAX_SUMMARY = 240;
  var MAX_ISSUER = 80;

  /* 与 career-core.RULESET 同步的只读镜像（测试防漂移）。 */
  var RULESET_MIRROR = Object.freeze({
    maxPurchaseCost: 1000000,
    itemCapPerItem: 99,
    itemKindsCap: 8,
    evidenceCap: 24,
    flagsCap: 24,
  });

  var ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
  var TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

  /* 明码标价、无真实时间等待：出现这些字段的内容一律拒绝（含嵌套）。 */
  var TIMING_KEYS = Object.freeze(['wait', 'cooldown', 'deadline']);

  /* 战斗路线专属旗标：代办只能给 C1 代办旗标，绝不能伪造战斗进度。 */
  var FORBIDDEN_FLAGS = Object.freeze(['C1.work_done', 'C1.flight_done', 'C1.storm_done']);

  var REASONS = Object.freeze({
    coreUnavailable: 'core-unavailable',
    dbUnavailable: 'db-unavailable',
    badCareerId: 'bad-career-id',
    missingOffer: 'missing-offer',
    questReadFailed: 'quest-read-failed',
    walletUnavailable: 'wallet-unavailable',
    noWallet: 'no-wallet',
    insufficientCredits: 'insufficient-credits',
    insufficientItems: 'insufficient-items',
    purchaseFailed: 'purchase-failed',
    questWriteFailed: 'quest-write-failed',
    locked: 'locked',
    contentInvalid: 'content-invalid',
    exception: 'exception',
  });

  /**
   * 内置默认内容：内容自包含、明码标价、无材料/材料都写清楚，授予代办旗标与证据。
   * 价格与旗标是冻结契约（测试逐项断言）；不得出现 wait/cooldown/deadline。
   */
  var DEFAULT_CONTENT = Object.freeze({
    contentVersion: CONTENT_VERSION,
    offers: Object.freeze([
      Object.freeze({
        offerId: 'alt.courier',
        title: '港务处的跑腿单',
        summary: '替港务处跑一趟，把一只信号匣从码头取回来。',
        issuer: '旧港港务处',
        cost: Object.freeze({ credits: 120 }),
        flags: Object.freeze(['C1.signal']),
        evidence: Object.freeze(['E-C1-courier']),
      }),
      Object.freeze({
        offerId: 'alt.records',
        title: '档案室的旧航路',
        summary: '回旧港档案室，把那份航路记录抄出来。',
        issuer: '旧港档案室',
        cost: Object.freeze({ credits: 90, items: Object.freeze({ alloy: 1 }) }),
        flags: Object.freeze(['C1.records']),
        evidence: Object.freeze(['E-C1-records']),
      }),
    ]),
  });

  /* ------------------------------------------------------------------ *
   * 基础工具（纯函数）
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

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function toInt(value, fallback) {
    var num = Number(value);
    if (!Number.isFinite(num)) return typeof fallback === 'number' ? fallback : 0;
    return Math.floor(num);
  }

  function clone(value) {
    if (value === undefined) return undefined;
    try {
      var text = JSON.stringify(value);
      return typeof text === 'string' ? JSON.parse(text) : null;
    } catch (err) {
      return null;
    }
  }

  function errorText(err) {
    return err && err.message ? String(err.message).slice(0, 160) : 'exception';
  }

  function trimText(value, max) {
    if (typeof value !== 'string') return '';
    var text = value.trim();
    if (max && text.length > max) return text.slice(0, max);
    return text;
  }

  /**
   * 递归检查 wait / cooldown / deadline（最多 4 层、512 个节点）。
   * 内容里出现「真实时间等待」直接判为非法；节点数异常同样按可疑拒绝（fail-closed）。
   */
  function hasTimingKey(value) {
    var pending = [{ value: value, depth: 0 }];
    var visited = 0;
    var seen = [];
    while (pending.length) {
      visited += 1;
      if (visited > 512) return true;
      var item = pending.pop();
      var current = item.value;
      if (!current || typeof current !== 'object') continue;
      /* JSON 内容不可能带循环引用；出现重复对象按可疑内容拒绝（fail-closed）。 */
      if (seen.indexOf(current) >= 0) return true;
      seen.push(current);
      if (item.depth >= 4) continue;
      var keys = Object.keys(current);
      for (var i = 0; i < keys.length; i += 1) {
        var key = keys[i];
        if (TIMING_KEYS.indexOf(String(key).toLowerCase()) >= 0) return true;
        pending.push({ value: current[key], depth: item.depth + 1 });
      }
    }
    return false;
  }

  function normalizeTokenList(raw, cap) {
    if (!Array.isArray(raw)) return null;
    var out = [];
    for (var i = 0; i < raw.length; i += 1) {
      var value = raw[i];
      if (typeof value !== 'string' || !TOKEN_RE.test(value)) return null;
      if (out.indexOf(value) >= 0) continue;
      if (out.length >= cap) return null;
      out.push(value);
    }
    return out;
  }

  function sanitizedTokenList(raw) {
    var list = normalizeTokenList(raw, RULESET_MIRROR.evidenceCap);
    return list || [];
  }

  function hasForbiddenFlag(list) {
    for (var i = 0; i < list.length; i += 1) {
      if (FORBIDDEN_FLAGS.indexOf(list[i]) >= 0) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * 内容规范化（非法内容只进 errors，绝不抛）
   * ------------------------------------------------------------------ */

  function normalizeCost(raw, errors, offerId) {
    if (!isObject(raw)) {
      errors.push('bad-cost:' + offerId);
      return null;
    }
    var credits = raw.credits;
    if (!isFiniteNumber(credits) || Math.floor(credits) !== credits || credits <= 0 || credits > RULESET_MIRROR.maxPurchaseCost) {
      errors.push('bad-cost:' + offerId);
      return null;
    }
    var items = {};
    if (raw.items !== undefined) {
      if (!isObject(raw.items)) {
        errors.push('bad-cost-items:' + offerId);
        return null;
      }
      var ids = Object.keys(raw.items);
      if (ids.length > RULESET_MIRROR.itemKindsCap) {
        errors.push('bad-cost-items:' + offerId);
        return null;
      }
      for (var i = 0; i < ids.length; i += 1) {
        var itemId = ids[i];
        var count = raw.items[itemId];
        if (!TOKEN_RE.test(itemId) || !isFiniteNumber(count) || Math.floor(count) !== count || count <= 0 || count > RULESET_MIRROR.itemCapPerItem) {
          errors.push('bad-cost-items:' + offerId);
          return null;
        }
        items[itemId] = count;
      }
    }
    return { credits: credits, items: items };
  }

  /**
   * requires 目前只支持 { flags: [token...] }：全部旗标已具备才算 unlocked。
   * 形状非法时整条 offer 丢弃（fail-closed，避免错误地提前解锁）。
   */
  function normalizeRequires(raw, errors, offerId) {
    if (raw === undefined || raw === null) return { flags: [] };
    if (!isObject(raw)) {
      errors.push('bad-requires:' + offerId);
      return null;
    }
    var flags = normalizeTokenList(raw.flags === undefined ? [] : raw.flags, RULESET_MIRROR.flagsCap);
    if (!flags) {
      errors.push('bad-requires:' + offerId);
      return null;
    }
    return { flags: flags };
  }

  function normalizeOffer(raw, errors, warnings) {
    if (!isObject(raw)) {
      errors.push('offer-invalid');
      return null;
    }
    var offerId = typeof raw.offerId === 'string' ? raw.offerId.trim() : '';
    if (!ID_RE.test(offerId)) {
      errors.push('bad-offer-id:' + (offerId || 'unnamed'));
      return null;
    }
    if (hasTimingKey(raw)) {
      errors.push('timed-offer:' + offerId);
      return null;
    }
    var title = trimText(raw.title, MAX_TITLE);
    if (!title) {
      errors.push('bad-title:' + offerId);
      return null;
    }
    var summary = trimText(raw.summary, MAX_SUMMARY);
    if (!summary) {
      errors.push('bad-summary:' + offerId);
      return null;
    }
    var issuer = trimText(raw.issuer, MAX_ISSUER);
    if (!issuer) {
      errors.push('bad-issuer:' + offerId);
      return null;
    }
    var cost = normalizeCost(raw.cost, errors, offerId);
    if (!cost) return null;
    var flags = normalizeTokenList(raw.flags, RULESET_MIRROR.flagsCap);
    if (!flags || flags.length === 0) {
      errors.push('bad-flags:' + offerId);
      return null;
    }
    var evidence = normalizeTokenList(raw.evidence, RULESET_MIRROR.evidenceCap);
    if (!evidence || evidence.length === 0) {
      errors.push('bad-evidence:' + offerId);
      return null;
    }
    if (hasForbiddenFlag(flags) || hasForbiddenFlag(evidence)) {
      errors.push('forbidden-combat-flag:' + offerId);
      return null;
    }
    if (flags.indexOf(offerId) >= 0) {
      errors.push('offer-node-collision:' + offerId);
      return null;
    }
    var requires = normalizeRequires(raw.requires, errors, offerId);
    if (!requires) return null;
    return {
      offerId: offerId,
      title: title,
      summary: summary,
      issuer: issuer,
      cost: cost,
      flags: flags,
      evidence: evidence,
      requires: requires,
    };
  }

  function normalizeOfferList(rawList) {
    var errors = [];
    var warnings = [];
    var offers = [];
    var seen = Object.create(null);
    for (var i = 0; i < rawList.length; i += 1) {
      var offer = normalizeOffer(rawList[i], errors, warnings);
      if (!offer) continue;
      if (seen[offer.offerId]) {
        errors.push('duplicate-offer:' + offer.offerId);
        continue;
      }
      seen[offer.offerId] = true;
      offers.push(offer);
    }
    return { offers: offers, errors: errors, warnings: warnings };
  }

  function parseContent(raw) {
    if (Array.isArray(raw)) {
      return { ok: true, list: raw, contentVersion: CONTENT_VERSION, source: 'content' };
    }
    if (isObject(raw) && Array.isArray(raw.offers)) {
      var version = typeof raw.contentVersion === 'string' && raw.contentVersion.trim() ? raw.contentVersion.trim() : CONTENT_VERSION;
      return { ok: true, list: raw.offers, contentVersion: version, source: 'content' };
    }
    return { ok: false, reason: REASONS.contentInvalid };
  }

  /* ------------------------------------------------------------------ *
   * 纯计算：差额 / 可负担 / 任务行 flags / 故事节点
   * ------------------------------------------------------------------ */

  function computeMissing(cost, credits, items) {
    var needCredits = toInt(cost && cost.credits, 0);
    var haveCredits = Math.max(0, toInt(credits, 0));
    var creditsGap = needCredits > haveCredits ? needCredits - haveCredits : 0;
    var missing = { credits: creditsGap, items: {} };
    var needItems = isObject(cost && cost.items) ? cost.items : {};
    var walletItems = isObject(items) ? items : {};
    Object.keys(needItems).forEach(function (itemId) {
      var need = Math.max(0, toInt(needItems[itemId], 0));
      var have = Math.max(0, toInt(walletItems[itemId], 0));
      if (need > have) missing.items[itemId] = need - have;
    });
    return missing;
  }

  function isAffordable(missing) {
    return missing.credits === 0 && Object.keys(missing.items).length === 0;
  }

  function questRowsOf(questState) {
    if (!isObject(questState)) return [];
    if (Array.isArray(questState.quests)) return questState.quests;
    if (isObject(questState.byNode)) {
      return Object.keys(questState.byNode).map(function (key) {
        return questState.byNode[key];
      });
    }
    return [];
  }

  function flagsFromQuests(questState) {
    var map = Object.create(null);
    var rows = questRowsOf(questState);
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      if (!isObject(row) || !Array.isArray(row.flags)) continue;
      for (var j = 0; j < row.flags.length; j += 1) {
        var flag = row.flags[j];
        if (typeof flag === 'string' && TOKEN_RE.test(flag)) map[flag] = true;
      }
    }
    return map;
  }

  function isOfferCleared(questState, offerId) {
    var rows = questRowsOf(questState);
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      if (!isObject(row)) continue;
      if (row.nodeId === offerId && row.status === 'cleared') return true;
    }
    return false;
  }

  function isUnlocked(offer, flagMap) {
    var need = offer && offer.requires && Array.isArray(offer.requires.flags) ? offer.requires.flags : [];
    for (var i = 0; i < need.length; i += 1) {
      if (flagMap[need[i]] !== true) return false;
    }
    return true;
  }

  /**
   * 一个玩家动作写两行任务：代办行（nodeId=offerId）+ 故事行（nodeId=首个旗标）。
   * 字段形状与 career-db.putQuests 的规范化一致：nodeId 为 token，其余字段原样保留，
   * careerId/schemaVersion/updatedAt 也会被 putQuests 再覆写一次（幂等）。
   */
  function buildQuestRows(careerId, offer, at) {
    var flags = offer.flags.slice();
    var evidence = offer.evidence.slice();
    var storyNodeId = flags[0];
    return [
      {
        careerId: careerId,
        nodeId: offer.offerId,
        kind: OFFER_KIND,
        status: 'cleared',
        clearedAt: at,
        evidence: evidence.slice(),
        flags: flags.slice(),
        updatedAt: at,
        schemaVersion: SCHEMA_VERSION,
      },
      {
        careerId: careerId,
        nodeId: storyNodeId,
        kind: STORY_KIND,
        status: 'cleared',
        clearedAt: at,
        evidence: evidence.slice(),
        flags: flags.slice(),
        updatedAt: at,
        schemaVersion: SCHEMA_VERSION,
      },
    ];
  }

  /* ------------------------------------------------------------------ *
   * 工厂
   * ------------------------------------------------------------------ */

  function createAlternatives(options) {
    var opts = isObject(options) ? options : {};

    var injectedDb = opts.db || null;
    var injectedCore = opts.core || null;
    /* storage 注入缝保留但不使用：本模块没有会话/本地存储写入（测试会断言零调用）。 */
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
      offers: [],
      contentVersion: CONTENT_VERSION,
      errors: [],
      warnings: [],
      source: 'default',
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

    /* ---------------- 内容目录 ---------------- */

    function offerIdsOf() {
      return state.offers.map(function (offer) {
        return offer.offerId;
      });
    }

    function catalogResult(ok, source) {
      return {
        ok: ok,
        contentVersion: state.contentVersion,
        count: state.offers.length,
        offerIds: offerIdsOf(),
        errors: state.errors.slice(),
        warnings: state.warnings.slice(),
        source: source || state.source,
      };
    }

    function setCatalog(content, sourceOverride) {
      var parsed = parseContent(content);
      if (!parsed.ok) {
        return {
          ok: false,
          contentVersion: state.contentVersion,
          count: state.offers.length,
          offerIds: offerIdsOf(),
          errors: [REASONS.contentInvalid],
          warnings: [],
          source: state.source,
          unchanged: true,
        };
      }
      var normalized = normalizeOfferList(parsed.list);
      var errors = normalized.errors.slice();
      if (!normalized.offers.length) errors.push(parsed.list.length ? 'no-valid-offers' : 'offers-empty');
      state.offers = normalized.offers;
      state.contentVersion = parsed.contentVersion;
      state.errors = errors;
      state.warnings = normalized.warnings;
      state.source = sourceOverride || parsed.source;
      return catalogResult(errors.length === 0 && state.offers.length > 0);
    }

    function configure(input) {
      try {
        var raw;
        var usingDefault = false;
        if (input === undefined || input === null) {
          raw = DEFAULT_CONTENT;
          usingDefault = true;
        } else if (Array.isArray(input)) {
          raw = input;
        } else if (isObject(input)) {
          if (hasOwn(input, 'content')) {
            if (input.content === undefined || input.content === null) {
              raw = DEFAULT_CONTENT;
              usingDefault = true;
            } else {
              raw = input.content;
            }
          } else if (hasOwn(input, 'offers') || hasOwn(input, 'contentVersion')) raw = input;
          else if (Object.keys(input).length === 0) {
            raw = DEFAULT_CONTENT;
            usingDefault = true;
          } else raw = input;
        } else {
          raw = input;
        }
        return setCatalog(raw, usingDefault ? 'default' : null);
      } catch (err) {
        return {
          ok: false,
          contentVersion: state.contentVersion,
          count: state.offers.length,
          offerIds: offerIdsOf(),
          errors: [REASONS.exception],
          warnings: [],
          source: state.source,
          error: errorText(err),
        };
      }
    }

    function findOffer(offerId) {
      if (typeof offerId !== 'string' || !offerId) return null;
      for (var i = 0; i < state.offers.length; i += 1) {
        if (state.offers[i].offerId === offerId) return clone(state.offers[i]);
      }
      return null;
    }

    function getOffer(offerId) {
      return findOffer(offerId);
    }

    function getState() {
      return {
        version: VERSION,
        contentVersion: state.contentVersion,
        source: state.source,
        count: state.offers.length,
        offerIds: offerIdsOf(),
        errors: state.errors.slice(),
        warnings: state.warnings.slice(),
      };
    }

    function getContentVersion() {
      return state.contentVersion;
    }

    /* ---------------- 只读 DB 适配 ---------------- */

    function readQuests(careerId) {
      try {
        var db = resolveDb();
        if (!db || !isFunction(db.readQuestState)) return Promise.resolve(null);
        return Promise.resolve(db.readQuestState(careerId)).then(
          function (result) {
            return result && result.ok === true ? result : null;
          },
          function () {
            return null;
          },
        );
      } catch (err) {
        return Promise.resolve(null);
      }
    }

    function readWallet(careerId) {
      var fallback = { ok: false, reason: REASONS.walletUnavailable, exists: false, credits: 0, items: {} };
      try {
        var db = resolveDb();
        if (!db || !isFunction(db.readWallet)) return Promise.resolve(fallback);
        return Promise.resolve(db.readWallet(careerId)).then(
          function (wallet) {
            if (!wallet || wallet.ok !== true) {
              return { ok: false, reason: wallet && typeof wallet.reason === 'string' ? wallet.reason : REASONS.walletUnavailable, exists: false, credits: 0, items: {} };
            }
            return {
              ok: true,
              exists: wallet.exists !== false,
              credits: Math.max(0, toInt(wallet.credits, 0)),
              items: isObject(wallet.items) ? wallet.items : {},
            };
          },
          function () {
            return fallback;
          },
        );
      } catch (err) {
        return Promise.resolve(fallback);
      }
    }

    /** listOffers 只读装备：目前仅用于告知调用方装备目录是否可用，绝不影响扣费。 */
    function readEquipment(careerId) {
      try {
        var db = resolveDb();
        if (!db || !isFunction(db.getEquipment)) return Promise.resolve(null);
        return Promise.resolve(db.getEquipment(careerId)).then(
          function (result) {
            return result && result.ok === true ? result : null;
          },
          function () {
            return null;
          },
        );
      } catch (err) {
        return Promise.resolve(null);
      }
    }

    /** 幂等兜底探测：不依赖读库就能判断的购买流水是否存在（DB 不支持时返回 null）。 */
    function probePurchase(db, careerId, purchaseId) {
      try {
        if (!db || !isFunction(db.readLedger)) return Promise.resolve(null);
        return Promise.resolve(db.readLedger(careerId, 100)).then(
          function (ledger) {
            if (!ledger || ledger.ok !== true || !Array.isArray(ledger.rows)) return null;
            var txId = 'purchase:' + purchaseId;
            for (var i = 0; i < ledger.rows.length; i += 1) {
              var row = ledger.rows[i];
              if (isObject(row) && row.txId === txId) return true;
            }
            return false;
          },
          function () {
            return null;
          },
        );
      } catch (err) {
        return Promise.resolve(null);
      }
    }

    function guardAsync(value, fallback) {
      try {
        return Promise.resolve(value).catch(function () {
          return fallback;
        });
      } catch (err) {
        return Promise.resolve(fallback);
      }
    }

    /* ---------------- listOffers ---------------- */

    async function listOffersSafe(input) {
      var opts = isObject(input) ? input : {};
      var core = resolveCore();
      var db = resolveDb();
      if (!core) return { ok: false, reason: REASONS.coreUnavailable, careerId: null, offers: [] };
      if (!db) return { ok: false, reason: REASONS.dbUnavailable, careerId: null, offers: [] };
      var careerId = core.isValidCareerId(opts.careerId) ? opts.careerId : null;
      var wallet = { ok: false, reason: 'no-career', exists: false, credits: 0, items: {} };
      var questState = null;
      var equipment = null;
      if (careerId) {
        var walletRead = await readWallet(careerId);
        if (walletRead && walletRead.ok) wallet = walletRead;
        questState = await readQuests(careerId);
        equipment = await readEquipment(careerId);
      }
      var warnings = [];
      if (careerId && !wallet.ok) warnings.push('wallet-unavailable');
      if (careerId && !questState) warnings.push('quest-read-failed');
      var flagMap = flagsFromQuests(questState);
      var offers = state.offers.map(function (offer) {
        var missing = computeMissing(offer.cost, wallet.credits, wallet.items);
        return {
          offerId: offer.offerId,
          title: offer.title,
          summary: offer.summary,
          cost: clone(offer.cost),
          affordable: isAffordable(missing),
          missing: missing,
          alreadyDone: questState ? isOfferCleared(questState, offer.offerId) : false,
          unlocked: isUnlocked(offer, flagMap),
        };
      });
      return {
        ok: true,
        careerId: careerId,
        offers: offers,
        contentVersion: state.contentVersion,
        walletAvailable: !!(careerId && wallet.ok && wallet.exists),
        questsAvailable: !!questState,
        equipmentAvailable: !!equipment,
        warnings: warnings,
      };
    }

    function listOffers(input) {
      return guardAsync(listOffersSafe(input), { ok: false, reason: REASONS.exception, careerId: null, offers: [] });
    }

    /* ---------------- buy ---------------- */

    function purchaseFailureShape(reason, extra) {
      var out = { ok: false, reason: reason, charged: false };
      if (extra) {
        Object.keys(extra).forEach(function (key) {
          out[key] = extra[key];
        });
      }
      return out;
    }

    async function purchaseFailure(careerId, purchase, offer, previousMissing) {
      var dbReason = purchase && typeof purchase.reason === 'string' ? purchase.reason : 'unknown';
      var reason = REASONS.purchaseFailed;
      if (dbReason === 'insufficient') reason = REASONS.insufficientCredits;
      else if (dbReason === 'insufficient-items') reason = REASONS.insufficientItems;
      else if (dbReason === 'no-wallet') reason = REASONS.noWallet;
      else if (dbReason === 'bad-cost') reason = 'bad-cost';
      else if (dbReason === 'bad-purchase-id') reason = 'bad-purchase-id';
      else if (dbReason === 'bad-career-id') reason = REASONS.badCareerId;
      else if (dbReason === 'core-unavailable') reason = REASONS.coreUnavailable;
      var missing = previousMissing;
      if (reason === REASONS.insufficientCredits || reason === REASONS.insufficientItems || reason === REASONS.noWallet) {
        var latest = await readWallet(careerId);
        missing = latest && latest.ok ? computeMissing(offer.cost, latest.credits, latest.items) : computeMissing(offer.cost, 0, {});
        /* 竞态：DB 判定失败但重读钱包已经够付（例如另一标签页刚补款）。此时不谎报「差多少」，
           保留 DB 的原始 reason，只提示这次没有成交。 */
        if (isAffordable(missing)) reason = REASONS.purchaseFailed;
      }
      return purchaseFailureShape(reason, {
        offerId: offer.offerId,
        cost: clone(offer.cost),
        missing: missing || null,
        dbReason: dbReason,
        retryable: reason === REASONS.insufficientCredits || reason === REASONS.insufficientItems || reason === REASONS.purchaseFailed,
      });
    }

    async function buySafe(input) {
      var opts = isObject(input) ? input : {};
      var core = resolveCore();
      var db = resolveDb();
      if (!core) return purchaseFailureShape(REASONS.coreUnavailable);
      if (!db || !isFunction(db.purchase) || !isFunction(db.putQuests)) return purchaseFailureShape(REASONS.dbUnavailable);
      var careerId = opts.careerId;
      if (!core.isValidCareerId(careerId)) return purchaseFailureShape(REASONS.badCareerId, { careerId: typeof careerId === 'string' ? careerId : null });
      var offer = findOffer(opts.offerId);
      if (!offer) return purchaseFailureShape(REASONS.missingOffer, { offerId: typeof opts.offerId === 'string' ? opts.offerId : null });
      var purchaseId = 'alt:' + careerId + ':' + offer.offerId;
      if (purchaseId.length > 120) {
        return purchaseFailureShape('bad-purchase-id', { offerId: offer.offerId, retryable: false });
      }

      /* 1) 只读判断：已完成则直接 duplicate（不调用 purchase、不扣费）。 */
      var questState = await readQuests(careerId);
      if (!questState) return purchaseFailureShape(REASONS.questReadFailed, { offerId: offer.offerId, retryable: true });
      if (isOfferCleared(questState, offer.offerId)) {
        return {
          ok: true,
          duplicate: true,
          alreadyDone: true,
          offerId: offer.offerId,
          cost: clone(offer.cost),
          flags: offer.flags.slice(),
          evidence: offer.evidence.slice(),
          charged: false,
          message: '这单代办已经办完，不会重复扣费。',
        };
      }
      /* 前置旗标未齐：拒绝购买，避免绕过解锁条件（与 listOffers.unlocked 同一判定）。 */
      var flagMap = flagsFromQuests(questState);
      var missingFlags = [];
      var needFlags = offer.requires && Array.isArray(offer.requires.flags) ? offer.requires.flags : [];
      for (var i = 0; i < needFlags.length; i += 1) {
        if (flagMap[needFlags[i]] !== true) missingFlags.push(needFlags[i]);
      }
      if (missingFlags.length) {
        return purchaseFailureShape(REASONS.locked, {
          offerId: offer.offerId,
          cost: clone(offer.cost),
          missingFlags: missingFlags,
          retryable: true,
        });
      }

      /* 2) 只读判断：钱包缺失 / 余额与材料不足（差额要能解释给玩家）。 */
      var wallet = await readWallet(careerId);
      if (!wallet.ok) {
        return purchaseFailureShape(REASONS.walletUnavailable, { offerId: offer.offerId, dbReason: wallet.reason, retryable: true });
      }
      if (!wallet.exists) {
        return purchaseFailureShape(REASONS.noWallet, {
          offerId: offer.offerId,
          cost: clone(offer.cost),
          missing: computeMissing(offer.cost, 0, {}),
          retryable: true,
        });
      }
      var missing = computeMissing(offer.cost, wallet.credits, wallet.items);
      if (!isAffordable(missing)) {
        var prior = await probePurchase(db, careerId, purchaseId);
        if (prior === false) {
          return purchaseFailureShape(missing.credits > 0 ? REASONS.insufficientCredits : REASONS.insufficientItems, {
            offerId: offer.offerId,
            cost: clone(offer.cost),
            missing: missing,
            retryable: true,
          });
        }
        /* prior === true：此前已扣费（例如上次任务行写入失败），走 purchase 的幂等收据补记；
           prior === null：读不到流水（DB 无 readLedger），交给原子 purchase 判定，失败仍零写入。 */
      }

      /* 3) 最终由 DB 原子判定：余额/材料/幂等都在同一事务内。 */
      var purchase;
      try {
        purchase = await db.purchase({
          careerId: careerId,
          purchaseId: purchaseId,
          cost: offer.cost.credits,
          costItems: offer.cost.items ? clone(offer.cost.items) : {},
          grants: {},
        });
      } catch (err) {
        return purchaseFailureShape(REASONS.purchaseFailed, { offerId: offer.offerId, detail: errorText(err), retryable: true });
      }
      if (!purchase || purchase.ok !== true) {
        return purchaseFailure(careerId, purchase, offer, missing);
      }

      /* 4) 扣费成功后写两行任务；同一 putQuests 调用 = 同一逻辑动作（单事务）。 */
      var clearedAt = nowIso();
      var rows = buildQuestRows(careerId, offer, clearedAt);
      var written = null;
      try {
        written = await db.putQuests(careerId, rows);
      } catch (err) {
        written = { ok: false, reason: 'exception', error: errorText(err) };
      }
      if (!written || written.ok !== true) {
        return {
          ok: false,
          reason: REASONS.questWriteFailed,
          offerId: offer.offerId,
          cost: clone(offer.cost),
          flags: offer.flags.slice(),
          evidence: offer.evidence.slice(),
          charged: true,
          duplicate: purchase.duplicate === true,
          purchaseId: purchaseId,
          receipt: isObject(purchase.receipt) ? purchase.receipt : null,
          dbReason: written && typeof written.reason === 'string' ? written.reason : 'unknown',
          message: '钱已扣、旗标未记；请重试同一代办以补记。',
          retryable: true,
        };
      }

      var duplicate = purchase.duplicate === true;
      return {
        ok: true,
        offerId: offer.offerId,
        cost: clone(offer.cost),
        flags: offer.flags.slice(),
        evidence: offer.evidence.slice(),
        duplicate: duplicate,
        alreadyDone: false,
        repaired: duplicate,
        charged: duplicate === false,
        clearedAt: clearedAt,
        purchaseId: purchaseId,
        questRows: rows.length,
        receipt: isObject(purchase.receipt) ? purchase.receipt : null,
        message: duplicate ? '这单先前已经付过费用，本次只补记旗标，不会再扣一次。' : '代办已完成。',
      };
    }

    function buy(input) {
      return guardAsync(buySafe(input), { ok: false, reason: REASONS.exception, charged: false });
    }

    /* ---------------- hasFlag / listCompleted ---------------- */

    async function hasFlagSafe(careerId, flag) {
      var core = resolveCore();
      if (!core || !core.isValidCareerId(careerId)) return false;
      if (typeof flag !== 'string' || !TOKEN_RE.test(flag)) return false;
      var questState = await readQuests(careerId);
      if (questState && flagsFromQuests(questState)[flag] === true) return true;
      var db = resolveDb();
      if (db && isFunction(db.getProfile)) {
        try {
          var profile = await db.getProfile(careerId);
          if (isObject(profile) && Array.isArray(profile.flags)) {
            for (var i = 0; i < profile.flags.length; i += 1) {
              if (profile.flags[i] === flag) return true;
            }
          }
        } catch (err) {
          /* 读不到个人档时只看任务行 */
        }
      }
      return false;
    }

    function hasFlag(careerId, flag) {
      return guardAsync(hasFlagSafe(careerId, flag), false);
    }

    async function listCompletedSafe(careerId) {
      var core = resolveCore();
      var db = resolveDb();
      if (!core) return { ok: false, reason: REASONS.coreUnavailable, careerId: null, completed: [] };
      if (!db) return { ok: false, reason: REASONS.dbUnavailable, careerId: null, completed: [] };
      if (!core.isValidCareerId(careerId)) return { ok: false, reason: REASONS.badCareerId, careerId: null, completed: [] };
      var questState = await readQuests(careerId);
      if (!questState) return { ok: false, reason: REASONS.questReadFailed, careerId: careerId, completed: [] };
      var completed = [];
      var rows = questRowsOf(questState);
      for (var i = 0; i < rows.length; i += 1) {
        var row = rows[i];
        if (!isObject(row) || row.kind !== OFFER_KIND || row.status !== 'cleared') continue;
        if (typeof row.nodeId !== 'string' || !ID_RE.test(row.nodeId)) continue;
        var offer = findOffer(row.nodeId);
        completed.push({
          offerId: row.nodeId,
          title: offer ? offer.title : '',
          clearedAt: typeof row.clearedAt === 'string' ? row.clearedAt : typeof row.updatedAt === 'string' ? row.updatedAt : null,
          evidence: sanitizedTokenList(row.evidence),
          flags: sanitizedTokenList(row.flags),
        });
      }
      return { ok: true, careerId: careerId, completed: completed };
    }

    function listCompleted(careerId) {
      return guardAsync(listCompletedSafe(careerId), { ok: false, reason: REASONS.exception, careerId: null, completed: [] });
    }

    /* ---------------- 初始化默认内容 + 导出 ---------------- */

    setCatalog(DEFAULT_CONTENT, 'default');

    var api = {
      VERSION: VERSION,
      MODULE_VERSION: MODULE_VERSION,
      CONTENT_VERSION: CONTENT_VERSION,
      SCHEMA_VERSION: SCHEMA_VERSION,
      OFFER_KIND: OFFER_KIND,
      STORY_KIND: STORY_KIND,
      RULESET_MIRROR: RULESET_MIRROR,
      REASONS: REASONS,
      __alternativesMounted: true,
      configure: configure,
      getOffer: getOffer,
      getState: getState,
      getContentVersion: getContentVersion,
      listOffers: listOffers,
      buy: buy,
      hasFlag: hasFlag,
      listCompleted: listCompleted,
    };
    return api;
  }

  /* ------------------------------------------------------------------ *
   * 默认单例（浏览器 window.ArcadeCareerAlternatives / Node module.exports）
   * ------------------------------------------------------------------ */

  var singleton = createAlternatives({});
  singleton.createAlternatives = createAlternatives;
  return singleton;
});
