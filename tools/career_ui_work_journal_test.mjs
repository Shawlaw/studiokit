#!/usr/bin/env node
/**
 * T06a 纯 Node 门禁：工作/港口/经历的统一披露。
 *
 * 不启动浏览器、不读 DB、不发网络请求；用最小 DOM 桩直接执行
 * town.js / world-state.js / clue-surface.js，并做静态边界断言。
 *
 * 运行：node tools/career_ui_work_journal_test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOWN_PATH = path.join(ROOT, 'apps/arcade/career/ui/town.js');
const WORLD_PATH = path.join(ROOT, 'apps/arcade/career/ui/world-state.js');
const CLUE_PATH = path.join(ROOT, 'apps/arcade/career/ui/clue-surface.js');
const CAREER_DIR = path.join(ROOT, 'apps/arcade/career');
const CONTENT_DIR = path.join(CAREER_DIR, 'content');
const townSource = fs.readFileSync(TOWN_PATH, 'utf8');
const worldSource = fs.readFileSync(WORLD_PATH, 'utf8');
const clueSource = fs.readFileSync(CLUE_PATH, 'utf8');

let total = 0;
let passed = 0;
const failures = [];
function check(name, ok, detail) {
  total += 1;
  if (ok) {
    passed += 1;
    console.log('PASS ' + name);
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    'expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual));
}

/* ------------------------------------------------------------------ DOM 桩 */

