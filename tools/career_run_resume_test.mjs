#!/usr/bin/env node
/**
 * StudioKit Arcade Life 0.16 — D16-11 两游戏存档、暂停、丢电恢复（真实 Chrome/CDP 门禁）
 *
 * 端口（显式）：CAREER_RESUME_PORT=8880 / CAREER_RESUME_CDP=9480
 * 运行：node tools/career_run_resume_test.mjs
 * 退出码：0 = 全部通过；1 = 有 FAIL；2 = 环境/装配失败（静态服务器 / Chrome / CDP）。
 *
 * 覆盖矩阵（全部真实 Chrome + 真实 IndexedDB + 真实 sessionStorage ticket）：
 *  S1 层塔 resume/ticket/claim：ticket URL → 真实落箱 4 层 → 暂停 → Page.reload（同 ticket）
 *     → commissionRun 恢复 → 重新达成 4 层 → finish 结算 → 收据 70 / 钱包 150 / run claimed
 *     → 再次 reload 不复活 → 直接重放 commission.settle 返回原收据、零增量。
 *  S2 星海 resume/ticket/claim：T1（startLevel=1）→ 暂停 → reload → 恢复 → 真实 boss 击破
 *     → 「圆满收局」→ 收据 90 / 钱包 170（初始 80 + 90）→ reload 不重复发钱 → 重放幂等。
 *  S3 经典 RunSave 单槽不被职业 run 覆盖：经典层塔真实开始 + 落 1 箱 + pause 自动存，记录
 *     `studiokit:arcade:runs:v1` 逐字节（长度 + SHA-256）；职业层塔与星海 run 全过程逐字节不变；
 *     职业 run 结束后经典局仍可「继续上次」原档续玩。
 *  S4 刷新/更新不复制钱：职业结算后记录钱包/claims/ledgers；普通 reload、SW 注销+重注册、
 *     Page.reload(ignoreCache) 后零变化；commission.settle 直接重放 duplicate 且零增量。
 *  S5 失败/放弃：只达 1 层 → finish → {ok:false, reason:'objective-not-met'}、钱包不变、run failed、
 *     ticket 消费；reload 不复活；另建 ticket 走 abandon → 不发奖、钱包不变、run abandoned。
 *  S6 双游戏独立：同 career 先层塔后星海，钱包 80→150→240、quests/装备连续互不覆盖、
 *     eligible 解锁连续；层塔 ticket 打开星海页 fail-open 经典（不激活、不锁旧档）。
 *  S7 清理：deleteDatabase 后生涯 DB 不存在、ticket 已清。
 *
 * 契约依据：docs/arcade-life/ADR-interfaces.md §18.3 / §18.4 / §18.8 / §18.10。
 * 事件恢复说明：职业 run 的观察事件只在本页内存（commission-core §3.2），刷新后事件缓冲归零，
 * 因此 S1/S2 reload 后必须重新达成目标再结算——本测试对「直接 finish 必失败」不做伪造成，
 * 只验证契约允许的「同 ticket 重开后继续游玩并结算」，并把该行为写入证据。
 *
 * 只读证据：console 输出写入仓库外 qa/evidence/D16-11-test-output.log 与 D16-11-data.json；
 * 截图写入 qa/artifacts-d16-11/。可用 CAREER_QA_DIR 覆盖外部 qa 根目录。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CDP, REPO_ROOT, createRecorder, envPort, launchChrome, openPage, sleep, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const SERVER_PORT = envPort('CAREER_RESUME_PORT', 8880);
const CDP_PORT = envPort('CAREER_RESUME_CDP', 9480);
const QA_DIR = process.env.CAREER_QA_DIR || path.join(REPO_ROOT, 'test-artifacts', 'qa');
const EVIDENCE_DIR = path.join(QA_DIR, 'evidence');
const ARTIFACTS_DIR = path.join(QA_DIR, 'artifacts-d16-11');
const DB_NAME = 'studiokit:arcade:career';
const TICKET_KEY = 'studiokit:arcade:career:ticket.v1';
const RUNS_KEY = 'studiokit:arcade:runs:v1';
const CLEAR_KEYS = [
  RUNS_KEY,
  'studiokit:arcade:progress:v1',
  'studiokit:arcade:scores:v1',
  'studiokit:arcade:playtime:v1',
  'studiokit:arcade:challenge:v1',
  'studiokit:arcade:meta:v1',
  'studiokit:arcade:prefs:v1',
];
const GAME = { tower: '/apps/arcade/games/pendulum-tower.html', star: '/apps/arcade/games/star-raid.html' };
const COMMISSION = { towerT1: 'pendulum-tower.T1', starT1: 'star-raid.T1' };
const INITIAL_CREDITS = 80; // career-core.RULESET.initialCredits
/* 0.17 内容驱动：奖励值不再写死 0.16 数值。 */
const CONTENT_JSON = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'apps/arcade/career/content/commissions.json'), 'utf8'));
const MISSION_BY_ID = new Map((CONTENT_JSON.commissions || []).map((row) => [row.commissionId, row]));
function missionReward(id) {
  const row = MISSION_BY_ID.get(id);
  return row && row.reward ? row.reward : { credits: 0, items: {}, evidence: [], flags: [] };
}
const TOWER_REWARD = missionReward(COMMISSION.towerT1);
const STAR_REWARD = missionReward(COMMISSION.starT1);
function sumItems(items) {
  return Object.keys(items || {}).reduce((sum, key) => sum + Number(items[key] || 0), 0);
}

const NETWORK_NOISE_RE = /(net::ERR_(?:INTERNET_DISCONNECTED|CONNECTION_REFUSED|CONNECTION_CLOSED|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE|TIMED_OUT)|ERR_INTERNET_DISCONNECTED|Failed to fetch|Load failed)/;

const rec = createRecorder();
const logLines = [];
const rawLog = console.log;
console.log = (line) => {
  logLines.push(String(line));
  rawLog(line);
};

const evidence = {
  generatedAt: new Date().toISOString(),
  ports: { server: SERVER_PORT, cdp: CDP_PORT },
  scenarios: {},
  snapshots: {},
  failures: [],
  uncovered: [],
};

let server = null;
let launched = null;
let page = null;
let base = '';
let lastUrl = '';
let scene = 'setup';

const q = (value) => JSON.stringify(value);
const sha256 = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');
const sleepShort = () => sleep(80);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function fail(message) {
  throw new Error(message);
}
function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        out[key] = canon(value[key]);
      });
    return out;
  }
  return value;
}
const stable = (value) => JSON.stringify(canon(value));

async function check(name, fn) {
  try {
    const detail = await fn();
    const text = detail === undefined || detail === null ? '' : String(detail);
    rec.record(name, true, text.slice(0, 700));
    return { ok: true, detail: text };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    const detail = `scene=${scene} · ${message} · url=${lastUrl}`;
    evidence.failures.push({ check: name, scene, url: lastUrl, message });
    rec.record(name, false, detail.slice(0, 900));
    return { ok: false, error: message };
  }
}

function errorsNow() {
  return (page && page.errors ? page.errors.slice() : []).filter((line) => !/favicon\.ico/.test(line));
}
function splitNoise(errors) {
  const noise = [];
  const hard = [];
  errors.forEach((line) => {
    if (NETWORK_NOISE_RE.test(line)) noise.push(line);
    else hard.push(line);
  });
  return { hard, noise };
}
async function assertNoConsoleErrors(label) {
  const { hard, noise } = splitNoise(errorsNow());
  assert(hard.length === 0, `${label} console error ${hard.length} 条：${JSON.stringify(hard)}`);
  return noise.length ? `0 hard errors（已分类网络噪声 ${noise.length} 条：${JSON.stringify(noise).slice(0, 200)}）` : '0 errors';
}

async function goto(url) {
  lastUrl = url;
  await page.navigate(url);
}
async function waitFor(expression, timeout = 9000, interval = 60) {
  return page.waitFor(expression, { timeout, interval });
}
async function waitHardNavigation() {
  await sleep(180);
  await waitFor(`typeof window.__d1611_old === 'undefined'`, 9000);
}
async function reloadPage({ ignoreCache = false, expectBridge = true } = {}) {
  page.errors = [];
  await page.evaluate(`window.__d1611_old = 1; true`);
  await page.send('Page.reload', ignoreCache ? { ignoreCache: true } : {});
  await waitHardNavigation();
  if (expectBridge) await waitBridgeReady();
}
async function reloadViaLocation() {
  page.errors = [];
  await page.evaluate(`window.__d1611_old = 1; location.reload(); true`).catch(() => {});
  await waitHardNavigation();
  await waitBridgeReady();
}
async function waitBridgeReady() {
  await waitFor(`!!(window.ArcadeCareer && window.ArcadeCareer.ready)`, 9000);
  await waitFor(`window.ArcadeCareer.available === true && !!window.__arcadeCareerTest`, 9000);
}
async function waitCareerActive() {
  await waitFor(`!!window.__arcadeTest && !!window.__arcadeTest.careerInfo && window.__arcadeTest.careerInfo().isCommission === true`, 9000);
}
async function waitOverlay() {
  await waitFor(`!!document.querySelector('[data-overlay]') && !document.querySelector('[data-overlay]').hidden`, 7000);
}
async function waitTowerPlaying() {
  await waitFor(`!!window.__arcadeTest && window.__arcadeTest.joyInfo().state === 'playing'`, 7000);
  await sleepShort();
}
async function waitStarPlaying() {
  await waitFor(`!!window.__arcadeTest && window.__arcadeTest.info().state === 'playing'`, 7000);
  await sleepShort();
}
async function waitTowerPaused() {
  await waitFor(`window.__arcadeTest.joyInfo().state === 'paused'`, 6000);
}
async function waitStarPaused() {
  await waitFor(`window.__arcadeTest.info().state === 'paused'`, 6000);
}

async function resetScenario(label) {
  scene = label;
  lastUrl = `${base}/apps/arcade/index.html`;
  await page.navigate(lastUrl);
  const result = await page.evaluate(`(async () => {
    const keys = ${q(CLEAR_KEYS)};
    keys.forEach((key) => { try { localStorage.removeItem(key); } catch (err) {} });
    try { sessionStorage.clear(); } catch (err) {}
    const deleted = await new Promise((resolve) => {
      let done = false;
      const finish = (value) => { if (!done) { done = true; resolve(value); } };
      try {
        const request = indexedDB.deleteDatabase(${q(DB_NAME)});
        request.onsuccess = () => finish({ ok: true });
        request.onerror = () => finish({ ok: false, error: 'delete-error' });
        request.onblocked = () => finish({ ok: false, error: 'delete-blocked' });
      } catch (err) {
        finish({ ok: false, error: String(err && err.message || err) });
      }
      setTimeout(() => finish({ ok: false, error: 'delete-timeout' }), 2000);
    });
    const databases = indexedDB.databases ? (await indexedDB.databases()).map((entry) => entry.name) : [];
    return { deleted, databases };
  })()`);
  await sleep(100);
  assert(result.deleted && result.deleted.ok, `生涯 IDB 清理失败: ${JSON.stringify(result)}`);
  assert(!result.databases.includes(DB_NAME), `生涯 IDB 仍存在: ${JSON.stringify(result.databases)}`);
  page.errors = [];
  return `localStorage/ sessionStorage 已清、${DB_NAME} 已删除`;
}

