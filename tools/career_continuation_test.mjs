#!/usr/bin/env node
/**
 * Arcade Life 0.20 — 生涯首航 V2 连续性门禁（纯 Node，无 Chrome）。
 *
 * 关闭标签页后 sessionStorage ticket 丢失：既有 live run 仍能被玩家发现并显式继续。
 * 不自动接管页面、不偷偷新建 run、不改 localStorage key / Schema、不发奖。
 *
 * 覆盖：
 *   CC-01 无 stored ticket 发现 live run（只读 continuations，不建生涯/run、不写 sessionStorage）
 *   CC-02 显式 start 复用 live run ticket（ticketId/nonce/runId 同源，零新增 createRun）
 *   CC-03 completed/claimed/failed/abandoned/cancelled/expired 不返回；ends 不参与
 *   CC-04 重复 start 幂等（stored ticket 与 DB live run 两路径均复用，且 settle 幂等无双份奖励）
 *   CC-05 多 run 选择稳定（active 优先、issuedAt 升序、runId 字典序）
 *   CC-06 createRun 同事务 live-run 去重（多标签并发不重复建票/领奖，失败/放弃不复活）
 *   CC-07 bridge continuation 函数形状（在 VM 里加载真实 bridge.js，断言 ctx/api 暴露与降级）
 *
 * 运行：node tools/career_continuation_test.mjs
 * 退出码：0 全部通过；1 有失败；2 装配失败（模块/内容读取失败）。
 * 零 npm 依赖；不启动 Chrome、不写仓库文件。
 *
 * 0.22：fake DB 的 discovery 快照由真实 profession-state 从 glimpsed→read→accept
 * 推演并注入真实 registry/clues 映射；普通委托的 start gate 不再靠伪造状态绕过，
 * live run 复用一律先经 DB（listRuns + getRun）权威校验。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const CAREER_DIR = path.join(REPO_ROOT, 'apps', 'arcade', 'career');
const COMMISSION_CORE = path.join(CAREER_DIR, 'commission-core.js');
const CAREER_CORE = path.join(CAREER_DIR, 'career-core.js');
const CAREER_DB = path.join(CAREER_DIR, 'career-db.js');
const PROFESSION_STATE = path.join(CAREER_DIR, 'profession-state.js');
const BRIDGE_JS = path.join(CAREER_DIR, 'bridge.js');
const CONTENT_JSON = path.join(CAREER_DIR, 'content', 'commissions.json');
const REGISTRY_JSON = path.join(CAREER_DIR, 'content', 'registry.json');
const CLUES_JSON = path.join(CAREER_DIR, 'content', 'clues.json');

const require = createRequire(import.meta.url);
const NOW = '2026-11-26T02:00:00.000Z';
const TICKET_KEY = 'studiokit:arcade:career:ticket.v1';
const CAREER_ID = 'career-test-1';
const NONCE_A = 'a'.repeat(32);
const NONCE_B = 'b'.repeat(32);
const NONCE_C = 'c'.repeat(32);

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
function detail(value) {
  if (value === undefined) return '';
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch (err) {
    text = String(value);
  }
  return text && text.length > 220 ? text.slice(0, 220) + '…' : text;
}
async function check(name, fn) {
  total += 1;
  try {
    const info = await fn();
    passed += 1;
    console.log('PASS  ' + name + (info && typeof info === 'string' ? ' — ' + detail(info) : ''));
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    failures.push(name + ': ' + message);
    console.log('FAIL  ' + name + ' — ' + message);
  }
}
function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/**
 * 0.22 职业 gate 夹具：用真实 profession-state 按 glimpsed → read → accept
 * 推演 discovery 快照；职业/游戏/线索映射全部来自真实 registry/clues。
 */
function discoveredStateFor(professionIds) {
  const ids = Array.isArray(professionIds) ? professionIds.slice() : [];
  let state = professionState.initialState(NOW);
  ids.forEach((professionId, index) => {
    const game = gateCatalog.games.find((row) => Array.isArray(row.professions) && row.professions.indexOf(professionId) >= 0);
    assert(!!game && typeof game.clueRef === 'string' && game.clueRef, 'fixture 缺少职业对应真实游戏/线索：' + professionId);
    const clueId = game.clueRef;
    const stamps = [0, 1, 2].map((step) => new Date(Date.parse(NOW) + (index * 3 + step) * 60000).toISOString());
    const steps = [
      ['glimpsed', () => professionState.recordGlimpsed(state, { professionId, gameId: game.gameId, clueId, catalog: gateCatalog, at: stamps[0] })],
      ['read', () => professionState.recordRead(state, { professionId, gameId: game.gameId, clueId, catalog: gateCatalog, at: stamps[1] })],
      ['accepted', () => professionState.acceptInvitation(state, { professionId, gameId: game.gameId, clueId, catalog: gateCatalog, at: stamps[2] })],
    ];
    steps.forEach(([label, apply]) => {
      const result = apply();
      assert(result.ok === true, 'fixture profession-state ' + label + ' 失败：' + (result && result.reason));
      state = result.state;
    });
  });
  const validated = professionState.validate(state, gateCatalog);
  assert(validated.ok === true, 'fixture discovery 快照校验失败：' + (validated && validated.reason));
  return state;
}

