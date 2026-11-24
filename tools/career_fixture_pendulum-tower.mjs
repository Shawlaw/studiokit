#!/usr/bin/env node
/**
 * StudioKit Arcade Life 0.17 — D17-17 pendulum-tower 六阶职业委托 fixture。
 *
 * 契约：docs/arcade-life/ADR-interfaces.md §19.2 / §19.3 / §19.4 / §19.8
 *
 * 真实事件锚点（docs/arcade-life/ACTUAL-HOOKS.md §2）：
 *   - `tower.floor_stable` 只在 `settleDrop()` 的「落稳」分支提交一次（每稳一层一条，
 *     payload `{floor, perfect}`）；倒塌（`startCollapse()` 清空 boxes）与测试层
 *     （`__arcadeTest.stackTo()` 直接 push）都不经过该分支，因此永远不会被计数；
 *   - 挑战模式落箱走 `settleChallengeDrop()`，不产生 `tower.floor_stable` 职业事件。
 *
 * 驱动方式（全部真实钩子，fixture 不调用 observe、不伪造事件、不写库）：
 *   - 接单：`helpers.startCommission(tier)`（runner 负责 ticket / 解锁链 / 导航）；
 *   - 开局：真实 UI `[data-ov-btn]` → `startGame()`；
 *   - 稳定层：`__arcadeTest.releaseWhenTowerAligned(0, 8)` 在「预测落点跨过塔顶中心」的
 *     那一帧执行真实 `releaseBox()`，随后是真实自由落体、真实 `settleDrop()` 提交、
 *     真实补箱读秒；每一层都核对「真实提交数 == 委托事件条数」严格 +1；
 *   - 结束：真实暂停 `[data-pause]`（职业 run 不落旧 RunSave、不 recordPlay），
 *     由 runner / 页面职业结算出口判定目标。
 *
 * 目标（apps/arcade/career/content/commissions.json）：
 *   pendulum-tower.T1..T6 = `tower.floor_stable` atLeast 4 / 6 / 8 / 10 / 12 / 15 稳定层；
 *   T4–T6 需要 C3/C4/C5 剧情旗标（`helpers.seedStoryFlags` 先注入受控旗标，不改生产可见性）。
 *
 * success：真实稳定提交 ≥ atLeast 层后暂停；
 * failure：真实稳定提交 3 层（严格不足，T1 也是 3 < 4）后暂停 —— 归因 `objective-not-met`，
 *          不借倒塌 / 测试层凑数（`careerInfo.stableFloors` 与事件条数都必须等于真实层数）。
 *
 * 只由 tools/career_mission_fixture_runner.mjs 装载（或仓库外等价 harness 以同一 helper 面驱动）；
 * 不写文件、不碰仓库、不 new CDP。
 */

export const gameId = 'pendulum-tower';

/* 内容真值兜底（runner 的 getCommission(tier) 可用时以内容为准）。 */
const TIER_TARGET = { 1: 4, 2: 6, 3: 8, 4: 10, 5: 12, 6: 15 };
/* T4–T6 章节旗标（ADR §19.2）。 */
const TIER_CHAPTER_FLAG = { 4: 'C3.truth_found', 5: 'C4.city_power_restored', 6: 'C5.star_tower_resolved' };
/* 职业 run 不得改动的经典键（逐字节对照）。 */
const ISO_KEYS = [
  'studiokit:arcade:runs:v1',
  'studiokit:arcade:progress:v1',
  'studiokit:arcade:scores:v1',
  'studiokit:arcade:challenge:v1',
  'studiokit:arcade:meta:v1',
];
/* failure 只提交 3 个真实稳定层：严格少于最低目标（T1=4），归因稳定层不足。 */
const FAILURE_FLOORS = 3;
const STABLE_EVENT = 'tower.floor_stable';
const READY_TIMEOUT = 12000;
const COMMIT_TIMEOUT = 12000;

