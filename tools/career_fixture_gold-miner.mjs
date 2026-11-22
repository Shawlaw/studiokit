#!/usr/bin/env node
/**
 * StudioKit Arcade Life 0.17 — D17-18 gold-miner 六阶职业委托 fixture。
 *
 * 契约：docs/arcade-life/ADR-interfaces.md §19.2 / §19.3 / §19.4 / §19.8
 * - 目标来自 content/commissions.json：gold-miner.T1..T6 = mineral.returned，
 *   atLeast 依次为 2 / 3 / 4 / 5 / 6 / 8；
 * - 全部用真实钩子驱动：真实开始按钮 `[data-ov-btn]`、真实摆钩（__arcadeTest.aimRelease
 *   等摆角到目标角度后由页面 update() 调用真实 releaseClaw）、真实伸出/夹取/回收
 *   （update → clawTip 碰撞 → attachHolding → retract → cashIn）、真实入账后由页面
 *   自己提交 mineral.returned；fixture 不伪造事件、不改金额/件数；
 * - `#test` 出手机钩只用于确定性布置（clearItems/addGold 放一块真实可抓的金块、setTimeLeft
 *   防止中途倒计时打断）与真实提前收工出口；抓取/回收/入账全程走生产代码；
 * - success：先证明「抓到未返回不计」（同一 JS 任务内真实夹住后立刻读委托缓冲仍为 0，
 *   真实回收完成后才 +1），再真实入库到 atLeast 件 → 页面 completeCareerGoal() 收工并
 *   经 bridge/commission-core 结算成功并出收据；
 * - failure：真实入库 atLeast-1 件（T1为1件、其余为2件，明确“返回矿物不足”）后走真实
 *   倒计时归零 → 页面 gameOver() → career.finish(lost)，结算归因 objective-not-met、
 *   零奖励、run failed、无 claim；
 * - T4–T6 先 seedStoryFlags（C3/C4/C5）再 startCommission；不改变生产可见性；
 * - 每阶 success/failure 都对照经典 5 键（runs/progress/scores/challenge/meta）逐字节不变；
 *   fixture 不写文件、不碰仓库、不 new CDP。
 *
 * 只由 tools/career_mission_fixture_runner.mjs 装载（或仓库外等价 harness 以同一 helper 面驱动）。
 */

export const gameId = 'gold-miner';

/* 内容真值兜底（runner 的 getCommission(tier) 可用时以内容为准）。 */
const TIER_RETURNS = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 8 };
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
/* 失败场景真实入库件数上限（必须 < atLeast；T1 只入库 1 件）。 */
const FAILURE_RETURNS = 2;
/* 确定性矿物：页面 PIVOT(210,104) 出发、角度 0.42rad（≈24.07°）、距离 300 的真实可抓位置。 */
const SWING_DEG = 24.07;
const MINERAL = { x: 332, y: 378 };

function invariant(condition, message) {
  if (!condition) throw new Error('[gold-miner fixture] ' + message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(ctx, expression, timeout = 9000, interval = 80) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await ctx.cdp.evaluate(expression);
    } catch (err) {
      last = null;
    }
    if (last) return last;
    await sleep(interval);
  }
  throw new Error('[gold-miner fixture] 等待超时：' + expression + '（最后值 ' + JSON.stringify(last) + '）');
}

/* ------------------------------------------------------------------ *
 * 只读读取
 * ------------------------------------------------------------------ */

async function careerInfo(ctx) {
  return ctx.cdp.evaluate(
    '(function(){ try { return window.__arcadeTest && window.__arcadeTest.careerInfo ? window.__arcadeTest.careerInfo() : null; } catch (e) { return null; } })()'
  );
}

async function gameInfo(ctx) {
  return ctx.cdp.evaluate('(function(){ try { return window.__arcadeTest.info(); } catch (e) { return null; } })()');
}

async function commissionEvents(ctx) {
  const state = await ctx.cdp.evaluate(
    '(function(){ try { return window.__arcadeCareerTest ? window.__arcadeCareerTest.commissionState() : null; } catch (e) { return null; } })()'
  );
  return state && Array.isArray(state.events) ? state.events : [];
}

