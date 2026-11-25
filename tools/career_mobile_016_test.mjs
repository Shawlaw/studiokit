#!/usr/bin/env node
/**
 * D16-13 机库 / 收据 / 剧情 · 移动端专项（0.16 First Flight）
 *
 * 覆盖（对应任务卡矩阵）：
 *   1. 四档宽度（320×568 / 375×667 / 390×844 / 430×932）× 五个面板
 *      （town / hangar / receipt / mailbox / settings）：
 *      documentElement / body / panel 无横向溢出、sheet rect 在视口内、
 *      可见按钮 ≥44×44、面板滚动区可达末项、关闭按钮可点且确实关闭。
 *   2. PWA 独立窗口模拟：390×844 + display-mode: standalone（matchMedia 注入）
 *      + safe-area（CDP Emulation.setSafeAreaInsetsOverride 注入 top=47 / bottom=34，
 *      等价于真机 env(safe-area-inset-*)）：面板不被顶部/底部裁切、按钮可点、无横向溢出。
 *   3. 入口可发现：LOCAL 信件 → 信箱「按地址投递 · 去港口」→ 告示板；
 *      告示板可见机库 / 钱包 / 线索提示；每步可关闭/返回，不困在面板。
 *      首屏不得出现生涯 CTA / 面板。
 *   4. 剧情目标行：tower / star 职业 run 开局弹层目标行 4 档宽度完整可见、
 *      不遮挡开始按钮、≤2 行（Range.getClientRects() 计真实行盒）；经典模式无目标行。
 *   5. Esc / 键盘 / 焦点：每面板真实 CDP Esc 关闭并归还焦点、Tab 不逃离最上层 panel、
 *      叠层 town→hangar→receipt Esc 先关最上层。
 *   6. reduced-motion：UI 动画/过渡 none；面板开关无布局抖动（记录 body 滚动尺寸与位置）。
 *   7. 触控命中：Input.dispatchTouchEvent 真实触控点击（说明：矩阵里的“关闭可达”用
 *      CDP 鼠标点击 Input.dispatchMouseEvent，主操作 接单/购买/租用/关闭 全部走真实触控）。
 *   8. 全程 console error = 0（外部噪声分类记录）；结束 deleteDatabase 与清理。
 *
 * 只读产品代码：不修改仓库内任何产品文件；唯一写入为本文件与仓库外截图目录。
 *
 * 运行（PowerShell，仓库根）：
 *   $env:CAREER_MOBILE_PORT='8882'; $env:CAREER_MOBILE_CDP='9482'
 *   node tools/career_mobile_016_test.mjs
 *
 * 环境变量：
 *   CAREER_MOBILE_PORT      本地静态服务器端口（默认 8882）
 *   CAREER_MOBILE_CDP       Chrome DevTools 端口（默认 9482）
 *   CAREER_MOBILE_ARTIFACTS 截图输出目录（默认仓库外
 *                           ..\arcade-life-devkit\work-015-018\qa\artifacts-d16-13）
 *   CHROME_PATH             本机 Chrome 路径（沿用 lib/arcade_cdp.mjs）
 *
 * 退出码：0 全 PASS；1 存在 FAIL；2 用法 / 环境错误（端口、Chrome、启动失败）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REPO_ROOT,
  createRecorder,
  envPort,
  launchChrome,
  openPage,
  sleep,
  startServer,
  stopChrome,
} from './lib/arcade_cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let PORT;
let CDP_PORT;
try {
  PORT = envPort('CAREER_MOBILE_PORT', 8882);
  CDP_PORT = envPort('CAREER_MOBILE_CDP', 9482);
} catch (err) {
  console.error('D16-13 配置错误（退出码 2）：' + String((err && err.message) || err));
  process.exit(2);
}
const ARTIFACTS_DIR =
  process.env.CAREER_MOBILE_ARTIFACTS ||
  path.resolve(REPO_ROOT, '..', 'arcade-life-devkit', 'work-015-018', 'qa', 'artifacts-d16-13');
const WIDTHS = [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
];
const PANEL_IDS = ['mailbox', 'town', 'hangar', 'receipt', 'settings'];
const PANEL_OPENERS = {
  mailbox: 'openMailbox',
  town: 'openTown',
  hangar: 'openHangar',
  receipt: 'openReceipt',
  settings: 'openSettings',
};
const GAME_PAGE = '/apps/arcade/games/pendulum-tower.html?careerTest=1#test';
const STAR_PAGE = '/apps/arcade/games/star-raid.html?careerTest=1';
const TICKET_KEY = 'studiokit:arcade:career:ticket.v1';
const RENTAL_KEY = 'studiokit:arcade:career:rental.v1';
const DB_NAME = 'studiokit:arcade:career';

const { record, assert, summary } = createRecorder();
const shots = [];
const defects = [];

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function fmtRect(rect) {
  if (!rect) return 'null';
  if (Array.isArray(rect)) return '[' + rect.map((v) => round1(v)).join(',') + ']';
  return String(rect);
}

function det(parts) {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== '')
    .map((part) => String(part))
    .join(' ');
}

function fail(message) {
  throw new Error(message);
}

async function safeEval(page, expression, fallback) {
  try {
    return await page.evaluate(expression);
  } catch (err) {
    if (arguments.length >= 3) return fallback;
    throw err;
  }
}

async function waitReady(page, timeout = 20000) {
  await page.waitFor('window.__arcadeCareerTest && window.ArcadeCareer && window.ArcadeCareer.ready', { timeout });
  await page.evaluate('Promise.resolve(window.ArcadeCareer.ready)');
  await sleep(260);
}

/** 职业 run 页面（URL 只有 ?career=，没有 careerTest=1）没有测试钩子，只等公开桥就绪。 */
async function waitBridge(page, timeout = 20000) {
  await page.waitFor('window.ArcadeCareer && window.ArcadeCareer.ready', { timeout });
  await page.evaluate('Promise.resolve(window.ArcadeCareer.ready)');
  await sleep(300);
}

async function setViewport(page, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await sleep(360);
}

async function realKey(page, key, code, vk, modifiers = 0) {
  await page.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    modifiers,
  });
  await page.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    modifiers,
  });
  await sleep(150);
}

async function esc(page) {
  await realKey(page, 'Escape', 'Escape', 27);
}

async function tab(page, shift = false) {
  await realKey(page, 'Tab', 'Tab', 9, shift ? 8 : 0);
}

/** 把元素滚到视口/滚动容器中央，再等待布局稳定（触控点击前必须做）。 */
async function bringIntoView(page, selector) {
  const found = await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' });
    return true;
  })()`);
  if (!found) return null;
  await sleep(240);
  return page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, rect: [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v)) };
  })()`);
}

/** 真实触控点击（Input.dispatchTouchEvent：touchStart → touchEnd，Chrome 合成 click）。 */
async function touchClick(page, selector) {
  const pt = await bringIntoView(page, selector);
  if (!pt) throw new Error('触控目标不存在：' + selector);
  if (pt.x < 0 || pt.y < 0 || pt.x > 100000 || pt.y > 100000) throw new Error('触控坐标非法：' + selector + ' ' + JSON.stringify(pt));
  await page.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: pt.x, y: pt.y, radiusX: 4, radiusY: 4, force: 1, id: 1 }],
  });
  await sleep(40);
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(240);
  return pt;
}

/** 真实鼠标点击（矩阵里“关闭可达”使用；触控主操作另走 touchClick）。 */
async function mouseClick(page, selector) {
  const pt = await bringIntoView(page, selector);
  if (!pt) throw new Error('鼠标目标不存在：' + selector);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none', buttons: 0 });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(40);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(240);
  return pt;
}

async function shot(page, name) {
  const file = await page.screenshot(name);
  shots.push(file);
  return file;
}

async function clearErrors(page, label) {
  const errors = (page.errors || []).slice();
  record(
    'CONSOLE ' + label + ' 无 console error',
    errors.length === 0,
    errors.length ? 'errors=' + JSON.stringify(errors.slice(0, 5)) : 'errors=0'
  );
  return errors;
}

async function closeAllPanels(page) {
  const remaining = await page.evaluate(`(() => {
    const ids = ['mailbox', 'town', 'hangar', 'receipt', 'settings'];
    ids.forEach((id) => {
      const mod = window.ArcadeCareerUI && window.ArcadeCareerUI[id];
      if (mod && typeof mod.close === 'function') {
        try { mod.close(); } catch (err) { /* ignore */ }
      }
    });
    return Array.from(document.querySelectorAll('[data-career-panel]')).map((node) => node.getAttribute('data-career-panel'));
  })()`);
  if (remaining.length) {
    await page.evaluate(`(() => {
      Array.from(document.querySelectorAll('[data-career-panel]')).forEach((node) => {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
      return true;
    })()`);
  }
  await sleep(160);
  return remaining;
}

