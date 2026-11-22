#!/usr/bin/env node
/**
 * Arcade 0.13.1 门禁：PWA 更新检测 + iPhone 独立窗口顶部安全区布局。
 *
 * 覆盖：
 * - PU-01 中心页「检查更新」按钮存在且可触发 checkForUpdate()
 * - PU-02 A.Offline 更新 API（checkForUpdate / onUpdate / applyUpdate / swVersion）+ SW 版本握手
 * - PU-03 模拟新版本 SW 通知：出现更新横幅（立即刷新 / 稍后），「稍后」可关闭
 * - PU-04 独立窗口 + 顶部安全区：shellbar 为深色不透明背景、不被半透明状态栏冲淡，
 *   游戏顶栏文字不被舞台模糊蒙层影响（独立合成层 + 不透明背景）
 * - PU-05 普通标签页模式不受影响：shellbar 保持浅色、38px（Android 空白回归防护）
 *
 * 零 npm 依赖：复用 tools/lib/arcade_cdp.mjs；端口默认 8797 / 9367。
 * 运行：node tools/arcade_pwa_update_test.mjs [--port=8797] [--cdp-port=9367]
 */
import path from 'node:path';
import { REPO_ROOT, createRecorder, envPort, launchChrome, openPage, sleep, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const ARTIFACTS = path.join(REPO_ROOT, 'test-artifacts');
const SERVER_PORT = envPort('ARCADE_PWA_PORT', 8797);
const CDP_PORT = envPort('ARCADE_PWA_CDP', 9367);
const { record, assert, summary } = createRecorder();

const BASE = `http://127.0.0.1:${SERVER_PORT}`;

async function setViewport(cdp, width = 390, height = 844) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
}

