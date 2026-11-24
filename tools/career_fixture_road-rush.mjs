#!/usr/bin/env node
/**
 * StudioKit Arcade Life 0.17 — D17-14 road-rush 六阶职业委托 fixture。
 *
 * 契约：docs/arcade-life/ADR-interfaces.md §19.2 / §19.3 / §19.4 / §19.8
 * - 目标来自 content/commissions.json：road-rush.T1..T6 = distance.reached，
 *   minValue {field:'meters'} 依次 500 / 1000 / 1500 / 2200 / 3000 / 5000（atLeast 1）；
 * - 驱动全部走真实玩法：#test 只读/诊断钩子（info/careerInfo/carsSnapshot）读取状态，
 *   真实按键（ArrowLeft/ArrowRight，走 engine createInput 的 window keydown）换道，
 *   真实 `[data-ov-btn]` 开局、真实 `[data-pause]` 暂停、真实 `[data-ov-btn2]`「结束本局」收局；
 *   里程只由页面 update() 的真实速度曲线累积（fixture 不用 setDist 伪造跳变），
 *   `distance.reached` 由页面在真实里程提交后按 100m 粒度发出；
 * - #test 助攻（既有 0.8.5 钩子，仅供证据复现）：定期 clearCars() 保持安全走廊、
 *   spawnPickupForTest('boost') 放置真实加速带（真实拾取分支，+速度/冲刺计时），
 *   让 5000m 真实驾驶在单 tier 超时内可复现；不读写 DOM 文本、不改 dist/speed/cruise。
 * - success：真实驾驶到达 minValue（T1–T5 暂停后真实「结束本局」，T6 自然抵达 5000m 终点）；
 * - failure：真实驾驶约 150m（至少 1 条 distance.reached）后真实碰撞三次耗尽车况（碰撞归因），
 *   settle 归因 value-not-met（reached < minValue），零奖励；
 * - T4–T6 先 seedStoryFlags(C3/C4/C5) 再 startCommission；不改生产可见性；
 * - 本 fixture 不写文件、不碰仓库、不 new CDP。
 *
 * 只由 tools/career_mission_fixture_runner.mjs 装载（或仓库外等价 harness 以同一 helper 面驱动）。
 */

export const gameId = 'road-rush';

/* 内容真值兜底（runner 的 getCommission(tier) 可用时以内容为准）。 */
const TIER_TARGET_METERS = { 1: 500, 2: 1000, 3: 1500, 4: 2200, 5: 3000, 6: 5000 };
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
const TICKET_KEY = 'studiokit:arcade:career:ticket.v1';
const GAME = 'road-rush';
/* 真实驾驶参数：每 240ms 清理一次车流（保持安全走廊）、每 1800ms 放一个真实加速带。 */
const CLEAR_INTERVAL_MS = 240;
const BOOST_INTERVAL_MS = 1800;
const POLL_MS = 110;
const DRIVE_TIMEOUT_MS = 150000;
const FAILURE_METERS = 150;
const FAILURE_HITS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function invariant(condition, message) {
  if (!condition) throw new Error('[road-rush fixture] ' + message);
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
  throw new Error('[road-rush fixture] 没有可用的 page evaluate');
}

async function waitFor(ctx, expression, timeout, label) {
  const bag = helperBag(ctx);
  const budget = timeout || 9000;
  if (typeof bag.waitFor === 'function') {
    try {
      return await bag.waitFor(expression, budget);
    } catch (err) {
      throw new Error('[road-rush fixture] 等待超时：' + (label || expression) + ' · ' + (err && err.message ? err.message : String(err)));
    }
  }
  const end = Date.now() + budget;
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
  throw new Error('[road-rush fixture] 等待超时：' + (label || expression) + '（最后值 ' + JSON.stringify(last) + '）');
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
  return evaluate(ctx, '(function(){ try { return window.__arcadeTest.info(); } catch (e) { return null; } })()');
}

async function commissionEvents(ctx) {
  const state = await evaluate(
    ctx,
    '(function(){ try { return window.__arcadeCareerTest && typeof window.__arcadeCareerTest.commissionState === "function" ? window.__arcadeCareerTest.commissionState() : null; } catch (e) { return null; } })()'
  );
  return state && Array.isArray(state.events) ? state.events : [];
}

