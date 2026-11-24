#!/usr/bin/env node
/**
 * StudioKit Arcade Life 0.17 — D17-10 gravity-flip 六阶职业委托 fixture。
 *
 * 契约：docs/arcade-life/ADR-interfaces.md §19.2 / §19.3 / §19.4 / §19.8
 * 目标真值：apps/arcade/career/content/commissions.json 的 gravity-flip.T1..T6
 *   - T1：gravity.flip        ≥ 5 次（真实翻转提交）
 *   - T2：distance.reached    minValue.meters ≥ 500
 *   - T3：distance.reached    minValue.meters ≥ 800
 *   - T4：distance.reached    minValue.meters ≥ 1000（另需 C3.truth_found）
 *   - T5：distance.reached    minValue.meters ≥ 1600（另需 C4.city_power_restored）
 *   - T6：distance.reached    minValue.meters ≥ 3000（另需 C5.star_tower_resolved）
 *
 * 全程只用页面的真实钩子（#test）驱动：
 *   - flipNow()        → 真实 flip()（经典重力翻转；事件由真实提交点发出）；
 *   - stepFrames(n,{autoPilot:true}) → 以 1/60 固定步长驱动同一份真实 update()（与 rAF
 *     createLoop 的 step 完全一致）；autoPilot 只在页面中央安全带内调用真实 flip()，
 *     不改 y/vy/碰撞/计分/事件，是真实可玩的保守打法（经典障碍最高 142px，中央安全带
 *     y∈[206,538] 与任何障碍都不相交），用于长距离/存活的确定性复现——不是伪造前进；
 *   - [data-ov-btn] / [data-pause] 真实 UI 按钮开局与暂停。
 *
 * 事件口径（ADR §19.4）：
 *   - gravity.flip：每次真实翻转一次（0.9 既有事件，payload {dist,lives}）；
 *   - distance.reached：真实滚动跨过 100m 里程碑时提交当时的真实累计米数 {meters}；暂停 /
 *     待机 / 按键翻转 / #test setDist 都刷不出距离，结算前只补发一次真实终值。
 *     因此 500/800/1000/1600/3000 阈值都能被真实事件覆盖（每个里程碑必有事件）。
 *
 * fixture 只声明它真实观察到的事件（runner 会与 bridge 委托缓冲对照，不采信声明）。
 * 只由 tools/career_mission_fixture_runner.mjs 装载；不写文件、不碰仓库、不 new CDP。
 */

export const gameId = 'gravity-flip';

const GAME = 'gravity-flip';
const TIER_OBJECTIVE = {
  1: { kind: 'gravity.flip', atLeast: 5 },
  2: { kind: 'distance.reached', min: 500 },
  3: { kind: 'distance.reached', min: 800 },
  4: { kind: 'distance.reached', min: 1000 },
  5: { kind: 'distance.reached', min: 1600 },
  6: { kind: 'distance.reached', min: 3000 },
};
/* T4–T6 章节旗标（ADR §19.2：T4 C3.truth_found / T5 C4.city_power_restored / T6 C5.star_tower_resolved）。 */
const TIER_CHAPTER_FLAG = {
  4: 'C3.truth_found',
  5: 'C4.city_power_restored',
  6: 'C5.star_tower_resolved',
};
/* T6 目标就是页面自身的 3000m 星门收尾点：到达后由页面真实 finish → bridge 结算。 */
const PAGE_FINISH_METERS = 3000;
/* 失败场景的真实前进上限（远低于任何一阶阈值，且能真实跨过 100m 事件粒度）。 */
const FAILURE_METERS = 130;
/* 每轮固定步长帧数（600 帧 = 10s 真实游戏时间）。 */
const STEP_CHUNK_FRAMES = 600;
const STEP_CHUNK_BUDGET = 420;

const ISO_KEYS = [
  'studiokit:arcade:runs:v1',
  'studiokit:arcade:progress:v1',
  'studiokit:arcade:scores:v1',
  'studiokit:arcade:challenge:v1',
  'studiokit:arcade:meta:v1',
];

const READY_TIMEOUT = 12000;
const DRIVE_TIMEOUT = 240000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function invariant(condition, message) {
  if (!condition) throw new Error('[gravity-flip fixture] ' + message);
}

function helperBag(ctx) {
  return ctx && ctx.helpers && typeof ctx.helpers === 'object' ? ctx.helpers : {};
}

function requireHelper(ctx, name) {
  const fn = helperBag(ctx)[name];
  invariant(typeof fn === 'function', 'ctx.helpers.' + name + ' 缺失（ADR §19.8）');
  return fn.bind(helperBag(ctx));
}

