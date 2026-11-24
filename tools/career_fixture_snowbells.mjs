/**
 * D17-08 snowbells 六阶职业委托 fixture（ADR §19.8）
 *
 * 导出契约（冻结）：
 *   export const gameId = 'snowbells';
 *   export const tiers = { 1..6: { async success(ctx), async failure(ctx) } };
 *   export async function cleanup(ctx);
 *
 * ctx（D17-02 统一 runner 提供）：{ cdp, page, port, tier, helpers }；
 * helpers 至少提供：startCommission(tier)、seedStoryFlags([...])、navigateGame()、
 * readState()、settle()、wallet()。本 fixture 对 evaluate 做了兼容
 * （ctx.cdp.evaluate / ctx.page.evaluate / helpers.evaluate / 原生 CDP Runtime.evaluate）。
 *
 * 真实玩法/事件依据（docs/arcade-life/ACTUAL-HOOKS.md §2、ADR §19.4）：
 *   - bell.unique：update() 经典铃铛真实消费分支（b.consumed=true、combo/score 提交之后）
 *     才发；每颗铃铛在 ensureBells 生成时拿到单调唯一 uid，页面侧再按 bellId 去重，
 *     同一铃复踩/重复调用不计；
 *   - height.reached：update() 里真实物理把 topY 上移、syncHud 提交分数之后才发，
 *     height = heightScore() = floor((startY-topY)/10)，与 HUD/结算「高度」同一单位
 *     （单跳最大上升 ≈159px；240/400 对应 2400/4000px 真实上攀，实测约 24/38 次踩铃）；
 *   - 驱动只用真实 #test 钩子：bellsInfo()/aimAssist（setAimAssist(true)，只做横向对准，
 *     纵向速度/碰撞/事件全部由真实物理推进）与真实 UI 按钮（[data-ov-btn] 开始、
 *     [data-pause] 暂停）；不读取 DOM 文本，不伪造事件，不直接改 topY/score。
 *
 * 目标以 apps/arcade/career/content/commissions.json 为准：
 *   T1 bell.unique≥3、T2 ≥6、T3 height.reached≥240、T4 ≥8、T5 height≥400、T6 ≥10。
 * T4–T6 的 C3/C4/C5 剧情旗标先由 helpers.seedStoryFlags 注入（不改生产可见性）。
 *
 * runner 契约注意：D17-02 runner 的 failure 证据按 settle 结果的 observed/atLeast
 * （objective-not-met）或 reached/minValue（value-not-met）归因；当前 commission-core 的
 * 失败返回不含 reached，故 height 阶 runner failure 采用「开局立即真实暂停（0 高度事件）」
 * 的 objective-not-met 路径；真实「高度不足 → value-not-met」由外部 harness 另行断言。
 */

export const gameId = 'snowbells';

const GAME = 'snowbells';
const ISO_KEYS = [
  'studiokit:arcade:progress:v1',
  'studiokit:arcade:runs:v1',
  'studiokit:arcade:scores:v1',
  'studiokit:arcade:challenge:v1',
  'studiokit:arcade:meta:v1',
];
const TIER_OBJECTIVE = {
  1: { kind: 'bell.unique', atLeast: 3 },
  2: { kind: 'bell.unique', atLeast: 6 },
  3: { kind: 'height.reached', min: 240 },
  4: { kind: 'bell.unique', atLeast: 8 },
  5: { kind: 'height.reached', min: 400 },
  6: { kind: 'bell.unique', atLeast: 10 },
};
const TIER_CHAPTER_FLAG = {
  4: 'C3.truth_found',
  5: 'C4.city_power_restored',
  6: 'C5.star_tower_resolved',
};
const READY_TIMEOUT = 12000;
const CLIMB_BELL_TIMEOUT = 60000;
const CLIMB_HEIGHT_TIMEOUT = 120000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function invariant(condition, message) {
  if (!condition) throw new Error('[snowbells fixture] ' + message);
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
      throw new Error('[snowbells fixture] evaluate 失败：' + ((detail.exception && detail.exception.description) || detail.text || 'unknown'));
    }
    return res && res.result ? res.result.value : undefined;
  }
  throw new Error('[snowbells fixture] 没有可用的 page evaluate');
}