async function ensureCommission() {
  const result = await page.evaluate(`(async () => {
    const career = window.ArcadeCareer;
    if (!career) return { ok: false, reason: 'bridge-missing' };
    if (career.commission) return { ok: true, via: 'already-loaded' };
    let opened = null;
    try { opened = career.openTown(); } catch (err) { opened = { ok: false, reason: String(err && err.message || err) }; }
    for (let i = 0; i < 120 && !career.commission; i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    /* town.js 是 lazy UI：等它挂载后再关闭，避免面板残留在开始弹层之上。 */
    for (let i = 0; i < 60; i += 1) {
      if (window.ArcadeCareerUI && window.ArcadeCareerUI.town) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    try { if (window.ArcadeCareerUI && window.ArcadeCareerUI.town) window.ArcadeCareerUI.town.close(); } catch (err) {}
    return { ok: !!career.commission, opened, via: 'openTown' };
  })()`);
  assert(result.ok, `commission-core 未装载: ${JSON.stringify(result)}`);
  return result;
}

async function createTicket(commissionId) {
  await goto(`${base}${GAME.tower}?careerTest=1#test`);
  await waitBridgeReady();
  await ensureCommission();
  const started = await page.evaluate(`(async () => {
    const started = await window.ArcadeCareer.commission.start({ commissionId: ${q(commissionId)} });
    const db = window.__arcadeCareerTest.db();
    const run = started && started.ok ? await db.getRun(started.ticketId) : null;
    const wallet = started && started.ok ? await db.readWallet(started.careerId) : null;
    return {
      ok: !!(started && started.ok),
      reason: (started && started.reason) || null,
      reused: !!(started && started.reused),
      ticketId: (started && started.ticketId) || null,
      careerId: (started && started.careerId) || null,
      gameId: started && started.ticket ? started.ticket.gameId : null,
      startParams: started && started.ticket ? started.ticket.startParams : null,
      url: started && started.url ? new URL(started.url, location.href).href : null,
      stored: (() => { try { return sessionStorage.getItem(${q(TICKET_KEY)}); } catch (err) { return null; } })(),
      runStatus: run ? run.status : null,
      wallet: wallet ? { credits: wallet.credits, items: wallet.items } : null,
    };
  })()`);
  assert(started.ok, `commission.start(${commissionId}) 失败: ${JSON.stringify(started)}`);
  assert(typeof started.ticketId === 'string' && started.ticketId.length > 0, `ticketId 缺失: ${JSON.stringify(started)}`);
  assert(typeof started.stored === 'string' && started.stored.includes(started.ticketId), `sessionStorage ticket 缺失: ${JSON.stringify(started.stored)}`);
  assert(started.runStatus === 'issued', `DB run 应为 issued，实际 ${started.runStatus}`);
  return started;
}

function ticketUrlFor(ticket, gameKey) {
  return `${base}${GAME[gameKey]}?career=${encodeURIComponent(ticket.ticketId)}&careerTest=1#test`;
}

async function openTicketRun(ticket, gameKey) {
  await goto(ticketUrlFor(ticket, gameKey));
  await waitBridgeReady();
  await waitCareerActive();
  await waitOverlay();
}

async function startTowerRun() {
  await waitOverlay();
  const button = await page.evaluate(`document.querySelector('[data-ov-btn]').textContent`);
  assert(/开始游戏|继续练手/.test(button), `层塔开始按钮文案异常: ${button}`);
  await page.click('[data-ov-btn]');
  await waitTowerPlaying();
  return page.evaluate(`window.__arcadeTest.joyInfo()`);
}
async function startStarRun() {
  await waitOverlay();
  const button = await page.evaluate(`document.querySelector('[data-ov-btn]').textContent`);
  assert(/开始游戏|继续练手/.test(button), `星海开始按钮文案异常: ${button}`);
  await page.click('[data-ov-btn]');
  await waitStarPlaying();
  return page.evaluate(`window.__arcadeTest.info()`);
}

async function pauseTower() {
  await page.click('[data-pause]');
  await waitTowerPaused();
  await sleepShort();
}
async function pauseStar() {
  await page.click('[data-pause]');
  await waitStarPaused();
  await sleepShort();
}

async function towerDropFloors(count) {
  const result = await page.evaluate(`(() => {
    const test = window.__arcadeTest;
    const feedback = [];
    for (let i = 0; i < ${Number(count)}; i += 1) feedback.push(test.forceSettle(0));
    return { feedback, floors: test.joyInfo().floorsReached, state: test.joyInfo().state };
  })()`);
  return result;
}

async function towerFinishViaBridge(outcome) {
  return page.evaluate(`(async () => {
    const info = window.__arcadeTest.joyInfo();
    const result = await window.ArcadeCareer.finish({ mode: 'classic', outcome: ${q(outcome)}, stats: { score: info.score, floors: info.floorsReached } });
    return {
      result,
      lastFinish: window.__arcadeCareerTest.lastFinish(),
      commissionRun: window.__arcadeCareerTest.commissionRun(),
      ticket: (() => { try { return sessionStorage.getItem(${q(TICKET_KEY)}); } catch (err) { return null; } })(),
    };
  })()`);
}

async function starKillBoss() {
  return page.evaluate(`(() => {
    const test = window.__arcadeTest;
    const before = test.info();
    const spawned = test.spawnBossNow();
    const killed = test.damageBoss(999999);
    return {
      before: { stage: before.stage, theme: before.theme, state: before.state },
      spawned: { bossActive: spawned.bossActive, bossHp: spawned.bossHp, stage: spawned.stage },
      killed: { state: killed.state, stage: killed.stage },
      career: test.careerInfo(),
      state: window.__arcadeCareerTest.commissionState(),
    };
  })()`);
}

async function starSettleViaClearPanel() {
  await waitFor(`window.__arcadeTest.info().state === 'clear'`, 7000);
  const panel = await page.evaluate(`(() => {
    const btn = document.querySelector('[data-ov-btn2]');
    return { text: btn ? btn.textContent : null, hidden: btn ? btn.hidden : null, title: document.querySelector('[data-ov-title]').textContent };
  })()`);
  assert(panel.text === '圆满收局' && panel.hidden === false, `CLEAR 弹层缺少「圆满收局」: ${JSON.stringify(panel)}`);
  await page.click('[data-ov-btn2]');
  await waitFor(`window.__arcadeTest.careerInfo().settled === true && window.__arcadeTest.careerInfo().settledResult !== null`, 9000);
  await waitFor(`window.__arcadeCareerTest.commissionRun() === null`, 9000);
  await sleep(120);
  return page.evaluate(`({
    settled: window.__arcadeTest.careerInfo().settledResult,
    ticket: (() => { try { return sessionStorage.getItem(${q(TICKET_KEY)}); } catch (err) { return null; } })(),
    overlayTitle: document.querySelector('[data-ov-title]').textContent,
    overlayText: document.querySelector('[data-ov-text]').textContent
  })`);
}

async function careerSnapshot(careerId, ticketId) {
  const snapshot = await page.evaluate(`(async () => {
    const db = window.__arcadeCareerTest && window.__arcadeCareerTest.db ? window.__arcadeCareerTest.db() : null;
    if (!db) return { ok: false, reason: 'db-unavailable' };
    const readOr = async (fn, fallback) => { try { return await fn(); } catch (err) { return fallback; } };
    const wallet = ${q(careerId)} ? await readOr(() => db.readWallet(${q(careerId)}), null) : null;
    const run = ${q(ticketId)} ? await readOr(() => db.getRun(${q(ticketId)}), null) : null;
    const claim = ${q(ticketId)} ? await readOr(() => db.getClaim(${q(ticketId)}), null) : null;
    const ledger = ${q(careerId)} ? await readOr(() => db.readLedger(${q(careerId)}, 100), null) : null;
    const equipment = ${q(careerId)} ? await readOr(() => db.getEquipment(${q(careerId)}), null) : null;
    const quests = ${q(careerId)} ? await readOr(() => db.readQuestState(${q(careerId)}), null) : null;
    let counts = null;
    try {
      counts = {};
      for (const store of ['claims', 'ledgers', 'runs', 'quests', 'equipment', 'inventory', 'balances']) {
        counts[store] = await db.__coreTest.countRecords(store);
      }
    } catch (err) { counts = null; }
    let claimsAll = null;
    let ledgersAll = null;
    let rawError = null;
    try {
      const idb = await new Promise((resolve, reject) => {
        const request = indexedDB.open(${q(DB_NAME)});
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const getAll = (store) => new Promise((resolve, reject) => {
        const tx = idb.transaction([store], 'readonly');
        const request = tx.objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
      claimsAll = await getAll('claims');
      ledgersAll = await getAll('ledgers');
      idb.close();
    } catch (err) {
      rawError = String(err && err.message || err);
    }
    return { ok: true, wallet, run, claim, ledger, equipment, quests, counts, claimsAll, ledgersAll, rawError };
  })()`);
  assert(snapshot && snapshot.ok !== false, `生涯快照读取失败: ${JSON.stringify(snapshot)}`);
  return snapshot;
}

function snapshotData(snapshot) {
  return {
    wallet: snapshot.wallet,
    counts: snapshot.counts,
    claims: snapshot.claimsAll,
    ledgers: snapshot.ledgersAll,
    runStatus: snapshot.run ? snapshot.run.status : null,
    claim: snapshot.claim,
    equipment: snapshot.equipment,
    quests: snapshot.quests ? snapshot.quests.quests : null,
  };
}
function assertSnapshotSame(before, after, label, fields = ['wallet', 'claims', 'ledgers', 'counts']) {
  fields.forEach((field) => {
    assert(stable(before[field]) === stable(after[field]), `${label}：${field} 发生变化\nbefore=${stable(before[field]).slice(0, 500)}\nafter=${stable(after[field]).slice(0, 500)}`);
  });
}

async function listAvailable(careerId) {
  return page.evaluate(`(async () => {
    const result = await window.ArcadeCareer.commission.listAvailable({ careerId: ${q(careerId)} });
    const map = {};
    (result && Array.isArray(result.commissions) ? result.commissions : []).forEach((row) => {
      map[row.commissionId] = row.unlocked === true;
    });
    return { ok: !!(result && result.ok), map, careerId: result && result.careerId };
  })()`);
}

async function localRuns() {
  return page.evaluate(`(() => { try { return localStorage.getItem(${q(RUNS_KEY)}); } catch (err) { return null; } })()`);
}
async function localTicket() {
  return page.evaluate(`(() => { try { return sessionStorage.getItem(${q(TICKET_KEY)}); } catch (err) { return null; } })()`);
}

async function replaySettle(ticketId) {
  return page.evaluate(`(async () => {
    const career = window.ArcadeCareer;
    if (!career.commission) {
      try { career.openTown(); } catch (err) {}
      for (let i = 0; i < 120 && !career.commission; i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
      try { if (window.ArcadeCareerUI && window.ArcadeCareerUI.town) window.ArcadeCareerUI.town.close(); } catch (err) {}
    }
    if (!career.commission) return { ok: false, reason: 'commission-unavailable' };
    const result = await career.commission.settle({ ticketId: ${q(ticketId)} });
    return {
      result,
      commissionRun: window.__arcadeCareerTest.commissionRun(),
      ticket: (() => { try { return sessionStorage.getItem(${q(TICKET_KEY)}); } catch (err) { return null; } })(),
    };
  })()`);
}

async function screenshot(name) {
  try {
    await page.screenshot(name);
    return name;
  } catch (err) {
    return null;
  }
}

