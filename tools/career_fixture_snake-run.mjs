#!/usr/bin/env node
/**
 * StudioKit Arcade Life 0.17 — D17-11 snake-run 六阶职业委托 fixture。
 *
 * 契约：docs/arcade-life/ADR-interfaces.md §19.2 / §19.3 / §19.4 / §19.8
 * - 目标来自 content/commissions.json：snake-run.T1..T6 = fruit.eaten，
 *   atLeast 依次为 5 / 8 / 10 / 14 / 17 / 20（T6 正好是本作 20 果实自然终点）；
 * - 全部用真实钩子驱动：真实开始按钮 `[data-ov-btn]`、真实计时步进（update→stepSnake）、
 *   真实触屏左右转向按钮（pointerdown → handleTurnInput）、真实拾取（__arcadeTest.eatNext()
 *   走同一条 stepSnake 分支、由页面自己提交 fruit.eaten）、真实撞墙/撞障碍掉命与真实
 *   `finish()` 收局；fixture 不伪造事件，也不改分数/果实数；
 * - success：真实吃到 atLeast 个果实，再真实撞墙丢完 3 条命收局（T6 则由 20 果实自然丰收收局），
 *   settle 由 bridge/commission-core 按真实事件计数判定成功并出收据；
 * - failure：真实吃到 atLeast-3 个果实（明确“吃果不足”），再真实丢完 3 条命收局，
 *   settle 归因 objective-not-met（observed=真实果实数 < atLeast），零奖励；
 * - T4–T6 先 seedStoryFlags（C3/C4/C5）再 startCommission；不改变生产可见性；
 * - 每阶 success/failure 都对照经典 5 键（runs/progress/scores/challenge/meta）逐字节不变；
 *   fixture 不写文件、不碰仓库、不 new CDP。
 *
 * 只由 tools/career_mission_fixture_runner.mjs 装载（或仓库外等价 harness 以同一 helper 面驱动）。
 */

export const gameId = 'snake-run';

/* 内容真值兜底（runner 的 getCommission(tier) 可用时以内容为准）。 */
const TIER_TARGETS = { 1: 5, 2: 8, 3: 10, 4: 14, 5: 17, 6: 20 };
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
/* 本作经典自然终点（页面 JOY_GOAL_FOODS = 20）。 */
const NATURAL_GOAL = 20;
/* 失败场景刻意留下 3 个果实的余量：即便死亡途中偶然吃到普通/特殊果实，各 tier 仍明确不足。 */
const FAILURE_MARGIN = 3;
/* 棋盘尺寸（页面 N = 18）。 */
const BOARD_N = 18;

function invariant(condition, message) {
  if (!condition) throw new Error('[snake-run fixture] ' + message);
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
  throw new Error('[snake-run fixture] 等待超时：' + expression + '（最后值 ' + JSON.stringify(last) + '）');
}

/* ------------------------------------------------------------------ *
 * 只读读取
 * ------------------------------------------------------------------ */

async function gameInfo(ctx) {
  return ctx.cdp.evaluate('(function(){ try { return window.__arcadeTest.info(); } catch (e) { return null; } })()');
}

async function board(ctx) {
  return ctx.cdp.evaluate('(function(){ try { return window.__arcadeTest.board(); } catch (e) { return null; } })()');
}

async function careerInfo(ctx) {
  return ctx.cdp.evaluate('(function(){ try { return window.__arcadeTest && window.__arcadeTest.careerInfo ? window.__arcadeTest.careerInfo() : null; } catch (e) { return null; } })()');
}

async function commissionState(ctx) {
  return ctx.cdp.evaluate(
    '(function(){ try { return window.__arcadeCareerTest ? window.__arcadeCareerTest.commissionState() : null; } catch (e) { return null; } })()'
  );
}

