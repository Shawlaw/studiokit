#!/usr/bin/env node
/**
 * Arcade Life 0.17 五类材料目录 / 固定价差 / 双来源约束门禁（D17-19）
 * apps/arcade/career/materials.js 的纯 Node 确定性测试。
 *
 * 覆盖：
 * - UMD 双端导出（Node require + 浏览器 window.ArcadeCareerMaterials / ArcadeCareer.materials）；
 * - 真实 content/items.json：5 材、冻结价表（45/22、80/38、65/30、100/48、55/25）、
 *   卖价 ≤ 买价×0.6、crystal→starcrystal 别名只在查询映射、绝不新增第 6 材；
 * - listMaterials/getMaterial/priceOf/sourcesFor 形状与复制隔离；
 * - 真实 96 委托 reward.items ∪ 0.16 已知掉落来源的独立 oracle 比对（T4–T6 也纳入）；
 * - sellPlan：正常/多材/别名入参/库存不足 missing/非法 id/非整数/重复别名/
 *   单笔 payout 上限/余额上限/钱包校验/绝不负余额；
 * - buyPlan：总价、余额差、grants、别名归一、余额不足 missing、堆叠上限、非法入参；
 * - assertTwoSources：真实内容全通过；人为删来源（空映射/部分映射/别名注入）报错列表；
 * - validateTradeRoundTrip：五材买→卖均负利润、ratio ≤ 0.6；
 * - configure 坏内容：缺 items/materials、材料数量/未知/重复/缺名/坏价/价表漂移、
 *   坏别名、非法 commissions、未知奖励物品/游戏/数量；失败保留旧状态；
 * - 96 委托 reward.items 只含白名单材料（含 T4–T6），五材全部出现；
 * - 计划结果满足 career-db 入参约定（credits/items/cost/grants 与 career-core.purchasePlan 对账）；
 * - 确定性（同输入同输出）、内容深拷贝不可变、RULESET 镜像防漂移、
 *   静态边界（无 fs/网络/IDB/DOM/随机/时钟；craftCost 留给 crafting.js）。
 *
 * 纯 Node：require 真实 materials.js / career-core.js，读取真实内容 JSON 与 registry.json；
 * 零 npm 依赖；不启动 Chrome、不写仓库文件。
 *
 * 运行：node tools/career_materials_test.mjs
 * 退出码：0 全部通过；1 有失败；2 装配失败（模块/内容读取失败）。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const MODULE_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'materials.js');
const CORE_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'career-core.js');
const ITEMS_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'items.json');
const COMMISSIONS_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'commissions.json');
const REGISTRY_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'registry.json');

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

let materials;
let core;
try {
  materials = require(MODULE_PATH);
  core = require(CORE_PATH);
} catch (err) {
  console.error('ENV: 无法 require materials.js / career-core.js — ' + (err && err.message ? err.message : err));
  process.exit(2);
}

const MODULE_SOURCE = readOrExit(MODULE_PATH);
const REAL_ITEMS = parseOrExit(ITEMS_PATH, 'items.json');
const REAL_COMMISSIONS = parseOrExit(COMMISSIONS_PATH, 'commissions.json');
const REAL_REGISTRY = parseOrExit(REGISTRY_PATH, 'registry.json');

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

function hasError(result, fragment) {
  return Array.isArray(result.errors) && result.errors.some((code) => code.indexOf(fragment) >= 0);
}

function hasWarning(result, fragment) {
  return Array.isArray(result.warnings) && result.warnings.some((code) => code.indexOf(fragment) >= 0);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function configureReal() {
  const res = materials.configure({ items: REAL_ITEMS, commissions: REAL_COMMISSIONS });
  if (!res.ok) throw new Error('baseline configure failed: ' + JSON.stringify(res.errors));
  return res;
}

/* 装配门禁：真实内容必须能配置成功，否则后续断言全部无意义 → 退出码 2。 */
const baseline = materials.configure({ items: REAL_ITEMS, commissions: REAL_COMMISSIONS });
if (!baseline.ok) {
  console.error('ENV: 真实 items.json/commissions.json 在 materials.configure 下失败 — ' + JSON.stringify(baseline));
  process.exit(2);
}

/* ------------------------------------------------------------------ *
 * M-01 UMD / 常量
 * ------------------------------------------------------------------ */

await check('M-01 UMD 双端导出与五材常量', () => {
  [
    'configure',
    'reset',
    'status',
    'isConfigured',
    'normalizeItemId',
    'listMaterials',
    'getMaterial',
    'priceOf',
    'sourcesFor',
    'sellPlan',
    'buyPlan',
    'assertTwoSources',
    'validateTradeRoundTrip',
  ].forEach((name) => assert(typeof materials[name] === 'function', 'missing function ' + name));
  eq(materials.MATERIAL_IDS, ['building', 'alloy', 'electronics', 'starcrystal', 'biomass'], 'MATERIAL_IDS order');
  eq(materials.MIN_SOURCES, 2, 'MIN_SOURCES');
  eq(materials.SELL_PRICE_RATIO_MAX, 0.6, 'SELL_PRICE_RATIO_MAX');
  eq(materials.EXPECTED_COMMISSION_COUNT, 96, 'EXPECTED_COMMISSION_COUNT');
  eq(materials.PRICE_TABLE.starcrystal, { buy: 100, sell: 48 }, 'PRICE_TABLE.starcrystal');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(MODULE_SOURCE, sandbox, { filename: 'materials.js' });
  const browserApi = sandbox.window.ArcadeCareerMaterials;
  assert(browserApi && typeof browserApi.configure === 'function', 'browser window.ArcadeCareerMaterials missing');
  assert(
    sandbox.window.ArcadeCareer && sandbox.window.ArcadeCareer.materials === browserApi,
    'window.ArcadeCareer.materials mirror missing'
  );
  eq(browserApi.MATERIAL_IDS, materials.MATERIAL_IDS, 'browser MATERIAL_IDS');
  return 'node + browser UMD, 13 methods';
});

/* ------------------------------------------------------------------ *
 * M-02/M-03/M-04 真实内容
 * ------------------------------------------------------------------ */

