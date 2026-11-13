#!/usr/bin/env node
/**
 * Arcade 0.8.0 确定性玩法场景测试 runner（GP003 基座）。
 *
 * 零 npm 依赖，复用 tools/lib/arcade_cdp.mjs（静态服务器 / Chrome / CDP / 断言记录器）。
 * 每个场景使用固定初始状态 + 现有 #test 钩子（只读观察 + 状态机操作），不修改游戏文件；
 * 运行结果可复跑：同一场景用 --repeat=<n> 连续跑 n 遍，断言为结构不变量或 seed 精确复现
 * （证据摘要只记录稳定值，保证两遍输出一致）。
 *
 * 运行：
 *   node tools/arcade_gameplay_test.mjs                    # 跑全部场景
 *   node tools/arcade_gameplay_test.mjs --list             # 列出场景 ID / 标题 / 游戏
 *   node tools/arcade_gameplay_test.mjs --scenario=SC-SL-001 --scenario=SC-STAR-001
 *   node tools/arcade_gameplay_test.mjs --repeat=2         # 每个场景连跑 2 遍验证确定性
 *
 * 端口（避免与 arcade_smoke 的默认 8765/9333 冲突）：
 *   ARCADE_GAMEPLAY_PORT（默认 8766）/ ARCADE_GAMEPLAY_CDP_PORT（默认 9334）
 *
 * 场景协议见 docs/arcade/0.8.0-TESTING.md。
 * pending：场景对象可带 `pending: '原因'` —— 钩子尚未交付时在输出中打印 SKIP 而不是误报 PASS/FAIL；
 *   GP005/GP006 钩子稳定后删除 pending 字段即启用（显式 --scenario 指定 pending 场景同样 SKIP）。
 * 退出码：0 = 全部场景 PASS；1 = 至少一个场景 FAIL 或运行环境失败；2 = CLI 用法错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, createRecorder, envPort, launchChrome, openPage, sleep, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const ARTIFACTS = path.join(REPO_ROOT, 'test-artifacts');
const SERVER_PORT = envPort('ARCADE_GAMEPLAY_PORT', 8766);
const CDP_PORT = envPort('ARCADE_GAMEPLAY_CDP_PORT', 9334);
const BASE = `http://127.0.0.1:${SERVER_PORT}`;
const CHROME_PROFILE_PREFIX = 'studiokit-gameplay-';

const { record, assert, summary } = createRecorder();

const round1 = (value) => Math.round(value * 10) / 10;

/** 点击开始弹层按钮并等待游戏进入 playing（所有 13 款游戏共用同一弹层契约）。 */
async function startPlaying(cdp) {
  await cdp.click('[data-ov-btn]');
  await cdp.waitFor(
    'window.__arcadeTest && typeof window.__arcadeTest.joyInfo === "function" && window.__arcadeTest.joyInfo().state === "playing"',
    { timeout: 8000 }
  );
}

/** GP005 影之试炼：进入指定关卡并等待 state 进入 playing（钩子契约见 docs/arcade/0.8.0-TESTING.md 第 7 节）。 */
async function startTrialStage(cdp, index) {
  const started = await cdp.evaluate('window.__arcadeTest.startTrial(' + index + ')');
  assert(started === true, 'startTrial(' + index + ') 返回 ' + started);
  await cdp.waitFor('window.__arcadeTest.trialInfo().state === "playing"', { timeout: 6000 });
}

/** GP006 双路线：优先用 forceRoute(routeId) 固定路线；钩子名若变化需先与 shadow-dev 对齐（见文档 7.4）。 */
async function forceTrialRoute(cdp, routeId) {
  const hasForceRoute = await cdp.evaluate('typeof window.__arcadeTest.forceRoute === "function"');
  assert(hasForceRoute, 'GP006 缺少确定性路线钩子 forceRoute(routeId)，需与 shadow-dev 对齐后启用 SC-SL-007');
  const forced = await cdp.evaluate('window.__arcadeTest.forceRoute(' + JSON.stringify(routeId) + ')');
  assert(forced === true, 'forceRoute(' + routeId + ') 返回 ' + forced);
}

/* ============================================================================
 * 场景注册表：{ id, title, game, setup(cdp, base), run(cdp) }
 *
 * - id 稳定且永不复用：SC-<GAME>-<NNN>（影跃 SL / 星海 STAR / 极速车道 ROAD）。
 * - setup：固定初始状态（runner 已清空 localStorage 并以 `?gp003=<id>-<n>#test` 导航；
 *   setup 里只做“点击开始 / 强制落点 / 切关卡”等确定性进入动作）。
 * - run：读取 __arcadeTest 钩子，assert 失败即抛错；返回对象作为 PASS 行的证据摘要。
 * - 后续 GP005/GP006 关卡场景按同样结构追加，见 docs/arcade/0.8.0-TESTING.md。
 * ========================================================================== */