async function panelPresent(page, id) {
  return !!(await page.evaluate(`!!document.querySelector('[data-career-panel="${id}"]')`));
}

async function openPanel(page, id, { waitMs = 900 } = {}) {
  const opener = PANEL_OPENERS[id];
  const result = await page.evaluate(`(async () => {
    try {
      const returned = window.ArcadeCareer && window.ArcadeCareer.${opener} ? window.ArcadeCareer.${opener}() : null;
      const value = returned && typeof returned.then === 'function' ? await returned : returned;
      if (value && value.ok === false) return { ok: false, reason: value.reason || 'rejected' };
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String((err && err.message) || err) };
    }
  })()`);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await page.waitFor(`!!document.querySelector('[data-career-panel="${id}"]')`, { timeout: 2000 });
      await sleep(waitMs);
      return { ok: true, result };
    } catch (err) {
      /* 懒装载可能仍在进行，再等一轮 */
      await sleep(180);
    }
  }
  return { ok: false, result };
}

/* ------------------------------------------------------------------ *
 * 页面内测量脚本
 * ------------------------------------------------------------------ */

function panelMetricsExpr(id) {
  return `(() => {
    const doc = document;
    const ov = doc.querySelector('[data-career-panel="${id}"]');
    const viewport = { w: innerWidth, h: innerHeight };
    if (!ov) return { open: false, viewport };
    const sheet = ov.querySelector('.ac-career-sheet');
    const body = sheet ? sheet.querySelector('.ac-career-sheet__body') : null;
    const rectOf = (node) => {
      const r = node.getBoundingClientRect();
      return [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * 10) / 10);
    };
    const visible = (node) => {
      if (!node || !node.getClientRects) return false;
      if (node.hidden) return false;
      if (node.closest && node.closest('[hidden]')) return false;
      if (node.closest && node.closest('.ac-career-sr-only')) return false;
      return node.getClientRects().length > 0;
    };
    const buttons = Array.from(sheet ? sheet.querySelectorAll('button') : []).filter(visible).map((node) => {
      const r = node.getBoundingClientRect();
      return {
        label: ((node.getAttribute('aria-label') || node.textContent || '')).replace(/\\s+/g, ' ').trim().slice(0, 28),
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        rect: [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * 10) / 10),
      };
    });
    const overflow = [];
    Array.from(ov.querySelectorAll('*')).forEach((node) => {
      if (!visible(node)) return;
      if (node.closest && node.closest('.ac-career-sr-only')) return;
      const r = node.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) return;
      if (r.left < -1 || r.right > viewport.w + 1) {
        overflow.push({ tag: node.tagName, cls: String(node.className || '').slice(0, 44), rect: [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * 10) / 10) });
      }
    });
    const scroll = body
      ? { clientH: body.clientHeight, scrollH: body.scrollHeight, scrollTop: body.scrollTop, clientW: body.clientWidth, scrollW: body.scrollWidth, rect: rectOf(body) }
      : null;
    return {
      open: true,
      viewport,
      sheetRect: sheet ? rectOf(sheet) : null,
      overlayRect: rectOf(ov),
      sheetClientW: sheet ? sheet.clientWidth : null,
      sheetScrollW: sheet ? sheet.scrollWidth : null,
      overlayClientW: ov.clientWidth,
      overlayScrollW: ov.scrollWidth,
      docClientW: doc.documentElement.clientWidth,
      docScrollW: doc.documentElement.scrollWidth,
      bodyClientW: doc.body.clientWidth,
      bodyScrollW: doc.body.scrollWidth,
      sheetRole: sheet ? sheet.getAttribute('role') : null,
      sheetAriaModal: sheet ? sheet.getAttribute('aria-modal') : null,
      sheetLabelledby: sheet ? sheet.getAttribute('aria-labelledby') : null,
      buttons,
      overflow: overflow.slice(0, 5),
      overflowCount: overflow.length,
      scroll,
    };
  })()`;
}

function scrollToEndExpr(id) {
  return `(() => {
    const ov = document.querySelector('[data-career-panel="${id}"]');
    if (!ov) return { open: false };
    const sheet = ov.querySelector('.ac-career-sheet');
    const body = sheet ? sheet.querySelector('.ac-career-sheet__body') : null;
    if (!body) return { open: true, scrollable: false, reason: 'no-body' };
    const before = body.scrollTop;
    const max = Math.max(0, body.scrollHeight - body.clientHeight);
    body.scrollTop = body.scrollHeight;
    const visible = (node) => {
      if (!node || !node.getClientRects) return false;
      if (node.hidden) return false;
      if (node.closest && node.closest('[hidden]')) return false;
      if (node.closest && node.closest('.ac-career-sr-only')) return false;
      return node.getClientRects().length > 0;
    };
    const interactive = Array.from(body.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')).filter(visible);
    let last = interactive.length ? interactive[interactive.length - 1] : null;
    let kind = 'interactive';
    if (!last) {
      const all = Array.from(body.querySelectorAll('*')).filter((node) => {
        if (!visible(node)) return false;
        const r = node.getBoundingClientRect();
        return r.height >= 8 && r.width >= 8;
      });
      last = all.length ? all[all.length - 1] : null;
      kind = 'element';
    }
    const bodyRect = body.getBoundingClientRect();
    if (!last) return { open: true, scrollable: max > 0, max, before, after: body.scrollTop, last: null, kind };
    const lr = last.getBoundingClientRect();
    return {
      open: true,
      scrollable: max > 0,
      max,
      before,
      after: body.scrollTop,
      kind,
      lastText: ((last.getAttribute && last.getAttribute('aria-label')) || last.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 32),
      lastRect: [lr.left, lr.top, lr.right, lr.bottom].map((v) => Math.round(v * 10) / 10),
      lastW: Math.round(lr.width * 10) / 10,
      lastH: Math.round(lr.height * 10) / 10,
      bodyRect: [bodyRect.left, bodyRect.top, bodyRect.right, bodyRect.bottom].map((v) => Math.round(v * 10) / 10),
      fullyInsideBody: lr.top >= bodyRect.top - 1 && lr.bottom <= bodyRect.bottom + 1,
      fullyInsideViewport: lr.left >= -1 && lr.right <= innerWidth + 1 && lr.top >= -1 && lr.bottom <= innerHeight + 1,
    };
  })()`;
}

function goalMetricsExpr() {
  return `(() => {
    const goal = document.querySelector('[data-career-goal]');
    const overlay = document.querySelector('[data-overlay]');
    const startBtn = document.querySelector('[data-ov-btn]');
    const ovText = document.querySelector('[data-ov-text]');
    const base = {
      overlayHidden: overlay ? overlay.hidden : null,
      goalCount: document.querySelectorAll('[data-career-goal]').length,
      viewport: { w: innerWidth, h: innerHeight },
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
    };
    if (!goal) {
      return Object.assign(base, { goal: false, ovText: ovText ? ovText.textContent.replace(/\\s+/g, ' ').trim().slice(0, 120) : null });
    }
    const range = document.createRange();
    range.selectNodeContents(goal);
    const lineRects = Array.from(range.getClientRects()).map((r) => [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * 10) / 10));
    const gr = goal.getBoundingClientRect();
    const cs = getComputedStyle(goal);
    const parent = goal.closest('[data-ov-text]') || goal.parentElement;
    const pr = parent ? parent.getBoundingClientRect() : null;
    const button = startBtn ? startBtn.getBoundingClientRect() : null;
    const parentStyle = parent ? getComputedStyle(parent) : null;
    const insideParent = pr
      ? lineRects.every((r) => r[0] >= pr.left - 1 && r[2] <= pr.right + 1 && r[1] >= pr.top - 1 && r[3] <= pr.bottom + 1)
      : null;
    const insideViewport = lineRects.every((r) => r[0] >= -1 && r[2] <= innerWidth + 1 && r[1] >= -1 && r[3] <= innerHeight + 1);
    return Object.assign(base, {
      goal: true,
      text: goal.textContent.replace(/\\s+/g, ' ').trim(),
      lines: lineRects.length,
      lineRects,
      rect: [gr.left, gr.top, gr.right, gr.bottom].map((v) => Math.round(v * 10) / 10),
      height: Math.round(gr.height * 10) / 10,
      lineHeight: cs.lineHeight,
      whiteSpace: cs.whiteSpace,
      insideParent,
      insideViewport,
      parentRect: pr ? [pr.left, pr.top, pr.right, pr.bottom].map((v) => Math.round(v * 10) / 10) : null,
      parentOverflow: parentStyle ? parentStyle.overflow : null,
      parentScrollH: parent ? parent.scrollHeight : null,
      parentClientH: parent ? parent.clientHeight : null,
      startRect: button ? [button.left, button.top, button.right, button.bottom].map((v) => Math.round(v * 10) / 10) : null,
      startW: button ? Math.round(button.width * 10) / 10 : null,
      startH: button ? Math.round(button.height * 10) / 10 : null,
      startVisible: !!startBtn && startBtn.getClientRects().length > 0,
      overlapStart: button ? !(gr.bottom <= button.top || gr.top >= button.bottom) : null,
    });
  })()`;
}

