#!/usr/bin/env node
/**
 * Arcade 0.23 T12 — pure Node/VM adapter gate for P01–P06.
 *
 * Runs the real T11 components and the real T12 adapters in a minimal DOM stub.
 * No browser, server, build, watch, full gate, fetch or IndexedDB. The core
 * adapter checks use the frozen QA fixture. The world-work check uses the actual
 * narrative shards and the actual port projection.
 *
 * Run: node tools/career_ui_invitation_adapters_test.mjs
 * Exit: 0 = all pass, 1 = failures, 2 = missing input.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FILES = {
  components: 'apps/arcade/career/ui/components.js',
  harbor: 'apps/arcade/career/ui/harbor.js',
  clue: 'apps/arcade/career/ui/clue-surface.js',
  mailbox: 'apps/arcade/career/ui/mailbox.js',
  receipt: 'apps/arcade/career/ui/receipt.js',
  invitation: 'apps/arcade/career/ui/invitation.js',
  fixture: 'tools/career_ui_fixture_states.json',
};
for (const [key, rel] of Object.entries(FILES)) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    console.error('missing input (' + key + '): ' + rel);
    process.exit(2);
  }
}
const source = Object.fromEntries(Object.entries(FILES).map(([key, rel]) => [key, fs.readFileSync(path.join(ROOT, rel), 'utf8')]));
const fixture = JSON.parse(source.fixture);
const stateOfFixture = (id) => fixture.fixtures.find((row) => row.id === id);

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log('PASS ' + name); return; }
  failures.push(name + (detail === undefined ? '' : ' | ' + JSON.stringify(detail)));
  console.log('FAIL ' + name + (detail === undefined ? '' : ' | ' + JSON.stringify(detail)));
}
function eq(name, actual, expected) { check(name, Object.is(actual, expected), { actual, expected }); }
async function drain() { for (let i = 0; i < 200; i += 1) await Promise.resolve(); }

/* ------------------------------------------------------------------ *
 * Minimal DOM. Deliberately independent from jsdom and from T11's test.
 * ------------------------------------------------------------------ */

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
  constructor(value, doc) { this.nodeType = 3; this.textContent = String(value); this.ownerDocument = doc; this.parentNode = null; }
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

function descendants(node) {
  const out = [];
  (node.children || []).forEach((child) => {
    if (child.nodeType === 1) { out.push(child); out.push(...descendants(child)); }
  });
  return out;
}

class MiniElement {
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
    this._src = '';
    this._disabled = false;
    this._hidden = false;
    this._tabIndex = null;
    const self = this;
    this.classList = {
      add(name) { const parts = self._className.split(/\s+/).filter(Boolean); if (!parts.includes(name)) parts.push(name); self.className = parts.join(' '); },
      remove(name) { self.className = self._className.split(/\s+/).filter((part) => part && part !== name).join(' '); },
      contains(name) { return self._className.split(/\s+/).includes(name); },
    };
  }
  get className() { return this._className; }
  set className(value) { this._className = String(value || ''); this.attrs.class = this._className; }
  get id() { return this._id; }
  set id(value) { this._id = String(value || ''); this.attrs.id = this._id; }
  get type() { return this._type; }
  set type(value) { this._type = String(value || ''); this.attrs.type = this._type; }
  get src() { return this._src; }
  set src(value) { this._src = String(value || ''); this.attrs.src = this._src; }
  get disabled() { return this._disabled; }
  set disabled(value) { this._disabled = !!value; if (this._disabled) this.attrs.disabled = ''; else delete this.attrs.disabled; }
  get hidden() { return this._hidden; }
  set hidden(value) { this._hidden = !!value; if (this._hidden) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get tabIndex() { return this._tabIndex === null ? 0 : this._tabIndex; }
  set tabIndex(value) { this._tabIndex = Number(value); this.attrs.tabindex = String(this._tabIndex); }
  get isConnected() { return connected(this); }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const index = this.parentNode.children.indexOf(this);
    return this.parentNode.children[index + 1] || null;
  }
  get textContent() { return this.children.map((child) => child.textContent).join(''); }
  set textContent(value) {
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
    const text = value === null || value === undefined ? '' : String(value);
    if (text) { const node = new MiniText(text, this.ownerDocument); node.parentNode = this; this.children.push(node); }
  }
  get innerHTML() { return this.children.map((child) => serialize(child)).join(''); }
  set innerHTML(value) {
    const target = this.tagName === 'TEMPLATE' && this.content ? this.content : this;
    parseFragment(String(value), this.ownerDocument).forEach((node) => target.appendChild(node));
  }
  setAttribute(name, value) {
    const key = String(name);
    this.attrs[key] = String(value);
    if (key === 'class') this._className = this.attrs[key];
    else if (key === 'id') this._id = this.attrs[key];
    else if (key === 'type') this._type = this.attrs[key];
    else if (key === 'src') this._src = this.attrs[key];
    else if (key === 'tabindex') this._tabIndex = Number(this.attrs[key]);
    else if (key === 'disabled') this._disabled = true;
    else if (key === 'hidden') this._hidden = true;
  }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); }
  removeAttribute(name) {
    const key = String(name);
    delete this.attrs[key];
    if (key === 'disabled') this._disabled = false;
    if (key === 'hidden') this._hidden = false;
    if (key === 'class') this._className = '';
    if (key === 'id') this._id = '';
  }
  appendChild(node) {
    if (!node) return node;
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    if (node.parentNode === this) node.parentNode = null;
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) {
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
    nodes.forEach((node) => this.appendChild(node));
  }
  insertBefore(node, reference) {
    if (!node) return node;
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index >= 0) this.children.splice(index, 0, node);
    else this.children.push(node);
    node.parentNode = this;
    return node;
  }
  addEventListener(type, fn, capture) {
    const key = String(type);
    (this.listeners[key] || (this.listeners[key] = [])).push({ fn, capture: !!capture });
  }
  removeEventListener(type, fn, capture) {
    const list = this.listeners[String(type)] || [];
    const index = list.findIndex((item) => item.fn === fn && item.capture === !!capture);
    if (index >= 0) list.splice(index, 1);
  }
  fire(type, event, phase) {
    (this.listeners[String(type)] || []).slice().forEach((entry) => {
      if (event.stopped || entry.capture !== (phase === 'capture')) return;
      entry.fn.call(this, event);
    });
  }
  dispatchEvent(event) {
    const ev = event || {};
    ev.target = ev.target || this;
    ev.defaultPrevented = false;
    ev.stopped = false;
    ev.preventDefault = ev.preventDefault || (() => { ev.defaultPrevented = true; });
    ev.stopPropagation = ev.stopPropagation || (() => { ev.stopped = true; });
    ev.stopImmediatePropagation = ev.stopImmediatePropagation || (() => { ev.stopped = true; });
    const chain = [];
    for (let cursor = this; cursor; cursor = cursor.parentNode) chain.push(cursor);
    chain.slice().reverse().filter((node) => typeof node.fire === 'function').forEach((node) => node.fire(ev.type, ev, 'capture'));
    if (!ev.stopped) chain.filter((node) => typeof node.fire === 'function').forEach((node) => node.fire(ev.type, ev, 'bubble'));
    return !ev.defaultPrevented;
  }
  click() { if (this.disabled) return false; this.dispatchEvent({ type: 'click', bubbles: true }); return true; }
  focus() {
    if (!connected(this)) return;
    this.ownerDocument.activeElement = this;
    this.dispatchEvent({ type: 'focus' });
  }
  showPopover() { this.shownPopover = true; }
  hidePopover() { this.shownPopover = false; }
  getClientRects() { return connected(this) ? [{ width: 100, height: 48 }] : []; }
  getBoundingClientRect() { return { width: 100, height: 48, left: 0, top: 0, right: 100, bottom: 48 }; }
  contains(node) { for (let cursor = node; cursor; cursor = cursor.parentNode) if (cursor === this) return true; return false; }
  matches(selector) { return simpleMatch(this, String(selector).trim()); }
  closest(selector) { for (let cursor = this; cursor && cursor.nodeType === 1; cursor = cursor.parentNode) if (cursor.matches(selector)) return cursor; return null; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const out = [];
    String(selector).split(',').map((part) => part.trim()).filter(Boolean).forEach((group) => {
      const parts = group.split(/\s+/).filter(Boolean);
      let pool = descendants(this);
      parts.forEach((part, index) => {
        pool = pool.filter((node) => simpleMatch(node, part));
        if (index < parts.length - 1) pool = pool.flatMap((node) => descendants(node));
      });
      out.push(...pool);
    });
    return out.filter((node, index) => out.indexOf(node) === index);
  }
}

