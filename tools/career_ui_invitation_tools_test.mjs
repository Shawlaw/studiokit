#!/usr/bin/env node
/**
 * T06b 统一披露 UI 门禁（纯 Node，不启动 Chrome / watch / full / build）。
 * 运行：node tools/career_ui_invitation_tools_test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const src = {
  mailbox: read('apps/arcade/career/ui/mailbox.js'),
  receipt: read('apps/arcade/career/ui/receipt.js'),
  hangar: read('apps/arcade/career/ui/hangar.js'),
  market: read('apps/arcade/career/ui/market.js'),
  workshop: read('apps/arcade/career/ui/workshop.js'),
  settings: read('apps/arcade/career/ui/settings.js'),
  index: read('apps/arcade/index.html'),
};

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log('PASS ' + name); }
  else { failures.push(name + (detail === undefined ? '' : ' | ' + JSON.stringify(detail))); console.log('FAIL ' + name + (detail === undefined ? '' : ' | ' + JSON.stringify(detail))); }
}
const hasEnsureTrue = (text) => /listAvailable\(\{\s*ensure:\s*true\s*\}/.test(text);
async function drain() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }

/* ---------------- 静态契约 ---------------- */
check('mailbox 不调用 commission.start', !/commission\.start|\.start\(\{\s*commissionId/.test(src.mailbox));
check('receipt 删除 ensure:true 兜底', !hasEnsureTrue(src.receipt));
for (const key of ['hangar', 'market', 'workshop']) {
  check(key + ' 删除 ensure:true 兜底', !hasEnsureTrue(src[key]));
  check(key + ' 消费 careerView 对应 surface', /reader\.call\(context, \{ surface: '(tools|shop|crafting)' \}\)/.test(src[key]));
}
check('market 不再扫描全游戏来源', !/GAME_LABELS|sourceGames|registry\.getGame|materials\.sourcesFor/.test(src.market));
check('market 使用通用地点文案', src.market.includes('来路：旧港工作点或材料商店可取得'));
check('receipt 不再读未 gate 的 storyFeedback.nextStep', !/raw\.nextStep|storyFeedback\.nextStep\)\s*\|\|/.test(src.receipt));
check('receipt 只从投影读取下一步与经历', /projectedStoryOf/.test(src.receipt) && /story\.history/.test(src.receipt));
check('settings 导入成功才触发失效', /mode !== 'none' && result\.preserved !== true\) notifyCareerDataChanged\(context, 'import'\)/.test(src.settings));
check('settings 封存/解冻/重置触发失效',
  src.settings.includes("notifyCareerDataChanged(context, expectedArchived ? 'archive' : 'unarchive')") &&
  src.settings.includes("notifyCareerDataChanged(context, 'reset')"));
check('settings 订阅仅在面板关闭时退订', /unsubscribeCareerChanges/.test(src.settings));
check('中心页仍零 bridge 首屏装载', !/script[^>]+career\/bridge\.js/.test(src.index.slice(0, src.index.indexOf('function render()'))));
check('中心页无生涯视图/默认视图字段', !/data-career-view|hallDefaultView|data-default-view/.test(src.index));
check('0.22 未引入 prototype 全局 token', !/prototype\/tokens\.css|--gold-light/.test(Object.values(src).join('\n')));

/* ---------------- 工具投影逐项 gate ---------------- */
function loadToolGate(source, view) {
  const start = source.indexOf('  function ensureToolIntroduced(');
  const end = source.indexOf('\n  function readWalletState(', start);
  if (start < 0 || end < 0) throw new Error('ensureToolIntroduced helper not found');
  const sandbox = {
    Promise,
    isObject: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
    isLive: () => true,
    renderAll() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end) + '\nthis.helper = ensureToolIntroduced;', sandbox, { filename: 'tool-gate' });
  const state = { careerId: 'career-test', toolIntroduced: false };
  const context = { careerView: () => view };
  return sandbox.helper({}, 1, context, state).then(() => state.toolIntroduced);
}
const allTools = { tools: [{ toolId: 'wallet' }, { toolId: 'shop' }, { toolId: 'workshop' }, { toolId: 'hangar' }] };
const shopOnly = { tools: [{ toolId: 'shop' }] };
const emptyTools = { tools: [] };
for (const [key, toolId] of [['hangar', 'hangar'], ['market', 'shop'], ['workshop', 'workshop']]) {
  check(toolId + ' 投影含自身时解锁', await loadToolGate(src[key], allTools) === true);
  check('只有 shop 时 ' + toolId + (toolId === 'shop' ? ' 可操作' : ' 保持锁定'),
    await loadToolGate(src[key], shopOnly) === (toolId === 'shop'));
  check(toolId + ' 空工具列表保持锁定', await loadToolGate(src[key], emptyTools) === false);
  check(toolId + ' 空投影保持锁定', await loadToolGate(src[key], null) === false);
}

