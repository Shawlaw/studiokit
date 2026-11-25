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
async function drain() { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }

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

/* 中间单（step）：只有线索/下一步，绝不冒充章节完成；下一步指向当前章自身，不跳 handoff。 */
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
      nextStep: '继续当前这段「谁留下了七号货柜」，去告示板看看还差哪张单。',
      unavailable: '',
    },
    /* 无章节完成但存在剧情反馈与下一步：页内主动作读回信；无 openCampaign 时回退到回告示板。 */
    api: { openTown() {} },
  });
  const text = card.textContent;
  assert(text.includes('工地记录'), 'intermediate commission still reports story gain');
  assert(text.includes('下一步：继续当前这段「谁留下了七号货柜」'), 'step next step points at current chapter, not its handoff');
  assert(!text.includes('月影里的时间差'), 'step must not jump to C3 via C2.handoff');
  assert(!text.includes('新完成的段落'), 'step receipt never claims chapter completion');
  assert(byText(card, '回告示板'), 'town action stays available');
  assert(noInternalTokens(text), 'intermediate text has no internal tokens');
  receipt.close();
}

/* 里程碑（milestone）：C1 完成 → 新完成段落 + 下一步 C2 标题。 */
{
  uiContext.document = createDocument();
  const feedback = storyFeedback('new');
  feedback.chapter = { id: 'C1', title: '旧港的第一封信' };
  feedback.chapterCount = 1;
  feedback.nextStep = '去告示板看看「谁留下了七号货柜」有什么新活儿。';
  const card = receipt.show({ result: settledResult(), storyFeedback: feedback, openCampaign() {} });
  const text = card.textContent;
  assert(text.includes('新完成的段落：旧港的第一封信'), 'C1 milestone shows completed chapter');
  assert(text.includes('下一步：去告示板看看「谁留下了七号货柜」'), 'C1 milestone next step is C2');
  assert(!text.includes('月影里的时间差'), 'C1 milestone next step is not C3');
  assert(noInternalTokens(text), 'milestone never leaks chapter tokens');
  receipt.close();
}

