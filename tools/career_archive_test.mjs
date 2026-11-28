#!/usr/bin/env node
/**
 * Arcade Life 0.21 — 生涯封存 / 完全重置 / 备份标记门禁（纯 Node + VM，无 Chrome）。
 *
 * 覆盖：
 *   CA-01 API 形状（getArchiveState / setCareerArchived / resetAllCareer / assertCareerWritable）
 *   CA-02 封存往返：标记保留全部数据、可解冻；无标记时 archived:false
 *   CA-03 完全重置：单事务清空 11 stores（含 archive 与 discovery-generation），经典 localStorage 零触碰
 *   CA-04 事务内 guard：封存时常用写方法 abort 且零写入（不半提交）
 *   CA-05 备份携带封存标记 / replace 以文件为准 / 旧档无标记兼容
 *   CA-06 settings 确认门：封存二次确认、完全重置输入「重置生涯」、失败提示不静默、特性缺失时隐藏
 *   CA-07 静态边界：不删 discovery-generation 来“封存”、不调用 deleteDatabase 做生产重置
 *
 * 零 npm 依赖：内存 IndexedDB 桩 + Node vm 加载真实 career-db.js / backup.js / settings.js。
 * 不启动 Chrome、不写仓库文件。
 * 运行：node tools/career_archive_test.mjs
 * 退出码：0 全通过；1 有失败；2 装配失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const CAREER = path.join(REPO, 'apps', 'arcade', 'career');
const DB_SRC = path.join(CAREER, 'career-db.js');
const BACKUP_SRC = path.join(CAREER, 'backup.js');
const CORE_SRC = path.join(CAREER, 'career-core.js');
const SETTINGS_SRC = path.join(CAREER, 'ui', 'settings.js');

const require = createRequire(import.meta.url);
const core = require(CORE_SRC);
const dbSource = fs.readFileSync(DB_SRC, 'utf8');
const backupSource = fs.readFileSync(BACKUP_SRC, 'utf8');
const settingsSource = fs.readFileSync(SETTINGS_SRC, 'utf8');

let total = 0;
let passed = 0;
const failures = [];
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(a, b, label) {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error((label ? label + ': ' : '') + 'expected ' + y + ' got ' + x);
}
function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
async function check(name, fn) {
  total += 1;
  try {
    const info = await fn();
    passed += 1;
    console.log('PASS  ' + name + (info ? ' — ' + info : ''));
  } catch (err) {
    failures.push(name + ': ' + (err && err.message ? err.message : String(err)));
    console.log('FAIL  ' + name + ' — ' + (err && err.message ? err.message : String(err)));
  }
}

/* ------------------------------------------------------------------ *
 * 最小内存 IndexedDB 桩（只覆盖 career-db.js 用到的 API）
 * ------------------------------------------------------------------ */

function keyOf(keyPath, row) {
  if (Array.isArray(keyPath)) return keyPath.map((field) => row[field]);
  return row[keyPath];
}
function keyId(key) {
  return Array.isArray(key) ? key.map((part) => String(part)).join('\u0000') : String(key);
}

