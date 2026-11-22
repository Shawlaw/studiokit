#!/usr/bin/env node
/**
 * Arcade Life 0.15 · 16 源微线索自动回归（D15-16）
 *
 * 目标：用真实浏览器逐款证明「16 款游戏 → 各自微线索」的被动产出通道可达，并覆盖
 * 状态机（同局 ≤1 条 / 不重复记录 / 3 局保底 / 提示关闭）、模式隔离（mow / zen / challenge
 * 不进入生涯发现）、零经济副作用与 bridge 静默、测试前后隔离。
 *
 * 覆盖（全部实际执行，无外部网络、零 npm 依赖）：
 *   1. 16/16 单源可达：逐款打开 `?careerTest=1&t=…#test`，点击真实开始按钮进入经典局，
 *      再走该页既有 `__arcadeTest` 真实业务钩子（内部仍调用真实游戏函数/真实输入）触发
 *      `content/clues.json` 的 trigger.kind 达到 atLeast，最后由游戏既有结算函数自然调用
 *      `career.finish({mode:'classic'})`；断言 state().clues 出现 CL-<gameId>、stage ≥ GLIMPSED、
 *      lastFinish().result.persisted === true、结算处 `[data-career-clue]` chip 渲染、无 console error。
 *   2. 同局最多 1 条 + 不重复：snake-run 真实 20 果实收局只产出 1 条线索 / DB discovery 1 行；
 *      立刻重复调用 finish（同一结算出口）被防抖判为 duplicate-settle，不新增线索/记录；
 *      同页第 2 局继续触发事件只累计 eligibleRuns，不重复发现同一条线索。
 *   3. 3 局保底：brick-breaker 连续 3 局「无满足事件的经典局」（loseBallNow 真实失球收局），
 *      第 3 局产出 CL-brick-breaker 且 result.reason === 'guarantee'，runs[gameId].eligibleRuns 递增到 3。
 *   4. 零经济副作用（明确口径）：见下「零经济口径」。逐款对 A.Progress.get / A.Scores.list /
 *      A.Playtime.stats（该游戏）/ A.Challenge.progress / A.GameMeta.get 做 JSON 快照，
 *      断言 career-only 写入路径不改变其中任何一项。
 *   5. 模式隔离：star-raid `#test.mow` 真实击杀/受击/Boss → 0 career 事件、不 finish、
 *      scoresInfo 星币/plays 不变；block-drop zen 真实消行 → 0 career 事件、不 finish；
 *      snake-run / block-drop 挑战局 forceStageClear → 0 career 事件 / 线索。
 *   6. 禁用提示：setHintsEnabled(false) 后真实事件与真实结算不产线索，eligibleRuns 仍计数；
 *      重新开启后下一局可触发（reason=event）。
 *   7. bridge 静默：仅 `#test`（无 careerTest）页面不暴露 `__arcadeCareerTest`、不渲染
 *      `[data-career-clue]`、不创建/写入 `studiokit:arcade:career` IndexedDB；既有
 *      `__arcadeTest` 探针（solitaire playToEnd / selftest）仍可用。
 *   8. 测试隔离：开始与结束都 `indexedDB.deleteDatabase('studiokit:arcade:career')`，
 *      结束时中性页无残留 career DOM。
 *
 * 零经济口径：
 * - 「真实经典局」本身会按既有设计写 Progress / 积分表 / 游玩时长 / Challenge / GameMeta，
 *   本脚本不把这些既有写入当作 career 副作用（任务允许经典游玩带来的记录变化）。
 * - 因此逐款游戏的零经济断言使用「只调用 career API、不实际游玩」的隔离路径：
 *   经典局结算完成、页面停在上一次结算态后，先 `__arcadeCareerTest.resetAll()`（仅生涯内存 + 独立 IDB），
 *   取 5 项快照 S0；随后直接调用 bridge 公开 API（与游戏页完全同一条调用路径）
 *   `ArcadeCareer.observe(kind, payload) × trigger.atLeast` 再 `ArcadeCareer.finish({mode:'classic'})`，
 *   等 `lastFinish().result.persisted === true`（含独立 IDB 写入与线索发现）后取 S1；
 *   断言 5 项快照 JSON 逐字节相等。该路径不触碰任何游戏函数、不产生结算，故任何差异都只能来自 career。
 *
 * 驱动口径（不伪造游戏内部变量）：
 * - 优先真实 UI：点击 `[data-ov-btn]` 开始经典局、真实键盘/指针（snowbells 走出雪台、gravity-flip 敲击画布）。
 * - 其余走各页既有 `__arcadeTest` 探针（0.8–0.14 已入库的测试钩子）：它们内部调用真实业务函数
 *   （`stepSnake` / `hitBrick` / `applyClear` / `killEnemy` / `settleDrop` / `cashIn` / `timeUp → gameOver`
 *   等）；`setBoard`/`setLevel`/`setPosition`/`forceSettle` 只作为确定性地形/局面夹具，
 *   事件本身仍由真实函数路径提交，不直接改 career 状态或伪造 observe 调用。
 * - 参考实现（仓库外的本地测试驱动脚本与证据目录，不随仓库分发）：D15-08/09/10/11 的驱动脚本与证据。
 *
 * 端口（显式，避免与 smoke/gameplay/其它 career 门禁冲突）：
 *   CAREER_GAMES_PORT=8833（静态服务器） / CAREER_GAMES_CDP_PORT=9433（headless Chrome）
 * 运行：node tools/career_games_reachability_test.mjs
 *      [--only=memory-flip,snowbells]  仅驱动指定游戏（开发用；跳过全局段落）
 *      [--port=8833] [--cdp-port=9433]
 * 退出码：0 全部 PASS；1 有 FAIL；2 环境/装配失败（缺 Chrome、端口占用、内容缺失、页面无法启动）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, createRecorder, envPort, launchChrome, openPage, sleep, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const DB_NAME = 'studiokit:arcade:career';
const CONTENT_DIR = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content');
const VIEWPORT = { width: 420, height: 900 };
const STAGE_RANK = ['DORMANT', 'GLIMPSED', 'CURIOUS', 'LOCAL', 'RESIDENT', 'EXPLORER'];
const ECONOMY_KEYS = ['progress', 'scores', 'playtime', 'challenge', 'gameMeta'];

const { record, assert, summary } = createRecorder();

/* ------------------------------------------------------------------ *
 * 参数 / 端口 / 内容
 * ------------------------------------------------------------------ */

function arg(name, fallback) {
  const prefix = '--' + name + '=';
  const hit = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function detail(value) {
  if (value === undefined) return '';
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 420 ? text.slice(0, 420) + '…' : text;
  } catch (err) {
    return String(value);
  }
}

function sameJson(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (err) {
    return false;
  }
}

function clampText(text, max) {
  const value = String(text == null ? '' : text);
  return value.length > max ? value.slice(0, max) + '…' : value;
}

/** 读取内容源：16 条线索 + 注册表 watch（kind/payload 类型）是唯一事实来源，避免在测试里重复硬编码阈值。 */
function loadContent() {
  const cluesFile = path.join(CONTENT_DIR, 'clues.json');
  const registryFile = path.join(CONTENT_DIR, 'registry.json');
  const cluesDoc = JSON.parse(fs.readFileSync(cluesFile, 'utf8'));
  const registryDoc = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  const clues = new Map();
  (Array.isArray(cluesDoc.clues) ? cluesDoc.clues : []).forEach((clue) => {
    if (clue && typeof clue.gameId === 'string') clues.set(clue.gameId, clue);
  });
  const watches = new Map();
  const games = [];
  (Array.isArray(registryDoc.games) ? registryDoc.games : []).forEach((game) => {
    if (!game || typeof game.gameId !== 'string') return;
    games.push(game.gameId);
    watches.set(game.gameId, Array.isArray(game.watch) ? game.watch : []);
  });
  if (games.length !== 16) throw new Error('registry.json 应含 16 款游戏，实际 ' + games.length);
  if (clues.size !== 16) throw new Error('clues.json 应含 16 条线索，实际 ' + clues.size);
  games.forEach((id) => {
    if (!clues.has(id)) throw new Error('缺少游戏线索：' + id);
  });
  return { clues, watches, games };
}

/** 依据 registry 的 payload 类型生成真实形状的 payload（仅供零经济隔离路径的 bridge 公开 API 调用）。 */
function samplePayload(watches, gameId) {
  const list = watches.get(gameId) || [];
  const watch = list[0] || { payload: {} };
  const out = {};
  Object.keys(watch.payload || {}).forEach((key) => {
    const type = watch.payload[key];
    out[key] = type === 'number' ? 1 : type === 'boolean' ? true : 'probe';
  });
  return out;
}

/** 环境/装配失败统一 exit 2（内容缺失、端口非法、Chrome 启动失败、页面无法引导都属此类）。 */
function envFail(message) {
  console.error('FAIL  环境/装配失败：' + message);
  process.exit(2);
}

let content = null;
try {
  content = loadContent();
} catch (err) {
  envFail(err && err.message ? err.message : String(err));
}
const { clues: CLUES, watches: WATCHES, games: GAME_IDS } = content;

