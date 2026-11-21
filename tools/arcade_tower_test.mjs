#!/usr/bin/env node
/**
 * StudioKit Arcade 门禁：层塔（pendulum-tower）三项改造
 *  (A) 持久重心/支撑稳定性模型：一直偏置堆叠会塌，左右交替对称堆叠稳定
 *  (B) 全览 Overview：按钮/快捷键切换、动画缩放、层号、全览期间禁止落箱、结算前 ≤1s 拉远
 *  (C) 工地集装箱皮肤 + 真实生效属性（重量/奖励/易碎）+ 可读提示
 *
 * 零 npm 依赖：复用 tools/lib/arcade_cdp.mjs；默认端口 8775 / 9343。
 * 运行：node tools/arcade_tower_test.mjs [--scenario=TP-01] [--port=8775] [--cdp-port=9343]
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, createRecorder, envPort, launchChrome, openPage, sleep, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const ARTIFACTS = path.join(REPO_ROOT, 'test-artifacts');
const SERVER_PORT = envPort('ARCADE_TOWER_PORT', Number(process.argv.find((a) => a.startsWith('--port='))?.slice(7) || '8775'));
const CDP_PORT = envPort('ARCADE_TOWER_CDP_PORT', Number(process.argv.find((a) => a.startsWith('--cdp-port='))?.slice(11) || '9343'));
const BASE = 'http://127.0.0.1:' + SERVER_PORT;
const { record, assert, summary } = createRecorder();

function arg(name, fallback) {
  const hit = process.argv.slice(2).find((item) => item.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const hasFlag = (name) => process.argv.slice(2).some((item) => item === '--' + name || item.startsWith('--' + name + '='));
const shouldRun = (id) => !hasFlag('scenario') || arg('scenario', '') === id;

async function setViewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
}
async function prepare(cdp, tag) {
  // 先清掉旧局内档，避免下一次导航出现「继续上次」弹层。
  await cdp.navigate(BASE + '/apps/arcade/');
  await cdp.evaluate('localStorage.clear()');
  await cdp.navigate(BASE + '/apps/arcade/games/pendulum-tower.html?tower=' + encodeURIComponent(tag) + '&t=' + Date.now() + '#test');
  await cdp.waitFor('window.__arcadeTest && typeof window.__arcadeTest.joyInfo === "function"', { timeout: 8000 });
  await cdp.click('[data-ov-btn]');
  await cdp.waitFor('window.__arcadeTest.joyInfo().state === "playing"', { timeout: 5000 });
  await sleep(160);
}

/* ---------------- TP-01 静态门禁 ---------------- */
const TP_STATIC = {
  id: 'TP-01',
  async run() {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'apps/arcade/games/pendulum-tower.html'), 'utf8');
    assert(/W = 420/.test(src) && /H = 740/.test(src), '画布逻辑尺寸必须保持 420×740');
    assert(/data-overview-btn/.test(src), '缺少全览按钮 data-overview-btn');
    assert(/e\.key === '3'/.test(src), '缺少全览快捷键 3');
    assert((src.match(/result: '回看塔身'/g) || []).length === 3, '回看塔身标记数量不是 3');
    assert(/SUPPORT_HALF/.test(src) && /STABILITY_LIMIT/.test(src) && /comMoment/.test(src), '持久重心模型常量/变量缺失');
    assert(/CARGO_TYPES/.test(src) && /drawCrate/.test(src), '集装箱属性/绘制缺失');
    assert(/"schemaVersion"/.test(fs.readFileSync(path.join(REPO_ROOT, 'apps/arcade/challenge/pendulum-tower.js'), 'utf8')), '挑战数据缺失');
    record('静态：420×740 / 全览按钮+快捷键 / 回看 3 处 / 重心与属性实现', true);
  },
};

