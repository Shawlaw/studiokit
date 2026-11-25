/**
 * 旧港告示板 0.20 首航 UI 契约（纯 Node，无 Chrome / 无 jsdom）。
 *
 * 用最小 DOM 桩直接执行 apps/arcade/career/ui/town.js，验证：
 *  1. 首屏只突出一张真实推荐单，游戏名 + objective.atLeast 可读目标；自由接单折叠；
 *  2. 不出现 C 码 / active / locked / 长 token / 96 条相同 durationHint；
 *  3. 推荐只消费 campaign.recommend + 真实 unlockedSet，缺接口安全回退；
 *  4. 失败优先结果明确说明，提供一键重接与回告示板；
 *  5. continuations：issued/active 才显示「继续这张单」，ending.* 不当委托，缺接口回退；
 *  6. 异步 getWallet / Promise continuations 不破坏面板；重复 open 不抢焦点；Esc 关闭并归还焦点；
 *  7. 静态样式含 44px 热区、无远程资源/绝对根路径。
 *
 * 运行：node tools/career_town_flow_test.mjs（不依赖浏览器、不跑其他测试）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOWN = path.join(ROOT, 'apps/arcade/career/ui/town.js');
const CONTENT = path.join(ROOT, 'apps/arcade/career/content');

const source = fs.readFileSync(TOWN, 'utf8');
const commissionsContent = JSON.parse(fs.readFileSync(path.join(CONTENT, 'commissions.json'), 'utf8'));
const itemsContent = JSON.parse(fs.readFileSync(path.join(CONTENT, 'items.json'), 'utf8'));
const registryContent = JSON.parse(fs.readFileSync(path.join(CONTENT, 'registry.json'), 'utf8'));

function commissionById(id) {
  const row = commissionsContent.commissions.filter((entry) => entry.commissionId === id)[0];
  assert.ok(row, '真实内容缺少委托 ' + id);
  return row;
}

/* ------------------------------------------------------------------ *
 * 最小 DOM 桩：足够 town.js 的 createElement / classList / 选择器 / 事件。
 * 不是完整 DOM；只用于契约断言，不声称浏览器渲染通过。
 * ------------------------------------------------------------------ */

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
      contains(name) {
        return self._className.split(/\s+/).indexOf(String(name)) >= 0;
      },
    };
  }

  get className() { return this._className; }
  set className(value) { this._className = value == null ? '' : String(value); }

  get firstChild() { return this.childNodes.length ? this.childNodes[0] : null; }

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

  appendChild(node) {
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) {
      this.childNodes.splice(index, 1);
      node.parentNode = null;
    }
    return node;
  }

  insertBefore(node, ref) {
    const index = ref ? this.childNodes.indexOf(ref) : -1;
    node.parentNode = this;
    if (index < 0) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
    return node;
  }

  contains(node) {
    for (let cur = node; cur; cur = cur.parentNode) if (cur === this) return true;
    return false;
  }

  addEventListener(type, fn) {
    (this.listeners[type] || (this.listeners[type] = [])).push(fn);
  }

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
      const list = cur.listeners[type] || [];
      for (const fn of list.slice()) fn(evt);
    }
  }

  focus() {
    this.doc.activeElement = this;
  }

  getClientRects() {
    if (this.hidden) return [];
    for (let cur = this; cur; cur = cur.parentNode) {
      if (cur.hidden === true) return [];
      if (cur.tagName === 'DETAILS' && cur.open !== true) return [];
      const style = String(cur.getAttribute && cur.getAttribute('style') || '');
      if (/display\s*:\s*none/.test(style)) return [];
    }
    return [{}];
  }

  get isConnected() {
    return true;
  }

  matches(selector) {
    const parts = String(selector).split(',').map((s) => s.trim()).filter(Boolean);
    return parts.some((part) => matchesOne(this, part));
  }

  closest(selector) {
    for (let cur = this; cur; cur = cur.parentNode) if (cur.matches(selector)) return cur;
    return null;
  }

  querySelectorAll(selector) {
    const out = [];
    walk(this, (node) => {
      if (node !== this && node.matches(selector)) out.push(node);
    });
    return out;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function matchesOne(node, raw) {
  let selector = raw.trim();
  const nots = [];
  selector = selector.replace(/:not\(([^)]+)\)/g, (_, inner) => {
    nots.push(inner.trim());
    return '';
  });
  selector = selector.trim();
  if (!selector) return false;
  for (const not of nots) if (matchesOne(node, not)) return false;

  if (selector === '*') return true;
  if (selector[0] === '.') return node.classList.contains(selector.slice(1));
  if (selector[0] === '#') return node.id === selector.slice(1);
  const attr = /^\[([a-zA-Z0-9_-]+)(?:=["']?([^\]"']*)["']?)?\]$/.exec(selector);
  if (attr) {
    const value = node.getAttribute(attr[1]);
    if (value === null) return false;
    return attr[2] === undefined ? true : value === attr[2];
  }
  return node.tagName === selector.toUpperCase();
}