async function snapshotIsolation(ctx) {
  return evaluate(
    ctx,
    '(function(){ var keys = ' + JSON.stringify(ISO_KEYS) + '; var out = {}; keys.forEach(function (key) { try { out[key] = localStorage.getItem(key); } catch (e) { out[key] = null; } }); return out; })()'
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

function targetMetersOf(ctx) {
  try {
    const commission = typeof helperBag(ctx).getCommission === 'function' ? helperBag(ctx).getCommission(ctx.tier) : null;
    const objective = commission && commission.objective ? commission.objective : null;
    const minValue = objective && objective.minValue ? objective.minValue : null;
    const raw = minValue ? Number(minValue.value) : NaN;
    if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  } catch (err) {
    /* 回退内容真值 */
  }
  return TIER_TARGET_METERS[ctx.tier];
}

function commissionIdOf(ctx) {
  return GAME + '.T' + ctx.tier;
}

/* ------------------------------------------------------------------ *
 * 真实输入
 * ------------------------------------------------------------------ */

async function pressKey(ctx, key) {
  const cdp = ctx && ctx.cdp && typeof ctx.cdp.key === 'function' ? ctx.cdp : null;
  if (cdp) {
    await cdp.key(key, 'down');
    await sleep(110);
    await cdp.key(key, 'up');
    await sleep(60);
    return;
  }
  const opts = { key: key, code: key, bubbles: true, cancelable: true };
  await evaluate(
    ctx,
    '(function(){ var o = ' + JSON.stringify(opts) + '; window.dispatchEvent(new KeyboardEvent("keydown", o)); setTimeout(function(){ window.dispatchEvent(new KeyboardEvent("keyup", o)); }, 110); return true; })()'
  );
  await sleep(190);
}

async function clickSelector(ctx, selector) {
  return evaluate(
    ctx,
    '(function(){ var el = document.querySelector(' + JSON.stringify(selector) + '); if (!el || el.hidden || el.disabled || !el.getClientRects().length) return false; el.click(); return true; })()'
  );
}

/* ------------------------------------------------------------------ *
 * 真实开局 / 驾驶
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
    12000,
    '职业 run 激活'
  );
  await waitFor(
    ctx,
    '(function(){ try { var overlay = document.querySelector("[data-overlay]"); return !!overlay && !overlay.hidden && !!document.querySelector("[data-career-goal]"); } catch (e) { return false; } })()',
    9000,
    '职业开局弹层/目标行'
  );
  const target = targetMetersOf(ctx);
  const info = await careerInfo(ctx);
  invariant(info && info.locked === true && info.serializeNull === true, '职业隔离未生效：' + JSON.stringify(info));
  invariant(info.goalLineVisible === true, '职业 run 缺少可见目标行：' + JSON.stringify(info));
  invariant(info.challengeEntryHidden === true, '职业 run 出现挑战入口：' + JSON.stringify(info));
  invariant(info.targetMeters === target, '目标米数与内容不一致：' + JSON.stringify({ target: target, info: info.targetMeters }));
  invariant(info.commissionId === commissionIdOf(ctx), 'commissionId 不符：' + JSON.stringify(info.commissionId));
  return info;
}

/** 真实 UI 开局；runner 的 suspension 流程可能已开局，已在游玩态则直接返回。 */
async function startPlaying(ctx) {
  const info = await gameInfo(ctx);
  if (info && info.state === 'playing') return info;
  const clicked = await clickSelector(ctx, '[data-ov-btn]');
  invariant(clicked === true, '开始游戏按钮不可点');
  await waitFor(ctx, '(function(){ try { return window.__arcadeTest.info().state === "playing"; } catch (e) { return false; } })()', 9000, '进入游玩态');
  return gameInfo(ctx);
}

/**
 * 真实换道 + 真实超车证据：按真实按键换一条车道再换回；用既有 spawnCarForTest
 * 在邻道放一辆慢车，等 update() 真实超车分支提交 overtake 事件。
 */
async function laneChangeAndOvertake(ctx) {
  const info0 = await gameInfo(ctx);
  invariant(info0 && info0.state === 'playing', '换道前必须处于游玩态：' + JSON.stringify(info0));
  const startLane = Number(info0.lane);
  const targetLane = startLane < 3 ? startLane + 1 : startLane - 1;
  await pressKey(ctx, targetLane > startLane ? 'ArrowRight' : 'ArrowLeft');
  const info1 = await gameInfo(ctx);
  invariant(info1 && info1.lane === targetLane, '真实按键换道未生效：' + JSON.stringify({ startLane: startLane, lane: info1 && info1.lane }));
  await pressKey(ctx, targetLane > startLane ? 'ArrowLeft' : 'ArrowRight');
  const info2 = await gameInfo(ctx);
  invariant(info2 && info2.lane === startLane, '真实按键换回原车道未生效：' + JSON.stringify({ startLane: startLane, lane: info2 && info2.lane }));
  const otherLane = (startLane + 2) % 4;
  const spawned = await evaluate(ctx, 'window.__arcadeTest.spawnCarForTest(' + otherLane + ', 0.24, 0.05)');
  invariant(spawned !== null && spawned !== undefined, 'spawnCarForTest 被拒绝');
  const passed = await waitFor(
    ctx,
    '(function(){ try { return window.__arcadeTest.info().passedCars >= 1; } catch (e) { return false; } })()',
    9000,
    '真实超车提交'
  );
  const events = await commissionEvents(ctx);
  const overtakes = events.filter((event) => event && event.kind === 'overtake');
  invariant(overtakes.length >= 1, 'overtake 事件未进入委托缓冲：' + JSON.stringify(events.map((event) => event.kind)));
  const info3 = await gameInfo(ctx);
  return {
    laneChange: { from: startLane, to: targetLane, back: info3 && info3.lane },
    overtakeEvents: overtakes.length,
    passedCars: info3 ? info3.passedCars : Number(passed),
    otherLane: otherLane,
  };
}

/** 真实驾驶到目标米数：里程只由页面 update() 累积，dist 从不被 fixture 改写。 */
async function driveTo(ctx, meters) {
  const deadline = Date.now() + DRIVE_TIMEOUT_MS;
  let lastClear = 0;
  let lastBoost = 0;
  let cleared = 0;
  let boosted = 0;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error('[road-rush fixture] 真实驾驶超时：目标 ' + meters + 'm');
    }
    const info = await careerInfo(ctx);
    invariant(info && typeof info === 'object', 'careerInfo 不可用');
    if (info.state === 'over') {
      return { ended: true, info: info, cleared: cleared, boosted: boosted };
    }
    invariant(info.locked === true, '驾驶中职业 run 丢失：' + JSON.stringify(info));
    if (info.careerDriven >= meters || info.distanceMax >= meters) {
      return { ended: false, info: info, cleared: cleared, boosted: boosted };
    }
    const now = Date.now();
    if (now - lastClear >= CLEAR_INTERVAL_MS) {
      lastClear = now;
      await evaluate(ctx, 'window.__arcadeTest.clearCars()');
      cleared += 1;
    }
    if (now - lastBoost >= BOOST_INTERVAL_MS) {
      lastBoost = now;
      await evaluate(ctx, 'window.__arcadeTest.spawnPickupForTest("boost")');
      boosted += 1;
    }
    await sleep(POLL_MS);
  }
}