/* ------------------------------------------------------------------ *
 * 各阶段
 * ------------------------------------------------------------------ */

async function setUpFixture(page) {
  return page.evaluate(`(async () => {
    try {
      const db = window.ArcadeCareer.db;
      const built = await db.ensureCareer({ originGameId: 'pendulum-tower' });
      const careerId = built.careerId;
      const rand = Math.random().toString(16).slice(2, 14);
      const runId = 'run-' + rand.padEnd(12, '0');
      const nonce = 'n' + rand;
      const created = await db.createRun({
        runId,
        careerId,
        gameId: 'pendulum-tower',
        mode: 'commission',
        sourceMode: 'commission',
        commissionId: 'pendulum-tower.T1',
        ticketId: runId,
        nonce,
        status: 'active',
      });
      if (!created || created.ok !== true) return { ok: false, step: 'create-run', error: created && created.reason };
      const claimed = await db.settleAndClaim({ runId, careerId, nonce, plan: { credits: 180 }, now: new Date().toISOString() });
      if (!claimed || claimed.ok !== true) return { ok: false, step: 'claim', error: claimed && claimed.reason };
      const wallet = await db.readWallet(careerId);
      return {
        ok: true,
        careerId,
        credits: wallet && wallet.credits,
        ledger: wallet && wallet.entries ? wallet.entries.length : (wallet && wallet.ledger ? wallet.ledger.length : null),
      };
    } catch (err) {
      return { ok: false, step: 'exception', error: String((err && err.message) || err) };
    }
  })()`);
}

async function phaseBoot(page, base) {
  await page.navigate(`${base}/apps/arcade/games/pendulum-tower.html?careerTest=1#test`);
  await waitReady(page);
  const info = await page.evaluate(`(() => ({
    available: !!(window.ArcadeCareer && window.ArcadeCareer.available),
    gameId: window.ArcadeCareer && window.ArcadeCareer.gameId,
    testApi: !!window.__arcadeCareerTest,
    panels: document.querySelectorAll('[data-career-panel]').length,
    title: document.title,
  }))()`);
  record('BOOT 桥就绪且 careerTest 钩子可用', info.available === true && info.testApi === true && info.gameId === 'pendulum-tower', JSON.stringify(info));
  record('BOOT 首屏无生涯面板/CTA（入口只在信件里）', info.panels === 0, 'panels=' + info.panels);
  const topLevelCta = await page.evaluate(`(() => {
    /* 只统计可见文本节点：内联 <script> 里的注释/字符串不算 UI 文案。 */
    const parts = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[hidden]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) parts.push(walker.currentNode.nodeValue || '');
    const text = parts.join(' ');
    return {
      panelCount: document.querySelectorAll('[data-career-panel]').length,
      townWord: /告示板/.test(text),
      hangarWord: /机库/.test(text),
      walletWord: /钱包与收据/.test(text),
      sample: text.replace(/\\s+/g, ' ').trim().slice(0, 120),
    };
  })()`);
  record(
    'BOOT 游戏首屏无“告示板/机库/钱包与收据”入口文案',
    topLevelCta.townWord === false && topLevelCta.hangarWord === false && topLevelCta.walletWord === false,
    JSON.stringify(topLevelCta)
  );
  await clearErrors(page, 'BOOT');
}