await check('M-02 真实 items.json 配置成功（5 材/别名/96 委托/零警告）', () => {
  const res = configureReal();
  eq(res.materialCount, 5, 'materialCount');
  eq(res.contentVersion, REAL_ITEMS.contentVersion, 'contentVersion');
  eq(res.commissionCount, 96, 'commissionCount');
  eq(res.aliasCount, 1, 'aliasCount');
  eq(res.warnings, [], 'warnings');
  eq(res.sourceCounts, { building: 3, alloy: 4, electronics: 2, starcrystal: 5, biomass: 2 }, 'sourceCounts');
  eq(materials.status().configured, true, 'status.configured');
  return 'materials=5 commissions=96 warnings=0';
});

await check('M-03 listMaterials 形状与固定价差（卖价 ≤ 买价×0.6）', () => {
  configureReal();
  const list = materials.listMaterials();
  eq(list.length, 5, 'length');
  eq(list.map((entry) => entry.itemId), materials.MATERIAL_IDS, 'ids/canonical order');
  const contentById = {};
  REAL_ITEMS.materials.forEach((entry) => {
    contentById[entry.itemId] = entry;
  });
  list.forEach((entry) => {
    const content = contentById[entry.itemId];
    eq(Object.keys(entry), ['itemId', 'name', 'buyPrice', 'sellPrice', 'aliases', 'sources'], entry.itemId + ' keys');
    eq(entry.name, content.name, entry.itemId + ' name');
    eq(entry.buyPrice, content.buyPrice, entry.itemId + ' buyPrice');
    eq(entry.sellPrice, content.sellPrice, entry.itemId + ' sellPrice');
    assert(Number.isInteger(entry.buyPrice) && entry.buyPrice > 0, entry.itemId + ' buyPrice integer');
    assert(Number.isInteger(entry.sellPrice) && entry.sellPrice > 0, entry.itemId + ' sellPrice integer');
    assert(entry.sellPrice <= entry.buyPrice * materials.SELL_PRICE_RATIO_MAX, entry.itemId + ' ratio guard');
    eq(entry.sources, entry.sources.slice().sort(), entry.itemId + ' sources sorted');
    assert(entry.sources.length >= 2, entry.itemId + ' sources >= 2');
    entry.sources.forEach((gameId) => {
      assert(/^[a-z][a-z0-9-]{0,61}$/.test(gameId), entry.itemId + ' bad source gameId ' + gameId);
    });
  });
  eq(list.filter((entry) => entry.itemId === 'starcrystal')[0].aliases, ['crystal'], 'starcrystal aliases');
  eq(
    list
      .filter((entry) => entry.itemId !== 'starcrystal')
      .map((entry) => entry.aliases),
    [[], [], [], []],
    'only starcrystal has alias'
  );
  const mutated = materials.listMaterials();
  mutated[0].buyPrice = 9999;
  mutated[0].sources.push('moonstone-run');
  eq(materials.listMaterials()[0].buyPrice, 45, 'returned copy isolated (price)');
  eq(materials.listMaterials()[0].sources.length, 3, 'returned copy isolated (sources)');
  return '45/22 80/38 65/30 100/48 55/25';
});

await check('M-04 来源 = 96 委托 reward.items ∪ 0.16 已知掉落（独立 oracle）', () => {
  configureReal();
  const expected = {};
  materials.MATERIAL_IDS.forEach((itemId) => {
    expected[itemId] = new Set();
  });
  REAL_COMMISSIONS.commissions.forEach((commission) => {
    const items = commission.reward && commission.reward.items ? commission.reward.items : {};
    Object.keys(items).forEach((key) => {
      const canonical = materials.normalizeItemId(key);
      if (canonical) expected[canonical].add(commission.gameId);
    });
  });
  materials.MATERIAL_IDS.forEach((itemId) => {
    (materials.KNOWN_DROPS[itemId] || []).forEach((gameId) => expected[itemId].add(gameId));
  });
  const actual = {};
  materials.listMaterials().forEach((entry) => {
    actual[entry.itemId] = entry.sources;
  });
  materials.MATERIAL_IDS.forEach((itemId) => {
    eq(actual[itemId], Array.from(expected[itemId]).sort(), itemId + ' sources oracle');
  });

  /* T4–T6 也必须真实贡献来源（不得只靠 T1–T3 凑数）。 */
  const tier46 = {};
  REAL_COMMISSIONS.commissions.forEach((commission) => {
    if (!(commission.tier >= 4)) return;
    const items = commission.reward && commission.reward.items ? commission.reward.items : {};
    Object.keys(items).forEach((key) => {
      const canonical = materials.normalizeItemId(key);
      if (!canonical) return;
      tier46[canonical] = tier46[canonical] || new Set();
      tier46[canonical].add(commission.gameId);
    });
  });
  materials.MATERIAL_IDS.forEach((itemId) => {
    assert(tier46[itemId] && tier46[itemId].size > 0, itemId + ' has no T4-T6 source');
    Array.from(tier46[itemId]).forEach((gameId) => {
      assert(materials.sourcesFor(itemId).indexOf(gameId) >= 0, itemId + ' missing T4-T6 source ' + gameId);
    });
  });
  return 'oracle match + T4-T6 sources included';
});

/* ------------------------------------------------------------------ *
 * M-05/M-06/M-07 别名与查询降级
 * ------------------------------------------------------------------ */

await check('M-05 crystal→starcrystal 只在查询映射（不新增第 6 材）', () => {
  configureReal();
  eq(materials.normalizeItemId('crystal'), 'starcrystal', 'alias');
  eq(materials.normalizeItemId('starcrystal'), 'starcrystal', 'canonical self');
  materials.MATERIAL_IDS.forEach((itemId) => eq(materials.normalizeItemId(itemId), itemId, itemId + ' self'));
  eq(materials.normalizeItemId('Crystal'), null, 'case sensitive');
  eq(materials.normalizeItemId('starcrystal '), null, 'no trimming');
  eq(materials.normalizeItemId('moonstone'), null, 'unknown id');
  eq(materials.normalizeItemId(''), null, 'empty string');
  eq(materials.normalizeItemId(null), null, 'null');
  eq(materials.normalizeItemId(42), null, 'number');
  const ids = materials.listMaterials().map((entry) => entry.itemId);
  assert(ids.indexOf('crystal') < 0, 'crystal must not be exported as a material');
  eq(materials.listMaterials().length, 5, 'still 5 materials');
  eq(materials.getMaterial('crystal').itemId, 'starcrystal', 'getMaterial alias');
  materials.reset();
  eq(materials.normalizeItemId('crystal'), 'starcrystal', 'alias before configure (0.16 compat)');
  configureReal();
  return 'crystal→starcrystal only';
});

