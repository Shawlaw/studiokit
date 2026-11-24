#!/usr/bin/env node
/**
 * D18-13 契约测试：0.18 故事图可达性（纯 Node，无 Chrome / 无网络 / 不写仓库文件）
 *
 * 证明目标（docs/arcade-life/ADR-interfaces.md §20.2 / §20.5）：
 * - 真实内容里的 16 起源 × 3 终局 = 48 条主线路径全部可达；
 *   每个起源经 C0→C1→C2→C3→C4→C5（三终局）都能走完，每步的旗标 / 证据 /
 *   委托要求都能用真实内容（96 委托、story-evidence 规则）满足；
 * - 每章至少 2 条替代路线（C0 为序章单路线、C5 为三终局；数量取自
 *   campaign-core.MIN_ROUTES，不硬编码 16 / 96）；C2–C4 的研究 / 工程 / 贸易 /
 *   非战斗路线至少各一条可达；
 * - 无不可回收道具 / 唯一职业 / 单一游戏硬锁：任一游戏被移除后每章仍有可达路线，
 *   职业不是任何前置（内容只按委托 / 章节旗标门禁），主线不消耗材料 / 信用点 /
 *   飞船 / 一次性证据；
 * - T4–T6 与三终局的受控旗标顺序：T4 只在 C3 后、T5 只在 C4 后、T6 只在 C5
 *   （ending 落库）后可用，任何 T6 都不允许先于 ending；
 * - 负例（注入故障必须 FAIL 并指出 origin / chapter）：删除替代路线、删除必需证据、
 *   单游戏硬锁、把 T6 提前到 ending 之前。负例只改内存内容副本，不碰真实文件。
 *
 * 真实内容来源（全部从 content/*.json 读取，数量由内容推导）：
 *   campaign.json / chapter-00..05.json / ending-*.json / side-stories.json /
 *   npc.json / commissions.json / items.json / registry.json
 *
 * 真实运行时交叉验证：campaign-core（configure / validate / state /
 * routeRequirementsMet）与 ending-reducer（configure / canStart / endingOf /
 * epilogueFor）。若任一模块缺失，输出 GAP 并以退出码 2 结束，绝不把缺失写成 PASS。
 *
 * 运行：node tools/career_graph_reachability_test.mjs
 * 退出码：0 = 全 PASS（可含 WARN）；1 = 有 FAIL；2 = 内容 / 接口缺口（GAP）
 *        或使用错误（本脚本不接受参数）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const CAREER_DIR = path.join(REPO_ROOT, 'apps', 'arcade', 'career');
const CONTENT_DIR = path.join(CAREER_DIR, 'content');

if (process.argv.slice(2).length > 0) {
  console.error('usage: node tools/career_graph_reachability_test.mjs（不接受参数）');
  process.exit(2);
}

/* ------------------------------------------------------------------ *
 * 契约常量（0.18 冻结形状；数量/ID 仍从内容推导）
 * ------------------------------------------------------------------ */

const CONTRACT = Object.freeze({
  chapterIds: ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'],
  finale: 'C5',
  chapterFlags: Object.freeze({
    C0: 'C0.port_seen',
    C1: 'C1.signal_fragment',
    C2: 'C2.research_complete',
    C3: 'C3.truth_found',
    C4: 'C4.city_power_restored',
    C5: 'C5.star_tower_resolved',
  }),
  minRoutes: Object.freeze({ C0: 1, C1: 2, C2: 2, C3: 2, C4: 2, C5: 3 }),
  endingApproaches: ['combat', 'research', 'rescue'],
  tierGates: Object.freeze({ 4: 'C3.truth_found', 5: 'C4.city_power_restored', 6: 'C5.star_tower_resolved' }),
  combatObjectiveKinds: ['boss.defeated', 'enemy.killed', 'wave.completed'],
  routeRequirementKeys: ['allFlags', 'anyFlags', 'anyCommissions', 'anyChaosFlags', 'evidenceAll', 'evidenceAny', 'all', 'any'],
});

/* ------------------------------------------------------------------ *
 * 基础工具
 * ------------------------------------------------------------------ */

const checks = [];
const warnings = [];

function check(id, ok, detail, severity) {
  const item = {
    id,
    ok: !!ok,
    detail: detail === undefined || detail === null ? '' : String(detail),
    severity: severity === 'gap' ? 'gap' : 'fail',
  };
  checks.push(item);
  return item.ok;
}

function warn(id, detail) {
  warnings.push({ id: id, detail: detail === undefined || detail === null ? '' : String(detail) });
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sortedUnique(list) {
  return [...new Set(list)].sort();
}

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, name), 'utf8'));
}

function safeRequire(relativePath) {
  try {
    return require(path.join(CAREER_DIR, relativePath));
  } catch (err) {
    return null;
  }
}

function readText(relativePath) {
  try {
    return fs.readFileSync(path.join(CAREER_DIR, relativePath), 'utf8');
  } catch (err) {
    return '';
  }
}

function countBy(list, keyFn) {
  const out = new Map();
  list.forEach((item) => {
    const key = keyFn(item);
    out.set(key, (out.get(key) || 0) + 1);
  });
  return out;
}

