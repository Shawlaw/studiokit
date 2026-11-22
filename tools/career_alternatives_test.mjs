#!/usr/bin/env node
/**
 * Arcade Life 0.16 非战斗 / 代办替代路径门禁（D16-10）
 * apps/arcade/career/alternatives.js 的纯 Node 确定性测试。
 *
 * 覆盖：
 * - UMD 双端导出（Node require + 浏览器 window 挂载/镜像）与默认单例；
 * - 内置默认 offers（alt.courier 120 / alt.records 90+alloy1）的明码标价、旗标、证据、
 *   无 wait/cooldown/deadline、无战斗旗标；
 * - configure 内容规范化（缺字段 / 非法 cost / 非法材料 / 非法旗标 / 战斗旗标 /
 *   时间等待 / 重复 ID / 节点冲突 / 非法 requires / 循环引用），非法内容只进 errors 不抛；
 * - listOffers：读 readWallet + readQuestState + getEquipment、零写入、差额 missing、
 *   affordable、alreadyDone、unlocked（requires.flags）、缺 wallet / 读失败降级；
 * - buy：先只读判断 → db.purchase 原子扣费（成本/材料/幂等）→ 一次 putQuests 写两行
 *   （kind:'alternative' + kind:'story'）；余额不足/材料不足/DB 拒绝/抛异常均零写入；
 *   扣费成功而 putQuests 失败返回 quest-write-failed（钱已扣、旗标未记）；
 *   重试同一 offer 用 ledger 探测 + purchaseId 幂等补记，不重复扣费；
 * - hasFlag / listCompleted；
 * - 完整性：只写 alternative/story 行、无战斗旗标、不调用任何领奖/建生涯接口、
 *   购买只扣款不发放、静态源码断言（无结算/领奖/存储/网络/DOM API）。
 *
 * 纯 Node：require 真实 career-core（含 registry），career-db 用内存假实现注入
 * （语义对齐 apps/arcade/career/career-db.js 的公开方法；测试同时读取该源码做形状对照）。
 * 零 npm 依赖；不启动 Chrome、不写仓库文件。
 *
 * 运行：node tools/career_alternatives_test.mjs
 * 退出码：0 全部通过；1 有失败；2 装配失败（模块/源码读取失败）。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const MODULE_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'alternatives.js');
const CORE_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'career-core.js');
const DB_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'career-db.js');

const NOW = '2026-11-23T02:00:00.000Z';
const FORBIDDEN_TEST_FLAGS = ['C1.work_done', 'C1.flight_done', 'C1.storm_done'];
const READ_ONLY_CALLS = ['readWallet', 'readQuestState', 'getEquipment', 'readLedger', 'getProfile'];
const WRITE_CALLS = ['purchase', 'putQuests', 'settleAndClaim', 'ensureCareer', 'createRun', 'writeEquipment'];

function readOrExit(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.error('ENV: 无法读取 ' + path.relative(REPO_ROOT, file) + ' — ' + err.message);
    process.exit(2);
  }
}

const moduleSource = readOrExit(MODULE_PATH);
const dbSource = readOrExit(DB_PATH);

let core;
try {
  core = require(CORE_PATH);
} catch (err) {
  console.error('ENV: 无法 require career-core.js — ' + (err && err.message ? err.message : err));
  process.exit(2);
}

let alternatives;
try {
  alternatives = require(MODULE_PATH);
} catch (err) {
  console.error('ENV: 无法 require alternatives.js — ' + (err && err.message ? err.message : err));
  process.exit(2);
}
if (!alternatives || typeof alternatives !== 'object' || typeof alternatives.createAlternatives !== 'function') {
  console.error('ENV: alternatives.js 导出不是带 createAlternatives 的对象');
  process.exit(2);
}

/* ------------------------------------------------------------------ *
 * 断言与记录
 * ------------------------------------------------------------------ */

let total = 0;
let passed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function eq(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error((label ? label + ': ' : '') + 'expected ' + right + ' got ' + left);
}

