#!/usr/bin/env node
/**
 * StudioKit Arcade 0.22 — T02 职业发现 / bridge 事务门面 / 入口 gate（纯 Node，无浏览器）。
 *
 * 运行：node tools/career_profession_discovery_test.mjs
 * 退出码：0 全 PASS；1 有 FAIL；2 装配失败。
 *
 * 覆盖：
 * - normalizeState 经 profession-state 合并扩展、坏快照不猜接受事实、未来版本只读保留；
 * - 真实 RUN_ENDED→GLIMPSED / CLUE_OPENED→READ，全部映射来自 registry/clues，含 N+1；
 * - bridge 只读 careerView、 professionView、深链 gate、debug/旧 URL fail-closed；
 * - accept/setActive/setPaused 只走 applyProfessionEvent；失败无半状态、重复 no-op；
 * - resolveStoryCareer 不再 ensureCareer，listAvailable 门面强制 ensure:false；
 * - discovery→DB→重开页的扩展往返；16 个游戏页的生涯适配器锚点静态核对。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CAREER = path.join(ROOT, 'apps', 'arcade', 'career');
const BRIDGE_SRC = fs.readFileSync(path.join(CAREER, 'bridge.js'), 'utf8');
const DISCOVERY_SRC = fs.readFileSync(path.join(CAREER, 'discovery.js'), 'utf8');
const ROUTER_SRC = fs.readFileSync(path.join(CAREER, 'router.js'), 'utf8');
const ENTRY_ROUTER_SRC = fs.readFileSync(path.join(CAREER, 'entry-router.js'), 'utf8');
const REGISTRY = JSON.parse(fs.readFileSync(path.join(CAREER, 'content', 'registry.json'), 'utf8'));
const CLUES_BUNDLE = JSON.parse(fs.readFileSync(path.join(CAREER, 'content', 'clues.json'), 'utf8'));
const COMMISSIONS_BUNDLE = JSON.parse(fs.readFileSync(path.join(CAREER, 'content', 'commissions.json'), 'utf8'));
const professionState = require(path.join(CAREER, 'profession-state.js'));
const registryModule = require(path.join(CAREER, 'registry.js'));
const discovery = require(path.join(CAREER, 'discovery.js'));
const router = require(path.join(CAREER, 'router.js'));
const entryRouter = require(path.join(CAREER, 'entry-router.js'));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? '' : detail === undefined ? '' : String(detail) });
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'expected ' + e + ' got ' + a);
}
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
function catalogOf() {
  return {
    schemaVersion: 1,
    contentVersion: '0.18.0',
    games: clone(REGISTRY.games),
    professions: clone(REGISTRY.professions),
    commissions: clone(COMMISSIONS_BUNDLE.commissions),
    clues: clone(CLUES_BUNDLE.clues),
  };
}
function clueOf(gameId) {
  return CLUES_BUNDLE.clues.find((row) => row.gameId === gameId) || null;
}
function watchOf(gameId) {
  const game = REGISTRY.games.find((row) => row.gameId === gameId);
  return game && game.watch ? game.watch.map((row) => row.kind) : [];
}
function at(second) {
  return '2026-02-03T04:05:' + String(second).padStart(2, '0') + '.000Z';
}

/* ------------------------------------------------------------------ *
 * D-01 normalizeState：canonical 扩展往返、坏快照、未来版本
 * ------------------------------------------------------------------ */
{
  const raw = {
    stage: 'CURIOUS',
    firstSourceGame: 'gold-miner',
    firstClueId: 'CL-gold-miner',
    clues: { 'CL-gold-miner': { sourceGame: 'gold-miner', openedAt: at(1) } },
    professionVersion: 1,
    firstDiscoveredGameId: 'gold-miner',
    acceptedOriginGameId: 'gold-miner',
    activeProfessionId: 'nature.miner',
    narrativeCursor: { chapterId: 'C1', nodeId: 'story:C1.signal' },
    storyEvents: { 'story:C0.port_seen': { at: at(2), source: 'commission' } },
    professionProgress: {
      'nature.miner': { state: 'accepted', paused: true, discoveredAt: at(1), readAt: at(1), acceptedAt: at(2), completedAt: null },
    },
  };
  const normalized = discovery.normalizeState(raw, at(3));
  eq('D-01a normalizeState 保留 professionVersion', normalized.professionVersion, 1);
  eq('D-01b 保留 firstDiscoveredGameId', normalized.firstDiscoveredGameId, 'gold-miner');
  eq('D-01c 保留 acceptedOriginGameId', normalized.acceptedOriginGameId, 'gold-miner');
  eq('D-01d 保留 activeProfessionId', normalized.activeProfessionId, 'nature.miner');
  eq('D-01e 保留 narrativeCursor', normalized.narrativeCursor, { chapterId: 'C1', nodeId: 'story:C1.signal' });
  eq('D-01f 保留 storyEvents', normalized.storyEvents, raw.storyEvents);
  eq('D-01g 保留 professionProgress', normalized.professionProgress, raw.professionProgress);
  check('D-01h extensionOf 不写回 discovery 既有字段', !('clues' in (professionState.extensionOf(normalized) || {})));

  const broken = {
    stage: 'GLIMPSED',
    firstSourceGame: 'memory-flip',
    clues: { 'CL-memory-flip': { sourceGame: 'memory-flip' } },
    acceptedOriginGameId: 'NOT A GAME',
    activeProfessionId: 42,
    professionProgress: { 'BAD ID': { state: 'accepted', acceptedAt: 'not-a-time' } },
    storyEvents: { 'bad-key': { at: at(1) } },
  };
  const safe = discovery.normalizeState(broken, at(4));
  eq('D-02a 坏起源不猜测，清为 null', safe.acceptedOriginGameId, null);
  eq('D-02b 坏当前职业不猜测', safe.activeProfessionId, null);
  eq('D-02c 坏职业 ID 不进入扩展', Object.keys(safe.professionProgress), []);
  eq('D-02d 坏事件 key 不进入扩展', Object.keys(safe.storyEvents), []);
  eq('D-02e firstSourceGame 仍按旧线索事实保留', safe.firstDiscoveredGameId, 'memory-flip');

  const future = {
    professionVersion: 9,
    acceptedOriginGameId: 'gold-miner',
    futureOnlyField: { nested: true },
    clues: {},
  };
  const futureState = discovery.normalizeState(future, at(5));
  eq('D-03a 未来版本原样读出', futureState.professionVersion, 9);
  eq('D-03b 未来字段只读保留', futureState.futureOnlyField, { nested: true });
  check('D-03c 未来档 gate 不按当前语义升级', !futureState.professionProgress || !Object.keys(futureState.professionProgress).length);
}