function setEquals(left, right) {
  const a = sortedUnique([...left]);
  const b = sortedUnique([...right]);
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/* ------------------------------------------------------------------ *
 * 真实内容装载
 * ------------------------------------------------------------------ */

const storyEvidenceModule = safeRequire('story-evidence.js');
if (!storyEvidenceModule) {
  console.error('FATAL: apps/arcade/career/story-evidence.js 缺失，无法判定 C2–C4 证据旗标。');
  process.exit(2);
}

const campaignCore = safeRequire('campaign-core.js');
const endingReducer = safeRequire('ending-reducer.js');

const campaign = readJson('campaign.json');
const commissionsContent = readJson('commissions.json');
const itemsContent = readJson('items.json');
const registryContent = readJson('registry.json');
const npcContent = readJson('npc.json');
const sideStoriesContent = readJson('side-stories.json');
const cluesContent = readJson('clues.json');

const chapterFiles = CONTRACT.chapterIds.map((chapterId) => {
  const index = Number(chapterId.slice(1));
  try {
    return readJson('chapter-0' + index + '.json');
  } catch (err) {
    return null;
  }
});

const endingFiles = CONTRACT.endingApproaches.map((approach) => {
  try {
    return readJson('ending-' + approach + '.json');
  } catch (err) {
    return null;
  }
});

const COMMISSIONS = commissionsContent.commissions || [];
const BY_ID = new Map(COMMISSIONS.map((commission) => [commission.commissionId, commission]));
const GAME_IDS = sortedUnique(COMMISSIONS.map((commission) => commission.gameId));
const PROFESSION_IDS = sortedUnique(COMMISSIONS.map((commission) => commission.professionId));
const TIER_BY_ID = new Map(COMMISSIONS.map((commission) => [commission.commissionId, commission.tier]));
const GAME_BY_COMMISSION = new Map(COMMISSIONS.map((commission) => [commission.commissionId, commission.gameId]));
const EVIDENCE_PRODUCERS = new Map();
COMMISSIONS.forEach((commission) => {
  ((commission.reward && commission.reward.evidence) || []).forEach((token) => {
    if (!EVIDENCE_PRODUCERS.has(token)) EVIDENCE_PRODUCERS.set(token, []);
    EVIDENCE_PRODUCERS.get(token).push(commission.commissionId);
  });
});
const FLAG_PRODUCERS = new Map();
COMMISSIONS.forEach((commission) => {
  ((commission.reward && commission.reward.flags) || []).forEach((flag) => {
    if (!FLAG_PRODUCERS.has(flag)) FLAG_PRODUCERS.set(flag, []);
    FLAG_PRODUCERS.get(flag).push(commission.commissionId);
  });
});
const GAME_BY_ID = new Map(
  ((registryContent && registryContent.games) || []).map((game) => [game.gameId, game]),
);
const PROFESSION_BY_ID = new Map(
  ((registryContent && registryContent.professions) || []).map((profession) => [profession.professionId, profession]),
);
const DOMAIN_OF_PROFESSION = new Map(
  ((registryContent && registryContent.professions) || []).map((profession) => [profession.professionId, profession.domain || '']),
);
const CLUE_IDS = sortedUnique(((cluesContent && cluesContent.clues) || []).map((clue) => clue.clueId || clue.nodeId || '').filter(Boolean));

const campaignChapters = (campaign.chapters || []).slice();
const campaignChapterById = new Map(campaignChapters.map((chapter) => [chapter.chapterId, chapter]));
const campaignEndings = (campaign.endings || []).slice();
const campaignEndingByApproach = new Map(campaignEndings.map((ending) => [ending.approach, ending]));
const ENDING_CONTENT_BY_APPROACH = new Map(
  endingFiles.filter(Boolean).map((ending) => [ending.approach, ending]),
);

/* 起源：优先 chapter-01.origins（16 个「游戏 + 职业」首源），缺失时由 96 委托
 * 的 (gameId, professionId) 反推；两种来源都要求与 registry / commissions 自洽。 */
const chapterOrigins = (chapterFiles[1] && Array.isArray(chapterFiles[1].origins) ? chapterFiles[1].origins : [])
  .filter((origin) => isObject(origin) && typeof origin.gameId === 'string' && typeof origin.professionId === 'string')
  .map((origin) => ({ gameId: origin.gameId, professionId: origin.professionId, source: 'chapter-01.origins' }));

const ORIGINS = chapterOrigins.length
  ? chapterOrigins
  : COMMISSIONS.map((commission) => ({ gameId: commission.gameId, professionId: commission.professionId, source: 'commissions' }))
      .filter((origin, index, list) => list.findIndex((item) => item.gameId === origin.gameId && item.professionId === origin.professionId) === index)
      .sort((a, b) => (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0));

const ENDINGS = campaignEndings.map((ending) => ending.approach);
const ORIGIN_COUNT = ORIGINS.length;
const ENDING_COUNT = ENDINGS.length;

/* ------------------------------------------------------------------ *
 * 条件求值（与 campaign-core 的键集一致；额外支持 commission unlock 原子）
 * ------------------------------------------------------------------ */

function emptyContext(extra) {
  const ctx = {
    flags: new Set(),
    cleared: new Set(),
    evidence: new Set(),
    items: new Map(),
    credits: 0,
    capabilities: new Set(),
  };
  return Object.assign(ctx, extra || {});
}

function evalRequirement(req, ctx, depth) {
  const level = depth || 0;
  const clauses = [];
  const invalid = [];
  if (level > 8) return { ok: false, clauses: [{ kind: 'invalid', values: ['depth'] }], invalid: ['depth'] };
  if (req === undefined || req === null) return { ok: true, clauses: [], invalid: [] };
  if (!isObject(req)) return { ok: false, clauses: [{ kind: 'invalid', values: ['shape'] }], invalid: ['shape'] };
  const keys = Object.keys(req);
  if (!keys.length) return { ok: true, clauses: [], invalid: [] };

  let ok = true;
  keys.forEach((key) => {
    const value = req[key];
    if (key === 'atLeast') return;
    switch (key) {
      case 'all': {
        if (!Array.isArray(value)) {
          invalid.push('all');
          ok = false;
          return;
        }
        value.forEach((child) => {
          const childResult = evalRequirement(child, ctx, level + 1);
          invalid.push(...childResult.invalid);
          if (!childResult.ok) {
            ok = false;
            clauses.push(...childResult.clauses);
          }
        });
        return;
      }
      case 'any': {
        if (!Array.isArray(value) || value.length === 0) {
          invalid.push('any');
          ok = false;
          return;
        }
        let hit = false;
        const branches = [];
        for (const child of value) {
          const childResult = evalRequirement(child, ctx, level + 1);
          invalid.push(...childResult.invalid);
          if (childResult.ok) {
            hit = true;
            break;
          }
          branches.push({ kind: 'branch', node: child });
        }
        if (!hit) {
          ok = false;
          clauses.push(...branches);
        }
        return;
      }
      case 'allFlags':
      case 'anyFlags':
      case 'anyChaosFlags': {
        const list = Array.isArray(value) ? value : [];
        if (!Array.isArray(value)) invalid.push(key);
        if (key === 'allFlags') {
          list.forEach((flag) => {
            if (!ctx.flags.has(flag)) {
              ok = false;
              clauses.push({ kind: 'flag', values: [flag], any: false });
            }
          });
        } else if (!list.some((flag) => ctx.flags.has(flag))) {
          ok = false;
          clauses.push({ kind: 'flag', values: list, any: true });
        }
        return;
      }
      case 'anyCommissions':
      case 'allCommissions': {
        const list = Array.isArray(value) ? value : [];
        if (!Array.isArray(value)) invalid.push(key);
        if (key === 'allCommissions') {
          list.forEach((commissionId) => {
            if (!ctx.cleared.has(commissionId)) {
              ok = false;
              clauses.push({ kind: 'commission', values: [commissionId], any: false });
            }
          });
        } else if (!list.some((commissionId) => ctx.cleared.has(commissionId))) {
          ok = false;
          clauses.push({ kind: 'commission', values: list, any: true });
        }
        return;
      }
      case 'evidenceAll':
      case 'evidenceAny':
      case 'allEvidence':
      case 'anyEvidence': {
        const list = Array.isArray(value) ? value : [];
        if (!Array.isArray(value)) invalid.push(key);
        const all = key === 'evidenceAll' || key === 'allEvidence';
        if (all) {
          list.forEach((token) => {
            if (!ctx.evidence.has(token)) {
              ok = false;
              clauses.push({ kind: 'evidence', values: [token], any: false });
            }
          });
        } else if (!list.some((token) => ctx.evidence.has(token))) {
          ok = false;
          clauses.push({ kind: 'evidence', values: list, any: true });
        }
        return;
      }
      case 'commissionCleared': {
        if (!ctx.cleared.has(value)) {
          ok = false;
          clauses.push({ kind: 'commission', values: [value], any: false });
        }
        return;
      }
      case 'chapterFlag':
      case 'flag': {
        if (!ctx.flags.has(value)) {
          ok = false;
          clauses.push({ kind: 'flag', values: [value], any: false });
        }
        return;
      }
      case 'item': {
        const need = Math.max(1, Number.isFinite(Number(req.atLeast)) ? Number(req.atLeast) : 1);
        if ((ctx.items.get(value) || 0) < need) {
          ok = false;
          clauses.push({ kind: 'item', values: [value], any: false });
        }
        return;
      }
      case 'credits': {
        const need = Number(value && value.atLeast);
        if (!Number.isFinite(need) || ctx.credits < need) {
          ok = false;
          clauses.push({ kind: 'credits', values: [String(value && value.atLeast)], any: false });
        }
        return;
      }
      default: {
        invalid.push('key:' + key);
        ok = false;
      }
    }
  });

  /* 去重：同类同值同 any 只保留一个，避免同一个缺失被反复清理。 */
  const deduped = [];
  const seen = new Set();
  clauses.forEach((clause) => {
    if (clause.kind === 'branch') {
      deduped.push(clause);
      return;
    }
    const key = clause.kind + '|' + (clause.any ? 'any' : 'all') + '|' + sortedUnique(clause.values).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(clause);
  });
  return { ok, clauses: deduped, invalid };
}

function summarizeClauses(clauses) {
  return clauses.map((clause) => {
    if (clause.kind === 'branch') return 'branch';
    return clause.kind + ':' + clause.values.join('|');
  }).join(';');
}

/* ------------------------------------------------------------------ *
 * story-evidence 实例（每个分析场景一个隔离实例，绝不共享状态）
 * ------------------------------------------------------------------ */

function configureStoryEvidence(commissionsList, items) {
  const evidence = storyEvidenceModule.createStoryEvidence
    ? storyEvidenceModule.createStoryEvidence({})
    : storyEvidenceModule;
  const result = evidence.configure({ commissions: commissionsList.slice(), items: items });
  const flagsInfo = evidence.storyFlags();
  return {
    module: evidence,
    configureResult: result,
    storyRuleFlags: new Set((flagsInfo && flagsInfo.flags) || []),
    evidenceCount: result && Number.isFinite(Number(result.evidenceCount)) ? Number(result.evidenceCount) : 0,
  };
}

/* ------------------------------------------------------------------ *
 * 图规划引擎：真实内容 + story-evidence 推导 + 委托 unlock 依赖
 * ------------------------------------------------------------------ */

function createEngine(pack) {
  const commissionsList = pack.commissions;
  const byId = new Map(commissionsList.map((commission) => [commission.commissionId, commission]));
  const excludeGames = new Set(pack.excludeGames || []);
  const excludeProfessions = new Set(pack.excludeProfessions || []);
  const story = configureStoryEvidence(commissionsList, pack.items);
  const storyRuleFlags = story.storyRuleFlags;
  const evidenceProducerIds = new Map();
  EVIDENCE_PRODUCERS.forEach((list, token) => {
    evidenceProducerIds.set(token, list.slice());
  });
  const flagProducerIds = new Map();
  FLAG_PRODUCERS.forEach((list, flag) => {
    flagProducerIds.set(flag, list.slice());
  });

  function isExcluded(commission) {
    if (!commission) return true;
    if (excludeGames.has(commission.gameId)) return true;
    if (excludeProfessions.has(commission.professionId)) return true;
    return false;
  }

  function newState(origin) {
    const state = {
      origin: origin || { gameId: GAME_IDS[0] || '', professionId: PROFESSION_IDS[0] || '' },
      claims: [],
      routeFlags: new Set(),
      steps: [],
      ended: null,
      flags: new Set(),
      evidence: new Set(),
      cleared: new Set(),
      context: null,
    };
    refresh(state);
    return state;
  }

  function refresh(state) {
    const ctx = story.module.contextFor({ claims: state.claims });
    state.context = ctx;
    state.evidence = new Set(ctx.evidence);
    state.cleared = new Set(ctx.cleared);
    state.flags = new Set(ctx.flags);
    state.routeFlags.forEach((flag) => state.flags.add(flag));
    return state;
  }

  function routeContext(state) {
    return {
      flags: state.flags,
      cleared: state.cleared,
      evidence: state.evidence,
      items: new Map(),
      credits: 0,
      capabilities: new Set(),
    };
  }

  function commissionGateMet(state, commission) {
    if (!commission || !commission.chapterGate) return true;
    return state.flags.has(commission.chapterGate);
  }

  function commissionUnlockResult(state, commission) {
    if (!commission) return { ok: false, reason: 'unknown-commission' };
    if (isExcluded(commission)) return { ok: false, reason: 'excluded', commissionId: commission.commissionId };
    if (!commissionGateMet(state, commission)) {
      return { ok: false, reason: 'gate-not-met', flag: commission.chapterGate, commissionId: commission.commissionId };
    }
    const result = evalRequirement(commission.unlock || { all: [] }, routeContext(state));
    if (result.invalid.length) return { ok: false, reason: 'invalid-unlock', detail: result.invalid.join(',') };
    if (!result.ok) {
      return {
        ok: false,
        reason: 'unlock-unmet',
        commissionId: commission.commissionId,
        clauses: result.clauses,
      };
    }
    return { ok: true };
  }

  function claimRow(commission) {
    return {
      receiptId: 'sim-receipt-' + commission.commissionId,
      careerId: 'career-d18-13-sim',
      commissionId: commission.commissionId,
      credits: 0,
      items: {},
      evidence: ((commission.reward && commission.reward.evidence) || []).slice(),
      flags: ((commission.reward && commission.reward.flags) || []).slice(),
      claimedAt: null,
    };
  }

  function satisfyChain(state, commissionId, stack) {
    const trail = stack || [];
    if (state.cleared.has(commissionId)) return { ok: true, cleared: [] };
    const commission = byId.get(commissionId);
    if (!commission) return { ok: false, reason: 'unknown-commission', commissionId: commissionId };
    if (isExcluded(commission)) return { ok: false, reason: 'excluded', commissionId: commissionId };
    if (trail.indexOf(commissionId) >= 0) return { ok: false, reason: 'cycle', commissionId: commissionId };
    if (!commissionGateMet(state, commission)) {
      return { ok: false, reason: 'gate-not-met', flag: commission.chapterGate, commissionId: commissionId };
    }
    const unlock = evalRequirement(commission.unlock || { all: [] }, routeContext(state));
    if (unlock.invalid.length) return { ok: false, reason: 'invalid-unlock', commissionId: commissionId, detail: unlock.invalid.join(',') };
    if (!unlock.ok) {
      for (const clause of unlock.clauses) {
        if (clause.kind === 'commission') {
          const dep = clause.values[0];
          const result = satisfyChain(state, dep, trail.concat(commissionId));
          if (!result.ok) return result;
        } else {
          return { ok: false, reason: 'unlock-unmet', commissionId: commissionId, clauses: unlock.clauses };
        }
      }
      const retry = evalRequirement(commission.unlock || { all: [] }, routeContext(state));
      if (!retry.ok) {
        return { ok: false, reason: 'unlock-unmet', commissionId: commissionId, clauses: retry.clauses };
      }
    }
    const clearedBefore = new Set(state.cleared);
    state.claims.push(claimRow(commission));
    state.steps.push({
      kind: 'commission',
      commissionId: commission.commissionId,
      gameId: commission.gameId,
      tier: commission.tier,
      evidence: ((commission.reward && commission.reward.evidence) || []).slice(),
    });
    refresh(state);
    const newly = [...state.cleared].filter((id) => !clearedBefore.has(id));
    return { ok: true, cleared: sortedUnique(newly) };
  }

  function ensureFlag(state, flag, depth) {
    const level = depth || 0;
    if (state.flags.has(flag)) return { ok: true, flag: flag };
    if (level > 6) return { ok: false, flag: flag, reason: 'flag-depth' };
    if (storyRuleFlags.has(flag)) return ensureStoryFlag(state, flag, level + 1);
    const producers = (flagProducerIds.get(flag) || [])
      .map((id) => byId.get(id))
      .filter((commission) => commission && !isExcluded(commission))
      .sort((a, b) => (a.tier - b.tier) || (a.commissionId < b.commissionId ? -1 : 1));
    for (const producer of producers) {
      const result = satisfyChain(state, producer.commissionId, []);
      if (result.ok && state.flags.has(flag)) return { ok: true, flag: flag };
    }
    return { ok: false, flag: flag, reason: 'no-flag-producer' };
  }

  function ensureStoryFlag(state, flag, depth) {
    const level = depth || 0;
    if (state.flags.has(flag)) return { ok: true, flag: flag };
    if (!storyRuleFlags.has(flag)) return { ok: false, flag: flag, reason: 'not-story-rule' };
    if (level > 6) return { ok: false, flag: flag, reason: 'flag-depth' };
    for (let round = 0; round < commissionsList.length + 8; round += 1) {
      if (state.flags.has(flag)) return { ok: true, flag: flag };
      const missing = story.module.missingFor(flag, { claims: state.claims });
      if (!missing || missing.ok !== true || missing.known !== true) {
        return { ok: false, flag: flag, reason: missing && missing.reason ? missing.reason : 'missing-unknown' };
      }
      let progressed = false;
      for (const item of missing.missing || []) {
        if (item && item.kind === 'flag' && typeof item.flag === 'string' && !state.flags.has(item.flag)) {
          const flagResult = ensureFlag(state, item.flag, level + 1);
          if (flagResult.ok) progressed = true;
        }
      }
      if (state.flags.has(flag)) return { ok: true, flag: flag };
      const candidateTokens = [];
      (missing.missing || []).forEach((item) => {
        (item && Array.isArray(item.candidates) ? item.candidates : []).forEach((token) => {
          if (candidateTokens.indexOf(token) < 0) candidateTokens.push(token);
        });
      });
      const producers = [];
      candidateTokens.forEach((token) => {
        (evidenceProducerIds.get(token) || []).forEach((commissionId) => {
          if (producers.indexOf(commissionId) < 0) producers.push(commissionId);
        });
      });
      const sortedProducers = producers
        .map((id) => byId.get(id))
        .filter((commission) => commission && !isExcluded(commission) && !state.cleared.has(commission.commissionId))
        .sort((a, b) => {
          const gatedA = a.chapterGate && !state.flags.has(a.chapterGate) ? 1 : 0;
          const gatedB = b.chapterGate && !state.flags.has(b.chapterGate) ? 1 : 0;
          return (gatedA - gatedB) || (a.tier - b.tier) || (a.commissionId < b.commissionId ? -1 : 1);
        });
      for (const producer of sortedProducers) {
        const result = satisfyChain(state, producer.commissionId, []);
        if (result.ok) {
          progressed = true;
          break;
        }
      }
      if (!progressed) {
        return {
          ok: false,
          flag: flag,
          reason: 'evidence-unreachable',
          missing: summarizeClauses(
            (missing.missing || []).map((item) => ({
              kind: item.kind || 'unknown',
              any: true,
              values: item.candidates || [item.flag || ''],
            })),
          ),
        };
      }
    }
    return { ok: false, flag: flag, reason: 'flag-loop' };
  }

  function attemptClause(state, clause) {
    if (clause.kind === 'branch') {
      const result = satisfyRequirementNode(state, clause.node);
      return result;
    }
    if (clause.kind === 'flag') {
      if (!clause.any) {
        for (const flag of clause.values) {
          const result = ensureFlag(state, flag, 0);
          if (!result.ok) return result;
        }
        return { ok: true };
      }
      for (const flag of clause.values) {
        const result = ensureFlag(state, flag, 0);
        if (result.ok) return { ok: true };
      }
      return { ok: false, reason: 'no-flag-alternative', values: clause.values };
    }
    if (clause.kind === 'commission') {
      if (!clause.any) {
        for (const commissionId of clause.values) {
          const result = satisfyChain(state, commissionId, []);
          if (!result.ok) return result;
        }
        return { ok: true };
      }
      for (const commissionId of clause.values) {
        const result = satisfyChain(state, commissionId, []);
        if (result.ok) return { ok: true };
      }
      return { ok: false, reason: 'no-commission-alternative', values: clause.values };
    }
    if (clause.kind === 'evidence') {
      if (!clause.any) {
        for (const token of clause.values) {
          const producers = (evidenceProducerIds.get(token) || [])
            .map((id) => byId.get(id))
            .filter((commission) => commission && !isExcluded(commission));
          let hit = false;
          for (const producer of producers) {
            const result = satisfyChain(state, producer.commissionId, []);
            if (result.ok) {
              hit = true;
              break;
            }
          }
          if (!hit) return { ok: false, reason: 'no-evidence-producer', token: token };
        }
        return { ok: true };
      }
      for (const token of clause.values) {
        const producers = (evidenceProducerIds.get(token) || [])
          .map((id) => byId.get(id))
          .filter((commission) => commission && !isExcluded(commission));
        for (const producer of producers) {
          const result = satisfyChain(state, producer.commissionId, []);
          if (result.ok) return { ok: true };
        }
      }
      return { ok: false, reason: 'no-evidence-alternative', values: clause.values };
    }
    if (clause.kind === 'item' || clause.kind === 'credits') {
      return { ok: false, reason: 'requires-resource', kind: clause.kind, values: clause.values };
    }
    return { ok: false, reason: 'invalid-clause', kind: clause.kind };
  }

  function satisfyRequirementNode(state, node) {
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const result = evalRequirement(node, routeContext(state));
      if (result.invalid.length) return { ok: false, reason: 'invalid-requirement', detail: result.invalid.join(',') };
      if (result.ok) return { ok: true };
      let progressed = false;
      for (const clause of result.clauses) {
        const attempt = attemptClause(state, clause);
        if (attempt.ok) progressed = true;
        else if (attempt.reason === 'requires-resource' || attempt.reason === 'invalid-clause') {
          return { ok: false, reason: attempt.reason, detail: summarizeClauses([clause]) };
        }
      }
      if (!progressed) return { ok: false, reason: 'requirements-unmet', detail: summarizeClauses(result.clauses) };
    }
    return { ok: false, reason: 'requirement-loop' };
  }

  function satisfyRoute(state, route) {
    return satisfyRequirementNode(state, route.requires || {});
  }

  function classifyRoute(route) {
    const commissionIds = [];
    const flags = [];
    const collect = (node) => {
      if (!isObject(node)) return;
      ['anyCommissions', 'allCommissions'].forEach((key) => {
        (Array.isArray(node[key]) ? node[key] : []).forEach((id) => {
          if (commissionIds.indexOf(id) < 0) commissionIds.push(id);
        });
      });
      ['allFlags', 'anyFlags', 'anyChaosFlags'].forEach((key) => {
        (Array.isArray(node[key]) ? node[key] : []).forEach((flag) => {
          if (flags.indexOf(flag) < 0) flags.push(flag);
        });
      });
      (Array.isArray(node.all) ? node.all : []).forEach(collect);
      (Array.isArray(node.any) ? node.any : []).forEach(collect);
    };
    collect(route.requires || {});
    const commissions = commissionIds.map((id) => BY_ID.get(id)).filter(Boolean);
    /* 旗标前置也要翻译成真实游戏产出（例如 C1 的 work_done / flight_done）。 */
    flags.forEach((flag) => {
      (FLAG_PRODUCERS.get(flag) || []).forEach((commissionId) => {
        const producer = BY_ID.get(commissionId);
        if (producer && commissions.indexOf(producer) < 0) commissions.push(producer);
      });
    });
    const domains = sortedUnique(commissions.map((commission) => DOMAIN_OF_PROFESSION.get(commission.professionId) || ''));
    const games = sortedUnique(commissions.map((commission) => commission.gameId));
    const routeId = String(route.routeId || '');
    const label = String(route.label || '');
    const objectives = commissions.map((commission) => commission.objective && commission.objective.kind);
    const nonCombat = objectives.length > 0 && objectives.every((kind) => CONTRACT.combatObjectiveKinds.indexOf(kind) < 0);
    const trade = /market|trade|shop/i.test(routeId) || /贸易|商店|买一份|采购/.test(label);
    const research = domains.indexOf('research') >= 0 || /research|archive|explore|ecology/i.test(routeId);
    const engineering = domains.indexOf('engineering') >= 0 || /build|logistics|maintenance/i.test(routeId);
    return {
      routeId: routeId,
      commissionIds: commissionIds,
      games: games,
      domains: domains,
      nonCombat: nonCombat,
      trade: trade,
      research: research,
      engineering: engineering,
    };
  }

  return {
    commissions: commissionsList,
    byId: byId,
    story: story,
    storyRuleFlags: storyRuleFlags,
    isExcluded: isExcluded,
    newState: newState,
    refresh: refresh,
    routeContext: routeContext,
    commissionUnlockResult: commissionUnlockResult,
    commissionGateMet: commissionGateMet,
    satisfyChain: satisfyChain,
    ensureFlag: ensureFlag,
    ensureStoryFlag: ensureStoryFlag,
    satisfyRoute: satisfyRoute,
    classifyRoute: classifyRoute,
  };
}