class El {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.doc = doc;
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = Object.create(null);
    this._className = '';
    this._text = '';
    this.hidden = false;
    this.disabled = false;
    this.id = '';
    this.type = '';
    this.href = '';
    this.open = false;
    this.listeners = Object.create(null);
    const self = this;
    this.classList = {
      add(name) {
        const set = new Set(self._className.split(/\s+/).filter(Boolean));
        set.add(String(name));
        self._className = Array.from(set).join(' ');
      },
      remove(name) {
        const set = new Set(self._className.split(/\s+/).filter(Boolean));
        set.delete(String(name));
        self._className = Array.from(set).join(' ');
      },
      contains(name) { return self._className.split(/\s+/).indexOf(String(name)) >= 0; },
    };
  }
  get className() { return this._className; }
  set className(value) { this._className = value == null ? '' : String(value); }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() {
    if (this.childNodes.length) return this.childNodes.map((node) => node.textContent).join('');
    return this._text;
  }
  set textContent(value) {
    this._text = value == null ? '' : String(value);
    this.childNodes.forEach((node) => { node.parentNode = null; });
    this.childNodes = [];
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name === 'id') this.id = String(value);
    if (name === 'type') this.type = String(value);
    if (name === 'href') this.href = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node; }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  contains(node) { for (let cur = node; cur; cur = cur.parentNode) if (cur === this) return true; return false; }
  addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
  removeEventListener(type, fn) {
    const list = this.listeners[type] || [];
    const index = list.indexOf(fn);
    if (index >= 0) list.splice(index, 1);
  }
  emit(type, event) {
    const evt = event || Object.create(null);
    if (!evt.target) evt.target = this;
    if (!evt.preventDefault) evt.preventDefault = () => {};
    for (let cur = this; cur; cur = cur.parentNode) {
      for (const fn of (cur.listeners[type] || []).slice()) fn(evt);
    }
  }
  focus() { this.doc.activeElement = this; }
  get isConnected() { return true; }
  matches(selector) {
    const text = String(selector).trim();
    if (text[0] === '.') return this.classList.contains(text.slice(1));
    if (text[0] === '#') return this.id === text.slice(1);
    if (text[0] === '[') {
      const attr = /^\[([a-zA-Z0-9_-]+)(?:=["']?([^\]"']*)["']?)?\]$/.exec(text);
      if (!attr) return false;
      const value = this.getAttribute(attr[1]);
      return value !== null && (attr[2] === undefined || value === attr[2]);
    }
    return this.tagName === text.toUpperCase();
  }
  closest(selector) { for (let cur = this; cur; cur = cur.parentNode) if (cur.matches(selector)) return cur; return null; }
  querySelectorAll(selector) {
    const out = [];
    walk(this, (node) => { if (node !== this && node.matches(selector)) out.push(node); });
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function walk(root, visit) {
  for (const child of root.childNodes) { visit(child); walk(child, visit); }
}
function makeDoc() {
  const doc = {
    activeElement: null,
    body: null,
    head: null,
    documentElement: null,
    createElement(tag) { return new El(tag, doc); },
    getElementById(id) {
      let found = null;
      walk(doc.documentElement || { childNodes: [] }, (node) => { if (!found && node.id === id) found = node; });
      return found;
    },
    querySelectorAll(selector) {
      const out = [];
      walk(doc.documentElement || { childNodes: [] }, (node) => { if (node.matches(selector)) out.push(node); });
      return out;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  doc.documentElement = new El('html', doc);
  doc.body = new El('body', doc);
  doc.head = new El('head', doc);
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  return doc;
}
function loadUi(file, doc, navigated) {
  const sandbox = {
    document: doc,
    window: {
      location: { href: 'http://localhost/apps/arcade/games/gold-miner.html', assign(url) { navigated.push(url); } },
      ArcadeCareer: {},
    },
    console, URL, Promise, Set, Map, Object, Array, String, Number, JSON, Math, RegExp, Date,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return sandbox.window.ArcadeCareerUI;
}
function all(root, predicate) {
  const out = [];
  walk(root, (node) => { if (predicate(node)) out.push(node); });
  return out;
}
function byAttr(root, name, value) { return all(root, (node) => node.getAttribute(name) === value); }
function rowsById(root, id) {
  return all(root, (node) => node.tagName === 'LI' && node.classList.contains('ac-career-town__row') && node.getAttribute('data-commission-id') === id);
}
function text(root) { return root.textContent.replace(/\s+/g, ' ').trim(); }
async function flush() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }

/* ------------------------------------------------------------------ 静态边界 */

check('town 不读完整委托目录/注册表/游戏名扫描/星海特殊推荐',
  !/context\.commissions|ctx\.commissions|careerCatalog\(|gameNameOf|FIRST_PATROL_ID|GAME_LABELS|ensure:\s*true|listGames\(/.test(townSource));
check('town 双源：careerView(work) 与 listAvailable(ensure:false,surface:work)',
  townSource.includes('requestCareerView(liveContext, \'work\')') &&
  /surface:\s*'work'/.test(townSource) && /ensure:\s*false/.test(townSource));
check('town 眼下主卡来自 story.nextAction，搁置职业只收纳不催促',
  townSource.includes('story.nextAction') && townSource.includes('data-town-story-action') &&
  townSource.includes('PAUSED_LIST_TITLE') && !/催|倒计时|进度欠账/.test(townSource));
check('town 工具入口由 view.tools 判定，不固定全量渲染',
  townSource.includes('viewHasTool(projectedView') && townSource.includes('toolId') &&
  !/(hangarBtn|receiptBtn|marketBtn|workshopBtn)\.hidden\s*=\s*false/.test(townSource));
check('world-state 不显示六章总数/锁定标题/完整 NPC 内容目录',
  !/港里的六封信|data-chapter-count|repliesOf\(|npcContentOf\(|NPC_ALIAS/.test(worldSource));
check('world-state 首次到港不用 firstSourceGame',
  !/(state|c\.state)\.firstSourceGame/.test(worldSource) && worldSource.includes('acceptedOriginGameId'));
check('world-state 经历只读公开 label/at，不渲染内部 eventId',
  worldSource.includes('view.story.history') && worldSource.includes('journalSectionOf') &&
  !/row\.eventId|data-event-id|eventId:\s/.test(worldSource));
check('clue-surface 只接单条已判定线索，不列职业/任务/主按钮',
  clueSource.includes('opts.clue') && !/careerView\(|professions|commissions|ac-career-btn--primary/.test(clueSource.replace(/^\s*\*.*$/gm, '')));

/* ------------------------------------------------------------------ 真实 core/projection 夹具 */

const NOW = '2026-11-27T01:00:00.000Z';
const registry = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'registry.json'), 'utf8'));
const commissionsContent = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'commissions.json'), 'utf8'));
const cluesContent = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'clues.json'), 'utf8'));
const worldWork = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'world-work.json'), 'utf8'));
const commissionCore = require(path.join(CAREER_DIR, 'commission-core.js'));
const professionView = require(path.join(CAREER_DIR, 'profession-view.js'));

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function idOfAction(action) {
  return action && typeof action.commissionId === 'string' ? action.commissionId : '';
}
function createRealCoreFixture() {
  const discovery = {
    professionVersion: 1,
    firstDiscoveredGameId: 'star-raid',
    acceptedOriginGameId: 'gold-miner',
    activeProfessionId: 'nature.miner',
    narrativeCursor: { chapterId: 'C0', nodeId: null },
    storyEvents: {
      'commission:gold-miner.T1': { at: '2026-11-27T00:30:00.000Z', source: 'commission' },
    },
    professionProgress: {
      'nature.miner': {
        state: 'accepted', paused: false, discoveredAt: NOW, readAt: NOW, acceptedAt: NOW, completedAt: null,
      },
    },
  };
  const db = {
    async getDiscoveryState() { return clone(discovery); },
    async getArchiveState() { return { ok: true, archived: false, careerId: null, archivedAt: null }; },
    async getState(key) { return key === 'career' ? { key: 'career', careerId: 'career-real-1', originGameId: 'gold-miner' } : null; },
    async getProfile() { return { careerId: 'career-real-1', flags: [], evidence: [], capabilities: [] }; },
    async readQuestState(careerId) { return { ok: true, careerId, quests: [], byNode: {} }; },
    async readWallet(careerId) { return { ok: true, careerId, credits: 80, items: {}, equipment: {} }; },
    async listRuns() { return { ok: true, runs: [] }; },
  };
  const catalog = {
    schemaVersion: 1,
    games: registry.games,
    professions: registry.professions,
    commissions: commissionsContent.commissions,
    clues: cluesContent.clues,
    tools: [
      { toolId: 'wallet', name: '钱包', introducedOnAccept: true },
      { toolId: 'shop', name: '商店', introducedOnAccept: true },
      { toolId: 'workshop', name: '工作台', introducedOnAccept: true },
      { toolId: 'hangar', name: '机库', introducedOnAccept: true },
    ],
    worldWork,
    worldWorkIds: worldWork.commissionIds,
  };
  const core = commissionCore.createCommissionCore({ db: db, now: () => NOW });
  const configured = core.configure({ content: commissionsContent, catalog: catalog, worldWorkIds: worldWork.commissionIds, worldWork: worldWork });
  assert.equal(configured.usable, true, 'real core configured: ' + JSON.stringify(configured.errors));
  return { db: db, catalog: catalog, discovery: discovery, core: core };
}

