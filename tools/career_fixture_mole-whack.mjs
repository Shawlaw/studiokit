#!/usr/bin/env node
/**
 * StudioKit Arcade Life 0.17 — D17-12 mole-whack 六阶职业委托 fixture。
 *
 * 契约：docs/arcade-life/ADR-interfaces.md §19.2 / §19.3 / §19.4 / §19.8
 * - 目标来自 content/commissions.json：mole-whack.T1..T6 =
 *   T1/T2/T4/T6 `mole.hit`（atLeast 8 / 12 / 18 / 22）、
 *   T3/T5 `combo.reached`（atLeast 1，minValue.combo 5 / 8）；
 * - 全部用真实钩子驱动：__arcadeTest.careerInfo / setSlot / hitSlotNow 与真实 UI
 *   （[data-ov-btn] 开始、[data-pause] 暂停、[data-ov-btn2]「结束本局」）驱动；
 *   事件由页面真实 hitSlot() 在每次真实正确击中后提交（mole.hit + combo.reached），
 *   fixture 只读取 bridge 委托缓冲与页面计数器，不伪造事件、不改真实规则；
 * - success：真实击中目标值（T1 8 / T2 12 / T4 18 / T6 22 次；T3 连击 5 / T5 连击 8）后
 *   走真实「暂停 → 结束本局」提前收工，由页面 finish() → career.finish 结算；
 * - failure：真实正确击中 3 次后提前收工，mole.hit 阶归因 objective-not-met（observed 3 < atLeast），
 *   combo.reached 阶归因 value-not-met（事件条数已过、真实最高连击 3 < 5 / 8），零奖励；
 * - T4–T6 先 seedStoryFlags（C3/C4/C5）再 startCommission；不改变生产可见性；
 * - 隔离：5 个经典 localStorage 键逐字节对照；serialize() null、挑战入口隐藏、结算一次；
 * - 本作 45 秒经典局与道具/炸弹/金鼠规则零改动；fixture 不写文件、不碰仓库、不 new CDP。
 *
 * 只由 tools/career_mission_fixture_runner.mjs 装载（或仓库外等价 harness 以同一 helper 面驱动）。
 */

export const gameId = 'mole-whack';