async function fruitEventCount(ctx) {
  const state = await commissionState(ctx);
  const events = state && Array.isArray(state.events) ? state.events : [];
  return events.filter((event) => event && event.kind === 'fruit.eaten').length;
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
    invariant(
      before[key] === after[key],
      '职业 run 写入了经典键 ' + key + '：' + JSON.stringify({ before: before[key], after: after[key] })
    );
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
  return TIER_TARGETS[ctx.tier];
}

/* ------------------------------------------------------------------ *
 * 真实驱动
 * ------------------------------------------------------------------ */

/** 接单 → 进入委托页 → 等页面职业锁定；T4–T6 先写受控剧情旗标。 */
async function openRun(ctx) {
  const helpers = ctx.helpers;
  invariant(helpers && typeof helpers.startCommission === 'function', 'runner 未提供 startCommission');
  const flag = TIER_CHAPTER_FLAG[ctx.tier];
  if (flag) {
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
  const info = await gameInfo(ctx);
  if (info && info.state === 'playing') return info;
  await waitFor(ctx, "!!document.querySelector('[data-overlay]') && !document.querySelector('[data-overlay]').hidden", 9000);
  const clicked = await ctx.cdp.evaluate(
    "(function(){ var b = document.querySelector('[data-ov-btn]'); if (!b || b.hidden || !b.getClientRects().length) return false; b.click(); return true; })()"
  );
  invariant(clicked === true, '开始游戏按钮不可点');
  await waitFor(ctx, "(function(){ try { return window.__arcadeTest.info().state === 'playing'; } catch (e) { return false; } })()", 9000);
  return gameInfo(ctx);
}

function sameCell(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y;
}

function rotated(base, turn) {
  return turn === 'left' ? { x: base.y, y: -base.x } : { x: -base.y, y: base.x };
}

/** 轮询棋盘，直到 Node 侧谓词成立（真实计时步进有 130–200ms 间隔，必须轮询而非定长 sleep）。 */
async function waitBoard(ctx, predicate, timeout = 6000, label = 'board') {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await board(ctx);
    if (last && predicate(last)) return last;
    await sleep(30);
  }
  throw new Error('[snake-run fixture] 等待棋盘状态超时（' + label + '）：' + JSON.stringify(last));
}

/** 蛇头是否沿 dir 射线相对 base 前进了至少 minSteps 格。 */
function headAdvanced(base, head, dir, minSteps = 1) {
  if (!base || !head || !dir) return false;
  const dx = head.x - base.x;
  const dy = head.y - base.y;
  if (dir.x !== 0) {
    if (dy !== 0) return false;
    const steps = dx / dir.x;
    return Number.isInteger(steps) && steps >= minSteps && steps < BOARD_N;
  }
  if (dir.y !== 0) {
    if (dx !== 0) return false;
    const steps = dy / dir.y;
    return Number.isInteger(steps) && steps >= minSteps && steps < BOARD_N;
  }
  return false;
}

/**
 * 真实移动 + 真实转向证明：
 * 1) 不注入食物，等真实 update→stepSnake 让蛇头沿当前方向前进（真实计时步进）；
 * 2) 用真实触屏「左转」按钮 pointerdown，等真实步进后 dir 变成逆时针 90° 且蛇头沿新方向前进；
 *    再用真实「右转」按钮走一遍顺时针。
 * 期间不改变任何分数/果实数，只读校验。
 */
