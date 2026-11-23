#!/usr/bin/env node
/**
 * Arcade Life 0.18 三终局汇合门禁（D18-09）：
 * ending-reducer 的「三份 ending 转 commission 行」「C4 后三选一」「启动占用/幂等」
 * 「结算后一次性写 C5+ending.* 旗标」「重复结算零增量」「失败/放弃不写 C5」
 * 「与 96 告示板隔离」「三终局经济等价」「后日常三差异」「坏内容/DB 失败结构化」
 * 「只读推导」「确定性」「静态边界」。
 *
 * 纯 Node：读仓库真实内容
 *   apps/arcade/career/content/{ending-combat,ending-research,ending-rescue,campaign,commissions}.json，
 * require 真实 career-core / registry / commission-core / ending-reducer；
 * DB 用内存假实现（语义对齐 career-db 的公开方法：readQuestState/putQuests/getClaim/
 * readLedger/getRun/getProfile/settleAndClaim...），另有一个「假 commission」用于
 * 结算收据守卫（economy-violation / receipt-missing-flag）。
 * ticket 存储用内存假 sessionStorage。
 *
 * 零 npm 依赖；不启动 Chrome、不写仓库文件。
 * 运行：node tools/career_ending_reducer_test.mjs
 * 退出码：0 全部通过；1 有失败；2 装配失败（模块/内容读取失败）。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);

const PATHS = {
  endingReducer: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'ending-reducer.js'),
  commissionCore: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'commission-core.js'),
  careerCore: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'career-core.js'),
  registry: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'registry.js'),
  endingCombat: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'ending-combat.json'),
  endingResearch: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'ending-research.json'),
  endingRescue: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'ending-rescue.json'),
  campaign: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'campaign.json'),
  commissions: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'commissions.json'),
};

const NOW = '2026-11-23T10:00:00.000Z';
const C4_FLAG = 'C4.city_power_restored';
const C5_FLAG = 'C5.star_tower_resolved';
const DEFAULT_FLAGS = ['C0.port_seen', 'C1.signal_fragment', 'C2.research_complete', 'C3.truth_found', C4_FLAG];
const APPROACH_ORDER = ['combat', 'research', 'rescue'];
const APPROACH_GAME = { combat: 'star-raid', research: 'merge-2048', rescue: 'road-rush' };
const ENDING_EVENTS = {
  combat: [{ kind: 'boss.defeated', payload: { theme: 'mothership' } }],
  research: [{ kind: 'tile.created', payload: { value: 520 } }],
  rescue: [{ kind: 'distance.reached', payload: { meters: 5200 } }],
};

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
  return text && text.length > 200 ? text.slice(0, 200) + '…' : text;
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

function sorted(values) {
  return Array.from(new Set(values.map((item) => String(item)))).sort();
}

/* ------------------------------------------------------------------ *
 * 夹具：内存假 career-db（对齐真实公开方法语义）
 * ------------------------------------------------------------------ */

