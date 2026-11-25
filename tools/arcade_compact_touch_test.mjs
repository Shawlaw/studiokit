#!/usr/bin/env node
/**
 * Arcade 0.19.0 门禁：矮视口紧凑布局 + 单手触屏（真实触控事件）。
 *
 * 覆盖：
 * - CT-01 紧凑视口（375×548 / 390×664 / 360×600 标签页、375×667 独立窗口、320×568）16 款游戏：
 *       无横向/纵向溢出；站点壳条收起、顶栏返回箭头 ≥44px；说明行让位给画布；
 *       开局弹层「开始游戏」与全部弹层按钮首屏可见且 ≥44px；画布占屏不低于下限。
 * - CT-02 高屏回归（390×844 / 430×932）：壳条与说明行照常显示、拇指区暂停键在位、无溢出。
 * - CT-03 11 款实时游戏：拇指区暂停键可见、可用、≥44px、中心落在屏幕下部 40%。
 * - CT-04 恢复门（真实触控）：重力翻转——暂停后点「继续」只解冻画面，距离不再增长；
 *       开门那一下不翻转重力；再点才翻转。俄罗斯方块——按住「加速」键恢复的同一触控即生效。
 *       星海突击——拖动恢复的同一触控即开始拖动。
 * - CT-05 结算防误触（真实触控）：星海突击 CLEAR 面板出现后 450ms 内的点击被忽略。
 * - CT-06 挑战选关层「返回开始」在记忆翻牌 / 贪吃蛇 / 雪铃 / 层塔可用。
 * - CT-07 黄金矿工具品坞：按钮间隙不再穿透到画布，点在间隙不会放钩。
 * - CT-08 鼠标会话点「继续」立即恢复，不进入恢复门。
 * - CT-09 雪铃半屏方向锁：触点刚过中线不反向，越过 40 逻辑像素才换向。
 * - CT-10 影跃：按住不抬指上滑即影冲。
 * - CT-11 砖块计划：挡板相对拖动（落指不瞬移，增益约 1.2）。
 * - CT-12 二十一点：按下不出牌、原位抬起确认、滑出取消。
 * - CT-13 2048 道具行行尾撤销键可用并落在拇指区。
 * - CT-14 星海突击空槽收起为一格容量指示。
 * - CT-15 打地鼠经典模式第二根手指可直接敲击。
 * - CT-16 动作类道具按下即触发，抬指不重复触发。
 * - CT-17 紧凑模式下选关 / 机库面板铺满顶栏以下屏幕，关卡与返回无需滚动即可点。
 * - CT-18 记忆翻牌：按下不翻、原位抬起翻开、滑出取消、牌间间隙命中最近牌心。
 *
 * 零 npm 依赖：复用 tools/lib/arcade_cdp.mjs；端口默认 8827 / 9427。
 * 运行：node tools/arcade_compact_touch_test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, createRecorder, envPort, launchChrome, openPage, sleep, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const ARTIFACTS = path.join(REPO_ROOT, 'test-artifacts');
const SERVER_PORT = envPort('ARCADE_COMPACT_PORT', 8827);
const CDP_PORT = envPort('ARCADE_COMPACT_CDP', 9427);
const { record, assert, summary } = createRecorder();
const BASE = `http://127.0.0.1:${SERVER_PORT}`;

const GAMES = ['memory-flip', 'merge-2048', 'blackjack', 'gomoku', 'solitaire', 'snowbells', 'brick-breaker', 'gravity-flip',
  'snake-run', 'mole-whack', 'block-drop', 'star-raid', 'road-rush', 'shadow-leap', 'pendulum-tower', 'gold-miner'];
/* 俄罗斯方块自带上/下两组操作键之间的暂停键；其余 10 款用引擎的拇指区暂停键。 */
const REALTIME = ['snowbells', 'brick-breaker', 'gravity-flip', 'snake-run', 'mole-whack', 'block-drop', 'star-raid', 'road-rush',
  'shadow-leap', 'pendulum-tower', 'gold-miner'];
const COMPACT = [
  { id: '375x548-tab', w: 375, h: 548, standalone: false },
  { id: '390x664-tab', w: 390, h: 664, standalone: false },
  { id: '360x600-tab', w: 360, h: 600, standalone: false },
  { id: '375x667-pwa', w: 375, h: 667, standalone: true },
  { id: '320x568-tab', w: 320, h: 568, standalone: false },
];
const TALL = [
  { id: '390x844-tab', w: 390, h: 844, standalone: false },
  { id: '430x932-tab', w: 430, h: 932, standalone: false },
];

/* --quick：只跑行为验证（CT-04 起），用于调试；门禁以完整运行为准。 */
const QUICK = process.argv.includes('--quick');

const CLEAR = `(async () => { try { localStorage.clear(); } catch (e) {} try { const dbs = await indexedDB.databases(); await Promise.all(dbs.map((d) => new Promise((res) => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = res; }))); } catch (e) {} return true; })()`;

