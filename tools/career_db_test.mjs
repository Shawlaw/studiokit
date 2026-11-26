#!/usr/bin/env node
/**
 * Arcade Life Career DB 门禁（0.15，D15-03）：
 * 独立生涯 IndexedDB 的事务原子性、领取幂等与多标签串行化。
 *
 * 覆盖：
 * - A 组（纯 Node，无 Chrome）：career-core 纯函数契约 + career-db Node 端结构化失败 +
 *   源码静态边界（不得出现 localStorage / meta:v1 / runs:v1）
 * - B 组（真实 Chrome + CDP）：注入 career-core.js / career-db.js 到 apps/arcade/index.html，
 *   验证 11 个 store、发现状态往返、ensureCareer 初始 80 credits、领奖幂等/并发、
 *   购买双击、非法输入零写入、reset/export/import、测试隔离（deleteDatabase）
 *
 * 零 npm 依赖：复用 tools/lib/arcade_cdp.mjs；端口默认 CAREER_DB_PORT=8830、
 * CAREER_DB_CDP_PORT=9430（与 smoke / gameplay / 其它 career 门禁不冲突）。
 * 运行：node tools/career_db_test.mjs [--only=A|B] [--port=8830] [--cdp-port=9430]
 * 退出码：0 全部通过；1 有失败；2 环境/装配失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO_ROOT, createRecorder, envPort, launchChrome, openPage, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const ARTIFACTS = path.join(REPO_ROOT, 'test-artifacts');
const VIEWPORT = { width: 420, height: 900 };
const DB_NAME = 'studiokit:arcade:career';
const CAREER_CORE = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'career-core.js');
const CAREER_DB = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'career-db.js');

let SERVER_PORT = 0;
let CDP_PORT = 0;
let BASE = '';

const { record, assert, summary } = createRecorder();
const require = createRequire(import.meta.url);

function arg(name, fallback) {
  const prefix = '--' + name + '=';
  const hit = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function detail(value) {
  if (value === undefined) return '';
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 240 ? text.slice(0, 240) + '…' : text;
  } catch (err) {
    return String(value);
  }
}

async function check(name, fn) {
  try {
    const info = await fn();
    record(name, true, detail(info));
  } catch (err) {
    record(name, false, err && err.message ? err.message : String(err));
  }
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ------------------------------------------------------------------ *
 * 页面辅助
 * ------------------------------------------------------------------ */

async function injectModules(cdp) {
  return cdp.evaluate(`(async () => {
    const base = new URL('career/', location.href).href;
    for (const file of ['career-core.js', 'career-db.js']) {
      const response = await fetch(base + file, { cache: 'no-store' });
      if (!response.ok) throw new Error('fetch ' + file + ' -> ' + response.status);
      const source = await response.text();
      if (!source || source.length < 1000) throw new Error('fetch ' + file + ' 内容异常：' + source.length);
      (0, eval)(source);
    }
    return {
      core: !!(window.ArcadeCareer && window.ArcadeCareer.core),
      db: !!(window.ArcadeCareer && window.ArcadeCareer.db),
      url: location.href,
    };
  })()`);
}

/** 在页面里跑一段 async 代码；db / core 已注入作用域。 */
function pageEval(cdp, body) {
  return cdp.evaluate(`(async () => {
    const db = window.ArcadeCareer && window.ArcadeCareer.db;
    const core = window.ArcadeCareer && window.ArcadeCareer.core;
    if (!db || !core) throw new Error('career modules not injected');
    ${body}
  })()`);
}

const SNAPSHOT_BODY = `
  const all = await db.exportAll();
  if (!all.ok) throw new Error('exportAll failed: ' + (all.error || all.reason));
  const p = all.payload;
  const creditsByCareer = {};
  (p.balances || []).forEach((row) => { creditsByCareer[row.careerId] = row.credits; });
  return {
    creditsByCareer,
    claims: (p.claims || []).map((row) => row.runId).sort(),
    ledgers: (p.ledgers || []).map((row) => row.txId).sort(),
    inventory: (p.inventory || []).map((row) => row.careerId + ':' + row.itemId + '=' + row.count).sort(),
    runs: (p.runs || []).map((row) => row.runId + ':' + row.status).sort(),
    quests: (p.quests || []).map((row) => row.careerId + ':' + row.nodeId).sort(),
    profiles: (p.profiles || []).map((row) => row.careerId).sort(),
  };
`;

async function snapshot(cdp) {
  return pageEval(cdp, SNAPSHOT_BODY);
}

/** 打开第二个真实标签页（同一 Chrome profile / 同一 IDB 源），用于多标签与 versionchange 证据。 */
async function openSecondPage() {
  const page = await openPage({ port: CDP_PORT, ...VIEWPORT, deviceScaleFactor: 1, mobile: true, artifactsDir: ARTIFACTS });
  await page.navigate(BASE + '/apps/arcade/index.html');
  const injected = await injectModules(page);
  if (!injected.db || !injected.core) throw new Error('第二标签注入失败：' + JSON.stringify(injected));
  return page;
}

async function createRunInPage(cdp, spec) {
  return pageEval(
    cdp,
    `const runId = core.newId('run');
     const payload = ${JSON.stringify(spec)};
     payload.runId = runId;
     const created = await db.createRun(payload);
     return { runId, created };`,
  );
}

function settleInPage(cdp, input) {
  return pageEval(cdp, `return await db.settleAndClaim(${JSON.stringify(input)});`);
}

/* ------------------------------------------------------------------ *
 * A 组：纯 Node 契约（career-core / career-db 可 require）
 * ------------------------------------------------------------------ */

let coreModule = null;
let dbModule = null;

