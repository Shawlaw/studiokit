#!/usr/bin/env node
/**
 * 生涯首航 V2 邮箱流程纯 Node 测试（无需 Chrome / IndexedDB）。
 *
 * 用最小 DOM 桩在 vm 中加载真实 apps/arcade/career/ui/mailbox.js，断言：
 *  1. 首次未投递信（GLIMPSED / CURIOUS，含 read-undelivered）只有一个主动作
 *     「送去折光港」；旧的「按地址投递 · 去港口」与章节入口同时隐藏，
 *     不出现两个“按地址投递”语义按钮。
 *  2. 点击后先调用 followLetter()，严格成功（ok===true && persisted!==false）
 *     后才调用 openTown()，且只调用一次；成功后信箱收起、告示板接管。
 *  3. 多条线索只认 state.firstClueId（缺失才用按 seenAt 排序的首条）；
 *     选中其他线索 / LOCAL / 已投递（回看）都回到旧路径，保留章节入口。
 *  4. 无 openTown 时安全回退：不进入首读流程，沿用既有「按地址投递」逻辑。
 *  5. 失败可见且不打开告示板；再次点击可重试（不残留 disabled/aria-busy）。
 *  6. 异步竞态：投递中重复点击、关闭再重开都不发第二次 followLetter；
 *     旧面板的异步结果不会污染新面板；await resolve 后才打开告示板。
 *  7. 首封未投递信显示可选身份句（ctx.chapter.role 优先，回退 ctx.chapters.C0.role），
 *     缺省/非字符串/回看/已投递/切换线索时隐藏，位置在 sender/body 之前，不新增弹窗。
 *  8. 44px 主类 / aria-label / data-action / 焦点 / Esc / reduced-motion 标记。
 *
 * 运行：node tools/career_mailbox_flow_test.mjs
 * 退出码：0 = 全 PASS；1 = 有 FAIL；2 = 用法错误 / 产品文件缺失。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MAILBOX_REL = 'apps/arcade/career/ui/mailbox.js';
const MAILBOX_ABS = path.join(ROOT, MAILBOX_REL);

if (process.argv.slice(2).length > 0) {
  console.error('usage: node tools/career_mailbox_flow_test.mjs（不接受参数）');
  process.exit(2);
}
if (!fs.existsSync(MAILBOX_ABS)) {
  console.error('missing product file: ' + MAILBOX_REL);
  process.exit(2);
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

/* ------------------------------------------------------------------ *
 * 最小 DOM 桩：只实现 mailbox.js 用到的节点/事件接口
 * ------------------------------------------------------------------ */

let docSeq = 0;
class StubNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.className = '';
    this._text = '';
    this.children = [];
    this.parentNode = null;
    this.hidden = false;
    this.disabled = false;
    this.id = '';
    this.type = '';
    this._attrs = Object.create(null);
    this._listeners = Object.create(null);
    this._doc = null;
    this.isConnected = false;
    const self = this;
    this.classList = {
      add(name) {
        const parts = String(self.className).split(/\s+/).filter(Boolean);
        if (parts.indexOf(name) < 0) parts.push(name);
        self.className = parts.join(' ');
      },
      remove(name) {
        self.className = String(self.className).split(/\s+/).filter((p) => p && p !== name).join(' ');
      },
      contains(name) { return String(self.className).split(/\s+/).indexOf(name) >= 0; },
    };
  }
  get textContent() { return this._text; }
  set textContent(value) {
    this._text = value === null || value === undefined ? '' : String(value);
    this.children = [];
  }
  setAttribute(name, value) { this._attrs[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null; }
  removeAttribute(name) { delete this._attrs[name]; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name); }
  appendChild(node) {
    if (node.parentNode && node.parentNode.children) {
      const i = node.parentNode.children.indexOf(node);
      if (i >= 0) node.parentNode.children.splice(i, 1);
    }
    node.parentNode = this;
    this.children.push(node);
    node.isConnected = !!(this.isConnected || this === this._doc.body);
    return node;
  }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) this.children.splice(i, 1);
    node.parentNode = null;
    node.isConnected = false;
    return node;
  }
  insertBefore(node, ref) {
    if (node.parentNode && node.parentNode.children) {
      const old = node.parentNode.children.indexOf(node);
      if (old >= 0) node.parentNode.children.splice(old, 1);
    }
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at >= 0) this.children.splice(at, 0, node);
    else this.children.push(node);
    node.parentNode = this;
    return node;
  }
  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners[type] || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  dispatch(type, event) {
    const list = (this._listeners[type] || []).slice();
    const ev = Object.assign({ target: this, preventDefault() {} }, event || {});
    list.forEach((fn) => fn(ev));
  }
  focus() { if (this._doc) this._doc.activeElement = this; }
  getClientRects() { return this.hidden ? [] : [{ width: 100, height: 48 }]; }
  getBoundingClientRect() { return { width: 100, height: 48, left: 0, top: 0, right: 100, bottom: 48 }; }
  closest(selector) {
    let node = this;
    const want = selector.replace(/^\[/, '').replace(/\]$/, '');
    while (node) {
      if (node.hasAttribute && node.hasAttribute(want)) return node;
      if (node.className && String(node.className).split(/\s+/).indexOf(selector.replace(/^\./, '')) >= 0) return node;
      node = node.parentNode;
    }
    return null;
  }
  querySelectorAll(selector) {
    const out = [];
    const want = selector.split(',')[0].trim();
    const byAttr = /^\[([^\]=]+)(?:="([^"]*)")?\]$/.exec(want);
    const byClass = /^\.([\w-]+)$/.exec(want);
    const walk = (node) => {
      node.children.forEach((child) => {
        if (byAttr && child.hasAttribute && child.hasAttribute(byAttr[1]) &&
            (byAttr[2] === undefined || child.getAttribute(byAttr[1]) === byAttr[2])) out.push(child);
        else if (byClass && typeof child.className === 'string' && child.className.split(/\s+/).indexOf(byClass[1]) >= 0) out.push(child);
        else if (!byAttr && !byClass && child.tagName === want.toUpperCase()) out.push(child);
        walk(child);
      });
    };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