/* ---------------- TP-02 物理：偏置必塌，交替稳定 ---------------- */
const TP_PHYSICS = {
  id: 'TP-02',
  async run(cdp) {
    await prepare(cdp, 'physics-biased');
    // 连续右偏落箱（forceSettle 仍走真实 settleDrop 物理）
    let collapseAt = -1;
    for (let i = 1; i <= 12; i++) {
      await cdp.evaluate('__arcadeTest.forceSettle(18)');
      await sleep(220);
      const info = await cdp.evaluate('__arcadeTest.joyInfo()');
      if (info.state !== 'playing') { collapseAt = i; break; }
    }
    assert(collapseAt > 0 && collapseAt <= 10, '一直右偏堆叠未倒塌（12 层内）：collapseAt=' + collapseAt);
    const after = await cdp.evaluate('__arcadeTest.joyInfo()');
    assert(after.comOffset > 0, '倒塌时重心应偏右：comOffset=' + after.comOffset);
    record('持久重心：连续右偏 ' + collapseAt + ' 层倒塌，comOffset=' + after.comOffset.toFixed(1) + 'px', true);

    await prepare(cdp, 'physics-symmetric');
    for (let i = 1; i <= 14; i++) {
      const off = i % 2 === 1 ? 18 : -18;
      await cdp.evaluate('__arcadeTest.forceSettle(' + off + ')');
      await sleep(180);
      const info = await cdp.evaluate('__arcadeTest.joyInfo()');
      assert(info.state === 'playing', '左右交替第 ' + i + ' 层意外倒塌：' + JSON.stringify(info));
      assert(Math.abs(info.comOffset) < info.stabilityLimit, '左右交替第 ' + i + ' 层重心超出稳定半宽：' + info.comOffset);
    }
    const sym = await cdp.evaluate('__arcadeTest.joyInfo()');
    assert(sym.floorsReached >= 14 && Math.abs(sym.comOffset) < sym.stabilityLimit, '交替堆叠 14 层仍稳定：' + JSON.stringify(sym));
    record('持久重心：左右交替 14 层稳定，COM=' + sym.comOffset.toFixed(1) + 'px < ' + sym.stabilityLimit.toFixed(1) + 'px', true);
  },
};

/* ---------------- TP-03 全览交互 ---------------- */
const TP_OVERVIEW = {
  id: 'TP-03',
  async run(cdp) {
    await prepare(cdp, 'overview');
    await cdp.evaluate('__arcadeTest.stackTo(5)');
    const info0 = await cdp.evaluate('__arcadeTest.joyInfo()');
    const initial = await cdp.evaluate('__arcadeTest.overviewInfo()');
    assert(initial.active === false && initial.layers.length === info0.floorsReached + 1, '初始非全览/层数错误：' + JSON.stringify({ initial, floors: info0.floorsReached }));
    // 按钮切换
    await cdp.click('[data-overview-btn]');
    await sleep(420);
    const on = await cdp.evaluate('__arcadeTest.overviewInfo()');
    assert(on.active === true && on.t > 0.85, '按钮未能开启全览/动画未到位：' + JSON.stringify(on));
    assert(on.button.pressed === 'true', '全览按钮 aria-pressed 未置位');
    assert(on.layers.length === info0.floorsReached + 1 && on.layers.every((l) => l.floor >= 1 && l.icon), '全览缺少层号/属性图标：' + JSON.stringify(on.layers));
    assert(on.extent.top < on.extent.bottom, '全览范围异常：' + JSON.stringify(on.extent));
    // 全览期间禁止落箱（真实输入路径）
    const before = await cdp.evaluate('__arcadeTest.joyInfo()');
    await cdp.tap(210, 360);
    await sleep(120);
    const afterTap = await cdp.evaluate('__arcadeTest.joyInfo()');
    assert(afterTap.floorsReached === before.floorsReached && !afterTap.dropping, '全览期间落箱未被阻止：' + JSON.stringify(afterTap));
    // 快捷键 3 返回
    await cdp.key('3');
    await sleep(420);
    const off = await cdp.evaluate('__arcadeTest.overviewInfo()');
    assert(off.active === false && off.t < 0.15, '快捷键 3 未能退出全览：' + JSON.stringify(off));
    record('全览：按钮/快捷键切换 + 动画 + 层号图标 + 禁止落箱', true);

    // 结算前拉远：forceSettle 触发倒塌 → collapse 1.5s → reveal ~0.9s → result
    await prepare(cdp, 'overview-reveal');
    for (let i = 1; i <= 12; i++) {
      await cdp.evaluate('__arcadeTest.forceSettle(18)');
      await sleep(140);
      const s = await cdp.evaluate('__arcadeTest.joyInfo()');
      if (s.state !== 'playing') break;
    }
    await cdp.waitFor('window.__arcadeTest.joyInfo().overview.revealing === true', { timeout: 4000 });
    const start = Date.now();
    await cdp.waitFor('document.querySelector("[data-overlay]").hidden === false', { timeout: 4000 });
    const revealMs = Date.now() - start;
    assert(revealMs <= 1600, '结算拉远耗时过长：' + revealMs + 'ms（含 collapse 收尾）');
    const end = await cdp.evaluate('({ info: __arcadeTest.joyInfo(), title: document.querySelector("[data-ov-title]").textContent })');
    assert(end.info.state === 'over' && /工程结束|地基失守/.test(end.title), '结算弹层异常：' + JSON.stringify(end));
    record('结算前动画式拉远全塔（' + revealMs + 'ms 至结算，≤1.6s 含收尾）', true);
  },
};