async function proveRealMovementAndTurning(ctx) {
  const b0 = await board(ctx);
  invariant(b0 && b0.head && b0.state === 'playing', '真实移动证明前应处于游玩态：' + JSON.stringify(b0));
  const head0 = b0.head;
  const dir0 = b0.dir;
  const moved = await waitBoard(ctx, (b) => b.head && !sameCell(b.head, head0) && b.state === 'playing', 6000, 'real-step');
  invariant(
    headAdvanced(head0, moved.head, dir0, 1),
    '真实计时步进应沿当前方向前进：' + JSON.stringify({ head0, dir0, head: moved.head })
  );
  invariant(sameCell(moved.dir, dir0), '真实计时步进不应改变方向：' + JSON.stringify({ before: dir0, after: moved.dir }));
  const moveProof = { from: head0, to: moved.head, dir: dir0 };

  const turnProofs = [];
  for (const turn of ['left', 'right']) {
    const before = await board(ctx);
    invariant(before && before.state === 'playing', '转向证明前应处于游玩态：' + JSON.stringify(before));
    const expected = rotated(before.dir, turn);
    const dispatched = await ctx.cdp.evaluate(
      "(function(){ var b = document.querySelector('[data-turn=\"" + turn + "\"]'); if (!b || b.disabled) return false; " +
        "b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 11, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true })); return true; })()"
    );
    invariant(dispatched === true, '真实触屏转向按钮不可用：' + turn);
    /* 转向输入可能正好跨过一格：待执行方向或已生效方向都算“真实转向被接受”。 */
    const queued = await waitBoard(
      ctx,
      (b) => sameCell(b.nextDir, expected) || sameCell(b.dir, expected),
      3000,
      'turn-' + turn
    );
    const turned = await waitBoard(ctx, (b) => sameCell(b.dir, expected) && b.state === 'playing', 3000, 'dir-' + turn);
    const advanced = await waitBoard(
      ctx,
      (b) => sameCell(b.dir, expected) && headAdvanced(turned.head, b.head, expected, 1),
      3000,
      'advance-' + turn
    );
    turnProofs.push({ turn, dir: expected, queuedNextDir: queued.nextDir, head: turned.head, advancedHead: advanced.head });
  }
  return { move: moveProof, turns: turnProofs };
}

/**
 * 用真实拾取钩子吃到 count 个果实：每次 __arcadeTest.eatNext() 都走同一条 stepSnake() 分支，
 * 由页面自己提交 fruit.eaten；所有相邻格被障碍堵住时用既有 clearObstacles() 解除死锁重试。
 * @returns {Promise<{foodsEaten:number, fruitEvents:number}>}
 */
async function eatFruits(ctx, count) {
  let guard = 0;
  while (guard < count * 4 + 60) {
    guard += 1;
    const info = await gameInfo(ctx);
    if (!info) {
      await sleep(60);
      continue;
    }
    if (info.state !== 'playing') break;
    if (info.foodsEaten >= count) break;
    const ate = await ctx.cdp.evaluate('window.__arcadeTest.eatNext()');
    if (ate !== true) {
      await ctx.cdp.evaluate('window.__arcadeTest.clearObstacles()');
      await sleep(60);
      continue;
    }
    await sleep(20);
  }
  const info = await gameInfo(ctx);
  invariant(info && info.foodsEaten >= count, '真实拾取果实不足：目标 ' + count + '，实际 ' + JSON.stringify(info && info.foodsEaten));
  const fruitEvents = await fruitEventCount(ctx);
  /* 第 20 颗会在同一帧触发自然收局并立刻结算（缓冲被消费），此时只校验“已结算或条数一致”。 */
  if (info.state === 'playing') {
    invariant(
      fruitEvents === info.foodsEaten,
      'fruit.eaten 条数应与真实果实数一致（每颗只一次）：' + JSON.stringify({ fruitEvents, foodsEaten: info.foodsEaten })
    );
  } else {
    invariant(
      fruitEvents === 0 || fruitEvents === info.foodsEaten,
      '收局后事件缓冲应为空或与真实果实数一致：' + JSON.stringify({ fruitEvents, foodsEaten: info.foodsEaten })
    );
  }
  return { foodsEaten: info.foodsEaten, fruitEvents };
}