class StubDocument {
  constructor() {
    this._seq = 0;
    this.body = new StubNode('body');
    this.body._doc = this;
    this.body.isConnected = true;
    this.activeElement = null;
    this._listeners = Object.create(null);
  }
  createElement(tag) {
    const node = new StubNode(tag);
    node._doc = this;
    node._id = ++this._seq + '-' + (++docSeq);
    return node;
  }
  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners[type] || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  dispatch(type, event) {
    (this._listeners[type] || []).slice().forEach((fn) => fn(Object.assign({ preventDefault() {} }, event || {})));
  }
}

function loadMailbox(doc) {
  const code = fs.readFileSync(MAILBOX_ABS, 'utf8');
  const sandbox = { document: doc, console, Promise, Object, Array, String, Boolean, JSON, Math, Date, RegExp, Error };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: MAILBOX_REL });
  return sandbox.ArcadeCareerUI.mailbox;
}

const CLUE_A = { clueId: 'c-first', title: '第一封', letter: { sender: '港务', body: '送回旧港', address: '折光港 1 号', actionLabel: '按地址投递' } };
const CLUE_B = { clueId: 'c-later', title: '第二封', letter: { sender: '阿砾', body: '再来一封', address: '折光港 2 号', actionLabel: '按地址投递' } };

function makeCtx(overrides) {
  const stage = overrides && overrides.stage !== undefined ? overrides.stage : 'GLIMPSED';
  const firstClueId = overrides && overrides.firstClueId !== undefined ? overrides.firstClueId : 'c-first';
  const clues = overrides && overrides.clues ? overrides.clues : [CLUE_A, CLUE_B];
  const records = overrides && overrides.records ? overrides.records : { 'c-first': { seenAt: '2026-11-25T00:00:00Z' }, 'c-later': { seenAt: '2026-11-25T01:00:00Z' } };
  const events = [];
  const ctx = {
    state: { stage: stage, firstClueId: firstClueId, clues: records, lastClueId: 'c-first' },
    clues: clues,
    openClue(id) { events.push(['openClue', id]); },
    announce(text) { events.push(['announce', text]); },
    followLetter() {
      events.push(['followLetter']);
      return overrides && overrides.followResult !== undefined ? overrides.followResult : { ok: true, persisted: true };
    },
    openTown() {
      events.push(['openTown']);
      return overrides && overrides.townResult !== undefined ? overrides.townResult : { ok: true };
    },
    openCampaign() { events.push(['openCampaign']); return { ok: true }; },
    reducedMotion: !!(overrides && overrides.reducedMotion),
    _events: events,
  };
  if (overrides && overrides.chapter !== undefined) ctx.chapter = overrides.chapter;
  if (overrides && overrides.chapters !== undefined) ctx.chapters = overrides.chapters;
  if (overrides && overrides.noOpenTown) delete ctx.openTown;
  if (overrides && overrides.noFollowLetter) delete ctx.followLetter;
  if (overrides && overrides.clueId) ctx.clueId = overrides.clueId;
  if (overrides && overrides.followedClueIds) ctx.followedClueIds = overrides.followedClueIds;
  return ctx;
}