/* ------------------------------------------------------------------ *
 * 状态快照（用于 campaign-core 交叉验证 / 单游戏死锁注入）
 * ------------------------------------------------------------------ */

function snapshotOf(state) {
  return {
    origin: { gameId: state.origin.gameId, professionId: state.origin.professionId },
    claims: state.claims.map((row) => deepClone(row)),
    routeFlags: [...state.routeFlags].sort(),
    ended: state.ended,
  };
}

function stateFromSnapshot(engine, snapshot) {
  const state = {
    origin: { gameId: snapshot.origin.gameId, professionId: snapshot.origin.professionId },
    claims: snapshot.claims.map((row) => deepClone(row)),
    routeFlags: new Set(snapshot.routeFlags || []),
    steps: [],
    ended: snapshot.ended || null,
    flags: new Set(),
    evidence: new Set(),
    cleared: new Set(),
    context: null,
  };
  engine.refresh(state);
  return state;
}

function routeSelfReferential(chapter, route) {
  const flag = CONTRACT.chapterFlags[chapter.chapterId];
  if (!flag || !route || !Array.isArray(route.rewardFlags) || route.rewardFlags.indexOf(flag) < 0) return false;
  const leaves = [];
  const collect = (node) => {
    if (!isObject(node)) return;
    ['allFlags', 'anyFlags', 'anyChaosFlags'].forEach((key) => {
      (Array.isArray(node[key]) ? node[key] : []).forEach((token) => leaves.push(token));
    });
    (Array.isArray(node.all) ? node.all : []).forEach(collect);
    (Array.isArray(node.any) ? node.any : []).forEach(collect);
  };
  collect(route.requires || {});
  return leaves.indexOf(flag) >= 0;
}

function productiveRoutes(chapter) {
  return (chapter.routes || []).filter((route) => !routeSelfReferential(chapter, route));
}

/* ------------------------------------------------------------------ *
 * 图分析：48 条主线路径 + 每章替代路线 + 死锁
 * ------------------------------------------------------------------ */

function planChapter(engine, state, chapter, originIndex, chapterIndex, options) {
  const evalOptions = options || {};
  const entry = evalRequirement(chapter.entry || {}, engine.routeContext(state));
  if (entry.invalid.length) {
    return { ok: false, chapterId: chapter.chapterId, reason: 'invalid-entry', detail: entry.invalid.join(',') };
  }
  if (!entry.ok) {
    return { ok: false, chapterId: chapter.chapterId, reason: 'chapter-entry-unmet', detail: summarizeClauses(entry.clauses) };
  }
  const routes = chapter.routes || [];
  const rotate = routes.length ? ((originIndex + chapterIndex) % routes.length) : 0;
  const order = routes.map((_, index) => (index + rotate) % routes.length);
  const stepsBefore = state.steps.length;
  const attempts = [];
  for (const index of order) {
    const route = routes[index];
    const requirementResult = engine.satisfyRoute(state, route);
    if (!requirementResult.ok) {
      attempts.push({ routeId: route.routeId, reason: requirementResult.reason, detail: requirementResult.detail || null });
      continue;
    }
    const rewardChecks = [];
    for (const flag of route.rewardFlags || []) {
      if (engine.storyRuleFlags.has(flag)) {
        const result = engine.ensureStoryFlag(state, flag, 0);
        rewardChecks.push({ flag: flag, ok: result.ok, reason: result.reason || null, missing: result.missing || null });
      } else {
        state.routeFlags.add(flag);
        state.steps.push({ kind: 'route-flag', flag: flag });
        rewardChecks.push({ flag: flag, ok: true });
      }
    }
    engine.refresh(state);
    const flagsOk = (route.rewardFlags || []).every((flag) => state.flags.has(flag));
    if (!flagsOk) {
      attempts.push({
        routeId: route.routeId,
        reason: 'reward-flag-unmet',
        detail: rewardChecks.filter((item) => !item.ok).map((item) => item.flag + ':' + item.reason).join(';'),
      });
      continue;
    }
    const commissions = state.steps
      .slice(stepsBefore)
      .filter((step) => step.kind === 'commission')
      .map((step) => step.commissionId);
    const segment = {
      chapterId: chapter.chapterId,
      routeId: route.routeId,
      commissions: commissions,
      rewardFlags: (route.rewardFlags || []).slice(),
      snapshot: snapshotOf(state),
      alternatives: evalOptions.computeAlternatives ? countAlternatives(engine, snapshotOf(state), chapter) : null,
    };
    return { ok: true, segment: segment };
  }
  return {
    ok: false,
    chapterId: chapter.chapterId,
    reason: 'no-route',
    detail: attempts.map((item) => item.routeId + ':' + item.reason + (item.detail ? '(' + item.detail + ')' : '')).join(' | '),
  };
}

function countAlternatives(engine, snapshot, chapter) {
  const declaredRoutes = chapter.routes || [];
  const productive = productiveRoutes(chapter);
  const results = productive.map((route) => {
    const state = stateFromSnapshot(engine, snapshot);
    const result = engine.satisfyRoute(state, route);
    const info = engine.classifyRoute(route);
    return {
      routeId: route.routeId,
      selfReferential: false,
      satisfiable: !!result.ok,
      reason: result.ok ? null : result.reason,
      category: info,
    };
  });
  const confirmation = declaredRoutes
    .filter((route) => routeSelfReferential(chapter, route))
    .map((route) => {
      const state = stateFromSnapshot(engine, snapshot);
      const result = engine.satisfyRoute(state, route);
      return {
        routeId: route.routeId,
        selfReferential: true,
        satisfiable: !!result.ok,
        reason: result.ok ? null : result.reason,
        category: engine.classifyRoute(route),
      };
    });
  const all = results.concat(confirmation);
  return {
    declared: declaredRoutes.length,
    productive: productive.length,
    satisfiable: results.filter((item) => item.satisfiable).length,
    satisfiableAll: all.filter((item) => item.satisfiable).length,
    routes: results,
    confirmationRoutes: confirmation,
  };
}

function planPath(engine, origin, approach, originIndex, options) {
  const evalOptions = options || {};
  const chapterMap = evalOptions.chapterMap || campaignChapterById;
  const endingMap = evalOptions.endingMap || campaignEndingByApproach;
  const state = engine.newState(origin);
  const segments = [];
  for (let chapterIndex = 0; chapterIndex < CONTRACT.chapterIds.length - 1; chapterIndex += 1) {
    const chapterId = CONTRACT.chapterIds[chapterIndex];
    const chapter = chapterMap.get(chapterId);
    if (!chapter) {
      return { ok: false, origin: origin, approach: approach, chapter: chapterId, reason: 'chapter-missing' };
    }
    const result = planChapter(engine, state, chapter, originIndex, chapterIndex, {
      computeAlternatives: evalOptions.computeAlternatives === true && originIndex === 0,
    });
    if (!result.ok) {
      return {
        ok: false,
        origin: origin,
        approach: approach,
        chapter: result.chapterId || chapterId,
        reason: result.reason,
        detail: result.detail || null,
      };
    }
    segments.push(result.segment);
  }
  const endingDefinition = endingMap.get(approach);
  if (!endingDefinition) {
    return { ok: false, origin: origin, approach: approach, chapter: CONTRACT.finale, reason: 'ending-missing' };
  }
  const finaleChapter = chapterMap.get(CONTRACT.finale);
  const endingEntry = evalRequirement(endingDefinition.entry || {}, engine.routeContext(state));
  if (!endingEntry.ok) {
    return {
      ok: false,
      origin: origin,
      approach: approach,
      chapter: CONTRACT.finale,
      reason: 'ending-entry-unmet',
      detail: summarizeClauses(endingEntry.clauses),
    };
  }
  const endingContent = ENDING_CONTENT_BY_APPROACH.get(approach) || null;
  const endingFlags = sortedUnique(
    (endingDefinition.flags || []).concat((endingContent && endingContent.flags) || []),
  );
  endingFlags.forEach((flag) => state.routeFlags.add(flag));
  state.ended = approach;
  state.steps.push({ kind: 'ending', approach: approach, flags: endingFlags });
  engine.refresh(state);
  const resolved = state.flags.has(CONTRACT.chapterFlags.C5) && state.flags.has('ending.' + approach);
  if (!resolved) {
    return { ok: false, origin: origin, approach: approach, chapter: CONTRACT.finale, reason: 'ending-flags-missing' };
  }
  const preEndingSnapshot = segments.length ? segments[segments.length - 1].snapshot : null;
  const segment = {
    chapterId: CONTRACT.finale,
    routeId: 'ending.' + approach,
    commissions: [],
    rewardFlags: endingFlags,
    snapshot: snapshotOf(state),
    endingGameId: endingContent && endingContent.gameId ? endingContent.gameId : null,
    endingChapterPresent: !!finaleChapter,
  };
  segments.push(segment);
  const crossProfession = state.claims.filter((row) => {
    const commission = BY_ID.get(row.commissionId);
    return commission && commission.professionId !== origin.professionId;
  });
  return {
    ok: true,
    origin: origin,
    approach: approach,
    segments: segments,
    preEndingSnapshot: preEndingSnapshot,
    finalSnapshot: snapshotOf(state),
    flags: sortedUnique([...state.flags]),
    crossProfessionCommissions: crossProfession.length,
    claimsCount: state.claims.length,
  };
}

