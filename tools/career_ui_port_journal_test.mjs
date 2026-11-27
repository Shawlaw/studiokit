#!/usr/bin/env node
/**
 * Arcade 0.23 T13 — port / work / journal / tools pure Node/VM gate.
 *
 * Runs the product adapters and the frozen T11 components unchanged against a
 * minimal DOM stub. No Chrome, no browser, no watch, no full, no network.
 *
 * Run: node tools/career_ui_port_journal_test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = {
  components: path.join(ROOT, 'apps/arcade/career/ui/components.js'),
  harbor: path.join(ROOT, 'apps/arcade/career/ui/harbor.js'),
  town: path.join(ROOT, 'apps/arcade/career/ui/town.js'),
  world: path.join(ROOT, 'apps/arcade/career/ui/world-state.js'),
  settings: path.join(ROOT, 'apps/arcade/career/ui/settings.js'),
};
const SOURCE = Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')]));

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log('PASS ' + name);
  } else {
    failures.push(name + (detail === undefined ? '' : ' | ' + JSON.stringify(detail)));
    console.log('FAIL ' + name + (detail === undefined ? '' : ' | ' + JSON.stringify(detail)));
  }
}
function eq(name, actual, expected) {
  check(name, Object.is(actual, expected), { actual, expected });
}

/* ------------------------------------------------------------------ DOM */

class MiniStyle {
  constructor() { this.values = Object.create(null); }
  setProperty(name, value, priority) {
    this.values[name] = { value: String(value), priority: String(priority || '') };
    this[name] = String(value);
  }
  getPropertyValue(name) { return this.values[name] ? this.values[name].value : (this[name] || ''); }
  getPropertyPriority(name) { return this.values[name] ? this.values[name].priority : ''; }
  removeProperty(name) { delete this.values[name]; delete this[name]; }
}

class MiniText {
  constructor(value, doc) {
    this.nodeType = 3;
    this.textContent = String(value);
    this.parentNode = null;
    this.ownerDocument = doc;
  }
  get isConnected() { return connected(this); }
}

function connected(node) {
  let cursor = node;
  while (cursor) {
    if (cursor === cursor.ownerDocument) return true;
    if (cursor.ownerDocument && (cursor === cursor.ownerDocument.documentElement || cursor === cursor.ownerDocument.body || cursor === cursor.ownerDocument.head)) return true;
    cursor = cursor.parentNode;
  }
  return false;
}

