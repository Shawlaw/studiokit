#!/usr/bin/env node
/**
 * StudioKit Arcade Life 0.17 — D17-09 brick-breaker 六阶职业委托 fixture。
 *
 * 契约：docs/arcade-life/ADR-interfaces.md §19.2 / §19.3 / §19.4 / §19.8
 * - 目标真值来自 content/commissions.json：
 *   T1 brick.destroyed≥8、T2 ≥15、T3 stage.clear≥1、T4 ≥22、T5 stage.clear≥1、T6 ≥30；
 * - 驱动全部走真实页面行为：
 *   真实开始按钮 [data-ov-btn] → 真实发球手势（pointerdown/up，必要时回退到真实 launch()）
 *   → 真实 update() 物理与真实挡板接球（#test 专用 setAutoPaddle 只改 paddle.x）
 *   → 真实 pause 按钮冻结物理 → 真实 hitBrick() 归零路径补足砖数
 *   → 真实 resume + update() 检测“一层全清”提交 stage.clear；
 *   事件由页面真实 hitBrick()/update() 在状态提交后调用 bridge 提交，本 fixture 不伪造事件；
 * - success：把真实状态驱动到目标（≥ atLeast），断言事件缓冲与页面计数一致后暂停，交 runner 结算；
 * - failure：
 *   brick 阶真实击碎 atLeast-3 块（< atLeast）后暂停 → objective-not-met；
 *   stage 阶真实击碎若干砖但不清层（stage.clear=0）后暂停 → objective-not-met；
 * - T4–T6 先 seedStoryFlags（C3/C4/C5）再 startCommission；不改变生产可见性；
 * - 每阶 success 断言 serialize()=null、挑战入口隐藏、经典 5 键逐字节不变、plays/high/scores 不变。
 *
 * 只由 tools/career_mission_fixture_runner.mjs 装载（或仓库外等价 harness 以同一 helper 面驱动）。
 */

export const gameId = 'brick-breaker';

/* 内容真值兜底（runner 的 getCommission(tier) 可用时以内容为准）。 */
const TIER_OBJECTIVE = {
  1: { kind: 'brick.destroyed', atLeast: 8 },
  2: { kind: 'brick.destroyed', atLeast: 15 },
  3: { kind: 'stage.clear', atLeast: 1 },
  4: { kind: 'brick.destroyed', atLeast: 22 },
  5: { kind: 'stage.clear', atLeast: 1 },
  6: { kind: 'brick.destroyed', atLeast: 30 },
};
/* T4–T6 章节旗标（ADR §19.2：T4 C3.truth_found / T5 C4.city_power_restored / T6 C5.star_tower_resolved）。 */
const TIER_CHAPTER_FLAG = { 4: 'C3.truth_found', 5: 'C4.city_power_restored', 6: 'C5.star_tower_resolved' };
/* 职业 run 不得改动的经典键（逐字节对照）。 */
const ISO_KEYS = [
  'studiokit:arcade:runs:v1',
  'studiokit:arcade:progress:v1',
  'studiokit:arcade:scores:v1',
  'studiokit:arcade:challenge:v1',
  'studiokit:arcade:meta:v1',
];
/* failure 留出足够余量：真实物理只推进到 1 块，再按 atLeast-3 补齐。 */
const FAILURE_SHORTFALL = 3;
/* 真实物理推进的单次步长（1/60 固定步长，与真实 loop 一致）。 */
const STEP_SECONDS = 0.4;
const TICKET_KEY = 'studiokit:arcade:career:ticket.v1';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function invariant(condition, message) {
  if (!condition) throw new Error('[brick-breaker fixture] ' + message);
}

function helperBag(ctx) {
  return ctx && ctx.helpers && typeof ctx.helpers === 'object' ? ctx.helpers : {};
}

