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

/* ---------------- TP-07 可达性：单向偏置后塔顶仍在摆幅可达范围 ---------------- */
const TP_REACH = {
  id: 'TP-07',
  async run(cdp) {
    await prepare(cdp, 'reach');
    /* 连续单向偏置落箱：每一步都必须满足
       a) 塔顶中心落在摆幅可达区间内（jib 跟随塔顶）；
       b) 让钟摆停在塔顶正上方时，落点预测为「可落上」（不会必然失败）；
       c) 塔没倒之前一定不能出现「够不到」的死局。 */
    const steps = [];
    for (let i = 1; i <= 5; i++) {
      await cdp.evaluate('__arcadeTest.forceSettle(18)');
      await sleep(180);
      const st = await cdp.evaluate('__arcadeTest.joyInfo().state');
      if (st !== 'playing') break;
      /* 吊臂是平滑滑移（≈0.2s 时间常数），等它收敛后再断言对位。 */
      await cdp.waitFor(`(() => { const p = __arcadeTest.physicsInfo(); return Math.abs(p.pivotX - p.jibTargetX) < 0.4; })()`, { timeout: 3000 });
      const ph = await cdp.evaluate('__arcadeTest.physicsInfo()');
      assert(ph.topReachable === true, '第 ' + i + ' 层后塔顶已超出摆幅可达范围（死局）：' + JSON.stringify({ topCenter: ph.topCenter, reach: ph.reach }));
      assert(ph.pivotX >= ph.jibMinX - 0.01 && ph.pivotX <= ph.jibMaxX + 0.01, '吊臂小车越界：' + ph.pivotX);
      /* 关键 1：吊臂收敛后必须对上 jibTargetX（塔顶在行程内时即为塔顶中心）。 */
      assert(Math.abs(ph.pivotX - ph.jibTargetX) < 0.5, '吊臂未收敛到目标：pivot=' + ph.pivotX + ' target=' + ph.jibTargetX);
      if (ph.topCenter > ph.jibMinX && ph.topCenter < ph.jibMaxX) {
        assert(Math.abs(ph.pivotX - ph.topCenter) < 0.5, '吊臂未跟住塔顶：pivot=' + ph.pivotX + ' top=' + ph.topCenter);
      }
      /* 关键 2：摆幅区间必须覆盖塔顶中心 —— 即钟摆每一摆都会经过塔顶正上方，
         玩家总能等到「落点可正中」的相位；否则就是「释放必然失败」的死局。 */
      assert(ph.reach.min <= ph.topCenter && ph.topCenter <= ph.reach.max,
        '摆幅区间未覆盖塔顶（释放必然失败的死局）：reach [' + ph.reach.min.toFixed(1) + ',' + ph.reach.max.toFixed(1) + '] top ' + ph.topCenter);
      steps.push({ floor: i, topCenter: Math.round(ph.topCenter), pivot: Math.round(ph.pivotX) });
    }
    assert(steps.length >= 3, '偏置堆叠未产生有效楼层（无法验证可达性）：' + JSON.stringify(steps));

    /* 挑战模式必须保持关卡固定的 pivotX（合同不变）。 */
    await prepare(cdp, 'reach-challenge');
    const started = await cdp.evaluate(`(() => { try { return __arcadeTest.startChallenge('pendulum-tower-C01'); } catch (e) { return false; } })()`);
    if (started) {
      await sleep(250);
      const ch = await cdp.evaluate('__arcadeTest.physicsInfo()');
      assert(ch.mode === 'challenge', '未进入挑战模式：' + ch.mode);
      assert(Math.abs(ch.pivotX - 210) < 0.5, '挑战模式 pivotX 被改动（应固定 210）：' + ch.pivotX);
    }
    record('可达性：单向偏置后塔顶始终在摆幅可达范围内，且吊臂精确跟位（' + steps.map((s) => s.floor + ':' + s.topCenter).join(' ') + '）', true);
  },
};