function analyzeContent(pack, options) {
  const evalOptions = options || {};
  const engine = createEngine(pack);
  const origins = pack.origins || ORIGINS;
  const chapterList = pack.campaignChapters || campaignChapters;
  const chapterMap = new Map(chapterList.map((chapter) => [chapter.chapterId, chapter]));
  const endingList = (pack.campaign && Array.isArray(pack.campaign.endings) ? pack.campaign.endings : campaignEndings);
  const endingMap = new Map(endingList.map((ending) => [ending.approach, ending]));
  const endings = pack.endings || [...endingMap.keys()];
  const planOptions = { chapterMap: chapterMap, endingMap: endingMap };
  const failures = [];
  const paths = [];

  origins.forEach((origin, originIndex) => {
    endings.forEach((approach) => {
      const path = planPath(engine, origin, approach, originIndex, Object.assign({
        computeAlternatives: originIndex === 0,
      }, planOptions));
      if (!path.ok) {
        failures.push({
          id: 'path-unreachable',
          origin: origin.gameId,
          professionId: origin.professionId,
          ending: approach,
          chapter: path.chapter || null,
          detail: path.reason + (path.detail ? '(' + path.detail + ')' : ''),
        });
        return;
      }
      paths.push(path);
    });
  });

  /* 每章替代路线：所有起源的章前状态里，至少要有 minRoutes 条可满足的“有产出”路线。 */
  const alternatives = {};
  CONTRACT.chapterIds.forEach((chapterId) => {
    alternatives[chapterId] = { declared: 0, productive: 0, satisfiable: 0, routes: [] };
  });
  alternatives[CONTRACT.finale] = {
    declared: endings.length,
    productive: endings.length,
    satisfiable: endings.length,
    routes: endings.map((approach) => ({ routeId: 'ending.' + approach, satisfiable: true })),
  };
  /* 用第一个起源的逐章入口快照代表整章内容结构（内容门禁与起源无关）。 */
  const representative = paths.find((path) => path.origin.gameId === origins[0].gameId && path.approach === endings[0]);
  if (representative) {
    representative.segments.forEach((segment) => {
      if (segment.alternatives) alternatives[segment.chapterId] = Object.assign(alternatives[segment.chapterId], segment.alternatives);
    });
  }

  /* 每章替代路线不足（负例注入会走到这里；真实内容必须 0 条）。 */
  const minRoutes = (campaignCore && campaignCore.MIN_ROUTES) || CONTRACT.minRoutes;
  ['C0', 'C1', 'C2', 'C3', 'C4'].forEach((chapterId) => {
    const info = alternatives[chapterId] || {};
    const expected = minRoutes[chapterId] || 1;
    if (Number(info.productive) < expected) {
      failures.push({
        id: 'chapter-alternatives',
        chapter: chapterId,
        origin: origins[0] ? origins[0].gameId : null,
        detail: 'productive=' + info.productive + ' min=' + expected
          + (info.routes ? ' routes=' + info.routes.map((route) => route.routeId + ':' + (route.satisfiable ? 'ok' : 'no')).join(',') : ''),
      });
    }
  });

  /* 单游戏硬锁：去掉任一游戏后，C1–C4 每章仍有可达路线（使用首起源章前快照）。 */
  const deadlocks = [];
  let singleGameChecks = 0;
  if (representative) {
    const games = sortedUnique(engine.commissions.map((commission) => commission.gameId));
    const snapshots = new Map();
    representative.segments.forEach((segment) => {
      if (segment.chapterId !== CONTRACT.finale) snapshots.set(segment.chapterId, segment.snapshot);
    });
    ['C1', 'C2', 'C3', 'C4'].forEach((chapterId) => {
      const chapter = chapterMap.get(chapterId);
      const snapshot = snapshots.get(chapterId);
      if (!chapter || !snapshot) return;
      games.forEach((gameId) => {
        singleGameChecks += 1;
        const excludedEngine = createEngine(Object.assign({}, pack, { excludeGames: [gameId] }));
        const routes = productiveRoutes(chapter);
        let reachable = false;
        let lastDetail = '';
        for (const route of routes) {
          const state = stateFromSnapshot(excludedEngine, snapshot);
          const requirement = excludedEngine.satisfyRoute(state, route);
          if (!requirement.ok) {
            lastDetail = requirement.reason;
            continue;
          }
          let flagsOk = true;
          for (const flag of route.rewardFlags || []) {
            if (excludedEngine.storyRuleFlags.has(flag)) {
              const ensured = excludedEngine.ensureStoryFlag(state, flag, 0);
              if (!ensured.ok) {
                flagsOk = false;
                lastDetail = 'flag:' + ensured.reason;
              }
            } else {
              state.routeFlags.add(flag);
            }
          }
          excludedEngine.refresh(state);
          if (flagsOk && (route.rewardFlags || []).every((flag) => state.flags.has(flag))) {
            reachable = true;
            break;
          }
        }
        if (!reachable) {
          deadlocks.push({ id: 'single-game-lock', chapter: chapterId, game: gameId, detail: lastDetail });
        }
      });
    });
    /* 静态：每章路线引用到的游戏集合必须 ≥2（单游戏硬锁的静态镜像）。 */
    ['C1', 'C2', 'C3', 'C4'].forEach((chapterId) => {
      const chapter = chapterMap.get(chapterId);
      if (!chapter) return;
      const games = new Set();
      productiveRoutes(chapter).forEach((route) => {
        engine.classifyRoute(route).games.forEach((gameId) => games.add(gameId));
      });
      if (games.size < 2) {
        deadlocks.push({ id: 'single-game-lock', chapter: chapterId, game: [...games][0] || null, detail: 'static-route-games<2' });
      }
    });
  }

  /* T6 先于 ending：每条路径在 C4 完成、ending 未落库时，任一 T6 都必须不可接。 */
  const tierOrderFailures = [];
  paths.forEach((path) => {
    if (!path.preEndingSnapshot) return;
    const preState = stateFromSnapshot(engine, path.preEndingSnapshot);
    ORIGINS.forEach((origin) => {
      const t6 = engine.byId.get(origin.gameId + '.T6');
      if (!t6) return;
      const unlocked = engine.commissionUnlockResult(preState, t6);
      if (unlocked.ok) {
        tierOrderFailures.push({ id: 't6-before-ending', origin: path.origin.gameId, chapter: CONTRACT.finale, detail: 'T6 open before ending settle' });
      }
    });
  });

  return {
    ok: failures.length === 0 && deadlocks.length === 0 && tierOrderFailures.length === 0,
    paths: paths,
    failures: failures.concat(deadlocks).concat(tierOrderFailures),
    alternatives: alternatives,
    representative: representative,
    engine: engine,
    chapterMap: chapterMap,
    stats: {
      singleGameChecks: singleGameChecks,
      t6PreEndingChecks: paths.length * ORIGINS.length,
      deadlockCount: deadlocks.length,
    },
  };
}

/* ------------------------------------------------------------------ *
 * 静态内容契约检查（campaign-core validate 的测试侧镜像）
 * ------------------------------------------------------------------ */

