#!/usr/bin/env node
/**
 * Arcade 0.24 T21 主线替代叙事 / 终局前置解释门禁（纯 Node、零依赖）
 *
 * 运行：node tools/career_world_route_narrative_test.mjs
 * 退出码：0 = 全 PASS；1 = 有 FAIL；2 = 装配失败（内容/模块缺失）。
 *
 * 覆盖（只做数据级验证，不启动浏览器、不写仓库、不重复重型 E2E）：
 * - route-planner.chapterAlternatives：16 起源 × 5 段的替代指引、机制/receipt/锚点
 *   都回到真实内容；每段至少 1 条不依赖特定职业的替代说明；
 *   requiresSpecificProfession 恒 false（直接对 T20 冻结 schema 断言）；
 * - catalog.worldNarrative（T22 纯 resolver 输出形状）：可用节点覆盖内置文案；
 *   不可用 / 错章节 / 错机制 / 泄漏职业或内部 id 的节点一律忽略；缺失时与 0.23
 *   完全同形（guide / plan / worldWorkPath / explain 逐字节一致）；
 * - campaign-core：章节入口、每条路线、三个终局都有真实前置的文字解释，解释里
 *   的 token 与内容 requires 一一对应、met 与真实 gate 一致；不新增 reason code、
 *   不改 gate 判定、不改奖励；
 * - world-work.json：id 列表不变、文案为旧港通用活计、无职业名 / 游戏名 / 内部 id；
 * - 经济闭环：指引不含经济字段；plan/worldWorkPath 经济面与 0.23 一致。
 *
 * 复用：真实 16 起源 / 16 职业 / 96 委托 / 5 个世界通用工作 / campaign.json 夹具，
 * 装配方式与 tools/career_route_planner_test.mjs、tools/career_world_work_test.mjs
 * 保持一致（同一 configure 载荷），不新增内容、不改任何玩法数值。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

if (process.argv.slice(2).length > 0) {
  console.error('usage: node tools/career_world_route_narrative_test.mjs（不接受参数）');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CAREER = path.join(ROOT, 'apps', 'arcade', 'career');
const CONTENT = path.join(CAREER, 'content');

/* ---------------------------------------------------------------- 断言/工具 */

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? '' : detail === undefined ? '' : String(detail) });
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'expected ' + e + ' got ' + a);
}
function checkEq(name, actual, expected) {
  check(name, actual === expected, 'expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual));
}
function sorted(list) {
  return Array.from(new Set(list)).sort();
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function walkStrings(value, visit, prefix) {
  const at = prefix || '';
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, visit, at + '[' + index + ']'));
    return;
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach((key) => walkStrings(value[key], visit, at ? at + '.' + key : key));
    return;
  }
  if (typeof value === 'string') visit(value, at);
}
function collectRequirementTokens(req, sink) {
  const out = sink || { flags: [], commissions: [], evidence: [] };
  if (!req || typeof req !== 'object') return out;
  ['allFlags', 'anyFlags', 'anyChaosFlags'].forEach((key) => {
    (Array.isArray(req[key]) ? req[key] : []).forEach((token) => out.flags.push(token));
  });
  (Array.isArray(req.anyCommissions) ? req.anyCommissions : []).forEach((token) => out.commissions.push(token));
  ['evidenceAll', 'evidenceAny'].forEach((key) => {
    (Array.isArray(req[key]) ? req[key] : []).forEach((token) => out.evidence.push(token));
  });
  ['all', 'any'].forEach((key) => {
    (Array.isArray(req[key]) ? req[key] : []).forEach((child) => collectRequirementTokens(child, out));
  });
  return out;
}
function uniqueTokens(tokens) {
  return {
    flags: sorted(tokens.flags),
    commissions: sorted(tokens.commissions),
    evidence: sorted(tokens.evidence),
  };
}
function hanCount(text) {
  return (String(text).match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
}

/* ---------------------------------------------------------------- 装配 */

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(CONTENT, name), 'utf8'));

let SCHEMA;
let COMMISSIONS;
let ITEMS;
let CHAPTER;
let REGISTRY;
let CAMPAIGN;
let WORLD;
let NPC;
let SIDE;
let CHAPTER_FILES;
let materials;
let storyEvidence;
let routePlanner;
let campaignCore;

try {
  SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'career_world_narrative_schema.json'), 'utf8'));
  COMMISSIONS = readJson('commissions.json');
  ITEMS = readJson('items.json');
  CHAPTER = readJson('chapter-01.json');
  REGISTRY = readJson('registry.json');
  CAMPAIGN = readJson('campaign.json');
  WORLD = readJson('world-work.json');
  NPC = readJson('npc.json');
  SIDE = readJson('side-stories.json');
  CHAPTER_FILES = [0, 1, 2, 3, 4, 5].map((index) => readJson('chapter-0' + index + '.json'));
  materials = require(path.join(CAREER, 'materials.js'));
  storyEvidence = require(path.join(CAREER, 'story-evidence.js'));
  routePlanner = require(path.join(CAREER, 'route-planner.js'));
  campaignCore = require(path.join(CAREER, 'campaign-core.js'));
} catch (err) {
  console.error('FATAL 装配失败：' + (err && err.message ? err.message : String(err)));
  process.exit(2);
}