function createFakeIndexedDB() {
  const databases = new Map();
  function open(name, version) {
    const request = {};
    const db = databases.get(name) || { name, version: 0, stores: new Map(), objectStoreNames: { contains: (n) => db.stores.has(n) }, onversionchange: null, onclose: null, close() {} };
    const txForUpgrade = {
      objectStore(name2) {
        return upgradeStore(db.stores.get(name2));
      },
    };
    function upgradeStore(store) {
      return { indexNames: { contains: () => true }, createIndex() {} };
    }
    db.createObjectStore = (n, opts) => {
      const store = { keyPath: opts.keyPath, rows: new Map(), indexes: [] };
      db.stores.set(n, store);
      return upgradeStore(store);
    };
    db.transaction = (names, mode) => transaction(db, names, mode);
    databases.set(name, db);
    request.result = db;
    queueMicrotask(() => {
      if (db.version < version) {
        db.version = version;
        if (typeof request.onupgradeneeded === 'function') request.onupgradeneeded({ result: db, transaction: txForUpgrade });
      }
      if (typeof request.onsuccess === 'function') request.onsuccess({ target: request });
    });
    return request;
  }

  function req(value) {
    const r = { result: value, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => { if (typeof r.onsuccess === 'function') r.onsuccess({ target: r }); });
    return r;
  }

  function transaction(db, names, mode) {
    const tx = { error: null, oncomplete: null, onabort: null, onerror: null, aborted: false, pending: 0, settled: false };
    const stores = new Map();
    names.forEach((name) => {
      const def = db.stores.get(name);
      if (!def) return;
      stores.set(name, def);
    });
    function track(run) {
      if (tx.aborted) return req(undefined);
      tx.pending += 1;
      const r = { result: undefined, error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        if (tx.aborted) { tx.pending -= 1; maybeComplete(); return; }
        try {
          r.result = run();
          if (typeof r.onsuccess === 'function') r.onsuccess({ target: r });
        } catch (err) {
          r.error = err;
          tx.error = err;
          if (typeof r.onerror === 'function') r.onerror({ target: r, preventDefault() {} });
        }
        tx.pending -= 1;
        maybeComplete();
      });
      return r;
    }
    function maybeComplete() {
      if (tx.settled || tx.aborted || tx.pending > 0) return;
      tx.settled = true;
      if (typeof tx.oncomplete === 'function') tx.oncomplete({ target: tx });
    }
    tx.abort = () => {
      if (tx.settled) return;
      tx.aborted = true;
      tx.settled = true;
      if (typeof tx.onabort === 'function') tx.onabort({ target: tx });
    };
    tx.objectStore = (name) => {
      const def = stores.get(name);
      if (!def) throw new Error('store-not-in-tx:' + name);
      return {
        get: (key) => track(() => {
          const row = def.rows.get(keyId(key));
          return row === undefined ? undefined : clone(row);
        }),
        getAll: () => track(() => Array.from(def.rows.values()).map(clone)),
        count: () => track(() => def.rows.size),
        put: (row) => track(() => {
          def.rows.set(keyId(keyOf(def.keyPath, row)), clone(row));
          return keyOf(def.keyPath, row);
        }),
        add: (row) => track(() => {
          const id = keyId(keyOf(def.keyPath, row));
          if (def.rows.has(id)) throw Object.assign(new Error('duplicate'), { name: 'ConstraintError' });
          def.rows.set(id, clone(row));
          return keyOf(def.keyPath, row);
        }),
        delete: (key) => track(() => { def.rows.delete(keyId(key)); return undefined; }),
        clear: () => track(() => { def.rows.clear(); return undefined; }),
      };
    };
    /* txRun 绑定 body 后立即返回；首个请求由 microtask 驱动。 */
    queueMicrotask(maybeComplete);
    return tx;
  }
  return { open, _databases: databases };
}

function loadDb(fakeIdb, extraGlobals) {
  const sandbox = {
    module: { exports: {} },
    require: (name) => {
      if (name === './career-core.js') return core;
      throw new Error('unexpected require:' + name);
    },
    indexedDB: fakeIdb,
    Date, JSON, Math, Number, Object, Array, String, Boolean, Promise, setTimeout, clearTimeout, queueMicrotask, Error,
  };
  Object.assign(sandbox, extraGlobals || {});
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(dbSource, sandbox, { filename: 'career-db.js' });
  return sandbox.module.exports;
}