const SCENARIOS = [
  {
    id: 'SC-SL-001',
    title: '影跃·前 8 块教学平台不变量',
    game: 'shadow-leap.html',
    async setup(cdp) {
      /* 若 GP004+ 已提供 seed 钩子，用固定 seed 开经典局，让教学平台证据可逐次复现；
         否则退回普通开始流程，仅依赖结构不变量（向后兼容旧版页面）。 */
      const hasSeedHook = await cdp.evaluate('typeof window.__arcadeTest.startClassicWithSeed === "function"');
      if (hasSeedHook) {
        await cdp.evaluate('window.__arcadeTest.startClassicWithSeed(2024)');
        await cdp.waitFor('window.__arcadeTest.joyInfo().state === "playing"', { timeout: 5000 });
      } else {
        await startPlaying(cdp);
      }
    },
    async run(cdp) {
      const shadow = await cdp.evaluate('window.__arcadeTest.info()');
      assert(Array.isArray(shadow.platforms), '影跃 info().platforms 缺失');
      assert(shadow.platforms.length >= 10, '平台数量 ' + shadow.platforms.length + ' < 10');
      for (let i = 0; i <= 8; i += 1) {
        assert(shadow.platforms[i] && shadow.platforms[i].kind === 'normal', '教学平台 #' + i + ' 类型为 ' + (shadow.platforms[i] && shadow.platforms[i].kind) + '，应为 normal');
      }
      let minTeachingWidth = Infinity;
      for (let i = 1; i <= 8; i += 1) {
        minTeachingWidth = Math.min(minTeachingWidth, shadow.platforms[i].w);
        assert(shadow.platforms[i].w >= 100, '教学平台 #' + i + ' 宽度 ' + shadow.platforms[i].w + ' < 100');
      }
      let maxGap = 0;
      let maxCenterDelta = 0;
      let maxMovingRange = 0;
      for (let i = 1; i < shadow.platforms.length; i += 1) {
        const lower = shadow.platforms[i - 1];
        const upper = shadow.platforms[i];
        const gap = lower.y - upper.y;
        const centerDelta = Math.abs(lower.x + lower.w / 2 - (upper.x + upper.w / 2));
        maxGap = Math.max(maxGap, gap);
        maxCenterDelta = Math.max(maxCenterDelta, centerDelta);
        assert(gap > 0 && gap <= 118, '平台 #' + i + ' 垂直间距 ' + gap + ' 越界（0,118]');
        assert(centerDelta <= 121, '平台 #' + i + ' 水平中心偏移 ' + centerDelta + ' > 121');
        if (upper.kind === 'moving') {
          maxMovingRange = Math.max(maxMovingRange, upper.range || 0);
          assert((upper.range || 0) <= 30, '移动平台 #' + i + ' range=' + upper.range + ' > 30');
        }
      }
      return {
        platforms: shadow.platforms.length,
        teaching: 9,
        minTeachingWidth,
        maxGap: round1(maxGap),
        maxCenterDelta: round1(maxCenterDelta),
        maxMovingRange,
      };
    },
  },
  {
    id: 'SC-SL-002',
    title: '影跃·羽落/月弹道具状态机',
    game: 'shadow-leap.html',
    async setup(cdp) {
      await startPlaying(cdp);
    },
    async run(cdp) {
      const initial = await cdp.evaluate('(() => { const t = __arcadeTest; return { joy: t.joyInfo(), fall: t.fallInfo() }; })()');
      assert(initial.joy.state === 'playing', '初始状态不是 playing：' + initial.joy.state);
      assert(initial.joy.tools.feather === 2 && initial.joy.tools.boost === 2, '初始道具不是 2/2：' + JSON.stringify(initial.joy.tools));
      assert(initial.joy.featherActive === false && initial.joy.boostArmed === false, '初始不应有激活中的道具');

      /* 羽落：使用 1 次 → 计时器生效、下落重力降低；激活期间重复使用被拒绝。 */
      const feather = await cdp.evaluate(`(() => {
        const t = __arcadeTest;
        const used = t.useJoyTool('feather');
        const active = t.joyInfo();
        const repeat = t.useJoyTool('feather');
        const afterRepeat = t.joyInfo();
        const button = document.querySelector('[data-joy-tool="feather"]');
        t.setMotion(300);
        const fall = t.fallInfo();
        return { used, active, repeat, afterRepeat, button: { disabled: button.disabled, pressed: button.getAttribute('aria-pressed') }, fall };
      })()`);
      assert(feather.used === true, '羽落首次使用应成功');
      assert(feather.active.tools.feather === 1 && feather.active.featherActive === true && feather.active.featherTimer > 0, '羽落激活后状态错误：' + JSON.stringify(feather.active));
      assert(feather.repeat === false && feather.afterRepeat.tools.feather === 1 && feather.afterRepeat.featherActive === true, '羽落激活期间重复使用未被拒绝');
      assert(feather.button.disabled === true && feather.button.pressed === 'true', '羽落激活时按钮未进入禁用/激活态：' + JSON.stringify(feather.button));
      assert(
        feather.fall.feathering === true && Math.abs(feather.fall.gravity - feather.fall.baseGravity * 0.35) < 0.001 && feather.fall.maxFall === 360,
        '羽落下落参数错误：' + JSON.stringify(feather.fall)
      );

      /* 计时结束 → 自动恢复可用；用尽 2 次后按钮禁用且不能再消耗。 */
      await cdp.evaluate('__arcadeTest.setFeatherTimer(0.2)');
      await cdp.waitFor('__arcadeTest.joyInfo().featherTimer === 0', { timeout: 5000 });
      const expired = await cdp.evaluate(`(() => {
        const t = __arcadeTest;
        const joy = t.joyInfo();
        const button = document.querySelector('[data-joy-tool="feather"]');
        return { joy, disabled: button.disabled, pressed: button.getAttribute('aria-pressed') };
      })()`);
      assert(expired.joy.featherActive === false && expired.joy.tools.feather === 1, '羽落计时结束后未恢复：' + JSON.stringify(expired.joy));
      assert(expired.disabled === false && expired.pressed === 'false', '羽落计时结束后按钮未恢复可用：' + JSON.stringify(expired));
      const exhausted = await cdp.evaluate(`(() => {
        const t = __arcadeTest;
        const second = t.useJoyTool('feather');
        const afterSecond = t.joyInfo();
        const third = t.useJoyTool('feather');
        const afterThird = t.joyInfo();
        return { second, afterSecond, third, afterThird };
      })()`);
      assert(exhausted.second === true && exhausted.afterSecond.tools.feather === 0 && exhausted.afterSecond.featherActive === true, '羽落第 2 次使用状态错误：' + JSON.stringify(exhausted.afterSecond));
      assert(exhausted.third === false && exhausted.afterThird.tools.feather === 0, '羽落用尽后仍被消耗');

      /* 月弹：上弦 → 下一次着陆消耗；重复上弦被拒绝；着陆后强化跳（vy 明显更负）。 */
      const boost = await cdp.evaluate(`(() => {
        const t = __arcadeTest;
        t.setFeatherTimer(0);
        const used = t.useJoyTool('boost');
        const armed = t.joyInfo();
        const repeat = t.useJoyTool('boost');
        const afterRepeat = t.joyInfo();
        const button = document.querySelector('[data-joy-tool="boost"]');
        const forced = t.forceLand(1);
        return { used, armed, repeat, afterRepeat, button: { disabled: button.disabled, pressed: button.getAttribute('aria-pressed') }, forced };
      })()`);
      assert(boost.used === true && boost.armed.tools.boost === 1 && boost.armed.boostArmed === true, '月弹上弦状态错误：' + JSON.stringify(boost));
      assert(boost.repeat === false && boost.afterRepeat.tools.boost === 1 && boost.afterRepeat.boostArmed === true, '月弹上弦期间重复使用未被拒绝');
      assert(boost.button.disabled === true && boost.button.pressed === 'true', '月弹上弦时按钮未进入禁用/激活态：' + JSON.stringify(boost.button));
      assert(boost.forced === true, 'forceLand(1) 失败（教学平台不足）');
      const landed = await cdp.evaluate(`(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        return window.__arcadeTest.joyInfo();
      })()`);
      assert(landed.boostArmed === false, '月弹着陆后未消耗上弦状态');
      assert(landed.landingHint === '月弹！', '月弹着陆提示错误：' + landed.landingHint);
      assert(landed.player.vy < -400, '月弹强化跳速度不足：' + landed.player.vy);

      return {
        feather: '2→1→0',
        featherGravity: round1(feather.fall.gravity),
        featherMaxFall: feather.fall.maxFall,
        featherTimerExpired: true,
        boost: '2→1→0',
        boostLandingHint: landed.landingHint,
        boostJumped: landed.player.vy < -400,
      };
    },
  },
  {
    id: 'SC-SL-003',
    title: '影跃·种子复现 + 影冲单次动作',
    game: 'shadow-leap.html',
    async setup(cdp) {
      /* GP004 起提供：用固定 seed 开一局经典模式，平台布局可逐像素复现。 */
      const platforms = await cdp.evaluate('window.__arcadeTest.startClassicWithSeed(1234)');
      assert(Number.isInteger(platforms) && platforms > 0, 'startClassicWithSeed(1234) 返回平台数 ' + platforms);
      await cdp.waitFor('window.__arcadeTest.joyInfo().state === "playing"', { timeout: 5000 });
    },
    async run(cdp) {
      /* 1) seed() 生效；同一 seed 连续两次重生成得到完全一致的平台指纹。 */
      const replay = await cdp.evaluate(`(() => {
        const t = __arcadeTest;
        const fingerprint = () => t.info().platforms.map((p) => [p.x, p.y, p.w, p.kind, p.range || 0].join(':')).join('|');
        const applied = t.setSeed(1234);
        t.resetWithSeed(1234);
        const first = fingerprint();
        t.resetWithSeed(1234);
        const second = fingerprint();
        t.startClassicWithSeed(1234);
        return { applied, currentSeed: t.seed(), equal: first === second, platforms: t.info().platforms.length };
      })()`);
      assert(replay.applied === 1234, 'setSeed 归一化结果不是 1234：' + replay.applied);
      assert(replay.currentSeed === 1234, 'seed() 未返回当前种子：' + replay.currentSeed);
      assert(replay.equal === true, '同一 seed 两次重生成的平台布局不一致');
      assert(replay.platforms >= 10, '种子布局平台数 ' + replay.platforms + ' < 10');

      /* 2) 影冲：本跳可用 1 次 → 同帧第二次被拒绝 → 冲刺结束且水平位移生效。 */
      const dash = await cdp.evaluate(`(() => {
        const t = __arcadeTest;
        const before = t.dashInfo();
        const startX = t.joyInfo().player.x;
        const first = t.triggerDash();
        const immediately = t.dashInfo();
        const second = t.triggerDash();
        const afterSecond = t.dashInfo();
        return { before, startX, first, immediately, second, afterSecond };
      })()`);
      assert(dash.before.dashCharges === 1 && dash.before.dashing === false, '影冲初始充能状态错误：' + JSON.stringify(dash.before));
      assert(dash.before.state === 'playing', '影冲前状态不是 playing：' + dash.before.state);
      assert(dash.first === true, '影冲首次触发失败');
      assert(dash.immediately.dashCharges === 0 && dash.immediately.dashing === true && dash.immediately.dashTimer > 0, '影冲触发后状态错误：' + JSON.stringify(dash.immediately));
      assert(Math.abs(dash.immediately.vx) >= 600, '影冲速度未生效：' + dash.immediately.vx);
      assert(dash.second === false && dash.afterSecond.dashCharges === 0, '同一次跳跃内重复影冲未被拒绝');
      await cdp.waitFor('window.__arcadeTest.dashInfo().dashing === false', { timeout: 4000 });
      const moved = await cdp.evaluate('({ dash: __arcadeTest.dashInfo(), joy: __arcadeTest.joyInfo() })');
      const dx = round1(moved.joy.player.x - dash.startX);
      assert(moved.dash.dashing === false, '冲刺计时未结束');
      assert(dx >= 50, '影冲水平位移不足：' + dx + 'px');
      return {
        seed: replay.currentSeed,
        replayEqual: replay.equal,
        platforms: replay.platforms,
        dashChargesUsed: dash.before.dashCharges - dash.immediately.dashCharges,
        repeatDashRejected: dash.second === false,
        dashVx: Math.abs(dash.immediately.vx),
        dashTimer: Math.round(dash.immediately.dashTimer * 1000) / 1000,
        dashMoved: dx >= 50,
      };
    },
  },
  {
    id: 'SC-STAR-001',
    title: '星海突击·Boss 生成至清关闭环',
    game: 'star-raid.html',
    async setup(cdp) {
      await startPlaying(cdp);
    },
    async run(cdp) {
      const run = await cdp.evaluate(`(() => {
        const t = __arcadeTest;
        const before = t.info();
        const spawn = t.spawnBossNow();
        const cleared = t.damageBoss(999999);
        const hudStage = document.querySelector('[data-hud-stage]').textContent;
        const continued = t.continueClear();
        const after = t.info();
        return { before, spawn, cleared, hudStage, continued, after };
      })()`);
      assert(run.before.state === 'playing' && run.before.stage === 1, 'Boss 场景初始状态错误：' + JSON.stringify({ state: run.before.state, stage: run.before.stage }));
      assert(run.before.bossActive === false, '初始不应已有 Boss');
      assert(run.spawn.stage === 1 && run.spawn.bossActive === true, 'Boss 未生成：' + JSON.stringify({ stage: run.spawn.stage, bossActive: run.spawn.bossActive }));
      assert(run.spawn.bossHp > 0 && run.spawn.bossHp === run.spawn.bossMaxHp, 'Boss 初始血量错误：' + JSON.stringify({ hp: run.spawn.bossHp, maxHp: run.spawn.bossMaxHp }));
      assert(typeof run.spawn.bossName === 'string' && run.spawn.bossName.length > 0, 'Boss 缺少名称');
      assert(run.spawn.lives === run.before.lives, 'Boss 生成不应改变生命：' + JSON.stringify({ before: run.before.lives, spawn: run.spawn.lives }));
      assert(run.cleared.stage === 2 && run.cleared.state === 'clear', '清关后未进入第 2 关 CLEAR：' + JSON.stringify({ stage: run.cleared.stage, state: run.cleared.state }));
      assert(run.cleared.bossActive === false && run.cleared.bossHp === 0, '清关后 Boss 未移除：' + JSON.stringify({ bossActive: run.cleared.bossActive, hp: run.cleared.bossHp }));
      assert(run.cleared.score >= run.spawn.score + 500, '清关未加分：' + JSON.stringify({ before: run.spawn.score, after: run.cleared.score }));
      assert(run.cleared.lives === Math.min(5, run.spawn.lives + 1), '清关生命补给错误：' + JSON.stringify({ before: run.spawn.lives, after: run.cleared.lives }));
      assert(run.cleared.tools.pulse >= run.spawn.tools.pulse && run.cleared.tools.shield >= run.spawn.tools.shield, '清关道具补给回退：' + JSON.stringify({ before: run.spawn.tools, after: run.cleared.tools }));
      assert(run.hudStage === '2', '关卡 HUD 未更新为 2：' + run.hudStage);
      assert(run.continued === true && run.after.state === 'playing' && run.after.stage === 2 && run.after.bossActive === false, 'CLEAR 继续下一关失败：' + JSON.stringify({ continued: run.continued, state: run.after.state, stage: run.after.stage }));
      return {
        boss: run.spawn.bossName,
        bossHp: run.spawn.bossHp,
        scoreGain: run.cleared.score - run.spawn.score,
        lifeRestore: run.cleared.lives - run.spawn.lives,
        stage: run.spawn.stage + '→' + run.cleared.stage,
        hudStage: run.hudStage,
      };
    },
  },
  {
    id: 'SC-ROAD-001',
    title: '极速车道·stressSpawn(200) 安全走廊不变量',
    game: 'road-rush.html',
    async setup(cdp) {
      await startPlaying(cdp);
    },
    async run(cdp) {
      const start = await cdp.evaluate('window.__arcadeTest.info()');
      assert(start.state === 'playing', '极速车道未进入游玩态：' + start.state);
      assert(start.lane === 1, '初始车道应为 1，实际为 ' + start.lane);
      const first = await cdp.evaluate('window.__arcadeTest.stressSpawn(200)');
      const second = await cdp.evaluate('window.__arcadeTest.stressSpawn(200)');
      assert(first.violations === 0, '第 1 轮 stressSpawn(200) 安全走廊违规 ' + first.violations + ' 次');
      assert(second.violations === 0, '第 2 轮 stressSpawn(200) 安全走廊违规 ' + second.violations + ' 次');
      assert(first.spawned > 0, '第 1 轮未生成任何车辆');
      assert(first.cars <= 18 && second.cars <= 18, '车辆数越过上限：' + JSON.stringify({ round1: first.cars, round2: second.cars }));
      assert(Array.isArray(first.safe) && first.safe.length >= 1, '第 1 轮后没有安全车道：' + JSON.stringify(first.safe));
      assert(Array.isArray(second.safe) && second.safe.length >= 1, '第 2 轮后没有安全车道：' + JSON.stringify(second.safe));
      return {
        lane: start.lane,
        round1Violations: first.violations,
        round2Violations: second.violations,
        corridorPreserved: first.violations === 0 && second.violations === 0,
        spawnedCars: first.spawned > 0,
        carCapRespected: first.cars <= 18 && second.cars <= 18,
        safeLanePresent: first.safe.length >= 1 && second.safe.length >= 1,
      };
    },
  },
  /* ---------- GP005 影之试炼 S1–S3（trial stable 后删除 pending 启用） ---------- */
  {
    id: 'SC-SL-004',
    title: '影跃·试炼 S1 平台数 + startTrial/loadStage + 影门清关进下一关',
    game: 'shadow-leap.html',
    async setup(cdp) {
      await startTrialStage(cdp, 0);
    },
    async run(cdp) {
      const stages = await cdp.evaluate('window.__arcadeTest.stageList()');
      assert(Array.isArray(stages) && stages.length === 3, 'stageList 应有 3 关，实际 ' + (stages && stages.length));
      const stageIds = stages.map((stage) => stage.id).join(',');
      assert(stageIds === 'S1,S2,S3', '关卡 ID 不是 S1,S2,S3：' + stageIds);
      for (const stage of stages) {
        assert(typeof stage.index === 'number' && stage.start && stage.goal, '关卡摘要缺少 index/start/goal：' + JSON.stringify(stage));
        assert(Number.isFinite(stage.height) && stage.height >= 1500 && stage.height <= 2400, '关卡高度越界（1500–2400）：' + stage.height);
        assert(Number.isFinite(stage.goal.x) && Number.isFinite(stage.goal.y) && stage.goal.w > 0 && stage.goal.h > 0, '影门矩形异常：' + JSON.stringify(stage.goal));
      }

      /* startTrial(0) 进入 S1：mode/stageIndex/stageId 与平台数都要和 stageList 契约一致。 */
      const s1 = await cdp.evaluate('({ info: __arcadeTest.trialInfo(), platforms: __arcadeTest.stagePlatforms() })');
      assert(s1.info.mode === 'trial' && s1.info.stageIndex === 0 && s1.info.stageId === 'S1', 'startTrial(0) 后状态错误：' + JSON.stringify({ mode: s1.info.mode, stageIndex: s1.info.stageIndex, stageId: s1.info.stageId }));
      assert(Array.isArray(s1.platforms) && s1.platforms.length === stages[0].platforms, 'S1 平台数 ' + (s1.platforms && s1.platforms.length) + ' ≠ stageList ' + stages[0].platforms);
      for (const platform of s1.platforms) {
        assert(Number.isFinite(platform.x) && Number.isFinite(platform.y) && Number.isFinite(platform.w) && typeof platform.kind === 'string', 'S1 平台字段异常：' + JSON.stringify(platform));
      }
      assert(s1.platforms.every((platform) => platform.broken !== true), 'S1 初始不应有已碎平台');

      /* loadStage 状态机：S1 → S2 → S1，平台数同步切换。 */
      assert(await cdp.evaluate('window.__arcadeTest.loadStage(1)') === true, 'loadStage(1) 返回 false');
      const s2 = await cdp.evaluate('({ info: __arcadeTest.trialInfo(), platforms: __arcadeTest.stagePlatforms() })');
      assert(s2.info.stageIndex === 1 && s2.info.stageId === 'S2' && s2.info.state === 'playing', 'loadStage(1) 后状态错误：' + JSON.stringify({ stageIndex: s2.info.stageIndex, stageId: s2.info.stageId, state: s2.info.state }));
      assert(s2.platforms.length === stages[1].platforms, 'S2 平台数 ' + s2.platforms.length + ' ≠ stageList ' + stages[1].platforms);
      assert(await cdp.evaluate('window.__arcadeTest.loadStage(0)') === true, 'loadStage(0) 返回 false');

      /* 影门：forceReachGoal → cleared → 结算弹层主按钮点一下进入下一关。 */
      assert(await cdp.evaluate('window.__arcadeTest.forceReachGoal()') === true, 'forceReachGoal() 返回 false');
      await cdp.waitFor('window.__arcadeTest.trialInfo().state === "cleared"', { timeout: 5000 });
      const cleared = await cdp.evaluate(`({
        info: __arcadeTest.trialInfo(),
        title: document.querySelector('[data-ov-title]').textContent,
        btn: document.querySelector('[data-ov-btn]').textContent,
        overlay: !document.querySelector('[data-overlay]').hidden
      })`);
      assert(cleared.info.cleared === true && cleared.info.stageIndex === 0 && cleared.info.stageId === 'S1', '清关后 trialInfo 错误：' + JSON.stringify({ cleared: cleared.info.cleared, stageIndex: cleared.info.stageIndex, stageId: cleared.info.stageId }));
      assert(cleared.overlay === true && cleared.title.includes('影门开启'), '清关弹层标题错误：' + JSON.stringify({ overlay: cleared.overlay, title: cleared.title }));
      assert(cleared.btn.includes('下一关'), 'S1 清关主按钮不是「下一关」：' + cleared.btn);
      assert(Array.isArray(cleared.info.results) && cleared.info.results.length === 1 && cleared.info.results[0].id === 'S1', '清关结果未记录 S1：' + JSON.stringify(cleared.info.results));
      assert(Number.isFinite(cleared.info.results[0].time) && cleared.info.results[0].time >= 0, 'S1 清关用时异常：' + JSON.stringify(cleared.info.results[0]));
      await cdp.click('[data-ov-btn]');
      await cdp.waitFor('window.__arcadeTest.trialInfo().state === "playing" && window.__arcadeTest.trialInfo().stageIndex === 1', { timeout: 6000 });
      const next = await cdp.evaluate('window.__arcadeTest.trialInfo()');
      assert(next.stageId === 'S2', '清关后下一关不是 S2：' + next.stageId);
      return {
        stages: stages.length,
        s1Platforms: s1.platforms.length,
        s2Platforms: s2.platforms.length,
        clearedTitle: cleared.title,
        results: cleared.info.results.length,
        nextStage: next.stageId,
      };
    },
  },
  {
    id: 'SC-SL-005',
    title: '影跃·试炼失足失败与 1 次点击重试回本关起点',
    game: 'shadow-leap.html',
    async setup(cdp) {
      await startTrialStage(cdp, 0);
    },
    async run(cdp) {
      const stages = await cdp.evaluate('window.__arcadeTest.stageList()');
      const startPoint = stages[0].start;
      assert(await cdp.evaluate('window.__arcadeTest.forceFall()') === true, 'forceFall() 返回 false');
      await cdp.waitFor('window.__arcadeTest.trialInfo().state === "over"', { timeout: 5000 });
      const failed = await cdp.evaluate(`({
        info: __arcadeTest.trialInfo(),
        title: document.querySelector('[data-ov-title]').textContent,
        btn: document.querySelector('[data-ov-btn]').textContent,
        overlay: !document.querySelector('[data-overlay]').hidden
      })`);
      assert(failed.info.stageIndex === 0 && failed.info.stageId === 'S1', '失败后关卡状态错误：' + JSON.stringify({ stageIndex: failed.info.stageIndex, stageId: failed.info.stageId }));
      assert(failed.overlay === true && failed.title.includes('失足'), '失败弹层标题错误：' + JSON.stringify({ overlay: failed.overlay, title: failed.title }));
      assert(failed.btn.includes('从本关起点重试'), '失败主按钮不是「从本关起点重试」：' + failed.btn);
      /* 失败弹层只点 1 次主按钮即重开本关（不刷新、二次确认）。 */
      await cdp.click('[data-ov-btn]');
      await cdp.waitFor('window.__arcadeTest.trialInfo().state === "playing"', { timeout: 6000 });
      const retried = await cdp.evaluate('window.__arcadeTest.trialInfo()');
      assert(retried.stageIndex === 0 && retried.stageId === 'S1', '重试后关卡不是 S1：' + JSON.stringify({ stageIndex: retried.stageIndex, stageId: retried.stageId }));
      assert(Math.abs(retried.player.x - startPoint.x) <= 5, '重试后玩家 x 未回到起点：' + JSON.stringify({ x: retried.player.x, startX: startPoint.x }));
      assert(Math.abs(retried.player.y - startPoint.y) <= 140, '重试后玩家 y 未回到起点附近：' + JSON.stringify({ y: retried.player.y, startY: startPoint.y }));
      assert(Number.isFinite(retried.elapsed) && retried.elapsed < 5, '重试后本关计时未重置：' + retried.elapsed);
      return {
        failTitle: failed.title,
        retryClicks: 1,
        stageAfterRetry: retried.stageId,
        backToStart: true,
        elapsedReset: true,
      };
    },
  },
  {
    id: 'SC-SL-006',
    title: '影跃·试炼暂停刷新恢复 + 旧经典档缺 mode 仍经典',
    game: 'shadow-leap.html',
    async setup(cdp) {
      await startTrialStage(cdp, 0);
      assert(await cdp.evaluate('window.__arcadeTest.loadStage(1)') === true, 'loadStage(1) 返回 false');
      await cdp.waitFor('window.__arcadeTest.trialInfo().state === "playing"', { timeout: 6000 });
    },
    async run(cdp) {
      /* 1) 试炼 S2 暂停 → 刷新页面 → 续玩恢复 mode/stageIndex。 */
      await cdp.click('[data-pause]');
      await cdp.waitFor('window.__arcadeTest.trialInfo().state === "paused"', { timeout: 5000 });
      const paused = await cdp.evaluate('window.__arcadeTest.trialInfo()');
      assert(paused.mode === 'trial' && paused.stageIndex === 1 && paused.stageId === 'S2', '暂停时试炼状态错误：' + JSON.stringify({ mode: paused.mode, stageIndex: paused.stageIndex, stageId: paused.stageId }));

      await cdp.navigate(BASE + '/apps/arcade/games/shadow-leap.html?gp005-resume=1#test');
      const resumeTitle = await cdp.text('[data-ov-title]');
      assert(resumeTitle && resumeTitle.includes('继续'), '试炼局刷新后未显示续玩提示：' + resumeTitle);
      await cdp.click('[data-ov-btn]');
      await cdp.waitFor('window.__arcadeTest.trialInfo().state === "playing"', { timeout: 6000 });
      const resumed = await cdp.evaluate('window.__arcadeTest.trialInfo()');
      assert(resumed.mode === 'trial' && resumed.stageIndex === 1 && resumed.stageId === 'S2', '刷新恢复后试炼状态错误：' + JSON.stringify({ mode: resumed.mode, stageIndex: resumed.stageIndex, stageId: resumed.stageId }));
      assert(Number.isFinite(resumed.elapsed) && resumed.elapsed >= 0, '刷新恢复后计时异常：' + resumed.elapsed);
      assert(resumed.player && Number.isFinite(resumed.player.x) && Number.isFinite(resumed.player.y), '刷新恢复后玩家状态异常：' + JSON.stringify(resumed.player));

      /* 2) 旧经典档（缺 mode/stageIndex/trial* 字段）仍按经典模式恢复，不进入试炼。 */
      await cdp.evaluate("(() => { Arcade.RunSave.clear('shadow-leap'); window.__arcadeTest.startClassicWithSeed(7); })()");
      await cdp.waitFor('window.__arcadeTest.joyInfo().state === "playing"', { timeout: 5000 });
      const classicRaw = await cdp.evaluate("localStorage.getItem('studiokit:arcade:runs:v1')");
      const payload = JSON.parse(classicRaw);
      const classicRecord = payload.games && payload.games['shadow-leap'];
      assert(classicRecord && classicRecord.data, '未能生成用于旧档回归的 classic 存档');
      delete classicRecord.data.mode;
      delete classicRecord.data.stageIndex;
      delete classicRecord.data.trialElapsed;
      delete classicRecord.data.trialScrolls;
      delete classicRecord.data.trialResults;
      delete classicRecord.data.trialDashes;
      const legacyRaw = JSON.stringify(payload);
      /* 先在非游玩态页面写回剥离后的旧档，避免页面离开时自动存档把新字段写回。 */
      await cdp.navigate(BASE + '/apps/arcade/games/shadow-leap.html?gp005-oldsave-prepare=1');
      await cdp.evaluate('localStorage.setItem("studiokit:arcade:runs:v1", ' + JSON.stringify(legacyRaw) + ')');
      await cdp.navigate(BASE + '/apps/arcade/games/shadow-leap.html?gp005-oldsave=1#test');
      const oldTitle = await cdp.text('[data-ov-title]');
      assert(oldTitle && oldTitle.includes('继续'), '旧经典档刷新后未显示续玩提示：' + oldTitle);
      await cdp.click('[data-ov-btn]');
      await cdp.waitFor('window.__arcadeTest.joyInfo().state === "playing"', { timeout: 6000 });
      const legacy = await cdp.evaluate('window.__arcadeTest.trialInfo()');
      assert(legacy.mode === 'classic' && legacy.stageId === null, '旧经典档缺 mode 未按经典恢复：' + JSON.stringify({ mode: legacy.mode, stageId: legacy.stageId }));
      await cdp.evaluate('localStorage.clear()');
      return {
        resumedMode: resumed.mode,
        resumedStageId: resumed.stageId,
        legacyMode: legacy.mode,
        legacyStageId: legacy.stageId,
      };
    },
  },
  /* ---------- GP006 试炼双路线 / 复盘（GP006 trial stable 后删除 pending 启用） ---------- */
  {
    id: 'SC-SL-007',
    title: '影跃·试炼 S2 双路线判定与结算路线标签',
    game: 'shadow-leap.html',
    async setup(cdp) {
      await startTrialStage(cdp, 1);
    },
    async run(cdp) {
      const stages = await cdp.evaluate('window.__arcadeTest.stageList()');
      const s2 = stages[1];
      assert(s2 && s2.id === 'S2', 'S2 关卡摘要缺失：' + JSON.stringify(stages && stages.map((stage) => stage.id)));
      const before = await cdp.evaluate('window.__arcadeTest.trialInfo()');
      assert(Array.isArray(before.routes) && before.routes.length >= 2, 'trialInfo().routes 不包含两条路线：' + JSON.stringify(before.routes));
      assert(before.scrollsTotal === s2.scrolls && Array.isArray(before.scrollsCollected), 'trialInfo 卷轴计数字段异常：' + JSON.stringify({ total: before.scrollsTotal, collected: before.scrollsCollected }));

      /* safe 路线：强制走稳妥长路 → 结算文案必须显示「稳妥长路」。 */
      assert(await cdp.evaluate('window.__arcadeTest.loadStage(1)') === true, 'loadStage(1) 返回 false');
      await forceTrialRoute(cdp, 'safe');
      assert(await cdp.evaluate('window.__arcadeTest.forceReachGoal()') === true, 'forceReachGoal() 返回 false');
      await cdp.waitFor('window.__arcadeTest.trialInfo().state === "cleared"', { timeout: 5000 });
      const safeCleared = await cdp.evaluate(`({
        info: __arcadeTest.trialInfo(),
        title: document.querySelector('[data-ov-title]').textContent,
        text: document.querySelector('[data-ov-text]').textContent
      })`);
      assert(safeCleared.title.includes('影门开启'), 'S2 safe 路线清关标题错误：' + safeCleared.title);
      assert(safeCleared.text.includes('稳妥长路'), 'S2 safe 路线结算未显示「稳妥长路」：' + safeCleared.text);
      assert(safeCleared.info.route === 'safe' || JSON.stringify(safeCleared.info.routeInfo || {}).includes('safe'), 'trialInfo 路线字段未记录 safe：' + JSON.stringify({ route: safeCleared.info.route, routeInfo: safeCleared.info.routeInfo }));

      /* fast 路线：同一关重开后强制走近路快线 → 结算显示「近路快线」。 */
      assert(await cdp.evaluate('window.__arcadeTest.loadStage(1)') === true, '第二次 loadStage(1) 返回 false');
      await forceTrialRoute(cdp, 'fast');
      assert(await cdp.evaluate('window.__arcadeTest.forceReachGoal()') === true, 'forceReachGoal() 返回 false');
      await cdp.waitFor('window.__arcadeTest.trialInfo().state === "cleared"', { timeout: 5000 });
      const fastCleared = await cdp.evaluate(`({
        info: __arcadeTest.trialInfo(),
        title: document.querySelector('[data-ov-title]').textContent,
        text: document.querySelector('[data-ov-text]').textContent
      })`);
      assert(fastCleared.text.includes('近路快线'), 'S2 fast 路线结算未显示「近路快线」：' + fastCleared.text);
      assert(fastCleared.info.route === 'fast' || JSON.stringify(fastCleared.info.routeInfo || {}).includes('fast'), 'trialInfo 路线字段未记录 fast：' + JSON.stringify({ route: fastCleared.info.route, routeInfo: fastCleared.info.routeInfo }));
      return { routes: before.routes.length, safeLabel: '稳妥长路', fastLabel: '近路快线', safeRoute: safeCleared.info.route, fastRoute: fastCleared.info.route };
    },
  },
  {
    id: 'SC-SL-008',
    title: '影跃·试炼失败复盘文案与卷轴可选语义',
    game: 'shadow-leap.html',
    async setup(cdp) {
      await startTrialStage(cdp, 1);
    },
    async run(cdp) {
      const stages = await cdp.evaluate('window.__arcadeTest.stageList()');
      const s2 = stages[1];
      const base = await cdp.evaluate('window.__arcadeTest.trialInfo()');
      assert(base.scrollsTotal === s2.scrolls, 'S2 scrollsTotal 与 stageList 不一致：' + JSON.stringify({ total: base.scrollsTotal, list: s2.scrolls }));
      assert(Array.isArray(base.scrollsCollected) && base.scrollsCollected.length === 0, 'S2 初始不应已收集卷轴：' + JSON.stringify(base.scrollsCollected));
      assert(await cdp.evaluate('window.__arcadeTest.forceCollectScroll(0)') === true, 'forceCollectScroll(0) 返回 false');
      await cdp.waitFor('window.__arcadeTest.trialInfo().scrollsCollected.length === 1', { timeout: 4000 });
      const collected = await cdp.evaluate('window.__arcadeTest.trialInfo()');
      assert(collected.scrollsCollected.length === 1 && collected.scrolls.length === 1, '卷轴收集未记录：' + JSON.stringify({ collected: collected.scrollsCollected, scrolls: collected.scrolls }));

      /* 失败复盘：失足弹层给出本轮卷轴信息，并明确卷轴可选、不影响通关。 */
      assert(await cdp.evaluate('window.__arcadeTest.forceFall()') === true, 'forceFall() 返回 false');
      await cdp.waitFor('window.__arcadeTest.trialInfo().state === "over"', { timeout: 5000 });
      const failed = await cdp.evaluate(`({
        title: document.querySelector('[data-ov-title]').textContent,
        text: document.querySelector('[data-ov-text]').textContent
      })`);
      assert(failed.title.includes('失足'), '失败弹层标题错误：' + failed.title);
      assert(failed.text.includes('卷轴') && (failed.text.includes('可选') || failed.text.includes('不影响')), '失败复盘未说明卷轴可选：' + failed.text);
      assert(String(failed.text).length > 10, '失败复盘文案为空：' + failed.text);

      /* 未收集卷轴也能通关：卷轴只是探索记录，不影响胜负。 */
      assert(await cdp.evaluate('window.__arcadeTest.loadStage(1)') === true, 'loadStage(1) 返回 false');
      assert((await cdp.evaluate('window.__arcadeTest.trialInfo().scrollsCollected.length')) === 0, '重开本关后卷轴未清零');
      assert(await cdp.evaluate('window.__arcadeTest.forceReachGoal()') === true, 'forceReachGoal() 返回 false');
      await cdp.waitFor('window.__arcadeTest.trialInfo().state === "cleared"', { timeout: 5000 });
      const cleared = await cdp.evaluate('window.__arcadeTest.trialInfo()');
      assert(cleared.state === 'cleared' && cleared.cleared === true, '未收集卷轴无法清关：' + JSON.stringify({ state: cleared.state, cleared: cleared.cleared }));
      const result = cleared.results.find((item) => item.id === 'S2');
      assert(result && result.scrolls === 0, '未收集卷轴的结算记录异常：' + JSON.stringify(cleared.results));
      return { scrollsTotal: base.scrollsTotal, collected: collected.scrolls.length, failReview: true, clearedWithoutScroll: true };
    },
  },
  /* ---------- GP004 确定性用例补全：落地补充 / 暂停重载 / 旧档恢复 ---------- */
  {
    id: 'SC-SL-009',
    title: '影跃·影冲落地补充/暂停刷新/旧档恢复',
    game: 'shadow-leap.html',
    async setup(cdp) {
      await cdp.evaluate('window.__arcadeTest.startClassicWithSeed(4321)');
      await cdp.waitFor('window.__arcadeTest.joyInfo().state === "playing"', { timeout: 6000 });
    },
    async run(cdp) {
      /* 1) 空中：本跳只有 1 次影冲；同一次腾空第二次被拒绝。 */
      const air = await cdp.evaluate(`(() => {
        const t = __arcadeTest;
        const before = t.dashInfo();
        const first = t.triggerDash();
        const during = t.dashInfo();
        const second = t.triggerDash();
        const afterSecond = t.dashInfo();
        return { before, first, during, second, afterSecond };
      })()`);
      assert(air.before.dashCharges === 1 && air.before.dashing === false, '影冲初始状态错误：' + JSON.stringify(air.before));
      assert(air.first === true && air.during.dashCharges === 0 && air.during.dashing === true, '空中影冲未消耗/未生效：' + JSON.stringify(air.during));
      assert(air.second === false && air.afterSecond.dashCharges === 0, '空中第二次影冲未被拒绝：' + JSON.stringify(air.afterSecond));

      /* 2) 落地补充：forceLand 立即终止冲刺并补满 1 次，可再次触发一次。 */
      const landed = await cdp.evaluate(`(async () => {
        const t = __arcadeTest;
        const forced = t.forceLand(1);
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        return { forced, info: t.dashInfo() };
      })()`);
      assert(landed.forced === true, 'forceLand(1) 失败');
      assert(landed.info.dashCharges === 1 && landed.info.dashing === false, '落地未补满影冲/未终止冲刺：' + JSON.stringify(landed.info));
      const reuse = await cdp.evaluate(`(() => {
        const t = __arcadeTest;
        const used = t.triggerDash();
        const info = t.dashInfo();
        const again = t.triggerDash();
        return { used, info, again, afterAgain: t.dashInfo() };
      })()`);
      assert(reuse.used === true && reuse.info.dashCharges === 0 && reuse.again === false, '落地后影冲未重新可用或可重复触发：' + JSON.stringify(reuse));

      /* 3) 暂停冻结：再次 forceLand 补满后，同一 JS turn 内触发影冲并暂停，dashCharges=0 且 dashTimer 冻结。
         （不等待自然落地：影冲会横向移动，固定步长下多次运行的落点可能不同，forceLand 保证确定性。） */
      const paused = await cdp.evaluate(`(async () => {
        const t = __arcadeTest;
        t.forceLand(1);
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        const landedAgain = t.dashInfo();
        const used = t.triggerDash();
        document.querySelector('[data-pause]').click();
        return { landedAgain, used, info: t.dashInfo() };
      })()`);
      assert(paused.landedAgain.dashCharges === 1, '第二次 forceLand 后未补满影冲：' + JSON.stringify(paused.landedAgain));
      assert(paused.used === true && paused.info.state === 'paused' && paused.info.dashCharges === 0, '暂停瞬间影冲状态错误：' + JSON.stringify(paused.info));
      await sleep(350);
      const frozen = await cdp.evaluate('window.__arcadeTest.dashInfo()');
      assert(frozen.state === 'paused' && frozen.dashTimer === paused.info.dashTimer, '暂停期间 dashTimer 未冻结：' + JSON.stringify({ before: paused.info.dashTimer, after: frozen.dashTimer }));

      /* 刷新 → 继续上次：暂停时 charge=0，恢复后仍为 0。 */
      await cdp.navigate(BASE + '/apps/arcade/games/shadow-leap.html?gp004-dashresume=1#test');
      const resumeTitle = await cdp.text('[data-ov-title]');
      assert(resumeTitle && resumeTitle.includes('继续'), '影冲暂停后刷新未显示续玩提示：' + resumeTitle);
      await cdp.click('[data-ov-btn]');
      await cdp.waitFor('window.__arcadeTest.joyInfo().state === "playing"', { timeout: 6000 });
      const resumed = await cdp.evaluate('window.__arcadeTest.dashInfo()');
      assert(resumed.dashCharges === 0, '刷新恢复后 dashCharges 与暂停前不一致：' + JSON.stringify({ paused: paused.info.dashCharges, resumed: resumed.dashCharges }));

      /* 4) charge=1 的存档恢复：经典开局（未消耗）→ 暂停 → 刷新继续 → 仍为 1。 */
      await cdp.evaluate("(() => { Arcade.RunSave.clear('shadow-leap'); window.__arcadeTest.startClassicWithSeed(5555); })()");
      await cdp.waitFor('window.__arcadeTest.dashInfo().dashCharges === 1', { timeout: 5000 });
      await cdp.click('[data-pause]');
      await cdp.waitFor('window.__arcadeTest.dashInfo().state === "paused"', { timeout: 4000 });
      const chargeOne = await cdp.evaluate('window.__arcadeTest.dashInfo()');
      assert(chargeOne.dashCharges === 1, 'charge=1 存档暂停时状态错误：' + JSON.stringify(chargeOne));
      await cdp.navigate(BASE + '/apps/arcade/games/shadow-leap.html?gp004-dashresume2=1#test');
      await cdp.waitFor('document.querySelector("[data-ov-title]") && document.querySelector("[data-ov-title]").textContent.includes("继续")', { timeout: 5000 });
      await cdp.click('[data-ov-btn]');
      await cdp.waitFor('window.__arcadeTest.joyInfo().state === "playing"', { timeout: 6000 });
      const resumedOne = await cdp.evaluate('window.__arcadeTest.dashInfo()');
      assert(resumedOne.dashCharges === 1, 'charge=1 存档恢复后 dashCharges 不是 1：' + JSON.stringify(resumedOne));

      /* 5) 旧档：删除 data.dashCharges/dashTimer 后刷新，按初始 1 次恢复。 */
      await cdp.evaluate("(() => { Arcade.RunSave.clear('shadow-leap'); window.__arcadeTest.startClassicWithSeed(7777); })()");
      await cdp.waitFor('window.__arcadeTest.joyInfo().state === "playing"', { timeout: 5000 });
      const classicRaw = await cdp.evaluate("localStorage.getItem('studiokit:arcade:runs:v1')");
      const payload = JSON.parse(classicRaw);
      const classicRecord = payload.games && payload.games['shadow-leap'];
      assert(classicRecord && classicRecord.data, '未能生成用于旧档回归的 classic 存档');
      delete classicRecord.data.dashCharges;
      delete classicRecord.data.dashTimer;
      delete classicRecord.data.dashDir;
      const legacyRaw = JSON.stringify(payload);
      await cdp.navigate(BASE + '/apps/arcade/games/shadow-leap.html?gp004-olddash-prepare=1');
      await cdp.evaluate('localStorage.setItem("studiokit:arcade:runs:v1", ' + JSON.stringify(legacyRaw) + ')');
      await cdp.navigate(BASE + '/apps/arcade/games/shadow-leap.html?gp004-olddash=1#test');
      const oldTitle = await cdp.text('[data-ov-title]');
      assert(oldTitle && oldTitle.includes('继续'), '旧档刷新后未显示续玩提示：' + oldTitle);
      await cdp.click('[data-ov-btn]');
      await cdp.waitFor('window.__arcadeTest.joyInfo().state === "playing"', { timeout: 6000 });
      const legacy = await cdp.evaluate('window.__arcadeTest.dashInfo()');
      assert(legacy.dashCharges === 1 && legacy.dashTimer === 0, '旧档缺 dashCharges 未按初始 1 次恢复：' + JSON.stringify(legacy));
      await cdp.evaluate('localStorage.clear()');
      return {
        airDashFirst: air.first,
        airSecondRejected: air.second === false,
        landingRecharge: landed.info.dashCharges === 1,
        landingReuse: reuse.used === true,
        pauseCharge: paused.info.dashCharges,
        dashTimerFrozen: frozen.dashTimer === paused.info.dashTimer,
        resumeCharge: resumed.dashCharges,
        resumeChargeOne: resumedOne.dashCharges,
        legacyCharge: legacy.dashCharges,
        legacyTimer: legacy.dashTimer,
      };
    },
  },
];