async function runNodeChecks() {
  coreModule = require(CAREER_CORE);
  dbModule = require(CAREER_DB);

  await check('A01 core 常量与必需导出齐全', async () => {
    assert(coreModule.SCHEMA_VERSION === 1, 'SCHEMA_VERSION=' + coreModule.SCHEMA_VERSION);
    assert(coreModule.RULESET_VERSION === 1, 'RULESET_VERSION=' + coreModule.RULESET_VERSION);
    const required = [
      'newId',
      'isValidRunId',
      'isValidCareerId',
      'validateCommission',
      'rewardPlan',
      'makeTxIds',
      'buildReceipt',
      'validateClaimPlan',
      'summarizeEvents',
      'combineDigest',
      'initialCareer',
      'purchasePlan',
      'storyContextFrom',
    ];
    const missing = required.filter((name) => typeof coreModule[name] !== 'function');
    assert(!missing.length, '缺少函数：' + missing.join(','));
    return required.length + ' functions';
  });

  await check('A02 core newId / ID 校验 / makeTxIds 可重放', async () => {
    const runId = coreModule.newId('run');
    assert(runId.startsWith('run-'), '前缀错误：' + runId);
    assert(coreModule.isValidRunId(runId), 'newId 生成的 runId 未通过校验：' + runId);
    assert(coreModule.isValidCareerId(coreModule.newId('career')), 'careerId 校验失败');
    assert(!coreModule.isValidRunId('has space'), '非法 runId 被接受');
    assert(!coreModule.isValidRunId(''), '空 runId 被接受');
    assert(coreModule.isValidRunId('run-1'), '短 ID 应被接受（兼容手写测试 ID）');
    const ids = coreModule.makeTxIds('run-abc123', 3);
    assert(sameJson(ids, ['tx:run-abc123:1', 'tx:run-abc123:2', 'tx:run-abc123:3']), 'txId 格式错误：' + JSON.stringify(ids));
    assert(coreModule.makeTxIds('bad id', 2).length === 0, '非法 runId 应返回空 txIds');
    assert(coreModule.newId('run') !== coreModule.newId('run'), 'newId 不唯一');
    return ids.join(',');
  });

  await check('A03 core 事件摘要（kind→count、丢弃未知结构、可合并）', async () => {
    const digest = coreModule.summarizeEvents([
      { kind: 'pair.match', payload: { level: 2, symbol: 'a' } },
      { kind: 'pair.match', payload: { level: 2 } },
      { kind: 'tower.floor_stable', count: 3 },
      { kind: 'bad kind with spaces' },
      'palace.boom',
      null,
      42,
    ]);
    assert(digest.counts['pair.match'] === 2, 'pair.match=' + digest.counts['pair.match']);
    assert(digest.counts['tower.floor_stable'] === 3, 'count 字段未生效');
    assert(digest.counts['palace.boom'] === 1, '字符串事件未计数');
    assert(digest.counts['bad kind with spaces'] === undefined, '非法 kind 未丢弃');
    assert(digest.total === 6, 'total=' + digest.total);
    const merged = coreModule.combineDigest(digest, coreModule.summarizeEvents([{ kind: 'pair.match' }]));
    assert(merged.counts['pair.match'] === 3, '合并后 pair.match=' + merged.counts['pair.match']);
    return JSON.stringify(digest.counts);
  });

  await check('A04 core validateCommission / rewardPlan（objective、mode、上下文、上限、重复局）', async () => {
    const commission = {
      commissionId: 'memory-flip.T1',
      gameId: 'memory-flip',
      professionId: 'research.archivist',
      objective: { kind: 'pair.match', atLeast: 2, context: { level: 2 } },
      reward: { credits: 70, items: { 'mat.scrap': 2 }, evidence: ['EV-memory-1'], flags: ['FLAG-alpha'] },
      repeatSalaryCredits: 15,
    };
    const okDigest = coreModule.summarizeEvents([
      { kind: 'pair.match', payload: { level: 2 } },
      { kind: 'pair.match', payload: { level: 2 } },
    ]);
    const ok = coreModule.validateCommission(commission, okDigest, { mode: 'commission', gameId: 'memory-flip' });
    assert(ok.ok, '应通过：' + JSON.stringify(ok));
    const badMode = coreModule.validateCommission(commission, okDigest, { mode: 'challenge' });
    assert(!badMode.ok && badMode.reason === 'mode-not-allowed', '非委托模式应拒绝：' + JSON.stringify(badMode));
    const badGame = coreModule.validateCommission(commission, okDigest, { mode: 'commission', gameId: 'gomoku' });
    assert(!badGame.ok && badGame.reason === 'game-mismatch', 'game 不一致应拒绝');
    const missDigest = coreModule.summarizeEvents([
      { kind: 'pair.match', payload: { level: 5 } },
      { kind: 'pair.match', payload: { level: 5 } },
    ]);
    const contextMiss = coreModule.validateCommission(commission, missDigest, { mode: 'commission' });
    assert(!contextMiss.ok && contextMiss.reason === 'context-mismatch', '上下文不匹配应拒绝：' + JSON.stringify(contextMiss));
    const notMet = coreModule.validateCommission(commission, coreModule.summarizeEvents([]), { mode: 'commission' });
    assert(!notMet.ok && notMet.reason === 'objective-not-met', 'objective 未满足应拒绝');
    const plan = coreModule.rewardPlan(commission, okDigest, { mode: 'commission' });
    assert(plan.ok && plan.credits === 70, 'credits=' + plan.credits);
    assert(sameJson(plan.items, { 'mat.scrap': 2 }), 'items=' + JSON.stringify(plan.items));
    assert(plan.txSteps.length === 3 && plan.txSteps[0].kind === 'credits', 'txSteps=' + JSON.stringify(plan.txSteps));
    const repeat = coreModule.rewardPlan(commission, okDigest, { mode: 'commission', repeat: true });
    assert(repeat.ok && repeat.credits === 15 && !Object.keys(repeat.items).length, '重复局只发固定薪资：' + JSON.stringify(repeat));
    const huge = coreModule.rewardPlan(
      Object.assign({}, commission, { reward: { credits: 99999, items: {}, evidence: [], flags: [] } }),
      okDigest,
      { mode: 'commission' },
    );
    assert(huge.ok && huge.credits <= coreModule.RULESET.payoutCap, '未 clamp 到上限：' + huge.credits);
    const negative = coreModule.rewardPlan(
      Object.assign({}, commission, { reward: { credits: -50, items: {}, evidence: [], flags: [] } }),
      okDigest,
      { mode: 'commission' },
    );
    assert(negative.ok && negative.credits === 0, '负奖励未被 clamp 到 0：' + negative.credits);
    return 'credits=' + plan.credits + ' cap=' + coreModule.RULESET.payoutCap;
  });

  await check('A05 core buildReceipt（ADR §8 字段）与 validateClaimPlan 拒绝非法计划', async () => {
    const plan = { credits: 70, items: { 'mat.scrap': 2 }, evidence: ['EV-memory-1'], flags: ['FLAG-alpha'] };
    const receipt = coreModule.buildReceipt({
      runId: 'run-abc123',
      careerId: 'career-xyz789',
      commissionId: 'memory-flip.T1',
      plan,
      now: '2026-11-22T00:00:00.000Z',
      contentVersion: '0.15.0',
    });
    const fields = ['receiptId', 'careerId', 'commissionId', 'credits', 'items', 'evidence', 'flags', 'txIds', 'claimedAt', 'rulesetVersion', 'contentVersion'];
    const missing = fields.filter((field) => receipt[field] === undefined);
    assert(!missing.length, '缺少字段：' + missing.join(','));
    assert(receipt.receiptId === 'run-abc123', 'receiptId=' + receipt.receiptId);
    assert(receipt.txIds.length === 3, 'txIds=' + JSON.stringify(receipt.txIds));
    assert(coreModule.buildReceipt({ runId: 'bad id', careerId: 'career-xyz789', plan }) === null, '非法 runId 应返回 null');
    assert(coreModule.validateClaimPlan(plan).ok, '合法计划被拒绝');
    assert(!coreModule.validateClaimPlan({ credits: -1 }).ok, '负 credits 被接受');
    assert(!coreModule.validateClaimPlan({ credits: 999999 }).ok, '超上限 credits 被接受');
    assert(!coreModule.validateClaimPlan({ credits: 1.5 }).ok, '小数 credits 被接受');
    assert(!coreModule.validateClaimPlan({ credits: 0, items: { 'mat.x': -2 } }).ok, '负物品被接受');
    assert(!coreModule.validateClaimPlan({ credits: 0, evidence: ['bad token with space'] }).ok, '非法 evidence 被接受');
    assert(!coreModule.validateClaimPlan(null).ok, 'null 计划被接受');
    return 'txIds=' + JSON.stringify(receipt.txIds);
  });

  await check('A06 core initialCareer（80 credits）与 purchasePlan 护栏', async () => {
    const initial = coreModule.initialCareer({ originGameId: 'memory-flip', now: '2026-11-22T00:00:00.000Z' });
    assert(initial.balance.credits === 80, '初始余额=' + initial.balance.credits);
    assert(initial.balance.careerId === initial.profile.careerId, 'careerId 不一致');
    assert(initial.ledger.credits === 80 && initial.ledger.kind === 'initial-grant', '初始流水错误：' + JSON.stringify(initial.ledger));
    assert(coreModule.isValidCareerId(initial.profile.careerId), '初始 careerId 非法');
    const okPlan = coreModule.purchasePlan({ cost: 60, grants: { items: { 'mat.wire': 1 } }, wallet: { credits: 80 } });
    assert(okPlan.ok && okPlan.plan.balanceAfter === 20, 'balanceAfter=' + JSON.stringify(okPlan));
    const insufficient = coreModule.purchasePlan({ cost: 600, grants: {}, wallet: { credits: 80 } });
    assert(!insufficient.ok && insufficient.reason === 'insufficient', '余额不足未拒绝：' + JSON.stringify(insufficient));
    const badCost = coreModule.purchasePlan({ cost: 0, grants: {}, wallet: { credits: 80 } });
    assert(!badCost.ok && badCost.reason === 'bad-cost', '非法 cost 未拒绝');
    const noWallet = coreModule.purchasePlan({ cost: 10, grants: {}, wallet: {} });
    assert(!noWallet.ok && noWallet.reason === 'wallet-unavailable', '无钱包未拒绝');
    const badGrants = coreModule.purchasePlan({ cost: 10, grants: { items: { 'mat.x': -1 } }, wallet: { credits: 80 } });
    assert(!badGrants.ok && badGrants.reason === 'bad-grants', '负 grant 未拒绝');
    return 'initial=' + initial.balance.credits + ' after=' + okPlan.plan.balanceAfter;
  });

  await check('A07 core storyContextFrom 与 resolveStory 复用 registry 谓词', async () => {
    const ctx = coreModule.storyContextFrom({
      profile: { capabilities: ['cap-x'], flags: [], evidence: [] },
      wallet: { credits: 12, items: { 'mat.scrap': 3 } },
      quests: [{ nodeId: 'memory-flip.T1', status: 'cleared', evidence: ['EV-q'], flags: ['FLAG-q'] }],
      claims: [{ commissionId: 'gomoku.T2', evidence: ['EV-c'], flags: [] }],
    });
    assert(ctx.capabilities.has('cap-x'), 'capabilities 丢失');
    assert(ctx.evidence.has('EV-q') && ctx.evidence.has('EV-c'), 'evidence 未合并');
    assert(ctx.flags.has('FLAG-q'), 'flags 未合并');
    assert(ctx.items.get('mat.scrap') === 3, 'items=' + ctx.items.get('mat.scrap'));
    assert(ctx.credits === 12, 'credits=' + ctx.credits);
    assert(ctx.cleared.has('memory-flip.T1') && ctx.cleared.has('gomoku.T2'), 'cleared 未合并');
    assert(coreModule.resolveStory({ all: [] }, ctx) === true, 'all:[] 应为真');
    assert(coreModule.resolveStory({ any: [] }, ctx) === false, 'any:[] 应为假');
    assert(coreModule.resolveStory({ credits: { atLeast: 10 } }, ctx) === true, 'credits 谓词失败');
    assert(coreModule.resolveStory({ item: 'mat.scrap', atLeast: 2 }, ctx) === true, 'item 谓词失败');
    assert(coreModule.resolveStory({ item: 'mat.scrap', atLeast: 9 }, ctx) === false, 'item 上限谓词失败');
    assert(coreModule.resolveStory({ capability: 'cap-x' }, ctx) === true, 'capability 谓词失败');
    return 'predicates ok';
  });

  await check('A08 career-db Node API 面与 11 个 store 常量', async () => {
    const required = [
      'open',
      'close',
      'isAvailable',
      'getDiscoveryState',
      'saveDiscoveryState',
      'listDiscovery',
      'putDiscovery',
      'getProfile',
      'putProfile',
      'ensureCareer',
      'createRun',
      'getRun',
      'updateRun',
      'getClaim',
      'settleAndClaim',
      'purchase',
      'readWallet',
      'readQuestState',
      'putQuests',
      'resetCareer',
      'resetDiscovery',
      'exportAll',
      'importAll',
    ];
    const missing = required.filter((name) => typeof dbModule[name] !== 'function');
    assert(!missing.length, '缺少 API：' + missing.join(','));
    assert(dbModule.DB_NAME === DB_NAME, 'DB_NAME=' + dbModule.DB_NAME);
    assert(dbModule.DB_VERSION === 1 && dbModule.SCHEMA_VERSION === 1, '版本常量错误');
    const expected = ['state', 'discovery', 'profiles', 'runs', 'claims', 'ledgers', 'balances', 'inventory', 'equipment', 'quests', 'migrations'];
    assert(sameJson(dbModule.STORES, expected), 'STORES=' + JSON.stringify(dbModule.STORES));
    assert(typeof dbModule.__coreTest === 'object', '缺少 __coreTest');
    return dbModule.STORES.length + ' stores';
  });

  await check('A09 career-db Node 无 indexedDB 时结构化失败（绝不回退 localStorage）', async () => {
    const opened = await dbModule.open();
    assert(opened.ok === false && opened.reason === 'no-indexeddb', 'open=' + JSON.stringify(opened));
    assert((await dbModule.isAvailable()) === false, 'isAvailable 应为 false');
    const saved = await dbModule.saveDiscoveryState({ stage: 'DORMANT' }, { generation: 0 });
    assert(saved.ok === false && saved.reason === 'no-indexeddb', 'save=' + JSON.stringify(saved));
    assert((await dbModule.getDiscoveryState()) === null, 'getDiscoveryState 应为 null');
    assert(sameJson(await dbModule.listDiscovery(), []), 'listDiscovery 应为 []');
    assert((await dbModule.getProfile('career-x1')) === null, 'getProfile 应为 null');
    const ensure = await dbModule.ensureCareer({ originGameId: 'memory-flip' });
    assert(ensure.ok === false && ensure.reason === 'no-indexeddb', 'ensureCareer=' + JSON.stringify(ensure));
    const claim = await dbModule.settleAndClaim({ runId: 'run-abc123', careerId: 'career-xyz789', nonce: 'n', plan: { credits: 1 } });
    assert(claim.ok === false && claim.reason === 'no-indexeddb', 'settleAndClaim=' + JSON.stringify(claim));
    const wallet = await dbModule.readWallet('career-xyz789');
    assert(wallet.ok === false && wallet.credits === 0, 'readWallet=' + JSON.stringify(wallet));
    const exported = await dbModule.exportAll();
    assert(exported.ok === false && exported.reason === 'no-indexeddb', 'exportAll=' + JSON.stringify(exported));
    const imported = await dbModule.importAll({});
    assert(imported.ok === false, 'importAll 应失败');
    return 'structured no-indexeddb';
  });

  await check('A10 源码静态边界：无 localStorage / meta:v1 / runs:v1', async () => {
    /* 只看代码行：块注释/JSDoc/行注释里出现这些词是文档说明，不是存储访问。 */
    const codeOnly = (text) =>
      text
        .split('\n')
        .filter((line) => {
          const trimmed = line.trim();
          return !(trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//'));
        })
        .join('\n');
    const sources = [
      { name: 'career-core.js', text: codeOnly(fs.readFileSync(CAREER_CORE, 'utf8')) },
      { name: 'career-db.js', text: codeOnly(fs.readFileSync(CAREER_DB, 'utf8')) },
    ];
    const banned = ['localStorage', 'sessionStorage', 'studiokit:arcade:meta:v1', 'studiokit:arcade:runs:v1', 'document.cookie'];
    const hits = [];
    sources.forEach((source) => {
      banned.forEach((token) => {
        if (source.text.indexOf(token) !== -1) hits.push(source.name + ':' + token);
      });
    });
    assert(!hits.length, '出现禁止的存储访问：' + hits.join(', '));
    return 'clean (' + banned.length + ' tokens)';
  });

  await check('A11 bridge 兼容别名存在（saveState/getState，非 ADR 必需但可被探测）', async () => {
    assert(typeof dbModule.saveState === 'function', '缺少 saveState');
    assert(typeof dbModule.getState === 'function', '缺少 getState');
    const save = await dbModule.saveState({ key: 'discovery', stage: 'DORMANT' }, { generation: 0 });
    assert(save.ok === false && save.reason === 'no-indexeddb', 'saveState=' + JSON.stringify(save));
    assert((await dbModule.getState('discovery')) === null, 'getState 应为 null');
    const single = await dbModule.putDiscovery({ clueId: 'CL-gomoku', sourceGame: 'gomoku' }, { generation: 0 });
    assert(single.ok === false && single.reason === 'no-indexeddb', 'putDiscovery 单条=' + JSON.stringify(single));
    return 'aliases present';
  });
}

/* ------------------------------------------------------------------ *
 * B 组：真实 Chrome + IndexedDB
 * ------------------------------------------------------------------ */

async function runChromeChecks(cdp) {
  const injected = await injectModules(cdp);
  assert(injected.core && injected.db, '模块注入失败：' + JSON.stringify(injected));

  const isolated = await pageEval(cdp, `const reset = await db.__coreTest.deleteDatabase(); return reset;`);
  assert(isolated.ok, '起始 deleteDatabase 失败：' + JSON.stringify(isolated));

  let careerId = null;
  let careerB = 'career-b';
  let localStorageKeysAtStart = [];
  let run1 = null;
  let claim1 = null;
  let purchaseReceipt = null;

  await check('B01 open 后 11 个 store 全部存在（name/version/schema）', async () => {
    const opened = await pageEval(
      cdp,
      `const r = await db.open();
       if (!r.ok) throw new Error('open failed: ' + (r.error || r.reason));
       const names = Array.from(r.db.objectStoreNames);
       const indexes = {};
       for (const name of names) {
         indexes[name] = Array.from(r.db.transaction([name], 'readonly').objectStore(name).indexNames);
       }
       return { ok: r.ok, name: r.db.name, version: r.db.version, names, expected: db.STORES, indexes, ledgersIndex: indexes.ledgers };`,
    );
    assert(opened.ok, 'open 未成功');
    assert(opened.name === DB_NAME, 'DB 名=' + opened.name);
    assert(opened.version === 1, 'DB 版本=' + opened.version);
    assert(sameJson(opened.names.slice().sort(), opened.expected.slice().sort()), 'store 列表不一致：' + JSON.stringify(opened.names));
    assert(opened.names.length === 11, 'store 数量=' + opened.names.length);
    assert(opened.ledgersIndex.indexOf('runId') !== -1, 'ledgers 缺少 runId 索引：' + JSON.stringify(opened.ledgersIndex));
    return opened.names.length + ' stores';
  });

  await check('B02 重复 open 幂等（复用缓存连接）', async () => {
    const result = await pageEval(
      cdp,
      `const a = await db.open();
       const b = await db.open();
       const c = await db.open();
       return { ok: a.ok && b.ok && c.ok, sameConnection: a.db === b.db && b.db === c.db };`,
    );
    assert(result.ok && result.sameConnection, '重复 open 未复用连接：' + JSON.stringify(result));
    return 'same connection';
  });

  await check('B03 isAvailable=true 且无 localStorage 键被创建', async () => {
    localStorageKeysAtStart = await cdp.evaluate(`Object.keys(localStorage).filter((key) => key.indexOf('studiokit:arcade') === 0).sort()`);
    const available = await pageEval(cdp, `return await db.isAvailable();`);
    assert(available === true, 'isAvailable=' + available);
    const after = await cdp.evaluate(`Object.keys(localStorage).filter((key) => key.indexOf('studiokit:arcade') === 0).sort()`);
    assert(sameJson(after, localStorageKeysAtStart), 'open 后 localStorage 变化：' + JSON.stringify(after));
    assert(localStorageKeysAtStart.every((key) => key !== DB_NAME), 'DB 名被写成 localStorage 键');
    return 'available, localStorage keys=' + localStorageKeysAtStart.length;
  });

  await check('B04 discovery 状态往返一致（save → get → list → put）', async () => {
    const state = {
      schemaVersion: 1,
      stage: 'GLIMPSED',
      firstSourceGame: 'memory-flip',
      firstClueId: 'CL-memory-flip',
      hintsEnabled: true,
      portSeenAt: null,
      careerSignedAt: null,
      explorerAt: null,
      updatedAt: '2026-11-22T00:00:00.000Z',
      clues: {
        'CL-memory-flip': {
          clueId: 'CL-memory-flip',
          sourceGame: 'memory-flip',
          firstSeenRunId: null,
          seenAt: '2026-11-22T00:00:00.000Z',
          openedAt: null,
          dismissed: false,
        },
      },
      runs: { 'memory-flip': { eligibleRuns: 2, lastRunId: null, lastRunAt: '2026-11-22T00:00:00.000Z' } },
    };
    const roundTrip = await pageEval(
      cdp,
      `const state = ${JSON.stringify(state)};
       const saved = await db.saveDiscoveryState(state, { generation: 0 });
       const readBack = await db.getDiscoveryState();
       const put = await db.putDiscovery([{ clueId: 'CL-gomoku', sourceGame: 'gomoku', firstSeenRunId: null, seenAt: '2026-11-22T00:00:00.000Z', openedAt: null, dismissed: false }], { generation: 0 });
       const listed = await db.listDiscovery();
       const second = await db.getDiscoveryState();
       return { saved, equal: JSON.stringify(readBack) === JSON.stringify(state), put, listed: listed.map((row) => row.clueId).sort(), stable: JSON.stringify(second) === JSON.stringify(state) };`,
    );
    assert(roundTrip.saved.ok, 'save 失败：' + JSON.stringify(roundTrip.saved));
    assert(roundTrip.equal, 'state 往返不一致');
    assert(roundTrip.put.ok && roundTrip.put.count === 1, 'putDiscovery=' + JSON.stringify(roundTrip.put));
    assert(sameJson(roundTrip.listed, ['CL-gomoku']), 'listDiscovery=' + JSON.stringify(roundTrip.listed));
    assert(roundTrip.stable, 'putDiscovery 改写了 state');
    return 'roundtrip ok';
  });

  await check('B05 discovery 坏数据不崩溃 + resetDiscovery 清空且不动其它', async () => {
    const bad = await pageEval(
      cdp,
      `const out = [];
       out.push(await db.saveDiscoveryState('garbage-string', { generation: 0 }));
       const a = await db.getDiscoveryState();
       out.push(await db.saveDiscoveryState(null, { generation: 0 }));
       const b = await db.getDiscoveryState();
       out.push(await db.saveDiscoveryState({ broken: [1, 2, 3] }, { generation: 0 }));
       const c = await db.getDiscoveryState();
       out.push(await db.putDiscovery([{ clueId: 'bad id' }]));
       return { out, a, b, c, putInvalid: out[3] };`,
    );
    assert(bad.out[0].ok && bad.a === 'garbage-string', '坏数据 save/get 不一致：' + JSON.stringify(bad));
    assert(bad.out[1].ok && bad.b === null, 'null 往返失败：' + JSON.stringify(bad.b));
    assert(bad.out[2].ok && bad.c && bad.c.broken, '对象往返失败');
    assert(bad.putInvalid.ok === false, '非法 clueId 未拒绝：' + JSON.stringify(bad.putInvalid));
    const reset = await pageEval(
      cdp,
      `const reset = await db.resetDiscovery();
       const stateNow = await db.getDiscoveryState();
       const listed = await db.listDiscovery();
       return { reset, stateNow, listed };`,
    );
    assert(reset.reset.ok, 'resetDiscovery=' + JSON.stringify(reset.reset));
    assert(reset.stateNow === null, 'reset 后 state 未清空：' + JSON.stringify(reset.stateNow));
    assert(sameJson(reset.listed, []), 'reset 后 discovery 未清空');
    return 'bad data safe + reset ok';
  });

  await check('B06 ensureCareer 初始 balance=80 且有初始发放流水（单事务）', async () => {
    const created = await pageEval(
      cdp,
      `const r = await db.ensureCareer({ originGameId: 'memory-flip', now: '2026-11-22T00:00:00.000Z' });
       const w = await db.readWallet(r.careerId);
       const all = await db.exportAll();
       const ledgers = all.ok ? all.payload.ledgers : [];
       return { r, w, ledgers };`,
    );
    assert(created.r.ok, 'ensureCareer 失败：' + JSON.stringify(created.r));
    assert(created.r.created === true, 'created=' + created.r.created);
    assert(created.r.balance.credits === 80, 'balance.credits=' + created.r.balance.credits);
    assert(created.w.exists === true && created.w.credits === 80, 'readWallet=' + JSON.stringify(created.w));
    assert(created.ledgers.length === 1, '初始流水数量=' + created.ledgers.length);
    const initialLedger = created.ledgers[0];
    assert(initialLedger.kind === 'initial-grant' || initialLedger.reason === 'initial-grant' || initialLedger.credits === 80, '初始流水内容=' + JSON.stringify(initialLedger));
    careerId = created.r.careerId;
    return 'careerId=' + careerId + ' credits=' + created.w.credits;
  });

  await check('B07 ensureCareer 幂等（created=false）且 profile 修改被保留', async () => {
    const result = await pageEval(
      cdp,
      `const first = await db.ensureCareer({ originGameId: 'memory-flip' });
       const patched = await db.putProfile(Object.assign({}, first.profile, { note: 'preserve-me' }));
       const second = await db.ensureCareer({ originGameId: 'memory-flip' });
       const stored = await db.getProfile(${JSON.stringify(careerId)});
       return { first, patched, second, stored };`,
    );
    assert(result.first.created === false, '第二次 created=' + result.first.created);
    assert(result.first.careerId === careerId, 'careerId 变化：' + result.first.careerId);
    assert(result.patched.ok, 'putProfile=' + JSON.stringify(result.patched));
    assert(result.second.profile && result.second.profile.note === 'preserve-me', 'profile 未保留：' + JSON.stringify(result.second.profile));
    assert(result.second.balance && result.second.balance.credits === 80, '余额被重置：' + JSON.stringify(result.second.balance));
    assert(result.stored && result.stored.note === 'preserve-me', 'getProfile 未保留修改');
    return 'idempotent + profile preserved';
  });

  await check('B08 settleAndClaim 成功（receipt/钱包/库存/任务/流水一致）', async () => {
    run1 = await createRunInPage(cdp, {
      careerId,
      gameId: 'memory-flip',
      commissionId: 'memory-flip.T1',
      nonce: 'nonce-1',
      mode: 'commission',
      sourceMode: 'commission',
      status: 'completed',
    });
    assert(run1.created.ok, 'createRun=' + JSON.stringify(run1.created));
    const plan = { credits: 70, items: { 'mat.scrap': 2 }, evidence: ['EV-memory-1'], flags: ['FLAG-alpha'] };
    const claimed = await pageEval(
      cdp,
      `const first = await db.settleAndClaim({
         runId: ${JSON.stringify(run1.runId)},
         careerId: ${JSON.stringify(careerId)},
         nonce: 'nonce-1',
         plan: ${JSON.stringify(plan)},
         now: '2026-11-22T00:01:00.000Z'
       });
       const wallet = await db.readWallet(${JSON.stringify(careerId)});
       const claim = await db.getClaim(${JSON.stringify(run1.runId)});
       const run = await db.getRun(${JSON.stringify(run1.runId)});
       const quests = await db.readQuestState(${JSON.stringify(careerId)});
       const all = await db.exportAll();
       const ledgers = all.ok ? all.payload.ledgers.filter((row) => row.runId === ${JSON.stringify(run1.runId)}) : [];
       return { first, wallet, claim, run, quests, ledgers };`,
    );
    assert(claimed.first.ok, 'settleAndClaim 失败：' + JSON.stringify(claimed.first));
    assert(claimed.first.duplicate === false, 'duplicate=' + claimed.first.duplicate);
    claim1 = claimed.first.receipt;
    assert(claim1.receiptId === run1.runId, 'receiptId=' + claim1.receiptId);
    assert(claim1.careerId === careerId, 'receipt.careerId=' + claim1.careerId);
    assert(claim1.commissionId === 'memory-flip.T1', 'commissionId=' + claim1.commissionId);
    assert(claim1.credits === 70, 'receipt.credits=' + claim1.credits);
    assert(sameJson(claim1.items, { 'mat.scrap': 2 }), 'receipt.items=' + JSON.stringify(claim1.items));
    assert(sameJson(claim1.evidence, ['EV-memory-1']) && sameJson(claim1.flags, ['FLAG-alpha']), 'evidence/flags 错误');
    assert(claim1.rulesetVersion === 1 && claim1.contentVersion === '0.18.0', '版本字段=' + JSON.stringify(claim1));
    assert(claim1.txIds.length === 3, 'txIds=' + JSON.stringify(claim1.txIds));
    assert(claimed.wallet.credits === 150, '余额=' + claimed.wallet.credits);
    assert(claimed.wallet.items['mat.scrap'] === 2, '库存=' + JSON.stringify(claimed.wallet.items));
    assert(claimed.claim && claimed.claim.runId === run1.runId, 'claims 记录缺失');
    assert(claimed.run && claimed.run.status === 'claimed', 'run.status=' + (claimed.run && claimed.run.status));
    assert(claimed.quests.quests.length === 1 && claimed.quests.quests[0].nodeId === 'memory-flip.T1', 'quests=' + JSON.stringify(claimed.quests.quests));
    assert(claimed.ledgers.length === 3, '流水条数=' + claimed.ledgers.length);
    assert(sameJson(claimed.ledgers.map((row) => row.txId).sort(), claim1.txIds.slice().sort()), '流水 txId 与 receipt 不一致');
    return 'credits=150 items=2 txIds=' + claim1.txIds.length;
  });

  await check('B09 同 runId 第二次 claim → duplicate + 零增量', async () => {
    const before = await snapshot(cdp);
    const result = await pageEval(
      cdp,
      `const second = await db.settleAndClaim({
         runId: ${JSON.stringify(run1.runId)},
         careerId: ${JSON.stringify(careerId)},
         nonce: 'nonce-1',
         plan: { credits: 70, items: { 'mat.scrap': 2 }, evidence: ['EV-memory-1'], flags: ['FLAG-alpha'] },
         now: '2026-11-22T00:02:00.000Z'
       });
       const wallet = await db.readWallet(${JSON.stringify(careerId)});
       const claims = (await db.exportAll()).payload.claims.filter((row) => row.runId === ${JSON.stringify(run1.runId)});
       return { second, wallet, claims };`,
    );
    const after = await snapshot(cdp);
    assert(result.second.ok, 'duplicate claim 失败：' + JSON.stringify(result.second));
    assert(result.second.duplicate === true, 'duplicate=' + result.second.duplicate);
    assert(sameJson(result.second.receipt, claim1), '返回的收据与首次不一致：' + JSON.stringify(result.second.receipt));
    assert(result.wallet.credits === 150, '余额被重复增加：' + result.wallet.credits);
    assert(result.claims.length === 1, 'claims 数量=' + result.claims.length);
    assert(sameJson(before, after), '重复领取产生了写入：' + JSON.stringify({ before, after }));
    return 'duplicate + zero delta';
  });

  await check('B10 同 runId 并发两次 claim 只发一次（事务串行化）', async () => {
    const run2 = await createRunInPage(cdp, {
      careerId,
      gameId: 'memory-flip',
      commissionId: 'memory-flip.T2',
      nonce: 'nonce-2',
      mode: 'commission',
      sourceMode: 'commission',
      status: 'completed',
    });
    assert(run2.created.ok, 'createRun=' + JSON.stringify(run2.created));
    const before = await snapshot(cdp);
    const result = await pageEval(
      cdp,
      `const input = {
         runId: ${JSON.stringify(run2.runId)},
         careerId: ${JSON.stringify(careerId)},
         nonce: 'nonce-2',
         plan: { credits: 50 },
         now: '2026-11-22T00:03:00.000Z'
       };
       const pair = await Promise.all([db.settleAndClaim(input), db.settleAndClaim(input)]);
       const wallet = await db.readWallet(${JSON.stringify(careerId)});
       const claims = (await db.exportAll()).payload.claims.filter((row) => row.runId === ${JSON.stringify(run2.runId)});
       const ledgers = (await db.exportAll()).payload.ledgers.filter((row) => row.runId === ${JSON.stringify(run2.runId)});
       return { pair, wallet, claims, ledgers };`,
    );
    const after = await snapshot(cdp);
    assert(result.pair[0].ok && result.pair[1].ok, '并发 claim 失败：' + JSON.stringify(result.pair));
    const duplicates = result.pair.filter((item) => item.duplicate === true).length;
    assert(duplicates === 1, 'duplicate 数量=' + duplicates + '（应为 1）');
    assert(result.pair.filter((item) => item.duplicate === false).length === 1, '新领取数量应恰好 1');
    assert(result.wallet.credits === 200, '余额=' + result.wallet.credits + '（应为 200）');
    assert(result.claims.length === 1, 'claims 数量=' + result.claims.length);
    assert(result.ledgers.length === 1, '流水条数=' + result.ledgers.length + '（应只有 credits 一步）');
    assert(before.ledgers.length + 1 === after.ledgers.length, '流水增量=' + (after.ledgers.length - before.ledgers.length));
    return 'one award, one duplicate';
  });

  await check('B11 purchase 双击（同 purchaseId）只扣一次', async () => {
    const before = await snapshot(cdp);
    const result = await pageEval(
      cdp,
      `const input = {
         careerId: ${JSON.stringify(careerId)},
         purchaseId: 'P-1',
         cost: 60,
         grants: { items: { 'mat.wire': 1 } },
         now: '2026-11-22T00:04:00.000Z'
       };
       const first = await db.purchase(input);
       const second = await db.purchase(input);
       const wallet = await db.readWallet(${JSON.stringify(careerId)});
       const ledgers = (await db.exportAll()).payload.ledgers.filter((row) => row.purchaseId === 'P-1');
       return { first, second, wallet, ledgers };`,
    );
    purchaseReceipt = result.first.receipt;
    assert(result.first.ok && result.first.duplicate === false, '首次购买失败：' + JSON.stringify(result.first));
    assert(result.first.receipt.cost === 60 && result.first.receipt.balanceAfter === 140, 'receipt=' + JSON.stringify(result.first.receipt));
    assert(result.second.ok && result.second.duplicate === true, '第二次未去重：' + JSON.stringify(result.second));
    assert(sameJson(result.second.receipt, result.first.receipt), '重复返回的 receipt 不一致');
    assert(result.wallet.credits === 140, '余额=' + result.wallet.credits + '（应为 140）');
    assert(result.wallet.items['mat.wire'] === 1, '库存=' + JSON.stringify(result.wallet.items));
    assert(result.ledgers.length === 1, '购买流水条数=' + result.ledgers.length);
    const after = await snapshot(cdp);
    assert(after.ledgers.length === before.ledgers.length + 1, '流水增量=' + (after.ledgers.length - before.ledgers.length));
    return 'charged once, credits=140';
  });

  await check('B12 余额不足购买被拒且零写入；余额永不为负', async () => {
    const before = await snapshot(cdp);
    const result = await pageEval(
      cdp,
      `const rejected = await db.purchase({ careerId: ${JSON.stringify(careerId)}, purchaseId: 'P-2', cost: 100000, grants: { items: { 'mat.wire': 1 } }, now: '2026-11-22T00:05:00.000Z' });
       const tiny = await db.purchase({ careerId: ${JSON.stringify(careerId)}, purchaseId: 'P-3', cost: 999999, grants: {}, now: '2026-11-22T00:05:01.000Z' });
       const wallet = await db.readWallet(${JSON.stringify(careerId)});
       return { rejected, tiny, wallet };`,
    );
    const after = await snapshot(cdp);
    assert(result.rejected.ok === false && result.rejected.reason === 'insufficient', '不足应拒绝：' + JSON.stringify(result.rejected));
    assert(result.tiny.ok === false && result.tiny.reason === 'insufficient', '超大 cost 应拒绝：' + JSON.stringify(result.tiny));
    assert(result.wallet.credits === 140, '余额被扣：' + result.wallet.credits);
    assert(result.wallet.credits >= 0, '余额为负');
    assert(sameJson(before, after), '失败的购买产生了写入：' + JSON.stringify({ before, after }));
    return 'insufficient + zero write';
  });

  await check('B13 invalid nonce 拒绝且零写入', async () => {
    const run3 = await createRunInPage(cdp, {
      careerId,
      gameId: 'memory-flip',
      commissionId: 'memory-flip.T3',
      nonce: 'nonce-3',
      mode: 'commission',
      sourceMode: 'commission',
      status: 'completed',
    });
    const before = await snapshot(cdp);
    const result = await settleInPage(cdp, {
      runId: run3.runId,
      careerId,
      nonce: 'nonce-WRONG',
      plan: { credits: 30 },
      now: '2026-11-22T00:06:00.000Z',
    });
    const after = await snapshot(cdp);
    assert(result.ok === false && result.reason === 'nonce-mismatch', '结果=' + JSON.stringify(result));
    assert(sameJson(before, after), 'nonce 失败产生了写入：' + JSON.stringify({ before, after }));
    return result.reason;
  });

  await check('B14 不存在 run / career 不一致 / 非 commission 模式均拒绝且零写入', async () => {
    const mismatch = await createRunInPage(cdp, {
      careerId,
      gameId: 'memory-flip',
      commissionId: 'memory-flip.T4',
      nonce: 'nonce-4',
      mode: 'commission',
      sourceMode: 'commission',
      status: 'completed',
    });
    const challengeRun = await createRunInPage(cdp, {
      careerId,
      gameId: 'memory-flip',
      commissionId: 'memory-flip.T5',
      nonce: 'nonce-5',
      mode: 'challenge',
      sourceMode: 'challenge',
      status: 'completed',
    });
    const before = await snapshot(cdp);
    const missing = await settleInPage(cdp, {
      runId: 'run-does-not-exist',
      careerId,
      nonce: 'nonce-x',
      plan: { credits: 10 },
      now: '2026-11-22T00:07:00.000Z',
    });
    const careerMis = await settleInPage(cdp, {
      runId: mismatch.runId,
      careerId: 'career-other-1',
      nonce: 'nonce-4',
      plan: { credits: 10 },
      now: '2026-11-22T00:07:01.000Z',
    });
    const modeRejected = await settleInPage(cdp, {
      runId: challengeRun.runId,
      careerId,
      nonce: 'nonce-5',
      plan: { credits: 10 },
      now: '2026-11-22T00:07:02.000Z',
    });
    const after = await snapshot(cdp);
    assert(missing.ok === false && missing.reason === 'missing-run', '缺失 run 未拒绝：' + JSON.stringify(missing));
    assert(careerMis.ok === false && careerMis.reason === 'career-mismatch', 'career 不一致未拒绝：' + JSON.stringify(careerMis));
    assert(modeRejected.ok === false && modeRejected.reason === 'mode-not-allowed', '非委托模式未拒绝：' + JSON.stringify(modeRejected));
    assert(sameJson(before, after), '拒绝路径产生了写入：' + JSON.stringify({ before, after }));
    return [missing.reason, careerMis.reason, modeRejected.reason].join(',');
  });

  await check('B15 非法 plan（负数/超上限/小数）拒绝且零写入', async () => {
    const run4 = await createRunInPage(cdp, {
      careerId,
      gameId: 'memory-flip',
      commissionId: 'memory-flip.T6',
      nonce: 'nonce-6',
      mode: 'commission',
      sourceMode: 'commission',
      status: 'completed',
    });
    const before = await snapshot(cdp);
    const negative = await settleInPage(cdp, { runId: run4.runId, careerId, nonce: 'nonce-6', plan: { credits: -5 }, now: '2026-11-22T00:08:00.000Z' });
    const overCap = await settleInPage(cdp, { runId: run4.runId, careerId, nonce: 'nonce-6', plan: { credits: 99999 }, now: '2026-11-22T00:08:01.000Z' });
    const fractional = await settleInPage(cdp, { runId: run4.runId, careerId, nonce: 'nonce-6', plan: { credits: 1.5 }, now: '2026-11-22T00:08:02.000Z' });
    const badItems = await settleInPage(cdp, { runId: run4.runId, careerId, nonce: 'nonce-6', plan: { credits: 0, items: { 'mat.x': -1 } }, now: '2026-11-22T00:08:03.000Z' });
    const receiptCommission = await pageEval(
      cdp,
      `return await db.settleAndClaim({
         runId: ${JSON.stringify(run4.runId)},
         careerId: ${JSON.stringify(careerId)},
         nonce: 'nonce-6',
         plan: { credits: 0 },
         receipt: { receiptId: ${JSON.stringify(run4.runId)}, careerId: ${JSON.stringify(careerId)}, commissionId: 'other.T1', credits: 0 },
         now: '2026-11-22T00:08:04.000Z'
       });`,
    );
    const receiptCredits = await pageEval(
      cdp,
      `return await db.settleAndClaim({
         runId: ${JSON.stringify(run4.runId)},
         careerId: ${JSON.stringify(careerId)},
         nonce: 'nonce-6',
         plan: { credits: 0 },
         receipt: { receiptId: ${JSON.stringify(run4.runId)}, careerId: ${JSON.stringify(careerId)}, commissionId: 'memory-flip.T6', credits: 999 },
         now: '2026-11-22T00:08:05.000Z'
       });`,
    );
    const after = await snapshot(cdp);
    [
      ['negative', negative, 'bad-credits'],
      ['overCap', overCap, 'bad-credits'],
      ['fractional', fractional, 'bad-credits'],
      ['badItems', badItems, 'bad-items'],
      ['receiptCommission', receiptCommission, 'receipt-mismatch'],
      ['receiptCredits', receiptCredits, 'receipt-mismatch'],
    ].forEach(([label, result, expected]) => {
      assert(result.ok === false && result.reason === expected, label + ' → ' + JSON.stringify(result));
    });
    assert(sameJson(before, after), '非法 plan 产生了写入：' + JSON.stringify({ before, after }));
    return 'negative/overCap/fractional/badItems/receipt-mismatch rejected';
  });

  await check('B16 exportAll 结构完整（format/版本/11 stores 数组）', async () => {
    const result = await pageEval(
      cdp,
      `const all = await db.exportAll();
       const custom = await db.exportAll({ contentVersion: '0.15.0-test' });
       return { all, custom: custom.ok ? custom.payload.contentVersion : null };`,
    );
    assert(result.all.ok, 'exportAll 失败：' + JSON.stringify(result.all));
    const payload = result.all.payload;
    assert(payload.format === 'studiokit-arcade-career', 'format=' + payload.format);
    assert(payload.careerSchemaVersion === 1, 'careerSchemaVersion=' + payload.careerSchemaVersion);
    assert(typeof payload.contentVersion === 'string' && /^\d+\.\d+\.\d+/.test(payload.contentVersion), 'contentVersion=' + payload.contentVersion);
    assert(typeof payload.exportedAt === 'string' && payload.exportedAt.length > 10, 'exportedAt=' + payload.exportedAt);
    const stores = ['profiles', 'state', 'discovery', 'runs', 'claims', 'ledgers', 'balances', 'inventory', 'equipment', 'quests', 'migrations'];
    const missing = stores.filter((name) => !Array.isArray(payload[name]));
    assert(!missing.length, '缺少 stores：' + missing.join(','));
    assert(result.custom === '0.15.0-test', '自定义 contentVersion 未生效：' + result.custom);
    return 'format ok, stores=' + stores.length;
  });

  await check('B17 importAll：merge 引入第二生涯 / replace 回环 / 非法快照拒绝', async () => {
    const snapshotB = {
      format: 'studiokit-arcade-career',
      careerSchemaVersion: 1,
      contentVersion: '0.15.0',
      exportedAt: '2026-11-22T00:09:00.000Z',
      state: [],
      discovery: [],
      profiles: [
        {
          careerId: careerB,
          originGameId: 'gomoku',
          capabilities: [],
          flags: [],
          evidence: [],
          createdAt: '2026-11-22T00:09:00.000Z',
          updatedAt: '2026-11-22T00:09:00.000Z',
        },
      ],
      runs: [],
      claims: [],
      ledgers: [
        {
          txId: 'tx:init:career-b:1',
          kind: 'initial-grant',
          careerId: careerB,
          step: 1,
          credits: 33,
          items: {},
          at: '2026-11-22T00:09:00.000Z',
          rulesetVersion: 1,
          contentVersion: '0.15.0',
        },
      ],
      balances: [{ careerId: careerB, credits: 33, revision: 1, createdAt: '2026-11-22T00:09:00.000Z', updatedAt: '2026-11-22T00:09:00.000Z' }],
      inventory: [{ careerId: careerB, itemId: 'mat.ore', count: 5, updatedAt: '2026-11-22T00:09:00.000Z' }],
      equipment: [{ careerId: careerB, ship: 'scout', updatedAt: '2026-11-22T00:09:00.000Z' }],
      quests: [],
      migrations: [],
    };
    const merged = await pageEval(cdp, `return await db.importAll(${JSON.stringify(snapshotB)}, { mode: 'merge' });`);
    assert(merged.ok, 'merge 导入失败：' + JSON.stringify(merged));
    const walletB = await pageEval(cdp, `return await db.readWallet(${JSON.stringify(careerB)});`);
    assert(walletB.credits === 33 && walletB.items['mat.ore'] === 5, 'career B 钱包=' + JSON.stringify(walletB));
    assert(walletB.equipment.ship === 'scout', 'career B 装备=' + JSON.stringify(walletB.equipment));
    const walletA = await pageEval(cdp, `return await db.readWallet(${JSON.stringify(careerId)});`);
    assert(walletA.credits === 140, 'merge 影响 career A：' + walletA.credits);

    const roundTrip = await pageEval(
      cdp,
      `const before = await db.exportAll();
       const imported = await db.importAll(before.payload, { mode: 'replace' });
       const after = await db.exportAll();
       const counts = (payload) => ({ profiles: payload.profiles.length, claims: payload.claims.length, ledgers: payload.ledgers.length, balances: payload.balances.length, inventory: payload.inventory.length, equipment: payload.equipment.length, quests: payload.quests.length, runs: payload.runs.length, state: payload.state.length, discovery: payload.discovery.length, migrations: payload.migrations.length });
       return { imported, same: JSON.stringify(counts(before.payload)) === JSON.stringify(counts(after.payload)), before: counts(before.payload), after: counts(after.payload) };`,
    );
    assert(roundTrip.imported.ok, 'replace 导入失败：' + JSON.stringify(roundTrip.imported));
    assert(roundTrip.same, 'replace 回环计数不一致：' + JSON.stringify(roundTrip));

    const beforeBad = await snapshot(cdp);
    const bad = await pageEval(
      cdp,
      `const rejectedFormat = await db.importAll({ format: 'wrong-format', careerSchemaVersion: 1 }, { mode: 'replace' });
       const rejectedSchema = await db.importAll(Object.assign({}, ${JSON.stringify(snapshotB)}, { careerSchemaVersion: 9 }), { mode: 'replace' });
       const rejectedMissing = await db.importAll({ format: 'studiokit-arcade-career', careerSchemaVersion: 1 }, { mode: 'replace' });
       return { rejectedFormat, rejectedSchema, rejectedMissing };`,
    );
    const afterBad = await snapshot(cdp);
    assert(bad.rejectedFormat.ok === false && bad.rejectedFormat.reason === 'bad-format', '非法 format：' + JSON.stringify(bad.rejectedFormat));
    assert(bad.rejectedSchema.ok === false && bad.rejectedSchema.reason === 'unsupported-schema', '非法 schema：' + JSON.stringify(bad.rejectedSchema));
    assert(bad.rejectedMissing.ok === false && bad.rejectedMissing.reason === 'bad-snapshot', '缺 store：' + JSON.stringify(bad.rejectedMissing));
    assert(sameJson(beforeBad, afterBad), '非法导入产生了写入');
    return 'merge + replace + rejection ok';
  });

  await check('B18 resetCareer 单事务清除目标生涯且不影响其它 career', async () => {
    const before = await snapshot(cdp);
    assert(before.profiles.length === 2, '准备状态应有 2 个生涯：' + JSON.stringify(before.profiles));
    const result = await pageEval(
      cdp,
      `const reset = await db.resetCareer(${JSON.stringify(careerId)});
       const walletA = await db.readWallet(${JSON.stringify(careerId)});
       const profileA = await db.getProfile(${JSON.stringify(careerId)});
       const walletB = await db.readWallet(${JSON.stringify(careerB)});
       return { reset, walletA, profileA, walletB };`,
    );
    const after = await snapshot(cdp);
    assert(result.reset.ok, 'resetCareer=' + JSON.stringify(result.reset));
    assert(result.profileA === null, 'profile 未删除');
    assert(result.walletA.exists === false && result.walletA.credits === 0, '钱包未清空：' + JSON.stringify(result.walletA));
    assert(result.walletB.credits === 33 && result.walletB.items['mat.ore'] === 5, '其它生涯被破坏：' + JSON.stringify(result.walletB));
    assert(sameJson(after.profiles, [careerB]), 'profiles=' + JSON.stringify(after.profiles));
    assert(sameJson(after.creditsByCareer, { [careerB]: 33 }), 'balances=' + JSON.stringify(after.creditsByCareer));
    assert(after.claims.length === 0, 'claims 未清：' + JSON.stringify(after.claims));
    assert(after.ledgers.every((txId) => txId.indexOf('career-b') !== -1), 'ledgers 未清：' + JSON.stringify(after.ledgers));
    assert(after.runs.length === 0, 'runs 未清：' + JSON.stringify(after.runs));
    assert(after.quests.length === 0, 'quests 未清：' + JSON.stringify(after.quests));
    assert(after.inventory.every((row) => row.indexOf(careerB) === 0), 'inventory 未清：' + JSON.stringify(after.inventory));
    return 'target cleared, other career kept';
  });

  await check('B19 resetDiscovery 只清发现状态，不动生涯资产', async () => {
    const before = await snapshot(cdp);
    const result = await pageEval(
      cdp,
      `await db.saveDiscoveryState({ schemaVersion: 1, stage: 'GLIMPSED', clues: {}, runs: {} }, { generation: 0 });
       await db.putDiscovery([{ clueId: 'CL-gomoku', sourceGame: 'gomoku', seenAt: '2026-11-22T00:10:00.000Z' }], { generation: 0 });
       const reset = await db.resetDiscovery();
       const stateNow = await db.getDiscoveryState();
       const listed = await db.listDiscovery();
       const walletB = await db.readWallet(${JSON.stringify(careerB)});
       const profileB = await db.getProfile(${JSON.stringify(careerB)});
       return { reset, stateNow, listed, walletB, profileB };`,
    );
    const after = await snapshot(cdp);
    assert(result.reset.ok, 'resetDiscovery=' + JSON.stringify(result.reset));
    assert(result.stateNow === null, 'state 未清：' + JSON.stringify(result.stateNow));
    assert(sameJson(result.listed, []), 'discovery 未清：' + JSON.stringify(result.listed));
    assert(result.walletB.credits === 33 && result.profileB && result.profileB.careerId === careerB, 'resetDiscovery 破坏了生涯资产');
    assert(sameJson(before.ledgers, after.ledgers) && sameJson(before.claims, after.claims), 'resetDiscovery 改动了流水/claims');
    return 'discovery cleared, career kept';
  });

  await check('B20 生涯模块未新增/改写 localStorage 键', async () => {
    const keys = await cdp.evaluate(`Object.keys(localStorage).filter((key) => key.indexOf('studiokit:arcade') === 0).sort()`);
    assert(sameJson(keys, localStorageKeysAtStart), 'localStorage 键变化：' + JSON.stringify({ before: localStorageKeysAtStart, after: keys }));
    assert(keys.indexOf(DB_NAME) === -1, 'DB 名出现在 localStorage');
    assert(keys.every((key) => key.indexOf('career') === -1), '出现了 career 相关 localStorage 键：' + JSON.stringify(keys));
    return 'localStorage untouched (' + keys.length + ' keys)';
  });

  await check('B21 测试隔离：deleteDatabase 后库为空且可重建', async () => {
    const result = await pageEval(
      cdp,
      `const deleted = await db.__coreTest.deleteDatabase();
       const listedBeforeOpen = await db.listDiscovery();
       const opened = await db.open();
       const all = await db.exportAll();
       const payload = all.ok ? all.payload : null;
       const counts = payload ? ['state', 'discovery', 'profiles', 'runs', 'claims', 'ledgers', 'balances', 'inventory', 'equipment', 'quests', 'migrations'].map((name) => payload[name].length) : [];
       return { deleted, listedBeforeOpen, opened: opened.ok, counts };`,
    );
    assert(result.deleted.ok, 'deleteDatabase=' + JSON.stringify(result.deleted));
    assert(sameJson(result.listedBeforeOpen, []), '删除后仍有 discovery 记录');
    assert(result.opened === true, '删除后重新 open 失败');
    assert(result.counts.length === 11 && result.counts.every((count) => count === 0), '删除后库不为空：' + JSON.stringify(result.counts));
    return 'empty database after delete';
  });

  await check('B22 updateRun 单事务读-合并-写（不可改 runId/careerId，缺失 run 结构化失败）', async () => {
    const created = await createRunInPage(cdp, {
      careerId: careerB,
      gameId: 'gomoku',
      commissionId: 'gomoku.T1',
      nonce: 'nonce-upd',
      mode: 'commission',
      sourceMode: 'commission',
      status: 'active',
    });
    assert(created.created.ok, 'createRun=' + JSON.stringify(created.created));
    const result = await pageEval(
      cdp,
      `const runId = ${JSON.stringify(created.runId)};
       const updated = await db.updateRun(runId, { status: 'completed', stats: { moves: 34 }, runId: 'hacked-id', careerId: 'hacked-career' });
       const read = await db.getRun(runId);
       const missing = await db.updateRun('run-missing-000', { status: 'completed' });
       const invalid = await db.updateRun(runId, null);
       return { updated, read, missing, invalid };`,
    );
    assert(result.updated.ok, 'updateRun=' + JSON.stringify(result.updated));
    assert(result.read && result.read.status === 'completed', 'status 未更新：' + JSON.stringify(result.read && result.read.status));
    assert(result.read.stats && result.read.stats.moves === 34, 'stats 未合并：' + JSON.stringify(result.read.stats));
    assert(result.read.runId === created.runId, 'runId 被改写：' + result.read.runId);
    assert(result.read.careerId === careerB, 'careerId 被改写：' + result.read.careerId);
    assert(result.missing.ok === false && result.missing.reason === 'missing-run', '缺失 run：' + JSON.stringify(result.missing));
    assert(result.invalid.ok === false && result.invalid.reason === 'bad-patch', '非法 patch：' + JSON.stringify(result.invalid));
    return 'merged status/stats, ids immutable';
  });

  await check('B23 多标签并发 claim（两个真实页面）只发一次奖励', async () => {
    let page2 = null;
    try {
      page2 = await openSecondPage();
      const setup = await pageEval(
        cdp,
        `const career = await db.ensureCareer({ originGameId: 'memory-flip', now: '2026-11-22T00:12:00.000Z' });
         const runId = core.newId('run');
         const created = await db.createRun({ runId, careerId: career.careerId, gameId: 'memory-flip', commissionId: 'memory-flip.T9', nonce: 'nonce-tabs', mode: 'commission', sourceMode: 'commission', status: 'completed' });
         return { runId, careerId: career.careerId, created, ok: created.ok };`,
      );
      assert(setup.ok, 'run 创建失败：' + JSON.stringify(setup.created));
      const input = { runId: setup.runId, careerId: setup.careerId, nonce: 'nonce-tabs', plan: { credits: 40 }, now: '2026-11-22T00:13:00.000Z' };
      const results = await Promise.all([
        settleInPage(cdp, input),
        pageEval(page2, `return await db.settleAndClaim(${JSON.stringify(input)});`),
      ]);
      const verify = await pageEval(
        cdp,
        `const wallet = await db.readWallet(${JSON.stringify(setup.careerId)});
         const all = await db.exportAll();
         const claims = all.ok ? all.payload.claims.filter((row) => row.runId === ${JSON.stringify(setup.runId)}).length : -1;
         const ledgers = all.ok ? all.payload.ledgers.filter((row) => row.runId === ${JSON.stringify(setup.runId)}).length : -1;
         const claimsFromSecond = await db.getClaim(${JSON.stringify(setup.runId)});
         return { wallet, claims, ledgers, hasClaim: !!claimsFromSecond };`,
      );
      assert(results[0].ok && results[1].ok, '并发 claim 失败：' + JSON.stringify(results));
      const duplicates = results.filter((item) => item.duplicate === true).length;
      assert(duplicates === 1, 'duplicate 数量=' + duplicates + '（应为 1）');
      const fresh = results.filter((item) => item.duplicate === false);
      assert(fresh.length === 1 && fresh[0].receipt.credits === 40, '新领取 receipt=' + JSON.stringify(fresh[0] && fresh[0].receipt));
      assert(verify.wallet.credits === 120, '多标签后余额=' + verify.wallet.credits + '（应为 120）');
      assert(verify.claims === 1 && verify.ledgers === 1, 'claims/ledgers=' + verify.claims + '/' + verify.ledgers);
      return 'two tabs: one award, one duplicate, credits=120';
    } finally {
      if (page2) {
        try {
          await pageEval(page2, 'db.close(); return true;');
        } catch (err) {
          /* ignore */
        }
        page2.close();
      }
    }
  });

  await check('B24 其它连接不响应 versionchange 时 deleteDatabase 3s 超时返回 blocked', async () => {
    let page2 = null;
    try {
      page2 = await openSecondPage();
      await page2.evaluate(
        `new Promise((resolve, reject) => {
           const request = indexedDB.open(${JSON.stringify(DB_NAME)}, 1);
           request.onsuccess = () => { window.__rawCareerDb = request.result; resolve(true); };
           request.onerror = () => reject(request.error);
         })`,
      );
      const startedAt = Date.now();
      const blocked = await pageEval(cdp, `const deleted = await db.__coreTest.deleteDatabase(); return deleted;`);
      const elapsed = Date.now() - startedAt;
      assert(blocked.ok === false && blocked.reason === 'blocked', '未结构化返回 blocked：' + JSON.stringify(blocked));
      assert(elapsed >= 2500 && elapsed < 8000, '超时时长异常：' + elapsed + 'ms（期望约 3000ms）');
      await page2.evaluate(`window.__rawCareerDb.close(); delete window.__rawCareerDb; true`);
      const second = await pageEval(cdp, `return await db.__coreTest.deleteDatabase();`);
      assert(second.ok, '连接释放后 deleteDatabase 失败：' + JSON.stringify(second));
      const reopened = await pageEval(cdp, `const opened = await db.open(); return opened.ok;`);
      assert(reopened === true, '重新 open 失败');
      return 'blocked after ' + elapsed + 'ms, then ok';
    } finally {
      if (page2) {
        try {
          await page2.evaluate(`window.__rawCareerDb && window.__rawCareerDb.close(); true`);
        } catch (err) {
          /* ignore */
        }
        page2.close();
      }
    }
  });

  await check('B25 versionchange 时本模块主动关闭连接（deleteDatabase 不被 blocked）', async () => {
    let page2 = null;
    try {
      page2 = await openSecondPage();
      const opened2 = await pageEval(page2, `const opened = await db.open(); return { ok: opened.ok, version: opened.ok ? opened.db.version : 0 };`);
      assert(opened2.ok && opened2.version === 1, '第二标签 open 失败：' + JSON.stringify(opened2));
      await pageEval(page2, `await db.saveDiscoveryState({ marker: 'second-tab' }, { generation: 0 }); return true;`);
      const deleted = await pageEval(cdp, `return await db.__coreTest.deleteDatabase();`);
      assert(deleted.ok === true, 'deleteDatabase 被 blocked（versionchange 未关闭连接）：' + JSON.stringify(deleted));
      const readBack = await pageEval(page2, `const state = await db.getDiscoveryState(); return { state, ok: true };`);
      assert(readBack.state === null, '第二标签未重连或读到旧数据：' + JSON.stringify(readBack));
      await pageEval(cdp, `const opened = await db.open(); return opened.ok;`);
      return 'second tab closed on versionchange, reconnect ok';
    } finally {
      if (page2) {
        try {
          await pageEval(page2, 'db.close(); return true;');
        } catch (err) {
          /* ignore */
        }
        page2.close();
      }
    }
  });

  await check('B26 bridge 兼容适配层：saveState/getState/putDiscovery(单条) 与主接口语义一致', async () => {
    const result = await pageEval(
      cdp,
      `const flat = {
         key: 'discovery',
         schemaVersion: 1,
         stage: 'GLIMPSED',
         firstSourceGame: 'gomoku',
         firstClueId: 'CL-gomoku',
         hintsEnabled: true,
         portSeenAt: null,
         careerSignedAt: null,
         explorerAt: null,
         updatedAt: '2026-11-22T00:14:00.000Z',
         clues: { 'CL-gomoku': { clueId: 'CL-gomoku', sourceGame: 'gomoku', seenAt: '2026-11-22T00:14:00.000Z' } },
         runs: { gomoku: { eligibleRuns: 1 } }
       };
       const saved = await db.saveState(flat, { generation: 0 });
       const viaGetState = await db.getState('discovery');
       const viaPrimary = await db.getDiscoveryState();
       const single = await db.putDiscovery({ clueId: 'CL-shadow-leap', sourceGame: 'shadow-leap', seenAt: '2026-11-22T00:14:01.000Z' }, { generation: 0 });
       const listed = await db.listDiscovery();
       const missingKey = await db.getState('no-such-key');
       return { saved, viaGetState, viaPrimary, single, listed: listed.map((row) => row.clueId).sort(), missingKey };`,
    );
    assert(result.saved.ok, 'saveState=' + JSON.stringify(result.saved));
    assert(result.viaGetState && result.viaGetState.stage === 'GLIMPSED', 'getState=' + JSON.stringify(result.viaGetState));
    assert(result.viaGetState.key === 'discovery', 'getState 应返回带 key 的扁平对象');
    const flatValue = Object.assign({}, result.viaGetState);
    delete flatValue.key;
    assert(sameJson(flatValue, result.viaPrimary), 'saveState 与 getDiscoveryState 语义不一致：' + JSON.stringify({ getState: result.viaGetState, primary: result.viaPrimary }));
    assert(result.single.ok && result.single.count === 1, 'putDiscovery 单条失败：' + JSON.stringify(result.single));
    assert(sameJson(result.listed, ['CL-shadow-leap']), 'listDiscovery=' + JSON.stringify(result.listed));
    assert(result.viaPrimary.clues && result.viaPrimary.clues['CL-gomoku'], 'saveState 写入的线索未进入 state 快照');
    assert(result.missingKey === null, 'getState 未知 key 应为 null：' + JSON.stringify(result.missingKey));
    return 'facade consistent with primary API';
  });
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main() {
  const only = (arg('only', '') || '').toUpperCase();
  const runA = !only || only.indexOf('A') !== -1;
  const runB = !only || only.indexOf('B') !== -1;

  if (!fs.existsSync(CAREER_CORE)) {
    console.error('FAIL  career-core.js 不存在：' + CAREER_CORE);
    return 2;
  }
  if (!fs.existsSync(CAREER_DB)) {
    console.error('FAIL  career-db.js 不存在：' + CAREER_DB);
    return 2;
  }

  let server = null;
  let launched = null;
  let cdp = null;
  let hardFailure = false;
  try {
    if (runA) await runNodeChecks();
    if (runB) {
      SERVER_PORT = envPort('CAREER_DB_PORT', Number(arg('port', 8830)) || 8830);
      CDP_PORT = envPort('CAREER_DB_CDP_PORT', Number(arg('cdp-port', 9430)) || 9430);
      BASE = 'http://127.0.0.1:' + SERVER_PORT;
      fs.mkdirSync(ARTIFACTS, { recursive: true });
      server = await startServer({ root: REPO_ROOT, port: SERVER_PORT });
      launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'studiokit-career-db-' });
      cdp = await openPage({ port: CDP_PORT, ...VIEWPORT, deviceScaleFactor: 1, mobile: true, artifactsDir: ARTIFACTS });
      await cdp.navigate(BASE + '/apps/arcade/index.html');
      const ready = await cdp.evaluate(`({ arcade: !!window.Arcade, title: document.title.indexOf('街机') !== -1 || document.title.length > 0 })`);
      if (!ready.arcade) throw new Error('apps/arcade/index.html 未加载 Arcade 运行时');
      const errorsBefore = cdp.errors.length;
      try {
        await runChromeChecks(cdp);
      } finally {
        try {
          await pageEval(cdp, `return await db.__coreTest.deleteDatabase();`);
        } catch (err) {
          /* 清理尽力而为 */
        }
      }
      const newErrors = cdp.errors.slice(errorsBefore);
      record('B27 页面控制台无 error（注入/事务期间）', newErrors.length === 0, newErrors.slice(0, 3).join(' | '));
    }
    const result = summary();
    return result.failed ? 1 : 0;
  } catch (err) {
    hardFailure = true;
    console.error('FAIL  环境/装配失败：' + (err && err.stack ? err.stack : err));
    return 2;
  } finally {
    if (cdp) {
      try {
        cdp.close();
      } catch (err) {
        /* ignore */
      }
    }
    if (launched) await stopChrome(launched);
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (hardFailure) {
      console.error('\n0/0 checks passed（装配未完成）');
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('FAIL  ' + (err && err.stack ? err.stack : err));
    process.exit(2);
  });
