#!/usr/bin/env node
/**
 * Arcade Life 0.21 — 生涯封存 / 解冻 / 完全重置生命周期浏览器门禁。
 *
 * 真实 Chrome + 真实 IndexedDB + 同一 profile 的两个独立 CDP 标签（tab A / tab B），
 * 不启动第二个 Chrome，不修改产品实现，不写仓库文件（截图除外）。
 *
 * 覆盖：
 *   L1 生涯身份 / 线索 / run / wallet 存在时封存，全部生涯数据保留；
 *   L2 封存后 observe / 接单 / 结算 / 线索写入全部被拒，经典积分 / 进度仍可写；
 *   L3 解冻恢复，原进度逐字节一致；
 *   L4 完全重置：11 stores 清空（generation / 退役标记除外），经典 localStorage 逐字节不变；
 *   L5 重置前打开的旧标签在重置后不能继续用旧 careerId 写生涯；新身份仍可创建；
 *   L6 ?careerPanel=settings 深链在封存下打开设置，UI 显示「解冻生涯」而非「封存生涯」，
 *      点击解冻可用，封存二次确认可用。
 *
 * 零 npm 依赖：只复用 tools/lib/arcade_cdp.mjs。端口 envPort 隔离：
 *   CAREER_ARCHIVE_LIFE_PORT  默认 9932（静态服务器）
 *   CAREER_ARCHIVE_LIFE_CDP   默认 10532（Chrome CDP 请求端口；实际端口由动态分配 + profile 证明）
 * Chrome 严格串行，本测试只连接本轮 launchChrome 返回的标签，不触碰其它实例。
 *
 * 运行：node tools/career_archive_lifecycle_e2e_test.mjs
 * 退出码：0 全部断言通过；1 有 FAIL；2 环境 / 装配失败。
 */
import path from 'node:path';
import { REPO_ROOT, createRecorder, envPort, launchChrome, openPage, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const SERVER_PORT = envPort('CAREER_ARCHIVE_LIFE_PORT', 9932);
const CDP_PORT = envPort('CAREER_ARCHIVE_LIFE_CDP', 10532);
const BASE = `http://127.0.0.1:${SERVER_PORT}`;
const ARTIFACTS = path.join(REPO_ROOT, 'test-artifacts');
const GAME_PATH = '/apps/arcade/games/pendulum-tower.html';
const DB_NAME = 'studiokit:arcade:career';
const CLASSIC_KEYS = [
  'studiokit:arcade:progress:v1',
  'studiokit:arcade:runs:v1',
  'studiokit:arcade:playtime:v1',
  'studiokit:arcade:scores:v1',
  'studiokit:arcade:challenge:v1',
  'studiokit:arcade:meta:v1',
  'studiokit:arcade:prefs:v1',
];

const rec = createRecorder();
const q = (value) => JSON.stringify(value);
let server = null;
let launched = null;
const pages = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** 逐条断言：每条单独记录 PASS/FAIL，失败不中断场景，便于一次拿到全部失败项。 */
function verify(label, condition, detail = '') {
  rec.record(label, !!condition, detail);
  return !!condition;
}

/** 场景级包装：只捕获装配 / 导航异常，场景内断言用 verify 逐条记录。 */
async function scenario(name, fn) {
  try {
    await fn();
  } catch (err) {
    rec.record(name + ' 场景执行异常', false, err && err.message ? err.message : String(err));
  }
}

const detail = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 400 ? text.slice(0, 400) + '…' : text;
};

/* ------------------------------------------------------------------ *
 * 页面辅助
 * ------------------------------------------------------------------ */

async function openTab(url) {
  const page = await openPage({
    port: CDP_PORT,
    width: 420,
    height: 900,
    deviceScaleFactor: 1,
    mobile: true,
    artifactsDir: ARTIFACTS,
  });
  pages.push(page);
  await page.navigate(url);
  await page.waitFor('!!(window.ArcadeCareer && window.ArcadeCareer.ready && window.__arcadeCareerTest)', { timeout: 20000 });
  const ready = await page.evaluate('window.ArcadeCareer.ready.then(function (r) { return { ok: !!(r && r.available), reason: (r && r.reason) || null }; })');
  assert(ready && ready.ok === true, 'bridge 不可用：' + detail(ready));
  return page;
}

