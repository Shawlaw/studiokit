/*!
 * StudioKit Arcade Life — 单职业主线路线规划（0.17，D17-24）
 *
 * 职责：给定「任一起源 + 一个职业 + 当前钱包/委托/收据/剧情旗标」，输出一条
 * 不依赖固定战斗、也不依赖某一款游戏不可替代的合理主线路线：
 * - 职业委托链按内容里的 unlock 依赖做拓扑排序，只排「下一步能接的」；
 * - 战斗职业没有自有船时先排免费租机（不买机也能交差；失败不丢机）；
 * - 材料缺口只作为可顺路选项（主线委托本身不扣材料），商店固定价/其他入门
 *   工单/代办至少三种替代路线都会写清楚；
 * - C2–C4 门槛交给注入的 story-evidence 模块做只读推导，本模块不发奖、不写库，
 *   只把「还缺什么、还能怎么走」翻译成可读步骤与 blocker；
 * - 熟练/专家（3/6 条本职业委托已交差）给「熟路」：不重读开场信、同阶先挑
 *   工钱高的熟单、替代路线先排零成本项——只改顺序，不改内容里的任何数值。
 *
 * 接口（UMD）：window.ArcadeCareerRoutePlanner + window.ArcadeCareer.routePlanner；
 * Node 中 module.exports 返回同一 API。create() 生成隔离实例。
 * plan() 的 ok=true 表示「输入与内容可用且已产出路线」（可以带可解释 blockers）；
 * complete=true 才表示这条职业主线已全部交差或剩余各阶都已排入、无卡点。
 *
 * 契约依据：docs/arcade-life/ADR-interfaces.md §19.5 / §19.6（materials/story-evidence/
 * route-planner）；apps/arcade/career/content/commissions.json（首季委托内容）、
 * content/items.json（五材/飞船/模块）、content/chapter-01.json（起源/路径）；
 * materials.js（价目/来源）、story-evidence.js（C2–C4 规则/证据）、professions.js
 * （等级阈值镜像）。
 *
 * 边界（不得越界）：
 * - 纯 UMD：无 DOM / IndexedDB / 网络 / 浏览器存储 / 文件系统；不 require 其它模块；
 * - 不写库、不扣款、不发奖、不写任何游戏内数值；只读内容并返回计划；
 * - 不依赖时钟或随机数；同一输入永远同一输出；不修改调用方传入的对象；
 * - 不硬编码游戏/职业数量；首季内容量只是内容数组长度，未来可插拔；
 * - 所有公开方法捕获异常并返回结构化结果，绝不向调用方抛。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory(typeof globalThis !== 'undefined' ? globalThis : this, true);
    return;
  }
  var api = factory(root, false);
  root.ArcadeCareerRoutePlanner = api;
  /* bridge.js 的统一依赖装载约定：镜像到 window.ArcadeCareer.<global>。 */
  var career = root.ArcadeCareer;
  if (!career || typeof career !== 'object') career = root.ArcadeCareer = {};
  if (career.routePlanner !== api) {
    try {
      career.routePlanner = api;
    } catch (err) {
      /* 只读宿主：忽略镜像失败，窗口级名字仍可用。 */
    }
  }
})(typeof window !== 'undefined' ? window : globalThis, function routePlannerFactory(root, isNode) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 常量（冻结；数值只在这里定义一次）
   * ------------------------------------------------------------------ */

  var MODULE_VERSION = '0.18.0';
  var SCHEMA_VERSION = 1;

  var ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
  var GAME_ID_RE = /^[a-z0-9][a-z0-9._-]{1,79}$/;
  var FLAG_RE = /^C[1-9]\.[a-z0-9][a-z0-9._-]{0,60}$/;
  var EVIDENCE_RE = /^(E|MAP|BP|DEC)-[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
  var MAX_TITLE = 120;
  var MAX_REASON = 220;
  var MAX_WALK = 8;

  var STEP_KINDS = Object.freeze(['commission', 'rental', 'market', 'alternative', 'story']);
  var ALTERNATIVE_KINDS = Object.freeze(['work', 'research', 'trade', 'rental', 'alternative']);

  /* 故事证据前缀的中文口径（只用于可读文本，不参与任何判定）。 */
  var CLASS_LABELS = Object.freeze({
    E: '现场记录',
    MAP: '航线图',
    BP: '研究底稿',
    DEC: '决定记录',
  });

  /* 首季五材的兜底中文名（内容缺名时只用于展示，不发明材料）。 */
  var MATERIAL_LABELS = Object.freeze({
    building: '建材',
    alloy: '合金',
    electronics: '电子元件',
    starcrystal: '星晶',
    biomass: '生物材料',
  });

  /* 0.16 遗留别名：只做查询映射，绝不新增材料。 */
  var DEFAULT_ALIASES = Object.freeze({ crystal: 'starcrystal' });

  /* ADR §19.4：真实事件目录里的战斗事件 kind（用于判断「要不要租机」）。 */
  var COMBAT_EVENT_KINDS = Object.freeze(['boss.defeated', 'enemy.killed', 'wave.completed']);

  /* 与 professions.js 冻结阈值保持一致（只读镜像；测试逐项防漂移）。 */
  var LEVELS = Object.freeze([
    Object.freeze({ level: 1, id: 'apprentice', name: '学徒' }),
    Object.freeze({ level: 2, id: 'veteran', name: '熟练' }),
    Object.freeze({ level: 3, id: 'expert', name: '专家' }),
  ]);
  var THRESHOLDS = Object.freeze({ veteran: 3, expert: 6 });

  /* 只影响规划口径，不影响任何玩法数值。 */
  var REINFORCED_MIN_LEVEL = 2;
  var BALANCE_CAP = 1000000;
  var ITEM_CAP = 999;

  var REASONS = Object.freeze({
    notConfigured: 'not-configured',
    inputMissing: 'input-missing',
    contentMissing: 'content-missing',
    contentInvalid: 'content-invalid',
    unknownOrigin: 'unknown-origin',
    unknownProfession: 'unknown-profession',
    badPlan: 'bad-plan',
    exception: 'exception',
    noCommissions: 'no-commissions',
    chainCycle: 'chain-cycle',
  });

  /* 公共 API 上不允许出现经济写入口（防越界）。 */
  var FORBIDDEN_API_RE = /(purchase|sell|settle|grant|ledger|balance|wallet|write|delete|save)/i;

  /* 静态边界检查用的禁止片段：运行时拼接，避免本文件自身出现连续敏感字符串。 */
  var FORBIDDEN_SOURCE = Object.freeze([
    Object.freeze(['local' + 'Storage', '浏览器本地存储']),
    Object.freeze(['session' + 'Storage', '会话存储']),
    Object.freeze(['docu' + 'ment.', 'DOM 访问']),
    Object.freeze(['fetch' + '(', '网络请求']),
    Object.freeze(['XMLH' + 'ttpRequest', '网络请求']),
    Object.freeze(['Web' + 'Socket', '网络请求']),
    Object.freeze(['send' + 'Beacon', '网络请求']),
    Object.freeze(['requ' + 'ire(', '其它模块']),
    Object.freeze(['indexed' + 'DB', '直连存储']),
    Object.freeze(['ArcadeCareer.' + 'db', '直连全局 DB']),
    Object.freeze(['.pu' + 't(', '写库']),
    Object.freeze(['.del' + 'ete(', '删库']),
    Object.freeze(['Math.' + 'random', '随机数']),
    Object.freeze(['performance.' + 'now', '时钟']),
  ]);
  var FORBIDDEN_CLOCK_RE = new RegExp('\\b' + 'Da' + 'te' + '\\b');

  /* explain/plan 里不允许出现的系统营销词（只检查生成文案，不改内容 title）。 */
  var FORBIDDEN_TEXT = Object.freeze([
    '奖励', '福利', '礼包', '充值', '首充', '限时', '签到', '抽奖', '氪金',
    '爆率', '必玩', '超值', '攻略', '任务系统', '成就系统', '活动',
  ]);

  /* ------------------------------------------------------------------ *
   * 基础工具（纯 JS；不抛异常给调用方）
   * ------------------------------------------------------------------ */

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isFunction(value) {
    return typeof value === 'function';
  }

  function has(object, key) {
    return !!object && Object.prototype.hasOwnProperty.call(object, key);
  }

  function isFiniteInt(value) {
    return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
  }

  function nonNegInt(value, fallback) {
    var num = Number(value);
    if (!isFinite(num)) return typeof fallback === 'number' ? fallback : 0;
    var floored = Math.floor(num);
    return floored < 0 ? 0 : floored;
  }

  function toPositiveInt(value, fallback) {
    var num = Number(value);
    if (!isFinite(num) || Math.floor(num) < 1) return typeof fallback === 'number' ? fallback : 1;
    return Math.floor(num);
  }

  function trimText(value, max) {
    if (typeof value !== 'string') return '';
    var text = value.trim();
    if (max && text.length > max) text = text.slice(0, max);
    return text;
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
    if (!err) return 'unknown-error';
    if (typeof err === 'string') return err;
    try {
      if (err.name && err.message) return String(err.name) + ': ' + String(err.message);
      return String(err.message || err.name || 'unknown-error');
    } catch (e) {
      return 'unknown-error';
    }
  }

  function makeMap() {
    return Object.create(null);
  }

  function mark(map, key) {
    if (typeof key === 'string' && key) map[key] = true;
  }

  function marked(map, key) {
    return !!map && typeof key === 'string' && map[key] === true;
  }

  function markAll(map, values) {
    if (!Array.isArray(values)) return map;
    for (var i = 0; i < values.length; i += 1) mark(map, values[i]);
    return map;
  }

  function mapValues(map) {
    return Object.keys(map).sort();
  }

  function uniqueSorted(list) {
    var seen = makeMap();
    var out = [];
    if (!Array.isArray(list)) return out;
    for (var i = 0; i < list.length; i += 1) {
      var value = list[i];
      if (typeof value !== 'string' || !value || seen[value]) continue;
      seen[value] = true;
      out.push(value);
    }
    out.sort();
    return out;
  }

  function tokenArray(value) {
    var out = [];
    if (!Array.isArray(value)) return out;
    for (var i = 0; i < value.length; i += 1) {
      if (typeof value[i] === 'string' && value[i]) out.push(value[i]);
    }
    return out;
  }

  function compareText(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  function compareCommissionStandard(a, b) {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return compareText(a.commissionId, b.commissionId);
  }

  function compareCommissionReinforced(a, b) {
    if (a.repeatSalaryCredits !== b.repeatSalaryCredits) return b.repeatSalaryCredits - a.repeatSalaryCredits;
    return compareCommissionStandard(a, b);
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
   * 内容输入（数组 / 内容包 / bridge 的 payload 都接受）
   * ------------------------------------------------------------------ */

  function readCommissionList(input) {
    if (Array.isArray(input)) return input;
    if (isObject(input) && Array.isArray(input.commissions)) return input.commissions;
    if (isObject(input) && isObject(input.content) && Array.isArray(input.content.commissions)) {
      return input.content.commissions;
    }
    return null;
  }

  function readItemsContent(input) {
    if (isObject(input) && (Array.isArray(input.ships) || Array.isArray(input.materials) || Array.isArray(input.modules))) {
      return input;
    }
    if (isObject(input) && isObject(input.content) && isObject(input.content.items)) return input.content.items;
    if (isObject(input) && isObject(input.items) && Array.isArray(input.items.materials)) return input.items;
    return null;
  }

  function readChapterContent(input) {
    if (Array.isArray(input)) return { origins: input };
    if (isObject(input) && Array.isArray(input.origins)) return input;
    if (isObject(input) && Array.isArray(input.chapters)) return input;
    if (isObject(input) && isObject(input.content) && isObject(input.content.chapter)) return input.content.chapter;
    if (isObject(input) && isObject(input.chapter) && Array.isArray(input.chapter.origins)) return input.chapter;
    return null;
  }

  function readRegistryContent(input, warnings) {
    var out = { games: [], professions: [], provided: false };
    if (input === undefined || input === null) return out;
    if (isObject(input) && typeof input.listGames === 'function' && typeof input.listProfessions === 'function') {
      try {
        var games = input.listGames();
        var professions = input.listProfessions();
        out.games = Array.isArray(games) ? games.map(clone).filter(isObject) : [];
        out.professions = Array.isArray(professions) ? professions.map(clone).filter(isObject) : [];
        out.provided = true;
      } catch (err) {
        warnings.push('registry-unreadable');
      }
      return out;
    }
    if (isObject(input) && isObject(input.content) && (Array.isArray(input.content.games) || Array.isArray(input.content.professions))) {
      input = input.content;
    }
    if (!isObject(input)) {
      warnings.push('registry-invalid');
      return out;
    }
    if (Array.isArray(input.games)) out.games = input.games.filter(isObject).map(clone);
    if (Array.isArray(input.professions)) out.professions = input.professions.filter(isObject).map(clone);
    out.provided = Array.isArray(input.games) || Array.isArray(input.professions);
    if (!out.provided) warnings.push('registry-invalid');
    return out;
  }

  function isModuleLike(value, methods) {
    if (!isObject(value)) return false;
    for (var i = 0; i < methods.length; i += 1) {
      if (!isFunction(value[methods[i]])) return false;
    }
    return true;
  }

  function readMaterialsOption(input, warnings) {
    if (input === undefined || input === null) return { module: null, content: null };
    if (isModuleLike(input, ['listMaterials', 'getMaterial', 'priceOf'])) {
      var usable = true;
      if (isFunction(input.isConfigured)) {
        try {
          usable = input.isConfigured() === true;
        } catch (err) {
          usable = false;
        }
      }
      if (!usable) warnings.push('materials-unconfigured');
      return { module: input, content: null };
    }
    var content = readItemsContent(input);
    if (content) return { module: null, content: content };
    warnings.push('materials-invalid');
    return { module: null, content: null };
  }

  function readEvidenceOption(input, warnings) {
    if (input === undefined || input === null) return null;
    if (isModuleLike(input, ['storyFlags', 'contextFor'])) {
      var usable = true;
      if (isFunction(input.isConfigured)) {
        try {
          usable = input.isConfigured() === true;
        } catch (err) {
          usable = false;
        }
      }
      if (!usable) warnings.push('evidence-unconfigured');
      return input;
    }
    warnings.push('evidence-invalid');
    return null;
  }

  function readAlternativesOption(input, warnings) {
    if (input === undefined || input === null) return [];
    var list = null;
    if (Array.isArray(input)) list = input;
    else if (isObject(input) && Array.isArray(input.offers)) list = input.offers;
    else if (isObject(input) && isModuleLike(input, ['getOffer']) && isFunction(input.getState)) {
      /* alternatives.js 单例不导出静态目录；保留注入缝但不猜测内容。 */
      warnings.push('alternatives-not-enumerable');
      return [];
    }
    if (!Array.isArray(list)) {
      warnings.push('alternatives-invalid');
      return [];
    }
    return list;
  }

  /* ------------------------------------------------------------------ *
   * 内容规整
   * ------------------------------------------------------------------ */

  function buildAliasMap(items, warnings) {
    var alias = makeMap();
    alias.crystal = 'starcrystal';
    if (isObject(items) && items.materialAliases !== undefined) {
      if (!isObject(items.materialAliases)) {
        warnings.push('material-aliases-invalid');
        return alias;
      }
      Object.keys(items.materialAliases).forEach(function (key) {
        var target = items.materialAliases[key];
        if (typeof key !== 'string' || !key || typeof target !== 'string' || !target) {
          warnings.push('material-alias-invalid:' + String(key));
          return;
        }
        alias[key] = target;
      });
    }
    return alias;
  }

  function canonicalItemId(alias, itemId) {
    if (typeof itemId !== 'string' || !itemId) return null;
    if (alias && has(alias, itemId)) return alias[itemId];
    return itemId;
  }

  function sanitizeReward(rawReward, alias, warnings, commissionId) {
    var raw = isObject(rawReward) ? rawReward : {};
    var credits = raw.credits;
    if (credits !== undefined && (!isFiniteInt(credits) || credits < 0)) {
      warnings.push('reward-credits:' + commissionId);
      credits = 0;
    }
    var items = {};
    if (raw.items !== undefined) {
      if (!isObject(raw.items)) {
        warnings.push('reward-items:' + commissionId);
      } else {
        Object.keys(raw.items).forEach(function (key) {
          var canonical = canonicalItemId(alias, key);
          var count = raw.items[key];
          if (!canonical) return;
          if (!isFiniteInt(count) || count <= 0) {
            warnings.push('reward-item-count:' + commissionId + ':' + key);
            return;
          }
          items[canonical] = (items[canonical] || 0) + count;
        });
      }
    }
    var evidence = [];
    if (raw.evidence !== undefined) {
      if (!Array.isArray(raw.evidence)) {
        warnings.push('reward-evidence:' + commissionId);
      } else {
        raw.evidence.forEach(function (token) {
          if (typeof token === 'string' && EVIDENCE_RE.test(token)) {
            if (evidence.indexOf(token) < 0) evidence.push(token);
          } else {
            warnings.push('reward-evidence-token:' + commissionId);
          }
        });
      }
    }
    var flags = [];
    if (raw.flags !== undefined) {
      if (!Array.isArray(raw.flags)) {
        warnings.push('reward-flags:' + commissionId);
      } else {
        raw.flags.forEach(function (flag) {
          if (typeof flag === 'string' && FLAG_RE.test(flag) && flags.indexOf(flag) < 0) flags.push(flag);
        });
      }
    }
    return { credits: credits === undefined ? 0 : credits, items: items, evidence: evidence, flags: flags };
  }

  function sanitizeUnlock(raw, warnings, commissionId) {
    if (raw === undefined || raw === null) return { all: [] };
    if (!isObject(raw)) {
      warnings.push('unlock-invalid:' + commissionId);
      return { all: [] };
    }
    for (var i = 0; i < Object.keys(raw).length; i += 1) {
      var key = Object.keys(raw)[i];
      if (key !== 'all' && key !== 'any') {
        warnings.push('unlock-key:' + commissionId + ':' + key);
      }
    }
    if (raw.all !== undefined && !Array.isArray(raw.all)) {
      warnings.push('unlock-all:' + commissionId);
      return { all: [] };
    }
    if (raw.any !== undefined && !Array.isArray(raw.any)) {
      warnings.push('unlock-any:' + commissionId);
    }
    return clone(raw) || { all: [] };
  }

  function sanitizeCommission(raw, index, alias, errors, warnings) {
    if (!isObject(raw)) {
      errors.push('commission[' + index + ']:not-object');
      return null;
    }
    var commissionId = raw.commissionId;
    if (typeof commissionId !== 'string' || !ID_RE.test(commissionId)) {
      errors.push('commission[' + index + ']:bad-commissionId');
      return null;
    }
    var gameId = raw.gameId;
    if (typeof gameId !== 'string' || !GAME_ID_RE.test(gameId)) {
      errors.push('commission ' + commissionId + ':bad-gameId');
      return null;
    }
    var professionId = raw.professionId;
    if (typeof professionId !== 'string' || !ID_RE.test(professionId)) {
      errors.push('commission ' + commissionId + ':bad-professionId');
      return null;
    }
    var tier = raw.tier;
    if (!isFiniteInt(tier) || tier < 1 || tier > 12) {
      errors.push('commission ' + commissionId + ':bad-tier');
      return null;
    }
    var title = trimText(raw.title, MAX_TITLE) || commissionId;
    var objective = isObject(raw.objective) ? { kind: trimText(raw.objective.kind, 80) } : { kind: '' };
    var chapterGate = null;
    if (raw.chapterGate !== undefined && raw.chapterGate !== null) {
      if (typeof raw.chapterGate === 'string' && FLAG_RE.test(raw.chapterGate)) chapterGate = raw.chapterGate;
      else warnings.push('chapter-gate-invalid:' + commissionId);
    }
    var repeatSalaryCredits = raw.repeatSalaryCredits;
    if (repeatSalaryCredits !== undefined && (!isFiniteInt(repeatSalaryCredits) || repeatSalaryCredits < 0)) {
      warnings.push('repeat-salary:' + commissionId);
      repeatSalaryCredits = 0;
    }
    return {
      commissionId: commissionId,
      gameId: gameId,
      professionId: professionId,
      tier: tier,
      title: title,
      summary: trimText(raw.summary, MAX_REASON),
      issuer: trimText(raw.issuer, 80),
      objective: objective,
      startParams: isObject(raw.startParams) ? clone(raw.startParams) || {} : {},
      reward: sanitizeReward(raw.reward, alias, warnings, commissionId),
      repeatSalaryCredits: repeatSalaryCredits === undefined ? 0 : repeatSalaryCredits,
      unlock: sanitizeUnlock(raw.unlock, warnings, commissionId),
      chapterGate: chapterGate,
      risk: trimText(raw.risk, 24) || 'low',
    };
  }

  function sanitizeOrigin(raw, index, warnings) {
    if (!isObject(raw)) {
      warnings.push('origin[' + index + ']:not-object');
      return null;
    }
    var gameId = raw.gameId;
    if (typeof gameId !== 'string' || !GAME_ID_RE.test(gameId)) {
      warnings.push('origin[' + index + ']:bad-gameId');
      return null;
    }
    var letter = isObject(raw.c0Letter) ? raw.c0Letter : {};
    return {
      gameId: gameId,
      professionId: typeof raw.professionId === 'string' ? raw.professionId : '',
      opening: trimText(raw.opening, MAX_REASON),
      firstStep: trimText(raw.firstStep, MAX_REASON),
      from: trimText(letter.from, 80),
      address: trimText(letter.address, 120),
    };
  }

  function sanitizeShip(raw, index, warnings) {
    if (!isObject(raw)) {
      warnings.push('ship[' + index + ']:not-object');
      return null;
    }
    var shipId = raw.shipId;
    if (typeof shipId !== 'string' || !ID_RE.test(shipId)) {
      warnings.push('ship[' + index + ']:bad-shipId');
      return null;
    }
    var price = raw.price;
    if (!isFiniteInt(price) || price < 0) {
      warnings.push('ship ' + shipId + ':bad-price');
      price = 0;
    }
    return {
      shipId: shipId,
      name: trimText(raw.name, 80) || shipId,
      price: price,
      rental: raw.rental === true,
    };
  }

  function sanitizeMaterial(raw, index, warnings) {
    if (!isObject(raw)) {
      warnings.push('material[' + index + ']:not-object');
      return null;
    }
    var itemId = raw.itemId;
    if (typeof itemId !== 'string' || !ID_RE.test(itemId)) {
      warnings.push('material[' + index + ']:bad-itemId');
      return null;
    }
    var buyPrice = raw.buyPrice;
    var sellPrice = raw.sellPrice;
    if (!isFiniteInt(buyPrice) || buyPrice <= 0) {
      warnings.push('material ' + itemId + ':bad-buyPrice');
      return null;
    }
    if (!isFiniteInt(sellPrice) || sellPrice < 0) {
      warnings.push('material ' + itemId + ':bad-sellPrice');
      sellPrice = 0;
    }
    var aliases = [];
    if (Array.isArray(raw.aliases)) {
      raw.aliases.forEach(function (aliasId) {
        if (typeof aliasId === 'string' && aliasId && aliases.indexOf(aliasId) < 0) aliases.push(aliasId);
      });
    }
    var sources = [];
    if (Array.isArray(raw.sources)) {
      raw.sources.forEach(function (gameId) {
        if (typeof gameId === 'string' && GAME_ID_RE.test(gameId) && sources.indexOf(gameId) < 0) sources.push(gameId);
      });
    }
    return {
      itemId: itemId,
      name: trimText(raw.name, 80) || MATERIAL_LABELS[itemId] || itemId,
      buyPrice: buyPrice,
      sellPrice: sellPrice,
      aliases: aliases,
      sources: sources,
    };
  }

  function sanitizeOffer(raw, index, alias, warnings) {
    if (!isObject(raw)) {
      warnings.push('offer[' + index + ']:not-object');
      return null;
    }
    var offerId = raw.offerId;
    if (typeof offerId !== 'string' || !ID_RE.test(offerId)) {
      warnings.push('offer[' + index + ']:bad-offerId');
      return null;
    }
    var rawCost = isObject(raw.cost) ? raw.cost : {};
    var credits = rawCost.credits === undefined ? 0 : rawCost.credits;
    if (!isFiniteInt(credits) || credits < 0) {
      warnings.push('offer ' + offerId + ':bad-credits');
      credits = 0;
    }
    var items = {};
    if (isObject(rawCost.items)) {
      Object.keys(rawCost.items).forEach(function (key) {
        var canonical = canonicalItemId(alias, key);
        var count = rawCost.items[key];
        if (!canonical || !isFiniteInt(count) || count <= 0) return;
        items[canonical] = (items[canonical] || 0) + count;
      });
    }
    return {
      offerId: offerId,
      title: trimText(raw.title, MAX_TITLE) || offerId,
      summary: trimText(raw.summary, MAX_REASON),
      issuer: trimText(raw.issuer, 80),
      cost: { credits: credits, items: items },
      flags: tokenArray(raw.flags).filter(function (flag) {
        return FLAG_RE.test(flag);
      }),
      evidence: tokenArray(raw.evidence).filter(function (token) {
        return EVIDENCE_RE.test(token);
      }),
    };
  }

  /* ------------------------------------------------------------------ *
   * 内容状态（configure 失败保留上一次成功状态）
   *
   * 每个实例在 buildInstance() 内拥有自己的 state；create() 返回互不影响的
   * 独立实例，默认导出本身就是其中一个实例。
   * ------------------------------------------------------------------ */

  function buildInstance() {

  function emptyState() {
    return {
      configured: false,
      contentVersion: null,
      commissions: [],
      commissionSet: makeMap(),
      byProfession: makeMap(),
      professionIds: [],
      professionSet: makeMap(),
      professionMeta: makeMap(),
      gameIds: [],
      gameSet: makeMap(),
      gameNames: makeMap(),
      originMap: makeMap(),
      originIds: [],
      chapter: null,
      materials: [],
      materialIds: [],
      materialIndex: makeMap(),
      materialAlias: makeMap(),
      sourceIndex: makeMap(),
      dropGames: makeMap(),
      ships: [],
      rentalShip: null,
      combatGames: makeMap(),
      tokenIndex: makeMap(),
      alternatives: [],
      evidence: null,
      warnings: [],
      materialsSource: 'none',
    };
  }

  var state = emptyState();

  function buildNextState(options, errors, warnings) {
    var next = emptyState();
    var items = readItemsContent(options.items);
    var alias = buildAliasMap(items, warnings);
    next.materialAlias = alias;

    /* ---- 委托（必需） ---- */
    var rawCommissions = readCommissionList(options.commissions);
    if (rawCommissions === null) {
      errors.push('commissions-missing');
    } else if (rawCommissions.length === 0) {
      errors.push('commissions-empty');
    }
    var accepted = [];
    var seen = makeMap();
    if (rawCommissions !== null) {
      for (var i = 0; i < rawCommissions.length; i += 1) {
        var record = sanitizeCommission(rawCommissions[i], i, alias, errors, warnings);
        if (!record) continue;
        if (seen[record.commissionId]) {
          errors.push('commission-duplicate:' + record.commissionId);
          continue;
        }
        seen[record.commissionId] = true;
        accepted.push(record);
      }
    }
    accepted.sort(compareCommissionStandard);
    next.commissions = accepted;
    accepted.forEach(function (commission) {
      next.commissionSet[commission.commissionId] = true;
      if (!has(next.byProfession, commission.professionId)) next.byProfession[commission.professionId] = [];
      next.byProfession[commission.professionId].push(commission);
      mark(next.gameSet, commission.gameId);
      if (COMBAT_EVENT_KINDS.indexOf(commission.objective.kind) >= 0) mark(next.combatGames, commission.gameId);
    });

    /* ---- 章节（可选；起源/路径仅用于叙事与代办兜底） ---- */
    var chapter = readChapterContent(options.chapter);
    next.chapter = chapter;
    if (chapter) {
      var rawOrigins = Array.isArray(chapter.origins) ? chapter.origins : [];
      rawOrigins.forEach(function (rawOrigin, index) {
        var origin = sanitizeOrigin(rawOrigin, index, warnings);
        if (!origin) return;
        if (has(next.originMap, origin.gameId)) {
          warnings.push('origin-duplicate:' + origin.gameId);
          return;
        }
        next.originMap[origin.gameId] = origin;
        mark(next.gameSet, origin.gameId);
      });
    }

    /* ---- registry（可选；只补显示名/职业目录） ---- */
    var registry = readRegistryContent(options.registry, warnings);
    var registryProfessionMeta = makeMap();
    registry.professions.forEach(function (raw) {
      if (!isObject(raw)) return;
      var professionId = raw.professionId;
      if (typeof professionId !== 'string' || !ID_RE.test(professionId)) {
        warnings.push('registry-profession-invalid');
        return;
      }
      registryProfessionMeta[professionId] = {
        displayName: trimText(raw.displayName, 80) || professionId,
        domain: trimText(raw.domain, 40) || domainOf(professionId),
      };
      mark(next.professionSet, professionId);
    });
    registry.games.forEach(function (raw) {
      if (!isObject(raw)) return;
      var gameId = raw.gameId;
      if (typeof gameId !== 'string' || !GAME_ID_RE.test(gameId)) {
        warnings.push('registry-game-invalid');
        return;
      }
      mark(next.gameSet, gameId);
      if (typeof raw.displayName === 'string' && raw.displayName.trim()) {
        next.gameNames[gameId] = trimText(raw.displayName, 80);
      }
    });

    /* ---- 职业目录 = registry ∪ 委托实际引用（不硬编码数量） ---- */
    accepted.forEach(function (commission) {
      mark(next.professionSet, commission.professionId);
      if (!has(next.professionMeta, commission.professionId)) {
        next.professionMeta[commission.professionId] = {
          displayName: (registryProfessionMeta[commission.professionId] || {}).displayName || commission.professionId,
          domain: (registryProfessionMeta[commission.professionId] || {}).domain || domainOf(commission.professionId),
        };
      }
    });
    Object.keys(registryProfessionMeta).forEach(function (professionId) {
      if (!has(next.professionMeta, professionId)) next.professionMeta[professionId] = registryProfessionMeta[professionId];
    });
    next.professionIds = mapValues(next.professionSet);

    /* ---- 材料目录：注入的材料模块优先，其次 items.json ---- */
    var materialsOption = readMaterialsOption(options.materials, warnings);
    var rawMaterials = [];
    var materialsSource = 'none';
    if (materialsOption.module) {
      try {
        var listed = materialsOption.module.listMaterials();
        if (Array.isArray(listed) && listed.length) {
          rawMaterials = listed;
          materialsSource = 'module';
        }
      } catch (err) {
        warnings.push('materials-list-failed');
      }
    }
    if (!rawMaterials.length && isObject(items) && Array.isArray(items.materials)) {
      rawMaterials = items.materials;
      materialsSource = 'content';
    }
    var materialSeen = makeMap();
    rawMaterials.forEach(function (rawMaterial, index) {
      var material = sanitizeMaterial(rawMaterial, index, warnings);
      if (!material) return;
      var canonical = canonicalItemId(alias, material.itemId);
      if (!canonical || materialSeen[canonical]) return;
      materialSeen[canonical] = true;
      material.itemId = canonical;
      next.materials.push(material);
      next.materialIndex[canonical] = material;
    });
    next.materialsSource = materialsSource;
    next.materialIds = next.materials.map(function (material) {
      return material.itemId;
    });
    if (!next.materials.length) warnings.push('materials-missing');

    /* ---- 委托奖励里的材料来源（主线委托本身不消耗材料） ---- */
    accepted.forEach(function (commission) {
      Object.keys(commission.reward.items).forEach(function (itemId) {
        if (!has(next.sourceIndex, itemId)) next.sourceIndex[itemId] = [];
        next.sourceIndex[itemId].push({
          gameId: commission.gameId,
          commissionId: commission.commissionId,
          tier: commission.tier,
          count: commission.reward.items[itemId],
        });
      });
    });
    if (materialsOption.module) {
      next.materials.forEach(function (material) {
        if (typeof materialsOption.module.sourcesFor !== 'function') return;
        try {
          var games = materialsOption.module.sourcesFor(material.itemId);
          if (Array.isArray(games) && games.length) {
            next.dropGames[material.itemId] = games.filter(function (gameId) {
              return typeof gameId === 'string' && GAME_ID_RE.test(gameId);
            }).sort();
          }
        } catch (err) {
          /* 只读来源缺失不影响规划 */
        }
      });
    }

    /* ---- 飞船：免费租用机优先取最低价的 rental === true ---- */
    var rawShips = isObject(items) && Array.isArray(items.ships) ? items.ships : [];
    rawShips.forEach(function (rawShip, index) {
      var ship = sanitizeShip(rawShip, index, warnings);
      if (ship) next.ships.push(ship);
    });
    next.ships.sort(function (a, b) {
      if (a.price !== b.price) return a.price - b.price;
      return compareText(a.shipId, b.shipId);
    });
    for (var s = 0; s < next.ships.length; s += 1) {
      if (next.ships[s].rental === true) {
        next.rentalShip = next.ships[s];
        break;
      }
    }

    /* ---- 证据 token → 委托 索引（用于把缺口翻译成可接的工单） ---- */
    accepted.forEach(function (commission) {
      commission.reward.evidence.forEach(function (token) {
        if (!has(next.tokenIndex, token)) {
          next.tokenIndex[token] = {
            token: token,
            className: token.slice(0, token.indexOf('-')),
            gameId: commission.gameId,
            commissionId: commission.commissionId,
            title: commission.title,
            tier: commission.tier,
            chapterGate: commission.chapterGate,
          };
        } else {
          warnings.push('evidence-duplicate:' + token);
        }
      });
    });

    /* ---- registry 里没有委托的游戏也保留为可选起源（不硬编码清单） ---- */
    next.gameIds = mapValues(next.gameSet);
    next.originIds = uniqueSorted(next.gameIds.concat(Object.keys(next.originMap)));
    next.evidence = readEvidenceOption(options.evidence, warnings);
    var offerSeen = makeMap();
    next.alternatives = readAlternativesOption(
      options.alternatives !== undefined ? options.alternatives : options.offers,
      warnings
    )
      .map(function (rawOffer, index) {
        return sanitizeOffer(rawOffer, index, alias, warnings);
      })
      .filter(function (offer) {
        if (!offer) return false;
        if (offerSeen[offer.offerId]) {
          warnings.push('offer-duplicate:' + offer.offerId);
          return false;
        }
        offerSeen[offer.offerId] = true;
        return true;
      })
      .sort(function (a, b) {
        if (a.cost.credits !== b.cost.credits) return a.cost.credits - b.cost.credits;
        return compareText(a.offerId, b.offerId);
      });

    /* ---- 内容版本（只读展示） ---- */
    var contentVersion = null;
    if (isObject(options.commissions) && typeof options.commissions.contentVersion === 'string') {
      contentVersion = options.commissions.contentVersion;
    } else if (isObject(items) && typeof items.contentVersion === 'string') {
      contentVersion = items.contentVersion;
    } else if (isObject(chapter) && typeof chapter.contentVersion === 'string') {
      contentVersion = chapter.contentVersion;
    } else if (isObject(options.content) && typeof options.content.contentVersion === 'string') {
      contentVersion = options.content.contentVersion;
    }
    next.contentVersion = contentVersion;
    next.warnings = warnings.slice();
    next.configured = true;

    /* ---- 只读交叉校验（都不阻断规划） ---- */
    next.professionIds.forEach(function (professionId) {
      if (!has(next.byProfession, professionId)) warnings.push('profession-without-commissions:' + professionId);
      if (!has(next.professionMeta, professionId)) {
        next.professionMeta[professionId] = { displayName: professionId, domain: domainOf(professionId) };
      }
    });
    next.gameIds.forEach(function (gameId) {
      if (!has(next.gameNames, gameId)) next.gameNames[gameId] = gameId;
      if (!has(next.originMap, gameId)) warnings.push('origin-missing:' + gameId);
    });

    return next;
  }

  function configure(input) {
    try {
      var options;
      if (Array.isArray(input)) options = { commissions: input };
      else if (isObject(input) && isObject(input.content)) {
        options = {
          commissions: input.commissions !== undefined ? input.commissions : input.content.commissions,
          items: input.items !== undefined ? input.items : input.content.items,
          chapter: input.chapter !== undefined ? input.chapter : input.content.chapter,
          registry: input.registry !== undefined ? input.registry : input.content.registry,
          materials: input.materials !== undefined ? input.materials : input.content.materials,
          evidence: input.evidence !== undefined ? input.evidence : input.content.evidence,
          alternatives: input.alternatives !== undefined ? input.alternatives : input.content.alternatives,
          offers: input.offers,
        };
      } else if (isObject(input)) {
        options = input;
      } else {
        options = {};
      }
      var errors = [];
      var warnings = [];
      if (!isObject(options) || input === undefined || input === null) {
        return failure(REASONS.inputMissing, { errors: ['input-missing'], warnings: [], unchanged: true });
      }
      var next = buildNextState(options, errors, warnings);
      if (errors.length) {
        return {
          ok: false,
          reason: REASONS.contentInvalid,
          errors: errors.slice(),
          warnings: warnings.slice(),
          unchanged: true,
          commissionCount: next.commissions.length,
          professionCount: next.professionIds.length,
          gameCount: next.gameIds.length,
        };
      }
      state = next;
      return {
        ok: true,
        errors: [],
        warnings: state.warnings.slice(),
        commissionCount: state.commissions.length,
        professionCount: state.professionIds.length,
        gameCount: state.gameIds.length,
        originCount: state.originIds.length,
        materialCount: state.materials.length,
        shipCount: state.ships.length,
        rentalShipId: state.rentalShip ? state.rentalShip.shipId : null,
        hasEvidence: !!state.evidence,
        offerCount: state.alternatives.length,
        contentVersion: state.contentVersion,
      };
    } catch (err) {
      return failure(REASONS.exception, { error: errorText(err), errors: [REASONS.exception], unchanged: true });
    }
  }

  function reset() {
    state = emptyState();
    return { ok: true };
  }

  function isConfigured() {
    return state.configured === true;
  }

  function status() {
    return {
      moduleVersion: MODULE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      configured: isConfigured(),
      contentVersion: state.contentVersion,
      commissionCount: state.commissions.length,
      professionCount: state.professionIds.length,
      gameCount: state.gameIds.length,
      originCount: state.originIds.length,
      materialCount: state.materials.length,
      materialsSource: state.materialsSource,
      shipCount: state.ships.length,
      rentalShipId: state.rentalShip ? state.rentalShip.shipId : null,
      combatGameCount: Object.keys(state.combatGames).length,
      evidence: !!state.evidence,
      offerCount: state.alternatives.length,
      warnings: state.warnings.slice(),
    };
  }

  function domainOf(professionId) {
    var text = String(professionId || '');
    var dot = text.indexOf('.');
    return dot > 0 ? text.slice(0, dot) : text;
  }

  /* ------------------------------------------------------------------ *
   * 计划输入读取（钱包 / 任务 / 收据 / 旗标）
   * ------------------------------------------------------------------ */

  function walletView(value) {
    var source = isObject(value) ? value : {};
    if (isObject(source.wallet) && source.credits === undefined) source = source.wallet;
    var credits = nonNegInt(source.credits, 0);
    if (credits > BALANCE_CAP) credits = BALANCE_CAP;
    var items = {};
    if (isObject(source.items)) {
      Object.keys(source.items).forEach(function (key) {
        var canonical = canonicalItemId(state.materialAlias, key);
        if (!canonical) return;
        var count = nonNegInt(source.items[key], 0);
        if (count <= 0) return;
        items[canonical] = (items[canonical] || 0) + Math.min(count, ITEM_CAP);
      });
    }
    var equipment = {};
    if (isObject(source.equipment)) {
      Object.keys(source.equipment).forEach(function (key) {
        equipment[key] = clone(source.equipment[key]);
      });
    }
    if (typeof source.equippedShip === 'string' && source.equippedShip) equipment.equippedShip = source.equippedShip;
    return { credits: credits, items: items, equipment: equipment };
  }

  function rowsOf(value) {
    if (Array.isArray(value)) return value.filter(isObject);
    if (!isObject(value)) return [];
    if (Array.isArray(value.quests)) return rowsOf(value.quests);
    if (Array.isArray(value.claims)) return rowsOf(value.claims);
    if (isObject(value.byNode)) return Object.keys(value.byNode).map(function (key) {
      return value.byNode[key];
    }).filter(isObject);
    if (isObject(value.receipt)) return [value];
    if (isObject(value.claim)) return [value.claim];
    var out = [];
    Object.keys(value).forEach(function (key) {
      if (isObject(value[key])) out.push(value[key]);
    });
    return out;
  }

  function questRowsOf(value) {
    return rowsOf(value);
  }

  function claimRowsOf(value) {
    return rowsOf(value);
  }

  function readFlagsInput(value) {
    var out = makeMap();
    if (!value) return out;
    if (Array.isArray(value)) {
      markAll(out, value);
      return out;
    }
    if (isObject(value) && Array.isArray(value.flags)) {
      markAll(out, value.flags);
      return out;
    }
    if (isObject(value) && typeof value.forEach === 'function' && !isFunction(value.storyFlags)) {
      try {
        value.forEach(function (flag) {
          mark(out, flag);
        });
      } catch (err) {
        /* 非 Set 形状：忽略 */
      }
      return out;
    }
    if (isObject(value)) {
      Object.keys(value).forEach(function (key) {
        if (value[key]) mark(out, key);
      });
    }
    return out;
  }

  function collectStoredFlags(flagsInput, quests, claims) {
    var flags = makeMap();
    Object.keys(flagsInput).forEach(function (flag) {
      if (FLAG_RE.test(flag)) mark(flags, flag);
    });
    quests.forEach(function (row) {
      if (!isObject(row)) return;
      tokenArray(row.flags).forEach(function (flag) {
        if (FLAG_RE.test(flag)) mark(flags, flag);
      });
      if (typeof row.nodeId === 'string' && row.nodeId.indexOf('story:') === 0) {
        var flag = row.nodeId.slice('story:'.length);
        if (FLAG_RE.test(flag)) mark(flags, flag);
      }
    });
    claims.forEach(function (row) {
      if (!isObject(row)) return;
      var receipt = isObject(row.receipt) ? row.receipt : row;
      tokenArray(receipt.flags).forEach(function (flag) {
        if (FLAG_RE.test(flag)) mark(flags, flag);
      });
      tokenArray(row.flags).forEach(function (flag) {
        if (FLAG_RE.test(flag)) mark(flags, flag);
      });
    });
    return flags;
  }

  function collectEvidenceTokens(quests, claims) {
    var tokens = makeMap();
    function add(list) {
      tokenArray(list).forEach(function (token) {
        if (EVIDENCE_RE.test(token)) mark(tokens, token);
      });
    }
    quests.forEach(function (row) {
      if (!isObject(row)) return;
      add(row.evidence);
      if (row.kind === 'evidence' && typeof row.token === 'string' && EVIDENCE_RE.test(row.token)) mark(tokens, row.token);
      if (typeof row.nodeId === 'string' && row.nodeId.indexOf('evidence:') === 0) {
        var token = row.nodeId.slice('evidence:'.length);
        if (EVIDENCE_RE.test(token)) mark(tokens, token);
      }
    });
    claims.forEach(function (row) {
      if (!isObject(row)) return;
      var receipt = isObject(row.receipt) ? row.receipt : row;
      add(receipt.evidence);
    });
    return tokens;
  }

  function collectCleared(quests, claims) {
    var cleared = makeMap();
    function add(commissionId) {
      /* 只登记内容里真实存在的委托；未知 ID 一律忽略。 */
      if (typeof commissionId === 'string' && state.commissionSet[commissionId] === true) {
        cleared[commissionId] = true;
      }
    }
    quests.forEach(function (row) {
      if (!isObject(row)) return;
      if (typeof row.kind === 'string' && row.kind && row.kind !== 'commission') return;
      if (row.status !== 'cleared') return;
      add(row.commissionId);
      add(row.nodeId);
    });
    claims.forEach(function (row) {
      if (!isObject(row)) return;
      add(row.commissionId);
      if (isObject(row.receipt)) add(row.receipt.commissionId);
    });
    return cleared;
  }

  function countCleared(cleared) {
    return Object.keys(cleared).length;
  }

  function progressOf(list, cleared) {
    var count = 0;
    var maxTier = 0;
    for (var i = 0; i < list.length; i += 1) {
      if (marked(cleared, list[i].commissionId)) {
        count += 1;
        if (list[i].tier > maxTier) maxTier = list[i].tier;
      }
    }
    return { clearedCount: count, total: list.length, maxTier: maxTier };
  }

  /* ------------------------------------------------------------------ *
   * 剧情上下文（只读；story-evidence 注入时由它推导 C2–C4）
   * ------------------------------------------------------------------ */

  function activeEvidenceModule() {
    if (state.evidence) return state.evidence;
    /* 集成兜底：bridge 先装载/configure 了页面级 storyEvidence 时，只读借用它。 */
    try {
      var career = root && root.ArcadeCareer;
      var mod = career && career.storyEvidence;
      if (mod && isFunction(mod.storyFlags)) {
        if (isFunction(mod.isConfigured) && mod.isConfigured() !== true) return null;
        return mod;
      }
    } catch (err) {
      return null;
    }
    return null;
  }

  function evaluateStory(flagsInput, quests, claims, wallet) {
    var stored = collectStoredFlags(flagsInput, quests, claims);
    var tokens = collectEvidenceTokens(quests, claims);
    var unlocked = makeMap();
    Object.keys(stored).forEach(function (flag) {
      mark(unlocked, flag);
    });
    var result = {
      flags: unlocked,
      storedFlags: stored,
      missingByFlag: null,
      knownRuleFlags: makeMap(),
      tokens: tokens,
      evidenceUsed: false,
      warnings: [],
    };
    var evidence = activeEvidenceModule();
    if (!evidence) return result;
    try {
      if (isFunction(evidence.isConfigured) && evidence.isConfigured() !== true) {
        result.warnings.push('evidence-unconfigured');
        return result;
      }
      var story = evidence.storyFlags({
        quests: quests,
        claims: claims,
        wallet: { credits: wallet.credits, items: wallet.items },
        flags: mapValues(stored),
      });
      if (!isObject(story) || story.ok !== true) {
        result.warnings.push('evidence-read-failed');
        return result;
      }
      result.evidenceUsed = true;
      result.missingByFlag = isObject(story.missing) ? story.missing : makeMap();
      if (Array.isArray(story.flags)) {
        story.flags.forEach(function (flag) {
          mark(result.knownRuleFlags, flag);
        });
      }
      if (Array.isArray(story.allFlags)) {
        story.allFlags.forEach(function (flag) {
          mark(unlocked, flag);
        });
      }
      if (Array.isArray(story.storedFlags)) {
        story.storedFlags.forEach(function (flag) {
          mark(result.storedFlags, flag);
          mark(unlocked, flag);
        });
      }
      Object.keys(result.missingByFlag).forEach(function (flag) {
        mark(result.knownRuleFlags, flag);
      });
      if (Array.isArray(story.tokens)) {
        story.tokens.forEach(function (token) {
          if (EVIDENCE_RE.test(token)) mark(tokens, token);
        });
      }
      result.flags = unlocked;
      result.tokens = tokens;
      return result;
    } catch (err) {
      result.warnings.push('evidence-exception');
      return result;
    }
  }

  function syntheticReceipt(commission) {
    return {
      receiptId: 'plan:' + commission.commissionId,
      commissionId: commission.commissionId,
      evidence: commission.reward.evidence.slice(),
      flags: commission.reward.flags.slice(),
    };
  }

  function gateAvailable(commission, flags) {
    if (!commission.chapterGate) return true;
    return marked(flags, commission.chapterGate);
  }

  function candidateFromTokenIndex(token) {
    if (!has(state.tokenIndex, token)) return null;
    var info = state.tokenIndex[token];
    return {
      token: info.token,
      gameId: info.gameId,
      commissionId: info.commissionId,
      title: info.title,
      tier: info.tier,
      className: info.className,
    };
  }

  function uniqueCandidatesByGame(candidates, max) {
    var seenCommission = makeMap();
    var byGame = makeMap();
    var gameOrder = [];
    candidates.forEach(function (candidate) {
      if (!candidate || seenCommission[candidate.commissionId]) return;
      seenCommission[candidate.commissionId] = true;
      if (!has(byGame, candidate.gameId)) {
        byGame[candidate.gameId] = [];
        gameOrder.push(candidate.gameId);
      }
      byGame[candidate.gameId].push(candidate);
    });
    gameOrder.sort(compareText);
    var out = [];
    var index = 0;
    var guard = 0;
    while (out.length < max && guard < 64) {
      var added = false;
      for (var i = 0; i < gameOrder.length && out.length < max; i += 1) {
        var bucket = byGame[gameOrder[i]];
        if (bucket && bucket.length > index) {
          out.push(bucket[index]);
          added = true;
        }
      }
      if (!added) break;
      index += 1;
      guard += 1;
    }
    return out;
  }

  function poolEvidenceCandidates(className, story) {
    var pool = [];
    state.commissions.forEach(function (commission) {
      if (!gateAvailable(commission, story.flags)) return;
      for (var i = 0; i < commission.reward.evidence.length; i += 1) {
        var token = commission.reward.evidence[i];
        if (token.slice(0, token.indexOf('-')) !== className) continue;
        if (marked(story.tokens, token)) continue;
        pool.push({
          token: token,
          gameId: commission.gameId,
          commissionId: commission.commissionId,
          title: commission.title,
          tier: commission.tier,
          className: className,
        });
      }
    });
    return uniqueCandidatesByGame(pool, MAX_WALK);
  }

  function convertMissingEntry(entry, story) {
    if (!isObject(entry)) return { kind: 'known-later', label: '下一封信的内容' };
    if (entry.kind === 'class') {
      var className = typeof entry.class === 'string' ? entry.class : '';
      var candidates = [];
      var rawCandidates = Array.isArray(entry.candidates) ? entry.candidates : [];
      rawCandidates.forEach(function (token) {
        var candidate = candidateFromTokenIndex(token);
        if (candidate) candidates.push(candidate);
      });
      poolEvidenceCandidates(className, story).forEach(function (candidate) {
        candidates.push(candidate);
      });
      var picked = uniqueCandidatesByGame(candidates, MAX_WALK);
      var games = uniqueSorted(picked.map(function (candidate) {
        return candidate.gameId;
      }));
      return {
        kind: 'evidence',
        class: className,
        label: CLASS_LABELS[className] || className || '记录',
        atLeast: toPositiveInt(entry.atLeast, 1),
        have: nonNegInt(entry.have, 0),
        need: Math.max(1, toPositiveInt(entry.need, 1)),
        distinctGames: entry.distinctGames === true,
        games: games,
        candidates: picked.map(function (candidate) {
          return candidate.token;
        }),
        candidateCommissions: picked,
      };
    }
    if (entry.kind === 'token') {
      var candidate = candidateFromTokenIndex(entry.token);
      return {
        kind: 'evidence',
        class: candidate ? candidate.className : '',
        label: candidate ? CLASS_LABELS[candidate.className] || '记录' : '记录',
        atLeast: 1,
        have: 0,
        need: 1,
        distinctGames: false,
        games: candidate ? [candidate.gameId] : [],
        candidates: candidate ? [candidate.token] : [],
        candidateCommissions: candidate ? [candidate] : [],
      };
    }
    if (entry.kind === 'game') {
      return {
        kind: 'evidence',
        class: '',
        label: '现场记录',
        atLeast: toPositiveInt(entry.atLeast, 1),
        have: nonNegInt(entry.have, 0),
        need: Math.max(1, toPositiveInt(entry.need, 1)),
        distinctGames: false,
        games: typeof entry.game === 'string' ? [entry.game] : [],
        candidates: [],
        candidateCommissions: [],
      };
    }
    if (entry.kind === 'flag') {
      return { kind: 'story', flag: typeof entry.flag === 'string' ? entry.flag : null };
    }
    return { kind: 'known-later', label: '下一封信的内容' };
  }

  function flattenGateMissing(flag, story) {
    var out = [];
    var seen = makeMap();
    function walk(currentFlag, depth) {
      if (depth > MAX_WALK || marked(seen, currentFlag)) return;
      mark(seen, currentFlag);
      var entries = story.missingByFlag && has(story.missingByFlag, currentFlag) ? story.missingByFlag[currentFlag] : null;
      if (!Array.isArray(entries) || entries.length === 0) {
        if (!marked(story.flags, currentFlag)) out.push({ kind: 'known-later', flag: currentFlag });
        return;
      }
      /* 当前规则的「前置章节」没到手时，只顺着前置链展开；同一层的可替换
         分支属于下一阶段的事，不在这里重复报缺口。 */
      var flagPrereqs = entries.filter(function (entry) {
        return isObject(entry) && entry.kind === 'flag' && story.missingByFlag && has(story.missingByFlag, entry.flag);
      });
      if (flagPrereqs.length) {
        flagPrereqs.forEach(function (entry) {
          walk(entry.flag, depth + 1);
        });
        return;
      }
      entries.forEach(function (entry) {
        out.push(convertMissingEntry(entry, story));
      });
    }
    walk(flag, 0);
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 解锁条件求值（all/any；未知条件只报告，不猜）
   * ------------------------------------------------------------------ */

  function collectPrerequisiteIds(commission) {
    var ids = [];
    function walk(node, optional) {
      if (!isObject(node)) return;
      if (Array.isArray(node.all)) {
        node.all.forEach(function (child) {
          walk(child, optional);
        });
        return;
      }
      if (Array.isArray(node.any)) {
        node.any.forEach(function (child) {
          walk(child, true);
        });
        return;
      }
      /* any 分支里的前置不是硬依赖，只交给 evaluateUnlock 求值。 */
      if (!optional && typeof node.commissionCleared === 'string' && ids.indexOf(node.commissionCleared) < 0) {
        ids.push(node.commissionCleared);
      }
    }
    walk(commission.unlock, false);
    return ids;
  }

  function evaluateUnlock(commission, clearedOrPlanned, flags) {
    var misses = [];
    function walk(node) {
      if (!isObject(node)) {
        misses.push({ kind: 'unsupported' });
        return false;
      }
      if (Array.isArray(node.all)) {
        var ok = true;
        for (var i = 0; i < node.all.length; i += 1) {
          if (!walk(node.all[i])) ok = false;
        }
        return ok;
      }
      if (Array.isArray(node.any)) {
        var best = null;
        for (var j = 0; j < node.any.length; j += 1) {
          var branch = [];
          var saved = misses;
          misses = branch;
          var branchOk = walk(node.any[j]);
          misses = saved;
          if (branchOk) return true;
          if (!best || branch.length < best.length) best = branch;
        }
        if (best) {
          for (var k = 0; k < best.length; k += 1) misses.push(best[k]);
        }
        return false;
      }
      if (typeof node.commissionCleared === 'string') {
        if (marked(clearedOrPlanned, node.commissionCleared)) return true;
        misses.push({ kind: 'commission', id: node.commissionCleared });
        return false;
      }
      if (typeof node.chapterFlag === 'string') {
        if (marked(flags, node.chapterFlag)) return true;
        misses.push({ kind: 'chapter', flag: node.chapterFlag });
        return false;
      }
      misses.push({ kind: 'unsupported' });
      return false;
    }
    var ok = walk(isObject(commission.unlock) ? commission.unlock : { all: [] });
    return { ok: ok, misses: misses };
  }

  function buildChain(list, mode) {
    var nodes = makeMap();
    list.forEach(function (commission) {
      nodes[commission.commissionId] = commission;
    });
    var indegree = makeMap();
    var dependents = makeMap();
    list.forEach(function (commission) {
      indegree[commission.commissionId] = 0;
    });
    list.forEach(function (commission) {
      collectPrerequisiteIds(commission).forEach(function (prereqId) {
        if (!has(nodes, prereqId)) return;
        indegree[commission.commissionId] += 1;
        if (!has(dependents, prereqId)) dependents[prereqId] = [];
        dependents[prereqId].push(commission.commissionId);
      });
    });
    var available = [];
    list.forEach(function (commission) {
      if (indegree[commission.commissionId] === 0) available.push(commission);
    });
    var comparator = mode === 'reinforced' ? compareCommissionReinforced : compareCommissionStandard;
    var order = [];
    var guard = 0;
    while (available.length && guard < list.length + 2) {
      available.sort(comparator);
      var next = available.shift();
      order.push(next);
      var children = dependents[next.commissionId] || [];
      for (var i = 0; i < children.length; i += 1) {
        indegree[children[i]] -= 1;
        if (indegree[children[i]] === 0) available.push(nodes[children[i]]);
      }
      guard += 1;
    }
    if (order.length !== list.length) {
      var cycle = list.filter(function (commission) {
        return order.indexOf(commission) < 0;
      }).map(function (commission) {
        return commission.commissionId;
      }).sort();
      return { ok: false, order: order, cycle: cycle };
    }
    return { ok: true, order: order, cycle: [] };
  }

  /* ------------------------------------------------------------------ *
   * 等级 / 装备
   * ------------------------------------------------------------------ */

  function readLevelOption(value) {
    if (typeof value === 'number' && isFinite(value)) {
      var level = Math.floor(value);
      if (level >= 1 && level <= 3) return LEVELS[level - 1];
      return null;
    }
    if (typeof value === 'string' && value) {
      var text = value.toLowerCase();
      for (var i = 0; i < LEVELS.length; i += 1) {
        if (LEVELS[i].id === text || String(LEVELS[i].level) === text) return LEVELS[i];
      }
    }
    return null;
  }

  function deriveLevel(options, progress) {
    var override = readLevelOption(options.level);
    if (!override) override = readLevelOption(options.levelId);
    if (!override) override = readLevelOption(options.professionLevel);
    if (override) {
      return { level: override.level, id: override.id, name: override.name, source: 'input' };
    }
    var count = progress.clearedCount;
    var picked;
    if (count >= THRESHOLDS.expert) picked = LEVELS[2];
    else if (count >= THRESHOLDS.veteran) picked = LEVELS[1];
    else picked = LEVELS[0];
    return { level: picked.level, id: picked.id, name: picked.name, source: 'progress' };
  }

  function ownsAnyShip(equipment) {
    if (!isObject(equipment)) return false;
    if (typeof equipment.equippedShip === 'string' && equipment.equippedShip) return true;
    var keys = Object.keys(equipment);
    for (var i = 0; i < keys.length; i += 1) {
      var match = /^ship:([A-Za-z0-9._-]{1,80}):owned$/.exec(keys[i]);
      if (match && equipment[keys[i]] === true) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * 材料覆盖（主线委托不消耗材料；这里是可顺路的物资路线）
   * ------------------------------------------------------------------ */

  function professionGamesOf(list) {
    var map = makeMap();
    list.forEach(function (commission) {
      mark(map, commission.gameId);
    });
    return map;
  }

  function buildSupplies(list, cleared, wallet) {
    var report = {
      materials: [],
      gaps: [],
      marketCost: 0,
      covered: [],
      missingPrices: [],
      source: state.materialsSource,
    };
    if (!state.materials.length) return report;
    var games = professionGamesOf(list);
    state.materials.forEach(function (material) {
      var held = wallet.items[material.itemId] || 0;
      var fromProfession = (state.sourceIndex[material.itemId] || []).filter(function (source) {
        return has(games, source.gameId);
      }).map(function (source) {
        return {
          gameId: source.gameId,
          commissionId: source.commissionId,
          tier: source.tier,
          count: source.count,
          cleared: marked(cleared, source.commissionId),
        };
      });
      var openSource = fromProfession.some(function (source) {
        return !source.cleared;
      });
      var covered = held > 0 || openSource;
      var fromOtherGames = (state.sourceIndex[material.itemId] || []).filter(function (source) {
        return !has(games, source.gameId);
      }).map(function (source) {
        return {
          gameId: source.gameId,
          commissionId: source.commissionId,
          tier: source.tier,
          count: source.count,
          cleared: marked(cleared, source.commissionId),
        };
      });
      fromOtherGames.sort(function (a, b) {
        if (a.gameId !== b.gameId) return compareText(a.gameId, b.gameId);
        return a.tier - b.tier;
      });
      fromOtherGames = fromOtherGames.slice(0, 6);
      var entry = {
        itemId: material.itemId,
        name: material.name,
        held: held,
        covered: covered,
        coveredByProfession: openSource,
        fromProfession: fromProfession,
        fromOtherGames: fromOtherGames,
        dropGames: state.dropGames[material.itemId] || [],
        market: {
          buyPrice: material.buyPrice,
          sellPrice: material.sellPrice,
          affordable: wallet.credits >= material.buyPrice,
        },
        needsAlternative: !covered,
      };
      report.materials.push(entry);
      if (covered) report.covered.push(material.itemId);
      else {
        report.gaps.push(material.itemId);
        report.marketCost += material.buyPrice;
      }
    });
    report.gaps.sort(compareText);
    report.covered.sort(compareText);
    return report;
  }

  /* ------------------------------------------------------------------ *
   * 步骤构造
   * ------------------------------------------------------------------ */

  function storyStep(originGameId) {
    var origin = state.originMap[originGameId] || null;
    var title = '从告示板抽下第一张纸';
    var reason;
    if (origin && origin.firstStep) {
      reason = (origin.from ? origin.from + '留了话：' : '') + origin.firstStep;
    } else {
      reason = '先到街角的告示板看看当天的纸，挑一张写得清楚的活。';
    }
    return {
      kind: 'story',
      id: 'story:arrive',
      title: title,
      reason: trimText(reason, MAX_REASON),
      originGameId: originGameId,
      optional: false,
      missing: [],
    };
  }

  function rentalStep(ship, gameId) {
    return {
      kind: 'rental',
      id: 'rental:' + ship.shipId,
      title: '去码头借' + ship.name,
      reason: '不用买机也能飞；战斗失手不丢机，也不欠维修债，回来还能再借。',
      cost: 0,
      shipId: ship.shipId,
      gameId: gameId,
      optional: false,
      missing: [],
    };
  }

  function commissionStep(commission) {
    return {
      kind: 'commission',
      id: commission.commissionId,
      commissionId: commission.commissionId,
      tier: commission.tier,
      gameId: commission.gameId,
      title: commission.title,
      reason: '把这一阶的目标做完，回结算窗交差；工钱按当天的价结清。',
      optional: false,
      missing: [],
    };
  }

  function marketStep(supplies, wallet) {
    var items = {};
    var names = [];
    supplies.gaps.forEach(function (itemId) {
      var material = state.materialIndex[itemId];
      if (!material) return;
      items[itemId] = 1;
      names.push(material.name);
    });
    var missing = [];
    if (wallet.credits < supplies.marketCost) {
      missing.push({ kind: 'credits', need: supplies.marketCost - wallet.credits, have: wallet.credits });
    }
    return {
      kind: 'market',
      id: 'market:supplies',
      title: '在旧港商店补齐缺的材料',
      reason: '这几样材料本职工单里暂时没有（' + names.join('、') + '），商店按明码卖，不必为掉落反复刷同一款游戏。',
      items: items,
      cost: supplies.marketCost,
      optional: true,
      missing: missing,
    };
  }

  /* ------------------------------------------------------------------ *
   * Blocker 构造
   * ------------------------------------------------------------------ */

  function makeChapterBlocker(commission, flag, story) {
    var missing = flattenGateMissing(flag, story);
    var known = !!(story.missingByFlag && has(story.missingByFlag, flag));
    var external = !known && !marked(story.flags, flag);
    var reason;
    if (external) {
      reason = '后面的信还没寄到；这张纸要等下一章开了才能排上。';
    } else {
      reason = '要等下一章的关键记录到手，这张纸才能往下排。';
    }
    return {
      kind: external ? 'chapter-gate-pending' : 'chapter-gate',
      id: 'gate:' + flag,
      commissionId: commission.commissionId,
      tier: commission.tier,
      flag: flag,
      known: known,
      title: commission.title,
      reason: reason,
      missing: missing,
      alternatives: [],
    };
  }

  function makeCommissionBlocker(commission, missingId) {
    var prereq = null;
    for (var i = 0; i < state.commissions.length; i += 1) {
      if (state.commissions[i].commissionId === missingId) {
        prereq = state.commissions[i];
        break;
      }
    }
    return {
      kind: 'commission-unlock',
      id: 'unlock:' + missingId,
      commissionId: commission.commissionId,
      tier: commission.tier,
      title: commission.title,
      reason: prereq
        ? '上一张纸的副本还没交回去；先把「' + prereq.title + '」做完。'
        : '上一张纸的副本还没交回去；先把前面那一阶做完。',
      missing: [
        {
          kind: 'commission',
          commissionId: missingId,
          title: prereq ? prereq.title : missingId,
          professionId: prereq ? prereq.professionId : null,
        },
      ],
      alternatives: [],
    };
  }

  function makeConditionBlocker(commission) {
    return {
      kind: 'condition',
      id: 'condition:' + commission.commissionId,
      commissionId: commission.commissionId,
      tier: commission.tier,
      title: commission.title,
      reason: '这张纸的接单条件还没在旧港见过；先按别的路把能做的做掉。',
      missing: [{ kind: 'condition', label: '接单条件' }],
      alternatives: [],
    };
  }

  function makeShipBlocker(commission) {
    return {
      kind: 'ship',
      id: 'ship:' + commission.commissionId,
      commissionId: commission.commissionId,
      tier: commission.tier,
      title: commission.title,
      reason: '这趟要真机出港，可码头暂时没有能借的机；先攒钱或换一条不出港的路。',
      missing: [{ kind: 'ship', label: '能出港的机' }],
      alternatives: [],
    };
  }

  function makeChainBlocker(cycle) {
    return {
      kind: 'chain-cycle',
      id: 'chain-cycle',
      title: '',
      reason: '这几张纸互相压着，谁也接不了；先按别的路走，等旧港把顺序理清。',
      missing: [{ kind: 'chain', commissions: cycle.slice() }],
      alternatives: [],
    };
  }

  function makeNoCommissionBlocker(professionId) {
    return {
      kind: 'no-commissions',
      id: 'no-commissions:' + professionId,
      title: '',
      reason: '这个职业在旧港暂时没有挂出的纸；先去告示板上看看别的明码工单。',
      missing: [],
      alternatives: [],
    };
  }

  function makeUnlockBlocker(commission, unlock, story) {
    var misses = unlock && Array.isArray(unlock.misses) ? unlock.misses : [];
    for (var i = 0; i < misses.length; i += 1) {
      if (misses[i].kind === 'chapter') return makeChapterBlocker(commission, misses[i].flag, story);
      if (misses[i].kind === 'commission') return makeCommissionBlocker(commission, misses[i].id);
    }
    return makeConditionBlocker(commission);
  }

  /* ------------------------------------------------------------------ *
   * 替代路径（工作 / 研究 / 贸易 / 租机 / 代办，至少三种同时存在）
   * ------------------------------------------------------------------ */

  function pickWorkRate(list, cleared) {
    var clearedList = list.filter(function (commission) {
      return marked(cleared, commission.commissionId) && commission.repeatSalaryCredits > 0;
    });
    clearedList.sort(function (a, b) {
      if (a.repeatSalaryCredits !== b.repeatSalaryCredits) return b.repeatSalaryCredits - a.repeatSalaryCredits;
      return compareCommissionStandard(a, b);
    });
    if (clearedList.length) {
      return {
        commissionId: clearedList[0].commissionId,
        title: clearedList[0].title,
        credits: clearedList[0].repeatSalaryCredits,
        source: 'repeat',
      };
    }
    var openList = list.filter(function (commission) {
      return !marked(cleared, commission.commissionId);
    }).slice().sort(compareCommissionStandard);
    for (var i = 0; i < openList.length; i += 1) {
      var credits = openList[i].reward.credits || openList[i].repeatSalaryCredits;
      if (credits > 0) {
        return {
          commissionId: openList[i].commissionId,
          title: openList[i].title,
          credits: credits,
          source: 'first',
        };
      }
    }
    return null;
  }

  function minOfferNeed(wallet) {
    var best = null;
    state.alternatives.forEach(function (offer) {
      var creditsNeed = Math.max(0, offer.cost.credits - wallet.credits);
      var itemsNeed = [];
      Object.keys(offer.cost.items).forEach(function (itemId) {
        var have = wallet.items[itemId] || 0;
        if (have < offer.cost.items[itemId]) {
          itemsNeed.push({ kind: 'materials', itemId: itemId, need: offer.cost.items[itemId], have: have });
        }
      });
      var total = creditsNeed + itemsNeed.length;
      if (!best || total < best.weight) best = { weight: total, credits: creditsNeed, items: itemsNeed };
    });
    return best;
  }

  function buildWorkAlternative(options) {
    var rate = pickWorkRate(options.list, options.cleared);
    var creditsGap = Math.max(0, options.supplies.marketCost - options.wallet.credits);
    var offerNeed = minOfferNeed(options.wallet);
    if (offerNeed && offerNeed.credits > creditsGap) creditsGap = offerNeed.credits;
    var runs = rate && creditsGap > 0 ? Math.ceil(creditsGap / rate.credits) : null;
    var missing = [];
    if (creditsGap > 0) missing.push({ kind: 'credits', need: creditsGap, have: options.wallet.credits });
    return {
      id: 'alt:work',
      kind: 'work',
      title: '多接一趟明码工单',
      reason: '缺信用点时，多跑一趟新的有效委托局就能领当天的工钱；按趟结，不压账。',
      cost: 0,
      creditsPerRun: rate ? rate.credits : null,
      commissionId: rate ? rate.commissionId : null,
      missing: missing,
      workload: { runs: runs },
      target: 'credits',
    };
  }

  function buildResearchAlternative(options) {
    var missingEvidence = [];
    options.blockers.forEach(function (blocker) {
      (blocker.missing || []).forEach(function (entry) {
        if (entry.kind === 'evidence') missingEvidence.push(entry);
      });
    });
    var candidates = [];
    missingEvidence.forEach(function (entry) {
      (entry.candidateCommissions || []).forEach(function (candidate) {
        candidates.push(candidate);
      });
    });
    var routes = uniqueCandidatesByGame(candidates, MAX_WALK);
    var labels = [];
    var need = 0;
    missingEvidence.forEach(function (entry) {
      if (entry.label && labels.indexOf(entry.label) < 0) labels.push(entry.label);
      need += toPositiveInt(entry.need, 1);
    });
    if (routes.length) {
      return {
        id: 'alt:research',
        kind: 'research',
        title: '按线索补齐缺的记录',
        reason: '还缺的' + labels.join('、') + '能在别的入门工单里挣到；哪条路顺就走哪条，不必认定某一款游戏。',
        cost: 0,
        missing: missingEvidence.map(function (entry) {
          return {
            kind: 'evidence',
            class: entry.class,
            label: entry.label,
            need: entry.need,
            distinctGames: entry.distinctGames,
          };
        }),
        routes: routes.map(function (candidate) {
          return {
            gameId: candidate.gameId,
            commissionId: candidate.commissionId,
            title: candidate.title,
            tier: candidate.tier,
            className: candidate.className,
          };
        }),
        workload: { commissions: need },
        target: 'evidence',
      };
    }
    var clearedRoutes = options.list.filter(function (commission) {
      return marked(options.cleared, commission.commissionId) && commission.reward.evidence.length > 0;
    }).slice(0, 3).map(function (commission) {
      return {
        gameId: commission.gameId,
        commissionId: commission.commissionId,
        title: commission.title,
        tier: commission.tier,
        className: commission.reward.evidence[0].slice(0, commission.reward.evidence[0].indexOf('-')),
      };
    });
    return {
      id: 'alt:research',
      kind: 'research',
      title: '把记录先归进旧档室',
      reason: '手头已经交差的记录先归档；等下一封信到了，再顺着往下走。',
      cost: 0,
      missing: [],
      routes: clearedRoutes,
      workload: { commissions: 0 },
      target: 'records',
    };
  }

  function buildTradeAlternative(options) {
    var gaps = options.supplies.gaps;
    if (gaps.length) {
      var items = {};
      var names = [];
      var unpriced = [];
      gaps.forEach(function (itemId) {
        var material = state.materialIndex[itemId];
        if (!material) {
          unpriced.push(itemId);
          return;
        }
        items[itemId] = 1;
        names.push(material.name);
      });
      var missing = [];
      if (options.wallet.credits < options.supplies.marketCost) {
        missing.push({
          kind: 'credits',
          need: options.supplies.marketCost - options.wallet.credits,
          have: options.wallet.credits,
        });
      }
      return {
        id: 'alt:trade',
        kind: 'trade',
        title: '在旧港商店按明码补齐',
        reason: '缺的' + names.join('、') + '都能在商店按固定价买到；不必为掉落反复刷同一款游戏。',
        items: items,
        cost: options.supplies.marketCost,
        missing: missing,
        unpriced: unpriced,
        workload: { purchases: Object.keys(items).length },
        target: 'materials',
      };
    }
    var sellItems = {};
    var sellGain = 0;
    Object.keys(options.wallet.items).forEach(function (itemId) {
      var material = state.materialIndex[itemId];
      if (!material) return;
      var count = options.wallet.items[itemId];
      if (count <= 0) return;
      sellItems[itemId] = count;
      sellGain += count * material.sellPrice;
    });
    return {
      id: 'alt:trade',
      kind: 'trade',
      title: '把余料换成信用点',
      reason: '手头多出来的材料可以在商店按明码卖掉，换回路费或下一次采买的钱。',
      items: sellItems,
      cost: 0,
      creditsGain: sellGain,
      missing: [],
      workload: { purchases: 0 },
      target: 'materials',
    };
  }

  function buildRentalAlternative(options) {
    if (!state.rentalShip) return null;
    var combatGames = options.list.filter(function (commission) {
      return has(state.combatGames, commission.gameId);
    });
    if (!combatGames.length) return null;
    var combatCount = 0;
    combatGames.forEach(function (commission) {
      if (!marked(options.cleared, commission.commissionId)) combatCount += 1;
    });
    return {
      id: 'alt:rental:' + state.rentalShip.shipId,
      kind: 'rental',
      title: '借码头那架' + state.rentalShip.name,
      reason: '不买机也能飞；失手不丢机，也不欠维修债。',
      cost: 0,
      shipId: state.rentalShip.shipId,
      missing: [],
      workload: { flights: combatCount },
      target: 'combat',
    };
  }

  function buildAlternativeOffers(options) {
    var out = [];
    if (state.alternatives.length) {
      state.alternatives.slice(0, 2).forEach(function (offer) {
        var missing = [];
        if (options.wallet.credits < offer.cost.credits) {
          missing.push({ kind: 'credits', need: offer.cost.credits - options.wallet.credits, have: options.wallet.credits });
        }
        Object.keys(offer.cost.items).forEach(function (itemId) {
          var have = options.wallet.items[itemId] || 0;
          if (have < offer.cost.items[itemId]) {
            missing.push({ kind: 'materials', itemId: itemId, need: offer.cost.items[itemId], have: have });
          }
        });
        out.push({
          id: 'alt:offer:' + offer.offerId,
          kind: 'alternative',
          title: offer.title,
          reason: '不想亲自下场的活可以付明码代办费，让代办窗的人跑一趟；事情照样往前走。',
          cost: offer.cost.credits,
          items: offer.cost.items,
          missing: missing,
          workload: { payments: 1 },
          target: 'story',
        });
      });
    }
    if (!out.length) {
      out.push({
        id: 'alt:procurement',
        kind: 'alternative',
        title: '请代办窗跑一趟',
        reason: '告示板纸角标着代办价；不喜欢动手的活，可以付清让代办窗接手。',
        cost: null,
        items: {},
        missing: [],
        unpriced: true,
        workload: { payments: 1 },
        target: 'story',
      });
    }
    return out;
  }

  function alternativeCostValue(alternative) {
    return typeof alternative.cost === 'number' ? alternative.cost : Infinity;
  }

  function buildAlternatives(options) {
    var out = [buildWorkAlternative(options), buildResearchAlternative(options), buildTradeAlternative(options)];
    var rental = buildRentalAlternative(options);
    if (rental) out.push(rental);
    buildAlternativeOffers(options).forEach(function (offer) {
      out.push(offer);
    });
    if (out.length < 3) {
      while (out.length < 3) {
        out.push({
          id: 'alt:work:' + out.length,
          kind: 'work',
          title: '多接一趟明码工单',
          reason: '缺什么先接一趟工单：工钱当天结，材料看委托内容。',
          missing: [],
          workload: { runs: 1 },
          target: 'credits',
        });
      }
    }
    var categoryOrder = { work: 0, research: 1, trade: 2, rental: 3, alternative: 4 };
    out = out.map(function (alternative, index) {
      return { alternative: alternative, index: index };
    });
    if (options.mode === 'reinforced') {
      out.sort(function (a, b) {
        var left = alternativeCostValue(a.alternative);
        var right = alternativeCostValue(b.alternative);
        if (left !== right) return left - right;
        if (categoryOrder[a.alternative.kind] !== categoryOrder[b.alternative.kind]) {
          return categoryOrder[a.alternative.kind] - categoryOrder[b.alternative.kind];
        }
        return a.index - b.index;
      });
    } else {
      out.sort(function (a, b) {
        if (categoryOrder[a.alternative.kind] !== categoryOrder[b.alternative.kind]) {
          return categoryOrder[a.alternative.kind] - categoryOrder[b.alternative.kind];
        }
        return a.index - b.index;
      });
    }
    return out.map(function (entry) {
      return entry.alternative;
    });
  }

  function preferredAlternativeKinds(blocker) {
    if (blocker.kind === 'chapter-gate' || blocker.kind === 'chapter-gate-pending') {
      return ['research', 'work', 'trade', 'alternative', 'rental'];
    }
    if (blocker.kind === 'credits') return ['work', 'trade', 'research', 'alternative', 'rental'];
    if (blocker.kind === 'materials' || blocker.kind === 'ship') {
      return ['trade', 'rental', 'work', 'research', 'alternative'];
    }
    if (blocker.kind === 'commission-unlock') return ['work', 'research', 'trade', 'alternative'];
    return ['work', 'research', 'trade', 'alternative', 'rental'];
  }

  function attachAlternativeIds(blockers, alternatives) {
    var ids = alternatives.map(function (alternative) {
      return alternative.id;
    });
    blockers.forEach(function (blocker) {
      var preferred = preferredAlternativeKinds(blocker);
      var picked = [];
      preferred.forEach(function (kind) {
        alternatives.forEach(function (alternative) {
          if (alternative.kind === kind && picked.indexOf(alternative.id) < 0) picked.push(alternative.id);
        });
      });
      if (!picked.length) picked = ids.slice();
      blocker.alternatives = picked;
    });
  }

  /* ------------------------------------------------------------------ *
   * 工作量 / 摘要
   * ------------------------------------------------------------------ */

  function assignStepOrder(steps) {
    for (var i = 0; i < steps.length; i += 1) {
      steps[i].order = i + 1;
    }
    return steps;
  }

  function buildWorkload(steps, blockers, supplies, alternatives, progress, wallet) {
    var required = 0;
    var optional = 0;
    var commissions = 0;
    var support = 0;
    var plannedCredits = 0;
    steps.forEach(function (step) {
      if (step.optional) optional += 1;
      else required += 1;
      if (step.kind === 'commission') {
        commissions += 1;
        for (var i = 0; i < state.commissions.length; i += 1) {
          if (state.commissions[i].commissionId === step.commissionId) {
            plannedCredits += state.commissions[i].reward.credits;
            break;
          }
        }
      } else if (!step.optional) {
        support += 1;
      }
    });
    var effort = required <= 3 ? 'light' : required <= 6 ? 'moderate' : 'heavy';
    return {
      steps: steps.length,
      required: required,
      optional: optional,
      commissions: commissions,
      support: support,
      cleared: progress.clearedCount,
      total: progress.total,
      plannedCredits: plannedCredits,
      credits: wallet.credits,
      marketCost: supplies.marketCost,
      materialGaps: supplies.gaps.slice(),
      blockedCommissions: blockers.filter(function (blocker) {
        return !!blocker.commissionId;
      }).length,
      alternatives: alternatives.length,
      effort: effort,
    };
  }

  function buildSummaryText(options) {
    var parts = [];
    if (options.workload.commissions) parts.push(options.workload.commissions + ' 趟工单');
    if (options.workload.support) parts.push(options.workload.support + ' 步准备');
    var text = '这趟大约 ' + options.workload.required + ' 步';
    if (parts.length) text += '：' + parts.join(' + ');
    text += '。';
    if (options.complete) {
      text += ' 这条线已经全部交差。';
    } else if (options.blockers.length) {
      text += ' 往下还有 ' + options.blockers.length + ' 处东西没到手，下面给了 ' + options.alternatives.length + ' 条替代走法。';
    }
    if (options.supplies.gaps.length) {
      var names = options.supplies.gaps.map(function (itemId) {
        return (state.materialIndex[itemId] || {}).name || itemId;
      });
      text += ' 材料里' + names.join('、') + '本职工单暂时不出；商店按明码有货，合计 ' + options.supplies.marketCost + ' 信用点。';
    }
    return text;
  }

  /* ------------------------------------------------------------------ *
   * plan：一条单职业主线路线
   * ------------------------------------------------------------------ */

  function failurePlan(reason, extra) {
    var base = {
      ok: false,
      reason: reason,
      complete: false,
      originGameId: null,
      originName: null,
      originFirstStep: '',
      professionId: null,
      professionName: null,
      professionDomain: null,
      gameId: null,
      gameDisplayName: null,
      level: null,
      levelId: null,
      levelName: null,
      levelSource: null,
      mode: 'standard',
      steps: [],
      blockers: [],
      alternatives: [],
      supplies: { materials: [], gaps: [], marketCost: 0, covered: [], missingPrices: [], source: 'none' },
      flags: { unlocked: [], stored: [], evidenceUsed: false, plannedCommissions: [] },
      cleared: { count: 0, total: 0, ids: [] },
      workload: null,
      summaryText: '',
      contentVersion: null,
    };
    var out = {};
    Object.keys(base).forEach(function (key) {
      out[key] = base[key];
    });
    if (isObject(extra)) {
      Object.keys(extra).forEach(function (key) {
        out[key] = extra[key];
      });
    }
    if (!out.blockers.length) {
      out.blockers.push({
        kind: 'input',
        id: 'input:' + reason,
        title: '',
        reason: reason === REASONS.unknownOrigin
          ? '这个起点不在旧港的名单上；换一个见过的起点再排。'
          : reason === REASONS.unknownProfession
            ? '这个职业在旧港没有挂出的纸；换一个见过的职业再排。'
            : '现在排不出路线；先把内容或输入补全。',
        missing: [],
        alternatives: [],
      });
    }
    return out;
  }

  function plan(input) {
    try {
      if (!isConfigured()) return failurePlan(REASONS.notConfigured);
      var options = isObject(input) ? input : {};
      var originGameId = typeof options.originGameId === 'string' ? options.originGameId : '';
      var professionId = typeof options.professionId === 'string' ? options.professionId : '';
      if (!originGameId || !has(state.gameSet, originGameId)) {
        return failurePlan(REASONS.unknownOrigin, { originGameId: originGameId || null });
      }
      if (!professionId || !has(state.professionSet, professionId)) {
        return failurePlan(REASONS.unknownProfession, { professionId: professionId || null });
      }
      var wallet = walletView(options.wallet);
      var quests = questRowsOf(options.quests);
      var claims = claimRowsOf(options.claims);
      var flagsInput = readFlagsInput(options.flags);
      var cleared = collectCleared(quests, claims);
      var list = state.byProfession[professionId] || [];
      var progress = progressOf(list, cleared);
      var level = deriveLevel(options, progress);
      var mode = level.level >= REINFORCED_MIN_LEVEL ? 'reinforced' : 'standard';
      var steps = [];
      var blockers = [];
      var plannedCommissions = [];
      var resolved = makeMap();
      Object.keys(cleared).forEach(function (id) {
        mark(resolved, id);
      });
      var plannedReceipts = [];
      var story = evaluateStory(flagsInput, quests, claims, wallet);
      var ownsShip = ownsAnyShip(wallet.equipment);
      var rentalAdded = false;
      var blocked = false;
      var chain = { ok: true, order: [], cycle: [] };

      if (progress.clearedCount === 0 && mode !== 'reinforced') steps.push(storyStep(originGameId));
      if (!list.length) {
        blockers.push(makeNoCommissionBlocker(professionId));
      } else {
        chain = buildChain(list, mode);
        if (!chain.ok) blockers.push(makeChainBlocker(chain.cycle));
      }

      function refreshStory() {
        if (!plannedReceipts.length || !activeEvidenceModule()) return;
        var syntheticClaims = claims.slice().concat(plannedReceipts);
        var next = evaluateStory(flagsInput, quests, syntheticClaims, wallet);
        if (next.evidenceUsed) story = next;
      }

      if (chain.ok && list.length) {
        for (var i = 0; i < chain.order.length; i += 1) {
          var commission = chain.order[i];
          if (marked(cleared, commission.commissionId)) continue;
          if (blocked) continue;
          var unlocked = evaluateUnlock(commission, resolved, story.flags);
          if (!unlocked.ok) {
            blocked = true;
            blockers.push(makeUnlockBlocker(commission, unlocked, story));
            continue;
          }
          if (has(state.combatGames, commission.gameId) && !ownsShip) {
            if (!state.rentalShip) {
              blocked = true;
              blockers.push(makeShipBlocker(commission));
              continue;
            }
            if (!rentalAdded) {
              steps.push(rentalStep(state.rentalShip, commission.gameId));
              rentalAdded = true;
            }
          }
          mark(resolved, commission.commissionId);
          plannedCommissions.push(commission.commissionId);
          steps.push(commissionStep(commission));
          plannedReceipts.push(syntheticReceipt(commission));
          refreshStory();
        }
      }

      var supplies = buildSupplies(list, cleared, wallet);
      if (supplies.gaps.length && list.length) steps.push(marketStep(supplies, wallet));

      var alternatives = buildAlternatives({
        list: list,
        cleared: cleared,
        wallet: wallet,
        supplies: supplies,
        blockers: blockers,
        mode: mode,
      });
      attachAlternativeIds(blockers, alternatives);

      assignStepOrder(steps);
      var workload = buildWorkload(steps, blockers, supplies, alternatives, progress, wallet);
      var plannedSet = makeMap();
      plannedCommissions.forEach(function (commissionId) {
        plannedSet[commissionId] = true;
      });
      var allCovered = list.length > 0 && list.every(function (commission) {
        return marked(cleared, commission.commissionId) || marked(plannedSet, commission.commissionId);
      });
      var complete = blockers.length === 0 && allCovered;
      var summaryText = buildSummaryText({
        workload: workload,
        blockers: blockers,
        alternatives: alternatives,
        supplies: supplies,
        complete: complete,
      });
      var professionMeta = state.professionMeta[professionId] || { displayName: professionId, domain: domainOf(professionId) };
      var professionGameId = list.length ? list[0].gameId : null;
      var gameDisplayName = professionGameId ? state.gameNames[professionGameId] || professionGameId : null;

      return {
        ok: true,
        reason: null,
        complete: complete,
        originGameId: originGameId,
        originName: state.gameNames[originGameId] || originGameId,
        originFirstStep: (state.originMap[originGameId] || {}).firstStep || '',
        professionId: professionId,
        professionName: professionMeta.displayName,
        professionDomain: professionMeta.domain,
        gameId: professionGameId,
        gameDisplayName: gameDisplayName,
        level: level.level,
        levelId: level.id,
        levelName: level.name,
        levelSource: level.source,
        mode: mode,
        steps: steps,
        blockers: blockers,
        alternatives: alternatives,
        supplies: supplies,
        flags: {
          unlocked: mapValues(story.flags),
          stored: mapValues(story.storedFlags),
          evidenceUsed: story.evidenceUsed === true,
          plannedCommissions: plannedCommissions.slice(),
        },
        cleared: {
          count: progress.clearedCount,
          total: progress.total,
          ids: list.filter(function (commission) {
            return marked(cleared, commission.commissionId);
          }).map(function (commission) {
            return commission.commissionId;
          }),
        },
        workload: workload,
        summaryText: summaryText,
        contentVersion: state.contentVersion,
      };
    } catch (err) {
      return failurePlan(REASONS.exception, { error: errorText(err) });
    }
  }

  /* ------------------------------------------------------------------ *
   * explain：把计划翻译成戏内可读文案（不出现系统营销词）
   * ------------------------------------------------------------------ */

  function missingTextOf(blocker) {
    var parts = [];
    (blocker.missing || []).forEach(function (entry) {
      if (!isObject(entry)) return;
      if (entry.kind === 'evidence') {
        var label = entry.label || '记录';
        var need = toPositiveInt(entry.need, 1);
        parts.push('还缺' + label + ' ' + need + ' 份' + (entry.distinctGames ? '（要来自不同去处）' : ''));
      } else if (entry.kind === 'story') {
        parts.push('还缺上一章的关键结论');
      } else if (entry.kind === 'commission') {
        parts.push('先把「' + (entry.title || '上一张纸') + '」交回');
      } else if (entry.kind === 'credits') {
        parts.push('信用点还差 ' + nonNegInt(entry.need, 0));
      } else if (entry.kind === 'materials') {
        var material = state.materialIndex[entry.itemId];
        parts.push('还缺' + (material ? material.name : entry.itemId) + ' ' + nonNegInt(entry.need, 0) + ' 份');
      } else if (entry.kind === 'ship') {
        parts.push('还缺能出港的机');
      }
      /* known-later / condition 的文案已写在 blocker.reason 里，不重复。 */
    });
    return parts.join('；');
  }

  function stepText(step) {
    var text = '';
    if (step.kind === 'commission') {
      text = '把「' + step.title + '」这一阶做完，回结算窗交差。';
    } else if (step.kind === 'rental') {
      text = step.title + '：' + step.reason;
    } else if (step.kind === 'market') {
      text = step.title + '：' + step.reason;
      var notes = [];
      if (typeof step.cost === 'number' && step.cost > 0) notes.push('合计 ' + step.cost + ' 信用点');
      if (Array.isArray(step.missing)) {
        step.missing.forEach(function (entry) {
          if (entry && entry.kind === 'credits') notes.push('还差 ' + nonNegInt(entry.need, 0) + ' 信用点');
        });
      }
      if (notes.length) text += '（' + notes.join('；') + '）';
    } else if (step.kind === 'story') {
      text = step.title + '：' + step.reason;
    } else {
      text = step.title + (step.reason ? '：' + step.reason : '');
    }
    return text;
  }

  function alternativeText(alternative) {
    var text = alternative.title + '：' + alternative.reason;
    var notes = [];
    if (typeof alternative.cost === 'number' && alternative.cost > 0) {
      notes.push('要 ' + alternative.cost + ' 信用点');
    }
    if (typeof alternative.creditsGain === 'number' && alternative.creditsGain > 0) {
      notes.push('大约能换 ' + alternative.creditsGain + ' 信用点');
    }
    (alternative.missing || []).forEach(function (entry) {
      if (!entry) return;
      if (entry.kind === 'credits') notes.push('还差 ' + nonNegInt(entry.need, 0) + ' 信用点');
      if (entry.kind === 'materials') {
        var material = state.materialIndex[entry.itemId];
        notes.push('还差' + (material ? material.name : entry.itemId) + ' ' + nonNegInt(entry.need, 0) + ' 份');
      }
    });
    if (alternative.unpriced === true || (Array.isArray(alternative.unpriced) && alternative.unpriced.length)) {
      notes.push('价钱见告示板纸角');
    }
    if (notes.length) text += '（' + notes.join('；') + '）';
    if (Array.isArray(alternative.routes) && alternative.routes.length) {
      var titles = alternative.routes.slice(0, 3).map(function (route) {
        return '「' + route.title + '」';
      });
      text += '可先看：' + titles.join('、') + '。';
    }
    return text;
  }

  function explain(input) {
    try {
      var route = isObject(input) ? input : null;
      if (!route || route.ok !== true) {
        return {
          ok: false,
          reason: REASONS.badPlan,
          title: '',
          lines: [],
          steps: [],
          blockers: [],
          alternatives: [],
          summary: '',
          text: '',
        };
      }
      var steps = Array.isArray(route.steps) ? route.steps : [];
      var blockers = Array.isArray(route.blockers) ? route.blockers : [];
      var alternatives = Array.isArray(route.alternatives) ? route.alternatives : [];
      var title = route.professionName ? '在旧港，' + route.professionName + '接下来可以这样走' : '在旧港的下一步';
      var lines = [];
      var stepLines = [];
      steps.slice().sort(function (a, b) {
        return nonNegInt(a.order, 0) - nonNegInt(b.order, 0);
      }).forEach(function (step) {
        var text = stepText(step);
        var label = step.optional ? '可以顺路' : '第 ' + nonNegInt(step.order, 0) + ' 步';
        var line = label + '：' + text;
        lines.push(line);
        stepLines.push({ order: nonNegInt(step.order, 0), kind: step.kind, text: text });
      });
      var blockerLines = [];
      blockers.forEach(function (blocker) {
        var head = blocker.title ? '「' + blocker.title + '」暂时排不上。' : '有一处暂时排不上。';
        var text = head + (blocker.reason || '');
        var missing = missingTextOf(blocker);
        if (missing) text += ' ' + missing + '。';
        lines.push('卡点：' + text);
        blockerLines.push({ kind: blocker.kind, text: text });
      });
      var alternativeLines = [];
      alternatives.forEach(function (alternative) {
        var text = alternativeText(alternative);
        lines.push('也可以：' + text);
        alternativeLines.push({ kind: alternative.kind, text: text });
      });
      if (route.summaryText) lines.push(route.summaryText);
      return {
        ok: true,
        title: title,
        lines: lines,
        steps: stepLines,
        blockers: blockerLines,
        alternatives: alternativeLines,
        summary: route.summaryText || '',
        text: lines.join('\n'),
      };
    } catch (err) {
      return {
        ok: false,
        reason: REASONS.exception,
        error: errorText(err),
        title: '',
        lines: [],
        steps: [],
        blockers: [],
        alternatives: [],
        summary: '',
        text: '',
      };
    }
  }

  /* ------------------------------------------------------------------ *
   * validate：内容/矩阵/单游戏不锁死/静态边界
   * ------------------------------------------------------------------ */

  function forbiddenTextHits(text) {
    var hits = [];
    if (typeof text !== 'string') return hits;
    FORBIDDEN_TEXT.forEach(function (word) {
      if (text.indexOf(word) >= 0) hits.push(word);
    });
    return hits;
  }

  function collectPlanStrings(plan) {
    var out = [];
    function add(value) {
      if (typeof value === 'string' && value) out.push(value);
    }
    add(plan.summaryText);
    (plan.steps || []).forEach(function (step) {
      add(step.title);
      add(step.reason);
    });
    (plan.blockers || []).forEach(function (blocker) {
      add(blocker.title);
      add(blocker.reason);
    });
    (plan.alternatives || []).forEach(function (alternative) {
      add(alternative.title);
      add(alternative.reason);
    });
    return out;
  }

  function matrixPlans() {
    var origins = state.originIds.slice();
    var professions = state.professionIds.slice();
    var plans = [];
    var okAll = true;
    var errors = [];
    for (var i = 0; i < origins.length; i += 1) {
      for (var j = 0; j < professions.length; j += 1) {
        var route = plan({
          originGameId: origins[i],
          professionId: professions[j],
          wallet: { credits: 0, items: {} },
          quests: [],
          claims: [],
          flags: [],
        });
        plans.push({ originGameId: origins[i], professionId: professions[j], plan: route });
        if (!route || route.ok !== true) {
          okAll = false;
          errors.push('plan-failed:' + origins[i] + '/' + professions[j] + ':' + (route && route.reason));
        }
      }
    }
    return { origins: origins, professions: professions, plans: plans, okAll: okAll, errors: errors };
  }

  function validate() {
    var checks = [];
    var errors = [];
    var warnings = state.warnings.slice();

    function addCheck(id, ok, detail) {
      var text = detail === undefined || detail === null ? '' : String(detail);
      checks.push({ id: id, ok: !!ok, detail: text });
      if (!ok) errors.push(text ? id + ': ' + text : id);
    }

    if (!isConfigured()) {
      addCheck('configured', false, REASONS.notConfigured);
      return {
        ok: false,
        configured: false,
        errors: [REASONS.notConfigured],
        warnings: [],
        checks: checks,
        checksTotal: 1,
        checksPassed: 0,
        origins: [],
        professions: [],
        planMatrix: { total: 0, ok: 0 },
      };
    }

    addCheck('configured', state.commissions.length > 0 && state.professionIds.length > 0,
      'commissions=' + state.commissions.length + ', professions=' + state.professionIds.length);

    /* 1. 委托形状 */
    var badCommissions = [];
    state.commissions.forEach(function (commission) {
      if (!ID_RE.test(commission.commissionId) || !GAME_ID_RE.test(commission.gameId) || !ID_RE.test(commission.professionId)) {
        badCommissions.push(commission.commissionId);
      }
    });
    addCheck('commission-shape', badCommissions.length === 0, badCommissions.slice(0, MAX_WALK).join(','));

    /* 2. unlock 引用：commissionCleared 必须能在内容里找到（或明确是跨内容前置） */
    var commissionIds = makeMap();
    state.commissions.forEach(function (commission) {
      commissionIds[commission.commissionId] = true;
    });
    var unresolved = [];
    state.commissions.forEach(function (commission) {
      collectPrerequisiteIds(commission).forEach(function (id) {
        if (!has(commissionIds, id)) unresolved.push(commission.commissionId + '->' + id);
      });
      if (commission.chapterGate && !FLAG_RE.test(commission.chapterGate)) {
        unresolved.push(commission.commissionId + ':bad-gate');
      }
    });
    addCheck('unlock-references', unresolved.length === 0, unresolved.slice(0, MAX_WALK).join(','));

    /* 3. 起源清单：章节内容缺失时用游戏名兜底；缺起源只警告，不阻断插拔 */
    var missingOrigins = [];
    state.commissions.forEach(function (commission) {
      if (!has(state.originMap, commission.gameId) && missingOrigins.indexOf(commission.gameId) < 0) {
        missingOrigins.push(commission.gameId);
      }
    });
    missingOrigins.sort(compareText);
    if (missingOrigins.length) warnings.push('origin-missing:' + missingOrigins.join('|'));
    addCheck('origin-coverage', state.originIds.length > 0, state.originIds.length ? '' : 'no-origins');

    /* 4. 材料市场（缺口永远有商店退路；不依赖某一款游戏） */
    var badMarket = state.materials.filter(function (material) {
      return !(material.buyPrice > 0) || material.sellPrice > material.buyPrice;
    }).map(function (material) {
      return material.itemId;
    });
    addCheck('material-market', badMarket.length === 0, badMarket.join(','));
    addCheck('material-catalog', state.materials.length > 0, state.materials.length ? '' : 'materials-missing');

    /* 5. 战斗职业：没有自有/租用机时不能是死路（真实内容应有免费租用机） */
    var combatGames = Object.keys(state.combatGames);
    var rentalOk = combatGames.length === 0 || !!state.rentalShip || state.ships.length > 0;
    addCheck('combat-rental', rentalOk, combatGames.length && !state.rentalShip ? 'no-rental-ship' : '');

    /* 6. 矩阵：每个起源 × 每个职业都能排出可解释的路线 */
    var matrix = matrixPlans();
    addCheck('plan-matrix', matrix.okAll && matrix.plans.length > 0,
      'plans=' + matrix.plans.length + (matrix.errors.length ? '; ' + matrix.errors.slice(0, 3).join('; ') : ''));

    /* 7. 矩阵细节：步骤/替代/blocker/explain/确定性 */
    var badSteps = [];
    var badAlternatives = [];
    var badBlockers = [];
    var badExplain = [];
    var badDeterminism = [];
    var badMarketing = [];
    var planOkCount = 0;
    var alternativeMin = Infinity;
    var originSet = makeMap();
    matrix.origins.forEach(function (origin) {
      mark(originSet, origin);
    });
    matrix.plans.forEach(function (entry) {
      var route = entry.plan;
      if (!route || route.ok !== true) return;
      planOkCount += 1;
      var expected = route;
      var repeat = plan({
        originGameId: entry.originGameId,
        professionId: entry.professionId,
        wallet: { credits: 0, items: {} },
        quests: [],
        claims: [],
        flags: [],
      });
      if (JSON.stringify(expected) !== JSON.stringify(repeat)) badDeterminism.push(entry.professionId + '/determinism');
      var stepKinds = makeMap();
      (route.steps || []).forEach(function (step) {
        if (STEP_KINDS.indexOf(step.kind) < 0) badSteps.push(entry.professionId + ':kind-' + step.kind);
        mark(stepKinds, step.kind);
        if (step.kind === 'commission' && !has(commissionIds, step.commissionId)) {
          badSteps.push(entry.professionId + ':unknown-' + step.commissionId);
        }
      });
      if (!Array.isArray(route.alternatives) || route.alternatives.length < 3) {
        badAlternatives.push(entry.professionId + ':count-' + ((route.alternatives || []).length));
      } else {
        if (route.alternatives.length < alternativeMin) alternativeMin = route.alternatives.length;
        var kinds = makeMap();
        route.alternatives.forEach(function (alternative) {
          if (ALTERNATIVE_KINDS.indexOf(alternative.kind) < 0) badAlternatives.push(entry.professionId + ':kind-' + alternative.kind);
          mark(kinds, alternative.kind);
        });
        if (Object.keys(kinds).length < 3) badAlternatives.push(entry.professionId + ':kinds-' + Object.keys(kinds).length);
      }
      (route.blockers || []).forEach(function (blocker) {
        if (typeof blocker.reason !== 'string' || !blocker.reason) badBlockers.push(entry.professionId + ':no-reason');
        if (!Array.isArray(blocker.alternatives) || blocker.alternatives.length < 1) {
          badBlockers.push(entry.professionId + ':' + (blocker.kind || 'blocker'));
        }
      });
      var explained = explain(route);
      if (!explained.ok || !explained.lines.length) badExplain.push(entry.professionId + ':explain');
      var hits = forbiddenTextHits(explained.text);
      if (hits.length) badMarketing.push(entry.professionId + ':' + hits.join('|'));
      collectPlanStrings(route).forEach(function (text) {
        var textHits = forbiddenTextHits(text);
        if (textHits.length) badMarketing.push(entry.professionId + ':' + textHits.join('|'));
      });
    });
    addCheck('plan-steps', badSteps.length === 0, badSteps.slice(0, MAX_WALK).join(','));
    addCheck('plan-alternatives', badAlternatives.length === 0, badAlternatives.slice(0, MAX_WALK).join(','));
    addCheck('plan-blockers', badBlockers.length === 0, badBlockers.slice(0, MAX_WALK).join(','));
    addCheck('plan-determinism', badDeterminism.length === 0, badDeterminism.slice(0, MAX_WALK).join(','));
    addCheck('explain-readable', badExplain.length === 0, badExplain.slice(0, MAX_WALK).join(','));
    addCheck('explain-clean', badMarketing.length === 0, badMarketing.slice(0, MAX_WALK).join(','));
    addCheck('plan-covered', planOkCount === matrix.plans.length && planOkCount > 0,
      'ok=' + planOkCount + '/' + matrix.plans.length);

    /* 8. 单游戏不得是唯一不可替代前置：研究替代路线至少跨两款游戏（当内容有多款时） */
    var singleGameResearch = [];
    matrix.plans.forEach(function (entry) {
      if (!entry.plan || entry.plan.ok !== true) return;
      (entry.plan.blockers || []).forEach(function (blocker) {
        (blocker.missing || []).forEach(function (missing) {
          if (missing.kind !== 'evidence' || !missing.candidateCommissions || missing.candidateCommissions.length === 0) return;
          var games = uniqueSorted(missing.candidateCommissions.map(function (candidate) {
            return candidate.gameId;
          }));
          if (games.length < 2 && state.gameIds.length > 1) {
            singleGameResearch.push(entry.professionId + ':' + (missing.label || missing.class) + ':' + games.join(','));
          }
        });
      });
    });
    addCheck('no-single-game-evidence', singleGameResearch.length === 0, singleGameResearch.slice(0, MAX_WALK).join(','));

    /* 9. 注入的 story-evidence 自身校验（只读转发；未注入时只警告） */
    var evidenceCheck = true;
    var evidenceDetail = '';
    var evidenceModule = activeEvidenceModule();
    if (evidenceModule && isFunction(evidenceModule.validate)) {
      try {
        var evidenceReport = evidenceModule.validate();
        evidenceCheck = !!evidenceReport && evidenceReport.ok !== false;
        if (!evidenceCheck) evidenceDetail = 'evidence-invalid';
      } catch (err) {
        evidenceCheck = false;
        evidenceDetail = 'evidence-threw';
      }
    } else {
      warnings.push('evidence-not-injected');
      evidenceDetail = 'not-injected';
    }
    addCheck('evidence-module', evidenceCheck, evidenceDetail);

    /* 10. 静态边界：无 DOM/存储/网络/写库/随机/时钟/其它模块 */
    var source = '';
    try {
      source = String(routePlannerFactory);
    } catch (err) {
      source = '';
    }
    var hits = [];
    FORBIDDEN_SOURCE.forEach(function (pair) {
      if (source.indexOf(pair[0]) >= 0) hits.push(pair[1]);
    });
    if (FORBIDDEN_CLOCK_RE.test(source)) hits.push('时钟');
    addCheck('static-boundaries', hits.length === 0, uniqueSorted(hits).join(','));

    /* 11. API 面无经济写入口 */
    var economySurface = Object.keys(api).filter(function (name) {
      return FORBIDDEN_API_RE.test(name);
    });
    addCheck('no-economy-surface', uniqueSorted(economySurface).length === 0, uniqueSorted(economySurface).join(','));

    /* 12. 不硬编码首季内容数量（用拼接避免扫描命中自身） */
    var hardcoded = [];
    var countPattern = new RegExp('\\b' + '9' + '6' + '\\b');
    if (countPattern.test(source)) hardcoded.push('count-literal');
    if (source.indexOf('commissions.length === ' + '1' + '6') >= 0) hardcoded.push('commission-count');
    addCheck('no-hardcoded-counts', hardcoded.length === 0, hardcoded.join(','));

    var checksPassed = checks.filter(function (item) {
      return item.ok;
    }).length;
    return {
      ok: errors.length === 0,
      configured: true,
      contentVersion: state.contentVersion,
      errors: errors,
      warnings: uniqueSorted(warnings),
      checks: checks,
      checksTotal: checks.length,
      checksPassed: checksPassed,
      origins: matrix.origins,
      professions: matrix.professions,
      planMatrix: {
        total: matrix.plans.length,
        ok: planOkCount,
        alternativeMin: alternativeMin === Infinity ? 0 : alternativeMin,
      },
      status: status(),
    };
  }

  /* ------------------------------------------------------------------ *
   * 公开 API（每个实例独立 state；create() 返回隔离实例）
   * ------------------------------------------------------------------ */

  var api = {
    MODULE_VERSION: MODULE_VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
    STEP_KINDS: STEP_KINDS,
    ALTERNATIVE_KINDS: ALTERNATIVE_KINDS,
    CLASS_LABELS: CLASS_LABELS,
    MATERIAL_LABELS: MATERIAL_LABELS,
    LEVELS: LEVELS,
    THRESHOLDS: THRESHOLDS,
    COMBAT_EVENT_KINDS: COMBAT_EVENT_KINDS,
    REASONS: REASONS,
    configure: configure,
    reset: reset,
    status: status,
    isConfigured: isConfigured,
    plan: plan,
    explain: explain,
    validate: validate,
    create: buildInstance,
  };
  return api;
  }

  return buildInstance();
});