function walk(root, visit) {
  for (const child of root.childNodes) {
    visit(child);
    walk(child, visit);
  }
}

function makeDoc() {
  const doc = {
    activeElement: null,
    body: null,
    head: null,
    documentElement: null,
    listeners: Object.create(null),
    createElement(tag) { return new El(tag, doc); },
    getElementById(id) {
      let found = null;
      walk(doc.documentElement || doc.body || { childNodes: [] }, (node) => {
        if (!found && node.id === id) found = node;
      });
      return found;
    },
    querySelectorAll(selector) {
      const out = [];
      walk(doc.documentElement || doc.body || { childNodes: [] }, (node) => {
        if (node.matches(selector)) out.push(node);
      });
      return out;
    },
    addEventListener(type, fn) {
      (doc.listeners[type] || (doc.listeners[type] = [])).push(fn);
    },
    removeEventListener(type, fn) {
      const list = doc.listeners[type] || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    emit(type, event) {
      const evt = event || Object.create(null);
      if (!evt.preventDefault) evt.preventDefault = () => {};
      for (const fn of (doc.listeners[type] || []).slice()) fn(evt);
    },
  };
  doc.documentElement = new El('html', doc);
  doc.head = new El('head', doc);
  doc.body = new El('body', doc);
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  return doc;
}

function loadTown() {
  const doc = makeDoc();
  const win = {
    location: { href: 'http://localhost/apps/arcade/games/pendulum-tower.html', assign(url) { win.navigated = url; } },
    ArcadeCareer: { registry: { getGame(id) {
      const game = registryContent.games.filter((entry) => entry.gameId === id)[0];
      return game || null;
    } } },
    navigated: null,
  };
  const sandbox = { document: doc, window: win, console, URL, Promise, Set, Map, Object, Array, String, Number, JSON, Math };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: 'town.js' });
  const town = win.ArcadeCareerUI.town;
  assert.ok(town && typeof town.render === 'function', 'town UI 未挂载');
  return { doc, win, town, sandbox };
}

function basicCtx(overrides = {}) {
  const calls = { start: [], continuations: [], recommend: [] };
  const ctx = {
    careerId: 'career-test-1',
    commissions: { commissions: [
      commissionById('pendulum-tower.T1'),
      commissionById('memory-flip.T1'),
      commissionById('star-raid.T1'),
    ] },
    items: itemsContent,
    registry: { games: registryContent.games },
    originIntro: () => ({ sourceGame: 'pendulum-tower', greeting: '阿砾把旧物收下了。', address: '旧码头门房' }),
    campaign: {
      state: () => ({
        ok: true,
        currentChapter: 'C0',
        chapters: [{ chapterId: 'C0', title: '不起眼的印记', state: 'active', routes: [{ hint: '先接阿砾指定的那单。' }] }],
        endings: [],
      }),
      recommend: (input) => {
        calls.recommend.push(input);
        return {
          commissionId: 'pendulum-tower.T1',
          goal: '阿砾指定的第一份单子',
          reason: '做完港里会把你记成在册自由职业者',
          kind: 'milestone',
        };
      },
    },
    commission: {
      listAvailable: () => ({ ok: true, list: ['pendulum-tower.T1', 'memory-flip.T1', 'star-raid.T1'] }),
      getWallet: () => ({ ok: true, credits: 120, items: {} }),
      start: (input) => {
        calls.start.push(input);
        return { ok: true, url: 'games/pendulum-tower.html?ticket=run-test' };
      },
      continuations: (input) => {
        calls.continuations.push(input);
        return {
          ok: true,
          runs: [
            { commissionId: 'memory-flip.T1', runId: 'run-1', status: 'issued', gameId: 'memory-flip' },
            { commissionId: 'ending.combat', runId: 'run-2', status: 'active', gameId: 'star-raid' },
            { commissionId: 'star-raid.T1', runId: 'run-3', status: 'settled', gameId: 'star-raid' },
          ],
        };
      },
    },
    reducedMotion: false,
  };
  return Object.assign(ctx, overrides, { __calls: calls });
}

