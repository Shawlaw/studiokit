#!/usr/bin/env node
/**
 * T03 — 职业状态持久化 / 旧档迁移 / 封存导入兼容门禁（纯 Node + VM 内存 IDB）。
 * 只加载真实 career-core.js / profession-state.js / career-db.js / backup.js；无 Chrome、无端口、无仓库写入。
 * 运行：node tools/career_profession_db_test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CAREER = path.join(ROOT, 'apps', 'arcade', 'career');
const require = createRequire(import.meta.url);
const core = require(path.join(CAREER, 'career-core.js'));
const professionState = require(path.join(CAREER, 'profession-state.js'));
const backup = require(path.join(CAREER, 'backup.js'));
const dbSource = fs.readFileSync(path.join(CAREER, 'career-db.js'), 'utf8');
const registry = JSON.parse(fs.readFileSync(path.join(CAREER, 'content', 'registry.json'), 'utf8'));
const commissions = JSON.parse(fs.readFileSync(path.join(CAREER, 'content', 'commissions.json'), 'utf8'));
const clues = JSON.parse(fs.readFileSync(path.join(CAREER, 'content', 'clues.json'), 'utf8'));
const catalog = {
  games: registry.games,
  professions: registry.professions,
  commissions: commissions.commissions,
  clues: clues.clues,
};

const NOW = '2026-11-27T01:00:00.000Z';
const LATER = '2026-11-27T02:00:00.000Z';
const P = 'nature.miner';
const G = 'gold-miner';
const P2 = 'research.archivist';
const G2 = 'memory-flip';
const C1 = 'gold-miner.T1';
const C2 = 'memory-flip.T1';
let total = 0;
let passed = 0;
const failures = [];

function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error((label ? label + ': ' : '') + 'expected ' + e + ' got ' + a);
}
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
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
 * 可回滚内存 IndexedDB：写入先进 overlay，oncomplete 才提交；onabort 全部丢弃。
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
    const db = databases.get(name) || {
      name,
      version: 0,
      stores: new Map(),
      objectStoreNames: { contains: (n) => db.stores.has(n) },
      onversionchange: null,
      onclose: null,
      close() {},
    };
    const upgradeTx = { objectStore: (n) => ({ indexNames: { contains: () => true }, createIndex() {} }) };
    db.createObjectStore = (n, opts) => {
      const store = { keyPath: opts.keyPath, rows: new Map(), indexes: [], failPutKey: null };
      db.stores.set(n, store);
      return upgradeTx.objectStore(n);
    };
    db.transaction = (names, mode) => transaction(db, names, mode);
    databases.set(name, db);
    request.result = db;
    queueMicrotask(() => {
      if (db.version < version) {
        db.version = version;
        if (typeof request.onupgradeneeded === 'function') request.onupgradeneeded({ result: db, transaction: upgradeTx });
      }
      if (typeof request.onsuccess === 'function') request.onsuccess({ target: request });
    });
    return request;
  }
  function transaction(db, names, mode) {
    const tx = { error: null, oncomplete: null, onabort: null, onerror: null, aborted: false, pending: 0, settled: false };
    const overlays = new Map();
    names.forEach((name) => {
      overlays.set(name, { cleared: false, rows: new Map() });
    });
    const defFor = (name) => db.stores.get(name);
    const overlayFor = (name) => overlays.get(name);
    const currentRow = (name, key) => {
      const ov = overlayFor(name);
      if (ov && ov.cleared) return undefined;
      if (ov && ov.rows.has(key)) {
        const row = ov.rows.get(key);
        return row === null ? undefined : clone(row);
      }
      const def = defFor(name);
      const row = def && def.rows.get(key);
      return row === undefined ? undefined : clone(row);
    };
    function track(run) {
      if (tx.aborted) {
        const r = { result: undefined, error: null, onsuccess: null, onerror: null };
        queueMicrotask(() => { if (typeof r.onsuccess === 'function') r.onsuccess({ target: r }); });
        return r;
      }
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
      if (mode === 'readwrite') {
        overlays.forEach((ov, name) => {
          const def = defFor(name);
          if (!def) return;
          if (ov.cleared) def.rows.clear();
          ov.rows.forEach((row, key) => {
            if (row === null) def.rows.delete(key);
            else def.rows.set(key, clone(row));
          });
        });
      }
      if (typeof tx.oncomplete === 'function') tx.oncomplete({ target: tx });
    }
    tx.abort = () => {
      if (tx.settled) return;
      tx.aborted = true;
      tx.settled = true;
      overlays.clear();
      if (typeof tx.onabort === 'function') tx.onabort({ target: tx });
    };
    tx.objectStore = (name) => {
      const def = defFor(name);
      if (!def) throw new Error('store-not-in-tx:' + name);
      return {
        get: (key) => track(() => currentRow(name, keyId(key))),
        getAll: () => track(() => {
          const ov = overlayFor(name);
          if (ov && ov.cleared) return [];
          const rows = new Map();
          if (!ov || !ov.cleared) def.rows.forEach((row, key) => rows.set(key, clone(row)));
          if (ov) ov.rows.forEach((row, key) => {
            if (row === null) rows.delete(key);
            else rows.set(key, clone(row));
          });
          return Array.from(rows.values());
        }),
        count: () => track(() => {
          const ov = overlayFor(name);
          let count = ov && ov.cleared ? 0 : def.rows.size;
          if (ov) ov.rows.forEach((row, key) => {
            const before = def.rows.has(key) ? 1 : 0;
            const after = row === null ? 0 : 1;
            count += after - before;
          });
          return count;
        }),
        put: (row) => track(() => {
          const key = keyId(keyOf(def.keyPath, row));
          if (def.failPutKey === String(key)) throw Object.assign(new Error('injected-put-failure'), { name: 'ConstraintError' });
          const ov = overlayFor(name);
          ov.rows.set(key, clone(row));
          return keyOf(def.keyPath, row);
        }),
        add: (row) => track(() => {
          const key = keyId(keyOf(def.keyPath, row));
          if (currentRow(name, key) !== undefined) throw Object.assign(new Error('duplicate'), { name: 'ConstraintError' });
          overlayFor(name).rows.set(key, clone(row));
          return keyOf(def.keyPath, row);
        }),
        delete: (key) => track(() => {
          const id = keyId(key);
          if (currentRow(name, id) === undefined && !(overlayFor(name).rows.has(id))) return undefined;
          overlayFor(name).rows.set(id, null);
          return undefined;
        }),
        clear: () => track(() => {
          const ov = overlayFor(name);
          ov.cleared = true;
          ov.rows.clear();
          return undefined;
        }),
      };
    };
    queueMicrotask(maybeComplete);
    return tx;
  }
  return { open, _databases: databases };
}

function loadDb(fakeIdb, coreOverride, withProfessionState) {
  const includeProfessionState = withProfessionState !== false;
  const sandbox = {
    module: { exports: {} },
    require: (name) => {
      if (name === './career-core.js') return coreOverride || core;
      if (name === './profession-state.js') {
        if (!includeProfessionState) throw new Error('profession-state-not-loaded');
        return professionState;
      }
      throw new Error('unexpected require:' + name);
    },
    indexedDB: fakeIdb,
    Date, JSON, Math, Number, Object, Array, String, Boolean, Promise, setTimeout, clearTimeout, queueMicrotask, Error,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(dbSource, sandbox, { filename: 'career-db.js' });
  return sandbox.module.exports;
}
async function freshDb(coreOverride, withProfessionState) {
  const fakeIdb = createFakeIndexedDB();
  const db = loadDb(fakeIdb, coreOverride, withProfessionState);
  const opened = await db.open();
  assert(opened.ok, 'open fake IDB: ' + JSON.stringify(opened));
  return { fakeIdb, db };
}
function storeDef(fakeIdb, db, name) {
  return fakeIdb._databases.get(db.DB_NAME).stores.get(name);
}
function seedRow(fakeIdb, db, store, row) {
  const def = storeDef(fakeIdb, db, store);
  def.rows.set(keyId(keyOf(def.keyPath, row)), clone(row));
}
function generation(db) { return db.getDiscoveryGeneration(); }
async function readState(db) {
  const snapshot = await db.getDiscoverySnapshot();
  assert(snapshot.ok, JSON.stringify(snapshot));
  return snapshot.state;
}
async function readStateRow(db) {
  const exported = await db.exportAll();
  assert(exported.ok, JSON.stringify(exported));
  return exported.payload.state.find((row) => row.key === 'discovery') || null;
}
async function assets(db) {
  const exported = await db.exportAll();
  assert(exported.ok, JSON.stringify(exported));
  const out = {};
  ['profiles', 'balances', 'ledgers', 'runs', 'claims', 'quests', 'inventory', 'equipment'].forEach((name) => {
    out[name] = exported.payload[name];
  });
  return out;
}
function inputFor(professionId, gameId, extra) {
  return Object.assign({ professionId, gameId, catalog }, extra || {});
}
async function makeReadable(ctx, professionId, gameId, clueId) {
  const g = await ctx.db.getDiscoveryGeneration();
  const glimpsed = await ctx.db.applyProfessionEvent({
    action: 'GLIMPSED',
    input: inputFor(professionId, gameId, { clueId }),
    generation: g.generation,
    now: NOW,
  });
  assert(glimpsed.ok && glimpsed.newlyAccepted === false && glimpsed.created === false, JSON.stringify(glimpsed));
  /* 夹具固定证据时间；mergeDiscoveryState 的墙钟写会触发真实单调时间语义，不应参与固定时刻断言。 */
  const opened = await ctx.db.putDiscovery({
    clueId,
    sourceGame: gameId,
    firstSeenRunId: null,
    seenAt: NOW,
    openedAt: NOW,
    dismissed: false,
    updatedAt: NOW,
  }, { generation: g.generation });
  assert(opened.ok, JSON.stringify(opened));
  const read = await ctx.db.applyProfessionEvent({
    action: 'READ',
    input: { professionId, clueId, catalog },
    generation: g.generation,
    now: LATER,
  });
  assert(read.ok, JSON.stringify(read));
  return read;
}
function payloadWithState(stateRows, profile) {
  const at = NOW;
  return {
    format: 'studiokit-arcade-career',
    careerSchemaVersion: 1,
    contentVersion: '0.18.0',
    rulesetVersion: 1,
    exportedAt: at,
    profiles: profile ? [profile] : [],
    state: stateRows,
    discovery: [],
    runs: [],
    claims: [],
    ledgers: profile ? [{ txId: 'tx:init:' + profile.careerId + ':1', careerId: profile.careerId, step: 1, kind: 'initial-grant', credits: 80, items: {}, at, rulesetVersion: 1, contentVersion: '0.18.0' }] : [],
    balances: profile ? [{ careerId: profile.careerId, credits: 80, revision: 0, createdAt: at, updatedAt: at }] : [],
    inventory: [],
    equipment: [],
    quests: [],
    migrations: [],
  };
}
function profileRow(careerId, extra) {
  return Object.assign({ careerId, schemaVersion: 1, originGameId: null, createdAt: NOW, updatedAt: NOW, capabilities: [], flags: [], evidence: [], settings: {} }, extra || {});
}
function pointerRow(careerId) {
  return { key: 'career', schemaVersion: 1, updatedAt: NOW, value: { careerId, originGameId: null, createdAt: NOW } };
}
function discoveryRow(value) {
  return { key: 'discovery', schemaVersion: 1, updatedAt: NOW, value };
}