function createFakeStorage() {
  const map = new Map();
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

const FAILURE_KEYS = [
  'ensureCareer',
  'readQuestState',
  'putQuests',
  'createRun',
  'getRun',
  'updateRun',
  'settleAndClaim',
  'getClaim',
  'getProfile',
  'readLedger',
];
const THROW_KEYS = ['readQuestState', 'putQuests', 'createRun', 'getRun', 'updateRun', 'settleAndClaim', 'getProfile', 'readLedger'];

function createFakeDb(options) {
  const opts = options || {};
  const state = {
    careerId: null,
    profiles: {},
    balances: {},
    inventory: {},
    quests: [],
    runs: {},
    claims: {},
    ledgers: [],
    calls: [],
    failures: {},
    throws: {},
    initialFlags: Array.isArray(opts.initialFlags) ? opts.initialFlags.slice() : DEFAULT_FLAGS.slice(),
    initialCredits: typeof opts.initialCredits === 'number' ? opts.initialCredits : 80,
  };
  FAILURE_KEYS.forEach((key) => {
    state.failures[key] = Number(opts.failures && opts.failures[key]) || 0;
  });
  THROW_KEYS.forEach((key) => {
    state.throws[key] = !!(opts.throws && opts.throws[key]);
  });

  function log(name, payload) {
    state.calls.push({ name, payload: payload === undefined ? null : clone(payload) });
  }

  function failure(reason) {
    return { ok: false, reason, error: reason };
  }

  function consumeFailure(name) {
    if (!state.failures[name]) return false;
    state.failures[name] -= 1;
    return true;
  }

  async function ensureCareer(input) {
    log('ensureCareer', input);
    if (consumeFailure('ensureCareer')) return failure('injected-ensure-career');
    if (state.careerId) {
      return {
        ok: true,
        created: false,
        careerId: state.careerId,
        profile: clone(state.profiles[state.careerId]),
        balance: clone(state.balances[state.careerId]),
      };
    }
    const careerId = 'career-d18-09';
    state.careerId = careerId;
    state.profiles[careerId] = {
      careerId,
      schemaVersion: 1,
      rulesetVersion: 1,
      capabilities: [],
      flags: state.initialFlags.slice(),
      evidence: [],
      settings: { hintsEnabled: true },
    };
    state.balances[careerId] = { careerId, credits: state.initialCredits, revision: 1 };
    return {
      ok: true,
      created: true,
      careerId,
      profile: clone(state.profiles[careerId]),
      balance: clone(state.balances[careerId]),
    };
  }

  async function getProfile(careerId) {
    log('getProfile', careerId);
    if (state.throws.getProfile) throw new Error('injected-get-profile-throw');
    if (consumeFailure('getProfile')) throw new Error('injected-get-profile');
    return state.profiles[careerId] ? clone(state.profiles[careerId]) : null;
  }

  async function getState(key) {
    log('getState', key);
    if (key !== 'career') return null;
    if (!state.careerId) return null;
    return { key: 'career', careerId: state.careerId, originGameId: null, updatedAt: NOW };
  }

  async function readQuestState(careerId) {
    log('readQuestState', careerId);
    if (state.throws.readQuestState) throw new Error('injected-read-quests-throw');
    if (consumeFailure('readQuestState')) return failure('injected-read-quest-state');
    const quests = state.quests.filter((row) => row.careerId === careerId);
    const byNode = {};
    quests.forEach((row) => {
      byNode[row.nodeId] = clone(row);
    });
    return { ok: true, careerId, quests: clone(quests), byNode };
  }

  async function putQuests(careerId, quests) {
    log('putQuests', { careerId, quests });
    if (state.throws.putQuests) throw new Error('injected-put-quests-throw');
    if (consumeFailure('putQuests')) return failure('injected-put-quests');
    const list = Array.isArray(quests) ? quests : Object.keys(quests || {}).map((key) => quests[key]);
    list.forEach((row) => {
      if (!row || typeof row.nodeId !== 'string') return;
      state.quests = state.quests.filter((item) => !(item.careerId === careerId && item.nodeId === row.nodeId));
      state.quests.push(Object.assign({}, clone(row), { careerId, nodeId: row.nodeId }));
    });
    return { ok: true, count: list.length };
  }

  async function readWallet(careerId) {
    log('readWallet', careerId);
    const balance = state.balances[careerId];
    return {
      ok: true,
      careerId,
      exists: !!balance,
      credits: balance ? balance.credits : 0,
      revision: balance ? balance.revision : 0,
      items: clone(state.inventory[careerId] || {}),
      equipment: {},
    };
  }

  async function createRun(run) {
    log('createRun', run);
    if (state.throws.createRun) throw new Error('injected-create-run-throw');
    if (consumeFailure('createRun')) return failure('injected-create-run');
    if (!run || typeof run.runId !== 'string') return failure('bad-run');
    const existing = state.runs[run.runId];
    if (existing) {
      const same = existing.careerId === run.careerId && existing.nonce === run.nonce && existing.gameId === run.gameId;
      if (same) return { ok: true, duplicate: true, run: clone(existing) };
      return failure('conflict');
    }
    const row = Object.assign({}, clone(run), { createdAt: NOW, updatedAt: NOW, schemaVersion: 1 });
    state.runs[run.runId] = row;
    return { ok: true, duplicate: false, run: clone(row) };
  }

  async function getRun(runId) {
    log('getRun', runId);
    if (state.throws.getRun) throw new Error('injected-get-run-throw');
    if (consumeFailure('getRun')) return null;
    return state.runs[runId] ? clone(state.runs[runId]) : null;
  }

  async function updateRun(runId, patch) {
    log('updateRun', { runId, patch });
    if (state.throws.updateRun) throw new Error('injected-update-run-throw');
    if (consumeFailure('updateRun')) return failure('injected-update-run');
    const row = state.runs[runId];
    if (!row) return failure('missing-run');
    const merged = clone(row);
    Object.keys(patch || {}).forEach((key) => {
      if (key === 'runId' || key === 'careerId') return;
      const value = clone(patch[key]);
      if (value === undefined) delete merged[key];
      else merged[key] = value;
    });
    merged.updatedAt = NOW;
    state.runs[runId] = merged;
    return { ok: true, run: clone(merged) };
  }

  async function getClaim(runId) {
    log('getClaim', runId);
    if (state.throws.getClaim) throw new Error('injected-get-claim-throw');
    if (consumeFailure('getClaim')) return null;
    return state.claims[runId] ? clone(state.claims[runId]) : null;
  }

  async function readLedger(careerId, limit) {
    log('readLedger', { careerId, limit });
    if (state.throws.readLedger) throw new Error('injected-read-ledger-throw');
    if (consumeFailure('readLedger')) return failure('injected-read-ledger');
    const rows = state.ledgers.filter((row) => row && row.careerId === careerId);
    const capped = Number.isFinite(Number(limit)) && Number(limit) > 0 ? rows.slice(0, Math.floor(Number(limit))) : rows;
    return { ok: true, careerId, entries: clone(capped) };
  }

  async function settleAndClaim(input) {
    log('settleAndClaim', input);
    if (state.throws.settleAndClaim) throw new Error('injected-settle-claim-throw');
    if (consumeFailure('settleAndClaim')) return failure('injected-settle-claim');
    const options = input || {};
    if (typeof options.runId !== 'string') return failure('bad-run-id');
    if (typeof options.careerId !== 'string') return failure('bad-career-id');
    if (typeof options.nonce !== 'string' || !options.nonce) return failure('bad-nonce');
    if (state.claims[options.runId]) {
      return { ok: true, duplicate: true, receipt: clone(state.claims[options.runId]) };
    }
    const run = state.runs[options.runId];
    if (!run) return failure('missing-run');
    if (run.careerId !== options.careerId) return failure('career-mismatch');
    if (run.nonce !== options.nonce) return failure('nonce-mismatch');
    if (['abandoned', 'failed', 'cancelled', 'expired', 'claimed', 'draft'].indexOf(run.status) >= 0) {
      return failure('run-state');
    }
    if (run.mode && run.mode !== 'commission') return failure('mode-not-allowed');
    if (options.receipt && options.receipt.commissionId && run.commissionId && options.receipt.commissionId !== run.commissionId) {
      return failure('receipt-mismatch');
    }
    const balance = state.balances[options.careerId];
    if (!balance) return failure('no-wallet');
    const plan = options.plan || {};
    const credits = Math.max(0, Math.floor(Number(plan.credits) || 0));
    const items = {};
    Object.keys(plan.items || {}).forEach((itemId) => {
      const count = Math.floor(Number(plan.items[itemId]) || 0);
      if (count > 0) items[itemId] = count;
    });
    const evidence = Array.isArray(plan.evidence) ? plan.evidence.slice() : [];
    const flags = Array.isArray(plan.flags) ? plan.flags.slice() : [];
    const at = typeof options.now === 'string' && options.now ? options.now : NOW;
    const txIds = [];
    let step = 1;
    if (credits > 0) {
      const txId = 'tx:' + options.runId + ':' + step++;
      txIds.push(txId);
      state.ledgers.push({
        txId,
        careerId: options.careerId,
        runId: options.runId,
        step: step - 1,
        kind: 'credits',
        credits,
        items: {},
        evidence: [],
        flags: [],
        at,
      });
    }
    if (Object.keys(items).length) {
      const txId = 'tx:' + options.runId + ':' + step++;
      txIds.push(txId);
      state.ledgers.push({
        txId,
        careerId: options.careerId,
        runId: options.runId,
        step: step - 1,
        kind: 'items',
        credits: 0,
        items: clone(items),
        evidence: [],
        flags: [],
        at,
      });
    }
    if (flags.length || evidence.length) {
      const txId = 'tx:' + options.runId + ':' + step++;
      txIds.push(txId);
      state.ledgers.push({
        txId,
        careerId: options.careerId,
        runId: options.runId,
        step: step - 1,
        kind: flags.length ? 'flags' : 'evidence',
        credits: 0,
        items: {},
        evidence: evidence.slice(),
        flags: flags.slice(),
        at,
      });
    }
    const receipt = {
      receiptId: options.runId,
      careerId: options.careerId,
      commissionId: run.commissionId,
      credits,
      items,
      evidence,
      flags,
      txIds,
      claimedAt: at,
      rulesetVersion: 1,
      contentVersion: options.contentVersion || '0.18.0',
    };
    balance.credits += credits;
    balance.revision += 1;
    const inventory = state.inventory[options.careerId] || (state.inventory[options.careerId] = {});
    Object.keys(items).forEach((itemId) => {
      inventory[itemId] = (inventory[itemId] || 0) + items[itemId];
    });
    state.quests = state.quests.filter((row) => !(row.careerId === options.careerId && row.nodeId === run.commissionId));
    state.quests.push({
      careerId: options.careerId,
      nodeId: run.commissionId,
      kind: 'commission',
      status: 'cleared',
      evidence: evidence.slice(),
      flags: flags.slice(),
      clearedAt: at,
      updatedAt: at,
    });
    state.claims[options.runId] = clone(receipt);
    state.runs[options.runId] = Object.assign({}, state.runs[options.runId], {
      status: 'claimed',
      claimedAt: at,
      receiptId: options.runId,
      updatedAt: at,
    });
    return { ok: true, duplicate: false, receipt: clone(receipt) };
  }

  const db = {
    state,
    ensureCareer,
    getProfile,
    getState,
    readQuestState,
    putQuests,
    readWallet,
    createRun,
    getRun,
    updateRun,
    getClaim,
    readLedger,
    settleAndClaim,
    count(name) {
      return state.calls.filter((entry) => entry.name === name).length;
    },
    resetLog() {
      state.calls.length = 0;
    },
    setFailure(name, amount) {
      state.failures[name] = Number(amount) || 0;
    },
    setThrow(name, value) {
      state.throws[name] = value === true;
    },
    addQuest(row) {
      if (!row || typeof row.nodeId !== 'string') return null;
      const stored = Object.assign({}, clone(row), { careerId: state.careerId, nodeId: row.nodeId });
      state.quests = state.quests.filter((item) => !(item.careerId === state.careerId && item.nodeId === stored.nodeId));
      state.quests.push(stored);
      return stored;
    },
    addRun(run) {
      state.runs[run.runId] = Object.assign({}, clone(run), { createdAt: NOW, updatedAt: NOW, schemaVersion: 1 });
      return state.runs[run.runId];
    },
    quests() {
      return state.quests.filter((row) => row.careerId === state.careerId);
    },
    credits() {
      const balance = state.balances[state.careerId];
      return balance ? balance.credits : 0;
    },
    ledgerCount() {
      return state.ledgers.filter((row) => row.careerId === state.careerId).length;
    },
  };
  return db;
}

/* ------------------------------------------------------------------ *
 * 夹具：假 commission（只用于收据守卫：economy-violation / receipt-missing-flag）
 * ------------------------------------------------------------------ */

function createFakeCommission(options) {
  const opts = options || {};
  const state = {
    rows: [],
    receipt: opts.receipt || null,
    settleCalls: 0,
    startCalls: 0,
    configured: false,
  };
  function api() {
    return {
      state,
      configure(rows) {
        if (!Array.isArray(rows)) return { ok: false, errors: ['rows-not-array'], usable: false };
        state.rows = clone(rows);
        state.configured = true;
        return { ok: true, contentVersion: '0.18.0', count: state.rows.length, errors: [], warnings: [], usable: true };
      },
      getCommissions() {
        return clone(state.rows);
      },
      getCommission(commissionId) {
        const found = state.rows.find((row) => row.commissionId === commissionId);
        return found ? clone(found) : null;
      },
      start() {
        state.startCalls += 1;
        return { ok: true, ticketId: 'commission-fake-1', url: '../games/star-raid.html?career=commission-fake-1' };
      },
      settle() {
        state.settleCalls += 1;
        if (!state.receipt) return { ok: false, reason: 'missing-commission' };
        return { ok: true, duplicate: false, receipt: clone(state.receipt), flags: clone(state.receipt.flags) };
      },
      abandon() {
        return { ok: true, status: 'abandoned' };
      },
      getState() {
        return { ticketId: null, run: null, events: [], contentConfigured: state.configured };
      },
      reset() {
        state.rows = [];
        state.configured = false;
        return { ok: true };
      },
    };
  }
  const instance = api();
  instance.__state = state;
  return instance;
}

/* ------------------------------------------------------------------ *
 * 装配：真实内容与真实模块
 * ------------------------------------------------------------------ */

let EndingModule = null;
let CommissionModule = null;
let CareerCore = null;
let CAMPAIGN = null;
let ENDING_COMBAT = null;
let ENDING_RESEARCH = null;
let ENDING_RESCUE = null;
let COMMISSIONS = null;
let MODULE_SOURCE = null;

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assembly() {
  EndingModule = require(PATHS.endingReducer);
  CommissionModule = require(PATHS.commissionCore);
  CareerCore = require(PATHS.careerCore);
  CAMPAIGN = loadJson(PATHS.campaign);
  ENDING_COMBAT = loadJson(PATHS.endingCombat);
  ENDING_RESEARCH = loadJson(PATHS.endingResearch);
  ENDING_RESCUE = loadJson(PATHS.endingRescue);
  COMMISSIONS = loadJson(PATHS.commissions).commissions;
  MODULE_SOURCE = fs.readFileSync(PATHS.endingReducer, 'utf8');
  if (!EndingModule || typeof EndingModule.createEndingReducer !== 'function') throw new Error('ending-reducer 缺少 createEndingReducer');
  if (!CommissionModule || typeof CommissionModule.createCommissionCore !== 'function') throw new Error('commission-core 缺少 createCommissionCore');
  if (COMMISSIONS.length !== 96) throw new Error('commissions.json 不是 96 条：' + COMMISSIONS.length);
}

function defaultEndings() {
  return [clone(ENDING_COMBAT), clone(ENDING_RESEARCH), clone(ENDING_RESCUE)];
}

/** 标准场景：真实内容 + 假 db + 假 sessionStorage，career 已建（默认 C4 已完成）。 */
async function scenario(options) {
  const opts = options || {};
  const db = createFakeDb({
    initialFlags: opts.flags === undefined ? DEFAULT_FLAGS : opts.flags,
    initialCredits: opts.initialCredits,
    failures: opts.failures,
    throws: opts.throws,
  });
  const created = await db.ensureCareer({ originGameId: 'star-raid' });
  const careerId = created.careerId;
  if (Array.isArray(opts.quests)) opts.quests.forEach((row) => db.addQuest(row));
  const storage = createFakeStorage();
  const reducer = EndingModule.createEndingReducer({ db, storage, now: () => NOW });
  const config = reducer.configure({
    endings: opts.endings === undefined ? defaultEndings() : opts.endings,
    campaign: opts.campaign === undefined ? clone(CAMPAIGN) : opts.campaign,
    db,
  });
  return { db, storage, reducer, careerId, config };
}

function configuredResult(endings, campaign) {
  const reducer = EndingModule.createEndingReducer({ now: () => NOW });
  const config = reducer.configure({
    endings,
    campaign: campaign === undefined ? clone(CAMPAIGN) : campaign,
  });
  return { reducer, config };
}

function recordWin(reducer, ticketId, approach) {
  const commission = reducer.getCommission();
  const events = ENDING_EVENTS[approach] || [];
  return events.map((event, index) =>
    commission.recordEvent(ticketId, {
      kind: event.kind,
      payload: clone(event.payload),
      sourceMode: 'commission',
      seq: index + 1,
      at: NOW,
    })
  );
}

function questsOf(db) {
  return db.quests().map((row) => clone(row));
}

function c5RowsOf(db) {
  return db.quests().filter((row) => Array.isArray(row.flags) && row.flags.indexOf(C5_FLAG) >= 0);
}

function markerRowsOf(db, approach) {
  return db.quests().filter((row) => row.kind === 'ending' && row.nodeId === 'ending.' + approach && row.resolved === true);
}

async function resolveEnding(approach, options) {
  const s = await scenario(options);
  const started = await s.reducer.startEnding({ approach, careerId: s.careerId });
  eq(started.ok, true, 'start ' + approach);
  recordWin(s.reducer, started.ticketId, approach);
  const settled = await s.reducer.settleEnding({ ticketId: started.ticketId });
  eq(settled.ok, true, 'settle ' + approach);
  return { s, started, settled };
}

function stripComments(source) {
  return String(source).replace(/\/\*[\s\S]*?\*\//g, '');
}

/* ------------------------------------------------------------------ *
 * A. configure：三份 ending → commission 行
 * ------------------------------------------------------------------ */

async function groupConfigure() {
  await check('A1 真实三份 ending 转成 commission 行：configure ok、3 行、id/gameId 对应', async () => {
    const { reducer, config } = configuredResult(defaultEndings());
    eq(config.ok, true, 'configure ok');
    eq(config.count, 3, 'count');
    eq(config.errors, [], 'errors');
    eq(config.endings.map((item) => item.approach), APPROACH_ORDER, 'approach 顺序确定');
    eq(config.rows.length, 3, 'configure 返回 commission 行');
    eq(config.rows.map((row) => row.commissionId), ['ending.combat', 'ending.research', 'ending.rescue'], 'rows 顺序');
    eq(config.rows[0].reward.credits, 0, 'rows reward.credits');
    const rows = reducer.getCommission().getCommissions();
    eq(rows.length, 3, '实例行数');
    const byId = {};
    rows.forEach((row) => {
      byId[row.commissionId] = row;
    });
    eq(Object.keys(byId).sort(), ['ending.combat', 'ending.rescue', 'ending.research'], 'commissionId 集合');
    APPROACH_ORDER.forEach((approach) => {
      eq(byId['ending.' + approach].gameId, APPROACH_GAME[approach], approach + ' gameId');
      eq(byId['ending.' + approach].professionId, 'ending', approach + ' professionId');
      eq(byId['ending.' + approach].tier, 5, approach + ' tier');
    });
    return '3 endings → 3 rows';
  });

  await check('A2 ending 行经济字段：credits/items/evidence/objectiveBonus/repeatSalary 全为 0 或空', async () => {
    const { reducer } = configuredResult(defaultEndings());
    const rows = reducer.getCommission().getCommissions();
    rows.forEach((row) => {
      eq(row.reward.credits, 0, row.commissionId + ' credits');
      eq(row.reward.items, {}, row.commissionId + ' items');
      eq(row.reward.evidence, [], row.commissionId + ' evidence');
      eq(row.reward.flags.length, 2, row.commissionId + ' flags 数量');
      eq(row.reward.flags.slice().sort(), [C5_FLAG, row.commissionId].sort(), row.commissionId + ' flags');
      eq(row.objectiveBonus, 0, row.commissionId + ' objectiveBonus');
      eq(row.repeatSalaryCredits, 0, row.commissionId + ' repeatSalaryCredits');
    });
    return '零工钱';
  });

  await check('A3 unlock 固定 C4 旗标；objective/startParams 与 content 一致', async () => {
    const { reducer } = configuredResult(defaultEndings());
    const rows = reducer.getCommission().getCommissions();
    const byId = {};
    rows.forEach((row) => {
      byId[row.commissionId] = row;
    });
    rows.forEach((row) => {
      eq(row.unlock, { all: [{ chapterFlag: C4_FLAG }] }, row.commissionId + ' unlock');
    });
    eq(byId['ending.combat'].objective, { kind: 'boss.defeated', atLeast: 1, context: { theme: 'mothership' } }, 'combat objective');
    eq(byId['ending.combat'].startParams, { startLevel: 6, themeId: 'mothership' }, 'combat startParams');
    eq(byId['ending.research'].objective, { kind: 'tile.created', atLeast: 1, context: {}, minValue: { field: 'value', value: 512 } }, 'research objective');
    eq(byId['ending.rescue'].objective, { kind: 'distance.reached', atLeast: 1, context: {}, minValue: { field: 'meters', value: 5000 } }, 'rescue objective');
    return '目标/开始参数未改写';
  });

  await check('A4 campaign 后日谈：base 一致、三种 approach 文本来自 campaign 且互不相同', async () => {
    const { reducer } = configuredResult(defaultEndings());
    const texts = [];
    APPROACH_ORDER.forEach((approach) => {
      const epi = reducer.epilogueFor(approach);
      eq(epi.ok, true, approach + ' epilogue ok');
      eq(epi.base, CAMPAIGN.epilogue.base, approach + ' base');
      eq(epi.text, CAMPAIGN.epilogue[approach], approach + ' text');
      eq(epi.source, 'campaign', approach + ' source');
      texts.push(epi.text);
    });
    eq(sorted(texts).length, 3, '三份后日常互不相同');
    eq(reducer.epilogueFor('stealth').reason, 'unknown-approach', '未知 approach 结构化');
    return '3 种后日常';
  });

  await check('A5 坏内容全部结构化：缺一份/未知 approach/重复/坏 objective/坏 gameId/空内容', async () => {
    const bad1 = configuredResult([clone(ENDING_COMBAT), clone(ENDING_RESEARCH)]).config;
    eq(bad1.ok, false, '缺一份 ok=false');
    assert(bad1.errors.indexOf('ending-incomplete:rescue') >= 0, '缺 rescue 归因');

    const bad2 = configuredResult([clone(ENDING_COMBAT), clone(ENDING_RESEARCH), Object.assign(clone(ENDING_RESCUE), { approach: 'stealth' })]).config;
    eq(bad2.ok, false, '未知 approach ok=false');
    assert(bad2.errors.some((code) => code.indexOf('ending-approach-unknown:') === 0), '未知 approach 归因');

    const bad3 = configuredResult([clone(ENDING_COMBAT), clone(ENDING_COMBAT), clone(ENDING_RESEARCH)]).config;
    eq(bad3.ok, false, '重复 approach ok=false');
    assert(bad3.errors.indexOf('ending-approach-duplicate:combat') >= 0, '重复 approach 归因');

    const bad4 = configuredResult([clone(ENDING_COMBAT), Object.assign(clone(ENDING_RESEARCH), { objective: { kind: 'Bad Kind!' } }), clone(ENDING_RESCUE)]).config;
    eq(bad4.ok, false, '坏 objective ok=false');
    assert(bad4.errors.indexOf('ending-objective-invalid:research') >= 0, '坏 objective 归因');

    const bad5 = configuredResult([clone(ENDING_COMBAT), Object.assign(clone(ENDING_RESEARCH), { gameId: 'Merge-2048' }), clone(ENDING_RESCUE)]).config;
    eq(bad5.ok, false, '坏 gameId ok=false');
    assert(bad5.errors.indexOf('ending-game-invalid:research') >= 0, '坏 gameId 归因');

    const bad6 = configuredResult(null).config;
    eq(bad6.ok, false, '空 endings ok=false');
    assert(bad6.errors.indexOf('endings-missing') >= 0, '空 endings 归因');
    const bad7 = configuredResult(defaultEndings(), null).config;
    eq(bad7.ok, false, '缺 campaign ok=false');
    assert(bad7.errors.indexOf('campaign-missing') >= 0, '缺 campaign 归因');

    /* reconfigure 失败必须让旧内容失效（不能沿用上一次成功的 endings 继续可玩）。 */
    const reducer = EndingModule.createEndingReducer({});
    eq(reducer.configure({ endings: defaultEndings(), campaign: clone(CAMPAIGN) }).ok, true, '先成功 configure');
    eq(reducer.listEndings().ok, true, '旧内容可用');
    eq(reducer.configure(null).ok, false, 'reconfigure(null) 失败');
    eq(reducer.listEndings().ok, false, '旧内容失效');
    const blocked = await reducer.startEnding({ approach: 'combat', careerId: 'career-d18-09' });
    eq(blocked.ok, false, 'reconfigure 失败后不可启动');
    eq(blocked.reason, 'content-invalid', 'content-invalid');
    return '7 类坏内容 + 失效';
  });

  await check('A6 endings 输入形状：数组 / {endings:[...]} / 以 approach 为键的对象都能转行', async () => {
    const arrayConfig = configuredResult(defaultEndings()).config;
    eq(arrayConfig.ok, true, '数组');
    const wrapped = configuredResult({ endings: defaultEndings() }).config;
    eq(wrapped.ok, true, '{endings:[...]}');
    const keyed = configuredResult({
      combat: clone(ENDING_COMBAT),
      research: clone(ENDING_RESEARCH),
      rescue: clone(ENDING_RESCUE),
    }).config;
    eq(keyed.ok, true, 'keyed object');
    eq(keyed.endings.map((item) => item.approach), APPROACH_ORDER, 'keyed 顺序');
    return '3 种输入形状';
  });
}

/* ------------------------------------------------------------------ *
 * B. startEnding：C4 门禁 / 三选一 / 占用 / 幂等
 * ------------------------------------------------------------------ */

async function groupStart() {
  await check('B1 C4 前锁定：startEnding → locked，零 createRun', async () => {
    const s = await scenario({ flags: ['C0.port_seen'] });
    const result = await s.reducer.startEnding({ approach: 'combat', careerId: s.careerId });
    eq(result.ok, false, 'ok=false');
    eq(result.reason, 'locked', 'reason');
    eq(result.missingFlag, C4_FLAG, 'missingFlag');
    eq(s.db.count('createRun'), 0, '不建 run');
    const viaQuest = await scenario({
      flags: [],
      quests: [{ nodeId: 'story:' + C4_FLAG, kind: 'story-flag', status: 'cleared', flags: [C4_FLAG] }],
    });
    const questStart = await viaQuest.reducer.startEnding({ approach: 'combat', careerId: viaQuest.careerId });
    eq(questStart.ok, true, 'C4 写在 quest 行也可启动');
    return 'locked 且零写入';
  });

  await check('B2 C4 后三选一：三条终局都能各自启动，票价/URL/gameId 正确', async () => {
    const summaries = [];
    for (const approach of APPROACH_ORDER) {
      const s = await scenario();
      const result = await s.reducer.startEnding({ approach, careerId: s.careerId });
      eq(result.ok, true, approach + ' start ok');
      eq(result.approach, approach, approach + ' approach');
      eq(result.commissionId, 'ending.' + approach, approach + ' commissionId');
      eq(result.gameId, APPROACH_GAME[approach], approach + ' gameId');
      eq(result.careerId, s.careerId, approach + ' careerId');
      assert(typeof result.ticketId === 'string' && result.ticketId.length > 0, approach + ' ticketId');
      assert(result.url.indexOf('career=') > 0, approach + ' url 带 ticket');
      assert(result.url.indexOf('games/' + APPROACH_GAME[approach] + '.html') > 0, approach + ' url 指向对应游戏');
      eq(s.db.count('createRun'), 1, approach + ' createRun 1 次');
      const run = await s.db.getRun(result.ticketId);
      eq(run.commissionId, 'ending.' + approach, approach + ' run.commissionId');
      eq(run.gameId, APPROACH_GAME[approach], approach + ' run.gameId');
      eq(run.mode, 'commission', approach + ' run.mode');
      eq(run.status, 'issued', approach + ' run.status');
      eq(run.contentVersion, CommissionModule.CONTENT_VERSION, approach + ' run.contentVersion 不转发 0.18');
      summaries.push(result.title);
    }
    eq(sorted(summaries).length, 3, '三条终局标题互不相同');
    return 'combat/research/rescue 均可启动';
  });

  await check('B3 只允许一条主线：第二个 approach 返回 occupied，不再建 run', async () => {
    const s = await scenario();
    const first = await s.reducer.startEnding({ approach: 'combat', careerId: s.careerId });
    eq(first.ok, true, 'first');
    const second = await s.reducer.startEnding({ approach: 'research', careerId: s.careerId });
    eq(second.ok, false, 'second ok=false');
    eq(second.reason, 'occupied', 'reason');
    eq(second.activeApproach, 'combat', 'activeApproach');
    eq(second.ticketId, first.ticketId, 'active ticket');
    eq(s.db.count('createRun'), 1, '只有一次 createRun');
    return 'occupied';
  });

  await check('B4 同 approach 再次 startEnding：复用同一 ticket（DB 幂等）', async () => {
    const s = await scenario();
    const first = await s.reducer.startEnding({ approach: 'research', careerId: s.careerId });
    const second = await s.reducer.startEnding({ approach: 'research', careerId: s.careerId });
    eq(first.ok, true, 'first');
    eq(second.ok, true, 'second');
    eq(second.ticketId, first.ticketId, '同一 ticket');
    eq(second.reused, true, 'reused');
    eq(s.db.count('createRun'), 1, 'createRun 1 次');
    return 'ticket 复用';
  });

  await check('B5 已有 C5 旗标：startEnding → already-resolved，并给出已解决的 approach', async () => {
    const s = await scenario({
      quests: [
        {
          nodeId: 'ending.combat',
          kind: 'ending',
          status: 'cleared',
          approach: 'combat',
          resolved: true,
          flags: [C5_FLAG, 'ending.combat'],
        },
      ],
    });
    const result = await s.reducer.startEnding({ approach: 'research', careerId: s.careerId });
    eq(result.ok, false, 'ok=false');
    eq(result.reason, 'already-resolved', 'reason');
    eq(result.resolvedApproach, 'combat', 'resolvedApproach');
    eq(s.db.count('createRun'), 0, '不建 run');
    return 'already-resolved';
  });

  await check('B6 未知 approach / 非法 careerId / 无生涯：结构化失败且不抛', async () => {
    const s = await scenario();
    const unknown = await s.reducer.startEnding({ approach: 'stealth', careerId: s.careerId });
    eq(unknown.reason, 'unknown-approach', 'unknown-approach');
    eq(unknown.allowedApproaches, APPROACH_ORDER, 'allowedApproaches');
    const badCareer = await s.reducer.startEnding({ approach: 'combat', careerId: 'bad id!' });
    eq(badCareer.reason, 'bad-career-id', 'bad-career-id');
    const noCareerDb = createFakeDb({});
    const reducer = EndingModule.createEndingReducer({ db: noCareerDb, storage: createFakeStorage(), now: () => NOW });
    reducer.configure({ endings: defaultEndings(), campaign: clone(CAMPAIGN), db: noCareerDb });
    const noCareer = await reducer.startEnding({ approach: 'combat' });
    eq(noCareer.reason, 'no-career', 'no-career');
    return '3 类结构化失败';
  });

  await check('B7 DB 读取失败：readQuestState / getProfile 失败或抛异常都返回 db-read-failed', async () => {
    const failed = await scenario({ failures: { readQuestState: 1 } });
    const first = await failed.reducer.startEnding({ approach: 'combat', careerId: failed.careerId });
    eq(first.ok, false, 'ok=false');
    eq(first.reason, 'db-read-failed', 'reason');
    eq(failed.db.count('createRun'), 0, '不建 run');

    const throwing = await scenario({ throws: { readQuestState: true } });
    const second = await throwing.reducer.startEnding({ approach: 'combat', careerId: throwing.careerId });
    eq(second.reason, 'db-read-failed', '抛异常也结构化');

    const profileThrow = await scenario({ throws: { getProfile: true } });
    const third = await profileThrow.reducer.startEnding({ approach: 'combat', careerId: profileThrow.careerId });
    eq(third.reason, 'db-read-failed', 'getProfile 抛异常结构化');
    return 'db-read-failed';
  });
}

/* ------------------------------------------------------------------ *
 * C. settleEnding：一次性写 C5、幂等、失败/放弃、经济守门
 * ------------------------------------------------------------------ */

async function groupSettle() {
  await check('C1 成功结算：单次 putQuests 写 C5 旗标行 + ending.* 结局行，收据 0 信用点', async () => {
    const s = await scenario();
    const started = await s.reducer.startEnding({ approach: 'combat', careerId: s.careerId });
    eq(started.ok, true, 'start');
    recordWin(s.reducer, started.ticketId, 'combat');
    const settled = await s.reducer.settleEnding({ ticketId: started.ticketId });
    eq(settled.ok, true, 'settle ok');
    eq(settled.duplicate, false, 'duplicate=false');
    eq(settled.wrote, true, 'wrote=true');
    eq(settled.credits, 0, 'credits=0');
    eq(settled.flagsWritten, [C5_FLAG, 'ending.combat'], 'flagsWritten');
    eq(s.db.count('putQuests'), 1, 'putQuests 只调用 1 次（单事务）');
    const putCall = s.db.state.calls.filter((entry) => entry.name === 'putQuests').pop();
    eq(putCall.payload.quests.length, 2, '同一事务两行');
    eq(questsOf(s.db).length, 2, 'career 只有两行 quest');
    const story = s.db.quests().find((row) => row.nodeId === 'story:' + C5_FLAG);
    assert(!!story, 'C5 story 行存在');
    eq(story.kind, 'story-flag', 'story 行 kind');
    eq(story.flags, [C5_FLAG], 'story 行 flags');
    eq(story.flag, C5_FLAG, 'story 行 flag');
    const marker = s.db.quests().find((row) => row.nodeId === 'ending.combat');
    assert(!!marker, 'ending.combat 行存在');
    eq(marker.kind, 'ending', 'marker kind');
    eq(marker.resolved, true, 'marker resolved');
    eq(marker.approach, 'combat', 'marker approach');
    eq(marker.flags.slice().sort(), [C5_FLAG, 'ending.combat'].sort(), 'marker flags');
    const claim = await s.db.getClaim(started.ticketId);
    assert(!!claim, 'claim 已写');
    eq(claim.credits, 0, 'claim credits 0');
    eq(claim.flags.indexOf(C5_FLAG) >= 0, true, 'claim 带 C5 旗标');
    const ending = s.reducer.endingOf({ quests: questsOf(s.db), claims: [claim] });
    eq(ending.resolved, true, 'endingOf resolved');
    eq(ending.approach, 'combat', 'endingOf approach');
    eq(ending.source, 'ending', 'endingOf source=ending');
    eq(ending.epilogue.text, CAMPAIGN.epilogue.combat, '后日常文本');
    return 'C5+ending.combat 一次写入';
  });

  await check('C2 重复 settleEnding：返回原收据/duplicate，零新增奖励与零新增 quest 写入', async () => {
    const { s, started } = await resolveEnding('combat');
    const creditsBefore = s.db.credits();
    const ledgerBefore = s.db.ledgerCount();
    const claimsBefore = Object.keys(s.db.state.claims).length;
    const putQuestsBefore = s.db.count('putQuests');
    const questRowsBefore = questsOf(s.db).length;
    const again = await s.reducer.settleEnding({ ticketId: started.ticketId });
    eq(again.ok, true, 'ok');
    eq(again.duplicate, true, 'duplicate');
    eq(again.wrote, false, 'wrote=false');
    eq(again.flagsWritten, [], '不再写旗标');
    assert(!!again.receipt, '返回原收据');
    eq(again.receipt.receiptId, started.ticketId, '原收据 id');
    eq(s.db.count('putQuests'), putQuestsBefore, 'putQuests 次数不变');
    eq(s.db.credits(), creditsBefore, '钱包不变');
    eq(s.db.ledgerCount(), ledgerBefore, '流水不变');
    eq(Object.keys(s.db.state.claims).length, claimsBefore, 'claims 不变');
    eq(questsOf(s.db).length, questRowsBefore, 'quest 行不变');
    return 'duplicate 零增量';
  });

  await check('C3 游戏页先结算（真实主路径）：settleEnding 补写旗标且只写一次', async () => {
    const s = await scenario();
    const started = await s.reducer.startEnding({ approach: 'research', careerId: s.careerId });
    eq(started.ok, true, 'start');
    recordWin(s.reducer, started.ticketId, 'research');
    const gameSettle = await s.reducer.getCommission().settle({ ticketId: started.ticketId, outcome: 'won' });
    eq(gameSettle.ok, true, '游戏页结算成功');
    eq(gameSettle.credits, 0, '游戏页结算 0 信用点');
    eq(markerRowsOf(s.db, 'research').length, 0, '游戏页结算还没写结局记录');
    const result = await s.reducer.settleEnding({ ticketId: started.ticketId });
    eq(result.ok, true, 'settleEnding ok');
    eq(result.duplicate, true, 'settle 返回 duplicate');
    eq(result.wrote, true, '仍补写旗标');
    eq(s.db.count('putQuests'), 1, 'putQuests 1 次');
    eq(markerRowsOf(s.db, 'research').length, 1, '结局记录 1 行');
    const storyCount = s.db.quests().filter((row) => row.nodeId === 'story:' + C5_FLAG).length;
    eq(storyCount, 1, 'C5 旗标行 1 行');
    const again = await s.reducer.settleEnding({ ticketId: started.ticketId });
    eq(again.ok, true, 'again ok');
    eq(again.duplicate, true, 'again duplicate');
    eq(again.wrote, false, 'again wrote=false');
    eq(s.db.count('putQuests'), 1, 'putQuests 仍 1 次');
    return '游戏页结算 → 补写一次';
  });

  await check('C4 结算失败：不写 C5、run 标 failed、可重试成功', async () => {
    const s = await scenario();
    const started = await s.reducer.startEnding({ approach: 'rescue', careerId: s.careerId });
    eq(started.ok, true, 'start');
    const failed = await s.reducer.settleEnding({ ticketId: started.ticketId });
    eq(failed.ok, false, '失败 ok=false');
    eq(failed.reason, 'not-cleared', 'reason=not-cleared');
    eq(failed.runFailed, true, 'runFailed');
    eq(failed.retryable, true, 'retryable');
    eq(failed.flagWritten, false, 'flagWritten=false');
    eq(s.db.count('putQuests'), 0, '零 quest 写入');
    eq(c5RowsOf(s.db).length, 0, '零 C5');
    const run = await s.db.getRun(started.ticketId);
    eq(run.status, 'failed', 'run 标 failed');
    const ending = s.reducer.endingOf({ quests: questsOf(s.db) });
    eq(ending.resolved, false, '未通关');
    const restart = await s.reducer.startEnding({ approach: 'rescue', careerId: s.careerId });
    eq(restart.ok, true, '重试启动 ok');
    assert(restart.ticketId !== started.ticketId, '新 ticket');
    recordWin(s.reducer, restart.ticketId, 'rescue');
    const retried = await s.reducer.settleEnding({ ticketId: restart.ticketId });
    eq(retried.ok, true, '重试结算 ok');
    eq(retried.approach, 'rescue', 'rescue 结局');
    eq(s.reducer.endingOf({ quests: questsOf(s.db) }).approach, 'rescue', 'endingOf=rescue');
    return '失败可重试';
  });

  await check('C5 放弃：abandonEnding 不写 C5，重新开始仍可通关', async () => {
    const s = await scenario();
    const started = await s.reducer.startEnding({ approach: 'combat', careerId: s.careerId });
    eq(started.ok, true, 'start');
    const abandoned = await s.reducer.abandonEnding({ ticketId: started.ticketId });
    eq(abandoned.ok, true, 'abandon ok');
    eq(abandoned.abandoned, true, 'abandoned');
    eq(abandoned.flagWritten, false, 'flagWritten=false');
    eq(s.db.count('putQuests'), 0, '零 quest 写入');
    eq(s.reducer.endingOf({ quests: questsOf(s.db) }).resolved, false, '未通关');
    const settleAfter = await s.reducer.settleEnding({ ticketId: started.ticketId });
    eq(settleAfter.ok, false, '放弃后 settle ok=false');
    eq(settleAfter.reason, 'run-failed', '放弃后 reason=run-failed');
    eq(c5RowsOf(s.db).length, 0, '放弃后仍零 C5');
    const restart = await s.reducer.startEnding({ approach: 'combat', careerId: s.careerId });
    eq(restart.ok, true, '重新开始 ok');
    recordWin(s.reducer, restart.ticketId, 'combat');
    const settled = await s.reducer.settleEnding({ ticketId: restart.ticketId });
    eq(settled.ok, true, '重开结算 ok');
    return '放弃不消耗 C5';
  });

  await check('C6 quest 写入失败：已结算但不写 C5，重试后只写一次且零新增奖励', async () => {
    const s = await scenario({ failures: { putQuests: 1 } });
    const started = await s.reducer.startEnding({ approach: 'combat', careerId: s.careerId });
    recordWin(s.reducer, started.ticketId, 'combat');
    const failed = await s.reducer.settleEnding({ ticketId: started.ticketId });
    eq(failed.ok, false, 'ok=false');
    eq(failed.reason, 'quest-write-failed', 'reason');
    eq(failed.settled, true, 'settled=true');
    eq(failed.retryable, true, 'retryable');
    eq(failed.flagWritten, false, 'flagWritten=false');
    eq(markerRowsOf(s.db, 'combat').length, 0, '没有结局记录');
    eq(s.db.quests().filter((row) => row.nodeId === 'story:' + C5_FLAG).length, 0, '没有 C5 行');
    eq(Object.keys(s.db.state.claims).length, 1, 'claim 已写 1 条');
    const ledgerAfterFirst = s.db.ledgerCount();
    const creditsAfterFirst = s.db.credits();
    const retried = await s.reducer.settleEnding({ ticketId: started.ticketId });
    eq(retried.ok, true, '重试 ok');
    eq(retried.duplicate, true, '重试 duplicate');
    eq(retried.wrote, true, '重试补写');
    eq(markerRowsOf(s.db, 'combat').length, 1, '结局记录 1 行');
    eq(s.db.quests().filter((row) => row.nodeId === 'story:' + C5_FLAG).length, 1, 'C5 行 1 行');
    eq(Object.keys(s.db.state.claims).length, 1, 'claims 仍 1 条');
    eq(s.db.ledgerCount(), ledgerAfterFirst, '流水零新增');
    eq(s.db.credits(), creditsAfterFirst, '钱包零新增');
    return '写失败可重试';
  });

  await check('C7 另一终局已解决：第二个 approach 不结算、不写旗标、C5 唯一', async () => {
    const { s } = await resolveEnding('combat');
    const rescueRow = s.reducer.getCommission().getCommission('ending.rescue');
    assert(!!rescueRow, '取得 rescue 规范行');
    const manualTicket = 'commission-manual-rescue';
    s.db.addRun({
      runId: manualTicket,
      careerId: s.careerId,
      gameId: 'road-rush',
      mode: 'commission',
      sourceMode: 'commission',
      commissionId: 'ending.rescue',
      ticketId: manualTicket,
      nonce: 'a'.repeat(32),
      status: 'issued',
      issuedAt: NOW,
      contentVersion: CommissionModule.CONTENT_VERSION,
      commissionSnapshot: rescueRow,
    });
    const settleCallsBefore = s.db.count('settleAndClaim');
    const result = await s.reducer.settleEnding({ ticketId: manualTicket });
    eq(result.ok, false, 'ok=false');
    eq(result.reason, 'already-resolved', 'already-resolved');
    eq(result.resolvedApproach, 'combat', 'resolvedApproach=combat');
    eq(result.approach, 'rescue', 'ticket approach=rescue');
    eq(result.settled, false, '未结算');
    eq(result.wrote, false, '未写入');
    eq(s.db.count('settleAndClaim'), settleCallsBefore, '未调 settleAndClaim');
    const run = await s.db.getRun(manualTicket);
    eq(run.status, 'issued', 'run 仍未结算');
    eq(markerRowsOf(s.db, 'rescue').length, 0, '没有 rescue 结局记录');
    const c5StoryRows = s.db.quests().filter((row) => row.nodeId === 'story:' + C5_FLAG).length;
    eq(c5StoryRows, 1, 'C5 旗标行仍 1 行');
    return 'C5 唯一';
  });

  await check('C8 非终局 ticket / 非法 ticket：not-an-ending / no-run / bad-ticket，不写旗标', async () => {
    const s = await scenario();
    s.db.addRun({
      runId: 'commission-normal-1',
      careerId: s.careerId,
      gameId: 'pendulum-tower',
      mode: 'commission',
      sourceMode: 'commission',
      commissionId: 'pendulum-tower.T1',
      ticketId: 'commission-normal-1',
      nonce: 'b'.repeat(32),
      status: 'issued',
      issuedAt: NOW,
      contentVersion: CommissionModule.CONTENT_VERSION,
    });
    const notEnding = await s.reducer.settleEnding({ ticketId: 'commission-normal-1' });
    eq(notEnding.reason, 'not-an-ending', 'not-an-ending');
    eq(notEnding.commissionId, 'pendulum-tower.T1', '回显 commissionId');
    const noRun = await s.reducer.settleEnding({ ticketId: 'commission-unknown-1' });
    eq(noRun.reason, 'no-run', 'no-run');
    const badTicket = await s.reducer.settleEnding({ ticketId: 'bad id!' });
    eq(badTicket.reason, 'bad-ticket', 'bad-ticket');
    eq(s.db.count('putQuests'), 0, '零写入');
    return '3 类拒绝';
  });

  await check('C9 注入假 commission：非 0 信用点收据 → economy-violation，不写 C5', async () => {
    const db = createFakeDb({});
    await db.ensureCareer({});
    const fake = createFakeCommission({
      receipt: {
        receiptId: 'commission-guard-1',
        careerId: db.state.careerId,
        commissionId: 'ending.combat',
        credits: 50,
        items: {},
        evidence: [],
        flags: [C5_FLAG, 'ending.combat'],
        txIds: ['tx:commission-guard-1:1'],
        claimedAt: NOW,
      },
    });
    const reducer = EndingModule.createEndingReducer({ db, storage: createFakeStorage(), commission: fake, now: () => NOW });
    const config = reducer.configure({ endings: defaultEndings(), campaign: clone(CAMPAIGN), db, commission: fake });
    eq(config.ok, true, 'configure ok');
    db.addRun({
      runId: 'commission-guard-1',
      careerId: db.state.careerId,
      gameId: 'star-raid',
      mode: 'commission',
      commissionId: 'ending.combat',
      ticketId: 'commission-guard-1',
      nonce: 'c'.repeat(32),
      status: 'issued',
      contentVersion: '0.18.0',
    });
    const result = await reducer.settleEnding({ ticketId: 'commission-guard-1' });
    eq(result.ok, false, 'ok=false');
    eq(result.reason, 'economy-violation', 'economy-violation');
    eq(result.flagWritten, false, 'flagWritten=false');
    eq(result.credits, 50, '回显违规信用点');
    eq(db.count('putQuests'), 0, '零写入');
    eq(reducer.endingOf({ quests: questsOf(db) }).resolved, false, '未通关');
    return 'economy-violation';
  });

  await check('C10 注入假 commission：收据缺 C5 旗标 → receipt-missing-flag，不写 C5', async () => {
    const db = createFakeDb({});
    await db.ensureCareer({});
    const fake = createFakeCommission({
      receipt: {
        receiptId: 'commission-guard-2',
        careerId: db.state.careerId,
        commissionId: 'ending.rescue',
        credits: 0,
        items: {},
        evidence: [],
        flags: ['ending.rescue'],
        txIds: [],
        claimedAt: NOW,
      },
    });
    const reducer = EndingModule.createEndingReducer({ db, storage: createFakeStorage(), commission: fake, now: () => NOW });
    reducer.configure({ endings: defaultEndings(), campaign: clone(CAMPAIGN), db, commission: fake });
    db.addRun({
      runId: 'commission-guard-2',
      careerId: db.state.careerId,
      gameId: 'road-rush',
      mode: 'commission',
      commissionId: 'ending.rescue',
      ticketId: 'commission-guard-2',
      nonce: 'd'.repeat(32),
      status: 'issued',
      contentVersion: '0.18.0',
    });
    const result = await reducer.settleEnding({ ticketId: 'commission-guard-2' });
    eq(result.ok, false, 'ok=false');
    eq(result.reason, 'receipt-missing-flag', 'receipt-missing-flag');
    eq(result.flagWritten, false, 'flagWritten=false');
    eq(db.count('putQuests'), 0, '零写入');
    return 'receipt-missing-flag';
  });

  await check('C11 结算后余额/库存/流水零新增：ending 不写经典星币与材料', async () => {
    const { s, settled } = await resolveEnding('research');
    eq(settled.receipt.credits, 0, 'receipt credits 0');
    eq(settled.receipt.items, {}, 'receipt items 空');
    eq(s.db.credits(), 80, '钱包仍是初始 80');
    eq(Object.keys(s.db.state.inventory[s.careerId] || {}).length, 0, '库存为空');
    const creditLedger = s.db.state.ledgers.filter((row) => row.careerId === s.careerId && Number(row.credits) > 0);
    eq(creditLedger.length, 0, '流水无正信用点步骤');
    return '零信用点/零材料';
  });
}

/* ------------------------------------------------------------------ *
 * D. 三终局经济等价 + 96 告示板隔离 + 后日常差异
 * ------------------------------------------------------------------ */

async function groupIsolationAndEconomy() {
  await check('D1 三终局经济等价：同一流程三条线都 0 信用点、各自 1 份后日常', async () => {
    const results = [];
    for (const approach of APPROACH_ORDER) {
      const { s, started, settled } = await resolveEnding(approach);
      eq(settled.credits, 0, approach + ' credits');
      eq(s.db.credits(), 80, approach + ' 钱包不变');
      eq(c5RowsOf(s.db).length, 2, approach + ' C5 相关行 2 行（旗标+结局）');
      const ending = s.reducer.endingOf({ quests: questsOf(s.db), claims: [await s.db.getClaim(started.ticketId)] });
      eq(ending.approach, approach, approach + ' endingOf');
      eq(ending.epilogue.text, CAMPAIGN.epilogue[approach], approach + ' 后日常');
      results.push(settled.flagsWritten.join('|'));
    }
    eq(sorted(results).length, 3, '三条线旗标组合互不相同');
    return '经济等价';
  });

  await check('D2 96 告示板隔离：reducer 用独立实例，ending 行不出现在 96 告示板', async () => {
    const boardDb = createFakeDb({});
    await boardDb.ensureCareer({});
    const board = CommissionModule.createCommissionCore({ db: boardDb, storage: createFakeStorage() });
    const boardConfig = board.configure(COMMISSIONS);
    eq(boardConfig.ok, true, 'board configure');
    eq(board.getCommissions().length, 96, 'board 96 行');
    eq(board.getCommission('ending.combat'), null, 'board 无 ending.combat');
    const available = await board.listAvailable({ careerId: boardDb.state.careerId });
    eq(available.ok, true, 'listAvailable ok');
    eq(available.commissions.length, 96, '96 行可见');
    eq(available.commissions.filter((row) => row.commissionId.indexOf('ending.') === 0).length, 0, '无 ending 行');

    const reducer = EndingModule.createEndingReducer({ db: boardDb, storage: createFakeStorage(), now: () => NOW });
    const config = reducer.configure({ endings: defaultEndings(), campaign: clone(CAMPAIGN), db: boardDb });
    eq(config.ok, true, 'reducer configure');
    eq(reducer.getCommission().getCommissions().length, 3, 'reducer 只有 3 行');
    eq(board.getCommissions().length, 96, 'board 仍是 96 行');
    eq(CommissionModule.getCommissions().length, 0, '全局单例未被 configure');
    eq(CommissionModule.getCommission('ending.combat'), null, '全局单例无 ending 行');
    return '96 / 3 隔离';
  });

  await check('D3 结局之后自由职业与挑战不受限：普通委托照常接单/结算/发钱', async () => {
    const { s } = await resolveEnding('combat');
    const board = CommissionModule.createCommissionCore({ db: s.db, storage: createFakeStorage() });
    eq(board.configure(COMMISSIONS).ok, true, 'board configure');
    const available = await board.listAvailable({ careerId: s.careerId });
    eq(available.commissions.length, 96, '96 行仍可见');
    const t1 = available.commissions.find((row) => row.commissionId === 'pendulum-tower.T1');
    eq(t1.unlocked, true, 'T1 可接');
    const started = await board.start({ careerId: s.careerId, commissionId: 'pendulum-tower.T1' });
    eq(started.ok, true, '普通委托可接');
    for (let index = 0; index < 4; index += 1) {
      eq(
        board.recordEvent(started.ticketId, {
          kind: 'tower.floor_stable',
          payload: { floor: index + 1 },
          sourceMode: 'commission',
          seq: index + 1,
          at: NOW,
        }),
        true,
        '事件登记 ' + (index + 1)
      );
    }
    const settled = await board.settle({ ticketId: started.ticketId, outcome: 'won' });
    eq(settled.ok, true, '普通委托结算成功');
    assert(settled.credits > 0, '普通委托正常发钱（' + settled.credits + '）');
    const ending = s.reducer.endingOf({ quests: questsOf(s.db) });
    eq(ending.approach, 'combat', '结局记录不被后续委托覆盖');
    eq(s.db.quests().filter((row) => row.nodeId === 'story:' + C5_FLAG).length, 1, 'C5 旗标仍 1 行');
    return '自由职业照常';
  });
}

/* ------------------------------------------------------------------ *
 * E. 只读推导：endingOf / canStart / listEndings
 * ------------------------------------------------------------------ */

async function groupReadOnly() {
  await check('E1 endingOf 三种输入形状：quests / claims / byNode，只读不写', async () => {
    const { s } = await resolveEnding('combat');
    const quests = questsOf(s.db);
    const claim = await s.db.getClaim(Object.keys(s.db.state.claims)[0]);
    const claims = [claim];
    const byNode = {};
    quests.forEach((row) => {
      byNode[row.nodeId] = row;
    });
    const callsBefore = s.db.state.calls.length;
    const questsSnapshot = clone(quests);
    const claimsSnapshot = clone(claims);
    const fromQuests = s.reducer.endingOf(quests);
    eq(fromQuests.resolved, true, 'quests resolved');
    eq(fromQuests.approach, 'combat', 'quests approach');
    eq(fromQuests.source, 'ending', 'quests source');
    const fromObject = s.reducer.endingOf({ quests, claims });
    eq(fromObject.approach, 'combat', 'object shape');
    const fromClaims = s.reducer.endingOf([], claims);
    eq(fromClaims.resolved, true, 'claims only resolved');
    eq(fromClaims.approach, 'combat', 'claims only approach');
    eq(fromClaims.source, 'claim', 'claims source');
    const fromByNode = s.reducer.endingOf({ byNode }, []);
    eq(fromByNode.resolved, true, 'byNode resolved');
    eq(s.db.state.calls.length, callsBefore, 'endingOf 不读写 db');
    eq(quests, questsSnapshot, '输入 quests 未被修改');
    eq(claims, claimsSnapshot, '输入 claims 未被修改');
    return '4 种形状';
  });

  await check('E2 endingOf 未解决/未配置也能安全推导；后日常来自 campaign', async () => {
    const fresh = EndingModule.createEndingReducer({});
    const empty = fresh.endingOf({ quests: [], claims: [] });
    eq(empty.ok, true, '未配置 endingOf ok');
    eq(empty.resolved, false, '未解决');
    eq(empty.approach, null, 'approach null');
    eq(empty.endings.length, 3, '三个候选');
    eq(empty.epilogue.text, '', '未配置无后日常文本');
    eq(fresh.epilogueFor('combat').reason, 'not-configured', '未配置 epilogueFor 结构化');
    const orphan = fresh.endingOf({ quests: [{ nodeId: 'story:' + C5_FLAG, status: 'cleared', flags: [C5_FLAG] }] });
    eq(orphan.resolved, true, '孤立 C5 行也算已解决');
    eq(orphan.source, 'flag', 'source=flag');
    eq(orphan.flag, C5_FLAG, 'flag');
    const bareNode = fresh.endingOf({ quests: [{ nodeId: C5_FLAG, status: 'cleared' }] });
    eq(bareNode.resolved, true, 'nodeId 直接是旗标的写法也识别');
    const bareC4 = fresh.endingOf({ quests: [{ nodeId: C4_FLAG, status: 'cleared' }] });
    eq(bareC4.c4, true, 'nodeId 直接是 C4 也识别');
    const s = await scenario();
    const pending = s.reducer.endingOf({ quests: [] });
    eq(pending.epilogue.base, CAMPAIGN.epilogue.base, '未解决也有 base');
    return '安全推导';
  });

  await check('E3 canStart / listEndings：C4 门禁、已解决、未知 approach、可选三种', async () => {
    const s = await scenario();
    eq(s.reducer.canStart('combat').reason, 'locked', '无旗标 locked');
    eq(s.reducer.canStart('combat').available, false, 'available=false');
    const readyCtx = { profile: { flags: [C4_FLAG] } };
    APPROACH_ORDER.forEach((approach) => {
      const result = s.reducer.canStart(approach, readyCtx);
      eq(result.ok, true, approach + ' canStart ok');
      eq(result.available, true, approach + ' available');
      eq(result.c4, true, approach + ' c4');
    });
    const resolvedCtx = {
      quests: [{ nodeId: 'ending.combat', kind: 'ending', status: 'cleared', approach: 'combat', resolved: true, flags: [C5_FLAG, 'ending.combat'] }],
    };
    const resolved = s.reducer.canStart('research', resolvedCtx);
    eq(resolved.reason, 'already-resolved', '已解决');
    eq(resolved.resolvedApproach, 'combat', 'resolvedApproach');
    const unknown = s.reducer.canStart('stealth', readyCtx);
    eq(unknown.reason, 'unknown-approach', '未知 approach');
    eq(unknown.allowedApproaches, APPROACH_ORDER, 'allowedApproaches');

    const noCtx = s.reducer.listEndings();
    eq(noCtx.ok, true, 'listEndings ok');
    eq(noCtx.endings.length, 3, '3 条');
    eq(noCtx.endings.map((item) => item.available), [null, null, null], '无 ctx 时 available 未知');
    const listed = s.reducer.listEndings(readyCtx);
    eq(listed.endings.map((item) => item.available), [true, true, true], 'C4 后三选一');
    const chosen = s.reducer.listEndings(resolvedCtx);
    eq(chosen.resolvedApproach, 'combat', 'listEndings resolvedApproach');
    eq(chosen.endings.map((item) => item.chosen), [true, false, false], 'chosen 标记');
    eq(chosen.endings.map((item) => item.reason).filter((reason) => reason === 'already-resolved').length, 3, '全部 already-resolved');
    return 'canStart/listEndings 一致';
  });
}

/* ------------------------------------------------------------------ *
 * F. 确定性 / API 面 / 静态边界
 * ------------------------------------------------------------------ */

async function groupDeterminism() {
  await check('F1 确定性与 API 面：两次配置/推导一致，Node 导出 createEndingReducer + 常量', async () => {
    eq(typeof EndingModule.createEndingReducer, 'function', 'createEndingReducer 导出');
    eq(EndingModule.VERSION, '0.18.0', 'VERSION');
    eq(EndingModule.CONTENT_VERSION, '0.18.0', 'CONTENT_VERSION');
    eq(EndingModule.ENDING_FLAG, C5_FLAG, 'ENDING_FLAG');
    eq(EndingModule.C4_FLAG, C4_FLAG, 'C4_FLAG');
    eq(EndingModule.APPROACHES, APPROACH_ORDER, 'APPROACHES');
    ['configure', 'startEnding', 'settleEnding', 'abandonEnding', 'endingOf', 'epilogueFor', 'canStart', 'listEndings', 'getState', 'getCommission', 'reset'].forEach((name) => {
      eq(typeof EndingModule[name], 'function', 'API ' + name);
    });
    const first = configuredResult(defaultEndings());
    const second = configuredResult(defaultEndings());
    eq(first.config.endings, second.config.endings, 'configure.endings 确定');
    const rowsA = first.reducer.getCommission().getCommissions();
    const rowsB = second.reducer.getCommission().getCommissions();
    eq(rowsA, rowsB, 'commission 行确定');
    const quests = [
      { nodeId: 'story:' + C5_FLAG, kind: 'story-flag', status: 'cleared', flags: [C5_FLAG], clearedAt: NOW },
      { nodeId: 'ending.combat', kind: 'ending', status: 'cleared', approach: 'combat', resolved: true, flags: [C5_FLAG, 'ending.combat'], clearedAt: NOW },
    ];
    eq(first.reducer.endingOf({ quests }), second.reducer.endingOf({ quests }), 'endingOf 确定');
    APPROACH_ORDER.forEach((approach) => {
      eq(first.reducer.epilogueFor(approach), second.reducer.epilogueFor(approach), approach + ' epilogue 确定');
    });
    const freshA = EndingModule.createEndingReducer({});
    eq(freshA.getState().configured, false, '未 configure 状态');
    const startedA = await scenario();
    const startedB = await scenario();
    const startA = await startedA.reducer.startEnding({ approach: 'combat', careerId: startedA.careerId });
    const startB = await startedB.reducer.startEnding({ approach: 'combat', careerId: startedB.careerId });
    eq({ approach: startA.approach, commissionId: startA.commissionId, gameId: startA.gameId, startParams: startA.startParams },
      { approach: startB.approach, commissionId: startB.commissionId, gameId: startB.gameId, startParams: startB.startParams }, '启动元数据确定');
    return '确定性通过';
  });

  await check('F2 静态边界：无 DOM/网络/存储，UMD 浏览器挂载 window.ArcadeCareerEnding + ArcadeCareer.ending', async () => {
    const code = stripComments(MODULE_SOURCE);
    const forbidden = [
      [/\bdocument\b/, 'document'],
      [/\bfetch\s*\(/, 'fetch'],
      [/XMLHttpRequest/, 'XMLHttpRequest'],
      [/localStorage/, 'localStorage'],
      [/sessionStorage/, 'sessionStorage'],
      [/indexedDB/, 'indexedDB'],
      [/window\./, 'window.'],
      [/Math\.random/, 'Math.random'],
      [/https?:\/\//, 'http(s) URL'],
    ];
    forbidden.forEach(([pattern, label]) => {
      assert(!pattern.test(code), '源码不得出现 ' + label);
    });
    assert(MODULE_SOURCE.indexOf('root.ArcadeCareerEnding = api;') >= 0, '窗口级挂载');
    assert(MODULE_SOURCE.indexOf('career.ending = api;') >= 0, 'ArcadeCareer.ending 镜像');
    assert(MODULE_SOURCE.indexOf('module.exports = factory') >= 0, 'Node 导出');
    assert(MODULE_SOURCE.indexOf('createEndingReducer') >= 0, '工厂导出');

    const windowStub = {};
    const sandbox = { window: windowStub, console };
    vm.createContext(sandbox);
    vm.runInContext(MODULE_SOURCE, sandbox, { filename: 'ending-reducer.js' });
    assert(!!windowStub.ArcadeCareerEnding, 'window.ArcadeCareerEnding 挂载');
    eq(typeof windowStub.ArcadeCareerEnding.configure, 'function', '浏览器 API configure');
    assert(!!windowStub.ArcadeCareer && windowStub.ArcadeCareer.ending === windowStub.ArcadeCareerEnding, 'ArcadeCareer.ending 同一对象');
    return '静态边界干净';
  });

  await check('F3 依赖注入：无 db/无 commission 时 configure 仍可转行，运行期返回结构化失败', async () => {
    const isolated = EndingModule.createEndingReducer({ storage: createFakeStorage() });
    const config = isolated.configure({ endings: defaultEndings(), campaign: clone(CAMPAIGN) });
    eq(config.ok, true, '无 db 也能 configure（内容层）');
    eq(isolated.getCommission().getCommissions().length, 3, '行仍建好');
    const started = await isolated.startEnding({ approach: 'combat', careerId: 'career-d18-09' });
    eq(started.ok, false, '无 db 启动失败');
    eq(started.reason, 'db-unavailable', 'db-unavailable');
    const settled = await isolated.settleEnding({ ticketId: 'commission-x-1' });
    eq(settled.reason, 'db-unavailable', 'settle 也结构化');
    const reset = isolated.reset();
    eq(reset.ok, true, 'reset ok');
    eq(isolated.getState().configured, false, 'reset 后未配置');
    return '注入边界';
  });

  await check('F4 懒装载兜底：configure 时 commission-core 未就绪 → 内容仍可用，运行期补建实例且不污染 96 单例', async () => {
    const original = CommissionModule.createCommissionCore;
    let calls = 0;
    CommissionModule.createCommissionCore = function (base) {
      calls += 1;
      if (calls === 1) return null;
      return original.call(CommissionModule, base);
    };
    let s = null;
    try {
      s = await scenario();
    } finally {
      CommissionModule.createCommissionCore = original;
    }
    eq(s.config.ok, false, 'commission 缺席时 configure 诚实失败');
    assert(s.config.errors.indexOf('commission-unavailable') >= 0, 'errors 含 commission-unavailable');
    eq(s.config.contentReady, true, '内容层已就绪');
    eq(s.reducer.getState().configured, false, '尚未 configured');
    eq(s.reducer.listEndings({ profile: { flags: [C4_FLAG] } }).ok, true, '内容就绪即可 listEndings');
    eq(s.reducer.canStart('combat', { profile: { flags: [C4_FLAG] } }).available, true, '只读 canStart 可用');
    eq(CommissionModule.getCommissions().length, 0, '没有把 ending 行写进全局单例');
    const started = await s.reducer.startEnding({ approach: 'combat', careerId: s.careerId });
    eq(started.ok, true, '运行期补建实例后可以启动');
    eq(s.db.count('createRun'), 1, 'createRun 1 次');
    eq(s.reducer.getState().configured, true, '状态转为 configured');
    eq(s.reducer.getState().contentReady, true, 'contentReady 保持');
    recordWin(s.reducer, started.ticketId, 'combat');
    const settled = await s.reducer.settleEnding({ ticketId: started.ticketId });
    eq(settled.ok, true, '补建实例后也能结算');
    eq(markerRowsOf(s.db, 'combat').length, 1, '结局记录写入');
    return '懒装载自愈';
  });
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

async function main() {
  try {
    assembly();
  } catch (err) {
    console.error('FAIL  装配失败：' + (err && err.stack ? err.stack : err));
    console.error('\n0/0 checks passed（装配未完成）');
    return 2;
  }

  await groupConfigure();
  await groupStart();
  await groupSettle();
  await groupIsolationAndEconomy();
  await groupReadOnly();
  await groupDeterminism();

  const failed = failures.length;
  console.log('');
  if (failed === 0) {
    console.log('PASS: ' + passed + '/' + total + ' checks passed');
    return 0;
  }
  console.log('FAIL: ' + passed + '/' + total + ' checks passed');
  failures.forEach((item, index) => console.log('  ' + (index + 1) + '. ' + item));
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('FAIL  ' + (err && err.stack ? err.stack : err));
    console.error('\n0/0 checks passed（装配未完成）');
    process.exit(2);
  });