function simpleMatch(node, selector) {
  const match = /^([a-zA-Z*][\w-]*)?((?:[#.][\w-]+|\[[^\]]+\])*)$/.exec(selector);
  if (!match) return false;
  if (match[1] && match[1] !== '*' && node.tagName !== match[1].toUpperCase()) return false;
  const tokens = match[2].match(/[#.][\w-]+|\[[^\]]+\]/g) || [];
  return tokens.every((token) => {
    if (token[0] === '#') return node.id === token.slice(1);
    if (token[0] === '.') return node.classList.contains(token.slice(1));
    const attr = /^\[([^\]=]+)(?:=["']?([^\]"']*)["']?)?\]$/.exec(token);
    if (!attr || !node.hasAttribute(attr[1])) return false;
    return attr[2] === undefined || node.getAttribute(attr[1]) === attr[2];
  });
}

function parseFragment(markup, doc) {
  const root = doc.createDocumentFragment();
  const stack = [root];
  const tokens = String(markup).match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || [];
  tokens.forEach((token) => {
    if (!token || /^\s+$/.test(token) || token.startsWith('<!--')) return;
    if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); return; }
    if (!token.startsWith('<')) { stack[stack.length - 1].appendChild(doc.createTextNode(token.replace(/&amp;/g, '&'))); return; }
    const tag = /^<\s*([\w:-]+)([^>]*)>/.exec(token);
    if (!tag) return;
    const ns = tag[1].toLowerCase() === 'svg' ? 'http://www.w3.org/2000/svg' : null;
    const node = doc.createElementNS(ns || 'http://www.w3.org/1999/xhtml', tag[1]);
    const attrRe = /([:\w-]+)\s*=\s*"([^"]*)"|([:\w-]+)\s*=\s*'([^']*)'|([:\w-]+)/g;
    let found;
    while ((found = attrRe.exec(tag[2])) !== null) {
      node.setAttribute(found[1] || found[3] || found[5], found[2] !== undefined ? found[2] : (found[4] !== undefined ? found[4] : ''));
    }
    stack[stack.length - 1].appendChild(node);
    if (!/\/>$/.test(token) && !/^(?:path|rect|circle|hr|br|img|input|meta|link)$/i.test(tag[1])) stack.push(node);
  });
  return root.children.slice();
}

function serialize(node) {
  if (node.nodeType === 3) return node.textContent;
  const attrs = Object.entries(node.attrs || {}).map(([key, value]) => ' ' + key + '="' + value + '"').join('');
  return '<' + node.localName + attrs + '>' + (node.children || []).map(serialize).join('') + '</' + node.localName + '>';
}

function makeDocument() {
  const doc = {
    nodeType: 9,
    activeElement: null,
    children: [],
    defaultView: { PointerEvent: function PointerEvent() {} },
    createElement(tag) {
      const node = new MiniElement(tag, this);
      if (String(tag).toLowerCase() === 'template') node.content = this.createDocumentFragment();
      return node;
    },
    createElementNS(namespace, tag) { return new MiniElement(tag, this, namespace); },
    createTextNode(value) { return new MiniText(value, this); },
    createDocumentFragment() {
      const fragment = {
        nodeType: 11,
        children: [],
        parentNode: null,
        ownerDocument: this,
        appendChild(node) { this.children.push(node); node.parentNode = this; return node; },
        get firstChild() { return this.children[0] || null; },
        removeChild(node) {
          const index = this.children.indexOf(node);
          if (index >= 0) this.children.splice(index, 1);
          if (node.parentNode === this) node.parentNode = null;
          return node;
        },
      };
      return fragment;
    },
    getElementById(id) { return descendants(this).find((node) => node.id === id) || null; },
    addEventListener(type, fn, capture) { this.addEventListener._list ||= Object.create(null); (this.addEventListener._list[type] ||= []).push({ fn, capture: !!capture }); },
    removeEventListener(type, fn, capture) {
      const list = (this.addEventListener._list || {})[type] || [];
      const index = list.findIndex((item) => item.fn === fn && item.capture === !!capture);
      if (index >= 0) list.splice(index, 1);
    },
    dispatchEvent(event) {
      const ev = event || {};
      ev.target = ev.target || this;
      ev.preventDefault = ev.preventDefault || (() => {});
      ev.stopPropagation = ev.stopPropagation || (() => { ev.stopped = true; });
      ev.stopImmediatePropagation = ev.stopImmediatePropagation || ev.stopPropagation;
      ((this.addEventListener._list || {})[ev.type] || []).slice().forEach((entry) => { if (!ev.stopped) entry.fn(ev); });
      return !ev.defaultPrevented;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) { return descendants(this).filter((node) => node.matches(selector)); },
  };
  doc.documentElement = new MiniElement('html', doc);
  doc.documentElement.parentNode = doc;
  doc.head = new MiniElement('head', doc);
  doc.body = new MiniElement('body', doc);
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  doc.children.push(doc.documentElement);
  doc.documentElement.style.setProperty('overflow', 'auto', '');
  doc.body.style.setProperty('overflow-y', 'scroll', '');
  return doc;
}

function loadUi(doc) {
  const sandbox = { document: doc, console, Promise, Object, Array, String, Number, Boolean, JSON, Math, Date, RegExp, Error, Set, Map, URL };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const key of ['components', 'harbor', 'clue', 'mailbox', 'receipt', 'invitation']) {
    sandbox.module = { exports: {} };
    vm.runInContext(source[key], sandbox, { filename: FILES[key] });
  }
  return sandbox.ArcadeCareerUI;
}

function trackShellProps(ui) {
  const props = [];
  const originalCreate = ui.components.CareerShell.create;
  ui.components.CareerShell.create = function trackedCreate(panelKey) {
    const shell = originalCreate(panelKey);
    if (!shell) return shell;
    return {
      open(ctx) { props.push({ method: 'open', ctx: ctx }); return shell.open(ctx); },
      render(ctx) { props.push({ method: 'render', ctx: ctx }); return shell.render(ctx); },
      close() { return shell.close(); },
    };
  };
  return props;
}

function buttonBy(doc, action) {
  return doc.querySelectorAll('[data-action="' + action + '"]')[0] || null;
}
function panelOf(doc) { return doc.querySelector('[data-career-panel]'); }
function textOf(node) { return node ? node.textContent : ''; }