function includes(haystack, needle, label) {
  const text = typeof haystack === 'string' ? haystack : JSON.stringify(haystack);
  assert(text.indexOf(needle) >= 0, (label || 'includes') + ': 缺少 ' + JSON.stringify(needle) + ' in ' + text.slice(0, 300));
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

async function check(name, fn) {
  total += 1;
  try {
    const info = await fn();
    passed += 1;
    console.log('PASS  ' + name + (info && typeof info === 'string' ? ' — ' + info : ''));
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    failures.push(name + ': ' + message);
    console.log('FAIL  ' + name + ' — ' + message);
  }
}

/* ------------------------------------------------------------------ *
 * 夹具：内存假 career-db（语义对齐 career-db.js 公开方法）
 * ------------------------------------------------------------------ */

const allFakes = [];

function createFakeDb(options) {
  const opts = options || {};
  const store = {
    balances: Object.create(null),
    inventory: Object.create(null),
    quests: [],
    ledger: [],
    profiles: Object.create(null),
    calls: [],
    violations: [],
  };
  const failures = Object.assign(
    {
      purchase: null,
      putQuests: null,
      readQuestState: null,
      readWallet: null,
      readLedger: null,
      getEquipment: null,
      beforePurchase: null,
    },
    opts.failures || {},
  );

  function log(name, payload) {
    store.calls.push({ name, payload: payload === undefined ? null : clone(payload) });
  }

  function failure(reason) {
    return { ok: false, reason, error: reason };
  }

  if (opts.careerId) {
    store.balances[opts.careerId] = {
      careerId: opts.careerId,
      credits: typeof opts.credits === 'number' ? opts.credits : 0,
      revision: 1,
    };
    store.inventory[opts.careerId] = Object.assign({}, opts.items || {});
    store.profiles[opts.careerId] = {
      careerId: opts.careerId,
      flags: Array.isArray(opts.profileFlags) ? opts.profileFlags.slice() : [],
    };
  }

  async function readWallet(careerId) {
    log('readWallet', careerId);
    if (failures.readWallet === 'throw') throw new Error('injected readWallet throw');
    if (failures.readWallet === 'unavailable') return { ok: false, reason: 'wallet-unavailable', credits: 0, items: {}, equipment: {} };
    if (!core.isValidCareerId(careerId)) return { ok: false, reason: 'bad-career-id', credits: 0, items: {}, equipment: {} };
    const balance = store.balances[careerId];
    return {
      ok: true,
      careerId,
      exists: !!balance,
      credits: balance ? balance.credits : 0,
      revision: balance ? balance.revision : 0,
      items: clone(store.inventory[careerId] || {}),
      equipment: {},
    };
  }

  async function readQuestState(careerId) {
    log('readQuestState', careerId);
    if (failures.readQuestState === 'throw') throw new Error('injected readQuestState throw');
    if (failures.readQuestState) return failure('injected-read-quests');
    const quests = store.quests.filter((row) => row.careerId === careerId).map(clone);
    const byNode = {};
    quests.forEach((row) => {
      byNode[row.nodeId] = row;
    });
    return { ok: true, careerId, quests, byNode };
  }

  async function getEquipment(careerId) {
    log('getEquipment', careerId);
    if (failures.getEquipment === 'throw') throw new Error('injected getEquipment throw');
    if (failures.getEquipment) return failure('injected-equipment');
    if (!store.balances[careerId]) return failure('no-wallet');
    return { ok: true, careerId, equipment: {} };
  }

  async function readLedger(careerId, limit) {
    log('readLedger', { careerId, limit });
    if (failures.readLedger === 'throw') throw new Error('injected readLedger throw');
    if (failures.readLedger) return { ok: false, reason: 'injected-ledger', rows: [] };
    const max = Math.max(1, Math.min(100, Math.floor(Number(limit) || 30)));
    const rows = store.ledger
      .filter((row) => row.careerId === careerId)
      .slice(-max)
      .map((row) => ({ txId: row.txId, kind: row.kind, credits: row.credits, cost: row.cost, at: row.at }));
    return { ok: true, careerId, rows };
  }

  async function getProfile(careerId) {
    log('getProfile', careerId);
    const profile = store.profiles[careerId];
    return profile ? clone(profile) : null;
  }

  async function purchase(input) {
    log('purchase', input);
    if (typeof failures.beforePurchase === 'function') failures.beforePurchase(store, input);
    if (failures.purchase === 'throw') throw new Error('injected purchase throw');
    if (typeof failures.purchase === 'string') return failure(failures.purchase);
    const careerId = input && input.careerId;
    if (!core.isValidCareerId(careerId)) return failure('bad-career-id');
    const purchaseId = input && input.purchaseId;
    if (!core.isToken(purchaseId)) return failure('bad-purchase-id');
    const cost = input && input.cost;
    const costItems = input && input.costItems && typeof input.costItems === 'object' ? clone(input.costItems) : {};
    const grants = input && input.grants && typeof input.grants === 'object' ? clone(input.grants) : {};
    const txId = 'purchase:' + purchaseId;
    const existing = store.ledger.filter((row) => row.txId === txId)[0];
    if (existing) return { ok: true, duplicate: true, receipt: clone(existing.receipt) };
    const wallet = store.balances[careerId];
    if (!wallet) return failure('no-wallet');
    const plan = core.purchasePlan({
      cost,
      costItems,
      grants,
      wallet: { credits: wallet.credits, items: clone(store.inventory[careerId] || {}) },
    });
    if (!plan.ok) return failure(plan.reason);
    /* 完整性探针：代办路径不得发放材料/装备，也不得出现非扣款流水。 */
    if (Object.keys(plan.plan.items).length > 0) store.violations.push('grant-items');
    if (Object.keys(plan.plan.equipment).length > 0) store.violations.push('grant-equipment');
    if (!(plan.plan.creditsDelta < 0)) store.violations.push('non-deduction');
    wallet.credits = plan.plan.balanceAfter;
    wallet.revision += 1;
    const inventory = store.inventory[careerId];
    Object.keys(plan.plan.costItems).forEach((itemId) => {
      const left = Math.max(0, (inventory[itemId] || 0) - plan.plan.costItems[itemId]);
      if (left === 0) delete inventory[itemId];
      else inventory[itemId] = left;
    });
    Object.keys(plan.plan.items).forEach((itemId) => {
      inventory[itemId] = (inventory[itemId] || 0) + plan.plan.items[itemId];
    });
    const receipt = {
      schemaVersion: 1,
      kind: 'purchase',
      receiptId: txId,
      purchaseId,
      careerId,
      cost: plan.plan.cost,
      costItems: clone(plan.plan.costItems),
      items: clone(plan.plan.items),
      equipment: clone(plan.plan.equipment),
      txIds: [txId],
      balanceAfter: plan.plan.balanceAfter,
      purchasedAt: NOW,
      rulesetVersion: 1,
      contentVersion: '0.17.0',
    };
    store.ledger.push({
      txId,
      careerId,
      kind: 'purchase',
      purchaseId,
      cost: plan.plan.cost,
      costItems: clone(plan.plan.costItems),
      credits: plan.plan.creditsDelta,
      balanceAfter: plan.plan.balanceAfter,
      at: NOW,
      receipt,
    });
    return { ok: true, duplicate: false, receipt: clone(receipt) };
  }

  /** 对齐真实 putQuests：先整批校验 nodeId token，再一次性写入（失败零写入）。 */
  async function putQuests(careerId, quests) {
    log('putQuests', { careerId, quests });
    if (failures.putQuests === 'throw') throw new Error('injected putQuests throw');
    if (failures.putQuests) return failure('injected-put-quests');
    if (!core.isValidCareerId(careerId)) return failure('bad-career-id');
    const list = Array.isArray(quests) ? quests : [];
    if (!list.length) return failure('bad-quests');
    const records = [];
    for (const raw of list) {
      if (!raw || typeof raw !== 'object' || !core.isToken(raw.nodeId)) return failure('bad-quest');
      const record = Object.assign(clone(raw), {
        careerId,
        nodeId: raw.nodeId,
        schemaVersion: 1,
        updatedAt: NOW,
      });
      /* 完整性探针：代办路径只允许 alternative/story 行，且不得含战斗旗标。 */
      if (record.kind !== 'alternative' && record.kind !== 'story') store.violations.push('unexpected-kind:' + String(record.kind));
      (Array.isArray(record.flags) ? record.flags : []).forEach((flag) => {
        if (FORBIDDEN_TEST_FLAGS.indexOf(flag) >= 0) store.violations.push('forbidden-flag:' + flag);
      });
      records.push(record);
    }
    for (const record of records) {
      store.quests = store.quests.filter((row) => !(row.careerId === careerId && row.nodeId === record.nodeId));
      store.quests.push(record);
    }
    return { ok: true, count: records.length };
  }

  async function settleAndClaim() {
    log('settleAndClaim');
    store.violations.push('settleAndClaim');
    return failure('forbidden');
  }

  async function ensureCareer() {
    log('ensureCareer');
    store.violations.push('ensureCareer');
    return failure('forbidden');
  }

  async function createRun() {
    log('createRun');
    store.violations.push('createRun');
    return failure('forbidden');
  }

  async function writeEquipment() {
    log('writeEquipment');
    store.violations.push('writeEquipment');
    return failure('forbidden');
  }

  const db = {
    readWallet,
    readQuestState,
    getEquipment,
    readLedger,
    getProfile,
    purchase,
    putQuests,
    settleAndClaim,
    ensureCareer,
    createRun,
    writeEquipment,
  };
  if (opts.minimalRead === true) delete db.readLedger;

  const fake = { db, store, failures };
  allFakes.push(fake);
  return fake;
}

function callsOf(fake, name) {
  return fake.store.calls.filter((call) => call.name === name);
}

function callNames(fake) {
  return fake.store.calls.map((call) => call.name);
}

function makeAlt(options) {
  return alternatives.createAlternatives(Object.assign({ core, now: () => NOW }, options || {}));
}

function offerFixture(offerId, overrides) {
  return Object.assign(
    {
      offerId,
      title: '试工：' + offerId,
      summary: '在旧港按部就班地办一件小事。',
      issuer: '旧港办事处',
      cost: { credits: 10 },
      flags: ['C1.' + offerId.replace(/[^A-Za-z0-9]/g, '')],
      evidence: ['E-' + offerId.replace(/[^A-Za-z0-9]/g, '')],
    },
    overrides || {},
  );
}

function hasKeyDeep(value, key, depth) {
  const limit = typeof depth === 'number' ? depth : 5;
  if (limit <= 0 || !value || typeof value !== 'object') return false;
  return Object.keys(value).some((name) => {
    if (String(name).toLowerCase() === key) return true;
    return hasKeyDeep(value[name], key, limit - 1);
  });
}

function readBrowserMount() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(moduleSource, sandbox, { filename: 'alternatives.browser.js' });
  return sandbox.window;
}

/* ------------------------------------------------------------------ *
 * A. UMD / 默认内容
 * ------------------------------------------------------------------ */

const browserWindow = readBrowserMount();