async function run() {
  base = `http://127.0.0.1:${SERVER_PORT}`;
  scene = 'assembly';
  await check('S0-00 真实 Chrome/CDP + 静态服务器装配（port 8880 / cdp 9480）', async () => {
    lastUrl = `${base}/apps/arcade/index.html`;
    await page.navigate(lastUrl);
    const info = await page.evaluate(`({ ua: navigator.userAgent, hasIDB: !!window.indexedDB, hasSW: 'serviceWorker' in navigator })`);
    assert(info.hasIDB, 'IndexedDB 不可用');
    assert(/HeadlessChrome|Chrome\//.test(info.ua), `不是真实 Chrome: ${info.ua}`);
    return JSON.stringify({ server: SERVER_PORT, cdp: CDP_PORT, hasSW: info.hasSW });
  });

  /* ================================================================== *
   * S1 层塔 resume / ticket / claim
   * ================================================================== */
  await check('S1-01 清场：career IDB 与经典快照清零，未接单页面 fail-open 无职业 run', async () => {
    const cleared = await resetScenario('S1');
    await goto(`${base}${GAME.tower}?careerTest=1#test`);
    await waitBridgeReady();
    await waitOverlay();
    const state = await page.evaluate(`({ run: window.__arcadeCareerTest.commissionRun(), career: window.__arcadeTest.careerInfo(), ticket: sessionStorage.getItem(${q(TICKET_KEY)}), runs: localStorage.getItem(${q(RUNS_KEY)}) })`);
    assert(state.run === null, `无 ticket 时 commissionRun 应为 null: ${JSON.stringify(state.run)}`);
    assert(state.career && state.career.isCommission === false, `无 ticket 时不应进入职业 run: ${JSON.stringify(state.career)}`);
    assert(state.ticket === null && state.runs === null, `清场残留: ${JSON.stringify(state)}`);
    const errors = await assertNoConsoleErrors('S1-01');
    return `${cleared} · ${errors}`;
  });

  let towerTicket = null;
  await check('S1-02 真实 ArcadeCareer.commission.start 签发层塔 T1 ticket（run issued / 初始钱包 80）', async () => {
    towerTicket = await createTicket(COMMISSION.towerT1);
    assert(towerTicket.gameId === 'pendulum-tower', `ticket gameId 应为 pendulum-tower: ${towerTicket.gameId}`);
    assert(stable(towerTicket.startParams) === stable({}), `T1 startParams 应为 {}: ${JSON.stringify(towerTicket.startParams)}`);
    assert(towerTicket.wallet && towerTicket.wallet.credits === INITIAL_CREDITS, `初始钱包应为 ${INITIAL_CREDITS}: ${JSON.stringify(towerTicket.wallet)}`);
    evidence.snapshots.towerTicket = { ticketId: towerTicket.ticketId, careerId: towerTicket.careerId, startParams: towerTicket.startParams };
    return `ticket=${towerTicket.ticketId} career=${towerTicket.careerId} wallet=${towerTicket.wallet.credits}`;
  });

  await check('S1-03 ticket URL 激活层塔职业 run（同 ticket / 锁定旧档 / 目标行可见）', async () => {
    await openTicketRun(towerTicket, 'tower');
    const state = await page.evaluate(`({
      run: window.__arcadeCareerTest.commissionRun(),
      career: window.__arcadeTest.careerInfo(),
      overlayText: document.querySelector('[data-ov-text]').textContent,
      runSave: window.Arcade.RunSave ? window.Arcade.RunSave.get('pendulum-tower') : null,
      runs: localStorage.getItem(${q(RUNS_KEY)})
    })`);
    assert(state.run && state.run.ticketId === towerTicket.ticketId, `commissionRun ticketId 不匹配: ${JSON.stringify(state.run)}`);
    assert(state.run.careerId === towerTicket.careerId && state.run.commissionId === COMMISSION.towerT1 && state.run.gameId === 'pendulum-tower', `commissionRun 字段异常: ${JSON.stringify(state.run)}`);
    assert(state.run.status === 'active', `run 状态应 active: ${state.run.status}`);
    assert(state.career.isCommission === true && state.career.locked === true, `职业锁定状态异常: ${JSON.stringify(state.career)}`);
    assert(state.career.serializeNull === true, '职业 run 内 serialize() 必须返回 null');
    assert(state.career.goalLineVisible === true, '开始弹层缺少戏内目标行');
    assert(/委托：/.test(state.overlayText) && /目标 4 层/.test(state.overlayText), `开始弹层目标文案异常: ${state.overlayText}`);
    assert(state.runSave === null && state.runs === null, `职业 run 读写了经典 RunSave: ${JSON.stringify({ runSave: state.runSave, runs: state.runs })}`);
    const errors = await assertNoConsoleErrors('S1-03');
    return `run=${state.run.ticketId} locked=${state.career.locked} goal=${state.career.level} · ${errors}`;
  });

  await check('S1-04 真实落箱 4 层（页面既有钩子走真实 settleDrop → tower.floor_stable×4）', async () => {
    const info = await startTowerRun();
    const dropped = await towerDropFloors(4);
    const state = await page.evaluate(`window.__arcadeCareerTest.commissionState()`);
    const events = (state && Array.isArray(state.events) ? state.events : []).filter((event) => event.kind === 'tower.floor_stable');
    assert(info.state === 'playing', `开局状态异常: ${JSON.stringify(info)}`);
    assert(dropped.floors === 4, `真实落箱层数应为 4: ${JSON.stringify(dropped)}`);
    assert(events.length === 4, `委托事件 tower.floor_stable 应为 4 次，实际 ${events.length}: ${JSON.stringify(state)}`);
    events.forEach((event, index) => {
      assert(event.sourceMode === 'commission', `第 ${index + 1} 条事件 sourceMode 异常: ${JSON.stringify(event)}`);
      assert(Number.isFinite(Number(event.payload && event.payload.floor)), `第 ${index + 1} 条事件缺少 floor: ${JSON.stringify(event)}`);
    });
    const career = await page.evaluate(`window.__arcadeTest.careerInfo()`);
    assert(career.stableFloors === 4 && career.serializeNull === true, `careerInfo 异常: ${JSON.stringify(career)}`);
    evidence.snapshots.towerPreReload = { floors: career.stableFloors, events: events.length, feedback: dropped.feedback };
    const errors = await assertNoConsoleErrors('S1-04');
    return `floors=${career.stableFloors} tower.floor_stable=${events.length} score反馈=${JSON.stringify(dropped.feedback)} · ${errors}`;
  });

  await check('S1-05 暂停：真实暂停弹层显示目标/已稳 4 层，经典 RunSave 仍为 null', async () => {
    await pauseTower();
    const state = await page.evaluate(`({
      state: window.__arcadeTest.joyInfo().state,
      text: document.querySelector('[data-ov-text]').textContent,
      runs: localStorage.getItem(${q(RUNS_KEY)}),
      career: window.__arcadeTest.careerInfo(),
      ticket: sessionStorage.getItem(${q(TICKET_KEY)})
    })`);
    assert(state.state === 'paused', `暂停后 state 应为 paused: ${state.state}`);
    assert(/已稳 4 层/.test(state.text) && /目标 4 层/.test(state.text), `暂停文案缺少真实进度: ${state.text}`);
    assert(state.runs === null && state.career.serializeNull === true, `暂停写入经典 RunSave: ${JSON.stringify(state)}`);
    assert(typeof state.ticket === 'string' && state.ticket.includes(towerTicket.ticketId), `暂停不应消费 ticket: ${state.ticket}`);
    await screenshot('D16-11-tower-pause.png');
    const errors = await assertNoConsoleErrors('S1-05');
    return `paused floors=${state.career.stableFloors} text=${state.text.replace(/\s+/g, ' ').slice(0, 120)} · ${errors}`;
  });

  evidence.snapshots.towerAfterSettle = {};
  await check('S1-06 location.reload（同 ticket URL）：commissionRun 恢复、页面无异常、事件缓冲按契约归零', async () => {
    await reloadViaLocation();
    await waitCareerActive();
    await waitOverlay();
    const state = await page.evaluate(`({
      run: window.__arcadeCareerTest.commissionRun(),
      career: window.__arcadeTest.careerInfo(),
      commissionState: window.__arcadeCareerTest.commissionState(),
      runs: localStorage.getItem(${q(RUNS_KEY)}),
      ticket: sessionStorage.getItem(${q(TICKET_KEY)}),
      overlayBtn: document.querySelector('[data-ov-btn]').textContent
    })`);
    assert(state.run && state.run.ticketId === towerTicket.ticketId, `reload 后 commissionRun 未恢复: ${JSON.stringify(state.run)}`);
    assert(state.run.status === 'active' && state.run.commissionId === COMMISSION.towerT1, `reload 后 run 状态异常: ${JSON.stringify(state.run)}`);
    assert(state.career.isCommission === true && state.career.locked === true, `reload 后职业锁定丢失: ${JSON.stringify(state.career)}`);
    assert(typeof state.ticket === 'string' && state.ticket.includes(towerTicket.ticketId), `reload 后 sessionStorage ticket 丢失: ${state.ticket}`);
    assert(state.runs === null, `reload 后出现经典 RunSave: ${state.runs}`);
    const buffered = state.commissionState && Array.isArray(state.commissionState.events) ? state.commissionState.events : [];
    assert(buffered.length === 0, `刷新后旧页内存事件不应持久化（ADR §18.3），实际 ${buffered.length} 条`);
    const errors = await assertNoConsoleErrors('S1-06');
    evidence.snapshots.towerResume = { ticketId: state.run.ticketId, status: state.run.status, bufferedEvents: buffered.length, overlayBtn: state.overlayBtn };
    return `resumed ${state.run.ticketId} · bufferedEvents=0（需重新达成）· ${errors}`;
  });

  await check('S1-07 恢复后继续游玩：重新真实落箱 4 层并保持 playing', async () => {
    await startTowerRun();
    const dropped = await towerDropFloors(4);
    const state = await page.evaluate(`window.__arcadeCareerTest.commissionState()`);
    const events = (state && Array.isArray(state.events) ? state.events : []).filter((event) => event.kind === 'tower.floor_stable');
    assert(dropped.state === 'playing' && dropped.floors === 4, `恢复后落箱异常: ${JSON.stringify(dropped)}`);
    assert(events.length === 4, `恢复后 tower.floor_stable 应为 4 次，实际 ${events.length}`);
    const errors = await assertNoConsoleErrors('S1-07');
    return `floors=${dropped.floors} events=${events.length} · ${errors}`;
  });

  let towerSettled = null;
  await check('S1-08 finish 结算：收据 70 / alloy×1 / ticket 消费 / commissionRun 清空', async () => {
    towerSettled = await towerFinishViaBridge('won');
    const result = towerSettled.result;
    assert(result && result.ok === true, `结算失败: ${JSON.stringify(result)}`);
    assert(result.duplicate === false, `首次结算不应 duplicate: ${JSON.stringify(result)}`);
    assert(result.credits === TOWER_REWARD.credits && result.receipt && result.receipt.credits === TOWER_REWARD.credits, `收据金额应为 ${TOWER_REWARD.credits}: ${JSON.stringify(result)}`);
    assert(stable(result.items) === stable(TOWER_REWARD.items), `收据材料应为 ${JSON.stringify(TOWER_REWARD.items)}: ${JSON.stringify(result.items)}`);
    assert(Array.isArray(result.receipt.flags) && result.receipt.flags.includes('C1.work_done'), `收据缺少 C1.work_done: ${JSON.stringify(result.receipt)}`);
    assert(Array.isArray(result.receipt.evidence) && result.receipt.evidence.includes('E-C1-site'), `收据缺少证据: ${JSON.stringify(result.receipt)}`);
    assert(Array.isArray(result.receipt.txIds) && result.receipt.txIds.length >= 2 && new Set(result.receipt.txIds).size === result.receipt.txIds.length, `收据 txIds 异常: ${JSON.stringify(result.receipt.txIds)}`);
    assert(result.repeat === false, '首次达标不应走 repeatSalary');
    assert(towerSettled.commissionRun === null && towerSettled.ticket === null, `结算后 run/ticket 未消费: ${JSON.stringify(towerSettled)}`);
    const errors = await assertNoConsoleErrors('S1-08');
    evidence.snapshots.towerReceipt = result.receipt;
    return `credits=${result.credits} items=${JSON.stringify(result.items)} txIds=${result.receipt.txIds.length} · ${errors}`;
  });

  await check('S1-09 钱包按内容累加 / run claimed / claims 1 行 / 领奖流水 txId 唯一', async () => {
    const snapshot = await careerSnapshot(towerTicket.careerId, towerTicket.ticketId);
    assert(snapshot.wallet && snapshot.wallet.ok && snapshot.wallet.credits === INITIAL_CREDITS + TOWER_REWARD.credits, `钱包应为 80+${TOWER_REWARD.credits}: ${JSON.stringify(snapshot.wallet)}`);
    assert(stable(snapshot.wallet.items) === stable(TOWER_REWARD.items), `钱包材料应为 ${JSON.stringify(TOWER_REWARD.items)}: ${JSON.stringify(snapshot.wallet.items)}`);
    assert(snapshot.wallet.revision === 2, `钱包 revision 应为 2: ${snapshot.wallet.revision}`);
    assert(snapshot.run && snapshot.run.status === 'claimed', `run 状态应为 claimed: ${snapshot.run && snapshot.run.status}`);
    assert(snapshot.claim && snapshot.claim.credits === TOWER_REWARD.credits && snapshot.claim.receiptId === towerTicket.ticketId, `claim 行异常: ${JSON.stringify(snapshot.claim)}`);
    assert(Array.isArray(snapshot.claimsAll) && snapshot.claimsAll.length === 1, `claims 行数应为 1: ${JSON.stringify(snapshot.claimsAll)}`);
    assert(snapshot.counts && snapshot.counts.ledgers === 1 + towerSettled.result.receipt.txIds.length, `ledger 总数应为 1+领奖流水: ${JSON.stringify(snapshot.counts)}`);
    const claimLedgers = (snapshot.ledgersAll || []).filter((row) => row.runId === towerTicket.ticketId);
    assert(claimLedgers.length === towerSettled.result.receipt.txIds.length, `本 ticket 领奖流水条数异常: ${JSON.stringify(claimLedgers)}`);
    assert(new Set(claimLedgers.map((row) => row.txId)).size === claimLedgers.length, '领奖流水 txId 重复');
    evidence.snapshots.towerAfterSettle = snapshotData(snapshot);
    return `wallet=${snapshot.wallet.credits} items=${JSON.stringify(snapshot.wallet.items)} claims=1 ledgers=${snapshot.counts.ledgers}`;
  });

  await check('S1-10 再次 reload 同 ticket：commissionRun===null、钱包不变、无重复发钱', async () => {
    await reloadPage();
    await waitFor(`!!window.__arcadeTest && !!window.__arcadeTest.careerInfo`, 9000);
    await sleep(120);
    const snapshot = await careerSnapshot(towerTicket.careerId, towerTicket.ticketId);
    const state = await page.evaluate(`({ run: window.__arcadeCareerTest.commissionRun(), career: window.__arcadeTest.careerInfo(), ticket: sessionStorage.getItem(${q(TICKET_KEY)}), runs: localStorage.getItem(${q(RUNS_KEY)}) })`);
    assert(state.run === null, `已结算 ticket 的页面不应激活 commissionRun: ${JSON.stringify(state.run)}`);
    assert(state.career && state.career.isCommission === false, `已结算 ticket 不应锁职业模式: ${JSON.stringify(state.career)}`);
    assert(state.ticket === null, `已结算后 sessionStorage ticket 应为空: ${state.ticket}`);
    assert(snapshot.wallet && snapshot.wallet.credits === INITIAL_CREDITS + TOWER_REWARD.credits, `reload 后钱包应不变: ${JSON.stringify(snapshot.wallet)}`);
    assertSnapshotSame(evidence.snapshots.towerAfterSettle, snapshotData(snapshot), 'S1-10 reload');
    const errors = await assertNoConsoleErrors('S1-10');
    return `run=null wallet=150 claims=1 ledgers=4 · ${errors}`;
  });

  await check('S1-11 直接重放 ArcadeCareer.commission.settle：返回原收据（duplicate）、零增量', async () => {
    const before = snapshotData(await careerSnapshot(towerTicket.careerId, towerTicket.ticketId));
    const replay = await replaySettle(towerTicket.ticketId);
    assert(replay.result && replay.result.ok === true, `重放 settle 应成功返回原收据: ${JSON.stringify(replay.result)}`);
    assert(replay.result.duplicate === true, `重放 settle 应 duplicate=true: ${JSON.stringify(replay.result)}`);
    assert(replay.result.credits === TOWER_REWARD.credits, `重放收据金额应 ${TOWER_REWARD.credits}: ${JSON.stringify(replay.result)}`);
    assert(replay.result.receipt && replay.result.receipt.receiptId === towerTicket.ticketId, `重放收据 id 异常: ${JSON.stringify(replay.result.receipt)}`);
    assert(replay.result.receipt.claimedAt === evidence.snapshots.towerReceipt.claimedAt, '重放返回的 claimedAt 与原收据不一致');
    assert(stable(replay.result.receipt.txIds) === stable(evidence.snapshots.towerReceipt.txIds), '重放返回的 txIds 与原收据不一致');
    assert(replay.commissionRun === null, '重放后 commissionRun 仍应为 null');
    const after = snapshotData(await careerSnapshot(towerTicket.careerId, towerTicket.ticketId));
    assertSnapshotSame(before, after, 'S1-11 重放 settle');
    const errors = await assertNoConsoleErrors('S1-11');
    return `duplicate=true credits=70 wallet=150 claims=1 txIds=${replay.result.receipt.txIds.length} · ${errors}`;
  });

  await check('S1-12 层塔场景 console error=0（网络噪声已分类）', async () => {
    return assertNoConsoleErrors('S1-12');
  });

  /* ================================================================== *
   * S2 星海 resume / ticket / claim
   * ================================================================== */
  await check('S2-01 清场后真实签发星海 T1 ticket（startLevel=1 / run issued / 初始钱包 80）', async () => {
    const cleared = await resetScenario('S2');
    const ticket = await createTicket(COMMISSION.starT1);
    assert(ticket.gameId === 'star-raid', `ticket gameId 应为 star-raid: ${ticket.gameId}`);
    assert(ticket.startParams && ticket.startParams.startLevel === 1, `T1 startLevel 应为 1: ${JSON.stringify(ticket.startParams)}`);
    assert(ticket.wallet && ticket.wallet.credits === INITIAL_CREDITS, `初始钱包应为 80: ${JSON.stringify(ticket.wallet)}`);
    evidence.snapshots.starTicket = { ticketId: ticket.ticketId, careerId: ticket.careerId, startParams: ticket.startParams };
    towerTicket = ticket; // 复用变量：本场景的星海 ticket
    return `${cleared} · ticket=${ticket.ticketId} startLevel=${ticket.startParams.startLevel}`;
  });

  await check('S2-02 ticket URL 激活星海职业 run：startLevel=1、护航目标行、serialize null、无 RunSave', async () => {
    await openTicketRun(towerTicket, 'star');
    const state = await page.evaluate(`({
      run: window.__arcadeCareerTest.commissionRun(),
      career: window.__arcadeTest.careerInfo(),
      overlayText: document.querySelector('[data-ov-text]').textContent,
      missionCount: document.querySelectorAll('.career-mission-line').length,
      runs: localStorage.getItem(${q(RUNS_KEY)}),
      runSave: window.Arcade.RunSave ? window.Arcade.RunSave.get('star-raid') : null
    })`);
    assert(state.run && state.run.ticketId === towerTicket.ticketId && state.run.status === 'active', `commissionRun 未激活: ${JSON.stringify(state.run)}`);
    assert(state.run.careerId === towerTicket.careerId && state.run.commissionId === COMMISSION.starT1 && state.run.gameId === 'star-raid', `commissionRun 字段异常: ${JSON.stringify(state.run)}`);
    assert(state.career.isCommission === true && state.career.startLevel === 1 && state.career.state === 'ready', `星海职业就绪态异常: ${JSON.stringify(state.career)}`);
    assert(state.career.serializeNull === true, '星海职业 run 内 serialize() 必须 null');
    assert(state.career.runSave === null && state.runs === null, `星海职业 run 读写了经典 RunSave: ${JSON.stringify({ runSave: state.career.runSave, runs: state.runs })}`);
    assert(state.missionCount === 1 && /护航目标/.test(state.overlayText), `护航目标行异常: ${JSON.stringify({ missionCount: state.missionCount, text: state.overlayText })}`);
    const errors = await assertNoConsoleErrors('S2-02');
    return `run=${state.run.ticketId} startLevel=1 mission=${state.missionCount} · ${errors}`;
  });

  await check('S2-03 真实开局（level=1）：classicLike、旧星币 HUD 隐藏、能量/生命按旧翼经典值', async () => {
    const info = await startStarRun();
    const career = await page.evaluate(`window.__arcadeTest.careerInfo()`);
    assert(info.state === 'playing' && info.stage === 1, `开局 stage 异常: ${JSON.stringify({ state: info.state, stage: info.stage })}`);
    assert(info.theme === 'patrol', `第 1 关主题应为 patrol: ${info.theme}`);
    assert(career.classicLike === true && career.level === 1, `职业 classicLike/level 异常: ${JSON.stringify(career)}`);
    assert(info.lives === 3 && info.maxEnergy === 100 && info.itemCap === 2, `经典旧翼数值不符: ${JSON.stringify({ lives: info.lives, maxEnergy: info.maxEnergy, itemCap: info.itemCap })}`);
    assert(career.hudCreditsHidden === true, '职业 run 仍显示旧星币 HUD');
    assert(career.goalLineVisible === true, 'HUD 缺少护航目标行');
    assert(career.serializeNull === true, '职业 run 内 serialize() 应 null');
    const errors = await assertNoConsoleErrors('S2-03');
    return `stage=${info.stage} theme=${info.theme} lives=${info.lives} energy=${info.maxEnergy} itemCap=${info.itemCap} · ${errors}`;
  });

  await check('S2-04 暂停：暂停弹层「护航途中」且不写经典 RunSave', async () => {
    await pauseStar();
    const state = await page.evaluate(`({
      state: window.__arcadeTest.info().state,
      career: window.__arcadeTest.careerInfo(),
      text: document.querySelector('[data-ov-text]').textContent,
      runs: localStorage.getItem(${q(RUNS_KEY)}),
      ticket: sessionStorage.getItem(${q(TICKET_KEY)})
    })`);
    assert(state.state === 'paused', `暂停 state 应为 paused: ${state.state}`);
    assert(/护航途中/.test(state.text) && /刷新后需从本区开头重来/.test(state.text), `暂停文案异常: ${state.text}`);
    assert(state.career.runSave === null && state.runs === null, `职业暂停写了经典局内档: ${JSON.stringify({ runSave: state.career.runSave, runs: state.runs })}`);
    assert(typeof state.ticket === 'string' && state.ticket.includes(towerTicket.ticketId), `暂停不应消费 ticket: ${state.ticket}`);
    await screenshot('D16-11-star-pause.png');
    const errors = await assertNoConsoleErrors('S2-04');
    return `paused text=${state.text.replace(/\s+/g, ' ').slice(0, 120)} · ${errors}`;
  });

  await check('S2-05 reload（同 ticket）：commissionRun 恢复、startLevel=1、无异常、事件缓冲按契约归零', async () => {
    await reloadViaLocation();
    await waitCareerActive();
    await waitOverlay();
    const state = await page.evaluate(`({
      run: window.__arcadeCareerTest.commissionRun(),
      career: window.__arcadeTest.careerInfo(),
      commissionState: window.__arcadeCareerTest.commissionState(),
      runs: localStorage.getItem(${q(RUNS_KEY)}),
      ticket: sessionStorage.getItem(${q(TICKET_KEY)}),
      overlayBtn: document.querySelector('[data-ov-btn]').textContent,
      overlayText: document.querySelector('[data-ov-text]').textContent
    })`);
    assert(state.run && state.run.ticketId === towerTicket.ticketId && state.run.status === 'active', `reload 后 commissionRun 未恢复: ${JSON.stringify(state.run)}`);
    assert(state.career.isCommission === true && state.career.startLevel === 1, `reload 后职业参数异常: ${JSON.stringify(state.career)}`);
    assert(typeof state.ticket === 'string' && state.ticket.includes(towerTicket.ticketId), `reload 后 ticket 丢失: ${state.ticket}`);
    assert(state.runs === null && state.career.runSave === null, `reload 后出现经典 RunSave: ${JSON.stringify({ runs: state.runs, runSave: state.career.runSave })}`);
    assert(/护航目标/.test(state.overlayText) && state.overlayBtn === '开始游戏', `reload 后开始弹层异常: ${JSON.stringify(state)}`);
    const buffered = state.commissionState && Array.isArray(state.commissionState.events) ? state.commissionState.events : [];
    assert(buffered.length === 0, `刷新后旧页内存事件不应持久化，实际 ${buffered.length} 条`);
    const errors = await assertNoConsoleErrors('S2-05');
    return `resumed ${state.run.ticketId} startLevel=1 bufferedEvents=0 · ${errors}`;
  });

  await check('S2-06 恢复后真实 boss 击破：boss.defeated level=1/theme=patrol 恰好 1 次', async () => {
    await startStarRun();
    const boss = await starKillBoss();
    assert(boss.spawned.bossActive === true && boss.spawned.stage === 1 && boss.spawned.bossHp === 480, `第 1 关 Boss 生成异常: ${JSON.stringify(boss.spawned)}`);
    assert(boss.killed.state === 'clear' && boss.killed.stage === 2, `Boss 击破后的真实状态异常: ${JSON.stringify(boss.killed)}`);
    assert(boss.career.bossKills === 1, `careerBattle.bossKills 应为 1: ${JSON.stringify(boss.career)}`);
    const events = (boss.state && Array.isArray(boss.state.events) ? boss.state.events : []).filter((event) => event.kind === 'boss.defeated');
    assert(events.length === 1, `boss.defeated 事件应为 1 次，实际 ${events.length}`);
    assert(events[0].payload.level === 1 && events[0].payload.theme === 'patrol', `boss.defeated payload 异常: ${JSON.stringify(events[0].payload)}`);
    assert(events[0].sourceMode === 'commission', `boss.defeated sourceMode 异常: ${JSON.stringify(events[0])}`);
    const errors = await assertNoConsoleErrors('S2-06');
    return `bossHp=480 state=${boss.killed.state} stage=${boss.killed.stage} payload=${JSON.stringify(events[0].payload)} · ${errors}`;
  });

  let starSettled = null;
  await check('S2-07 「圆满收局」结算：收据按内容 / ticket 消费 / overlay 护航完成', async () => {
    starSettled = await starSettleViaClearPanel();
    assert(starSettled.settled && starSettled.settled.ok === true, `星海结算应成功: ${JSON.stringify(starSettled.settled)}`);
    assert(starSettled.settled.credits === STAR_REWARD.credits, `T1 收据应为 ${STAR_REWARD.credits}: ${JSON.stringify(starSettled.settled)}`);
    assert(starSettled.settled.duplicate === false, `首次结算不应 duplicate: ${JSON.stringify(starSettled.settled)}`);
    assert(starSettled.settled.items === sumItems(STAR_REWARD.items), `收据材料件数应为 ${sumItems(STAR_REWARD.items)}: ${JSON.stringify(starSettled.settled)}`);
    assert(starSettled.ticket === null, `结算后 sessionStorage ticket 应为空: ${starSettled.ticket}`);
    assert(starSettled.overlayTitle === '护航完成', `结算后 overlay title 异常: ${starSettled.overlayTitle}`);
    await screenshot('D16-11-star-result.png');
    const errors = await assertNoConsoleErrors('S2-07');
    return `credits=90 items=1 overlay=${starSettled.overlayTitle} · ${errors}`;
  });

  await check('S2-08 钱包按内容累加 / run claimed / claims 1 行 / 领奖流水', async () => {
    const snapshot = await careerSnapshot(towerTicket.careerId, towerTicket.ticketId);
    assert(snapshot.wallet && snapshot.wallet.credits === INITIAL_CREDITS + STAR_REWARD.credits, `钱包应为 80+${STAR_REWARD.credits}: ${JSON.stringify(snapshot.wallet)}`);
    assert(stable(snapshot.wallet.items) === stable(STAR_REWARD.items), `T1 材料应为 ${JSON.stringify(STAR_REWARD.items)}: ${JSON.stringify(snapshot.wallet.items)}`);
    assert(snapshot.wallet.revision === 2, `钱包 revision 应为 2: ${snapshot.wallet.revision}`);
    assert(snapshot.run && snapshot.run.status === 'claimed', `run 状态应为 claimed: ${snapshot.run && snapshot.run.status}`);
    assert(snapshot.claim && snapshot.claim.credits === STAR_REWARD.credits && snapshot.claim.commissionId === COMMISSION.starT1, `claim 行异常: ${JSON.stringify(snapshot.claim)}`);
    assert(Array.isArray(snapshot.claimsAll) && snapshot.claimsAll.length === 1, `claims 行数应为 1: ${snapshot.claimsAll && snapshot.claimsAll.length}`);
    const claimLedgers = (snapshot.ledgersAll || []).filter((row) => row.runId === towerTicket.ticketId);
    assert(claimLedgers.length >= 2 && new Set(claimLedgers.map((row) => row.txId)).size === claimLedgers.length, `领奖流水异常: ${JSON.stringify(claimLedgers)}`);
    evidence.snapshots.starAfterSettle = snapshotData(snapshot);
    return `wallet=${snapshot.wallet.credits} items=${JSON.stringify(snapshot.wallet.items)} claims=1`;
  });

  await check('S2-09 reload 后不重复发钱：commissionRun null、钱包仍 170、claims/ledgers 不变', async () => {
    await reloadPage();
    await waitFor(`!!window.__arcadeTest && !!window.__arcadeTest.careerInfo`, 9000);
    await sleep(120);
    const snapshot = await careerSnapshot(towerTicket.careerId, towerTicket.ticketId);
    const state = await page.evaluate(`({ run: window.__arcadeCareerTest.commissionRun(), career: window.__arcadeTest.careerInfo(), ticket: sessionStorage.getItem(${q(TICKET_KEY)}) })`);
    assert(state.run === null && state.career.isCommission === false, `已结算 ticket reload 后不应复活: ${JSON.stringify(state)}`);
    assert(state.ticket === null, `reload 后 sessionStorage ticket 应为空: ${state.ticket}`);
    assert(snapshot.wallet && snapshot.wallet.credits === INITIAL_CREDITS + STAR_REWARD.credits, `reload 后钱包应不变: ${JSON.stringify(snapshot.wallet)}`);
    assertSnapshotSame(evidence.snapshots.starAfterSettle, snapshotData(snapshot), 'S2-09 reload');
    const errors = await assertNoConsoleErrors('S2-09');
    return `run=null wallet=170 claims=1 · ${errors}`;
  });

  await check('S2-10 星海 settle 重放：duplicate 原收据 90、钱包/claims/ledgers 零增量', async () => {
    const before = snapshotData(await careerSnapshot(towerTicket.careerId, towerTicket.ticketId));
    const replay = await replaySettle(towerTicket.ticketId);
    assert(replay.result && replay.result.ok === true && replay.result.duplicate === true, `重放 settle 应 duplicate: ${JSON.stringify(replay.result)}`);
    assert(replay.result.credits === STAR_REWARD.credits && replay.result.receipt.receiptId === towerTicket.ticketId, `重放收据异常: ${JSON.stringify(replay.result)}`);
    const after = snapshotData(await careerSnapshot(towerTicket.careerId, towerTicket.ticketId));
    assertSnapshotSame(before, after, 'S2-10 重放 settle');
    const errors = await assertNoConsoleErrors('S2-10');
    return `duplicate=true credits=${STAR_REWARD.credits} wallet=${INITIAL_CREDITS + STAR_REWARD.credits} · ${errors}`;
  });

  await check('S2-11 星海场景 console error=0（网络噪声已分类）', async () => {
    return assertNoConsoleErrors('S2-11');
  });

  /* ================================================================== *
   * S3 经典 RunSave 单槽不被职业 run 覆盖
   * ================================================================== */
  let classicRuns = null;
  let classicMeta = null;
  await check('S3-01 清场后经典层塔真实开局 + 落 1 箱 + pause 自动存，记录 runs:v1 逐字节基线', async () => {
    const cleared = await resetScenario('S3');
    await goto(`${base}${GAME.tower}#test`);
    await waitFor(`!!window.__arcadeTest`, 9000);
    await startTowerRun();
    await page.evaluate(`(() => { window.__arcadeTest.forceSettle(0); return true; })()`);
    await pauseTower();
    const saved = await page.evaluate(`({
      runs: localStorage.getItem(${q(RUNS_KEY)}),
      state: window.__arcadeTest.joyInfo().state,
      floors: window.__arcadeTest.joyInfo().floorsReached,
      score: window.__arcadeTest.joyInfo().score
    })`);
    assert(typeof saved.runs === 'string' && saved.runs.length > 0, '经典 pause 未写入 runs:v1');
    const parsed = JSON.parse(saved.runs);
    const record = parsed.games && parsed.games['pendulum-tower'];
    assert(record && record.data && record.data.mode === 'classic', `runs:v1 经典记录异常: ${saved.runs.slice(0, 300)}`);
    assert(record.data.floorsReached === 1, `经典存档 floorsReached 应为 1: ${record.data.floorsReached}`);
    assert(saved.state === 'paused' && saved.floors === 1, `经典存档时状态异常: ${JSON.stringify(saved)}`);
    classicRuns = saved.runs;
    classicMeta = { length: classicRuns.length, sha256: sha256(classicRuns), floors: record.data.floorsReached, score: record.data.score, summary: record.summary, savedAt: record.savedAt };
    evidence.snapshots.classicRunSave = classicMeta;
    return `${cleared} · runtime len=${classicMeta.length} sha256=${classicMeta.sha256} floors=1 score=${classicMeta.score}`;
  });

  const assertRunsBaseline = async (label) => {
    const now = await localRuns();
    assert(now === classicRuns, `${label}：经典 runs:v1 被职业 run 改写（逐字节不一致）\nbaseline=${String(classicRuns).slice(0, 400)}\nactual=${String(now).slice(0, 400)}`);
    return `runs:v1 未变（len=${String(now).length} sha256=${sha256(String(now))}）`;
  };

  let s3Tower = null;
  await check('S3-02 职业层塔 run 打开/开局/落 4 层：runs:v1 与经典基线逐字节相同', async () => {
    s3Tower = await createTicket(COMMISSION.towerT1);
    await openTicketRun(s3Tower, 'tower');
    const before = await assertRunsBaseline('职业层塔 boot');
    await startTowerRun();
    await towerDropFloors(4);
    const after = await assertRunsBaseline('职业层塔落箱后');
    const career = await page.evaluate(`window.__arcadeTest.careerInfo()`);
    assert(career.serializeNull === true && career.locked === true, `层塔职业锁定异常: ${JSON.stringify(career)}`);
    const errors = await assertNoConsoleErrors('S3-02');
    return `${before}；${after}；floors=${career.stableFloors} · ${errors}`;
  });

  await check('S3-03 职业层塔结算后：runs:v1 仍逐字节相同', async () => {
    const settled = await towerFinishViaBridge('won');
    assert(settled.result && settled.result.ok === true && settled.result.credits === TOWER_REWARD.credits, `层塔职业结算异常: ${JSON.stringify(settled.result)}`);
    const runs = await assertRunsBaseline('职业层塔结算后');
    const errors = await assertNoConsoleErrors('S3-03');
    return `receipt=${TOWER_REWARD.credits} · ${runs} · ${errors}`;
  });

  let s3Star = null;
  await check('S3-04 职业星海 run 打开/开局/结算：runs:v1 全程逐字节相同', async () => {
    s3Star = await createTicket(COMMISSION.starT1);
    await openTicketRun(s3Star, 'star');
    const boot = await assertRunsBaseline('职业星海 boot');
    await startStarRun();
    const killed = await starKillBoss();
    assert(killed.killed.state === 'clear', `星海 Boss 未击破: ${JSON.stringify(killed.killed)}`);
    const mid = await assertRunsBaseline('职业星海 Boss 击破后');
    const settled = await starSettleViaClearPanel();
    assert(settled.settled && settled.settled.ok === true && settled.settled.credits === STAR_REWARD.credits, `星海职业结算异常: ${JSON.stringify(settled.settled)}`);
    const after = await assertRunsBaseline('职业星海结算后');
    const snapshot = await careerSnapshot(s3Star.careerId, s3Star.ticketId);
    assert(snapshot.wallet && snapshot.wallet.credits === INITIAL_CREDITS + TOWER_REWARD.credits + STAR_REWARD.credits, `同一 career 先层塔后星海钱包异常: ${JSON.stringify(snapshot.wallet)}`);
    assert(stable(snapshot.wallet.items) === stable(Object.assign({}, TOWER_REWARD.items, STAR_REWARD.items)), `同一 career 材料异常: ${JSON.stringify(snapshot.wallet.items)}`);
    const errors = await assertNoConsoleErrors('S3-04');
    return `${boot}；${mid}；${after}；wallet=${INITIAL_CREDITS + TOWER_REWARD.credits + STAR_REWARD.credits} · ${errors}`;
  });

  await check('S3-05 职业 run 结束后经典局仍可「继续上次」按原档续玩（floors=1 / score 一致）', async () => {
    await goto(`${base}${GAME.tower}#test`);
    await waitFor(`!!window.__arcadeTest`, 9000);
    await waitOverlay();
    const prompt = await page.evaluate(`({ title: document.querySelector('[data-ov-title]').textContent, text: document.querySelector('[data-ov-text]').textContent, btn: document.querySelector('[data-ov-btn]').textContent, runs: localStorage.getItem(${q(RUNS_KEY)}) })`);
    assert(prompt.title === '继续上次？' && prompt.btn === '继续上次', `经典续玩弹层异常: ${JSON.stringify(prompt)}`);
    assert(prompt.runs === classicRuns, '进入经典页时 runs:v1 已与基线不一致');
    await page.click('[data-ov-btn]');
    await waitTowerPlaying();
    const restored = await page.evaluate(`({ state: window.__arcadeTest.joyInfo().state, floors: window.__arcadeTest.joyInfo().floorsReached, score: window.__arcadeTest.joyInfo().score })`);
    assert(restored.state === 'playing', `经典续玩未进入 playing: ${JSON.stringify(restored)}`);
    assert(restored.floors === 1, `经典续玩层数应为 1: ${restored.floors}`);
    assert(restored.score === classicMeta.score, `经典续玩分数应与存档一致: ${restored.score} vs ${classicMeta.score}`);
    return `title=${prompt.title} floors=${restored.floors} score=${restored.score}`;
  });

  await check('S3-06 存档隔离场景 console error=0', async () => {
    return assertNoConsoleErrors('S3-06');
  });

  /* ================================================================== *
   * S4 刷新/更新不复制钱
   * ================================================================== */
  let s4Ticket = null;
  await check('S4-01 结算后记录钱包/claims/ledgers 快照', async () => {
    const cleared = await resetScenario('S4');
    s4Ticket = await createTicket(COMMISSION.towerT1);
    await openTicketRun(s4Ticket, 'tower');
    await startTowerRun();
    await towerDropFloors(4);
    const settled = await towerFinishViaBridge('won');
    assert(settled.result && settled.result.ok === true && settled.result.credits === TOWER_REWARD.credits, `S4 层塔结算异常: ${JSON.stringify(settled.result)}`);
    const snapshot = await careerSnapshot(s4Ticket.careerId, s4Ticket.ticketId);
    assert(snapshot.wallet && snapshot.wallet.credits === INITIAL_CREDITS + TOWER_REWARD.credits, `S4 钱包应为 80+${TOWER_REWARD.credits}: ${JSON.stringify(snapshot.wallet)}`);
    assert(Array.isArray(snapshot.claimsAll) && snapshot.claimsAll.length === 1, `claims 应为 1: ${snapshot.claimsAll && snapshot.claimsAll.length}`);
    assert(snapshot.counts && snapshot.counts.ledgers === 1 + settled.result.receipt.txIds.length, `ledger 总数异常: ${JSON.stringify(snapshot.counts)}`);
    evidence.snapshots.s4Baseline = snapshotData(snapshot);
    evidence.snapshots.s4BaselineHash = sha256(stable(snapshotData(snapshot)));
    assertNoConsoleErrors('S4-01');
    return `${cleared} · wallet=${INITIAL_CREDITS + TOWER_REWARD.credits} claims=1 leads=${snapshot.counts.ledgers} hash=${evidence.snapshots.s4BaselineHash.slice(0, 16)}`;
  });

  await check('S4-02 普通 reload：wallet/claims/ledgers 完全一致、commissionRun=null、console 0', async () => {
    await reloadPage();
    await waitFor(`!!window.__arcadeTest && !!window.__arcadeTest.careerInfo`, 9000);
    await sleep(120);
    const state = await page.evaluate(`({ run: window.__arcadeCareerTest.commissionRun(), ticket: sessionStorage.getItem(${q(TICKET_KEY)}) })`);
    assert(state.run === null && state.ticket === null, `reload 后不应复活: ${JSON.stringify(state)}`);
    const snapshot = await careerSnapshot(s4Ticket.careerId, s4Ticket.ticketId);
    assertSnapshotSame(evidence.snapshots.s4Baseline, snapshotData(snapshot), 'S4-02 reload');
    const errors = await assertNoConsoleErrors('S4-02');
    return `wallet/claims/ledgers unchanged · ${errors}`;
  });

  await check('S4-03 SW 注销+重注册：生涯数据零变化、正式 scope 恢复', async () => {
    const sw = await page.evaluate(`(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false, before: 0, after: 0 };
      const before = await navigator.serviceWorker.getRegistrations();
      for (const registration of before) await registration.unregister();
      let registration = null;
      try { registration = await navigator.serviceWorker.register('../sw.js'); } catch (err) { return { supported: true, before: before.length, error: String(err && err.message || err) }; }
      const ready = await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(() => resolve(null), 8000))]);
      return { supported: true, before: before.length, scope: registration ? registration.scope : null, active: ready ? !!ready.active : false };
    })()`);
    assert(sw.supported === true, '当前 Chrome 不支持 Service Worker');
    assert(!sw.error, `SW 重注册失败: ${JSON.stringify(sw)}`);
    let scopePath = '';
    try {
      scopePath = new URL(sw.scope).pathname;
    } catch (err) {
      scopePath = '';
    }
    assert(scopePath === '/apps/arcade/', `SW scope 异常: ${JSON.stringify(sw)}`);
    assert(sw.active === true, `SW 重注册后未 active: ${JSON.stringify(sw)}`);
    const snapshot = await careerSnapshot(s4Ticket.careerId, s4Ticket.ticketId);
    assertSnapshotSame(evidence.snapshots.s4Baseline, snapshotData(snapshot), 'S4-03 SW 重注册');
    return `before=${sw.before} scope=${sw.scope} active=${sw.active} · 数据不变`;
  });

  await check('S4-04 Page.reload(ignoreCache)：wallet/claims/ledgers 不变、无重复 ledger、console 0', async () => {
    await reloadPage({ ignoreCache: true });
    await waitFor(`!!window.__arcadeTest && !!window.__arcadeTest.careerInfo`, 9000);
    await sleep(120);
    const snapshot = await careerSnapshot(s4Ticket.careerId, s4Ticket.ticketId);
    assertSnapshotSame(evidence.snapshots.s4Baseline, snapshotData(snapshot), 'S4-04 ignoreCache reload');
    const runIds = (snapshot.ledgersAll || []).map((row) => row.txId);
    assert(new Set(runIds).size === runIds.length, `ledger 出现重复 txId: ${JSON.stringify(runIds)}`);
    const errors = await assertNoConsoleErrors('S4-04');
    return `wallet=150 claims=${snapshot.claimsAll.length} ledgers=${snapshot.ledgersAll.length} · ${errors}`;
  });

  await check('S4-05 直接重放 settle：duplicate 原收据、钱包/claims/ledgers 零增量', async () => {
    const before = snapshotData(await careerSnapshot(s4Ticket.careerId, s4Ticket.ticketId));
    const replay = await replaySettle(s4Ticket.ticketId);
    assert(replay.result && replay.result.ok === true && replay.result.duplicate === true, `重放 settle 应 duplicate: ${JSON.stringify(replay.result)}`);
    assert(replay.result.credits === TOWER_REWARD.credits, `重放收据金额应 ${TOWER_REWARD.credits}: ${JSON.stringify(replay.result)}`);
    const after = snapshotData(await careerSnapshot(s4Ticket.careerId, s4Ticket.ticketId));
    assertSnapshotSame(before, after, 'S4-05 重放 settle');
    assert(after.claims.length === 1, `claims 行数被复制: ${after.claims.length}`);
    const claimLedgers = (after.ledgers || []).filter((row) => row.runId === s4Ticket.ticketId);
    assert(claimLedgers.length >= 2, `本 run 领奖流水条数异常: ${claimLedgers.length}`);
    const errors = await assertNoConsoleErrors('S4-05');
    evidence.snapshots.s4AfterReplayHash = sha256(stable(after));
    return `duplicate=true claims=1 claimLedgers=${claimLedgers.length} hash=${evidence.snapshots.s4AfterReplayHash.slice(0, 16)} · ${errors}`;
  });

  /* ================================================================== *
   * S5 失败 / 放弃路线
   * ================================================================== */
  let s5Failed = null;
  let s5CareerId = null;
  await check('S5-01 只达 1 层 finish：{ok:false, reason:objective-not-met}、钱包 80、run failed、ticket 消费', async () => {
    const cleared = await resetScenario('S5');
    s5Failed = await createTicket(COMMISSION.towerT1);
    s5CareerId = s5Failed.careerId;
    await openTicketRun(s5Failed, 'tower');
    await startTowerRun();
    await towerDropFloors(1);
    const settled = await towerFinishViaBridge('lost');
    const result = settled.result;
    assert(result && result.ok === false, `目标未达成时 finish 不应成功: ${JSON.stringify(result)}`);
    assert(result.reason === 'objective-not-met', `失败原因应为 objective-not-met: ${JSON.stringify(result)}`);
    assert(result.observed === 1 && result.objective && result.objective.atLeast === 4, `失败观测值异常: ${JSON.stringify(result)}`);
    assert(/只做到 1 \/ 4/.test(result.message || ''), `失败文案应可归因: ${result.message}`);
    assert(settled.commissionRun === null && settled.ticket === null, `失败结算后 run/ticket 未消费: ${JSON.stringify(settled)}`);
    const snapshot = await careerSnapshot(s5Failed.careerId, s5Failed.ticketId);
    assert(snapshot.wallet && snapshot.wallet.credits === INITIAL_CREDITS, `失败不发奖，钱包应仍为 80: ${JSON.stringify(snapshot.wallet)}`);
    assert(snapshot.run && snapshot.run.status === 'failed', `run 状态应为 failed: ${snapshot.run && snapshot.run.status}`);
    assert(Array.isArray(snapshot.claimsAll) && snapshot.claimsAll.length === 0, `失败不应产生 claim: ${snapshot.claimsAll && snapshot.claimsAll.length}`);
    assert(snapshot.counts && snapshot.counts.ledgers === 1, `失败只应有初始 ledger: ${JSON.stringify(snapshot.counts)}`);
    evidence.snapshots.s5Failure = { result, wallet: snapshot.wallet.credits, runStatus: snapshot.run.status, claims: snapshot.claimsAll.length };
    const errors = await assertNoConsoleErrors('S5-01');
    return `${cleared} · reason=objective-not-met observed=1 wallet=80 run=failed · ${errors}`;
  });

  await check('S5-02 reload 不复活：commissionRun=null、run 仍 failed、钱包 80、claims 0', async () => {
    await reloadPage();
    await waitFor(`!!window.__arcadeTest && !!window.__arcadeTest.careerInfo`, 9000);
    await sleep(120);
    const state = await page.evaluate(`({ run: window.__arcadeCareerTest.commissionRun(), career: window.__arcadeTest.careerInfo(), ticket: sessionStorage.getItem(${q(TICKET_KEY)}) })`);
    assert(state.run === null && state.career.isCommission === false, `失败 run reload 后不应复活: ${JSON.stringify(state)}`);
    assert(state.ticket === null, `失败结算后 ticket 应为空: ${state.ticket}`);
    const snapshot = await careerSnapshot(s5CareerId, s5Failed.ticketId);
    assert(snapshot.run && snapshot.run.status === 'failed', `reload 后 run 应仍 failed: ${snapshot.run && snapshot.run.status}`);
    assert(snapshot.wallet && snapshot.wallet.credits === INITIAL_CREDITS, `reload 后钱包应仍 80: ${JSON.stringify(snapshot.wallet)}`);
    assert(snapshot.claimsAll.length === 0, 'reload 后不应出现 claim');
    const errors = await assertNoConsoleErrors('S5-02');
    return `run=null failed wallet=80 claims=0 · ${errors}`;
  });

  let s5Abandon = null;
  await check('S5-03 另建 ticket 走 abandon：ok/abandoned、不发奖、钱包不变、ticket 清空', async () => {
    s5Abandon = await createTicket(COMMISSION.towerT1);
    const before = await careerSnapshot(s5Abandon.careerId, s5Abandon.ticketId);
    const abandoned = await page.evaluate(`(async () => {
      const result = await window.ArcadeCareer.commission.abandon(${q(s5Abandon.ticketId)});
      const db = window.__arcadeCareerTest.db();
      return {
        result,
        run: await db.getRun(${q(s5Abandon.ticketId)}),
        ticket: (() => { try { return sessionStorage.getItem(${q(TICKET_KEY)}); } catch (err) { return null; } })()
      };
    })()`);
    assert(abandoned.result && abandoned.result.ok === true && abandoned.result.status === 'abandoned', `abandon 失败: ${JSON.stringify(abandoned.result)}`);
    assert(abandoned.run && abandoned.run.status === 'abandoned', `run 状态应为 abandoned: ${abandoned.run && abandoned.run.status}`);
    assert(abandoned.ticket === null, `abandon 后 ticket 应清空: ${abandoned.ticket}`);
    const after = await careerSnapshot(s5Abandon.careerId, s5Abandon.ticketId);
    assert(after.wallet && after.wallet.credits === before.wallet.credits, `abandon 不应改变钱包: ${JSON.stringify({ before: before.wallet, after: after.wallet })}`);
    assert(after.claimsAll.length === 0, `abandon 不应发 claim: ${after.claimsAll.length}`);
    assertSnapshotSame({ wallet: before.wallet, counts: before.counts, claims: before.claimsAll, ledgers: before.ledgersAll }, { wallet: after.wallet, counts: after.counts, claims: after.claimsAll, ledgers: after.ledgersAll }, 'S5-03 abandon');
    evidence.snapshots.s5Abandon = { status: abandoned.run.status, wallet: after.wallet.credits, claims: after.claimsAll.length };
    const errors = await assertNoConsoleErrors('S5-03');
    return `abandoned wallet=80 claims=0 · ${errors}`;
  });

  await check('S5-04 abandon 幂等：二次调用返回 duplicate、钱包/流水不变', async () => {
    const before = snapshotData(await careerSnapshot(s5Abandon.careerId, s5Abandon.ticketId));
    const again = await page.evaluate(`(async () => window.ArcadeCareer.commission.abandon(${q(s5Abandon.ticketId)}))()`);
    assert(again && again.ok === true && again.duplicate === true, `二次 abandon 应 duplicate: ${JSON.stringify(again)}`);
    const after = snapshotData(await careerSnapshot(s5Abandon.careerId, s5Abandon.ticketId));
    assertSnapshotSame(before, after, 'S5-04 abandon 幂等');
    const errors = await assertNoConsoleErrors('S5-04');
    return `duplicate=true status=${again.status} · ${errors}`;
  });

  /* ================================================================== *
   * S6 双游戏各自独立
   * ================================================================== */
  let s6tower = null;
  let s6star = null;
  let s6TowerSnapshot = null;
  await check('S6-01 同 career 先层塔：钱包按内容、C1.work_done、层塔 T2 解锁、装备为空', async () => {
    const cleared = await resetScenario('S6');
    s6tower = await createTicket(COMMISSION.towerT1);
    await openTicketRun(s6tower, 'tower');
    await startTowerRun();
    await towerDropFloors(4);
    const settled = await towerFinishViaBridge('won');
    assert(settled.result && settled.result.ok === true && settled.result.credits === TOWER_REWARD.credits, `层塔结算异常: ${JSON.stringify(settled.result)}`);
    const snapshot = await careerSnapshot(s6tower.careerId, s6tower.ticketId);
    s6TowerSnapshot = snapshot;
    const available = await listAvailable(s6tower.careerId);
    assert(snapshot.wallet && snapshot.wallet.credits === INITIAL_CREDITS + TOWER_REWARD.credits, `层塔后钱包异常: ${JSON.stringify(snapshot.wallet)}`);
    assert(stable(snapshot.wallet.items) === stable(TOWER_REWARD.items), `层塔后材料异常: ${JSON.stringify(snapshot.wallet.items)}`);
    assert(stable(snapshot.equipment && snapshot.equipment.equipment || {}) === stable({}), `层塔后装备应仍为空: ${JSON.stringify(snapshot.equipment)}`);
    const questRows = snapshot.quests && Array.isArray(snapshot.quests.quests) ? snapshot.quests.quests : [];
    const towerQuest = questRows.find((row) => row.nodeId === COMMISSION.towerT1);
    assert(towerQuest && Array.isArray(towerQuest.flags) && towerQuest.flags.includes('C1.work_done'), `quests 缺少层塔 C1.work_done: ${JSON.stringify(questRows)}`);
    assert(towerQuest.status === 'cleared', `层塔 quest 状态应为 cleared: ${JSON.stringify(towerQuest)}`);
    assert(available.ok === true, `listAvailable 失败: ${JSON.stringify(available)}`);
    assert(available.map[COMMISSION.towerT1] === true, `层塔 T1 应保持可接: ${JSON.stringify(available.map)}`);
    assert(available.map['pendulum-tower.T2'] === true, `层塔 T2 应在 C1.work_done 后解锁: ${JSON.stringify(available.map)}`);
    assert(available.map[COMMISSION.starT1] === true, `星海 T1 应可接: ${JSON.stringify(available.map)}`);
    assert(available.map['star-raid.T2'] === false, `星海 T2 未完成星海 T1 前不应解锁: ${JSON.stringify(available.map)}`);
    assert(snapshot.claimsAll.length === 1, `claims 应为 1: ${snapshot.claimsAll.length}`);
    evidence.snapshots.s6AfterTower = { available: available.map, quests: questRows, wallet: snapshot.wallet.credits, items: snapshot.wallet.items };
    return `${cleared} · wallet=${INITIAL_CREDITS + TOWER_REWARD.credits} unlocked=${JSON.stringify(available.map)} · ${await assertNoConsoleErrors('S6-01')}`;
  });

  await check('S6-02 同 career 再星海：钱包按内容累加、双 flag 保留、星海 T2 解锁、装备不被覆盖', async () => {
    s6star = await createTicket(COMMISSION.starT1);
    await openTicketRun(s6star, 'star');
    await startStarRun();
    await starKillBoss();
    const settled = await starSettleViaClearPanel();
    assert(settled.settled && settled.settled.ok === true && settled.settled.credits === STAR_REWARD.credits, `星海结算异常: ${JSON.stringify(settled.settled)}`);
    const snapshot = await careerSnapshot(s6star.careerId, s6star.ticketId);
    const available = await listAvailable(s6star.careerId);
    assert(snapshot.wallet && snapshot.wallet.credits === INITIAL_CREDITS + TOWER_REWARD.credits + STAR_REWARD.credits, `两单后钱包异常: ${JSON.stringify(snapshot.wallet)}`);
    assert(stable(snapshot.wallet.items) === stable(Object.assign({}, TOWER_REWARD.items, STAR_REWARD.items)), `两单后材料异常: ${JSON.stringify(snapshot.wallet.items)}`);
    assert(stable(snapshot.equipment && snapshot.equipment.equipment || {}) === stable({}), `星海结算覆盖了装备: ${JSON.stringify(snapshot.equipment)}`);
    const questRows = snapshot.quests && Array.isArray(snapshot.quests.quests) ? snapshot.quests.quests : [];
    const towerQuest = questRows.find((row) => row.nodeId === COMMISSION.towerT1);
    const starQuest = questRows.find((row) => row.nodeId === COMMISSION.starT1);
    assert(towerQuest && Array.isArray(towerQuest.flags) && towerQuest.flags.includes('C1.work_done'), `层塔 C1.work_done 被星海覆盖: ${JSON.stringify(questRows)}`);
    assert(starQuest && Array.isArray(starQuest.flags) && starQuest.flags.includes('C1.flight_done'), `星海 C1.flight_done 未落库: ${JSON.stringify(questRows)}`);
    assert(available.map['star-raid.T2'] === true, `星海 T2 应在 C1.flight_done 后解锁: ${JSON.stringify(available.map)}`);
    assert(available.map['pendulum-tower.T2'] === true, `层塔 T2 不应被星海覆盖: ${JSON.stringify(available.map)}`);
    assert(available.map[COMMISSION.starT1] === true, `星海 T1 应保持可接: ${JSON.stringify(available.map)}`);
    assert(snapshot.claimsAll.length === 2, `两单后 claims 应为 2: ${snapshot.claimsAll.length}`);
    const commissions = new Set(snapshot.claimsAll.map((row) => row.commissionId));
    assert(commissions.has(COMMISSION.towerT1) && commissions.has(COMMISSION.starT1), `claims 未按游戏独立记录: ${JSON.stringify([...commissions])}`);
    /* 旧记录互不覆盖：层塔 claim 行仍完整、钱包是累加而非重置、装备仍为空。 */
    const towerClaim = snapshot.claimsAll.find((row) => row.commissionId === COMMISSION.towerT1);
    assert(towerClaim && towerClaim.credits === TOWER_REWARD.credits && Array.isArray(towerClaim.txIds) && towerClaim.txIds.length >= 2, `层塔 claim 行被星海结算破坏: ${JSON.stringify(towerClaim)}`);
    const starLedgers = (snapshot.ledgersAll || []).filter((row) => row.runId === s6star.ticketId).length;
    assert(snapshot.counts && snapshot.counts.ledgers === 1 + towerClaim.txIds.length + starLedgers, `两单后 ledger 总数异常: ${JSON.stringify(snapshot.counts)}`);
    assert(s6TowerSnapshot.wallet && s6TowerSnapshot.wallet.credits === INITIAL_CREDITS + TOWER_REWARD.credits, 'S6-01 钱包基线异常');
    assert(snapshot.wallet.credits === s6TowerSnapshot.wallet.credits + STAR_REWARD.credits, `钱包应累加而非重置: ${snapshot.wallet.credits} vs ${s6TowerSnapshot.wallet.credits}+${STAR_REWARD.credits}`);
    evidence.snapshots.s6AfterStar = { available: available.map, quests: questRows, wallet: snapshot.wallet.credits, items: snapshot.wallet.items, claims: snapshot.claimsAll.length, ledgers: snapshot.counts.ledgers };
    return `wallet=${snapshot.wallet.credits} claims=2 ledgers=${snapshot.counts.ledgers} unlocked=${JSON.stringify(available.map)} · ${await assertNoConsoleErrors('S6-02')}`;
  });

  await check('S6-03 两游戏 ticket 不串：层塔 ticket 打开星海页 fail-open 经典、不激活职业 run', async () => {
    const cross = await createTicket(COMMISSION.towerT1);
    page.errors = [];
    await page.navigate(ticketUrlFor(cross, 'star'));
    await waitBridgeReady();
    await waitFor(`!!window.__arcadeTest && !!window.__arcadeTest.careerInfo`, 9000);
    await sleep(250);
    const state = await page.evaluate(`({
      run: window.__arcadeCareerTest.commissionRun(),
      career: window.__arcadeTest.careerInfo(),
      bodyClass: document.body.classList.contains('is-career-run'),
      hangarEntryVisible: !document.querySelector('[data-ov-btn3]').hidden,
      challengeEntryVisible: !document.querySelector('[data-ov-btn2]').hidden,
      overlayTitle: document.querySelector('[data-ov-title]').textContent,
      missionCount: document.querySelectorAll('.career-mission-line').length,
      ticket: sessionStorage.getItem(${q(TICKET_KEY)})
    })`);
    assert(state.run === null, `层塔 ticket 不应在星海页激活: ${JSON.stringify(state.run)}`);
    assert(state.career.isCommission === false, `星海页不应进入职业模式: ${JSON.stringify(state.career)}`);
    assert(state.bodyClass === false && state.missionCount === 0, `星海页出现职业 UI: ${JSON.stringify(state)}`);
    assert(state.hangarEntryVisible === true && state.challengeEntryVisible === true, `经典入口被隐藏: ${JSON.stringify(state)}`);
    assert(state.overlayTitle === '星海突击', `星海页应保持经典开始弹层: ${state.overlayTitle}`);
    const errors = await assertNoConsoleErrors('S6-03');
    evidence.snapshots.crossTicket = { activated: state.run !== null, overlayTitle: state.overlayTitle, hangarEntryVisible: state.hangarEntryVisible, sessionTicketRetained: state.ticket !== null };
    const snapshotBefore = await careerSnapshot(s6star.careerId, s6star.ticketId);
    const abandonCross = await page.evaluate(`(async () => {
      let career = window.ArcadeCareer;
      if (!career.commission) { career.openTown(); for (let i = 0; i < 120 && !career.commission; i += 1) await new Promise((r) => setTimeout(r, 50)); try { if (window.ArcadeCareerUI && ArcadeCareerUI.town) ArcadeCareerUI.town.close(); } catch (err) {} }
      const result = career.commission ? await career.commission.abandon(${q(cross.ticketId)}) : { ok: false, reason: 'commission-unavailable' };
      const db = window.__arcadeCareerTest.db();
      return { result, run: await db.getRun(${q(cross.ticketId)}), wallet: await db.readWallet(${q(cross.careerId)}) };
    })()`);
    assert(abandonCross.result && abandonCross.result.ok === true, `跨游戏 ticket 清理失败: ${JSON.stringify(abandonCross.result)}`);
    assert(abandonCross.run && abandonCross.run.status === 'abandoned', `跨游戏 ticket run 状态异常: ${JSON.stringify(abandonCross.run)}`);
    assert(abandonCross.wallet && abandonCross.wallet.credits === INITIAL_CREDITS + TOWER_REWARD.credits + STAR_REWARD.credits, `跨游戏 ticket 清理不应发钱: ${JSON.stringify(abandonCross.wallet)}`);
    const snapshotAfter = await careerSnapshot(s6star.careerId, s6star.ticketId);
    assertSnapshotSame(snapshotData(snapshotBefore), snapshotData(snapshotAfter), 'S6-03 跨游戏 ticket abandon');
    await screenshot('D16-11-cross-ticket-failopen.png');
    return `fail-open 经典（title=${state.overlayTitle} hangar=${state.hangarEntryVisible}）· 钱包仍 240 · ${errors}`;
  });

  await check('S6-04 双游戏独立场景 console error=0、无重复 ledger', async () => {
    const snapshot = await careerSnapshot(s6star.careerId, s6star.ticketId);
    const txIds = (snapshot.ledgersAll || []).map((row) => row.txId);
    assert(new Set(txIds).size === txIds.length, `双游戏 ledger txId 重复: ${JSON.stringify(txIds)}`);
    const errors = await assertNoConsoleErrors('S6-04');
    return `ledgers=${txIds.length} unique=${new Set(txIds).size} · ${errors}`;
  });

  /* ================================================================== *
   * S7 清理
   * ================================================================== */
  await check('S7-01 测试结束 deleteDatabase：生涯 DB 不存在、ticket 清空', async () => {
    await goto(`${base}/apps/arcade/index.html`);
    const result = await page.evaluate(`(async () => {
      try { sessionStorage.clear(); } catch (err) {}
      const deleted = await new Promise((resolve) => {
        let done = false;
        const finish = (value) => { if (!done) { done = true; resolve(value); } };
        try {
          const request = indexedDB.deleteDatabase(${q(DB_NAME)});
          request.onsuccess = () => finish({ ok: true });
          request.onerror = () => finish({ ok: false, error: 'delete-error' });
          request.onblocked = () => finish({ ok: false, error: 'delete-blocked' });
        } catch (err) {
          finish({ ok: false, error: String(err && err.message || err) });
        }
        setTimeout(() => finish({ ok: false, error: 'delete-timeout' }), 2500);
      });
      if ('serviceWorker' in navigator) {
        try { const regs = await navigator.serviceWorker.getRegistrations(); for (const reg of regs) await reg.unregister(); } catch (err) {}
      }
      const databases = indexedDB.databases ? (await indexedDB.databases()).map((entry) => entry.name) : [];
      let ticket = null;
      try { ticket = sessionStorage.getItem(${q(TICKET_KEY)}); } catch (err) {}
      return { deleted, databases, ticket };
    })()`);
    assert(result.deleted && result.deleted.ok, `deleteDatabase 失败: ${JSON.stringify(result.deleted)}`);
    assert(!result.databases.includes(DB_NAME), `生涯 DB 仍存在: ${JSON.stringify(result.databases)}`);
    assert(result.ticket === null, `ticket 未清空: ${result.ticket}`);
    return `databases=${JSON.stringify(result.databases)} ticket=null`;
  });

  await check('S7-02 全部场景 console error=0（网络噪声单独分类说明）', async () => {
    return assertNoConsoleErrors('S7-02');
  });
}

function writeEvidenceFiles() {
  try {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const summary = rec.results;
    const failed = summary.filter((row) => !row.ok);
    evidence.summary = {
      total: summary.length,
      passed: summary.length - failed.length,
      failed: failed.length,
      exitCode: failed.length > 0 || summary.length === 0 ? 1 : 0,
    };
    evidence.checks = summary.map((row) => ({ name: row.name, ok: row.ok, detail: row.detail }));
    const log = logLines.join('\n');
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'D16-11-test-output.log'), `${log}\n\n${failed.map((row) => 'FAILED: ' + row.name + ' — ' + row.detail).join('\n')}\n`, 'utf8');
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'D16-11-data.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
    return true;
  } catch (err) {
    console.error('WARN 无法写入证据文件：' + (err && err.message ? err.message : err));
    return false;
  }
}

