#!/usr/bin/env node
/**
 * StudioKit Arcade Life 0.15 — 可访问性与低干扰视觉完整复验（D15-15）
 *
 * 真实 Chrome（headless）+ CDP 端到端复验，零 npm 依赖：
 * - 复用 tools/lib/arcade_cdp.mjs 的 startServer / launchChrome / openPage / createRecorder；
 * - 唯一写入：本文件；截图写入 gitignored 的 test-artifacts/（供证据引用，不提交）。
 *
 * 覆盖（全部实际执行）：
 *   1. 无显眼生涯入口：中心页 + memory-flip / pendulum-tower / star-raid 首屏可见文本与按钮
 *      不含「生涯模式 / 进入生涯 / 开始冒险 / 职业系统 / 解锁 RPG / 签到 / 奖励」等 CTA；
 *      中心页 16 卡片、版本 0.24.1；无新增首屏 banner / 弹窗。
 *   2. 微线索 chip 无障碍（?careerTest=1 + renderDebug，或真实结算路径同样使用该渲染管线）：
 *      role=button / tabindex=0 / aria-label 含「信」/ 热区 ≥44×44；真实 Tab 可聚焦，
 *      Enter 与 Space 各打开信箱一次；dialog + aria-modal + 焦点进入面板；
 *      不遮挡画布中心（25%–75% 区域）、不造成横向滚动、不挤动画布；
 *      prefers-reduced-motion: reduce（CDP Emulation.setEmulatedMedia）下无动画/过渡；
 *      忽略 chip 后经典仍可点击开始并进入 playing。
 *   3. 信箱可找回：关闭后 openMailbox() 仍见同一条线索；只列已发现线索。
 *   4. 设置开关：关闭/开启线索提示写回 discovery state；已发现线索留在信箱；
 *      清除线索必须二次确认（未确认前 state().clues 不变，确认后清空）。
 *   5. 四档窄屏 320×568 / 375×667 / 390×844 / 430×932：chip/信箱/设置面板
 *      scrollWidth ≤ clientWidth+1、可见按钮 ≥44px、可关闭。
 *   6. 读屏语义：aria-live polite 存在、信箱 aria-labelledby 指向可见标题、关闭按钮可访问名称非空。
 *   7. 既有经典零干扰：同页仅 #test（无 careerTest）时无 [data-career-clue]、
 *      无 window.__arcadeCareerTest、无 career UI 资源装载、既有 __arcadeTest 探针可调用 1 次且无异常、
 *      且不创建 career IndexedDB。
 *
 * 隔离与确定性：
 *   - 测试开始/结束均执行 indexedDB.deleteDatabase('studiokit:arcade:career')；结束额外确认库不存在；
 *   - 不使用固定 setTimeout 猜状态：一律 await __arcadeCareerTest.ready 或 CDP waitFor 轮询条件；
 *   - 键盘使用 CDP Input.dispatchKeyEvent 真实按键（非 window.dispatchEvent 伪造）。
 *
 * 端口（显式，避免与其它门禁冲突）：
 *   CAREER_A11Y_PORT=8832 / CAREER_A11Y_CDP_PORT=9432
 * 运行：
 *   C:\...> $env:CAREER_A11Y_PORT='8832'; $env:CAREER_A11Y_CDP_PORT='9432';
 *            node tools/career_discovery_accessibility_test.mjs
 *   可选：--port=8832 --cdp-port=9432
 * 退出码：0 全部 PASS；1 有 FAIL；2 环境/装配失败（无 Chrome、端口占用、必需文件缺失等）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, createRecorder, envPort, launchChrome, openPage, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const ARTIFACTS = path.join(REPO_ROOT, 'test-artifacts', 'career-a11y');
const DB_NAME = 'studiokit:arcade:career';
const VIEWPORT = { width: 390, height: 844 };
const NARROW = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];
const CTA_STRICT = ['生涯模式', '进入生涯', '开始冒险', '职业系统', '解锁 RPG', '解锁RPG', '生涯入口', '开启生涯', '创建角色', '选择职业'];
const CTA_MONETARY = ['签到', '奖励'];
const NEGATION_RE = /(无|没有|不含|不需要|非|禁止|拒绝)[^，。；,.;:：]{0,10}$/;
const GAME_PAGES = [
  { slug: 'memory-flip', clueId: 'CL-memory-flip', title: '牌背纸条', undiscoveredTitle: '验收单背面', undiscoveredClueId: 'CL-pendulum-tower' },
  { slug: 'pendulum-tower', clueId: 'CL-pendulum-tower' },
  { slug: 'star-raid', clueId: 'CL-star-raid' },
];
const REQUIRED_FILES = [
  'apps/arcade/index.html',
  'apps/arcade/games/memory-flip.html',
  'apps/arcade/games/pendulum-tower.html',
  'apps/arcade/games/star-raid.html',
  'apps/arcade/career/bridge.js',
  'apps/arcade/career/content/clues.json',
  'apps/arcade/career/ui/clue-surface.js',
  'apps/arcade/career/ui/clue-surface.css',
  'apps/arcade/career/ui/mailbox.js',
  'apps/arcade/career/ui/settings.js',
];

const { record, assert, summary } = createRecorder();

let SERVER_PORT = 8832;
let CDP_PORT = 9432;
let BASE = '';
let cdp = null;

/* ------------------------------------------------------------------ *
 * 通用小工具
 * ------------------------------------------------------------------ */

function arg(name, fallback) {
  const prefix = '--' + name + '=';
  const hit = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function detail(value) {
  if (value === undefined) return '';
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 320 ? text.slice(0, 320) + '…' : text;
  } catch (err) {
    return String(value);
  }
}

async function check(name, fn) {
  try {
    const info = await fn();
    record(name, true, typeof info === 'string' ? info : detail(info));
  } catch (err) {
    /* 失败信息统一追加当前页面 URL（含 gameId），便于定位到具体游戏页。 */
    let url = '';
    try {
      url = ' url=' + (await cdp.evaluate('location.href'));
    } catch (evaluateErr) {
      url = ' url=<unavailable>';
    }
    record(name, false, (err && err.message ? err.message : String(err)) + url);
  }
}

function assertNear(actual, expected, tolerance, label) {
  assert(Math.abs(actual - expected) <= tolerance, label + ' 期望 ' + expected + '±' + tolerance + '，实际 ' + actual);
}

function formatRect(rect) {
  if (!rect) return 'null';
  return 'x=' + round(rect.x) + ',y=' + round(rect.y) + ',' + round(rect.width) + '×' + round(rect.height);
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

/* ------------------------------------------------------------------ *
 * 页面/导航/存储辅助
 * ------------------------------------------------------------------ */

async function navigate(url) {
  await cdp.navigate(url);
  await cdp.waitFor('document.readyState === "complete"', { timeout: 15000 });
  await cdp.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
}

async function deleteCareerDatabase() {
  return cdp.evaluate(`new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; resolve(value); };
    let request = null;
    try {
      request = indexedDB.deleteDatabase(${JSON.stringify(DB_NAME)});
    } catch (err) {
      finish({ ok: false, error: 'exception:' + String(err) });
      return;
    }
    request.onsuccess = () => finish({ ok: true });
    request.onerror = () => finish({ ok: false, error: String(request.error) });
    request.onblocked = () => finish({ ok: false, reason: 'blocked' });
  })`);
}

async function careerDatabaseNames() {
  return cdp.evaluate(`(async () => {
    if (!indexedDB || typeof indexedDB.databases !== 'function') return { supported: false, names: [] };
    try {
      const list = await indexedDB.databases();
      return { supported: true, names: (list || []).map((entry) => entry.name) };
    } catch (err) {
      return { supported: false, names: [], error: String(err) };
    }
  })()`);
}

async function waitCareerReady() {
  const present = await cdp.waitFor('!!(window.__arcadeCareerTest && window.__arcadeCareerTest.ready)', { timeout: 15000 });
  assert(present, '页面未暴露 window.__arcadeCareerTest.ready');
  return cdp.evaluate('window.__arcadeCareerTest.ready');
}

async function seedClue(clueId, gameId) {
  const seed = await cdp.evaluate(
    'window.__arcadeCareerTest.seedState(' +
      JSON.stringify({
        clues: { [clueId]: { sourceGame: gameId, seenAt: '2026-11-22T01:00:00.000Z' } },
        firstClueId: clueId,
        firstSourceGame: gameId,
        stage: 'GLIMPSED',
      }) +
      ')'
  );
  assert(seed && seed.ok, 'seedState 失败：' + detail(seed));
  assert(seed.state && seed.state.clues && seed.state.clues[clueId], 'seedState 后 state.clues 缺少 ' + clueId);
  return seed;
}

async function renderClue(clueId) {
  const rendered = await cdp.evaluate('window.__arcadeCareerTest.renderDebug(' + JSON.stringify(clueId) + ')');
  assert(rendered && rendered.rendered === true, 'renderDebug 未渲染：' + detail(rendered));
  await cdp.waitFor('!!document.querySelector(' + JSON.stringify('[data-career-clue="' + clueId + '"]') + ')', { timeout: 8000 });
  return rendered;
}

async function resetAndSeed(clueId, gameId) {
  const reset = await cdp.evaluate('window.__arcadeCareerTest.resetAll()');
  assert(reset && reset.state, 'resetAll 失败：' + detail(reset));
  const seed = await seedClue(clueId, gameId);
  await renderClue(clueId);
  return { reset, seed };
}

/** 真实按键（CDP Input.dispatchKeyEvent，命中当前焦点元素，不是 window 伪造事件）。 */
async function keyPress(key, code, vk) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  });
}

