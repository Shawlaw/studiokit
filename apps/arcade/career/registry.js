/*!
 * StudioKit Arcade Life — 数据驱动生涯注册表（0.15 接口冻结，B02）
 *
 * 纯函数、无 DOM、无存储副作用；浏览器挂到 window.ArcadeCareer.registry，
 * Node 中可直接 require() 用于契约测试。
 *
 * 设计约束（见 docs/arcade-life/ADR-interfaces.md）：
 * - gameId / professionId / commissionId / nodeId 均为稳定 ID；
 * - 一个游戏可关联 0..N 个职业，一个职业可关联 0..N 个游戏；
 * - 每游戏 0..N 条委托，运行时不得出现 16 / 96 / 六章等数量硬编码；
 * - 可选内容缺失或非法时忽略该条并记录警告，不让整个注册表崩溃。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory();
    return;
  }
  root.ArcadeCareer = root.ArcadeCareer || {};
  root.ArcadeCareer.registry = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  /* gameId / professionId：小写稳定 ID。commissionId / nodeId：允许章节前缀大写（如 game.T1、C2.research）。 */
  const ID_RE = /^[a-z0-9][a-z0-9._-]{1,79}$/;
  const STABLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,119}$/;
  const KIND_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
  const CONDITION_KEYS = [
    'all',
    'any',
    'capability',
    'evidence',
    'chapterFlag',
    'commissionCleared',
    'item',
    'credits',
  ];

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isId(value) {
    return typeof value === 'string' && ID_RE.test(value);
  }

  function isStableId(value) {
    return typeof value === 'string' && STABLE_ID_RE.test(value);
  }

  function isToken(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 120;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item) : [];
  }

  function asSet(value) {
    if (value instanceof Set) return value;
    if (Array.isArray(value)) return new Set(value);
    return new Set();
  }

  function itemCount(items, itemId) {
    if (!items) return 0;
    if (items instanceof Map) return Number(items.get(itemId)) || 0;
    if (typeof items.get === 'function') return Number(items.get(itemId)) || 0;
    if (isObject(items)) return Number(items[itemId]) || 0;
    return 0;
  }

  /**
   * 纯谓词：判断上下文是否满足条件（不可变 JSON）。
   * @param {object|null} condition
   * @param {{capabilities?:Set|string[],evidence?:Set|string[],flags?:Set|string[],cleared?:Set|string[],items?:Map|object,credits?:number}} ctx
   * @returns {boolean}
   */
  function conditionMatches(condition, ctx) {
    if (!condShapeOk(condition)) return false;
    const c = ctx || {};
    if (Array.isArray(condition.all)) {
      return condition.all.every((child) => conditionMatches(child, c));
    }
    if (Array.isArray(condition.any)) {
      return condition.any.length > 0 && condition.any.some((child) => conditionMatches(child, c));
    }
    if (typeof condition.capability === 'string') {
      return asSet(c.capabilities).has(condition.capability);
    }
    if (typeof condition.evidence === 'string') {
      return asSet(c.evidence).has(condition.evidence);
    }
    if (typeof condition.chapterFlag === 'string') {
      return asSet(c.flags).has(condition.chapterFlag);
    }
    if (typeof condition.commissionCleared === 'string') {
      return asSet(c.cleared).has(condition.commissionCleared);
    }
    if (typeof condition.item === 'string') {
      const need = Number(condition.atLeast);
      return itemCount(c.items, condition.item) >= (Number.isFinite(need) && need > 0 ? need : 1);
    }
    if (isObject(condition.credits)) {
      const need = Number(condition.credits.atLeast);
      return Number(c.credits) >= (Number.isFinite(need) ? need : 0);
    }
    return false;
  }

  let condCheckDepth = 0;
  function condShapeOk(condition) {
    if (!isObject(condition)) return false;
    if (condCheckDepth > 24) return false;
    const keys = Object.keys(condition);
    if (!keys.length) return false;
    /* atLeast 只作为 item / credits 的伴随字段出现，作为通用允许键处理。 */
    const known = keys.every((key) => CONDITION_KEYS.indexOf(key) >= 0 || key === 'atLeast');
    if (!known) return false;
    condCheckDepth += 1;
    try {
      if (condition.all !== undefined) {
        return Array.isArray(condition.all) && condition.all.every(condShapeOk);
      }
      if (condition.any !== undefined) {
        return Array.isArray(condition.any) && condition.any.every(condShapeOk);
      }
      if (condition.capability !== undefined) return isToken(condition.capability);
      if (condition.evidence !== undefined) return isToken(condition.evidence);
      if (condition.chapterFlag !== undefined) return isToken(condition.chapterFlag);
      if (condition.commissionCleared !== undefined) return isStableId(condition.commissionCleared);
      if (condition.item !== undefined) {
        const need = Number(condition.atLeast);
        return isToken(condition.item) && (!Number.isFinite(need) || need > 0);
      }
      if (condition.credits !== undefined) {
        if (!isObject(condition.credits)) return false;
        const need = Number(condition.credits.atLeast);
        return Number.isFinite(need) && need >= 0;
      }
      return false;
    } finally {
      condCheckDepth -= 1;
    }
  }

  function sanitizeWatch(raw, warn) {
    if (!Array.isArray(raw)) return [];
    const seen = Object.create(null);
    const out = [];
    raw.forEach((entry) => {
      if (!isObject(entry) || typeof entry.kind !== 'string' || !KIND_RE.test(entry.kind)) {
        warn('watch.kind 非法，已忽略');
        return;
      }
      if (seen[entry.kind]) return;
      seen[entry.kind] = true;
      const record = { kind: entry.kind };
      if (isObject(entry.payload)) {
        const payload = {};
        Object.keys(entry.payload).forEach((field) => {
          const type = entry.payload[field];
          if (typeof type === 'string' && field) payload[field] = type;
        });
        if (Object.keys(payload).length) record.payload = payload;
      }
      if (Array.isArray(entry.modes)) record.modes = stringArray(entry.modes);
      out.push(record);
    });
    return out;
  }

  function sanitizeGame(raw, warn) {
    if (!isObject(raw)) {
      warn('game 记录非法，已忽略');
      return null;
    }
    if (!isId(raw.gameId)) {
      warn('gameId 非法，已忽略：' + JSON.stringify(raw.gameId));
      return null;
    }
    const game = {
      gameId: raw.gameId,
      displayName: typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : raw.gameId,
      adapterVersion: Number.isFinite(Number(raw.adapterVersion)) ? Number(raw.adapterVersion) : 1,
      discoverable: raw.discoverable === true,
      clueRef: typeof raw.clueRef === 'string' && raw.clueRef ? raw.clueRef : null,
      professions: stringArray(raw.professions),
      capabilities: stringArray(raw.capabilities),
      watch: sanitizeWatch(raw.watch, warn),
    };
    return game;
  }

  function sanitizeProfession(raw, warn) {
    if (!isObject(raw) || !isId(raw.professionId)) {
      warn('professionId 非法，已忽略：' + JSON.stringify(raw && raw.professionId));
      return null;
    }
    return {
      professionId: raw.professionId,
      displayName: typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : raw.professionId,
      domain: typeof raw.domain === 'string' ? raw.domain : '',
      capabilities: stringArray(raw.capabilities),
    };
  }

  /**
   * 委托目标 context 判定（冻结语义）：
   * - 字段名对应事件 payload 字段；
   * - 原始值严格相等；{gte}/{lte} 为数值区间（含端点）；
   * - payload 缺少字段 → 不匹配；多余字段忽略。
   */
  function matchContext(context, payload) {
    if (!isObject(context)) return true;
    const p = isObject(payload) ? payload : {};
    const fields = Object.keys(context);
    for (let i = 0; i < fields.length; i += 1) {
      const field = fields[i];
      const expected = context[field];
      const actual = p[field];
      if (actual === undefined) return false;
      if (isObject(expected)) {
        const gte = Number(expected.gte);
        const lte = Number(expected.lte);
        if (!Number.isFinite(gte) && !Number.isFinite(lte)) return false;
        const n = Number(actual);
        if (!Number.isFinite(n)) return false;
        if (Number.isFinite(gte) && n < gte) return false;
        if (Number.isFinite(lte) && n > lte) return false;
      } else if (expected !== actual) {
        return false;
      }
    }
    return true;
  }

  function sanitizeContext(raw, warn) {
    if (!isObject(raw)) return {};
    const out = {};
    Object.keys(raw).forEach((field) => {
      if (!field) return;
      const value = raw[field];
      if (isObject(value)) {
        const gte = Number(value.gte);
        const lte = Number(value.lte);
        const hasGte = Number.isFinite(gte);
        const hasLte = Number.isFinite(lte);
        if (!hasGte && !hasLte) {
          warn('objective.context.' + field + ' 必须是原始值或 {gte,lte}，已忽略');
          return;
        }
        if (hasGte && hasLte && gte > lte) {
          warn('objective.context.' + field + ' 的 gte > lte，已忽略');
          return;
        }
        const range = {};
        if (hasGte) range.gte = gte;
        if (hasLte) range.lte = lte;
        out[field] = range;
        return;
      }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        out[field] = value;
        return;
      }
      warn('objective.context.' + field + ' 类型不受支持，已忽略');
    });
    return out;
  }

  function sanitizeObjective(raw, warn) {
    if (!isObject(raw)) return null;
    if (typeof raw.kind !== 'string' || !KIND_RE.test(raw.kind)) return null;
    const atLeast = Number(raw.atLeast);
    return {
      kind: raw.kind,
      atLeast: Number.isFinite(atLeast) && atLeast > 0 ? Math.floor(atLeast) : 1,
      context: sanitizeContext(raw.context, warn),
    };
  }

  function sanitizeReward(raw) {
    if (!isObject(raw)) return { credits: 0, items: {}, evidence: [], flags: [] };
    const credits = Number(raw.credits);
    const items = {};
    if (isObject(raw.items)) {
      Object.keys(raw.items).forEach((itemId) => {
        const count = Number(raw.items[itemId]);
        if (itemId && Number.isFinite(count) && count > 0) items[itemId] = Math.floor(count);
      });
    }
    return {
      credits: Number.isFinite(credits) && credits > 0 ? Math.floor(credits) : 0,
      items,
      evidence: stringArray(raw.evidence),
      flags: stringArray(raw.flags),
    };
  }

  function sanitizeCommission(raw, gameIds, professionIds, warn) {
    if (!isObject(raw) || !isStableId(raw.commissionId)) {
      warn('commissionId 非法，已忽略：' + JSON.stringify(raw && raw.commissionId));
      return null;
    }
    if (!gameIds[raw.gameId]) {
      warn('commission ' + raw.commissionId + ' 引用了未注册 gameId，已忽略');
      return null;
    }
    if (!professionIds[raw.professionId]) {
      warn('commission ' + raw.commissionId + ' 引用了未注册 professionId，已忽略');
      return null;
    }
    const objective = sanitizeObjective(raw.objective, warn);
    if (!objective) {
      warn('commission ' + raw.commissionId + ' 的 objective 非法，已忽略');
      return null;
    }
    const tier = Number(raw.tier);
    return {
      commissionId: raw.commissionId,
      gameId: raw.gameId,
      professionId: raw.professionId,
      tier: Number.isFinite(tier) && tier > 0 ? Math.floor(tier) : 1,
      tierUnlock: typeof raw.tierUnlock === 'string' && raw.tierUnlock ? raw.tierUnlock : 'RESIDENT',
      objective: objective,
      reward: sanitizeReward(raw.reward),
      repeatSalaryCredits: Math.max(0, Math.floor(Number(raw.repeatSalaryCredits) || 0)),
      handoff: isObject(raw.handoff) ? raw.handoff : {},
      failure: isObject(raw.failure) ? raw.failure : {},
      minValidEngagement: Math.max(0, Number(raw.minValidEngagement) || 0),
    };
  }

  function sanitizeNode(raw, warn) {
    if (!isObject(raw) || !isStableId(raw.nodeId)) {
      warn('story nodeId 非法，已忽略');
      return null;
    }
    if (raw.requires !== undefined && !condShapeOk(raw.requires)) {
      warn('story node ' + raw.nodeId + ' 的 requires 非法，已忽略');
      return null;
    }
    const grants = isObject(raw.grants) ? raw.grants : {};
    return {
      nodeId: raw.nodeId,
      chapter: typeof raw.chapter === 'string' ? raw.chapter : '',
      requires: raw.requires === undefined ? { all: [] } : raw.requires,
      grants: {
        flags: stringArray(grants.flags),
        evidence: stringArray(grants.evidence),
        capabilities: stringArray(grants.capabilities),
      },
    };
  }

  function sanitizeEdges(raw, nodeIds, warn) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    raw.forEach((edge) => {
      if (!isObject(edge) || !nodeIds[edge.from] || !nodeIds[edge.to]) {
        warn('story edge 引用未注册节点，已忽略');
        return;
      }
      out.push({ from: edge.from, to: edge.to });
    });
    return out;
  }

  /**
   * 构造注册表实例。输入缺失/非法不会抛出，只会记录 errors / warnings。
   * @param {object|null} bundle content/registry.json
   */
  function createRegistry(bundle) {
    const errors = [];
    const warnings = [];
    const warn = (message) => warnings.push(message);
    const fail = (message) => errors.push(message);

    const source = isObject(bundle) ? bundle : {};
    if (source.schemaVersion !== undefined && Number(source.schemaVersion) !== SCHEMA_VERSION) {
      fail('registry schemaVersion 不受支持：' + JSON.stringify(source.schemaVersion));
    }

    const games = [];
    const gameIds = Object.create(null);
    (Array.isArray(source.games) ? source.games : []).forEach((raw) => {
      const clean = sanitizeGame(raw, warn);
      if (!clean) return;
      if (gameIds[clean.gameId]) {
        fail('重复 gameId：' + clean.gameId + '（保留第一条）');
        return;
      }
      gameIds[clean.gameId] = clean;
      games.push(clean);
    });

    const professions = [];
    const professionIds = Object.create(null);
    (Array.isArray(source.professions) ? source.professions : []).forEach((raw) => {
      const clean = sanitizeProfession(raw, warn);
      if (!clean) return;
      if (professionIds[clean.professionId]) {
        fail('重复 professionId：' + clean.professionId + '（保留第一条）');
        return;
      }
      professionIds[clean.professionId] = clean;
      professions.push(clean);
    });

    /* 多对多引用在集合齐全后过滤：未知职业引用只告警，不阻塞注册。 */
    const seenClueRefs = Object.create(null);
    games.forEach((game) => {
      const known = [];
      game.professions.forEach((professionId) => {
        if (!professionIds[professionId]) {
          warn('game ' + game.gameId + ' 引用了未注册 professionId：' + professionId);
          return;
        }
        if (known.indexOf(professionId) < 0) known.push(professionId);
      });
      game.professions = known;
      if (game.clueRef !== null && game.discoverable) {
        if (seenClueRefs[game.clueRef]) {
          warn('重复 clueRef：' + game.clueRef + '（保留第一条，' + game.gameId + ' 的引用已置空）');
          game.clueRef = null;
        } else {
          seenClueRefs[game.clueRef] = true;
        }
      }
      if (game.clueRef === null && game.discoverable) {
        warn('game ' + game.gameId + ' 声明 discoverable 但缺少可用 clueRef');
      }
    });

    const commissions = [];
    const commissionIds = Object.create(null);
    (Array.isArray(source.commissions) ? source.commissions : []).forEach((raw) => {
      const clean = sanitizeCommission(raw, gameIds, professionIds, warn);
      if (!clean) return;
      if (commissionIds[clean.commissionId]) {
        fail('重复 commissionId：' + clean.commissionId + '（保留第一条）');
        return;
      }
      commissionIds[clean.commissionId] = clean;
      commissions.push(clean);
    });

    const storySource = isObject(source.story) ? source.story : {};
    const nodes = [];
    const nodeIds = Object.create(null);
    (Array.isArray(storySource.nodes) ? storySource.nodes : []).forEach((raw) => {
      const clean = sanitizeNode(raw, warn);
      if (!clean) return;
      if (nodeIds[clean.nodeId]) {
        fail('重复 story nodeId：' + clean.nodeId + '（保留第一条）');
        return;
      }
      nodeIds[clean.nodeId] = clean;
      nodes.push(clean);
    });
    const edges = sanitizeEdges(storySource.edges, nodeIds, warn);

    const byGame = Object.create(null);
    const byProfession = Object.create(null);
    commissions.forEach((commission) => {
      (byGame[commission.gameId] = byGame[commission.gameId] || []).push(commission);
      (byProfession[commission.professionId] = byProfession[commission.professionId] || []).push(commission);
    });
    games.forEach((game) => {
      if (game.discoverable && game.clueRef && game.watch.length === 0) {
        warn('game ' + game.gameId + ' 声明 discoverable 但没有 watch 事件');
      }
    });

    const gameList = games.slice();
    const professionList = professions.slice();
    const commissionList = commissions.slice();
    const nodeList = nodes.slice();

    const registry = {
      schemaVersion: SCHEMA_VERSION,
      contentVersion: typeof source.contentVersion === 'string' ? source.contentVersion : '',
      errors: errors.slice(),
      warnings: warnings.slice(),

      listGames() {
        return gameList.map(clone);
      },
      getGame(gameId) {
        const game = gameIds[gameId];
        return game ? clone(game) : null;
      },
      listProfessions() {
        return professionList.map(clone);
      },
      getProfession(professionId) {
        const profession = professionIds[professionId];
        return profession ? clone(profession) : null;
      },
      /**
       * @param {{gameId?:string, professionId?:string, tier?:number}} [filter]
       * 单一过滤返回对应集合；同时给 gameId + professionId 时返回交集。
       */
      listCommissions(filter) {
        const opts = isObject(filter) ? filter : {};
        let list = commissionList;
        if (typeof opts.gameId === 'string' && opts.gameId) {
          list = (byGame[opts.gameId] || []).slice();
        }
        if (typeof opts.professionId === 'string' && opts.professionId) {
          const set = {};
          (byProfession[opts.professionId] || []).forEach((commission) => {
            set[commission.commissionId] = true;
          });
          list = list.filter((commission) => set[commission.commissionId]);
        }
        if (Number.isFinite(Number(opts.tier))) {
          const tier = Math.floor(Number(opts.tier));
          list = list.filter((commission) => commission.tier === tier);
        }
        return list.map(clone);
      },
      getCommission(commissionId) {
        const commission = commissionList.filter((item) => item.commissionId === commissionId)[0];
        return commission ? clone(commission) : null;
      },
      listStoryNodes(chapter) {
        const list = typeof chapter === 'string' && chapter ? nodeList.filter((node) => node.chapter === chapter) : nodeList;
        return list.map(clone);
      },
      getStoryNode(nodeId) {
        const node = nodeList.filter((item) => item.nodeId === nodeId)[0];
        return node ? clone(node) : null;
      },
      listStoryEdges() {
        return edges.map(clone);
      },
      matchContext(context, payload) {
        return matchContext(context, payload);
      },
      resolveStory(condition, ctx) {
        return conditionMatches(condition, ctx || {});
      },
      /* 返回当前上下文可满足的节点（用于剧情可达性图检查）。 */
      satisfiedStoryNodes(ctx) {
        return nodeList.filter((node) => conditionMatches(node.requires, ctx || {})).map(clone);
      },
    };
    return registry;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    createRegistry: createRegistry,
    conditionMatches: conditionMatches,
    matchContext: matchContext,
  };
});