const REAL = COMMISSIONS.commissions;
const BY_ID = new Map(REAL.map((row) => [row.commissionId, row]));
const REAL_PROFESSION_IDS = sorted(REGISTRY.professions.map((row) => row.professionId));
const REAL_PROFESSION_NAMES = sorted(REGISTRY.professions.map((row) => row.displayName).filter(Boolean));
const REAL_GAME_IDS = sorted(REGISTRY.games.map((row) => row.gameId));
const REAL_GAME_NAMES = sorted(REGISTRY.games.map((row) => row.displayName).filter(Boolean));
const ORIGINS = CHAPTER.origins.map((origin) => ({ gameId: origin.gameId, professionId: origin.professionId }));
const EVIDENCE_TOKENS = sorted(REAL.flatMap((row) => ((row.reward && row.reward.evidence) || []).slice()));
const WORLD_IDS = WORLD.commissionIds.slice();
const WORLD_ENTRY_BY_ID = new Map(WORLD.entries.map((entry) => [entry.commissionId, entry]));
const CHAPTER_FLAG_EXPECTED = {
  C0: 'C0.port_seen',
  C1: 'C1.signal_fragment',
  C2: 'C2.research_complete',
  C3: 'C3.truth_found',
  C4: 'C4.city_power_restored',
  C5: 'C5.star_tower_resolved',
};
const ROUTE_REASON_KEYS = [
  'notConfigured', 'inputMissing', 'contentMissing', 'contentInvalid', 'unknownOrigin',
  'unknownProfession', 'badPlan', 'exception', 'noCommissions', 'chainCycle',
];
const CAMPAIGN_REASON_KEYS = [
  'notConfigured', 'badInput', 'badCareerId', 'dbUnavailable', 'dbReadFailed',
  'dbWriteFailed', 'contentInvalid', 'unknownApproach', 'exception',
];
const OFFERS = [
  {
    offerId: 'alt.courier',
    title: '港务处的跑腿单',
    summary: '替港务处跑一趟，把一只信号匣从码头取回来。',
    issuer: '旧港港务处',
    cost: { credits: 120 },
    flags: ['C1.signal'],
    evidence: ['E-C1-courier'],
  },
  {
    offerId: 'alt.records',
    title: '档案室的旧航路',
    summary: '回旧港档案室，把那份航路记录抄出来。',
    issuer: '旧港档案室',
    cost: { credits: 90, items: { alloy: 1 } },
    flags: ['C1.records'],
    evidence: ['E-C1-records'],
  },
];
const PLAYER_TEXT_FORBIDDEN = [
  'not-discovered', 'not-read', 'not-accepted', 'paused', 'wrong-surface', 'world-locked',
  'story-locked', 'not-available', 'historical-only', 'archived', 'unknown-profession',
  'unknown-commission', 'future-version',
].concat(SCHEMA.forbidden.routeGuideKeywords || []).concat(['3/16', '60%']);

materials.configure({ items: ITEMS, commissions: COMMISSIONS });

function newEvidence() {
  const created = storyEvidence.createStoryEvidence ? storyEvidence.createStoryEvidence({}) : storyEvidence;
  const config = created.configure({ commissions: COMMISSIONS, items: ITEMS, chapter: CHAPTER });
  if (!config || config.ok !== true) {
    console.error('FATAL story-evidence configure 失败：' + JSON.stringify((config && config.errors) || []));
    process.exit(2);
  }
  return created;
}

const evidence = newEvidence();

function makePlanner(extra) {
  const planner = routePlanner.create();
  const config = planner.configure(
    Object.assign(
      {
        commissions: COMMISSIONS,
        items: ITEMS,
        chapter: CHAPTER,
        registry: REGISTRY,
        materials,
        evidence,
        alternatives: { offers: OFFERS },
        worldWork: WORLD,
        campaign: CAMPAIGN,
      },
      extra || {}
    )
  );
  return { planner, config };
}

function makeCampaign(extra) {
  const campaign = campaignCore.createCampaign({});
  const config = campaign.configure(
    Object.assign(
      {
        campaign: CAMPAIGN,
        chapters: CHAPTER_FILES,
        npc: NPC,
        sideStories: SIDE,
        commissions: REAL,
        evidence: REGISTRY,
        worldWork: WORLD,
      },
      extra || {}
    )
  );
  return { campaign, config };
}

const made = makePlanner();
const planner = made.planner;
const campaignMade = makeCampaign();
const campaign = campaignMade.campaign;

/* 玩家文本卫生：未发现/未接受职业一律不点名，内部 id / 证据 token / 章节码不进文本。 */
function playerTextIssues(label, text) {
  const issues = [];
  if (typeof text !== 'string' || !text.trim()) {
    issues.push(label + ':empty');
    return issues;
  }
  REAL_PROFESSION_IDS.forEach((id) => {
    if (text.indexOf(id) >= 0) issues.push(label + ':profession-id');
  });
  REAL_PROFESSION_NAMES.forEach((name) => {
    if (name && text.indexOf(name) >= 0) issues.push(label + ':profession-name');
  });
  REAL_GAME_IDS.forEach((id) => {
    if (id.length > 3 && text.indexOf(id) >= 0) issues.push(label + ':game-id');
  });
  REAL_GAME_NAMES.forEach((name) => {
    if (name && name.length > 2 && text.indexOf(name) >= 0) issues.push(label + ':game-name');
  });
  REAL.forEach((row) => {
    if (text.indexOf(row.commissionId) >= 0) issues.push(label + ':commission-id');
  });
  EVIDENCE_TOKENS.forEach((token) => {
    if (text.indexOf(token) >= 0) issues.push(label + ':evidence-token');
  });
  if (/(^|[^A-Za-z0-9])(E|MAP|BP|DEC)-[A-Za-z0-9]/.test(text)) issues.push(label + ':evidence-prefix');
  if (/C[0-5]\.[a-z0-9]/.test(text)) issues.push(label + ':chapter-code');
  if (/\.T[1-6](?![0-9])/.test(text)) issues.push(label + ':tier-suffix');
  if (/\bP-0[0-9]\b|\bE-[0-9]+\b/.test(text)) issues.push(label + ':internal-token');
  PLAYER_TEXT_FORBIDDEN.forEach((word) => {
    if (word && text.indexOf(word) >= 0) issues.push(label + ':forbidden:' + word);
  });
  if (/[0-9]+\s*\/\s*[0-9]+/.test(text)) issues.push(label + ':ratio');
  if (/[0-9]+\s*%/.test(text)) issues.push(label + ':percent');
  return sorted(issues);
}

function guideTextIssues(guide) {
  const issues = [];
  (guide.chapters || []).forEach((chapter) => {
    issues.push.apply(issues, playerTextIssues(chapter.chapterId + '.title', chapter.title || ''));
    issues.push.apply(issues, playerTextIssues(chapter.chapterId + '.requirement', chapter.requirement.text || ''));
    (chapter.alternatives || []).forEach((alt, index) => {
      const tag = chapter.chapterId + '.alt[' + index + '].' + alt.mechanism;
      issues.push.apply(issues, playerTextIssues(tag + '.label', alt.label));
      ['offer', 'progress', 'next'].forEach((key) => {
        if (alt.source === 'world-narrative' || key !== 'receipt') {
          issues.push.apply(issues, playerTextIssues(tag + '.' + key, alt.texts[key]));
        }
      });
    });
    if (chapter.finale) {
      issues.push.apply(issues, playerTextIssues(chapter.chapterId + '.finale', chapter.finale.text));
      (chapter.finale.approaches || []).forEach((approach) => {
        if (approach.title) issues.push.apply(issues, playerTextIssues(chapter.chapterId + '.approach.title', approach.title));
        if (approach.summary) issues.push.apply(issues, playerTextIssues(chapter.chapterId + '.approach.summary', approach.summary));
      });
    }
  });
  return issues;
}

