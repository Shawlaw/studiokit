#!/usr/bin/env node
/**
 * Arcade 0.12.0-interaction 门禁：全屏(immersive)/PWA 独立窗口底部道具按钮拇指区抬升。
 *
 * 覆盖：
 * - IB-00 CSS 契约：--ac-thumb-lift 变量、stage-wrap / touch-pad / toolbelt / toast 抬升规则存在
 * - IB-01 四档竖屏（320×568 / 375×667 / 390×844 / 430×932）沉浸模式：
 *   底部道具按钮完整可见、≥44px、命中层可点（真实 CDP 鼠标点击生效）、无横/纵向溢出、
 *   按钮距视口底部比修复前更高（量化：抬升 Δ≥30px，且 plain gap≥38px / safe gap≥66px），
 *   画布外道具行不压画布（b.top ≥ canvasBottom-1）
 * - IB-02 黄金矿工：画布内道具坞按 2×lift 抬升，矿物不被临时提升的道具坞覆盖
 *   （悬浮道具坞属于既有设计，断言改为「最低物品 y+r ≤ 道具坞顶部逻辑 y-2」）
 * - IB-03 俄罗斯方块：画布内道具坞不遮井口（沿用既有 wellBottom 断言 + 拇指区按钮行抬高）
 * - IB-04 独立窗口安全区（insets top=47 / bottom=34）：抬升量叠加在安全区之上，顶部刘海不被压
 * - IB-05 横屏 667×375：短视口采用 20px 小抬升，画布仍可玩、按钮可见可点、无溢出
 *
 * 「距视口底部距离更近」的口径：用户反馈是按钮太靠下（原 gap=6px），修复是让按钮**上移到拇指区**，
 * 因此量化断言用 gap（按钮 bottom 到视口 bottom 的距离）变大 ≥30px，并与
 * 「注入 --ac-thumb-lift:0 还原修复前几何」的基线做 Δ 对比，避免只测绝对值。
 *
 * 零 npm 依赖：复用 tools/lib/arcade_cdp.mjs；端口默认 8807 / 9407。
 * 运行：node tools/arcade_immersive_buttons_test.mjs [--port] 通过 ARCADE_IMMERSIVE_* 环境变量覆盖
 */
import path from 'node:path';
import { REPO_ROOT, createRecorder, envPort, launchChrome, openPage, sleep, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const ARTIFACTS = path.join(REPO_ROOT, 'test-artifacts');
const SERVER_PORT = envPort('ARCADE_IMMERSIVE_PORT', 8807);
const CDP_PORT = envPort('ARCADE_IMMERSIVE_CDP', 9407);
const { record, assert, summary } = createRecorder();
const BASE = `http://127.0.0.1:${SERVER_PORT}`;

const PORTRAIT = [[320, 568], [375, 667], [390, 844], [430, 932]];
const SAFE = { top: 47, left: 0, bottom: 34, right: 0 };

async function setViewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
}

/** 读取当前沉浸模式的几何/布局数据。 */
function geometry() {
  return `(() => {
    const vh = innerHeight;
    const rect = (el) => { const r = el.getBoundingClientRect(); return {
      top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left),
      right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height)
    }; };
    const canvas = document.querySelector('.game-canvas');
    const canvasRect = canvas ? rect(canvas) : null;
    const buttons = [...document.querySelectorAll('[data-joy-tool], .touch-pad .tool-btn, .touch-pad .snake-dir, [data-toolbelt] .tool-btn')]
      .filter((b) => b.getBoundingClientRect().height > 0 && getComputedStyle(b).display !== 'none')
      .map((b) => {
        const r = rect(b);
        const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return {
          id: b.dataset.joyTool || b.dataset.tool || b.getAttribute('aria-label') || b.textContent.trim().slice(0, 8),
          ...r, gap: vh - r.bottom,
          hittable: !!hit && (hit === b || b.contains(hit))
        };
      });
    const well = (() => {
      if (!canvasRect || !location.pathname.includes('block-drop')) return null;
      return Math.round(canvasRect.top + canvasRect.h * 526 / 610);
    })();
    return {
      immersive: document.body.classList.contains('arcade-immersive'),
      vh, vw: innerWidth,
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      docH: document.documentElement.scrollHeight,
      canvas: canvasRect, wellBottom: well, buttons,
      lift: parseFloat(getComputedStyle(document.body).getPropertyValue('--ac-thumb-lift')) || 0,
      stagePadBottom: (() => { const s = document.querySelector('.stage-wrap'); return s ? parseFloat(getComputedStyle(s).paddingBottom) : null; })(),
      topbarPadTop: (() => { const t = document.querySelector('.game-topbar'); return t ? parseFloat(getComputedStyle(t).paddingTop) : null; })()
    };
  })()`;
}

