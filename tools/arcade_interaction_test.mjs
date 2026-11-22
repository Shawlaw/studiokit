#!/usr/bin/env node
/**
 * Arcade 0.12.6 门禁：移动端误触放大防护 + 五子棋落子按钮重影 / 预览取消出口。
 *
 * 覆盖：
 * - IX-01 17 个 Arcade 页面（中心页 + 16 游戏）viewport 均含 maximum-scale=1/user-scalable=no，
 *   且不含 viewport-fit=cover（0.11.3 顶缘模糊根因防护）；
 * - IX-02 游戏页 dblclick 默认行为被引擎拦截（installSfxUnlock 全局兜底）；
 * - IX-03 五子棋落子按钮 DOM 命中层为透明（无自身文字/边框/底色），与画布按钮不产生双份文字；
 * - IX-04 五子棋「取消 / 落子」两枚按钮：预览中可用、尺寸 ≥44px、全屏下依然单份文字与正确布局；
 * - IX-05 五子棋预览取消出口：点「取消」只清预览，不动棋盘/回合；点「落子」仍能正常确认落子；
 * - IX-06 320/375/390/430 四档 + 全屏（沉浸）布局：0 溢出、命中区 ≥44px、不重叠。
 *
 * 零 npm 依赖：复用 tools/lib/arcade_cdp.mjs；端口默认 8799 / 9369。
 * 运行：node tools/arcade_interaction_test.mjs [--port=8799] [--cdp-port=9369]
 */
import path from 'node:path';
import { REPO_ROOT, createRecorder, envPort, launchChrome, openPage, sleep, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const ARTIFACTS = path.join(REPO_ROOT, 'test-artifacts');
const SERVER_PORT = envPort('ARCADE_INTERACTION_PORT', 8799);
const CDP_PORT = envPort('ARCADE_INTERACTION_CDP', 9369);
const { record, assert, summary } = createRecorder();
const BASE = `http://127.0.0.1:${SERVER_PORT}`;

const VIEWPORTS = [[320, 568], [375, 667], [390, 844], [430, 932]];

async function setViewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
}

function viewportMetaCheck(html) {
  const m = /<meta\s+name="viewport"\s+content="([^"]+)"/i.exec(html);
  if (!m) return { ok: false, reason: 'missing viewport meta' };
  const c = m[1];
  return {
    ok: c.includes('maximum-scale=1') && c.includes('user-scalable=no') && !c.includes('viewport-fit'),
    content: c,
  };
}

