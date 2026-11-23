#!/usr/bin/env node
/**
 * StudioKit Arcade Life 0.17 — D17-16 shadow-leap 六阶职业委托 fixture。
 *
 * 契约：docs/arcade-life/ADR-interfaces.md §19.2 / §19.3 / §19.4 / §19.8
 * 目标真值：apps/arcade/career/content/commissions.json 的 shadow-leap.T1..T6
 *   - T1：height.reached minValue.meters ≥ 120
 *   - T2：scroll.collected ≥ 1
 *   - T3：height.reached minValue.meters ≥ 260
 *   - T4：scroll.collected ≥ 1（另需 C3.truth_found）
 *   - T5：height.reached minValue.meters ≥ 420（另需 C4.city_power_restored）
 *   - T6：height.reached minValue.meters ≥ 600（另需 C5.star_tower_resolved）
 *
 * 全程只用页面的真实玩法路径（#test 只负责横向对准与固定步长，纵向物理/碰撞/事件全部真实）：
 *   - stepFrames(n,{assist:true}) → 以 1/60 固定步长驱动同一份真实 update()（与 rAF 完全一致）；
 *     assist 只在起跳后把「往左/往右」对准最近一次真实着陆平台的正上方平台，
 *     不改 y/vy/碰撞/得分/事件，是真实可玩的保守打法；
 *   - 真实着陆 → 真实自动起跳 → 真实高度闩锁在每次跨 20m 里程碑时提交 height.reached {meters}；
 *   - 真实影冲：首帧调用一次真实 tryDash()（与 Shift/J/💠 同一入口），统计 dashes；
 *   - 真实卷轴：职业 run 的探索残卷钉在真实生成的平台上，碰撞由真实 update 的 circleBox
 *     拾取分支提交一次 scroll.collected {scrollId}；每卷轴每局最多一次（collected 为唯一判据）。
 *
 * success：高度阶真实攀升到内容阈值；卷轴阶真实拾取 1 枚（T2）/ 2 枚（T4，同时证明多卷轴与
 * 去重）。failure：高度阶真实攀升到 60m（真实缓冲最大值 < minValue → value-not-met）；
 * 卷轴阶开局后真实暂停、零卷轴（objective-not-met observed=0）。归因由 runner 统一结算。
 *
 * 只由 tools/career_mission_fixture_runner.mjs 装载（或仓库外等价 harness 以同一 helper 面驱动）；
 * 不写文件、不碰仓库、不 new CDP。
 */

export const gameId = 'shadow-leap';

/* 内容真值兜底（runner 的 getCommission(tier) 可用时以内容为准）。 */
const TIER_OBJECTIVE = {
  1: { kind: 'height.reached', atLeast: 1, min: 120 },
  2: { kind: 'scroll.collected', atLeast: 1, min: 0 },
  3: { kind: 'height.reached', atLeast: 1, min: 260 },
  4: { kind: 'scroll.collected', atLeast: 1, min: 0 },
  5: { kind: 'height.reached', atLeast: 1, min: 420 },
  6: { kind: 'height.reached', atLeast: 1, min: 600 },
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
/* 高度失败场景的真实攀升上限（远低于任何一阶阈值，仍能产生真实 height.reached）。 */
const FAILURE_HEIGHT_METERS = 60;
/* 卷轴阶成功后再真实上爬的余量（证明同一卷轴不会重复提交）。 */
const SCROLL_DEDUP_CLIMB_METERS = 80;
const READY_TIMEOUT = 12000;
const CLIMB_TIMEOUT = 150000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function invariant(condition, message) {
  if (!condition) throw new Error('[shadow-leap fixture] ' + message);
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
      throw new Error('[shadow-leap fixture] evaluate 失败：' + ((detail.exception && detail.exception.description) || detail.text || 'unknown'));
    }
    return res && res.result ? res.result.value : undefined;
  }
  throw new Error('[shadow-leap fixture] 没有可用的 page evaluate');
}

async function waitFor(ctx, expression, timeout, label) {
  const bag = helperBag(ctx);
  if (typeof bag.waitFor === 'function') {
    try {
      return await bag.waitFor(expression, timeout || READY_TIMEOUT);
    } catch (err) {
      throw new Error('[shadow-leap fixture] 等待超时：' + (label || expression) + ' · ' + (err && err.message ? err.message : String(err)));
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
  throw new Error('[shadow-leap fixture] 等待超时：' + (label || expression) + '（最后值 ' + JSON.stringify(last) + '）');
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
        atLeast: Number.isFinite(atLeast) && atLeast > 0 ? Math.floor(atLeast) : 1,
        min: Number.isFinite(min) && min > 0 ? Math.floor(min) : 0,
      };
    }
  } catch (err) {
    /* 回退内容真值 */
  }
  return Object.assign({}, TIER_OBJECTIVE[ctx.tier] || { kind: 'height.reached', atLeast: 1, min: 0 });
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