async function evaluate(ctx, expression) {
  const bag = helperBag(ctx);
  if (typeof bag.evaluate === 'function') return bag.evaluate(expression);
  invariant(ctx && ctx.cdp && typeof ctx.cdp.evaluate === 'function', 'ctx.cdp.evaluate 缺失（ADR §19.8）');
  return ctx.cdp.evaluate(expression);
}

async function waitFor(ctx, expression, timeout = 9000, interval = 80) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(ctx, expression);
    } catch (err) {
      last = null;
    }
    if (last) return last;
    await sleep(interval);
  }
  throw new Error('[brick-breaker fixture] 等待超时：' + expression + '（最后值 ' + JSON.stringify(last) + '）');
}

/* ------------------------------------------------------------------ *
 * 只读读取
 * ------------------------------------------------------------------ */

async function careerInfo(ctx) {
  return evaluate(
    ctx,
    '(function(){ try { return window.__arcadeTest && typeof window.__arcadeTest.careerInfo === "function" ? window.__arcadeTest.careerInfo() : null; } catch (e) { return null; } })()'
  );
}

async function gameInfo(ctx) {
  return evaluate(
    ctx,
    '(function(){ try { return window.__arcadeTest && typeof window.__arcadeTest.info === "function" ? window.__arcadeTest.info() : null; } catch (e) { return null; } })()'
  );
}

async function commissionEvents(ctx) {
  const state = await evaluate(
    ctx,
    '(function(){ try { var t = window.__arcadeCareerTest; var s = t && typeof t.commissionState === "function" ? t.commissionState() : null; return s && Array.isArray(s.events) ? s.events : []; } catch (e) { return []; } })()'
  );
  return Array.isArray(state) ? state : [];
}

async function lastCommissionResult(ctx) {
  return evaluate(
    ctx,
    '(function(){ try { var t = window.__arcadeCareerTest; var info = t && typeof t.info === "function" ? t.info() : null; return info && info.commissionLastResult ? info.commissionLastResult : null; } catch (e) { return null; } })()'
  );
}

async function snapshotIsolation(ctx) {
  return evaluate(
    ctx,
    '(function(){ var keys = ' +
      JSON.stringify(ISO_KEYS) +
      '; var out = {}; keys.forEach(function (key) { try { out[key] = localStorage.getItem(key); } catch (e) { out[key] = null; } }); return out; })()'
  );
}

function assertIsolation(before, after) {
  ISO_KEYS.forEach((key) => {
    invariant(
      before && after && before[key] === after[key],
      '职业 run 写入了经典键 ' + key + '：' + JSON.stringify({ before: before && before[key], after: after && after[key] })
    );
  });
}

function objectiveOf(ctx) {
  try {
    const bag = helperBag(ctx);
    const commission = typeof bag.getCommission === 'function' ? bag.getCommission(ctx.tier) : null;
    const objective = commission && commission.objective ? commission.objective : null;
    if (objective && typeof objective.kind === 'string' && Number.isFinite(Number(objective.atLeast))) {
      return { kind: objective.kind, atLeast: Math.max(1, Math.floor(Number(objective.atLeast))) };
    }
  } catch (err) {
    /* 回退内容真值 */
  }
  return Object.assign({}, TIER_OBJECTIVE[ctx.tier]);
}

function brickEventsOf(events) {
  return (Array.isArray(events) ? events : []).filter((event) => event && event.kind === 'brick.destroyed');
}

function stageEventsOf(events) {
  return (Array.isArray(events) ? events : []).filter((event) => event && event.kind === 'stage.clear');
}

/* ------------------------------------------------------------------ *
 * 真实驱动：接单 / 开局 / 发球 / 暂停 / 补砖 / 清层
 * ------------------------------------------------------------------ */

