#!/usr/bin/env node
/**
 * Arcade Life 0.16 委托引擎门禁（D16-02）：
 * commission-core 的目录规范化、可接委托、ticket 签发/校验、事件缓冲、
 * 目标判定、奖励编排、结算幂等、放弃与降级。
 *
 * 纯 Node：require 真实 career-core（及它 require 的 registry），career-db 用
 * 内存假实现注入（语义对齐 apps/arcade/career/career-db.js 的公开方法），
 * 内容夹具用仓库真实 apps/arcade/career/content/commissions.json。
 *
 * 零 npm 依赖；不启动 Chrome、不写仓库文件。
 * 运行：node tools/career_commission_test.mjs
 * 退出码：0 全部通过；1 有失败；2 装配失败（模块/内容读取失败）。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const COMMISSION_CORE = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'commission-core.js');
const CAREER_CORE = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'career-core.js');
const COMMISSIONS_JSON = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'commissions.json');

const require = createRequire(import.meta.url);
const NOW = '2026-11-23T01:00:00.000Z';
const TICKET_KEY = 'studiokit:arcade:career:ticket.v1';
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const NONCE_RE = /^[0-9a-f]{32,128}$/;

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

/* ------------------------------------------------------------------ *
 * 夹具：内存假 career-db（对齐真实公开方法语义）
 * ------------------------------------------------------------------ */