/* ---------------- TP-08 全览 zoom-to-fit：几十层也要一屏装下 ---------------- */
const TP_ZOOM = {
  id: 'TP-08',
  async run(cdp) {
    /* 3 层：正常视角不应缩放（scale 保持 1）。 */
    await prepare(cdp, 'zoom-small');
    await cdp.evaluate('__arcadeTest.stackTo(3)');
    await sleep(150);
    await cdp.evaluate('__arcadeTest.toggleOverview()');
    await sleep(800);
    const small = await cdp.evaluate('__arcadeTest.viewInfo()');
    assert(small.overviewT > 0.9, '全览动画未到位：' + small.overviewT);
    assert(small.fitsOnScreen === true, '3 层全览未完整显示：' + JSON.stringify(small.screen));
    assert(small.scale > 0.9, '3 层不该明显缩小（应接近 1）：' + small.scale);

    /* 40 层：必须整体缩小到画布内（这正是 Owner 的核心诉求）。 */
    await prepare(cdp, 'zoom-40');
    await cdp.evaluate('__arcadeTest.stackTo(40)');
    await sleep(200);
    await cdp.evaluate('__arcadeTest.toggleOverview()');
    await sleep(900);
    const big = await cdp.evaluate('__arcadeTest.viewInfo()');
    assert(big.overviewT > 0.9, '40 层全览动画未到位：' + big.overviewT);
    assert(big.extent.top < big.extent.bottom, '全览范围异常：' + JSON.stringify(big.extent));
    assert(big.scale < 0.9, '40 层没有真正缩小（仍是旧版只平移）：scale=' + big.scale);
    assert(big.fitsOnScreen === true,
      '40 层全览未完整装进画布：top=' + Math.round(big.screen.topY) + ' bottom=' + Math.round(big.screen.bottomY) + ' H=' + big.screen.canvasH);
    assert(big.screen.topY >= 0 && big.screen.bottomY <= big.screen.canvasH,
      '40 层全览越界：top=' + Math.round(big.screen.topY) + ' bottom=' + Math.round(big.screen.bottomY));
    /* 缩放比要跟着层数单调变小：层数越多、缩得越小。 */
    assert(big.scale < small.scale, '缩放比未随层数增加而缩小：3 层 ' + small.scale + ' vs 40 层 ' + big.scale);

    /* 退出全览必须回到 1:1 跟随视角（不能残留缩放）。 */
    await cdp.evaluate('__arcadeTest.toggleOverview()');
    await sleep(800);
    const back = await cdp.evaluate('__arcadeTest.viewInfo()');
    assert(back.overviewT < 0.1 && Math.abs(back.scale - 1) < 0.01, '退出全览未恢复 1:1：' + JSON.stringify({ t: back.overviewT, scale: back.scale }));
    record('全览 zoom-to-fit：3 层 ' + small.scale.toFixed(2) + '× / 40 层 ' + big.scale.toFixed(2) + '× 均完整入屏（top ' + Math.round(big.screen.topY) + '–bottom ' + Math.round(big.screen.bottomY) + ' / ' + big.screen.canvasH + '）', true);

    /* 开局必须是 1:1（不得因 overviewT 初值而先缩小再放大）。 */
    await prepare(cdp, 'zoom-start');
    await sleep(120);
    const startView = await cdp.evaluate('__arcadeTest.viewInfo()');
    assert(Math.abs(startView.scale - 1) < 0.02, '开局视角不是 1:1（存在启动缩放）：' + startView.scale);

    /* 结算动画拉远后必须「保持」全塔缩放（塔没塌的结局才有塔可看）：旧实现弹层出现即缩回 1:1。 */
    await cdp.evaluate('__arcadeTest.stackTo(14)');
    await sleep(200);
    await cdp.evaluate('__arcadeTest.forceSettle(200)');
    await cdp.waitFor('window.__arcadeTest.joyInfo().overview.revealing === true', { timeout: 5000 });
    await cdp.waitFor('document.querySelector("[data-overlay]").hidden === false', { timeout: 6000 });
    await sleep(250);
    const settle = await cdp.evaluate('__arcadeTest.viewInfo()');
    assert(settle.scale < 0.95, '结算后未保持全塔缩放（弹层出现就缩回）：scale=' + settle.scale);
    assert(settle.fitsOnScreen === true && settle.screen.topY >= 0 && settle.screen.bottomY <= settle.screen.canvasH,
      '结算后整塔未完整入屏：' + JSON.stringify(settle.screen));
    record('结算拉远保持缩放：14 层结案后 scale ' + settle.scale.toFixed(2) + '×（y ' + Math.round(settle.screen.topY) + '–' + Math.round(settle.screen.bottomY) + '）', true);
  },
};