await check('T03-01 DB 常量 / 11 stores / contentVersion / API 冻结', async () => {
  const { db } = await freshDb();
  eq(db.DB_NAME, 'studiokit:arcade:career');
  eq(db.DB_VERSION, 1);
  eq(db.SCHEMA_VERSION, 1);
  eq(db.STORES.length, 11);
  assert(typeof db.applyProfessionEvent === 'function');
  const contentVersions = ['registry.json', 'commissions.json', 'clues.json'].map((name) => JSON.parse(fs.readFileSync(path.join(CAREER, 'content', name), 'utf8')).contentVersion);
  eq(contentVersions, ['0.18.0', '0.18.0', '0.18.0']);
  return 'IDB v1 / 11 stores / contentVersion 0.18.0';
});

await check('T03-02 GLIMPSED 只写职业扩展与真实 clue，不建立身份', async () => {
  const ctx = await freshDb();
  const result = await ctx.db.applyProfessionEvent({ action: 'GLIMPSED', input: inputFor(P, G, { clueId: 'CL-' + G }), generation: 0, now: NOW });
  assert(result.ok && result.created === false && result.newlyAccepted === false, JSON.stringify(result));
  const state = await readState(ctx.db);
  eq(state.professionProgress[P].state, 'glimpsed');
  eq(state.firstDiscoveredGameId, G);
  eq(state.acceptedOriginGameId, null);
  eq(state.activeProfessionId, null);
  eq(state.clues['CL-' + G].sourceGame, G);
  const rows = await ctx.db.listDiscovery();
  assert(rows.ok === false || rows.length === 1, JSON.stringify(rows));
  const a = await assets(ctx.db);
  eq(a.profiles, []);
  eq(a.balances, []);
  eq(a.ledgers, []);
  return 'glimpsed / no identity / no reward';
});