/* ---------------- TP-04 集装箱属性 ---------------- */
const TP_CARGO = {
  id: 'TP-04',
  async run(cdp) {
    await prepare(cdp, 'cargo');
    const types = await cdp.evaluate('__arcadeTest.cargoTypes()');
    assert(Array.isArray(types) && types.length === 4, '集装箱属性种类异常：' + JSON.stringify(types));
    assert(types.some((t) => t.id === 'heavy' && t.weight > 1) && types.some((t) => t.id === 'bonus' && t.bonus > 0) && types.some((t) => t.id === 'fragile'), '属性缺少重量/奖励/易碎：' + JSON.stringify(types));
    // 奖励箱：score 增加 bonus
    const s0 = await cdp.evaluate('__arcadeTest.joyInfo().score');
    await cdp.evaluate('__arcadeTest.forceSettle(0, "bonus")');
    await sleep(120);
    const s1 = await cdp.evaluate('__arcadeTest.joyInfo().score');
    assert(s1 - s0 >= 25, '奖励箱未真实加分：' + s0 + '→' + s1);
    // 重型箱：重量影响重心（同偏移下 COM 更大）
    await prepare(cdp, 'cargo-heavy');
    await cdp.evaluate('__arcadeTest.forceSettle(16, "std")');
    await sleep(150);
    const stdCom = await cdp.evaluate('__arcadeTest.joyInfo().comOffset');
    await prepare(cdp, 'cargo-heavy2');
    await cdp.evaluate('__arcadeTest.forceSettle(16, "heavy")');
    await sleep(150);
    const heavyCom = await cdp.evaluate('__arcadeTest.joyInfo().comOffset');
    assert(heavyCom > stdCom, '重型箱未放大重心偏移：std=' + stdCom + ' heavy=' + heavyCom);
    record('属性：奖励箱加分 + 重型箱放大重心（std ' + stdCom.toFixed(2) + ' → heavy ' + heavyCom.toFixed(2) + '）', true);

    // 可读提示：下一箱预告 + 当前吊运属性在画布上（用截图人工/自动不可读，故断言钩子字段）
    const info = await cdp.evaluate('__arcadeTest.joyInfo()');
    assert(info.cargo && info.cargo.active && info.cargo.next, '缺少当前/下一箱属性提示字段：' + JSON.stringify(info.cargo));
    record('属性：当前吊运/下一箱预告可读字段存在', true);
  },
};

/* ---------------- TP-05 存档兼容 ---------------- */
const TP_SAVE = {
  id: 'TP-05',
  async run(cdp) {
    await prepare(cdp, 'save');
    await cdp.evaluate('__arcadeTest.stackTo(3)');
    // 注入一个旧档（缺少新增字段）
    await cdp.evaluate(`(() => {
      const raw = { mode: 'classic', boxes: [
        { x: 155, y: -44, w: 110, h: 44, base: true },
        { x: 178, y: -84, w: 64, h: 40 },
        { x: 178, y: -124, w: 64, h: 40 },
        { x: 178, y: -164, w: 64, h: 40 }
      ], towerLean: 0.02, leanVel: 0, camY: -474, score: 30, perfectCombo: 1,
      floorsReached: 3, tools: { guide: 3, brace: 2 }, pendHasBox: true, pendReload: 0,
      guideArmed: false, drop: null, pend: { angle: 0.2, vel: 0, gravity: 782 } };
      localStorage.setItem('studiokit:arcade:runs:v1', JSON.stringify({ games: { 'pendulum-tower': { savedAt: Date.now(), score: 30, summary: 'old', data: raw } } }));
      return true;
    })()`);
    await cdp.navigate(BASE + '/apps/arcade/games/pendulum-tower.html?tower=save-resume&t=' + Date.now() + '#test');
    await cdp.waitFor('!!window.__arcadeTest', { timeout: 8000 });
    const title = await cdp.text('[data-ov-title]');
    assert(/继续上次/.test(title), '旧档未提示继续：' + title);
    await cdp.click('[data-ov-btn]');
    await sleep(220);
    const info = await cdp.evaluate('__arcadeTest.joyInfo()');
    assert(info.floorsReached === 3 && info.state === 'playing', '旧档续玩楼层/状态异常：' + JSON.stringify(info));
    assert(Number.isFinite(info.comOffset) && Number.isFinite(info.comMoment), '旧档重心字段缺省值异常：' + JSON.stringify(info));
    record('存档：旧档（无重心/属性字段）可续玩，缺省值生效', true);
  },
};