async function openRun(ctx) {
  const flag = TIER_CHAPTER_FLAG[ctx.tier];
  const helpers = helperBag(ctx);
  if (flag) {
    invariant(typeof helpers.seedStoryFlags === 'function', 'runner 未提供 seedStoryFlags');
    const seeded = await helpers.seedStoryFlags([flag]);
    invariant(seeded && seeded.ok !== false, 'seedStoryFlags(' + flag + ') 失败：' + JSON.stringify(seeded));
  }
  invariant(typeof helpers.startCommission === 'function', 'runner 未提供 startCommission');
  const started = await helpers.startCommission(ctx.tier);
  invariant(started && started.ok !== false, 'startCommission 失败：' + JSON.stringify(started));
  if (typeof helpers.navigateGame === 'function') {
    const nav = await helpers.navigateGame();
    invariant(nav && nav.ok !== false, 'navigateGame 失败：' + JSON.stringify(nav));
  }
  /* 等 bridge 确认职业 run + 页面完成职业锁定（目标行/旧档断开/挑战入口隐藏）。 */
  await waitFor(
    ctx,
    '(function(){ try { var i = window.__arcadeTest && typeof window.__arcadeTest.careerInfo === "function" ? window.__arcadeTest.careerInfo() : null; return !!(i && i.isCommission === true && i.locked === true && i.serializeNull === true && i.goalLineVisible === true && i.challengeEntry === false); } catch (e) { return false; } })()',
    12000
  );
  const goal = objectiveOf(ctx);
  const info = await careerInfo(ctx);
  invariant(info.objectiveKind === goal.kind, '目标事件类型与内容不一致：' + JSON.stringify({ want: goal.kind, got: info.objectiveKind }));
  invariant(Number(info.target) === goal.atLeast, '目标阈值与内容不一致：' + JSON.stringify({ want: goal.atLeast, got: info.target }));
  return { started, goal, info };
}

async function startPlaying(ctx) {
  const info = await gameInfo(ctx);
  if (info && info.state === 'playing') return info;
  await waitFor(ctx, "!!document.querySelector('[data-overlay]') && !document.querySelector('[data-overlay]').hidden", 9000);
  const clicked = await evaluate(
    ctx,
    "(function(){ var b = document.querySelector('[data-ov-btn]'); if (!b || b.hidden || !b.getClientRects().length) return false; b.click(); return true; })()"
  );
  invariant(clicked === true, '开始游戏按钮不可点');
  await waitFor(ctx, "(function(){ try { return window.__arcadeTest.info().state === 'playing'; } catch (e) { return false; } })()", 9000);
  return gameInfo(ctx);
}

async function setAutoPaddle(ctx, enabled) {
  const result = await evaluate(ctx, 'window.__arcadeTest.setAutoPaddle(' + (enabled ? 'true' : 'false') + ')');
  invariant(result && result.enabled === enabled, 'setAutoPaddle 失败：' + JSON.stringify(result));
  return result;
}

/**
 * 真实发球：优先用真实 pointerdown/pointerup 手势（页面 launchGestureUp → launch()），
 * 手势在无 PointerEvent 的环境失败时回退到真实 launch() 出口。
 * @returns {Promise<{via:string}>}
 */
async function launchReal(ctx) {
  const gesture = await evaluate(
    ctx,
    `(() => {
      try {
        const canvas = document.querySelector('.game-canvas');
        if (!canvas) return { ok: false, reason: 'no-canvas' };
        const rect = canvas.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const make = (type) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0 });
        canvas.dispatchEvent(make('pointerdown'));
        window.dispatchEvent(make('pointerup'));
        return { ok: true };
      } catch (e) { return { ok: false, reason: 'gesture-error' }; }
    })()`
  );
  let info = await gameInfo(ctx);
  if (!(info && info.launched === true)) {
    const hook = await evaluate(ctx, 'window.__arcadeTest.launchBall()');
    invariant(hook === true, '真实发球失败：pointer 手势=' + JSON.stringify(gesture) + ' hook=' + JSON.stringify(hook));
    info = await gameInfo(ctx);
  }
  invariant(info && info.launched === true, '发球后 launched 仍为 false：' + JSON.stringify(info));
  return { via: gesture && gesture.ok ? 'pointer' : 'launch-hook' };
}

