#!/usr/bin/env node
/**
 * 生涯结算收据反馈门禁（V2 批次 1，纯 Node，不启动 Chrome）：
 * 收据必须等 recordFromReceipt 的真实结果后展示，并同时表达工作回报/
 * 剧情所得（玩家语言）/NPC 回应/新完成段落/下一步；失败如实显示；页内两个出口；
 * 玩家可见文案不得泄漏章节 token、证据 token 或长凭据号。
 *
 * 运行：node tools/career_receipt_feedback_test.mjs
 * 退出码：0 全过；1 有失败。
 */
import { deepStrictEqual, ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const receiptSource = readFileSync(resolve(root, 'apps/arcade/career/ui/receipt.js'), 'utf8');
const bridgeSource = readFileSync(resolve(root, 'apps/arcade/career/bridge.js'), 'utf8');

class Element {
  constructor(tag) {
    this.tagName = String(tag).toLowerCase();
    this.children = [];
    this.attributes = Object.create(null);
    this.listeners = Object.create(null);
    this.style = new Proxy({}, { set(target, key, value) { target[key] = value; return true; } });
    this.classList = { add() {}, remove() {}, contains: () => false };
    this.parentNode = null;
    this._text = '';
  }
  set className(value) { this.attributes.class = value; }
  get className() { return this.attributes.class || ''; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] || null; }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); node.parentNode = null; return node; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, event = {}) { (this.listeners[type] || []).forEach((fn) => fn({ preventDefault() {}, stopPropagation() {}, ...event })); }
  set textContent(value) { this._text = String(value); this.children.length = 0; }
  get textContent() { return this._text || this.children.map((child) => child.textContent).join(''); }
  querySelectorAll() { return []; }
  focus() {}
  getClientRects() { return [1]; }
}

function createDocument() {
  const body = new Element('body');
  return { body, createElement: (tag) => new Element(tag), addEventListener() {}, querySelectorAll: () => [] };
}

const uiContext = vm.createContext({ console });
vm.runInContext(receiptSource, uiContext, { filename: 'receipt.js' });
const receipt = uiContext.ArcadeCareerUI.receipt;

function findAll(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  node.children.forEach((child) => findAll(child, predicate, out));
  return out;
}
function buttons(node) { return findAll(node, (item) => item.tagName === 'button'); }
function byText(node, text) { return buttons(node).find((button) => button.textContent === text); }
function click(node) { node.dispatch('click'); }

let checks = 0;
function eq(actual, expected, label) { deepStrictEqual(actual, expected, label); checks += 1; }
function assert(value, label) { ok(value, label); checks += 1; }

function settledResult() {
  return { ok: true, receipt: { receiptId: 'commission-1', credits: 70, items: {}, txIds: ['tx-1'] } };
}

function storyFeedback(status) {
  return {
    status,
    discovered: status === 'unavailable' ? [] : ['异常航报'],
    replies: status === 'unavailable' ? [] : [{ name: '旧港口的来信', text: '信号不是坐标，是门牌号。' }],
    chapter: status === 'unavailable' ? null : { id: 'C1', title: '旧港的第一封信' },
    chapterCount: status === 'unavailable' ? 0 : 1,
    nextStep: status === 'unavailable' ? '' : '去告示板看看「谁留下了七号货柜」有什么新活儿。',
    unavailable: status === 'unavailable' ? '工钱已结，剧情这会儿没能记进账。' : '',
  };
}

function noInternalTokens(text) {
  return !/C[0-5]\b|E-[A-Za-z]|\bBP-|\bMAP-|\bDEC-|新内部token|FL-\d{4}/.test(text)
    && !/commission-[0-9a-f-]{8,}|tx-[0-9a-f-]{8,}/.test(text);
}

{
  uiContext.document = createDocument();
  let opened = 0;
  const card = receipt.show({
    result: settledResult(),
    reducedMotion: true,
    storyFeedback: storyFeedback('new'),
    openCampaign() { opened += 1; },
    openMailbox() { opened += 100; },
    api: { openTown() { opened += 1000; } },
  });
  const text = card.textContent;
  assert(text.includes('工钱：+70') || text.includes('工钱：70'), 'work reward shown');
  assert(text.includes('异常航报'), 'story gain in player language');
  assert(text.includes('旧港口的来信：信号不是坐标，是门牌号。'), 'npc reply shown');
  assert(text.includes('新完成的段落：旧港的第一封信'), 'new chapter title in player language');
  assert(text.includes('下一步：去告示板看看'), 'next step shown');
  assert(noInternalTokens(text), 'no internal chapter/evidence/token visible');
  assert(!text.includes('E-memory'), 'evidence token not shown');
  const continueBtn = byText(card, '读回信');
  assert(continueBtn, 'read-letter action exists');
  eq(continueBtn.getAttribute('aria-label'), '关闭收据并读回信', 'action label');
  click(continueBtn);
  eq(opened, 1, 'continue opens campaign');
  assert(!card.parentNode, 'action closes receipt first');
  receipt.close();
}

{
  uiContext.document = createDocument();
  let opened = 0;
  const feedback = storyFeedback('unavailable');
  feedback.unavailable = '工钱已结，剧情这会儿没能记进账。';
  const card = receipt.show({ result: settledResult(), storyFeedback: feedback, openCampaign() { opened += 1; }, api: { openTown() { opened += 1; } } });
  const text = card.textContent;
  assert(text.includes('工钱已结，剧情这会儿没能记进账。'), 'failure feedback explicit');
  assert(!text.includes('新完成的段落'), 'failure never claims chapter progress');
  assert(!text.includes('剧情已记'), 'failure never claims story recorded');
  assert(noInternalTokens(text), 'failure text has no internal tokens');
  const townBtn = byText(card, '回告示板');
  assert(townBtn, 'town action exists');
  click(townBtn);
  eq(opened, 1, 'town opens once');
  assert(!card.parentNode, 'town closes receipt first');
  receipt.close();
}