await check('M-06 getMaterial / priceOf', () => {
  configureReal();
  const star = materials.getMaterial('crystal');
  eq(star.itemId, 'starcrystal', 'alias itemId');
  eq(star.buyPrice, 100, 'buyPrice');
  eq(star.sellPrice, 48, 'sellPrice');
  eq(materials.priceOf('crystal', 'sell'), 48, 'alias sell');
  eq(materials.priceOf('starcrystal'), 100, 'default side buy');
  eq(materials.priceOf('building', 'buy'), 45, 'buy side');
  eq(materials.priceOf('biomass', 'sell'), 25, 'sell side');
  eq(materials.priceOf('moonstone', 'buy'), null, 'unknown id');
  eq(materials.priceOf('crystal', 'trade'), null, 'invalid side');
  eq(materials.priceOf(null), null, 'null id');
  eq(materials.getMaterial('moonstone'), null, 'unknown material');
  const copy = materials.getMaterial('alloy');
  copy.buyPrice = 1;
  copy.sources.push('moonstone-run');
  eq(materials.priceOf('alloy', 'buy'), 80, 'copy isolation (price)');
  eq(materials.sourcesFor('alloy').indexOf('moonstone-run') < 0, true, 'copy isolation (sources)');
  return 'alias pricing ok';
});

await check('M-07 未 configure 时查询与计划结构化降级', () => {
  materials.reset();
  eq(materials.isConfigured(), false, 'isConfigured');
  eq(materials.listMaterials(), [], 'listMaterials');
  eq(materials.getMaterial('alloy'), null, 'getMaterial');
  eq(materials.priceOf('alloy', 'buy'), null, 'priceOf');
  eq(materials.sourcesFor('alloy'), [], 'sourcesFor');
  const sell = materials.sellPlan({ items: { building: 1 }, wallet: { credits: 10, items: { building: 1 } } });
  eq(sell.ok, false, 'sell ok');
  eq(sell.reason, 'not-configured', 'sell reason');
  const buy = materials.buyPlan({ items: { building: 1 }, wallet: { credits: 100 } });
  eq(buy.ok, false, 'buy ok');
  eq(buy.reason, 'not-configured', 'buy reason');
  const two = materials.assertTwoSources();
  eq(two.ok, false, 'two ok');
  eq(two.reason, 'not-configured', 'two reason');
  eq(two.errors, [], 'two errors');
  const trip = materials.validateTradeRoundTrip();
  eq(trip.ok, false, 'trip ok');
  eq(trip.reason, 'not-configured', 'trip reason');
  eq(trip.errors, [], 'trip errors');
  eq(materials.status().configured, false, 'status.configured');
  configureReal();
  return 'not-configured everywhere, no throw';
});

/* ------------------------------------------------------------------ *
 * M-08..M-13 sellPlan
 * ------------------------------------------------------------------ */

await check('M-08 sellPlan 正常路径（多材/别名入参/余额）', () => {
  configureReal();
  const single = materials.sellPlan({ items: { building: 2 }, wallet: { credits: 100, items: { building: 2 } } });
  eq(single.ok, true, 'single ok');
  eq(single.reason, '', 'single reason');
  eq(single.items, { building: 2 }, 'single items');
  eq(single.unitPrices, { building: 22 }, 'single unitPrices');
  eq(single.credits, 44, 'single credits');
  eq(single.balanceAfter, 144, 'single balanceAfter');
  eq(single.missing, [], 'single missing');
  eq(single.warnings, [], 'single warnings');
  const multi = materials.sellPlan({
    items: { building: 1, alloy: 1, crystal: 1 },
    wallet: { credits: 100, items: { building: 1, alloy: 1, crystal: 1 } },
  });
  eq(multi.ok, true, 'multi ok');
  eq(multi.items, { building: 1, alloy: 1, starcrystal: 1 }, 'multi canonicalized');
  eq(multi.credits, 108, 'multi credits');
  eq(multi.balanceAfter, 208, 'multi balanceAfter');
  const request = { items: { building: 1 }, wallet: { credits: 5, items: { building: 1 } } };
  materials.sellPlan(request);
  eq(Object.keys(request.items), ['building'], 'request items untouched');
  eq(request.wallet.credits, 5, 'wallet untouched');
  return 'credits 44 / 108';
});

await check('M-09 sellPlan 库存不足返回 missing', () => {
  configureReal();
  const one = materials.sellPlan({ items: { building: 2 }, wallet: { credits: 100, items: { building: 1 } } });
  eq(one.ok, false, 'ok');
  eq(one.reason, 'insufficient-items', 'reason');
  eq(one.missing, [{ kind: 'items', itemId: 'building', need: 2, have: 1 }], 'missing');
  eq(one.balanceAfter, 100, 'balance unchanged');
  eq(one.credits, 44, 'diagnostic credits');
  const two = materials.sellPlan({
    items: { building: 2, alloy: 1 },
    wallet: { credits: 0, items: { building: 0, alloy: 0 } },
  });
  eq(two.reason, 'insufficient-items', 'multi reason');
  eq(
    two.missing,
    [
      { kind: 'items', itemId: 'building', need: 2, have: 0 },
      { kind: 'items', itemId: 'alloy', need: 1, have: 0 },
    ],
    'multi missing'
  );
  return 'missing entries';
});