async function phaseEntry(page) {
  const seed = await page.evaluate(`window.__arcadeCareerTest.seedState({
    stage: 'GLIMPSED',
    firstClueId: 'CL-pendulum-tower',
    lastClueId: 'CL-pendulum-tower',
    clues: { 'CL-pendulum-tower': { sourceGame: 'pendulum-tower', seenAt: '2026-11-23T00:00:00.000Z' } },
  })`);
  record('ENTRY 种子：信箱已有 1 封已发现信件', !!(seed && seed.ok), JSON.stringify(seed && { ok: seed.ok, stage: seed.state && seed.state.stage }));

  await page.evaluate(`(() => { const b = document.createElement('button'); b.id = 'd1613-trigger'; b.textContent = 'T'; b.style.cssText = 'position:fixed;left:2px;bottom:2px;z-index:9999'; document.body.appendChild(b); b.focus(); return true; })()`);
  const opened = await openPanel(page, 'mailbox', { waitMs: 500 });
  record('ENTRY 信箱可从 bridge 打开', opened.ok, JSON.stringify(opened.result));

  const sendSelector = '[data-career-panel="mailbox"] [aria-label="送去折光港"]';
  const firstRead = await page.evaluate(`(() => {
    const panel = document.querySelector('[data-career-panel="mailbox"]');
    if (!panel) return null;
    const items = Array.from(panel.querySelectorAll('[data-clue-id]')).map((n) => n.getAttribute('data-clue-id'));
    const sendButtons = Array.from(panel.querySelectorAll('[aria-label="送去折光港"]'));
    const sendBtn = sendButtons[0] || null;
    const legacyTown = panel.querySelector('[data-action="open-town"]');
    const r = sendBtn ? sendBtn.getBoundingClientRect() : null;
    const style = sendBtn ? getComputedStyle(sendBtn) : null;
    return {
      items,
      sendCount: sendButtons.length,
      legacyHidden: !!legacyTown && legacyTown.hidden === true,
      send: sendBtn ? {
        hidden: sendBtn.hidden,
        disabled: sendBtn.disabled,
        text: (sendBtn.textContent || '').trim(),
        aria: sendBtn.getAttribute('aria-label'),
        primary: sendBtn.classList.contains('ac-career-btn--primary'),
        visible: !sendBtn.hidden && !sendBtn.disabled && sendBtn.getClientRects().length > 0 && !!style && style.display !== 'none' && style.visibility !== 'hidden',
        rect: r ? [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v)) : null,
        w: r ? Math.round(r.width) : 0,
        h: r ? Math.round(r.height) : 0,
      } : null,
    };
  })()`);
  record(
    'ENTRY 首读只有「送去折光港」一个主按钮且可见可点（≥44），旧去港口入口隐藏',
    !!(firstRead && firstRead.items.length && firstRead.sendCount === 1 && firstRead.legacyHidden && firstRead.send &&
      firstRead.send.hidden === false && firstRead.send.disabled === false && firstRead.send.visible && firstRead.send.primary &&
      firstRead.send.aria === '送去折光港' && firstRead.send.text === '送去折光港' &&
      firstRead.send.w >= 44 && firstRead.send.h >= 44),
    det(['letter=' + JSON.stringify(firstRead && firstRead.items), 'send=' + JSON.stringify(firstRead && firstRead.send), 'legacyHidden=' + !!(firstRead && firstRead.legacyHidden)])
  );
  const sendIndex = await page.evaluate(`(() => {
    const panel = document.querySelector('[data-career-panel="mailbox"]');
    const btn = panel && panel.querySelector('[aria-label="送去折光港"]');
    const address = panel && panel.querySelector('[data-view="mailbox"] .ac-career-letter__address');
    if (!btn || !address) return null;
    const btnRect = btn.getBoundingClientRect();
    const addrRect = address.getBoundingClientRect();
    return {
      afterAddress: btnRect.top >= addrRect.bottom - 1,
      inLegacyPort: !!btn.closest('.ac-career-mailbox__port'),
      btnTop: Math.round(btnRect.top),
      addressBottom: Math.round(addrRect.bottom),
    };
  })()`);
  record(
    'ENTRY 首读主按钮位于信件地址区块之后且不在旧去港口入口内',
    !!(sendIndex && sendIndex.afterAddress && !sendIndex.inLegacyPort),
    JSON.stringify(sendIndex)
  );

  await touchClick(page, sendSelector);
  await sleep(1000);
  const afterSend = await page.evaluate(`(() => {
    const state = window.ArcadeCareer.state();
    return {
      town: !!document.querySelector('[data-career-panel="town"]'),
      mailbox: !!document.querySelector('[data-career-panel="mailbox"]'),
      stage: state && state.stage,
      panels: Array.from(document.querySelectorAll('[data-career-panel]')).map((node) => node.getAttribute('data-career-panel')),
    };
  })()`);
  record(
    'ENTRY 触控首读主按钮一次完成投递：LOCAL 已生效、告示板打开、信箱收起',
    !!(afterSend && afterSend.stage === 'LOCAL' && afterSend.town && !afterSend.mailbox &&
      afterSend.panels.length === 1 && afterSend.panels[0] === 'town'),
    JSON.stringify(afterSend)
  );

  await esc(page);
  const afterSendTownEsc = await page.evaluate(`(() => {
    const state = window.ArcadeCareer.state();
    return {
      panels: Array.from(document.querySelectorAll('[data-career-panel]')).map((node) => node.getAttribute('data-career-panel')),
      stage: state && state.stage,
    };
  })()`);
  record(
    'ENTRY 首读告示板 Esc 后无残留面板且 LOCAL 状态保持',
    !!afterSendTownEsc && afterSendTownEsc.panels.length === 0 && afterSendTownEsc.stage === 'LOCAL',
    JSON.stringify(afterSendTownEsc)
  );

  /* 重新打开信箱 → 去港口 → 告示板 */
  await page.evaluate(`(() => { const b = document.getElementById('d1613-trigger'); if (b) b.focus(); return true; })()`);
  await openPanel(page, 'mailbox', { waitMs: 400 });
  await touchClick(page, '[data-career-panel="mailbox"] [data-action="open-town"]');
  await sleep(800);
  const townOpen = await page.evaluate(`(() => {
    const town = document.querySelector('[data-career-panel="town"]');
    const mailbox = document.querySelector('[data-career-panel="mailbox"]');
    if (!town) return { town: false, mailbox: !!mailbox };
    const actions = Array.from(town.querySelectorAll('[data-town-action]')).map((node) => {
      const r = node.getBoundingClientRect();
      return { action: node.getAttribute('data-town-action'), text: (node.textContent || '').trim(), hidden: node.hidden, w: Math.round(r.width), h: Math.round(r.height), rect: [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v)) };
    });
    return { town: true, mailbox: !!mailbox, actions };
  })()`);
  record('ENTRY 去港口后信箱收起、告示板打开（触控）', !!(townOpen.town && !townOpen.mailbox), JSON.stringify({ town: townOpen.town, mailbox: townOpen.mailbox }));
  const townActions = townOpen.actions || [];
  const hangarBtn = townActions.find((item) => item.action === 'hangar');
  const receiptBtn = townActions.find((item) => item.action === 'receipt');
  const settingsBtn = townActions.find((item) => item.action === 'settings');
  record(
    'ENTRY 告示板可见机库 / 钱包与收据 / 线索提示且 ≥44',
    !!hangarBtn && !!receiptBtn && !!settingsBtn && [hangarBtn, receiptBtn, settingsBtn].every((item) => !item.hidden && item.w >= 44 && item.h >= 44),
    JSON.stringify(townActions)
  );

  /* 机库入口 → 叠层关闭后回告示板 */
  await mouseClick(page, '[data-career-panel="town"] [data-town-action="hangar"]');
  await sleep(800);
  const layered = await page.evaluate(`(() => Array.from(document.querySelectorAll('[data-career-panel]')).map((node) => node.getAttribute('data-career-panel')))()`);
  record('ENTRY 告示板「去机库」打开机库（叠层）', Array.isArray(layered) && layered.indexOf('town') >= 0 && layered.indexOf('hangar') >= 0, JSON.stringify(layered));
  await esc(page);
  const afterTopEsc = await page.evaluate(`(() => Array.from(document.querySelectorAll('[data-career-panel]')).map((node) => node.getAttribute('data-career-panel')))()`);
  record('ENTRY 机库 Esc 后回告示板（未一键双关）', JSON.stringify(afterTopEsc) === '["town"]', JSON.stringify(afterTopEsc));
  await esc(page);
  const afterTownEsc = await page.evaluate(`(() => ({ panels: document.querySelectorAll('[data-career-panel]').length, focus: document.activeElement && document.activeElement.id }))()`);
  record('ENTRY 告示板 Esc 关闭并归还焦点（不困在面板）', afterTownEsc.panels === 0 && afterTownEsc.focus === 'd1613-trigger', JSON.stringify(afterTownEsc));
  await clearErrors(page, 'ENTRY');
}

async function phaseFixture(page) {
  const fixture = await setUpFixture(page);
  record(
    'FIXTURE 真实 DB 生涯 + 委托 run 领 180 信用点（购买用）',
    !!(fixture && fixture.ok && fixture.credits === 260),
    JSON.stringify(fixture)
  );
  return fixture;
}

async function phaseMatrix(page) {
  for (const [width, height] of WIDTHS) {
    await setViewport(page, width, height);
    for (const id of PANEL_IDS) {
      const tag = `M-${width}-${id}`;
      const leftovers = await closeAllPanels(page);
      if (leftovers.length) {
        record(tag + ' 面板清场', false, 'leftovers=' + JSON.stringify(leftovers));
      }
      const opened = await openPanel(page, id, { waitMs: id === 'hangar' || id === 'receipt' ? 1050 : 700 });
      if (!opened.ok) {
        record(tag + ' 面板可打开', false, 'width=' + width + ' panel=' + id + ' reason=' + JSON.stringify(opened.result));
        continue;
      }
      record(tag + ' 面板可打开', true, `width=${width} panel=${id}`);
      const m = await page.evaluate(panelMetricsExpr(id));
      const ctxText = `width=${width} panel=${id}`;
      const hscrollOk =
        m.docScrollW <= m.docClientW + 1 &&
        m.bodyScrollW <= m.bodyClientW + 1 &&
        m.overlayScrollW <= m.overlayClientW + 1 &&
        (m.sheetScrollW === null || m.sheetScrollW <= m.sheetClientW + 1);
      record(
        tag + ' 无横向溢出（documentElement/body/panel）',
        hscrollOk,
        det([
          ctxText,
          'doc=' + m.docScrollW + '/' + m.docClientW,
          'body=' + m.bodyScrollW + '/' + m.bodyClientW,
          'overlay=' + m.overlayScrollW + '/' + m.overlayClientW,
          'sheet=' + m.sheetScrollW + '/' + m.sheetClientW,
        ])
      );
      const sheetOk =
        !!m.sheetRect &&
        m.sheetRect[0] >= -1 &&
        m.sheetRect[1] >= -1 &&
        m.sheetRect[2] <= m.viewport.w + 1 &&
        m.sheetRect[3] <= m.viewport.h + 1;
      record(tag + ' panel rect 在视口内', sheetOk, det([ctxText, 'sheet=' + fmtRect(m.sheetRect), 'viewport=[' + m.viewport.w + ',' + m.viewport.h + ']']));
      record(
        tag + ' 无元素横向越界',
        m.overflowCount === 0,
        det([ctxText, 'overflowCount=' + m.overflowCount, 'first=' + JSON.stringify(m.overflow.slice(0, 3))])
      );
      const smallButtons = (m.buttons || []).filter((item) => item.w < 43.5 || item.h < 43.5);
      record(
        tag + ' 可见按钮 ≥44×44',
        smallButtons.length === 0,
        det([ctxText, 'offenders=' + JSON.stringify(smallButtons.slice(0, 5)), 'buttons=' + (m.buttons || []).length])
      );
      const scroll = await page.evaluate(scrollToEndExpr(id));
      const reachable = !!scroll && scroll.open && (scroll.scrollable ? scroll.fullyInsideBody && scroll.fullyInsideViewport : true) && (!scroll.last || scroll.fullyInsideViewport);
      record(
        tag + ' 滚动区可达末项',
        reachable,
        det([
          ctxText,
          'scrollable=' + (scroll && scroll.scrollable),
          'scroll=' + (scroll ? scroll.before + '->' + scroll.after + '/' + scroll.max : 'null'),
          'lastKind=' + (scroll && scroll.kind),
          'last=' + (scroll && scroll.lastText),
          'lastRect=' + fmtRect(scroll && scroll.lastRect),
          'bodyRect=' + fmtRect(scroll && scroll.bodyRect),
        ])
      );
      const closeBtn = await page.evaluate(`(() => {
        const ov = document.querySelector('[data-career-panel="${id}"]');
        const btn = ov && ov.querySelector('.ac-career-close');
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { visible: btn.getClientRects().length > 0, w: Math.round(r.width), h: Math.round(r.height), rect: [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v)) };
      })()`);
      record(
        tag + ' 关闭按钮可见且 ≥44',
        !!(closeBtn && closeBtn.visible && closeBtn.w >= 44 && closeBtn.h >= 44),
        det([ctxText, 'close=' + JSON.stringify(closeBtn)])
      );
      let closed = false;
      try {
        await mouseClick(page, `[data-career-panel="${id}"] .ac-career-close`);
        await sleep(320);
        closed = !(await panelPresent(page, id));
      } catch (err) {
        record(tag + ' 点击关闭后确实关闭', false, det([ctxText, 'error=' + String((err && err.message) || err)]));
        record(tag + ' 点击关闭后确实关闭（重试）', false, ctxText);
        await closeAllPanels(page);
        continue;
      }
      record(tag + ' 点击关闭后确实关闭', closed, det([ctxText, 'closed=' + closed]));
      await page.evaluate(`(() => { const ov = document.querySelector('[data-career-panel="${id}"]'); if (ov) ov.remove(); return true; })()`);
      if (width === 390 && (id === 'town' || id === 'hangar' || id === 'mailbox')) {
        await openPanel(page, id, { waitMs: 900 });
        await page.evaluate(`(() => { const body = document.querySelector('[data-career-panel="${id}"] .ac-career-sheet__body'); if (body) body.scrollTop = 0; return true; })()`);
        await shot(page, `D16-13-390-${id}.png`);
        await closeAllPanels(page);
      }
      if (width === 320 && (id === 'town' || id === 'hangar')) {
        await openPanel(page, id, { waitMs: 1000 });
        await page.evaluate(`(() => { const body = document.querySelector('[data-career-panel="${id}"] .ac-career-sheet__body'); if (body) body.scrollTop = 0; return true; })()`);
        await shot(page, `D16-13-320-${id}.png`);
        await closeAllPanels(page);
      }
    }
  }
  await clearErrors(page, 'MATRIX');
}

