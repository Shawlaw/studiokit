/**
 * D17-13 block-drop 六阶职业委托 fixture（ADR §19.2 / §19.3 / §19.4 / §19.8）
 *
 * 导出契约（冻结）：
 *   export const gameId = 'block-drop';
 *   export const tiers = { 1..6: { async success(ctx), async failure(ctx) } };
 *   export async function cleanup(ctx);
 *
 * ctx（D17-02 统一 runner 提供）：{ cdp, page, port, tier, helpers }；
 * helpers 至少提供：startCommission(tier)、seedStoryFlags([...])、navigateGame()、
 * readState()、settle()、wallet()。本 fixture 对 evaluate 做了兼容
 * （ctx.helpers.evaluate / ctx.cdp.evaluate / ctx.page.evaluate）。
 *
 * 真实玩法/事件依据（docs/arcade-life/ACTUAL-HOOKS.md §2、ADR §19.4）：
 *   - lines.cleared：`applyClear()` 在真实增行（lines += n）与 levelUp()/syncHud() 之后提交；
 *     职业 run 内按本次真实消去行数逐行各发一条 {rows:1, lines, level}，
 *     所以一次四消（Tetris）恰为 4 条事件，目标 atLeast 的计数单位就是“真实消行数”，
 *     不由 score / 最高分 / DOM 文本反推；
 *   - 驱动只用真实 #test 钩子：`careerClearScenario(kind)` 只布置盘面与当前块
 *     （等价 merge-2048 fixture 的 setBoard），落块硬降走真实 hardDrop()→lockPiece()，
 *     消行走真实 applyClear()；fixture 不调用 observe、不改 lines/score、不伪造事件。
 *
 * 目标以 apps/arcade/career/content/commissions.json 为准：
 *   block-drop.T1..T6 = lines.cleared atLeast 2 / 4 / 6 / 8 / 12 / 16（T1–T3 可见，T4–T6
 *   需要 C3/C4/C5 剧情旗标，由 helpers.seedStoryFlags 先注入受控旗标，不改生产可见性）。
 *
 * success：真实消行到 ≥ atLeast（含至少一次四消的阶）→ 真实暂停 → 交 runner 结算；
 * failure：真实消到 max(1, atLeast-2) 行（严格不足）→ 真实暂停 → 结算归因 objective-not-met。
 *
 * 只由 tools/career_mission_fixture_runner.mjs 装载；不写文件、不碰仓库、不 new CDP。
 */

export const gameId = 'block-drop';

/* 内容真值兜底（runner 的 getCommission(tier) 可用时以内容为准）。 */
const TIER_TARGET = { 1: 2, 2: 4, 3: 6, 4: 8, 5: 12, 6: 16 };
/* T4–T6 章节旗标（ADR §19.2）。 */
const TIER_CHAPTER_FLAG = { 4: 'C3.truth_found', 5: 'C4.city_power_restored', 6: 'C5.star_tower_resolved' };
const ISO_KEYS = [
  'studiokit:arcade:progress:v1',
  'studiokit:arcade:runs:v1',
  'studiokit:arcade:scores:v1',
  'studiokit:arcade:challenge:v1',
  'studiokit:arcade:meta:v1',
];
const READY_TIMEOUT = 12000;
const CLEAR_TIMEOUT = 9000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function invariant(condition, message) {
  if (!condition) throw new Error('[block-drop fixture] ' + message);
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
      throw new Error('[block-drop fixture] evaluate 失败：' + ((detail.exception && detail.exception.description) || detail.text || 'unknown'));
    }
    return res && res.result ? res.result.value : undefined;
  }
  throw new Error('[block-drop fixture] 没有可用的 page evaluate');
}

