#!/usr/bin/env node
/**
 * StudioKit Arcade Life 0.17 — D17-06 gomoku 六阶职业委托 fixture。
 *
 * 契约：docs/arcade-life/ADR-interfaces.md §19.2 / §19.3 / §19.4 / §19.8
 * - 目标来自 content/commissions.json：gomoku.T1/T3 = move.legal + atLeast 8/12；
 *   gomoku.T2/T4/T5/T6 = session.finish + atLeast 1；
 * - 全部用真实钩子驱动：__arcadeTest.moveNow/autoMove 走页面真实 applyPlayerMove 提交路径
 *   （与「落子」确认按钮同一条），__arcadeTest.undoNow 走真实 applyUndo，
 *   __arcadeTest.playToEnd(seed) 走真实 applyPlayerMove/performAIMove/finishGame（自然五连结束）；
 *   不直接改 board 内存、不伪造事件；
 * - success 覆盖「悔棋不得重复计功」：真实落子 1 手 → 真实悔棋 → move.legal 条数不变，
 *   再做目标落子/自然结束；T1–T3 由 startCommission 自动补线性解锁链，T4–T6 先 seedStoryFlags
 *   再 startCommission（不修改生产可见性）；
 * - failure 用「未达手数 / 未结束对局」归因：move.legal 阶打 target-1 手后结算，session.finish 阶
 *   只落 2 手不结束对局就结算 → reason=objective-not-met，零奖励；
 * - 返回的 events 只是「声明」，runner 会与 bridge 实际委托缓冲/收据对照，不会由 fixture 伪造。
 *
 * 只由 tools/career_mission_fixture_runner.mjs 装载；不写文件、不碰仓库、不 new CDP。
 */

export const gameId = 'gomoku';

/* 内容真值兜底（runner 的 getCommission(tier) 可用时以内容为准）。 */
const TIER_KIND = {
  1: 'move.legal',
  2: 'session.finish',
  3: 'move.legal',
  4: 'session.finish',
  5: 'session.finish',
  6: 'session.finish',
};
const TIER_TARGET = { 1: 8, 2: 1, 3: 12, 4: 1, 5: 1, 6: 1 };
/* T4–T6 章节旗标（ADR §19.2：T4 C3.truth_found / T5 C4.city_power_restored / T6 C5.star_tower_resolved）。 */
const TIER_CHAPTER_FLAG = { 4: 'C3.truth_found', 5: 'C4.city_power_restored', 6: 'C5.star_tower_resolved' };
/* 页面 TEST_SEED：playToEnd 在此种子下稳定走出 31 手（黑 16 手五连）胜局。 */
const TEST_SEED = 6;

const ISO_KEYS = [
  'studiokit:arcade:runs:v1',
  'studiokit:arcade:progress:v1',
  'studiokit:arcade:scores:v1',
  'studiokit:arcade:challenge:v1',
  'studiokit:arcade:meta:v1',
];