/**
 * 只推进真实 update()（固定 1/60 步）与真实挡板接球，直到 careerInfo.bricksDestroyed >= want。
 * 不使用 destroyBricks；事件只可能来自真实球/砖碰撞。
 */
async function waitRealBrickDestroyed(ctx, want = 1, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await careerInfo(ctx);
    if (last && last.state === 'over') {
      throw new Error('[brick-breaker fixture] 真实物理期间意外收局：' + JSON.stringify({ bricks: last.bricksDestroyed, level: last.level }));
    }
    if (last && Number(last.bricksDestroyed) >= want) return last;
    const step = await evaluate(ctx, 'window.__arcadeTest.advance(' + STEP_SECONDS + ')');
    invariant(step && step.ok === true, 'advance 失败：' + JSON.stringify(step));
    if (step.state === 'over') {
      throw new Error('[brick-breaker fixture] 真实物理期间意外收局：' + JSON.stringify(step));
    }
    await sleep(30);
  }
  throw new Error('[brick-breaker fixture] 真实发球/挡板未击碎砖块（最后值 ' + JSON.stringify(last) + '）');
}

async function pauseGame(ctx) {
  const state = await evaluate(ctx, '(function(){ try { return window.__arcadeTest.info().state; } catch (e) { return null; } })()');
  if (state === 'paused') return;
  invariant(state === 'playing', '暂停前状态不是 playing：' + JSON.stringify(state));
  const clicked = await evaluate(ctx, "(function(){ var b = document.querySelector('[data-pause]'); if (!b || b.disabled) return false; b.click(); return true; })()");
  invariant(clicked === true, '暂停按钮不可点');
  await waitFor(ctx, "(function(){ try { return window.__arcadeTest.info().state === 'paused'; } catch (e) { return false; } })()", 6000);
}

async function resumeGame(ctx) {
  const state = await evaluate(ctx, '(function(){ try { return window.__arcadeTest.info().state; } catch (e) { return null; } })()');
  if (state === 'playing') return;
  invariant(state === 'paused', '继续前状态不是 paused：' + JSON.stringify(state));
  const clicked = await evaluate(ctx, "(function(){ var b = document.querySelector('[data-pause]'); if (!b || b.disabled) return false; b.click(); return true; })()");
  invariant(clicked === true, '继续按钮不可点');
  await waitFor(ctx, "(function(){ try { return window.__arcadeTest.info().state === 'playing'; } catch (e) { return false; } })()", 6000);
}

/** 真实 hitBrick() 归零路径补足砖数；返回页面计数。 */
async function destroyBricks(ctx, count) {
  const result = await evaluate(ctx, 'window.__arcadeTest.destroyBricks(' + Math.max(0, Math.floor(count)) + ')');
  invariant(result && result.ok === true, 'destroyBricks 失败：' + JSON.stringify(result));
  return result;
}

/** 真实 startGame() 重开：证明重开不补发 brick.destroyed。 */
async function restartAndPause(ctx) {
  const before = await careerInfo(ctx);
  const restarted = await evaluate(ctx, 'window.__arcadeTest.restartRun()');
  invariant(restarted && restarted.ok === true, 'restartRun 失败：' + JSON.stringify(restarted));
  await pauseGame(ctx);
  const after = await careerInfo(ctx);
  invariant(Number(after.bricksDestroyed) === Number(before.bricksDestroyed), '重开改动了 brick.destroyed 计数：' + JSON.stringify({ before: before.bricksDestroyed, after: after.bricksDestroyed }));
  invariant(Number(after.stageClears) === Number(before.stageClears), '重开改动了 stage.clear 计数：' + JSON.stringify({ before: before.stageClears, after: after.stageClears }));
  return { before: before.bricksDestroyed, after: after.bricksDestroyed };
}

/* ------------------------------------------------------------------ *
 * 场景
 * ------------------------------------------------------------------ */

