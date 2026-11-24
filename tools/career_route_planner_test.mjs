#!/usr/bin/env node
/**
 * D17-24 契约测试：单职业主线路线规划（纯 Node，不需要 Chrome）
 *
 * 覆盖：
 * - 真实 0.17 内容：16 起源 × 16 职业全部可配置；每个组合都返回可执行路线或可解释
 *   blockers，且 lead 路线不依赖某一款游戏作为唯一前置；
 * - 只做一个职业：战斗失败/无自有船可用免费租机；不买机也能交差；材料可商店买、
 *   其他入门工单换、或明码代办，至少三种替代路线同时存在；
 * - C2–C4：注入真实 story-evidence 模块后按证据组合解锁 T4/T5，C5 只按剧情旗标；
 *   单职业 + 受控故事旗标可规划完整 6 阶；没有证据时以可解释 blocker + 至少 3 条
 *   替代路线呈现，绝不假装解锁；
 * - 起点的 16 种任一、无资金先接哪单、材料缺口、信用点缺口与大致工作量；
 * - 强化路线（熟练/专家）只改顺序与开场省略，不改任何内容数值；
 * - 确定性、输入不可变、实例隔离；坏内容结构化失败且保留上次可用状态；
 * - 未来第 17 游戏 / 第 17+ 职业 / 同游戏两职业 / 跨游戏职业可插拔，不硬编码数量；
 * - 静态边界（无 DOM/IDB/网络/存储/写库/随机/时钟）、UMD 双全局、API 面无经济写入口。
 *
 * 运行：node tools/career_route_planner_test.mjs
 * 退出码：0 = 全 PASS；1 = 有 FAIL；2 = 使用错误（本脚本不接受参数）。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

if (process.argv.slice(2).length > 0) {
  console.error('usage: node tools/career_route_planner_test.mjs（不接受参数）');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const CAREER_DIR = path.join(REPO_ROOT, 'apps', 'arcade', 'career');
const CONTENT_DIR = path.join(CAREER_DIR, 'content');
const MODULE_PATH = path.join(CAREER_DIR, 'route-planner.js');
const MATERIALS_PATH = path.join(CAREER_DIR, 'materials.js');
const EVIDENCE_PATH = path.join(CAREER_DIR, 'story-evidence.js');

const MODULE_SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');
const routePlanner = require(MODULE_PATH);
const materialsModule = require(MATERIALS_PATH);
const storyEvidence = require(EVIDENCE_PATH);

const ITEMS = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'items.json'), 'utf8'));
const COMMISSIONS_CONTENT = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'commissions.json'), 'utf8'));
const CHAPTER = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'chapter-01.json'), 'utf8'));
const REGISTRY = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'registry.json'), 'utf8'));
const REAL = COMMISSIONS_CONTENT.commissions;
const REAL_BY_ID = new Map(REAL.map((commission) => [commission.commissionId, commission]));
const REAL_GAMES = REGISTRY.games.map((game) => game.gameId).slice().sort();
const REAL_PROFESSIONS = REGISTRY.professions.map((profession) => profession.professionId).slice().sort();
const REAL_ORIGINS = CHAPTER.origins.map((origin) => origin.gameId).slice().sort();
const GAME_NAMES = new Map(REGISTRY.games.map((game) => [game.gameId, game.displayName]));
const PROFESSION_NAMES = new Map(REGISTRY.professions.map((profession) => [profession.professionId, profession.displayName]));

/* D16-10 冻结的默认代办契约（alt.courier / alt.records）；route-planner 接受注入。 */
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

materialsModule.configure({ items: ITEMS, commissions: COMMISSIONS_CONTENT });