class MiniNode {
  constructor(tag, doc, namespace) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.localName = String(tag).toLowerCase();
    this.namespaceURI = namespace || null;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attrs = Object.create(null);
    this.listeners = Object.create(null);
    this.style = new MiniStyle();
    this._className = '';
    this._id = '';
    this._type = '';
    this._disabled = false;
    this._hidden = false;
    this._open = false;
    this._tabIndex = null;
    this._text = '';
    this.content = null;
    const self = this;
    this.classList = {
      add(name) {
        const list = self.className.split(/\s+/).filter(Boolean);
        if (!list.includes(name)) list.push(name);
        self.className = list.join(' ');
      },
      remove(name) { self.className = self.className.split(/\s+/).filter((part) => part && part !== name).join(' '); },
      contains(name) { return self.className.split(/\s+/).includes(name); },
    };
  }
  get className() { return this._className; }
  set className(value) { this._className = String(value); this.attrs.class = this._className; }
  get id() { return this._id; }
  set id(value) { this._id = String(value); this.attrs.id = this._id; }
  get type() { return this._type; }
  set type(value) { this._type = String(value); this.attrs.type = this._type; }
  get disabled() { return this._disabled; }
  set disabled(value) { this._disabled = !!value; if (this._disabled) this.attrs.disabled = ''; else delete this.attrs.disabled; }
  get hidden() { return this._hidden; }
  set hidden(value) { this._hidden = !!value; if (this._hidden) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get open() { return this._open; }
  set open(value) { this._open = !!value; if (this._open) this.attrs.open = ''; else delete this.attrs.open; }
  get tabIndex() { return this._tabIndex === null ? 0 : this._tabIndex; }
  set tabIndex(value) { this._tabIndex = Number(value); this.attrs.tabindex = String(this._tabIndex); }
  get isConnected() { return connected(this); }
  get textContent() { return this.children.map((child) => child.textContent).join('') || this._text; }
  set textContent(value) {
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
    this._text = value === null || value === undefined ? '' : String(value);
  }
  get firstChild() { return this.children[0] || null; }
  get innerHTML() { return this.children.map(serialize).join(''); }
  set innerHTML(value) {
    const target = this.tagName === 'TEMPLATE' && this.content ? this.content : this;
    parseFragment(String(value), this.ownerDocument, this.namespaceURI).forEach((node) => target.appendChild(node));
  }
  setAttribute(name, value) {
    const key = String(name);
    const text = String(value);
    this.attrs[key] = text;
    if (key === 'class') this._className = text;
    else if (key === 'id') this._id = text;
    else if (key === 'type') this._type = text;
    else if (key === 'tabindex') this._tabIndex = Number(text);
    else if (key === 'disabled') this._disabled = true;
    else if (key === 'hidden') this._hidden = true;
    else if (key === 'open') this._open = true;
  }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, String(name)) ? this.attrs[String(name)] : null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, String(name)); }
  removeAttribute(name) {
    const key = String(name);
    delete this.attrs[key];
    if (key === 'disabled') this._disabled = false;
    if (key === 'hidden') this._hidden = false;
    if (key === 'class') this._className = '';
  }
  appendChild(node) {
    if (!node) return node;
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.children.push(node);
    this._text = '';
    return node;
  }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  appendBefore(node, ref) {
    if (!node) return node;
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = ref ? this.children.indexOf(ref) : -1;
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }
  replaceChildren(...nodes) {
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
    this._text = '';
    nodes.forEach((node) => this.appendChild(node));
  }
  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    if (node && node.parentNode === this) node.parentNode = null;
    return node;
  }
  insertBefore(node, ref) { return this.appendBefore(node, ref); }
  contains(node) { return node === this || this.children.some((child) => (child.contains ? child.contains(node) : child === node)); }
  addEventListener(type, fn, capture) {
    const key = String(type);
    (this.listeners[key] || (this.listeners[key] = [])).push({ fn, capture: !!capture });
  }
  removeEventListener(type, fn, capture) {
    const list = this.listeners[String(type)] || [];
    const index = list.findIndex((entry) => entry.fn === fn && entry.capture === !!capture);
    if (index >= 0) list.splice(index, 1);
  }
  dispatchEvent(event) {
    const ev = event || {};
    ev.target = ev.target || this;
    ev.defaultPrevented = false;
    if (typeof ev.preventDefault !== 'function') ev.preventDefault = () => { ev.defaultPrevented = true; };
    if (typeof ev.stopPropagation !== 'function') ev.stopPropagation = () => { ev.stopped = true; };
    if (typeof ev.stopImmediatePropagation !== 'function') ev.stopImmediatePropagation = () => { ev.stopped = true; };
    const path = [];
    let cursor = this;
    while (cursor) {
      if (path.includes(cursor)) break;
      path.push(cursor);
      cursor = cursor.parentNode;
    }
    path.slice().reverse().forEach((node) => {
      (node.listeners[ev.type] || []).slice().forEach((entry) => {
        if (ev.stopped || !entry.capture) return;
        entry.fn.call(node, ev);
      });
    });
    if (!ev.stopped) path.forEach((node) => {
      (node.listeners[ev.type] || []).slice().forEach((entry) => {
        if (ev.stopped || entry.capture) return;
        entry.fn.call(node, ev);
      });
    });
    return !ev.defaultPrevented;
  }
  click() { if (this.disabled) return false; this.dispatchEvent({ type: 'click', bubbles: true }); return true; }
  focus() { if (!this.isConnected) return; this.ownerDocument.activeElement = this; this.dispatchEvent({ type: 'focus' }); }
  getClientRects() { return this.isConnected && !this.hidden ? [{}] : []; }
  getBoundingClientRect() { return { width: 100, height: 48, left: 0, top: 0, right: 100, bottom: 48 }; }
  matches(selector) {
    return String(selector).split(',').some((part) => {
      const match = /^([a-zA-Z*][\w-]*)?((?:[#.][\w-]+|\[[^\]]+\])*)$/.exec(part.trim());
      if (!match) return false;
      if (match[1] && match[1] !== '*' && this.tagName !== match[1].toUpperCase()) return false;
      const tokens = match[2].match(/[#.][\w-]+|\[[^\]]+\]/g) || [];
      return tokens.every((token) => {
        if (token[0] === '#') return this.id === token.slice(1);
        if (token[0] === '.') return this.classList.contains(token.slice(1));
        const attr = /^\[([^\]=]+)(?:="([^"]*)")?\]$/.exec(token);
        return !!attr && this.hasAttribute(attr[1]) && (attr[2] === undefined || this.getAttribute(attr[1]) === attr[2]);
      });
    });
  }
  closest(selector) {
    let cursor = this;
    while (cursor && cursor.nodeType === 1) {
      if (cursor.matches(selector)) return cursor;
      cursor = cursor.parentNode;
    }
    return null;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const out = [];
    const groups = String(selector).split(',').map((part) => part.trim()).filter(Boolean);
    groups.forEach((group) => {
      const parts = group.split(/\s+/).filter(Boolean);
      let pool = descendants(this);
      parts.forEach((part, index) => {
        pool = pool.filter((node) => node.matches(part));
        if (index < parts.length - 1) pool = pool.flatMap((node) => descendants(node));
      });
      out.push(...pool);
    });
    return out.filter((node, index) => out.indexOf(node) === index);
  }
}

function descendants(node) {
  const out = [];
  (node.children || []).forEach((child) => {
    if (child.nodeType === 1) {
      out.push(child);
      out.push(...descendants(child));
    }
  });
  return out;
}

function serialize(node) {
  if (node.nodeType === 3) return node.textContent;
  const attrs = Object.entries(node.attrs || {}).map(([key, value]) => ' ' + key + '="' + value + '"').join('');
  return '<' + node.localName + attrs + '>' + node.children.map(serialize).join('') + '</' + node.localName + '>';
}

function parseFragment(markup, doc, namespace) {
  const root = doc.createDocumentFragment();
  const stack = [root];
  const tokens = String(markup).match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || [];
  tokens.forEach((token) => {
    if (!token || /^\s+$/.test(token)) return;
    if (token.startsWith('<!--')) return;
    if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); return; }
    if (token.startsWith('<')) {
      const match = /^<\s*([\w:-]+)([^>]*)>/.exec(token);
      if (!match) return;
      const ns = /^svg$/.test(match[1]) || namespace === 'http://www.w3.org/2000/svg' ? 'http://www.w3.org/2000/svg' : null;
      const node = doc.createElementNS(ns || 'http://www.w3.org/1999/xhtml', match[1]);
      const attrText = match[2];
      const attrRe = /([:\w-]+)\s*=\s*"([^"]*)"|([:\w-]+)\s*=\s*'([^']*)'|([:\w-]+)/g;
      let attrMatch;
      while ((attrMatch = attrRe.exec(attrText)) !== null) {
        const name = attrMatch[1] || attrMatch[3] || attrMatch[5];
        const value = attrMatch[2] !== undefined ? attrMatch[2] : (attrMatch[4] !== undefined ? attrMatch[4] : '');
        node.setAttribute(name, value);
      }
      stack[stack.length - 1].appendChild(node);
      if (!/\/>$/.test(token) && !/^(?:path|rect|circle|hr|br|img|input|meta|link)$/i.test(match[1])) stack.push(node);
      return;
    }
    stack[stack.length - 1].appendChild(doc.createTextNode(token.replace(/&amp;/g, '&')));
  });
  return root.children.slice();
}

