#!/usr/bin/env node
/**
 * 0.22 T05：世界通用工作纯数据契约（Node-only，不启动浏览器 / 不写仓库）
 *
 * 覆盖：
 * - world-work.json 的 W5E 精确 ID、通用文案、无职业/内部 token 泄漏；
 * - route-planner / campaign-core 的 worldWork configure、只读 worldWorkPath、validate；
 * - 16 起源 × 3 终局数据级路径；删除任一 W5E ID 后 C4 不可派生；
 * - 经济边界与「缺 worldWork 时旧行为不变」。
 *
 * 运行：node tools/career_world_work_test.mjs
 * 退出码：0 全 PASS；1 有 FAIL；2 装配失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CAREER = path.join(ROOT, 'apps', 'arcade', 'career');
const CONTENT = path.join(CAREER, 'content');

const EXPECTED_IDS = [
  'star-raid.T1',
  'star-raid.T2',
  'star-raid.T3',
  'pendulum-tower.T1',
  'pendulum-tower.T2',
];
const C2 = 'C2.research_complete';
const C3 = 'C3.truth_found';
const C4 = 'C4.city_power_restored';
const C1 = 'C1.signal_fragment';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? '' : detail === undefined ? '' : String(detail) });
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e} got ${a}`);
}
function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(CONTENT, name), 'utf8'));
}
function sorted(list) {
  return Array.from(new Set(list)).sort();
}
function claimsFor(ids, byId) {
  return ids.map((id) => {
    const row = byId.get(id);
    return {
      commissionId: id,
      receiptId: `receipt:${id}`,
      evidence: ((row && row.reward && row.reward.evidence) || []).slice(),
      flags: ((row && row.reward && row.reward.flags) || []).slice(),
    };
  });
}
function flagsFor(ids, storyEvidence, byId) {
  const result = storyEvidence.storyFlags({ claims: claimsFor(ids, byId) });
  return result.ok === true ? result.flags : [];
}
function worldSteps(pathResult) {
  return (pathResult.steps || []).filter((step) => step.category === 'world');
}
function hasNoProfessionLeak(steps, professionIds, displayNames) {
  return steps.every((step) => {
    if (Object.prototype.hasOwnProperty.call(step, 'professionId')) return false;
    const text = [step.title, step.summary, step.reason].filter(Boolean).join(' ');
    return professionIds.every((id) => text.indexOf(id) < 0)
      && displayNames.every((name) => text.indexOf(name) < 0);
  });
}

let WORLD;
let COMMISSIONS;
let ITEMS;
let CHAPTER;
let REGISTRY;
let CAMPAIGN;
let NPC;
let SIDE;
let STORY_EVIDENCE;
let ROUTE_PLANNER;
let CAMPAIGN_CORE;
let MATERIALS;
let BY_ID;
let ORIGINS;
let PROFESSION_IDS;
let DISPLAY_NAMES;

try {
  WORLD = readJson('world-work.json');
  COMMISSIONS = readJson('commissions.json');
  ITEMS = readJson('items.json');
  CHAPTER = readJson('chapter-01.json');
  REGISTRY = readJson('registry.json');
  CAMPAIGN = readJson('campaign.json');
  NPC = readJson('npc.json');
  SIDE = readJson('side-stories.json');
  STORY_EVIDENCE = require(path.join(CAREER, 'story-evidence.js'));
  ROUTE_PLANNER = require(path.join(CAREER, 'route-planner.js'));
  CAMPAIGN_CORE = require(path.join(CAREER, 'campaign-core.js'));
  MATERIALS = require(path.join(CAREER, 'materials.js'));
} catch (err) {
  console.error('FATAL 装配失败：' + (err && err.message ? err.message : String(err)));
  process.exit(2);
}

BY_ID = new Map(COMMISSIONS.commissions.map((row) => [row.commissionId, row]));
ORIGINS = CHAPTER.origins.map((origin) => ({
  gameId: origin.gameId,
  professionId: origin.professionId,
}));
PROFESSION_IDS = REGISTRY.professions.map((row) => row.professionId);
DISPLAY_NAMES = REGISTRY.professions.map((row) => row.displayName).filter(Boolean);
const EVIDENCE_TOKENS = sorted(COMMISSIONS.commissions.flatMap((row) => {
  return ((row.reward && row.reward.evidence) || []).slice();
}));
const CHAPTER_FILES = [0, 1, 2, 3, 4, 5].map((index) => readJson(`chapter-0${index}.json`));
const COMMISSIONS_SNAPSHOT = JSON.stringify(COMMISSIONS);
const WORLD_SNAPSHOT = JSON.stringify(WORLD);

const evidence = STORY_EVIDENCE.createStoryEvidence
  ? STORY_EVIDENCE.createStoryEvidence({})
  : STORY_EVIDENCE;
const evidenceConfig = evidence.configure({ commissions: COMMISSIONS, items: ITEMS, chapter: CHAPTER });
if (evidenceConfig.ok !== true) {
  console.error('FATAL story-evidence configure 失败：' + JSON.stringify(evidenceConfig.errors || []));
  process.exit(2);
}
MATERIALS.configure({ items: ITEMS, commissions: COMMISSIONS });

function plannerWith(worldWork) {
  const planner = ROUTE_PLANNER.create();
  const config = planner.configure({
    commissions: COMMISSIONS,
    items: ITEMS,
    chapter: CHAPTER,
    registry: REGISTRY,
    materials: MATERIALS,
    evidence,
    alternatives: { offers: [] },
    worldWork,
  });
  return { planner, config };
}

function campaignWith(worldWork) {
  const campaign = CAMPAIGN_CORE.createCampaign({});
  const config = campaign.configure({
    campaign: CAMPAIGN,
    chapters: CHAPTER_FILES,
    npc: NPC,
    sideStories: SIDE,
    commissions: COMMISSIONS.commissions,
    evidence: EVIDENCE_TOKENS,
    worldWork,
  });
  return { campaign, config };
}

/* ------------------------------------------------------------------ A 内容契约 */

