#!/usr/bin/env node
/**
 * Arcade Life 0.17 经济量表 / 难度回归 / 数值标定门禁（D17-25）
 *
 * 纯 Node（零 npm 依赖、不启动 Chrome、不写仓库文件），只读取真实内容与真实模块：
 * - content/commissions.json（96 委托）、content/items.json（五材/飞船/模块）、content/registry.json、
 *   content/chapter-01.json；
 * - career-core.js（RULESET / rewardPlan / purchasePlan）、materials.js、crafting.js、professions.js、
 *   story-evidence.js、route-planner.js、commission-schema.js；
 * - commission-core.js / bridge.js / career-db.js / ui/hangar.js 只做静态边界核对。
 *
 * 覆盖（对应 D17-25 acceptance）：
 * 1. 不同技能画像（新手 0.55 / 中级 0.75 / 高级 0.9，时长 1–4 分钟）的每委托收入/分钟区间；
 *    “2–3 份有效委托可买旧翼 260”的逐项核实。
 * 2. 收入函数 clamp(baseByMission + objectiveBonus + masteryBonus, 0, payoutCap) 与
 *    repeatSalaryCredits 的关系：96 条首通工钱 / 材料 / 证据 / 重复薪资；单局上限与总规模；
 *    首通奖励不得成为唯一收入来源；失败/极短局不得先于目标判定发钱。
 * 3. 五材买卖差、模块制造成本、飞船价格：卖价 ≤ 买价 × 0.6、无拆解/无 equipment→credits 循环、
 *    购买后余额非负、上限/幂等。
 * 4. 失败 / 极短局 / 多开：minValidEngagement 语义（当前内容缺省=0、运行时未消费）、atLeast/minValue
 *    目标检查、重复薪资固定不随事件数增长、并发无全局冷却的风险量化。
 * 5. 每游戏 T1–T6 的工钱 / 材料 / 证据 / 重复薪资模型输出（--tables 时逐条打印，供文档表格）。
 *
 * 运行：node tools/career_economy_balance_test.mjs [--tables]
 * 退出码：0 全部 PASS；1 有 FAIL；2 装配失败（文件/模块读取失败、真实内容无法配置、参数错误）。
 *
 * 口径（写死的是假设，不是结果）：
 * - 完成局收入/分钟 = 重复薪资 / 时长；区间取任务卡假设的 1–4 分钟；
 * - 画像期望/分钟 = p × 完成局收入/分钟（失败局 0 收入且同样消耗时长）；
 * - 首次完成收入 = reward.credits（材料按卖价另计“变现价值”，证据/旗标不计钱）；
 * - 内容 durationHint 当前为 2–5 分钟，仅作参考；本门禁按任务卡 1–4 分钟口径计算并标注 UNVERIFIED。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const CAREER = path.join(REPO_ROOT, 'apps', 'arcade', 'career');
const CONTENT = path.join(CAREER, 'content');

const FILES = {
  commissions: path.join(CONTENT, 'commissions.json'),
  items: path.join(CONTENT, 'items.json'),
  registry: path.join(CONTENT, 'registry.json'),
  chapter: path.join(CONTENT, 'chapter-01.json'),
  core: path.join(CAREER, 'career-core.js'),
  commissionCore: path.join(CAREER, 'commission-core.js'),
  careerDb: path.join(CAREER, 'career-db.js'),
  materials: path.join(CAREER, 'materials.js'),
  crafting: path.join(CAREER, 'crafting.js'),
  professions: path.join(CAREER, 'professions.js'),
  storyEvidence: path.join(CAREER, 'story-evidence.js'),
  routePlanner: path.join(CAREER, 'route-planner.js'),
  registryJs: path.join(CAREER, 'registry.js'),
  schema: path.join(CAREER, 'commission-schema.js'),
  bridge: path.join(CAREER, 'bridge.js'),
  hangar: path.join(CAREER, 'ui', 'hangar.js'),
  market: path.join(CAREER, 'ui', 'market.js'),
};

function readOrExit(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.error('ENV: 无法读取 ' + path.relative(REPO_ROOT, file) + ' — ' + err.message);
    process.exit(2);
  }
}

function parseOrExit(file, label) {
  const text = readOrExit(file);
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error('ENV: ' + label + ' JSON 解析失败 — ' + err.message);
    process.exit(2);
  }
}

const TABLES = process.argv.includes('--tables');
const UNKNOWN_ARGS = process.argv.slice(2).filter((arg) => arg !== '--tables');
if (UNKNOWN_ARGS.length) {
  console.error('ENV: 未知参数 ' + UNKNOWN_ARGS.join(' ') + '（只接受 --tables）');
  process.exit(2);
}

const REAL_ITEMS = parseOrExit(FILES.items, 'items.json');
const REAL_COMMISSIONS = parseOrExit(FILES.commissions, 'commissions.json');
const REAL_REGISTRY = parseOrExit(FILES.registry, 'registry.json');
const REAL_CHAPTER = parseOrExit(FILES.chapter, 'chapter-01.json');
const SOURCE = {};
for (const [key, file] of Object.entries(FILES)) {
  if (key.startsWith('commissions') || key === 'items' || key === 'registry' || key === 'chapter') continue;
  SOURCE[key] = readOrExit(file);
}

let core;
let materials;
let crafting;
let professions;
let storyEvidence;
let routePlanner;
let schema;
try {
  core = require(FILES.core);
  materials = require(FILES.materials);
  crafting = require(FILES.crafting);
  professions = require(FILES.professions);
  storyEvidence = require(FILES.storyEvidence);
  routePlanner = require(FILES.routePlanner);
  schema = require(FILES.schema);
} catch (err) {
  console.error('ENV: 无法 require 0.17 经济模块 — ' + (err && err.message ? err.message : err));
  process.exit(2);
}

const RULESET = core.RULESET;
const INITIAL_CREDITS = RULESET.initialCredits;
const PAYOUT_CAP = RULESET.payoutCap;
const BALANCE_CAP = RULESET.balanceCap;

/* ------------------------------------------------------------------ *
 * 断言与运行器
 * ------------------------------------------------------------------ */

let total = 0;
let failed = 0;