function staticContentChecks() {
  /* 1. 章节结构。 */
  check('content:campaign-chapter-count', campaignChapters.length === CONTRACT.chapterIds.length,
    'campaign chapters=' + campaignChapters.length);
  check('content:campaign-chapter-order', campaignChapters.every((chapter, index) => chapter.chapterId === CONTRACT.chapterIds[index]),
    campaignChapters.map((chapter) => chapter.chapterId).join(','));
  campaignChapters.forEach((chapter, index) => {
    check('content:chapter-entry:' + chapter.chapterId, isObject(chapter.entry) && (chapter.entry.allFlags || []).length === (index === 0 ? 0 : 1),
      JSON.stringify(chapter.entry || null));
    const expectedHandoff = index < CONTRACT.chapterIds.length - 1 ? CONTRACT.chapterIds[index + 1] : 'EPILOGUE';
    check('content:chapter-handoff:' + chapter.chapterId, chapter.handoff === expectedHandoff,
      'handoff=' + chapter.handoff + ' expected=' + expectedHandoff);
    check('content:chapter-must-know:' + chapter.chapterId, Array.isArray(chapter.mustKnow) && chapter.mustKnow.length > 0,
      'mustKnow=' + (chapter.mustKnow || []).length);
    check('content:chapter-fallback:' + chapter.chapterId, typeof chapter.fallback === 'string' && chapter.fallback.length > 0,
      'fallback');
  });
  /* 章节入口 = 上一章奖励旗标（C0 除外，C1 入口 = C0 路线旗标）。 */
  campaignChapters.forEach((chapter, index) => {
    if (index === 0) return;
    const previous = campaignChapters[index - 1];
    const previousRewards = new Set();
    (previous.routes || []).forEach((route) => (route.rewardFlags || []).forEach((flag) => previousRewards.add(flag)));
    const entryFlags = (chapter.entry && chapter.entry.allFlags) || [];
    check('content:chain-entry:' + chapter.chapterId, entryFlags.length > 0 && entryFlags.every((flag) => previousRewards.has(flag)),
      'entry=' + entryFlags.join(',') + ' prevRewards=' + [...previousRewards].sort().join(','));
  });

  /* 2. 路线：键、产出、单游戏依赖性、替代数量。 */
  const minRoutes = (campaignCore && campaignCore.MIN_ROUTES) || CONTRACT.minRoutes;
  campaignChapters.forEach((chapter) => {
    const routeList = chapter.routes || [];
    if (chapter.chapterId === CONTRACT.finale) {
      check('content:routes-count:' + chapter.chapterId, (campaignEndings || []).length >= (minRoutes[chapter.chapterId] || 1),
        'C5 routes carried by endings=' + campaignEndings.length + ' min=' + (minRoutes[chapter.chapterId] || 1));
      return;
    }
    check('content:routes-count:' + chapter.chapterId, routeList.length >= (minRoutes[chapter.chapterId] || 1),
      'declared=' + routeList.length + ' min=' + (minRoutes[chapter.chapterId] || 1));
    const productive = productiveRoutes(chapter);
    if (chapter.chapterId !== CONTRACT.finale) {
      check('content:productive-routes:' + chapter.chapterId, productive.length >= (minRoutes[chapter.chapterId] || 1),
        'productive=' + productive.length + ' min=' + (minRoutes[chapter.chapterId] || 1));
    }
    routeList.forEach((route) => {
      const requirement = route.requires || {};
      const unknown = Object.keys(requirement).filter((key) => CONTRACT.routeRequirementKeys.indexOf(key) < 0);
      check('content:route-keys:' + chapter.chapterId + ':' + route.routeId, unknown.length === 0,
        unknown.join(','));
      if (chapter.chapterId !== CONTRACT.finale) {
        const chapterFlag = CONTRACT.chapterFlags[chapter.chapterId];
        check('content:route-reward:' + chapter.chapterId + ':' + route.routeId,
          (route.rewardFlags || []).indexOf(chapterFlag) >= 0 && (route.rewardFlags || []).length > 0,
          'rewardFlags=' + (route.rewardFlags || []).join(','));
      }
      if (routeSelfReferential(chapter, route)) {
        warn('route-self-reference', chapter.chapterId + '/' + route.routeId + ' 要求自己授予的本章旗标，只作为完成后确认路径');
      }
    });
    /* 单游戏硬锁的静态镜像：所有“有产出”路线引用的游戏并集必须 ≥2。 */
    if (['C1', 'C2', 'C3', 'C4'].indexOf(chapter.chapterId) >= 0) {
      const games = new Set();
      productive.forEach((route) => {
        const info = (createEngine({ commissions: COMMISSIONS, items: itemsContent })).classifyRoute(route);
        info.games.forEach((gameId) => games.add(gameId));
      });
      check('content:chapter-game-coverage:' + chapter.chapterId, games.size >= 2,
        'games=' + [...games].sort().join(',') + '（单一游戏硬锁）');
    }
  });
  /* 每章奖励旗标一致。 */
  campaignChapters.forEach((chapter) => {
    const sets = (chapter.routes || []).map((route) => sortedUnique(route.rewardFlags || []).join(','));
    check('content:chapter-reward-consistent:' + chapter.chapterId, sets.every((value) => value === sets[0]),
      sets.join(' | '));
  });

  /* 3. 三终局：数量 / 内容文件 / 入口 / 旗标 / 经济等价。 */
  check('content:ending-count', campaignEndings.length === CONTRACT.endingApproaches.length, 'endings=' + campaignEndings.length);
  check('content:ending-approaches',
    setEquals(campaignEndings.map((ending) => ending.approach), CONTRACT.endingApproaches),
    campaignEndings.map((ending) => ending.approach).join(','));
  campaignEndings.forEach((ending) => {
    const content = ENDING_CONTENT_BY_APPROACH.get(ending.approach);
    check('content:ending-file:' + ending.approach, !!content, 'ending-' + ending.approach + '.json');
    if (!content) return;
    check('content:ending-game:' + ending.approach,
      typeof content.gameId === 'string' && !!GAME_BY_ID.get(content.gameId) && !!GAME_IDS.includes(content.gameId),
      'gameId=' + content.gameId);
    check('content:ending-objective:' + ending.approach, isObject(content.objective) && typeof content.objective.kind === 'string',
      'objective=' + JSON.stringify(content.objective || null));
    check('content:ending-economy:' + ending.approach,
      (content.repeatSalaryCredits === 0 || content.repeatSalaryCredits === undefined)
      && !content.credits && !content.items && !content.reward,
      'repeatSalaryCredits=' + content.repeatSalaryCredits);
    check('content:ending-c4-entry:' + ending.approach,
      (ending.entry && (ending.entry.allFlags || [])).indexOf(CONTRACT.chapterFlags.C4) >= 0,
      JSON.stringify(ending.entry || null));
    check('content:ending-flags:' + ending.approach,
      setEquals(ending.flags || [], content.flags || []) && (ending.flags || []).indexOf('ending.' + ending.approach) >= 0
      && (ending.flags || []).indexOf(CONTRACT.chapterFlags.C5) >= 0,
      'campaign=' + (ending.flags || []).join(',') + ' file=' + (content.flags || []).join(','));
    check('content:ending-commission-id:' + ending.approach,
      typeof content.commissionId === 'string' && content.commissionId.indexOf('ending.') === 0 && !BY_ID.has(content.commissionId),
      'commissionId=' + content.commissionId);
    check('content:ending-start-params:' + ending.approach,
      isObject(content.startParams) && Object.keys(content.startParams).every((key) => ['startLevel', 'themeId', 'seed', 'mode'].indexOf(key) >= 0),
      JSON.stringify(content.startParams || {}));
  });
  /* 三终局不得混入 96 告示板；C5 旗标只能由 ending 内容授予。 */
  COMMISSIONS.forEach((commission) => {
    check('content:commission-no-c5:' + commission.commissionId,
      ((commission.reward && commission.reward.flags) || []).every((flag) => flag.indexOf('C5.') !== 0 && flag.indexOf('ending.') !== 0),
      ((commission.reward && commission.reward.flags) || []).join(','));
    check('content:commission-no-story-flag:' + commission.commissionId,
      ((commission.reward && commission.reward.flags) || []).every((flag) => !/^C[234]\./.test(flag)),
      ((commission.reward && commission.reward.flags) || []).join(','));
  });

  /* 4. 后日常：base + 三条差异文本。 */
  const epilogue = campaign.epilogue || {};
  check('content:epilogue-base', typeof epilogue.base === 'string' && epilogue.base.length > 0, 'base');
  const epilogueTexts = CONTRACT.endingApproaches.map((approach) => epilogue[approach]);
  check('content:epilogue-approaches', epilogueTexts.every((text) => typeof text === 'string' && text.length > 0),
    epilogueTexts.join(' | '));
  check('content:epilogue-distinct', new Set(epilogueTexts).size === epilogueTexts.length, epilogueTexts.join(' | '));

  /* 5. 96 委托结构：每游戏 6 阶、T4/T5/T6 受控剧情门禁、解锁链、无资源成本。 */
  check('content:commission-total', COMMISSIONS.length === GAME_IDS.length * 6 && COMMISSIONS.length > 0,
    'commissions=' + COMMISSIONS.length + ' games=' + GAME_IDS.length);
  check('content:commission-games', GAME_IDS.length >= ORIGIN_COUNT, 'games=' + GAME_IDS.length + ' origins=' + ORIGIN_COUNT);
  check('content:commission-professions', PROFESSION_IDS.length === GAME_IDS.length, 'professions=' + PROFESSION_IDS.length);
  check('content:origin-count', ORIGIN_COUNT === GAME_IDS.length && ORIGIN_COUNT === ((registryContent.games || []).length),
    'origins=' + ORIGIN_COUNT + ' games=' + GAME_IDS.length + ' registry=' + ((registryContent.games || []).length));
  check('content:origin-pairs', ORIGINS.every((origin) => {
    const commission = COMMISSIONS.find((item) => item.gameId === origin.gameId);
    return !!commission && commission.professionId === origin.professionId && !!GAME_BY_ID.get(origin.gameId);
  }), 'chapter-01.origins 与 96 委托的 (gameId, professionId) 不一致');

  const perGameTiers = countBy(COMMISSIONS, (commission) => commission.gameId);
  GAME_IDS.forEach((gameId) => {
    check('content:tiers-per-game:' + gameId, perGameTiers.get(gameId) === 6, 'tiers=' + perGameTiers.get(gameId));
    for (let tier = 1; tier <= 6; tier += 1) {
      const commission = BY_ID.get(gameId + '.T' + tier);
      check('content:tier-exists:' + gameId + '.T' + tier, !!commission, 'missing');
      if (!commission) continue;
      check('content:tier-gate:' + commission.commissionId,
        ((commission.chapterGate || null) === (CONTRACT.tierGates[tier] || null)),
        'chapterGate=' + commission.chapterGate + ' expected=' + (CONTRACT.tierGates[tier] || 'null'));
      check('content:tier-unlock:' + commission.commissionId,
        !CONTRACT.tierGates[tier] || JSON.stringify(commission.unlock || {}).indexOf(CONTRACT.tierGates[tier]) >= 0,
        JSON.stringify(commission.unlock || {}));
      if (tier > 1) {
        check('content:tier-chain:' + commission.commissionId,
          JSON.stringify(commission.unlock || {}).indexOf(gameId + '.T' + (tier - 1)) >= 0,
          JSON.stringify(commission.unlock || {}));
      } else {
        check('content:tier1-open:' + commission.commissionId, (commission.unlock && commission.unlock.all || []).length === 0,
          JSON.stringify(commission.unlock || {}));
      }
      check('content:tier-no-cost:' + commission.commissionId,
        isObject(commission.startParams)
        && Object.keys(commission.startParams).every((key) => ['startLevel', 'themeId', 'seed', 'mode', 'modeId'].indexOf(key) >= 0)
        && JSON.stringify(commission.startParams).indexOf('"credits"') < 0
        && JSON.stringify(commission.startParams).indexOf('"items"') < 0
        && JSON.stringify(commission.startParams).indexOf('"cost"') < 0,
        JSON.stringify(commission.startParams || {}));
      check('content:tier-no-item-unlock:' + commission.commissionId,
        JSON.stringify(commission.unlock || {}).indexOf('"item"') < 0 && JSON.stringify(commission.unlock || {}).indexOf('"credits"') < 0,
        JSON.stringify(commission.unlock || {}));
    }
  });
  /* T6 不得只靠 C4 打开：受控旗标下 C4（T1–T5 已清）必须仍锁定，C5 后才接。 */
  COMMISSIONS.filter((commission) => commission.tier === 6).forEach((commission) => {
    check('content:t6-requires-c5:' + commission.commissionId,
      JSON.stringify(commission.unlock || {}).indexOf(CONTRACT.chapterFlags.C5) >= 0,
      JSON.stringify(commission.unlock || {}));
    const flagsC4 = new Set(['C1.signal_fragment', 'C2.research_complete', 'C3.truth_found', CONTRACT.chapterFlags.C4]);
    const clearedT5 = new Set([commission.gameId + '.T1', commission.gameId + '.T2', commission.gameId + '.T3', commission.gameId + '.T4', commission.gameId + '.T5']);
    check('content:t6-not-c4:' + commission.commissionId, !controlledUnlock(commission, flagsC4, clearedT5),
      'T6 只凭 C4 + T5 就会打开：' + JSON.stringify(commission.unlock || {}));
  });

  /* 6. 章节叙述文件 / npc / side-stories / clues。 */
  chapterFiles.forEach((file, index) => {
    const chapterId = CONTRACT.chapterIds[index];
    check('content:chapter-file:' + chapterId, !!file, 'chapter-0' + index + '.json');
    if (!file) return;
    check('content:chapter-file-id:' + chapterId, file.chapterId === chapterId, 'file chapterId=' + file.chapterId);
    if (typeof file.body === 'string' && file.body.length > 0) {
      check('content:chapter-file-body:' + chapterId, true, 'body');
    } else {
      warn('chapter-file-body-missing:' + chapterId, '章节文件缺少 body（chapter-01 仍为 0.17 起源内容格式）；campaign-core 也会给出内容 warning');
    }
    if (file.contentVersion !== '0.18.0') {
      warn('chapter-file-version:' + chapterId, '章节文件 contentVersion=' + file.contentVersion + '（0.18 内容版本应为 0.18.0；campaign-core 也会给出 warning）');
    }
  });
  const chapterFileTitles = new Map(chapterFiles.filter(Boolean).map((file) => [file.chapterId, file.title]));
  campaignChapters.forEach((chapter) => {
    const title = chapterFileTitles.get(chapter.chapterId);
    if (title !== undefined && title !== chapter.title) {
      warn('chapter-title-mismatch:' + chapter.chapterId, 'campaign=' + chapter.title + ' file=' + title + '（campaign-core 也会给出 warning）');
    }
  });
  const npcCharacters = (npcContent && npcContent.characters) || [];
  check('content:npc-characters', npcCharacters.length > 0, 'characters=' + npcCharacters.length);
  CONTRACT.chapterIds.forEach((chapterId) => {
    const hasReply = npcCharacters.some((character) => (character.replies || []).some((reply) => reply.chapterId === chapterId && typeof reply.text === 'string' && reply.text.length > 0));
    check('content:npc-reply:' + chapterId, hasReply, 'chapter=' + chapterId);
  });
  const families = (sideStoriesContent && sideStoriesContent.families) || [];
  check('content:side-stories-families', families.length > 0, 'families=' + families.length);
  const sideLinks = [];
  families.forEach((family) => {
    check('content:side-story-text:' + family.familyId, typeof family.text === 'string' && family.text.length > 0, 'text');
    (family.links || []).forEach((link) => sideLinks.push(link));
  });
  check('content:side-stories-resource-neutral',
    JSON.stringify(sideStoriesContent).indexOf('"evidence"') < 0 && JSON.stringify(sideStoriesContent).indexOf('"flags"') < 0
    && JSON.stringify(sideStoriesContent).indexOf('"items"') < 0 && JSON.stringify(sideStoriesContent).indexOf('"credits"') < 0
    && JSON.stringify(sideStoriesContent).indexOf('commissionId') < 0,
    'side-stories 不得声明证据 / 旗标 / 物品 / 信用点 / 委托');
  const unresolvedLinks = sideLinks.filter((link) => CLUE_IDS.indexOf(link) < 0);
  if (unresolvedLinks.length) {
    warn('side-stories-unresolved-links', 'side-stories 引用了 clues.json 中不存在的线索 ID：' + sortedUnique(unresolvedLinks).join(','));
  }
  if (families.length !== 5) {
    warn('side-stories-family-count', 'ADR §20.1 提到 5 个线索家族，内容为 ' + families.length + ' 个');
  }
  /* 路线不得引用 side-stories 的 familyId（避免支线成为唯一必需资源）。 */
  const familyIds = families.map((family) => family.familyId);
  const campaignText = JSON.stringify(campaign);
  check('content:side-stories-not-required', familyIds.every((familyId) => campaignText.indexOf(familyId) < 0),
    'campaign 引用了 side-stories familyId');
}

/* ------------------------------------------------------------------ *
 * 受控 T4–T6 顺序（故事旗标 fixture，不使用真实证据推导）
 * ------------------------------------------------------------------ */

function controlledUnlock(commission, flags, cleared) {
  const gate = commission.chapterGate;
  if (gate && !flags.has(gate)) return false;
  const result = evalRequirement(commission.unlock || { all: [] }, emptyContext({ flags: flags, cleared: cleared }));
  return result.ok;
}