{
  eq('A01 contentVersion 保持 0.18.0', WORLD.contentVersion, '0.18.0');
  eq('A02 schemaVersion', WORLD.schemaVersion, 1);
  eq('A03 commissionIds 精确为 W5E', WORLD.commissionIds, EXPECTED_IDS);
  check('A04 所有 ID 都在 96 委托目录内', WORLD.commissionIds.every((id) => BY_ID.has(id)));
  const entryIds = WORLD.entries.map((entry) => entry.commissionId);
  eq('A05 entries 与 commissionIds 一一对应', sorted(entryIds), sorted(EXPECTED_IDS));
  check('A06 通用标题/说明齐备', WORLD.entries.every((entry) => {
    return typeof entry.title === 'string' && entry.title.length > 0
      && typeof entry.summary === 'string' && entry.summary.length > 0;
  }));
  const raw = JSON.stringify(WORLD);
  const internal = [...PROFESSION_IDS, ...DISPLAY_NAMES, 'P-07', 'E-7', 'C1.', 'C2.', 'C3.', 'C4.', 'C5.', 'E-', 'BP-', 'MAP-', 'DEC-'];
  check('A07 通用文案无职业名 / 内部 token / 剧透', internal.every((token) => !token || raw.indexOf(token) < 0), raw);
  check('A08 每条都有真实可玩目标', WORLD.commissionIds.every((id) => {
    const row = BY_ID.get(id);
    return row && row.objective && row.objective.kind && !row.chapterGate;
  }));
}

/* ------------------------------------------------------------------ B 证据与最小性 */

{
  const allFlags = flagsFor(EXPECTED_IDS, evidence, BY_ID);
  check('B01 W5E 派生 C2/C3/C4', [C2, C3, C4].every((flag) => allFlags.indexOf(flag) >= 0), allFlags.join(','));
  const tokens = EXPECTED_IDS.flatMap((id) => ((BY_ID.get(id).reward || {}).evidence || []));
  eq('B02 W5E 共 5 个无门禁 E 证据', tokens, [
    'E-C1-patrol', 'E-C1-patrol-2', 'E-star-raid.T3', 'E-C1-site', 'E-C1-site-2',
  ]);
  check('B03 每条委托最多一个证据 token', COMMISSIONS.commissions.every((row) => {
    return ((row.reward && row.reward.evidence) || []).length <= 1;
  }));
  EXPECTED_IDS.forEach((removed) => {
    const ids = EXPECTED_IDS.filter((id) => id !== removed);
    const flags = flagsFor(ids, evidence, BY_ID);
    check(`B04 删除 ${removed} 后 C4 不成立`, flags.indexOf(C4) < 0, flags.join(','));
  });
}