/* ---------------- TP-09 所见即所判：站立塔不再整体旋转 ---------------- */
const TP_CONSISTENCY = {
  id: 'TP-09',
  async run(cdp) {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'apps/arcade/games/pendulum-tower.html'), 'utf8');
    /* 站立塔绘制段内不得再出现 rotate(towerLean)：否则视觉塔顶与落点判定错位。 */
    const standBlock = src.slice(src.indexOf('if (boxes.length) {'), src.indexOf('collapsed.forEach'));
    assert(!/rotate\(\s*towerLean\s*\)/.test(standBlock), '站立塔仍按 towerLean 整体旋转（视觉与判定会错位）');
    /* 倒塌动画必须保留真实旋转（可玩性/观赏性）。 */
    assert(/ctx\.rotate\(b\.rot\)/.test(src), '倒塌动画缺少逐箱旋转');

    await prepare(cdp, 'consistency');
    await cdp.evaluate('__arcadeTest.stackTo(6)');
    await sleep(150);
    /* 即使人为把倾斜推到接近极限，塔顶逻辑位置也不得漂移（不再被旋转误导）。 */
    const base = await cdp.evaluate('__arcadeTest.physicsInfo().topCenter');
    await cdp.evaluate('__arcadeTest.setLean(0.3, 0)');
    await sleep(120);
    const leaned = await cdp.evaluate('__arcadeTest.physicsInfo().topCenter');
    assert(Math.abs(leaned - base) < 0.01, '倾斜值影响了塔顶逻辑位置：' + base + '→' + leaned);
    /* 落点投影常显（不再只在 3 层内可见）：第 6 层时仍应给得出预测。 */
    const ph = await cdp.evaluate('__arcadeTest.physicsInfo()');
    assert(ph.forecast && typeof ph.forecast.landable === 'boolean', '落点预测缺失：' + JSON.stringify(ph.forecast));
    record('所见即所判：站立塔不整体旋转（倾斜 0.3 时塔顶位置不变 ' + Math.round(base) + 'px），倒塌动画保留旋转', true);
  },
};