/* 里程碑（milestone）：C2 完成 → 下一步 C3 标题。 */
{
  uiContext.document = createDocument();
  const feedback = storyFeedback('new');
  feedback.chapter = { id: 'C2', title: '谁留下了七号货柜' };
  feedback.chapterCount = 1;
  feedback.nextStep = '去告示板看看「月影里的时间差」有什么新活儿。';
  const card = receipt.show({ result: settledResult(), storyFeedback: feedback, openCampaign() {} });
  const text = card.textContent;
  assert(text.includes('新完成的段落：谁留下了七号货柜'), 'C2 milestone shows completed chapter');
  assert(text.includes('下一步：去告示板看看「月影里的时间差」'), 'C2 milestone next step is C3');
  assert(noInternalTokens(text), 'C2 milestone never leaks chapter tokens');
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

/* 异步动作失败：收据先关闭，但必须给戏内提示 + 重试按钮（成功才只关闭），不静默吞错。 */
{
  uiContext.document = createDocument();
  let invoked = 0;
  const announcements = [];
  const card = receipt.show({
    result: settledResult(),
    storyFeedback: storyFeedback('new'),
    announce(text) { announcements.push(text); },
    openCampaign() {
      invoked += 1;
      return Promise.reject(new Error('ui still loading'));
    },
  });
  const continueBtn = byText(card, '读回信');
  assert(continueBtn, 'read-letter action exists for async failure case');
  click(continueBtn);
  assert(!card.parentNode, 'receipt closed before async action resolves');
  await drain();
  assert(invoked === 1, 'async action invoked once');
  assert(uiContext.document.body.children.some((n) => n.className && n.className.indexOf('ac-career-action-failure') >= 0),
    'action failure notice shown');
  assert(announcements.some((t) => t.includes('这会儿没能打开')), 'announce in-fiction failure');
  const again = buttons(uiContext.document.body).find((b) => b.textContent === '再试一次');
  assert(again, 'retry action available');
  assert(again.getAttribute('aria-label'), 'retry action labelled');
  click(again); /* 再次失败只应保留一条提示 */
  await drain();
  assert(invoked === 2, 'retry re-invokes action');
  eq(uiContext.document.body.children.filter((n) => n.className && n.className.indexOf('ac-career-action-failure') >= 0).length, 1,
    'only one failure notice remains');
  receipt.close();
}

/* 异步动作返回 ok:false：同样给提示 + 重试（openTown/openCampaign 结构化失败）。 */
{
  uiContext.document = createDocument();
  const card = receipt.show({
    result: settledResult(),
    storyFeedback: storyFeedback('new'),
    api: { openTown() { return Promise.resolve({ ok: false, reason: 'ui-unavailable' }); } },
  });
  const townBtn = byText(card, '回告示板');
  assert(townBtn, 'town action exists for ok:false case');
  click(townBtn);
  await drain();
  assert(byText(uiContext.document.body, '再试一次'), 'ok:false also offers retry');
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
assert(bridgeSource.includes("delete out.__receiptFlags;"), 'internal receipt flags never reach UI');
assert(bridgeSource.includes("delete out.__storyRecordDuplicate;"), 'internal duplicate marker never reaches UI');
assert(bridgeSource.includes('工钱已结，剧情这会儿没能记进账。'), 'bridge failure feedback is explicit');
assert(bridgeSource.includes('STORY_PIPELINE_TIMEOUT_MS'), 'bridge has bounded story wait');
assert(bridgeSource.includes('var newTokens = Array.isArray(storyRecord.newTokens)'), 'story gains derive from newTokens (not flags)');
assert(bridgeSource.includes('var wanted = newFlags.length') === false, 'old flag-based discovered fallback removed');
assert(bridgeSource.includes('if (newFlags.indexOf(flag) >= 0) { claimed.push(chapter); return; }'), 'only chapters with this run new flags are claimed as completed');
assert(bridgeSource.includes('feedback.chapterCount = claimed.length;'), 'multi-jump reports all new chapters');
assert(bridgeSource.includes('feedback.nextStep = nextStepOfCurrent(validState);'), 'bridge gives next step without new chapter flags');
assert(bridgeSource.includes("c1RouteMetByReceipt(receiptFlags)"), 'C1 completion derived from this run receipt flags');
assert(bridgeSource.includes("flags['C1.work_done'] || flags['C1.flight_done']"), 'C1 work/flight route flags recognized');
assert(bridgeSource.includes("flags['C1.signal'] || flags['C1.records'])"), 'C1 signal/records route flags recognized');
assert(bridgeSource.includes('chapter.chapterId === \'C1\' && !isDuplicate'), 'duplicate C1 receipts not falsely claimed as new');
assert(bridgeSource.includes('继续当前这段「'), 'current-chapter next step points at current chapter itself');
assert(bridgeSource.includes('raw && typeof raw === \'object\' ? raw.chapterId'), 'currentChapter object shape supported');
assert(bridgeSource.includes("return '去告示板看看下一张单。';"), 'bridge has a next-step fallback when snapshot is unavailable');
assert(!/storyFeedback[^\n]*newFlags/.test(bridgeSource), 'bridge never exposes newFlags to UI');

/* ---------------------------------------------------------------- 行为级 VM：桥接章节判定 + 真实 campaign state */

function extractHelpers() {
  const start = bridgeSource.indexOf('  function attachCampaignProgress(');
  const end = bridgeSource.indexOf('  function storyFeedbackForUi(', start);
  if (start < 0 || end < 0) throw new Error('bridge helpers not found');
  const body = bridgeSource.slice(start, end);
  const sandbox = {
    console,
    readGlobal(name) { return sandbox.__globals[name] || null; },
    cleanStoryText(value, limit) {
      const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
      const chars = Array.from(text);
      const cap = limit || 160;
      return chars.length > cap ? chars.slice(0, cap).join('') + '…' : text;
    },
    internal: {
      chapterFiles: {},
      campaignContent: JSON.parse(readFileSync(resolve(root, 'apps/arcade/career/content/campaign.json'), 'utf8')),
    },
    __globals: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(body + '\nthis.__api = { attachCampaignProgress, nextStepOfCurrent, nextStepOf, c1RouteMetByReceipt };', sandbox, { filename: 'bridge-helpers' });
  return { api: sandbox.__api, sandbox };
}

function loadCampaign() {
  const source = readFileSync(resolve(root, 'apps/arcade/career/campaign-core.js'), 'utf8');
  const sandbox = { module: { exports: {} }, exports: {}, window: undefined, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'campaign-core.js' });
  return sandbox.module.exports;
}
function loadContent(name) {
  return JSON.parse(readFileSync(resolve(root, 'apps/arcade/career/content', name), 'utf8'));
}
function configureCampaign(campaign) {
  const chapters = {};
  for (let i = 0; i < 6; i += 1) chapters['C' + i] = loadContent('chapter-0' + i + '.json');
  campaign.configure({
    campaign: loadContent('campaign.json'),
    chapters,
    commissions: loadContent('commissions.json'),
    npc: loadContent('npc.json'),
    sideStories: loadContent('side-stories.json'),
    endings: ['combat', 'research', 'rescue'].map((a) => loadContent('ending-' + a + '.json')),
    evidence: loadContent('registry.json'),
  });
  return chapters;
}

{
  const { api, sandbox } = extractHelpers();
  const campaign = loadCampaign();
  const chapters = configureCampaign(campaign);
  sandbox.internal.chapterFiles = chapters;
  sandbox.__globals.campaign = campaign;

  /* 首单 C1：storyRecord 无章级 newFlags（C1.signal_fragment 由 syncCampaignFlags 补写），
     但本次 receipt.flags = C1.work_done，真实快照中 C1 complete → 应显示新完成段落 + 下一步 C2。 */
  const c1Quests = [{
    careerId: 'career-test',
    nodeId: 'story:C1.work_done',
    flags: ['C1.work_done'],
    status: 'cleared',
  }, {
    careerId: 'career-test',
    nodeId: 'story:C1.signal_fragment',
    flags: ['C1.signal_fragment'],
    status: 'cleared',
  }, {
    careerId: 'career-test',
    nodeId: 'story:C0.port_seen',
    flags: ['C0.port_seen'],
    status: 'cleared',
  }];
  const c1Snapshot = { quests: c1Quests, claims: [], profile: null, wallet: null };
  const c1State = campaign.state(c1Snapshot);
  assert(c1State.ok === true, 'real campaign.state for C1-complete snapshot is valid');
  const c1Chapter = c1State.chapters.find((c) => c.chapterId === 'C1');
  assert(c1Chapter && c1Chapter.state === 'complete', 'C1 is complete in real snapshot');
  const c1Feedback = {
    status: 'new', discovered: ['工地记录'], replies: [], chapter: null, chapterCount: 0,
    __newChapterFlags: [], __receiptFlags: ['C1.work_done'], __storyRecordDuplicate: false,
  };
  api.attachCampaignProgress(c1Feedback, c1Snapshot);
  assert(c1Feedback.chapter && c1Feedback.chapter.title === '旧港的第一封信', 'first commission claims C1 completion from receipt work flag');
  assert(c1Feedback.nextStep.includes('谁留下了七号货柜'), 'C1 next step points to C2 via handoff');
  assert(!c1Feedback.nextStep.includes('月影里的时间差'), 'C1 next step is not C3');

  /* 中间单：currentChapter=C2（真实快照字符串），无新章旗标 → 不下完成段落，
     下一步指向当前章 C2 自身，不跳到 C3。 */
  const c2Snapshot = {
    quests: c1Quests.concat([{ careerId: 'career-test', nodeId: 'evidence:E-C1-site-2', evidence: ['E-C1-site-2'], status: 'cleared' }]),
    claims: [], profile: null, wallet: null,
  };
  const c2State = campaign.state(c2Snapshot);
  const currentChapter = c2State.currentChapter;
  assert(typeof currentChapter === 'string' && currentChapter === 'C2', 'real campaign.state.currentChapter is string C2');
  const stepFeedback = {
    status: 'new', discovered: ['工地记录'], replies: [], chapter: null, chapterCount: 0,
    __newChapterFlags: [], __receiptFlags: ['C1.storm_done'], __storyRecordDuplicate: false,
  };
  api.attachCampaignProgress(stepFeedback, c2Snapshot);
  assert(!stepFeedback.chapter, 'step receipt never sets completed chapter');
  assert(stepFeedback.nextStep.includes('谁留下了七号货柜'), 'step next step names current chapter C2');
  assert(!stepFeedback.nextStep.includes('月影里的时间差'), 'step next step never jumps to C3');
  assert(!stepFeedback.nextStep.includes('旧港的第一封信'), 'step next step never reverts to completed C1');

  /* C2 → C3：真实快照 C2 完成后 nextStepOf 用 C2.handoff 指向 C3。 */
  const c2DoneSnapshot = {
    quests: c2Snapshot.quests.concat([{ careerId: 'career-test', nodeId: 'story:C2.research_complete', flags: ['C2.research_complete'], status: 'cleared' }]),
    claims: [], profile: null, wallet: null,
  };
  const c2DoneFeedback = {
    status: 'new', discovered: [], replies: [], chapter: null, chapterCount: 0,
    __newChapterFlags: ['C2.research_complete'], __receiptFlags: [], __storyRecordDuplicate: false,
  };
  api.attachCampaignProgress(c2DoneFeedback, c2DoneSnapshot);
  assert(c2DoneFeedback.chapter && c2DoneFeedback.chapter.title === '谁留下了七号货柜', 'C2 milestone claims C2 completion');
  assert(c2DoneFeedback.nextStep.includes('月影里的时间差'), 'C2 milestone next step is C3 via own handoff');

  /* object 形状的 currentChapter 仍可定位当前章。 */
  const objectState = { ok: true, chapters: c2State.chapters, currentChapter: { chapterId: 'C2' }, endingChosen: null };
  assert(api.nextStepOfCurrent(objectState).includes('谁留下了七号货柜'), 'object-shaped currentChapter resolves to C2');
}

/* ---------------------------------------------------------------- 行为级 VM：证据命名 + 中间单不回放旧章回信 */

function extractStoryHelpers() {
  const start = bridgeSource.indexOf('  function storyFeedbackFailure(');
  const end = bridgeSource.indexOf('  function attachCampaignProgress(', start);
  const body = bridgeSource.slice(start, end);
  const sandbox = {
    console,
    STORY_TEXT_LIMIT: 160,
    clipText(value, max) { const chars = Array.from(String(value == null ? '' : value)); return chars.length > max ? chars.slice(0, max).join('') + '…' : String(value); },
    nowIso: () => '2026-11-25T00:00:00.000Z',
    internal: { npcContent: JSON.parse(readFileSync(resolve(root, 'apps/arcade/career/content/npc.json'), 'utf8')) },
  };
  vm.createContext(sandbox);
  vm.runInContext([body, 'this.__api = { storyFeedbackFor, evidenceLabelOf, routeProgressLineOf };'].join(String.fromCharCode(10)), sandbox, { filename: 'story-helpers' });
  return sandbox.__api;
}

{
  const helpers = extractStoryHelpers();

  /* 中间单：receipt.flags 带已完成 C1 章旗标，但无本次章级 newFlags —— 不得回放 C1 NPC 旧事。 */
  const result = {
    ok: true,
    receipt: { receiptId: 'run-x', credits: 90, flags: ['C1.work_done', 'C1.foreman'], evidence: ['E-C1-site-2'] },
  };
  const record = { ok: true, duplicate: false, newTokens: ['E-C1-site-2'], newFlags: [], flags: [], tokens: ['E-C1-site-2'] };
  const feedback = helpers.storyFeedbackFor(result, record);
  assert(feedback.status === 'new', 'intermediate record status new');
  assert(feedback.replies.length <= 1, 'intermediate single route-progress line at most');
  assert(!feedback.replies.some((r) => r.text.includes('标准舰') || r.text.includes('门牌号') || r.text.includes('中继密钥')),
    'no replay of completed C1 NPC replies');
  assert(feedback.replies.length === 0 || feedback.replies[0].name === '旧港告示', 'route progress uses anonymous in-fiction source');

  /* 按来源给玩家物件名，且不泄漏原始 token。 */
  const cases = [
    ['E-memory-flip.T2', '档案照片'],
    ['E-gomoku.T2', '布局推演'],
    ['E-C1-site', '工地记录'],
    ['E-shadow-leap.T2', '卷轴拓片'],
  ];
  for (const [token, expected] of cases) {
    const label = helpers.evidenceLabelOf(token);
    assert(label.includes(expected), 'evidence label for ' + token + ' is ' + label);
    assert(!label.includes(token), 'evidence label never leaks token');
  }
  assert(helpers.evidenceLabelOf('E-C1-patrol') === '异常航报', 'patrol evidence labeled航报');
  assert(helpers.evidenceLabelOf('unknown-token') === '', 'non-evidence token has no label');
}

console.log(`career receipt feedback: ${checks}/${checks} checks passed`);