/** 真实暂停 → 真实「结束本局」（仅职业 run 出现的第二按钮）；返回暂停态的 careerInfo（事件缓冲仍可读）。 */
async function endViaPauseButton(ctx) {
  const info = await gameInfo(ctx);
  invariant(info && info.state === 'playing', '收局前必须处于游玩态：' + JSON.stringify(info));
  const paused = await clickSelector(ctx, '[data-pause]');
  invariant(paused === true, '暂停按钮不可点击');
  await waitFor(ctx, '(function(){ try { return window.__arcadeTest.info().state === "paused"; } catch (e) { return false; } })()', 6000, '进入暂停态');
  const pausedInfo = await careerInfo(ctx);
  invariant(pausedInfo && pausedInfo.serializeNull === true, '暂停后隔离未保持：' + JSON.stringify(pausedInfo));
  const overlay = await evaluate(
    ctx,
    '(function(){ var ov = document.querySelector("[data-overlay]"); var b = document.querySelector("[data-ov-btn2]"); return { open: !!ov && !ov.hidden, text: b ? b.textContent : null, hidden: b ? b.hidden : true, disabled: b ? b.disabled : true }; })()'
  );
  invariant(overlay && overlay.hidden === false && overlay.text === '结束本局', '职业暂停弹层第二按钮应为「结束本局」：' + JSON.stringify(overlay));
  const clicked = await clickSelector(ctx, '[data-ov-btn2]');
  invariant(clicked === true, '「结束本局」按钮不可点');
  await waitFor(ctx, '(function(){ try { return window.__arcadeTest.info().state === "over"; } catch (e) { return false; } })()', 8000, '收局态');
  return pausedInfo;
}