const KEY = {
  tab: () => keyPress('Tab', 'Tab', 9),
  enter: () => keyPress('Enter', 'Enter', 13),
  space: () => keyPress(' ', 'Space', 32),
  escape: () => keyPress('Escape', 'Escape', 27),
};

/** 从文档起点按 Tab 直到聚焦到 career chip；返回实际按键次数（失败抛错）。 */
async function focusChipByTab(maxPresses) {
  const limit = maxPresses || 40;
  await cdp.evaluate('(document.activeElement && typeof document.activeElement.blur === "function") ? (document.activeElement.blur(), true) : true');
  for (let i = 1; i <= limit; i += 1) {
    await KEY.tab();
    const hit = await cdp.evaluate(
      '(() => { const a = document.activeElement; return !!(a && a.getAttribute && a.getAttribute("data-career-clue")); })()'
    );
    if (hit) return i;
  }
  throw new Error('按 Tab ' + limit + ' 次仍未聚焦到 [data-career-clue]（当前焦点：' + detail(await cdp.evaluate('document.activeElement && (document.activeElement.className || document.activeElement.tagName)')) + '）');
}

async function waitPanel(panelName, timeout) {
  await cdp.waitFor(
    '!!document.querySelector(' + JSON.stringify('[data-career-panel="' + panelName + '"]') + ')',
    { timeout: timeout || 6000 }
  );
}

async function closePanelByButton(panelName) {
  const clicked = await cdp.evaluate(
    '(() => { const panel = document.querySelector(' +
      JSON.stringify('[data-career-panel="' + panelName + '"]') +
      '); if (!panel) return false; const button = panel.querySelector(".ac-career-close"); if (!button) return false; button.click(); return true; })()'
  );
  assert(clicked, panelName + ' 面板未找到可点击的关闭按钮');
  await cdp.waitFor('!document.querySelector(' + JSON.stringify('[data-career-panel="' + panelName + '"]') + ')', { timeout: 5000 });
}

async function closeAllPanels() {
  await cdp.evaluate(`(() => {
    const ui = window.ArcadeCareerUI || {};
    if (ui.mailbox && typeof ui.mailbox.close === 'function') { try { ui.mailbox.close(); } catch (err) {} }
    if (ui.settings && typeof ui.settings.close === 'function') { try { ui.settings.close(); } catch (err) {} }
    return document.querySelectorAll('[data-career-panel]').length;
  })()`);
}

/** 等 CSS 淡入动画结束（computed opacity=1）再截图，避免证据图拍到半透明中间帧。 */
async function waitOpacitySettled(selector) {
  await cdp.waitFor(
    '(() => { const el = document.querySelector(' + JSON.stringify(selector) + '); if (!el) return false; return getComputedStyle(el).opacity === "1"; })()',
    { timeout: 4000, interval: 40 }
  );
}

/** 等引擎 toast 自然消失（仅用于证据截图，不让上一动作的播报串进画面）。 */
async function waitNoToast() {
  try {
    await cdp.waitFor('!document.querySelector(".ac-toast")', { timeout: 6000, interval: 100 });
  } catch (err) {
    /* toast 不阻断功能断言，超时仅影响截图观感 */
  }
}

/** 量取 chip、画布中心区域、页面横向滚动与动画/过渡样式。 */
async function measureChip() {
  return cdp.evaluate(`(() => {
    const toRect = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom });
    const el = document.querySelector('[data-career-clue]');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const canvasEl = document.querySelector('.game-canvas');
    const canvas = canvasEl ? canvasEl.getBoundingClientRect() : null;
    const doc = document.documentElement;
    const style = getComputedStyle(el);
    let center = null;
    let overlap = null;
    if (canvas) {
      const zone = {
        x: canvas.x + canvas.width * 0.25,
        y: canvas.y + canvas.height * 0.25,
        width: canvas.width * 0.5,
        height: canvas.height * 0.5,
      };
      const ix = Math.max(0, Math.min(rect.right, zone.x + zone.width) - Math.max(rect.x, zone.x));
      const iy = Math.max(0, Math.min(rect.bottom, zone.y + zone.height) - Math.max(rect.y, zone.y));
      center = zone;
      overlap = { ix, iy, intersects: ix > 0 && iy > 0 };
    }
    return {
      clueId: el.getAttribute('data-career-clue'),
      count: document.querySelectorAll('[data-career-clue]').length,
      role: el.getAttribute('role'),
      tabindex: el.getAttribute('tabindex'),
      ariaLabel: el.getAttribute('aria-label') || '',
      text: (el.innerText || '').replace(/\\s+/g, ' ').trim(),
      rect: toRect(rect),
      canvas: canvas ? toRect(canvas) : null,
      center,
      overlap,
      position: style.position,
      zIndex: style.zIndex,
      animationName: style.animationName,
      animationDuration: style.animationDuration,
      transitionDuration: style.transitionDuration,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    };
  })()`);
}

/** 量取某个 career 面板的横向溢出/可见按钮尺寸/可访问名称结构。 */
async function measurePanel(panelName) {
  return cdp.evaluate(`(() => {
    const panel = document.querySelector(${JSON.stringify('[data-career-panel="' + panelName + '"]')});
    if (!panel) return null;
    const sheet = panel.querySelector('[role="dialog"]');
    const doc = document.documentElement;
    const visible = (node) => {
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const buttons = Array.from(panel.querySelectorAll('button')).filter(visible).map((node) => {
      const r = node.getBoundingClientRect();
      const label = node.getAttribute('aria-label') || (node.innerText || '').replace(/\\s+/g, ' ').trim();
      return { label: label.slice(0, 40), width: r.width, height: r.height };
    });
    const live = Array.from(panel.querySelectorAll('[aria-live]')).map((node) => ({
      live: node.getAttribute('aria-live'),
      role: node.getAttribute('role') || '',
      className: String(node.className),
    }));
    const titleId = sheet ? sheet.getAttribute('aria-labelledby') : null;
    const titleEl = titleId ? document.getElementById(titleId) : null;
    const closeBtn = panel.querySelector('.ac-career-close');
    return {
      panel: ${JSON.stringify(panelName)},
      sheetRole: sheet ? sheet.getAttribute('role') : null,
      ariaModal: sheet ? sheet.getAttribute('aria-modal') : null,
      labelledby: titleId,
      labelledbyText: titleEl ? (titleEl.textContent || '').trim() : null,
      titleVisible: !!(titleEl && visible(titleEl)),
      activeElement: document.activeElement ? String(document.activeElement.className || document.activeElement.tagName) : null,
      focusInsideDialog: !!(sheet && sheet.contains(document.activeElement)),
      closeAccessibleName: closeBtn ? (closeBtn.getAttribute('aria-label') || (closeBtn.textContent || '').trim()) : '',
      closeVisible: closeBtn ? visible(closeBtn) : false,
      liveRegions: live,
      buttons,
      buttonsAllAtLeast44: buttons.every((b) => b.width >= 43.5 && b.height >= 43.5),
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      sheetScrollWidth: sheet ? sheet.scrollWidth : null,
      sheetClientWidth: sheet ? sheet.clientWidth : null,
      overlayScrollWidth: panel.scrollWidth,
      overlayClientWidth: panel.clientWidth,
      itemIds: Array.from(panel.querySelectorAll('.ac-career-mailbox__item')).map((n) => n.getAttribute('data-clue-id')),
      text: (panel.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 800),
    };
  })()`);
}

