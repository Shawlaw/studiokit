#!/usr/bin/env node
/**
 * StudioKit Arcade Life 0.17 — D17-05 blackjack 六阶职业委托 fixture。
 *
 * 契约：docs/arcade-life/ADR-interfaces.md §19.2 / §19.3 / §19.4 / §19.8
 * - 目标来自 content/commissions.json：blackjack.T1..T6 = hand.settled，
 *   atLeast 依次为 6 / 4 / 6 / 6 / 6 / 6（T1、T3–T6 是「六手训练」，T2 是「四手有效决策」）；
 * - 全部用真实钩子驱动：__arcadeTest.setSeed / info / hit / stand / next 与真实 UI
 *   （[data-ov-btn] 开始、[data-pause] 暂停、[data-ov-btn2] 结束本局）驱动，
 *   事件由页面真实 finishHand() 在每手结算后提交一次 hand.settled，本 fixture 不伪造事件；
 * - success：T1/T3–T6 真实打完六手（第 6 手自然结束 → finishGame 结算）；
 *   T2 真实结算四手后走真实「结束本局」提前收手（observed=4 达到 atLeast 4）；
 * - failure：真实结算 3 手（T2 亦为 3 < 4）后走真实「结束本局」提前收手，
 *   settle 归因 objective-not-met（observed=3 < atLeast），零奖励；
 * - T4–T6 先 seedStoryFlags（C3/C4/C5）再 startCommission；不改变生产可见性；
 * - 本作无下注、无押注、无货币；fixture 不写文件、不碰仓库、不 new CDP。
 *
 * 只由 tools/career_mission_fixture_runner.mjs 装载（或仓库外等价 harness 以同一 helper 面驱动）。
 */

export const gameId = 'blackjack';

/* 内容真值兜底（runner 的 getCommission(tier) 可用时以内容为准）。 */
const TIER_HANDS = { 1: 6, 2: 4, 3: 6, 4: 6, 5: 6, 6: 6 };
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
/* 失败场景只结算少数几手（真实「未完成手数」），仍走真实提前收手出口。 */
const FAILURE_HANDS = 3;
const TICKET_KEY = 'studiokit:arcade:career:ticket.v1';

function invariant(condition, message) {
  if (!condition) throw new Error('[blackjack fixture] ' + message);
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
  throw new Error('[blackjack fixture] 等待超时：' + expression + '（最后值 ' + JSON.stringify(last) + '）');
}

/* ------------------------------------------------------------------ *
 * 只读读取
 * ------------------------------------------------------------------ */

async function careerInfo(ctx) {
  return ctx.cdp.evaluate('(function(){ try { return window.__arcadeTest && window.__arcadeTest.careerInfo ? window.__arcadeTest.careerInfo() : null; } catch (e) { return null; } })()');
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

function targetHandsOf(ctx) {
  try {
    const commission =
      ctx.helpers && typeof ctx.helpers.getCommission === 'function' ? ctx.helpers.getCommission(ctx.tier) : null;
    const objective = commission && commission.objective ? commission.objective : null;
    const raw = objective ? Number(objective.atLeast) : NaN;
    if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  } catch (err) {
    /* 回退到内容真值 */
  }
  return TIER_HANDS[ctx.tier];
}

/* ------------------------------------------------------------------ *
 * 真实驱动：开局 / 逐手结算 / 真实提前收手 / 结算等待
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
  /* 等页面桥确认职业 run，并等页面完成职业锁定（目标行/旧档断开）。 */
  await waitFor(
    ctx,
    '(function(){ try { var i = window.__arcadeTest && window.__arcadeTest.careerInfo ? window.__arcadeTest.careerInfo() : null; return !!(i && i.isCommission === true && i.locked === true) && !!(window.__arcadeCareerTest && window.__arcadeCareerTest.commissionRun()); } catch (e) { return false; } })()',
    12000
  );
  return { started, nav };
}

async function startPlaying(ctx) {
  const nowInfo = await gameInfo(ctx);
  if (nowInfo && nowInfo.state === 'playing') return nowInfo;
  await waitFor(ctx, "!!document.querySelector('[data-overlay]') && !document.querySelector('[data-overlay]').hidden", 9000);
  /* setSeed 必须在首次发牌前：同一 fixture 对局可复现，不改真实规则。 */
  await ctx.cdp.evaluate('window.__arcadeTest.setSeed(' + (20261123 + Number(ctx.tier) * 101) + ')');
  const clicked = await ctx.cdp.evaluate(
    "(function(){ var b = document.querySelector('[data-ov-btn]'); if (!b || b.hidden || !b.getClientRects().length) return false; b.click(); return true; })()"
  );
  invariant(clicked === true, '开始游戏按钮不可点');
  await waitFor(ctx, "(function(){ try { return window.__arcadeTest.info().state === 'playing'; } catch (e) { return false; } })()", 9000);
  return gameInfo(ctx);
}