function fresh() {
  const doc = new StubDocument();
  const api = loadMailbox(doc);
  return { doc: doc, api: api };
}

function panelOf(doc) {
  return doc.body.querySelector('[data-career-panel]');
}
function allButtons(doc) {
  return panelOf(doc).querySelectorAll('button');
}
function findButton(doc, predicate) {
  return allButtons(doc).find(predicate) || null;
}
function sendBtn(doc) {
  return findButton(doc, (b) => b.getAttribute('data-action') === 'send-to-port');
}
function townBtn(doc) {
  return findButton(doc, (b) => b.getAttribute('data-action') === 'open-town');
}
function campaignBtn(doc) {
  return findButton(doc, (b) => b.getAttribute('data-action') === 'open-campaign');
}
function statusOf(doc) {
  return panelOf(doc).querySelector('.ac-career-status');
}
function roleLine(doc) {
  return panelOf(doc).querySelector('.ac-career-letter__role');
}
function visible(node) {
  if (!node || node.hidden || node.disabled) return false;
  if (node.closest && node.closest('[hidden]')) return false;
  return node.getClientRects().length > 0;
}

/* ------------------------------------------------------------------ *
 * 场景 1-3：首读单一主动作与阶段/多线索判定
 * ------------------------------------------------------------------ */

for (const stage of ['GLIMPSED', 'CURIOUS']) {
  const { doc, api } = fresh();
  const ctx = makeCtx({ stage: stage });
  api.open(ctx);
  const send = sendBtn(doc);
  check('首读(' + stage + ')只有一个送去折光港主动作', !!send && visible(send) && send.getAttribute('aria-label') === '送去折光港' && send.textContent === '送去折光港', {
    text: send && send.textContent, aria: send && send.getAttribute('aria-label'), visible: visible(send),
  });
  check('首读(' + stage + ')旧去港口按钮隐藏', !!townBtn(doc) && townBtn(doc).hidden === true);
  check('首读(' + stage + ')章节入口隐藏', !!campaignBtn(doc) && campaignBtn(doc).hidden === true);
  check('首读(' + stage + ')不带重复按地址投递按钮', allButtons(doc).filter((b) => visible(b) && /按地址投递/.test(b.textContent)).length === 0);
  check('首读(' + stage + ')严格成功前不调用 openTown', ctx._events.filter((e) => e[0] === 'openTown').length === 0);
}

/* ------------------------------------------------------------------ *
 * 场景 1b：身份句（chapter.role / chapters.C0.role，feature detection）
 * ------------------------------------------------------------------ */

{
  const { doc, api } = fresh();
  const ctx = makeCtx();
  api.open(ctx);
  check('身份句缺省隐藏（无 chapter/chapters）', !!roleLine(doc) && roleLine(doc).hidden === true);
}

{
  const { doc, api } = fresh();
  const ctx = makeCtx({ chapter: { chapterId: 'C1', role: '刚到折光港、靠接零工维生的自由职业者' } });
  api.open(ctx);
  const line = roleLine(doc);
  check('chapter.role 在首封未投递信显示', !!line && !line.hidden && line.textContent === '刚到折光港、靠接零工维生的自由职业者', line && line.textContent);
  const children = panelOf(doc).querySelector('.ac-career-letter').children;
  const roleIndex = children.indexOf(line);
  const senderIndex = children.indexOf(panelOf(doc).querySelector('.ac-career-letter__sender'));
  const bodyIndex = children.indexOf(panelOf(doc).querySelector('.ac-career-letter__body'));
  check('身份句位于 sender/body 之前', roleIndex >= 0 && senderIndex > roleIndex && bodyIndex > roleIndex, { roleIndex, senderIndex, bodyIndex });
}

{
  const { doc, api } = fresh();
  const ctx = makeCtx({ chapters: { C0: { chapterId: 'C0', role: '旧港来信的收件人' }, C1: { role: '不该被用的一章' } } });
  api.open(ctx);
  const line = roleLine(doc);
  check('chapters.C0.role 回退显示（bridge 当前只有 chapter=chapter-01）', !!line && !line.hidden && line.textContent === '旧港来信的收件人', line && line.textContent);
}