/** 首屏 CTA / 生涯入口扫描（可见文本 + 可见交互元素 + href/data 属性）。 */
async function scanFirstScreen() {
  return cdp.evaluate(`(() => {
    const STRICT = ${JSON.stringify(CTA_STRICT)};
    const MONETARY = ${JSON.stringify(CTA_MONETARY)};
    const NEGATION = ${String(NEGATION_RE)};
    const visible = (node) => {
      const r = node.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return false;
      const style = getComputedStyle(node);
      return style.visibility !== 'hidden' && style.display !== 'none';
    };
    const text = document.body.innerText || '';
    const hits = [];
    STRICT.concat(MONETARY).forEach((phrase) => {
      let index = -1;
      while ((index = text.indexOf(phrase, index + 1)) >= 0) {
        const before = text.slice(Math.max(0, index - 10), index);
        const context = text.slice(Math.max(0, index - 16), index + phrase.length + 16).replace(/\\s+/g, ' ').trim();
        hits.push({ phrase, negated: new RegExp(NEGATION).test(before), context });
      }
    });
    const interactive = Array.from(document.querySelectorAll('a,button,[role="button"],[role="switch"],input,select,textarea'))
      .filter(visible)
      .map((node) => ({
        tag: node.tagName,
        label: ((node.getAttribute('aria-label') || '') + ' ' + ((node.innerText || '').replace(/\\s+/g, ' ').trim())).trim().slice(0, 120),
        href: node.getAttribute('href') || '',
        action: node.getAttribute('data-action') || '',
      }));
    const interactiveHits = [];
    interactive.forEach((node) => {
      STRICT.concat(MONETARY).forEach((phrase) => {
        if (node.label.indexOf(phrase) >= 0) interactiveHits.push({ phrase, label: node.label, tag: node.tag });
      });
      if (/(career|生涯)/i.test(node.href) || /(career|生涯)/i.test(node.action)) {
        interactiveHits.push({ phrase: 'career-link', label: node.label, tag: node.tag, href: node.href, action: node.action });
      }
    });
    const careerNodes = Array.from(document.querySelectorAll('[class*="ac-career"],[data-career-clue],[data-career-panel]'));
    const visibleCareerNodes = careerNodes.filter(visible).map((node) => String(node.className || node.tagName));
    /* 既有经典模式开始面板（engine.createOverlayUi）本身就是 role=dialog：只把 career 拥有的
       dialog 视为「新增弹窗」，既有开始面板仅记录数量供证据对照。 */
    const careerOwnedDialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
      .filter(visible)
      .filter((node) => !!node.closest('[data-career-panel], .ac-career-overlay'));
    const preexistingDialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
      .filter(visible)
      .filter((node) => !node.closest('[data-career-panel], .ac-career-overlay'));
    const doc = document.documentElement;
    const careerScripts = Array.from(document.querySelectorAll('script[src*="career/ui/"],link[href*="clue-surface.css"]')).map((n) => n.src || n.href);
    return {
      url: location.href,
      textHits: hits,
      positiveHits: hits.filter((hit) => !hit.negated),
      interactive,
      interactiveHits,
      careerNodeCount: careerNodes.length,
      visibleCareerNodes,
      careerDialogs: careerOwnedDialogs.length,
      preexistingDialogs: preexistingDialogs.length,
      careerUiAssets: careerScripts,
      hasCareerBridge: !!window.ArcadeCareer,
      hasCareerTestApi: !!window.__arcadeCareerTest,
      hasArcadeTest: !!window.__arcadeTest,
      cards: document.querySelectorAll('.hall-card').length,
      version: (document.querySelector('[data-hall-version]') || {}).textContent || null,
      title: document.title,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
    };
  })()`);
}

function assertNoCta(scan, label) {
  assert(scan.positiveHits.length === 0, label + ' 出现 CTA 文案：' + detail(scan.positiveHits));
  assert(scan.interactiveHits.length === 0, label + ' 出现 CTA / 生涯入口交互元素：' + detail(scan.interactiveHits));
}

function assertNoFirstScreenCareer(scan, label, expectTestApi) {
  assert(scan.careerNodeCount === 0, label + ' 首屏出现 career DOM 节点：' + detail(scan.visibleCareerNodes));
  assert(scan.careerDialogs === 0, label + ' 首屏出现 career 拥有的可见 dialog（新增弹窗）：' + scan.careerDialogs);
  if (expectTestApi === false) {
    assert(scan.hasCareerTestApi === false, label + ' 生产首屏不应暴露 __arcadeCareerTest');
  } else if (expectTestApi === true) {
    assert(scan.hasCareerTestApi === true, label + ' ?careerTest=1 页应暴露 __arcadeCareerTest（测试钩子）');
  }
}

/* ------------------------------------------------------------------ *
 * 会话 A：中心页（16 卡片 / 版本 / CTA / 首屏无生涯入口）
 * ------------------------------------------------------------------ */

async function runCenterSession() {
  await navigate(BASE + '/apps/arcade/index.html');
  const errorsAtLoad = cdp.errors.slice();
  await check('A01 中心页显示 16 张游戏卡片', async () => {
    const scan = await scanFirstScreen();
    assert(scan.cards === 16, '期望 16 张 .hall-card，实际 ' + scan.cards + '（url=' + scan.url + '）');
    const visibleCards = await cdp.evaluate(
      '(() => Array.from(document.querySelectorAll(".hall-card")).filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length)()'
    );
    assert(visibleCards === 16, '可见 .hall-card 期望 16，实际 ' + visibleCards);
    return 'cards=' + scan.cards + ' visible=' + visibleCards;
  });
  await check('A02 中心页版本 0.24.1 正确呈现', async () => {
    const scan = await scanFirstScreen();
    assert(scan.version === '0.24.1', '版本节点 [data-hall-version] 期望 0.24.1，实际 ' + detail(scan.version) + '（url=' + scan.url + '）');
    return 'version=' + scan.version + ' title=' + scan.title;
  });
  await check('A03 中心页可见文本/按钮无生涯 CTA（否定式「无签到/无奖励」白名单）', async () => {
    const scan = await scanFirstScreen();
    assertNoCta(scan, '中心页');
    return 'positive=0 排除否定式命中=' + scan.textHits.length + ' 交互元素=' + scan.interactive.length;
  });
  await check('A04 中心页无新增首屏 banner/弹窗/生涯 UI', async () => {
    const scan = await scanFirstScreen();
    assertNoFirstScreenCareer(scan, '中心页', false);
    assert(scan.hasCareerBridge === false, '中心页不应装载 career bridge（ADR §11）');
    return 'careerNodes=0 dialogs=0 bridge=false';
  });
  await check('A05 中心页无 career 入口链接/脚本/样式资源', async () => {
    const scan = await scanFirstScreen();
    assert(scan.careerUiAssets.length === 0, '中心页出现 career UI 资源：' + detail(scan.careerUiAssets));
    const careerRefs = await cdp.evaluate(
      '(() => Array.from(document.querySelectorAll("a[href],script[src],link[href]")).map((n) => n.getAttribute("href") || n.getAttribute("src") || "").filter((v) => /career/i.test(v)))()'
    );
    assert(careerRefs.length === 0, '中心页出现 career 资源引用：' + detail(careerRefs));
    return 'careerRefs=0';
  });
  await check('S02 中心页首屏无页面错误', async () => {
    assert(errorsAtLoad.length === 0, '页面 console/异常错误：' + detail(errorsAtLoad.slice(0, 3)));
    return 'errors=0';
  });
}

/* ------------------------------------------------------------------ *
 * 会话 E：既有经典零干扰（同页仅 #test，无 ?careerTest=1）
 * ------------------------------------------------------------------ */