await check('M-10 sellPlan 非法 id / 非整数 / 空入参', () => {
  configureReal();
  const unknown = materials.sellPlan({ items: { moonstone: 1 }, wallet: { credits: 10, items: { moonstone: 1 } } });
  eq(unknown.ok, false, 'unknown ok');
  eq(unknown.reason, 'unknown-item', 'unknown reason');
  eq(unknown.unknownItems, ['moonstone'], 'unknownItems');
  [
    [0, 'zero'],
    [-1, 'negative'],
    [1.5, 'float'],
    ['2', 'string'],
    [100, 'over itemCap'],
  ].forEach((pair) => {
    const res = materials.sellPlan({ items: { building: pair[0] }, wallet: { credits: 10, items: { building: 100 } } });
    eq(res.ok, false, pair[1] + ' ok');
    eq(res.reason, 'bad-count', pair[1] + ' reason');
  });
  [{}, null, undefined, []].forEach((bad, index) => {
    const res = materials.sellPlan({ items: bad, wallet: { credits: 10 } });
    eq(res.reason, 'bad-items', 'bad items #' + index);
  });
  eq(materials.sellPlan(null).reason, 'bad-items', 'null input');
  return 'bad-items / bad-count / unknown-item';
});

await check('M-11 sellPlan 别名重复拒绝 + 库存别名合并', () => {
  configureReal();
  const dup = materials.sellPlan({ items: { crystal: 1, starcrystal: 1 }, wallet: { credits: 0, items: { crystal: 2 } } });
  eq(dup.ok, false, 'dup ok');
  eq(dup.reason, 'duplicate-item', 'dup reason');
  eq(dup.itemId, 'starcrystal', 'dup itemId');
  const merged = materials.sellPlan({
    items: { starcrystal: 2 },
    wallet: { credits: 0, items: { crystal: 1, starcrystal: 1 } },
  });
  eq(merged.ok, true, 'merged ok');
  eq(merged.credits, 96, 'merged credits');
  eq(merged.balanceAfter, 96, 'merged balance');
  const short = materials.sellPlan({
    items: { starcrystal: 3 },
    wallet: { credits: 0, items: { crystal: 1, starcrystal: 1 } },
  });
  eq(short.reason, 'insufficient-items', 'short reason');
  eq(short.missing, [{ kind: 'items', itemId: 'starcrystal', need: 3, have: 2 }], 'short missing');
  return 'alias merge = 2';
});

await check('M-12 sellPlan 单笔 payout 上限与余额上限', () => {
  configureReal();
  const ok = materials.sellPlan({ items: { starcrystal: 8 }, wallet: { credits: 0, items: { starcrystal: 8 } } });
  eq(ok.ok, true, 'ok');
  eq(ok.credits, 384, 'credits');
  const over = materials.sellPlan({ items: { starcrystal: 9 }, wallet: { credits: 0, items: { starcrystal: 9 } } });
  eq(over.ok, false, 'over ok');
  eq(over.reason, 'payout-cap', 'payout reason');
  eq(over.credits, 432, 'payout diagnostic credits');
  eq(over.balanceAfter, 0, 'payout balance unchanged');
  const capped = materials.sellPlan({ items: { building: 1 }, wallet: { credits: 999999, items: { building: 1 } } });
  eq(capped.ok, false, 'cap ok');
  eq(capped.reason, 'balance-cap', 'balance cap reason');
  eq(capped.balanceAfter, 999999, 'balance unchanged');
  return 'payout 400 / balance 1e6';
});

await check('M-13 sellPlan 钱包校验 + 绝不负余额', () => {
  configureReal();
  [undefined, null, {}, { credits: -1 }, { credits: 1.5 }, { credits: '100' }, { credits: 1000001 }].forEach(
    (wallet, index) => {
      const res = materials.sellPlan({ items: { building: 1 }, wallet });
      eq(res.ok, false, 'wallet #' + index + ' ok');
      eq(res.reason, 'wallet-unavailable', 'wallet #' + index + ' reason');
    }
  );
  materials.MATERIAL_IDS.forEach((itemId) => {
    const res = materials.sellPlan({ items: { [itemId]: 1 }, wallet: { credits: 0, items: { [itemId]: 1 } } });
    eq(res.ok, true, itemId + ' ok');
    eq(res.credits, materials.priceOf(itemId, 'sell'), itemId + ' credits');
    eq(res.balanceAfter, res.credits, itemId + ' balanceAfter');
    assert(res.balanceAfter >= 0, itemId + ' negative balance');
  });
  return 'wallet guards, balance never negative';
});

/* ------------------------------------------------------------------ *
 * M-14..M-17 buyPlan
 * ------------------------------------------------------------------ */

await check('M-14 buyPlan 总价/余额差/grants（含别名）', () => {
  configureReal();
  const res = materials.buyPlan({ items: { alloy: 2, electronics: 1 }, wallet: { credits: 500 } });
  eq(res.ok, true, 'ok');
  eq(res.items, { alloy: 2, electronics: 1 }, 'items');
  eq(res.unitPrices, { alloy: 80, electronics: 65 }, 'unitPrices');
  eq(res.cost, 225, 'cost');
  eq(res.creditsDelta, -225, 'creditsDelta');
  eq(res.balanceAfter, 275, 'balanceAfter');
  eq(res.grants, { items: { alloy: 2, electronics: 1 } }, 'grants');
  eq(res.missing, [], 'missing');
  const alias = materials.buyPlan({ items: { crystal: 1 }, wallet: { credits: 100 } });
  eq(alias.ok, true, 'alias ok');
  eq(alias.cost, 100, 'alias cost');
  eq(alias.items, { starcrystal: 1 }, 'alias canonical items');
  eq(alias.grants, { items: { starcrystal: 1 } }, 'alias grants');
  eq(alias.balanceAfter, 0, 'alias balanceAfter');
  return 'cost 225 / grants ready for db.purchase';
});

await check('M-15 buyPlan 余额不足返回 missing', () => {
  configureReal();
  const res = materials.buyPlan({ items: { alloy: 2 }, wallet: { credits: 100 } });
  eq(res.ok, false, 'ok');
  eq(res.reason, 'insufficient', 'reason');
  eq(res.cost, 160, 'cost');
  eq(res.missing, [{ kind: 'credits', itemId: null, need: 160, have: 100 }], 'missing');
  eq(res.balanceAfter, 100, 'balance unchanged');
  eq(res.grants, {}, 'no grants on failure');
  const exact = materials.buyPlan({ items: { alloy: 2 }, wallet: { credits: 160 } });
  eq(exact.ok, true, 'exact ok');
  eq(exact.balanceAfter, 0, 'exact balanceAfter');
  return 'need 160 have 100';
});

