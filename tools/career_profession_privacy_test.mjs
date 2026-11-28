#!/usr/bin/env node
/**
 * Arcade 0.22 T07 — 未接受职业/委托的全表面隐私与 DOM 泄漏门禁。
 *
 * 纯 Node + VM：不启动浏览器、不启动端口、不写仓库。DOM 为内存桩，只检查
 * textContent / 属性 / 隐藏节点，不模拟像素或截图。
 * 运行：node tools/career_profession_privacy_test.mjs
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
const UI = path.join(CAREER, 'ui');
const NOW = '2026-11-27T05:00:00.000Z';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? '' : String(detail === undefined ? '' : detail) });
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'expected ' + e + ' got ' + a);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

let S;
let V;
let ENTRY;
let REGISTRY;
let COMMISSIONS;
let CLUES;
let CHAPTER;
let CAMPAIGN;
let ITEMS;
let NPC;
let SIDE;
let UI_SOURCES;
let INDEX_SOURCE;
let BRIDGE_SOURCE;

try {
  S = require(path.join(CAREER, 'profession-state.js'));
  V = require(path.join(CAREER, 'profession-view.js'));
  ENTRY = require(path.join(CAREER, 'entry-router.js'));
  const readJson = (name) => JSON.parse(fs.readFileSync(path.join(CAREER, 'content', name), 'utf8'));
  REGISTRY = readJson('registry.json');
  COMMISSIONS = readJson('commissions.json');
  CLUES = readJson('clues.json');
  CHAPTER = readJson('chapter-01.json');
  CAMPAIGN = readJson('campaign.json');
  ITEMS = readJson('items.json');
  NPC = readJson('npc.json');
  SIDE = readJson('side-stories.json');
  UI_SOURCES = fs.readdirSync(UI).filter((name) => name.endsWith('.js')).map((name) => ({
    name,
    source: fs.readFileSync(path.join(UI, name), 'utf8'),
  }));
  INDEX_SOURCE = fs.readFileSync(path.join(ROOT, 'apps/arcade/index.html'), 'utf8');
  BRIDGE_SOURCE = fs.readFileSync(path.join(CAREER, 'bridge.js'), 'utf8');
} catch (err) {
  console.error('ASSEMBLY FAILED: ' + (err && err.stack ? err.stack : String(err)));
  process.exit(2);
}

const catalog = {
  games: REGISTRY.games,
  professions: REGISTRY.professions,
  commissions: COMMISSIONS.commissions,
  clues: CLUES.clues,
  tools: [],
  worldWorkIds: [],
};
const ACCEPTED = 'nature.miner';
const ACCEPTED_GAME = 'gold-miner';
const HIDDEN = REGISTRY.professions.filter((row) => row.professionId !== ACCEPTED).map((row) => row.professionId);
const HIDDEN_TOKENS = [];
HIDDEN.forEach((id) => {
  HIDDEN_TOKENS.push(id);
  const profession = REGISTRY.professions.find((row) => row.professionId === id);
  if (profession && profession.displayName) HIDDEN_TOKENS.push(profession.displayName);
  COMMISSIONS.commissions.filter((row) => row.professionId === id).forEach((row) => {
    HIDDEN_TOKENS.push(row.commissionId, row.title);
  });
});
const FROZEN_REASONS = Object.values(V.REASONS).slice().sort();
const REASON_TEXT = FROZEN_REASONS.slice();

function contextFor(surface, extra) {
  return Object.assign({
    now: NOW,
    surface,
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
function acceptedState() {
  let state = S.initialState(NOW);
  state = S.recordGlimpsed(state, {
    catalog, professionId: ACCEPTED, gameId: ACCEPTED_GAME, clueId: 'CL-' + ACCEPTED_GAME, at: NOW,
  }).state;
  state = S.recordRead(state, { catalog, professionId: ACCEPTED, clueId: 'CL-' + ACCEPTED_GAME, at: NOW }).state;
  state = S.acceptInvitation(state, {
    catalog, professionId: ACCEPTED, gameId: ACCEPTED_GAME, at: NOW,
  }).state;
  return state;
}
function missingReasons(result) {
  return !result || (result.ok !== true && FROZEN_REASONS.indexOf(result.reason) < 0);
}
function forbiddenIn(text) {
  const value = String(text || '');
  return HIDDEN_TOKENS.filter((token) => token && value.indexOf(token) >= 0);
}

/* ------------------------------------------------------------------ *
 * 轻量 DOM：只记录节点树、文本与属性，足够验证 UI 渲染没有隐藏占位。
 * ------------------------------------------------------------------ */
