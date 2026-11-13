#!/usr/bin/env node
/**
 * Arcade 0.9 确定性玩法场景 runner（0.8 GP003 基座 + 0.9 T056 挑战聚合器）。
 *
 * 零 npm 依赖，复用 tools/lib/arcade_cdp.mjs（静态服务器 / Chrome / CDP / 断言记录器）。
 * 场景分两层：
 *   - base：内置 11 个 0.8 确定性场景（seed 复现、道具状态机、Boss 闭环、影之试炼 S1–S3 等）；
 *   - challenge：0.9 挑战模式。内置全局门禁 CH-DATA-001（78 关数据审计）与
 *     CH-CLASSIC-001（13 游戏经典入口回归），并自动发现 tools/challenge/*.mjs 游戏场景模块
 *     （每个模块默认导出 `{ gameId, gameFile, scenarios: [{ id, title, setup?, run }] }`）。
 * 每个场景使用固定初始状态 + 现有 #test 钩子（只读观察 + 状态机操作），不修改游戏文件；
 * 运行结果可复跑：同一场景用 --repeat=<n> 连续跑 n 遍，证据摘要只记录稳定值。
 *
 * 运行：
 *   node tools/arcade_gameplay_test.mjs                    # base + challenge（默认 --suite=all）
 *   node tools/arcade_gameplay_test.mjs --list             # 列出场景 ID / 标题 / 游戏 / suite
 *   node tools/arcade_gameplay_test.mjs --suite=base       # 只跑 0.8 的 11 个场景
 *   node tools/arcade_gameplay_test.mjs --suite=challenge  # 全局门禁 + 已发现的挑战模块
 *   node tools/arcade_gameplay_test.mjs --game=shadow-leap # 只跑该游戏的挑战模块场景
 *   node tools/arcade_gameplay_test.mjs --scenario=SC-SL-001 --scenario=CH-SL-001
 *   node tools/arcade_gameplay_test.mjs --repeat=2         # 每个场景连跑 2 遍验证确定性
 *
 * 端口（避免与 arcade_smoke 的默认 8765/9333 冲突）：
 *   ARCADE_GAMEPLAY_PORT（默认 8766）/ ARCADE_GAMEPLAY_CDP_PORT（默认 9334）
 * 只有需要浏览器的场景才会启动静态服务器与 Chrome；CH-DATA-001 是纯 Node 数据审计。
 *
 * 场景模块协议、证据等级与端口/并发约定见 docs/arcade/0.9/TESTING.md。
 * pending：场景对象可带 `pending: '原因'` —— 依赖钩子尚未交付时打印 SKIP 而不是误报 PASS/FAIL
 *   （显式 --scenario 指定 pending 场景同样 SKIP）；钩子稳定后删除该字段即启用。
 * 退出码：0 = 全部场景 PASS（正常 SKIP 不计失败）；1 = 至少一个场景/模块 FAIL 或运行环境失败；2 = CLI 用法错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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

/* ---------- 0.9 影跃挑战语义 helper（契约 INTEGRATION-CONTRACT §4/§5） ----------
 * 2026-11 迁移：影跃从 0.8 的 S1–S3 trial 迁移到 0.9 的 C01–C06 挑战模式。
 * 旧 trialInfo/stageList/startTrial/loadStage/forceFall/forceCollectScroll 钩子将被移除，
 * SC-SL-004/005/006/007/008 保留 ID 但改用 0.9 挑战钩子（g-shadow stable 后按实际钩子收紧）。
 * -------------------------------------------------------------------------- */

/** 读取 0.9 影跃设计源（Node 侧只读；场景内用于和运行时数据/实现比对）。 */
let shadowLeapDesignCache = null;
function readShadowLeapDesign() {
  if (!shadowLeapDesignCache) shadowLeapDesignCache = JSON.parse(fs.readFileSync(path.join(LEVELS_DIR, 'shadow-leap.json'), 'utf8'));
  return shadowLeapDesignCache;
}

/** 读取 A.Challenge 的挑战数据 / 进度 / 解锁状态（engine.js 平台 API，契约 §3）。 */
async function readChallengeState(cdp) {
  return cdp.evaluate(`(() => {
    const api = window.Arcade && Arcade.Challenge;
    if (!api || typeof api.stages !== 'function') return { api: false };
    const stages = api.stages('shadow-leap');
    return {
      api: true,
      stages,
      progress: typeof api.progress === 'function' ? api.progress('shadow-leap') : null,
      unlocked: stages.map((stage) => (typeof api.isUnlocked === 'function' ? api.isUnlocked('shadow-leap', stage.id) : null))
    };
  })()`);
}

/** 进入挑战关卡（ref 支持 1-based stageNumber 或 stageId 字符串）并等待进入 playing。 */
async function startChallengeStage(cdp, ref) {
  const hasHook = await cdp.evaluate('typeof window.__arcadeTest.startChallenge === "function"');
  assert(hasHook, '0.9 挑战钩子缺失：window.__arcadeTest.startChallenge(ref)（g-shadow 尚未交付）');
  const started = await cdp.evaluate('window.__arcadeTest.startChallenge(' + JSON.stringify(ref) + ')');
  assert(started === true, 'startChallenge(' + JSON.stringify(ref) + ') 返回 ' + started);
  await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 8000 });
  return cdp.evaluate('window.__arcadeTest.challengeInfo()');
}

/** 清关：优先影门 forceReachGoal（真实重叠），否则退回 forceStageClear（记录/UI 用）。 */
async function clearChallengeStage(cdp) {
  const hook = await cdp.evaluate(`(() => {
    const t = window.__arcadeTest;
    if (typeof t.forceReachGoal === 'function') return 'forceReachGoal';
    if (typeof t.forceStageClear === 'function') return 'forceStageClear';
    return null;
  })()`);
  assert(hook, '缺少清关钩子：forceReachGoal（影门）或 forceStageClear');
  const cleared = hook === 'forceReachGoal' ? await cdp.evaluate('window.__arcadeTest.forceReachGoal()') : await cdp.evaluate('window.__arcadeTest.forceStageClear(false)');
  assert(cleared === true, hook + '() 返回 ' + cleared);
  await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "cleared"', { timeout: 6000 });
  return hook;
}

/** 失败路径：forceStageFail(reason) → 等待 failed/over。 */
async function failChallengeStage(cdp, reason) {
  const hasHook = await cdp.evaluate('typeof window.__arcadeTest.forceStageFail === "function"');
  assert(hasHook, '0.9 挑战钩子缺失：window.__arcadeTest.forceStageFail(reason)');
  const failed = await cdp.evaluate('window.__arcadeTest.forceStageFail(' + JSON.stringify(reason || 'fall') + ')');
  assert(failed === true, 'forceStageFail() 返回 ' + failed);
  await cdp.waitFor('["failed","over"].indexOf(window.__arcadeTest.challengeInfo().state) !== -1', { timeout: 6000 });
  return cdp.evaluate('window.__arcadeTest.challengeInfo()');
}

/** 读取玩家位置：challengeInfo().player 优先，其次 stageObservable().player。 */
async function readPlayerPosition(cdp) {
  return cdp.evaluate(`(() => {
    const t = window.__arcadeTest;
    const info = typeof t.challengeInfo === 'function' ? t.challengeInfo() : null;
    if (info && info.player && typeof info.player.x === 'number') return info.player;
    const observable = typeof t.stageObservable === 'function' ? t.stageObservable() : null;
    if (observable && observable.player && typeof observable.player.x === 'number') return observable.player;
    return null;
  })()`);
}

/** 启动一局经典模式并等待开始弹层隐藏（0.9 各游戏统一的“经典已开始”信号）。 */
async function startClassic(cdp) {
  const hasSeed = await cdp.evaluate('typeof window.__arcadeTest.startClassicWithSeed === "function"');
  if (hasSeed) await cdp.evaluate('window.__arcadeTest.startClassicWithSeed(2026)');
  else await cdp.click('[data-ov-btn]');
  await cdp.waitFor('!!document.querySelector("[data-overlay]") && document.querySelector("[data-overlay]").hidden', { timeout: 8000 });
}

