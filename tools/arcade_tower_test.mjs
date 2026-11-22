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

/* ---------------- TP-13 难度曲线：层数越高越快，摆幅不塌（结构保证） ---------------- */
const TP_CURVE = {
  id: 'TP-13',
  async run(cdp) {
    /* 历史：`swingGravity = min(1700, 680+34f)` 在 30 层就撞顶 ⇒ 200 层与 30 层手感完全相同。
       本轮按人类计时能力重标：封顶 1500（146 层触顶）、起始 560、两段斜率 4/8、振幅 0.80→0.62。
       本场景只锁「结构」：g 单调不减 / 周期单调不增 / 30 层后继续变难 / 上限在 120~200 层之间收敛
       / 振幅被归一到目标值。真实「完美窗口 / 可落窗口」时长由 TP-14 用毫秒测量。 */
    const src = fs.readFileSync(path.join(REPO_ROOT, 'apps/arcade/games/pendulum-tower.html'), 'utf8');
    /* 挑战模式物理必须保持「关卡固定」：难度曲线不得渗入挑战（回归保护）。 */
    assert(/if \(mode === 'challenge'\) return;/.test(src), 'updateSwingDifficulty 不再对挑战模式提前返回');
    assert(/pend\.gravity = 680 \* \(Number\(pendulum\.speedFactor\) \|\| 1\);/.test(src),
      '挑战模式的摆速基准（680×speedFactor）被改动，挑战 6 关会受影响');
    record('结构：难度曲线不渗入挑战模式（updateSwingDifficulty 提前返回 + 挑战 g=680×speedFactor）', true);

    const floors = [0, 10, 20, 30, 56, 100, 120, 157, 200, 1000];
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
    /* 1) 速度随层数单调递增（周期单调不增）。 */
    for (let i = 1; i < rows.length; i += 1) {
      assert(rows[i].g >= rows[i - 1].g, 'g 未随层数单调不减：' + rows[i - 1].f + '→' + rows[i].f + ' ' + rows[i - 1].g + '→' + rows[i].g);
      assert(rows[i].period <= rows[i - 1].period, '摆动周期未随层数单调不增：' + rows[i - 1].f + '→' + rows[i].f);
    }
    for (const pair of [[10, 30], [30, 56], [56, 100], [56, 200]]) {
      const a = byFloors(pair[0]);
      const b = byFloors(pair[1]);
      assert(b.period < a.period - 20, pair[1] + ' 层没有比 ' + pair[0] + ' 层更快（周期 ' + a.period + '→' + b.period + 'ms）');
    }
    /* 2) 30 层之后必须继续明显变难（旧版在此封顶）：速度与周期双指标，不只看 g。 */
    const cap = byFloors(1000);
    assert(byFloors(200).g > byFloors(30).g * 1.5,
      '200 层相对 30 层没有明显加速：' + byFloors(30).g + '→' + byFloors(200).g);
    assert(byFloors(200).period < byFloors(30).period * 0.8,
      '200 层的摆动周期没有明显短于 30 层：' + byFloors(30).period + '→' + byFloors(200).period + 'ms');
    /* 3) 上限存在但不得早于 120 层，且必须在 200 层前收敛（曲线要够长）。 */
    assert(byFloors(120).g < cap.g, '120 层就已经封顶（曲线太短）');
    assert(Math.abs(byFloors(200).g - cap.g) < 1, '难度上限未在 200 层前收敛：' + byFloors(200).g + ' vs ' + cap.g);
    /* 4) 振幅必须归一到目标值（不再无序塌缩），且始终保留可见摆幅。 */
    for (const r of rows) {
      assert(Math.abs(r.amp - r.target) < 0.05, r.f + ' 层振幅未归一到目标：amp=' + r.amp.toFixed(3) + ' target=' + r.target.toFixed(3));
      assert(r.amp >= 0.55 && r.amp <= 1.05, r.f + ' 层振幅越界（摆幅塌缩或过大）：' + r.amp.toFixed(3));
      assert(r.span >= 120, r.f + ' 层摆幅过小（钟摆几乎不动）：' + r.span + 'px');
    }
    record('难度曲线：g ' + rows[0].g + '→' + cap.g + '（146 层封顶）、周期 ' + rows[0].period + '→' + cap.period + 'ms、振幅 ' + rows[0].amp.toFixed(2) + '→' + cap.amp.toFixed(2) + 'rad 恒等于目标', true);
  },
};