/* ---------------- mailbox 行为（最小 DOM 桩） ---------------- */
class Node {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.doc = doc; this.className = ''; this._text = '';
    this.children = []; this.parentNode = null; this.hidden = false; this.disabled = false;
    this.id = ''; this.type = ''; this.attrs = Object.create(null); this.listeners = Object.create(null);
    const self = this;
    this.classList = {
      add(name) { if (!self.className.split(/\s+/).includes(name)) self.className += (self.className ? ' ' : '') + name; },
      remove() {}, contains(name) { return self.className.split(/\s+/).includes(name); },
    };
  }
  set textContent(v) { this._text = String(v ?? ''); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.children.push(n); return n; }
  removeChild(n) { const i = this.children.indexOf(n); if (i >= 0) this.children.splice(i, 1); n.parentNode = null; return n; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener() {}
  dispatch(t, ev = {}) { (this.listeners[t] || []).slice().forEach((fn) => fn({ target: this, preventDefault() {}, stopPropagation() {}, ...ev })); }
  focus() { this.doc.activeElement = this; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  closest(sel) { const name = sel.replace(/^\[/, '').replace(/\]$/, ''); let n = this; while (n) { if (n.attrs[name] !== undefined || n.className.split(/\s+/).includes(name.replace(/^\./, ''))) return n; n = n.parentNode; } return null; }
  querySelectorAll(sel) {
    const out = [];
    const want = sel.split(',')[0].trim();
    const attr = /^\[([^\]=]+)(?:="([^"]*)")?\]$/.exec(sel);
    const cls = /^\.([\w-]+)$/.exec(sel);
    const walk = (n) => n.children.forEach((c) => {
      if (attr && attr[1] in c.attrs && (attr[2] === undefined || c.attrs[attr[1]] === attr[2])) out.push(c);
      else if (cls && c.className.split(/\s+/).includes(cls[1])) out.push(c);
      else if (!attr && !cls && c.tagName === want.toUpperCase()) out.push(c);
      walk(c);
    });
    walk(this); return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function makeDoc() {
  const d = { activeElement: null, listeners: Object.create(null) };
  d.body = new Node('body', d); d.body.isConnected = true;
  d.createElement = (tag) => new Node(tag, d);
  d.addEventListener = () => {}; d.removeEventListener = () => {};
  return d;
}
function loadMailbox(doc) {
  const sandbox = { document: doc, console, Promise, Object, Array, String, Boolean, JSON, Math, Date, RegExp, Error };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox); vm.runInContext(src.mailbox, sandbox, { filename: 'mailbox.js' });
  return sandbox.ArcadeCareerUI.mailbox;
}
const clue = { clueId: 'c-letter', title: '原邀请', ambientText: '一封旧信', letter: { sender: '港务', body: '来信正文', address: '折光港', actionLabel: '按地址投递' } };
function inviteCtx(overrides = {}) {
  const events = [];
  const ctx = {
    state: { stage: 'LOCAL', clues: { 'c-letter': { seenAt: '2026-11-27T00:00:00Z' } }, firstClueId: 'c-letter' },
    clues: [clue], openClue() {}, announce() {}, openTown() { events.push('openTown'); },
    invitationForClue() { return { professionId: 'research.archivist', gameId: 'memory-flip', displayName: '档案分析员', state: 'read', canAccept: true }; },
    careerView: () => Promise.resolve({ schemaVersion: 1, professions: [], commissions: [], story: {}, tools: [] }),
    api: {
      acceptProfessionInvitation(input) { events.push(['accept', input.professionId, input.gameId]); return Promise.resolve({ ok: true }); },
      commission: { start() { events.push('commission.start'); return { ok: true }; } },
    },
    _events: events,
    ...overrides,
  };
  return ctx;
}
const btn = (doc, action) => doc.body.querySelector('[data-career-panel]').querySelectorAll('button').find((b) => b.getAttribute('data-action') === action) || null;
const textOf = (doc) => doc.body.querySelector('[data-career-panel]')?.textContent || '';


{
  const doc = makeDoc(); const api = loadMailbox(doc); const ctx = inviteCtx();
  api.open(ctx); await drain();
  check('已读未接受只显示接受邀请', !!btn(doc, 'accept-invitation') && !btn(doc, 'accept-invitation').hidden);
  check('已读未接受保留以后再说', !!btn(doc, 'defer-invitation') && !btn(doc, 'defer-invitation').hidden);
  check('邀请态隐藏旧投递与港口动作', btn(doc, 'send-to-port')?.hidden !== false && btn(doc, 'open-town')?.hidden !== false);
  check('邀请态不显示任务标题/目标/报酬', !/报酬|目标|commission\.|memory-flip\.T1/.test(textOf(doc)));
  const accept = btn(doc, 'accept-invitation');
  accept.dispatch('click'); await drain();
  check('接受只调用受控 acceptProfessionInvitation 一次', ctx._events.filter((e) => Array.isArray(e) && e[0] === 'accept').length === 1, ctx._events);
  check('接受不调用 commission.start', !ctx._events.includes('commission.start'));
  accept.dispatch('click'); await drain();
  check('重复点击 no-op', ctx._events.filter((e) => Array.isArray(e) && e[0] === 'accept').length === 1);
  check('成功后显示邀请已收下', textOf(doc).includes('邀请已收下'));
  api.close();
}

{
  const doc = makeDoc(); const api = loadMailbox(doc);
  const ctx = inviteCtx({
    careerView: () => Promise.resolve({ schemaVersion: 1, originGameId: 'memory-flip', professions: [{ professionId: 'research.archivist', state: 'accepted' }], story: {}, tools: [] }),
    chapter: { role: '首次身份句' },
  });
  api.open(ctx); await drain();
  const role = doc.body.querySelector('.ac-career-letter__role');
  check('第二职业不显示首次身份句', !!role && role.hidden === true, role && role.textContent);
  check('第二职业仍显示邀请与以后再说', !btn(doc, 'accept-invitation').hidden && !btn(doc, 'defer-invitation').hidden);
  api.close();
}

if (failures.length) {
  console.error('FAILED ' + failures.length + ': ' + failures.join('; '));
  process.exit(1);
}
console.log('T06b UI checks passed: ' + pass + '/' + pass);