async function evaluate(ctx, expression) {
  const bag = helperBag(ctx);
  const candidates = [
    bag.evaluate,
    ctx && ctx.cdp && typeof ctx.cdp.evaluate === 'function' ? ctx.cdp.evaluate.bind(ctx.cdp) : null,
    ctx && ctx.page && typeof ctx.page.evaluate === 'function' ? ctx.page.evaluate.bind(ctx.page) : null,
  ].filter((fn) => typeof fn === 'function');
  if (candidates.length) return await candidates[0](expression);
  const cdp = ctx && ctx.cdp;
  if (cdp && typeof cdp.send === 'function') {
    const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (res && res.exceptionDetails) {
      const detail = res.exceptionDetails;
      throw new Error('[gravity-flip fixture] evaluate 失败：' + ((detail.exception && detail.exception.description) || detail.text || 'unknown'));
    }
    return res && res.result ? res.result.value : undefined;
  }
  throw new Error('[gravity-flip fixture] 没有可用的 page evaluate');
}

async function waitFor(ctx, expression, timeout, label) {
  const bag = helperBag(ctx);
  if (typeof bag.waitFor === 'function') {
    try {
      return await bag.waitFor(expression, timeout || READY_TIMEOUT);
    } catch (err) {
      throw new Error('[gravity-flip fixture] 等待超时：' + (label || expression) + ' · ' + (err && err.message ? err.message : String(err)));
    }
  }
  const end = Date.now() + (timeout || READY_TIMEOUT);
  let last = null;
  while (Date.now() < end) {
    try {
      const value = await evaluate(ctx, expression);
      if (value) return value;
      last = value;
    } catch (err) {
      last = err && err.message ? err.message : String(err);
    }
    await sleep(70);
  }
  throw new Error('[gravity-flip fixture] 等待超时：' + (label || expression) + '（最后值 ' + JSON.stringify(last) + '）');
}

function objectiveOf(ctx) {
  try {
    const commission = typeof helperBag(ctx).getCommission === 'function' ? helperBag(ctx).getCommission(ctx.tier) : null;
    const objective = commission && commission.objective ? commission.objective : null;
    if (objective && typeof objective.kind === 'string') {
      const atLeast = Number(objective.atLeast);
      const min = objective.minValue ? Number(objective.minValue.value) : NaN;
      return {
        kind: objective.kind,
        atLeast: Number.isFinite(atLeast) && atLeast > 0 ? Math.floor(atLeast) : 0,
        min: Number.isFinite(min) && min > 0 ? Math.floor(min) : 0,
      };
    }
  } catch (err) {
    /* 回退内容真值 */
  }
  return Object.assign({ atLeast: 0, min: 0 }, TIER_OBJECTIVE[ctx.tier] || {});
}

async function careerInfo(ctx) {
  return evaluate(
    ctx,
    '(function(){ try { return window.__arcadeTest && typeof window.__arcadeTest.careerInfo === "function" ? window.__arcadeTest.careerInfo() : null; } catch (e) { return null; } })()'
  );
}

async function commissionEvents(ctx) {
  return evaluate(
    ctx,
    '(function(){ try { if (window.__arcadeCareerTest && typeof window.__arcadeCareerTest.commissionState === "function") { var s = window.__arcadeCareerTest.commissionState(); return s && Array.isArray(s.events) ? s.events : []; } return []; } catch (e) { return []; } })()'
  );
}

async function commissionRunActive(ctx) {
  return evaluate(
    ctx,
    '(function(){ try { return !!(window.ArcadeCareer && typeof window.ArcadeCareer.isCommissionRun === "function" && window.ArcadeCareer.isCommissionRun()); } catch (e) { return false; } })()'
  );
}

async function lastCommissionResult(ctx) {
  return evaluate(
    ctx,
    '(function(){ try { var i = window.__arcadeCareerTest && window.__arcadeCareerTest.info ? window.__arcadeCareerTest.info() : null; return i && i.commissionLastResult ? i.commissionLastResult : null; } catch (e) { return null; } })()'
  );
}

async function snapshotIsolation(ctx) {
  return evaluate(
    ctx,
    '(function(){ var keys = ' + JSON.stringify(ISO_KEYS) + '; var out = {}; keys.forEach(function (key) { try { out[key] = localStorage.getItem(key); } catch (e) { out[key] = null; } }); return out; })()'
  );
}

function assertIsolation(before, after) {
  ISO_KEYS.forEach((key) => {
    invariant(before && after && before[key] === after[key], '职业 run 写入了经典键 ' + key + '：' + JSON.stringify({ before: before && before[key], after: after && after[key] }));
  });
}