/* world-work.json 的通用文案卫生：无职业名 / 游戏名 / 内部 id / 隐藏来源。 */
function worldWorkCopyIssues() {
  const issues = [];
  /* 只扫玩家可见文案；commissionId 是结构化字段（不是文案），不参与文案扫描。 */
  const copyText = WORLD.entries.map((entry) => entry.title + ' ' + entry.summary).join(' ');
  REAL_PROFESSION_IDS.forEach((id) => {
    if (copyText.indexOf(id) >= 0) issues.push('profession-id');
  });
  REAL_PROFESSION_NAMES.forEach((name) => {
    if (name && copyText.indexOf(name) >= 0) issues.push('profession-name');
  });
  REAL_GAME_IDS.forEach((id) => {
    if (id.length > 3 && copyText.indexOf(id) >= 0) issues.push('game-id');
  });
  REAL_GAME_NAMES.forEach((name) => {
    if (name && name.length > 2 && copyText.indexOf(name) >= 0) issues.push('game-name');
  });
  if (copyText.indexOf('P-07') >= 0 || copyText.indexOf('E-7') >= 0) issues.push('story-token');
  if (/C[0-5]\.[a-z0-9]/.test(copyText)) issues.push('chapter-code');
  if (/(^|[^A-Za-z0-9])(E|MAP|BP|DEC)-[A-Za-z0-9]/.test(copyText)) issues.push('evidence-token');
  if (/\.T[1-6](?![0-9])/.test(copyText)) issues.push('tier-suffix');
  if (copyText.indexOf('信用点') >= 0 || copyText.indexOf('奖励') >= 0 || copyText.indexOf('报酬') >= 0) issues.push('reward-word');
  WORLD.entries.forEach((entry) => {
    const keys = Object.keys(entry).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['commissionId', 'summary', 'title'])) issues.push('entry-keys:' + entry.commissionId);
    if (hanCount(entry.title) < 2 || hanCount(entry.title) > 12) issues.push('title-length:' + entry.commissionId);
    if (hanCount(entry.summary) < 8 || hanCount(entry.summary) > 60) issues.push('summary-length:' + entry.commissionId);
  });
  return sorted(issues);
}

/* T22 resolver 输出形状的测试夹具（与 schema.resolverOutput 同形，不是内容文件）。 */
function resolverNode(chapterId, mechanism, options) {
  const extra = options || {};
  const texts = Object.assign(
    {
      offer: '港里这几张纸不看谁来接，做完把回执交回结算窗，这一段就记上了。',
      progress: '还有人没把纸交回来，港口先等这一批。',
      receipt: '这一笔已经结了，收据夹在档里。',
      next: '下一步照旧从告示板走。',
    },
    extra.texts || {}
  );
  return {
    narrativeNodeId: 'altn.' + chapterId + '.' + mechanism + '.probe',
    mechanism,
    anchor: { kind: SCHEMA.constants.mechanismAnchorKind[mechanism], refs: ['probe'] },
    npcRef: { kind: 'origin-letter', gameId: 'memory-flip' },
    signatureFrom: 'origin-letter',
    available: extra.available !== false,
    reason: extra.available === false ? 'not-available' : null,
    texts,
    receiptSource: SCHEMA.constants.mechanismReceiptSource[mechanism],
  };
}

function resolverOutput(chapterId, nodes, crossovers) {
  return {
    schemaVersion: 1,
    chapterId,
    nodes,
    crossovers: crossovers || [],
  };
}

function fullNarrativeFixture() {
  const outputs = [];
  outputs.push(resolverOutput('C1', [
    resolverNode('C1', 'world-work'),
    resolverNode('C1', 'errand'),
    resolverNode('C1', 'rental'),
  ]));
  ['C2', 'C3', 'C4', 'C5'].forEach((chapterId) => {
    outputs.push(resolverOutput(chapterId, [
      resolverNode(chapterId, 'world-work'),
      resolverNode(chapterId, 'evidence-pair'),
    ]));
  });
  return outputs;
}

/* ---------------------------------------------------------------- A 装配/内容 */

{
  check('A01 route-planner 真实内容 configure ok', made.config.ok === true, JSON.stringify(made.config.errors || []).slice(0, 300));
  checkEq('A02 configure 读到 5 段主线', made.config.campaignCount, 5);
  check('A03 campaign-core 真实内容 configure ok', campaignMade.config.ok === true, JSON.stringify(campaignMade.config.errors || []).slice(0, 300));

  eq('A04 world-work commissionIds 精确不变', WORLD.commissionIds, [
    'star-raid.T1',
    'star-raid.T2',
    'star-raid.T3',
    'pendulum-tower.T1',
    'pendulum-tower.T2',
  ]);
  eq('A05 world-work entries 与 id 一一对应', sorted(WORLD.entries.map((entry) => entry.commissionId)), sorted(WORLD_IDS));
  check('A06 world-work 只有文案字段（无奖励/价格/数量）', WORLD.entries.every((entry) => {
    const keys = Object.keys(entry).sort();
    return JSON.stringify(keys) === JSON.stringify(['commissionId', 'summary', 'title']);
  }));
  const copyIssues = worldWorkCopyIssues();
  check('A07 world-work 文案卫生（无职业/游戏/内部 id/隐藏来源）', copyIssues.length === 0, copyIssues.join(','));
  check('A08 world-work 文案像旧港的活', WORLD.entries.every((entry) => {
    const portWords = ['港', '码头', '仓', '堤', '结算', '工', '班', '船', '货', '号灯', '值班'];
    return portWords.some((word) => entry.summary.indexOf(word) >= 0);
  }), JSON.stringify(WORLD.entries));
  check('A09 world-work 经济面零改动（id 与委托对应仍真实）', WORLD_IDS.every((id) => {
    const row = BY_ID.get(id);
    return !!row && !!row.objective && !!row.objective.kind;
  }));
}

/* ---------------------------------------------------------------- B 16 起源可达 */