/* ---------- CLI ---------- */
function printUsage() {
  console.log(`用法：node tools/arcade_gameplay_test.mjs [选项]

  --list                  列出全部场景 ID / 标题 / 游戏（不启动 Chrome）
  --scenario=<id>         只跑指定场景；可重复传入多个
  --repeat=<n>            每个场景连续跑 n 遍（默认 1，n>=1），用于确定性复跑
  --help                  显示本帮助

端口（避免与 arcade_smoke 默认端口冲突）：
  ARCADE_GAMEPLAY_PORT      本地静态服务器，默认 8766
  ARCADE_GAMEPLAY_CDP_PORT  Chrome DevTools 端口，默认 9334
  CHROME_PATH               自定义 Chrome 可执行文件路径`);
}

function parseRepeat(raw) {
  const repeat = Number(raw);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) throw new UsageError('--repeat 需要 1-20 的整数，当前为 ' + JSON.stringify(raw));
  return repeat;
}

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { help: false, list: false, repeat: 1, scenarioIds: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--list' || arg === '-l') {
      options.list = true;
    } else if (arg === '--scenario') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new UsageError('--scenario 需要一个场景 ID');
      options.scenarioIds.push(value);
      i += 1;
    } else if (arg.startsWith('--scenario=')) {
      const value = arg.slice('--scenario='.length);
      if (!value) throw new UsageError('--scenario= 不能为空');
      options.scenarioIds.push(value);
    } else if (arg === '--repeat') {
      options.repeat = parseRepeat(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--repeat=')) {
      options.repeat = parseRepeat(arg.slice('--repeat='.length));
    } else {
      throw new UsageError('未知参数：' + arg + '（用 --help 查看用法）');
    }
  }
  return options;
}