await check('M-16 buyPlan 库存堆叠上限', () => {
  configureReal();
  const over = materials.buyPlan({ items: { alloy: 2 }, wallet: { credits: 1000, items: { alloy: 998 } } });
  eq(over.ok, false, 'over ok');
  eq(over.reason, 'item-cap', 'over reason');
  eq(over.missing, [{ kind: 'stack', itemId: 'alloy', need: 1000, have: 998, cap: 999 }], 'over missing');
  const edge = materials.buyPlan({ items: { alloy: 2 }, wallet: { credits: 1000, items: { alloy: 997 } } });
  eq(edge.ok, true, 'edge ok');
  eq(edge.balanceAfter, 840, 'edge balanceAfter');
  const full = materials.buyPlan({ items: { building: 1 }, wallet: { credits: 1000, items: { building: 999 } } });
  eq(full.reason, 'item-cap', 'full reason');
  return 'stack cap 999';
});

await check('M-17 buyPlan 非法入参', () => {
  configureReal();
  eq(materials.buyPlan({ items: { moonstone: 1 }, wallet: { credits: 100 } }).reason, 'unknown-item', 'unknown');
  eq(materials.buyPlan({ items: { alloy: 1.5 }, wallet: { credits: 100 } }).reason, 'bad-count', 'float');
  eq(materials.buyPlan({ items: { alloy: 0 }, wallet: { credits: 100 } }).reason, 'bad-count', 'zero');
  eq(materials.buyPlan({ items: {}, wallet: { credits: 100 } }).reason, 'bad-items', 'empty');
  eq(materials.buyPlan({ items: { alloy: 1 }, wallet: { credits: -5 } }).reason, 'wallet-unavailable', 'wallet');
  eq(materials.buyPlan({ items: { alloy: 1 } }).reason, 'wallet-unavailable', 'no wallet');
  eq(materials.buyPlan({ items: { crystal: 1, starcrystal: 1 }, wallet: { credits: 500 } }).reason, 'duplicate-item', 'alias dup');
  return 'guards ok';
});

/* ------------------------------------------------------------------ *
 * M-18 买→卖负利润
 * ------------------------------------------------------------------ */

await check('M-18 买→卖负利润 + validateTradeRoundTrip', () => {
  configureReal();
  const start = 10000;
  materials.MATERIAL_IDS.forEach((itemId) => {
    const buy = materials.buyPlan({ items: { [itemId]: 1 }, wallet: { credits: start } });
    eq(buy.ok, true, itemId + ' buy ok');
    eq(buy.cost, materials.priceOf(itemId, 'buy'), itemId + ' buy cost');
    const sell = materials.sellPlan({
      items: { [itemId]: 1 },
      wallet: { credits: buy.balanceAfter, items: { [itemId]: 1 } },
    });
    eq(sell.ok, true, itemId + ' sell ok');
    eq(sell.credits, materials.priceOf(itemId, 'sell'), itemId + ' sell credits');
    assert(sell.credits - buy.cost < 0, itemId + ' round trip must lose money');
    eq(sell.balanceAfter, start - buy.cost + sell.credits, itemId + ' round trip balance');
  });
  const trip = materials.validateTradeRoundTrip();
  eq(trip.ok, true, 'trip ok');
  eq(trip.errors, [], 'trip errors');
  eq(trip.materials.length, 5, 'trip materials');
  assert(trip.maxRatio <= materials.SELL_PRICE_RATIO_MAX, 'maxRatio guard');
  trip.materials.forEach((entry) => {
    assert(entry.roundTripProfit < 0, entry.itemId + ' profit must be negative');
    assert(entry.ratio <= materials.SELL_PRICE_RATIO_MAX, entry.itemId + ' ratio guard');
    eq(entry.roundTripProfit, entry.sellPrice - entry.buyPrice, entry.itemId + ' profit math');
  });
  return 'losses 23/42/35/52/30';
});

/* ------------------------------------------------------------------ *
 * M-19/M-20 双来源
 * ------------------------------------------------------------------ */

await check('M-19 assertTwoSources 真实内容全通过', () => {
  configureReal();
  const res = materials.assertTwoSources();
  eq(res.ok, true, 'ok');
  eq(res.required, 2, 'required');
  eq(res.errors, [], 'errors');
  eq(res.materials.length, 5, 'materials');
  const list = materials.listMaterials();
  res.materials.forEach((entry, index) => {
    eq(entry.itemId, list[index].itemId, 'order');
    eq(entry.sources, list[index].sources, 'sources match listMaterials');
    eq(entry.count, entry.sources.length, 'count');
    assert(entry.count >= 2, entry.itemId + ' count >= 2');
  });
  return res.materials.map((entry) => entry.itemId + '=' + entry.count).join(' ');
});

await check('M-20 assertTwoSources 人为删来源报错', () => {
  const emptied = materials.configure({ items: REAL_ITEMS, commissions: { commissions: [] }, knownDrops: {} });
  eq(emptied.ok, true, 'empty configure ok');
  const empty = materials.assertTwoSources();
  eq(empty.ok, false, 'empty ok');
  eq(empty.errors.length, 5, 'empty errors');
  empty.errors.forEach((code) => assert(code.indexOf('insufficient-sources:') === 0, 'unexpected code ' + code));
  eq(
    materials.listMaterials().map((entry) => entry.sources),
    [[], [], [], [], []],
    'all sources removed'
  );
  const partial = materials.configure({
    items: REAL_ITEMS,
    commissions: { commissions: [] },
    knownDrops: { building: ['pendulum-tower', 'brick-breaker'] },
  });
  eq(partial.ok, true, 'partial configure ok');
  const two = materials.assertTwoSources();
  eq(two.ok, false, 'partial ok');
  eq(two.errors.length, 4, 'partial errors');
  assert(
    two.errors.every((code) => code.indexOf('insufficient-sources:building') < 0),
    'building should pass with 2 sources'
  );
  eq(materials.sourcesFor('building'), ['brick-breaker', 'pendulum-tower'], 'building sources');
  const aliasDrop = materials.configure({
    items: REAL_ITEMS,
    commissions: { commissions: [] },
    knownDrops: { crystal: ['star-raid', 'gold-miner'] },
  });
  eq(aliasDrop.ok, true, 'alias drop configure ok');
  eq(materials.sourcesFor('crystal'), ['gold-miner', 'star-raid'], 'alias drop sources canonicalized');
  configureReal();
  return 'full/partial source failures';
});