const real = createRealCoreFixture();
const realListing = await real.core.listAvailable({
  careerId: 'career-real-1',
  ensure: false,
  surface: 'work',
  context: { surface: 'work', archived: false, history: [] },
});
check('真实 core 列表给出 gameName + objective（非手工 fixture）', realListing.ok === true &&
  realListing.commissions.some((row) => row.commissionId === 'gold-miner.T1' &&
    row.gameName === '黄金矿工' && row.objective && row.objective.kind === 'mineral.returned' && row.objective.atLeast === 2));
const realProjection = professionView.projectCareerView({
  state: real.discovery,
  catalog: real.catalog,
  context: {
    surface: 'work', now: NOW, archived: false, availableIds: realListing.availableIds,
    openedClueIds: [], knownNpcIds: [], worldFlags: [], storyEvidence: [],
    clearedCommissions: [], activeRuns: [], history: [], walletKnown: true,
  },
});
realProjection.commissions = clone(realListing.commissions);
check('真实 projection 已披露工具与真实起源，历史只含公开 label/at',
  realProjection.originGameId === 'gold-miner' &&
  realProjection.professions.length === 1 &&
  realProjection.tools.map((tool) => tool.toolId).sort().join(',') === 'hangar,shop,wallet,workshop' &&
  realProjection.story.history.every((row) => typeof row.label === 'string' && !row.eventId));

/* ------------------------------------------------------------------ town 投影交集 */