function createFakeDb(options) {
  const opts = options || {};
  const state = {
    careerId: null,
    profiles: {},
    balances: {},
    quests: [],
    runs: {},
    claims: {},
    inventory: {},
    calls: [],
    failures: Object.assign({ ensureCareer: 0, createRun: 0, updateRun: 0, settleAndClaim: 0 }, opts.failures || {}),
    initialFlags: Array.isArray(opts.initialFlags) ? opts.initialFlags.slice() : [],
  };

  function log(name, payload) {
    state.calls.push({ name, payload: payload === undefined ? null : clone(payload) });
  }

  function failure(reason) {
    return { ok: false, reason, error: reason };
  }

  async function ensureCareer(input) {
    log('ensureCareer', input);
    if (state.failures.ensureCareer) return failure('injected-ensure-career');
    if (state.careerId) {
      return {
        ok: true,
        created: false,
        careerId: state.careerId,
        profile: clone(state.profiles[state.careerId]),
        balance: clone(state.balances[state.careerId]),
      };
    }
    const careerId = 'career-test-1';
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
    state.balances[careerId] = { careerId, credits: 80, revision: 1 };
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
    return state.profiles[careerId] ? clone(state.profiles[careerId]) : null;
  }

  /** 对齐 career-db.getState：state store 的 'career' 指针（getWallet 缺省 careerId 时用）。 */
  async function getState(key) {
    log('getState', key);
    if (key !== 'career') return null;
    if (!state.careerId) return null;
    return { key: 'career', careerId: state.careerId, originGameId: null, updatedAt: NOW };
  }

  async function readQuestState(careerId) {
    log('readQuestState', careerId);
    const quests = state.quests.filter((row) => row.careerId === careerId);
    const byNode = {};
    quests.forEach((row) => {
      byNode[row.nodeId] = clone(row);
    });
    return { ok: true, careerId, quests: clone(quests), byNode };
  }

  async function putQuests(careerId, quests) {
    log('putQuests', { careerId, quests });
    if (state.failures.putQuests) return failure('injected-put-quests');
    const list = Array.isArray(quests) ? quests : Object.keys(quests || {}).map((key) => quests[key]);
    list.forEach((row) => {
      if (!row || !row.nodeId) return;
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
    if (state.failures.createRun) return failure('injected-create-run');
    if (!run || typeof run.runId !== 'string') return failure('bad-run');
    const existing = state.runs[run.runId];
    if (existing) {
      const same = existing.careerId === run.careerId && existing.nonce === run.nonce && existing.gameId === run.gameId;
      if (same) return { ok: true, duplicate: true, run: clone(existing) };
      return failure('conflict');
    }
    const row = Object.assign({}, clone(run), {
      createdAt: NOW,
      updatedAt: NOW,
      schemaVersion: 1,
    });
    state.runs[run.runId] = row;
    return { ok: true, duplicate: false, run: clone(row) };
  }

  async function getRun(runId) {
    log('getRun', runId);
    return state.runs[runId] ? clone(state.runs[runId]) : null;
  }

  async function updateRun(runId, patch) {
    log('updateRun', { runId, patch });
    if (state.failures.updateRun) return failure('injected-update-run');
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
    return state.claims[runId] ? clone(state.claims[runId]) : null;
  }

  async function settleAndClaim(input) {
    log('settleAndClaim', input);
    if (state.failures.settleAndClaim) return failure('injected-settle-claim');
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
    const txIds = [];
    let step = 1;
    if (credits > 0) txIds.push('tx:' + options.runId + ':' + step++);
    if (Object.keys(items).length) txIds.push('tx:' + options.runId + ':' + step++);
    if (evidence.length || flags.length) txIds.push('tx:' + options.runId + ':' + step++);
    const receipt = {
      receiptId: options.runId,
      careerId: options.careerId,
      commissionId: run.commissionId,
      credits,
      items,
      evidence,
      flags,
      txIds,
      claimedAt: options.now || NOW,
      rulesetVersion: 1,
      contentVersion: options.contentVersion || '0.18.0',
    };
    balance.credits += credits;
    balance.revision += 1;
    const inventory = state.inventory[options.careerId] || (state.inventory[options.careerId] = {});
    Object.keys(items).forEach((itemId) => {
      inventory[itemId] = (inventory[itemId] || 0) + items[itemId];
    });
    state.quests = state.quests.filter(
      (row) => !(row.careerId === options.careerId && row.nodeId === run.commissionId)
    );
    state.quests.push({
      careerId: options.careerId,
      nodeId: run.commissionId,
      kind: 'commission',
      status: 'cleared',
      evidence: evidence.slice(),
      flags: flags.slice(),
      clearedAt: options.now || NOW,
      updatedAt: options.now || NOW,
    });
    state.claims[options.runId] = clone(receipt);
    state.runs[options.runId] = Object.assign({}, state.runs[options.runId], {
      status: 'claimed',
      claimedAt: options.now || NOW,
      receiptId: options.runId,
      updatedAt: options.now || NOW,
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
    settleAndClaim,
    count(name) {
      return state.calls.filter((entry) => entry.name === name).length;
    },
    resetLog() {
      state.calls.length = 0;
    },
  };
  return db;
}

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

/* ------------------------------------------------------------------ *
 * 装配
 * ------------------------------------------------------------------ */

let CommissionModule = null;
let careerCore = null;
let commissionsContent = null;

const FIXTURE_COMMISSIONS = {
  "contentVersion": "0.18.0",
  "commissions": [
    {
      "commissionId": "pendulum-tower.T1",
      "gameId": "pendulum-tower",
      "professionId": "engineering.structural",
      "title": "试工：四层起步",
      "summary": "在潮汐吊臂下把四层集装箱稳稳叠起。",
      "issuer": "旧港施工队",
      "objective": {
        "kind": "tower.floor_stable",
        "atLeast": 4,
        "context": {}
      },
      "objectiveBonus": 0,
      "startParams": {},
      "reward": {
        "credits": 70,
        "items": {
          "alloy": 1
        },
        "evidence": [
          "E-C1-site"
        ],
        "flags": [
          "C1.work_done"
        ]
      },
      "repeatSalaryCredits": 25,
      "unlock": {
        "all": []
      },
      "risk": "low",
      "durationHint": "约 2–4 分钟"
    },
    {
      "commissionId": "pendulum-tower.T2",
      "gameId": "pendulum-tower",
      "professionId": "engineering.structural",
      "title": "夜班：六层结构",
      "summary": "夜潮涨起来之前，把六层结构立稳。",
      "issuer": "旧港施工队",
      "objective": {
        "kind": "tower.floor_stable",
        "atLeast": 6,
        "context": {}
      },
      "objectiveBonus": 10,
      "startParams": {},
      "reward": {
        "credits": 110,
        "items": {
          "alloy": 2
        },
        "evidence": [
          "E-C1-site-2"
        ],
        "flags": [
          "C1.foreman"
        ]
      },
      "repeatSalaryCredits": 35,
      "unlock": {
        "all": [
          {
            "kind": "chapterFlag",
            "value": "C1.work_done"
          }
        ]
      },
      "risk": "medium",
      "durationHint": "约 3–5 分钟"
    },
    {
      "commissionId": "star-raid.T1",
      "gameId": "star-raid",
      "professionId": "adventure.pilot",
      "title": "护航：第一巡逻区",
      "summary": "跟着旧港的护航线走一趟，把巡防队赶回去。",
      "issuer": "旧港护航处",
      "objective": {
        "kind": "boss.defeated",
        "atLeast": 1,
        "context": {
          "level": 1
        }
      },
      "objectiveBonus": 0,
      "startParams": {
        "startLevel": 1
      },
      "reward": {
        "credits": 90,
        "items": {
          "alloy": 1
        },
        "evidence": [
          "E-C1-patrol"
        ],
        "flags": [
          "C1.flight_done"
        ]
      },
      "repeatSalaryCredits": 30,
      "unlock": {
        "all": []
      },
      "risk": "medium",
      "durationHint": "约 3–5 分钟"
    },
    {
      "commissionId": "star-raid.T2",
      "gameId": "star-raid",
      "professionId": "adventure.pilot",
      "title": "护航：电磁风暴",
      "summary": "风暴里有一艘母舰在等，把它挡在航道外。",
      "issuer": "旧港护航处",
      "objective": {
        "kind": "boss.defeated",
        "atLeast": 1,
        "context": {
          "level": 3,
          "theme": "storm"
        }
      },
      "objectiveBonus": 15,
      "startParams": {
        "startLevel": 3,
        "themeId": "storm"
      },
      "reward": {
        "credits": 130,
        "items": {
          "alloy": 2,
          "crystal": 1
        },
        "evidence": [
          "E-C1-patrol-2"
        ],
        "flags": [
          "C1.storm_done"
        ]
      },
      "repeatSalaryCredits": 40,
      "unlock": {
        "all": [
          {
            "kind": "chapterFlag",
            "value": "C1.flight_done"
          }
        ]
      },
      "risk": "high",
      "durationHint": "约 4–6 分钟"
    }
  ]
};

function assembly() {
  CommissionModule = require(COMMISSION_CORE);
  if (!CommissionModule || typeof CommissionModule.createCommissionCore !== 'function') {
    throw new Error('commission-core 未导出 createCommissionCore');
  }
  careerCore = require(CAREER_CORE);
  if (!careerCore || typeof careerCore.validateCommission !== 'function') {
    throw new Error('career-core 缺少 validateCommission');
  }
  /* 0.16 生命周期金样：真实内容 0.17 已扩到 96 条，这里固定使用 0.16 四条目，
     真实 96 条 schema/目标由 commission-schema 与 career_96_missions_test 覆盖。 */
  commissionsContent = JSON.parse(JSON.stringify(FIXTURE_COMMISSIONS));
  if (!commissionsContent || !Array.isArray(commissionsContent.commissions) || commissionsContent.commissions.length !== 4) {
    throw new Error('0.16 合成内容异常');
  }
}

function scenario(overrides) {
  const opts = overrides || {};
  const db = opts.db || createFakeDb(opts.dbOptions);
  const storage = opts.storage === null ? null : opts.storage || createFakeStorage();
  const core = CommissionModule.createCommissionCore({
    db,
    core: careerCore,
    now: () => NOW,
    storage,
  });
  if (opts.content !== false) {
    const configured = core.configure({ content: opts.contentContent || commissionsContent });
    if (!configured.ok) throw new Error('configure 失败：' + JSON.stringify(configured.errors));
  }
  return { db, storage, core };
}

async function startTicket(core, commissionId) {
  const result = await core.start({ commissionId });
  assert(result && result.ok, 'start 失败：' + JSON.stringify(result));
  return result.ticketId;
}

function towerEvents(count, ticketId, core) {
  for (let index = 1; index <= count; index += 1) {
    const accepted = core.recordEvent(ticketId, {
      kind: 'tower.floor_stable',
      payload: { floor: index, perfect: index % 2 === 0 },
      seq: index,
      sourceMode: 'commission',
      at: NOW,
    });
    assert(accepted === true, '第 ' + index + ' 层事件被拒绝');
  }
}

function bossEvent(core, ticketId, payload, seq) {
  const accepted = core.recordEvent(ticketId, {
    kind: 'boss.defeated',
    payload: payload || { level: 1 },
    seq: seq || 1,
    sourceMode: 'commission',
    at: NOW,
  });
  assert(accepted === true, 'boss 事件被拒绝');
}

/* ------------------------------------------------------------------ *
 * A. 目录规范化
 * ------------------------------------------------------------------ */

async function groupA() {
  await check('A1 configure 0.16 合成四条目（生命周期夹具）：4 条、无 errors、usable', async () => {
    const { core } = scenario();
    const result = core.configure({ content: commissionsContent });
    eq(result.count, 4, 'count');
    eq(result.errors, [], 'errors');
    eq(result.contentVersion, '0.18.0', 'contentVersion');
    assert(result.ok === true, 'ok 应为 true');
    assert(result.usable === true, 'usable 应为 true');
    return 'count=4';
  });

  await check('A2 坏条目隔离：4 合法 + 坏条目进 errors，目录保留 4 条不抛', async () => {
    const valid = commissionsContent.commissions;
    const base = {
      gameId: 'pendulum-tower',
      professionId: 'engineering.structural',
      title: '试工',
      summary: '一句话。',
      issuer: '旧港',
      unlock: { all: [] },
    };
    const broken = {
      contentVersion: '0.18.0',
      commissions: valid.concat([
        Object.assign({}, base, { commissionId: 'bad.T1' }),
        Object.assign({}, base, { commissionId: 'pendulum-tower.T1', objective: { kind: 'tower.floor_stable', atLeast: 1 } }),
        Object.assign({}, base, { commissionId: 'bad.T2', objective: { kind: 'tower.floor_stable', atLeast: 1 }, unlock: { all: [{ kind: 'unknownKind', value: 'x' }] } }),
        Object.assign({}, base, { commissionId: 'bad.T3', objective: { kind: 'tower.floor_stable', atLeast: 1, context: { level: { gte: 1 } } } }),
      ]),
    };
    const { core } = scenario({ content: false });
    const result = core.configure({ content: broken });
    eq(result.count, 4, '保留合法条目数');
    assert(result.ok === false, 'ok 应为 false（有 errors）');
    assert(result.errors.some((item) => item.indexOf('objective-invalid:bad.T1') === 0), '缺少 objective-invalid:bad.T1：' + JSON.stringify(result.errors));
    assert(result.errors.some((item) => item.indexOf('commission-duplicate:pendulum-tower.T1') === 0), '缺少重复 commissionId 错误');
    assert(result.errors.some((item) => item.indexOf('unlock-invalid:bad.T2') === 0), '缺少 unlock-invalid:bad.T2');
    assert(result.errors.some((item) => item.indexOf('objective-context-unsupported:bad.T3') === 0), '缺少区间 context 不支持错误');
    assert(core.getCommission('pendulum-tower.T1') !== null, '合法条目应保留');
    assert(core.getCommission('bad.T1') === null, '坏条目不应可查');
    return 'errors=' + result.errors.length;
  });

  await check('A3 非法内容（null / 字符串）结构化失败且不抛', async () => {
    const { core } = scenario({ content: false });
    const nullResult = core.configure({ content: null });
    assert(nullResult.ok === false, 'null 应失败');
    assert(nullResult.errors.indexOf('content-missing') >= 0, 'null errors：' + JSON.stringify(nullResult.errors));
    const scalarResult = core.configure({ content: 'nope' });
    assert(scalarResult.ok === false, '标量应失败');
    assert(scalarResult.errors.indexOf('content-invalid') >= 0, '标量 errors：' + JSON.stringify(scalarResult.errors));
    const arrayResult = core.configure({ content: [null, 42] });
    assert(arrayResult.ok === false, '坏数组应失败');
    eq(arrayResult.count, 0, '坏数组 count');
    return 'null/string/array 均结构化失败';
  });

  await check('A4 内容版本跨 major（0.15.0）→ usable=false 且 listAvailable 拒绝', async () => {
    const badVersion = clone(commissionsContent);
    badVersion.contentVersion = '0.15.0';
    const { core, db } = scenario({ content: false });
    const configured = core.configure({ content: badVersion });
    assert(configured.ok === false, 'ok 应 false');
    assert(configured.usable === false, 'usable 应 false');
    assert(configured.errors.some((item) => item.indexOf('content-version-mismatch') === 0), '缺少版本错误');
    const listed = await core.listAvailable({ ensure: true });
    assert(listed.ok === false, 'listAvailable 应失败');
    eq(listed.reason, 'unsupported-content', 'reason');
    eq(db.count('ensureCareer'), 0, '不应创建生涯');
    return 'unsupported-content';
  });

  await check('A5 同 major 补丁版本（0.18.9）可正常使用', async () => {
    const patched = clone(commissionsContent);
    patched.contentVersion = '0.18.9';
    const { core } = scenario({ content: false });
    const configured = core.configure({ content: patched });
    assert(configured.ok === true, 'ok 应 true：' + JSON.stringify(configured.errors));
    eq(configured.count, 4, 'count');
    return 'usable';
  });

  await check('A6 getCommissions / getCommission 返回深拷贝（外部修改不回写）', async () => {
    const { core } = scenario();
    const list = core.getCommissions();
    eq(list.length, 4, 'list 长度');
    list[0].title = '被外部修改';
    const again = core.getCommission(list[0].commissionId);
    assert(again && again.title !== '被外部修改', '内部内容被外部修改污染');
    return 'clone 安全';
  });
}

/* ------------------------------------------------------------------ *
 * B. listAvailable 与 unlock
 * ------------------------------------------------------------------ */

async function groupB() {
  await check('B1 未接生涯 ensure:false → careerId=null、4 条候选、零 DB 调用', async () => {
    const { core, db } = scenario();
    const result = await core.listAvailable({ ensure: false });
    assert(result.ok === true, 'ok 应 true');
    eq(result.careerId, null, 'careerId');
    eq(result.commissions.length, 4, 'candidates');
    eq(db.count('ensureCareer'), 0, 'ensureCareer 调用');
    eq(db.count('createRun'), 0, 'createRun 调用');
    eq(db.state.calls.length, 0, '不应有任何 DB 调用');
    return 'no-write';
  });

  await check('B2 ensure:true → 创建生涯（初始 80 信用点）', async () => {
    const { core, db } = scenario();
    const result = await core.listAvailable({ ensure: true });
    assert(result.ok === true, 'ok 应 true');
    assert(typeof result.careerId === 'string' && result.careerId.length > 0, 'careerId');
    eq(result.created, true, 'created');
    eq(db.state.balances[result.careerId].credits, 80, '初始信用点');
    eq(db.count('ensureCareer'), 1, 'ensureCareer 调用');
    return 'careerId=' + result.careerId + ', credits=80';
  });

  await check('B3 unlock 空谓词可接；C1 flag 未满足的 T2 锁定', async () => {
    const { core } = scenario();
    const result = await core.listAvailable({ ensure: true });
    const byId = {};
    result.commissions.forEach((item) => {
      byId[item.commissionId] = item;
    });
    eq(byId['pendulum-tower.T1'].unlocked, true, 'PT.T1');
    eq(byId['star-raid.T1'].unlocked, true, 'star.T1');
    eq(byId['pendulum-tower.T2'].unlocked, false, 'PT.T2');
    eq(byId['star-raid.T2'].unlocked, false, 'star.T2');
    assert(byId['pendulum-tower.T1'].title && byId['pendulum-tower.T1'].summary && byId['pendulum-tower.T1'].issuer, '列表字段缺失');
    assert(byId['pendulum-tower.T1'].reward && byId['pendulum-tower.T1'].reward.credits === 70, 'reward');
    assert(typeof byId['pendulum-tower.T1'].durationHint === 'string', 'durationHint');
    assert(typeof byId['pendulum-tower.T1'].risk === 'string', 'risk');
    return '2 unlocked / 2 locked';
  });

  await check('B4 已有 chapterFlag（profile.flags）→ T2 解锁', async () => {
    const { core } = scenario({ dbOptions: { initialFlags: ['C1.work_done'] } });
    const result = await core.listAvailable({ ensure: true });
    const byId = {};
    result.commissions.forEach((item) => {
      byId[item.commissionId] = item;
    });
    eq(byId['pendulum-tower.T2'].unlocked, true, 'PT.T2');
    eq(byId['star-raid.T2'].unlocked, false, 'star.T2 仍锁');
    return 'flag 生效';
  });

  await check('B5 commissionCleared 谓词：完成 T1 后解锁自定义委托', async () => {
    const custom = clone(commissionsContent);
    custom.commissions = custom.commissions.concat([
      {
        commissionId: 'pendulum-tower.X1',
        gameId: 'pendulum-tower',
        professionId: 'engineering.structural',
        title: '回头活',
        summary: '把上一单的收尾做完。',
        issuer: '旧港施工队',
        objective: { kind: 'tower.floor_stable', atLeast: 2, context: {} },
        reward: { credits: 5, items: {}, evidence: [], flags: [] },
        repeatSalaryCredits: 1,
        unlock: { all: [{ kind: 'commissionCleared', value: 'pendulum-tower.T1' }] },
        risk: 'low',
        durationHint: '一会儿',
      },
    ]);
    const { core } = scenario({ contentContent: custom });
    const before = await core.listAvailable({ ensure: true });
    const beforeById = {};
    before.commissions.forEach((item) => {
      beforeById[item.commissionId] = item;
    });
    eq(beforeById['pendulum-tower.X1'].unlocked, false, '完成前应锁定');
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    towerEvents(4, ticketId, core);
    const settled = await core.settle({ ticketId, outcome: 'won', stats: {} });
    assert(settled.ok === true, '首单应结算成功');
    const after = await core.listAvailable({ ensure: true });
    const afterById = {};
    after.commissions.forEach((item) => {
      afterById[item.commissionId] = item;
    });
    eq(afterById['pendulum-tower.X1'].unlocked, true, '完成后应解锁');
    return 'quest cleared 生效';
  });
}

/* ------------------------------------------------------------------ *
 * C. start 与 ticket
 * ------------------------------------------------------------------ */

async function groupC() {
  await check('C1 start 形状：ticketId===runId、nonce≥32hex、字段齐全、URL 正确', async () => {
    const { core } = scenario();
    const result = await core.start({ commissionId: 'pendulum-tower.T1' });
    assert(result && result.ok === true, 'ok：' + JSON.stringify(result));
    const ticket = result.ticket;
    eq(ticket.ticketId, ticket.runId, 'ticketId===runId');
    assert(RUN_ID_RE.test(ticket.ticketId), 'runId 形状：' + ticket.ticketId);
    assert(ticket.ticketId.indexOf('commission-') === 0, 'runId 前缀');
    assert(NONCE_RE.test(ticket.nonce), 'nonce 形状：' + ticket.nonce);
    eq(ticket.careerId, result.careerId, 'careerId');
    eq(ticket.commissionId, 'pendulum-tower.T1', 'commissionId');
    eq(ticket.gameId, 'pendulum-tower', 'gameId');
    eq(ticket.contentVersion, '0.18.0', 'contentVersion');
    eq(ticket.issuedAt, NOW, 'issuedAt');
    eq(ticket.mode, 'commission', 'mode');
    eq(result.url, '../games/pendulum-tower.html?career=' + encodeURIComponent(ticket.ticketId), 'url');
    eq(ticket.startParams, {}, 'T1 startParams');
    return ticket.ticketId;
  });

  await check('C2 createRun 参数：mode commission / status issued / ticketId===runId / nonce 一致', async () => {
    const { core, db } = scenario();
    const result = await core.start({ commissionId: 'star-raid.T1' });
    assert(result.ok === true, 'ok');
    const row = db.state.runs[result.ticketId];
    assert(!!row, 'DB 无 run 行');
    eq(row.mode, 'commission', 'mode');
    eq(row.status, 'issued', 'status');
    eq(row.ticketId, result.ticketId, 'ticketId');
    eq(row.runId, result.ticketId, 'runId');
    eq(row.commissionId, 'star-raid.T1', 'commissionId');
    eq(row.gameId, 'star-raid', 'gameId');
    eq(row.nonce, result.ticket.nonce, 'nonce');
    eq(row.careerId, result.careerId, 'careerId');
    eq(db.count('createRun'), 1, 'createRun 次数');
    return 'row ok';
  });

  await check('C3 sessionStorage ticket.v1 字段齐全', async () => {
    const { core, storage } = scenario();
    const result = await core.start({ commissionId: 'pendulum-tower.T1' });
    const raw = storage.getItem(TICKET_KEY);
    assert(typeof raw === 'string' && raw.length > 0, '未写入 ticket');
    const stored = JSON.parse(raw);
    ['ticketId', 'runId', 'careerId', 'commissionId', 'gameId', 'startParams', 'issuedAt', 'nonce', 'contentVersion', 'mode', 'seed'].forEach((field) => {
      assert(stored[field] !== undefined, '缺少字段 ' + field);
    });
    eq(stored.ticketId, result.ticketId, 'stored.ticketId');
    eq(stored.nonce, result.ticket.nonce, 'stored.nonce');
    eq(stored.gameId, 'pendulum-tower', 'stored.gameId');
    return 'stored ok';
  });

  await check('C4 幂等：同 career+commission 再 start 返回原 ticket，不重复 createRun', async () => {
    const { core, db } = scenario();
    const first = await core.start({ commissionId: 'pendulum-tower.T1' });
    const second = await core.start({ commissionId: 'pendulum-tower.T1' });
    assert(second.ok === true, '第二次 ok');
    eq(second.ticketId, first.ticketId, 'ticketId');
    eq(second.reused, true, 'reused');
    eq(db.count('createRun'), 1, 'createRun 次数');
    return 'same ticketId';
  });

  await check('C5 刷新恢复：新实例同 storage 再 start 仍返回原 ticket', async () => {
    const db = createFakeDb();
    const storage = createFakeStorage();
    const first = scenario({ db, storage });
    const started = await first.core.start({ commissionId: 'pendulum-tower.T1' });
    const reloaded = scenario({ db, storage });
    const again = await reloaded.core.start({ commissionId: 'pendulum-tower.T1' });
    assert(again.ok === true, 'ok');
    eq(again.ticketId, started.ticketId, 'ticketId');
    eq(db.count('createRun'), 1, 'createRun 次数');
    return 'recover by storage';
  });

  await check('C6 锁定委托不可接单（不写 run）', async () => {
    const { core, db } = scenario();
    const result = await core.start({ commissionId: 'pendulum-tower.T2' });
    assert(result.ok === false, 'ok 应 false');
    eq(result.reason, 'locked', 'reason');
    eq(db.count('createRun'), 0, '不应 createRun');
    return 'locked';
  });

  await check('C7 未知委托 / 非法 ID 结构化失败', async () => {
    const { core, db } = scenario();
    const unknown = await core.start({ commissionId: 'pendulum-tower.T9' });
    eq(unknown.reason, 'missing-commission', 'unknown reason');
    const badId = await core.start({ commissionId: '../etc/passwd' });
    eq(badId.reason, 'bad-commission-id', 'bad id reason');
    const missing = await core.start({});
    eq(missing.reason, 'bad-commission-id', 'missing id reason');
    eq(db.count('createRun'), 0, '不应 createRun');
    return 'structured';
  });

  await check('C8 createRun 注入失败 → 结构化失败且不写 sessionStorage', async () => {
    const { core, storage } = scenario({ dbOptions: { failures: { createRun: 1 } } });
    const result = await core.start({ commissionId: 'pendulum-tower.T1' });
    assert(result.ok === false, 'ok 应 false');
    eq(result.reason, 'run-create-failed', 'reason');
    eq(storage.getItem(TICKET_KEY), null, '不应写 ticket');
    return 'run-create-failed';
  });

  await check('C9 无内容注入时 start/listAvailable → content-unavailable', async () => {
    const { core } = scenario({ content: false });
    const started = await core.start({ commissionId: 'pendulum-tower.T1' });
    eq(started.reason, 'content-unavailable', 'start reason');
    const listed = await core.listAvailable({ ensure: true });
    eq(listed.reason, 'content-unavailable', 'list reason');
    return 'content-unavailable';
  });
}

/* ------------------------------------------------------------------ *
 * D. validateTicket
 * ------------------------------------------------------------------ */

async function groupD() {
  await check('D1 正常校验：run/commission/ticket 返回且不抛', async () => {
    const { core, storage } = scenario();
    const started = await core.start({ commissionId: 'pendulum-tower.T1' });
    const stored = JSON.parse(storage.getItem(TICKET_KEY));
    const result = await core.validateTicket({ ticketId: started.ticketId, ticket: stored, gameId: 'pendulum-tower' });
    assert(result.ok === true, 'ok：' + JSON.stringify(result));
    eq(result.run.runId, started.ticketId, 'run.runId');
    eq(result.commission.commissionId, 'pendulum-tower.T1', 'commission');
    eq(result.commissionSource, 'content', 'commissionSource');
    return 'ok';
  });

  await check('D2 不存在的 run → no-run', async () => {
    const { core } = scenario();
    const result = await core.validateTicket({ ticketId: 'commission-missing', gameId: 'pendulum-tower' });
    eq(result.ok, false, 'ok');
    eq(result.reason, 'no-run', 'reason');
    return 'no-run';
  });

  await check('D3 gameId 不匹配 → game-mismatch', async () => {
    const { core } = scenario();
    const started = await core.start({ commissionId: 'pendulum-tower.T1' });
    const result = await core.validateTicket({ ticketId: started.ticketId, gameId: 'star-raid' });
    eq(result.reason, 'game-mismatch', 'reason');
    return 'game-mismatch';
  });

  await check('D4 ticket nonce / careerId / commissionId 不一致 → ticket-mismatch', async () => {
    const { core, storage } = scenario();
    const started = await core.start({ commissionId: 'pendulum-tower.T1' });
    const stored = JSON.parse(storage.getItem(TICKET_KEY));
    const badNonce = Object.assign({}, stored, { nonce: 'deadbeef'.repeat(8) });
    eq((await core.validateTicket({ ticketId: started.ticketId, ticket: badNonce, gameId: 'pendulum-tower' })).reason, 'ticket-mismatch', 'nonce');
    const badCareer = Object.assign({}, stored, { careerId: 'career-other' });
    eq((await core.validateTicket({ ticketId: started.ticketId, ticket: badCareer, gameId: 'pendulum-tower' })).reason, 'ticket-mismatch', 'careerId');
    const badCommission = Object.assign({}, stored, { commissionId: 'star-raid.T1' });
    eq((await core.validateTicket({ ticketId: started.ticketId, ticket: badCommission, gameId: 'pendulum-tower' })).reason, 'ticket-mismatch', 'commissionId');
    return '3 mismatch';
  });

  await check('D5 终态 run → settled（含 claimed / failed / abandoned）', async () => {
    const { core, db } = scenario();
    const settledTicket = await startTicket(core, 'pendulum-tower.T1');
    towerEvents(4, settledTicket, core);
    assert((await core.settle({ ticketId: settledTicket, outcome: 'won', stats: {} })).ok === true, 'settle');
    eq((await core.validateTicket({ ticketId: settledTicket, gameId: 'pendulum-tower' })).reason, 'settled', 'claimed');
    const failedTicket = await startTicket(core, 'star-raid.T1');
    assert((await core.settle({ ticketId: failedTicket, outcome: 'lost', stats: {} })).ok === false, 'objective 不足应失败');
    eq((await core.validateTicket({ ticketId: failedTicket, gameId: 'star-raid' })).reason, 'settled', 'failed');
    const abandonedTicket = await startTicket(core, 'star-raid.T1');
    assert((await core.abandon(abandonedTicket)).ok === true, 'abandon');
    eq((await core.validateTicket({ ticketId: abandonedTicket, gameId: 'star-raid' })).reason, 'settled', 'abandoned');
    return '3 terminal';
  });

  await check('D6 内容版本：跨 major 拒绝，同 major 补丁号接受', async () => {
    const { core, db } = scenario();
    const started = await core.start({ commissionId: 'pendulum-tower.T1' });
    const row = db.state.runs[started.ticketId];
    row.contentVersion = '0.19.0';
    eq((await core.validateTicket({ ticketId: started.ticketId, ticket: { contentVersion: '0.19.0' }, gameId: 'pendulum-tower' })).reason, 'unsupported-content', '0.19');
    row.contentVersion = '0.18.9';
    eq((await core.validateTicket({ ticketId: started.ticketId, ticket: { contentVersion: '0.18.9' }, gameId: 'pendulum-tower' })).ok, true, '0.18.9');
    row.contentVersion = '0.18.0';
    eq((await core.validateTicket({ ticketId: started.ticketId, ticket: { contentVersion: '0.18.0' }, gameId: 'pendulum-tower' })).ok, true, '0.18.0');
    return 'version gate';
  });

  await check('D7 sessionStorage 缺失：仅凭 runId 仍可校验（无 ticket）', async () => {
    const db = createFakeDb();
    const opener = scenario({ db, storage: createFakeStorage() });
    const started = await opener.core.start({ commissionId: 'pendulum-tower.T1' });
    const gamePage = scenario({ db, storage: null, content: false });
    const result = await gamePage.core.validateTicket({ ticketId: started.ticketId, ticket: null, gameId: 'pendulum-tower' });
    assert(result.ok === true, 'ok：' + JSON.stringify(result));
    eq(result.run.runId, started.ticketId, 'run');
    eq(result.commissionSource, 'run-snapshot', '快照回退');
    eq(gamePage.storage, null, 'storage 为 null');
    return 'no-storage ok';
  });

  await check('D8 未注入内容时用 run.commissionSnapshot 兜底（含 objective/startParams）', async () => {
    const db = createFakeDb();
    const opener = scenario({ db, storage: createFakeStorage() });
    const started = await opener.core.start({ commissionId: 'star-raid.T2', careerId: null });
    assert(started.ok === false && started.reason === 'locked', 'T2 应锁定：' + JSON.stringify(started));
    const t1 = await opener.core.start({ commissionId: 'star-raid.T1' });
    bossEvent(opener.core, t1.ticketId, { level: 1 });
    assert((await opener.core.settle({ ticketId: t1.ticketId, outcome: 'won', stats: {} })).ok === true, 'T1 settle');
    const t2 = await opener.core.start({ commissionId: 'star-raid.T2' });
    assert(t2.ok === true, 'T2 start：' + JSON.stringify(t2));
    const gamePage = scenario({ db, storage: null, content: false });
    const result = await gamePage.core.validateTicket({ ticketId: t2.ticketId, gameId: 'star-raid' });
    assert(result.ok === true, 'validate：' + JSON.stringify(result));
    eq(result.commissionSource, 'run-snapshot', 'source');
    eq(result.commission.objective.kind, 'boss.defeated', 'objective.kind');
    eq(result.commission.objective.context.level, 3, 'objective.context.level');
    eq(result.commission.startParams.startLevel, 3, 'startParams.startLevel');
    return 'snapshot fallback';
  });

  await check('D9 非 commission mode 的 run → mode-mismatch', async () => {
    const { core, db } = scenario();
    await db.createRun({
      runId: 'commission-classic-1',
      careerId: 'career-test-1',
      gameId: 'pendulum-tower',
      mode: 'classic',
      commissionId: 'pendulum-tower.T1',
      nonce: 'a'.repeat(32),
      status: 'issued',
    });
    const result = await core.validateTicket({ ticketId: 'commission-classic-1', gameId: 'pendulum-tower' });
    eq(result.reason, 'mode-mismatch', 'reason');
    return 'mode-mismatch';
  });
}

/* ------------------------------------------------------------------ *
 * E. recordEvent（同步、内存、上限）
 * ------------------------------------------------------------------ */

async function groupE() {
  await check('E1 合法事件被接受、进入内存缓冲、不写 DB', async () => {
    const { core, db } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    db.resetLog();
    const accepted = core.recordEvent(ticketId, {
      kind: 'tower.floor_stable',
      payload: { floor: 1, perfect: false },
      seq: 1,
      sourceMode: 'commission',
      at: NOW,
    });
    eq(accepted, true, 'accepted');
    const state = core.getState();
    eq(state.ticketId, ticketId, 'ticketId');
    eq(state.bufferCount, 1, 'bufferCount');
    eq(state.events.length, 1, 'events');
    eq(state.events[0].kind, 'tower.floor_stable', 'kind');
    eq(db.count('updateRun'), 0, '不应写 DB');
    eq(db.count('settleAndClaim'), 0, '不应领奖');
    return 'buffered';
  });

  await check('E2 sourceMode 非 commission → 拒绝', async () => {
    const { core } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    eq(core.recordEvent(ticketId, { kind: 'tower.floor_stable', payload: {}, seq: 1, sourceMode: 'classic', at: NOW }), false, 'classic');
    eq(core.recordEvent(ticketId, { kind: 'tower.floor_stable', payload: {}, seq: 1, at: NOW }), false, 'missing sourceMode');
    eq(core.getState().bufferCount, 0, 'buffer 应为空');
    return 'rejected';
  });

  await check('E3 非法 kind / 非对象 / 未登记 ticket → false', async () => {
    const { core } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    eq(core.recordEvent(ticketId, { kind: 'Tower Floor', sourceMode: 'commission' }), false, 'bad kind');
    eq(core.recordEvent(ticketId, { kind: '', sourceMode: 'commission' }), false, 'empty kind');
    eq(core.recordEvent(ticketId, null), false, 'null event');
    eq(core.recordEvent('commission-unknown', { kind: 'tower.floor_stable', sourceMode: 'commission' }), false, 'unknown ticket');
    eq(core.getState().bufferCount, 0, 'buffer 应为空');
    return 'rejected';
  });

  await check('E4 payload 只保留标量（丢弃对象/函数），保留数字与布尔', async () => {
    const { core } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    core.recordEvent(ticketId, {
      kind: 'tower.floor_stable',
      payload: { floor: 3, perfect: true, nested: { a: 1 }, fn: function noop() {}, text: 'ok' },
      seq: 1,
      sourceMode: 'commission',
      at: NOW,
    });
    const payload = core.getState().events[0].payload;
    eq(payload, { floor: 3, perfect: true, text: 'ok' }, 'payload 过滤');
    return 'sanitized';
  });

  await check('E5 缓冲上限 400：超出后汇总吸收不丢弃，dropped 计数', async () => {
    const { core } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    let accepted = 0;
    for (let index = 1; index <= 401; index += 1) {
      const ok = core.recordEvent(ticketId, { kind: 'tower.floor_stable', payload: { floor: index }, seq: index, sourceMode: 'commission', at: NOW });
      if (ok) accepted += 1;
    }
    eq(accepted, 401, '接受条数（401 条被汇总吸收）');
    eq(core.getState().bufferCount, 400, 'bufferCount');
    eq(core.getState().dropped, 1, 'dropped');
    return '400 条缓冲 + 1 条 overflow 汇总';
  });

  await check('E5b overflow 汇总参与结算判定（401 条不丢）', async () => {
    const custom = JSON.parse(JSON.stringify(commissionsContent));
    const t1 = custom.commissions.find((item) => item.commissionId === 'pendulum-tower.T1');
    t1.objective = { kind: 'tower.floor_stable', atLeast: 401 };
    const { core } = scenario({ content: false });
    const configured = core.configure({ content: custom });
    assert(configured.ok === true, 'configure');
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    for (let index = 1; index <= 401; index += 1) {
      core.recordEvent(ticketId, { kind: 'tower.floor_stable', payload: { floor: index }, seq: index, sourceMode: 'commission', at: NOW });
    }
    const settled = await core.settle({ ticketId, outcome: 'won', stats: {} });
    eq(settled.ok, true, 'settle（401 条含 1 条 overflow 汇总）');
    return 'observed>=401';
  });

  await check('E5d overflow 上下文分组：storm 与 blockade 不互相覆盖', async () => {
    const custom = JSON.parse(JSON.stringify(commissionsContent));
    const t1 = custom.commissions.find((item) => item.commissionId === 'pendulum-tower.T1');
    t1.objective = { kind: 'boss.defeated', atLeast: 1, context: { theme: 'storm' } };
    t1.gameId = 'star-raid';
    const { core } = scenario({ content: false });
    assert(core.configure({ content: custom }).ok === true, 'configure');
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    for (let i = 0; i < 401; i += 1) {
      core.recordEvent(ticketId, { kind: 'wave.completed', payload: { wave: i }, seq: i + 1, sourceMode: 'commission', at: NOW });
    }
    core.recordEvent(ticketId, { kind: 'boss.defeated', payload: { theme: 'storm', level: 1 }, seq: 500, sourceMode: 'commission', at: NOW });
    core.recordEvent(ticketId, { kind: 'boss.defeated', payload: { theme: 'blockade', level: 1 }, seq: 501, sourceMode: 'commission', at: NOW });
    const settled = await core.settle({ ticketId, outcome: 'won', stats: {} });
    if (!settled || settled.ok !== true) console.log('E5D DEBUG', JSON.stringify(settled));
    eq(settled.ok, true, 'settle（storm 上下文保留）');
    return 'context groups';
  });

  await check('E5c overflow 最大值参与 minValue（长局 1024 不被丢弃）', async () => {
    const custom = JSON.parse(JSON.stringify(commissionsContent));
    const t1 = custom.commissions.find((item) => item.commissionId === 'pendulum-tower.T1');
    t1.objective = { kind: 'tile.created', atLeast: 1, minValue: { field: 'value', value: 1024 } };
    const { core } = scenario({ content: false });
    assert(core.configure({ content: custom }).ok === true, 'configure');
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    for (let index = 1; index <= 450; index += 1) {
      core.recordEvent(ticketId, { kind: 'tile.created', payload: { value: index < 450 ? 2 * (index % 256) : 1024 }, seq: index, sourceMode: 'commission', at: NOW });
    }
    const settled = await core.settle({ ticketId, outcome: 'won', stats: {} });
    eq(settled.ok, true, 'settle（overflow 最大值 1024）');
    return 'minValue=1024';
  });

  await check('E6 事件缓冲按 run 隔离，且不跨实例共享', async () => {
    const { core } = scenario();
    const ticketA = await startTicket(core, 'pendulum-tower.T1');
    const ticketB = await startTicket(core, 'star-raid.T1');
    towerEvents(2, ticketA, core);
    eq(core.getState(ticketA).bufferCount, 2, 'A');
    eq(core.getState(ticketB).bufferCount, 0, 'B');
    const other = scenario();
    eq(other.core.recordEvent(ticketA, { kind: 'tower.floor_stable', sourceMode: 'commission' }), false, '跨实例');
    return 'isolated';
  });
}

/* ------------------------------------------------------------------ *
 * F. markActive
 * ------------------------------------------------------------------ */

async function groupF() {
  await check('F1 issued → active，写 startedAt', async () => {
    const { core, db } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    const active = await core.markActive(ticketId);
    eq(active, true, 'result');
    eq(db.state.runs[ticketId].status, 'active', 'status');
    eq(db.state.runs[ticketId].startedAt, NOW, 'startedAt');
    return 'active';
  });

  await check('F2 已 active 再次 markActive 不重复写库', async () => {
    const { core, db } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    await core.markActive(ticketId);
    const writes = db.count('updateRun');
    const again = await core.markActive(ticketId);
    eq(again, true, 'result');
    eq(db.count('updateRun'), writes, '不应再次写入');
    return 'idempotent';
  });

  await check('F3 已结算的 run 不会被 markActive 覆盖回 active', async () => {
    const { core, db } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    towerEvents(4, ticketId, core);
    assert((await core.settle({ ticketId, outcome: 'won', stats: {} })).ok === true, 'settle');
    const result = await core.markActive(ticketId);
    eq(result, false, 'result');
    eq(db.state.runs[ticketId].status, 'claimed', 'status 仍 claimed');
    return 'guarded';
  });

  await check('F4 未知 ticket → false（不抛）', async () => {
    const { core } = scenario();
    eq(await core.markActive('commission-unknown'), false, 'unknown');
    eq(await core.markActive(null), false, 'null');
    return 'false';
  });
}

/* ------------------------------------------------------------------ *
 * G. settle（目标判定 / 上下文 / 重复 / repeat salary / DB 失败）
 * ------------------------------------------------------------------ */

async function groupG() {
  await check('G1 层塔 3 层 → objective-not-met，无 claim、无奖励、run=failed', async () => {
    const { core, db } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    towerEvents(3, ticketId, core);
    const result = await core.settle({ ticketId, outcome: 'lost', stats: { floor: 3 } });
    assert(result.ok === false, 'ok 应 false');
    eq(result.reason, 'objective-not-met', 'reason');
    eq(result.observed, 3, 'observed');
    eq(result.objective.atLeast, 4, 'objective.atLeast');
    assert(typeof result.message === 'string' && result.message.length > 0, 'message 缺失');
    assert(db.state.claims[ticketId] === undefined, '不应有 claim');
    eq(db.state.balances[result.careerId].credits, 80, '钱包不应变化');
    eq(db.state.runs[ticketId].status, 'failed', 'run 状态');
    eq(db.state.quests.length, 0, '不应写 quest');
    return 'objective-not-met';
  });

  await check('G2 层塔 4 层 → 发奖：70 信用点 + 合金 1 + 证据/旗标 + 3 条 txId', async () => {
    const { core, db } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    towerEvents(4, ticketId, core);
    const result = await core.settle({ ticketId, outcome: 'won', stats: { floor: 4 } });
    assert(result.ok === true, 'ok：' + JSON.stringify(result));
    eq(result.duplicate, false, 'duplicate');
    eq(result.credits, 70, 'credits');
    eq(result.items, { alloy: 1 }, 'items');
    eq(result.receipt.evidence, ['E-C1-site'], 'evidence');
    eq(result.receipt.flags, ['C1.work_done'], 'flags');
    eq(result.receipt.txIds, ['tx:' + ticketId + ':1', 'tx:' + ticketId + ':2', 'tx:' + ticketId + ':3'], 'txIds');
    eq(db.state.balances[result.careerId].credits, 150, '钱包 80+70');
    eq(db.state.inventory[result.careerId], { alloy: 1 }, '库存');
    eq(db.state.quests.length, 1, 'quest');
    eq(db.state.quests[0].status, 'cleared', 'quest status');
    eq(db.state.runs[ticketId].status, 'claimed', 'run 状态');
    return 'credits=70 items=alloy1';
  });

  await check('G3 重复结算 → 原收据、duplicate:true、钱包只加一次', async () => {
    const { core, db } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    towerEvents(4, ticketId, core);
    const first = await core.settle({ ticketId, outcome: 'won', stats: {} });
    assert(first.ok === true, 'first');
    const claimsBefore = Object.keys(db.state.claims).length;
    const second = await core.settle({ ticketId, outcome: 'won', stats: {} });
    assert(second.ok === true, 'second ok');
    eq(second.duplicate, true, 'duplicate');
    eq(second.receipt, first.receipt, '收据一致');
    eq(db.state.balances[first.careerId].credits, 150, '钱包仍是 150');
    eq(Object.keys(db.state.claims).length, claimsBefore, 'claims 数量');
    /* 已结算的 run 直接读原 claim 收据，不再向 DB 提交第二次领奖事务（零增量）。 */
    eq(db.count('settleAndClaim'), 1, 'settleAndClaim 只调用 1 次');
    return 'duplicate receipt';
  });

  await check('G4 星海 context {level:1} 匹配 → 90 信用点', async () => {
    const { core, db } = scenario();
    const ticketId = await startTicket(core, 'star-raid.T1');
    bossEvent(core, ticketId, { level: 1, theme: 'nebula' });
    const result = await core.settle({ ticketId, outcome: 'won', stats: {} });
    assert(result.ok === true, 'ok：' + JSON.stringify(result));
    eq(result.credits, 90, 'credits');
    eq(result.items, { alloy: 1 }, 'items');
    eq(db.state.balances[result.careerId].credits, 170, '钱包');
    return 'level 1 match';
  });

  await check('G5 星海 context {level:1} 不匹配（事件 level:2）→ context-mismatch、不发奖', async () => {
    const { core, db } = scenario();
    const ticketId = await startTicket(core, 'star-raid.T1');
    bossEvent(core, ticketId, { level: 2 });
    const result = await core.settle({ ticketId, outcome: 'won', stats: {} });
    assert(result.ok === false, 'ok 应 false');
    eq(result.reason, 'context-mismatch', 'reason');
    eq(result.observed, 1, 'observed');
    eq(db.state.claims[ticketId], undefined, '不应 claim');
    eq(db.state.balances[result.careerId].credits, 80, '钱包不变');
    return 'context-mismatch';
  });

  await check('G6 星海 T2（level 3 + theme storm）→ objectiveBonus 15 → 145 信用点 + 2 材料', async () => {
    const { core, db } = scenario();
    const t1 = await startTicket(core, 'star-raid.T1');
    bossEvent(core, t1, { level: 1 });
    assert((await core.settle({ ticketId: t1, outcome: 'won', stats: {} })).ok === true, 'T1 settle');
    const t2 = await core.start({ commissionId: 'star-raid.T2' });
    assert(t2.ok === true, 'T2 start：' + JSON.stringify(t2));
    eq(t2.ticket.startParams, { startLevel: 3, themeId: 'storm' }, 'T2 startParams');
    bossEvent(core, t2.ticketId, { level: 3, theme: 'storm' });
    const result = await core.settle({ ticketId: t2.ticketId, outcome: 'won', stats: { level: 3 } });
    assert(result.ok === true, 'T2 settle：' + JSON.stringify(result));
    eq(result.credits, 145, 'credits 130+15');
    eq(result.items, { alloy: 2, crystal: 1 }, 'items');
    eq(db.state.balances[result.careerId].credits, 80 + 90 + 145, '钱包累计');
    return 'credits=145';
  });

  await check('G7 repeat salary：同一委托第二趟只发 25（无物品/证据）', async () => {
    const { core, db } = scenario();
    const first = await startTicket(core, 'pendulum-tower.T1');
    towerEvents(4, first, core);
    assert((await core.settle({ ticketId: first, outcome: 'won', stats: {} })).ok === true, '首单');
    const second = await startTicket(core, 'pendulum-tower.T1');
    towerEvents(4, second, core);
    const result = await core.settle({ ticketId: second, outcome: 'won', stats: {} });
    assert(result.ok === true, '第二趟：' + JSON.stringify(result));
    eq(result.repeat, true, 'repeat');
    eq(result.credits, 25, 'repeatSalaryCredits');
    eq(result.items, {}, '无物品');
    eq(result.receipt.evidence, [], '无证据');
    eq(result.receipt.flags, [], '无旗标');
    eq(db.state.balances[result.careerId].credits, 80 + 70 + 25, '钱包');
    return 'salary=25';
  });

  await check('G8 空缓冲 + 只给 stats → 不伪造事件，objective-not-met(observed 0)', async () => {
    const { core, db } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    const result = await core.settle({ ticketId, outcome: 'won', stats: { floor: 9, 'tower.floor_stable': 9 } });
    assert(result.ok === false, 'ok 应 false');
    eq(result.reason, 'objective-not-met', 'reason');
    eq(result.observed, 0, 'observed 不来自 stats');
    eq(db.state.claims[ticketId], undefined, '不应发奖');
    return 'no fabrication';
  });

  await check('G9 settleAndClaim 注入失败 → 结构化失败、不标 failed、可重试成功', async () => {
    const { core, db } = scenario({ dbOptions: { failures: { settleAndClaim: 1 } } });
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    towerEvents(4, ticketId, core);
    const failed = await core.settle({ ticketId, outcome: 'won', stats: {} });
    assert(failed.ok === false, 'ok 应 false');
    eq(failed.reason, 'injected-settle-claim', 'reason');
    eq(failed.retryable, true, 'retryable');
    eq(db.state.claims[ticketId], undefined, '不应 claim');
    eq(db.state.balances[Object.keys(db.state.balances)[0]].credits, 80, '钱包不变');
    eq(db.state.runs[ticketId].status, 'issued', 'run 不应标 failed');
    db.state.failures.settleAndClaim = 0;
    const retried = await core.settle({ ticketId, outcome: 'won', stats: {} });
    assert(retried.ok === true, '重试应成功：' + JSON.stringify(retried));
    eq(retried.credits, 70, 'credits');
    return 'retry ok';
  });

  await check('G10 未知 / 非法 ticketId → no-run；lastResult 记录最近结果', async () => {
    const { core } = scenario();
    const unknown = await core.settle({ ticketId: 'commission-unknown', outcome: 'won', stats: {} });
    eq(unknown.reason, 'no-run', 'unknown');
    const invalid = await core.settle({ ticketId: null });
    eq(invalid.reason, 'no-run', 'invalid');
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    towerEvents(4, ticketId, core);
    const settled = await core.settle({ ticketId, outcome: 'won', stats: {} });
    eq(core.getState(ticketId).lastResult.ok, true, 'lastResult');
    eq(core.getState(ticketId).lastResult.credits, settled.credits, 'lastResult credits');
    return 'lastResult ok';
  });

  await check('G11 已 abandon 的 run 结算 → abandoned，无奖励', async () => {
    const { core, db } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    towerEvents(4, ticketId, core);
    assert((await core.abandon(ticketId)).ok === true, 'abandon');
    const result = await core.settle({ ticketId, outcome: 'won', stats: {} });
    eq(result.ok, false, 'ok');
    eq(result.reason, 'abandoned', 'reason');
    eq(db.state.claims[ticketId], undefined, '不应 claim');
    eq(db.state.balances[Object.keys(db.state.balances)[0]].credits, 80, '钱包不变');
    return 'abandoned';
  });

  await check('G12 结算成功后清 sessionStorage ticket（同页可交下一单）', async () => {
    const { core, storage } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    towerEvents(4, ticketId, core);
    assert(storage.getItem(TICKET_KEY) !== null, '结算前应有 ticket');
    assert((await core.settle({ ticketId, outcome: 'won', stats: {} })).ok === true, 'settle');
    eq(storage.getItem(TICKET_KEY), null, '结算后应清空');
    return 'cleared';
  });

  await check('G13 settle 传给 settleAndClaim 的 receipt 只含 commissionId（规避 career-db expected.runId 缺陷）', async () => {
    const { core, db } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    towerEvents(4, ticketId, core);
    assert((await core.settle({ ticketId, outcome: 'won', stats: {} })).ok === true, 'settle');
    const call = db.state.calls.filter((entry) => entry.name === 'settleAndClaim').pop();
    assert(!!call, '未调用 settleAndClaim');
    const receipt = call.payload && call.payload.receipt;
    assert(receipt && typeof receipt === 'object' && !Array.isArray(receipt), 'receipt 缺失');
    eq(Object.keys(receipt), ['commissionId'], 'receipt 键');
    eq(receipt.commissionId, 'pendulum-tower.T1', 'receipt.commissionId');
    eq(call.payload.contentVersion, '0.18.0', 'contentVersion');
    eq(call.payload.nonce, db.state.runs[ticketId].nonce, 'nonce 来自 run');
    return 'receipt={commissionId}';
  });
}

/* ------------------------------------------------------------------ *
 * H. abandon
 * ------------------------------------------------------------------ */

async function groupH() {
  await check('H1 abandon：status=abandoned、不发奖、不倒扣', async () => {
    const { core, db, storage } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    const result = await core.abandon(ticketId);
    eq(result.ok, true, 'ok');
    eq(db.state.runs[ticketId].status, 'abandoned', 'status');
    eq(db.state.balances[Object.keys(db.state.balances)[0]].credits, 80, '钱包');
    eq(storage.getItem(TICKET_KEY), null, 'ticket 清理');
    eq(db.count('settleAndClaim'), 0, '不应领奖');
    return 'abandoned';
  });

  await check('H2 abandon 未知 ticket → no-run；重复 abandon 幂等', async () => {
    const { core } = scenario();
    eq((await core.abandon('commission-unknown')).reason, 'no-run', 'unknown');
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    eq((await core.abandon(ticketId)).ok, true, 'first');
    const again = await core.abandon(ticketId);
    eq(again.ok, true, 'second ok');
    eq(again.duplicate, true, 'duplicate');
    return 'idempotent';
  });

  await check('H3 已结算的 run 不能 abandon', async () => {
    const { core } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    towerEvents(4, ticketId, core);
    assert((await core.settle({ ticketId, outcome: 'won', stats: {} })).ok === true, 'settle');
    const result = await core.abandon(ticketId);
    eq(result.ok, false, 'ok');
    eq(result.reason, 'settled', 'reason');
    return 'settled';
  });
}

/* ------------------------------------------------------------------ *
 * I. 边界 / 静态 / UMD
 * ------------------------------------------------------------------ */

async function groupI() {
  await check('I1 所有公开方法对垃圾输入不抛（结构化返回）', async () => {
    const { core } = scenario();
    const calls = [
      () => core.start(undefined),
      () => core.start(null),
      () => core.start([]),
      () => core.start({ commissionId: 42 }),
      () => core.settle(null),
      () => core.abandon(undefined),
      () => core.validateTicket(5),
      () => core.listAvailable('nope'),
      () => core.markActive({}),
      () => core.getCommission(null),
      () => core.getCommissions(),
      () => core.getState(42),
      () => core.getContentVersion(),
    ];
    for (const call of calls) {
      const value = await call();
      const type = typeof value;
      assert(type === 'object' || type === 'boolean' || type === 'string', 'rettype ' + type);
    }
    eq(core.recordEvent(undefined, undefined), false, 'recordEvent');
    const configured = core.configure(undefined);
    assert(configured && Array.isArray(configured.errors), 'configure 结构');
    return 'no throw';
  });

  await check('I2 工厂隔离：两个实例内容/内容缓冲互不共享', async () => {
    const one = scenario();
    const two = scenario();
    const ticketId = await startTicket(one.core, 'pendulum-tower.T1');
    towerEvents(1, ticketId, one.core);
    eq(one.core.getState(ticketId).bufferCount, 1, 'one');
    eq(two.core.getState(ticketId).bufferCount, 0, 'two');
    two.core.configure({ content: { contentVersion: '0.18.0', commissions: [] } });
    eq(two.core.getCommissions().length, 0, 'two 内容');
    eq(one.core.getCommissions().length, 4, 'one 内容不受影响');
    return 'isolated';
  });

  await check('I3 静态边界：无 localStorage/document/fetch/indexedDB/DOM 写入', async () => {
    const source = fs.readFileSync(COMMISSION_CORE, 'utf8');
    const forbidden = [
      { pattern: /\blocalStorage\s*[.[]/, label: 'localStorage 使用' },
      { pattern: /\bdocument\s*\./, label: 'document DOM 使用' },
      { pattern: /\bfetch\s*\(/, label: 'fetch 网络' },
      { pattern: /XMLHttpRequest/, label: 'XMLHttpRequest' },
      { pattern: /\bindexedDB\b/, label: '直接使用 indexedDB' },
      { pattern: /innerHTML/, label: 'innerHTML' },
      { pattern: /WebSocket/, label: 'WebSocket' },
    ];
    const hits = forbidden.filter((item) => item.pattern.test(source)).map((item) => item.label);
    eq(hits, [], '禁止项');
    assert(source.indexOf('studiokit:arcade:career:ticket.v1') >= 0, '缺少 ticket 键');
    assert(source.indexOf("'0.18.0'") >= 0, '缺少 contentVersion 0.18.0');
    return 'clean';
  });

  await check('I4 UMD 浏览器分支：挂 window.ArcadeCareerCommission 并镜像 ArcadeCareer.commission', async () => {
    const source = fs.readFileSync(COMMISSION_CORE, 'utf8');
    const sandbox = {
      console,
      crypto: { getRandomValues: (buffer) => crypto.randomFillSync(buffer) },
      setTimeout,
      clearTimeout,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'commission-core.js' });
    const mounted = sandbox.ArcadeCareerCommission;
    assert(!!mounted, '未挂 window.ArcadeCareerCommission');
    assert(sandbox.ArcadeCareer && sandbox.ArcadeCareer.commission === mounted, '未镜像到 ArcadeCareer.commission');
    ['configure', 'getWallet', 'listAvailable', 'start', 'validateTicket', 'markActive', 'recordEvent', 'getState', 'settle', 'abandon'].forEach((name) => {
      assert(typeof mounted[name] === 'function', '缺少方法 ' + name);
    });
    assert(typeof mounted.createCommissionCore === 'function', '缺少 createCommissionCore');
    return 'window mount ok';
  });

  await check('I5 reset() 清空内容/缓冲/存储且不抛', async () => {
    const { core, storage } = scenario();
    const ticketId = await startTicket(core, 'pendulum-tower.T1');
    towerEvents(1, ticketId, core);
    const reset = core.reset();
    eq(reset.ok, true, 'ok');
    eq(core.getCommissions().length, 0, '内容已清');
    eq(core.getState().bufferCount, 0, '缓冲已清');
    eq(storage.getItem(TICKET_KEY), null, '存储已清');
    return 'reset ok';
  });

  await check('I6 getWallet：只读、careerId 缺省走生涯指针、无生涯时结构化失败', async () => {
    const { core, db } = scenario();
    const none = await core.getWallet({});
    eq(none.ok, false, 'no career ok');
    eq(none.reason, 'no-career', 'reason');
    eq(db.count('ensureCareer'), 0, '不应创建生涯');
    const listed = await core.listAvailable({ ensure: true });
    const pointerWallet = await core.getWallet({});
    eq(pointerWallet.ok, true, '指针路径 ok');
    eq(pointerWallet.careerId, listed.careerId, 'careerId');
    eq(pointerWallet.credits, 80, 'credits');
    eq(db.count('ensureCareer'), 1, 'ensureCareer 只调用 1 次');
    const explicit = await core.getWallet({ careerId: listed.careerId });
    eq(explicit.credits, 80, '显式 careerId');
    return 'read-only wallet';
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

  await groupA();
  await groupB();
  await groupC();
  await groupD();
  await groupE();
  await groupF();
  await groupG();
  await groupH();
  await groupI();

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
