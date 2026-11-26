#!/usr/bin/env node
/**
 * Arcade 0.21 中心页彻底 passive + 生涯设置二级入口：纯 Node / VM 测试（不启动 Chrome）。
 *
 * 真实加载 apps/arcade/index.html 的页内脚本，用最小 DOM + IDB 桩驱动，断言：
 *  1. 无线索 / 无生涯库 → 无来信小字、无生涯设置入口，中心页只有经典目录。
 *  2. 未读线索 → 「继续上次」附近的低强调小字「旧港有一封来信」（?careerLetter=1）；
 *     已读未投递 → 「继续旧港来信」；都不切视图、不创建生涯。
 *  3. 生涯身份建立后 → 经典目录旁显示常驻「旧港生涯」内容入口；不恢复视图切换。
 *  4. 生涯已开启 → 页尾「生涯设置」；封存后 → 页尾「生涯设置（已封存）」、
 *     来信小字隐藏，链接固定 ?careerPanel=settings。
 *  5. 旧偏好 hallDefaultView=career 不再影响经典目录（只读不写回）。
 *  6. pageshow / visibilitychange 刷新与代际防竞态；44px 热区与 reduced-motion 保留。
 *
 * 运行：node tools/career_passive_entry_test.mjs
 * 退出码：0 = 全 PASS；1 = 有 FAIL；2 = 产品文件缺失 / 用法错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const HUB_REL = 'apps/arcade/index.html';
const CSS_REL = 'apps/arcade/arcade.css';
const HUB_ABS = path.join(ROOT, HUB_REL);
const CSS_ABS = path.join(ROOT, CSS_REL);

if (process.argv.slice(2).length > 0) {
  console.error('usage: node tools/career_passive_entry_test.mjs（不接受参数）');
  process.exit(2);
}
for (const file of [HUB_ABS, CSS_ABS]) {
  if (!fs.existsSync(file)) {
    console.error('missing product file: ' + path.relative(ROOT, file));
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

const HUB_HTML = fs.readFileSync(HUB_ABS, 'utf8');
const CSS = fs.readFileSync(CSS_ABS, 'utf8');

/* ------------------------------------------------------------------ *
 * 静态 DOM 契约（先跑，失败也能继续跑 VM 用例）
 * ------------------------------------------------------------------ */
const FORBIDDEN_MARKERS = [
  'data-hall-modes', 'data-hall-view', 'data-default-view', 'data-career-view',
  'data-career-panel-link', 'data-career-chapters', 'data-story-entry',
  'hallDefaultView',
];
for (const marker of FORBIDDEN_MARKERS) {
  check('CE-S 中心页不再含永久视图开关标记 ' + marker, HUB_HTML.indexOf(marker) < 0);
}
check('CE-S 经典目录包裹节点仍在', HUB_HTML.indexOf('data-classic-view') >= 0);
check('CE-S 来信低强调小字保留在继续上次附近', (() => {
  const resume = HUB_HTML.indexOf('data-resume-section');
  const letter = HUB_HTML.indexOf('data-letter-entry');
  return resume >= 0 && letter > resume && letter - resume < 1200;
})());
check('CE-S 页尾生涯设置入口存在且链接固定 ?careerPanel=settings', (() => {
  const footer = HUB_HTML.indexOf('<footer class="hall-foot"');
  const entry = HUB_HTML.indexOf('data-career-settings-entry');
  const href = HUB_HTML.indexOf('href="games/pendulum-tower.html?careerPanel=settings"');
  return footer >= 0 && entry > footer && href > entry;
})());
check('CE-S 保留 ?careerLetter=1 回访路由', HUB_HTML.indexOf('games/pendulum-tower.html?careerLetter=1') >= 0);
check('CE-S 生涯身份建立后的常驻内容入口存在', (() => {
  const resume = HUB_HTML.indexOf('data-resume-section');
  const entry = HUB_HTML.indexOf('data-career-entry');
  const href = HUB_HTML.indexOf('href="games/pendulum-tower.html?careerPanel=town"');
  return resume >= 0 && entry > resume && entry - resume < 900 && href > resume && HUB_HTML.slice(entry - 120, entry + 220).indexOf('href="games/pendulum-tower.html?careerPanel=town"') >= 0;
})());
check('CE-S 44px 热区规则保留（来信 + 生涯设置）',
  /\.hall-letter-entry a\s*\{[^}]*min-height:\s*44px/.test(CSS) &&
  /\.hall-career-settings a\s*\{[^}]*min-height:\s*44px/.test(CSS) &&
  /\.hall-career-entry\s*\{[^}]*min-height:\s*44px/.test(CSS));