const LAYOUT = `(() => {
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: b.left, y: b.top, w: b.width, h: b.height, right: b.right, bottom: b.bottom,
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0 };
  };
  const vis = (el) => !!el && !el.closest('[hidden]') && r(el).visible;
  const q = (s) => document.querySelector(s);
  const overlay = q('.overlay:not([hidden])');
  const panel = overlay ? overlay.querySelector('.overlay-panel') : null;
  const pr = panel ? panel.getBoundingClientRect() : null;
  const inPanel = (x) => !pr || (x.y >= pr.top - 0.5 && x.bottom <= pr.bottom + 0.5);
  const mainEl = overlay ? overlay.querySelector('[data-ov-btn]') : null;
  const main = vis(mainEl) ? Object.assign(r(mainEl), { text: mainEl.textContent.trim() }) : null;
  const ovButtons = overlay ? [...overlay.querySelectorAll('button')].filter(vis).map((b) => {
    const x = r(b);
    return { text: b.textContent.trim().slice(0, 8), y: x.y, bottom: x.bottom, w: x.w, h: x.h, inPanel: inPanel(x) };
  }) : [];
  const thumbs = [...document.querySelectorAll('.game-page [data-thumb-pause], .game-page [data-block-pause]')].filter(vis)
    .map((b) => Object.assign(r(b), { disabled: b.disabled }));
  const tools = [...document.querySelectorAll([
    '.game-page [data-joy-tool]', '.game-page [data-tool]', '.game-page [data-overview-btn]', '.game-page [data-air-dash]',
    '.game-page [data-squad-tool]', '.game-page [data-item-slot]', '.game-page [data-toolbelt] .tool-btn', '.game-page [data-dpad] button',
    '.game-page [data-touch]',
  ].join(','))].filter(vis).map((b) => Object.assign(r(b), { label: b.textContent.trim().slice(0, 6) }));
  const title = q('.game-title');
  return {
    vw: innerWidth, vh: innerHeight,
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    docH: document.documentElement.scrollHeight,
    shellbar: r(q('.studiokit-shellbar')),
    back: r(q('.game-topbar .ac-back')),
    titleClipped: title ? title.scrollWidth > title.clientWidth + 1 : false,
    hint: vis(q('.game-page .game-hint')),
    canvas: r(q('.game-canvas')),
    overlayShown: !!overlay,
    main, ovButtons, thumbs, tools,
  };
})()`;

async function setViewport(cdp, preset) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: preset.w, height: preset.h, deviceScaleFactor: 1, mobile: true });
}

async function openGame(cdp, gameId, preset, hash) {
  const url = `${BASE}/apps/arcade/games/${gameId}.html${hash || ''}`;
  await cdp.navigate(url);
  await cdp.evaluate(CLEAR);
  await cdp.navigate(url);
  if (preset.standalone) {
    await cdp.evaluate(`document.documentElement.classList.add('studiokit-shell-standalone'); window.dispatchEvent(new Event('resize')); true`);
  }
  await sleep(380);
}

/* 真实触控：CDP 派发的 trusted 事件（isTrusted=true、pointerType=touch）。 */
async function touchStart(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }] });
}
async function touchMove(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }] });
}
async function touchEnd(cdp) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function realTap(cdp, x, y) {
  await touchStart(cdp, x, y);
  await sleep(45);
  await touchEnd(cdp);
  await sleep(70);
}
async function center(cdp, selector) {
  const c = await cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
  if (!c) throw new Error('element not found: ' + selector);
  return c;
}

function checkOverflow(m, label) {
  assert(m.sw <= m.cw + 1, label + ' 横向溢出 ' + m.sw + '>' + m.cw);
  assert(m.docH <= m.vh + 1, label + ' 纵向溢出 ' + m.docH + '>' + m.vh);
}
function checkThumb(m, label) {
  assert(m.thumbs.length >= 1, label + ' 缺少拇指区暂停键');
  m.thumbs.forEach((t) => {
    assert(t.w >= 44 && t.h >= 44, label + ' 暂停键不足 44px: ' + JSON.stringify(t));
    assert(!t.disabled, label + ' 游玩态暂停键不应禁用');
    const cy = t.y + t.h / 2;
    assert(cy >= m.vh * 0.6, label + ' 暂停键不在屏幕下部 40%: y=' + Math.round(cy) + ' vh=' + m.vh);
  });
}

