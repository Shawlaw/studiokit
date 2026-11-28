#!/usr/bin/env node
/**
 * Arcade 0.24.0 门禁：PWA 更新检测（最新版本号 / SW 主动广播）+ iPhone 独立窗口顶部安全区布局。
 *
 * 覆盖：
 * - PU-00 未声明 viewport-fit=cover / black-translucent（iOS 顶缘模糊根因防护）
 * - PU-01 中心页「检查更新」按钮 + 更新横幅 + 更新 API 齐全
 * - PU-02 版本一致时 checkForUpdate() 返回「已是最新」且版本号 = 线上版本（不是已安装版本）
 * - PU-03 模拟新版本 SW 通知：横幅显示「新版本 + 当前版本」，可「稍后」关闭
 * - PU-04 独立窗口 + 顶部安全区：深色不透明 shellbar 贴顶，游戏顶栏独立合成层
 * - PU-05 普通标签页无安全区空白，游戏返回键 ≥44px
 * - PU-06 真实发布新版本的完整链路（临时副本服务器，改 sw.js VERSION 模拟发版）：
 *   检查更新返回最新版本 0.24.1（不是已安装的 0.24.0）→ 新 SW 主动广播
 *   arcade-sw-update-ready(0.24.1) → 横幅文案含两个版本 → 新 SW 接管后页面未刷新时
 *   仍判为「有更新」→ 按钮提示含新版本号。
 * - PU-07 线上版本读取失败时不谎报「已是最新」：按钮提示「检查更新失败」。
 * - PU-08 新 SW 已由其他页面激活后，再次打开旧首页无需点击即显示更新横幅。
 *
 * 零 npm 依赖：复用 tools/lib/arcade_cdp.mjs；端口默认 8797 / 9367（临时副本服务器 8798）。
 * 运行：node tools/arcade_pwa_update_test.mjs [--port=8797] [--cdp-port=9367]
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { REPO_ROOT, createRecorder, envPort, launchChrome, openPage, sleep, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const ARTIFACTS = path.join(REPO_ROOT, 'test-artifacts');
const SERVER_PORT = envPort('ARCADE_PWA_PORT', 8797);
const TEMP_PORT = envPort('ARCADE_PWA_TEMP_PORT', SERVER_PORT + 1);
const CDP_PORT = envPort('ARCADE_PWA_CDP', 9367);
const { record, assert, summary } = createRecorder();

const BASE = `http://127.0.0.1:${SERVER_PORT}`;
const TEMP_BASE = `http://127.0.0.1:${TEMP_PORT}`;

async function setViewport(cdp, width = 390, height = 844) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
}

/* 复制 Center 页运行所需的最小站点到临时目录，用于安全地「发一个新版本」。 */
function makeTempSite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studiokit-pwa-'));
  fs.cpSync(path.join(REPO_ROOT, 'apps'), path.join(root, 'apps'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'shared'), path.join(root, 'shared'), { recursive: true });
  return root;
}

/* 改写临时副本里的 SW 版本，等价于「线上发布了一个新版本」。 */
function publishTempVersion(root, from, to) {
  const swPath = path.join(root, 'apps/arcade/sw.js');
  const source = fs.readFileSync(swPath, 'utf8');
  const next = source.replace(`const VERSION = '${from}'`, `const VERSION = '${to}'`);
  assert(next !== source, '临时 SW 版本改写失败，找不到 ' + from);
  fs.writeFileSync(swPath, next);
}