await check('A01 Node 导出：UMD module.exports 带完整 API', () => {
  const names = ['createAlternatives', 'configure', 'getOffer', 'getState', 'getContentVersion', 'listOffers', 'buy', 'hasFlag', 'listCompleted'];
  names.forEach((name) => assert(typeof alternatives[name] === 'function', '缺少方法 ' + name));
  eq(alternatives.OFFER_KIND, 'alternative');
  eq(alternatives.STORY_KIND, 'story');
  eq(alternatives.VERSION, '0.17.0');
  eq(alternatives.CONTENT_VERSION, '0.17.0');
  eq(alternatives.MODULE_VERSION, '0.17.0');
  return '9 methods';
});

await check('A02 浏览器挂载：ArcadeCareerAlternatives + 镜像 ArcadeCareer.alternatives 同一对象', () => {
  const api = browserWindow.ArcadeCareerAlternatives;
  assert(api && typeof api === 'object', '未挂载 ArcadeCareerAlternatives');
  assert(browserWindow.ArcadeCareer && browserWindow.ArcadeCareer.alternatives === api, '未镜像到 ArcadeCareer.alternatives');
  eq(api.VERSION, '0.17.0');
  return 'mirrored';
});

await check('A03 默认单例：内置 2 条 offer，无内容错误', () => {
  const state = alternatives.getState();
  eq(state.count, 2);
  eq(state.contentVersion, '0.17.0');
  eq(state.source, 'default');
  eq(state.errors, []);
  return state.offerIds.join(',');
});

await check('A04 默认内容：alt.courier 120 信用点 / C1.signal / E-C1-courier，无材料', () => {
  const offer = alternatives.getOffer('alt.courier');
  assert(offer, '缺少 alt.courier');
  eq(offer.cost, { credits: 120, items: {} });
  eq(offer.flags, ['C1.signal']);
  eq(offer.evidence, ['E-C1-courier']);
  eq(offer.requires, { flags: [] });
  assert(offer.title.length > 0 && offer.summary.length > 0 && offer.issuer.length > 0, '标题/摘要/发布者为空');
  return offer.title;
});

await check('A05 默认内容：alt.records 90 信用点 + alloy:1 / C1.records / E-C1-records', () => {
  const offer = alternatives.getOffer('alt.records');
  assert(offer, '缺少 alt.records');
  eq(offer.cost, { credits: 90, items: { alloy: 1 } });
  eq(offer.flags, ['C1.records']);
  eq(offer.evidence, ['E-C1-records']);
  assert(offer.title.length > 0 && offer.summary.length > 0, '标题/摘要为空');
  return offer.title;
});

await check('A06 默认内容无 wait/cooldown/deadline 字段（含嵌套）', () => {
  ['alt.courier', 'alt.records'].forEach((offerId) => {
    const offer = alternatives.getOffer(offerId);
    ['wait', 'cooldown', 'deadline'].forEach((key) => {
      assert(!hasKeyDeep(offer, key), offerId + ' 含真实时间等待字段 ' + key);
    });
  });
  return 'no-timing';
});

await check('A07 默认内容旗标/证据不含战斗路线旗标', () => {
  ['alt.courier', 'alt.records'].forEach((offerId) => {
    const offer = alternatives.getOffer(offerId);
    offer.flags.concat(offer.evidence).forEach((token) => {
      assert(FORBIDDEN_TEST_FLAGS.indexOf(token) < 0, offerId + ' 含战斗旗标 ' + token);
    });
  });
  return 'alt-only';
});

await check('A08 RULESET 镜像与 career-core.RULESET 防漂移', () => {
  const mirror = alternatives.RULESET_MIRROR;
  eq(mirror.maxPurchaseCost, core.RULESET.maxPurchaseCost, 'maxPurchaseCost');
  eq(mirror.itemCapPerItem, core.RULESET.itemCapPerItem, 'itemCapPerItem');
  eq(mirror.itemKindsCap, core.RULESET.itemKindsCap, 'itemKindsCap');
  eq(mirror.evidenceCap, core.RULESET.evidenceCap, 'evidenceCap');
  eq(mirror.flagsCap, core.RULESET.flagsCap, 'flagsCap');
  return 'mirror-in-sync';
});

await check('A09 configure() 缺省使用内置默认内容', () => {
  const alt = makeAlt({ db: createFakeDb({ careerId: 'a09', credits: 0 }).db });
  const result = alt.configure();
  eq(result.ok, true);
  eq(result.count, 2);
  eq(result.errors, []);
  eq(result.source, 'default');
  eq(result.offerIds, ['alt.courier', 'alt.records']);
  return 'count=2';
});

await check('A10 工厂隔离：configure 只影响本实例', () => {
  const fake = createFakeDb({ careerId: 'a10', credits: 100 });
  const first = makeAlt({ db: fake.db });
  const second = makeAlt({ db: fake.db });
  equalConfigure(first, [{ offerId: 'alt.only', title: '只有一单', summary: '只办这一件小事。', issuer: '旧港', cost: { credits: 5 }, flags: ['C1.only'], evidence: ['E-only'] }]);
  eq(first.getState().count, 1);
  eq(second.getState().count, 2);
  eq(second.getState().offerIds, ['alt.courier', 'alt.records']);
  return 'isolated';
});

function equalConfigure(alt, offers) {
  const result = alt.configure({ content: { contentVersion: '0.17.0', offers } });
  assert(result.ok === true, 'configure 失败: ' + JSON.stringify(result));
  return result;
}

/* ------------------------------------------------------------------ *
 * B. configure / 内容规范化
 * ------------------------------------------------------------------ */

await check('B01 configure 接受合法内容（对象形态），非法内容只进 errors 不抛', () => {
  const alt = makeAlt({ db: createFakeDb({ careerId: 'b01', credits: 100 }).db });
  const bad = {
    contentVersion: '0.17.0',
    offers: [
      null,
      {},
      offerFixture('bad id'),
      offerFixture('no.cost', { cost: undefined }),
      offerFixture('zero.cost', { cost: { credits: 0 } }),
      offerFixture('str.cost', { cost: { credits: '10' } }),
      offerFixture('frac.cost', { cost: { credits: 1.5 } }),
      offerFixture('zero.items', { cost: { credits: 10, items: { alloy: 0 } } }),
      offerFixture('many.items', { cost: { credits: 10, items: { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1, i: 1 } } }),
      offerFixture('no.flags', { flags: undefined }),
      offerFixture('bad.flag', { flags: ['!bad'] }),
      offerFixture('no.evidence', { evidence: undefined }),
      offerFixture('timed.wait', { wait: 3 }),
      offerFixture('timed.nested', { cost: { credits: 10, cooldown: 2 } }),
      offerFixture('timed.deadline', { deadline: '2027-01-01' }),
      offerFixture('combat.flag', { flags: ['C1.work_done'] }),
      offerFixture('combat.evidence', { evidence: ['C1.flight_done'] }),
      offerFixture('collision.node', { flags: ['collision.node'] }),
      offerFixture('bad.requires', { requires: 'yes' }),
      offerFixture('too.many.flags', { flags: Array.from({ length: 25 }, (_, index) => 'C1.flag' + index) }),
      offerFixture('dup.offer'),
      offerFixture('dup.offer'),
      offerFixture('keep.offer'),
    ],
  };
  const result = alt.configure({ content: bad });
  eq(result.ok, false);
  eq(result.count, 2);
  eq(result.offerIds, ['dup.offer', 'keep.offer']);
  const expected = [
    'offer-invalid',
    'bad-offer-id:bad id',
    'bad-cost:no.cost',
    'bad-cost:zero.cost',
    'bad-cost:str.cost',
    'bad-cost:frac.cost',
    'bad-cost-items:zero.items',
    'bad-cost-items:many.items',
    'bad-flags:no.flags',
    'bad-flags:bad.flag',
    'bad-evidence:no.evidence',
    'timed-offer:timed.wait',
    'timed-offer:timed.nested',
    'timed-offer:timed.deadline',
    'forbidden-combat-flag:combat.flag',
    'forbidden-combat-flag:combat.evidence',
    'offer-node-collision:collision.node',
    'bad-requires:bad.requires',
    'bad-flags:too.many.flags',
    'duplicate-offer:dup.offer',
  ];
  expected.forEach((code) => includes(result.errors, code, 'errors'));
  assert(result.errors.length >= expected.length, 'errors 数量偏少: ' + result.errors.length);
  return result.errors.length + ' errors';
});

