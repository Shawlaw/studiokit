/*!
 * StudioKit Arcade Life — 五类材料目录 / 固定价差 / 双来源约束（0.17，D17-19）
 *
 * 纯 UMD 逻辑模块：浏览器挂 window.ArcadeCareerMaterials，并按 bridge.js 的
 * DEPENDENCIES 约定镜像到 window.ArcadeCareer.materials（global: 'materials'）；
 * Node 中 module.exports 返回同一 API，供确定性测试 require()。
 *
 * 职责边界（docs/arcade-life/ADR-interfaces.md §19.5 / §19.7）：
 * - 五材目录与固定买卖价（45/22、80/38、65/30、100/48、55/25）读自
 *   content/items.json，并与 ADR 冻结价表逐项核对；价格漂移即结构化失败
 *   （价格只能来自内容，UI/市场不得自报价格）；
 * - crystal 只是 0.16 遗留别名：查询、库存读取、买卖计划入参统一映射到
 *   starcrystal，绝不新增第 6 材，也不改写内容；
 * - sellPlan/buyPlan 是纯计划：只校验材料白名单、数量、库存、余额与
 *   career-core.RULESET 上限，返回结果交给 career-db 的 sellItems/purchase
 *   在事务内执行；本模块不写库、不写任何存储、买→卖绝不产生正余额差；
 * - 来源 = 96 委托 reward.items 的 gameId 统计 ∪ 0.16 已知掉落来源（内置常量）；
 *   assertTwoSources 要求五材每项 ≥2 个可重复来源，不足只报错误列表，绝不编造；
 * - 制造（craftCost / craftPlan）不在本模块：留给 career/crafting.js
 *   （ADR §19.1 / §19.5），本模块只提供它需要的 getMaterial/priceOf。
 *
 * 边界（不得越界）：
 * - 无 DOM、无 IndexedDB、无网络、无定时器、无文件系统；不 require 任何模块、
 *   不依赖时钟或随机数，输出只由输入内容决定（同输入同输出）；
 * - 所有公开方法捕获异常并返回结构化结果，绝不向调用方抛；
 * - configure 失败保留上一次成功状态（坏内容不会清空可用价目）；
 * - 未 configure 时 listMaterials()=[]、getMaterial/priceOf=null、计划返回
 *   reason='not-configured'，normalizeItemId 仍按内置别名工作。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory();
    return;
  }
  var api = factory();
  root.ArcadeCareerMaterials = api;
  /* bridge.js 的统一依赖装载约定：模块镜像到 window.ArcadeCareer.<global>，
     DEPENDENCIES 里 materials.js 的 global 为 materials。 */
  var career = root.ArcadeCareer;
  if (!career || typeof career !== 'object') career = root.ArcadeCareer = {};
  if (career.materials !== api) {
    try {
      career.materials = api;
    } catch (err) {
      /* 只读宿主：忽略 */
    }
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 常量（ADR §19.5 冻结内容）
   * ------------------------------------------------------------------ */

  var MODULE_VERSION = '0.18.0';
  var SCHEMA_VERSION = 1;

  /* 五材固定顺序（也是 listMaterials 的返回顺序；内容集合必须与之一致）。 */
  var MATERIAL_IDS = Object.freeze(['building', 'alloy', 'electronics', 'starcrystal', 'biomass']);

  /* ADR §19.5 冻结中文名（内容缺名时报错，内容改名只警告不失败）。 */
  var MATERIAL_NAMES = Object.freeze({
    building: '建材',
    alloy: '合金',
    electronics: '电子元件',
    starcrystal: '星晶',
    biomass: '生物材料',
  });

  /* ADR §19.5 冻结价表（买/卖）；content/items.json 必须逐项一致，否则 configure 失败。 */
  var PRICE_TABLE = Object.freeze({
    building: Object.freeze({ buy: 45, sell: 22 }),
    alloy: Object.freeze({ buy: 80, sell: 38 }),
    electronics: Object.freeze({ buy: 65, sell: 30 }),
    starcrystal: Object.freeze({ buy: 100, sell: 48 }),
    biomass: Object.freeze({ buy: 55, sell: 25 }),
  });

  /* 卖价 ≤ 买价 × 0.6：禁止无损/正利润往返（ADR §19.5）。 */
  var SELL_PRICE_RATIO_MAX = 0.6;

  /* 每个材料的可重复来源下限。 */
  var MIN_SOURCES = 2;
  var EXPECTED_COMMISSION_COUNT = 96;

  /* 0.16 遗留别名：只在查询时映射，不新增第 6 材（ADR §19.5 / §19.7）。 */
  var DEFAULT_ALIASES = Object.freeze({ crystal: 'starcrystal' });

  /* 0.16 已知掉落来源（内置映射；gameId 必须真实存在，排序只为稳定输出）。 */
  var KNOWN_DROPS = Object.freeze({
    building: Object.freeze(['brick-breaker', 'pendulum-tower']),
    alloy: Object.freeze(['brick-breaker', 'gold-miner', 'star-raid']),
    electronics: Object.freeze(['block-drop', 'road-rush']),
    starcrystal: Object.freeze(['gold-miner', 'star-raid']),
    biomass: Object.freeze(['snake-run', 'snowbells']),
  });

  /* 与 career-core.RULESET 同步的只读镜像（工具测试逐项防漂移）。 */
  var RULESET_MIRROR = Object.freeze({
    payoutCap: 400,
    itemCapPerItem: 99,
    itemKindsCap: 8,
    inventoryStackCap: 999,
    balanceCap: 1000000,
    maxPurchaseCost: 1000000,
  });

  /* 结构化原因码；与 career-core / career-db 的既有原因字符串对齐。 */
  var REASONS = Object.freeze({
    notConfigured: 'not-configured',
    contentMissing: 'content-missing',
    contentInvalid: 'content-invalid',
    badItems: 'bad-items',
    badCount: 'bad-count',
    unknownItem: 'unknown-item',
    duplicateItem: 'duplicate-item',
    itemKindsCap: 'item-kinds-cap',
    walletUnavailable: 'wallet-unavailable',
    insufficient: 'insufficient',
    insufficientItems: 'insufficient-items',
    itemCap: 'item-cap',
    balanceCap: 'balance-cap',
    payoutCap: 'payout-cap',
    costCap: 'cost-cap',
    priceRatio: 'price-ratio',
  });

  /* materialId / gameId 都是 kebab-case slug；token 形状与 career-core 一致。 */
  var MATERIAL_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
  var GAME_ID_RE = /^[a-z][a-z0-9-]{0,61}$/;
  var TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

  /* ------------------------------------------------------------------ *
   * 小工具
   * ------------------------------------------------------------------ */

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isFiniteInt(value) {
    return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function isCanonicalId(value) {
    return typeof value === 'string' && MATERIAL_IDS.indexOf(value) >= 0;
  }

  function nonNegInt(value, fallback) {
    var num = typeof value === 'number' ? value : Number(value);
    if (!isFinite(num) || num < 0) return fallback;
    return Math.floor(num);
  }

  function cloneCounts(source) {
    var out = {};
    Object.keys(source).forEach(function (key) {
      out[key] = source[key];
    });
    return out;
  }

  function copyMaterial(entry) {
    return {
      itemId: entry.itemId,
      name: entry.name,
      buyPrice: entry.buyPrice,
      sellPrice: entry.sellPrice,
      aliases: entry.aliases.slice(),
      sources: entry.sources.slice(),
    };
  }

  /* ------------------------------------------------------------------ *
   * 状态（configure 成功才会替换；失败保留旧状态）
   * ------------------------------------------------------------------ */

  function emptyState() {
    return {
      configured: false,
      contentVersion: null,
      materials: [],
      byId: {},
      aliasMap: {},
      commissionCount: 0,
      warnings: [],
    };
  }

  var state = emptyState();

  /* ------------------------------------------------------------------ *
   * 目录查询
   * ------------------------------------------------------------------ */

  /**
   * 查询期别名归一：crystal → starcrystal（configure 前也按内置别名工作）。
   * @param {*} id
   * @returns {string|null} 五材规范 id；未知/非字符串返回 null
   */
  function normalizeItemId(id) {
    if (typeof id !== 'string' || !id) return null;
    if (isCanonicalId(id)) return id;
    if (hasOwn(state.aliasMap, id) && isCanonicalId(state.aliasMap[id])) return state.aliasMap[id];
    if (hasOwn(DEFAULT_ALIASES, id) && isCanonicalId(DEFAULT_ALIASES[id])) return DEFAULT_ALIASES[id];
    return null;
  }

  /**
   * 五材目录（固定顺序、别名只在 aliases 字段出现，不新增第 6 材）。
   * @returns {Array<{itemId:string,name:string,buyPrice:number,sellPrice:number,aliases:string[],sources:string[]}>}
   */
  function listMaterials() {
    if (!state.configured) return [];
    return state.materials.map(copyMaterial);
  }

  /**
   * @param {*} id materialId 或 0.16 别名（crystal）
   * @returns {object|null} 材料条目副本；未 configure 或未知返回 null
   */
  function getMaterial(id) {
    var canonical = normalizeItemId(id);
    if (!canonical || !state.configured) return null;
    var entry = state.byId[canonical];
    return entry ? copyMaterial(entry) : null;
  }

  /**
   * @param {*} id materialId 或别名
   * @param {string} [side] 'buy'（缺省）| 'sell'
   * @returns {number|null} 整数价格；未知 id / 非法 side / 未 configure 返回 null
   */
  function priceOf(id, side) {
    var canonical = normalizeItemId(id);
    if (!canonical || !state.configured) return null;
    var entry = state.byId[canonical];
    if (!entry) return null;
    var kind = side === undefined || side === null ? 'buy' : String(side);
    if (kind === 'buy') return entry.buyPrice;
    if (kind === 'sell') return entry.sellPrice;
    return null;
  }

  /**
   * 来源游戏列表（96 委托 reward.items ∪ 0.16 已知掉落，去重排序）。
   * @param {*} materialId
   * @returns {string[]} 未知/未 configure 返回空数组
   */
  function sourcesFor(materialId) {
    var canonical = normalizeItemId(materialId);
    if (!canonical || !state.configured) return [];
    var entry = state.byId[canonical];
    return entry ? entry.sources.slice() : [];
  }

  function isConfigured() {
    return state.configured === true;
  }

  function status() {
    return {
      moduleVersion: MODULE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      configured: state.configured,
      contentVersion: state.contentVersion,
      materialCount: state.materials.length,
      aliasCount: Object.keys(state.aliasMap).length,
      commissionCount: state.commissionCount,
      warnings: state.warnings.slice(),
    };
  }

  /* ------------------------------------------------------------------ *
   * configure：内容装载 + 校验 + 来源统计（非法内容只进 errors/warnings，绝不抛）
   * ------------------------------------------------------------------ */

  /**
   * @param {{items?:object, commissions?:object, knownDrops?:object}} input
   *   items        content/items.json 已解析对象（必需；五材 + materialAliases）
   *   commissions  content/commissions.json 已解析对象（可选；缺省只统计已知掉落）
   *   knownDrops   0.16 已知掉落映射注入缝（测试/未来内容用；缺省用内置 KNOWN_DROPS）
   * @returns {{ok:boolean, reason?:string, materialCount:number, contentVersion:string|null,
   *            aliasCount?:number, commissionCount?:number, sourceCounts?:object,
   *            errors?:string[], warnings:string[]}}
   */
  function configure(input) {
    var options = isObject(input) ? input : {};
    var rawItems = options.items;
    var rawCommissions = options.commissions;
    var errors = [];
    var warnings = [];

    /* ---- 1. items.json 结构 ---- */
    if (!isObject(rawItems)) {
      return {
        ok: false,
        reason: REASONS.contentMissing,
        materialCount: 0,
        contentVersion: null,
        errors: ['content-missing:items'],
        warnings: warnings,
      };
    }
    var contentVersion = typeof rawItems.contentVersion === 'string' ? rawItems.contentVersion : null;
    var rawMaterials = rawItems.materials;
    if (!Array.isArray(rawMaterials)) {
      return {
        ok: false,
        reason: REASONS.contentMissing,
        materialCount: 0,
        contentVersion: contentVersion,
        errors: ['content-missing:materials'],
        warnings: warnings,
      };
    }

    /* ---- 2. 五材：id 白名单 / 名称 / 整数价格 / 冻结价表 / 价差守卫 ---- */
    if (rawMaterials.length !== MATERIAL_IDS.length) {
      errors.push('material-count:' + rawMaterials.length);
    }
    var parsed = {};
    for (var i = 0; i < rawMaterials.length; i += 1) {
      var raw = rawMaterials[i];
      if (!isObject(raw)) {
        errors.push('material-invalid:index-' + i);
        continue;
      }
      var itemId = raw.itemId;
      if (typeof itemId !== 'string' || !MATERIAL_ID_RE.test(itemId)) {
        errors.push('material-id:index-' + i);
        continue;
      }
      if (!isCanonicalId(itemId)) {
        /* 未知材料一律拒绝：不允许第 6 材，也不允许把别名写成材料条目。 */
        errors.push('material-unknown:' + itemId);
        continue;
      }
      if (hasOwn(parsed, itemId)) {
        errors.push('material-duplicate:' + itemId);
        continue;
      }
      var buyPrice = raw.buyPrice;
      var sellPrice = raw.sellPrice;
      if (!isFiniteInt(buyPrice) || buyPrice <= 0 || !isFiniteInt(sellPrice) || sellPrice < 0) {
        errors.push('material-price:' + itemId);
        continue;
      }
      var frozen = PRICE_TABLE[itemId];
      if (buyPrice !== frozen.buy || sellPrice !== frozen.sell) {
        errors.push('price-table-drift:' + itemId + ':' + buyPrice + '/' + sellPrice);
      }
      if (!(sellPrice <= buyPrice * SELL_PRICE_RATIO_MAX)) {
        errors.push('price-ratio:' + itemId);
      }
      var name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '';
      if (!name) {
        errors.push('material-name:' + itemId);
        continue;
      }
      if (name !== MATERIAL_NAMES[itemId]) warnings.push('material-name-drift:' + itemId);
      parsed[itemId] = {
        itemId: itemId,
        name: name,
        buyPrice: buyPrice,
        sellPrice: sellPrice,
      };
    }
    var missingMaterials = MATERIAL_IDS.filter(function (id) {
      return !hasOwn(parsed, id);
    });
    if (missingMaterials.length) errors.push('material-missing:' + missingMaterials.join('|'));

    /* ---- 3. 别名：crystal→starcrystal 冻结；别名键不得是材料 id ---- */
    var aliasMap = {};
    Object.keys(DEFAULT_ALIASES).forEach(function (key) {
      aliasMap[key] = DEFAULT_ALIASES[key];
    });
    if (rawItems.materialAliases !== undefined) {
      if (!isObject(rawItems.materialAliases)) {
        errors.push('alias-invalid:materialAliases');
      } else {
        Object.keys(rawItems.materialAliases).forEach(function (key) {
          var target = rawItems.materialAliases[key];
          if (!TOKEN_RE.test(key)) {
            errors.push('alias-invalid:' + key);
            return;
          }
          if (isCanonicalId(key)) {
            /* 别名键不能复用材料 id，否则会与真实库存混淆。 */
            errors.push('alias-conflict:' + key);
            return;
          }
          if (typeof target !== 'string' || !isCanonicalId(target)) {
            errors.push('alias-target:' + key);
            return;
          }
          if (key === 'crystal' && target !== 'starcrystal') {
            /* 0.16 数据兼容依赖这条映射，内容不得改写。 */
            errors.push('alias-forbidden:' + key);
            return;
          }
          aliasMap[key] = target;
        });
      }
    } else {
      warnings.push('alias-missing');
    }

    /* ---- 4. 96 委托 reward.items → 来源游戏统计 ---- */
    var commissionCount = 0;
    var commissionSources = {};
    if (rawCommissions === undefined || rawCommissions === null) {
      warnings.push('commissions-missing');
    } else if (!isObject(rawCommissions) || !Array.isArray(rawCommissions.commissions)) {
      errors.push('commissions-invalid');
    } else {
      commissionCount = rawCommissions.commissions.length;
      if (commissionCount !== EXPECTED_COMMISSION_COUNT) {
        warnings.push('commission-count:' + commissionCount);
      }
      for (var c = 0; c < rawCommissions.commissions.length; c += 1) {
        var commission = rawCommissions.commissions[c];
        if (!isObject(commission)) {
          warnings.push('commission-invalid:index-' + c);
          continue;
        }
        var reward = isObject(commission.reward) ? commission.reward : null;
        if (!reward || reward.items === undefined) continue;
        if (!isObject(reward.items)) {
          warnings.push('reward-items-invalid:' + String(commission.commissionId || 'index-' + c));
          continue;
        }
        var gameId = commission.gameId;
        var gameOk = typeof gameId === 'string' && GAME_ID_RE.test(gameId);
        var rewardKeys = Object.keys(reward.items);
        for (var r = 0; r < rewardKeys.length; r += 1) {
          var rewardKey = rewardKeys[r];
          var canonical = isCanonicalId(rewardKey)
            ? rewardKey
            : hasOwn(aliasMap, rewardKey)
              ? aliasMap[rewardKey]
              : null;
          if (!canonical) {
            /* 非白名单物品绝不成为来源（含未来新增物品种类）。 */
            warnings.push('unknown-reward-item:' + rewardKey);
            continue;
          }
          var rewardCount = reward.items[rewardKey];
          if (!isFiniteInt(rewardCount) || rewardCount <= 0) {
            warnings.push('reward-count:' + rewardKey);
            continue;
          }
          if (!gameOk) {
            warnings.push('reward-game:' + String(commission.commissionId || 'index-' + c));
            continue;
          }
          if (!hasOwn(commissionSources, canonical)) commissionSources[canonical] = {};
          commissionSources[canonical][gameId] = true;
        }
      }
    }

    /* ---- 5. 0.16 已知掉落来源（缺省内置；注入时整体替换） ---- */
    var knownDropsSource = options.knownDrops === undefined ? KNOWN_DROPS : options.knownDrops;
    var knownDrops = {};
    if (!isObject(knownDropsSource)) {
      errors.push('known-drops-invalid');
    } else {
      Object.keys(knownDropsSource).forEach(function (key) {
        var canonical = isCanonicalId(key)
          ? key
          : hasOwn(aliasMap, key)
            ? aliasMap[key]
            : null;
        if (!canonical) {
          errors.push('known-drops-entry:' + key);
          return;
        }
        var list = knownDropsSource[key];
        if (!Array.isArray(list)) {
          errors.push('known-drops-entry:' + canonical);
          return;
        }
        var games = {};
        for (var g = 0; g < list.length; g += 1) {
          if (typeof list[g] === 'string' && GAME_ID_RE.test(list[g])) games[list[g]] = true;
        }
        knownDrops[canonical] = Object.keys(games);
      });
    }

    /* ---- 6. 有错误则结构化失败，且不清空上一次成功状态 ---- */
    if (errors.length) {
      return {
        ok: false,
        reason: REASONS.contentInvalid,
        materialCount: Object.keys(parsed).length,
        contentVersion: contentVersion,
        errors: errors,
        warnings: warnings,
      };
    }

    /* ---- 7. 提交新状态 ---- */
    var nextById = {};
    var nextMaterials = MATERIAL_IDS.map(function (id) {
      var entry = parsed[id];
      var sourceSet = {};
      var fromCommissions = commissionSources[id] || {};
      Object.keys(fromCommissions).forEach(function (gameId) {
        sourceSet[gameId] = true;
      });
      var fromDrops = knownDrops[id] || [];
      for (var d = 0; d < fromDrops.length; d += 1) sourceSet[fromDrops[d]] = true;
      var aliases = Object.keys(aliasMap)
        .filter(function (alias) {
          return aliasMap[alias] === id;
        })
        .sort();
      var built = {
        itemId: id,
        name: entry.name,
        buyPrice: entry.buyPrice,
        sellPrice: entry.sellPrice,
        aliases: aliases,
        sources: Object.keys(sourceSet).sort(),
      };
      nextById[id] = built;
      return built;
    });

    state = {
      configured: true,
      contentVersion: contentVersion,
      materials: nextMaterials,
      byId: nextById,
      aliasMap: aliasMap,
      commissionCount: commissionCount,
      warnings: warnings.slice(),
    };

    var sourceCounts = {};
    nextMaterials.forEach(function (entry) {
      sourceCounts[entry.itemId] = entry.sources.length;
    });
    return {
      ok: true,
      materialCount: nextMaterials.length,
      contentVersion: contentVersion,
      aliasCount: Object.keys(aliasMap).length,
      commissionCount: commissionCount,
      sourceCounts: sourceCounts,
      warnings: warnings.slice(),
    };
  }

  /* ------------------------------------------------------------------ *
   * 计划公共部分
   * ------------------------------------------------------------------ */

  /**
   * 校验计划入参 {items}：只允许五材白名单、正整数数量、别名归一、无重复规范 id。
   * @returns {{ok:true, items:object, order:string[]}|{ok:false, reason:string, itemId?:string, unknownItems?:string[]}}
   */
  function normalizeRequest(rawItems) {
    if (!isObject(rawItems)) return { ok: false, reason: REASONS.badItems };
    var keys = Object.keys(rawItems);
    if (!keys.length) return { ok: false, reason: REASONS.badItems };
    if (keys.length > RULESET_MIRROR.itemKindsCap) return { ok: false, reason: REASONS.itemKindsCap };
    var items = {};
    var order = [];
    var unknown = [];
    for (var i = 0; i < keys.length; i += 1) {
      var rawId = keys[i];
      var canonical = normalizeItemId(rawId);
      var count = rawItems[rawId];
      if (!canonical) {
        unknown.push(String(rawId));
        continue;
      }
      if (!isFiniteInt(count) || count <= 0 || count > RULESET_MIRROR.itemCapPerItem) {
        return { ok: false, reason: REASONS.badCount, itemId: canonical };
      }
      if (hasOwn(items, canonical)) {
        /* crystal 与 starcrystal 同时出现不静默合并，直接拒绝。 */
        return { ok: false, reason: REASONS.duplicateItem, itemId: canonical };
      }
      items[canonical] = count;
      order.push(canonical);
    }
    if (unknown.length) {
      return { ok: false, reason: REASONS.unknownItem, unknownItems: unknown.sort() };
    }
    return { ok: true, items: items, order: order };
  }

  /** @returns {{ok:true, credits:number, items:object}|{ok:false}} */
  function readWallet(wallet) {
    if (!isObject(wallet)) return { ok: false };
    var credits = wallet.credits;
    if (!isFiniteInt(credits) || credits < 0) return { ok: false };
    if (credits > RULESET_MIRROR.balanceCap) return { ok: false };
    return { ok: true, credits: credits, items: isObject(wallet.items) ? wallet.items : {} };
  }

  /** 库存读取走别名归一（0.16 的 crystal 行与 starcrystal 行合并计数）。 */
  function readInventory(rawItems) {
    var out = {};
    var source = isObject(rawItems) ? rawItems : {};
    Object.keys(source).forEach(function (key) {
      var canonical = normalizeItemId(key);
      if (!canonical) return;
      var count = nonNegInt(source[key], 0);
      if (count <= 0) return;
      out[canonical] = (out[canonical] || 0) + count;
    });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * sellPlan：卖材料（db.sellItems 之前的纯计划）
   * ------------------------------------------------------------------ */

  /**
   * @param {{items?:object, wallet?:{credits:number, items?:object}}} input
   * @returns {{ok:boolean, reason?:string, items:object, unitPrices:object, credits:number,
   *            balanceAfter:number, missing:Array, warnings:string[]}}
   *   失败时 items/unitPrices/credits 为诊断值，balanceAfter 为当前余额（未成交）。
   */
  function sellPlan(input) {
    var options = isObject(input) ? input : {};
    var result = {
      ok: false,
      reason: '',
      items: {},
      unitPrices: {},
      credits: 0,
      balanceAfter: 0,
      missing: [],
      warnings: [],
    };
    if (!state.configured) {
      result.reason = REASONS.notConfigured;
      return result;
    }
    var normalized = normalizeRequest(options.items);
    if (!normalized.ok) {
      result.reason = normalized.reason;
      if (normalized.itemId) result.itemId = normalized.itemId;
      if (normalized.unknownItems) result.unknownItems = normalized.unknownItems;
      return result;
    }
    var order = normalized.order;
    var requested = normalized.items;
    result.items = cloneCounts(requested);

    /* 单位卖价 + 价差二次守卫（configure 已拒绝漂移内容）。 */
    var credits = 0;
    for (var i = 0; i < order.length; i += 1) {
      var itemId = order[i];
      var entry = state.byId[itemId];
      if (!entry || !(entry.sellPrice <= entry.buyPrice * SELL_PRICE_RATIO_MAX)) {
        result.reason = REASONS.priceRatio;
        result.itemId = itemId;
        return result;
      }
      result.unitPrices[itemId] = entry.sellPrice;
      credits += requested[itemId] * entry.sellPrice;
    }
    result.credits = credits;

    var wallet = readWallet(options.wallet);
    if (!wallet.ok) {
      result.reason = REASONS.walletUnavailable;
      return result;
    }
    result.balanceAfter = wallet.credits;

    var owned = readInventory(wallet.items);
    var missing = [];
    for (var m = 0; m < order.length; m += 1) {
      var want = requested[order[m]];
      var have = owned[order[m]] || 0;
      if (have < want) missing.push({ kind: 'items', itemId: order[m], need: want, have: have });
    }
    if (missing.length) {
      result.reason = REASONS.insufficientItems;
      result.missing = missing;
      return result;
    }
    if (credits <= 0) {
      result.reason = REASONS.badItems;
      return result;
    }
    if (credits > RULESET_MIRROR.payoutCap) {
      /* career-db.sellItems 的 credits 上限（payoutCap）；UI 需拆单。 */
      result.reason = REASONS.payoutCap;
      return result;
    }
    var balanceAfter = wallet.credits + credits;
    if (balanceAfter > RULESET_MIRROR.balanceCap) {
      result.reason = REASONS.balanceCap;
      return result;
    }
    result.ok = true;
    result.balanceAfter = balanceAfter;
    return result;
  }

  /* ------------------------------------------------------------------ *
   * buyPlan：买材料（db.purchase 之前的纯计划）
   * ------------------------------------------------------------------ */

  /**
   * @param {{items?:object, wallet?:{credits:number, items?:object}}} input
   * @returns {{ok:boolean, reason?:string, items:object, unitPrices:object, cost:number,
   *            creditsDelta:number, balanceAfter:number, grants:object,
   *            missing:Array, warnings:string[]}}
   *   可直接把 {cost, grants} 交给 career-db.purchase。
   */
  function buyPlan(input) {
    var options = isObject(input) ? input : {};
    var result = {
      ok: false,
      reason: '',
      items: {},
      unitPrices: {},
      cost: 0,
      creditsDelta: 0,
      balanceAfter: 0,
      grants: {},
      missing: [],
      warnings: [],
    };
    if (!state.configured) {
      result.reason = REASONS.notConfigured;
      return result;
    }
    var normalized = normalizeRequest(options.items);
    if (!normalized.ok) {
      result.reason = normalized.reason;
      if (normalized.itemId) result.itemId = normalized.itemId;
      if (normalized.unknownItems) result.unknownItems = normalized.unknownItems;
      return result;
    }
    var order = normalized.order;
    var requested = normalized.items;
    result.items = cloneCounts(requested);

    var cost = 0;
    for (var i = 0; i < order.length; i += 1) {
      var entry = state.byId[order[i]];
      if (!entry) {
        result.reason = REASONS.notConfigured;
        return result;
      }
      result.unitPrices[order[i]] = entry.buyPrice;
      cost += requested[order[i]] * entry.buyPrice;
    }
    result.cost = cost;
    result.creditsDelta = -cost;

    var wallet = readWallet(options.wallet);
    if (!wallet.ok) {
      result.reason = REASONS.walletUnavailable;
      return result;
    }
    result.balanceAfter = wallet.credits;

    if (cost <= 0 || cost > RULESET_MIRROR.maxPurchaseCost) {
      result.reason = cost <= 0 ? REASONS.badItems : REASONS.costCap;
      return result;
    }
    if (wallet.credits < cost) {
      result.reason = REASONS.insufficient;
      result.missing = [{ kind: 'credits', itemId: null, need: cost, have: wallet.credits }];
      return result;
    }
    var owned = readInventory(wallet.items);
    var stackMissing = [];
    for (var m = 0; m < order.length; m += 1) {
      var itemId = order[m];
      var have = owned[itemId] || 0;
      var after = have + requested[itemId];
      if (after > RULESET_MIRROR.inventoryStackCap) {
        stackMissing.push({
          kind: 'stack',
          itemId: itemId,
          need: after,
          have: have,
          cap: RULESET_MIRROR.inventoryStackCap,
        });
      }
    }
    if (stackMissing.length) {
      result.reason = REASONS.itemCap;
      result.missing = stackMissing;
      return result;
    }
    result.ok = true;
    result.balanceAfter = wallet.credits - cost;
    result.grants = { items: cloneCounts(requested) };
    return result;
  }

  /* ------------------------------------------------------------------ *
   * 双来源 / 往返校验
   * ------------------------------------------------------------------ */

  /**
   * @returns {{ok:boolean, reason?:string, required:number,
   *            materials:Array<{itemId:string,count:number,sources:string[]}>,
   *            errors:string[]}}
   */
  function assertTwoSources() {
    if (!state.configured) {
      return { ok: false, reason: REASONS.notConfigured, required: MIN_SOURCES, materials: [], errors: [] };
    }
    var materials = [];
    var errors = [];
    state.materials.forEach(function (entry) {
      var sources = entry.sources.slice();
      materials.push({ itemId: entry.itemId, count: sources.length, sources: sources });
      if (sources.length < MIN_SOURCES) {
        errors.push('insufficient-sources:' + entry.itemId + ':' + sources.length);
      }
    });
    return {
      ok: errors.length === 0,
      required: MIN_SOURCES,
      materials: materials,
      errors: errors,
    };
  }

  /**
   * 买→卖不得正利润，且卖价 ≤ 买价 × 0.6。
   * @returns {{ok:boolean, reason?:string, maxRatio:number,
   *            materials:Array<{itemId:string,buyPrice:number,sellPrice:number,roundTripProfit:number,ratio:number}>,
   *            errors:string[]}}
   */
  function validateTradeRoundTrip() {
    if (!state.configured) {
      return { ok: false, reason: REASONS.notConfigured, maxRatio: 0, materials: [], errors: [] };
    }
    var materials = [];
    var errors = [];
    var maxRatio = 0;
    state.materials.forEach(function (entry) {
      var buy = entry.buyPrice;
      var sell = entry.sellPrice;
      var profit = sell - buy;
      var ratio = buy > 0 ? sell / buy : 1;
      if (ratio > maxRatio) maxRatio = ratio;
      materials.push({
        itemId: entry.itemId,
        buyPrice: buy,
        sellPrice: sell,
        roundTripProfit: profit,
        ratio: ratio,
      });
      if (!(sell <= buy * SELL_PRICE_RATIO_MAX)) errors.push('price-ratio:' + entry.itemId);
      if (profit > 0) errors.push('positive-profit:' + entry.itemId);
    });
    return {
      ok: errors.length === 0,
      maxRatio: maxRatio,
      materials: materials,
      errors: errors,
    };
  }

  /* ------------------------------------------------------------------ *
   * 测试缝：reset 只清空本模块状态，不触碰任何宿主存储
   * ------------------------------------------------------------------ */

  function reset() {
    state = emptyState();
    return { ok: true };
  }

  /* ------------------------------------------------------------------ *
   * 公开 API
   * ------------------------------------------------------------------ */

  return {
    MODULE_VERSION: MODULE_VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
    MATERIAL_IDS: MATERIAL_IDS,
    MATERIAL_NAMES: MATERIAL_NAMES,
    PRICE_TABLE: PRICE_TABLE,
    SELL_PRICE_RATIO_MAX: SELL_PRICE_RATIO_MAX,
    MIN_SOURCES: MIN_SOURCES,
    EXPECTED_COMMISSION_COUNT: EXPECTED_COMMISSION_COUNT,
    DEFAULT_ALIASES: DEFAULT_ALIASES,
    KNOWN_DROPS: KNOWN_DROPS,
    RULESET_MIRROR: RULESET_MIRROR,
    REASONS: REASONS,

    configure: configure,
    reset: reset,
    status: status,
    isConfigured: isConfigured,

    normalizeItemId: normalizeItemId,
    listMaterials: listMaterials,
    getMaterial: getMaterial,
    priceOf: priceOf,
    sourcesFor: sourcesFor,

    sellPlan: sellPlan,
    buyPlan: buyPlan,
    assertTwoSources: assertTwoSources,
    validateTradeRoundTrip: validateTradeRoundTrip,
  };
});