function countKind(events, kind) {
  return events.filter((event) => event && event.kind === kind).length;
}

function metersOf(events) {
  return events
    .filter((event) => event && event.kind === 'distance.reached')
    .map((event) => Number(event.payload && event.payload.meters))
    .filter((value) => Number.isFinite(value));
}

function assertMonotonicMeters(values) {
  for (let i = 1; i < values.length; i += 1) {
    invariant(values[i] > values[i - 1], 'distance.reached 累计米数未严格递增：' + JSON.stringify(values));
  }
}

/* ------------------------------------------------------------------ *
 * 真实页面驱动
 * ------------------------------------------------------------------ */

/** 真实接单：T4–T6 先 seed 受控剧情旗标；runner 负责线性解锁链与 ticket 导航。 */
async function openRun(ctx) {
  const flag = TIER_CHAPTER_FLAG[ctx.tier];
  if (flag) {
    const seeded = await requireHelper(ctx, 'seedStoryFlags')([flag]);
    invariant(seeded && seeded.ok !== false, 'seedStoryFlags(' + flag + ') 失败：' + JSON.stringify(seeded));
  }
  const started = await requireHelper(ctx, 'startCommission')(ctx.tier);
  invariant(started && started.ok !== false, 'startCommission 失败：' + JSON.stringify(started));
  if (typeof helperBag(ctx).navigateGame === 'function') {
    const nav = await helperBag(ctx).navigateGame();
    invariant(nav && nav.ok !== false, 'navigateGame 失败：' + JSON.stringify(nav));
  }
  await waitFor(
    ctx,
    '(function(){ try { return !!(window.__arcadeTest && window.__arcadeTest.careerInfo && window.__arcadeTest.careerInfo().isCommission) && !!(window.__arcadeCareerTest && window.__arcadeCareerTest.commissionRun && window.__arcadeCareerTest.commissionRun()); } catch (e) { return false; } })()',
    READY_TIMEOUT,
    '职业 run 激活'
  );
  await waitFor(
    ctx,
    '(function(){ try { var overlay = document.querySelector("[data-overlay]"); return !!overlay && !overlay.hidden && !!document.querySelector("[data-career-goal]"); } catch (e) { return false; } })()',
    9000,
    '职业开局弹层/目标行'
  );
  const info = await careerInfo(ctx);
  invariant(info && info.isCommission === true, '职业 run 未激活：' + JSON.stringify(info));
  invariant(info.locked === true && info.serializeNull === true, '职业隔离未生效：' + JSON.stringify(info));
  invariant(info.goalLineVisible === true, '职业 run 缺少可见目标行：' + JSON.stringify(info));
  invariant(info.challengeVisible === false && info.challengePanelVisible === false, '职业 run 仍可进入挑战：' + JSON.stringify(info));
  return info;
}

/** 真实 UI 开局；runner 的 suspension 流程可能已开局，已在游玩态则直接返回。 */
async function startPlaying(ctx) {
  const info = await careerInfo(ctx);
  if (info && info.state === 'playing') return info;
  const clicked = await evaluate(
    ctx,
    '(function(){ var b = document.querySelector("[data-ov-btn]"); if (!b || !b.getClientRects().length) return false; b.click(); return true; })()'
  );
  invariant(clicked === true, '开始游戏按钮不可点');
  await waitFor(ctx, '(function(){ try { return window.__arcadeTest.careerInfo().state === "playing"; } catch (e) { return false; } })()', 9000, '进入游玩态');
  return careerInfo(ctx);
}

/** 真实暂停（不结算）：runner failure/success 证据都从这里交给 bridge 结算。 */
async function pauseGame(ctx) {
  const clicked = await evaluate(
    ctx,
    '(function(){ var b = document.querySelector("[data-pause]"); if (!b) return false; b.click(); return true; })()'
  );
  invariant(clicked === true, '暂停按钮不可点');
  await waitFor(ctx, '(function(){ try { return window.__arcadeTest.careerInfo().state === "paused"; } catch (e) { return false; } })()', 6000, '进入暂停态');
  return careerInfo(ctx);
}

/** 真实翻转（flip()）。 */
async function flipNow(ctx) {
  const result = await evaluate(ctx, 'window.__arcadeTest.flipNow()');
  invariant(result && result.ok === true, 'flipNow 未提交真实翻转：' + JSON.stringify(result));
  return result;
}