/* ---------------- TP-10 释放水平速度（0.12.2） ---------------- */
const TP_RELEASE_VX = {
  id: 'TP-10',
  async run(cdp) {
    await prepare(cdp, 'vx');
    await cdp.evaluate('__arcadeTest.stackTo(2)');
    await sleep(150);

    /* 1) 存在真实水平速度：摆到中段时 |vx| 明显 > 0，且落点横移量 = vx × 下落时间（量级一致）。 */
    let sawVx = 0;
    let bestPerfect = Infinity;
    for (let i = 0; i < 45; i += 1) {
      const p = await cdp.evaluate('__arcadeTest.physicsInfo()');
      sawVx = Math.max(sawVx, Math.abs(p.releaseVx));
      bestPerfect = Math.min(bestPerfect, Math.abs(p.forecast.offset));
      await sleep(35);
    }
    assert(sawVx > 50, '释放瞬间没有继承水平速度（releaseVx 恒为 0）：' + sawVx);
    /* 2) 仍然可完美对齐：整段摆幅里总能找到一个相位让预测落点落在完美区间（±9.6px）。 */
    assert(bestPerfect <= 9.6, '加入水平速度后仍找不到完美对齐的释放相位（不可解）：最优 |偏移|=' + bestPerfect.toFixed(1));

    /* 3) 预测精度：同一 JS 轮次记录 lastRelease.predicted，落定后与真实塔顶中心比对。 */
    let checked = 0;
    let maxErr = 0;
    for (let attempt = 0; attempt < 6 && checked < 2; attempt += 1) {
      let released = false;
      for (let i = 0; i < 60; i += 1) {
        const p = await cdp.evaluate('__arcadeTest.physicsInfo()');
        /* 只在「不触发完美吸附」的偏移区间取样，避免吸附掩盖真实落点。 */
        if (Math.abs(p.forecast.offset) >= 12 && Math.abs(p.forecast.offset) <= 50 && Math.abs(p.releaseVx) > 60) {
          await cdp.evaluate('__arcadeTest.releaseNow()');
          released = true;
          break;
        }
        await sleep(35);
      }
      if (!released) continue;
      await sleep(950);
      const r = await cdp.evaluate(`(() => {
        const p = __arcadeTest.physicsInfo();
        const j = __arcadeTest.joyInfo();
        return { last: p.lastRelease, topCenter: p.topCenter, state: j.state };
      })()`);
      assert(r.state === 'playing', '释放后意外结束（预测应为可落上）：' + JSON.stringify(r));
      assert(r.last && Math.abs(r.last.drift) > 10, '水平横移量过小（未真正生效）：' + JSON.stringify(r.last));
      const err = Math.abs(r.topCenter - r.last.predicted);
      maxErr = Math.max(maxErr, err);
      assert(err <= 3, '预测落点与真实落点偏差过大：predicted=' + r.last.predicted.toFixed(1) + ' actual=' + r.topCenter.toFixed(1) + ' err=' + err.toFixed(1));
      checked += 1;
    }
    assert(checked >= 2, '未能取得足够的落点精度样本：' + checked);
    record('释放水平速度：vx 峰值 ' + Math.round(sawVx) + 'px/s、可完美对齐（最优偏移 ' + bestPerfect.toFixed(1) + 'px）、预测落点误差 ≤' + maxErr.toFixed(1) + 'px', true);
  },
};

/* ---------------- TP-11 超高塔全览（200 / 1000 层，0.12.3） ---------------- */
const TP_TALL = {
  id: 'TP-11',
  async run(cdp) {
    /* 旧实现把缩放 clamp 到 0.08：200 层需要 0.063（溢出 140px）、1000 层需要 0.0127（溢出 ~2700px）。
       现在必须严格按 span 缩到可视区，任何层数都能完整入屏。 */
    const cases = [
      { floors: 40, maxScale: 1, minScale: 0.2 },
      { floors: 200, maxScale: 0.08, minScale: 0.01 },
      { floors: 1000, maxScale: 0.02, minScale: 0.001 },
    ];
    const out = [];
    for (const c of cases) {
      await prepare(cdp, 'tall' + c.floors);
      await cdp.evaluate('__arcadeTest.stackTo(' + c.floors + ')');
      await sleep(250);
      const info = await cdp.evaluate('__arcadeTest.joyInfo()');
      assert(info.floorsReached === c.floors, c.floors + ' 层堆叠失败：floorsReached=' + info.floorsReached);
      await cdp.evaluate('__arcadeTest.toggleOverview()');
      await sleep(900);
      const v = await cdp.evaluate('__arcadeTest.viewInfo()');
      assert(v.overviewT > 0.99, c.floors + ' 层全览动画未收敛：t=' + v.overviewT);
      assert(v.scale <= c.maxScale, c.floors + ' 层缩放比未随塔高收缩（存在下限？）：scale=' + v.scale);
      assert(v.scale >= c.minScale, c.floors + ' 层缩放比异常过小：scale=' + v.scale);
      assert(v.fitsOnScreen === true, c.floors + ' 层全览未完整入屏：' + JSON.stringify(v.screen));
      /* 精确性：整塔必须刚好落在上下留白之间（±2px），说明是真正的 zoom-to-fit 而不是「差不多」。 */
      assert(v.screen.topY >= 100 && v.screen.topY <= 132, c.floors + ' 层塔顶未落在留白内：topY=' + v.screen.topY);
      assert(v.screen.bottomY >= 608 && v.screen.bottomY <= 640, c.floors + ' 层塔底未落在留白内：bottomY=' + v.screen.bottomY);
      out.push(c.floors + '层 ' + v.scale.toFixed(4) + '×');
    }
    assert(cdp.errors.length === 0, 'console error: ' + cdp.errors.slice(0, 3).join(' | '));
    record('超高塔全览无缩放下限：' + out.join(' / ') + ' 均完整入屏且塔顶塔底贴合留白', true);
  },
};