const navigated = [];
const townDoc = makeDoc();
const townUi = loadUi(TOWN_PATH, townDoc, navigated);
const fakeCatalog = [];
for (let i = 0; i < 96; i += 1) fakeCatalog.push({ commissionId: 'leak.' + i, title: '泄漏任务 ' + i });
const calls = { view: [], available: [], start: [] };
const mainWorkId = idOfAction(realProjection.story.nextAction);
const worldListingRow = realListing.commissions.filter((row) => row.commissionId === mainWorkId)[0];
check('真实投影的 story.nextAction 指向世界通用工作', !!worldListingRow && worldListingRow.category === 'world');
const viewRows = clone(realListing.commissions).concat([
  { commissionId: 'leak.7', category: 'profession', professionId: 'research.archivist', gameId: 'memory-flip', title: '泄漏任务 7', summary: '不应出现' },
]);
const townView = clone(realProjection);
townView.commissions = viewRows;
townView.professions.push({ professionId: 'adventure.pilot', displayName: '星际飞行员', state: 'accepted', paused: true, active: false });
const townCtx = {
  careerId: 'career-real-1',
  gameId: 'gold-miner',
  /* 故意塞入完整目录；renderer 不得读它。 */
  commissions: { commissions: fakeCatalog },
  items: { materials: [] },
  campaign: { state: () => ({ ok: true, currentChapter: 'C0', chapters: [], endings: [] }) },
  openHangar: () => {},
  openReceipt: () => {},
  openMarket: () => {},
  openWorkshop: () => {},
  careerView: (input) => {
    calls.view.push(input);
    return townView;
  },
  commission: {
    listAvailable: (input) => {
      calls.available.push(input);
      return realListing;
    },
    getWallet: () => ({ ok: true, credits: 120, items: {} }),
    continuations: () => ({ ok: true, runs: [] }),
    start: (input) => { calls.start.push(input); return { ok: true, url: 'games/gold-miner.html?ticket=t1' }; },
  },
};

const townSheet = townUi.town.render(townCtx);
await flush();
const townText = text(townSheet);
check('town 只渲染真实 core 投影 ∩ 核心授权，完整目录零泄漏',
  rowsById(townSheet, 'gold-miner.T1').length === 1 &&
  rowsById(townSheet, mainWorkId).length === 1 &&
  !townText.includes('泄漏任务') && !townText.includes('leak.'));
check('town story.nextAction 是唯一眼下主卡，并带稳定标记',
  byAttr(townSheet, 'data-town-story-action', 'true').length === 1 &&
  byAttr(townSheet, 'data-town-recommend-id', mainWorkId).length === 1 &&
  byAttr(townSheet, 'data-town-recommend-start', 'true').length === 1);
const worldRow = byAttr(townSheet, 'data-commission-id', mainWorkId)[0];
check('world 工作只显示真实通用 title/summary，不显示拥有职业或母游戏',
  text(worldRow).includes(worldListingRow.title) && text(worldRow).includes(worldListingRow.summary) &&
  !text(worldRow).includes(worldListingRow.gameName) &&
  worldRow.getAttribute('data-town-game') === null,
  JSON.stringify({ row: text(worldRow), expected: worldListingRow }));
const professionRow = rowsById(townSheet, 'gold-miner.T1')[0];
check('职业工作使用真实 core 的 gameName/objective，不查注册表',
  text(professionRow).includes('黄金矿工') && text(professionRow).includes('带回 2 份矿物') &&
  professionRow.getAttribute('data-town-goal') === '黄金矿工：带回 2 份矿物');
check('town 工具入口只来自 view.tools',
  byAttr(townSheet, 'data-town-action', 'hangar')[0].hidden === false &&
  byAttr(townSheet, 'data-town-action', 'receipt')[0].hidden === false &&
  byAttr(townSheet, 'data-town-action', 'market')[0].hidden === false &&
  byAttr(townSheet, 'data-town-action', 'workshop')[0].hidden === false,
  JSON.stringify(townView.tools));
const paused = byAttr(townSheet, 'data-town-paused', 'true')[0];
check('搁置职业折叠且不催促、不显示其任务',
  !!paused && paused.hidden === false && text(paused).includes('星际飞行员') &&
  byAttr(paused, 'data-town-action', 'start').length === 0 &&
  !/催|倒计时|进度欠账|立即/.test(text(paused)));
eq('town careerView surface=work（可重取，不缓存目录）', calls.view.filter((v) => v.surface === 'work').length >= 1, true);
check('town listAvailable 显式 ensure:false + surface:work',
  calls.available.length === 1 && calls.available[0].ensure === false && calls.available[0].surface === 'work');