/** 真实固定步长推进（1/60），autoPilot 只在安全带内真实翻转。 */
async function stepFrames(ctx, frames, autoPilot) {
  const result = await evaluate(
    ctx,
    'window.__arcadeTest.stepFrames(' + JSON.stringify(frames) + ', ' + JSON.stringify({ autoPilot: autoPilot !== false }) + ')'
  );
  invariant(result && typeof result.frames === 'number', 'stepFrames 返回异常：' + JSON.stringify(result));
  return result;
}

/**
 * 真实前进到指定累计米数（滚动 + 可选真实翻转存活），期间页面照常按真实 rAF 运行。
 * 接近目标时收缩步长，避免一脚跨过 3000m 星门导致无法在游玩态取证。
 * 若页面自身先收尾（3000m 星门 / 生命耗尽）则原样返回。
 */
async function driveTo(ctx, targetMeters) {
  const deadline = Date.now() + DRIVE_TIMEOUT;
  let info = await careerInfo(ctx);
  for (let guard = 0; guard < STEP_CHUNK_BUDGET && Date.now() < deadline; guard += 1) {
    invariant(info && info.isCommission === true, '前进过程中职业 run 丢失：' + JSON.stringify(info));
    if (info.state !== 'playing') return info;
    if (info.meters >= targetMeters) return info;
    const remaining = targetMeters - info.meters;
    const chunk = remaining <= 1200 ? 120 : STEP_CHUNK_FRAMES;
    await stepFrames(ctx, chunk, true);
    info = await careerInfo(ctx);
  }
  invariant(info && info.meters >= targetMeters, '前进未达标：' + JSON.stringify({ target: targetMeters, meters: info && info.meters, state: info && info.state }));
  return info;
}

/** 页面在 3000m 星门自行收尾后，等 bridge 委托结算真正落地（commissionRun 清空）。 */
async function waitPageSettlement(ctx) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (!(await commissionRunActive(ctx))) {
      const last = await lastCommissionResult(ctx);
      invariant(last && last.ok === true, '页面自动结算未成功：' + JSON.stringify(last));
      return last;
    }
    await sleep(120);
  }
  throw new Error('[gravity-flip fixture] 页面结算未在 20s 内完成');
}

/* ------------------------------------------------------------------ *
 * success / failure
 * ------------------------------------------------------------------ */

async function success(ctx) {
  const goal = objectiveOf(ctx);
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  await startPlaying(ctx);

  if (goal.kind === 'gravity.flip') {
    /* T1：真实翻转 atLeast 次（每次真实 gravity.flip），随后真实暂停交 runner 结算。 */
    for (let i = 0; i < goal.atLeast; i += 1) await flipNow(ctx);
    const events = await commissionEvents(ctx);
    const flips = countKind(events, 'gravity.flip');
    invariant(flips >= goal.atLeast, '真实翻转事件不足：' + flips + ' < ' + goal.atLeast);
    const paused = await pauseGame(ctx);
    invariant(paused.lives > 0, '翻转阶应存活：' + JSON.stringify({ lives: paused.lives }));
    const isolationAfter = await snapshotIsolation(ctx);
    assertIsolation(isolationBefore, isolationAfter);
    return {
      events: { 'gravity.flip': flips },
      stats: { objectiveKind: goal.kind, target: goal.atLeast, flips: flips, dist: paused.meters, lives: paused.lives, classicKeysUnchanged: true },
    };
  }

  /* T2–T6：真实滚动前进到阈值（autoPilot 只做安全带真实翻转，保命不加速）。 */
  const pageFinishTier = goal.min >= PAGE_FINISH_METERS;
  const driveTarget = pageFinishTier ? Math.max(1, goal.min - 200) : goal.min;
  const driven = await driveTo(ctx, driveTarget);
  invariant(driven.lives > 0, '长距离前进途中生命耗尽（未存活到交差）：' + JSON.stringify(driven));

  if (pageFinishTier) {
    /* T6：先在游玩态取证真实 distance.reached，再让页面自己跑过 3000m 星门 →
       页面真实 finish(true) → bridge 结算（收据即是目标达成的权威证据）。 */
    invariant(driven.state === 'playing', '取证阶段页面提前收尾：' + JSON.stringify(driven));
    const preEvents = await commissionEvents(ctx);
    const preMeters = metersOf(preEvents);
    const preMax = preMeters.length ? Math.max.apply(null, preMeters) : 0;
    assertMonotonicMeters(preMeters);
    invariant(preMax >= driveTarget, '取证阶段累计米数不足：' + preMax + ' < ' + driveTarget + ' · ' + JSON.stringify(preMeters));    const final = await stepFrames(ctx, 1500, true);
    invariant(final.state === 'over', '3000m 星门未由页面真实收尾：' + JSON.stringify(final));
    invariant(final.meters >= goal.min, '真实里程未达标：' + final.meters + ' < ' + goal.min);
    const last = await waitPageSettlement(ctx);
    invariant(last && last.receipt && last.receipt.commissionId === GAME + '.T' + ctx.tier, '页面结算收据异常：' + JSON.stringify(last));
    const isolationAfter = await snapshotIsolation(ctx);
    assertIsolation(isolationBefore, isolationAfter);
    return {
      events: { 'distance.reached': preMeters.length },
      stats: {
        objectiveKind: goal.kind,
        target: goal.min,
        meters: final.meters,
        distanceEventsBeforeGate: preMeters.length,
        maxMetersBeforeGate: preMax,
        lives: final.lives,
        pilot: driven.pilot,
        pageSettled: true,
        settlementReceipt: { commissionId: last.receipt.commissionId, credits: last.receipt.credits },
        classicKeysUnchanged: true,
      },
    };
  }

  const events = await commissionEvents(ctx);
  const meters = metersOf(events);
  const maxMeters = meters.length ? Math.max.apply(null, meters) : 0;
  assertMonotonicMeters(meters);
  invariant(maxMeters >= goal.min, 'distance.reached 未提交达标累计米数：' + maxMeters + ' < ' + goal.min + ' · ' + JSON.stringify(meters));
  invariant(driven.meters >= goal.min, '真实里程未达标：' + driven.meters);

  const paused = await pauseGame(ctx);
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  return {
    events: { 'distance.reached': meters.length },
    stats: {
      objectiveKind: goal.kind,
      target: goal.min,
      meters: driven.meters,
      distanceEvents: meters.length,
      maxMeters: maxMeters,
      lives: paused.lives,
      pilot: paused.pilot,
      pageSettled: false,
      classicKeysUnchanged: true,
    },
  };
}