{
  uiContext.document = createDocument();
  const card = receipt.show({
    result: settledResult(),
    storyFeedback: {
      status: 'new',
      discovered: ['工地记录'],
      replies: [],
      chapter: null,
      chapterCount: 0,
      nextStep: '',
      unavailable: '',
    },
    openCampaign() { throw new Error('no chapter progress should not open campaign'); },
    api: { openTown() {} },
  });
  const text = card.textContent;
  assert(text.includes('工地记录'), 'intermediate commission still reports story gain');
  assert(!byText(card, '读回信'), 'no read-letter action without story progress');
  assert(byText(card, '回告示板'), 'town action stays available');
  assert(noInternalTokens(text), 'intermediate text has no internal tokens');
  receipt.close();
}

{
  uiContext.document = createDocument();
  const feedback = storyFeedback('new');
  feedback.chapter = { id: 'C2', title: '旧港的第一封信、谁留下了七号货柜' };
  feedback.chapterCount = 2;
  const card = receipt.show({ result: settledResult(), storyFeedback: feedback, openCampaign() {} });
  const text = card.textContent;
  assert(text.includes('旧港的第一封信、谁留下了七号货柜'), 'multi-jump shows all completed titles');
  assert(noInternalTokens(text), 'multi-jump never leaks chapter tokens');
  receipt.close();
}

{
  uiContext.document = createDocument();
  const card = receipt.show({ result: { ok: false, reason: 'objective-not-met' }, storyFeedback: storyFeedback('unavailable'), api: { openTown() {} } });
  const text = card.textContent;
  assert(text.includes('这趟活儿没干成'), 'failed settlement shows honest work result');
  assert(text.includes('工钱已结，剧情这会儿没能记进账.' ) === false, 'failure does not claim pay settled');
  assert(byText(card, '回告示板'), 'failure still has an exit');
  assert(noInternalTokens(text), 'failure text has no internal tokens');
  receipt.close();
}

{
  uiContext.document = createDocument();
  const first = receipt.show({ result: settledResult(), storyFeedback: storyFeedback('recorded'), openCampaign() {} });
  const second = receipt.show({ result: settledResult(), storyFeedback: storyFeedback('recorded'), openCampaign() {} });
  assert(second, 'resend produces a card');
  eq(uiContext.document.body.children.length, 1, 'only one receipt card remains');
  assert(!first.parentNode, 'old card removed');
  receipt.close();
}

/* Esc / 44px / 焦点：收据卡仍保留键盘出口与最小热区（结构级断言）。 */
{
  uiContext.document = createDocument();
  const card = receipt.show({ result: settledResult(), storyFeedback: storyFeedback('new'), openCampaign() {} });
  const exitButtons = buttons(card);
  assert(exitButtons.length >= 2, 'close + advance buttons both present');
  assert(exitButtons.every((btn) => btn.getAttribute('aria-label')), 'all buttons labelled');
  card.dispatch('keydown', { key: 'Escape' });
  assert(!card.parentNode, 'Esc closes receipt card');
  receipt.close();
}

/* bridge 静态合同：先记录后渲染、同步 C1、失败如实显示、有超时、不泄漏内部旗标。 */
assert(bridgeSource.includes('return withStoryTimeout(storyFeedbackPipeline(normalized, run))'), 'bridge waits (with timeout) for story result');
assert(bridgeSource.includes('return storyFeedbackFor(result, storyRecord);'), 'bridge waits for structured evidence result');
assert(bridgeSource.includes('return Promise.resolve(syncCampaignFlags(false))'), 'bridge syncs C1 at settlement');
assert(bridgeSource.includes('.then(function () { return loadStorySnapshot(); })'), 'bridge reads snapshot after persistence');
assert(bridgeSource.includes('renderCommissionReceipt(normalized, storyFeedback);'), 'bridge renders after persistence');
assert(bridgeSource.includes("storyFeedback: storyFeedbackForUi(feedback),"), 'bridge strips internal flags before UI');
assert(bridgeSource.includes("delete out.__newChapterFlags;"), 'internal chapter flags never reach UI');
assert(bridgeSource.includes('工钱已结，剧情这会儿没能记进账。'), 'bridge failure feedback is explicit');
assert(bridgeSource.includes('STORY_PIPELINE_TIMEOUT_MS'), 'bridge has bounded story wait');
assert(bridgeSource.includes('var newTokens = Array.isArray(storyRecord.newTokens)'), 'story gains derive from newTokens (not flags)');
assert(bridgeSource.includes('var wanted = newFlags.length') === false, 'old flag-based discovered fallback removed');
assert(bridgeSource.includes("if (newFlags.indexOf(chapter.completionFlag) < 0) return; /* 旧章不算本次 */"), 'old chapters never labeled as new');
assert(bridgeSource.includes('feedback.chapterCount = completed.length;'), 'multi-jump reports all new chapters');
assert(!/storyFeedback[^\n]*newFlags/.test(bridgeSource), 'bridge never exposes newFlags to UI');

console.log(`career receipt feedback: ${checks}/${checks} checks passed`);
