#!/usr/bin/env node
/**
 * Arcade 0.22 T07 — 职业注册扩展 / 跨职业 / 世界工作 / 路线证明整合门禁。
 *
 * 纯 Node + VM：不启动浏览器、不启动端口、不写仓库、不运行 full/release/watch。
 * 运行：node tools/career_profession_extension_test.mjs
 * 退出码：0 全 PASS；1 有 FAIL；2 装配失败。
 *
 * 合成 2 个游戏、3 个职业、9 个委托，只注入各模块输入，不改任何运行时/内容文件。
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
const NOW = '2026-11-27T03:00:00.000Z';
const LATER = '2026-11-27T04:00:00.000Z';

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
function readJson(name) { return JSON.parse(fs.readFileSync(path.join(CONTENT, name), 'utf8')); }

let S;
let V;
let CORE;
let COMMISSION;
let ROUTE;
let EVIDENCE;
let REGISTRY;
let COMMISSIONS;
let CLUES;
let ITEMS;
let CHAPTER;
let CAMPAIGN;
let NPC;
let SIDE;
let WORLD;
let BRIDGE_SRC;
let SW_SRC;
let dbSource;

try {
  S = require(path.join(CAREER, 'profession-state.js'));
  V = require(path.join(CAREER, 'profession-view.js'));
  CORE = require(path.join(CAREER, 'career-core.js'));
  COMMISSION = require(path.join(CAREER, 'commission-core.js'));
  ROUTE = require(path.join(CAREER, 'route-planner.js'));
  EVIDENCE = require(path.join(CAREER, 'story-evidence.js'));
  REGISTRY = readJson('registry.json');
  COMMISSIONS = readJson('commissions.json');
  CLUES = readJson('clues.json');
  ITEMS = readJson('items.json');
  CHAPTER = readJson('chapter-01.json');
  CAMPAIGN = readJson('campaign.json');
  NPC = readJson('npc.json');
  SIDE = readJson('side-stories.json');
  WORLD = readJson('world-work.json');
  BRIDGE_SRC = fs.readFileSync(path.join(CAREER, 'bridge.js'), 'utf8');
  SW_SRC = fs.readFileSync(path.join(ROOT, 'apps/arcade/sw.js'), 'utf8');
  dbSource = fs.readFileSync(path.join(CAREER, 'career-db.js'), 'utf8');
} catch (err) {
  console.error('ASSEMBLY FAILED: ' + (err && err.stack ? err.stack : String(err)));
  process.exit(2);
}

const REAL_SNAPSHOTS = {
  registry: JSON.stringify(REGISTRY),
  commissions: JSON.stringify(COMMISSIONS),
  clues: JSON.stringify(CLUES),
  world: JSON.stringify(WORLD),
};

const future = clone({
  registry: REGISTRY,
  commissions: COMMISSIONS,
  clues: CLUES,
  chapter: CHAPTER,
});
const SYNTHETIC = [
  { professionId: 'service.courier', gameId: 'virtual-courier', displayName: '合成信使' },
  { professionId: 'service.guide', gameId: 'virtual-courier', displayName: '合成引导员' },
  { professionId: 'service.broker', gameId: 'virtual-market', displayName: '合成中间人' },
];
const SYNTHETIC_IDS = SYNTHETIC.map((row) => row.professionId);
const SYNTHETIC_GAME_IDS = ['virtual-courier', 'virtual-market'];

function addSyntheticCatalog() {
  future.registry.games.push(
    { gameId: 'virtual-courier', displayName: '虚拟港口', professions: ['service.courier', 'service.guide'], capabilities: [], watch: [] },
    { gameId: 'virtual-market', displayName: '虚拟集市', professions: ['service.broker'], capabilities: [], watch: [] },
  );
  SYNTHETIC.forEach((row) => {
    future.registry.professions.push({
      professionId: row.professionId,
      displayName: row.displayName,
      domain: 'service',
      capabilities: [],
    });
    future.clues.clues.push({
      clueId: 'CL-' + row.professionId,
      gameId: row.gameId,
      professionId: row.professionId,
      title: row.displayName + '的来信',
      trigger: { kind: 'virtual.done', atLeast: 1 },
      guarantee: { maxEligibleRuns: 3 },
      letter: { body: '合成港口的短笺。' },
    });
    const template = clone(COMMISSIONS.commissions.find((item) => item.commissionId === 'gold-miner.T1'));
    const gameId = row.gameId;
    for (let tier = 1; tier <= 3; tier += 1) {
      const commission = clone(template);
      commission.commissionId = row.professionId + '.T' + tier;
      commission.gameId = gameId;
      commission.professionId = row.professionId;
      commission.tier = tier;
      commission.title = row.displayName + '第 ' + tier + ' 单';
      commission.objective = { kind: 'mineral.returned', atLeast: 2 };
      commission.reward = { credits: 10 * tier, items: {}, evidence: [], flags: [] };
      commission.repeatSalaryCredits = 10 * tier;
      commission.unlock = tier === 1
        ? { all: [] }
        : { all: [{ commissionCleared: row.professionId + '.T' + (tier - 1) }] };
      commission.chapterGate = null;
      future.commissions.commissions.push(commission);
    }
  });
  future.chapter.origins.push({
    gameId: 'virtual-courier',
    professionId: 'service.courier',
    opening: '虚拟港口的纸上还有潮气。',
    c0Letter: { from: '虚拟港口值班', body: '一张新纸', address: '虚拟港口' },
    firstStep: '去虚拟港口的告示板看看。',
  });
}
addSyntheticCatalog();

const futureCatalog = {
  games: future.registry.games,
  professions: future.registry.professions,
  commissions: future.commissions.commissions,
  clues: future.clues.clues,
  tools: [],
  worldWorkIds: WORLD.commissionIds.slice(),
  worldWork: WORLD,
};

function contextFor(extra) {
  return Object.assign({
    now: NOW,
    surface: 'work',
    gameId: null,
    openedClueIds: [],
    knownNpcIds: [],
    worldFlags: [],
    storyEvidence: [],
    clearedCommissions: [],
    activeRuns: [],
    history: [],
    walletKnown: true,
    availableIds: [],
    archived: false,
  }, extra || {});
}
function firstCommission(professionId) {
  return futureCatalog.commissions.find((row) => row.professionId === professionId && row.tier === 1);
}
function reveal(state, professionId, context) {
  return V.canRevealProfession({ state, catalog: futureCatalog, context: context || contextFor(), professionId });
}
function show(state, commissionId, context) {
  return V.canShowCommission({ state, catalog: futureCatalog, context: context || contextFor(), commissionId });
}
function acceptCommission(state, commissionId, context) {
  return V.canAcceptCommission({ state, catalog: futureCatalog, context: context || contextFor(), commissionId });
}
function project(state, context) {
  return V.projectCareerView({ state, catalog: futureCatalog, context: context || contextFor() });
}
function readableState(professionId, gameId, clueId) {
  let state = S.initialState(NOW);
  const glimpsed = S.recordGlimpsed(state, {
    catalog: futureCatalog, professionId, gameId, clueId, at: NOW,
  });
  assert(glimpsed.ok, 'glimpsed ' + JSON.stringify(glimpsed));
  state = glimpsed.state;
  const read = S.recordRead(state, { catalog: futureCatalog, professionId, clueId, at: NOW });
  assert(read.ok, 'read ' + JSON.stringify(read));
  return read.state;
}

/* ------------------------------------------------------------------ *
 * 最小可回滚 IndexedDB：只服务本测试的 real career-db 实例。
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
      objectStoreNames: { contains: (n) => db.stores.has(n) },
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
  vm.runInContext(dbSource, sandbox, { filename: 'career-db.js' });
  return sandbox.module.exports;
}
async function freshDb() {
  const fakeIdb = createFakeIndexedDB();
  const db = loadDb(fakeIdb);
  const opened = await db.open();
  assert(opened.ok, 'open fake IDB: ' + JSON.stringify(opened));
  return { db, fakeIdb };
}
function dbInput(professionId, gameId, clueId) {
  const input = { professionId, gameId, catalog: futureCatalog };
  if (clueId) input.clueId = clueId;
  return input;
}
async function apply(db, action, input, now) {
  const generation = await db.getDiscoveryGeneration();
  const result = await db.applyProfessionEvent({
    action, input, generation: generation.generation, now: now || NOW,
  });
  assert(result.ok, action + ' failed: ' + JSON.stringify(result));
  return result;
}
async function dbReadable(db, professionId, gameId, clueId) {
  await apply(db, 'GLIMPSIED', dbInput(professionId, gameId, clueId), NOW);
  const generation = await db.getDiscoveryGeneration();
  const opened = await db.mergeDiscoveryState({ clues: {} }, [], {
    action: { type: 'CLUE_OPENED', clueId, generation: generation.generation },
  });
  assert(opened.ok, 'clue opened: ' + JSON.stringify(opened));
  await apply(db, 'READ', { professionId, clueId, catalog: futureCatalog }, LATER);
}
async function stateOf(db) {
  const snapshot = await db.getDiscoverySnapshot();
  assert(snapshot.ok, JSON.stringify(snapshot));
  return snapshot.state;
}
async function assetSnapshot(db) {
  const exported = await db.exportAll();
  assert(exported.ok, JSON.stringify(exported));
  const out = {};
  ['profiles', 'balances', 'ledgers', 'runs', 'claims', 'quests', 'inventory', 'equipment'].forEach((name) => {
    out[name] = exported.payload[name];
  });
  return out;
}

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}
function plannerWith(worldWork, registryData, commissionData) {
  const evidence = EVIDENCE.createStoryEvidence ? EVIDENCE.createStoryEvidence({}) : EVIDENCE;
  const config = evidence.configure({
    commissions: commissionData,
    items: ITEMS,
    chapter: registryData === REGISTRY ? CHAPTER : future.chapter,
  });
  assert(config.ok, 'evidence configure: ' + JSON.stringify(config.errors || []));
  const planner = ROUTE.create();
  const planned = planner.configure({
    commissions: commissionData,
    items: ITEMS,
    chapter: registryData === REGISTRY ? CHAPTER : future.chapter,
    registry: registryData,
    materials: null,
    evidence,
    alternatives: { offers: [] },
    worldWork,
  });
  return { planner, config: planned };
}
function hasNoProfessionLeak(steps, ids, names) {
  return steps.every((step) => {
    if (Object.prototype.hasOwnProperty.call(step, 'professionId')) return false;
    const text = [step.title, step.summary, step.reason].filter(Boolean).join(' ');
    return ids.every((id) => text.indexOf(id) < 0) && names.every((name) => text.indexOf(name) < 0);
  });
}

async function main() {
  /* G00 内容快照：测试只注入内存副本 */
  eq('G00 registry 原始快照未改', JSON.stringify(REGISTRY), REAL_SNAPSHOTS.registry);
  eq('G00 commissions 原始快照未改', JSON.stringify(COMMISSIONS), REAL_SNAPSHOTS.commissions);
  eq('G00 world-work 原始快照未改', JSON.stringify(WORLD), REAL_SNAPSHOTS.world);
  check('G00 合成映射来自 registry.games[].professions', future.registry.games
    .filter((game) => SYNTHETIC_GAME_IDS.indexOf(game.gameId) >= 0)
    .every((game) => game.professions.every((id) => future.registry.professions.some((p) => p.professionId === id))));
  check('G00 合成委托/线索均注册', SYNTHETIC.every((row) => {
    const clue = futureCatalog.clues.find((item) => item.clueId === 'CL-' + row.professionId);
    const commission = firstCommission(row.professionId);
    return !!clue && clue.gameId === row.gameId && !!commission && commission.professionId === row.professionId;
  }));

  /* G01 真实模块不硬编码合成职业 ID */
  const sources = [
    fs.readFileSync(path.join(CAREER, 'profession-state.js'), 'utf8'),
    fs.readFileSync(path.join(CAREER, 'profession-view.js'), 'utf8'),
    fs.readFileSync(path.join(CAREER, 'commission-core.js'), 'utf8'),
    fs.readFileSync(path.join(CAREER, 'route-planner.js'), 'utf8'),
  ].join('\n');
  check('G01 运行时不硬编码合成职业 ID', SYNTHETIC_IDS.every((id) => sources.indexOf(id) < 0));

  /* G02 披露 gate / 接受 / 跨职业 */
  SYNTHETIC.forEach((row) => {
    const id = row.professionId;
    const commissionId = firstCommission(id).commissionId;
    let state = S.initialState(NOW);
    eq('G02 ' + id + ' 初始披露', reveal(state, id), { ok: false, reason: 'not-discovered' });
    eq('G02 ' + id + ' 初始任务', show(state, commissionId), { ok: false, reason: 'not-discovered' });
    state = S.recordGlimpsed(state, {
      catalog: futureCatalog, professionId: id, gameId: row.gameId, clueId: 'CL-' + id, at: NOW,
    }).state;
    eq('G02 ' + id + ' glimpsed 仍不披露', reveal(state, id), { ok: false, reason: 'not-discovered' });
    const bypass = S.acceptInvitation(state, {
      catalog: futureCatalog, professionId: id, gameId: row.gameId, at: LATER,
    });
    check('G02 ' + id + ' 直接 accept 失败', bypass.ok === false && bypass.reason === 'not-readable');
    state = S.recordRead(state, { catalog: futureCatalog, professionId: id, clueId: 'CL-' + id, at: NOW }).state;
    eq('G02 ' + id + ' read 在 letter 仅邀请', reveal(state, id, contextFor({ surface: 'letter' })), { ok: true, invitationOnly: true });
    eq('G02 ' + id + ' read 在 work 不披露', reveal(state, id), { ok: false, reason: 'not-accepted' });
    eq('G02 ' + id + ' read 任务不可接', acceptCommission(state, commissionId, contextFor({ availableIds: [commissionId] })), { ok: false, reason: 'not-accepted' });
    check('G02 ' + id + ' 投影无隐藏职业', project(state).professions.length === 0 && project(state).commissions.length === 0);
    const accepted = S.acceptInvitation(state, {
      catalog: futureCatalog, professionId: id, gameId: row.gameId, at: LATER,
    });
    check('G02 ' + id + ' 合法接受', accepted.ok && accepted.newlyAccepted === true && accepted.state.acceptedOriginGameId === row.gameId);
    eq('G02 ' + id + ' 接受后可披露', reveal(accepted.state, id), { ok: true });
    eq('G02 ' + id + ' 接受后任务可见', show(accepted.state, commissionId), { ok: true });
    const duplicate = S.acceptInvitation(accepted.state, {
      catalog: futureCatalog, professionId: id, gameId: row.gameId, at: '2026-11-27T05:00:00.000Z',
    });
    check('G02 ' + id + ' 重复接受 no-op', duplicate.ok && duplicate.duplicate === true
      && JSON.stringify(duplicate.state) === JSON.stringify(accepted.state));
  });

  /* G03 真实 DB：A 先发现，B 先接受；第二职业无重复初始资产；无序章 */
  const ctx = await freshDb();
  const a = SYNTHETIC[0];
  const first = SYNTHETIC[1];
  await dbReadable(ctx.db, a.professionId, a.gameId, 'CL-' + a.professionId);
  await dbReadable(ctx.db, first.professionId, first.gameId, 'CL-' + first.professionId);
  const firstAccept = await apply(ctx.db, 'ACCEPT_INVITATION', dbInput(first.professionId, first.gameId), '2026-11-27T03:10:00.000Z');
  check('G03 B 先接受创建唯一身份', firstAccept.created === true && firstAccept.newlyAccepted === true, JSON.stringify(firstAccept));
  const afterFirst = await assetSnapshot(ctx.db);
  const stateAfterFirst = await stateOf(ctx.db);
  eq('G03 起源来自首次接受而非首次发现', stateAfterFirst.acceptedOriginGameId, first.gameId);
  eq('G03 A 仍仅是 read', stateAfterFirst.professionProgress[a.professionId].state, 'read');
  const secondAccept = await apply(ctx.db, 'ACCEPT_INVITATION', dbInput(a.professionId, a.gameId), '2026-11-27T03:20:00.000Z');
  check('G03 A 后接受 created=false', secondAccept.created === false && secondAccept.newlyAccepted === true, JSON.stringify(secondAccept));
  eq('G03 第二职业 careerId 不变', secondAccept.careerId, firstAccept.careerId);
  eq('G03 第二职业无重复初始资产', await assetSnapshot(ctx.db), afterFirst);
  const stateAfterBoth = await stateOf(ctx.db);
  eq('G03 起源未被后接受改写', stateAfterBoth.acceptedOriginGameId, first.gameId);
  eq('G03 两职业均 accepted', [
    stateAfterBoth.professionProgress[a.professionId].state,
    stateAfterBoth.professionProgress[first.professionId].state,
  ], ['accepted', 'accepted']);
  const paused = await apply(ctx.db, 'SET_PAUSED', {
    professionId: a.professionId, paused: true, catalog: futureCatalog,
  }, '2026-11-27T03:30:00.000Z');
  check('G03 搁置成功且不影响另一职业', paused.ok && paused.duplicate === false);
  const pausedState = await stateOf(ctx.db);
  eq('G03 搁置状态正交', pausedState.professionProgress[a.professionId].state, 'accepted');
  check('G03 搁置为 true', pausedState.professionProgress[a.professionId].paused === true);
  check('G03 另一职业未搁置', pausedState.professionProgress[first.professionId].paused === false);

  /* G04 真实 commission-core：世界工作可接但不泄露拥有职业 */
  const commissionCore = COMMISSION.createCommissionCore({
    db: ctx.db,
    core: CORE,
    now: () => NOW,
    storage: fakeStorage(),
  });
  const configured = commissionCore.configure({
    content: future.commissions,
    catalog: futureCatalog,
    worldWork: WORLD,
  });
  check('G04 commission-core 扩展目录可配置', configured.ok === true, JSON.stringify(configured.errors || []));
  const listing = await commissionCore.listAvailable({ careerId: firstAccept.careerId, context: { surface: 'work' } });
  check('G04 listAvailable 返回权威可接集合', listing.ok === true, JSON.stringify(listing));
  const ids = Array.isArray(listing.availableIds) ? listing.availableIds : [];
  const initialWorldIds = future.commissions.commissions
    .filter((row) => row.tier === 1 && WORLD.commissionIds.indexOf(row.commissionId) >= 0)
    .map((row) => row.commissionId);
  check('G04 B 首单可接', ids.indexOf(firstCommission(first.professionId).commissionId) >= 0, JSON.stringify(ids.slice(0, 12)));
  check('G04 A 搁置不阻塞世界工作', initialWorldIds.every((id) => ids.indexOf(id) >= 0), JSON.stringify(initialWorldIds));
  check('G04 W5E 初始单对已接受职业开放', initialWorldIds.length > 0 && initialWorldIds.every((id) => ids.indexOf(id) >= 0));
  check('G04 未接受职业 C 首单不可接', ids.indexOf(firstCommission(SYNTHETIC[2].professionId).commissionId) < 0);
  const worldRows = (listing.commissions || []).filter((row) => WORLD.commissionIds.indexOf(row.commissionId) >= 0);
  eq('G04 世界工作初始可接行数', worldRows.length, initialWorldIds.length);
  check('G04 世界工作只按世界类别披露', worldRows.every((row) => row.category === 'world' && row.worldWork === true
    && !Object.prototype.hasOwnProperty.call(row, 'professionId')));
  const worldText = JSON.stringify(worldRows);
  check('G04 世界工作不泄露拥有职业 ID/展示名', SYNTHETIC_IDS.every((id) => worldText.indexOf(id) < 0)
    && SYNTHETIC.map((row) => row.displayName).every((name) => worldText.indexOf(name) < 0));
  const startResult = await commissionCore.start({
    commissionId: firstCommission(first.professionId).commissionId,
    careerId: firstAccept.careerId,
    context: { surface: 'work' },
  });
  check('G04 合成职业可接受委托并签发票', startResult.ok === true && startResult.commissionId === firstCommission(first.professionId).commissionId,
    JSON.stringify(startResult));
  const deniedStart = await commissionCore.start({
    commissionId: firstCommission(SYNTHETIC[2].professionId).commissionId,
    careerId: firstAccept.careerId,
    context: { surface: 'work' },
  });
  check('G04 未接受职业委托直接 start 被拒', deniedStart.ok === false, JSON.stringify(deniedStart));

  /* G05 路线证明：真实内容不变，合成职业逐一走通世界工作链 */
  const realPlanner = plannerWith(WORLD, REGISTRY, clone(COMMISSIONS));
  const futurePlanner = plannerWith(WORLD, future.registry, future.commissions);
  check('G05 真实/扩展 planner 均可配置', realPlanner.config.ok === true && futurePlanner.config.ok === true,
    JSON.stringify({ real: realPlanner.config.errors, future: futurePlanner.config.errors }));
  const realPath = realPlanner.planner.worldWorkPath({
    originGameId: 'gold-miner', acceptedProfessionId: 'nature.miner',
    wallet: { credits: 80, items: {} }, flags: ['C0.port_seen'],
  });
  const futureRealPath = futurePlanner.planner.worldWorkPath({
    originGameId: 'gold-miner', acceptedProfessionId: 'nature.miner',
    wallet: { credits: 80, items: {} }, flags: ['C0.port_seen'],
  });
  eq('G05 合成职业不污染真实起源路径', {
    originCommissionId: futureRealPath.originCommissionId,
    planned: futureRealPath.plannedWorldCommissionIds,
    flags: futureRealPath.flagsAfter,
    economy: futureRealPath.economy,
  }, {
    originCommissionId: realPath.originCommissionId,
    planned: realPath.plannedWorldCommissionIds,
    flags: realPath.flagsAfter,
    economy: realPath.economy,
  });
  const pairs = [
    { label: '新职业本游戏', gameId: 'virtual-courier', professionId: 'service.courier' },
    { label: '同游戏第二职业', gameId: 'virtual-courier', professionId: 'service.guide' },
    { label: '跨游戏 T1', gameId: 'virtual-courier', professionId: 'service.broker' },
    { label: '新职业 T1 所在游戏', gameId: 'virtual-market', professionId: 'service.broker' },
  ];
  pairs.forEach((pair) => {
    const path = futurePlanner.planner.worldWorkPath({
      originGameId: pair.gameId,
      acceptedProfessionId: pair.professionId,
      wallet: { credits: 80, items: {} },
      flags: ['C0.port_seen'],
    });
    check('G05 ' + pair.label + ' 路径完整', path.ok === true && path.complete === true, JSON.stringify(path.blockers || []));
    eq('G05 ' + pair.label + ' W5E 全集', Array.from(path.plannedWorldCommissionIds || []).sort(), WORLD.commissionIds.slice().sort());
    check('G05 ' + pair.label + ' 通用步骤无职业/委托泄漏', hasNoProfessionLeak(
      (path.steps || []).filter((step) => step.category === 'world'),
      REGISTRY.professions.map((row) => row.professionId).concat(SYNTHETIC_IDS),
      REGISTRY.professions.map((row) => row.displayName).filter(Boolean).concat(SYNTHETIC.map((row) => row.displayName)),
    ));
  });
  const realValidate = realPlanner.planner.validate();
  const futureValidate = futurePlanner.planner.validate();
  check('G05 validate 全对通过', futureValidate.ok === true && futureValidate.worldWorkPathProof
    && futureValidate.worldWorkPathProof.failures.length === 0
    && futureValidate.worldWorkPathProof.passed === futureValidate.worldWorkPathProof.pairCount,
    JSON.stringify(futureValidate.worldWorkPathProof && {
      pairCount: futureValidate.worldWorkPathProof.pairCount,
      failures: futureValidate.worldWorkPathProof.failures,
    }));
  check('G05 pairCount 随注册扩展增长', futureValidate.worldWorkPathProof.pairCount > realValidate.worldWorkPathProof.pairCount);
  check('G05 validate 覆盖同游戏第二职业', futureValidate.worldWorkPathProof.pairs.some((pair) =>
    pair.gameId === 'virtual-courier' && pair.professionId === 'service.guide'));
  check('G05 validate 覆盖跨游戏 T1', futureValidate.worldWorkPathProof.pairs.some((pair) =>
    pair.gameId === 'virtual-courier' && pair.professionId === 'service.broker'));

  /* G06 离线资源清单静态断言（不运行 PWA） */
  check('G06 profession-state.js 是 bridge required 依赖', /\{\s*file:\s*'profession-state\.js',\s*global:\s*'professionState',\s*required:\s*true\s*\}/.test(BRIDGE_SRC));
  check('G06 profession-view.js 为同源可加载依赖', /\{\s*file:\s*'profession-view\.js'[\s\S]{0,120}required:\s*false[\s\S]{0,40}lazy:\s*true\s*\}/.test(BRIDGE_SRC));
  check('G06 SW 同源缓存 profession-state.js', /'\.\/career\/profession-state\.js'/.test(SW_SRC));
  check('G06 SW 同源缓存 profession-view.js', /'\.\/career\/profession-view\.js'/.test(SW_SRC));
  check('G06 SW 同源缓存 world-work.json', /'\.\/career\/content\/world-work\.json'/.test(SW_SRC));
  check('G06 SW 未引入跨域资源', !/https?:\/\//.test(SW_SRC.slice(SW_SRC.indexOf('const CORE_PATHS'), SW_SRC.indexOf('const CORE ='))));

  /* G07 最终快照 */
  eq('G07 registry 原始内容快照仍不变', JSON.stringify(REGISTRY), REAL_SNAPSHOTS.registry);
  eq('G07 commissions 原始内容快照仍不变', JSON.stringify(COMMISSIONS), REAL_SNAPSHOTS.commissions);
  eq('G07 world-work 原始内容快照仍不变', JSON.stringify(WORLD), REAL_SNAPSHOTS.world);

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