async function main() {
  let server = null;
  let launched = null;
  let cdp = null;
  let stub = null;
  try {
    server = await startServer({ root: REPO_ROOT, port: SERVER_PORT });
    launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'arcade-pwa-' });
    cdp = await openPage({ port: CDP_PORT, width: 390, height: 844, deviceScaleFactor: 2, mobile: true, artifactsDir: ARTIFACTS });
    await cdp.send('Network.enable');

    /* ---------- PU-00 iOS 顶缘模糊根因防护：不得声明 cover / black-translucent ---------- */
    await cdp.navigate(BASE + '/apps/arcade/');
    await sleep(250);
    const meta = await cdp.evaluate(`(() => {
      const vp = (document.querySelector('meta[name="viewport"]') || {}).content || '';
      const sb = (document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]') || {}).content || '';
      return { viewport: vp, statusBar: sb };
    })()`);
    assert(meta.viewport.indexOf('viewport-fit') === -1, 'viewport 仍声明 viewport-fit（iOS 顶缘模糊根因）: ' + JSON.stringify(meta));
    assert(meta.statusBar.indexOf('black-translucent') === -1, '仍声明 black-translucent（iOS 顶缘模糊根因）: ' + JSON.stringify(meta));
    record('PU-00 未声明 viewport-fit=cover / black-translucent（iOS 顶部模糊根因防护）', true);

    /* ---------- PU-01/02 中心页更新 UI 与 API ---------- */
    await setViewport(cdp);
    await cdp.navigate(BASE + '/apps/arcade/');
    await sleep(500);
    const ui = await cdp.evaluate(`(() => {
      const check = document.querySelector('[data-update-check]');
      const banner = document.querySelector('[data-update-banner]');
      return {
        hasCheck: !!check,
        checkVisible: !!check && !check.hidden,
        hasBanner: !!banner,
        bannerHidden: !!banner && banner.hidden,
        api: ['checkForUpdate','onUpdate','applyUpdate','swVersion'].filter((k) => typeof (window.Arcade && Arcade.Offline && Arcade.Offline[k]) === 'function'),
        version: window.Arcade && Arcade.version
      };
    })()`);
    assert(ui.version === '0.13.1', 'Arcade version=' + ui.version);
    assert(ui.hasCheck && ui.checkVisible, '检查更新按钮缺失或不可见: ' + JSON.stringify(ui));
    assert(ui.hasBanner && ui.bannerHidden, '更新横幅初始应隐藏: ' + JSON.stringify(ui));
    assert(ui.api.length === 4, 'A.Offline update API 不完整: ' + JSON.stringify(ui.api));
    record('PU-01 中心页检查更新按钮 + 横幅 + 更新 API', true);

    const checked = await cdp.evaluate(`Arcade.Offline.checkForUpdate()`);
    assert(checked && checked.supported === true && checked.checked === true, 'checkForUpdate 结果异常: ' + JSON.stringify(checked));
    const swVersion = await cdp.evaluate(`Arcade.Offline.swVersion()`);
    assert(typeof swVersion === 'string' && swVersion.indexOf('0.13.1') !== -1, 'swVersion 未返回 0.13.1: ' + JSON.stringify(swVersion));
    record('PU-02 checkForUpdate / swVersion 与 SW 版本握手', true);

    /* ---------- PU-03 模拟新版本通知，更新横幅出现且可关闭 ----------
       直接派发 SW → 页面 的 message 事件（与真实 SW 激活后通知一致）。 */
    await cdp.evaluate(`(() => {
      const event = new MessageEvent('message', { data: { type: 'arcade-sw-update-ready', version: '0.13.1' } });
      navigator.serviceWorker.dispatchEvent(event);
    })()`);
    await sleep(200);
    const shown = await cdp.evaluate(`(() => {
      const b = document.querySelector('[data-update-banner]');
      return { hidden: b.hidden, text: document.querySelector('[data-update-text]').textContent };
    })()`);
    assert(shown.hidden === false && shown.text.indexOf('0.13.1') !== -1, '更新横幅未正确显示: ' + JSON.stringify(shown));
    await cdp.click('[data-update-dismiss]');
    await sleep(120);
    const dismissed = await cdp.evaluate(`document.querySelector('[data-update-banner]').hidden`);
    assert(dismissed === true, '稍后按钮未关闭横幅');
    record('PU-03 新版本通知横幅 + 稍后关闭', true);

    /* ---------- PU-04 独立窗口 + 安全区：深色 shellbar 与清晰顶栏 ---------- */
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, left: 0, bottom: 34, right: 0 } });
    stub = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { const real = window.matchMedia.bind(window); window.matchMedia = (q) => q === '(display-mode: standalone)' ? { matches: true, media: q, onchange: null, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}, dispatchEvent(){return false;} } : real(q); })();`,
    });

    await cdp.navigate(BASE + '/apps/arcade/');
    await sleep(400);
    const hubTop = await cdp.evaluate(`(() => {
      const bar = document.querySelector('.studiokit-shellbar');
      const cs = getComputedStyle(bar);
      return {
        standalone: document.documentElement.classList.contains('studiokit-shell-standalone'),
        bg: cs.backgroundColor,
        padTop: parseFloat(cs.paddingTop),
        position: cs.position,
        top: cs.top,
        z: cs.zIndex,
        overlayBg: getComputedStyle(document.documentElement).getPropertyValue('--ac-bg').trim()
      };
    })()`);
    assert(hubTop.standalone, '未应用独立窗口标记');
    assert(hubTop.padTop >= 47, '顶部安全区未让出: ' + JSON.stringify(hubTop));
    assert(hubTop.bg === 'rgb(11, 16, 32)', '独立窗口 shellbar 应为深色主题: ' + JSON.stringify(hubTop));
    assert(hubTop.position === 'sticky' && hubTop.top === '0px' && parseInt(hubTop.z, 10) >= 1,
      '独立窗口 shellbar 必须 sticky 贴顶（iOS 顶缘模糊替换层，真机方案 1/9/10 结论）: ' + JSON.stringify(hubTop));
    const topStrip = await cdp.evaluate(`(() => {
      const cs = getComputedStyle(document.body, '::before');
      return { position: cs.position, top: cs.top, bg: cs.backgroundColor, z: cs.zIndex };
    })()`);
    assert(topStrip.position === 'fixed' && topStrip.top === '0px' && topStrip.bg === 'rgb(11, 16, 32)',
      '顶边 fixed 深色条缺失（iOS 系统模糊替换层）: ' + JSON.stringify(topStrip));
    await cdp.screenshot('pwa-hub-standalone-top.png');
    record('PU-04 独立窗口中心页顶部：深色 shellbar + sticky 贴顶 + 安全区 + fixed 顶边条', true);

    await cdp.navigate(BASE + '/apps/arcade/games/gomoku.html');
    await sleep(300);
    await cdp.click('[data-fullscreen]');
    await sleep(420);
    const gameTop = await cdp.evaluate(`(() => {
      const top = document.querySelector('.game-topbar');
      const cs = getComputedStyle(top);
      const stage = getComputedStyle(document.querySelector('.stage-box'));
      return {
        immersive: document.body.classList.contains('arcade-immersive'),
        bg: cs.backgroundColor,
        position: cs.position,
        zIndex: cs.zIndex,
        isolation: stage.isolation,
        padTop: parseFloat(cs.paddingTop)
      };
    })()`);
    assert(gameTop.immersive, '未进入沉浸模式');
    assert(gameTop.padTop >= 47, '沉浸顶栏未让出顶部安全区: ' + JSON.stringify(gameTop));
    assert(gameTop.bg === 'rgb(5, 7, 15)', '沉浸顶栏应不透明深色: ' + JSON.stringify(gameTop));
    assert(gameTop.position === 'relative' && parseInt(gameTop.zIndex, 10) >= 1, '顶栏未提升为独立层: ' + JSON.stringify(gameTop));
    assert(gameTop.isolation === 'isolate', '舞台未隔离 backdrop-filter: ' + JSON.stringify(gameTop));
    await cdp.screenshot('pwa-gomoku-standalone-top.png');
    record('PU-04 独立窗口游戏顶栏：不透明 + 独立合成层 + 舞台隔离', true);

    /* ---------- PU-05 普通标签页不受影响 ---------- */
    if (stub) {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stub.identifier });
      stub = null;
    }
    await cdp.navigate(BASE + '/apps/arcade/games/gomoku.html');
    await sleep(300);
    const browserBar = await cdp.evaluate(`(() => {
      const bar = document.querySelector('.studiokit-shellbar');
      const cs = getComputedStyle(bar);
      return { standalone: document.documentElement.classList.contains('studiokit-shell-standalone'), bg: cs.backgroundColor, padTop: parseFloat(cs.paddingTop), h: Math.round(bar.getBoundingClientRect().height) };
    })()`);
    assert(!browserBar.standalone, '浏览器模式泄漏 standalone: ' + JSON.stringify(browserBar));
    assert(browserBar.padTop === 0 && Math.abs(browserBar.h - 38) <= 1, '普通标签页 shellbar 应保持 38px: ' + JSON.stringify(browserBar));
    record('PU-05 普通标签页 shellbar 浅色 38px 不受影响', true);
  } finally {
    if (stub && cdp) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stub.identifier }).catch(() => {});
    if (cdp) cdp.close();
    if (server) server.close();
    await stopChrome(launched || {});
  }
  const outcome = summary();
  if (outcome.failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('PWA UPDATE TEST FAILED:', err.stack || err);
  process.exitCode = 1;
});