async function cleanup() {
  try {
    if (page) page.close();
  } catch (err) {
    /* ignore */
  }
  try {
    if (launched) await stopChrome({ chrome: launched.chrome, profile: launched.profile });
  } catch (err) {
    /* ignore */
  }
  try {
    if (server) await server.close();
  } catch (err) {
    /* ignore */
  }
}

async function main() {
  try {
    server = await startServer({ root: REPO_ROOT, port: SERVER_PORT });
    launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'studiokit-d1611-' });
    page = await openPage({ port: CDP_PORT, width: 390, height: 844, artifactsDir: ARTIFACTS_DIR, url: 'about:blank' });
  } catch (err) {
    console.error('FAIL  装配失败（EXIT 2）：' + (err && err.stack ? err.stack : err));
    await cleanup();
    process.exit(2);
  }

  try {
    await run();
  } catch (err) {
    console.error('\nFATAL ' + (err && err.stack ? err.stack : err));
    rec.record('FATAL 测试执行异常', false, String(err && err.message || err).slice(0, 900));
  } finally {
    const summary = rec.summary('checks');
    writeEvidenceFiles();
    await cleanup();
    let exitCode = summary.failed > 0 || summary.total === 0 ? 1 : 0;
    setTimeout(() => process.exit(exitCode), 120);
  }
}

main().catch((err) => {
  console.error('FATAL ' + (err && err.stack ? err.stack : err));
  process.exit(2);
});