async function waitFor(ctx, expression, timeout, label) {
  const bag = helperBag(ctx);
  if (typeof bag.waitFor === 'function') {
    try {
      return await bag.waitFor(expression, timeout || READY_TIMEOUT);
    } catch (err) {
      throw new Error('[snowbells fixture] 等待超时：' + (label || expression) + ' · ' + (err && err.message ? err.message : String(err)));
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
  throw new Error('[snowbells fixture] 等待超时：' + (label || expression) + '（最后值 ' + JSON.stringify(last) + '）');
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
        atLeast: Number.isFinite(atLeast) && atLeast > 0 ? Math.floor(atLeast) : 0,
        min: Number.isFinite(min) && min > 0 ? Math.floor(min) : 0,
      };
    }
  } catch (err) {
    /* 回退内容真值 */
  }
  return Object.assign({ atLeast: 0, min: 0 }, TIER_OBJECTIVE[ctx.tier] || {});
}

async function careerInfo(ctx) {
  return evaluate(
    ctx,
    '(function(){ try { return window.__arcadeTest && typeof window.__arcadeTest.careerInfo === "function" ? window.__arcadeTest.careerInfo() : null; } catch (e) { return null; } })()'
  );
}

async function runtimeInfo(ctx) {
  return evaluate(
    ctx,
    '(function(){ try { return window.__arcadeTest && typeof window.__arcadeTest.bellsInfo === "function" ? window.__arcadeTest.bellsInfo() : null; } catch (e) { return null; } })()'
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
    invariant(before && after && before[key] === after[key], '职业 run 写入了经典键 ' + key + '：' + JSON.stringify({ before: before && before[key], after: after && after[key] }));
  });
}

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
}

/** 真实 UI 开局；runner 的 suspension 流程可能已开局，已在游玩态则直接返回。 */
async function startPlaying(ctx) {
  const state = await evaluate(ctx, '(function(){ try { return window.__arcadeTest.bellsInfo().state; } catch (e) { return null; } })()');
  if (state === 'playing') return;
  const clicked = await evaluate(
    ctx,
    '(function(){ var b = document.querySelector("[data-ov-btn]"); if (!b || !b.getClientRects().length) return false; b.click(); return true; })()'
  );
  invariant(clicked === true, '开始游戏按钮不可点');
  await waitFor(ctx, '(function(){ try { return window.__arcadeTest.bellsInfo().state === "playing"; } catch (e) { return false; } })()', 9000, '进入游玩态');
}

/** 真实暂停（不结算）：runner failure 证据在暂停态直接调用 bridge finish。 */
async function pauseGame(ctx) {
  const clicked = await evaluate(
    ctx,
    '(function(){ var b = document.querySelector("[data-pause]"); if (!b) return false; b.click(); return true; })()'
  );
  invariant(clicked === true, '暂停按钮不可点');
  await waitFor(ctx, '(function(){ try { return window.__arcadeTest.bellsInfo().state === "paused"; } catch (e) { return false; } })()', 5000, '进入暂停态');
}

/** 开局后立刻真实暂停（同一 JS task 点开始+暂停）：不产生任何 height.reached 事件。 */
async function startAndPauseImmediately(ctx) {
  const result = await evaluate(
    ctx,
    `(function(){
      var start = document.querySelector("[data-ov-btn]");
      if (!start || !start.getClientRects().length) return { ok: false, reason: "no-start" };
      start.click();
      var pause = document.querySelector("[data-pause]");
      if (!pause) return { ok: false, reason: "no-pause" };
      pause.click();
      try {
        var info = window.__arcadeTest.bellsInfo();
        return { ok: true, state: info.state, height: info.height, unique: info.uniqueCount };
      } catch (e) { return { ok: false, reason: "probe-error" }; }
    })()`
  );
  invariant(result && result.ok === true, '开局立即暂停失败：' + JSON.stringify(result));
  await waitFor(ctx, '(function(){ try { return window.__arcadeTest.bellsInfo().state === "paused"; } catch (e) { return false; } })()', 5000, '立即暂停态');
  return result;
}