/* ---------------------------------------------------------------- 断言/工具 */

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? '' : detail === undefined ? '' : String(detail) });
}
function checkEq(name, actual, expected) {
  check(name, actual === expected, 'expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'expected ' + e + ' got ' + a);
}
function eqKeys(name, actual, expected) {
  const keys = Object.keys(actual).sort();
  const want = expected.slice().sort();
  check(name, JSON.stringify(keys) === JSON.stringify(want), 'expected keys ' + JSON.stringify(want) + ' got ' + JSON.stringify(keys));
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.keys(value).forEach((key) => deepFreeze(value[key]));
  return value;
}
function commissionOf(id) {
  return REAL_BY_ID.get(id);
}
function claimOf(id, extra) {
  const commission = commissionOf(id);
  return Object.assign(
    {
      careerId: 'career-d17-24',
      receiptId: 'claim-' + id,
      commissionId: id,
      evidence: (commission.reward.evidence || []).slice(),
      flags: (commission.reward.flags || []).slice(),
    },
    extra || {}
  );
}
function questOf(id, extra) {
  return Object.assign({ careerId: 'career-d17-24', nodeId: id, kind: 'commission', status: 'cleared' }, extra || {});
}
function newEvidence() {
  const evidence = storyEvidence.createStoryEvidence({});
  const configured = evidence.configure({ commissions: COMMISSIONS_CONTENT, chapter: CHAPTER, items: ITEMS });
  return { evidence, configured };
}
function makeRealPlanner(extra) {
  const planner = routePlanner.create();
  const config = planner.configure(
    Object.assign(
      {
        commissions: COMMISSIONS_CONTENT,
        items: ITEMS,
        chapter: CHAPTER,
        registry: REGISTRY,
        materials: materialsModule,
        evidence: newEvidence().evidence,
        alternatives: { offers: OFFERS },
      },
      extra || {}
    )
  );
  return { planner, config };
}
function makeContentOnlyPlanner(extra) {
  const planner = routePlanner.create();
  const config = planner.configure(
    Object.assign(
      {
        commissions: COMMISSIONS_CONTENT,
        items: ITEMS,
        chapter: CHAPTER,
        registry: REGISTRY,
      },
      extra || {}
    )
  );
  return { planner, config };
}
function routePlan(planner, originGameId, professionId, extra) {
  return planner.plan(
    Object.assign(
      {
        originGameId,
        professionId,
        wallet: { credits: 0, items: {} },
        quests: [],
        claims: [],
        flags: [],
      },
      extra || {}
    )
  );
}
function requiredSteps(plan) {
  return plan.steps.filter((step) => !step.optional);
}
function commissionSteps(plan) {
  return plan.steps.filter((step) => step.kind === 'commission');
}
function allPlanStrings(plan) {
  const out = [];
  function add(value) {
    if (typeof value === 'string' && value) out.push(value);
  }
  add(plan.summaryText);
  (plan.steps || []).forEach((step) => {
    add(step.title);
    add(step.reason);
  });
  (plan.blockers || []).forEach((blocker) => {
    add(blocker.title);
    add(blocker.reason);
  });
  (plan.alternatives || []).forEach((alternative) => {
    add(alternative.title);
    add(alternative.reason);
  });
  return out;
}
const FORBIDDEN_TEXT = [
  '奖励', '福利', '礼包', '充值', '首充', '限时', '签到', '抽奖', '氪金',
  '爆率', '必玩', '超值', '攻略', '任务系统', '成就系统', '活动',
];
const TIME_WORDS = ['分钟', '小时', '时长', '倒计时', '等待时间'];
function marketingHits(text) {
  const hits = [];
  FORBIDDEN_TEXT.forEach((word) => {
    if (String(text).indexOf(word) >= 0) hits.push(word);
  });
  return hits;
}
function timeWordHits(text) {
  const hits = [];
  TIME_WORDS.forEach((word) => {
    if (String(text).indexOf(word) >= 0) hits.push(word);
  });
  return hits;
}
function fullMatrix(planner) {
  const plans = [];
  REAL_ORIGINS.forEach((originGameId) => {
    REAL_PROFESSIONS.forEach((professionId) => {
      plans.push({ originGameId, professionId, plan: routePlan(planner, originGameId, professionId) });
    });
  });
  return plans;
}
function routeGames(alternative) {
  const games = [];
  (alternative.routes || []).forEach((route) => {
    if (route && typeof route.gameId === 'string' && games.indexOf(route.gameId) < 0) games.push(route.gameId);
  });
  return games.sort();
}
function evidenceGames(blocker) {
  const games = [];
  (blocker.missing || []).forEach((entry) => {
    (entry.games || []).forEach((gameId) => {
      if (games.indexOf(gameId) < 0) games.push(gameId);
    });
  });
  return games.sort();
}

/* ---------------------------------------------------------------- A 静态/UMD/API */

{
  check('A01 Node require 返回 API', !!routePlanner && typeof routePlanner === 'object');
  ['configure', 'reset', 'status', 'isConfigured', 'plan', 'explain', 'validate', 'create'].forEach((name) => {
    check('A02 module.' + name + ' 是函数', typeof routePlanner[name] === 'function');
  });
  eq('A03 STEP_KINDS 冻结值', routePlanner.STEP_KINDS, ['commission', 'rental', 'market', 'alternative', 'story']);
  eq('A04 ALTERNATIVE_KINDS 冻结值', routePlanner.ALTERNATIVE_KINDS, ['work', 'research', 'trade', 'rental', 'alternative']);
  eq('A05 LEVELS 与 professions.js 阈值镜像', routePlanner.THRESHOLDS, { veteran: 3, expert: 6 });
  check('A06 常量冻结', Object.isFrozen(routePlanner.STEP_KINDS) && Object.isFrozen(routePlanner.ALTERNATIVE_KINDS) && Object.isFrozen(routePlanner.LEVELS));

  check('A07 无 DOM/IDB/网络/宿主存储', !/(document\.|indexedDB|XMLHttpRequest|fetch\s*\(|localStorage|sessionStorage|navigator\.)/.test(MODULE_SOURCE), 'source touched DOM/IDB/network/storage');
  check('A08 无时钟/随机数', !/\bDate\b|Math\.random|performance\.now/.test(MODULE_SOURCE), 'source has clock/random');
  check('A09 无 require 其它模块', !/\brequire\s*\(/.test(MODULE_SOURCE), 'source requires another module');
  check('A10 无写库/写存储调用', !/\.put\s*\(|\.add\s*\(|\.delete\s*\(|indexedDB/.test(MODULE_SOURCE), 'source writes a store');
  check('A11 不读取 score / 分数', !/\.score\b|['"]score['"]/.test(MODULE_SOURCE), 'source reads score');
  check('A12 不出现精确时间承诺字段', !/durationHint/.test(MODULE_SOURCE), 'source uses durationHint');
  check('A13 UMD 暴露两个浏览器全局名', MODULE_SOURCE.includes('ArcadeCareerRoutePlanner') && MODULE_SOURCE.includes('career.routePlanner'), 'UMD globals missing');

  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(MODULE_SOURCE, sandbox, { filename: 'route-planner.js' });
  const browserApi = sandbox.window.ArcadeCareerRoutePlanner;
  check('A14 window.ArcadeCareerRoutePlanner 已挂载', !!browserApi && typeof browserApi === 'object');
  check('A15 window.ArcadeCareer.routePlanner 与主全局同一对象', !!sandbox.window.ArcadeCareer && browserApi === sandbox.window.ArcadeCareer.routePlanner);
  check('A16 浏览器 API 也可 create 隔离实例', typeof browserApi.create === 'function' && browserApi.create() !== browserApi);
  check('A17 API 面无经济写入口', !Object.keys(routePlanner).some((name) => /(purchase|sell|settle|grant|ledger|balance|wallet|write|delete|save)/i.test(name)));
  const instance = routePlanner.create();
  check('A18 create 返回独立状态实例', instance.isConfigured() === false && routePlanner.isConfigured() === false);
}

/* ---------------------------------------------------------------- B configure 真实内容 */

let realPlanner;
{
  const made = makeRealPlanner();
  realPlanner = made.planner;
  const config = made.config;
  check('B01 configure 真实内容 ok', config.ok === true, JSON.stringify(config).slice(0, 240));
  checkEq('B02 委托数来自内容', config.commissionCount, REAL.length);
  checkEq('B03 职业数来自 registry', config.professionCount, REAL_PROFESSIONS.length);
  checkEq('B04 游戏/起源数来自内容', config.gameCount, REAL_GAMES.length);
  checkEq('B05 起源数来自章节', config.originCount, REAL_ORIGINS.length);
  checkEq('B06 材料数来自 items', config.materialCount, 5);
  checkEq('B07 免费租用机是旧翼', config.rentalShipId, 'old-wing');
  checkEq('B08 注入证据模块被识别', config.hasEvidence, true);
  checkEq('B09 注入代办内容被识别', config.offerCount, 2);
  checkEq('B10 contentVersion 来自内容', config.contentVersion, '0.18.0');
  check('B11 真实内容 configure 无警告', config.warnings.length === 0, JSON.stringify(config.warnings));

  const status = realPlanner.status();
  check('B12 status 与 configure 汇总一致', status.configured === true && status.commissionCount === config.commissionCount && status.professionCount === config.professionCount);
  const configAgain = realPlanner.configure({
    commissions: COMMISSIONS_CONTENT,
    items: ITEMS,
    chapter: CHAPTER,
    registry: REGISTRY,
    materials: materialsModule,
    evidence: newEvidence().evidence,
    alternatives: { offers: OFFERS },
  });
  eq('B13 configure 幂等（重复调用同结果）', configAgain, config);

  const fresh = routePlanner.create();
  const empty = fresh.configure({});
  check('B14 空配置结构化失败', empty.ok === false && empty.errors.length > 0);
  const missing = fresh.configure();
  check('B15 无输入结构化失败', missing.ok === false && missing.errors.indexOf('input-missing') >= 0);
  const missingCommissions = fresh.configure({ items: ITEMS });
  check('B16 缺委托结构化失败', missingCommissions.ok === false && missingCommissions.errors.indexOf('commissions-missing') >= 0);
  const emptyCommissions = fresh.configure({ commissions: [] });
  check('B17 空委托结构化失败', emptyCommissions.ok === false && emptyCommissions.errors.indexOf('commissions-empty') >= 0);

  const before = JSON.stringify(COMMISSIONS_CONTENT);
  const after = JSON.stringify(COMMISSIONS_CONTENT);
  check('B18 configure 不修改真实内容快照', before === after);
  check('B19 registry 显示名用于 route 输出', routePlan(realPlanner, 'memory-flip', 'engineering.structural').gameDisplayName === GAME_NAMES.get('pendulum-tower'));
  check('B20 职业显示名来自 registry', routePlan(realPlanner, 'memory-flip', 'engineering.structural').professionName === PROFESSION_NAMES.get('engineering.structural'));

  const arrayShorthand = routePlanner.create().configure(REAL);
  check('B21 裸委托数组 shorthand 可配置', arrayShorthand.ok === true && arrayShorthand.commissionCount === REAL.length);
  const wrapped = routePlanner.create().configure({
    content: { commissions: COMMISSIONS_CONTENT, items: ITEMS, chapter: CHAPTER, registry: REGISTRY },
  });
  check('B22 content 包裹形状可配置', wrapped.ok === true && wrapped.professionCount === REAL_PROFESSIONS.length);
}

/* ---------------------------------------------------------------- C 16×16 矩阵 */

{
  const matrix = fullMatrix(realPlanner);
  checkEq('C01 16×16 计划数', matrix.length, REAL_ORIGINS.length * REAL_PROFESSIONS.length);
  const notOk = matrix.filter((entry) => !entry.plan || entry.plan.ok !== true);
  check('C02 每个起源×职业都返回 ok 计划', notOk.length === 0, notOk.slice(0, 3).map((entry) => entry.originGameId + '/' + entry.professionId).join(','));
  const empty = matrix.filter((entry) => !Array.isArray(entry.plan.steps) || entry.plan.steps.length === 0);
  check('C03 每个计划都有可执行步骤', empty.length === 0, empty.slice(0, 3).map((entry) => entry.professionId).join(','));
  const badSteps = [];
  matrix.forEach((entry) => {
    (entry.plan.steps || []).forEach((step) => {
      if (routePlanner.STEP_KINDS.indexOf(step.kind) < 0) badSteps.push(entry.professionId + ':' + step.kind);
      if (typeof step.id !== 'string' || !step.id) badSteps.push(entry.professionId + ':no-id');
      if (step.kind === 'commission' && !REAL_BY_ID.has(step.commissionId)) badSteps.push(entry.professionId + ':' + step.commissionId);
    });
  });
  check('C04 步骤 kind/id 合法', badSteps.length === 0, badSteps.slice(0, 4).join(','));
  const badBlockers = [];
  matrix.forEach((entry) => {
    (entry.plan.blockers || []).forEach((blocker) => {
      if (typeof blocker.reason !== 'string' || !blocker.reason) badBlockers.push(entry.professionId + ':reason');
      const ids = (entry.plan.alternatives || []).map((alternative) => alternative.id);
      if (!Array.isArray(blocker.alternatives) || blocker.alternatives.length < 1) badBlockers.push(entry.professionId + ':no-alt');
      else if (blocker.alternatives.some((id) => ids.indexOf(id) < 0)) badBlockers.push(entry.professionId + ':dangling-alt');
    });
  });
  check('C05 blocker 可读且指向真实替代', badBlockers.length === 0, badBlockers.slice(0, 4).join(','));
  const badAlternatives = [];
  matrix.forEach((entry) => {
    const alternatives = entry.plan.alternatives || [];
    if (alternatives.length < 3) badAlternatives.push(entry.professionId + ':count-' + alternatives.length);
    const kinds = [];
    alternatives.forEach((alternative) => {
      if (routePlanner.ALTERNATIVE_KINDS.indexOf(alternative.kind) < 0) badAlternatives.push(entry.professionId + ':kind');
      if (kinds.indexOf(alternative.kind) < 0) kinds.push(alternative.kind);
    });
    if (kinds.length < 3) badAlternatives.push(entry.professionId + ':kinds-' + kinds.length);
  });
  check('C06 每个计划至少 3 类替代路线', badAlternatives.length === 0, badAlternatives.slice(0, 4).join(','));
  const originEcho = matrix.filter((entry) => entry.plan.originGameId !== entry.originGameId);
  check('C07 起点回显正确', originEcho.length === 0);
  const standardMode = matrix.filter((entry) => entry.plan.mode !== 'standard' || entry.plan.level !== 1);
  check('C08 空进度默认学徒/标准路线', standardMode.length === 0);
  const determinism = matrix.filter((entry) => JSON.stringify(entry.plan) !== JSON.stringify(routePlan(realPlanner, entry.originGameId, entry.professionId)));
  check('C09 16×16 计划确定性', determinism.length === 0, determinism.slice(0, 3).map((entry) => entry.professionId).join(','));
  const badExplain = [];
  matrix.forEach((entry) => {
    const explained = realPlanner.explain(entry.plan);
    if (!explained.ok || !explained.lines.length) badExplain.push(entry.professionId + ':explain');
  });
  check('C10 每个计划都可 explain', badExplain.length === 0, badExplain.slice(0, 4).join(','));
  const marketing = [];
  matrix.forEach((entry) => {
    allPlanStrings(entry.plan).forEach((text) => {
      const hits = marketingHits(text);
      if (hits.length) marketing.push(entry.professionId + ':' + hits.join('|'));
    });
    const explained = realPlanner.explain(entry.plan);
    const hits = marketingHits(explained.text);
    if (hits.length) marketing.push(entry.professionId + ':explain-' + hits.join('|'));
  });
  check('C11 计划/解释无系统营销词', marketing.length === 0, marketing.slice(0, 4).join(','));
  const singleGame = [];
  matrix.forEach((entry) => {
    (entry.plan.blockers || []).forEach((blocker) => {
      if (blocker.kind !== 'chapter-gate' && blocker.kind !== 'chapter-gate-pending') return;
      const games = evidenceGames(blocker);
      if (games.length > 0 && games.length < 2) singleGame.push(entry.professionId + ':' + games.join(','));
    });
  });
  check('C12 证据缺口候选不锁死在单一游戏', singleGame.length === 0, singleGame.slice(0, 4).join(','));
  const combat = matrix.filter((entry) => entry.professionId === 'adventure.pilot');
  check('C13 战斗职业计划有免费租机', combat.length > 0 && combat.every((entry) => entry.plan.steps.some((step) => step.kind === 'rental')));
  const nonCombat = matrix.filter((entry) => entry.professionId !== 'adventure.pilot');
  check('C14 非战斗职业不混入租机步骤', nonCombat.every((entry) => !entry.plan.steps.some((step) => step.kind === 'rental')));
  const incomplete = matrix.filter((entry) => entry.plan.complete === true);
  check('C15 空进度计划不谎报已完成', incomplete.length === 0);
  const workloadBad = matrix.filter((entry) => {
    const workload = entry.plan.workload;
    return (
      !workload ||
      workload.commissions !== commissionSteps(entry.plan).length ||
      workload.required > entry.plan.steps.length ||
      ['light', 'moderate', 'heavy'].indexOf(workload.effort) < 0
    );
  });
  check('C16 工作量与步骤数一致', workloadBad.length === 0, workloadBad.slice(0, 3).map((entry) => entry.professionId).join(','));
  const timeHits = [];
  matrix.forEach((entry) => {
    allPlanStrings(entry.plan).forEach((text) => {
      const hits = timeWordHits(text);
      if (hits.length) timeHits.push(entry.professionId + ':' + hits.join('|'));
    });
  });
  check('C17 计划不猜测精确时间', timeHits.length === 0, timeHits.slice(0, 4).join(','));
}

/* ---------------------------------------------------------------- D 起源 */

{
  check('D01 真实起源覆盖全部游戏', REAL_ORIGINS.length === REAL_GAMES.length);
  const originReasons = [];
  const badOrigin = [];
  REAL_ORIGINS.forEach((originGameId) => {
    const plan = routePlan(realPlanner, originGameId, 'engineering.structural');
    const story = plan.steps.find((step) => step.kind === 'story');
    if (!plan.ok || !story) badOrigin.push(originGameId);
    const origin = CHAPTER.origins.find((entry) => entry.gameId === originGameId);
    if (!origin || !story || story.reason.indexOf(origin.firstStep) < 0) badOrigin.push(originGameId + ':reason');
    else originReasons.push(story.reason);
  });
  check('D02 16 个起点都能排出第一步', badOrigin.length === 0, badOrigin.slice(0, 4).join(','));
  const uniqueReasons = Array.from(new Set(originReasons));
  check('D03 不同起点的开场白不同', uniqueReasons.length === REAL_ORIGINS.length, String(uniqueReasons.length));
  const unknownOrigin = routePlan(realPlanner, 'not-a-game', 'engineering.structural');
  check('D04 未知起点结构化失败', unknownOrigin.ok === false && unknownOrigin.reason === 'unknown-origin' && unknownOrigin.blockers.length === 1);
  const unknownProfession = routePlan(realPlanner, 'memory-flip', 'not.a-profession');
  check('D05 未知职业结构化失败', unknownProfession.ok === false && unknownProfession.reason === 'unknown-profession');
  const missingOrigin = routePlan(realPlanner, '', 'engineering.structural');
  check('D06 缺起点结构化失败', missingOrigin.ok === false && missingOrigin.reason === 'unknown-origin');
  const oddInputs = [null, 42, 'x', [], { originGameId: 7, professionId: null }];
  const oddOk = oddInputs.every((input) => {
    try {
      const result = realPlanner.plan(input);
      return result && result.ok === false;
    } catch (err) {
      return false;
    }
  });
  check('D07 坏输入不抛异常', oddOk);
  const baselineIds = commissionSteps(routePlan(realPlanner, 'memory-flip', 'engineering.structural')).map((step) => step.commissionId);
  const otherOriginIds = commissionSteps(routePlan(realPlanner, 'gold-miner', 'engineering.structural')).map((step) => step.commissionId);
  eq('D08 换起点不改变职业委托顺序', otherOriginIds, baselineIds);
  const originNames = REAL_ORIGINS.map((originGameId) => routePlan(realPlanner, originGameId, 'engineering.structural').originName);
  check('D09 起点显示名来自 registry', originNames.every((name) => typeof name === 'string' && name && name !== 'undefined'));
  const sameCountry = routePlan(realPlanner, 'pendulum-tower', 'engineering.structural');
  check('D10 起点与职业同源可用', sameCountry.ok === true && sameCountry.gameId === 'pendulum-tower');
}

/* ---------------------------------------------------------------- E 战斗与免费租机 */

{
  const combat = routePlan(realPlanner, 'memory-flip', 'adventure.pilot');
  const rentalIndex = combat.steps.findIndex((step) => step.kind === 'rental');
  const firstCommissionIndex = combat.steps.findIndex((step) => step.kind === 'commission');
  check('E01 战斗职业无自有船时先租机', rentalIndex >= 0 && firstCommissionIndex > rentalIndex);
  const rental = combat.steps.find((step) => step.kind === 'rental');
  check('E02 租机免费且来自内容', rental && rental.cost === 0 && rental.shipId === 'old-wing');
  check('E03 租机文案说明失败不丢机', rental && /不丢机/.test(rental.reason) && /维修债/.test(rental.reason));
  const owned = routePlan(realPlanner, 'memory-flip', 'adventure.pilot', {
    wallet: { credits: 0, items: {}, equipment: { 'ship:old-wing:owned': true } },
  });
  check('E04 已有机时不重复租机', !owned.steps.some((step) => step.kind === 'rental'));
  const equipped = routePlan(realPlanner, 'memory-flip', 'adventure.pilot', {
    wallet: { credits: 0, items: {}, equipment: { equippedShip: 'cloud-lark' } },
  });
  check('E05 出征机登记即视为有机', !equipped.steps.some((step) => step.kind === 'rental'));
  check('E06 战斗职业替代路线含租机', combat.alternatives.some((alternative) => alternative.kind === 'rental'));
  const nonCombat = routePlan(realPlanner, 'memory-flip', 'engineering.structural');
  check('E07 非战斗职业不需要租机', !nonCombat.steps.some((step) => step.kind === 'rental') && !nonCombat.alternatives.some((alternative) => alternative.kind === 'rental'));
  const paidRequired = combat.steps.filter((step) => !step.optional && typeof step.cost === 'number' && step.cost > 0);
  check('E08 不买机也能完成必需步骤', paidRequired.length === 0);
  check('E09 战斗计划含全部前三阶', ['star-raid.T1', 'star-raid.T2', 'star-raid.T3'].every((id) => commissionSteps(combat).some((step) => step.commissionId === id)));
  const failureText = combat.steps.map((step) => step.reason || '').join(' ');
  check('E10 战斗失败有戏内兜底文案', /失手|失败|不丢/.test(failureText) || /失手/.test(rental.reason));
}

/* ---------------------------------------------------------------- F 材料/信用点/工作量 */

{
  const pendulum = routePlan(realPlanner, 'memory-flip', 'engineering.structural');
  checkEq('F01 材料目录来自 items', pendulum.supplies.materials.length, 5);
  const byId = new Map(pendulum.supplies.materials.map((material) => [material.itemId, material]));
  check('F02 本职业工单覆盖建材', byId.get('building').covered === true && byId.get('building').fromProfession.length > 0);
  eq('F03 其余四材形成缺口', pendulum.supplies.gaps, ['alloy', 'biomass', 'electronics', 'starcrystal']);
  const market = pendulum.steps.find((step) => step.kind === 'market');
  check('F04 材料缺口有商店补齐步骤', market && market.optional === true);
  check('F05 商店步骤费用来自固定价', market && market.cost === 300 && market.items && market.items.alloy === 1 && market.items.biomass === 1 && market.items.electronics === 1 && market.items.starcrystal === 1);
  check('F06 无钱时商店步骤标注信用点缺口', market && market.missing.some((entry) => entry.kind === 'credits' && entry.need === 300));
  const rich = routePlan(realPlanner, 'memory-flip', 'engineering.structural', { wallet: { credits: 300, items: {} } });
  const richMarket = rich.steps.find((step) => step.kind === 'market');
  check('F07 钱够时商店步骤无缺口', richMarket && richMarket.missing.length === 0);
  const trade = pendulum.alternatives.find((alternative) => alternative.kind === 'trade');
  check('F08 贸易替代路线写明材料与价格', trade && trade.cost === 300 && Object.keys(trade.items).length === 4);
  const combat = routePlan(realPlanner, 'memory-flip', 'adventure.pilot');
  check('F09 星海职位工单覆盖星晶', new Map(combat.supplies.materials.map((material) => [material.itemId, material])).get('starcrystal').covered === true);
  checkEq('F10 星海商店缺口费用', combat.supplies.marketCost, 245);
  const aliasWallet = routePlan(realPlanner, 'memory-flip', 'engineering.structural', { wallet: { credits: 0, items: { crystal: 2 } } });
  const starcrystal = new Map(aliasWallet.supplies.materials.map((material) => [material.itemId, material])).get('starcrystal');
  check('F11 crystal 库存按别名归一到星晶', starcrystal && starcrystal.held === 2);
  check('F12 每样缺口材料都有市场价与替代来源', pendulum.supplies.materials.filter((material) => material.needsAlternative).every((material) => material.market.buyPrice > 0 && material.fromOtherGames.length > 0));
  const otherGameSources = new Set();
  pendulum.supplies.materials.forEach((material) => {
    material.fromOtherGames.forEach((source) => otherGameSources.add(source.gameId));
  });
  check('F13 其他游戏来源不锁死单一 gameId', otherGameSources.size >= 2, String(otherGameSources.size));
  const work = pendulum.alternatives.find((alternative) => alternative.kind === 'work');
  check('F14 工作替代路线的工钱来自内容', work && work.creditsPerRun === 90);
  check('F15 工作替代写明大致趟数', work && work.workload && work.workload.runs === 4);
  const star = routePlan(realPlanner, 'memory-flip', 'adventure.pilot');
  const union = new Map();
  [pendulum, star].forEach((plan) => {
    plan.supplies.materials.forEach((material) => {
      if (material.covered) union.set(material.itemId, true);
    });
  });
  check('F16 只玩层塔+星海仍有两材直接来源', union.has('building') && union.has('starcrystal'));
  check('F17 剩余三材都能靠商店', pendulum.supplies.materials.filter((material) => !union.has(material.itemId)).every((material) => material.market.buyPrice > 0));
  const itemMaterials = new Map(ITEMS.materials.map((material) => [material.itemId, material]));
  check('F18 商店价格逐项等于 items.json', pendulum.supplies.materials.every((material) => material.market.buyPrice === itemMaterials.get(material.itemId).buyPrice));
}

/* ---------------------------------------------------------------- G C2–C4 剧情门槛 */

{
  const empty = routePlan(realPlanner, 'memory-flip', 'engineering.structural');
  const gate = empty.blockers[0];
  check('G01 空进度在第四阶给出章节 blocker', gate && gate.kind === 'chapter-gate' && gate.flag === 'C3.truth_found' && gate.commissionId === 'pendulum-tower.T4');
  check('G02 blocker 缺口归因到记录份数', gate && gate.missing.some((entry) => entry.kind === 'evidence' && entry.class === 'E' && entry.need >= 1));
  const research = empty.alternatives.find((alternative) => alternative.kind === 'research');
  check('G03 研究替代路线跨多个游戏', research && routeGames(research).length >= 2, research ? JSON.stringify(routeGames(research)) : 'no-research');
  const ownGame = 'pendulum-tower';
  check('G04 研究替代路线不只指向本职业游戏', research && routeGames(research).some((gameId) => gameId !== ownGame));

  const starClaims = ['star-raid.T1', 'star-raid.T2', 'star-raid.T3'].map((id) => claimOf(id));
  const starOnly = routePlan(realPlanner, 'star-raid', 'adventure.pilot', { claims: starClaims });
  check('G05 单游戏证据不足以解锁 C2', starOnly.blockers.some((blocker) => blocker.flag === 'C3.truth_found'));
  check('G06 单游戏计划不谎报完成', starOnly.complete === false && !commissionSteps(starOnly).some((step) => step.commissionId === 'star-raid.T4'));

  const researchClaims = ['memory-flip.T2', 'merge-2048.T3', 'gravity-flip.T3'].map((id) => claimOf(id));
  const researchPlan = routePlan(realPlanner, 'memory-flip', 'engineering.structural', { claims: researchClaims });
  check('G07 研究证据路线解锁 C2–C4', ['C2.research_complete', 'C3.truth_found', 'C4.city_power_restored'].every((flag) => researchPlan.flags.unlocked.indexOf(flag) >= 0));
  check('G08 研究证据路线排到 T5', commissionSteps(researchPlan).some((step) => step.commissionId === 'pendulum-tower.T5'));
  check('G09 研究证据路线停在 C5 外部门槛', researchPlan.blockers.some((blocker) => blocker.kind === 'chapter-gate-pending' && /C5\./.test(blocker.flag || '')));

  const engineeringClaims = ['solitaire.T3', 'mole-whack.T3', 'block-drop.T3', 'road-rush.T3', 'pendulum-tower.T1'].map((id) => claimOf(id));
  const engineeringPlan = routePlan(realPlanner, 'snowbells', 'engineering.structural', { claims: engineeringClaims });
  check('G10 工程证据路线解锁 C2–C4', ['C2.research_complete', 'C3.truth_found', 'C4.city_power_restored'].every((flag) => engineeringPlan.flags.unlocked.indexOf(flag) >= 0));
  check('G11 工程证据路线排到 T5', commissionSteps(engineeringPlan).some((step) => step.commissionId === 'pendulum-tower.T5'));

  const tradeClaims = ['blackjack.T3', 'gomoku.T2', 'solitaire.T3', 'memory-flip.T2', 'snowbells.T3'].map((id) => claimOf(id));
  const tradePlan = routePlan(realPlanner, 'star-raid', 'engineering.structural', { claims: tradeClaims });
  check('G12 非战斗证据路线解锁 C2–C4', ['C2.research_complete', 'C3.truth_found', 'C4.city_power_restored'].every((flag) => tradePlan.flags.unlocked.indexOf(flag) >= 0));

  const fullChain = routePlan(realPlanner, 'memory-flip', 'engineering.structural', {
    claims: researchClaims,
    flags: ['C5.star_tower_resolved'],
  });
  check('G13 单职业 + 受控剧情旗标可规划完整主链', fullChain.complete === true && commissionSteps(fullChain).length === 6);
  check('G14 完整主链按 T1..T6 排序', commissionSteps(fullChain).map((step) => step.tier).join(',') === '1,2,3,4,5,6');
  const seeded = routePlan(realPlanner, 'memory-flip', 'adventure.pilot', {
    flags: ['C2.research_complete', 'C3.truth_found', 'C4.city_power_restored', 'C5.star_tower_resolved'],
  });
  check('G15 受控剧情旗标可直接解锁 6 阶', seeded.complete === true && seeded.steps.filter((step) => step.kind === 'commission').length === 6);
  check('G16 受控剧情旗标计划无 blocker', seeded.blockers.length === 0);
  const gatedExplain = realPlanner.explain(empty);
  check('G17 blocker 解释出现记录缺口', /现场记录/.test(gatedExplain.text) && /暂时排不上/.test(gatedExplain.text));
  check('G18 解释不泄露内部旗标名', !/C[2-5]\./.test(gatedExplain.text) && !/E-|MAP-|BP-|DEC-/.test(gatedExplain.text));
}

/* ---------------------------------------------------------------- H 无资金 / 单游戏 / 先接哪单 */

{
  const noMoney = routePlan(realPlanner, 'memory-flip', 'engineering.structural');
  const firstCommission = noMoney.steps.find((step) => step.kind === 'commission');
  check('H01 无资金先接本职业第一阶', firstCommission && firstCommission.commissionId === 'pendulum-tower.T1');
  check('H02 第一阶前没有付费步骤', noMoney.steps.slice(0, noMoney.steps.indexOf(firstCommission)).every((step) => !step.cost));
  check('H03 商店步骤排在必需步骤之后且可跳过', noMoney.steps[noMoney.steps.length - 1].kind === 'market' && noMoney.steps[noMoney.steps.length - 1].optional === true);
  const work = noMoney.alternatives.find((alternative) => alternative.kind === 'work');
  check('H04 无资金时有明码工单替代', work && work.creditsPerRun > 0 && work.missing.some((entry) => entry.kind === 'credits'));
  const trade = noMoney.alternatives.find((alternative) => alternative.kind === 'trade');
  check('H05 无资金时材料缺口有商店替代', trade && trade.cost > 0 && trade.missing.some((entry) => entry.kind === 'credits'));
  const alternative = noMoney.alternatives.find((entry) => entry.kind === 'alternative');
  check('H06 代办路线存在且明码', alternative && alternative.id === 'alt:offer:alt.records' && alternative.cost === 90);
  const offers = noMoney.alternatives.filter((entry) => entry.kind === 'alternative').map((entry) => entry.id);
  check('H07 两档代办都可达', offers.indexOf('alt:offer:alt.courier') >= 0 && offers.indexOf('alt:offer:alt.records') >= 0);
  const starOnly = routePlan(realPlanner, 'star-raid', 'adventure.pilot');
  check('H08 单游戏玩家不锁死：仍有 3+ 替代路线', starOnly.alternatives.length >= 3 && new Set(starOnly.alternatives.map((entry) => entry.kind)).size >= 3);
  const pensionIds = new Set(starOnly.alternatives.find((entry) => entry.kind === 'research').routes.map((route) => route.gameId));
  check('H09 单游戏玩家的研究替代跨多款游戏', pensionIds.size >= 2);
  check('H10 无资金不阻塞第一阶', starOnly.steps.some((step) => step.kind === 'commission' && step.commissionId === 'star-raid.T1'));
}

/* ---------------------------------------------------------------- I 确定性 / 隔离 / 输入不可变 */

{
  const wallet = { credits: 42, items: { alloy: 1 } };
  const quests = [questOf('pendulum-tower.T1')];
  const claims = [claimOf('memory-flip.T2')];
  const flags = ['C1.signal'];
  const planOnce = routePlan(realPlanner, 'memory-flip', 'engineering.structural', { wallet, quests, claims, flags });
  const planTwice = routePlan(realPlanner, 'memory-flip', 'engineering.structural', { wallet, quests, claims, flags });
  eq('I01 同输入重复计划完全一致', planTwice, planOnce);
  const snapshot = JSON.stringify({ wallet, quests, claims, flags });
  routePlan(realPlanner, 'memory-flip', 'engineering.structural', { wallet, quests, claims, flags });
  check('I02 plan 不修改调用方输入', snapshot === JSON.stringify({ wallet, quests, claims, flags }));
  const frozenWallet = deepFreeze(clone(wallet));
  const frozenQuests = deepFreeze(clone(quests));
  const frozenClaims = deepFreeze(clone(claims));
  const frozenFlags = deepFreeze(clone(flags));
  let frozenOk = false;
  try {
    frozenOk = routePlan(realPlanner, 'memory-flip', 'engineering.structural', {
      wallet: frozenWallet,
      quests: frozenQuests,
      claims: frozenClaims,
      flags: frozenFlags,
    }).ok === true;
  } catch (err) {
    frozenOk = false;
  }
  check('I03 冻结输入可安全规划', frozenOk);
  const other = routePlanner.create();
  const otherConfig = other.configure({
    commissions: COMMISSIONS_CONTENT,
    items: ITEMS,
    chapter: CHAPTER,
    registry: REGISTRY,
    materials: materialsModule,
    evidence: newEvidence().evidence,
    alternatives: { offers: OFFERS },
  });
  eq('I04 不同实例同内容同结果', routePlan(other, 'memory-flip', 'engineering.structural'), routePlan(realPlanner, 'memory-flip', 'engineering.structural'));
  check('I04b 第二个实例配置成功', otherConfig.ok === true);
  const isolated = routePlanner.create();
  isolated.configure({ commissions: [REAL[0]] });
  check('I05 实例隔离：配置一个不影响另一个', realPlanner.status().commissionCount === REAL.length && isolated.status().commissionCount === 1);
  const resetPlanner = routePlanner.create();
  resetPlanner.configure({ commissions: REAL, items: ITEMS, chapter: CHAPTER, registry: REGISTRY });
  const resetResult = resetPlanner.reset();
  check('I06 reset 清空内容', resetResult.ok === true && resetPlanner.isConfigured() === false);
  check('I07 reset 后 plan 结构化失败', resetPlanner.plan({ originGameId: 'memory-flip', professionId: 'engineering.structural' }).ok === false);
  check('I08 reset 后可重新 configure', resetPlanner.configure({ commissions: REAL, items: ITEMS, chapter: CHAPTER, registry: REGISTRY }).ok === true);
  const reordered = routePlan(realPlanner, 'memory-flip', 'engineering.structural', {
    claims: [claimOf('pendulum-tower.T1'), claimOf('memory-flip.T2')],
  });
  const reordered2 = routePlan(realPlanner, 'memory-flip', 'engineering.structural', {
    claims: [claimOf('memory-flip.T2'), claimOf('pendulum-tower.T1')],
  });
  eq('I09 claims 顺序不影响结果', reordered2, reordered);
  const explainA = realPlanner.explain(planOnce);
  const explainB = realPlanner.explain(planOnce);
  eq('I10 explain 确定性', explainB, explainA);
  const contentSnapshot = JSON.stringify(COMMISSIONS_CONTENT) + JSON.stringify(CHAPTER) + JSON.stringify(ITEMS);
  fullMatrix(realPlanner);
  realPlanner.validate();
  check('I11 矩阵与 validate 不修改内容', contentSnapshot === JSON.stringify(COMMISSIONS_CONTENT) + JSON.stringify(CHAPTER) + JSON.stringify(ITEMS));
}

/* ---------------------------------------------------------------- J 坏内容 / 边界 */

{
  const fresh = routePlanner.create();
  const badTier = fresh.configure({
    commissions: [{ commissionId: 'bad.T1', gameId: 'bad', professionId: 'bad.prof', tier: 99, title: 'x' }],
  });
  check('J01 坏 tier 结构化失败', badTier.ok === false && badTier.errors.some((error) => /bad-tier/.test(error)));
  const badId = fresh.configure({
    commissions: [{ commissionId: 'bad id', gameId: 'bad', professionId: 'bad.prof', tier: 1 }],
  });
  check('J02 坏 commissionId 结构化失败', badId.ok === false && badId.errors.some((error) => /bad-commissionId/.test(error)));
  const duplicate = fresh.configure({
    commissions: [
      { commissionId: 'dup.T1', gameId: 'dup', professionId: 'dup.prof', tier: 1 },
      { commissionId: 'dup.T1', gameId: 'dup', professionId: 'dup.prof', tier: 2 },
    ],
  });
  check('J03 重复 commissionId 结构化失败', duplicate.ok === false && duplicate.errors.some((error) => /duplicate/.test(error)));
  const badGame = fresh.configure({
    commissions: [{ commissionId: 'badgame.T1', gameId: 'Bad Game', professionId: 'bad.prof', tier: 1 }],
  });
  check('J04 坏 gameId 结构化失败', badGame.ok === false && badGame.errors.some((error) => /bad-gameId/.test(error)));

  const keep = routePlanner.create();
  const good = keep.configure({ commissions: REAL, items: ITEMS, chapter: CHAPTER, registry: REGISTRY });
  const failed = keep.configure({ commissions: [], items: ITEMS });
  check('J05 坏 configure 返回失败且不清空旧内容', good.ok === true && failed.ok === false && keep.status().commissionCount === REAL.length);
  check('J06 坏 configure 后旧路线仍可用', routePlan(keep, 'memory-flip', 'engineering.structural').ok === true);
  const badUnlock = routePlanner.create().configure({
    commissions: [{ commissionId: 'u.T1', gameId: 'u-game', professionId: 'u.prof', tier: 1, unlock: { all: 'nope' } }],
  });
  check('J07 坏 unlock 只告警不抛异常', badUnlock.ok === true && badUnlock.warnings.some((warning) => /unlock-all/.test(warning)));
  const badItems = routePlanner.create().configure({
    commissions: REAL,
    items: { materials: [{ itemId: 'building', buyPrice: 'x' }], ships: [], modules: [] },
    chapter: CHAPTER,
    registry: REGISTRY,
  });
  check('J08 坏 items 结构化容错', badItems.ok === true && badItems.materialCount === 0 && badItems.warnings.some((warning) => /material/.test(warning)));
  const badChapter = routePlanner.create().configure({ commissions: REAL, items: ITEMS, chapter: { origins: [null, { gameId: 'Bad Game' }] }, registry: REGISTRY });
  check('J09 坏章节结构化容错', badChapter.ok === true && badChapter.originCount === REAL_GAMES.length);
  const badEvidence = routePlanner.create().configure({ commissions: REAL, items: ITEMS, chapter: CHAPTER, evidence: { storyFlags: 1 } });
  check('J10 坏证据模块结构化容错', badEvidence.ok === true && badEvidence.warnings.some((warning) => /evidence-invalid/.test(warning)));
  const badOffers = routePlanner.create().configure({ commissions: REAL, items: ITEMS, chapter: CHAPTER, alternatives: [{ offerId: 'bad id' }] });
  check('J11 坏代办内容结构化容错', badOffers.ok === true && badOffers.offerCount === 0);

  const notConfigured = routePlanner.create();
  check('J12 未配置 plan 结构化失败', notConfigured.plan({ originGameId: 'memory-flip', professionId: 'engineering.structural' }).ok === false);
  check('J13 未配置 validate 结构化失败', notConfigured.validate().ok === false && notConfigured.validate().checksTotal === 1);
  check('J14 未配置 explain 结构化失败', notConfigured.explain({ ok: false }).ok === false);
  const malformed = [];
  [
    { wallet: 'nope', quests: 'bad', claims: 5, flags: 7 },
    { wallet: { credits: -5, items: { alloy: -2 } }, quests: [null, 1], claims: 'x', flags: { bad: true } },
    { wallet: { wallet: { credits: 10 } }, quests: { byNode: { a: { nodeId: 'pendulum-tower.T1', status: 'cleared' } } } },
  ].forEach((extra) => {
    try {
      const result = routePlan(realPlanner, 'memory-flip', 'engineering.structural', extra);
      if (!result || typeof result.ok !== 'boolean') malformed.push('shape');
    } catch (err) {
      malformed.push('throw');
    }
  });
  check('J15 坏钱包/任务/收据/旗标不抛异常', malformed.length === 0, malformed.join(','));
  check('J16 未来内容不改变真实内容快照', JSON.stringify(REAL) === JSON.stringify(COMMISSIONS_CONTENT.commissions));
}

/* ---------------------------------------------------------------- K 未来第 17 游戏 / 职业插拔 */

function buildFutureBundle() {
  const commissions = clone(REAL);
  const gates = { 4: 'C3.truth_found', 5: 'C4.city_power_restored', 6: 'C5.star_tower_resolved' };
  function addProfession(gameId, professionId, idPrefix, gamePlan) {
    const ids = [];
    for (let tier = 1; tier <= 6; tier += 1) {
      const id = idPrefix + '.T' + tier;
      ids.push(id);
      const reward = { credits: tier === 1 ? 70 : 0, items: {}, evidence: [], flags: [] };
      if (tier === 2) reward.evidence = ['E-' + id];
      if (tier === 3) reward.evidence = ['BP-' + id];
      if (tier === 6) reward.evidence = ['DEC-' + id];
      const unlock = { all: [] };
      if (tier > 1) unlock.all.push({ commissionCleared: ids[tier - 2] });
      if (tier >= 4) unlock.all.push({ chapterFlag: gates[tier] });
      commissions.push({
        commissionId: id,
        gameId: gamePlan ? gamePlan[tier - 1] : gameId,
        professionId,
        tier,
        title: idPrefix + ' · 工单 ' + tier,
        summary: '未来内容插拔测试',
        issuer: '测试',
        objective: { kind: 'pair.match', atLeast: tier },
        objectiveBonus: 0,
        startParams: {},
        reward,
        repeatSalaryCredits: 75,
        unlock,
        chapterGate: tier >= 4 ? gates[tier] : null,
        risk: 'low',
        durationHint: '约 2–5 分钟',
      });
    }
    return ids;
  }
  addProfession('virtual-observatory', 'science.astronomer', 'virtual-observatory.ast', null);
  addProfession('virtual-observatory', 'service.guide', 'virtual-observatory.guide', null);
  addProfession('coffee-shop', 'commerce.trader', 'coffee-shop.trade', null);
  /* 一职业跨两款游戏：前 3 阶在 coffee-shop，后 3 阶在 virtual-observatory。 */
  addProfession('virtual-observatory', 'commerce.broker', 'coffee-shop.broker', [
    'coffee-shop',
    'coffee-shop',
    'coffee-shop',
    'virtual-observatory',
    'virtual-observatory',
    'virtual-observatory',
  ]);
  const chapter = clone(CHAPTER);
  chapter.origins.push(
    {
      gameId: 'virtual-observatory',
      professionId: 'science.astronomer',
      opening: '镜片里有一枚新的刻痕。',
      c0Letter: { from: '观测台值班员', body: '新的刻痕', address: '折光港北环 · 观测台' },
      firstStep: '去告示板看看有没有观测台的活。',
    },
    {
      gameId: 'coffee-shop',
      professionId: 'commerce.trader',
      opening: '杯底的纹路像一张旧地图。',
      c0Letter: { from: '咖啡店老板', body: '一张旧地图', address: '折光港东堤 · 咖啡店' },
      firstStep: '去告示板问问咖啡店缺不缺人。',
    }
  );
  const registry = clone(REGISTRY);
  registry.games.push(
    { gameId: 'virtual-observatory', displayName: '虚拟观测台', professions: ['science.astronomer', 'service.guide'], capabilities: [], watch: [] },
    { gameId: 'coffee-shop', displayName: '咖啡店', professions: ['commerce.trader', 'commerce.broker'], capabilities: [], watch: [] }
  );
  registry.professions.push(
    { professionId: 'science.astronomer', displayName: '天文研究员', domain: 'science', capabilities: [] },
    { professionId: 'service.guide', displayName: '讲解员', domain: 'service', capabilities: [] },
    { professionId: 'commerce.trader', displayName: '贸易商', domain: 'commerce', capabilities: [] },
    { professionId: 'commerce.broker', displayName: '中间商', domain: 'commerce', capabilities: [] }
  );
  const commissionsContent = { contentVersion: '0.18.0', commissions };
  const evidence = storyEvidence.createStoryEvidence({});
  const evidenceConfig = evidence.configure({ commissions: commissionsContent, chapter, items: ITEMS });
  const planner = routePlanner.create();
  const config = planner.configure({
    commissions: commissionsContent,
    items: ITEMS,
    chapter,
    registry,
    materials: materialsModule,
    evidence,
    alternatives: { offers: OFFERS },
  });
  return { commissions, chapter, registry, commissionsContent, evidence, evidenceConfig, planner, config };
}

const future = buildFutureBundle();
{
  check('K01 未来内容 configure ok', future.config.ok === true, JSON.stringify(future.config).slice(0, 240));
  checkEq('K02 第 17 游戏与新增职业计数', future.config.gameCount, REAL_GAMES.length + 2);
  checkEq('K03 新增职业计数', future.config.professionCount, REAL_PROFESSIONS.length + 4);
  checkEq('K04 委托总数随内容扩展', future.config.commissionCount, REAL.length + 24);
  check('K05 未来证据模块 ok', future.evidenceConfig.ok === true);

  const astro = routePlan(future.planner, 'coffee-shop', 'science.astronomer');
  check('K06 新职业可规划', astro.ok === true && astro.gameId === 'virtual-observatory');
  check('K07 新职业用自己的委托 ID', commissionSteps(astro).some((step) => step.commissionId === 'virtual-observatory.ast.T1'));
  check('K08 新职业第一阶不受旧职业影响', commissionSteps(astro).every((step) => step.gameId === 'virtual-observatory'));
  check('K09 单游戏 E+BP 证据在计划内解锁 T4', commissionSteps(astro).some((step) => step.commissionId === 'virtual-observatory.ast.T4'));

  const guide = routePlan(future.planner, 'virtual-observatory', 'service.guide');
  check('K10 同游戏两个职业互不串单', guide.ok === true && commissionSteps(guide).every((step) => step.gameId === 'virtual-observatory') && commissionSteps(guide)[0].commissionId === 'virtual-observatory.guide.T1');

  const broker = routePlan(future.planner, 'coffee-shop', 'commerce.broker');
  const brokerGames = Array.from(new Set(commissionSteps(broker).map((step) => step.gameId))).sort();
  eq('K11 一职业跨两款游戏的路线', brokerGames, ['coffee-shop', 'virtual-observatory']);
  const brokerFull = routePlan(future.planner, 'coffee-shop', 'commerce.broker', {
    flags: ['C2.research_complete', 'C3.truth_found', 'C4.city_power_restored', 'C5.star_tower_resolved'],
  });
  check('K12 跨游戏职业覆盖 6 阶', brokerFull.complete === true && commissionSteps(brokerFull).length === 6);
  check('K13 新起源的开场白进入路线', routePlan(future.planner, 'virtual-observatory', 'science.astronomer').steps[0].reason.indexOf('去告示板看看有没有观测台的活') >= 0);
  eq('K14 旧职业在扩展内容下不变', commissionSteps(routePlan(future.planner, 'memory-flip', 'engineering.structural')).map((step) => step.commissionId), commissionSteps(routePlan(realPlanner, 'memory-flip', 'engineering.structural')).map((step) => step.commissionId));
  const futureValidate = future.planner.validate();
  check('K15 未来内容 validate ok', futureValidate.ok === true, JSON.stringify(futureValidate.errors).slice(0, 240));
  checkEq('K16 未来矩阵按内容量扩展', futureValidate.planMatrix.total, 18 * 20);
  checkEq('K17 未来矩阵全部可规划', futureValidate.planMatrix.ok, futureValidate.planMatrix.total);
  check('K18 未硬编码首季数量', future.planner.status().professionCount === REAL_PROFESSIONS.length + 4 && future.planner.status().gameCount === REAL_GAMES.length + 2);
  const realUnchanged = routePlan(realPlanner, 'memory-flip', 'engineering.structural');
  check('K19 扩展内容不污染真实 planner', realUnchanged.gameId === 'pendulum-tower' && realPlanner.status().commissionCount === REAL.length);
}

/* ---------------------------------------------------------------- M 强化路线（只改顺序） */

{
  const standard = routePlan(realPlanner, 'memory-flip', 'adventure.pilot', { level: 1 });
  const reinforced = routePlan(realPlanner, 'memory-flip', 'adventure.pilot', { level: 3 });
  checkEq('M01 高等级进入熟路模式', reinforced.mode, 'reinforced');
  checkEq('M02 低等级保持标准模式', standard.mode, 'standard');
  check('M03 熟路更短：不重读开场信', reinforced.steps.length === standard.steps.length - 1 && !reinforced.steps.some((step) => step.kind === 'story'));
  eq(
    'M04 熟路不改变职业委托顺序与数量',
    commissionSteps(reinforced).map((step) => step.commissionId),
    commissionSteps(standard).map((step) => step.commissionId)
  );
  const standardAlts = new Map(standard.alternatives.map((alternative) => [alternative.id, alternative]));
  const reinforcedAlts = new Map(reinforced.alternatives.map((alternative) => [alternative.id, alternative]));
  eq('M05 熟路替代路线集合不变', Array.from(reinforcedAlts.keys()).sort(), Array.from(standardAlts.keys()).sort());
  check('M06 熟路只换替代路线顺序', JSON.stringify(reinforced.alternatives.map((alternative) => alternative.id)) !== JSON.stringify(standard.alternatives.map((alternative) => alternative.id)));
  const numericBad = [];
  standardAlts.forEach((alternative, id) => {
    const other = reinforcedAlts.get(id);
    if (!other) numericBad.push(id + ':missing');
    else if (JSON.stringify(alternative.cost) !== JSON.stringify(other.cost) || alternative.creditsPerRun !== other.creditsPerRun) {
      numericBad.push(id + ':value');
    }
  });
  check('M07 熟路不改任何价格/工钱数值', numericBad.length === 0, numericBad.join(','));
  eq('M08 熟路与标准路线的工作量口径一致', reinforced.workload.plannedCredits, standard.workload.plannedCredits);
  const veteranClaims = ['star-raid.T1', 'star-raid.T2', 'star-raid.T3'].map((id) => claimOf(id));
  const derived = routePlan(realPlanner, 'memory-flip', 'adventure.pilot', { claims: veteranClaims });
  check('M09 3 条已交差自动升为熟练', derived.level === 2 && derived.levelSource === 'progress' && derived.mode === 'reinforced');
  const expertClaims = ['star-raid.T1', 'star-raid.T2', 'star-raid.T3', 'star-raid.T4', 'star-raid.T5', 'star-raid.T6'].map((id) => claimOf(id));
  const expert = routePlan(realPlanner, 'memory-flip', 'adventure.pilot', { claims: expertClaims });
  check('M10 6 条已交差升为专家', expert.level === 3 && expert.levelId === 'expert');

  /* 同阶两张独立工单：熟路先挑工钱高的，只换顺序。 */
  const dualCommissions = [
    { commissionId: 'dual-game.alpha.T1', gameId: 'dual-game', professionId: 'dual.prof', tier: 1, title: '阿尔法工单', reward: { credits: 70, items: {}, evidence: [], flags: [] }, repeatSalaryCredits: 60, unlock: { all: [] } },
    { commissionId: 'dual-game.beta.T1', gameId: 'dual-game', professionId: 'dual.prof', tier: 1, title: '贝塔工单', reward: { credits: 70, items: {}, evidence: [], flags: [] }, repeatSalaryCredits: 100, unlock: { all: [] } },
  ];
  const dual = routePlanner.create();
  const dualConfig = dual.configure({ commissions: dualCommissions, items: ITEMS });
  check('M11 同阶双工单内容可配置', dualConfig.ok === true);
  const dualStandard = routePlan(dual, 'dual-game', 'dual.prof', { level: 1 });
  const dualReinforced = routePlan(dual, 'dual-game', 'dual.prof', { level: 3 });
  eq('M12 标准路线按稳定 ID 排序', commissionSteps(dualStandard).map((step) => step.commissionId), ['dual-game.alpha.T1', 'dual-game.beta.T1']);
  eq('M13 熟路先挑工钱高的熟单', commissionSteps(dualReinforced).map((step) => step.commissionId), ['dual-game.beta.T1', 'dual-game.alpha.T1']);
  eq('M14 同阶双工单金额不变', [dualStandard.workload.plannedCredits, dualReinforced.workload.plannedCredits], [140, 140]);
}

/* ---------------------------------------------------------------- L validate / explain / 输出契约 */

{
  const report = realPlanner.validate();
  check('L01 真实内容 validate ok', report.ok === true, JSON.stringify(report.errors).slice(0, 240));
  check('L02 validate 检查全过', report.checksPassed === report.checksTotal && report.checksTotal >= 18, JSON.stringify(report.errors).slice(0, 240));
  checkEq('L03 矩阵覆盖 16×16', report.planMatrix.total, REAL_ORIGINS.length * REAL_PROFESSIONS.length);
  checkEq('L04 矩阵全部 ok', report.planMatrix.ok, report.planMatrix.total);
  check('L05 每个职业至少 3 条替代路线', report.planMatrix.alternativeMin >= 3, String(report.planMatrix.alternativeMin));
  check('L06 validate 无错误', report.errors.length === 0);
  check('L07 validate 读出全部起源/职业', report.origins.length === REAL_ORIGINS.length && report.professions.length === REAL_PROFESSIONS.length);
  const expectedChecks = [
    'configured', 'commission-shape', 'unlock-references', 'origin-coverage', 'material-market',
    'combat-rental', 'plan-matrix', 'plan-steps', 'plan-alternatives', 'plan-blockers',
    'plan-determinism', 'explain-readable', 'explain-clean', 'plan-covered',
    'no-single-game-evidence', 'evidence-module', 'static-boundaries', 'no-economy-surface',
    'no-hardcoded-counts',
  ];
  const checkMap = new Map(report.checks.map((entry) => [entry.id, entry]));
  check('L08 validate 含关键检查项', expectedChecks.every((id) => checkMap.has(id)), expectedChecks.filter((id) => !checkMap.has(id)).join(','));
  eq('L09 validate 确定性', realPlanner.validate(), report);
  check('L10 validate 不改变配置', realPlanner.status().commissionCount === REAL.length);

  const sample = routePlan(realPlanner, 'memory-flip', 'adventure.pilot');
  eqKeys('L11 plan 顶层键集合冻结', sample, [
    'ok', 'reason', 'complete', 'originGameId', 'originName', 'originFirstStep', 'professionId', 'professionName',
    'professionDomain', 'gameId', 'gameDisplayName', 'level', 'levelId', 'levelName', 'levelSource', 'mode',
    'steps', 'blockers', 'alternatives', 'supplies', 'flags', 'cleared', 'workload', 'summaryText', 'contentVersion',
  ]);
  const stepsOk = sample.steps.every((step) => ['kind', 'id', 'title', 'reason', 'optional', 'missing', 'order'].every((key) => Object.prototype.hasOwnProperty.call(step, key)));
  check('L12 步骤公共键齐备', stepsOk);
  const alternativeOk = sample.alternatives.every((alternative) => ['id', 'kind', 'title', 'reason', 'missing', 'workload', 'target'].every((key) => Object.prototype.hasOwnProperty.call(alternative, key)));
  check('L13 替代路线公共键齐备', alternativeOk);
  check('L14 blocker 键齐备', sample.blockers.every((blocker) => ['kind', 'id', 'title', 'reason', 'missing', 'alternatives'].every((key) => Object.prototype.hasOwnProperty.call(blocker, key))));
  const explained = realPlanner.explain(sample);
  eqKeys('L15 explain 输出形状', explained, ['ok', 'title', 'lines', 'steps', 'blockers', 'alternatives', 'summary', 'text']);
  check('L16 explain 行数与步骤一致', explained.steps.length === sample.steps.length);
  check('L17 explain summary 等于计划摘要', explained.summary === sample.summaryText);
  const explainedTexts = [];
  fullMatrix(realPlanner).forEach((entry) => {
    explainedTexts.push(realPlanner.explain(entry.plan).text);
  });
  check('L18 全部解释无营销词', explainedTexts.every((text) => marketingHits(text).length === 0));
  check('L19 全部解释无精确时间', explainedTexts.every((text) => timeWordHits(text).length === 0));
  check('L20 explain 对失败计划结构化返回', realPlanner.explain({ ok: false }).ok === false && realPlanner.explain(null).ok === false);
  const contentOnly = makeContentOnlyPlanner();
  const contentOnlyValidate = contentOnly.planner.validate();
  check('L21 bridge 内容-only 路径 validate ok', contentOnlyValidate.ok === true && contentOnlyValidate.warnings.indexOf('evidence-not-injected') >= 0, JSON.stringify(contentOnlyValidate.errors).slice(0, 200));
  const contentOnlyPlan = routePlan(contentOnly.planner, 'memory-flip', 'engineering.structural');
  check('L22 bridge 内容-only 路径仍能排出前三阶', contentOnlyPlan.ok === true && commissionSteps(contentOnlyPlan).length === 3 && contentOnlyPlan.blockers.length === 1);
  check('L23 bridge 内容-only 路径 blocker 可解释', contentOnlyPlan.blockers[0].kind === 'chapter-gate-pending' && contentOnlyPlan.blockers[0].missing.length > 0);
}

/* ---------------------------------------------------------------- 汇总 */

let failed = 0;
for (const item of results) {
  if (item.ok) {
    console.log('PASS  ' + item.name);
  } else {
    failed += 1;
    console.log('FAIL  ' + item.name + (item.detail ? ' — ' + item.detail : ''));
  }
}
console.log('');
console.log(`${results.length - failed}/${results.length} checks passed`);
if (failed > 0) {
  console.error(`FAILED: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('PASS  career route planner contract test');
process.exit(0);