await check('B02 configure 接受数组形态内容', () => {
  const alt = makeAlt({ db: createFakeDb({ careerId: 'b02', credits: 100 }).db });
  const result = alt.configure([offerFixture('array.offer')]);
  eq(result.ok, true);
  eq(result.count, 1);
  eq(result.offerIds, ['array.offer']);
  return 'array-form';
});

await check('B03 空 offers 列表：configure 报错、目录为空、buy 拒绝', async () => {
  const alt = makeAlt({ db: createFakeDb({ careerId: 'b03', credits: 100 }).db });
  const result = alt.configure({ content: { contentVersion: '0.17.0', offers: [] } });
  eq(result.ok, false);
  includes(result.errors, 'offers-empty');
  eq(result.count, 0);
  const bought = await alt.buy({ careerId: 'b03', offerId: 'alt.courier' });
  eq(bought.ok, false);
  eq(bought.reason, 'missing-offer');
  return 'empty-catalog';
});

await check('B04 非法顶层内容：结构化失败且不破坏已载入目录', () => {
  const alt = makeAlt({ db: createFakeDb({ careerId: 'b04', credits: 100 }).db });
  equalConfigure(alt, [offerFixture('stable.offer')]);
  const bad = alt.configure({ content: 'not-a-catalog' });
  eq(bad.ok, false);
  eq(bad.errors, ['content-invalid']);
  eq(bad.unchanged, true);
  eq(bad.count, 1);
  eq(bad.offerIds, ['stable.offer']);
  const reset = alt.configure({ content: null });
  eq(reset.ok, true);
  eq(reset.count, 2);
  return 'unchanged';
});

await check('B05 循环引用内容不抛：结构化拒绝', () => {
  const alt = makeAlt({ db: createFakeDb({ careerId: 'b05', credits: 100 }).db });
  const cyclic = offerFixture('cyclic.offer');
  cyclic.self = cyclic;
  const result = alt.configure({ content: { contentVersion: '0.17.0', offers: [cyclic] } });
  eq(result.ok, false);
  assert(Array.isArray(result.errors) && result.errors.length > 0, '缺少结构化 errors');
  return result.errors[0];
});

await check('B06 内容未知字段被忽略：奖励/材料字段不会写入购买或任务行', async () => {
  const fake = createFakeDb({ careerId: 'b06', credits: 300, items: { alloy: 2 } });
  const alt = makeAlt({ db: fake.db });
  const offer = offerFixture('smuggle.offer', {
    reward: { credits: 999, items: { alloy: 9 } },
    grants: { items: { alloy: 9 }, equipment: { 'ship:free:owned': true } },
    items: { alloy: 9 },
  });
  equalConfigure(alt, [offer]);
  const result = await alt.buy({ careerId: 'b06', offerId: 'smuggle.offer' });
  assert(result.ok === true, JSON.stringify(result));
  const purchase = callsOf(fake, 'purchase')[0];
  eq(purchase.payload.grants, {});
  const wallet = await fake.db.readWallet('b06');
  eq(wallet.credits, 290);
  eq(wallet.items, { alloy: 2 });
  const rows = callsOf(fake, 'putQuests')[0].payload.quests;
  rows.forEach((row) => {
    assert(!Object.prototype.hasOwnProperty.call(row, 'items'), '任务行不应含物品增量');
    assert(!Object.prototype.hasOwnProperty.call(row, 'reward'), '任务行不应含奖励');
  });
  return 'ignored-extras';
});

/* ------------------------------------------------------------------ *
 * C. listOffers
 * ------------------------------------------------------------------ */

await check('C01 余额充足：两条 offer 全部 affordable、无差额、未完成、已解锁', async () => {
  const fake = createFakeDb({ careerId: 'c01', credits: 200, items: { alloy: 2 } });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.listOffers({ careerId: 'c01' });
  eq(result.ok, true);
  eq(result.careerId, 'c01');
  eq(result.offers.length, 2);
  result.offers.forEach((offer) => {
    eq(offer.affordable, true, offer.offerId + ' affordable');
    eq(offer.missing, { credits: 0, items: {} }, offer.offerId + ' missing');
    eq(offer.alreadyDone, false, offer.offerId + ' alreadyDone');
    eq(offer.unlocked, true, offer.offerId + ' unlocked');
  });
  eq(result.walletAvailable, true);
  eq(result.questsAvailable, true);
  eq(result.equipmentAvailable, true);
  eq(result.warnings, []);
  return '2 affordable';
});

await check('C02 余额/材料不足：差额逐项给出', async () => {
  const fake = createFakeDb({ careerId: 'c02', credits: 80, items: {} });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.listOffers({ careerId: 'c02' });
  const byId = {};
  result.offers.forEach((offer) => {
    byId[offer.offerId] = offer;
  });
  eq(byId['alt.courier'].affordable, false);
  eq(byId['alt.courier'].missing, { credits: 40, items: {} });
  eq(byId['alt.records'].affordable, false);
  eq(byId['alt.records'].missing, { credits: 10, items: { alloy: 1 } });
  return 'deficits';
});

await check('C03 刚好够付：两条 offer 都 affordable', async () => {
  const fake = createFakeDb({ careerId: 'c03', credits: 120, items: { alloy: 1 } });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.listOffers({ careerId: 'c03' });
  result.offers.forEach((offer) => eq(offer.affordable, true, offer.offerId));
  return 'exact-funds';
});

await check('C04 已完成 offer 标记 alreadyDone，其余不变', async () => {
  const fake = createFakeDb({ careerId: 'c04', credits: 200, items: { alloy: 2 } });
  fake.store.quests.push({
    careerId: 'c04',
    nodeId: 'alt.courier',
    kind: 'alternative',
    status: 'cleared',
    clearedAt: NOW,
    evidence: ['E-C1-courier'],
    flags: ['C1.signal'],
    updatedAt: NOW,
    schemaVersion: 1,
  });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.listOffers({ careerId: 'c04' });
  const byId = {};
  result.offers.forEach((offer) => {
    byId[offer.offerId] = offer;
  });
  eq(byId['alt.courier'].alreadyDone, true);
  eq(byId['alt.records'].alreadyDone, false);
  return 'alreadyDone';
});

await check('C05 缺 wallet（生涯未建）：全部 affordable:false 并给全额差额', async () => {
  const fake = createFakeDb({});
  const alt = makeAlt({ db: fake.db });
  const result = await alt.listOffers({ careerId: 'c05' });
  eq(result.ok, true);
  eq(result.walletAvailable, false);
  eq(result.offers.length, 2);
  result.offers.forEach((offer) => {
    eq(offer.affordable, false);
    assert(offer.missing.credits > 0, offer.offerId + ' 缺信用点差额');
  });
  return 'no-wallet-deficits';
});