async function lastCommissionResult(ctx) {
  return ctx.cdp.evaluate(
    '(function(){ try { var t = window.__arcadeCareerTest; var info = t && typeof t.info === "function" ? t.info() : null; return info && info.commissionLastResult ? info.commissionLastResult : null; } catch (e) { return null; } })()'
  );
}

async function snapshotIsolation(ctx) {
  return ctx.cdp.evaluate(
    '(function(){ var keys = ' +
      JSON.stringify(ISO_KEYS) +
      '; var out = {}; keys.forEach(function (key) { try { out[key] = localStorage.getItem(key); } catch (e) { out[key] = null; } }); return out; })()'
  );
}

function assertIsolation(before, after) {
  ISO_KEYS.forEach((key) => {
    invariant(before[key] === after[key], '职业 run 写入了经典键 ' + key + '：' + JSON.stringify({ before: before[key], after: after[key] }));
  });
}

function targetOf(ctx) {
  try {
    const commission =
      ctx.helpers && typeof ctx.helpers.getCommission === 'function' ? ctx.helpers.getCommission(ctx.tier) : null;
    const objective = commission && commission.objective ? commission.objective : null;
    const raw = objective ? Number(objective.atLeast) : NaN;
    if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  } catch (err) {
    /* 回退到内容真值 */
  }
  return TIER_RETURNS[ctx.tier];
}

/* ------------------------------------------------------------------ *
 * 真实驱动：接单 / 开局 / 摆钩入库 / 真实收工 / 结算等待
 * ------------------------------------------------------------------ */

/** 接单 → 进入委托页 → 等页面职业锁定；T4–T6 先写受控剧情旗标。 */
async function openRun(ctx) {
  const helpers = ctx.helpers;
  invariant(helpers && typeof helpers.startCommission === 'function', 'runner 未提供 startCommission');
  const flag = TIER_CHAPTER_FLAG[ctx.tier];
  if (flag) {
    /* 受控剧情旗标：只写 DB quests 行，不改生产可见性（runner helper 实现）。 */
    const seeded = await helpers.seedStoryFlags([flag]);
    invariant(seeded && seeded.ok !== false, 'seedStoryFlags 失败：' + JSON.stringify(seeded));
  }
  const started = await helpers.startCommission(ctx.tier);
  invariant(started && started.ok !== false, 'startCommission 失败：' + JSON.stringify(started));
  const nav = await helpers.navigateGame();
  invariant(nav && nav.ok !== false, 'navigateGame 失败：' + JSON.stringify(nav));
  await waitFor(
    ctx,
    '(function(){ try { var i = window.__arcadeTest && window.__arcadeTest.careerInfo ? window.__arcadeTest.careerInfo() : null; return !!(i && i.isCommission === true && i.locked === true) && !!(window.__arcadeCareerTest && window.__arcadeCareerTest.commissionRun()); } catch (e) { return false; } })()',
    12000
  );
  return { started, nav };
}

/** 真实点击开始按钮（职业 run 内开始弹层仍由玩家点按）。 */
async function clickStart(ctx) {
  const info = await careerInfo(ctx);
  if (info && info.state === 'playing') return info;
  await waitFor(ctx, "!!document.querySelector('[data-overlay]') && !document.querySelector('[data-overlay]').hidden", 9000);
  const clicked = await ctx.cdp.evaluate(
    "(function(){ var b = document.querySelector('[data-ov-btn]'); if (!b || b.hidden || !b.getClientRects().length) return false; b.click(); return true; })()"
  );
  invariant(clicked === true, '开始游戏按钮不可点');
  await waitFor(ctx, '(function(){ try { var i = window.__arcadeTest.careerInfo(); return i && i.state === "playing"; } catch (e) { return false; } })()', 9000);
  return careerInfo(ctx);
}

/** 轮询页面职业探针，直到真实入库件数达到 expected。 */
async function waitReturn(ctx, expected, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await careerInfo(ctx);
    if (last && Number(last.returns) >= expected) return last;
    await sleep(50);
  }
  throw new Error('[gold-miner fixture] 等待真实入库超时（目标 ' + expected + ' 件）：' + JSON.stringify(last));
}