{
  const pathFailures = [];
  const guideFailures = [];
  const requirementMismatch = [];
  const c1Flags = CAMPAIGN.chapters.find((chapter) => chapter.chapterId === 'C1');
  const chapterRouteFlags = new Map();
  CAMPAIGN.chapters.forEach((chapter) => {
    const flags = [];
    (chapter.routes || []).forEach((route) => {
      (route.rewardFlags || []).forEach((flag) => {
        if (flags.indexOf(flag) < 0) flags.push(flag);
      });
    });
    chapterRouteFlags.set(chapter.chapterId, sorted(flags));
  });
  const finaleEntryFlags = sorted(Array.from(new Set((CAMPAIGN.endings || []).flatMap((ending) => {
    return ((ending.entry && ending.entry.allFlags) || []).slice();
  }))));

  ORIGINS.forEach((origin) => {
    const label = origin.gameId + '/' + origin.professionId;
    const path = planner.worldWorkPath({
      originGameId: origin.gameId,
      acceptedProfessionId: origin.professionId,
      wallet: { credits: 80, items: {} },
      quests: [],
      claims: [],
      flags: ['C0.port_seen'],
    });
    if (!path.ok || path.complete !== true) pathFailures.push(label + ':' + (path.reason || 'incomplete'));
    ['C1.signal_fragment', 'C2.research_complete', 'C3.truth_found', 'C4.city_power_restored'].forEach((flag) => {
      if (path.flagsAfter.indexOf(flag) < 0) pathFailures.push(label + ':' + flag);
    });

    const guide = planner.chapterAlternatives({
      originGameId: origin.gameId,
      acceptedProfessionId: origin.professionId,
      flags: ['C0.port_seen'],
      wallet: { credits: 0, items: {} },
      quests: [],
      claims: [],
    });
    if (!guide || guide.ok !== true) {
      guideFailures.push(label + ':guide');
      return;
    }
    if (guide.chapters.length !== 5) guideFailures.push(label + ':chapter-count');
    guide.chapters.forEach((chapter) => {
      const generic = (chapter.alternatives || []).filter((alt) => alt.requiresSpecificProfession === false);
      if (!generic.length) guideFailures.push(label + ':' + chapter.chapterId + ':no-generic');
      if (!chapter.alternatives.length) guideFailures.push(label + ':' + chapter.chapterId + ':empty');
      const expected = chapter.chapterId === 'C5' ? finaleEntryFlags : (chapterRouteFlags.get(chapter.chapterId) || []);
      if (JSON.stringify(sorted(chapter.requirement.flags)) !== JSON.stringify(sorted(expected))) {
        requirementMismatch.push(label + ':' + chapter.chapterId + ':' + chapter.requirement.flags.join('+'));
      }
    });
  });

  check('B01 16 起源世界通用路线都完整（C1–C4 可达）', pathFailures.length === 0, pathFailures.slice(0, 6).join(','));
  check('B02 16 起源 × 5 段都有替代指引与通用替代', guideFailures.length === 0, guideFailures.slice(0, 6).join(','));
  check('B03 章节需求旗标与 campaign.json 真实内容一致', requirementMismatch.length === 0, requirementMismatch.slice(0, 6).join(','));
  check('B04 C1 数据夹具仍有 3 条替代路线', (c1Flags.routes || []).length >= 3);

  const report = campaign.validate({ storyEvidence: evidence });
  check('B05 campaign.validate ok', report.ok === true, JSON.stringify(report.errors || []).slice(0, 300));
  check('B06 16 起源 × 3 终局数据级可达（48/48）', !!report.worldWorkPathProof
    && report.worldWorkPathProof.total === 48
    && report.worldWorkPathProof.passed === 48, JSON.stringify(report.worldWorkPathProof || {}).slice(0, 300));
}

/* ---------------------------------------------------------------- C 逐章替代说明 */

{
  const guide = planner.chapterAlternatives({
    originGameId: 'memory-flip',
    acceptedProfessionId: 'research.archivist',
    flags: ['C0.port_seen'],
    wallet: { credits: 0, items: {} },
    quests: [],
    claims: [],
  });

  eq('C01 章节顺序固定 C1–C5', guide.chapters.map((chapter) => chapter.chapterId), ['C1', 'C2', 'C3', 'C4', 'C5']);
  eq('C02 机制枚举与冻结 schema 一致', routePlanner.MECHANISMS, SCHEMA.constants.mechanisms);
  eq('C03 receipt 映射与冻结 schema 一致', routePlanner.MECHANISM_RECEIPT_SOURCE, SCHEMA.constants.mechanismReceiptSource);
  eq('C04 章节里程碑旗标为冻结值', routePlanner.CHAPTER_FLAGS, {
    C1: 'C1.signal_fragment',
    C2: 'C2.research_complete',
    C3: 'C3.truth_found',
    C4: 'C4.city_power_restored',
    C5: 'C5.star_tower_resolved',
  });

  const altIssues = [];
  guide.chapters.forEach((chapter) => {
    (chapter.alternatives || []).forEach((alt) => {
      const tag = chapter.chapterId + '/' + alt.mechanism;
      if (SCHEMA.constants.mechanisms.indexOf(alt.mechanism) < 0) altIssues.push(tag + ':mechanism');
      if (alt.receiptSource !== SCHEMA.constants.mechanismReceiptSource[alt.mechanism]) altIssues.push(tag + ':receipt');
      if (!alt.anchor || alt.anchor.kind !== SCHEMA.constants.mechanismAnchorKind[alt.mechanism]) altIssues.push(tag + ':anchor-kind');
      if (!Array.isArray(alt.anchor.refs) || !alt.anchor.refs.length) altIssues.push(tag + ':anchor-refs');
      if (alt.requiresSpecificProfession !== false) altIssues.push(tag + ':profession-gate');
      if (alt.requiresAcceptedProfession !== true) altIssues.push(tag + ':accepted-gate');
      if (Object.prototype.hasOwnProperty.call(alt, 'reason')) altIssues.push(tag + ':reason-field');
      if (alt.mechanism === 'world-work') {
        if (!alt.anchor.refs.every((id) => WORLD_IDS.indexOf(id) >= 0)) altIssues.push(tag + ':world-anchor');
      } else if (alt.mechanism === 'errand') {
        if (!alt.anchor.refs.every((id) => OFFERS.some((offer) => offer.offerId === id))) altIssues.push(tag + ':offer-anchor');
      } else if (alt.mechanism === 'rental') {
        if (alt.anchor.refs.length !== 1 || alt.anchor.refs[0] !== 'old-wing') altIssues.push(tag + ':ship-anchor');
      } else if (alt.mechanism === 'evidence-pair') {
        if (!alt.anchor.refs.every((token) => EVIDENCE_TOKENS.indexOf(token) >= 0)) altIssues.push(tag + ':token-anchor');
      }
    });
  });
  check('C05 机制/receipt/锚点都回到真实内容', altIssues.length === 0, altIssues.slice(0, 8).join(','));

  const mechanismMap = {};
  guide.chapters.forEach((chapter) => {
    mechanismMap[chapter.chapterId] = (chapter.alternatives || []).map((alt) => alt.mechanism);
  });
  eq('C06 C1 三条通用替代（世界工作/代办/租机）', mechanismMap.C1, ['world-work', 'errand', 'rental']);
  ['C2', 'C3', 'C4', 'C5'].forEach((chapterId) => {
    eq('C07 ' + chapterId + ' 有世界工作与记录组合替代', mechanismMap[chapterId], ['world-work', 'evidence-pair']);
  });

  const textIssues = guideTextIssues(guide);
  check('C08 公开说明文案卫生（无职业/内部 id/攻略词/百分比）', textIssues.length === 0, textIssues.slice(0, 8).join(','));

  const zero = planner.chapterAlternatives({ flags: ['C0.port_seen'], wallet: { credits: 0, items: {} } });
  const availability = [];
  function altOf(result, chapterId, mechanism) {
    const chapter = result.chapters.find((item) => item.chapterId === chapterId);
    return (chapter.alternatives || []).filter((alt) => alt.mechanism === mechanism)[0] || null;
  }
  if (!altOf(zero, 'C1', 'world-work') || altOf(zero, 'C1', 'world-work').available !== true) availability.push('C1.world-work');
  if (!altOf(zero, 'C1', 'rental') || altOf(zero, 'C1', 'rental').available !== true) availability.push('C1.rental');
  if (!altOf(zero, 'C1', 'errand') || altOf(zero, 'C1', 'errand').available !== false) availability.push('C1.errand-unaffordable');
  ['C2', 'C3', 'C4', 'C5'].forEach((chapterId) => {
    ['world-work', 'evidence-pair'].forEach((mechanism) => {
      const alt = altOf(zero, chapterId, mechanism);
      if (!alt || alt.available !== true) availability.push(chapterId + '.' + mechanism);
    });
  });
  check('C09 零旗标下替代可用性诚实（代办需先凑工钱）', availability.length === 0, availability.join(','));

  const richWallet = planner.chapterAlternatives({ flags: ['C0.port_seen'], wallet: { credits: 400, items: { alloy: 2 } } });
  check('C10 工钱够时代办可用', altOf(richWallet, 'C1', 'errand').available === true);

  const done = planner.chapterAlternatives({
    flags: ['C0.port_seen', 'C1.work_done'],
    wallet: { credits: 0, items: {} },
  });
  const c1Done = done.chapters.find((chapter) => chapter.chapterId === 'C1');
  check('C11 C1 完成旗标经真实信号链推导（前置 met）', c1Done.requirement.met === true);
  check('C12 前置已满足后替代不再标可用', c1Done.alternatives.every((alt) => alt.available === false));

  const again = planner.chapterAlternatives({ flags: ['C0.port_seen'], wallet: { credits: 0, items: {} } });
  eq('C13 指引确定性（同输入同输出）', again, zero);

  const frozenInput = { flags: ['C0.port_seen'], wallet: { credits: 0, items: {} }, catalog: { worldNarrative: fullNarrativeFixture() } };
  const before = JSON.stringify(frozenInput);
  planner.chapterAlternatives(frozenInput);
  check('C14 指引不修改输入', JSON.stringify(frozenInput) === before);

  const serialized = JSON.stringify(zero);
  check('C15 指引不含经济/奖励字段', serialized.indexOf('"credits"') < 0
    && serialized.indexOf('"reward"') < 0
    && serialized.indexOf('"price"') < 0, 'guide carries economy field');

  check('C16 每段都有不依赖特定职业的替代说明', zero.chapters.every((chapter) => {
    return (chapter.alternatives || []).some((alt) => alt.requiresSpecificProfession === false
      && alt.requiresAcceptedProfession === true);
  }));
}