await check('T03-03 READ 必须有真实 opened 证据；CLUE_OPENED 后可读且不接受', async () => {
  const ctx = await freshDb();
  const denied = await ctx.db.applyProfessionEvent({ action: 'READ', input: { professionId: P, clueId: 'CL-' + G, catalog }, generation: 0, now: LATER });
  assert(!denied.ok && denied.reason === 'not-discovered', JSON.stringify(denied));
  const before = await ctx.db.applyProfessionEvent({ action: 'GLIMPSED', input: inputFor(P, G, { clueId: 'CL-' + G }), generation: 0, now: NOW });
  const opened = await ctx.db.mergeDiscoveryState({ clues: {} }, [], { action: { type: 'CLUE_OPENED', clueId: 'CL-' + G, generation: 0 } });
  assert(opened.ok, JSON.stringify(opened));
  const read = await ctx.db.applyProfessionEvent({ action: 'READ', input: { professionId: P, clueId: 'CL-' + G, catalog }, generation: 0, now: LATER });
  assert(read.ok && read.created === false && read.newlyAccepted === false, JSON.stringify(read));
  const state = await readState(ctx.db);
  eq(state.professionProgress[P].state, 'read');
  eq(state.acceptedOriginGameId, null);
  return 'read evidence required / no identity';
});

await check('T03-04 首次 ACCEPT 同事务建立 identity + 扩展 + 钱包 + 初始流水', async () => {
  const ctx = await freshDb();
  await makeReadable(ctx, P, G, 'CL-' + G);
  const beforeAssets = await assets(ctx.db);
  const accepted = await ctx.db.applyProfessionEvent({ action: 'ACCEPT_INVITATION', input: inputFor(P, G), generation: 0, now: '2026-11-27T03:00:00.000Z' });
  assert(accepted.ok && accepted.created === true && accepted.newlyAccepted === true && accepted.careerId, JSON.stringify(accepted));
  const state = await readState(ctx.db);
  eq(state.professionProgress[P].state, 'accepted');
  eq(state.activeProfessionId, P);
  eq(state.acceptedOriginGameId, G);
  eq(state.updatedAt, '2026-11-27T03:00:00.000Z');
  const afterAssets = await assets(ctx.db);
  eq(afterAssets.profiles.length, 1);
  eq(afterAssets.balances.length, 1);
  eq(afterAssets.balances[0].credits, 80);
  eq(afterAssets.ledgers.length, 1);
  eq(afterAssets.ledgers[0].kind, 'initial-grant');
  eq(afterAssets.runs, []);
  eq(afterAssets.claims, []);
  eq(afterAssets.quests, []);
  eq(beforeAssets.profiles, []);
  return 'created=true newlyAccepted=true / 80 credits / zero runs';
});

await check('T03-05 第二职业首次接受 created=false / newlyAccepted=true / 零资产增量', async () => {
  const ctx = await freshDb();
  await makeReadable(ctx, P, G, 'CL-' + G);
  const first = await ctx.db.applyProfessionEvent({ action: 'ACCEPT_INVITATION', input: inputFor(P, G), generation: 0, now: NOW });
  assert(first.ok, JSON.stringify(first));
  await makeReadable(ctx, P2, G2, 'CL-' + G2);
  const before = await assets(ctx.db);
  const second = await ctx.db.applyProfessionEvent({ action: 'ACCEPT_INVITATION', input: inputFor(P2, G2), generation: 0, now: LATER });
  assert(second.ok && second.created === false && second.newlyAccepted === true, JSON.stringify(second));
  eq(second.careerId, first.careerId);
  eq(await assets(ctx.db), before);
  const state = await readState(ctx.db);
  eq(state.acceptedOriginGameId, G);
  eq(state.activeProfessionId, P2);
  eq(Object.keys(state.professionProgress).length, 2);
  return 'same careerId / origin fixed / assets unchanged';
});

await check('T03-06 重复 ACCEPT 是严格 no-op（状态、游标、时间、资产）', async () => {
  const ctx = await freshDb();
  await makeReadable(ctx, P, G, 'CL-' + G);
  const first = await ctx.db.applyProfessionEvent({ action: 'ACCEPT_INVITATION', input: inputFor(P, G), generation: 0, now: NOW });
  assert(first.ok, JSON.stringify(first));
  const stateBefore = await readState(ctx.db);
  const assetsBefore = await assets(ctx.db);
  const duplicate = await ctx.db.applyProfessionEvent({ action: 'ACCEPT_INVITATION', input: inputFor(P, G), generation: 0, now: LATER });
  assert(duplicate.ok && duplicate.duplicate === true && duplicate.newlyAccepted === false && duplicate.created === false, JSON.stringify(duplicate));
  eq(await readState(ctx.db), stateBefore);
  eq(await assets(ctx.db), assetsBefore);
  return 'duplicate=true / zero writes';
});

await check('T03-07 stale generation 在同事务守卫并零写入', async () => {
  const ctx = await freshDb();
  await makeReadable(ctx, P, G, 'CL-' + G);
  const before = await readState(ctx.db);
  const result = await ctx.db.applyProfessionEvent({ action: 'ACCEPT_INVITATION', input: inputFor(P, G), generation: 99, now: NOW });
  assert(!result.ok && result.reason === 'stale-generation', JSON.stringify(result));
  eq(await readState(ctx.db), before);
  eq((await assets(ctx.db)).profiles, []);
  return 'stale-generation / no identity / no state';
});