function invariant(condition, message) {
  if (!condition) throw new Error('[gomoku fixture] ' + message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function evaluate(ctx, expression) {
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
  throw new Error('[gomoku fixture] 等待超时：' + expression + '（最后值 ' + JSON.stringify(last) + '）');
}

/* ------------------------------------------------------------------ *
 * 委托内容 / 页面只读快照
 * ------------------------------------------------------------------ */

function objectiveOf(ctx) {
  try {
    const commission =
      ctx.helpers && typeof ctx.helpers.getCommission === 'function' ? ctx.helpers.getCommission(ctx.tier) : null;
    const objective = commission && commission.objective ? commission.objective : null;
    if (objective && typeof objective.kind === 'string' && objective.kind) {
      const atLeast = Math.floor(Number(objective.atLeast));
      return { kind: objective.kind, atLeast: Number.isFinite(atLeast) && atLeast > 0 ? atLeast : 1 };
    }
  } catch (err) {
    /* 回退到内容真值 */
  }
  return { kind: TIER_KIND[ctx.tier], atLeast: TIER_TARGET[ctx.tier] };
}

function commissionIdOf(ctx) {
  return 'gomoku.T' + ctx.tier;
}

async function careerInfo(ctx) {
  return evaluate(ctx, '(function(){ try { return window.__arcadeTest.careerInfo(); } catch (e) { return null; } })()');
}

async function readState(ctx) {
  return evaluate(ctx, '(function(){ try { return window.__arcadeTest.info(); } catch (e) { return null; } })()');
}

async function commissionEvents(ctx) {
  const state = await evaluate(
    ctx,
    '(function(){ try { return window.__arcadeCareerTest ? window.__arcadeCareerTest.commissionState() : null; } catch (e) { return null; } })()'
  );
  return state && Array.isArray(state.events) ? state.events : [];
}

function countKind(events, kind) {
  return (Array.isArray(events) ? events : []).filter((event) => event && event.kind === kind).length;
}

/* 只读 spy：记录页面真实调用 ArcadeCareer.observe 的事件（不改变行为，不伪造事件）。 */
async function installObserveSpy(ctx) {
  return evaluate(
    ctx,
    `(() => {
      const api = window.ArcadeCareer;
      if (!api || typeof api.observe !== 'function') return false;
      if (api.__d1706Spy) return true;
      const original = api.observe;
      window.__d1706Observed = [];
      api.observe = function (kind, payload) {
        let result = false;
        try { result = original.apply(this, arguments); } catch (err) { result = false; }
        try {
          window.__d1706Observed.push({
            kind: kind,
            payload: payload && typeof payload === 'object' ? JSON.parse(JSON.stringify(payload)) : payload === undefined ? null : payload,
            accepted: result !== false,
          });
        } catch (err) { /* ignore */ }
        return result;
      };
      api.__d1706Spy = true;
      return true;
    })()`
  );
}

async function observedEvents(ctx) {
  const events = await evaluate(ctx, 'Array.isArray(window.__d1706Observed) ? window.__d1706Observed.slice() : []');
  return Array.isArray(events) ? events : [];
}

function observedOfKind(events, kind) {
  return (Array.isArray(events) ? events : []).filter((event) => event && event.kind === kind);
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
      before[key] === after[key],
      '职业 run 写入了经典键 ' + key + '：' + JSON.stringify({ before: before[key], after: after[key] })
    );
  });
}

/* ------------------------------------------------------------------ *
 * 真实驱动
 * ------------------------------------------------------------------ */

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
  /* 等页面桥确认职业 run、页面锁定经典记录并由 #test 暴露 careerInfo。 */
  await waitFor(
    ctx,
    "(function(){ try { return !!(window.__arcadeTest && window.__arcadeTest.careerInfo && window.__arcadeTest.careerInfo().isCommission) && !!(window.__arcadeCareerTest && window.__arcadeCareerTest.commissionRun()); } catch (e) { return false; } })()",
    12000
  );
  await waitFor(ctx, "(function(){ try { return window.__arcadeTest.careerInfo().locked === true; } catch (e) { return false; } })()", 9000);
  const spied = await installObserveSpy(ctx);
  invariant(spied === true, 'observe spy 安装失败');
}

async function startPlaying(ctx) {
  const info = await careerInfo(ctx);
  if (info && info.state === 'playing') return;
  await waitFor(
    ctx,
    "!!document.querySelector('[data-overlay]') && !document.querySelector('[data-overlay]').hidden && !!document.querySelector('[data-ov-btn]')",
    12000
  );
  const clicked = await evaluate(
    ctx,
    "(function(){ var b = document.querySelector('[data-ov-btn]'); if (!b || !b.getClientRects().length) return false; b.click(); return true; })()"
  );
  invariant(clicked === true, '开始游戏按钮不可点');
  await waitFor(ctx, "(function(){ try { return window.__arcadeTest.info().state === 'playing'; } catch (e) { return false; } })()", 9000);
  const seeded = await evaluate(ctx, 'window.__arcadeTest.setSeed(' + TEST_SEED + ')');
  invariant(seeded === true, 'setSeed 失败');
}

async function autoMove(ctx) {
  return evaluate(ctx, 'window.__arcadeTest.autoMove()');
}

async function moveNow(ctx, r, c) {
  return evaluate(ctx, 'window.__arcadeTest.moveNow(' + JSON.stringify(r) + ',' + JSON.stringify(c) + ')');
}