byAttr(townSheet, 'data-town-recommend-start', 'true')[0].emit('click');
check('town 接单只触发一次且显式 ensure:false',
  calls.start.length === 1 && calls.start[0].commissionId === mainWorkId && calls.start[0].ensure === false &&
  navigated.length === 1);

const noToolsView = clone(townView);
noToolsView.tools = [];
townCtx.careerView = (input) => { calls.view.push(input); return noToolsView; };
const noToolsSheet = townUi.town.render(townCtx);
await flush();
check('view.tools 为空时工具入口全部收起',
  ['hangar', 'receipt', 'market', 'workshop'].every((action) => byAttr(noToolsSheet, 'data-town-action', action)[0].hidden === true) &&
  byAttr(noToolsSheet, 'data-town-more', 'true')[0].hidden === true);

/* ------------------------------------------------------------------ world / journal */

const chapterTitles = ['当前第一章', '未披露第二章', '未披露第三章', '未披露第四章', '未披露第五章', '未披露第六章'];
function worldCtxFor(view) {
  return {
    careerId: 'career-test-1',
    gameId: 'gold-miner',
    state: { stage: 'LOCAL', acceptedOriginGameId: 'gold-miner', firstSourceGame: 'star-raid' },
    chapter: {
      origins: [
        { gameId: 'gold-miner', c0Letter: { from: '老周', body: '真实起源的回信。' } },
        { gameId: 'star-raid', c0Letter: { from: '报务室', body: '发现顺序不该用的回信。' } },
      ],
    },
    campaignState: {
      hasChapters: true,
      currentChapter: 'C0',
      chapters: chapterTitles.map((title, index) => ({
        chapterId: 'C' + index,
        title: title,
        state: index === 0 ? 'active' : 'locked',
        routes: [],
        mustKnow: [],
      })),
      endings: [],
    },
    careerView: (input) => {
      worldViewCalls.push(input);
      return view;
    },
  };
}
const worldViewCalls = [];
const firstView = {
  schemaVersion: 1,
  originGameId: 'gold-miner',
  activeProfessionId: 'nature.miner',
  professions: [{ professionId: 'nature.miner', displayName: '采矿员', state: 'accepted', paused: false, active: true }],
  commissions: [],
  story: {
    nextAction: null,
    messages: [{ label: '收货窗口的回话', at: '2026-11-27T02:00:00.000Z' }],
    history: [
      { label: '你把第一份矿物交给验货处', at: '2026-11-27T01:00:00.000Z', eventId: 'secret:internal-event' },
    ],
  },
  tools: [],
};
const worldDoc = makeDoc();
const worldUi = loadUi(WORLD_PATH, worldDoc, []);
const worldSheet = worldUi.worldState.render(worldCtxFor(firstView));
await flush();
const worldText = text(worldSheet);
check('world 当前章可用 campaign.state，但每个锁定标题与总数都不进 DOM',
  worldText.includes('当前第一章') &&
  chapterTitles.slice(1).every((title) => !worldText.includes(title)) &&
  chapterTitles.slice(1).every((_, index) => byAttr(worldSheet, 'data-chapter-id', 'C' + (index + 1)).length === 0) &&
  !/六封信|data-chapter-count/.test(worldText) &&
  byAttr(worldSheet, 'data-chapter-count', '6').length === 0);
check('world 锁定章节点本身不存在',
  byAttr(worldSheet, 'data-state', 'locked').length === 0);
check('经历只渲染公开 label/at，不暴露 eventId 或总数百分比',
  worldText.includes('你把第一份矿物交给验货处') && worldText.includes('2026-11-27') &&
  !worldText.includes('secret:internal-event') && !/六个事件|完成度|\d+%/.test(worldText));
check('消息来自投影而非 NPC 内容目录',
  worldText.includes('收货窗口的回话') && worldText.includes('港里的消息') &&
  !worldText.includes('E-7'));
check('首次到港段只出现在唯一职业 + 真实接受起源，不读 firstSourceGame',
  byAttr(worldSheet, 'data-arrival', 'c0').length === 1 &&
  worldText.includes('真实起源的回信。') && !worldText.includes('发现顺序不该用的回信。') &&
  !!firstView.originGameId);
eq('world careerView surface=journal', worldViewCalls.some((v) => v.surface === 'journal'), true);