function tierOrderingChecks() {
  let passOrigins = 0;
  const failures = [];
  ORIGINS.forEach((origin) => {
    const t1 = origin.gameId + '.T1';
    const t2 = origin.gameId + '.T2';
    const t3 = origin.gameId + '.T3';
    const t4 = origin.gameId + '.T4';
    const t5 = origin.gameId + '.T5';
    const t6 = origin.gameId + '.T6';
    const commissions = [t1, t2, t3, t4, t5, t6].map((id) => BY_ID.get(id));
    if (commissions.some((commission) => !commission)) {
      failures.push({ origin: origin.gameId, detail: 'T1–T6 内容缺失' });
      return;
    }
    const flags = new Set(['C2.research_complete']);
    const cleared = new Set([t1, t2, t3]);
    const steps = [];
    steps.push(['T4 blocked before C3', !controlledUnlock(commissions[3], flags, cleared)]);
    flags.add('C3.truth_found');
    steps.push(['T4 open after C3', controlledUnlock(commissions[3], flags, cleared)]);
    cleared.add(t4);
    steps.push(['T5 blocked before C4', !controlledUnlock(commissions[4], flags, cleared)]);
    flags.add('C4.city_power_restored');
    steps.push(['T5 open after C4', controlledUnlock(commissions[4], flags, cleared)]);
    cleared.add(t5);
    steps.push(['T6 blocked before C5', !controlledUnlock(commissions[5], flags, cleared)]);
    /* 只有 C5 但未清 T5：仍不可接（必须 T5→T6 链）。 */
    const flagsC5Only = new Set(flags);
    flagsC5Only.add('C5.star_tower_resolved');
    steps.push(['T6 blocked without T5', !controlledUnlock(commissions[5], flagsC5Only, new Set([t1, t2, t3, t4]))]);
    flags.add('C5.star_tower_resolved');
    steps.push(['T6 open after ending C5', controlledUnlock(commissions[5], flags, cleared)]);
    /* T6 的 chapterGate 与 unlock 都必须指向 C5。 */
    steps.push(['T6 metadata gate C5', commissions[5].chapterGate === 'C5.star_tower_resolved']);
    const bad = steps.filter((item) => !item[1]);
    if (bad.length) failures.push({ origin: origin.gameId, detail: bad.map((item) => item[0]).join(';') });
    else passOrigins += 1;
  });
  check('tier-order:origins', failures.length === 0, failures.map((item) => item.origin + ':' + item.detail).join(' | '));
  check('tier-order:count', passOrigins === ORIGIN_COUNT, passOrigins + '/' + ORIGIN_COUNT);
  return { passOrigins: passOrigins, failures: failures };
}

/* ------------------------------------------------------------------ *
 * campaign-core 交叉验证（真实运行时）
 * ------------------------------------------------------------------ */

async function campaignCoreChecks(analysis) {
  if (!campaignCore) {
    check('campaign-core:module', false, 'apps/arcade/career/campaign-core.js 缺失', 'gap');
    return;
  }
  check('campaign-core:module', true, 'loaded');
  const configure = campaignCore.configure;
  check('campaign-core:api', typeof configure === 'function' && typeof campaignCore.state === 'function'
    && typeof campaignCore.validate === 'function' && typeof campaignCore.routeRequirementsMet === 'function',
    'configure/state/validate/routeRequirementsMet');
  if (typeof configure !== 'function') return;

  const configured = configure({
    campaign: deepClone(campaign),
    chapters: chapterFiles.filter(Boolean).map((file) => deepClone(file)),
    npc: deepClone(npcContent),
    sideStories: deepClone(sideStoriesContent),
    commissions: { commissions: deepClone(COMMISSIONS) },
    evidence: storyEvidenceModule,
    items: deepClone(itemsContent),
  });
  check('campaign-core:configure', configured && configured.ok === true,
    'ok=' + (configured && configured.ok) + ' errors=' + JSON.stringify((configured && configured.errors) || []));
  check('campaign-core:configure-counts', configured && configured.chapterCount === CONTRACT.chapterIds.length && configured.endingCount === ENDING_COUNT,
    'chapters=' + (configured && configured.chapterCount) + ' endings=' + (configured && configured.endingCount));
  if (configured && Array.isArray(configured.warnings)) {
    configured.warnings.forEach((warning) => {
      warn('campaign-core-warning:' + (warning && warning.code ? warning.code : 'unknown'),
        (warning && warning.chapterId ? warning.chapterId + ' ' : '') + (warning && warning.message ? warning.message : ''));
    });
  }

  const validation = campaignCore.validate();
  check('campaign-core:validate', validation && validation.ok === true,
    'errors=' + JSON.stringify((validation && validation.errors) || []));
  check('campaign-core:origins',
    validation && Array.isArray(validation.origins) && setEquals(validation.origins, ORIGINS.map((origin) => origin.gameId)),
    'core origins=' + ((validation && validation.origins) || []).length + ' content origins=' + ORIGIN_COUNT);
  if (validation && validation.alternatives) {
    CONTRACT.chapterIds.forEach((chapterId) => {
      const min = ((campaignCore.MIN_ROUTES && campaignCore.MIN_ROUTES[chapterId]) || CONTRACT.minRoutes[chapterId] || 1);
      check('campaign-core:alternatives:' + chapterId, Number(validation.alternatives[chapterId]) >= min,
        'core=' + validation.alternatives[chapterId] + ' min=' + min);
    });
  }
  if (validation && Array.isArray(validation.warnings)) {
    validation.warnings.forEach((warning) => {
      warn('campaign-core-validate-warning:' + (warning && warning.code ? warning.code : 'unknown'),
        (warning && warning.chapterId ? warning.chapterId + ' ' : '') + (warning && warning.message ? warning.message : ''));
    });
  }

  /* routeRequirementsMet 与测试侧求值器逐条对齐（入口 / C4 完成两种上下文）。 */
  const representative = analysis.representative;
  if (representative) {
    let compared = 0;
    let mismatched = 0;
    representative.segments.forEach((segment) => {
      const chapter = campaignChapterById.get(segment.chapterId);
      if (!chapter) return;
      const state = stateFromSnapshot(analysis.engine, segment.snapshot);
      const ctx = {
        flags: new Set(state.flags),
        cleared: new Set(state.cleared),
        evidence: new Set(state.evidence),
        items: new Map(),
        credits: 0,
      };
      const routeList = chapter.routes || [];
      routeList.forEach((route) => {
        const expected = evalRequirement(route.requires || {}, ctx).ok;
        const actual = campaignCore.routeRequirementsMet(route, ctx) === true;
        compared += 1;
        if (expected !== actual) mismatched += 1;
      });
      const entryExpected = evalRequirement(chapter.entry || {}, ctx).ok;
      const entryActual = campaignCore.routeRequirementsMet(chapter.entry || {}, ctx) === true;
      compared += 1;
      if (entryExpected !== entryActual) mismatched += 1;
    });
    check('campaign-core:route-requirements-met', compared > 0 && mismatched === 0,
      'compared=' + compared + ' mismatched=' + mismatched);
  }

  /* state()：章节状态 / 终局可选性随受控快照推进。 */
  let stateChecks = 0;
  let stateMismatched = 0;
  let endingsChecked = 0;
  const assertStatus = (id, ok, detail) => {
    stateChecks += 1;
    if (!ok) {
      stateMismatched += 1;
      check('campaign-core:state:' + id, false, detail);
    }
  };
  if (representative) {
    representative.segments.forEach((segment, index) => {
      const input = coreInputFromSnapshot(analysis.engine, segment.snapshot);
      const result = campaignCore.state(input);
      if (!result || result.ok !== true || !Array.isArray(result.chapters)) {
        stateChecks += 1;
        stateMismatched += 1;
        check('campaign-core:state:' + segment.chapterId, false, 'state ok=' + (result && result.ok));
        return;
      }
      const completed = result.chapters.filter((chapter) => chapter.state === 'complete').map((chapter) => chapter.chapterId);
      const expectedCompleted = CONTRACT.chapterIds.slice(0, index + 1);
      assertStatus(segment.chapterId + '-completed',
        setEquals(completed, expectedCompleted),
        'completed=' + completed.join(',') + ' expected=' + expectedCompleted.join(','));
      const current = result.chapters.find((chapter) => chapter.chapterId === segment.chapterId);
      assertStatus(segment.chapterId + '-state', current && current.state === 'complete',
        'chapter=' + segment.chapterId + ' state=' + (current && current.state));
      if (index < CONTRACT.chapterIds.length - 1) {
        const next = result.chapters[index + 1];
        assertStatus(segment.chapterId + '-next', next && (next.state === 'available' || next.state === 'active'),
          'next=' + (next && next.chapterId) + ':' + (next && next.state));
      }
      if (index < CONTRACT.chapterIds.length - 1 && segment.chapterId !== 'C4') {
        const endings = Array.isArray(result.endings) ? result.endings : [];
        assertStatus(segment.chapterId + '-endings-locked', endings.every((ending) => ending.available === false),
          'endings available before C4: ' + endings.filter((ending) => ending.available).map((ending) => ending.approach).join(','));
        endingsChecked += 1;
      }
      if (segment.chapterId === 'C4') {
        const endings = Array.isArray(result.endings) ? result.endings : [];
        assertStatus('C4-endings-open', endings.length === ENDING_COUNT && endings.every((ending) => ending.available === true),
          'endings available=' + endings.filter((ending) => ending.available).map((ending) => ending.approach).join(','));
        endingsChecked += 1;
      }
      if (segment.chapterId === CONTRACT.finale) {
        assertStatus('C5-ending-chosen', result.endingChosen === representative.approach,
          'endingChosen=' + result.endingChosen + ' expected=' + representative.approach);
        assertStatus('C5-epilogue', isObject(result.epilogue) && typeof result.epilogue.text === 'string' && result.epilogue.text.length > 0,
          JSON.stringify(result.epilogue || null));
        const endings = Array.isArray(result.endings) ? result.endings : [];
        assertStatus('C5-single-ending', endings.filter((ending) => ending.chosen).length === 1,
          'chosen=' + endings.filter((ending) => ending.chosen).map((ending) => ending.approach).join(','));
      }
    });
  }
  check('campaign-core:state-transitions', stateChecks > 0 && stateMismatched === 0,
    'checks=' + stateChecks + ' mismatched=' + stateMismatched);

  /* endingOptions / epilogueFor 形状。 */
  if (typeof campaignCore.endingOptions === 'function') {
    const c4Snapshot = representative && representative.segments.find((segment) => segment.chapterId === 'C4');
    if (c4Snapshot) {
      const options = campaignCore.endingOptions(coreInputFromSnapshot(analysis.engine, c4Snapshot.snapshot));
      check('campaign-core:ending-options', Array.isArray(options) && options.length === ENDING_COUNT
        && options.every((option) => option.available === true),
        'options=' + JSON.stringify((options || []).map((option) => option.approach + ':' + option.available)));
    }
  }
  if (typeof campaignCore.epilogueFor === 'function') {
    const texts = CONTRACT.endingApproaches.map((approach) => campaignCore.epilogueFor(approach));
    check('campaign-core:epilogue', texts.every((item) => item && item.ok === true && typeof item.text === 'string' && item.text.length > 0),
      texts.map((item) => (item && item.approach) + ':' + (item && item.ok)).join(' | '));
    const distinct = new Set(texts.map((item) => (item && item.text) || ''));
    check('campaign-core:epilogue-distinct', distinct.size === CONTRACT.endingApproaches.length, 'distinct=' + distinct.size);
  }
}

function coreInputFromSnapshot(engine, snapshot) {
  const state = stateFromSnapshot(engine, snapshot);
  const flags = sortedUnique([...state.flags]);
  const evidence = sortedUnique([...state.evidence]);
  const quests = state.claims.map((row) => ({
    careerId: 'career-d18-13-sim',
    nodeId: row.commissionId,
    commissionId: row.commissionId,
    kind: 'commission',
    status: 'cleared',
    flags: row.flags.slice(),
    evidence: row.evidence.slice(),
  }));
  flags.forEach((flag) => {
    quests.push({
      careerId: 'career-d18-13-sim',
      nodeId: 'story:' + flag,
      kind: 'story-flag',
      status: 'cleared',
      flags: [flag],
    });
  });
  evidence.forEach((token) => {
    quests.push({
      careerId: 'career-d18-13-sim',
      nodeId: 'evidence:' + token,
      kind: 'evidence',
      status: 'cleared',
      evidence: [token],
      token: token,
    });
  });
  return {
    quests: quests,
    claims: state.claims.map((row) => deepClone(row)),
    profile: { careerId: 'career-d18-13-sim', flags: flags.slice(), evidence: evidence.slice(), capabilities: [] },
    wallet: { credits: 0, items: {} },
  };
}

/* ------------------------------------------------------------------ *
 * ending-reducer 交叉验证（只读 / 配置面；结算幂等由 D18-09 测试覆盖）
 * ------------------------------------------------------------------ */