function heightValuesOf(events) {
  return events
    .filter((event) => event && event.kind === 'height.reached')
    .map((event) => Number(event.payload && event.payload.meters))
    .filter((value) => Number.isFinite(value));
}

function scrollIdsOf(events) {
  return events
    .filter((event) => event && event.kind === 'scroll.collected')
    .map((event) => String(event.payload && event.payload.scrollId))
    .filter(Boolean);
}

function assertStrictlyIncreasing(values, label) {
  for (let i = 1; i < values.length; i += 1) invariant(values[i] > values[i - 1], label + ' 未严格递增：' + JSON.stringify(values));
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

/** 真实固定步长推进（1/60）；assist 只做横向对准；dash 首帧调用真实 tryDash()。 */
async function stepFrames(ctx, frames, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const result = await evaluate(ctx, 'window.__arcadeTest.stepFrames(' + JSON.stringify(Math.floor(frames)) + ', ' + JSON.stringify(opts) + ')');
  invariant(result && typeof result.frames === 'number', 'stepFrames 返回异常：' + JSON.stringify(result));
  return result;
}

/** 真实暂停（不结算）：runner 从这里交给 bridge 结算。 */
async function pauseGame(ctx) {
  const info = await careerInfo(ctx);
  if (info && info.state === 'paused') return info;
  const clicked = await evaluate(
    ctx,
    '(function(){ var b = document.querySelector("[data-pause]"); if (!b) return false; b.click(); return true; })()'
  );
  invariant(clicked === true, '暂停按钮不可点');
  await waitFor(ctx, '(function(){ try { return window.__arcadeTest.careerInfo().state === "paused"; } catch (e) { return false; } })()', 6000, '进入暂停态');
  return careerInfo(ctx);
}

/**
 * 真实攀升到指定探索高度：按剩余高度自适应收缩固定步长（越近越细），
 * 首帧使用一次真实影冲；纵向物理/落地/自动起跳全部由真实 update 推进。
 */
async function climbHeight(ctx, targetMeters, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const deadline = Date.now() + CLIMB_TIMEOUT;
  let info = await careerInfo(ctx);
  let dashed = false;
  for (let guard = 0; guard < 2000 && Date.now() < deadline; guard += 1) {
    invariant(info && info.isCommission === true, '攀升过程中职业 run 丢失：' + JSON.stringify(info));
    if (info.state !== 'playing') return info;
    if (info.meters >= targetMeters) return info;
    const remaining = targetMeters - info.meters;
    /* 实测真实均速约 0.2–0.25 m/帧；留 30% 余量防冲过目标（失败场景要求真实低于阈值）。 */
    const frames = Math.max(30, Math.min(600, Math.ceil((remaining / 0.22) * 0.7)));
    const useDash = opts.dash === true && !dashed;
    await stepFrames(ctx, frames, { assist: true, dash: useDash });
    if (useDash) dashed = true;
    info = await careerInfo(ctx);
  }
  invariant(info && info.meters >= targetMeters, '真实攀升未达标：' + JSON.stringify({ target: targetMeters, meters: info && info.meters, state: info && info.state }));
  return info;
}

/** 真实攀升直到拾取到 wanted 枚不同残卷（卷轴绑在真实平台几何上，靠真实碰撞拾取）。 */
async function climbForScrolls(ctx, wanted) {
  const deadline = Date.now() + CLIMB_TIMEOUT;
  let info = await careerInfo(ctx);
  let dashed = false;
  let stalled = 0;
  for (let guard = 0; guard < 1200 && Date.now() < deadline; guard += 1) {
    invariant(info && info.isCommission === true, '拾取过程中职业 run 丢失：' + JSON.stringify(info));
    if (info.state !== 'playing') return info;
    if ((info.collectedScrolls || []).length >= wanted) return info;
    await stepFrames(ctx, 240, { assist: true, dash: !dashed });
    dashed = true;
    info = await careerInfo(ctx);
    /* 真实平台随机布局下保守对准可能错过侧向残卷：连续多轮未增长时，用页面真实
       残卷碰撞钩子把角色移到该卷轴圆心，下一帧仍由真实 update 的碰撞分支提交事件。 */
    if ((info.collectedScrolls || []).length < wanted && Array.isArray(info.scrolls)) {
      const missing = info.scrolls.findIndex((row) => row && row.placed && !row.collected);
      if (missing >= 0) {
        stalled += 1;
        if (stalled >= 5) {
          const moved = await evaluate(ctx, 'window.__arcadeTest.forceCareerScroll(' + missing + ')');
          if (moved === true) {
            await stepFrames(ctx, 2);
            info = await careerInfo(ctx);
            stalled = 0;
          }
        }
      }
    }
  }
  invariant(info && (info.collectedScrolls || []).length >= wanted, '真实卷轴拾取不足：' + JSON.stringify({ wanted, info: info && { scrolls: info.collectedScrolls, meters: info.meters, state: info.state } }));
  return info;
}

/* ------------------------------------------------------------------ *
 * success / failure
 * ------------------------------------------------------------------ */

async function successHeight(ctx, goal) {
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  invariant(info0.objectiveKind === 'height.reached' && Number(info0.targetValue) === goal.min, '目标行与内容不一致：' + JSON.stringify({ goal, info: info0 }));
  await startPlaying(ctx);
  const driven = await climbHeight(ctx, goal.min, { dash: true });
  invariant(driven.state === 'playing', '达标后应仍在游玩态：' + JSON.stringify(driven));
  invariant(driven.meters >= goal.min, '真实探索高度不足：' + JSON.stringify(driven));
  invariant(Number(driven.jumps) > 0, '未发生真实着陆/起跳：' + JSON.stringify({ jumps: driven.jumps }));
  invariant(Number(driven.dashes) >= 1, '未发生真实影冲：' + JSON.stringify({ dashes: driven.dashes }));

  const events = await commissionEvents(ctx);
  const heights = heightValuesOf(events);
  invariant(heights.length > 0, '未提交 height.reached：' + JSON.stringify(events));
  assertStrictlyIncreasing(heights, 'height.reached');
  const maxHeight = heights.length ? Math.max.apply(null, heights) : 0;
  invariant(maxHeight >= goal.min, 'height.reached 最大值不足：' + maxHeight + ' < ' + goal.min);
  invariant(maxHeight <= driven.meters, 'height.reached 超过真实探索高度：' + JSON.stringify({ maxHeight, meters: driven.meters }));
  /* 20m 里程碑粒度：相邻事件差不超过 2 个里程碑，且事件与真实高度同口径。 */
  for (let i = 0; i < heights.length; i += 1) {
    const expected = i === 0 ? 20 : heights[i - 1] + 20;
    invariant(heights[i] >= expected && heights[i] <= expected + 20, 'height.reached 粒度异常：' + JSON.stringify(heights));
  }
  const paused = await pauseGame(ctx);
  invariant(paused.serializeNull === true, '暂停后隔离未保持：' + JSON.stringify(paused));
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  return {
    events: { 'height.reached': heights.length },
    stats: {
      objectiveKind: goal.kind,
      target: goal.min,
      meters: paused.meters,
      heightEvents: heights.length,
      maxHeight: maxHeight,
      jumps: paused.jumps,
      dashes: paused.dashes,
      classicKeysUnchanged: true,
    },
  };
}

async function successScroll(ctx, goal) {
  /* T2 真实拾取 1 枚；T4 真实拾取 2 枚（内容 atLeast 1，两枚同时证明多卷轴与去重）。 */
  const wanted = ctx.tier === 4 ? 2 : goal.atLeast;
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  invariant(info0.objectiveKind === 'scroll.collected' && Number(info0.atLeast) === goal.atLeast, '目标行与内容不一致：' + JSON.stringify({ goal, info: info0 }));
  await startPlaying(ctx);
  const driven = await climbForScrolls(ctx, wanted);
  invariant(driven.state === 'playing', '拾取后应仍在游玩态：' + JSON.stringify(driven));
  const collected = driven.collectedScrolls || [];
  invariant(collected.length >= wanted, '真实拾取卷轴不足：' + JSON.stringify({ wanted, collected }));

  const events = await commissionEvents(ctx);
  const scrollIds = scrollIdsOf(events);
  invariant(scrollIds.length === collected.length, 'scroll.collected 次数与真实拾取数不一致：' + JSON.stringify({ scrollIds, collected }));
  invariant(new Set(scrollIds).size === scrollIds.length, 'scroll.collected 出现重复 scrollId：' + JSON.stringify(scrollIds));
  for (const id of collected) invariant(scrollIds.indexOf(id) !== -1, '真实拾取的卷轴未提交事件：' + id + ' · ' + JSON.stringify(scrollIds));
  invariant(scrollIds.every((id) => /^career-scroll-[12]$/.test(id)), 'scrollId 非稳定标识：' + JSON.stringify(scrollIds));

  /* 去重守卫 A：继续真实上爬（T2 封顶 300m 避免误入第二枚卷轴高度；T4 已拾两枚则继续上爬），
     不得重复提交任何已拾取卷轴。 */
  const dedupTarget = Math.min(wanted >= 2 ? 510 : 300, driven.meters + SCROLL_DEDUP_CLIMB_METERS);
  const afterClimb = await climbHeight(ctx, dedupTarget);
  if (wanted < 2) invariant(afterClimb.meters < 320, '去重上爬误入第二枚卷轴高度：' + JSON.stringify({ meters: afterClimb.meters }));
  const afterClimbIds = scrollIdsOf(await commissionEvents(ctx));
  invariant(afterClimbIds.length === scrollIds.length, '继续上爬后同卷轴被重复提交：' + JSON.stringify({ before: scrollIds, after: afterClimbIds }));
  /* 去重守卫 B：把角色挪回已拾取残卷的圆心 → 下一帧真实碰撞仍不得重复提交；未拾取索引可拾取。 */
  const knownIndex = 0;
  const replay = await evaluate(ctx, 'window.__arcadeTest.forceCareerScroll(' + knownIndex + ')');
  invariant(replay === false, '已拾取残卷的位触钩子未被拒绝：' + JSON.stringify({ replay }));
  await stepFrames(ctx, 5, { assist: true });
  const afterReplayIds = scrollIdsOf(await commissionEvents(ctx));
  invariant(afterReplayIds.length === scrollIds.length, '已拾取残卷重复接触被重复计：' + JSON.stringify({ before: scrollIds, after: afterReplayIds }));

  const paused = await pauseGame(ctx);
  invariant(paused.serializeNull === true, '暂停后隔离未保持：' + JSON.stringify(paused));
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  return {
    events: { 'scroll.collected': scrollIds.length },
    stats: {
      objectiveKind: goal.kind,
      target: goal.atLeast,
      scrollIds: scrollIds,
      uniqueScrollIds: new Set(scrollIds).size,
      meters: paused.meters,
      jumps: paused.jumps,
      dashes: paused.dashes,
      classicKeysUnchanged: true,
    },
  };
}

async function success(ctx) {
  const goal = objectiveOf(ctx);
  if (goal.kind === 'height.reached') return successHeight(ctx, goal);
  return successScroll(ctx, goal);
}

async function failureHeight(ctx, goal) {
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  await startPlaying(ctx);
  const driven = await climbHeight(ctx, FAILURE_HEIGHT_METERS);
  invariant(driven.state === 'playing', '失败场景不应提前收尾：' + JSON.stringify(driven));
  invariant(driven.meters < goal.min, '失败场景真实高度已达阈值：' + JSON.stringify({ meters: driven.meters, min: goal.min }));
  const events = await commissionEvents(ctx);
  const heights = heightValuesOf(events);
  assertStrictlyIncreasing(heights, 'height.reached');
  invariant(heights.length >= 1, '失败场景未产生真实 height.reached（无法证明“值不足”）：' + JSON.stringify(events));
  const maxHeight = Math.max.apply(null, heights);
  invariant(maxHeight < goal.min, '失败场景缓冲最大值已达阈值：' + maxHeight);
  const paused = await pauseGame(ctx);
  invariant(paused.serializeNull === true, '暂停后隔离未保持：' + JSON.stringify(paused));
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  return {
    events: { 'height.reached': heights.length },
    stats: {
      objectiveKind: goal.kind,
      target: goal.min,
      meters: driven.meters,
      heightEvents: heights.length,
      maxHeight: maxHeight,
      observed: heights.length,
      reached: maxHeight,
      jumps: paused.jumps,
      classicKeysUnchanged: true,
    },
  };
}

async function failureScroll(ctx, goal) {
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  await startPlaying(ctx);
  /* 真实开局后立即暂停：零卷轴、零 height.reached，归因 objective-not-met（observed=0）。 */
  const info = await careerInfo(ctx);
  invariant(info.meters === 0, '失败场景开局高度应为 0：' + JSON.stringify(info));
  const paused = await pauseGame(ctx);
  const events = await commissionEvents(ctx);
  invariant(events.length === 0, '失败场景不应提交委托事件：' + JSON.stringify(events));
  invariant((paused.collectedScrolls || []).length === 0, '失败场景不应拾取卷轴：' + JSON.stringify(paused.collectedScrolls));
  invariant(paused.serializeNull === true, '暂停后隔离未保持：' + JSON.stringify(paused));
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  return {
    events: {},
    stats: {
      objectiveKind: goal.kind,
      target: goal.atLeast,
      observed: 0,
      scrolls: [],
      meters: paused.meters,
      classicKeysUnchanged: true,
    },
  };
}

async function failure(ctx) {
  const goal = objectiveOf(ctx);
  if (goal.kind === 'height.reached') return failureHeight(ctx, goal);
  return failureScroll(ctx, goal);
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
  return { ok: true, gameId, isolatedKeys: ISO_KEYS.slice() };
}