async function main() {
  let server = null;
  let tempServer = null;
  let tempRoot = null;
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

    /* ---------- PU-01/02 中心页更新 UI 与 API + 版本一致时的检查结果 ---------- */
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
    assert(ui.version === '0.24.0', 'Arcade version=' + ui.version);
    assert(ui.hasCheck && ui.checkVisible, '检查更新按钮缺失或不可见: ' + JSON.stringify(ui));
    assert(ui.hasBanner && ui.bannerHidden, '更新横幅初始应隐藏: ' + JSON.stringify(ui));
    assert(ui.api.length === 4, 'A.Offline update API 不完整: ' + JSON.stringify(ui.api));
    record('PU-01 中心页检查更新按钮 + 横幅 + 更新 API', true);

    await cdp.waitFor('!!navigator.serviceWorker.controller', { timeout: 15000 });
    const inSync = await cdp.evaluate(`Arcade.Offline.checkForUpdate()`);
    assert(inSync && inSync.supported === true && inSync.checked === true, 'checkForUpdate 结果异常: ' + JSON.stringify(inSync));
    // 核心回归：版本一致时返回「线上版本」，不是页面已安装版本以外的乱值；且不得报有更新。
    assert(inSync.updateFound === false, '版本一致却报有更新: ' + JSON.stringify(inSync));
    assert(inSync.version === '0.24.0', 'checkForUpdate.version 应为线上版本 0.24.0: ' + JSON.stringify(inSync));
    assert(inSync.latestVersion === '0.24.0', 'latestVersion 应为 0.24.0: ' + JSON.stringify(inSync));
    assert(inSync.pageVersion === '0.24.0', 'pageVersion 应为 0.24.0: ' + JSON.stringify(inSync));
    const swVersion = await cdp.evaluate(`Arcade.Offline.swVersion()`);
    assert(typeof swVersion === 'string' && swVersion.indexOf('0.24.0') !== -1, 'swVersion 未返回 0.24.0: ' + JSON.stringify(swVersion));
    record('PU-02 checkForUpdate 返回线上版本、版本一致时不误报更新 + SW 版本握手', true);

    /* ---------- PU-03 模拟新版本通知，更新横幅出现且可关闭 ----------
       直接派发 SW → 页面 的 message 事件（与真实 SW 激活后通知一致）。 */
    await cdp.evaluate(`(() => {
      const event = new MessageEvent('message', { data: { type: 'arcade-sw-update-ready', version: '0.24.1' } });
      navigator.serviceWorker.dispatchEvent(event);
    })()`);
    await sleep(200);
    const shown = await cdp.evaluate(`(() => {
      const b = document.querySelector('[data-update-banner]');
      return { hidden: b.hidden, text: document.querySelector('[data-update-text]').textContent };
    })()`);
    assert(shown.hidden === false, '更新横幅未正确显示: ' + JSON.stringify(shown));
    assert(shown.text.indexOf('0.24.1') !== -1 && shown.text.indexOf('当前 v0.24.0') !== -1,
      '横幅应同时显示新版本与当前版本: ' + JSON.stringify(shown));
    await cdp.click('[data-update-dismiss]');
    await sleep(120);
    const dismissed = await cdp.evaluate(`document.querySelector('[data-update-banner]').hidden`);
    assert(dismissed === true, '稍后按钮未关闭横幅');
    record('PU-03 新版本通知横幅显示新版本 + 当前版本，稍后可关闭', true);

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

    /* ---------- PU-05 普通标签页无需顶部安全区 ---------- */
    if (stub) {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stub.identifier });
      stub = null;
    }
    await cdp.navigate(BASE + '/apps/arcade/games/gomoku.html');
    await sleep(300);
    const browserBar = await cdp.evaluate(`(() => {
      const bar = document.querySelector('.studiokit-shellbar');
      const cs = getComputedStyle(bar);
      const back = bar.querySelector('.studiokit-shell-home');
      const rect = back.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.bottom - 2);
      return { standalone: document.documentElement.classList.contains('studiokit-shell-standalone'), padTop: parseFloat(cs.paddingTop), h: Math.round(bar.getBoundingClientRect().height), backH: rect.height, hittable: back.contains(hit) };
    })()`);
    assert(!browserBar.standalone, '浏览器模式泄漏 standalone: ' + JSON.stringify(browserBar));
    assert(browserBar.padTop === 0 && browserBar.backH >= 44 && browserBar.h === 38 && browserBar.hittable, '游戏导航应提供可点的 44px 返回目标且保留 38px 导航高度: ' + JSON.stringify(browserBar));
    await cdp.navigate(BASE + '/apps/arcade/');
    const hallBarHeight = await cdp.evaluate(`document.querySelector('.studiokit-shellbar').getBoundingClientRect().height`);
    assert(Math.abs(hallBarHeight - 38) <= 1, '中心页 shellbar 应保持 38px: ' + hallBarHeight);
    record('PU-05 普通标签页游戏返回目标 44px，中心页导航 38px', true);

    /* ---------- PU-06 真实发布新版本的完整链路（临时副本，改 sw.js VERSION） ---------- */
    tempRoot = makeTempSite();
    tempServer = await startServer({ root: tempRoot, port: TEMP_PORT });
    await cdp.navigate(TEMP_BASE + '/apps/arcade/');
    await cdp.waitFor('!!(window.Arcade && Arcade.Offline && navigator.serviceWorker.controller)', { timeout: 20000 });
    await sleep(300);
    const before = await cdp.evaluate(`Arcade.Offline.checkForUpdate()`);
    assert(before.updateFound === false && before.version === '0.24.0', '副本站点初始版本应为 0.24.0 且无更新: ' + JSON.stringify(before));

    // 收集 SW → 页面消息与 controllerchange；再模拟「线上发布 0.24.1」。
    await cdp.evaluate(`(() => {
      window.__swMsgs = [];
      window.__swChanges = 0;
      navigator.serviceWorker.addEventListener('message', (e) => window.__swMsgs.push(e.data));
      navigator.serviceWorker.addEventListener('controllerchange', () => { window.__swChanges += 1; });
      return true;
    })()`);
    publishTempVersion(tempRoot, '0.24.0', '0.24.1');

    const after = await cdp.evaluate(`Arcade.Offline.checkForUpdate()`);
    assert(after.supported === true && after.checked === true, '新版本检查失败: ' + JSON.stringify(after));
    assert(after.updateFound === true, '发布 0.24.1 后未判为有更新: ' + JSON.stringify(after));
    // 核心回归：必须返回线上最新版本，不能是页面已安装的 0.24.0。
    assert(after.version === '0.24.1', 'checkForUpdate.version 应为新版本 0.24.1: ' + JSON.stringify(after));
    assert(after.latestVersion === '0.24.1', 'latestVersion 应为 0.24.1: ' + JSON.stringify(after));
    assert(after.installedVersion === '0.24.0', 'installedVersion 应为 0.24.0: ' + JSON.stringify(after));
    assert(after.pageVersion === '0.24.0', 'pageVersion 应为 0.24.0: ' + JSON.stringify(after));
    assert(after.updateReason === 'published', 'updateReason 应为 published: ' + JSON.stringify(after));

    // SW 激活后必须主动广播新版本（0.13.1 及以前的 firstActivation 判断永不触发）。
    await cdp.waitFor(`window.__swMsgs.some((m) => m && m.type === 'arcade-sw-update-ready' && m.version === '0.24.1')`, { timeout: 15000 });
    const broadcast = await cdp.evaluate(`window.__swMsgs.filter((m) => m && m.type === 'arcade-sw-update-ready').map((m) => m.version)`);
    assert(broadcast.indexOf('0.24.1') !== -1, 'SW 未广播新版本: ' + JSON.stringify(broadcast));
    assert(await cdp.evaluate('window.__swChanges') >= 1, '新 SW 未接管页面（controllerchange 未触发）');

    const banner = await cdp.evaluate(`(() => {
      const b = document.querySelector('[data-update-banner]');
      return { hidden: b.hidden, text: document.querySelector('[data-update-text]').textContent };
    })()`);
    assert(banner.hidden === false && banner.text.indexOf('0.24.1') !== -1 && banner.text.indexOf('当前 v0.24.0') !== -1,
      '更新横幅应显示最新版本与当前版本: ' + JSON.stringify(banner));

    const newSwVersion = await cdp.evaluate(`Arcade.Offline.swVersion()`);
    assert(newSwVersion === '0.24.1', '新 SW 接管后 swVersion 应为 0.24.1: ' + JSON.stringify(newSwVersion));

    // 新 SW 已接管但页面仍是 0.24.0：仍应提示「有更新（刷新页面）」而不是「已是最新」。
    const stalePage = await cdp.evaluate(`Arcade.Offline.checkForUpdate()`);
    assert(stalePage.updateFound === true && stalePage.version === '0.24.1',
      '新 SW 接管后页面未刷新时仍应提示 0.24.1 可用: ' + JSON.stringify(stalePage));

    // 按钮路径的提示文案必须带新版本号与当前版本。
    await cdp.click('.hall-app > summary');
    await cdp.click('[data-update-check]');
    await cdp.waitFor(`(() => { const t = document.querySelector('.ac-toast'); return !!t && t.textContent.indexOf('0.24.1') !== -1; })()`, { timeout: 15000 });
    const toast = await cdp.evaluate(`document.querySelector('.ac-toast').textContent`);
    assert(toast.indexOf('发现新版本 v0.24.1') !== -1 && toast.indexOf('当前 v0.24.0') !== -1,
      '检查更新按钮提示应显示新版本与当前版本: ' + JSON.stringify(toast));
    record('PU-06 真实发版链路：返回线上最新版本 + SW 主动广播 + 横幅/提示双版本 + 刷新前后均判有更新', true);

    /* ---------- PU-08 新 SW 已激活，旧首页重新打开也必须自动提示 ----------
       不调用 checkForUpdate、不点击按钮：仅重新打开首页。旧实现只依赖
       updatefound/controllerchange，此时新 SW 早已激活，旧页面不会收到事件。 */
    await cdp.navigate(TEMP_BASE + '/apps/arcade/');
    await cdp.waitFor('!!(window.Arcade && Arcade.Offline && navigator.serviceWorker.controller)', { timeout: 20000 });
    await cdp.waitFor(`(() => {
      const banner = document.querySelector('[data-update-banner]');
      return !!banner && !banner.hidden && document.querySelector('[data-update-text]').textContent.indexOf('0.24.1') !== -1;
    })()`, { timeout: 15000 });
    const automatic = await cdp.evaluate(`(() => {
      const text = document.querySelector('[data-update-text]').textContent;
      const sw = document.querySelector('[data-hall-version]').textContent;
      return { text, sw };
    })()`);
    assert(automatic.text.indexOf('当前 v0.24.0') !== -1, '自动横幅缺少当前版本: ' + JSON.stringify(automatic));
    record('PU-08 再次打开旧首页自动显示更新横幅，无需手动检查', true);

    /* ---------- PU-07 线上版本读取失败：不得谎报「已是最新」 ----------
       回到与 SW 完全同步的主站点（0.13.2），只拦截页面读取 sw.js 的请求，
       模拟「读不到线上版本」：应报 checked=false（按钮提示失败），而不是「已是最新」。 */
    await cdp.navigate(BASE + '/apps/arcade/');
    await cdp.waitFor('!!(window.Arcade && Arcade.Offline && navigator.serviceWorker.controller)', { timeout: 20000 });
    const inSyncAgain = await cdp.evaluate(`Arcade.Offline.checkForUpdate()`);
    assert(inSyncAgain.checked === true && inSyncAgain.updateFound === false, '主站点应已同步: ' + JSON.stringify(inSyncAgain));
    await cdp.evaluate(`(() => {
      window.__realFetch = window.fetch.bind(window);
      window.fetch = (input, init) => String(input && input.url ? input.url : input).indexOf('sw.js') !== -1
        ? Promise.reject(new TypeError('simulated offline'))
        : window.__realFetch(input, init);
      return true;
    })()`);
    const failed = await cdp.evaluate(`Arcade.Offline.checkForUpdate()`);
    assert(failed.checked === false, '线上版本读取失败时 checked 应为 false: ' + JSON.stringify(failed));
    assert(failed.updateFound === false, '读取失败时不应凭空报有更新: ' + JSON.stringify(failed));
    await cdp.evaluate(`(() => { document.querySelectorAll('.ac-toast').forEach((n) => n.remove()); return true; })()`);
    await cdp.click('.hall-app > summary');
    await cdp.click('[data-update-check]');
    await cdp.waitFor(`(() => { const t = document.querySelector('.ac-toast'); return !!t && t.textContent.indexOf('检查更新失败') !== -1; })()`, { timeout: 15000 });
    await cdp.evaluate(`(() => { window.fetch = window.__realFetch; return true; })()`);
    record('PU-07 线上版本读取失败时提示「检查更新失败」，不谎报「已是最新版本」', true);
  } finally {
    if (stub && cdp) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stub.identifier }).catch(() => {});
    if (cdp) cdp.close();
    if (tempServer) tempServer.close();
    if (server) server.close();
    await stopChrome(launched || {});
    if (tempRoot) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch (err) {
        /* 临时目录清理失败不影响结果 */
      }
    }
  }
  const outcome = summary();
  if (outcome.failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('PWA UPDATE TEST FAILED:', err.stack || err);
  process.exitCode = 1;
});
