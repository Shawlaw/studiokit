#!/usr/bin/env node
/**
 * Arcade 0.22 T07 — 旧档迁移 / 导入 / 封存 / 中断重试整合矩阵。
 *
 * 纯 Node + VM 内存 IndexedDB：不启动浏览器、不写仓库、不运行 full/release。
 * 运行：node tools/career_profession_legacy_test.mjs
 * 退出码：0 全 PASS；1 有 FAIL；2 装配失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CAREER = path.join(ROOT, 'apps/arcade/career');
const CONTENT = path.join(CAREER, 'content');
const NOW = '2026-11-27T01:00:00.000Z';
const LATER = '2026-11-27T02:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';
const P = 'nature.miner';
const G = 'gold-miner';
const P2 = 'research.archivist';
const G2 = 'memory-flip';
const C1 = 'gold-miner.T1';
const C2 = 'memory-flip.T1';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? '' : String(detail === undefined ? '' : detail) });
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'expected ' + e + ' got ' + a);
}
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

let CORE;
let S;
let BACKUP;
let DB_SOURCE;
let REGISTRY;
let COMMISSIONS;
let CLUES;
try {
  CORE = require(path.join(CAREER, 'career-core.js'));
  S = require(path.join(CAREER, 'profession-state.js'));
  BACKUP = require(path.join(CAREER, 'backup.js'));
  DB_SOURCE = fs.readFileSync(path.join(CAREER, 'career-db.js'), 'utf8');
  REGISTRY = JSON.parse(fs.readFileSync(path.join(CONTENT, 'registry.json'), 'utf8'));
  COMMISSIONS = JSON.parse(fs.readFileSync(path.join(CONTENT, 'commissions.json'), 'utf8'));
  CLUES = JSON.parse(fs.readFileSync(path.join(CONTENT, 'clues.json'), 'utf8'));
} catch (err) {
  console.error('ASSEMBLY FAILED: ' + (err && err.stack ? err.stack : String(err)));
  process.exit(2);
}

const catalog = {
  games: REGISTRY.games,
  professions: REGISTRY.professions,
  commissions: COMMISSIONS.commissions,
  clues: CLUES.clues,
};
const ASSET_STORES = ['profiles', 'balances', 'ledgers', 'runs', 'claims', 'quests', 'inventory', 'equipment'];
const LEGACY_FIELDS = [
  'stage', 'firstSourceGame', 'firstClueId', 'portSeenAt', 'careerSignedAt',
  'explorerAt', 'hintsEnabled', 'clues', 'runs', 'catalogUnlock',
];

/* ------------------------------------------------------------------ *
 * 可回滚 IndexedDB 桩：onabort 丢弃 overlay，oncomplete 才提交。
 * ------------------------------------------------------------------ */