/* ------------------------------------------------------------------ *
 * Static ownership / no copied CSS.
 * ------------------------------------------------------------------ */

const invitationSources = ['clue', 'mailbox', 'receipt', 'invitation'];
check('fixture productionVisible is false', fixture.contentPolicy.productionVisible === false && fixture.contentPolicy.qaOnly === true);
check('fixture P01/P02/P05/P06 use real mapped IDs', ['P01', 'P02', 'P05', 'P06'].every((id) => !!stateOfFixture(id)));
const runtimeSources = Object.fromEntries(invitationSources.map((key) => [key, source[key].replace(/\/\*[\s\S]*?\*\//g, '')]));
check('adapters do not read full catalog or storage', invitationSources.every((key) => !/ctx\.commissions|careerCatalog\(|listAvailable\(|localStorage|indexedDB|fetch\(/.test(runtimeSources[key])));
/* The letter surface may not disclose commissions, so the adapter defaults to it and
   widens to 'port' only behind the persisted first-arrival marker. */
const readViewBody = (source.invitation.match(/async function readView\([\s\S]*?\n  \}/) || [''])[0];
check('invitation adapter reads only gated narrative/view surfaces',
  /pendingFirstArrival \? 'port' : 'letter'/.test(source.invitation)
  && readViewBody.length > 0
  && readViewBody.includes("'letter'")
  && readViewBody.includes("'port'")
  && !/'(work|receipt|journal|route|deep-link|tools|shop|crafting|message|clue)'/.test(readViewBody)
  && !/narrative-shards/.test(source.invitation));
check('mailbox list keeps the real letter title above the ambient scene',
  /title: titleOf\(clue\),/.test(source.mailbox)
  && /teaser: cleanText\(clue\.ambientText\) \|\| cleanText\(clue\.ambientLabel\)/.test(source.mailbox));
check('ClueRow is rendered by T11 component', /components\.ClueRow\(/.test(source.clue) && /ac-career-ui/.test(source.clue));
check('LetterCard is rendered by T11 component', /components\.LetterCard\(/.test(source.mailbox));
check('ReceiptCard is rendered by T11 component', /components\.ReceiptCard\(/.test(source.receipt));
check('no adapter injects copied stylesheet', invitationSources.every((key) => !/<style|\.style\.cssText|appendChild\(style/.test(source[key])));
check('accept action is the only profession-write path in mailbox', /accept\.call\(session\.context, \{ professionId: invitation\.professionId, gameId: invitation\.gameId \}\)/.test(source.mailbox) && !/applyProfessionEvent|\.acceptProfessionInvitation\(/.test(source.mailbox));
check('mailbox awaits openClue and subscribes to projection changes', /await Promise\.resolve\(session\.context\.openClue\(clueId\)\)/.test(source.mailbox) && /subscribeComponentChanges\(session\)/.test(source.mailbox) && /COMPONENT_DESTRUCTIVE_REASONS/.test(source.mailbox));
check('P01 adapter wrapper has no copied surface styling', /wrapper\.className = 'ac-career-ui';/.test(source.clue) && !/wrapper\.className = [^;]*ac-career-ui__surface/.test(source.clue));
check('P04 passes work reward text derived from settled rewards to ReceiptCard', /workText: workRewardTextOf\(allRewards, presentation\)/.test(source.receipt));
/* 0.22 后日谈入口必须留在组件收据里，而不是被下一单委托顶掉。 */
check('P04 ending receipt keeps read-epilogue before routine work',
  /fields\.ending && campaign/.test(source.receipt) && /id: 'read-epilogue', label: '读后日谈'/.test(source.receipt));
check('receipt projection never reads storyFeedback.nextStep', !/raw\.nextStep/.test(source.receipt) && /projectedStoryOf\(outer\)/.test(source.receipt));

/* ------------------------------------------------------------------ *
 * P01 — settlement clue, ordinary result first, no untriggered node.
 * ------------------------------------------------------------------ */

{
  const doc = makeDocument();
  const ui = loadUi(doc);
  const p01 = stateOfFixture('P01');
  const replay = doc.createElement('button');
  replay.textContent = p01.props.hostResult.primaryActionLabel;
  const host = doc.createElement('div');
  host.appendChild(replay);
  doc.body.appendChild(host);
  const clue = p01.bridgeInput.clue;
  let opened = 0;
  const rendered = ui.clueSurface.render({
    clue: clue,
    state: p01.bridgeInput.state,
    placement: 'result-host',
    host: host,
    anchor: replay,
    uiComponents: ui.components,
    professionId: p01.props.clueRow.professionId,
    onOpen(id) { opened += 1; eq('P01 onOpen receives fixture clueId', id, clue.clueId); },
  });
  eq('P01 clue root is career token root', rendered && rendered.className, 'ac-career-ui');
  check('P01 adapter wrapper adds no surface/border/padding', !!rendered
    && !rendered.hasAttribute('style')
    && rendered.querySelectorAll('.ac-career-ui__surface').length === 0
    && rendered.children.length === 1);
  const row = rendered && rendered.querySelector('.ac-career-ui__clue');
  eq('P01 ClueRow component state', row && row.getAttribute('data-clue-state'), 'glimpsed');
  eq('P01 ClueRow placement', row && row.getAttribute('data-placement'), 'result-host');
  eq('P01 ClueRow title uses ambientLabel', row && row.querySelector('.ac-career-ui__clue-title').textContent, p01.props.clueRow.title);
  eq('P01 ClueRow teaser', row && row.querySelector('.ac-career-ui__clue-teaser').textContent, p01.props.clueRow.teaser);
  check('P01 replay button precedes clue in host DOM', replay.nextSibling === rendered);
  check('P01 no task/reward/profession text', !/委托|报酬|nature\.miner|采矿员/.test(textOf(rendered)));
  row.click();
  eq('P01 one activation calls onOpen once', opened, 1);
  const derived = ui.clueSurface.deriveProps({
    clue: clue,
    state: {
      stage: 'GLIMPSED',
      portSeenAt: null,
      clues: { 'CL-gold-miner': { seenAt: '1', openedAt: null }, 'CL-other': { openedAt: '2026-11-27T00:00:00Z' } },
    },
  });
  eq('P01 recoverable state overrides glimpsed', derived.state, 'recoverable');
  eq('P01 recoverable icon is mail', derived.icon, 'mail');
  check('P01 recoverable action comes from letter', derived.actionLabel === clue.letter.actionLabel);
  eq('P01 clear removes the clue', ui.clueSurface.clear(), true);
  const untriggered = ui.clueSurface.render({ clue: clue, state: { clues: {} }, host: host, uiComponents: ui.components });
  eq('P01 untriggered clue has no DOM', untriggered, null);
  eq('P01 no duplicate chip after clear', doc.querySelectorAll('[data-career-clue]').length, 0);
}

/* ------------------------------------------------------------------ *
 * P02 — letter card: exact fixture text, two real actions, no task.
 * ------------------------------------------------------------------ */

function invitationContext(doc, overrides = {}) {
  const events = [];
  const p02 = stateOfFixture('P02').props.letterCard;
  const listeners = [];
  let unsubscribeCount = 0;
  const ctx = {
    state: { stage: 'LOCAL', clues: { 'CL-gold-miner': { seenAt: '2026-11-27T00:00:00Z' } }, firstClueId: 'CL-gold-miner' },
    letterTitle: p02.title,
    clues: [{ clueId: 'CL-gold-miner', title: p02.title, ambientLabel: p02.ambientLabel, letter: {
      sender: p02.sender,
      body: p02.paragraphs.join('\n'),
      address: '折光港',
      actionLabel: '按地址投递',
    } }],
    narrative: { 'nature.miner': { acceptLabel: p02.actions[0].label, deferLabel: p02.actions[1].label } },
    announce() {},
    invitationForClue() { return { professionId: 'nature.miner', gameId: 'gold-miner', displayName: '采矿员', state: 'read', canAccept: true }; },
    careerView: () => Promise.resolve({ schemaVersion: 1, professions: [], commissions: [], story: {}, tools: [] }),
    openClue(id) { events.push(['openClue', id]); return Promise.resolve({ ok: true }); },
    onCareerDataChanged(listener) {
      listeners.push(listener);
      return () => { unsubscribeCount += 1; };
    },
    acceptProfessionInvitation(input) { events.push(['accept', input.professionId, input.gameId]); return Promise.resolve({ ok: true, created: false }); },
    commission: { start() { events.push('commission.start'); return { ok: true }; } },
    _events: events,
    _listeners: listeners,
    get unsubscribeCount() { return unsubscribeCount; },
    ...overrides,
  };
  return ctx;
}

{
  const doc = makeDocument();
  const ui = loadUi(doc);
  const shellProps = trackShellProps(ui);
  const p02 = stateOfFixture('P02').props.letterCard;
  const openedClues = [];
  let settleOpenClue = null;
  const ctx = invitationContext(doc, {
    openClue(id) { openedClues.push(id); return new Promise((resolve) => { settleOpenClue = resolve; }); },
  });
  ui.mailbox.open(ctx);
  await drain();
  eq('P02 mailbox awaits real openClue (no premature action)', openedClues.join(','), 'CL-gold-miner');
  check('P02 pending openClue exposes no guessed action', !buttonBy(doc, 'accept-invitation') && !buttonBy(doc, 'send-to-port') && !buttonBy(doc, 'deliver-letter'));
  settleOpenClue({ ok: true });
  await drain();
  check('P02 CareerShell keeps the shared header visible', shellProps.length > 0 && shellProps.every((item) => item.ctx.showHeader !== false));
  const card = doc.querySelector('.ac-career-ui__letter');
  check('P02 LetterCard is present', !!card && !!panelOf(doc));
  eq('P02 letter state', card.parentNode.getAttribute('data-letter-state'), 'unread');
  eq('P02 title comes from fixture', card.querySelector('h2').textContent, p02.title);
  eq('P02 ambient comes from fixture', card.parentNode.querySelector('.ac-career-ui__caption').textContent, p02.ambientLabel);
  eq('P02 paragraphs come from fixture', JSON.stringify(card.querySelectorAll('.ac-career-ui__letter-paragraph').map((node) => node.textContent)), JSON.stringify(p02.paragraphs));
  eq('P02 signature comes from fixture', card.querySelector('.ac-career-ui__signature').textContent, '—— ' + p02.sender);
  eq('P02 accept label comes from fixture', buttonBy(doc, 'accept-invitation').textContent, p02.actions[0].label);
  eq('P02 defer label comes from fixture', buttonBy(doc, 'defer-invitation').textContent, p02.actions[1].label);
  check('P02 no task fields', !/委托目标|奖励|职业等级|gold-miner\.T1/.test(textOf(panelOf(doc))));
  ctx._listeners[0]({ reason: 'changed' });
  await drain();
  check('P02 onCareerDataChanged refreshes without losing invitation', !!buttonBy(doc, 'accept-invitation') && !/委托目标|报酬/.test(textOf(panelOf(doc))));
  buttonBy(doc, 'accept-invitation').click();
  await drain();
  eq('P02 accept calls controlled facade once', ctx._events.filter((item) => Array.isArray(item) && item[0] === 'accept').length, 1);
  check('P02 accept never starts commission', !ctx._events.includes('commission.start'));
  check('P02 accepted state is visible', textOf(panelOf(doc)).includes('邀请已收下'), textOf(panelOf(doc)));
  buttonBy(doc, 'accept-invitation')?.click();
  await drain();
  eq('P02 repeated accept remains no-op', ctx._events.filter((item) => Array.isArray(item) && item[0] === 'accept').length, 1);
  ctx._listeners[0]({ reason: 'career-archived' });
  check('P02 destructive career event closes panel', panelOf(doc) === null);
  eq('P02 destructive close unsubscribes once', ctx.unsubscribeCount, 1);
  ui.mailbox.close();
}

/* ------------------------------------------------------------------ *
 * M1 — user-initiated clue selection awaits openClue before showing actions.
 * ------------------------------------------------------------------ */

{
  const doc = makeDocument();
  const ui = loadUi(doc);
  const secondClueId = 'CL-shadow-leap';
  const opened = [];
  let settleSecond = null;
  const ctx = {
    state: { stage: 'LOCAL', firstClueId: 'CL-gold-miner', clues: {
      'CL-gold-miner': { seenAt: '2026-11-27T00:00:00Z', openedAt: '2026-11-27T00:00:00Z' },
      [secondClueId]: { seenAt: '2026-11-27T01:00:00Z' },
    } },
    clueId: 'CL-gold-miner',
    clues: [
      { clueId: 'CL-gold-miner', title: '第一封', letter: { sender: '甲', body: '第一封正文' } },
      { clueId: secondClueId, title: '第二封', letter: { sender: '乙', body: '第二封正文' } },
    ],
    openClue(id) {
      opened.push(id);
      if (id === secondClueId) return new Promise((resolve) => { settleSecond = resolve; });
      return Promise.resolve({ ok: true });
    },
    invitationForClue(id) {
      return id === secondClueId
        ? { professionId: 'adventure.relicseeker', gameId: 'shadow-leap', state: 'read', canAccept: true }
        : null;
    },
    careerView: () => Promise.resolve({ professions: [], commissions: [], story: {}, tools: [] }),
    acceptProfessionInvitation() { return Promise.resolve({ ok: true, created: false }); },
    announce() {},
  };
  ui.mailbox.open(ctx);
  await drain();
  eq('M1 initial bridge-selected clue does not repeat openClue', opened.length, 0);
  const row = doc.querySelector('[data-clue-id="' + secondClueId + '"]');
  row.click();
  await drain();
  eq('M1 selected clue calls openClue once', opened.join(','), secondClueId);
  check('M1 pending selection shows no guessed action', !buttonBy(doc, 'accept-invitation') && !buttonBy(doc, 'deliver-letter') && !buttonBy(doc, 'send-to-port'));
  settleSecond({ ok: true });
  await drain();
  check('M1 invitation appears only after openClue settles', !!buttonBy(doc, 'accept-invitation') && !!buttonBy(doc, 'defer-invitation'), textOf(panelOf(doc)));
  ui.mailbox.close();
}

/* ------------------------------------------------------------------ *
 * P05 / P06 — one invitation adapter, existing identity, created:false.
 * ------------------------------------------------------------------ */

function narrativeFor(professionId) {
  return {
    [professionId]: {
      title: '合成邀请 · 乙',
      location: '折光港 · 旧码头',
      npcName: '港口记录员',
      freshIntro: ['这是一段只用于首次到港的合成说明。'],
      existingIntro: ['这是一段已有的合成语境。'],
      acceptLabel: '认识这位合成记录人',
      deferLabel: '先放着，不着急',
    },
  };
}

{
  const doc = makeDocument();
  const ui = loadUi(doc);
  const shellProps = trackShellProps(ui);
  const p05 = stateOfFixture('P05');
  const p06 = stateOfFixture('P06');
  const events = [];
  const ctx = {
    clueId: p05.bridgeInput.clue.clueId,
    state: { stage: 'LOCAL', clues: { [p05.bridgeInput.clue.clueId]: { openedAt: '2026-11-27T00:00:00Z' } }, acceptedOriginGameId: 'gold-miner' },
    careerId: 'career-existing',
    narrative: Object.assign({}, narrativeFor('adventure.relicseeker')['adventure.relicseeker'], {
      title: p06.props.title,
      location: p06.props.caption,
    }),
    invitationForClue() { return { professionId: 'adventure.relicseeker', gameId: 'shadow-leap', displayName: '遗迹探险家', state: 'read', canAccept: true }; },
    careerView: () => Promise.resolve({ schemaVersion: 1, originGameId: 'gold-miner', professions: [{ professionId: 'nature.miner', displayName: '采矿员', state: 'accepted' }], commissions: [], story: {}, tools: [] }),
    acceptProfessionInvitation(input) { events.push(['accept', input.professionId, input.gameId]); return Promise.resolve({ ok: true, created: false, newlyAccepted: true }); },
    commission: { start() { events.push('commission.start'); return { ok: true }; } },
    uiComponents: ui.components,
    uiHarbor: ui.harbor,
    announce() {},
  };
  const derived = await ui.invitation.derive(ctx);
  eq('P05/P06 derived mode is existingIntro', derived.mode, 'existingIntro');
  eq('P05/P06 no first commission before acceptance', derived.firstCommission, null);
  const opened = ui.invitation.open(ctx);
  eq('P06 adapter open ok', opened.ok, true);
  await drain();
  check('P06 CareerShell keeps the shared header visible', shellProps.length > 0 && shellProps.every((item) => item.ctx.showHeader !== false));
  const panel = panelOf(doc);
  const shellBody = doc.querySelector('.ac-career-ui__body');
  check('P06 shell body was rendered', !!shellBody && shellBody.children.length > 0, {
    overlays: doc.querySelectorAll('[data-career-panel]').length,
    panels: doc.querySelectorAll('.ac-career-ui__panel').map((node) => node.getAttribute('data-shell-state')),
    state: panel && panel.getAttribute('data-shell-state'),
    bodyChildren: shellBody && shellBody.children.length,
    body: textOf(doc.body),
  });
  check('P06 NPC state is optional', !!panel && !!panel.querySelector('.ac-career-ui__npc') && panel.querySelector('.ac-career-ui__npc').getAttribute('data-npc-state') === 'optional', { panel: !!panel, body: textOf(doc.body) });
  check('P06 existingIntro text is used', textOf(panel).includes('已有的合成语境'));
  check('P06 freshIntro is not replayed', !textOf(panel).includes('首次到港的合成说明'));
  check('P06 shows the invitation heading without repeating the first-arrival harbor',
    panel.querySelector('.ac-career-ui__header .ac-career-ui__title').textContent === p06.props.title && !panel.querySelector('svg.harbor'));
  check('P06 no task title/objective/reward', !/委托标题|报酬|职业进度|shadow-leap\.T1/.test(textOf(panel)));
  check('P06 accept/defer actions exist', !!buttonBy(doc, 'accept-invitation') && !!buttonBy(doc, 'defer-invitation'), {
    text: textOf(panel),
    buttons: panel.querySelectorAll('button').map((node) => ({ text: node.textContent, action: node.getAttribute('data-action'), id: node.id })),
  });
  buttonBy(doc, 'accept-invitation').click();
  await drain();
  eq('P06 accept uses controlled facade exactly once', events.filter((item) => Array.isArray(item) && item[0] === 'accept').length, 1);
  check('P06 created:false does not start commission', !events.includes('commission.start'));
  check('P06 created:false does not replay prologue', !/序章|开张的底钱|C0/.test(textOf(panelOf(doc))));
  eq('P06 created flag stays false', doc.querySelector('.ac-career-ui__panel').getAttribute('data-invitation-created'), 'false');
  ui.invitation.close();
  eq('P06 close removes panel', panelOf(doc), null);
}

/* ------------------------------------------------------------------ *
 * P03 — first arrival: freshIntro, then explicit first-commission action.
 * ------------------------------------------------------------------ */

{
  const doc = makeDocument();
  const ui = loadUi(doc);
  const shellProps = trackShellProps(ui);
  const p03 = stateOfFixture('P03');
  const events = [];
  let accepted = false;
  const professionId = 'nature.miner';
  const ctx = {
    clueId: 'CL-gold-miner',
    state: { stage: 'LOCAL', clues: { 'CL-gold-miner': { openedAt: '2026-11-27T00:00:00Z' } } },
    narrative: {
      [professionId]: {
        title: p03.props.storyCard.title,
        location: p03.props.caption,
        npcName: p03.props.npcDialogue.name,
        freshIntro: p03.props.npcDialogue.paragraphs,
        existingIntro: ['已有身份时的另一段合成说明。'],
        firstCommissionId: p03.commissionId,
        firstCommissionEyebrow: p03.props.storyCard.eyebrow,
        acceptLabel: '接受这份邀请',
        deferLabel: '以后再说',
        leaveLabel: p03.props.secondaryAction.label,
        firstActionLabel: p03.props.primaryAction.label,
      },
    },
    invitationForClue() { return { professionId: professionId, gameId: 'gold-miner', displayName: '采矿员', state: 'read', canAccept: !accepted }; },
    careerView: () => Promise.resolve({
      schemaVersion: 1,
      originGameId: null,
      professions: accepted ? [{ professionId: professionId, displayName: '采矿员', state: 'accepted' }] : [],
      commissions: accepted ? [{ commissionId: 'gold-miner.T1', professionId: professionId, category: 'profession', title: p03.props.storyCard.title, summary: p03.props.storyCard.summary }] : [],
      story: { nextAction: null, messages: [], history: [] },
      tools: [],
    }),
    acceptProfessionInvitation(input) { events.push(['accept', input.professionId, input.gameId]); accepted = true; return Promise.resolve({ ok: true, created: true, newlyAccepted: true }); },
    commission: { start(input) { events.push(['start', input.commissionId, input.ensure]); return Promise.resolve({ ok: true, url: '#gold-miner' }); } },
    consumeFirstArrival(input) { events.push(['consume', input.professionId]); return Promise.resolve({ ok: true }); },
    uiComponents: ui.components,
    uiHarbor: ui.harbor,
    announce() {},
  };
  const derived = await ui.invitation.derive(ctx);
  eq('P03 derived mode is freshIntro', derived.mode, 'freshIntro');
  check('P03 no commission before identity is accepted', derived.firstCommission === null);
  ui.invitation.open(ctx);
  await drain();
  check('P03 CareerShell keeps the shared header visible', shellProps.length > 0 && shellProps.every((item) => item.ctx.showHeader !== false));
  check('P03 harbor + caption are present', !!panelOf(doc).querySelector('svg.harbor') && textOf(panelOf(doc)).includes('折光港 · 旧码头'));
  eq('P03 NPC state first', panelOf(doc).querySelector('.ac-career-ui__npc').getAttribute('data-npc-state'), 'first');
  check('P03 freshIntro paragraphs are used', p03.props.npcDialogue.paragraphs.every((line) => textOf(panelOf(doc)).includes(line)));
  check('P03 no commission card before accept', !buttonBy(doc, 'start-first-commission'));
  buttonBy(doc, 'accept-invitation').click();
  await drain();
  eq('P03 first accept is controlled once', events.filter((item) => Array.isArray(item) && item[0] === 'accept').length, 1);
  check('P03 accept does not auto-start commission', !events.some((item) => Array.isArray(item) && item[0] === 'start'));
  check('P03 projected first commission appears after success', textOf(panelOf(doc)).includes(p03.props.storyCard.title));
  check('P03 eyebrow/action/leave labels come from fixture',
    textOf(panelOf(doc)).includes(p03.props.storyCard.eyebrow)
    && textOf(panelOf(doc)).includes(p03.props.primaryAction.label)
    && textOf(panelOf(doc)).includes(p03.props.secondaryAction.label), textOf(panelOf(doc)));
  eq('P03 created flag is true', doc.querySelector('.ac-career-ui__panel').getAttribute('data-invitation-created'), 'true');
  const acceptedContext = Object.assign({}, ctx, {
    invitationForClue: () => ({ professionId, gameId: 'gold-miner', state: 'accepted' }),
  });
  const fromLetter = await ui.invitation.derive(Object.assign({}, acceptedContext, { firstArrival: true }));
  const reopened = await ui.invitation.derive(acceptedContext);
  check('P03 first arrival survives the letter handoff and has an authorized first commission',
    fromLetter.mode === 'freshIntro' && fromLetter.firstCommission?.commissionId === 'gold-miner.T1');
  check('P03 reopening an accepted invitation does not replay first arrival',
    reopened.mode === 'existingIntro' && reopened.firstCommission === null);
  const start = buttonBy(doc, 'start-first-commission');
  check('P03 explicit commission action exists', !!start, {
    buttons: panelOf(doc).querySelectorAll('button').map((node) => ({ text: node.textContent, action: node.getAttribute('data-action'), id: node.id })),
  });
  start.click();
  await drain();
  check('P03 explicit start uses ensure:false once', events.some((item) => Array.isArray(item) && item[0] === 'start' && item[1] === 'gold-miner.T1' && item[2] === false));
  check('P03 first arrival is consumed only after the real start succeeds',
    events.filter((item) => Array.isArray(item) && item[0] === 'consume').length === 1
    && events.findIndex((item) => Array.isArray(item) && item[0] === 'start') < events.findIndex((item) => Array.isArray(item) && item[0] === 'consume'),
    events);
  ui.invitation.close();
}

/* ------------------------------------------------------------------ *
 * M3 — firstCommissionId limits selection to authorized port rows.
 * ------------------------------------------------------------------ */

async function deriveFirstCommission(rows, wanted) {
  const doc = makeDocument();
  const ui = loadUi(doc);
  const ctx = {
    clueId: 'CL-gold-miner',
    careerId: 'career-existing',
    state: { acceptedOriginGameId: 'gold-miner' },
    narrative: { 'nature.miner': { firstCommissionId: wanted } },
    invitationForClue() { return { professionId: 'nature.miner', gameId: 'gold-miner', displayName: '采矿员', state: 'read', canAccept: true }; },
    careerView: () => Promise.resolve({
      schemaVersion: 1, originGameId: 'gold-miner',
      professions: [{ professionId: 'nature.miner', displayName: '采矿员', state: 'accepted' }],
      commissions: rows, story: { nextAction: null, messages: [], history: [] }, tools: [],
    }),
    uiComponents: ui.components,
    uiHarbor: ui.harbor,
  };
  const derived = await ui.invitation.derive(ctx, {
    acceptedResult: { ok: true, created: true, newlyAccepted: true },
    identityBefore: false,
  });
  return derived;
}

{
  const valid = { commissionId: 'gold-miner.T1', professionId: 'nature.miner', category: 'profession', title: '合成交接 · 甲' };
  const cases = [
    ['M3 cross-profession mismatch is rejected', [{ ...valid, professionId: 'adventure.relicseeker', commissionId: 'shadow-leap.T1' }]],
    ['M3 exact world work from another game is rejected', [{ commissionId: 'shadow-leap.T1', gameId: 'shadow-leap', category: 'world' }]],
    ['M3 exact world work assigned to another profession is rejected', [{ commissionId: 'shadow-leap.T1', gameId: 'gold-miner', professionId: 'adventure.relicseeker', category: 'world' }]],
    ['M3 readOnly row is rejected', [{ ...valid, commissionId: 'shadow-leap.T1', readOnly: true }]],
    ['M3 historicalOnly row is rejected', [{ ...valid, commissionId: 'shadow-leap.T1', historicalOnly: true }]],
    ['M3 locked row is rejected', [{ ...valid, commissionId: 'shadow-leap.T1', unlocked: false }]],
    ['M3 explicit id does not fall back to another profession row', [valid, { ...valid, professionId: 'adventure.relicseeker', commissionId: 'shadow-leap.T1' }]],
  ];
  for (const [name, rows] of cases) {
    const derived = await deriveFirstCommission(rows, 'shadow-leap.T1');
    check(name, derived.ok === true && derived.firstCommission === null, derived.firstCommission);
  }
  const matched = await deriveFirstCommission([valid], 'gold-miner.T1');
  eq('M3 matching profession commission remains startable', matched.firstCommission && matched.firstCommission.commissionId, 'gold-miner.T1');
  const world = { commissionId: 'gold-miner.T1', gameId: 'gold-miner', category: 'world' };
  const missingExplicitId = await deriveFirstCommission([world], '');
  eq('M3 world work cannot substitute for a missing explicit first commission', missingExplicitId.firstCommission, null);
}

{
  const require = createRequire(import.meta.url);
  const careerDir = path.join(ROOT, 'apps/arcade/career');
  const content = (name) => JSON.parse(fs.readFileSync(path.join(careerDir, 'content', name), 'utf8'));
  const professionView = require(path.join(careerDir, 'profession-view.js'));
  const catalog = Object.assign(content('registry.json'), {
    commissions: content('commissions.json').commissions,
    clues: content('clues.json').clues,
    worldWork: content('world-work.json'),
  });
  const worlds = [
    ['star-raid', 'narrative-shards/shard-03.json'],
    ['pendulum-tower', 'narrative-shards/shard-04.json'],
  ];
  for (const [gameId, shard] of worlds) {
    const narrative = content(shard).entries.find((entry) => entry.gameId === gameId);
    const { professionId, firstCommissionId } = narrative;
    const state = {
      professionVersion: 1,
      acceptedOriginGameId: gameId,
      activeProfessionId: professionId,
      professionProgress: { [professionId]: { state: 'accepted' } },
    };
    const doc = makeDocument();
    const ui = loadUi(doc);
    const starts = [];
    const ctx = {
      clueId: 'CL-' + gameId,
      state,
      narrative,
      invitationForClue: () => ({ gameId, professionId, state: 'accepted', firstArrival: true }),
      careerView: ({ surface }) => professionView.projectCareerView({
        state, catalog, context: { surface, availableIds: [firstCommissionId] },
      }),
      commission: { start(input) { starts.push(input.commissionId); return { ok: true }; } },
    };
    const model = await ui.invitation.derive(ctx);
    const worldText = catalog.worldWork.entries.find((entry) => entry.commissionId === firstCommissionId);
    check('P03 ' + gameId + ' uses the real public world-work projection',
      model.firstCommission?.commissionId === firstCommissionId && model.firstCommission.category === 'world'
      && model.firstCommission.professionId === undefined && model.firstCommission.title === worldText.title);
    ui.invitation.open(ctx);
    await drain();
    const start = buttonBy(doc, 'start-first-commission');
    check('P03 ' + gameId + ' renders projected work before any signing',
      !!start && textOf(panelOf(doc)).includes(worldText.title) && starts.length === 0);
    start?.click();
    await drain();
    eq('P03 ' + gameId + ' signs the projected first work on explicit click', starts.join(','), firstCommissionId);
    ui.invitation.close();
  }
}

/* ------------------------------------------------------------------ *
 * P06 — the real mailbox entry for an established identity: the follow-up
 * invitation is explained by the invited profession's real person before the
 * optional accept action. Uses the real clue and the real narrative shard.
 * ------------------------------------------------------------------ */

{
  const careerDir = path.join(ROOT, 'apps/arcade/career');
  const content = (name) => JSON.parse(fs.readFileSync(path.join(careerDir, 'content', name), 'utf8'));
  const narrative = Object.fromEntries(content('narrative-registry.json').shards
    .flatMap((shard) => content(shard.url.replace('./', '')).entries)
    .map((entry) => [entry.professionId, entry]));
  const relicseeker = narrative['adventure.relicseeker'];
  const letter = content('clues.json').clues.find((clue) => clue.clueId === 'CL-shadow-leap').letter.body;
  const doc = makeDocument();
  const ui = loadUi(doc);
  const events = [];
  const established = {
    careerId: 'career-existing',
    state: { stage: 'LOCAL', firstClueId: 'CL-gold-miner', acceptedOriginGameId: 'gold-miner', clues: {
      'CL-gold-miner': { seenAt: '2026-11-27T00:00:00Z', openedAt: '2026-11-27T00:00:00Z' },
      'CL-shadow-leap': { seenAt: '2026-11-27T01:00:00Z' },
    } },
    clueId: 'CL-shadow-leap',
    clues: content('clues.json').clues,
    narrative,
    invitationForClue: () => ({ professionId: 'adventure.relicseeker', gameId: 'shadow-leap', displayName: '遗迹探险家', state: 'read', canAccept: true }),
    careerView: () => Promise.resolve({ schemaVersion: 1, originGameId: 'gold-miner', professions: [{ professionId: 'nature.miner', displayName: '采矿员', state: 'accepted' }], commissions: [], story: {}, tools: [] }),
    openClue() { return Promise.resolve({ ok: true }); },
    acceptProfessionInvitation(input) { events.push(['accept', input.professionId, input.gameId]); return Promise.resolve({ ok: true, created: false, newlyAccepted: true }); },
    commission: { start() { events.push('commission.start'); return { ok: true }; } },
    openTown() { events.push('openTown'); return { ok: true }; },
    announce() {},
  };
  const followUpOf = () => panelOf(doc)?.querySelector('[data-mailbox-invitation="follow-up"]') || null;
  ui.mailbox.open(established);
  await drain();
  const followUp = followUpOf();
  check('P06 real mailbox shows an optional follow-up invitation for an established identity',
    !!followUp && followUp.getAttribute('data-npc-state') === 'optional', followUp && textOf(followUp));
  check('P06 the invited profession\'s real person explains the new relation without assuming acquaintance',
    textOf(followUp?.querySelector('.ac-career-ui__npc-name')) === relicseeker.npc && textOf(followUp).includes(relicseeker.existingIntro)
      && !/你还认得|认得你|你送过/.test(relicseeker.existingIntro), textOf(followUp));
  check('P06 the real letter stays above it and the prologue is not replayed',
    textOf(panelOf(doc)).includes(letter) && !textOf(panelOf(doc)).includes(relicseeker.freshIntro[0]));
  const accept = buttonBy(doc, 'accept-invitation');
  const defer = buttonBy(doc, 'defer-invitation');
  check('P06 accept/defer follow the explanation and no first work is offered',
    !!accept && !!defer && followUp.contains(accept) && followUp.contains(defer) && !buttonBy(doc, 'start-first-commission'));
  accept?.click();
  await drain();
  eq('P06 accept goes through the controlled facade exactly once', events.filter((item) => Array.isArray(item) && item[0] === 'accept').length, 1);
  check('P06 an established identity is neither re-registered nor signed into work',
    events.some((item) => Array.isArray(item) && item[0] === 'accept' && item[1] === 'adventure.relicseeker' && item[2] === 'shadow-leap')
      && !events.includes('commission.start') && textOf(panelOf(doc)).includes('邀请已收下'));
  check('P06 an accepted invitation is no longer offered again', followUpOf() === null && !!buttonBy(doc, 'open-town'));
  ui.mailbox.close();

  /* A player without an identity keeps the P02 letter with its own accept action. */
  const freshDoc = makeDocument();
  const freshUi = loadUi(freshDoc);
  freshUi.mailbox.open(Object.assign({}, established, {
    careerId: '',
    state: Object.assign({}, established.state, { acceptedOriginGameId: undefined }),
    clueId: 'CL-shadow-leap',
    careerView: () => Promise.resolve({ schemaVersion: 1, professions: [], commissions: [], story: {}, tools: [] }),
  }));
  await drain();
  check('P02 a player without an identity still accepts from the letter itself',
    !panelOf(freshDoc).querySelector('[data-mailbox-invitation="follow-up"]') && !!buttonBy(freshDoc, 'accept-invitation'));
  freshUi.mailbox.close();
}

function receiptPayload(overrides = {}) {
  const p04 = stateOfFixture('P04').props.receiptCard;
  const material = p04.rewards.materials[0];
  const commissionTitle = p04.resultLine.replace(/已登记$/, '');
  return {
    result: {
      ok: true,
      commissionId: 'gold-miner.T1',
      professionId: 'nature.miner',
      receipt: {
        receiptId: 'commission-1',
        credits: p04.rewards.credits,
        items: { 'fixture-material': material.count },
        txIds: ['tx-1'],
        commissionId: 'gold-miner.T1',
      },
    },
    items: { materials: [{ itemId: 'fixture-material', name: material.name }] },
    receiptPresentation: {
      title: p04.title,
      resultLine: p04.resultLine,
      exitLabel: p04.exitAction.label,
      workRewardLabel: '工作报酬',
      creditLabel: '工钱',
      materialLabel: '材料',
    },
    careerView: {
      schemaVersion: 1,
      originGameId: 'gold-miner',
      activeProfessionId: 'nature.miner',
      professions: [{ professionId: 'nature.miner', displayName: p04.rewards.identity, state: 'accepted', paused: false, active: true }],
      commissions: [{ commissionId: 'gold-miner.T1', professionId: 'nature.miner', category: 'profession', title: commissionTitle }],
      story: {
        nextAction: { kind: 'commission', commissionId: 'gold-miner.T1', label: p04.nextAction.label },
        messages: [],
        history: [{ commissionId: 'gold-miner.T1', label: p04.rewards.experience, at: '2026-11-27', source: 'commission' }],
      },
      tools: [],
    },
    storyFeedback: {
      status: 'new',
      replies: [{ name: p04.npcReply.name, text: p04.npcReply.paragraphs[0] }],
      nextStep: 'UNTRUSTED_FEEDBACK_STEP',
    },
    openTown() { (overrides.events || []).push('openTown'); return { ok: true }; },
    ...overrides,
  };
}

{
  const doc = makeDocument();
  const ui = loadUi(doc);
  const events = [];
  const p04 = stateOfFixture('P04').props.receiptCard;
  const payload = receiptPayload({ events });
  const card = ui.receipt.show(payload);
  check('P04 ReceiptCard component is used', !!card && card.className.includes('ac-career-ui__receipt') && card.getAttribute('role') === 'status');
  eq('P04 success state', card.getAttribute('data-receipt-state'), p04.state);
  check('P04 fixture title/resultLine shown', textOf(card).includes(p04.title) && textOf(card).includes(p04.resultLine));
  const workRow = card.querySelector('[data-receipt-reward="work"]');
  const material = p04.rewards.materials[0];
  eq('P04 work reward/material use one aligned row', workRow && workRow.className, 'ac-career-ui__kv');
  eq('P04 work row composes fixture presentation with real numbers', workRow && workRow.querySelector('.ac-career-ui__kv-value').textContent,
    '工钱 ' + p04.rewards.credits + ' · 材料 ' + material.name + ' ×' + material.count);
  eq('P04 reward rows are not split into four equal rows', card.querySelectorAll('.ac-career-ui__kv').length, 3);
  eq('P04 reward row order is work/identity/experience',
    JSON.stringify(card.querySelectorAll('.ac-career-ui__kv').map((node) => node.textContent)),
    JSON.stringify([
      '工作报酬工钱 ' + p04.rewards.credits + ' · 材料 ' + material.name + ' ×' + material.count,
      '生涯身份' + p04.rewards.identity,
      '经历' + p04.rewards.experience,
    ]));
  check('P04 nonmodal card has no shell header/close', !doc.querySelector('.ac-career-ui__header') && !doc.querySelector('[role="dialog"]'));
  check('P04 projected identity/experience shown', textOf(card).includes(p04.rewards.identity) && textOf(card).includes(p04.rewards.experience));
  check('P04 NPC reply shown', textOf(card).includes(p04.npcReply.name) && textOf(card).includes(p04.npcReply.paragraphs[0]), textOf(card));
  check('P04 next step only from careerView', textOf(doc.body).includes('下一步：' + p04.nextAction.label) && !textOf(doc.body).includes('UNTRUSTED_FEEDBACK_STEP'));
  check('P04 exit label comes from fixture', textOf(card).includes(p04.exitAction.label));
  check('P04 no run/tx/reason leak', !/commission-1|tx-1|runId|txId|reason/.test(textOf(card)));
  const next = buttonBy(doc, 'continue');
  check('P04 projected continue action exists', !!next && next.textContent.includes(p04.nextAction.label));
  next.click();
  await drain();
  eq('P04 continue opens town once', events.filter((item) => item === 'openTown').length, 1);
  check('P04 action closes card first', doc.querySelectorAll('.ac-career-ui__receipt').length === 0, {
    receipts: doc.querySelectorAll('.ac-career-ui__receipt').length,
    body: textOf(doc.body),
  });
}

{
  /* 0.22 终局收据的「读后日谈」入口不能在 0.23 组件收据里丢失：
     结算结果是终局时，主动作必须是读后日谈，而不是下一单职业委托。 */
  const doc = makeDocument();
  const ui = loadUi(doc);
  const events = [];
  const payload = receiptPayload({
    events,
    result: Object.assign({}, receiptPayload().result, {
      approach: 'research',
      commissionId: 'ending.research',
      flags: ['C5.star_tower_resolved', 'ending.research'],
    }),
    openCampaign() { events.push('openCampaign'); return { ok: true }; },
  });
  const endingCard = ui.receipt.show(payload);
  const epilogue = buttonBy(doc, 'read-epilogue');
  check('P04 ending receipt keeps the read-epilogue action', !!epilogue && epilogue.textContent.includes('读后日谈') && !buttonBy(doc, 'continue'),
    { buttons: endingCard.querySelectorAll('button').map((node) => ({ id: node.getAttribute('data-action'), text: node.textContent })) });
  epilogue.click();
  await drain();
  eq('P04 read-epilogue opens the campaign panel once', events.filter((item) => item === 'openCampaign').length, 1);
}

{
  const doc = makeDocument();
  const ui = loadUi(doc);
  let calls = 0;
  const payload = receiptPayload();
  delete payload.result;
  Object.assign(payload, payload.result || {});
  payload.result = { ok: false, reason: 'objective-not-met' };
  payload.retrySettlement = () => {
    calls += 1;
    if (calls === 1) return Promise.resolve({ ok: false, reason: 'still-failed' });
    return Promise.resolve(receiptPayload().result);
  };
  const failed = ui.receipt.show(payload);
  eq('P04 failure state', failed.getAttribute('data-receipt-state'), 'failure');
  check('P04 failure has no reward rows', failed.querySelectorAll('.ac-career-ui__kv').length === 0);
  const retry = buttonBy(doc, 'retry-settlement');
  check('P04 retry action exists', !!retry);
  retry.click();
  await drain();
  eq('P04 false retry does not update receipt', failed.getAttribute('data-receipt-state'), 'failure');
  check('P04 failed retry produces visible retry', !!buttonBy(doc, 'retry-open'));
  buttonBy(doc, 'retry-open').click();
  await drain();
  eq('P04 retry invoked twice', calls, 2);
  const success = doc.querySelector('.ac-career-ui__receipt');
  check('P04 only true result becomes success', success && success.getAttribute('data-receipt-state') === 'success');
}

{
  const doc = makeDocument();
  const ui = loadUi(doc);
  const payload = receiptPayload();
  payload.result.duplicate = true;
  const duplicate = ui.receipt.show(payload);
  eq('P04 duplicate state', duplicate.getAttribute('data-receipt-state'), 'no-duplicate-reward');
  check('P04 duplicate hides rewards', duplicate.querySelectorAll('.ac-career-ui__kv').length === 0 && !textOf(duplicate).includes('12'));
  ui.receipt.close();
  eq('P04 no real result renders nothing', ui.receipt.show({ openTown() {} }), null);
}

/* ------------------------------------------------------------------ *
 * Missing injected dependencies degrade safely.
 * ------------------------------------------------------------------ */

{
  const doc = makeDocument();
  const ui = loadUi(doc);
  const derived = await ui.invitation.derive({ clueId: 'CL-gold-miner', careerView: () => Promise.resolve(null) });
  eq('missing invitationForClue yields no panel', derived.ok, false);
  eq('missing ctx.uiComponents falls back to loaded T11 components', ui.invitation.open({ uiComponents: null }).ok, true);
  ui.invitation.close();
  const bare = ui.clueSurface.deriveProps({ clue: { clueId: 'CL-gold-miner', gameId: 'gold-miner' }, state: { clues: { 'CL-gold-miner': { seenAt: 'now' } } } });
  check('clue missing family falls back to gem icon', bare.icon === 'gem' && bare.actionLabel === '仔细看看');

  const bareSandbox = { document: doc, console, Promise, Object, Array, String, Number, Boolean, JSON, Math, Date, RegExp, Error };
  bareSandbox.window = bareSandbox;
  bareSandbox.globalThis = bareSandbox;
  vm.createContext(bareSandbox);
  vm.runInContext(source.invitation, bareSandbox, { filename: FILES.invitation });
  eq('missing all UI dependencies yields safe failure', bareSandbox.ArcadeCareerUI.invitation.open({}).ok, false);
}

if (failures.length) {
  console.error('FAILED ' + failures.length + ': ' + failures.join('; '));
  process.exit(1);
}
console.log('T12 invitation adapter checks passed: ' + pass + '/' + pass);
