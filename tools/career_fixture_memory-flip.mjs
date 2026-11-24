/**
 * D17-03 memory-flip 六阶职业委托 fixture（ADR §19.8）
 *
 * 导出契约（冻结）：
 *   export const gameId = 'memory-flip';
 *   export const tiers = { 1..6: { async success(ctx), async failure(ctx) } };
 *   export async function cleanup(ctx);
 *
 * ctx（由 D17-02 统一 runner 提供）：{ cdp, page, port, tier, helpers }；
 * helpers 至少提供：startCommission(tier)、seedStoryFlags([...])、readState()、
 * reload()、settle()、wallet()。本 fixture 对 evaluate 做了多层兼容
 * （helpers.evaluate / page.evaluate / cdp.evaluate / 原生 CDP Runtime.evaluate），
 * 以免和 runner 的具体 CDP 封装形状耦合。
 *
 * 真实玩法/事件依据（docs/arcade-life/ACTUAL-HOOKS.md §2、ADR §19.4）：
 *   - pair.match：reveal() 配对分支（两张牌 matched + score 提交之后）才发；
 *   - session.finish：finish()（通关/失败/主动结束）才发一次，{level, matches, outcome}；
 *   - 驱动只用页面真实测试钩子（revealById / skipPreviewNow / setLevel / info / joyInfo）
 *     与真实 UI 按钮（[data-ov-btn] 开始、[data-pause] 暂停、[data-ov-btn2] 结束本局）；
 *   - 不读取任何 DOM 文本，不伪造 observe（只读 spy 记录真实调用，用于证据）。
 *
 * 目标以 apps/arcade/career/content/commissions.json 为准：
 *   T1 pair.match ≥3、T2 pair.match ≥5、T3 session.finish ≥1、
 *   T4 pair.match ≥7、T5 session.finish ≥1、T6 pair.match ≥9。
 * T4–T6 的 C3/C4/C5 剧情旗标由 runner 先 seed；fixture 在 helpers.seedStoryFlags
 * 存在时再做一次幂等 seed（不改变生产可见性）。
 */

export const gameId = 'memory-flip';

const READY_TIMEOUT = 9000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ *
 * ctx / helpers 适配
 * ------------------------------------------------------------------ */

function helperBag(ctx) {
  return ctx && ctx.helpers && typeof ctx.helpers === 'object' ? ctx.helpers : {};
}

function requireHelper(ctx, name) {
  const fn = helperBag(ctx)[name];
  if (typeof fn !== 'function') {
    throw new Error('memory-flip fixture: ctx.helpers.' + name + ' is required by ADR §19.8 but is missing');
  }
  return fn.bind(helperBag(ctx));
}

function optionalHelper(ctx, name) {
  const fn = helperBag(ctx)[name];
  return typeof fn === 'function' ? fn.bind(helperBag(ctx)) : null;
}

async function evaluate(ctx, expression) {
  const bag = helperBag(ctx);
  const candidates = [
    bag.evaluate,
    bag.evaluateInPage,
    bag.pageEval,
    bag.eval,
    ctx && ctx.page && typeof ctx.page.evaluate === 'function' ? ctx.page.evaluate.bind(ctx.page) : null,
    ctx && ctx.page && typeof ctx.page.eval === 'function' ? ctx.page.eval.bind(ctx.page) : null,
    ctx && ctx.cdp && typeof ctx.cdp.evaluate === 'function' ? ctx.cdp.evaluate.bind(ctx.cdp) : null,
  ].filter((fn) => typeof fn === 'function');
  if (candidates.length) {
    return await candidates[0](expression);
  }
  const cdp = ctx && ctx.cdp;
  if (cdp && typeof cdp.send === 'function') {
    const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (res && res.exceptionDetails) {
      const detail = res.exceptionDetails;
      throw new Error('memory-flip fixture evaluate failed: ' + ((detail.exception && detail.exception.description) || detail.text || 'unknown'));
    }
    return res && res.result ? res.result.value : undefined;
  }
  throw new Error('memory-flip fixture: no page evaluate available (want ctx.helpers.evaluate / ctx.page.evaluate / ctx.cdp.evaluate)');
}