/* ------------------------------------------------------------------ C route-planner */

let planner;
let plannerConfig;
{
  const made = plannerWith(WORLD);
  planner = made.planner;
  plannerConfig = made.config;
  check('C01 worldWork configure ok', plannerConfig.ok === true, JSON.stringify(plannerConfig.errors || []));
  eq('C02 configure 报告 worldWorkCount', plannerConfig.worldWorkCount, EXPECTED_IDS.length);
  eq('C03 status 报告 worldWorkCount', planner.status().worldWorkCount, EXPECTED_IDS.length);
  check('C04 默认 plan 顶层键不含 worldWorkPath', !Object.prototype.hasOwnProperty.call(
    planner.plan({ originGameId: 'gold-miner', professionId: 'nature.miner' }),
    'worldWorkPath',
  ));
  const report = planner.validate();
  check('C05 带 worldWork 的 validate ok', report.ok === true, JSON.stringify(report.errors).slice(0, 400));
  const ids = new Map((report.checks || []).map((entry) => [entry.id, entry.ok]));
  check('C06 validate 含世界工作四项检查', [
    'world-work-ids-known', 'world-work-origin-paths', 'world-work-no-profession-leak', 'world-work-economy',
  ].every((id) => ids.get(id) === true), JSON.stringify([...ids]));

  ORIGINS.forEach((origin) => {
    const path = planner.worldWorkPath({
      originGameId: origin.gameId,
      acceptedProfessionId: origin.professionId,
      wallet: { credits: 80, items: {} },
      quests: [],
      claims: [],
      flags: ['C0.port_seen'],
    });
    const label = `${origin.gameId}/${origin.professionId}`;
    check(`C07 ${label} route 路径 ok+complete`, path.ok === true && path.complete === true, JSON.stringify(path.blockers || []));
    check(`C08 ${label} route 派生 C1–C4`, [C1, C2, C3, C4].every((flag) => path.flagsAfter.indexOf(flag) >= 0), path.flagsAfter.join(','));
    eq(`C09 ${label} route 全 W5E 已排入`, sorted(path.plannedWorldCommissionIds), sorted(EXPECTED_IDS));
    check(`C10 ${label} route 无职业泄漏`, hasNoProfessionLeak(worldSteps(path), PROFESSION_IDS, DISPLAY_NAMES));

    const expectedCredits = (path.steps || []).reduce((sum, step) => {
      const row = BY_ID.get(step.commissionId);
      return sum + (row && row.reward ? row.reward.credits || 0 : 0);
    }, 0);
    check(`C11 ${label} 经济边界`, path.economy.initialCredits === 80
      && path.economy.plannedCredits === expectedCredits
      && path.economy.spentCredits === 0
      && Object.keys(path.economy.spentItems || {}).length === 0
      && path.economy.repeatSalaryUsed === false
      && path.economy.marketRequired === false, JSON.stringify(path.economy));

    const repeated = planner.worldWorkPath({
      originGameId: origin.gameId,
      acceptedProfessionId: origin.professionId,
      wallet: { credits: 80, items: {} },
      quests: [],
      claims: [],
      flags: ['C0.port_seen'],
    });
    eq(`C12 ${label} worldWorkPath 确定性`, repeated, path);
  });

  const withPlan = planner.plan({
    originGameId: 'gold-miner',
    professionId: 'nature.miner',
    acceptedProfessionId: 'nature.miner',
    includeWorldWork: true,
  });
  check('C13 plan(includeWorldWork) 暴露只读路径', withPlan.worldWorkPath && withPlan.worldWorkPath.complete === true);
  const explained = planner.explain(withPlan);
  check('C14 explain 输出世界路径玩家文案', Array.isArray(explained.worldWorkLines)
    && explained.worldWorkLines.length === EXPECTED_IDS.length
    && WORLD.entries.every((entry) => explained.text.indexOf(entry.title) >= 0), JSON.stringify(explained.worldWorkLines || []));
  check('C15 explain 世界文案不含内部 ID', EXPECTED_IDS.every((id) => explained.text.indexOf(id) < 0)
    && PROFESSION_IDS.every((id) => explained.text.indexOf(id) < 0));
}

