#!/usr/bin/env node
/**
 * StudioKit Arcade Life 0.17 — D17-04 merge-2048 六阶职业委托 fixture。
 *
 * 契约：docs/arcade-life/ADR-interfaces.md §19.2 / §19.3 / §19.4 / §19.8
 * - 目标来自 content/commissions.json：merge-2048.T1..T6 = tile.created + minValue{field:'value'} 32..1024；
 * - 全部用真实钩子驱动：__arcadeTest.setBoard 构造局面、__arcadeTest.moveNow 走真实 move()（含
 *   spawnTile/合并/发事件）、__arcadeTest.undoNow 走真实 undo()；不直接改 board 内存；
 * - success 额外覆盖「撤销不重复计功 / 不倒退」：先真实合并一次 → undo → 事件条数/最大值必须不变，
 *   再做目标合并；T1–T3 由 startCommission 自动 seed 线性解锁链，T4–T6 先 seedStoryFlags 再 startCommission；
 * - failure 让目标保持未达成且可归因：棋盘贴左、真实 move 无法位移（不产生新格子/合并），
 *   结算 reason 应为 objective-not-met（零奖励）；
 * - 返回的 events 只是「声明」，runner 会与 bridge 实际委托缓冲对照，不会由 fixture 伪造。
 *
 * 只由 tools/career_mission_fixture_runner.mjs 装载；不写文件、不碰仓库、不 new CDP。
 */

export const gameId = 'merge-2048';

/* 内容真值兜底（runner 的 getCommission( tier ) 可用时以内容为准）。 */
const TIER_TARGET = { 1: 32, 2: 64, 3: 128, 4: 256, 5: 512, 6: 1024 };
/* T4–T6 章节旗标（ADR §19.2：T4 C3.truth_found / T5 C4.city_power_restored / T6 C5.star_tower_resolved）。 */
const TIER_CHAPTER_FLAG = { 4: 'C3.truth_found', 5: 'C4.city_power_restored', 6: 'C5.star_tower_resolved' };

const ISO_KEYS = [
  'studiokit:arcade:runs:v1',
  'studiokit:arcade:progress:v1',
  'studiokit:arcade:scores:v1',
  'studiokit:arcade:challenge:v1',
  'studiokit:arcade:meta:v1',
];

/* 贴左且无法再左移的盘面：真实 move('left') 返回 false，不生成/不合并，用于可归因失败。 */
const PACKED_LEFT = [
  [2, 0, 0, 0],
  [4, 0, 0, 0],
  [8, 0, 0, 0],
  [16, 0, 0, 0],
];

function invariant(condition, message) {
  if (!condition) throw new Error('[merge-2048 fixture] ' + message);
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
  throw new Error('[merge-2048 fixture] 等待超时：' + expression + '（最后值 ' + JSON.stringify(last) + '）');
}

function targetOf(ctx) {
  try {
    const commission = ctx.helpers && typeof ctx.helpers.getCommission === 'function' ? ctx.helpers.getCommission(ctx.tier) : null;
    const objective = commission && commission.objective ? commission.objective : null;
    const raw = objective && objective.minValue ? Number(objective.minValue.value) : NaN;
    if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  } catch (err) {
    /* 回退到内容真值 */
  }
  return TIER_TARGET[ctx.tier];
}

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
  /* 等页面桥确认职业 run 并由 #test 暴露 careerInfo。 */
  await waitFor(
    ctx,
    "(function(){ try { return !!(window.__arcadeTest && window.__arcadeTest.careerInfo && window.__arcadeTest.careerInfo().isCommission) && !!(window.__arcadeCareerTest && window.__arcadeCareerTest.commissionRun()); } catch (e) { return false; } })()",
    12000
  );
  return nav;
}