/**
 * 证明「抓到未返回不计」：同一个 JS 任务内真实夹住一块矿物后立刻读委托缓冲——
 * 期间没有任何帧推进、还没拉回，因此 mineral.returned 必须仍为 0；随后真实回收完成才 +1。
 * @returns {Promise<{probe:object, returned:object}>}
 */
async function proveGrabNotReturned(ctx) {
  const probe = await ctx.cdp.evaluate(`(function(){
    var t = window.__arcadeTest;
    if (!t) return null;
    t.clearItems();
    t.setTimeLeft(70);
    t.addGold(${MINERAL.x}, ${MINERAL.y});
    var grabbed = t.grabFirst('goldM', 320);
    var career = window.__arcadeCareerTest;
    var state = career && typeof career.commissionState === 'function' ? career.commissionState() : null;
    var events = state && Array.isArray(state.events) ? state.events.filter(function (e) { return e && e.kind === 'mineral.returned'; }).length : -1;
    var info = t.careerInfo ? t.careerInfo() : null;
    return {
      grabbed: grabbed === true,
      events: events,
      holding: info ? info.holding : null,
      returns: info ? info.returns : events,
      clawState: info ? info.clawState : null,
    };
  })()`);
  invariant(probe && probe.grabbed === true, '真实夹取被拒绝：' + JSON.stringify(probe));
  invariant(probe.holding === 'goldM' && probe.clawState === 'retract', '夹住后应处于回收态：' + JSON.stringify(probe));
  invariant(probe.returns === 0 && probe.events === 0, '抓到但未拉回就计数了（抓到未返回不计被破坏）：' + JSON.stringify(probe));
  const returned = await waitReturn(ctx, 1);
  invariant(returned.returns === 1 && returned.returnEvents === 1, '真实回收完成后应恰好 +1：' + JSON.stringify(returned));
  return {
    probe: { grabbed: true, eventsBefore: probe.events, clawState: probe.clawState, holding: probe.holding },
    returned: { returns: returned.returns, returnEvents: returned.returnEvents, money: returned.money },
  };
}

/**
 * 真实摆钩入库 count 件：每件都用 #test 钩子清理随机矿物 + 放一块确定性金块，
 * 再真实摆钩（aimRelease 等摆角 → 页面 update 调用真实 releaseClaw）→ 真实伸出/
 * 夹取/回收/入账（cashIn 里由页面自己提交 mineral.returned）。fixture 不写事件。
 * @returns {Promise<{returns:number, returnEvents:number, money:number}>}
 */
async function returnMinerals(ctx, count) {
  for (let i = 0; i < count; i += 1) {
    const before = await careerInfo(ctx);
    invariant(before && before.state === 'playing', '真实入库前应处于游玩态：' + JSON.stringify(before));
    const placed = await ctx.cdp.evaluate(
      `(function(){
        var t = window.__arcadeTest;
        if (!t) return { ok: false };
        t.clearItems();
        t.setTimeLeft(70);
        var added = t.addGold(${MINERAL.x}, ${MINERAL.y});
        return { ok: added === true, items: t.info().items, timeLeft: t.info().timeLeft };
      })()`
    );
    invariant(placed && placed.ok === true && placed.items === 1, '布置确定性矿物失败：' + JSON.stringify(placed));
    const armed = await ctx.cdp.evaluate('window.__arcadeTest.aimRelease(' + SWING_DEG + ', 1.2)');
    invariant(armed === true, '真实摆钩释放申请被拒绝');
    const after = await waitReturn(ctx, before.returns + 1);
    invariant(after.returns === before.returns + 1, '真实入库件数应恰好 +1：' + JSON.stringify({ before: before.returns, after: after.returns }));
    invariant(
      after.returnEvents === before.returnEvents + 1,
      '每件矿物必须且只提交一次 mineral.returned：' + JSON.stringify({ before: before.returnEvents, after: after.returnEvents })
    );
    invariant(Number(after.money) > Number(before.money), '入库未推进真实金额：' + JSON.stringify({ before: before.money, after: after.money }));
    await ctx.cdp.evaluate('window.__arcadeTest.cancelAimRelease()');
  }
  return careerInfo(ctx);
}

