#!/usr/bin/env node
/**
 * 0.18 章节面板 / 世界状态微变化 / 移动端无障碍测试（D18-12）
 *
 * 真实本机 Chrome（headless）+ CDP，零 npm 依赖：
 *   1) 塔页 ?careerTest=1#test → openMailbox → 「旧港来信 · 章节」入口 → 章节面板（真实 bridge 接线）；
 *   2) 合成 campaign-core（ADR §20.2 state() 输出）+ 真实 campaign/npc/side-stories 内容：
 *      六章卡片、锁定/可用/完成、终局只在 C4 后出现、NPC 回信（可跳过）、支线、后日谈；
 *   3) 打开/关闭/焦点返回、Esc 只关最上层、Tab 不逃逸、遮罩关闭；
 *   4) 320/375/390/430 无横向溢出、按钮 ≥44px；reduced-motion 无动画/静态回退；
 *   5) 降级（campaign/ending 缺失）、只读（无 careerId）、终局按钮调用 startEnding 与导航；
 *   6) 打开面板后经典画布/尺寸/localStorage/经典存档不变，零 console error。
 *
 * 端口：WORLD18_PORT=8994 / WORLD18_CDP=9594（可用环境变量覆盖；非法值退出码 2）
 * 运行：node tools/career_world_state_test.mjs
 * 退出码：0 全 PASS；1 有 FAIL；2 配置错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, createRecorder, envPort, launchChrome, openPage, startServer, stopChrome, sleep } from './lib/arcade_cdp.mjs';

const CHAPTER_ORDER_EVERY = (predicate) => ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'].every(predicate);

let SERVER_PORT = 8994;
let CDP_PORT = 9594;
try {
  SERVER_PORT = envPort('WORLD18_PORT', 8994);
  CDP_PORT = envPort('WORLD18_CDP', 9594);
} catch (err) {
  console.error('D18-12 配置错误（退出码 2）：' + String((err && err.message) || err));
  process.exit(2);
}

const ARTIFACTS_DIR =
  process.env.WORLD18_ARTIFACTS ||
  path.resolve(REPO_ROOT, '..', 'arcade-life-devkit', 'work-015-018', 'qa', 'artifacts-d18-12');
const CONTENT_DIR = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content');
const WORLD_UI = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'ui', 'world-state.js');
const PAGE_PATH = '/apps/arcade/games/pendulum-tower.html?careerTest=1#test';
const WIDTHS = [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
  /* 0.19 矮视口紧凑模式：面板必须仍可滚动、按钮 ≥44px、零横向溢出。 */
  [375, 548],
  [390, 664],
];

const CAMPAIGN = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'campaign.json'), 'utf8'));
const NPC = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'npc.json'), 'utf8'));
const SIDE_STORIES = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'side-stories.json'), 'utf8'));
const CHAPTER_FILES = Object.fromEntries(
  ['00', '01', '02', '03', '04', '05'].map((suffix) => {
    const file = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, `chapter-${suffix}.json`), 'utf8'));
    return [file.chapterId, file];
  })
);
const CONTENT = { campaign: CAMPAIGN, npc: NPC, sideStories: SIDE_STORIES, chapters: CHAPTER_FILES };

const { record, summary } = createRecorder();
const shots = [];
let page = null;
let launched = null;
let server = null;
let base = '';

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function det(parts) {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== '')
    .map((part) => String(part))
    .join(' ');
}

async function waitReady(target, timeout = 20000) {
  await target.waitFor('window.__arcadeCareerTest && window.ArcadeCareer && window.ArcadeCareer.ready', { timeout });
  await target.evaluate('Promise.resolve(window.ArcadeCareer.ready)');
  await sleep(220);
}

async function setViewport(width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await sleep(320);
}

async function realKey(key, code, vk, modifiers = 0) {
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
  await sleep(140);
}

async function esc() {
  await realKey('Escape', 'Escape', 27);
}

async function tab(shift = false) {
  await realKey('Tab', 'Tab', 9, shift ? 8 : 0);
}

async function mouseClick(selector) {
  const point = await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!point) throw new Error('点击目标不存在：' + selector);
  await sleep(120);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(40);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(220);
}

function clearErrors(label) {
  const errors = (page.errors || []).slice();
  record(
    'CONSOLE ' + label + ' 零 console error',
    errors.length === 0,
    errors.length ? 'errors=' + JSON.stringify(errors.slice(0, 4)) : 'errors=0'
  );
  return errors;
}

async function shot(name) {
  const file = await page.screenshot(name);
  shots.push(file);
  return file;
}

async function waitPanelGone(timeout = 4000) {
  await page.waitFor('!document.querySelector(' + JSON.stringify('[data-career-panel="world-state"]') + ')', { timeout });
}

async function waitPanel(timeout = 8000) {
  await page.waitFor('!!document.querySelector(' + JSON.stringify('[data-career-panel="world-state"]') + ')', { timeout });
  await sleep(180);
}

async function openBridgePanel(opener, panelName, timeout = 10000) {
  const result = await page.evaluate(`(async () => {
    try {
      const fn = window.ArcadeCareer && window.ArcadeCareer.${opener};
      if (typeof fn !== 'function') return { ok: false, reason: 'missing-opener' };
      const returned = fn();
      const value = returned && typeof returned.then === 'function' ? await returned : returned;
      if (value && value.ok === false) return { ok: false, reason: value.reason || 'rejected' };
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String((err && err.message) || err) };
    }
  })()`);
  let present = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    present = !!(await page.evaluate(`!!document.querySelector(${JSON.stringify('[data-career-panel="' + panelName + '"]')})`));
    if (present) break;
    await sleep(220);
  }
  return { ok: present, result };
}

/** 直接调用 UI 模块 open(ctx)，绕过 bridge（合成 ctx / 焦点与降级测试用）。 */
async function openDirect(ctxExpr) {
  const info = await page.evaluate(`(async () => {
    try {
      const mod = window.ArcadeCareerUI && window.ArcadeCareerUI.worldState;
      if (!mod) return { ok: false, reason: 'module-missing' };
      if (typeof mod.close === 'function') {
        try { mod.close(); } catch (err) { /* ignore */ }
      }
      const sheet = mod.open(${ctxExpr});
      return {
        ok: !!sheet,
        hasPanel: !!document.querySelector('[data-career-panel="world-state"]'),
        sheetRole: sheet && sheet.getAttribute ? sheet.getAttribute('role') : null,
      };
    } catch (err) {
      return { ok: false, reason: String((err && err.message) || err) };
    }
  })()`);
  await sleep(180);
  return info;
}

async function closeDirect() {
  await page.evaluate(`(() => {
    const mod = window.ArcadeCareerUI && window.ArcadeCareerUI.worldState;
    if (mod && typeof mod.close === 'function') { try { mod.close(); } catch (err) { /* ignore */ } }
    return true;
  })()`);
  await sleep(140);
}

/* 页面内测量脚本 */