/* settings.js 的最小 DOM 桩（沿用 career_mailbox_flow_test.mjs 的轻量做法） */
class StubNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.className = '';
    this._text = '';
    this.children = [];
    this.parentNode = null;
    this.hidden = false;
    this.disabled = false;
    this.hiddenSet = false;
    this.id = '';
    this.type = '';
    this.value = '';
    this.style = {};
    this._attrs = Object.create(null);
    this._listeners = Object.create(null);
    this._doc = null;
    this.isConnected = false;
    const self = this;
    this.classList = {
      add(n) { const p = String(self.className).split(/\s+/).filter(Boolean); if (p.indexOf(n) < 0) p.push(n); self.className = p.join(' '); },
      remove(n) { self.className = String(self.className).split(/\s+/).filter((p) => p && p !== n).join(' '); },
      contains(n) { return String(self.className).split(/\s+/).indexOf(n) >= 0; },
    };
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = v === null || v === undefined ? '' : String(v); this.children = []; }
  setAttribute(n, v) { this._attrs[n] = String(v); }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null; }
  removeAttribute(n) { delete this._attrs[n]; }
  hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n); }
  appendChild(node) {
    if (node.parentNode && node.parentNode.children) {
      const i = node.parentNode.children.indexOf(node);
      if (i >= 0) node.parentNode.children.splice(i, 1);
    }
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) this.children.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { const l = this._listeners[type] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  dispatch(type, event) {
    const ev = Object.assign({ target: this, preventDefault() {} }, event || {});
    (this._listeners[type] || []).slice().forEach((fn) => fn(ev));
  }
  focus() { if (this._doc) this._doc.activeElement = this; }
  getClientRects() { return this.hidden ? [] : [{ width: 100, height: 48 }]; }
  closest(sel) {
    let node = this;
    while (node) {
      if (node.hasAttribute(sel.replace(/^\[/, '').replace(/\]$/, ''))) return node;
      node = node.parentNode;
    }
    return null;
  }
  querySelectorAll(selector) {
    const out = [];
    const byAttr = /^\[([^\]=]+)(?:="([^"]*)")?\]$/.exec(selector);
    const byClass = /^\.([\w-]+)$/.exec(selector);
    const walk = (node) => node.children.forEach((child) => {
      if (byAttr && child.hasAttribute && child.hasAttribute(byAttr[1]) && (byAttr[2] === undefined || child.getAttribute(byAttr[1]) === byAttr[2])) out.push(child);
      else if (byClass && typeof child.className === 'string' && child.className.split(/\s+/).indexOf(byClass[1]) >= 0) out.push(child);
      else if (!byAttr && !byClass && child.tagName === selector.toUpperCase()) out.push(child);
      walk(child);
    });
    walk(this);
    return out;
  }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
}
class StubDoc {
  constructor() {
    this.body = new StubNode('body');
    this.body._doc = this;
    this.body.isConnected = true;
    this.activeElement = null;
    this._listeners = Object.create(null);
  }
  createElement(tag) { const n = new StubNode(tag); n._doc = this; return n; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { const l = this._listeners[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  dispatch(t, e) { (this._listeners[t] || []).slice().forEach((fn) => fn(Object.assign({ preventDefault() {} }, e || {}))); }
}
function loadSettings(doc, ctx, win) {
  const sandbox = { document: doc, console, Promise, Object, Array, String, Boolean, JSON, Math, Date, RegExp, Error, setTimeout, clearTimeout };
  sandbox.window = win || sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(settingsSource, sandbox, { filename: 'settings.js' });
  return sandbox.ArcadeCareerUI.settings;
}
function findByData(root, action) {
  return root.querySelectorAll('[data-action]').find((n) => n.getAttribute('data-action') === action) || null;
}
function allNodes(root) {
  const out = [];
  const walk = (n) => n.children.forEach((c) => { out.push(c); walk(c); });
  walk(root);
  return out;
}

/* ------------------------------------------------------------------ *
 * 用例
 * ------------------------------------------------------------------ */

const ARCHIVE_KEY = 'career-archive';
let db = null;
let fakeIdb = null;

await check('CA-01 API 面：封存/重置/守卫 API 均为函数且不新增 store', () => {
  fakeIdb = createFakeIndexedDB();
  db = loadDb(fakeIdb);
  ['getArchiveState', 'setCareerArchived', 'resetAllCareer', 'assertCareerWritable', 'getState', 'exportAll', 'importAll'].forEach((name) => assert(typeof db[name] === 'function', '缺少 API ' + name));
  eq(db.STATE_KEY_CAREER_ARCHIVE, ARCHIVE_KEY, 'archive key');
  eq(db.STORES.length, 11, 'stores 数量');
  assert(db.STORES.indexOf('career-archive') < 0, '不得新增 store');
  assert(db.STATE_KEY_CAREER_ARCHIVE === 'career-archive', '标记必须是 state 行');
  return db.STORES.length + ' stores / state 行';
});

await check('CA-02 封存往返：写入标记后整库保留，解冻后标记删除且代次推进', async () => {
  const initial = await db.getArchiveState();
  eq(initial, { ok: true, archived: false, careerId: null, archivedAt: null }, '初始状态');
  const ensured = await db.ensureCareer({ originGameId: 'memory-flip', now: '2026-11-26T00:00:00.000Z' });
  assert(ensured.ok && ensured.created, 'ensureCareer: ' + JSON.stringify(ensured));
  await db.saveDiscoveryState({ stage: 'GLIMPSED', hintsEnabled: true, clues: { 'CL-memory-flip': { sourceGame: 'memory-flip' } } }, { generation: 0 });
  const before = await db.exportAll();
  assert(before.ok, 'exportAll before');

  const frozen = await db.setCareerArchived(true, { careerId: ensured.careerId, now: '2026-11-26T01:00:00.000Z' });
  eq(frozen, { ok: true, archived: true, careerId: ensured.careerId, generation: 0 }, '封存返回');
  const state = await db.getArchiveState();
  eq(state, { ok: true, archived: true, careerId: ensured.careerId, archivedAt: '2026-11-26T01:00:00.000Z' }, '封存状态');
  const after = await db.exportAll();
  assert(after.ok, 'exportAll after');
  eq(after.payload.state.filter((r) => r.key === 'career-archive').length, 1, 'archive 标记行');
  eq(after.payload.profiles.length, before.payload.profiles.length, 'profiles 保留');
  eq(after.payload.balances.length, before.payload.balances.length, 'balances 保留');
  eq(after.payload.discovery.length, before.payload.discovery.length, 'discovery 保留');
  const genDuringFreeze = await db.getDiscoveryGeneration();
  assert(genDuringFreeze.ok && genDuringFreeze.generation === 0, 'discovery-generation 保留（不得删除来封存）: ' + JSON.stringify(genDuringFreeze));

  const thawed = await db.setCareerArchived(false, { now: '2026-11-26T02:00:00.000Z' });
  eq(thawed, { ok: true, archived: false, careerId: ensured.careerId, generation: 1 }, '解冻返回');
  eq(await db.getArchiveState(), { ok: true, archived: false, careerId: null, archivedAt: null }, '解冻状态');
  const gen = await db.getDiscoveryGeneration();
  assert(gen.ok && gen.generation === 1, '解冻代次应推进: ' + JSON.stringify(gen));
  return 'frozen/thawed generation=' + thawed.generation;
});

await check('CA-03 事务内 guard：封存后 createRun/putQuests/settle/购买全 abort 且零写入', async () => {
  const ensured = await db.getProfile((await db.getState('career')).careerId);
  assert(ensured, 'profile 缺失');
  await db.setCareerArchived(true, { careerId: ensured.careerId, now: '2026-11-26T03:00:00.000Z' });
  const before = await db.exportAll();
  const runId = core.newId('run');
  const results = {
    createRun: await db.createRun({ runId, careerId: ensured.careerId, gameId: 'memory-flip', nonce: 'n1', mode: 'commission' }),
    putQuests: await db.putQuests(ensured.careerId, [{ nodeId: 'story:C0.port_seen', status: 'active' }]),
    updateRun: await db.updateRun('run-none', { status: 'claimed' }),
    purchase: await db.purchase({ careerId: ensured.careerId, purchaseId: 'P-guard', cost: 1, grants: {} }),
    writeEquipment: await db.writeEquipment({ careerId: ensured.careerId, patch: { 'module:x:level': 1 } }),
    mergeDiscovery: await db.mergeDiscoveryState({ stage: 'LOCAL', clues: {} }, [], { action: { type: 'RUN_ENDED' } }),
  };
  Object.keys(results).forEach((name) => {
    const r = results[name];
    assert(!r || r.ok === false, name + ' 未拒绝: ' + JSON.stringify(r));
    const reason = r && (r.reason || r.error);
    assert(String(reason).indexOf('career-archived') >= 0, name + ' 原因非 career-archived: ' + JSON.stringify(r));
  });
  const after = await db.exportAll();
  const strip = (p) => { const c = clone(p); delete c.exportedAt; return c; };
  eq(strip(after.payload), strip(before.payload), '封存写入后整库逐字节不变（零半提交）');
  return Object.keys(results).join(',');
});

await check('CA-04 只读 API 在封存下可读；assertCareerWritable 是同步 helper', async () => {
  const state = await db.getArchiveState();
  assert(state.archived, '仍应封存');
  assert(typeof db.assertCareerWritable === 'function', '缺少 helper');
  const profile = await db.getProfile((await db.getState('career')).careerId);
  assert(profile && profile.careerId, '只读 getProfile 应仍可用');
  const wallet = await db.readWallet(profile.careerId);
  assert(wallet.ok, '只读 readWallet 应仍可用');
  return 'read-only ok';
});

await check('CA-05 resetAllCareer：单事务清空 11 stores（含 archive/generation），经典存储零触碰', async () => {
  /* 经典键用 VM 全局 localStorage 诱饵验证：DB 代码从未读/写它。 */
  await db.setCareerArchived(false, { now: '2026-11-26T04:00:00.000Z' });
  const classic = { 'studiokit:arcade:scores:v1': 'keep', 'studiokit:arcade:career:legacy': 'keep' };
  const emptyIdb = createFakeIndexedDB();
  const resetSandbox = {
    module: { exports: {} },
    require: (name) => name === './career-core.js' ? core : (() => { throw new Error(name); })(),
    indexedDB: emptyIdb,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(classic, k) ? classic[k] : null),
      setItem: (k, v) => { classic[k] = v; },
      removeItem: (k) => { delete classic[k]; },
    },
    Date, JSON, Math, Number, Object, Array, String, Boolean, Promise, setTimeout, clearTimeout, queueMicrotask, Error,
  };
  resetSandbox.globalThis = resetSandbox;
  vm.createContext(resetSandbox);
  vm.runInContext(dbSource, resetSandbox, { filename: 'career-db-reset.js' });
  const db2 = resetSandbox.module.exports;
  const ensured = await db2.ensureCareer({ originGameId: 'memory-flip', now: '2026-11-26T04:00:00.000Z' });
  assert(ensured.ok, 'ensureCareer');
  const staleRunId = core.newId('run');
  const staleRun = await db2.createRun({ runId: staleRunId, careerId: ensured.careerId, gameId: 'memory-flip', nonce: 'stale', mode: 'commission' });
  assert(staleRun.ok, 'stale run fixture');
  await db2.saveDiscoveryState({ stage: 'CURIOUS', clues: { x: { sourceGame: 'memory-flip' } } }, { generation: 0 });
  await db2.setCareerArchived(true, { careerId: ensured.careerId, now: '2026-11-26T04:01:00.000Z' });
  const reset = await db2.resetAllCareer();
  assert(reset.ok && Number.isFinite(reset.generation), 'reset 返回: ' + JSON.stringify(reset));
  eq(await db2.getArchiveState(), { ok: true, archived: false, careerId: null, archivedAt: null }, '重置后未封存');
  const emptied = await db2.exportAll();
  assert(emptied.ok, 'exportAll after reset');
  db2.STORES.forEach((name) => {
    assert(Array.isArray(emptied.payload[name]) && emptied.payload[name].length === 0, name + ' 未清空: ' + JSON.stringify(emptied.payload[name]));
  });
  assert(!emptied.payload.state.some((r) => r.key === 'discovery-generation'), 'generation 行未清空');
  const gen = await db2.getDiscoveryGeneration();
  assert(gen.ok && gen.generation === reset.generation && gen.generation >= 1, '重置后 generation: ' + JSON.stringify(gen));
  eq(classic, { 'studiokit:arcade:scores:v1': 'keep', 'studiokit:arcade:career:legacy': 'keep' }, '经典 localStorage 被修改');

  /* 完全重置后仍持有旧 careerId/runId 的标签必须被退役标记拒绝。 */
  const staleWrites = {
    createRun: await db2.createRun({ runId: core.newId('run'), careerId: ensured.careerId, gameId: 'memory-flip', nonce: 'late', mode: 'commission' }),
    putQuests: await db2.putQuests(ensured.careerId, [{ nodeId: 'story:C0.port_seen', status: 'cleared' }]),
    putProfile: await db2.putProfile({ careerId: ensured.careerId, originGameId: 'memory-flip' }),
    purchase: await db2.purchase({ careerId: ensured.careerId, purchaseId: 'P-late', cost: 1, grants: {} }),
    writeEquipment: await db2.writeEquipment({ careerId: ensured.careerId, patch: { 'module:x:level': 1 } }),
    settleEndingAndClaim: await db2.settleEndingAndClaim({ runId: staleRunId, careerId: ensured.careerId, nonce: 'late', approach: 'research', plan: { credits: 1 } }),
    repairEndingRecords: await db2.repairEndingRecords({ careerId: ensured.careerId }),
    reserveEnding: await db2.reserveEnding({ careerId: ensured.careerId, markerId: 'ending-research', ticketId: 'ticket-late', approach: 'research' }),
    reserveCommissionFirstClear: await db2.reserveCommissionFirstClear({ careerId: ensured.careerId, commissionId: 'memory-flip.T1', ticketId: 'ticket-late' }),
  };
  Object.keys(staleWrites).forEach((name) => {
    const result = staleWrites[name];
    assert(result && result.ok === false, '旧标签仍可 ' + name + ': ' + JSON.stringify(result));
    assert(String(result.reason || result.error).indexOf('career-reset') >= 0, name + ' 未返回 career-reset: ' + JSON.stringify(result));
  });
  eq(await db2.getRun(staleRunId), null, '退役 run 被旧标签更新');
  const recreated = await db2.createRun({ runId: staleRunId, careerId: ensured.careerId, gameId: 'memory-flip', nonce: 'late', mode: 'commission' });
  assert(recreated.ok === false && String(recreated.reason || recreated.error).indexOf('career-reset') >= 0, '旧 runId 未被退役守卫拒绝: ' + JSON.stringify(recreated));
  eq(await db2.getProfile(ensured.careerId), null, '退役 profile 被旧标签重建');
  const staleDiscovery = {
    saveState: await db2.saveState({ key: 'discovery', generation: 0, stage: 'RESIDENT', clues: { stale: { sourceGame: 'memory-flip' } } }),
    putDiscovery: await db2.putDiscovery([{ clueId: 'CL-stale', sourceGame: 'memory-flip' }], { generation: 0 }),
    mergeDiscoveryState: await db2.mergeDiscoveryState({ stage: 'RESIDENT', clues: { stale: { sourceGame: 'memory-flip' } } }, [], { action: { type: 'SAVE_STATE', generation: 0 } }),
  };
  Object.keys(staleDiscovery).forEach((name) => {
    const result = staleDiscovery[name];
    assert(result && result.ok === false && String(result.reason || result.error).indexOf('generation') >= 0, name + ' 未拒绝旧代次: ' + JSON.stringify(result));
  });
  assert((await db2.saveDiscoveryState({ stage: 'RESIDENT' })).reason === 'missing-generation', 'saveDiscoveryState 缺代次应拒绝');
  assert((await db2.putDiscovery([{ clueId: 'CL-no-generation', sourceGame: 'memory-flip' }])).reason === 'missing-generation', 'putDiscovery 缺代次应拒绝');
  assert((await db2.mergeDiscoveryState({ stage: 'RESIDENT' }, [], { action: { type: 'SAVE_STATE' } })).reason === 'missing-generation', 'mergeDiscoveryState 缺代次应拒绝');
  const afterStale = await db2.exportAll();
  db2.STORES.forEach((name) => {
    assert(afterStale.payload[name].length === 0, '旧标签回写污染 ' + name);
  });
  db2.close();

  /* 达到 256 个退役标记时，当前重置身份仍必须保留，不能被字典序 slice 挤掉。 */
  const limitIdb = createFakeIndexedDB();
  const limitSandbox = {
    module: { exports: {} },
    require: (name) => name === './career-core.js' ? core : (() => { throw new Error(name); })(),
    indexedDB: limitIdb,
    Date, JSON, Math, Number, Object, Array, String, Boolean, Promise, setTimeout, clearTimeout, queueMicrotask, Error,
  };
  limitSandbox.globalThis = limitSandbox;
  vm.createContext(limitSandbox);
  vm.runInContext(dbSource, limitSandbox, { filename: 'career-db-limit.js' });
  const db3 = limitSandbox.module.exports;
  const limitCareer = await db3.ensureCareer({ originGameId: 'memory-flip' });
  assert(limitCareer.ok, 'limit ensureCareer');
  const rawDb = db3.__coreTest.getDb();
  await new Promise((resolve, reject) => {
    const tx = rawDb.transaction(['state'], 'readwrite');
    for (let i = 0; i < 256; i += 1) {
      const careerId = 'career-z' + String(i).padStart(4, '0');
      tx.objectStore('state').put({ key: 'former-career:' + careerId, schemaVersion: 1, updatedAt: '2026-11-26T00:00:00.000Z', value: { careerId, retiredAt: '2026-11-26T00:00:00.000Z' } });
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  await db3.resetAllCareer();
  const lateAtLimit = await db3.createRun({ runId: core.newId('run'), careerId: limitCareer.careerId, gameId: 'memory-flip', nonce: 'limit', mode: 'commission' });
  assert(lateAtLimit.ok === false && lateAtLimit.reason === 'career-reset', '当前身份在上限场景被挤掉: ' + JSON.stringify(lateAtLimit));
  db3.close();
  return '11 stores cleared; stale writes rejected; current retirement kept at cap; generation=' + reset.generation;
});

await check('CA-06 备份往返：封存标记随 state 走，replace 以文件状态为准，旧档无标记兼容', async () => {
  const backup = require(BACKUP_SRC);
  /* export：封存行必须在 payload.state 中。 */
  const fresh = await db.ensureCareer({ originGameId: 'memory-flip', now: '2026-11-26T04:30:00.000Z' });
  assert(fresh.ok, 'CA-06 ensureCareer: ' + JSON.stringify(fresh));
  await db.saveDiscoveryState({ stage: 'CURIOUS', clues: {}, hintsEnabled: true }, { generation: (await db.getDiscoveryGeneration()).generation });
  await db.setCareerArchived(true, { careerId: fresh.careerId, now: '2026-11-26T05:00:00.000Z' });
  const exported = await backup.exportCareerLife({ db });
  assert(exported.ok, 'export: ' + JSON.stringify(exported));
  const archiveRows = exported.payload.state.filter((r) => r.key === 'career-archive');
  eq(archiveRows.length, 1, '封存行数');
  eq(backup.getArchiveStateFromPayload(exported.payload), { archived: true, careerId: archiveRows[0].value.careerId, archivedAt: '2026-11-26T05:00:00.000Z' }, '标记解析');
  const parsed = backup.parseAndValidate(exported.text);
  assert(parsed.ok, '导出自校验失败: ' + JSON.stringify(parsed));

  /* replace：未封存文件覆盖封存库 → 文件中没有 archive 行则本地变未封存。 */
  await db.setCareerArchived(false, { now: '2026-11-26T05:01:00.000Z' });
  const unarchivedText = (await backup.exportCareerLife({ db })).text;
  await db.setCareerArchived(true, { now: '2026-11-26T05:02:00.000Z' });
  const imported = await backup.importCareerLife(unarchivedText, { db, mode: 'replace' });
  assert(imported.ok, 'import replace: ' + JSON.stringify(imported));
  eq(await db.getArchiveState(), { ok: true, archived: false, careerId: null, archivedAt: null }, 'replace 应以文件状态为准');

  /* 旧档无标记：缺格式 → preserved:true 零写入。 */
  const legacy = await backup.importCareerLife(JSON.stringify({ note: 'old classic backup' }), { db, mode: 'replace' });
  assert(legacy.ok && legacy.preserved === true && legacy.mode === 'none', '旧档: ' + JSON.stringify(legacy));
  const noArchivePayload = backup.buildExportPayload({ profiles: [{ careerId: 'career-x' }], state: [] }, {});
  eq(backup.getArchiveStateFromPayload(noArchivePayload), { archived: false, careerId: null, archivedAt: null }, '无标记 payload');
  return 'marker roundtrip / replace wins / legacy preserved';
});

await check('CA-07 settings 确认门：封存需二次确认、重置需输入短语、失败有提示、缺方法隐藏', async () => {
  const calls = [];
  const doc = new StubDoc();
  const events = [];
  const ctx = {
    state: { hintsEnabled: true },
    hintsEnabled: true,
    archived: false,
    announce(text) { events.push(text); },
    setHintsEnabled() { return { ok: true, state: { hintsEnabled: true } }; },
    resetDiscovery() { calls.push('resetDiscovery'); return { ok: true }; },
    freezeCareer() { calls.push('freezeCareer'); return Promise.resolve({ ok: true, archived: true }); },
    unfreezeCareer() { calls.push('unfreezeCareer'); return Promise.resolve({ ok: true, archived: false }); },
    resetAllCareer() { calls.push('resetAllCareer'); return Promise.resolve({ ok: true }); },
    backup: {
      exportCareerLife() { calls.push('export'); return Promise.resolve({ ok: true, filename: 'a.json', text: '{}' }); },
      importCareerLife() { calls.push('import'); return Promise.resolve({ ok: true }); },
    },
  };
  const api = loadSettings(doc, ctx);
  const sheet = api.open(ctx);
  assert(sheet, '面板未打开');
  const freezeBtn = findByData(sheet, 'freeze-career');
  const resetBtn = findByData(sheet, 'reset-all-career');
  const unfreezeBtn = findByData(sheet, 'unfreeze-career');
  assert(freezeBtn && resetBtn, '封存/重置按钮缺失');
  assert(unfreezeBtn.hidden === true, '未封存时解冻应隐藏，实际 hidden=' + unfreezeBtn.hidden);

  /* 封存：点击按钮只出确认，不调用；未确认不写。 */
  freezeBtn.dispatch('click', {});
  assert(calls.indexOf('freezeCareer') < 0, '未二次确认就调用 freezeCareer');
  const confirmBoxes = allNodes(sheet).filter((n) => n.className && n.className.indexOf('ac-career-confirm') >= 0 && !n.hidden);
  assert(confirmBoxes.length >= 1, '确认框未显示');
  const confirmFreeze = allNodes(sheet).find((n) => n.textContent === '确认封存' && n.tagName === 'BUTTON');
  assert(confirmFreeze, '确认封存按钮缺失');
  confirmFreeze.dispatch('click', {});
  await Promise.resolve(); await Promise.resolve();
  assert(calls.indexOf('freezeCareer') >= 0, '确认后未调用 freezeCareer');
  assert(unfreezeBtn.hidden === false, '封存后解冻按钮应可见');

  /* 完全重置：首次点击只出输入框；短语不符不调用。 */
  resetBtn.dispatch('click', {});
  const input = allNodes(sheet).find((n) => n.tagName === 'INPUT' && n.className.indexOf('reset-input') >= 0);
  assert(input, '重置输入框缺失');
  const confirmReset = allNodes(sheet).find((n) => n.tagName === 'BUTTON' && n.textContent === '确认完全重置');
  assert(confirmReset, '确认重置按钮缺失');
  confirmReset.dispatch('click', {});
  await Promise.resolve(); await Promise.resolve();
  assert(calls.indexOf('resetAllCareer') < 0, '短语为空却调用了 resetAllCareer');
  const status = allNodes(sheet).filter((n) => n.className.indexOf('ac-career-archive-status') >= 0 && !n.hidden).map((n) => n.textContent).join('|');
  assert(status.indexOf('重置生涯') >= 0, '短语错误无提示: ' + status);
  input.value = '重置生涯';
  confirmReset.dispatch('click', {});
  await Promise.resolve(); await Promise.resolve();
  assert(calls.indexOf('resetAllCareer') >= 0, '短语正确仍未调用 resetAllCareer');

  /* 失败不静默：方法返回 ok:false 时状态行+announce 均有提示。 */
  const doc2 = new StubDoc();
  const events2 = [];
  const failingCtx = Object.assign({}, ctx, {
    freezeCareer() { return Promise.resolve({ ok: false, reason: 'db-failed' }); },
    announce(text) { events2.push(text); },
  });
  const api2 = loadSettings(doc2, failingCtx);
  const sheet2 = api2.open(failingCtx);
  const freeze2 = findByData(sheet2, 'freeze-career');
  freeze2.dispatch('click', {});
  allNodes(sheet2).find((n) => n.textContent === '确认封存' && n.tagName === 'BUTTON').dispatch('click', {});
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert(events2.some((t) => t.indexOf('没有成功') >= 0), '冻结失败未播报: ' + JSON.stringify(events2));

  /* 旧 bridge（无新方法）：整块不渲染。 */
  const doc3 = new StubDoc();
  const legacyCtx = { state: { hintsEnabled: true }, announce() {}, setHintsEnabled() { return { ok: true, state: { hintsEnabled: true } }; }, resetDiscovery() { return { ok: true }; } };
  const api3 = loadSettings(doc3, legacyCtx);
  const sheet3 = api3.open(legacyCtx);
  assert(!findByData(sheet3, 'freeze-career') && !findByData(sheet3, 'reset-all-career'), '旧 bridge 不应渲染封存/重置');
  api.close(); api2.close(); api3.close();
  return 'confirm gates + failure announce + feature detection';
});

await check('CA-08 静态边界：封存不删 discovery-generation，生产重置不依赖 __coreTest/deleteDatabase', () => {
  const setFn = dbSource.slice(dbSource.indexOf('function setCareerArchived'), dbSource.indexOf('function getDiscoveryGeneration'));
  assert(!/delete\s*\(\s*STATE_KEY_DISCOVERY_GENERATION/.test(setFn), '封存路径删除了 generation');
  const resetFn = dbSource.slice(dbSource.indexOf('function resetAllCareer'), dbSource.indexOf('function exportAll'));
  assert(!/deleteDatabase|__coreTest/.test(resetFn), '重置路径使用了测试辅助');
  assert(/resetAllCareer/.test(dbSource), '缺少 resetAllCareer');
  assert(/assertCareerWritable/.test(dbSource), '缺少事务内守卫');
  assert(/career-archive/.test(backupSource), '备份源码未携带封存标记');
  return 'static clean';
});

const result = { total, passed, failed: failures.length };
if (failures.length) {
  console.error('\n' + failures.length + '/' + total + ' checks FAILED');
  process.exit(1);
}
console.log('\n' + passed + '/' + total + ' checks passed');