async function undoNow(ctx) {
  return evaluate(ctx, 'window.__arcadeTest.undoNow()');
}

async function playToEnd(ctx) {
  return evaluate(ctx, 'window.__arcadeTest.playToEnd(' + TEST_SEED + ')');
}

/** 等页面里的职业结算落地（自然结束/投手后由页面自己走 bridge 收据）。 */
async function waitSettled(ctx, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    const info = await careerInfo(ctx);
    last = info;
    if (info && info.settled && info.settled.pending !== true) return info;
    await sleep(100);
  }
  throw new Error('[gomoku fixture] 等待职业结算超时：' + JSON.stringify(last && last.settled));
}

/** 通用断言：职业 run 已锁定、目标行可见、serialize() 为 null、本页无挑战入口。 */
async function assertCareerChrome(ctx, tier, kind, atLeast) {
  const info = await careerInfo(ctx);
  invariant(info && info.isCommission === true, '职业 run 未激活：' + JSON.stringify(info));
  invariant(info.locked === true, '职业 run 未锁定经典记录');
  invariant(info.serializeNull === true, '职业 run 的 serialize() 未返回 null');
  invariant(info.challengeVisible === false, '本页不应存在挑战入口');
  invariant(info.goalLineVisible === true, '职业目标行不可见');
  invariant(/^委托：/.test(String(info.goalLineText || '')), '目标行文案不是戏内目标：' + JSON.stringify(info.goalLineText));
  invariant(info.objectiveKind === kind, '目标 kind 与内容不一致：' + JSON.stringify({ page: info.objectiveKind, content: kind }));
  invariant(info.atLeast === atLeast, '目标手数与内容不一致：' + JSON.stringify({ page: info.atLeast, content: atLeast }));
  invariant(info.commissionId === commissionIdOf(ctx), '委托 id 不一致：' + JSON.stringify(info.commissionId));
  return info;
}

/**
 * 悔棋守卫：真实落子 1 手 → 真实悔棋；move.legal 条数必须不变（悔棋不得重复计功），
 * 页面回到轮到自己、moves 归零的游玩态。返回 { before, afterMove, afterUndo }。
 */
async function undoGuard(ctx) {
  const before = countKind(await commissionEvents(ctx), 'move.legal');
  const placed = await moveNow(ctx, 5, 5);
  invariant(placed === true, '真实落子被拒绝');
  const afterMove = countKind(await commissionEvents(ctx), 'move.legal');
  invariant(afterMove === before + 1, '真实落子未提交 move.legal：' + JSON.stringify({ before, afterMove }));
  const infoMove = await careerInfo(ctx);
  invariant(infoMove && infoMove.lastMove, '缺少最近一次 move.legal：' + JSON.stringify(infoMove));
  invariant(
    Number.isFinite(infoMove.lastMove.moves) && infoMove.lastMove.moves > 0 && infoMove.lastMove.col === 5 && infoMove.lastMove.row === 5,
    'move.legal payload 不是真实落点：' + JSON.stringify(infoMove.lastMove)
  );
  const undoOk = await undoNow(ctx);
  invariant(undoOk === true, '真实悔棋失败');
  const afterUndo = countKind(await commissionEvents(ctx), 'move.legal');
  invariant(afterUndo === afterMove, '悔棋让 move.legal 重复计功：' + JSON.stringify({ before, afterMove, afterUndo }));
  const infoUndo = await careerInfo(ctx);
  invariant(infoUndo && infoUndo.state === 'playing' && infoUndo.moves === 0, '悔棋后未回到本局起点：' + JSON.stringify(infoUndo));
  return { before, afterMove, afterUndo };
}

/* ------------------------------------------------------------------ *
 * 六阶 success / failure
 * ------------------------------------------------------------------ */