const PANEL_EXPR = `(() => {
  const ov = document.querySelector('[data-career-panel="world-state"]');
  if (!ov) return { open: false };
  const sheet = ov.querySelector('.ac-career-sheet');
  const text = (node) => node ? (node.textContent || '').replace(/\\s+/g, ' ').trim() : '';
  const chapters = Array.from(ov.querySelectorAll('.ac-career-world__chapter')).map((node) => ({
    id: node.getAttribute('data-chapter-id'),
    state: node.getAttribute('data-state'),
    title: text(node.querySelector('.ac-career-world__chapter-title')),
    hint: text(node.querySelector('.ac-career-world__hint')),
    stage: text(node.querySelector('.ac-career-world__stage-text')),
    body: text(node.querySelector('.ac-career-world__chapter-body')),
    factCount: Number((node.querySelector('.ac-career-world__facts') || { getAttribute: () => null }).getAttribute('data-fact-count') || 0),
    contacts: text(node.querySelector('.ac-career-world__contact')),
    clues: Array.from(node.querySelectorAll('.ac-career-world__clue')).map(text),
    badgeLabel: node.querySelector('.ac-career-world__badge') ? node.querySelector('.ac-career-world__badge').getAttribute('data-state-label') : null,
    badge: text(node.querySelector('.ac-career-world__badge')),
  }));
  const earlierToggle = ov.querySelector('[data-action="toggle-earlier-chapters"]');
  const earlierList = ov.querySelector('.ac-career-world__earlier-list');
  const endingsSection = ov.querySelector('.ac-career-world__endings');
  const endings = Array.from(ov.querySelectorAll('.ac-career-world__endings-actions [data-approach]')).map((node) => ({
    approach: node.getAttribute('data-approach'),
    text: text(node),
    disabled: !!node.disabled,
    h: Math.round(node.getBoundingClientRect().height * 10) / 10,
  }));
  const port = ov.querySelector('.ac-career-world__port');
  const epilogue = ov.querySelector('.ac-career-world__epilogue');
  const skip = ov.querySelector('[data-action="skip-replies"]');
  const repliesList = ov.querySelector('#ac-career-world-replies');
  const degraded = Array.from(ov.querySelectorAll('[data-degraded]')).map((node) => ({
    kind: node.getAttribute('data-degraded'),
    text: text(node),
  }));
  const notices = Array.from(ov.querySelectorAll('.ac-career-world__notice')).map(text);
  return {
    open: true,
    role: sheet ? sheet.getAttribute('role') : null,
    ariaModal: sheet ? sheet.getAttribute('aria-modal') : null,
    labelledby: sheet ? sheet.getAttribute('aria-labelledby') : null,
    describedby: sheet ? sheet.getAttribute('aria-describedby') : null,
    readonly: sheet ? sheet.getAttribute('data-readonly') : null,
    title: text(ov.querySelector('#ac-career-world-title')),
    where: text(ov.querySelector('#ac-career-world-desc')),
    chapterCount: chapters.length,
    chapterIds: chapters.map((c) => c.id),
    chapters,
    hints: chapters.map((c) => c.hint),
    earlierHidden: earlierList ? !!earlierList.hidden : null,
    earlierToggle: earlierToggle ? {
      text: text(earlierToggle),
      expanded: earlierToggle.getAttribute('aria-expanded'),
      h: Math.round(earlierToggle.getBoundingClientRect().height * 10) / 10,
    } : null,
    recentIds: Array.from(ov.querySelectorAll('.ac-career-world__recent-list .ac-career-world__chapter')).map((node) => node.getAttribute('data-chapter-id')),
    badges: chapters.map((c) => c.badge),
    sideCount: (ov.querySelector('.ac-career-world__side') || { getAttribute: () => null }).getAttribute('data-side-count'),
    sideTitles: Array.from(ov.querySelectorAll('.ac-career-world__side-title')).map(text),
    replyCount: ov.querySelectorAll('.ac-career-world__reply').length,
    replies: Array.from(ov.querySelectorAll('.ac-career-world__reply')).map((node) => ({
      id: node.getAttribute('data-character-id'),
      chapterId: node.getAttribute('data-chapter-id'),
      name: text(node.querySelector('.ac-career-world__reply-name')),
      text: text(node.querySelector('.ac-career-world__reply-text')),
    })),
    skip: skip ? {
      text: text(skip),
      pressed: skip.getAttribute('aria-pressed'),
      controls: skip.getAttribute('aria-controls'),
      h: Math.round(skip.getBoundingClientRect().height * 10) / 10,
    } : null,
    repliesHidden: repliesList ? !!repliesList.hidden : null,
    endingVisible: !!endingsSection,
    endingChosen: endingsSection ? endingsSection.getAttribute('data-ending-chosen') : null,
    endings,
    epilogue: epilogue ? { approach: epilogue.getAttribute('data-approach'), text: text(epilogue) } : null,
    port: port ? {
      state: port.getAttribute('data-port-state'),
      lit: Number(port.getAttribute('data-lit')),
      motion: port.getAttribute('data-motion'),
      broadcast: text(port.querySelector('.ac-career-world__broadcast')),
      lightCount: port.querySelectorAll('.ac-career-world__light').length,
      litCount: port.querySelectorAll('.ac-career-world__light.is-lit').length,
    } : null,
    degraded,
    notices,
    gate: !!ov.querySelector('[data-gate="c0"]'),
    readonlyNote: !!ov.querySelector('.ac-career-world__readonly'),
    status: text(ov.querySelector('.ac-career-status')),
    activeInside: !!(sheet && sheet.contains(document.activeElement)),
    activeLabel: document.activeElement ? (document.activeElement.getAttribute('aria-label') || text(document.activeElement).slice(0, 24)) : null,
    focusedInSheet: !!(sheet && sheet.contains(document.activeElement)),
  };
})()`;

const LAYOUT_EXPR = `(() => {
  const ov = document.querySelector('[data-career-panel="world-state"]');
  if (!ov) return { open: false };
  const sheet = ov.querySelector('.ac-career-sheet');
  const body = sheet ? sheet.querySelector('.ac-career-sheet__body') : null;
  const viewport = { w: innerWidth, h: innerHeight };
  const visible = (node) => {
    if (!node || !node.getClientRects) return false;
    if (node.hidden) return false;
    if (node.closest && node.closest('[hidden]')) return false;
    if (node.closest && node.closest('.ac-career-sr-only')) return false;
    return node.getClientRects().length > 0;
  };
  const rect = (node) => {
    const r = node.getBoundingClientRect();
    return [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * 10) / 10);
  };
  const buttons = Array.from(sheet ? sheet.querySelectorAll('button') : []).filter(visible).map((node) => {
    const r = node.getBoundingClientRect();
    return {
      label: (node.getAttribute('aria-label') || node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 28),
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      disabled: !!node.disabled,
    };
  });
  const overflow = [];
  Array.from(ov.querySelectorAll('*')).forEach((node) => {
    if (!visible(node)) return;
    const r = node.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return;
    if (r.left < -1 || r.right > viewport.w + 1) {
      overflow.push({ tag: node.tagName, cls: String(node.className || '').slice(0, 44), rect: rect(node) });
    }
  });
  return {
    open: true,
    viewport,
    sheetRect: sheet ? rect(sheet) : null,
    sheetScrollW: sheet ? sheet.scrollWidth : null,
    sheetClientW: sheet ? sheet.clientWidth : null,
    overlayScrollW: ov.scrollWidth,
    overlayClientW: ov.clientWidth,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
    bodyScrollW: body ? body.scrollWidth : null,
    bodyClientW: body ? body.clientWidth : null,
    buttons,
    shortButtons: buttons.filter((btn) => btn.h < 44),
    overflowCount: overflow.length,
    overflow: overflow.slice(0, 4),
  };
})()`;

const BASELINE_EXPR = `(() => {
  const canvas = document.querySelector('.game-canvas');
  const rect = canvas ? canvas.getBoundingClientRect() : null;
  const storage = {};
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      storage[key] = localStorage.getItem(key);
    }
  } catch (err) {
    /* ignore */
  }
  return {
    canvasCount: document.querySelectorAll('canvas').length,
    canvasWidth: canvas ? canvas.width : null,
    canvasHeight: canvas ? canvas.height : null,
    canvasRect: rect ? [rect.left, rect.top, rect.width, rect.height].map((v) => Math.round(v * 100) / 100) : null,
    bodyChildren: document.body.children.length,
    storageJSON: JSON.stringify(storage),
    storageKeys: Object.keys(storage).sort(),
  };
})()`;

const REDUCED_EXPR = `(() => {
  const ov = document.querySelector('[data-career-panel="world-state"]');
  if (!ov) return { open: false };
  const sheet = ov.querySelector('.ac-career-sheet');
  const lamp = ov.querySelector('.ac-career-world__light.is-lit');
  const btn = ov.querySelector('.ac-career-world__footer .ac-career-btn');
  const cs = (node) => (node ? getComputedStyle(node) : null);
  const sheetStyle = cs(sheet);
  const lampStyle = cs(lamp);
  const btnStyle = cs(btn);
  const port = ov.querySelector('.ac-career-world__port');
  return {
    open: true,
    reducedMatches: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    overlayReduced: ov.classList.contains('is-reduced-motion'),
    sheetAnimation: sheetStyle ? sheetStyle.animationName : null,
    lampAnimation: lampStyle ? lampStyle.animationName : null,
    lampDuration: lampStyle ? lampStyle.animationDuration : null,
    buttonTransition: btnStyle ? btnStyle.transitionDuration : null,
    motion: port ? port.getAttribute('data-motion') : null,
    broadcast: port ? (port.querySelector('.ac-career-world__broadcast') || {}).textContent : null,
    lightCount: ov.querySelectorAll('.ac-career-world__light').length,
  };
})()`;

/* ------------------------------------------------------------------ *
 * 合成 campaign 快照（ADR §20.2 state() 输出形状）
 * ------------------------------------------------------------------ */

function emptySnapshot() {
  return {
    currentChapter: 'C0',
    chapters: CAMPAIGN.chapters.map((chapter) => ({ chapterId: chapter.chapterId, state: 'locked', routes: [], mustKnow: [], handoff: chapter.handoff })),
    endings: CAMPAIGN.endings.map((ending) => ({ approach: ending.approach, available: false })),
    endingChosen: null,
    epilogue: null,
  };
}