class FakeNode {
  constructor(doc, tagName, nodeType, text) {
    this.ownerDocument = doc;
    this.nodeType = nodeType;
    this.tagName = nodeType === 1 ? String(tagName).toUpperCase() : '';
    this._text = nodeType === 3 ? String(text || '') : '';
    this.children = [];
    this.parentNode = null;
    this.attributes = Object.create(null);
    this.style = {};
    this.hidden = false;
    this.className = '';
    this.id = '';
    this.disabled = false;
    this.listeners = Object.create(null);
    const self = this;
    this.classList = {
      add(...names) {
        const set = new Set(String(self.className || '').split(/\s+/).filter(Boolean));
        names.forEach((name) => set.add(name));
        self.className = Array.from(set).join(' ');
      },
      remove(...names) {
        const set = new Set(String(self.className || '').split(/\s+/).filter(Boolean));
        names.forEach((name) => set.delete(name));
        self.className = Array.from(set).join(' ');
      },
      contains(name) {
        return String(self.className || '').split(/\s+/).indexOf(name) >= 0;
      },
    };
  }
  get textContent() {
    if (this.nodeType === 3) return this._text;
    return this.children.map((child) => child.textContent).join('');
  }
  set textContent(value) {
    this.children.length = 0;
    const text = value === undefined || value === null ? '' : String(value);
    if (text) {
      const node = this.ownerDocument.createTextNode(text);
      node.parentNode = this;
      this.children.push(node);
    }
  }
  appendChild(child) {
    if (!child) return child;
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  insertBefore(child, reference) {
    if (!child) return child;
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = reference ? this.children.indexOf(reference) : -1;
    child.parentNode = this;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }
  get firstChild() { return this.children[0] || null; }
  get childNodes() { return this.children; }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = String(value);
    if (name === 'hidden') this.hidden = true;
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }
  removeAttribute(name) {
    delete this.attributes[name];
    if (name === 'hidden') this.hidden = false;
  }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); }
  addEventListener(type, listener) {
    (this.listeners[type] || (this.listeners[type] = [])).push(listener);
  }
  removeEventListener(type, listener) {
    const list = this.listeners[type] || [];
    const index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
  }
  focus() {}
  getClientRects() { return [{}]; }
  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => child.contains && child.contains(node));
  }
  closest(selector) {
    for (let node = this; node; node = node.parentNode) {
      if (matches(node, selector)) return node;
    }
    return null;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const out = [];
    const parts = String(selector || '').split(',').map((piece) => piece.trim()).filter(Boolean);
    const walk = (node) => {
      node.children.forEach((child) => {
        if (child.nodeType === 1 && parts.some((part) => matches(child, part))) out.push(child);
        walk(child);
      });
    };
    walk(this);
    return out;
  }
}
function matches(node, rawSelector) {
  const selector = rawSelector.replace(/:not\([^)]*\)/g, '').trim();
  if (!selector || selector === '*') return true;
  if (selector[0] === '.') return node.className.split(/\s+/).indexOf(selector.slice(1)) >= 0;
  if (selector[0] === '#') return node.id === selector.slice(1);
  if (selector[0] === '[') return node.hasAttribute(selector.slice(1, -1));
  return node.tagName === selector.toUpperCase();
}
function createFakeDocument() {
  const doc = {
    readyState: 'complete',
    hidden: false,
    activeElement: null,
    listeners: Object.create(null),
    createElement(tag) { return new FakeNode(doc, tag, 1); },
    createTextNode(text) { return new FakeNode(doc, '', 3, text); },
    addEventListener(type, listener) { (doc.listeners[type] || (doc.listeners[type] = [])).push(listener); },
    removeEventListener() {},
    getElementById(id) {
      let found = null;
      const walk = (node) => {
        if (found) return;
        node.children.forEach((child) => {
          if (child.id === id) { found = child; return; }
          walk(child);
        });
      };
      walk(doc.documentElement);
      walk(doc.body);
      return found;
    },
    querySelector(selector) {
      return doc.documentElement.querySelector(selector) || doc.body.querySelector(selector) || null;
    },
    querySelectorAll(selector) {
      return doc.documentElement.querySelectorAll(selector).concat(doc.body.querySelectorAll(selector));
    },
  };
  doc.documentElement = doc.createElement('html');
  doc.head = doc.createElement('head');
  doc.body = doc.createElement('body');
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  return doc;
}
function loadUi(file, doc) {
  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    document: doc,
    setTimeout,
    clearTimeout,
    Promise,
    Math,
    JSON,
    Date,
    Set,
    Map,
    WeakMap,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Error,
    RegExp,
    URL,
    URLSearchParams,
    Intl,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: () => {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(UI, file), 'utf8'), sandbox, { filename: file });
  return sandbox.ArcadeCareerUI;
}
function collectDom(root) {
  const text = [];
  const hiddenText = [];
  let hiddenNodes = 0;
  const walk = (node, hiddenAncestor) => {
    if (!node) return;
    const hidden = hiddenAncestor || node.hidden === true
      || node.getAttribute && node.getAttribute('aria-hidden') === 'true'
      || /display\s*:\s*none|visibility\s*:\s*hidden/.test(String((node.style && node.style.display) || node.getAttribute && node.getAttribute('style') || ''));
    if (node.nodeType === 3) {
      text.push(node.textContent);
      if (hidden) hiddenText.push(node.textContent);
      return;
    }
    if (node.nodeType !== 1) return;
    if (hidden) hiddenNodes += 1;
    Object.keys(node.attributes || {}).forEach((key) => {
      text.push(node.attributes[key]);
      if (hidden) hiddenText.push(node.attributes[key]);
    });
    text.push(node.className || '');
    node.children.forEach((child) => walk(child, hidden));
  };
  walk(root, false);
  return { text: text.join('\n'), hiddenText: hiddenText.join('\n'), hiddenNodes };
}
function domHasForbidden(root) {
  const info = collectDom(root);
  return {
    ok: forbiddenIn(info.text).length === 0 && forbiddenIn(info.hiddenText).length === 0,
    detail: JSON.stringify({
      visible: forbiddenIn(info.text).slice(0, 8),
      hidden: forbiddenIn(info.hiddenText).slice(0, 8),
      hiddenNodes: info.hiddenNodes,
    }),
  };
}
function collectReasonText(root) {
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === 3) {
      parts.push(node.textContent);
      return;
    }
    if (node.nodeType !== 1) return;
    Object.keys(node.attributes || {}).forEach((key) => {
      if (key === 'class' || key === 'style') return;
      parts.push(node.attributes[key]);
    });
    node.children.forEach(walk);
  };
  walk(root);
  return parts.join('\n').toLowerCase();
}
function domHasReason(root) {
  const text = collectReasonText(root);
  return !REASON_TEXT.some((reason) => {
    const re = new RegExp('(^|[^a-z-])' + reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z-]|$)');
    return re.test(text);
  });
}

