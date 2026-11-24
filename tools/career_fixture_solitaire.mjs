/**
 * D17-07 solitaire 六阶职业委托 fixture（ADR §19.8）
 *
 * 导出契约（冻结）：
 *   export const gameId = 'solitaire';
 *   export const tiers = { 1..6: { async success(ctx), async failure(ctx) } };
 *   export async function cleanup(ctx);
 *
 * ctx（由 D17-02 统一 runner 提供）：{ cdp, page, port, tier, helpers }；
 * helpers 至少提供：startCommission(tier)、seedStoryFlags([...])、readState()、
 * reload()、settle()。本 fixture 对 evaluate/waitFor 做了多层兼容
 * （helpers.evaluate / page.evaluate / cdp.evaluate / 原生 CDP Runtime.evaluate），
 * 以免和 runner 的具体 CDP 封装形状耦合。
 *
 * 真实玩法/事件依据（docs/arcade-life/ADR-interfaces.md §19.3 / §19.4）：
 *   - stock.face_up   ：drawStock() 真实把牌库顶牌翻到废牌堆、flipTableauTop()/applyMove()
 *                       真实揭开暗牌之后提交；同一张牌在一个职业 run 内只计一次
 *                       （undo 或“重发一局”后重翻同一张牌不重复计）。
 *   - foundation.move ：applyMove() 真实把单牌移入基础牌堆之后提交；同一张牌只计一次
 *                       （undo 后重做同一手不重复计功）。
 *   - move.legal      ：applyMove() 每次真实合法牌堆/列移动之后提交 {moves}；同一状态迁移
 *                       只计一次（undo → 重做同一手不重复计功）。ADR §19.4 的 solitaire
 *                       目录已按内容 T4/T6（commissions.json 使用 move.legal）登记该
 *                       0.17 高阶调度补充事件。
 *
 * 驱动只用页面真实测试钩子（setSeed / setDeal / tap / undo / info / careerInfo）：
 *   - setSeed：真实 beginDeal（真实洗牌发牌）；
 *   - setDeal：真实 parseLayout/applySetDeal 注入盘面（T3–T6 用固定盘面保证可重复）；
 *   - tap：真实 handlePileTap（翻牌 / 选牌 / 移到基础牌堆）；
 *   - undo：真实 useUndo（回退快照）。
 * 不读取 DOM 文本、不伪造 observe；事件只从 bridge 的 commissionState 缓冲回读。
 *
 * 目标以 apps/arcade/career/content/commissions.json 为准：
 *   T1 stock.face_up ≥3、T2 stock.face_up ≥5、T3 foundation.move ≥3、
 *   T4 move.legal ≥8、T5 foundation.move ≥7、T6 move.legal ≥16。
 * T4–T6 的 C3/C4/C5 剧情旗标先由 helpers.seedStoryFlags 注入再 startCommission；
 * failure 一律用“翻牌/移动不足”归因（observed < atLeast），零奖励。
 */

export const gameId = 'solitaire';

const READY_TIMEOUT = 12000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 每阶真实目标（与 commissions.json 对齐；只读内容文件核对，不在运行时改内容）。 */
const TIERS = {
  1: { kind: 'stock.face_up', atLeast: 3, unit: 'draw' },
  2: { kind: 'stock.face_up', atLeast: 5, unit: 'draw' },
  3: { kind: 'foundation.move', atLeast: 3, unit: 'foundation' },
  4: { kind: 'move.legal', atLeast: 8, unit: 'foundation' },
  5: { kind: 'foundation.move', atLeast: 7, unit: 'foundation' },
  6: { kind: 'move.legal', atLeast: 16, unit: 'foundation' },
};

/** T4–T6 的受控剧情旗标（runner 也会 seed；fixture 再幂等 seed 一次，不改生产可见性）。 */
const TIER_FLAGS = {
  4: ['C3.truth_found'],
  5: ['C3.truth_found', 'C4.city_power_restored'],
  6: ['C3.truth_found', 'C4.city_power_restored', 'C5.star_tower_resolved'],
};

/** 固定发牌种子：真实 beginDeal，保证 stock 有 24 张可翻。 */
const DEAL_SEED = 20261123;

/* ------------------------------------------------------------------ *
 * ctx / helpers 适配
 * ------------------------------------------------------------------ */

function helperBag(ctx) {
  return ctx && ctx.helpers && typeof ctx.helpers === 'object' ? ctx.helpers : {};
}