function assertCareerContract(info, goal) {
  invariant(info && info.isCommission === true, '职业 run 未激活：' + JSON.stringify(info));
  invariant(info.locked === true, '职业隔离未锁定：' + JSON.stringify(info));
  invariant(info.goalLineVisible === true && info.hintIsCareerGoal === true, '职业目标行不可见：' + JSON.stringify(info));
  invariant(info.serializeNull === true, '职业 run serialize() 未返回 null：' + JSON.stringify(info));
  invariant(info.challengeEntry === false, '职业 run 出现挑战入口：' + JSON.stringify(info));
  invariant(info.challengePanelHidden === true, '职业 run 挑战面板未隐藏：' + JSON.stringify(info));
  invariant(info.objectiveKind === goal.kind && Number(info.target) === goal.atLeast, '目标与内容不一致：' + JSON.stringify({ info, goal }));
}

async function successBricks(ctx, goal) {
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  assertCareerContract(info0, goal);
  await startPlaying(ctx);

  /* 1) 真实发球 + 真实挡板 + 真实 update 物理击碎 ≥1 块。 */
  await setAutoPaddle(ctx, true);
  const launch = await launchReal(ctx);
  const realInfo = await waitRealBrickDestroyed(ctx, 1);
  const realEvents = await commissionEvents(ctx);
  const realBricks = brickEventsOf(realEvents);
  invariant(realBricks.length >= 1, '真实物理未提交 brick.destroyed：' + JSON.stringify(realEvents.slice(0, 3)));
  invariant(
    realBricks.every((event) => Number.isFinite(Number(event.payload && event.payload.level)) && Number.isFinite(Number(event.payload && event.payload.maxHp))),
    'brick.destroyed payload 字段不符：' + JSON.stringify(realBricks.slice(0, 3))
  );

  /* 2) 真实暂停冻结物理 → 死砖重复调用不计 → 重开不补发。 */
  await pauseGame(ctx);
  const deadCheck = await evaluate(ctx, 'window.__arcadeTest.careerSelfCheck()');
  invariant(deadCheck && deadCheck.fail === 0, 'careerSelfCheck 失败：' + JSON.stringify(deadCheck && deadCheck.details));
  const restart = await restartAndPause(ctx);

  /* 3) 真实 hitBrick() 归零路径补足到目标（事件与计数一致）。 */
  const beforeTopUp = await careerInfo(ctx);
  const need = goal.atLeast - Number(beforeTopUp.bricksDestroyed);
  if (need > 0) await destroyBricks(ctx, need);
  const finalInfo = await careerInfo(ctx);
  invariant(Number(finalInfo.bricksDestroyed) >= goal.atLeast, '砖数未达标：' + JSON.stringify({ target: goal.atLeast, info: finalInfo }));
  const finalEvents = await commissionEvents(ctx);
  const finalBricks = brickEventsOf(finalEvents);
  invariant(finalBricks.length === Number(finalInfo.bricksDestroyed), '事件缓冲与页面计数不一致：' + JSON.stringify({ events: finalBricks.length, count: finalInfo.bricksDestroyed }));
  invariant(finalInfo.challengeEntry === false, '职业 run 出现挑战入口：' + JSON.stringify(finalInfo));

  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  invariant(
    finalInfo.plays === info0.plays && finalInfo.high === info0.high && finalInfo.scoresCount === info0.scoresCount,
    '职业 run 污染了经典 progress/scores：' + JSON.stringify({ before: { plays: info0.plays, high: info0.high, scores: info0.scoresCount }, after: { plays: finalInfo.plays, high: finalInfo.high, scores: finalInfo.scoresCount } })
  );
  await evaluate(ctx, 'window.__arcadeTest.setAutoPaddle(false)');
  return {
    events: { 'brick.destroyed': finalBricks.length },
    stats: { level: finalInfo.level, score: finalInfo.score, bricks: finalInfo.bricksDestroyed, stageClears: finalInfo.stageClears, launchVia: launch.via, realBricks: realBricks.length, restart },
    info: finalInfo,
    realEvents: realBricks.length,
  };
}