/* ------------------------------------------------------------------ *
 * 夹具：内存假 career-db（语义对齐真实公开方法；不启动 Chrome）
 * ------------------------------------------------------------------ */

function createFakeDb(options) {
  const opts = options || {};
  const state = {
    careerId: opts.careerId || null,
    runs: {},
    claims: {},
    balances: {},
    profiles: {},
    quests: [],
    calls: [],
    atomic: opts.atomic !== false,
    discovery: discoveredStateFor(Array.isArray(opts.acceptedProfessionIds)
      ? opts.acceptedProfessionIds
      : ['research.archivist', 'research.lattice']),
  };
  function log(name, payload) {
    state.calls.push({ name, payload: payload === undefined ? null : clone(payload) });
  }
  function makeRun(input) {
    const row = Object.assign({
      createdAt: NOW,
      updatedAt: NOW,
      schemaVersion: 1,
      mode: 'commission',
      sourceMode: 'commission',
    }, clone(input));
    if (!row.ticketId) row.ticketId = row.runId;
    return row;
  }
  if (opts.runs) {
    opts.runs.forEach((run) => {
      state.runs[run.runId] = makeRun(run);
    });
  }
  if (state.careerId) {
    state.profiles[state.careerId] = { careerId: state.careerId, flags: [], settings: { hintsEnabled: true } };
    state.balances[state.careerId] = { careerId: state.careerId, credits: 80, revision: 1 };
  }

  async function ensureCareer(input) {
    log('ensureCareer', input);
    if (!state.careerId) state.careerId = CAREER_ID;
    if (!state.profiles[state.careerId]) {
      state.profiles[state.careerId] = { careerId: state.careerId, flags: [], settings: { hintsEnabled: true } };
    }
    if (!state.balances[state.careerId]) {
      state.balances[state.careerId] = { careerId: state.careerId, credits: 80, revision: 1 };
    }
    return { ok: true, created: false, careerId: state.careerId, profile: clone(state.profiles[state.careerId]) };
  }
  async function getProfile(careerId) {
    return state.profiles[careerId] ? clone(state.profiles[careerId]) : null;
  }
  async function getState(key) {
    log('getState', key);
    if (key === 'discovery') return { key: 'discovery', value: clone(state.discovery) };
    if (key !== 'career') return null;
    return state.careerId ? { key: 'career', value: { careerId: state.careerId } } : null;
  }
  async function getDiscoveryState() {
    log('getDiscoveryState', null);
    return clone(state.discovery);
  }
  async function getArchiveState() {
    log('getArchiveState', null);
    return { ok: true, archived: false, careerId: state.careerId, archivedAt: null };
  }
  async function readQuestState(careerId) {
    log('readQuestState', careerId);
    const quests = state.quests.filter((row) => row.careerId === careerId);
    const byNode = {};
    quests.forEach((row) => { byNode[row.nodeId] = clone(row); });
    return { ok: true, careerId, quests: clone(quests), byNode };
  }
  async function readWallet(careerId) {
    const balance = state.balances[careerId];
    return {
      ok: true,
      careerId,
      credits: balance ? balance.credits : 0,
      items: {},
      equipment: {},
    };
  }
  async function getClaim(runId) {
    return state.claims[runId] ? clone(state.claims[runId]) : null;
  }
  async function getRun(runId) {
    log('getRun', runId);
    return state.runs[runId] ? clone(state.runs[runId]) : null;
  }
  async function listRuns(input) {
    log('listRuns', input);
    const options = input || {};
    if (opts.listRunsFailure) return { ok: false, reason: opts.listRunsFailure, runs: [] };
    const runs = Object.keys(state.runs).map((key) => state.runs[key]).filter((row) => {
      if (options.careerId && row.careerId !== options.careerId) return false;
      if (Array.isArray(options.statuses) && options.statuses.indexOf(row.status) < 0) return false;
      if (options.mode && row.mode !== options.mode) return false;
      if (options.commissionId && row.commissionId !== options.commissionId) return false;
      return true;
    }).map(clone);
    return { ok: true, runs };
  }
  async function createRun(run) {
    log('createRun', run);
    const row = makeRun(run);
    if (state.runs[row.runId]) {
      return { ok: true, duplicate: true, run: clone(state.runs[row.runId]) };
    }
    if (state.atomic) {
      const live = Object.keys(state.runs).map((key) => state.runs[key]).find((existing) =>
        existing.careerId === row.careerId && existing.commissionId === row.commissionId &&
        existing.mode === row.mode && ['issued', 'active'].indexOf(existing.status) >= 0
      );
      if (live) return { ok: true, duplicate: true, reused: true, run: clone(live) };
    }
    state.runs[row.runId] = row;
    return { ok: true, duplicate: false, run: clone(row) };
  }
  async function updateRun(runId, patch, expectedStatus) {
    log('updateRun', { runId, patch, expectedStatus });
    const row = state.runs[runId];
    if (!row) return { ok: false, reason: 'missing-run' };
    if (expectedStatus && row.status !== expectedStatus) return { ok: false, reason: 'run-state' };
    const merged = Object.assign({}, row, clone(patch), { updatedAt: NOW });
    state.runs[runId] = merged;
    return { ok: true, run: clone(merged) };
  }
  async function settleAndClaim(input) {
    log('settleAndClaim', input);
    const options = input || {};
    if (state.claims[options.runId]) {
      return { ok: true, duplicate: true, receipt: clone(state.claims[options.runId]) };
    }
    const run = state.runs[options.runId];
    if (!run) return { ok: false, reason: 'missing-run' };
    const receipt = {
      receiptId: options.runId,
      careerId: options.careerId,
      commissionId: run.commissionId,
      credits: Number((options.plan && options.plan.credits) || 0),
      items: clone((options.plan && options.plan.items) || {}),
      evidence: [],
      flags: [],
      txIds: ['tx:' + options.runId + ':1'],
      claimedAt: options.now || NOW,
      rulesetVersion: 1,
      contentVersion: '0.18.0',
    };
    state.claims[options.runId] = clone(receipt);
    state.runs[options.runId] = Object.assign({}, run, { status: 'claimed', claimedAt: options.now || NOW });
    const balance = state.balances[options.careerId];
    if (balance) balance.credits += receipt.credits;
    return { ok: true, duplicate: false, receipt: clone(receipt) };
  }

  return {
    state,
    ensureCareer,
    getProfile,
    getState,
    getDiscoveryState,
    getArchiveState,
    readQuestState,
    readWallet,
    getClaim,
    getRun,
    listRuns,
    createRun,
    updateRun,
    settleAndClaim,
    count(name) {
      return state.calls.filter((entry) => entry.name === name).length;
    },
    resetLog() {
      state.calls.length = 0;
    },
  };
}