{
  const { doc, api } = fresh();
  const ctx = makeCtx({
    chapter: { role: 'chapter 优先' },
    chapters: { C0: { role: 'C0 回退' } },
  });
  api.open(ctx);
  const line = roleLine(doc);
  check('chapter.role 优先于 chapters.C0.role', !!line && !line.hidden && line.textContent === 'chapter 优先', line && line.textContent);
}

{
  const { doc, api } = fresh();
  const ctx = makeCtx({ chapter: { role: 42 }, chapters: { C0: { role: null } } });
  api.open(ctx);
  check('非字符串/空 role 安全隐藏', !!roleLine(doc) && roleLine(doc).hidden === true);
}

{
  const { doc, api } = fresh();
  const ctx = makeCtx({ chapter: { role: '身份句' }, stage: 'LOCAL' });
  api.open(ctx);
  check('LOCAL 回看隐藏身份句', !!roleLine(doc) && roleLine(doc).hidden === true);
}
{
  const { doc, api } = fresh();
  const ctx = makeCtx({ chapter: { role: '身份句' }, followedClueIds: ['c-first'] });
  api.open(ctx);
  check('已投递回看隐藏身份句', !!roleLine(doc) && roleLine(doc).hidden === true);
}
{
  const { doc, api } = fresh();
  const ctx = makeCtx({ chapter: { role: '身份句' }, stage: 'CURIOUS', firstClueId: 'c-later', clueId: 'c-later' });
  api.open(ctx);
  panelOf(doc).querySelector('[data-clue-id="c-first"]').dispatch('click', {});
  check('切到非首封线索后隐藏身份句', !!roleLine(doc) && roleLine(doc).hidden === true);
}

{
  const { doc, api } = fresh();
  const ctx = makeCtx({ reducedMotion: true });
  api.open(ctx);
  const overlay = panelOf(doc);
  check('reduced-motion 标记保留', overlay.classList.contains('is-reduced-motion'));
  check('焦点落在关闭按钮', !!doc.activeElement && doc.activeElement.getAttribute('aria-label') === '收起信箱');
  doc.dispatch('keydown', { key: 'Escape', keyCode: 27 });
  check('Esc 关闭面板', !panelOf(doc));
  check('Esc 后焦点归还', !!doc.activeElement);
}

{
  const { doc, api } = fresh();
  const ctx = makeCtx({ stage: 'LOCAL' });
  api.open(ctx);
  check('LOCAL 回看无单一主动作', !sendBtn(doc));
  check('LOCAL 回看保留去港口与章节入口', !!townBtn(doc) && !townBtn(doc).hidden && !!campaignBtn(doc) && !campaignBtn(doc).hidden);
  check('LOCAL 回看主按钮为再看告示或内容动作', !!findButton(doc, (b) => /再看告示|按地址投递/.test(b.textContent) && visible(b)));
}

{
  const { doc, api } = fresh();
  const ctx = makeCtx({ followedClueIds: ['c-first'], stage: 'GLIMPSED' });
  api.open(ctx);
  check('已读未投递但会话已投递：不进入首读流程', !sendBtn(doc));
  check('已投递回看保留去港口与章节入口', !!townBtn(doc) && !townBtn(doc).hidden && !!campaignBtn(doc) && !campaignBtn(doc).hidden);
}

{
  const { doc, api } = fresh();
  const ctx = makeCtx({ noOpenTown: true });
  api.open(ctx);
  check('无 openTown 安全回退：不出现送去折光港', !sendBtn(doc));
  const legacy = findButton(doc, (b) => /按地址投递/.test(b.textContent) && visible(b));
  check('无 openTown 保留既有按地址投递动作', !!legacy);
}

{
  const { doc, api } = fresh();
  const ctx = makeCtx({ stage: 'CURIOUS', firstClueId: 'c-later', clueId: 'c-later' });
  api.open(ctx);
  const send = sendBtn(doc);
  check('多线索只认 firstClueId（非首条时当前选中线索进入首读）', !!send && visible(send));
  /* 切到非首封线索后，应回退到旧路径。 */
  const item = panelOf(doc).querySelector('[data-clue-id="c-first"]');
  item.dispatch('click', {});
  check('多线索切到非 firstClueId 后不出现单一主动作', !sendBtn(doc));
  check('多线索切到非 firstClueId 后恢复去港口入口', !!townBtn(doc) && !townBtn(doc).hidden);
}

/* ------------------------------------------------------------------ *
 * 场景 4：严格成功后自动打开告示板
 * ------------------------------------------------------------------ */