/* 内容真值兜底（runner 的 getCommission(tier) 可用时以内容为准）。 */
const TIER_TARGET = {
  1: { kind: 'mole.hit', atLeast: 8 },
  2: { kind: 'mole.hit', atLeast: 12 },
  3: { kind: 'combo.reached', atLeast: 1, minValue: { field: 'combo', value: 5 } },
  4: { kind: 'mole.hit', atLeast: 18 },
  5: { kind: 'combo.reached', atLeast: 1, minValue: { field: 'combo', value: 8 } },
  6: { kind: 'mole.hit', atLeast: 22 },
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
const TICKET_KEY = 'studiokit:arcade:career:ticket.v1';
/* 固定洞口：真实 setSlot 放一只正常地鼠，再用真实 hitSlot 走完整判定/计分/事件提交。 */
const HIT_SLOT = 8;
/* 让真实 loop 推进一帧（hitSlot 要求 mole.age >= 0.1），并让连击计时保持真实。 */
const HIT_WAIT_MS = 110;
/* 失败场景的真实正确击中次数（低于所有阶门槛，combo 阶取真实连击不足归因）。 */
const FAILURE_HITS = 3;

function invariant(condition, message) {
  if (!condition) throw new Error('[mole-whack fixture] ' + message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(ctx, expression, timeout = 9000, interval = 70) {
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
  throw new Error('[mole-whack fixture] 等待超时：' + expression + '（最后值 ' + JSON.stringify(last) + '）');
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

function countByKind(events) {
  const counts = {};
  (Array.isArray(events) ? events : []).forEach((event) => {
    if (!event || typeof event.kind !== 'string') return;
    counts[event.kind] = (counts[event.kind] || 0) + 1;
  });
  return counts;
}

/* ------------------------------------------------------------------ *
 * 目标真值（内容优先）
 * ------------------------------------------------------------------ */

function tierTargetOf(ctx) {
  try {
    const commission =
      ctx.helpers && typeof ctx.helpers.getCommission === 'function' ? ctx.helpers.getCommission(ctx.tier) : null;
    const objective = commission && commission.objective ? commission.objective : null;
    if (objective && typeof objective.kind === 'string' && objective.kind) {
      const atLeast = Math.max(1, Math.floor(Number(objective.atLeast) || 0));
      const rawMin = objective.minValue && typeof objective.minValue === 'object' ? Number(objective.minValue.value) : NaN;
      const minValue = Number.isFinite(rawMin) && rawMin > 0 ? Math.floor(rawMin) : 0;
      return { kind: objective.kind, atLeast, minValue: minValue ? { field: String(objective.minValue.field || ''), value: minValue } : null };
    }
  } catch (err) {
    /* 回退到内容真值 */
  }
  return TIER_TARGET[ctx.tier];
}

function targetValueOf(target) {
  if (target.kind === 'combo.reached') return Math.max(1, Number(target.minValue && target.minValue.value) || 1);
  return Math.max(1, Number(target.atLeast) || 1);
}

/* ------------------------------------------------------------------ *
 * 真实驱动：开局 / 真实击中 / 真实提前收工 / 结算等待
 * ------------------------------------------------------------------ */

async function openRun(ctx) {
  const helpers = ctx.helpers;
  invariant(helpers && typeof helpers.startCommission === 'function', 'runner 未提供 startCommission');
  invariant(typeof helpers.navigateGame === 'function', 'runner 未提供 navigateGame');
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
  /* 等页面桥确认职业 run，并等页面完成职业锁定（目标行/旧档断开/挑战入口隐藏）。 */
  await waitFor(
    ctx,
    '(function(){ try { var i = window.__arcadeTest && window.__arcadeTest.careerInfo ? window.__arcadeTest.careerInfo() : null; return !!(i && i.isCommission === true && i.locked === true && i.hintIsCareerGoal === true) && !!(window.__arcadeCareerTest && window.__arcadeCareerTest.commissionRun()); } catch (e) { return false; } })()',
    12000
  );
  return { started, nav };
}

async function startPlaying(ctx) {
  const nowInfo = await gameInfo(ctx);
  if (nowInfo && nowInfo.state === 'playing') return nowInfo;
  await waitFor(ctx, "!!document.querySelector('[data-overlay]') && !document.querySelector('[data-overlay]').hidden", 9000);
  const clicked = await ctx.cdp.evaluate(
    "(function(){ var b = document.querySelector('[data-ov-btn]'); if (!b || b.hidden || !b.getClientRects().length) return false; b.click(); return true; })()"
  );
  invariant(clicked === true, '开始游戏按钮不可点');
  await waitFor(ctx, "(function(){ try { return window.__arcadeTest.info().state === 'playing'; } catch (e) { return false; } })()", 9000);
  return gameInfo(ctx);
}

/**
 * 真实击中推进：每一下都用 __arcadeTest.setSlot 放一只正常地鼠（随机刷新仍在跑），
 * 让真实 loop 推进一帧后用真实 hitSlotNow → 页面 hitSlot() 提交计分/连击/事件。
 * @returns {Promise<object>} 推进后的 careerInfo
 */
async function driveHits(ctx, count) {
  let guard = 0;
  const maxSteps = Math.max(24, Math.floor(count) * 6 + 24);
  while (guard < maxSteps) {
    guard += 1;
    const info = await careerInfo(ctx);
    invariant(info, 'careerInfo 不可读');
    if (info.state === 'over') break;
    if (info.state !== 'playing') {
      await sleep(60);
      continue;
    }
    if (info.hits >= count) break;
    const placed = await ctx.cdp.evaluate('(function(){ return window.__arcadeTest.setSlot(' + HIT_SLOT + ", 'mole'); })()");
    invariant(placed === true, 'setSlot 放置真实地鼠失败');
    await sleep(HIT_WAIT_MS);
    const before = await careerInfo(ctx);
    invariant(before && before.state === 'playing', '击中前页面应仍在游玩态：' + JSON.stringify(before));
    const hit = await ctx.cdp.evaluate('window.__arcadeTest.hitSlotNow(' + HIT_SLOT + ')');
    invariant(hit === true, 'hitSlotNow 被拒绝');
    const after = await careerInfo(ctx);
    invariant(after && after.hits === before.hits + 1, '真实击中未使 hits +1：' + JSON.stringify({ before: before && before.hits, after: after && after.hits }));
    /* 连击阶：每次真实正确击中都必须让真实 combo 递增（不伪造跳变）。 */
    if (before.hits > 0) {
      invariant(after.combo >= before.combo + 1, '真实连击未随正确击中递增：' + JSON.stringify({ before: before.combo, after: after.combo }));
    }
  }
  const final = await careerInfo(ctx);
  invariant(final && final.hits >= count, '真实击中推进不足：目标 ' + count + '，实际 ' + (final && final.hits));
  invariant(final.maxCombo >= final.combo, '最高连击统计异常：' + JSON.stringify(final));
  return final;
}

/** 真实暂停 → 真实「结束本局」→ finish() 提前收工（职业 run 内不写经典成绩）。 */
async function endEarly(ctx) {
  const info = await gameInfo(ctx);
  invariant(info && info.state === 'playing', '提前收工前必须处于游玩态：' + JSON.stringify(info));
  const clickedPause = await ctx.cdp.evaluate(
    "(function(){ var b = document.querySelector('[data-pause]'); if (!b) return false; b.click(); return true; })()"
  );
  invariant(clickedPause === true, '暂停按钮不可用');
  await waitFor(
    ctx,
    "(function(){ var ov = document.querySelector('[data-overlay]'); var b = document.querySelector('[data-ov-btn2]'); return !!ov && !ov.hidden && !!b && !b.hidden; })()",
    8000
  );
  const pause = await ctx.cdp.evaluate(
    "(function(){ var t = document.querySelector('[data-ov-text]'); var b = document.querySelector('[data-ov-btn2]'); return { ok: !!(b && !b.hidden), text: t ? t.textContent.replace(/\\s+/g, ' ').trim() : null, btn2: b ? b.textContent : null, goalCount: document.querySelectorAll('[data-ov-text] [data-career-goal]').length }; })()"
  );
  invariant(pause && pause.ok === true, '结束本局按钮不可点：' + JSON.stringify(pause));
  invariant(pause.btn2 === '结束本局', '职业 run 暂停第二按钮应為「结束本局」，实际 ' + JSON.stringify(pause.btn2));
  invariant(/这一趟不写入本机进度/.test(String(pause.text)), '职业 run 暂停文案不应谎称已保存：' + JSON.stringify(pause.text));
  invariant(/委托：/.test(String(pause.text)), '职业 run 暂停弹层缺少戏内目标行：' + JSON.stringify(pause.text));
  const clicked = await ctx.cdp.evaluate(
    "(function(){ var b = document.querySelector('[data-ov-btn2]'); if (!b || b.hidden) return false; b.click(); return true; })()"
  );
  invariant(clicked === true, '结束本局按钮点击失败');
  await waitFor(ctx, "(function(){ try { return window.__arcadeTest.info().state === 'over'; } catch (e) { return false; } })()", 9000);
  return pause;
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
    reached: Number.isFinite(Number(result.reached)) ? Number(result.reached) : null,
    credits: receipt ? Number(receipt.credits) || 0 : Number(result.credits) || 0,
    items: receipt && receipt.items && typeof receipt.items === 'object' ? receipt.items : {},
    evidence: receipt && Array.isArray(receipt.evidence) ? receipt.evidence.slice() : [],
    receiptId: receipt && receipt.receiptId ? String(receipt.receiptId) : null,
    commissionId: receipt && receipt.commissionId ? String(receipt.commissionId) : null,
  };
}

/** 职业 run 内挑战入口必须不可进：真实 startChallenge 被拒、挑战层保持隐藏。 */
async function assertChallengeBlocked(ctx) {
  const result = await ctx.cdp.evaluate(
    '(function(){ try { var t = window.__arcadeTest; var stages = t.challengeStages ? t.challengeStages() : []; var ref = stages && stages.length ? stages[stages.length - 1].id : "C01"; var started = t.startChallenge(ref); var layer = document.querySelector("[data-ch-layer]"); var info = t.challengeInfo ? t.challengeInfo() : null; return { ok: true, started: started, layerHidden: !layer || layer.hidden === true, mode: info ? info.mode : null }; } catch (e) { return { ok: false, reason: String(e && e.message ? e.message : e) }; } })()'
  );
  invariant(result && result.ok === true, 'challenge probe 失败：' + JSON.stringify(result));
  invariant(result.started === false, '职业 run 内 startChallenge 未被拒绝：' + JSON.stringify(result));
  invariant(result.layerHidden === true, '职业 run 内挑战层被打开：' + JSON.stringify(result));
  invariant(result.mode === 'classic', '职业 run 内挑战入口改变了模式：' + JSON.stringify(result));
  return result;
}

function baseReturn(ctx, target, extra) {
  return Object.assign({ gameId: gameId, tier: ctx.tier, kind: target.kind, targetValue: targetValueOf(target) }, extra || {});
}

/* ------------------------------------------------------------------ *
 * success / failure
 * ------------------------------------------------------------------ */

async function success(ctx) {
  const target = tierTargetOf(ctx);
  const targetValue = targetValueOf(target);
  invariant(Number.isFinite(targetValue) && targetValue >= 1, '无法读取 ' + ctx.tier + ' 阶目标');
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  invariant(info0 && info0.isCommission === true && info0.locked === true, '职业 run 未锁定：' + JSON.stringify(info0));
  invariant(info0.goalLineVisible === true, '职业 run 缺少可见目标行：' + JSON.stringify(info0));
  invariant(/^委托：/.test(String(info0.goalText || '')), '目标行文案不是戏内委托：' + JSON.stringify(info0.goalText));
  invariant(info0.targetKind === target.kind, '目标事件与内容不一致：' + JSON.stringify({ expected: target.kind, got: info0.targetKind }));
  invariant(info0.targetValue === targetValue, '目标值不一致：' + JSON.stringify({ expected: targetValue, got: info0.targetValue }));
  invariant(info0.hintIsCareerGoal === true, '底部说明行未换成目标行');
  invariant(info0.serializeNull === true, '职业 run serialize() 未返回 null');
  invariant(info0.challengeEntry === false, '职业 run 出现挑战入口：' + JSON.stringify(info0));
  invariant(info0.challengeLayerHidden === true, '职业 run 挑战层未隐藏');
  await assertChallengeBlocked(ctx);
  await startPlaying(ctx);
  invariant((await careerInfo(ctx)).serializeNull === true, '游玩中的职业 run serialize() 未返回 null');
  const mid = await driveHits(ctx, targetValue);
  invariant(mid.state === 'playing', '击中推进后应仍在游玩态：' + JSON.stringify(mid));
  invariant(mid.hits === targetValue, '真实正确击中次数应等于目标值：' + JSON.stringify({ hits: mid.hits, targetValue }));
  invariant(mid.maxCombo >= (target.kind === 'combo.reached' ? targetValue : 1), '真实连击未达到目标：' + JSON.stringify(mid));
  /* 事件只来自真实击中：从 bridge 委托缓冲回读，不采信 fixture 声明。 */
  const eventsMid = await commissionEvents(ctx);
  const counts = countByKind(eventsMid);
  invariant((counts['mole.hit'] || 0) === mid.hits, 'mole.hit 事件条数应等于真实正确击中：' + JSON.stringify({ counts, hits: mid.hits }));
  invariant((counts['combo.reached'] || 0) === mid.hits, 'combo.reached 应在每次真实连击变化后恰好一条：' + JSON.stringify({ counts, hits: mid.hits }));
  const combos = eventsMid.filter((event) => event && event.kind === 'combo.reached').map((event) => Number(event.payload && event.payload.combo));
  const combosAscending = combos.every((value, index) => index === 0 || value > combos[index - 1]);
  invariant(combosAscending, 'combo.reached 的 combo 应随真实连击严格递增：' + JSON.stringify(combos));
  invariant(Math.max.apply(null, combos) === mid.maxCombo, 'combo.reached 最高值应等于真实最高连击：' + JSON.stringify({ combos, maxCombo: mid.maxCombo }));
  const pause = await endEarly(ctx);
  const result = await waitSettled(ctx);
  invariant(result && result.ok === true, 'success 结算失败：' + JSON.stringify(result));
  invariant(result.duplicate !== true, '首次结算不应 duplicate：' + JSON.stringify(result));
  invariant(result.receipt && result.receipt.commissionId === gameId + '.T' + ctx.tier, '收据 commissionId 异常：' + JSON.stringify(result.receipt && result.receipt.commissionId));
  const infoAfter = await careerInfo(ctx);
  invariant(infoAfter && infoAfter.settled === true, '页面职业结算标记缺失：' + JSON.stringify(infoAfter));
  invariant(infoAfter.isCommission === false, '结算后 commissionRun 应为 null：' + JSON.stringify(infoAfter));
  invariant(infoAfter.locked === true, '结算后职业锁定应保持：' + JSON.stringify(infoAfter));
  invariant(
    infoAfter.plays === info0.plays && infoAfter.high === info0.high && infoAfter.scoresCount === info0.scoresCount,
    '职业 run 污染了经典 progress/scores：' + JSON.stringify({ before: info0, after: infoAfter })
  );
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  return baseReturn(ctx, target, {
    events: { 'mole.hit': mid.hits, 'combo.reached': mid.hits },
    stats: { hits: mid.hits, maxCombo: mid.maxCombo, score: mid.score, early: true },
    lastResult: summarizeResult(result),
    goalText: info0.goalText,
    hits: mid.hits,
    maxCombo: mid.maxCombo,
    pauseText: pause.text,
  });
}

async function failure(ctx) {
  const target = tierTargetOf(ctx);
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  invariant(info0 && info0.isCommission === true && info0.locked === true, '职业 run 未锁定：' + JSON.stringify(info0));
  invariant(info0.goalLineVisible === true, '职业 run 缺少可见目标行');
  await startPlaying(ctx);
  const mid = await driveHits(ctx, FAILURE_HITS);
  invariant(mid.hits === FAILURE_HITS, '失败场景应只真实击中 ' + FAILURE_HITS + ' 次：' + JSON.stringify(mid.hits));
  const eventsMid = await commissionEvents(ctx);
  const counts = countByKind(eventsMid);
  invariant((counts['mole.hit'] || 0) === FAILURE_HITS, '失败场景 mole.hit 条数应等于真实击中：' + JSON.stringify({ counts, hits: FAILURE_HITS }));
  invariant((counts['combo.reached'] || 0) === FAILURE_HITS, '失败场景 combo.reached 条数应等于真实击中：' + JSON.stringify({ counts, hits: FAILURE_HITS }));
  const pause = await endEarly(ctx);
  const result = await waitSettled(ctx);
  invariant(result && result.ok === false, '失败场景不应结算成功：' + JSON.stringify(result));
  const expectedReason = target.kind === 'combo.reached' ? 'value-not-met' : 'objective-not-met';
  invariant(result.reason === expectedReason, '失败归因应为 ' + expectedReason + '：' + JSON.stringify(result));
  if (expectedReason === 'objective-not-met') {
    invariant(Number(result.observed) === FAILURE_HITS, '失败归因击中数应等于真实击中：' + JSON.stringify({ observed: result.observed, hits: FAILURE_HITS }));
    invariant(FAILURE_HITS < Number(target.atLeast), '失败场景不应达成 atLeast：' + JSON.stringify({ hits: FAILURE_HITS, atLeast: target.atLeast }));
  } else {
    invariant(Number(result.observed) >= Number(target.atLeast), '连击不足场景事件条数应达到 atLeast：' + JSON.stringify(result));
    invariant(Number(result.reached) === FAILURE_HITS, '连击不足场景真实最高连击应等于 ' + FAILURE_HITS + '：' + JSON.stringify(result));
    invariant(Number(result.reached) < Number(target.minValue.value), '失败场景不应达成 minValue：' + JSON.stringify({ reached: result.reached, minValue: target.minValue }));
  }
  invariant(!result.receipt, '失败不应返回收据：' + JSON.stringify(result.receipt));
  const infoAfter = await careerInfo(ctx);
  invariant(infoAfter && infoAfter.settled === true, '失败结算后页面职业标记缺失：' + JSON.stringify(infoAfter));
  invariant(
    infoAfter.plays === info0.plays && infoAfter.high === info0.high && infoAfter.scoresCount === info0.scoresCount,
    '失败结算写入了经典 progress/scores：' + JSON.stringify({ before: info0, after: infoAfter })
  );
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  return baseReturn(ctx, target, {
    events: { 'mole.hit': FAILURE_HITS, 'combo.reached': FAILURE_HITS },
    stats: { hits: FAILURE_HITS, maxCombo: mid.maxCombo, score: mid.score, early: true, target: targetValueOf(target) },
    lastResult: summarizeResult(result),
    goalText: info0.goalText,
    hits: FAILURE_HITS,
    maxCombo: mid.maxCombo,
    pauseText: pause.text,
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
  return { ok: true, ticketKey: TICKET_KEY, isolatedKeys: ISO_KEYS.slice(), hitSlot: HIT_SLOT };
}
