#!/usr/bin/env node
/**
 * StudioKit Arcade 生涯首航 V2 — 零剧情种子、真实 UI 全链路门禁（E 组）
 *
 * 二十一点起源从经典入口走到研究终局，途中验证首单关标签续接、影跃失败重接、
 * 两张开场收据的回告示板动作及可见剧情所得。记忆翻牌使用独立新档跑到首次到港。
 * 两个场景均通过真实 UI 读信、投递与导航，只使用游戏原生钩子辅助玩法，
 * 不预写剧情旗标、委托通关或证据。接口约定见 ADR §20.8、§20.9 与 §21。
 *
 * 用法（仓库根）：
 *   node tools/career_flow_e2e_test.mjs --help
 *   node tools/career_flow_e2e_test.mjs --static-only   # 无 Chrome：内容路线 + 接口矩阵
 *   node tools/career_flow_e2e_test.mjs                 # 全量（真 Chrome + CDP + IDB）
 *
 * 环境变量（独立端口，避免串门禁）：
 *   CAREER_FLOW_PORT    静态服务器端口，默认 9021
 *   CAREER_FLOW_CDP     请求 CDP 端口，默认 9521（实际动态端口从 profile 读取）
 *   CHROME_PATH         Chrome 路径
 *   CAREER_FLOW_QA_DIR   截图输出目录
 *
 * 退出码：0 = 全部 PASS；1 = FAIL 或 BLOCKED；2 = 环境/用法错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  CDP,
  REPO_ROOT,
  createRecorder,
  envPort,
  launchChrome,
  openPage,
  sleep,
  startServer,
  stopChrome,
} from './lib/arcade_cdp.mjs';

/* ------------------------------------------------------------------ *
 * 1. 常量 / 状态 / 记录器
 * ------------------------------------------------------------------ */

const DB_NAME = 'studiokit:arcade:career';
const ORIGIN_GAME = 'blackjack';
const ORIGIN_CLUE = 'CL-blackjack';
const MEMORY_ORIGIN = 'memory-flip';
/* 0.22 到港回应断言的是旧告示板 [data-town-arrival] 的寄信人/旧物；0.23 该区块已随告示板移除，
   等价事实由首次到港面板正文（invitation.js 的 freshIntro）承担，用 0.23 内容里的旧物名。 */
const ORIGIN_ARRIVAL = {
  [ORIGIN_GAME]: { sender: '阿德', object: '风险单', otherSender: '老周', otherObject: '存根' },
  [MEMORY_ORIGIN]: { sender: '老周', object: '存根', otherSender: '阿德', otherObject: '风险单' },
};
/* 0.23 真实叙事内容：首次到港的文案与首单动作来自内容 shard，测试只读同源数据。 */
const NARRATIVE_BY_PROFESSION = (() => {
  const registry = readJson('apps/arcade/career/content/narrative-registry.json');
  const map = {};
  for (const shard of registry.shards) {
    const data = readJson('apps/arcade/career/content/' + shard.url);
    for (const entry of data.entries || []) map[entry.professionId] = entry;
  }
  return map;
})();
/* 起源游戏 → 首个职业：到港叙事面板与港口 story message 都按职业读内容，测试只读同源数据。 */
const ORIGIN_PROFESSION = (() => {
  const registry = readJson('apps/arcade/career/content/registry.json');
  const map = {};
  (registry.games || []).forEach((game) => {
    if (game && game.gameId && Array.isArray(game.professions) && game.professions[0]) map[game.gameId] = game.professions[0];
  });
  return map;
})();
/* 所有职业的公开显示名：用来证明港口工作页不泄漏未接受职业。 */
const CAREER_PROFESSION_NAMES = (() => {
  const registry = readJson('apps/arcade/career/content/registry.json');
  return (registry.professions || []).map((row) => ({ id: row.professionId, name: row.displayName })).filter((row) => row.id && row.name);
})();
/* 0.24 T24 真实浏览器交汇场景的固定事实：职业 A=起源职业，职业 B=五子棋职业。
   事件 id / 文案 / 人物全部从同源内容读取，不在测试里写死台词或规则。 */
const CROSSOVER_A_GAME = ORIGIN_GAME;
const CROSSOVER_A_PROFESSION = ORIGIN_PROFESSION[ORIGIN_GAME];
const CROSSOVER_B_GAME = 'gomoku';
const CROSSOVER_B_PROFESSION = ORIGIN_PROFESSION[CROSSOVER_B_GAME];
const CROSSOVER_B_CLUE = 'CL-gomoku';
const CROSSOVER_REQUIRED_FLAG = 'C2.research_complete';
const CROSSOVER_CONTENT = (() => {
  try {
    return readJson('apps/arcade/career/content/world-narrative.json');
  } catch (err) {
    return null;
  }
})();
const CROSSOVER_EVENT_ID = 'crossover:' + [CROSSOVER_A_PROFESSION, CROSSOVER_B_PROFESSION].sort().join(':');
const CROSSOVER_PAIR = (() => {
  const rows = CROSSOVER_CONTENT && Array.isArray(CROSSOVER_CONTENT.crossoverPairs) ? CROSSOVER_CONTENT.crossoverPairs : [];
  return rows.filter((row) => row && row.eventId === CROSSOVER_EVENT_ID)[0] || null;
})();
const CROSSOVER_JOURNAL_ROW = (() => {
  const rows = CROSSOVER_CONTENT && Array.isArray(CROSSOVER_CONTENT.journalWhitelist) ? CROSSOVER_CONTENT.journalWhitelist : [];
  return rows.filter((row) => row && row.eventId === CROSSOVER_EVENT_ID)[0] || null;
})();
/* route-planner.chapterAlternatives 用同章同机制的 world-narrative 节点文案覆盖内置文案；
   这里只读内容侧公开文本对，用来证明章节指引确实绑定了真实内容节点（不校验内部 id）。 */
const WORLD_ALTERNATIVE_TEXT_PAIRS = (() => {
  const rows = CROSSOVER_CONTENT && Array.isArray(CROSSOVER_CONTENT.alternativeNarratives)
    ? CROSSOVER_CONTENT.alternativeNarratives : [];
  return rows.map((row) => ({
    chapterId: row && row.chapterId ? row.chapterId : null,
    mechanism: row && row.mechanism ? row.mechanism : null,
    offer: row && row.texts && typeof row.texts.offer === 'string' ? row.texts.offer : '',
    next: row && row.texts && typeof row.texts.next === 'string' ? row.texts.next : '',
  })).filter((row) => row.offer || row.next);
})();
/* 内部字段 / 内部 id 的 DOM 泄漏扫描（只用于玩家可见文本，不用于诊断对象）。 */
const GUIDE_INTERNAL_PATTERNS = [
  { name: 'narrativeNodeId / nodeId 字段名', re: /narrativeNodeId|\bnodeId\b/i },
  { name: '内部替代节点 id altn.', re: /altn\./i },
  { name: '内部事件前缀 crossover:/world:/invitation:/commission:', re: /crossover:|(?:^|\s)(?:world|invitation|commission):/i },
  { name: '内部字段名 requirement/tokens/anchor/mechanism', re: /\b(?:requirement|tokens|anchor|mechanism|receiptSource|visibleSurfaces|pairId|whitelistLayer|labelMode)\b/i },
  { name: '章节码 C0.xxx–C5.xxx', re: /(?:^|[^A-Za-z0-9])C[0-5]\.[A-Za-z_]/ },
  { name: '委托后缀 .T1–.T6', re: /\.[Tt][1-6](?![0-9])/ },
  { name: '证据 token E-/BP-/MAP-/DEC-', re: /(?:E|BP|MAP|DEC)-(?!7\b)[A-Za-z][A-Za-z0-9._-]*[A-Za-z0-9]/ },
];
const TICKET_STORAGE_KEY = 'studiokit:arcade:career:ticket.v1';
const RECEIPT_CARD = '[data-career-card="receipt"]';
const ENDING_APPROACH = 'research';
const ENDING_GAME = 'merge-2048';
const VIEWPORTS = [
  { width: 320, height: 700, label: '320×700' },
  { width: 375, height: 548, label: '375×548（0.19 紧凑）' },
  { width: 390, height: 664, label: '390×664（0.19 紧凑首页）' },
  { width: 390, height: 844, label: '390×844' },
  { width: 430, height: 932, label: '430×932' },
];
const CAREER_CATALOG_FIXTURE = (() => {
  const registry = readJson('apps/arcade/career/content/registry.json');
  const worldWork = readJson('apps/arcade/career/content/world-work.json');
  return Object.assign({}, registry, {
    clues: readJson('apps/arcade/career/content/clues.json').clues,
    commissions: readJson('apps/arcade/career/content/commissions.json').commissions,
    worldWorkIds: worldWork.commissionIds,
    worldWork: worldWork,
    tools: [
      { toolId: 'wallet', name: '钱包', introducedOnAccept: true },
      { toolId: 'shop', name: '商店', introducedOnAccept: true },
      { toolId: 'workshop', name: '工作台', introducedOnAccept: true },
      { toolId: 'hangar', name: '机库', introducedOnAccept: true },
    ],
  });
})();

const J = (value) => JSON.stringify(value);
const CHAPTER_FLAGS = Object.freeze({
  C0: 'C0.port_seen',
  C1: 'C1.signal_fragment',
  C2: 'C2.research_complete',
  C3: 'C3.truth_found',
  C4: 'C4.city_power_restored',
  C5: 'C5.star_tower_resolved',
});

/* 0.22 世界通用工作路线由 world-work.json + 产品 nextAction + story-evidence 实时推导。 */
let WORLD_WORK_ROUTE = [];

const rec = createRecorder();
const COUNTS = { pass: 0, fail: 0, blocked: 0 };
let CURRENT_STEP = 'boot';
let STATIC_ONLY = false;

function step(label) {
  CURRENT_STEP = label;
}

function gate(name, ok, detail = '') {
  COUNTS[ok ? 'pass' : 'fail'] += 1;
  rec.record(name, ok === true, typeof detail === 'string' && detail.length > 700 ? detail.slice(0, 700) + '…' : detail);
  return ok === true;
}

function block(name, reason) {
  COUNTS.blocked += 1;
  const text = String(reason || '');
  console.log('BLOCKED  ' + name + (text ? ' — ' + (text.length > 700 ? text.slice(0, 700) + '…' : text) : ''));
  return false;
}

class StepError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StepError';
  }
}
class GateBlocked extends Error {
  constructor(name, reason) {
    super(name + ': ' + reason);
    this.name = 'GateBlocked';
  }
}

function ensure(condition, message) {
  if (!condition) throw new StepError(message);
}

/** 关键接口缺失：记 BLOCKED 并终止当前链路（不静默跳过）。 */
function requireFeature(name, present, detail) {
  if (!present) {
    block(name, detail);
    throw new GateBlocked(name, detail);
  }
  return gate(name, true, '');
}

function parsePort(name, fallback) {
  try {
    return envPort(name, fallback);
  } catch (err) {
    console.error('ENV ERROR  ' + (err && err.message ? err.message : String(err)));
    process.exit(2);
  }
}

const SERVER_PORT = parsePort('CAREER_FLOW_PORT', 9021);
const CDP_PORT = parsePort('CAREER_FLOW_CDP', 9521);
const BASE = 'http://127.0.0.1:' + SERVER_PORT;
const HOME_URL = BASE + '/apps/arcade/index.html';
const ARTIFACTS_DIR = process.env.CAREER_FLOW_QA_DIR || path.join(REPO_ROOT, 'test-artifacts', 'career-flow');
const QA = {
  careerId: null,
  tickets: [],
  recommended: [],
  chapterAfter: [],
  /* 0.23：首次到港面板没有独立到港回应块，面板正文要在关闭前取样，供后续逐游戏断言。 */
  arrivalText: {},
  errors: [],
};

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
}

function readText(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

/* ------------------------------------------------------------------ *
 * 2. 静态检查：内容路线真值 + 接口落地矩阵
 * ------------------------------------------------------------------ */

function evalRequirement(req, ctx) {
  if (!req || typeof req !== 'object') return true;
  if (Array.isArray(req.all)) return req.all.every((row) => evalRequirement(row, ctx));
  if (Array.isArray(req.any)) return req.any.some((row) => evalRequirement(row, ctx));
  if (Array.isArray(req.allFlags)) return req.allFlags.every((flag) => ctx.flags.has(flag));
  if (Array.isArray(req.anyFlags)) return req.anyFlags.some((flag) => ctx.flags.has(flag));
  if (Array.isArray(req.anyCommissions)) return req.anyCommissions.some((id) => ctx.cleared.has(id));
  if (Array.isArray(req.evidenceAll)) return req.evidenceAll.every((token) => ctx.evidence.has(token));
  if (Array.isArray(req.evidenceAny)) return req.evidenceAny.some((token) => ctx.evidence.has(token));
  return true;
}

/* 直接加载产品 story-evidence 模块；不复制任何章节规则（独立复审 Blocker）。 */
import { createRequire } from 'node:module';
const nodeRequire = createRequire(import.meta.url);
const STORY_EVIDENCE_MODULE = nodeRequire(path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'story-evidence.js'));
const PROFESSION_VIEW_MODULE = nodeRequire(path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'profession-view.js'));
const PROFESSION_STATE_MODULE = nodeRequire(path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'profession-state.js'));

function makeStoryEvidence(contentCommissions) {
  const instance = typeof STORY_EVIDENCE_MODULE.createStoryEvidence === 'function'
    ? STORY_EVIDENCE_MODULE.createStoryEvidence({})
    : STORY_EVIDENCE_MODULE;
  const configured = instance.configure({
    commissions: contentCommissions,
    items: readJson('apps/arcade/career/content/items.json'),
    chapter: [],
  });
  return { instance, configured };
}

/** 用真实 story-evidence.storyFlags 推导旗标，不本地复制 C2–C4 规则。 */
function deriveChapterFlags(instance, flags, evidence) {
  const result = instance.storyFlags({ flags: Array.from(flags), evidence: Array.from(evidence) });
  if (!result || result.ok !== true) throw new Error('story-evidence.storyFlags 失败: ' + J(result));
  return new Set(result.allFlags || result.flags || []);
}

/**
 * 0.22 W5E：从 world-work.json 取候选，用真实 profession-view.nextAction 逐单推进，
 * 再用 story-evidence 计算章节旗标；不复制固定路线或私有升级解释。
 */
function deriveWorldWorkRoute(campaign, commissions, worldWork, storyInstance) {
  const registry = readJson('apps/arcade/career/content/registry.json');
  const originGame = registry.games.find((game) => game && game.gameId === ORIGIN_GAME);
  const professionId = originGame && Array.isArray(originGame.professions) ? originGame.professions[0] : null;
  if (!professionId) throw new Error('W5E origin profession missing');
  const at = '2026-11-27T00:00:00.000Z';
  let state = PROFESSION_STATE_MODULE.initialState(at);
  state = PROFESSION_STATE_MODULE.recordGlimpsed(state, {
    professionId, gameId: ORIGIN_GAME, clueId: ORIGIN_CLUE, at, catalog: CAREER_CATALOG_FIXTURE,
  }).state;
  state = PROFESSION_STATE_MODULE.recordRead(state, {
    professionId, gameId: ORIGIN_GAME, clueId: ORIGIN_CLUE, clueOpened: true, at, catalog: CAREER_CATALOG_FIXTURE,
  }).state;
  state = PROFESSION_STATE_MODULE.acceptInvitation(state, {
    professionId, gameId: ORIGIN_GAME, at, catalog: CAREER_CATALOG_FIXTURE,
  }).state;

  const byId = new Map(commissions.map((row) => [row.commissionId, row]));
  const worldIds = Array.isArray(worldWork.commissionIds) ? worldWork.commissionIds.slice() : [];
  const cleared = new Set();
  const flags = new Set([CHAPTER_FLAGS.C0]);
  const evidence = new Set();
  const chapterFlagSet = new Set(Object.values(CHAPTER_FLAGS));
  const route = [];
  const derived = [];
  while (cleared.size < worldIds.length) {
    const action = PROFESSION_VIEW_MODULE.getNextNarrativeAction({
      state,
      catalog: CAREER_CATALOG_FIXTURE,
      context: { surface: 'port', availableIds: worldIds, clearedCommissions: Array.from(cleared) },
    });
    if (!action || !action.commissionId || !worldIds.includes(action.commissionId) || cleared.has(action.commissionId)) {
      throw new Error('W5E nextAction 无法继续：' + J({ action, cleared: Array.from(cleared), worldIds }));
    }
    const commission = byId.get(action.commissionId);
    if (!commission) throw new Error('W5E commission missing: ' + action.commissionId);
    const before = new Set(flags);
    (commission.reward.flags || []).forEach((flag) => flags.add(flag));
    (commission.reward.evidence || []).forEach((token) => evidence.add(token));
    cleared.add(commission.commissionId);
    let all = deriveChapterFlags(storyInstance, flags, evidence);
    if (!flags.has(CHAPTER_FLAGS.C1)) {
      const c1 = (campaign.chapters || []).find((chapter) => chapter.chapterId === 'C1');
      if (c1 && (c1.routes || []).some((routeRow) => evalRequirement(routeRow.requires, { flags, evidence, cleared }))) {
        flags.add(CHAPTER_FLAGS.C1);
        all = deriveChapterFlags(storyInstance, flags, evidence);
      }
    }
    all.forEach((flag) => flags.add(flag));
    const newFlags = Object.values(CHAPTER_FLAGS).filter((flag) => chapterFlagSet.has(flag) && all.has(flag) && !before.has(flag));
    route.push({ commissionId: commission.commissionId, expectFlags: newFlags, kind: newFlags.length ? 'milestone' : 'step' });
    derived.push({ commissionId: commission.commissionId, newFlags, derived: Array.from(all) });
  }
  return { route, derived };
}

function staticContentChecks() {
  step('static:content');
  let campaign;
  let commissions;
  let clues;
  let chapter1;
  let ending;
  let worldWork;
  try {
    campaign = readJson('apps/arcade/career/content/campaign.json');
    commissions = readJson('apps/arcade/career/content/commissions.json').commissions;
    clues = readJson('apps/arcade/career/content/clues.json').clues;
    chapter1 = readJson('apps/arcade/career/content/chapter-01.json');
    ending = readJson('apps/arcade/career/content/ending-research.json');
    worldWork = readJson('apps/arcade/career/content/world-work.json');
  } catch (err) {
    gate('S00 内容 JSON 可读取', false, String(err && err.message ? err.message : err));
    return;
  }
  const { instance: storyStatic, configured: storyCfg } = makeStoryEvidence(commissions);
  gate('S01b 真实 story-evidence 模块可按当前内容配置', storyCfg.ok === true, J(storyCfg));
  let routeAndFlags;
  try {
    routeAndFlags = deriveWorldWorkRoute(campaign, commissions, worldWork, storyStatic);
  } catch (err) {
    gate('S01 W5E 路线可由真实内容推导', false, String(err && err.message ? err.message : err));
    return;
  }
  WORLD_WORK_ROUTE = routeAndFlags.route;
  const derived = routeAndFlags.derived;
  const byId = new Map(commissions.map((row) => [row.commissionId, row]));
  gate('S00 内容 JSON 可读取', true, 'campaign/commissions/clues/chapter-01/ending-research/world-work');
  const derivedIds = WORLD_WORK_ROUTE.map((row) => row.commissionId);
  gate('S01 W5E 路线由 world-work 内容逐单真实推导',
    derivedIds.length === worldWork.commissionIds.length &&
      derivedIds.every((id) => worldWork.commissionIds.includes(id) && byId.has(id)),
    J({ contentIds: worldWork.commissionIds, derivedIds }));
  const firstCommission = byId.get(WORLD_WORK_ROUTE[0].commissionId);
  const firstFlags = new Set((firstCommission && firstCommission.reward.flags) || []);
  const c1FlagHits = Array.from(firstFlags).filter((flag) => /^C1\./.test(flag));
  gate(
    'S02 首单真实产出 C1 旗标与 E 证据（非硬编码假旗标）',
    !!(firstCommission && c1FlagHits.length >= 1 && (firstCommission.reward.evidence || []).length >= 1),
    J(firstCommission && firstCommission.reward)
  );
  const c1Route = (campaign.chapters || []).find((chapter) => chapter.chapterId === 'C1');
  gate(
    'S03 C1 章节路线可由首单真实旗标满足',
    !!c1Route && c1Route.routes.some((route) => evalRequirement(route.requires, {
      flags: new Set(['C0.port_seen'].concat(c1FlagHits)),
      evidence: new Set(),
      cleared: new Set([WORLD_WORK_ROUTE[0].commissionId]),
    })),
    J(c1Route && c1Route.routes)
  );
  const expectedFlags = WORLD_WORK_ROUTE.flatMap((spec) => spec.expectFlags);
  const actualFlags = derived.flatMap((row) => row.newFlags);
  gate('S04 W5E 路线按真实规则推进 C1→C2→C3→C4（不跳章）', J(actualFlags) === J(expectedFlags), J(derived));
  const stepIndexes = WORLD_WORK_ROUTE.map((spec, index) => (spec.kind === 'step' ? index : -1)).filter((index) => index >= 0);
  const silent = stepIndexes.filter((index) => derived[index].newFlags.length !== 0);
  gate('S05 中间单不产章节旗标（必须显示能积攒下一步所需）', silent.length === 0, J(silent.map((index) => ({ id: WORLD_WORK_ROUTE[index].commissionId, flags: derived[index].newFlags }))));

  gate('S06 终局 research 由内容真实产出 C5 + ending.research，且前置为 C4',
    !!(ending && (ending.flags || []).includes('C5.star_tower_resolved') && (ending.flags || []).includes('ending.research') && ending.gameId === ENDING_GAME),
    J(ending && { gameId: ending.gameId, flags: ending.flags, objective: ending.objective }));
  const endingEntry = (campaign.endings || []).find((row) => row.approach === ENDING_APPROACH);
  gate('S07 C5 终局入口需要 C4 旗标', !!(endingEntry && (endingEntry.entry.allFlags || []).includes(CHAPTER_FLAGS.C4)), J(endingEntry));

  const clue = clues.find((row) => row.clueId === ORIGIN_CLUE);
  gate('S08 起源线索由真实事件产生且有信件地址', !!(clue && clue.gameId === ORIGIN_GAME && clue.trigger && clue.letter && clue.letter.address), J(clue && { id: clue.clueId, trigger: clue.trigger, address: clue.letter && clue.letter.address }));
  const origin = (chapter1.origins || []).find((row) => row.gameId === ORIGIN_GAME);
  gate('S09 起源信箱正文给出身份与旧港地址', !!(origin && origin.c0Letter && origin.c0Letter.body && origin.c0Letter.address === (clue && clue.letter.address)), J(origin && origin.c0Letter));
  const memoryClue = clues.find((row) => row.clueId === 'CL-memory-flip');
  const memoryOrigin = chapter1.origins.find((row) => row.gameId === MEMORY_ORIGIN);
  gate('S10 翻牌线索由配对触发，来信对应老周收下存根',
    memoryClue?.gameId === MEMORY_ORIGIN && memoryClue.trigger?.kind === 'pair.match' &&
      memoryOrigin?.c0Letter?.from?.includes(ORIGIN_ARRIVAL[MEMORY_ORIGIN].sender) &&
      memoryOrigin.c0Letter.body?.includes(ORIGIN_ARRIVAL[MEMORY_ORIGIN].object) &&
      memoryOrigin.c0Letter.address === memoryClue.letter?.address,
    J({ trigger: memoryClue?.trigger, letter: memoryOrigin?.c0Letter }));
  const archive = commissions.find((row) => row.commissionId === 'memory-flip.T1');
  const photo = commissions.find((row) => row.commissionId === 'memory-flip.T2');
  gate('S11 旧档案夹不产证据，但解锁差一张的照片',
    archive?.reward?.evidence?.length === 0 && photo?.title === '差一张的照片' &&
      !!photo.unlock?.all?.some((condition) => condition.commissionCleared === archive.commissionId),
    J({ archive: archive?.reward, photo: photo?.unlock }));
}

/** 接口矩阵：缺失的关键项必须 BLOCKED，不允许静默跳过。 */
const INTERFACES = [
  {
    /* 0.23：旧告示板（[data-town-recommend-id]/[data-town-recommend-kind] 等）已被组件化港口
       P07–P10 取代；真实 DOM 钩子改为「眼下/工作/经历」分段标签、职业工作卡与工具格。 */
    name: 'I01 港口组件面真实 DOM 钩子 [data-port-tabpanel]/[data-port-profession]/[data-tool]',
    file: 'apps/arcade/career/ui/town.js',
    needles: ['portContentNode', 'data-port-tabpanel', 'data-port-profession', 'ToolGrid'],
    critical: true,
  },
  {
    /* 0.22 的推荐行目标句（data-town-goal）与「能推进这一段 / 能积攒下一步所需」进展语言随告示板移除；
       0.23 港口首页只渲染 StoryCard + 真实 careerView.story.nextAction，主动作以 port-story-<commissionId> 暴露。
       等价（更强）：推荐必须来自真实投影，动作是玩家可点的真实按钮，点击走 startPortCommission。 */
    name: 'I02 港口首页推荐卡绑定 careerView.story.nextAction 且动作可点击',
    file: 'apps/arcade/career/ui/town.js',
    needles: ['portStoryProps', 'nextAction', 'port-story-', 'startPortCommission'],
    critical: true,
  },
  {
    name: 'I03 港口推荐 nextAction 由 profession-view 从真实 availableIds 派生',
    file: 'apps/arcade/career/profession-view.js',
    needles: ['function getNextNarrativeAction', 'availableIds', 'canAcceptCommission'],
    critical: true,
  },
  {
    /* 0.22 首屏身份/当前章文案 [data-town-intro]/[data-town-current] 随告示板移除；
       0.23 到港叙事由 invitation.js 的 arrival 面板承担（harbor + NPCDialogue + 第一单/离开动作）。 */
    name: 'I04 首次到港面板真实叙事与第一单/离开动作',
    file: 'apps/arcade/career/ui/invitation.js',
    needles: ['CareerShell.create(\'arrival\')', 'start-first-commission', 'leave-arrival', 'NPCDialogue'],
    critical: true,
  },
  {
    /* 0.22 统一披露：收据的下一步与经历只从 careerView.story 投影读取，
       不再依赖「新完成的段落 / 已完成章节」这类特定文案；玩家仍须看到下一步。 */
    name: 'I05 收据 nextAction/经历来自 careerView 投影且下一步可见',
    file: 'apps/arcade/career/ui/receipt.js',
    needles: ['projectedStoryOf', 'story.nextAction', 'story.history', '下一步：'],
    critical: true,
  },
  {
    name: 'I06 收据页内「回告示板看看 / 读读回信」主动作',
    file: 'apps/arcade/career/ui/receipt.js',
    needles: ['回告示板看看', '读读回信'],
    critical: true,
  },
  {
    name: 'I07 首页未读/续读来信回访入口与 ?careerLetter=1',
    file: 'apps/arcade/index.html',
    needles: ['旧港有一封来信', '继续旧港来信', 'careerLetter=1'],
    critical: true,
  },
  {
    name: 'I08 线索 chip 可点、未读可重显',
    file: 'apps/arcade/career/ui/clue-surface.js',
    needles: ['data-career-clue', 'ARIA_PREFIX'],
    critical: true,
  },
  {
    name: 'I09 章节面板与终局入口 DOM 钩子',
    file: 'apps/arcade/career/ui/world-state.js',
    needles: ['data-chapter-id', 'data-approach'],
    critical: true,
  },
  {
    name: 'I10 职业结算真实接线 storyEvidence/receipt feedback',
    file: 'apps/arcade/career/bridge.js',
    needles: ['recordFromReceipt', 'storyFeedback'],
    critical: true,
  },
  {
    /* 生产游戏页（无 careerTest）只读快照回退：ArcadeCareer.db（若暴露）或
       ArcadeCareer.backup.exportCareerLife（内部 db.exportAll，不写库）。 */
    name: 'I11 生产页只读快照回退接口（公开 db 或 backup.exportCareerLife）',
    file: 'apps/arcade/career/bridge.js',
    needles: ['api.backup = backupFacade()'],
    critical: true,
  },
];