function main() {
  eq('P-00 frozen reason codes', FROZEN_REASONS, [
    'archived', 'future-version', 'historical-only', 'not-accepted', 'not-available',
    'not-discovered', 'not-read', 'paused', 'story-locked', 'unknown-commission',
    'unknown-profession', 'world-locked', 'wrong-surface',
  ].sort());
  check('P-00 accepted profession is real', !!REGISTRY.professions.find((row) => row.professionId === ACCEPTED));
  check('P-00 hidden set excludes accepted world work owners only', HIDDEN.length === 15);
  const cssOnly = { nodeType: 1, attributes: { class: 'ac-career-town__paused' }, children: [] };
  const reasonOnly = { nodeType: 3, textContent: 'world-locked' };
  check('P-00 reason 检测不把 CSS class 当泄漏', domHasReason(cssOnly) === true);
  check('P-00 reason 检测能发现真实 reason 文本', domHasReason(reasonOnly) === false);

  /* P-01 每个未接受职业 × 每个 surface × 三个未接受阶段 */
  const states = [
    { label: 'initial', state: S.initialState(NOW) },
    { label: 'glimpsed', state: null },
    { label: 'read', state: null },
  ];
  const hiddenProbe = HIDDEN[0];
  const hiddenGame = REGISTRY.games.find((game) => game.professions.indexOf(hiddenProbe) >= 0).gameId;
  states[1].state = S.recordGlimpsed(states[0].state, {
    catalog, professionId: hiddenProbe, gameId: hiddenGame, clueId: 'CL-' + hiddenGame, at: NOW,
  }).state;
  states[2].state = S.recordRead(states[1].state, {
    catalog, professionId: hiddenProbe, clueId: 'CL-' + hiddenGame, at: NOW,
  }).state;

  states.forEach((entry) => {
    HIDDEN.forEach((professionId) => {
      const first = COMMISSIONS.commissions.find((row) => row.professionId === professionId && row.tier === 1);
      if (!first) return;
      V.SURFACES.forEach((surface) => {
        const ctx = contextFor(surface);
        const reveal = V.canRevealProfession({ state: entry.state, catalog, context: ctx, professionId });
        const show = V.canShowCommission({ state: entry.state, catalog, context: ctx, commissionId: first.commissionId });
        const accept = V.canAcceptCommission({ state: entry.state, catalog, context: ctx, commissionId: first.commissionId });
        const fullReveal = reveal && reveal.ok === true && reveal.invitationOnly !== true;
        const label = 'P-01 ' + entry.label + ' ' + surface + ' ' + professionId;
        check(label + ' 职业不可完整披露', !fullReveal && !missingReasons(reveal), JSON.stringify(reveal));
        check(label + ' 委托不可见', show && show.ok !== true && !missingReasons(show), JSON.stringify(show));
        check(label + ' 委托不可接', accept && accept.ok !== true && !missingReasons(accept), JSON.stringify(accept));
        if (surface !== 'letter' && surface !== 'clue') {
          check(label + ' 无邀请式披露', !(reveal && reveal.ok === true), JSON.stringify(reveal));
        }
      });
      const projection = V.projectCareerView({
        state: entry.state,
        catalog,
        context: contextFor('work'),
      });
      const text = JSON.stringify(projection);
      check('P-01 ' + entry.label + ' 投影无隐藏职业/任务', projection.professions.every((row) => row.professionId !== professionId)
        && projection.commissions.every((row) => row.commissionId !== first.commissionId)
        && forbiddenIn(text).length === 0, forbiddenIn(text).slice(0, 8).join(','));
      check('P-01 ' + entry.label + ' 投影无 reason code', !REASON_TEXT.some((reason) => text.toLowerCase().indexOf(reason) >= 0));
    });
  });

  /* P-02 深链 / 推荐 / 伪造 availableIds 绕过均失败 */
  {
    const state = states[2].state;
    const target = COMMISSIONS.commissions.find((row) => row.professionId === HIDDEN[0] && row.tier === 1);
    const attempts = [
      { professionId: HIDDEN[0] },
      { commissionId: target.commissionId },
      { professionId: HIDDEN[0], commissionId: target.commissionId },
    ];
    attempts.forEach((request, index) => {
      const result = ENTRY.gateCareerEntry(request, V, state, catalog, contextFor('deep-link'));
      check('P-02 深链绕过 ' + index + ' 失败', result.ok !== true && !missingReasons(result), JSON.stringify(result));
    });
    const forged = V.canAcceptCommission({
      state,
      catalog,
      context: contextFor('work', {
        availableIds: [target.commissionId],
        worldFlags: ['C4.city_power_restored'],
        storyEvidence: ['E-memory-flip.T2'],
        history: [{ commissionId: target.commissionId, status: 'cleared' }],
      }),
      commissionId: target.commissionId,
    });
    check('P-02 注入 availableIds/旗标/历史仍不可接', forged.ok !== true && !missingReasons(forged), JSON.stringify(forged));
    const recommendation = V.getNextNarrativeAction({ state, catalog, context: contextFor('route', { availableIds: [target.commissionId] }) });
    check('P-02 推荐不指向未接受任务', !recommendation || recommendation.commissionId !== target.commissionId, JSON.stringify(recommendation));
  }

  /* P-03 封存 / 未来版本只输出冻结 reason，不输出内部标识 */
  {
    const state = acceptedState();
    const hiddenTarget = COMMISSIONS.commissions.find((row) => row.professionId === HIDDEN[0] && row.tier === 1);
    const archived = V.canShowCommission({
      state, catalog,
      context: contextFor('work', { archived: true }),
      commissionId: hiddenTarget.commissionId,
    });
    eq('P-03 archived reason', archived, { ok: false, reason: 'archived' });
    const future = V.canShowCommission({
      state: Object.assign({}, state, { professionVersion: 99 }),
      catalog,
      context: contextFor('work'),
      commissionId: hiddenTarget.commissionId,
    });
    eq('P-03 future-version reason', future, { ok: false, reason: 'future-version' });
    check('P-03 reason 不进入玩家文案', JSON.stringify(archived).indexOf(hiddenTarget.title) < 0
      && JSON.stringify(future).indexOf(hiddenTarget.title) < 0);
  }

  /* P-04 UI VM/DOM：告示板、信箱、章节、微线索都不生成隐藏占位 */
  {
    const doc = createFakeDocument();
    const accepted = acceptedState();
    const acceptedCommission = COMMISSIONS.commissions.find((row) => row.professionId === ACCEPTED && row.tier === 1);
    const town = loadUi('town.js', doc).town;
    const townSheet = town.render({
      state: accepted,
      clues: [],
      commissions: clone(COMMISSIONS),
      commission: {
        listAvailable: () => ({ ok: true, careerId: 'career-test', commissions: [acceptedCommission], availableIds: [acceptedCommission.commissionId] }),
        continuations: () => ({ ok: true, runs: [] }),
      },
      campaign: { state: () => null, recommend: () => null },
      reducedMotion: true,
    });
    check('P-04 town DOM 已渲染', !!townSheet);
    if (townSheet) {
      const dom = domHasForbidden(townSheet);
      check('P-04 town 无未接受职业/任务文本或隐藏节点', dom.ok, dom.detail);
      check('P-04 town 无 reason code 文本', domHasReason(townSheet));
    }

    const mailbox = loadUi('mailbox.js', doc).mailbox;
    const mailboxSheet = mailbox.open({
      state: { stage: 'DORMANT', clues: {} },
      clues: [],
      reducedMotion: true,
    });
    check('P-04 mailbox DOM 已渲染', !!mailboxSheet);
    if (mailboxSheet) {
      const dom = domHasForbidden(mailboxSheet);
      check('P-04 mailbox 无未接受职业/任务文本或隐藏节点', dom.ok, dom.detail);
      check('P-04 mailbox 无 reason code 文本', domHasReason(mailboxSheet));
    }

    const world = loadUi('world-state.js', doc).worldState;
    const worldSheet = world.render({
      state: accepted,
      chapters: {
        C0: CHAPTER, C1: { chapters: [] }, C2: { chapters: [] },
        C3: { chapters: [] }, C4: { chapters: [] }, C5: { chapters: [] },
      },
      campaignState: { statuses: {}, completed: [] },
      npc: NPC,
      sideStories: SIDE,
      reducedMotion: true,
    });
    check('P-04 world-state DOM 已渲染', !!worldSheet);
    if (worldSheet) {
      const dom = domHasForbidden(worldSheet);
      check('P-04 world-state 无未接受职业/任务文本或隐藏节点', dom.ok, dom.detail);
      check('P-04 world-state 无 reason code 文本', domHasReason(worldSheet));
    }

    const clueSurface = loadUi('clue-surface.js', doc).clueSurface;
    const hiddenClue = CLUES.clues.find((row) => row.gameId === hiddenGame) || CLUES.clues[0];
    const chip = clueSurface.render({
      clue: hiddenClue,
      host: doc.body,
    });
    check('P-04 clue chip 已渲染', !!chip);
    if (chip) {
      const dom = domHasForbidden(chip);
      check('P-04 clue chip 不暴露职业/任务标识', dom.ok, dom.detail);
    }
  }

  /* P-05 静态入口审查：reason codes 不作为玩家数据输出，展示层不硬编码隐藏任务 */
  {
    const displaySources = UI_SOURCES.map((row) => ({ name: row.name, source: row.source })).concat([
      { name: 'index.html', source: INDEX_SOURCE },
    ]);
    const reasonArrayLeaks = displaySources.filter((row) => /reasonCodes|reasons\s*:/.test(row.source)).map((row) => row.name);
    eq('P-05 DOM/页面源码不消费 reasonCodes 数组', reasonArrayLeaks, []);
    const hiddenFirstIds = HIDDEN.map((id) => {
      const row = COMMISSIONS.commissions.find((commission) => commission.professionId === id && commission.tier === 1);
      return row && row.commissionId;
    }).filter(Boolean);
    const hardcoded = displaySources.filter((row) => hiddenFirstIds.some((id) => row.source.indexOf(id) >= 0)).map((row) => row.name);
    eq('P-05 DOM/页面源码未硬编码隐藏职业首单', hardcoded, []);
    check('P-05 bridge 投影覆盖核心可接集合', /projection\.commissions\s*=\s*clone\(facts\.listing\.commissions\)/.test(BRIDGE_SOURCE));
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

try {
  main();
} catch (err) {
  console.error('ASSEMBLY/RUNTIME FAILED: ' + (err && err.stack ? err.stack : String(err)));
  process.exit(2);
}