async function successStage(ctx, goal) {
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  assertCareerContract(info0, goal);
  await startPlaying(ctx);

  /* 1) 真实发球/挡板先真实击碎 ≥1 块（发球链路证据）。 */
  await setAutoPaddle(ctx, true);
  const launch = await launchReal(ctx);
  await waitRealBrickDestroyed(ctx, 1);

  /* 2) 真实暂停 → 真实 hitBrick() 把剩余存活砖块全部归零（真实清空前置条件）。 */
  await pauseGame(ctx);
  const paused = await careerInfo(ctx);
  invariant(Number(paused.aliveBricks) > 0, '暂停时已无存活砖块（不应已清层）：' + JSON.stringify(paused));
  const wiped = await destroyBricks(ctx, Number(paused.aliveBricks));
  invariant(Number(wiped.alive) === 0, '未清空全部砖块：' + JSON.stringify(wiped));

  /* 3) 真实 resume → 真实 update() 检测“一层全清”，提交一次 stage.clear{level}，并进入下一层。 */
  await resumeGame(ctx);
  const step = await evaluate(ctx, 'window.__arcadeTest.advance(2.4)');
  invariant(step && step.ok === true, 'advance 失败：' + JSON.stringify(step));
  invariant(step.stageClears >= 1, '未提交 stage.clear：' + JSON.stringify(step));
  const afterClear = await careerInfo(ctx);
  invariant(Number(afterClear.stageClears) === 1, 'stage.clear 次数不是 1：' + JSON.stringify(afterClear));
  invariant(JSON.stringify(afterClear.stageClearLevels) === JSON.stringify([1]), 'stage.clear 关卡异常：' + JSON.stringify(afterClear.stageClearLevels));
  invariant(Number(afterClear.level) === 2, '清层后未进入第 2 关：' + JSON.stringify(afterClear));
  const events = await commissionEvents(ctx);
  const stageEvents = stageEventsOf(events);
  invariant(stageEvents.length === 1 && Number(stageEvents[0].payload && stageEvents[0].payload.level) === 1, 'stage.clear 事件不符：' + JSON.stringify(stageEvents));

  /* 4) 再次真实暂停并做只读自检（清层后不得重复、目标行仍在、隔离保持）。 */
  await pauseGame(ctx);
  const selfCheck = await evaluate(ctx, 'window.__arcadeTest.careerSelfCheck()');
  invariant(selfCheck && selfCheck.fail === 0, 'careerSelfCheck 失败：' + JSON.stringify(selfCheck && selfCheck.details));
  const finalInfo = await careerInfo(ctx);
  invariant(finalInfo.challengeEntry === false, '职业 run 出现挑战入口：' + JSON.stringify(finalInfo));

  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  invariant(
    finalInfo.plays === info0.plays && finalInfo.high === info0.high && finalInfo.scoresCount === info0.scoresCount,
    '职业 run 污染了经典 progress/scores：' + JSON.stringify({ before: { plays: info0.plays, high: info0.high, scores: info0.scoresCount }, after: { plays: finalInfo.plays, high: finalInfo.high, scores: finalInfo.scoresCount } })
  );
  await evaluate(ctx, 'window.__arcadeTest.setAutoPaddle(false)');
  return {
    events: { 'stage.clear': 1 },
    stats: { level: finalInfo.level, score: finalInfo.score, bricks: finalInfo.bricksDestroyed, stageClears: finalInfo.stageClears, launchVia: launch.via, wiped: wiped.destroyed },
    info: finalInfo,
  };
}