async function main() {
  let server = null;
  let launched = null;
  let cdp = null;
  try {
    server = await startServer({ root: REPO_ROOT, port: SERVER_PORT });
    launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'arcade-compact-' });
    cdp = await openPage({ port: CDP_PORT, width: 390, height: 844, deviceScaleFactor: 1, mobile: true, artifactsDir: ARTIFACTS });

    /* ---------- CT-01 / CT-03 紧凑视口 ---------- */
    const evidence = [];
    for (const preset of QUICK ? [] : COMPACT) {
      await setViewport(cdp, preset);
      for (const gameId of GAMES) {
        const label = gameId + ' @ ' + preset.id;
        await openGame(cdp, gameId, preset);
        const start = await cdp.evaluate(LAYOUT);
        checkOverflow(start, label + ' 开局');
        assert(!start.shellbar || start.shellbar.h === 0, label + ' 紧凑模式应收起站点壳条');
        assert(start.back && start.back.visible && start.back.w >= 44 && start.back.h >= 44, label + ' 顶栏返回箭头应可见且 ≥44px: ' + JSON.stringify(start.back));
        assert(start.titleClipped === false, label + ' 标题被截断');
        assert(start.hint === false, label + ' 紧凑模式说明行应让位给画布');
        assert(start.canvas && start.canvas.w >= 150 && start.canvas.h >= 240, label + ' 画布过小: ' + JSON.stringify(start.canvas));
        const area = (start.canvas.w * start.canvas.h) / (start.vw * start.vh);
        assert(area >= 0.26, label + ' 画布占屏过低: ' + Math.round(area * 100) + '%');
        assert(start.overlayShown && start.main, label + ' 开局弹层或「开始游戏」不可见');
        assert(start.main.h >= 44 && start.main.y >= -0.5 && start.main.bottom <= start.vh + 0.5, label + ' 「开始游戏」首屏不可见: ' + JSON.stringify(start.main));
        start.ovButtons.forEach((b) => {
          assert(b.h >= 44 && b.y >= -0.5 && b.bottom <= start.vh + 0.5 && b.inPanel, label + ' 弹层按钮不可见或不足 44px: ' + JSON.stringify(b));
        });
        await cdp.evaluate(`(() => { const b = document.querySelector('[data-ov-btn]'); if (b) b.click(); return true; })()`);
        await sleep(420);
        const play = await cdp.evaluate(LAYOUT);
        checkOverflow(play, label + ' 游玩');
        assert(!play.overlayShown, label + ' 点开始后弹层未关闭');
        assert(play.canvas && play.canvas.w >= 150, label + ' 游玩态画布过小');
        play.tools.forEach((t) => {
          assert(t.w >= 44 && t.h >= 44, label + ' 操作键不足 44px: ' + JSON.stringify(t));
          assert(t.right <= play.cw + 1 && t.bottom <= play.docH + 1, label + ' 操作键越界: ' + JSON.stringify(t));
        });
        if (REALTIME.includes(gameId)) checkThumb(play, label);
        evidence.push(`${gameId.padEnd(17)} ${preset.id.padEnd(12)} 画布 ${Math.round(start.canvas.w)}x${Math.round(start.canvas.h)} (${(area * 100).toFixed(0)}%)  弹层按钮 ${start.ovButtons.length} 个全部可见`);
      }
    }
    record('CT-01/03 紧凑视口 5 档 × 16 款：0 溢出、开始与全部弹层按钮首屏可见、画布 ≥26%、11 款实时游戏拇指区暂停键在位', true);
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACTS, 'compact-layout-evidence.txt'), evidence.join('\n') + '\n');

    /* ---------- CT-02 高屏回归 ---------- */
    for (const preset of QUICK ? [] : TALL) {
      await setViewport(cdp, preset);
      for (const gameId of GAMES) {
        const label = gameId + ' @ ' + preset.id;
        await openGame(cdp, gameId, preset);
        const start = await cdp.evaluate(LAYOUT);
        checkOverflow(start, label);
        assert(start.shellbar && start.shellbar.h >= 38, label + ' 高屏应保留站点壳条');
        /* 贪吃蛇与俄罗斯方块的说明行在触屏上由各自页面样式隐藏（0.8.4 起），不属于紧凑模式的改动。 */
        if (!['snake-run', 'block-drop'].includes(gameId)) assert(start.hint === true, label + ' 高屏应保留说明行');
        assert(start.overlayShown && start.main && start.main.bottom <= start.vh + 0.5, label + ' 「开始游戏」不可见');
        await cdp.evaluate(`(() => { const b = document.querySelector('[data-ov-btn]'); if (b) b.click(); return true; })()`);
        await sleep(420);
        const play = await cdp.evaluate(LAYOUT);
        checkOverflow(play, label + ' 游玩');
        if (REALTIME.includes(gameId)) checkThumb(play, label);
      }
    }
    record('CT-02 高屏回归 390×844 / 430×932：壳条与说明行保留、拇指区暂停键在位、0 溢出', true);

    /* ---------- CT-04 恢复门（真实触控） ---------- */
    const small = COMPACT[0];
    await setViewport(cdp, small);
    await openGame(cdp, 'gravity-flip', small, '#test');
    let c = await center(cdp, '[data-ov-btn]');
    await realTap(cdp, c.x, c.y);
    let info = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(info.state === 'playing', '重力翻转：真实触控点「开始游戏」后未进入游玩态: ' + info.state);
    c = await center(cdp, '[data-thumb-pause]');
    await realTap(cdp, c.x, c.y);
    info = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(info.state === 'paused', '重力翻转：点拇指区暂停键未暂停: ' + info.state);
    assert(info.dist > 0, '重力翻转：暂停前应有进度');
    c = await center(cdp, '[data-ov-btn]');
    await realTap(cdp, c.x, c.y);
    await sleep(120);
    const gate0 = await cdp.evaluate(`({ info: window.__arcadeTest.info(), gate: !!document.querySelector('.ac-resume-gate'), overlay: !!document.querySelector('.overlay:not([hidden])') })`);
    assert(gate0.info.state === 'playing' && gate0.overlay === false, '重力翻转：点「继续」后应关闭弹层并回到游玩态');
    assert(gate0.gate === true, '重力翻转：触屏会话点「继续」后应进入恢复门（提示未出现）');
    await sleep(450);
    const gate1 = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(gate1.dist === gate0.info.dist, '重力翻转：恢复门期间距离不应增长: ' + gate0.info.dist + ' → ' + gate1.dist);
    let canvasC = await center(cdp, '.game-canvas');
    await realTap(cdp, canvasC.x, canvasC.y);
    const gate2 = await cdp.evaluate(`({ info: window.__arcadeTest.info(), gate: !!document.querySelector('.ac-resume-gate') })`);
    assert(gate2.gate === false, '重力翻转：触控后恢复门提示应消失');
    assert(gate2.info.player.gravityDir === gate0.info.player.gravityDir, '重力翻转：开门的那一下触控不应翻转重力');
    await sleep(500);
    const gate3 = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(gate3.dist > gate2.info.dist, '重力翻转：开门后应继续推进');
    await realTap(cdp, canvasC.x, canvasC.y);
    const gate4 = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(gate4.player.gravityDir !== gate3.player.gravityDir, '重力翻转：开门后的下一次触控应正常翻转重力');
    record('CT-04a 恢复门（重力翻转）：恢复门期间不推进、开门触控被吞、之后正常翻转', true);

    await openGame(cdp, 'block-drop', small, '#test');
    c = await center(cdp, '[data-ov-btn]');
    await realTap(cdp, c.x, c.y);
    c = await center(cdp, '[data-block-pause]');
    await realTap(cdp, c.x, c.y);
    info = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(info.state === 'paused', '俄罗斯方块：点拇指区暂停键未暂停: ' + info.state);
    c = await center(cdp, '[data-ov-btn]');
    await realTap(cdp, c.x, c.y);
    await sleep(120);
    const bd0 = await cdp.evaluate(`({ info: window.__arcadeTest.info(), gate: !!document.querySelector('.ac-resume-gate') })`);
    assert(bd0.gate === true && bd0.info.state === 'playing', '俄罗斯方块：点「继续」后应进入恢复门');
    c = await center(cdp, '[data-touch="soft"]');
    await touchStart(cdp, c.x, c.y);
    await sleep(340);
    const bd1 = await cdp.evaluate(`({ info: window.__arcadeTest.info(), gate: !!document.querySelector('.ac-resume-gate') })`);
    await touchEnd(cdp);
    assert(bd1.gate === false, '俄罗斯方块：按下操作键后恢复门应打开');
    assert(bd1.info.curY >= bd0.info.curY + 2, '俄罗斯方块：按住「加速」恢复的同一触控应直接生效: ' + bd0.info.curY + ' → ' + bd1.info.curY);
    record('CT-04b 恢复门（俄罗斯方块）：按住「加速」键恢复，同一次触控即生效', true);

    await openGame(cdp, 'star-raid', small, '#test');
    c = await center(cdp, '[data-ov-btn]');
    await realTap(cdp, c.x, c.y);
    c = await center(cdp, '[data-thumb-pause]');
    await realTap(cdp, c.x, c.y);
    info = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(info.state === 'paused', '星海突击：点画布角落暂停钮未暂停: ' + info.state);
    c = await center(cdp, '[data-ov-btn]');
    await realTap(cdp, c.x, c.y);
    await sleep(120);
    const sr0 = await cdp.evaluate(`({ info: window.__arcadeTest.info(), gate: !!document.querySelector('.ac-resume-gate') })`);
    assert(sr0.gate === true && sr0.info.state === 'playing', '星海突击：点「继续」后应进入恢复门');
    canvasC = await center(cdp, '.game-canvas');
    await touchStart(cdp, canvasC.x, canvasC.y);
    await sleep(40);
    for (let i = 1; i <= 4; i += 1) {
      await touchMove(cdp, canvasC.x + i * 18, canvasC.y);
      await sleep(30);
    }
    await sleep(220);
    const sr1 = await cdp.evaluate(`({ info: window.__arcadeTest.info(), gate: !!document.querySelector('.ac-resume-gate') })`);
    await touchEnd(cdp);
    assert(sr1.gate === false, '星海突击：触控后恢复门应打开');
    assert(sr1.info.player.x > sr0.info.player.x + 20, '星海突击：拖动恢复的同一触控应带动飞船: ' + sr0.info.player.x + ' → ' + sr1.info.player.x);
    assert(sr1.info.stageTime > sr0.info.stageTime, '星海突击：开门后关卡时间应继续推进');

    /* ---------- CT-05 结算防误触 ---------- */
    await cdp.evaluate(`(() => { const t = window.__arcadeTest; t.spawnBossNow(); t.damageBoss(999999); return true; })()`);
    await sleep(60);
    c = await center(cdp, '[data-ov-btn]');
    await realTap(cdp, c.x, c.y);
    const freshState = await cdp.evaluate(`window.__arcadeTest.info().state`);
    assert(freshState === 'clear', '星海突击：CLEAR 面板出现后 450ms 内的触控不应触发「下一关」: ' + freshState);
    await sleep(620);
    await realTap(cdp, c.x, c.y);
    await sleep(120);
    const afterGuard = await cdp.evaluate(`window.__arcadeTest.info().state`);
    assert(afterGuard === 'playing', '星海突击：防抖窗口过后「下一关」应可用: ' + afterGuard);
    record('CT-04c/05 星海突击：拖动恢复即生效；CLEAR 面板 450ms 防误触生效且过后可用', true);

    /* ---------- CT-06 挑战选关层「返回开始」 ---------- */
    await setViewport(cdp, TALL[0]);
    for (const gameId of ['memory-flip', 'snake-run', 'snowbells', 'pendulum-tower']) {
      await openGame(cdp, gameId, TALL[0]);
      await cdp.evaluate(`document.querySelector('[data-ov-btn2]').click(); true`);
      await sleep(300);
      c = await center(cdp, '[data-ch-back]');
      await realTap(cdp, c.x, c.y);
      await sleep(250);
      const back = await cdp.evaluate(`(() => { const b = document.querySelector('[data-ch-back]'); const o = document.querySelector('.overlay:not([hidden])'); const m = o && o.querySelector('[data-ov-btn]'); return { backHidden: !b || !!b.closest('[hidden]') || getComputedStyle(b).display === 'none', overlay: !!o, main: m ? m.textContent.trim() : '', paused: document.querySelector('[data-pause]').disabled }; })()`);
      assert(back.backHidden && back.overlay && back.main.indexOf('开始') !== -1, gameId + '：点「返回开始」应回到开局弹层: ' + JSON.stringify(back));
    }
    record('CT-06 记忆翻牌 / 贪吃蛇 / 雪铃 / 层塔：挑战选关层「返回开始」回到开局弹层', true);

    /* ---------- CT-07 黄金矿工具品坞不穿透 ---------- */
    await openGame(cdp, 'gold-miner', TALL[0], '#test');
    await cdp.evaluate(`document.querySelector('[data-ov-btn]').click(); true`);
    await sleep(300);
    const gap = await cdp.evaluate(`(() => {
      const dock = document.querySelector('[data-toolbelt]');
      const btns = [...dock.querySelectorAll('.tool-btn')];
      const a = btns[0].getBoundingClientRect();
      const b = btns[1].getBoundingClientRect();
      const x = (a.right + b.left) / 2;
      const y = a.top + a.height / 2;
      const hit = document.elementFromPoint(x, y);
      const pad = dock.getBoundingClientRect();
      const padHit = document.elementFromPoint(btns[0].getBoundingClientRect().left + 10, pad.top + 6);
      return { x, y, hitInDock: !!hit && !!hit.closest('[data-toolbelt]'), hitIsCanvas: !!hit && hit.tagName === 'CANVAS', padHitInDock: !!padHit && !!padHit.closest('[data-toolbelt]') };
    })()`);
    assert(gap.hitInDock && !gap.hitIsCanvas && gap.padHitInDock, '黄金矿工：道具坞间隙/内边距不应命中画布: ' + JSON.stringify(gap));
    /* 钩子空放一轮往返只要约 0.4 秒：不在某一刻单次采样，而是在页面内逐帧记录「是否离开过摆动态」。 */
    const clawWatch = () => cdp.evaluate(`(() => {
      window.__clawLeftSwing = false;
      const tick = () => {
        if (window.__arcadeTest.info().clawState !== 'swing') { window.__clawLeftSwing = true; return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return true;
    })()`);
    await clawWatch();
    await realTap(cdp, gap.x, gap.y);
    await sleep(420);
    const claw = await cdp.evaluate(`({ left: window.__clawLeftSwing, claw: window.__arcadeTest.info().clawState })`);
    assert(claw.left === false && claw.claw === 'swing', '黄金矿工：点在道具坞间隙不应放钩: ' + JSON.stringify(claw));
    const cv = await center(cdp, '.game-canvas');
    await clawWatch();
    await realTap(cdp, cv.x, cv.y - cv.h * 0.3);
    await sleep(260);
    const fired = await cdp.evaluate(`({ left: window.__clawLeftSwing, claw: window.__arcadeTest.info().clawState })`);
    assert(fired.left === true, '黄金矿工：点画布上部应正常放钩: ' + JSON.stringify(fired));
    record('CT-07 黄金矿工：道具坞间隙不穿透、不误放钩；画布点按仍正常放钩', true);

    /* ---------- CT-08 鼠标会话不启用恢复门 ---------- */
    const mouseClick = async (x, y) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await sleep(45);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await sleep(90);
    };
    const canvasRect = async () => cdp.evaluate(`(() => { const r = document.querySelector('.game-canvas').getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; })()`);
    const testInfo = async () => cdp.evaluate(`window.__arcadeTest.info()`);
    await setViewport(cdp, TALL[0]);
    await openGame(cdp, 'gravity-flip', TALL[0], '#test');
    c = await center(cdp, '[data-ov-btn]');
    await mouseClick(c.x, c.y);
    c = await center(cdp, '[data-pause]');
    await mouseClick(c.x, c.y);
    info = await testInfo();
    assert(info.state === 'paused', '鼠标会话：点顶栏暂停未暂停: ' + info.state);
    c = await center(cdp, '[data-ov-btn]');
    await mouseClick(c.x, c.y);
    await sleep(140);
    const mouseGate = await cdp.evaluate(`({ info: window.__arcadeTest.info(), gate: !!document.querySelector('.ac-resume-gate') })`);
    assert(mouseGate.gate === false && mouseGate.info.state === 'playing', '鼠标会话：点「继续」不应进入恢复门');
    await sleep(450);
    const mouseRun = await testInfo();
    assert(mouseRun.dist > mouseGate.info.dist, '鼠标会话：点「继续」后应立即继续推进');
    record('CT-08 鼠标会话：点「继续」立即恢复，不进入恢复门', true);

    /* ---------- CT-09 半屏方向锁（雪铃） ---------- */
    await setViewport(cdp, small);
    await openGame(cdp, 'snowbells', small, '#test');
    c = await center(cdp, '[data-ov-btn]');
    await realTap(cdp, c.x, c.y);
    const cvS = await canvasRect();
    const toClient = (lx, ly) => ({ x: cvS.left + (lx / 420) * cvS.w, y: cvS.top + (ly / 740) * cvS.h });
    let pt = toClient(100, 400);
    await touchStart(cdp, pt.x, pt.y);
    await sleep(160);
    pt = toClient(222, 400); /* 越过中线 12 逻辑像素，仍在 40px 滞回带内 */
    await touchMove(cdp, pt.x, pt.y);
    const latchA = await testInfo();
    await sleep(260);
    const latchB = await testInfo();
    await touchEnd(cdp);
    assert(latchB.player.x < latchA.player.x - 8, '雪铃：触点刚越过中线不应反向（滞回带内继续向左）: ' + latchA.player.x + ' → ' + latchB.player.x);
    await sleep(220);
    pt = toClient(100, 400);
    await touchStart(cdp, pt.x, pt.y);
    await sleep(160);
    pt = toClient(280, 400); /* 越过中线 70 逻辑像素，超出滞回带 */
    await touchMove(cdp, pt.x, pt.y);
    const latchC = await testInfo();
    await sleep(520);
    const latchD = await testInfo();
    await touchEnd(cdp);
    assert(latchD.player.x > latchC.player.x + 4, '雪铃：触点越过滞回带后应换向: ' + latchC.player.x + ' → ' + latchD.player.x);
    record('CT-09 雪铃：触点刚过中线不反向，越过 40 逻辑像素才换向', true);

    /* ---------- CT-10 上滑影冲（影跃） ---------- */
    await openGame(cdp, 'shadow-leap', small, '#test');
    c = await center(cdp, '[data-ov-btn]');
    await realTap(cdp, c.x, c.y);
    await sleep(250);
    const dashInfo = async () => cdp.evaluate(`window.__arcadeTest.dashInfo()`);
    const dash0 = await dashInfo();
    assert(dash0.state === 'playing' && dash0.dashCharges === 1, '影跃：开局应有 1 次影冲: ' + JSON.stringify(dash0));
    canvasC = await center(cdp, '.game-canvas');
    await touchStart(cdp, canvasC.x + 60, canvasC.y + 40);
    await sleep(30);
    let dash1 = null;
    for (let i = 1; i <= 5; i += 1) {
      await touchMove(cdp, canvasC.x + 60, canvasC.y + 40 - i * 18);
      await sleep(28);
      if (i === 3) dash1 = await dashInfo();
    }
    await touchEnd(cdp);
    assert(dash1 && (dash1.dashing || dash1.dashCharges === 0), '影跃：转向的拇指上滑应触发影冲: ' + JSON.stringify(dash1 && { d: dash1.dashCharges, t: dash1.dashTimer }));
    assert(dash1 && dash1.vx > 0, '影跃：按住右半屏上滑应向右影冲: vx=' + (dash1 && dash1.vx));
    record('CT-10 影跃：按住不抬指上滑即影冲，方向取当前按住的一侧', true);

    /* ---------- CT-11 相对拖动（砖块计划） ---------- */
    await openGame(cdp, 'brick-breaker', small, '#test');
    c = await center(cdp, '[data-ov-btn]');
    await realTap(cdp, c.x, c.y);
    const paddle0 = await testInfo();
    const cvB = await canvasRect();
    await touchStart(cdp, cvB.left + cvB.w * 0.5, cvB.top + cvB.h * 0.35);
    await sleep(160);
    const paddle1 = await testInfo();
    assert(Math.abs(paddle1.paddle.x - paddle0.paddle.x) <= 2, '砖块计划：落指不应让挡板瞬移到指尖: ' + paddle0.paddle.x + ' → ' + paddle1.paddle.x);
    await touchMove(cdp, cvB.left + cvB.w * 0.5 + 60, cvB.top + cvB.h * 0.35);
    await sleep(140);
    const paddle2 = await testInfo();
    await touchEnd(cdp);
    const paddleGain = (paddle2.paddle.x - paddle1.paddle.x) / (60 / (cvB.w / 420));
    assert(paddleGain > 1.0 && paddleGain < 1.45, '砖块计划：挡板应按指尖位移的约 1.2 倍相对移动，实测增益 ' + paddleGain.toFixed(2));
    record('CT-11 砖块计划：挡板相对拖动，落指不瞬移，增益 ' + paddleGain.toFixed(2), true);

    /* ---------- CT-12 抬起确认（二十一点） ---------- */
    /* 起手天生 21 点会立即结算、不进入决策期（约一成的手牌）：遇到就换下一手 / 重开，直到进入决策期。 */
    let cvJ = null;
    let hitBtn = null;
    const toDecisionPhase = async () => {
      for (let i = 0; i < 10; i += 1) {
        const st = await testInfo();
        if (st.state === 'playing' && st.phase === 'player') return st;
        if (st.state !== 'playing') return null;
        await realTap(cdp, hitBtn.x, hitBtn.y); /* 结算界面同一位置是「下一手」 */
        await sleep(240);
      }
      return null;
    };
    let bj = null;
    for (let attempt = 0; attempt < 5 && !bj; attempt += 1) {
      await openGame(cdp, 'blackjack', small, '#test');
      c = await center(cdp, '[data-ov-btn]');
      await realTap(cdp, c.x, c.y);
      await sleep(220);
      cvJ = await canvasRect();
      const jClient = (lx, ly) => ({ x: cvJ.left + (lx / 420) * cvJ.w, y: cvJ.top + (ly / 740) * cvJ.h });
      hitBtn = jClient(24 + 90, 506 + 60);
      bj = await toDecisionPhase();
    }
    assert(bj, '二十一点：多手尝试后应进入决策期');
    assert(bj.player.length === 2, '二十一点：决策期应有 2 张手牌: ' + bj.player.length);
    await touchStart(cdp, hitBtn.x, hitBtn.y);
    await sleep(260);
    const heldInfo = await testInfo();
    assert(heldInfo.player.length === 2, '二十一点：按下未抬起时不应要牌: ' + heldInfo.player.length);
    await touchEnd(cdp);
    await sleep(200);
    const releasedInfo = await testInfo();
    assert(releasedInfo.player.length === 3, '二十一点：原位抬起应确认要牌: ' + releasedInfo.player.length);
    const beforeCancel = await toDecisionPhase();
    assert(beforeCancel, '二十一点：应回到决策期');
    await touchStart(cdp, hitBtn.x, hitBtn.y);
    await sleep(120);
    const outside = { x: cvJ.left + cvJ.w / 2, y: cvJ.top + cvJ.h * 0.2 };
    await touchMove(cdp, outside.x, outside.y);
    await sleep(60);
    await touchEnd(cdp);
    await sleep(200);
    const cancelledInfo = await testInfo();
    assert(cancelledInfo.state === 'playing' && cancelledInfo.phase === 'player' && cancelledInfo.player.length === beforeCancel.player.length,
      '二十一点：滑出按钮后抬起应取消: ' + beforeCancel.player.length + ' → ' + cancelledInfo.player.length + ' phase=' + cancelledInfo.phase);
    record('CT-12 二十一点：按下不出牌、原位抬起确认、滑出取消', true);

    /* ---------- CT-13 道具行行尾撤销（2048） ---------- */
    await openGame(cdp, 'merge-2048', small, '#test');
    c = await center(cdp, '[data-ov-btn]');
    await realTap(cdp, c.x, c.y);
    const cvM = await canvasRect();
    const mx = cvM.left + cvM.w / 2;
    const my = cvM.top + cvM.h / 2;
    const undo0 = (await testInfo()).undo;
    for (const [dx, dy] of [[-70, 0], [70, 0], [0, -70], [0, 70]]) {
      await touchStart(cdp, mx, my);
      await sleep(30);
      await touchMove(cdp, mx + dx * 0.5, my + dy * 0.5);
      await sleep(30);
      await touchMove(cdp, mx + dx, my + dy);
      await sleep(30);
      await touchEnd(cdp);
      await sleep(220);
      if ((await testInfo()).undo > undo0) break;
    }
    const undo1 = (await testInfo()).undo;
    assert(undo1 === undo0 + 1, '2048：滑动后应产生一步可撤销记录: ' + undo0 + ' → ' + undo1);
    const undoThumb = await cdp.evaluate(`(() => { const b = document.querySelector('[data-undo-thumb]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
    assert(undoThumb && undoThumb.w >= 44 && undoThumb.h >= 44 && undoThumb.y >= 0.6 * small.h, '2048：道具行行尾应有 ≥44px 的撤销键并落在拇指区: ' + JSON.stringify(undoThumb));
    await realTap(cdp, undoThumb.x, undoThumb.y);
    await sleep(160);
    const undo2 = (await testInfo()).undo;
    assert(undo2 === undo0, '2048：点行尾撤销应撤销一步: ' + undo1 + ' → ' + undo2);
    record('CT-13 2048：道具行行尾撤销键可用并落在拇指区', true);

    /* ---------- CT-14 星海突击空槽收起 ---------- */
    await openGame(cdp, 'star-raid', small, '#test');
    c = await center(cdp, '[data-ov-btn]');
    await realTap(cdp, c.x, c.y);
    const rowInfo = () => cdp.evaluate(`(() => {
      const row = document.querySelector('[data-game-tools]');
      const shown = [...row.querySelectorAll('.touch-btn')].filter((b) => !b.hidden);
      const tools = [...row.querySelectorAll('[data-joy-tool]')].map((b) => Math.round(b.getBoundingClientRect().width));
      const slots = [...document.querySelectorAll('[data-item-slot]')];
      const placeholderSlot = slots.find((b) => !b.hidden && !b.classList.contains('is-armed'));
      return { shown: shown.length, cols: getComputedStyle(row).gridTemplateColumns.split(' ').length, minTool: Math.min(...tools), placeholder: placeholderSlot ? placeholderSlot.textContent.trim() : '' };
    })()`);
    const row0 = await rowInfo();
    assert(row0.shown === 4 && row0.cols === 4 && row0.placeholder.indexOf('0/2') !== -1, '星海突击：开局空槽应收起为一格容量指示: ' + JSON.stringify(row0));
    assert(row0.minTool >= 60, '星海突击：收起空槽后三个主动道具应更宽: ' + JSON.stringify(row0));
    await cdp.evaluate(`window.__arcadeTest.grantItem('nuke'); true`);
    await sleep(160);
    const row1 = await rowInfo();
    assert(row1.shown === 5 && row1.cols === 5 && row1.placeholder.indexOf('1/2') !== -1, '星海突击：获得军械后对应槽位展开: ' + JSON.stringify(row1));
    record('CT-14 星海突击：空槽收起为一格「军械 n/N」，三个主动道具变宽；获得军械后展开', true);

    /* ---------- CT-15 打地鼠经典模式第二根手指 ---------- */
    await openGame(cdp, 'mole-whack', small, '#test');
    c = await center(cdp, '[data-ov-btn]');
    await realTap(cdp, c.x, c.y);
    const secondFinger = await cdp.evaluate(`(async () => {
      const c = document.querySelector('.game-canvas');
      const r = c.getBoundingClientRect();
      const at = (lx, ly) => ({ clientX: r.left + (lx / 420) * r.width, clientY: r.top + (ly / 740) * r.height });
      const fire = (type, id, lx, ly) => c.dispatchEvent(new PointerEvent(type, Object.assign({ pointerId: id, pointerType: 'touch', isPrimary: id === 31, bubbles: true, cancelable: true }, at(lx, ly))));
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      fire('pointerdown', 31, 90, 300);
      await wait(70);
      const afterFirst = window.__arcadeTest.info().classicSecondFingerTaps;
      fire('pointerdown', 32, 330, 560);
      await wait(70);
      const afterSecond = window.__arcadeTest.info().classicSecondFingerTaps;
      fire('pointerup', 31, 90, 300);
      return { afterFirst, afterSecond };
    })()`);
    assert(secondFinger.afterFirst === 0 && secondFinger.afterSecond === 1, '打地鼠：第一根手指不应被重复计入，第二根手指应可直接敲击: ' + JSON.stringify(secondFinger));
    record('CT-15 打地鼠：经典模式第二根手指可直接敲击，且不会与主触点重复', true);

    /* ---------- CT-16 道具按下即触发 ---------- */
    await openGame(cdp, 'gravity-flip', small, '#test');
    c = await center(cdp, '[data-ov-btn]');
    await realTap(cdp, c.x, c.y);
    c = await center(cdp, '[data-joy-tool="shield"]');
    await touchStart(cdp, c.x, c.y);
    await sleep(170);
    const onPressed = await testInfo();
    await touchEnd(cdp);
    await sleep(140);
    const onReleased = await testInfo();
    assert(onPressed.shieldArmed === true, '重力翻转：护盾应在按下时立即武装（不必等抬指）: ' + JSON.stringify(onPressed));
    assert(onReleased.shieldArmed === true && onReleased.tools.shield === 1, '重力翻转：抬指后的 click 不应再次触发道具: ' + JSON.stringify(onReleased));
    record('CT-16 动作类道具按下即触发，抬指不重复触发', true);

    /* ---------- CT-17 紧凑模式下的选关 / 机库面板 ---------- */
    await setViewport(cdp, small);
    for (const gameId of GAMES.filter((g) => !['blackjack', 'gomoku', 'solitaire'].includes(g))) {
      await openGame(cdp, gameId, small);
      await cdp.evaluate(`document.querySelector('[data-ov-btn2]').click(); true`);
      await sleep(380);
      const panel = await cdp.evaluate(`(() => {
        const open = [...document.querySelectorAll('[data-ch-layer], .challenge-sheet, .challenge-select, .stage-wrap > .ac-challenge-panel')]
          .find((el) => !el.hidden && getComputedStyle(el).display !== 'none');
        if (!open) return { open: false };
        const r = open.getBoundingClientRect();
        const topbar = document.querySelector('.game-topbar').getBoundingClientRect();
        const stages = [...open.querySelectorAll('[data-stage-id]')].filter((b) => !b.closest('[hidden]'));
        /* 静态写法带 data-ch-back；2048 / 方块的返回按钮是运行时创建的 .challenge-back。 */
        const back = open.querySelector('[data-ch-back], .challenge-back');
        const br = back ? back.getBoundingClientRect() : null;
        const hitTop = document.elementFromPoint(innerWidth / 2, topbar.top + topbar.height / 2);
        const hitBack = br ? document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2) : null;
        const overlay = document.querySelector('.overlay:not([hidden])');
        return {
          open: true, pos: getComputedStyle(open).position,
          left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom),
          vw: innerWidth, vh: innerHeight, topbarBottom: Math.round(topbar.bottom),
          stages: stages.length, minStageH: stages.length ? Math.min(...stages.map((b) => Math.round(b.getBoundingClientRect().height))) : 0,
          backVisible: !!br && br.height >= 44 && br.top >= r.top - 1 && br.bottom <= innerHeight + 1,
          backHittable: !!hitBack && !!back && (hitBack === back || back.contains(hitBack)),
          topbarHittable: !!hitTop && !!hitTop.closest('.game-topbar'),
          overlayPainted: !!overlay && getComputedStyle(overlay).visibility !== 'hidden',
        };
      })()`);
      assert(panel.open && panel.pos === 'fixed', gameId + '：紧凑模式下选关面板应提升为全屏面板: ' + JSON.stringify(panel));
      assert(panel.left === 0 && panel.right === panel.vw && panel.top >= panel.topbarBottom && panel.bottom === panel.vh,
        gameId + '：选关面板应从顶栏下方起铺满屏幕: ' + JSON.stringify(panel));
      assert(panel.stages === 6 && panel.minStageH >= 44, gameId + '：6 个关卡应全部可见且 ≥44px: ' + JSON.stringify(panel));
      assert(panel.backVisible && panel.backHittable, gameId + '：「返回开始」应无需滚动即可点到: ' + JSON.stringify(panel));
      assert(panel.topbarHittable && !panel.overlayPainted, gameId + '：选关面板打开时顶栏应清晰可点、开局弹层不应透出: ' + JSON.stringify(panel));
      const backC = await center(cdp, '[data-ch-back], .challenge-back');
      await realTap(cdp, backC.x, backC.y);
      await sleep(280);
      const afterBack = await cdp.evaluate(LAYOUT);
      assert(afterBack.overlayShown && afterBack.main, gameId + '：点「返回开始」应回到开局弹层');
    }
    await openGame(cdp, 'star-raid', small);
    await cdp.evaluate(`document.querySelector(\'[data-ov-btn3]\').click(); true`);
    await sleep(380);
    const hangar = await cdp.evaluate(`(() => {
      const p = document.querySelector(\'[data-hangar-panel]\');
      if (!p || p.hidden) return { open: false };
      const r = p.getBoundingClientRect();
      const back = p.querySelector(\'[data-hangar-back]\');
      const br = back.getBoundingClientRect();
      const hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
      return { open: true, pos: getComputedStyle(p).position, left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight, backH: Math.round(br.height), backHittable: hit === back || back.contains(hit) };
    })()`);
    assert(hangar.open && hangar.pos === 'fixed' && hangar.left === 0 && hangar.right === hangar.vw && hangar.bottom === hangar.vh && hangar.backH >= 44 && hangar.backHittable,
      '星海突击：紧凑模式下机库面板应铺满屏幕且「返回」可点: ' + JSON.stringify(hangar));
    const hangarBack = await center(cdp, '[data-hangar-back]');
    await realTap(cdp, hangarBack.x, hangarBack.y);
    await sleep(280);
    const afterHangar = await cdp.evaluate(LAYOUT);
    assert(afterHangar.overlayShown && afterHangar.main, '星海突击：点机库「返回」应回到开局弹层');
    record('CT-17 紧凑模式：13 款选关面板与星海机库面板铺满顶栏以下屏幕，6 关与返回无需滚动可点，顶栏不被开局弹层糊住', true);

    /* ---------- CT-18 记忆翻牌：抬起确认 + 最近牌心命中 ---------- */
    await openGame(cdp, 'memory-flip', small, '#test');
    c = await center(cdp, '[data-ov-btn]');
    await realTap(cdp, c.x, c.y);
    await sleep(720); /* 预览至少 0.6 秒后才允许点按跳过（既有规则） */
    canvasC = await center(cdp, '.game-canvas');
    await realTap(cdp, canvasC.x, canvasC.y - canvasC.h * 0.25); /* 预览期点按 = 跳过预览（仍在按下时生效） */
    await sleep(260);
    const memInfo = async () => cdp.evaluate(`({ info: window.__arcadeTest.info(), joy: window.__arcadeTest.joyInfo() })`);
    const mem0 = await memInfo();
    assert(mem0.joy.previewTimer === 0 && mem0.joy.flippedIds.length === 0, '记忆翻牌：跳过预览后应处于无翻牌的游玩态: ' + JSON.stringify(mem0.joy));
    const cvF = await canvasRect();
    const cardClient = (index) => {
      const rect = mem0.info.cardRects[index];
      return { x: cvF.left + ((rect.x + rect.w / 2) / 420) * cvF.w, y: cvF.top + ((rect.y + rect.h / 2) / 740) * cvF.h };
    };
    const card0 = cardClient(0);
    await touchStart(cdp, card0.x, card0.y);
    await sleep(260);
    const memHeld = await memInfo();
    assert(memHeld.joy.flippedIds.length === 0, '记忆翻牌：按下未抬起时不应翻牌: ' + memHeld.joy.flippedIds.length);
    await touchEnd(cdp);
    await sleep(220);
    const memReleased = await memInfo();
    assert(memReleased.joy.flippedIds.length === 1, '记忆翻牌：原位抬起应翻开这张牌: ' + memReleased.joy.flippedIds.length);
    const card1 = cardClient(1);
    await touchStart(cdp, card1.x, card1.y);
    await sleep(120);
    const away = { x: cvF.left + cvF.w / 2, y: cvF.top + cvF.h * 0.06 };
    await touchMove(cdp, away.x, away.y);
    await sleep(60);
    await touchEnd(cdp);
    await sleep(220);
    const memCancelled = await memInfo();
    assert(memCancelled.joy.flippedIds.length === 1, '记忆翻牌：滑出牌面后抬起应取消: ' + memCancelled.joy.flippedIds.length);
    /* 点在两张牌之间的间隙：命中离指尖最近的牌心 */
    const r0 = mem0.info.cardRects[0];
    const r1 = mem0.info.cardRects[1];
    const gapX = cvF.left + (((r0.x + r0.w + r1.x) / 2) / 420) * cvF.w;
    await realTap(cdp, gapX, card0.y);
    await sleep(220);
    const memGap = await memInfo();
    assert(memGap.joy.flippedIds.length === 2, '记忆翻牌：点在牌间间隙应命中最近的牌: ' + memGap.joy.flippedIds.length);
    record('CT-18 记忆翻牌：按下不翻、原位抬起翻开、滑出取消、牌间间隙命中最近牌心', true);

    assert(cdp.errors.length === 0, 'console error: ' + cdp.errors.slice(0, 3).join(' | '));
  } finally {
    if (cdp) cdp.close();
    if (server) await new Promise((r) => server.close(r));
    if (launched) await stopChrome(launched);
  }
  const outcome = summary('Arcade 0.19.0 紧凑布局与单手触屏门禁');
  if (outcome.failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('COMPACT TOUCH TEST FAILED:', err.stack || err);
  process.exitCode = 1;
});