/* ------------------------------------------------------------------ D campaign-core */

let campaign;
let campaignConfig;
{
  const made = campaignWith(WORLD);
  campaign = made.campaign;
  campaignConfig = made.config;
  check('D01 worldWork configure ok', campaignConfig.ok === true, JSON.stringify(campaignConfig.errors || []));
  eq('D02 campaign configure worldWorkCount', campaignConfig.worldWorkCount, EXPECTED_IDS.length);
  eq('D03 campaign configuration worldWorkCount', campaign.configuration().worldWorkCount, EXPECTED_IDS.length);

  const report = campaign.validate({ storyEvidence: evidence });
  check('D04 validate ok', report.ok === true, JSON.stringify(report.errors).slice(0, 400));
  eq('D05 16 起源 × 3 终局证明', report.worldWorkPathProof && {
    total: report.worldWorkPathProof.total,
    passed: report.worldWorkPathProof.passed,
    failures: report.worldWorkPathProof.failures,
  }, { total: 48, passed: 48, failures: [] });

  ORIGINS.forEach((origin) => {
    CAMPAIGN.endings.forEach((ending) => {
      const path = campaign.worldWorkPath({
        originGameId: origin.gameId,
        acceptedProfessionId: origin.professionId,
        approach: ending.approach,
        flags: ['C0.port_seen'],
        storyEvidence: evidence,
      });
      const label = `${origin.gameId}/${ending.approach}`;
      check(`D06 ${label} campaign 路径 ok+complete`, path.ok === true && path.complete === true, JSON.stringify(path.blockers || []));
      check(`D07 ${label} 派生 C1–C4`, [C1, C2, C3, C4].every((flag) => path.flagsAfter.indexOf(flag) >= 0), path.flagsAfter.join(','));
      check(`D08 ${label} 三终局入口全开`, path.endings.every((view) => view.available === true), JSON.stringify(path.endings));
      check(`D09 ${label} 无职业泄漏`, hasNoProfessionLeak(worldSteps(path), PROFESSION_IDS, DISPLAY_NAMES));
      eq(`D10 ${label} 通用标题来自 worldWork`, worldSteps(path).map((step) => step.title), WORLD.entries.map((entry) => entry.title));
    });
  });

  const recommendation = campaign.recommend({
    availableIds: EXPECTED_IDS.slice(),
    flags: ['C0.port_seen', C1, C2, C3],
    evidence: ['E-C1-patrol', 'E-C1-patrol-2', 'E-star-raid.T3'],
    cleared: [],
    storyEvidence: evidence,
  });
  check('D11 推荐命中世界工作', !!recommendation && EXPECTED_IDS.indexOf(recommendation.commissionId) >= 0, JSON.stringify(recommendation));
  if (recommendation && recommendation.category === 'world') {
    const meta = WORLD.entries.find((entry) => entry.commissionId === recommendation.commissionId);
    eq('D12 推荐通用标题', recommendation.goal, meta.title);
    eq('D13 推荐通用说明', recommendation.description, meta.summary);
    check('D14 推荐不含拥有职业', !Object.prototype.hasOwnProperty.call(recommendation, 'professionId'));
  } else {
    check('D12 推荐通用标题', false, 'recommendation did not use world category');
  }
}

/* ------------------------------------------------------------------ E 默认兼容与坏输入 */

