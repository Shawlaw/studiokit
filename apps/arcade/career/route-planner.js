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

  function readWorldWorkOption(raw, commissionSet, errors, warnings) {
    if (raw === undefined || raw === null) return null;
    if (!isObject(raw)) {
      errors.push('world-work-invalid');
      return null;
    }
    if (!Array.isArray(raw.commissionIds)) {
      errors.push('world-work-ids-missing');
      return null;
    }
    if (!Array.isArray(raw.entries)) {
      errors.push('world-work-entries-missing');
      return null;
    }
    var ids = [];
    var idSet = makeMap();
    raw.commissionIds.forEach(function (value) {
      var id = trimText(value, 120);
      if (!ID_RE.test(id)) {
        errors.push('world-work-id-invalid');
        return;
      }
      if (idSet[id]) {
        errors.push('world-work-id-duplicate:' + id);
        return;
      }
      if (!commissionSet[id]) {
        errors.push('world-work-id-unknown:' + id);
        return;
      }
      idSet[id] = true;
      ids.push(id);
    });
    var entries = [];
    var index = makeMap();
    raw.entries.forEach(function (entry) {
      if (!isObject(entry)) {
        errors.push('world-work-entry-invalid');
        return;
      }
      var id = trimText(entry.commissionId, 120);
      if (!ID_RE.test(id) || !idSet[id]) {
        errors.push('world-work-entry-unknown:' + id);
        return;
      }
      if (index[id]) {
        errors.push('world-work-entry-duplicate:' + id);
        return;
      }
      var title = trimText(entry.title, 120);
      var summary = trimText(entry.summary, 240);
      if (!title || !summary) {
        errors.push('world-work-entry-text-missing:' + id);
        return;
      }
      var normalized = { commissionId: id, title: title, summary: summary };
      entries.push(normalized);
      index[id] = normalized;
    });
    ids.forEach(function (id) {
      if (!index[id]) errors.push('world-work-entry-missing:' + id);
    });
    if (entries.length !== ids.length) errors.push('world-work-entry-count');
    return {
      contentVersion: trimText(raw.contentVersion, 32) || null,
      schemaVersion: nonNegInt(raw.schemaVersion, 1),
      commissionIds: ids.slice(),
      entries: entries.slice(),
      byId: index,
    };
  }

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
      commissionIndex: makeMap(),
      byProfession: makeMap(),
      professionIds: [],
      professionSet: makeMap(),
      professionMeta: makeMap(),
      gameIds: [],
      gameSet: makeMap(),
      gameNames: makeMap(),
      gameProfessions: makeMap(),
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
      worldWork: null,
      worldWorkIds: [],
      worldWorkSet: makeMap(),
      worldWorkIndex: makeMap(),
      campaign: null,
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
      next.commissionIndex[commission.commissionId] = commission;
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
      var byGame = makeMap();
      if (Array.isArray(raw.professions)) {
        raw.professions.forEach(function (professionId) {
          if (typeof professionId === 'string' && ID_RE.test(professionId)) mark(byGame, professionId);
        });
      }
      next.gameProfessions[gameId] = byGame;
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

    /* ---- 世界通用工作（只读 overlay，不改变既有委托归属） ---- */
    next.worldWork = readWorldWorkOption(options.worldWork, next.commissionSet, errors, warnings);
    if (next.worldWork) {
      next.worldWorkIds = next.worldWork.commissionIds.slice();
      next.worldWorkIds.forEach(function (id) {
        next.worldWorkSet[id] = true;
        next.worldWorkIndex[id] = next.worldWork.byId[id];
      });
    }

    /* ---- 主线章节（可选；只读章节标题/完成旗标/终局入口，供替代叙事取真实内容） ---- */
    next.campaign = readCampaignOption(options.campaign, warnings);

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
          worldWork: input.worldWork !== undefined ? input.worldWork : input.content.worldWork,
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
      var report = {
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
        campaignCount: campaignInfo().chapterOrder.length,
      };
      if (state.worldWork) report.worldWorkCount = state.worldWorkIds.length;
      return report;
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
    var report = {
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
      campaignCount: campaignInfo().chapterOrder.length,
      warnings: state.warnings.slice(),
    };
    if (state.worldWork) report.worldWorkCount = state.worldWorkIds.length;
    return report;
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
   * 世界通用工作路径（只读；不改变原 plan() 的单职业链语义）
   * ------------------------------------------------------------------ */

  function worldWorkFailure(reason, extra) {
    var out = {
      ok: false,
      reason: reason,
      complete: false,
      originGameId: null,
      acceptedProfessionId: null,
      originCommissionId: null,
      steps: [],
      worldCommissionIds: [],
      plannedWorldCommissionIds: [],
      flagsAfter: [],
      evidence: [],
      economy: {
        initialCredits: 0,
        plannedCredits: 0,
        plannedItems: {},
        spentCredits: 0,
        spentItems: {},
        repeatSalaryUsed: false,
        marketRequired: false,
      },
      blockers: [],
    };
    if (isObject(extra)) {
      Object.keys(extra).forEach(function (key) { out[key] = extra[key]; });
    }
    if (!out.blockers.length) {
      out.blockers.push({ kind: reason, id: reason, reason: reason, commissionId: null });
    }
    return out;
  }

  function applyChapterSignalFlags(flags) {
    var chapter = state.chapter;
    if (!chapter || !Array.isArray(chapter.signals)) return;
    chapter.signals.forEach(function (signal) {
      if (!isObject(signal) || typeof signal.flag !== 'string') return;
      var target = typeof signal.mapsTo === 'string' && FLAG_RE.test(signal.mapsTo) ? signal.mapsTo : signal.flag;
      if (marked(flags, target)) return;
      var from = Array.isArray(signal.from) ? signal.from : [];
      if (from.some(function (flag) { return marked(flags, flag); })) {
        mark(flags, signal.flag);
        mark(flags, target);
      }
    });
  }

  function worldWorkStep(commission, meta, order) {
    return {
      kind: 'commission',
      category: 'world',
      id: commission.commissionId,
      commissionId: commission.commissionId,
      tier: commission.tier,
      gameId: commission.gameId,
      title: meta.title,
      summary: meta.summary,
      reason: meta.summary,
      optional: false,
      missing: [],
      order: order,
    };
  }

  function professionStep(commission, order) {
    return {
      kind: 'commission',
      category: 'profession',
      id: commission.commissionId,
      commissionId: commission.commissionId,
      tier: commission.tier,
      gameId: commission.gameId,
      title: commission.title,
      reason: '先把这张属于你当前职业的工单交回，再沿港里的通用活计往下走。',
      optional: false,
      missing: [],
      order: order,
    };
  }

  function buildWorldWorkPath(input) {
    try {
      if (!isConfigured()) return worldWorkFailure(REASONS.notConfigured);
      if (!state.worldWork) return worldWorkFailure('world-work-not-configured');
      var options = isObject(input) ? input : {};
      var originGameId = typeof options.originGameId === 'string' ? options.originGameId : '';
      var acceptedProfessionId = typeof options.acceptedProfessionId === 'string'
        ? options.acceptedProfessionId
        : (typeof options.professionId === 'string' ? options.professionId : '');
      if (!originGameId || !has(state.gameSet, originGameId)) {
        return worldWorkFailure(REASONS.unknownOrigin, { originGameId: originGameId || null });
      }
      if (!acceptedProfessionId || !has(state.professionSet, acceptedProfessionId)) {
        return worldWorkFailure(REASONS.unknownProfession, { acceptedProfessionId: acceptedProfessionId || null });
      }
      var origin = state.originMap[originGameId] || null;
      var ownList = state.byProfession[acceptedProfessionId] || [];
      var tierOne = ownList.filter(function (commission) { return commission.tier === 1; })
        .slice().sort(compareCommissionStandard);
      var originCommission = null;
      if (typeof options.originCommissionId === 'string') {
        var requested = state.commissionIndex[options.originCommissionId] || null;
        if (requested && requested.professionId === acceptedProfessionId && requested.tier === 1) {
          originCommission = requested;
        }
      }
      if (!originCommission) {
        for (var oi = 0; oi < tierOne.length; oi += 1) {
          if (tierOne[oi].gameId === originGameId) {
            originCommission = tierOne[oi];
            break;
          }
        }
      }
      if (!originCommission && tierOne.length) originCommission = tierOne[0];
      if (!originCommission) return worldWorkFailure('origin-first-commission-missing', {
        originGameId: originGameId,
        acceptedProfessionId: acceptedProfessionId,
      });

      /* 职业↔游戏映射只认 registry.games[].professions[]；同游戏可有多个职业，
         跨游戏职业的首单也可以不在 originGameId。旧章节映射只作无 registry 时的兜底。 */
      var registeredForOrigin = state.gameProfessions[originGameId] || null;
      var registeredForFirst = state.gameProfessions[originCommission.gameId] || null;
      var allowed = (registeredForOrigin && marked(registeredForOrigin, acceptedProfessionId))
        || (registeredForFirst && marked(registeredForFirst, acceptedProfessionId))
        || (!Object.keys(state.gameProfessions).length && !!origin && origin.professionId === acceptedProfessionId);
      if (!allowed) {
        return worldWorkFailure('profession-not-registered-for-origin', {
          originGameId: originGameId,
          acceptedProfessionId: acceptedProfessionId,
          originCommissionId: originCommission.commissionId,
        });
      }

      var wallet = walletView(options.wallet);
      var quests = questRowsOf(options.quests);
      var claims = claimRowsOf(options.claims);
      var flagsInput = readFlagsInput(options.flags);
      var cleared = collectCleared(quests, claims);
      var resolved = makeMap();
      Object.keys(cleared).forEach(function (id) { mark(resolved, id); });
      var story = evaluateStory(flagsInput, quests, claims, wallet);
      var steps = [];
      var blockers = [];
      var plannedReceipts = [];
      var plannedCredits = 0;
      var plannedItems = {};
      var rentalAdded = false;
      var ownsShip = ownsAnyShip(wallet.equipment);

      function refreshStory() {
        if (!plannedReceipts.length || !activeEvidenceModule()) return;
        var next = evaluateStory(flagsInput, quests, claims.concat(plannedReceipts), wallet);
        if (next.evidenceUsed) story = next;
      }

      function addReward(commission) {
        plannedCredits += commission.reward.credits;
        Object.keys(commission.reward.items).forEach(function (itemId) {
          plannedItems[itemId] = (plannedItems[itemId] || 0) + commission.reward.items[itemId];
        });
      }

      if (!marked(cleared, originCommission.commissionId)) {
        var originUnlock = evaluateUnlock(originCommission, resolved, story.flags);
        if (!originUnlock.ok) {
          blockers.push({ kind: 'origin-locked', id: originCommission.commissionId, reason: 'origin-unlock-not-met', commissionId: originCommission.commissionId });
        } else {
          steps.push(professionStep(originCommission, steps.length + 1));
          mark(resolved, originCommission.commissionId);
          plannedReceipts.push(syntheticReceipt(originCommission));
          addReward(originCommission);
          refreshStory();
        }
      }

      var worldList = [];
      state.worldWorkIds.forEach(function (id) {
        var commission = state.commissionIndex[id];
        if (commission) worldList.push(commission);
      });
      var chain = buildChain(worldList, 'standard');
      if (!chain.ok) {
        blockers.push({ kind: 'world-chain-cycle', id: 'world-chain-cycle', reason: 'world-chain-cycle', commissionId: null, missing: chain.cycle.slice() });
      } else {
        for (var wi = 0; wi < chain.order.length; wi += 1) {
          var commission = chain.order[wi];
          if (marked(resolved, commission.commissionId)) continue;
          var unlocked = evaluateUnlock(commission, resolved, story.flags);
          if (!unlocked.ok) {
            blockers.push({ kind: 'world-locked', id: commission.commissionId, reason: 'world-unlock-not-met', commissionId: commission.commissionId });
            continue;
          }
          if (has(state.combatGames, commission.gameId) && !ownsShip) {
            if (!state.rentalShip) {
              blockers.push({ kind: 'world-ship-missing', id: commission.commissionId, reason: 'rental-ship-missing', commissionId: commission.commissionId });
              continue;
            }
            if (!rentalAdded) {
              steps.push(rentalStep(state.rentalShip, commission.gameId));
              rentalAdded = true;
            }
          }
          var meta = state.worldWorkIndex[commission.commissionId];
          steps.push(worldWorkStep(commission, meta, steps.length + 1));
          mark(resolved, commission.commissionId);
          plannedReceipts.push(syntheticReceipt(commission));
          addReward(commission);
          refreshStory();
        }
      }

      applyChapterSignalFlags(story.flags);
      /* 章节信号表未注入时，仍按冻结的 C1 收据旗标派生唯一里程碑；只读，不写库。 */
      if (!marked(story.flags, 'C1.signal_fragment')) {
        var c1Sources = ['C1.work_done', 'C1.flight_done', 'C1.signal', 'C1.records'];
        if (c1Sources.some(function (flag) { return marked(story.flags, flag); })) {
          mark(story.flags, 'C1.signal_fragment');
        }
      }
      var evidenceModule = activeEvidenceModule();
      if (!evidenceModule && !blockers.length) {
        blockers.push({ kind: 'evidence-unavailable', id: 'evidence-unavailable', reason: 'evidence-unavailable', commissionId: null });
      }
      var flagsAfter = mapValues(story.flags);
      var evidence = mapValues(story.tokens);
      var complete = blockers.length === 0
        && marked(story.flags, 'C1.signal_fragment')
        && marked(story.flags, 'C2.research_complete')
        && marked(story.flags, 'C3.truth_found')
        && marked(story.flags, 'C4.city_power_restored');
      assignStepOrder(steps);
      return {
        ok: true,
        reason: null,
        complete: complete,
        originGameId: originGameId,
        acceptedProfessionId: acceptedProfessionId,
        originCommissionId: originCommission.commissionId,
        steps: steps,
        worldCommissionIds: state.worldWorkIds.slice(),
        plannedWorldCommissionIds: state.worldWorkIds.filter(function (id) {
          return marked(resolved, id) && !marked(cleared, id);
        }),
        flagsAfter: flagsAfter,
        evidence: evidence,
        economy: {
          initialCredits: wallet.credits,
          plannedCredits: plannedCredits,
          plannedItems: plannedItems,
          spentCredits: 0,
          spentItems: {},
          repeatSalaryUsed: false,
          marketRequired: false,
        },
        blockers: blockers,
      };
    } catch (err) {
      return worldWorkFailure(REASONS.exception, { error: errorText(err) });
    }
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

      var result = {
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
      if (options.includeWorldWork === true) {
        result.worldWorkPath = buildWorldWorkPath(Object.assign({}, options, { acceptedProfessionId: professionId }));
      }
      return result;
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
      var worldWorkLines = [];
      var worldPath = route.worldWorkPath && route.worldWorkPath.ok === true ? route.worldWorkPath : null;
      if (worldPath && Array.isArray(worldPath.steps) && worldPath.steps.length) {
        lines.push('港里还有几张不分行的活计：');
        worldPath.steps.forEach(function (step) {
          if (!step || step.category !== 'world') return;
          var text = '通用活计「' + step.title + '」：' + (step.summary || step.reason || '');
          lines.push(text);
          worldWorkLines.push(text);
        });
        if (!worldPath.complete) lines.push('这些活计还没排齐；先做眼前能接的纸，回头再来看。');
      }
      if (route.summaryText) lines.push(route.summaryText);
      var explained = {
        ok: true,
        title: title,
        lines: lines,
        steps: stepLines,
        blockers: blockerLines,
        alternatives: alternativeLines,
        summary: route.summaryText || '',
        text: lines.join('\n'),
      };
      if (worldWorkLines.length) explained.worldWorkLines = worldWorkLines;
      return explained;
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

  function worldWorkOriginPairs() {
    var seen = makeMap();
    var pairs = [];
    function add(gameId, professionId) {
      if (!has(state.gameSet, gameId) || !has(state.professionSet, professionId)) return;
      var key = gameId + '|' + professionId;
      if (seen[key]) return;
      seen[key] = true;
      pairs.push({ gameId: gameId, professionId: professionId });
    }
    Object.keys(state.gameProfessions).forEach(function (gameId) {
      Object.keys(state.gameProfessions[gameId]).forEach(function (professionId) {
        add(gameId, professionId);
      });
    });
    state.originIds.forEach(function (gameId) {
      var origin = state.originMap[gameId] || null;
      if (origin && origin.professionId) add(gameId, origin.professionId);
    });
    state.commissions.forEach(function (commission) {
      if (commission.tier === 1) add(commission.gameId, commission.professionId);
    });
    /* 完整矩阵与 plan() 一致：任一起源配任一已注册职业都要有通用世界路径，
       具体职业是否允许仍由 registry.games[].professions[] 在路径里校验。 */
    state.originIds.forEach(function (gameId) {
      state.professionIds.forEach(function (professionId) { add(gameId, professionId); });
    });
    pairs.sort(function (a, b) {
      var game = compareText(a.gameId, b.gameId);
      return game !== 0 ? game : compareText(a.professionId, b.professionId);
    });
    return pairs;
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

    /* 10. 世界通用工作：内容引用、全起源到 C4、披露与经济边界。 */
    if (state.worldWork) {
      var badWorldIds = [];
      state.worldWorkIds.forEach(function (id) {
        if (!has(commissionIds, id) || !state.worldWorkIndex[id]) badWorldIds.push(id);
      });
      addCheck('world-work-ids-known', badWorldIds.length === 0 && state.worldWorkIds.length > 0,
        badWorldIds.length ? badWorldIds.join(',') : 'count=' + state.worldWorkIds.length);

      var worldPaths = [];
      var worldPairs = worldWorkOriginPairs();
      var badWorldPaths = [];
      var badWorldLeaks = [];
      var badWorldEconomy = [];
      worldPairs.forEach(function (pair) {
        var pairLabel = pair.gameId + '/' + pair.professionId;
        var path = buildWorldWorkPath({
          originGameId: pair.gameId,
          acceptedProfessionId: pair.professionId,
          wallet: { credits: 80, items: {} },
          quests: [],
          claims: [],
          flags: ['C0.port_seen'],
        });
        worldPaths.push({ originGameId: pair.gameId, professionId: pair.professionId, path: path });
        if (!path.ok || !path.complete) badWorldPaths.push(pairLabel + ':' + (path.reason || 'incomplete'));
        var worldSteps = (path.steps || []).filter(function (step) { return step.category === 'world'; });
        worldSteps.forEach(function (step) {
          if (Object.prototype.hasOwnProperty.call(step, 'professionId')) badWorldLeaks.push(pairLabel + ':profession-field');
          var text = (step.title || '') + ' ' + (step.summary || '') + ' ' + (step.reason || '');
          state.professionIds.forEach(function (id) {
            var meta = state.professionMeta[id] || {};
            if (text.indexOf(id) >= 0 || (meta.displayName && text.indexOf(meta.displayName) >= 0)) {
              badWorldLeaks.push(pairLabel + ':' + id);
            }
          });
        });
        var expectedCredits = 0;
        var expectedItems = {};
        (path.steps || []).forEach(function (step) {
          if (step.kind !== 'commission') return;
          var commission = state.commissionIndex[step.commissionId];
          if (!commission) return;
          expectedCredits += commission.reward.credits;
          Object.keys(commission.reward.items).forEach(function (itemId) {
            expectedItems[itemId] = (expectedItems[itemId] || 0) + commission.reward.items[itemId];
          });
        });
        var economy = path.economy || {};
        if (economy.plannedCredits !== expectedCredits
            || JSON.stringify(economy.plannedItems || {}) !== JSON.stringify(expectedItems)
            || economy.spentCredits !== 0
            || Object.keys(economy.spentItems || {}).length !== 0
            || economy.repeatSalaryUsed !== false
            || economy.marketRequired !== false) {
          badWorldEconomy.push(pairLabel);
        }
      });
      addCheck('world-work-origin-paths', badWorldPaths.length === 0 && worldPaths.length === worldPairs.length && worldPairs.length > 0,
        badWorldPaths.length ? badWorldPaths.slice(0, MAX_WALK).join(',') : 'paths=' + worldPaths.length);
      addCheck('world-work-no-profession-leak', badWorldLeaks.length === 0, badWorldLeaks.slice(0, MAX_WALK).join(','));
      addCheck('world-work-economy', badWorldEconomy.length === 0, badWorldEconomy.slice(0, MAX_WALK).join(','));
    }

    /* 10b. 主线替代叙事：逐章指引结构、卫生与经济面（缺 worldNarrative 时同形）。 */
    if (state.worldWork) {
      var guideIssues = narrativeGuideIssues();
      addCheck('narrative-guide', guideIssues.length === 0, guideIssues.slice(0, MAX_WALK).join(','));
    }

    /* 11. 静态边界：无 DOM/存储/网络/写库/随机/时钟/其它模块 */
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
    var result = {
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
    if (state.worldWork) {
      result.worldWorkPathProof = {
        pairCount: worldPairs.length,
        pairs: worldPairs.slice(),
        passed: worldPairs.length - badWorldPaths.length,
        failures: badWorldPaths.slice(),
      };
    }
    return result;
  }

  /* ------------------------------------------------------------------ *
   * 0.24 主线替代叙事：章节替代指引（只读；缺省输入下与 0.23 同形）
   *
   * catalog.worldNarrative 接受 T22 纯 resolver 的输出形状：
   *   { schemaVersion, chapterId, nodes:[{narrativeNodeId, mechanism, anchor, npcRef,
   *     signatureFrom, available, reason, texts:{offer,progress,receipt,next}, receiptSource}],
   *     crossovers:[...] }
   * 也接受输出数组，或 {C1:output,...} / {chapters:{C1:output,...}} 映射。该输入只
   * 影响本段的公开文案；缺失时给出与 0.23 完全一致的内置替代说明（同一形状、
   * source 恒为 content）。所有替代方式只引用真实内容（world-work 条目 / 明码代办
   * offer / 免费租用机 / story-evidence 记录规则），不写库、不发奖励、不新增
   * reason code，gate 里的 requiresSpecificProfession 恒为 false。
   * ------------------------------------------------------------------ */

  var NARRATIVE_CHAPTER_ORDER = Object.freeze(['C1', 'C2', 'C3', 'C4', 'C5']);
  var NARRATIVE_MECHANISMS = Object.freeze([
    'world-work',
    'profession-commission',
    'errand',
    'rental',
    'market-material',
    'evidence-pair',
  ]);
  var NARRATIVE_MECHANISM_RECEIPT = Object.freeze({
    'world-work': 'commission-receipt',
    'profession-commission': 'commission-receipt',
    'errand': 'alternative-purchase',
    'rental': 'commission-receipt',
    'market-material': 'purchase-ledger',
    'evidence-pair': 'evidence-grant',
  });
  var NARRATIVE_MECHANISM_ANCHOR_KIND = Object.freeze({
    'world-work': 'commission',
    'profession-commission': 'commission',
    'errand': 'offer',
    'rental': 'ship',
    'market-material': 'item',
    'evidence-pair': 'evidencePair',
  });
  var NARRATIVE_CHAPTER_FLAGS = Object.freeze({
    C1: 'C1.signal_fragment',
    C2: 'C2.research_complete',
    C3: 'C3.truth_found',
    C4: 'C4.city_power_restored',
    C5: 'C5.star_tower_resolved',
  });
  var NARRATIVE_FINALE_ENTRY = 'C4.city_power_restored';
  var NARRATIVE_MAX_TEXT = 240;
  var NARRATIVE_MAX_REFS = 3;

  var NARRATIVE_CHAPTER_TEXT = Object.freeze({
    C1: '第一章要的是一笔真实的交割：做一张按钟点结的活、借码头租用机飞一趟，或走一趟明码代办，都算数。',
    C2: '第二章要的是一份能解译的记录：不同去处带回来的现场记录凑在一起就行。',
    C3: '第三章要先对上一段的结论，再补一份能对得上的旧记录。',
    C4: '第四章要的是城市重新通电：靠的是几份不同活计带回来的现场记录。',
    C5: '终局的门槛只有一件事：先让停摆的城市重新通电；三条终局路线都不问出身。',
  });

  function emptyCampaignInfo() {
    return {
      provided: false,
      contentVersion: null,
      chapterIndex: makeMap(),
      chapterOrder: [],
      finaleEntryFlags: [],
      endings: [],
    };
  }

  /**
   * 只读解析 campaign.json：章节完成旗标、章节标题、终局入口旗标与终局标题/说明。
   * 坏内容只记 warning（不阻断既有规划），因为这一段只服务叙事说明。
   */
  function readCampaignOption(raw, warnings) {
    var out = emptyCampaignInfo();
    if (raw === undefined || raw === null) return out;
    if (!isObject(raw) || !Array.isArray(raw.chapters)) {
      warnings.push('campaign-invalid');
      return out;
    }
    if (typeof raw.contentVersion === 'string') out.contentVersion = raw.contentVersion;
    raw.chapters.forEach(function (chapter) {
      if (!isObject(chapter)) return;
      var chapterId = typeof chapter.chapterId === 'string' ? chapter.chapterId : '';
      if (NARRATIVE_CHAPTER_ORDER.indexOf(chapterId) < 0) return;
      if (has(out.chapterIndex, chapterId)) {
        warnings.push('campaign-chapter-duplicate:' + chapterId);
        return;
      }
      var rewardFlags = [];
      var routes = Array.isArray(chapter.routes) ? chapter.routes : [];
      routes.forEach(function (route) {
        if (!isObject(route)) return;
        tokenArray(route.rewardFlags).forEach(function (flag) {
          if (FLAG_RE.test(flag)) rewardFlags.push(flag);
        });
      });
      out.chapterIndex[chapterId] = {
        chapterId: chapterId,
        title: typeof chapter.title === 'string' ? trimText(chapter.title, MAX_TITLE) : '',
        rewardFlags: uniqueSorted(rewardFlags),
      };
      out.chapterOrder.push(chapterId);
    });
    out.chapterOrder.sort();
    var finaleEntry = [];
    var endings = Array.isArray(raw.endings) ? raw.endings : [];
    endings.forEach(function (ending) {
      if (!isObject(ending)) return;
      var approach = typeof ending.approach === 'string' ? ending.approach : '';
      if (!approach || !/^[a-z][a-z0-9-]{0,39}$/.test(approach)) return;
      var entry = isObject(ending.entry) ? ending.entry : {};
      var entryFlags = tokenArray(entry.allFlags).filter(function (flag) {
        return FLAG_RE.test(flag);
      });
      entryFlags.forEach(function (flag) {
        finaleEntry.push(flag);
      });
      out.endings.push({
        approach: approach,
        title: typeof ending.title === 'string' ? trimText(ending.title, MAX_TITLE) : '',
        summary: typeof ending.summary === 'string' ? trimText(ending.summary, MAX_REASON) : '',
        entryFlags: uniqueSorted(entryFlags),
      });
    });
    out.endings.sort(function (a, b) {
      return compareText(a.approach, b.approach);
    });
    out.finaleEntryFlags = uniqueSorted(finaleEntry);
    out.provided = out.chapterOrder.length > 0;
    return out;
  }

  function campaignInfo() {
    return isObject(state.campaign) ? state.campaign : emptyCampaignInfo();
  }

  /**
   * 归一化单个替代叙事节点（resolver 输出与 bridge 按章注入共用同一套校验）。
   * 只保留公开字段；坏形状按 warning 丢弃，绝不抛。
   */
  function normalizeNarrativeNode(node, warnings) {
    if (!isObject(node)) {
      warnings.push('world-narrative-node-invalid');
      return null;
    }
    if (typeof node.narrativeNodeId !== 'string' || !node.narrativeNodeId) {
      warnings.push('world-narrative-node-invalid');
      return null;
    }
    if (NARRATIVE_MECHANISMS.indexOf(node.mechanism) < 0) {
      warnings.push('world-narrative-node-mechanism:' + String(node.mechanism));
      return null;
    }
    if (NARRATIVE_MECHANISM_RECEIPT[node.mechanism] !== node.receiptSource) {
      warnings.push('world-narrative-node-receipt:' + String(node.receiptSource));
      return null;
    }
    if (!isObject(node.texts)) {
      warnings.push('world-narrative-node-texts');
      return null;
    }
    return {
      narrativeNodeId: node.narrativeNodeId,
      mechanism: node.mechanism,
      available: node.available === true,
      receiptSource: node.receiptSource,
      texts: {
        offer: typeof node.texts.offer === 'string' ? node.texts.offer : '',
        progress: typeof node.texts.progress === 'string' ? node.texts.progress : '',
        receipt: typeof node.texts.receipt === 'string' ? node.texts.receipt : '',
        next: typeof node.texts.next === 'string' ? node.texts.next : '',
      },
    };
  }

  /**
   * 归一化 T22 resolver 输出。只保留结构合法的节点；坏形状按 warning 丢弃，
   * 绝不抛、绝不写库。crossovers 不参与本段（交汇只在港口/经历呈现）。
   */
  function readWorldNarrativeInput(raw) {
    var out = { present: false, nodeCount: 0, byChapter: makeMap(), warnings: [] };
    if (raw === undefined || raw === null) return out;
    var outputs = [];
    function accept(value) {
      if (isObject(value) && Array.isArray(value.nodes)) outputs.push(value);
    }
    if (Array.isArray(raw)) {
      raw.forEach(accept);
    } else if (isObject(raw) && Array.isArray(raw.nodes)) {
      accept(raw);
    } else if (isObject(raw)) {
      if (isObject(raw.chapters)) {
        NARRATIVE_CHAPTER_ORDER.forEach(function (chapterId) {
          accept(raw.chapters[chapterId]);
        });
      }
      NARRATIVE_CHAPTER_ORDER.forEach(function (chapterId) {
        accept(raw[chapterId]);
      });
    }
    var seen = makeMap();
    outputs.forEach(function (output) {
      var chapterId = typeof output.chapterId === 'string' ? output.chapterId : '';
      if (NARRATIVE_CHAPTER_ORDER.indexOf(chapterId) < 0) {
        out.warnings.push('world-narrative-chapter-invalid');
        return;
      }
      if (seen[chapterId]) {
        out.warnings.push('world-narrative-chapter-duplicate:' + chapterId);
        return;
      }
      seen[chapterId] = true;
      var nodes = [];
      output.nodes.forEach(function (node) {
        var normalized = normalizeNarrativeNode(node, out.warnings);
        if (normalized) nodes.push(normalized);
      });
      out.byChapter[chapterId] = nodes;
      out.nodeCount += nodes.length;
      out.present = true;
    });
    return out;
  }

  /**
   * 0.24 T24：归一化 bridge 加性注入的按章形状
   * `catalog.worldChapterAlternatives = { C1:[node…], …, C5:[node…] }`
   * （也接受 `{ chapters:{ C1:[node…] } }`）。节点校验与 resolver 输出同一套；
   * 该形状只影响本段公开文案，不改变 plan()/worldWorkPath()/经济面。
   */
  function readWorldChapterAlternativesInput(raw) {
    var out = { present: false, nodeCount: 0, byChapter: makeMap(), warnings: [] };
    if (!isObject(raw)) return out;
    var maps = [raw];
    if (isObject(raw.chapters)) maps.unshift(raw.chapters);
    var seen = makeMap();
    maps.forEach(function (map) {
      NARRATIVE_CHAPTER_ORDER.forEach(function (chapterId) {
        if (seen[chapterId]) return;
        var list = map[chapterId];
        if (!Array.isArray(list)) return;
        seen[chapterId] = true;
        var nodes = [];
        list.forEach(function (node) {
          var normalized = normalizeNarrativeNode(node, out.warnings);
          if (normalized) nodes.push(normalized);
        });
        out.byChapter[chapterId] = nodes;
        out.nodeCount += nodes.length;
        out.present = true;
      });
    });
    return out;
  }

  /** 玩家可见文案卫生：未接受职业一律不点名，内部 id/证据前缀/章节码不进文本。 */
  function narrativeTextBlocked(value) {
    if (typeof value !== 'string' || !value.trim()) return true;
    var blocked = false;
    state.professionIds.forEach(function (professionId) {
      if (blocked) return;
      if (value.indexOf(professionId) >= 0) {
        blocked = true;
        return;
      }
      var meta = state.professionMeta[professionId] || null;
      var displayName = meta && typeof meta.displayName === 'string' ? meta.displayName : '';
      if (displayName && displayName !== professionId && value.indexOf(displayName) >= 0) blocked = true;
    });
    if (blocked) return true;
    if (/(^|[^A-Za-z0-9])(E|MAP|BP|DEC)-[A-Za-z0-9]/.test(value)) return true;
    if (/C[1-5]\.[a-z0-9]/.test(value)) return true;
    if (/\.T[1-6](?![0-9])/.test(value)) return true;
    if (forbiddenTextHits(value).length) return true;
    return false;
  }

  function narrativeTextsClean(texts) {
    if (!isObject(texts)) return false;
    if (narrativeTextBlocked(texts.offer)) return false;
    if (texts.progress && narrativeTextBlocked(texts.progress)) return false;
    if (texts.next && narrativeTextBlocked(texts.next)) return false;
    if (texts.receipt && narrativeTextBlocked(texts.receipt)) return false;
    return true;
  }

  function narrativeNodeFor(narrative, chapterId, mechanism) {
    if (!isObject(narrative) || narrative.present !== true) return null;
    var list = narrative.byChapter[chapterId] || [];
    for (var i = 0; i < list.length; i += 1) {
      var node = list[i];
      if (!node || node.mechanism !== mechanism || node.available !== true) continue;
      if (!narrativeTextsClean(node.texts)) continue;
      return node;
    }
    return null;
  }

  function uniqueInOrder(values) {
    var seen = makeMap();
    var out = [];
    (Array.isArray(values) ? values : []).forEach(function (value) {
      if (typeof value !== 'string' || !value || seen[value]) return;
      seen[value] = true;
      out.push(value);
    });
    return out;
  }

  function tokenClassName(token) {
    var text = typeof token === 'string' ? token : '';
    var dash = text.indexOf('-');
    var prefix = dash > 0 ? text.slice(0, dash) : '';
    return CLASS_LABELS[prefix] || '记录';
  }

  /** 把真实缺口（story-evidence 的 missing 条目）翻成戏内说法；不出现 token 原文。 */
  function missingRecordText(missing) {
    var parts = [];
    (Array.isArray(missing) ? missing : []).forEach(function (item) {
      if (!isObject(item)) return;
      if (item.kind === 'class' && typeof item.class === 'string') {
        var name = CLASS_LABELS[item.class] || '记录';
        var need = toPositiveInt(item.need, toPositiveInt(item.atLeast, 1));
        parts.push(need + ' 份' + name + (item.distinctGames === true ? '（要来自不同去处）' : ''));
      } else if (item.kind === 'token' && typeof item.token === 'string') {
        parts.push('一份' + tokenClassName(item.token));
      } else if (item.kind === 'game') {
        parts.push('一处现场的记录');
      } else if (item.kind === 'flag') {
        parts.push('上一步的结论');
      }
    });
    if (!parts.length) return '';
    return parts.join('；');
  }

  function narrativeStoryOf(options) {
    var wallet = walletView(options.wallet);
    var quests = questRowsOf(options.quests);
    var claims = claimRowsOf(options.claims);
    var story = evaluateStory(readFlagsInput(options.flags), quests, claims, wallet);
    applyChapterSignalFlags(story.flags);
    if (!marked(story.flags, 'C1.signal_fragment')) {
      var c1Sources = ['C1.work_done', 'C1.flight_done', 'C1.signal', 'C1.records'];
      for (var i = 0; i < c1Sources.length; i += 1) {
        if (marked(story.flags, c1Sources[i])) {
          mark(story.flags, 'C1.signal_fragment');
          break;
        }
      }
    }
    return {
      wallet: wallet,
      quests: quests,
      claims: claims,
      cleared: collectCleared(quests, claims),
      flags: story.flags,
      tokens: story.tokens,
      missingByFlag: isObject(story.missingByFlag) ? story.missingByFlag : null,
      evidenceUsed: story.evidenceUsed === true,
    };
  }

  function narrativeMilestoneOf(chapterId) {
    return chapterId === 'C5' ? NARRATIVE_FINALE_ENTRY : NARRATIVE_CHAPTER_FLAGS[chapterId];
  }

  function narrativeMissingFor(story, flag) {
    if (!isObject(story) || !isObject(story.missingByFlag)) return '';
    if (!has(story.missingByFlag, flag)) return '';
    return missingRecordText(story.missingByFlag[flag]);
  }

  function narrativeRequirementsMet(story, flags) {
    if (!Array.isArray(flags)) return true;
    for (var i = 0; i < flags.length; i += 1) {
      if (!marked(story.flags, flags[i])) return false;
    }
    return true;
  }

  function narrativeChapterRequirementFlags(chapterId) {
    var campaign = campaignInfo();
    if (chapterId === 'C5') {
      if (campaign.finaleEntryFlags.length) return campaign.finaleEntryFlags.slice();
      return [NARRATIVE_FINALE_ENTRY];
    }
    var info = campaign.provided ? campaign.chapterIndex[chapterId] : null;
    if (info && info.rewardFlags.length) return info.rewardFlags.slice();
    return [NARRATIVE_CHAPTER_FLAGS[chapterId]];
  }

  function narrativeChapterTitle(chapterId) {
    var campaign = campaignInfo();
    var info = campaign.provided ? campaign.chapterIndex[chapterId] : null;
    if (info && info.title) return info.title;
    if (chapterId === 'C1' && isObject(state.chapter) && typeof state.chapter.title === 'string') {
      return trimText(state.chapter.title, MAX_TITLE);
    }
    return '';
  }

  function narrativePathLabel(pathId) {
    var chapter = state.chapter;
    if (!isObject(chapter)) return '';
    var c1 = isObject(chapter.c1) ? chapter.c1 : null;
    if (!c1 || !Array.isArray(c1.paths)) return '';
    for (var i = 0; i < c1.paths.length; i += 1) {
      var path = c1.paths[i];
      if (!isObject(path) || path.pathId !== pathId) continue;
      return typeof path.label === 'string' ? trimText(path.label, MAX_TITLE) : '';
    }
    return '';
  }

  function narrativeBase(mechanism) {
    return {
      mechanism: mechanism,
      requiresAcceptedProfession: true,
      requiresSpecificProfession: false,
      anchor: { kind: NARRATIVE_MECHANISM_ANCHOR_KIND[mechanism], refs: [] },
      receiptSource: NARRATIVE_MECHANISM_RECEIPT[mechanism],
      available: false,
      source: 'content',
      narrativeNodeId: null,
      label: '',
      texts: { offer: '', progress: '', receipt: '', next: '' },
    };
  }

  function narrativeWorldWorkIds(flagsNeeded) {
    var ids = [];
    state.worldWorkIds.forEach(function (id) {
      var commission = state.commissionIndex[id];
      if (!commission) return;
      if (flagsNeeded && flagsNeeded.length) {
        var hit = false;
        for (var i = 0; i < flagsNeeded.length; i += 1) {
          if (commission.reward.flags.indexOf(flagsNeeded[i]) >= 0) {
            hit = true;
            break;
          }
        }
        if (!hit) return;
      }
      ids.push(id);
    });
    return uniqueSorted(ids);
  }

  function narrativeWorldWorkTitles(ids) {
    var titles = [];
    ids.forEach(function (id) {
      var meta = state.worldWorkIndex[id] || null;
      var commission = state.commissionIndex[id] || null;
      var title = meta && typeof meta.title === 'string' && meta.title
        ? meta.title
        : commission && commission.title ? commission.title : '';
      if (title) titles.push(title);
    });
    return uniqueInOrder(titles);
  }

  function narrativeWorldWorkOpen(story, ids) {
    var open = [];
    ids.forEach(function (id) {
      var commission = state.commissionIndex[id];
      if (!commission || marked(story.cleared, id)) return;
      var unlocked = evaluateUnlock(commission, story.cleared, story.flags);
      if (unlocked.ok) open.push(id);
    });
    return open;
  }

  function narrativeEvidenceRefs() {
    var tokens = [];
    state.worldWorkIds.forEach(function (id) {
      var commission = state.commissionIndex[id];
      if (!commission) return;
      commission.reward.evidence.forEach(function (token) {
        tokens.push(token);
      });
    });
    if (!tokens.length) {
      state.commissions.forEach(function (commission) {
        commission.reward.evidence.forEach(function (token) {
          tokens.push(token);
        });
      });
    }
    return uniqueInOrder(tokens).slice(0, NARRATIVE_MAX_REFS);
  }

  function quoteList(titles) {
    return (Array.isArray(titles) ? titles : []).map(function (title) {
      return '「' + title + '」';
    }).join('、');
  }

  function buildWorldWorkAlternative(chapterId, story, requirementMet) {
    if (!state.worldWork) return null;
    var alt = narrativeBase('world-work');
    var flagsNeeded = [];
    if (chapterId === 'C1') flagsNeeded = ['C1.work_done', 'C1.flight_done', 'C1.storm_done', 'C1.foreman'];
    var ids = narrativeWorldWorkIds(flagsNeeded);
    if (!ids.length) ids = state.worldWorkIds.slice();
    if (!ids.length) return null;
    alt.anchor.refs = ids.slice();
    var titles = narrativeWorldWorkTitles(ids);
    var quoted = quoteList(titles.slice(0, NARRATIVE_MAX_REFS));
    if (!quoted) quoted = '告示板上那几张纸';
    var open = narrativeWorldWorkOpen(story, ids);
    alt.available = open.length > 0 && requirementMet !== true;
    if (chapterId === 'C1') {
      alt.label = narrativePathLabel('work') || '港里的通用活计';
      alt.texts.offer = '港里那几张不分行的活计也记第一章的账：' + quoted
        + '。做完把航报或验收单交回结算窗，账就记上了。';
      alt.texts.progress = alt.available
        ? '告示板上还有没交回的纸，挑一张写得清楚的接。'
        : (requirementMet === true ? '第一章的账已经记上了。' : '这几张不分行的活计都已经交回过了。');
      alt.texts.next = '做完活回结算窗交差，收据夹进你的档；下一步从告示板接着走。';
      return alt;
    }
    var milestone = narrativeMilestoneOf(chapterId);
    var missingText = narrativeMissingFor(story, milestone);
    alt.label = '港里的通用活计';
    if (chapterId === 'C5') {
      alt.texts.offer = '终局之前只剩城市通电这件事；港里不分行的活计带回来的记录也算数：' + quoted
        + '。凑齐这些记录，城市的电就能接回来。';
    } else {
      alt.texts.offer = '港里不分行的活计不看职业，只看带回来的记录：' + quoted
        + '。这些纸留下的现场记录，正好够把这一段拼出来。';
    }
    alt.texts.progress = requirementMet === true
      ? '这一段已经往下走了，港口记下了这一步。'
      : (missingText ? '还差：' + missingText + '。' : '还有没交回的活计，先把纸上的活做完。');
    alt.texts.next = '把活做完，回结算窗口把记录交上去。';
    return alt;
  }

  function buildErrandAlternative(story, requirementMet) {
    var offers = state.alternatives;
    if (!offers.length) return null;
    var alt = narrativeBase('errand');
    alt.anchor.refs = offers.map(function (offer) {
      return offer.offerId;
    }).slice(0, NARRATIVE_MAX_REFS);
    var affordable = offers.filter(function (offer) {
      if (story.wallet.credits < offer.cost.credits) return false;
      var enough = true;
      Object.keys(offer.cost.items).forEach(function (itemId) {
        if ((story.wallet.items[itemId] || 0) < offer.cost.items[itemId]) enough = false;
      });
      return enough;
    });
    alt.available = affordable.length > 0 && requirementMet !== true;
    alt.label = narrativePathLabel('procurement') || '代办窗的明码单';
    var list = offers.slice(0, NARRATIVE_MAX_REFS).map(function (offer) {
      var line = '「' + offer.title + '」';
      if (offer.summary) line += offer.summary;
      return line;
    }).join('；');
    alt.texts.offer = '代办窗的规矩是明码标价、不赊不欠：' + list
      + '。跑完一趟，第一章的线索就落地了。';
    alt.texts.progress = alt.available
      ? '现在手上的工钱够跑这张单子。'
      : (requirementMet === true ? '第一章的线索已经落地了。' : '先把工钱凑够，代办窗的价目就写在纸角。');
    alt.texts.next = '跑完回结算窗看一眼，代办只算一次，不重复收。';
    return alt;
  }

  function narrativeRentalAlternative(requirementMet) {
    if (!state.rentalShip) return null;
    var alt = narrativeBase('rental');
    alt.anchor.refs = [state.rentalShip.shipId];
    alt.available = requirementMet !== true;
    alt.label = narrativePathLabel('rental') || '码头的租用机';
    alt.texts.offer = '机库那台「' + state.rentalShip.name
      + '」可以免费借，不用先买机；借来飞一趟，把航报交回港务处，第一章也算走通了。';
    alt.texts.progress = alt.available
      ? '借机器只要签个字，用完照旧归还，失手不欠维修债。'
      : '第一章已经走通了，这台旧机还停在库里。';
    alt.texts.next = '飞完把航报交回结算窗。';
    return alt;
  }

  function buildEvidencePairAlternative(chapterId, story, requirementMet) {
    if (!activeEvidenceModule()) return null;
    var milestone = narrativeMilestoneOf(chapterId);
    var met = marked(story.flags, milestone);
    var known = isObject(story.missingByFlag) && has(story.missingByFlag, milestone);
    if (!known && !met) return null;
    var alt = narrativeBase('evidence-pair');
    alt.anchor.refs = narrativeEvidenceRefs();
    if (!alt.anchor.refs.length) return null;
    alt.available = !met && requirementMet !== true;
    alt.label = narrativePathLabel('research') || '凑齐现场记录';
    var missingText = met ? '' : narrativeMissingFor(story, milestone);
    alt.texts.offer = '现场记录不是一张纸的事：不同来处的记录凑在一起，研究院才能把这一段解译出来；'
      + '港里的通用活计也会留下这类记录。';
    alt.texts.progress = met || requirementMet === true
      ? '记录已经凑齐，这一段已经往下走了。'
      : (missingText ? '还差：' + missingText + '。' : '再把记录凑一凑，缺哪一类就再带一份回来。');
    alt.texts.next = '把缺的那类记录带回来，回结算窗口合上。';
    return alt;
  }

  function buildFinaleApproaches(story, requirementMet) {
    var campaign = campaignInfo();
    if (!campaign.endings.length) return null;
    var approaches = campaign.endings.map(function (ending) {
      var chosen = marked(story.flags, 'ending.' + ending.approach);
      return {
        approach: ending.approach,
        title: narrativeTextBlocked(ending.title) ? '' : ending.title,
        summary: narrativeTextBlocked(ending.summary) ? '' : ending.summary,
        available: requirementMet === true && !chosen,
        chosen: chosen,
        requiresSpecificProfession: false,
      };
    });
    return {
      text: '三条终局路线都不问出身，只要城市通电就能挑一条走完；走完仍可回港口自由接单。',
      approaches: approaches,
    };
  }

  function buildChapterGuide(chapterId, story, narrative) {
    var flags = narrativeChapterRequirementFlags(chapterId);
    var requirementMet = narrativeRequirementsMet(story, flags);
    var requirementText = NARRATIVE_CHAPTER_TEXT[chapterId] || '这一段先看港口手上的真实记录。';
    var alternatives = [];
    var builders = [];
    if (state.worldWork) {
      builders.push(function () {
        return buildWorldWorkAlternative(chapterId, story, requirementMet);
      });
    }
    if (chapterId === 'C1') {
      builders.push(function () {
        return buildErrandAlternative(story, requirementMet);
      });
      builders.push(function () {
        return narrativeRentalAlternative(requirementMet);
      });
    } else {
      builders.push(function () {
        return buildEvidencePairAlternative(chapterId, story, requirementMet);
      });
    }
    builders.forEach(function (build) {
      var alt = build();
      if (!alt) return;
      var node = narrativeNodeFor(narrative, chapterId, alt.mechanism);
      if (node) {
        alt.source = 'world-narrative';
        alt.narrativeNodeId = node.narrativeNodeId;
        alt.texts = {
          offer: trimText(node.texts.offer, NARRATIVE_MAX_TEXT),
          progress: trimText(node.texts.progress, NARRATIVE_MAX_TEXT),
          receipt: trimText(node.texts.receipt, NARRATIVE_MAX_TEXT),
          next: trimText(node.texts.next, NARRATIVE_MAX_TEXT),
        };
      } else {
        alt.texts = {
          offer: trimText(alt.texts.offer, NARRATIVE_MAX_TEXT),
          progress: trimText(alt.texts.progress, NARRATIVE_MAX_TEXT),
          receipt: '',
          next: trimText(alt.texts.next, NARRATIVE_MAX_TEXT),
        };
      }
      alternatives.push(alt);
    });
    var chapter = {
      chapterId: chapterId,
      title: narrativeChapterTitle(chapterId),
      requirement: {
        flags: flags.slice(),
        met: requirementMet,
        text: requirementText + (requirementMet ? ' 港口已经记下了这一步。' : ' 眼下还差这一步。'),
      },
      alternatives: alternatives,
      finale: null,
    };
    if (chapterId === 'C5') chapter.finale = buildFinaleApproaches(story, requirementMet);
    return chapter;
  }

  function guideFailure(reason, extra) {
    var out = {
      ok: false,
      reason: reason,
      contentVersion: state.contentVersion,
      readOnly: true,
      worldNarrative: 'absent',
      narrativeNodeCount: 0,
      originGameId: null,
      acceptedProfessionId: null,
      chapters: [],
    };
    if (isObject(extra)) {
      Object.keys(extra).forEach(function (key) {
        out[key] = extra[key];
      });
    }
    return out;
  }

  /**
   * 逐章替代指引：C1–C5 每段给出「可用的替代方式 + 为什么在故事上成立」的公开
   * 文案。只读真实内容与调用方注入的只读上下文；不改变 plan()/worldWorkPath()
   * 的任何输出，也不产生任何经济写入。
   *
   * @param {{catalog?:{worldNarrative?:*}, originGameId?:string,
   *   acceptedProfessionId?:string, professionId?:string, flags?:*,
   *   quests?:*, claims?:*, wallet?:*, evidence?:*}} input
   */
  function chapterAlternatives(input) {
    try {
      if (!isConfigured()) return guideFailure(REASONS.notConfigured);
      var options = isObject(input) ? input : {};
      var originGameId = typeof options.originGameId === 'string' ? options.originGameId : '';
      var acceptedProfessionId = typeof options.acceptedProfessionId === 'string'
        ? options.acceptedProfessionId
        : (typeof options.professionId === 'string' ? options.professionId : '');
      if (originGameId && !has(state.gameSet, originGameId)) {
        return guideFailure(REASONS.unknownOrigin, { originGameId: originGameId });
      }
      if (acceptedProfessionId && !has(state.professionSet, acceptedProfessionId)) {
        return guideFailure(REASONS.unknownProfession, { acceptedProfessionId: acceptedProfessionId });
      }
      var catalog = isObject(options.catalog) ? options.catalog : {};
      /* 0.24 T24：优先读取 bridge 按章注入的 catalog.worldChapterAlternatives；
         未注入时退回 T21/T22 的 catalog.worldNarrative resolver 输出形状，行为不变。 */
      var narrative = readWorldNarrativeInput(catalog.worldNarrative);
      if (!narrative.present || narrative.nodeCount === 0) {
        var injected = readWorldChapterAlternativesInput(catalog.worldChapterAlternatives);
        if (injected.present) narrative = injected;
      }
      var story = narrativeStoryOf(options);
      var chapters = [];
      NARRATIVE_CHAPTER_ORDER.forEach(function (chapterId) {
        chapters.push(buildChapterGuide(chapterId, story, narrative));
      });
      return {
        ok: true,
        reason: null,
        contentVersion: state.contentVersion,
        readOnly: true,
        worldNarrative: narrative.present ? 'present' : 'absent',
        narrativeNodeCount: narrative.nodeCount,
        originGameId: originGameId || null,
        acceptedProfessionId: acceptedProfessionId || null,
        chapters: chapters,
      };
    } catch (err) {
      return guideFailure(REASONS.exception, { error: errorText(err) });
    }
  }

  /** validate 用：替代指引的结构/卫生/经济面自检（只读，不抛）。 */
  function narrativeGuideIssues() {
    var issues = [];
    var guide = chapterAlternatives({});
    if (!guide || guide.ok !== true) {
      issues.push('guide-failed:' + (guide && guide.reason ? guide.reason : 'unknown'));
      return issues;
    }
    if (guide.worldNarrative !== 'absent') issues.push('guide-narrative-default');
    if (guide.chapters.length !== NARRATIVE_CHAPTER_ORDER.length) issues.push('guide-chapter-count');
    guide.chapters.forEach(function (chapter) {
      var tag = chapter.chapterId;
      if (!isObject(chapter.requirement) || !Array.isArray(chapter.requirement.flags)) issues.push(tag + ':requirement');
      if (!Array.isArray(chapter.alternatives) || !chapter.alternatives.length) issues.push(tag + ':empty');
      (chapter.alternatives || []).forEach(function (alt) {
        if (alt.requiresSpecificProfession !== false) issues.push(tag + ':profession-gate');
        if (alt.requiresAcceptedProfession !== true) issues.push(tag + ':accepted-gate');
        if (NARRATIVE_MECHANISMS.indexOf(alt.mechanism) < 0) issues.push(tag + ':mechanism');
        if (NARRATIVE_MECHANISM_RECEIPT[alt.mechanism] !== alt.receiptSource) issues.push(tag + ':receipt');
        if (!isObject(alt.anchor) || !Array.isArray(alt.anchor.refs) || !alt.anchor.refs.length) issues.push(tag + ':anchor');
        if (narrativeTextBlocked(alt.label)) issues.push(tag + ':label');
        if (narrativeTextBlocked(alt.texts && alt.texts.offer)) issues.push(tag + ':offer');
        if (alt.texts && alt.texts.progress && narrativeTextBlocked(alt.texts.progress)) issues.push(tag + ':progress');
        if (alt.texts && alt.texts.next && narrativeTextBlocked(alt.texts.next)) issues.push(tag + ':next');
      });
    });
    var serialized = JSON.stringify(guide);
    if (serialized.indexOf('"credits"') >= 0 || serialized.indexOf('"reward"') >= 0) {
      issues.push('guide-economy-field');
    }
    return issues;
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
    MECHANISMS: NARRATIVE_MECHANISMS,
    CHAPTER_FLAGS: NARRATIVE_CHAPTER_FLAGS,
    MECHANISM_RECEIPT_SOURCE: NARRATIVE_MECHANISM_RECEIPT,
    REASONS: REASONS,
    configure: configure,
    reset: reset,
    status: status,
    isConfigured: isConfigured,
    plan: plan,
    worldWorkPath: buildWorldWorkPath,
    chapterAlternatives: chapterAlternatives,
    explain: explain,
    validate: validate,
    create: buildInstance,
  };
  return api;
  }

  return buildInstance();
});