/* ---------------------------------------------------------------- D worldNarrative 集成 */

{
  const base = { flags: ['C0.port_seen'], wallet: { credits: 0, items: {} }, quests: [], claims: [] };
  const without = planner.chapterAlternatives(base);
  const emptyCatalog = planner.chapterAlternatives(Object.assign({}, base, { catalog: {} }));
  eq('D01 缺 worldNarrative 与 0.23 完全同形', emptyCatalog, without);
  checkEq('D02 缺 worldNarrative 标记为 absent', without.worldNarrative, 'absent');

  const fixture = fullNarrativeFixture();
  const withNarrative = planner.chapterAlternatives(Object.assign({}, base, { catalog: { worldNarrative: fixture } }));
  checkEq('D03 注入 resolver 输出后标记 present', withNarrative.worldNarrative, 'present');
  checkEq('D04 节点计数来自 fixture', withNarrative.narrativeNodeCount, 11);

  const narrativeIssues = [];
  withNarrative.chapters.forEach((chapter) => {
    (chapter.alternatives || []).forEach((alt) => {
      if (alt.source !== 'world-narrative') narrativeIssues.push(chapter.chapterId + '/' + alt.mechanism + ':source');
      if (typeof alt.narrativeNodeId !== 'string' || !alt.narrativeNodeId) narrativeIssues.push(chapter.chapterId + '/' + alt.mechanism + ':node-id');
      if (alt.texts.offer.indexOf('港里这几张纸不看谁来接') < 0) narrativeIssues.push(chapter.chapterId + '/' + alt.mechanism + ':offer');
    });
  });
  check('D05 可用节点按机制覆盖内置文案', narrativeIssues.length === 0, narrativeIssues.slice(0, 8).join(','));

  /* 不可用节点 / 错章节 / 错机制 / 泄漏职业 / 内部 token 的节点都必须被忽略。 */
  const leakName = REAL_PROFESSION_NAMES[0];
  const leakToken = EVIDENCE_TOKENS[0] || 'E-probe-token';
  const cases = [
    {
      name: 'D06 不可用节点被忽略',
      marker: '',
      narrative: [resolverOutput('C2', [
        resolverNode('C2', 'world-work', { available: false }),
      ])],
      chapterId: 'C2',
      mechanism: 'world-work',
    },
    {
      name: 'D07 错章节节点被忽略',
      marker: '错章节',
      narrative: [resolverOutput('C3', [
        resolverNode('C3', 'world-work', { texts: { offer: '错章节的节点不该出现在第二章，港里不认。' } }),
      ])],
      chapterId: 'C2',
      mechanism: 'world-work',
    },
    {
      name: 'D08 错机制节点被忽略',
      marker: '错机制',
      narrative: [resolverOutput('C2', [
        resolverNode('C2', 'market-material', { texts: { offer: '错机制的节点不该顶替世界工作，港里不认。' } }),
      ])],
      chapterId: 'C2',
      mechanism: 'world-work',
    },
    {
      name: 'D09 泄漏职业的节点被忽略',
      marker: leakName,
      narrative: [resolverOutput('C2', [
        resolverNode('C2', 'world-work', { texts: { offer: '这一句写了' + leakName + '，不该进玩家文本。' } }),
      ])],
      chapterId: 'C2',
      mechanism: 'world-work',
    },
    {
      name: 'D10 含内部 token 的节点被忽略',
      marker: leakToken,
      narrative: [resolverOutput('C2', [
        resolverNode('C2', 'world-work', { texts: { offer: '按 ' + leakToken + ' 那份记录往下走，港里不认这种写法。' } }),
      ])],
      chapterId: 'C2',
      mechanism: 'world-work',
    },
    {
      name: 'D11 含章节码/tier 后缀的节点被忽略',
      marker: 'star-raid.T1',
      narrative: [resolverOutput('C2', [
        resolverNode('C2', 'world-work', { texts: { offer: '按 star-raid.T1 那张纸往下走，港里不认这种写法。' } }),
      ])],
      chapterId: 'C2',
      mechanism: 'world-work',
    },
  ];
  cases.forEach((entry) => {
    const result = planner.chapterAlternatives(Object.assign({}, base, { catalog: { worldNarrative: entry.narrative } }));
    const chapter = result.chapters.find((item) => item.chapterId === entry.chapterId);
    const alt = (chapter.alternatives || []).filter((item) => item.mechanism === entry.mechanism)[0];
    const text = alt && alt.texts ? alt.texts.offer : '';
    const ok = !!alt
      && alt.source === 'content'
      && !alt.narrativeNodeId
      && (!entry.marker || text.indexOf(entry.marker) < 0)
      && text.indexOf('.T1') < 0;
    check(entry.name, ok, JSON.stringify(alt && alt.texts).slice(0, 240));
  });

  /* crossovers 不进入本章节的替代说明。 */
  const crossoverOutput = [
    resolverOutput('C2', [resolverNode('C2', 'world-work')], [{
      eventId: 'crossover:research.archivist:research.lattice',
      pairId: 'crossover:research.archivist:research.lattice',
      npcRefs: [{ kind: 'character', characterId: 'E-7' }],
      texts: { invite: '交汇测试文本不会进入替代说明。', body: '交汇测试文本不会进入替代说明。', receipt: '交汇测试文本不会进入替代说明。', decline: '交汇测试文本不会进入替代说明。' },
      receiptSource: 'narrative-event',
      maxShowsPerCareer: 1,
    }]),
  ];
  const crossoverGuide = planner.chapterAlternatives(Object.assign({}, base, { catalog: { worldNarrative: crossoverOutput } }));
  check('D12 crossovers 不进入替代说明', JSON.stringify(crossoverGuide).indexOf('交汇测试文本') < 0);

  /* 坏形状输入不抛、按缺省处理。 */
  const badShapes = ['not-an-object', 42, [], { nodes: 'bad' }, { C1: { nodes: 'bad' } }];
  let badOk = true;
  badShapes.forEach((shape) => {
    try {
      const result = planner.chapterAlternatives(Object.assign({}, base, { catalog: { worldNarrative: shape } }));
      if (!result || result.ok !== true) badOk = false;
      if (result && result.worldNarrative !== 'absent') badOk = false;
    } catch (err) {
      badOk = false;
    }
  });
  check('D13 坏 worldNarrative 形状降级为缺省且不抛', badOk);

  eq('D14 注入叙事不改变 0.23 的 plan 输出', planner.plan({
    originGameId: 'memory-flip',
    professionId: 'research.archivist',
    wallet: { credits: 200, items: {} },
    quests: [],
    claims: [],
    flags: ['C0.port_seen'],
    includeWorldWork: true,
    catalog: { worldNarrative: fixture },
  }), planner.plan({
    originGameId: 'memory-flip',
    professionId: 'research.archivist',
    wallet: { credits: 200, items: {} },
    quests: [],
    claims: [],
    flags: ['C0.port_seen'],
    includeWorldWork: true,
  }));

  const pathArgs = {
    originGameId: 'memory-flip',
    acceptedProfessionId: 'research.archivist',
    wallet: { credits: 80, items: {} },
    quests: [],
    claims: [],
    flags: ['C0.port_seen'],
  };
  eq('D15 注入叙事不改变 0.23 的 worldWorkPath', planner.worldWorkPath(Object.assign({}, pathArgs, { catalog: { worldNarrative: fixture } })), planner.worldWorkPath(pathArgs));
  eq('D16 注入叙事不改变 explain 文案', planner.explain(planner.plan(Object.assign({}, pathArgs, { professionId: 'research.archivist', catalog: { worldNarrative: fixture } }))), planner.explain(planner.plan(Object.assign({}, pathArgs, { professionId: 'research.archivist' }))));

  const report = planner.validate();
  check('D17 route-planner validate 全过（含 narrative-guide 检查）', report.ok === true && report.checksPassed === report.checksTotal,
    JSON.stringify((report.checks || []).filter((item) => !item.ok)).slice(0, 300));
  check('D18 validate 含 narrative-guide 检查项', (report.checks || []).some((item) => item.id === 'narrative-guide'));
}