{
  const legacyPlanner = plannerWith(undefined).planner;
  const legacyPlan = legacyPlanner.plan({ originGameId: 'memory-flip', professionId: 'research.archivist' });
  check('E01 缺 worldWork 时 plan 无 worldWorkPath', !Object.prototype.hasOwnProperty.call(legacyPlan, 'worldWorkPath'));
  eq('E02 缺 worldWork 时只读路径失败', legacyPlanner.worldWorkPath({
    originGameId: 'memory-flip', acceptedProfessionId: 'research.archivist',
  }).reason, 'world-work-not-configured');
  check('E03 缺 worldWork 时 validate 仍 ok', legacyPlanner.validate().ok === true);

  const legacyCampaign = campaignWith(undefined);
  check('E04 缺 worldWork 时 campaign configure ok', legacyCampaign.config.ok === true);
  check('E05 缺 worldWork 时 validate 无证明字段', !Object.prototype.hasOwnProperty.call(legacyCampaign.campaign.validate(), 'worldWorkPathProof'));
  eq('E06 缺 worldWork 时只读路径失败', legacyCampaign.campaign.worldWorkPath({ originGameId: 'memory-flip' }).reason, 'world-work-not-configured');

  const bad = JSON.parse(JSON.stringify(WORLD));
  bad.commissionIds.push('no-such-commission.T1');
  const badPlanner = plannerWith(bad);
  check('E07 未知世界工作 ID 被拒绝', badPlanner.config.ok === false && badPlanner.config.unchanged === true, JSON.stringify(badPlanner.config.errors || []));
  const badCampaign = campaignWith(bad);
  check('E08 未知世界工作 ID 被 campaign 拒绝', badCampaign.config.ok === false, JSON.stringify(badCampaign.config.errors || []));

  const missingEntry = JSON.parse(JSON.stringify(WORLD));
  missingEntry.entries.pop();
  check('E09 缺通用文案被拒绝', plannerWith(missingEntry).config.ok === false);
}

/* ------------------------------------------------------------------ F 合成 N+1 / 多职业映射 */