function gameUrl(params = {}) {
  const search = new URLSearchParams({ ...params, careerTest: '1' });
  return `${BASE}${GAME_PATH}?${search.toString()}#test`;
}

/** 在 ?careerTest=1 页面中用公开测试钩子取 db/core，执行一段 async 代码。 */
function dbEval(page, body) {
  return page.evaluate(`(async () => {
    const test = window.__arcadeCareerTest;
    if (!test || typeof test.db !== 'function') throw new Error('careerTest db hook missing');
    const db = test.db();
    const core = window.ArcadeCareer.core;
    if (!db || !core) throw new Error('db/core 未装载：db=' + !!db + ' core=' + !!core);
    ${body}
  })()`);
}

/**
 * 只读快照：排序后序列化，便于逐字节比较生涯数据在封存 / 解冻 / 重置前后的变化。
 * 不调用任何写 API。
 */
const SNAPSHOT_BODY = `
  const all = await db.exportAll();
  if (!all.ok) throw new Error('exportAll: ' + detail(all));
  const p = all.payload;
  const sorted = (rows, fn) => (Array.isArray(rows) ? rows : []).map(fn).sort();
  const state = {};
  /* career-archive 是封存操作自身写入的元数据行，不属于「原进度」；比对时排除，
     使封存前后 / 解冻前后 / 重置前后都能用同一份业务数据快照逐字节比较。 */
  (p.state || []).forEach((row) => {
    if (row && typeof row.key === 'string' && row.key !== 'career-archive') state[row.key] = row.value;
  });
  const text = JSON.stringify({
    state: Object.keys(state).sort().map((key) => [key, state[key]]),
    discovery: sorted(p.discovery, (r) => r.clueId + ':' + JSON.stringify(r.value || {})),
    profiles: sorted(p.profiles, (r) => r.careerId + ':' + JSON.stringify(r)),
    balances: sorted(p.balances, (r) => r.careerId + ':' + r.credits),
    runs: sorted(p.runs, (r) => r.runId + ':' + r.status + ':' + (r.careerId || '')),
    claims: sorted(p.claims, (r) => r.runId + ':' + r.credits),
    ledgers: sorted(p.ledgers, (r) => r.txId + ':' + r.credits),
    inventory: sorted(p.inventory, (r) => r.careerId + ':' + r.itemId + '=' + r.count),
    equipment: sorted(p.equipment, (r) => r.careerId + ':' + JSON.stringify(r.equipment || {})),
    quests: sorted(p.quests, (r) => r.careerId + ':' + r.nodeId + ':' + r.status),
    migrations: sorted(p.migrations, (r) => r.id),
  });
  return { text, stateKeys: Object.keys(state).sort() };
`;

function snapshot(page) {
  return dbEval(page, SNAPSHOT_BODY);
}

/** 经典 localStorage 全量字节快照（只读取，不写）。 */
function classicSnapshot(page) {
  return page.evaluate(`(() => {
    const keys = Object.keys(localStorage).filter((key) => key.indexOf('studiokit:arcade:') === 0).sort();
    return JSON.stringify(keys.map((key) => [key, localStorage.getItem(key)]));
  })()`);
}

/** 生涯业务数据（不含 state 内部元数据）是否为空；退役标记 / generation 属于 state 元数据。 */
function careerDataEmpty(page) {
  return dbEval(page, `const all = await db.exportAll();
    if (!all.ok) return false;
    const p = all.payload;
    const stores = ['discovery', 'profiles', 'runs', 'claims', 'ledgers', 'balances', 'inventory', 'equipment', 'quests', 'migrations'];
    if (stores.some((name) => (p[name] || []).length > 0)) return false;
    const state = {};
    (p.state || []).forEach((row) => { if (row && typeof row.key === 'string') state[row.key] = row.value; });
    return !(state.career && state.career.careerId) && !state['career-archive'];
  `);
}

/** 读设置面板当前封存 / 解冻按钮状态。 */
function settingsState(page) {
  return page.evaluate(`(() => {
    const panel = document.querySelector('[data-career-panel="settings"]');
    if (!panel) return { present: false };
    const button = (action) => {
      const el = panel.querySelector('[data-action="' + action + '"]');
      if (!el) return { present: false };
      return { present: true, hidden: el.hidden === true, disabled: el.disabled === true, text: (el.textContent || '').trim() };
    };
    const confirm = panel.querySelector('.ac-career-confirm');
    return {
      present: true,
      freeze: button('freeze-career'),
      unfreeze: button('unfreeze-career'),
      resetAll: button('reset-all-career'),
      text: (panel.textContent || '').replace(/\\s+/g, ' ').trim(),
    };
  })()`);
}