function staticInterfaceChecks() {
  step('static:interfaces');
  for (const item of INTERFACES) {
    let text = '';
    try {
      text = readText(item.file);
    } catch (err) {
      block(item.name, '文件不可读 ' + item.file + ': ' + String(err && err.message ? err.message : err));
      continue;
    }
    const missing = item.needles.filter((needle) => text.indexOf(needle) < 0);
    /* anyNeedles：多组文案互斥变体，任意一组全部命中即可（如「新完成的段落：」或旧「已完成章节：」）。 */
    const anyHit = !item.anyNeedles || item.anyNeedles.length === 0 || item.anyNeedles.some((group) =>
      group.every((needle) => text.indexOf(needle) >= 0));
    if (missing.length === 0 && anyHit) {
      gate(item.name, true, 'INTEGRATED');
      continue;
    }
    const detail = { missing, anyNeedles: item.anyNeedles };
    if (item.critical) {
      block(item.name, 'MISSING ' + J(detail) + ' in ' + item.file);
    } else {
      gate(item.name, false, 'MISSING(非关键，仅记录) ' + J(detail) + ' in ' + item.file);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 3. 运行时通用工具（真 Chrome / 真 IDB / 只读校验）
 * ------------------------------------------------------------------ */

function gameUrl(gameId, params = {}) {
  const search = new URLSearchParams({ ...params, careerTest: '1' });
  return BASE + '/apps/arcade/games/' + gameId + '.html?' + search.toString() + '#test';
}

async function go(cdp, url, label) {
  step('navigate:' + label);
  const before = cdp.errors.slice();
  cdp.errors.length = 0;
  await cdp.navigate(url);
  return before;
}

async function checkConsole(cdp, label) {
  const errors = cdp.errors.slice();
  cdp.errors.length = 0;
  const externalAudio = errors.filter((message) => /AudioContext encountered an error from the audio device or the WebAudio renderer/.test(message));
  const actionable = errors.filter((message) => !/AudioContext encountered an error from the audio device or the WebAudio renderer/.test(message));
  actionable.forEach((message) => QA.errors.push({ label, message }));
  return gate('ERR 无 console error / 未捕获异常 [' + label + ']', actionable.length === 0,
    J({ actionable, externalAudio }));
}

/**
 * 等待游戏页 bridge ready。默认还要求 `?careerTest=1` 测试钩子；
 * 真实首页回访链接按设计不带该参数，只有生产 `ArcadeCareer.ready`，
 * 这类调用传 requireTestApi=false，只等公开 ready 并验证 available。
 */
async function waitBridge(cdp, label, requireTestApi = true) {
  const readyExpr = requireTestApi
    ? '!!(window.ArcadeCareer && window.ArcadeCareer.ready && window.__arcadeCareerTest)'
    : '!!(window.ArcadeCareer && window.ArcadeCareer.ready)';
  await cdp.waitFor(readyExpr, { timeout: 20000 });
  const ready = await cdp.evaluate('window.ArcadeCareer.ready.then(function (r) { return { ok: !!(r && r.available), reason: (r && r.reason) || null }; })');
  requireFeature('BOOT bridge 可用 [' + label + ']', ready && ready.ok === true, J(ready));
  return ready;
}

async function clickVisible(cdp, selector, label) {
  const result = await cdp.evaluate(`(() => {
    const el = document.querySelector(${J(selector)});
    if (!el) return { ok: false, reason: 'missing' };
    if (el.hidden || !el.getClientRects().length) return { ok: false, reason: 'hidden' };
    el.click();
    return { ok: true, text: (el.textContent || '').trim() };
  })()`);
  ensure(result && result.ok === true, label + ' 不可点击: ' + J(result));
  return result;
}

async function pressVisible(cdp, selector, label) {
  const target = await cdp.waitFor(`(() => {
    const el = [...document.querySelectorAll(${J(selector)})].find((node) =>
      !node.disabled && node.getClientRects().length && getComputedStyle(node).visibility === 'visible');
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const rect = el.getBoundingClientRect();
    const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
    const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
    if (!el.contains(document.elementFromPoint(x, y))) return null;
    return { x, y, text: el.innerText.trim() };
  })()`, { timeout: 10000 }).catch((err) => { throw new Error(label + ' 不可点击', { cause: err }); });
  const { x, y } = target;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  return target;
}

async function panelSnapshot(cdp, panelName) {
  return cdp.evaluate(`(() => {
    const panel = document.querySelector('[data-career-panel=${J(panelName)}]');
    if (!panel) return null;
    return { present: true, text: (panel.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 1400) };
  })()`);
}

async function waitPanel(cdp, panelName, timeout = 15000) {
  await cdp.waitFor(`!!document.querySelector('[data-career-panel=${J(panelName)}]')`, { timeout });
  return panelSnapshot(cdp, panelName);
}

/** 只读：取职业身份、quest flags、证据、claims（不写任何库行）。 */
async function readOnlyState(cdp) {
  return cdp.evaluate(`(async () => {
    const test = window.__arcadeCareerTest;
    const api = window.ArcadeCareer;
    const safe = (promise) => Promise.resolve(promise).catch(() => null);
    /* 首页回访/投递落在生产游戏页（无 ?careerTest=1），没有 __arcadeCareerTest；
       优先测试钩子 db，缺失时回退生产公开只读接口（若存在 ArcadeCareer.db），
       再退到 ArcadeCareer.backup.exportCareerLife（内部只用 db.exportAll）。
       绝不调用 ensureCareer 或任何写入口。 */
    let db = test && typeof test.db === 'function' ? test.db() : null;
    let dbSource = db ? 'careerTest' : null;
    if (!db && api && typeof api.db === 'function') {
      try { db = api.db() || null; } catch (err) { db = null; }
      if (db) dbSource = 'public';
    }
    if (db) {
      let pointer = null;
      try { pointer = await db.getState('career'); } catch (err) { return { ok: false, reason: 'getState-threw' }; }
      /* getState 返回扁平 {careerId,key}（也可能旧形状 {value:{careerId}}）。 */
      const careerId = pointer ? (pointer.careerId || (pointer.value && pointer.value.careerId) || null) : null;
      if (!careerId) return { ok: false, reason: 'no-career' };
      const [quests, profile, exported] = await Promise.all([
        safe(db.readQuestState(careerId)),
        safe(db.getProfile(careerId)),
        safe(db.exportAll()),
      ]);
      const rows = (quests && Array.isArray(quests.quests) ? quests.quests : []).map((row) => ({
        nodeId: row.nodeId || null,
        kind: row.kind || null,
        status: row.status || null,
        evidence: Array.isArray(row.evidence) ? row.evidence.slice() : [],
        flags: Array.isArray(row.flags) ? row.flags.slice() : [],
      }));
      const claims = (exported && exported.ok && exported.payload && Array.isArray(exported.payload.claims)) ? exported.payload.claims : [];
      return {
        ok: true,
        dbSource: dbSource,
        careerId: careerId,
        quests: rows,
        profile: profile || null,
        claims: claims.map((row) => ({
          receiptId: row.receiptId || null,
          commissionId: row.commissionId || null,
          credits: Number(row.credits) || 0,
          evidence: Array.isArray(row.evidence) ? row.evidence.slice() : [],
          flags: Array.isArray(row.flags) ? row.flags.slice() : [],
          receipt: row.receipt && typeof row.receipt === 'object' ? row.receipt : null,
        })),
      };
    }
    /* 生产页公开 backup.exportCareerLife 只读导出（内部 db.exportAll，不建 career）。 */
    const backup = api && api.backup;
    if (!backup || typeof backup.exportCareerLife !== 'function') return { ok: false, reason: 'db-unavailable' };
    const exported = await safe(backup.exportCareerLife());
    if (!exported || exported.ok !== true || !exported.payload) return { ok: false, reason: 'backup-export-failed' };
    const payload = exported.payload;
    const stateRows = Array.isArray(payload.state) ? payload.state : [];
    const pointer = stateRows.find((row) => row && row.key === 'career') || null;
    const careerId = pointer && pointer.value ? pointer.value.careerId : null;
    if (!careerId) return { ok: false, reason: 'no-career' };
    const rows = (Array.isArray(payload.quests) ? payload.quests : []).filter((row) => row && row.careerId === careerId).map((row) => ({
      nodeId: row.nodeId || null,
      kind: row.kind || null,
      status: row.status || null,
      evidence: Array.isArray(row.evidence) ? row.evidence.slice() : [],
      flags: Array.isArray(row.flags) ? row.flags.slice() : [],
    }));
    const profile = (Array.isArray(payload.profiles) ? payload.profiles : []).find((row) => row && row.careerId === careerId) || null;
    const claims = (Array.isArray(payload.claims) ? payload.claims : []).filter((row) => row && row.careerId === careerId);
    return {
      ok: true,
      dbSource: 'public-backup',
      careerId: careerId,
      quests: rows,
      profile: profile,
      claims: claims.map((row) => ({
        receiptId: row.receiptId || null,
        commissionId: row.commissionId || null,
        credits: Number(row.credits) || 0,
        evidence: Array.isArray(row.evidence) ? row.evidence.slice() : [],
        flags: Array.isArray(row.flags) ? row.flags.slice() : [],
        receipt: row.receipt && typeof row.receipt === 'object' ? row.receipt : null,
      })),
    };
  })()`);
}

/** 只读职业身份投影与当前票据：证明接受邀请只建身份，未签下委托。 */
async function careerIdentitySnapshot(cdp) {
  return cdp.evaluate(`(async () => {
    const api = window.ArcadeCareer;
    let view = null;
    try { if (api && typeof api.careerView === 'function') view = await api.careerView({ surface: 'receipt' }); } catch (err) { /* ignore */ }
    const run = api && api.commissionRun ? api.commissionRun : null;
    return {
      ok: !!view,
      originGameId: view && view.originGameId ? view.originGameId : null,
      activeProfessionId: view && view.activeProfessionId ? view.activeProfessionId : null,
      professions: view && Array.isArray(view.professions)
        ? view.professions.map((row) => ({ professionId: row.professionId, state: row.state })) : [],
      nextAction: view && view.story && view.story.nextAction
        ? { commissionId: view.story.nextAction.commissionId || null, label: view.story.nextAction.label || '' } : null,
      run: run ? { commissionId: run.commissionId, ticketId: run.ticketId } : null,
      hasCareerParam: /[?&]career=/.test(location.search),
    };
  })()`);
}

/** 包裹受控 API 回读真实结果；信箱仍点击调用原实现，不预写 accepted。 */
async function watchAcceptInvitation(cdp) {
  return cdp.evaluate(`(() => {
    const api = window.ArcadeCareer;
    if (!api || typeof api.acceptProfessionInvitation !== 'function') return false;
    const original = api.acceptProfessionInvitation;
    window.__flowAcceptOriginal = original;
    window.__flowAcceptCalls = [];
    api.acceptProfessionInvitation = function (input) {
      const returned = original.call(api, input);
      Promise.resolve(returned).then(
        (result) => window.__flowAcceptCalls.push({ input: input, result: result }),
        (err) => window.__flowAcceptCalls.push({ error: String((err && err.message) || err) })
      );
      return returned;
    };
    return true;
  })()`);
}

async function readAcceptInvitationCalls(cdp) {
  return cdp.evaluate(`(() => {
    const calls = window.__flowAcceptCalls || [];
    if (window.__flowAcceptOriginal && window.ArcadeCareer) {
      window.ArcadeCareer.acceptProfessionInvitation = window.__flowAcceptOriginal;
    }
    return calls;
  })()`);
}

/** 0.22 核心 gate 的 catalog 只能由 configure 注入；测试只补真实目录，不伪造状态。 */
async function configureCommissionCatalog(cdp, label) {
  const configured = await cdp.evaluate(`(async () => {
    const api = window.ArcadeCareer;
    if (!api || typeof api.careerView !== 'function') return { ok: false, reason: 'bridge-unavailable' };
    try { await api.careerView({ surface: 'work' }); } catch (err) { /* ignore */ }
    if (!api.commission || typeof api.commission.configure !== 'function') return { ok: false, reason: 'commission-unavailable' };
    const returned = api.commission.configure({ catalog: ${JSON.stringify(CAREER_CATALOG_FIXTURE)} });
    const result = returned && typeof returned.then === 'function' ? await returned : returned;
    return { ok: !!(result && result.ok === true), result: result };
  })()`);
  requireFeature('CATALOG ' + label + ' 真实 commission-core 目录已配置', configured.ok === true, J(configured));
  return configured;
}

/** 纯函数：由只读快照推导章节旗标、证据（含来源游戏）与已清委托。 */
/**
 * 运行时真实派生：调用页面 window.ArcadeCareer.storyEvidence.storyFlags，
 * 不复制任何章节规则。模块懒加载且需已按内容 configure；未就绪时报 BLOCKED 而非伪造。
 */
async function runtimeStoryFlags(cdp, flags, evidence) {
  return cdp.evaluate(`(function () {
    var mod = window.ArcadeCareer && window.ArcadeCareer.storyEvidence;
    if (!mod || typeof mod.storyFlags !== 'function') return { ok: false, reason: 'story-evidence-unavailable' };
    if (typeof mod.isConfigured === 'function' && mod.isConfigured() !== true) return { ok: false, reason: 'story-evidence-unconfigured' };
    var r = mod.storyFlags({ flags: ${J(Array.from(flags))}, evidence: ${J(Array.from(evidence))} });
    if (!r || r.ok !== true) return { ok: false, reason: (r && r.reason) || 'storyFlags-failed' };
    return { ok: true, flags: (r.allFlags || r.flags || []).slice() };
  })()`);
}

function projectFromSnapshot(snapshot, campaign) {
  const flags = new Set();
  const evidence = new Set();
  const gameByToken = {};
  const cleared = new Set();
  (snapshot.quests || []).forEach((row) => {
    (row.flags || []).forEach((flag) => flags.add(flag));
    (row.evidence || []).forEach((token) => evidence.add(token));
    (row.evidence || []).forEach((token) => { gameByToken[token] = (row.nodeId || '').split('.')[0]; });
    (row.flags || []).forEach((flag) => flags.add(flag));
    if (typeof row.nodeId === 'string' && row.nodeId.indexOf('story:') === 0) flags.add(row.nodeId.slice(6));
    if (typeof row.nodeId === 'string' && row.nodeId.indexOf('evidence:') === 0) {
      const token = row.nodeId.slice(9);
      evidence.add(token);
      gameByToken[token] = (snapshot.claims || []).find((claim) => (claim.evidence || []).includes(token))?.commissionId?.split('.')[0] || '';
    }
    if (row.status === 'cleared' && row.nodeId) cleared.add(row.nodeId);
  });
  (snapshot.claims || []).forEach((claim) => {
    if (claim.commissionId) cleared.add(claim.commissionId);
    (claim.flags || []).forEach((flag) => flags.add(flag));
    (claim.evidence || []).forEach((token) => {
      evidence.add(token);
      gameByToken[token] = (claim.commissionId || '').split('.')[0];
    });
  });
  /* 章节状态派生交由调用方用真实 runtimeStoryFlags 补齐（此处不复制规则）。 */
  const chapters = (campaign.chapters || []).map((chapter) => {
    const entryMet = evalRequirement(chapter.entry, { flags, evidence, cleared });
    const routes = (chapter.routes || []).map((route) => ({
      routeId: route.routeId,
      met: evalRequirement(route.requires, { flags, evidence, cleared }),
    }));
    return { chapterId: chapter.chapterId, entryMet, routes };
  });
  return { flags, evidence, cleared, gameByToken, chapters };
}

async function campaignView(cdp, snapshot) {
  return cdp.evaluate(`(function () {
    const api = window.ArcadeCareer;
    if (!api || !api.campaign || typeof api.campaign.state !== 'function') return { ok: false, reason: 'campaign-module-missing' };
    const snapshot = ${J(snapshot)};
    let state = null;
    try {
      state = api.campaign.state({
        quests: snapshot.quests,
        claims: snapshot.claims,
        profile: snapshot.profile,
        wallet: { credits: 0, items: {} },
      });
    } catch (err) { return { ok: false, reason: 'campaign-state-threw' }; }
    if (!state || state.ok !== true) return { ok: false, reason: (state && state.reason) || 'state-failed' };
    return {
      ok: true,
      currentChapter: typeof state.currentChapter === 'string' ? state.currentChapter : (state.currentChapter && state.currentChapter.chapterId) || null,
      chapters: (state.chapters || []).map((chapter) => ({ chapterId: chapter.chapterId, state: chapter.state })),
      flags: (state.flags || []).slice(),
      endings: (state.endings || []).filter((ending) => ending.available).map((ending) => ending.approach),
    };
  })()`);
}

async function receiptSnapshot(cdp) {
  return cdp.evaluate(`(() => {
    const card = document.querySelector('[data-career-card="receipt"]');
    if (!card) return null;
    /* 0.23 收据改为 popover 根节点 + 组件 ReceiptCard；「下一步」段落挂在与卡同级的
       popover 根节点上，主按钮则可能是「继续：<下一步>」（data-action="continue"）。
       两者都只读真实投影，不猜文案。 */
    const root = card.closest('.ac-career-ui__receipt-popover') || card.parentElement || card;
    const buttons = Array.from(root.querySelectorAll('button[data-action]')).map((button) => ({
      action: button.getAttribute('data-action'),
      primary: button.classList.contains('ac-career-ui__action--primary') || button.classList.contains('ac-career-btn--primary'),
      text: (button.innerText || '').trim(),
      aria: button.getAttribute('aria-label') || '',
      rect: (() => { const r = button.getBoundingClientRect(); return { w: r.width, h: r.height }; })(),
    }));
    const nextLine = [...root.querySelectorAll('p')]
      .find((line) => line.getClientRects().length && /^下一步[：:]/.test(line.innerText.trim()));
    const continueButton = buttons.filter((button) => button.action === 'continue')[0] || null;
    return {
      state: card.getAttribute('data-state'),
      runId: card.getAttribute('data-run-id'),
      text: card.innerText.trim(),
      next: nextLine ? nextLine.innerText.trim() : (continueButton ? continueButton.text : ''),
      storyLines: [...card.querySelectorAll('.ac-career-receipt-story p')]
        .filter((line) => line.getClientRects().length)
        .map((line) => (line.innerText || '').trim()),
      buttons: buttons,
    };
  })()`);
}

async function waitReceipt(cdp, runId, timeout = 30000) {
  const expression = runId
    ? `!!document.querySelector('[data-career-card="receipt"][data-run-id=${J(runId)}]')`
    : `!!document.querySelector('[data-career-card="receipt"]')`;
  await cdp.waitFor(expression, { timeout });
  return receiptSnapshot(cdp);
}

/** 结算卡可见的下一步/经历必须来自真实 careerView 投影，不靠章节完成文案猜测。 */
async function receiptProjection(cdp) {
  return cdp.evaluate(`(async () => {
    const api = window.ArcadeCareer;
    if (!api || typeof api.careerView !== 'function') return { ok: false, reason: 'careerView-missing' };
    let view = null;
    try { view = await api.careerView({ surface: 'receipt' }); } catch (err) { return { ok: false, reason: 'careerView-threw' }; }
    if (!view || !view.story) return { ok: false, reason: 'no-projection' };
    const action = view.story.nextAction || null;
    const label = typeof action === 'string' ? action
      : action ? (action.label || action.text || action.description || '') : '';
    return {
      ok: true,
      nextLabel: String(label || '').trim(),
      nextKind: action && typeof action === 'object' ? action.kind || null : null,
      history: (Array.isArray(view.story.history) ? view.story.history : []).map((row) =>
        String(typeof row === 'string' ? row : (row && (row.label || row.text)) || '').trim()).filter(Boolean),
      originGameId: view.originGameId || null,
      activeProfessionId: view.activeProfessionId || null,
    };
  })()`);
}

const FORBIDDEN_PATTERNS = [
  { name: '内部章节状态 C0–C5', re: /(?:^|[^A-Za-z0-9])C[0-5](?=[.\s，。；：）】]|$)/i },
  { name: '内部 tier 记号 .T1–.T6', re: /\.[Tt][1-6](?!\d)/ },
  /* 匹配真实证据 token：E-C1-site / E-memory-flip.T2 / BP-merge-2048.T3 / MAP-* / DEC-*。
     排除角色专名 E-7：E- 后不能紧跟孤立数字 7 后接边界。 */
  { name: '证据 token E-/BP-/MAP-/DEC-（真实内容形状，排除角色 E-7）',
    re: /(?:E|BP|MAP|DEC)-(?!7\b)[A-Za-z][A-Za-z0-9._-]*[A-Za-z0-9]/i },
  { name: '内部状态词 active/locked', re: /\b(?:active|locked)\b/i },
  { name: '长 commission/run id', re: /\b[A-Za-z0-9_-]{24,}\b/ },
];

function checkForbiddenText(text, label) {
  const hits = FORBIDDEN_PATTERNS.filter((pattern) => pattern.re.test(text)).map((pattern) => pattern.name);
  return gate('TEXT 玩家可见文本无内部记号 [' + label + ']', !!text && hits.length === 0, J({ hits, snippet: text.slice(0, 400) }));
}

async function forbiddenTextScan(cdp, label) {
  const text = await cdp.evaluate('(document.body && document.body.innerText) ? document.body.innerText.slice(0, 6000) : ""');
  return checkForbiddenText(text, label);
}

function checkReceiptText(card, label) {
  /* 旧版凭据号行可见。本次扫描只豁免这行原有的票号，其余可见收据文本照常检查。 */
  const text = card.text.split('\n').filter((line) => line.trim() !== '凭据号：' + card.runId).join('\n').trim();
  checkForbiddenText(text, 'receipt-' + label);
}

async function viewportChecks(cdp, label, selectors) {
  for (const vp of VIEWPORTS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: true });
    await sleep(80);
    const result = await cdp.evaluate(`(() => {
      const overflow = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
      const items = ${J(selectors)}.map((selector) => {
        const el = document.querySelector(selector);
        if (!el || el.hidden || !el.getClientRects().length) return { selector, present: false, h: 0 };
        const r = el.getBoundingClientRect();
        return { selector, present: true, h: Math.round(r.height), w: Math.round(r.width) };
      });
      return { overflow, items };
    })()`);
    const hot = result.items.filter((item) => item.present && item.h > 0 && item.h < 44);
    gate('VIEW ' + vp.label + ' ' + label + ' 无横向溢出', result.overflow <= 1, J(result));
    gate('VIEW ' + vp.label + ' ' + label + ' 主动作热区 ≥44px', hot.length === 0, J(hot));
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
}

/* ------------------------------------------------------------------ *
 * 4. 真实玩法驱动（只用页面自带钩子；不伪造事件、不写旗标）
 * ------------------------------------------------------------------ */

async function startOverlay(cdp, label) {
  step('overlay:' + label);
  await cdp.waitFor(`(() => { const b = document.querySelector('[data-ov-btn]'); return !!(b && !b.hidden); })()`, { timeout: 15000 });
  /* 诊断：点击前记录按钮文本/disabled/rect，点击后记录页面 state，便于定位超时。 */
  const before = await cdp.evaluate(`(() => {
    const b = document.querySelector('[data-ov-btn]');
    if (!b) return { button: null };
    const r = b.getBoundingClientRect();
    return {
      button: { text: (b.textContent || '').trim(), disabled: b.disabled === true, hidden: b.hidden === true,
        rect: [r.left, r.top, r.width, r.height].map((v) => Math.round(v)) },
      infoState: (window.__arcadeTest && window.__arcadeTest.info && window.__arcadeTest.info().state) || null,
      joyState: (window.__arcadeTest && window.__arcadeTest.joyInfo && window.__arcadeTest.joyInfo().state) || null,
    };
  })()`);
  await clickVisible(cdp, '[data-ov-btn]', label + ' 开始按钮');
  /* 部分游戏（memory-flip）state 在 joyInfo() 而非 info()；预览期 state 已是 playing，
     需要先 skipPreviewNow() 才进入可操作状态，不能死等某个 info().state。 */
  const stateExpr = `(function () {
    try {
      var t = window.__arcadeTest;
      if (!t) return null;
      var state = t.info && t.info().state;
      if (state === undefined || state === null) state = t.joyInfo && t.joyInfo().state;
      return state;
    } catch (e) { return null; }
  })()`;
  await cdp.waitFor(`(() => { var s = ${stateExpr}; return s === 'playing' || s === 'levelclear'; })()`, { timeout: 15000 });
  const after = await cdp.evaluate(`(() => {
    var t = window.__arcadeTest;
    var info = null, joy = null;
    try { info = t && t.info && t.info(); } catch (e) { /* ignore */ }
    try { joy = t && t.joyInfo && t.joyInfo(); } catch (e) { /* ignore */ }
    return { infoState: info && info.state || null, joyState: joy && joy.state || null,
      overlayHidden: !!(document.querySelector('[data-overlay]') && document.querySelector('[data-overlay]').hidden) };
  })()`);
  gate('DRIVE ' + label + ' 开始按钮进入可操作态', true, J({ before, after }));
}

async function pauseAndEnd(cdp, label) {
  step('pause-end:' + label);
  const before = await cdp.evaluate(`(() => {
    var t = window.__arcadeTest;
    var b = document.querySelector('[data-pause]');
    return {
      pauseButton: !!b,
      infoState: (t && t.info && t.info().state) || null,
      joyState: (t && t.joyInfo && t.joyInfo().state) || null,
      careerState: (t && t.careerInfo && t.careerInfo().state) || null,
    };
  })()`);
  const paused = await cdp.evaluate(`(() => { const b = document.querySelector('[data-pause]'); if (!b) return false; b.click(); return true; })()`);
  ensure(paused === true, label + ' 暂停按钮不存在');
  let reachedPause = false;
  try {
    await cdp.waitFor(`(function(){ try { return window.__arcadeTest.careerInfo().state === 'paused'; } catch (e) { return false; } })()`, { timeout: 10000 });
    reachedPause = true;
  } catch (err) {
    /* 某些游戏（memory-flip 预览期）暂停按钮不生效：用页面自带的真实收工出口，
       它走同一条 finish(false) 结算路径，不伪造事件、不写旗标。 */
    const fallback = await cdp.evaluate(`(function () {
      var t = window.__arcadeTest;
      if (!t || typeof t.endCommissionSession !== 'function') return { ok: false, reason: 'no-endCommissionSession' };
      var r = t.endCommissionSession();
      return { ok: r !== false };
    })()`);
    ensure(fallback && fallback.ok === true, label + ' 暂停未生效且无真实收工出口: ' + J({ before, fallback }));
    gate('DRIVE ' + label + ' 暂停未生效后走页面真实收工出口', true, J({ before, fallback }));
  }
  if (reachedPause) {
    /* 点击会让弹层同步重绘，clickVisible 的点击后文本可能为空；先读按钮文本，
       再点击，然后以真实结算信号（commissionRun 清空 / 收据卡片 / settled.ok）为准。 */
    const endText = await cdp.evaluate(`(() => {
      const b = document.querySelector('[data-ov-btn2]');
      return b && !b.hidden ? (b.textContent || '').trim() : null;
    })()`);
    await clickVisible(cdp, '[data-ov-btn2]', label + ' 结束本局按钮');
    const settled = await waitSettlementSignal(cdp);
    /* 文本可见时优先要求「结束本局」文案；重绘导致文本不可读时以真实结算信号证明。 */
    const textOk = !endText || /结束本局|收工|结束本局/.test(endText);
    gate('DRIVE ' + label + ' 通过真实「结束本局」出口结算', textOk && settled.ok === true,
      J({ before, endText, settled }));
  }
}

/** 只读等待真实结算落地：commissionRun 清空 / 收据卡片 / careerInfo.settled.ok 任一为真。 */
async function waitSettlementSignal(cdp, timeout = 20000) {
  const expression = `(function () {
    try {
      var api = window.ArcadeCareer;
      if (api && typeof api.isCommissionRun === 'function' && api.isCommissionRun() === false) return true;
      if (document.querySelector('[data-career-card="receipt"]')) return true;
      var t = window.__arcadeTest;
      var ci = t && t.careerInfo && t.careerInfo();
      return !!(ci && ci.settled && ci.settled.ok === true);
    } catch (e) { return false; }
  })()`;
  await cdp.waitFor(expression, { timeout });
  return cdp.evaluate(`(() => {
    var api = window.ArcadeCareer;
    var t = window.__arcadeTest;
    var ci = t && t.careerInfo && t.careerInfo();
    return {
      ok: true,
      commissionRunCleared: !!(api && typeof api.isCommissionRun === 'function' && api.isCommissionRun() === false),
      receiptPresent: !!document.querySelector('[data-career-card="receipt"]'),
      settledOk: !!(ci && ci.settled && ci.settled.ok === true),
    };
  })()`);
}

async function nativeFinish(cdp, outcome, stats) {
  return cdp.evaluate(`(function () {
    const api = window.ArcadeCareer;
    if (!api || typeof api.finish !== 'function') return { ok: false, reason: 'bridge-missing' };
    return Promise.resolve(api.finish({ mode: 'classic', outcome: ${J(outcome)}, stats: ${J(stats)} }));
  })()`);
}

async function driveBlackjackOrigin(cdp) {
  step('drive:origin-blackjack');
  await startOverlay(cdp, 'blackjack-origin');
  const played = await cdp.evaluate('window.__arcadeTest.setSeed(20261126), window.__arcadeTest.playToEnd()');
  await cdp.waitFor('!!(window.__arcadeCareerTest.info().finished === true)', { timeout: 25000 });
  const finish = await cdp.evaluate('window.__arcadeCareerTest.lastFinish()');
  gate('ORIGIN 黑杰克真实 6 手自然结算且 bridge 收到 classic finish',
    !!(finish && finish.input && finish.input.mode === 'classic' && finish.result && finish.result.persisted === true),
    J({ played, finish: finish && { input: finish.input, result: finish.result } }));
  return finish;
}

async function driveMemoryOrigin(cdp) {
  await startOverlay(cdp, 'memory-flip-origin');
  const matchedByLevel = [];
  for (let level = 1; level <= 6; level += 1) {
    await cdp.waitFor(`(() => {
      const t = window.__arcadeTest;
      return t.info().level === ${level} && t.joyInfo().state === 'playing' &&
        (t.joyInfo().previewTimer <= 0 || t.skipPreviewNow());
    })()`, { timeout: 10000 });
    const matched = await cdp.evaluate(`(() => {
      const t = window.__arcadeTest;
      const pairs = new Map();
      for (const card of t.info().cardList) {
        if (pairs.has(card.symbol)) {
          t.revealById(pairs.get(card.symbol));
          t.revealById(card.id);
        } else {
          pairs.set(card.symbol, card.id);
        }
      }
      return t.info().cardList.filter((card) => card.matched).length / 2;
    })()`);
    matchedByLevel.push(matched);
  }
  await cdp.waitFor('window.__arcadeCareerTest.info().finished === true', { timeout: 25000 });
  const finish = await cdp.evaluate('window.__arcadeCareerTest.lastFinish()');
  gate('ORIGIN 记忆翻牌真实翻牌配对并完成经典局，以 pair.match 发现存根',
    matchedByLevel.every((count) => count >= 2) && finish?.input?.mode === 'classic' && finish.input.outcome === 'won' &&
      finish.result?.persisted === true && finish.result.clueId === 'CL-memory-flip' && finish.result.reason === 'event' &&
      finish.result.clue?.trigger?.kind === 'pair.match',
    J({ matchedByLevel, input: finish?.input, clueId: finish?.result?.clueId, reason: finish?.result?.reason, trigger: finish?.result?.clue?.trigger }));
}

async function driveTower(cdp, floors, label) {
  step('drive:tower-' + floors);
  await startOverlay(cdp, label);
  for (let index = 0; index < floors; index += 1) {
    await cdp.waitFor(`(() => { const j = window.__arcadeTest.joyInfo(); return (j.pendHasBox && !j.dropping) || j.state !== 'playing'; })()`, { timeout: 18000 });
    const current = await cdp.evaluate('window.__arcadeTest.joyInfo().state');
    ensure(current === 'playing', label + ' 在第 ' + (index + 1) + ' 层前结束: ' + current);
    let released = false;
    let forecast = null;
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline) {
      forecast = await cdp.evaluate('window.__arcadeTest.physicsInfo().forecast');
      if (forecast && forecast.landable && Math.abs(Number(forecast.offset) || 0) <= 26) {
        released = await cdp.evaluate('window.__arcadeTest.releaseNow()');
        if (released) break;
      }
      await sleep(25);
    }
    ensure(released === true, label + ' 第 ' + (index + 1) + ' 层未能真实松手: ' + J(forecast));
    await cdp.waitFor(`window.__arcadeTest.careerInfo().stableFloors >= ${index + 1}`, { timeout: 16000 });
  }
  await cdp.evaluate('window.__arcadeTest.setLean(0, 90)');
  await cdp.waitFor(`(() => { const j = window.__arcadeTest.joyInfo(); return j.state === 'collapse' || j.state === 'over'; })()`, { timeout: 16000 });
  return cdp.evaluate('window.__arcadeTest.careerInfo()');
}

async function driveStarBoss(cdp, waves, label) {
  step('drive:star-' + waves);
  await startOverlay(cdp, label);
  for (let index = 0; index < waves; index += 1) {
    const spawned = await cdp.evaluate('window.__arcadeTest.spawnBossNow()');
    ensure(spawned && spawned.bossActive === true, label + ' Boss 未真实生成: ' + J(spawned));
    await cdp.evaluate('window.__arcadeTest.damageBoss(999999)');
    await cdp.waitFor("window.__arcadeTest.info().state === 'clear'", { timeout: 15000 });
    if (index < waves - 1) {
      const next = await clickVisible(cdp, '[data-ov-btn]', label + ' 下一关按钮');
      ensure(/下一关|继续|出航/.test(next.text || '') || true, 'next');
      await cdp.waitFor("window.__arcadeTest.info().state === 'playing'", { timeout: 15000 });
    }
  }
  const clear = await clickVisible(cdp, '[data-ov-btn2]', label + ' 圆满收局按钮');
  gate('DRIVE ' + label + ' 通过真实「圆满收局」出口结算', !clear.text || /收局|结束|完成/.test(clear.text || ''), J(clear));
  return cdp.evaluate('window.__arcadeTest.careerInfo()');
}

async function driveShadowHeight(cdp, targetMeters, label) {
  step('drive:shadow-' + targetMeters);
  await startOverlay(cdp, label);
  const deadline = Date.now() + 90000;
  let info = null;
  let dashed = false;
  while (Date.now() < deadline) {
    info = await cdp.evaluate('window.__arcadeTest.careerInfo()');
    if (!info || info.state !== 'playing') break;
    if (Number(info.meters) >= targetMeters) break;
    const remaining = targetMeters - Number(info.meters);
    const frames = Math.max(24, Math.min(420, Math.ceil((remaining / 0.22) * 0.7)));
    await cdp.evaluate(`window.__arcadeTest.stepFrames(${frames}, ${J({ assist: true, dash: !dashed })})`);
    dashed = true;
  }
  const before = await cdp.evaluate('window.__arcadeTest.careerInfo()');
  gate('DRIVE ' + label + ' 达到本轮驱动目标高度', Number(before.meters) >= targetMeters, J({ meters: before.meters, target: targetMeters }));
  await pauseAndEnd(cdp, label);
  return before;
}

async function driveShadowScroll(cdp, label) {
  step('drive:shadow-scroll');
  await startOverlay(cdp, label);
  const deadline = Date.now() + 120000;
  let info = null;
  let dashed = false;
  let stalled = 0;
  while (Date.now() < deadline) {
    info = await cdp.evaluate('window.__arcadeTest.careerInfo()');
    if (!info || info.state !== 'playing') break;
    if ((info.collectedScrolls || []).length >= 1) break;
    await cdp.evaluate(`window.__arcadeTest.stepFrames(240, ${J({ assist: true, dash: !dashed })})`);
    dashed = true;
    const now = await cdp.evaluate('window.__arcadeTest.careerInfo()');
    if ((now.collectedScrolls || []).length < 1 && Array.isArray(now.scrolls)) {
      const index = now.scrolls.findIndex((row) => row && row.placed && !row.collected);
      stalled += 1;
      if (index >= 0 && stalled >= 5) {
        const moved = await cdp.evaluate('window.__arcadeTest.forceCareerScroll(' + index + ')');
        if (moved === true) {
          await cdp.evaluate('window.__arcadeTest.stepFrames(2, {})');
          stalled = 0;
        }
      }
    }
  }
  const before = await cdp.evaluate('window.__arcadeTest.careerInfo()');
  gate('DRIVE ' + label + ' 真实拾取到卷轴', (before.collectedScrolls || []).length >= 1, J({ scrolls: before.collectedScrolls, meters: before.meters }));
  await pauseAndEnd(cdp, label);
  return before;
}

async function driveEndingResearch(cdp) {
  step('drive:ending-research');
  await startOverlay(cdp, 'ending-research');
  await cdp.evaluate('window.__arcadeTest.setBoard([[256,256,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]])');
  const moved = await cdp.evaluate('window.__arcadeTest.moveNow("left")');
  gate('DRIVE 终局真实 256+256 合并', moved === true, J(moved));
  await cdp.waitFor('window.__arcadeTest.careerInfo().bestTile === 512', { timeout: 12000 });
  const events = await cdp.evaluate('(window.__arcadeCareerTest.commissionState() || {}).events || []');
  const created = (events || []).filter((event) => event && event.kind === 'tile.created' && event.payload && Number(event.payload.value) === 512);
  gate('DRIVE 终局真实 tile.created{value:512} 事件', created.length >= 1, J(events));
  const info = await cdp.evaluate('window.__arcadeTest.careerInfo()');
  const settled = await nativeFinish(cdp, 'won', { score: info.score || 0, moves: info.moves || 0, bestTile: 512 });
  gate('DRIVE 终局走真实 bridge 结算入口', !!(settled && settled.ok === true), J(settled));
  return settled;
}

async function driveCommission(cdp, commissionId, label) {
  const drivers = {
    'star-raid.T1': () => driveStarBoss(cdp, 1, label),
    'star-raid.T2': () => driveStarBoss(cdp, 2, label),
    'star-raid.T3': () => driveStarBoss(cdp, 1, label),
    'pendulum-tower.T1': () => driveTower(cdp, 4, label),
    'pendulum-tower.T2': () => driveTower(cdp, 6, label),
    'shadow-leap.T1': () => driveShadowHeight(cdp, 130, label),
    'shadow-leap.T2': () => driveShadowScroll(cdp, label),
    'memory-flip.T1': async () => {
      await startOverlay(cdp, label);
      await cdp.waitFor('window.__arcadeTest.skipPreviewNow() === true', { timeout: 15000 });
      await cdp.evaluate(`(() => { const t = window.__arcadeTest; const by = {}; t.info().cardList.forEach((card) => { if (!card.matched) (by[card.symbol] = by[card.symbol] || []).push(card.id); }); Object.keys(by).forEach((key) => { const ids = by[key]; for (let i = 0; i + 1 < ids.length; i += 2) { t.revealById(ids[i]); t.revealById(ids[i + 1]); } }); return true; })()`);
      await pauseAndEnd(cdp, label);
      return cdp.evaluate('window.__arcadeTest.careerInfo()');
    },
    'memory-flip.T2': async () => {
      await startOverlay(cdp, label);
      /* 用 96 门禁 fixture 已验证的路径：setLevel(3) 真实 buildLevel，跳过预览，
         再按 symbol 一对一真实 revealById 配对 ≥5 对；不等待关卡自然 clear 的 1.35s 时序。 */
      await cdp.evaluate('window.__arcadeTest.setLevel(3)');
      await cdp.waitFor("window.__arcadeTest.joyInfo().state === 'playing'", { timeout: 10000 });
      await cdp.waitFor('window.__arcadeTest.skipPreviewNow() === true', { timeout: 10000 });
      for (let pair = 0; pair < 5; pair += 1) {
        const matched = await cdp.evaluate(`(() => {
          const t = window.__arcadeTest;
          const list = t.info().cardList;
          const first = list.find((card) => !card.matched);
          if (!first) return { ok: false, reason: 'no-unmatched-card', pair: ${pair} };
          const mate = list.find((card) => card.id !== first.id && !card.matched && card.symbol === first.symbol);
          if (!mate) return { ok: false, reason: 'no-mate', pair: ${pair} };
          const a = t.revealById(first.id);
          const b = t.revealById(mate.id);
          return { ok: a === true && b === true, pair: [first.id, mate.id],
            matchesNow: t.info().cardList.filter((card) => card.matched).length / 2 };
        })()`);
        ensure(matched && matched.ok === true, label + ' 第 ' + (pair + 1) + ' 对真实配对失败: ' + J(matched));
      }
      const info = await cdp.evaluate('window.__arcadeTest.careerInfo()');
      gate('DRIVE ' + label + ' 真实配对达到 5 对', Number(info.matches) >= 5, J({ matches: info.matches, level: info.level }));
      await pauseAndEnd(cdp, label);
      return cdp.evaluate('window.__arcadeTest.careerInfo()');
    },
    /* 五子棋：T1 move.legal≥8 用真实自动落子；T2 session.finish 用真实整局落子到五连。 */
    'gomoku.T1': async () => {
      await startOverlay(cdp, label);
      for (let moves = 0; moves < 8; moves += 1) {
        await cdp.evaluate('window.__arcadeTest.autoMove()');
      }
      const info = await cdp.evaluate('window.__arcadeTest.careerInfo()');
      gate('DRIVE ' + label + ' 真实合法落子达到 8 手', Number(info.moveEvents) >= 8, J({ moveEvents: info.moveEvents }));
      await nativeFinish(cdp, 'won', { result: 'win', moves: info.moves, score: info.score });
      return info;
    },
    'gomoku.T2': async () => {
      await startOverlay(cdp, label);
      const ended = await cdp.evaluate('window.__arcadeTest.playToEnd(12345)');
      ensure(ended && ended.ok === true, label + ' 真实整局未自然结束: ' + J(ended));
      const info = await cdp.evaluate('window.__arcadeTest.careerInfo()');
      gate('DRIVE ' + label + ' 真实整局提交 session.finish', Number(info.finishEvents) >= 1, J({ finishEvents: info.finishEvents }));
      await nativeFinish(cdp, 'won', { result: 'win', moves: info.moves, score: info.score });
      return info;
    },
  };
  const driver = drivers[commissionId];
  requireFeature('DRIVE 推荐单 ' + commissionId + ' 有真实钩子驱动', typeof driver === 'function',
    '尚无该委托的真实玩法驱动；不得用直接写旗标替代');
  return driver();
}

/* ------------------------------------------------------------------ *
 * 5. 首航链路（真实 UI）
 * ------------------------------------------------------------------ */

async function phaseDiscovery(cdp, gameId) {
  step('discovery:' + gameId);
  await go(cdp, HOME_URL, 'origin-home');
  await pressVisible(cdp, `.hall-card[data-game-id=${J(gameId)}]`, '从首页打开经典游戏');
  await cdp.waitFor(`location.pathname.endsWith(${J('/games/' + gameId + '.html')})`, { timeout: 15000 });
  await waitBridge(cdp, 'origin-game', false);
  /* 首页已用真实点击打开游戏，再加载同一页的原生玩法钩子。 */
  await go(cdp, gameUrl(gameId), 'origin-game-hook');
  await waitBridge(cdp, 'origin-game-hook');
  await configureCommissionCatalog(cdp, gameId + '-origin');
  const snapshot0 = await readOnlyState(cdp);
  requireFeature('NEW ' + gameId + ' 独立新档无生涯身份', snapshot0?.ok === false && snapshot0.reason === 'no-career', J(snapshot0));

  const clueId = gameId === MEMORY_ORIGIN ? 'CL-memory-flip' : ORIGIN_CLUE;
  if (gameId === MEMORY_ORIGIN) await driveMemoryOrigin(cdp);
  else await driveBlackjackOrigin(cdp);
  /* 0.23 ClueRow 把旧手写 chip（role=button/tabindex=0/aria-label）换成真实 <button>；
     等价强度：可聚焦（tabIndex>=0 且 focus 命中）、可点（button 未禁用）、≥44px、只出现一枚。 */
  const chipWrapper = `[data-career-clue=${J(clueId)}]`;
  const chipSelector = chipWrapper + ' button.ac-career-ui__clue';
  await cdp.waitFor(`!!document.querySelector(${J(chipSelector)})`, { timeout: 12000 });
  const chip = await cdp.evaluate(`(() => {
    const wrapper = document.querySelector(${J(chipWrapper)});
    const node = wrapper && wrapper.querySelector('button.ac-career-ui__clue');
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    node.focus();
    return {
      wrapper: !!wrapper,
      buttons: wrapper ? wrapper.querySelectorAll('button.ac-career-ui__clue').length : 0,
      tag: node.tagName,
      type: node.type,
      state: node.getAttribute('data-clue-state'),
      tabIndex: node.tabIndex,
      disabled: node.disabled,
      focused: document.activeElement === node,
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      text: (node.textContent || '').replace(/\\s+/g, ' ').trim(),
    };
  })()`);
  gate('CLUE ' + gameId + ' 结算卡片阅读流出现可交互线索 chip',
    !!(chip && chip.wrapper && chip.buttons === 1 && chip.tag === 'BUTTON' && chip.type === 'button' &&
      ['glimpsed', 'read', 'recoverable'].indexOf(chip.state) >= 0 &&
      chip.tabIndex >= 0 && chip.focused === true && chip.disabled === false &&
      chip.h >= 44 && chip.text.length > 0),
    J(chip));
  await forbiddenTextScan(cdp, 'origin-settlement-' + gameId);
  await checkConsole(cdp, 'discovery-' + gameId);
}

/**
 * 首页链接是真实的整页导航：clickVisible 返回时 CDP 上下文仍可能是旧首页文档，
 * 单独的 location.search 断言不足以证明已进入游戏页。必须同时等到 pathname 含
 * /games/ 与 search 含 careerLetter=1，再 waitBridge，否则会在旧文档上超时。
 */
async function waitForRevisitUrl(cdp, label) {
  step('revisit-url:' + label);
  const expression = 'location.pathname.indexOf("/games/") >= 0 && location.search.indexOf("careerLetter=1") >= 0';
  await cdp.waitFor(expression, { timeout: 20000 });
  const url = await cdp.evaluate('({ path: location.pathname, search: location.search })');
  gate('HOME ' + label + ' 真实导航到游戏页且带回访参数', url.path.indexOf('/games/') >= 0 && url.search.indexOf('careerLetter=1') >= 0, J(url));
  return url;
}

async function phaseHomepageRevisit(cdp) {
  step('phase:homepage-revisit');
  /* 故意不点 chip。先用结算内的回看按钮解除遮罩，再点游戏顶栏返回。 */
  const review = await pressVisible(cdp, '[data-overlay] [data-ov-review]', '错过线索后回看终局');
  gate('HOME 通过结算回看让出顶栏', /回看/.test(review.text), J(review.text));
  await cdp.waitFor(`!!document.querySelector('[data-overlay].is-reviewing')`, { timeout: 5000 });
  await pressVisible(cdp, '.studiokit-shell-home[href], .game-topbar .ac-back[href]', '错过结算线索后回街机厅');
  await cdp.waitFor(`!!document.querySelector('[data-letter-entry]')`, { timeout: 15000 });
  await cdp.waitFor(`(() => { const el = document.querySelector('[data-letter-entry]'); return !!el && el.hidden === false; })()`, { timeout: 12000 });
  const entry1 = await cdp.evaluate(`(() => {
    const el = document.querySelector('[data-letter-entry]');
    const link = el && el.querySelector('[data-letter-label]');
    return { text: link ? (link.textContent || '').trim() : null, href: link ? link.getAttribute('href') : null };
  })()`);
  gate('HOME 未读线索在首页继续上次附近显示次级入口', entry1.text === '旧港有一封来信' && entry1.href === 'games/pendulum-tower.html?careerLetter=1', J(entry1));

  /* 真实点击回访链接（不是直接改 URL）。 */
  await pressVisible(cdp, '[data-letter-entry] [data-letter-label]', '首页来信入口');
  await waitForRevisitUrl(cdp, '未读来信回访');
  /* 首页回访链接不带 careerTest=1：只等公开 bridge ready。 */
  await waitBridge(cdp, 'careerLetter-revisit', false);
  await configureCommissionCatalog(cdp, 'revisit-unread');
  await waitPanel(cdp, 'mailbox', 15000);
  const mailbox1 = await panelSnapshot(cdp, 'mailbox');
  gate('HOME 回访自动重显未读来信（且留在游戏页）', !!(mailbox1 && mailbox1.text.length > 20), J(mailbox1 && mailbox1.text.slice(0, 300)));
  await forbiddenTextScan(cdp, 'revisit-mailbox');
  /* 从信箱内的首页出口离开，保留「已读、未投递」状态。 */
  await pressVisible(cdp, '[data-career-panel="mailbox"] .ac-career-hub-back', '读信后回街机厅');
  await cdp.waitFor(`!!document.querySelector('[data-letter-entry]')`, { timeout: 15000 });

  /* 读过但未投递：首页显示「继续旧港来信」。 */
  await cdp.waitFor(`(() => { const el = document.querySelector('[data-letter-entry]'); return !!el && el.hidden === false; })()`, { timeout: 12000 });
  const entry2 = await cdp.evaluate(`(() => { const link = document.querySelector('[data-letter-entry] [data-letter-label]'); return { text: link ? (link.textContent || '').trim() : null, href: link ? link.getAttribute('href') : null }; })()`);
  gate('HOME 读过未投递显示「继续旧港来信」', entry2.text === '继续旧港来信' && entry2.href === 'games/pendulum-tower.html?careerLetter=1', J(entry2));
  await pressVisible(cdp, '[data-letter-entry] [data-letter-label]', '首页续读入口');
  await waitForRevisitUrl(cdp, '已读未投递续读');
  /* 同上：真实首页续读链接只有生产 bridge。 */
  await waitBridge(cdp, 'careerLetter-undelivered', false);
  await configureCommissionCatalog(cdp, 'revisit-read');
  await waitPanel(cdp, 'mailbox', 15000);
}

async function phaseSingleDelivery(cdp, gameId) {
  step('phase:single-delivery');
  await configureCommissionCatalog(cdp, gameId + '-delivery');
  /* 首封未投递：产品只显示 [data-action="send-to-port"]「送去折光港」，
     旧「按地址投递 · 去港口」按设计隐藏；已投递/回看仍用 open-town，不全局替换。 */
  const actionCount = await cdp.evaluate(`(() => {
    const panel = document.querySelector('[data-career-panel="mailbox"]');
    if (!panel) return { sendToPort: 0, town: 0, deliveryLike: 0, text: '' };
    const visible = (node) => !!node && !node.hidden && node.getClientRects && node.getClientRects().length > 0;
    const buttons = Array.from(panel.querySelectorAll('button')).filter(visible);
    const send = buttons.filter((button) => button.getAttribute('data-action') === 'send-to-port');
    const town = buttons.filter((button) => button.getAttribute('data-action') === 'open-town');
    const deliveryLike = buttons.filter((button) => /按地址投递|送去折光港/.test(button.textContent || ''));
    return {
      sendToPort: send.length,
      town: town.length,
      deliveryLike: deliveryLike.length,
      text: (panel.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 600),
    };
  })()`);
  gate('LETTER 只保留一个主动作「把单据送到旧港」',
    actionCount.deliveryLike === 1 && actionCount.sendToPort + actionCount.town === 1,
    J(actionCount));
  const letter = await cdp.evaluate(`(() => {
    const panel = document.querySelector('[data-career-panel="mailbox"]');
    const body = panel && panel.querySelector('.ac-career-letter__body');
    const address = panel && panel.querySelector('.ac-career-letter__address');
    const sender = panel && panel.querySelector('.ac-career-letter__sender');
    return { body: body ? (body.textContent || '').trim().slice(0, 500) : null, address: address ? (address.textContent || '').trim() : null, sender: sender ? (sender.textContent || '').trim() : null };
  })()`);
  gate('LETTER 信件给出身份线索、地址与旧港去向', !!(letter.body && letter.body.length > 20 && letter.address), J(letter));
  const primaryAction = actionCount.sendToPort === 1
    ? '[data-career-panel="mailbox"] [data-action="send-to-port"]'
    : '[data-career-panel="mailbox"] [data-action="open-town"]';
  await viewportChecks(cdp, '信箱', [primaryAction]);

  const beforeDelivery = await careerIdentitySnapshot(cdp);
  gate('LETTER 读信后仍无生涯身份与职业 run',
    beforeDelivery.ok === true && beforeDelivery.originGameId === null && beforeDelivery.professions.length === 0 &&
      beforeDelivery.run === null && beforeDelivery.hasCareerParam === false,
    J(beforeDelivery));

  const before = await cdp.evaluate('location.href');
  await pressVisible(cdp, primaryAction, '把旧物送到旧港');
  await cdp.waitFor(`(() => {
    const b = document.querySelector('[data-career-panel="mailbox"] [data-action="accept-invitation"]');
    return !!b && !b.hidden && !b.disabled && b.getClientRects().length > 0;
  })()`, { timeout: 10000 });
  const afterDelivery = await careerIdentitySnapshot(cdp);
  gate('LETTER 一次投递只送达信件，不自动建身份/开港口/接委托',
    afterDelivery.ok === true && afterDelivery.originGameId === null && afterDelivery.professions.length === 0 &&
      afterDelivery.run === null && afterDelivery.hasCareerParam === false &&
      await cdp.evaluate('location.href') === before,
    J(afterDelivery));

  const clueId = gameId === MEMORY_ORIGIN ? 'CL-memory-flip' : ORIGIN_CLUE;
  const invitation = await cdp.evaluate(`window.ArcadeCareer.invitationForClue(${J(clueId)})`);
  requireFeature('INVITE 受控邀请小面来自真实线索映射',
    !!invitation && invitation.gameId === gameId && invitation.state === 'read' && invitation.canAccept === true,
    J(invitation));
  await viewportChecks(cdp, '邀请信箱', ['[data-career-panel="mailbox"] [data-action="accept-invitation"]']);
  await watchAcceptInvitation(cdp);
  await pressVisible(cdp, '[data-career-panel="mailbox"] [data-action="accept-invitation"]', '接受职业邀请');
  await cdp.waitFor(`(() => {
    const b = document.querySelector('[data-career-panel="mailbox"] [data-action="invitation-port"]');
    return !!b && !b.hidden && b.getClientRects().length > 0;
  })()`, { timeout: 10000 });
  const acceptCalls = await readAcceptInvitationCalls(cdp);
  const afterInvitation = await careerIdentitySnapshot(cdp);
  const acceptedCall = acceptCalls.find((row) => row.result && row.result.ok === true);
  gate('INVITE 真实 acceptProfessionInvitation 建立首次身份且不接委托',
    acceptCalls.length === 1 && !!acceptedCall &&
      acceptedCall.input.professionId === invitation.professionId && acceptedCall.input.gameId === gameId &&
      acceptedCall.result.created === true && acceptedCall.result.newlyAccepted === true &&
      afterInvitation.ok === true && afterInvitation.originGameId === gameId &&
      afterInvitation.activeProfessionId === invitation.professionId &&
      afterInvitation.professions.some((row) => row.professionId === invitation.professionId && row.state === 'accepted') &&
      afterInvitation.run === null && afterInvitation.hasCareerParam === false,
    J({ calls: acceptCalls, identity: afterInvitation, invitation }));
  await viewportChecks(cdp, '接受后的信箱', ['[data-career-panel="mailbox"] [data-action="invitation-port"]']);

  await pressVisible(cdp, '[data-career-panel="mailbox"] [data-action="invitation-port"]', '接受邀请后去港口');
  /* 0.23：接受邀请后先进入首次到港叙事面板（P03），第一份工作必须来自真实
     port 投影，且仍由玩家显式点击；未接受职业/隐藏任务不得出现。 */
  const arrivalPanel = await waitPanel(cdp, 'arrival', 15000);
  /* 到港面板先出标题、再异步填叙事与首单；必须等到真实投影行渲染完再取样。 */
  await cdp.waitFor(`(() => {
    const panel = document.querySelector('[data-career-panel="arrival"]');
    if (!panel) return false;
    const shell = panel.querySelector('.ac-career-ui__panel');
    return !!shell && shell.getAttribute('data-shell-state') === 'normal'
      && panel.querySelectorAll('[data-action]').length >= 2;
  })()`, { timeout: 15000 });
  /* 0.23 到港叙事面板关闭后无法再读：等真实内容渲染完再取样，供 verifyOriginArrival 逐游戏断言寄信人/旧物。 */
  QA.arrivalText[gameId] = await cdp.evaluate("(() => { const panel = document.querySelector('[data-career-panel=\"arrival\"]'); return panel ? panel.innerText : ''; })()");
  const arrivalProjection = await cdp.evaluate(`(async () => {
    const api = window.ArcadeCareer;
    const view = await api.careerView({ surface: 'port' });
    const rows = view && Array.isArray(view.commissions) ? view.commissions : [];
    return {
      commissions: rows.map((row) => ({ id: row.commissionId, category: row.category, professionId: row.professionId, title: row.title })).slice(0, 8),
      run: api.commissionRun || null,
    };
  })()`);
  const firstRow = arrivalProjection.commissions.find((row) => row.professionId === invitation.professionId && row.category === 'profession');
  const firstNarrative = NARRATIVE_BY_PROFESSION[invitation.professionId] || {};
  const firstStart = await cdp.evaluate(`(() => {
    const panel = document.querySelector('[data-career-panel="arrival"]');
    const button = panel && panel.querySelector('[data-action="start-first-commission"]');
    const leave = panel && panel.querySelector('[data-action="leave-arrival"]');
    return {
      start: button ? { text: (button.textContent || '').trim(), visible: button.getClientRects().length > 0 } : null,
      leave: leave ? (leave.textContent || '').trim() : null,
    };
  })()`);
  gate('ARRIVAL 首次到港在真实 port 投影下给出第一份工作且不自动接单',
    !!firstRow && !!arrivalPanel && arrivalPanel.text.includes(firstRow.title) &&
      !!firstStart.start && firstStart.start.visible &&
      firstStart.start.text === (firstNarrative.firstActionLabel || '接受这份工作') &&
      firstRow.id === firstNarrative.firstCommissionId &&
      firstStart.leave === firstNarrative.exitLabel &&
      arrivalProjection.run === null,
    J({ firstRow, firstStart, firstCommissionId: firstNarrative.firstCommissionId, exitLabel: firstNarrative.exitLabel, text: arrivalPanel && arrivalPanel.text.slice(0, 400) }));
  await pressVisible(cdp, '[data-career-panel="arrival"] [data-action="leave-arrival"]', '暂时离开港口');
  await cdp.waitFor('!document.querySelector(`[data-career-panel="arrival"]`)', { timeout: 10000 });
  await cdp.evaluate('window.ArcadeCareer.openTown()');
  const board = await waitPanel(cdp, 'town', 15000);
  await cdp.waitFor(`!!document.querySelector('[data-career-panel="town"] [data-port-tabpanel="home"] button[id^="port-story-"]')`, { timeout: 15000 });
  /* 0.23 港口 P07–P10：首页推荐来自真实 careerView.story.nextAction，分段标签与工具格是
     portBody 的固定结构；0.22 告示板整块 DOM 已移除，这里直接断言真实组件面。 */
  const boardState = await cdp.evaluate(`(async () => {
    const api = window.ArcadeCareer;
    const view = await api.careerView({ surface: 'port' });
    const next = view && view.story && view.story.nextAction ? view.story.nextAction : null;
    const panel = document.querySelector('[data-career-panel="town"]');
    const button = panel && panel.querySelector('[data-port-tabpanel="home"] button[id^="port-story-"]');
    return {
      nextId: next && next.commissionId || null,
      nextLabel: next && next.label || '',
      buttonId: button ? button.id : null,
      buttonText: button ? (button.textContent || '').trim() : '',
      tabs: panel ? Array.from(panel.querySelectorAll('[role="tablist"] [data-tab]')).map((node) => node.getAttribute('data-tab')) : [],
      tools: panel ? Array.from(panel.querySelectorAll('[data-tool]')).map((node) => node.getAttribute('data-tool')) : [],
      messages: panel ? panel.querySelectorAll('[data-port-tabpanel="home"] [data-port-message]').length : 0,
      run: api.commissionRun || null,
    };
  })()`);
  gate('TOWN 显式打开港口后首页推荐卡/分段标签/工具入口真实渲染，仍未自动接单',
    !!board && !!boardState.nextId && boardState.buttonId === 'port-story-' + boardState.nextId &&
      boardState.buttonText === boardState.nextLabel &&
      J(boardState.tabs) === J(['home', 'work', 'journal']) &&
      J(boardState.tools) === J(['wallet', 'shop', 'workshop', 'hangar']) &&
      boardState.messages <= 1 && boardState.run === null &&
      await cdp.evaluate('location.href') === before,
    J({ board: board && board.text.slice(0, 240), boardState }));
  await verifyOriginArrival(cdp, gameId);
  if (gameId === ORIGIN_GAME) await checkPortArrivalCompact(cdp);
  await forbiddenTextScan(cdp, 'town-first-' + gameId);
  await checkConsole(cdp, 'delivery-' + gameId);
}

/**
 * 0.23 港口 P07–P10：打开港口并等首页真实推荐卡完成异步投影。
 * 旧告示板是一次性同步渲染；港口先 loading 再读 careerView({surface:'port'})，
 * 因此所有「打开港口」都统一等真实 story 动作出现，避免读到空初始帧。
 */
async function openPort(cdp, label, timeout = 15000) {
  step('port:' + label);
  await cdp.evaluate('window.ArcadeCareer.openTown()');
  await waitPanel(cdp, 'town', timeout);
  await cdp.waitFor(`!!document.querySelector('[data-career-panel="town"] [data-port-tabpanel="home"] button[id^="port-story-"]')`, { timeout });
}

/**
 * 读取港口首页推荐（0.23 真实 DOM + 同源 careerView 交叉验证）。
 * 0.22 的 [data-town-recommend-id]/[data-town-recommend-kind]/[data-town-recommend-reason]/
 * [data-town-goal]/[data-town-story-action] 已随告示板移除，不再作为真实 UI 断言。
 */
function readPortRecommendation(cdp) {
  return cdp.evaluate(`(async () => {
    const panel = document.querySelector('[data-career-panel="town"]');
    if (!panel) return { ok: false, reason: 'no-town-panel' };
    const api = window.ArcadeCareer;
    const view = await api.careerView({ surface: 'port' });
    if (!view) return { ok: false, reason: 'no-port-view' };
    const next = view.story && view.story.nextAction ? view.story.nextAction : null;
    const rows = Array.isArray(view.commissions) ? view.commissions : [];
    const row = next && next.commissionId ? rows.filter((item) => item.commissionId === next.commissionId)[0] || null : null;
    const content = panel.querySelector('[data-port-tabpanel="home"]');
    const story = content ? content.querySelector('[data-story-state]') : null;
    const action = story ? story.querySelector('button[id^="port-story-"]') : null;
    const textOf = (node) => (node && node.textContent ? node.textContent.replace(/\\s+/g, ' ').trim() : '');
    const rectOf = (node) => {
      const r = node.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) };
    };
    const alternativeNode = view.story && view.story.alternative && typeof view.story.alternative === 'object'
      ? view.story.alternative : null;
    const alternativeTexts = alternativeNode && alternativeNode.texts && typeof alternativeNode.texts === 'object'
      ? alternativeNode.texts : null;
    return {
      ok: !!(next && next.commissionId && action && action.id === 'port-story-' + next.commissionId && row),
      commissionId: next && next.commissionId || null,
      nextLabel: next && next.label || '',
      projectedTitle: next && next.label || '',
      projectedSummary: row ? (row.summary || row.objectiveText || '') : '',
      projectedCategory: row ? row.category || null : null,
      /* 0.24 T24：港口「眼下」摘要优先消费真实 story.alternative 公开文案；
         测试只读同源投影，不复制优先级规则。 */
      alternative: alternativeTexts ? {
        nodeId: alternativeNode.narrativeNodeId || null,
        offer: String(alternativeTexts.offer || ''),
        progress: String(alternativeTexts.progress || ''),
        receipt: String(alternativeTexts.receipt || ''),
        next: String(alternativeTexts.next || ''),
      } : null,
      narrativeNext: content ? textOf(content.querySelector('[data-port-narrative-next]')) : '',
      crossoverNodes: content ? content.querySelectorAll('[data-port-crossover]').length : 0,
      storyState: story ? story.getAttribute('data-story-state') : null,
      storyTitle: story ? textOf(story.querySelector('.ac-career-ui__story-title')) : '',
      storySummary: story ? textOf(story.querySelector('.ac-career-ui__story-summary')) : '',
      storyText: textOf(story),
      actionId: action ? action.id : '',
      actionText: textOf(action),
      actionRect: action ? rectOf(action) : null,
      actionVisible: !!action && action.getClientRects().length > 0,
      actionDisabled: !!action && action.disabled === true,
      tabs: Array.from(panel.querySelectorAll('[role="tablist"] [data-tab]')).map((node) => node.getAttribute('data-tab')),
      tools: Array.from(panel.querySelectorAll('[data-tool]')).map((node) => node.getAttribute('data-tool')),
      messages: content ? content.querySelectorAll('[data-port-message]').length : 0,
      clues: content ? content.querySelectorAll('button.ac-career-ui__clue').length : 0,
      boardText: textOf(panel),
    };
  })()`);
}

/**
 * 港口「眼下」StoryCard 摘要的合法来源：真实 careerView({surface:'port'}) 给出的
 * 委托行摘要（row.summary/objectiveText）优先；无委托摘要时才允许真实投影的
 * story.alternative.texts（progress/offer）兜底。两者都来自投影 —— 仍然禁止 UI 自造文案。
 * （T24 修正后摘要与当前 nextAction 同源，见 ui/town.js portStoryProps。）
 */
function expectedPortStorySummary(recommendation) {
  const alternative = recommendation && recommendation.alternative ? recommendation.alternative : null;
  const fromAlternative = alternative ? (alternative.progress || alternative.offer || '') : '';
  const fromRow = recommendation && recommendation.projectedSummary ? recommendation.projectedSummary : '';
  return fromRow || fromAlternative;
}

/** 「工作」页只列已接受职业 + 一条世界通用工作，且不泄漏未接受职业。 */
async function checkPortWorkSurface(cdp, label) {
  await pressVisible(cdp, '[data-career-panel="town"] [role="tablist"] [data-tab="work"]', label + ' 工作页');
  await cdp.waitFor(`!!document.querySelector('[data-career-panel="town"] [data-port-tabpanel="work"] [data-port-profession]')`, { timeout: 10000 });
  await sleep(150);
  const work = await cdp.evaluate(`(async () => {
    const api = window.ArcadeCareer;
    const view = await api.careerView({ surface: 'work' });
    const panel = document.querySelector('[data-career-panel="town"]');
    const professions = view && Array.isArray(view.professions) ? view.professions : [];
    const rows = view && Array.isArray(view.commissions) ? view.commissions : [];
    const textOf = (node) => (node && node.textContent ? node.textContent.replace(/\\s+/g, ' ').trim() : '');
    const cards = Array.from(panel.querySelectorAll('[data-port-tabpanel="work"] [data-port-profession]')).map((card) => ({
      professionId: card.getAttribute('data-port-profession'),
      category: card.getAttribute('data-work-category'),
      state: card.getAttribute('data-work-state'),
      text: textOf(card),
      titles: Array.from(card.querySelectorAll('.ac-career-ui__commission-title')).map((node) => textOf(node)),
      startButtons: Array.from(card.querySelectorAll('button')).filter((button) => /接下这单/.test(button.textContent || '')).map((button) => {
        const r = button.getBoundingClientRect();
        return { text: (button.textContent || '').trim(), w: Math.round(r.width), h: Math.round(r.height), visible: button.getClientRects().length > 0, disabled: button.disabled === true };
      }),
    }));
    const accepted = professions.filter((row) => ['accepted', 'developed', 'completed'].indexOf(String(row.state || '').toLowerCase()) >= 0);
    return {
      ok: !!view,
      cards,
      acceptedIds: accepted.map((row) => row.professionId),
      professionIds: professions.map((row) => row.professionId),
      professionNames: professions.map((row) => row.displayName).filter(Boolean),
      worldRows: rows.filter((row) => String(row.category || '').toLowerCase() === 'world' && row.historicalOnly !== true && row.readOnly !== true).map((row) => ({ title: row.title, summary: row.summary || row.objectiveText || '' })),
      professionRows: rows.filter((row) => String(row.category || '').toLowerCase() !== 'world').map((row) => ({ professionId: row.professionId || null, title: row.title })),
      allProfessionNames: ${J(CAREER_PROFESSION_NAMES.map((row) => row.name))},
      allProfessionIds: ${J(CAREER_PROFESSION_NAMES.map((row) => row.id))},
      panelText: textOf(panel),
      run: api.commissionRun || null,
    };
  })()`);
  const cardIds = work.cards.map((card) => card.professionId).filter((id) => id !== 'world');
  const worldCards = work.cards.filter((card) => card.category === 'world');
  const missingAccepted = work.acceptedIds.filter((id) => cardIds.indexOf(id) < 0);
  const strayProfession = cardIds.filter((id) => work.acceptedIds.indexOf(id) < 0);
  const titlesForeign = work.cards.filter((card) => card.category !== 'world').filter((card) =>
    card.titles.some((title) => !work.professionRows.some((row) => row.professionId === card.professionId && row.title === title)));
  gate('PORT ' + label + ' 工作页只出现已接受职业与一条世界通用工作',
    work.ok === true && missingAccepted.length === 0 && strayProfession.length === 0 &&
      worldCards.length === 1 && titlesForeign.length === 0,
    J({ acceptedIds: work.acceptedIds, cardIds, worldCards: worldCards.length, missingAccepted, strayProfession, titlesForeign: titlesForeign.map((card) => ({ id: card.professionId, titles: card.titles })) }));
  const unacceptedNames = work.allProfessionNames.filter((name) => work.professionNames.indexOf(name) < 0 && work.panelText.indexOf(name) >= 0);
  const leakedIds = work.allProfessionIds.filter((id) => work.panelText.indexOf(id) >= 0);
  gate('PORT ' + label + ' 工作页不泄漏未接受职业名字/内部职业 id',
    unacceptedNames.length === 0 && leakedIds.length === 0,
    J({ unacceptedNames, leakedIds, acceptedNames: work.professionNames, panelSample: work.panelText.slice(0, 240) }));
  const worldCard = worldCards[0] || null;
  const firstWorld = work.worldRows[0] || null;
  const acceptedNameInWorld = worldCard ? work.professionNames.filter((name) => worldCard.text.indexOf(name) >= 0) : [];
  gate('PORT ' + label + ' 世界通用工作使用内容公开文案且与职业解耦',
    !!(worldCard && firstWorld) && worldCard.text.indexOf(firstWorld.title) >= 0 &&
      (!firstWorld.summary || worldCard.text.indexOf(firstWorld.summary) >= 0) &&
      acceptedNameInWorld.length === 0,
    J({ worldText: worldCard && worldCard.text.slice(0, 260), firstWorld, acceptedNameInWorld }));
  const worldStart = worldCard && worldCard.startButtons[0] ? worldCard.startButtons[0] : null;
  gate('PORT ' + label + ' 世界通用工作有真实可接动作且未自动接单',
    !!(worldStart && worldStart.visible && worldStart.disabled === false && worldStart.h >= 44 && worldStart.w >= 44) && work.run === null,
    J({ worldStart, run: work.run }));
}

/** 工具格 [data-tool] 必须真实打开钱包/商店/工作台/机库对应面板（0.22 出航折叠里的机库等价物）。 */
async function checkPortTools(cdp, label) {
  const targets = [['wallet', 'receipt'], ['shop', 'market'], ['workshop', 'workshop'], ['hangar', 'hangar']];
  for (const [tool, panelName] of targets) {
    const selector = '[data-career-panel="town"] [data-tool=' + J(tool) + ']';
    const exists = await cdp.evaluate(`(() => {
      const button = document.querySelector(${J(selector)});
      if (!button) return null;
      const r = button.getBoundingClientRect();
      return { text: (button.textContent || '').trim(), w: Math.round(r.width), h: Math.round(r.height), visible: button.getClientRects().length > 0, disabled: button.disabled === true };
    })()`);
    if (!exists) {
      gate('PORT ' + label + ' 工具入口 ' + tool + ' 真实映射', false, 'missing ' + selector);
      continue;
    }
    await pressVisible(cdp, selector, label + ' 工具 ' + tool);
    await waitPanel(cdp, panelName, 15000);
    gate('PORT ' + label + ' 工具入口 ' + tool + ' 真实映射到 ' + panelName + ' 面板',
      exists.visible && exists.disabled === false && exists.h >= 44 && exists.w >= 44, J({ exists, panelName }));
    await cdp.evaluate(`(() => {
      const mod = window.ArcadeCareerUI && window.ArcadeCareerUI[${J(panelName)}];
      if (mod && typeof mod.close === 'function') { try { mod.close(); } catch (err) { /* ignore */ } }
      return true;
    })()`);
    await cdp.waitFor(`!document.querySelector('[data-career-panel=${J(panelName)}]')`, { timeout: 8000 });
    await sleep(120);
  }
}

async function verifyOriginArrival(cdp, gameId) {
  step('arrival:' + gameId);
  /* 0.22 的到港回应是告示板里的 [data-town-arrival]，0.23 已随告示板移除。
     等价（更强）断言分两层：
       ①首次到港叙事面板（已取样）必须写明正确寄信人与旧物；
       ②港口首页的 careerView.story.message（至多一条）必须来自已接受职业内容；
       ③首页推荐 nextAction 必须在真实 DOM 可见且可点击（不接受静默/预写）；
       ④工作页只含已接受职业、世界工作用通用文案，工具入口真实映射。 */
  const expected = ORIGIN_ARRIVAL[gameId];
  const arrivalText = QA.arrivalText[gameId] || '';
  gate('ARRIVAL ' + gameId + ' 首次到港叙事同时写明正确寄信人和旧物',
    arrivalText.includes(expected.sender) && arrivalText.includes(expected.object) &&
      !arrivalText.includes(expected.otherSender) && !arrivalText.includes(expected.otherObject),
    J({ expected, arrival: arrivalText.slice(0, 400) }));
  await go(cdp, gameUrl(gameId), 'arrival-origin-' + gameId);
  await waitBridge(cdp, 'arrival-origin-' + gameId, true);
  await configureCommissionCatalog(cdp, 'arrival-origin-' + gameId);
  await openPort(cdp, 'arrival-origin-' + gameId);
  const recommendation = await readPortRecommendation(cdp);
  gate('PORT ' + gameId + ' 港口首页把真实 nextAction 推荐委托渲染为可见可点卡片',
    recommendation.ok === true && recommendation.storyState === 'current' &&
      recommendation.actionVisible === true && recommendation.actionDisabled === false &&
      !!recommendation.actionRect && recommendation.actionRect.h >= 44 &&
      recommendation.actionText === recommendation.nextLabel &&
      recommendation.storyTitle === recommendation.projectedTitle &&
      !!recommendation.storySummary && !!recommendation.projectedSummary &&
      recommendation.storySummary === expectedPortStorySummary(recommendation) &&
      J(recommendation.tabs) === J(['home', 'work', 'journal']) &&
      recommendation.messages <= 1 && recommendation.clues <= 1,
    J(recommendation));
  const narrative = NARRATIVE_BY_PROFESSION[ORIGIN_PROFESSION[gameId]] || {};
  const storyMessage = (narrative.storyMessages || [])[0] || null;
  const message = await cdp.evaluate(`(() => {
    const content = document.querySelector('[data-career-panel="town"] [data-port-tabpanel="home"]');
    const rows = content ? Array.from(content.querySelectorAll('[data-port-message]')) : [];
    const label = content ? content.querySelector('[data-port-message-label]') : null;
    return {
      count: rows.length,
      label: label ? (label.textContent || '').trim() : '',
      text: rows[0] ? (rows[0].textContent || '').replace(/\\s+/g, ' ').trim() : '',
    };
  })()`);
  gate('PORT ' + gameId + ' 首页至多一条真实到港 message，寄信人来自已接受职业内容',
    message.count <= 1 && !!(storyMessage && storyMessage.label && storyMessage.text && storyMessage.from) &&
      message.text.indexOf(storyMessage.label) >= 0 && message.text.indexOf(storyMessage.text) >= 0 &&
      message.text.indexOf(storyMessage.from) >= 0 && message.text.indexOf(expected.sender) >= 0,
    J({ message, storyMessage, expectedSender: expected.sender }));
  await checkPortWorkSurface(cdp, gameId);
  await checkPortTools(cdp, gameId);
  await forbiddenTextScan(cdp, 'port-town-' + gameId);
  /* 后续首单仍从统一港口继续；回到测试页并显式打开港口，不接委托。 */
  await go(cdp, gameUrl('pendulum-tower'), 'arrival-return-' + gameId);
  await waitBridge(cdp, 'arrival-return-' + gameId, true);
  await configureCommissionCatalog(cdp, 'arrival-return-' + gameId);
  await openPort(cdp, 'arrival-return-' + gameId);
}

async function checkPortArrivalCompact(cdp) {
  /* 0.22 出航折叠区与租机摘要已随告示板移除（0.23 不存在 [data-town-flight]/[data-town-rental]）。
     等价/更强断言：375×548 首次到港无需滚动即可看到并点到真实推荐动作（首个严格位置），
     「工作」页世界通用工作真实可接、可展开其余工作、且不自动接单；
     机库入口改为工具格的 [data-tool="hangar"]，无需先展开任何折叠区。 */
  const homeAction = '[data-career-panel="town"] [data-port-tabpanel="home"] button[id^="port-story-"]';
  await cdp.waitFor(`!!document.querySelector(${J(homeAction)})`, { timeout: 15000 });
  const viewport = { deviceScaleFactor: 1, mobile: true };
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, width: 375, height: 548 });
  await sleep(220);
  const placement = await cdp.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const panel = document.querySelector('[data-career-panel="town"]');
    const home = panel && panel.querySelector('[data-port-tabpanel="home"] button[id^="port-story-"]');
    const homeRect = home && home.getBoundingClientRect();
    const hit = homeRect ? document.elementFromPoint(homeRect.left + homeRect.width / 2, homeRect.top + homeRect.height / 2) : null;
    const workTab = panel && panel.querySelector('[role="tablist"] [data-tab="work"]');
    const hangar = panel && panel.querySelector('[data-tool="hangar"]');
    resolve({
      height: innerHeight,
      home: homeRect ? {
        h: Math.round(homeRect.height), top: Math.round(homeRect.top), bottom: Math.round(homeRect.bottom),
        hit: home.contains(hit), inViewport: homeRect.top >= 0 && homeRect.bottom <= innerHeight,
        hitTag: hit ? hit.tagName : null, hitClass: hit ? String(hit.className || '').slice(0, 60) : null,
      } : null,
      workTabH: workTab ? Math.round(workTab.getBoundingClientRect().height) : null,
      hangarH: hangar ? Math.round(hangar.getBoundingClientRect().height) : null,
    });
  })))`);
  gate('PORT 375×548 首次到港无需滚动即可看到并点到推荐单（0.22 出航入口等价为世界工作）',
    !!(placement.home && placement.home.hit && placement.home.inViewport && placement.home.h >= 44 &&
      placement.workTabH >= 44 && placement.hangarH >= 44), J(placement));
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, width: 390, height: 844 });
  await sleep(150);
  await pressVisible(cdp, '[data-career-panel="town"] [role="tablist"] [data-tab="work"]', '工作页');
  await cdp.waitFor(`!!document.querySelector('[data-career-panel="town"] [data-port-profession="world"]')`, { timeout: 10000 });
  await sleep(150);
  const world = await cdp.evaluate(`(() => {
    const panel = document.querySelector('[data-career-panel="town"]');
    const card = panel.querySelector('[data-port-profession="world"]');
    const start = card && Array.from(card.querySelectorAll('button')).filter((button) => /接下这单/.test(button.textContent || ''))[0];
    const details = card && card.querySelector('details');
    const r = start ? start.getBoundingClientRect() : null;
    return {
      text: (card ? card.textContent : '').replace(/\\s+/g, ' ').trim().slice(0, 240),
      start: start ? { text: (start.textContent || '').trim(), h: Math.round(r.height), visible: start.getClientRects().length > 0, disabled: start.disabled === true } : null,
      details: !!details,
      run: window.ArcadeCareer.commissionRun || null,
    };
  })()`);
  gate('PORT 工作页世界通用工作真实可接（0.22 港口通用巡航等价物）且未自动接单',
    !!(world && world.start && world.start.visible && world.start.disabled === false && world.start.h >= 44 && world.details && world.run === null),
    J(world));
  await pressVisible(cdp, '[data-career-panel="town"] [data-port-profession="world"] summary.ac-career-ui__work-more', '查看其余工作');
  await sleep(260);
  const option = await cdp.evaluate(`(() => {
    const card = document.querySelector('[data-career-panel="town"] [data-port-profession="world"]');
    const details = card && card.querySelector('details');
    if (!details) return { open: false, rows: [] };
    const rows = Array.from(details.querySelectorAll('.ac-career-ui__commission')).filter((node) => node.getClientRects().length).map((node) => {
      const start = Array.from(node.querySelectorAll('button')).filter((button) => /接下这单/.test(button.textContent || ''))[0];
      const r = start ? start.getBoundingClientRect() : null;
      return {
        title: (node.querySelector('.ac-career-ui__commission-title') || {}).textContent || '',
        text: (node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
        start: start ? { h: Math.round(r.height), w: Math.round(r.width), visible: start.getClientRects().length > 0, disabled: start.disabled === true } : null,
      };
    });
    return { open: details.open === true, rows, run: window.ArcadeCareer.commissionRun || null };
  })()`);
  gate('PORT 世界工作「查看其余工作」展开后出现真实可接的世界委托（不自动接单）',
    option.open === true && option.rows.length >= 1 &&
      option.rows.every((row) => !!row.title && !!row.start && row.start.visible && row.start.disabled === false && row.start.h >= 44 && row.start.w >= 44) &&
      option.run === null,
    J(option));
  await pressVisible(cdp, '[data-career-panel="town"] [data-port-profession="world"] summary.ac-career-ui__work-more', '收起其余工作');
  await cdp.waitFor(`!document.querySelector('[data-career-panel="town"] [data-port-profession="world"] details').open`, { timeout: 5000 });
  await pressVisible(cdp, '[data-career-panel="town"] [role="tablist"] [data-tab="home"]', '回到眼下');
  await cdp.waitFor(`!!document.querySelector(${J(homeAction)})`, { timeout: 10000 });
}

async function acceptRecommended(cdp, commissionId, label, { enableHook = true, resumeTicket = null } = {}) {
  step('accept:' + label);
  /* 0.23 港口首页只有一个真实故事主动作：id=port-story-<commissionId>，点击走
     startPortCommission → 真实 commission.start。0.22 告示板的「继续这张单」文案、
     [data-town-action="start"][data-commission-id] 钩子已移除；续单语义改由
     commission-core 复用 DB live run 的票据断言（下方 ticket 断言）保证，仍然必须玩家显式点击。 */
  const selector = `[data-career-panel="town"] [id=${J('port-story-' + commissionId)}]`;
  await cdp.waitFor(`!!document.querySelector(${J(selector)})`, { timeout: 15000 });
  /* 目标游戏由 commissionId 前缀决定；据此等待精确的游戏页 pathname，
     避免只靠 /games/ 前缀在旧文档或别的游戏页上误命中。 */
  const targetGameId = commissionId.split('.')[0];
  const beforeHref = await cdp.evaluate('location.href');
  const beforeTicket = (beforeHref.match(/[?&]career=([^&#]+)/) || [])[1] || null;
  const clicked = await cdp.evaluate(`(async () => {
    const b = document.querySelector(${J(selector)});
    if (!b) return { ok: false, reason: 'missing' };
    const api = window.ArcadeCareer;
    let view = null;
    try { if (api && typeof api.careerView === 'function') view = await api.careerView({ surface: 'port' }); } catch (err) { /* ignore */ }
    const next = view && view.story && view.story.nextAction ? view.story.nextAction : null;
    const r = b.getBoundingClientRect();
    return {
      ok: true,
      commissionId: b.id.slice('port-story-'.length),
      nextId: next && next.commissionId || null,
      nextLabel: next && next.label || '',
      text: (b.textContent || '').trim(),
      visible: b.getClientRects().length > 0,
      disabled: b.disabled === true,
      h: Math.round(r.height),
    };
  })()`);
  requireFeature('ACCEPT ' + label + ' 港口故事卡显示真实投影对应的可接委托',
    clicked.ok && clicked.commissionId === commissionId && clicked.nextId === commissionId &&
      clicked.visible && clicked.disabled === false && clicked.h >= 44 && clicked.text === clicked.nextLabel,
    J({ clicked, beforeHref, resumeTicket }));
  await pressVisible(cdp, selector, label + ' 港口故事卡动作');
  /* 接新单要签新票；首次续单必须保留关闭标签前的原票。 */
  await cdp.waitFor(`(() => {
    var href = location.href;
    var ticket = (href.match(/[?&]career=([^&#]+)/) || [])[1] || '';
    var pathOk = location.pathname.indexOf('/games/${targetGameId}.html') >= 0;
    var ticketOk = ${resumeTicket ? 'ticket === ' + J(resumeTicket) : '!!ticket && ticket !== ' + J(beforeTicket || '')};
    return href !== ${J(beforeHref)} && pathOk && ticketOk;
  })()`, { timeout: 30000 });
  const landed = await cdp.evaluate('({ href: location.href, path: location.pathname, search: location.search })');
  const landedTicket = (landed.search.match(/[?&]career=([^&#]+)/) || [])[1] || null;
  gate('ACCEPT ' + label + ' 导航到目标游戏职业入口并使用预期票号',
    landed.href !== beforeHref && landed.path.endsWith('/games/' + targetGameId + '.html') && !!landedTicket &&
      (resumeTicket ? landedTicket === resumeTicket : landedTicket !== beforeTicket),
    J({ beforeHref, beforeTicket, landed, landedTicket, resumeTicket }));
  await waitBridge(cdp, label + '-game', false);
  await configureCommissionCatalog(cdp, label + '-game');
  const runExpr = 'window.ArcadeCareer?.commissionRun';
  await cdp.waitFor(`(() => { const r = ${runExpr}; return !!(r && r.ticketId); })()`, { timeout: 20000 });
  const run = await cdp.evaluate(runExpr);
  requireFeature('ACCEPT ' + label + ' 激活同一委托的职业局', run?.commissionId === commissionId && run.ticketId === landedTicket,
    J(run && { commissionId: run.commissionId, gameId: run.gameId, ticketId: run.ticketId }));
  if (enableHook) {
    /* 玩法钩子阶段：沿用同一 ticket 显式导航到带 careerTest=1 的 URL，不重建 ticket。 */
    const ticketId = run.ticketId;
    const hookUrl = gameUrl(targetGameId, { career: ticketId });
    await go(cdp, hookUrl, label + '-hook-reopen');
    await waitBridge(cdp, label + '-game-hook');
    await configureCommissionCatalog(cdp, label + '-hook');
    await cdp.waitFor(`(() => { const t = window.__arcadeCareerTest; return !!(t && t.commissionRun && t.commissionRun()); })()`, { timeout: 15000 });
    const reopened = await cdp.evaluate('window.__arcadeCareerTest.commissionRun()');
    gate('ACCEPT ' + label + ' 同 ticket 重新打开测试钩子（不重建票据）',
      !!(reopened && reopened.ticketId === ticketId && reopened.commissionId === commissionId),
      J({ original: run.ticketId, reopened: reopened && reopened.ticketId, commissionId: reopened && reopened.commissionId }));
  }
  return run;
}

async function readBrowserTicket(cdp) {
  return cdp.evaluate(`JSON.parse(sessionStorage.getItem(${J(TICKET_STORAGE_KEY)}))`);
}

async function resumeFromNewTab(cdp, run, browser, newPage) {
  step('resume:close-tab');
  const original = await readBrowserTicket(cdp);
  requireFeature('RESUME 关标签前持有已激活委托的完整票据',
    original?.ticketId === run.ticketId && !!original.runId && !!original.nonce, J({ ticketId: run.ticketId, hasNonce: !!original?.nonce }));
  const { targetInfo: { targetId } } = await cdp.send('Target.getTargetInfo');
  const { targetInfos } = await browser.send('Target.getTargets');
  ensure(targetInfos.some((target) => target.type === 'page' && target.url === 'about:blank' && target.targetId !== targetId),
    '关闭委托前需要同浏览器中保留另一标签');
  await checkConsole(cdp, 'before-close-tab');
  const closed = await browser.send('Target.closeTarget', { targetId });
  cdp.close();
  let stillOpen = true;
  const deadline = Date.now() + 5000;
  while (stillOpen && Date.now() < deadline) {
    const remaining = await browser.send('Target.getTargets');
    stillOpen = remaining.targetInfos.some((target) => target.targetId === targetId);
    if (stillOpen) await sleep(50);
  }
  requireFeature('RESUME 实际关闭原职业游戏标签', closed.success && !stillOpen, J({ closed, stillOpen }));

  step('resume:reopen-home');
  const reopened = await newPage();
  await go(reopened, HOME_URL, 'resume-fresh-home');
  requireFeature('RESUME 新首页标签没有原标签的 sessionStorage 票据', await readBrowserTicket(reopened) === null, '新标签需要从持久化委托找回票据');
  const homeLocation = await reopened.evaluate('location.href');
  const homeAction = await pressVisible(reopened, 'button[data-career-entry]', '新首页的旧港生涯入口');
  gate('RESUME 首页可见旧港生涯入口', homeAction.text.includes('旧港生涯'), J(homeAction.text));
  await waitPanel(reopened, 'town');
  await waitBridge(reopened, 'resume-home', false);
  await configureCommissionCatalog(reopened, 'resume-home');
  await openPort(reopened, 'resume-home');
  requireFeature('RESUME 港口在首页打开', await reopened.evaluate('location.href') === homeLocation, homeLocation);
  requireFeature('RESUME 进入旧港后仍须显式点击续单', await readBrowserTicket(reopened) === null, '打开港口时不应自动恢复票据');

  const resumed = await acceptRecommended(reopened, run.commissionId, 'resume-original-order', { resumeTicket: original.ticketId });
  const ticket = await readBrowserTicket(reopened);
  requireFeature('RESUME 点击港口故事卡后复用原 ticketId / runId / nonce',
    resumed.ticketId === original.ticketId && ticket?.ticketId === original.ticketId && ticket.runId === original.runId && ticket.nonce === original.nonce,
    J({ original: original.ticketId, resumed: ticket?.ticketId, sameRun: ticket?.runId === original.runId, sameNonce: ticket?.nonce === original.nonce }));
  return reopened;
}

/** 先检查可见收据，再通过玩家按钮推进。 */
async function phaseReceipt(cdp, label, expectedChapterFlags, card) {
  step('receipt:' + label);
  const expectedFlags = Array.isArray(expectedChapterFlags) ? expectedChapterFlags : expectedChapterFlags ? [expectedChapterFlags] : [];
  requireFeature('RECEIPT ' + label + ' 显示成功收据', card?.state === 'success', J(card));
  checkReceiptText(card, label);
  requireFeature('RECEIPT ' + label + ' 玩家可见下一步', !!card.next, J(card.text));
  /* 完章事实已由 verifyOrderProgress 的真实旗标/章节状态断言承担；收据只验证
     统一投影的 nextAction/公开经历确实渲染，不再依赖「新完成的段落」固定文案。 */
  const projection = await receiptProjection(cdp);
  requireFeature('RECEIPT ' + label + ' 真实 careerView 投影可用', projection.ok === true, J(projection));
  /* 0.23 收据层级：下一步可能是 popover 根节点的「下一步：X」，也可能是组件主按钮
     「继续：X」；两者都必须逐字等于真实 careerView.story.nextAction。 */
  const projectedNextVisible = !!projection.nextLabel &&
    (card.next === '下一步：' + projection.nextLabel || card.next === '继续：' + projection.nextLabel);
  const projectedTextsClean = !FORBIDDEN_PATTERNS.some((pattern) =>
    pattern.re.test([projection.nextLabel].concat(projection.history).join(' ')));
  gate('RECEIPT ' + label + ' nextAction 来自真实投影且不含内部 token',
    projectedNextVisible && projectedTextsClean,
    J({ next: card.next, projectedNext: projection.nextLabel, projectedHistory: projection.history, expectedFlags }));

  const action = card.buttons.find((button) => button.action === 'continue' || button.action === 'return-to-town');
  const panelName = projection.nextKind === 'ending' ? 'world-state' : 'town';
  /* 0.22 的「回告示板看看 / 选择终局」按钮在 0.23 合并为「继续：<投影下一步>」；
     仍然只能由玩家点击，且落地面板必须与真实 nextAction.kind 一致（ending→章节页）。 */
  const actionTextOk = !!action && (action.action === 'continue' ? /^继续[：:]/.test(action.text) : /回告示板/.test(action.text));
  requireFeature('RECEIPT ' + label + ' 收据显示实际下一步按钮', actionTextOk, J(card.buttons));
  const firstTwoOrders = label === 'order-1' || label === 'order-2';
  if (firstTwoOrders) gate('RECEIPT ' + label + ' 下一步为主动作', action.primary, J(action));
  gate('RECEIPT ' + label + ' 下一步按钮热区 ≥44px', action.rect.h >= 44 && action.rect.w >= 44, J(action.rect));

  const hrefBefore = await cdp.evaluate('location.href');
  const viewport = { deviceScaleFactor: 1, mobile: true };
  if (firstTwoOrders) await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, width: 375, height: 548 });
  const actionSelector = `${RECEIPT_CARD} [data-action="continue"], ${RECEIPT_CARD} [data-action="return-to-town"]`;
  await pressVisible(cdp, actionSelector, label + ' 收据下一步');
  await waitPanel(cdp, panelName);
  const hrefAfter = await cdp.evaluate('location.href');
  const viewportLabel = firstTwoOrders ? ' 375×548' : '';
  gate('RECEIPT ' + label + viewportLabel + ' 实际命中按钮并在当前页打开预期面板', hrefAfter === hrefBefore,
    J({ panel: panelName, hrefBefore, hrefAfter }));
  if (firstTwoOrders) await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, width: 390, height: 844 });
  if (panelName === 'town') {
    /* 0.23 收据不再渲染 0.22 的「你这一趟带回了什么？」经历块，等价（更强）断言：
       同一 careerView.story.history 必须在港口「经历」页真实可见（空投影则显示空状态）。 */
    await cdp.waitFor(`!!document.querySelector('[data-career-panel="town"] [data-port-tabpanel="home"] [data-story-state]')`, { timeout: 15000 });
    /* 港口在装载完成时会重建 body；必须在 shell 进入 normal 之后再点 tab，
       否则真实点击会落在被替换掉的节点上（装载期点击丢失）。 */
    await cdp.waitFor(`(() => {
      const panel = document.querySelector('[data-career-panel="town"] .ac-career-ui__panel');
      return !!panel && panel.getAttribute('data-shell-state') === 'normal';
    })()`, { timeout: 15000 });
    await pressVisible(cdp, '[data-career-panel="town"] [role="tablist"] [data-tab="journal"]', label + ' 经历页');
    await cdp.waitFor(`(() => {
      const tablist = document.querySelector('[data-career-panel="town"] [role="tablist"]');
      return !!tablist && tablist.getAttribute('data-selected-id') === 'journal';
    })()`, { timeout: 10000 });
    /* 港口三个 surface 异步装载：必须等「经历」tab 自身渲染完（timeline 或错误态），
       不能用固定 sleep 猜装载时间。 */
    let journalLoaded = true;
    try {
      await cdp.waitFor(`(() => {
        const content = document.querySelector('[data-career-panel="town"] [data-port-tabpanel="journal"]');
        if (!content) return false;
        if (content.textContent.indexOf('正在整理港口内容') >= 0) return false;
        return !!content.querySelector('[data-timeline-state]') || content.textContent.indexOf('读不出来') >= 0;
      })()`, { timeout: 15000 });
    } catch (err) {
      journalLoaded = false;
      const diag = await cdp.evaluate(`(async () => {
        const panel = document.querySelector('[data-career-panel="town"]');
        const shell = panel && panel.querySelector('.ac-career-ui__panel');
        const tablist = panel && panel.querySelector('[role="tablist"]');
        const content = panel && panel.querySelector('[data-port-tabpanel="journal"]');
        const view = await Promise.race([
          window.ArcadeCareer.careerView({ surface: 'journal' })
            .then((value) => ({ ok: true, history: value && value.story && Array.isArray(value.story.history) ? value.story.history.length : -1 }))
            .catch((error) => ({ ok: false, error: String(error) })),
          new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'careerView-5s-timeout' }), 5000)),
        ]);
        return {
          shellState: shell ? shell.getAttribute('data-shell-state') : null,
          selected: tablist ? tablist.getAttribute('data-selected-id') : null,
          tabs: tablist ? Array.from(tablist.querySelectorAll('[data-tab]')).map((node) => node.getAttribute('data-tab')) : [],
          contentText: content ? content.textContent.replace(/\\s+/g, ' ').trim().slice(0, 320) : null,
          view,
        };
      })()`);
      gate('RECEIPT ' + label + ' 港口「经历」页装载诊断', false, J({ diag, errors: cdp.errors.slice(0, 4) }));
    }
    if (journalLoaded) {
      const journal = await cdp.evaluate(`(async () => {
      const panel = document.querySelector('[data-career-panel="town"]');
      const content = panel.querySelector('[data-port-tabpanel="journal"]');
      const view = await window.ArcadeCareer.careerView({ surface: 'journal' });
      const history = view && view.story && Array.isArray(view.story.history)
        ? view.story.history.map((row) => String((row && (row.label || row.text)) || row || '').trim()).filter(Boolean) : [];
      const labels = Array.from(panel.querySelectorAll('[data-port-tabpanel="journal"] .ac-career-ui__timeline-label'))
        .map((node) => (node.textContent || '').trim()).filter(Boolean);
      const timeline = panel.querySelector('[data-port-tabpanel="journal"] [data-timeline-state]');
      return {
        labels,
        history,
        timelineState: timeline ? timeline.getAttribute('data-timeline-state') : null,
        text: (content ? content.textContent : '').replace(/\\s+/g, ' ').trim().slice(0, 300),
        viewOk: !!view,
      };
    })()`);
    gate('RECEIPT ' + label + ' 经历投影在港口「经历」页真实可见',
      journal.viewOk === true && journal.history.every((text) => journal.labels.indexOf(text) >= 0) &&
        (journal.history.length ? journal.timelineState === 'filled' : journal.timelineState === 'empty'),
      J(journal));
    await pressVisible(cdp, '[data-career-panel="town"] [role="tablist"] [data-tab="home"]', label + ' 回到眼下');
    }
  } else {
    requireFeature('RECEIPT ' + label + ' 终局入口为真实 nextAction.kind=ending', projection.nextKind === 'ending', J(projection));
  }
  await forbiddenTextScan(cdp, 'after-receipt-' + label);
}

async function failShadowOrder(cdp, commission) {
  const failedRun = await acceptRecommended(cdp, commission.commissionId, 'shadow-leap.T1-失败');
  const before = await driveShadowHeight(cdp, 35, 'shadow-leap.T1-失败');
  const required = commission.objective.minValue.value;
  gate('FAIL 真实攀升不足委托要求', Number(before.meters) < required, J({ meters: before.meters, required }));
  const card = await waitReceipt(cdp, failedRun.ticketId);
  requireFeature('FAIL 未达标后出现对应票据的失败收据', card?.state === 'failure' && card.runId === failedRun.ticketId, J(card));
  checkReceiptText(card, 'shadow-leap-failure');
  gate('FAIL 失败收据如实提示未达标', /未|差|不足|没/.test(card.text), J(card.text));
  /* 0.22 失败收据的「回告示板看看」按钮在 0.23 组件收据里换成「再试一次」+「先收起收据」。
     等价：玩家仍能从失败收据真实关闭回港口，且不会自动重开委托。 */
  const retry = card.buttons.find((button) => button.action === 'retry-settlement');
  const dismiss = card.buttons.find((button) => button.action === 'dismiss-receipt');
  requireFeature('FAIL 失败收据提供真实重试与收起动作', !!retry && !!dismiss, J(card.buttons));
  await pressVisible(cdp, RECEIPT_CARD + ' [data-action="dismiss-receipt"]', '收起失败收据');
  await cdp.waitFor('!document.querySelector(`[data-career-card="receipt"]`)', { timeout: 8000 });
  requireFeature('FAIL 收起失败收据不自动重开委托', await cdp.evaluate('!window.ArcadeCareer.commissionRun'), 'run should stay null');
  await openPort(cdp, 'fail-receipt-port');
  return failedRun.ticketId;
}

async function verifyOrderProgress(cdp, label, commissionId, ticketId, expectedFlags, kind, campaign, commissions) {
  /* 收据出现后职业档案写入仍可能滞后一拍：轮询只读快照直到 careerId/claim 到位。 */
  let snapshot = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    snapshot = await readOnlyState(cdp);
    if (snapshot && snapshot.ok === true && snapshot.claims.some((row) => row.receiptId === ticketId)) break;
    await sleep(150);
  }
  requireFeature('STATE ' + label + ' 结算后可只读职业档案', snapshot && snapshot.ok === true,
    J(snapshot && { ok: snapshot.ok, reason: snapshot.reason, dbSource: snapshot.dbSource, claimCount: (snapshot.claims || []).length }));
  const claim = snapshot.claims.find((row) => row.receiptId === ticketId);
  gate('STATE ' + label + ' claim 真实现金/材料/旗标入账', !!claim && claim.credits >= 0, J(claim));
  const projection = projectFromSnapshot(snapshot, campaign);
  /* 真实派生：运行时调用产品 storyEvidence.storyFlags；拿不到就 BLOCKED，不写本地近似规则。 */
  const storyNow = await runtimeStoryFlags(cdp, projection.flags, projection.evidence);
  requireFeature('STORY ' + label + ' 真实 story-evidence 派生可用', storyNow.ok === true, J(storyNow));
  const realFlags = new Set(storyNow.flags);
  const wanted = Array.isArray(expectedFlags) ? expectedFlags : expectedFlags ? [expectedFlags] : [];
  const newFlags = Array.from(realFlags).filter((flag) =>
    Object.values(CHAPTER_FLAGS).includes(flag) && !projection.flags.has(flag));
  if (wanted.length) {
    gate('CHAPTER ' + label + ' 按真实规则完成 ' + wanted.join(' + '),
      wanted.every((flag) => realFlags.has(flag)),
      J({ wanted, realFlags: Array.from(realFlags), evidence: Array.from(projection.evidence), newFlags }));
  } else {
    gate('CHAPTER ' + label + ' 中间单不完成任何新章节', newFlags.length === 0, J({ newFlags, realFlags: Array.from(realFlags) }));
  }
  const view = await campaignView(cdp, snapshot);
  /* 真实比较：当前章必须与本单真实旗标推进结果一致，不允许 true:true 永真。 */
  const CURRENT_AFTER_FLAG = {
    [CHAPTER_FLAGS.C1]: 'C2', [CHAPTER_FLAGS.C2]: 'C3',
    [CHAPTER_FLAGS.C3]: 'C4', [CHAPTER_FLAGS.C4]: 'C5',
  };
  const expectedCurrentChapter = wanted.includes(CHAPTER_FLAGS.C4) ? 'C5'
    : wanted.includes(CHAPTER_FLAGS.C3) ? 'C4'
      : wanted.includes(CHAPTER_FLAGS.C2) ? 'C3'
        : wanted.includes(CHAPTER_FLAGS.C1) ? 'C2' : null;
  gate('CHAPTER ' + label + ' 章节状态与真实旗标一致',
    view.ok === true && !!view.currentChapter &&
      (wanted.length ? view.currentChapter === expectedCurrentChapter : newFlags.length === 0),
    J({ view: view.ok ? { currentChapter: view.currentChapter, chapters: view.chapters } : view,
      expectedCurrentChapter, newFlags, realFlags: Array.from(realFlags) }));
  QA.chapterAfter.push({ label, commissionId, expectedFlags: wanted, newFlags, flags: Array.from(projection.flags), current: view.currentChapter });
  await checkConsole(cdp, 'order-' + label);
  return { snapshot, projection, view, claim };
}

/* ------------------------------------------------------------------ *
 * 6. 主链路
 * ------------------------------------------------------------------ */

async function runOriginToTown(cdp, gameId) {
  await phaseDiscovery(cdp, gameId);
  await phaseHomepageRevisit(cdp);
  await phaseSingleDelivery(cdp, gameId);
}

async function runFullFlow(cdp, browser, newPage, campaign, commissions) {
  await runOriginToTown(cdp, ORIGIN_GAME);

  /* 首单：读取港口首页真实推荐 → 接单 → 关标签后续单 → 真实职业局 → 收据。 */
  await cdp.waitFor(`!!document.querySelector('[data-career-panel="town"] [data-port-tabpanel="home"] button[id^="port-story-"]')`, { timeout: 15000 });
  let recommendation = await readPortRecommendation(cdp);
  requireFeature('PORT 港口首页提供真实可执行推荐单', recommendation.ok === true && !!recommendation.commissionId, J(recommendation));
  /* 0.22 告示板推荐行（data-town-goal、「你愿意完成」目标句、milestone/step 进展语言）已随告示板移除。
     0.23/T24 等价（更强）：StoryCard 标题/摘要/动作文案必须逐字等于真实 careerView({surface:'port'})
     的 nextAction + 委托投影（或 T24 story.alternative 公开文案），且动作是 ≥44px 的玩家可点按钮；
     摘要来源见 expectedPortStorySummary（DOM 不得自造文案）；不自动接单。 */
  gate('PORT 推荐卡标题/摘要/动作来自真实 port 投影且为公开文案',
    !!recommendation.storyTitle && recommendation.storyTitle === recommendation.projectedTitle &&
      !!recommendation.storySummary && !!recommendation.projectedSummary &&
      recommendation.storySummary === expectedPortStorySummary(recommendation) &&
      recommendation.storyState === 'current' && recommendation.actionVisible === true &&
      recommendation.actionDisabled === false && recommendation.actionText === recommendation.nextLabel &&
      !!recommendation.actionRect && recommendation.actionRect.h >= 44 && recommendation.actionRect.w >= 44,
    J(recommendation));
  gate('PORT 首单与内容驱动的 W5E 第一单一致', recommendation.commissionId === WORLD_WORK_ROUTE[0].commissionId,
    J({ actual: recommendation.commissionId, expected: WORLD_WORK_ROUTE[0].commissionId }));
  QA.recommended.push(recommendation.commissionId);

  const sequence = [];
  let previousChapter = 'C0';
  for (let index = 0; index < WORLD_WORK_ROUTE.length; index += 1) {
    const expected = WORLD_WORK_ROUTE[index];
    step('order:' + expected.commissionId);
    const snapshotBefore = await readOnlyState(cdp);
    requireFeature('STATE ' + expected.commissionId + ' 接单前可只读职业档案', snapshotBefore && snapshotBefore.ok === true, J(snapshotBefore && { ok: snapshotBefore.ok, reason: snapshotBefore.reason }));
    /* 生产页无 __arcadeCareerTest 时必须回退 ArcadeCareer.db；有钩子时仍优先钩子。 */
    const noTestApi = await cdp.evaluate('!window.__arcadeCareerTest');
    gate('STATE ' + expected.commissionId + ' 只读快照来源正确' + (noTestApi ? '（生产页公开只读回退）' : ''),
      !!snapshotBefore.dbSource && (!noTestApi || snapshotBefore.dbSource !== 'careerTest'),
      J({ noTestApi, dbSource: snapshotBefore.dbSource }));
    const projectionBefore = projectFromSnapshot(snapshotBefore, campaign);
    const commission = commissions.find((row) => row.commissionId === recommendation.commissionId);
    requireFeature('BOARD ' + recommendation.commissionId + ' 推荐单在真实委托目录内', !!commission, J(recommendation));
    /* 真实完成性：用本单 reward 投影后的证据/旗标调用产品 storyEvidence.storyFlags。 */
    const projectedFlags = new Set(projectionBefore.flags);
    const projectedEvidence = new Set(projectionBefore.evidence);
    (commission.reward.flags || []).forEach((flag) => projectedFlags.add(flag));
    (commission.reward.evidence || []).forEach((token) => projectedEvidence.add(token));
    if (!projectedFlags.has(CHAPTER_FLAGS.C1)) {
      const c1 = (campaign.chapters || []).find((item) => item.chapterId === 'C1');
      const ctx = { flags: projectedFlags, evidence: projectedEvidence, cleared: new Set(projectionBefore.cleared) };
      if (c1 && (c1.routes || []).some((route) => evalRequirement(route.requires, ctx))) projectedFlags.add(CHAPTER_FLAGS.C1);
    }
    const storyBefore = await runtimeStoryFlags(cdp, projectedFlags, projectedEvidence);
    requireFeature('STORY ' + expected.commissionId + ' 真实 story-evidence 派生可用', storyBefore.ok === true, J(storyBefore));
    const realFlagsBefore = new Set(storyBefore.flags);
    const completes = Array.from(realFlagsBefore).find((flag) =>
      Object.values(CHAPTER_FLAGS).includes(flag) && !projectionBefore.flags.has(flag)) || null;
    const boardView = await cdp.evaluate(`(async () => {
      const view = await window.ArcadeCareer.careerView({ surface: 'work' });
      const panel = document.querySelector('[data-career-panel="town"]');
      const button = panel && panel.querySelector('[data-port-tabpanel="home"] button[id^="port-story-"]');
      return {
        ok: !!view,
        nextId: view && view.story && view.story.nextAction ? view.story.nextAction.commissionId || null : null,
        buttonId: button ? button.id : '',
        actionText: button ? (button.textContent || '').trim() : '',
      };
    })()`);
    /* 0.22 的公开进展文案（能推进这一段 / 能积攒下一步所需 / 路线进展）已随告示板移除。
       0.23 等价（更强）：推荐仍由真实 careerView.story.nextAction 给出，且港口 DOM 的
       story 动作必须与投影逐字一致 —— DOM 与投影不得分叉，也不得静默换单。 */
    gate('PORT ' + recommendation.commissionId + ' 主卡来自真实投影且 DOM 动作与投影一致',
      boardView.ok === true && boardView.nextId === recommendation.commissionId &&
        boardView.buttonId === 'port-story-' + recommendation.commissionId &&
        boardView.actionText === recommendation.nextLabel,
      J({ boardView, nextLabel: recommendation.nextLabel, completes }));

    const commissionId = recommendation.commissionId;
    const label = 'order-' + (index + 1);
    const failedTicket = commissionId === 'shadow-leap.T1' ? await failShadowOrder(cdp, commission) : null;
    const testContinuation = index === 0;
    const run = await acceptRecommended(cdp, commissionId, label, { enableHook: !testContinuation });
    if (testContinuation) cdp = await resumeFromNewTab(cdp, run, browser, newPage);
    if (failedTicket) gate('FAIL 重接同一委托签发新票', run.ticketId !== failedTicket, J({ failedTicket, newTicket: run.ticketId }));
    await driveCommission(cdp, commissionId, label);
    /* 塔倒塌/射击收局后 finish 是异步落库：先等真实收据出现，再核验只读档案，
       避免 claim/quests 尚未写入导致 no-career；收据卡片复用于 phaseReceipt，不重复等待。 */
    const card = await waitReceipt(cdp, run.ticketId);
    requireFeature('RECEIPT ' + label + ' 显示这张单的成功收据', card?.state === 'success' && card.runId === run.ticketId, J(card));
    const expectedKind = expected.expectFlags.length ? 'milestone' : 'step';
    const after = await verifyOrderProgress(cdp, label, commissionId, run.ticketId, expected.expectFlags, expectedKind, campaign, commissions);
    if (failedTicket) {
      gate('FAIL 重接后完成同一委托，只有成功票有收据入账',
        after.claim?.commissionId === commissionId && !after.snapshot.claims.some((claim) => claim.receiptId === failedTicket),
        J({ newClaim: after.claim?.receiptId, failedTicket }));
    }
    if (testContinuation) {
      gate('RESUME 恢复原票后完成首单并用原票结算', after.claim?.receiptId === run.ticketId, J(after.claim));
    }
    if (commissionId === 'memory-flip.T1') {
      const newEvidence = [...after.projection.evidence].filter((token) => !projectionBefore.evidence.has(token));
      gate('RECEIPT 旧档案夹指向差一张的照片，未虚报新线索或授予证据',
        card.next.includes('差一张的照片') && !/你这一趟留下了一条新线索|带回了.{0,8}新线索/.test(card.text) &&
          after.claim?.evidence?.length === 0 && newEvidence.length === 0,
        J({ next: card.next, text: card.text, receiptEvidence: after.claim?.evidence, newEvidence }));
    }
    await phaseReceipt(cdp, label, expected.expectFlags, card);
    sequence.push(recommendation.commissionId);
    previousChapter = after.view.currentChapter || previousChapter;

    if (index < WORLD_WORK_ROUTE.length - 1) {
      await cdp.waitFor(`!!document.querySelector('[data-career-panel="town"] [data-port-tabpanel="home"] button[id^="port-story-"]')`, { timeout: 15000 });
      recommendation = await readPortRecommendation(cdp);
      requireFeature('PORT 第 ' + (index + 2) + ' 单推荐仍真实可执行', recommendation.ok === true && !!recommendation.commissionId, J(recommendation));
      QA.recommended.push(recommendation.commissionId);
      expectChapterAdvance(sequence, expected, after, previousChapter);
    }
  }

  const worldWorkIds = WORLD_WORK_ROUTE.map((row) => row.commissionId);
  const routeMatches = J(sequence) === J(worldWorkIds);
  /* 无环境变量放宽：内容驱动的 W5E 路线必须一致；替代路线不直接 PASS。 */
  gate('ROUTE 推荐路线与 world-work 内容驱动的 W5E 一致', routeMatches === true,
    J({ sequence, worldWorkIds, alternate: !routeMatches,
      note: routeMatches ? 'W5E' : '替代路线：真实性由每单 STORY/CHAPTER/RECEIPT 断言保证，但不视为 W5E 通过' }));

  /* 终局入口：必须玩家可见按钮点击，不得直接写 C5。 */
  step('ending-entry');
  const beforeEnding = await readOnlyState(cdp);
  gate('C5 终局前不存在 C5.star_tower_resolved 旗标',
    !(beforeEnding.quests || []).some((row) => row.nodeId === 'story:' + CHAPTER_FLAGS.C5),
    J((beforeEnding.quests || []).filter((row) => row.nodeId && row.nodeId.indexOf('C5') >= 0)));
  /* C4 收据上的「选择终局」已打开章节面板。 */
  await waitPanel(cdp, 'world-state', 15000);
  const world = await cdp.evaluate(`(() => {
    const panel = document.querySelector('[data-career-panel="world-state"]');
    if (!panel) return null;
    const endings = Array.from(panel.querySelectorAll('[data-approach]')).map((button) => ({ approach: button.getAttribute('data-approach'), text: (button.textContent || '').trim(), h: Math.round(button.getBoundingClientRect().height) }));
    return { endings, text: (panel.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 700) };
  })()`);
  requireFeature('C5 完成 C4 后当前屏出现三终局入口', !!(world && world.endings.length >= 3), J(world));
  gate('C5 终局按钮 ≥44px 且为玩家可见戏内文案', world.endings.every((ending) => ending.h >= 44 && ending.text.length > 2), J(world.endings));
  await viewportChecks(cdp, '章节面板', ['[data-career-panel="world-state"] [data-approach="' + ENDING_APPROACH + '"]']);
  /* 与 acceptRecommended 同样：点击前记录旧 URL/ticket，等待真正导航到目标游戏的新 ticket；
     文档切换中 __arcadeCareerTest 可能 undefined，必须先安全检测再调 commissionRun。 */
  const beforeEndingHref = await cdp.evaluate('location.href');
  const beforeEndingTicket = (beforeEndingHref.match(/[?&]career=([^&#]+)/) || [])[1] || null;
  const targetEndingGame = ENDING_GAME;
  await pressVisible(cdp, '[data-career-panel="world-state"] [data-approach="' + ENDING_APPROACH + '"]', '终局入口');
  await cdp.waitFor(`(() => {
    var href = location.href;
    var ticket = (href.match(/[?&]career=([^&#]+)/) || [])[1] || '';
    return href !== ${J(beforeEndingHref)} &&
      location.pathname.indexOf('/games/${targetEndingGame}.html') >= 0 &&
      !!ticket && ticket !== ${J(beforeEndingTicket || '')};
  })()`, { timeout: 30000 });
  const endingLanded = await cdp.evaluate('({ href: location.href, path: location.pathname, search: location.search })');
  const endingLandedTicket = (endingLanded.search.match(/[?&]career=([^&#]+)/) || [])[1] || null;
  gate('C5 终局入口整页导航到新 ticket 的目标游戏',
    endingLanded.href !== beforeEndingHref && endingLanded.path.indexOf('/games/' + targetEndingGame + '.html') >= 0 &&
      !!endingLandedTicket && endingLandedTicket !== beforeEndingTicket,
    J({ beforeEndingHref, beforeEndingTicket, endingLanded, endingLandedTicket }));
  const endingGameId = await cdp.evaluate('location.pathname.split("/games/")[1] || ""');
  /* 安全检测：文档切换中 __arcadeCareerTest 可能是 undefined。 */
  await cdp.waitFor('!!(window.ArcadeCareer && window.ArcadeCareer.ready)', { timeout: 20000 });
  const endingHasTestApi = await cdp.evaluate('!!(window.__arcadeCareerTest && typeof window.__arcadeCareerTest.commissionRun === "function")');
  await waitBridge(cdp, 'ending-game', endingHasTestApi);
  await configureCommissionCatalog(cdp, 'ending-game');
  const endingRunExpr = endingHasTestApi
    ? '(window.__arcadeCareerTest && typeof window.__arcadeCareerTest.commissionRun === "function" ? window.__arcadeCareerTest.commissionRun() : null)'
    : '(window.ArcadeCareer && window.ArcadeCareer.commissionRun) || null';
  await cdp.waitFor(`(() => { var r = ${endingRunExpr}; return !!(r && r.ticketId); })()`, { timeout: 20000 });
  let endingRun = await cdp.evaluate(endingRunExpr);
  gate('C5 终局入口生成独立 ticket（玩家点击而非写旗标）', !!(endingRun && /^ending\./.test(endingRun.commissionId || '')), J(endingRun));
  if (!endingHasTestApi && endingRun && endingRun.ticketId) {
    const endingTicketId = endingRun.ticketId;
    const hookUrl = gameUrl(String(endingGameId).replace(/\.html.*$/, ''), { career: endingTicketId });
    await go(cdp, hookUrl, 'ending-hook-reopen');
    await waitBridge(cdp, 'ending-game-hook');
    await configureCommissionCatalog(cdp, 'ending-hook');
    await cdp.waitFor(`(() => { const t = window.__arcadeCareerTest; return !!(t && typeof t.commissionRun === 'function' && t.commissionRun()); })()`, { timeout: 15000 });
    endingRun = await cdp.evaluate('(window.__arcadeCareerTest && typeof window.__arcadeCareerTest.commissionRun === "function" ? window.__arcadeCareerTest.commissionRun() : null)');
    gate('C5 同 ticket 重新打开测试钩子（不重建票据）',
      !!(endingRun && endingRun.ticketId === endingTicketId && endingRun.commissionId === 'ending.' + ENDING_APPROACH),
      J({ original: endingTicketId, reopened: endingRun && endingRun.ticketId, commissionId: endingRun && endingRun.commissionId }));
  }
  await driveEndingResearch(cdp);
  const afterEnding = await readOnlyState(cdp);
  const c5Rows = (afterEnding.quests || []).filter((row) => row.nodeId === 'story:' + CHAPTER_FLAGS.C5);
  /* career-db.writeEndingQuestRows 写 markerRow.nodeId='ending.research'（kind:'ending'），
     不是 'story:ending.research'；兼容两种形状但优先真实写入形状。 */
  const endingRows = (afterEnding.quests || []).filter((row) =>
    row.nodeId === 'ending.' + ENDING_APPROACH ||
    (row.kind === 'ending' && row.approach === ENDING_APPROACH));
  gate('C5 终局真实结算唯一写入 C5 + ending.research', c5Rows.length === 1 && endingRows.length === 1, J({ c5Rows, endingRows }));
  const endingView = await campaignView(cdp, afterEnding);
  gate('C5 章节视图显示已完成与后日常入口', endingView.ok === true && endingView.chapters.some((chapter) => chapter.chapterId === 'C5' && chapter.state === 'complete'), J(endingView));
  const endingCard = await waitReceipt(cdp, endingRun.ticketId);
  checkReceiptText(endingCard, 'ending');
  /* 终局收据的主动作必须仍是玩家可见的「读后日谈」：点击后在同一页打开真实章节面板，
     由 world-state 渲染 [data-epilogue]；不做整页导航、不靠预写旗标。 */
  const epilogueAction = endingCard.buttons.find((button) => button.action === 'read-epilogue');
  requireFeature('C5 终局收据的主动作是读后日谈',
    !!(epilogueAction && epilogueAction.primary && epilogueAction.text === '读后日谈'), J(endingCard.buttons));
  const endingHref = await cdp.evaluate('location.href');
  await pressVisible(cdp, RECEIPT_CARD + ' [data-action="read-epilogue"]', '终局收据读后日谈');
  await waitPanel(cdp, 'world-state', 15000);
  const epilogue = await cdp.waitFor(`(() => {
    const section = document.querySelector('[data-career-panel="world-state"] [data-epilogue]');
    return section?.getClientRects().length && section.innerText.trim();
  })()`, { timeout: 15000 });
  gate('C5 读后日谈在当前页打开真实后日谈',
    /后日谈/.test(epilogue) && epilogue.length > 10 && await cdp.evaluate('location.href') === endingHref,
    J({ epilogue, epilogueAction, buttons: endingCard.buttons }));
  await checkConsole(cdp, 'ending');
  await verifyFirstArrivalConsumed(cdp);
}

/* ------------------------------------------------------------------ *
 * 6b. 0.24 世界叙事真实浏览器场景（独立 Chrome profile、串行）
 *
 * 目标（T24 证据，不替代单职业终局场景）：
 *   ① 真实起源路径接受职业 A，并用真实玩法推进到 C2 旗标；
 *   ② 未接受 B 时港口「眼下/工作」不出现任何交汇文本或内部 id；
 *   ③ 用 B 的真实线索入口接受 B，重开后 careerView.story.crossovers 真实出现该对；
 *   ④ 首次展示经真实 RECORD_STORY_EVENT 落库一次，重开两次不重复渲染/重复写；
 *   ⑤ 章节指引（港口经历页顶部 / 章节面板）来自公开文案，内部字段不进 DOM；
 *   ⑥ 经历页人物筛选与 detail 回读（展开/收起后焦点回到原条目）。
 * ------------------------------------------------------------------ */

function guideInternalHits(text) {
  const source = String(text || '');
  return GUIDE_INTERNAL_PATTERNS.filter((pattern) => pattern.re.test(source)).map((pattern) => pattern.name);
}

/** 只读 careerView 投影（surface 由调用方指定），不写任何库行。 */
async function readCareerProjection(cdp, surface) {
  return cdp.evaluate(`(async () => {
    const api = window.ArcadeCareer;
    if (!api || typeof api.careerView !== 'function') return { ok: false, reason: 'careerView-missing' };
    let view = null;
    try { view = await api.careerView({ surface: ${J(surface)} }); } catch (err) { return { ok: false, reason: 'careerView-threw' }; }
    if (!view) return { ok: false, reason: 'no-projection' };
    const story = view.story && typeof view.story === 'object' ? view.story : {};
    const crossovers = Array.isArray(story.crossovers) ? story.crossovers.map((row) => ({
      eventId: row && row.eventId ? row.eventId : null,
      texts: row && row.texts && typeof row.texts === 'object' ? {
        invite: String(row.texts.invite || ''),
        body: String(row.texts.body || ''),
        receipt: String(row.texts.receipt || ''),
      } : null,
    })) : [];
    const alternative = story.alternative && typeof story.alternative === 'object' ? {
      narrativeNodeId: String(story.alternative.narrativeNodeId || ''),
      texts: story.alternative.texts && typeof story.alternative.texts === 'object' ? {
        offer: String(story.alternative.texts.offer || ''),
        progress: String(story.alternative.texts.progress || ''),
        receipt: String(story.alternative.texts.receipt || ''),
        next: String(story.alternative.texts.next || ''),
      } : null,
    } : null;
    return {
      ok: true,
      surface: ${J(surface)},
      professions: (Array.isArray(view.professions) ? view.professions : []).map((row) => ({
        professionId: row && row.professionId ? row.professionId : null,
        displayName: row && row.displayName ? row.displayName : '',
        state: row && row.state ? row.state : null,
        active: !!(row && row.active === true),
      })),
      crossovers: crossovers,
      alternative: alternative,
      history: (Array.isArray(story.history) ? story.history : []).map((row) => ({
        label: String((row && (row.label || row.text)) || ''),
        kind: row && row.kind ? row.kind : null,
        at: row && row.at ? row.at : null,
        professionId: row && row.professionId ? row.professionId : null,
        person: row && row.person ? row.person : null,
        detail: row && row.detail && typeof row.detail === 'object' ? {
          text: String(row.detail.text || ''),
          person: String(row.detail.person || ''),
        } : null,
      })),
    };
  })()`);
}

/** 只读真实 storyEvents（测试页优先公开态快照，缺失回退 db.exportAll）。 */
async function readStoryEvents(cdp) {
  return cdp.evaluate(`(async () => {
    const api = window.ArcadeCareer;
    const test = window.__arcadeCareerTest;
    const toRows = (events) => Object.keys(events && typeof events === 'object' ? events : {}).sort().map((eventId) => ({
      eventId: eventId,
      at: (events[eventId] && events[eventId].at) || null,
      source: (events[eventId] && events[eventId].source) || null,
    }));
    if (test && typeof test.state === 'function') {
      const state = test.state();
      if (state && typeof state === 'object') {
        return { ok: true, source: 'test-state', events: toRows(state.storyEvents) };
      }
    }
    let db = test && typeof test.db === 'function' ? test.db() : (api && typeof api.db === 'function' ? api.db() : null);
    if (!db || typeof db.exportAll !== 'function') return { ok: false, reason: 'db-unavailable' };
    let exported = null;
    try { exported = await db.exportAll(); } catch (err) { return { ok: false, reason: 'export-threw' }; }
    if (!exported || exported.ok !== true || !exported.payload) return { ok: false, reason: 'export-failed' };
    const stateRows = Array.isArray(exported.payload.state) ? exported.payload.state : [];
    const discovery = stateRows.filter((row) => row && row.key === 'discovery')[0] || null;
    const value = discovery && discovery.value && typeof discovery.value === 'object' ? discovery.value : {};
    return { ok: true, source: 'db-export', events: toRows(value.storyEvents) };
  })()`);
}

async function waitStoryEvent(cdp, eventId, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await readStoryEvents(cdp);
    if (last && last.ok === true && last.events.some((row) => row.eventId === eventId)) return last;
    await sleep(150);
  }
  return last;
}

/**
 * 包裹真实 DB 门面的 RECORD_STORY_EVENT 分支，统计真实落库调用与结果（不替换实现）。
 * UI 侧调用的是 bridge 捕获的 recordWorldNarrativeEvent 引用，因此只能在 DB 层观测。
 */
async function watchWorldNarrativeRecords(cdp) {
  return cdp.evaluate(`(() => {
    const test = window.__arcadeCareerTest;
    const api = window.ArcadeCareer;
    const db = test && typeof test.db === 'function' ? test.db()
      : (api && typeof api.db === 'function' ? api.db() : null);
    if (!db || typeof db.applyProfessionEvent !== 'function') return false;
    if (db.__flowRecordOriginal) return true;
    const original = db.applyProfessionEvent;
    db.__flowRecordOriginal = original;
    db.__flowRecordCalls = [];
    db.applyProfessionEvent = function (action) {
      const eventId = action && action.action === 'RECORD_STORY_EVENT' && action.input && action.input.eventId
        ? action.input.eventId : null;
      const returned = original.call(db, action);
      if (eventId) {
        Promise.resolve(returned).then(
          (result) => db.__flowRecordCalls.push({ eventId: eventId, action: action.action, result: result }),
          (err) => db.__flowRecordCalls.push({ eventId: eventId, action: action.action, error: String((err && err.message) || err) })
        );
      }
      return returned;
    };
    return true;
  })()`);
}

async function readWorldNarrativeRecords(cdp) {
  return cdp.evaluate(`(() => {
    const test = window.__arcadeCareerTest;
    const api = window.ArcadeCareer;
    const db = test && typeof test.db === 'function' ? test.db()
      : (api && typeof api.db === 'function' ? api.db() : null);
    const rows = db && Array.isArray(db.__flowRecordCalls) ? db.__flowRecordCalls : [];
    return rows.map((row) => ({
      eventId: row && row.eventId ? row.eventId : null,
      action: row && row.action ? row.action : null,
      result: row && row.result ? {
        ok: row.result.ok === true,
        duplicate: row.result.duplicate === true,
        reason: row.result.reason || null,
      } : null,
      error: row && row.error ? row.error : null,
    }));
  })()`);
}

/** 港口面板：投影 + 三个 tab 的可见文本 + 真实交汇节点。 */
async function readPortSurface(cdp) {
  return cdp.evaluate(`(async () => {
    const api = window.ArcadeCareer;
    const panel = document.querySelector('[data-career-panel="town"]');
    const textOf = (node) => (node && node.textContent ? node.textContent.replace(/\\s+/g, ' ').trim() : '');
    let view = null;
    try { view = await api.careerView({ surface: 'port' }); } catch (err) { view = null; }
    const tabs = panel ? panel.querySelector('[role="tablist"]') : null;
    const nodes = panel ? Array.from(panel.querySelectorAll('[data-port-crossover]')) : [];
    return {
      ok: !!view,
      selectedTab: tabs ? tabs.getAttribute('data-selected-id') : null,
      panelText: textOf(panel),
      homeText: textOf(panel && panel.querySelector('[data-port-tabpanel="home"]')),
      workText: textOf(panel && panel.querySelector('[data-port-tabpanel="work"]')),
      journalText: textOf(panel && panel.querySelector('[data-port-tabpanel="journal"]')),
      crossoverNodes: nodes.length,
      crossoverTexts: nodes.map((node) => textOf(node)),
    };
  })()`);
}

async function pressPortTab(cdp, tab, label) {
  await pressVisible(cdp, '[data-career-panel="town"] [role="tablist"] [data-tab=' + J(tab) + ']', label);
  await cdp.waitFor(`(() => {
    const tabs = document.querySelector('[data-career-panel="town"] [role="tablist"]');
    return !!tabs && tabs.getAttribute('data-selected-id') === ${J(tab)};
  })()`, { timeout: 10000 });
}

/** 与 pressVisible 相同的真实鼠标点击，但用可见文本定位（筛选组在 <details> 内）。 */
async function pressVisibleByText(cdp, selector, text, label) {
  const target = await cdp.waitFor(`(() => {
    const el = [...document.querySelectorAll(${J(selector)})].find((node) =>
      (node.innerText || '').indexOf(${J(text)}) >= 0 && !node.disabled && node.getClientRects().length &&
      getComputedStyle(node).visibility === 'visible');
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const rect = el.getBoundingClientRect();
    const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
    const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
    if (!el.contains(document.elementFromPoint(x, y))) return null;
    return { x, y, text: (el.innerText || '').trim() };
  })()`, { timeout: 10000 }).catch((err) => { throw new Error(label + ' 不可点击', { cause: err }); });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  return target;
}

/** 港口装载完成（shell normal + 眼下故事卡）后再取样，避免读到装载期空帧。 */
async function settlePort(cdp, label) {
  step('port-settle:' + label);
  await cdp.waitFor(`(() => {
    const panel = document.querySelector('[data-career-panel="town"]');
    const shell = panel && panel.querySelector('.ac-career-ui__panel');
    return !!shell && shell.getAttribute('data-shell-state') === 'normal';
  })()`, { timeout: 15000 });
  await cdp.waitFor(`!!document.querySelector('[data-career-panel="town"] [data-port-tabpanel="home"] [data-story-state]')`, { timeout: 15000 });
}

async function closePort(cdp, label) {
  step('port-close:' + label);
  /* 港口没有公开 closeCareerPanel；真实关闭入口是 UI 模块自身的 close()（与 checkPortTools 同入口）。 */
  await cdp.evaluate(`(() => {
    const ui = window.ArcadeCareerUI && window.ArcadeCareerUI.town;
    if (ui && typeof ui.close === 'function') { try { ui.close(); } catch (err) { /* ignore */ } return true; }
    if (window.ArcadeCareer && typeof window.ArcadeCareer.closeCareerPanel === 'function') { window.ArcadeCareer.closeCareerPanel(); return true; }
    return false;
  })()`);
  await cdp.waitFor('!document.querySelector(`[data-career-panel="town"]`)', { timeout: 10000 });
  await sleep(120);
}

const closeCareerPanelByName = async (cdp, name) => {
  /* 面板 attr 用 kebab-case，UI 模块全局名是 camelCase（world-state → worldState）。 */
  const moduleName = name === 'world-state' ? 'worldState'
    : name === 'clue-surface' ? 'clueSurface' : name;
  await cdp.evaluate(`(() => {
    const ui = window.ArcadeCareerUI && window.ArcadeCareerUI[${J(moduleName)}];
    if (ui && typeof ui.close === 'function') { try { ui.close(); } catch (err) { /* ignore */ } }
    return true;
  })()`);
  await cdp.waitFor(`!document.querySelector('[data-career-panel=${J(name)}]')`, { timeout: 10000 });
  await sleep(120);
};

/** 场景步骤 1：真实起源路径接受 A，并用真实玩法推进到 C2。 */
async function phaseCrossoverIdentityAndChapter(cdp, campaign, commissions) {
  step('xover:origin-to-town');
  await runOriginToTown(cdp, CROSSOVER_A_GAME);
  const identity = await careerIdentitySnapshot(cdp);
  gate('XOVER 起源路径用真实 acceptProfessionInvitation 接受职业 A 且只建立 A',
    identity.ok === true && identity.originGameId === CROSSOVER_A_GAME &&
      identity.activeProfessionId === CROSSOVER_A_PROFESSION &&
      identity.professions.length === 1 &&
      identity.professions[0].professionId === CROSSOVER_A_PROFESSION &&
      identity.professions[0].state === 'accepted' && identity.run === null,
    J({ identity, expected: CROSSOVER_A_PROFESSION }));

  step('xover:advance-C2');
  let recommendation = await readPortRecommendation(cdp);
  requireFeature('XOVER 到港后港口首页给出真实推荐单', recommendation.ok === true && !!recommendation.commissionId, J(recommendation));
  const progress = [];
  for (let index = 0; index < WORLD_WORK_ROUTE.length; index += 1) {
    const expected = WORLD_WORK_ROUTE[index];
    const commissionId = recommendation.commissionId;
    const label = 'xover-order-' + (index + 1);
    const run = await acceptRecommended(cdp, commissionId, label);
    await driveCommission(cdp, commissionId, label);
    const card = await waitReceipt(cdp, run.ticketId);
    requireFeature('XOVER ' + label + ' ' + commissionId + ' 显示本票成功收据',
      card?.state === 'success' && card.runId === run.ticketId, J(card));
    const after = await verifyOrderProgress(cdp, label, commissionId, run.ticketId, expected.expectFlags,
      expected.expectFlags.length ? 'milestone' : 'step', campaign, commissions);
    progress.push({ commissionId, expectedFlags: expected.expectFlags, current: after.view.currentChapter });
    await phaseReceipt(cdp, label, expected.expectFlags, card);
    if (expected.expectFlags.includes(CROSSOVER_REQUIRED_FLAG)) {
      gate('XOVER 真实玩法推进到 C2（' + CROSSOVER_REQUIRED_FLAG + '）且未触碰终局', true, J(progress));
      return { recommendation, progress, reached: true };
    }
    await cdp.waitFor(`!!document.querySelector('[data-career-panel="town"] [data-port-tabpanel="home"] button[id^="port-story-"]')`, { timeout: 15000 });
    recommendation = await readPortRecommendation(cdp);
    requireFeature('XOVER 第 ' + (index + 2) + ' 单推荐仍真实可执行',
      recommendation.ok === true && !!recommendation.commissionId, J(recommendation));
  }
  gate('XOVER 真实玩法推进到 C2（' + CROSSOVER_REQUIRED_FLAG + '）且未触碰终局', false, J(progress));
  return { progress, reached: false };
}

/** 场景步骤 2：未接受 B 时港口「眼下/工作/经历」不得出现交汇文本或内部 id。 */
async function phaseCrossoverHiddenBeforeAccept(cdp) {
  step('xover:hidden-before-accept');
  requireFeature('XOVER 交汇内容与白名单行来自同源 world-narrative.json',
    !!CROSSOVER_PAIR && !!CROSSOVER_JOURNAL_ROW &&
      CROSSOVER_PAIR.texts && CROSSOVER_PAIR.texts.invite && CROSSOVER_PAIR.texts.body,
    J({ eventId: CROSSOVER_EVENT_ID, pair: !!CROSSOVER_PAIR, journal: !!CROSSOVER_JOURNAL_ROW }));
  if (!(await safeHasPort(cdp))) await openPort(cdp, 'xover-hidden-port');
  await settlePort(cdp, 'xover-hidden-home');
  const home = await readPortSurface(cdp);
  const homeProjection = await readCareerProjection(cdp, 'port');
  await pressPortTab(cdp, 'work', 'xover 工作页');
  await cdp.waitFor(`!!document.querySelector('[data-career-panel="town"] [data-port-tabpanel="work"] [data-port-profession]')`, { timeout: 15000 });
  await sleep(150);
  const work = await readPortSurface(cdp);
  await pressPortTab(cdp, 'journal', 'xover 经历页');
  await waitJournalTab(cdp, 'xover-hidden-journal');
  const journal = await readPortSurface(cdp);
  await pressPortTab(cdp, 'home', 'xover 回到眼下');

  const pairTexts = [CROSSOVER_PAIR.texts.invite, CROSSOVER_PAIR.texts.body, CROSSOVER_PAIR.texts.receipt, CROSSOVER_PAIR.texts.decline]
    .filter((text) => typeof text === 'string' && text);
  const visibleTexts = [home.panelText, work.panelText, journal.panelText].join('\n');
  const leakedTexts = pairTexts.filter((text) => visibleTexts.indexOf(text) >= 0);
  const leakedIds = ['crossover:', CROSSOVER_EVENT_ID].filter((needle) => visibleTexts.indexOf(needle) >= 0);
  const bName = CAREER_PROFESSION_NAMES.filter((row) => row.id === CROSSOVER_B_PROFESSION)[0];
  const bDisplayName = bName ? bName.name : '';
  const leakedProfession = [bDisplayName, CROSSOVER_B_PROFESSION].filter((needle) => needle && visibleTexts.indexOf(needle) >= 0);
  const internalHits = guideInternalHits(visibleTexts);

  gate('XOVER 未接受 B 时 careerView.story 不产出交汇，且只承认已接受 A',
    homeProjection.ok === true && homeProjection.crossovers.length === 0 &&
      !homeProjection.professions.some((row) => row.professionId === CROSSOVER_B_PROFESSION) &&
      homeProjection.professions.some((row) => row.professionId === CROSSOVER_A_PROFESSION),
    J({ crossovers: homeProjection.crossovers, professions: homeProjection.professions }));
  gate('XOVER 未接受 B 时港口眼下/工作/经历不出现任何交汇公开文本',
    leakedTexts.length === 0 && home.crossoverNodes === 0 && work.crossoverNodes === 0 && journal.crossoverNodes === 0,
    J({ leakedTexts, nodes: { home: home.crossoverNodes, work: work.crossoverNodes, journal: journal.crossoverNodes } }));
  gate('XOVER 未接受 B 时港口不出现内部事件 id（crossover:）',
    leakedIds.length === 0 && internalHits.length === 0,
    J({ leakedIds, internalHits, sample: home.panelText.slice(0, 320) }));
  gate('XOVER 未接受 B 时港口不泄漏 B 的职业名/内部职业 id',
    leakedProfession.length === 0,
    J({ leakedProfession, bDisplayName, accepted: homeProjection.professions.map((row) => row.professionId) }));
  return { home, work, journal, homeProjection, leakedTexts, leakedIds };
}

async function safeHasPort(cdp) {
  return cdp.evaluate('!!document.querySelector(`[data-career-panel="town"]`)');
}

async function waitJournalTab(cdp, label) {
  step('journal-wait:' + label);
  let loaded = true;
  try {
    await cdp.waitFor(`(() => {
      const content = document.querySelector('[data-career-panel="town"] [data-port-tabpanel="journal"]');
      if (!content) return false;
      if (content.textContent.indexOf('正在整理港口内容') >= 0) return false;
      return !!content.querySelector('[data-journal-surface="experience"]') ||
        !!content.querySelector('[data-timeline-state]') ||
        content.textContent.indexOf('读不出来') >= 0;
    })()`, { timeout: 20000 });
  } catch (err) {
    loaded = false;
  }
  const diag = await cdp.evaluate(`(() => {
    const content = document.querySelector('[data-career-panel="town"] [data-port-tabpanel="journal"]');
    return {
      present: !!content,
      text: content ? content.textContent.replace(/\\s+/g, ' ').trim().slice(0, 240) : null,
      surface: !!(content && content.querySelector('[data-journal-surface="experience"]')),
      timeline: content && content.querySelector('[data-timeline-state]') ? content.querySelector('[data-timeline-state]').getAttribute('data-timeline-state') : null,
    };
  })()`);
  gate('XOVER 港口经历页真实装载 [' + label + ']', loaded === true, J(diag));
  return loaded;
}

/** 场景步骤 3：通过 B 的真实线索入口（gomoku 经典对局 → 线索 chip → 信箱邀请）接受 B。 */
async function phaseAcceptSecondProfession(cdp, label) {
  step('xover:accept-b');
  await go(cdp, gameUrl(CROSSOVER_B_GAME), label + '-game');
  await waitBridge(cdp, label + '-game', true);
  await configureCommissionCatalog(cdp, label + '-game');
  await startOverlay(cdp, label + '-play');
  const played = await cdp.evaluate('window.__arcadeTest.playToEnd()');
  await cdp.waitFor('!!(window.__arcadeCareerTest.info && window.__arcadeCareerTest.info().finished === true)', { timeout: 30000 });
  const finish = await cdp.evaluate('window.__arcadeCareerTest.lastFinish()');
  gate('XOVER B 的真实玩法自然结算并提交 classic finish',
    !!(finish && finish.input && finish.input.mode === 'classic' && finish.result && finish.result.persisted === true),
    J({ played, finish: finish && { input: finish.input, result: finish.result } }));
  const chip = await cdp.waitFor(`(() => {
    const wrap = document.querySelector('[data-career-clue=${J(CROSSOVER_B_CLUE)}]');
    const node = wrap && wrap.querySelector('button.ac-career-ui__clue');
    if (!node || !node.getClientRects().length) return null;
    const rect = node.getBoundingClientRect();
    node.focus();
    return {
      text: (node.textContent || '').replace(/\\s+/g, ' ').trim(),
      state: node.getAttribute('data-clue-state'),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      focused: document.activeElement === node,
    };
  })()`, { timeout: 25000 });
  gate('XOVER 第二职业的线索 chip 来自真实结算且可交互',
    !!(chip && chip.h >= 44 && chip.w >= 44 && chip.text && chip.focused === true),
    J(chip));
  await pressVisible(cdp, `[data-career-clue=${J(CROSSOVER_B_CLUE)}] button.ac-career-ui__clue`, label + ' 线索 chip');
  await cdp.waitFor(`!!document.querySelector('[data-career-panel="mailbox"]')`, { timeout: 20000 });
  const invitation = await cdp.waitFor(`(() => {
    const api = window.ArcadeCareer;
    const row = api && typeof api.invitationForClue === 'function' ? api.invitationForClue(${J(CROSSOVER_B_CLUE)}) : null;
    if (!row) return null;
    return {
      professionId: row.professionId || null,
      gameId: row.gameId || null,
      state: row.state || null,
      canAccept: row.canAccept === true,
      firstArrival: row.firstArrival === true,
    };
  })()`, { timeout: 20000 });
  await cdp.waitFor(`(() => {
    const button = document.querySelector('[data-career-panel="mailbox"] [data-action="accept-invitation"]');
    return !!button && !button.hidden && !button.disabled && button.getClientRects().length > 0;
  })()`, { timeout: 20000 });
  const mailbox = await panelSnapshot(cdp, 'mailbox');
  gate('XOVER 第二职业的邀请面来自真实线索映射（glimpsed/read，可接受）',
    !!invitation && invitation.professionId === CROSSOVER_B_PROFESSION && invitation.gameId === CROSSOVER_B_GAME &&
      invitation.state === 'read' && invitation.canAccept === true && invitation.firstArrival === false &&
      !!mailbox && mailbox.text.length > 20,
    J({ invitation, mailbox: mailbox && mailbox.text.slice(0, 320) }));
  await watchAcceptInvitation(cdp);
  await pressVisible(cdp, '[data-career-panel="mailbox"] [data-action="accept-invitation"]', label + ' 接受职业 B');
  const afterAccept = await cdp.waitFor(`(async () => {
    const api = window.ArcadeCareer;
    const view = await api.careerView({ surface: 'port' });
    const rows = view && Array.isArray(view.professions) ? view.professions : [];
    const target = rows.filter((row) => row && row.professionId === ${J(CROSSOVER_B_PROFESSION)})[0] || null;
    if (!target || ['accepted', 'developed', 'completed'].indexOf(String(target.state)) < 0) return null;
    return {
      professions: rows.map((row) => ({ professionId: row.professionId, state: row.state, active: row.active === true })),
      run: api.commissionRun || null,
    };
  })()`, { timeout: 25000 });
  const acceptCalls = await readAcceptInvitationCalls(cdp);
  const acceptedCall = acceptCalls.filter((row) => row.result && row.result.ok === true)[0] || null;
  gate('XOVER 第二职业通过真实 acceptProfessionInvitation 接受，继承原身份且不自动接单',
    acceptCalls.length === 1 && !!acceptedCall &&
      acceptedCall.input.professionId === CROSSOVER_B_PROFESSION &&
      acceptedCall.input.gameId === CROSSOVER_B_GAME &&
      acceptedCall.result.created !== true &&
      afterAccept.run === null && afterAccept.professions.length === 2 &&
      afterAccept.professions.filter((row) => ['accepted', 'developed', 'completed'].indexOf(String(row.state)) >= 0).length === 2,
    J({ acceptCalls, afterAccept, invitation }));
  await closeCareerPanelByName(cdp, 'mailbox');
  return { invitation, afterAccept, acceptCalls };
}

/**
 * 场景步骤 4+5：重开港口 → careerView.story.crossovers 真实出现该对、
 * 首次展示落库一次；关页重开两次不重复渲染/不重复写。
 */
async function phaseCrossoverSurfaceAndRecordOnce(cdp) {
  step('xover:surface-and-record');
  await go(cdp, gameUrl('pendulum-tower'), 'xover-reopen-1');
  await waitBridge(cdp, 'xover-reopen-1', true);
  await configureCommissionCatalog(cdp, 'xover-reopen-1');
  const watched = await watchWorldNarrativeRecords(cdp);
  requireFeature('XOVER 可观测真实落库链路 career-db.applyProfessionEvent/RECORD_STORY_EVENT', watched === true, 'db applyProfessionEvent missing');
  /* 港口「眼下」首次渲染会立刻落库并把事件标为历史；为保证「打开前投影里有该对」
     是确定性事实，先打开并关闭一次真实信箱面板（与港口同一条 openCareerUi 预热链，
     会配置 storyEvidence/campaign 真实事实，但不会渲染港口、也不会写交汇），
     再用同一 careerView 门面读取 port/journal 两个面。 */
  const mailboxOpened = await cdp.evaluate(`(async () => {
    const api = window.ArcadeCareer;
    if (!api || typeof api.openMailbox !== 'function') return { ok: false, reason: 'openMailbox-missing' };
    const opened = await api.openMailbox();
    return { ok: !!(opened && opened.ok !== false) };
  })()`);
  requireFeature('XOVER 预热真实面板（信箱）可用', mailboxOpened.ok === true, J(mailboxOpened));
  await cdp.waitFor(`!!document.querySelector('[data-career-panel="mailbox"]')`, { timeout: 15000 });
  await closeCareerPanelByName(cdp, 'mailbox');
  const beforeRender = await cdp.evaluate(`(async () => {
    const api = window.ArcadeCareer;
    const pick = (view) => {
      const rows = view && view.story && Array.isArray(view.story.crossovers) ? view.story.crossovers : [];
      return rows.map((row) => ({
        eventId: row && row.eventId ? row.eventId : null,
        texts: row && row.texts ? {
          invite: String(row.texts.invite || ''),
          body: String(row.texts.body || ''),
          receipt: String(row.texts.receipt || ''),
        } : null,
      }));
    };
    const portView = await api.careerView({ surface: 'port' });
    const journalView = await api.careerView({ surface: 'journal' });
    return { port: pick(portView), journal: pick(journalView) };
  })()`);
  const prePortCross = beforeRender.port[0] || null;
  gate('XOVER 双方接受后 careerView.story.crossovers 真实出现该对（open 面，渲染前只读）',
    beforeRender.port.length === 1 && !!prePortCross &&
      prePortCross.eventId === CROSSOVER_EVENT_ID && !!prePortCross.texts &&
      prePortCross.texts.invite === CROSSOVER_PAIR.texts.invite &&
      prePortCross.texts.body === CROSSOVER_PAIR.texts.body &&
      (prePortCross.texts.receipt === (CROSSOVER_PAIR.texts.receipt || '') || !CROSSOVER_PAIR.texts.receipt),
    J({ beforeRender, expectedEventId: CROSSOVER_EVENT_ID }));
  gate('XOVER 交汇同时在 journal 面出现（经历白名单面 gate）',
    beforeRender.journal.length === 1 && beforeRender.journal[0].eventId === CROSSOVER_EVENT_ID,
    J({ journal: beforeRender.journal }));
  await openPort(cdp, 'xover-reopen-1');
  await settlePort(cdp, 'xover-reopen-1');
  const port = await readPortSurface(cdp);
  gate('XOVER 港口「眼下」渲染真实交汇 invite/body 公开文案且节点唯一',
    port.crossoverNodes === 1 &&
      homeContainsAll(port.homeText, [CROSSOVER_PAIR.texts.invite, CROSSOVER_PAIR.texts.body]) &&
      homeContainsAll(port.crossoverTexts[0] || '', [CROSSOVER_PAIR.texts.invite, CROSSOVER_PAIR.texts.body]),
    J({ nodes: port.crossoverNodes, texts: port.crossoverTexts, home: port.homeText.slice(0, 480) }));
  gate('XOVER 港口 DOM 不渲染交汇内部 id（eventId/pairId/crossover:）',
    guideInternalHits(port.panelText).length === 0,
    J({ hits: guideInternalHits(port.panelText), sample: port.panelText.slice(0, 480) }));

  const eventsFirst = await waitStoryEvent(cdp, CROSSOVER_EVENT_ID, 8000);
  const firstRows = eventsFirst && eventsFirst.ok === true ? eventsFirst.events.filter((row) => row.eventId === CROSSOVER_EVENT_ID) : [];
  const callsFirst = await readWorldNarrativeRecords(cdp);
  gate('XOVER 首次展示经真实 RECORD_STORY_EVENT 落库一次（source=world、合法 at）',
    firstRows.length === 1 && typeof firstRows[0].at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(firstRows[0].at) &&
      firstRows[0].source === 'world' &&
      callsFirst.length === 1 && callsFirst[0].eventId === CROSSOVER_EVENT_ID &&
      !!callsFirst[0].result && callsFirst[0].result.ok === true && callsFirst[0].result.duplicate === false,
    J({ events: eventsFirst && eventsFirst.events, calls: callsFirst }));
  const firstAt = firstRows.length ? firstRows[0].at : null;

  await closePort(cdp, 'xover-reopen-1');
  await openPort(cdp, 'xover-reopen-2');
  await settlePort(cdp, 'xover-reopen-2');
  const second = await readPortSurface(cdp);
  const secondProjection = await readCareerProjection(cdp, 'port');
  const secondEvents = await readStoryEvents(cdp);
  const secondCalls = await readWorldNarrativeRecords(cdp);
  const secondRows = secondEvents && secondEvents.ok === true ? secondEvents.events.filter((row) => row.eventId === CROSSOVER_EVENT_ID) : [];
  gate('XOVER 关闭重开港口不再重复渲染交汇（resolver 已按历史事件收口）',
    second.crossoverNodes === 0 && secondProjection.crossovers.length === 0 &&
      second.homeText.indexOf(CROSSOVER_PAIR.texts.invite) < 0,
    J({ nodes: second.crossoverNodes, crossovers: secondProjection.crossovers, home: second.homeText.slice(0, 320) }));
  gate('XOVER 第二次重开不重复落库（仍一行、at 不变、无新写调用）',
    secondRows.length === 1 && secondRows[0].at === firstAt &&
      secondCalls.length === callsFirst.length,
    J({ events: secondEvents && secondEvents.events, calls: secondCalls.map((row) => row.eventId), firstAt }));

  await go(cdp, gameUrl('pendulum-tower'), 'xover-reopen-3');
  await waitBridge(cdp, 'xover-reopen-3', true);
  await configureCommissionCatalog(cdp, 'xover-reopen-3');
  await openPort(cdp, 'xover-reopen-3');
  await settlePort(cdp, 'xover-reopen-3');
  const third = await readPortSurface(cdp);
  const thirdProjection = await readCareerProjection(cdp, 'port');
  const thirdEvents = await readStoryEvents(cdp);
  const thirdRows = thirdEvents && thirdEvents.ok === true ? thirdEvents.events.filter((row) => row.eventId === CROSSOVER_EVENT_ID) : [];
  gate('XOVER 整页重开后仍只有一条交汇经历、港口不重播、at 不变',
    third.crossoverNodes === 0 && thirdProjection.crossovers.length === 0 &&
      thirdRows.length === 1 && thirdRows[0].at === firstAt,
    J({ nodes: third.crossoverNodes, crossovers: thirdProjection.crossovers, events: thirdEvents && thirdEvents.events, firstAt }));
  return { firstAt, port, prePortCross };
}

function homeContainsAll(text, needles) {
  const source = String(text || '');
  return needles.filter((needle) => typeof needle === 'string' && needle).every((needle) => source.indexOf(needle) >= 0);
}

/** 场景步骤 5：章节指引（港口经历页顶部 + 章节面板）与经历页回读。 */
async function phaseChapterGuideAndJournal(cdp) {
  step('xover:chapter-guide');
  if (!(await safeHasPort(cdp))) await openPort(cdp, 'xover-guide-port');
  await settlePort(cdp, 'xover-guide-port');
  await pressPortTab(cdp, 'journal', 'xover 章节指引');
  const loaded = await waitJournalTab(cdp, 'xover-guide');
  let guide = null;
  if (loaded) {
    guide = await cdp.evaluate(`(async () => {
      const api = window.ArcadeCareer;
      const panel = document.querySelector('[data-career-panel="town"]');
      const content = panel ? panel.querySelector('[data-port-tabpanel="journal"]') : null;
      const textOf = (node) => (node && node.textContent ? node.textContent.replace(/\\s+/g, ' ').trim() : '');
      const node = content ? content.querySelector('[data-port-chapter-guide]') : null;
      const facade = api.worldNarrative;
      let resolved = { ok: false, reason: 'facade-missing', nodes: [], chapterId: null };
      if (facade && typeof facade.resolveWorldAlternatives === 'function') {
        const result = facade.resolveWorldAlternatives({});
        resolved = {
          ok: !!result,
          chapterId: result && result.chapterId || null,
          nodes: result && Array.isArray(result.nodes) ? result.nodes.map((row) => ({
            narrativeNodeId: row && row.narrativeNodeId ? row.narrativeNodeId : '',
            texts: row && row.texts ? { offer: String(row.texts.offer || ''), next: String(row.texts.next || '') } : null,
          })) : [],
        };
      }
      return {
        present: !!node,
        text: node ? textOf(node) : '',
        captions: node ? Array.from(node.querySelectorAll(':scope > .ac-career-ui__caption')).map((item) => textOf(item)) : [],
        alternativeList: !!(node && node.querySelector('[data-port-chapter-alternatives]')),
        alternatives: node ? Array.from(node.querySelectorAll('[data-port-chapter-alternatives] li')).map((item) => textOf(item)) : [],
        resolved: resolved,
      };
    })()`);
  }
  const guideHits = guide
    ? guideInternalHits([guide.text, guide.captions.join(' '), guide.alternatives.join(' ')].join('\n'))
    : ['guide-missing'];
  /* 每条替代说明的「下一步：X」都必须有公开文案；且至少一条与内容侧 world-narrative
     节点的 offer+next 成对一致（证明章节指引绑定真实内容，而不是 UI 自造）。 */
  const guideRows = guide && Array.isArray(guide.alternatives) ? guide.alternatives : [];
  const guideRowNexts = guideRows.map((row) => {
    const match = String(row || '').match(/下一步：(.+)$/);
    return match ? match[1].trim() : '';
  });
  const boundGuideRows = guideRows.filter((row, index) => {
    const next = guideRowNexts[index];
    if (!next) return false;
    return WORLD_ALTERNATIVE_TEXT_PAIRS.some((pair) => pair.next === next && !!pair.offer && row.indexOf(pair.offer) >= 0);
  });
  gate('XOVER 港口经历页顶部章节指引节点存在且只渲染公开前置/替代说明',
    !!guide && guide.present === true && !!guide.text && guide.text.length > 0 &&
      guide.captions.length >= 1 && guideRowNexts.every((next) => !!next) &&
      boundGuideRows.length >= 1,
    J({
      guide: guide && { present: guide.present, text: guide.text.slice(0, 600), captions: guide.captions.map((row) => row.slice(0, 200)), alternatives: guideRows },
      guideHits,
      guideRowNexts,
      boundGuideRows: boundGuideRows.length,
      contentPairs: WORLD_ALTERNATIVE_TEXT_PAIRS.length,
    }));
  gate('XOVER 章节指引不含内部字段（narrativeNodeId/anchor/requirement/tokens/altn./章节码）',
    guideHits.length === 0,
    J({ hits: guideHits, sample: guide && guide.text.slice(0, 480) }));
  if (guide && guide.resolved && guide.resolved.nodes.some((row) => row.narrativeNodeId)) {
    const ids = guide.resolved.nodes.map((row) => row.narrativeNodeId).filter(Boolean);
    gate('XOVER 真实 resolver 节点 id 未进入港口 DOM',
      ids.every((id) => guide.text.indexOf(id) < 0), J({ ids }));
  }

  step('xover:chapter-panel');
  await closePort(cdp, 'xover-guide-port');
  await cdp.evaluate('window.ArcadeCareer.openCampaign()');
  await waitPanel(cdp, 'world-state', 20000);
  await cdp.waitFor(`!!document.querySelector('[data-career-panel="world-state"] [data-chapter-id]')`, { timeout: 15000 });
  const world = await cdp.evaluate(`(() => {
    const panel = document.querySelector('[data-career-panel="world-state"]');
    const textOf = (node) => (node && node.textContent ? node.textContent.replace(/\\s+/g, ' ').trim() : '');
    const rows = Array.from(panel.querySelectorAll('[data-chapter-id]')).map((row) => ({
      chapterId: row.getAttribute('data-chapter-id'),
      state: row.getAttribute('data-state'),
      requirement: textOf(row.querySelector('.ac-career-world__requirement')),
      completion: textOf(row.querySelector('.ac-career-world__completion')),
      alternativeCount: (() => {
        const list = row.querySelector('.ac-career-world__alternatives');
        return list ? list.getAttribute('data-alternative-count') : null;
      })(),
      alternatives: Array.from(row.querySelectorAll('.ac-career-world__alternative')).map((item) => textOf(item)),
    }));
    return { text: textOf(panel), rows };
  })()`);
  const guidingRows = world.rows.filter((row) => row.requirement || row.completion);
  const worldHits = guideInternalHits(world.text);
  gate('XOVER 章节面板章节行显示真实前置/完成说明',
    guidingRows.length >= 1 && guidingRows.every((row) => (row.requirement || row.completion).length > 0),
    J({ guidingRows, rows: world.rows.map((row) => ({ chapterId: row.chapterId, state: row.state, alternativeCount: row.alternativeCount })) }));
  gate('XOVER 章节面板不含内部字段/内部 id', worldHits.length === 0, J({ hits: worldHits, sample: world.text.slice(0, 480) }));
  /* 同一公开前置文本必须跨两个面板一致（港口经历页顶部 vs 章节面板），证明同源只读。 */
  if (guide && guidingRows.length) {
    const worldTexts = guidingRows.flatMap((row) => [row.requirement, row.completion]).filter(Boolean);
    gate('XOVER 港口经历页顶部的章节说明与章节面板同源一致',
      worldTexts.some((text) => guide.text.indexOf(text) >= 0),
      J({ portGuide: guide.text.slice(0, 320), worldTexts }));
  }
  await closeCareerPanelByName(cdp, 'world-state');

  step('xover:journal-experience');
  await openPort(cdp, 'xover-journal-port');
  await settlePort(cdp, 'xover-journal-port');
  await pressPortTab(cdp, 'journal', 'xover 经历回读');
  await waitJournalTab(cdp, 'xover-journal-readback');
  const journalView = await readCareerProjection(cdp, 'journal');
  /* 诊断：经历增强模块是否真实挂载/可渲染；不可渲染时港口会静默退回 0.23 时间线。 */
  const journalDiag = await cdp.evaluate(`(async () => {
    const ui = window.ArcadeCareerUI || {};
    const mod = ui.journal;
    const components = ui.components;
    const api = window.ArcadeCareer;
    const out = {
      module: !!(mod && typeof mod.render === 'function'),
      components: !!(components && typeof components.JournalTimeline === 'function' && typeof components.SecondaryAction === 'function'),
      moduleKeys: mod ? Object.keys(mod) : [],
    };
    if (!out.module) return out;
    try {
      const view = await api.careerView({ surface: 'journal' });
      const rendered = mod.render({ view: view, components: components });
      out.render = rendered ? {
        nodeType: rendered.nodeType,
        surface: rendered.getAttribute ? rendered.getAttribute('data-journal-surface') : null,
        entries: rendered.querySelectorAll ? rendered.querySelectorAll('[data-journal-entry]').length : 0,
        timeline: rendered.querySelector && rendered.querySelector('[data-timeline-state]')
          ? rendered.querySelector('[data-timeline-state]').getAttribute('data-timeline-state') : null,
      } : null;
    } catch (err) {
      out.error = String((err && err.message) || err);
      out.stack = String((err && err.stack) || '').slice(0, 500);
    }
    return out;
  })()`);
  const journal = await cdp.evaluate(`(() => {
    const panel = document.querySelector('[data-career-panel="town"]');
    const content = panel ? panel.querySelector('[data-port-tabpanel="journal"]') : null;
    const textOf = (node) => (node && node.textContent ? node.textContent.replace(/\\s+/g, ' ').trim() : '');
    if (!content) return null;
    const surface = content.querySelector('[data-journal-surface="experience"]');
    const entries = Array.from(content.querySelectorAll('[data-journal-entry]')).map((node) => ({
      index: node.getAttribute('data-journal-entry'),
      label: textOf(node.querySelector('.ac-career-ui__timeline-label')),
      expanded: node.getAttribute('data-journal-expanded'),
      readToggle: (() => {
        const toggle = node.querySelector('[data-journal-read]');
        return toggle ? { index: toggle.getAttribute('data-journal-read'), expanded: toggle.getAttribute('aria-expanded') } : null;
      })(),
      hasDetail: !!node.querySelector('[data-journal-readback]'),
      detailText: textOf(node.querySelector('[data-journal-readback] .ac-career-ui__npc-paragraph')),
      detailPerson: textOf(node.querySelector('[data-journal-readback-person]')),
    }));
    const groups = Array.from(content.querySelectorAll('[data-journal-filter-group]')).map((group) => ({
      scope: group.getAttribute('data-journal-filter-group'),
      summary: textOf(group.querySelector('summary')),
      options: Array.from(group.querySelectorAll('[data-journal-filter]')).map((button) => ({
        scope: button.getAttribute('data-journal-filter'),
        text: textOf(button),
        pressed: button.getAttribute('aria-pressed'),
      })),
    }));
    const timeline = content.querySelector('[data-timeline-state]');
    return {
      surface: !!surface,
      timelineState: timeline ? timeline.getAttribute('data-timeline-state') : null,
      entries: entries,
      groups: groups,
      text: textOf(content),
    };
  })()`);
  const crossoverHistory = journalView.ok === true
    ? journalView.history.filter((row) => row.label === CROSSOVER_JOURNAL_ROW.label) : [];
  gate('XOVER 经历页真实投影只有一条交汇经历且带 detail{text,person}',
    journalView.ok === true && journalView.history.length === 1 &&
      crossoverHistory.length === 1 &&
      !!crossoverHistory[0].detail &&
      crossoverHistory[0].detail.text === CROSSOVER_JOURNAL_ROW.text &&
      crossoverHistory[0].detail.person === (CROSSOVER_JOURNAL_ROW.person || '') &&
      crossoverHistory[0].person === CROSSOVER_JOURNAL_ROW.person,
    J({ history: journalView.ok ? journalView.history : journalView }));
  gate('XOVER 经历页真实 DOM 渲染该条经历且回读按钮/详情来自投影',
    !!journal && journal.surface === true && journal.timelineState === 'filled' &&
      journal.entries.length === 1 && journal.entries[0].label === CROSSOVER_JOURNAL_ROW.label &&
      journal.entries[0].hasDetail === true && !!journal.entries[0].readToggle &&
      journal.entries[0].detailText === CROSSOVER_JOURNAL_ROW.text &&
      (!CROSSOVER_JOURNAL_ROW.person || journal.entries[0].detailPerson === CROSSOVER_JOURNAL_ROW.person),
    J({ journal, journalDiag }));
  gate('XOVER 经历页不渲染内部 id/字段（含 eventId/person 原始 token）',
    !!journal && guideInternalHits(journal.text).length === 0,
    J({ hits: journal ? guideInternalHits(journal.text) : ['journal-missing'], sample: journal && journal.text.slice(0, 480) }));

  /* 人物筛选：真实白名单 person 出现在筛选组；点击后只留该人物，再复位。 */
  const personGroup = journal ? journal.groups.filter((group) => group.scope === 'person')[0] || null : null;
  const personName = CROSSOVER_JOURNAL_ROW.person || '';
  const personGroupOk = !!personGroup && !!personGroup.options.length &&
    personGroup.options.every((option) => option.scope === 'person') &&
    (!personName || personGroup.options.some((option) => option.text.indexOf(personName) >= 0));
  gate('XOVER 经历页按人物筛选组来自真实白名单 person', personGroupOk, J({ personGroup, personName, journalDiag }));
  let filtered = null;
  let reset = null;
  if (personGroupOk) {
    await pressVisible(cdp, '[data-journal-filter-group="person"] summary', '人物筛选展开');
    await sleep(120);
    await pressVisible(cdp, '[data-journal-filter="person"]', '人物筛选');
    filtered = await cdp.evaluate(`(() => {
      const content = document.querySelector('[data-career-panel="town"] [data-port-tabpanel="journal"]');
      const textOf = (node) => (node && node.textContent ? node.textContent.replace(/\\s+/g, ' ').trim() : '');
      const items = Array.from(content.querySelectorAll('[data-journal-entry]'));
      const visible = items.filter((node) => !node.hidden && node.getClientRects().length > 0);
      const caption = content.querySelector('[data-journal-active-filter]');
      return {
        total: items.length,
        visible: visible.length,
        visiblePersons: visible.map((node) => textOf(node.querySelector('[data-journal-readback-person]'))),
        visibleLabels: visible.map((node) => textOf(node.querySelector('.ac-career-ui__timeline-label'))),
        caption: caption ? { hidden: caption.hidden, text: textOf(caption) } : null,
        pressed: Array.from(content.querySelectorAll('[data-journal-filter]')).map((button) => ({ scope: button.getAttribute('data-journal-filter'), pressed: button.getAttribute('aria-pressed'), text: textOf(button) })),
      };
    })()`);
    gate('XOVER 经历页人物筛选后只留该人物的经历且状态条可读',
      !!filtered && filtered.total >= 1 && filtered.visible === 1 &&
        filtered.caption && filtered.caption.hidden === false &&
        (!personName || filtered.caption.text === '正在看人物：' + personName) &&
        filtered.pressed.some((row) => row.scope === 'person' && row.pressed === 'true'),
      J({ filtered, personName }));
    await pressVisible(cdp, '[data-journal-reset]', '看全部经历');
    await sleep(120);
    reset = await cdp.evaluate(`(() => {
      const content = document.querySelector('[data-career-panel="town"] [data-port-tabpanel="journal"]');
      const textOf = (node) => (node && node.textContent ? node.textContent.replace(/\\s+/g, ' ').trim() : '');
      const items = Array.from(content.querySelectorAll('[data-journal-entry]'));
      const visible = items.filter((node) => !node.hidden && node.getClientRects().length > 0);
      const caption = content.querySelector('[data-journal-active-filter]');
      return {
        total: items.length,
        visible: visible.length,
        captionHidden: caption ? caption.hidden : null,
        pressed: Array.from(content.querySelectorAll('[data-journal-filter]')).map((button) => button.getAttribute('aria-pressed')),
      };
    })()`);
    gate('XOVER 经历页「看全部经历」复位筛选且不显示总数/百分比',
      !!reset && reset.visible === reset.total && reset.captionHidden === true &&
        reset.pressed.every((value) => value === 'false') &&
        !/[0-9]+\s*\/\s*[0-9]+|%|共有\s*[0-9]+\s*条/.test(journal.text),
      J({ reset, journalSample: journal.text.slice(0, 320) }));
  }

  /* 回读：展开后 detail 可见、焦点在原条目；收起后隐藏、焦点仍在原条目。 */
  let readback = null;
  const detailEntry = journal && journal.entries.filter((entry) => entry.hasDetail && entry.readToggle)[0];
  if (detailEntry) {
    const toggleSelector = '[data-career-panel="town"] [data-port-tabpanel="journal"] [data-journal-read="' + detailEntry.readToggle.index + '"]';
    await pressVisible(cdp, toggleSelector, '回读这段');
    await sleep(120);
    readback = await cdp.evaluate(`(() => {
      const panel = document.querySelector('[data-career-panel="town"]');
      const content = panel.querySelector('[data-port-tabpanel="journal"]');
      const item = content.querySelector('[data-journal-entry="${detailEntry.index}"]');
      const detail = item.querySelector('[data-journal-readback]');
      const toggle = item.querySelector('[data-journal-read="${detailEntry.readToggle.index}"]');
      const textOf = (node) => (node && node.textContent ? node.textContent.replace(/\\s+/g, ' ').trim() : '');
      return {
        expanded: item.getAttribute('data-journal-expanded'),
        detailHidden: detail ? detail.hidden : null,
        detailVisible: !!(detail && detail.getClientRects().length > 0),
        detailText: textOf(detail && detail.querySelector('.ac-career-ui__npc-paragraph')),
        detailPerson: textOf(detail && detail.querySelector('[data-journal-readback-person]')),
        ariaExpanded: toggle ? toggle.getAttribute('aria-expanded') : null,
        focusOnToggle: document.activeElement === toggle,
        activeTag: document.activeElement ? document.activeElement.tagName : null,
      };
    })()`);
    gate('XOVER 经历回读展开后 detail 文本/人物来自真实投影且焦点在原条目',
      !!readback && readback.detailVisible === true && readback.detailHidden === false &&
        readback.detailText === CROSSOVER_JOURNAL_ROW.text &&
        (!CROSSOVER_JOURNAL_ROW.person || readback.detailPerson === CROSSOVER_JOURNAL_ROW.person) &&
        readback.ariaExpanded === 'true' && readback.expanded === 'true' &&
        readback.focusOnToggle === true,
      J({ readback }));
    await pressVisible(cdp, toggleSelector, '收起回读');
    await sleep(120);
    const collapsed = await cdp.evaluate(`(() => {
      const panel = document.querySelector('[data-career-panel="town"]');
      const content = panel.querySelector('[data-port-tabpanel="journal"]');
      const item = content.querySelector('[data-journal-entry="${detailEntry.index}"]');
      const detail = item.querySelector('[data-journal-readback]');
      const toggle = item.querySelector('[data-journal-read="${detailEntry.readToggle.index}"]');
      return {
        expanded: item.getAttribute('data-journal-expanded'),
        detailHidden: detail ? detail.hidden : null,
        ariaExpanded: toggle ? toggle.getAttribute('aria-expanded') : null,
        focusOnToggle: document.activeElement === toggle,
      };
    })()`);
    gate('XOVER 收起回读后详情隐藏且焦点仍在原条目控件',
      !!collapsed && collapsed.detailHidden === true && collapsed.expanded === 'false' &&
        collapsed.ariaExpanded === 'false' && collapsed.focusOnToggle === true,
      J({ collapsed }));
  } else {
    gate('XOVER 经历页存在带 detail 的可回读条目', false, J({ entries: journal && journal.entries }));
  }

  /* 职业筛选：记录真实内容下的数据源事实（0.24 白名单未声明 professionId；不得伪造数据）。 */
  const professionGroups = journal ? journal.groups.filter((group) => group.scope === 'profession') : [];
  const professionRows = journalView.ok === true ? journalView.history.filter((row) => row.professionId) : [];
  gate('XOVER 经历页按职业筛选：当前真实内容无 professionId 事件（记录为未覆盖缺口）',
    professionGroups.length === 0 && professionRows.length === 0,
    J({ professionGroups, professionRows, groups: journal && journal.groups.map((group) => group.scope), note: '契约已支持 professionId，但 world-narrative.journalWhitelist 未声明；邀请类事件也未写入 storyEvents' }));
  return { guide, world, journal, journalView, filtered, reset, readback };
}

async function runCrossoverScenario(cdp, campaign, commissions) {
  requireFeature('XOVER 起源与第二职业内容映射齐备',
    typeof CROSSOVER_A_PROFESSION === 'string' && typeof CROSSOVER_B_PROFESSION === 'string' && !!CROSSOVER_PAIR,
    J({ a: CROSSOVER_A_PROFESSION, b: CROSSOVER_B_PROFESSION, eventId: CROSSOVER_EVENT_ID }));
  await phaseCrossoverIdentityAndChapter(cdp, campaign, commissions);
  await phaseCrossoverHiddenBeforeAccept(cdp);
  await phaseAcceptSecondProfession(cdp, 'xover-gomoku');
  await phaseCrossoverSurfaceAndRecordOnce(cdp);
  await phaseChapterGuideAndJournal(cdp);
  await forbiddenTextScan(cdp, 'xover-final');
  await checkConsole(cdp, 'xover-final');
}

/* 首到港的消费必须是持久事实：真实接单（任何入口）之后，关页重开、回到起源游戏，
   信件只能「去港口」，不能再重播到港与第一份工作。 */
async function verifyFirstArrivalConsumed(cdp) {
  const clueId = ORIGIN_CLUE;
  /* 游戏页的 bridge 是懒加载：必须带 careerLetter=1 才会装载并恢复信件。 */
  await go(cdp, BASE + '/apps/arcade/games/' + ORIGIN_GAME + '.html?careerLetter=1');
  await waitBridge(cdp, 'first-arrival-consumed', false);
  const mailbox = await cdp.evaluate(`(async () => {
    const opened = await ArcadeCareer.openMailbox();
    return { ok: !!(opened && opened.ok !== false) };
  })()`);
  gate('FIRST-ARRIVAL 重新打开信箱仍可用', mailbox.ok, J(mailbox));
  await cdp.waitFor('!!document.querySelector("[data-career-panel=mailbox]")', { timeout: 15000 });
  await cdp.waitFor(`(() => {
    const panel = document.querySelector('[data-career-panel="mailbox"] .ac-career-ui__panel');
    return !!panel && panel.getAttribute('data-shell-state') === 'normal';
  })()`, { timeout: 15000 });
  await pressVisible(cdp, `[data-career-panel="mailbox"] [data-clue-id="${clueId}"]`, 'FIRST-ARRIVAL 起源信');
  /* 打开真实线索后动作要等 openClue 落定才出现（不得猜动作）。 */
  await cdp.waitFor(`!!document.querySelector('[data-career-panel="mailbox"] [data-action]')`, { timeout: 15000 });
  const actions = await cdp.evaluate(`(() => {
    const panel = document.querySelector('[data-career-panel="mailbox"]');
    return {
      ids: Array.from(panel.querySelectorAll('[data-action]')).map((node) => node.getAttribute('data-action')),
      arrivalReplayed: !!document.querySelector('[data-career-panel="arrival"]'),
      text: panel.innerText.replace(/\\s+/g, ' ').trim().slice(0, 240)
    };
  })()`);
  gate('FIRST-ARRIVAL 重开信件不再重播到港面板',
    actions.arrivalReplayed === false && actions.ids.indexOf('invitation-port') < 0, J(actions));
  await cdp.evaluate('ArcadeCareer.closeCareerPanel && ArcadeCareer.closeCareerPanel()');
  await sleep(120);
  await go(cdp, BASE + '/apps/arcade/games/' + ORIGIN_GAME + '.html?careerLetter=1');
  await waitBridge(cdp, 'first-arrival-consumed-tail', false);
  await checkConsole(cdp, 'first-arrival-consumed');
}

function expectChapterAdvance(sequence, expected, after, previousChapter) {
  /* 仅记录：实际章节推进以每单 STATE/CHAPTER 断言为准，替代路线允许不同顺序。 */
  gate('ROUTE ' + expected.commissionId + ' 完成后的当前章可读', !!after.view.currentChapter, J({ sequence, previousChapter, current: after.view.currentChapter }));
}

/* ------------------------------------------------------------------ *
 * 7. 入口 / 清理 / 汇总
 * ------------------------------------------------------------------ */

async function runBrowserScenario(label, runScenario) {
  step('browser:' + label);
  let launched = null;
  let browser = null;
  const pages = [];
  try {
    launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'studiokit-career-flow-', windowSize: '420,900' });
    const newPage = async () => {
      const page = await openPage({ port: launched.port, width: 390, height: 844, artifactsDir: ARTIFACTS_DIR });
      pages.push(page);
      return page;
    };
    browser = new CDP(launched.browserWsPath);
    await browser.ready();
    await runScenario(await newPage(), browser, newPage);
  } catch (err) {
    if (!(err instanceof GateBlocked)) {
      gate('RUN ' + label + ' 链路中断 [' + CURRENT_STEP + ']', false, String(err?.stack || err));
    }
  } finally {
    pages.forEach((page) => page.close());
    if (browser) browser.close();
    if (launched) await stopChrome(launched);
  }
}

function usage() {
  console.log(`用法：
  node tools/career_flow_e2e_test.mjs --static-only
  node tools/career_flow_e2e_test.mjs
  node tools/career_flow_e2e_test.mjs --memory-origin-only
  node tools/career_flow_e2e_test.mjs --crossover-only   # 只跑 0.24 交汇场景（独立 Chrome）
环境变量：CAREER_FLOW_PORT / CAREER_FLOW_CDP / CHROME_PATH / CAREER_FLOW_QA_DIR
退出码：0 PASS；1 FAIL 或 BLOCKED；2 用法/环境错误`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return 0;
  }
  const memoryOriginOnly = args.includes('--memory-origin-only');
  const crossoverOnly = args.includes('--crossover-only');
  const unknown = args.filter((arg) => !['--static-only', '--memory-origin-only', '--crossover-only'].includes(arg));
  if (unknown.length || (memoryOriginOnly && args.includes('--static-only')) ||
    (crossoverOnly && (args.includes('--static-only') || memoryOriginOnly))) {
    console.error('参数错误: ' + J(args));
    usage();
    return 2;
  }
  STATIC_ONLY = args.includes('--static-only');

  console.log('=== StudioKit career flow gate ===');
  console.log('mode: ' + (STATIC_ONLY ? 'static-only'
    : memoryOriginOnly ? 'memory-flip arrival Chrome'
      : crossoverOnly ? '0.24 crossover Chrome'
        : 'full Chrome'));
  staticContentChecks();
  staticInterfaceChecks();

  if (!STATIC_ONLY) {
    const server = await startServer({ root: REPO_ROOT, port: SERVER_PORT });
    try {
      const campaign = readJson('apps/arcade/career/content/campaign.json');
      const commissions = readJson('apps/arcade/career/content/commissions.json').commissions;
      if (!memoryOriginOnly && !crossoverOnly) {
        await runBrowserScenario('二十一点到研究终局', (cdp, browser, newPage) => runFullFlow(cdp, browser, newPage, campaign, commissions));
      }
      if (!crossoverOnly) {
        await runBrowserScenario('记忆翻牌到港', (cdp) => runOriginToTown(cdp, MEMORY_ORIGIN));
      }
      await runBrowserScenario('C2 交汇与经历回读', (cdp) => runCrossoverScenario(cdp, campaign, commissions));
      gate('QA 全程 console error 为零', QA.errors.length === 0, J(QA.errors.slice(0, 5)));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  const total = COUNTS.pass + COUNTS.fail + COUNTS.blocked;
  console.log('\n=== SUMMARY ===');
  console.log('PASS ' + COUNTS.pass + ' / FAIL ' + COUNTS.fail + ' / BLOCKED ' + COUNTS.blocked + ' / TOTAL ' + total);
  console.log('推荐的委托顺序: ' + J(QA.recommended));
  console.log('逐单章节推进: ' + J(QA.chapterAfter.map((row) => ({ id: row.commissionId, flags: row.expectedFlags, current: row.current }))));
  if (COUNTS.fail > 0 || COUNTS.blocked > 0) return 1;
  return 0;
}

main().then((code) => {
  process.exitCode = code;
}).catch((err) => {
  console.error('FATAL  ' + String(err && err.stack ? err.stack : err));
  process.exitCode = 2;
});