async function main() {
  let server = null;
  let launched = null;
  let cdp = null;
  try {
    server = await startServer({ root: REPO_ROOT, port: SERVER_PORT });
    launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'arcade-interaction-' });
    cdp = await openPage({ port: CDP_PORT, width: 390, height: 844, deviceScaleFactor: 2, mobile: true, artifactsDir: ARTIFACTS });

    /* ---------- IX-01 静态：17 页 viewport 防护 ---------- */
    const { readFileSync, readdirSync } = await import('node:fs');
    const gamesDir = path.join(REPO_ROOT, 'apps', 'arcade', 'games');
    const htmlFiles = [path.join(REPO_ROOT, 'apps', 'arcade', 'index.html')]
      .concat(readdirSync(gamesDir).filter((f) => f.endsWith('.html')).map((f) => path.join(gamesDir, f)));
    assert(htmlFiles.length === 17, '期望 17 个 Arcade 页面，实际 ' + htmlFiles.length);
    let checked = 0;
    for (const file of htmlFiles) {
      const res = viewportMetaCheck(readFileSync(file, 'utf8'));
      assert(res.ok, path.basename(file) + ' viewport 误触放大防护缺失: ' + res.content + ' (' + res.reason + ')');
      checked += 1;
    }
    record('IX-01 17 页 viewport 含 maximum-scale=1/user-scalable=no 且无 viewport-fit', true);

    /* ---------- 进入五子棋 ---------- */
    await setViewport(cdp, 390, 844);
    await cdp.navigate(BASE + '/apps/arcade/games/gomoku.html?ix=' + Date.now() + '#test');
    await sleep(400);
    const ready = await cdp.evaluate(`({ hooks: !!(window.__arcadeTest && typeof window.__arcadeTest.actionButtons === 'function'), version: Arcade.version })`);
    assert(ready.hooks, '五子棋缺少 0.12.6 actionButtons 钩子');
    assert(ready.version === '0.12.6', 'Arcade version=' + ready.version);

    await cdp.click('[data-ov-btn]');
    await sleep(150);

    /* ---------- IX-02 dblclick 默认行为被拦 ---------- */
    const dbl = await cdp.evaluate(`(() => {
      let prevented = false;
      const handler = (e) => { if (e.defaultPrevented) prevented = true; };
      document.addEventListener('dblclick', handler, { once: true });
      document.querySelector('.game-canvas').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      return { prevented };
    })()`);
    assert(dbl.prevented, 'dblclick 默认行为未被拦截（双击放大防护失效）');
    record('IX-02 游戏页 dblclick 默认行为被拦截', true);

    /* ---------- IX-03 透明命中层，无双份文字 ---------- */
    await cdp.tap(222, 376); // 预览 F6
    await sleep(120);
    const noPreview = await cdp.evaluate(`window.__arcadeTest.info().preview`);
    assert(noPreview && noPreview.r === 5 && noPreview.c === 5, '未进入预览: ' + JSON.stringify(noPreview));
    const ab = await cdp.evaluate(`window.__arcadeTest.actionButtons()`);
    assert(ab.cancel.text === '' && ab.place.text === '', 'DOM 命中层不应有自身文字（重影根因）: ' + JSON.stringify(ab));
    const styles = await cdp.evaluate(`(() => {
      const g = (s) => { const el = document.querySelector(s); const cs = getComputedStyle(el); return { bg: cs.backgroundColor, border: cs.borderStyle, color: cs.color, text: el.textContent }; };
      return { cancel: g('[data-cancel-preview]'), place: g('[data-place-confirm]') };
    })()`);
    assert(styles.cancel.bg === 'rgba(0, 0, 0, 0)' && styles.place.bg === 'rgba(0, 0, 0, 0)', '命中层背景应透明: ' + JSON.stringify(styles));
    record('IX-03 落子/取消命中层透明无文字（画布为唯一文字源）', true);

    /* ---------- IX-04/06 四档 + 全屏布局 ---------- */
    for (const [w, h] of VIEWPORTS) {
      await setViewport(cdp, w, h);
      await sleep(140);
      const m = await cdp.evaluate(`(() => {
        const btns = window.__arcadeTest.actionButtons();
        return {
          sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
          docH: document.documentElement.scrollHeight, vh: innerHeight,
          cancel: btns.cancel, place: btns.place,
        };
      })()`);
      assert(m.sw <= m.cw + 1, w + 'px 横向溢出');
      assert(m.docH <= m.vh + 1, w + 'px 纵向溢出 ' + m.docH + '>' + m.vh);
      assert(m.cancel.w >= 44 && m.cancel.h >= 44 && m.place.w >= 44 && m.place.h >= 44,
        w + 'px 命中区不足 44px: ' + JSON.stringify({ cancel: m.cancel, place: m.place }));
      assert(m.place.x >= m.cancel.x + m.cancel.w - 1, w + 'px 两按钮重叠');
    }
    await setViewport(cdp, 390, 844);
    await sleep(140);
    await cdp.evaluate(`(() => { document.documentElement.classList.add('arcade-immersive'); document.body.classList.add('arcade-immersive'); })()`);
    await sleep(200);
    const full = await cdp.evaluate(`(() => {
      const btns = window.__arcadeTest.actionButtons();
      return { btns, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, docH: document.documentElement.scrollHeight, vh: innerHeight };
    })()`);
    assert(full.sw <= full.cw + 1 && full.docH <= full.vh + 1, '全屏溢出');
    assert(full.btns.cancel.w >= 44 && full.btns.place.w >= 44 && full.btns.cancel.text === '' && full.btns.place.text === '', '全屏命中区/文字异常: ' + JSON.stringify(full.btns));
    assert(full.btns.place.x >= full.btns.cancel.x + full.btns.cancel.w - 1, '全屏两按钮重叠');
    record('IX-04/06 320/375/390/430 + 全屏：≥44px、不重叠、0 溢出、无双份文字', true);
    await cdp.screenshot('interaction-gomoku-fullscreen');

    /* ---------- IX-05 取消出口与落子确认 ---------- */
    await cdp.evaluate(`document.querySelector('[data-cancel-preview]').click()`);
    await sleep(120);
    const afterCancel = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(afterCancel.preview === null && afterCancel.moves === 0 && afterCancel.turnName === 'black', '取消未只清预览: ' + JSON.stringify(afterCancel));
    await cdp.tap(222, 376);
    await sleep(120);
    await cdp.evaluate(`(() => { window.__arcadeTest.info(); document.querySelector('[data-place-confirm]').click(); })()`);
    await sleep(120);
    const afterPlace = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(afterPlace.moves === 1 && afterPlace.preview === null, '点「落子」未确认落子: ' + JSON.stringify(afterPlace));
    const st = await cdp.evaluate(`window.__arcadeTest.selftest()`);
    assert(st && st.fail === 0 && st.pass >= 18, '五子棋自检回归 ' + JSON.stringify(st && st.details.filter((d) => !d.ok)));
    record('IX-05 取消只清预览，落子仍可确认；selftest ' + st.pass + '/' + (st.pass + st.fail), true);

    assert(cdp.errors.length === 0, 'console error: ' + cdp.errors.slice(0, 3).join(' | '));
  } finally {
    if (cdp) cdp.close();
    if (server) await new Promise((r) => server.close(r));
    if (launched) await stopChrome(launched);
  }
  const outcome = summary('Arcade 0.12.6 交互门禁');
  if (outcome.failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('INTERACTION TEST FAILED:', err.stack || err);
  process.exitCode = 1;
});