async function startPlaying(ctx) {
  /* runner 可能已经开局（通用 suspension 流程）——已在游玩态就直接返回，不重复点击。 */
  const playingNow = await ctx.cdp.evaluate(
    "(function(){ try { return window.__arcadeTest.info().state === 'playing'; } catch (e) { return false; } })()"
  );
  if (playingNow === true) return;
  await waitFor(ctx, "!!document.querySelector('[data-overlay]') && !document.querySelector('[data-overlay]').hidden", 9000);
  await waitFor(ctx, "!!document.querySelector('[data-ov-btn]')", 9000);
  const clicked = await ctx.cdp.evaluate(
    "(function(){ var b = document.querySelector('[data-ov-btn]'); if (!b || !b.getClientRects().length) return false; b.click(); return true; })()"
  );
  invariant(clicked === true, '开始游戏按钮不可点');
  await waitFor(ctx, "(function(){ try { return window.__arcadeTest.info().state === 'playing'; } catch (e) { return false; } })()", 9000);
}

async function setBoard(ctx, values) {
  const ok = await ctx.cdp.evaluate('window.__arcadeTest.setBoard(' + JSON.stringify(values) + ')');
  invariant(ok === true, 'setBoard 被拒绝：' + JSON.stringify(values));
}

async function moveNow(ctx, dir) {
  return ctx.cdp.evaluate('window.__arcadeTest.moveNow(' + JSON.stringify(dir) + ')');
}

async function undoNow(ctx) {
  return ctx.cdp.evaluate('window.__arcadeTest.undoNow()');
}

async function careerInfo(ctx) {
  return ctx.cdp.evaluate('(function(){ try { return window.__arcadeTest.careerInfo(); } catch (e) { return null; } })()');
}

async function commissionEvents(ctx) {
  const state = await ctx.cdp.evaluate(
    '(function(){ try { return window.__arcadeCareerTest ? window.__arcadeCareerTest.commissionState() : null; } catch (e) { return null; } })()'
  );
  return state && Array.isArray(state.events) ? state.events : [];
}

function createdValues(events) {
  return events
    .filter((event) => event && event.kind === 'tile.created')
    .map((event) => Number(event.payload && event.payload.value))
    .filter((value) => Number.isFinite(value));
}