await check('C06 未传 careerId：不创建/不读库，仍返回目录与全额差额', async () => {
  const fake = createFakeDb({ careerId: 'c06', credits: 500 });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.listOffers({});
  eq(result.ok, true);
  eq(result.careerId, null);
  eq(result.walletAvailable, false);
  eq(fake.store.calls.length, 0);
  result.offers.forEach((offer) => eq(offer.affordable, false));
  return 'no-career-reads=0';
});

await check('C07 listOffers 只读：不调用任何写入/发奖/建生涯接口', async () => {
  const fake = createFakeDb({ careerId: 'c07', credits: 50, items: {} });
  const alt = makeAlt({ db: fake.db });
  await alt.listOffers({ careerId: 'c07' });
  const names = callNames(fake);
  assert(names.indexOf('readWallet') >= 0, '未读钱包');
  assert(names.indexOf('readQuestState') >= 0, '未读任务');
  assert(names.indexOf('getEquipment') >= 0, '未读装备');
  names.forEach((name) => assert(WRITE_CALLS.indexOf(name) < 0, 'listOffers 调用了写接口 ' + name));
  eq(callsOf(fake, 'getEquipment')[0].payload, 'c07');
  return names.join(',');
});

await check('C08 无 DB：listOffers 结构化失败', async () => {
  const alt = alternatives.createAlternatives({ core, now: () => NOW });
  const result = await alt.listOffers({ careerId: 'c08' });
  eq(result.ok, false);
  eq(result.reason, 'db-unavailable');
  eq(result.offers, []);
  return 'db-unavailable';
});

await check('C09 无 core（浏览器未注入）：listOffers 结构化失败', async () => {
  const result = await browserWindow.ArcadeCareerAlternatives.listOffers({ careerId: 'c09' });
  eq(result.ok, false);
  eq(result.reason, 'core-unavailable');
  return 'core-unavailable';
});

await check('C10 readQuestState 失败：降级但不隐瞒（questsAvailable=false + warning）', async () => {
  const fake = createFakeDb({ careerId: 'c10', credits: 200, failures: { readQuestState: true } });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.listOffers({ careerId: 'c10' });
  eq(result.ok, true);
  eq(result.questsAvailable, false);
  includes(result.warnings, 'quest-read-failed');
  result.offers.forEach((offer) => eq(offer.alreadyDone, false));
  return 'degraded-quests';
});

await check('C11 readWallet 失败：affordable:false + 全额差额 + warning', async () => {
  const fake = createFakeDb({ careerId: 'c11', credits: 200, failures: { readWallet: 'unavailable' } });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.listOffers({ careerId: 'c11' });
  eq(result.ok, true);
  eq(result.walletAvailable, false);
  includes(result.warnings, 'wallet-unavailable');
  result.offers.forEach((offer) => {
    eq(offer.affordable, false);
    assert(offer.missing.credits > 0, '缺差额');
  });
  return 'degraded-wallet';
});

await check('C12 requires.flags：旗标未齐 unlocked:false，旗标齐后 true', async () => {
  const fake = createFakeDb({ careerId: 'c12', credits: 100, items: {} });
  const alt = makeAlt({ db: fake.db });
  equalConfigure(alt, [
    offerFixture('alt.gate', {
      title: '门房的小活',
      summary: '等门口的信号灯亮了再去。',
      cost: { credits: 30 },
      flags: ['C1.gate'],
      evidence: ['E-C1-gate'],
      requires: { flags: ['C1.signal'] },
    }),
  ]);
  let result = await alt.listOffers({ careerId: 'c12' });
  eq(result.offers[0].unlocked, false);
  fake.store.quests.push({ careerId: 'c12', nodeId: 'C1.signal', kind: 'story', status: 'cleared', flags: ['C1.signal'], evidence: ['E-C1-signal'], updatedAt: NOW });
  result = await alt.listOffers({ careerId: 'c12' });
  eq(result.offers[0].unlocked, true);
  return 'requires-gate';
});

await check('C13 listOffers 返回深拷贝：修改结果不污染目录', async () => {
  const fake = createFakeDb({ careerId: 'c13', credits: 200 });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.listOffers({ careerId: 'c13' });
  result.offers[0].cost.credits = 1;
  result.offers[0].title = 'mutated';
  eq(alt.getOffer('alt.courier').cost.credits, 120);
  eq(alt.getOffer('alt.courier').title, '港务处的跑腿单');
  return 'deep-copy';
});

/* ------------------------------------------------------------------ *
 * D. buy 成功路径
 * ------------------------------------------------------------------ */

const buyFake = createFakeDb({ careerId: 'd1', credits: 500, items: { alloy: 2 } });
const buyAlt = makeAlt({ db: buyFake.db });

await check('D01 buy(alt.courier)：purchase 参数精确、先扣费后写任务', async () => {
  const courierResult = await buyAlt.buy({ careerId: 'd1', offerId: 'alt.courier' });
  assert(courierResult.ok === true, JSON.stringify(courierResult));
  eq(courierResult.offerId, 'alt.courier');
  eq(courierResult.cost, { credits: 120, items: {} });
  eq(courierResult.flags, ['C1.signal']);
  eq(courierResult.evidence, ['E-C1-courier']);
  eq(courierResult.duplicate, false);
  eq(courierResult.charged, true);
  eq(courierResult.clearedAt, NOW);
  const purchaseCalls = callsOf(buyFake, 'purchase');
  eq(purchaseCalls.length, 1);
  const payload = purchaseCalls[0].payload;
  eq(Object.keys(payload).sort(), ['careerId', 'cost', 'costItems', 'grants', 'purchaseId']);
  eq(payload.careerId, 'd1');
  eq(payload.purchaseId, 'alt:d1:alt.courier');
  eq(payload.cost, 120);
  eq(payload.costItems, {});
  eq(payload.grants, {});
  const names = callNames(buyFake);
  assert(names.indexOf('purchase') < names.indexOf('putQuests'), '必须先扣费再写任务行');
  return 'purchase before putQuests';
});

await check('D02 buy 成功后钱包只减信用点、材料不变', async () => {
  const wallet = await buyFake.db.readWallet('d1');
  eq(wallet.credits, 380);
  eq(wallet.items, { alloy: 2 });
  return '380 credits';
});

await check('D03 一次 putQuests 恰好两行：alternative(offerId) + story(首个旗标)', async () => {
  const putCalls = callsOf(buyFake, 'putQuests');
  eq(putCalls.length, 1);
  const rows = putCalls[0].payload.quests;
  eq(rows.length, 2);
  eq(rows[0].careerId, 'd1');
  eq(rows[0].nodeId, 'alt.courier');
  eq(rows[0].kind, 'alternative');
  eq(rows[0].status, 'cleared');
  eq(rows[0].clearedAt, NOW);
  eq(rows[0].flags, ['C1.signal']);
  eq(rows[0].evidence, ['E-C1-courier']);
  eq(rows[1].careerId, 'd1');
  eq(rows[1].nodeId, 'C1.signal');
  eq(rows[1].kind, 'story');
  eq(rows[1].status, 'cleared');
  eq(rows[1].clearedAt, NOW);
  eq(rows[1].flags, ['C1.signal']);
  eq(rows[1].evidence, ['E-C1-courier']);
  assert(!Object.prototype.hasOwnProperty.call(rows[0], 'items'), '任务行不应含物品');
  return '2 rows';
});

await check('D04 购买流水唯一且为负数（只扣款，不发钱）', async () => {
  eq(buyFake.store.ledger.length, 1);
  eq(buyFake.store.ledger[0].txId, 'purchase:alt:d1:alt.courier');
  eq(buyFake.store.ledger[0].credits, -120);
  eq(buyFake.store.ledger[0].cost, 120);
  eq(buyFake.store.ledger[0].balanceAfter, 380);
  return 'ledger=-120';
});