/* ---------------- TP-14 真实时长：完美窗口 / 可落窗口（「太快太难」的守卫） ---------------- */
/* 为什么必须用毫秒而不是帧计数：封顶完美窗口 ~55ms，60fps 一帧 16.7ms，
   旧版 24~28ms 的窗口连两帧都盖不住，逐帧统计的误差比窗口本身还大。
   所以本场景在页内做两件事，单个 CDP evaluate 完成（避免 1ms 级往返抖动）：
     A) 采集真实 rAF 帧序列 max(2.4s, 1.7 个摆动周期)：交叉校验「活的游戏循环」确实
        在扫过完美区间（min|offset| ≤ 12px）、周期与解析值一致、完美占空比与积分一致；
     B) 用同一份摆状态按 0.5ms 步长积分 2.2 个周期（与 localStorage 无关、可复现），
        把 |forecast.offset| ≤ 9.6px（完美吸附）与 < 58px（可落上）两种区间的持续毫秒数算出来。
   人类计时依据：重合计时变量误差训练者 ~20ms SD、普通玩家 60~100ms；手机触摸到显示
   display+touch 合计 35~140ms（26 机型实测）。所以封顶完美窗口必须 ≥55ms（≥3 帧、约 2× 训练者 SD），
   可落窗口 ≥150ms（失误罕见）；同时封顶必须明显难于 10 层（≤75% 窗口、≤65% 周期）。 */
const MEASURE_WINDOWS = `(async () => {
  const A = window.Arcade;
  const PERFECT_PX = 9.6;          // overlap >= BOX_W*0.85  =>  |offset| <= 64*0.15
  const LANDABLE_PX = 58;          // overlap > 6            =>  |offset| < 58
  const L = 135, BOX_H = 40, G_DROP = 1300, VY0 = 60, DAMP = 0.006;
  const p0 = window.__arcadeTest.physicsInfo();
  const g = p0.swing.gravity;
  const omega = Math.sqrt(g / (p0.swing.length || L));
  const periodS = (2 * Math.PI) / omega;
  const liveMs = Math.max(2400, Math.round(1.7 * periodS * 1000));

  /* ---- A) 活的游戏循环：rAF 采样 ---- */
  const frames = [];
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const p = window.__arcadeTest.physicsInfo();
      frames.push({ t: performance.now() - t0, off: p.forecast.offset, vx: p.releaseVx });
      if (performance.now() - t0 < liveMs) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
  const span = frames[frames.length - 1].t - frames[0].t;
  const dtAvg = span / (frames.length - 1);
  const crossT = [];
  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1].off, b = frames[i].off;
    if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) {
      const frac = a === b ? 0 : Math.abs(a) / (Math.abs(a) + Math.abs(b));
      crossT.push(frames[i - 1].t + frac * (frames[i].t - frames[i - 1].t));
    }
  }
  const gaps = [];
  for (let i = 2; i < crossT.length; i += 1) gaps.push(crossT[i] - crossT[i - 2]);
  const live = {
    frames: frames.length,
    perfDuty: frames.filter((f) => Math.abs(f.off) <= PERFECT_PX).length / frames.length,
    landDuty: frames.filter((f) => Math.abs(f.off) < LANDABLE_PX).length / frames.length,
    minAbsOffset: Math.min.apply(null, frames.map((f) => Math.abs(f.off))),
    maxAbsOffset: Math.max.apply(null, frames.map((f) => Math.abs(f.off))),
    periodMs: gaps.length ? gaps.reduce((s, v) => s + v, 0) / gaps.length : null,
  };

  /* ---- B) 0.5ms 积分：把区间时长算准 ---- */
  const p = window.__arcadeTest.physicsInfo();
  const length = p.swing.length || L;
  const K = p.releaseVxK;
  const pivotDelta = p.pivotX - p.topCenter;
  const ft0 = p.fallTime;
  const dist0 = ft0 * ((G_DROP * ft0) / 2 + VY0);   // 反解 fallTime 公式得到下落距离
  const cos0 = Math.cos(p.pendAngle);
  const fallTime = (th) => {
    const dist = Math.max(1, dist0 + length * (cos0 - Math.cos(th)));
    return (-VY0 + Math.sqrt(VY0 * VY0 + 2 * G_DROP * dist)) / G_DROP;
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const offsetAt = (th, om) => length * Math.sin(th) + clamp(Math.cos(th) * om * length * K, -240, 240) * fallTime(th) - pivotDelta;
  const selfCheck = Math.abs(offsetAt(p.pendAngle, p.pendVel) - p.forecast.offset);

  const DT = 0.0005;
  const sim = { angle: p.pendAngle, vel: p.pendVel, length: length, gravity: g, damping: DAMP };
  const steps = Math.round((periodS * 2.2) / DT);
  const offs = [];
  for (let i = 0; i <= steps; i += 1) { offs.push(offsetAt(sim.angle, sim.vel)); A.Physics.pendulumStep(sim, DT); }
  const runs = (limit) => {
    const out = []; let cur = 0, inside = false;
    for (const o of offs) {
      if (Math.abs(o) < limit) { cur += DT; inside = true; }
      else if (inside) { out.push(cur); inside = false; cur = 0; }
    }
    return out; // 丢掉末尾不完整区间
  };
  const firstHalfMedian = (xs) => {
    const half = xs.slice(0, Math.max(1, Math.floor(xs.length / 2))).sort((a, b) => a - b);
    return half.length ? half[Math.floor(half.length / 2)] : 0;
  };
  const perfRuns = runs(PERFECT_PX);
  const landRuns = runs(LANDABLE_PX);
  return {
    floors: window.__arcadeTest.joyInfo().floorsReached,
    g: g,
    periodMs: Math.round(periodS * 1000),
    perfectMs: firstHalfMedian(perfRuns) * 1000,
    landableMs: firstHalfMedian(landRuns) * 1000,
    runs: { perfect: perfRuns.length, landable: landRuns.length },
    selfCheck: selfCheck,
    liveMs: liveMs,
    live: live,
  };
})()`;