function mergedValues(events) {
  return events
    .filter((event) => event && event.kind === 'tile.merged')
    .map((event) => Number(event.payload && event.payload.value))
    .filter((value) => Number.isFinite(value));
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

async function success(ctx) {
  const target = targetOf(ctx);
  invariant(Number.isFinite(target) && target >= 2, '无法读取 ' + ctx.tier + ' 阶目标');
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  await startPlaying(ctx);

  const info0 = await careerInfo(ctx);
  invariant(info0 && info0.isCommission === true && info0.locked === true, '职业 run 未锁定：' + JSON.stringify(info0));
  invariant(info0.goalLineVisible === true && info0.targetValue === target, '目标行/目标值不一致：' + JSON.stringify(info0));
  invariant(info0.serializeNull === true && info0.challengeVisible === false, '职业隔离未生效：' + JSON.stringify(info0));

  /* 1) 一次真实合并（2+2 → 4）然后撤销：事件必须原地保留，不得新增/回退。 */
  await setBoard(ctx, [
    [2, 2, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  const firstMoved = await moveNow(ctx, 'left');
  invariant(firstMoved === true, '第一次真实合并未成功');
  const eventsAfterMove = await commissionEvents(ctx);
  const createdAfterMove = createdValues(eventsAfterMove);
  const mergedAfterMove = mergedValues(eventsAfterMove);
  invariant(createdAfterMove.indexOf(4) >= 0, '合并 4 未提交 tile.created {value:4}：' + JSON.stringify(createdAfterMove));
  invariant(mergedAfterMove.indexOf(4) >= 0, '已有 tile.merged 事件缺失：' + JSON.stringify(mergedAfterMove));
  const undoOk = await undoNow(ctx);
  invariant(undoOk === true, 'undoNow 失败');
  const eventsAfterUndo = await commissionEvents(ctx);
  const createdAfterUndo = createdValues(eventsAfterUndo);
  const mergedAfterUndo = mergedValues(eventsAfterUndo);
  invariant(
    createdAfterUndo.length === createdAfterMove.length,
    'undo 后 tile.created 数量变化（重复计功或回退）：' + JSON.stringify({ before: createdAfterMove, after: createdAfterUndo })
  );
  invariant(
    mergedAfterUndo.length === mergedAfterMove.length,
    'undo 后 tile.merged 数量变化：' + JSON.stringify({ before: mergedAfterMove, after: mergedAfterUndo })
  );
  const maxBeforeUndo = createdAfterMove.length ? Math.max.apply(null, createdAfterMove) : 0;
  const maxAfterUndo = createdAfterUndo.length ? Math.max.apply(null, createdAfterUndo) : 0;
  invariant(maxAfterUndo === maxBeforeUndo, 'undo 后 tile.created 最大值倒退：' + JSON.stringify({ before: maxBeforeUndo, after: maxAfterUndo }));
  const undoInfo = await careerInfo(ctx);
  invariant(undoInfo && undoInfo.state === 'playing', 'undo 后应回到游玩态：' + JSON.stringify(undoInfo));

  /* 2) 真实目标合并：half + half → target（例如 128 + 128 → 256），随后随机生成一个新格子。 */
  const half = target / 2;
  await setBoard(ctx, [
    [half, half, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  const secondMoved = await moveNow(ctx, 'left');
  invariant(secondMoved === true, '目标合并未成功');
  const events = await commissionEvents(ctx);
  const created = createdValues(events);
  const merged = mergedValues(events);
  invariant(created.filter((value) => value === target).length === 1, '未提交目标 ' + target + ' 的 tile.created：' + JSON.stringify(created));
  invariant(merged.filter((value) => value === target).length === 1, '未提交目标 ' + target + ' 的 tile.merged：' + JSON.stringify(merged));
  invariant(created.length === 4, 'tile.created 次数不符（2 次合并 + 2 次生成）：' + JSON.stringify(created));
  invariant(merged.length === 2, 'tile.merged 次数不符：' + JSON.stringify(merged));

  const info = await careerInfo(ctx);
  invariant(info && info.bestTile === target, '真实盘面最大值应为 ' + target + '：' + JSON.stringify(info));
  invariant(info.plays === info0.plays && info.high === info0.high && info.scoresCount === info0.scoresCount, '职业 run 污染了经典 progress/scores：' + JSON.stringify(info));
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);

  return {
    events: { 'tile.created': 4, 'tile.merged': 2 },
    stats: { score: info.score, moves: info.moves, bestTile: info.bestTile },
  };
}

async function failure(ctx) {
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  await startPlaying(ctx);
  const info0 = await careerInfo(ctx);
  invariant(info0 && info0.isCommission === true && info0.locked === true, '职业 run 未锁定：' + JSON.stringify(info0));
  invariant(info0.goalLineVisible === true, '职业 run 缺少可见目标行');
  invariant(info0.serializeNull === true && info0.challengeVisible === false, '职业隔离未生效：' + JSON.stringify(info0));

  /* 真实 move 但棋盘贴左无法位移：不产生新格子、不产生合并，目标自然未达成（可归因 objective-not-met）。 */
  await setBoard(ctx, PACKED_LEFT);
  const moved = await moveNow(ctx, 'left');
  invariant(moved === false, '失败场景不应产生有效移动：' + JSON.stringify(moved));
  const events = await commissionEvents(ctx);
  invariant(events.length === 0, '失败场景不应提交任何委托事件：' + JSON.stringify(events));
  const info = await careerInfo(ctx);
  invariant(info && info.state === 'playing', '失败场景应停留在游玩态：' + JSON.stringify(info));
  invariant(info.plays === info0.plays && info.high === info0.high && info.scoresCount === info0.scoresCount, '职业 run 污染了经典 progress/scores');
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);

  return {
    events: {},
    stats: { score: info.score, moves: info.moves, bestTile: info.bestTile },
  };
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