async function waitFor(ctx, expression, timeout, label) {
  const bag = helperBag(ctx);
  if (typeof bag.waitFor === 'function') {
    try {
      return await bag.waitFor(expression, timeout || READY_TIMEOUT);
    } catch (err) {
      throw new Error('memory-flip fixture timeout: ' + (label || expression) + ' · ' + (err && err.message ? err.message : String(err)));
    }
  }
  const end = Date.now() + (timeout || READY_TIMEOUT);
  let lastError = null;
  while (Date.now() < end) {
    try {
      const value = await evaluate(ctx, expression);
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await sleep(60);
  }
  throw new Error('memory-flip fixture timeout: ' + (label || expression) + (lastError ? ' · ' + lastError.message : ''));
}

/* 只读 spy：记录页面真实调用 ArcadeCareer.observe 的事件（不改变行为，不伪造事件）。 */
async function installObserveSpy(ctx) {
  return evaluate(
    ctx,
    `(() => {
      const api = window.ArcadeCareer;
      if (!api || typeof api.observe !== 'function' || typeof api.isCommissionRun !== 'function') return false;
      if (api.__d1703Spy) return true;
      const original = api.observe;
      window.__d1703Observed = [];
      api.__d1703OriginalObserve = original;
      api.observe = function (kind, payload) {
        const result = original.apply(this, arguments);
        try {
          window.__d1703Observed.push({
            kind: kind,
            payload: payload && typeof payload === 'object' ? JSON.parse(JSON.stringify(payload)) : payload === undefined ? null : payload,
            accepted: result !== false,
          });
        } catch (err) {
          window.__d1703Observed.push({ kind: kind, payload: null, accepted: result !== false, spyError: true });
        }
        return result;
      };
      api.__d1703Spy = true;
      return true;
    })()`
  );
}

async function readObservedEvents(ctx) {
  const events = await evaluate(ctx, 'Array.isArray(window.__d1703Observed) ? window.__d1703Observed.slice() : []');
  return Array.isArray(events) ? events : [];
}

async function readRuntimeState(ctx) {
  return evaluate(
    ctx,
    `(() => {
      const t = window.__arcadeTest;
      if (!t) return null;
      const joy = typeof t.joyInfo === 'function' ? t.joyInfo() : null;
      const info = typeof t.info === 'function' ? t.info() : null;
      const career = typeof t.careerInfo === 'function' ? t.careerInfo() : null;
      const api = window.ArcadeCareer;
      return {
        joy: joy,
        level: info ? info.level : null,
        moves: info ? info.moves : null,
        score: info ? info.score : null,
        cards: info && Array.isArray(info.cardList) ? info.cardList : [],
        career: career,
        isCommissionRun: !!(api && typeof api.isCommissionRun === 'function' && api.isCommissionRun()),
        goalLine: !!document.querySelector('[data-career-goal]'),
      };
    })()`
  );
}

async function currentRun(ctx) {
  return evaluate(
    ctx,
    `(() => {
      const api = window.ArcadeCareer;
      if (!api) return null;
      const run = api.commissionRun;
      return run ? { ticketId: run.ticketId || null, commissionId: run.commissionId || null, gameId: run.gameId || null } : null;
    })()`
  );
}

/* ------------------------------------------------------------------ *
 * 真实 UI / 真实钩子驱动
 * ------------------------------------------------------------------ */

async function startSession(ctx) {
  const clicked = await evaluate(
    ctx,
    `(() => {
      const overlay = document.querySelector('[data-overlay]');
      if (overlay && !overlay.hidden) {
        const start = document.querySelector('[data-ov-btn]');
        if (start) {
          start.click();
          return 'clicked';
        }
      }
      return 'already';
    })()`
  );
  await waitFor(ctx, `!!window.__arcadeTest && typeof window.__arcadeTest.joyInfo === 'function' && window.__arcadeTest.joyInfo().state === 'playing'`, 8000, 'session playing');
  return clicked;
}

/** 等预览按真实规则（≥0.6s）可跳过后跳过；返回 false 表示当前不在可跳过的 playing 态。 */
async function skipPreview(ctx) {
  const started = Date.now();
  while (Date.now() - started < 9000) {
    const joy = await evaluate(ctx, `(() => { const t = window.__arcadeTest; if (!t || typeof t.joyInfo !== 'function') return null; return t.joyInfo(); })()`);
    if (!joy) {
      await sleep(60);
      continue;
    }
    if (joy.state === 'playing' && joy.previewTimer <= 0) return true;
    if (joy.state === 'playing' && joy.previewTimer > 0) {
      await evaluate(ctx, 'window.__arcadeTest.skipPreviewNow()');
    }
    await sleep(120);
  }
  throw new Error('memory-flip fixture: preview could not be skipped in time');
}

/** 用真实测试钩子把当前局切到指定关（牌桌是真实 buildLevel 产物，随后按真实预览规则跳过）。 */
async function selectLevel(ctx, level) {
  await evaluate(ctx, `window.__arcadeTest.setLevel(${Number(level) || 1})`);
  await waitFor(ctx, `window.__arcadeTest.joyInfo().state === 'playing'`, 4000, 'setLevel playing');
  await skipPreview(ctx);
  const info = await evaluate(ctx, `({ level: window.__arcadeTest.info().level, cards: window.__arcadeTest.info().cardList.length })`);
  return info;
}

/** 配一对真实牌：revealById 两张同 symbol 未配对牌（走真实 reveal 提交点）。 */
async function matchOnePair(ctx) {
  const result = await evaluate(
    ctx,
    `(() => {
      const t = window.__arcadeTest;
      const info = t.info();
      const list = info.cardList;
      const first = list.find((card) => !card.matched);
      if (!first) return { ok: false, reason: 'no-unmatched-card' };
      const mate = list.find((card) => card.id !== first.id && !card.matched && card.symbol === first.symbol);
      if (!mate) return { ok: false, reason: 'no-mate' };
      const a = t.revealById(first.id);
      const b = t.revealById(mate.id);
      const after = t.info();
      const matched = after.cardList.filter((card) => card.matched).length / 2;
      return {
        ok: a === true && b === true,
        pair: [first.id, mate.id],
        level: after.level,
        matchesNow: matched,
        state: t.joyInfo().state,
        previewTimer: t.joyInfo().previewTimer,
      };
    })()`
  );
  if (!result || !result.ok) throw new Error('memory-flip fixture: pair reveal failed: ' + JSON.stringify(result));
  return result;
}

async function matchPairs(ctx, count) {
  const results = [];
  for (let i = 0; i < count; i += 1) {
    results.push(await matchOnePair(ctx));
  }
  return results;
}

/** 真实 UI：暂停 → 职业 run 专属「结束本局」→ 自然结束（发 session.finish 后结算）。 */
async function quitSession(ctx) {
  const paused = await evaluate(
    ctx,
    `(() => { const button = document.querySelector('[data-pause]'); if (!button) return false; button.click(); return true; })()`
  );
  if (!paused) throw new Error('memory-flip fixture: pause button missing');
  await waitFor(
    ctx,
    `(() => { const overlay = document.querySelector('[data-overlay]'); const button = document.querySelector('[data-ov-btn2]'); return !!overlay && !overlay.hidden && !!button && !button.hidden; })()`,
    4000,
    'career quit button visible'
  );
  const snap = await evaluate(
    ctx,
    `(() => {
      const t = window.__arcadeCareerTest;
      const before = t && typeof t.commissionState === 'function' ? t.commissionState() : null;
      const button = document.querySelector('[data-ov-btn2]');
      if (!button || button.hidden) return { clicked: false };
      button.click();
      const after = t && typeof t.commissionState === 'function' ? t.commissionState() : null;
      return { clicked: true, before: before, after: after };
    })()`
  );
  if (!snap || !snap.clicked) throw new Error('memory-flip fixture: career quit button could not be clicked');
  await waitFor(ctx, `window.__arcadeTest.joyInfo().state === 'over'`, 6000, 'session over after quit');
  return snap;
}

async function waitSettled(ctx, timeout) {
  /* bridge 在结算（成功或可归因失败）后清空 commissionRun：这是与页面无关的真实结算信号。 */
  await waitFor(
    ctx,
    `!!window.ArcadeCareer && typeof window.ArcadeCareer.isCommissionRun === 'function' && window.ArcadeCareer.isCommissionRun() === false`,
    timeout || 15000,
    'commission settled'
  );
}

async function captureCommissionState(ctx) {
  return evaluate(
    ctx,
    `(() => {
      const t = window.__arcadeCareerTest;
      if (!t || typeof t.commissionState !== 'function') return null;
      const state = t.commissionState();
      if (!state) return null;
      return {
        ticketId: state.ticketId || null,
        bufferCount: state.bufferCount || 0,
        events: Array.isArray(state.events) ? state.events.map((event) => ({ kind: event.kind, payload: event.payload || null })) : [],
      };
    })()`
  );
}

/* ------------------------------------------------------------------ *
 * 成功的真实终局：从第 1 关打到第 6 关（自然通关 → finish(true) → session.finish）
 * ------------------------------------------------------------------ */

async function playFullSession(ctx) {
  for (let level = 1; level <= 6; level += 1) {
    await skipPreview(ctx);
    for (;;) {
      const snapshot = await evaluate(ctx, `(() => { const t = window.__arcadeTest; const info = t.info(); return { unmatched: info.cardList.filter((card) => !card.matched).length, state: t.joyInfo().state }; })()`);
      if (!snapshot || snapshot.state === 'over') return;
      if (snapshot.unmatched === 0) break;
      await matchOnePair(ctx);
    }
    if (level < 6) {
      await waitFor(
        ctx,
        `(() => { const joy = window.__arcadeTest.joyInfo(); return joy.state === 'playing' && joy.previewTimer > 0 && window.__arcadeTest.info().level === ${level + 1}; })()`,
        6000,
        'next level with preview'
      );
    }
  }
  await waitFor(ctx, `window.__arcadeTest.joyInfo().state === 'over'`, 8000, 'session over after final level');
}

/* ------------------------------------------------------------------ *
 * 失败：不产生目标事件的终局
 * ------------------------------------------------------------------ */

/** 配对类目标失败：真实配对 target-1 对后主动收工 → pair.match 次数不够。 */
async function pairFailureScenario(ctx, tier, atLeast) {
  await startCommission(ctx, tier);
  await installObserveSpy(ctx);
  await startSession(ctx);
  await selectLevel(ctx, 3);
  const wanted = Math.max(0, Math.min(atLeast - 1, 5));
  await matchPairs(ctx, wanted);
  const held = await captureCommissionState(ctx);
  const quit = await quitSession(ctx);
  await waitSettled(ctx);
  const events = await readObservedEvents(ctx);
  const runtime = await readRuntimeState(ctx);
  return {
    events: events,
    stats: {
      objectiveKind: 'pair.match',
      targetAtLeast: atLeast,
      matches: wanted,
      level: runtime ? runtime.level : null,
      state: runtime ? runtime.joy && runtime.joy.state : null,
      commissionEvents: held ? held.events : null,
      quitSnapshot: quit && quit.after ? quit.after.events : null,
    },
  };
}

/**
 * session.finish 类目标失败：真实开局+真实配对后，用 bridge 公共结算入口提前交差
 * （没有自然终局 → 不产生 session.finish）。memory-flip 经典局没有失败态，
 * 自然终局（通关/主动结束）一定会发 session.finish，因此该阶失败只能以「提前交差/放弃」
 * 归因；这类结束由 bridge/commission-core 按零事件判 objective-not-met，零奖励。
 * 优先用 runner 的 helpers.settle（其内部同样调用 bridge finish），保证 runner 能
 * 直接把该结果当作 failure 证据。
 */
async function sessionFailureScenario(ctx, tier) {
  await startCommission(ctx, tier);
  await installObserveSpy(ctx);
  await startSession(ctx);
  await selectLevel(ctx, 3);
  await matchPairs(ctx, 2);
  const held = await captureCommissionState(ctx);
  const settleHelper = optionalHelper(ctx, 'settle');
  let settled = false;
  if (settleHelper) {
    await settleHelper('lost', { level: 3, matches: 2, early: true });
    settled = true;
  } else {
    settled = await evaluate(
      ctx,
      `(() => {
        const api = window.ArcadeCareer;
        if (!api || typeof api.finish !== 'function') return false;
        api.finish({ mode: 'classic', outcome: 'lost', stats: { level: 3, matches: 2, early: true } });
        return true;
      })()`
    );
  }
  if (!settled) throw new Error('memory-flip fixture: settle helper / ArcadeCareer.finish unavailable for early settle');
  await waitSettled(ctx);
  const events = await readObservedEvents(ctx);
  return {
    events: events,
    stats: {
      objectiveKind: 'session.finish',
      targetAtLeast: 1,
      matches: 2,
      sessionEnded: false,
      settledWithoutSession: true,
      commissionEvents: held ? held.events : null,
    },
  };
}

/* ------------------------------------------------------------------ *
 * 成功：配对类（目标对达成后主动收工）与 session 类（真实通关一整局）
 * ------------------------------------------------------------------ */

async function pairSuccessScenario(ctx, tier, atLeast) {
  await startCommission(ctx, tier);
  await installObserveSpy(ctx);
  await startSession(ctx);
  const levelFor = atLeast >= 9 ? 5 : atLeast >= 7 ? 4 : atLeast >= 5 ? 3 : 3;
  const selected = await selectLevel(ctx, levelFor);
  const played = await matchPairs(ctx, atLeast);
  const held = await captureCommissionState(ctx);
  const quit = await quitSession(ctx);
  await waitSettled(ctx);
  const events = await readObservedEvents(ctx);
  const runtime = await readRuntimeState(ctx);
  return {
    events: events,
    stats: {
      objectiveKind: 'pair.match',
      targetAtLeast: atLeast,
      matches: played.length,
      level: selected ? selected.level : null,
      score: runtime ? runtime.score : null,
      state: runtime ? runtime.joy && runtime.joy.state : null,
      commissionEvents: held ? held.events : null,
      sessionFinish: quit && quit.after ? quit.after.events.filter((event) => event.kind === 'session.finish') : null,
    },
  };
}

async function sessionSuccessScenario(ctx, tier) {
  await startCommission(ctx, tier);
  await installObserveSpy(ctx);
  await startSession(ctx);
  await playFullSession(ctx);
  await waitSettled(ctx);
  const events = await readObservedEvents(ctx);
  const runtime = await readRuntimeState(ctx);
  return {
    events: events,
    stats: {
      objectiveKind: 'session.finish',
      targetAtLeast: 1,
      sessionEnded: true,
      level: runtime ? runtime.level : null,
      state: runtime ? runtime.joy && runtime.joy.state : null,
      sessionFinish: events.filter((event) => event.kind === 'session.finish'),
    },
  };
}

/* ------------------------------------------------------------------ *
 * runner helpers 用法
 * ------------------------------------------------------------------ */

async function seedStoryFlags(ctx, flags) {
  const seed = optionalHelper(ctx, 'seedStoryFlags');
  if (seed && Array.isArray(flags) && flags.length) {
    await seed(flags);
  }
}

async function startCommission(ctx, tier) {
  const start = requireHelper(ctx, 'startCommission');
  const result = await start(tier);
  await waitFor(ctx, `window.__arcadeTest && window.__arcadeTest.joyInfo && typeof window.__arcadeTest.info === 'function'`, 9000, 'game page ready');
  const run = await currentRun(ctx);
  if (!run || run.gameId !== gameId) {
    throw new Error('memory-flip fixture: commission run not active for ' + gameId + ': ' + JSON.stringify(run) + ' (' + JSON.stringify(result) + ')');
  }
  await waitFor(
    ctx,
    `(() => { const overlay = document.querySelector('[data-overlay]'); const goal = document.querySelector('[data-career-goal]'); return !!overlay && !overlay.hidden && !!goal; })()`,
    8000,
    'career start overlay with goal line'
  );
  return { start: result, run: run };
}

/* ------------------------------------------------------------------ *
 * 导出契约
 * ------------------------------------------------------------------ */

export const tiers = {
  1: {
    async success(ctx) {
      return pairSuccessScenario(ctx, 1, 3);
    },
    async failure(ctx) {
      return pairFailureScenario(ctx, 1, 3);
    },
  },
  2: {
    async success(ctx) {
      return pairSuccessScenario(ctx, 2, 5);
    },
    async failure(ctx) {
      return pairFailureScenario(ctx, 2, 5);
    },
  },
  3: {
    async success(ctx) {
      return sessionSuccessScenario(ctx, 3);
    },
    async failure(ctx) {
      return sessionFailureScenario(ctx, 3);
    },
  },
  4: {
    async success(ctx) {
      await seedStoryFlags(ctx, ['C3.truth_found']);
      return pairSuccessScenario(ctx, 4, 7);
    },
    async failure(ctx) {
      await seedStoryFlags(ctx, ['C3.truth_found']);
      return pairFailureScenario(ctx, 4, 7);
    },
  },
  5: {
    async success(ctx) {
      await seedStoryFlags(ctx, ['C3.truth_found', 'C4.city_power_restored']);
      return sessionSuccessScenario(ctx, 5);
    },
    async failure(ctx) {
      await seedStoryFlags(ctx, ['C3.truth_found', 'C4.city_power_restored']);
      return sessionFailureScenario(ctx, 5);
    },
  },
  6: {
    async success(ctx) {
      await seedStoryFlags(ctx, ['C3.truth_found', 'C4.city_power_restored', 'C5.star_tower_resolved']);
      return pairSuccessScenario(ctx, 6, 9);
    },
    async failure(ctx) {
      await seedStoryFlags(ctx, ['C3.truth_found', 'C4.city_power_restored', 'C5.star_tower_resolved']);
      return pairFailureScenario(ctx, 6, 9);
    },
  },
};

export async function cleanup(ctx) {
  try {
    await evaluate(
      ctx,
      `(() => {
        const api = window.ArcadeCareer;
        if (api && typeof api.observe === 'function' && typeof api.__d1703OriginalObserve === 'function') {
          api.observe = api.__d1703OriginalObserve;
        }
        if (api) {
          delete api.__d1703OriginalObserve;
          delete api.__d1703Spy;
        }
        window.__d1703Observed = [];
        return true;
      })()`
    );
  } catch (err) {
    /* cleanup 失败不掩盖证据 */
  }
}