{
  const { doc, api } = fresh();
  const ctx = makeCtx();
  api.open(ctx);
  sendBtn(doc).dispatch('click', {});
  const kinds = ctx._events.map((e) => e[0]);
  check('首读点击先 followLetter 再 openTown', kinds.indexOf('followLetter') >= 0 && kinds.indexOf('openTown') > kinds.indexOf('followLetter') && kinds.filter((k) => k === 'openTown').length === 1, ctx._events);
  check('严格成功后信箱收起', !panelOf(doc));
}

/* ------------------------------------------------------------------ *
 * 场景 5：失败可见且可重试（含 persisted:false）
 * ------------------------------------------------------------------ */

for (const result of [{ ok: false }, { ok: true, persisted: false }, { ok: false, error: 'write-failed' }]) {
  const { doc, api } = fresh();
  const ctx = makeCtx({ followResult: result });
  api.open(ctx);
  sendBtn(doc).dispatch('click', {});
  const status = statusOf(doc);
  check('失败(' + JSON.stringify(result) + ')不打开告示板', ctx._events.filter((e) => e[0] === 'openTown').length === 0, ctx._events);
  check('失败(' + JSON.stringify(result) + ')显示可见提示', !!status && !status.hidden && /没能送出/.test(status.textContent), status && status.textContent);
  check('失败(' + JSON.stringify(result) + ')按钮可重试', !!sendBtn(doc) && !sendBtn(doc).disabled && !sendBtn(doc).hasAttribute('aria-busy'));
  /* 重试成功：改上下文返回值，再次点击。 */
  ctx.followLetter = () => { ctx._events.push(['followLetter']); return { ok: true, persisted: true }; };
  sendBtn(doc).dispatch('click', {});
  check('失败(' + JSON.stringify(result) + ')重试成功后打开告示板', ctx._events.filter((e) => e[0] === 'openTown').length === 1, ctx._events);
}

/* ------------------------------------------------------------------ *
 * 场景 6：异步竞态与重复点击
 * ------------------------------------------------------------------ */

{
  const { doc, api } = fresh();
  let resolveFollow;
  const pending = new Promise((resolve) => { resolveFollow = resolve; });
  const ctx = makeCtx({ followResult: pending });
  api.open(ctx);
  const first = sendBtn(doc);
  first.dispatch('click', {});
  check('异步投递中按钮禁用且 aria-busy', first.disabled === true && first.getAttribute('aria-busy') === 'true');
  first.dispatch('click', {});
  check('异步投递中重复点击不再发 followLetter', ctx._events.filter((e) => e[0] === 'followLetter').length === 1);

  /* 关闭并重开：新面板仍显示禁用的单一主动作。 */
  api.close();
  api.open(ctx);
  const reopened = sendBtn(doc);
  check('重开面板保持投递中禁用状态', !!reopened && reopened.disabled === true && reopened.getAttribute('aria-busy') === 'true' && visible(reopened) === false);
  const differentPanel = panelOf(doc);

  resolveFollow({ ok: true, persisted: true });
  await pending;
  await Promise.resolve();
  check('异步成功只发一次 followLetter', ctx._events.filter((e) => e[0] === 'followLetter').length === 1, ctx._events);
  check('旧面板的异步成功不污染重开面板（不自动打开告示板）', ctx._events.filter((e) => e[0] === 'openTown').length === 0 && panelOf(doc) === differentPanel, ctx._events);
}

{
  const { doc, api } = fresh();
  let rejectFollow;
  const pending = new Promise((resolve, reject) => { rejectFollow = reject; });
  const ctx = makeCtx({ followResult: pending });
  api.open(ctx);
  sendBtn(doc).dispatch('click', {});
  rejectFollow(new Error('network-ish'));
  await pending.catch(() => {});
  await Promise.resolve();
  const status = statusOf(doc);
  check('异步失败不打开告示板且显示提示', ctx._events.filter((e) => e[0] === 'openTown').length === 0 && !!status && !status.hidden);
}

/* ------------------------------------------------------------------ *
 * 场景 7：openTown 失败后回退信箱，可再次从去港口入口进入
 * ------------------------------------------------------------------ */

{
  const { doc, api } = fresh();
  const ctx = makeCtx({ townResult: { ok: false } });
  api.open(ctx);
  sendBtn(doc).dispatch('click', {});
  check('openTown 失败后信箱重新打开', !!panelOf(doc));
  const status = statusOf(doc);
  check('openTown 失败显示可见提示', !!status && !status.hidden);
  check('openTown 失败后保留去港口入口供重试', !!townBtn(doc) && !townBtn(doc).hidden);
}

console.log('----');
console.log('career_mailbox_flow_test: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