function playerTotalOf(info) {
  const cards = info && Array.isArray(info.player) ? info.player : [];
  let total = 0;
  let softAces = 0;
  cards.forEach((card) => {
    const value = Number(card && card.value);
    if (!Number.isFinite(value)) return;
    total += value;
    if (value === 11) softAces += 1;
  });
  while (total > 21 && softAces > 0) {
    total -= 10;
    softAces -= 1;
  }
  return total;
}

async function handsSettled(ctx) {
  const info = await careerInfo(ctx);
  const value = info ? Number(info.handsSettled) : 0;
  return Number.isFinite(value) ? value : 0;
}

/**
 * 真实逐手结算到目标手数：玩家决策期用真实 hit/stand（<17 要牌、否则停牌），
 * 手结算后用真实 next() 进下一手；第 6 手自然结束由 finishHand → finishGame。
 * @returns {Promise<number>} 实际已结算手数
 */
async function settleHands(ctx, count) {
  let guard = 0;
  while (guard < 48) {
    guard += 1;
    const settledCount = await handsSettled(ctx);
    if (settledCount >= count) return settledCount;
    const info = await gameInfo(ctx);
    if (!info) {
      await sleep(60);
      continue;
    }
    if (info.state === 'over') return settledCount;
    if (info.phase === 'player') {
      const total = playerTotalOf(info);
      const ok = await ctx.cdp.evaluate(total < 17 ? 'window.__arcadeTest.hit()' : 'window.__arcadeTest.stand()');
      invariant(ok === true, '真实 hit/stand 被拒绝：' + JSON.stringify({ state: info.state, phase: info.phase, total }));
      continue;
    }
    if (info.phase === 'settled') {
      const advanced = await ctx.cdp.evaluate('window.__arcadeTest.next()');
      invariant(advanced === true, '真实下一手被拒绝：' + JSON.stringify(info));
      continue;
    }
    await sleep(60);
  }
  throw new Error('[blackjack fixture] 手数推进超时：目标 ' + count + ' 手');
}

/** 真实暂停 → 真实「结束本局」→ finishGame 提前收手（职业 run 内不写本机成绩）。 */
async function endEarly(ctx) {
  const info = await gameInfo(ctx);
  invariant(info && info.state === 'playing', '提前收手前必须处于游玩态：' + JSON.stringify(info));
  const clickedPause = await ctx.cdp.evaluate(
    "(function(){ var b = document.querySelector('[data-pause]'); if (!b) return false; b.click(); return true; })()"
  );
  invariant(clickedPause === true, '暂停按钮不可用');
  await waitFor(
    ctx,
    "(function(){ var ov = document.querySelector('[data-overlay]'); var b = document.querySelector('[data-ov-btn2]'); return !!ov && !ov.hidden && !!b && !b.hidden; })()",
    6000
  );
  const clicked = await ctx.cdp.evaluate(
    "(function(){ var b = document.querySelector('[data-ov-btn2]'); if (!b || b.hidden) return { ok: false }; var text = b.textContent; b.click(); return { ok: true, text: text }; })()"
  );
  invariant(clicked && clicked.ok === true, '提前收手按钮不可点：' + JSON.stringify(clicked));
  await waitFor(ctx, "(function(){ try { return window.__arcadeTest.info().state === 'over'; } catch (e) { return false; } })()", 8000);
  return clicked;
}

/** 职业结算（成功或可归因失败）后 bridge 清空 commissionRun；再取 commissionLastResult。 */
async function waitSettled(ctx) {
  await waitFor(
    ctx,
    '!!window.ArcadeCareer && typeof window.ArcadeCareer.isCommissionRun === "function" && window.ArcadeCareer.isCommissionRun() === false',
    15000
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
    receiptId: receipt && receipt.receiptId ? String(receipt.receiptId) : null,
  };
}

function baseReturn(ctx, extra) {
  return Object.assign({ gameId: gameId, tier: ctx.tier, handsTarget: targetHandsOf(ctx) }, extra || {});
}

/* ------------------------------------------------------------------ *
 * success / failure
 * ------------------------------------------------------------------ */