await check('T03-08 封存守卫先于 reducer/身份写入，失败整事务回滚', async () => {
  const ctx = await freshDb();
  seedRow(ctx.fakeIdb, ctx.db, 'state', { key: 'career-archive', schemaVersion: 1, updatedAt: NOW, value: { careerId: null, archivedAt: NOW } });
  const result = await ctx.db.applyProfessionEvent({ action: 'ACCEPT_INVITATION', input: inputFor(P, G), generation: 0, now: NOW });
  assert(!result.ok && result.reason === 'career-archived', JSON.stringify(result));
  eq(await readState(ctx.db), null);
  eq((await assets(ctx.db)).profiles, []);
  return 'career-archived / zero half-state';
});

await check('T03-09 退役 identity 指针守卫拒绝职业写入', async () => {
  const ctx = await freshDb();
  seedRow(ctx.fakeIdb, ctx.db, 'state', pointerRow('career-retired'));
  seedRow(ctx.fakeIdb, ctx.db, 'state', { key: 'former-career:career-retired', schemaVersion: 1, updatedAt: NOW, value: { careerId: 'career-retired', retiredAt: NOW } });
  const before = await readState(ctx.db);
  const result = await ctx.db.applyProfessionEvent({ action: 'SET_PAUSED', input: { professionId: P, paused: true, catalog }, generation: 0, now: NOW });
  assert(!result.ok && result.reason === 'career-reset', JSON.stringify(result));
  eq(await readState(ctx.db), before);
  return 'career-reset / no write';
});

await check('T03-10 初始身份 add 失败时 profile/balance/ledger/pointer/extension 全回滚', async () => {
  const fixed = {
    profile: { careerId: 'career-fixed', originGameId: G, createdAt: NOW, updatedAt: NOW, capabilities: [], flags: [], evidence: [], settings: {} },
    balance: { careerId: 'career-fixed', credits: 80, revision: 0, createdAt: NOW, updatedAt: NOW },
    ledger: { txId: 'tx:init:career-fixed:1', careerId: 'career-fixed', step: 1, kind: 'initial-grant', credits: 80, items: {}, at: NOW, rulesetVersion: 1, contentVersion: '0.18.0' },
  };
  const override = Object.assign({}, core, { initialCareer: () => clone(fixed) });
  const ctx = await freshDb(override);
  await makeReadable(ctx, P, G, 'CL-' + G);
  seedRow(ctx.fakeIdb, ctx.db, 'profiles', fixed.profile);
  const before = await readState(ctx.db);
  const failed = await ctx.db.applyProfessionEvent({ action: 'ACCEPT_INVITATION', input: inputFor(P, G), generation: 0, now: LATER });
  assert(!failed.ok, JSON.stringify(failed));
  eq(await readState(ctx.db), before);
  const a = await assets(ctx.db);
  eq(a.profiles.length, 1);
  eq(a.balances, []);
  eq(a.ledgers, []);
  eq(a.profiles[0].careerId, 'career-fixed');
  return 'constraint abort / no wallet / no pointer / no accepted extension';
});

await check('T03-11 RUN_ENDED / CLUE_OPENED / SAVE_STATE / saveState 不擦职业扩展', async () => {
  const ctx = await freshDb();
  await makeReadable(ctx, P, G, 'CL-' + G);
  const accepted = await ctx.db.applyProfessionEvent({ action: 'ACCEPT_INVITATION', input: inputFor(P, G), generation: 0, now: NOW });
  assert(accepted.ok, JSON.stringify(accepted));
  await ctx.db.applyProfessionEvent({ action: 'RECORD_STORY_EVENT', input: { eventId: 'story:C0.port_seen', source: 'clue' }, generation: 0, now: NOW });
  const actions = [
    () => ctx.db.mergeDiscoveryState({ stage: 'EXPLORER', clues: {}, runs: {} }, [], { action: { type: 'RUN_ENDED', generation: 0, run: { gameId: G }, baseRuns: { [G]: { eligibleRuns: 0 } } } }),
    () => ctx.db.mergeDiscoveryState({ clues: {} }, [], { action: { type: 'CLUE_OPENED', clueId: 'CL-' + G, generation: 0 } }),
    () => ctx.db.mergeDiscoveryState({ stage: 'EXPLORER', clues: {}, acceptedOriginGameId: null, professionProgress: {} }, [], { action: { type: 'SAVE_STATE', generation: 0 } }),
    () => ctx.db.saveState({ key: 'discovery', generation: 0, stage: 'EXPLORER', clues: {}, acceptedOriginGameId: null, professionProgress: {} }),
    () => ctx.db.saveDiscoveryState({ stage: 'EXPLORER', clues: {}, acceptedOriginGameId: null, professionProgress: {} }, { generation: 0 }),
  ];
  for (const run of actions) {
    const result = await run();
    assert(result.ok, JSON.stringify(result));
    const state = await readState(ctx.db);
    eq(state.acceptedOriginGameId, G);
    eq(state.professionProgress[P].state, 'accepted');
    assert(state.storyEvents['story:C0.port_seen']);
  }
  const viaGet = await ctx.db.getState('discovery');
  assert(viaGet && viaGet.acceptedOriginGameId === G && viaGet.professionProgress[P].state === 'accepted');
  return 'all discovery write/read paths preserve extension';
});

await check('T03-12 mergeDiscoveryState 按 professionEvents 数组同事务归约且坏事件零写入', async () => {
  const ctx = await freshDb();
  const multi = await ctx.db.mergeDiscoveryState({ clues: {}, runs: {} }, [], {
    action: {
      type: 'RUN_ENDED',
      generation: 0,
      professionEvents: [
        { action: 'GLIMPSED', input: inputFor(P, G, { clueId: 'CL-' + G }) },
        { action: 'GLIMPSED', input: inputFor(P2, G2, { clueId: 'CL-' + G2 }) },
      ],
    },
  });
  assert(multi.ok, JSON.stringify(multi));
  const state = await readState(ctx.db);
  eq(state.professionProgress[P].state, 'glimpsed');
  eq(state.professionProgress[P2].state, 'glimpsed');
  const before = await readState(ctx.db);
  const bad = await ctx.db.mergeDiscoveryState({ clues: {} }, [], {
    action: { type: 'RUN_ENDED', generation: 0, professionEvents: [{ action: 'SET_ACTIVE', input: inputFor(P, G) }] },
  });
  assert(!bad.ok && bad.reason === 'bad-profession-action', JSON.stringify(bad));
  eq(await readState(ctx.db), before);
  return 'multi-event reducer / failed event rolls back';
});

