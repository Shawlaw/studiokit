#!/usr/bin/env node
/**
 * StudioKit Arcade Life 0.17 — D17-15 star-raid 六阶职业委托 fixture。
 *
 * 契约：docs/arcade-life/ADR-interfaces.md §19.2 / §19.3 / §19.4 / §19.8
 * - 目标以 apps/arcade/career/content/commissions.json 为准：
 *   T1 boss.defeated（context.level=1）、T2 wave.completed≥2、T3 boss.defeated（context.theme=storm）、
 *   T4 wave.completed≥4、T5 boss.defeated（context.theme=nebula）、T6 boss.defeated（context.theme=mothership）；
 * - 起始关/主题来自内容 startParams：startLevel === tier，theme 依次
 *   patrol/asteroid/storm/blockade/nebula/mothership；页面 reset() 从 startLevel 起关；
 * - success 全部用真实页面钩子驱动：真实「开始游戏」按钮 → 真实 spawnBossNow/damageBoss
 *   （页面内部走 killEnemy → careerObserve('boss.defeated') 与 stageClear →
 *   careerObserve('wave.completed')）→ 真实「下一关」按钮 → 真实「圆满收局」按钮触发
 *   gameOver → career.finish → bridge/commission-core 独立收据；本 fixture 不伪造事件；
 * - failure：真实击破不足目标（T2/T4 少清 1 波、T1/T3/T5/T6 只召出 Boss 不击破），
 *   再由 runner helpers.settle('lost') 走同一 bridge 结算入口 → objective-not-met，零奖励；
 * - T4–T6 先 seedStoryFlags（C3/C4/C5）再 startCommission；不改变生产可见性；
 * - 职业隔离：serialize() 必须为 null；5 个经典键（runs/progress/scores/challenge/meta）
 *   在每趟 run 前后逐字节比对；fixture 不写文件、不碰仓库、不 new CDP。
 *
 * 只由 tools/career_mission_fixture_runner.mjs 装载（或仓库外等价 harness 以同一 helper 面驱动）。
 */

export const gameId = 'star-raid';

/* 内容真值兜底（runner 的 helpers.getCommission(tier) 可用时以内容为准）。 */
const TIER_THEME = {
  1: 'patrol',
  2: 'asteroid',
  3: 'storm',
  4: 'blockade',
  5: 'nebula',
  6: 'mothership',
};
const TIER_KIND = { 1: 'boss.defeated', 2: 'wave.completed', 3: 'boss.defeated', 4: 'wave.completed', 5: 'boss.defeated', 6: 'boss.defeated' };
const TIER_AT_LEAST = { 1: 1, 2: 2, 3: 1, 4: 4, 5: 1, 6: 1 };
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