async function failureBricks(ctx, goal) {
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  assertCareerContract(info0, goal);
  await startPlaying(ctx);

  await setAutoPaddle(ctx, true);
  await launchReal(ctx);
  await waitRealBrickDestroyed(ctx, 1);
  await pauseGame(ctx);

  const short = Math.max(0, goal.atLeast - FAILURE_SHORTFALL);
  const current = await careerInfo(ctx);
  const need = short - Number(current.bricksDestroyed);
  if (need > 0) await destroyBricks(ctx, need);
  const finalInfo = await careerInfo(ctx);
  invariant(Number(finalInfo.bricksDestroyed) < goal.atLeast, '失败场景砖数已达标：' + JSON.stringify({ target: goal.atLeast, info: finalInfo }));
  const events = await commissionEvents(ctx);
  const finalBricks = brickEventsOf(events);
  invariant(finalBricks.length === Number(finalInfo.bricksDestroyed), '失败场景事件缓冲与页面计数不一致：' + JSON.stringify({ events: finalBricks.length, count: finalInfo.bricksDestroyed }));

  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  await evaluate(ctx, 'window.__arcadeTest.setAutoPaddle(false)');
  return {
    events: { 'brick.destroyed': finalBricks.length },
    stats: { level: finalInfo.level, score: finalInfo.score, bricks: finalInfo.bricksDestroyed, stageClears: finalInfo.stageClears, target: goal.atLeast },
    observed: finalBricks.length,
  };
}

async function failureStage(ctx, goal) {
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  assertCareerContract(info0, goal);
  await startPlaying(ctx);

  await setAutoPaddle(ctx, true);
  await launchReal(ctx);
  await waitRealBrickDestroyed(ctx, 1);
  await pauseGame(ctx);

  /* 只击碎少量砖块、绝不清层：stage.clear 真实缓冲为 0。 */
  const current = await careerInfo(ctx);
  if (Number(current.aliveBricks) > 6) await destroyBricks(ctx, 2);
  const finalInfo = await careerInfo(ctx);
  invariant(Number(finalInfo.stageClears) === 0, '失败场景已清层：' + JSON.stringify(finalInfo));
  invariant(Number(finalInfo.aliveBricks) > 0, '失败场景砖块已全清：' + JSON.stringify(finalInfo));
  const events = await commissionEvents(ctx);
  invariant(stageEventsOf(events).length === 0, '失败场景出现 stage.clear：' + JSON.stringify(stageEventsOf(events)));

  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  await evaluate(ctx, 'window.__arcadeTest.setAutoPaddle(false)');
  return {
    events: {},
    stats: { level: finalInfo.level, score: finalInfo.score, bricks: finalInfo.bricksDestroyed, stageClears: 0, alive: finalInfo.aliveBricks, target: goal.atLeast },
    observed: 0,
  };
}

async function run(ctx, mode) {
  const goal = objectiveOf(ctx);
  const isStage = goal.kind === 'stage.clear';
  if (mode === 'success') return isStage ? successStage(ctx, goal) : successBricks(ctx, goal);
  return isStage ? failureStage(ctx, goal) : failureBricks(ctx, goal);
}

export const tiers = {
  1: { success: (ctx) => run(ctx, 'success'), failure: (ctx) => run(ctx, 'failure') },
  2: { success: (ctx) => run(ctx, 'success'), failure: (ctx) => run(ctx, 'failure') },
  3: { success: (ctx) => run(ctx, 'success'), failure: (ctx) => run(ctx, 'failure') },
  4: { success: (ctx) => run(ctx, 'success'), failure: (ctx) => run(ctx, 'failure') },
  5: { success: (ctx) => run(ctx, 'success'), failure: (ctx) => run(ctx, 'failure') },
  6: { success: (ctx) => run(ctx, 'success'), failure: (ctx) => run(ctx, 'failure') },
};

export async function cleanup(ctx) {
  /* 结算/放弃由 runner 负责；这里只做只读收尾，不写仓库、不碰 ticket。 */
  return { ok: true, ticketKey: TICKET_KEY, isolatedKeys: ISO_KEYS.slice() };
}