async function endingReducerChecks() {
  if (!endingReducer) {
    check('ending-reducer:module', false, 'apps/arcade/career/ending-reducer.js 缺失', 'gap');
    return;
  }
  check('ending-reducer:module', true, 'loaded');
  const required = ['configure', 'canStart', 'endingOf', 'epilogueFor', 'startEnding', 'settleEnding'];
  const missing = required.filter((name) => typeof endingReducer[name] !== 'function');
  check('ending-reducer:api', missing.length === 0, 'missing=' + missing.join(','));
  if (typeof endingReducer.configure !== 'function') return;

  const configured = endingReducer.configure({
    endings: endingFiles.filter(Boolean).map((ending) => deepClone(ending)),
    campaign: deepClone(campaign),
  });
  check('ending-reducer:configure', configured && configured.ok === true,
    'ok=' + (configured && configured.ok) + ' errors=' + JSON.stringify((configured && configured.errors) || []));
  check('ending-reducer:configure-count', configured && configured.count === ENDING_COUNT, 'count=' + (configured && configured.count));

  const views = (configured && configured.endings) || [];
  check('ending-reducer:views', views.length === ENDING_COUNT, 'views=' + views.length);
  views.forEach((view) => {
    check('ending-reducer:row:' + view.approach, isObject(view.row), 'row');
    if (!isObject(view.row)) return;
    const row = view.row;
    check('ending-reducer:row-c4:' + view.approach,
      JSON.stringify(row.unlock || {}).indexOf(CONTRACT.chapterFlags.C4) >= 0,
      JSON.stringify(row.unlock || {}));
    check('ending-reducer:row-flags:' + view.approach,
      ((row.reward && row.reward.flags) || []).indexOf(CONTRACT.chapterFlags.C5) >= 0
      && ((row.reward && row.reward.flags) || []).indexOf('ending.' + view.approach) >= 0,
      ((row.reward && row.reward.flags) || []).join(','));
    check('ending-reducer:row-economy:' + view.approach,
      (!row.reward || Number(row.reward.credits) === 0) && Number(row.repeatSalaryCredits) === 0,
      'credits=' + (row.reward && row.reward.credits) + ' repeat=' + row.repeatSalaryCredits);
    check('ending-reducer:row-board-isolation:' + view.approach,
      typeof row.commissionId === 'string' && row.commissionId.indexOf('ending.') === 0 && !BY_ID.has(row.commissionId),
      'commissionId=' + row.commissionId);
  });

  /* canStart：C4 前锁定、C4 后三选一、已选后其余不可选。 */
  const lockedFlags = ['C3.truth_found'];
  const openFlags = ['C1.signal_fragment', 'C2.research_complete', 'C3.truth_found', CONTRACT.chapterFlags.C4];
  const lockedResults = CONTRACT.endingApproaches.map((approach) => endingReducer.canStart(approach, { flags: lockedFlags }));
  check('ending-reducer:can-start-before-c4', lockedResults.every((result) => result && result.available === false && result.missingFlag === CONTRACT.chapterFlags.C4),
    JSON.stringify(lockedResults.map((result) => result && result.available)));
  const openResults = CONTRACT.endingApproaches.map((approach) => endingReducer.canStart(approach, { flags: openFlags }));
  check('ending-reducer:can-start-after-c4', openResults.every((result) => result && result.available === true),
    JSON.stringify(openResults.map((result) => result && result.reason)));
  const chosenFlags = openFlags.concat([CONTRACT.chapterFlags.C5, 'ending.combat']);
  const chosenQuests = [{
    nodeId: 'ending:combat',
    kind: 'ending',
    status: 'cleared',
    resolved: true,
    approach: 'combat',
    flags: [CONTRACT.chapterFlags.C5, 'ending.combat'],
    clearedAt: '2026-11-23T00:00:00.000Z',
  }];
  const chosenResults = CONTRACT.endingApproaches.map((approach) => endingReducer.canStart(approach, { flags: chosenFlags, quests: chosenQuests }));
  check('ending-reducer:single-ending',
    chosenResults.every((result) => result && result.available === false && result.reason === 'already-resolved'
      && (result.resolvedApproach === 'combat' || result.source !== null)),
    JSON.stringify(chosenResults.map((result) => result && (result.available + ':' + result.reason + ':' + result.resolvedApproach))));

  /* endingOf：C5 + ending.<approach> 结局记录行只读推导。 */
  CONTRACT.endingApproaches.forEach((approach) => {
    const quests = [{
      nodeId: 'ending:' + approach,
      kind: 'ending',
      status: 'cleared',
      resolved: true,
      approach: approach,
      flags: [CONTRACT.chapterFlags.C5, 'ending.' + approach],
      clearedAt: '2026-11-23T00:00:00.000Z',
    }];
    const result = endingReducer.endingOf({ quests: quests, claims: [] });
    check('ending-reducer:ending-of:' + approach,
      result && result.ok === true && result.resolved === true && (result.resolvedApproach === approach || result.approach === approach),
      JSON.stringify(result && { resolved: result.resolved, approach: result.approach, resolvedApproach: result.resolvedApproach }));
  });
  /* 孤立 C5 旗标行：resolved=true 但 approach=null，不得冒充任一结局。 */
  const orphan = endingReducer.endingOf({
    quests: [{ nodeId: 'story:' + CONTRACT.chapterFlags.C5, kind: 'story-flag', status: 'cleared', flags: [CONTRACT.chapterFlags.C5] }],
    claims: [],
  });
  check('ending-reducer:orphan-c5', orphan && orphan.ok === true && orphan.resolved === true && (orphan.resolvedApproach === null || orphan.resolvedApproach === undefined),
    JSON.stringify(orphan && { resolved: orphan.resolved, approach: orphan.approach, resolvedApproach: orphan.resolvedApproach }));
  const epilogueTexts = CONTRACT.endingApproaches.map((approach) => endingReducer.epilogueFor(approach));
  check('ending-reducer:epilogue', epilogueTexts.every((item) => item && item.ok === true && typeof (item.text || '') === 'string' && (item.text || '').length > 0),
    epilogueTexts.map((item) => (item && item.approach) + ':' + (item && item.ok)).join(' | '));
  check('ending-reducer:epilogue-distinct', new Set(epilogueTexts.map((item) => (item && item.text) || '')).size === CONTRACT.endingApproaches.length,
    'distinct');

  /* 无 DB 时 startEnding 必须结构化失败（不得抛、不得谎报成功）。 */
  try {
    const started = await endingReducer.startEnding({ approach: 'combat', careerId: 'career-d18-13-nodb' });
    check('ending-reducer:start-without-db', started && started.ok === false,
      JSON.stringify(started));
  } catch (err) {
    check('ending-reducer:start-without-db', false, 'startEnding threw: ' + (err && err.message));
  }
}

/* ------------------------------------------------------------------ *
 * 负例：注入故障后分析必须 FAIL 并指出 origin / chapter
 * ------------------------------------------------------------------ */

function cloneCampaignPack() {
  return {
    campaign: deepClone(campaign),
    campaignChapters: deepClone(campaignChapters),
    commissions: deepClone(COMMISSIONS),
    items: deepClone(itemsContent),
    origins: deepClone(ORIGINS),
    endings: ENDINGS.slice(),
  };
}

function analyzeWithPack(pack) {
  return analyzeContent(pack, { computeAlternatives: false });
}

function negativeExpectation(name, pack, expectedCodes, expectedChapter) {
  const result = analyzeWithPack(pack);
  const matched = (result.failures || []).filter((failure) => {
    const codeOk = expectedCodes.indexOf(failure.id) >= 0;
    const chapterOk = !expectedChapter || failure.chapter === expectedChapter;
    return codeOk && chapterOk;
  });
  const originsMentioned = matched.filter((failure) => typeof failure.origin === 'string' && failure.origin.length > 0);
  check('negative:' + name + ':detected', !result.ok && matched.length > 0,
    'failures=' + JSON.stringify((result.failures || []).slice(0, 4)));
  check('negative:' + name + ':origin-chapter',
    matched.length > 0 && (originsMentioned.length > 0 || expectedCodes.indexOf('chapter-alternatives') >= 0 || expectedCodes.indexOf('tier-order') >= 0),
    'matched=' + JSON.stringify(matched.slice(0, 4)));
  return result;
}

function negativeChecks() {
  /* 1. 删除某章替代路线（C2 只剩 1 条有产出路线）→ 必须 FAIL 并指出 C2。 */
  const pack1 = cloneCampaignPack();
  const c2 = pack1.campaignChapters.find((chapter) => chapter.chapterId === 'C2');
  c2.routes = [deepClone(c2.routes[0])];
  pack1.campaign = Object.assign(deepClone(campaign), { chapters: deepClone(pack1.campaignChapters) });
  negativeExpectation('remove-alternative-route', pack1, ['chapter-alternatives', 'no-route'], 'C2');

  /* 2. 删除必需证据（所有委托不再产出证据）→ C2 旗标不可达，必须 FAIL 并指出 C2。 */
  const pack2 = cloneCampaignPack();
  const commissionsNoEvidence = deepClone(COMMISSIONS).map((commission) => {
    const clone = deepClone(commission);
    if (clone.reward) clone.reward.evidence = [];
    return clone;
  });
  pack2.commissions = commissionsNoEvidence;
  pack2.campaign = deepClone(campaign);
  negativeExpectation('remove-required-evidence', pack2, ['path-unreachable'], 'C2');

  /* 3. 单游戏硬锁：C2 只保留 merge-2048 委托路线，并注入该游戏不可用。 */
  const pack3 = cloneCampaignPack();
  const c2Locked = pack3.campaignChapters.find((chapter) => chapter.chapterId === 'C2');
  c2Locked.routes = [{
    routeId: 'single-game-lock',
    label: '只走一条游戏线',
    requires: { anyCommissions: ['merge-2048.T3'] },
    rewardFlags: ['C2.research_complete'],
    hint: '注入故障：单游戏硬锁',
  }];
  pack3.campaign = Object.assign(deepClone(campaign), { chapters: deepClone(pack3.campaignChapters) });
  pack3.excludeGames = ['merge-2048'];
  negativeExpectation('single-game-hard-lock', pack3, ['single-game-lock', 'chapter-alternatives', 'path-unreachable'], 'C2');

  /* 4. T6 提前到 ending 之前（T6 只要求 C4）→ 受控顺序检查必须 FAIL 并指出 C5。 */
  const pack4 = cloneCampaignPack();
  pack4.commissions = deepClone(COMMISSIONS).map((commission) => {
    const clone = deepClone(commission);
    if (clone.tier === 6) {
      clone.chapterGate = CONTRACT.chapterFlags.C4;
      clone.unlock = {
        all: [
          { commissionCleared: clone.gameId + '.T5' },
          { chapterFlag: CONTRACT.chapterFlags.C4 },
        ],
      };
    }
    return clone;
  });
  const t6Result = tierOrderingForCommissions(pack4.commissions);
  check('negative:t6-before-ending:detected', t6Result.failures.length > 0,
    JSON.stringify(t6Result.failures.slice(0, 4)));
  check('negative:t6-before-ending:chapter', t6Result.failures.some((failure) => failure.chapter === CONTRACT.finale),
    JSON.stringify(t6Result.failures.slice(0, 4)));
}

/* 受控顺序检查的可注入版本（供负例 4 复用）。 */
function tierOrderingForCommissions(commissionsList) {
  const byId = new Map(commissionsList.map((commission) => [commission.commissionId, commission]));
  const failures = [];
  ORIGINS.forEach((origin) => {
    const ids = [1, 2, 3, 4, 5, 6].map((tier) => origin.gameId + '.T' + tier);
    const list = ids.map((id) => byId.get(id));
    if (list.some((commission) => !commission)) {
      failures.push({ origin: origin.gameId, chapter: CONTRACT.finale, detail: 'T1–T6 missing' });
      return;
    }
    const flags = new Set(['C2.research_complete']);
    const cleared = new Set(ids.slice(0, 3));
    const steps = [];
    steps.push(['T4-before-C3', !controlledUnlockFor(list[3], flags, cleared)]);
    flags.add('C3.truth_found');
    steps.push(['T4-after-C3', controlledUnlockFor(list[3], flags, cleared)]);
    cleared.add(ids[3]);
    steps.push(['T5-before-C4', !controlledUnlockFor(list[4], flags, cleared)]);
    flags.add('C4.city_power_restored');
    steps.push(['T5-after-C4', controlledUnlockFor(list[4], flags, cleared)]);
    cleared.add(ids[4]);
    steps.push(['T6-before-C5', !controlledUnlockFor(list[5], flags, cleared)]);
    flags.add('C5.star_tower_resolved');
    steps.push(['T6-after-C5', controlledUnlockFor(list[5], flags, cleared)]);
    const bad = steps.filter((step) => !step[1]);
    if (bad.length) {
      failures.push({ origin: origin.gameId, chapter: CONTRACT.finale, detail: bad.map((step) => step[0]).join(';') });
    }
  });
  return { failures: failures };
}

function controlledUnlockFor(commission, flags, cleared) {
  if (!commission) return false;
  const gate = commission.chapterGate;
  if (gate && !flags.has(gate)) return false;
  const result = evalRequirement(commission.unlock || { all: [] }, emptyContext({ flags: new Set(flags), cleared: new Set(cleared) }));
  return result.ok;
}

/* ------------------------------------------------------------------ *
 * 输出 / 主流程
 * ------------------------------------------------------------------ */

