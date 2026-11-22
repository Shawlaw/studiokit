/*!
 * StudioKit Arcade Life — 星海机体参数提纯（0.16，D16-05）
 *
 * 纯函数、无 DOM、无存储、无网络；浏览器挂到 window.ArcadeCareerCombatConfig
 * （并按 bridge.js 的既有约定镜像到 window.ArcadeCareer.combatConfig），
 * Node 中可直接 require() 用于确定性测试。
 *
 * 职责边界（docs/arcade-life/ADR-interfaces.md §18.5 / §18.6 / §18.8 / §18.9）：
 * - 经典旧机库（studiokit:arcade:meta:v1 的 formula:1）**只读**映射，绝不改写；
 * - 生涯委托局从扁平 equipment（ship:<id>:owned / equippedShip / module:<id>:level）
 *   读取机体与模块，结合 content/items.json 产出 formula:2 参数；
 * - 不读旧 hangar、不写任何 key、不改变经典路径（调用方仅在 commission run 使用）；
 * - 非法输入一律回退安全默认值，绝不抛异常；所有数值 clamp 到 SAFE_LIMITS。
 *
 * 内容契约（content/items.json，由 D16-06 落地，已按实际文件对齐）：
 *   ships[].stats = { lives, energy, firepower, speed, magnet }（ADR §18.6 形状）
 *     lives     起始生命绝对值（默认 3）
 *     energy    能量上限绝对值（默认 100）
 *     firepower 相对经典基线 1 的伤害加成（默认 0 → 1.0x；内容写 0.06 → 1.06x）
 *     speed     相对经典基线 1 的速度加成（默认 0 → 1.0x）
 *     magnet    相对经典基线 1 的拾取吸附加成（默认 0 → 1.0x）
 *   可选扩展：lifeCap / itemCap / invul / damage（绝对基数，缺省分别由 lives+2 / 2 / 1.8 / firepower 推出）
 *   modules[].levels[].stats 为**每级增量**（与经典机库每级增量同语义，按等级线性叠加）：
 *     lives/lifeCap/itemCap/energy|energyCap（加整数）、damage|firepower/magnet/speed（加倍率）、
 *     invul（加秒）；显式 stats 覆盖同键的内置增量；未知键忽略。
 *   模块 ID 与经典机库一致（hull/power/engine/energy/bay/wing）时内置每级增量：
 *     hull +1 起始生命 & +1 上限、power +6% 伤害、engine +0.12s 无敌 & +6% 吸附、
 *     energy +10 能量上限、bay +1 道具槽、wing 仅编队（不影响机体参数）。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory();
    return;
  }
  var api = factory();
  root.ArcadeCareerCombatConfig = api;
  /* bridge.js 的统一依赖装载约定：模块挂在 window.ArcadeCareer.<global>，
   * DEPENDENCIES 里 star-combat-config.js 的 global 为 combatConfig。 */
  root.ArcadeCareer = root.ArcadeCareer || {};
  root.ArcadeCareer.combatConfig = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const FORMULA_VERSION = 2;
  const CLASSIC_FORMULA_VERSION = 1;
  const DEFAULT_SHIP_ID = 'old-wing';
  const DEFAULT_SHIP_NAME = '旧翼';

  /* 与 D16-06 的 content/items.json 对齐的飞船价格表（测试逐项断言一致）。
   * 价格只来自内容 + 玩家动作，游戏页不得提交价格（ADR §18.6）。 */
  const EXPECTED_PRICES = Object.freeze({
    'old-wing': 260,
    'cloud-lark': 480,
    'shield-whale': 520,
    prism: 540,
  });

  const EXPECTED_SHIP_IDS = Object.freeze(['old-wing', 'cloud-lark', 'shield-whale', 'prism']);

  const DEFAULT_SHIP_NAMES = Object.freeze({
    'old-wing': '旧翼',
    'cloud-lark': '云雀',
    'shield-whale': '盾鲸',
    prism: '棱镜',
  });

  /* 与 star-raid.html 的 HANGAR_UPGRADES[].max 逐项一致（测试会读源码对照）。 */
  const BUILTIN_MODULE_MAX = Object.freeze({
    hull: 3,
    power: 5,
    engine: 5,
    energy: 5,
    bay: 1,
    wing: 3,
  });

  /* 与 star-raid.html 的旧机库每级增量一致（engine 的 invul/magnet 在旧代码里
   * 是在 1.8s / 1.0x 基数上叠加，故经典映射返回总量，生涯增量为纯增量）。 */
  const BUILTIN_MODULE_DELTAS = Object.freeze({
    hull: Object.freeze({ lives: 1, lifeCap: 1 }),
    power: Object.freeze({ damage: 0.06 }),
    engine: Object.freeze({ invul: 0.12, magnet: 0.06 }),
    energy: Object.freeze({ energyCap: 10 }),
    bay: Object.freeze({ itemCap: 1 }),
    wing: Object.freeze({}),
  });

  /* 生涯机体安全范围。0.16 的 career-core.RULESET 只有经济上限，没有战斗数值，
   * 因此本模块自己持有战斗安全范围；经济项（价格）与 RULESET 对齐（见下）。 */
  const SAFE_LIMITS = Object.freeze({
    maxLives: Object.freeze({ min: 1, max: 9 }),
    lifeCap: Object.freeze({ min: 1, max: 12 }),
    itemCap: Object.freeze({ min: 1, max: 5 }),
    firepowerMul: Object.freeze({ min: 0.5, max: 3 }),
    damageMul: Object.freeze({ min: 0.5, max: 3.5 }),
    invul: Object.freeze({ min: 0, max: 6 }),
    magnet: Object.freeze({ min: 0.5, max: 3 }),
    energyCap: Object.freeze({ min: 60, max: 260 }),
    speedMul: Object.freeze({ min: 0.5, max: 2 }),
  });

  /* career-core.RULESET 的只读镜像：仅用于价格合法性 / 测试防漂移。
   * 测试会 require career-core.js 并断言完全相等。 */
  const RULESET_MIRROR = Object.freeze({
    maxPurchaseCost: 1000000,
    itemCapPerItem: 99,
  });

  /* 经典旧机库基数：与 star-raid.html 的 startingLives/maxLives/itemCap/
   * damageMul/invulSeconds/magnetMultiplier/energyCap 常量一致。 */
  const CLASSIC_BASE = Object.freeze({
    lives: 3,
    lifeCapHeadroom: 2,
    itemCap: 2,
    firepower: 1,
    invul: 1.8,
    magnet: 1,
    energyCap: 100,
    speed: 1,
    moveSpeed: 320,
  });

  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const MODULE_LEVEL_KEY_RE = /^module:([A-Za-z0-9][A-Za-z0-9._-]{0,63}):level$/;

  /* ---------------------------------------------------------------- 基础工具 */

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function toNumberOrNull(value) {
    if (typeof value === 'number') return Number.isNaN(value) ? null : value;
    if (typeof value === 'string' && value.trim() !== '') {
      const num = Number(value);
      return Number.isNaN(num) ? null : num;
    }
    return null;
  }

  function toFiniteNumber(value) {
    const num = toNumberOrNull(value);
    return num !== null && Number.isFinite(num) ? num : null;
  }

  function toLevel(value) {
    const num = toFiniteNumber(value);
    if (num === null) return 0;
    const floored = Math.floor(num);
    return floored > 0 ? floored : 0;
  }

  /* 与 engine clamp(v, lo, hi) + star-raid `Math.floor(Number(v) || 0)` 语义一致：
   * Infinity 夹到边界、NaN/非数字回退 fallback。 */
  function clampNumber(value, min, max, fallback) {
    let num = NaN;
    if (typeof value === 'number') num = value;
    else if (typeof value === 'string' && value.trim() !== '') num = Number(value);
    if (Number.isNaN(num)) return typeof fallback === 'number' ? fallback : min;
    if (num === Infinity) return max;
    if (num === -Infinity) return min;
    if (num < min) return min;
    if (num > max) return max;
    return num;
  }

  function clampInt(value, min, max, fallback) {
    const num = clampNumber(value, min, max, fallback);
    return Math.floor(num);
  }

  function round4(value) {
    return Math.round(value * 10000) / 10000;
  }

  function isValidId(value) {
    return typeof value === 'string' && ID_RE.test(value);
  }

  function safeText(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const text = value.trim();
    return text ? text : fallback;
  }

  /* ---------------------------------------------------------------- 经典旧机库（formula 1，只读） */

  function hangarUpgradeLevels(hangar) {
    const source = isObject(hangar) && isObject(hangar.upgrades) ? hangar.upgrades : {};
    const levels = {};
    Object.keys(BUILTIN_MODULE_MAX).forEach(function (id) {
      levels[id] = clampInt(source[id], 0, BUILTIN_MODULE_MAX[id], 0);
    });
    return levels;
  }

  /**
   * 把 0.13/0.14 旧机库（formula:1）参数映射为统一字段，供测试断言「旧公式不变」。
   * **只读**：不修改 hangar，不写存储，不返回公式版本 2。
   * `maxLives` 为起始生命（源码 startingLives()），`lifeCap` 为上限生命（源码 maxLives()）。
   * `invul` / `magnet` 为源码 invulSeconds() / magnetMultiplier() 的**总量**，
   * 同时给出 `invulBonus` / `magnetBonus` 每级增量便于逐项核对。
   */
  function classicHangarStats(hangar) {
    const levels = hangarUpgradeLevels(hangar);
    const hull = levels.hull;
    const power = levels.power;
    const engine = levels.engine;
    const energy = levels.energy;
    const bay = levels.bay;
    const wing = levels.wing;
    return {
      formula: CLASSIC_FORMULA_VERSION,
      hull: hull,
      power: power,
      engine: engine,
      energy: energy,
      bay: bay,
      wing: wing,
      /* startingLives() = clamp(3 + hull, 1, maxLives())，hull∈[0,3] 时 clamp 不生效 */
      maxLives: CLASSIC_BASE.lives + hull,
      /* maxLives() = 5 + hull */
      lifeCap: CLASSIC_BASE.lifeCapHeadroom + CLASSIC_BASE.lives + hull,
      /* itemCap() = 2 + bay */
      itemCap: CLASSIC_BASE.itemCap + bay,
      /* damageMul() = 1 + power * 0.06 */
      firepower: CLASSIC_BASE.firepower + power * 0.06,
      damageMul: CLASSIC_BASE.firepower + power * 0.06,
      /* invulSeconds() = 1.8 + engine * 0.12 */
      invul: CLASSIC_BASE.invul + engine * 0.12,
      invulBonus: 0.12 * engine,
      /* magnetMultiplier() = 1 + engine * 0.06 */
      magnet: CLASSIC_BASE.magnet + engine * 0.06,
      magnetBonus: 0.06 * engine,
      /* energyCap() = 100 + energy * 10 */
      energyCap: CLASSIC_BASE.energyCap + energy * 10,
      /* moveSpeed() 为常量 320（旧代码不随机体提升） */
      speed: CLASSIC_BASE.moveSpeed,
      /* formationBaseCharges() / formationDuration()：旧代码的额外项，保持一致 */
      formationBaseCharges: 1 + wing,
      formationDuration: 8 + wing * 2,
    };
  }

  /* ---------------------------------------------------------------- 内容目录（items.json） */

  function shipEntries(items) {
    return items && Array.isArray(items.ships) ? items.ships : [];
  }

  function moduleEntries(items, modulesOverride) {
    let source = modulesOverride;
    if (source === undefined || source === null) source = items ? items.modules : null;
    if (Array.isArray(source)) {
      return source.filter(function (entry) {
        return isObject(entry);
      });
    }
    if (isObject(source)) {
      return Object.keys(source).map(function (key) {
        const entry = source[key];
        if (!isObject(entry)) return null;
        if (typeof entry.moduleId === 'string') return entry;
        return Object.assign({}, entry, { moduleId: key });
      }).filter(function (entry) {
        return !!entry;
      });
    }
    return [];
  }

  function buildCatalog(items, modulesOverride) {
    const ships = Object.create(null);
    shipEntries(items).forEach(function (entry) {
      if (!isObject(entry)) return;
      const shipId = entry.shipId;
      if (typeof shipId !== 'string' || !isValidId(shipId)) return;
      if (ships[shipId]) return;
      ships[shipId] = entry;
    });
    const modules = Object.create(null);
    moduleEntries(items, modulesOverride).forEach(function (entry) {
      const moduleId = entry.moduleId;
      if (typeof moduleId !== 'string' || !isValidId(moduleId)) return;
      if (modules[moduleId]) return;
      modules[moduleId] = normalizeModuleDef(moduleId, entry);
    });
    return { ships: ships, modules: modules };
  }

  function normalizeModuleDef(moduleId, entry) {
    const levels = Array.isArray(entry.levels)
      ? entry.levels.filter(function (level) {
        return isObject(level);
      })
      : [];
    const explicitMax = toFiniteNumber(entry.max);
    let max = BUILTIN_MODULE_MAX[moduleId] || 0;
    if (explicitMax !== null) max = Math.floor(explicitMax);
    else if (levels.length > 0) max = levels.length;
    if (!(max > 0)) max = 0;
    return { moduleId: moduleId, max: max, levels: levels };
  }

  function moduleMax(moduleId, modules) {
    if (modules && modules[moduleId]) return modules[moduleId].max;
    return BUILTIN_MODULE_MAX[moduleId] || 0;
  }

  function moduleLevelStats(moduleId, level, modules) {
    const def = modules ? modules[moduleId] : null;
    if (!def || !Array.isArray(def.levels) || def.levels.length === 0) return null;
    for (let i = 0; i < def.levels.length; i += 1) {
      const entry = def.levels[i];
      if (toLevel(entry.level) === level) return isObject(entry.stats) ? entry.stats : null;
    }
    /* 内容常写成 [{level:1,...},{level:2,...}]；缺 level 字段时按数组顺序。 */
    const byIndex = def.levels[level - 1];
    return isObject(byIndex) && isObject(byIndex.stats) && toLevel(byIndex.level) === 0
      ? byIndex.stats
      : null;
  }

  /* ---------------------------------------------------------------- 模块等级护栏 */

  function collectLevelInputs(modules) {
    const out = [];
    if (Array.isArray(modules)) {
      modules.forEach(function (entry) {
        if (!isObject(entry)) return;
        const moduleId = typeof entry.moduleId === 'string' ? entry.moduleId : entry.id;
        if (typeof moduleId === 'string') out.push({ moduleId: moduleId, level: entry.level });
      });
      return out;
    }
    if (!isObject(modules)) return out;
    Object.keys(modules).forEach(function (key) {
      const match = MODULE_LEVEL_KEY_RE.exec(key);
      if (match) {
        out.push({ moduleId: match[1], level: modules[key] });
        return;
      }
      const value = modules[key];
      if (isObject(value)) return;
      out.push({ moduleId: key, level: value });
    });
    return out;
  }

  function normalizeModulesMap(catalog) {
    const map = Object.create(null);
    if (Array.isArray(catalog)) {
      catalog.forEach(function (entry) {
        if (!isObject(entry)) return;
        const moduleId = entry.moduleId;
        if (typeof moduleId !== 'string' || !isValidId(moduleId)) return;
        map[moduleId] = normalizeModuleDef(moduleId, entry);
      });
      return map;
    }
    if (isObject(catalog)) {
      Object.keys(catalog).forEach(function (key) {
        const entry = catalog[key];
        if (!isObject(entry)) return;
        map[key] = normalizeModuleDef(key, entry);
      });
    }
    return map;
  }

  /**
   * 触摸/升级护栏：把内容等级 clamp 到 0..max（max 依次取内容 levels 长度、
   * 内容 max、经典内置 max）。接受三种输入：
   *   - 数组 [{moduleId, level}]；
   *   - 扁平 equipment（'module:<id>:level' 键）；
   *   - 普通映射 {moduleId: level}。
   * 第二参数 modules 为内容 modules 目录（数组或 {id: def} 映射，可选）。
   * 返回 `{ [moduleId]: clampedLevel }`；未知模块忽略（不抛、不产生负值）。
   */
  function clampLevels(modules, catalog) {
    const modulesMap = normalizeModulesMap(catalog);
    const result = {};
    collectLevelInputs(modules).forEach(function (entry) {
      const moduleId = entry.moduleId;
      if (typeof moduleId !== 'string' || !isValidId(moduleId)) return;
      const known = !!modulesMap[moduleId] || Object.prototype.hasOwnProperty.call(BUILTIN_MODULE_MAX, moduleId);
      if (!known) return;
      const max = moduleMax(moduleId, modulesMap);
      result[moduleId] = clampInt(entry.level, 0, max, 0);
    });
    return result;
  }

  /* ---------------------------------------------------------------- 生涯机体（formula 2） */

  function shipDefinition(shipId, catalog) {
    if (catalog && catalog.ships[shipId]) return catalog.ships[shipId];
    if (shipId === DEFAULT_SHIP_ID) {
      return {
        shipId: DEFAULT_SHIP_ID,
        name: DEFAULT_SHIP_NAME,
        price: EXPECTED_PRICES[DEFAULT_SHIP_ID],
        rental: true,
        stats: {},
      };
    }
    return null;
  }

  function pickShipId(explicitShipId, equipment, catalog) {
    if (typeof explicitShipId === 'string' && isValidId(explicitShipId) && catalog.ships[explicitShipId]) {
      return explicitShipId;
    }
    const equipped = equipment && typeof equipment.equippedShip === 'string' ? equipment.equippedShip : '';
    if (isValidId(equipped) && catalog.ships[equipped]) return equipped;
    return DEFAULT_SHIP_ID;
  }

  function shipNameOf(shipId, def) {
    if (def) {
      const name = safeText(def.name, '');
      if (name) return name;
    }
    return DEFAULT_SHIP_NAMES[shipId] || safeText(shipId, DEFAULT_SHIP_NAME);
  }

  function shipStat(stats, key, fallback) {
    if (!stats) return fallback;
    const value = toNumberOrNull(stats[key]);
    return value === null ? fallback : value;
  }

  /* 模块增量键别名 → 统一键。 */
  const DELTA_ALIASES = Object.freeze({
    lives: 'lives',
    life: 'lives',
    maxLives: 'lifeCap',
    lifeCap: 'lifeCap',
    itemCap: 'itemCap',
    items: 'itemCap',
    bay: 'itemCap',
    damage: 'damage',
    firepower: 'damage',
    invul: 'invul',
    invulSeconds: 'invul',
    magnet: 'magnet',
    speed: 'speed',
    energy: 'energyCap',
    energyCap: 'energyCap',
  });

  function explicitDeltas(stats) {
    const out = {};
    if (!isObject(stats)) return out;
    Object.keys(stats).forEach(function (key) {
      const canonical = DELTA_ALIASES[key];
      if (!canonical) return;
      const value = toNumberOrNull(stats[key]);
      if (value === null) return;
      out[canonical] = value;
    });
    return out;
  }

  /** 单模块某等级的增量：内置增量与内容 stats 显式键合并（显式覆盖同键）。 */
  function moduleDelta(moduleId, level, modules) {
    const builtin = BUILTIN_MODULE_DELTAS[moduleId] || null;
    const stats = moduleLevelStats(moduleId, level, modules);
    const explicit = explicitDeltas(stats);
    const delta = {};
    if (builtin) {
      Object.keys(builtin).forEach(function (key) {
        delta[key] = Object.prototype.hasOwnProperty.call(explicit, key) ? explicit[key] : builtin[key];
      });
    }
    Object.keys(explicit).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(delta, key)) delta[key] = explicit[key];
    });
    return delta;
  }

  function fallbackCareerConfig() {
    return {
      formula: FORMULA_VERSION,
      shipId: DEFAULT_SHIP_ID,
      shipName: DEFAULT_SHIP_NAME,
      maxLives: CLASSIC_BASE.lives,
      lifeCap: CLASSIC_BASE.lives + CLASSIC_BASE.lifeCapHeadroom,
      itemCap: CLASSIC_BASE.itemCap,
      firepowerMul: CLASSIC_BASE.firepower,
      damageMul: CLASSIC_BASE.firepower,
      invul: CLASSIC_BASE.invul,
      magnet: CLASSIC_BASE.magnet,
      energyCap: CLASSIC_BASE.energyCap,
      speedMul: CLASSIC_BASE.speed,
      owned: false,
    };
  }

  /**
   * 生涯委托局机体参数。无装备/未知飞船回退旧翼（owned:false，租用路径可玩）；
   * 不读旧 hangar（options.hangar 会被忽略）；所有输入非法时返回安全默认值。
   */
  function resolveCareerConfig(options) {
    try {
      const opts = isObject(options) ? options : {};
      const items = isObject(opts.items) ? opts.items : null;
      const equipment = isObject(opts.equipment) ? opts.equipment : Object.create(null);
      const catalog = buildCatalog(items, opts.modules);
      const shipId = pickShipId(opts.shipId, equipment, catalog);
      const def = shipDefinition(shipId, catalog);
      const stats = def && isObject(def.stats) ? def.stats : Object.create(null);
      const levels = clampLevels(equipment, catalog.modules);

      const aggregate = {
        lives: 0,
        lifeCap: 0,
        itemCap: 0,
        damage: 0,
        invul: 0,
        magnet: 0,
        speed: 0,
        energyCap: 0,
      };
      Object.keys(levels).forEach(function (moduleId) {
        const level = levels[moduleId];
        if (!(level > 0)) return;
        const delta = moduleDelta(moduleId, level, catalog.modules);
        Object.keys(aggregate).forEach(function (key) {
          if (typeof delta[key] === 'number' && Number.isFinite(delta[key])) {
            /* 每级增量 × 等级（经典机库即按级线性叠加） */
            aggregate[key] += delta[key] * level;
          }
        });
      });

      const baseLives = shipStat(stats, 'lives', CLASSIC_BASE.lives);
      const baseLifeCap = shipStat(stats, 'lifeCap', baseLives + CLASSIC_BASE.lifeCapHeadroom);
      const baseItemCap = shipStat(stats, 'itemCap', CLASSIC_BASE.itemCap);
      /* firepower/speed/magnet 是相对经典基线 1 的加成（内容旧翼写 0 → 1.0x） */
      const baseFirepower = CLASSIC_BASE.firepower + shipStat(stats, 'firepower', 0);
      const baseDamage = shipStat(stats, 'damage', baseFirepower);
      const baseInvul = shipStat(stats, 'invul', CLASSIC_BASE.invul);
      const baseMagnet = CLASSIC_BASE.magnet + shipStat(stats, 'magnet', 0);
      const baseEnergy = shipStat(stats, 'energy', CLASSIC_BASE.energyCap);
      const baseSpeed = CLASSIC_BASE.speed + shipStat(stats, 'speed', 0);

      const maxLives = clampInt(
        baseLives + aggregate.lives,
        SAFE_LIMITS.maxLives.min,
        SAFE_LIMITS.maxLives.max,
        CLASSIC_BASE.lives
      );
      const lifeCap = clampInt(
        baseLifeCap + aggregate.lifeCap,
        Math.max(maxLives, SAFE_LIMITS.lifeCap.min),
        SAFE_LIMITS.lifeCap.max,
        maxLives
      );

      return {
        formula: FORMULA_VERSION,
        shipId: shipId,
        shipName: shipNameOf(shipId, def),
        maxLives: maxLives,
        lifeCap: lifeCap,
        itemCap: clampInt(
          baseItemCap + aggregate.itemCap,
          SAFE_LIMITS.itemCap.min,
          SAFE_LIMITS.itemCap.max,
          CLASSIC_BASE.itemCap
        ),
        firepowerMul: round4(clampNumber(
          baseFirepower,
          SAFE_LIMITS.firepowerMul.min,
          SAFE_LIMITS.firepowerMul.max,
          CLASSIC_BASE.firepower
        )),
        damageMul: round4(clampNumber(
          baseDamage + aggregate.damage,
          SAFE_LIMITS.damageMul.min,
          SAFE_LIMITS.damageMul.max,
          CLASSIC_BASE.firepower
        )),
        invul: round4(clampNumber(
          baseInvul + aggregate.invul,
          SAFE_LIMITS.invul.min,
          SAFE_LIMITS.invul.max,
          CLASSIC_BASE.invul
        )),
        magnet: round4(clampNumber(
          baseMagnet + aggregate.magnet,
          SAFE_LIMITS.magnet.min,
          SAFE_LIMITS.magnet.max,
          CLASSIC_BASE.magnet
        )),
        energyCap: clampInt(
          baseEnergy + aggregate.energyCap,
          SAFE_LIMITS.energyCap.min,
          SAFE_LIMITS.energyCap.max,
          CLASSIC_BASE.energyCap
        ),
        speedMul: round4(clampNumber(
          baseSpeed + aggregate.speed,
          SAFE_LIMITS.speedMul.min,
          SAFE_LIMITS.speedMul.max,
          CLASSIC_BASE.speed
        )),
        owned: equipment['ship:' + shipId + ':owned'] === true,
      };
    } catch (err) {
      return fallbackCareerConfig();
    }
  }

  /* ---------------------------------------------------------------- 购买预览（纯计算） */

  function normalizeMaterials(source) {
    const out = {};
    if (!isObject(source)) return out;
    Object.keys(source).forEach(function (itemId) {
      if (!isValidId(itemId)) return;
      const count = clampInt(source[itemId], 0, RULESET_MIRROR.itemCapPerItem, 0);
      if (count > 0) out[itemId] = count;
    });
    return out;
  }

  function shipMaterials(ship) {
    if (!isObject(ship)) return {};
    if (isObject(ship.materials)) return normalizeMaterials(ship.materials);
    /* 0.16 实际 content/items.json 使用 requires:{alloy:1,crystal:1} 形状。 */
    if (isObject(ship.requires)) return normalizeMaterials(ship.requires);
    if (isObject(ship.requirements)) return normalizeMaterials(ship.requirements);
    if (isObject(ship.cost) && isObject(ship.cost.items)) return normalizeMaterials(ship.cost.items);
    return {};
  }

  function shipPrice(ship) {
    if (!isObject(ship)) return null;
    const direct = toFiniteNumber(ship.price);
    if (direct !== null) return direct;
    if (isObject(ship.cost)) {
      const nested = toFiniteNumber(ship.cost.credits);
      if (nested !== null) return nested;
      return toFiniteNumber(ship.cost);
    }
    return toFiniteNumber(ship.cost);
  }

  function invalidPurchase(shipId, credits, reason) {
    return {
      formula: FORMULA_VERSION,
      shipId: shipId,
      ok: false,
      reason: reason,
      price: 0,
      credits: credits,
      creditShortfall: 0,
      materials: {},
      missingMaterials: {},
      owned: false,
      expectedPrice: Object.prototype.hasOwnProperty.call(EXPECTED_PRICES, shipId)
        ? EXPECTED_PRICES[shipId]
        : null,
    };
  }

  /**
   * 购买预览：只做价格/材料是否足够与差额的纯计算，不扣款、不写库、不读存储。
   * 返回 `{ formula, shipId, ok, reason, price, credits, creditShortfall,
   *          materials, missingMaterials, owned, expectedPrice }`。
   * `ok === true` 表示当前钱包可以立刻购买（已拥有/价格非法时为 false 并给 reason）。
   */
  function previewPurchase(options) {
    try {
      const opts = isObject(options) ? options : {};
      const ship = isObject(opts.ship) ? opts.ship : null;
      const wallet = isObject(opts.wallet) ? opts.wallet : {};
      const credits = clampInt(wallet.credits, 0, Number.MAX_SAFE_INTEGER, 0);
      const shipId = ship && typeof ship.shipId === 'string' ? ship.shipId : '';
      if (!ship) return invalidPurchase(shipId, credits, 'invalid-ship');

      const rawPrice = shipPrice(ship);
      if (rawPrice === null || Math.floor(rawPrice) !== rawPrice || rawPrice < 0 ||
          rawPrice > RULESET_MIRROR.maxPurchaseCost) {
        return invalidPurchase(shipId, credits, 'invalid-price');
      }
      const price = rawPrice;
      const materials = shipMaterials(ship);
      const walletItems = normalizeMaterials(wallet.items);
      const missingMaterials = {};
      Object.keys(materials).forEach(function (itemId) {
        const have = walletItems[itemId] || 0;
        if (materials[itemId] > have) missingMaterials[itemId] = materials[itemId] - have;
      });
      const creditShortfall = price > credits ? price - credits : 0;
      const owned = isObject(ship) && ship.owned === true;

      let reason = null;
      if (owned) reason = 'already-owned';
      else if (creditShortfall > 0) reason = 'insufficient-credits';
      else if (Object.keys(missingMaterials).length > 0) reason = 'insufficient-materials';

      return {
        formula: FORMULA_VERSION,
        shipId: shipId,
        ok: reason === null,
        reason: reason,
        price: price,
        credits: credits,
        creditShortfall: creditShortfall,
        materials: materials,
        missingMaterials: missingMaterials,
        owned: owned,
        expectedPrice: Object.prototype.hasOwnProperty.call(EXPECTED_PRICES, shipId)
          ? EXPECTED_PRICES[shipId]
          : null,
      };
    } catch (err) {
      return invalidPurchase('', 0, 'invalid-ship');
    }
  }

  /* ---------------------------------------------------------------- 导出 */

  const api = {
    FORMULA_VERSION: FORMULA_VERSION,
    CLASSIC_FORMULA_VERSION: CLASSIC_FORMULA_VERSION,
    DEFAULT_SHIP_ID: DEFAULT_SHIP_ID,
    DEFAULT_SHIP_NAME: DEFAULT_SHIP_NAME,
    EXPECTED_SHIP_IDS: EXPECTED_SHIP_IDS,
    EXPECTED_PRICES: EXPECTED_PRICES,
    DEFAULT_SHIP_NAMES: DEFAULT_SHIP_NAMES,
    BUILTIN_MODULE_MAX: BUILTIN_MODULE_MAX,
    SAFE_LIMITS: SAFE_LIMITS,
    RULESET_MIRROR: RULESET_MIRROR,
    classicHangarStats: classicHangarStats,
    clampLevels: clampLevels,
    resolveCareerConfig: resolveCareerConfig,
    previewPurchase: previewPurchase,
  };

  return api;
});