function invariant(condition, message) {
  if (!condition) throw new Error('[pendulum-tower fixture] ' + message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      throw new Error('[pendulum-tower fixture] evaluate 失败：' + ((detail.exception && detail.exception.description) || detail.text || 'unknown'));
    }
    return res && res.result ? res.result.value : undefined;
  }
  throw new Error('[pendulum-tower fixture] 没有可用的 page evaluate');
}

async function waitFor(ctx, expression, timeout, label) {
  const bag = helperBag(ctx);
  if (typeof bag.waitFor === 'function') {
    try {
      return await bag.waitFor(expression, timeout || READY_TIMEOUT);
    } catch (err) {
      throw new Error('[pendulum-tower fixture] 等待超时：' + (label || expression) + ' · ' + (err && err.message ? err.message : String(err)));
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
  throw new Error('[pendulum-tower fixture] 等待超时：' + (label || expression) + '（最后值 ' + JSON.stringify(last) + '）');
}

/** 目标来自真实内容（ctx.helpers.getCommission），缺失时回退内容真值。 */
function targetOf(ctx) {
  try {
    const commission = typeof helperBag(ctx).getCommission === 'function' ? helperBag(ctx).getCommission(ctx.tier) : null;
    const objective = commission && commission.objective ? commission.objective : null;
    const raw = objective ? Number(objective.atLeast) : NaN;
    if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  } catch (err) {
    /* 回退到内容真值 */
  }
  return TIER_TARGET[ctx.tier];
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

async function commissionEvents(ctx) {
  return evaluate(
    ctx,
    '(function(){ try { if (window.__arcadeCareerTest && typeof window.__arcadeCareerTest.commissionState === "function") { var s = window.__arcadeCareerTest.commissionState(); return s && Array.isArray(s.events) ? s.events : []; } return []; } catch (e) { return []; } })()'
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
    invariant(
      before && after && before[key] === after[key],
      '职业 run 写入了经典键 ' + key + '：' + JSON.stringify({ before: before && before[key], after: after && after[key] })
    );
  });
}

function stableEventsOf(events) {
  return (Array.isArray(events) ? events : []).filter((event) => event && event.kind === STABLE_EVENT);
}

function floorPayloads(events) {
  return stableEventsOf(events)
    .map((event) => Number(event.payload && event.payload.floor))
    .filter((value) => Number.isFinite(value));
}

/* ------------------------------------------------------------------ *
 * 真实驱动：接单 / 开局 / 逐层真实释放 / 暂停
 * ------------------------------------------------------------------ */

/** 真实接单：T4–T6 先 seed 受控剧情旗标；runner 负责解锁链、ticket 与导航。 */
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
    '(function(){ try { var i = window.__arcadeTest && window.__arcadeTest.careerInfo ? window.__arcadeTest.careerInfo() : null; return !!(i && i.isCommission === true && i.locked === true && i.active === true) && !!(window.__arcadeCareerTest && window.__arcadeCareerTest.commissionRun && window.__arcadeCareerTest.commissionRun()); } catch (e) { return false; } })()',
    READY_TIMEOUT,
    '职业 run 激活'
  );
  await waitFor(
    ctx,
    '(function(){ try { var o = document.querySelector("[data-overlay]"); var g = document.querySelector("[data-career-goal]"); return !!o && !o.hidden && !!g && g.getClientRects().length > 0; } catch (e) { return false; } })()',
    READY_TIMEOUT,
    '职业开局弹层/目标行'
  );
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
  await waitFor(
    ctx,
    '(function(){ try { return window.__arcadeTest.careerInfo().state === "playing"; } catch (e) { return false; } })()',
    READY_TIMEOUT,
    '进入游玩态'
  );
  return careerInfo(ctx);
}

/**
 * 用一个真实稳定层：等吊钩持箱 → releaseWhenTowerAligned 在预测落点跨过塔顶中心那一帧
 * 真实 releaseBox() → 等真实 settleDrop() 提交 → 核对「提交数 +1、事件 +1、payload 单调」。
 */