/* ------------------------------------------------------------------ *
 * D-02 真实发现 / 读信事件与注册表映射
 * ------------------------------------------------------------------ */
const glimpsedInputs = [];
const readInputs = [];
const originalGlimpsed = professionState.recordGlimpsed;
const originalRead = professionState.recordRead;
professionState.recordGlimpsed = function (state, input) {
  glimpsedInputs.push(clone(input));
  return originalGlimpsed(state, input);
};
professionState.recordRead = function (state, input) {
  readInputs.push(clone(input));
  return originalRead(state, input);
};
{
  const catalog = catalogOf();
  const deps = { clueConfigs: catalog.clues, catalog };
  let state = discovery.initialState(at(0));
  let glimpsedOk = true;
  let readOk = true;
  REGISTRY.games.forEach((game, index) => {
    const clue = clueOf(game.gameId);
    const kind = watchOf(game.gameId)[0];
    const run = discovery.reduce(state, {
      type: 'RUN_ENDED',
      run: {
        gameId: game.gameId,
        runId: 'real-' + game.gameId,
        mode: 'classic',
        outcome: 'won',
        events: { [kind]: clue.trigger.atLeast },
      },
      at: at(10 + index),
    }, deps);
    const event = run.professionEvent;
    const professionId = game.professions[0];
    if (!event || event.action !== 'GLIMPSED' || event.input.professionId !== professionId
      || event.input.gameId !== game.gameId || event.input.clueId !== clue.clueId) glimpsedOk = false;
    const progress = run.state.professionProgress[professionId];
    if (!progress || progress.state !== 'glimpsed' || run.state.firstDiscoveredGameId !== null
      && run.state.firstDiscoveredGameId !== game.gameId) {
      if (!progress || progress.state !== 'glimpsed') glimpsedOk = false;
    }
    state = run.state;
    const opened = discovery.reduce(state, {
      type: 'CLUE_OPENED',
      clueId: clue.clueId,
      at: at(40 + index),
    }, deps);
    const readEvent = opened.professionEvent;
    const readProgress = opened.state.professionProgress[professionId];
    if (!readEvent || readEvent.action !== 'READ' || readEvent.input.clueOpened !== true
      || readEvent.input.gameId !== game.gameId || readEvent.input.clueId !== clue.clueId) readOk = false;
    if (!readProgress || readProgress.state !== 'read' || !readProgress.readAt) readOk = false;
    state = opened.state;
  });
  check('D-04a 16 个真实游戏结算均从 registry/clues 映射出 GLIMPSED', glimpsedOk);
  check('D-04b 16 条真实线索打开均带 clueOpened:true 与真实 ID 驱动 READ', readOk);
  eq('D-04c 16 次 GLIMPSED 输入被记录', glimpsedInputs.length, 16);
  eq('D-04d 16 次 READ 输入被记录', readInputs.length, 16);
  eq('D-04e 全部职业进入 read 状态', Object.values(state.professionProgress).filter((row) => row.state === 'read').length, 16);
  check('D-04f 阅读不改变首次发现事实', state.firstDiscoveredGameId === REGISTRY.games[0].gameId);
  check('D-04g 未接受前 acceptedOriginGameId 恒为 null', state.acceptedOriginGameId === null);

  const mismatchCatalog = catalogOf();
  mismatchCatalog.games.find((row) => row.gameId === 'gold-miner').professions = [];
  const mismatch = discovery.reduce(discovery.initialState(at(60)), {
    type: 'RUN_ENDED',
    run: { gameId: 'gold-miner', runId: 'bad-map', mode: 'classic', outcome: 'won', events: { 'mineral.returned': 2 } },
    at: at(61),
  }, { clueConfigs: mismatchCatalog.clues, catalog: mismatchCatalog });
  eq('D-05a 错配映射返回结构化错误', mismatch.professionError, 'profession-game-mismatch');
  eq('D-05b 错配映射不写职业状态', Object.keys(mismatch.state.professionProgress), []);

  const virtualClue = {
    clueId: 'CL-virtual-1',
    gameId: 'virtual-game',
    trigger: { kind: 'virtual.done', atLeast: 1 },
    guarantee: { maxEligibleRuns: 3 },
    letter: { body: '虚拟线索正文' },
  };
  const virtualCatalog = {
    schemaVersion: 1,
    games: [{ gameId: 'virtual-game', professions: ['virtual.one', 'virtual.two'] }],
    professions: [{ professionId: 'virtual.one' }, { professionId: 'virtual.two' }],
    commissions: [],
    clues: [virtualClue],
  };
  const virtual = discovery.reduce(discovery.initialState(at(62)), {
    type: 'RUN_ENDED',
    run: { gameId: 'virtual-game', runId: 'virtual-1', mode: 'classic', outcome: 'won', events: { 'virtual.done': 1 } },
    at: at(63),
  }, { clueConfigs: [virtualClue], catalog: virtualCatalog });
  eq('D-06a N+1 单局产出两个映射职业事件', virtual.professionEvents.length, 2);
  eq('D-06b N+1 职业状态来自 catalog', Object.keys(virtual.state.professionProgress), ['virtual.one', 'virtual.two']);
  check('D-06c 纯路由/发现模块无硬编码职业 ID', !/nature\.miner|research\.archivist|adventure\.pilot/.test(DISCOVERY_SRC + ROUTER_SRC + ENTRY_ROUTER_SRC));
}
professionState.recordGlimpsed = originalGlimpsed;
professionState.recordRead = originalRead;

const CONTENT_FILES = fs.readdirSync(path.join(CAREER, 'content')).filter((name) => name.endsWith('.json'));
const CONTENT = Object.create(null);
CONTENT_FILES.forEach((name) => {
  CONTENT[name] = JSON.parse(fs.readFileSync(path.join(CAREER, 'content', name), 'utf8'));
});

function makeStore(overrides) {
  const options = overrides || {};
  return Object.assign({
    discovery: options.discovery || discovery.initialState(at(0)),
    generation: 1,
    identity: options.identity || null,
    balances: {},
    applyCalls: [],
    mergeCalls: [],
    ensureCalls: [],
    listingCalls: [],
    startCalls: [],
    configureCalls: [],
    viewCalls: [],
    uiCalls: [],
    warnings: [],
    failApply: options.failApply === true,
    validateCalls: [],
    ticketResult: options.ticketResult || null,
    acceptedCommissionIds: options.acceptedCommissionIds || [],
  }, options);
}