/** 真实倒计时归零收工：setTimeLeft 只改剩余时间，胜负与结算都走页面真实 gameOver()。 */
async function timeUp(ctx) {
  const info = await careerInfo(ctx);
  invariant(info && info.state === 'playing', '倒计时收工前应处于游玩态：' + JSON.stringify(info));
  await ctx.cdp.evaluate('window.__arcadeTest.setTimeLeft(0.05)');
  await waitFor(
    ctx,
    '(function(){ try { var i = window.__arcadeTest.careerInfo(); return i && i.state === "over"; } catch (e) { return false; } })()',
    9000
  );
  return careerInfo(ctx);
}

/** 页面结算（成功或可归因失败）后 bridge 清空 commissionRun；再取 commissionLastResult。 */
async function waitSettled(ctx) {
  await waitFor(
    ctx,
    '(function(){ try { var i = window.__arcadeTest && window.__arcadeTest.careerInfo ? window.__arcadeTest.careerInfo() : null; return !!(i && i.settled === true && i.settledPending === false); } catch (e) { return false; } })()',
    18000
  );
  const deadline = Date.now() + 5000;
  let last = null;
  while (Date.now() < deadline) {
    last = await lastCommissionResult(ctx);
    if (last) return last;
    await sleep(80);
  }
  return last;
}

function summarizeResult(result) {
  if (!result || typeof result !== 'object') return null;
  const receipt = result.receipt && typeof result.receipt === 'object' ? result.receipt : null;
  return {
    ok: result.ok === true,
    reason: typeof result.reason === 'string' ? result.reason : null,
    duplicate: result.duplicate === true,
    repeat: result.repeat === true,
    observed: Number.isFinite(Number(result.observed)) ? Number(result.observed) : null,
    credits: receipt ? Number(receipt.credits) || 0 : Number(result.credits) || 0,
    evidence: receipt && Array.isArray(receipt.evidence) ? receipt.evidence.slice() : [],
    items: receipt && receipt.items && typeof receipt.items === 'object' ? JSON.parse(JSON.stringify(receipt.items)) : {},
    receiptId: receipt && receipt.receiptId ? String(receipt.receiptId) : null,
  };
}

function baseReturn(ctx, extra) {
  return Object.assign({ gameId: gameId, tier: ctx.tier, returnsTarget: targetOf(ctx) }, extra || {});
}

/* ------------------------------------------------------------------ *
 * success / failure
 * ------------------------------------------------------------------ */

