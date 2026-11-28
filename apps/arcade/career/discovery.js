/*!
 * StudioKit Arcade Life — 发现状态机（0.15，D15-01）
 *
 * 纯函数、无 DOM、无存储副作用；浏览器挂到 window.ArcadeCareer.discovery，
 * Node 中可直接 require() 用于确定性测试。
 *
 * 约束（docs/arcade-life/ADR-interfaces.md）：
 * - DORMANT → GLIMPSED → CURIOUS → LOCAL → RESIDENT → EXPLORER 单调前进；
 * - 关闭线索提示只影响显示/产出，不影响已发现线索与生涯资产；
 * - 每局最多 1 条线索；经典/挑战/禅计为有效局，割草不计；
 * - 线索不产生任何货币/物品副作用；钱包只在 RESIDENT 之后由其他模块创建。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory(root);
    return;
  }
  root.ArcadeCareer = root.ArcadeCareer || {};
  root.ArcadeCareer.discovery = factory(root);
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var nodeProfessionState = null;
  if (typeof module === 'object' && module && module.exports) {
    nodeProfessionState = require('./profession-state.js');
  }

  function professionStateModule() {
    return nodeProfessionState || (root && root.ArcadeCareer && root.ArcadeCareer.professionState) || null;
  }

  const SCHEMA_VERSION = 1;
  const STATE_STORE_KEY = 'discovery';
  const STAGES = ['DORMANT', 'GLIMPSED', 'CURIOUS', 'LOCAL', 'RESIDENT', 'EXPLORER'];
  const STAGE_RANK = STAGES.reduce((map, stage, index) => {
    map[stage] = index;
    return map;
  }, Object.create(null));
  const VALID_MODES = ['classic', 'challenge', 'zen'];
  const VALID_FAMILIES = ['industrial', 'signal', 'record', 'bio', 'route'];
  const CLUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,119}$/;
  const GAME_ID_RE = /^[a-z0-9][a-z0-9._-]{1,79}$/;
  const KIND_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function rank(stage) {
    return STAGE_RANK[stage] === undefined ? 0 : STAGE_RANK[stage];
  }

  function newerStage(a, b) {
    return rank(a) >= rank(b) ? a : b;
  }

  function mergeProfessionExtension(state, raw, now) {
    const professionState = professionStateModule();
    if (!professionState || typeof professionState.mergeIntoDiscovery !== 'function') return state;
    const extension = typeof professionState.extensionOf === 'function' ? professionState.extensionOf(raw) : null;
    const merged = professionState.mergeIntoDiscovery(state, raw, now);
    /* T01 的 merge 对未来版本保守返回 base；读取路径仍须原样保留未知扩展，
       不降级、不猜测。写回与 gate 由 DB / profession-view 另行拒绝。 */
    if (extension && Number(extension.professionVersion) > Number(professionState.PROFESSION_VERSION)) {
      Object.keys(extension).forEach(function (key) {
        merged[key] = extension[key];
      });
    }
    return merged;
  }

  /** 空状态。hintsEnabled 默认 true（不显眼、可关闭）。 */
  function initialState(now) {
    const at = typeof now === 'string' ? now : new Date().toISOString();
    const start = {
      schemaVersion: SCHEMA_VERSION,
      stage: 'DORMANT',
      firstSourceGame: null,
      firstClueId: null,
      hintsEnabled: true,
      portSeenAt: null,
      careerSignedAt: null,
      explorerAt: null,
      updatedAt: at,
      clues: {},
      runs: {},
    };
    return mergeProfessionExtension(start, null, at);
  }

  /** 修复/兼容持久化快照：未知字段忽略，坏字段回落默认，不抛异常。 */
  function normalizeState(raw, now) {
    const start = initialState(now);
    if (!isObject(raw)) return start;
    const out = start;
    out.stage = STAGES.indexOf(raw.stage) >= 0 ? raw.stage : 'DORMANT';
    out.firstSourceGame = typeof raw.firstSourceGame === 'string' && GAME_ID_RE.test(raw.firstSourceGame) ? raw.firstSourceGame : null;
    out.firstClueId = typeof raw.firstClueId === 'string' && CLUE_ID_RE.test(raw.firstClueId) ? raw.firstClueId : null;
    out.hintsEnabled = raw.hintsEnabled !== false;
    out.portSeenAt = typeof raw.portSeenAt === 'string' ? raw.portSeenAt : null;
    out.careerSignedAt = typeof raw.careerSignedAt === 'string' ? raw.careerSignedAt : null;
    out.explorerAt = typeof raw.explorerAt === 'string' ? raw.explorerAt : null;
    out.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : start.updatedAt;
    if (isObject(raw.clues)) {
      Object.keys(raw.clues).forEach((clueId) => {
        const record = raw.clues[clueId];
        if (!isObject(record) || !CLUE_ID_RE.test(clueId)) return;
        if (typeof record.sourceGame !== 'string' || !GAME_ID_RE.test(record.sourceGame)) return;
        out.clues[clueId] = {
          clueId,
          sourceGame: record.sourceGame,
          firstSeenRunId: typeof record.firstSeenRunId === 'string' ? record.firstSeenRunId : null,
          seenAt: typeof record.seenAt === 'string' ? record.seenAt : null,
          openedAt: typeof record.openedAt === 'string' ? record.openedAt : null,
          dismissed: record.dismissed === true,
        };
      });
    }
    if (isObject(raw.runs)) {
      Object.keys(raw.runs).forEach((gameId) => {
        const record = raw.runs[gameId];
        if (!isObject(record) || !GAME_ID_RE.test(gameId)) return;
        const eligible = Number(record.eligibleRuns);
        out.runs[gameId] = {
          eligibleRuns: Number.isFinite(eligible) && eligible > 0 ? Math.floor(eligible) : 0,
          lastRunId: typeof record.lastRunId === 'string' ? record.lastRunId : null,
          lastRunAt: typeof record.lastRunAt === 'string' ? record.lastRunAt : null,
        };
      });
    }
    /* stage 与证据一致性修复：有已发现线索但不小于 GLIMPSED。 */
    if (Object.keys(out.clues).length > 0 && rank(out.stage) < rank('GLIMPSED')) out.stage = 'GLIMPSED';
    if (out.portSeenAt && rank(out.stage) < rank('LOCAL')) out.stage = 'LOCAL';
    if (out.careerSignedAt && rank(out.stage) < rank('RESIDENT')) out.stage = 'RESIDENT';
    if (out.firstSourceGame === null) {
      const first = Object.keys(out.clues)[0];
      if (first) out.firstSourceGame = out.clues[first].sourceGame;
    }
    return mergeProfessionExtension(out, raw, now);
  }

  function catalogOf(deps) {
    return deps && typeof deps.catalog === 'object' && deps.catalog ? deps.catalog : null;
  }

  /** 职业 ID 只来自 registry 的 game.professions；线索可显式缩窄到单一职业。 */
  function professionIdsFor(gameId, clue, catalog) {
    if (!catalog || !Array.isArray(catalog.games) || !Array.isArray(catalog.professions)) return [];
    const game = catalog.games.find(function (row) {
      return row && row.gameId === gameId;
    });
    if (!game || !Array.isArray(game.professions)) return [];
    const known = Object.create(null);
    catalog.professions.forEach(function (row) {
      if (row && typeof row.professionId === 'string') known[row.professionId] = true;
    });
    const mapped = clue && typeof clue.professionId === 'string' && clue.professionId
      ? [clue.professionId]
      : game.professions;
    return mapped.filter(function (professionId, index, list) {
      return typeof professionId === 'string' && known[professionId] && list.indexOf(professionId) === index;
    });
  }

  /**
   * 真实发现/读信事件驱动纯 reducer。任一映射失败则本批职业事件全部不采用，
   * 但既有 discovery 事实仍保留；错误由结构化 professionError 返回，不猜测。
   */
  function applyProfessionEvents(state, action, input, catalog) {
    const professionState = professionStateModule();
    if (!professionState) return { state: state, professionEvents: [], professionError: 'profession-state-unavailable' };
    if (!catalog) return { state: state, professionEvents: [], professionError: 'missing-catalog' };
    const ids = professionIdsFor(input.gameId, input.clue, catalog);
    if (!ids.length) return { state: state, professionEvents: [], professionError: 'profession-game-mismatch' };
    const reducer = action === 'READ' ? professionState.recordRead : professionState.recordGlimpsed;
    if (typeof reducer !== 'function') return { state: state, professionEvents: [], professionError: 'profession-state-unavailable' };
    let candidate = state;
    const events = [];
    for (let i = 0; i < ids.length; i += 1) {
      const event = {
        action: action,
        input: Object.assign({}, input, { professionId: ids[i], catalog: catalog }),
      };
      const result = reducer(candidate, event.input);
      if (!result || result.ok !== true) {
        return { state: state, professionEvents: [], professionError: (result && result.reason) || 'profession-event-failed' };
      }
      candidate = result.state;
      events.push(event);
    }
    return { state: candidate, professionEvents: events, professionError: null };
  }

  /** 线索内容包校验；单个坏线索被忽略并记录错误，不影响其余线索。 */
  function normalizeClueBundle(raw) {
    const errors = [];
    const warnings = [];
    const out = { schemaVersion: SCHEMA_VERSION, contentVersion: '', clues: [], errors, warnings };
    if (!isObject(raw)) {
      errors.push('线索内容不是对象');
      return out;
    }
    if (Number(raw.schemaVersion) !== SCHEMA_VERSION) {
      errors.push('线索内容 schemaVersion 不受支持：' + JSON.stringify(raw.schemaVersion));
    }
    out.contentVersion = typeof raw.contentVersion === 'string' ? raw.contentVersion : '';
    const seen = Object.create(null);
    const list = Array.isArray(raw.clues) ? raw.clues : [];
    list.forEach((entry, index) => {
      const where = 'clues[' + index + ']';
      if (!isObject(entry)) {
        errors.push(where + ' 不是对象');
        return;
      }
      if (typeof entry.clueId !== 'string' || !CLUE_ID_RE.test(entry.clueId)) {
        errors.push(where + '.clueId 非法');
        return;
      }
      if (seen[entry.clueId]) {
        errors.push('重复 clueId：' + entry.clueId);
        return;
      }
      if (typeof entry.gameId !== 'string' || !GAME_ID_RE.test(entry.gameId)) {
        errors.push(where + '.gameId 非法');
        return;
      }
      if (typeof entry.trigger !== 'object' || !isObject(entry.trigger) || typeof entry.trigger.kind !== 'string' || !KIND_RE.test(entry.trigger.kind)) {
        errors.push(where + '.trigger.kind 非法');
        return;
      }
      const atLeast = Number(entry.trigger.atLeast);
      if (!Number.isFinite(atLeast) || atLeast <= 0) {
        errors.push(where + '.trigger.atLeast 必须是正数');
        return;
      }
      const maxRuns = Number(entry.guarantee && entry.guarantee.maxEligibleRuns);
      if (!Number.isFinite(maxRuns) || maxRuns < 1 || maxRuns > 5) {
        errors.push(where + '.guarantee.maxEligibleRuns 必须在 1..5');
        return;
      }
      if (maxRuns > 3) warnings.push(where + ' 保底局数大于 3，可能不符合首季体验要求');
      if (entry.family !== undefined && VALID_FAMILIES.indexOf(entry.family) < 0) {
        warnings.push(where + ' 的 family 不在首季枚举内：' + JSON.stringify(entry.family));
      }
      const clue = {
        clueId: entry.clueId,
        gameId: entry.gameId,
        family: typeof entry.family === 'string' ? entry.family : '',
        title: typeof entry.title === 'string' ? entry.title : '',
        ambientLabel: typeof entry.ambientLabel === 'string' ? entry.ambientLabel : '',
        ambientText: typeof entry.ambientText === 'string' ? entry.ambientText : '',
        trigger: { kind: entry.trigger.kind, atLeast: Math.floor(atLeast) },
        guarantee: { maxEligibleRuns: Math.floor(maxRuns) },
        letter: isObject(entry.letter) ? entry.letter : {},
        next: isObject(entry.next) ? entry.next : { kind: 'letter' },
      };
      seen[clue.clueId] = true;
      out.clues.push(clue);
    });
    return out;
  }

  function clueConfigFor(gameId, clueConfigs) {
    return (Array.isArray(clueConfigs) ? clueConfigs : []).filter((clue) => clue.gameId === gameId);
  }

  /** 累计事件计数（同一 kind 多次出现累加）；也接受 [{kind}] 数组。 */
  function eventCounts(events) {
    const counts = Object.create(null);
    if (Array.isArray(events)) {
      events.forEach((event) => {
        if (!event) return;
        const kind = typeof event === 'string' ? event : event.kind;
        if (typeof kind === 'string' && kind) counts[kind] = (counts[kind] || 0) + 1;
      });
    } else if (isObject(events)) {
      Object.keys(events).forEach((kind) => {
        const count = Number(events[kind]);
        if (Number.isFinite(count) && count > 0) counts[kind] = (counts[kind] || 0) + Math.floor(count);
      });
    }
    return counts;
  }

  function isEligibleRun(run) {
    if (!isObject(run)) return false;
    if (run.eligible === false) return false;
    return VALID_MODES.indexOf(run.mode) >= 0;
  }

  /**
   * 纯判定：本次有效局是否会产出线索。
   * @param {{state:object, clueConfigs:Array, runSummary:object, hintsEnabled?:boolean, now?:string}} ctx
   * @returns {null|{clueId:string, reason:'event'|'guarantee', clue:object, nextState:object, discovery:object}}
   */
  function evaluateRun(ctx) {
    const input = isObject(ctx) ? ctx : {};
    const state = normalizeState(input.state, input.now);
    const run = isObject(input.runSummary) ? input.runSummary : null;
    if (!run || !isEligibleRun(run)) return null;
    const hintsEnabled = input.hintsEnabled === undefined ? state.hintsEnabled !== false : input.hintsEnabled !== false;
    /* 先累计有效局数（即使提示关闭也计数，保证重新开启后不会“惩罚”用户）。 */
    const gameId = run.gameId;
    const baseRuns = state.runs[gameId] || { eligibleRuns: 0, lastRunId: null, lastRunAt: null };
    const eligibleRuns = baseRuns.eligibleRuns + 1;
    let nextState = clone(state);
    nextState.runs[gameId] = {
      eligibleRuns,
      lastRunId: typeof run.runId === 'string' ? run.runId : baseRuns.lastRunId,
      lastRunAt: typeof input.now === 'string' ? input.now : new Date().toISOString(),
    };
    nextState.updatedAt = nextState.runs[gameId].lastRunAt;
    if (!hintsEnabled) return null;

    const counts = eventCounts(run.events);
    const candidates = clueConfigFor(gameId, input.clueConfigs).filter((clue) => !state.clues[clue.clueId]);
    let found = null;
    /* 优先命中真实事件线索（内容顺序），再走保底。 */
    for (let i = 0; i < candidates.length; i += 1) {
      const clue = candidates[i];
      const observed = counts[clue.trigger.kind] || 0;
      if (observed >= clue.trigger.atLeast) {
        found = { clue, reason: 'event' };
        break;
      }
    }
    if (!found) {
      for (let i = 0; i < candidates.length; i += 1) {
        const clue = candidates[i];
        if (eligibleRuns >= clue.guarantee.maxEligibleRuns) {
          found = { clue, reason: 'guarantee' };
          break;
        }
      }
    }
    if (!found) return null;

    const clue = found.clue;
    const discovery = {
      clueId: clue.clueId,
      sourceGame: gameId,
      firstSeenRunId: typeof run.runId === 'string' ? run.runId : null,
      seenAt: nextState.updatedAt,
      openedAt: null,
      dismissed: false,
    };
    nextState.clues[clue.clueId] = discovery;
    nextState.lastClueId = clue.clueId;
    if (!nextState.firstClueId) nextState.firstClueId = clue.clueId;
    if (!nextState.firstSourceGame) nextState.firstSourceGame = gameId;
    nextState.stage = newerStage(nextState.stage, 'GLIMPSED');
    const profession = applyProfessionEvents(nextState, 'GLIMPSED', {
      professionId: null,
      gameId: gameId,
      clueId: clue.clueId,
      clue: clue,
      at: nextState.updatedAt,
    }, catalogOf(input));
    nextState = profession.state;
    return {
      clueId: clue.clueId,
      reason: found.reason,
      clue,
      nextState,
      discovery,
      professionEvent: profession.professionEvents[0] || null,
      professionEvents: profession.professionEvents,
      professionError: profession.professionError,
    };
  }

  /**
   * 状态迁移（纯函数）。返回 { state, clue? , transition? }。
   * action.type: RUN_ENDED | CLUE_OPENED | LETTER_FOLLOWED | CONTRACT_SIGNED | FIRST_RUN_COMPLETED | SET_HINTS
   */
  function reduce(state, action, deps) {
    const now = action && typeof action.at === 'string' ? action.at : new Date().toISOString();
    const base = normalizeState(state, now);
    const act = isObject(action) ? action : {};
    const clueConfigs = deps && Array.isArray(deps.clueConfigs) ? deps.clueConfigs : [];
    switch (act.type) {
      case 'RUN_ENDED': {
        const result = evaluateRun({
          state: base,
          clueConfigs,
          runSummary: act.run,
          hintsEnabled: base.hintsEnabled,
          catalog: catalogOf(deps),
          now,
        });
        if (!result) {
          /* 即使无线索，也要把有效局计数写回。 */
          const incremented = incrementRuns(base, act.run, now);
          return { state: incremented, clue: null, transition: { from: base.stage, to: incremented.stage } };
        }
        return {
          state: result.nextState,
          clue: { clueId: result.clueId, reason: result.reason, clue: result.clue, discovery: result.discovery },
          transition: { from: base.stage, to: result.nextState.stage },
          professionEvent: result.professionEvent,
          professionEvents: result.professionEvents,
          professionError: result.professionError,
        };
      }
      case 'CLUE_OPENED': {
        const clueId = typeof act.clueId === 'string' ? act.clueId : '';
        const record = base.clues[clueId];
        if (!record) {
          return { state: base, transition: null, invalid: 'unknown-clue' };
        }
        let next = clone(base);
        next.clues[clueId].openedAt = next.clues[clueId].openedAt || now;
        next.stage = newerStage(next.stage, 'CURIOUS');
        next.updatedAt = now;
        const clueConfig = clueConfigs.find(function (candidate) {
          return candidate && candidate.clueId === clueId;
        }) || null;
        const catalog = catalogOf(deps);
        const catalogClue = catalog && Array.isArray(catalog.clues)
          ? catalog.clues.find(function (candidate) { return candidate && candidate.clueId === clueId; }) || null
          : null;
        const contentClue = clueConfig || catalogClue;
        const sourceGame = record.sourceGame;
        let profession = { state: next, professionEvents: [], professionError: null };
        if (!contentClue) {
          profession.professionError = 'unknown-clue';
        } else if (contentClue.gameId !== sourceGame) {
          profession.professionError = 'clue-game-mismatch';
        } else {
          profession = applyProfessionEvents(next, 'READ', {
            professionId: null,
            gameId: sourceGame,
            clueId: clueId,
            clue: contentClue,
            clueOpened: true,
            at: now,
          }, catalog);
          next = profession.state;
        }
        return {
          state: next,
          transition: { from: base.stage, to: next.stage },
          professionEvent: profession.professionEvents[0] || null,
          professionEvents: profession.professionEvents,
          professionError: profession.professionError,
        };
      }
      case 'LETTER_FOLLOWED': {
        const next = clone(base);
        next.portSeenAt = next.portSeenAt || now;
        next.stage = newerStage(next.stage, 'LOCAL');
        next.updatedAt = now;
        return { state: next, transition: { from: base.stage, to: next.stage } };
      }
      case 'CONTRACT_SIGNED': {
        const next = clone(base);
        next.careerSignedAt = next.careerSignedAt || now;
        next.stage = newerStage(next.stage, 'RESIDENT');
        next.updatedAt = now;
        return { state: next, transition: { from: base.stage, to: next.stage } };
      }
      case 'FIRST_RUN_COMPLETED': {
        const next = clone(base);
        next.explorerAt = next.explorerAt || now;
        next.stage = newerStage(next.stage, 'EXPLORER');
        next.updatedAt = now;
        return { state: next, transition: { from: base.stage, to: next.stage } };
      }
      case 'SET_HINTS': {
        const next = clone(base);
        next.hintsEnabled = act.enabled !== false;
        next.updatedAt = now;
        return { state: next, transition: null };
      }
      default:
        return { state: base, transition: null, invalid: 'unknown-action' };
    }
  }

  function incrementRuns(state, run, now) {
    const next = clone(state);
    if (!isEligibleRun(run)) return next;
    const gameId = run.gameId;
    const prev = next.runs[gameId] || { eligibleRuns: 0, lastRunId: null, lastRunAt: null };
    next.runs[gameId] = {
      eligibleRuns: prev.eligibleRuns + 1,
      lastRunId: typeof run.runId === 'string' ? run.runId : prev.lastRunId,
      lastRunAt: now,
    };
    next.updatedAt = now;
    return next;
  }

  /** 已发现线索列表（内容顺序或发现顺序由调用方决定）。 */
  function discoveredClueIds(state) {
    return Object.keys((state && state.clues) || {});
  }

  function hasClue(state, clueId) {
    return !!(state && isObject(state.clues) && state.clues[clueId]);
  }

  function stageOf(state) {
    return (state && STAGES.indexOf(state.stage) >= 0 && state.stage) || 'DORMANT';
  }

  return {
    SCHEMA_VERSION,
    STATE_STORE_KEY,
    STAGES: STAGES.slice(),
    VALID_MODES: VALID_MODES.slice(),
    VALID_FAMILIES: VALID_FAMILIES.slice(),
    initialState,
    normalizeState,
    normalizeClueBundle,
    evaluateRun,
    reduce,
    discoveredClueIds,
    hasClue,
    stageOf,
  };
});