/* ------------------------------------------------------------------ *
 * M-21..M-24 configure 坏内容
 * ------------------------------------------------------------------ */

await check('M-21 configure 坏内容结构化失败（结构/材料/价表/名称）', () => {
  configureReal();
  const noItems = materials.configure({});
  eq(noItems.ok, false, 'no items ok');
  eq(noItems.reason, 'content-missing', 'no items reason');
  assert(hasError(noItems, 'content-missing:items'), 'no items error');
  eq(noItems.materialCount, 0, 'no items materialCount');

  const noMaterials = materials.configure({ items: {} });
  eq(noMaterials.reason, 'content-missing', 'no materials reason');
  assert(hasError(noMaterials, 'content-missing:materials'), 'no materials error');

  const notArray = materials.configure({ items: { materials: {} } });
  assert(hasError(notArray, 'content-missing:materials'), 'materials not array error');

  const four = clone(REAL_ITEMS);
  four.materials.pop();
  const fourRes = materials.configure({ items: four });
  eq(fourRes.ok, false, 'four ok');
  eq(fourRes.reason, 'content-invalid', 'four reason');
  assert(hasError(fourRes, 'material-count:4'), 'four count error');
  assert(hasError(fourRes, 'material-missing:biomass'), 'four missing error');
  eq(fourRes.materialCount, 4, 'four parsed count');

  const six = clone(REAL_ITEMS);
  six.materials.push({ itemId: 'moonstone', name: '月石', buyPrice: 10, sellPrice: 5 });
  const sixRes = materials.configure({ items: six });
  assert(hasError(sixRes, 'material-count:6'), 'six count error');
  assert(hasError(sixRes, 'material-unknown:moonstone'), 'six unknown error');

  const badRatio = clone(REAL_ITEMS);
  badRatio.materials[0].sellPrice = 30;
  const ratioRes = materials.configure({ items: badRatio });
  assert(hasError(ratioRes, 'price-ratio:building'), 'price ratio error');
  assert(hasError(ratioRes, 'price-table-drift:building:45/30'), 'price ratio drift error');

  const drift = clone(REAL_ITEMS);
  drift.materials[0].buyPrice = 46;
  assert(hasError(materials.configure({ items: drift }), 'price-table-drift:building:46/22'), 'price drift error');

  const duplicate = clone(REAL_ITEMS);
  duplicate.materials[4] = { itemId: 'building', name: '建材', buyPrice: 45, sellPrice: 22 };
  const dupRes = materials.configure({ items: duplicate });
  assert(hasError(dupRes, 'material-duplicate:building'), 'duplicate error');
  assert(hasError(dupRes, 'material-missing:biomass'), 'duplicate missing error');

  const noName = clone(REAL_ITEMS);
  noName.materials[0].name = '';
  assert(hasError(materials.configure({ items: noName }), 'material-name:building'), 'missing name error');

  const floatPrice = clone(REAL_ITEMS);
  floatPrice.materials[0].buyPrice = 45.5;
  assert(hasError(materials.configure({ items: floatPrice }), 'material-price:building'), 'float price error');

  const negativeSell = clone(REAL_ITEMS);
  negativeSell.materials[3].sellPrice = -1;
  assert(hasError(materials.configure({ items: negativeSell }), 'material-price:starcrystal'), 'negative sell error');

  /* 失败不抛、保留上一次成功状态。 */
  eq(materials.listMaterials().length, 5, 'state preserved after failures');
  eq(materials.assertTwoSources().ok, true, 'sources preserved after failures');

  const renamed = clone(REAL_ITEMS);
  renamed.materials[0].name = '砖头';
  const renameRes = materials.configure({ items: renamed });
  eq(renameRes.ok, true, 'rename ok');
  assert(hasWarning(renameRes, 'material-name-drift:building'), 'rename warning');
  configureReal();
  return '10 bad-content cases, state preserved';
});

await check('M-22 configure 坏别名 + 额外合法别名', () => {
  configureReal();
  const badTarget = clone(REAL_ITEMS);
  badTarget.materialAliases = { crystal2: 'moonstone' };
  const targetRes = materials.configure({ items: badTarget });
  eq(targetRes.ok, false, 'target ok');
  assert(hasError(targetRes, 'alias-target:crystal2'), 'alias target error');

  const conflict = clone(REAL_ITEMS);
  conflict.materialAliases = { alloy: 'starcrystal' };
  assert(hasError(materials.configure({ items: conflict }), 'alias-conflict:alloy'), 'alias conflict error');

  const forbidden = clone(REAL_ITEMS);
  forbidden.materialAliases = { crystal: 'building' };
  assert(hasError(materials.configure({ items: forbidden }), 'alias-forbidden:crystal'), 'alias forbidden error');

  const badShape = clone(REAL_ITEMS);
  badShape.materialAliases = 'nope';
  assert(hasError(materials.configure({ items: badShape }), 'alias-invalid:materialAliases'), 'alias shape error');

  const missingAliases = clone(REAL_ITEMS);
  delete missingAliases.materialAliases;
  const missingRes = materials.configure({ items: missingAliases });
  eq(missingRes.ok, true, 'missing aliases ok');
  assert(hasWarning(missingRes, 'alias-missing'), 'alias-missing warning');
  eq(materials.normalizeItemId('crystal'), 'starcrystal', 'crystal still mapped without content aliases');

  const extra = clone(REAL_ITEMS);
  extra.materialAliases = { crystal: 'starcrystal', legacyalloy: 'alloy' };
  const extraRes = materials.configure({ items: extra });
  eq(extraRes.ok, true, 'extra alias ok');
  eq(extraRes.aliasCount, 2, 'aliasCount');
  eq(materials.listMaterials().length, 5, 'extra alias does not add a material');
  eq(materials.getMaterial('alloy').aliases, ['legacyalloy'], 'alloy alias list');
  eq(materials.normalizeItemId('legacyalloy'), 'alloy', 'extra alias maps');
  configureReal();
  return 'bad aliases rejected, extra alias works';
});