{
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const future = {
    commissions: clone(COMMISSIONS.commissions),
    registry: clone(REGISTRY),
    chapter: clone(CHAPTER),
  };
  function addTier(prefix, gameId, professionId) {
    for (let tier = 1; tier <= 3; tier += 1) {
      future.commissions.push({
        commissionId: `${prefix}.T${tier}`,
        gameId,
        professionId,
        tier,
        title: `新增工单 ${tier}`,
        summary: '按告示板上的短活完成一次交差。',
        objective: { kind: 'pair.match', atLeast: 3 },
        reward: { credits: 10, items: {}, evidence: [], flags: [] },
        repeatSalaryCredits: 10,
        unlock: tier === 1 ? { all: [] } : { all: [{ commissionCleared: `${prefix}.T${tier - 1}` }] },
        chapterGate: null,
        risk: 'low',
        durationHint: '短活',
      });
    }
  }
  addTier('future-game.scout', 'future-game', 'future.scout');
  addTier('future-game.guide', 'future-game', 'future.guide');
  addTier('future-market.broker', 'future-market', 'future.broker');
  future.registry.games.push(
    { gameId: 'future-game', displayName: '新增港口', professions: ['future.scout', 'future.guide'], capabilities: [], watch: [] },
    { gameId: 'future-market', displayName: '新增集市', professions: ['future.broker'], capabilities: [], watch: [] },
  );
  future.registry.professions.push(
    { professionId: 'future.scout', displayName: '新观察员', domain: 'future', capabilities: [] },
    { professionId: 'future.guide', displayName: '新引导员', domain: 'future', capabilities: [] },
    { professionId: 'future.broker', displayName: '新中间人', domain: 'future', capabilities: [] },
  );
  future.chapter.origins.push(
    {
      gameId: 'future-game',
      professionId: 'future.scout',
      opening: '新港口的纸上还有潮气。',
      c0Letter: { from: '新港口值班', body: '一张新纸', address: '新港口' },
      firstStep: '去新港口的告示板看看。',
    },
    {
      gameId: 'future-market',
      professionId: 'future.broker',
      opening: '集市尽头有人递来一张纸。',
      c0Letter: { from: '新集市值班', body: '一张新纸', address: '新集市' },
      firstStep: '去新集市的告示板看看。',
    },
  );

  const futureEvidence = STORY_EVIDENCE.createStoryEvidence({});
  const futureEvidenceConfig = futureEvidence.configure({
    commissions: { contentVersion: '0.18.0', commissions: future.commissions },
    items: ITEMS,
    chapter: future.chapter,
  });
  check('F01 N+1 证据模块可配置', futureEvidenceConfig.ok === true, JSON.stringify(futureEvidenceConfig.errors || []));
  const futurePlanner = ROUTE_PLANNER.create();
  const futureConfig = futurePlanner.configure({
    commissions: { contentVersion: '0.18.0', commissions: future.commissions },
    items: ITEMS,
    chapter: future.chapter,
    registry: future.registry,
    evidence: futureEvidence,
    alternatives: { offers: [] },
    worldWork: WORLD,
  });
  check('F02 N+1 世界工作可配置', futureConfig.ok === true, JSON.stringify(futureConfig.errors || []));

  const oldRealPath = planner.worldWorkPath({
    originGameId: 'gold-miner',
    acceptedProfessionId: 'nature.miner',
    wallet: { credits: 80, items: {} },
    flags: ['C0.port_seen'],
  });
  const oldFuturePath = futurePlanner.worldWorkPath({
    originGameId: 'gold-miner',
    acceptedProfessionId: 'nature.miner',
    wallet: { credits: 80, items: {} },
    flags: ['C0.port_seen'],
  });
  eq('F03 原起源路径不被 N+1 污染', {
    originCommissionId: oldFuturePath.originCommissionId,
    plannedWorldCommissionIds: oldFuturePath.plannedWorldCommissionIds,
    flagsAfter: oldFuturePath.flagsAfter,
    economy: oldFuturePath.economy,
  }, {
    originCommissionId: oldRealPath.originCommissionId,
    plannedWorldCommissionIds: oldRealPath.plannedWorldCommissionIds,
    flagsAfter: oldRealPath.flagsAfter,
    economy: oldRealPath.economy,
  });

  [
    { label: '新职业本游戏', gameId: 'future-game', professionId: 'future.scout' },
    { label: '同游戏第二职业', gameId: 'future-game', professionId: 'future.guide' },
    { label: '跨游戏 T1', gameId: 'future-game', professionId: 'future.broker' },
    { label: '新职业 T1 游戏', gameId: 'future-market', professionId: 'future.broker' },
  ].forEach((item) => {
    const path = futurePlanner.worldWorkPath({
      originGameId: item.gameId,
      acceptedProfessionId: item.professionId,
      wallet: { credits: 80, items: {} },
      flags: ['C0.port_seen'],
    });
    check(`F04 ${item.label} worldWorkPath complete`, path.ok === true && path.complete === true, JSON.stringify(path.blockers || []));
    eq(`F05 ${item.label} 排入完整 W5E`, sorted(path.plannedWorldCommissionIds), sorted(EXPECTED_IDS));
    check(`F06 ${item.label} 无职业泄漏`, hasNoProfessionLeak(
      worldSteps(path),
      [...PROFESSION_IDS, ...future.registry.professions.map((row) => row.professionId)],
      [...DISPLAY_NAMES, ...future.registry.professions.map((row) => row.displayName).filter(Boolean)],
    ));
  });

  const realValidate = planner.validate();
  const futureValidate = futurePlanner.validate();
  check('F07a N+1 validate ok', futureValidate.ok === true, JSON.stringify((futureValidate.errors || []).slice(0, 5)).slice(0, 800));
  const realProof = realValidate.worldWorkPathProof;
  const futureProof = futureValidate.worldWorkPathProof;
  check('F07 validate 按 (gameId, professionId) 扩展', !!futureProof && !!realProof
    && futureProof.pairCount > realProof.pairCount
    && futureProof.failures.length === 0
    && futureProof.passed === futureProof.pairCount, JSON.stringify(futureProof && {
      pairCount: futureProof.pairCount,
      failures: futureProof.failures,
    }));
  check('F08 validate 覆盖同游戏第二职业', !!futureProof && Array.isArray(futureProof.pairs)
    && futureProof.pairs.some((pair) => pair.gameId === 'future-game' && pair.professionId === 'future.guide'));
  check('F09 validate 覆盖跨游戏 T1', !!futureProof && Array.isArray(futureProof.pairs)
    && futureProof.pairs.some((pair) => pair.gameId === 'future-game' && pair.professionId === 'future.broker'));
  eq('F10 真实委托内容快照不变', JSON.stringify(COMMISSIONS), COMMISSIONS_SNAPSHOT);
  eq('F11 world-work 内容快照不变', JSON.stringify(WORLD), WORLD_SNAPSHOT);
}

/* ------------------------------------------------------------------ 汇总 */

let failed = 0;
for (const item of results) {
  if (item.ok) {
    console.log('PASS  ' + item.name);
  } else {
    failed += 1;
    console.log('FAIL  ' + item.name + (item.detail ? ' — ' + item.detail.slice(0, 600) : ''));
  }
}
console.log('');
console.log(`${results.length - failed}/${results.length} checks passed`);
if (failed) {
  console.error(`FAILED: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('PASS  career world work contract test');
