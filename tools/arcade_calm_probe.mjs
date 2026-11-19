#!/usr/bin/env node
/**
 * 单个 Arcade 游戏页的通用接入探针（实现期自检用，不替代正式门禁）。
 *
 * 检查内容：加载无 console error、开始弹层契约、开始/暂停、局内存档、刷新续玩、
 * 375/320 窄屏无溢出、2 个 ≥44px 画布外可选道具按钮。
 *
 * 用法：node tools/arcade_calm_probe.mjs --game=blackjack.html [--port=8781] [--cdp-port=9341]
 * 端口可避免与正式测试冲突；零 npm 依赖，需要本机 Chrome。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envPort, launchChrome, openPage, sleep, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const prefix = '--' + name + '=';
  const hit = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const GAME = arg('game', '');
const PORT = envPort('ARCADE_PROBE_PORT', Number(arg('port', 8781)) || 8781);
const CDP_PORT = envPort('ARCADE_PROBE_CDP_PORT', Number(arg('cdp-port', 9341)) || 9341);

const problems = [];
function check(ok, message, detail) {
  if (ok) {
    console.log('PASS  ' + message);
    return true;
  }
  const suffix = detail === undefined ? '' : ' — ' + JSON.stringify(detail);
  console.log('FAIL  ' + message + suffix);
  problems.push(message + suffix);
  return false;
}

async function layout(cdp, width, height, label) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await sleep(160);
  const m = await cdp.evaluate(`(() => {
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), right: Math.round(r.right) }; };
    return {
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      docH: document.documentElement.scrollHeight,
      vh: innerHeight,
      canvas: rect(document.querySelector('.game-canvas')),
      pause: rect(document.querySelector('[data-pause]')),
      back: rect(document.querySelector('.ac-back')),
      joy: [...document.querySelectorAll('[data-joy-tool]')].map((b) => ({ id: b.dataset.joyTool, ...rect(b) })),
      toolbelt: [...document.querySelectorAll('[data-toolbelt] .tool-btn')].map((b) => rect(b)),
      canvasBottom: (() => { const c = document.querySelector('.game-canvas'); return c ? Math.round(c.getBoundingClientRect().bottom) : null; })(),
    };
  })()`);
  check(m.sw <= m.cw + 1, label + ' 无横向溢出', { sw: m.sw, cw: m.cw });
  check(m.canvas && m.canvas.w > 120 && m.canvas.h > 220, label + ' 画布尺寸合理', m.canvas);
  check(m.pause && m.pause.w >= 44 && m.pause.h >= 44, label + ' 暂停按钮 ≥44px', m.pause);
  check(m.back && m.back.w >= 44 && m.back.h >= 44, label + ' 返回按钮 ≥44px', m.back);
  /* 方块页 0.8.4 起道具坞设计上嵌在画布底部空区（井口以下）；gold-miner 0.4 起是画布内 4 格工具条。
     其余游戏必须在画布外、2 个可选道具。 */
  const blockDrop = /block-drop\.html/.test(GAME);
  const goldMiner = /gold-miner\.html/.test(GAME);
  if (goldMiner) {
    check(m.toolbelt && m.toolbelt.length === 4 && m.toolbelt.every((b) => b.w >= 44 && b.h >= 44), label + ' 画布内 4 个 ≥44px 道具', m.toolbelt);
  } else if (blockDrop) {
    const wellBottom = Math.round(m.canvas ? m.canvas.top + m.canvas.h * 526 / 610 : 0);
    check(m.joy.length === 2 && m.joy.every((b) => b.w >= 44 && b.h >= 44 && b.top >= wellBottom - 1), label + ' 2 个道具坞不越过井口', { wellBottom, joy: m.joy });
  } else {
    check(m.joy.length === 2 && m.joy.every((b) => b.w >= 44 && b.h >= 44 && b.right <= m.cw + 1), label + ' 2 个 ≥44px 道具按钮', m.joy);
    check(m.joy.every((b) => m.canvasBottom !== null && b.top >= m.canvasBottom - 1), label + ' 道具按钮在画布外', { canvasBottom: m.canvasBottom, joy: m.joy });
  }
  check(m.docH <= m.vh + 1, label + ' 无纵向滚动溢出', { docH: m.docH, vh: m.vh });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(120);
}