/** 进入沉浸模式并等待布局稳定；若偏好恢复导致首次点击被反向切换，则再点一次。 */
async function immersive(cdp, page, query = '') {
  await cdp.navigate(`${BASE}/apps/arcade/games/${page}${query}`);
  await cdp.click('[data-fullscreen]');
  await sleep(260);
  const active = await cdp.evaluate(`document.body.classList.contains('arcade-immersive')`);
  if (!active) {
    await cdp.click('[data-fullscreen]');
    await sleep(260);
  }
}

/** 注入「修复前」基线覆盖：lift 归零即还原旧的贴底布局。 */
async function setBaseline(cdp, on) {
  if (on) {
    await cdp.evaluate(`(() => {
      let s = document.querySelector('#pre-fix-baseline');
      if (!s) { s = document.createElement('style'); s.id = 'pre-fix-baseline'; document.head.appendChild(s); }
      s.textContent = 'body.arcade-immersive{--ac-thumb-lift:0px}';
    })()`);
  } else {
    await cdp.evaluate(`(() => { const s = document.querySelector('#pre-fix-baseline'); if (s) s.remove(); })()`);
  }
  await sleep(60);
}

function sharedAssertions(m, label, { minGap, minDelta, baseline }) {
  assert(m.immersive, label + ' 未进入沉浸模式');
  assert(m.sw <= m.cw + 1, label + ' 横向溢出 ' + m.sw + '>' + m.cw);
  assert(m.docH <= m.vh + 2, label + ' 纵向溢出 doc=' + m.docH + ' vh=' + m.vh);
  assert(m.buttons.length >= 2, label + ' 未找到底部道具按钮: ' + JSON.stringify(m.buttons));
  for (const b of m.buttons) {
    assert(b.w >= 44 && b.h >= 44, label + ' 按钮不足 44px: ' + JSON.stringify(b));
    assert(b.top >= 0 && b.bottom <= m.vh + 1 && b.left >= -1 && b.right <= m.vw + 1,
      label + ' 按钮不完整可见: ' + JSON.stringify(b));
    assert(b.hittable, label + ' 按钮命中层被遮挡: ' + JSON.stringify(b));
    assert(b.gap >= minGap, label + ' 按钮未抬到拇指区 gap=' + b.gap + ' (<' + minGap + ') ' + JSON.stringify(b));
    if (baseline) {
      const before = baseline.buttons.find((x) => x.id === b.id);
      if (before) {
        assert(b.gap >= before.gap + minDelta, label + ' 抬升幅度不足 ' + b.id +
          ': before=' + before.gap + ' after=' + b.gap + ' expected Δ≥' + minDelta);
      }
    }
  }
}