let HTTP_PORT = 0;
let CDP_PORT = 0;
try {
  HTTP_PORT = envPort('CAREER_GAMES_PORT', Number(arg('port', 8833)) || 8833);
  CDP_PORT = envPort('CAREER_GAMES_CDP_PORT', Number(arg('cdp-port', 9433)) || 9433);
} catch (err) {
  envFail(err && err.message ? err.message : String(err));
}
const BASE = 'http://127.0.0.1:' + HTTP_PORT;
const ONLY = String(arg('only', process.env.CAREER_GAMES_ONLY || '') || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const ONLY_SET = ONLY.length ? new Set(ONLY) : null;
const DEV_ONLY = !!ONLY_SET;

/* ------------------------------------------------------------------ *
 * 运行期状态
 * ------------------------------------------------------------------ */

let server = null;
let launched = null;
let cdp = null;
let navSeq = 0;
const PER_GAME = {};
const SKIPS = [];

function gameUrl(gameId, { careerTest = true } = {}) {
  navSeq += 1;
  const query = careerTest ? '?careerTest=1&t=' + navSeq : '?t=' + navSeq;
  return BASE + '/apps/arcade/games/' + gameId + '.html' + query + '#test';
}

function neutralUrl() {
  navSeq += 1;
  return BASE + '/apps/arcade/index.html?t=' + navSeq;
}

/** 读取页面当前诊断快照；任何失败都不抛，用于 FAIL 明细里带实际状态片段。 */
async function diagnostics() {
  if (!cdp) return { error: 'no-cdp' };
  try {
    return await cdp.evaluate(`(() => {
      const t = window.__arcadeCareerTest;
      const g = window.__arcadeTest;
      let career = null;
      let state = null;
      let lastFinish = null;
      if (t) {
        try { career = t.info(); } catch (err) { career = { error: String(err && err.message) }; }
        try { lastFinish = t.lastFinish(); } catch (err) { lastFinish = { error: String(err && err.message) }; }
        try {
          const s = t.state();
          state = { stage: s.stage, clueKeys: Object.keys(s.clues || {}), runs: s.runs };
        } catch (err) { state = { error: String(err && err.message) }; }
      }
      let game = null;
      if (g) {
        try {
          const s = g.info();
          const st = s && s.state !== undefined ? s.state : (typeof g.joyInfo === 'function' ? g.joyInfo().state : undefined);
          game = { state: st };
        } catch (err) { game = { error: String(err && err.message) }; }
      }
      return {
        game,
        career: career ? {
          available: career.available,
          gameId: career.gameId,
          eventCount: career.eventCount,
          finished: career.finished,
          finishCount: career.finishCount,
          dbUsable: career.dbUsable,
        } : null,
        lastFinish,
        state,
        clueDom: document.querySelectorAll('[data-career-clue]').length,
        overlayHidden: !!document.querySelector('[data-overlay]') && document.querySelector('[data-overlay]').hidden === true,
      };
    })()`);
  } catch (err) {
    return { error: String(err && err.message ? err.message : err) };
  }
}

async function check(name, fn) {
  try {
    const info = await fn();
    record(name, true, detail(info));
    return true;
  } catch (err) {
    record(name, false, detail(err && err.message ? err.message : String(err)));
    return false;
  }
}

function skip(name, reason) {
  SKIPS.push({ name, reason });
  console.log('SKIP  ' + name + ' — ' + reason);
}

/** 等待 bridge/探针就绪并（可选）清空生涯状态；返回 info()。 */
async function openCareerGame(gameId, { reset = true } = {}) {
  await cdp.navigate(gameUrl(gameId));
  await cdp.waitFor(
    '!!(window.ArcadeCareer && window.ArcadeCareer.__arcadeBridgeMounted && window.__arcadeCareerTest && window.__arcadeTest)',
    { timeout: 20000 }
  );
  await cdp.evaluate('window.__arcadeCareerTest.ready.then(() => true)');
  if (reset) {
    const resetResult = await cdp.evaluate('window.__arcadeCareerTest.resetAll()');
    assert(resetResult && resetResult.ok === true, 'resetAll 失败：' + detail(resetResult));
  }
  const info = await cdp.evaluate('window.__arcadeCareerTest.info()');
  await dismissResumePrompt();
  return info;
}

/**
 * 关闭引擎的「继续上次？」恢复弹层（点「重新开始」清理本局自动存档）。
 * 注意：部分游戏的开始弹层本来就有 data-ov-btn2（例如 merge-2048 的「挑战 6 关」），
 * 因此必须同时匹配恢复弹层文案，避免误点正常入口。
 */
async function dismissResumePrompt() {
  const resume = await cdp.evaluate(`(() => {
    const overlay = document.querySelector('[data-overlay]');
    const btn2 = document.querySelector('[data-ov-btn2]');
    const text = overlay ? String(overlay.textContent || '') : '';
    const label = btn2 ? String(btn2.textContent || '').trim() : '';
    const visible = !!(btn2 && btn2.hidden === false && btn2.offsetParent !== null);
    return { visible, label, isResume: visible && text.indexOf('继续上次') !== -1 && label === '重新开始' };
  })()`);
  if (!resume || resume.isResume !== true) return false;
  await cdp.click('[data-ov-btn2]');
  await sleep(300);
  return true;
}

const GAME_STATE_EXPR = `(() => {
  const t = window.__arcadeTest;
  if (!t) return null;
  let state = null;
  try { const s = t.info(); state = s && s.state; } catch (err) { state = null; }
  if (state === undefined && typeof t.joyInfo === 'function') {
    try { state = t.joyInfo().state; } catch (err) { state = undefined; }
  }
  return typeof state === 'string' ? state : null;
})()`;

async function gameState() {
  try {
    return await cdp.evaluate(GAME_STATE_EXPR);
  } catch (err) {
    return null;
  }
}

/** 经典局入口证据：开始按钮点击后 overlay 关闭 + 可用的游戏态（部分页不投影 state）。 */
async function classicEntryEvidence() {
  const overlay = await cdp.evaluate(`(() => {
    const ov = document.querySelector('[data-overlay]');
    return { overlayPresent: !!ov, overlayHidden: !!ov && ov.hidden === true };
  })()`);
  return { ...overlay, state: await gameState() };
}

/** 点击真实开始按钮进入经典局，等待 overlay 关闭或游戏态进入 playing/levelclear。 */
async function startClassic() {
  await cdp.waitFor(`(() => { const b = document.querySelector('[data-ov-btn]'); return !!(b && b.offsetParent !== null && b.disabled !== true); })()`, { timeout: 10000 });
  await cdp.click('[data-ov-btn]');
  await cdp.waitFor(
    `(() => {
      const ov = document.querySelector('[data-overlay]');
      const state = ${GAME_STATE_EXPR};
      return (!!ov && ov.hidden === true) || state === 'playing' || state === 'levelclear';
    })()`,
    { timeout: 12000, interval: 80 }
  );
  await sleep(120);
}

async function waitEventCount(atLeast, timeout = 10000) {
  try {
    await cdp.waitFor(`window.__arcadeCareerTest.info().eventCount >= ${atLeast}`, { timeout, interval: 60 });
  } catch (err) {
    throw new Error('等待事件数 ≥ ' + atLeast + ' 超时：' + detail(await diagnostics()));
  }
}

/** 等待游戏自然结算经 bridge 处理完成（finished 在落库/渲染结果后置位）。 */
async function waitFinished(timeout = 25000) {
  try {
    await cdp.waitFor('window.__arcadeCareerTest.info().finished === true', { timeout, interval: 90 });
  } catch (err) {
    throw new Error('等待自然结算超时：' + detail(await diagnostics()));
  }
  return cdp.evaluate('window.__arcadeCareerTest.lastFinish()');
}

/** 等待线索结果持久化（discovery 写入独立 IDB 完成），并返回 lastFinish。 */
async function waitCluePersisted(timeout = 20000) {
  try {
    await cdp.waitFor(
      '(() => { const f = window.__arcadeCareerTest.lastFinish(); return !!(f && f.result && f.result.persisted === true); })()',
      { timeout, interval: 80 }
    );
  } catch (err) {
    throw new Error('等待线索持久化超时：' + detail(await diagnostics()));
  }
  return cdp.evaluate('window.__arcadeCareerTest.lastFinish()');
}

/** 等待结算处微线索 chip 渲染（bridge 在落库完成后异步渲染，存在极短竞态）。 */
async function waitClueChip(clueId, timeout = 6000) {
  try {
    await cdp.waitFor(
      `(() => !!document.querySelector('[data-career-clue=${JSON.stringify(clueId)}]'))()`,
      { timeout, interval: 100 }
    );
    return true;
  } catch (err) {
    return false;
  }
}

async function readState() {
  return cdp.evaluate('window.__arcadeCareerTest.state()');
}

async function readEvents() {
  return cdp.evaluate('window.__arcadeCareerTest.events()');
}

async function readLastFinish() {
  return cdp.evaluate('window.__arcadeCareerTest.lastFinish()');
}

async function careerDbNames() {
  return cdp.evaluate(`(async () => {
    if (!window.indexedDB || typeof indexedDB.databases !== 'function') return null;
    const list = await indexedDB.databases();
    return list.map((item) => item.name).filter(Boolean);
  })()`);
}

/** 直接对 origin 执行 indexedDB.deleteDatabase（不依赖 bridge，可在中性页使用）。 */
async function deleteCareerDbRaw() {
  return cdp.evaluate(`new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), 4000);
    try {
      const request = indexedDB.deleteDatabase(${JSON.stringify(DB_NAME)});
      request.onsuccess = () => finish({ ok: true });
      request.onerror = () => finish({ ok: false, reason: 'error', detail: String(request.error) });
      request.onblocked = () => finish({ ok: false, reason: 'blocked' });
    } catch (err) {
      finish({ ok: false, reason: 'exception', detail: String(err && err.message) });
    }
  })`);
}

/** discovery store 行数（直接开 IDB 只读统计；库不存在时返回 0，不创建库）。 */
async function countDiscoveryRows() {
  const names = await careerDbNames();
  if (!Array.isArray(names)) return { ok: false, reason: 'indexeddb-databases-unavailable' };
  if (names.indexOf(DB_NAME) < 0) return { ok: true, count: 0, exists: false };
  return cdp.evaluate(`new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), 4000);
    try {
      const request = indexedDB.open(${JSON.stringify(DB_NAME)});
      request.onblocked = () => finish({ ok: false, reason: 'blocked' });
      request.onerror = () => finish({ ok: false, reason: 'open-error', detail: String(request.error) });
      request.onsuccess = () => {
        const db = request.result;
        try {
          if (!db.objectStoreNames.contains('discovery')) { db.close(); finish({ ok: true, count: 0 }); return; }
          const tx = db.transaction('discovery', 'readonly');
          const countRequest = tx.objectStore('discovery').count();
          countRequest.onsuccess = () => { const count = countRequest.result; db.close(); finish({ ok: true, count }); };
          countRequest.onerror = () => { db.close(); finish({ ok: false, reason: 'count-error' }); };
        } catch (err) {
          try { db.close(); } catch (closeErr) { /* ignore */ }
          finish({ ok: false, reason: 'exception', detail: String(err && err.message) });
        }
      };
    } catch (err) {
      finish({ ok: false, reason: 'exception', detail: String(err && err.message) });
    }
  })`);
}

/** 5 项经济/记录快照（career 之外既有存储的只读视图）。 */
async function economySnapshot(gameId) {
  return cdp.evaluate(`(() => {
    const A = window.Arcade;
    const gameId = ${JSON.stringify(gameId)};
    const playtime = A.Playtime.stats();
    return {
      progress: A.Progress.get(gameId),
      scores: A.Scores.list({ gameId }),
      playtime: (playtime.games || []).filter((item) => item.id === gameId),
      challenge: A.Challenge.progress(gameId),
      gameMeta: A.GameMeta.get(gameId),
    };
  })()`);
}

function economyDiff(before, after) {
  return ECONOMY_KEYS.filter((key) => !sameJson(before && before[key], after && after[key]));
}

function stageAtLeast(stage, expected) {
  return STAGE_RANK.indexOf(String(stage)) >= STAGE_RANK.indexOf(expected);
}

/* ------------------------------------------------------------------ *
 * 逐游戏真实驱动（每款：先真实开始经典局，再由 __arcadeTest 真实业务函数触发事件 + 自然结算）
 * ------------------------------------------------------------------ */

/** snake-run：吃水果（真实 stepSnake 消费分支）；吃到 20 个自然收局（won）。 */
async function snakeEat(count) {
  return cdp.evaluate(`(() => {
    const t = window.__arcadeTest;
    const out = [];
    for (let i = 0; i < ${count}; i += 1) {
      if (t.info().state !== 'playing') break;
      t.clearObstacles();
      out.push(t.eatNext());
    }
    return { results: out, foodsEaten: t.info().foodsEaten, state: t.info().state };
  })()`);
}

async function snakeFinishRun() {
  const drive = await cdp.evaluate(`(() => {
    const t = window.__arcadeTest;
    let guard = 0;
    while (t.info().state === 'playing' && guard < 40) {
      guard += 1;
      t.clearObstacles();
      t.eatNext();
    }
    return t.info();
  })()`);
  await waitFinished();
  return drive;
}

/** brick-breaker：真实 loseBall() 失球（lives 归零 → finish(false)）。 */
async function brickLoseAllBalls() {
  const drive = await cdp.evaluate(`(() => {
    const t = window.__arcadeTest;
    const out = [];
    for (let i = 0; i < 6; i += 1) {
      if (t.info().state !== 'playing') break;
      out.push(t.loseBallNow());
    }
    return { out, info: t.info() };
  })()`);
  await waitFinished(15000);
  return drive;
}

const DRIVERS = {
  /* 全部关卡通关 → finish(true)：跳过预览（真实 skipPreview）+ 逐对真实翻牌（revealById → reveal()）。 */
  'memory-flip': async () => {
    const totalLevels = await cdp.evaluate('window.__arcadeTest.info().totalLevels');
    let pairs = 0;
    for (let level = 1; level <= totalLevels; level += 1) {
      await cdp.waitFor(
        `(() => { const t = window.__arcadeTest; return t.joyInfo().state === 'playing' && t.info().level === ${level}; })()`,
        { timeout: 15000 }
      );
      await cdp.waitFor('window.__arcadeTest.skipPreviewNow() === true', { timeout: 15000, interval: 120 });
      const got = await cdp.evaluate(`(() => {
        const t = window.__arcadeTest;
        const bySymbol = {};
        t.info().cardList.forEach((card) => {
          if (!card.matched) (bySymbol[card.symbol] = bySymbol[card.symbol] || []).push(card.id);
        });
        let matched = 0;
        Object.keys(bySymbol).forEach((symbol) => {
          const ids = bySymbol[symbol];
          for (let i = 0; i + 1 < ids.length; i += 2) {
            t.revealById(ids[i]);
            t.revealById(ids[i + 1]);
            matched += 1;
          }
        });
        return matched;
      })()`);
      pairs += got;
      if (level < totalLevels) {
        await cdp.waitFor(
          `(() => { const t = window.__arcadeTest; return t.joyInfo().state === 'playing' && t.info().level === ${level + 1}; })()`,
          { timeout: 15000 }
        );
      }
    }
    await waitFinished();
    return { pairs, levels: totalLevels };
  },

  /* 真实 move() 合并 2 次；再注入满盘无解局面（既有 setBoard 夹具）走真实「棋盘满」收局。 */
  'merge-2048': async () => {
    await cdp.evaluate(`(() => {
      const t = window.__arcadeTest;
      t.setBoard([[2,2,2,2],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
      return t.moveNow('left');
    })()`);
    await waitEventCount(2);
    const mergeState = await cdp.evaluate('window.__arcadeTest.info()');
    await cdp.evaluate(`(() => {
      const t = window.__arcadeTest;
      t.setBoard([[2,4,2,4],[4,2,4,2],[2,4,2,4],[4,2,4,8]], { preserveRun: true });
      return t.moveNow('left');
    })()`);
    await waitFinished();
    return { merges: 2, scoreAfterFirstMove: mergeState.score };
  },

  /* 真实 6 手自动对局（playToEnd 走 finishHand/finishGame）。 */
  blackjack: async () => {
    const played = await cdp.evaluate(`(() => {
      const t = window.__arcadeTest;
      t.setSeed(20261122);
      return t.playToEnd();
    })()`);
    await waitFinished();
    return { played };
  },

  /* 真实整局落子（playToEnd 走 applyPlayerMove/finishGame）。 */
  gomoku: async () => {
    const played = await cdp.evaluate('window.__arcadeTest.playToEnd(12345)');
    await waitFinished();
    return { played };
  },

  /* 真实 applyMove×N + settleWin（playToEnd 走既有近胜结算路径）。 */
  solitaire: async () => {
    const played = await cdp.evaluate('window.__arcadeTest.playToEnd()');
    await waitFinished();
    return { played };
  },

  /* 真实踩铃消费分支 ×3，再真实按键走出起始雪台坠入雪夜（经典 gameOver）。 */
  snowbells: async () => {
    const hits = [];
    for (let index = 0; index < 3; index += 1) {
      hits.push(await cdp.evaluate(`window.__arcadeTest.forceHit(${index})`));
      await sleep(500);
    }
    await waitEventCount(3);
    await cdp.key('ArrowRight', 'down');
    try {
      await waitFinished(20000);
    } finally {
      await cdp.key('ArrowRight', 'up');
    }
    return { hits };
  },

  /* 真实 hitBrick 击碎 8 块（每次从最新 info 确认存活），再真实 loseBall 清空 3 条命收局。 */
  'brick-breaker': async () => {
    await cdp.evaluate('window.__arcadeTest.setLevel(1)');
    const destroyed = await cdp.evaluate(`(() => {
      const t = window.__arcadeTest;
      const alive = t.info().bricks.map((brick, index) => (brick && brick.alive ? index : -1)).filter((index) => index >= 0);
      let smashed = 0;
      for (let k = 0; k < alive.length && smashed < 8; k += 1) {
        const index = alive[k];
        for (let guard = 0; guard < 8; guard += 1) {
          const brick = t.info().bricks[index];
          if (!brick || !brick.alive) break;
          t.hitBrickNow(index);
        }
        const after = t.info().bricks[index];
        if (after && !after.alive) smashed += 1;
      }
      return smashed;
    })()`);
    await waitEventCount(8);
    const lose = await brickLoseAllBalls();
    return { destroyed, lose };
  },

  /* 真实画布点击翻转（flip()）×4，再撞障碍 ×3 收局。 */
  'gravity-flip': async () => {
    for (let i = 0; i < 4; i += 1) {
      await cdp.tap(200, 400 - i * 20);
      await sleep(260);
    }
    await waitEventCount(3);
    for (let i = 0; i < 4; i += 1) {
      if (await cdp.evaluate('window.__arcadeCareerTest.info().finished === true')) break;
      const lives = await cdp.evaluate('window.__arcadeTest.info().lives');
      await cdp.evaluate('window.__arcadeTest.forceObstacleHit()');
      await cdp.waitFor(
        `window.__arcadeTest.info().lives < ${lives} || window.__arcadeCareerTest.info().finished === true`,
        { timeout: 5000 }
      );
    }
    await waitFinished();
    return { taps: 4, obstacles: 3 };
  },

  /* 真实果实消费 ×3 + 吃到 20 个自然收局。 */
  'snake-run': async () => {
    const first = await snakeEat(3);
    await waitEventCount(3);
    const drive = await snakeFinishRun();
    return { first, drive };
  },

  /* 真实命中计分 ×5，再三颗炸弹清空生命收局。 */
  'mole-whack': async () => {
    const hits = await cdp.evaluate(`(() => {
      const t = window.__arcadeTest;
      t.clearSlots();
      const scores = [];
      for (let i = 0; i < 5; i += 1) {
        t.setSlot(0, 'mole');
        t.hitSlotNow(0);
        scores.push(t.info().score);
      }
      return { scores, hearts: t.info().hearts };
    })()`);
    await waitEventCount(5);
    const bombs = await cdp.evaluate(`(() => {
      const t = window.__arcadeTest;
      t.clearSlots();
      let guard = 0;
      while (t.info().state === 'playing' && guard < 8) {
        guard += 1;
        t.setSlot(1, 'bomb');
        t.hitSlotNow(1);
      }
      return t.info();
    })()`);
    await waitFinished();
    return { hits, bombs };
  },

  /* 真实 applyClear 消 2 行，再顶部失败收局。 */
  'block-drop': async () => {
    await cdp.evaluate('window.__arcadeTest.lineClearScenario(0)');
    await waitEventCount(1);
    await cdp.evaluate('window.__arcadeTest.lineClearScenario(0)');
    await waitEventCount(2);
    await cdp.evaluate('window.__arcadeTest.topOutScenario()');
    await waitFinished();
    return { lines: 2 };
  },

  /* 真实 killEnemy ×≥4（经典分支），再真实撞击清空生命收局。 */
  'star-raid': async () => {
    let killed = 0;
    for (let i = 0; i < 8; i += 1) {
      if (await cdp.evaluate('window.__arcadeCareerTest.info().finished === true')) break;
      killed += await cdp.evaluate(`(() => { const t = window.__arcadeTest; t.advance(2); return t.killAllEnemies(); })()`);
      const count = await cdp.evaluate('window.__arcadeCareerTest.info().eventCount');
      if (count >= 4) break;
    }
    await waitEventCount(4);
    for (let i = 0; i < 12; i += 1) {
      if (await cdp.evaluate('window.__arcadeCareerTest.info().finished === true')) break;
      const state = await cdp.evaluate('window.__arcadeTest.info().state');
      if (state !== 'playing') break;
      await cdp.evaluate(`(() => { const t = window.__arcadeTest; t.forceBodyCollision(); t.advance(2); return t.info().state; })()`);
    }
    await waitFinished();
    return { killed };
  },

  /* 真实超车 ×2，再真实碰撞 ×3 收局（碰撞后等无敌帧结束再撞；探针未暴露 invul，按帧时长等待）。 */
  'road-rush': async () => {
    const lane = await cdp.evaluate('window.__arcadeTest.info().lane');
    await cdp.evaluate('window.__arcadeTest.clearCars()');
    await cdp.evaluate(`window.__arcadeTest.spawnCarForTest(${(lane + 2) % 4}, 0.02, 0.02)`);
    await waitEventCount(1);
    await cdp.evaluate(`window.__arcadeTest.spawnCarForTest(${(lane + 3) % 4}, 0.02, 0.02)`);
    await waitEventCount(2);
    for (let i = 0; i < 6; i += 1) {
      if (await cdp.evaluate('window.__arcadeCareerTest.info().finished === true')) break;
      const lives = await cdp.evaluate('window.__arcadeTest.info().lives');
      await cdp.evaluate('window.__arcadeTest.forceCollision()');
      const changed = await cdp
        .waitFor(
          `window.__arcadeTest.info().lives < ${lives} || window.__arcadeCareerTest.info().finished === true`,
          { timeout: 2500 }
        )
        .then(() => true)
        .catch(() => false);
      if (await cdp.evaluate('window.__arcadeCareerTest.info().finished === true')) break;
      /* 未命中说明还处于 1.9s 无敌帧，等它结束后再撞。 */
      await sleep(changed ? 2000 : 2300);
    }
    await waitFinished();
    return { overtakes: 2 };
  },

  /* 真实高度闩锁：逐米抬升到 30m。落点按游戏内部 startY（H-160 = 地面平台 y - 100）计算，
     使每帧 topY 恰好跨过 1 米（careerMeters 去重后每米 1 条 height.reached）；
     再抬升相机后把玩家放回下方，走真实「坠出相机」gameOver。 */
  'shadow-leap': async () => {
    const groundY = await cdp.evaluate('window.__arcadeTest.info().platforms[0].y');
    const startY = groundY - 100; /* H = ground.y + 60，startY = H - 160 */
    for (let attempt = 0; attempt < 160; attempt += 1) {
      const meters = await cdp.evaluate('window.__arcadeTest.joyInfo().score');
      if (meters >= 30) break;
      await cdp.evaluate(`(() => {
        const t = window.__arcadeTest;
        t.setMotion(0);
        t.setPosition(210, ${startY} - 10 * (${meters} + 1) - 5);
        return t.joyInfo().score;
      })()`);
      await sleep(25);
    }
    await waitEventCount(30, 12000);
    await cdp.evaluate(`(() => { const t = window.__arcadeTest; t.setMotion(0); t.setPosition(210, 100); return true; })()`);
    await sleep(400);
    await cdp.evaluate(`(() => { const t = window.__arcadeTest; t.setMotion(0); t.setPosition(210, 700); return true; })()`);
    await waitFinished(15000);
    return { startY, meters: 30 };
  },

  /* 真实 settleDrop ×2（完美稳定层），再倾角超限坍塌 → finishRun 收局。 */
  'pendulum-tower': async () => {
    const feedback = [];
    for (let i = 0; i < 2; i += 1) {
      feedback.push(await cdp.evaluate(`window.__arcadeTest.forceSettle(${i === 0 ? 0 : 0})`));
      await sleep(250);
    }
    await waitEventCount(2);
    await cdp.evaluate('window.__arcadeTest.setLean(0.34, 5)');
    await waitFinished(20000);
    return { feedback };
  },

  /* 真实 cashIn 入库（mineral.returned），再把剩余时间压到 0.01 走真实「时间到未达标」gameOver。 */
  'gold-miner': async () => {
    await cdp.evaluate(`(() => {
      const t = window.__arcadeTest;
      t.clearItems();
      t.addGold(210, 520);
      return t.grabFirst('goldM', 300);
    })()`);
    await waitEventCount(1, 8000);
    const before = await cdp.evaluate('window.__arcadeTest.info()');
    await cdp.evaluate('window.__arcadeTest.setTimeLeft(0.01)');
    await waitFinished(12000);
    return { before };
  },
};

/* ------------------------------------------------------------------ *
 * 1 + 4. 16/16 单源可达 + 逐款零经济副作用
 * ------------------------------------------------------------------ */

async function runZeroEconomy(gameId, clue) {
  const reset = await cdp.evaluate('window.__arcadeCareerTest.resetAll()');
  assert(reset && reset.ok === true, 'career-only 前置 resetAll 失败：' + detail(reset));
  const before = await economySnapshot(gameId);
  const kind = clue.trigger.kind;
  const atLeast = Number(clue.trigger.atLeast) || 1;
  const payload = samplePayload(WATCHES, gameId);
  await cdp.evaluate(`(async () => {
    const api = window.ArcadeCareer;
    const payload = ${JSON.stringify(payload)};
    for (let i = 0; i < ${atLeast}; i += 1) api.observe(${JSON.stringify(kind)}, payload);
    await api.finish({ mode: 'classic', outcome: 'lost', stats: { careerOnlyProbe: 1 } });
    return true;
  })()`);
  const last = await waitCluePersisted(15000);
  const after = await economySnapshot(gameId);
  const diff = economyDiff(before, after);
  const state = await readState();
  assert(
    last && last.result && last.result.clueId === clue.clueId && last.result.persisted === true,
    'career-only 路径未产出预期线索：' + detail(last)
  );
  assert(!!(state.clues && state.clues[clue.clueId]), 'career-only 路径后 state.clues 缺少 ' + clue.clueId + '：' + detail(Object.keys(state.clues || {})));
  assert(
    diff.length === 0,
    'career-only 写入改变了经济快照 [' + diff.join(',') + ']：' + detail(diff.map((key) => ({ key, before: before[key], after: after[key] })))
  );
  return {
    keys: ECONOMY_KEYS.length,
    clueId: clue.clueId,
    state: 'unchanged',
  };
}

async function runReachabilityBlock(gameId) {
  const clue = CLUES.get(gameId);
  const tag = gameId;
  let info = null;
  const bootOk = await check(`${tag}: 桥可用 / 注册表 16 / 线索 16 / 独立 DB 可用 / 非静默`, async () => {
    info = await openCareerGame(gameId, { reset: true });
    assert(info && info.available === true, 'available=false：' + detail(info));
    assert(info.gameId === gameId, 'gameId=' + info.gameId + ' 期望 ' + gameId);
    assert(info.clueCount === 16 && info.cluesEnabled === true, '内容未装载：' + detail({ clueCount: info.clueCount, cluesEnabled: info.cluesEnabled }));
    assert(info.dbUsable === true, '独立 IDB 不可用（persisted 断言无法成立）：' + detail({ dbUsable: info.dbUsable, dbLoaded: info.dbLoaded, loadErrors: info.loadErrors }));
    assert(info.silentTestOnly === false && info.testMode === true, '测试钩子形态异常：' + detail({ silentTestOnly: info.silentTestOnly, testMode: info.testMode }));
    return {
      version: info.version,
      gameId: info.gameId,
      clueCount: info.clueCount,
      dbUsable: info.dbUsable,
      stateLoadedFromDb: info.stateLoadedFromDb,
    };
  });
  if (!bootOk) {
    await check(`${tag}: 无 console error / 未捕获异常`, async () => {
      const errors = cdp.errors.slice();
      assert(errors.length === 0, errors.join(' | '));
      return '0 errors';
    });
    return;
  }

  const startOk = await check(`${tag}: 经典局可开始（真实点击 [data-ov-btn]）`, async () => {
    await startClassic();
    const evidence = await classicEntryEvidence();
    /* 少数页（gold-miner）的 __arcadeTest.info() 不投影 state，此时以 overlay 已关闭为准。 */
    assert(evidence.overlayHidden === true, '开始后 overlay 未关闭：' + detail(evidence));
    assert(
      evidence.state === null || evidence.state === 'playing' || evidence.state === 'levelclear',
      '游戏态非 playing：' + detail(evidence)
    );
    return evidence;
  });
  if (!startOk) {
    await check(`${tag}: 无 console error / 未捕获异常`, async () => {
      const errors = cdp.errors.slice();
      assert(errors.length === 0, errors.join(' | '));
      return '0 errors';
    });
    return;
  }

  let drive = null;
  const driveOk = await check(`${tag}: 真实事件驱动（${clue.trigger.kind} ≥ ${clue.trigger.atLeast}）并自然结算`, async () => {
    drive = await DRIVERS[gameId]();
    const last = await readLastFinish();
    const runSummary = await cdp.evaluate('window.__arcadeCareerTest.runSummary()');
    const observed = Number(runSummary && runSummary.events && runSummary.events[clue.trigger.kind]) || 0;
    assert(observed >= Number(clue.trigger.atLeast), '结算消费事件不足：' + detail({ expected: { kind: clue.trigger.kind, atLeast: clue.trigger.atLeast }, runSummary }));
    assert(last && last.input && last.input.mode === 'classic', '结算是简洁模式异常：' + detail(last));
    return { drive, runSummary, finishInput: last && last.input };
  });
  if (!driveOk) {
    await check(`${tag}: 无 console error / 未捕获异常`, async () => {
      const errors = cdp.errors.slice();
      assert(errors.length === 0, errors.join(' | '));
      return '0 errors';
    });
    return;
  }

  const last = await readLastFinish();
  const state = await readState();
  const runSummary = await cdp.evaluate('window.__arcadeCareerTest.runSummary()');
  const clueRecord = state && state.clues ? state.clues[clue.clueId] : null;
  const observed = Number(runSummary && runSummary.events && runSummary.events[clue.trigger.kind]) || 0;

  record(
    `${tag}: 单源线索 ${clue.clueId}（reason=event / persisted）`,
    !!(last && last.result && last.result.clueId === clue.clueId && last.result.reason === 'event' && last.result.persisted === true),
    detail({
      input: last && last.input,
      result: last && last.result && { clueId: last.result.clueId, reason: last.result.reason, persisted: last.result.persisted },
      finishReason: last && last.reason,
      observedEvents: { kind: clue.trigger.kind, count: observed, atLeast: clue.trigger.atLeast },
    })
  );
  record(
    `${tag}: state.clues 出现 ${clue.clueId} / stage≥GLIMPSED / firstSourceGame`,
    !!clueRecord && stageAtLeast(state && state.stage, 'GLIMPSED') && state.firstSourceGame === gameId,
    detail({ stage: state && state.stage, clueKeys: Object.keys((state && state.clues) || {}), record: clueRecord, firstSourceGame: state && state.firstSourceGame, runs: state && state.runs })
  );

  const chipOk = await waitClueChip(clue.clueId);
  const chip = await cdp.evaluate(`(() => {
    const nodes = Array.from(document.querySelectorAll('[data-career-clue]'));
    return nodes.map((node) => ({ clueId: node.getAttribute('data-career-clue'), text: (node.textContent || '').trim().slice(0, 80) }));
  })()`);
  record(
    `${tag}: 结算处微线索 chip（[data-career-clue]）`,
    chipOk && Array.isArray(chip) && chip.some((node) => node.clueId === clue.clueId),
    detail(chip)
  );

  const zero = await check(`${tag}: 零经济副作用（career-only observe/finish 前后 5 项快照不变）`, () => runZeroEconomy(gameId, clue));

  const errors = cdp.errors.slice();
  record(`${tag}: 无 console error / 未捕获异常`, errors.length === 0, errors.join(' | '));

  PER_GAME[gameId] = {
    clueId: clue.clueId,
    trigger: { kind: clue.trigger.kind, atLeast: clue.trigger.atLeast },
    observedEvents: observed,
    finish: last && last.input ? { mode: last.input.mode, outcome: last.input.outcome } : null,
    persisted: !!(last && last.result && last.result.persisted),
    reason: last && last.result ? last.result.reason : null,
    stage: state && state.stage,
    firstSourceGame: state && state.firstSourceGame,
    chipRendered: Array.isArray(chip) && chip.some((node) => node.clueId === clue.clueId),
    zeroEconomy: zero ? 'unchanged' : 'CHECK_FAILED',
    consoleErrors: errors.length,
  };
  return { last, state, observed, zero };
}

async function runReachability() {
  console.log('\n=== 1+4. 16 源单源可达 + 零经济副作用 ===');
  const games = ONLY_SET ? GAME_IDS.filter((id) => ONLY_SET.has(id)) : GAME_IDS;
  for (const gameId of games) {
    console.log('\n--- ' + gameId + ' ---');
    try {
      await runReachabilityBlock(gameId);
    } catch (err) {
      record(`${gameId}: 段落执行`, false, detail(err && (err.stack || err.message || err)));
    }
  }
}

/* ------------------------------------------------------------------ *
 * 2. 同局最多 1 条 + 不重复记录（snake-run 真实局 + bridge finish 幂等）
 * ------------------------------------------------------------------ */

async function runStateMachineChecks() {
  console.log('\n=== 2. 同局最多 1 条 / 重复 finish 不重复记录 ===');
  let info = null;
  const bootOk = await check('状态机: snake-run 页面就绪并 resetAll', async () => {
    info = await openCareerGame('snake-run', { reset: true });
    assert(info.available === true && info.dbUsable === true, 'bridge 不可用：' + detail(info));
    const state = await readState();
    assert(Object.keys(state.clues || {}).length === 0 && Object.keys(state.runs || {}).length === 0, 'resetAll 后状态不干净：' + detail(state));
    return { gameId: info.gameId, dbUsable: info.dbUsable };
  });
  if (!bootOk) return;

  const startOk = await check('状态机: 经典局开始', async () => {
    await startClassic();
    const state = await gameState();
    assert(state === 'playing', '状态非 playing：' + detail(await diagnostics()));
    return { state };
  });
  if (!startOk) return;

  const driveOk = await check('状态机: 真实 20 果实收局只产出 1 条线索（不按事件条数重复发现）', async () => {
    await snakeEat(3);
    await waitEventCount(3);
    const drive = await snakeFinishRun();
    const last = await waitCluePersisted();
    const state = await readState();
    const rows = await countDiscoveryRows();
    const runSummary = await cdp.evaluate('window.__arcadeCareerTest.runSummary()');
    assert(last && last.result && last.result.clueId === 'CL-snake-run' && last.result.reason === 'event', '线索结果异常：' + detail(last));
    assert(Object.keys(state.clues || {}).length === 1, 'state.clues 应恰好 1 条：' + detail(state.clues));
    assert(rows.ok && rows.count === 1, 'discovery 表应恰好 1 行：' + detail(rows));
    assert(Number(runSummary.events['fruit.eaten']) >= 3 && Number(runSummary.events['fruit.eaten']) <= 20, '事件计数异常：' + detail(runSummary));
    return { foodsEaten: drive.foodsEaten, events: runSummary.events, clueRows: rows.count };
  });
  if (!driveOk) return;

  await check('状态机: 立即重复 finish（同一结算出口）被判 duplicate-settle，不新增线索/记录', async () => {
    const result = await cdp.evaluate(`(async () => {
      const api = window.ArcadeCareer;
      const input = { mode: 'classic', outcome: 'lost', stats: { score: 0, dupProbe: true } };
      const first = api.finish(input);
      const second = api.finish(input);
      await Promise.all([first, second]);
      const test = window.__arcadeCareerTest;
      return { info: test.info(), last: test.lastFinish(), state: test.state() };
    })()`);
    const rows = await countDiscoveryRows();
    assert(result && result.last && result.last.reason === 'duplicate-settle', '重复 finish 未被防抖判重：' + detail(result && result.last));
    assert(result.info.finishCount === 1, '重复 finish 不应增加结算局数：' + detail({ finishCount: result.info.finishCount }));
    assert(Object.keys(result.state.clues || {}).length === 1 && !!result.state.clues['CL-snake-run'], '线索被重复记录：' + detail(result.state.clues));
    assert(result.state.runs['snake-run'] && result.state.runs['snake-run'].eligibleRuns === 1, 'eligibleRuns 不应递增：' + detail(result.state.runs));
    assert(rows.ok && rows.count === 1, 'discovery 行数不应增加：' + detail(rows));
    return { finishCount: result.info.finishCount, duplicateReason: result.last.reason, eligibleRuns: result.state.runs['snake-run'].eligibleRuns, clueRows: rows.count };
  });

  await check('状态机: 同页第 2 局更多事件只累计 eligibleRuns，不重复发现同一线索', async () => {
    await sleep(900); /* 越过 bridge 的 800ms 防抖窗口 */
    await cdp.evaluate(`(async () => {
      const api = window.ArcadeCareer;
      for (let i = 0; i < 5; i += 1) api.observe('fruit.eaten', { foodsEaten: i + 4, golden: false });
      await api.finish({ mode: 'classic', outcome: 'lost', stats: { score: 0 } });
      return true;
    })()`);
    await sleep(300);
    const infoAfter = await cdp.evaluate('window.__arcadeCareerTest.info()');
    const state = await readState();
    const last = await readLastFinish();
    const rows = await countDiscoveryRows();
    assert(infoAfter.finishCount === 2, 'finishCount 应为 2：' + detail({ finishCount: infoAfter.finishCount }));
    assert(state.runs['snake-run'] && state.runs['snake-run'].eligibleRuns === 2, 'eligibleRuns 应为 2：' + detail(state.runs));
    assert(Object.keys(state.clues || {}).length === 1 && !!state.clues['CL-snake-run'], '线索不应重复：' + detail(state.clues));
    assert(rows.ok && rows.count === 1, 'DB discovery 行不应增加：' + detail(rows));
    assert(last && last.result === null, '第 2 局不应再产出线索：' + detail(last));
    return { finishCount: infoAfter.finishCount, eligibleRuns: 2, clueRows: rows.count, secondRunClue: null };
  });

  await check('状态机: 无 console error / 未捕获异常', async () => {
    const errors = cdp.errors.slice();
    assert(errors.length === 0, errors.join(' | '));
    return '0 errors';
  });
}

/* ------------------------------------------------------------------ *
 * 3. 3 局保底（brick-breaker 三局无事件经典局）
 * ------------------------------------------------------------------ */

async function runGuaranteeChecks() {
  console.log('\n=== 3. 3 局保底 ===');
  const gameId = 'brick-breaker';
  const clue = CLUES.get(gameId);

  const run1 = await check('保底: 第 1 局（无满足事件的经典局）无线索，eligibleRuns=1', async () => {
    const info = await openCareerGame(gameId, { reset: true });
    assert(info.available === true && info.dbUsable === true, 'bridge 不可用：' + detail(info));
    await startClassic();
    const drive = await brickLoseAllBalls();
    const last = await readLastFinish();
    const state = await readState();
    assert(drive.out.filter(Boolean).length >= 3, '真实失球次数不足：' + detail(drive));
    assert(last && last.result === null, '第 1 局不应有线索：' + detail(last));
    assert(state.runs[gameId] && state.runs[gameId].eligibleRuns === 1, 'eligibleRuns 应为 1：' + detail(state.runs));
    assert(Object.keys(state.clues || {}).length === 0, '不应已有线索：' + detail(state.clues));
    return { eligibleRuns: 1, persisted: false };
  });
  if (!run1) return;

  const run2 = await check('保底: 第 2 局从 DB 恢复计数（eligibleRuns 1→2），仍无线索', async () => {
    const info = await openCareerGame(gameId, { reset: false });
    assert(info.stateLoadedFromDb === true, '未从独立 IDB 恢复发现状态：' + detail({ stateLoadedFromDb: info.stateLoadedFromDb, dbUsable: info.dbUsable }));
    const before = await readState();
    assert(before.runs[gameId] && before.runs[gameId].eligibleRuns === 1, '恢复后 eligibleRuns 应为 1：' + detail(before.runs));
    await startClassic();
    await brickLoseAllBalls();
    const last = await readLastFinish();
    const state = await readState();
    assert(last && last.result === null, '第 2 局不应有线索：' + detail(last));
    assert(state.runs[gameId].eligibleRuns === 2, 'eligibleRuns 应为 2：' + detail(state.runs));
    assert(Object.keys(state.clues || {}).length === 0, '不应已有线索：' + detail(state.clues));
    return { restored: before.runs[gameId].eligibleRuns, eligibleRuns: 2 };
  });
  if (!run2) return;

  await check('保底: 第 3 局 reason=guarantee、线索持久化、eligibleRuns=3', async () => {
    const info = await openCareerGame(gameId, { reset: false });
    assert(info.stateLoadedFromDb === true, '未从独立 IDB 恢复发现状态：' + detail(info));
    const before = await readState();
    assert(before.runs[gameId] && before.runs[gameId].eligibleRuns === 2, '恢复后 eligibleRuns 应为 2：' + detail(before.runs));
    await startClassic();
    await brickLoseAllBalls();
    const last = await waitCluePersisted();
    const state = await readState();
    assert(last.result.clueId === clue.clueId, '保底线索 id 异常：' + detail(last.result));
    assert(last.result.reason === 'guarantee', '保底 reason 应为 guarantee：' + detail(last.result));
    assert(last.result.persisted === true, '保底线索未持久化：' + detail(last.result));
    assert(state.runs[gameId].eligibleRuns === 3, 'eligibleRuns 应为 3：' + detail(state.runs));
    assert(!!state.clues[clue.clueId] && stageAtLeast(state.stage, 'GLIMPSED'), '保底后 stage/clues 异常：' + detail({ stage: state.stage, clues: state.clues }));
    const rows = await countDiscoveryRows();
    assert(rows.ok && rows.count === 1, 'discovery 表应恰好 1 行：' + detail(rows));
    return { reason: last.result.reason, eligibleRuns: 3, stage: state.stage, clueRows: rows.count };
  });

  await check('保底: 无 console error / 未捕获异常', async () => {
    const errors = cdp.errors.slice();
    assert(errors.length === 0, errors.join(' | '));
    return '0 errors';
  });
}

/* ------------------------------------------------------------------ *
 * 5. 模式隔离（mow / zen / challenge）
 * ------------------------------------------------------------------ */

async function runModeIsolationChecks() {
  console.log('\n=== 5. 模式隔离（mow / zen / challenge） ===');
  /* 割草局开始前的经济基线：在进入 mow 之前取，退出后比对，才能真正证明「割草全程零记录写入」。 */
  let mowScoresBaseline = null;

  await check('star-raid mow: 真实击杀/Boss/受击后 0 career 事件、不 finish、无 mow sourceMode 信封', async () => {
    const info = await openCareerGame('star-raid', { reset: true });
    assert(info.available === true, 'bridge 不可用：' + detail(info));
    mowScoresBaseline = await cdp.evaluate('window.__arcadeTest.scoresInfo()');
    await cdp.evaluate('window.__arcadeTest.startMow()');
    await cdp.waitFor('window.__arcadeTest.info().mow === true', { timeout: 8000 });
    const mow = await cdp.evaluate(`(() => {
      const t = window.__arcadeTest;
      t.spawnMowPack(10);
      const killed = t.killAllEnemies();
      t.forceMowHit();
      t.advance(1);
      t.spawnBossNow();
      t.damageBoss(99999999);
      return { killed, info: t.info() };
    })()`);
    await sleep(400);
    const counts = await cdp.evaluate(`(() => {
      const test = window.__arcadeCareerTest;
      return {
        info: test.info(),
        events: test.events(),
        envelopes: test.envelopes(),
        lastFinish: test.lastFinish(),
        state: test.state(),
      };
    })()`);
    assert(mow.killed >= 1 && mow.info.mow === true, '割草局真实击杀未发生：' + detail(mow));
    assert(mow.info.score === 0, '割草局不应记分：' + detail({ score: mow.info.score }));
    assert(counts.info.eventCount === 0 && counts.events.length === 0, 'mow 产生了 career 事件：' + detail({ eventCount: counts.info.eventCount, events: counts.events }));
    assert(counts.envelopes.every((env) => env.sourceMode !== 'mow'), 'mow 信封泄漏：' + detail(counts.envelopes));
    assert(counts.info.finished === false && counts.lastFinish === null, 'mow 触发了 finish：' + detail({ finished: counts.info.finished, lastFinish: counts.lastFinish }));
    assert(Object.keys(counts.state.clues || {}).length === 0, 'mow 产生了线索：' + detail(counts.state.clues));
    return { killed: mow.killed, eventCount: counts.info.eventCount, score: mow.info.score };
  });

  await check('star-raid mow: 退出演武后仍 0 事件/无线索，scoresInfo plays/credits/积分条数不变', async () => {
    assert(mowScoresBaseline, '缺少割草前经济基线（上一步未完成）');
    await cdp.evaluate('window.__arcadeTest.quitMow()');
    await sleep(400);
    const after = await cdp.evaluate(`(() => {
      const test = window.__arcadeCareerTest;
      return {
        info: test.info(),
        events: test.events(),
        lastFinish: test.lastFinish(),
        state: test.state(),
        scores: window.__arcadeTest.scoresInfo(),
      };
    })()`);
    assert(after.info.eventCount === 0 && after.events.length === 0, '退出后存在 career 事件残留：' + detail({ eventCount: after.info.eventCount, events: after.events }));
    assert(after.lastFinish === null, '退出演武调用了 finish：' + detail(after.lastFinish));
    assert(Object.keys(after.state.clues || {}).length === 0, '退出后存在线索：' + detail(after.state.clues));
    assert(after.scores.plays === mowScoresBaseline.plays, '割草改变了 Progress.plays：' + detail({ before: mowScoresBaseline, after: after.scores }));
    assert(after.scores.credits === mowScoresBaseline.credits, '割草改变了星币：' + detail({ before: mowScoresBaseline, after: after.scores }));
    assert(after.scores.count === mowScoresBaseline.count, '割草新增了积分记录：' + detail({ before: mowScoresBaseline, after: after.scores }));
    return { before: mowScoresBaseline, plays: after.scores.plays, credits: after.scores.credits, scoreCount: after.scores.count };
  });

  await check('star-raid mow: 无 console error / 未捕获异常', async () => {
    const errors = cdp.errors.slice();
    assert(errors.length === 0, errors.join(' | '));
    return '0 errors';
  });

  await check('block-drop zen: 真实消行 0 career 事件、不 finish、未结算前经济快照不变', async () => {
    const info = await openCareerGame('block-drop', { reset: true });
    assert(info.available === true, 'bridge 不可用：' + detail(info));
    const economyBefore = await economySnapshot('block-drop');
    await cdp.evaluate('window.__arcadeTest.startZen()');
    await cdp.waitFor('window.__arcadeTest.zenInfo().mode === "zen"', { timeout: 8000 });
    await cdp.evaluate('window.__arcadeTest.zenLineClearScenario(0)');
    await cdp.waitFor('window.__arcadeTest.zenInfo().lines >= 1', { timeout: 8000 });
    const counts = await cdp.evaluate(`(() => {
      const test = window.__arcadeCareerTest;
      return { info: test.info(), events: test.events(), envelopes: test.envelopes(), lastFinish: test.lastFinish(), state: test.state(), zen: window.__arcadeTest.zenInfo() };
    })()`);
    assert(counts.zen.mode === 'zen' && counts.zen.lines >= 1, '禅模式真实消行未发生：' + detail(counts.zen));
    assert(counts.info.eventCount === 0 && counts.events.length === 0 && counts.envelopes.length === 0, 'zen 产生了 career 事件：' + detail({ eventCount: counts.info.eventCount, events: counts.events, envelopes: counts.envelopes }));
    assert(counts.info.finished === false && counts.lastFinish === null, 'zen 触发了 finish：' + detail({ finished: counts.info.finished, lastFinish: counts.lastFinish }));
    assert(Object.keys(counts.state.clues || {}).length === 0, 'zen 产生了线索：' + detail(counts.state.clues));
    const economyAfter = await economySnapshot('block-drop');
    const diff = economyDiff(economyBefore, economyAfter);
    assert(diff.length === 0, '禅模式消行（未结算）改变了记录快照：' + detail(diff.map((key) => ({ key, before: economyBefore[key], after: economyAfter[key] }))));
    return { lines: counts.zen.lines, eventCount: counts.info.eventCount, economy: 'unchanged' };
  });

  await check('block-drop zen: 收局不调用 career.finish、无 career 事件残留', async () => {
    await cdp.evaluate('window.__arcadeTest.endZen()');
    await sleep(600);
    const after = await cdp.evaluate(`(() => {
      const test = window.__arcadeCareerTest;
      return { info: test.info(), events: test.events(), lastFinish: test.lastFinish(), state: test.state(), zen: window.__arcadeTest.zenInfo() };
    })()`);
    assert(after.zen.mode !== 'playing' || after.zen.lines >= 1, '禅模式状态异常：' + detail(after.zen));
    assert(after.info.eventCount === 0 && after.events.length === 0, 'zen 收局后存在 career 事件：' + detail({ eventCount: after.info.eventCount, events: after.events }));
    assert(after.lastFinish === null && after.info.finished === false, 'zen 收局调用了 career.finish：' + detail({ lastFinish: after.lastFinish, finished: after.info.finished }));
    assert(Object.keys(after.state.clues || {}).length === 0, 'zen 收局产生线索：' + detail(after.state.clues));
    return { lastFinish: null, eventCount: 0 };
  });

  await check('block-drop zen: 无 console error / 未捕获异常', async () => {
    const errors = cdp.errors.slice();
    assert(errors.length === 0, errors.join(' | '));
    return '0 errors';
  });

  for (const gameId of ['snake-run', 'block-drop']) {
    await check(`${gameId} 挑战局: forceStageClear 后 0 career 事件/线索、不调用 career.finish`, async () => {
      const info = await openCareerGame(gameId, { reset: true });
      assert(info.available === true, 'bridge 不可用：' + detail(info));
      const ref = await cdp.evaluate('window.__arcadeTest.challengeStages()[0].id');
      await cdp.evaluate(`window.__arcadeTest.startChallenge(${JSON.stringify(ref)})`);
      await cdp.waitFor('window.__arcadeTest.challengeInfo().mode === "challenge"', { timeout: 10000 });
      const cleared = await cdp.evaluate('window.__arcadeTest.forceStageClear(false)');
      await sleep(600);
      const counts = await cdp.evaluate(`(() => {
        const test = window.__arcadeCareerTest;
        return { info: test.info(), events: test.events(), envelopes: test.envelopes(), lastFinish: test.lastFinish(), state: test.state(), challenge: window.__arcadeTest.challengeInfo() };
      })()`);
      assert(counts.challenge.mode === 'challenge' && counts.challenge.state === 'cleared', '挑战局未真实通关：' + detail({ ref, cleared, challenge: counts.challenge }));
      assert(counts.info.eventCount === 0 && counts.events.length === 0 && counts.envelopes.length === 0, '挑战局产生了 career 事件：' + detail({ eventCount: counts.info.eventCount, events: counts.events, envelopes: counts.envelopes }));
      assert(counts.info.finished === false && counts.lastFinish === null, '挑战局触发了 finish：' + detail({ finished: counts.info.finished, lastFinish: counts.lastFinish }));
      assert(Object.keys(counts.state.clues || {}).length === 0, '挑战局产生了线索：' + detail(counts.state.clues));
      return { stage: counts.challenge.stageId, challengeState: counts.challenge.state, eventCount: 0 };
    });

    await check(`${gameId} 挑战局: 无 console error / 未捕获异常`, async () => {
      const errors = cdp.errors.slice();
      assert(errors.length === 0, errors.join(' | '));
      return '0 errors';
    });
  }

  /* ---------- F-15-01 回归：挑战内真实输入不得写入 career 事件，也不得在退出后兑换经典线索 ---------- */
  await check('memory-flip 挑战内真实配对不写入 career 事件（G15 F-15-01）', async () => {
    const info = await openCareerGame('memory-flip', { reset: true });
    assert(info.available === true, 'bridge 不可用：' + detail(info));
    const ref = await cdp.evaluate('window.__arcadeTest.challengeStages()[0].id');
    await cdp.evaluate(`window.__arcadeTest.startChallenge(${JSON.stringify(ref)})`);
    await cdp.waitFor('window.__arcadeTest.challengeInfo().mode === "challenge"', { timeout: 10000 });
    const pair = await cdp.evaluate(`(() => {
      const list = window.__arcadeTest.info().cardList;
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          if (list[i].symbol === list[j].symbol && !list[i].matched && !list[j].matched) return [list[i].id, list[j].id];
        }
      }
      return null;
    })()`);
    assert(pair && pair.length === 2, '未找到可配对牌：' + detail(pair));
    await cdp.evaluate('window.__arcadeTest.skipPreviewNow()');
    await sleep(150);
    await cdp.evaluate(`window.__arcadeTest.revealById(${pair[0]})`);
    await sleep(150);
    await cdp.evaluate(`window.__arcadeTest.revealById(${pair[1]})`);
    await sleep(400);
    const counts = await cdp.evaluate(`(() => {
      const t = window.__arcadeCareerTest;
      return { info: t.info(), events: t.events(), envelopes: t.envelopes(), ch: window.__arcadeTest.challengeInfo() };
    })()`);
    assert(counts.ch.mode === 'challenge', '挑战局未处于 challenge 模式：' + detail(counts.ch));
    assert(counts.info.eventCount === 0 && counts.events.length === 0 && counts.envelopes.length === 0,
      '挑战内真实配对泄漏 career 事件：' + detail({ eventCount: counts.info.eventCount, events: counts.events, envelopes: counts.envelopes }));
    return { mode: counts.ch.mode, eventCount: 0 };
  });

  await check('memory-flip 挑战退出后经典结算不得兑换线索（G15 F-15-01 端到端）', async () => {
    const after = await cdp.evaluate(`(() => {
      const t = window.__arcadeCareerTest;
      return { state: t.state(), events: t.events() };
    })()`);
    assert(after.events.length === 0, '挑战退出前缓冲非空：' + detail(after.events));
    await cdp.evaluate('window.__arcadeTest.exitChallenge()');
    await sleep(300);
    const result = await cdp.evaluate(`(async () => {
      const r = await window.ArcadeCareer.finish({ mode: 'classic', outcome: 'lost', stats: {} });
      return { result: r ? { clueId: r.clueId, reason: r.reason } : null, state: window.__arcadeCareerTest.state() };
    })()`);
    assert(result.result === null, '挑战缓冲被经典 finish 兑换成线索：' + detail(result.result));
    assert(Object.keys(result.state.clues || {}).length === 0, '挑战后仍产生了线索：' + detail(result.state.clues));
    return { clue: null, clues: 0 };
  });

  await check('merge-2048 挑战内真实 moveNow 不写入 career 事件（G15 F-15-01）', async () => {
    const info = await openCareerGame('merge-2048', { reset: true });
    assert(info.available === true, 'bridge 不可用：' + detail(info));
    const ref = await cdp.evaluate('window.__arcadeTest.challengeStages()[0].id');
    await cdp.evaluate(`window.__arcadeTest.startChallenge(${JSON.stringify(ref)})`);
    await cdp.waitFor('window.__arcadeTest.challengeInfo().mode === "challenge"', { timeout: 10000 });
    const counts = await cdp.evaluate(`(() => {
      const dirs = ['left', 'right', 'up', 'down'];
      for (let i = 0; i < dirs.length; i += 1) {
        try { window.__arcadeTest.moveNow(dirs[i]); } catch (err) { return { error: String(err && err.message ? err.message : err) }; }
      }
      const t = window.__arcadeCareerTest;
      return { info: t.info(), events: t.events(), envelopes: t.envelopes(), ch: window.__arcadeTest.challengeInfo() };
    })()`);
    assert(!counts.error, 'moveNow 抛异常：' + detail(counts.error));
    assert(counts.ch.mode === 'challenge', '挑战局未处于 challenge 模式：' + detail(counts.ch));
    assert(counts.info.eventCount === 0 && counts.events.length === 0 && counts.envelopes.length === 0,
      '挑战内真实 moveNow 泄漏 career 事件：' + detail({ eventCount: counts.info.eventCount, events: counts.events }));
    return { mode: counts.ch.mode, eventCount: 0 };
  });

  await check('merge-2048 挑战退出后经典结算不得兑换线索（G15 F-15-01 端到端）', async () => {
    await cdp.evaluate('window.__arcadeTest.exitChallenge()');
    await sleep(300);
    const result = await cdp.evaluate(`(async () => {
      const r = await window.ArcadeCareer.finish({ mode: 'classic', outcome: 'lost', stats: {} });
      return { result: r ? { clueId: r.clueId, reason: r.reason } : null, state: window.__arcadeCareerTest.state() };
    })()`);
    assert(result.result === null, '挑战缓冲被经典 finish 兑换成线索：' + detail(result.result));
    assert(Object.keys(result.state.clues || {}).length === 0, '挑战后仍产生了线索：' + detail(result.state.clues));
    return { clue: null, clues: 0 };
  });
}

/* ------------------------------------------------------------------ *
 * 6. 禁用提示（setHintsEnabled）
 * ------------------------------------------------------------------ */

async function runHintChecks() {
  console.log('\n=== 6. 禁用提示 ===');
  const gameId = 'snake-run';
  const clue = CLUES.get(gameId);

  const off = await check('提示关闭: setHintsEnabled(false) 生效，真实事件仍被缓冲', async () => {
    const info = await openCareerGame(gameId, { reset: true });
    assert(info.available === true && info.dbUsable === true, 'bridge 不可用：' + detail(info));
    await startClassic();
    const returned = await cdp.evaluate('window.__arcadeCareerTest.setHintsEnabled(false)');
    assert(returned === false, 'setHintsEnabled(false) 返回值异常：' + detail(returned));
    const state = await readState();
    assert(state.hintsEnabled === false, 'state.hintsEnabled 应为 false：' + detail(state.hintsEnabled));
    await snakeEat(5);
    const count = await cdp.evaluate('window.__arcadeCareerTest.info().eventCount');
    assert(count >= 5, '关闭提示后真实事件未被缓冲：' + detail({ eventCount: count }));
    return { hintsEnabled: false, bufferedEvents: count };
  });
  if (!off) return;

  const closed = await check('提示关闭: 真实结算无线索，eligibleRuns 仍计数为 1', async () => {
    const drive = await snakeFinishRun();
    const last = await waitFinished();
    const state = await readState();
    assert(last && last.result === null, '关闭提示后仍产出线索：' + detail(last));
    assert(state.hintsEnabled === false, '提示开关被意外改写：' + detail(state.hintsEnabled));
    assert(Object.keys(state.clues || {}).length === 0, '关闭提示后存在线索：' + detail(state.clues));
    assert(state.runs[gameId] && state.runs[gameId].eligibleRuns === 1, 'eligibleRuns 应仍递增到 1：' + detail(state.runs));
    return { foodsEaten: drive.foodsEaten, clue: null, eligibleRuns: 1 };
  });
  if (!closed) return;

  const reopened = await check('提示重新开启: setHintsEnabled(true) 持久化，重载后恢复（eligibleRuns 保留 1）', async () => {
    const returned = await cdp.evaluate('window.__arcadeCareerTest.setHintsEnabled(true)');
    assert(returned === true, 'setHintsEnabled(true) 返回值异常：' + detail(returned));
    const info = await openCareerGame(gameId, { reset: false });
    assert(info.stateLoadedFromDb === true, '重载后未从独立 IDB 恢复状态：' + detail(info));
    const state = await readState();
    assert(state.hintsEnabled === true, '重载后 hintsEnabled 应为 true：' + detail(state.hintsEnabled));
    assert(state.runs[gameId] && state.runs[gameId].eligibleRuns === 1, '重载后 eligibleRuns 应为 1：' + detail(state.runs));
    assert(Object.keys(state.clues || {}).length === 0, '重载后不应有线索引：' + detail(state.clues));
    return { hintsEnabled: true, eligibleRuns: 1 };
  });
  if (!reopened) return;

  await check('提示重新开启: 下一局真实事件可触发线索（reason=event / eligibleRuns=2）', async () => {
    await startClassic();
    await snakeEat(5);
    await waitEventCount(5);
    await snakeFinishRun();
    const last = await waitCluePersisted();
    const state = await readState();
    assert(last.result.clueId === clue.clueId && last.result.reason === 'event' && last.result.persisted === true, '重新开启后线索结果异常：' + detail(last.result));
    assert(state.runs[gameId].eligibleRuns === 2, 'eligibleRuns 应为 2：' + detail(state.runs));
    assert(!!state.clues[clue.clueId], 'state.clues 缺少首条线索：' + detail(state.clues));
    return { clueId: clue.clueId, reason: 'event', eligibleRuns: 2 };
  });

  await check('提示开关: 无 console error / 未捕获异常', async () => {
    const errors = cdp.errors.slice();
    assert(errors.length === 0, errors.join(' | '));
    return '0 errors';
  });
}

/* ------------------------------------------------------------------ *
 * 7. bridge 静默（仅 #test，无 careerTest）
 * ------------------------------------------------------------------ */

async function runSilentBridgeChecks() {
  console.log('\n=== 7. bridge 静默（仅 #test） ===');
  const startOk = await check('静默: 前置 deleteDatabase 清空 career 库', async () => {
    await cdp.navigate(neutralUrl());
    await cdp.waitFor('document.readyState === "complete"', { timeout: 10000 });
    const deleted = await deleteCareerDbRaw();
    assert(deleted.ok === true, 'deleteDatabase 失败：' + detail(deleted));
    const names = await careerDbNames();
    assert(Array.isArray(names) && names.indexOf(DB_NAME) < 0, 'career 库仍存在：' + detail(names));
    return { deleted: true, dbs: names };
  });
  if (!startOk) return;

  const silentOk = await check('静默: 仅 #test 页面不暴露 __arcadeCareerTest / 不装载生涯 UI / 无线索 DOM', async () => {
    await cdp.navigate(gameUrl('solitaire', { careerTest: false }));
    await cdp.waitFor('!!window.__arcadeTest && !!window.ArcadeCareer', { timeout: 20000 });
    await cdp.evaluate('window.ArcadeCareer.ready.then(() => true)');
    const status = await cdp.evaluate(`(() => {
      const api = window.ArcadeCareer;
      const info = api && typeof api.info === 'function' ? api.info() : null;
      return {
        testApiType: typeof window.__arcadeCareerTest,
        silentTestOnly: info ? info.silentTestOnly : null,
        available: info ? info.available : null,
        reason: info ? info.reason : null,
        uiNamespace: typeof window.ArcadeCareerUI,
        clueDom: document.querySelectorAll('[data-career-clue]').length,
      };
    })()`);
    assert(status.testApiType === 'undefined', '__arcadeCareerTest 泄漏：' + detail(status));
    assert(status.silentTestOnly === true && status.available === false, '静默标记异常：' + detail(status));
    assert(status.uiNamespace === 'undefined', '静默页装载了生涯 UI 命名空间：' + detail(status));
    assert(status.clueDom === 0, '静默页存在 career DOM：' + detail(status));
    return status;
  });
  if (!silentOk) return;

  const probeOk = await check('静默: 既有 __arcadeTest 探针仍可用（solitaire 真实 playToEnd + selftest）', async () => {
    await cdp.waitFor(`(() => { const b = document.querySelector('[data-ov-btn]'); return !!(b && b.offsetParent !== null); })()`, { timeout: 10000 });
    await cdp.click('[data-ov-btn]');
    await cdp.waitFor(`window.__arcadeTest.info().state === 'playing'`, { timeout: 10000 });
    const played = await cdp.evaluate('window.__arcadeTest.playToEnd()');
    assert(played && played.ok === true && played.recorded === true, 'playToEnd 失败：' + detail(played));
    const selftest = await cdp.evaluate('window.__arcadeTest.selftest()');
    assert(selftest && selftest.fail === 0, 'selftest 有失败项：' + detail(selftest));
    return { played: { ok: played.ok, recorded: played.recorded }, selftest: { pass: selftest.pass, fail: selftest.fail } };
  });
  if (!probeOk) return;

  await check('静默: 静默结算后仍无测试钩子 / 无线索 DOM / 未创建 career IDB', async () => {
    await sleep(1200);
    const status = await cdp.evaluate(`(() => ({
      testApiType: typeof window.__arcadeCareerTest,
      clueDom: document.querySelectorAll('[data-career-clue]').length,
      lastFinishReason: window.ArcadeCareer && window.ArcadeCareer.info ? 'silent' : null,
    }))()`);
    const names = await careerDbNames();
    assert(status.testApiType === 'undefined', '__arcadeCareerTest 在静默结算后出现：' + detail(status));
    assert(status.clueDom === 0, '静默结算渲染了 career DOM：' + detail(status));
    assert(Array.isArray(names) && names.indexOf(DB_NAME) < 0, '静默页创建/写入了 career IDB：' + detail(names));
    return { dbs: names, clueDom: 0, testApi: 'undefined' };
  });

  await check('静默: 无 console error / 未捕获异常', async () => {
    const errors = cdp.errors.slice();
    assert(errors.length === 0, errors.join(' | '));
    return '0 errors';
  });
}

/* ------------------------------------------------------------------ *
 * 8. 测试隔离收尾
 * ------------------------------------------------------------------ */

async function runIsolationStart() {
  console.log('\n=== 8. 测试隔离（起始） ===');
  await check('隔离: 起始 deleteDatabase 后 studiokit:arcade:career 不存在', async () => {
    await cdp.navigate(neutralUrl());
    await cdp.waitFor('document.readyState === "complete"', { timeout: 10000 });
    const deleted = await deleteCareerDbRaw();
    assert(deleted.ok === true, 'deleteDatabase 失败：' + detail(deleted));
    const names = await careerDbNames();
    assert(Array.isArray(names), 'indexedDB.databases 不可用：' + detail(names));
    assert(names.indexOf(DB_NAME) < 0, '起始仍存在 career 库：' + detail(names));
    return { dbs: names };
  });
}

async function runIsolationEnd() {
  console.log('\n=== 8. 测试隔离（结束） ===');
  await check('隔离: 结束时中性页无残留 career DOM，deleteDatabase 成功且库不存在', async () => {
    await cdp.navigate(neutralUrl());
    await cdp.waitFor('document.readyState === "complete"', { timeout: 10000 });
    const dom = await cdp.evaluate(`(() => ({
      clue: document.querySelectorAll('[data-career-clue]').length,
      mailbox: document.querySelectorAll('[data-career-mailbox]').length,
      settings: document.querySelectorAll('[data-career-settings]').length,
      anyCareer: document.querySelectorAll('[data-career-clue],[data-career-mailbox],[data-career-settings],[data-career-panel]').length,
    }))()`);
    assert(dom.anyCareer === 0 && dom.clue === 0, '结束时存在残留 career DOM：' + detail(dom));
    const deleted = await deleteCareerDbRaw();
    assert(deleted.ok === true, '结束时 deleteDatabase 失败：' + detail(deleted));
    const names = await careerDbNames();
    assert(Array.isArray(names) && names.indexOf(DB_NAME) < 0, '结束时 career 库仍存在：' + detail(names));
    return { dom, dbs: names };
  });
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main() {
  console.log('Arcade Life 0.15 · 16 源微线索可达自动回归（D15-16）');
  console.log('repo=' + REPO_ROOT + '  port=' + HTTP_PORT + '  cdp=' + CDP_PORT + (DEV_ONLY ? '  only=' + ONLY.join(',') : ''));

  /* 内容源缺失/不一致属于装配失败（exit 2），不当作游戏回归失败。 */
  GAME_IDS.forEach((id) => {
    const clue = CLUES.get(id);
    if (!clue || !clue.trigger || typeof clue.trigger.kind !== 'string' || !(Number(clue.trigger.atLeast) > 0)) {
      throw new Error('线索触发配置不完整：' + id);
    }
    if (!DRIVERS[id]) throw new Error('缺少游戏驱动实现：' + id);
  });

  let hardFailure = false;
  try {
    server = await startServer({ root: REPO_ROOT, port: HTTP_PORT });
    launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'studiokit-career-games-', windowSize: '420,900' });
    cdp = await openPage({ port: CDP_PORT, ...VIEWPORT, deviceScaleFactor: 1, mobile: true });
    await cdp.navigate(neutralUrl());
    await cdp.waitFor('document.readyState === "complete"', { timeout: 15000 });
    const arcadeReady = await cdp.evaluate('!!window.Arcade');
    if (!arcadeReady) throw new Error('apps/arcade/index.html 未加载 Arcade 运行时');

    if (DEV_ONLY) {
      console.log('NOTE  --only 开发模式：仅驱动 ' + ONLY.join(',') + '，跳过全局段落（状态机/保底/模式/提示/静默/隔离收尾）');
    } else {
      await runIsolationStart();
      await runSilentBridgeChecks();
    }
    await runReachability();
    if (!DEV_ONLY) {
      await runStateMachineChecks();
      await runGuaranteeChecks();
      await runModeIsolationChecks();
      await runHintChecks();
      await runIsolationEnd();
    }

    const passedGames = Object.keys(PER_GAME).filter((id) => PER_GAME[id].persisted && PER_GAME[id].reason === 'event' && PER_GAME[id].zeroEconomy === 'unchanged');
    const expectedGames = DEV_ONLY ? ONLY.length : 16;
    record(
      '16 源可达覆盖率（真实 PASS 款数 ≥ 14，且每款零经济快照不变）',
      passedGames.length >= Math.min(14, expectedGames) && passedGames.length === expectedGames,
      'passedGames=' + passedGames.length + ' expectedGames=' + expectedGames + ' failedGames=' + Object.keys(PER_GAME).filter((id) => passedGames.indexOf(id) < 0)
    );
    console.log('\n--- per-game ---');
    console.log(JSON.stringify(PER_GAME, null, 2));
  } catch (err) {
    hardFailure = true;
    console.error('FAIL  环境/装配失败：' + (err && err.stack ? err.stack : err));
  } finally {
    try {
      if (cdp) cdp.close();
    } catch (err) {
      /* ignore */
    }
    if (launched) await stopChrome(launched);
    if (server) await new Promise((resolve) => server.close(resolve));
  }

  const stats = summary('D15-16 checks');
  if (SKIPS.length) {
    console.log('SKIPPED ' + SKIPS.length + ' 项：');
    SKIPS.forEach((item) => console.log('  - ' + item.name + '：' + item.reason));
  }
  console.log('SUMMARY total=' + stats.total + ' passed=' + stats.passed + ' failed=' + stats.failed + ' skipped=' + SKIPS.length);
  if (hardFailure) {
    console.log('0/0 checks passed（装配未完成）');
    return 2;
  }
  return stats.failed ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('FAIL  ' + (err && err.stack ? err.stack : err));
    process.exit(2);
  });
