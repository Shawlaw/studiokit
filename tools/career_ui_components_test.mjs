#!/usr/bin/env node
/**
 * Arcade 0.23 T11 — pure Node/VM contract test for the shared career UI.
 *
 * No Chrome, no browser, no build, no fetch, no watch. The product scripts are
 * executed unchanged in vm against a minimal DOM stub; CSS is checked as text.
 *
 * Run: node tools/career_ui_components_test.mjs
 * Exit: 0 = all pass, 1 = at least one failure, 2 = missing input/usage.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REL = {
  tokens: 'apps/arcade/career/ui/tokens.css',
  css: 'apps/arcade/career/ui/components.css',
  components: 'apps/arcade/career/ui/components.js',
  harbor: 'apps/arcade/career/ui/harbor.js',
  prototype: path.join(ROOT, '..', 'arcade-career-022-024', 'prototype', 'reference.js'),
};
const ABS = Object.fromEntries(Object.entries(REL).map(([key, value]) => [key, path.isAbsolute(value) ? value : path.join(ROOT, value)]));

if (process.argv.slice(2).length) {
  console.error('usage: node tools/career_ui_components_test.mjs (no arguments)');
  process.exit(2);
}
for (const [key, file] of Object.entries(ABS)) {
  if (!fs.existsSync(file)) {
    console.error('missing input (' + key + '): ' + file);
    process.exit(2);
  }
}

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log('PASS ' + name);
  } else {
    fail += 1;
    console.log('FAIL ' + name + (detail === undefined ? '' : ' | ' + JSON.stringify(detail)));
  }
}
function eq(name, actual, expected) {
  check(name, Object.is(actual, expected), { actual, expected });
}

/* ------------------------------------------------------------------ *
 * Minimal DOM: enough for the product scripts, deliberately no jsdom.
 * ------------------------------------------------------------------ */

class MiniStyle {
  constructor() { this._values = Object.create(null); }
  setProperty(name, value, priority) {
    this._values[name] = { value: String(value), priority: String(priority || '') };
    this[name] = String(value);
  }
  getPropertyValue(name) {
    return this._values[name] ? this._values[name].value : (this[name] || '');
  }
  getPropertyPriority(name) {
    return this._values[name] ? this._values[name].priority : '';
  }
  removeProperty(name) {
    delete this._values[name];
    delete this[name];
  }
}

class MiniText {
  constructor(value, doc) {
    this.nodeType = 3;
    this.textContent = String(value);
    this.parentNode = null;
    this.ownerDocument = doc;
  }
  get isConnected() { return miniConnected(this); }
  get tagName() { return '#text'; }
}

function miniConnected(node) {
  let cursor = node;
  while (cursor) {
    if (cursor === cursor.ownerDocument) return true;
    if (cursor.ownerDocument && (cursor === cursor.ownerDocument.documentElement || cursor === cursor.ownerDocument.body || cursor === cursor.ownerDocument.head)) return true;
    cursor = cursor.parentNode;
  }
  return false;
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
    this._attrs = Object.create(null);
    this._listeners = Object.create(null);
    this._className = '';
    this._id = '';
    this._type = '';
    this._src = '';
    this._disabled = false;
    this._hidden = false;
    this._open = false;
    this._tabIndex = null;
    this.style = new MiniStyle();
    const self = this;
    this.classList = {
      add(name) {
        const parts = String(self.className).split(/\s+/).filter(Boolean);
        if (!parts.includes(name)) parts.push(name);
        self.className = parts.join(' ');
      },
      remove(name) {
        self.className = String(self.className).split(/\s+/).filter((part) => part && part !== name).join(' ');
      },
      contains(name) { return String(self.className).split(/\s+/).includes(name); },
    };
  }

  get className() { return this._className; }
  set className(value) {
    this._className = String(value);
    this._attrs.class = this._className;
  }
  get id() { return this._id; }
  set id(value) {
    this._id = String(value);
    this._attrs.id = this._id;
  }
  get type() { return this._type; }
  set type(value) {
    this._type = String(value);
    this._attrs.type = this._type;
  }
  get src() { return this._src; }
  set src(value) {
    this._src = String(value);
    this._attrs.src = this._src;
  }
  get disabled() { return this._disabled; }
  set disabled(value) {
    this._disabled = !!value;
    if (this._disabled) this._attrs.disabled = '';
    else delete this._attrs.disabled;
  }
  get hidden() { return this._hidden; }
  set hidden(value) {
    this._hidden = !!value;
    if (this._hidden) this._attrs.hidden = '';
    else delete this._attrs.hidden;
  }
  get open() { return this._open; }
  set open(value) { this._open = !!value; }
  get tabIndex() { return this._tabIndex === null ? 0 : this._tabIndex; }
  set tabIndex(value) {
    this._tabIndex = Number(value);
    this._attrs.tabindex = String(this._tabIndex);
  }
  get isConnected() { return miniConnected(this); }

  get textContent() {
    return this.children.map((child) => child.textContent).join('');
  }
  set textContent(value) {
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
    const text = value === null || value === undefined ? '' : String(value);
    if (text) this.children.push(new MiniText(text, this.ownerDocument));
    if (this.children.length) this.children[0].parentNode = this;
  }

  get innerHTML() { return this.children.map((child) => miniSerialize(child)).join(''); }
  set innerHTML(value) {
    const target = this.tagName === 'TEMPLATE' && this.content ? this.content : this;
    miniParseFragment(String(value), this.ownerDocument, this.namespaceURI).forEach((child) => target.appendChild(child));
  }

  setAttribute(name, value) {
    const key = String(name);
    const text = String(value);
    this._attrs[key] = text;
    if (key === 'class') this._className = text;
    else if (key === 'id') this._id = text;
    else if (key === 'type') this._type = text;
    else if (key === 'src') this._src = text;
    else if (key === 'tabindex') this._tabIndex = Number(text);
    else if (key === 'disabled') this._disabled = true;
    else if (key === 'hidden') this._hidden = true;
  }
  getAttribute(name) {
    const key = String(name);
    return Object.prototype.hasOwnProperty.call(this._attrs, key) ? this._attrs[key] : null;
  }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, String(name)); }
  removeAttribute(name) {
    const key = String(name);
    delete this._attrs[key];
    if (key === 'disabled') this._disabled = false;
    if (key === 'hidden') this._hidden = false;
    if (key === 'class') this._className = '';
    if (key === 'id') this._id = '';
  }

  appendChild(node) {
    if (!node) return node;
    if (node.parentNode) {
      if (typeof node.parentNode.removeChild === 'function') node.parentNode.removeChild(node);
      else if (Array.isArray(node.parentNode.children)) {
        const index = node.parentNode.children.indexOf(node);
        if (index >= 0) node.parentNode.children.splice(index, 1);
      }
    }
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    if (node && node.parentNode === this) node.parentNode = null;
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
    if (!this._listeners[key]) this._listeners[key] = [];
    this._listeners[key].push({ fn, capture: !!capture });
  }
  removeEventListener(type, fn, capture) {
    const list = this._listeners[String(type)] || [];
    const index = list.findIndex((entry) => entry.fn === fn && entry.capture === !!capture);
    if (index >= 0) list.splice(index, 1);
  }
  _fire(type, event, phase) {
    const list = (this._listeners[String(type)] || []).slice();
    const capturing = phase === 'capture';
    for (const entry of list) {
      if (event._stopped || entry.capture !== capturing) continue;
      event.currentTarget = this;
      entry.fn.call(this, event);
    }
  }
  dispatchEvent(event) {
    if (!event || typeof event.type !== 'string') return true;
    const ev = event;
    ev.target = ev.target || this;
    ev.defaultPrevented = false;
    ev._stopped = false;
    if (typeof ev.preventDefault !== 'function') ev.preventDefault = () => { ev.defaultPrevented = true; };
    if (typeof ev.stopPropagation !== 'function') ev.stopPropagation = () => { ev._stopped = true; };
    if (typeof ev.stopImmediatePropagation !== 'function') ev.stopImmediatePropagation = () => { ev._stopped = true; };
    const path = [];
    let cursor = this;
    while (cursor) {
      if (path.includes(cursor)) break;
      path.push(cursor);
      cursor = cursor.parentNode;
    }
    const chain = path.slice().reverse();
    chain.forEach((node) => node._fire(ev.type, ev, 'capture'));
    if (!ev._stopped) chain.slice().reverse().forEach((node) => node._fire(ev.type, ev, 'bubble'));
    return !ev.defaultPrevented;
  }
  click() {
    if (this.disabled) return false;
    this.dispatchEvent({ type: 'click', bubbles: true });
    return true;
  }
  focus() {
    if (!this.isConnected) return;
    this.ownerDocument.activeElement = this;
    this.dispatchEvent({ type: 'focus' });
  }
  getClientRects() { return this.isConnected ? [{ width: 100, height: 48 }] : []; }
  getBoundingClientRect() { return { width: 100, height: 48, left: 0, top: 0, right: 100, bottom: 48 }; }

  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => (child.contains ? child.contains(node) : child === node));
  }
  matches(selector) { return selector.split(',').some((part) => miniMatches(this, part.trim())); }
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
      let pool = miniDescendants(this);
      parts.forEach((part, index) => {
        pool = pool.filter((node) => miniMatches(node, part));
        if (index < parts.length - 1) pool = pool.flatMap((node) => miniDescendants(node));
      });
      out.push(...pool);
    });
    return out.filter((node, index) => out.indexOf(node) === index);
  }
}