function selectScenarios(scenarioIds) {
  if (!scenarioIds.length) return SCENARIOS;
  const byId = new Map(SCENARIOS.map((scenario) => [scenario.id, scenario]));
  const selected = [];
  for (const id of scenarioIds) {
    const scenario = byId.get(id);
    if (!scenario) {
      throw new UsageError('未知场景 ID：' + id + '\n可用场景：' + SCENARIOS.map((item) => item.id).join(', '));
    }
    if (!selected.includes(scenario)) selected.push(scenario);
  }
  return selected;
}

function printList() {
  const activeCount = SCENARIOS.filter((scenario) => !scenario.pending).length;
  console.log('可用确定性场景（' + SCENARIOS.length + ' 个，其中启用 ' + activeCount + '）：');
  for (const scenario of SCENARIOS) {
    console.log('  ' + scenario.id.padEnd(12) + scenario.title + '  [' + scenario.game + ']' + (scenario.pending ? '  [PENDING]' : ''));
  }
}

/* ---------- 场景执行 ---------- */
function formatValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return '[' + value.map(formatValue).join(',') + ']';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatEvidence(evidence) {
  if (evidence === undefined || evidence === null) return '';
  if (typeof evidence === 'string') return evidence;
  return Object.entries(evidence)
    .map(([key, value]) => key + '=' + formatValue(value))
    .join(', ');
}