await check('D05 buy(alt.records)：材料成本 90+alloy1 原子扣除', async () => {
  const recordsResult = await buyAlt.buy({ careerId: 'd1', offerId: 'alt.records' });
  assert(recordsResult.ok === true, JSON.stringify(recordsResult));
  eq(recordsResult.cost, { credits: 90, items: { alloy: 1 } });
  eq(recordsResult.flags, ['C1.records']);
  eq(recordsResult.evidence, ['E-C1-records']);
  const purchase = callsOf(buyFake, 'purchase')[1];
  eq(purchase.payload.purchaseId, 'alt:d1:alt.records');
  eq(purchase.payload.cost, 90);
  eq(purchase.payload.costItems, { alloy: 1 });
  const wallet = await buyFake.db.readWallet('d1');
  eq(wallet.credits, 290);
  eq(wallet.items, { alloy: 1 });
  return '90+alloy';
});

await check('D06 第二单同样写两行（alt.records + C1.records），共 4 行任务', async () => {
  const rows = callsOf(buyFake, 'putQuests')[1].payload.quests;
  eq(rows.length, 2);
  eq(rows[0].nodeId, 'alt.records');
  eq(rows[1].nodeId, 'C1.records');
  eq(buyFake.store.quests.length, 4);
  const nodeIds = buyFake.store.quests.map((row) => row.nodeId).sort();
  eq(nodeIds, ['C1.records', 'C1.signal', 'alt.courier', 'alt.records']);
  return '4 quest rows';
});

await check('D07 buy 立即完成（无真实时间等待）', async () => {
  const fake = createFakeDb({ careerId: 'd7', credits: 120 });
  const alt = makeAlt({ db: fake.db });
  const started = Date.now();
  const result = await alt.buy({ careerId: 'd7', offerId: 'alt.courier' });
  const elapsed = Date.now() - started;
  assert(result.ok === true, JSON.stringify(result));
  assert(elapsed < 1000, 'buy 耗时过长: ' + elapsed + 'ms');
  return elapsed + 'ms';
});

await check('D08 buy 接受可选 nonce，但 purchaseId 仍然确定（幂等不被弱化）', async () => {
  const fake = createFakeDb({ careerId: 'd8', credits: 200 });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.buy({ careerId: 'd8', offerId: 'alt.courier', nonce: 'a'.repeat(32) });
  assert(result.ok === true, JSON.stringify(result));
  eq(callsOf(fake, 'purchase')[0].payload.purchaseId, 'alt:d8:alt.courier');
  return 'nonce-ignored';
});

/* ------------------------------------------------------------------ *
 * E. buy 失败 / 幂等 / 补记
 * ------------------------------------------------------------------ */

await check('E01 余额不足：零写入、purchase 不被调用、差额明确', async () => {
  const fake = createFakeDb({ careerId: 'e01', credits: 50, items: { alloy: 2 } });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.buy({ careerId: 'e01', offerId: 'alt.courier' });
  eq(result.ok, false);
  eq(result.reason, 'insufficient-credits');
  eq(result.charged, false);
  eq(result.missing, { credits: 70, items: {} });
  assert(callsOf(fake, 'purchase').length === 0, '余额不足不应调用 purchase');
  assert(callsOf(fake, 'putQuests').length === 0, '余额不足不应写任务');
  eq(fake.store.ledger.length, 0);
  eq(fake.store.quests.length, 0);
  eq((await fake.db.readWallet('e01')).credits, 50);
  return 'zero-write';
});

await check('E02 材料不足：零写入、purchase 不被调用、差额明确', async () => {
  const fake = createFakeDb({ careerId: 'e02', credits: 500, items: {} });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.buy({ careerId: 'e02', offerId: 'alt.records' });
  eq(result.ok, false);
  eq(result.reason, 'insufficient-items');
  eq(result.charged, false);
  eq(result.missing, { credits: 0, items: { alloy: 1 } });
  assert(callsOf(fake, 'purchase').length === 0, '材料不足不应调用 purchase');
  eq(fake.store.quests.length, 0);
  eq((await fake.db.readWallet('e02')).items, {});
  return 'zero-write';
});

await check('E03 信用点与材料同时不足：差额两样都给出', async () => {
  const fake = createFakeDb({ careerId: 'e03', credits: 60, items: {} });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.buy({ careerId: 'e03', offerId: 'alt.records' });
  eq(result.ok, false);
  eq(result.reason, 'insufficient-credits');
  eq(result.missing, { credits: 30, items: { alloy: 1 } });
  return 'both-missing';
});

await check('E04 没有钱包（生涯未建）：no-wallet、零写入', async () => {
  const fake = createFakeDb({});
  const alt = makeAlt({ db: fake.db });
  const result = await alt.buy({ careerId: 'e04', offerId: 'alt.courier' });
  eq(result.ok, false);
  eq(result.reason, 'no-wallet');
  eq(result.charged, false);
  assert(callsOf(fake, 'purchase').length === 0, '不应调用 purchase');
  eq(fake.store.ledger.length, 0);
  eq(fake.store.quests.length, 0);
  return 'no-wallet';
});

await check('E05 非法 careerId / 未知 offerId：结构化失败且零 DB 调用', async () => {
  const fake = createFakeDb({ careerId: 'e05', credits: 500 });
  const alt = makeAlt({ db: fake.db });
  const badCareer = await alt.buy({ careerId: 'bad id', offerId: 'alt.courier' });
  eq(badCareer.ok, false);
  eq(badCareer.reason, 'bad-career-id');
  const missing = await alt.buy({ careerId: 'e05', offerId: 'alt.none' });
  eq(missing.ok, false);
  eq(missing.reason, 'missing-offer');
  eq(fake.store.calls.length, 0);
  return 'no-db-calls';
});

await check('E06 DB 原子拒绝（竞态 insufficient）：charged:false、零写入、不误报差额', async () => {
  const fake = createFakeDb({
    careerId: 'e06',
    credits: 500,
    failures: {
      purchase: 'insufficient',
      beforePurchase: (store) => {
        store.balances.e06.credits = 10;
      },
    },
  });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.buy({ careerId: 'e06', offerId: 'alt.courier' });
  eq(result.ok, false);
  eq(result.reason, 'insufficient-credits');
  eq(result.charged, false);
  eq(result.missing, { credits: 110, items: {} });
  eq(result.dbReason, 'insufficient');
  eq(fake.store.ledger.length, 0);
  eq(fake.store.quests.length, 0);
  return 'db-authoritative';
});

await check('E07 DB purchase 抛异常：purchase-failed、零写入', async () => {
  const fake = createFakeDb({ careerId: 'e07', credits: 500, failures: { purchase: 'throw' } });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.buy({ careerId: 'e07', offerId: 'alt.courier' });
  eq(result.ok, false);
  eq(result.reason, 'purchase-failed');
  eq(result.charged, false);
  includes(result.detail, 'injected purchase throw');
  eq(fake.store.ledger.length, 0);
  eq(fake.store.quests.length, 0);
  return 'caught';
});

await check('E08 DB purchase 其他拒绝（balance-cap）：purchase-failed 且不谎报成功', async () => {
  const fake = createFakeDb({ careerId: 'e08', credits: 500, failures: { purchase: 'balance-cap' } });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.buy({ careerId: 'e08', offerId: 'alt.courier' });
  eq(result.ok, false);
  eq(result.reason, 'purchase-failed');
  eq(result.dbReason, 'balance-cap');
  eq(result.charged, false);
  return 'balance-cap';
});