/** 真实碰撞三次耗尽车况（碰撞归因，非伪造里程）。 */
async function crashOut(ctx) {
  for (let hit = 1; hit <= FAILURE_HITS; hit += 1) {
    const before = await gameInfo(ctx);
    invariant(before && before.state === 'playing', '碰撞前必须处于游玩态：' + JSON.stringify(before));
    const spawned = await evaluate(ctx, 'window.__arcadeTest.forceCollision()');
    invariant(spawned === true, 'forceCollision() 被拒绝');
    await waitFor(
      ctx,
      '(function(){ try { var i = window.__arcadeTest.info(); return i.state === "over" || i.lives < ' + before.lives + '; } catch (e) { return false; } })()',
      8000,
      '第 ' + hit + ' 次碰撞生效'
    );
    if (hit < FAILURE_HITS) {
      /* invul 1.9s：等真实无敌帧结束，下一次碰撞才会被真实碰撞分支处理。 */
      await sleep(2100);
    }
  }
  await waitFor(ctx, '(function(){ try { return window.__arcadeTest.info().state === "over"; } catch (e) { return false; } })()', 8000, '车况耗尽收局');
}

async function waitSettled(ctx) {
  const deadline = Date.now() + 15000;
  let last = null;
  while (Date.now() < deadline) {
    last = await careerInfo(ctx);
    if (last && last.settled && last.settled.pending !== true) return last;
    await sleep(100);
  }
  throw new Error('[road-rush fixture] 职业结算超时：' + JSON.stringify(last && last.settled));
}

function summarizeSettled(settled) {
  if (!settled || typeof settled !== 'object') return null;
  return {
    ok: settled.ok === true,
    reason: settled.reason || null,
    credits: Number(settled.credits) || 0,
    evidence: Array.isArray(settled.evidence) ? settled.evidence.slice() : [],
    duplicate: settled.duplicate === true,
    repeat: settled.repeat === true,
    receiptId: settled.receiptId || null,
    observed: settled.observed === undefined ? null : settled.observed,
    reached: settled.reached === undefined ? null : settled.reached,
  };
}

function distanceSummary(info) {
  const meters = info && Array.isArray(info.distanceEvents) ? info.distanceEvents : [];
  return {
    events: meters.length,
    max: meters.length ? meters[meters.length - 1] : 0,
    first: meters.length ? meters[0] : 0,
    monotonic: meters.every((value, index) => index === 0 || value > meters[index - 1]),
    driven: info ? info.careerDriven : 0,
    distance: info ? Math.floor(info.distance) : 0,
    pageMax: info && Number.isFinite(Number(info.distanceMax)) ? Number(info.distanceMax) : 0,
    step: 100,
  };
}

function baseReturn(ctx, extra) {
  return Object.assign({ gameId: gameId, tier: ctx.tier, targetMeters: targetMetersOf(ctx) }, extra || {});
}

/* ------------------------------------------------------------------ *
 * success / failure
 * ------------------------------------------------------------------ */