/* ---------------- TP-06 布局与全屏 ---------------- */
const TP_LAYOUT = {
  id: 'TP-06',
  async run(cdp) {
    await prepare(cdp, 'layout');
    for (const [w, h] of [[320, 568], [375, 667], [390, 844], [430, 932]]) {
      await setViewport(cdp, w, h);
      await sleep(140);
      const m = await cdp.evaluate(`(() => {
        const r = (el) => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top), bottom: Math.round(b.bottom), right: Math.round(b.right) }; };
        return {
          sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
          docH: document.documentElement.scrollHeight, vh: innerHeight,
          canvas: r(document.querySelector('.game-canvas')),
          tools: [...document.querySelectorAll('.tower-tools .touch-btn')].map(r),
        };
      })()`);
      assert(m.sw <= m.cw + 1, w + 'px 横向溢出：' + m.sw + '>' + m.cw);
      assert(m.docH <= m.vh + 1, w + 'px 纵向溢出：' + m.docH + '>' + m.vh);
      assert(m.tools.length === 3 && m.tools.every((b) => b.w >= 44 && b.h >= 44), w + 'px 三枚工具按钮不合规：' + JSON.stringify(m.tools));
      assert(m.tools.every((b) => b.right <= m.cw + 1 && b.bottom <= m.vh + 1), w + 'px 工具按钮越界：' + JSON.stringify(m.tools));
      assert(m.canvas.w >= 120 && m.canvas.h >= 200, w + 'px 画布过小：' + JSON.stringify(m.canvas));
      // 全览按钮可点且能切换
      await cdp.click('[data-overview-btn]');
      await sleep(60);
      const o = await cdp.evaluate('__arcadeTest.joyInfo().overview.active');
      assert(o === true, w + 'px 全览按钮不可点');
      await cdp.click('[data-overview-btn]');
      await sleep(60);
      record('布局 ' + w + '×' + h + '：0 溢出，3 枚按钮 ≥44px 且可点', true);
    }
    // 全屏（420 逻辑画布按全屏尺寸适配）
    await setViewport(cdp, 844, 390);
    await sleep(140);
    const land = await cdp.evaluate(`(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, docH: document.documentElement.scrollHeight, vh: innerHeight }))()`);
    assert(land.sw <= land.cw + 1, '全屏横屏横向溢出：' + JSON.stringify(land));
    record('全屏横屏 844×390：无横向溢出', true);
    assert(cdp.errors.length === 0, 'console error: ' + cdp.errors.slice(0, 3).join(' | '));
  },
};

const SCENARIOS = [TP_STATIC, TP_PHYSICS, TP_OVERVIEW, TP_CARGO, TP_SAVE, TP_LAYOUT];

let server, launched, cdp;
try {
  server = await startServer({ port: SERVER_PORT });
  launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'studiokit-arcade-tower-' });
  cdp = await openPage({ port: CDP_PORT, artifactsDir: ARTIFACTS, width: 420, height: 900 });
  for (const scenario of SCENARIOS) {
    if (!shouldRun(scenario.id)) continue;
    await scenario.run(cdp);
  }
  const result = summary('Arcade 层塔三项改造门禁');
  process.exitCode = result.failed ? 1 : 0;
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
} finally {
  if (cdp) cdp.close();
  if (launched) await stopChrome(launched);
  if (server) server.close();
}