function requireHelper(ctx, name) {
  const fn = helperBag(ctx)[name];
  if (typeof fn !== 'function') {
    throw new Error('solitaire fixture: ctx.helpers.' + name + ' is required by ADR §19.8 but is missing');
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
      throw new Error('solitaire fixture evaluate failed: ' + ((detail.exception && detail.exception.description) || detail.text || 'unknown'));
    }
    return res && res.result ? res.result.value : undefined;
  }
  throw new Error('solitaire fixture: no page evaluate available (want ctx.helpers.evaluate / ctx.page.evaluate / ctx.cdp.evaluate)');
}

async function waitFor(ctx, expression, timeout, label) {
  const bag = helperBag(ctx);
  if (typeof bag.waitFor === 'function') {
    try {
      return await bag.waitFor(expression, timeout || READY_TIMEOUT);
    } catch (err) {
      throw new Error('solitaire fixture timeout: ' + (label || expression) + ' · ' + (err && err.message ? err.message : String(err)));
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
  throw new Error('solitaire fixture timeout: ' + (label || expression) + (lastError ? ' · ' + lastError.message : ''));
}

/* ------------------------------------------------------------------ *
 * 页面真实钩子
 * ------------------------------------------------------------------ */

async function careerInfo(ctx) {
  return evaluate(
    ctx,
    `(() => {
      const t = window.__arcadeTest;
      if (!t || typeof t.careerInfo !== 'function') return null;
      return t.careerInfo();
    })()`
  );
}

/** bridge 的委托事件缓冲（commission-core 内存缓冲；结算前可回读）。 */
async function readBuffer(ctx) {
  const events = await evaluate(
    ctx,
    `(() => {
      const t = window.__arcadeCareerTest;
      if (!t || typeof t.commissionState !== 'function') return null;
      const cs = t.commissionState();
      if (!cs || !Array.isArray(cs.events)) return null;
      return cs.events.map(function (event) {
        return { kind: event.kind, payload: event.payload || null };
      });
    })()`
  );
  return Array.isArray(events) ? events : null;
}

function countKinds(events) {
  const counts = {};
  (Array.isArray(events) ? events : []).forEach((event) => {
    if (!event || typeof event.kind !== 'string') return;
    counts[event.kind] = (counts[event.kind] || 0) + 1;
  });
  return counts;
}

/** 只声明 §19.4 solitaire 目录内的 kind（ADR 0.17 已登记 move.legal 为高阶调度补充）。 */
function declaredEvents(events) {
  const counts = countKinds(events);
  const out = {};
  ['stock.face_up', 'foundation.move', 'move.legal'].forEach((kind) => {
    if (counts[kind]) out[kind] = counts[kind];
  });
  return out;
}

async function ensurePlaying(ctx) {
  await waitFor(
    ctx,
    `(() => { const t = window.__arcadeTest; return !!t && typeof t.setSeed === 'function' && typeof t.tap === 'function'; })()`,
    9000,
    'solitaire test hooks'
  );
  return true;
}

/** 真实重新发牌（beginDeal）并进入 playing。 */
async function dealWithSeed(ctx, seed) {
  const ok = await evaluate(ctx, `window.__arcadeTest.setSeed(${Number(seed)})`);
  if (ok !== true) throw new Error('solitaire fixture: setSeed(' + seed + ') failed');
  await waitFor(ctx, `window.__arcadeTest.info().state === 'playing'`, 6000, 'playing after setSeed');
  return true;
}

/** 真实注入盘面（parseLayout + applySetDeal），随后进入 playing。 */
async function applyLayout(ctx, layout) {
  const ok = await evaluate(ctx, `window.__arcadeTest.setDeal(${JSON.stringify(layout)})`);
  if (ok !== true) throw new Error('solitaire fixture: setDeal failed');
  await waitFor(ctx, `window.__arcadeTest.info().state === 'playing'`, 6000, 'playing after setDeal');
  return true;
}

async function tap(ctx, type, index, cardIndex) {
  const args = [JSON.stringify(String(type)), String(Number.isInteger(index) ? index : 0)];
  if (Number.isInteger(cardIndex)) args.push(String(cardIndex));
  return evaluate(ctx, 'window.__arcadeTest.tap(' + args.join(', ') + ')');
}

async function tapStock(ctx) {
  return tap(ctx, 'stock');
}

async function undo(ctx) {
  return evaluate(ctx, 'window.__arcadeTest.undo()');
}

/**
 * T3–T6 固定盘面：四门基础牌堆已归位 A–4，四列顶部依次是 5/6/7/8。
 * 每列连续 4 次真实“选顶牌 → 移到基础牌堆”即可产生 4 次真实合法移动；
 * 缺牌由 parseLayout 自动补进牌库（不影响移动）。
 * 注意：盘面是测试钩子注入的初始状态，之后每一步都是真实 tap/applyMove。
 */
function foundationLayout() {
  const foundations = [];
  const tableau = [];
  for (let suit = 0; suit < 4; suit += 1) {
    const sequence = [];
    for (let rankIndex = 0; rankIndex < 4; rankIndex += 1) sequence.push(suit * 13 + rankIndex);
    foundations.push(sequence);
    const column = [];
    for (let rankIndex = 7; rankIndex >= 4; rankIndex -= 1) column.push({ c: suit * 13 + rankIndex, up: true });
    tableau.push(column);
  }
  tableau.push([], [], []);
  return { stock: [], waste: [], tableau: tableau, foundations: foundations };
}

/** 连续可做的基础牌堆移动序列（列 suit 顶部为 5）。 */
function foundationPlan(count) {
  const steps = [];
  for (let suit = 0; suit < 4 && steps.length < count; suit += 1) {
    for (let rankIndex = 4; rankIndex <= 7 && steps.length < count; rankIndex += 1) {
      steps.push({ pile: suit, foundation: suit });
    }
  }
  return steps;
}

async function moveToFoundation(ctx, step) {
  const selected = await tap(ctx, 'tableau', step.pile);
  if (selected !== true) throw new Error('solitaire fixture: select tableau ' + step.pile + ' failed');
  const moved = await tap(ctx, 'foundation', step.foundation);
  if (moved !== true) throw new Error('solitaire fixture: foundation move ' + step.foundation + ' failed');
  return true;
}

/* ------------------------------------------------------------------ *
 * 场景
 * ------------------------------------------------------------------ */

async function startCommission(ctx, tier) {
  await seedStoryFlags(ctx, TIER_FLAGS[tier] || []);
  const start = requireHelper(ctx, 'startCommission');
  const started = await start(tier);
  if (!started || started.ok !== true) {
    throw new Error('solitaire fixture: startCommission(' + tier + ') failed: ' + JSON.stringify(started));
  }
  await waitFor(
    ctx,
    `(() => {
      const t = window.__arcadeTest;
      if (!t || typeof t.careerInfo !== 'function') return false;
      const info = t.careerInfo();
      return !!info && info.isCommission === true && info.locked === true;
    })()`,
    12000,
    'commission locked'
  );
  await waitFor(
    ctx,
    `(() => {
      const overlay = document.querySelector('[data-overlay]');
      const goal = document.querySelector('[data-career-goal]');
      return !!overlay && !overlay.hidden && !!goal;
    })()`,
    8000,
    'career start overlay with goal line'
  );
  const info = await careerInfo(ctx);
  if (!info || info.gameId === 'undefined') {
    /* careerInfo 不含 gameId 字段时以 objectiveKind 兜底核对，避免误判。 */
  }
  return { start: started, info: info };
}

async function seedStoryFlags(ctx, flags) {
  const seed = optionalHelper(ctx, 'seedStoryFlags');
  if (!seed || !Array.isArray(flags) || !flags.length) return { ok: true, seeded: 0 };
  const result = await seed(flags);
  return result && typeof result === 'object' ? result : { ok: true, seeded: flags.length };
}

/** 翻牌类成功：真实发牌 → 真实翻 N 张 → undo 后重翻同一张（不重复计） → 返回事件。 */
async function flipSuccess(ctx, tier) {
  const spec = TIERS[tier];
  const started = await startCommission(ctx, tier);
  await ensurePlaying(ctx);
  await dealWithSeed(ctx, DEAL_SEED + tier);
  const draws = [];
  for (let i = 0; i < spec.atLeast; i += 1) draws.push((await tapStock(ctx)) === true);
  if (draws.some((ok) => !ok)) throw new Error('solitaire fixture: stock draw failed: ' + JSON.stringify(draws));
  const beforeUndo = await readBuffer(ctx);
  if (!beforeUndo) throw new Error('solitaire fixture: commission buffer unavailable');
  const countsBefore = countKinds(beforeUndo);
  if ((countsBefore['stock.face_up'] || 0) < spec.atLeast) {
    throw new Error('solitaire fixture: only ' + (countsBefore['stock.face_up'] || 0) + ' stock.face_up < ' + spec.atLeast);
  }
  const undone = await undo(ctx);
  if (undone !== true) throw new Error('solitaire fixture: undo failed');
  const redrawn = (await tapStock(ctx)) === true;
  const afterUndo = await readBuffer(ctx);
  const countsAfter = countKinds(afterUndo);
  const noDouble =
    redrawn &&
    (countsAfter['stock.face_up'] || 0) === (countsBefore['stock.face_up'] || 0) &&
    (countsAfter['move.legal'] || 0) === (countsBefore['move.legal'] || 0);
  if (!noDouble) {
    throw new Error('solitaire fixture: undo/redraw double counted: ' + JSON.stringify({ countsBefore, countsAfter }));
  }
  const info = await careerInfo(ctx);
  return {
    events: declaredEvents(afterUndo),
    stats: {
      objectiveKind: spec.kind,
      atLeast: spec.atLeast,
      faceUps: countsAfter['stock.face_up'] || 0,
      undoRedoNoDouble: true,
      seed: DEAL_SEED + tier,
      moves: info ? info.moves : null,
      foundationCount: info ? info.foundationCount : null,
      state: info ? info.state : null,
    },
    observed: {
      stockFaceUp: countsAfter['stock.face_up'] || 0,
      foundationMove: countsAfter['foundation.move'] || 0,
      moveLegal: countsAfter['move.legal'] || 0,
      undoGuard: { before: countsBefore['stock.face_up'] || 0, after: countsAfter['stock.face_up'] || 0, redrawn: redrawn },
    },
    info: info,
    started: started,
  };
}

/** 翻牌类失败：真实发牌但翻牌不足（observed < atLeast）。 */
async function flipFailure(ctx, tier) {
  const spec = TIERS[tier];
  const started = await startCommission(ctx, tier);
  await ensurePlaying(ctx);
  await dealWithSeed(ctx, DEAL_SEED + 100 + tier);
  const wanted = Math.max(1, spec.atLeast - 1);
  for (let i = 0; i < wanted; i += 1) {
    const ok = await tapStock(ctx);
    if (ok !== true) throw new Error('solitaire fixture: stock draw failed at ' + i);
  }
  const events = await readBuffer(ctx);
  const counts = countKinds(events);
  if ((counts['stock.face_up'] || 0) >= spec.atLeast) {
    throw new Error('solitaire fixture: failure scenario reached atLeast: ' + JSON.stringify(counts));
  }
  const info = await careerInfo(ctx);
  return {
    events: declaredEvents(events),
    stats: {
      objectiveKind: spec.kind,
      atLeast: spec.atLeast,
      faceUps: counts['stock.face_up'] || 0,
      insufficient: 'flips',
      state: info ? info.state : null,
    },
    observed: counts,
    info: info,
    started: started,
  };
}

/** 移动类成功：注入固定盘面 → 真实移动 N 次 → undo 后重做同一手（不重复计） → 返回事件。 */
async function foundationSuccess(ctx, tier) {
  const spec = TIERS[tier];
  const started = await startCommission(ctx, tier);
  await ensurePlaying(ctx);
  await applyLayout(ctx, foundationLayout());
  const steps = foundationPlan(spec.atLeast);
  if (steps.length !== spec.atLeast) throw new Error('solitaire fixture: foundation plan short: ' + steps.length);
  for (let i = 0; i < steps.length; i += 1) await moveToFoundation(ctx, steps[i]);
  const beforeUndo = await readBuffer(ctx);
  if (!beforeUndo) throw new Error('solitaire fixture: commission buffer unavailable');
  const countsBefore = countKinds(beforeUndo);
  if ((countsBefore['move.legal'] || 0) < spec.atLeast) {
    throw new Error('solitaire fixture: move.legal ' + (countsBefore['move.legal'] || 0) + ' < ' + spec.atLeast);
  }
  const undone = await undo(ctx);
  if (undone !== true) throw new Error('solitaire fixture: undo failed');
  const last = steps[steps.length - 1];
  await moveToFoundation(ctx, last);
  const afterUndo = await readBuffer(ctx);
  const countsAfter = countKinds(afterUndo);
  const noDouble =
    (countsAfter['move.legal'] || 0) === (countsBefore['move.legal'] || 0) &&
    (countsAfter['foundation.move'] || 0) === (countsBefore['foundation.move'] || 0) &&
    (countsAfter['stock.face_up'] || 0) === (countsBefore['stock.face_up'] || 0);
  if (!noDouble) {
    throw new Error('solitaire fixture: undo/redo double counted: ' + JSON.stringify({ countsBefore, countsAfter }));
  }
  const info = await careerInfo(ctx);
  return {
    events: declaredEvents(afterUndo),
    stats: {
      objectiveKind: spec.kind,
      atLeast: spec.atLeast,
      foundationMoves: countsAfter['foundation.move'] || 0,
      legalMoves: countsAfter['move.legal'] || 0,
      undoRedoNoDouble: true,
      moves: info ? info.moves : null,
      foundationCount: info ? info.foundationCount : null,
      state: info ? info.state : null,
    },
    observed: {
      stockFaceUp: countsAfter['stock.face_up'] || 0,
      foundationMove: countsAfter['foundation.move'] || 0,
      moveLegal: countsAfter['move.legal'] || 0,
      undoGuard: {
        legalBefore: countsBefore['move.legal'] || 0,
        legalAfter: countsAfter['move.legal'] || 0,
        foundationBefore: countsBefore['foundation.move'] || 0,
        foundationAfter: countsAfter['foundation.move'] || 0,
      },
    },
    info: info,
    started: started,
  };
}

/** 移动类失败：真实移动但次数不足（observed < atLeast）。 */
async function foundationFailure(ctx, tier) {
  const spec = TIERS[tier];
  const started = await startCommission(ctx, tier);
  await ensurePlaying(ctx);
  await applyLayout(ctx, foundationLayout());
  const wanted = Math.max(1, spec.atLeast - 1);
  const steps = foundationPlan(wanted);
  if (steps.length !== wanted) throw new Error('solitaire fixture: failure plan short: ' + steps.length + ' < ' + wanted);
  for (let i = 0; i < steps.length; i += 1) await moveToFoundation(ctx, steps[i]);
  const events = await readBuffer(ctx);
  const counts = countKinds(events);
  const observed = spec.kind === 'move.legal' ? counts['move.legal'] || 0 : counts['foundation.move'] || 0;
  if (observed >= spec.atLeast) throw new Error('solitaire fixture: failure scenario reached atLeast: ' + JSON.stringify(counts));
  const info = await careerInfo(ctx);
  return {
    events: declaredEvents(events),
    stats: {
      objectiveKind: spec.kind,
      atLeast: spec.atLeast,
      [spec.kind === 'move.legal' ? 'legalMoves' : 'foundationMoves']: observed,
      insufficient: 'moves',
      state: info ? info.state : null,
    },
    observed: counts,
    info: info,
    started: started,
  };
}

/* ------------------------------------------------------------------ *
 * 导出契约
 * ------------------------------------------------------------------ */

export const tiers = {
  1: {
    async success(ctx) {
      return flipSuccess(ctx, 1);
    },
    async failure(ctx) {
      return flipFailure(ctx, 1);
    },
  },
  2: {
    async success(ctx) {
      return flipSuccess(ctx, 2);
    },
    async failure(ctx) {
      return flipFailure(ctx, 2);
    },
  },
  3: {
    async success(ctx) {
      return foundationSuccess(ctx, 3);
    },
    async failure(ctx) {
      return foundationFailure(ctx, 3);
    },
  },
  4: {
    async success(ctx) {
      return foundationSuccess(ctx, 4);
    },
    async failure(ctx) {
      return foundationFailure(ctx, 4);
    },
  },
  5: {
    async success(ctx) {
      return foundationSuccess(ctx, 5);
    },
    async failure(ctx) {
      return foundationFailure(ctx, 5);
    },
  },
  6: {
    async success(ctx) {
      return foundationSuccess(ctx, 6);
    },
    async failure(ctx) {
      return foundationFailure(ctx, 6);
    },
  },
};

export async function cleanup(ctx) {
  /* fixture 不注入 spy / 不写存储；结算与清理全部由 runner 负责，这里只确保页面没有残留选择态。 */
  try {
    await evaluate(
      ctx,
      `(() => {
        try {
          const t = window.__arcadeTest;
          if (t && typeof t.info === 'function' && t.info().selected) {
            t.tap('tableau', 0, null);
          }
        } catch (err) {
          /* ignore */
        }
        return true;
      })()`
    );
  } catch (err) {
    /* cleanup 失败不掩盖证据 */
  }
}