await check('T03-13 SAVE_STATE 不采纳调用方任意职业改写，SET_HINTS/LETTER_FOLLOWED 同样只保留', async () => {
  const ctx = await freshDb();
  await makeReadable(ctx, P, G, 'CL-' + G);
  await ctx.db.applyProfessionEvent({ action: 'ACCEPT_INVITATION', input: inputFor(P, G), generation: 0, now: NOW });
  const before = await readState(ctx.db);
  for (const action of [
    { type: 'SAVE_STATE', generation: 0 },
    { type: 'SET_HINTS', generation: 0 },
    { type: 'LETTER_FOLLOWED', generation: 0 },
  ]) {
    const result = await ctx.db.mergeDiscoveryState({ hintsEnabled: true, clues: {}, activeProfessionId: P2, professionProgress: { [P2]: { state: 'completed' } } }, [], { action });
    assert(result.ok, JSON.stringify(result));
    const state = await readState(ctx.db);
    eq(state.acceptedOriginGameId, before.acceptedOriginGameId);
    eq(state.activeProfessionId, before.activeProfessionId);
    eq(state.professionProgress, before.professionProgress);
  }
  return 'legacy actions preserve authoritative profession extension';
});

await check('T03-14 future professionVersion 读取/普通发现原样保留，直接职业写入拒绝', async () => {
  const ctx = await freshDb();
  const FUTURE_AT = '2099-01-01T00:00:00.000Z';
  const future = {
    professionVersion: 9,
    acceptedOriginGameId: G,
    activeProfessionId: P,
    futureOnly: { nested: [1, 2, 3] },
    professionProgress: { [P]: { state: 'accepted', futureProgress: true } },
    storyEvents: { 'story:future': { at: FUTURE_AT, source: 'future' } },
    updatedAt: FUTURE_AT,
  };
  seedRow(ctx.fakeIdb, ctx.db, 'state', discoveryRow(Object.assign({ stage: 'GLIMPSED', clues: {}, runs: {} }, future)));
  const read = await readState(ctx.db);
  eq(read.professionVersion, 9);
  eq(read.futureOnly, future.futureOnly);
  eq(read.updatedAt, FUTURE_AT);
  const saved = await ctx.db.saveState({ key: 'discovery', generation: 0, stage: 'EXPLORER', clues: {}, professionVersion: 1, acceptedOriginGameId: null });
  assert(saved.ok, JSON.stringify(saved));
  const afterSave = await readState(ctx.db);
  eq(afterSave.professionVersion, 9);
  eq(afterSave.futureOnly, future.futureOnly);
  eq(afterSave.stage, 'EXPLORER');
  eq(afterSave.updatedAt, FUTURE_AT);
  eq((await readStateRow(ctx.db)).updatedAt, FUTURE_AT);
  const merged = await ctx.db.mergeDiscoveryState({ clues: {}, runs: {} }, [], { action: { type: 'RUN_ENDED', generation: 0, run: { gameId: G }, baseRuns: {} } });
  assert(merged.ok, JSON.stringify(merged));
  const afterMerge = await readState(ctx.db);
  eq(afterMerge.professionVersion, 9);
  eq(afterMerge.futureOnly, future.futureOnly);
  eq(afterMerge.updatedAt, FUTURE_AT);
  eq((await readStateRow(ctx.db)).updatedAt, FUTURE_AT);
  const saved2 = await ctx.db.saveDiscoveryState({ stage: 'EXPLORER', clues: {} }, { generation: 0 });
  assert(saved2.ok, JSON.stringify(saved2));
  eq((await readStateRow(ctx.db)).updatedAt, FUTURE_AT);
  const rejected = await ctx.db.applyProfessionEvent({ action: 'SET_ACTIVE', input: { professionId: P, catalog }, generation: 0, now: LATER });
  assert(!rejected.ok && rejected.reason === 'future-profession-version', JSON.stringify(rejected));
  return 'future fields + ISO updatedAt monotonic / legacy clues evolve / write rejected';
});

await check('T03-15 backup 当前 professionVersion 扩展往返且无新增顶层字段', async () => {
  const ctx = await freshDb();
  await makeReadable(ctx, P, G, 'CL-' + G);
  await ctx.db.applyProfessionEvent({ action: 'ACCEPT_INVITATION', input: inputFor(P, G), generation: 0, now: NOW });
  const exported = await backup.exportCareerLife({ db: ctx.db, contentVersion: '0.18.0', exportedAt: NOW });
  assert(exported.ok, JSON.stringify(exported));
  const parsed = backup.parseAndValidate(exported.text);
  assert(parsed.ok, JSON.stringify(parsed));
  eq(Object.prototype.hasOwnProperty.call(parsed.payload, 'professionVersion'), false);
  const state = parsed.payload.state.find((row) => row.key === 'discovery').value;
  eq(state.professionVersion, 1);
  eq(state.acceptedOriginGameId, G);
  eq(state.professionProgress[P].state, 'accepted');
  await ctx.db.resetAllCareer();
  const imported = await backup.importCareerLife(exported.text, { db: ctx.db, mode: 'replace' });
  assert(imported.ok, JSON.stringify(imported));
  const restored = await readState(ctx.db);
  eq(restored.acceptedOriginGameId, G);
  eq(restored.professionProgress[P].state, 'accepted');
  return 'export→parse→replace→read / 11 stores unchanged';
});

await check('T03-16 backup 未来 professionVersion 原样导入不降级，非法版本拒绝', async () => {
  const ctx = await freshDb();
  const profile = profileRow('career-future', { originGameId: G });
  const future = { professionVersion: 12, acceptedOriginGameId: G, activeProfessionId: P, futureOnly: ['x'], professionProgress: { [P]: { state: 'accepted', futureFlag: true } }, updatedAt: NOW };
  const payload = payloadWithState([discoveryRow(Object.assign({ stage: 'GLIMPSED', clues: {}, runs: {} }, future)), pointerRow('career-future')], profile);
  const parsed = backup.parseAndValidate(JSON.stringify(payload));
  assert(parsed.ok, JSON.stringify(parsed));
  const imported = await ctx.db.importAll(parsed.payload, { mode: 'replace' });
  assert(imported.ok, JSON.stringify(imported));
  const state = await readState(ctx.db);
  eq(state.professionVersion, 12);
  eq(state.futureOnly, ['x']);
  eq(state.professionProgress[P].futureFlag, true);
  const invalid = clone(payload);
  invalid.state[0].value.professionVersion = '12';
  const rejected = backup.parseAndValidate(JSON.stringify(invalid));
  assert(!rejected.ok && rejected.error === 'bad-value' && /professionVersion/.test(rejected.path), JSON.stringify(rejected));
  return 'future=12 preserved / invalid professionVersion rejected';
});