async function success(ctx) {
  const target = targetHandsOf(ctx);
  invariant(Number.isFinite(target) && target >= 1, '无法读取 ' + ctx.tier + ' 阶目标手数');
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  invariant(info0 && info0.isCommission === true && info0.locked === true, '职业 run 未锁定：' + JSON.stringify(info0));
  invariant(info0.goalLineVisible === true, '职业 run 缺少可见目标行：' + JSON.stringify(info0));
  invariant(info0.targetHands === target, '目标手数与内容不一致：' + JSON.stringify({ target, info: info0.targetHands }));
  invariant(info0.serializeNull === true, '职业 run serialize() 未返回 null');
  invariant(info0.challengeEntry === false, '职业 run 出现挑战入口：' + JSON.stringify(info0));
  await startPlaying(ctx);

  let early = false;
  if (target <= 4) {
    /* T2：真实结算四手后走真实「结束本局」提前收手（observed=4 达到 atLeast 4）。 */
    const hands = await settleHands(ctx, target);
    invariant(hands >= target && hands < 6, 'T2 应在至少 ' + target + ' 手、未满六手时提前收手：实际 ' + hands);
    const ended = await endEarly(ctx);
    invariant(ended.text === '结束本局', '职业 run 暂停按钮文案应为「结束本局」，实际 ' + JSON.stringify(ended.text));
    early = true;
  } else {
    /* 六手训练：真实打完六手，第 6 手 finishHand → finishGame 自然结算。 */
    const hands = await settleHands(ctx, 6);
    invariant(hands === 6, '六手训练未完成：实际 ' + hands);
    const over = await gameInfo(ctx);
    invariant(over && over.state === 'over', '六手结束应进入终局态：' + JSON.stringify(over));
  }

  const result = await waitSettled(ctx);
  invariant(result && result.ok === true, 'success 结算失败：' + JSON.stringify(result));
  invariant(result.duplicate !== true, '首次结算不应 duplicate：' + JSON.stringify(result));
  const infoAfter = await careerInfo(ctx);
  invariant(infoAfter && infoAfter.settled === true, '职业结算标记缺失：' + JSON.stringify(infoAfter));
  invariant(Number(infoAfter.handsSettled) >= target, '结算手数不足：' + JSON.stringify(infoAfter));
  invariant(
    infoAfter.plays === info0.plays && infoAfter.high === info0.high && infoAfter.scoresCount === info0.scoresCount,
    '职业 run 污染了经典 progress/scores：' + JSON.stringify({ before: info0, after: infoAfter })
  );
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);

  const settledHands = Number(infoAfter.handsSettled);
  return baseReturn(ctx, {
    events: { 'hand.settled': settledHands },
    stats: { hands: settledHands, score: Number(infoAfter.score) || 0, early: early },
    lastResult: summarizeResult(result),
    goalText: info0.goalText,
    handsSettled: settledHands,
  });
}

async function failure(ctx) {
  const target = targetHandsOf(ctx);
  const shortCount = Math.max(1, Math.min(target - 1, FAILURE_HANDS));
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  invariant(info0 && info0.isCommission === true && info0.locked === true, '职业 run 未锁定：' + JSON.stringify(info0));
  invariant(info0.goalLineVisible === true, '职业 run 缺少可见目标行');
  await startPlaying(ctx);
  const hands = await settleHands(ctx, shortCount);
  invariant(hands === shortCount, '失败场景应只结算 ' + shortCount + ' 手：实际 ' + hands);
  const ended = await endEarly(ctx);
  invariant(ended.text === '结束本局', '职业 run 暂停按钮文案应为「结束本局」，实际 ' + JSON.stringify(ended.text));
  const result = await waitSettled(ctx);
  invariant(result && result.ok === false, '失败场景不应结算成功：' + JSON.stringify(result));
  invariant(result.reason === 'objective-not-met', '失败原因应为 objective-not-met：' + JSON.stringify(result));
  const observed = Number(result.observed);
  invariant(observed === hands, '失败归因手数应等于真实结算手数：' + JSON.stringify({ observed, hands }));
  invariant(observed < target, '失败场景目标不应达成：' + JSON.stringify({ observed, target }));
  const infoAfter = await careerInfo(ctx);
  invariant(
    infoAfter.plays === info0.plays && infoAfter.high === info0.high && infoAfter.scoresCount === info0.scoresCount,
    '失败结算写入了经典 progress/scores：' + JSON.stringify({ before: info0, after: infoAfter })
  );
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  return baseReturn(ctx, {
    events: { 'hand.settled': hands },
    stats: { hands: hands, score: Number(infoAfter.score) || 0, early: true, target: target },
    lastResult: summarizeResult(result),
    goalText: info0.goalText,
    handsSettled: hands,
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