await check('M-23 configure 委托非法/未知奖励物品（结构化降级）', () => {
  configureReal();
  const invalid = materials.configure({ items: REAL_ITEMS, commissions: { commissions: 'nope' } });
  eq(invalid.ok, false, 'invalid commissions ok');
  assert(hasError(invalid, 'commissions-invalid'), 'invalid commissions error');

  const unknownItem = materials.configure({
    items: REAL_ITEMS,
    commissions: { commissions: [{ commissionId: 'x.T1', gameId: 'memory-flip', reward: { items: { moonstone: 1 } } }] },
  });
  eq(unknownItem.ok, true, 'unknown item ok');
  assert(hasWarning(unknownItem, 'commission-count:1'), 'commission-count warning');
  assert(hasWarning(unknownItem, 'unknown-reward-item:moonstone'), 'unknown reward item warning');
  eq(materials.sourcesFor('alloy').length, 3, 'unknown reward item contributes no source');

  const badGame = materials.configure({
    items: REAL_ITEMS,
    commissions: { commissions: [{ commissionId: 'x.T1', gameId: 'NOT A GAME', reward: { items: { alloy: 1 } } }] },
  });
  eq(badGame.ok, true, 'bad game ok');
  assert(hasWarning(badGame, 'reward-game:x.T1'), 'reward game warning');

  const badCount = materials.configure({
    items: REAL_ITEMS,
    commissions: { commissions: [{ commissionId: 'x.T1', gameId: 'memory-flip', reward: { items: { alloy: 0 } } }] },
  });
  assert(hasWarning(badCount, 'reward-count:alloy'), 'reward count warning');

  const badItems = materials.configure({
    items: REAL_ITEMS,
    commissions: { commissions: [{ commissionId: 'x.T1', gameId: 'memory-flip', reward: { items: 'nope' } }] },
  });
  assert(hasWarning(badItems, 'reward-items-invalid:x.T1'), 'reward items warning');
  configureReal();
  return 'invalid / unknown item / bad game / bad count';
});

await check('M-24 configure 缺 commissions 仍可用（仅 0.16 已知掉落）', () => {
  const res = materials.configure({ items: REAL_ITEMS });
  eq(res.ok, true, 'ok');
  eq(res.commissionCount, 0, 'commissionCount');
  assert(hasWarning(res, 'commissions-missing'), 'commissions-missing warning');
  eq(res.sourceCounts, { building: 2, alloy: 3, electronics: 2, starcrystal: 2, biomass: 2 }, 'drops-only counts');
  const two = materials.assertTwoSources();
  eq(two.ok, true, 'two sources still ok');
  two.materials.forEach((entry) => assert(entry.count >= 2, entry.itemId + ' count'));
  configureReal();
  return 'drops-only still >= 2 sources';
});

/* ------------------------------------------------------------------ *
 * M-25 96 委托白名单
 * ------------------------------------------------------------------ */

await check('M-25 96 委托 reward.items 只含白名单材料（含 T4–T6）', () => {
  eq(REAL_COMMISSIONS.commissions.length, 96, '96 commissions');
  const tiers = {};
  const used = {};
  const tier46 = {};
  REAL_COMMISSIONS.commissions.forEach((commission) => {
    tiers[commission.tier] = (tiers[commission.tier] || 0) + 1;
    const items = commission.reward && commission.reward.items ? commission.reward.items : {};
    const keys = Object.keys(items);
    assert(keys.length <= 8, commission.commissionId + ' item kinds cap');
    keys.forEach((key) => {
      const canonical = materials.normalizeItemId(key);
      assert(canonical, commission.commissionId + ' non-whitelist item ' + key);
      used[canonical] = true;
      if (commission.tier >= 4) tier46[canonical] = true;
      const count = items[key];
      assert(Number.isInteger(count) && count > 0 && count <= 99, commission.commissionId + ' bad count ' + key);
    });
  });
  eq(Object.keys(tiers).map(Number).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6], 'tiers');
  Object.keys(tiers).forEach((tier) => eq(tiers[tier], 16, 'tier ' + tier + ' count'));
  const sortedIds = materials.MATERIAL_IDS.slice().sort();
  eq(Object.keys(used).sort(), sortedIds, 'all five materials used');
  eq(Object.keys(tier46).sort(), sortedIds, 'T4-T6 cover all five materials');
  return '96 commissions, T4-T6 whitelisted';
});

/* ------------------------------------------------------------------ *
 * M-26..M-32 契约与边界
 * ------------------------------------------------------------------ */

await check('M-26 确定性（同输入同输出）', () => {
  const first = materials.configure({ items: REAL_ITEMS, commissions: REAL_COMMISSIONS });
  const listA = JSON.stringify(materials.listMaterials());
  const twoA = JSON.stringify(materials.assertTwoSources());
  const tripA = JSON.stringify(materials.validateTradeRoundTrip());
  const sellRequest = { items: { crystal: 1, building: 2 }, wallet: { credits: 42, items: { crystal: 1, building: 2 } } };
  const sellA = JSON.stringify(materials.sellPlan(sellRequest));
  const buyRequest = { items: { alloy: 2 }, wallet: { credits: 300 } };
  const buyA = JSON.stringify(materials.buyPlan(buyRequest));
  const statusA = JSON.stringify(materials.status());
  const second = materials.configure({ items: REAL_ITEMS, commissions: REAL_COMMISSIONS });
  eq(JSON.stringify(second), JSON.stringify(first), 'configure deterministic');
  eq(JSON.stringify(materials.listMaterials()), listA, 'listMaterials deterministic');
  eq(JSON.stringify(materials.assertTwoSources()), twoA, 'assertTwoSources deterministic');
  eq(JSON.stringify(materials.validateTradeRoundTrip()), tripA, 'validateTradeRoundTrip deterministic');
  eq(JSON.stringify(materials.sellPlan(sellRequest)), sellA, 'sellPlan deterministic');
  eq(JSON.stringify(materials.buyPlan(buyRequest)), buyA, 'buyPlan deterministic');
  eq(JSON.stringify(materials.status()), statusA, 'status deterministic');
  return 'all outputs stable';
});