const secondView = {
  ...firstView,
  professions: [
    { professionId: 'nature.miner', displayName: '采矿员', state: 'accepted', paused: false, active: true },
    { professionId: 'adventure.pilot', displayName: '星际飞行员', state: 'accepted', paused: false, active: false },
  ],
  story: { nextAction: null, messages: [], history: [] },
};
const secondSheet = worldUi.worldState.render(worldCtxFor(secondView));
await flush();
check('第二职业不重放身份/序章，经历为空时只有自然空状态',
  byAttr(secondSheet, 'data-arrival', 'c0').length === 0 &&
  text(secondSheet).includes('还没有可以在这里回读的事。') &&
  !text(secondSheet).includes('自由职业者'));

/* ------------------------------------------------------------------ onCareerDataChanged */

const townListeners = [];
let townUnsubscribed = 0;
const changeCtx = Object.assign({}, townCtx, {
  onCareerDataChanged(listener) {
    townListeners.push(listener);
    return () => { townUnsubscribed += 1; };
  },
});
const openedTown = townUi.town.open(changeCtx);
check('town 订阅 onCareerDataChanged 并在导入事件后安全关闭+退订',
  openedTown.ok === true && townListeners.length === 1 &&
  byAttr(townDoc.documentElement, 'data-career-panel', 'town').length === 1);
townListeners[0]({ reason: 'career-imported' });
check('town 导入事件移除旧 DOM 且调用 unsubscribe',
  byAttr(townDoc.documentElement, 'data-career-panel', 'town').length === 0 && townUnsubscribed === 1);
const beforeRefresh = calls.view.length;
const refreshCtx = Object.assign({}, townCtx, { onCareerDataChanged: (listener) => {
  refreshCtx.__listener = listener;
  return () => {};
} });
const openedRefresh = townUi.town.open(refreshCtx);
refreshCtx.__listener({ reason: 'accept-invitation' });
await flush();
check('town 普通职业事件重取投影而非复用旧 DOM',
  openedRefresh.ok === true && calls.view.length > beforeRefresh &&
  byAttr(townDoc.documentElement, 'data-career-panel', 'town').length === 1);
townUi.town.close();

const worldListeners = [];
const worldChangeCtx = Object.assign({}, worldCtxFor(firstView), {
  onCareerDataChanged(listener) {
    worldListeners.push(listener);
    return () => {};
  },
});
worldUi.worldState.open(worldChangeCtx);
check('world 订阅 onCareerDataChanged', worldListeners.length === 1);
worldListeners[0]({ reason: 'career-archived' });
check('world 封存事件安全关闭并移除旧 DOM',
  byAttr(worldDoc.documentElement, 'data-career-panel', 'world-state').length === 0);
for (const reason of ['career-imported', 'career-reset']) {
  const listeners = [];
  const ctx = Object.assign({}, worldCtxFor(firstView), {
    onCareerDataChanged(listener) { listeners.push(listener); return () => {}; },
  });
  worldUi.worldState.open(ctx);
  listeners[0]({ reason: reason });
  check('world ' + reason + ' 事件安全关闭并移除旧 DOM',
    byAttr(worldDoc.documentElement, 'data-career-panel', 'world-state').length === 0);
}

/* ------------------------------------------------------------------ clue-surface */

const clueDoc = makeDoc();
const clueUi = loadUi(CLUE_PATH, clueDoc, []);
const chip = clueUi.clueSurface.render({
  clue: { clueId: 'CL-gold-miner', ambientLabel: '一张旧收据' },
  careerView: () => ({ professions: [], commissions: [] }),
  commissions: fakeCatalog,
  onOpen() {},
});
check('clue-surface 即使收到额外投影也只渲染一条线索',
  !!chip && chip.getAttribute('data-career-clue') === 'CL-gold-miner' &&
  byAttr(clueDoc.documentElement, 'data-career-clue', 'CL-gold-miner').length === 1 &&
  byAttr(clueDoc.documentElement, 'data-commission-id').length === 0);
clueUi.clueSurface.clear();
check('clue-surface clear 后零残留', byAttr(clueDoc.documentElement, 'data-career-clue').length === 0);

console.log('TOTAL ' + total + ' / PASS ' + passed + ' / FAIL ' + (total - passed));
if (failures.length) {
  for (const item of failures) console.error('FAILED ' + item);
  process.exitCode = 1;
}