function printHeader() {
  console.log('D18-13 career graph reachability — 16 origins × 3 endings (0.18 星塔回响)');
  console.log('content: campaign=' + campaign.contentVersion
    + ' chapters=' + campaignChapters.length
    + ' endings=' + ENDING_COUNT
    + ' commissions=' + COMMISSIONS.length
    + ' games=' + GAME_IDS.length
    + ' evidenceTokens=' + EVIDENCE_PRODUCERS.size
    + ' origins=' + ORIGIN_COUNT
    + ' sideStories=' + (((sideStoriesContent && sideStoriesContent.families) || []).length)
    + ' npc=' + (((npcContent && npcContent.characters) || []).length));
  console.log('modules: campaign-core=' + (campaignCore ? 'present' : 'MISSING')
    + ' ending-reducer=' + (endingReducer ? 'present' : 'MISSING')
    + ' story-evidence=present');
  console.log('');
}

function formatPath(path) {
  const parts = path.segments.map((segment) => {
    const commissionText = segment.commissions && segment.commissions.length ? '[' + segment.commissions.join(',') + ']' : '';
    return segment.chapterId + ':' + segment.routeId + commissionText;
  });
  return parts.join(' > ');
}

function printPaths(analysis) {
  console.log('[PATH TABLE] origin / ending / steps');
  analysis.paths.forEach((path) => {
    console.log('  ' + path.origin.gameId + '/' + path.origin.professionId
      + ' | ' + path.approach
      + ' | ' + formatPath(path));
  });
  console.log('');
}

function printAlternatives(analysis) {
  console.log('[ALTERNATIVES] 章节 / 声明 route / 有产出 route / 章前可满足 / 类别');
  CONTRACT.chapterIds.forEach((chapterId) => {
    const info = analysis.alternatives[chapterId] || {};
    console.log('  ' + chapterId
      + ' declared=' + (info.declared === undefined ? '-' : info.declared)
      + ' productive=' + (info.productive === undefined ? '-' : info.productive)
      + ' satisfiable=' + (info.satisfiable === undefined ? '-' : info.satisfiable)
      + (info.routes ? ' routes=' + info.routes.map((item) => item.routeId + ':' + (item.satisfiable ? 'ok' : 'no')).join(',') : ''));
  });
  console.log('');
}

function printTierOrder(tierReport) {
  console.log('[TIER ORDER] T4=C3 / T5=C4 / T6=C5(after ending)');
  console.log('  origins passing controlled gates: ' + tierReport.passOrigins + '/' + ORIGIN_COUNT);
  if (tierReport.failures.length) {
    console.log('  failures: ' + JSON.stringify(tierReport.failures));
  }
  console.log('');
}

function finalSummary(analysis, tierReport, negativesPassed, categorySummary) {
  const failChecks = checks.filter((item) => !item.ok && item.severity === 'fail');
  const gapChecks = checks.filter((item) => !item.ok && item.severity === 'gap');
  const passed = checks.filter((item) => item.ok).length;
  const pathCount = ORIGIN_COUNT * ENDING_COUNT;
  const passedPaths = analysis.paths.length;
  const deadlocks = analysis.failures.filter((failure) => failure.id === 'single-game-lock').length;
  const stats = analysis.stats || {};
  console.log('============================================================');
  console.log('PATHS ' + passedPaths + '/' + pathCount + ' (' + ORIGIN_COUNT + ' origins × ' + ENDING_COUNT + ' endings)');
  console.log('ALTERNATIVES '
    + CONTRACT.chapterIds.map((chapterId) => {
      const info = analysis.alternatives[chapterId] || {};
      return chapterId + '=' + (info.satisfiableAll === undefined ? info.satisfiable : info.satisfiableAll)
        + '/' + info.productive;
    }).join(' ')
    + ' (satisfiable/productive)');
  console.log('CATEGORY '
    + ['research', 'engineering', 'trade', 'nonCombat'].map((key) => key + '=' + ((categorySummary && categorySummary[key]) || 0)).join(' ')
    + ' (C2–C4 reachable alternative routes)');
  console.log('DEADLOCKS ' + deadlocks + ' (single-game dynamic '
    + (stats.singleGameChecks || 0) + ' checks over ' + (GAME_IDS.length) + ' games × C1–C4, profession 0, one-shot 0)');
  console.log('TIER_ORDER ' + tierReport.passOrigins + '/' + ORIGIN_COUNT
    + ' (T6-before-ending checks=' + (stats.t6PreEndingChecks || 0) + ')');
  console.log('NEGATIVES ' + negativesPassed + '/4');
  console.log('CHECKS_TOTAL ' + passed + '/' + checks.length + ' (WARN ' + warnings.length + ')');
  if (failChecks.length) {
    console.log('FAIL:');
    failChecks.slice(0, 40).forEach((item) => console.log('  - ' + item.id + ': ' + item.detail));
  }
  if (gapChecks.length) {
    console.log('GAP:');
    gapChecks.forEach((item) => console.log('  - ' + item.id + ': ' + item.detail));
  }
  if (warnings.length) {
    console.log('WARN:');
    warnings.slice(0, 40).forEach((item) => console.log('  - ' + item.id + ': ' + item.detail));
  }
  const failedPaths = analysis.failures.filter((failure) => failure.id !== 'single-game-lock');
  if (failedPaths.length) {
    console.log('PATH FAILURES:');
    failedPaths.slice(0, 20).forEach((failure) => {
      console.log('  - origin=' + failure.origin + ' ending=' + (failure.ending || '-')
        + ' chapter=' + (failure.chapter || '-') + ' ' + failure.id + ': ' + failure.detail);
    });
  }
  const ok = failChecks.length === 0 && passedPaths === pathCount;
  const status = !ok ? 'FAIL' : gapChecks.length ? 'BLOCKED' : 'PASS';
  console.log('RESULT: ' + status + ' (' + passedPaths + '/' + pathCount + ' paths, deadlocks=' + deadlocks
    + ', tierOrder=' + tierReport.passOrigins + '/' + ORIGIN_COUNT + ')');
  console.log('============================================================');
  process.exitCode = ok ? (gapChecks.length ? 2 : 0) : 1;
  return status;
}

async function main() {
  printHeader();

  /* 内容装载严重缺口：缺 campaign / commissions 直接 GAP。 */
  check('content:campaign-loaded', campaignChapters.length === CONTRACT.chapterIds.length, 'campaign chapters=' + campaignChapters.length, 'gap');
  check('content:commissions-loaded', COMMISSIONS.length > 0, 'commissions=' + COMMISSIONS.length, 'gap');
  check('content:origins-loaded', ORIGIN_COUNT > 0, 'origins=' + ORIGIN_COUNT, 'gap');
  check('content:endings-derived', ENDING_COUNT === CONTRACT.endingApproaches.length, 'endings=' + ENDING_COUNT);

  staticContentChecks();

  const analysis = analyzeContent({ campaign: campaign, campaignChapters: campaignChapters, commissions: COMMISSIONS, items: itemsContent, origins: ORIGINS, endings: ENDINGS }, { computeAlternatives: true });
  printPaths(analysis);
  printAlternatives(analysis);

  /* 路径逐条检查（48 条）。 */
  const pathIds = new Set();
  analysis.paths.forEach((path) => {
    const id = path.origin.gameId + '|' + path.approach;
    pathIds.add(id);
    const finalFlags = path.flags || [];
    const ok = finalFlags.indexOf(CONTRACT.chapterFlags.C5) >= 0 && finalFlags.indexOf('ending.' + path.approach) >= 0
      && path.segments.length === CONTRACT.chapterIds.length;
    check('path:' + id, ok, 'segments=' + path.segments.length + ' flags=' + finalFlags.join(','));
  });
  ORIGINS.forEach((origin) => {
    ENDINGS.forEach((approach) => {
      const id = origin.gameId + '|' + approach;
      if (!pathIds.has(id)) {
        check('path:' + id, false, 'path missing');
      }
    });
  });
  check('paths:count', analysis.paths.length === ORIGIN_COUNT * ENDING_COUNT,
    analysis.paths.length + '/' + (ORIGIN_COUNT * ENDING_COUNT));
  check('paths:cross-profession', analysis.paths.every((path) => path.crossProfessionCommissions >= 1),
    'paths without cross-profession commission: ' + analysis.paths.filter((path) => path.crossProfessionCommissions < 1).length);

  /* 每章替代路线：C1–C4 至少 2 条、C5 三终局、C0 序章单路线（campaign-core MIN_ROUTES）。 */
  const minRoutes = (campaignCore && campaignCore.MIN_ROUTES) || CONTRACT.minRoutes;
  CONTRACT.chapterIds.forEach((chapterId) => {
    const info = analysis.alternatives[chapterId] || {};
    const expected = minRoutes[chapterId] || 1;
    if (chapterId === CONTRACT.finale) {
      check('alternatives:' + chapterId, info.satisfiable === ENDING_COUNT && info.productive === ENDING_COUNT,
        'C5 endings=' + info.satisfiable + '/' + info.productive);
      return;
    }
    check('alternatives:' + chapterId, Number(info.productive) >= expected && Number(info.satisfiable) >= expected,
      'declared=' + info.declared + ' productive=' + info.productive + ' satisfiable=' + info.satisfiable + ' min=' + expected);
  });
  if (analysis.alternatives.C0 && analysis.alternatives.C0.productive === 1) {
    warn('c0-single-route', 'C0 序章只有 1 条路线（campaign-core.MIN_ROUTES.C0=1；ADR §20.2「每章≥2」在此按 C0 序章例外处理）');
  }

  /* C2–C4 研究 / 工程 / 贸易 / 非战斗替代路线至少各一条可达。 */
  const categories = { research: 0, engineering: 0, trade: 0, nonCombat: 0 };
  const categoryExamples = { research: [], engineering: [], trade: [], nonCombat: [] };
  ['C2', 'C3', 'C4'].forEach((chapterId) => {
    const info = analysis.alternatives[chapterId] || {};
    const allRoutes = (info.routes || []).concat(info.confirmationRoutes || []);
    allRoutes.forEach((route) => {
      if (!route.satisfiable || !route.category) return;
      ['research', 'engineering', 'trade', 'nonCombat'].forEach((key) => {
        if (route.category[key]) {
          categories[key] += 1;
          categoryExamples[key].push(chapterId + ':' + route.routeId + (route.selfReferential ? '(confirmation)' : ''));
        }
      });
    });
  });
  Object.keys(categories).forEach((key) => {
    check('alternatives:category:' + key, categories[key] >= 1,
      key + '=' + categories[key] + ' examples=' + categoryExamples[key].join(','));
  });

  /* 死锁 0（含单游戏 / 单职业 / 一次性资源）。 */
  const deadlocks = analysis.failures.filter((failure) => failure.id === 'single-game-lock');
  check('deadlocks:single-game', deadlocks.length === 0, JSON.stringify(deadlocks.slice(0, 6)));
  const resourceRequirements = JSON.stringify(campaign).match(/"(item|credits|allCommissions)"\s*:/g) || [];
  check('deadlocks:resource-requirements', resourceRequirements.length === 0,
    'campaign 要求里出现 item/credits/allCommissions：' + resourceRequirements.join(','));
  let oneShot = [];
  COMMISSIONS.forEach((commission) => {
    const unlockText = JSON.stringify(commission.unlock || {});
    if (unlockText.indexOf('"item"') >= 0 || unlockText.indexOf('"credits"') >= 0) oneShot.push(commission.commissionId);
  });
  check('deadlocks:one-shot-resource', oneShot.length === 0, oneShot.join(','));
  check('deadlocks:profession-not-gated', JSON.stringify({ campaign: campaign, commissions: COMMISSIONS }).indexOf('"professionId":{"') < 0
    && JSON.stringify(campaign).indexOf('professionId') < 0,
    '内容前置不得按 professionId 门禁');
  check('deadlocks:total', deadlocks.length === 0 && resourceRequirements.length === 0 && oneShot.length === 0,
    'deadlocks=' + deadlocks.length);

  /* 三终局经济等价 + C5 一次性：ending 内容已静态检查，这里对照 campaign 旗标。 */
  check('endings:all-approaches', ENDING_COUNT === CONTRACT.endingApproaches.length
    && CONTRACT.endingApproaches.every((approach) => !!campaignEndingByApproach.get(approach)),
    ENDINGS.join(','));

  /* T4–T6 受控顺序检查。 */
  const tierReport = tierOrderingChecks();
  printTierOrder(tierReport);
  check('tier-order:no-t6-before-ending', analysis.failures.filter((failure) => failure.id === 't6-before-ending').length === 0,
    JSON.stringify(analysis.failures.filter((failure) => failure.id === 't6-before-ending').slice(0, 6)));

  /* 真实运行时交叉验证。 */
  await campaignCoreChecks(analysis);
  await endingReducerChecks();

  /* 负例。 */
  negativeChecks();
  const negativeChecksAll = checks.filter((item) => item.id.indexOf('negative:') === 0);
  const negativeCases = new Set(negativeChecksAll.map((item) => item.id.split(':').slice(0, 2).join(':')));
  const negativesPassed = [...negativeCases].filter((caseId) => {
    const caseChecks = negativeChecksAll.filter((item) => item.id.indexOf(caseId + ':') === 0);
    return caseChecks.length > 0 && caseChecks.every((item) => item.ok);
  }).length;

  finalSummary(analysis, tierReport, negativesPassed, categories);
}

main().catch((err) => {
  console.error('FATAL: 未捕获异常，测试不能判定为 PASS');
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