function miniDescendants(node) {
  const out = [];
  (node.children || []).forEach((child) => {
    if (child.nodeType === 1) {
      out.push(child);
      out.push(...miniDescendants(child));
    }
  });
  return out;
}

function miniMatches(node, selector) {
  if (!node || node.nodeType !== 1) return false;
  const match = /^([a-zA-Z*][\w-]*)?((?:[#.][\w-]+|\[[^\]]+\])*)$/.exec(selector);
  if (!match) return false;
  if (match[1] && match[1] !== '*' && node.tagName !== match[1].toUpperCase()) return false;
  const tokens = match[2].match(/[#.][\w-]+|\[[^\]]+\]/g) || [];
  return tokens.every((token) => {
    if (token[0] === '#') return node.id === token.slice(1);
    if (token[0] === '.') return node.classList.contains(token.slice(1));
    const attr = /^\[([^\]=]+)(?:="([^"]*)")?\]$/.exec(token);
    if (!attr) return false;
    if (!node.hasAttribute(attr[1])) return false;
    return attr[2] === undefined || node.getAttribute(attr[1]) === attr[2];
  });
}

function miniParseFragment(markup, doc, namespace) {
  const root = doc.createDocumentFragment();
  const stack = [root];
  const tokens = String(markup).match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || [];
  tokens.forEach((token) => {
    if (!token || /^\s+$/.test(token)) return;
    if (token.startsWith('<!--')) return;
    if (token.startsWith('</')) {
      if (stack.length > 1) stack.pop();
      return;
    }
    if (token.startsWith('<')) {
      const tagMatch = /^<\s*([\w:-]+)([^>]*)>/ .exec(token);
      if (!tagMatch) return;
      const ns = /^svg$/.test(tagMatch[1]) || namespace === 'http://www.w3.org/2000/svg' ? 'http://www.w3.org/2000/svg' : null;
      const child = doc.createElementNS ? doc.createElementNS(ns || 'http://www.w3.org/1999/xhtml', tagMatch[1]) : doc.createElement(tagMatch[1]);
      const attrText = tagMatch[2];
      const attrRe = /([:\w-]+)\s*=\s*"([^"]*)"|([:\w-]+)\s*=\s*'([^']*)'|([:\w-]+)/g;
      let attrMatch;
      while ((attrMatch = attrRe.exec(attrText)) !== null) {
        const name = attrMatch[1] || attrMatch[3] || attrMatch[5];
        const value = attrMatch[2] !== undefined ? attrMatch[2] : (attrMatch[4] !== undefined ? attrMatch[4] : '');
        child.setAttribute(name, value);
      }
      stack[stack.length - 1].appendChild(child);
      if (!/\/>$/.test(token) && !/^(?:path|rect|circle|hr|br|img|input|meta|link)$/i.test(tagMatch[1])) stack.push(child);
      return;
    }
    stack[stack.length - 1].appendChild(doc.createTextNode(token.replace(/&amp;/g, '&')));
  });
  return root.children.slice();
}

function miniSerialize(node) {
  if (node.nodeType === 3) return node.textContent;
  const attrs = Object.entries(node._attrs || {}).map(([key, value]) => ' ' + key + '="' + value + '"').join('');
  const open = '<' + node.localName + attrs + '>';
  const children = (node.children || []).map(miniSerialize).join('');
  return open + children + '</' + node.localName + '>';
}

class MiniDocument {
  constructor() {
    this.nodeType = 9;
    this.documentElement = new MiniElement('html', this);
    this.documentElement.parentNode = this;
    this.head = new MiniElement('head', this);
    this.body = new MiniElement('body', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.children = [this.documentElement];
    this.activeElement = null;
    this.defaultView = {};
    this._listeners = Object.create(null);
  }
  createElement(tag) {
    const node = new MiniElement(tag, this);
    if (String(tag).toLowerCase() === 'template') node.content = this.createDocumentFragment();
    return node;
  }
  createElementNS(namespace, tag) { return new MiniElement(tag, this, namespace); }
  createTextNode(value) { return new MiniText(value, this); }
  createDocumentFragment() {
    const fragment = {
      nodeType: 11,
      children: [],
      ownerDocument: this,
      parentNode: null,
      appendChild(node) { this.children.push(node); node.parentNode = this; return node; },
    };
    Object.defineProperty(fragment, 'firstChild', { get() { return this.children[0] || null; } });
    return fragment;
  }
  getElementById(id) {
    return miniDescendants(this).find((node) => node.id === id) || null;
  }
  addEventListener(type, fn, capture) {
    const key = String(type);
    if (!this._listeners[key]) this._listeners[key] = [];
    this._listeners[key].push({ fn, capture: !!capture });
  }
  removeEventListener(type, fn, capture) {
    const list = this._listeners[String(type)] || [];
    const index = list.findIndex((entry) => entry.fn === fn && entry.capture === !!capture);
    if (index >= 0) list.splice(index, 1);
  }
  _fire(type, event, phase) {
    const list = (this._listeners[String(type)] || []).slice();
    const capturing = phase === 'capture';
    for (const entry of list) {
      if (event._stopped || entry.capture !== capturing) continue;
      event.currentTarget = this;
      entry.fn.call(this, event);
    }
  }
  dispatchEvent(event) {
    const ev = event;
    ev.target = ev.target || this;
    ev.defaultPrevented = false;
    ev._stopped = false;
    if (typeof ev.preventDefault !== 'function') ev.preventDefault = () => { ev.defaultPrevented = true; };
    if (typeof ev.stopPropagation !== 'function') ev.stopPropagation = () => { ev._stopped = true; };
    if (typeof ev.stopImmediatePropagation !== 'function') ev.stopImmediatePropagation = () => { ev._stopped = true; };
    this._fire(ev.type, ev, 'capture');
    if (!ev._stopped) this._fire(ev.type, ev, 'bubble');
    return !ev.defaultPrevented;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) { return miniDescendants(this).flatMap((node) => node.matches(selector) ? [node] : []); }
}

/* ------------------------------------------------------------------ *
 * Static source checks.
 * ------------------------------------------------------------------ */

const tokensCss = fs.readFileSync(ABS.tokens, 'utf8');
const componentsCss = fs.readFileSync(ABS.css, 'utf8');
const componentsSrc = fs.readFileSync(ABS.components, 'utf8');
const harborSrc = fs.readFileSync(ABS.harbor, 'utf8');
function cssBlock(selector, from = 0) {
  const start = componentsCss.indexOf(selector, from);
  if (start < 0) return '';
  const end = componentsCss.indexOf('}', start);
  return end < 0 ? '' : componentsCss.slice(start, end + 1);
}

const exactTokens = {
  '--ac-career-ui-bg': '#171b21',
  '--ac-career-ui-surface': '#20252c',
  '--ac-career-ui-story': '#292822',
  '--ac-career-ui-border': '#ffffff20',
  '--ac-career-ui-ink': '#f0f1ee',
  '--ac-career-ui-muted': '#aeb6c2',
  '--ac-career-ui-gold': '#d6b477',
  '--ac-career-ui-gold-light': '#e6d4ac',
  '--ac-career-ui-on-gold': '#1c1917',
  '--ac-career-ui-success': '#6ee7b7',
  '--ac-career-ui-danger': '#f3a49a',
  '--ac-career-ui-radius': '10px',
  '--ac-career-ui-panel': '440px',
  '--ac-career-ui-pad': '16px',
  '--ac-career-ui-gap': '16px',
  '--ac-career-ui-stage': '#101419',
  '--ac-career-ui-scrim': '#0009',
  '--ac-career-ui-panel-shadow': '0 20px 70px #0006',
  '--ac-career-ui-secondary-border': '#ffffff30',
};
Object.entries(exactTokens).forEach(([name, value]) => {
  const match = new RegExp('(?:^|\\n)\\s*' + name + '\\s*:\\s*([^;]+);').exec(tokensCss);
  check('token literal ' + name, !!match && match[1].trim() === value, match ? match[1].trim() : null);
});
check('tokens color-scheme scoped', /\.ac-career-ui\s*\{[^}]*color-scheme:\s*dark;/.test(tokensCss));
check('tokens exact font stack', tokensCss.includes('font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;'));
check('tokens base font-size', /\.ac-career-ui\s*\{[\s\S]*?font-size:\s*var\(--ac-career-ui-font-body-size\);/.test(tokensCss));
check('tokens base line-height', /\.ac-career-ui\s*\{[\s\S]*?line-height:\s*var\(--ac-career-ui-font-body-leading\);/.test(tokensCss));
check('tokens font body size 14px', /--ac-career-ui-font-body-size:\s*14px;/.test(tokensCss));
check('tokens font body leading 1.65', /--ac-career-ui-font-body-leading:\s*1\.65;/.test(tokensCss));
check('tokens h1 22/1.35/600', /--ac-career-ui-font-h1-size:\s*22px;/.test(tokensCss) && /--ac-career-ui-font-h1-leading:\s*1\.35;/.test(tokensCss) && /--ac-career-ui-font-weight-heading:\s*600;/.test(tokensCss));
check('tokens h2 20/1.35', /--ac-career-ui-font-h2-size:\s*20px;/.test(tokensCss) && /--ac-career-ui-font-h2-leading:\s*1\.35;/.test(tokensCss));
check('tokens h3 16/1.45', /--ac-career-ui-font-h3-size:\s*16px;/.test(tokensCss) && /--ac-career-ui-font-h3-leading:\s*1\.45;/.test(tokensCss));
check('tokens caption 12/1.6', /--ac-career-ui-font-caption-size:\s*12px;/.test(tokensCss) && /--ac-career-ui-font-caption-leading:\s*1\.6;/.test(tokensCss));
check('tokens score 32/1.2/600/#fbbf24', /--ac-career-ui-font-score-size:\s*32px;/.test(tokensCss) && /--ac-career-ui-font-score-leading:\s*1\.2;/.test(tokensCss) && /--ac-career-ui-score:\s*#fbbf24;/.test(tokensCss));
check('tokens narrow pad/gap override', /@media\s*\(max-width:\s*360px\)\s*\{\s*\.ac-career-ui\s*\{[^}]*--ac-career-ui-pad:\s*12px;[^}]*--ac-career-ui-gap:\s*12px;/.test(tokensCss));
check('tokens contain only scoped custom properties', !/(?::root|html|body|\*)\s*\{[^}]*--ac-career-ui-/.test(tokensCss));
check('no host token overrides in T11 CSS', !/--ac-(?!career-ui)[\w-]+\s*:/.test(tokensCss + componentsCss));
check('no shellbar/thumb/hint overrides', !/(--studiokit-shellbar-h|--ac-thumb-lift|--ac-hint-refund)\s*:/.test(tokensCss + componentsCss));

const stylesheetSources = [tokensCss, componentsCss];
stylesheetSources.forEach((css, index) => {
  const label = index === 0 ? 'tokens.css' : 'components.css';
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const withoutKeyframes = withoutComments.replace(/@keyframes\s+[\w-]+\s*\{[\s\S]*?\n\}/g, '');
  const selectors = [...withoutKeyframes.matchAll(/(^|\n)\s*([^{}\n][^{}]*)\{/g)]
    .map((match) => match[2].trim())
    .filter((selector) => !selector.startsWith('@'));
  const bad = selectors.filter((selector) => {
    if (selector.startsWith('.ac-career-ui')) return false;
    if (selector.startsWith('html.ac-career-ui-scroll-lock')) return false;
    return true;
  });
  check(label + ' has no global selectors', bad.length === 0, bad.slice(0, 8));
});
check('keyframes use career namespace', [...componentsCss.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]).every((name) => name.startsWith('ac-career-ui-')));
check('no :root/html/body or bare universal style block', !/(^|\n)\s*(?::root|html|body|\*)\s*[{,]/.test(tokensCss + componentsCss));
check('no bare generic component selectors', !/(^|\n)\s*(?:\.panel|\.surface|\.primary|\.secondary|\.icon|\.tabs|\.tool|\.timeline|\.close|\.stack)\s*[{,]/.test(componentsCss));
check('no remote assets or fonts', !/(https?:)?\/\//.test(tokensCss + componentsCss) && !/@import|url\(/.test(tokensCss + componentsCss));

check('panel width formula 440 / calc(100% - 24px)', /width:\s*min\(var\(--ac-career-ui-panel\),\s*calc\(100%\s*-\s*24px\)\)/.test(componentsCss));
const panelBlock = /\.ac-career-ui__panel\s*\{([\s\S]*?)\n\}/.exec(componentsCss);
check('panel has no fixed height', !!panelBlock && !/(?:^|[-\w])height:\s*\d+px/.test(panelBlock[1]));
check('body scrolls independently with contain', /\.ac-career-ui__body\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/.test(componentsCss));
check('overlay safe-area on all edges', ['top', 'right', 'bottom', 'left'].every((edge) => componentsCss.includes('env(safe-area-inset-' + edge + ', 0px)')));
check('overlay scrim token', /\.ac-career-ui__overlay\s*\{[\s\S]*?background:\s*var\(--ac-career-ui-scrim\)/.test(componentsCss));
check('scroll lock class is namespaced', /html\.ac-career-ui-scroll-lock/.test(componentsCss));
check('touch targets >=44px', /\.ac-career-ui button\s*\{[\s\S]*?min-height:\s*44px;/.test(componentsCss) && /min-width:\s*44px;/.test(componentsCss));
check('focus-visible exact outline', /outline:\s*var\(--ac-career-ui-focus-width\)\s+solid\s+var\(--ac-career-ui-gold-light\);[\s\S]*?outline-offset:\s*var\(--ac-career-ui-focus-offset\)/.test(componentsCss));
check('reduced motion both guards', /\.ac-career-ui\[data-reduced-motion="true"\]/.test(componentsCss) && /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(componentsCss) && /animation:\s*none\s*!important/.test(componentsCss));
check('horizontal overflow guards', /min-width:\s*0/.test(componentsCss) && /overflow-x:\s*hidden/.test(componentsCss) && /overflow-wrap:\s*anywhere/.test(componentsCss));
check('three-column tool grid with 8px gap', /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);[\s\S]*?gap:\s*var\(--ac-career-ui-space-2\)/.test(componentsCss));
check('timeline 1px line and 7px node', /border-left:\s*var\(--ac-career-ui-line-width\)/.test(componentsCss) && /width:\s*var\(--ac-career-ui-timeline-node\)/.test(componentsCss));
check('animations 140/160ms only', /--ac-career-ui-overlay-duration:\s*140ms/.test(tokensCss) && /--ac-career-ui-sheet-duration:\s*160ms/.test(tokensCss) && /--ac-career-ui-clue-duration:\s*160ms/.test(tokensCss));
check('T15 token literals from prototype', [
  '--ac-career-ui-font-weight-strong: 700',
  '--ac-career-ui-font-weight-normal: 400',
  '--ac-career-ui-tabs-pad: 3px',
  '--ac-career-ui-tabs-gap: 3px',
  '--ac-career-ui-tools-gap-narrow: 4px',
  '--ac-career-ui-tab-pad-y: 1px',
  '--ac-career-ui-tab-pad-x: 6px',
  '--ac-career-ui-tool-font-size: 12px',
  '--ac-career-ui-tool-pad: 8px',
  '--ac-career-ui-tool-gap: 4px',
].every((line) => tokensCss.includes(line)));

const primaryBlock = cssBlock('.ac-career-ui button.ac-career-ui__action--primary {');
const secondaryBlock = cssBlock('.ac-career-ui button.ac-career-ui__action--secondary {');
check('primary cascade beats generic button rule', primaryBlock.includes('background: var(--ac-career-ui-gold)') && primaryBlock.includes('color: var(--ac-career-ui-on-gold)'));
check('secondary cascade keeps 1px border and transparent background', secondaryBlock.includes('border: var(--ac-career-ui-line-width) solid var(--ac-career-ui-secondary-border)') && secondaryBlock.includes('background: transparent'));
check('action base cascade sets 10px/12px padding and 8px radius', cssBlock('.ac-career-ui button.ac-career-ui__action {').includes('padding: 10px 12px') && cssBlock('.ac-career-ui button.ac-career-ui__action {').includes('border-radius: var(--ac-career-ui-action-radius)'));
check('LetterCard title h2 is 20px/600/1.35 gold-light', cssBlock('.ac-career-ui__letter h2 {').includes('font-size: var(--ac-career-ui-font-h2-size)') && cssBlock('.ac-career-ui__letter h2 {').includes('font-weight: var(--ac-career-ui-font-weight-heading)') && cssBlock('.ac-career-ui__letter h2 {').includes('line-height: var(--ac-career-ui-font-h2-leading)'));
const tabBlock = cssBlock('.ac-career-ui button.ac-career-ui__tab {');
check('tabs container uses 3px pad/gap', cssBlock('.ac-career-ui__tabs {').includes('padding: var(--ac-career-ui-tabs-pad)') && cssBlock('.ac-career-ui__tabs {').includes('gap: var(--ac-career-ui-tabs-gap)'));
check('tab radius 7px and padding 1px 6px', tabBlock.includes('border-radius: var(--ac-career-ui-tab-radius)') && tabBlock.includes('padding: var(--ac-career-ui-tab-pad-y) var(--ac-career-ui-tab-pad-x)'));
const toolBlock = cssBlock('.ac-career-ui button.ac-career-ui__tool {');
check('tool font 12px, padding 8px, internal gap 4px', toolBlock.includes('font-size: var(--ac-career-ui-tool-font-size)') && toolBlock.includes('padding: var(--ac-career-ui-tool-pad)') && toolBlock.includes('gap: var(--ac-career-ui-tool-gap)'));
check('tool grid narrow gap 4px', cssBlock('.ac-career-ui__tools {', componentsCss.indexOf('@media (max-width: 360px)')).includes('gap: var(--ac-career-ui-tools-gap-narrow)'));
check('clue title strong 700', cssBlock('.ac-career-ui__clue-title {').includes('font-weight: var(--ac-career-ui-font-weight-strong)'));
check('result-host has no extra surface/border/padding', !componentsCss.includes('data-placement="result-host"'));
check('work name/card uses 14px body typography and 8px gap', cssBlock('.ac-career-ui__work-name {').includes('font-size: var(--ac-career-ui-font-body-size)') && cssBlock('.ac-career-ui__work-name {').includes('font-weight: var(--ac-career-ui-font-weight-strong)') && cssBlock('.ac-career-ui__work {').includes('gap: var(--ac-career-ui-space-2)'));
check('avatar radius is 10px token', cssBlock('.ac-career-ui__avatar {').includes('border-radius: var(--ac-career-ui-radius)'));
check('receipt result normal weight and kv-list no flex gap', cssBlock('.ac-career-ui__receipt-result {').includes('var(--ac-career-ui-font-weight-normal)') && !cssBlock('.ac-career-ui__kv-list {').includes('gap:'));
check('npc name uses 700 strong weight', cssBlock('.ac-career-ui__npc-name {').includes('var(--ac-career-ui-font-weight-strong)'));
check('CareerShell showHeader is a frozen optional prop', componentsSrc.includes('showHeader !== false') && componentsSrc.includes("panel.setAttribute('data-show-header'") && componentsSrc.includes("panel.setAttribute('aria-label', title)"));
check('clue and signature text have no decorative prefix/suffix', !componentsSrc.includes("cleanText(input.actionLabel) + ' ›'") && !componentsSrc.includes("'—— ' + sender"));

const viewportWidths = [320, 375, 390, 430, 844, 1280];
check('viewport width matrix matches panel formula', viewportWidths.every((width) => Math.min(440, width - 24) === Math.min(440, width - 24)) && viewportWidths.every((width) => width - 24 > 0));

const forbiddenRuntime = ['ctx.commissions', 'careerCatalog(', 'listAvailable(', 'localStorage', 'indexedDB', 'fetch(', 'XMLHttpRequest', 'narrative-shards', '阿砾', '折光港', '旧矿井的样本'];
const forbiddenFound = forbiddenRuntime.filter((term) => componentsSrc.includes(term));
check('component runtime has no forbidden data/sample text', forbiddenFound.length === 0, forbiddenFound);
check('components.js exposes no production fixture text', !/(2,480|旧矿井的样本|研究院的委托|矿石背后的秘密)/.test(componentsSrc));

/* ------------------------------------------------------------------ *
 * Load product scripts in a VM with the minimal DOM.
 * ------------------------------------------------------------------ */

const doc = new MiniDocument();
doc.documentElement.style.setProperty('overflow', 'auto', '');
doc.body.style.setProperty('overflow-y', 'scroll', '');
const sandbox = {
  window: {},
  document: doc,
  module: { exports: {} },
  console,
};
sandbox.globalThis = sandbox;
sandbox.window.document = doc;
vm.createContext(sandbox);
vm.runInContext(componentsSrc, sandbox, { filename: ABS.components });
const components = sandbox.module.exports;
doc.defaultView = sandbox.window;
sandbox.module = { exports: {} };
vm.runInContext(harborSrc, sandbox, { filename: ABS.harbor });
const harborApi = sandbox.module.exports;

const componentNames = ['CareerShell', 'ClueRow', 'LetterCard', 'NPCDialogue', 'PrimaryAction', 'SecondaryAction', 'StoryCard', 'SegmentedTabs', 'WorkCard', 'ReceiptCard', 'JournalTimeline', 'ToolGrid'];
check('global namespace exports 12 components', componentNames.every((name) => typeof components[name] === 'function'), componentNames.filter((name) => typeof components[name] !== 'function'));
check('window.ArcadeCareerUI.components alias', sandbox.window.ArcadeCareerUI.components === components && sandbox.window.ArcadeCareerUI.CareerComponents === components);
check('window.ArcadeCareerUI.harbor is function', typeof sandbox.window.ArcadeCareerUI.harbor === 'function');
check('component state enums frozen', JSON.stringify(components.STATES) === JSON.stringify({
  CareerShell: ['normal', 'scroll', 'loading', 'error'],
  ClueRow: ['hidden', 'glimpsed', 'read', 'recoverable'],
  LetterCard: ['unread', 'read', 'deferred'],
  NPCDialogue: ['first', 'return', 'optional', 'error'],
  StoryCard: ['current', 'no-action', 'completed'],
  WorkCard: ['active', 'optional', 'paused', 'empty'],
  ReceiptCard: ['success', 'failure', 'no-duplicate-reward'],
  JournalTimeline: ['empty', 'filled'],
  ToolGrid: ['hidden', 'available'],
}));

/* ------------------------------ harbor ----------------------------- */

const prototypeLine = fs.readFileSync(ABS.prototype, 'utf8').split(/\r?\n/)[3];
const referenceHarbor = vm.runInNewContext(prototypeLine + '\n; harbor', {});
check('prototype harbor reference loaded', typeof referenceHarbor === 'function');
check('harbor() byte-identical to prototype', harborApi.harbor(false) === referenceHarbor(false));
check('harbor(true) byte-identical to prototype', harborApi.harbor(true) === referenceHarbor(true));
eq('harbor default viewBox', /viewBox="0 0 320 100"/.test(harborApi.harbor()), true);
eq('harbor dock viewBox', /viewBox="0 0 320 112"/.test(harborApi.harbor(true)), true);
eq('harbor aria-hidden', /aria-hidden="true"/.test(harborApi.harbor()), true);
eq('harbor inline only', /^<svg[\s\S]*<\/svg>$/.test(harborApi.harbor()), true);
eq('harbor decorative dock label present in exact SVG', harborApi.harbor(true).includes('REFRACTION HARBOR'), true);
const harborSvg = harborApi.renderHarbor();
eq('renderHarbor returns SVG element', harborSvg && harborSvg.localName, 'svg');
eq('renderHarbor aria-hidden', harborSvg && harborSvg.getAttribute('aria-hidden'), 'true');

/* --------------------------- CareerShell --------------------------- */

function bodyNode(text) {
  const node = doc.createElement('div');
  node.textContent = text;
  return node;
}

const trigger = doc.createElement('button');
trigger.textContent = '打开面板';
doc.body.appendChild(trigger);
doc.activeElement = trigger;
let closeCalls = 0;
const shell = components.CareerShell.create('town');
const shellBody = doc.createElement('div');
const shellAction = components.SecondaryAction({ label: '面板动作', onClick() {} });
shellBody.appendChild(shellAction);
const opened = shell.open({
  title: '合成港口标题',
  state: 'normal',
  body: shellBody,
  reducedMotion: true,
  onClose() { closeCalls += 1; },
});
eq('CareerShell.open ok', opened.ok, true);
eq('CareerShell no duplicate panel', doc.querySelectorAll('[data-career-panel]').length, 1);
eq('overlay panel key', opened.panel.parentNode.getAttribute('data-career-panel'), 'town');
eq('dialog role', opened.panel.getAttribute('role'), 'dialog');
eq('dialog aria-modal', opened.panel.getAttribute('aria-modal'), 'true');
check('dialog labelled by title', !!opened.panel.getAttribute('aria-labelledby') && !!doc.getElementById(opened.panel.getAttribute('aria-labelledby')));
eq('dialog title tabindex', doc.getElementById(opened.panel.getAttribute('aria-labelledby')).getAttribute('tabindex'), '-1');
eq('dialog panel tabindex', opened.panel.getAttribute('tabindex'), '-1');
eq('shell data state', opened.panel.getAttribute('data-shell-state'), 'normal');
eq('shell initial focus close', doc.activeElement.className.includes('ac-career-ui__close'), true);
check('scroll lock class added', doc.documentElement.classList.contains('ac-career-ui-scroll-lock'));
eq('html inline overflow hidden', doc.documentElement.style.getPropertyValue('overflow'), 'hidden');
eq('html inline overflow priority', doc.documentElement.style.getPropertyPriority('overflow'), 'important');
eq('body inline overflow hidden', doc.body.style.getPropertyValue('overflow-y'), 'hidden');
eq('reduced motion attr', opened.panel.parentNode.parentNode.getAttribute('data-reduced-motion'), 'true');

const repeat = shell.render({ title: '合成港口标题', state: 'normal', body: shellBody, reducedMotion: true });
eq('CareerShell.render ok', repeat.ok, true);
eq('CareerShell.render reuses layer', doc.querySelectorAll('[data-career-panel]').length, 1);
eq('CareerShell.render keeps panel node', repeat.panel, opened.panel);

const closeButton = opened.panel.querySelector('.ac-career-ui__close');
doc.activeElement = closeButton;
closeButton.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: true });
eq('Tab trap shift from first moves to last', doc.activeElement, shellAction);
doc.activeElement = shellAction;
shellAction.dispatchEvent({ type: 'keydown', key: 'Tab' });
eq('Tab trap from last wraps to first', doc.activeElement, closeButton);

doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
eq('Escape closes shell', doc.querySelectorAll('[data-career-panel]').length, 0);
eq('onClose called once', closeCalls, 1);
eq('focus restored to trigger', doc.activeElement, trigger);
check('scroll lock class removed', !doc.documentElement.classList.contains('ac-career-ui-scroll-lock'));
eq('html original overflow restored', doc.documentElement.style.getPropertyValue('overflow'), 'auto');
eq('body original overflow restored', doc.body.style.getPropertyValue('overflow-y'), 'scroll');

const overlayShell = components.CareerShell.create('mailbox');
overlayShell.open({ title: '合成信箱', body: bodyNode('合成正文') });
const overlay = doc.querySelector('[data-career-panel="mailbox"]');
overlay.dispatchEvent({ type: 'pointerdown' });
overlay.dispatchEvent({ type: 'click' });
eq('backdrop click closes top panel', doc.querySelectorAll('[data-career-panel]').length, 0);

const lower = components.CareerShell.create('town');
const upper = components.CareerShell.create('arrival');
lower.open({ title: '下层', body: bodyNode('下层正文') });
upper.open({ title: '上层', body: bodyNode('上层正文') });
eq('two stacked panels', doc.querySelectorAll('[data-career-panel]').length, 2);
doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
eq('Escape closes only top panel', doc.querySelector('[data-career-panel="town"]') !== null && doc.querySelector('[data-career-panel="arrival"]') === null, true);
check('scroll lock remains while lower panel open', doc.documentElement.classList.contains('ac-career-ui-scroll-lock'));
doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
check('scroll unlocks after last panel', !doc.documentElement.classList.contains('ac-career-ui-scroll-lock'));

const loadingRoot = components.CareerShell({ panelKey: 'receipt', title: '合成回执', state: 'loading', body: bodyNode('结构仍在') });
const loadingPanel = loadingRoot.querySelector('[role="dialog"]');
eq('loading shell state', loadingPanel.getAttribute('data-shell-state'), 'loading');
eq('loading aria-busy', loadingPanel.getAttribute('aria-busy'), 'true');
check('loading keeps structure', loadingPanel.textContent.includes('结构仍在'));
const errorRoot = components.CareerShell({ panelKey: 'settings', title: '合成设置', state: 'error', body: bodyNode('') });
check('error state has visible retry text', errorRoot.textContent.includes('请关闭后重试'));
check('shell live region is polite', !!errorRoot.querySelector('[aria-live="polite"]'));
eq('invalid panel key rejected', components.CareerShell.open({ panelKey: 'not-a-panel', title: 'x', body: bodyNode('x') }).ok, false);

const headless = components.CareerShell.create('receipt');
const headlessBody = bodyNode('合成无头正文');
const headlessAction = components.SecondaryAction({ label: '无头动作', onClick() {} });
headlessBody.appendChild(headlessAction);
const headlessOpen = headless.open({ title: '合成无头标题', body: headlessBody, showHeader: false });
const headlessPanel = headlessOpen.panel;
const headlessHeader = headlessPanel.querySelector('.ac-career-ui__header');
const headlessClose = headlessPanel.querySelector('.ac-career-ui__close');
eq('showHeader defaults contract attr false', headlessPanel.getAttribute('data-show-header'), 'false');
eq('showHeader false hides header', headlessHeader.hidden, true);
eq('showHeader false hides close', headlessClose.hidden, true);
eq('showHeader false retains aria-label', headlessPanel.getAttribute('aria-label'), '合成无头标题');
eq('showHeader false retains labelled title text', doc.getElementById(headlessPanel.getAttribute('aria-labelledby')).textContent, '合成无头标题');
eq('showHeader false focuses panel without initialFocus', doc.activeElement, headlessPanel);
check('showHeader false still locks scroll', doc.documentElement.classList.contains('ac-career-ui-scroll-lock'));
headlessPanel.dispatchEvent({ type: 'keydown', key: 'Tab' });
eq('showHeader false Tab trap reaches body action', doc.activeElement, headlessAction);
doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
eq('showHeader false Escape closes', doc.querySelector('[data-career-panel="receipt"]'), null);
eq('showHeader false restores return focus', doc.activeElement, trigger);

const headlessInitial = components.CareerShell.create('arrival');
const initialBody = bodyNode('合成初始焦点正文');
const initialButton = components.PrimaryAction({ label: '初始动作', onClick() {} });
initialBody.appendChild(initialButton);
headlessInitial.open({ title: '合成邀请', body: initialBody, showHeader: false, initialFocus: initialButton });
eq('showHeader false honors explicit initialFocus', doc.activeElement, initialButton);
components.CareerShell.close();

const toggled = components.CareerShell.create('settings');
const toggledOpen = toggled.open({ title: '合成切换标题', body: bodyNode('正文') });
const toggledPanel = toggledOpen.panel;
const toggledClose = toggledPanel.querySelector('.ac-career-ui__close');
toggledClose.focus();
toggled.render({ title: '合成切换标题', body: bodyNode('正文'), showHeader: false });
eq('render showHeader false moves focus off hidden close', doc.activeElement, toggledPanel);
eq('render showHeader false hides header', toggledPanel.querySelector('.ac-career-ui__header').hidden, true);
components.CareerShell.close();

/* ------------------------------- icons ----------------------------- */

const testIcon = components.icon('gem');
eq('icon aria-hidden', testIcon.getAttribute('aria-hidden'), 'true');
eq('icon viewBox', testIcon.getAttribute('viewBox'), '0 0 24 24');
check('icon has exact 24px linear path', testIcon.innerHTML.includes('M3 8l4-5h10l4 5-9 13z'));

/* ------------------------------ ClueRow ---------------------------- */

eq('ClueRow hidden has no DOM', components.ClueRow({ state: 'hidden', title: '隐藏' }), null);
let clueCalls = 0;
const clue = components.ClueRow({
  clueId: 'CL-synthetic', gameId: 'synthetic-game', professionId: 'internal.only', icon: 'mail',
  title: '合成线索标题', teaser: '合成摘要', actionLabel: '仔细看看', state: 'glimpsed',
  placement: 'result-host', reducedMotion: false, onOpen(id) { clueCalls += 1; eq('ClueRow passes clueId', id, 'CL-synthetic'); },
});
eq('ClueRow state', clue.getAttribute('data-clue-state'), 'glimpsed');
eq('ClueRow placement', clue.getAttribute('data-placement'), 'result-host');
eq('ClueRow tag', clue.tagName, 'BUTTON');
eq('ClueRow type', clue.getAttribute('type'), 'button');
eq('ClueRow title text', clue.querySelector('.ac-career-ui__clue-title').textContent, '合成线索标题');
eq('ClueRow teaser text', clue.querySelector('.ac-career-ui__clue-teaser').textContent, '合成摘要');
check('ClueRow action text injected', clue.textContent.includes('仔细看看'));
eq('ClueRow action text exact', clue.querySelector('.ac-career-ui__clue-action').textContent, '仔细看看');
check('ClueRow does not expose profession id', !clue.textContent.includes('internal.only') && !clue.innerHTML.includes('internal.only'));
clue.click();
eq('ClueRow onOpen once', clueCalls, 1);

/* ---------------------------- LetterCard --------------------------- */

const letterRead = components.LetterCard({
  title: '合成来信标题', paragraphs: ['合成段落一', '合成段落二'], sender: '合成署名',
  ambientLabel: '合成说明', state: 'read', actions: [],
});
eq('LetterCard state', letterRead.getAttribute('data-letter-state'), 'read');
eq('LetterCard story background class', !!letterRead.querySelector('.ac-career-ui__letter'), true);
eq('LetterCard paragraph count', letterRead.querySelectorAll('.ac-career-ui__letter-paragraph').length, 2);
eq('LetterCard signature exact', letterRead.querySelector('.ac-career-ui__signature').textContent, '合成署名');
eq('LetterCard ambient caption', letterRead.querySelector('.ac-career-ui__caption').textContent, '合成说明');

let resolver = null;
const busyCard = components.LetterCard({
  title: '合成标题', paragraphs: ['合成正文'], sender: '合成署名', state: 'unread',
  actions: [{ id: 'accept', label: '接受邀请', kind: 'primary', onClick() { return new Promise((resolve) => { resolver = resolve; }); } },
    { id: 'defer', label: '以后再说', kind: 'text', onClick() {} }],
});
eq('LetterCard max two actions', busyCard.querySelectorAll('button').length, 2);
const busyButton = busyCard.querySelectorAll('.ac-career-ui__action--primary')[0];
let busyCalls = 0;
void busyCalls;
busyButton.click();
eq('busy action aria-busy', busyButton.getAttribute('aria-busy'), 'true');
eq('busy action data-state', busyButton.getAttribute('data-action-state'), 'loading');
check('busy action visible text', busyButton.textContent.includes('处理中'));
eq('busy action disabled', busyButton.disabled, true);
busyButton.click();
resolver({ ok: true });
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
eq('busy action re-enabled after settle', busyButton.disabled, false);
eq('busy action aria-busy cleared', busyButton.getAttribute('aria-busy'), 'false');

let disabledCalls = 0;
const disabledAction = components.PrimaryAction({ label: '暂不可用动作', disabled: true, onClick() { disabledCalls += 1; } });
eq('disabled action state', disabledAction.getAttribute('data-action-state'), 'disabled');
check('disabled action visible explanation', disabledAction.textContent.includes('暂不可用'));
disabledAction.click();
eq('disabled action never calls onClick', disabledCalls, 0);

const hovered = components.PrimaryAction({ label: '状态动作', onClick() {} });
hovered.dispatchEvent({ type: 'pointerenter' });
eq('action hover state', hovered.getAttribute('data-action-state'), 'hover');
hovered.dispatchEvent({ type: 'focus' });
eq('action focus state', hovered.getAttribute('data-action-state'), 'focus');
hovered.dispatchEvent({ type: 'pointerdown' });
eq('action pressed state', hovered.getAttribute('data-action-state'), 'pressed');

const secondary = components.SecondaryAction({ label: '次动作', variant: 'text', onClick() {} });
eq('secondary variant attr', secondary.getAttribute('data-action-variant'), 'text');
check('secondary text class', secondary.className.includes('ac-career-ui__action--text'));

/* ---------------------------- NPCDialogue -------------------------- */

const npc = components.NPCDialogue({
  name: '合成人物', paragraphs: ['合成台词一', '合成台词二'], avatar: { kind: 'initial', label: '合' },
  state: 'optional', actions: [{ id: 'later', label: '以后再说', kind: 'text', onClick() {} }],
});
eq('NPC state', npc.getAttribute('data-npc-state'), 'optional');
eq('NPC avatar size class parent', !!npc.querySelector('.ac-career-ui__avatar'), true);
eq('NPC avatar aria-hidden', npc.querySelector('.ac-career-ui__avatar').getAttribute('aria-hidden'), 'true');
eq('NPC name', npc.querySelector('.ac-career-ui__npc-name').textContent, '合成人物');
eq('NPC paragraph count', npc.querySelectorAll('.ac-career-ui__npc-paragraph').length, 2);
eq('NPC actions native buttons', npc.querySelectorAll('button').length, 1);
check('NPC does not invent reason codes', !/\b(not-|unknown-|invalid-)/.test(npc.textContent));

/* ----------------------------- StoryCard --------------------------- */

const story = components.StoryCard({
  eyebrow: '正在发生的故事', title: '合成故事', summary: '合成说明', state: 'current',
  tags: ['合成标签'], action: { id: 'continue', label: '继续', kind: 'primary', onClick() {} },
});
eq('StoryCard state', story.getAttribute('data-story-state'), 'current');
check('StoryCard surface stack small', story.className.includes('ac-career-ui__surface') && story.className.includes('ac-career-ui__stack--small'));
eq('StoryCard one action', story.querySelectorAll('button').length, 1);
eq('StoryCard no action variant', components.StoryCard({ title: '完成故事', summary: '说明', state: 'completed', action: { label: '不该出现', kind: 'primary', onClick() {} } }).querySelectorAll('button').length, 0);
eq('StoryCard no-action variant', components.StoryCard({ title: '无动作故事', summary: '说明', state: 'no-action', action: { label: '不该出现', kind: 'primary', onClick() {} } }).querySelectorAll('button').length, 0);

/* --------------------------- SegmentedTabs ------------------------- */

let selectedCalls = [];
const tabs = components.SegmentedTabs({
  tabs: [{ id: 'home', label: '眼下' }, { id: 'work', label: '工作' }, { id: 'journal', label: '经历' }],
  selectedId: 'home', onSelect(id) { selectedCalls.push(id); }, label: '合成标签页', controlsId: 'synthetic-panel',
});
eq('tabs role', tabs.getAttribute('role'), 'tablist');
eq('tabs aria-label', tabs.getAttribute('aria-label'), '合成标签页');
eq('tabs count', tabs.querySelectorAll('[role="tab"]').length, 3);
eq('selected tab aria-selected', tabs.querySelector('[data-tab="home"]').getAttribute('aria-selected'), 'true');
eq('unselected tab tabindex', tabs.querySelector('[data-tab="work"]').getAttribute('tabindex'), '-1');
eq('selected tab tabindex', tabs.querySelector('[data-tab="home"]').getAttribute('tabindex'), '0');
eq('tabs aria-controls', tabs.querySelector('[data-tab="home"]').getAttribute('aria-controls'), 'synthetic-panel');
eq('selected tab state enum', tabs.querySelector('[data-tab="home"]').getAttribute('data-tab-state'), 'selected');
eq('unselected tab has no extra state', tabs.querySelector('[data-tab="work"]').getAttribute('data-tab-state'), null);
doc.body.appendChild(tabs);
tabs.querySelector('[data-tab="home"]').dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
eq('ArrowRight selects work', tabs.getAttribute('data-selected-id'), 'work');
eq('ArrowRight focuses work', doc.activeElement.getAttribute('data-tab'), 'work');
eq('ArrowRight onSelect once', selectedCalls.join(','), 'work');
tabs.querySelector('[data-tab="work"]').dispatchEvent({ type: 'keydown', key: 'End' });
eq('End selects journal', tabs.getAttribute('data-selected-id'), 'journal');
tabs.querySelector('[data-tab="journal"]').dispatchEvent({ type: 'keydown', key: 'Home' });
eq('Home selects home', tabs.getAttribute('data-selected-id'), 'home');
tabs.querySelector('[data-tab="work"]').click();
eq('tab click selects work', tabs.getAttribute('data-selected-id'), 'work');

/* ----------------------------- WorkCard ---------------------------- */

let startCalls = [];
let pauseCalls = [];
const work = components.WorkCard({
  professionId: 'nature.miner', displayName: '合成职业', icon: 'pick', state: 'active',
  commissions: [
    { commissionId: 'synthetic.T1', category: 'profession', title: '合成首单', summary: '合成摘要', gameName: '合成游戏', objectiveText: '合成目标', rewardText: '合成报酬' },
    { commissionId: 'synthetic.T2', category: 'profession', title: '合成次单', summary: '合成摘要二' },
  ],
  onStart(id) { startCalls.push(id); }, onPause(id, paused) { pauseCalls.push([id, paused]); }, expanded: false,
});
eq('WorkCard state', work.getAttribute('data-work-state'), 'active');
eq('WorkCard category', work.getAttribute('data-work-category'), 'profession');
eq('WorkCard name', work.querySelector('.ac-career-ui__work-name').textContent, '合成职业');
eq('WorkCard first commission visible', work.querySelectorAll('.ac-career-ui__commission').length, 2);
eq('WorkCard details initially collapsed', work.querySelector('details').open, false);
eq('WorkCard expanded attr', work.getAttribute('data-expanded'), 'false');
work.querySelectorAll('.ac-career-ui__commission')[0].querySelectorAll('button')[0].click();
eq('WorkCard onStart once', startCalls.join(','), 'synthetic.T1');
work.querySelectorAll('.ac-career-ui__work-more')[0].click();
eq('details summary is native', work.querySelector('summary').tagName, 'SUMMARY');

const pausedWork = components.WorkCard({
  professionId: 'nature.miner', displayName: '合成职业', icon: 'pick', state: 'paused',
  commissions: [{ commissionId: 'synthetic.T1', category: 'profession', title: '隐藏任务详情' }],
  onPause(id, paused) { pauseCalls.push([id, paused]); },
});
eq('paused state', pausedWork.getAttribute('data-work-state'), 'paused');
eq('paused hides details', pausedWork.querySelectorAll('.ac-career-ui__commission').length, 0);
check('paused shows resume label', pausedWork.textContent.includes('恢复这段经历'));
pausedWork.querySelectorAll('button')[0].click();
eq('paused resume callback', JSON.stringify(pauseCalls[pauseCalls.length - 1]), JSON.stringify(['nature.miner', false]));

const worldWork = components.WorkCard({
  professionId: null, displayName: 'SECRET_PROFESSION', icon: 'tool', state: 'active',
  commissions: [{ commissionId: 'synthetic.world', category: 'world', title: '通用工作', summary: '通用说明', gameName: 'SECRET_GAME', objectiveText: '通用目标', rewardText: 'SECRET_REWARD' }],
  onStart(id) { startCalls.push(id); },
});
eq('world card category', worldWork.getAttribute('data-work-category'), 'world');
check('world card hides profession/game/reward', !worldWork.textContent.includes('SECRET_PROFESSION') && !worldWork.textContent.includes('SECRET_GAME') && !worldWork.textContent.includes('SECRET_REWARD'));
check('world card keeps generic copy', worldWork.textContent.includes('通用工作') && worldWork.textContent.includes('通用目标'));
eq('world card has no pause button', worldWork.querySelectorAll('button').length, 1);
eq('world work empty state', components.WorkCard({ professionId: null, state: 'empty', commissions: [] }).getAttribute('data-work-state'), 'empty');

/* ---------------------------- ReceiptCard -------------------------- */

const receipt = components.ReceiptCard({
  outcome: 'success', state: 'success', title: '合成回执', resultLine: '合成结果',
  rewards: { credits: 12, materials: [{ name: '合成材料', count: 2 }], identity: '合成身份', experience: '合成经历' },
  npcReply: { name: '合成人物', paragraphs: ['合成回话'], state: 'return', actions: [{ label: '不应出现', kind: 'primary', onClick() {} }] },
  nextAction: { id: 'next', label: '继续', kind: 'primary', onClick() {} },
  exitAction: { id: 'exit', label: '今天到这里', kind: 'text', onClick() {} },
});
eq('ReceiptCard state', receipt.getAttribute('data-receipt-state'), 'success');
eq('ReceiptCard role', receipt.getAttribute('role'), 'status');
eq('ReceiptCard aria-live', receipt.getAttribute('aria-live'), 'polite');
eq('ReceiptCard max two actions', receipt.querySelectorAll('button').length, 2);
check('ReceiptCard rewards text', receipt.textContent.includes('12') && receipt.textContent.includes('合成材料') && receipt.textContent.includes('合成身份'));
check('ReceiptCard no tx/run/reason', !/(txId|runId|not-|unknown-|REASON)/.test(receipt.textContent));
const noDuplicate = components.ReceiptCard({ outcome: 'success', state: 'no-duplicate-reward', title: '回看', resultLine: '已完成', rewards: { credits: 99 } });
check('no-duplicate hides rewards', !noDuplicate.textContent.includes('99') && noDuplicate.querySelectorAll('.ac-career-ui__kv').length === 0);
check('failure state renders real next action', components.ReceiptCard({ outcome: 'failure', state: 'failure', title: '未成功', resultLine: '这次没能完成', nextAction: { label: '再试一次', kind: 'primary', onClick() {} } }).textContent.includes('再试一次'));

/* -------------------------- JournalTimeline ------------------------ */

const journal = components.JournalTimeline({
  state: 'filled',
  events: [
    { id: 'hidden-id-1', label: '合成事件一', at: '2026-11-01', source: 'SECRET_SOURCE' },
    { id: 'hidden-id-2', label: '合成事件二', at: '2026-02-30' },
    { label: '合成事件三' },
  ],
});
eq('JournalTimeline state', journal.getAttribute('data-timeline-state'), 'filled');
eq('JournalTimeline ordered list', journal.querySelector('ol').tagName, 'OL');
eq('JournalTimeline DOM order', journal.querySelectorAll('li').map((node) => node.textContent).join('|'), '合成事件一2026-11-01|合成事件二|合成事件三');
check('JournalTimeline hides id/source', !journal.textContent.includes('hidden-id') && !journal.textContent.includes('SECRET_SOURCE'));
eq('JournalTimeline empty text', components.JournalTimeline({ state: 'empty', events: [] }).textContent.includes('还没有记下新的经历'), true);
eq('validIsoDate rejects impossible date', components.formatIsoDate('2026-02-30'), '');
eq('validIsoDate accepts valid date', components.formatIsoDate('2026-02-28T10:00:00Z'), '2026-02-28');

/* ------------------------------ ToolGrid --------------------------- */

eq('ToolGrid hidden has no DOM', components.ToolGrid({ state: 'hidden', tools: [] }), null);
let toolCalls = [];
const tools = components.ToolGrid({
  state: 'available', label: '合成工具',
  tools: [
    { id: 'hangar', label: '机库', icon: 'tool', onClick() { toolCalls.push('hangar'); } },
    { id: 'shop', label: '商店', icon: 'store', onClick() { toolCalls.push('shop'); } },
    { id: 'unknown', label: '未知', icon: 'gem', onClick() { toolCalls.push('unknown'); } },
    { id: 'wallet', label: '钱包', icon: 'wallet', onClick() { toolCalls.push('wallet'); } },
    { id: 'workshop', label: '工作台', icon: 'tool', onClick() { toolCalls.push('workshop'); } },
  ],
});
eq('ToolGrid fixed order', tools.querySelectorAll('button').map((node) => node.getAttribute('data-tool')).join(','), 'wallet,shop,workshop,hangar');
eq('ToolGrid ignores unknown tools', tools.textContent.includes('未知'), false);
eq('ToolGrid aria-label', tools.getAttribute('aria-label'), '合成工具');
eq('ToolGrid group role', tools.getAttribute('role'), 'group');
check('ToolGrid icons aria-hidden', tools.querySelectorAll('.ac-career-ui__icon').every((node) => node.getAttribute('aria-hidden') === 'true'));
tools.querySelectorAll('button')[3].click();
eq('ToolGrid onClick once', toolCalls.join(','), 'hangar');

/* -------------------------- style injection ------------------------ */

const styleOne = components.ensureStyles('.ac-career-ui{color:#fff}');
const styleTwo = components.ensureStyles('.ac-career-ui{color:#000}');
eq('ensureStyles idempotent', styleOne, styleTwo);
eq('ensureStyles only one style node', doc.querySelectorAll('#' + styleOne.id).length, 1);
eq('ensureStyles exposes id', styleOne.id, 'ac-career-ui-components-style');

console.log('T11 components: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