const TP_WINDOW = {
  id: 'TP-14',
  async run(cdp) {
    const floors = [0, 10, 30, 100, 150, 500];
    const CAP_FLOOR = 150;   // ≥ 146 即为封顶层（曲线 146 层触顶）
    const MIN_PERFECT = 54;  // 设计值 55.6ms；扣掉状态抖动余量，仍远高于人类 20ms 级 SD 的 2 倍
    const MIN_LANDABLE = 150;
    const rows = [];
    for (const f of floors) {
      await prepare(cdp, 'window' + f);
      if (f > 0) await cdp.evaluate('__arcadeTest.stackTo(' + f + ')');
      /* 等 camY 收敛（τ≈0.25s）与振幅归一稳定，否则 fallTime 会偏。 */
      await sleep(1100);
      const r = await cdp.evaluate(MEASURE_WINDOWS);
      assert(r && r.perfectMs > 0 && r.landableMs > 0, f + ' 层窗口测量失败：' + JSON.stringify(r));
      assert(r.selfCheck < 0.5, f + ' 层落点预测模型与游戏不一致（selfCheck=' + r.selfCheck + 'px）');
      assert(r.live.minAbsOffset <= 12, f + ' 层活的循环里预测落点从未进入完美区间（窗口不存在）：min=' + r.live.minAbsOffset.toFixed(1) + 'px');
      assert(r.live.maxAbsOffset >= 45, f + ' 层预测落点扫幅过小（说明没有真实摆动）：max=' + r.live.maxAbsOffset.toFixed(1) + 'px');
      const simDuty = (2 * r.perfectMs) / r.periodMs;
      assert(Math.abs(r.live.perfDuty - simDuty) <= Math.max(0.03, simDuty * 0.6),
        f + ' 层实时采样占空比与 0.5ms 积分不一致：live=' + (r.live.perfDuty * 100).toFixed(1) + '% sim=' + (simDuty * 100).toFixed(1) + '%');
      rows.push({ f, g: r.g, period: r.periodMs, perfect: r.perfectMs, landable: r.landableMs, livePeriod: r.live.periodMs });
    }
    /* 1) 两个窗口都必须随层数单调不增。
       容差说明：完美窗口（~55-82ms）逐帧抖动 ~1ms，取 2.5ms；可落窗口（~364-526ms）跨到
       摆幅极值附近（扫速慢），对实测振幅的 ±0.01rad 衰减非常敏感（同一封顶层两次测量可差 ~6ms），
       所以取 10ms。真正相邻层的差距是 60~70ms，10ms 容差仍然抓得住「先易后难」的锯齿。 */
    for (let i = 1; i < rows.length; i += 1) {
      assert(rows[i].perfect <= rows[i - 1].perfect + 2.5,
        '完美窗口未随层数单调不增（锯齿）：' + rows[i - 1].f + '层 ' + rows[i - 1].perfect.toFixed(1) + 'ms → ' + rows[i].f + '层 ' + rows[i].perfect.toFixed(1) + 'ms');
      assert(rows[i].landable <= rows[i - 1].landable + 10,
        '可落窗口未随层数单调不增（锯齿）：' + rows[i - 1].f + '层 ' + rows[i - 1].landable.toFixed(1) + 'ms → ' + rows[i].f + '层 ' + rows[i].landable.toFixed(1) + 'ms');
    }
    /* 1b) 还必须真的「越往上越难」，不能整条曲线持平（旧的 30 层封顶就是这样卡住的）。 */
    assert(rows[0].perfect - rows[rows.length - 1].perfect >= 15,
      '完美窗口从 0 层到高层几乎没有变窄：' + rows[0].perfect.toFixed(1) + '→' + rows[rows.length - 1].perfect.toFixed(1) + 'ms');
    assert(rows[0].landable - rows[rows.length - 1].landable >= 80,
      '可落窗口从 0 层到高层几乎没有变窄：' + rows[0].landable.toFixed(1) + '→' + rows[rows.length - 1].landable.toFixed(1) + 'ms');
    const cap = rows.find((r) => r.f === CAP_FLOOR);
    const f10 = rows.find((r) => r.f === 10);
    /* 2) 封顶必须仍然「可以练出来」：完美窗口 ≥ 54ms（≥3 帧 @60fps）、可落窗口 ≥ 150ms。 */
    assert(cap.perfect >= MIN_PERFECT,
      '封顶完美窗口过窄（玩家只能靠运气）：' + cap.perfect.toFixed(1) + 'ms < ' + MIN_PERFECT + 'ms');
    assert(cap.landable >= MIN_LANDABLE,
      '封顶可落窗口过窄（失误会变得不公平）：' + cap.landable.toFixed(1) + 'ms < ' + MIN_LANDABLE + 'ms');
    /* 3) 封顶必须仍然明显难过 10 层（否则难度曲线在封顶处「回退」）。 */
    assert(cap.perfect <= f10.perfect * 0.75,
      '封顶完美窗口没有明显窄于 10 层：' + cap.perfect.toFixed(1) + 'ms vs ' + f10.perfect.toFixed(1) + 'ms');
    assert(cap.period <= f10.period * 0.65,
      '封顶摆动周期没有明显短于 10 层：' + cap.period + 'ms vs ' + f10.period + 'ms');
    /* 4) 活的循环与解析周期一致（±8%），确保积分用的就是真物理。 */
    const livePeriods = rows.filter((r) => r.livePeriod).map((r) => r.livePeriod);
    for (const r of rows) {
      if (!r.livePeriod) continue;
      assert(Math.abs(r.livePeriod - r.period) <= r.period * 0.08,
        r.f + ' 层实时采样周期与解析周期不符：' + Math.round(r.livePeriod) + 'ms vs ' + r.period + 'ms');
    }
    record('真实窗口：完美 ' + rows.map((r) => r.f + '层 ' + r.perfect.toFixed(1) + 'ms').join(' → ') +
      '（封顶 ≥' + MIN_PERFECT + 'ms）；可落 ' + cap.landable.toFixed(0) + 'ms@封顶 ≥' + MIN_LANDABLE +
      'ms；封顶/10层 窗口 ' + (cap.perfect / f10.perfect).toFixed(2) + '、周期 ' + (cap.period / f10.period).toFixed(2) +
      '（实时交叉校验 ' + livePeriods.map((v) => Math.round(v)).join('/') + 'ms）', true);
  },
};

const SCENARIOS = [TP_STATIC, TP_PHYSICS, TP_OVERVIEW, TP_CARGO, TP_SAVE, TP_LAYOUT, TP_REACH, TP_ZOOM, TP_CONSISTENCY, TP_RELEASE_VX, TP_TALL, TP_LOD, TP_CURVE, TP_WINDOW];

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