check('CE-S reduced-motion 规则保留', CSS.indexOf('@media (prefers-reduced-motion: reduce)') >= 0);
check('CE-S 移除生涯视图/常驻链接的旧 CSS',
  CSS.indexOf('.hall-mode-switch') < 0 && CSS.indexOf('.hall-career-links') < 0 && CSS.indexOf('.hall-story-entry') < 0);

/* ------------------------------------------------------------------ *
 * 最小 DOM 桩：只实现首页脚本用到的节点接口
 * ------------------------------------------------------------------ */
class StubNode {
  constructor(tag, attrs = {}) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = Object.assign(Object.create(null), attrs);
    this.children = [];
    this.parentNode = null;
    this._text = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = attrs.value || '';
    this.options = [];
    this.className = attrs.class || '';
    this.type = attrs.type || '';
    this.id = attrs.id || '';
    this.title = '';
    this.href = attrs.href || '';
    this._listeners = Object.create(null);
    this.style = { setProperty() {}, removeProperty() {} };
    const self = this;
    this.dataset = new Proxy({}, {
      get(_t, key) { return self.attrs['data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())]; },
      set(_t, key, value) { self.attrs['data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())] = String(value); return true; },
    });
    this.classList = {
      add(name) { self._setClass([name, true]); },
      remove(name) { self._setClass([name, false]); },
      toggle(name, force) { self._setClass([name, !!force]); },
      contains(name) { return String(self.className).split(/\s+/).indexOf(name) >= 0; },
    };
  }
  _setClass([name, on]) {
    const parts = String(this.className).split(/\s+/).filter(Boolean);
    const i = parts.indexOf(name);
    if (on && i < 0) parts.push(name);
    if (!on && i >= 0) parts.splice(i, 1);
    this.className = parts.join(' ');
  }
  get textContent() { return this._text; }
  set textContent(value) { this._text = value === null || value === undefined ? '' : String(value); }
  setAttribute(name, value) { this.attrs[name] = String(value); if (name === 'value') this.value = String(value); }
  getAttribute(name) {
    if (name === 'href' && this.href !== undefined) return this.href || null;
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  removeAttribute(name) { delete this.attrs[name]; if (name === 'href') this.href = ''; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  append(...nodes) { nodes.forEach((n) => this.appendChild(n)); }
  add(node) { this.appendChild(node); }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) this.children.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  replaceChildren(...nodes) {
    this.children.forEach((c) => { c.parentNode = null; });
    this.children = [];
    nodes.forEach((n) => this.appendChild(n));
  }
  addEventListener(type, fn) {
    (this._listeners[type] || (this._listeners[type] = [])).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners[type] || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  dispatch(type, event = {}) {
    const ev = Object.assign({ target: this, preventDefault() {}, stopPropagation() {} }, event);
    (this._listeners[type] || []).slice().forEach((fn) => fn(ev));
  }
  querySelector(selector) {
    const m = /^\[data-([a-z-]+)\]$/.exec(selector);
    return this.children.find((n) => m && n.hasAttribute('data-' + m[1])) || null;
  }
  querySelectorAll(selector) {
    const m = /^\[data-([a-z-]+)\]$/.exec(selector);
    return m ? this.children.filter((n) => n.hasAttribute('data-' + m[1])) : [];
  }
  focus() {}
  click() { this.dispatch('click'); }
  getClientRects() { return this.hidden ? [] : [{}]; }
  closest() { return null; }
  showModal() {}
}

class StubDocument {
  constructor(selectors) {
    this.nodes = new Map();
    this.body = new StubNode('body');
    for (const selector of selectors) {
      const attr = /^\[([^\]]+)\]$/.exec(selector);
      const key = attr ? attr[1] : selector;
      const child = new StubNode('div', attr ? { [key]: '' } : { class: key.replace(/^\./, '') });
      if (key === 'data-hall-version') child.textContent = '0.21.0';
      if (key === 'data-manage-note') child.textContent = '游玩记录和局内进度只保存在此浏览器内。';
      if (key === 'data-hall-grid') child.className = 'hall-grid';
      if (key === 'data-sort') {
        child.options = ['recommend', 'difficulty', 'recent', 'high', 'name'].map((v) => ({ value: v }));
        child.value = 'recommend';
      }
      if (key === 'data-scores-mode') {
        child.options = ['all', 'classic', 'zen'].map((v) => ({ value: v }));
        child.value = 'all';
      }
      this.nodes.set(selector, child);
      this.body.appendChild(child);
    }
    this.hidden = false;
    this._listeners = Object.create(null);
    this.activeElement = null;
    // [data-letter-entry] > [data-letter-label]
    const letter = this.nodes.get('[data-letter-entry]');
    const label = new StubNode('a', { 'data-letter-label': '' });
    letter.appendChild(label);
    this.letterLabel = label;
    // [data-career-settings-entry] > [data-career-settings-label]
    const settings = this.nodes.get('[data-career-settings-entry]');
    const settingsLabel = new StubNode('a', { 'data-career-settings-label': '' });
    settings.appendChild(settingsLabel);
    this.settingsLabel = settingsLabel;
    // [data-career-entry] 常驻内容入口（仅在生涯身份建立后显示）
    const career = this.nodes.get('[data-career-entry]');
    if (!career) {
      this.nodes.set('[data-career-entry]', new StubNode('a', { 'data-career-entry': '' }));
    }
    this.careerEntry = this.nodes.get('[data-career-entry]');
    this.careerEntry.hidden = true;
    this.careerLabel = new StubNode('span', { 'data-career-entry-label': '' });
    this.careerEntry.appendChild(this.careerLabel);
    // [data-filters] 容器与 [data-scores-game]/[data-manage-game] 的 select 行为
    const filters = this.nodes.get('[data-filters]');
    filters.appendChild(new StubNode('button', { 'data-category': '全部' }));
  }
  querySelector(selector) {
    if (selector === '.hall-filter-details > summary') return new StubNode('summary');
    if (selector === '[data-letter-label]') return this.letterLabel;
    if (selector === '[data-career-settings-label]') return this.settingsLabel;
    if (selector === '[data-career-entry-label]') return this.careerLabel;
    return this.nodes.get(selector) || null;
  }
  createElement(tag) { return new StubNode(tag); }
  addEventListener(type, fn) { (this._listeners[type] || (this._listeners[type] = [])).push(fn); }
  dispatch(type, event = {}) {
    (this._listeners[type] || []).slice().forEach((fn) => fn(Object.assign({ preventDefault() {} }, event)));
  }
}

/* ------------------------------------------------------------------ *
 * 最小 IndexedDB 桩：只读探针，不建库；每次 open 返回当前 fixture 快照
 * ------------------------------------------------------------------ */
function makeIndexedDB(fixture, options = {}) {
  if (!fixture.state) fixture.state = Object.create(null);
  if (!fixture.profiles) fixture.profiles = Object.create(null);
  if (!fixture.quests) fixture.quests = Object.create(null);
  const stateRows = fixture.state;
  const profiles = fixture.profiles;
  const quests = fixture.quests;
  const calls = [];
  return {
    calls,
    fixture,
    databases() {
      return Promise.resolve(fixture.hasDb !== false ? [{ name: 'studiokit:arcade:career' }] : []);
    },
    open(name) {
      calls.push(['open', name]);
      const request = { transaction: { abort() {} }, onsuccess: null, onerror: null, onupgradeneeded: null };
      setTimeout(() => {
        if (fixture.hasDb === false) {
          if (request.onerror) request.onerror(new Error('no-db'));
          return;
        }
        if (request.onupgradeneeded) request.onupgradeneeded();
        const db = {
          transaction() {
            const tx = {};
            let pending = 0;
            const done = () => { if (tx.oncomplete) tx.oncomplete(); };
            const schedule = (fn, extraDelay = 0) => {
              pending += 1;
              setTimeout(() => {
                try { fn(); } finally { pending -= 1; if (pending === 0) setTimeout(done, 0); }
              }, extraDelay);
            };
            tx.objectStore = (store) => ({
              get(key) {
                const req = {};
                const delay = typeof options.getDelay === 'function' ? options.getDelay(store, key) : (options.getDelay || 0);
                schedule(() => {
                  let row = null;
                  const fixtureKey = Array.isArray(key) ? key.join('|') : key;
                  if (store === 'state') row = stateRows[fixtureKey] === undefined ? null : { key: fixtureKey, value: stateRows[fixtureKey] };
                  else if (store === 'profiles') row = profiles[fixtureKey] === undefined ? null : { key: fixtureKey, value: profiles[fixtureKey] };
                  else if (store === 'quests') row = quests[fixtureKey] === undefined ? null : { key: fixtureKey, value: quests[fixtureKey] };
                  req.result = row;
                  if (req.onsuccess) req.onsuccess({ result: row });
                }, delay);
                return req;
              },
              getAll() {
                const req = {};
                schedule(() => {
                  const rows = Object.values(quests);
                  req.result = rows;
                  if (req.onsuccess) req.onsuccess({ result: rows });
                });
                return req;
              },
              count() {
                const req = {};
                schedule(() => {
                  req.result = Object.keys(quests).length;
                  if (req.onsuccess) req.onsuccess({ result: req.result });
                });
                return req;
              },
            });
            setTimeout(() => { if (pending === 0) done(); }, 0);
            return tx;
          },
          close() {},
        };
        request.result = db;
        if (request.onsuccess) request.onsuccess({ result: db });
      }, 0);
      return request;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Arcade 引擎桩：只提供首页脚本装载期会读到的接口
 * ------------------------------------------------------------------ */
function makeArcade(prefs) {
  const games = [
    { id: 'shadow-leap', file: 'shadow-leap.html', name: '影跃', icon: '🌙', category: '动作', difficulty: 2, accent: '#8c7cff', tagline: '', how: '', tags: [] },
    { id: 'pendulum-tower', file: 'pendulum-tower.html', name: '层塔', icon: '🏗', category: '益智', difficulty: 3, accent: '#ffb04c', tagline: '', how: '', tags: [] },
  ];
  const emptyStats = { totalMs: 0, todayMs: 0, weekMs: 0, rounds: 0, daily: [], games: [] };
  const prefWrites = [];
  return {
    games,
    prefWrites,
    api: {
      version: '0.21.0',
      GAMES: games,
      DIFFICULTY_NAMES: { 1: '轻松', 2: '适中', 3: '挑战', 4: '硬核' },
      Prefs: {
        load() { return Object.assign({}, prefs); },
        save(value) { prefWrites.push(value); },
      },
      RunSave: { all() { return {}; } },
      Progress: { load() { return { games: {} }; }, exportText() { return '{}'; } },
      Playtime: { stats() { return emptyStats; } },
      Scores: { stats() { return { total: 0, byGame: {} }; }, list() { return []; }, modeLabel() { return ''; } },
      Offline: {
        supported: false,
        register() { return Promise.resolve(); },
        cacheStatus() { return Promise.resolve({ coreCached: 0, coreTotal: 0, gamesCached: 0, gamesTotal: 0 }); },
        onUpdate() {},
        checkForUpdate() { return Promise.resolve({ supported: false }); },
        applyUpdate() { return Promise.resolve(); },
        preloadUrls() { return []; },
        precache() { return Promise.resolve({ total: 0, failed: 0 }); },
      },
      Share: { shareHub() { return Promise.resolve({ ok: true, mode: 'copy' }); } },
      Sfx: { play() {} },
      showToast() {},
      formatDuration() { return '0 分钟'; },
      formatClock() { return '0:00'; },
      formatRoundAt() { return ''; },
      formatSavedAt() { return ''; },
    },
  };
}

const SELECTORS = Array.from(new Set(Array.from(HUB_HTML.matchAll(/document\.querySelector\('([^']+)'\)/g), (m) => m[1])));
function inlineScript() {
  const start = HUB_HTML.lastIndexOf('<script>');
  const end = HUB_HTML.indexOf('</script>', start);
  if (start < 0 || end < 0) throw new Error('hub inline script not found');
  return HUB_HTML.slice(start + '<script>'.length, end);
}
const SCRIPT = inlineScript();

async function boot(prefs = {}, fixture = { hasDb: false }, options = {}) {
  const doc = new StubDocument(SELECTORS);
  const arcade = makeArcade(prefs);
  const idb = makeIndexedDB(fixture, options);
  const windowStub = {
    Arcade: arcade.api,
    matchMedia() { return { matches: false }; },
    confirm() { return false; },
    alert() {},
    addEventListener(type, fn) { (this._l || (this._l = Object.create(null)))[type] = (this._l[type] || []).concat(fn); },
    dispatch(type, event = {}) { ((this._l || {})[type] || []).forEach((fn) => fn(Object.assign({ preventDefault() {} }, event))); },
    navigator: { userAgent: '', platform: '', standalone: false },
    location: { href: '', hash: '', search: '' },
  };
  const sandbox = {
    document: doc,
    window: windowStub,
    indexedDB: idb,
    navigator: windowStub.navigator,
    location: windowStub.location,
    history: { state: {}, replaceState() {} },
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Boolean,
    Number,
    RegExp,
    Error,
    Set,
    Map,
    Blob: class Blob {},
    URL: { createObjectURL() { return 'blob:stub'; }, revokeObjectURL() {} },
    FileReader: class FileReader { readAsText() {} },
    Option: class Option { constructor(text, value) { this.text = text; this.value = value; } },
    navigator$unused: undefined,
  };
  sandbox.globalThis = sandbox;
  sandbox.console = console;
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox, { filename: HUB_REL });
  // 等待 readHallCareer 的 IDB 回调链 + refreshHallViews 完成。
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  return {
    doc,
    arcade,
    idb,
    windowStub,
    letter() {
      return {
        hidden: doc.nodes.get('[data-letter-entry]').hidden,
        text: doc.letterLabel.textContent,
        href: doc.letterLabel.getAttribute('href'),
      };
    },
    career() {
      return {
        hidden: doc.nodes.get('[data-career-entry]').hidden,
        text: doc.careerLabel.textContent,
        href: doc.nodes.get('[data-career-entry]').getAttribute('href'),
      };
    },
    settings() {
      return {
        hidden: doc.nodes.get('[data-career-settings-entry]').hidden,
        text: doc.settingsLabel.textContent,
        href: doc.settingsLabel.getAttribute('href'),
      };
    },
  };
}

/* ------------------------------------------------------------------ *
 * VM 用例
 * ------------------------------------------------------------------ */
const UNREAD_DISC = { stage: 'GLIMPSED', clues: { a: { sourceGame: 'shadow-leap' } } };
const READ_UNDELIVERED_DISC = { stage: 'CURIOUS', clues: { a: { sourceGame: 'shadow-leap', openedAt: '2026-11-25T00:00:00Z' } } };
const ARCHIVE = { careerId: 'career-1', archivedAt: '2026-11-26T00:00:00Z' };

async function run() {
  /* CE-01 无生涯库 / 无线索：不建库、无入口。 */
  {
    const h = await boot();
    check('CE-01 无库无线索：来信小字隐藏', h.letter().hidden === true, h.letter());
    check('CE-01 无库无线索：生涯设置入口隐藏', h.settings().hidden === true, h.settings());
    check('CE-01 无库无线索：生涯内容入口隐藏', h.career().hidden === true, h.career());
    check('CE-01 无库不创建生涯库', h.idb.calls.every((c) => c[0] !== 'open'), h.idb.calls);
  }
  /* CE-02 有库但无线索、无 profile：仍无入口，不创建生涯。 */
  {
    const h = await boot({}, { hasDb: true, state: { discovery: { stage: 'IDLE', clues: {} } } });
    check('CE-02 有库无线索：来信小字隐藏', h.letter().hidden === true, h.letter());
    check('CE-02 有库无线索：生涯设置入口隐藏', h.settings().hidden === true, h.settings());
    check('CE-02 有库无线索：生涯内容入口隐藏', h.career().hidden === true, h.career());
    check('CE-02 只读探针不建库（只 open 不 upgrade）', h.idb.calls.filter((c) => c[0] === 'open').length === 1, h.idb.calls);
  }
  /* CE-03 未读线索：低强调小字，不切视图、不创建生涯。 */
  {
    const h = await boot({}, { hasDb: true, state: { discovery: UNREAD_DISC } });
    check('CE-03 未读：来信小字可见', h.letter().hidden === false, h.letter());
    check('CE-03 未读：文案「旧港有一封来信」', h.letter().text === '旧港有一封来信', h.letter());
    check('CE-03 未读：链接 ?careerLetter=1', h.letter().href === 'games/pendulum-tower.html?careerLetter=1', h.letter());
    check('CE-03 未读：不显示生涯设置入口', h.settings().hidden === true, h.settings());
    check('CE-03 未读：身份建立前不显示生涯内容入口', h.career().hidden === true, h.career());
    check('CE-03 未读：不写回偏好', h.arcade.prefWrites.length === 0, h.arcade.prefWrites);
  }
  /* CE-04 已读未投递：续读小字。 */
  {
    const h = await boot({}, { hasDb: true, state: { discovery: READ_UNDELIVERED_DISC } });
    check('CE-04 已读未投递：文案「继续旧港来信」', h.letter().hidden === false && h.letter().text === '继续旧港来信', h.letter());
  }
  /* CE-05 生涯身份建立后：常驻内容入口 + 页尾设置，不恢复视图切换。 */
  {
    const h = await boot({}, {
      hasDb: true,
      state: {
        discovery: { stage: 'LOCAL', portSeenAt: '2026-11-25T01:00:00Z', clues: { a: { sourceGame: 'shadow-leap', openedAt: '2026-11-25T00:00:00Z' } } },
        career: { careerId: 'career-1' },
      },
      profiles: { 'career-1': { careerId: 'career-1' } },
      quests: { 'career-1|story:C0.port_seen': { nodeId: 'story:C0.port_seen' } },
    });
    check('CE-05 C0 后：未投递来信小字隐藏', h.letter().hidden === true, h.letter());
    check('CE-05 C0 后：常驻生涯内容入口可见', h.career().hidden === false, h.career());
    check('CE-05 C0 后：生涯入口文案为旧港生涯', h.career().text === '旧港生涯', h.career());
    check('CE-05 C0 后：生涯入口直达告示板', h.career().href === 'games/pendulum-tower.html?careerPanel=town', h.career());
    check('CE-05 C0 后：不恢复生涯视图切换', h.doc.querySelector('[data-career-view]') === null);
    check('CE-05 C0 后：页尾生涯设置可见', h.settings().hidden === false, h.settings());
    check('CE-05 C0 后：文案「生涯设置」', h.settings().text === '生涯设置', h.settings());
    check('CE-05 C0 后：链接固定 ?careerPanel=settings', h.settings().href === 'games/pendulum-tower.html?careerPanel=settings', h.settings());
  }
  /* CE-05b 身份刚建立、尚未完成 C0 / 委托时也常驻显示。 */
  {
    const h = await boot({}, {
      state: { career: { careerId: 'career-1' } },
      profiles: { 'career-1': { careerId: 'career-1' } },
      quests: {},
    });
    check('CE-05b 身份建立即显示常驻生涯入口', h.career().hidden === false, h.career());
    check('CE-05b 身份建立即显示生涯设置', h.settings().hidden === false, h.settings());
  }

  /* CE-05c 旧档无 profile 但有 C0：兼容显示常驻生涯入口与设置。 */
  {
    const h = await boot({}, {
      state: {},
      profiles: {},
      quests: { 'legacy|story:C0.port_seen': { careerId: 'legacy', nodeId: 'story:C0.port_seen' } },
    });
    check('CE-05c 旧档 C0 无 profile：常驻生涯入口可见', h.career().hidden === false, h.career());
    check('CE-05c 旧档 C0 无 profile：生涯设置可见', h.settings().hidden === false, h.settings());
  }

  /* CE-06 封存：只显示「生涯设置（已封存）」，来信隐藏。 */
  {
    const h = await boot({}, {
      hasDb: true,
      state: { discovery: UNREAD_DISC, career: { careerId: 'career-1' }, 'career-archive': ARCHIVE },
      profiles: { 'career-1': { careerId: 'career-1' } },
      quests: { 'career-1|story:C0.port_seen': { nodeId: 'story:C0.port_seen' } },
    });
    check('CE-06 封存：来信小字隐藏', h.letter().hidden === true, h.letter());
    check('CE-06 封存：生涯内容入口隐藏', h.career().hidden === true, h.career());
    check('CE-06 封存：生涯设置仍可见', h.settings().hidden === false, h.settings());
    check('CE-06 封存：文案「生涯设置（已封存）」', h.settings().text === '生涯设置（已封存）', h.settings());
    check('CE-06 封存：链接仍为 ?careerPanel=settings', h.settings().href === 'games/pendulum-tower.html?careerPanel=settings', h.settings());
  }
  /* CE-07 旧偏好 hallDefaultView=career 不影响经典；不被写回。 */
  {
    const h = await boot({ hallDefaultView: 'career', hallSort: 'name' }, {
      hasDb: true,
      state: { discovery: UNREAD_DISC, career: { careerId: 'career-1' } },
      profiles: { 'career-1': { careerId: 'career-1' } },
    });
    check('CE-07 旧默认生涯偏好：仍显示经典来信小字', h.letter().hidden === false, h.letter());
    check('CE-07 旧默认生涯偏好：不切到生涯视图（无视图开关 DOM）', h.doc.querySelector('[data-career-view]') === null);
    check('CE-07 旧默认生涯偏好：不写 hallDefaultView', h.arcade.prefWrites.length === 0, h.arcade.prefWrites);
  }
  /* CE-08 pageshow / visibilitychange 刷新 + 代际防竞态。 */
  {
    const fixture = { hasDb: true, state: { discovery: UNREAD_DISC }, profiles: {}, quests: {} };
    const h = await boot({}, fixture, { getDelay: () => 0 });
    check('CE-08 初始未读小字可见', h.letter().hidden === false, h.letter());
    fixture.state.discovery = { stage: 'IDLE', clues: {} };
    h.windowStub.dispatch('pageshow');
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 5));
    check('CE-08 pageshow 后刷新为无线索', h.letter().hidden === true, h.letter());
    fixture.state.discovery = { stage: 'LOCAL', portSeenAt: '2026-11-25T01:00:00Z', clues: { a: { sourceGame: 'shadow-leap', openedAt: '2026-11-25T00:00:00Z' } } };
    fixture.state.career = { careerId: 'career-1' };
    fixture.profiles['career-1'] = { careerId: 'career-1' };
    h.doc.hidden = false;
    h.doc.dispatch('visibilitychange');
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 5));
    check('CE-08 visibilitychange 后刷新出生涯设置', h.settings().hidden === false && h.letter().hidden === true, { letter: h.letter(), settings: h.settings() });
    check('CE-08 visibilitychange 后刷新出常驻生涯入口', h.career().hidden === false && h.career().href === 'games/pendulum-tower.html?careerPanel=town', h.career());

    // 竞态：第一次读取慢（25ms），第二次读取快（0ms）；旧结果不得覆盖新结果。
    const raceFixture = { hasDb: true, state: { discovery: { stage: 'IDLE', clues: {} } }, profiles: {}, quests: {} };
    let openCount = 0;
    const race = await boot({}, raceFixture, {
      getDelay: () => {
        openCount += 1;
        return openCount <= 3 ? 25 : 0; // 首次事务的 3 个 get 慢，其余快
      },
    });
    raceFixture.state.discovery = UNREAD_DISC;
    race.windowStub.dispatch('pageshow'); // 慢读：IDLE
    race.windowStub.dispatch('pageshow'); // 快读：UNREAD
    for (let i = 0; i < 14; i += 1) await new Promise((r) => setTimeout(r, 5));
    check('CE-08 代际防竞态：最新读取胜出', race.letter().hidden === false && race.letter().text === '旧港有一封来信', race.letter());
  }
  /* CE-10 完全重置后：常驻生涯入口与设置入口一起消失。 */
  {
    const fixture = {
      state: { career: { careerId: 'career-1' } },
      profiles: { 'career-1': { careerId: 'career-1' } },
      quests: { 'career-1|story:C0.port_seen': { nodeId: 'story:C0.port_seen' } },
    };
    const h = await boot({}, fixture);
    check('CE-10 重置前常驻生涯入口可见', h.career().hidden === false, h.career());
    delete fixture.state.career;
    delete fixture.profiles['career-1'];
    delete fixture.quests['career-1|story:C0.port_seen'];
    h.windowStub.dispatch('pageshow');
    for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    check('CE-10 完全重置后生涯入口消失', h.career().hidden === true, h.career());
    check('CE-10 完全重置后生涯设置入口消失', h.settings().hidden === true, h.settings());
  }

  /* CE-09 后备兼容性：archive 标记写成 {careerId, archivedAt} 或 {archived:true} 都能识别。 */
  {
    const fixture = {
      hasDb: true,
      state: { discovery: UNREAD_DISC, career: { careerId: 'career-1' }, 'career-archive': { careerId: 'career-1', archivedAt: '2026-11-26T00:00:00Z' } },
      profiles: { 'career-1': { careerId: 'career-1' } },
    };
    const h = await boot({}, fixture);
    check('CE-09 封存标记 {careerId, archivedAt} 被识别', h.settings().hidden === false && h.settings().text === '生涯设置（已封存）', h.settings());
    check('CE-09 封存标记下生涯内容入口隐藏', h.career().hidden === true, h.career());
  }
}

run().then(() => {
  console.log('\ncareer_passive_entry: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail === 0 ? 0 : 1);
}).catch((err) => {
  console.error('career_passive_entry harness error:', err);
  process.exit(1);
});
