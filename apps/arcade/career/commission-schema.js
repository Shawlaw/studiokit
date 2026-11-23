/*!
 * StudioKit Arcade Life — 0.17 委托内容 schema / 真实事件目录 / fixture 形状（D17-02）
 *
 * 纯函数、无 DOM、无网络、无 IndexedDB、无文件系统读写；浏览器挂到
 * window.ArcadeCareerCommissionSchema 与 window.ArcadeCareer.commissionSchema，
 * Node 中可直接 require() 用于确定性校验。
 *
 * 职责边界（docs/arcade-life/ADR-interfaces.md §19）：
 * - EVENT_CATALOG：§19.4 的 16 游戏真实事件目录（kind → payload 字段类型/必填，只读）；
 * - validateCommissionContent(content)：96 条委托内容分层校验（错误阻塞、告警不阻塞）；
 * - validateFixtureShape(fixture)：§19.8 fixture 导出形状校验；
 * - tierUnlockPlan(commission)：把 unlock 链翻译成可读解锁条件（供测试/文档）；
 * - assertNoSpoilers(content)：T4–T6 标题中性、summary 无剧情解释词、T1–T3 无系统词。
 *
 * 约定：
 * - 任何公开函数都不抛异常；输入缺失/畸形一律降级为 {ok:false, errors[]} 或空数组；
 * - errors 为阻塞性契约违规；warnings 为内容质量/跨文件漂移，不阻塞（runner 可用 --strict 升级）；
 * - 本文件不复制内容，不写内容；内容由 content/commissions.json 提供。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory();
    return;
  }
  var api = factory();
  root.ArcadeCareer = root.ArcadeCareer || {};
  root.ArcadeCareer.commissionSchema = api;
  root.ArcadeCareerCommissionSchema = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var SCHEMA_VERSION = 1;
  /** 0.17 内容版本（ADR §19.2 / §12 版本链）。 */
  var CONTENT_VERSION = '0.18.0';
  /** 每游戏阶数（ADR §19.2：T1–T6）。 */
  var TIERS = Object.freeze([1, 2, 3, 4, 5, 6]);
  /** T4–T6 额外章节旗标（ADR §19.2 tier 解锁链）。 */
  var CHAPTER_FLAGS = Object.freeze({
    4: 'C3.truth_found',
    5: 'C4.city_power_restored',
    6: 'C5.star_tower_resolved',
  });
  /** 16 游戏（ADR §19.4 顺序；内容/事件目录的唯一来源）。 */
  var GAME_IDS = Object.freeze([
    'memory-flip',
    'merge-2048',
    'blackjack',
    'gomoku',
    'solitaire',
    'snowbells',
    'brick-breaker',
    'gravity-flip',
    'snake-run',
    'mole-whack',
    'block-drop',
    'star-raid',
    'road-rush',
    'shadow-leap',
    'pendulum-tower',
    'gold-miner',
  ]);
  /** 16 职业（content/registry.json 0.15 冻结；仅作无 options 时的兜底）。 */
  var DEFAULT_PROFESSION_IDS = Object.freeze([
    'research.archivist',
    'research.lattice',
    'research.gravity',
    'intel.risk',
    'intel.tactics',
    'engineering.dispatcher',
    'engineering.demolition',
    'engineering.maintenance',
    'engineering.warehouse',
    'engineering.driver',
    'engineering.structural',
    'nature.snowscout',
    'nature.ecologist',
    'nature.miner',
    'adventure.pilot',
    'adventure.relicseeker',
  ]);
  /** 五材（ADR §19.5）；crystal 是 0.16 遗留别名，读取时映射到 starcrystal。 */
  var MATERIAL_IDS = Object.freeze(['building', 'alloy', 'electronics', 'starcrystal', 'biomass']);
  var MATERIAL_ALIASES = Object.freeze({ crystal: 'starcrystal' });
  /** 星海生涯起始主题（ADR §19.2 startParams）。 */
  var STAR_RAID_THEMES = Object.freeze(['patrol', 'asteroid', 'storm', 'blockade', 'nebula', 'mothership']);
  var RISK_LEVELS = Object.freeze(['low', 'medium', 'high']);
  var EVIDENCE_PREFIXES = Object.freeze(['E', 'MAP', 'BP', 'DEC']);
  /** 奖励上限与轨迹（career-core.RULESET 兜底；此处只做内容侧静态校验）。 */
  var MAX_CREDITS = 400;
  var MAX_SALARY = 400;
  var MAX_TITLE_LENGTH = 24;
  var MAX_SUMMARY_LENGTH = 60;
  var ITEM_CAP = 99;

  var ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
  var GAME_ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
  var KIND_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
  var EVIDENCE_RE = /^(E|MAP|BP|DEC)-[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
  var FLAG_RE = /^C[1-9]\.[a-z0-9][a-z0-9._-]{0,60}$/;

  /* 条件谓词允许键（与 registry.js §6 一致；本模块不依赖 registry，避免装载顺序耦合）。 */
  var CONDITION_KEYS = Object.freeze([
    'all',
    'any',
    'capability',
    'evidence',
    'chapterFlag',
    'commissionCleared',
    'item',
    'credits',
  ]);

  /* 剧透/系统词表：仅用于检测，不代表剧情事实；命中只做告警/审计，不改内容。 */
  var SPOILER_TERMS = Object.freeze([
    '结局',
    '星塔',
    '密钥',
    'E-7',
    '黎序',
    '阿砾',
    '七段',
  ]);
  var NARRATIVE_TERMS = Object.freeze([
    '真相',
    '谜底',
    '幕后',
    '内幕',
    '内应',
    '叛徒',
    '阴谋',
    '身世',
    '往事',
    '回忆',
    '重逢',
    '牺牲',
  ]);
  var SYSTEM_TERMS = Object.freeze([
    '系统',
    '模式',
    '奖励',
    '结算',
    '积分',
    '分数',
    '关卡',
    '道具',
    '解锁',
    '界面',
    '按钮',
    '菜单',
    '存档',
    '刷新',
    '任务',
    '目标',
    '委托',
  ]);

  /* ------------------------------------------------------------------ *
   * 基础工具
   * ------------------------------------------------------------------ */

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function isInt(value) {
    return typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value;
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
  }

  function isToken(value) {
    return typeof value === 'string' && ID_RE.test(value);
  }

  function isKind(value) {
    return typeof value === 'string' && KIND_RE.test(value);
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function text(value) {
    return typeof value === 'string' ? value : '';
  }

  function lower(value) {
    return text(value).toLowerCase();
  }

  function containsTerm(value, term) {
    var haystack = lower(value);
    var needle = lower(term);
    return needle.length > 0 && haystack.indexOf(needle) >= 0;
  }

  function issue(rule, subject, message) {
    return rule + '[' + (subject || '-') + ']: ' + message;
  }

  function errorText(err) {
    if (!err) return 'unknown';
    if (typeof err === 'string') return err;
    return typeof err.message === 'string' && err.message ? err.message : String(err);
  }

  /* ------------------------------------------------------------------ *
   * §19.4 真实事件目录（kind → payload 字段类型/必填）
   * ------------------------------------------------------------------ */

  /** payload 字段描述：type ∈ string|number|boolean；required 表示适配器必须提供。 */
  function field(type, required) {
    return Object.freeze({ type: type, required: required !== false });
  }

  function payloadOf(fields) {
    var out = {};
    Object.keys(fields).forEach(function (name) {
      out[name] = fields[name];
    });
    return Object.freeze(out);
  }

  function event(status, fields, summary) {
    return Object.freeze({
      status: status === 'existing' ? 'existing' : 'new',
      summary: typeof summary === 'string' ? summary : '',
      payload: payloadOf(fields),
    });
  }

  var EVENT_CATALOG = Object.freeze({
    'memory-flip': Object.freeze({
      'pair.match': event('existing', {
        symbol: field('string', false),
        level: field('number', false),
        moves: field('number', false),
      }, '有效配对'),
      'session.finish': event('new', {
        level: field('number', false),
        matches: field('number', false),
        outcome: field('string', true),
      }, '一局结束'),
    }),
    'merge-2048': Object.freeze({
      'tile.created': event('new', {
        value: field('number', true),
      }, '生成/合并出指定数值的格子'),
      'tile.merged': event('existing', {
        value: field('number', false),
        score: field('number', false),
        moves: field('number', false),
      }, '合并成功'),
    }),
    blackjack: Object.freeze({
      'hand.settled': event('existing', {
        handNo: field('number', false),
        result: field('string', false),
        points: field('number', false),
      }, '一手结算'),
    }),
    gomoku: Object.freeze({
      'move.legal': event('new', {
        moves: field('number', true),
      }, '合法落子'),
      'session.finish': event('new', {
        result: field('string', true),
        moves: field('number', false),
      }, '一局结束'),
    }),
    solitaire: Object.freeze({
      'stock.face_up': event('new', {
        count: field('number', true),
      }, '翻开暗牌'),
      'foundation.move': event('new', {
        count: field('number', true),
      }, '移入基础牌堆'),
      'move.legal': event('new', {
        moves: field('number', true),
      }, '合法牌堆/列移动（0.17 补充，供高阶调度委托）'),
    }),
    snowbells: Object.freeze({
      'bell.rung': event('existing', {
        combo: field('number', false),
        gain: field('number', false),
      }, '踩铃'),
      'bell.unique': event('new', {
        bellId: field('string', true),
        count: field('number', true),
      }, '不同铃铛'),
      'height.reached': event('new', {
        height: field('number', true),
      }, '到达高度'),
    }),
    'brick-breaker': Object.freeze({
      'brick.destroyed': event('existing', {
        level: field('number', false),
        maxHp: field('number', false),
      }, '击碎砖块'),
      'stage.clear': event('new', {
        level: field('number', true),
      }, '完成一层'),
    }),
    'gravity-flip': Object.freeze({
      'gravity.flip': event('existing', {
        dist: field('number', false),
        lives: field('number', false),
      }, '重力翻转'),
      'distance.reached': event('new', {
        meters: field('number', true),
      }, '到达里程'),
    }),
    'snake-run': Object.freeze({
      'fruit.eaten': event('existing', {
        foodsEaten: field('number', false),
        golden: field('boolean', false),
      }, '吃到果实'),
    }),
    'mole-whack': Object.freeze({
      'mole.hit': event('existing', {
        index: field('number', false),
        gained: field('number', false),
        combo: field('number', false),
      }, '正确击中'),
      'combo.reached': event('new', {
        combo: field('number', true),
      }, '到达连击'),
    }),
    'block-drop': Object.freeze({
      'lines.cleared': event('existing', {
        rows: field('number', false),
        lines: field('number', false),
        level: field('number', false),
      }, '消除行'),
    }),
    'star-raid': Object.freeze({
      'enemy.killed': event('existing', {
        kind: field('string', false),
        level: field('number', false),
        theme: field('string', false),
      }, '击毁敌机'),
      'boss.defeated': event('existing', {
        level: field('number', false),
        theme: field('string', false),
      }, '击败 Boss'),
      'wave.completed': event('new', {
        level: field('number', true),
        theme: field('string', false),
      }, '完成一波'),
    }),
    'road-rush': Object.freeze({
      overtake: event('existing', {
        passedCars: field('number', false),
        combo: field('number', false),
      }, '超车'),
      'distance.reached': event('new', {
        meters: field('number', true),
      }, '到达里程'),
    }),
    'shadow-leap': Object.freeze({
      'height.reached': event('existing', {
        meters: field('number', true),
      }, '到达高度'),
      'scroll.collected': event('new', {
        scrollId: field('string', true),
      }, '取得卷轴'),
    }),
    'pendulum-tower': Object.freeze({
      'tower.floor_stable': event('existing', {
        floor: field('number', true),
        perfect: field('boolean', false),
      }, '稳定一层（倒塌不计）'),
    }),
    'gold-miner': Object.freeze({
      'mineral.returned': event('existing', {
        value: field('number', true),
        level: field('number', false),
      }, '吊回矿物'),
    }),
  });

  /** kind → [{gameId, spec}] 反查索引（同一 kind 可被多款游戏复用）。 */
  var EVENT_INDEX = (function () {
    var index = {};
    GAME_IDS.forEach(function (gameId) {
      var table = EVENT_CATALOG[gameId];
      Object.keys(table).forEach(function (kind) {
        if (!index[kind]) index[kind] = [];
        index[kind].push({ gameId: gameId, spec: table[kind] });
      });
    });
    return index;
  })();

  var EVENT_KINDS = Object.freeze(Object.keys(EVENT_INDEX).sort());

  function isKindInCatalog(kind) {
    return typeof kind === 'string' && hasOwn(EVENT_INDEX, kind);
  }

  /** 该游戏在 §19.4 中声明的事件 kind 列表（只读副本）。 */
  function eventKindsFor(gameId) {
    var table = EVENT_CATALOG[gameId];
    return table ? Object.keys(table) : [];
  }

  /** 取事件规格；不存在返回 null。 */
  function eventSpec(gameId, kind) {
    var table = EVENT_CATALOG[gameId];
    if (!table || !hasOwn(table, kind)) return null;
    return table[kind];
  }

  /** kind 在哪些游戏的目录里（用于诊断“目录里有、但这游戏没声明”）。 */
  function gamesForKind(kind) {
    var entries = EVENT_INDEX[kind];
    return entries ? entries.map(function (entry) { return entry.gameId; }) : [];
  }

  /** 事件 payload 字段名列表（声明顺序）。 */
  function payloadFields(gameId, kind) {
    var spec = eventSpec(gameId, kind);
    return spec ? Object.keys(spec.payload) : [];
  }

  /* ------------------------------------------------------------------ *
   * 条件谓词形状（与 registry.js CONDITION_KEYS 同构，本模块自持，避免装载顺序耦合）
   * ------------------------------------------------------------------ */

  var condDepth = 0;

  function conditionShapeOk(condition) {
    if (!isObject(condition) || condDepth > 24) return false;
    var keys = Object.keys(condition);
    if (!keys.length) return false;
    for (var i = 0; i < keys.length; i += 1) {
      if (CONDITION_KEYS.indexOf(keys[i]) < 0 && keys[i] !== 'atLeast') return false;
    }
    condDepth += 1;
    try {
      if (condition.all !== undefined) {
        if (!Array.isArray(condition.all)) return false;
        for (var a = 0; a < condition.all.length; a += 1) {
          if (!conditionShapeOk(condition.all[a])) return false;
        }
        return true;
      }
      if (condition.any !== undefined) {
        if (!Array.isArray(condition.any)) return false;
        for (var b = 0; b < condition.any.length; b += 1) {
          if (!conditionShapeOk(condition.any[b])) return false;
        }
        return true;
      }
      if (condition.capability !== undefined) return isNonEmptyString(condition.capability);
      if (condition.evidence !== undefined) return isNonEmptyString(condition.evidence);
      if (condition.chapterFlag !== undefined) return isNonEmptyString(condition.chapterFlag);
      if (condition.commissionCleared !== undefined) {
        return typeof condition.commissionCleared === 'string' && ID_RE.test(condition.commissionCleared);
      }
      if (condition.item !== undefined) {
        return isNonEmptyString(condition.item) && (!hasOwn(condition, 'atLeast') || Number(condition.atLeast) > 0);
      }
      if (condition.credits !== undefined) {
        if (!isObject(condition.credits)) return false;
        var need = Number(condition.credits.atLeast);
        return isFiniteNumber(need) && need >= 0;
      }
      return false;
    } finally {
      condDepth -= 1;
    }
  }

  /** 扁平化 unlock 条件（all/any 递归），供 tierUnlockPlan/内容校验共用。 */
  function flattenConditions(condition, out, group) {
    var list = out || [];
    if (!isObject(condition)) return list;
    if (Array.isArray(condition.all)) {
      for (var i = 0; i < condition.all.length; i += 1) flattenConditions(condition.all[i], list, group || 'all');
      return list;
    }
    if (Array.isArray(condition.any)) {
      for (var j = 0; j < condition.any.length; j += 1) flattenConditions(condition.any[j], list, 'any');
      return list;
    }
    list.push({ condition: condition, group: group || 'single' });
    return list;
  }

  /* ------------------------------------------------------------------ *
   * validateCommissionContent：96 条内容分层校验
   * ------------------------------------------------------------------ */

  function makeContext(options) {
    var opts = isObject(options) ? options : {};
    var games = Array.isArray(opts.gameIds) && opts.gameIds.length ? opts.gameIds.slice() : GAME_IDS.slice();
    var professions = Array.isArray(opts.professionIds) && opts.professionIds.length
      ? opts.professionIds.slice()
      : DEFAULT_PROFESSION_IDS.slice();
    var materials = Array.isArray(opts.materialIds) && opts.materialIds.length ? opts.materialIds.slice() : MATERIAL_IDS.slice();
    return {
      expectedContentVersion: typeof opts.contentVersion === 'string' && opts.contentVersion ? opts.contentVersion : CONTENT_VERSION,
      games: games,
      gameIndex: games.reduce(function (acc, id) { acc[id] = true; return acc; }, {}),
      professions: professions,
      professionIndex: professions.reduce(function (acc, id) { acc[id] = true; return acc; }, {}),
      materials: materials,
      materialIndex: materials.reduce(function (acc, id) { acc[id] = true; return acc; }, {}),
      strictSpoilers: opts.strictSpoilers === true,
    };
  }

  function validateReward(reward, ctx, id, errors, warnings) {
    if (!isObject(reward)) {
      errors.push(issue('reward-invalid', id, 'reward 必须是对象'));
      return;
    }
    if (!isInt(reward.credits) || reward.credits < 0 || reward.credits > MAX_CREDITS) {
      errors.push(issue('reward-credits', id, 'credits 必须是 0..' + MAX_CREDITS + ' 的整数'));
    }
    if (reward.items !== undefined && !isObject(reward.items)) {
      errors.push(issue('reward-items-invalid', id, 'items 必须是对象'));
    } else if (isObject(reward.items)) {
      Object.keys(reward.items).forEach(function (itemId) {
        var count = reward.items[itemId];
        if (hasOwn(MATERIAL_ALIASES, itemId)) {
          warnings.push(issue('reward-item-legacy-alias', id, itemId + ' 是 0.16 遗留别名，奖励应写 ' + MATERIAL_ALIASES[itemId]));
        } else if (!hasOwn(ctx.materialIndex, itemId)) {
          errors.push(issue('reward-item-unknown', id, '未知材料 ' + itemId));
        }
        if (!isInt(count) || count < 1 || count > ITEM_CAP) {
          errors.push(issue('reward-item-count', id, itemId + ' 数量必须是 1..' + ITEM_CAP + ' 的整数'));
        }
      });
    }
    var evidence = reward.evidence;
    if (evidence !== undefined && !Array.isArray(evidence)) {
      errors.push(issue('reward-evidence-invalid', id, 'evidence 必须是数组'));
    } else if (Array.isArray(evidence)) {
      var seenEvidence = {};
      evidence.forEach(function (token) {
        if (typeof token !== 'string' || !EVIDENCE_RE.test(token)) {
          errors.push(issue('reward-evidence-token', id, JSON.stringify(token) + ' 不是稳定证据 token（E-/MAP-/BP-/DEC-）'));
          return;
        }
        if (hasOwn(ctx.materialIndex, token) || hasOwn(MATERIAL_ALIASES, token)) {
          errors.push(issue('reward-evidence-material', id, token + ' 是可交易材料，不能作为证据'));
        }
        if (seenEvidence[token]) {
          errors.push(issue('reward-evidence-duplicate', id, token + ' 重复'));
        }
        seenEvidence[token] = true;
        var scoped = ['E', 'MAP', 'BP', 'DEC'].some(function (prefix) {
          return token === prefix + '-' + id;
        });
        if (!scoped) {
          warnings.push(issue('reward-evidence-not-commission-scoped', id, token + ' 不是 E/MAP/BP/DEC-<' + id + '>（跨章/遗留 token，需确认）'));
        }
      });
    }
    var flags = reward.flags;
    if (flags !== undefined && !Array.isArray(flags)) {
      errors.push(issue('reward-flags-invalid', id, 'flags 必须是数组'));
    } else if (Array.isArray(flags)) {
      var seenFlags = {};
      flags.forEach(function (flag) {
        if (typeof flag !== 'string' || !FLAG_RE.test(flag)) {
          errors.push(issue('reward-flag-token', id, JSON.stringify(flag) + ' 不是稳定剧情旗标（C<n>.*）'));
          return;
        }
        if (seenFlags[flag]) errors.push(issue('reward-flag-duplicate', id, flag + ' 重复'));
        seenFlags[flag] = true;
      });
    }
    Object.keys(reward).forEach(function (key) {
      if (['credits', 'items', 'evidence', 'flags'].indexOf(key) < 0) {
        warnings.push(issue('reward-unknown-field', id, key + ' 不是 §19.2 声明的奖励字段'));
      }
    });
  }

  function validateObjective(objective, gameId, tier, ctx, id, errors, warnings) {
    if (!isObject(objective)) {
      errors.push(issue('objective-invalid', id, 'objective 必须是对象'));
      return;
    }
    var kind = objective.kind;
    if (typeof kind !== 'string' || !isKind(kind)) {
      errors.push(issue('objective-kind-invalid', id, 'objective.kind 必须是合法 kind'));
    } else if (!isKindInCatalog(kind)) {
      errors.push(issue('objective-kind-unknown', id, kind + ' 不在 §19.4 真实事件目录中'));
    } else if (!eventSpec(gameId, kind)) {
      warnings.push(issue(
        'objective-kind-not-in-game-catalog',
        id,
        kind + ' 在目录中（' + gamesForKind(kind).join('/') + '），但 §19.4 未给 ' + gameId + ' 声明该事件'
      ));
    }
    if (!isInt(objective.atLeast) || objective.atLeast < 1) {
      errors.push(issue('objective-atleast', id, 'atLeast 必须是 >=1 的整数'));
    }
    if (objective.context !== undefined && objective.context !== null) {
      if (!isObject(objective.context)) {
        errors.push(issue('objective-context-invalid', id, 'context 必须是对象'));
      } else {
        var declared = eventSpec(gameId, kind);
        Object.keys(objective.context).forEach(function (key) {
          if (!isKind(key)) {
            errors.push(issue('objective-context-field', id, key + ' 不是合法字段名'));
            return;
          }
          var value = objective.context[key];
          if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
            errors.push(issue('objective-context-value', id, key + ' 只支持 string/number/boolean（区间不支持）'));
          }
          if (declared && !hasOwn(declared.payload, key)) {
            warnings.push(issue('objective-context-field-unverified', id, key + ' 不在 ' + kind + ' 的 payload 字段中（若走 stats 回退需确认）'));
          }
        });
      }
    }
    if (objective.minValue !== undefined) {
      var mv = objective.minValue;
      if (!isObject(mv)) {
        errors.push(issue('objective-minvalue-invalid', id, 'minValue 必须是 {field,value} 对象'));
      } else {
        var fieldName = mv.field;
        if (typeof fieldName !== 'string' || !isKind(fieldName)) {
          errors.push(issue('objective-minvalue-field', id, 'minValue.field 必须是合法字段名'));
        }
        if (!isFiniteNumber(mv.value)) {
          errors.push(issue('objective-minvalue-value', id, 'minValue.value 必须是有限数字'));
        }
        Object.keys(mv).forEach(function (key) {
          if (key !== 'field' && key !== 'value') {
            warnings.push(issue('objective-minvalue-unknown-field', id, key + ' 不是 minValue 声明字段'));
          }
        });
        var spec = eventSpec(gameId, kind);
        if (spec && typeof fieldName === 'string') {
          if (!hasOwn(spec.payload, fieldName)) {
            errors.push(issue('objective-minvalue-field-unknown', id, fieldName + ' 不在 ' + kind + ' 的 payload 中'));
          } else if (spec.payload[fieldName].type !== 'number') {
            errors.push(issue('objective-minvalue-field-type', id, fieldName + ' 不是数值字段，不能用于 minValue'));
          }
        }
        if (isFiniteNumber(mv.value) && mv.value <= 0) {
          warnings.push(issue('objective-minvalue-nonpositive', id, 'minValue.value 应大于 0'));
        }
      }
    }
    Object.keys(objective).forEach(function (key) {
      if (['kind', 'atLeast', 'context', 'minValue'].indexOf(key) < 0) {
        warnings.push(issue('objective-unknown-field', id, key + ' 不是 §19.2 声明的目标字段'));
      }
    });
  }

  function expectedTierUnlock(gameId, tier) {
    if (tier <= 1) return [];
    var out = [{ commissionCleared: gameId + '.T' + (tier - 1) }];
    var flag = CHAPTER_FLAGS[tier];
    if (flag) out.push({ chapterFlag: flag });
    return out;
  }

  function sameCondition(a, b) {
    if (!isObject(a) || !isObject(b)) return false;
    var keysA = Object.keys(a);
    var keysB = Object.keys(b);
    if (keysA.length !== 1 || keysB.length !== 1 || keysA[0] !== keysB[0]) return false;
    var key = keysA[0];
    if (key === 'all' || key === 'any') return false;
    return String(a[key]) === String(b[key]);
  }

  function validateUnlock(unlock, gameId, tier, id, errors, warnings) {
    if (!isObject(unlock)) {
      errors.push(issue('unlock-invalid', id, 'unlock 必须是条件对象'));
      return;
    }
    if (!conditionShapeOk(unlock)) {
      errors.push(issue('unlock-shape', id, 'unlock 不符合 registry §6 条件形状'));
      return;
    }
    var expected = expectedTierUnlock(gameId, tier);
    var flat = flattenConditions(unlock, [], null).map(function (entry) { return entry.condition; });
    if (expected.length === 0) {
      if (flat.length > 0) errors.push(issue('unlock-tier1-has-prereqs', id, 'T1 不应声明前置条件'));
      return;
    }
    var unmatched = expected.filter(function (want) {
      return !flat.some(function (got) { return sameCondition(got, want); });
    });
    var extra = flat.filter(function (got) {
      return !expected.some(function (want) { return sameCondition(got, want); });
    });
    unmatched.forEach(function (want) {
      errors.push(issue('unlock-missing-prereq', id, '缺少解锁条件 ' + JSON.stringify(want)));
    });
    extra.forEach(function (got) {
      warnings.push(issue('unlock-extra-prereq', id, '多出未声明的解锁条件 ' + JSON.stringify(got)));
    });
  }

  function validateCommissionEntry(commission, ctx, errors, warnings) {
    if (!isObject(commission)) {
      errors.push(issue('commission-invalid', '-', '委托条目必须是对象'));
      return;
    }
    var id = typeof commission.commissionId === 'string' ? commission.commissionId : '-';
    if (typeof commission.commissionId !== 'string' || !ID_RE.test(commission.commissionId)) {
      errors.push(issue('commission-id-invalid', id, 'commissionId 必须是稳定 ID'));
      return;
    }
    var gameId = commission.gameId;
    if (typeof gameId !== 'string' || !GAME_ID_RE.test(gameId) || !hasOwn(ctx.gameIndex, gameId)) {
      errors.push(issue('game-id-invalid', id, 'gameId 不在注册的 16 款游戏中：' + JSON.stringify(gameId)));
      return;
    }
    var tier = commission.tier;
    if (!isInt(tier) || TIERS.indexOf(tier) < 0) {
      errors.push(issue('tier-invalid', id, 'tier 必须是 1..6 的整数'));
      return;
    }
    var expectedId = gameId + '.T' + tier;
    if (commission.commissionId !== expectedId) {
      errors.push(issue('commission-id-mismatch', id, 'commissionId 必须为 "' + expectedId + '"'));
    }
    if (typeof commission.professionId !== 'string' || !hasOwn(ctx.professionIndex, commission.professionId)) {
      errors.push(issue('profession-id-invalid', id, 'professionId 不在注册职业中：' + JSON.stringify(commission.professionId)));
    }
    if (!isNonEmptyString(commission.title)) {
      errors.push(issue('title-invalid', id, 'title 必须是非空字符串'));
    } else if (commission.title.length > MAX_TITLE_LENGTH) {
      errors.push(issue('title-too-long', id, 'title 超过 ' + MAX_TITLE_LENGTH + ' 字'));
    }
    if (!isNonEmptyString(commission.summary)) {
      errors.push(issue('summary-invalid', id, 'summary 必须是非空字符串'));
    } else if (commission.summary.length > MAX_SUMMARY_LENGTH) {
      errors.push(issue('summary-too-long', id, 'summary 超过 ' + MAX_SUMMARY_LENGTH + ' 字'));
    }
    if (!isNonEmptyString(commission.issuer)) {
      errors.push(issue('issuer-invalid', id, 'issuer 必须是非空字符串'));
    }
    if (!isNonEmptyString(commission.durationHint)) {
      warnings.push(issue('duration-hint-missing', id, 'durationHint 缺失'));
    }
    if (RISK_LEVELS.indexOf(commission.risk) < 0) {
      errors.push(issue('risk-invalid', id, 'risk 必须是 low|medium|high'));
    }
    validateObjective(commission.objective, gameId, tier, ctx, id, errors, warnings);
    if (commission.objectiveBonus !== undefined) {
      if (!isInt(commission.objectiveBonus) || commission.objectiveBonus < 0) {
        errors.push(issue('objective-bonus-invalid', id, 'objectiveBonus 必须是 >=0 的整数'));
      } else if (commission.objectiveBonus > MAX_CREDITS) {
        errors.push(issue('objective-bonus-too-large', id, 'objectiveBonus 超过 ' + MAX_CREDITS));
      } else if (commission.objectiveBonus > 0) {
        warnings.push(issue('objective-bonus-nonzero', id, 'objectiveBonus 应为 0（奖励上限由 RULESET 兜底）'));
      }
    }
    validateStartParams(commission.startParams, gameId, tier, id, errors, warnings);
    validateReward(commission.reward, ctx, id, errors, warnings);
    if (!isInt(commission.repeatSalaryCredits) || commission.repeatSalaryCredits < 0 || commission.repeatSalaryCredits > MAX_SALARY) {
      errors.push(issue('repeat-salary-invalid', id, 'repeatSalaryCredits 必须是 0..' + MAX_SALARY + ' 的整数'));
    }
    validateUnlock(commission.unlock, gameId, tier, id, errors, warnings);
    validateChapterGate(commission.chapterGate, tier, id, errors, warnings);
    Object.keys(commission).forEach(function (key) {
      if ([
        'commissionId', 'gameId', 'professionId', 'tier', 'title', 'summary', 'issuer',
        'objective', 'objectiveBonus', 'startParams', 'reward', 'repeatSalaryCredits',
        'unlock', 'chapterGate', 'risk', 'durationHint',
      ].indexOf(key) < 0) {
        warnings.push(issue('unknown-field', id, key + ' 不是 §19.2 声明的委托字段'));
      }
    });
  }

  function validateStartParams(startParams, gameId, tier, id, errors, warnings) {
    var params = startParams === undefined || startParams === null ? {} : startParams;
    if (!isObject(params)) {
      errors.push(issue('startparams-invalid', id, 'startParams 必须是对象'));
      return;
    }
    if (gameId === 'star-raid') {
      if (!isInt(params.startLevel) || params.startLevel < 1 || params.startLevel > 6) {
        errors.push(issue('startparams-star-level', id, 'star-raid startLevel 必须是 1..6'));
      } else if (params.startLevel !== tier) {
        errors.push(issue('startparams-star-tier', id, 'star-raid startLevel 必须等于 tier（' + tier + '）'));
      }
      if (typeof params.themeId !== 'string' || STAR_RAID_THEMES.indexOf(params.themeId) < 0) {
        errors.push(issue('startparams-star-theme', id, 'star-raid themeId 必须是 ' + STAR_RAID_THEMES.join('|')));
      }
      Object.keys(params).forEach(function (key) {
        if (key !== 'startLevel' && key !== 'themeId') {
          warnings.push(issue('startparams-unknown-field', id, key + ' 不是 star-raid 声明的起始参数'));
        }
      });
      return;
    }
    if (Object.keys(params).length > 0) {
      warnings.push(issue('startparams-unexpected', id, gameId + ' 默认 startParams 应为 {}，游戏页不得自造起始条件'));
    }
  }

  function validateChapterGate(chapterGate, tier, id, errors, warnings) {
    var required = CHAPTER_FLAGS[tier] || null;
    if (required) {
      if (chapterGate !== required) {
        errors.push(issue('chapter-gate-mismatch', id, 'T' + tier + ' chapterGate 必须为 "' + required + '"'));
      }
      return;
    }
    if (chapterGate === undefined) {
      warnings.push(issue('chapter-gate-missing', id, 'T1–T3 建议显式写 chapterGate:null'));
      return;
    }
    if (chapterGate !== null) {
      errors.push(issue('chapter-gate-unexpected', id, 'T1–T3 不得声明 chapterGate'));
    }
  }

  /**
   * 校验 96 委托内容。
   * @param {object} content content/commissions.json
   * @param {{contentVersion?:string, gameIds?:string[], professionIds?:string[], materialIds?:string[], strictSpoilers?:boolean}} [options]
   * @returns {{ok:boolean, errors:string[], warnings:string[], counts:{games:number, tiers:number, total:number}, perGame:object}}
   */
  function validateCommissionContent(content, options) {
    var errors = [];
    var warnings = [];
    var counts = { games: 0, tiers: TIERS.length, total: 0 };
    var perGame = {};
    try {
      var ctx = makeContext(options);
      if (!isObject(content)) {
        errors.push(issue('content-invalid', '-', '内容必须是对象'));
        return { ok: false, errors: errors, warnings: warnings, counts: counts, perGame: perGame };
      }
      if (content.contentVersion !== ctx.expectedContentVersion) {
        errors.push(issue('content-version', '-', 'contentVersion 必须为 "' + ctx.expectedContentVersion + '"，实际 ' + JSON.stringify(content.contentVersion)));
      }
      if (!Array.isArray(content.commissions)) {
        errors.push(issue('content-commissions-missing', '-', 'commissions 必须是数组'));
        return { ok: false, errors: errors, warnings: warnings, counts: counts, perGame: perGame };
      }
      var list = content.commissions;
      counts.total = list.length;
      var expectedTotal = ctx.games.length * TIERS.length;
      if (list.length !== expectedTotal) {
        errors.push(issue('content-count', '-', '委托总数必须为 ' + expectedTotal + '（' + ctx.games.length + ' 游戏 × ' + TIERS.length + ' 阶），实际 ' + list.length));
      }
      var seenIds = {};
      var tiersByGame = {};
      for (var i = 0; i < list.length; i += 1) {
        var entry = list[i];
        validateCommissionEntry(entry, ctx, errors, warnings);
        if (!isObject(entry) || typeof entry.gameId !== 'string') continue;
        var id = entry.commissionId;
        if (typeof id === 'string' && id) {
          if (seenIds[id]) {
            errors.push(issue('duplicate-commission-id', id, 'commissionId 重复'));
          }
          seenIds[id] = true;
        }
        if (!tiersByGame[entry.gameId]) tiersByGame[entry.gameId] = {};
        if (isInt(entry.tier)) {
          if (tiersByGame[entry.gameId][entry.tier]) {
            errors.push(issue('duplicate-tier', id || '-', entry.gameId + ' 的 T' + entry.tier + ' 重复'));
          }
          tiersByGame[entry.gameId][entry.tier] = true;
        }
      }
      Object.keys(tiersByGame).forEach(function (gameId) {
        if (!hasOwn(ctx.gameIndex, gameId)) return;
        perGame[gameId] = TIERS.filter(function (tier) { return tiersByGame[gameId][tier] === true; });
      });
      counts.games = Object.keys(perGame).length;
      ctx.games.forEach(function (gameId) {
        if (perGame[gameId]) return;
        errors.push(issue('game-missing', gameId, '内容缺少该游戏的全部委托'));
      });
      ctx.games.forEach(function (gameId) {
        var present = perGame[gameId] || [];
        if (!perGame[gameId]) return;
        TIERS.forEach(function (tier) {
          if (present.indexOf(tier) < 0) {
            errors.push(issue('game-missing-tier', gameId, '缺少 ' + gameId + '.T' + tier));
          }
        });
      });
      /* 内容质量（T4–T6 剧透 / T1–T3 系统词）：默认告警，strictSpoilers 时升级为错误。 */
      var spoilerHits = assertNoSpoilers(content);
      var target = ctx.strictSpoilers ? errors : warnings;
      spoilerHits.forEach(function (hit) {
        target.push(issue(
          hit.tier >= 4 ? 'spoiler-term' : 'system-term',
          hit.commissionId,
          hit.field + ' 含「' + hit.term + '」：' + hit.text
        ));
      });
    } catch (err) {
      errors.push(issue('exception', '-', errorText(err)));
    }
    return { ok: errors.length === 0, errors: errors, warnings: warnings, counts: counts, perGame: perGame };
  }

  /* ------------------------------------------------------------------ *
   * validateFixtureShape：§19.8 fixture 导出形状
   * ------------------------------------------------------------------ */

  function validateFixtureShape(fixture) {
    var errors = [];
    var warnings = [];
    try {
      if (!isObject(fixture)) {
        errors.push(issue('fixture-invalid', '-', 'fixture 必须是导出对象'));
        return { ok: false, errors: errors, warnings: warnings };
      }
      var gameId = fixture.gameId;
      var subject = typeof gameId === 'string' && gameId ? gameId : '-';
      if (typeof gameId !== 'string' || !gameId) {
        errors.push(issue('fixture-gameid-missing', '-', '必须导出 gameId 字符串'));
      } else if (GAME_IDS.indexOf(gameId) < 0) {
        errors.push(issue('fixture-gameid-unknown', subject, 'gameId 不在 16 款游戏中'));
      }
      if (!isObject(fixture.tiers)) {
        errors.push(issue('fixture-tiers-missing', subject, '必须导出 tiers 对象（1..6 每阶 success/failure）'));
      } else {
        Object.keys(fixture.tiers).forEach(function (key) {
          if (TIERS.indexOf(Number(key)) < 0 || String(Number(key)) !== key) {
            errors.push(issue('fixture-tier-unknown', subject, 'T' + key + ' 不是 1..6 的阶'));
          }
        });
        TIERS.forEach(function (tier) {
          var entry = fixture.tiers[String(tier)];
          if (!isObject(entry)) {
            errors.push(issue('fixture-tier-missing', subject + '.T' + tier, '缺少该阶驱动'));
            return;
          }
          ['success', 'failure'].forEach(function (name) {
            if (typeof entry[name] !== 'function') {
              errors.push(issue('fixture-tier-handler', subject + '.T' + tier, name + ' 必须是函数'));
            }
          });
          Object.keys(entry).forEach(function (key) {
            if (key !== 'success' && key !== 'failure' && key !== 'description' && key !== 'note') {
              warnings.push(issue('fixture-tier-extra-key', subject + '.T' + tier, key + ' 不是契约字段（已忽略）'));
            }
          });
        });
      }
      if (fixture.cleanup !== undefined && typeof fixture.cleanup !== 'function') {
        errors.push(issue('fixture-cleanup', subject, 'cleanup 必须是函数'));
      }
      Object.keys(fixture).forEach(function (key) {
        if (key !== 'gameId' && key !== 'tiers' && key !== 'cleanup' && key !== 'default') {
          warnings.push(issue('fixture-extra-export', subject, key + ' 不是契约导出（已忽略）'));
        }
      });
    } catch (err) {
      errors.push(issue('exception', '-', errorText(err)));
    }
    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  /* ------------------------------------------------------------------ *
   * tierUnlockPlan：可读解锁条件（测试/文档用）
   * ------------------------------------------------------------------ */

  function describeCondition(condition) {
    if (!isObject(condition)) return null;
    if (typeof condition.commissionCleared === 'string') {
      return {
        type: 'commissionCleared',
        value: condition.commissionCleared,
        label: '完成前置工单 ' + condition.commissionCleared,
      };
    }
    if (typeof condition.chapterFlag === 'string') {
      return {
        type: 'chapterFlag',
        value: condition.chapterFlag,
        label: '需要章节旗标 ' + condition.chapterFlag,
      };
    }
    if (typeof condition.evidence === 'string') {
      return { type: 'evidence', value: condition.evidence, label: '持有证据 ' + condition.evidence };
    }
    if (typeof condition.capability === 'string') {
      return { type: 'capability', value: condition.capability, label: '具备能力 ' + condition.capability };
    }
    if (typeof condition.item === 'string') {
      return { type: 'item', value: condition.item, atLeast: Number(condition.atLeast) || 1, label: '持有材料 ' + condition.item };
    }
    if (isObject(condition.credits)) {
      return { type: 'credits', value: Number(condition.credits.atLeast) || 0, label: '信用点达到 ' + (Number(condition.credits.atLeast) || 0) };
    }
    return null;
  }

  /**
   * 把委托的 unlock/chapterGate 翻译成可读条件。
   * @param {object} commission
   * @returns {{ok:boolean, commissionId:string|null, gameId:string|null, tier:number|null, prerequisites:Array, chapterGate:string|null, text:string, errors:string[]}}
   */
  function tierUnlockPlan(commission) {
    var out = {
      ok: false,
      commissionId: null,
      gameId: null,
      tier: null,
      prerequisites: [],
      chapterGate: null,
      text: '',
      errors: [],
    };
    try {
      if (!isObject(commission)) {
        out.errors.push(issue('commission-invalid', '-', '需要委托对象'));
        return out;
      }
      out.commissionId = typeof commission.commissionId === 'string' ? commission.commissionId : null;
      out.gameId = typeof commission.gameId === 'string' ? commission.gameId : null;
      out.tier = isInt(commission.tier) ? commission.tier : null;
      out.chapterGate = typeof commission.chapterGate === 'string' ? commission.chapterGate : null;
      if (!isObject(commission.unlock)) {
        out.errors.push(issue('unlock-missing', out.commissionId, 'unlock 缺失'));
        out.text = '无法读取解锁条件';
        return out;
      }
      var flat = flattenConditions(commission.unlock, [], null);
      flat.forEach(function (entry) {
        var described = describeCondition(entry.condition);
        if (!described) {
          out.errors.push(issue('unlock-unsupported', out.commissionId, JSON.stringify(entry.condition)));
          return;
        }
        if (entry.group === 'any') described.group = 'any';
        out.prerequisites.push(described);
      });
      out.ok = out.errors.length === 0;
      out.text = out.prerequisites.length
        ? out.prerequisites.map(function (item) { return item.label; }).join(' + ')
        : '无需前置（T1）';
      return out;
    } catch (err) {
      out.errors.push(issue('exception', '-', errorText(err)));
      return out;
    }
  }

  /* ------------------------------------------------------------------ *
   * assertNoSpoilers：T4–T6 标题中性 / summary 只写玩法事实 / T1–T3 无系统词
   * ------------------------------------------------------------------ */

  /**
   * 返回命中列表；不抛异常、不修改内容。每项 {commissionId, tier, field, term, text, kind}。
   * @param {object} content
   * @returns {Array<{commissionId:string, tier:number, field:string, term:string, text:string, kind:string}>}
   */
  function assertNoSpoilers(content) {
    var hits = [];
    try {
      var list = isObject(content) && Array.isArray(content.commissions) ? content.commissions : [];
      list.forEach(function (entry) {
        if (!isObject(entry)) return;
        var tier = Number(entry.tier);
        if (!isFiniteNumber(tier)) return;
        var commissionId = typeof entry.commissionId === 'string' ? entry.commissionId : '-';
        var title = text(entry.title);
        var summary = text(entry.summary);
        if (tier >= 4) {
          SPOILER_TERMS.forEach(function (term) {
            if (containsTerm(title, term)) {
              hits.push({ commissionId: commissionId, tier: tier, field: 'title', term: term, text: title, kind: 'spoiler' });
            }
          });
          SPOILER_TERMS.concat(NARRATIVE_TERMS).forEach(function (term) {
            if (containsTerm(summary, term)) {
              hits.push({ commissionId: commissionId, tier: tier, field: 'summary', term: term, text: summary, kind: 'spoiler' });
            }
          });
        } else if (tier >= 1) {
          SYSTEM_TERMS.forEach(function (term) {
            if (containsTerm(title, term)) {
              hits.push({ commissionId: commissionId, tier: tier, field: 'title', term: term, text: title, kind: 'system-term' });
            }
            if (containsTerm(summary, term)) {
              hits.push({ commissionId: commissionId, tier: tier, field: 'summary', term: term, text: summary, kind: 'system-term' });
            }
          });
        }
      });
    } catch (err) {
      /* 巡视函数不抛异常：异常等于“没有发现”，由调用方另做完整性校验。 */
    }
    return hits;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    CONTENT_VERSION: CONTENT_VERSION,
    TIERS: TIERS,
    GAME_IDS: GAME_IDS,
    CHAPTER_FLAGS: CHAPTER_FLAGS,
    MATERIAL_IDS: MATERIAL_IDS,
    MATERIAL_ALIASES: MATERIAL_ALIASES,
    STAR_RAID_THEMES: STAR_RAID_THEMES,
    RISK_LEVELS: RISK_LEVELS,
    EVENT_CATALOG: EVENT_CATALOG,
    EVENT_KINDS: EVENT_KINDS,
    EVIDENCE_PREFIXES: EVIDENCE_PREFIXES,
    LIMITS: Object.freeze({
      maxCredits: MAX_CREDITS,
      maxSalary: MAX_SALARY,
      maxTitleLength: MAX_TITLE_LENGTH,
      maxSummaryLength: MAX_SUMMARY_LENGTH,
      itemCap: ITEM_CAP,
    }),
    isValidId: isToken,
    isKindInCatalog: isKindInCatalog,
    eventKindsFor: eventKindsFor,
    eventSpec: eventSpec,
    gamesForKind: gamesForKind,
    payloadFields: payloadFields,
    conditionShapeOk: conditionShapeOk,
    validateCommissionContent: validateCommissionContent,
    validateFixtureShape: validateFixtureShape,
    tierUnlockPlan: tierUnlockPlan,
    assertNoSpoilers: assertNoSpoilers,
    DEFAULT_PROFESSION_IDS: DEFAULT_PROFESSION_IDS,
  };
});