function keyOf(keyPath, row) {
  return Array.isArray(keyPath) ? keyPath.map((field) => row[field]) : row[keyPath];
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
      objectStoreNames: { contains: (storeName) => db.stores.has(storeName) },
      onversionchange: null,
      onclose: null,
      close() {},
    };
    const upgradeTx = { objectStore: () => ({ indexNames: { contains: () => true }, createIndex() {} }) };
    db.createObjectStore = (storeName, options) => {
      db.stores.set(storeName, { keyPath: options.keyPath, rows: new Map(), failPutKey: null });
      return upgradeTx.objectStore(storeName);
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
    names.forEach((name) => overlays.set(name, { cleared: false, rows: new Map() }));
    const defFor = (name) => db.stores.get(name);
    const currentRow = (name, key) => {
      const overlay = overlays.get(name);
      if (overlay && overlay.cleared) return undefined;
      if (overlay && overlay.rows.has(key)) {
        const row = overlay.rows.get(key);
        return row === null ? undefined : clone(row);
      }
      const row = defFor(name) && defFor(name).rows.get(key);
      return row === undefined ? undefined : clone(row);
    };
    function track(run) {
      if (tx.aborted) {
        const request = { result: undefined, error: null, onsuccess: null, onerror: null };
        queueMicrotask(() => { if (typeof request.onsuccess === 'function') request.onsuccess({ target: request }); });
        return request;
      }
      tx.pending += 1;
      const request = { result: undefined, error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        if (tx.aborted) { tx.pending -= 1; maybeComplete(); return; }
        try {
          request.result = run();
          if (typeof request.onsuccess === 'function') request.onsuccess({ target: request });
        } catch (err) {
          request.error = err;
          tx.error = err;
          if (typeof request.onerror === 'function') request.onerror({ target: request, preventDefault() {} });
        }
        tx.pending -= 1;
        maybeComplete();
      });
      return request;
    }
    function maybeComplete() {
      if (tx.settled || tx.aborted || tx.pending > 0) return;
      tx.settled = true;
      if (mode === 'readwrite') {
        overlays.forEach((overlay, name) => {
          const def = defFor(name);
          if (!def) return;
          if (overlay.cleared) def.rows.clear();
          overlay.rows.forEach((row, key) => {
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
      const overlay = overlays.get(name);
      return {
        get: (key) => track(() => currentRow(name, keyId(key))),
        getAll: () => track(() => {
          const rows = new Map();
          if (!(overlay && overlay.cleared)) def.rows.forEach((row, key) => rows.set(key, clone(row)));
          overlay.rows.forEach((row, key) => {
            if (row === null) rows.delete(key);
            else rows.set(key, clone(row));
          });
          return Array.from(rows.values());
        }),
        count: () => track(() => {
          let count = overlay && overlay.cleared ? 0 : def.rows.size;
          overlay.rows.forEach((row, key) => { count += (row === null ? 0 : 1) - (def.rows.has(key) ? 1 : 0); });
          return count;
        }),
        put: (row) => track(() => {
          const key = keyId(keyOf(def.keyPath, row));
          if (def.failPutKey === key) throw Object.assign(new Error('injected-put-failure'), { name: 'ConstraintError' });
          overlay.rows.set(key, clone(row));
          return keyOf(def.keyPath, row);
        }),
        add: (row) => track(() => {
          const key = keyId(keyOf(def.keyPath, row));
          if (currentRow(name, key) !== undefined) throw Object.assign(new Error('duplicate'), { name: 'ConstraintError' });
          overlay.rows.set(key, clone(row));
          return keyOf(def.keyPath, row);
        }),
        delete: (key) => track(() => { overlay.rows.set(keyId(key), null); return undefined; }),
        clear: () => track(() => { overlay.cleared = true; overlay.rows.clear(); return undefined; }),
      };
    };
    queueMicrotask(maybeComplete);
    return tx;
  }
  return { open, _databases: databases };
}
function loadDb(fakeIdb) {
  const sandbox = {
    module: { exports: {} },
    require: (name) => {
      if (name === './career-core.js') return CORE;
      if (name === './profession-state.js') return S;
      throw new Error('unexpected require:' + name);
    },
    indexedDB: fakeIdb,
    Date, JSON, Math, Number, Object, Array, String, Boolean, Promise, setTimeout, clearTimeout, queueMicrotask, Error,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(DB_SOURCE, sandbox, { filename: 'career-db.js' });
  return sandbox.module.exports;
}
async function freshDb() {
  const fakeIdb = createFakeIndexedDB();
  const db = loadDb(fakeIdb);
  const opened = await db.open();
  assert(opened.ok, 'open fake IDB: ' + JSON.stringify(opened));
  return { db, fakeIdb };
}
function storeDef(ctx, name) {
  return ctx.fakeIdb._databases.get(ctx.db.DB_NAME).stores.get(name);
}
function seedRow(ctx, store, row) {
  const def = storeDef(ctx, store);
  def.rows.set(keyId(keyOf(def.keyPath, row)), clone(row));
}
async function stateOf(db) {
  const snapshot = await db.getDiscoverySnapshot();
  assert(snapshot.ok, JSON.stringify(snapshot));
  return snapshot.state;
}
async function exported(db) {
  const result = await db.exportAll();
  assert(result.ok, JSON.stringify(result));
  return result.payload;
}
async function assetSnapshot(db) {
  const payload = await exported(db);
  const out = {};
  ASSET_STORES.forEach((name) => { out[name] = payload[name]; });
  return out;
}
async function stateRowOf(db) {
  const payload = await exported(db);
  return payload.state.find((row) => row.key === 'discovery') || null;
}
function legacyPart(state) {
  if (!state) return null;
  const out = {};
  LEGACY_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(state, field)) out[field] = clone(state[field]);
  });
  return Object.keys(out).length ? out : null;
}
async function invariants(db) {
  const payload = await exported(db);
  const state = await stateOf(db);
  return {
    assets: Object.fromEntries(ASSET_STORES.map((name) => [name, payload[name]])),
    identity: {
      pointer: payload.state.find((row) => row.key === 'career') || null,
      archive: payload.state.find((row) => row.key === 'career-archive') || null,
      profiles: payload.profiles,
    },
    legacy: legacyPart(state),
    chapters: {
      quests: payload.quests.filter((row) => /^C[0-5]\.|story:/.test(row.nodeId || '')),
      endingClaims: payload.claims.filter((row) => /^ending\./.test(row.commissionId || '')),
      endingLedgers: payload.ledgers.filter((row) => row.kind === 'ending'),
    },
  };
}
function eqInvariants(name, before, after) {
  eq(name + ' 资产/身份/章节/终局不变', after, before);
}
function profileRow(careerId, extra) {
  return Object.assign({
    careerId,
    schemaVersion: 1,
    originGameId: null,
    createdAt: NOW,
    updatedAt: NOW,
    capabilities: [],
    flags: [],
    evidence: [],
    settings: {},
  }, extra || {});
}
function pointerRow(careerId, extra) {
  return Object.assign({
    key: 'career', schemaVersion: 1, updatedAt: NOW,
    value: { careerId, originGameId: null, createdAt: NOW },
  }, extra || {});
}
function discoveryRow(value, extra) {
  return Object.assign({ key: 'discovery', schemaVersion: 1, updatedAt: NOW, value: clone(value) }, extra || {});
}
function payloadWithState(stateRows, profile, extra) {
  const base = {
    format: 'studiokit-arcade-career',
    careerSchemaVersion: 1,
    contentVersion: '0.18.0',
    rulesetVersion: 1,
    exportedAt: NOW,
    profiles: profile ? [profile] : [],
    state: stateRows,
    discovery: [],
    runs: [],
    claims: [],
    ledgers: profile ? [{
      txId: 'tx:init:' + profile.careerId + ':1', careerId: profile.careerId, step: 1,
      kind: 'initial-grant', credits: 80, items: {}, at: NOW,
      rulesetVersion: 1, contentVersion: '0.18.0',
    }] : [],
    balances: profile ? [{ careerId: profile.careerId, credits: 80, revision: 0, createdAt: NOW, updatedAt: NOW }] : [],
    inventory: [],
    equipment: [],
    quests: [],
    migrations: [],
  };
  return Object.assign(base, extra || {});
}
async function migrationFixture(options) {
  const config = Object.assign({ profile: true, pointer: true, state: null, rows: {} }, options || {});
  const ctx = await freshDb();
  if (config.profile) seedRow(ctx, 'profiles', profileRow('career-legacy', config.profileExtra));
  if (config.pointer) seedRow(ctx, 'state', pointerRow('career-legacy'));
  if (config.state) seedRow(ctx, 'state', discoveryRow(config.state));
  Object.keys(config.rows).forEach((name) => {
    (config.rows[name] || []).forEach((row) => seedRow(ctx, name, row));
  });
  return ctx;
}
async function migrate(ctx, now) {
  const generation = await ctx.db.getDiscoveryGeneration();
  return ctx.db.applyProfessionEvent({
    action: 'MIGRATE_LEGACY',
    input: { catalog },
    generation: generation.generation,
    now: now || NOW,
  });
}

async function main() {
  eq('L00 DB constants', {
    name: (await freshDb()).db.DB_NAME,
    version: (await freshDb()).db.DB_VERSION,
    stores: (await freshDb()).db.STORES.length,
  }, { name: 'studiokit:arcade:career', version: 1, stores: 11 });

  /* L01 新档 */
  {
    const ctx = await migrationFixture({ profile: false, pointer: false });
    const before = await invariants(ctx.db);
    const result = await migrate(ctx);
    check('L01 新档迁移 ok 且不建身份', result.ok && result.created === false && result.newlyAccepted === false, JSON.stringify(result));
    const newState = await stateOf(ctx.db);
    eq('L01 新档无接受事实', {
      professionVersion: newState.professionVersion,
      acceptedOriginGameId: newState.acceptedOriginGameId,
      activeProfessionId: newState.activeProfessionId,
      professionProgress: newState.professionProgress,
      storyEvents: newState.storyEvents,
    }, {
      professionVersion: 1,
      acceptedOriginGameId: null,
      activeProfessionId: null,
      professionProgress: {},
      storyEvents: {},
    });
    eqInvariants('L01', before, await invariants(ctx.db));
  }

  /* L02 旧未发现 */
  {
    const ctx = await migrationFixture({ profileExtra: { originGameId: null } });
    const before = await invariants(ctx.db);
    const result = await migrate(ctx);
    check('L02 旧未发现保留既有身份', result.ok && result.careerId === 'career-legacy' && result.created === false, JSON.stringify(result));
    const state = await stateOf(ctx.db);
    eq('L02 origin 仍 null', state.acceptedOriginGameId, null);
    eq('L02 active 仍 null', state.activeProfessionId, null);
    eq('L02 无捏造职业进度', state.professionProgress, {});
    eqInvariants('L02', before, await invariants(ctx.db));
  }

  /* L03 旧仅线索 / catalog unlock / 游玩次数 */
  {
    const legacyState = {
      stage: 'EXPLORER',
      firstSourceGame: G,
      firstClueId: 'CL-' + G,
      clues: { ['CL-' + G]: { sourceGame: G, openedAt: NOW } },
      runs: { [G]: { eligibleRuns: 99 } },
      catalogUnlock: [P],
      portSeenAt: null,
      careerSignedAt: NOW,
    };
    const ctx = await migrationFixture({
      profileExtra: { originGameId: null, updatedAt: NOW },
      state: legacyState,
      rows: { discovery: [{ clueId: 'CL-' + G, sourceGame: G, openedAt: NOW, updatedAt: NOW }] },
    });
    const before = await invariants(ctx.db);
    const result = await migrate(ctx);
    check('L03 仅线索迁移 ok', result.ok, JSON.stringify(result));
    const state = await stateOf(ctx.db);
    eq('L03 不把线索当接受', state.professionProgress, {});
    eq('L03 origin 不猜', state.acceptedOriginGameId, null);
    eq('L03 发现事实保留', state.firstDiscoveredGameId, G);
    eq('L03 线索正文保留', state.clues['CL-' + G].openedAt, NOW);
    eqInvariants('L03', before, await invariants(ctx.db));
  }

  /* L04 旧身份无起源 */
  {
    const ctx = await migrationFixture({
      profileExtra: { originGameId: null },
      rows: {
        runs: [{ runId: 'run-legacy', careerId: 'career-legacy', commissionId: C1, gameId: G, status: 'claimed', createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z' }],
        claims: [{ runId: 'run-legacy', careerId: 'career-legacy', commissionId: C1, claimedAt: '2026-11-20T00:00:00.000Z' }],
      },
    });
    const before = await invariants(ctx.db);
    const result = await migrate(ctx);
    check('L04 有效 claim 回填接受', result.ok && result.careerId === 'career-legacy' && result.created === false, JSON.stringify(result));
    const state = await stateOf(ctx.db);
    eq('L04 回填职业', state.professionProgress[P].state, 'accepted');
    eq('L04 origin 来自最早合法时间', state.acceptedOriginGameId, G);
    eq('L04 active 不按字典序指派', state.activeProfessionId, null);
    eqInvariants('L04', before, await invariants(ctx.db));
  }

  /* L05 旧多职业任务 */
  {
    const ctx = await migrationFixture({
      profileExtra: { originGameId: null },
      rows: {
        quests: [
          { careerId: 'career-legacy', nodeId: C1, commissionId: C1, status: 'cleared', clearedAt: '2026-11-22T00:00:00.000Z' },
          { careerId: 'career-legacy', nodeId: C2, commissionId: C2, status: 'active', updatedAt: '2026-11-21T00:00:00.000Z' },
        ],
      },
    });
    const before = await invariants(ctx.db);
    const result = await migrate(ctx);
    check('L05 旧多职业迁移 ok', result.ok, JSON.stringify(result));
    const state = await stateOf(ctx.db);
    eq('L05 回填两个职业', Object.keys(state.professionProgress).sort(), [P, P2].sort());
    eq('L05 起源取最早合法事件', state.acceptedOriginGameId, G2);
    eq('L05 不自动指派 active', state.activeProfessionId, null);
    eqInvariants('L05', before, await invariants(ctx.db));
  }

  /* L06 旧终局 */
  {
    const endingQuest = {
      careerId: 'career-legacy', nodeId: 'story:C5.star_tower_resolved',
      status: 'cleared', clearedAt: '2026-11-25T00:00:00.000Z', flags: ['C5.star_tower_resolved'],
    };
    const endingClaim = { runId: 'run-ending', careerId: 'career-legacy', commissionId: 'ending.research', credits: 0, claimedAt: '2026-11-25T00:00:00.000Z' };
    const endingLedger = { txId: 'tx:ending:career-legacy', careerId: 'career-legacy', kind: 'ending', credits: 0, at: '2026-11-25T00:00:00.000Z' };
    const ctx = await migrationFixture({
      profileExtra: { originGameId: G, flags: ['C5.star_tower_resolved'] },
      rows: {
        quests: [
          { careerId: 'career-legacy', nodeId: C1, commissionId: C1, status: 'cleared', clearedAt: '2026-11-20T00:00:00.000Z' },
          endingQuest,
        ],
        claims: [endingClaim],
        ledgers: [endingLedger],
        balances: [{ careerId: 'career-legacy', credits: 123, revision: 7, createdAt: NOW, updatedAt: NOW }],
      },
    });
    const before = await invariants(ctx.db);
    const result = await migrate(ctx);
    check('L06 旧终局迁移 ok', result.ok, JSON.stringify(result));
    eqInvariants('L06', before, await invariants(ctx.db));
    const after = await exported(ctx.db);
    check('L06 终局章节 quest 原样保留', JSON.stringify(after.quests.find((row) => row.nodeId === endingQuest.nodeId)) === JSON.stringify(endingQuest));
    check('L06 终局 claim 原样保留', JSON.stringify(after.claims.find((row) => row.commissionId === 'ending.research')) === JSON.stringify(endingClaim));
    check('L06 终局 ledger 原样保留', JSON.stringify(after.ledgers.find((row) => row.txId === endingLedger.txId)) === JSON.stringify(endingLedger));
  }

  /* L07 封存 */
  {
    const ctx = await migrationFixture({});
    seedRow(ctx, 'state', { key: 'career-archive', schemaVersion: 1, updatedAt: NOW, value: { careerId: 'career-legacy', archivedAt: NOW } });
    const before = await invariants(ctx.db);
    const result = await migrate(ctx);
    check('L07 封存迁移被拒', !result.ok && result.reason === 'career-archived', JSON.stringify(result));
    eqInvariants('L07', before, await invariants(ctx.db));
  }

  /* L08 导入 */
  {
    const ctx = await migrationFixture({ profile: false, pointer: false });
    const payload = payloadWithState([
      discoveryRow({ stage: 'GLIMPSED', clues: {}, runs: {}, professionVersion: 1 }),
      pointerRow('career-imported'),
      { key: 'career-archive', schemaVersion: 1, updatedAt: NOW, value: { careerId: 'career-imported', archivedAt: NOW } },
    ], profileRow('career-imported', { originGameId: null }));
    const parsed = BACKUP.parseAndValidate(JSON.stringify(payload));
    check('L08 导入快照校验通过', parsed.ok, JSON.stringify(parsed));
    const imported = await ctx.db.importAll(parsed.payload, { mode: 'replace' });
    check('L08 replace 导入成功', imported.ok, JSON.stringify(imported));
    const afterImport = await invariants(ctx.db);
    const blocked = await migrate(ctx);
    check('L08 导入后封存守卫生效', !blocked.ok && blocked.reason === 'career-archived', JSON.stringify(blocked));
    eqInvariants('L08 封存态', afterImport, await invariants(ctx.db));
    const thawed = await ctx.db.setCareerArchived(false, { now: LATER });
    check('L08 解冻成功', thawed.ok, JSON.stringify(thawed));
    const afterThaw = await invariants(ctx.db);
    const migrated = await migrate(ctx, LATER);
    check('L08 解冻后迁移 ok', migrated.ok && migrated.careerId === 'career-imported', JSON.stringify(migrated));
    const expectedAssets = clone(afterThaw.assets);
    eq('L08 导入资产迁移不变', (await invariants(ctx.db)).assets, expectedAssets);
    const state = await stateOf(ctx.db);
    eq('L08 导入身份 origin 未捏造', state.acceptedOriginGameId, null);
  }

  /* L09 重复迁移 */
  {
    const ctx = await migrationFixture({
      profileExtra: { originGameId: null },
      rows: { claims: [{ runId: 'run-l', careerId: 'career-legacy', commissionId: C1, claimedAt: '2026-11-20T00:00:00.000Z' }] },
    });
    const first = await migrate(ctx);
    check('L09 首次迁移 ok', first.ok, JSON.stringify(first));
    const before = await invariants(ctx.db);
    const rowBefore = await stateRowOf(ctx.db);
    const second = await migrate(ctx, LATER);
    check('L09 重复迁移 duplicate', second.ok && second.duplicate === true, JSON.stringify(second));
    eqInvariants('L09', before, await invariants(ctx.db));
    eq('L09 discovery 行 time/value 不变', await stateRowOf(ctx.db), rowBefore);
  }

  /* L10 中断重试 */
  {
    const ctx = await migrationFixture({
      profileExtra: { originGameId: null },
      rows: { claims: [{ runId: 'run-l', careerId: 'career-legacy', commissionId: C1, claimedAt: '2026-11-20T00:00:00.000Z' }] },
    });
    const before = await invariants(ctx.db);
    const def = storeDef(ctx, 'state');
    def.failPutKey = 'discovery';
    const failed = await migrate(ctx);
    check('L10 state put 失败整事务回滚', !failed.ok, JSON.stringify(failed));
    eqInvariants('L10 中断零半状态', before, await invariants(ctx.db));
    eq('L10 中断后无 discovery 行', await stateRowOf(ctx.db), null);
    def.failPutKey = null;
    const retried = await migrate(ctx);
    check('L10 重试成功', retried.ok && retried.created === false, JSON.stringify(retried));
    const state = await stateOf(ctx.db);
    eq('L10 重试仅恢复一次接受', state.professionProgress[P].state, 'accepted');
    eq('L10 重试不重发资产', (await invariants(ctx.db)).assets, before.assets);
  }

  /* L11 未知未来版本 */
  {
    const futureState = {
      stage: 'GLIMPSED', clues: {}, runs: {},
      professionVersion: 7,
      acceptedOriginGameId: G,
      activeProfessionId: P,
      futureOnly: { keep: true },
      professionProgress: { [P]: { state: 'accepted', futureFlag: true } },
      storyEvents: { 'story:future': { at: FUTURE, source: 'future' } },
      updatedAt: FUTURE,
    };
    const ctx = await migrationFixture({ state: futureState });
    const before = await invariants(ctx.db);
    const result = await migrate(ctx);
    check('L11 未来版本迁移拒绝', !result.ok && result.reason === 'future-profession-version', JSON.stringify(result));
    eqInvariants('L11', before, await invariants(ctx.db));
    const state = await stateOf(ctx.db);
    eq('L11 未来版本字段只读保留', state.professionVersion, 7);
    eq('L11 未来未知字段保留', state.futureOnly, { keep: true });
  }

  let failed = 0;
  for (const item of results) {
    if (item.ok) console.log('PASS  ' + item.name);
    else {
      failed += 1;
      console.log('FAIL  ' + item.name + (item.detail ? ' — ' + item.detail.slice(0, 900) : ''));
    }
  }
  console.log('');
  console.log((results.length - failed) + '/' + results.length + ' checks passed');
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('ASSEMBLY/RUNTIME FAILED: ' + (err && err.stack ? err.stack : String(err)));
  process.exit(2);
});