/**
 * 用真实重力/碰撞上攀：#test 专用横向对准辅助（只改 x/vx，不碰 y/vy/得分/事件），
 * 纵向推进与 bell/height 事件全部由真实 update/消费分支完成。失败/超时会抛错。
 */
async function climbUntil(ctx, goal) {
  const isHeight = goal.kind === 'height.reached';
  const deadline = Date.now() + (isHeight ? CLIMB_HEIGHT_TIMEOUT : CLIMB_BELL_TIMEOUT);
  const assist = await evaluate(ctx, 'window.__arcadeTest.setAimAssist(true)');
  invariant(assist && assist.enabled === true, 'setAimAssist(true) 失败：' + JSON.stringify(assist));
  for (;;) {
    if (Date.now() > deadline) throw new Error('[snowbells fixture] 上攀超时：' + JSON.stringify(goal));
    const info = await runtimeInfo(ctx);
    invariant(info && typeof info === 'object', 'bellsInfo 不可用');
    if (info.state === 'over') throw new Error('[snowbells fixture] 目标未达成就坠落：' + JSON.stringify({ goal, height: info.height, unique: info.uniqueCount }));
    if (info.state !== 'playing') throw new Error('[snowbells fixture] 非游玩态：' + JSON.stringify({ goal, state: info.state }));
    const career = await careerInfo(ctx);
    invariant(career && career.isCommission === true, '职业 run 丢失：' + JSON.stringify(career));
    if (isHeight ? career.height >= goal.min : career.uniqueBells >= goal.atLeast) break;
    await sleep(90);
  }
  return careerInfo(ctx);
}

function uniqueIdsOf(events) {
  return events
    .filter((event) => event && event.kind === 'bell.unique')
    .map((event) => String(event.payload && event.payload.bellId))
    .filter(Boolean);
}

function heightValuesOf(events) {
  return events
    .filter((event) => event && event.kind === 'height.reached')
    .map((event) => Number(event.payload && event.payload.height))
    .filter((value) => Number.isFinite(value));
}

async function finishSuccessScenario(ctx, goal) {
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  invariant(info0 && info0.locked === true && info0.serializeNull === true, '职业隔离未生效：' + JSON.stringify(info0));
  invariant(info0.goalLineVisible === true && info0.challengeEntryHidden === true, '目标行/挑战入口状态不符：' + JSON.stringify(info0));
  await startPlaying(ctx);
  await climbUntil(ctx, goal);
  const career = await careerInfo(ctx);
  const events = await commissionEvents(ctx);
  const uniqueIds = uniqueIdsOf(events);
  const heights = heightValuesOf(events);
  invariant(new Set(uniqueIds).size === uniqueIds.length, 'bell.unique 出现重复 bellId：' + JSON.stringify(uniqueIds));
  invariant(career.uniqueBells === (career.uniqueIds || []).length, 'unique 去重表与计数不同步：' + JSON.stringify(career));
  /* 同一铃复踩守卫：对已记录的真实 bellId 再调用一次真实守卫入口，不得加计。 */
  const knownId = (career.uniqueIds || [])[0] || uniqueIds[0];
  let replay = null;
  if (knownId) {
    replay = await evaluate(ctx, `window.__arcadeTest.replayUniqueBell(${JSON.stringify(knownId)})`);
    invariant(replay && replay.counted === false && replay.after === replay.before, '同一 bellId 复踩被重复计：' + JSON.stringify(replay));
  }
  if (goal.kind === 'bell.unique') {
    invariant(career.uniqueBells >= goal.atLeast, '不同铃数量不足：' + career.uniqueBells + ' < ' + goal.atLeast);
  } else {
    invariant(career.height >= goal.min, '高度不足：' + career.height + ' < ' + goal.min);
    invariant(heights.length > 0 && Math.max.apply(null, heights) >= goal.min, '未提交达标 height.reached：' + JSON.stringify(heights.slice(-5)));
  }
  await pauseGame(ctx);
  const paused = await careerInfo(ctx);
  invariant(paused && paused.state === 'paused' && paused.serializeNull === true, '暂停后隔离未保持：' + JSON.stringify(paused));
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  const declared = {};
  if (goal.kind === 'bell.unique') declared['bell.unique'] = goal.atLeast;
  else declared['height.reached'] = 1;
  return {
    events: declared,
    stats: {
      objectiveKind: goal.kind,
      target: goal.kind === 'bell.unique' ? goal.atLeast : goal.min,
      uniqueBells: paused.uniqueBells,
      height: paused.height,
      heightEvents: heights.length,
      heightMax: heights.length ? Math.max.apply(null, heights) : 0,
      replayGuard: replay,
      score: paused.score,
      classicKeysUnchanged: true,
    },
  };
}