function stateWithProgress(progress, extra) {
  const base = discovery.initialState(at(1));
  base.clues = { 'CL-gold-miner': { clueId: 'CL-gold-miner', sourceGame: 'gold-miner', seenAt: at(1), openedAt: at(2), dismissed: false } };
  base.stage = 'CURIOUS';
  base.firstClueId = 'CL-gold-miner';
  base.firstSourceGame = 'gold-miner';
  base.professionProgress = clone(progress);
  return Object.assign(base, extra || {});
}

function acceptedProgress(ids) {
  const out = {};
  ids.forEach((id) => {
    out[id] = { state: 'accepted', paused: false, discoveredAt: at(1), readAt: at(2), acceptedAt: at(3), completedAt: null };
  });
  return out;
}

function readProgress(ids) {
  const out = {};
  ids.forEach((id) => {
    out[id] = { state: 'read', paused: false, discoveredAt: at(1), readAt: at(2), acceptedAt: null, completedAt: null };
  });
  return out;
}

async function makeBridge(options) {
  const opts = options || {};
  const store = opts.store || makeStore(opts);
  const sandbox = {
    console: { warn(...args) { store.warnings.push(args.map(String).join(' ')); }, log() {}, error() {} },
    setTimeout,
    clearTimeout,
    Promise,
    Math,
    JSON,
    Date,
    URL,
    URLSearchParams,
    WeakMap,
    Set,
    navigator: { userAgent: 'node', serviceWorker: null },
    location: {
      href: opts.href || 'http://localhost/apps/arcade/games/gold-miner.html',
      pathname: opts.pathname || '/apps/arcade/games/gold-miner.html',
      search: opts.search || '',
      hash: opts.hash || '',
      origin: 'http://localhost',
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    indexedDB: undefined,
    crypto: undefined,
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    addEventListener() {},
    removeEventListener() {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const overlay = {
    isConnected: true,
    style: {},
    querySelector: () => null,
    getClientRects: () => [{}],
    appendChild() {},
    ownerDocument: null,
  };
  const doc = {
    readyState: 'complete',
    hidden: false,
    documentElement: { style: {}, appendChild() {} },
    body: { style: {}, appendChild() {}, insertAdjacentElement() {} },
    head: { appendChild(node) { if (node.tagName === 'LINK' && typeof node.onload === 'function') setTimeout(() => node.onload(), 0); } },
    currentScript: { src: 'http://localhost/apps/arcade/career/bridge.js' },
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) {
      if (selector === '[data-overlay]' || selector === '.game-page') return overlay;
      if (selector === '.game-topbar .ac-back[href]') return { href: '../index.html' };
      return null;
    },
    querySelectorAll: () => [],
    createElement(tag) {
      const node = {
        tagName: String(tag).toUpperCase(),
        style: {},
        children: [],
        className: '',
        setAttribute() {},
        appendChild(child) { this.children.push(child); return child; },
        insertAdjacentElement() {},
        textContent: '',
      };
      return node;
    },
  };
  overlay.ownerDocument = doc;
  sandbox.document = doc;
  sandbox.fetch = async (url) => {
    const name = String(url).split('/').pop().split('?')[0];
    if (Object.prototype.hasOwnProperty.call(CONTENT, name)) {
      return { ok: true, status: 200, json: async () => clone(CONTENT[name]) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const db = {
    ready: Promise.resolve({ ok: true }),
    async open() { return { ok: true }; },
    async getArchiveState() { return { archived: false, careerId: null, archivedAt: null }; },
    async getDiscoveryGeneration() { return { ok: true, generation: store.generation }; },
    async getDiscoverySnapshot() { return { ok: true, state: clone(store.discovery), generation: store.generation }; },
    async getDiscoveryState() { return clone(store.discovery); },
    async readHubEntry() {
      return { ok: true, started: !!store.identity, archived: false, careerId: store.identity ? store.identity.careerId : null, issue: null };
    },
    async ensureCareer() { store.ensureCalls.push([]); throw new Error('bridge must not ensureCareer'); },
    mergeDiscoveryState(state, records, options) {
      const action = options && options.action ? options.action : {};
      store.mergeCalls.push(clone(options));
      if (Number(action.generation) !== store.generation) return Promise.resolve({ ok: false, reason: 'stale-generation' });
      const incoming = discovery.normalizeState(state, action.at || at(70));
      const existing = clone(store.discovery) || null;
      let merged;
      if (['RUN_ENDED', 'CLUE_OPENED'].indexOf(action.type) >= 0) {
        merged = existing
          ? professionState.mergeIntoDiscovery(existing, professionState.extensionOf(incoming), incoming.updatedAt)
          : incoming;
      } else {
        merged = professionState.mergeIntoDiscovery(incoming, existing ? professionState.extensionOf(existing) : null, incoming.updatedAt);
      }
      if (!merged.clues) merged.clues = {};
      (Array.isArray(records) ? records : records ? [records] : []).forEach((row) => {
        if (row && row.clueId) merged.clues[row.clueId] = clone(row);
      });
      store.discovery = merged;
      return Promise.resolve({ ok: true, generation: store.generation, value: clone(merged) });
    },
    applyProfessionEvent(payload) {
      store.applyCalls.push(clone(payload));
      if (Number(payload.generation) !== store.generation) return Promise.resolve({ ok: false, reason: 'stale-generation' });
      if (store.failApply) return Promise.resolve({ ok: false, reason: 'transaction-aborted' });
      const fn = {
        GLIMPSED: 'recordGlimpsed',
        READ: 'recordRead',
        ACCEPT_INVITATION: 'acceptInvitation',
        SET_ACTIVE: 'setActive',
        SET_PAUSED: 'setPaused',
      }[payload.action];
      if (!fn) return Promise.resolve({ ok: false, reason: 'unknown-action' });
      const result = professionState[fn](clone(store.discovery), payload.input);
      if (!result || result.ok !== true) return Promise.resolve(result || { ok: false, reason: 'reducer-failed' });
      const nextIdentity = clone(store.identity) || {};
      let created = false;
      if (result.newlyAccepted === true && !store.identity) {
        nextIdentity.careerId = 'career-test-1';
        store.balances[nextIdentity.careerId] = 80;
        created = true;
      }
      store.discovery = result.state;
      store.identity = nextIdentity;
      return Promise.resolve({
        ok: true,
        duplicate: result.duplicate === true,
        newlyAccepted: result.newlyAccepted === true,
        created,
        careerId: nextIdentity ? nextIdentity.careerId : null,
        generation: store.generation,
      });
    },
    async readQuestState() { return { ok: true, quests: [] }; },
    async readWallet(careerId) { return { ok: true, credits: store.balances[careerId] || 0, items: {} }; },
    async getEquipment() { return { ok: true, equipment: {} }; },
    async repairEndingRecords() { return { ok: true }; },
  };

  const commissioned = COMMISSIONS_BUNDLE.commissions;
  function acceptedProfessionIds(state) {
    const progress = state && state.professionProgress ? state.professionProgress : {};
    return Object.keys(progress).filter((id) => progress[id] && ['accepted', 'developed', 'completed'].indexOf(progress[id].state) >= 0);
  }
  const commissionModule = {
    configure(payload) { store.configureCalls.push(['commission', clone(payload)]); return { ok: true, errors: [] }; },
    listAvailable(input) {
      store.listingCalls.push(clone(input));
      const state = input && input.state ? input.state : store.discovery;
      const accepted = acceptedProfessionIds(state);
      const catalog = input && input.catalog ? input.catalog : {};
      const worldIds = (Array.isArray(catalog.worldWorkIds) ? catalog.worldWorkIds : [])
        .concat(catalog.worldWork && Array.isArray(catalog.worldWork.commissionIds) ? catalog.worldWork.commissionIds : []);
      const visible = commissioned.filter((row) => {
        if (store.acceptedCommissionIds.indexOf(row.commissionId) >= 0) return true;
        if (worldIds.indexOf(row.commissionId) >= 0) return accepted.length > 0;
        return accepted.indexOf(row.professionId) >= 0;
      }).map((row) => {
        const world = worldIds.indexOf(row.commissionId) >= 0;
        const entry = world && catalog.worldWork && Array.isArray(catalog.worldWork.entries)
          ? catalog.worldWork.entries.find((item) => item && item.commissionId === row.commissionId) || null
          : null;
        const out = {
          commissionId: row.commissionId,
          gameId: row.gameId,
          category: world ? 'world' : 'profession',
          worldWork: world,
          title: world && entry ? entry.title : row.title,
          summary: world && entry ? entry.summary : row.summary,
          unlocked: true,
        };
        if (!world) out.professionId = row.professionId;
        return out;
      });
      return { ok: true, careerId: (input && input.careerId) || null, commissions: visible, availableIds: visible.map((row) => row.commissionId) };
    },
    start(input) { store.startCalls.push(clone(input)); return { ok: false, reason: 'test-start' }; },
    validateTicket(input) { store.validateCalls.push(clone(input)); return clone(store.ticketResult) || { ok: false, reason: 'no-ticket-fixture' }; },
    continuations() { return { ok: true, careerId: store.identity ? store.identity.careerId : null, runs: [] }; },
    markActive() { return true; },
    recordEvent() { return true; },
    settle() { return { ok: false, reason: 'test' }; },
    adoptRun() { return true; },
    getState() { return { ok: true, events: [] }; },
  };

  const professionView = {
    canRevealProfession(input) {
      store.viewCalls.push(['reveal', clone(input)]);
      const row = input.state && input.state.professionProgress ? input.state.professionProgress[input.professionId] : null;
      return row && ['glimpsed', 'read', 'accepted', 'developed', 'completed'].indexOf(row.state) >= 0
        ? { ok: true, reason: 'ok' }
        : { ok: false, reason: 'not-discovered' };
    },
    canShowCommission(input) {
      store.viewCalls.push(['show', clone(input)]);
      const row = commissioned.find((candidate) => candidate.commissionId === input.commissionId);
      const accepted = acceptedProfessionIds(input.state);
      const context = input.context || {};
      const available = Array.isArray(context.availableIds) ? context.availableIds : [];
      if (context.bridgeCoreAuthority === true) {
        return available.indexOf(input.commissionId) >= 0
          ? { ok: true, reason: 'core-authoritative' }
          : { ok: false, reason: 'not-available' };
      }
      const worldIds = input.catalog && Array.isArray(input.catalog.worldWorkIds) ? input.catalog.worldWorkIds : [];
      const allowed = worldIds.indexOf(input.commissionId) >= 0
        || store.acceptedCommissionIds.indexOf(input.commissionId) >= 0
        || (row && accepted.indexOf(row.professionId) >= 0);
      return allowed ? { ok: true, reason: 'historical-only' } : { ok: false, reason: 'not-accepted' };
    },
    canAcceptCommission() { return { ok: false, reason: 'not-available' }; },
    getVisibleCommissions(input) {
      return commissionModule.listAvailable({ state: input.state, catalog: input.catalog, context: input.context }).commissions;
    },
    getNextNarrativeAction() { return null; },
    projectCareerView(input) {
      store.viewCalls.push(['project', clone(input)]);
      const accepted = acceptedProfessionIds(input.state);
      return {
        schemaVersion: 1,
        originGameId: (input.state && input.state.acceptedOriginGameId) || null,
        activeProfessionId: (input.state && input.state.activeProfessionId) || null,
        professions: accepted.map((id) => ({ professionId: id })),
        commissions: [],
        story: { nextAction: null, messages: [], history: [] },
        tools: [],
        __context: clone(input.context),
        __catalogGames: input.catalog && Array.isArray(input.catalog.games) ? input.catalog.games.length : 0,
      };
    },
  };

  const noopModule = { configure(payload) { store.configureCalls.push(['noop', clone(payload)]); return { ok: true }; } };
  sandbox.ArcadeCareer = {
    router,
    entryRouter,
    registry: registryModule,
    professionState,
    discovery,
    db,
    core: { isValidCareerId: (id) => typeof id === 'string' && id.startsWith('career-') },
    professionView,
    commission: commissionModule,
    backup: { importCareerLife: async () => ({ ok: false }) },
    alternatives: noopModule,
    campaign: { configure(payload) { store.configureCalls.push(['campaign', clone(payload)]); }, syncFlags: async () => ({ ok: true, added: [] }), recommend: () => null },
    ending: noopModule,
    storyEvidence: noopModule,
    routePlanner: noopModule,
    rental: noopModule,
    materials: noopModule,
    crafting: noopModule,
    professions: noopModule,
  };
  sandbox.ArcadeCareerUI = {
    clueSurface: { render() { return {}; }, clear() {} },
    mailbox: { open() { return { ok: true }; }, openClue() { return { ok: true }; } },
    settings: { open() { return { ok: true }; }, apply() {} },
    town: { open(ctx) { store.uiCalls.push(['town', ctx]); return { ok: true }; } },
    hangar: { open(ctx) { store.uiCalls.push(['hangar', ctx]); return { ok: true }; } },
    receipt: { show(ctx) { store.uiCalls.push(['receipt', ctx]); return { ok: true }; } },
    market: { open(ctx) { store.uiCalls.push(['market', ctx]); return { ok: true }; } },
    workshop: { open(ctx) { store.uiCalls.push(['workshop', ctx]); return { ok: true }; } },
    worldState: { open(ctx) { store.uiCalls.push(['worldState', ctx]); return { ok: true }; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(BRIDGE_SRC, sandbox, { filename: 'bridge.js' });
  const bridge = sandbox.ArcadeCareer;
  await bridge.ready;
  return { sandbox, bridge, store, commissionModule, professionView };
}

async function freshBridge(discoveryState, identity, options) {
  const opts = options || {};
  const store = makeStore(Object.assign({}, opts.store, {
    discovery: discoveryState,
    identity: identity || null,
    failApply: opts.failApply === true,
  }));
  return makeBridge(Object.assign({}, opts, { store }));
}

async function main() {
  let booted = null;
  try {
    booted = await makeBridge();
  } catch (err) {
    console.error('ASSEMBLY FAILED: ' + (err && err.stack ? err.stack : String(err)));
    process.exit(2);
    return;
  }
  const { bridge, store } = booted;

  check('B-01a bridge 暴露 professionView 模块', bridge.professionView && typeof bridge.professionView.projectCareerView === 'function');
  check('B-01b bridge 暴露 careerView(context)', typeof bridge.careerView === 'function');
  check('B-01c bridge 暴露 acceptProfessionInvitation', typeof bridge.acceptProfessionInvitation === 'function');
  check('B-01d bridge 暴露 setActiveProfession', typeof bridge.setActiveProfession === 'function');
  check('B-01e bridge 暴露 setProfessionPaused', typeof bridge.setProfessionPaused === 'function');

  {
    const fixture = await freshBridge(stateWithProgress(acceptedProgress(['nature.miner']), {
      acceptedOriginGameId: 'gold-miner',
      activeProfessionId: 'nature.miner',
    }), { careerId: 'career-test-1' });
    const projection = await fixture.bridge.careerView({ surface: 'work' });
    check('B-02a careerView 返回真实投影', projection && projection.schemaVersion === 1, JSON.stringify({ projection, warnings: fixture.store.warnings }));
    eq('B-02b 投影只含已接受职业', projection ? projection.professions.map((row) => row.professionId) : null, ['nature.miner']);
    check('B-02c context.now/surface/gameId 显式注入', !!projection && !!projection.__context.now && projection.__context.surface === 'work');
    check('B-02d catalog 来自注册表而非硬编码', !!projection && projection.__catalogGames === REGISTRY.games.length);
    check('B-02e availableIds 来自真实 listAvailable', !!projection && Array.isArray(projection.__context.availableIds));
    check('B-02f careerView 调用 listAvailable 时不 ensure', fixture.store.listingCalls.every((call) => call.ensure === false));
  }

  {
    const fixture = await freshBridge(stateWithProgress(readProgress(['nature.miner'])), null);
    const result = await fixture.bridge.acceptProfessionInvitation({ professionId: 'nature.miner', gameId: 'gold-miner' });
    const targetStore = fixture.store;
    eq('B-03a 首次接受成功', result.ok, true);
    eq('B-03b newlyAccepted 与 created 分离', [result.newlyAccepted, result.created], [true, true]);
    eq('B-03c 只调用 applyProfessionEvent', targetStore.applyCalls.length, 1);
    eq('B-03d 写动作冻结', targetStore.applyCalls[0].action, 'ACCEPT_INVITATION');
    eq('B-03e 传入真实 gameId', targetStore.applyCalls[0].input.gameId, 'gold-miner');
    check('B-03f 传入完整 catalog', targetStore.applyCalls[0].input.catalog.games.length === REGISTRY.games.length);
    check('B-03g 传入 generation 与 now', Number.isInteger(targetStore.applyCalls[0].generation) && !!targetStore.applyCalls[0].now);
    eq('B-03h 起源只在首次接受时固定', targetStore.discovery.acceptedOriginGameId, 'gold-miner');
    eq('B-03i 职业状态 accepted', targetStore.discovery.professionProgress['nature.miner'].state, 'accepted');
    eq('B-03j 未调用 ensureCareer', targetStore.ensureCalls.length, 0);
    eq('B-03k 未产生委托 run', fixture.bridge.commissionRun, null);
  }

  {
    const fixture = await freshBridge(stateWithProgress(readProgress(['nature.miner'])), null, { failApply: true });
    const before = clone(fixture.store.discovery);
    const result = await fixture.bridge.acceptProfessionInvitation({ professionId: 'nature.miner', gameId: 'gold-miner' });
    eq('B-04a 失败事务返回 ok:false', result.ok, false);
    eq('B-04b 失败不修改状态', fixture.store.discovery, before);
    eq('B-04c 失败不建身份', fixture.store.identity, null);
    eq('B-04d 失败不发初始资产', Object.keys(fixture.store.balances).length, 0);
    eq('B-04e 失败后本页快照仍为原状态', fixture.bridge.state().acceptedOriginGameId, null);
  }

  {
    const fixture = await freshBridge(
      stateWithProgress(acceptedProgress(['nature.miner']), { acceptedOriginGameId: 'gold-miner' }),
      { careerId: 'career-test-1' },
    );
    fixture.store.balances['career-test-1'] = 80;
    const before = clone(fixture.store.discovery);
    const result = await fixture.bridge.acceptProfessionInvitation({ professionId: 'nature.miner', gameId: 'gold-miner' });
    eq('B-05a 重复接受 duplicate', result.duplicate, true);
    eq('B-05b 重复接受 newlyAccepted false', result.newlyAccepted, false);
    eq('B-05c 重复接受状态完全不变', fixture.store.discovery, before);
    eq('B-05d 重复接受不新建身份', Object.keys(fixture.store.balances).length, 1);
    const repeated = await fixture.bridge.acceptProfessionInvitation({ professionId: 'nature.miner' });
    eq('B-05e 无 gameId 的重复点击仍 no-op', repeated.duplicate, true);
    eq('B-05f 重复点击不猜新起源', fixture.store.discovery, before);
  }

  {
    const progress = Object.assign(readProgress(['research.archivist']), acceptedProgress(['nature.miner']));
    const fixture = await freshBridge(
      stateWithProgress(progress, { acceptedOriginGameId: 'gold-miner' }),
      { careerId: 'career-test-1' },
    );
    fixture.store.balances['career-test-1'] = 80;
    const second = await fixture.bridge.acceptProfessionInvitation({ professionId: 'research.archivist', gameId: 'memory-flip' });
    eq('B-06a 第二职业 newlyAccepted true', second.newlyAccepted, true);
    eq('B-06b 第二职业 created false', second.created, false);
    eq('B-06c 起源仍为首次接受游戏', fixture.store.discovery.acceptedOriginGameId, 'gold-miner');
    eq('B-06d 第二职业不重发初始资产', fixture.store.balances['career-test-1'], 80);

    const active = await fixture.bridge.setActiveProfession({ professionId: 'research.archivist' });
    eq('B-07a setActiveProfession 成功', active.ok, true);
    eq('B-07b 当前职业可切换', fixture.store.discovery.activeProfessionId, 'research.archivist');
    const paused = await fixture.bridge.setProfessionPaused({ professionId: 'nature.miner', paused: true });
    eq('B-07c setProfessionPaused 成功', paused.ok, true);
    eq('B-07d paused 与状态正交', fixture.store.discovery.professionProgress['nature.miner'].paused, true);
    eq('B-07e paused 不回退 accepted', fixture.store.discovery.professionProgress['nature.miner'].state, 'accepted');
    const denied = await fixture.bridge.setActiveProfession({ professionId: 'ghost.profession' });
    eq('B-07f 未接受 / 未知职业不能设为当前', denied.ok, false);
    check('B-07g 所有职业写操作都经 applyProfessionEvent', fixture.store.applyCalls.slice(-4).every((call) => [
      'ACCEPT_INVITATION', 'SET_ACTIVE', 'SET_PAUSED',
    ].indexOf(call.action) >= 0));
  }

  {
    const fresh = await makeBridge();
    const result = await fresh.bridge.openTown();
    eq('B-08a 全新档不建立身份', result.ok, false);
    check('B-08b 全新档返回 no-career 提示', result.reason === 'no-career' || result.identityIssue === 'no-career', JSON.stringify(result));
    eq('B-08c 全新档未调用 ensureCareer', fresh.store.ensureCalls.length, 0);
    const resolve = BRIDGE_SRC.slice(BRIDGE_SRC.indexOf('function resolveStoryCareer('), BRIDGE_SRC.indexOf('function loadStorySnapshot('));
    check('B-08d resolveStoryCareer 源码无 ensureCareer 调用', !/return\s+db\.ensureCareer|ensureCareer\(\{\}\)/.test(resolve));
  }

  {
    const fixture = await freshBridge(
      stateWithProgress(acceptedProgress(['nature.miner']), { acceptedOriginGameId: 'gold-miner' }),
      { careerId: 'career-test-1' },
    );
    const listingBefore = fixture.store.listingCalls.length;
    await fixture.bridge.openTown();
    const townCall = fixture.store.uiCalls.filter((row) => row[0] === 'town').pop();
    check('B-09a town 上下文存在', !!townCall && !!townCall[1].commission);
    const listing = townCall && townCall[1].commission
      ? await townCall[1].commission.listAvailable({ careerId: 'legacy-id', ensure: true })
      : { ok: false };
    eq('B-09b 受控门面返回真实列表', listing.ok, true);
    const captured = fixture.store.listingCalls[listingBefore] || {};
    eq('B-09c ensure:true 被强制改为 false', captured.ensure, false);
    check('B-09d listAvailable 收到 state/catalog/context', !!captured.state && !!captured.catalog && captured.catalog.games.length === REGISTRY.games.length && !!captured.context && captured.context.surface === 'work');
    eq('B-09e 从未调用 ensureCareer', fixture.store.ensureCalls.length, 0);
  }

  {
    const fixture = await freshBridge(
      stateWithProgress(acceptedProgress(['nature.miner']), { acceptedOriginGameId: 'gold-miner' }),
      { careerId: 'career-test-1' },
    );
    const uiCount = fixture.store.uiCalls.length;
    const denied = await fixture.bridge.openTown({ professionId: 'ghost.profession' });
    eq('B-10a 未知职业深链被 gate 拒绝', denied.ok, false);
    eq('B-10b 被拒后未打开任何职业 UI', fixture.store.uiCalls.length, uiCount);
    const commissionDenied = await fixture.bridge.openTown({ commissionId: 'memory-flip.T1' });
    eq('B-10c 未接受职业任务深链被拒', commissionDenied.ok, false);
    eq('B-10d 被拒后 UI 仍未被打开', fixture.store.uiCalls.length, uiCount);
  }

  {
    const ticket = {
      ok: true,
      careerId: 'career-test-1',
      run: { careerId: 'career-test-1', runId: 'run-gate', ticketId: 'ticket-gate', status: 'issued' },
      commission: { commissionId: 'memory-flip.T1', gameId: 'memory-flip', professionId: 'research.archivist', startParams: {} },
    };
    const blocked = await makeBridge({ search: '?career=ticket-gate', ticketResult: ticket });
    eq('B-11a 未接受职业的旧 career ticket 不激活', blocked.bridge.commissionRun, null);
    check('B-11b ticket 触发统一投影 gate', blocked.store.viewCalls.some((row) => row[0] === 'show'), JSON.stringify({ calls: blocked.store.viewCalls, validate: blocked.store.validateCalls, info: blocked.bridge.info(), warnings: blocked.store.warnings }));

    const allowedState = stateWithProgress(acceptedProgress(['research.archivist']), { acceptedOriginGameId: 'memory-flip' });
    const allowed = await makeBridge({
      search: '?career=ticket-gate',
      ticketResult: ticket,
      store: makeStore({ discovery: allowedState, identity: { careerId: 'career-test-1' }, ticketResult: ticket }),
    });
    eq('B-11c 已接受职业 ticket 可继续', allowed.bridge.commissionRun && allowed.bridge.commissionRun.commissionId, 'memory-flip.T1');
    check('B-11d allowed ticket 由核心权威集合放行', allowed.bridge.commissionRun
      && allowed.store.listingCalls.some((call) => call.context && call.context.bridgeDisplayOnly === true),
    JSON.stringify(allowed.store.listingCalls));
  }

  {
    const debugBridge = await makeBridge({ search: '?careerTest=1' });
    const testApi = debugBridge.sandbox.__arcadeCareerTest;
    check('B-12a careerTest 钩子存在', !!testApi && typeof testApi.renderDebug === 'function');
    const unknown = await testApi.renderDebug('CL-does-not-exist');
    eq('B-12b 调试入口不能渲染未知线索', unknown.rendered, false);
    const undiscovered = await testApi.renderDebug('CL-gold-miner');
    eq('B-12c 调试入口不能渲染未发现线索', undiscovered.reason, 'not-discovered');
    eq('B-12d 调试入口未创建身份', debugBridge.store.ensureCalls.length, 0);
  }

  {
    const shared = makeStore();
    const firstPage = await makeBridge({ store: shared });
    check('C-01a 真实 observe 被接受', firstPage.bridge.observe('mineral.returned', { value: 1, level: 1 }));
    const finished = await firstPage.bridge.finish({ mode: 'classic', outcome: 'won', stats: { money: 10 } });
    check('C-01b 真实结算产出线索', !!finished && finished.clueId === 'CL-gold-miner', JSON.stringify({ finished, info: firstPage.bridge.info(), warnings: shared.warnings }));
    const runAction = shared.mergeCalls.find((row) => row.action && row.action.type === 'RUN_ENDED') || null;
    eq('C-01c RUN_ENDED 事务携带 GLIMPSED 事件', runAction && runAction.action.professionEvent ? runAction.action.professionEvent.action : null, 'GLIMPSED');
    eq('C-01d GLIMPSED 状态进入持久化快照', shared.discovery.professionProgress['nature.miner'] ? shared.discovery.professionProgress['nature.miner'].state : null, 'glimpsed');
    const opened = await firstPage.bridge.openClue('CL-gold-miner');
    eq('C-01e 真实 CLUE_OPENED 成功', opened.ok, true);
    const readAction = shared.mergeCalls.find((row) => row.action.type === 'CLUE_OPENED');
    eq('C-01f CLUE_OPENED 事务携带 clueOpened:true', readAction ? readAction.action.clueOpened : null, true);
    eq('C-01g READ 事件使用真实 clueId', readAction && readAction.action.professionEvent ? readAction.action.professionEvent.input.clueId : null, 'CL-gold-miner');
    eq('C-01h READ 事件使用真实 gameId', readAction && readAction.action.professionEvent ? readAction.action.professionEvent.input.gameId : null, 'gold-miner');
    eq('C-01i 状态进入 read', shared.discovery.professionProgress['nature.miner'] ? shared.discovery.professionProgress['nature.miner'].state : null, 'read');

    shared.discovery.storyEvents = { 'story:C0.port_seen': { at: at(9), source: 'clue' } };
    const accepted = await firstPage.bridge.acceptProfessionInvitation({ professionId: 'nature.miner', gameId: 'gold-miner' });
    eq('C-02a 真实接受成功', accepted.ok, true);

    const secondPage = await makeBridge({ store: shared });
    const reopened = secondPage.bridge.state();
    eq('C-02b 重开页保留 acceptedOriginGameId', reopened.acceptedOriginGameId, 'gold-miner');
    eq('C-02c 重开页保留职业进度', reopened.professionProgress['nature.miner'] ? reopened.professionProgress['nature.miner'].state : null, 'accepted');
    eq('C-02d 重开页保留 storyEvents', reopened.storyEvents, { 'story:C0.port_seen': { at: at(9), source: 'clue' } });
    eq('C-02e 重开页保留 activeProfessionId', reopened.activeProfessionId, 'nature.miner');
    await secondPage.bridge.saveState(secondPage.bridge.state());
    eq('C-02f SAVE_STATE 后扩展仍在', secondPage.bridge.state().acceptedOriginGameId, 'gold-miner');
  }

  {
    eq('R-01a careerEntryRequest 解析当前面板', router.careerEntryRequest({ search: '?careerPanel=town&professionId=research.archivist' }).professionId, 'research.archivist');
    eq('R-01b work 旧别名归一为 town', router.careerEntryRequest({ search: '?careerPanel=work' }).panel, 'town');
    eq('R-01c journal 旧别名归一为 chapters', router.careerEntryRequest({ search: '?careerPanel=journal' }).panel, 'chapters');
    eq('R-01d 未知面板不回落为任务详情', router.careerEntryRequest({ search: '?careerPanel=secret' }).panel, null);
    eq('R-01e hash 中的任务深链可解析', router.careerEntryRequest({ hash: '#?commissionId=hidden.T1' }).commissionId, 'hidden.T1');
    eq('R-01f story=1 保留', router.careerEntryRequest({ search: '?story=1' }).story, true);
    eq('R-01g 旧 career ticket 保留', router.careerEntryRequest({ search: '?career=t-1' }).ticketId, 't-1');
    eq('R-01h 普通 URL 不命中生涯入口', router.careerEntryRequest({ search: '?x=1' }).hasCareerEntry, false);

    const state = stateWithProgress(acceptedProgress(['nature.miner']), { acceptedOriginGameId: 'gold-miner' });
    const view = {
      canRevealProfession: (input) => input.professionId === 'nature.miner' ? { ok: true } : { ok: false, reason: 'not-accepted' },
      projectCareerView: () => ({ professions: [{ professionId: 'nature.miner' }] }),
      canShowCommission: (input) => input.commissionId === 'gold-miner.T1' ? { ok: true, historicalOnly: true } : { ok: false, reason: 'unknown-commission' },
    };
    eq('R-02a 已接受职业深链放行', entryRouter.gateCareerEntry({ professionId: 'nature.miner' }, view, state, catalogOf(), {}).ok, true);
    eq('R-02b 未接受职业深链拒绝', entryRouter.gateCareerEntry({ professionId: 'ghost.profession' }, view, state, catalogOf(), {}).reason, 'not-accepted');
    eq('R-02c 未接受职业任务拒绝', entryRouter.gateCareerEntry({ commissionId: 'memory-flip.T1' }, view, state, catalogOf(), {}).reason, 'unknown-commission');
    eq('R-02d 无 projection 模块时 fail closed', entryRouter.gateCareerEntry({ commissionId: 'gold-miner.T1' }, null, state, catalogOf(), {}).ok, false);
  }

  {
    const missing = [];
    const adapterMissing = [];
    REGISTRY.games.forEach((game) => {
      const file = path.join(ROOT, 'apps', 'arcade', 'games', game.gameId + '.html');
      if (!fs.existsSync(file)) {
        missing.push(game.gameId);
        return;
      }
      const html = fs.readFileSync(file, 'utf8');
      if (html.indexOf('career/bridge.js') < 0 || html.indexOf('career.finish') < 0) adapterMissing.push(game.gameId + ':bridge/finish');
      watchOf(game.gameId).forEach((kind) => {
        if (html.indexOf("'" + kind + "'") < 0 && html.indexOf('"' + kind + '"') < 0) adapterMissing.push(game.gameId + ':' + kind);
      });
    });
    eq('S-01a 16 个游戏页存在', missing, []);
    eq('S-01b 16 个生涯适配锚点保留真实事件与结算', adapterMissing, []);
    check('S-02a bridge 无 raw IDB 写回退', !/function idbWrite|genericWrite|chainPairs|runStrategies/.test(BRIDGE_SRC));
    check('S-02b bridge 无删除数据库回退', !/indexedDB\.deleteDatabase/.test(BRIDGE_SRC));
    check('S-02c 新职业写入只调用 applyProfessionEvent', /applyProfessionEvent\(\{[\s\S]*?action: action/.test(BRIDGE_SRC));
    check('S-02d 内容包仍可读取（页数 > 0）', CONTENT_FILES.length > 0);
  }

  {
    const payload = {
      schemaVersion: 1,
      contentVersion: '0.18.0',
      commissionIds: ['star-raid.T1'],
      entries: [{ commissionId: 'star-raid.T1', title: '港口通用巡航', summary: '旧港需要一次例行的海上巡查。' }],
    };
    CONTENT['world-work.json'] = payload;
    const fixture = await freshBridge(
      stateWithProgress(acceptedProgress(['nature.miner']), { acceptedOriginGameId: 'gold-miner' }),
      { careerId: 'career-test-1' },
    );
    const projection = await fixture.bridge.careerView({
      surface: 'work',
      worldFlags: ['C4.city_power_restored'],
      storyEvidence: ['E-forged'],
      clearedCommissions: ['memory-flip.T1'],
      history: [{ commissionId: 'star-raid.T2', status: 'cleared' }],
      availableIds: ['star-raid.T2'],
    });
    const commissionConfig = fixture.store.configureCalls.find((row) => row[0] === 'commission');
    const campaignConfig = fixture.store.configureCalls.find((row) => row[0] === 'campaign');
    const moduleConfig = fixture.store.configureCalls.find((row) => row[0] === 'noop');
    eq('T05-01 commission-core 收到 worldWorkIds', commissionConfig && commissionConfig[1].worldWorkIds, ['star-raid.T1']);
    check('T05-01b configureCalls 已捕获', fixture.store.configureCalls.length > 0, JSON.stringify(fixture.store.configureCalls));
    eq('T05-02 commission-core 收到 worldWork', commissionConfig && commissionConfig[1].worldWork, payload);
    eq('T05-03 campaign-core 收到 worldWork', campaignConfig && campaignConfig[1].worldWork, payload);
    eq('T05-04 route-planner 收到 worldWork', moduleConfig && moduleConfig[1].worldWork, payload);

    const worldRow = projection && projection.commissions.find((row) => row.commissionId === 'star-raid.T1');
    check('T05-06 非拥有职业仍能看到 world 工作', !!worldRow, JSON.stringify(projection && projection.commissions));
    eq('T05-07 world 工作 category 为 world', worldRow && worldRow.category, 'world');
    eq('T05-08 world 工作不泄露拥有职业', worldRow && worldRow.professionId, undefined);
    eq('T05-09 world 工作使用通用标题', worldRow && worldRow.title, '港口通用巡航');

    const viewContext = projection && projection.__context;
    check('T05-10 context 显式标记展示收窄与核心权威', !!viewContext && viewContext.bridgeDisplayOnly === true && viewContext.authority === 'commission-core');
    check('T05-11 调用方伪造的 worldFlags 不进入 context', !!viewContext && !('worldFlags' in viewContext));
    check('T05-12 调用方伪造的 storyEvidence 不进入 context', !!viewContext && !('storyEvidence' in viewContext));
    check('T05-13 调用方伪造的 clearedCommissions 不进入 context', !!viewContext && !('clearedCommissions' in viewContext));
    eq('T05-14 history 只来自核心 continuations', viewContext && viewContext.history, []);
    check('T05-15 availableIds 来自核心而非调用方', !!viewContext
      && viewContext.availableIds.indexOf('star-raid.T1') >= 0
      && viewContext.availableIds.indexOf('star-raid.T2') < 0);
    const coreInput = fixture.store.listingCalls[fixture.store.listingCalls.length - 1];
    check('T05-16 核心输入不含伪造授权字段', !!coreInput && !!coreInput.context
      && !('worldFlags' in coreInput.context) && !('storyEvidence' in coreInput.context)
      && !('clearedCommissions' in coreInput.context), JSON.stringify(coreInput && coreInput.context));

    const opened = await fixture.bridge.openTown({ commissionId: 'star-raid.T1' });
    eq('T05-17 world 工作深链经核心 gate 放行', opened.ok, true);
    const denied = await fixture.bridge.openTown({
      commissionId: 'star-raid.T2',
      worldFlags: ['C4.city_power_restored'],
      storyEvidence: ['E-forged'],
    });
    eq('T05-18 伪造上下文不能授权非核心工作', denied.ok, false);
    delete CONTENT['world-work.json'];

    const withoutWorldWork = await freshBridge(discovery.initialState(at(81)), null);
    await withoutWorldWork.bridge.careerView({ surface: 'work' });
    const defaultConfig = withoutWorldWork.store.configureCalls.find((row) => row[0] === 'commission');
    eq('T05-05 文件缺失时 worldWorkIds 为空数组', defaultConfig && defaultConfig[1].worldWorkIds, []);
  }

  console.log('');
  const failed = results.filter((row) => !row.ok);
  results.forEach((row) => {
    if (row.ok) console.log('PASS  ' + row.name);
    else console.log('FAIL  ' + row.name + (row.detail ? ' — ' + row.detail : ''));
  });
  console.log('');
  console.log((results.length - failed.length) + '/' + results.length + ' checks passed');
  if (failed.length) {
    console.error('FAILED: ' + failed.length + ' check(s) failed');
    process.exit(1);
  }
  console.log('PASS  career profession discovery / bridge facade test');
}

main().catch((err) => {
  console.error('UNEXPECTED: ' + (err && err.stack ? err.stack : String(err)));
  process.exit(1);
});