async function commitFloor(ctx) {
  const before = await careerInfo(ctx);
  invariant(before && before.active === true, '提交前职业 run 不可用：' + JSON.stringify(before));
  invariant(before.state === 'playing', '提交前必须处于游玩态：' + JSON.stringify({ state: before.state }));
  await waitFor(
    ctx,
    '(function(){ try { var i = window.__arcadeTest.info(); return i.state === "playing" && i.pendHasBox === true && i.dropping === false; } catch (e) { return false; } })()',
    READY_TIMEOUT,
    '吊钩重新持箱'
  );
  const released = await evaluate(ctx, 'window.__arcadeTest.releaseWhenTowerAligned(0, 8)');
  invariant(released === true, '真实释放被拒绝（不在可释放时机）：' + JSON.stringify({ released, before }));
  const expected = before.stableFloors + 1;
  await waitFor(
    ctx,
    '(function(){ try { var i = window.__arcadeTest.careerInfo(); return i.stableFloors >= ' + expected + '; } catch (e) { return false; } })()',
    COMMIT_TIMEOUT,
    '第 ' + expected + ' 层真实稳定提交'
  );
  const after = await careerInfo(ctx);
  const events = await commissionEvents(ctx);
  const stable = stableEventsOf(events);
  invariant(after.stableFloors === expected, '真实稳定提交数=' + after.stableFloors + ' 期望=' + expected);
  invariant(after.floorsReached === before.floorsReached + 1, 'HUD 真实层数=' + after.floorsReached + ' 期望=' + (before.floorsReached + 1));
  invariant(stable.length === expected, '委托事件条数=' + stable.length + ' 期望=' + expected + '（每稳一层恰一条，倒塌/临时层不计）');
  invariant(after.stableEvents === expected, 'careerInfo.stableEvents=' + after.stableEvents + ' 期望=' + expected);
  const floors = floorPayloads(events);
  invariant(floors.length === expected, 'payload floor 条数=' + floors.length + ' 期望=' + expected);
  for (let i = 1; i < floors.length; i += 1) {
    invariant(floors[i] > floors[i - 1], 'payload floor 未随真实层数递增：' + JSON.stringify(floors));
  }
  return { floors: after.stableFloors, stableEvents: stable.length, floorsReached: after.floorsReached, score: after.score };
}

/** 真实点击暂停（不结算）：runner 的 success/failure 证据都在暂停态交给 bridge 结算。 */
async function pauseGame(ctx) {
  const info = await careerInfo(ctx);
  if (info && info.state === 'paused') return;
  const clicked = await evaluate(
    ctx,
    '(function(){ var b = document.querySelector("[data-pause]"); if (!b) return false; b.click(); return true; })()'
  );
  invariant(clicked === true, '暂停按钮不可点');
  await waitFor(
    ctx,
    '(function(){ try { return window.__arcadeTest.careerInfo().state === "paused"; } catch (e) { return false; } })()',
    6000,
    '进入暂停态'
  );
}

/** 职业隔离/目标行断言（success 与 failure 共用）。 */
async function assertCareerGate(ctx, target) {
  const info = await careerInfo(ctx);
  invariant(info && info.isCommission === true && info.locked === true, '职业 run 未锁定：' + JSON.stringify(info));
  invariant(info.goalLineVisible === true, '职业 run 缺少可见目标行：' + JSON.stringify(info));
  invariant(info.atLeast === target, '目标层数与内容不一致：' + JSON.stringify({ atLeast: info.atLeast, target }));
  invariant(info.objectiveKind === STABLE_EVENT, '目标 kind 不是 tower.floor_stable：' + JSON.stringify(info.objectiveKind));
  invariant(typeof info.goalText === 'string' && info.goalText.indexOf('稳定层') !== -1, '目标行未显示稳定层：' + JSON.stringify(info.goalText));
  invariant(info.serializeNull === true, '职业 run serialize() 未返回 null');
  invariant(info.challengeEntryHidden === true && info.challengeLayerHidden === true, '职业 run 出现挑战入口：' + JSON.stringify(info));
  invariant(info.runSavePresent === false, '职业 run 写入了 runs:v1 局内档');
  return info;
}