function all(root, predicate) {
  const out = [];
  walk(root, (node) => { if (predicate(node)) out.push(node); });
  return out;
}

function byAttr(root, name, value) {
  return all(root, (node) => node.getAttribute(name) === value);
}

function byClass(root, className) {
  return all(root, (node) => node.classList.contains(className));
}

function combinedText(root) {
  return root.textContent.replace(/\s+/g, ' ').trim();
}

const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail || '' });
  } catch (err) {
    results.push({ name, ok: false, detail: (err && err.message) || String(err) });
  }
}

check('首屏一个主动作：live run 优先为推荐单，其余单折叠', () => {
  const { win, town } = loadTown();
  const ctx = basicCtx();
  const sheet = town.render(ctx);
  const recommend = byAttr(sheet, 'data-town-recommend', 'true')[0];
  assert.ok(recommend.firstChild, 'recommend list should have a row');
  const recRow = recommend.firstChild;
  assert.equal(recRow.getAttribute('data-town-recommend-id'), 'memory-flip.T1', 'live run should lead');
  const text = combinedText(sheet);
  assert.ok(text.includes('记忆翻牌：配好 3 组牌'), 'text=' + text);
  assert.ok(text.includes('路线进展'), 'text=' + text);
  assert.ok(text.includes('继续这张单'), 'text=' + text);
  assert.ok(text.includes('旧档案夹'), 'text=' + text);
  const free = byAttr(sheet, 'data-town-free', 'true')[0];
  assert.equal(free.open, false);
  assert.equal(free.hidden, false);
  assert.equal(byAttr(free, 'data-town-action', 'start').length, 1, '自由接单只剩未推荐的一张');
  assert.equal(ctx.__calls.recommend[0].availableIds.length, 3);
  assert.ok(!win.navigated);
  return 'recommend=1, free collapsed';
});
check('推荐卡同时提供 data-town-recommend-kind 与 data-town-kind，值与文案一致', () => {
  const { town } = loadTown();
  const ctx = basicCtx();
  delete ctx.commission.continuations;
  const sheet = town.render(ctx);
  const rec = byAttr(sheet, 'data-town-recommend', 'true')[0].firstChild;
  assert.equal(rec.getAttribute('data-town-recommend-kind'), '推进本章');
  assert.equal(rec.getAttribute('data-town-kind'), '推进本章');
  assert.ok(rec.textContent.includes('推进本章'), '属性与可见文案一致，未改文案');
  const ctx2 = basicCtx();
  delete ctx2.commission.continuations;
  ctx2.campaign.recommend = () => ({ commissionId: 'pendulum-tower.T1', goal: 'x', reason: 'y', kind: 'step' });
  const rec2 = byAttr(town.render(ctx2), 'data-town-recommend', 'true')[0].firstChild;
  assert.equal(rec2.getAttribute('data-town-recommend-kind'), '路线进展');
  assert.equal(rec2.getAttribute('data-town-kind'), '路线进展');
  return 'both kind attributes present';
});
check('推荐卡 goal 用真实世界目标，不重复委托标题', () => {
  const { town } = loadTown();
  const ctx = basicCtx();
  delete ctx.commission.continuations;
  ctx.campaign.recommend = () => ({
    commissionId: 'pendulum-tower.T1',
    goal: '港口实习',
    reason: '阿砾等这份航报',
    kind: 'milestone',
  });
  const sheet = town.render(ctx);
  const row = byAttr(sheet, 'data-town-recommend-id', 'pendulum-tower.T1')[0];
  const text = combinedText(row);
  assert.ok(text.includes('稳稳叠到 4 层'), '应显示 objective.atLeast 世界目标：' + text);
  assert.equal((text.match(/稳稳叠到 4 层/g) || []).length, 1, '目标文本只出现一次：' + text);
  assert.ok(text.includes('层塔：'), '应显示游戏名：' + text);
  assert.equal(row.getAttribute('data-town-goal'), '层塔：稳稳叠到 4 层', 'data-town-goal 保留完整目标');
  assert.ok(!text.includes('这一单要做：港口实习'), '不得把标题当目标：' + text);
  assert.ok(!/这一单要做：[^：]*实习/.test(text));
  assert.ok(text.includes('推进本章') && text.includes('阿砾等这份航报'), '理由/推进标记保留');
  assert.ok(byAttr(row, 'data-town-recommend-start', 'true').length === 1, '主动作保留');
  return 'world goal with count, reason and action';
});
check('无 live run 时推荐卡显示 campaign.recommend 的游戏名/目标/推进本章/理由', () => {
  const { win, town } = loadTown();
  const ctx = basicCtx();
  delete ctx.commission.continuations;
  const sheet = town.render(ctx);
  const rec = byAttr(sheet, 'data-town-recommend', 'true')[0];
  const row = rec.firstChild;
  assert.equal(row.getAttribute('data-town-recommend-id'), 'pendulum-tower.T1');
  const text = combinedText(row);
  assert.ok(text.includes('层塔：稳稳叠到 4 层'), 'text=' + text);
  assert.ok(text.includes('推进本章'), 'text=' + text);
  assert.ok(text.includes('这一单要做：层塔：稳稳叠到 4 层'), 'text=' + text);
  assert.ok(text.includes('做完港里会把你记成在册自由职业者'), 'text=' + text);
  assert.ok(!win.navigated);
  return 'campaign recommendation shown';
});
check('首航 intro 显示章节 role 身份一行，缺失时隐藏', () => {
  const ROLE = '你是刚到折光港、靠接零工维生的自由职业者';
  const { town } = loadTown();
  const ctx = basicCtx();
  ctx.campaign.state = () => ({
    ok: true,
    currentChapter: 'C0',
    chapters: [{ chapterId: 'C0', title: '不起眼的印记', state: 'active', role: ROLE, routes: [{ hint: '先接阿砾指定的那单。' }] }],
    endings: [],
  });
  const sheet = town.render(ctx);
  const roleLine = byAttr(sheet, 'data-town-role', 'true')[0];
  assert.ok(roleLine, '应有 role 行');
  assert.equal(roleLine.hidden, false);
  assert.equal(roleLine.textContent, ROLE);
  const text = combinedText(sheet);
  assert.ok(text.indexOf(ROLE) < text.indexOf('眼下：'), '身份在目标之前');
  assert.ok(text.indexOf(ROLE) < text.indexOf('租机'), '身份在免费租机提示之前');
  const ctx2 = basicCtx();
  const sheet2 = town.render(ctx2);
  const roleLine2 = byAttr(sheet2, 'data-town-role', 'true')[0];
  assert.equal(roleLine2.hidden, true, '缺 role 字段时隐藏');
  assert.ok(!combinedText(sheet2).includes('自由职业者'), '不写死玩家状态');
  return 'role line shown/hidden by data';
});
check('C0/C1 首航弱化商店/制造台入口但保留可发现性', () => {
  const { town } = loadTown();
  const sheet = town.render(basicCtx());
  const more = byAttr(sheet, 'data-town-more', 'true')[0];
  assert.ok(more, '应有港口其它去处折叠区');
  assert.equal(more.open, false, '默认收起');
  assert.ok(more.textContent.includes('材料商店') && more.textContent.includes('制造台'), '两入口仍可发现');
  const footer = byClass(sheet, 'ac-career-town__footer')[0];
  const directStarts = byAttr(footer, 'data-town-action', 'start');
  assert.equal(directStarts.length, 0);
  assert.ok(more.textContent.includes('港口其它去处'));
  return 'economy collapsed but discoverable';
});
check('玩家可见文案无 C 码/active/locked/长 token/96 条重复时长', () => {
  const { town } = loadTown();
  const text = combinedText(town.render(basicCtx()));
  for (const forbidden of ['C0', 'C1', 'C2', 'active', 'locked', 'durationHint', '约 2–5 分钟', 'E-C1', 'runId']) {
    assert.ok(!text.includes(forbidden), '不应出现 ' + forbidden);
  }
  return 'text clean';
});
check('推荐缺接口时安全回退旧列表', () => {
  const { town } = loadTown();
  const ctx = basicCtx();
  delete ctx.campaign.recommend;
  delete ctx.commission.continuations;
  const sheet = town.render(ctx);
  assert.equal(byAttr(sheet, 'data-town-recommend', 'true')[0].hidden, true, 'attrs=' + JSON.stringify(byAttr(sheet, 'data-town-recommend', 'true')[0].attrs) + ' children=' + byAttr(sheet, 'data-town-recommend', 'true')[0].childNodes.length);
  assert.ok(byAttr(sheet.querySelector('[data-town-free]'), 'data-commission-id', 'pendulum-tower.T1').length >= 1);
  return 'fallback rows ok';
});
check('推荐 id 不在真实 unlocked 集合时不被采纳', () => {
  const { town } = loadTown();
  const ctx = basicCtx();
  ctx.commission.listAvailable = () => ({ ok: true, list: ['memory-flip.T1'] });
  delete ctx.commission.continuations;
  ctx.campaign.recommend = () => ({ commissionId: 'pendulum-tower.T1', goal: 'x', reason: 'y', kind: 'milestone' });
  const rec = byAttr(town.render(ctx), 'data-town-recommend', 'true')[0];
  assert.equal(rec.hidden, true, 'attrs=' + JSON.stringify(rec.attrs) + ' children=' + rec.childNodes.length);
  return 'locked suggestion rejected';
});