/** 把食物放到蛇头当前直行射线之外：掉命阶段蛇只直行，因此不会“顺路”多吃果实。 */
async function keepFoodOffRay(ctx) {
  const b = await board(ctx);
  if (!b || !b.head) return false;
  const ray = new Set();
  for (let k = 1; k < BOARD_N; k += 1) {
    const x = b.head.x + b.dir.x * k;
    const y = b.head.y + b.dir.y * k;
    if (x < 0 || y < 0 || x >= BOARD_N || y >= BOARD_N) break;
    ray.add(x + ',' + y);
  }
  const occupied = new Set();
  (b.snake || []).forEach((cell) => occupied.add(cell.x + ',' + cell.y));
  (b.obstacles || []).forEach((cell) => occupied.add(cell.x + ',' + cell.y));
  for (let y = 0; y < BOARD_N; y += 1) {
    for (let x = 0; x < BOARD_N; x += 1) {
      const key = x + ',' + y;
      if (ray.has(key) || occupied.has(key)) continue;
      return ctx.cdp.evaluate('window.__arcadeTest.setFood(' + x + ', ' + y + ')');
    }
  }
  return false;
}

/** 真实丢光 3 条命（直行撞墙/撞障碍，fixture 不注入伤害），等页面 finish(false) 收局。 */
async function loseAllLives(ctx) {
  /* 先等场上金果实自然消失（最长 6 秒）：期间食物同样挪出直行射线，
     掉命阶段蛇只直行，额外拾取最多只可能来自特殊果实，不会影响“吃果不足”的归因。 */
  const goldenDeadline = Date.now() + 8000;
  while (Date.now() < goldenDeadline) {
    const info = await gameInfo(ctx);
    if (!info || info.golden !== true) break;
    await keepFoodOffRay(ctx);
    await sleep(120);
  }
  const deadline = Date.now() + 40000;
  let last = null;
  while (Date.now() < deadline) {
    const info = await gameInfo(ctx);
    if (!info) {
      await sleep(120);
      continue;
    }
    last = info;
    if (info.state === 'over') return info;
    await keepFoodOffRay(ctx);
    await sleep(160);
  }
  throw new Error('[snake-run fixture] 真实掉命收局超时：' + JSON.stringify(last));
}

/** 职业结算（成功或可归因失败）后 bridge 清空 commissionRun；再取 commissionLastResult。 */
async function waitSettled(ctx) {
  await waitFor(
    ctx,
    '!!window.ArcadeCareer && typeof window.ArcadeCareer.isCommissionRun === "function" && window.ArcadeCareer.isCommissionRun() === false',
    15000
  );
  /* 页面在 settle promise 落地后才把“已结算”标记写进 careerInfo：等它，避免读到 pending。 */
  try {
    await waitFor(
      ctx,
      '(function(){ try { var i = window.__arcadeTest && window.__arcadeTest.careerInfo ? window.__arcadeTest.careerInfo() : null; return !!(i && i.settled === true && i.settledPending === false); } catch (e) { return false; } })()',
      9000
    );
  } catch (err) {
    /* 无 careerInfo 的环境（非 careerTest URL）回退到只读 bridge 结果 */
  }
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
  return Object.assign({ gameId: gameId, tier: ctx.tier, fruitTarget: targetOf(ctx) }, extra || {});
}

/* ------------------------------------------------------------------ *
 * success / failure
 * ------------------------------------------------------------------ */