async function check(name, fn) {
  total += 1;
  try {
    const detail = await fn();
    console.log('PASS  ' + name + (detail ? ' — ' + detail : ''));
  } catch (err) {
    failed += 1;
    console.log('FAIL  ' + name + ' — ' + (err && err.message ? err.message : String(err)));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function eq(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error((label ? label + ': ' : '') + 'expected ' + right + ' got ' + left);
}

function near(actual, expected, epsilon, label) {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error((label ? label + ': ' : '') + 'expected ~' + expected + ' got ' + actual);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function fmt(value) {
  if (!Number.isFinite(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

function rng(low, high) {
  return fmt(low) + '–' + fmt(high);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/* ------------------------------------------------------------------ *
 * 真实内容模型（全部从内容派生，不硬编码 96 条结果）
 * ------------------------------------------------------------------ */

const COMMISSIONS = REAL_COMMISSIONS.commissions;
const COMMISSION_BY_ID = new Map(COMMISSIONS.map((entry) => [entry.commissionId, entry]));
const TIERS = [1, 2, 3, 4, 5, 6];
const GAME_IDS = (REAL_REGISTRY.games || []).map((game) => game.gameId);
const SHIPS = REAL_ITEMS.ships || [];
const MODULES = REAL_ITEMS.modules || [];
const MATERIALS = REAL_ITEMS.materials || [];
const MATERIAL_IDS = MATERIALS.map((entry) => entry.itemId);
const MATERIAL_BY_ID = new Map(MATERIALS.map((entry) => [entry.itemId, entry]));

const PROFILES = [
  { id: 'novice', name: '新手', success: 0.55 },
  { id: 'mid', name: '中级', success: 0.75 },
  { id: 'expert', name: '高级', success: 0.9 },
];
const DURATION_MIN = 1;
const DURATION_MAX = 4;
const DURATION_MID = 2.5; // 内容 hint「约 2–5 分钟」的中位；用于 wall-clock 估算，UNVERIFIED

const T13 = COMMISSIONS.filter((entry) => entry.tier <= 3);

/* 真实内容必须能被 materials / crafting 配置成功，否则退出码 2（装配失败）。 */
const MATERIALS_BASELINE = materials.configure({ items: REAL_ITEMS, commissions: REAL_COMMISSIONS });
if (!MATERIALS_BASELINE.ok) {
  console.error('ENV: 真实内容在 materials.configure 下失败 — ' + JSON.stringify(MATERIALS_BASELINE));
  process.exit(2);
}
const CRAFTING_BASELINE = crafting.configure({ items: REAL_ITEMS });
if (!CRAFTING_BASELINE.ok) {
  console.error('ENV: 真实内容在 crafting.configure 下失败 — ' + JSON.stringify(CRAFTING_BASELINE));
  process.exit(2);
}

/* 事件摘要：只按内容声明的 objective 造“刚好达标”的真实事件（不写死金额）。 */
function objectivePayload(override) {
  return override && typeof override === 'object' ? override : {};
}

function digestEvents(commission, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const objective = commission.objective;
  const payload = {};
  if (objective.context && typeof objective.context === 'object') {
    for (const key of Object.keys(objective.context)) payload[key] = objective.context[key];
  }
  if (objective.minValue) payload[objective.minValue.field] = objective.minValue.value;
  if (opts.payload) Object.assign(payload, opts.payload);
  const count = opts.count === undefined ? Math.max(1, Math.floor(objective.atLeast)) : opts.count;
  const out = [];
  for (let i = 0; i < count; i += 1) out.push({ kind: objective.kind, payload: clone(payload) });
  return out;
}

function overkillEvents(commission, multiplier) {
  const base = digestEvents(commission, { count: commission.objective.atLeast });
  const out = [];
  for (let i = 0; i < multiplier; i += 1) {
    for (const event of base) out.push({ kind: event.kind, payload: clone(event.payload) });
  }
  return out;
}

function firstPlan(commission, eventList) {
  return core.rewardPlan(commission, eventList || digestEvents(commission), {
    mode: 'commission',
    gameId: commission.gameId,
  });
}

function repeatPlan(commission, eventList) {
  return core.rewardPlan(commission, eventList || digestEvents(commission), {
    mode: 'commission',
    gameId: commission.gameId,
    repeat: true,
  });
}

function itemSellValue(items) {
  let value = 0;
  if (!items || typeof items !== 'object') return value;
  for (const itemId of Object.keys(items)) {
    const entry = MATERIAL_BY_ID.get(itemId);
    if (!entry) continue;
    value += Number(items[itemId]) * Number(entry.sellPrice);
  }
  return value;
}

function itemBuyValue(items) {
  let value = 0;
  if (!items || typeof items !== 'object') return value;
  for (const itemId of Object.keys(items)) {
    const entry = MATERIAL_BY_ID.get(itemId);
    if (!entry) continue;
    value += Number(items[itemId]) * Number(entry.buyPrice);
  }
  return value;
}

function materialCostOfRequires(requires) {
  let totalCost = 0;
  if (!requires || typeof requires !== 'object') return totalCost;
  for (const rawId of Object.keys(requires)) {
    const canonical = materials.normalizeItemId(rawId);
    assert(canonical, '未知的飞船材料键: ' + rawId);
    const price = materials.priceOf(canonical, 'buy');
    assert(Number.isFinite(price), '材料缺少买价: ' + canonical);
    totalCost += Number(requires[rawId]) * price;
  }
  return totalCost;
}

function tierCommissions(tier) {
  return COMMISSIONS.filter((entry) => entry.tier === tier);
}

const TIER_STATS = TIERS.map((tier) => {
  const list = tierCommissions(tier);
  return {
    tier,
    count: list.length,
    firstCredits: list.reduce((sum, entry) => sum + firstPlan(entry).credits, 0),
    repeatCredits: list.reduce((sum, entry) => sum + repeatPlan(entry).credits, 0),
    evidence: list.reduce((sum, entry) => sum + entry.reward.evidence.length, 0),
    items: list.reduce((sum, entry) => sum + Object.values(entry.reward.items || {}).reduce((a, b) => a + b, 0), 0),
  };
});

const TOTAL_FIRST_CREDITS = TIER_STATS.reduce((sum, row) => sum + row.firstCredits, 0);
const TOTAL_REPEAT_CREDITS = TIER_STATS.reduce((sum, row) => sum + row.repeatCredits, 0);
const TOTAL_EVIDENCE = TIER_STATS.reduce((sum, row) => sum + row.evidence, 0);
const REPEAT_SALARIES = COMMISSIONS.map((entry) => Number(entry.repeatSalaryCredits));
const MIN_REPEAT = Math.min(...REPEAT_SALARIES);
const MAX_REPEAT = Math.max(...REPEAT_SALARIES);
const MIN_FIRST = Math.min(...COMMISSIONS.map((entry) => Number(entry.reward.credits)));
const MAX_FIRST = Math.max(...COMMISSIONS.map((entry) => Number(entry.reward.credits)));

/* 一次性首通奖励的“可变现”上限（材料按卖价折现；证据/旗标不计钱）。 */
const FIRST_LIQUIDATION = COMMISSIONS.reduce(
  (sum, entry) => sum + firstPlan(entry).credits + itemSellValue(firstPlan(entry).items),
  0
);

/* 全部内容沉没成本（四船 + 15 层模块 + 飞船材料；不包含可选的重复制造/重复购买）。 */
const SHIP_TOTAL = SHIPS.reduce((sum, ship) => sum + Number(ship.price || 0), 0);
const SHIP_MATERIAL_TOTAL = SHIPS.reduce((sum, ship) => sum + materialCostOfRequires(ship.requires), 0);
const MODULE_TOTAL = MODULES.reduce(
  (sum, mod) => sum + mod.levels.reduce((levelSum, level) => levelSum + Number(level.cost || 0), 0),
  0
);
const MODULE_LEVEL_COUNT = MODULES.reduce((sum, mod) => sum + mod.levels.length, 0);
const SINK_TOTAL = SHIP_TOTAL + SHIP_MATERIAL_TOTAL + MODULE_TOTAL;

/* 旧翼 260：穷举 2/3 份 T1 有效组合（首次 + 已清委托的重复薪资）；
 * 2 局的可达上界另用「同游戏 T1→T2」乐观链核对（T2 解锁要求同游戏 T1 先清）。 */
function runSequenceAmounts(length) {
  const t1 = COMMISSIONS.filter((entry) => entry.tier === 1);
  const amounts = [];
  function walk(depth, sum, clearedGames, clearedIds) {
    if (depth === length) {
      amounts.push(sum);
      return;
    }
    for (const entry of t1) {
      if (clearedGames.has(entry.gameId)) continue;
      const nextGames = new Set(clearedGames);
      nextGames.add(entry.gameId);
      const nextIds = new Set(clearedIds);
      nextIds.add(entry.commissionId);
      walk(depth + 1, sum + Number(entry.reward.credits), nextGames, nextIds);
    }
    for (const commissionId of clearedIds) {
      const entry = COMMISSION_BY_ID.get(commissionId);
      walk(depth + 1, sum + Number(entry.repeatSalaryCredits), clearedGames, clearedIds);
    }
  }
  walk(0, 0, new Set(), new Set());
  return amounts;
}

const RUN2_AMOUNTS = runSequenceAmounts(2);
const RUN3_AMOUNTS = runSequenceAmounts(3);
const BEST2 = Math.max(...RUN2_AMOUNTS);
const MIN3 = Math.min(...RUN3_AMOUNTS);
const BEST3 = Math.max(...RUN3_AMOUNTS);
const OLD_WING = SHIPS.find((ship) => ship.shipId === 'old-wing') || SHIPS[0];
const T1_FIRST_SORTED = COMMISSIONS.filter((entry) => entry.tier === 1)
  .map((entry) => Number(entry.reward.credits))
  .sort((a, b) => a - b);

/* 画像收入：完成局（成功时）与含失败期望（每次尝试 p 概率成功）。 */
function rateRows() {
  return T13.map((entry) => {
    const salary = Number(entry.repeatSalaryCredits);
    const completionLow = salary / DURATION_MAX;
    const completionHigh = salary / DURATION_MIN;
    const expected = {};
    for (const profile of PROFILES) {
      expected[profile.id] = {
        low: (profile.success * salary) / DURATION_MAX,
        high: (profile.success * salary) / DURATION_MIN,
      };
    }
    const first = firstPlan(entry);
    return {
      commissionId: entry.commissionId,
      tier: entry.tier,
      gameId: entry.gameId,
      firstCredits: first.credits,
      firstMaterialSell: itemSellValue(first.items),
      salary,
      completionLow,
      completionHigh,
      expected,
    };
  });
}

const RATE_ROWS = rateRows();

function tierRateSummary(profileId) {
  return [1, 2, 3].map((tier) => {
    const rows = RATE_ROWS.filter((row) => row.tier === tier);
    const expected = rows.map((row) => row.expected[profileId]);
    const completionLow = Math.min(...rows.map((row) => row.completionLow));
    const completionHigh = Math.max(...rows.map((row) => row.completionHigh));
    const expectedLow = Math.min(...expected.map((value) => value.low));
    const expectedHigh = Math.max(...expected.map((value) => value.high));
    return { tier, completionLow, completionHigh, expectedLow, expectedHigh };
  });
}

/* 资产可达：用 T1 最低重复薪资（保守）按 2.5 分钟中位局 + 画像成功率折算 wall-clock。 */
const T1_REPEAT_MIN = Math.min(...COMMISSIONS.filter((entry) => entry.tier === 1).map((entry) => Number(entry.repeatSalaryCredits)));

function affordabilityTargets() {
  const targets = [];
  for (const ship of SHIPS) {
    const materialCost = materialCostOfRequires(ship.requires);
    targets.push({ id: ship.shipId, name: ship.name, credits: Number(ship.price), materialCost, total: Number(ship.price) + materialCost });
  }
  const hull = MODULES.find((mod) => mod.moduleId === 'hull');
  if (hull) {
    const level1 = hull.levels[0];
    const materialCost = itemBuyValue(level1);
    targets.push({ id: 'hull.L1', name: '船体加固 L1', credits: Number(level1.cost), materialCost, total: Number(level1.cost) + materialCost });
  }
  return targets;
}

const AFFORDABILITY = affordabilityTargets();
function wallClockMinutes(totalCost) {
  const runs = Math.max(0, Math.ceil((totalCost - INITIAL_CREDITS) / T1_REPEAT_MIN));
  const out = {};
  for (const profile of PROFILES) out[profile.id] = (runs * DURATION_MID) / profile.success;
  return { runs, minutes: out };
}

/* ------------------------------------------------------------------ *
 * A. 内容与奖励函数
 * ------------------------------------------------------------------ */

await check('A01 真实内容与资产规模可读（96 委托 / 16 游戏 / 五材 / 四船 / 七模块 / 15 层）', () => {
  eq(COMMISSIONS.length, 96, 'commissions');
  eq(GAME_IDS.length, 16, 'registry games');
  eq(MATERIALS.length, 5, 'materials');
  eq(SHIPS.length, 4, 'ships');
  eq(MODULES.length, 7, 'modules');
  eq(MODULE_LEVEL_COUNT, 15, 'module levels');
  eq(REAL_ITEMS.contentVersion, REAL_COMMISSIONS.contentVersion, 'contentVersion');
  return '96/16/5/4/7/15 contentVersion=' + REAL_ITEMS.contentVersion;
});

await check('A02 委托内容 schema 校验（commission-schema，真实事件目录）', () => {
  const result = schema.validateCommissionContent(REAL_COMMISSIONS);
  assert(result.ok === true, 'schema errors: ' + JSON.stringify(result.errors));
  eq(result.counts.total, 96, 'counts.total');
  eq(result.counts.games, 16, 'counts.games');
  return 'errors=0 warnings=' + result.warnings.length + '（跨章遗留 token 告警属已知 OBS）';
});

await check('A03 96 条=tier×game 完整网格、ID 唯一、objective.kind 在真实事件目录', () => {
  const ids = new Set();
  const kinds = new Set(schema.EVENT_KINDS);
  for (const entry of COMMISSIONS) {
    assert(!ids.has(entry.commissionId), 'duplicate commissionId ' + entry.commissionId);
    ids.add(entry.commissionId);
    assert(GAME_IDS.indexOf(entry.gameId) >= 0, 'unknown gameId ' + entry.gameId);
    assert(kinds.has(entry.objective.kind), 'unknown objective.kind ' + entry.objective.kind);
    assert(Number.isInteger(entry.objective.atLeast) && entry.objective.atLeast >= 1, 'bad atLeast ' + entry.commissionId);
  }
  for (const gameId of GAME_IDS) {
    const tiers = COMMISSIONS.filter((entry) => entry.gameId === gameId).map((entry) => entry.tier).sort((a, b) => a - b);
    eq(tiers, TIERS, gameId + ' tiers');
  }
  return '16 游戏 × 6 阶全部在位；事件 kind 全部来自真实目录（' + schema.EVENT_KINDS.length + ' 种）';
});

await check('A04 96 条工钱/薪资均为合法整数且不超过 payoutCap', () => {
  for (const entry of COMMISSIONS) {
    assert(Number.isInteger(entry.reward.credits) && entry.reward.credits >= 0 && entry.reward.credits <= PAYOUT_CAP, 'bad credits ' + entry.commissionId);
    assert(Number.isInteger(entry.repeatSalaryCredits) && entry.repeatSalaryCredits > 0 && entry.repeatSalaryCredits <= PAYOUT_CAP, 'bad salary ' + entry.commissionId);
    assert(entry.objectiveBonus === 0, 'objectiveBonus 应为 0: ' + entry.commissionId);
  }
  return '首通 ' + MIN_FIRST + '–' + MAX_FIRST + ' / 重复 ' + MIN_REPEAT + '–' + MAX_REPEAT + '，payoutCap=' + PAYOUT_CAP;
});

await check('A05 首通奖励逐条等于内容（credits/items/evidence/flags）并通过 rewardPlan', () => {
  for (const entry of COMMISSIONS) {
    const plan = firstPlan(entry);
    assert(plan.ok === true, 'first plan failed ' + entry.commissionId + ' ' + plan.reason);
    eq(plan.credits, entry.reward.credits, 'credits ' + entry.commissionId);
    eq(plan.items, entry.reward.items, 'items ' + entry.commissionId);
    eq(plan.evidence, entry.reward.evidence, 'evidence ' + entry.commissionId);
    eq(plan.flags, entry.reward.flags || [], 'flags ' + entry.commissionId);
  }
  return '96/96 首通计划与内容一致（clamp 后无溢出）';
});

await check('A06 重复薪资逐条等于内容，且不重复发首通材料/证据/旗标', () => {
  for (const entry of COMMISSIONS) {
    const plan = repeatPlan(entry);
    assert(plan.ok === true, 'repeat plan failed ' + entry.commissionId + ' ' + plan.reason);
    eq(plan.credits, entry.repeatSalaryCredits, 'repeat credits ' + entry.commissionId);
    eq(plan.items, {}, 'repeat items ' + entry.commissionId);
    eq(plan.evidence, [], 'repeat evidence ' + entry.commissionId);
    eq(plan.flags, [], 'repeat flags ' + entry.commissionId);
  }
  return '96/96 重复局只发固定薪资（' + MIN_REPEAT + '–' + MAX_REPEAT + '），零材料/证据';
});

await check('A07 收入函数 clamp(base + objectiveBonus + masteryBonus, 0, payoutCap) 兜底', () => {
  const sample = clone(COMMISSION_BY_ID.get('pendulum-tower.T1'));
  const events = digestEvents(sample);
  sample.reward = sample.reward || {};
  sample.reward.credits = 999;
  eq(core.rewardPlan(sample, events, { mode: 'commission' }).credits, PAYOUT_CAP, 'credits 999');
  sample.reward.credits = -5;
  eq(core.rewardPlan(sample, events, { mode: 'commission' }).credits, 0, 'credits -5');
  sample.reward.credits = 70;
  sample.objectiveBonus = 500;
  eq(core.rewardPlan(sample, events, { mode: 'commission' }).credits, PAYOUT_CAP, 'objectiveBonus 500');
  sample.objectiveBonus = 0;
  sample.repeatSalaryCredits = 999;
  eq(core.rewardPlan(sample, events, { mode: 'commission', repeat: true }).credits, PAYOUT_CAP, 'repeat 999');
  sample.repeatSalaryCredits = -1;
  eq(core.rewardPlan(sample, events, { mode: 'commission', repeat: true }).credits, 0, 'repeat -1');
  return '上限/负值/超 bonus 均被 clamp；RULESET.payoutCap=' + PAYOUT_CAP;
});

await check('A08 mastery 加成档 0/10/20/30，重复局不叠加', () => {
  const sample = clone(COMMISSION_BY_ID.get('pendulum-tower.T1'));
  const events = digestEvents(sample);
  const base = sample.reward.credits;
  const bonus = RULESET.masteryBonusByRank;
  for (let rank = 0; rank < bonus.length; rank += 1) {
    eq(core.rewardPlan(sample, events, { mode: 'commission', mastery: rank }).credits, Math.min(PAYOUT_CAP, base + bonus[rank]), 'mastery ' + rank);
  }
  eq(core.rewardPlan(sample, events, { mode: 'commission', mastery: 99 }).credits, Math.min(PAYOUT_CAP, base + bonus[bonus.length - 1]), 'mastery clamp');
  eq(core.rewardPlan(sample, events, { mode: 'commission', repeat: true, mastery: 3 }).credits, sample.repeatSalaryCredits, 'repeat mastery ignored');
  return 'masteryBonusByRank=' + JSON.stringify(RULESET.masteryBonusByRank) + '（当前运行时未接线，见 A11）';
});

await check('A09 未达标/差 1 事件/minValue-1/context 不符均不发钱', () => {
  let empty = 0;
  let partial = 0;
  let valueMiss = 0;
  let contextMiss = 0;
  for (const entry of COMMISSIONS) {
    const options = { mode: 'commission', gameId: entry.gameId };
    const none = core.rewardPlan(entry, [], options);
    assert(none.ok === false && none.credits === undefined, 'empty digest paid ' + entry.commissionId);
    empty += 1;
    const objective = entry.objective;
    if (objective.atLeast > 1) {
      const partialPlan = core.rewardPlan(entry, digestEvents(entry, { count: objective.atLeast - 1 }), options);
      assert(partialPlan.ok === false, 'partial digest paid ' + entry.commissionId);
      partial += 1;
    } else if (objective.minValue) {
      const miss = core.rewardPlan(entry, digestEvents(entry, { payload: { [objective.minValue.field]: objective.minValue.value - 1 } }), options);
      assert(miss.ok === false && miss.reason === 'value-not-met', 'minValue miss paid ' + entry.commissionId);
      valueMiss += 1;
    } else if (objective.context && Object.keys(objective.context).length) {
      const key = Object.keys(objective.context)[0];
      const bad = {};
      bad[key] = String(objective.context[key]) + '-miss';
      const miss = core.rewardPlan(entry, digestEvents(entry, { payload: bad }), options);
      assert(miss.ok === false && miss.reason === 'context-mismatch', 'context miss paid ' + entry.commissionId);
      contextMiss += 1;
    }
  }
  return '空局 ' + empty + ' / 差 1 事件 ' + partial + ' / minValue-1 ' + valueMiss + ' / context 不符 ' + contextMiss + ' 全部 0 发放';
});

await check('A10 计算由内容驱动（改内容→总额变化，未硬编码 96 条结果）', () => {
  const mutated = clone(COMMISSIONS);
  const target = mutated.find((entry) => entry.tier === 1);
  target.reward.credits += 7;
  target.repeatSalaryCredits += 5;
  const mutatedFirst = mutated.reduce((sum, entry) => sum + firstPlan(entry).credits, 0);
  const mutatedRepeat = mutated.reduce((sum, entry) => sum + repeatPlan(entry).credits, 0);
  eq(mutatedFirst, TOTAL_FIRST_CREDITS + 7, 'mutated first total');
  eq(mutatedRepeat, TOTAL_REPEAT_CREDITS + 5, 'mutated repeat total');
  return '首通总额 ' + TOTAL_FIRST_CREDITS + '，重复总额 ' + TOTAL_REPEAT_CREDITS + '（改 1 条 → 精确 +7/+5）';
});

await check('A11 minValidEngagement / mastery 运行时休眠（内容 0 条声明、runtime 未消费）', () => {
  const declared = COMMISSIONS.filter((entry) => hasOwn(entry, 'minValidEngagement')).length;
  for (const name of ['core', 'commissionCore', 'bridge']) {
    assert(SOURCE[name].indexOf('minValidEngagement') < 0, name + ' 不应消费 minValidEngagement');
  }
  assert(SOURCE.registryJs.indexOf('minValidEngagement') >= 0, 'registry 应保留 minValidEngagement 语义');
  for (const name of ['commissionCore', 'bridge']) {
    assert(SOURCE[name].indexOf('mastery') < 0, name + ' 不应接 mastery（runtime 未用）');
  }
  return 'minValidEngagement 声明 ' + declared + '/96；registry 保留字段、commission-core/bridge 未消费；mastery 仅在 career-core（runtime 未传）';
});

/* ------------------------------------------------------------------ *
 * B. 96 单次奖励 vs 重复薪资 / 单局上限 / 总规模
 * ------------------------------------------------------------------ */

await check('B01 96 条首通 vs 重复薪资总额（重复是长期收入主力）', () => {
  assert(TOTAL_REPEAT_CREDITS > TOTAL_FIRST_CREDITS, 'repeat should exceed first total');
  const ratio = TOTAL_REPEAT_CREDITS / TOTAL_FIRST_CREDITS;
  return '首通合计 ' + TOTAL_FIRST_CREDITS + '，重复一轮合计 ' + TOTAL_REPEAT_CREDITS + '（×' + fmt(ratio) + '）；证据 ' + TOTAL_EVIDENCE;
});

await check('B02 首通奖励清空后仍买不下全部内容 → 必须靠重复薪资', () => {
  const gap = SINK_TOTAL - FIRST_LIQUIDATION;
  assert(gap > 0, 'first rewards should not cover all sinks');
  const repeatRuns = Math.ceil(gap / MAX_REPEAT);
  return '全部沉没 ' + SINK_TOTAL + '（船 ' + SHIP_TOTAL + ' + 船材 ' + SHIP_MATERIAL_TOTAL + ' + 模块 ' + MODULE_TOTAL + '）；首通变现上限 ' + FIRST_LIQUIDATION + '，缺口 ' + gap + '（≈' + repeatRuns + ' 趟重复局）';
});

await check('B03 单局最大信用点/最大变现价值远低于“一局几万”', () => {
  let maxCredits = 0;
  let maxRealized = 0;
  let maxId = '';
  for (const entry of COMMISSIONS) {
    const plan = firstPlan(entry);
    const realized = plan.credits + itemSellValue(plan.items);
    if (realized > maxRealized) {
      maxRealized = realized;
      maxId = entry.commissionId;
    }
    if (plan.credits > maxCredits) maxCredits = plan.credits;
  }
  assert(maxCredits <= PAYOUT_CAP, 'maxCredits ' + maxCredits);
  assert(maxRealized < 1000, 'maxRealized ' + maxRealized);
  assert(maxRealized < 10000, 'single run should never reach tens of thousands');
  return '单局最大信用点 ' + maxCredits + '（cap ' + PAYOUT_CAP + '）；含材料折现最大 ' + maxRealized + '（' + maxId + '）；< 1000';
});

await check('B04 每阶首通上限（T1–T6）与高难奖励不爆炸', () => {
  const rows = TIERS.map((tier) => {
    const list = tierCommissions(tier);
    const firsts = list.map((entry) => firstPlan(entry).credits);
    return { tier, min: Math.min(...firsts), max: Math.max(...firsts), sum: firsts.reduce((a, b) => a + b, 0) };
  });
  for (const row of rows) assert(row.max <= PAYOUT_CAP, 'tier ' + row.tier + ' max ' + row.max);
  return rows.map((row) => 'T' + row.tier + ' ' + row.min + '–' + row.max + '(Σ' + row.sum + ')').join(' / ');
});

await check('B05 首通 0 信用点的委托靠重复薪资接续（T6 全部 0）', () => {
  const zero = COMMISSIONS.filter((entry) => firstPlan(entry).credits === 0);
  assert(zero.length > 0, 'expected some zero-credit first clears');
  for (const entry of zero) assert(Number(entry.repeatSalaryCredits) > 0, 'zero-first commission without salary ' + entry.commissionId);
  const tier6 = tierCommissions(6);
  assert(tier6.every((entry) => firstPlan(entry).credits === 0), 'T6 first credits expected 0');
  return '首通 0 信用点 ' + zero.length + '/96（T6 ' + tier6.length + '/16 全部靠重复薪资 ' + MIN_REPEAT + '–' + MAX_REPEAT + '）';
});

await check('B06 全部内容经济体量 < balanceCap，不存在无限单局积累', () => {
  const onePass = TOTAL_FIRST_CREDITS + TOTAL_REPEAT_CREDITS;
  assert(onePass < BALANCE_CAP, 'one pass economy ' + onePass);
  assert(BALANCE_CAP === 1000000, 'balanceCap drift ' + BALANCE_CAP);
  return '首通+各重复 1 次=' + onePass + '；balanceCap=' + BALANCE_CAP + '；单局 cap=' + PAYOUT_CAP;
});

/* ------------------------------------------------------------------ *
 * C. 旧翼可达性 / 购买 / 制造 / 零套利
 * ------------------------------------------------------------------ */

await check('C01 旧翼 260：2 份有效委托最多 250（差 10），3 份最低 290（可达）', () => {
  const best2 = BEST2 + INITIAL_CREDITS;
  const min3 = MIN3 + INITIAL_CREDITS;
  const best3 = BEST3 + INITIAL_CREDITS;
  assert(best2 < OLD_WING.price, '2 runs should not afford old-wing: ' + best2);
  assert(min3 >= OLD_WING.price, '3 runs should afford old-wing: ' + min3);
  /* 2 局若走 T1→同游戏 T2，最多 90+0 或 70+85，仍低于两个 T1 首通的 170。 */
  const t1t2Best = Math.max(...GAME_IDS.map((gameId) => {
    const t1 = COMMISSIONS.find((entry) => entry.gameId === gameId && entry.tier === 1);
    const t2 = COMMISSIONS.find((entry) => entry.gameId === gameId && entry.tier === 2);
    return t1 && t2 ? Number(t1.reward.credits) + Number(t2.reward.credits) : 0;
  }));
  assert(BEST2 >= t1t2Best, 'two-run upper bound should be two T1 first clears');
  return '初始 ' + INITIAL_CREDITS + ' + 2 局最多 ' + BEST2 + '=' + best2 + '（差 ' + (OLD_WING.price - best2) + '）；' +
    '3 份 T1 最少 ' + MIN3 + '=' + min3 + '；3 局 ' + rng(min3, best3) + '；设计文案“2–3 份”实测为“3 份”' +
    '（2 局 T1→同游戏 T2 最多 ' + (t1t2Best + INITIAL_CREDITS) + '，仍低于 ' + (BEST2 + INITIAL_CREDITS) + '）';
});

await check('C02 典型 3×T1 路径可买旧翼（290→余 30），且旧翼免费租用', () => {
  const lowest3 = T1_FIRST_SORTED.slice(0, 3).reduce((a, b) => a + b, 0);
  const after = INITIAL_CREDITS + lowest3 - OLD_WING.price;
  assert(after >= 0, 'typical path short ' + after);
  assert(OLD_WING.rental === true, 'old-wing should be rentable');
  return '80+' + lowest3 + '=' + (INITIAL_CREDITS + lowest3) + ' → 买旧翼余 ' + after + '；rental=true（免费租机起步，不买船也能打）';
});

await check('C03 四飞船价格/材料门槛、购买后余额非负', () => {
  for (const ship of SHIPS) {
    const requires = ship.requires || {};
    const costItems = clone(requires);
    const inventory = {};
    for (const key of Object.keys(requires)) inventory[key] = requires[key];
    const exact = core.purchasePlan({
      cost: Number(ship.price),
      grants: { equipment: { ['ship:' + ship.shipId + ':owned']: true } },
      costItems,
      wallet: { credits: Number(ship.price), items: inventory },
    });
    assert(exact.ok === true, ship.shipId + ' exact purchase failed: ' + exact.reason);
    eq(exact.plan.balanceAfter, 0, ship.shipId + ' balanceAfter');
    const short = core.purchasePlan({
      cost: Number(ship.price),
      grants: { equipment: { ['ship:' + ship.shipId + ':owned']: true } },
      costItems,
      wallet: { credits: Number(ship.price) - 1, items: inventory },
    });
    assert(short.ok === false && short.reason === 'insufficient', ship.shipId + ' short should fail');
  }
  assert(SOURCE.careerDb.indexOf('sellEquipment') < 0, 'equipment 卖出路径不应存在');
  return '船价 ' + SHIPS.map((ship) => ship.name + ' ' + ship.price).join(' / ') + '；材料门槛 ' + JSON.stringify(SHIPS.map((ship) => ship.requires || {}));
});

await check('C04 棱镜遗留键 crystal：materials 可归一，但 DB/hangar 按原键扣库存（记录缺陷）', () => {
  const prism = SHIPS.find((ship) => ship.shipId === 'prism') || SHIPS[SHIPS.length - 1];
  const requires = prism.requires || {};
  const legacy = Object.keys(requires).filter((key) => materials.normalizeItemId(key) !== key);
  if (!legacy.length) return '无遗留材料键（内容已统一 canonical id）';
  const key = legacy[0];
  const canonical = materials.normalizeItemId(key);
  assert(canonical === 'starcrystal', 'expected crystal→starcrystal, got ' + canonical);
  const rawPlan = core.purchasePlan({
    cost: Number(prism.price),
    grants: { equipment: { 'ship:prism:owned': true } },
    costItems: clone(requires),
    wallet: { credits: Number(prism.price), items: { [key]: requires[key], alloy: requires.alloy || 0 } },
  });
  const canonicalPlan = core.purchasePlan({
    cost: Number(prism.price),
    grants: { equipment: { 'ship:prism:owned': true } },
    costItems: clone(requires),
    wallet: { credits: Number(prism.price), items: { [canonical]: requires[key], alloy: requires.alloy || 0 } },
  });
  assert(rawPlan.ok === true, 'raw legacy key purchase failed');
  assert(canonicalPlan.ok === false && canonicalPlan.reason === 'insufficient-items', 'canonical key should not satisfy legacy requirement');
  return 'DEFECT(非阻断)：prism.requires=' + JSON.stringify(requires) + '，新购星晶（' + canonical + '）不满足原键 ' + key + '；UI/DB 未做别名归一';
});

await check('C05 模块 15 层成本与内容逐条一致（总沉没 ' + MODULE_TOTAL + ' 信用点）', () => {
  const recipes = crafting.listRecipes();
  eq(recipes.length, MODULE_LEVEL_COUNT, 'recipe count');
  let credits = 0;
  for (const mod of MODULES) {
    for (const level of mod.levels) {
      const recipe = recipes.find((row) => row.moduleId === mod.moduleId && row.level === level.level);
      assert(recipe, 'missing recipe ' + mod.moduleId + ' L' + level.level);
      const costItems = {};
      for (const key of Object.keys(level)) {
        if (['level', 'cost', 'effect', 'stats', 'effectStats', 'name', 'note', 'description'].indexOf(key) >= 0) continue;
        if (Number.isInteger(level[key]) && level[key] > 0) costItems[key] = level[key];
      }
      eq(recipe.cost, level.cost, mod.moduleId + ' L' + level.level + ' cost');
      eq(recipe.costItems, costItems, mod.moduleId + ' L' + level.level + ' costItems');
      for (const itemId of Object.keys(costItems)) assert(MATERIAL_IDS.indexOf(itemId) >= 0, 'unknown material ' + itemId);
      credits += level.cost;
    }
  }
  eq(credits, MODULE_TOTAL, 'module total');
  return '7 模块 / 15 层全部等于 items.json；材料全部在白名单；总信用点 ' + MODULE_TOTAL;
});

await check('C06 制造幂等零成本 / 拒绝不足 / applyPlan 与 purchasePlan 对账', () => {
  const hull = MODULES.find((mod) => mod.moduleId === 'hull');
  const level1 = hull.levels[0];
  const wallet = { credits: 1000, items: { alloy: 1 } };
  const happy = crafting.plan({ moduleId: 'hull', level: 1, wallet });
  assert(happy.ok && happy.affordable === true, 'hull plan should be affordable');
  const applied = crafting.applyPlan({ plan: happy, careerId: 'career-balance-test-1' });
  assert(applied.ok === true, 'applyPlan failed ' + applied.reason);
  const purchase = core.purchasePlan({ cost: applied.cost, costItems: applied.costItems, grants: applied.grants, wallet });
  assert(purchase.ok === true, 'purchasePlan rejects crafted request');
  eq(purchase.plan.balanceAfter, 1000 - level1.cost, 'balanceAfter');
  assert(purchase.plan.items && Object.keys(purchase.plan.items).length === 0, 'crafting should not grant materials');
  const shortCredits = core.purchasePlan({ cost: applied.cost, costItems: applied.costItems, grants: applied.grants, wallet: { credits: applied.cost - 1, items: { alloy: 1 } } });
  assert(shortCredits.ok === false && shortCredits.reason === 'insufficient', 'short credits');
  const shortItems = core.purchasePlan({ cost: applied.cost, costItems: applied.costItems, grants: applied.grants, wallet: { credits: 1000, items: {} } });
  assert(shortItems.ok === false && shortItems.reason === 'insufficient-items', 'short items');
  const owned = crafting.plan({ moduleId: 'hull', level: 1, equipment: { 'module:hull:level': 1 }, wallet });
  assert(owned.ok === true && owned.noop === true && owned.cost === 0, 'owned plan should be noop');
  const ownedApply = crafting.applyPlan({ plan: owned, careerId: 'career-balance-test-1' });
  assert(ownedApply.ok === false && ownedApply.reason === 'already-owned', 'owned apply should reject');
  assert(crafting.plan({ moduleId: 'nope', level: 1, wallet }).reason === 'unknown-module', 'unknown module');
  assert(crafting.plan({ moduleId: 'hull', level: 9, wallet }).reason === 'bad-level', 'bad level');
  const cumulative = crafting.plan({ moduleId: 'hull', level: 3, wallet: { credits: 1000, items: { alloy: 6 } } });
  assert(cumulative.ok === true && cumulative.cost === 590 && cumulative.costItems.alloy === 6, 'hull L3 cumulative cost=' + JSON.stringify({ cost: cumulative.cost, items: cumulative.costItems }));
  return '制造不重复扣费、材料原子不足拒绝、purchasePlan 对账；purchaseId=' + applied.purchaseId;
});

await check('C07 无拆解/无 equipment→credits 循环，制造不可能是正利润', () => {
  const craftingKeys = Object.keys(crafting);
  assert(!craftingKeys.some((key) => /sell|scrap|dismantle|salvage|trade/i.test(key)), 'crafting sell-ish API: ' + craftingKeys.join(','));
  assert(SOURCE.crafting.indexOf('dismantle') < 0 && SOURCE.crafting.indexOf('scrap') < 0, 'crafting source contains dismantle/scrap');
  assert(SOURCE.careerDb.indexOf('sellEquipment') < 0, 'career-db has sellEquipment');
  assert(SOURCE.market.indexOf('listMaterials') >= 0, 'market should sell materials only');
  for (const mod of MODULES) {
    for (const level of mod.levels) {
      const plan = crafting.plan({ moduleId: mod.moduleId, level: level.level, wallet: { credits: 1000, items: clone(level) } });
      assert(plan.ok === true, 'plan ' + mod.moduleId + ' L' + level.level);
      assert(plan.grants && plan.grants.equipment && !plan.grants.items, 'crafting must grant equipment only');
      const craftCost = plan.cost + itemBuyValue(plan.costItems);
      const liquidation = itemSellValue(plan.costItems);
      assert(craftCost > liquidation, 'craft cost should exceed material liquidation');
    }
  }
  const marketIds = materials.listMaterials().map((entry) => entry.itemId);
  eq(marketIds, MATERIAL_IDS, 'market only five materials');
  return '无拆解/无装备回收；模块只进 equipment；制造成本（信用点+材料买价）恒大于材料变现，无正利润循环';
});

await check('C08 购买边界：差 1 拒绝、余额 0 允许、balanceCap/非法价拒绝', () => {
  const wallet = { credits: 260, items: {} };
  const exact = core.purchasePlan({ cost: 260, wallet, grants: { items: { building: 1 } } });
  assert(exact.ok === true && exact.plan.balanceAfter === 0, 'exact 260 should pass with zero balance');
  const short = core.purchasePlan({ cost: 261, wallet, grants: { items: { building: 1 } } });
  assert(short.ok === false && short.reason === 'insufficient', '261 should fail');
  const zero = core.purchasePlan({ cost: 0, wallet, grants: { items: { building: 1 } } });
  assert(zero.ok === false && zero.reason === 'bad-cost', 'zero cost');
  const negative = core.purchasePlan({ cost: -1, wallet, grants: { items: { building: 1 } } });
  assert(negative.ok === false && negative.reason === 'bad-cost', 'negative cost');
  const overCap = core.purchasePlan({ cost: 260, wallet: { credits: BALANCE_CAP + 1, items: {} }, grants: { items: { building: 1 } } });
  assert(overCap.ok === false && overCap.reason === 'balance-cap', 'wallet over cap');
  const buyPlan = materials.buyPlan({ items: { building: 1 }, wallet: { credits: 0 } });
  assert(buyPlan.ok === false && buyPlan.reason === 'insufficient', 'market buy with 0 credits');
  return '差 1 拒绝 / 余额 0 允许 / cost≤0 拒绝 / wallet>balanceCap 拒绝 / 市场 0 余额拒绝';
});

await check('C09 五材买卖差与单趟往返亏损（卖价 ≤ 买价×0.6）', () => {
  const roundTrip = materials.validateTradeRoundTrip();
  assert(roundTrip.ok === true, 'validateTradeRoundTrip failed: ' + JSON.stringify(roundTrip.errors));
  const rows = [];
  for (const entry of MATERIALS) {
    const buy = materials.buyPlan({ items: { [entry.itemId]: 1 }, wallet: { credits: 1000 } });
    assert(buy.ok === true && buy.cost === entry.buyPrice, entry.itemId + ' buy plan');
    const sell = materials.sellPlan({ items: { [entry.itemId]: 1 }, wallet: { credits: buy.balanceAfter, items: { [entry.itemId]: 1 } } });
    assert(sell.ok === true && sell.credits === entry.sellPrice, entry.itemId + ' sell plan');
    const net = sell.credits - buy.cost;
    assert(net < 0, entry.itemId + ' round trip should lose credits');
    assert(entry.sellPrice <= entry.buyPrice * 0.6, entry.itemId + ' sell ratio > 0.6');
    rows.push(entry.itemId + ' ' + entry.buyPrice + '/' + entry.sellPrice + '(' + net + ')');
  }
  eq(materials.PRICE_TABLE.building.buy, MATERIAL_BY_ID.get('building').buyPrice, 'price table buy');
  return rows.join(' / ') + '；最大 ratio=' + fmt(roundTrip.maxRatio);
});

await check('C10 材料批量往返仍亏损 / payoutCap / balanceCap / 别名重复拒绝', () => {
  const inventory = {};
  let credits = 5000;
  let cost = 0;
  let proceeds = 0;
  for (const entry of MATERIALS) {
    const buy = materials.buyPlan({ items: { [entry.itemId]: 5 }, wallet: { credits, items: inventory } });
    assert(buy.ok === true, 'bulk buy ' + entry.itemId + ': ' + buy.reason);
    cost += buy.cost;
    credits = buy.balanceAfter;
    inventory[entry.itemId] = 5;
  }
  for (const entry of MATERIALS) {
    const sell = materials.sellPlan({ items: { [entry.itemId]: 5 }, wallet: { credits, items: inventory } });
    assert(sell.ok === true, 'bulk sell ' + entry.itemId + ': ' + sell.reason);
    proceeds += sell.credits;
    credits = sell.balanceAfter;
    inventory[entry.itemId] = 0;
  }
  assert(proceeds < cost, 'bulk loop should lose credits');
  const capProbe = materials.sellPlan({ items: { starcrystal: 9 }, wallet: { credits: 0, items: { starcrystal: 9 } } });
  assert(capProbe.ok === false && capProbe.reason === 'payout-cap', 'payout cap should reject 9 starcrystal (432)');
  const okProbe = materials.sellPlan({ items: { starcrystal: 8 }, wallet: { credits: 0, items: { starcrystal: 8 } } });
  assert(okProbe.ok === true && okProbe.credits === 384, '8 starcrystal should be 384');
  const balanceProbe = materials.sellPlan({ items: { building: 1 }, wallet: { credits: 999999, items: { building: 1 } } });
  assert(balanceProbe.ok === false && balanceProbe.reason === 'balance-cap', 'balance cap should reject');
  const aliasProbe = materials.sellPlan({ items: { crystal: 1, starcrystal: 1 }, wallet: { credits: 0, items: { crystal: 1, starcrystal: 1 } } });
  assert(aliasProbe.ok === false && aliasProbe.reason === 'duplicate-item', 'alias duplicate should reject');
  return '5×5 材批量买→卖亏损 ' + (cost - proceeds) + '；payoutCap 400 → 9 星晶(432) 拒绝、8(384) 通过；余额上限/别名去重拒绝';
});

/* ------------------------------------------------------------------ *
 * D. 玩家画像收入 / 时长 / 资产可达
 * ------------------------------------------------------------------ */

await check('D01 T1–T3 每份委托完成局收入/分钟区间（1–4 分钟）', () => {
  for (const row of RATE_ROWS) {
    assert(row.completionLow >= 0 && row.completionLow <= row.completionHigh, row.commissionId + ' interval');
    assert(row.completionHigh <= PAYOUT_CAP, row.commissionId + ' high');
  }
  const summary = tierRateSummary('novice');
  const lines = TIERS.slice(0, 3).map((tier) => {
    const rows = RATE_ROWS.filter((row) => row.tier === tier);
    return 'T' + tier + ' ' + rng(Math.min(...rows.map((row) => row.completionLow)), Math.max(...rows.map((row) => row.completionHigh)));
  });
  assert(summary.length === 3, 'summary length');
  return lines.join(' / ') + ' 信用点/分钟（完成局：薪资÷1–4 分钟）';
});

await check('D02 三画像期望收入/分钟（p=0.55/0.75/0.9），与成功率单调一致', () => {
  const novice = tierRateSummary('novice');
  const mid = tierRateSummary('mid');
  const expert = tierRateSummary('expert');
  for (let i = 0; i < 3; i += 1) {
    assert(novice[i].expectedLow <= mid[i].expectedLow, 'novice <= mid low');
    assert(mid[i].expectedLow <= expert[i].expectedLow, 'mid <= expert low');
    assert(novice[i].expectedHigh <= mid[i].expectedHigh && mid[i].expectedHigh <= expert[i].expectedHigh, 'ordering high');
    assert(expert[i].expectedHigh <= PAYOUT_CAP, 'expected high <= cap');
  }
  const lines = TIERS.slice(0, 3).map((tier, index) => (
    'T' + tier + ' 新手 ' + rng(novice[index].expectedLow, novice[index].expectedHigh) +
    ' / 中级 ' + rng(mid[index].expectedLow, mid[index].expectedHigh) +
    ' / 高级 ' + rng(expert[index].expectedLow, expert[index].expectedHigh)
  ));
  return lines.join('；');
});

await check('D03 T1–T3 中首通 0 信用点的委托（首通≠收入来源）', () => {
  const t1Zero = RATE_ROWS.filter((row) => row.tier === 1 && row.firstCredits === 0).length;
  const t23Zero = RATE_ROWS.filter((row) => row.tier > 1 && row.firstCredits === 0).length;
  assert(t1Zero === 0, 'T1 首通应有信用点（onboarding）');
  assert(t23Zero > 0, 'T2/T3 应存在首通 0 信用点（材料/证据导向）');
  return 'T1 首通 0 条 / T2–T3 首通 0 信用点 ' + t23Zero + '/32；T1 为入门现金流，T2/T3 靠重复薪资与材料';
});

await check('D04 含失败期望 = 完成局 × p（失败 0 收入但同样耗时）', () => {
  for (const profile of PROFILES) {
    for (const row of RATE_ROWS) {
      near(row.expected[profile.id].high, profile.success * row.completionHigh, 1e-9, 'expected high');
      near(row.expected[profile.id].low, profile.success * row.completionLow, 1e-9, 'expected low');
    }
  }
  return 'p=0.55/0.75/0.9 的期望折减已按“失败 0 收入 + 同样消耗时长”计入';
});

await check('D05 时长敏感性（1/2/4/5 分钟）与内容 durationHint 口径差异', () => {
  const salary = MIN_REPEAT;
  const rates = [1, 2, 4, 5].map((minutes) => salary / minutes);
  for (let i = 1; i < rates.length; i += 1) assert(rates[i] < rates[i - 1], 'rate should decrease with duration');
  const hints = new Set(COMMISSIONS.map((entry) => entry.durationHint));
  return '最低重复薪资 ' + salary + ' → ' + [1, 2, 4, 5].map((minutes, i) => minutes + 'min=' + fmt(rates[i])).join(' / ') +
    '；内容 hint ' + JSON.stringify(Array.from(hints)) + '，本门禁按任务卡 1–4 分钟计（UNVERIFIED）';
});

await check('D06 资产可达：成功局数与 wall-clock 区间（2.5 分钟中位局 × 成功率）', () => {
  const rows = AFFORDABILITY.map((target) => {
    const wall = wallClockMinutes(target.total);
    assert(wall.runs >= 0, target.id + ' runs');
    return target.name + ' 总价 ' + target.total + ' → ' + wall.runs + ' 成功局；新手 ' + fmt(wall.minutes.novice) +
      ' / 中级 ' + fmt(wall.minutes.mid) + ' / 高级 ' + fmt(wall.minutes.expert) + ' 分钟';
  });
  const oldWing = AFFORDABILITY.find((target) => target.id === 'old-wing');
  const oldWall = wallClockMinutes(oldWing.total);
  assert(oldWall.runs === 3, 'old-wing should need 3 successful commissions, got ' + oldWall.runs);
  return rows.join('；');
});

/* ------------------------------------------------------------------ *
 * E. 失败 / 极短局 / 多开刷币
 * ------------------------------------------------------------------ */

await check('E01 失败局四种形态均不进入发奖（0 信用点）', () => {
  let cases = 0;
  for (const entry of COMMISSIONS) {
    const options = { mode: 'commission', gameId: entry.gameId };
    const none = core.rewardPlan(entry, [], options);
    assert(none.ok === false, 'empty run should fail');
    cases += 1;
    if (entry.objective.atLeast > 1) {
      assert(core.rewardPlan(entry, digestEvents(entry, { count: entry.objective.atLeast - 1 }), options).ok === false, 'partial should fail');
      cases += 1;
    }
    if (entry.objective.minValue) {
      const miss = core.rewardPlan(entry, digestEvents(entry, { payload: { [entry.objective.minValue.field]: entry.objective.minValue.value - 1 } }), options);
      assert(miss.ok === false && miss.reason === 'value-not-met', 'minValue miss');
      cases += 1;
    }
  }
  return cases + ' 个失败形态全部 ok:false（无 credits 字段）';
});

await check('E02 settle 顺序：先目标判定，再准备首/重复计划并交给领奖事务；失败零写', () => {
  const failIdx = SOURCE.commissionCore.indexOf('if (!check || !check.ok)');
  const planIdx = SOURCE.commissionCore.indexOf('plan = core.rewardPlan(commission, events, { mode: MODE, repeat: false');
  const repeatPlanIdx = SOURCE.commissionCore.indexOf('repeatPlan = core.rewardPlan(commission, events, { mode: MODE, repeat: true');
  const claimIdx = SOURCE.commissionCore.indexOf('db.settleAndClaim');
  assert(failIdx > 0, 'missing target check block');
  assert(planIdx > failIdx, 'first/repeat plans must come after target check');
  assert(repeatPlanIdx > planIdx, 'repeat plan expected');
  assert(claimIdx > repeatPlanIdx, 'settleAndClaim must come after plans');
  assert(SOURCE.commissionCore.indexOf('deferCommit === true') > 0, 'ending defer seam expected');
  assert(SOURCE.commissionCore.indexOf('return recordResult(failure(reason') > failIdx, 'failure return expected');
  return '目标失败 → 直接返回；首通/重复计划同事件计算，由 DB 领奖事务选择';
});

await check('E03 重复薪资固定：1× 与 5× 事件同额（不按事件数计费）', () => {
  for (const entry of COMMISSIONS) {
    const full = repeatPlan(entry, digestEvents(entry));
    const over = repeatPlan(entry, overkillEvents(entry, 5));
    eq(over.credits, full.credits, 'repeat credits ' + entry.commissionId);
    eq(over.items, {}, 'repeat items ' + entry.commissionId);
    const firstFull = firstPlan(entry, digestEvents(entry));
    const firstOver = firstPlan(entry, overkillEvents(entry, 5));
    eq(firstOver.credits, firstFull.credits, 'first credits ' + entry.commissionId);
    eq(firstOver.items, firstFull.items, 'first items ' + entry.commissionId);
  }
  return '96/96：多打事件不额外发钱/材料（防按事件计费刷币）';
});

await check('E04 重复只发薪资、首通奖励只发一次（rewardPlan repeat 分支）', () => {
  for (const entry of COMMISSIONS) {
    const repeated = repeatPlan(entry);
    eq(repeated.items, {}, 'repeat items ' + entry.commissionId);
    eq(repeated.evidence, [], 'repeat evidence ' + entry.commissionId);
    eq(repeated.flags, [], 'repeat flags ' + entry.commissionId);
    eq(repeated.credits, entry.repeatSalaryCredits, 'repeat salary ' + entry.commissionId);
  }
  return '首通的材料/证据/旗标不会随重复局再次发放；重复局仅 ' + MIN_REPEAT + '–' + MAX_REPEAT + ' 信用点';
});

await check('E05 minValidEngagement 语义：内容 96 条均缺省 0、runtime 未消费（风险量化）', () => {
  const declared = COMMISSIONS.filter((entry) => hasOwn(entry, 'minValidEngagement')).length;
  const registryHasField = SOURCE.registryJs.indexOf('minValidEngagement') >= 0;
  const runtimeConsumes = ['core', 'commissionCore', 'bridge'].some((name) => SOURCE[name].indexOf('minValidEngagement') >= 0);
  assert(registryHasField, 'registry should keep minValidEngagement semantics');
  assert(runtimeConsumes === false, 'runtime unexpectedly consumes minValidEngagement');
  const lowSalary = Math.min(...T13.map((entry) => Number(entry.repeatSalaryCredits)));
  const highSalary = Math.max(...T13.map((entry) => Number(entry.repeatSalaryCredits)));
  const farm = (seconds) => rng((lowSalary * 60) / seconds, (highSalary * 60) / seconds);
  return '内容声明 ' + declared + '/96（缺省=0）；registry 保留、runtime 不消费；理论刷币率 15s=' + farm(15) + ' / 30s=' + farm(30) + ' / 60s=' + farm(60) + ' 信用点/分钟（风险，见推荐 R2）';
});

await check('E06 极短目标面：T1–T3 中 atLeast≤2 或 minValue 的委托（满额薪资风险面）', () => {
  const shortTargets = T13.filter((entry) => entry.objective.atLeast <= 2 || entry.objective.minValue);
  assert(shortTargets.length > 0, 'expected short-target commissions');
  for (const entry of shortTargets) {
    assert(Number.isInteger(entry.objective.atLeast) && entry.objective.atLeast >= 1, 'atLeast must be >=1 ' + entry.commissionId);
    if (entry.objective.minValue) assert(entry.objective.minValue.value > 0, 'minValue must be positive');
  }
  return shortTargets.length + '/48 条 T1–T3 目标事件 ≤2 或阈值型（如 ' + shortTargets.slice(0, 4).map((entry) => entry.commissionId).join(', ') + '）；极短局仍拿满额重复薪资';
});

await check('E07 多开/并发：ticket 仅 sessionStorage、每局 runId 唯一、无全局冷却（UNVERIFIED）', () => {
  assert(SOURCE.commissionCore.indexOf('TICKET_STORAGE_KEY') >= 0, 'ticket storage key missing');
  assert(SOURCE.bridge.indexOf("sessionStorage") >= 0, 'bridge ticket storage should be sessionStorage');
  assert(SOURCE.commissionCore.indexOf('db.settleAndClaim') >= 0, 'settle uses db claim');
  assert(!/cooldown|rate-limit|globalLock/i.test(SOURCE.commissionCore), 'unexpected global lock');
  return '多标签各自 sessionStorage ticket、DB 以 runId/claim 幂等；无跨标签冷却，每局仍受 payoutCap ' + PAYOUT_CAP + ' 限制（并行刷币风险，UNVERIFIED）';
});

await check('E08 极短局理论刷币率有硬护栏（≤1000/分钟 且 ≤10× 正常上限）', () => {
  const highSalary = Math.max(...T13.map((entry) => Number(entry.repeatSalaryCredits)));
  const farm15 = (highSalary * 60) / 15;
  const nominalMax = highSalary; // 1 分钟完成局（薪资/1min）的上限
  assert(farm15 <= 1000, 'farm rate too high: ' + farm15);
  assert(farm15 / nominalMax <= 10, 'farm/normal ratio too high: ' + farm15 / nominalMax);
  return '15 秒极短局 ' + fmt(farm15) + '/min vs 正常 1 分钟上限 ' + nominalMax + '/min（×' + fmt(farm15 / nominalMax) + '）；硬护栏按 1000/min 与 10× 设，当前未触发';
});

/* ------------------------------------------------------------------ *
 * F. 系统一致性 / 确定性 / 证据不可交易
 * ------------------------------------------------------------------ */

await check('F01 五材双来源 ≥2、来源 gameId 均在 registry 16 款内', () => {
  const twoSources = materials.assertTwoSources();
  assert(twoSources.ok === true, 'assertTwoSources failed: ' + JSON.stringify(twoSources.errors));
  eq(twoSources.materials.length, MATERIAL_IDS.length, 'two-source material count');
  for (const entry of materials.listMaterials()) {
    assert(entry.sources.length >= 2, entry.itemId + ' sources < 2');
    for (const gameId of entry.sources) assert(GAME_IDS.indexOf(gameId) >= 0, 'unknown source ' + gameId);
    assert(entry.sources.indexOf(entry.sources[0]) === 0, 'sources not sorted');
  }
  return materials.listMaterials().map((entry) => entry.itemId + '×' + entry.sources.length).join(' / ');
});

await check('F02 crystal→starcrystal 查询期别名，不新增第 6 材', () => {
  eq(materials.listMaterials().length, 5, 'material count');
  eq(materials.normalizeItemId('crystal'), 'starcrystal', 'alias normalize');
  eq(materials.getMaterial('crystal').itemId, 'starcrystal', 'alias get');
  eq(materials.priceOf('crystal', 'sell'), MATERIAL_BY_ID.get('starcrystal').sellPrice, 'alias price');
  eq(materials.listMaterials().filter((entry) => entry.aliases.indexOf('crystal') >= 0).length, 1, 'alias count');
  return 'crystal 只做查询映射（卖价 ' + MATERIAL_BY_ID.get('starcrystal').sellPrice + '），五材目录不变';
});

await check('F03 证据 token 不可交易（43 条白名单）且 story-evidence 无经济面', () => {
  const configured = storyEvidence.configure({ chapter: REAL_CHAPTER, commissions: REAL_COMMISSIONS, items: REAL_ITEMS });
  assert(configured.ok === true, 'storyEvidence.configure failed: ' + JSON.stringify(configured.errors));
  const whitelist = storyEvidence.evidenceWhitelist();
  const declared = new Set();
  for (const entry of COMMISSIONS) for (const token of entry.reward.evidence) declared.add(token);
  eq(new Set(whitelist.map((row) => row.token)).size, declared.size, 'evidence whitelist count');
  for (const token of declared) {
    assert(MATERIAL_IDS.indexOf(token) < 0, 'evidence token collides with material ' + token);
    assert(!MATERIAL_BY_ID.has(token), 'evidence token is tradable ' + token);
  }
  assert(!Object.keys(storyEvidence).some((key) => /sell|price|payout|salary/i.test(key)), 'story-evidence has economic API');
  assert(/economy:\s*\{\s*credits:\s*0/.test(SOURCE.storyEvidence), 'story-evidence should disclose zero economy');
  return '白名单 ' + declared.size + ' 条（E/MAP/BP/DEC），无一是可交易材料；recordFromReceipt 经济面恒为 0';
});

await check('F04 职业等级不产生金额/倍率字段（orderOptions 只读分流）', () => {
  const configured = professions.configure({ commissions: REAL_COMMISSIONS, registry: REAL_REGISTRY });
  assert(configured.ok === true, 'professions.configure failed: ' + JSON.stringify(configured.errors));
  const professionId = PROFESSIONS_ID(0);
  const options = professions.orderOptions({ professionId, quests: [], claims: [] });
  assert(options.ok === true, 'orderOptions failed: ' + options.reason);
  const keys = [];
  (function walk(value) {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      keys.push(key);
      walk(value[key]);
    }
  })(options);
  const banned = keys.filter((key) => /^(credits|credit|reward|rewards|payout|salary|bonus|multiplier|price|cost)$/i.test(key));
  eq(banned, [], 'profession should not expose economic fields');
  eq(professions.THRESHOLDS, { apprentice: 0, veteran: 3, expert: 6 }, 'thresholds');
  return '16 职业共享 0/3/6 阈值；orderOptions 字段 ' + keys.length + ' 个，无金额/倍率/reward';
});

function PROFESSIONS_ID(index) {
  const list = REAL_REGISTRY.professions || [];
  return list[index % list.length].professionId;
}

await check('F05 route-planner 计划信用点只来自内容首通工钱（无发明数字）', () => {
  const configured = routePlanner.configure({ commissions: REAL_COMMISSIONS, items: REAL_ITEMS, chapter: REAL_CHAPTER });
  assert(configured.ok === true, 'routePlanner.configure failed: ' + JSON.stringify(configured.errors));
  const plan = routePlanner.plan({
    originGameId: 'pendulum-tower',
    professionId: 'engineering.structural',
    wallet: { credits: INITIAL_CREDITS, items: {} },
    quests: [],
    claims: [],
    flags: [],
  });
  assert(plan.ok === true, 'route plan failed: ' + plan.reason);
  let expectedCredits = 0;
  for (const step of plan.steps) {
    if (step.kind !== 'commission') continue;
    const entry = COMMISSION_BY_ID.get(step.commissionId);
    assert(entry, 'planned unknown commission ' + step.commissionId);
    expectedCredits += Number(entry.reward.credits);
  }
  eq(plan.workload.plannedCredits, expectedCredits, 'plannedCredits');
  return 'engineering.structural 计划 ' + plan.steps.length + ' 步 / 首通工钱 ' + expectedCredits + ' 与内容逐项相等';
});

await check('F06 确定性：同输入重算完全一致；只用真实文件（无 Chrome/网络/随机/时钟）', () => {
  const second = COMMISSIONS.map((entry) => firstPlan(entry).credits + '/' + repeatPlan(entry).credits);
  const first = COMMISSIONS.map((entry) => firstPlan(entry).credits + '/' + repeatPlan(entry).credits);
  eq(second, first, 'deterministic');
  const planA = materials.buyPlan({ items: { starcrystal: 2 }, wallet: { credits: 500 } });
  const planB = materials.buyPlan({ items: { starcrystal: 2 }, wallet: { credits: 500 } });
  eq(planB.cost, planA.cost, 'deterministic material plan');
  assert(SOURCE.materials.indexOf('Math.random') < 0, 'materials random');
  assert(SOURCE.core.indexOf('Math.random') < 0, 'core random');
  return '重复计算 0 差异；模块无随机数；本门禁不启动 Chrome、不访问网络、不写仓库文件';
});

/* ------------------------------------------------------------------ *
 * 模型输出（证据/文档用；--tables 时逐条）
 * ------------------------------------------------------------------ */

function printModel() {
  console.log('');
  console.log('MODEL  files');
  for (const key of ['commissions', 'items', 'registry', 'chapter', 'core', 'materials', 'crafting', 'professions', 'storyEvidence', 'routePlanner']) {
    console.log('MODEL  sha256 ' + key + '=' + sha256(FILES[key]));
  }
  console.log('MODEL  totals firstCredits=' + TOTAL_FIRST_CREDITS + ' repeatCredits=' + TOTAL_REPEAT_CREDITS +
    ' evidence=' + TOTAL_EVIDENCE + ' firstLiquidation=' + FIRST_LIQUIDATION +
    ' sinks=' + SINK_TOTAL + ' (ships=' + SHIP_TOTAL + ' shipMaterials=' + SHIP_MATERIAL_TOTAL + ' modules=' + MODULE_TOTAL + ')' +
    ' initial=' + INITIAL_CREDITS + ' payoutCap=' + PAYOUT_CAP + ' balanceCap=' + BALANCE_CAP);
  for (const row of TIER_STATS) {
    console.log('MODEL  tier T' + row.tier + ' count=' + row.count + ' first=' + row.firstCredits +
      ' repeat=' + row.repeatCredits + ' evidence=' + row.evidence + ' itemCount=' + row.items);
  }
  console.log('MODEL  old-wing price=' + OLD_WING.price + ' initial=' + INITIAL_CREDITS +
    ' best2=' + (BEST2 + INITIAL_CREDITS) + ' min3=' + (MIN3 + INITIAL_CREDITS) + ' best3=' + (BEST3 + INITIAL_CREDITS) +
    ' typical3=' + (INITIAL_CREDITS + T1_FIRST_SORTED.slice(0, 3).reduce((a, b) => a + b, 0)));
  for (const profile of PROFILES) {
    const rows = tierRateSummary(profile.id);
    console.log('MODEL  profile ' + profile.id + ' p=' + profile.success + ' ' +
      rows.map((row) => 'T' + row.tier + '=' + rng(row.expectedLow, row.expectedHigh)).join(' '));
  }
  for (const target of AFFORDABILITY) {
    const wall = wallClockMinutes(target.total);
    console.log('MODEL  afford ' + target.name + ' total=' + target.total + ' runs=' + wall.runs +
      ' novice=' + fmt(wall.minutes.novice) + ' mid=' + fmt(wall.minutes.mid) + ' expert=' + fmt(wall.minutes.expert));
  }
  if (TABLES) {
    for (const gameId of GAME_IDS) {
      const cells = TIERS.map((tier) => {
        const entry = COMMISSIONS.find((row) => row.gameId === gameId && row.tier === tier);
        const mats = entry.reward.items && Object.keys(entry.reward.items).length
          ? Object.keys(entry.reward.items).map((itemId) => itemId + '×' + entry.reward.items[itemId]).join('+')
          : '-';
        return 'T' + tier + ':' + entry.reward.credits + '/' + mats + '/E' + entry.reward.evidence.length + '/' + entry.repeatSalaryCredits;
      });
      console.log('MODEL  game ' + gameId + ' ' + cells.join(' | '));
    }
    for (const row of RATE_ROWS) {
      console.log('MODEL  rate ' + row.commissionId + ' first=' + row.firstCredits + ' matSell=' + row.firstMaterialSell +
        ' salary=' + row.salary + ' completion=' + rng(row.completionLow, row.completionHigh) +
        ' novice=' + rng(row.expected.novice.low, row.expected.novice.high) +
        ' mid=' + rng(row.expected.mid.low, row.expected.mid.high) +
        ' expert=' + rng(row.expected.expert.low, row.expected.expert.high));
    }
  }
}

printModel();

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */

console.log('');
console.log(`${total - failed}/${total} checks passed`);
if (failed > 0) {
  console.error(`FAILED: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('PASS  career economy balance test (D17-25)');
process.exit(0);