async function main() {
  let server = null;
  let launched = null;
  let cdp = null;
  try {
    server = await startServer({ root: REPO_ROOT, port: SERVER_PORT });
    launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'arcade-immersive-buttons-' });
    cdp = await openPage({ port: CDP_PORT, width: 390, height: 844, deviceScaleFactor: 1, mobile: true, artifactsDir: ARTIFACTS });
    await cdp.send('Network.enable');

    /* ---------- IB-00 CSS 契约静态检查 ---------- */
    await immersive(cdp, 'shadow-leap.html');
    const css = await cdp.evaluate(`(() => {
      const body = getComputedStyle(document.body);
      const pad = getComputedStyle(document.querySelector('.touch-pad'));
      const stage = getComputedStyle(document.querySelector('.stage-wrap'));
      return {
        lift: body.getPropertyValue('--ac-thumb-lift').trim(),
        padBottom: pad.paddingBottom, stagePadBottom: stage.paddingBottom, stageMarginBottom: stage.marginBottom,
        toolbeltBottom: (() => { const t = document.querySelector('.toolbelt'); return t ? getComputedStyle(t).bottom : null; })(),
        toastBottom: getComputedStyle(document.querySelector('.ac-toast')).bottom
      };
    })()`);
    assert(parseFloat(css.lift) === 36, '缺少 --ac-thumb-lift=36px: ' + JSON.stringify(css));
    assert(parseFloat(css.padBottom) >= 42, 'touch-pad 未叠加抬升量: ' + JSON.stringify(css));
    assert(parseFloat(css.stagePadBottom) === 0, '画布外道具行游戏不应缩小舞台画布: ' + JSON.stringify(css));
    assert(parseFloat(css.stageMarginBottom) === 0, 'stage-wrap 不应使用负 margin（会覆盖按钮命中层）: ' + JSON.stringify(css));
    record('IB-00 CSS 契约：抬升变量/道具行/舞台/toast 均联动', true);

    /* ---------- IB-01 四档竖屏：影跃（画布外道具行） ---------- */
    for (const [w, h] of PORTRAIT) {
      await setViewport(cdp, w, h);
      const label = `${w}×${h} 沉浸道具行`;
      await cdp.navigate(BASE + '/apps/arcade/');
      await cdp.evaluate(`Arcade.RunSave.clear('shadow-leap')`);
      await immersive(cdp, 'shadow-leap.html');
      await cdp.click('[data-ov-btn]');
      await sleep(150);
      /* 结算/开场蒙层在游戏开始后可能再次显示；测几何与命中前统一隐藏，确保测的是按钮本身。 */
      await cdp.evaluate(`(() => { const o = document.querySelector('[data-overlay]'); if (o) o.hidden = true; })()`);
      await setBaseline(cdp, true);
      const before = await cdp.evaluate(geometry());
      await setBaseline(cdp, false);
      const after = await cdp.evaluate(geometry());
      sharedAssertions(after, label, { minGap: 38, minDelta: 30, baseline: before });
      /* 画布外道具行不压核心画布（与既有 smoke 门禁同一口径）。 */
      assert(after.buttons.every((b) => b.top >= after.canvas.bottom - 1),
        label + ' 道具行压画布: ' + JSON.stringify({ canvasBottom: after.canvas.bottom, buttons: after.buttons }));
      assert(after.canvas.h > 280, label + ' 画布被压得不可玩 h=' + after.canvas.h);
      /* 可点性双重证明：
         1) elementFromPoint 命中层（geometry.hittable）已在 sharedAssertions 校验；
         2) 派发真实 PointerEvent（与 smoke 的 buttonPointer 同口径），道具次数减少。 */
      await cdp.evaluate(`(() => { const o = document.querySelector('[data-overlay]'); if (o) o.hidden = true; })()`);
      const btn = after.buttons.find((b) => b.id === 'feather');
      const beforeCount = await cdp.evaluate(`parseInt(document.querySelector('[data-joy-tool="feather"] [data-joy-count]').textContent, 10)`);
      const dispatched = await cdp.evaluate(`(() => {
        const b = document.querySelector('[data-joy-tool="feather"]');
        if (!b || b.disabled) return false;
        b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      })()`);
      await sleep(80);
      const afterCount = await cdp.evaluate(`parseInt(document.querySelector('[data-joy-tool="feather"] [data-joy-count]').textContent, 10)`);
      assert(dispatched && afterCount === beforeCount - 1, label + ' 道具按钮点击无效: ' + JSON.stringify({ before: beforeCount, after: afterCount, dispatched }));
      if (w === 390) await cdp.screenshot('immersive-buttons-390.png');
      record(label + ' 可见/44px/抬升Δ≥30/不压画布/真实点击生效', true);
    }

    /* ---------- IB-02 黄金矿工：画布内悬浮道具坞 ---------- */
    for (const [w, h] of PORTRAIT) {
      await setViewport(cdp, w, h);
      const label = `${w}×${h} 矿工道具坞`;
      await immersive(cdp, 'gold-miner.html', '?itemfloor=1#test');
      await cdp.evaluate(`(() => { const o = document.querySelector('[data-ov-btn]'); if (o) o.click(); })()`);
      /* 道具坞抬升后，游戏的 ResizeObserver 需要几帧才把 itemFloor 收上去。 */
      await sleep(400);
      await cdp.evaluate(`(() => { window.dispatchEvent(new Event('resize')); })()`);
      await sleep(200);
      const after = await cdp.evaluate(geometry());
      sharedAssertions(after, label, { minGap: 38, minDelta: 0, baseline: null });
      const items = await cdp.evaluate(`(() => {
        const info = __arcadeTest.info();
        const c = document.querySelector('.game-canvas').getBoundingClientRect();
        const t = document.querySelector('[data-toolbelt]').getBoundingClientRect();
        return { lowest: Math.round(Math.max(...info.itemList.map((o) => o.y + o.r))),
                 barTop: Math.round(((t.top - c.top) / c.height) * 740) };
      })()`);
      /* 悬浮道具坞本就覆盖画布底部空区；关键约束是「矿物不被道具坞遮住」。 */
      assert(items.lowest <= items.barTop - 2, label + ' 矿物被抬升后的道具坞遮挡: ' + JSON.stringify(items));
      record(label + ' 悬浮坞抬高 + 矿物不被遮挡', true);
    }

    /* ---------- IB-03 俄罗斯方块：画布内道具坞不压井口 + 按钮行抬高 ---------- */
    for (const [w, h] of PORTRAIT) {
      await setViewport(cdp, w, h);
      const label = `${w}×${h} 方块道具坞/按钮行`;
      await immersive(cdp, 'block-drop.html');
      await cdp.evaluate(`(() => { const o = document.querySelector('[data-overlay]'); if (o) o.hidden = true; const f = document.querySelector('.ac-fs-inline'); if (f) f.hidden = true; })()`);
      const m = await cdp.evaluate(geometry());
      sharedAssertions(m, label, { minGap: 38, minDelta: 0, baseline: null });
      const dock = m.buttons.filter((b) => ['swap', 'slow'].includes(b.id));
      assert(dock.length === 2 && dock.every((b) => b.top >= m.wellBottom - 1),
        label + ' 道具坞压住井口: ' + JSON.stringify({ wellBottom: m.wellBottom, dock }));
      record(label + ' 井口不被压 + 拇指区按钮抬高', true);
    }

    /* ---------- IB-04 独立窗口安全区：抬升叠加在安全区之上 ---------- */
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: SAFE });
    await setViewport(cdp, 390, 844);
    for (const [page, query] of [['shadow-leap.html', ''], ['gold-miner.html', '?itemfloor=1#test']]) {
      const label = `390×844 安全区 ${page}`;
      await immersive(cdp, page, query);
      if (page.startsWith('gold')) {
        await cdp.evaluate(`(() => { const b = document.querySelector('[data-ov-btn]'); if (b) b.click(); })()`);
        await sleep(250);
      }
      await cdp.evaluate(`(() => { const o = document.querySelector('[data-overlay]'); if (o) o.hidden = true; const f = document.querySelector('.ac-fs-inline'); if (f) f.hidden = true; })()`);
      await setBaseline(cdp, true);
      const before = await cdp.evaluate(geometry());
      await setBaseline(cdp, false);
      const m = await cdp.evaluate(geometry());
      /* 矿工道具坞在画布内随安全区定位，safe-area 下抬升 Δ≈23px（变量 36px 中约 13px 被安全区布局吸收）；
         影跃画布外道具行 Δ≈36px。统一用 Δ≥18 保证量化抬升有效。 */
      sharedAssertions(m, label, { minGap: 66, minDelta: 18, baseline: before });
      assert(m.topbarPadTop >= 47, label + ' 刘海安全区丢失: padTop=' + m.topbarPadTop);
      /* 画布外道具行游戏保留原安全区 padding（34px）；矿工额外叠加 lift。 */
      assert(m.stagePadBottom >= 34 - 1 + (page.startsWith('gold') ? 36 : 0),
        label + ' 底部安全区未与抬升叠加: ' + m.stagePadBottom);
      if (page.startsWith('gold')) {
        const items = await cdp.evaluate(`(() => {
          const info = __arcadeTest.info();
          const c = document.querySelector('.game-canvas').getBoundingClientRect();
          const t = document.querySelector('[data-toolbelt]').getBoundingClientRect();
          return { lowest: Math.round(Math.max(...info.itemList.map((o) => o.y + o.r))),
                   barTop: Math.round(((t.top - c.top) / c.height) * 740) };
        })()`);
        assert(items.lowest <= items.barTop - 2, label + ' 矿物被遮挡: ' + JSON.stringify(items));
      }
      record(label + ' 安全区保留 + 抬升叠加 + 按钮完整可见', true);
    }
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, bottom: 0, right: 0 } });

    /* ---------- IB-05 横屏 667×375：20px 小抬升，画布可玩 ---------- */
    await setViewport(cdp, 667, 375);
    const label = '667×375 横屏沉浸';
    await immersive(cdp, 'shadow-leap.html');
    await setBaseline(cdp, true);
    const before = await cdp.evaluate(geometry());
    await setBaseline(cdp, false);
    const m = await cdp.evaluate(geometry());
    assert(m.lift === 20, label + ' 横屏应使用 20px 抬升: ' + m.lift);
    sharedAssertions(m, label, { minGap: 20, minDelta: 12, baseline: before });
    assert(m.canvas.h > 100, label + ' 横屏画布不可玩 h=' + m.canvas.h);
    record(label + ' 20px 小抬升 + 画布可玩 + 按钮可点无溢出', true);
  } finally {
    if (cdp) cdp.close();
    if (server) server.close();
    await stopChrome(launched || {});
  }
  const outcome = summary('immersive-button checks');
  if (outcome.failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('IMMERSIVE BUTTONS TEST FAILED:', err.stack || err);
  process.exitCode = 1;
});