async function success(ctx) {
  const target = targetOf(ctx);
  invariant(Number.isFinite(target) && target >= 1, '无法读取 ' + ctx.tier + ' 阶目标入库件数');
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  invariant(info0 && info0.isCommission === true && info0.locked === true, '职业 run 未锁定：' + JSON.stringify(info0));
  invariant(info0.goalLineVisible === true, '职业 run 缺少可见目标行：' + JSON.stringify(info0));
  invariant(info0.targetReturns === target, '目标件数与内容不一致：' + JSON.stringify({ target, info: info0.targetReturns }));
  invariant(info0.goalKind === 'mineral.returned', '目标事件类型应为 mineral.returned：' + JSON.stringify(info0.goalKind));
  invariant(info0.serializeNull === true, '职业 run serialize() 未返回 null');
  invariant(info0.challengeEntry === false, '职业 run 出现挑战入口：' + JSON.stringify(info0));
  invariant(info0.runSave === null, '职业 run 一开始就写了 runs:v1：' + JSON.stringify(info0.runSave));

  await clickStart(ctx);
  const guard = await proveGrabNotReturned(ctx);
  const driven = await returnMinerals(ctx, target - 1);
  invariant(driven.returns === target, '真实入库件数不足：' + JSON.stringify({ returns: driven.returns, target }));
  invariant(driven.returnEvents === target, '事件条数应等于真实入库件数（每件一次）：' + JSON.stringify(driven));

  const result = await waitSettled(ctx);
  invariant(result && result.ok === true, 'success 结算失败：' + JSON.stringify(result));
  invariant(result.duplicate !== true, '首次结算不应 duplicate：' + JSON.stringify(result));
  const infoAfter = await careerInfo(ctx);
  invariant(infoAfter && infoAfter.settled === true, '职业结算标记缺失：' + JSON.stringify(infoAfter));
  invariant(infoAfter.goalDone === true && infoAfter.state === 'over', '职业 run 应在目标达成后收工：' + JSON.stringify(infoAfter));
  invariant(infoAfter.returns === target, '结算时真实入库件数应等于目标：' + JSON.stringify(infoAfter.returns));
  invariant(result.receipt && result.receipt.commissionId === gameId + '.T' + ctx.tier, 'receipt=' + JSON.stringify(result.receipt));
  invariant(
    infoAfter.plays === info0.plays && infoAfter.high === info0.high && infoAfter.scoresCount === info0.scoresCount,
    '职业 run 污染了经典 progress/scores：' + JSON.stringify({ before: info0, after: infoAfter })
  );
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);

  return baseReturn(ctx, {
    events: { 'mineral.returned': target },
    stats: { returns: target, money: Number(infoAfter.money) || 0, level: Number(infoAfter.level) || 1 },
    lastResult: summarizeResult(result),
    goalText: info0.goalText,
    guard: guard,
    returns: target,
    money: Number(infoAfter.money) || 0,
    receiptId: result.receipt ? String(result.receipt.receiptId || '') : null,
  });
}

async function failure(ctx) {
  const target = targetOf(ctx);
  const shortCount = Math.min(FAILURE_RETURNS, target - 1);
  invariant(shortCount >= 1 && shortCount < target, '失败场景必须明确少于目标：' + JSON.stringify({ shortCount, target }));
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  invariant(info0 && info0.isCommission === true && info0.locked === true, '职业 run 未锁定：' + JSON.stringify(info0));
  invariant(info0.goalLineVisible === true, '职业 run 缺少可见目标行');
  invariant(info0.targetReturns === target, '目标件数与内容不一致：' + JSON.stringify({ target, info: info0.targetReturns }));

  await clickStart(ctx);
  const driven = await returnMinerals(ctx, shortCount);
  invariant(driven.returns === shortCount, '失败场景应真实入库 ' + shortCount + ' 件：' + JSON.stringify(driven));
  invariant(driven.returns < target, '失败场景入库件数必须少于目标：' + JSON.stringify({ driven: driven.returns, target }));
  const over = await timeUp(ctx);
  invariant(over && over.state === 'over', '真实倒计时收工后应进入终局态：' + JSON.stringify(over));

  const result = await waitSettled(ctx);
  invariant(result && result.ok === false, '失败场景不应结算成功：' + JSON.stringify(result));
  invariant(result.reason === 'objective-not-met', '失败原因应为 objective-not-met：' + JSON.stringify(result));
  const observed = Number(result.observed);
  invariant(observed === shortCount, '失败归因件数应等于真实入库件数：' + JSON.stringify({ observed, shortCount }));
  invariant(observed < target, '失败场景目标不应达成：' + JSON.stringify({ observed, target }));
  invariant(!result.receipt, '失败结算不应返回收据：' + JSON.stringify(result.receipt));

  const infoAfter = await careerInfo(ctx);
  invariant(
    infoAfter.plays === info0.plays && infoAfter.high === info0.high && infoAfter.scoresCount === info0.scoresCount,
    '失败结算写入了经典 progress/scores：' + JSON.stringify({ before: info0, after: infoAfter })
  );
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  return baseReturn(ctx, {
    events: { 'mineral.returned': observed },
    stats: { returns: observed, money: Number(infoAfter.money) || 0, target: target },
    lastResult: summarizeResult(result),
    goalText: info0.goalText,
    observed: observed,
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
  /* ticket 由 runner 结算/清理；这里只做只读收尾，不写仓库。 */
  return { ok: true, ticketKey: TICKET_KEY, isolatedKeys: ISO_KEYS.slice(), gameInfo: await gameInfo(ctx) };
}