async function success(ctx) {
  const target = targetOf(ctx);
  invariant(Number.isFinite(target) && target >= 1, '无法读取 ' + ctx.tier + ' 阶目标果实数');
  invariant(target <= NATURAL_GOAL, '目标果实数超出本作自然终点：' + target);
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  invariant(info0 && info0.isCommission === true && info0.locked === true, '职业 run 未锁定：' + JSON.stringify(info0));
  invariant(info0.goalLineVisible === true, '职业 run 缺少可见目标行：' + JSON.stringify(info0));
  invariant(info0.targetFruits === target, '目标果实数与内容不一致：' + JSON.stringify({ target, info: info0.targetFruits }));
  invariant(info0.goalKind === 'fruit.eaten', '目标事件类型应为 fruit.eaten：' + JSON.stringify(info0.goalKind));
  invariant(info0.serializeNull === true, '职业 run serialize() 未返回 null');
  invariant(info0.challengeEntry === false, '职业 run 出现挑战入口：' + JSON.stringify(info0));

  await clickStart(ctx);
  const movement = await proveRealMovementAndTurning(ctx);
  const eaten = await eatFruits(ctx, target);

  if (target < NATURAL_GOAL) {
    /* 达到目标后用真实掉命收局（本作经典没有提前收工出口）。 */
    await loseAllLives(ctx);
  } else {
    /* T6：第 20 颗果实触发本作自然丰收收局。 */
    await waitFor(ctx, "(function(){ try { return window.__arcadeTest.info().state === 'over'; } catch (e) { return false; } })()", 9000);
  }

  const result = await waitSettled(ctx);
  invariant(result && result.ok === true, 'success 结算失败：' + JSON.stringify(result));
  invariant(result.duplicate !== true, '首次结算不应 duplicate：' + JSON.stringify(result));
  const infoAfter = await careerInfo(ctx);
  invariant(infoAfter && infoAfter.settled === true, '职业结算标记缺失：' + JSON.stringify(infoAfter));
  /* 成功结算结果不带 observed（只有失败归因才回传）；用页面真实果实数与委托事件条数交叉校验。 */
  const observed = Number(infoAfter.foodsEaten);
  invariant(Number.isFinite(observed) && observed >= target, '真实果实数不足：' + JSON.stringify({ observed, target }));
  const fruitEvents = await fruitEventCount(ctx);
  invariant(
    fruitEvents === 0 || fruitEvents === observed,
    '结算后事件缓冲应已消费（0）或与真实果实数一致：' + JSON.stringify({ fruitEvents, observed })
  );
  invariant(
    infoAfter.plays === info0.plays && infoAfter.high === info0.high && infoAfter.scoresCount === info0.scoresCount,
    '职业 run 污染了经典 progress/scores：' + JSON.stringify({ before: info0, after: infoAfter })
  );
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);

  return baseReturn(ctx, {
    events: { 'fruit.eaten': Number(infoAfter.foodsEaten) },
    stats: { foodsEaten: Number(infoAfter.foodsEaten), score: Number(infoAfter.score) || 0, lives: Number(infoAfter.lives) || 0 },
    lastResult: summarizeResult(result),
    goalText: info0.goalText,
    observed: observed,
    movement: movement,
  });
}

async function failure(ctx) {
  const target = targetOf(ctx);
  const shortCount = Math.max(1, target - FAILURE_MARGIN);
  invariant(shortCount < target, '失败场景必须明确少于目标：' + JSON.stringify({ shortCount, target }));
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  invariant(info0 && info0.isCommission === true && info0.locked === true, '职业 run 未锁定：' + JSON.stringify(info0));
  invariant(info0.goalLineVisible === true, '职业 run 缺少可见目标行');
  invariant(info0.targetFruits === target, '目标果实数与内容不一致：' + JSON.stringify({ target, info: info0.targetFruits }));

  await clickStart(ctx);
  const eaten = await eatFruits(ctx, shortCount);
  invariant(eaten.foodsEaten < target, '失败场景吃到的果实必须少于目标：' + JSON.stringify({ eaten: eaten.foodsEaten, target }));
  const over = await loseAllLives(ctx);
  invariant(over && over.state === 'over', '真实掉命后应进入终局态：' + JSON.stringify(over));

  const result = await waitSettled(ctx);
  invariant(result && result.ok === false, '失败场景不应结算成功：' + JSON.stringify(result));
  invariant(result.reason === 'objective-not-met', '失败原因应为 objective-not-met：' + JSON.stringify(result));
  const observed = Number(result.observed);
  invariant(Number.isFinite(observed), '失败结算缺少 observed：' + JSON.stringify(result));
  invariant(observed === Number(over.foodsEaten), '失败归因果实数应等于真实吃到的果实数：' + JSON.stringify({ observed, foodsEaten: over.foodsEaten }));
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
    events: { 'fruit.eaten': observed },
    stats: { foodsEaten: observed, score: Number(infoAfter.score) || 0, target: target },
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
  return { ok: true, ticketKey: TICKET_KEY, isolatedKeys: ISO_KEYS.slice() };
}