async function phaseKeyboard(page) {
  await setViewport(page, 390, 844);
  for (const id of PANEL_IDS) {
    const tag = `K-${id}`;
    await closeAllPanels(page);
    await page.evaluate(`(() => { const b = document.getElementById('d1613-trigger'); if (b) b.focus(); return true; })()`);
    const opened = await openPanel(page, id, { waitMs: 650 });
    if (!opened.ok) {
      record(tag + ' 键盘用例打开面板', false, 'panel=' + id + ' reason=' + JSON.stringify(opened.result));
      continue;
    }
    const focusableCount = await page.evaluate(`(() => {
      const sheet = document.querySelector('[data-career-panel="${id}"] .ac-career-sheet');
      if (!sheet) return 0;
      return Array.from(sheet.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((node) => {
        if (node.disabled || node.hidden) return false;
        if (node.closest && node.closest('[hidden]')) return false;
        return node.getClientRects().length > 0;
      }).length;
    })()`);
    let escaped = null;
    for (let i = 0; i < focusableCount + 2; i += 1) {
      await tab(page);
      const inside = await page.evaluate(`(() => {
        const sheet = document.querySelector('[data-career-panel="${id}"] .ac-career-sheet');
        const active = document.activeElement;
        return { inSheet: !!(sheet && active && sheet.contains(active)), tag: active && active.tagName, label: active ? ((active.getAttribute && active.getAttribute('aria-label')) || active.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24) : null };
      })()`);
      if (!inside.inSheet) {
        escaped = { step: i + 1, ...inside };
        break;
      }
    }
    record(tag + ' Tab 不逃离最上层 panel', escaped === null, 'panel=' + id + (escaped ? ' escaped=' + JSON.stringify(escaped) : ' focusables=' + focusableCount));
    await tab(page, true);
    const shiftInside = await page.evaluate(`(() => {
      const sheet = document.querySelector('[data-career-panel="${id}"] .ac-career-sheet');
      const active = document.activeElement;
      return !!(sheet && active && sheet.contains(active));
    })()`);
    record(tag + ' Shift+Tab 不逃离 panel', shiftInside === true, 'panel=' + id);
    await esc(page);
    await sleep(280);
    const closed = await page.evaluate(`(() => ({ panel: !!document.querySelector('[data-career-panel="${id}"]'), focus: document.activeElement && document.activeElement.id }))()`);
    record(tag + ' Esc 关闭 panel', closed.panel === false, 'panel=' + id + ' closed=' + !closed.panel);
    record(tag + ' Esc 后焦点返回触发元素', closed.focus === 'd1613-trigger', 'panel=' + id + ' focus=' + closed.focus);
    await closeAllPanels(page);
  }

  /* 叠层（任务卡必需）：town → hangar，Esc 只关最上层 hangar */
  await closeAllPanels(page);
  await page.evaluate(`(() => { const b = document.getElementById('d1613-trigger'); if (b) b.focus(); return window.ArcadeCareer.openTown(); })()`);
  await page.waitFor(`!!document.querySelector('[data-career-panel="town"]')`, { timeout: 6000 });
  await sleep(700);
  await mouseClick(page, '[data-career-panel="town"] [data-town-action="hangar"]');
  await page.waitFor(`!!document.querySelector('[data-career-panel="hangar"]')`, { timeout: 6000 });
  await sleep(700);
  const stack2Before = await page.evaluate(`(() => Array.from(document.querySelectorAll('[data-career-panel]')).map((node) => node.getAttribute('data-career-panel')))()`);
  record('K-STACK 叠层 town→hangar 顺序', JSON.stringify(stack2Before) === '["town","hangar"]', JSON.stringify(stack2Before));
  await esc(page);
  await sleep(280);
  const stack2After = await page.evaluate(`(() => ({
    panels: Array.from(document.querySelectorAll('[data-career-panel]')).map((node) => node.getAttribute('data-career-panel')),
    focusLabel: document.activeElement ? ((document.activeElement.getAttribute && document.activeElement.getAttribute('data-town-action')) || document.activeElement.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 16) : null,
  }))()`);
  record('K-STACK 叠层 town→hangar：Esc 只关最上层 hangar', JSON.stringify(stack2After.panels) === '["town"]', JSON.stringify(stack2After));
  record('K-STACK hangar 关闭后焦点回到告示板「去机库」', stack2After.focusLabel === 'hangar', 'focus=' + JSON.stringify(stack2After.focusLabel));
  await closeAllPanels(page);

  /* 附加：三层叠加 town→hangar→receipt，Esc 也只能关最上层（任务卡外扩展观察） */
  await page.evaluate(`(() => { const b = document.getElementById('d1613-trigger'); if (b) b.focus(); return window.ArcadeCareer.openTown(); })()`);
  await page.waitFor(`!!document.querySelector('[data-career-panel="town"]')`, { timeout: 6000 });
  await sleep(700);
  await mouseClick(page, '[data-career-panel="town"] [data-town-action="hangar"]');
  await page.waitFor(`!!document.querySelector('[data-career-panel="hangar"]')`, { timeout: 6000 });
  await sleep(700);
  await page.evaluate(`(async () => { try { await window.ArcadeCareer.openReceipt(); } catch (err) { /* ignore */ } return true; })()`);
  await page.waitFor(`!!document.querySelector('[data-career-panel="receipt"]')`, { timeout: 6000 });
  await sleep(600);
  const stack3Before = await page.evaluate(`(() => Array.from(document.querySelectorAll('[data-career-panel]')).map((node) => node.getAttribute('data-career-panel')))()`);
  record('K-STACK 三层叠加顺序 town→hangar→receipt', JSON.stringify(stack3Before) === '["town","hangar","receipt"]', JSON.stringify(stack3Before));
  await esc(page);
  await sleep(300);
  const stack3After = await page.evaluate(`(() => Array.from(document.querySelectorAll('[data-career-panel]')).map((node) => node.getAttribute('data-career-panel')))()`);
  record(
    'K-STACK 三层叠层：Esc 只关最上层 receipt（hangar 不应抢 Esc）',
    JSON.stringify(stack3After) === '["town","hangar"]',
    'width=390 panel=receipt before=' + JSON.stringify(stack3Before) + ' after=' + JSON.stringify(stack3After)
  );
  await closeAllPanels(page);
  await clearErrors(page, 'KEYBOARD');
}