await check('E09 前置 requires 未满足：locked 拒绝、零写入', async () => {
  const fake = createFakeDb({ careerId: 'e09', credits: 500, items: {} });
  const alt = makeAlt({ db: fake.db });
  equalConfigure(alt, [
    offerFixture('alt.gate', { cost: { credits: 30 }, flags: ['C1.gate'], evidence: ['E-C1-gate'], requires: { flags: ['C1.signal'] } }),
  ]);
  const result = await alt.buy({ careerId: 'e09', offerId: 'alt.gate' });
  eq(result.ok, false);
  eq(result.reason, 'locked');
  eq(result.missingFlags, ['C1.signal']);
  eq(result.charged, false);
  assert(callsOf(fake, 'purchase').length === 0, '不应调用 purchase');
  eq(fake.store.quests.length, 0);
  return 'locked';
});

await check('E10 扣费成功但任务行写入失败：quest-write-failed、钱已扣旗标未记、可重试', async () => {
  const fake = createFakeDb({ careerId: 'e10', credits: 120, items: {}, failures: { putQuests: true } });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.buy({ careerId: 'e10', offerId: 'alt.courier' });
  eq(result.ok, false);
  eq(result.reason, 'quest-write-failed');
  eq(result.charged, true);
  eq(result.duplicate, false);
  eq(result.retryable, true);
  eq(result.purchaseId, 'alt:e10:alt.courier');
  assert(result.receipt !== null && typeof result.receipt === 'object', '缺少扣费收据');
  includes(result.message, '钱已扣');
  includes(result.message, '旗标未记');
  eq(fake.store.ledger.length, 1);
  eq(fake.store.quests.length, 0);
  eq((await fake.db.readWallet('e10')).credits, 0);
  return 'honest-failure';
});

await check('E11 重试同一 offer：ledger 探测 + purchaseId 幂等补记，不再扣费', async () => {
  const fake = createFakeDb({ careerId: 'e11', credits: 120, items: {}, failures: { putQuests: true } });
  const alt = makeAlt({ db: fake.db });
  const first = await alt.buy({ careerId: 'e11', offerId: 'alt.courier' });
  eq(first.reason, 'quest-write-failed');
  fake.failures.putQuests = null;
  const second = await alt.buy({ careerId: 'e11', offerId: 'alt.courier' });
  assert(second.ok === true, JSON.stringify(second));
  eq(second.duplicate, true);
  eq(second.repaired, true);
  eq(second.charged, false);
  eq(fake.store.ledger.length, 1);
  eq((await fake.db.readWallet('e11')).credits, 0);
  eq(fake.store.quests.length, 2);
  eq(callsOf(fake, 'purchase').length, 2);
  return 'repaired-no-double-charge';
});

await check('E12 已完成 offer 再买：duplicate 且不调用 purchase / putQuests', async () => {
  const fake = createFakeDb({ careerId: 'e12', credits: 500 });
  const alt = makeAlt({ db: fake.db });
  const first = await alt.buy({ careerId: 'e12', offerId: 'alt.courier' });
  assert(first.ok === true, JSON.stringify(first));
  const purchaseCount = callsOf(fake, 'purchase').length;
  const putCount = callsOf(fake, 'putQuests').length;
  const walletBefore = (await fake.db.readWallet('e12')).credits;
  const second = await alt.buy({ careerId: 'e12', offerId: 'alt.courier' });
  eq(second.ok, true);
  eq(second.duplicate, true);
  eq(second.alreadyDone, true);
  eq(second.charged, false);
  eq(callsOf(fake, 'purchase').length, purchaseCount);
  eq(callsOf(fake, 'putQuests').length, putCount);
  eq((await fake.db.readWallet('e12')).credits, walletBefore);
  return 'no-double-charge';
});

await check('E13 只存在购买流水（任务行丢失的崩溃恢复）：补记任务且不再扣费', async () => {
  const fake = createFakeDb({ careerId: 'e13', credits: 0 });
  fake.store.ledger.push({
    txId: 'purchase:alt:e13:alt.courier',
    careerId: 'e13',
    kind: 'purchase',
    purchaseId: 'alt:e13:alt.courier',
    cost: 120,
    credits: -120,
    balanceAfter: 0,
    at: NOW,
    receipt: { receiptId: 'purchase:alt:e13:alt.courier', cost: 120, careerId: 'e13', purchaseId: 'alt:e13:alt.courier' },
  });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.buy({ careerId: 'e13', offerId: 'alt.courier' });
  assert(result.ok === true, JSON.stringify(result));
  eq(result.duplicate, true);
  eq(result.repaired, true);
  eq(result.charged, false);
  eq(fake.store.ledger.length, 1);
  eq((await fake.db.readWallet('e13')).credits, 0);
  eq(fake.store.quests.length, 2);
  return 'crash-recovery';
});

await check('E14 极简 DB（无 readLedger）：不足时交给原子 purchase 判定，失败零写入', async () => {
  const fake = createFakeDb({ careerId: 'e14', credits: 50, minimalRead: true });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.buy({ careerId: 'e14', offerId: 'alt.courier' });
  eq(result.ok, false);
  eq(result.reason, 'insufficient-credits');
  eq(result.charged, false);
  eq(callsOf(fake, 'purchase').length, 1);
  eq(fake.store.ledger.length, 0);
  eq(fake.store.quests.length, 0);
  return 'db-decides';
});

await check('E15 quest 写入抛异常：同样可归因、不谎报成功', async () => {
  const fake = createFakeDb({ careerId: 'e15', credits: 120, failures: { putQuests: 'throw' } });
  const alt = makeAlt({ db: fake.db });
  const result = await alt.buy({ careerId: 'e15', offerId: 'alt.courier' });
  eq(result.ok, false);
  eq(result.reason, 'quest-write-failed');
  eq(result.charged, true);
  eq(result.dbReason, 'exception');
  includes(result.message, '钱已扣');
  return 'caught-quest-write';
});

/* ------------------------------------------------------------------ *
 * F. hasFlag / listCompleted
 * ------------------------------------------------------------------ */

await check('F01 buy 后 hasFlag 命中代办旗标，未涉足旗标为 false', async () => {
  eq(await buyAlt.hasFlag('d1', 'C1.signal'), true);
  eq(await buyAlt.hasFlag('d1', 'C1.records'), true);
  eq(await buyAlt.hasFlag('d1', 'C1.gate'), false);
  return 'flags';
});

await check('F02 hasFlag 对未知生涯 / 非法旗标 / 空参数返回 false 且不抛', async () => {
  eq(await buyAlt.hasFlag('no-such-career', 'C1.signal'), false);
  eq(await buyAlt.hasFlag('d1', 'bad flag'), false);
  eq(await buyAlt.hasFlag(undefined, 'C1.signal'), false);
  eq(await alternatives.hasFlag('x', 'C1.signal'), false);
  return 'false-safe';
});

await check('F03 hasFlag 回退读取个人档旗标', async () => {
  const fake = createFakeDb({ careerId: 'f03', credits: 0, profileFlags: ['C1.profile'] });
  const alt = makeAlt({ db: fake.db });
  eq(await alt.hasFlag('f03', 'C1.profile'), true);
  return 'profile-fallback';
});

await check('F04 listCompleted：只列出已完成的 alternative 行', async () => {
  const result = await buyAlt.listCompleted('d1');
  eq(result.ok, true);
  eq(result.careerId, 'd1');
  eq(result.completed.length, 2);
  const ids = result.completed.map((item) => item.offerId);
  eq(ids, ['alt.courier', 'alt.records']);
  result.completed.forEach((item) => {
    assert(item.title.length > 0, '缺少标题');
    eq(item.clearedAt, NOW);
    assert(Array.isArray(item.flags) && item.flags.length > 0, '缺少旗标');
  });
  return '2 completed';
});