function snapshotFor(completeIds, openId, endingsAvailable) {
  const snapshot = emptySnapshot();
  snapshot.chapters.forEach((chapter) => {
    if (completeIds.indexOf(chapter.chapterId) >= 0) {
      chapter.state = 'complete';
      chapter.routes = [{ routeId: 'route-' + chapter.chapterId, available: false, complete: true, hint: (CAMPAIGN.chapters.find((c) => c.chapterId === chapter.chapterId) || {}).fallback }];
    } else if (chapter.chapterId === openId) {
      chapter.state = 'available';
      const def = CAMPAIGN.chapters.find((c) => c.chapterId === chapter.chapterId) || {};
      chapter.routes = (def.routes || []).map((route) => ({ routeId: route.routeId, available: true, complete: false, hint: route.hint }));
    }
  });
  snapshot.currentChapter = openId || completeIds[completeIds.length - 1] || 'C0';
  snapshot.endings = snapshot.endings.map((ending) => ({ approach: ending.approach, available: !!endingsAvailable }));
  return snapshot;
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

async function main() {
  /* ---------- 静态边界（不依赖浏览器） ---------- */
  const source = fs.readFileSync(WORLD_UI, 'utf8');
  record('STATIC world-state.js 无 localStorage/sessionStorage/indexedDB 访问', !/(?:window\.)?(?:localStorage|sessionStorage)\s*[.[]/.test(source) && !/indexedDB\s*[.[]/.test(source));
  record('STATIC world-state.js 无网络请求（fetch/XMLHttpRequest/WebSocket）', !/fetch\s*\(|XMLHttpRequest|WebSocket/.test(source));
  record('STATIC world-state.js 暴露 window.ArcadeCareerUI.worldState 且含 open/close/render', /ArcadeCareerUI\.worldState/.test(source) && /function open\(/.test(source) && /function close\(/.test(source) && /function render\(/.test(source));
  record('STATIC 模块不写入经典 arcade 存储键（studiokit:arcade:*:v1）', !/studiokit:arcade:[a-z-]+:v1/.test(source));
  record('STATIC 模块无接单/发奖/写库调用（startCommission/写库 API）', !/startCommission|beginRun|writeTicket|db\.(purchase|sellItems|add|write|reset)/.test(source));
  record('STATIC 导航只走 location.assign（无 location.href 赋值）', !/location\.href\s*=/.test(source) && /location\.assign/.test(source));
  record('CONTENT campaign.json 六章 / 三终局 / 后日谈', Array.isArray(CAMPAIGN.chapters) && CAMPAIGN.chapters.length === 6 && CAMPAIGN.endings.length === 3 && !!CAMPAIGN.epilogue);
  record('CONTENT chapter-00..05.json 均有可选 beats.start/progress/complete 玩家文案', CHAPTER_ORDER_EVERY((id) => {
    const beats = CHAPTER_FILES[id] && CHAPTER_FILES[id].beats;
    return !!(beats && ['start', 'progress', 'complete'].every((key) => typeof beats[key] === 'string' && beats[key].length >= 8));
  }), JSON.stringify(Object.fromEntries(Object.entries(CHAPTER_FILES).map(([id, file]) => [id, Object.keys(file.beats || {})]))));
  record('CONTENT beats 不提前揭晓 C1 首航以外的答案（不内含 mustKnow 原句）', CHAPTER_ORDER_EVERY((id) => {
    const file = CHAPTER_FILES[id];
    const beats = file && file.beats;
    const secrets = (CAMPAIGN.chapters.find((chapter) => chapter.chapterId === id) || {}).mustKnow || [];
    return !!(beats && secrets.every((secret) => [beats.start, beats.progress].every((text) => text.indexOf(secret) < 0)));
  }), 'start/progress must not equal completed mustKnow');
  record('CONTENT npc.json 三名角色（E-7/阿砾/黎序）', Array.isArray(NPC.characters) && NPC.characters.length === 3 && ['E-7', '阿砾', '黎序'].every((name) => NPC.characters.some((c) => c.name === name)));
  record('CONTENT side-stories.json 至少四个可选支线家族', Array.isArray(SIDE_STORIES.families) && SIDE_STORIES.families.length >= 4, 'families=' + (SIDE_STORIES.families || []).length);

  server = await startServer({ port: SERVER_PORT });
  launched = await launchChrome({ port: CDP_PORT, windowSize: '420,900' });
  page = await openPage({ port: CDP_PORT, width: 390, height: 844, artifactsDir: ARTIFACTS_DIR, url: 'about:blank' });
  base = 'http://127.0.0.1:' + SERVER_PORT;
  /* headless Chrome 的默认 prefers-reduced-motion 可能是 reduce；先显式声明 no-preference，
     保证「正常模式」与「reduced-motion」两种路径都被真实覆盖。 */
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  /* ---------- 阶段 1：塔页启动、零面板、经典基线 ---------- */
  await page.navigate(base + PAGE_PATH);
  await waitReady(page);
  const boot = await page.evaluate(`(() => {
    const bodyText = (document.body && document.body.innerText ? document.body.innerText : '').replace(/\\s+/g, ' ');
    return {
      available: !!(window.ArcadeCareer && window.ArcadeCareer.available),
      gameId: window.ArcadeCareer && window.ArcadeCareer.gameId,
      testApi: !!window.__arcadeCareerTest,
      panels: document.querySelectorAll('[data-career-panel]').length,
      worldScriptLoaded: !!(window.ArcadeCareerUI && window.ArcadeCareerUI.worldState),
      chapterCtaText: /旧港来信|章节面板|六章/.test(bodyText),
    };
  })()`);
  record('BOOT 桥就绪、careerTest 钩子可用、首屏无生涯面板', boot.available === true && boot.testApi === true && boot.panels === 0 && boot.gameId === 'pendulum-tower', JSON.stringify(boot));
  record('BOOT 经典页无顶层「旧港来信/章节」CTA 文案', boot.chapterCtaText === false, JSON.stringify({ chapterCtaText: boot.chapterCtaText }));
  record('BOOT world-state 默认不加载（lazy，首屏零面板/零 CTA）', boot.worldScriptLoaded === false, JSON.stringify({ loaded: boot.worldScriptLoaded }));
  clearErrors('BOOT');

  /* 合成 campaign-core / ending-reducer（ADR §20.2/§20.3 接口），避免 0.18 核心未落地时 404。 */
  const stub = await page.evaluate(`(() => {
    const content = ${JSON.stringify(CONTENT)};
    const clone = (value) => (value === null || value === undefined ? value : JSON.parse(JSON.stringify(value)));
    window.__d18 = {
      snapshot: null,
      nextEndingResult: null,
      endingStarts: [],
      stateInputs: [],
      configureCalls: 0,
      configurePayload: null,
    };
    window.__d18.fakeCampaign = {
      configure: function (payload) {
        window.__d18.configureCalls += 1;
        window.__d18.configurePayload = {
          hasCampaign: !!(payload && payload.campaign),
          hasNpc: !!(payload && payload.npc),
          hasSideStories: !!(payload && payload.sideStories),
          endings: payload && payload.endings ? payload.endings.length : 0,
        };
        return { ok: true };
      },
      state: function (input) {
        window.__d18.stateInputs.push(clone(input) || null);
        return clone(window.__d18.snapshot);
      },
      endingOptions: function () {
        return clone((window.__d18.snapshot && window.__d18.snapshot.endings) || []);
      },
      epilogueFor: function (approach) {
        const snap = window.__d18.snapshot;
        const epilogue = snap && snap.epilogue;
        return epilogue ? (epilogue[approach] || epilogue.base || '') : '';
      },
      validate: function () { return { ok: true, errors: [] }; },
    };
    window.__d18.fakeEnding = {
      configure: function () { return { ok: true }; },
      startEnding: function (opts) {
        window.__d18.endingStarts.push(clone(opts) || null);
        try {
          sessionStorage.setItem('d18:ending-starts', JSON.stringify(window.__d18.endingStarts));
        } catch (err) {
          /* 测试记录失败不影响主流程 */
        }
        const next = window.__d18.nextEndingResult;
        if (next) return clone(next);
        return { ok: false, reason: 'ending-not-ready' };
      },
    };
    window.__d18.content = content;
    if (window.ArcadeCareer) {
      window.ArcadeCareer.campaign = window.__d18.fakeCampaign;
      window.ArcadeCareer.ending = window.__d18.fakeEnding;
    }
    return {
      stubbed: !!(window.ArcadeCareer && window.ArcadeCareer.campaign === window.__d18.fakeCampaign && window.ArcadeCareer.ending === window.__d18.fakeEnding),
      chapters: content.campaign.chapters.length,
    };
  })()`);
  record('STUB 合成 campaign-core/ending-reducer 已挂到 bridge（真实内容注入）', stub.stubbed === true && stub.chapters === 6, JSON.stringify(stub));

  const seed = await page.evaluate(`window.__arcadeCareerTest.seedState({
    stage: 'LOCAL',
    firstClueId: 'CL-pendulum-tower',
    lastClueId: 'CL-pendulum-tower',
    clues: { 'CL-pendulum-tower': { sourceGame: 'pendulum-tower', seenAt: '2026-11-23T00:00:00.000Z' } },
  })`);
  record('ENTRY 种子：信箱已有一封信（LOCAL）', !!(seed && seed.ok), JSON.stringify(seed && { ok: seed.ok, stage: seed.state && seed.state.stage }));

  const baseline = await page.evaluate(BASELINE_EXPR);

  /* ---------- 阶段 2：真实入口（mailbox → 旧港来信） ---------- */
  const snapC0 = snapshotFor(['C0'], 'C1', false);
  await page.evaluate('window.__d18.snapshot = ' + JSON.stringify(snapC0));
  const mailbox = await openBridgePanel('openMailbox', 'mailbox');
  record('ENTRY 信箱可从 bridge 打开', mailbox.ok, JSON.stringify(mailbox.result));
  const campaignEntry = await page.evaluate(`(() => {
    const panel = document.querySelector('[data-career-panel="mailbox"]');
    const btn = panel && panel.querySelector('[data-action="open-campaign"]');
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect();
    return {
      found: true,
      hidden: !!btn.hidden,
      text: (btn.textContent || '').trim(),
      aria: btn.getAttribute('aria-label'),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  })()`);
  record(
    'ENTRY 信箱「旧港来信 · 章节」入口可见、≥44px、aria 完整',
    !!(campaignEntry.found && campaignEntry.hidden === false && campaignEntry.w >= 44 && campaignEntry.h >= 44 && campaignEntry.aria),
    JSON.stringify(campaignEntry)
  );
  await mouseClick('[data-career-panel="mailbox"] [data-action="open-campaign"]');
  await waitPanel();
  const entryState = await page.evaluate(`(() => ({
    world: !!document.querySelector('[data-career-panel="world-state"]'),
    mailbox: !!document.querySelector('[data-career-panel="mailbox"]'),
    panels: Array.from(document.querySelectorAll('[data-career-panel]')).map((node) => node.getAttribute('data-career-panel')),
  }))()`);
  record('ENTRY 点击后章节面板打开、信箱收起（无叠层）', entryState.world === true && entryState.mailbox === false, JSON.stringify(entryState));

  const surface = await page.evaluate(PANEL_EXPR);
  record('SURFACE 标题「旧港来信」+ 位置说明', surface.title === '旧港来信' && surface.where.length > 0, det([surface.title, surface.where]));
  record(
    'SURFACE role=dialog / aria-modal=true / aria-labelledby / aria-describedby',
    surface.role === 'dialog' && surface.ariaModal === 'true' && surface.labelledby === 'ac-career-world-title' && surface.describedby === 'ac-career-world-desc',
    JSON.stringify({ role: surface.role, modal: surface.ariaModal, labelledby: surface.labelledby, describedby: surface.describedby })
  );
  const chapterById = (panel, id) => panel.chapters.find((chapter) => chapter.id === id);
  record('SURFACE 六章卡片（C0–C5 均可回顾）', surface.chapterCount === 6 && surface.chapterIds.slice().sort().join(',') === 'C0,C1,C2,C3,C4,C5', JSON.stringify(surface.chapterIds));
  record(
    'SURFACE 章节状态：C0 已完成 / C1 可以开始 / C2–C5 尚未开放',
    ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'].map((id) => chapterById(surface, id).state).join(',') === 'complete,available,locked,locked,locked,locked' &&
      chapterById(surface, 'C0').badge === '已完成' &&
      chapterById(surface, 'C1').badge === '可以开始' &&
      chapterById(surface, 'C2').badge === '尚未开放',
    JSON.stringify(surface.chapters.map((c) => [c.id, c.state, c.badge]))
  );
  record('SURFACE 非锁定章有戏内提示，锁定章不提前泄漏提示（无正文/事实）', surface.hints.length === 6 && ['C0', 'C1'].every((id) => (chapterById(surface, id).hint || '').length >= 4) && ['C2', 'C3', 'C4', 'C5'].every((id) => (chapterById(surface, id).hint || '').length === 0), JSON.stringify(surface.hints));
  record('SURFACE 章节标题来自真实 campaign 内容/兜底', surface.chapters.map((c) => c.title).join('|').indexOf('不起眼的印记') >= 0 && chapterById(surface, 'C5').title.indexOf('星塔的回响') >= 0, JSON.stringify(surface.chapters.map((c) => c.title)));
  const entryChapter = (id) => chapterById(surface, id);
  const chapterBodyOf = (id) => fs.readFileSync(path.join(CONTENT_DIR, `chapter-0${Number(id.slice(1))}.json`), 'utf8');
  record('BEATS 完成后显示 complete 正文/事实，可用章只显示 start 且不剧透', entryChapter('C0').body.length > 0 && entryChapter('C0').factCount > 0 && entryChapter('C0').stage === CHAPTER_FILES.C0.beats.complete && entryChapter('C1').stage === CHAPTER_FILES.C1.beats.start && entryChapter('C1').body === '' && entryChapter('C1').factCount === 0, JSON.stringify(surface.chapters.slice(0, 2)));
  record('BEATS 锁定章不显示任何阶段文案/正文/事实', surface.chapters.slice(2).every((chapter) => chapter.stage === '' && chapter.body === '' && chapter.factCount === 0), JSON.stringify(surface.chapters.slice(2).map((chapter) => chapter.id)));
  record('BEATS 玩家可见标题/徽标不含内部编号或 active 状态词', surface.chapters.every((chapter) => !/\bC[0-5]\b/.test(chapter.title) && !/进行中|active/i.test(chapter.badge) && !/进行中|active/i.test(chapter.badgeLabel || '')), JSON.stringify(surface.chapters.map((chapter) => [chapter.title, chapter.badge, chapter.badgeLabel])));
  record('BEATS 活动 C1 显示可信联系人与当前线索，不显示答案', /阿砾|老周/.test(entryChapter('C1').contacts) && entryChapter('C1').clues.length >= 1 && entryChapter('C1').body === '' && entryChapter('C1').factCount === 0, JSON.stringify({ contacts: entryChapter('C1').contacts, clues: entryChapter('C1').clues }));
  record('PANEL 当前/最近完成在前，其余折叠且可展开回顾（44px/焦点安全）', JSON.stringify(surface.recentIds) === JSON.stringify(['C0', 'C1']) && surface.earlierHidden === true && surface.earlierToggle.expanded === 'false' && surface.earlierToggle.h >= 44 && surface.earlierToggle.text === '展开回顾', JSON.stringify({ recent: surface.recentIds, earlierHidden: surface.earlierHidden, toggle: surface.earlierToggle }));
  await mouseClick('[data-career-panel="world-state"] [data-action="toggle-earlier-chapters"]');
  const expanded = await page.evaluate(PANEL_EXPR);
  record('PANEL 展开后六章仍可回顾且按钮切为收起', expanded.earlierHidden === false && expanded.earlierToggle.expanded === 'true' && expanded.earlierToggle.text === '收起回顾' && expanded.chapters.length === 6 && expanded.activeInside === true, JSON.stringify({ hidden: expanded.earlierHidden, toggle: expanded.earlierToggle, active: expanded.activeInside }));
  await mouseClick('[data-career-panel="world-state"] [data-action="toggle-earlier-chapters"]');
  record('BEATS 玩家语言：正文无 T1/T2、C0/C1、E/BP/MAP 等内部记号', CHAPTER_ORDER_EVERY((id) => {
    const file = CHAPTER_FILES[id];
    /* E-7 是玩家可知的调度员名字，不是内部证据 token；E-C1 / BP- / MAP- 才是。 */
    return ['start', 'progress', 'complete'].every((key) => !/\b(?:T[1-6]|C[0-5])\b|\bE-[A-Z]|\b(?:BP|MAP)-/.test(file.beats[key] || ''));
  }), 'no internal tokens in player beats');
  record('BEATS 首航 start/progress 指向非战斗工作与另一份现场记录', /航报|夜航/.test(CHAPTER_FILES.C1.beats.start) && /叠稳|工钱/.test(CHAPTER_FILES.C1.beats.start) && /现场记录/.test(CHAPTER_FILES.C1.beats.progress) && !/星海|战斗/.test(CHAPTER_FILES.C1.beats.progress), CHAPTER_FILES.C1.beats.progress);
  record('BEATS 中间单提示不提前揭晓 C1 的 mustKnow 结论', CHAPTER_FILES.C1.beats.progress.indexOf('信号与 P-07 吻合') < 0 && CHAPTER_FILES.C1.beats.start.indexOf('信号与 P-07 吻合') < 0, CHAPTER_FILES.C1.beats.start);
  record('BEATS C3 进展铺垫三终局立场但不揭晓 E-7 结论', /重写旧许可信号/.test(CHAPTER_FILES.C3.beats.progress) && /旧核心闭嘴/.test(CHAPTER_FILES.C3.beats.progress) && /把当年的人接回来/.test(CHAPTER_FILES.C3.beats.progress) && CHAPTER_FILES.C3.beats.progress.indexOf('E-7 没有叛逃') < 0, CHAPTER_FILES.C3.beats.progress);
  record('BEATS 每章有玩家语言 next 下一步、完成后才给事实', CHAPTER_ORDER_EVERY((id) => typeof CHAPTER_FILES[id].next === 'string' && CHAPTER_FILES[id].next.length >= 8), JSON.stringify(Object.fromEntries(Object.entries(CHAPTER_FILES).map(([id, f]) => [id, !!f.next]))));
  record('CONTENT chapter-01.json 保留既有路径/旗标/价格字段', ['origins', 'pacing', 'beats', 'body'].every((key) => Object.prototype.hasOwnProperty.call(JSON.parse(chapterBodyOf('C1')), key)) && !!/paths|signals/.test(JSON.stringify(JSON.parse(chapterBodyOf('C1')).c1 || {})), 'chapter-01 field set');
  record('SURFACE C4 前不出现终局按钮/终局区块', surface.endingVisible === false && surface.endings.length === 0 && surface.epilogue === null, JSON.stringify({ endingVisible: surface.endingVisible, endings: surface.endings.length }));
  record('SURFACE 港口世界状态（灯光/广播）随 C0 出现', surface.port && surface.port.state === 'C0' && surface.port.litCount >= 2 && /旧港广播/.test(surface.port.broadcast) && surface.port.lightCount === 5, JSON.stringify(surface.port));
  record('SURFACE 港口灯光是装饰（aria-hidden），广播文本承载语义', await page.evaluate(`!!document.querySelector('[data-career-panel="world-state"] .ac-career-world__lights[aria-hidden="true"]')`));
  record('SURFACE NPC 回信可跳过阅读', surface.replyCount >= 1 && !!surface.skip && surface.skip.text === '跳过回信' && surface.skip.h >= 44, JSON.stringify({ count: surface.replyCount, skip: surface.skip }));
  record('REPLIES 仅显示已完成章的回信（C0 完成时只有阿砾）', surface.replies.every((reply) => reply.chapterId === 'C0') && surface.replyCount === 1, JSON.stringify(surface.replies));
  record(
    'SURFACE 桥接路径已解析真实生涯 → 可交互（C0 回流入口）',
    surface.readonly === 'false',
    JSON.stringify({ readonly: surface.readonly })
  );
  record('SURFACE 已触发支线按真实线索出现（不展示未命中家族）', Number(surface.sideCount) >= 1 && surface.sideTitles.length === Number(surface.sideCount), JSON.stringify({ sideCount: surface.sideCount, titles: surface.sideTitles.length }));
  clearErrors('ENTRY/SURFACE');

  await shot('world-entry-390.png');

  /* 跳过回信：隐藏/恢复 */
  await mouseClick('[data-career-panel="world-state"] [data-action="skip-replies"]');
  const hiddenReplies = await page.evaluate(PANEL_EXPR);
  record('REPLIES 「跳过回信」隐藏回信列表且 aria-pressed=true', hiddenReplies.repliesHidden === true && hiddenReplies.skip.pressed === 'true' && hiddenReplies.skip.text === '看看回信', JSON.stringify({ hidden: hiddenReplies.repliesHidden, skip: hiddenReplies.skip }));
  await mouseClick('[data-career-panel="world-state"] [data-action="skip-replies"]');
  const shownReplies = await page.evaluate(PANEL_EXPR);
  record('REPLIES 再次点击恢复回信列表', shownReplies.repliesHidden === false && shownReplies.skip.pressed === 'false' && shownReplies.replyCount >= 1, JSON.stringify({ hidden: shownReplies.repliesHidden, count: shownReplies.replyCount }));

  /* ---------- 阶段 3：直接 ctx（合成状态矩阵） ---------- */
  await closeDirect();

  const directCtx = (extra) =>
    `(() => {
      const ctx = {
        careerId: 'career-d18-12',
        campaign: window.__d18.content.campaign,
        campaignState: window.__d18.snapshot,
        npc: window.__d18.content.npc,
        sideStories: window.__d18.content.sideStories,
        ending: window.__d18.fakeEnding,
        state: { stage: 'LOCAL', clues: {} },
        flags: []
      };
      ${extra || ''}
      return ctx;
    })()`;

  /* 3.1 C0 前：不显示章节内容（锁定门） */
  const preC0 = emptySnapshot();
  await page.evaluate('window.__d18.snapshot = ' + JSON.stringify(preC0));
  await openDirect(directCtx('ctx.state = { stage: "GLIMPSED", clues: {} };'));
  const gated = await page.evaluate(PANEL_EXPR);
  record('C0-前 显示「信还没送到旧港」的锁定门、不渲染章节内容', gated.gate === true && gated.chapterCount === 0, JSON.stringify({ gate: gated.gate, chapters: gated.chapterCount }));
  record('C0-前 港口状态为 pre、灯光 1 盏、无终局', gated.port && gated.port.state === 'pre' && gated.port.litCount === 1 && gated.endingVisible === false, JSON.stringify(gated.port));
  await closeDirect();

  /* 3.2 C2 推进：三角色回信 + 可选支线 + 港口状态 */
  const snapC2 = snapshotFor(['C0', 'C1'], 'C2', false);
  await page.evaluate('window.__d18.snapshot = ' + JSON.stringify(snapC2));
  await openDirect(directCtx());
  const mid = await page.evaluate(PANEL_EXPR);
  record('MODEL C2 时 C2 可以开始、C3–C5 尚未开放', chapterById(mid, 'C2').state === 'available' && chapterById(mid, 'C3').state === 'locked', JSON.stringify(mid.chapters.map((c) => [c.id, c.state])));
  record('MODEL NPC 只显示已完成章的回信（C2 活动中仅阿砾和 E-7）', mid.replies.length === 2 && ['E-7', '阿砾'].every((id) => mid.replies.some((r) => r.id === id)), JSON.stringify(mid.replies.map((r) => r.id)));
  record('MODEL 回信文本来自真实 npc.json（非空、按章节）', mid.replies.every((r) => r.text && r.text.length >= 6) && mid.replies.some((r) => r.id === 'E-7' && /信号|求救/.test(r.text)), JSON.stringify(mid.replies));
  record('MODEL C2 活动中只显示 C2 之前的已完成回信，不提前给七号货柜答案', mid.replies.every((reply) => ['C0', 'C1', 'C2'].indexOf(reply.chapterId) >= 0) && !mid.replies.some((reply) => /中继密钥|七号货柜/.test(reply.text)), JSON.stringify(mid.replies));
  record('MODEL 可选支线全部家族（标题/正文，动态数量）', mid.sideCount === String(SIDE_STORIES.families.length) && mid.sideTitles.length === SIDE_STORIES.families.length && mid.sideTitles.join('|').indexOf('港口的灯') >= 0, JSON.stringify(mid.sideTitles));
  record('MODEL 港口广播随已完成章节变化（C0/C1 完成 → P-07 旧编号）', mid.port.state === 'C1' && /P-07 的旧编号/.test(mid.port.broadcast) && mid.port.litCount === 3, JSON.stringify(mid.port));
  record('MODEL campaign.state() 收到 quests/claims/profile/wallet/flags 入参', await page.evaluate(`(() => {
    const inputs = window.__d18.stateInputs || [];
    const last = inputs[inputs.length - 1];
    return !!(last && Object.prototype.hasOwnProperty.call(last, 'quests') && Object.prototype.hasOwnProperty.call(last, 'claims') && Object.prototype.hasOwnProperty.call(last, 'profile') && Object.prototype.hasOwnProperty.call(last, 'wallet') && Array.isArray(last.flags));
  })()`));
  await closeDirect();

  /* 3.3 C4 完成：三终局按钮出现 */
  const snapC4 = snapshotFor(['C0', 'C1', 'C2', 'C3', 'C4'], 'C5', true);
  await page.evaluate('window.__d18.snapshot = ' + JSON.stringify(snapC4));
  const beforeC4 = await page.evaluate(BASELINE_EXPR);
  const openC4 = await openDirect(directCtx());
  record('MODEL 直接 open(ctx) 成功（合成 campaign-core）', openC4.ok === true && openC4.hasPanel === true && openC4.sheetRole === 'dialog', JSON.stringify(openC4));
  const c4 = await page.evaluate(PANEL_EXPR);
  record('MODEL C4 完成后出现三终局按钮（武力/研究/救援）', c4.endingVisible === true && c4.endings.length === 3 && JSON.stringify(c4.endings.map((e) => e.approach)) === JSON.stringify(['combat', 'research', 'rescue']), JSON.stringify(c4.endings));
  record('MODEL 终局按钮文案与 ≥44px', /武力/.test(c4.endings[0].text) && /理性重启|研究/.test(c4.endings[1].text) && /运输救援|救援/.test(c4.endings[2].text) && c4.endings.every((e) => e.h >= 44), JSON.stringify(c4.endings));
  record('MODEL C5 可以开始（C4 已完成）', chapterById(c4, 'C4').state === 'complete' && chapterById(c4, 'C5').state === 'available', JSON.stringify(c4.chapters.map((c) => [c.id, c.state])));
  record('MODEL C4 港口广播（城市灯重新亮起）与 5 盏灯', c4.port.state === 'C4' && c4.port.litCount === 5 && /城市的灯重新亮起/.test(c4.port.broadcast), JSON.stringify(c4.port));
  record('MODEL 有 careerId 时终局按钮可用（非只读）', c4.readonly === 'false' && c4.endings.every((e) => e.disabled === false) && c4.readonlyNote === false, JSON.stringify({ readonly: c4.readonly, endings: c4.endings }));

  /* 3.4 终局失败结果：显示失败提示、不导航、可重试 */
  const urlBeforeFailure = await page.evaluate('location.href');
  await page.evaluate('window.__d18.nextEndingResult = { ok: false, reason: "ending-gate" }');
  await mouseClick('[data-career-panel="world-state"] [data-approach="combat"]');
  await sleep(240);
  const failed = await page.evaluate(PANEL_EXPR);
  const callAfterFailure = await page.evaluate('window.__d18.endingStarts[window.__d18.endingStarts.length - 1]');
  record('ENDING 点击武力调用 ending.startEnding({approach:"combat"})', !!(callAfterFailure && callAfterFailure.approach === 'combat' && Object.keys(callAfterFailure).length === 1), JSON.stringify(callAfterFailure));
  record('ENDING 失败结果：显示失败提示、按钮可重试、不导航', failed.status.length > 0 && failed.endings.every((e) => e.disabled === false) && (await page.evaluate('location.href')) === urlBeforeFailure, JSON.stringify({ status: failed.status }));
  const afterFailureBaseline = await page.evaluate(BASELINE_EXPR);
  record('ENDING 失败不写经典存档/localStorage', afterFailureBaseline.storageJSON === beforeC4.storageJSON && afterFailureBaseline.storageJSON === baseline.storageJSON, 'storage changed');

  /* 3.5 非法 url：拒绝 javascript: 导航 */
  await page.evaluate('window.__d18.nextEndingResult = { ok: true, url: "javascript:alert(1)" }');
  await mouseClick('[data-career-panel="world-state"] [data-approach="research"]');
  await sleep(240);
  const badUrl = await page.evaluate(PANEL_EXPR);
  const callBadUrl = await page.evaluate('window.__d18.endingStarts[window.__d18.endingStarts.length - 1]');
  record('ENDING 非法 url 被拒绝（不导航、提示找不到路）', callBadUrl && callBadUrl.approach === 'research' && badUrl.status.length > 0 && (await page.evaluate('location.href')) === urlBeforeFailure, JSON.stringify({ status: badUrl.status, url: await page.evaluate('location.href') }));

  /* 3.6 后日谈：已选终局 */
  await closeDirect();
  const chosenSnapshot = JSON.parse(JSON.stringify(snapC4));
  chosenSnapshot.endingChosen = 'research';
  chosenSnapshot.epilogue = CAMPAIGN.epilogue;
  await page.evaluate('window.__d18.snapshot = ' + JSON.stringify(chosenSnapshot));
  await openDirect(directCtx());
  const chosen = await page.evaluate(PANEL_EXPR);
  record('EPILOGUE 已选终局显示后日谈（base + 研究专属段落）', !!chosen.epilogue && /折光港的灯一盏盏亮回来/.test(chosen.epilogue.text) && /第二次开港/.test(chosen.epilogue.text), JSON.stringify(chosen.epilogue));
  record('EPILOGUE 已选终局不再显示三选一按钮', chosen.endingVisible === true && chosen.endings.length === 0 && chosen.endingChosen === 'research', JSON.stringify({ visible: chosen.endingVisible, endings: chosen.endings.length, chosen: chosen.endingChosen }));
  record('EPILOGUE 港口进入 ending 状态（5 盏灯 + 研究结局广播）', chosen.port.state === 'ending' && /许可信号重写成功/.test(chosen.port.broadcast), JSON.stringify(chosen.port));
  await closeDirect();

  /* 3.7 只读（无 careerId） */
  await page.evaluate('window.__d18.snapshot = ' + JSON.stringify(snapC4));
  await openDirect(directCtx('delete ctx.careerId;'));
  const readonly = await page.evaluate(PANEL_EXPR);
  record('READONLY 无 careerId：sheet data-readonly=true、终局按钮 disabled、只读说明', readonly.readonly === 'true' && readonly.endings.length === 3 && readonly.endings.every((e) => e.disabled === true) && readonly.readonlyNote === true, JSON.stringify({ readonly: readonly.readonly, disabled: readonly.endings.map((e) => e.disabled) }));
  await closeDirect();

  /* 3.8 降级：campaign/ending 缺失 */
  await openDirect('({ state: { stage: "LOCAL", clues: {} } })');
  const degraded = await page.evaluate(PANEL_EXPR);
  record('DEGRADE campaign 缺失：显示「港务处还在整理旧信」、无章节内容', degraded.degraded.some((d) => d.kind === 'campaign' && d.text.indexOf('港务处还在整理旧信') >= 0) && degraded.chapterCount === 0, JSON.stringify(degraded.degraded));
  record('DEGRADE campaign 缺失：仍显示港口静态状态与关闭入口', !!degraded.port && degraded.port.state === 'pre' && degraded.port.motion === 'subtle', JSON.stringify(degraded.port));
  await closeDirect();

  /* 3.9 ending 缺失（campaign 存在、C4 后） */
  await openDirect(directCtx('delete ctx.ending;'));
  const noEnding = await page.evaluate(PANEL_EXPR);
  record('DEGRADE ending 缺失：显示「港务处还在整理旧信」、终局按钮不可用', noEnding.degraded.some((d) => d.kind === 'ending' && d.text.indexOf('港务处还在整理旧信') >= 0), JSON.stringify(noEnding.degraded));
  record('DEGRADE ending 缺失：章节与 C4 状态仍只读可看', noEnding.chapterCount === 6 && noEnding.chapters[4].state === 'complete', JSON.stringify(noEnding.chapters.map((c) => c.state)));
  await closeDirect();

  /* 3.10 内容-only（无 campaign-core state）：按真实 campaign.json 推导 */
  await openDirect(`({
    careerId: 'career-d18-12',
    campaign: window.__d18.content.campaign,
    npc: window.__d18.content.npc,
    sideStories: window.__d18.content.sideStories,
    ending: window.__d18.fakeEnding,
    flags: ['C0.port_seen'],
    state: { stage: 'LOCAL', clues: {} }
  })`);
  const derived = await page.evaluate(PANEL_EXPR);
  record('DERIVE 无 campaign-core 时按内容推导六章（C0 完成/C1 可用/C2 锁定）', derived.chapterCount === 6 && derived.chapters[0].state === 'complete' && derived.chapters[1].state === 'available' && derived.chapters[2].state === 'locked', JSON.stringify(derived.chapters.map((c) => [c.id, c.state])));
  record('DERIVE 六章标题为玩家语言（无 C0/C1 内部编号）', derived.chapters.map((c) => c.title).join('|') === CAMPAIGN.chapters.map((c) => c.title).join('|') && derived.chapters.every((c) => !/\bC[0-5]\b/.test(c.title)), JSON.stringify(derived.chapters.map((c) => c.title)));
  record('DERIVE C4 前无终局、港口 C0', derived.endingVisible === false && derived.port.state === 'C0', JSON.stringify({ endingVisible: derived.endingVisible, port: derived.port.state }));
  await closeDirect();

  /* 3.11 render(ctx) 未挂载：不产生全局 DOM 副作用 */
  const renderCheck = await page.evaluate(`(() => {
    const mod = window.ArcadeCareerUI.worldState;
    const ctx = {
      careerId: 'career-d18-12',
      campaign: window.__d18.content.campaign,
      campaignState: ${JSON.stringify(snapC0)},
      npc: window.__d18.content.npc,
      sideStories: window.__d18.content.sideStories,
      ending: window.__d18.fakeEnding,
      state: { stage: 'LOCAL', clues: {} },
    };
    const sheet = mod.render(ctx);
    const inDocument = !!document.querySelector('[data-career-panel="world-state"]');
    const chapters = sheet ? sheet.querySelectorAll('.ac-career-world__chapter').length : -1;
    const role = sheet ? sheet.getAttribute('role') : null;
    return { returned: !!sheet, inDocument, chapters, role };
  })()`);
  record('RENDER render(ctx) 返回未挂载面板、六章内容可检查、不插 DOM', renderCheck.returned === true && renderCheck.inDocument === false && renderCheck.chapters === 6 && renderCheck.role === 'dialog', JSON.stringify(renderCheck));

  /* 3.12 输入只读：打开面板不改动 ctx 内容/快照 */
  const purity = await page.evaluate(`(() => {
    const content = ${JSON.stringify(CONTENT)};
    const snapshot = ${JSON.stringify(snapC0)};
    const before = JSON.stringify(content) + '|' + JSON.stringify(snapshot);
    const mod = window.ArcadeCareerUI.worldState;
    mod.open({
      careerId: 'career-d18-12',
      campaign: content.campaign,
      campaignState: snapshot,
      npc: content.npc,
      sideStories: content.sideStories,
      ending: window.__d18.fakeEnding,
      state: { stage: 'LOCAL', clues: {} },
    });
    const after = JSON.stringify(content) + '|' + JSON.stringify(snapshot);
    mod.close();
    return { equal: before === after };
  })()`);
  record('PURITY 打开/关闭面板不改动 ctx.campaign/campaignState（状态只读）', purity.equal === true, JSON.stringify(purity));

  /* ---------- 阶段 4：打开/关闭/焦点/Esc/Tab ---------- */
  await page.evaluate(`(() => {
    if (!document.getElementById('d18-trigger')) {
      const btn = document.createElement('button');
      btn.id = 'd18-trigger';
      btn.type = 'button';
      btn.textContent = 'D18';
      btn.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:9999';
      document.body.appendChild(btn);
    }
    document.getElementById('d18-trigger').focus();
    return true;
  })()`);
  await page.evaluate('window.__d18.snapshot = ' + JSON.stringify(snapC0));
  const openedFocus = await openDirect(directCtx());
  const focusState = await page.evaluate(PANEL_EXPR);
  record('A11Y 打开后焦点进入面板（关闭按钮），role=dialog', openedFocus.ok === true && focusState.focusedInSheet === true && focusState.activeLabel === '收起旧港来信', JSON.stringify({ label: focusState.activeLabel, inside: focusState.focusedInSheet }));

  let tabEscaped = false;
  for (let i = 0; i < 8; i += 1) {
    await tab(i % 3 === 2);
    const inside = await page.evaluate(`(() => {
      const sheet = document.querySelector('[data-career-panel="world-state"] .ac-career-sheet');
      return !!(sheet && sheet.contains(document.activeElement));
    })()`);
    if (!inside) {
      tabEscaped = true;
      break;
    }
  }
  record('A11Y Tab/Shift+Tab 循环 8 次始终在面板内（不逃逸）', tabEscaped === false);
  const closeByEsc = await page.evaluate(`(async () => {
    const mod = window.ArcadeCareerUI.worldState;
    mod.close();
    return { closed: !document.querySelector('[data-career-panel="world-state"]'), activeId: document.activeElement && document.activeElement.id };
  })()`);
  record('A11Y 关闭后焦点返回打开前元素（#d18-trigger）', closeByEsc.closed === true && closeByEsc.activeId === 'd18-trigger', JSON.stringify(closeByEsc));

  /* 真实 Esc（键盘事件）+ 遮罩关闭 */
  await page.evaluate('document.getElementById("d18-trigger").focus()');
  await openDirect(directCtx());
  await esc();
  const afterEsc = await page.evaluate(`(() => ({
    closed: !document.querySelector('[data-career-panel="world-state"]'),
    activeId: document.activeElement && document.activeElement.id,
  }))()`);
  record('A11Y Esc 关闭面板并把焦点还给触发按钮', afterEsc.closed === true && afterEsc.activeId === 'd18-trigger', JSON.stringify(afterEsc));

  await page.evaluate('document.getElementById("d18-trigger").focus()');
  await openDirect(directCtx());
  await page.evaluate(`(() => {
    const ov = document.querySelector('[data-career-panel="world-state"]');
    ov.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    ov.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`);
  await sleep(180);
  record(
    'A11Y 点遮罩可关闭面板',
    await page.evaluate(`!document.querySelector('[data-career-panel="world-state"]')`)
  );

  /* 叠层：告示板在下、章节面板在上，Esc 只关最上层 */
  const townOpened = await openBridgePanel('openTown', 'town');
  record('LAYER 告示板可打开（桥接）', townOpened.ok, JSON.stringify(townOpened.result));
  const worldOpened = await openBridgePanel('openCampaign', 'world-state');
  record('LAYER 章节面板可叠在告示板之上打开', worldOpened.ok, JSON.stringify(worldOpened.result));
  const stacked = await page.evaluate(`Array.from(document.querySelectorAll('[data-career-panel]')).map((node) => node.getAttribute('data-career-panel'))`);
  record('LAYER 叠层顺序 town → world-state', JSON.stringify(stacked) === JSON.stringify(['town', 'world-state']), JSON.stringify(stacked));
  await esc();
  const afterFirstEsc = await page.evaluate(`Array.from(document.querySelectorAll('[data-career-panel]')).map((node) => node.getAttribute('data-career-panel'))`);
  record('LAYER Esc 只关最上层（章节面板），告示板仍在', JSON.stringify(afterFirstEsc) === JSON.stringify(['town']), JSON.stringify(afterFirstEsc));
  await esc();
  const afterSecondEsc = await page.evaluate(`Array.from(document.querySelectorAll('[data-career-panel]')).map((node) => node.getAttribute('data-career-panel'))`);
  record('LAYER 再按 Esc 关闭告示板（不残留）', JSON.stringify(afterSecondEsc) === JSON.stringify([]), JSON.stringify(afterSecondEsc));
  clearErrors('A11Y/LAYER');

  /* ---------- 阶段 5：经典画布/存档安全 ---------- */
  const safetyBefore = await page.evaluate(BASELINE_EXPR);
  const discoveryBefore = await page.evaluate('window.__arcadeCareerTest.state()');
  const storageBeforeOpen = safetyBefore.storageJSON;
  await openDirect(directCtx());
  const safetyOpen = await page.evaluate(BASELINE_EXPR);
  const duringPanel = await page.evaluate(`(() => ({
    canvas: (() => { const c = document.querySelector('.game-canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { w: c.width, h: c.height, rect: [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 100) / 100) }; })(),
    bodyChildren: document.body.children.length,
    styleCount: document.querySelectorAll('#ac-career-world-style').length,
  }))()`);
  record('SAFE 打开面板时经典画布尺寸/位置不变', JSON.stringify(safetyOpen.canvasRect) === JSON.stringify(safetyBefore.canvasRect) && safetyOpen.canvasWidth === safetyBefore.canvasWidth && safetyOpen.canvasHeight === safetyBefore.canvasHeight, JSON.stringify({ before: safetyBefore.canvasRect, during: safetyOpen.canvasRect }));
  record('SAFE 打开面板不写 localStorage/经典存档', safetyOpen.storageJSON === storageBeforeOpen, 'storage changed');
  record('SAFE 只注入一份面板样式（不重复）', duringPanel.styleCount === 1, JSON.stringify(duringPanel));
  await closeDirect();
  const safetyAfter = await page.evaluate(BASELINE_EXPR);
  const discoveryAfter = await page.evaluate('window.__arcadeCareerTest.state()');
  record('SAFE 关闭后 body 子节点恢复、画布不变、存档不变', safetyAfter.bodyChildren === safetyBefore.bodyChildren && JSON.stringify(safetyAfter.canvasRect) === JSON.stringify(safetyBefore.canvasRect) && safetyAfter.storageJSON === storageBeforeOpen, JSON.stringify({ before: safetyBefore.bodyChildren, after: safetyAfter.bodyChildren }));
  record('SAFE 打开/关闭章节面板不改生涯发现状态（run/事件不变）', JSON.stringify(discoveryBefore) === JSON.stringify(discoveryAfter), 'state changed');
  clearErrors('SAFE');

  /* ---------- 阶段 6：320/375/390/430 布局 ---------- */
  await page.evaluate('window.__d18.snapshot = ' + JSON.stringify(snapC4));
  for (const [width, height] of WIDTHS) {
    await setViewport(width, height);
    await closeDirect();
    await page.evaluate('document.getElementById("d18-trigger").focus()');
    await openDirect(directCtx());
    const layout = await page.evaluate(LAYOUT_EXPR);
    const noOverflow =
      layout.open === true &&
      layout.docScrollW <= layout.docClientW + 1 &&
      layout.overlayScrollW <= layout.overlayClientW + 1 &&
      layout.overflowCount === 0 &&
      (!layout.sheetRect || (layout.sheetRect[0] >= -1 && layout.sheetRect[2] <= width + 1));
    record('LAYOUT ' + width + 'px 无横向溢出（面板/文档/元素）', noOverflow, JSON.stringify({ overflow: layout.overflowCount, doc: [layout.docClientW, layout.docScrollW], sheet: layout.sheetRect }));
    const short = layout.buttons.filter((btn) => btn.h < 43.5);
    record('LAYOUT ' + width + 'px 所有可见按钮 ≥44px', layout.buttons.length >= 4 && short.length === 0, JSON.stringify({ count: layout.buttons.length, short }));
    record('LAYOUT ' + width + 'px 面板在视口内且可滚动', !!layout.sheetRect && layout.sheetRect[1] >= -1 && layout.sheetRect[3] <= height + 1 && layout.sheetClientW >= 200, JSON.stringify({ sheet: layout.sheetRect, viewport: layout.viewport }));
    if (width === 320 || width === 390 || width === 430) await shot('world-' + width + '.png');
    await closeDirect();
  }
  await setViewport(390, 844);
  clearErrors('LAYOUT');

  /* ---------- 阶段 7：reduced-motion 静态回退 ---------- */
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.evaluate('window.__d18.snapshot = ' + JSON.stringify(snapC0));
  await page.evaluate('document.getElementById("d18-trigger").focus()');
  await openDirect(directCtx());
  const reduced = await page.evaluate(REDUCED_EXPR);
  record('A11Y reduced-motion 匹配、overlay 标记 is-reduced-motion', reduced.reducedMatches === true && reduced.overlayReduced === true, JSON.stringify({ matches: reduced.reducedMatches, cls: reduced.overlayReduced }));
  record('A11Y reduced-motion 下面板/灯光无动画、按钮无过渡', reduced.sheetAnimation === 'none' && reduced.lampAnimation === 'none' && reduced.buttonTransition === '0s', JSON.stringify({ sheet: reduced.sheetAnimation, lamp: reduced.lampAnimation, transition: reduced.buttonTransition }));
  record('A11Y reduced-motion 静态回退：灯光数量与广播文本仍完整', reduced.motion === 'static' && reduced.lightCount === 5 && /旧港广播/.test(reduced.broadcast), JSON.stringify({ motion: reduced.motion, lights: reduced.lightCount }));
  await shot('world-reduced-motion-390.png');
  await closeDirect();
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await sleep(160);

  /* 正常（非 reduced）时灯光确实有微变化动画（仅证据，CSS 动画在 headless 也可查） */
  await openDirect(directCtx());
  const normalMotion = await page.evaluate(REDUCED_EXPR);
  record('MOTION 正常模式下港口灯光有 subtle 动画（data-motion=subtle）', normalMotion.motion === 'subtle' && normalMotion.reducedMatches === false, JSON.stringify({ motion: normalMotion.motion, lamp: normalMotion.lampAnimation }));
  await closeDirect();

  /* ctx.reducedMotion 显式声明（系统媒体 non-preference 时）也必须走静态回退 */
  await openDirect(directCtx('ctx.reducedMotion = true;'));
  const ctxReduced = await page.evaluate(REDUCED_EXPR);
  record(
    'A11Y ctx.reducedMotion=true 也走静态回退（overlay is-reduced-motion / data-motion=static）',
    ctxReduced.overlayReduced === true && ctxReduced.motion === 'static' && ctxReduced.reducedMatches === false,
    JSON.stringify({ cls: ctxReduced.overlayReduced, motion: ctxReduced.motion, media: ctxReduced.reducedMatches })
  );
  record(
    'A11Y ctx.reducedMotion=true 灯光无动画、广播文本仍完整',
    ctxReduced.lampAnimation === 'none' && ctxReduced.lightCount === 5 && /旧港广播/.test(ctxReduced.broadcast),
    JSON.stringify({ lamp: ctxReduced.lampAnimation, lights: ctxReduced.lightCount })
  );
  await closeDirect();
  clearErrors('REDUCED-MOTION');

  /* ---------- 阶段 8：真实 campaign-core / ending-reducer 集成（去掉合成 stub） ---------- */
  await page.evaluate(`(() => {
    window.ArcadeCareer.campaign = null;
    window.ArcadeCareer.ending = null;
    return true;
  })()`);
  const realBridgeOpen = await openBridgePanel('openCampaign', 'world-state', 15000);
  const realBridge = await page.evaluate(PANEL_EXPR);
  const realModules = await page.evaluate(`(() => {
    const c = window.ArcadeCareer && window.ArcadeCareer.campaign;
    const e = window.ArcadeCareer && window.ArcadeCareer.ending;
    const info = window.ArcadeCareer && typeof window.ArcadeCareer.info === 'function' ? window.ArcadeCareer.info() : null;
    const errors = ((info && info.loadErrors) || []).filter((entry) => /campaign-core|ending-reducer/.test(String(entry.file || '')));
    return {
      campaignReal: !!(c && c !== window.__d18.fakeCampaign && typeof c.state === 'function' && typeof c.validate === 'function'),
      endingReal: !!(e && e !== window.__d18.fakeEnding && typeof e.startEnding === 'function'),
      loadErrors: errors.map((entry) => entry.file + ':' + entry.reason),
    };
  })()`);
  record(
    'REAL 真实 campaign-core / ending-reducer 由 bridge 懒装载（合成 stub 已移除）',
    realBridgeOpen.ok === true && realModules.campaignReal === true && realModules.endingReal === true && realModules.loadErrors.length === 0,
    JSON.stringify({ open: realBridgeOpen.ok, modules: realModules })
  );
  record(
    'REAL 真实 campaign-core 状态可被面板渲染（六章、C0 进行中、港口 C0）',
    realBridge.chapterCount === 6 && realBridge.chapters[0].state === 'active' && realBridge.chapters[1].state === 'locked' && realBridge.port.state === 'C0' && realBridge.degraded.length === 0,
    JSON.stringify({ count: realBridge.chapterCount, first: realBridge.chapters[0], port: realBridge.port && realBridge.port.state, degraded: realBridge.degraded })
  );
  await closeDirect();
  const realDirect = await openDirect(`({
    careerId: 'career-d18-12',
    campaign: window.ArcadeCareer.campaign,
    ending: window.ArcadeCareer.ending,
    flags: ['C0.port_seen'],
    quests: [],
    claims: [],
    profile: null,
    wallet: null,
    state: { stage: 'LOCAL', clues: {} }
  })`);
  const realDirectPanel = await page.evaluate(PANEL_EXPR);
  record(
    'REAL 真实 campaign-core.state({flags}) → C0 已完成 / C1 进行中 / 真实标题',
    realDirect.ok === true && realDirectPanel.chapterCount === 6 && realDirectPanel.chapters[0].state === 'complete' && realDirectPanel.chapters[1].state === 'active' && realDirectPanel.chapters[0].title.indexOf('不起眼的印记') >= 0 && realDirectPanel.degraded.length === 0,
    JSON.stringify({ count: realDirectPanel.chapterCount, states: realDirectPanel.chapters.map((c) => c.state), title: realDirectPanel.chapters[0].title })
  );
  await closeDirect();
  clearErrors('REAL');

  /* ---------- 阶段 9：终局导航（成功路径）与最终零错误 ---------- */
  await page.evaluate('window.__d18.snapshot = ' + JSON.stringify(snapC4));
  await page.evaluate(`window.__d18.nextEndingResult = {
    ok: true,
    url: ${JSON.stringify(base + '/apps/arcade/games/merge-2048.html?careerTest=1#test')}
  }`);
  await page.evaluate('document.getElementById("d18-trigger").focus()');
  await openDirect(directCtx());
  const hrefBeforeNav = await page.evaluate('location.href');
  await mouseClick('[data-career-panel="world-state"] [data-approach="research"]');
  const navigated = await page
    .waitFor('location.href.indexOf("merge-2048") >= 0', { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  const callForNav = await page
    .evaluate(`(() => {
      try {
        const rows = JSON.parse(sessionStorage.getItem('d18:ending-starts') || '[]');
        return rows[rows.length - 1] || null;
      } catch (err) {
        return null;
      }
    })()`)
    .catch(() => null);
  const hrefAfterNav = navigated ? await page.evaluate('location.href').catch(() => 'n/a') : null;
  record('NAV 终局按钮调用 startEnding({approach:"research"}) 并导航到结果 url', navigated === true && !!(callForNav && callForNav.approach === 'research'), JSON.stringify({ before: hrefBeforeNav, after: hrefAfterNav, call: callForNav }));

  await page.navigate(base + PAGE_PATH);
  await waitReady(page);
  clearErrors('FINAL');
  const finalBaseline = await page.evaluate(BASELINE_EXPR);
  record('FINAL 回塔页后经典 localStorage 仍与基线一致', finalBaseline.storageJSON === baseline.storageJSON, 'storage changed');
  record('FINAL 回塔页后无生涯面板残留', (await page.evaluate('document.querySelectorAll("[data-career-panel]").length')) === 0);
}

/* ------------------------------------------------------------------ *
 * 启动 / 收尾
 * ------------------------------------------------------------------ */

try {
  await main();
} catch (err) {
  record('RUN 未捕获异常（测试中断）', false, String((err && err && err.message) || err));
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
    if (server) await new Promise((resolve) => server.close(resolve));
  } catch (err) {
    /* ignore */
  }
}

const stats = summary('checks');
console.log('\nartifacts: ' + ARTIFACTS_DIR);
if (shots.length) console.log('screenshots: ' + shots.map((file) => path.basename(file)).join(', '));
if (stats.failed > 0) process.exit(1);
process.exit(0);