/* ============================================================================
 * 场景注册表：{ id, title, game, setup(cdp, base), run(cdp) }
 *
 * - id 稳定且永不复用：SC-<GAME>-<NNN>（影跃 SL / 星海 STAR / 极速车道 ROAD）。
 * - setup：固定初始状态（runner 已清空 localStorage 并以 `?gp003=<id>-<n>#test` 导航；
 *   setup 里只做“点击开始 / 强制落点 / 切关卡”等确定性进入动作）。
 * - run：读取 __arcadeTest 钩子，assert 失败即抛错；返回对象作为 PASS 行的证据摘要。
 * - 影跃 0.9 迁移：SC-SL-004..008 保留 ID，但断言语义从 0.8 trial(S1–S3) 改为
 *   0.9 挑战(C01–C06)；g-shadow stable 前标 pending，启用后必须真实跑绿。
 * - 场景模块协议与证据等级见 docs/arcade/0.9/TESTING.md。
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
      /* 轮询等待真实着陆帧：高并发时 rAF 回调可能早于游戏 update，固定 rAF/sleep 会误报。 */
      const landed = await cdp.evaluate(`(async () => {
        const t = window.__arcadeTest;
        for (let frame = 0; frame < 240; frame += 1) {
          const joy = t.joyInfo();
          if (joy.boostArmed === false) return { landedFrame: frame, joy };
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        }
        return { landedFrame: -1, joy: t.joyInfo() };
      })()`);
      assert(landed.landedFrame >= 0, '月弹着陆事件未在 240 帧内发生：' + JSON.stringify(landed.joy));
      assert(landed.joy.boostArmed === false, '月弹着陆后未消耗上弦状态');
      assert(landed.joy.landingHint === '月弹！', '月弹着陆提示错误：' + landed.joy.landingHint);
      assert(landed.joy.player.vy < -400, '月弹强化跳速度不足：' + landed.joy.player.vy);

      return {
        feather: '2→1→0',
        featherGravity: round1(feather.fall.gravity),
        featherMaxFall: feather.fall.maxFall,
        featherTimerExpired: true,
        boost: '2→1→0',
        boostLandingHint: landed.joy.landingHint,
        boostJumped: landed.joy.player.vy < -400,
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
  /* ---------- 影跃 0.9 挑战语义（保留 0.8 场景 ID；g-shadow stable 后启用） ---------- */
  {
    id: 'SC-SL-004',
    title: '影跃·0.9 挑战六关数据/选关解锁 + 影门清关进下一关',
    game: 'shadow-leap.html',
    async run(cdp) {
      const design = readShadowLeapDesign();
      const designIds = design.stages.map((stage) => stage.id);
      const state = await readChallengeState(cdp);
      assert(state.api, 'A.Challenge API 缺失（engine.js 未提供 stages/progress/isUnlocked）');
      assert(Array.isArray(state.stages) && state.stages.length === 6, '挑战关卡数 ' + (state.stages && state.stages.length) + ' ≠ 6');
      assert(state.stages.map((stage) => stage.id).join(',') === designIds.join(','), '挑战关卡 id/顺序与设计源不一致：' + state.stages.map((stage) => stage.id).join(','));
      for (let index = 0; index < state.stages.length; index += 1) {
        const stage = state.stages[index];
        const designStage = design.stages[index];
        assert(stage.stageNumber === index + 1, stage.id + '：stageNumber 不是 ' + (index + 1));
        assert(typeof stage.title === 'string' && stage.title.length > 0, stage.id + '：title 为空');
        assert(stage.title === designStage.title, stage.id + '：title 与设计源不一致');
        assert(Array.isArray(stage.requiredFeatures) && stage.requiredFeatures.length > 0, stage.id + '：requiredFeatures 为空');
        assert(JSON.stringify(stage.requiredFeatures) === JSON.stringify(designStage.integration.requiredFeatures), stage.id + '：requiredFeatures 与设计源不一致');
      }
      /* 选关解锁：C01 恒开；全新存档下 C02–C06 均锁定（前一关未 cleared）。 */
      assert(state.unlocked[0] === true, 'C01 在全新存档下应恒解锁');
      for (let index = 1; index < state.unlocked.length; index += 1) assert(state.unlocked[index] === false, designIds[index] + ' 初始应锁定');
      const testStages = await cdp.evaluate('typeof window.__arcadeTest.challengeStages === "function" ? window.__arcadeTest.challengeStages() : null');
      assert(Array.isArray(testStages) && testStages.length === 6, '#test challengeStages() 应返回 6 关');
      assert(testStages[0].unlocked === true && testStages.slice(1).every((stage) => stage.unlocked === false), 'challengeStages() 解锁状态与 A.Challenge 不一致');

      /* startChallenge(1) 进入 C01 → 影门清关 → 结算主按钮「下一关」→ 进入 C02。 */
      const info = await startChallengeStage(cdp, designIds[0]);
      assert(info.mode === 'challenge', 'startChallenge(' + designIds[0] + ') 后 mode 不是 challenge：' + JSON.stringify(info.mode));
      assert(info.stageIndex === 0 && info.stageId === designIds[0], 'startChallenge(' + designIds[0] + ') 后关卡错误：' + JSON.stringify({ stageIndex: info.stageIndex, stageId: info.stageId }));
      const clearHook = await clearChallengeStage(cdp);
      const clearedDom = await cdp.evaluate(`({
        title: document.querySelector('[data-ov-title]') ? document.querySelector('[data-ov-title]').textContent : null,
        text: document.querySelector('[data-ov-text]') ? document.querySelector('[data-ov-text]').textContent : null,
        btn: document.querySelector('[data-ov-btn]') ? document.querySelector('[data-ov-btn]').textContent : null,
        overlay: document.querySelector('[data-overlay]') ? !document.querySelector('[data-overlay]').hidden : null
      })`);
      assert(clearedDom.overlay === true, '清关后结算弹层未显示');
      assert((clearedDom.btn || '').includes('下一关'), 'C01 清关主按钮不是「下一关」：' + JSON.stringify(clearedDom.btn));
      const clearedInfo = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
      assert(clearedInfo.cleared === true, '清关后 challengeInfo().cleared 不为 true');
      const progress = await cdp.evaluate('window.Arcade.Challenge.progress("shadow-leap")');
      assert(progress && Array.isArray(progress.cleared) && progress.cleared.includes(designIds[0]), 'C01 未写入 challenge 记录：' + JSON.stringify(progress && progress.cleared));
      const unlockedAfter = await cdp.evaluate('typeof window.Arcade.Challenge.isUnlocked === "function" ? window.Arcade.Challenge.isUnlocked("shadow-leap", ' + JSON.stringify(designIds[1]) + ') : null');
      assert(unlockedAfter === true, 'C01 清关后 C02 未解锁');
      await cdp.click('[data-ov-btn]');
      await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing" && window.__arcadeTest.challengeInfo().stageIndex === 1', { timeout: 8000 });
      const next = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
      assert(next.stageId === designIds[1], '清关后下一关不是 ' + designIds[1] + '：' + next.stageId);
      return { stages: 6, clearHook, clearedTitle: clearedDom.title, nextStage: next.stageId, unlockedAfterClear: unlockedAfter };
    },
  },
  {
    id: 'SC-SL-005',
    title: '影跃·0.9 挑战失败归因与 1 次点击重试回本关起点',
    game: 'shadow-leap.html',
    async run(cdp) {
      const design = readShadowLeapDesign();
      const stageId = design.stages[0].id;
      const info = await startChallengeStage(cdp, stageId);
      assert(info.stageId === stageId, 'startChallenge(' + stageId + ') 后关卡不是 ' + stageId + '：' + info.stageId);
      const startPosition = await readPlayerPosition(cdp);
      const failedInfo = await failChallengeStage(cdp, 'fall');
      assert(failedInfo.stageId === stageId, '失败后关卡改变：' + failedInfo.stageId);
      const dom = await cdp.evaluate(`({
        title: document.querySelector('[data-ov-title]') ? document.querySelector('[data-ov-title]').textContent : null,
        text: document.querySelector('[data-ov-text]') ? document.querySelector('[data-ov-text]').textContent : null,
        btn: document.querySelector('[data-ov-btn]') ? document.querySelector('[data-ov-btn]').textContent : null,
        overlay: document.querySelector('[data-overlay]') ? !document.querySelector('[data-overlay]').hidden : null
      })`);
      assert(dom.overlay === true, '失败后没有弹出可归因结算弹层');
      assert(typeof dom.title === 'string' && dom.title.length > 0, '失败弹层标题为空');
      assert(typeof dom.text === 'string' && dom.text.length > 4, '失败弹层缺少可归因文案：' + JSON.stringify(dom.text));
      assert((dom.btn || '').includes('重试'), '失败主按钮不是「重试本关」：' + JSON.stringify(dom.btn));
      /* 失败弹层只点 1 次主按钮即重开本关（不刷新、无二次确认）。 */
      await cdp.click('[data-ov-btn]');
      await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 8000 });
      const retried = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
      assert(retried.stageIndex === 0 && retried.stageId === stageId, '重试后关卡不是 ' + stageId + '：' + JSON.stringify({ stageIndex: retried.stageIndex, stageId: retried.stageId }));
      const elapsed = typeof retried.elapsedSec === 'number' ? retried.elapsedSec : retried.elapsed;
      assert(Number.isFinite(elapsed) && elapsed < 5, '重试后本关计时未重置：' + elapsed);
      const retriedPosition = await readPlayerPosition(cdp);
      if (startPosition && retriedPosition) {
        assert(Math.abs(retriedPosition.x - startPosition.x) <= 5, '重试后玩家 x 未回到起点：' + JSON.stringify({ x: retriedPosition.x, startX: startPosition.x }));
        assert(Math.abs(retriedPosition.y - startPosition.y) <= 140, '重试后玩家 y 未回到起点附近：' + JSON.stringify({ y: retriedPosition.y, startY: startPosition.y }));
      }
      return { failTitle: dom.title, retryClicks: 1, stageAfterRetry: retried.stageId, elapsedReset: true, positionChecked: !!(startPosition && retriedPosition) };
    },
  },
  {
    id: 'SC-SL-006',
    title: '影跃·0.9 挑战暂停刷新恢复 + 旧经典档缺 mode 仍经典',
    game: 'shadow-leap.html',
    async run(cdp) {
      const design = readShadowLeapDesign();
      const stageId = design.stages[1].id;
      const info = await startChallengeStage(cdp, design.stages[1].id);
      assert(info.stageId === stageId, 'startChallenge(' + design.stages[1].id + ') 后关卡不是 ' + stageId + '：' + info.stageId);

      /* 1) 挑战 C02 暂停 → 刷新页面 → 继续恢复 mode/stageId/位置。 */
      await cdp.click('[data-pause]');
      await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "paused"', { timeout: 5000 });
      const paused = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
      assert(paused.mode === 'challenge' && paused.stageIndex === 1 && paused.stageId === stageId, '暂停时挑战状态错误：' + JSON.stringify({ mode: paused.mode, stageIndex: paused.stageIndex, stageId: paused.stageId }));

      await cdp.navigate(BASE + '/apps/arcade/games/shadow-leap.html?ch009-resume=1#test');
      const resumeTitle = await cdp.text('[data-ov-title]');
      assert(resumeTitle && resumeTitle.includes('继续'), '挑战局刷新后未显示续玩提示：' + resumeTitle);
      await cdp.click('[data-ov-btn]');
      await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 8000 });
      const resumed = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
      assert(resumed.mode === 'challenge' && resumed.stageIndex === 1 && resumed.stageId === stageId, '刷新恢复后挑战状态错误：' + JSON.stringify({ mode: resumed.mode, stageIndex: resumed.stageIndex, stageId: resumed.stageId }));
      const resumedPosition = await readPlayerPosition(cdp);
      assert(resumedPosition && Number.isFinite(resumedPosition.x) && Number.isFinite(resumedPosition.y), '刷新恢复后玩家位置异常：' + JSON.stringify(resumedPosition));

      /* 2) 旧经典档（剥离 mode/stageId/challenge* 字段）仍按经典恢复，不进入挑战。 */
      await cdp.evaluate("Arcade.RunSave.clear('shadow-leap')");
      await startClassic(cdp);
      const classicRaw = await cdp.evaluate("localStorage.getItem('studiokit:arcade:runs:v1')");
      const payload = JSON.parse(classicRaw);
      const classicRecord = payload.games && payload.games['shadow-leap'];
      assert(classicRecord && classicRecord.data, '未能生成用于旧档回归的 classic 存档');
      for (const key of Object.keys(classicRecord.data)) {
        if (key === 'mode' || key === 'stageId' || key === 'stageIndex' || key.indexOf('challenge') === 0 || key.indexOf('trial') === 0) delete classicRecord.data[key];
      }
      const legacyRaw = JSON.stringify(payload);
      /* 先在非游玩态页面写回剥离后的旧档，避免页面离开时自动存档把新字段写回。 */
      await cdp.navigate(BASE + '/apps/arcade/games/shadow-leap.html?ch009-oldsave-prepare=1');
      await cdp.evaluate('localStorage.setItem("studiokit:arcade:runs:v1", ' + JSON.stringify(legacyRaw) + ')');
      await cdp.navigate(BASE + '/apps/arcade/games/shadow-leap.html?ch009-oldsave=1#test');
      const oldTitle = await cdp.text('[data-ov-title]');
      assert(oldTitle && oldTitle.includes('继续'), '旧经典档刷新后未显示续玩提示：' + oldTitle);
      await cdp.click('[data-ov-btn]');
      await cdp.waitFor('!!document.querySelector("[data-overlay]") && document.querySelector("[data-overlay]").hidden', { timeout: 8000 });
      const legacy = await cdp.evaluate('typeof window.__arcadeTest.challengeInfo === "function" ? window.__arcadeTest.challengeInfo() : null');
      assert(!legacy || legacy.mode !== 'challenge', '旧经典档被当成挑战恢复：' + JSON.stringify(legacy && { mode: legacy.mode, stageId: legacy.stageId }));
      assert(!legacy || legacy.stageId == null, '旧经典档恢复出挑战关卡：' + JSON.stringify(legacy && legacy.stageId));
      await cdp.evaluate('localStorage.clear()');
      return {
        resumedMode: resumed.mode,
        resumedStageId: resumed.stageId,
        positionRestored: !!(resumedPosition && Number.isFinite(resumedPosition.x)),
        legacyMode: legacy ? legacy.mode : null,
        legacyStageId: legacy ? legacy.stageId : null,
      };
    },
  },
  {
    id: 'SC-SL-007',
    title: '影跃·0.9 挑战 C02/C04/C05 双路线数据与路线记录',
    game: 'shadow-leap.html',
    async run(cdp) {
      const design = readShadowLeapDesign();
      /* 设计源 fork/wind 语义的三关：C02（月下断桥）、C04（风之回廊）、C05（双影岔路）。 */
      const routeRefs = [2, 4, 5];
      const routes = [];
      let routeHookUsed = false;
      let routeFieldRecorded = false;
      for (const ref of routeRefs) {
        const designStage = design.stages[ref - 1];
        const altRoute = designStage.content.alternativeRoute;
        const mainRoute = designStage.content.mainRoute;
        const designPlatformIds = designStage.content.platforms.map((platform) => platform.id);
        assert(Array.isArray(altRoute) && altRoute.length >= 2, designStage.id + '：设计源 alternativeRoute 缺失');
        assert(altRoute.every((platformId) => designPlatformIds.includes(platformId)), designStage.id + '：alternativeRoute 引用未知平台');
        assert(Array.isArray(mainRoute) && mainRoute.every((platformId) => designPlatformIds.includes(platformId)), designStage.id + '：mainRoute 引用未知平台');

        const info = await startChallengeStage(cdp, designStage.id);
        assert(info.stageId === designStage.id, 'startChallenge(' + ref + ') 后不是 ' + designStage.id + '：' + info.stageId);
        /* 运行时数据路线必须与设计源一致（A.Challenge.stage(...).content，契约 §2/§3）。 */
        const runtimeStage = await cdp.evaluate(`(() => {
          const api = window.Arcade && Arcade.Challenge;
          if (!api || typeof api.stage !== 'function') return null;
          const stage = api.stage('shadow-leap', ${JSON.stringify(designStage.id)});
          return stage && stage.content ? {
            altRoute: stage.content.alternativeRoute,
            mainRoute: stage.content.mainRoute,
            platformIds: Array.isArray(stage.content.platforms) ? stage.content.platforms.map((platform) => platform.id) : null
          } : null;
        })()`);
        if (runtimeStage) {
          assert(JSON.stringify(runtimeStage.altRoute) === JSON.stringify(altRoute), designStage.id + '：运行时 alternativeRoute 与设计源不一致');
          assert(JSON.stringify(runtimeStage.mainRoute) === JSON.stringify(mainRoute), designStage.id + '：运行时 mainRoute 与设计源不一致');
          if (Array.isArray(runtimeStage.platformIds)) assert(altRoute.every((platformId) => runtimeStage.platformIds.includes(platformId)), designStage.id + '：运行时平台表缺少支线平台');
        }

        /* 若实现提供路线钩子/字段：固定支线后清关并记录 route；否则如实记为“数据级已核对”。 */
        const hasForceRoute = await cdp.evaluate('typeof window.__arcadeTest.forceRoute === "function"');
        let routeValue = null;
        let routeLabel = null;
        if (hasForceRoute) {
          routeHookUsed = true;
          for (const routeId of ['alternative', 'alt', 'branch', 'main', 'safe']) {
            const forced = await cdp.evaluate('window.__arcadeTest.forceRoute(' + JSON.stringify(routeId) + ')');
            if (forced === true) {
              const settled = await clearChallengeStage(cdp);
              const settledInfo = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
              routeValue = settledInfo.route !== undefined ? settledInfo.route : settledInfo.routeId !== undefined ? settledInfo.routeId : null;
              routeLabel = settledInfo.routeLabel !== undefined ? settledInfo.routeLabel : null;
              if (routeValue !== null) routeFieldRecorded = true;
              break;
            }
          }
        }
        routes.push({ stage: designStage.id, altPlatforms: altRoute.length, routeHook: hasForceRoute, routeValue, routeLabel });
      }
      return {
        stages: routeRefs.length,
        altRoutePlatforms: routes.map((route) => route.stage + ':' + route.altPlatforms).join(','),
        routeHookUsed,
        routeFieldRecorded,
        routeValues: routes.map((route) => route.stage + '=' + JSON.stringify(route.routeValue)).join(','),
      };
    },
  },
  {
    id: 'SC-SL-008',
    title: '影跃·0.9 挑战收集物（卷轴）可选：不拿可通关、拿了进记录',
    game: 'shadow-leap.html',
    async run(cdp) {
      const design = readShadowLeapDesign();
      const collectibleStages = design.stages.filter((stage) => Array.isArray(stage.content.collectibles) && stage.content.collectibles.length > 0);
      assert(collectibleStages.length >= 1, '设计源中没有带 collectibles 的关卡');
      assert(collectibleStages[0].content.collectibles.every((item) => item.optional === true), '设计源 collectibles 应全部 optional:true');
      const firstStage = collectibleStages[0];
      const collectibleIds = firstStage.content.collectibles.map((item) => item.id);

      /* 1) 不收集 → 正常通关并写 challenge 记录（collectibles 为空）。 */
      const info = await startChallengeStage(cdp, firstStage.id);
      assert(info.stageId === firstStage.id, 'startChallenge(' + firstStage.id + ') 后不是 ' + firstStage.id + '：' + info.stageId);
      const currentCollectibles = await cdp.evaluate('window.__arcadeTest.challengeInfo().collectibles');
      assert(Array.isArray(currentCollectibles) && currentCollectibles.length === 0, firstStage.id + ' 开局 collectibles 应为空数组：' + JSON.stringify(currentCollectibles));
      await clearChallengeStage(cdp);
      const settled = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
      assert(settled.cleared === true, '未收集收集物无法通关');
      const progress = await cdp.evaluate('window.Arcade.Challenge.progress("shadow-leap")');
      const best = progress && progress.best ? progress.best[firstStage.id] : null;
      assert(best, firstStage.id + ' 通关未写入 challenge 记录');
      assert(Array.isArray(best.collectibles) && best.collectibles.length === 0, '未收集时记录 collectibles 应为空：' + JSON.stringify(best.collectibles));

      /* 2) 收集再通关 → collectibles 进入 challenge 记录（钩子存在时断言；缺失则如实记录待 g-shadow 对齐）。
         用全新 best 的后续卷轴关（如 C03）验证入档，避免“最佳用时”不覆盖导致误判。 */
      const collectHook = await cdp.evaluate(`(() => {
        const t = window.__arcadeTest;
        for (const name of ['forceCollectCollectible', 'forceCollectScroll', 'forceCollect', 'collectCollectible']) {
          if (typeof t[name] === 'function') return name;
        }
        return null;
      })()`);
      let collectedRecorded = false;
      let collectStageId = null;
      if (collectHook) {
        const laterCollectible = design.stages.filter((stage, index) => index > 0 && Array.isArray(stage.content.collectibles) && stage.content.collectibles.length > 0)[0] || null;
        if (laterCollectible) {
          const targetIndex = design.stages.indexOf(laterCollectible);
          for (let index = 1; index <= targetIndex; index += 1) {
            await startChallengeStage(cdp, design.stages[index].id);
            if (index < targetIndex) await clearChallengeStage(cdp);
          }
          const collected = await cdp.evaluate('window.__arcadeTest.' + collectHook + '(0)');
          assert(collected === true, collectHook + '(0) 返回 ' + collected);
          await cdp.waitFor('window.__arcadeTest.challengeInfo().collectibles.length === 1', { timeout: 5000 });
          await clearChallengeStage(cdp);
          const progressAfter = await cdp.evaluate('window.Arcade.Challenge.progress("shadow-leap")');
          const bestAfter = progressAfter && progressAfter.best ? progressAfter.best[laterCollectible.id] : null;
          assert(bestAfter, '收集后 ' + laterCollectible.id + ' 通关未写入记录');
          assert(Array.isArray(bestAfter.collectibles) && bestAfter.collectibles.length >= 1, '收集物未写入 challenge 记录：' + JSON.stringify(bestAfter.collectibles));
          collectedRecorded = true;
          collectStageId = laterCollectible.id;
        }
      }
      return {
        collectibleStages: collectibleStages.map((stage) => stage.id).join(','),
        collectibleIds: collectibleIds.join(','),
        clearedWithoutCollect: true,
        collectHook: collectHook || 'hook-absent',
        collectStageId,
        collectedRecorded,
      };
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

      /* 2) 落地补充：forceLand 立即终止冲刺并补满 1 次，可再次触发一次。
         （轮询等待真实落地帧，不用固定 rAF：高并发下 rAF 可能早于游戏 update。） */
      const landed = await cdp.evaluate(`(async () => {
        const t = __arcadeTest;
        const forced = t.forceLand(1);
        for (let frame = 0; frame < 240; frame += 1) {
          const info = t.dashInfo();
          if (info.dashCharges === 1 && info.dashing === false) return { forced, landedFrame: frame, info };
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        }
        return { forced, landedFrame: -1, info: t.dashInfo() };
      })()`);
      assert(landed.forced === true, 'forceLand(1) 失败');
      assert(landed.landedFrame >= 0, '落地补充未在 240 帧内发生：' + JSON.stringify(landed.info));
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
        let landedAgain = t.dashInfo();
        for (let frame = 0; frame < 240 && !(landedAgain.dashCharges === 1 && landedAgain.dashing === false); frame += 1) {
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
          landedAgain = t.dashInfo();
        }
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

/* ============================================================================
 * 0.9 挑战模式测试层：全局数据门禁 + 挑战场景模块自动发现
 * ----------------------------------------------------------------------------
 * 设计源（只读）：docs/arcade/0.9/levels/<gameId>.json（13 游戏 × 6 关）
 * 运行时数据：apps/arcade/challenge/<gameId>.js（平台 Agent 生成；存在才审计）
 * 游戏模块：tools/challenge/<gameId>.mjs（各游戏 Agent 提供；自动发现，缺失正常跳过）
 * ========================================================================== */
const LEVELS_DIR = path.join(REPO_ROOT, 'docs', 'arcade', '0.9', 'levels');
const RUNTIME_CHALLENGE_DIR = path.join(REPO_ROOT, 'apps', 'arcade', 'challenge');
const CHALLENGE_MODULES_DIR = path.join(REPO_ROOT, 'tools', 'challenge');
const GAMES_DIR = path.join(REPO_ROOT, 'apps', 'arcade', 'games');

/** 0.9 的 13 款游戏；顺序与 apps/arcade/engine.js 的 GAMES 一致，也是设计包校验顺序。 */
const EXPECTED_GAME_IDS = [
  'memory-flip',
  'merge-2048',
  'snowbells',
  'brick-breaker',
  'gravity-flip',
  'snake-run',
  'mole-whack',
  'block-drop',
  'star-raid',
  'road-rush',
  'shadow-leap',
  'pendulum-tower',
  'gold-miner',
];

/** 证据等级（INTEGRATION-CONTRACT.md §6）：ui-only 不得作为关卡 DONE 证据。 */
const CHALLENGE_EVIDENCE_LEVELS = ['real-input-replay', 'engine-replay', 'ui-only'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 稳定序列化（对象键排序），用于设计源/运行时数据一致性比较。 */
function canonicalize(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((item) => canonicalize(item)).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalize(value[key])).join(',') + '}';
}

/** 聚合式数据审计：先收集所有失败，最后一次性抛出；FAIL 行同时给出失败项与检查总数。 */
function createAudit() {
  let checks = 0;
  const failures = [];
  return {
    check(condition, message) {
      checks += 1;
      if (!condition) failures.push(message);
      return !!condition;
    },
    get checks() {
      return checks;
    },
    get failureCount() {
      return failures.length;
    },
    finish(label) {
      if (failures.length) {
        throw new Error(label + '：' + failures.length + ' 项失败 / 共 ' + checks + ' 项检查 — ' + failures.slice(0, 8).join('；') + (failures.length > 8 ? '；…' : ''));
      }
      return checks;
    },
  };
}

function printSkip(id, title, reason) {
  console.log('SKIP  ' + id + ' ' + title + ' — ' + reason);
}

/** 设计源单关通用合同检查（13 游戏共用；content 结构由 CONTENT_CHECKS 逐游戏补充）。 */
function auditStageContract(gameId, stageNumber, stage, audit) {
  const fallbackId = gameId + '-C' + String(stageNumber).padStart(2, '0');
  if (!audit.check(isPlainObject(stage), gameId + ' 第 ' + stageNumber + ' 关：stage 不是对象')) return;
  const id = isNonEmptyString(stage.id) ? stage.id : fallbackId;
  audit.check(stage.id === fallbackId, id + '：id 不是 ' + fallbackId + '（实际 ' + JSON.stringify(stage.id) + '）');
  audit.check(stage.gameId === gameId, id + '：gameId 字段为 ' + JSON.stringify(stage.gameId));
  audit.check(stage.stageNumber === stageNumber, id + '：stageNumber 为 ' + JSON.stringify(stage.stageNumber) + '，应为 ' + stageNumber);
  for (const field of ['title', 'goalStatement', 'decision', 'practicedSkill', 'discovery']) {
    audit.check(isNonEmptyString(stage[field]), id + '：' + field + ' 为空或非字符串');
  }
  audit.check(stage.mode === 'challenge', id + '：mode 不是 challenge');
  audit.check(
    Array.isArray(stage.targetDurationSec) && stage.targetDurationSec.length === 2 && stage.targetDurationSec.every((value) => isFiniteNumber(value) && value > 0) && stage.targetDurationSec[0] < stage.targetDurationSec[1],
    id + '：targetDurationSec 不是 [短, 长] 正数区间'
  );
  audit.check(isPlainObject(stage.integration) && stage.integration.separateClassicProgress === true, id + '：integration.separateClassicProgress 不为 true');
  const features = isPlainObject(stage.integration) ? stage.integration.requiredFeatures : null;
  audit.check(Array.isArray(features) && features.length > 0 && features.every((feature) => isNonEmptyString(feature)), id + '：requiredFeatures 为空或含非法项');
  audit.check(isPlainObject(stage.content) && Object.keys(stage.content).length > 0, id + '：content 为空');
  audit.check(isNonEmptyValue(stage.referencePlan), id + '：referencePlan 为空');
  audit.check(isNonEmptyValue(stage.acceptance), id + '：acceptance 为空');
}

/* ---------- 简化参考解模拟：俄罗斯方块硬降 / 2048 合并（移植自 validate_levels.py 的关键不变量） ---------- */

function tetrisDrop(board, piece, orientation, left, definitions) {
  const shape = definitions[piece + '-' + orientation];
  if (!Array.isArray(shape) || shape.length === 0) return null;
  let maxX = 0;
  let maxY = 0;
  for (const cell of shape) {
    if (!Array.isArray(cell) || cell.length < 2) return null;
    maxX = Math.max(maxX, cell[0]);
    maxY = Math.max(maxY, cell[1]);
  }
  if (!Number.isInteger(left) || left < 0 || left + maxX >= 10) return null;
  const rows = board.length;
  const fits = (topY) => shape.every(([x, y]) => {
    const row = topY + y;
    if (row >= rows) return false;
    return row < 0 || board[row][left + x] === '.';
  });
  let topY = -4;
  if (!fits(topY)) return null;
  while (topY < maxY + rows && fits(topY + 1)) topY += 1;
  if (topY < 0) return null;
  const next = board.map((row) => row.split(''));
  for (const [x, y] of shape) next[topY + y][left + x] = '#';
  const kept = next.filter((row) => row.some((cell) => cell !== '#'));
  const cleared = rows - kept.length;
  return { board: Array.from({ length: cleared }, () => '.'.repeat(10)).concat(kept.map((row) => row.join(''))), cleared };
}

function mergeLine(values) {
  const compact = values.filter((value) => value !== 0);
  const merged = [];
  for (let index = 0; index < compact.length; index += 1) {
    if (index + 1 < compact.length && compact[index] === compact[index + 1]) {
      merged.push(compact[index] * 2);
      index += 1;
    } else {
      merged.push(compact[index]);
    }
  }
  while (merged.length < 4) merged.push(0);
  return merged;
}

function mergeStep(board, direction) {
  const next = board.map((row) => row.slice());
  if (direction === 'L' || direction === 'R') {
    for (let row = 0; row < 4; row += 1) {
      const line = direction === 'L' ? next[row].slice() : next[row].slice().reverse();
      const merged = mergeLine(line);
      next[row] = direction === 'L' ? merged : merged.reverse();
    }
  } else {
    for (let column = 0; column < 4; column += 1) {
      const input = [next[0][column], next[1][column], next[2][column], next[3][column]];
      const line = direction === 'U' ? input : input.slice().reverse();
      const merged = mergeLine(line);
      const result = direction === 'U' ? merged : merged.reverse();
      for (let row = 0; row < 4; row += 1) next[row][column] = result[row];
    }
  }
  return next;
}

/* ---------- 各游戏 content 关键结构（validate_levels.py 精神的简化独立实现） ---------- */

const CONTENT_CHECKS = {
  'shadow-leap'(stage, id, audit) {
    const content = stage.content;
    const platforms = content.platforms;
    if (!audit.check(Array.isArray(platforms) && platforms.length >= 3, id + '：platforms 不足 3 块')) return;
    const byId = new Map();
    for (const platform of platforms) {
      if (!audit.check(isPlainObject(platform) && isNonEmptyString(platform.id), id + '：平台缺少 id')) continue;
      byId.set(platform.id, platform);
      const inWorld = isFiniteNumber(platform.xCenter) && isFiniteNumber(platform.width) && platform.width > 0 && platform.xCenter - platform.width / 2 >= 0 && platform.xCenter + platform.width / 2 <= 420;
      audit.check(inWorld, id + '：平台 ' + platform.id + ' 越出 420 世界或字段非法');
    }
    audit.check(byId.size === platforms.length, id + '：platform id 重复');
    for (const routeKey of ['mainRoute', 'alternativeRoute']) {
      const route = content[routeKey];
      if (!audit.check(Array.isArray(route) && route.length > 0 && route.every((routeId) => byId.has(routeId)), id + '：' + routeKey + ' 为空或引用未知平台')) continue;
      for (let index = 1; index < route.length; index += 1) {
        const lower = byId.get(route[index - 1]);
        const upper = byId.get(route[index]);
        if (lower && upper) audit.check(upper.height - lower.height <= 136.5, id + '：' + routeKey + ' 高度差过大 ' + route[index - 1] + '→' + route[index]);
      }
    }
    const spawn = content.playerSpawn;
    audit.check(isPlainObject(spawn) && byId.has(spawn.platformId), id + '：playerSpawn 引用未知平台');
    const goal = content.goal;
    const lastPlatform = Array.isArray(content.mainRoute) ? byId.get(content.mainRoute[content.mainRoute.length - 1]) : null;
    if (audit.check(isPlainObject(goal) && isFiniteNumber(goal.height) && !!lastPlatform, id + '：goal 或主路线终点缺失')) {
      audit.check(goal.height - lastPlatform.height <= 136.5, id + '：影门相对主路线终点过高');
    }
  },

  snowbells(stage, id, audit) {
    const content = stage.content;
    const bells = content.bells;
    if (!audit.check(Array.isArray(bells) && bells.length > 0, id + '：bells 为空')) return;
    const byId = new Map();
    for (const bell of bells) {
      if (isPlainObject(bell) && isNonEmptyString(bell.id)) byId.set(bell.id, bell);
    }
    audit.check(byId.size === bells.length, id + '：bell id 重复');
    const sequence = content.requiredSequence;
    if (!audit.check(Array.isArray(sequence) && sequence.length > 0 && sequence.every((bellId) => byId.has(bellId)), id + '：requiredSequence 为空或引用未知铃铛')) return;
    audit.check(byId.has(content.startBell), id + '：startBell 不是 design 中的铃铛');
    for (let index = 1; index < sequence.length; index += 1) {
      const lower = byId.get(sequence[index - 1]);
      const upper = byId.get(sequence[index]);
      if (lower && upper) audit.check(upper.height - lower.height <= 159, id + '：' + sequence[index - 1] + '→' + sequence[index] + ' 高度上升超过 159');
    }
  },

  'block-drop'(stage, id, audit) {
    const content = stage.content;
    const board = content.boardTopToBottom;
    audit.check(
      Array.isArray(board) && board.length === 20 && board.every((row) => typeof row === 'string' && row.length === 10 && /^[.#]+$/.test(row)),
      id + '：boardTopToBottom 不是 20×10 的 .# 棋盘'
    );
    const definitions = content.pieceDefinitions;
    audit.check(isPlainObject(definitions) && Object.keys(definitions).length > 0, id + '：pieceDefinitions 缺失');
    const queue = content.pieceQueue;
    const plan = stage.referencePlan;
    if (!audit.check(Array.isArray(queue) && queue.length > 0 && Array.isArray(plan) && plan.length === queue.length, id + '：pieceQueue 与 referencePlan 长度不一致')) return;
    if (!Array.isArray(board) || board.length !== 20) return;
    let current = board.slice();
    let clearedTotal = 0;
    for (let index = 0; index < plan.length; index += 1) {
      const action = plan[index];
      if (!audit.check(isPlainObject(action) && action.piece === queue[index], id + '：第 ' + (index + 1) + ' 块与 pieceQueue 不一致')) return;
      const dropped = tetrisDrop(current, action.piece, action.orientation, action.leftCol, definitions || {});
      if (!audit.check(dropped !== null, id + '：第 ' + (index + 1) + ' 块无法硬降')) return;
      current = dropped.board;
      clearedTotal += dropped.cleared;
    }
    const target = isPlainObject(content.win) ? content.win.count : null;
    audit.check(isFiniteNumber(target) && clearedTotal >= target, id + '：参考解消行 ' + clearedTotal + ' < 目标 ' + target);
  },

  'merge-2048'(stage, id, audit) {
    const content = stage.content;
    const board = content.initialBoard;
    const validBoard = Array.isArray(board) && board.length === 4 && board.every((row) => Array.isArray(row) && row.length === 4 && row.every((value) => Number.isInteger(value) && value >= 0));
    if (!audit.check(validBoard, id + '：initialBoard 不是 4×4 非负整数盘面')) return;
    const plan = stage.referencePlan;
    const directions = isPlainObject(plan) ? plan.directions : null;
    if (!audit.check(Array.isArray(directions) && directions.length > 0 && directions.every((dir) => ['L', 'R', 'U', 'D'].includes(dir)), id + '：referencePlan.directions 缺失或非法')) return;
    audit.check(isFiniteNumber(content.maxValidMoves) && directions.length <= content.maxValidMoves, id + '：参考解步数 ' + directions.length + ' 超过 maxValidMoves ' + (isPlainObject(content) ? content.maxValidMoves : '?'));
    let current = board.map((row) => row.slice());
    let ineffective = 0;
    for (const direction of directions) {
      const next = mergeStep(current, direction);
      if (canonicalize(next) === canonicalize(current)) ineffective += 1;
      current = next;
    }
    audit.check(ineffective === 0, id + '：参考解含 ' + ineffective + ' 个无效方向');
    const maxTile = Math.max(...current.flat());
    const targetTile = isPlainObject(content.win) ? content.win.anyTileAtLeast : null;
    audit.check(isFiniteNumber(targetTile) && maxTile >= targetTile, id + '：参考解最大方块 ' + maxTile + ' < 目标 ' + targetTile);
    if (isPlainObject(plan) && plan.resultBoard) {
      audit.check(canonicalize(current) === canonicalize(plan.resultBoard), id + '：参考解终局盘面与 resultBoard 不一致');
    }
  },

  'road-rush'(stage, id, audit) {
    const content = stage.content;
    const laneCount = content.laneCount;
    audit.check(Number.isInteger(laneCount) && laneCount >= 2, id + '：laneCount 非法');
    audit.check(Number.isInteger(content.startLane) && content.startLane >= 0 && content.startLane < laneCount, id + '：startLane 越界');
    const timeline = content.timeline;
    if (!audit.check(Array.isArray(timeline) && timeline.length > 0, id + '：timeline 为空')) return;
    const plan = isPlainObject(stage.referencePlan) ? stage.referencePlan.safeLaneBySlot : null;
    if (!audit.check(Array.isArray(plan) && plan.length === timeline.length + 1, id + '：safeLaneBySlot 长度应为 ' + (timeline.length + 1) + '，实际 ' + (Array.isArray(plan) ? plan.length : JSON.stringify(plan)))) return;
    audit.check(plan[0] === content.startLane, id + '：safeLaneBySlot[0] 不是 startLane');
    for (let index = 0; index < timeline.length; index += 1) {
      const lane = plan[index + 1];
      const slot = timeline[index];
      const occupied = isPlainObject(slot) && Array.isArray(slot.occupiedLanes) ? slot.occupiedLanes : [];
      const reachable = Number.isInteger(lane) && lane >= 0 && lane < laneCount && !occupied.includes(lane) && Math.abs(lane - plan[index]) <= 1;
      audit.check(reachable, id + '：第 ' + (index + 1) + ' 个时间片安全车道 ' + lane + ' 被占用或不可达');
    }
  },

  'snake-run'(stage, id, audit) {
    const content = stage.content;
    const grid = content.grid;
    audit.check(isPlainObject(grid) && grid.cols === 18 && grid.rows === 18, id + '：grid 不是 18×18');
    const snake = content.initialSnake;
    const validSnake = Array.isArray(snake) && snake.length >= 3 && snake.every((segment) => Array.isArray(segment) && segment.length === 2 && segment.every((coord) => Number.isInteger(coord)));
    if (!audit.check(validSnake, id + '：initialSnake 非法')) return;
    const plan = isPlainObject(stage.referencePlan) ? stage.referencePlan.movesRLE : null;
    if (!audit.check(Array.isArray(plan) && plan.length > 0 && plan.every((token) => typeof token === 'string' && /^[RLUD]\d+$/.test(token)), id + '：referencePlan.movesRLE 缺失或格式非法')) return;
    const fruits = Array.isArray(content.fruitQueue) ? content.fruitQueue.map((fruit) => fruit.slice()) : [];
    audit.check(fruits.length > 0, id + '：fruitQueue 为空');
    const walls = new Set((Array.isArray(content.walls) ? content.walls : []).map((wall) => wall[0] + ',' + wall[1]));
    const delta = { R: [1, 0], L: [-1, 0], U: [0, -1], D: [0, 1] };
    const opposite = { R: 'L', L: 'R', U: 'D', D: 'U' };
    let direction = content.initialDirection;
    if (!audit.check(['R', 'L', 'U', 'D'].includes(direction), id + '：initialDirection 非法')) return;
    let body = snake.map((segment) => segment.slice());
    let collision = null;
    for (const token of plan) {
      const nextDirection = token[0];
      if (nextDirection === opposite[direction]) {
        collision = id + '：参考解出现 180° 反向';
        break;
      }
      direction = nextDirection;
      const steps = Number(token.slice(1));
      for (let step = 0; step < steps && !collision; step += 1) {
        const [dx, dy] = delta[direction];
        const head = [body[0][0] + dx, body[0][1] + dy];
        const grows = fruits.length > 0 && fruits[0][0] === head[0] && fruits[0][1] === head[1];
        const checkBody = grows ? body : body.slice(0, -1);
        const hitsBody = checkBody.some((segment) => segment[0] === head[0] && segment[1] === head[1]);
        const outOfGrid = head[0] < 0 || head[0] >= 18 || head[1] < 0 || head[1] >= 18;
        if (outOfGrid || walls.has(head[0] + ',' + head[1]) || hitsBody) {
          collision = id + '：参考解在 ' + head[0] + ',' + head[1] + ' 碰撞';
          break;
        }
        body = grows ? [head].concat(body) : [head].concat(body.slice(0, -1));
        if (grows) fruits.shift();
      }
      if (collision) break;
    }
    audit.check(collision === null, collision || id + '：蛇参考路径异常');
    if (!collision) {
      audit.check(fruits.length === 0, id + '：参考解未吃完果实（剩 ' + fruits.length + '）');
      audit.check(body.length === snake.length + (Array.isArray(content.fruitQueue) ? content.fruitQueue.length : 0), id + '：蛇最终长度与果实数不匹配');
    }
  },

  'memory-flip'(stage, id, audit) {
    const content = stage.content;
    const grid = content.grid;
    const faces = content.faces;
    const validFaces = isPlainObject(grid) && Array.isArray(faces) && faces.length === grid.rows && faces.every((row) => Array.isArray(row) && row.length === grid.cols);
    if (!audit.check(validFaces, id + '：faces 尺寸与 grid 不一致')) return;
    const counts = new Map();
    for (const row of faces) for (const symbol of row) counts.set(symbol, (counts.get(symbol) || 0) + 1);
    audit.check([...counts.values()].every((count) => count === 2), id + '：存在非成对符号');
    audit.check(counts.size * 2 === grid.rows * grid.cols, id + '：牌面数量与配对数不一致');
    const goalPairs = isPlainObject(content.goal) ? content.goal.pairs : null;
    audit.check(goalPairs === counts.size, id + '：goal.pairs 与符号对数不一致');
    const plan = stage.referencePlan;
    const pairs = isPlainObject(plan) ? plan.pairs : null;
    if (!audit.check(Array.isArray(pairs) && pairs.length === counts.size, id + '：referencePlan.pairs 数量与符号对数不一致')) return;
    for (const pair of pairs) {
      const symbol = isPlainObject(pair) ? pair.symbol : null;
      const positions = isPlainObject(pair) ? pair.positions : null;
      const valid = Array.isArray(positions) && positions.length === 2 && positions.every((position) => Array.isArray(position) && faces[position[0]] && faces[position[0]][position[1]] === symbol);
      audit.check(valid, id + '：参考配对 ' + JSON.stringify(symbol) + ' 位置无效');
    }
  },

  'gold-miner'(stage, id, audit) {
    const content = stage.content;
    const items = content.items;
    if (!audit.check(Array.isArray(items) && items.length > 0, id + '：items 为空')) return;
    const byId = new Map();
    for (const item of items) if (isPlainObject(item) && isNonEmptyString(item.id)) byId.set(item.id, item);
    audit.check(byId.size === items.length, id + '：item id 重复');
    audit.check(isFiniteNumber(content.targetMoney) && content.targetMoney > 0, id + '：targetMoney 非法');
    audit.check(isFiniteNumber(content.timeLimitSec) && content.timeLimitSec > 0, id + '：timeLimitSec 非法');
    const order = content.referenceCatchOrder;
    if (!audit.check(Array.isArray(order) && order.length > 0 && order.every((itemId) => byId.has(itemId)), id + '：referenceCatchOrder 引用未知 item')) return;
    const witnessValue = order.reduce((sum, itemId) => sum + (isFiniteNumber(byId.get(itemId).value) ? byId.get(itemId).value : 0), 0);
    audit.check(witnessValue >= content.targetMoney, id + '：参考捕获价值 ' + witnessValue + ' < 目标 ' + content.targetMoney);
    const radius = { goldS: 9, goldM: 14, goldL: 20, diamond: 8, rockS: 13, rockL: 19, tnt: 11 };
    for (let index = 0; index < order.length; index += 1) {
      const pick = byId.get(order[index]);
      const x = pick.x - 210;
      const y = pick.y - 104;
      const norm = Math.hypot(x, y);
      if (!audit.check(norm > 0, id + '：捕获目标 ' + order[index] + ' 与钩爪轴重合')) continue;
      const ux = x / norm;
      const uy = y / norm;
      const removed = new Set(order.slice(0, index));
      for (const other of items) {
        if (!isPlainObject(other) || other.id === order[index] || removed.has(other.id)) continue;
        const ax = other.x - 210;
        const ay = other.y - 104;
        const projection = ax * ux + ay * uy;
        const separation = Math.abs(ax * uy - ay * ux);
        const intercepts = projection > 0 && projection < norm && separation < (radius[other.type] || 0) + 12;
        audit.check(!intercepts, id + '：钩爪可能在 ' + order[index] + ' 前拦截 ' + other.id);
      }
    }
  },

  'mole-whack'(stage, id, audit) {
    const content = stage.content;
    const events = content.events;
    if (!audit.check(Array.isArray(events) && events.length > 0, id + '：events 为空')) return;
    audit.check(isFiniteNumber(content.stageDurationSec) && content.stageDurationSec > 0, id + '：stageDurationSec 非法');
    const win = isPlainObject(content.win) ? content.win : {};
    const validEvents = events.filter((event) => isPlainObject(event) && (event.kind === 'gold' || event.kind === 'normal'));
    audit.check(validEvents.length >= win.minValidHits, id + '：有效事件 ' + validEvents.length + ' < 目标 ' + win.minValidHits);
    const goldCount = events.filter((event) => isPlainObject(event) && event.kind === 'gold').length;
    audit.check(goldCount >= (win.minGoldHits || 0), id + '：金鼠事件 ' + goldCount + ' < 目标 ' + (win.minGoldHits || 0));
    let overlaps = 0;
    for (let first = 0; first < events.length; first += 1) {
      for (let second = first + 1; second < events.length; second += 1) {
        const a = events[first];
        const b = events[second];
        if (isPlainObject(a) && isPlainObject(b) && a.slot === b.slot && Math.abs(a.atSec - b.atSec) < Math.min(a.visibleSec, b.visibleSec)) overlaps += 1;
      }
    }
    audit.check(overlaps === 0, id + '：同一洞出现 ' + overlaps + ' 处重叠地鼠');
  },

  'brick-breaker'(stage, id, audit) {
    const content = stage.content;
    const rows = content.brickRows;
    if (!audit.check(Array.isArray(rows) && rows.length === 5 && rows.every((row) => typeof row === 'string' && row.length === 8), id + '：brickRows 不是 5×8')) return;
    audit.check(rows.every((row) => /^[123KG.]+$/.test(row)), id + '：brickRows 含未知砖块 token');
    const hasGate = rows.some((row) => row.includes('G'));
    const hasKey = rows.some((row) => row.includes('K'));
    if (hasGate) audit.check(hasKey, id + '：存在锁门 G 但没有钥匙 K');
  },

  'star-raid'(stage, id, audit) {
    const content = stage.content;
    const events = content.events;
    if (!audit.check(Array.isArray(events) && events.length > 0, id + '：events 为空')) return;
    const duration = content.stageDurationSec;
    audit.check(isFiniteNumber(duration) && duration > 0, id + '：stageDurationSec 非法');
    for (const event of events) {
      const validTime = isPlainObject(event) && isFiniteNumber(event.atSec) && event.atSec > 0 && event.atSec < duration;
      audit.check(validTime, id + '：波次时间非法 ' + JSON.stringify(isPlainObject(event) ? event.atSec : event));
      const validWarn = isPlainObject(event) && isFiniteNumber(event.spawnXRatio) && event.spawnXRatio >= 0 && event.spawnXRatio <= 1 && isFiniteNumber(event.telegraphSec) && event.telegraphSec >= 0.9;
      audit.check(validWarn, id + '：波次预警不足（spawnXRatio 或 telegraphSec < 0.9）');
    }
  },

  'gravity-flip'(stage, id, audit) {
    const content = stage.content;
    const obstacles = content.obstacles;
    if (!audit.check(Array.isArray(obstacles) && obstacles.length > 0, id + '：obstacles 为空')) return;
    audit.check(isFiniteNumber(content.distanceToFinish) && content.distanceToFinish > 0, id + '：distanceToFinish 非法');
    audit.check(isFiniteNumber(content.scrollSpeedPxSec) && content.scrollSpeedPxSec > 0, id + '：scrollSpeedPxSec 非法');
    audit.check(['floor', 'ceiling'].includes(content.startGravity), id + '：startGravity 非法');
    for (let index = 0; index < obstacles.length; index += 1) {
      const obstacle = obstacles[index];
      const validLead = isPlainObject(obstacle) && isFiniteNumber(obstacle.telegraphLeadPx) && obstacle.telegraphLeadPx >= 350;
      audit.check(validLead, id + '：障碍预警距离 < 350px');
      if (index > 0) {
        const previous = obstacles[index - 1];
        const gap = isPlainObject(obstacle) && isPlainObject(previous) ? obstacle.x - previous.x : -Infinity;
        audit.check(gap >= 340, id + '：障碍过密（间距 ' + gap + ' < 340）');
      }
    }
  },

  'pendulum-tower'(stage, id, audit) {
    const content = stage.content;
    const boxes = content.boxes;
    const floors = isPlainObject(content.win) ? content.win.floorsAtLeast : null;
    if (!audit.check(Array.isArray(boxes) && boxes.length > 0, id + '：boxes 为空')) return;
    audit.check(isFiniteNumber(floors) && boxes.length === floors, id + '：箱数 ' + boxes.length + ' ≠ win.floorsAtLeast ' + floors);
    for (const box of boxes) {
      const stable = isPlainObject(box) && isFiniteNumber(box.targetOffsetPx) && Math.abs(box.targetOffsetPx) <= 16 && isFiniteNumber(box.width) && box.width > 0 && isFiniteNumber(box.height) && box.height > 0;
      audit.check(stable, id + '：箱子目标偏置越界（|offset| > 16）或尺寸非法');
    }
  },
};

/* ---------- 运行时挑战数据审计（apps/arcade/challenge/<gameId>.js） ---------- */

/**
 * 读取并校验一个运行时挑战数据文件。
 * 生成物是静态脚本（只写 window.ArcadeChallengeData），用最小 window 沙箱执行即可同时验证语法与内容。
 * @returns {{ok: boolean, data?: object, error?: string}}
 */
function loadRuntimeChallengeFile(filePath) {
  try {
    const source = fs.readFileSync(filePath, 'utf8');
    const sandbox = { window: {} };
    // eslint-disable-next-line no-new-func
    new Function('window', source)(sandbox.window);
    return { ok: true, data: sandbox.window.ArcadeChallengeData };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function auditRuntimeChallengeData(designByGame, audit) {
  if (!fs.existsSync(RUNTIME_CHALLENGE_DIR)) return { present: 0, missing: EXPECTED_GAME_IDS.length };
  const present = [];
  for (const gameId of EXPECTED_GAME_IDS) {
    const filePath = path.join(RUNTIME_CHALLENGE_DIR, gameId + '.js');
    if (!fs.existsSync(filePath)) continue;
    present.push(gameId);
    const loaded = loadRuntimeChallengeFile(filePath);
    if (!loaded.ok) {
      audit.check(false, '运行时 apps/arcade/challenge/' + gameId + '.js 无法执行：' + loaded.error);
      continue;
    }
    const payload = loaded.data && loaded.data[gameId];
    if (!audit.check(isPlainObject(payload), '运行时 ' + gameId + '.js 未写入 window.ArcadeChallengeData[' + JSON.stringify(gameId) + ']')) continue;
    audit.check(payload.gameId === gameId, '运行时 ' + gameId + '.js 的 gameId 字段为 ' + JSON.stringify(payload.gameId));
    audit.check(isNonEmptyString(payload.schemaVersion), '运行时 ' + gameId + '.js 缺少 schemaVersion');
    audit.check(isNonEmptyString(payload.gameName), '运行时 ' + gameId + '.js 缺少 gameName');
    const stages = payload.stages;
    if (!audit.check(Array.isArray(stages) && stages.length === 6, '运行时 ' + gameId + '.js 关卡数 ' + (Array.isArray(stages) ? stages.length : '非数组') + ' ≠ 6')) continue;
    const design = designByGame.get(gameId);
    if (!audit.check(!!design, '运行时 ' + gameId + '.js 存在但设计源缺失，无法比对')) continue;
    audit.check(canonicalize(stages.map((stage) => (isPlainObject(stage) ? stage.id : null))) === canonicalize(design.stages.map((stage) => stage.id)), '运行时 ' + gameId + ' 关卡 id/顺序与设计源不一致');
    for (let index = 0; index < design.stages.length; index += 1) {
      const runtimeStage = stages[index];
      const designStage = design.stages[index];
      if (!audit.check(isPlainObject(runtimeStage), '运行时 ' + designStage.id + ' 不是对象')) continue;
      audit.check(runtimeStage.stageNumber === designStage.stageNumber, '运行时 ' + designStage.id + ' stageNumber 与设计源不一致');
      audit.check(runtimeStage.title === designStage.title, '运行时 ' + designStage.id + ' title 与设计源不一致');
      audit.check(runtimeStage.goalStatement === designStage.goalStatement, '运行时 ' + designStage.id + ' goalStatement 与设计源不一致');
      audit.check(canonicalize(runtimeStage.requiredFeatures) === canonicalize(designStage.integration.requiredFeatures), '运行时 ' + designStage.id + ' requiredFeatures 与设计源不一致');
      const runtimeContent = runtimeStage.content;
      if (!audit.check(isPlainObject(runtimeContent), '运行时 ' + designStage.id + ' content 缺失')) continue;
      for (const key of Object.keys(designStage.content)) {
        audit.check(canonicalize(runtimeContent[key]) === canonicalize(designStage.content[key]), '运行时 ' + designStage.id + ' content.' + key + ' 与设计源原值不一致');
      }
    }
  }
  return { present: present.length, missing: EXPECTED_GAME_IDS.length - present.length };
}

/* ---------- 全局挑战门禁场景（内置，属于 challenge suite） ---------- */

const CH_DATA_SCENARIO = {
  id: 'CH-DATA-001',
  title: '0.9 全量数据门禁·13 游戏 × 6 关设计源审计 + 运行时数据一致性',
  suite: 'challenge',
  source: 'global',
  game: null,
  gameId: null,
  needsBrowser: false,
  async run(cdp, ctx) {
    const audit = createAudit();
    const designByGame = new Map();
    const seenStageIds = new Set();
    if (audit.check(fs.existsSync(LEVELS_DIR), '设计源目录缺失：docs/arcade/0.9/levels')) {
      const designFiles = fs.readdirSync(LEVELS_DIR).filter((name) => name.endsWith('.json')).sort();
      for (const gameId of EXPECTED_GAME_IDS) {
        const filePath = path.join(LEVELS_DIR, gameId + '.json');
        if (!audit.check(fs.existsSync(filePath), gameId + '：设计源缺失 docs/arcade/0.9/levels/' + gameId + '.json')) continue;
        let data = null;
        try {
          data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (err) {
          audit.check(false, gameId + '：设计源 JSON 解析失败 — ' + err.message);
          continue;
        }
        if (!audit.check(isPlainObject(data), gameId + '：设计源顶层不是对象')) continue;
        audit.check(data.gameId === gameId, gameId + '：设计源 gameId 字段为 ' + JSON.stringify(data.gameId));
        audit.check(isNonEmptyString(data.gameName), gameId + '：gameName 为空');
        const stages = data.stages;
        if (!audit.check(Array.isArray(stages) && stages.length === 6, gameId + '：关卡数 ' + (Array.isArray(stages) ? stages.length : '非数组') + ' ≠ 6')) continue;
        designByGame.set(gameId, data);
        for (let index = 0; index < stages.length; index += 1) {
          const stage = stages[index];
          auditStageContract(gameId, index + 1, stage, audit);
          const stageId = isPlainObject(stage) && isNonEmptyString(stage.id) ? stage.id : gameId + '-C' + String(index + 1).padStart(2, '0');
          if (isPlainObject(stage) && isNonEmptyString(stage.id)) {
            audit.check(!seenStageIds.has(stage.id), '关卡 id 重复：' + stage.id);
            seenStageIds.add(stage.id);
          }
          const contentCheck = CONTENT_CHECKS[gameId];
          if (isPlainObject(stage) && isPlainObject(stage.content) && typeof contentCheck === 'function') contentCheck(stage, stageId, audit);
        }
      }
      audit.check(designByGame.size === EXPECTED_GAME_IDS.length, '设计源有效游戏数 ' + designByGame.size + ' ≠ ' + EXPECTED_GAME_IDS.length);
      audit.check(seenStageIds.size === EXPECTED_GAME_IDS.length * 6, '全量关卡 id 数 ' + seenStageIds.size + ' ≠ ' + (EXPECTED_GAME_IDS.length * 6));
      /* 额外 json 只提示不判失败：设计包允许后续补充说明性文件。 */
      const unexpectedFiles = designFiles.filter((name) => !EXPECTED_GAME_IDS.includes(name.replace(/\.json$/, '')));
      if (unexpectedFiles.length) printSkip('CH-DATA-001/extra', '设计源额外 json 文件', unexpectedFiles.join(', '));
    }
    const designChecks = audit.checks;
    const runtime = auditRuntimeChallengeData(designByGame, audit);
    const runtimeChecks = audit.checks - designChecks;
    if (runtime.present === 0) {
      printSkip('CH-DATA-001/runtime', '运行时挑战数据', 'apps/arcade/challenge/*.js 尚未生成 → 运行时一致性检查 SKIP（设计源检查照常执行）');
    }
    audit.finish('0.9 数据门禁失败');
    return {
      games: designByGame.size,
      stages: seenStageIds.size,
      designChecks,
      runtime: runtime.present === 0 ? 'absent(SKIP)' : runtime.present + '/' + EXPECTED_GAME_IDS.length,
      runtimeChecks,
    };
  },
};

const CH_CLASSIC_SCENARIO = {
  id: 'CH-CLASSIC-001',
  title: '0.9 经典回归·13 游戏开始弹层主按钮仍启动经典',
  suite: 'challenge',
  source: 'global',
  game: null,
  gameId: null,
  needsBrowser: true,
  async run(cdp) {
    const failures = [];
    const check = (condition, message) => {
      if (!condition) failures.push(message);
      return !!condition;
    };
    await cdp.navigate(BASE + '/apps/arcade/');
    await cdp.evaluate('localStorage.clear()');
    const hall = await cdp.evaluate(`(() => {
      const games = window.Arcade && Array.isArray(Arcade.GAMES) ? Arcade.GAMES.map((game) => ({ id: game.id, file: game.file, name: game.name })) : [];
      return { hasArcade: !!window.Arcade, version: window.Arcade && Arcade.version, games };
    })()`);
    check(hall.hasArcade, '中心页 Arcade 运行时缺失');
    check(hall.games.length === EXPECTED_GAME_IDS.length, '中心页游戏数 ' + hall.games.length + ' ≠ ' + EXPECTED_GAME_IDS.length);
    const hallIds = hall.games.map((game) => game.id).sort();
    check(canonicalize(hallIds) === canonicalize(EXPECTED_GAME_IDS.slice().sort()), '中心页游戏清单与 0.9 设计源不一致：' + hallIds.join(','));
    let classicStarted = 0;
    let entryButtons = 0;
    let challengeEntryVisible = 0;
    let legacyVisibleEntries = 0;
    let challengePanels = 0;
    for (const game of hall.games) {
      await cdp.navigate(BASE + '/apps/arcade/games/' + game.file + '?ch009-classic=' + encodeURIComponent(game.id) + '#test');
      const ready = await cdp.evaluate(`(() => {
        const gameId = ${JSON.stringify(game.id)};
        const overlay = document.querySelector('[data-overlay]');
        const btn = document.querySelector('[data-ov-btn]');
        const btn2 = document.querySelector('[data-ov-btn2]');
        const panel = document.querySelector('.ac-challenge-panel');
        const rect = btn ? btn.getBoundingClientRect() : null;
        const api = window.Arcade && Arcade.Challenge;
        let challengeStages = -1;
        try {
          if (api && typeof api.stages === 'function') challengeStages = api.stages(gameId).length;
        } catch (err) {
          challengeStages = -2;
        }
        return {
          hasArcade: !!window.Arcade,
          hasHooks: !!window.__arcadeTest,
          challengeStages,
          entryTextPresent: (document.body.textContent || '').indexOf('挑战 6 关') !== -1,
          overlayVisible: !!overlay && !overlay.hidden,
          btnExists: !!btn,
          btnVisible: !!(rect && rect.width > 0 && rect.height > 0),
          btnDisabled: !!(btn && btn.disabled),
          btnText: btn ? btn.textContent.trim() : null,
          btn2Exists: !!btn2,
          btn2Visible: !!(btn2 && !btn2.hidden),
          btn2Text: btn2 ? btn2.textContent.trim() : null,
          panelExists: !!panel,
          panelVisible: !!(panel && !panel.hidden)
        };
      })()`);
      const prefix = game.id + '：';
      check(ready.hasArcade, prefix + 'Arcade 运行时未加载');
      check(ready.hasHooks, prefix + '#test 钩子缺失');
      check(ready.challengeStages === 6, prefix + 'A.Challenge.stages(gameId) 应有 6 关，实际 ' + ready.challengeStages + '（挑战数据脚本未加载或数据损坏）');
      check(ready.entryTextPresent, prefix + '开始弹层缺少「挑战 6 关」入口文案（挑战入口未接入）');
      check(ready.overlayVisible, prefix + '开始弹层不可见');
      check(ready.btnExists && ready.btnVisible && !ready.btnDisabled, prefix + '[data-ov-btn] 不存在/不可见/禁用');
      check(ready.btnText === '开始游戏', prefix + '经典主按钮文案应保持「开始游戏」，实际 ' + JSON.stringify(ready.btnText));
      if (ready.btn2Exists) {
        entryButtons += 1;
        /* 开始弹层第二按钮在 0.8 已可能被经典流程占用（如影跃「影之试炼」）；
           0.9 挑战入口文案含「挑战」。此处只统计不判失败，挑战入口行为由各游戏模块断言。 */
        if (ready.btn2Visible) {
          if (/挑战/.test(ready.btn2Text || '')) challengeEntryVisible += 1;
          else legacyVisibleEntries += 1;
        }
      }
      if (ready.panelExists) {
        challengePanels += 1;
        check(ready.panelVisible === false, prefix + '挑战选关面板在开始弹层默认应为隐藏');
      }
      const errorsBeforeClick = cdp.errors.length;
      try {
        if (ready.btnExists) await cdp.click('[data-ov-btn]');
        /* 经典开始的通用信号与 arcade_smoke 一致：开始弹层隐藏（各游戏 joyInfo/info 是否暴露 state 不一致）。 */
        await cdp.waitFor('!!document.querySelector("[data-overlay]") && document.querySelector("[data-overlay]").hidden', { timeout: 8000 });
        const started = await cdp.evaluate(`(() => {
          const overlay = document.querySelector('[data-overlay]');
          const t = window.__arcadeTest;
          const state = t && t.info && t.info() && typeof t.info().state === 'string' ? t.info().state : null;
          return { state, overlayHidden: !!overlay && overlay.hidden };
        })()`);
        check(started.overlayHidden === true, prefix + '点击经典主按钮后开始弹层未隐藏');
        if (started.overlayHidden) classicStarted += 1;
        if (cdp.errors.length > errorsBeforeClick) failures.push(prefix + '启动经典时报错：' + cdp.errors.join(' | '));
        try {
          await cdp.screenshot('challenge-classic-' + game.id + '.png');
        } catch (err) {
          /* 截图失败不影响判定 */
        }
      } catch (err) {
        failures.push(prefix + '启动经典失败：' + err.message);
      }
    }
    await cdp.evaluate('localStorage.clear()');
    if (failures.length) throw new Error(failures.length + ' 项经典回归失败：' + failures.slice(0, 8).join('；') + (failures.length > 8 ? '；…' : ''));
    return {
      games: hall.games.length,
      classicStarted,
      mainButton: '开始游戏',
      entryButtons,
      challengeEntryVisible,
      legacyVisibleEntries,
      challengePanels,
    };
  },
};

const GLOBAL_CHALLENGE_SCENARIOS = [CH_DATA_SCENARIO, CH_CLASSIC_SCENARIO];

/* ---------- 挑战场景模块发现 / 目录（tools/challenge/*.mjs） ---------- */

/**
 * 校验一个模块的默认导出结构；返回错误字符串，合法时返回 null。
 * 结构错误必须 FAIL（不能静默忽略），否则游戏 Agent 的模块会被悄悄跳过。
 */
function validateChallengeModule(definition, moduleFile) {
  if (!isPlainObject(definition)) return '默认导出不是对象（应为 { gameId, gameFile, scenarios }）';
  if (!isNonEmptyString(definition.gameId)) return 'gameId 缺失或不是非空字符串';
  if (!EXPECTED_GAME_IDS.includes(definition.gameId)) return 'gameId 不在 0.9 的 13 款游戏内：' + JSON.stringify(definition.gameId);
  if (!isNonEmptyString(definition.gameFile) || !definition.gameFile.endsWith('.html')) return 'gameFile 缺失或不是 .html 文件名';
  if (!fs.existsSync(path.join(GAMES_DIR, definition.gameFile))) return 'gameFile 不存在：apps/arcade/games/' + definition.gameFile;
  if (!Array.isArray(definition.scenarios) || definition.scenarios.length === 0) return 'scenarios 必须是非空数组';
  if (definition.evidence !== undefined && !CHALLENGE_EVIDENCE_LEVELS.includes(definition.evidence)) return 'module.evidence 非法（应为 ' + CHALLENGE_EVIDENCE_LEVELS.join('/') + '）：' + JSON.stringify(definition.evidence);
  const seen = new Set();
  for (let index = 0; index < definition.scenarios.length; index += 1) {
    const scenario = definition.scenarios[index];
    const label = 'scenarios[' + index + ']';
    if (!isPlainObject(scenario)) return label + ' 不是对象';
    if (!isNonEmptyString(scenario.id)) return label + '.id 缺失';
    if (!/^CH-[A-Z0-9]+-\d{3}$/.test(scenario.id)) return label + '.id 不合协议（应为 CH-<GAME>-<NNN>）：' + scenario.id;
    if (seen.has(scenario.id)) return '模块内场景 ID 重复：' + scenario.id;
    seen.add(scenario.id);
    if (!isNonEmptyString(scenario.title)) return scenario.id + '：title 缺失';
    if (typeof scenario.run !== 'function') return scenario.id + '：run(cdp, ctx) 不是函数';
    if (scenario.setup !== undefined && typeof scenario.setup !== 'function') return scenario.id + '：setup(cdp, base) 不是函数';
    if (scenario.pending !== undefined && !isNonEmptyString(scenario.pending)) return scenario.id + '：pending 应是非空字符串（原因）';
    if (scenario.evidence !== undefined && !CHALLENGE_EVIDENCE_LEVELS.includes(scenario.evidence)) return scenario.id + '：evidence 非法（应为 ' + CHALLENGE_EVIDENCE_LEVELS.join('/') + '）：' + JSON.stringify(scenario.evidence);
    if (scenario.needsBrowser !== undefined && typeof scenario.needsBrowser !== 'boolean') return scenario.id + '：needsBrowser 应为布尔值';
  }
  return null;
}

/**
 * 自动发现 tools/challenge/*.mjs。
 * - 目录不存在 / 为空：不是错误（0.9 模块尚未交付时正常跳过）；
 * - 模块加载失败 / 结构非法：收集到 errors，由 runner 输出 FAIL 并影响退出码。
 */
async function discoverChallengeModules() {
  const discovery = { found: false, modules: [], errors: [] };
  if (!fs.existsSync(CHALLENGE_MODULES_DIR)) return discovery;
  discovery.found = true;
  const files = fs.readdirSync(CHALLENGE_MODULES_DIR).filter((name) => name.endsWith('.mjs')).sort();
  for (const name of files) {
    const fullPath = path.join(CHALLENGE_MODULES_DIR, name);
    const moduleFile = path.relative(REPO_ROOT, fullPath).split(path.sep).join('/');
    let definition;
    try {
      const imported = await import(pathToFileURL(fullPath).href);
      definition = imported.default;
    } catch (err) {
      discovery.errors.push({ file: moduleFile, message: '模块加载失败：' + (err && err.message ? err.message : String(err)) });
      continue;
    }
    const structureError = validateChallengeModule(definition, moduleFile);
    if (structureError) {
      discovery.errors.push({ file: moduleFile, message: structureError });
      continue;
    }
    discovery.modules.push({ file: moduleFile, fullPath, definition });
  }
  return discovery;
}

/** 合并 base / 全局 challenge / 模块场景，处理重复 gameId 与重复场景 ID。 */
function buildCatalog(discovery) {
  const base = SCENARIOS.map((scenario) => ({
    ...scenario,
    suite: 'base',
    source: 'base',
    gameId: scenario.game ? scenario.game.replace(/\.html$/, '') : null,
    needsBrowser: true,
    evidence: scenario.evidence || 'unspecified',
  }));
  const globals = GLOBAL_CHALLENGE_SCENARIOS.map((scenario) => ({ ...scenario }));
  const modules = [];
  const duplicateScenarios = [];
  const seenIds = new Set(base.concat(globals).map((scenario) => scenario.id));
  const moduleGameIds = new Map();
  for (const module of discovery.modules) {
    const definition = module.definition;
    if (moduleGameIds.has(definition.gameId)) {
      discovery.errors.push({ file: module.file, message: 'gameId ' + definition.gameId + ' 与 ' + moduleGameIds.get(definition.gameId) + ' 重复（每款游戏只允许一个模块）' });
      continue;
    }
    moduleGameIds.set(definition.gameId, module.file);
    const moduleEvidence = definition.evidence || null;
    for (const scenario of definition.scenarios) {
      if (seenIds.has(scenario.id)) {
        duplicateScenarios.push(scenario.id + '（' + module.file + '）');
        continue;
      }
      seenIds.add(scenario.id);
      modules.push({
        ...scenario,
        game: definition.gameFile,
        gameId: definition.gameId,
        suite: 'challenge',
        source: 'module',
        moduleFile: module.file,
        evidence: scenario.evidence || moduleEvidence || 'unspecified',
        needsBrowser: scenario.needsBrowser !== false,
      });
    }
  }
  return { base, globals, modules, all: base.concat(globals, modules), discovery, duplicateScenarios };
}

function describeDiscovery(discovery) {
  if (!discovery.found) return 'tools/challenge/ 不存在 → 0 个模块（挑战场景层跳过）';
  if (!discovery.modules.length && !discovery.errors.length) return 'tools/challenge/ 为空 → 0 个模块（挑战场景层跳过）';
  const loaded = discovery.modules.map((module) => module.file.replace(/^tools\/challenge\//, ''));
  return 'tools/challenge/*.mjs → ' + discovery.modules.length + ' 个有效模块' + (discovery.errors.length ? ' / ' + discovery.errors.length + ' 个错误' : '') + (loaded.length ? '（' + loaded.join(', ') + '）' : '');
}

/**
 * 场景筛选：
 * - --scenario 显式选择（可跨 suite，受 --suite/--game 约束）；
 * - 否则按 --suite 取池，--game 只筛挑战模块场景（全局门禁不参与 --game）。
 * @returns {{selected: object[], skips: {id: string, title: string, reason: string}[]}}
 */
function selectScenarios(options, catalog) {
  const skips = [];
  if (options.scenarioIds.length) {
    const byId = new Map(catalog.all.map((scenario) => [scenario.id, scenario]));
    const selected = [];
    for (const id of options.scenarioIds) {
      const scenario = byId.get(id);
      if (!scenario) throw new UsageError('未知场景 ID：' + id + '\n可用场景：' + catalog.all.map((item) => item.id).join(', '));
      if (options.suite !== 'all' && scenario.suite !== options.suite) throw new UsageError('场景 ' + id + ' 属于 ' + scenario.suite + ' suite，与 --suite=' + options.suite + ' 冲突');
      if (options.gameId && scenario.gameId !== options.gameId) throw new UsageError('场景 ' + id + ' 不属于 --game=' + options.gameId);
      if (!selected.includes(scenario)) selected.push(scenario);
    }
    return { selected, skips };
  }
  if (options.suite === 'base') {
    return { selected: catalog.base.slice(), skips };
  }
  if (options.gameId) {
    const gameScenarios = catalog.modules.filter((scenario) => scenario.gameId === options.gameId);
    if (!gameScenarios.length) {
      skips.push({
        id: options.gameId,
        title: '挑战场景模块',
        reason: 'tools/challenge/' + options.gameId + '.mjs 不存在（游戏 Agent 尚未交付；模块出现后自动生效）',
      });
      return { selected: [], skips };
    }
    return { selected: gameScenarios, skips };
  }
  if (!catalog.modules.length) {
    skips.push({
      id: 'challenge-modules',
      title: '挑战场景模块',
      reason: (catalog.discovery.found ? 'tools/challenge/ 下暂无 *.mjs' : 'tools/challenge/ 不存在') + '（游戏 Agent 尚未交付；出现后自动发现）',
    });
  }
  const selected = options.suite === 'challenge' ? catalog.globals.concat(catalog.modules) : catalog.all.slice();
  return { selected, skips };
}

/* ---------- CLI ---------- */
function printUsage() {
  console.log(`用法：node tools/arcade_gameplay_test.mjs [选项]

  --list                  列出全部场景 ID / 标题 / 游戏 / suite（不启动 Chrome）
  --scenario=<id>         只跑指定场景；可重复传入多个（base 与 challenge 均可）
  --suite=base|challenge|all
                          场景层：base = 0.8 的 11 个确定性场景；
                          challenge = 全局门禁 + 已发现的挑战场景模块；默认 all
  --game=<gameId>         只跑该游戏的挑战模块场景（隐含 --suite=challenge；
                          模块尚未交付时打印 SKIP，不判失败）
  --repeat=<n>            每个场景连续跑 n 遍（默认 1，1-20），用于确定性复跑
  --help                  显示本帮助

端口（避免与 arcade_smoke 默认端口冲突）：
  ARCADE_GAMEPLAY_PORT      本地静态服务器，默认 8766
  ARCADE_GAMEPLAY_CDP_PORT  Chrome DevTools 端口，默认 9334
  CHROME_PATH               自定义 Chrome 可执行文件路径

场景模块协议 / 证据等级 / 端口并发约定见 docs/arcade/0.9/TESTING.md。`);
}

function parseRepeat(raw) {
  const repeat = Number(raw);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) throw new UsageError('--repeat 需要 1-20 的整数，当前为 ' + JSON.stringify(raw));
  return repeat;
}

class UsageError extends Error {}

const SUITE_VALUES = ['base', 'challenge', 'all'];

function parseSuite(raw) {
  if (!SUITE_VALUES.includes(raw)) throw new UsageError('--suite 只接受 base|challenge|all，当前为 ' + JSON.stringify(raw));
  return raw;
}

function parseGameId(raw) {
  if (!isNonEmptyString(raw)) throw new UsageError('--game= 不能为空');
  const gameId = raw.trim();
  if (!EXPECTED_GAME_IDS.includes(gameId)) {
    throw new UsageError('--game 的 gameId 必须是 0.9 的 13 款游戏之一：' + EXPECTED_GAME_IDS.join(', ') + '（当前 ' + JSON.stringify(raw) + '）');
  }
  return gameId;
}

function parseArgs(argv) {
  const options = { help: false, list: false, repeat: 1, scenarioIds: [], suite: 'all', gameId: null };
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
    } else if (arg === '--suite') {
      options.suite = parseSuite(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--suite=')) {
      options.suite = parseSuite(arg.slice('--suite='.length));
    } else if (arg === '--game') {
      options.gameId = parseGameId(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--game=')) {
      options.gameId = parseGameId(arg.slice('--game='.length));
    } else {
      throw new UsageError('未知参数：' + arg + '（用 --help 查看用法）');
    }
  }
  if (options.gameId && options.suite === 'base') throw new UsageError('--game 只筛选挑战模块场景，不能与 --suite=base 同时使用');
  if (options.gameId && options.suite === 'all') options.suite = 'challenge';
  return options;
}

function printList(catalog) {
  const activeCount = catalog.all.filter((scenario) => !scenario.pending).length;
  console.log('可用确定性场景（' + catalog.all.length + ' 个，其中启用 ' + activeCount + '）：');
  for (const scenario of catalog.all) {
    const gameLabel = scenario.game || 'global';
    const evidence = scenario.evidence && scenario.evidence !== 'unspecified' ? ' · ' + scenario.evidence : '';
    console.log(
      '  ' +
        scenario.id.padEnd(15) +
        scenario.title +
        '  [' +
        gameLabel +
        ']  (' +
        scenario.suite +
        evidence +
        ')' +
        (scenario.pending ? '  [PENDING]' : '')
    );
  }
  console.log('模块发现：' + describeDiscovery(catalog.discovery));
  for (const error of catalog.discovery.errors) console.log('ERROR  ' + error.file + ' — ' + error.message);
  console.log('提示：--suite=base|challenge|all · --game=<gameId> · --scenario=<id> · --repeat=<n>');
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
  const queryKey = scenario.suite === 'base' ? 'gp003' : 'ch009';
  const url = BASE + '/apps/arcade/games/' + scenario.game + '?' + queryKey + '=' + encodeURIComponent(scenario.id + '-' + attempt) + '#test';
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

/**
 * 传给场景 run(cdp, ctx) 的上下文（挑战模块协议，见 docs/arcade/0.9/TESTING.md）。
 * 游戏 Agent 的模块可只依赖 cdp；需要断言/等待/读设计源时用 ctx 里的通用 helper。
 */
function buildScenarioContext(scenario, attempt, options) {
  return {
    base: BASE,
    repoRoot: REPO_ROOT,
    artifacts: ARTIFACTS,
    assert,
    record,
    sleep,
    round1,
    gameId: scenario.gameId || null,
    gameFile: scenario.game || null,
    scenarioId: scenario.id,
    suite: scenario.suite,
    source: scenario.source,
    moduleFile: scenario.moduleFile || null,
    evidenceLevel: scenario.evidence || null,
    attempt,
    repeat: options.repeat,
  };
}

async function runScenario(cdp, scenario, attempt, options) {
  const evidenceSuffix = scenario.evidence && scenario.evidence !== 'unspecified' ? ' · evidence=' + scenario.evidence : '';
  const sourceSuffix = scenario.source === 'module' ? ' [' + scenario.moduleFile + ']' : '';
  try {
    const usesBrowser = scenario.needsBrowser !== false;
    if (usesBrowser && scenario.game) await prepareScenario(cdp, scenario, attempt);
    const context = buildScenarioContext(scenario, attempt, options);
    if (typeof scenario.setup === 'function') await scenario.setup(cdp, BASE);
    if (usesBrowser && cdp.errors.length) throw new Error('页面加载/初始化报错：' + cdp.errors.join(' | '));
    const evidence = await scenario.run(cdp, context);
    if (usesBrowser && cdp.errors.length) throw new Error('场景运行期间页面报错：' + cdp.errors.join(' | '));
    if (usesBrowser) {
      try {
        await cdp.screenshot('gameplay-' + scenario.id + (attempt > 1 ? '-r' + attempt : '') + '.png');
      } catch (err) {
        /* 截图失败不影响场景判定 */
      }
    }
    record(scenario.id + ' ' + scenario.title, true, formatEvidence(evidence) + evidenceSuffix);
    return true;
  } catch (err) {
    record(scenario.id + ' ' + scenario.title, false, err.message + sourceSuffix);
    return false;
  }
}

function printScenarioHeader(activeScenarios, pendingScenarios, options, catalog, skips, needsBrowser) {
  console.log(
    '# Arcade 确定性玩法场景 · ' +
      activeScenarios.length +
      ' 个启用' +
      (pendingScenarios.length ? ' / ' + pendingScenarios.length + ' 个 pending' : '') +
      ' × ' +
      options.repeat +
      ' 遍'
  );
  console.log(
    '# suite=' +
      options.suite +
      (options.gameId ? ' · --game=' + options.gameId : '') +
      ' · base=' +
      catalog.base.length +
      ' · challenge=全局 ' +
      catalog.globals.length +
      ' + 模块 ' +
      catalog.modules.length
  );
  if (needsBrowser) console.log('# 静态服务器 http://127.0.0.1:' + SERVER_PORT + ' · CDP 端口 ' + CDP_PORT + ' · 截图 ' + path.relative(REPO_ROOT, ARTIFACTS));
  console.log('# 模块发现：' + describeDiscovery(catalog.discovery));
  for (const skip of skips) console.log('SKIP  ' + skip.id + ' ' + skip.title + ' — ' + skip.reason);
  for (const scenario of activeScenarios) {
    const source = scenario.source === 'module' ? ' ← ' + scenario.moduleFile : '';
    console.log('# ' + scenario.id + ' ' + scenario.title + ' [' + (scenario.game || 'global') + ']' + source);
  }
  for (const scenario of pendingScenarios) console.log('SKIP  ' + scenario.id + ' ' + scenario.title + ' — ' + scenario.pending);
  console.log('');
}

/** 挑战模块证据/结果汇总（供 Phase 2 写 docs/arcade/0.9/TESTING.md 的汇总表）。 */
function collectModuleResults(selected) {
  const stats = new Map();
  for (const scenario of selected) {
    if (scenario.source !== 'module') continue;
    if (!stats.has(scenario.gameId)) stats.set(scenario.gameId, { scenarios: 0, attempts: 0, pass: 0, fail: 0, evidence: new Set() });
    const stat = stats.get(scenario.gameId);
    stat.scenarios += 1;
    if (scenario.evidence && scenario.evidence !== 'unspecified') stat.evidence.add(scenario.evidence);
  }
  return stats;
}

function printModuleSummary(stats) {
  if (!stats.size) return;
  console.log('\n# 挑战模块证据汇总（gameId → 场景数 / 证据等级 / PASS·FAIL 尝试数）：');
  for (const gameId of EXPECTED_GAME_IDS) {
    const stat = stats.get(gameId);
    if (!stat) continue;
    console.log(
      '#   ' +
        gameId.padEnd(15) +
        ' 场景=' +
        stat.scenarios +
        ' 证据=' +
        ([...stat.evidence].join('+') || 'unspecified') +
        ' PASS=' +
        stat.pass +
        ' FAIL=' +
        stat.fail
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  const discovery = await discoverChallengeModules();
  const catalog = buildCatalog(discovery);
  if (options.list) {
    printList(catalog);
    return;
  }
  const { selected, skips } = selectScenarios(options, catalog);
  const activeScenarios = selected.filter((scenario) => !scenario.pending);
  const pendingScenarios = selected.filter((scenario) => scenario.pending);
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const needsBrowser = activeScenarios.some((scenario) => scenario.needsBrowser !== false);
  printScenarioHeader(activeScenarios, pendingScenarios, options, catalog, skips, needsBrowser);

  /* 模块加载/结构错误与重复场景 ID 必须显式 FAIL（不能静默忽略游戏 Agent 的模块问题）。 */
  for (const error of discovery.errors) record('CH-MODULE ' + error.file, false, error.message);
  for (const id of catalog.duplicateScenarios) record('CH-MODULE 场景 ID 冲突 ' + id, false, '场景 ID 与其它模块/内置场景重复，已跳过该模块场景');

  if (!activeScenarios.length) {
    const outcome = summary('scenario runs');
    if (outcome.failed) process.exitCode = 1;
    return;
  }

  const moduleStats = collectModuleResults(activeScenarios);
  let server = null;
  let launched = null;
  let cdp = null;
  try {
    if (needsBrowser) {
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
    }
    for (const scenario of activeScenarios) {
      for (let attempt = 1; attempt <= options.repeat; attempt += 1) {
        const passed = await runScenario(cdp, scenario, attempt, options);
        if (scenario.source === 'module') {
          const stat = moduleStats.get(scenario.gameId);
          if (stat) {
            stat.attempts += 1;
            if (passed) stat.pass += 1;
            else stat.fail += 1;
          }
        }
        if (needsBrowser) await sleep(80);
      }
    }
  } finally {
    if (cdp) cdp.close();
    if (server) server.close();
    await stopChrome(launched || {});
  }

  printModuleSummary(moduleStats);
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