async function success(ctx) {
  const target = targetMetersOf(ctx);
  invariant(Number.isFinite(target) && target > 0, '无法读取 ' + ctx.tier + ' 阶目标米数');
  await openRun(ctx);
  const info0 = await careerInfo(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  await startPlaying(ctx);
  const laneChange = await laneChangeAndOvertake(ctx);
  const drive = await driveTo(ctx, target);
  let liveInfo = drive.info;
  if (!drive.ended) {
    liveInfo = await endViaPauseButton(ctx);
  }
  const settledInfo = await waitSettled(ctx);
  const settled = summarizeSettled(settledInfo.settled);
  invariant(settled && settled.ok === true && settled.duplicate !== true, 'success 结算失败：' + JSON.stringify(settled));
  const distance = distanceSummary(liveInfo);
  /* 页面侧的 distanceMax 在结算后仍可读；结算前的事件缓冲用于核对条数/单调性。 */
  const emittedMax = Math.max(Number(settledInfo.distanceMax) || 0, distance.max, distance.pageMax);
  invariant(emittedMax >= target, '真实里程未达目标：' + JSON.stringify({ target: target, distance: distance, emittedMax: emittedMax }));
  invariant(distance.monotonic === true, 'distance.reached 米数非严格递增：' + JSON.stringify(liveInfo && liveInfo.distanceEvents));
  invariant(emittedMax <= distance.distance, '事件米数超过 HUD 累计里程：' + JSON.stringify({ emittedMax: emittedMax, distance: distance.distance }));
  invariant(distance.driven >= target, '真实驾驶里程未达目标：' + JSON.stringify({ driven: distance.driven, target: target }));
  invariant(settledInfo.serializeNull === true, '结算后 serialize() 未返回 null');
  const infoAfter = await careerInfo(ctx);
  invariant(
    infoAfter.plays === info0.plays && infoAfter.high === info0.high && infoAfter.scoresCount === info0.scoresCount,
    '职业 run 污染了经典 progress/scores：' + JSON.stringify({ before: { plays: info0.plays, high: info0.high, scores: info0.scoresCount }, after: { plays: infoAfter.plays, high: infoAfter.high, scores: infoAfter.scoresCount } })
  );
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  return baseReturn(ctx, {
    events: { 'distance.reached': 1, overtake: 1 },
    stats: {
      targetMeters: target,
      distance: distance,
      emittedMax: emittedMax,
      laneChange: laneChange,
      endedByGoal: drive.ended === true,
      cleared: drive.cleared,
      boosted: drive.boosted,
      settled: settled,
      goalText: info0.goalText,
      classicKeysUnchanged: true,
    },
  });
}

async function failure(ctx) {
  const target = targetMetersOf(ctx);
  await openRun(ctx);
  const info0 = await careerInfo(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  await startPlaying(ctx);
  const drive = await driveTo(ctx, FAILURE_METERS);
  invariant(drive.ended !== true, '失败场景不应在短里程内收局：' + JSON.stringify(drive.info && drive.info.state));
  const distanceLive = distanceSummary(drive.info);
  invariant(distanceLive.events >= 1, '失败场景应至少提交 1 条真实 distance.reached：' + JSON.stringify(distanceLive));
  invariant(distanceLive.max < target, '失败场景里程已达标：' + JSON.stringify({ target: target, distance: distanceLive }));
  await crashOut(ctx);
  const settledInfo = await waitSettled(ctx);
  const settled = summarizeSettled(settledInfo.settled);
  invariant(settled && settled.ok === false, '失败场景不应结算成功：' + JSON.stringify(settled));
  invariant(settled.reason === 'value-not-met', '失败原因应为 value-not-met：' + JSON.stringify(settled));
  invariant(Number.isFinite(Number(settled.observed)) && Number(settled.observed) >= 1, '失败 observed 应 ≥ atLeast：' + JSON.stringify(settled));
  invariant(settled.reached === null || Number(settled.reached) < target, '失败 reached 不应达标：' + JSON.stringify({ reached: settled.reached, target: target }));
  const distance = Object.assign({}, distanceLive, { pageMax: Math.max(distanceLive.pageMax, Number(settledInfo.distanceMax) || 0) });
  invariant(distance.max < target && distance.pageMax < target, '失败事件里程不应达标：' + JSON.stringify(distance));
  invariant(distance.monotonic === true, 'distance.reached 米数非严格递增：' + JSON.stringify(drive.info && drive.info.distanceEvents));
  const infoAfter = await careerInfo(ctx);
  invariant(
    infoAfter.plays === info0.plays && infoAfter.high === info0.high && infoAfter.scoresCount === info0.scoresCount,
    '失败结算写入了经典 progress/scores：' + JSON.stringify({ before: { plays: info0.plays, high: info0.high, scores: info0.scoresCount }, after: { plays: infoAfter.plays, high: infoAfter.high, scores: infoAfter.scoresCount } })
  );
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  return baseReturn(ctx, {
    events: { 'distance.reached': 1 },
    stats: {
      targetMeters: target,
      distance: distance,
      crashes: FAILURE_HITS,
      settled: settled,
      classicKeysUnchanged: true,
    },
  });
}

export const tiers = {
  1: { success, failure },
  2: { success, failure },
  3: { success, failure },
  4: { success, failure },
  5: { success, failure },
  6: { success, failure },
};

export async function cleanup(ctx) {
  /* 结算/放弃由 runner 负责；这里只做只读收尾，不写仓库、不清 ticket。 */
  return { ok: true, ticketKey: TICKET_KEY, isolatedKeys: ISO_KEYS.slice() };
}