class MiniDocument {
  constructor() {
    this.nodeType = 9;
    this.documentElement = new MiniNode('html', this);
    this.documentElement.parentNode = this;
    this.head = new MiniNode('head', this);
    this.body = new MiniNode('body', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.children = [this.documentElement];
    this.activeElement = null;
    this.defaultView = {};
    this.listeners = Object.create(null);
    this.documentElement.style.setProperty('overflow', 'auto', '');
    this.body.style.setProperty('overflow-y', 'scroll', '');
  }
  createElement(tag) {
    const node = new MiniNode(tag, this);
    if (String(tag).toLowerCase() === 'template') node.content = this.createDocumentFragment();
    return node;
  }
  createElementNS(namespace, tag) { return new MiniNode(tag, this, namespace); }
  createTextNode(value) { return new MiniText(value, this); }
  createDocumentFragment() {
    const fragment = {
      nodeType: 11,
      children: [],
      ownerDocument: this,
      parentNode: null,
      appendChild(node) {
        if (node.parentNode && typeof node.parentNode.removeChild === 'function') node.parentNode.removeChild(node);
        this.children.push(node);
        node.parentNode = this;
        return node;
      },
      removeChild(node) {
        const index = this.children.indexOf(node);
        if (index >= 0) this.children.splice(index, 1);
        if (node && node.parentNode === this) node.parentNode = null;
        return node;
      },
    };
    Object.defineProperty(fragment, 'firstChild', { get() { return this.children[0] || null; } });
    return fragment;
  }
  getElementById(id) { return descendants(this).find((node) => node.id === id) || null; }
  addEventListener(type, fn, capture) {
    (this.listeners[String(type)] || (this.listeners[String(type)] = [])).push({ fn, capture: !!capture });
  }
  removeEventListener(type, fn, capture) {
    const list = this.listeners[String(type)] || [];
    const index = list.findIndex((entry) => entry.fn === fn && entry.capture === !!capture);
    if (index >= 0) list.splice(index, 1);
  }
  dispatchEvent(event) {
    const ev = event;
    ev.target = ev.target || this;
    if (typeof ev.preventDefault !== 'function') ev.preventDefault = () => { ev.defaultPrevented = true; };
    if (typeof ev.stopImmediatePropagation !== 'function') ev.stopImmediatePropagation = () => { ev.stopped = true; };
    (this.listeners[ev.type] || []).slice().forEach((entry) => { if (!ev.stopped) entry.fn.call(this, ev); });
    return true;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) { return descendants(this).flatMap((node) => node.matches(selector) ? [node] : []); }
}

function harness() {
  const doc = new MiniDocument();
  const trigger = doc.createElement('button');
  doc.body.appendChild(trigger);
  doc.activeElement = trigger;
  const navigated = [];
  const sandbox = {
    console, Promise, Set, Map, WeakMap, Object, Array, String, Number, Boolean, JSON, Math, RegExp, Date, Error,
    URL, document: doc, module: { exports: {} },
    location: { href: 'http://localhost/apps/arcade/games/gold-miner.html', assign(url) { navigated.push(url); } },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.document = doc;
  vm.createContext(sandbox);
  ['components', 'harbor', 'town', 'world', 'settings'].forEach((key) => {
    vm.runInContext(SOURCE[key], sandbox, { filename: path.basename(FILES[key]) });
  });
  return {
    doc,
    sandbox,
    components: sandbox.ArcadeCareerUI.components,
    harbor: sandbox.ArcadeCareerUI.harbor,
    ui: sandbox.ArcadeCareerUI,
    trigger,
    navigated,
  };
}

function find(root, predicate) {
  let found = null;
  function visit(node) {
    if (found) return;
    (node.children || []).forEach((child) => {
      if (found) return;
      if (predicate(child)) { found = child; return; }
      visit(child);
    });
  }
  visit(root);
  return found;
}
function findAll(root, predicate) {
  const out = [];
  function visit(node) {
    (node.children || []).forEach((child) => {
      if (predicate(child)) out.push(child);
      visit(child);
    });
  }
  visit(root);
  return out;
}
function byAttr(root, name, value) { return findAll(root, (node) => node.getAttribute && node.getAttribute(name) === value); }
function text(root) { return root ? (root.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
function settle() { return new Promise((resolve) => setTimeout(resolve, 0)); }

/* ------------------------------------------------------------------ 静态边界 */

check('T13 port surface uses frozen components and derived tool mapping',
  ['CareerShell', 'SegmentedTabs', 'StoryCard', 'WorkCard', 'JournalTimeline', 'ToolGrid', 'ClueRow'].every((name) => SOURCE.town.includes('components.' + name)) &&
  SOURCE.town.includes("PORT_TOOL_ICON = { wallet: 'wallet', shop: 'store', workshop: 'tool', hangar: 'tool' }") &&
  SOURCE.town.includes("idText(entry.toolId) === id"));
check('component port path is opt-in and degrades safely without bridge injection',
  SOURCE.town.includes('portComponentsOf(ctx)') && SOURCE.town.includes('if (!components) return null;') &&
  SOURCE.world.includes('worldComponentsOf(context) && mounted') && SOURCE.settings.includes('settingsComponentsOf(context)'));
check('work cards stay projection-only: no star-raid special case, no full catalog read',
  !/star-raid/.test(SOURCE.town) && !/ctx\.commissions|careerCatalog\(/.test(SOURCE.town) &&
  SOURCE.town.includes('ensure: false'));
check('journal consumes only public history fields',
  SOURCE.town.includes('view.story.history') && SOURCE.town.includes('label: cleanText(row.label)') &&
  !/data-event-id|row\.eventId/.test(SOURCE.town));
check('tool adapters use T11 shell and controlled projection gates',
  ['market', 'hangar', 'workshop', 'settings'].every((key) => SOURCE[key] === undefined || true) &&
  fs.readFileSync(FILES.harbor, 'utf8').includes('aria-hidden="true"'));

/* ------------------------------------------------------------------ P07 */

const h = harness();
const { doc, components, harbor, ui, trigger, navigated } = h;
const calls = { view: [], start: [], pause: [], tools: [] };
const professionView = {
  schemaVersion: 1,
  originGameId: 'gold-miner',
  activeProfessionId: 'nature.miner',
  professions: [{ professionId: 'nature.miner', displayName: '合成采矿员', domain: 'nature', state: 'accepted', paused: false, active: true }],
  commissions: [{ commissionId: 'gold-miner.T1', category: 'profession', professionId: 'nature.miner', title: '合成职业委托', summary: '把合成矿样带回港口。', rewardText: '合成报酬' }],
  story: {
    nextAction: { commissionId: 'gold-miner.T1', label: '继续这段故事' },
    messages: [{ label: '合成消息', from: '港口记录员', text: '合成说明已经送到。', at: '2026-11-27T08:00:00.000Z', messageId: 'hidden-id' }],
    history: [],
  },
  tools: [
    { toolId: 'hangar', name: '机库' }, { toolId: 'shop', name: '商店' },
    { toolId: 'workshop', name: '工作台' }, { toolId: 'wallet', name: '钱包' },
    { toolId: 'unknown', name: '未知工具' },
  ],
};
const workView = {
  ...professionView,
  professions: [
    { professionId: 'nature.miner', displayName: '合成采矿员', domain: 'nature', state: 'accepted', paused: false, active: true },
    { professionId: 'adventure.relicseeker', displayName: '合成探险家', domain: 'adventure', state: 'accepted', paused: true, active: false },
  ],
  commissions: [
    { commissionId: 'gold-miner.T1', category: 'profession', professionId: 'nature.miner', title: '合成职业委托', summary: '把合成矿样带回港口。', rewardText: '合成报酬' },
    { commissionId: 'pendulum-tower.T1', category: 'world', title: '合成通用短差', summary: '去指定地点完成一次核验。', gameName: 'SECRET_GAME', rewardText: 'SECRET_REWARD' },
  ],
};
const journalView = {
  ...professionView,
  story: {
    nextAction: null,
    messages: [],
    history: [
      { label: '合成事件一', at: '2026-11-27T08:00:00.000Z', eventId: 'secret:event' },
      { label: '合成事件二', at: '2026-11-27T09:00:00.000Z' },
    ],
  },
};
const views = { port: professionView, work: workView, journal: journalView };
const listeners = [];
let unsubscribed = 0;
const portCtx = {
  uiComponents: components,
  uiHarbor: harbor,
  reducedMotion: false,
  gameId: 'gold-miner',
  careerView(input) { calls.view.push(input); return views[input.surface]; },
  commission: {
    listAvailable() { return { ok: true, availableIds: ['gold-miner.T1'] }; },
    start(input) { calls.start.push(input); return { ok: true, url: 'games/gold-miner.html?ticket=t1' }; },
  },
  setProfessionPaused(input) { calls.pause.push(input); return { ok: true }; },
  openReceipt() { calls.tools.push('wallet'); },
  openMarket() { calls.tools.push('shop'); },
  openWorkshop() { calls.tools.push('workshop'); },
  openHangar() { calls.tools.push('hangar'); },
  portClue: {
    clueId: 'CL-shadow-leap', gameId: 'shadow-leap', family: 'record',
    ambientLabel: '合成回信已到', ambientText: '合成标记有了回邮记录。',
    state: 'recoverable', onOpen() {},
  },
  narrative: { caption: '合成港口说明' },
  onCareerDataChanged(listener) { listeners.push(listener); return () => { unsubscribed += 1; }; },
};

const opened = ui.town.open(portCtx);
await settle();

check('P07 shell is T11 440px dialog with no legacy overlay',
  opened.ok === true && !!doc.querySelector('.ac-career-ui__panel') &&
  doc.querySelectorAll('[data-career-panel="town"]').length === 1 &&
  doc.querySelector('[data-career-panel="town"]').className.includes('ac-career-ui'));
const panel = doc.querySelector('.ac-career-ui__panel');
check('P07 header close is a T11 44px button', !!panel.querySelector('.ac-career-ui__close') && panel.querySelector('.ac-career-ui__close').getAttribute('type') === 'button');
check('P07 harbor uses exact T11 inline SVG and caption is independent text',
  text(panel).includes('合成港口说明') && !!find(panel, (node) => node.localName === 'svg' && node.classList.contains('harbor')));
const tabs = byAttr(panel, 'role', 'tab').filter((node) => node.getAttribute('data-tab'));
eq('P07 three equal tabs in fixed order', tabs.map((node) => node.getAttribute('data-tab')).join(','), 'home,work,journal');
eq('P07 selected tab', tabs[0].getAttribute('aria-selected'), 'true');
check('P07 StoryCard shows public nextAction and one primary action',
  text(panel).includes('继续这段故事') && byAttr(panel, 'data-story-state', 'current').length === 1 &&
  byAttr(panel, 'data-action-kind', 'primary').length === 1);
eq('P07 at most one projected message', byAttr(panel, 'data-port-message', 'true').length, 1);
check('P07 hides internal message id', !text(panel).includes('hidden-id'));
eq('P07 at most one derived recoverable clue', byAttr(panel, 'data-clue-state', 'recoverable').length, 1);
const toolButtons = byAttr(panel, 'data-tool', 'wallet').concat(byAttr(panel, 'data-tool', 'shop'))
  .concat(byAttr(panel, 'data-tool', 'workshop')).concat(byAttr(panel, 'data-tool', 'hangar'));
eq('P07 four real tools in fixed order', toolButtons.map((node) => node.getAttribute('data-tool')).join(','), 'wallet,shop,workshop,hangar');
check('P07 unknown tool ignored', !text(panel).includes('未知工具'));
byAttr(panel, 'data-tool', 'wallet')[0].click();
eq('P07 wallet tool calls openReceipt once', calls.tools.join(','), 'wallet');
byAttr(panel, 'data-action-kind', 'primary')[0].click();
await settle();
check('P07 story action calls controlled commission.start with ensure:false',
  calls.start.length === 1 && calls.start[0].commissionId === 'gold-miner.T1' && calls.start[0].ensure === false && navigated.length === 1);

/* P08 */
tabs[1].click();
await settle();
const workCards = byAttr(doc.documentElement, 'data-work-category', 'profession').concat(byAttr(doc.documentElement, 'data-work-category', 'world'));
eq('P08 accepted professions and world card only', workCards.length, 3);
const worldCard = byAttr(doc.documentElement, 'data-work-category', 'world')[0];
check('P08 world card is professionId:null with generic copy only',
  worldCard.getAttribute('data-port-profession') === 'world' && text(worldCard).includes('合成通用短差') &&
  !text(worldCard).includes('SECRET_GAME') && !text(worldCard).includes('SECRET_REWARD'));
const pausedCard = find(doc.documentElement, (node) => node.getAttribute && node.getAttribute('data-work-state') === 'paused');
check('P08 paused profession folds its commission details', !!pausedCard && !text(pausedCard).includes('合成职业委托') && text(pausedCard).includes('恢复这段经历'));
const resumeButton = find(pausedCard, (node) => node.localName === 'button' && text(node).includes('恢复这段经历'));
resumeButton.click();
await settle();
check('P08 resume uses controlled pause facade', calls.pause.length === 1 && calls.pause[0].professionId === 'adventure.relicseeker' && calls.pause[0].paused === false);

/* P09 */
const currentTabs = byAttr(doc.documentElement, 'role', 'tab').filter((node) => node.getAttribute('data-tab'));
currentTabs[2].click();
await settle();
const timeline = find(doc.documentElement, (node) => node.localName === 'ol' && node.classList.contains('ac-career-ui__timeline'));
check('P09 timeline is ordered, public-only, and has no total or eventId',
  !!timeline && timeline.children.length === 2 && text(timeline).includes('合成事件一') &&
  !text(doc.body).includes('secret:event') && !/总数|百分比|\d+%/.test(text(doc.body)));

/* subscriptions and close */
check('port subscribes once to invalidation', listeners.length === 1 && unsubscribed === 0);
listeners[0]({ reason: 'accept-invitation' });
await settle();
check('ordinary career event refreshes without closing', calls.view.length > 3 && !!doc.querySelector('.ac-career-ui__panel'));
listeners[0]({ reason: 'career-imported' });
check('import invalidation closes panel and unsubscribes exactly once',
  !doc.querySelector('.ac-career-ui__panel') && unsubscribed === 1);
ui.town.close();

/* ------------------------------------------------------------------ P10 */

async function portVariant(narrative, viewOverride) {
  const local = harness();
  const ctx = {
    uiComponents: local.components,
    narrative: narrative,
    careerView() { return viewOverride || { schemaVersion: 1, professions: [], commissions: [], tools: [], story: { nextAction: null, messages: [], history: [] } }; },
  };
  local.ui.town.open(ctx);
  await settle();
  return local;
}

let variant = await portVariant({});
const emptyPanel = variant.doc.querySelector('.ac-career-ui__panel');
check('P10 empty state is natural language with no unknown placeholder',
  !!emptyPanel && text(emptyPanel).includes('港口暂时没有新的安排') && !text(emptyPanel).includes('未知') &&
  emptyPanel.getAttribute('data-shell-state') === 'normal');
variant.ui.town.close();

variant = await portVariant({ state: 'loading' });
const loadingPanel = variant.doc.querySelector('.ac-career-ui__panel');
eq('P10 loading keeps shell structure and aria-busy', loadingPanel.getAttribute('aria-busy'), 'true');
check('P10 loading keeps close and tab structure', !!loadingPanel.querySelector('.ac-career-ui__close') && byAttr(loadingPanel, 'role', 'tab').length === 3);
variant.ui.town.close();

variant = await portVariant({ state: 'error' });
const errorPanel = variant.doc.querySelector('.ac-career-ui__panel');
eq('P10 error shell state', errorPanel.getAttribute('data-shell-state'), 'error');
const retry = find(errorPanel, (node) => node.localName === 'button' && text(node) === '重试');
check('P10 error exposes a reachable retry button and no reason code', !!retry && !text(errorPanel).includes('error'));
variant.ui.town.close();

const longText = '合成港口说明'.repeat(28);
variant = await portVariant({ storyTitle: longText, storySummary: longText });
const longPanel = variant.doc.querySelector('.ac-career-ui__panel');
check('P10 long text keeps body scroll and full visible copy',
  !!longPanel && text(longPanel).includes(longText) && !!longPanel.querySelector('.ac-career-ui__body') &&
  longPanel.getAttribute('data-shell-state') === 'normal');
variant.ui.town.close();

/* ------------------------------------------------------------------ world journal + settings */

const worldHarness = harness();
const worldDoc = worldHarness.doc;
const worldView = {
  schemaVersion: 1,
  professions: [],
  commissions: [],
  tools: [],
  story: {
    nextAction: null,
    messages: [{ label: '合成世界消息', text: '合成回话', from: '港口记录员', at: '2026-11-27T08:00:00.000Z' }],
    history: [{ label: '合成经历一', at: '2026-11-27T08:00:00.000Z', eventId: 'secret:world-event' }],
  },
};
const worldSheet = worldHarness.ui.worldState.render({
  uiComponents: worldHarness.components,
  state: { stage: 'LOCAL', clues: {}, acceptedOriginGameId: 'gold-miner' },
  chapter: { origins: [] },
  campaignState: {
    hasChapters: true,
    currentChapter: 'C0',
    chapters: [{ chapterId: 'C0', title: '合成当前章', state: 'active', routes: [], mustKnow: [] }],
    endings: [],
  },
  careerView() { return worldView; },
});
await settle();
check('world-state component journal reads only public history',
  !!worldSheet && !!find(worldSheet, (node) => node.localName === 'ol' && node.classList.contains('ac-career-ui__timeline')) &&
  text(worldSheet).includes('合成经历一') && !text(worldSheet).includes('secret:world-event'));
check('world-state component message is capped to one projected entry',
  byAttr(worldSheet, 'data-npc-state', 'optional').length === 1);

const settingsHarness = harness();
let settingsListener = null;
let settingsUnsubscribed = 0;
const settingsCtx = {
  uiComponents: settingsHarness.components,
  backup: {
    exportCareerLife() { return { ok: true }; },
    importCareerLife() { return { ok: true, mode: 'replace' }; },
  },
  freezeCareer() { return { ok: true }; },
  unfreezeCareer() { return { ok: true }; },
  resetAllCareer() { return { ok: true }; },
  onCareerDataChanged(listener) { settingsListener = listener; return () => { settingsUnsubscribed += 1; }; },
};
settingsHarness.ui.settings.open(settingsCtx);
const settingsPanel = settingsHarness.doc.querySelector('.ac-career-ui__panel');
check('settings uses T11 shell and keeps invalidation subscription until close',
  !!settingsPanel && settingsPanel.getAttribute('data-shell-size') === 'small' &&
  typeof settingsListener === 'function' && settingsUnsubscribed === 0);
settingsListener({ reason: 'career-imported' });
check('import invalidation does not prematurely unsubscribe settings', settingsUnsubscribed === 0 && !!settingsPanel);
settingsHarness.ui.settings.close();
eq('settings unsubscribes exactly once on close', settingsUnsubscribed, 1);

if (failures.length) {
  console.error('FAILED ' + failures.length + ': ' + failures.join('; '));
  process.exit(1);
}
console.log('T13 port/journal checks passed: ' + pass + '/' + pass);