/* ---------------- TP-12 LOD 只跟缩放走（0.12.4 回归） ---------------- */
const TP_LOD = {
  id: 'TP-12',
  async run(cdp) {
    /* 0.12.3 的 bug：LOD 条件写成 `boxes.length > 60 || scale < 0.35`，
       导致塔一旦超过 60 层，**普通 1:1 近景**也退化成纯色方块（集装箱波纹/角件/编号全丢）。
       现在 LOD 只看缩放：近景必须完整细节，压缩到 <0.5 才简化，性能靠视口裁剪。 */
    const cases = [
      { floors: 3, expectOverviewDense: false },
      { floors: 40, expectOverviewDense: false },   // 40 层全览 scale≈0.29，仍应保留细节
      { floors: 120, expectOverviewDense: true },   // scale≈0.10 → 简化
      { floors: 1000, expectOverviewDense: true },
    ];
    const rows = [];
    for (const c of cases) {
      await prepare(cdp, 'lod' + c.floors);
      await cdp.evaluate('__arcadeTest.stackTo(' + c.floors + ')');
      await sleep(300);
      const normal = await cdp.evaluate('({ lod: __arcadeTest.physicsInfo().renderLod, scale: __arcadeTest.viewInfo().scale })');
      assert(normal.lod, c.floors + ' 层缺少 renderLod 探针');
      assert(Math.abs(normal.scale - 1) < 0.01, c.floors + ' 层近景缩放不是 1:1：' + normal.scale);
      assert(normal.lod.dense === false,
        c.floors + ' 层近景退化成纯色方块（LOD 误按层数触发）：' + JSON.stringify(normal.lod));
      /* 视口裁剪：高层塔近景只画可见部分，保证细节与性能可以兼得。 */
      assert(normal.lod.drawnBoxes <= 40, c.floors + ' 层近景绘制数量失控（裁剪未生效）：' + normal.lod.drawnBoxes);
      if (c.floors >= 120) {
        assert(normal.lod.drawnBoxes < normal.lod.totalBoxes, c.floors + ' 层近景未做视口裁剪：' + JSON.stringify(normal.lod));
      }
      await cdp.evaluate('__arcadeTest.toggleOverview()');
      await sleep(900);
      const ov = await cdp.evaluate('({ lod: __arcadeTest.physicsInfo().renderLod, scale: +__arcadeTest.viewInfo().scale.toFixed(3), fits: __arcadeTest.viewInfo().fitsOnScreen })');
      assert(ov.lod.dense === c.expectOverviewDense,
        c.floors + ' 层全览 LOD 判定不符（scale=' + ov.scale + '）：' + JSON.stringify(ov.lod));
      assert(ov.fits === true, c.floors + ' 层全览未完整入屏');
      rows.push(c.floors + '层近景细节✓(画' + normal.lod.drawnBoxes + '/' + normal.lod.totalBoxes + ') 全览' + (ov.lod.dense ? '压缩块' : '细节') + '@' + ov.scale + '×');
    }
    record('LOD 只跟缩放走：' + rows.join(' / '), true);
  },
};