async function waitFor(ctx, expression, timeout, label) {
  const bag = helperBag(ctx);
  if (typeof bag.waitFor === 'function') {
    try {
      return await bag.waitFor(expression, timeout || READY_TIMEOUT);
    } catch (err) {
      throw new Error('[block-drop fixture] 等待超时：' + (label || expression) + ' · ' + (err && err.message ? err.message : String(err)));
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
  throw new Error('[block-drop fixture] 等待超时：' + (label || expression) + '（最后值 ' + JSON.stringify(last) + '）');
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

async function careerInfo(ctx) {
  return evaluate(
    ctx,
    '(function(){ try { return window.__arcadeTest && typeof window.__arcadeTest.careerInfo === "function" ? window.__arcadeTest.careerInfo() : null; } catch (e) { return null; } })()'
  );
}

async function commissionEvents(ctx) {
  return evaluate(
    ctx,
    '(function(){ try { if (window.__arcadeCareerTest && typeof window.__arcadeCareerTest.commissionState === "function") { var s = window.__arcadeCareerTest.commissionState(); return s && Array.isArray(s.events) ? s.events : []; } if (window.ArcadeCareerCommission && typeof window.ArcadeCareerCommission.getState === "function") { var t = window.ArcadeCareerCommission.getState(); return t && Array.isArray(t.events) ? t.events : []; } return []; } catch (e) { return []; } })()'
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

function lineEventsOf(events) {
  return events.filter((event) => event && event.kind === 'lines.cleared');
}

function rowsOf(events) {
  return lineEventsOf(events)
    .map((event) => Number(event.payload && event.payload.rows))
    .filter((value) => Number.isFinite(value));
}

/**
 * 真实接单：T4–T6 先 seed 受控剧情旗标；runner 负责线性解锁链与 ticket 导航。
 * 返回时委托 run 已在真实页面激活（overlay + 目标行可见）。
 */
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
    READY_TIMEOUT,
    '职业开局弹层/目标行'
  );
}

/** 真实 UI 开局；runner 的 suspension 流程可能已开局，已在游玩态则直接返回。 */
async function startPlaying(ctx) {
  const state = await evaluate(ctx, '(function(){ try { return window.__arcadeTest.careerInfo().state; } catch (e) { return null; } })()');
  if (state === 'playing') return;
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
}

/** 真实点击暂停（不结算）：runner 的 success/failure 证据都在暂停态交给 bridge 结算。 */
async function pauseGame(ctx) {
  const state = await evaluate(ctx, '(function(){ try { return window.__arcadeTest.careerInfo().state; } catch (e) { return null; } })()');
  if (state === 'paused') return;
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

/** 用最少次数凑够 total 行：优先四消，余数用单消（都走真实 hardDrop/applyClear）。 */
function clearPlan(total) {
  const plan = [];
  let remaining = Math.max(0, Math.floor(Number(total) || 0));
  while (remaining >= 4) {
    plan.push(4);
    remaining -= 4;
  }
  while (remaining > 0) {
    plan.push(1);
    remaining -= 1;
  }
  return plan;
}

/**
 * 驱动一次真实消行，并核对「本次提交的事件条数 == 真实消去行数」：
 * 钩子只布置盘面/当前块，落块与消行来自真实 hardDrop()/lockPiece()/applyClear()。
 */
async function dropClear(ctx, kind) {
  const before = await careerInfo(ctx);
  invariant(before && before.active === true, '消行前职业 run 不可用：' + JSON.stringify(before));
  const eventsBefore = lineEventsOf(await commissionEvents(ctx)).length;
  const scenario = await evaluate(ctx, 'window.__arcadeTest.careerClearScenario(' + JSON.stringify(kind) + ')');
  invariant(scenario && scenario.ok === true, 'careerClearScenario(' + kind + ') 失败：' + JSON.stringify(scenario));
  invariant(scenario.linesBefore === before.lines, '场景起始行数与真实状态不一致：' + JSON.stringify({ scenario, before: before.lines }));
  const expectedLines = scenario.linesBefore + kind;
  await waitFor(
    ctx,
    '(function(){ try { return window.__arcadeTest.careerInfo().lines >= ' + expectedLines + '; } catch (e) { return false; } })()',
    CLEAR_TIMEOUT,
    '真实消行 ' + kind + ' 行'
  );
  await waitFor(
    ctx,
    '(function(){ try { var c = window.__arcadeCareerTest.commissionState(); return !!c && Array.isArray(c.events) && c.events.filter(function (e) { return e && e.kind === "lines.cleared"; }).length >= ' + (eventsBefore + kind) + '; } catch (e) { return false; } })()',
    CLEAR_TIMEOUT,
    '委托事件 ' + kind + ' 条'
  );
  const after = await careerInfo(ctx);
  const events = await commissionEvents(ctx);
  const lineEvents = lineEventsOf(events);
  invariant(after.lines === expectedLines, '消行后真实行数=' + after.lines + ' 期望=' + expectedLines);
  invariant(lineEvents.length === eventsBefore + kind, '本次事件条数=' + (lineEvents.length - eventsBefore) + ' 期望=' + kind + '（一次四消必须计 4）');
  invariant(rowsOf(events).every((value) => value === 1), 'lines.cleared 载荷必须逐行 rows=1：' + JSON.stringify(rowsOf(events)));
  return { kind, lines: after.lines, events: lineEvents.length, score: after.score, level: after.level };
}

async function runClears(ctx, total) {
  const plan = clearPlan(total);
  const steps = [];
  for (const kind of plan) {
    steps.push(await dropClear(ctx, kind));
  }
  const info = await careerInfo(ctx);
  const events = await commissionEvents(ctx);
  const lineEvents = lineEventsOf(events);
  return { plan, steps, info, events, lineEvents };
}

async function selfCheck(ctx) {
  const result = await evaluate(ctx, 'window.__arcadeTest.careerSelfCheck()');
  invariant(result && result.fail === 0, 'careerSelfCheck fail=' + (result ? result.fail : 'null') + ' ' + JSON.stringify(result && result.details));
  return result;
}

async function success(ctx) {
  const target = targetOf(ctx);
  invariant(Number.isFinite(target) && target >= 2, '无法读取 ' + ctx.tier + ' 阶目标');
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  invariant(info0 && info0.isCommission === true && info0.locked === true, '职业 run 未锁定：' + JSON.stringify(info0));
  invariant(info0.goalLineVisible === true && info0.atLeast === target, '目标行/目标值不一致：' + JSON.stringify(info0));
  invariant(info0.objectiveKind === 'lines.cleared', '目标 kind 不是 lines.cleared：' + JSON.stringify(info0));
  invariant(info0.serializeNull === true && info0.challengeEntryHidden === true && info0.zenEntryHidden === true, '职业隔离未生效：' + JSON.stringify(info0));
  await startPlaying(ctx);

  const run = await runClears(ctx, target);
  invariant(run.info.lines >= target, '真实消行不足：' + run.info.lines + ' < ' + target);
  invariant(run.lineEvents.length === run.info.lines, '事件条数 ' + run.lineEvents.length + ' != 真实行数 ' + run.info.lines);
  invariant(run.lineEvents.every((event, index) => Number(event.payload && event.payload.lines) === index + 1), 'lines 载荷未随真实消行递增');
  const tetris = run.steps.filter((step) => step.kind === 4);
  invariant(tetris.length > 0 || target < 4, '目标 ≥4 行时必须至少有一次四消证据：' + JSON.stringify(run.plan));
  const check = await selfCheck(ctx);
  const info = await careerInfo(ctx);
  invariant(info.progress && info0.progress && info.progress.plays === info0.progress.plays, '职业 run 改变了经典 plays');
  invariant(info.progress.high === info0.progress.high && info.scoresCount === info0.scoresCount, '职业 run 改变了经典最高分/积分记录');
  invariant(info.runSavePresent === info0.runSavePresent && info.runSaveScore === info0.runSaveScore, '职业 run 写入了 runs:v1 局内档');
  await pauseGame(ctx);
  const paused = await careerInfo(ctx);
  invariant(paused && paused.state === 'paused' && paused.serializeNull === true, '暂停后隔离未保持：' + JSON.stringify(paused));
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);

  return {
    events: { 'lines.cleared': run.info.lines },
    stats: {
      score: paused.score,
      lines: paused.lines,
      level: paused.level,
      target,
      plan: run.plan,
      tetrises: tetris.length,
      lineEvents: run.lineEvents.length,
      eventRows: rowsOf(run.events).slice(0, 8),
      selfCheck: { pass: check.pass, fail: check.fail },
      classicKeysUnchanged: true,
    },
  };
}

async function failure(ctx) {
  const target = targetOf(ctx);
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  invariant(info0 && info0.isCommission === true && info0.locked === true, '职业 run 未锁定：' + JSON.stringify(info0));
  invariant(info0.goalLineVisible === true && info0.atLeast === target, '目标行/目标值不一致：' + JSON.stringify(info0));
  invariant(info0.serializeNull === true && info0.challengeEntryHidden === true && info0.zenEntryHidden === true, '职业隔离未生效：' + JSON.stringify(info0));
  await startPlaying(ctx);

  /* 真实消行但严格不足：留 2 行余量（T1 至少 1 行），结算归因 objective-not-met。 */
  const wanted = Math.max(1, target - 2);
  invariant(wanted < target, '失败场景计划行数不合法：' + wanted + '/' + target);
  const run = await runClears(ctx, wanted);
  invariant(run.info.lines === wanted && run.info.lines < target, '失败场景行数异常：' + JSON.stringify({ lines: run.info.lines, wanted, target }));
  invariant(run.lineEvents.length === wanted, '失败场景事件条数=' + run.lineEvents.length + ' 期望=' + wanted);
  await pauseGame(ctx);
  const paused = await careerInfo(ctx);
  invariant(paused && paused.state === 'paused' && paused.serializeNull === true, '暂停后隔离未保持：' + JSON.stringify(paused));
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  return {
    events: { 'lines.cleared': paused.lines },
    stats: {
      score: paused.score,
      lines: paused.lines,
      level: paused.level,
      target,
      observed: paused.lines,
      plan: run.plan,
      classicKeysUnchanged: true,
    },
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
  /* 结算/放弃由 runner 负责；这里只做只读收尾，不写仓库、不清 ticket。 */
  return { ok: true };
}