await check('F05 listCompleted 失败路径：bad-career-id / quest-read-failed / db-unavailable', async () => {
  const badCareer = await buyAlt.listCompleted('bad id');
  eq(badCareer.ok, false);
  eq(badCareer.reason, 'bad-career-id');
  const fake = createFakeDb({ careerId: 'f05', credits: 10, failures: { readQuestState: true } });
  const alt = makeAlt({ db: fake.db });
  const failed = await alt.listCompleted('f05');
  eq(failed.ok, false);
  eq(failed.reason, 'quest-read-failed');
  const noDb = alternatives.createAlternatives({ core, now: () => NOW });
  const missing = await noDb.listCompleted('f05');
  eq(missing.ok, false);
  eq(missing.reason, 'db-unavailable');
  return 'structured-failures';
});

/* ------------------------------------------------------------------ *
 * G. 完整性 / 静态断言 / DB 形状对照
 * ------------------------------------------------------------------ */

await check('G01 所有任务行只写 alternative / story，且无战斗旗标', () => {
  allFakes.forEach((fake) => {
    fake.store.quests.forEach((row) => {
      assert(row.kind === 'alternative' || row.kind === 'story', '出现非法 kind: ' + row.kind);
      (row.flags || []).concat(row.evidence || []).forEach((token) => {
        assert(FORBIDDEN_TEST_FLAGS.indexOf(token) < 0, '任务行出现战斗旗标: ' + token);
      });
    });
  });
  return 'alt/story only';
});

await check('G02 全过程零完整性违规（无发奖、无建生涯、无结算、无非扣款流水）', () => {
  allFakes.forEach((fake) => {
    eq(fake.store.violations, [], 'fake violations');
  });
  const trapCalls = allFakes.reduce((sum, fake) => sum + ['settleAndClaim', 'ensureCareer', 'createRun', 'writeEquipment'].reduce((acc, name) => acc + callsOf(fake, name).length, 0), 0);
  eq(trapCalls, 0);
  return allFakes.length + ' fakes clean';
});

await check('G03 所有购买流水只减不增（无虚假收入）', () => {
  allFakes.forEach((fake) => {
    fake.store.ledger.forEach((row) => {
      if (row.kind !== 'purchase') return;
      assert(row.credits < 0, '购买流水不是扣款: ' + row.credits);
    });
  });
  return 'deductions only';
});

await check('G04 静态断言：源码无结算/领奖/浏览器存储/网络/DOM/计时器', () => {
  const lower = moduleSource.toLowerCase();
  ['claim', 'settle', 'localstorage', 'sessionstorage', 'xmlhttprequest', 'document', 'indexeddb', 'innerhtml', 'settimeout', 'setinterval'].forEach((needle) => {
    assert(lower.indexOf(needle) < 0, '源码含禁止子串: ' + needle);
  });
  assert(/\bfetch\b/.test(lower) === false, '源码含 fetch');
  assert(!/credits\s*\+/.test(moduleSource), '源码含 credits 自增/加法');
  assert(!/\.credits\s*=(?!=)/.test(moduleSource), '源码对 credits 赋值');
  assert(!/['"]commission['"]/.test(moduleSource), '源码含 commission kind 字面量');
  return 'source-clean';
});

await check('G05 静态断言：purchase 调用 grants 为空，且没有 grants.items/equipment', () => {
  const emptyGrants = moduleSource.match(/grants\s*:\s*\{\s*\}/g) || [];
  eq(emptyGrants.length, 1);
  assert(!/grants\s*:\s*\{[^}]*\b(items|equipment)\b/.test(moduleSource), 'grants 里出现 items/equipment');
  assert(moduleSource.indexOf("costItems: offer.cost.items ? clone(offer.cost.items) : {}") >= 0, '缺少 costItems 透传');
  assert(moduleSource.indexOf("purchaseId: purchaseId") >= 0, '缺少 purchaseId');
  assert(moduleSource.indexOf("'alt:' + careerId + ':' + offer.offerId") >= 0, 'purchaseId 形状漂移');
  return 'grants-empty';
});

await check('G06 静态断言：战斗旗标与时间等待字段只出现在拒绝清单（各 1 次）', () => {
  FORBIDDEN_TEST_FLAGS.forEach((flag) => {
    eq(moduleSource.split(flag).length - 1, 1, flag + ' 出现次数');
  });
  ['wait', 'cooldown', 'deadline'].forEach((key) => {
    eq(moduleSource.split("'" + key + "'").length - 1, 1, key + ' 出现次数');
  });
  includes(moduleSource, 'TIMING_KEYS', 'timing list');
  includes(moduleSource, 'FORBIDDEN_FLAGS', 'forbidden list');
  return 'deny-lists-only';
});

await check('G07 静态断言：putQuests 只出现一次业务调用，kind 仅 alternative/story', () => {
  const putQuestsCalls = moduleSource.match(/db\.putQuests\(/g) || [];
  eq(putQuestsCalls.length, 1);
  eq((moduleSource.match(/OFFER_KIND = 'alternative'/g) || []).length, 1);
  eq((moduleSource.match(/STORY_KIND = 'story'/g) || []).length, 1);
  return 'single-write';
});

await check('G08 DB 源码对照：putQuests 行形状与购买材料参数符合真实实现', () => {
  const requiredPutQuests = [
    'function putQuests(careerId, quests)',
    'row.careerId = careerId;',
    'row.nodeId = raw.nodeId;',
    'row.schemaVersion = SCHEMA_VERSION;',
    'row.updatedAt = at;',
    'if (!isObject(raw) || !core.isToken(raw.nodeId)) return Promise.resolve(failure(\'bad-quest\'));',
  ];
  requiredPutQuests.forEach((needle) => includes(dbSource, needle, 'career-db.putQuests'));
  includes(dbSource, 'function purchase(input)', 'career-db.purchase');
  includes(dbSource, "const txId = 'purchase:' + purchaseId;", 'purchase txId');
  includes(dbSource, 'costItems', 'purchase costItems');
  includes(dbSource, 'ctx.store(\'ledgers\').get(txId)', 'purchase 幂等读流水');
  includes(dbSource, 'byNode[row.nodeId] = row;', 'readQuestState byNode');
  return 'db-shape-aligned';
});

await check('G09 写入任务行包含 putQuests 所需全部字段', () => {
  const rows = callsOf(buyFake, 'putQuests')[0].payload.quests;
  ['careerId', 'nodeId', 'kind', 'status', 'clearedAt', 'evidence', 'flags', 'updatedAt', 'schemaVersion'].forEach((key) => {
    rows.forEach((row) => assert(Object.prototype.hasOwnProperty.call(row, key), '任务行缺少字段 ' + key));
  });
  return 'row-shape';
});

await check('G10 默认文案不含系统/营销措辞（奖励/解锁/概率/签到/生涯模式）', () => {
  const state = alternatives.getState();
  assert(state.errors.length === 0, '默认内容有 errors: ' + JSON.stringify(state.errors));
  state.offerIds.forEach((offerId) => {
    const offer = alternatives.getOffer(offerId);
    const text = [offer.title, offer.summary, offer.issuer].join(' ');
    assert(!/奖励|解锁|概率|签到|生涯模式/.test(text), '默认文案含系统措辞: ' + text);
  });
  return 'in-world copy';
});

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */

const summary = passed + '/' + total + ' checks passed';
if (failures.length === 0) {
  console.log('PASS: ' + summary);
  process.exit(0);
}
console.log('');
failures.forEach((line) => console.log('  - ' + line));
console.log('FAIL: ' + summary);
process.exit(1);