async function successMoveLegal(ctx, kind, target) {
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  await startPlaying(ctx);
  const info0 = await assertCareerChrome(ctx, ctx.tier, kind, target);

  /* 1) 悔棋不得重复计功（真实落子 + 真实悔棋）。 */
  const guard = await undoGuard(ctx);

  /* 2) 真实落子到目标手数：每手都走 applyPlayerMove 提交路径（AI 应手走真实 performAIMove）。 */
  let placedCount = guard.afterUndo;
  let guardLoop = 0;
  while (placedCount < target && guardLoop < 48) {
    guardLoop += 1;
    const moved = await autoMove(ctx);
    invariant(moved && Number.isFinite(moved.r) && Number.isFinite(moved.c), '真实落子被拒绝：' + JSON.stringify(moved));
    placedCount = countKind(await commissionEvents(ctx), 'move.legal');
    const stateNow = await readState(ctx);
    invariant(stateNow && stateNow.state === 'playing', '对局在达成目标前结束：' + JSON.stringify(stateNow && stateNow.state));
  }
  invariant(placedCount >= target, '真实合法落子不足目标：' + JSON.stringify({ placedCount, target }));

  const events = await commissionEvents(ctx);
  const legalEvents = events.filter((event) => event && event.kind === 'move.legal');
  legalEvents.forEach((event) => {
    const payload = event.payload || {};
    invariant(
      Number.isFinite(Number(payload.moves)) && Number.isFinite(Number(payload.col)) && Number.isFinite(Number(payload.row)),
      'move.legal payload 缺字段：' + JSON.stringify(payload)
    );
  });
  const info = await careerInfo(ctx);
  invariant(info.moveEvents === placedCount, '页面 move.legal 计数与 bridge 缓冲不一致：' + JSON.stringify({ page: info.moveEvents, bridge: placedCount }));
  invariant(info.plays === info0.plays && info.high === info0.high, '职业 run 污染了经典 progress：' + JSON.stringify(info));
  invariant((await observedEvents(ctx)).filter((event) => event.kind === 'session.finish').length === 0, '对局未结束却提交了 session.finish');

  /* 3) 由 fixture 走 runner 的标准结算入口（真实 api.finish → 职业收据），目标已达成。 */
  const settled = await ctx.helpers.settle('won', { result: 'win', moves: info.moves, score: info.score });
  invariant(settled && settled.ok === true, '职业结算未成功：' + JSON.stringify(settled));
  assertIsolation(isolationBefore, await snapshotIsolation(ctx));
  return {
    events: { 'move.legal': placedCount },
    stats: { moves: info.moves, score: info.score, undoGuard: guard },
  };
}

async function successSessionFinish(ctx, kind, target) {
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  await startPlaying(ctx);
  const info0 = await assertCareerChrome(ctx, ctx.tier, kind, target);

  /* 1) 悔棋不得重复计功（真实落子 + 真实悔棋）。 */
  const guard = await undoGuard(ctx);

  /* 2) 真实打完整局：applyPlayerMove/performAIMove/finishGame 全部真实（TEST_SEED 下黑棋五连）。 */
  const ended = await playToEnd(ctx);
  invariant(ended && ended.ok === true && ended.result === 'win', '真实对局未自然结束：' + JSON.stringify(ended));
  const info = await waitSettled(ctx);
  const result = info.lastCommissionResult || null;
  invariant(info.settled && info.settled.ok === true, '职业收据未成功：' + JSON.stringify(info.settled));
  invariant(result && result.ok === true && result.receipt, '结算结果缺收据：' + JSON.stringify(result));
  invariant(info.finishEvents === 1, 'session.finish 应恰好提交一次：' + JSON.stringify({ finishEvents: info.finishEvents }));
  invariant(info.lastFinish && info.lastFinish.result === 'win', 'session.finish payload 不是真实结局：' + JSON.stringify(info.lastFinish));
  invariant(Number.isFinite(Number(info.lastFinish.moves)) && Number(info.lastFinish.moves) > 0, 'session.finish payload 缺 moves');
  const observed = await observedEvents(ctx);
  const finishes = observedOfKind(observed, 'session.finish');
  invariant(finishes.length === 1, '页面提交 session.finish 次数不为 1：' + JSON.stringify(finishes));
  invariant(finishes[0].payload && finishes[0].payload.result === 'win' && Number.isFinite(Number(finishes[0].payload.moves)), 'session.finish payload 非 {result,moves}：' + JSON.stringify(finishes[0].payload));
  const legalObserved = observedOfKind(observed, 'move.legal').length;
  invariant(legalObserved >= 2, '自然对局的真实落子事件过少：' + JSON.stringify({ legalObserved }));
  invariant(info.plays === info0.plays && info.high === info0.high, '职业 run 污染了经典 progress：' + JSON.stringify(info));
  assertIsolation(isolationBefore, await snapshotIsolation(ctx));
  return {
    events: { 'move.legal': legalObserved, 'session.finish': 1 },
    stats: { result: info.result, moves: info.moves, score: info.score, undoGuard: guard },
  };
}