async function runSilentSession() {
  await navigate(BASE + '/apps/arcade/games/memory-flip.html#test');
  const readyState = await cdp.waitFor('!!(window.ArcadeCareer && typeof window.ArcadeCareer.info === "function")', { timeout: 15000 });
  assert(readyState, 'bridge 未挂载 window.ArcadeCareer');
  const errorsAtLoad = cdp.errors.slice();

  await check('E01 既有 #test 页无 career chip / 面板 / __arcadeCareerTest', async () => {
    const data = await cdp.evaluate(`(() => ({
      testApi: typeof window.__arcadeCareerTest,
      chips: document.querySelectorAll('[data-career-clue]').length,
      panels: document.querySelectorAll('[data-career-panel]').length,
      careerNodes: document.querySelectorAll('[class*="ac-career"]').length,
      careerUiAssets: Array.from(document.querySelectorAll('script[src*="career/ui/"],link[href*="clue-surface.css"]')).length,
      uiGlobal: !!window.ArcadeCareerUI,
      url: location.href,
    }))()`);
    assert(data.testApi === 'undefined', '#test 页不应暴露 __arcadeCareerTest，实际 ' + data.testApi + '（url=' + data.url + '）');
    assert(data.chips === 0, '#test 页出现 [data-career-clue] ' + data.chips + ' 个');
    assert(data.panels === 0, '#test 页出现 [data-career-panel] ' + data.panels + ' 个');
    assert(data.careerNodes === 0, '#test 页出现 career DOM 节点 ' + data.careerNodes + ' 个');
    return 'chips=0 panels=0 careerNodes=0';
  });
  await check('E02 既有 #test 页 bridge 静默且不装载 career UI 资源', async () => {
    const data = await cdp.evaluate(`(() => ({
      info: window.ArcadeCareer.info(),
      uiGlobal: !!window.ArcadeCareerUI,
      uiAssets: Array.from(document.querySelectorAll('script[src*="career/ui/"],link[href*="clue-surface.css"]')).map((n) => n.src || n.href),
      url: location.href,
    }))()`);
    assert(data.info.silentTestOnly === true, '期望 silentTestOnly=true，实际 ' + detail(data.info.silentTestOnly));
    assert(data.info.available === false, '期望 available=false，实际 ' + data.info.available);
    assert(data.uiGlobal === false, '#test 页不应装载 window.ArcadeCareerUI');
    assert(data.uiAssets.length === 0, '#test 页出现 career UI 资源：' + detail(data.uiAssets));
    return 'silentTestOnly=' + data.info.silentTestOnly + ' available=' + data.info.available + ' uiAssets=0';
  });
  await check('E03 既有 __arcadeTest 探针可调用 1 次且无异常', async () => {
    const probe = await cdp.evaluate(`(() => {
      try {
        const info = window.__arcadeTest.info();
        const joy = window.__arcadeTest.joyInfo();
        return { ok: true, keys: Object.keys(info), state: joy.state };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    })()`);
    assert(probe.ok === true, '__arcadeTest.info() 抛异常：' + detail(probe));
    assert(probe.state === 'ready', '探针返回游戏状态期望 ready，实际 ' + detail(probe.state));
    return 'keys=' + probe.keys.length + ' state=' + probe.state;
  });
  await check('E04 既有 #test 页无 page error', async () => {
    assert(errorsAtLoad.length === 0, '页面 console/异常错误：' + detail(errorsAtLoad.slice(0, 3)));
    return 'errors=0';
  });
  await check('E05 既有 #test 页不创建 career IndexedDB', async () => {
    const dbs = await careerDatabaseNames();
    assert(dbs.supported, 'indexedDB.databases() 不可用：' + detail(dbs));
    assert(dbs.names.indexOf(DB_NAME) === -1, '静默 #test 页创建了 ' + DB_NAME + '（databases=' + detail(dbs.names) + '）');
    return 'careerDbExists=false';
  });
}

/* ------------------------------------------------------------------ *
 * 会话 B：memory-flip 真实游戏页（?careerTest=1#test）主无障碍套件
 * ------------------------------------------------------------------ */

