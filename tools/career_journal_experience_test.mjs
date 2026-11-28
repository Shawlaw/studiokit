#!/usr/bin/env node
/**
 * Arcade 0.24 T23 — 经历 / 回读 / 搁置恢复 pure Node/VM gate.
 *
 * 不启动浏览器、不读 DB、不发网络请求；用最小 DOM 桩直接执行
 * ui/journal.js 与 ui/town.js，并复用 T11 components.js 原文件。
 *
 * 覆盖：
 * - 经历页按已认识人物 / 已接受职业筛选；未接受职业不进筛选器；无数据不显示空筛选器；
 * - 白名单外 / 内部 id / 进度 / 金额奖励文本不显示；
 * - 点击已发生事件只展开白名单静态文本与人物，无任务、奖励、状态写入；
 * - 搁置卡保持折叠、无催促；恢复后焦点留在同一搁置/恢复控件；经历保留历史；
 * - 320 / 390 结构（单滚动容器、长列表不截断、底部可退出）；
 * - journal.js 缺失时退回 0.23 只读时间线。
 *
 * 运行：node tools/career_journal_experience_test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = {
  components: path.join(ROOT, 'apps/arcade/career/ui/components.js'),
  journal: path.join(ROOT, 'apps/arcade/career/ui/journal.js'),
  town: path.join(ROOT, 'apps/arcade/career/ui/town.js'),
  world: path.join(ROOT, 'apps/arcade/career/ui/world-state.js'),
  componentsCss: path.join(ROOT, 'apps/arcade/career/ui/components.css'),
  tokensCss: path.join(ROOT, 'apps/arcade/career/ui/tokens.css'),
};
const SOURCE = {
  components: fs.readFileSync(FILES.components, 'utf8'),
  journal: fs.readFileSync(FILES.journal, 'utf8'),
  town: fs.readFileSync(FILES.town, 'utf8'),
  world: fs.readFileSync(FILES.world, 'utf8'),
};
const CSS = {
  components: fs.readFileSync(FILES.componentsCss, 'utf8'),
  tokens: fs.readFileSync(FILES.tokensCss, 'utf8'),
};
const journalApi = require(FILES.journal);

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
  check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}
function codeOnly(source) {
  return String(source).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/* ------------------------------------------------------------------ DOM 桩
 * 形状与 tools/career_ui_port_journal_test.mjs 的最小 DOM 一致，只补本门禁
 * 需要的属性查询、focus 与 details 语义。 */

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
  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    if (node && node.parentNode === this) node.parentNode = null;
    return node;
  }
  insertBefore(node, ref) {
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
  blur() { this.dispatchEvent({ type: 'blur' }); }
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
      if (!/\/>$/.test(token) && !/^(?:path|rect|circle|hr|br|img|input|meta|link|text)$/i.test(match[1])) stack.push(node);
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

function loadSandbox(options) {
  const opts = options || {};
  const doc = new MiniDocument();
  const navigated = [];
  const sandbox = {
    console, Promise, Set, Map, WeakMap, Object, Array, String, Number, Boolean, JSON, Math, RegExp, Date, Error, URL,
    document: doc, module: { exports: {} },
    location: { href: 'http://localhost/apps/arcade/games/gold-miner.html', assign(url) { navigated.push(url); } },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const ordered = opts.withJournal === false ? ['components', 'town', 'world'] : ['components', 'journal', 'town', 'world'];
  ordered.forEach((key) => {
    vm.runInContext(SOURCE[key], sandbox, { filename: path.basename(FILES[key]) });
  });
  return {
    doc,
    sandbox,
    navigated,
    ui: sandbox.ArcadeCareerUI,
    components: sandbox.ArcadeCareerUI.components,
    journal: sandbox.ArcadeCareerUI.journal || null,
  };
}

function all(root, predicate) {
  const out = [];
  (root.children || []).forEach((child) => {
    if (child.nodeType === 1) {
      if (predicate(child)) out.push(child);
      out.push(...all(child, predicate));
    }
  });
  return out;
}
function byAttr(root, name, value) { return all(root, (node) => node.getAttribute && node.getAttribute(name) === value); }
function byTag(root, tag) { return all(root, (node) => node.tagName === String(tag).toUpperCase()); }
function text(root) { return root ? (root.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
function domPayload(root) {
  let payload = text(root);
  all(root, (node) => true).forEach((node) => {
    Object.keys(node.attrs || {}).forEach((key) => { payload += ' ' + node.attrs[key]; });
  });
  return payload;
}
function settle() { return new Promise((resolve) => setTimeout(resolve, 0)); }
async function flush(rounds) {
  const count = rounds || 5;
  for (let i = 0; i < count; i += 1) await settle();
}

/* ------------------------------------------------------------------ 夹具 */

const HISTORY = [
  {
    label: '在矿场发现了旧港印记',
    at: '2026-11-27T01:00:00.000Z',
    source: 'clue',
    person: '老周',
    professionId: 'nature.miner',
    detail: { text: '老周把那块矿石翻过来，指给你看背面的刻痕。', person: '老周' },
  },
  {
    label: '接受了遗迹探险家的邀请',
    at: '2026-11-27T02:00:00.000Z',
    source: 'story',
    person: '阿砾',
    professionId: 'adventure.relicseeker',
    detail: { text: '阿砾把卷轴收进柜子，说等你哪天愿意再去看看。' },
  },
  {
    label: '在港口听说了旧调度的事',
    at: '2026-11-27T03:00:00.000Z',
    source: 'world',
    person: '老周',
  },
];

function baseView(history) {
  return {
    schemaVersion: 1,
    originGameId: 'gold-miner',
    activeProfessionId: 'nature.miner',
    professions: [
      { professionId: 'nature.miner', displayName: '采矿员', domain: 'nature', state: 'accepted', paused: false, active: true },
      { professionId: 'adventure.relicseeker', displayName: '遗迹探险家', domain: 'adventure', state: 'accepted', paused: true, active: false },
    ],
    commissions: [],
    story: { nextAction: null, messages: [], history: history || HISTORY },
    tools: [],
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
  }
  return value;
}

function renderJournal(view, options) {
  const local = loadSandbox();
  const props = Object.assign({ view, components: local.components }, options || {});
  const section = local.ui.journal.render(props);
  return { local, section };
}

function filterButton(root, scope, optionText) {
  return all(root, (node) => node.getAttribute('data-journal-filter') === scope
    && node.textContent === ((scope === 'person' ? '人物 · ' : '职业 · ') + optionText))[0] || null;
}

/* ------------------------------------------------------------------ 静态边界 */

check('journal.js 只消费投影：不读目录/存储/网络，不写业务状态',
  !/careerCatalog\s*\(|commissions\.json|world-narrative|localStorage|indexedDB|fetch\s*\(|XMLHttpRequest/i.test(codeOnly(SOURCE.journal)) &&
  !/applyProfessionEvent|recordStoryEvent|listAvailable|commission\.start|getState\s*\(/i.test(codeOnly(SOURCE.journal)) &&
  !/storyEvents/i.test(codeOnly(SOURCE.journal)));
/* 真实 DOM 的 children 是 HTMLCollection（无 forEach）；纯 Node 夹具是数组，
   必须显式归一，否则港口会静默退回 0.23 时间线（真浏览器回归）。 */
check('journal.js 把时间线 children 归一为数组（HTMLCollection 兼容）',
  /Array\.isArray\(timeline\.children\)/.test(codeOnly(SOURCE.journal))
  && /Array\.prototype\.slice\.call\(timeline\.children\)/.test(codeOnly(SOURCE.journal)));

check('journal.js 不注入样式、不新增全局选择器',
  !/<style|createElement\(\s*['"]style|insertRule|document\.head|document\.body/i.test(codeOnly(SOURCE.journal)) &&
  !/\.style\.(?:setProperty|cssText)|setAttribute\(\s*['"]style/i.test(codeOnly(SOURCE.journal)) &&
  !/\.ac-career-ui[^\n]*\{/.test(codeOnly(SOURCE.journal)));
check('journal.js 复用 T11 组件：JournalTimeline + SecondaryAction',
  SOURCE.journal.includes('components.JournalTimeline') &&
  SOURCE.journal.includes('components.SecondaryAction') &&
  !/className\s*=\s*['"](?:timeline|journal|panel|actions)['"]/.test(codeOnly(SOURCE.journal)));
check('journal.js 不向持久层写字段，也不接收 catalog/DB 门面',
  !/persist|save\w*\(|write\w*\(|db\.[a-zA-Z]+\s*\(/i.test(codeOnly(SOURCE.journal)) &&
  SOURCE.journal.includes('view.story.history'));
check('town.js 经历页接入增强模块且保留 0.23 只读降级',
  SOURCE.town.includes('portJournalApi') && SOURCE.town.includes('ui.journal') &&
  SOURCE.town.includes('view.story.history') && SOURCE.town.includes('label: cleanText(row.label)'));
check('town.js 经历不渲染内部 eventId，不读完整目录',
  !/row\.eventId|data-event-id/.test(SOURCE.town) &&
  !/context\.commissions|ctx\.commissions|careerCatalog\(/.test(SOURCE.town));
check('town.js 搁置/恢复标记稳定，不催促',
  SOURCE.town.includes('data-work-pause-state') &&
  SOURCE.town.includes('focusPortWorkToggle') &&
  !/催|倒计时|进度欠账/.test(SOURCE.town));

/* ------------------------------------------------------------------ 纯模型 */

const model = journalApi.buildModel(baseView());
eq('模型只保留白名单事件并保持投影顺序', model.entries.map((row) => row.label), [
  '在矿场发现了旧港印记',
  '接受了遗迹探险家的邀请',
  '在港口听说了旧调度的事',
]);
eq('筛选值来自投影：人物按出现顺序、职业仅已接受', {
  persons: model.filters.persons,
  professions: model.filters.professions.map((row) => row.id),
}, {
  persons: ['老周', '阿砾'],
  professions: ['nature.miner', 'adventure.relicseeker'],
});
check('未接受职业与内部事件不进入模型', (() => {
  const view = baseView([
    { label: '在港口捡到一枚旧徽章', at: '2026-11-27T01:00:00.000Z', source: 'story', professionId: 'research.archivist' },
    { label: 'crossover:research.archivist:research.lattice', at: '2026-11-27T02:00:00.000Z', source: 'story' },
    { label: '旧港的一件小事', at: '2026-11-27T03:00:00.000Z', source: 'story', internalOnly: true },
  ]);
  const pure = journalApi.buildModel(view);
  return pure.entries.length === 0 && pure.hasFilters === false &&
    pure.dropped.map((row) => row.reason).sort().join(',') === 'not-whitelisted,unaccepted-profession,unsafe-label';
})());

/* ------------------------------------------------------------------ 筛选 */

const filterRun = renderJournal(baseView());
const panelSection = filterRun.section;
const timeline = panelSection && panelSection.querySelector('.ac-career-ui__timeline');
check('经历页输出<section.ac-career-ui__journal>与直接子<ol>', !!panelSection &&
  panelSection.className === 'ac-career-ui__journal' && !!timeline && timeline.parentNode === panelSection);
check('筛选器仅有实际可用的已认识人物/已接受职业，无总数',
  !!byAttr(panelSection, 'data-journal-filter-group', 'person')[0] &&
  !!byAttr(panelSection, 'data-journal-filter-group', 'profession')[0] &&
  !/研究|archivist/.test(domPayload(panelSection)) &&
  !/\d+\s*\/\s*\d+|%|总数|完成度|百分比/.test(text(byAttr(panelSection, 'data-journal-filters', 'true')[0])));
const timelineItems = timeline.children;
const labelTexts = timelineItems.map((node) => {
  const label = node.querySelector('.ac-career-ui__timeline-label');
  return label ? text(label) : '';
});
eq('时间线按投影顺序显示全部可显示事件', labelTexts, [
  '在矿场发现了旧港印记',
  '接受了遗迹探险家的邀请',
  '在港口听说了旧调度的事',
]);
const filtersWrap = byAttr(panelSection, 'data-journal-filters', 'true')[0];
const personGroup = byAttr(panelSection, 'data-journal-filter-group', 'person')[0];
const professionGroup = byAttr(panelSection, 'data-journal-filter-group', 'profession')[0];
personGroup.open = true;
professionGroup.open = true;
const laoZhou = filterButton(panelSection, 'person', '老周');
const aLi = filterButton(panelSection, 'person', '阿砾');
const relic = filterButton(panelSection, 'profession', '遗迹探险家');
const miner = filterButton(panelSection, 'profession', '采矿员');
check('筛选按钮是 T11 SecondaryAction 的原生按钮', [laoZhou, aLi, relic, miner].every((node) =>
  !!node && node.tagName === 'BUTTON' && node.classList.contains('ac-career-ui__action--secondary')));
laoZhou.focus();
laoZhou.click();
eq('按人物筛选只显示匹配事件', timelineItems.map((node) => !!node.hidden), [false, true, false]);
check('按人物筛选更新 aria-pressed 与当前条件文案', laoZhou.getAttribute('aria-pressed') === 'true' &&
  aLi.getAttribute('aria-pressed') === 'false' &&
  text(byAttr(panelSection, 'data-journal-active-filter', 'true')[0]) === '正在看人物：老周');
aLi.click();
eq('继续按另一个人物筛选', timelineItems.map((node) => !!node.hidden), [true, false, true]);
eq('再次点击当前人物恢复全部', (() => { aLi.click(); return timelineItems.map((node) => !!node.hidden); })(), [false, false, false]);
check('恢复全部后当前条件隐藏且 reset 选中', byAttr(panelSection, 'data-journal-active-filter', 'true')[0].hidden === true &&
  byAttr(panelSection, 'data-journal-reset', 'true')[0].getAttribute('aria-pressed') === 'true');
relic.click();
eq('按职业筛选只显示该职业事件', timelineItems.map((node) => !!node.hidden), [true, false, true]);
byAttr(panelSection, 'data-journal-reset', 'true')[0].click();
eq('reset 按钮恢复全部事件', timelineItems.map((node) => !!node.hidden), [false, false, false]);
eq('reset 后所有筛选按钮均为未选中', [laoZhou, aLi, relic, miner].map((node) => node.getAttribute('aria-pressed')), ['false', 'false', 'false', 'false']);
eq('筛选不是 display:none，而是真实 hidden 状态且 DOM 顺序不变', timelineItems.map((node) => text(node).split('2026')[0]), [
  '在矿场发现了旧港印记',
  '接受了遗迹探险家的邀请',
  '在港口听说了旧调度的事',
]);

const persisted = renderJournal(baseView(), { filter: { scope: 'person', value: '老周' } });
const persistedItems = persisted.section.querySelector('.ac-career-ui__timeline').children;
eq('外部恢复的人物筛选在重渲染后保持', persistedItems.map((node) => !!node.hidden), [false, true, false]);
check('非法/未接受职业筛选值回落到全部', (() => {
  const invalid = renderJournal(baseView(), { filter: { scope: 'profession', value: 'research.archivist' } });
  const items = invalid.section.querySelector('.ac-career-ui__timeline').children;
  return items.every((node) => !node.hidden) && !/archivist|研究/.test(domPayload(invalid.section));
})());

const noMetaRun = renderJournal(baseView(HISTORY.map((row) => ({ label: row.label, at: row.at }))));
check('没有可筛选数据时不显示空筛选器', !byAttr(noMetaRun.section, 'data-journal-filters', 'true')[0] &&
  !byAttr(noMetaRun.section, 'data-journal-reset', 'true')[0] &&
  byTag(noMetaRun.section, 'li').length === 3 &&
  !byAttr(noMetaRun.section, 'data-journal-read', '1')[0]);

const emptyRun = renderJournal(baseView([]));
check('空经历只有自然空状态，无筛选器/总数/百分比', emptyRun.section.getAttribute('data-timeline-state') === 'empty' &&
  text(emptyRun.section).includes('还没有记下新的经历。') &&
  !byAttr(emptyRun.section, 'data-journal-filters', 'true')[0] &&
  !/\d+\s*\/\s*\d+|%|总数|完成度|百分比/.test(text(emptyRun.section)));

/* ------------------------------------------------------------------ 回读 */

const frozenView = deepFreeze(baseView());
const readRun = renderJournal(frozenView, { onFilterChange: () => { throw new Error('readback must not change filters'); } });
const readSection = readRun.section;
readRun.local.doc.body.appendChild(readSection);
const toggles = all(readSection, (node) => !!node.getAttribute('data-journal-read'));
eq('只有带白名单 detail 的事件提供回读', toggles.length, 2);
const firstToggle = byAttr(readSection, 'data-journal-read', '1')[0];
const firstDetail = readSection.querySelector('#ac-career-ui-journal-detail-1');
check('回读初始折叠且无障碍状态正确', !!firstDetail && firstDetail.hidden === true &&
  firstToggle.getAttribute('aria-expanded') === 'false' &&
  firstToggle.getAttribute('aria-controls') === 'ac-career-ui-journal-detail-1');
const readSnapshot = JSON.stringify(frozenView);
firstToggle.focus();
firstToggle.click();
check('展开回读只显示白名单静态文本与人物', firstDetail.hidden === false &&
  text(firstDetail).includes('老周把那块矿石翻过来') &&
  text(firstDetail).includes('老周') &&
  firstToggle.getAttribute('aria-expanded') === 'true' &&
  JSON.stringify(frozenView) === readSnapshot &&
  byTag(readSection, 'ol')[0].children.length === 3);
check('展开回读不产生新奖励/新任务文本', !/信用点|星币|工钱|奖励|报酬|积分|材料\s*[×x]|任务|接单/.test(text(firstDetail)));
firstToggle.click();
check('关闭回读后焦点回到原条目且内容折叠', firstDetail.hidden === true &&
  firstToggle.getAttribute('aria-expanded') === 'false' &&
  readRun.local.doc.activeElement === firstToggle);
check('回读只读：不改投影、不调宿主回调、不写生活动', JSON.stringify(frozenView) === readSnapshot &&
  !!readSection);

const rewardView = baseView([
  { label: '在旧码头记下一段航报', at: '2026-11-27T01:00:00.000Z', source: 'story', person: '老周',
    detail: { text: '这次拿到了 500 信用点奖励。', person: '老周' } },
  { label: '在仓库里核对清单', at: '2026-11-27T02:00:00.000Z', source: 'story', person: '老周',
    detail: { text: '清单上写着 C2. 的下一段路。', person: '老周' } },
]);
const rewardRun = renderJournal(rewardView);
check('金额/奖励或内部章节码的 detail 不提供回读', byTag(rewardRun.section, 'li').length === 2 &&
  !byAttr(rewardRun.section, 'data-journal-read', '1')[0] &&
  !/500|信用点|奖励|C2\./.test(domPayload(rewardRun.section)));

const rejectedRun = renderJournal(baseView([
  { label: 'crossover:research.archivist:research.lattice', at: '2026-11-27T01:00:00.000Z', source: 'story' },
  { label: '乱码记录', at: '2026-11-27T02:00:00.000Z', source: 'story', internalOnly: true },
  { label: '旧港的进度 3/16', at: '2026-11-27T03:00:00.000Z', source: 'story' },
  { label: '恭喜解锁新区域', at: '2026-11-27T04:00:00.000Z', source: 'story' },
  { label: '这次拿到了 500 信用点', at: '2026-11-27T05:00:00.000Z', source: 'story' },
  { label: '在港口听说了旧调度的事', at: '2026-11-27T06:00:00.000Z', source: 'port' },
]));
check('白名单外/内部/进度/奖励事件不显示，合法 source=port 仍显示', rejectedRun.section.getAttribute('data-timeline-state') === 'filled' &&
  byTag(rejectedRun.section, 'li').length === 1 && text(rejectedRun.section).includes('在港口听说了旧调度的事') &&
  !/crossover:research|internalOnly|3\/16|解锁|500|信用点/.test(domPayload(rejectedRun.section)) &&
  !byAttr(rejectedRun.section, 'data-journal-filters', 'true')[0]);

const badPersonRun = renderJournal(baseView([
  { label: '在旧码头记下一段航报', at: '2026-11-27T01:00:00.000Z', source: 'story', person: 'E-7',
    detail: { text: '有一个熟悉的身影在灯下等你。', person: 'E-7' } },
]));
check('内部人物代号不进入筛选器或回读人物', byTag(badPersonRun.section, 'li').length === 1 &&
  !/E-7/.test(domPayload(badPersonRun.section)) &&
  !byAttr(badPersonRun.section, 'data-journal-filter-group', 'person')[0]);

/* ------------------------------------------------------------------ 搁置 / 恢复 / 历史 */

const workView = {
  ...baseView(),
  professions: [
    { professionId: 'nature.miner', displayName: '采矿员', domain: 'nature', state: 'accepted', paused: false, active: true },
    { professionId: 'adventure.relicseeker', displayName: '遗迹探险家', domain: 'adventure', state: 'accepted', paused: true, active: false },
  ],
  commissions: [
    { commissionId: 'gold-miner.T1', category: 'profession', professionId: 'nature.miner', title: '矿场的第一张单', summary: '把矿样带回验货处。', gameName: '黄金矿工', objectiveText: '带回 2 份矿物' },
  ],
};
const pauseCalls = [];
const viewCalls = [];
function townHarness(views) {
  const local = loadSandbox();
  const trigger = local.doc.createElement('button');
  local.doc.body.appendChild(trigger);
  local.doc.activeElement = trigger;
  const ctx = {
    uiComponents: local.components,
    reducedMotion: false,
    gameId: 'gold-miner',
    careerView(input) { viewCalls.push(input); return views[input.surface]; },
    commission: {
      listAvailable() { return { ok: true, availableIds: ['gold-miner.T1'] }; },
      start() { throw new Error('experience UI must not start commissions'); },
      getWallet() { return { ok: true, credits: 0, items: {} }; },
      continuations() { return { ok: true, runs: [] }; },
    },
    setProfessionPaused(input) {
      pauseCalls.push(input);
      const row = workView.professions.filter((entry) => entry.professionId === input.professionId)[0];
      if (row) row.paused = input.paused === true;
      return { ok: true };
    },
    announce() {},
    onCareerDataChanged() { return () => {}; },
  };
  return Object.assign(local, { ctx, trigger });
}

const workRun = townHarness({ port: workView, work: workView, journal: baseView() });
const opened = workRun.ui.town.open(workRun.ctx);
await flush();
check('港口可打开 T11 面板', opened.ok === true && !!workRun.doc.querySelector('.ac-career-ui__panel'));

const workTabs = byAttr(workRun.doc.documentElement, 'role', 'tab').filter((node) => node.getAttribute('data-tab'));
workTabs[1].click();
await flush();
check('港口工作页默认只显示已接受职业卡',
  byAttr(workRun.doc.documentElement, 'data-work-category', 'profession').length === 2);
const pausedCard = byAttr(workRun.doc.documentElement, 'data-work-state', 'paused')[0];
const restoreButton = pausedCard && byAttr(pausedCard, 'data-work-pause', 'adventure.relicseeker')[0];
check('已搁置卡保持折叠、不显示任务、无催促',
  !!pausedCard &&
  text(pausedCard).includes('恢复这段经历') &&
  !byTag(pausedCard, 'details').length &&
  !/矿场的第一张单|带回 2 份矿物/.test(text(pausedCard)) &&
  !/催|倒计时|欠|待办|尽快|马上/.test(text(pausedCard)) &&
  restoreButton.getAttribute('data-work-pause-state') === 'paused' &&
  restoreButton.getAttribute('aria-pressed') === 'true');
const minerCard = byAttr(workRun.doc.documentElement, 'data-port-profession', 'nature.miner')[0];
const minerPause = byAttr(minerCard, 'data-work-pause', 'nature.miner')[0];
check('工作卡给出同一搁置/恢复控件标记', !!minerPause &&
  minerPause.getAttribute('data-work-pause-state') === 'active' &&
  text(minerCard).includes('矿场的第一张单'));

minerPause.focus();
minerPause.click();
await flush(8);
const pausedMinerCard = byAttr(workRun.doc.documentElement, 'data-port-profession', 'nature.miner')[0];
const pausedMinerButton = byAttr(pausedMinerCard, 'data-work-pause', 'nature.miner')[0];
check('点击搁置后卡片折叠、无催促且焦点留在同一控件',
  pauseCalls.length === 1 && pauseCalls[0].paused === true &&
  pausedMinerCard.getAttribute('data-work-state') === 'paused' &&
  !text(pausedMinerCard).includes('矿场的第一张单') &&
  !/催|倒计时|欠|待办/.test(text(pausedMinerCard)) &&
  workRun.doc.activeElement === pausedMinerButton &&
  pausedMinerButton.getAttribute('data-work-pause-state') === 'paused');

pausedMinerButton.click();
await flush(8);
const resumedMinerCard = byAttr(workRun.doc.documentElement, 'data-port-profession', 'nature.miner')[0];
const resumedMinerButton = byAttr(resumedMinerCard, 'data-work-pause', 'nature.miner')[0];
check('恢复后焦点留在同一搁置/恢复控件，不丢到关闭键或 body',
  pauseCalls.length === 2 && pauseCalls[1].paused === false &&
  resumedMinerCard.getAttribute('data-work-state') === 'active' &&
  resumedMinerButton.getAttribute('data-work-pause-state') === 'active' &&
  workRun.doc.activeElement === resumedMinerButton &&
  text(resumedMinerCard).includes('矿场的第一张单'));

const journalTabs = byAttr(workRun.doc.documentElement, 'role', 'tab').filter((node) => node.getAttribute('data-tab'));
journalTabs[2].click();
await flush();
const resumedJournal = workRun.doc.querySelector('.ac-career-ui__panel');
const resumedTimeline = resumedJournal.querySelector('.ac-career-ui__timeline');
check('搁置/恢复后经历保留完整历史，并仍可按已接受职业筛选',
  !!resumedTimeline && resumedTimeline.children.length === 3 &&
  text(resumedTimeline).includes('在矿场发现了旧港印记') &&
  text(resumedTimeline).includes('接受了遗迹探险家的邀请') &&
  !!byAttr(resumedJournal, 'data-journal-filter-group', 'profession')[0] &&
  filterButton(resumedJournal, 'profession', '遗迹探险家') !== null &&
  !/\d+\s*\/\s*\d+|%|总数/.test(text(resumedJournal)));

const homeTabs = byAttr(workRun.doc.documentElement, 'role', 'tab').filter((node) => node.getAttribute('data-tab'));
homeTabs[0].click();
await flush();
check('筛选/回读接入不改其它 tab 结构', !!workRun.doc.querySelector('.ac-career-ui__panel') &&
  !workRun.doc.querySelector('[data-journal-surface]') &&
  byAttr(workRun.doc.documentElement, 'role', 'tab').length === 3);

/* ------------------------------------------------------------------ T24 章节指引 */

const CHAPTER_PREREQUISITE = '前置已经齐了：旧港的来信已送达。';
const CHAPTER_COMPLETION = '这一段要走完，港口认的是：第一笔真实交割。';
const GUIDE_OFFER = '港里那几张不分行的活计也记这一段的账：跑一趟外堤短巡，回来把航报交回结算窗。';
const GUIDE_NEXT = '先回港口眼下看看，或者接下一张真的挂出来的活。';
const GUIDE_PROGRESS = '告示板上还有没交回的纸，挑一张写得清楚的接。';
const GUIDE_RECEIPT = '航报交回东堤报务室，值班的人把它收进抽屉。';
const GUIDE_INTERNAL = 'altn.C1.world-work.star-raid-t1';

function guideFixture() {
  return {
    ok: true,
    worldNarrative: 'present',
    readOnly: true,
    chapters: [
      {
        chapterId: 'C1',
        title: '第一封工单',
        requirement: { flags: ['C0.port_seen'], met: false, text: '不应渲染的内部前置' },
        alternatives: [
          {
            mechanism: 'world-work',
            narrativeNodeId: GUIDE_INTERNAL,
            anchor: { kind: 'commission', refs: ['star-raid.T1'] },
            receiptSource: 'commission-receipt',
            texts: { offer: GUIDE_OFFER, progress: GUIDE_PROGRESS, receipt: GUIDE_RECEIPT, next: GUIDE_NEXT },
          },
        ],
      },
      {
        chapterId: 'C2',
        title: '谁留下了七号货柜',
        alternatives: [{ mechanism: 'world-work', texts: { offer: 'C2 专属替代指引不应出现在 C1 章节说明', next: 'C2 的下一步' } }],
      },
    ],
  };
}

function chapterCampaignModel(withData) {
  const prerequisite = withData
    ? { text: CHAPTER_PREREQUISITE, flags: ['C0.port_seen'], tokens: ['C0.port_seen'], met: false }
    : null;
  const completion = withData
    ? { text: CHAPTER_COMPLETION, flag: 'C1.signal_fragment', met: false }
    : null;
  return {
    ok: true,
    currentChapter: 'C1',
    chapters: [
      {
        chapterId: 'C1',
        title: '第一封工单',
        state: 'active',
        routes: [],
        mustKnow: [],
        prerequisite: prerequisite,
        completion: completion,
      },
      { chapterId: 'C2', title: '谁留下了七号货柜', state: 'available', routes: [], mustKnow: [] },
    ],
    endings: [],
  };
}

async function chapterTownRun(options) {
  const local = loadSandbox();
  const trigger = local.doc.createElement('button');
  local.doc.body.appendChild(trigger);
  local.doc.activeElement = trigger;
  const view = baseView([]);
  const ctx = {
    uiComponents: local.components,
    reducedMotion: true,
    gameId: 'gold-miner',
    careerView() { return view; },
    commission: {
      listAvailable() { return { ok: true, availableIds: [] }; },
      start() { throw new Error('chapter guide must not start commissions'); },
      getWallet() { return { ok: true, credits: 0, items: {} }; },
      continuations() { return { ok: true, runs: [] }; },
    },
    campaign: { state() { return chapterCampaignModel(options.withData === true); } },
    announce() {},
    onCareerDataChanged() { return () => {}; },
  };
  if (typeof options.chapterGuide === 'function') ctx.chapterGuide = options.chapterGuide;
  local.ui.town.open(ctx);
  await flush();
  const tabs = byAttr(local.doc.documentElement, 'role', 'tab').filter((node) => node.getAttribute('data-tab'));
  if (tabs[2]) tabs[2].click();
  await flush(8);
  return local;
}

const chapterTown = await chapterTownRun({ withData: true, chapterGuide: guideFixture });
const townGuide = byAttr(chapterTown.doc.documentElement, 'data-port-chapter-guide', 'true')[0];
const townCampaignText = text(townGuide);
const townCampaignPayload = domPayload(townGuide);
check('T24 港口经历页渲染公开前置/完成与替代指引', !!townGuide
  && townCampaignText.includes(CHAPTER_PREREQUISITE)
  && townCampaignText.includes(CHAPTER_COMPLETION)
  && townCampaignText.includes(GUIDE_OFFER)
  && townCampaignText.includes('下一步：' + GUIDE_NEXT)
  && !!byAttr(townGuide, 'data-port-chapter-alternatives', 'true')[0]);
check('T24 港口经历章节说明只渲染当前章替代指引，不显示进度/回执原文', !townCampaignText.includes('C2 专属')
  && !townCampaignText.includes(GUIDE_PROGRESS)
  && !townCampaignText.includes(GUIDE_RECEIPT));
check('T24 港口经历章节说明不泄漏 requirement/tokens/anchor/内部 id', !townCampaignPayload.includes(GUIDE_INTERNAL)
  && !townCampaignPayload.includes('C0.port_seen')
  && !townCampaignPayload.includes('star-raid.T1')
  && !townCampaignPayload.includes('不应渲染的内部前置')
  && !townCampaignPayload.includes('receiptSource')
  && !townCampaignPayload.includes('narrativeNodeId')
  && !townCampaignPayload.includes('mechanism')
  && !townCampaignPayload.includes('anchor'));
check('T24 港口经历章节说明不新增计数/进度压力文案', !/\d+\s*\/\s*\d+|%|信用点|星币|奖励|报酬|进度/.test(townCampaignText));

const bareTown = await chapterTownRun({ withData: false });
check('T24 无数据时港口经历与 0.23 完全一致（不建章节说明节点）', byAttr(bareTown.doc.documentElement, 'data-port-chapter-guide', 'true').length === 0
  && byAttr(bareTown.doc.documentElement, 'data-port-chapter-alternatives', 'true').length === 0);
const bareTownAgain = await chapterTownRun({ withData: false });
check('T24 无数据时港口经历 DOM 稳定且零新增节点', (() => {
  const bodyOf = (run) => run.doc.querySelector('.ac-career-ui__body');
  return serialize(bodyOf(bareTown)) === serialize(bodyOf(bareTownAgain));
})());

async function worldChapterRun(options) {
  const local = loadSandbox();
  const campaignState = {
    hasChapters: true,
    currentChapter: 'C1',
    chapters: [
      {
        chapterId: 'C1',
        title: '第一封工单',
        state: 'active',
        routes: [],
        mustKnow: [],
        prerequisite: options.withData === true ? { text: CHAPTER_PREREQUISITE } : null,
        completion: options.withData === true ? { text: CHAPTER_COMPLETION } : null,
      },
    ],
    endings: [],
  };
  const sheet = local.ui.worldState.render({
    uiComponents: local.components,
    reducedMotion: true,
    state: { stage: 'LOCAL', clues: {} },
    campaignState: campaignState,
    chapterGuide: options.chapterGuide,
    careerView() { return null; },
    announce() {},
  });
  await flush(3);
  return { local, sheet };
}

const worldChapter = await worldChapterRun({ withData: true, chapterGuide: guideFixture });
const worldText = text(worldChapter.sheet);
const worldPayload = domPayload(worldChapter.sheet);
check('T24 章节面板渲染公开前置/完成解释与替代指引', worldText.includes(CHAPTER_PREREQUISITE)
  && worldText.includes(CHAPTER_COMPLETION)
  && worldText.includes(GUIDE_OFFER)
  && worldText.includes(GUIDE_NEXT)
  && byAttr(worldChapter.sheet, 'data-alternative-count', '1').length === 1);
check('T24 章节面板只渲染公开文本，剥掉 requirement/tokens/anchor/内部 id', !worldPayload.includes(GUIDE_INTERNAL)
  && !worldPayload.includes('C0.port_seen')
  && !worldPayload.includes('star-raid.T1')
  && !worldPayload.includes(GUIDE_PROGRESS)
  && !worldPayload.includes(GUIDE_RECEIPT)
  && !worldPayload.includes('C2 专属'));
check('T24 章节面板不新增计数/进度压力文案', !/\d+\s*\/\s*\d+|%|信用点|星币|奖励|报酬|进度/.test(worldText));

const bareWorld = await worldChapterRun({ withData: false });
const bareWorldText = text(bareWorld.sheet);
check('T24 无数据时章节面板零差异（不建前置/完成/替代节点）', all(bareWorld.sheet, (node) => /ac-career-world__(?:requirement|completion|alternatives|alternative-offer|alternative-next)/.test(node.className)).length === 0
  && !bareWorldText.includes(CHAPTER_PREREQUISITE)
  && !bareWorldText.includes(CHAPTER_COMPLETION)
  && !bareWorldText.includes(GUIDE_OFFER));

/* ------------------------------------------------------------------ 320 / 390 结构 */

function hanNumber(value) {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value <= 10) return value === 10 ? '十' : digits[value];
  if (value < 20) return '十' + digits[value - 10];
  return '二十' + (value === 20 ? '' : digits[value - 20]);
}
function longView(count) {
  const people = ['老周', '阿砾', '报务员', '巡夜人'];
  const professions = ['nature.miner', 'adventure.relicseeker'];
  const history = [];
  for (let i = 0; i < count; i += 1) {
    const person = people[i % people.length];
    history.push({
      label: '旧港的第' + hanNumber(i + 1) + '段旧事，记在航海簿上',
      at: '2026-11-' + String((i % 27) + 1).padStart(2, '0') + 'T0' + (i % 8) + ':00:00.000Z',
      source: 'story',
      person: person,
      professionId: professions[i % professions.length],
      detail: { text: '这一段由' + person + '亲口讲起，说旧港的灯还没有灭。', person: person },
    });
  }
  return baseView(history);
}

function journalSignature(root) {
  return all(root, () => true).map((node) => node.tagName + '|' + node.className + '|'
    + Object.keys(node.attrs || {}).filter((key) => /^data-journal|^aria-pressed|^aria-expanded$/.test(key)).sort()
      .map((key) => key + '=' + node.attrs[key]).join(','));
}

async function renderLongPort() {
  const run = townHarness({ port: longView(24), work: longView(24), journal: longView(24) });
  run.ui.town.open(run.ctx);
  await flush();
  byAttr(run.doc.documentElement, 'role', 'tab').filter((node) => node.getAttribute('data-tab'))[2].click();
  await flush();
  const panel = run.doc.querySelector('.ac-career-ui__panel');
  const pageBody = panel.querySelector('.ac-career-ui__body');
  const section = panel.querySelector('[data-journal-surface="experience"]');
  return { run, panel, body: pageBody, section, timeline: section && section.querySelector('.ac-career-ui__timeline') };
}

const viewportRuns = [];
for (const width of [320, 390]) {
  const page = await renderLongPort();
  const inner = Math.min(440, width - 24) - 32;
  const exitButtons = all(page.panel, (node) => node.tagName === 'BUTTON' && node.textContent === '离开港口');
  const footer = page.panel.querySelector('.ac-career-ui__footer');
  const buttons = all(footer, (node) => node.tagName === 'BUTTON');
  const inlineStyles = all(page.section, (node) => !!node.getAttribute('style'));
  viewportRuns.push({ width, inner, signature: journalSignature(page.section), page });
  check(width + 'px 结构：单内部滚动 body、长列表不截断、底部仍可退出', (() => {
    if (!page.section || !page.timeline) return false;
    return page.timeline.children.length === 24 &&
      page.section.parentNode.getAttribute('role') === 'tabpanel' &&
      page.timeline.parentNode === page.section &&
      exitButtons.length === 1 && !!footer && !footer.hidden &&
      page.body.contains(footer) === false &&
      buttons[buttons.length - 1] === exitButtons[0] &&
      inlineStyles.length === 0 &&
      inner >= 264 && inner <= 408;
  })());
}
check('T11 token/CSS 保证 320/390 的内部滚动与换行',
  /--ac-career-ui-panel:\s*440px/.test(CSS.tokens) &&
  /\.ac-career-ui__panel\s*\{[\s\S]*?width:\s*min\(var\(--ac-career-ui-panel\),\s*calc\(100%\s*-\s*24px\)\)/.test(CSS.components) &&
  /\.ac-career-ui__body\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/.test(CSS.components) &&
  /\.ac-career-ui,\s*\.ac-career-ui \*\s*\{[\s\S]*?overflow-wrap:\s*anywhere/.test(CSS.components) &&
  !/white-space\s*:\s*nowrap/.test(CSS.components));
check('320/390 结构稳定：同一经历 DOM 签名、筛选与回读控件都存在',
  JSON.stringify(viewportRuns[0].signature) === JSON.stringify(viewportRuns[1].signature) &&
  viewportRuns[1].inner > viewportRuns[0].inner &&
  viewportRuns.every(({ page }) => byTag(page.section, 'li').length === 24 &&
    all(page.section, (node) => node.getAttribute('data-journal-filter') === 'person').length === 4 &&
    all(page.section, (node) => node.getAttribute('data-journal-filter') === 'profession').length === 2 &&
    all(page.section, (node) => !!node.getAttribute('data-journal-read')).length === 24));

/* ------------------------------------------------------------------ 降级 */

const fallbackRun = townHarness({ port: baseView(), work: workView, journal: baseView() });
fallbackRun.ui.journal = undefined;
fallbackRun.ui.town.open(fallbackRun.ctx);
await flush();
byAttr(fallbackRun.doc.documentElement, 'role', 'tab').filter((node) => node.getAttribute('data-tab'))[2].click();
await flush();
const fallbackTimeline = fallbackRun.doc.querySelector('.ac-career-ui__timeline');
check('journal.js 缺失时退回 0.23 只读时间线，不显示空筛选器',
  !!fallbackTimeline && fallbackTimeline.children.length === 3 &&
  !/data-journal-filter|data-journal-read/.test(serialize(fallbackTimeline)) &&
  text(fallbackRun.doc.body).includes('在矿场发现了旧港印记'));

/* ------------------------------------------------------------------ 报告 */

console.log('');
console.log('journal/experience checks passed: ' + pass + '/' + (pass + failures.length));
if (failures.length) {
  failures.forEach((item) => console.error('FAILED ' + item));
  process.exitCode = 1;
} else {
  console.log('PASS  career journal experience test');
}