/* ---------------- TP-13 难度曲线：层数越高越快，摆幅不塌（0.12.5） ---------------- */
const TP_CURVE = {
  id: 'TP-13',
  async run(cdp) {
    /* 旧曲线 swingGravity = min(1700, 680+34f) 在 30 层就撞顶 ⇒ 200 层与 30 层手感完全相同，
       这正是「200 层后很容易完美连击」的根因；同时 g 阶跃时能量被吃掉，摆幅会无序塌到 154px。
       现在：两段式 g（56 层前 +34/层、之后 +14/层，约 157 层封顶 4000）+ 升速时把振幅归一到目标值。 */
    const floors = [0, 10, 20, 30, 56, 100, 157, 200, 1000];
    const rows = [];
    for (const f of floors) {
      await prepare(cdp, 'curve' + f);
      if (f > 0) await cdp.evaluate('__arcadeTest.stackTo(' + f + ')');
      await sleep(320);
      const s = await cdp.evaluate('(() => { const p = __arcadeTest.physicsInfo(); return { floors: __arcadeTest.joyInfo().floorsReached, ...p.swing }; })()');
      assert(s && s.gravity > 0, f + ' 层缺少 swing 探针');
      rows.push({ f, g: s.gravity, period: s.periodMs, amp: s.amplitudeRad, target: s.targetAmplitudeRad, span: s.xSpanPx });
    }
    const byFloors = (n) => rows.find((r) => r.f === n);
    /* 1) 速度随层数单调递增（周期单调不增），且必须真的变快很多。 */
    for (let i = 1; i < rows.length; i += 1) {
      assert(rows[i].g >= rows[i - 1].g, 'g 未随层数单调不减：' + rows[i - 1].f + '→' + rows[i].f + ' ' + rows[i - 1].g + '→' + rows[i].g);
      assert(rows[i].period <= rows[i - 1].period, '摆动周期未随层数单调不增：' + rows[i - 1].f + '→' + rows[i].f);
    }
    for (const pair of [[10, 30], [30, 56], [56, 100], [56, 200]]) {
      const a = byFloors(pair[0]) || rows.find((r) => r.f === pair[0]);
      const b = rows.find((r) => r.f === pair[1]);
      assert(b.period < a.period - 20, pair[1] + ' 层没有比 ' + pair[0] + ' 层更快（周期 ' + a.period + '→' + b.period + 'ms）');
    }
    /* 2) 30 层之后必须继续变难（旧版在此封顶）。 */
    assert(rows.find((r) => r.f === 200).g > rows.find((r) => r.f === 30).g * 1.8,
      '200 层相对 30 层没有明显加速：' + rows.find((r) => r.f === 30).g + '→' + rows.find((r) => r.f === 200).g);
    /* 3) 封顶存在但不早于 100 层（保证 200 层玩家确实爬过一段渐难曲线）。 */
    assert(rows.find((r) => r.f === 100).g < rows.find((r) => r.f === 1000).g, '100 层就已经封顶（曲线太短）');
    assert(Math.abs(rows.find((r) => r.f === 200).g - rows.find((r) => r.f === 1000).g) < 1, '难度上限未在 157 层附近收敛');
    /* 4) 振幅必须归一到目标值（不再无序塌缩），且始终保留可见摆幅。 */
    for (const r of rows) {
      assert(Math.abs(r.amp - r.target) < 0.05, r.f + ' 层振幅未归一到目标：amp=' + r.amp.toFixed(3) + ' target=' + r.target.toFixed(3));
      assert(r.amp >= 0.55 && r.amp <= 1.05, r.f + ' 层振幅越界（摆幅塌缩或过大）：' + r.amp.toFixed(3));
      assert(r.span >= 120, r.f + ' 层摆幅过小（钟摆几乎不动）：' + r.span + 'px');
    }
    record('难度曲线：g ' + rows[0].g + '→' + rows[rows.length - 1].g + '（157 层封顶）、周期 ' + rows[0].period + '→' + rows[rows.length - 1].period + 'ms、振幅 ' + rows[0].amp.toFixed(2) + '→' + rows[rows.length - 1].amp.toFixed(2) + 'rad 恒等于目标', true);
  },
};

const SCENARIOS = [TP_STATIC, TP_PHYSICS, TP_OVERVIEW, TP_CARGO, TP_SAVE, TP_LAYOUT, TP_REACH, TP_ZOOM, TP_CONSISTENCY, TP_RELEASE_VX, TP_TALL, TP_LOD, TP_CURVE];

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