async function runCareerSession() {
  await navigate(BASE + '/apps/arcade/games/memory-flip.html?careerTest=1#test');
  const errorsAtLoad = cdp.errors.slice();
  const game = GAME_PAGES[0];

  await check('B01 游戏页首屏可见文本/按钮无生涯 CTA', async () => {
    const scan = await scanFirstScreen();
    assertNoCta(scan, 'memory-flip');
    return 'positive=0 交互元素=' + scan.interactive.length + '（含既有「挑战 6 关」等）';
  });
  await check('B02 游戏页首屏无 career chip / banner / 弹窗', async () => {
    const scan = await scanFirstScreen();
    assertNoFirstScreenCareer(scan, 'memory-flip', true);
    assert(scan.hasCareerBridge === true, 'careerTest 页应装载 window.ArcadeCareer');
    return 'careerNodes=0 dialogs=0 chips=0';
  });
  await check('B03 await __arcadeCareerTest.ready + bridge 装配健康', async () => {
    const ready = await waitCareerReady();
    assert(ready && ready.available === true, 'ready 期望 available=true，实际 ' + detail(ready));
    const info = await cdp.evaluate('window.__arcadeCareerTest.info()');
    assert(info && info.version === '0.18.0', 'bridge 版本期望 0.18.0，实际 ' + detail(info && info.version));
    assert(info.gameId === 'memory-flip', 'gameId 期望 memory-flip，实际 ' + detail(info.gameId));
    assert(info.available === true, 'info.available 期望 true，实际 ' + detail(info.available));
    assert(info.cluesEnabled === true && info.clueCount === 16, '线索内容期望启用 16 条，实际 enabled=' + info.cluesEnabled + ' count=' + info.clueCount);
    assert(info.loadErrors.length === 0, 'bridge loadErrors 非空：' + detail(info.loadErrors));
    assert(info.uiLoaded.clueSurface && info.uiLoaded.mailbox && info.uiLoaded.settings, 'UI 模块未全部装载：' + detail(info.uiLoaded));
    return 'ready=' + detail(ready) + ' clueCount=' + info.clueCount + ' uiLoaded=3';
  });
  await check('B04 seedState 写入 1 条已发现线索（真实 IndexedDB）', async () => {
    const seed = await seedClue(game.clueId, game.slug);
    assert(seed.persisted === true, 'seedState 未持久化：' + detail(seed));
    const state = await cdp.evaluate('window.__arcadeCareerTest.state()');
    assert(state && state.clues && Object.keys(state.clues).length === 1, 'state.clues 期望 1 条，实际 ' + detail(Object.keys((state && state.clues) || {})));
    return 'persisted=true clues=1';
  });
  const canvasBefore = await cdp.evaluate(
    '(() => { const c = document.querySelector(".game-canvas").getBoundingClientRect(); return { x: c.x, y: c.y, width: c.width, height: c.height }; })()'
  );
  await check('B05 renderDebug 渲染唯一 chip（placement=overlay）', async () => {
    const rendered = await renderClue(game.clueId);
    const chip = await measureChip();
    assert(chip && chip.clueId === game.clueId, 'chip clueId 期望 ' + game.clueId + '，实际 ' + detail(chip && chip.clueId));
    assert(chip.count === 1, 'chip 数量期望 1，实际 ' + chip.count);
    assert(rendered.placement === 'overlay' || rendered.placement === 'page-corner', 'placement 异常：' + detail(rendered.placement));
    return 'placement=' + rendered.placement + ' count=1';
  });
  await check('B06 chip 语义：role=button / tabindex=0 / aria-label 含「信」/ data-career-clue', async () => {
    const chip = await measureChip();
    assert(chip.role === 'button', 'role 期望 button，实际 ' + detail(chip.role));
    assert(chip.tabindex === '0', 'tabindex 期望 0，实际 ' + detail(chip.tabindex));
    assert(chip.ariaLabel.indexOf('信') >= 0, 'aria-label 应含「信」，实际 ' + detail(chip.ariaLabel));
    assert(chip.ariaLabel.indexOf('牌背纸条') >= 0, 'aria-label 应含线索标题「牌背纸条」，实际 ' + detail(chip.ariaLabel));
    return 'aria-label=' + chip.ariaLabel;
  });
  await check('B07 chip 热区 ≥44×44（视觉药丸可更小）', async () => {
    const chip = await measureChip();
    assert(chip.rect.width >= 43.5 && chip.rect.height >= 43.5, '热区期望 ≥44×44，实际 ' + formatRect(chip.rect));
    const pill = await cdp.evaluate(
      '(() => { const n = document.querySelector("[data-career-clue] .ac-career-clue__pill"); if (!n) return null; const r = n.getBoundingClientRect(); return { width: r.width, height: r.height }; })()'
    );
    return 'hit=' + formatRect(chip.rect) + ' pill=' + detail(pill);
  });
  await check('B08 chip 不遮挡画布中心主操作区（中央 25%–75%）', async () => {
    const chip = await measureChip();
    assert(chip.canvas, '页面缺少 .game-canvas，无法判定中心区');
    assert(chip.overlap && chip.overlap.intersects === false, 'chip 与画布中心区相交：ix=' + (chip.overlap && chip.overlap.ix) + ' iy=' + (chip.overlap && chip.overlap.iy) + ' chip=' + formatRect(chip.rect) + ' canvas=' + formatRect(chip.canvas));
    return 'chip=' + formatRect(chip.rect) + ' canvas=' + formatRect(chip.canvas) + ' center=' + formatRect({ x: chip.center.x, y: chip.center.y, width: chip.center.width, height: chip.center.height }) + ' iy=' + round(chip.overlap.iy);
  });
  await check('B09 chip 出现不导致页面横向滚动', async () => {
    const chip = await measureChip();
    assert(chip.scrollWidth <= chip.clientWidth + 1, 'documentElement 横向溢出：scrollWidth=' + chip.scrollWidth + ' > clientWidth=' + chip.clientWidth);
    assert(chip.bodyScrollWidth <= chip.bodyClientWidth + 1, 'body 横向溢出：scrollWidth=' + chip.bodyScrollWidth + ' > clientWidth=' + chip.bodyClientWidth);
    return 'doc=' + chip.scrollWidth + '/' + chip.clientWidth + ' body=' + chip.bodyScrollWidth + '/' + chip.bodyClientWidth;
  });
  await check('B10 chip 不挤动画布/结算布局（absolute 定位）', async () => {
    const chip = await measureChip();
    assert(chip.position === 'absolute', 'chip position 期望 absolute，实际 ' + chip.position);
    assertNear(chip.canvas.x, canvasBefore.x, 0.6, 'canvas.x');
    assertNear(chip.canvas.y, canvasBefore.y, 0.6, 'canvas.y');
    assertNear(chip.canvas.width, canvasBefore.width, 0.6, 'canvas.width');
    assertNear(chip.canvas.height, canvasBefore.height, 0.6, 'canvas.height');
    return 'canvas 前后一致 ' + formatRect(chip.canvas);
  });
  /* 宿主 Chrome 可能默认 reduce；默认媒体基线显式仿真 no-preference，保证门禁可复现。 */
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await check('B11 默认媒体下 chip 有一次性淡入动画（对照基线）', async () => {
    const chip = await measureChip();
    assert(chip.animationName !== 'none', '默认媒体下 chip 应有淡入动画，实际 animation-name=' + chip.animationName);
    assert(chip.transitionDuration === '0s', 'chip 不应有 transition，实际 ' + chip.transitionDuration);
    return 'animation=' + chip.animationName + ' ' + chip.animationDuration;
  });
  await waitOpacitySettled('[data-career-clue]');
  await cdp.screenshot('career-a11y-chip-390.png');

  let tabPresses = 0;
  await check('B12 键盘 Tab 可聚焦 chip', async () => {
    tabPresses = await focusChipByTab(40);
    const focused = await cdp.evaluate(
      '(() => { const a = document.activeElement; return { clue: a && a.getAttribute && a.getAttribute("data-career-clue"), label: a && a.getAttribute && a.getAttribute("aria-label") }; })()'
    );
    assert(focused.clue === game.clueId, 'Tab 后焦点 clueId 期望 ' + game.clueId + '，实际 ' + detail(focused));
    return 'Tab × ' + tabPresses + ' 后聚焦 aria-label=' + focused.label;
  });
  await check('B13 键盘 Enter 打开信箱一次（role=dialog 语义）', async () => {
    await KEY.enter();
    await waitPanel('mailbox');
    const panel = await measurePanel('mailbox');
    assert(panel.sheetRole === 'dialog', '信箱面板 role 期望 dialog，实际 ' + detail(panel.sheetRole));
    assert(panel.ariaModal === 'true', 'aria-modal 期望 true，实际 ' + detail(panel.ariaModal));
    const count = await cdp.evaluate('document.querySelectorAll(\'[data-career-panel="mailbox"]\').length');
    assert(count === 1, 'Enter 后信箱浮层数量期望 1，实际 ' + count);
    return 'panels=1 role=dialog aria-modal=true';
  });
  await check('B14 信箱 aria-labelledby 指向可见标题「旧港信箱」', async () => {
    const panel = await measurePanel('mailbox');
    assert(panel.labelledby, '缺少 aria-labelledby');
    assert(panel.labelledbyText === '旧港信箱', 'aria-labelledby 文本期望「旧港信箱」，实际 ' + detail(panel.labelledbyText));
    assert(panel.titleVisible === true, 'aria-labelledby 指向的标题不可见');
    return 'labelledby=' + panel.labelledby + ' → ' + panel.labelledbyText;
  });
  await check('B15 打开后焦点进入对话框（面板内）', async () => {
    const panel = await measurePanel('mailbox');
    assert(panel.focusInsideDialog === true, '焦点未进入对话框，当前 activeElement=' + detail(panel.activeElement));
    return 'activeElement=' + panel.activeElement;
  });
  await check('B16 关闭按钮可访问名称非空（收起信箱）', async () => {
    const panel = await measurePanel('mailbox');
    assert(panel.closeVisible === true, '关闭按钮不可见');
    assert(panel.closeAccessibleName.length > 0, '关闭按钮可访问名称为空');
    return 'name=' + panel.closeAccessibleName;
  });
  await check('B17 aria-live polite 读屏播报区域存在', async () => {
    const panel = await measurePanel('mailbox');
    const polite = panel.liveRegions.filter((region) => region.live === 'polite');
    assert(polite.length >= 1, '面板内无 aria-live=polite 区域：' + detail(panel.liveRegions));
    return 'aria-live=' + polite.length + '（' + polite.map((r) => r.className).join(',') + '）';
  });
  await check('B18 Esc 关闭信箱且焦点返回 chip', async () => {
    await KEY.escape();
    await cdp.waitFor('!document.querySelector(\'[data-career-panel="mailbox"]\')', { timeout: 5000 });
    await cdp.waitFor('!!(document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute("data-career-clue"))', { timeout: 3000 });
    const focused = await cdp.evaluate('document.activeElement.getAttribute("data-career-clue")');
    assert(focused === game.clueId, 'Esc 后焦点期望返回 ' + game.clueId + '，实际 ' + detail(focused));
    return 'focus-returned=' + focused;
  });
  await check('B19 键盘 Space 再次打开信箱一次，并可点关闭按钮关闭', async () => {
    await KEY.space();
    await waitPanel('mailbox');
    const count = await cdp.evaluate('document.querySelectorAll(\'[data-career-panel="mailbox"]\').length');
    assert(count === 1, 'Space 后信箱浮层数量期望 1，实际 ' + count);
    await closePanelByButton('mailbox');
    const remaining = await cdp.evaluate('document.querySelectorAll(\'[data-career-panel]\').length');
    assert(remaining === 0, '关闭后仍有面板残留：' + remaining);
    return 'Space opened once; close-button closed';
  });
  await check('B20 关闭后重开 openMailbox() 仍能看到同一条线索', async () => {
    const opened = await cdp.evaluate('window.__arcadeCareerTest.openMailbox()');
    await waitPanel('mailbox');
    const panel = await measurePanel('mailbox');
    assert(opened && opened.ok === true, 'openMailbox 返回异常：' + detail(opened));
    assert(panel.itemIds.indexOf(game.clueId) >= 0, '重开信箱缺少线索 ' + game.clueId + '，实际 ' + detail(panel.itemIds));
    assert(panel.text.indexOf(game.title) >= 0, '重开信箱文本缺少标题「' + game.title + '」');
    return 'items=' + detail(panel.itemIds) + ' title=' + game.title;
  });
  await check('B21 信箱仅列出已发现线索（未发现 clueId/标题不出现）', async () => {
    const panel = await measurePanel('mailbox');
    assert(panel.itemIds.length === 1, '已发现 1 条线索时信箱条目期望 1，实际 ' + panel.itemIds.length + '（' + detail(panel.itemIds) + '）');
    assert(panel.itemIds.indexOf(game.undiscoveredClueId) === -1, '未发现线索 ' + game.undiscoveredClueId + ' 出现在信箱');
    assert(panel.text.indexOf(game.undiscoveredTitle) === -1, '未发现线索标题「' + game.undiscoveredTitle + '」出现在信箱文本');
    const domHasUndiscovered = await cdp.evaluate(
      'document.querySelectorAll(' + JSON.stringify('[data-clue-id="' + game.undiscoveredClueId + '"]') + ').length'
    );
    assert(domHasUndiscovered === 0, '未发现线索 DOM 节点出现 ' + domHasUndiscovered + ' 个');
    return 'items=1 undiscoveredHidden=true';
  });
  await check('B22 390×844 信箱无横向溢出且可见按钮 ≥44px', async () => {
    const panel = await measurePanel('mailbox');
    assert(panel.docScrollWidth <= panel.docClientWidth + 1, '页面横向溢出：' + panel.docScrollWidth + ' > ' + panel.docClientWidth);
    assert(panel.sheetScrollWidth <= panel.sheetClientWidth + 1, '信箱 sheet 横向溢出：' + panel.sheetScrollWidth + ' > ' + panel.sheetClientWidth);
    assert(panel.overlayScrollWidth <= panel.overlayClientWidth + 1, '信箱 overlay 横向溢出：' + panel.overlayScrollWidth + ' > ' + panel.overlayClientWidth);
    assert(panel.buttonsAllAtLeast44 === true, '可见按钮存在 <44px：' + detail(panel.buttons.filter((b) => b.width < 43.5 || b.height < 43.5)));
    return 'sheet=' + panel.sheetScrollWidth + '/' + panel.sheetClientWidth + ' buttons=' + panel.buttons.length + ' all≥44';
  });
  await waitOpacitySettled('[data-career-panel="mailbox"]');
  await cdp.screenshot('career-a11y-mailbox-390.png');
  await closePanelByButton('mailbox');

  /* ---------- 设置开关 ---------- */
  await check('B23 openSettings() 打开设置面板 + 开关初始 aria-checked=true', async () => {
    const opened = await cdp.evaluate('window.ArcadeCareer.openSettings()');
    await waitPanel('settings');
    assert(opened && opened.ok === true, 'openSettings 返回异常：' + detail(opened));
    const data = await cdp.evaluate(`(() => {
      const panel = document.querySelector('[data-career-panel="settings"]');
      const sw = panel.querySelector('[role="switch"]');
      return { checked: sw ? sw.getAttribute('aria-checked') : null, hasSwitch: !!sw, text: (panel.innerText || '').replace(/\\s+/g, ' ').slice(0, 200) };
    })()`);
    assert(data.hasSwitch, '设置面板缺少 role=switch 开关');
    assert(data.checked === 'true', '开关初始 aria-checked 期望 true，实际 ' + detail(data.checked));
    return 'switch=true';
  });
  await check('B24 关闭线索提示：state().hintsEnabled=false 且开关同步', async () => {
    await cdp.evaluate('document.querySelector(\'[data-career-panel="settings"] [role="switch"]\').click()');
    await cdp.waitFor('window.__arcadeCareerTest.state().hintsEnabled === false', { timeout: 5000 });
    const data = await cdp.evaluate(`(() => {
      const sw = document.querySelector('[data-career-panel="settings"] [role="switch"]');
      return { hintsEnabled: window.__arcadeCareerTest.state().hintsEnabled, aria: sw ? sw.getAttribute('aria-checked') : null, text: sw ? sw.innerText.replace(/\\s+/g, ' ').trim() : null };
    })()`);
    assert(data.hintsEnabled === false, 'state().hintsEnabled 期望 false，实际 ' + detail(data.hintsEnabled));
    assert(data.aria === 'false', '开关 aria-checked 期望 false，实际 ' + detail(data.aria));
    return 'hintsEnabled=false aria-checked=false switchText=' + detail(data.text);
  });
  await check('B25 再次开启恢复：state().hintsEnabled=true 且开关同步', async () => {
    await cdp.evaluate('document.querySelector(\'[data-career-panel="settings"] [role="switch"]\').click()');
    await cdp.waitFor('window.__arcadeCareerTest.state().hintsEnabled === true', { timeout: 5000 });
    const data = await cdp.evaluate(`(() => {
      const sw = document.querySelector('[data-career-panel="settings"] [role="switch"]');
      return { hintsEnabled: window.__arcadeCareerTest.state().hintsEnabled, aria: sw ? sw.getAttribute('aria-checked') : null };
    })()`);
    assert(data.hintsEnabled === true, 'state().hintsEnabled 期望 true，实际 ' + detail(data.hintsEnabled));
    assert(data.aria === 'true', '开关 aria-checked 期望 true，实际 ' + detail(data.aria));
    return 'hintsEnabled=true aria-checked=true';
  });
  await closeAllPanels();
  await check('B26 开关切换后已发现线索仍在信箱', async () => {
    const opened = await cdp.evaluate('window.ArcadeCareer.openMailbox()');
    await waitPanel('mailbox');
    const panel = await measurePanel('mailbox');
    assert(opened && opened.ok === true, 'openMailbox 返回异常：' + detail(opened));
    assert(panel.itemIds.indexOf(game.clueId) >= 0, '开关切换后信箱缺少 ' + game.clueId + '，实际 ' + detail(panel.itemIds));
    return 'items=' + detail(panel.itemIds);
  });
  await closeAllPanels();

  /* ---------- reduced motion（真实 CDP 媒体仿真） ---------- */
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await check('B27 对照：默认媒体下 chip 动画存在', async () => {
    const chip = await measureChip();
    assert(chip && chip.animationName !== 'none', '默认媒体 chip animation-name 期望非 none，实际 ' + detail(chip && chip.animationName));
    return 'animation=' + chip.animationName + ' duration=' + chip.animationDuration;
  });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await check('B28 prefers-reduced-motion: reduce 下 chip 无动画/过渡', async () => {
    const chip = await measureChip();
    assert(chip, 'reduce 模式下 chip 丢失');
    assert(chip.animationName === 'none', 'reduce 下 chip animation-name 期望 none，实际 ' + chip.animationName);
    assert(chip.animationDuration === '0s', 'reduce 下 chip animation-duration 期望 0s，实际 ' + chip.animationDuration);
    assert(chip.transitionDuration === '0s', 'reduce 下 chip transition 期望 0s，实际 ' + chip.transitionDuration);
    return 'animation=none duration=0s';
  });
  await check('B29 reduce 下信箱浮层/面板无动画（含 is-reduced-motion 双保险）', async () => {
    await cdp.evaluate('window.ArcadeCareer.openMailbox()');
    await waitPanel('mailbox');
    const data = await cdp.evaluate(`(() => {
      const overlay = document.querySelector('[data-career-panel="mailbox"]');
      const sheet = overlay.querySelector('.ac-career-sheet');
      return {
        hasClass: overlay.classList.contains('is-reduced-motion'),
        overlayAnim: getComputedStyle(overlay).animationName,
        overlayDur: getComputedStyle(overlay).animationDuration,
        sheetAnim: getComputedStyle(sheet).animationName,
        sheetDur: getComputedStyle(sheet).animationDuration,
      };
    })()`);
    assert(data.hasClass === true, 'overlay 缺少 is-reduced-motion 类（bridge ctx.reducedMotion 未生效）');
    assert(data.overlayAnim === 'none' && data.overlayDur === '0s', 'overlay 动画未关闭：' + detail(data));
    assert(data.sheetAnim === 'none' && data.sheetDur === '0s', 'sheet 动画未关闭：' + detail(data));
    await waitOpacitySettled('[data-career-panel="mailbox"]');
    await cdp.screenshot('career-a11y-reduced-motion.png');
    return 'overlay=none sheet=none';
  });
  await closeAllPanels();
  await check('B30 reduce 下设置面板旋钮无过渡', async () => {
    await cdp.evaluate('window.ArcadeCareer.openSettings()');
    await waitPanel('settings');
    const data = await cdp.evaluate(`(() => {
      const knob = document.querySelector('[data-career-panel="settings"] .ac-career-switch__knob');
      const panel = document.querySelector('[data-career-panel="settings"]');
      return { knobTransition: knob ? getComputedStyle(knob).transitionDuration : null, isReduced: panel.classList.contains('is-reduced-motion') };
    })()`);
    assert(data.isReduced === true, '设置面板缺少 is-reduced-motion 类');
    assert(data.knobTransition === '0s', 'reduce 下旋钮 transition-duration 期望 0s，实际 ' + detail(data.knobTransition));
    return 'knobTransition=0s';
  });
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await closeAllPanels();
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await check('B31 恢复媒体后动画回归（媒体仿真可逆）', async () => {
    const chip = await measureChip();
    assert(chip && chip.animationName !== 'none', '恢复媒体后 chip animation-name 期望非 none，实际 ' + detail(chip && chip.animationName));
    return 'animation=' + chip.animationName;
  });

  /* ---------- 四档窄屏 ---------- */
  for (const size of NARROW) {
    const label = size.width + '×' + size.height;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: true });
    await cdp.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
    await resetAndSeed(game.clueId, game.slug);
    const chip = await measureChip();
    await check('N' + size.width + '-a ' + label + ' chip：热区 ≥44×44 且无横向溢出、不压中心区', async () => {
      assert(chip.rect.width >= 43.5 && chip.rect.height >= 43.5, label + ' chip 热区不足：' + formatRect(chip.rect));
      assert(chip.scrollWidth <= chip.clientWidth + 1, label + ' 页面横向溢出：scrollWidth=' + chip.scrollWidth + ' > clientWidth=' + chip.clientWidth);
      assert(chip.overlap && chip.overlap.intersects === false, label + ' chip 与画布中心区相交：chip=' + formatRect(chip.rect) + ' canvas=' + formatRect(chip.canvas) + ' iy=' + round(chip.overlap && chip.overlap.iy));
      return 'chip=' + formatRect(chip.rect) + ' scroll=' + chip.scrollWidth + '/' + chip.clientWidth;
    });
    await cdp.evaluate('window.ArcadeCareer.openMailbox()');
    await waitPanel('mailbox');
    const mailbox = await measurePanel('mailbox');
    if (size.width === 320) {
      await waitOpacitySettled('[data-career-panel="mailbox"]');
      await cdp.screenshot('career-a11y-320-mailbox.png');
    }
    let mailboxCloseOk = true;
    let mailboxCloseDetail = '';
    try {
      await closePanelByButton('mailbox');
    } catch (err) {
      mailboxCloseOk = false;
      mailboxCloseDetail = err && err.message ? err.message : String(err);
    }
    await check('N' + size.width + '-b ' + label + ' 信箱：无横向溢出、可见按钮 ≥44px、可关闭', async () => {
      assert(mailbox.docScrollWidth <= mailbox.docClientWidth + 1, label + ' 页面横向溢出：' + mailbox.docScrollWidth + ' > ' + mailbox.docClientWidth);
      assert(mailbox.sheetScrollWidth <= mailbox.sheetClientWidth + 1, label + ' 信箱 sheet 横向溢出：' + mailbox.sheetScrollWidth + ' > ' + mailbox.sheetClientWidth);
      assert(mailbox.overlayScrollWidth <= mailbox.overlayClientWidth + 1, label + ' 信箱 overlay 横向溢出：' + mailbox.overlayScrollWidth + ' > ' + mailbox.overlayClientWidth);
      assert(mailbox.buttonsAllAtLeast44 === true, label + ' 可见按钮 <44px：' + detail(mailbox.buttons.filter((b) => b.width < 43.5 || b.height < 43.5)));
      assert(mailboxCloseOk, label + ' 信箱无法通过关闭按钮关闭：' + mailboxCloseDetail);
      return 'sheet=' + mailbox.sheetScrollWidth + '/' + mailbox.sheetClientWidth + ' buttons=' + mailbox.buttons.length + ' all≥44 closed=true';
    });
    await cdp.evaluate('window.ArcadeCareer.openSettings()');
    await waitPanel('settings');
    const settings = await measurePanel('settings');
    if (size.width === 430) {
      await waitOpacitySettled('[data-career-panel="settings"]');
      await cdp.screenshot('career-a11y-430-settings.png');
    }
    let settingsCloseOk = true;
    let settingsCloseDetail = '';
    try {
      await closePanelByButton('settings');
    } catch (err) {
      settingsCloseOk = false;
      settingsCloseDetail = err && err.message ? err.message : String(err);
    }
    await check('N' + size.width + '-c ' + label + ' 设置：无横向溢出、可见按钮 ≥44px、可关闭', async () => {
      assert(settings.docScrollWidth <= settings.docClientWidth + 1, label + ' 页面横向溢出：' + settings.docScrollWidth + ' > ' + settings.docClientWidth);
      assert(settings.sheetScrollWidth <= settings.sheetClientWidth + 1, label + ' 设置 sheet 横向溢出：' + settings.sheetScrollWidth + ' > ' + settings.sheetClientWidth);
      assert(settings.overlayScrollWidth <= settings.overlayClientWidth + 1, label + ' 设置 overlay 横向溢出：' + settings.overlayScrollWidth + ' > ' + settings.overlayClientWidth);
      assert(settings.buttonsAllAtLeast44 === true, label + ' 可见按钮 <44px：' + detail(settings.buttons.filter((b) => b.width < 43.5 || b.height < 43.5)));
      assert(settingsCloseOk, label + ' 设置面板无法通过关闭按钮关闭：' + settingsCloseDetail);
      return 'sheet=' + settings.sheetScrollWidth + '/' + settings.sheetClientWidth + ' buttons=' + settings.buttons.length + ' all≥44 closed=true';
    });
    await closeAllPanels();
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: true });
  await cdp.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');

  /* ---------- 清除线索必须二次确认 ---------- */
  await resetAndSeed(game.clueId, game.slug);
  await check('B32 清除线索需二次确认：仅点「清除本机线索记录」不改 discovery', async () => {
    await cdp.evaluate('window.ArcadeCareer.openSettings()');
    await waitPanel('settings');
    const clicked = await cdp.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('[data-career-panel="settings"] button')).find((node) => (node.innerText || '').indexOf('清除本机线索记录') >= 0);
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert(clicked, '设置面板未找到「清除本机线索记录」按钮');
    await cdp.waitFor('!!document.querySelector(\'[data-career-panel="settings"] .ac-career-confirm:not([hidden])\')', { timeout: 5000 });
    const data = await cdp.evaluate(`(() => {
      const panel = document.querySelector('[data-career-panel="settings"]');
      const confirm = panel.querySelector('.ac-career-confirm:not([hidden])');
      return { confirmVisible: !!(confirm && confirm.getBoundingClientRect().height > 0), confirmText: confirm ? confirm.innerText.replace(/\\s+/g, ' ').trim() : '', clues: Object.keys(window.__arcadeCareerTest.state().clues || {}).length, text: panel.innerText.replace(/\\s+/g, ' ').slice(0, 300) };
    })()`);
    assert(data.confirmVisible === true, '未出现可见的二次确认块');
    assert(data.clues === 1, '未确认前 state.clues 期望不变（1），实际 ' + data.clues);
    assert(data.confirmText.indexOf('确认清除') >= 0 && data.confirmText.indexOf('取消') >= 0, '确认块缺少「取消 / 确认清除」：' + detail(data.confirmText));
    await waitOpacitySettled('[data-career-panel="settings"]');
    await cdp.screenshot('career-a11y-confirm-390.png');
    return 'confirm visible, clues unchanged=1';
  });
  await check('B33 取消确认不改 discovery', async () => {
    const cancelled = await cdp.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('[data-career-panel="settings"] .ac-career-confirm:not([hidden]) button')).find((node) => (node.innerText || '').trim() === '取消');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert(cancelled, '未找到「取消」按钮');
    await cdp.waitFor('!document.querySelector(\'[data-career-panel="settings"] .ac-career-confirm:not([hidden])\')', { timeout: 5000 });
    const clues = await cdp.evaluate('Object.keys(window.__arcadeCareerTest.state().clues || {}).length');
    assert(clues === 1, '取消后 state.clues 期望 1，实际 ' + clues);
    return 'cancel no-op clues=1';
  });
  await check('B34 确认清除后清空 discovery（state.clues=0）', async () => {
    const opened = await cdp.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('[data-career-panel="settings"] button')).find((node) => (node.innerText || '').indexOf('清除本机线索记录') >= 0);
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert(opened, '未找到「清除本机线索记录」按钮');
    await cdp.waitFor('!!document.querySelector(\'[data-career-panel="settings"] .ac-career-confirm:not([hidden])\')', { timeout: 5000 });
    const confirmed = await cdp.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('[data-career-panel="settings"] button')).find((node) => (node.innerText || '').trim() === '确认清除');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert(confirmed, '未找到「确认清除」按钮');
    await cdp.waitFor('Object.keys(window.__arcadeCareerTest.state().clues || {}).length === 0', { timeout: 8000 });
    const data = await cdp.evaluate(`(() => {
      const panel = document.querySelector('[data-career-panel="settings"]');
      const status = panel ? panel.querySelector('.ac-career-status') : null;
      return { clues: Object.keys(window.__arcadeCareerTest.state().clues || {}).length, status: status && !status.hidden ? status.textContent : null };
    })()`);
    assert(data.clues === 0, '确认清除后 state.clues 期望 0，实际 ' + data.clues);
    assert(data.status && data.status.indexOf('清空') >= 0, '成功状态提示缺失，实际 ' + detail(data.status));
    return 'clues=0 status=' + data.status;
  });
  await closeAllPanels();
  await check('B35 清除后信箱为空态且 chip 被移除', async () => {
    const opened = await cdp.evaluate('window.ArcadeCareer.openMailbox()');
    await waitPanel('mailbox');
    const panel = await measurePanel('mailbox');
    assert(opened && opened.ok === true, 'openMailbox 返回异常：' + detail(opened));
    assert(panel.itemIds.length === 0, '清除后信箱仍列 ' + panel.itemIds.length + ' 条线索：' + detail(panel.itemIds));
    assert(panel.text.indexOf('信箱还空着') >= 0, '清除后缺少空态文案「信箱还空着」');
    await closeAllPanels();
    const chips = await cdp.evaluate('document.querySelectorAll("[data-career-clue]").length');
    assert(chips === 0, '清除后 chip 仍残留 ' + chips + ' 个');
    return 'items=0 emptyText=true chips=0';
  });

  /* ---------- 忽略 chip 后经典可继续 ---------- */
  await check('B36 忽略 chip 后点击「开始游戏」经典可继续（ready → playing）', async () => {
    await resetAndSeed(game.clueId, game.slug);
    const before = await cdp.evaluate('window.__arcadeTest.joyInfo().state');
    const clicked = await cdp.evaluate(
      '(() => { const button = document.querySelector("[data-overlay] [data-ov-btn]"); if (!button) return false; button.click(); return true; })()'
    );
    assert(clicked, '未找到开始游戏按钮 [data-ov-btn]');
    await cdp.waitFor('window.__arcadeTest.joyInfo().state === "playing"', { timeout: 8000 });
    const after = await cdp.evaluate('window.__arcadeTest.joyInfo().state');
    assert(before === 'ready', '点击前状态期望 ready，实际 ' + detail(before));
    assert(after === 'playing', '点击后状态期望 playing，实际 ' + detail(after));
    const chipStill = await cdp.evaluate('document.querySelectorAll("[data-career-clue]").length');
    assert(chipStill === 1, '未被点击的 chip 应仍在 DOM（被忽略而非被消费），实际 ' + chipStill);
    await waitNoToast();
    await cdp.screenshot('career-a11y-classic-playing-390.png');
    return 'ready→playing，chip 未点击仍在 DOM';
  });
  await check('B37 memory-flip careerTest 全程无页面错误', async () => {
    const errors = cdp.errors.slice();
    assert(errors.length === 0, '页面出现 console/异常错误：' + detail(errors.slice(0, 3)));
    return 'errors=0（含键盘、面板、窄屏与清除流程）';
  });
}