async function failureMoveLegal(ctx, kind, target) {
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  await startPlaying(ctx);
  await assertCareerChrome(ctx, ctx.tier, kind, target);

  /* 真实落子但只到目标-1 手：目标自然未达成（可归因 objective-not-met，零奖励）。 */
  let placedCount = 0;
  let guard = 0;
  while (placedCount < target - 1 && guard < 48) {
    guard += 1;
    const moved = await autoMove(ctx);
    invariant(moved && Number.isFinite(moved.r), '真实落子被拒绝：' + JSON.stringify(moved));
    placedCount = countKind(await commissionEvents(ctx), 'move.legal');
    const stateNow = await readState(ctx);
    invariant(stateNow && stateNow.state === 'playing', '失败场景对局不应结束：' + JSON.stringify(stateNow && stateNow.state));
  }
  invariant(placedCount === target - 1, '失败场景手数不符：' + JSON.stringify({ placedCount, target }));
  const settled = await ctx.helpers.settle('lost', { result: 'quit', moves: placedCount });
  invariant(settled && settled.ok === false, '失败场景不应结算成功：' + JSON.stringify(settled));
  assertIsolation(isolationBefore, await snapshotIsolation(ctx));
  return {
    events: { 'move.legal': placedCount },
    stats: { reason: settled.reason, observed: settled.observed, expectedAtLeast: target },
  };
}

async function failureSessionFinish(ctx, kind, target) {
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  await startPlaying(ctx);
  await assertCareerChrome(ctx, ctx.tier, kind, target);

  /* 「未结束对局」：真实落子 2 手但不结束对局，session.finish 保持 0 次。 */
  for (let i = 0; i < 2; i += 1) {
    const moved = await autoMove(ctx);
    invariant(moved && Number.isFinite(moved.r), '真实落子被拒绝：' + JSON.stringify(moved));
  }
  const moves = countKind(await commissionEvents(ctx), 'move.legal');
  invariant(moves === 2, '失败场景真实落子次数不符：' + JSON.stringify({ moves }));
  const observed = await observedEvents(ctx);
  invariant(observedOfKind(observed, 'session.finish').length === 0, '未结束对局不应提交 session.finish');
  const settled = await ctx.helpers.settle('lost', { result: 'quit', moves: 2 });
  invariant(settled && settled.ok === false, '失败场景不应结算成功：' + JSON.stringify(settled));
  assertIsolation(isolationBefore, await snapshotIsolation(ctx));
  return {
    events: { 'move.legal': moves },
    stats: { reason: settled.reason, observed: settled.observed, expectedAtLeast: target },
  };
}

async function success(ctx) {
  const objective = objectiveOf(ctx);
  invariant(objective && objective.kind, '无法读取 ' + ctx.tier + ' 阶目标');
  if (objective.kind === 'move.legal') return successMoveLegal(ctx, objective.kind, objective.atLeast);
  if (objective.kind === 'session.finish') return successSessionFinish(ctx, objective.kind, objective.atLeast);
  throw new Error('[gomoku fixture] 未知目标 kind：' + objective.kind);
}

async function failure(ctx) {
  const objective = objectiveOf(ctx);
  invariant(objective && objective.kind, '无法读取 ' + ctx.tier + ' 阶目标');
  if (objective.kind === 'move.legal') return failureMoveLegal(ctx, objective.kind, objective.atLeast);
  if (objective.kind === 'session.finish') return failureSessionFinish(ctx, objective.kind, objective.atLeast);
  throw new Error('[gomoku fixture] 未知目标 kind：' + objective.kind);
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
  return { ok: true };
}