async function phaseReducedMotion(page) {
  await setViewport(page, 390, 844);
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(220);
  const before = await page.evaluate(`(() => ({ docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, scrollTop: document.scrollingElement ? document.scrollingElement.scrollTop : 0, scrollY: window.scrollY, bodyH: document.body.scrollHeight }))()`);
  for (const id of PANEL_IDS) {
    const tag = `RM-${id}`;
    await closeAllPanels(page);
    const opened = await openPanel(page, id, { waitMs: 700 });
    if (!opened.ok) {
      record(tag + ' reduced-motion 面板可打开', false, 'panel=' + id + ' reason=' + JSON.stringify(opened.result));
      continue;
    }
    const styles = await page.evaluate(`(() => {
      const ov = document.querySelector('[data-career-panel="${id}"]');
      const sheet = ov && ov.querySelector('.ac-career-sheet');
      const button = ov && ov.querySelector('button');
      const ovStyle = ov ? getComputedStyle(ov) : null;
      const shStyle = sheet ? getComputedStyle(sheet) : null;
      const btnStyle = button ? getComputedStyle(button) : null;
      return {
        overlayClass: ov ? ov.className : null,
        overlayAnimation: ovStyle ? ovStyle.animationName : null,
        sheetAnimation: shStyle ? shStyle.animationName : null,
        sheetTransition: shStyle ? shStyle.transitionDuration : null,
        buttonTransition: btnStyle ? btnStyle.transitionDuration : null,
        buttonLabel: button ? ((button.getAttribute('aria-label') || button.textContent || '').trim().slice(0, 20)) : null,
        reduceMatches: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
      };
    })()`);
    record(
      tag + ' reduced-motion 下 overlay/sheet 动画 none',
      styles.overlayAnimation === 'none' && styles.sheetAnimation === 'none',
      'panel=' + id + ' ' + JSON.stringify(styles)
    );
    record(
      tag + ' reduced-motion 下按钮无过渡',
      styles.buttonTransition === '0s',
      'panel=' + id + ' buttonTransition=' + styles.buttonTransition
    );
    await closeAllPanels(page);
  }
  const after = await page.evaluate(`(() => ({ docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, scrollTop: document.scrollingElement ? document.scrollingElement.scrollTop : 0, scrollY: window.scrollY, bodyH: document.body.scrollHeight }))()`);
  record(
    'RM-LAYOUT 面板开关前后 body 无布局抖动',
    before.docW === after.docW && before.docH === after.docH && before.scrollTop === after.scrollTop && before.scrollY === after.scrollY && before.bodyH === after.bodyH,
    JSON.stringify({ before, after })
  );
  await page.send('Emulation.setEmulatedMedia', { features: [] });
  await sleep(200);
  await clearErrors(page, 'REDUCED-MOTION');
}

async function phaseTouch(page) {
  await setViewport(page, 390, 844);
  await closeAllPanels(page);
  await openPanel(page, 'hangar', { waitMs: 1100 });
  const walletBefore = await page.evaluate(`(document.querySelector('[data-career-panel="hangar"] .ac-career-hangar__wallet') || {}).textContent`);
  const rent = await touchClick(page, '[data-career-panel="hangar"] button[data-action="rent"][data-ship-id="old-wing"]');
  await sleep(900);
  const rentState = await page.evaluate(`(() => {
    const panel = document.querySelector('[data-career-panel="hangar"]');
    return {
      status: panel ? (panel.querySelector('.ac-career-status') || {}).textContent : null,
      wallet: panel ? (panel.querySelector('.ac-career-hangar__wallet') || {}).textContent : null,
      marker: (() => { try { return sessionStorage.getItem(${JSON.stringify(RENTAL_KEY)}); } catch (err) { return null; } })(),
    };
  })()`);
  record(
    'TOUCH 租用（免费租机）触控成功且零扣款',
    !!(rent && rentState.status && rentState.status.indexOf('租好了') >= 0 && rentState.wallet === walletBefore && rentState.marker),
    det(['touch=' + JSON.stringify(rent), 'status=' + JSON.stringify(rentState.status), 'walletBefore=' + JSON.stringify(walletBefore), 'walletAfter=' + JSON.stringify(rentState.wallet), 'marker=' + String(rentState.marker)])
  );

  const walletBeforeBuy = await page.evaluate(`(document.querySelector('[data-career-panel="hangar"] .ac-career-hangar__wallet') || {}).textContent`);
  const buy = await touchClick(page, '[data-career-panel="hangar"] button[data-action="buy"][data-ship-id="old-wing"]');
  await sleep(1200);
  const buyState = await page.evaluate(`(async () => {
    const panel = document.querySelector('[data-career-panel="hangar"]');
    const db = window.ArcadeCareer.db;
    const careerId = (await db.ensureCareer({})).careerId;
    const wallet = await db.readWallet(careerId);
    return {
      status: panel ? (panel.querySelector('.ac-career-status') || {}).textContent : null,
      wallet: panel ? (panel.querySelector('.ac-career-hangar__wallet') || {}).textContent : null,
      credits: wallet && wallet.credits,
      owned: !!(wallet && wallet.equipment && wallet.equipment['ship:old-wing:owned']),
    };
  })()`);
  record(
    'TOUCH 购买（登记旧翼 260）触控成功、余额扣减、装备落库',
    !!(buy && buyState.status && buyState.status.indexOf('登记好了') >= 0 && buyState.credits === 0 && buyState.owned === true),
    det(['touch=' + JSON.stringify(buy), 'status=' + JSON.stringify(buyState.status), 'walletBefore=' + JSON.stringify(walletBeforeBuy), 'walletAfter=' + JSON.stringify(buyState.wallet), 'credits=' + buyState.credits, 'owned=' + buyState.owned])
  );

  const close = await touchClick(page, '[data-career-panel="hangar"] .ac-career-close');
  await sleep(350);
  record('TOUCH 关闭（收起机库）触控命中', !(await panelPresent(page, 'hangar')), 'touch=' + JSON.stringify(close));

  /* 触控接单：告示板第一条委托 → 跳转职业 run 页面 */
  await openPanel(page, 'town', { waitMs: 1000 });
  const beforeUrl = await page.evaluate('location.href');
  const start = await touchClick(page, '[data-career-panel="town"] [data-town-action="start"][data-commission-id="pendulum-tower.T1"]');
  const navigated = await waitForNavigation(page, beforeUrl, 12000);
  await waitBridge(page);
  await sleep(500);
  const careerRun = await page.evaluate(`(() => {
    const run = window.ArcadeCareer && window.ArcadeCareer.commissionRun;
    const info = window.__arcadeCareerTest && window.__arcadeCareerTest.commissionRun ? window.__arcadeCareerTest.commissionRun() : null;
    return {
      href: location.href,
      hasCareerParam: /[?&]career=/.test(location.search),
      run: run ? { commissionId: run.commissionId, ticketId: run.ticketId } : null,
      testRun: info ? { commissionId: info.commissionId } : null,
    };
  })()`);
  record(
    'TOUCH 接单（告示板触控）→ 跳转并激活职业 run',
    !!(navigated && careerRun.hasCareerParam && careerRun.run && careerRun.run.commissionId === 'pendulum-tower.T1'),
    det(['touch=' + JSON.stringify(start), 'url=' + (navigated || 'no-nav'), 'run=' + JSON.stringify(careerRun.run), 'testRun=' + JSON.stringify(careerRun.testRun)])
  );
  await clearErrors(page, 'TOUCH');
  return careerRun;
}

async function waitForNavigation(page, previousHref, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const href = await page.evaluate('location.href');
      if (href && href !== previousHref) {
        for (let i = 0; i < 60; i += 1) {
          try {
            const state = await page.evaluate('document.readyState');
            if (state === 'complete') break;
          } catch (err) {
            /* still navigating */
          }
          await sleep(100);
        }
        await sleep(250);
        return href;
      }
    } catch (err) {
      /* 导航中 evaluate 可能失败，继续等 */
    }
    await sleep(150);
  }
  return null;
}