await check('T03-17 导入保留封存行与无关退役标记，replace 以文件封存状态为准', async () => {
  const ctx = await freshDb();
  seedRow(ctx.fakeIdb, ctx.db, 'state', { key: 'former-career:career-old', schemaVersion: 1, updatedAt: NOW, value: { careerId: 'career-old', retiredAt: NOW } });
  const profile = profileRow('career-imported', { originGameId: G });
  const payload = payloadWithState([
    discoveryRow({ stage: 'GLIMPSED', clues: {}, professionVersion: 1, acceptedOriginGameId: G, professionProgress: { [P]: { state: 'accepted', acceptedAt: NOW } } }),
    pointerRow('career-imported'),
    { key: 'career-archive', schemaVersion: 1, updatedAt: NOW, value: { careerId: 'career-imported', archivedAt: NOW } },
  ], profile);
  const parsed = backup.parseAndValidate(JSON.stringify(payload));
  assert(parsed.ok, JSON.stringify(parsed));
  await ctx.db.importAll(parsed.payload, { mode: 'replace' });
  const archive = await ctx.db.getArchiveState();
  eq(archive.archived, true);
  const former = await ctx.db.getState('former-career:career-old');
  assert(former && former.careerId === 'career-old');
  eq((await readState(ctx.db)).acceptedOriginGameId, G);
  return 'archive row restored / retired marker retained';
});

/* ------------------------- 迁移矩阵 ------------------------- */
async function migrationFixture(extra) {
  const ctx = await freshDb();
  const config = Object.assign({ profile: true, pointer: true, state: null, rows: {} }, extra || {});
  if (config.profile) seedRow(ctx.fakeIdb, ctx.db, 'profiles', profileRow('career-legacy', config.profileExtra));
  if (config.pointer) seedRow(ctx.fakeIdb, ctx.db, 'state', pointerRow('career-legacy'));
  if (config.state) seedRow(ctx.fakeIdb, ctx.db, 'state', discoveryRow(config.state));
  Object.keys(config.rows || {}).forEach((name) => (config.rows[name] || []).forEach((row) => seedRow(ctx.fakeIdb, ctx.db, name, row)));
  return ctx;
}
async function migrate(ctx, now) {
  const current = await ctx.db.getDiscoveryGeneration();
  return ctx.db.applyProfessionEvent({ action: 'MIGRATE_LEGACY', input: { catalog }, generation: current.generation, now: now || NOW });
}

await check('MIG-01 新档：无证据不捏造接受/起源/身份', async () => {
  const ctx = await migrationFixture({ profile: false, pointer: false });
  const before = await assets(ctx.db);
  const result = await migrate(ctx);
  assert(result.ok && result.created === false && result.newlyAccepted === false, JSON.stringify(result));
  const state = await readState(ctx.db);
  eq(state.acceptedOriginGameId, null);
  eq(state.activeProfessionId, null);
  eq(state.professionProgress, {});
  eq(await assets(ctx.db), before);
  return 'new / no evidence / no identity';
});

await check('MIG-02 旧未发现：保留已有身份，不重发初始资产', async () => {
  const ctx = await migrationFixture({ profileExtra: { originGameId: null } });
  const before = await assets(ctx.db);
  const result = await migrate(ctx);
  assert(result.ok && result.careerId === 'career-legacy' && result.created === false, JSON.stringify(result));
  const state = await readState(ctx.db);
  eq(state.acceptedOriginGameId, null);
  eq(state.professionProgress, {});
  eq(await assets(ctx.db), before);
  return 'legacy identity preserved / origin null';
});

await check('MIG-03 旧仅线索/catalog unlock/游玩次数/profile.updatedAt 不算接受', async () => {
  const ctx = await migrationFixture({
    profileExtra: { originGameId: null, updatedAt: NOW },
    state: { stage: 'EXPLORER', firstSourceGame: G, clues: { ['CL-' + G]: { sourceGame: G, openedAt: NOW } }, runs: { [G]: { eligibleRuns: 99 } }, catalogUnlock: [P] },
    rows: { discovery: [{ clueId: 'CL-' + G, sourceGame: G, openedAt: NOW, updatedAt: NOW }] },
  });
  const result = await migrate(ctx);
  assert(result.ok, JSON.stringify(result));
  const state = await readState(ctx.db);
  eq(state.professionProgress, {});
  eq(state.acceptedOriginGameId, null);
  eq(state.firstDiscoveredGameId, G);
  eq(state.clues['CL-' + G].openedAt, NOW);
  return 'clue-only preserved / no acceptance';
});