function invariant(condition, message) {
  if (!condition) throw new Error('[star-raid fixture] ' + message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(err) {
  return err && err.message ? err.message : String(err);
}

async function evaluate(ctx, expression) {
  return ctx.cdp.evaluate(expression);
}

async function waitFor(ctx, expression, timeout = 10000, interval = 80) {
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
  throw new Error('[star-raid fixture] 等待超时：' + expression + '（最后值 ' + JSON.stringify(last) + '）');
}

/* ------------------------------------------------------------------ *
 * 只读读取
 * ------------------------------------------------------------------ */

async function careerInfo(ctx) {
  return evaluate(
    ctx,
    '(function(){ try { return window.__arcadeTest && window.__arcadeTest.careerInfo ? window.__arcadeTest.careerInfo() : null; } catch (e) { return null; } })()'
  );
}

async function gameInfo(ctx) {
  return evaluate(ctx, '(function(){ try { return window.__arcadeTest.info(); } catch (e) { return null; } })()');
}

async function commissionState(ctx) {
  return evaluate(
    ctx,
    '(function(){ try { return window.__arcadeCareerTest ? window.__arcadeCareerTest.commissionState() : null; } catch (e) { return null; } })()'
  );
}

async function lastFinish(ctx) {
  return evaluate(
    ctx,
    '(function(){ try { return window.__arcadeCareerTest ? window.__arcadeCareerTest.lastFinish() : null; } catch (e) { return null; } })()'
  );
}

async function isolationSnapshot(ctx) {
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

function objectiveOf(ctx) {
  try {
    const commission =
      ctx.helpers && typeof ctx.helpers.getCommission === 'function' ? ctx.helpers.getCommission(ctx.tier) : null;
    if (commission && commission.objective && typeof commission.objective === 'object') {
      return {
        commission: commission,
        kind: String(commission.objective.kind || ''),
        atLeast: Math.max(1, Math.floor(Number(commission.objective.atLeast) || 1)),
        context: commission.objective.context && typeof commission.objective.context === 'object' ? commission.objective.context : {},
        startParams: commission.startParams && typeof commission.startParams === 'object' ? commission.startParams : {},
      };
    }
  } catch (err) {
    /* 回退到内容真值 */
  }
  return {
    commission: null,
    kind: TIER_KIND[ctx.tier],
    atLeast: TIER_AT_LEAST[ctx.tier],
    context: {},
    startParams: { startLevel: ctx.tier, themeId: TIER_THEME[ctx.tier] },
  };
}

/* ------------------------------------------------------------------ *
 * 真实驱动：接单 / 开局 / Boss 与波次 / 真实收局
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
  /* 等页面桥确认职业 run + 页面把旧档锁掉、显示职业开局弹层（目标行可见、不自动开局）。 */
  await waitFor(
    ctx,
    '(function(){ try { var i = window.__arcadeTest && window.__arcadeTest.careerInfo ? window.__arcadeTest.careerInfo() : null; return !!(i && i.isCommission === true) && i.serializeNull === true && !!document.querySelector("[data-career-goal]") && !!document.querySelector("[data-overlay]") && !document.querySelector("[data-overlay]").hidden; } catch (e) { return false; } })()',
    12000
  );
  const info = await careerInfo(ctx);
  invariant(info && info.isCommission === true, '职业 run 未锁定：' + JSON.stringify(info));
  invariant(info.goalLineVisible === true, '职业 run 缺少可见目标行：' + JSON.stringify(info));
  invariant(info.serializeNull === true, '职业 run serialize() 未返回 null');
  invariant(info.challengeEntryVisible === false, '职业 run 出现挑战入口：' + JSON.stringify(info));
  invariant(info.mowEntryVisible === false, '职业 run 出现割草入口：' + JSON.stringify(info));
  invariant(info.hangarEntryVisible === false, '职业 run 出现旧机库入口：' + JSON.stringify(info));
  return { started, nav, info };
}

async function startPlaying(ctx) {
  const now = await gameInfo(ctx);
  if (now && now.state === 'playing') return now;
  await waitFor(ctx, "!!document.querySelector('[data-overlay]') && !document.querySelector('[data-overlay]').hidden", 9000);
  const clicked = await evaluate(
    ctx,
    "(function(){ var b = document.querySelector('[data-ov-btn]'); if (!b || b.hidden || !b.getClientRects().length) return false; b.click(); return true; })()"
  );
  invariant(clicked === true, '开始游戏按钮不可点');
  await waitFor(ctx, "(function(){ try { return window.__arcadeTest.info().state === 'playing'; } catch (e) { return false; } })()", 9000);
  return gameInfo(ctx);
}

/** 真实 Boss 钩子：spawnBossNow 生成当前关真实 Boss → damageBoss 击破 → 页面 killEnemy/stageClear。 */
async function defeatBoss(ctx) {
  const spawned = await evaluate(
    ctx,
    '(function(){ var t = window.__arcadeTest; var s = t.spawnBossNow(); return { bossActive: s.bossActive, bossHp: s.bossHp, stage: s.stage, theme: s.theme, state: s.state }; })()'
  );
  invariant(spawned && spawned.bossActive === true, '真实 Boss 未生成：' + JSON.stringify(spawned));
  const killed = await evaluate(
    ctx,
    '(function(){ var t = window.__arcadeTest; var r = t.damageBoss(999999); return { state: r.state, stage: r.stage, bossKills: (t.careerInfo ? t.careerInfo().bossKills : null) }; })()'
  );
  invariant(killed && killed.state === 'clear', '真实 Boss 击破后应进入 CLEAR：' + JSON.stringify(killed));
  return { spawned, killed };
}

/** 真实「下一关」按钮：CLEAR 弹层的 [data-ov-btn] → resumeClear()。 */
async function resumeNextLevel(ctx) {
  const clicked = await evaluate(
    ctx,
    "(function(){ var b = document.querySelector('[data-ov-btn]'); if (!b || b.hidden || !b.getClientRects().length) return false; b.click(); return true; })()"
  );
  invariant(clicked === true, '下一关按钮不可点');
  await waitFor(ctx, "(function(){ try { return window.__arcadeTest.info().state === 'playing'; } catch (e) { return false; } })()", 9000);
  return gameInfo(ctx);
}

/** 真实「圆满收局」按钮：CLEAR 弹层的 [data-ov-btn2] → gameOver(true) → career.finish。 */
async function settleByUi(ctx) {
  const clicked = await evaluate(
    ctx,
    "(function(){ var b = document.querySelector('[data-ov-btn2]'); if (!b || b.hidden || !b.getClientRects().length) return false; b.click(); return true; })()"
  );
  invariant(clicked === true, '圆满收局按钮不可点');
  await waitFor(
    ctx,
    "(function(){ try { var i = window.__arcadeTest.careerInfo(); return i.settled === true && i.settledResult !== null; } catch (e) { return false; } })()",
    12000
  );
  await waitFor(
    ctx,
    '!!window.ArcadeCareer && typeof window.ArcadeCareer.isCommissionRun === "function" && window.ArcadeCareer.isCommissionRun() === false',
    12000
  );
  return careerInfo(ctx);
}

/** 失败场景：不击破 Boss / 不达波次，直接走 runner helpers.settle('lost')（同一 bridge 结算入口）。 */
async function settleLost(ctx) {
  const settle = ctx.helpers && typeof ctx.helpers.settle === 'function' ? ctx.helpers.settle : null;
  invariant(typeof settle === 'function', 'runner 未提供 helpers.settle');
  const before = await careerInfo(ctx);
  const result = await settle('lost', {
    level: before ? before.level : null,
    theme: before ? before.theme : null,
    bosses: before ? before.bossKills : 0,
    waveCompletions: before ? before.waveCompletions : 0,
  });
  await waitFor(
    ctx,
    '!!window.ArcadeCareer && typeof window.ArcadeCareer.isCommissionRun === "function" && window.ArcadeCareer.isCommissionRun() === false',
    12000
  );
  return result;
}

/* ------------------------------------------------------------------ *
 * 目标驱动
 * ------------------------------------------------------------------ */

function expectedTheme(ctx) {
  return TIER_THEME[ctx.tier];
}

function expectedBossPayload(ctx, objective) {
  const payload = { level: objective.startParams.startLevel || ctx.tier };
  if (objective.context && typeof objective.context.theme === 'string') payload.theme = objective.context.theme;
  else payload.theme = expectedTheme(ctx);
  return payload;
}

/** success：真实达成 objective 次数的 Boss/波次，再真实收局。 */
async function success(ctx) {
  const objective = objectiveOf(ctx);
  await openRun(ctx);
  const isolationBefore = await isolationSnapshot(ctx);
  const info0 = await careerInfo(ctx);
  const startLevel = objective.startParams.startLevel || ctx.tier;
  invariant(info0.startLevel === startLevel, '起始关与内容不一致：' + JSON.stringify({ startLevel, info: info0.startLevel }));
  invariant(info0.themeId === (objective.startParams.themeId || expectedTheme(ctx)), '起始主题与内容不一致：' + JSON.stringify({ info: info0.themeId }));
  const playing0 = await startPlaying(ctx);
  invariant(playing0.stage === startLevel, '真实开局关号：' + JSON.stringify({ stage: playing0.stage, startLevel }));
  invariant(playing0.theme === expectedTheme(ctx), '真实开局主题：' + JSON.stringify({ theme: playing0.theme, expected: expectedTheme(ctx) }));

  const bossEvents = [];
  const waveEvents = [];
  let levelsCleared = 0;
  let lastInfo = playing0;
  if (objective.kind === 'boss.defeated') {
    const before = await careerInfo(ctx);
    const result = await defeatBoss(ctx);
    levelsCleared = 1;
    lastInfo = await gameInfo(ctx);
    invariant(lastInfo.state === 'clear', 'Boss 击破后应停在 CLEAR：' + JSON.stringify(lastInfo));
    invariant(Number(result.killed.bossKills) === Number(before.bossKills) + 1, 'bossKills 未 +1：' + JSON.stringify({ before: before.bossKills, after: result.killed.bossKills }));
  } else {
    /* wave.completed：真实清空 atLeast 个关卡（每关都是真实 Boss 击破 → stageClear）。 */
    for (let index = 0; index < objective.atLeast; index += 1) {
      const before = await careerInfo(ctx);
      const currentStage = before.level;
      const currentTheme = before.theme;
      const result = await defeatBoss(ctx);
      levelsCleared += 1;
      bossEvents.push({ level: currentStage, theme: currentTheme });
      waveEvents.push({ level: currentStage, theme: currentTheme });
      lastInfo = await gameInfo(ctx);
      if (index < objective.atLeast - 1) {
        const resumed = await resumeNextLevel(ctx);
        invariant(resumed.stage === currentStage + 1, '下一关关号不连续：' + JSON.stringify({ expected: currentStage + 1, stage: resumed.stage }));
        invariant(resumed.state === 'playing', '下一关未回到游玩态：' + JSON.stringify(resumed));
      } else {
        invariant(lastInfo.state === 'clear', '最后一波清空后应停在 CLEAR：' + JSON.stringify(lastInfo));
      }
      invariant(Number(result.killed.bossKills) === Number(before.bossKills) + 1, 'bossKills 未 +1：' + JSON.stringify({ before: before.bossKills, after: result.killed.bossKills }));
    }
  }

  /* 真实事件缓冲核对（在真实收局前读取；收局后 bridge 会清空 run） */
  const state = await commissionState(ctx);
  const events = state && Array.isArray(state.events) ? state.events : [];
  const observedBoss = events.filter((event) => event && event.kind === 'boss.defeated');
  const observedWave = events.filter((event) => event && event.kind === 'wave.completed');
  invariant(observedBoss.length === levelsCleared, 'boss.defeated 次数应为 ' + levelsCleared + '，实际 ' + observedBoss.length + '：' + JSON.stringify(events.slice(0, 6)));
  invariant(observedWave.length === levelsCleared, 'wave.completed 次数应为 ' + levelsCleared + '，实际 ' + observedWave.length + '：' + JSON.stringify(events.slice(0, 6)));
  const expectedBoss = expectedBossPayload(ctx, objective);
  invariant(observedBoss[0].payload && observedBoss[0].payload.level === expectedBoss.level, 'boss.defeated.level 不足：' + JSON.stringify(observedBoss[0].payload));
  if (objective.context && typeof objective.context.theme === 'string') {
    invariant(observedBoss[0].payload.theme === objective.context.theme, 'boss.defeated.theme 不足：' + JSON.stringify(observedBoss[0].payload));
  }
  /* wave.completed 必须带真实 level/theme，并且按真实关卡递增。 */
  observedWave.forEach((event, index) => {
    const payload = event.payload || {};
    invariant(typeof payload.level === 'number' && Number.isFinite(payload.level), 'wave.completed.level 缺失：' + JSON.stringify(event));
    invariant(typeof payload.theme === 'string' && payload.theme, 'wave.completed.theme 缺失：' + JSON.stringify(event));
    if (index > 0) invariant(payload.level === Number(observedWave[index - 1].payload.level) + 1, 'wave.completed 关卡不连续：' + JSON.stringify(observedWave.map((ev) => ev.payload)));
  });

  const settledInfo = await settleByUi(ctx);
  invariant(settledInfo && settledInfo.settledResult && settledInfo.settledResult.ok === true, '真实收局结算失败：' + JSON.stringify(settledInfo && settledInfo.settledResult));
  const finish = await lastFinish(ctx);
  const isolationAfter = await isolationSnapshot(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  const infoAfter = await careerInfo(ctx);
  invariant(infoAfter.serializeNull === true, '结算后 serialize() 仍应为 null');
  invariant(infoAfter.hangarCredits === 0, '职业 run 读了旧机库：' + JSON.stringify(infoAfter.hangarCredits));

  return {
    events: { 'boss.defeated': levelsCleared, 'wave.completed': levelsCleared },
    stats: {
      objectiveKind: objective.kind,
      targetAtLeast: objective.atLeast,
      startLevel: info0.startLevel,
      themeId: info0.themeId,
      levelsCleared,
      bossPayloads: observedBoss.map((event) => event.payload),
      wavePayloads: observedWave.map((event) => event.payload),
      receipt: settledInfo.settledResult,
      lastFinishReason: finish && finish.reason ? String(finish.reason) : null,
      shipName: info0.shipName,
      statsSource: info0.statsSource,
      stats: info0.stats,
    },
  };
}

/** failure：真实留下未击败的 Boss / 未清的波次，走真实结算入口得到可归因失败。 */
async function failure(ctx) {
  const objective = objectiveOf(ctx);
  await openRun(ctx);
  const isolationBefore = await isolationSnapshot(ctx);
  await startPlaying(ctx);
  let declared = {};
  if (objective.kind === 'boss.defeated') {
    /* 真实召出 Boss，但本趟不击破（boss.defeated 0 次）。 */
    const spawned = await evaluate(
      ctx,
      '(function(){ var t = window.__arcadeTest; var s = t.spawnBossNow(); return { bossActive: s.bossActive, bossHp: s.bossHp, stage: s.stage, theme: s.theme }; })()'
    );
    invariant(spawned && spawned.bossActive === true, '失败场景 Boss 未真实生成：' + JSON.stringify(spawned));
    declared = { 'boss.defeated': 0 };
  } else {
    /* wave.completed：真实清空 atLeast-1 个关卡后收手（远低于目标）。 */
    const partial = Math.max(0, objective.atLeast - 1);
    for (let index = 0; index < partial; index += 1) {
      await defeatBoss(ctx);
      if (index < partial - 1) await resumeNextLevel(ctx);
    }
    declared = { 'wave.completed': partial };
  }
  const state = await commissionState(ctx);
  const events = state && Array.isArray(state.events) ? state.events : [];
  const observedBoss = events.filter((event) => event && event.kind === 'boss.defeated').length;
  const observedWave = events.filter((event) => event && event.kind === 'wave.completed').length;
  if (objective.kind === 'boss.defeated') {
    invariant(observedBoss === 0, '失败场景不应有 boss.defeated：' + observedBoss);
  } else {
    invariant(observedWave === Math.max(0, objective.atLeast - 1), '失败场景波次数应为 ' + Math.max(0, objective.atLeast - 1) + '，实际 ' + observedWave);
  }
  const result = await settleLost(ctx);
  invariant(result && result.ok === false, '失败场景不应结算成功：' + JSON.stringify(result));
  invariant(result.reason === 'objective-not-met', '失败原因应为 objective-not-met：' + JSON.stringify(result));
  invariant(Number(result.observed) < objective.atLeast, '失败 observed 不应达标：' + JSON.stringify({ observed: result.observed, atLeast: objective.atLeast }));
  const isolationAfter = await isolationSnapshot(ctx);
  assertIsolation(isolationBefore, isolationAfter);
  const infoAfter = await careerInfo(ctx);
  invariant(infoAfter.serializeNull === true, '失败 run serialize() 应为 null');
  return {
    events: declared,
    stats: {
      objectiveKind: objective.kind,
      targetAtLeast: objective.atLeast,
      observed: result.observed,
      reason: result.reason,
      observedBoss,
      observedWave,
      lastFinishReason: result.reason || null,
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
  /* ticket 由 runner 结算/清理；这里只做只读收尾，不写仓库。 */
  return { ok: true, gameId, isolatedKeys: ISO_KEYS.slice() };
}