function baseReturn(ctx, extra) {
  return Object.assign({ gameId: gameId, tier: ctx.tier, target: targetOf(ctx) }, extra || {});
}

/* ------------------------------------------------------------------ *
 * success / failure
 * ------------------------------------------------------------------ */

async function success(ctx) {
  const target = targetOf(ctx);
  invariant(Number.isFinite(target) && target >= 1, '无法读取 ' + ctx.tier + ' 阶目标稳定层数');
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await assertCareerGate(ctx, target);
  invariant(info0.stableFloors === 0 && info0.stableEvents === 0, '开局前就有稳定层事件：' + JSON.stringify({ floors: info0.stableFloors, events: info0.stableEvents }));
  await startPlaying(ctx);

  const steps = [];
  for (let i = 0; i < target; i += 1) steps.push(await commitFloor(ctx));
  const last = steps[steps.length - 1];
  invariant(last.floors === target, '真实稳定层不足：' + last.floors + ' < ' + target);

  const info = await careerInfo(ctx);
  invariant(info.progress && info0.progress && info.progress.plays === info0.progress.plays, '职业 run 改变了经典 plays');
  invariant(info.progress.high === info0.progress.high, '职业 run 改变了经典最高分');
  invariant(info.scoresCount === info0.scoresCount, '职业 run 写入了积分记录');
  invariant(info.runSavePresent === false, '职业 run 写入了 runs:v1 局内档');

  await pauseGame(ctx);
  const paused = await careerInfo(ctx);
  invariant(paused && paused.state === 'paused' && paused.serializeNull === true, '暂停后隔离未保持：' + JSON.stringify(paused));
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);

  return baseReturn(ctx, {
    events: { [STABLE_EVENT]: paused.stableEvents },
    stats: {
      score: paused.score,
      floor: paused.stableFloors,
      target,
      floorsReached: paused.floorsReached,
      stableEvents: paused.stableEvents,
      steps: steps.map((step) => step.floors),
      classicKeysUnchanged: true,
    },
  });
}

async function failure(ctx) {
  const target = targetOf(ctx);
  const shortFloors = Math.max(1, Math.min(target - 1, FAILURE_FLOORS));
  invariant(shortFloors < target, '失败场景层数不合法：' + shortFloors + '/' + target);
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  await assertCareerGate(ctx, target);
  await startPlaying(ctx);

  for (let i = 0; i < shortFloors; i += 1) await commitFloor(ctx);
  const info = await careerInfo(ctx);
  invariant(info.stableFloors === shortFloors, '失败场景稳定层=' + info.stableFloors + ' 期望=' + shortFloors);
  invariant(info.stableFloors < target, '失败场景目标不应达成：' + JSON.stringify({ floors: info.stableFloors, target }));
  invariant(info.stableEvents === shortFloors, '失败场景事件条数=' + info.stableEvents + ' 期望=' + shortFloors);
  invariant(info.runSavePresent === false, '职业 run 写入了 runs:v1 局内档');

  await pauseGame(ctx);
  const paused = await careerInfo(ctx);
  invariant(paused && paused.state === 'paused' && paused.serializeNull === true, '暂停后隔离未保持：' + JSON.stringify(paused));
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);

  return baseReturn(ctx, {
    events: { [STABLE_EVENT]: paused.stableEvents },
    stats: {
      score: paused.score,
      floor: paused.stableFloors,
      target,
      observed: paused.stableFloors,
      floorsReached: paused.floorsReached,
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
  return { ok: true, ticketKey: 'studiokit:arcade:career:ticket.v1', isolatedKeys: ISO_KEYS.slice() };
}