await check('MIG-04 旧身份无起源：有效 claim 回填接受与最早合法时间，不重复资产', async () => {
  const ctx = await migrationFixture({
    profileExtra: { originGameId: null },
    rows: {
      runs: [{ runId: 'run-legacy', careerId: 'career-legacy', commissionId: C1, gameId: G, status: 'claimed', createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z' }],
      claims: [{ runId: 'run-legacy', careerId: 'career-legacy', commissionId: C1, claimedAt: '2026-11-20T00:00:00.000Z' }],
    },
  });
  const before = await assets(ctx.db);
  const result = await migrate(ctx);
  assert(result.ok && result.careerId === 'career-legacy' && result.created === false, JSON.stringify(result));
  const state = await readState(ctx.db);
  eq(state.professionProgress[P].state, 'accepted');
  eq(state.professionProgress[P].acceptedAt, '2026-11-20T00:00:00.000Z');
  eq(state.acceptedOriginGameId, G);
  eq(state.activeProfessionId, null);
  eq(await assets(ctx.db), before);
  return 'claim/run evidence / no reward';
});

await check('MIG-05 旧多职业：按最早合法时间定起源，不按 ID 字典序指派 active', async () => {
  const ctx = await migrationFixture({
    profileExtra: { originGameId: null },
    rows: {
      quests: [
        { careerId: 'career-legacy', nodeId: C1, commissionId: C1, status: 'cleared', clearedAt: '2026-11-22T00:00:00.000Z' },
        { careerId: 'career-legacy', nodeId: C2, commissionId: C2, status: 'active', updatedAt: '2026-11-21T00:00:00.000Z' },
      ],
    },
  });
  const result = await migrate(ctx);
  assert(result.ok, JSON.stringify(result));
  const state = await readState(ctx.db);
  eq(Object.keys(state.professionProgress).sort(), [P, P2].sort());
  eq(state.acceptedOriginGameId, G2);
  eq(state.activeProfessionId, null);
  return 'earliest valid time wins / active null';
});

await check('MIG-06 显式 activeProfessionId 且存在接受证据时保留', async () => {
  const ctx = await migrationFixture({
    profileExtra: { originGameId: null, activeProfessionId: P2, acceptedProfessionIds: [P, P2], acceptedAt: { [P]: '2026-11-20T00:00:00.000Z', [P2]: '2026-11-21T00:00:00.000Z' } },
  });
  const result = await migrate(ctx);
  assert(result.ok, JSON.stringify(result));
  const state = await readState(ctx.db);
  eq(state.activeProfessionId, P2);
  eq(state.acceptedOriginGameId, G);
  return 'explicit active retained';
});

await check('MIG-07 旧终局：quests/claims/ledgers/余额逐行不变', async () => {
  const ctx = await migrationFixture({
    profileExtra: { originGameId: G },
    rows: {
      quests: [
        { careerId: 'career-legacy', nodeId: C1, commissionId: C1, status: 'cleared', clearedAt: '2026-11-20T00:00:00.000Z' },
        { careerId: 'career-legacy', nodeId: 'story:C5.star_tower_resolved', status: 'cleared', clearedAt: '2026-11-25T00:00:00.000Z', flags: ['C5.star_tower_resolved'] },
      ],
      claims: [{ runId: 'run-ending', careerId: 'career-legacy', commissionId: 'ending.research', credits: 0, claimedAt: '2026-11-25T00:00:00.000Z' }],
      ledgers: [{ txId: 'tx:ending:career-legacy', careerId: 'career-legacy', kind: 'ending', credits: 0, at: '2026-11-25T00:00:00.000Z' }],
      balances: [{ careerId: 'career-legacy', credits: 123, revision: 7, createdAt: NOW, updatedAt: NOW }],
    },
  });
  const before = await assets(ctx.db);
  const result = await migrate(ctx);
  assert(result.ok, JSON.stringify(result));
  eq(await assets(ctx.db), before);
  eq((await readState(ctx.db)).professionProgress[P].state, 'accepted');
  return 'ending + wallet + ledger + quest unchanged';
});

await check('MIG-08 封存：迁移拒绝且零写入', async () => {
  const ctx = await migrationFixture({});
  seedRow(ctx.fakeIdb, ctx.db, 'state', { key: 'career-archive', schemaVersion: 1, updatedAt: NOW, value: { careerId: 'career-legacy', archivedAt: NOW } });
  const before = await readState(ctx.db);
  const result = await migrate(ctx);
  assert(!result.ok && result.reason === 'career-archived', JSON.stringify(result));
  eq(await readState(ctx.db), before);
  return 'archived migration blocked';
});

await check('MIG-09 导入后迁移：导入资产/封存/扩展不被迁移改写', async () => {
  const ctx = await migrationFixture({ profile: false, pointer: false });
  const profile = profileRow('career-imported', { originGameId: null });
  const payload = payloadWithState([
    discoveryRow({ stage: 'GLIMPSED', clues: {}, runs: {}, professionVersion: 1 }),
    pointerRow('career-imported'),
    { key: 'career-archive', schemaVersion: 1, updatedAt: NOW, value: { careerId: 'career-imported', archivedAt: NOW } },
  ], profile);
  const parsed = backup.parseAndValidate(JSON.stringify(payload));
  assert(parsed.ok, JSON.stringify(parsed));
  await ctx.db.importAll(parsed.payload, { mode: 'replace' });
  const before = await assets(ctx.db);
  const blocked = await migrate(ctx);
  assert(!blocked.ok && blocked.reason === 'career-archived', JSON.stringify(blocked));
  eq(await assets(ctx.db), before);
  await ctx.db.setCareerArchived(false, { now: LATER });
  const migrated = await migrate(ctx, LATER);
  assert(migrated.ok && migrated.careerId === 'career-imported', JSON.stringify(migrated));
  eq(await assets(ctx.db), before);
  return 'import→archived guard→thaw→migrate / assets unchanged';
});

await check('MIG-10 重复迁移：duplicate=true 且 discovery 行时间/状态不变', async () => {
  const ctx = await migrationFixture({ profileExtra: { originGameId: null }, rows: { claims: [{ runId: 'run-l', careerId: 'career-legacy', commissionId: C1, claimedAt: '2026-11-20T00:00:00.000Z' }] } });
  const first = await migrate(ctx);
  assert(first.ok, JSON.stringify(first));
  const before = await readState(ctx.db);
  const second = await migrate(ctx, LATER);
  eq(await readState(ctx.db), before);
  assert(second.ok && second.duplicate === true, JSON.stringify(second));
  return 'idempotent / zero row update';
});

await check('MIG-11 中断重试：state put 失败整体回滚，重试成功且只写一次', async () => {
  const ctx = await migrationFixture({ profileExtra: { originGameId: null }, rows: { claims: [{ runId: 'run-l', careerId: 'career-legacy', commissionId: C1, claimedAt: '2026-11-20T00:00:00.000Z' }] } });
  const def = storeDef(ctx.fakeIdb, ctx.db, 'state');
  def.failPutKey = 'discovery';
  const failed = await migrate(ctx);
  assert(!failed.ok, JSON.stringify(failed));
  eq(await readState(ctx.db), null);
  def.failPutKey = null;
  const retried = await migrate(ctx);
  assert(retried.ok, JSON.stringify(retried));
  const state = await readState(ctx.db);
  eq(state.professionProgress[P].state, 'accepted');
  eq(state.acceptedOriginGameId, G);
  return 'abort rollback / retry succeeds';
});

await check('MIG-12 未知未来 professionVersion：迁移拒绝且未来字段不降级', async () => {
  const ctx = await migrationFixture({ state: { stage: 'GLIMPSED', clues: {}, professionVersion: 7, acceptedOriginGameId: G, futureOnly: { keep: true }, professionProgress: {} } });
  const before = await readState(ctx.db);
  const result = await migrate(ctx);
  assert(!result.ok && result.reason === 'future-profession-version', JSON.stringify(result));
  eq(await readState(ctx.db), before);
  return 'future-profession-version / zero write';
});

await check('T03-18 合成 N+1 职业可持久化，不依赖固定职业数组', async () => {
  const ctx = await freshDb();
  const extended = clone(catalog);
  extended.professions.push({ professionId: 'service.courier', displayName: 'Courier' });
  extended.games.push({ gameId: 'virtual-courier', professions: ['service.courier'], displayName: 'Virtual' });
  extended.clues.push({ clueId: 'CL-virtual-courier', gameId: 'virtual-courier', professionId: 'service.courier' });
  const id = 'service.courier';
  const game = 'virtual-courier';
  const g = await ctx.db.getDiscoveryGeneration();
  const glimpse = await ctx.db.applyProfessionEvent({ action: 'GLIMPSED', input: { professionId: id, gameId: game, clueId: 'CL-' + game, catalog: extended }, generation: g.generation, now: NOW });
  assert(glimpse.ok, JSON.stringify(glimpse));
  await ctx.db.mergeDiscoveryState({ clues: {} }, [], { action: { type: 'CLUE_OPENED', clueId: 'CL-' + game, generation: g.generation } });
  const read = await ctx.db.applyProfessionEvent({ action: 'READ', input: { professionId: id, clueId: 'CL-' + game, catalog: extended }, generation: g.generation, now: NOW });
  assert(read.ok, JSON.stringify(read));
  const accepted = await ctx.db.applyProfessionEvent({ action: 'ACCEPT_INVITATION', input: { professionId: id, gameId: game, catalog: extended }, generation: g.generation, now: NOW });
  assert(accepted.ok && accepted.created === true, JSON.stringify(accepted));
  eq((await readState(ctx.db)).professionProgress[id].state, 'accepted');
  return 'N+1 accepted with one identity';
});

await check('T03-19 原始 event.state / event.extension 伪造职业状态被拒绝且零写入', async () => {
  const payloads = [
    { state: { professionVersion: 1, acceptedOriginGameId: G2, activeProfessionId: P2, professionProgress: { [P]: { state: 'accepted', acceptedAt: NOW } } } },
    { extension: { professionVersion: 9, acceptedOriginGameId: G2, professionProgress: { [P]: { state: 'accepted' } } } },
  ];
  for (const payload of payloads) {
    const ctx = await freshDb();
    const result = await ctx.db.mergeDiscoveryState({ clues: {}, runs: {} }, [], {
      action: Object.assign({
        type: 'RUN_ENDED',
        generation: 0,
        professionEvents: [{ action: 'GLIMPSED', input: inputFor(P, G, { clueId: 'CL-' + G }), ...payload }],
      }),
    });
    assert(!result.ok && result.reason === 'bad-profession-state', JSON.stringify(result));
    eq(await readState(ctx.db), null);
  }
  return 'raw extension injection rejected / reducer-only';
});

await check('T03-20 未注入 professionState 时 SAVE_STATE 不擦 base 扩展', async () => {
  const ctx = await freshDb(undefined, false);
  seedRow(ctx.fakeIdb, ctx.db, 'state', discoveryRow({
    stage: 'GLIMPSED',
    clues: { ['CL-' + G]: { sourceGame: G, openedAt: NOW } },
    runs: {},
    professionVersion: 1,
    acceptedOriginGameId: G,
    activeProfessionId: P,
    professionProgress: { [P]: { state: 'accepted', acceptedAt: NOW } },
    storyEvents: { 'story:C0.port_seen': { at: NOW, source: 'clue' } },
    updatedAt: NOW,
  }));
  const saved = await ctx.db.saveState({ key: 'discovery', generation: 0, stage: 'EXPLORER', clues: {} });
  assert(saved.ok, JSON.stringify(saved));
  const state = await readState(ctx.db);
  eq(state.acceptedOriginGameId, G);
  eq(state.activeProfessionId, P);
  eq(state.professionProgress, { [P]: { state: 'accepted', acceptedAt: NOW } });
  eq(state.storyEvents, { 'story:C0.port_seen': { at: NOW, source: 'clue' } });
  eq(state.stage, 'EXPLORER');
  const viaSaveDiscovery = await ctx.db.saveDiscoveryState({ stage: 'LOCAL', clues: {} }, { generation: 0 });
  assert(viaSaveDiscovery.ok, JSON.stringify(viaSaveDiscovery));
  eq((await readState(ctx.db)).acceptedOriginGameId, G);
  return 'fallback merge preserves base / no source clobber';
});

await check('T03-21 重复 ACCEPT 仍校验 catalog/gameId/clue 映射', async () => {
  const ctx = await freshDb();
  await makeReadable(ctx, P, G, 'CL-' + G);
  const accepted = await ctx.db.applyProfessionEvent({ action: 'ACCEPT_INVITATION', input: inputFor(P, G), generation: 0, now: NOW });
  assert(accepted.ok && accepted.created === true, JSON.stringify(accepted));
  const before = await readState(ctx.db);
  const cases = [
    { professionId: P, gameId: G2, catalog },
    { professionId: P, gameId: G },
    { professionId: P, gameId: G, clueId: 'CL-' + G2, catalog },
  ];
  for (const input of cases) {
    const result = await ctx.db.applyProfessionEvent({ action: 'ACCEPT_INVITATION', input, generation: 0, now: LATER });
    assert(!result.ok, '重复接受应拒绝非法映射: ' + JSON.stringify(result));
    eq(await readState(ctx.db), before);
  }
  const valid = await ctx.db.applyProfessionEvent({ action: 'ACCEPT_INVITATION', input: inputFor(P, G), generation: 0, now: LATER });
  assert(valid.ok && valid.duplicate === true, JSON.stringify(valid));
  return 'duplicate still validated / valid duplicate remains no-op';
});

console.log('\n' + passed + '/' + total + ' checks passed');
if (failures.length) {
  console.log('FAILURES:');
  failures.forEach((line) => console.log('  ' + line));
  process.exitCode = 1;
}