async function waitSettings(page) {
  await page.waitFor('!!document.querySelector(\'[data-career-panel="settings"]\')', { timeout: 10000 });
  return settingsState(page);
}

function closeSettings(page) {
  return page.evaluate(`(() => {
    const panel = document.querySelector('[data-career-panel="settings"]');
    if (!panel) return true;
    const button = panel.querySelector('.ac-career-close');
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

try {
  server = await startServer({ root: REPO_ROOT, port: SERVER_PORT });
  launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'career-lifetest-' });

  /* 两个独立标签：同一 Chrome profile / 同一 IDB origin，但各自的 bridge 内存独立。 */
  const tabA = await openTab(gameUrl());
  const tabB = await openTab(gameUrl());

  let oldCareerId = null;
  let baseline = null;
  let classicBaseline = null;
  let generationBeforeFreeze = null;

  /* ---------------------------------------------------------------- *
   * L1 身份 / 线索 / run / wallet 存在时封存，所有生涯数据保留
   * ---------------------------------------------------------------- */
  await scenario('L1', async () => {
    const seeded = await dbEval(tabA, `const ensured = await db.ensureCareer({ originGameId: 'pendulum-tower' });
      if (!ensured.ok) throw new Error('ensureCareer: ' + detail(ensured));
      window.__lifeCareerId = ensured.careerId;
      const runId = core.newId('run');
      const run = await db.createRun({
        runId, careerId: ensured.careerId, gameId: 'pendulum-tower',
        nonce: 'life-nonce', mode: 'commission', commissionId: 'pendulum-tower.T1', status: 'issued',
      });
      if (!run.ok) throw new Error('createRun: ' + detail(run));
      window.__lifeRunId = runId;
      await db.saveDiscoveryState({
        stage: 'CURIOUS', hintsEnabled: true,
        clues: { 'CL-pendulum-tower': { sourceGame: 'pendulum-tower', stage: 'CURIOUS' } },
      });
      await db.putQuests(ensured.careerId, [{ nodeId: 'story:C0.port_seen', status: 'active', evidence: [], flags: [] }]);
      const wallet = await db.readWallet(ensured.careerId);
      if (!wallet.ok) throw new Error('readWallet: ' + detail(wallet));
      /* 让 bridge 内存中的 commissionLastCareerId 指向刚创建的身份：
         正常职业路径由 commission.start / syncCampaignFlags 设置；本测试直接
         写 DB，需显式初始化，之后 freezeCareer 才能把 careerId 写进标记。 */
      await window.ArcadeCareer.openTown && window.ArcadeCareer.openTown();
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (window.ArcadeCareerUI && window.ArcadeCareerUI.town && window.ArcadeCareerUI.town.close) window.ArcadeCareerUI.town.close();
      return { careerId: ensured.careerId, runId, credits: wallet.credits };
    `);
    verify('L1-01 真实 IDB 已创建生涯身份 / run / 线索 / 钱包',
      !!seeded.careerId && !!seeded.runId && seeded.credits > 0, detail(seeded));

    baseline = await snapshot(tabA);
    const gen = await dbEval(tabA, 'return await db.getDiscoveryGeneration();');
    generationBeforeFreeze = gen && gen.generation;
    verify('L1-02 封存前 discovery-generation 可读', !!gen && gen.ok === true, detail(gen));

    const frozen = await tabA.evaluate('window.ArcadeCareer.freezeCareer()');
    /* freezeCareer 的 careerId 来自 bridge 内存里的 commissionLastCareerId：
       ?careerTest=1 游戏页无 ticket 时该字段为 null。此处只要求封存成功，
       L1-04 单独验证 DB 标记是否携带刚创建的 careerId（产品契约要求）。 */
    verify('L1-03 freezeCareer() 封存成功', !!frozen && frozen.ok === true && frozen.archived === true, detail(frozen));

    const archive = await tabA.evaluate('window.ArcadeCareer.getCareerArchive()');
    verify('L1-04 getCareerArchive() 报告已封存且 careerId 一致',
      !!archive && archive.archived === true && archive.careerId === seeded.careerId, detail(archive));
    const markerKeys = await dbEval(tabA, `const all = await db.exportAll();
      return (all.payload.state || []).filter((row) => row && row.key === 'career-archive').map((row) => row.key);`);
    verify('L1-05 封存标记位于既有 state store 的 career-archive 行',
      markerKeys.length === 1 && baseline.stateKeys.indexOf('career-archive') < 0, detail(markerKeys));

    const after = await snapshot(tabA);
    verify('L1-06 封存后全部生涯数据逐字节保留', after.text === baseline.text,
      after.text === baseline.text ? 'snapshot identical' : 'before=' + detail(baseline.text) + ' after=' + detail(after.text));
    const genAfter = await dbEval(tabA, 'return await db.getDiscoveryGeneration();');
    verify('L1-07 封存不删除 discovery-generation（不得靠删代次封存）',
      !!genAfter && genAfter.ok === true && genAfter.generation === generationBeforeFreeze, detail(genAfter));

    oldCareerId = seeded.careerId;
  });

  /* ---------------------------------------------------------------- *
   * L2 封存后不能写生涯；经典积分 / 进度仍可写
   * ---------------------------------------------------------------- */
  await scenario('L2', async () => {
    const before = await snapshot(tabA);
    const observe = await tabA.evaluate('window.ArcadeCareer.observe("life.test", { value: 1 })');
    verify('L2-01 observe() 在封存下不缓冲 / 返回 false', observe === false, detail(observe));

    const createRun = await dbEval(tabA, `return await db.createRun({
      runId: core.newId('run'), careerId: window.__lifeCareerId, gameId: 'pendulum-tower',
      nonce: 'blocked', mode: 'commission',
    });`);
    verify('L2-02 封存后 createRun 被事务内守卫拒绝',
      !!createRun && createRun.ok === false && String(createRun.reason || createRun.error).includes('career-archived'), detail(createRun));

    const putQuests = await dbEval(tabA, `return await db.putQuests(window.__lifeCareerId, [
      { nodeId: 'life:blocked', status: 'active', evidence: [], flags: [] },
    ]);`);
    verify('L2-03 封存后 putQuests 被拒绝',
      !!putQuests && putQuests.ok === false && String(putQuests.reason || putQuests.error).includes('career-archived'), detail(putQuests));

    const purchase = await dbEval(tabA, `return await db.purchase({
      careerId: window.__lifeCareerId, purchaseId: 'life-blocked', cost: 1, grants: {},
    });`);
    verify('L2-04 封存后 purchase 被拒绝',
      !!purchase && purchase.ok === false && String(purchase.reason || purchase.error).includes('career-archived'), detail(purchase));

    const writeEquipment = await dbEval(tabA, `return await db.writeEquipment({
      careerId: window.__lifeCareerId, patch: { 'module:life:level': 1 },
    });`);
    verify('L2-05 封存后 writeEquipment 被拒绝',
      !!writeEquipment && writeEquipment.ok === false && String(writeEquipment.reason || writeEquipment.error).includes('career-archived'), detail(writeEquipment));

    const finish = await tabA.evaluate('window.ArcadeCareer.finish({ mode: "classic", outcome: "won", stats: {} })');
    verify('L2-06 封存后 finish() 不结算、返回 null', finish === null, detail(finish));

    const hints = await tabA.evaluate('window.ArcadeCareer.setHintsEnabled(false)');
    verify('L2-07 封存后 setHintsEnabled 不写线索偏好、返回 false', hints === false, detail(hints));

    const after = await snapshot(tabA);
    verify('L2-08 拒绝写入后生涯库零半提交', after.text === before.text,
      after.text === before.text ? 'snapshot identical' : 'before=' + detail(before.text) + ' after=' + detail(after.text));

    /* 经典记录在封存下必须继续可写：使用页面自身的 Arcade.Scores / Progress API。 */
    const classicBefore = await classicSnapshot(tabA);
    const classicWrite = await tabA.evaluate(`(() => {
      const A = window.Arcade;
      if (!A || !A.Scores || typeof A.Scores.record !== 'function' || !A.Progress) return { ok: false };
      const rec = A.Scores.record({ gameId: 'pendulum-tower', mode: 'classic', score: 4321, detail: 'life-archive-probe' });
      const progress = A.Progress.recordPlay('pendulum-tower', 4321);
      return { ok: !!rec && !!progress, score: rec && rec.score, high: progress && progress.high };
    })()`);
    verify('L2-09 封存下经典积分 / 进度仍可写', classicWrite.ok === true, detail(classicWrite));
    const classicAfter = await classicSnapshot(tabA);
    verify('L2-10 经典 localStorage 确实发生变化（不是空写）', classicAfter !== classicBefore,
      'before=' + detail(classicBefore) + ' after=' + detail(classicAfter));
    const careerAfterClassic = await snapshot(tabA);
    verify('L2-11 经典写入不影响生涯库', careerAfterClassic.text === before.text,
      careerAfterClassic.text === before.text ? 'snapshot identical' : detail(careerAfterClassic.text));
    classicBaseline = classicAfter;
  });

  /* ---------------------------------------------------------------- *
   * L3 + L6 ?careerPanel=settings 深链：封存下显示解冻，点击恢复原进度
   * ---------------------------------------------------------------- */
  await scenario('L3+L6', async () => {
    await tabB.navigate(gameUrl({ careerPanel: 'settings' }));
    await tabB.waitFor('!!(window.ArcadeCareer && window.ArcadeCareer.ready && window.__arcadeCareerTest)', { timeout: 20000 });
    const ready = await tabB.evaluate('window.ArcadeCareer.ready.then(function (r) { return { ok: !!(r && r.available), reason: (r && r.reason) || null }; })');
    verify('L6-01 ?careerPanel=settings 深链页 bridge 可用', !!ready && ready.ok === true, detail(ready));

    const panel = await waitSettings(tabB);
    verify('L6-02 封存下深链自动打开设置面板', panel.present === true, detail(panel.text));
    verify('L6-03 封存下 UI 显示「解冻生涯」按钮', panel.unfreeze.present && !panel.unfreeze.hidden, detail(panel.unfreeze));
    verify('L6-04 封存下不显示「封存生涯」按钮', !panel.freeze.present || panel.freeze.hidden === true, detail(panel.freeze));

    const clicked = await tabB.evaluate(`(() => {
      const button = document.querySelector('[data-career-panel="settings"] [data-action="unfreeze-career"]');
      if (!button || button.hidden) return false;
      button.click();
      return true;
    })()`);
    verify('L6-05 解冻按钮可点击', clicked === true, detail(clicked));
    if (!clicked) {
      /* UI 缺陷导致按钮不可用时，仍用公开 API 解冻以继续验证 L3 数据恢复，
         避免一个缺陷淹没后续数据完整性断言。 */
      await tabB.evaluate('window.ArcadeCareer.unfreezeCareer()');
    }
    await tabB.waitFor('window.ArcadeCareer.getCareerArchive && window.ArcadeCareer.careerArchived === false', { timeout: 10000 });
    const archive = await tabB.evaluate('window.ArcadeCareer.getCareerArchive()');
    verify('L3-01 点击解冻后 getCareerArchive() 报告未封存', !!archive && archive.archived === false, detail(archive));
    const restored = await snapshot(tabB);
    verify('L3-02 解冻后原身份 / 线索 / run / wallet 全部恢复（逐字节）', restored.text === baseline.text,
      restored.text === baseline.text ? 'snapshot identical' : 'diff before=' + detail(baseline.text) + ' after=' + detail(restored.text));
    const gen = await dbEval(tabB, 'return await db.getDiscoveryGeneration();');
    verify('L3-03 解冻推进 discovery-generation（旧标签快照失效）',
      !!gen && gen.ok === true && gen.generation === generationBeforeFreeze + 1, detail(gen));
  });

  /* ---------------------------------------------------------------- *
   * L6 续：封存二次确认可用
   * ---------------------------------------------------------------- */
  await scenario('L6-confirm', async () => {
    await closeSettings(tabB);
    const opened = await tabB.evaluate('window.ArcadeCareer.openSettings()');
    verify('L6-06 openSettings() 再次打开设置面板', !!opened && opened.ok === true, detail(opened));
    await waitSettings(tabB);
    const before = await snapshot(tabB);
    const shown = await tabB.evaluate(`(() => {
      const button = document.querySelector('[data-career-panel="settings"] [data-action="freeze-career"]');
      if (!button || button.hidden) return false;
      button.click();
      return true;
    })()`);
    verify('L6-07 未封存时「封存生涯」按钮可点击', shown === true, detail(shown));
    const confirmBox = await tabB.evaluate(`(() => {
      const panel = document.querySelector('[data-career-panel="settings"]');
      const boxes = Array.from(panel.querySelectorAll('.ac-career-confirm'));
      const box = boxes.find((node) => node.hidden === false && node.textContent.includes('确认封存'));
      const button = panel && panel.querySelector('[data-action="freeze-career"]');
      return !!box && !!button && button.hidden === true;
    })()`);
    verify('L6-08 首次点击只展开二次确认，未直接封存', confirmBox === true, detail(confirmBox));
    /* 无二次确认框（产品缺陷）时直接用公开 API 封存，让 L6-10/L6-11 继续验证封存结果。 */
    const archiveBeforeConfirm = await tabB.evaluate('window.ArcadeCareer.getCareerArchive()');
    if (!confirmBox && archiveBeforeConfirm && archiveBeforeConfirm.archived === false) {
      await tabB.evaluate('window.ArcadeCareer.freezeCareer()');
    }
    const confirmed = await tabB.evaluate(`(() => {
      const panel = document.querySelector('[data-career-panel="settings"]');
      const boxes = Array.from(panel.querySelectorAll('.ac-career-confirm'));
      const box = boxes.find((node) => node.hidden === false && node.textContent.includes('确认封存'));
      if (!box) return true; // 已由公开 API 兜底封存，此断言本身在 L6-08 已记录失败
      const button = Array.from(box.querySelectorAll('button')).find((node) => (node.textContent || '').includes('确认封存'));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    verify('L6-09 二次确认按钮可点击', confirmed === true, detail(confirmed));
    await tabB.waitFor('window.ArcadeCareer.careerArchived === true', { timeout: 10000 });
    const archive = await tabB.evaluate('window.ArcadeCareer.getCareerArchive()');
    verify('L6-10 二次确认后真正封存', !!archive && archive.archived === true, detail(archive));
    const after = await snapshot(tabB);
    verify('L6-11 二次确认封存不丢数据', after.text === before.text,
      after.text === before.text ? 'snapshot identical' : detail(after.text));
  });

  /* ---------------------------------------------------------------- *
   * L4 完全重置：11 stores 清空，经典 localStorage 逐字节不变
   * ---------------------------------------------------------------- */
  await scenario('L4', async () => {
    /* 旧标签在重置前缓存旧 careerId；重置后它仍持有这个 id。 */
    await tabB.evaluate('window.__lifeOldCareerId = window.__lifeCareerId || ' + q(oldCareerId) + '; true');
    const classicBefore = await classicSnapshot(tabA);
    verify('L4-01 重置前经典 localStorage 快照已记录', classicBefore === classicBaseline, detail(classicBefore));

    const genBeforeReset = await dbEval(tabA, 'return await db.getDiscoveryGeneration();');
    const reset = await dbEval(tabA, 'return await db.resetAllCareer();');
    verify('L4-02 resetAllCareer() 成功', !!reset && reset.ok === true, detail(reset));

    const after = await snapshot(tabA);
    const names = ['discovery', 'profiles', 'runs', 'claims', 'ledgers', 'balances', 'inventory', 'equipment', 'quests', 'migrations'];
    const payload = await dbEval(tabA, `const all = await db.exportAll();
      if (!all.ok) throw new Error('exportAll: ' + detail(all));
      const out = {};
      ['state', ${names.map((n) => q(n)).join(', ')}].forEach((name) => { out[name] = (all.payload[name] || []).length; });
      return out;`);
    names.forEach((name) => verify('L4-03 store ' + name + ' 已清空', payload[name] === 0, detail(payload[name])));
    const stateRows = await dbEval(tabA, `const all = await db.exportAll();
      return (all.payload.state || []).map((row) => row.key).sort();`);
    verify('L4-04 state 中无生涯身份指针与封存标记',
      !stateRows.includes('career') && !stateRows.includes('career-archive'), detail(stateRows));
    const gen = await dbEval(tabA, 'return await db.getDiscoveryGeneration();');
    verify('L4-05 重置推进 discovery-generation',
      !!gen && gen.ok === true && gen.generation === genBeforeReset.generation + 1,
      detail({ before: genBeforeReset && genBeforeReset.generation, after: gen && gen.generation }));
    const archive = await dbEval(tabA, 'return await db.getArchiveState();');
    verify('L4-06 重置后未封存', !!archive && archive.ok === true && archive.archived === false, detail(archive));

    const classicAfter = await classicSnapshot(tabA);
    verify('L4-07 重置不触碰经典 localStorage（逐字节一致）', classicAfter === classicBefore,
      'before=' + detail(classicBefore) + ' after=' + detail(classicAfter));
    verify('L4-08 经典积分 / 进度在重置后仍然存在', classicAfter.includes('studiokit:arcade:scores:v1') && classicAfter.includes('studiokit:arcade:progress:v1'), detail(classicAfter));
    verify('L4-09 生涯业务数据整体为空', await careerDataEmpty(tabA), 'career stores empty');
    void after;
  });

  /* ---------------------------------------------------------------- *
   * L5 重置前打开的旧标签不能用旧 careerId 回写；新身份仍可创建
   * ---------------------------------------------------------------- */
  await scenario('L5', async () => {
    const oldId = await tabB.evaluate('window.__lifeOldCareerId || null');
    verify('L5-00 旧标签持有重置前的 careerId', typeof oldId === 'string' && oldId.length > 0, detail(oldId));

    const writes = await tabB.evaluate(`(async () => {
      const test = window.__arcadeCareerTest;
      const db = test.db();
      const core = window.ArcadeCareer.core;
      const id = window.__lifeOldCareerId;
      const out = {};
      out.createRun = await db.createRun({ runId: core.newId('run'), careerId: id, gameId: 'pendulum-tower', nonce: 'stale', mode: 'commission' });
      out.putQuests = await db.putQuests(id, [{ nodeId: 'life:stale', status: 'active', evidence: [], flags: [] }]);
      out.purchase = await db.purchase({ careerId: id, purchaseId: 'life-stale', cost: 1, grants: {} });
      out.writeEquipment = await db.writeEquipment({ careerId: id, patch: { 'module:life:stale': 1 } });
      out.putProfile = await db.putProfile({ careerId: id });
      /* 不要求旧 updateRun 返回 career-reset：run 已删除，missing-run 是合法结果。 */
      return out;
    })()`);
    const blocked = (result) => !!result && result.ok === false && String(result.reason || result.error).includes('career-reset');
    verify('L5-01 旧标签 createRun(旧 careerId) 返回 career-reset', blocked(writes.createRun), detail(writes.createRun));
    verify('L5-02 旧标签 putQuests(旧 careerId) 返回 career-reset', blocked(writes.putQuests), detail(writes.putQuests));
    verify('L5-03 旧标签 purchase(旧 careerId) 返回 career-reset', blocked(writes.purchase), detail(writes.purchase));
    verify('L5-04 旧标签 writeEquipment(旧 careerId) 返回 career-reset', blocked(writes.writeEquipment), detail(writes.writeEquipment));
    verify('L5-05 旧标签 putProfile(旧 careerId) 返回 career-reset', blocked(writes.putProfile), detail(writes.putProfile));
    verify('L5-06 旧标签回写后生涯库仍为空', await careerDataEmpty(tabB), 'career stores empty');

    const fresh = await dbEval(tabA, `return await db.ensureCareer({ originGameId: 'pendulum-tower' });`);
    verify('L5-07 重置后新身份 ensureCareer 可创建', !!fresh && fresh.ok === true, detail(fresh));
    verify('L5-08 新身份与旧 careerId 不同', !!fresh && fresh.careerId !== oldId, detail({ fresh: fresh && fresh.careerId, oldId }));
    const finalData = await snapshot(tabA);
    verify('L5-09 只有新身份留下，旧身份未复活',
      finalData.text.indexOf(JSON.stringify(oldId)) < 0, detail(finalData.text));
  });
} catch (err) {
  rec.record('装配 / 环境失败', false, err && err.stack ? err.stack : String(err));
} finally {
  for (const page of pages) {
    try { page.close(); } catch (err) { /* ignore */ }
  }
  if (launched) await stopChrome(launched);
  if (server) await new Promise((resolve) => server.close(resolve));
}

const summary = rec.summary('assertions');
if (summary.failed > 0) {
  console.log('\nFAILURES:');
  rec.results.filter((r) => !r.ok).forEach((r) => console.log('  - ' + r.name + (r.detail ? ' — ' + r.detail : '')));
}
process.exitCode = summary.failed > 0 ? 1 : 0;
