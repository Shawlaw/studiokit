/*!
 * StudioKit Arcade Life — 制造计划（0.17，D17-21）
 *
 * 纯 UMD 逻辑模块：浏览器挂 window.ArcadeCareerCrafting，并按 bridge.js 的
 * LAZY_MODULES 约定镜像到 window.ArcadeCareer.crafting（global: 'crafting'）；
 * Node 中 module.exports 返回同一 API，供确定性测试 require()。
 *
 * 职责（docs/arcade-life/ADR-interfaces.md §19.1 / §19.5）：
 * - configure({items})：读取 content/items.json 的 modules/levels（材料价目只来自内容），
 *   返回 {ok, moduleCount, levelCount, contentVersion, errors}；非法内容不抛异常；
 * - listRecipes([equipment])：把「模块 × 等级」摊平成制造配方，含成本、材料、效果与拥有状态；
 * - plan({moduleId, level?, equipment, wallet})：纯计算一次制造的成本/材料/差额/装备授权，
 *   已拥有返回 {ok:true, owned:true, noop:true}（幂等）；价格与材料只来自内容；
 * - applyPlan({plan, careerId, now?, contentVersion?})：**不写库**，只把已确认可付的计划
 *   组装成 career-db 的 db.purchase 请求（purchaseId: craft:<careerId>:<moduleId>:<level>）；
 *   真正的原子制造由 UI 交给 db.purchase 完成；
 * - MODULE_EFFECTS：与内容模块 id 对齐的模块效果常量（phase-shield / cargo-magnet /
 *   energy-cell）。items.json 不在本任务写入区，因此「战斗参数」以本常量发布；
 *   内容若显式提供 modules[].effectStats 或 levels[].stats，则内容优先（见 evidence DEVIATIONS）。
 *
 * 边界（不得越界）：
 * - 无 DOM、无 IndexedDB、无 localStorage、无 fetch/XHR/网络；所有方法纯函数或只读缓存；
 * - 不创建生涯、不扣费、不写账本、不写装备；任何异常都转成结构化结果，绝不向调用方抛；
 * - 不发明价格/材料：成本、材料、名称、效果文案只来自 configure() 注入的内容；
 * - 不写旧机库 studiokit:arcade:meta:v1；不改经典/挑战/割草数值。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory(root, true);
    return;
  }
  var api = factory(root, false);
  root.ArcadeCareerCrafting = api;
  /* bridge 的统一依赖装载约定：镜像到 window.ArcadeCareer.crafting。 */
  var career = root.ArcadeCareer;
  if (!career || typeof career !== 'object') career = root.ArcadeCareer = {};
  if (career.crafting !== api) {
    try {
      career.crafting = api;
    } catch (err) {
      /* 只读宿主：忽略 */
    }
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root, isNode) {
  'use strict';

  const VERSION = '0.18.0';
  const CONTENT_VERSION_FALLBACK = '0.18.0';

  /* career-core.RULESET 的只读镜像：仅用于价目合法性与测试防漂移。 */
  const RULESET_MIRROR = Object.freeze({
    maxPurchaseCost: 1000000,
    itemCapPerItem: 99,
  });

  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
  const CAREER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

  /* 模块效果契约（与 content/items.json 的 modules[].moduleId 对齐）。
   * 只放「经典四模块之外的战斗参数」：hull/power/engine/energy 的每级增量由
   * star-combat-config 的 BUILTIN_MODULE_DELTAS 负责，这里重复会导致重复叠加。
   * 字段含义：
   *   shieldOnce   每次生涯出击最多触发一次短护盾（布尔，不是数值叠加）；
   *   magnet       拾取半径相对基线 1 的加成（0.15 → ×1.15）；
   *   armorMul     受到伤害的倍率（0.95 → 承伤 −5%，即装甲略厚）；
   *   energyCap    能量上限增量（+15）；
   *   firepowerMul 火力的倍率修正（0.97 → ×0.97，略降）。 */
  const MODULE_EFFECTS = Object.freeze({
    'phase-shield': Object.freeze({ shieldOnce: true }),
    'cargo-magnet': Object.freeze({ magnet: 0.15, armorMul: 0.95 }),
    'energy-cell': Object.freeze({ energyCap: 15, firepowerMul: 0.97 }),
  });

  /* 内容没写 effect 时的戏内一句话（只做展示，不含系统词）。 */
  const MODULE_SUMMARY = Object.freeze({
    hull: '机体更结实，能多扛一次。',
    power: '火力校得更准，打得狠一点。',
    engine: '挨打后的硬直更短，拾取也更顺手。',
    energy: '能量上限更高，撑得更久。',
    'phase-shield': '每次出击最多挡下一次近身危险。',
    'cargo-magnet': '拾取范围更宽，装甲略薄一点。',
    'energy-cell': '能量上限更高，其他能力略降。',
  });

  /* level 里除材料外的保留键（不当作材料成本）。 */
  const RESERVED_LEVEL_KEYS = Object.freeze({
    level: true,
    cost: true,
    effect: true,
    stats: true,
    effectStats: true,
    name: true,
    note: true,
    description: true,
  });

  /* ------------------------------------------------------------------ *
   * 基础工具
   * ------------------------------------------------------------------ */

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isInteger(value) {
    return typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value;
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isObject(value)) {
      const out = {};
      Object.keys(value).forEach(function (key) {
        out[key] = clone(value[key]);
      });
      return out;
    }
    return value;
  }

  function cleanText(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* wallet / equipment 双形状：允许直接传 db.readWallet() 结果或扁平 equipment。 */
  const WALLET_KEYS = Object.freeze({
    ok: true,
    careerId: true,
    exists: true,
    revision: true,
    credits: true,
    items: true,
    equipment: true,
  });

  function equipmentOf(input) {
    if (!isObject(input)) return {};
    if (isObject(input.equipment)) {
      const keys = Object.keys(input);
      let walletShaped = true;
      for (let i = 0; i < keys.length; i += 1) {
        if (!WALLET_KEYS[keys[i]]) {
          walletShaped = false;
          break;
        }
      }
      if (walletShaped) return input.equipment;
    }
    return input;
  }

  function walletSummary(input) {
    if (!isObject(input)) return { available: false, credits: 0, items: {} };
    const credits = isInteger(input.credits) && input.credits >= 0 ? input.credits : 0;
    const items = {};
    if (isObject(input.items)) {
      Object.keys(input.items).forEach(function (itemId) {
        const value = input.items[itemId];
        if (!TOKEN_RE.test(itemId)) return;
        if (isInteger(value) && value > 0) items[itemId] = value;
      });
    }
    return { available: true, credits: credits, items: items };
  }

  function moduleOwnedKey(moduleId) {
    return 'module:' + moduleId + ':owned';
  }

  function moduleLevelKey(moduleId) {
    return 'module:' + moduleId + ':level';
  }

  /* ------------------------------------------------------------------ *
   * 目录（configure 后只读缓存）
   * ------------------------------------------------------------------ */

  let catalog = emptyCatalog('not-configured');

  function emptyCatalog(reason) {
    return {
      configured: false,
      ok: false,
      contentVersion: '',
      modules: [],
      errors: [reason],
    };
  }

  function resolveItemsSource(options) {
    if (!isObject(options)) return null;
    if (isObject(options.items)) return options.items;
    /* 允许直接 configure(items.json)：自带 modules 数组且没有 items 包装。 */
    if (Array.isArray(options.modules)) return options;
    return null;
  }

  function materialIdsOf(source) {
    const ids = Object.create(null);
    let known = false;
    if (Array.isArray(source.materials)) {
      source.materials.forEach(function (entry) {
        if (!isObject(entry)) return;
        const itemId = cleanText(entry.itemId);
        if (TOKEN_RE.test(itemId)) {
          ids[itemId] = true;
          known = true;
        }
      });
    }
    if (isObject(source.materialAliases)) {
      Object.keys(source.materialAliases).forEach(function (alias) {
        const target = source.materialAliases[alias];
        if (TOKEN_RE.test(alias)) {
          ids[alias] = true;
          known = true;
        }
        if (typeof target === 'string' && TOKEN_RE.test(target)) {
          ids[target] = true;
          known = true;
        }
      });
    }
    return known ? ids : null;
  }

  function normalizeEffectStats(raw) {
    if (!isObject(raw)) return null;
    const out = {};
    Object.keys(raw).forEach(function (key) {
      if (!TOKEN_RE.test(key)) return;
      const value = raw[key];
      if (typeof value === 'boolean') {
        out[key] = value;
        return;
      }
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    });
    return Object.keys(out).length ? out : null;
  }

  /* 战斗参数优先级：内容 modules[].effectStats → 内容 levels[].stats → 内置 MODULE_EFFECTS。
   * 内容显式声明的模块级 effectStats 是后续星海 Worker 的约定字段，必须压过层内碎片参数。 */
  function contentEffectStats(entry) {
    return normalizeEffectStats(entry && entry.effectStats);
  }

  function builtinEffectStats(moduleId) {
    const builtin = MODULE_EFFECTS[moduleId];
    return builtin ? clone(builtin) : null;
  }

  function moduleSummary(entry, moduleId) {
    const text = cleanText(entry && entry.effect);
    if (text) return text;
    return MODULE_SUMMARY[moduleId] || '';
  }

  /**
   * 载入制造内容（items.json 的 modules/levels）。可重复调用；非法内容不抛。
   * @param {{items?:object}|object} options bridge 载荷 {items, commissions, chapter} 或 items.json 本體
   * @returns {{ok:boolean, moduleCount:number, levelCount:number, contentVersion:string, errors:string[]}}
   */
  function configure(options) {
    try {
      const source = resolveItemsSource(options);
      if (!source) {
        catalog = emptyCatalog('items-missing');
        return summarize(catalog);
      }
      const errors = [];
      const contentVersion = cleanText(source.contentVersion) || CONTENT_VERSION_FALLBACK;
      const materialIds = materialIdsOf(source);
      if (!Array.isArray(source.modules)) {
        catalog = {
          configured: true,
          ok: false,
          contentVersion: contentVersion,
          modules: [],
          errors: ['modules-missing'],
        };
        return summarize(catalog);
      }
      const modules = [];
      const seenModules = Object.create(null);
      for (let i = 0; i < source.modules.length; i += 1) {
        const entry = source.modules[i];
        if (!isObject(entry)) {
          errors.push('module-invalid:' + i);
          continue;
        }
        const moduleId = cleanText(entry.moduleId);
        if (!ID_RE.test(moduleId)) {
          errors.push('bad-module-id:' + i);
          continue;
        }
        if (seenModules[moduleId]) {
          errors.push('duplicate-module:' + moduleId);
          continue;
        }
        seenModules[moduleId] = true;
        let name = cleanText(entry.name);
        if (!name) {
          errors.push('missing-name:' + moduleId);
          name = moduleId;
        }
        if (!Array.isArray(entry.levels) || !entry.levels.length) {
          errors.push('missing-levels:' + moduleId);
          continue;
        }
        const levels = [];
        const seenLevels = Object.create(null);
        for (let j = 0; j < entry.levels.length; j += 1) {
          const raw = entry.levels[j];
          if (!isObject(raw)) {
            errors.push('bad-level:' + moduleId + ':' + j);
            continue;
          }
          const level = raw.level;
          if (!isInteger(level) || level < 1 || level > RULESET_MIRROR.itemCapPerItem) {
            errors.push('bad-level:' + moduleId + ':' + (isInteger(level) ? level : '?'));
            continue;
          }
          if (seenLevels[level]) {
            errors.push('duplicate-level:' + moduleId + ':' + level);
            continue;
          }
          seenLevels[level] = true;
          const cost = raw.cost;
          if (!isInteger(cost) || cost <= 0 || cost > RULESET_MIRROR.maxPurchaseCost) {
            errors.push('bad-cost:' + moduleId + ':' + level);
            continue;
          }
          const costItems = {};
          Object.keys(raw).forEach(function (key) {
            if (RESERVED_LEVEL_KEYS[key]) return;
            const value = raw[key];
            if (!isInteger(value) || value <= 0) return;
            if (!TOKEN_RE.test(key) || value > RULESET_MIRROR.itemCapPerItem) {
              errors.push('bad-cost-item:' + moduleId + ':' + level + ':' + key);
              return;
            }
            /* 材料清单存在时校验可交易性；未知材料仍记录下来（可归因，不静默丢）。 */
            if (materialIds && !materialIds[key]) {
              errors.push('unknown-material:' + moduleId + ':' + level + ':' + key);
            }
            costItems[key] = value;
          });
          levels.push({
            level: level,
            cost: cost,
            costItems: costItems,
            stats: normalizeEffectStats(raw.stats),
          });
        }
        levels.sort(function (a, b) {
          return a.level - b.level;
        });
        if (!levels.length) {
          errors.push('no-levels:' + moduleId);
          continue;
        }
        modules.push({
          moduleId: moduleId,
          name: name,
          effect: moduleSummary(entry, moduleId),
          effectStats: contentEffectStats(entry) || builtinEffectStats(moduleId),
          effectStatsFromContent: !!contentEffectStats(entry),
          levels: levels,
          maxLevel: levels[levels.length - 1].level,
          order: modules.length,
        });
      }
      if (!modules.length) errors.push('no-modules');
      catalog = {
        configured: true,
        ok: errors.length === 0,
        contentVersion: contentVersion,
        modules: modules,
        errors: errors,
      };
      return summarize(catalog);
    } catch (err) {
      catalog = emptyCatalog('configure-error');
      return summarize(catalog);
    }
  }

  function summarize(value) {
    let levelCount = 0;
    value.modules.forEach(function (entry) {
      levelCount += entry.levels.length;
    });
    return {
      ok: value.ok === true,
      moduleCount: value.modules.length,
      levelCount: levelCount,
      contentVersion: value.contentVersion || '',
      errors: value.errors.slice(),
      configured: value.configured === true,
    };
  }

  function findModule(moduleId) {
    for (let i = 0; i < catalog.modules.length; i += 1) {
      if (catalog.modules[i].moduleId === moduleId) return catalog.modules[i];
    }
    return null;
  }

  function findLevel(def, level) {
    for (let i = 0; i < def.levels.length; i += 1) {
      if (def.levels[i].level === level) return def.levels[i];
    }
    return null;
  }

  function levelFromEquipment(equipment, def) {
    const raw = isObject(equipment) ? equipment[moduleLevelKey(def.moduleId)] : undefined;
    let level = 0;
    if (isInteger(raw)) level = raw;
    else if (typeof raw === 'string' && cleanText(raw) !== '' && Number.isFinite(Number(raw))) {
      level = Math.floor(Number(raw));
    }
    if (level <= 0 && isObject(equipment) && equipment[moduleOwnedKey(def.moduleId)] === true) level = 1;
    if (level < 0) level = 0;
    if (level > def.maxLevel) level = def.maxLevel;
    return level;
  }

  function levelEffectStats(def, levelEntry) {
    if (def && def.effectStatsFromContent === true && isObject(def.effectStats)) return clone(def.effectStats);
    if (levelEntry && isObject(levelEntry.stats)) return clone(levelEntry.stats);
    if (def && isObject(def.effectStats)) return clone(def.effectStats);
    return null;
  }

  function missingOf(levelEntry, wallet) {
    const missing = { credits: 0, items: {} };
    const shortCredit = levelEntry.cost - wallet.credits;
    missing.credits = shortCredit > 0 ? shortCredit : 0;
    Object.keys(levelEntry.costItems).forEach(function (itemId) {
      const lack = levelEntry.costItems[itemId] - (wallet.items[itemId] || 0);
      if (lack > 0) missing.items[itemId] = lack;
    });
    return missing;
  }

  function grantsOf(moduleId, level) {
    const equipment = {};
    /* 冻结契约键（own 标记）；额外的 :level 键让 star-combat-config 能直接识别等级增量。 */
    equipment[moduleOwnedKey(moduleId)] = true;
    equipment[moduleLevelKey(moduleId)] = level;
    return { equipment: equipment };
  }

  /* ------------------------------------------------------------------ *
   * 配方清单
   * ------------------------------------------------------------------ */

  /**
   * 摊平「模块 × 等级」配方。equipment 可传扁平装备或 db.readWallet() 结果；只读。
   * @param {object} [equipment]
   * @returns {Array<{moduleId:string,name:string,level:number,maxLevel:number,cost:number,
   *   costItems:object,effect:string,effectStats:object|null,owned:boolean,currentLevel:number}>}
   */
  function listRecipes(equipment) {
    if (!catalog.configured) return [];
    const flat = equipmentOf(equipment);
    const out = [];
    catalog.modules.forEach(function (def) {
      const current = levelFromEquipment(flat, def);
      def.levels.forEach(function (levelEntry) {
        const stats = levelEffectStats(def, levelEntry);
        out.push({
          moduleId: def.moduleId,
          name: def.name,
          level: levelEntry.level,
          maxLevel: def.maxLevel,
          cost: levelEntry.cost,
          costItems: clone(levelEntry.costItems),
          effect: def.effect,
          effectStats: stats,
          owned: current >= levelEntry.level,
          currentLevel: current,
        });
      });
    });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 制造计划（纯计算）
   * ------------------------------------------------------------------ */

  function planFailure(reason, moduleId, extra) {
    const out = { ok: false, moduleId: moduleId || '', reason: reason };
    if (isObject(extra)) {
      Object.keys(extra).forEach(function (key) {
        out[key] = extra[key];
      });
    }
    return out;
  }

  /**
   * 一次制造的成本/材料/差额/装备授权。不扣费、不写库、不读存储。
   * - level 省略：自动取「下一层」（已到顶则 owned/noop）；
   * - level 指定且 ≤ 当前等级：owned/noop（幂等，不重复扣费）。
   * @param {{moduleId:string, level?:number, equipment?:object, wallet?:object}} input
   */
  function plan(input) {
    const options = isObject(input) ? input : {};
    const moduleId = cleanText(options.moduleId);
    if (!catalog.configured) return planFailure('not-configured', moduleId);
    if (!ID_RE.test(moduleId)) return planFailure('bad-module-id', moduleId);
    const def = findModule(moduleId);
    if (!def) return planFailure('unknown-module', moduleId);
    const equipment = equipmentOf(options.equipment);
    const current = levelFromEquipment(equipment, def);
    const requested = options.level;
    let level;
    if (requested === undefined || requested === null) {
      level = Math.min(current + 1, def.maxLevel);
    } else if (isInteger(requested)) {
      level = requested;
    } else {
      return planFailure('bad-level', moduleId, { level: requested });
    }
    if (!isInteger(level) || level < 1 || level > def.maxLevel) {
      return planFailure('bad-level', moduleId, { level: level, maxLevel: def.maxLevel });
    }
    const levelEntry = findLevel(def, level);
    if (!levelEntry) return planFailure('bad-level', moduleId, { level: level });
    const wallet = walletSummary(options.wallet);
    const stats = levelEffectStats(def, levelEntry);
    if (current >= level) {
      /* 幂等：同一模块同一层只能有一件；已拥有时零成本零授权。 */
      return {
        ok: true,
        moduleId: moduleId,
        name: def.name,
        level: level,
        maxLevel: def.maxLevel,
        owned: true,
        noop: true,
        cost: 0,
        costItems: {},
        grants: { equipment: {} },
        effect: def.effect,
        effectStats: stats,
        affordable: false,
        missing: { credits: 0, items: {} },
        currentLevel: current,
        walletAvailable: wallet.available,
        contentVersion: catalog.contentVersion,
      };
    }
    /* 逐级成本：从当前等级升到目标等级必须补齐中间每一级的信用点/材料。 */
    const costItems = {};
    let totalCost = 0;
    for (let step = current + 1; step <= level; step += 1) {
      const stepEntry = findLevel(def, step);
      if (!stepEntry) return planFailure('bad-level', moduleId, { level: level });
      totalCost += Math.max(0, Math.floor(Number(stepEntry.cost) || 0));
      Object.keys(stepEntry.costItems || {}).forEach(function (itemId) {
        costItems[itemId] = (costItems[itemId] || 0) + Math.max(0, Math.floor(Number(stepEntry.costItems[itemId]) || 0));
      });
    }
    const missing = missingOf({ cost: totalCost, costItems: costItems }, wallet);
    const affordable =
      wallet.available &&
      missing.credits === 0 &&
      Object.keys(missing.items).length === 0;
    return {
      ok: true,
      moduleId: moduleId,
      name: def.name,
      level: level,
      maxLevel: def.maxLevel,
      owned: false,
      noop: false,
      cost: totalCost,
      costItems: clone(costItems),
      grants: grantsOf(moduleId, level),
      effect: def.effect,
      effectStats: stats,
      affordable: affordable,
      missing: missing,
      currentLevel: current,
      walletAvailable: wallet.available,
      contentVersion: catalog.contentVersion,
    };
  }

  /* ------------------------------------------------------------------ *
   * 计划 → career-db 请求（不写库）
   * ------------------------------------------------------------------ */

  /**
   * 制造流水号：craft:<careerId>:<moduleId>:<level>（career-core TOKEN_RE 合法）。
   * @returns {string|null}
   */
  function purchaseIdFor(input) {
    const options = isObject(input) ? input : {};
    const careerId = cleanText(options.careerId);
    const moduleId = cleanText(options.moduleId);
    const level = options.level;
    if (!CAREER_ID_RE.test(careerId) || !ID_RE.test(moduleId) || !isInteger(level) || level < 1) return null;
    const id = 'craft:' + careerId + ':' + moduleId + ':' + level;
    return TOKEN_RE.test(id) ? id : null;
  }

  /**
   * 把 plan() 结果组装成 db.purchase 请求（原子校验/扣减由 career-db 负责）。
   * 不写库、不调用 db、不产生副作用。
   * @param {{plan:object, careerId:string, now?:string, contentVersion?:string}} input
   * @returns {{ok:boolean, reason?:string, request?:object, purchaseId?:string, noop?:boolean}}
   */
  function applyPlan(input) {
    const options = isObject(input) ? input : {};
    const value = isObject(options.plan) ? options.plan : null;
    if (!value) return { ok: false, reason: 'bad-plan' };
    if (value.ok === false) {
      return { ok: false, reason: cleanText(value.reason) || 'bad-plan', moduleId: cleanText(value.moduleId) };
    }
    const careerId = cleanText(options.careerId);
    if (!CAREER_ID_RE.test(careerId)) return { ok: false, reason: 'bad-career-id' };
    const moduleId = cleanText(value.moduleId);
    const level = value.level;
    if (!ID_RE.test(moduleId) || !isInteger(level) || level < 1) return { ok: false, reason: 'bad-plan' };
    const purchaseId = purchaseIdFor({ careerId: careerId, moduleId: moduleId, level: level });
    if (!purchaseId) return { ok: false, reason: 'bad-purchase-id' };
    if (value.owned === true || value.noop === true) {
      return { ok: false, reason: 'already-owned', noop: true, moduleId: moduleId, level: level, purchaseId: purchaseId };
    }
    if (value.walletAvailable === false) {
      return { ok: false, reason: 'wallet-unavailable', moduleId: moduleId, level: level, purchaseId: purchaseId };
    }
    const missing = isObject(value.missing) ? value.missing : {};
    const missingItems = isObject(missing.items) ? clone(missing.items) : {};
    if (value.affordable !== true) {
      /* 与 career-core.purchasePlan 判定顺序一致：先看信用点（insufficient），再材料。 */
      const missingCredits = isInteger(missing.credits) ? missing.credits : 0;
      const reason = missingCredits > 0 ? 'insufficient' : 'insufficient-items';
      return {
        ok: false,
        reason: reason,
        moduleId: moduleId,
        level: level,
        purchaseId: purchaseId,
        missing: { credits: missingCredits, items: missingItems },
      };
    }
    const cost = value.cost;
    const costItems = isObject(value.costItems) ? clone(value.costItems) : {};
    const equipment = isObject(value.grants) && isObject(value.grants.equipment) ? clone(value.grants.equipment) : null;
    if (!isInteger(cost) || cost <= 0 || cost > RULESET_MIRROR.maxPurchaseCost) {
      return { ok: false, reason: 'bad-cost' };
    }
    const grantKeys = equipment ? Object.keys(equipment) : [];
    if (!grantKeys.length) return { ok: false, reason: 'bad-grants' };
    for (let i = 0; i < grantKeys.length; i += 1) {
      if (!TOKEN_RE.test(grantKeys[i])) return { ok: false, reason: 'bad-grants' };
    }
    const request = {
      careerId: careerId,
      purchaseId: purchaseId,
      cost: cost,
      grants: { equipment: equipment },
      expectedLevel: isInteger(value.currentLevel) ? value.currentLevel : 0,
    };
    if (Object.keys(costItems).length) request.costItems = costItems;
    const now = cleanText(options.now);
    if (now) request.now = now;
    const contentVersion = cleanText(options.contentVersion) || catalog.contentVersion || CONTENT_VERSION_FALLBACK;
    if (contentVersion) request.contentVersion = contentVersion;
    return {
      ok: true,
      moduleId: moduleId,
      level: level,
      purchaseId: purchaseId,
      request: request,
      cost: cost,
      costItems: costItems,
      grants: { equipment: equipment },
    };
  }

  /* ------------------------------------------------------------------ *
   * 只读辅助
   * ------------------------------------------------------------------ */

  /** 模块效果常量（与内容 id 对齐；内容 effectStats 优先由 listRecipes/plan 返回）。 */
  function effectOf(moduleId) {
    const id = cleanText(moduleId);
    return MODULE_EFFECTS[id] ? clone(MODULE_EFFECTS[id]) : null;
  }

  function getContentVersion() {
    return catalog.contentVersion || '';
  }

  function isConfigured() {
    return catalog.configured === true && catalog.modules.length > 0;
  }

  function configuration() {
    return {
      configured: catalog.configured === true,
      ok: catalog.ok === true,
      contentVersion: catalog.contentVersion || '',
      moduleCount: catalog.modules.length,
      errors: catalog.errors.slice(),
    };
  }

  /* ------------------------------------------------------------------ *
   * 默认实例（浏览器 window.ArcadeCareerCrafting / Node module.exports）
   * ------------------------------------------------------------------ */

  const api = {
    VERSION: VERSION,
    MODULE_VERSION: VERSION,
    CONTENT_VERSION: CONTENT_VERSION_FALLBACK,
    RULESET_MIRROR: RULESET_MIRROR,
    MODULE_EFFECTS: MODULE_EFFECTS,
    MODULE_SUMMARY: MODULE_SUMMARY,
    configure: configure,
    listRecipes: listRecipes,
    plan: plan,
    applyPlan: applyPlan,
    purchaseIdFor: purchaseIdFor,
    effectOf: effectOf,
    isConfigured: isConfigured,
    getContentVersion: getContentVersion,
    configuration: configuration,
    __craftingMounted: true,
  };
  return api;
});