async function phaseGoal(page, gameLabel, widthList) {
  const results = [];
  /* 开局弹层与目标行由游戏页在桥确认 ticket 后插入；先等它出现再逐档量。 */
  try {
    await page.waitFor('!!document.querySelector("[data-career-goal]")', { timeout: 6000 });
  } catch (err) {
    /* 目标行缺失由下面的逐档断言记录 */
  }
  for (const [width, height] of widthList) {
    await setViewport(page, width, height);
    await sleep(320);
    const m = await page.evaluate(goalMetricsExpr());
    const tag = `GOAL-${gameLabel}-${width}`;
    const ctxText = `width=${width} game=${gameLabel}`;
    record(
      tag + ' 目标行出现且不是空文案',
      !!(m.goal && m.text && m.text.length > 0 && m.overlayHidden === false),
      det([ctxText, 'goal=' + m.goal, 'text=' + JSON.stringify(m.text), 'overlayHidden=' + m.overlayHidden])
    );
    if (!m.goal) {
      record(tag + ' 目标行 ≤2 行', false, det([ctxText, 'goal missing']));
      record(tag + ' 目标行完整可见（视口内）', false, det([ctxText, 'goal missing']));
      record(tag + ' 目标行不遮挡开始按钮', false, det([ctxText, 'goal missing']));
      record(tag + ' 开始按钮可见且 ≥44', false, det([ctxText, 'goal missing']));
      record(tag + ' 弹层无横向溢出', false, det([ctxText, 'goal missing']));
      results.push({ width, missing: true });
      continue;
    }
    record(
      tag + ' 目标行 ≤2 行',
      m.lines <= 2,
      det([ctxText, 'lines=' + m.lines, 'lineRects=' + JSON.stringify(m.lineRects), 'rect=' + fmtRect(m.rect), 'height=' + m.height + ' lineHeight=' + m.lineHeight])
    );
    record(
      tag + ' 目标行完整可见（视口内且未被父容器裁剪）',
      m.insideViewport === true && m.insideParent === true && m.parentScrollH <= m.parentClientH + 1,
      det([ctxText, 'insideViewport=' + m.insideViewport, 'insideParent=' + m.insideParent, 'rect=' + fmtRect(m.rect), 'parent=' + fmtRect(m.parentRect), 'parentScroll=' + m.parentScrollH + '/' + m.parentClientH])
    );
    record(
      tag + ' 目标行不遮挡开始按钮',
      m.overlapStart === false,
      det([ctxText, 'goalRect=' + fmtRect(m.rect), 'startRect=' + fmtRect(m.startRect), 'overlap=' + m.overlapStart])
    );
    record(
      tag + ' 开始按钮可见且 ≥44',
      m.startVisible === true && m.startW >= 44 && m.startH >= 44,
      det([ctxText, 'startVisible=' + m.startVisible, 'startRect=' + fmtRect(m.startRect), 'w=' + m.startW, 'h=' + m.startH])
    );
    record(
      tag + ' 弹层无横向溢出',
      m.docScrollW <= m.docClientW + 1,
      det([ctxText, 'docScrollW=' + m.docScrollW, 'docClientW=' + m.docClientW, 'viewport=' + m.viewport.w])
    );
    results.push({ width, lines: m.lines, text: m.text });
  }
  await clearErrors(page, 'GOAL-' + gameLabel);
  return results;
}

async function phaseClassicNoGoal(page, gameLabel, url) {
  await page.evaluate(`sessionStorage.removeItem(${JSON.stringify(TICKET_KEY)})`);
  await page.navigate(url);
  await waitReady(page);
  await sleep(900);
  const m = await page.evaluate(goalMetricsExpr());
  record(
    `CLASSIC-${gameLabel} 经典模式无目标行`,
    m.goalCount === 0 && m.goal === false,
    det(['game=' + gameLabel, 'goalCount=' + m.goalCount, 'overlayHidden=' + m.overlayHidden, 'ovText=' + JSON.stringify(m.ovText)])
  );
  record(
    `CLASSIC-${gameLabel} 经典开局弹层可见`,
    m.overlayHidden === false,
    det(['game=' + gameLabel, 'overlayHidden=' + m.overlayHidden])
  );
  await clearErrors(page, 'CLASSIC-' + gameLabel);
}