async function main() {
  if (!GAME || !/^[a-z0-9-]+\.html$/.test(GAME)) {
    console.error('用法：node tools/arcade_calm_probe.mjs --game=<id>.html');
    return 2;
  }
  let server = null;
  let launched = null;
  let cdp = null;
  try {
    server = await startServer({ root: ROOT, port: PORT });
    launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'studiokit-probe-' });
    cdp = await openPage({ port: CDP_PORT, width: 390, height: 844, deviceScaleFactor: 1, mobile: true, artifactsDir: path.join(ROOT, 'test-artifacts') });
    const base = `http://127.0.0.1:${PORT}`;
    /* 既有 13 款游戏只在 #test 下挂测试钩子；新游戏也按同一约定实现。 */
    const pagePath = `${base}/apps/arcade/games/${GAME}`;
    const url = pagePath + '#test';

    await cdp.navigate(url);
    await sleep(420);
    const boot = await cdp.evaluate(`({ arcade: !!window.Arcade, version: window.Arcade && Arcade.version, overlay: !!(document.querySelector('[data-overlay]') && !document.querySelector('[data-overlay]').hidden), title: (document.querySelector('[data-ov-title]') || {}).textContent || '', btn: (document.querySelector('[data-ov-btn]') || {}).textContent || '', test: !!(window.__arcadeTest) })`);
    check(boot.arcade, 'engine 加载', boot);
    check(boot.overlay, '开始弹层默认可见', boot);
    check(/开始|继续/.test(boot.btn), '主按钮文案合理', boot.btn);
    check(boot.test, '提供 window.__arcadeTest 测试钩子', boot);

    await cdp.click('[data-ov-btn]');
    await sleep(420);
    const playing = await cdp.evaluate(`({ hidden: document.querySelector('[data-overlay]').hidden, pauseDisabled: document.querySelector('[data-pause]').disabled, state: window.__arcadeTest && window.__arcadeTest.joyInfo ? window.__arcadeTest.joyInfo().state : null })`);
    check(playing.hidden && playing.pauseDisabled === false, '点击开始后进入游玩态', playing);

    await cdp.click('[data-pause]');
    await sleep(180);
    const paused = await cdp.evaluate(`({ title: document.querySelector('[data-ov-title]').textContent, btn: document.querySelector('[data-ov-btn]').textContent, states: window.__arcadeTest.joyInfo ? window.__arcadeTest.joyInfo().state : null })`);
    check(/已暂停/.test(paused.title), '暂停弹层标题', paused);
    check(/继续/.test(paused.btn), '暂停主按钮为继续', paused);

    const saved = await cdp.evaluate(`(() => { const raw = localStorage.getItem('studiokit:arcade:runs:v1'); if (!raw) return null; const data = JSON.parse(raw); const rec = data.games && data.games[${JSON.stringify(GAME.replace(/\.html$/, ''))}]; return rec ? { summary: rec.summary, hasData: !!rec.data } : null; })()`);
    check(saved && saved.hasData, '暂停时写入局内存档', saved);

    /* 同 URL 仅改 hash 属于同文档导航、不会重新执行页面脚本；带查询参数强制整页重载。 */
    await cdp.navigate(pagePath + '?probe=' + Date.now() + '#test');
    await sleep(360);
    const resume = await cdp.evaluate(`({ title: document.querySelector('[data-ov-title]').textContent, btn: document.querySelector('[data-ov-btn]').textContent })`);
    check(/继续上次/.test(resume.title) && /继续/.test(resume.btn), '刷新后提供继续上次', resume);
    await cdp.click('[data-ov-btn]');
    await sleep(380);
    check(await cdp.evaluate(`document.querySelector('[data-overlay]').hidden`), '继续上次后进入游玩态');

    await layout(cdp, 375, 667, '375×667');
    await layout(cdp, 320, 568, '320×568');
    await cdp.screenshot('probe-' + GAME.replace(/\.html$/, '') + '.png');

    check(cdp.errors.length === 0, '无 console error', cdp.errors.slice(0, 5));
    console.log(problems.length === 0 ? '\nPASS  ' + GAME + ' 接入探针通过' : '\nFAIL  ' + GAME + ' 仍有 ' + problems.length + ' 项问题');
    return problems.length === 0 ? 0 : 1;
  } catch (err) {
    console.error('FAIL  探针异常: ' + (err && err.stack ? err.stack : err));
    return 1;
  } finally {
    if (cdp) {
      try {
        cdp.close();
      } catch (err) {
        /* ignore */
      }
    }
    if (launched) await stopChrome(launched);
    if (server) await server.close();
  }
}

main().then((code) => process.exit(code));