/* ---------------------------------------------------------------- E 前置解释与真实 gate */

{
  const emptyInput = { flags: [], evidence: [], cleared: [], wallet: { credits: 0, items: {} } };
  const richFlags = [
    'C0.port_seen', 'C1.signal_fragment', 'C1.work_done', 'C1.flight_done',
    'C2.research_complete', 'C3.truth_found', 'C4.city_power_restored',
  ];
  const richEvidence = EVIDENCE_TOKENS.slice(0, 6);
  const richCleared = REAL.slice(0, 6).map((row) => row.commissionId);
  const fixtures = [
    emptyInput,
    { flags: ['C0.port_seen'], evidence: [], cleared: [], wallet: { credits: 0, items: {} } },
    { flags: ['C0.port_seen', 'C1.signal_fragment'], evidence: EVIDENCE_TOKENS.slice(0, 2), cleared: richCleared.slice(0, 2), wallet: { credits: 120, items: { alloy: 1 } } },
    { flags: richFlags, evidence: richEvidence, cleared: richCleared, wallet: { credits: 400, items: {} } },
  ];

  const chapterStates = [];
  fixtures.forEach((fixture) => {
    const st = campaign.state(fixture);
    if (!st || st.ok !== true || st.chapters.length !== 6) {
      chapterStates.push('state-failed');
      return;
    }
    const ctx = campaign.contextFrom(fixture);
    st.chapters.forEach((chapter) => {
      const contentChapter = CAMPAIGN.chapters.find((item) => item.chapterId === chapter.chapterId);
      if (!chapter.prerequisite) {
        chapterStates.push(chapter.chapterId + ':missing');
        return;
      }
      if (chapter.prerequisite.met !== chapter.entryMet) chapterStates.push(chapter.chapterId + ':entry-met');
      const entryTokens = uniqueTokens(collectRequirementTokens(contentChapter.entry));
      const got = uniqueTokens(chapter.prerequisite.tokens);
      if (JSON.stringify(got) !== JSON.stringify(entryTokens)) chapterStates.push(chapter.chapterId + ':entry-tokens');
      if (!chapter.prerequisite.requirement || JSON.stringify(chapter.prerequisite.requirement) !== JSON.stringify(contentChapter.entry)) {
        chapterStates.push(chapter.chapterId + ':entry-requirement');
      }
      if (chapter.completion.flag !== CHAPTER_FLAG_EXPECTED[chapter.chapterId]) chapterStates.push(chapter.chapterId + ':completion-flag');
      if (chapter.completion.met !== (chapter.state === 'complete')) chapterStates.push(chapter.chapterId + ':completion-met');
      if (!chapter.completion.text || chapter.completion.text.length < 8) chapterStates.push(chapter.chapterId + ':completion-text');
      (chapter.routes || []).forEach((route) => {
        const tag = chapter.chapterId + '/' + route.routeId;
        if (!route.prerequisite) {
          chapterStates.push(tag + ':missing');
          return;
        }
        if (route.prerequisite.met !== route.met) chapterStates.push(tag + ':met');
        if (route.prerequisite.met !== campaign.routeRequirementsMet(route, fixture)) chapterStates.push(tag + ':gate');
        const contentRoute = chapter.chapterId === 'C5'
          ? { requires: (CAMPAIGN.endings.find((ending) => 'ending.' + ending.approach === route.routeId) || {}).entry }
          : { requires: (contentChapter.routes.find((item) => item.routeId === route.routeId) || {}).requires };
        if (contentRoute.requires) {
          const want = uniqueTokens(collectRequirementTokens(contentRoute.requires));
          const have = uniqueTokens(route.prerequisite.tokens);
          if (JSON.stringify(want) !== JSON.stringify(have)) chapterStates.push(tag + ':tokens');
          if (JSON.stringify(route.prerequisite.requirement) !== JSON.stringify(contentRoute.requires)) chapterStates.push(tag + ':requirement');
        }
        const walk = [];
        function visit(node) {
          if (!node) return;
          const gateValue = campaign.routeRequirementsMet(node.requirement, fixture);
          if (node.met !== gateValue) walk.push('met');
          if (node.kind === 'flags') {
            (node.items || []).forEach((item) => {
              const expect = ctx.flags.has(item.token);
              if (item.met !== expect) walk.push('flag-item');
              if (node.body.indexOf(item.text) < 0) walk.push('flag-text');
            });
          } else if (node.kind === 'commissions') {
            (node.items || []).forEach((item) => {
              if (item.met !== ctx.cleared.has(item.token)) walk.push('commission-item');
            });
          } else if (node.kind === 'evidence') {
            (node.items || []).forEach((item) => {
              if (item.met !== ctx.evidence.has(item.token)) walk.push('evidence-item');
              if (node.body.indexOf(item.text) < 0) walk.push('evidence-text');
            });
          } else if (node.kind === 'composite') {
            (node.groups || []).forEach(visit);
          }
          if (Object.prototype.hasOwnProperty.call(node, 'reason')) walk.push('reason-field');
        }
        visit(route.prerequisite);
        if (walk.length) chapterStates.push(tag + ':' + sorted(walk).join('|'));
      });
      (st.endings || []).forEach((ending) => {
        if (!ending.prerequisite) {
          chapterStates.push('ending/' + ending.approach + ':missing');
          return;
        }
        if (ending.prerequisite.met !== ending.entryMet) chapterStates.push('ending/' + ending.approach + ':met');
        const wantFlags = uniqueTokens(collectRequirementTokens((CAMPAIGN.endings.find((item) => item.approach === ending.approach) || {}).entry)).flags;
        if (JSON.stringify(ending.prerequisite.tokens.flags) !== JSON.stringify(wantFlags)) chapterStates.push('ending/' + ending.approach + ':tokens');
      });
    });
  });

  check('E01 章节/路线/终局前置解释齐备', chapterStates.length === 0, chapterStates.slice(0, 8).join(','));
  check('E02 前置 met 与真实 gate（routeRequirementsMet）逐节点一致', chapterStates.length === 0, chapterStates.slice(0, 8).join(','));

  const emptyState = campaign.state(emptyInput);
  const richState = campaign.state({ flags: richFlags, evidence: richEvidence, cleared: richCleared, wallet: { credits: 0, items: {} } });
  const c4Ending = emptyState.endings[0];
  check('E03 终局前置指向真实 C4 供电旗标', c4Ending.prerequisite.tokens.flags.indexOf('C4.city_power_restored') >= 0
    && c4Ending.prerequisite.met === false && c4Ending.available === false);
  check('E04 C4 落地后三个终局前置都 met、C5 可进入', richState.endings.every((ending) => ending.prerequisite.met === true && ending.available === true)
    && richState.chapters.find((chapter) => chapter.chapterId === 'C5').state === 'available');
  check('E05 C5 前置解释与终局入口一致', (function () {
    const c5 = emptyState.chapters.find((chapter) => chapter.chapterId === 'C5');
    return c5.prerequisite.met === false
      && c5.prerequisite.tokens.flags.indexOf('C4.city_power_restored') >= 0
      && c5.routes.length === 3
      && c5.routes.every((route) => route.prerequisite.tokens.flags.indexOf('C4.city_power_restored') >= 0);
  })());

  /* 解释文案卫生：不出现职业名/内部 id/原因码/章节码。 */
  const textIssues = [];
  const allStates = [emptyState, richState];
  allStates.forEach((st) => {
    st.chapters.forEach((chapter) => {
      textIssues.push.apply(textIssues, playerTextIssues(chapter.chapterId + '.prerequisite', chapter.prerequisite.text || ''));
      textIssues.push.apply(textIssues, playerTextIssues(chapter.chapterId + '.completion', chapter.completion.text || ''));
      (chapter.routes || []).forEach((route) => {
        textIssues.push.apply(textIssues, playerTextIssues(chapter.chapterId + '/' + route.routeId + '.prerequisite', route.prerequisite.text || ''));
      });
    });
    st.endings.forEach((ending) => {
      textIssues.push.apply(textIssues, playerTextIssues('ending/' + ending.approach, ending.prerequisite.text || ''));
    });
  });
  check('E06 前置解释文案卫生', textIssues.length === 0, textIssues.slice(0, 8).join(','));

  /* 解释必须真的写出「怎么拿到」：终局前置要引用真实产出章节与通用活计。 */
  const c4Chapter = emptyState.chapters.find((chapter) => chapter.chapterId === 'C4');
  check('E07 终局前置解释引用真实章节与通用活计', (function () {
    const text = c4Ending.prerequisite.text;
    const titled = CAMPAIGN.chapters.some((chapter) => chapter.title && text.indexOf(chapter.title) >= 0);
    const worldTitled = WORLD.entries.some((entry) => text.indexOf(entry.title) >= 0);
    return !!text && titled && worldTitled;
  })(), c4Ending.prerequisite.text);
  check('E08 章节完成解释引用本章真实标题', c4Chapter.completion.text.indexOf(c4Chapter.title) >= 0, c4Chapter.completion.text);

  /* 世界条件：内容里被 chapterGate 挡住的工单一律等到该旗标落地（真实 commission.chapterGate）。 */
  const gatedReal = REAL.filter((row) => row.chapterGate === 'C4.city_power_restored').length;
  check('E15 终局前置解释包含真实世界条件（高阶工单等待）', gatedReal > 0
    && c4Ending.prerequisite.text.indexOf('要等这一步落地才会挂出来') >= 0, c4Ending.prerequisite.text);

  /* 不新增 reason code / 不改 gate / 不改奖励。 */
  eq('E09 route-planner 未新增 reason code', Object.keys(routePlanner.REASONS), ROUTE_REASON_KEYS);
  eq('E10 campaign-core 未新增 reason code', Object.keys(campaignCore.REASONS), CAMPAIGN_REASON_KEYS);
  const rewardIssues = [];
  richState.chapters.forEach((chapter) => {
    const contentChapter = CAMPAIGN.chapters.find((item) => item.chapterId === chapter.chapterId);
    (chapter.routes || []).forEach((route) => {
      if (chapter.chapterId === 'C5') {
        const ending = CAMPAIGN.endings.find((item) => 'ending.' + item.approach === route.routeId);
        if (ending && JSON.stringify(route.rewardFlags) !== JSON.stringify(ending.flags)) rewardIssues.push('C5/' + route.routeId);
        return;
      }
      const contentRoute = (contentChapter.routes || []).find((item) => item.routeId === route.routeId);
      if (contentRoute && JSON.stringify(route.rewardFlags) !== JSON.stringify(contentRoute.rewardFlags)) rewardIssues.push(chapter.chapterId + '/' + route.routeId);
    });
  });
  check('E11 前置解释不改奖励旗标', rewardIssues.length === 0, rewardIssues.join(','));
  check('E12 终局 flags 内容未改动', (function () {
    return CAMPAIGN.endings.every((ending, index) => {
      return JSON.stringify(richState.endings[index].flags) === JSON.stringify(ending.flags);
    });
  })());

  const before = JSON.stringify({ flags: richFlags, evidence: richEvidence, cleared: richCleared });
  campaign.state({ flags: richFlags, evidence: richEvidence, cleared: richCleared, wallet: { credits: 0, items: {} } });
  check('E13 state 不修改输入', JSON.stringify({ flags: richFlags, evidence: richEvidence, cleared: richCleared }) === before);
  eq('E14 前置解释确定性（重复 state 同输出）', campaign.state({ flags: richFlags, evidence: richEvidence, cleared: richCleared }), richState);
}