async function phasePwa(base) {
  const pwa = await openPage({ port: CDP_PORT, width: 390, height: 844, deviceScaleFactor: 1, mobile: true, artifactsDir: ARTIFACTS_DIR });
  try {
    await pwa.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(function () {
        var original = window.matchMedia;
        window.matchMedia = function (query) {
          if (String(query).indexOf('display-mode: standalone') >= 0) {
            return { matches: true, media: String(query), onchange: null, addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () { return false; } };
          }
          return original.call(window, query);
        };
        try { Object.defineProperty(window.navigator, 'standalone', { configurable: true, get: function () { return true; } }); } catch (err) { /* ignore */ }
        window.__d1613Standalone = true;
      })();`,
    });
    await pwa.navigate(`${base}${GAME_PAGE}`);
    await waitReady(pwa);
    const env = await pwa.evaluate(`(() => ({
      injected: window.__d1613Standalone === true,
      media: !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches),
      htmlClass: document.documentElement.className,
      shellbar: !!document.querySelector('.studiokit-shellbar'),
      viewport: [innerWidth, innerHeight],
    }))()`);
    record(
      'PWA display-mode: standalone 注入生效并被 shell 消费',
      !!(env.injected && env.media && String(env.htmlClass).indexOf('studiokit-shell-standalone') >= 0 && env.shellbar),
      JSON.stringify(env)
    );
    await pwa.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, left: 0, bottom: 34, right: 0 } });
    await sleep(260);
    await pwa.evaluate(`window.__arcadeCareerTest.seedState({
      stage: 'LOCAL',
      firstClueId: 'CL-pendulum-tower',
      lastClueId: 'CL-pendulum-tower',
      clues: { 'CL-pendulum-tower': { sourceGame: 'pendulum-tower', seenAt: '2026-11-23T00:00:00.000Z' } },
    })`);
    const safeTop = 47;
    const safeBottom = 34;
    const vh = 844;
    const vw = 390;
    for (const id of PANEL_IDS) {
      const tag = `PWA-${id}`;
      await closeAllPanels(pwa);
      const opened = await openPanel(pwa, id, { waitMs: 1000 });
      if (!opened.ok) {
        record(tag + ' 面板可打开', false, 'panel=' + id + ' reason=' + JSON.stringify(opened.result));
        continue;
      }
      const m = await pwa.evaluate(panelMetricsExpr(id));
      const pad = await pwa.evaluate(`(() => { const ov = document.querySelector('[data-career-panel="${id}"]'); return { top: getComputedStyle(ov).paddingTop, bottom: getComputedStyle(ov).paddingBottom, left: getComputedStyle(ov).paddingLeft, right: getComputedStyle(ov).paddingRight }; })()`);
      const ctxText = `width=${vw} panel=${id} safe=[47,34]`;
      record(
        tag + ' 面板不被顶部裁切（sheet.top ≥ safe-area-top）',
        !!m.sheetRect && m.sheetRect[1] >= safeTop - 1,
        det([ctxText, 'sheet=' + fmtRect(m.sheetRect), 'sheetTop=' + (m.sheetRect && m.sheetRect[1]), 'safeTop=' + safeTop])
      );
      record(
        tag + ' 面板不被底部裁切（sheet.bottom ≤ vh - safe-area-bottom）',
        !!m.sheetRect && m.sheetRect[3] <= vh - safeBottom + 1,
        det([ctxText, 'sheet=' + fmtRect(m.sheetRect), 'sheetBottom=' + (m.sheetRect && m.sheetRect[3]), 'limit=' + (vh - safeBottom)])
      );
      record(
        tag + ' 面板左右在视口内',
        !!m.sheetRect && m.sheetRect[0] >= -1 && m.sheetRect[2] <= vw + 1,
        det([ctxText, 'sheet=' + fmtRect(m.sheetRect)])
      );
      record(
        tag + ' env(safe-area-inset-bottom) 生效（overlay padding-bottom≥46）',
        parseFloat(pad.bottom) >= 45.5,
        det([ctxText, 'padding=' + JSON.stringify(pad)])
      );
      record(
        tag + ' 无横向溢出',
        m.docScrollW <= m.docClientW + 1 && m.bodyScrollW <= m.bodyClientW + 1 && m.overlayScrollW <= m.overlayClientW + 1,
        det([ctxText, 'doc=' + m.docScrollW + '/' + m.docClientW, 'body=' + m.bodyScrollW + '/' + m.bodyClientW, 'overlay=' + m.overlayScrollW + '/' + m.overlayClientW])
      );
      const small = (m.buttons || []).filter((item) => item.w < 43.5 || item.h < 43.5);
      record(tag + ' 按钮 ≥44', small.length === 0, det([ctxText, 'offenders=' + JSON.stringify(small.slice(0, 4))]));
      let closed = false;
      try {
        await touchClick(pwa, `[data-career-panel="${id}"] .ac-career-close`);
        await sleep(320);
        closed = !(await panelPresent(pwa, id));
      } catch (err) {
        closed = false;
      }
      record(tag + ' 触控关闭按钮可点', closed, det([ctxText, 'closed=' + closed]));
      if (id === 'town' || id === 'hangar') {
        await openPanel(pwa, id, { waitMs: 900 });
        await pwa.evaluate(`(() => { const body = document.querySelector('[data-career-panel="${id}"] .ac-career-sheet__body'); if (body) body.scrollTop = 0; return true; })()`);
        await shot(pwa, `D16-13-390-pwa-${id}.png`);
        await closeAllPanels(pwa);
      }
    }
    await clearErrors(pwa, 'PWA');
  } finally {
    try {
      pwa.close();
    } catch (err) {
      /* ignore */
    }
  }
}

async function phaseCleanup(page, base) {
  /* 结束清理：删除生涯 IndexedDB（先离开游戏页，避免页面连接阻塞 deleteDatabase）。 */
  let deleted = null;
  try {
    await page.navigate('about:blank');
    await sleep(260);
    await page.navigate(`${base}/apps/arcade/index.html`);
    await sleep(520);
    deleted = await page.evaluate(`new Promise((resolve) => {
      try {
        const req = indexedDB.deleteDatabase(${JSON.stringify(DB_NAME)});
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        req.onblocked = () => resolve(false);
        setTimeout(() => resolve(false), 5000);
      } catch (err) { resolve(false); }
    })`);
  } catch (err) {
    deleted = false;
  }
  record('CLEANUP deleteDatabase(studiokit:arcade:career) 成功', deleted === true, 'deleted=' + deleted);

  const storage = await page.evaluate(`(() => {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) keys.push(localStorage.key(i));
      return { available: true, keys, careerKeys: keys.filter((key) => /career|ticket|rental/i.test(String(key))) };
    } catch (err) {
      return { available: false, error: String(err && err.message || err) };
    }
  })()`);
  record(
    'CLEANUP 未新增 career 相关 localStorage 键（生涯只写 IDB）',
    !!(storage.available && storage.careerKeys.length === 0),
    JSON.stringify(storage)
  );
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

async function main() {
  if (process.argv.length > 2) {
    console.error('用法：node tools/career_mobile_016_test.mjs（无参数）');
    process.exit(2);
  }
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const base = `http://127.0.0.1:${PORT}`;
  let server = null;
  let launched = null;
  let page = null;
  try {
    server = await startServer({ port: PORT });
    launched = await launchChrome({ port: CDP_PORT, windowSize: '430,932' });
    page = await openPage({ port: CDP_PORT, width: 390, height: 844, deviceScaleFactor: 1, mobile: true, artifactsDir: ARTIFACTS_DIR });
  } catch (err) {
    console.error('D16-13 环境启动失败（退出码 2）：' + String((err && err.stack) || err));
    try {
      if (page) page.close();
    } catch (closeErr) {
      /* ignore */
    }
    try {
      if (launched) await stopChrome(launched);
    } catch (stopErr) {
      /* ignore */
    }
    try {
      if (server) server.close();
    } catch (closeServerErr) {
      /* ignore */
    }
    process.exit(2);
    return;
  }
  try {
    await phaseBoot(page, base);
    await phaseEntry(page);
    const fixture = await phaseFixture(page);
    if (!fixture || fixture.ok !== true) {
      defects.push('购买前置 fixture 失败（DB 生涯/领款），购买触控用例会连带失败');
    }
    await phaseMatrix(page);

    await page.navigate(`${base}${GAME_PAGE}`);
    await waitReady(page);
    await page.evaluate(`window.__arcadeCareerTest.seedState({
      stage: 'LOCAL',
      firstClueId: 'CL-pendulum-tower',
      lastClueId: 'CL-pendulum-tower',
      clues: { 'CL-pendulum-tower': { sourceGame: 'pendulum-tower', seenAt: '2026-11-23T00:00:00.000Z' } },
    })`);
    await page.evaluate(`(() => { const b = document.createElement('button'); b.id = 'd1613-trigger'; b.textContent = 'T'; b.style.cssText = 'position:fixed;left:2px;bottom:2px;z-index:9999'; document.body.appendChild(b); return true; })()`);
    await phaseKeyboard(page);
    await phaseReducedMotion(page);
    await phaseTouch(page);

    /* 触控接单后当前页已是 tower 职业 run，直接在 4 档宽度上检查目标行。 */
    const towerGoal = await phaseGoal(page, 'tower', WIDTHS);
    await setViewport(page, 390, 844);
    await page.evaluate(`(() => { const ov = document.querySelector('[data-overlay]'); if (ov) { const host = ov.closest('.stage-box') || ov.parentElement; if (host) host.scrollIntoView({ block: 'center' }); } return true; })()`);
    await shot(page, 'D16-13-390-tower-goal.png');
    await setViewport(page, 320, 568);
    await shot(page, 'D16-13-320-tower-goal.png');

    /* star 职业 run：从测试页接 star-raid.T1，再带 ticket 进入星海页。 */
    await setViewport(page, 390, 844);
    await page.navigate(`${base}${GAME_PAGE}`);
    await waitReady(page);
    await page.evaluate(`sessionStorage.removeItem(${JSON.stringify(TICKET_KEY)})`);
    await page.evaluate(`(async () => { try { await window.ArcadeCareer.openTown(); } catch (err) { /* ignore */ } await new Promise((r) => setTimeout(r, 500)); return true; })()`);
    await closeAllPanels(page);
    const starStart = await page.evaluate(`(async () => {
      try {
        const result = await window.ArcadeCareer.commission.start({ commissionId: 'star-raid.T1' });
        return { ok: !!result.ok, ticketId: result.ticketId, reason: result.reason || null };
      } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
    })()`);
    record('GOAL star 职业 run 接单成功（真实 commission-core）', !!(starStart && starStart.ok && starStart.ticketId), JSON.stringify(starStart));
    if (starStart && starStart.ok && starStart.ticketId) {
      await page.navigate(`${base}/apps/arcade/games/star-raid.html?career=${encodeURIComponent(starStart.ticketId)}&careerTest=1`);
      await waitReady(page);
      await sleep(1400);
      const starGoal = await phaseGoal(page, 'star', WIDTHS);
      await setViewport(page, 390, 844);
      await shot(page, 'D16-13-390-star-goal.png');
      await setViewport(page, 320, 568);
      await shot(page, 'D16-13-320-star-goal.png');
      record('GOAL star 目标行 4 档宽度行数记录', true, JSON.stringify(starGoal));
    } else {
      for (const width of [320, 375, 390, 430]) {
        record(`GOAL-star-${width} 目标行出现且不是空文案`, false, 'width=' + width + ' game=star reason=' + JSON.stringify(starStart));
      }
    }
    void towerGoal;

    await setViewport(page, 390, 844);
    await phaseClassicNoGoal(page, 'tower', `${base}${GAME_PAGE}`);
    await phaseClassicNoGoal(page, 'star', `${base}${STAR_PAGE}`);

    await phasePwa(base);
    await phaseCleanup(page, base);
  } catch (err) {
    record('RUNNER 未捕获异常（后续检查可能不完整）', false, String((err && err.stack) || err));
    defects.push('RUNNER 异常：' + String((err && err.message) || err));
  } finally {
    try {
      if (page) page.close();
    } catch (err) {
      /* ignore */
    }
    try {
      if (launched) await stopChrome(launched);
    } catch (err) {
      /* ignore */
    }
    try {
      if (server) server.close();
    } catch (err) {
      /* ignore */
    }
  }

  const stats = summary('checks');
  console.log('');
  console.log('D16-13 artifacts: ' + (shots.length ? shots.length + ' screenshot(s) in ' + ARTIFACTS_DIR : 'none'));
  for (const file of shots) console.log('  shot: ' + file);
  const failedDetails = (stats.total - stats.passed) > 0;
  console.log(`D16-13 RESULT ${failedDetails ? 'FAIL' : 'PASS'} ${stats.passed}/${stats.total}`);
  process.exit(failedDetails ? 1 : 0);
}

main().catch((err) => {
  console.error('D16-13 启动失败（退出码 2）：' + String((err && err.stack) || err));
  process.exit(2);
});