async function failure(ctx) {
  const goal = objectiveOf(ctx);
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  await startPlaying(ctx);

  if (goal.kind === 'gravity.flip') {
    /* T1 失败：真实翻转次数不足（atLeast-3，留足余量），归因 objective-not-met。 */
    const wanted = Math.max(0, goal.atLeast - 3);
    for (let i = 0; i < wanted; i += 1) await flipNow(ctx);
    const events = await commissionEvents(ctx);
    const flips = countKind(events, 'gravity.flip');
    invariant(flips < goal.atLeast, '失败场景翻转次数已达阈值：' + flips);
    const paused = await pauseGame(ctx);
    const isolationAfter = await snapshotIsolation(ctx);
    assertIsolation(isolationBefore, isolationAfter);
    return {
      events: { 'gravity.flip': flips },
      stats: { objectiveKind: goal.kind, target: goal.atLeast, flips: flips, observed: flips, dist: paused.meters, lives: paused.lives, classicKeysUnchanged: true },
    };
  }

  /* T2–T6 失败：真实前进但明显不足（value-not-met：缓冲里有值，但最大值 < minValue）。 */
  const driven = await driveTo(ctx, FAILURE_METERS);
  invariant(driven.state === 'playing', '失败场景不应提前收尾：' + JSON.stringify(driven));
  invariant(driven.lives > 0, '失败场景应存活（生命耗尽不算“距离不足”归因）：' + JSON.stringify(driven));
  invariant(driven.meters < goal.min, '失败场景真实里程已达阈值：' + driven.meters);
  const events = await commissionEvents(ctx);
  const meters = metersOf(events);
  const maxMeters = meters.length ? Math.max.apply(null, meters) : 0;
  assertMonotonicMeters(meters);
  invariant(meters.length >= 1, '失败场景未产生真实 distance.reached（无法证明“值不足”）：' + JSON.stringify(events));
  invariant(maxMeters < goal.min, '失败场景缓冲最大值已达阈值：' + maxMeters);
  const paused = await pauseGame(ctx);
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  return {
    events: { 'distance.reached': meters.length },
    stats: {
      objectiveKind: goal.kind,
      target: goal.min,
      meters: driven.meters,
      distanceEvents: meters.length,
      maxMeters: maxMeters,
      observed: meters.length,
      lives: paused.lives,
      classicKeysUnchanged: true,
    },
  };
}

async function run(ctx, mode) {
  if (mode === 'success') return success(ctx);
  return failure(ctx);
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
  /* 结算/放弃由 runner 负责；这里只做只读收尾，不写仓库、不清 ticket。 */
  return { ok: true, gameId: GAME };
}