async function finishFailureScenario(ctx, goal) {
  await openRun(ctx);
  const isolationBefore = await snapshotIsolation(ctx);
  const info0 = await careerInfo(ctx);
  invariant(info0 && info0.locked === true && info0.serializeNull === true, '职业隔离未生效：' + JSON.stringify(info0));
  invariant(info0.goalLineVisible === true && info0.challengeEntryHidden === true, '目标行/挑战入口状态不符：' + JSON.stringify(info0));
  let declared = {};
  let stats = { objectiveKind: goal.kind, target: goal.kind === 'bell.unique' ? goal.atLeast : goal.min };
  if (goal.kind === 'bell.unique') {
    /* 真实踩到 atLeast-2 个不同铃（留足余量）后暂停 → settle 归因 objective-not-met。 */
    const wanted = Math.max(0, goal.atLeast - 2);
    await startPlaying(ctx);
    if (wanted > 0) await climbUntil(ctx, { kind: 'bell.unique', atLeast: wanted });
    const career = await careerInfo(ctx);
    const events = await commissionEvents(ctx);
    const uniqueIds = uniqueIdsOf(events);
    invariant(new Set(uniqueIds).size === uniqueIds.length, 'bell.unique 出现重复 bellId：' + JSON.stringify(uniqueIds));
    invariant(career.uniqueBells < goal.atLeast, '失败场景不同铃数量已达标：' + career.uniqueBells);
    declared = { 'bell.unique': career.uniqueBells };
    stats.uniqueBells = career.uniqueBells;
    stats.observed = career.uniqueBells;
    stats.height = career.height;
  } else {
    /* 高度阶失败：开局立即真实暂停，本 run 不产生 height.reached（objective-not-met observed=0）；
       真实「高度不足 → value-not-met」由外部 harness 用 <阈值的真实上攀单独覆盖。 */
    const immediate = await startAndPauseImmediately(ctx);
    const career = await careerInfo(ctx);
    const events = await commissionEvents(ctx);
    invariant(heightValuesOf(events).length === 0, '失败场景不应提交 height.reached：' + JSON.stringify(heightValuesOf(events)));
    invariant(career.height === 0, '失败场景高度应为 0：' + career.height);
    stats.height = career.height;
    stats.observed = 0;
    stats.earlyQuit = true;
    stats.immediate = immediate;
  }
  await pauseGameIfNeeded(ctx);
  const paused = await careerInfo(ctx);
  invariant(paused && paused.serializeNull === true, '暂停后隔离未保持：' + JSON.stringify(paused));
  const isolationAfter = await snapshotIsolation(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  stats.classicKeysUnchanged = true;
  return { events: declared, stats };
}

async function pauseGameIfNeeded(ctx) {
  const state = await evaluate(ctx, '(function(){ try { return window.__arcadeTest.bellsInfo().state; } catch (e) { return null; } })()');
  if (state === 'paused') return;
  await pauseGame(ctx);
}

async function run(ctx, mode) {
  const goal = objectiveOf(ctx);
  if (mode === 'success') return finishSuccessScenario(ctx, goal);
  return finishFailureScenario(ctx, goal);
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
  return { ok: true };
}