/* ------------------------------------------------------------------ *
 * 会话 C/D：另外两款代表游戏页（CTA 扫描 + chip 无障碍冒烟）
 * ------------------------------------------------------------------ */

async function runGamePageSession(game, prefix) {
  await navigate(BASE + '/apps/arcade/games/' + game.slug + '.html?careerTest=1#test');
  const errorsAtLoad = cdp.errors.slice();
  await check(prefix + '01 ' + game.slug + ' 首屏可见文本/按钮无生涯 CTA', async () => {
    const scan = await scanFirstScreen();
    assertNoCta(scan, game.slug);
    return 'positive=0 交互元素=' + scan.interactive.length;
  });
  await check(prefix + '02 ' + game.slug + ' 首屏无 career chip / banner / 弹窗', async () => {
    const scan = await scanFirstScreen();
    assertNoFirstScreenCareer(scan, game.slug, true);
    assert(scan.hasCareerBridge === true, game.slug + ' careerTest 页应装载 window.ArcadeCareer');
    return 'careerNodes=0 dialogs=0 chips=0';
  });
  await check(prefix + '03 ' + game.slug + ' ready 后 seed + renderDebug 渲染无障碍 chip', async () => {
    const ready = await waitCareerReady();
    assert(ready && ready.available === true, 'ready 期望 available=true，实际 ' + detail(ready));
    await seedClue(game.clueId, game.slug);
    await renderClue(game.clueId);
    const chip = await measureChip();
    assert(chip.role === 'button' && chip.tabindex === '0', 'chip 语义异常：role=' + chip.role + ' tabindex=' + chip.tabindex);
    assert(chip.ariaLabel.indexOf('信') >= 0, 'aria-label 应含「信」，实际 ' + detail(chip.ariaLabel));
    assert(chip.rect.width >= 43.5 && chip.rect.height >= 43.5, 'chip 热区不足：' + formatRect(chip.rect));
    return 'aria-label=' + chip.ariaLabel + ' rect=' + formatRect(chip.rect);
  });
  await check(prefix + '04 ' + game.slug + ' chip 不压画布中心区且无横向滚动', async () => {
    const chip = await measureChip();
    assert(chip.overlap && chip.overlap.intersects === false, 'chip 与画布中心区相交：chip=' + formatRect(chip.rect) + ' canvas=' + formatRect(chip.canvas) + ' iy=' + round(chip.overlap && chip.overlap.iy));
    assert(chip.scrollWidth <= chip.clientWidth + 1, '页面横向溢出：' + chip.scrollWidth + ' > ' + chip.clientWidth);
    await waitOpacitySettled('[data-career-clue]');
    await cdp.screenshot('career-a11y-' + game.slug + '-chip-390.png');
    return 'chip=' + formatRect(chip.rect) + ' scroll=' + chip.scrollWidth + '/' + chip.clientWidth;
  });
  await check(prefix + '05 ' + game.slug + ' 页面无错误', async () => {
    assert(errorsAtLoad.length === 0, '页面 console/异常错误：' + detail(errorsAtLoad.slice(0, 3)));
    return 'errors=0';
  });
}