check('K-town: Tab/Shift+Tab 仅遍历可见焦点，闭合 details 内的按钮被排除', () => {
  const { doc, town } = loadTown();
  const ctx = basicCtx();
  const opened = town.open(ctx);
  assert.equal(opened.ok, true);
  const sheet = opened.panel;
  const focusables = Array.from(sheet.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter((node) => !node.disabled && !node.hidden && node.getClientRects().length > 0);
  const workshop = focusables.filter((node) => node.getAttribute('data-town-action') === 'workshop');
  assert.equal(workshop.length, 0, '闭合 details 的制造台不可聚焦');
  const market = focusables.filter((node) => node.getAttribute('data-town-action') === 'market');
  assert.equal(market.length, 0, '闭合 details 的材料商店不可聚焦');
  const more = byAttr(sheet, 'data-town-more', 'true')[0];
  more.open = true;
  const openedFocusables = Array.from(sheet.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter((node) => !node.disabled && !node.hidden && node.getClientRects().length > 0);
  assert.ok(openedFocusables.some((node) => node.getAttribute('data-town-action') === 'workshop'), '展开后可聚焦制造台');
  more.open = false;
  town.close();
  return 'closed details excluded, open details included';
});
check('稳定推荐接单选择器：唯一、绑定 commissionId、点击走 commission.start', () => {
  const { win, town } = loadTown();
  const ctx = basicCtx();
  const sheet = town.render(ctx);
  const starts = byAttr(sheet, 'data-town-recommend-start', 'true');
  assert.equal(starts.length, 1, '只有一个推荐接单按钮');
  const button = starts[0];
  assert.equal(button.getAttribute('data-town-action'), 'start');
  assert.equal(button.getAttribute('data-commission-id'), 'memory-flip.T1');
  const recommendRow = byAttr(sheet, 'data-town-recommend-id', 'memory-flip.T1')[0];
  assert.equal(recommendRow.getAttribute('data-commission-id'), 'memory-flip.T1');
  const freeRows = byAttr(sheet.querySelector('[data-town-free-list]'), 'data-commission-id', 'memory-flip.T1');
  assert.equal(freeRows.length, 0, '推荐单不重复出现在自由列表');
  button.emit('click', { target: button });
  assert.equal(ctx.__calls.start.length, 1);
  assert.equal(ctx.__calls.start[0].commissionId, 'memory-flip.T1');
  assert.equal(win.navigated, 'games/pendulum-tower.html?ticket=run-test');
  return 'stable selector click -> start';
});
async function runAsyncChecks() {
  async function acheck(name, fn) {
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail: detail || '' });
    } catch (err) {
      results.push({ name, ok: false, detail: (err && err.message) || String(err) });
    }
  }

  await acheck('continuations 只把 issued/active 的真实委托做成「继续这张单」，排除 ending.*', async () => {
    const { win, town } = loadTown();
    const ctx = basicCtx();
    const sheet = town.render(ctx);
    await Promise.resolve();
    const continuing = byAttr(sheet, 'data-town-continuing', 'true');
    assert.equal(continuing.length, 1);
    assert.equal(continuing[0].getAttribute('data-commission-id'), 'memory-flip.T1');
    assert.ok(continuing[0].textContent.includes('继续这张单'));
    assert.equal(byAttr(sheet, 'data-commission-id', 'ending.combat').length, 0);
    continuing[0].emit('click', { target: continuing[0] });
    assert.equal(ctx.__calls.start.length, 1);
    assert.equal(ctx.__calls.start[0].commissionId, 'memory-flip.T1');
    assert.equal(ctx.__calls.start[0].careerId, 'career-test-1');
    assert.equal(win.navigated, 'games/pendulum-tower.html?ticket=run-test');
    return 'continue -> commission.start';
  });

  await acheck('未解锁的 live run 只显示锁定态，不提供继续按钮', async () => {
    const { town } = loadTown();
    const ctx = basicCtx();
    ctx.commission.listAvailable = () => ({ ok: true, list: ['pendulum-tower.T1'] });
    const sheet = town.render(ctx);
    await Promise.resolve();
    assert.equal(byAttr(sheet, 'data-town-continuing', 'true').length, 0, 'locked live run 不得有继续按钮');
    const lockedRows = byClass(sheet, 'ac-career-town__row')
      .filter((row) => row.getAttribute('data-commission-id') === 'memory-flip.T1');
    const anyContinueForLocked = byAttr(sheet, 'data-town-continuing', 'true')
      .filter((node) => node.getAttribute('data-commission-id') === 'memory-flip.T1');
    assert.equal(anyContinueForLocked.length, 0, 'locked live run 不得有继续按钮');
    const startForLocked = byAttr(sheet, 'data-town-action', 'start')
      .filter((node) => node.getAttribute('data-commission-id') === 'memory-flip.T1');
    assert.equal(startForLocked.length, 0, 'locked live run 不得可点');
    const retryForLocked = byAttr(sheet, 'data-town-action', 'retry')
      .filter((node) => node.getAttribute('data-commission-id') === 'memory-flip.T1');
    assert.equal(retryForLocked.length, 0, 'locked live run 不得重接');
    return 'locked live run has no continue/start/retry';
  });

  await acheck('continuations ok:false 保留 unlocked 列表并给出非阻塞提示', async () => {
    const { town } = loadTown();
    const ctx = basicCtx();
    ctx.commission.continuations = () => ({ ok: false, reason: 'db-unavailable', runs: [] });
    const sheet = town.render(ctx);
    await Promise.resolve();
    assert.ok(byClass(sheet, 'ac-career-town__row').length >= 3, '列表保留');
    const status = byClass(sheet, 'ac-career-status')[0];
    assert.ok(status && status.hidden === false, '应给出非阻塞状态');
    assert.ok(status.textContent.includes('进行中的单子'), 'status=' + status.textContent);
    assert.ok(!status.textContent.includes('db-unavailable'), '不暴露系统 reason');
    return 'ok:false surfaced';
  });

  await acheck('continuations 缺接口/失败时回退 unlocked 列表', async () => {
    const { town } = loadTown();
    const ctx = basicCtx();
    delete ctx.commission.continuations;
    const sheet = town.render(ctx);
    await Promise.resolve();
    assert.equal(byAttr(sheet, 'data-town-continuing', 'true').length, 0);
    assert.ok(byClass(sheet, 'ac-career-town__row').length >= 3);
    const ctx2 = basicCtx();
    ctx2.commission.continuations = () => Promise.reject(new Error('db down'));
    const sheet2 = town.render(ctx2);
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(byClass(sheet2, 'ac-career-town__row').length >= 3);
    return 'fallback ok';
  });

  await acheck('失败优先展示结果明确说明，并提供一键重接/回告示板', async () => {
    const { town } = loadTown();
    const ctx = basicCtx();
    ctx.commission.start = (input) => { ctx.__calls.start.push(input); return { ok: false, reason: 'quest-write-failed', message: '钱已扣、旗标未记；请重试同一代办以补记。', retryable: true }; };
    const sheet = town.render(ctx);
    await Promise.resolve();
    const startBtn = byAttr(sheet, 'data-town-action', 'start')
      .filter((node) => node.getAttribute('data-commission-id') === 'memory-flip.T1')[0];
    assert.ok(startBtn, '应有 memory-flip.T1 的接单按钮');
    startBtn.emit('click', { target: startBtn });
    await Promise.resolve();
    assert.ok(combinedText(sheet).includes('钱已扣、旗标未记'));
    const retry = byAttr(sheet, 'data-town-action', 'retry');
    assert.ok(retry.length >= 1);
    assert.equal(byAttr(sheet, 'data-town-action', 'back-to-board')[0].hidden, false);
    retry[0].emit('click', { target: retry[0] });
    assert.equal(ctx.__calls.start.length, 2);
    return 'explicit failure + retry + back';
  });

  await acheck('异步 getWallet 不破坏面板；未知失败 reason 使用兜底文案', async () => {
    const { town } = loadTown();
    const ctx = basicCtx();
    ctx.commission.getWallet = () => Promise.resolve({ ok: true, credits: 240, items: { alloy: 2 } });
    const sheet = town.render(ctx);
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(combinedText(sheet).includes('工钱 240'));
    const ctx2 = basicCtx();
    ctx2.commission.getWallet = () => Promise.reject(new Error('no db'));
    ctx2.commission.start = () => ({ ok: false, reason: 'totally-unknown' });
    const sheet2 = town.render(ctx2);
    await Promise.resolve();
    await Promise.resolve();
    const startBtn2 = byAttr(sheet2, 'data-town-action', 'start')[0];
    assert.ok(startBtn2, '失败用例应有接单按钮');
    startBtn2.emit('click', { target: startBtn2 });
    await Promise.resolve();
    assert.ok(combinedText(sheet2).includes('这次没接上'));
    return 'async wallet safe; unknown reason fallback';
  });

  await acheck('重复 open 不抢焦点；Esc 关闭后焦点归还打开前元素', async () => {
    const { doc, town } = loadTown();
    const before = doc.createElement('button');
    doc.body.appendChild(before);
    before.focus();
    const opened = town.open(basicCtx());
    assert.equal(opened.ok, true);
    const active = doc.activeElement;
    assert.ok(active && active.getAttribute('aria-label') === '收起告示板');
    town.open(basicCtx());
    assert.equal(doc.activeElement, active);
    doc.emit('keydown', { key: 'Escape', keyCode: 27, preventDefault() {} });
    assert.equal(doc.activeElement, before);
    assert.equal(town.close(), false);
    return 'focus safe';
  });

  await acheck('静态样式：44px 热区，无远程资源与根路径', async () => {
    assert.ok(source.includes('min-height: 44px'));
    assert.ok(!/url\(|@import|https?:\/\/|\/assets\//.test(source));
    assert.ok(!/function walletCreditsOf|function shipPriceOf|walletCreditsOf\(/.test(source));
    return 'style/static clean';
  });
}

await runAsyncChecks();

for (const entry of results) {
  console.log((entry.ok ? 'PASS' : 'FAIL') + ' ' + entry.name + (entry.detail ? ' — ' + entry.detail : ''));
}
const failed = results.filter((entry) => !entry.ok).length;
console.log('TOTAL ' + results.length + ' / PASS ' + (results.length - failed) + ' / FAIL ' + failed);
if (failed) process.exitCode = 1;