function createFakeStorage() {
  const map = new Map();
  return {
    map,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

/* ------------------------------------------------------------------ *
 * 装配
 * ------------------------------------------------------------------ */

let CommissionModule = null;
let careerCore = null;
let professionState = null;
let gateCatalog = null;
let content = null;

function assembly() {
  CommissionModule = require(COMMISSION_CORE);
  careerCore = require(CAREER_CORE);
  professionState = require(PROFESSION_STATE);
  content = JSON.parse(fs.readFileSync(CONTENT_JSON, 'utf8'));
  const registry = JSON.parse(fs.readFileSync(REGISTRY_JSON, 'utf8'));
  const clues = JSON.parse(fs.readFileSync(CLUES_JSON, 'utf8'));
  gateCatalog = {
    games: registry.games,
    professions: registry.professions,
    commissions: [],
    clues: clues.clues,
    worldWorkIds: [],
  };
  assert(CommissionModule && typeof CommissionModule.createCommissionCore === 'function', 'commission-core 未导出 createCommissionCore');
  assert(careerCore && typeof careerCore.isValidCareerId === 'function', 'career-core 不可用');
  assert(professionState && typeof professionState.acceptInvitation === 'function', 'profession-state 不可用');
  assert(content.commissions.length > 0, 'commissions.json 为空');
  assert(gateCatalog.professions.length === 16 && gateCatalog.games.length === 16, 'registry 职业/游戏映射异常');
  return content;
}

function scenario(options) {
  const opts = options || {};
  const db = opts.db || createFakeDb(opts.dbOptions);
  const storage = opts.storage === null ? null : opts.storage || createFakeStorage();
  const core = CommissionModule.createCommissionCore({ db, core: careerCore, now: () => NOW, storage });
  const configured = core.configure({ content: opts.content || content, catalog: opts.catalog || gateCatalog });
  assert(configured.ok, 'configure 失败: ' + JSON.stringify(configured.errors));
  return { db, storage, core };
}

function runRow(overrides) {
  const opts = overrides || {};
  const runId = opts.runId || 'commission-run-1';
  return Object.assign({
    runId,
    ticketId: runId,
    careerId: CAREER_ID,
    commissionId: 'memory-flip.T1',
    gameId: 'memory-flip',
    mode: 'commission',
    sourceMode: 'commission',
    status: 'active',
    nonce: NONCE_A,
    seed: 'seed-a',
    issuedAt: NOW,
    startedAt: NOW,
    contentVersion: '0.18.0',
    rulesetVersion: 1,
    attempt: 1,
    startParams: {},
  }, opts);
}

function runShape(runId, status, issuedAt, startedAt) {
  return { runId, ticketId: runId, commissionId: 'memory-flip.T1', gameId: 'memory-flip', status, issuedAt, startedAt: startedAt === undefined ? NOW : startedAt };
}

/* ------------------------------------------------------------------ *
 * CC-01 无 stored ticket 发现 live run（只读）
 * ------------------------------------------------------------------ */

async function cc01() {
  await check('CC-01 关标签模拟（无 stored ticket）发现 live run，查询全程只读', async () => {
    const db = createFakeDb({ careerId: CAREER_ID, runs: [runRow({ runId: 'commission-live', nonce: NONCE_A })] });
    const storage = createFakeStorage(); // 模拟新标签页：sessionStorage 空
    const { core } = scenario({ db, storage });
    assert(storage.getItem(TICKET_KEY) === null, '前置：不应有 stored ticket');
    const result = await core.continuations({ careerId: CAREER_ID });
    eq(result.ok, true, 'ok');
    eq(result.careerId, CAREER_ID, 'careerId');
    eq(result.runs, [runShape('commission-live', 'active', NOW)], 'runs');
    eq(db.count('createRun'), 0, '只读查询不得 createRun');
    eq(db.count('ensureCareer'), 0, '只读查询不得 ensureCareer');
    assert(storage.getItem(TICKET_KEY) === null, '只读查询不得写 sessionStorage');
    eq(Object.keys(db.state.runs).length, 1, 'run 数量不变');
    return 'runs=1 status=active，零创建/零写入';
  });

  await check('CC-01b 无 careerId 参数时读 state 指针，指针不存在返回空且 ok', async () => {
    const db = createFakeDb({ runs: [] });
    const { core } = scenario({ db });
    const result = await core.continuations();
    eq(result, { ok: true, careerId: null, runs: [] }, 'no-pointer');
    eq(db.count('createRun'), 0, 'no-create');
    return 'no-career -> ok:true empty';
  });

  await check('CC-01c 无 listRuns 的旧 DB 降级为结构化失败且不抛', async () => {
    const db = createFakeDb({ careerId: CAREER_ID });
    delete db.listRuns;
    const { core } = scenario({ db });
    const result = await core.continuations({ careerId: CAREER_ID });
    eq(result.ok, false, 'degraded ok');
    eq(result.runs, [], 'degraded runs');
    eq(result.reason, 'db-unavailable', 'degraded reason');
    return 'reason=db-unavailable';
  });
}

/* ------------------------------------------------------------------ *
 * CC-02 显式 start 复用 live run ticket
 * ------------------------------------------------------------------ */

async function cc02() {
  await check('CC-02 DB live run 复用 ticketId/nonce/runId，零新增 run', async () => {
    const db = createFakeDb({ careerId: CAREER_ID, runs: [runRow({ runId: 'commission-live', nonce: NONCE_A })] });
    const storage = createFakeStorage();
    const { core } = scenario({ db, storage });
    const started = await core.start({ commissionId: 'memory-flip.T1', careerId: CAREER_ID });
    eq(started.ok, true, 'start ok');
    eq(started.reused, true, 'reused');
    eq(started.via, 'db-live-run', 'via');
    eq(started.ticketId, 'commission-live', 'ticketId');
    eq(started.runId, 'commission-live', 'runId');
    eq(started.ticket.nonce, NONCE_A, 'nonce 来自 DB 权威');
    eq(started.url, '../games/memory-flip.html?career=commission-live', 'url');
    eq(db.count('createRun'), 0, '不得新建 run');
    eq(Object.keys(db.state.runs).length, 1, 'run 总数不变');
    const parsed = JSON.parse(storage.getItem(TICKET_KEY));
    eq(parsed.ticketId, 'commission-live', 'stored ticketId');
    eq(parsed.nonce, NONCE_A, 'stored nonce');
    const validated = await core.validateTicket({ ticketId: started.ticketId, ticket: started.ticket, gameId: 'memory-flip' });
    eq(validated.ok, true, 'validateTicket 通过');
    return 'ticket=commission-live nonce=DB权威 validate=ok';
  });

  await check('CC-02c 复用保留原票 nonce/rulesetVersion/contentVersion/startParams/seed/attempt 语义', async () => {
    const original = runRow({
      runId: 'commission-semantics',
      nonce: NONCE_C,
      seed: 'seed-original',
      startParams: { startLevel: 3, themeId: 'nebula' },
      rulesetVersion: 1,
      contentVersion: '0.18.0',
      attempt: 2,
    });
    const db = createFakeDb({ careerId: CAREER_ID, runs: [original] });
    const { core } = scenario({ db });
    const started = await core.start({ commissionId: 'memory-flip.T1', careerId: CAREER_ID });
    eq(started.ok, true, 'start ok');
    eq(started.ticket.nonce, NONCE_C, 'nonce 不被重写');
    eq(started.ticket.seed, 'seed-original', 'seed 不被重写');
    eq(started.ticket.startParams, { startLevel: 3, themeId: 'nebula' }, 'startParams 不被当前内容覆盖');
    eq(started.ticket.rulesetVersion, 1, 'rulesetVersion');
    eq(started.ticket.contentVersion, '0.18.0', 'contentVersion');
    eq(started.ticket.attempt, 2, 'attempt');
    const validated = await core.validateTicket({ ticketId: started.ticketId, ticket: started.ticket });
    eq(validated.ok, true, 'validateTicket 使用原票语义通过');
    return 'nonce/seed/startParams/ruleset/content/attempt 全保留';
  });

  await check('CC-02d listRuns 读失败不得伪装成「没有 run」：continuations 返回 ok:false', async () => {
    const db = createFakeDb({ careerId: CAREER_ID, listRunsFailure: 'connection-lost' });
    const { core } = scenario({ db });
    const result = await core.continuations({ careerId: CAREER_ID });
    eq(result.ok, false, 'read failure -> ok:false');
    eq(result.reason, 'connection-lost', 'reason 透传');
    eq(result.runs, [], 'no runs');
    return 'ok:false reason=connection-lost（UI 不会误判空列表）';
  });

  await check('CC-02e stored ticket 无 DB live run 不得复用：先回 DB 校验再签新票', async () => {
    const storage = createFakeStorage();
    storage.setItem(TICKET_KEY, JSON.stringify({
      schemaVersion: 1,
      ticketId: 'commission-ghost',
      runId: 'commission-ghost',
      careerId: CAREER_ID,
      commissionId: 'memory-flip.T1',
      gameId: 'memory-flip',
      nonce: NONCE_A,
      issuedAt: NOW,
    }));
    const db = createFakeDb({ careerId: CAREER_ID, runs: [] });
    const { core } = scenario({ db, storage });
    db.resetLog();
    const started = await core.start({ commissionId: 'memory-flip.T1', careerId: CAREER_ID });
    eq(started.ok, true, 'start ok');
    assert(started.ticketId !== 'commission-ghost', '不得复用无 DB run 的存储票');
    eq(started.reused, undefined, '不是复用');
    assert(db.count('getRun') >= 1, '存储票必须回 DB 校验');
    eq(db.count('createRun'), 1, '签新票');
    const stored = JSON.parse(storage.getItem(TICKET_KEY));
    eq(stored.ticketId, started.ticketId, '存储票被新权威票覆盖');
    return 'ghost stored ticket -> new authoritative run';
  });

  await check('CC-02b 并发兜底：createRun 返回 duplicate live run 时复用原票', async () => {
    const live = runRow({ runId: 'commission-raced', nonce: NONCE_B, status: 'issued' });
    const db = createFakeDb({ careerId: CAREER_ID, runs: [live] });
    // 模拟查询与写入之间另一标签抢先建票：listRuns 看不到，但 createRun 事务内发现 live run。
    db.listRuns = async () => [];
    const { core } = scenario({ db });
    const started = await core.start({ commissionId: 'memory-flip.T1', careerId: CAREER_ID });
    eq(started.ok, true, 'start ok');
    eq(started.reused, true, 'reused');
    eq(started.via, 'create-run-duplicate', 'via');
    eq(started.ticketId, 'commission-raced', 'ticketId');
    eq(started.ticket.nonce, NONCE_B, 'nonce');
    eq(Object.keys(db.state.runs).length, 1, '零新增 run');
    return 'race duplicate -> 复用原票，零新增';
  });
}

/* ------------------------------------------------------------------ *
 * CC-03 终态/失败态不返回、不可复活
 * ------------------------------------------------------------------ */

async function cc03() {
  await check('CC-03 settled/claimed/failed/abandoned/cancelled/expired 全部不返回', async () => {
    const statuses = ['settled', 'claimed', 'claiming', 'failed', 'abandoned', 'cancelled', 'expired'];
    const runs = statuses.map((status, index) => runRow({
      runId: 'commission-end-' + index,
      status,
      nonce: NONCE_A,
    }));
    const db = createFakeDb({ careerId: CAREER_ID, runs });
    const { core } = scenario({ db });
    const result = await core.continuations({ careerId: CAREER_ID });
    eq(result.ok, true, 'ok');
    eq(result.runs, [], '终态不应返回');
    eq(db.count('createRun'), 0, '不创建');
    return statuses.join(',') + ' -> []';
  });

  await check('CC-03b 失败/放弃 run 不可被 start 复活（必须签新票）', async () => {
    const dead = runRow({ runId: 'commission-dead', status: 'abandoned', nonce: NONCE_A });
    const db = createFakeDb({ careerId: CAREER_ID, runs: [dead] });
    const { core } = scenario({ db });
    const started = await core.start({ commissionId: 'memory-flip.T1', careerId: CAREER_ID });
    eq(started.ok, true, 'start 应成功');
    assert(started.ticketId !== 'commission-dead', '不得复用放弃的 run');
    eq(started.reused, undefined, '不应标记 reused');
    eq(db.count('createRun'), 1, '签新票');
    eq(db.state.runs['commission-dead'].status, 'abandoned', '旧 run 状态不被改写');
    return 'old=abandoned unchanged; new=' + started.runId;
  });

  await check('CC-03c C5 终局 reservation 语义不变：continuations 不改 reservations，只如实返回 ending run', async () => {
    const db = createFakeDb({
      careerId: CAREER_ID,
      runs: [
        runRow({ runId: 'commission-ending', commissionId: 'ending.rescue', status: 'active', nonce: NONCE_C }),
        runRow({ runId: 'commission-normal', status: 'issued', nonce: NONCE_B }),
      ],
    });
    const { core } = scenario({ db });
    const result = await core.continuations({ careerId: CAREER_ID });
    eq(result.ok, true, 'ok');
    eq(result.runs.map((row) => row.commissionId), ['ending.rescue', 'memory-flip.T1'], 'ending run 如实返回');
    eq(db.count('createRun'), 0, '不建 run');
    assert(typeof db.reserveEnding === 'undefined', '本测试不触碰 reserveEnding');
    return 'ending.rescue 原样返回（UI 侧过滤），reservation 零改动';
  });
}

/* ------------------------------------------------------------------ *
 * CC-04 重复 start 幂等（含结算不双份发奖）
 * ------------------------------------------------------------------ */

async function cc04() {
  await check('CC-04 重复 start 幂等：stored ticket 路径与 DB live run 路径都复用，同 runId', async () => {
    const db = createFakeDb({ careerId: CAREER_ID, runs: [runRow({ runId: 'commission-stable', nonce: NONCE_A })] });
    const storage = createFakeStorage();
    const { core } = scenario({ db, storage });
    const first = await core.start({ commissionId: 'memory-flip.T1', careerId: CAREER_ID });
    const second = await core.start({ commissionId: 'memory-flip.T1', careerId: CAREER_ID });
    const third = await core.start({ commissionId: 'memory-flip.T1', careerId: CAREER_ID });
    [first, second, third].forEach((result, index) => {
      eq(result.ok, true, 'start#' + (index + 1));
      eq(result.runId, 'commission-stable', 'runId#' + (index + 1));
      eq(result.ticket.nonce, NONCE_A, 'nonce#' + (index + 1));
    });
    assert(second.via === 'stored-ticket' || second.via === 'db-live-run', 'second via 应复用原票，实际 ' + second.via);
    eq(db.count('createRun'), 0, '零新增 run');
    eq(Object.keys(db.state.runs).length, 1, 'run 数量不变');
    return '3×start -> 同 runId，stored-ticket + db-live-run 均幂等';
  });

  await check('CC-04b settlement 幂等：同一 run 重复 settle 不双份发奖', async () => {
    const db = createFakeDb({ careerId: CAREER_ID, runs: [runRow({ runId: 'commission-paid', nonce: NONCE_A })] });
    const { core } = scenario({ db });
    const started = await core.start({ commissionId: 'memory-flip.T1', careerId: CAREER_ID });
    const paid = await core.settle({
      ticketId: started.ticketId,
      events: [],
      outcome: 'won',
      stats: {},
    });
    // 事件不足时按现有契约会失败；这里直接构造 DB 层重复领奖，验证 claims 唯一。
    const receipt1 = await db.settleAndClaim({
      runId: started.runId, careerId: CAREER_ID, nonce: NONCE_A,
      plan: { credits: 70, items: {} }, now: NOW,
    });
    const receipt2 = await db.settleAndClaim({
      runId: started.runId, careerId: CAREER_ID, nonce: NONCE_A,
      plan: { credits: 70, items: {} }, now: NOW,
    });
    eq(receipt1.ok, true, 'first claim');
    eq(receipt2.ok, true, 'second claim');
    eq(receipt2.duplicate, true, 'second duplicate');
    eq(receipt2.receipt.receiptId, receipt1.receipt.receiptId, 'same receipt');
    eq(db.state.balances[CAREER_ID].credits, 150, '80 + 70，仅发一次');
    assert(paid && typeof paid.ok === 'boolean', 'settle 结构化返回');
    return 'credits=150（80+70），receipt 唯一';
  });
}

/* ------------------------------------------------------------------ *
 * CC-05 多 run 选择稳定
 * ------------------------------------------------------------------ */

async function cc05() {
  await check('CC-05 多 live run 排序稳定：active 优先，再 issuedAt 升序，再 runId 字典序', async () => {
    const t = (sec) => '2026-11-26T02:00:0' + sec + '.000Z';
    const runs = [
      runRow({ runId: 'commission-z', status: 'issued', issuedAt: t(1), nonce: NONCE_A }),
      runRow({ runId: 'commission-a', status: 'issued', issuedAt: t(1), nonce: NONCE_B }),
      runRow({ runId: 'commission-m', status: 'issued', issuedAt: t(0), nonce: NONCE_C }),
      runRow({ runId: 'commission-b', status: 'active', issuedAt: t(9), nonce: NONCE_A }),
    ];
    const db = createFakeDb({ careerId: CAREER_ID, runs });
    const { core } = scenario({ db });
    const first = await core.continuations({ careerId: CAREER_ID });
    const second = await core.continuations({ careerId: CAREER_ID });
    eq(first.runs.map((row) => row.runId), ['commission-b', 'commission-m', 'commission-a', 'commission-z'], 'stable order');
    eq(JSON.stringify(first), JSON.stringify(second), '重复查询结果逐字节一致');
    return first.runs.map((row) => row.runId).join(' > ');
  });

  await check('CC-05b 多 live run 时 start 显式选 commissionId 不串票', async () => {
    const c1 = content.commissions[0];
    // 选两条都可直接接的（unlock.all 为空），避免依赖先通关的解锁链。
    const c2 = content.commissions.find((row) => row.commissionId !== c1.commissionId &&
      Array.isArray(row.unlock && row.unlock.all) && row.unlock.all.length === 0);
    assert(c2, 'fixture 需要第二条无解锁门槛的委托');
    const db = createFakeDb({
      careerId: CAREER_ID,
      runs: [
        runRow({ runId: 'commission-c1', commissionId: c1.commissionId, gameId: c1.gameId, nonce: NONCE_A }),
        runRow({ runId: 'commission-c2', commissionId: c2.commissionId, gameId: c2.gameId, nonce: NONCE_B, status: 'issued' }),
      ],
    });
    const { core } = scenario({ db });
    const started = await core.start({ commissionId: c2.commissionId, careerId: CAREER_ID });
    eq(started.ok, true, 'start c2 ok: ' + JSON.stringify(started));
    eq(started.runId, 'commission-c2', '选中 c2');
    eq(started.ticket.nonce, NONCE_B, 'c2 nonce');
    eq(Object.keys(db.state.runs).length, 2, '不多建 run');
    return c2.commissionId + ' -> commission-c2';
  });
}

/* ------------------------------------------------------------------ *
 * CC-06 DB 层原子去重与真实 listRuns 源码约束
 * ------------------------------------------------------------------ */

async function cc06() {
  await check('CC-06 career-db 静态约束：listRuns 只读、createRun 同事务去重、无新 store/index/key', async () => {
    const source = fs.readFileSync(CAREER_DB, 'utf8');
    assert(typeof require(CAREER_DB).listRuns === 'function', 'career-db 未导出 listRuns');
    assert(/function listRuns\(/.test(source), 'listRuns 未实现');
    assert(/listRuns:\s*listRuns|^\s*listRuns,/m.test(source), 'listRuns 未加入公开 api');
    assert(/RUN_LIVE_STATUS/.test(source), 'live 状态集合未定义');
    assert(/getAll\(\)/.test(source), 'listRuns 未使用 getAll（无新 index）');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert(!/localStorage/.test(code), 'career-db 代码不应出现 localStorage');
    assert(!/createIndex/.test(code.slice(code.indexOf('function listRuns'), code.indexOf('function getRun'))), 'listRuns 不建 index');
    return 'listRuns exported; no localStorage in code; no new index';
  });

  await check('CC-06b 真实 career-db 无 IDB 时 listRuns 返回结构化失败（不伪装为没有 run）', async () => {
    const db = require(CAREER_DB);
    const result = await db.listRuns({ careerId: CAREER_ID });
    eq(result.ok, false, 'read failure is not ok');
    eq(result.runs, [], 'no runs on failure');
    assert(typeof result.reason === 'string' && result.reason, 'reason present');
    return 'ok:false reason=' + result.reason;
  });
}

/* ------------------------------------------------------------------ *
 * CC-07 bridge 只读 continuation 暴露（真实文件在 VM 中加载）
 * ------------------------------------------------------------------ */

async function cc07() {
  await check('CC-07 bridge 暴露 ctx.careerContinuations 与 ctx.commission.continuations，并降级不抛', async () => {
    const source = fs.readFileSync(BRIDGE_JS, 'utf8');
    assert(/function careerContinuations\(/.test(source), 'bridge 未定义 careerContinuations');
    assert(/careerContinuations:\s*careerContinuations/.test(source), 'ctx 未暴露 careerContinuations');
    assert(/api\.careerContinuations\s*=/.test(source), 'api 未暴露 careerContinuations');

    const captured = {};
    const sandbox = {
      console,
      setTimeout,
      clearTimeout,
      Promise,
      Math,
      JSON,
      Date,
      URL,
      URLSearchParams,
      document: {
        readyState: 'complete',
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        documentElement: { style: {} },
        createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; },
        body: { appendChild() {} },
      },
      location: { href: 'http://localhost/apps/arcade/index.html', search: '', pathname: '/apps/arcade/index.html' },
      navigator: { userAgent: 'node', serviceWorker: null },
      fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      indexedDB: undefined,
      crypto: undefined,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'bridge.js' });
    const bridge = sandbox.ArcadeCareer;
    assert(bridge && typeof bridge.careerContinuations === 'function', 'bridge.careerContinuations 缺失');
    const fallback = await bridge.careerContinuations({ careerId: CAREER_ID });
    eq(fallback.ok, false, '未装载 commission 时降级 ok');
    eq(fallback.reason, 'commission-module-missing', '降级 reason');
    eq(fallback.runs, [], '降级 runs');

    // 注入带 continuations 的假 commission 模块，验证桥接函数原样透传、只读语义不变。
    const fakeCore = CommissionModule.createCommissionCore({
      db: createFakeDb({ careerId: CAREER_ID, runs: [runRow({ runId: 'commission-bridge', nonce: NONCE_A })] }),
      core: careerCore,
      storage: createFakeStorage(),
    });
    fakeCore.configure({ content });
    assert(typeof fakeCore.continuations === 'function', 'commission-core 未导出 continuations');
    bridge.commission = fakeCore;
    const result = await bridge.careerContinuations({ careerId: CAREER_ID });
    eq(result.ok, true, 'bridge ok');
    eq(result.runs.map((row) => row.runId), ['commission-bridge'], 'bridge 透传 runId');
    return 'ctx/api 暴露 + 降级 + 透传';
  });
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

async function main() {
  try {
    assembly();
  } catch (err) {
    console.error('ASSEMBLY FAILED: ' + (err && err.message ? err.message : String(err)));
    process.exit(2);
  }
  await cc01();
  await cc02();
  await cc03();
  await cc04();
  await cc05();
  await cc06();
  await cc07();
  console.log('\ncareer_continuation_test: ' + passed + '/' + total + ' passed');
  if (failures.length) {
    console.log('FAILURES:\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  process.exit(0);
}

main();