await check('M-27 configure 深拷贝（外部篡改内容不影响状态）', () => {
  const items = clone(REAL_ITEMS);
  const commissions = clone(REAL_COMMISSIONS);
  eq(materials.configure({ items, commissions }).ok, true, 'configure ok');
  const before = JSON.stringify(materials.listMaterials());
  items.materials[0].buyPrice = 9999;
  items.materials[0].sellPrice = 0;
  items.materialAliases = { crystal: 'building' };
  commissions.commissions.forEach((commission) => {
    if (commission.reward && commission.reward.items) commission.reward.items.moonstone = 5;
  });
  eq(JSON.stringify(materials.listMaterials()), before, 'state unaffected by input mutation');
  eq(materials.normalizeItemId('crystal'), 'starcrystal', 'alias unaffected');
  eq(materials.priceOf('building', 'buy'), 45, 'price unaffected');
  configureReal();
  return 'deep copy';
});

await check('M-28 静态边界：无 fs/网络/IDB/DOM/随机/时钟；craftCost 留给 crafting', () => {
  const code = MODULE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  [
    [/\bdocument\s*\./, 'document.'],
    [/\bindexedDB\b/, 'indexedDB'],
    [/\bfetch\s*\(/, 'fetch('],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
    [/\blocalStorage\b/, 'localStorage'],
    [/\bsessionStorage\b/, 'sessionStorage'],
    [/\bnavigator\s*\./, 'navigator.'],
    [/\brequire\s*\(/, 'require('],
    [/\bimport\s*\(/, 'import('],
    [/\bMath\s*\.\s*random\b/, 'Math.random'],
    [/\bDate\s*\.\s*now\b/, 'Date.now'],
    [/\bnew\s+Date\b/, 'new Date'],
    [/\bprocess\s*\./, 'process.'],
    [/\bWebSocket\b/, 'WebSocket'],
    [/\bsetTimeout\b/, 'setTimeout'],
    [/\bsetInterval\b/, 'setInterval'],
  ].forEach((pair) => {
    const match = code.match(pair[0]);
    if (match) throw new Error('forbidden API in code: ' + pair[1] + ' @' + match.index);
  });
  assert(code.indexOf('root.ArcadeCareerMaterials = api') >= 0, 'browser global marker');
  assert(code.indexOf('career.materials = api') >= 0, 'ArcadeCareer.materials mirror marker');
  assert(typeof materials.craftCost === 'undefined', 'craftCost must belong to crafting.js');
  assert(typeof materials.craftPlan === 'undefined', 'craftPlan must belong to crafting.js');
  return 'static boundary clean';
});

await check('M-29 RULESET 镜像与 career-core.RULESET 防漂移', () => {
  ['payoutCap', 'itemCapPerItem', 'itemKindsCap', 'inventoryStackCap', 'balanceCap', 'maxPurchaseCost'].forEach((key) => {
    assert(Number.isInteger(core.RULESET[key]), 'core.RULESET.' + key + ' missing');
    eq(materials.RULESET_MIRROR[key], core.RULESET[key], key);
  });
  return 'mirror in sync';
});

await check('M-30 status / isConfigured / reset', () => {
  configureReal();
  const st = materials.status();
  eq(st.moduleVersion, '0.18.0', 'moduleVersion');
  eq(st.schemaVersion, 1, 'schemaVersion');
  eq(st.configured, true, 'configured');
  eq(st.materialCount, 5, 'materialCount');
  eq(st.aliasCount, 1, 'aliasCount');
  eq(st.commissionCount, 96, 'commissionCount');
  eq(st.contentVersion, REAL_ITEMS.contentVersion, 'contentVersion');
  eq(materials.isConfigured(), true, 'isConfigured');
  eq(materials.reset(), { ok: true }, 'reset result');
  eq(materials.isConfigured(), false, 'reset configured');
  eq(materials.status().materialCount, 0, 'reset materialCount');
  eq(materials.listMaterials(), [], 'reset listMaterials');
  configureReal();
  return 'status/reset ok';
});

await check('M-31 计划结果满足 career-db 入参约定（卖/买）', () => {
  configureReal();
  const sell = materials.sellPlan({ items: { building: 3 }, wallet: { credits: 0, items: { building: 3 } } });
  eq(sell.ok, true, 'sell ok');
  assert(Number.isInteger(sell.credits) && sell.credits > 0 && sell.credits <= core.RULESET.payoutCap, 'sell credits');
  Object.keys(sell.items).forEach((itemId) => {
    assert(core.isToken(itemId), 'sell item token ' + itemId);
    const count = sell.items[itemId];
    assert(
      Number.isInteger(count) && count > 0 && count <= core.RULESET.itemCapPerItem,
      'sell item count ' + itemId
    );
  });
  const buy = materials.buyPlan({ items: { alloy: 1, starcrystal: 1 }, wallet: { credits: 500 } });
  eq(buy.ok, true, 'buy ok');
  const approved = core.purchasePlan({ cost: buy.cost, grants: buy.grants, wallet: { credits: 500, items: {} } });
  eq(approved.ok, true, 'career-core.purchasePlan accepts buy plan');
  eq(approved.plan.balanceAfter, buy.balanceAfter, 'balanceAfter matches career-core');
  eq(approved.plan.items, buy.grants.items, 'grants match career-core');
  return 'db-compatible plan shapes';
});

await check('M-32 来源 gameId 均来自真实 16 款 registry', () => {
  configureReal();
  const gameIds = new Set((REAL_REGISTRY.games || []).map((game) => game.gameId));
  eq(gameIds.size, 16, 'registry games');
  materials.listMaterials().forEach((entry) => {
    entry.sources.forEach((gameId) => {
      assert(gameIds.has(gameId), entry.itemId + ' unknown source game ' + gameId);
    });
  });
  materials.MATERIAL_IDS.forEach((itemId) => {
    (materials.KNOWN_DROPS[itemId] || []).forEach((gameId) => {
      assert(gameIds.has(gameId), itemId + ' known drop game missing from registry: ' + gameId);
      assert(materials.sourcesFor(itemId).indexOf(gameId) >= 0, itemId + ' known drop missing from sources');
    });
  });
  return 'all sources are real arcade games';
});

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */

console.log('');
console.log(`${total - failed}/${total} checks passed`);
if (failed > 0) {
  console.error(`FAILED: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('PASS  career materials test (D17-19)');
process.exit(0);