/* ------------------------------------------------------------------ *
 * 收尾：测试结束 deleteDatabase
 * ------------------------------------------------------------------ */

async function runCleanupSession() {
  await navigate(BASE + '/apps/arcade/index.html');
  await check('S03 测试结束 indexedDB.deleteDatabase 成功', async () => {
    const deleted = await deleteCareerDatabase();
    assert(deleted && deleted.ok === true, 'deleteDatabase 失败：' + detail(deleted));
    return 'deleted ok';
  });
  await check('S04 测试结束后 career IndexedDB 不存在（无残留）', async () => {
    const dbs = await careerDatabaseNames();
    assert(dbs.supported, 'indexedDB.databases() 不可用：' + detail(dbs));
    assert(dbs.names.indexOf(DB_NAME) === -1, '测试结束后仍存在 ' + DB_NAME + '：' + detail(dbs.names));
    return 'careerDbExists=false';
  });
  await check('S05 收尾页面无错误', async () => {
    assert(cdp.errors.length === 0, '页面 console/异常错误：' + detail(cdp.errors.slice(0, 3)));
    return 'errors=0';
  });
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main() {
  for (const rel of REQUIRED_FILES) {
    const absolute = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(absolute)) throw new Error('缺少必需文件：' + absolute);
  }
  fs.mkdirSync(ARTIFACTS, { recursive: true });

  SERVER_PORT = envPort('CAREER_A11Y_PORT', Number(arg('port', 8832)) || 8832);
  CDP_PORT = envPort('CAREER_A11Y_CDP_PORT', Number(arg('cdp-port', 9432)) || 9432);
  BASE = 'http://127.0.0.1:' + SERVER_PORT;
  console.log('D15-15 可访问性与低干扰视觉复验（Chrome headless CDP）');
  console.log('server=' + BASE + ' cdp-port=' + CDP_PORT + ' artifacts=' + ARTIFACTS);
  console.log('');

  let server = null;
  let launched = null;
  let hardFailure = false;
  try {
    server = await startServer({ root: REPO_ROOT, port: SERVER_PORT });
    launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'studiokit-career-a11y-' });
    cdp = await openPage({ port: CDP_PORT, ...VIEWPORT, deviceScaleFactor: 1, mobile: true, artifactsDir: ARTIFACTS });
    await cdp.send('Network.enable');

    /* 起始清理：先打开中心页并 deleteDatabase（测试隔离）。 */
    await navigate(BASE + '/apps/arcade/index.html');
    await check('S00 页面装配成功并打开中心页', async () => {
      const arcade = await cdp.evaluate('!!window.Arcade && !!document.querySelector(".hall-card")');
      assert(arcade, '中心页未加载 Arcade 运行时或游戏卡片');
      return 'window.Arcade + .hall-card';
    });
    const startDeleted = await deleteCareerDatabase();
    record('S01 测试起始 indexedDB.deleteDatabase 成功（隔离）', !!(startDeleted && startDeleted.ok), startDeleted && startDeleted.ok ? 'deleted ok' : '失败：' + detail(startDeleted));

    /* 注意：S01 已作为独立断言记录；runCenterSession 内不再重复。 */
    await runCenterSession();
    await runSilentSession();
    await runCareerSession();
    await runGamePageSession(GAME_PAGES[1], 'P'); // pendulum-tower
    await runGamePageSession(GAME_PAGES[2], 'Q'); // star-raid
    await runCleanupSession();

    const result = summary('checks');
    return result.failed ? 1 : 0;
  } catch (err) {
    hardFailure = true;
    console.error('FAIL  环境/装配失败：' + (err && err.stack ? err.stack : err));
    return 2;
  } finally {
    if (cdp) {
      try {
        await closeAllPanels();
      } catch (err) {
        /* ignore */
      }
      try {
        cdp.close();
      } catch (err) {
        /* ignore */
      }
    }
    if (launched) {
      try {
        await stopChrome(launched);
      } catch (err) {
        /* ignore */
      }
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (hardFailure) console.error('\n0/0 checks passed（装配未完成）');
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('FAIL  ' + (err && err.stack ? err.stack : err));
    process.exit(2);
  });