/* ---------------------------------------------------------------- F 经济/静态边界 */

{
  const pathArgs = {
    originGameId: 'memory-flip',
    acceptedProfessionId: 'research.archivist',
    wallet: { credits: 80, items: {} },
    quests: [],
    claims: [],
    flags: ['C0.port_seen'],
  };
  const worldPath = planner.worldWorkPath(pathArgs);
  const expectedCredits = (worldPath.steps || []).reduce((sum, step) => {
    if (step.kind !== 'commission') return sum;
    const row = BY_ID.get(step.commissionId);
    return sum + ((row && row.reward && row.reward.credits) || 0);
  }, 0);
  checkEq('F01 世界路线计划工钱只来自内容（无发明数字）', worldPath.economy.plannedCredits, expectedCredits);
  checkEq('F02 世界路线不扣钱（市场退路零消耗）', worldPath.economy.spentCredits, 0);
  checkEq('F03 世界路线不使用重复工钱', worldPath.economy.repeatSalaryUsed, false);

  const routeSource = fs.readFileSync(path.join(CAREER, 'route-planner.js'), 'utf8');
  const campaignSource = fs.readFileSync(path.join(CAREER, 'campaign-core.js'), 'utf8');
  check('F04 route-planner 无 DOM/IDB/网络/宿主存储', !/(document\.|indexedDB|XMLHttpRequest|fetch\s*\(|localStorage|sessionStorage|navigator\.)/.test(routeSource));
  check('F05 route-planner 无时钟/随机数', !/\bDate\b|Math\.random|performance\.now/.test(routeSource));
  check('F06 route-planner 不 require 其它模块', !/\brequire\s*\(/.test(routeSource));
  check('F07 campaign-core 无 DOM/IDB/网络/宿主存储', !/(document\.|indexedDB|XMLHttpRequest|fetch\s*\(|localStorage|sessionStorage|navigator\.)/.test(campaignSource));
  check('F08 两个模块都无经济写入口 API', [routePlanner, campaignCore].every((module) => {
    return !Object.keys(module).some((name) => /(purchase|sell|settle|grant|ledger|balance|write|delete|save)/i.test(name));
  }));
  check('F09 route-planner 暴露 chapterAlternatives', typeof routePlanner.chapterAlternatives === 'function');
  const guide = planner.chapterAlternatives({ flags: [] });
  check('F10 替代指引无任何写入口（只有 ok/只读字段）', !!guide.readOnly && !Object.keys(guide).some((name) => /(purchase|write|save|delete)/i.test(name)));

  const notConfigured = routePlanner.create().chapterAlternatives({});
  check('F11 未配置时结构化失败（沿用既有 reason code）', notConfigured.ok === false
    && notConfigured.reason === routePlanner.REASONS.notConfigured
    && Array.isArray(notConfigured.chapters));
  const unknownOrigin = planner.chapterAlternatives({ originGameId: 'no-such-game' });
  checkEq('F12 未知起源沿用既有 reason code', unknownOrigin.reason, routePlanner.REASONS.unknownOrigin);
  const unknownProfession = planner.chapterAlternatives({ acceptedProfessionId: 'no.such.profession' });
  checkEq('F13 未知职业沿用既有 reason code', unknownProfession.reason, routePlanner.REASONS.unknownProfession);
}

/* ---------------------------------------------------------------- 结果输出 */

let passed = 0;
results.forEach((item) => {
  if (item.ok) {
    passed += 1;
    console.log('PASS  ' + item.name);
  } else {
    console.log('FAIL  ' + item.name + (item.detail ? ' — ' + item.detail : ''));
  }
});
console.log('');
console.log(passed + '/' + results.length + ' checks passed');
if (passed !== results.length) {
  console.error('FAILED: ' + (results.length - passed) + ' check(s) failed');
  process.exit(1);
}
console.log('PASS  career world route narrative test');
process.exit(0);