/** 每个场景从固定初始状态开始：清空本机存档 → 带 #test 钩子重新加载游戏页。 */
async function prepareScenario(cdp, scenario, attempt) {
  await cdp.navigate(BASE + '/apps/arcade/');
  await cdp.evaluate('localStorage.clear()');
  const url = BASE + '/apps/arcade/games/' + scenario.game + '?gp003=' + encodeURIComponent(scenario.id + '-' + attempt) + '#test';
  await cdp.navigate(url);
  const ready = await cdp.evaluate(`({
    hasArcade: !!window.Arcade,
    hasTestHooks: !!window.__arcadeTest,
    hasOverlay: !!document.querySelector('[data-overlay]'),
    hash: location.hash
  })`);
  assert(ready.hasArcade, scenario.id + '：Arcade 运行时未加载');
  assert(ready.hasTestHooks, scenario.id + '：#test 钩子缺失（页面可能被改动，或 URL 未携带 #test）');
  assert(ready.hasOverlay, scenario.id + '：开始弹层缺失');
  assert(ready.hash === '#test', scenario.id + '：URL hash 不是 #test（' + ready.hash + '）');
}

async function runScenario(cdp, scenario, attempt) {
  try {
    await prepareScenario(cdp, scenario, attempt);
    if (typeof scenario.setup === 'function') await scenario.setup(cdp, BASE);
    if (cdp.errors.length) throw new Error('页面加载/初始化报错：' + cdp.errors.join(' | '));
    const evidence = await scenario.run(cdp);
    if (cdp.errors.length) throw new Error('场景运行期间页面报错：' + cdp.errors.join(' | '));
    try {
      await cdp.screenshot('gameplay-' + scenario.id + (attempt > 1 ? '-r' + attempt : '') + '.png');
    } catch (err) {
      /* 截图失败不影响场景判定 */
    }
    record(scenario.id + ' ' + scenario.title, true, formatEvidence(evidence));
    return true;
  } catch (err) {
    record(scenario.id + ' ' + scenario.title, false, err.message);
    return false;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  if (options.list) {
    printList();
    return;
  }
  const selected = selectScenarios(options.scenarioIds);
  const activeScenarios = selected.filter((scenario) => !scenario.pending);
  const pendingScenarios = selected.filter((scenario) => scenario.pending);
  fs.mkdirSync(ARTIFACTS, { recursive: true });

  console.log(
    '# Arcade 确定性玩法场景 · ' +
      activeScenarios.length +
      ' 个启用' +
      (pendingScenarios.length ? ' / ' + pendingScenarios.length + ' 个 pending' : '') +
      ' × ' +
      options.repeat +
      ' 遍'
  );
  console.log('# 静态服务器 http://127.0.0.1:' + SERVER_PORT + ' · CDP 端口 ' + CDP_PORT + ' · 截图 ' + path.relative(REPO_ROOT, ARTIFACTS));
  for (const scenario of activeScenarios) console.log('# ' + scenario.id + ' ' + scenario.title + ' [' + scenario.game + ']');
  for (const scenario of pendingScenarios) console.log('SKIP  ' + scenario.id + ' ' + scenario.title + ' — ' + scenario.pending);
  console.log('');
  if (!activeScenarios.length) {
    const outcome = summary('scenario runs');
    if (outcome.failed) process.exitCode = 1;
    return;
  }

  let server = null;
  let launched = null;
  let cdp = null;
  try {
    server = await startServer({ root: REPO_ROOT, port: SERVER_PORT });
    launched = await launchChrome({ port: CDP_PORT, profilePrefix: CHROME_PROFILE_PREFIX });
    cdp = await openPage({
      port: CDP_PORT,
      width: 420,
      height: 900,
      deviceScaleFactor: 1,
      mobile: true,
      artifactsDir: ARTIFACTS,
    });
    for (const scenario of activeScenarios) {
      for (let attempt = 1; attempt <= options.repeat; attempt += 1) {
        await runScenario(cdp, scenario, attempt);
        await sleep(80);
      }
    }
  } finally {
    if (cdp) cdp.close();
    if (server) server.close();
    await stopChrome(launched || {});
  }

  const outcome = summary('scenario runs');
  if (outcome.failed) process.exitCode = 1;
}

main().catch((err) => {
  if (err instanceof UsageError) {
    console.error('用法错误：' + err.message);
    process.exitCode = 2;
    return;
  }
  console.error('GAMEPLAY TEST FAILED:', err.stack || err);
  process.exitCode = 1;
});
