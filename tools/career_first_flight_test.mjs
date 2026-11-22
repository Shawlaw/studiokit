#!/usr/bin/env node
/**
 * StudioKit Arcade Life 0.16 — D16-12 真实经济闭环与机体效果 E2E
 *
 * 目标：用**真实 Chrome + 真实 IndexedDB + 真实游戏输入/事件**验证 0.16「First Flight」
 * 的经济闭环，而不是断言内存假数据。测试不修改任何产品文件，只读取真实运行结果。
 *
 * 覆盖场景：
 *  1. 16 起源可达 first flight：静态断言 chapter-01.json 16 origins ↔ registry 16 gameId
 *     一一对应、每条都有可执行 firstStep；运行时抽样 8 个不同起源（含 memory-flip /
 *     merge-2048 / blackjack / road-rush / gomoku / solitaire / snowbells / gold-miner）
 *     seed discovery 到 LOCAL → 真实开信箱 → 「按地址投递 · 去港口」→ openTown() →
 *     告示板可用（2 条 C1 T1 可接 + 钱包行来自 DB）。
 *  2. 工作→买机→星海→战利品（真实链路）：层塔 T1 真实 4 层结算（70 + alloy1）→ T2 真实
 *     6 层结算（110 + objectiveBonus 10 = 120，以 bridge 返回为准）→ 机库真实按钮购买旧翼
 *     260（真实 purchase 事务、装备 `ship:old-wing:owned`、流水 1 条）→ 星海 T1 真实击破
 *     boss → 收据 90 + alloy1 → 钱包/材料/流水/收据 UI 全部来自 DB。
 *  3. 租用路线（不打工）：新 career 清库 → 不接施工委托、零收入 → 免费租机 prepareCommission
 *     → 星海 T1 结算 90 + alloy；断言租用零扣费、未获得飞船所有权、失败不丢装备。
 *  4. 失败路线：层塔只稳 1 层 → {ok:false, reason:'objective-not-met'}、钱包/材料/装备零变化；
 *     再正常 T1 成功，证明失败不阻断后续。
 *  5. 非战斗代办：alternatives.buy({offerId:'alt.courier'})（先用 T1 收入凑够 120）→ 扣 120、
 *     quest 行 C1.signal、无战斗旗标、无虚假奖章、钱包只减不增。
 *  6. 机体效果可见：真实购买云雀（480 + alloy1）→ 真实换上 → 星海 T1 断言 careerBattle.stats
 *     体现 firepower/speed 提升；经典机库数值（无 ?career 快照）不受影响。
 *  全程 console error = 0；结束时 deleteDatabase；所有关键步骤输出 SNAPSHOT 供证据引用。
 *
 * 用法（仓库根目录）：
 *   node tools/career_first_flight_test.mjs              # 全量（真实 Chrome + IDB）
 *   node tools/career_first_flight_test.mjs --static-only # 只跑静态断言（无 Chrome，秒级）
 *   node tools/career_first_flight_test.mjs --help
 *
 * 端口（可用环境变量覆盖，避免并行任务串端口）：
 *   CAREER_FF_PORT  静态服务器端口，默认 8881
 *   CAREER_FF_CDP   Chrome DevTools 端口，默认 9481
 *   CHROME_PATH     本机 Chrome 路径（默认 Windows Chrome 安装路径）
 *
 * 退出码：
 *   0  全部检查通过
 *   1  存在失败检查（含场景中断）或测试自身发现的缺陷
 *   2  用法错误 / 环境不可用（Chrome 缺失、端口占用、参数非法）
 *
 * 说明（不伪造）：
 * - 测试只调用真实产品入口：信箱「去港口」按钮、告示板「接单」按钮、机库「登记这架 / 换上这架」、
 *   游戏页真实开局与 boss 击破、bridge/commission-core/rental/alternatives 的公开 API；
 * - 游戏输入使用页面自带的 `?careerTest=1#test` 只读/驱动钩子（真实 releaseBox 物理松手、
 *   真实 settlement 提交点、真实 boss 状态机），不直接写余额、不伪造 claim/收据；
 * - 唯一的“测试侧写入”是 discovery 状态的 `seedState`（任务允许），用于把线索推进到 LOCAL。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT,
  DEFAULT_CHROME,
  envPort,
  startServer,
  launchChrome,
  stopChrome,
  openPage,
  sleep,
  createRecorder,
} from './lib/arcade_cdp.mjs';

/* ------------------------------------------------------------------ *
 * 常量与全局状态
 * ------------------------------------------------------------------ */

const DB_NAME = 'studiokit:arcade:career';
const TICKET_KEY = 'studiokit:arcade:career:ticket.v1';
const RENTAL_KEY = 'studiokit:arcade:career:rental.v1';
const CHAPTER_REL = 'apps/arcade/career/content/chapter-01.json';
const CLUES_REL = 'apps/arcade/career/content/clues.json';
const REGISTRY_REL = 'apps/arcade/career/content/registry.json';
const COMMISSIONS_REL = 'apps/arcade/career/content/commissions.json';
const ITEMS_REL = 'apps/arcade/career/content/items.json';
const GAMES_DIR_REL = 'apps/arcade/games';

const P = (value) => JSON.stringify(value);

const state = {
  step: 'init',
  rec: null,
  errors: [],
  snapshots: [],
  coverage: {
    originsStatic: 0,
    originsRuntime: [],
    chains: [],
  },
  defects: [],
  gaps: [],
  server: null,
  launched: null,
  cdp: null,
  base: '',
};

class InfraError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InfraError';
  }
}

class StepError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StepError';
  }
}

function step(name) {
  state.step = name;
}

function ensure(condition, message) {
  if (!condition) throw new StepError(message);
}

function expectTrue(name, value, detail) {
  state.rec.record(name, !!value, value ? '' : detail ? String(detail).slice(0, 700) : '');
  return !!value;
}

function expectEq(name, actual, expected) {
  const ok = P(actual) === P(expected);
  state.rec.record(name, ok, ok ? '' : 'expected ' + P(expected) + ' · actual ' + P(actual));
  return ok;
}

function expectNum(name, actual, expected, tolerance) {
  const tol = Number.isFinite(tolerance) ? tolerance : 0;
  const ok = Number.isFinite(Number(actual)) && Math.abs(Number(actual) - Number(expected)) <= tol;
  state.rec.record(name, ok, ok ? '' : 'expected ' + expected + (tol ? '±' + tol : '') + ' · actual ' + P(actual));
  return ok;
}

function readJson(relPath) {
  const abs = path.join(REPO_ROOT, relPath);
  const raw = fs.readFileSync(abs, 'utf8');
  return JSON.parse(raw);
}

function countBy(rows, key) {
  const out = {};
  (rows || []).forEach((row) => {
    const value = String(row && row[key] !== undefined ? row[key] : 'unknown');
    out[value] = (out[value] || 0) + 1;
  });
  return out;
}

function sumCredits(rows) {
  return (rows || []).reduce((sum, row) => sum + (Number(row && row.credits) || 0), 0);
}

function uniqueList(list) {
  return Array.from(new Set((list || []).filter((item) => typeof item === 'string' && item)));
}

/* ------------------------------------------------------------------ *
 * 静态内容（只读）
 * ------------------------------------------------------------------ */

function loadContent() {
  return {
    chapter: readJson(CHAPTER_REL),
    clues: readJson(CLUES_REL),
    registry: readJson(REGISTRY_REL),
    commissions: readJson(COMMISSIONS_REL),
    items: readJson(ITEMS_REL),
  };
}

/* ------------------------------------------------------------------ *
 * 场景一：静态断言（16 起源 / 委托 / 物品 / 页面存在）
 * ------------------------------------------------------------------ */

function runStaticChecks(rec, content) {
  const { chapter, clues, registry, commissions, items } = content;
  const origins = Array.isArray(chapter.origins) ? chapter.origins : [];
  const games = Array.isArray(registry.games) ? registry.games : [];
  const clueList = Array.isArray(clues.clues) ? clues.clues : [];
  const clueByGame = new Map(clueList.map((clue) => [clue.gameId, clue]));
  const gameById = new Map(games.map((game) => [game.gameId, game]));

  /* S01：chapter-01 版本与规模 */
  expectEq('S01 chapter-01 contentVersion=0.17.0 / chapterId=C1 / 16 origins', {
    contentVersion: chapter.contentVersion,
    chapterId: chapter.chapterId,
    origins: origins.length,
  }, { contentVersion: '0.17.0', chapterId: 'C1', origins: 16 });
  state.coverage.originsStatic = origins.length;

  /* S02：origin gameId 与 registry gameId 一一对应 */
  const originIds = uniqueList(origins.map((origin) => origin.gameId));
  const registryIds = uniqueList(games.map((game) => game.gameId));
  const sameSet =
    originIds.length === origins.length &&
    registryIds.length === games.length &&
    originIds.length === registryIds.length &&
    originIds.every((id) => registryIds.indexOf(id) >= 0);
  expectTrue('S02 origin gameIds ↔ registry gameIds one-to-one (16/16)', sameSet && originIds.length === 16, P({
    origins: originIds,
    registry: registryIds,
  }));

  /* S03：professionId 与 registry professions 对齐 */
  const profMismatch = origins.filter((origin) => {
    const game = gameById.get(origin.gameId);
    const professions = game && Array.isArray(game.professions) ? game.professions : [];
    return !game || professions.indexOf(origin.professionId) < 0;
  }).map((origin) => origin.gameId);
  expectEq('S03 every origin professionId matches registry game professions', profMismatch, []);

  /* S04：opening / c0Letter 字段完整 */
  const badLetters = origins.filter((origin) => {
    const letter = origin.c0Letter;
    return (
      typeof origin.opening !== 'string' ||
      origin.opening.trim().length < 6 ||
      !letter ||
      typeof letter.from !== 'string' ||
      !letter.from.trim() ||
      typeof letter.body !== 'string' ||
      letter.body.trim().length < 20 ||
      typeof letter.address !== 'string' ||
      !letter.address.trim()
    );
  }).map((origin) => origin.gameId);
  expectEq('S04 every origin has opening + c0Letter(from/body/address)', badLetters, []);

  /* S05：每条 origin 都有可执行 firstStep（写明第一步动作，指向港口告示板） */
  const badSteps = origins.filter((origin) => {
    const text = typeof origin.firstStep === 'string' ? origin.firstStep.trim() : '';
    return text.length < 10 || text.indexOf('告示板') < 0;
  }).map((origin) => origin.gameId);
  expectEq('S05 every origin firstStep is executable and points at the port board', badSteps, []);

  /* S06：起源 → 线索 → registry clueRef 对齐 */
  const badClues = origins.filter((origin) => {
    const game = gameById.get(origin.gameId);
    const clue = clueByGame.get(origin.gameId);
    return !game || !clue || game.clueRef !== clue.clueId || clue.gameId !== origin.gameId;
  }).map((origin) => origin.gameId);
  expectEq('S06 origin ↔ clue ↔ registry.clueRef align for all 16', badClues, []);

  /* S07：C0 信件地址与线索地址一致，且 16 个地址互不相同（起源独立） */
  const addressMismatch = origins.filter((origin) => {
    const clue = clueByGame.get(origin.gameId);
    return !clue || !clue.letter || clue.letter.address !== origin.c0Letter.address;
  }).map((origin) => origin.gameId);
  const addresses = origins.map((origin) => origin.c0Letter.address);
  expectEq('S07 C0 letter address equals clue address for all 16', addressMismatch, []);
  expectTrue('S07b all 16 origin addresses are unique', uniqueList(addresses).length === 16, P(uniqueList(addresses).length));

  /* S08：线索触发 kind 属于 registry watch kinds */
  const badTriggers = origins.filter((origin) => {
    const game = gameById.get(origin.gameId);
    const clue = clueByGame.get(origin.gameId);
    const watchKinds = game && Array.isArray(game.watch) ? game.watch.map((row) => row && row.kind).filter(Boolean) : [];
    const triggerKind = clue && clue.trigger ? clue.trigger.kind : null;
    return !triggerKind || watchKinds.indexOf(triggerKind) < 0;
  }).map((origin) => origin.gameId);
  expectEq('S08 clue trigger kind belongs to registry watch kinds', badTriggers, []);

  /* S09：C1 三条路径（work / rental / procurement）都要求 C1.signal */
  const c1 = chapter.c1 || {};
  const paths = Array.isArray(c1.paths) ? c1.paths : [];
  const pathIds = paths.map((row) => row.pathId);
  const badPaths = paths.filter((row) => !Array.isArray(row.requires) || row.requires.indexOf('C1.signal') < 0);
  expectEq('S09 C1 has 3 paths each gated by C1.signal', { pathIds, bad: badPaths.map((row) => row.pathId) }, {
    pathIds: ['work', 'rental', 'procurement'],
    bad: [],
  });

  /* S10：C1 beats / signal 定义 */
  const beats = Array.isArray(c1.beats) ? c1.beats : [];
  const beatIds = beats.map((beat) => beat.beatId);
  const badBeats = beats.filter((beat) => !beat.letter || !beat.letter.body || !beat.letter.address);
  expectTrue('S10 C1 beats contain arrive/signal/follow with letters; C1.signal defined', (
    beatIds.indexOf('C1.arrive') >= 0 &&
    beatIds.indexOf('C1.signal') >= 0 &&
    beatIds.indexOf('C1.follow') >= 0 &&
    badBeats.length === 0 &&
    Array.isArray(c1.signals) &&
    c1.signals.some((row) => row && row.flag === 'C1.signal')
  ), P({ beatIds, badBeats: badBeats.map((beat) => beat.beatId) }));

  /* S11：commissions.json 4 条 T1/T2 委托 */
  const commissionList = Array.isArray(commissions.commissions) ? commissions.commissions : [];
  const commissionIds = commissionList.map((row) => row.commissionId);
  expectEq('S11 commissions.json contentVersion=0.17.0 and 4 T1/T2 commissions', {
    contentVersion: commissions.contentVersion,
    ids: commissionIds,
  }, {
    contentVersion: '0.17.0',
    ids: ['pendulum-tower.T1', 'pendulum-tower.T2', 'star-raid.T1', 'star-raid.T2'],
  });

  /* S12：层塔目标 4/6 层 + T2 objectiveBonus 10 */
  const towerT1 = commissionList.find((row) => row.commissionId === 'pendulum-tower.T1') || {};
  const towerT2 = commissionList.find((row) => row.commissionId === 'pendulum-tower.T2') || {};
  expectEq('S12 tower objectives 4/6 floors, T2 objectiveBonus=10', {
    t1: towerT1.objective,
    t2: towerT2.objective,
    bonus: towerT2.objectiveBonus,
  }, {
    t1: { kind: 'tower.floor_stable', atLeast: 4, context: {} },
    t2: { kind: 'tower.floor_stable', atLeast: 6, context: {} },
    bonus: 10,
  });

  /* S13：星海 T1/T2 目标上下文（level / level+storm）+ T2 objectiveBonus 15 + startParams */
  const starT1 = commissionList.find((row) => row.commissionId === 'star-raid.T1') || {};
  const starT2 = commissionList.find((row) => row.commissionId === 'star-raid.T2') || {};
  expectEq('S13 star objectives (level 1 / level 3 + storm), T2 bonus 15, startParams', {
    t1: starT1.objective,
    t2: starT2.objective,
    bonus: starT2.objectiveBonus,
    startParams: starT2.startParams,
  }, {
    t1: { kind: 'boss.defeated', atLeast: 1, context: { level: 1 } },
    t2: { kind: 'boss.defeated', atLeast: 1, context: { level: 3, theme: 'storm' } },
    bonus: 15,
    startParams: { startLevel: 3, themeId: 'storm' },
  });

  /* S14：四条委托的报酬与证据/旗标 */
  const rewardTable = commissionList.map((row) => ({
    id: row.commissionId,
    credits: row.reward && row.reward.credits,
    items: row.reward && row.reward.items,
    repeat: row.repeatSalaryCredits,
    flags: row.reward && row.reward.flags,
  }));
  expectEq('S14 reward table matches 0.16 content (credits/items/repeat/flags)', rewardTable, [
    { id: 'pendulum-tower.T1', credits: 70, items: { alloy: 1 }, repeat: 25, flags: ['C1.work_done'] },
    { id: 'pendulum-tower.T2', credits: 110, items: { alloy: 2 }, repeat: 35, flags: ['C1.foreman'] },
    { id: 'star-raid.T1', credits: 90, items: { alloy: 1 }, repeat: 30, flags: ['C1.flight_done'] },
    { id: 'star-raid.T2', credits: 130, items: { alloy: 2, crystal: 1 }, repeat: 40, flags: ['C1.storm_done'] },
  ]);

  /* S15：items.json 飞船/材料定价与云雀数值 */
  const ships = Array.isArray(items.ships) ? items.ships : [];
  const prices = {};
  ships.forEach((ship) => {
    prices[ship.shipId] = ship.price;
  });
  const oldWing = ships.find((ship) => ship.shipId === 'old-wing') || {};
  const cloudLark = ships.find((ship) => ship.shipId === 'cloud-lark') || {};
  expectEq('S15 items.json prices / rental flag / cloud-lark stats & material gate', {
    contentVersion: items.contentVersion,
    shipIds: ships.map((ship) => ship.shipId),
    prices,
    oldWingRental: oldWing.rental,
    cloudLarkStats: cloudLark.stats,
    cloudLarkRequires: cloudLark.requires,
    materials: (items.materials || []).map((row) => row.itemId),
  }, {
    contentVersion: '0.17.0',
    shipIds: ['old-wing', 'cloud-lark', 'shield-whale', 'prism'],
    prices: { 'old-wing': 260, 'cloud-lark': 480, 'shield-whale': 520, prism: 540 },
    oldWingRental: true,
    cloudLarkStats: { lives: 3, energy: 95, firepower: 0.06, speed: 0.12, magnet: 0.06 },
    cloudLarkRequires: { alloy: 1 },
    materials: ['alloy', 'crystal'],
  });

  /* S16：16 个游戏页都存在且装载 bridge（16 源都可以成为 first flight 起点） */
  const missingPages = [];
  const missingBridge = [];
  registryIds.forEach((gameId) => {
    const abs = path.join(REPO_ROOT, GAMES_DIR_REL, gameId + '.html');
    if (!fs.existsSync(abs)) {
      missingPages.push(gameId);
      return;
    }
    const html = fs.readFileSync(abs, 'utf8');
    if (html.indexOf('career/bridge.js') < 0) missingBridge.push(gameId);
  });
  expectEq('S16 all 16 game pages exist and load career/bridge.js', { missingPages, missingBridge }, {
    missingPages: [],
    missingBridge: [],
  });

  /* S17：可玩两种职业模式（层塔/星海）页面暴露 careerTest 钩子 */
  const hookPages = ['pendulum-tower', 'star-raid'].filter((gameId) => {
    const html = fs.readFileSync(path.join(REPO_ROOT, GAMES_DIR_REL, gameId + '.html'), 'utf8');
    return html.indexOf('careerTest=1') >= 0 && html.indexOf('careerInfo') >= 0;
  });
  expectEq('S17 tower & star pages expose ?careerTest=1 career read-only hooks', hookPages, ['pendulum-tower', 'star-raid']);

  /* S18：registry 16 款都标记可发现（首源线索可产出） */
  const notDiscoverable = games.filter((game) => game.discoverable !== true || !game.clueRef).map((game) => game.gameId);
  expectEq('S18 registry marks all 16 games discoverable with clueRef', notDiscoverable, []);
}

/* ------------------------------------------------------------------ *
 * 运行时通用工具（真实 Chrome / IDB）
 * ------------------------------------------------------------------ */

async function flushConsole(cdp, label) {
  const errors = cdp.errors.slice();
  cdp.errors.length = 0;
  if (errors.length) {
    state.errors.push({ label, errors });
    state.rec.record('ERR console errors [' + label + ']', false, P(errors).slice(0, 700));
  }
  return errors;
}

async function go(cdp, url, label) {
  await flushConsole(cdp, label + ' (before navigate)');
  await cdp.navigate(url);
}

async function waitBridge(cdp) {
  await cdp.waitFor('!!(window.ArcadeCareer && window.ArcadeCareer.ready)', { timeout: 15000 });
  const ready = await cdp.evaluate('window.ArcadeCareer.ready.then(function (r) { return { available: !!(r && r.available), reason: (r && r.reason) || null }; })');
  await cdp.waitFor('!!window.__arcadeCareerTest', { timeout: 8000 });
  return ready;
}

async function waitGameHooks(cdp) {
  await cdp.waitFor('!!window.__arcadeTest', { timeout: 10000 });
}

async function deleteDatabase(cdp, label) {
  step('reset-db:' + label);
  await go(cdp, state.base + '/apps/arcade/index.html', 'db-reset:' + label);
  const result = await cdp.evaluate(
    'new Promise(function (resolve) {' +
      '  var settled = false;' +
      '  function done(value) { if (!settled) { settled = true; resolve(value); } }' +
      '  var request = null;' +
      '  try { request = indexedDB.deleteDatabase(' + P(DB_NAME) + '); } catch (err) { done({ ok: false, error: String(err) }); return; }' +
      '  request.onsuccess = function () { done({ ok: true }); };' +
      '  request.onerror = function () { done({ ok: false, error: String(request.error && request.error.name) }); };' +
      '  request.onblocked = function () { done({ ok: false, blocked: true }); };' +
      '  setTimeout(function () { done({ ok: false, timeout: true }); }, 6000);' +
      '})'
  );
  expectTrue('G-DB reset [' + label + ']', result && result.ok === true, P(result));
  if (!result || result.ok !== true) {
    await sleep(400);
    /* 保守重试一次（不重复计数） */
    await go(cdp, state.base + '/apps/arcade/index.html', 'db-reset-retry:' + label);
    await cdp.evaluate(
      'new Promise(function (resolve) {' +
        '  var request = indexedDB.deleteDatabase(' + P(DB_NAME) + ');' +
        '  request.onsuccess = function () { resolve(1); };' +
        '  request.onerror = function () { resolve(0); };' +
        '  request.onblocked = function () { resolve(-1); };' +
        '  setTimeout(function () { resolve(-2); }, 6000);' +
        '})'
    );
  }
  return result;
}

async function seedLocal(cdp, gameId, clueId) {
  step('seed:' + gameId);
  const payload = {
    stage: 'LOCAL',
    firstClueId: clueId,
    firstSourceGame: gameId,
    clues: {},
  };
  payload.clues[clueId] = { clueId: clueId, sourceGame: gameId, seenAt: new Date().toISOString() };
  return cdp.evaluate('window.__arcadeCareerTest.seedState(' + P(payload) + ')');
}

async function mailboxSnapshot(cdp) {
  return cdp.evaluate(
    '(() => {' +
      '  var panel = document.querySelector(\'[data-career-panel="mailbox"]\');' +
      '  if (!panel) return null;' +
      '  var townButton = panel.querySelector(\'[data-action="open-town"]\');' +
      '  var addressNode = panel.querySelector(".ac-career-letter__address");' +
      '  var bodyNode = panel.querySelector(".ac-career-letter__body");' +
      '  var senderNode = panel.querySelector(".ac-career-letter__sender");' +
      '  var originNode = panel.querySelector(".ac-career-mailbox__origin");' +
      '  return {' +
      '    present: true,' +
      '    townButton: !!townButton,' +
      '    townButtonHidden: townButton ? !!townButton.hidden : null,' +
      '    townButtonText: townButton ? townButton.textContent : null,' +
      '    address: addressNode ? addressNode.textContent : null,' +
      '    sender: senderNode ? senderNode.textContent : null,' +
      '    body: bodyNode ? bodyNode.textContent : null,' +
      '    originLine: originNode && !originNode.hidden ? originNode.textContent : null' +
      '  };' +
      '})()'
  );
}

async function openMailbox(cdp) {
  step('open-mailbox');
  const returned = await cdp.evaluate('window.__arcadeCareerTest.openMailbox()');
  await cdp.waitFor('!!document.querySelector(\'[data-career-panel="mailbox"]\')', { timeout: 10000 });
  return returned;
}

async function clickTownEntry(cdp) {
  step('click-town-entry');
  const clicked = await cdp.evaluate(
    '(() => {' +
      '  var button = document.querySelector(\'[data-career-panel="mailbox"] [data-action="open-town"]\');' +
      '  if (!button || button.hidden) return { ok: false, reason: "missing-or-hidden" };' +
      '  button.click();' +
      '  return { ok: true };' +
      '})()'
  );
  ensure(clicked && clicked.ok === true, 'mailbox 去港口 button missing: ' + P(clicked));
  await cdp.waitFor('!!document.querySelector(\'[data-career-panel="town"]\')', { timeout: 12000 });
  return clicked;
}

async function boardSnapshot(cdp, label) {
  step('board:' + label);
  await cdp.waitFor('!!document.querySelector(\'[data-career-panel="town"]\')', { timeout: 12000 });
  /* 首开时 career 由 listAvailable ensure 创建，钱包行留在诚实的占位文案（D16-01 现状）；
     只要告示板已给出可接单或明确降级提示，就说明 listAvailable 已返回。 */
  await cdp.waitFor(
    '(() => { var panel = document.querySelector(\'[data-career-panel="town"]\'); if (!panel) return false; var starts = panel.querySelectorAll(\'[data-town-action="start"]\').length; var locked = panel.querySelectorAll(".ac-career-town__locked").length; return (starts + locked) >= 4 || panel.textContent.indexOf("告示板暂不可用") >= 0; })()',
    { timeout: 15000 }
  );
  await sleep(120);
  const snapshot = await cdp.evaluate(
    '(() => {' +
      '  var panel = document.querySelector(\'[data-career-panel="town"]\');' +
      '  var text = panel ? panel.textContent : "";' +
      '  var walletNode = panel ? panel.querySelector(".ac-career-town__wallet-value") : null;' +
      '  var walletText = walletNode ? walletNode.textContent : null;' +
      '  var walletMatch = walletText ? /工钱 ([0-9]+)/.exec(walletText) : null;' +
      '  var accepts = Array.prototype.slice.call(panel ? panel.querySelectorAll(\'[data-town-action="start"]\') : []).map(function (b) { return b.getAttribute("data-commission-id"); });' +
      '  var locked = panel ? panel.querySelectorAll(".ac-career-town__locked").length : 0;' +
      '  var ids = Array.prototype.slice.call(panel ? panel.querySelectorAll("[data-commission-id]") : []).map(function (el) { return el.getAttribute("data-commission-id"); });' +
      '  return {' +
      '    present: !!panel,' +
      '    accepts: accepts,' +
      '    lockedCount: locked,' +
      '    rowCount: accepts.length + locked,' +
      '    commissionIds: ids,' +
      '    unavailable: text.indexOf("告示板暂不可用") >= 0,' +
      '    wallet: walletText,' +
      '    walletCredits: walletMatch ? Number(walletMatch[1]) : null,' +
      '    text: text.slice(0, 500)' +
      '  };' +
      '})()'
  );
  return snapshot;
}

async function ensureCareerId(cdp, label) {
  step('ensure-career:' + label);
  const list = await cdp.evaluate('window.ArcadeCareer.commission.listAvailable({ ensure: true })');
  ensure(list && list.ok === true && typeof list.careerId === 'string' && list.careerId, 'listAvailable ensure failed: ' + P(list));
  return list.careerId;
}

function parseTicket(href) {
  const match = /[?&]career=([^&#]+)/.exec(String(href || ''));
  return match ? decodeURIComponent(match[1]) : null;
}

async function acceptFromBoard(cdp, commissionId, label) {
  step('board-accept:' + commissionId);
  /* 上一局结算后 URL 仍带 ?career=<已结算 ticket>；先回到同游戏页的干净 URL，
     否则「等待 URL 出现 career=」会命中旧 ticket。 */
  const staleTicket = await cdp.evaluate('location.search.indexOf("career=") >= 0');
  if (staleTicket) {
    const pathname = await cdp.evaluate('location.pathname');
    await go(cdp, state.base + pathname + '?careerTest=1#test', 'board-reset-url:' + label);
    await waitBridge(cdp);
  }
  if (!(await cdp.evaluate('!!document.querySelector(\'[data-career-panel="town"]\')'))) {
    await cdp.evaluate('window.ArcadeCareer.openTown()');
    await cdp.waitFor('!!document.querySelector(\'[data-career-panel="town"]\')', { timeout: 12000 });
  }
  await boardSnapshot(cdp, 'accept:' + commissionId);
  await cdp.waitFor(
    '!!document.querySelector(\'[data-town-action="start"][data-commission-id=' + P(commissionId) + ']\')',
    { timeout: 15000 }
  );
  await flushConsole(cdp, 'board-accept:' + commissionId);
  await cdp.evaluate('document.querySelector(\'[data-town-action="start"][data-commission-id=' + P(commissionId) + ']\').click()');
  await cdp.waitFor('location.search.indexOf("career=") >= 0', { timeout: 15000 });
  let href = null;
  let ticketId = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      href = await cdp.evaluate('location.href');
      ticketId = parseTicket(href);
      if (ticketId) break;
    } catch (err) {
      /* 导航中执行上下文可能被销毁，重试 */
    }
    await sleep(100);
  }
  ensure(ticketId, 'no ticket in url after board accept (' + label + '): ' + href);
  return { ticketId, href };
}

async function waitHangarReady(cdp, selector, label) {
  step('hangar-ready:' + (label || selector));
  await cdp.waitFor('!!document.querySelector(\'[data-career-panel="hangar"]\')', { timeout: 12000 });
  await cdp.waitFor(
    '(() => { var panel = document.querySelector(\'[data-career-panel="hangar"]\'); var button = panel ? panel.querySelector(' + P(selector) + ') : null; return !!(panel && button && !button.disabled); })()',
    { timeout: 15000 }
  );
  return true;
}

async function activateTicket(cdp, gameId, ticketId, label) {
  step('activate:' + label);
  await go(
    cdp,
    state.base + '/apps/arcade/games/' + gameId + '.html?career=' + encodeURIComponent(ticketId) + '&careerTest=1#test',
    'activate:' + label
  );
  await cdp.waitFor('!!(window.__arcadeCareerTest && window.__arcadeCareerTest.commissionRun())', { timeout: 15000 });
  return cdp.evaluate('window.__arcadeCareerTest.commissionRun()');
}

async function activateStarTicket(cdp, ticketId, label) {
  const run = await activateTicket(cdp, 'star-raid', ticketId, label);
  await cdp.waitFor(
    '(() => { var t = window.__arcadeTest; return !!t && typeof t.careerInfo === "function" && !!t.careerInfo().statsSource; })()',
    { timeout: 15000 }
  );
  return run;
}

async function startOverlayGame(cdp, label) {
  step('start-overlay:' + label);
  await cdp.waitFor('(() => { var b = document.querySelector("[data-ov-btn]"); return !!(b && !b.hidden); })()', { timeout: 12000 });
  await cdp.evaluate('document.querySelector("[data-ov-btn]").click()');
  await cdp.waitFor('window.__arcadeTest && window.__arcadeTest.info().state === "playing"', { timeout: 12000 });
  return true;
}

async function dropOneTowerFloor(cdp, index) {
  step('tower-drop:' + (index + 1));
  await cdp.waitFor(
    '(() => { var j = window.__arcadeTest.joyInfo(); return (j.pendHasBox && !j.dropping) || j.state !== "playing"; })()',
    { timeout: 15000 }
  );
  const current = await cdp.evaluate('window.__arcadeTest.joyInfo().state');
  ensure(current === 'playing', 'tower run ended before floor ' + (index + 1) + ' (state=' + current + ')');
  const deadline = Date.now() + 16000;
  let released = false;
  let forecast = null;
  while (Date.now() < deadline) {
    forecast = await cdp.evaluate(
      '(() => { var p = window.__arcadeTest.physicsInfo(); return { landable: p.forecast.landable, perfect: p.forecast.perfect, offset: p.forecast.offset }; })()'
    );
    if (forecast && forecast.landable && Math.abs(Number(forecast.offset) || 0) <= 26) {
      released = await cdp.evaluate('window.__arcadeTest.releaseNow()');
      if (released) break;
    }
    await sleep(25);
  }
  ensure(released, 'could not align a real release for floor ' + (index + 1) + ' (last forecast ' + P(forecast) + ')');
  await cdp.waitFor('window.__arcadeTest.careerInfo().floors >= ' + (index + 1), { timeout: 14000 });
  return cdp.evaluate('window.__arcadeTest.careerInfo().floors');
}

async function collapseTower(cdp) {
  step('tower-collapse');
  await cdp.evaluate('window.__arcadeTest.setLean(0, 90)');
  await cdp.waitFor(
    '(() => { var j = window.__arcadeTest.joyInfo(); return j.state === "collapse" || j.state === "over"; })()',
    { timeout: 10000 }
  );
}

async function flyTower(cdp, floors, label) {
  const before = await cdp.evaluate('window.__arcadeTest.careerInfo()');
  await startOverlayGame(cdp, label);
  const drops = [];
  for (let index = 0; index < floors; index += 1) {
    drops.push(await dropOneTowerFloor(cdp, index));
  }
  const events = await cdp.evaluate('window.ArcadeCareer.info().commissionEvents');
  const after = await cdp.evaluate('window.__arcadeTest.careerInfo()');
  await collapseTower(cdp);
  return { before, drops, after, events };
}

async function flyStarBoss(cdp, label) {
  step('star-boss:' + label);
  await startOverlayGame(cdp, label);
  const boss = await cdp.evaluate(
    '(() => { var r = window.__arcadeTest.spawnBossNow(); return { stage: r.stage, theme: r.theme, bossHp: r.bossHp, bossActive: r.bossActive }; })()'
  );
  const hit = await cdp.evaluate(
    '(() => { var r = window.__arcadeTest.damageBoss(99999); var c = window.__arcadeTest.careerInfo(); return { state: r.state, bossKills: c.bossKills }; })()'
  );
  await cdp.waitFor('window.__arcadeTest.info().state === "clear"', { timeout: 10000 });
  const clearPanel = await cdp.evaluate(
    '(() => { var c = window.__arcadeTest.careerInfo(); var title = document.querySelector("[data-ov-title]"); var btn2 = document.querySelector("[data-ov-btn2]"); return { state: c.state, bossKills: c.bossKills, title: title ? title.textContent : null, btn2: btn2 ? btn2.textContent : null, btn2Hidden: btn2 ? !!btn2.hidden : null }; })()'
  );
  await cdp.evaluate('document.querySelector("[data-ov-btn2]").click()');
  return { boss, hit, clearPanel };
}

async function waitSettle(cdp, ticketId, label) {
  step('settle:' + label);
  await cdp.waitFor(
    '(() => { var i = window.ArcadeCareer.info(); return !!(i.commissionLastResult && i.commissionLastResult.runId === ' + P(ticketId) + '); })()',
    { timeout: 30000 }
  );
  return cdp.evaluate('window.ArcadeCareer.info().commissionLastResult');
}

async function waitReceiptCard(cdp, label) {
  step('receipt-card:' + label);
  await cdp.waitFor('!!document.querySelector(\'[data-career-card="receipt"]\')', { timeout: 8000 });
  return cdp.evaluate(
    '(() => {' +
      '  var card = document.querySelector(\'[data-career-card="receipt"]\');' +
      '  return {' +
      '    state: card.getAttribute("data-state"),' +
      '    runId: card.getAttribute("data-run-id"),' +
      '    text: card.textContent,' +
      '    role: card.getAttribute("role"),' +
      '    live: card.getAttribute("aria-live")' +
      '  };' +
      '})()'
  );
}

async function economy(cdp, careerId, label) {
  step('economy:' + label);
  return cdp.evaluate(
    '(() => {' +
      '  var db = window.__arcadeCareerTest.db();' +
      '  var careerId = ' + P(careerId) + ';' +
      '  function safe(promise) { return Promise.resolve(promise).catch(function (err) { return { ok: false, reason: String(err) }; }); }' +
      '  var counts = { ok: false };' +
      '  var countPromise = (typeof db.__coreTest === "object" && db.__coreTest && typeof db.__coreTest.countRecords === "function")' +
      '    ? Promise.all(["claims", "runs", "ledgers", "profiles", "inventory", "equipment"].map(function (store) { return db.__coreTest.countRecords(store); }))' +
      '        .then(function (values) { return { ok: true, claims: values[0], runs: values[1], ledgers: values[2], profiles: values[3], inventory: values[4], equipment: values[5] }; })' +
      '    : Promise.resolve({ ok: false });' +
      '  return Promise.all([safe(db.readWallet(careerId)), safe(db.readLedger(careerId, 100)), safe(db.readQuestState(careerId)), safe(db.getEquipment(careerId)), safe(countPromise)])' +
      '    .then(function (values) {' +
      '      var wallet = values[0] || {};' +
      '      var ledger = values[1] || {};' +
      '      var quests = values[2] || {};' +
      '      var equipment = values[3] || {};' +
      '      counts = values[4] || { ok: false };' +
      '      return {' +
      '        wallet: { ok: wallet.ok === true, credits: wallet.credits, items: wallet.items || {}, equipment: wallet.equipment || {} },' +
      '        ledger: Array.isArray(ledger.rows) ? ledger.rows : [],' +
      '        quests: (quests.quests || []).map(function (row) { return { nodeId: row.nodeId, kind: row.kind, status: row.status, flags: row.flags || [] }; }),' +
      '        equipment: equipment.ok ? (equipment.equipment || {}) : null,' +
      '        counts: counts' +
      '      };' +
      '    });' +
      '})()'
  );
}

function snapshot(label, econ, extra) {
  const entry = {
    label: label,
    credits: econ && econ.wallet ? econ.wallet.credits : null,
    items: econ && econ.wallet ? econ.wallet.items : null,
    equipmentKeys: econ && econ.equipment ? Object.keys(econ.equipment).sort() : null,
    equippedShip: econ && econ.equipment ? econ.equipment.equippedShip || null : null,
    ledgerRows: econ && econ.ledger ? econ.ledger.length : null,
    ledgerSum: econ && econ.ledger ? sumCredits(econ.ledger) : null,
    ledgerKinds: econ && econ.ledger ? countBy(econ.ledger, 'kind') : null,
    claims: econ && econ.counts && econ.counts.ok ? econ.counts.claims : null,
    runs: econ && econ.counts && econ.counts.ok ? econ.counts.runs : null,
    questNodes: econ && econ.quests ? econ.quests.map((row) => row.nodeId).sort() : null,
    ...(extra || {}),
  };
  state.snapshots.push(entry);
  console.log('SNAPSHOT ' + P(entry));
  return entry;
}

function assertLedgerInvariants(prefix, econ, expectedCredits, expectedClaims) {
  const rows = econ.ledger || [];
  const txIds = rows.map((row) => row.txId);
  const uniqueTx = uniqueList(txIds);
  expectTrue(prefix + ' ledger txIds unique', uniqueTx.length === txIds.length, P(txIds));
  expectTrue(prefix + ' balance never negative', econ.wallet.credits >= 0 && rows.every((row) => Number(row.credits) >= 0 || row.kind === 'purchase'), P({ credits: econ.wallet.credits, negative: rows.filter((row) => Number(row.credits) < 0).map((row) => row.kind) }));
  expectTrue(prefix + ' purchase rows are negative with a positive cost', rows.filter((row) => row.kind === 'purchase').every((row) => Number(row.credits) < 0 && Number(row.cost) > 0), P(rows.filter((row) => row.kind === 'purchase')));
  expectNum(prefix + ' ledger sum equals wallet credits', sumCredits(rows), expectedCredits, 0);
  if (Number.isFinite(expectedClaims)) {
    expectEq(prefix + ' claims count', econ.counts && econ.counts.ok ? econ.counts.claims : null, expectedClaims);
  }
  return rows;
}

function purchaseRows(econ) {
  return (econ.ledger || []).filter((row) => row.kind === 'purchase');
}

function claimLedgerRows(econ) {
  return (econ.ledger || []).filter((row) => row.kind === 'credits' || row.kind === 'items' || row.kind === 'progress');
}

/* ------------------------------------------------------------------ *
 * 场景二：16 起源运行时抽样（真实开信箱 → 去港口 → 告示板）
 * ------------------------------------------------------------------ */

const ORIGIN_SAMPLES = ['memory-flip', 'merge-2048', 'blackjack', 'road-rush', 'gomoku', 'solitaire', 'snowbells', 'gold-miner'];

async function scenarioOrigins(cdp, content) {
  const { chapter, clues, registry } = content;
  const clueByGame = new Map(clues.clues.map((clue) => [clue.gameId, clue]));
  const registryGame = new Map(registry.games.map((game) => [game.gameId, game]));
  await deleteDatabase(cdp, 'origins');
  let careerId = null;

  for (let index = 0; index < ORIGIN_SAMPLES.length; index += 1) {
    const gameId = ORIGIN_SAMPLES[index];
    const origin = chapter.origins.find((row) => row.gameId === gameId);
    const clue = clueByGame.get(gameId);
    const game = registryGame.get(gameId);
    ensure(origin && clue && game, 'origin sample missing content: ' + gameId);
    const tag = 'O' + String(index + 1).padStart(2, '0') + ' ' + gameId;
    step('origin:' + gameId);

    await go(cdp, state.base + '/apps/arcade/games/' + gameId + '.html?careerTest=1#test', 'origin-page:' + gameId);
    const ready = await waitBridge(cdp);
    const info = await cdp.evaluate('window.ArcadeCareer.info()');
    expectTrue(tag + ' bridge ready & registry identifies origin', ready.available === true && info.gameId === gameId && info.dbUsable === true, P({ ready, gameId: info.gameId, dbUsable: info.dbUsable }));

    const seeded = await seedLocal(cdp, gameId, clue.clueId);
    expectTrue(tag + ' discovery seeded to LOCAL (real IDB write)', seeded && seeded.ok === true && seeded.state && seeded.state.stage === 'LOCAL', P(seeded && { ok: seeded.ok, stage: seeded.state && seeded.state.stage, error: seeded.error }));

    const intro = await cdp.evaluate('window.__arcadeCareerTest.originIntro()');
    expectTrue(tag + ' originIntro uses this origin-only letter/address', !!(intro && intro.sourceGame === gameId && intro.address === origin.c0Letter.address && typeof intro.greeting === 'string' && intro.greeting.length > 0), P(intro));

    await openMailbox(cdp);
    const mailbox = await mailboxSnapshot(cdp);
    expectTrue(tag + ' mailbox shows origin letter + 「按地址投递 · 去港口」', !!(
      mailbox &&
      mailbox.townButton === true &&
      mailbox.townButtonHidden === false &&
      mailbox.townButtonText === '按地址投递 · 去港口' &&
      mailbox.address === origin.c0Letter.address &&
      mailbox.body &&
      mailbox.body.trim().length > 10
    ), P(mailbox));

    await clickTownEntry(cdp);
    const board = await boardSnapshot(cdp, 'origin:' + gameId);
    expectTrue(tag + ' town board usable (C1 entry: 4 rows / 2 T1 accept / no degraded notice)', !!(
      board &&
      board.unavailable === false &&
      board.rowCount === 4 &&
      board.accepts.length === 2 &&
      board.accepts.indexOf('pendulum-tower.T1') >= 0 &&
      board.accepts.indexOf('star-raid.T1') >= 0 &&
      uniqueList(board.commissionIds).length === 4
    ), P(board && { accepts: board.accepts, locked: board.lockedCount, unavailable: board.unavailable, ids: uniqueList(board.commissionIds) }));

    careerId = careerId || (await ensureCareerId(cdp, 'origins'));
    if (index === 0) {
      /* 首开时 career 尚未建立，钱包行是诚实占位；重开一次告示板即从 DB 读取真实余额。 */
      await cdp.evaluate('window.ArcadeCareerUI.town.close()');
      await cdp.evaluate('window.ArcadeCareer.openTown()');
      const boardWallet = await boardSnapshot(cdp, 'origin-wallet');
      expectEq('O00 reopened board reads wallet from DB (initial 80)', boardWallet.walletCredits, 80);
    }
    state.coverage.originsRuntime.push(gameId);
    await flushConsole(cdp, 'origin:' + gameId);
  }

  ensure(careerId, 'origins sample produced no careerId');
  const econ = await economy(cdp, careerId, 'origins-final');
  snapshot('origins-8-samples', econ, { careerId: careerId, sampled: state.coverage.originsRuntime.slice() });
  expectTrue('O99 sampled origins share one untouched career (80 credits / no claims / no work rows)', econ.wallet.credits === 80 && econ.counts.claims === 0 && sumCredits(econ.ledger) === 80, P({ credits: econ.wallet.credits, claims: econ.counts.claims, ledgerSum: sumCredits(econ.ledger) }));
}

/* ------------------------------------------------------------------ *
 * 场景三：工作 → 买机 → 星海 → 战利品（真实链路）
 * ------------------------------------------------------------------ */

async function scenarioEconomyChain(cdp, content) {
  const pendulumOrigin = content.chapter.origins.find((row) => row.gameId === 'pendulum-tower');

  await deleteDatabase(cdp, 'chain');
  step('chain:tower-page');
  await go(cdp, state.base + '/apps/arcade/games/pendulum-tower.html?careerTest=1#test', 'chain-tower-page');
  const ready = await waitBridge(cdp);
  await waitGameHooks(cdp);
  ensure(ready.available === true, 'tower bridge unavailable: ' + P(ready));

  /* 真实入口：seed → 信箱 → 去港口 → 告示板 */
  await seedLocal(cdp, 'pendulum-tower', 'CL-pendulum-tower');
  const intro = await cdp.evaluate('window.__arcadeCareerTest.originIntro()');
  ensure(intro && intro.address === pendulumOrigin.c0Letter.address, 'origin intro mismatch: ' + P(intro));
  await openMailbox(cdp);
  const mailbox = await mailboxSnapshot(cdp);
  expectTrue('C01 mailbox 去港口 entry visible for tower origin', !!(mailbox && mailbox.townButton && mailbox.townButtonHidden === false && mailbox.address === pendulumOrigin.c0Letter.address), P(mailbox));
  await clickTownEntry(cdp);
  const board = await boardSnapshot(cdp, 'chain-initial');
  expectTrue('C02 town board usable: 4 rows / 2 T1 accept / no degraded notice', board.rowCount === 4 && board.accepts.length === 2 && board.unavailable === false, P({ accepts: board.accepts, rows: board.rowCount, unavailable: board.unavailable }));
  const careerId = await ensureCareerId(cdp, 'chain');
  state.coverage.chains.push({ name: 'work-purchase-star', careerId });
  /* career 建立后重开告示板：钱包行必须来自真实 DB（80） */
  await cdp.evaluate('window.ArcadeCareerUI.town.close()');
  await cdp.evaluate('window.ArcadeCareer.openTown()');
  const boardWallet = await boardSnapshot(cdp, 'chain-wallet');
  expectEq('C02b reopened board shows DB wallet 80', boardWallet.walletCredits, 80);

  /* 层塔 T1：真实 4 层 */
  const acceptT1 = await acceptFromBoard(cdp, 'pendulum-tower.T1', 'chain-T1');
  const runT1 = await activateTicket(cdp, 'pendulum-tower', acceptT1.ticketId, 'chain-T1');
  expectTrue('C03 T1 ticket activated as commission run', runT1.commissionId === 'pendulum-tower.T1' && runT1.careerId === careerId && runT1.gameId === 'pendulum-tower', P({ commissionId: runT1.commissionId, careerId: runT1.careerId }));
  const towerHooks = await cdp.evaluate('window.__arcadeTest.careerInfo()');
  expectTrue('C04 tower career overlay shows in-fiction goal & serializes null', towerHooks.isCommission === true && towerHooks.locked === true && towerHooks.goalLineVisible === true && towerHooks.serializeNull === true && towerHooks.level === 4, P(towerHooks));
  await flushConsole(cdp, 'chain-tower-T1-activate');

  const flightT1 = await flyTower(cdp, 4, 'chain-T1');
  expectTrue('C05 tower T1: 4 real floor settles recorded as commission events (no discovery pollution)', flightT1.drops.length === 4 && flightT1.drops[0] === 1 && flightT1.drops[3] === 4 && flightT1.events === 4 && flightT1.after.floors === 4, P(flightT1));
  const settleT1 = await waitSettle(cdp, acceptT1.ticketId, 'chain-T1');
  expectTrue('C06 T1 settlement: 70 credits + alloy 1 + C1.work_done (bridge authoritative)', settleT1.ok === true && settleT1.credits === 70 && settleT1.items && settleT1.items.alloy === 1 && Array.isArray(settleT1.flags) && settleT1.flags.indexOf('C1.work_done') >= 0 && settleT1.repeat === false && settleT1.duplicate === false, P(settleT1));
  const cardT1 = await waitReceiptCard(cdp, 'chain-T1');
  expectTrue('C07 T1 receipt card shows this run (+70 / alloy 1 / ticket id)', cardT1.state === 'success' && cardT1.runId === acceptT1.ticketId && cardT1.text.indexOf('+70') >= 0 && cardT1.text.indexOf('合金 ×1') >= 0 && cardT1.text.indexOf(acceptT1.ticketId) >= 0, P(cardT1));
  let econ = await economy(cdp, careerId, 'chain-after-T1');
  snapshot('chain:after-tower-T1', econ, { ticketId: acceptT1.ticketId, receipt: { credits: settleT1.credits, items: settleT1.items, flags: settleT1.flags } });
  assertLedgerInvariants('C08', econ, 150, 1);
  expectEq('C08 wallet after T1 (80 initial + 70)', { credits: econ.wallet.credits, items: econ.wallet.items, equipment: econ.equipment }, { credits: 150, items: { alloy: 1 }, equipment: {} });
  const claimT1 = await cdp.evaluate('window.__arcadeCareerTest.db().getClaim(' + P(acceptT1.ticketId) + ')');
  expectTrue('C09 claim row for T1 is real & matches receipt', !!claimT1 && claimT1.credits === 70 && claimT1.items && claimT1.items.alloy === 1 && claimT1.receiptId === acceptT1.ticketId, P(claimT1));
  await flushConsole(cdp, 'chain-tower-T1-settle');

  /* 层塔 T2：board 解锁 → 真实 6 层 */
  step('chain:tower-T2-board');
  await cdp.evaluate('window.ArcadeCareer.openTown()');
  const board2 = await boardSnapshot(cdp, 'chain-T2');
  expectTrue('C10 C1.work_done unlocks tower T2 on the real board (wallet 150)', board2.accepts.indexOf('pendulum-tower.T2') >= 0 && board2.walletCredits === 150, P({ accepts: board2.accepts, wallet: board2.wallet }));
  await cdp.evaluate('window.ArcadeCareerUI.town.close()');

  const acceptT2 = await acceptFromBoard(cdp, 'pendulum-tower.T2', 'chain-T2');
  const runT2 = await activateTicket(cdp, 'pendulum-tower', acceptT2.ticketId, 'chain-T2');
  expectTrue('C11 T2 ticket activated', runT2.commissionId === 'pendulum-tower.T2' && runT2.startParams && P(runT2.startParams) === '{}', P(runT2.startParams));
  const flightT2 = await flyTower(cdp, 6, 'chain-T2');
  expectTrue('C12 tower T2: 6 real floor settles recorded', flightT2.events === 6 && flightT2.after.floors === 6, P({ events: flightT2.events, floors: flightT2.after.floors }));
  const settleT2 = await waitSettle(cdp, acceptT2.ticketId, 'chain-T2');
  expectTrue('C13 T2 settlement includes objectiveBonus (110+bridge bonus, alloy 2)', settleT2.ok === true && settleT2.credits === 120 && settleT2.items && settleT2.items.alloy === 2 && settleT2.repeat === false, 'expected credits 110 + objectiveBonus 10 = 120 · actual ' + P({ credits: settleT2.credits, items: settleT2.items, reason: settleT2.reason }));
  econ = await economy(cdp, careerId, 'chain-after-T2');
  snapshot('chain:after-tower-T2', econ, { ticketId: acceptT2.ticketId, receipt: { credits: settleT2.credits, items: settleT2.items } });
  assertLedgerInvariants('C14', econ, 270, 2);
  expectEq('C14 wallet after T2 (150 + 120) & materials 3', { credits: econ.wallet.credits, items: econ.wallet.items }, { credits: 270, items: { alloy: 3 } });
  await flushConsole(cdp, 'chain-tower-T2-settle');

  /* 机库：真实按钮购买旧翼 260 */
  step('chain:hangar-open');
  await cdp.evaluate('window.ArcadeCareer.openHangar()');
  await waitHangarReady(cdp, '[data-action="buy"][data-ship-id="old-wing"]', 'chain-old-wing');
  const hangarBefore = await cdp.evaluate(
    '(() => {' +
      '  var panel = document.querySelector(\'[data-career-panel="hangar"]\');' +
      '  var card = panel.querySelector(\'.ac-career-hangar__card[data-ship-id="old-wing"]\');' +
      '  var buy = card ? card.querySelector(\'[data-action="buy"]\') : null;' +
      '  var price = card ? card.querySelector(".ac-career-hangar__price") : null;' +
      '  return {' +
      '    cards: panel.querySelectorAll(".ac-career-hangar__card").length,' +
      '    shipIds: Array.prototype.slice.call(panel.querySelectorAll(".ac-career-hangar__card")).map(function (el) { return el.getAttribute("data-ship-id"); }),' +
      '    priceText: price ? price.textContent : null,' +
      '    buyDisabled: buy ? !!buy.disabled : null,' +
      '    buyText: buy ? buy.textContent : null,' +
      '    owned: card ? card.getAttribute("data-owned") : null,' +
      '    current: card ? card.getAttribute("data-current") : null' +
      '  };' +
      '})()'
  );
  expectTrue('C15 hangar opens from real content (4 ships, old-wing 260 buyable)', hangarBefore.cards === 4 && hangarBefore.priceText === '260 信用点' && hangarBefore.buyDisabled === false && hangarBefore.owned === 'false', P(hangarBefore));

  step('chain:hangar-buy-old-wing');
  await cdp.evaluate('document.querySelector(\'[data-action="buy"][data-ship-id="old-wing"]\').click()');
  await cdp.waitFor(
    '(() => { var card = document.querySelector(\'.ac-career-hangar__card[data-ship-id="old-wing"]\'); return !!card && card.getAttribute("data-owned") === "true"; })()',
    { timeout: 15000 }
  );
  const hangarAfter = await cdp.evaluate(
    '(() => {' +
      '  var panel = document.querySelector(\'[data-career-panel="hangar"]\');' +
      '  var card = panel.querySelector(\'.ac-career-hangar__card[data-ship-id="old-wing"]\');' +
      '  var buy = card ? card.querySelector(\'[data-action="buy"]\') : null;' +
      '  var reasons = Array.prototype.slice.call(panel.querySelectorAll("[data-reason]")).map(function (el) { return el.textContent; });' +
      '  return { owned: card.getAttribute("data-owned"), buyDisabled: buy ? !!buy.disabled : null, buyText: buy ? buy.textContent : null, reasons: reasons };' +
      '})()'
  );
  expectTrue('C16 real buy button completes purchase of old-wing (登记好了)', hangarAfter.owned === 'true' && hangarAfter.buyDisabled === true && hangarAfter.buyText === '已入列' && hangarAfter.reasons.some((text) => text.indexOf('登记好了：旧翼') >= 0), P(hangarAfter));
  econ = await economy(cdp, careerId, 'chain-after-purchase');
  snapshot('chain:after-buy-old-wing', econ, {});
  expectEq('C17 wallet/materials after purchase (270-260 / alloy unchanged 3)', { credits: econ.wallet.credits, items: econ.wallet.items }, { credits: 10, items: { alloy: 3 } });
  expectEq('C17b equipment records ship:old-wing:owned only', econ.equipment, { 'ship:old-wing:owned': true });
  const purchaseRowsChain = purchaseRows(econ);
  expectTrue('C18 exactly one purchase ledger row (-260 / cost 260)', purchaseRowsChain.length === 1 && purchaseRowsChain[0].credits === -260 && purchaseRowsChain[0].cost === 260, P(purchaseRowsChain));
  await flushConsole(cdp, 'chain-hangar-buy');

  /* 星海 T1：真实击破 boss */
  await cdp.evaluate('window.ArcadeCareerUI.hangar.close()');
  const acceptStar = await acceptFromBoard(cdp, 'star-raid.T1', 'chain-star-T1');
  const runStar = await activateStarTicket(cdp, acceptStar.ticketId, 'chain-star-T1');
  const starPre = await cdp.evaluate('window.__arcadeTest.careerInfo()');
  expectTrue('C19 star T1 activated; old-wing loadout & career chrome (no classic HUD/entries)', runStar.commissionId === 'star-raid.T1' && starPre.isCommission === true && starPre.statsSource === 'star-combat-config' && starPre.stats.damageMul === 1 && starPre.stats.speedMul === 1 && starPre.shipName === '旧翼' && starPre.hangarEntryVisible === false && starPre.challengeEntryVisible === false && starPre.mowEntryVisible === false && starPre.hudCreditsHidden === true, P({ commissionId: runStar.commissionId, stats: starPre.stats, shipName: starPre.shipName, chrome: { hangar: starPre.hangarEntryVisible, challenge: starPre.challengeEntryVisible, mow: starPre.mowEntryVisible, hudCreditsHidden: starPre.hudCreditsHidden } }));
  const flightStar = await flyStarBoss(cdp, 'chain-star-T1');
  expectTrue('C20 real boss defeat drives career objective (level 1 / theme patrol, bossKills=1)', flightStar.boss.stage === 1 && flightStar.boss.theme === 'patrol' && flightStar.hit.bossKills === 1 && flightStar.clearPanel.state === 'clear' && flightStar.clearPanel.btn2 === '圆满收局', P(flightStar));
  const settleStar = await waitSettle(cdp, acceptStar.ticketId, 'chain-star-T1');
  expectTrue('C21 star T1 settlement: 90 credits + alloy 1 + C1.flight_done', settleStar.ok === true && settleStar.credits === 90 && settleStar.items && settleStar.items.alloy === 1 && settleStar.flags.indexOf('C1.flight_done') >= 0 && settleStar.duplicate === false, P(settleStar));
  const cardStar = await waitReceiptCard(cdp, 'chain-star-T1');
  expectTrue('C22 star receipt card visible after settlement', cardStar.state === 'success' && cardStar.runId === acceptStar.ticketId && cardStar.text.indexOf('+90') >= 0 && cardStar.text.indexOf('合金 ×1') >= 0, P({ state: cardStar.state, runId: cardStar.runId, text: cardStar.text.slice(0, 200) }));
  econ = await economy(cdp, careerId, 'chain-after-star');
  snapshot('chain:after-star-T1', econ, { ticketId: acceptStar.ticketId, receipt: { credits: settleStar.credits, items: settleStar.items, flags: settleStar.flags } });
  assertLedgerInvariants('C23', econ, 100, 3);
  expectEq('C24 final chain wallet/materials/equipment (80+70+120-260+90 / 4 alloy)', { credits: econ.wallet.credits, items: econ.wallet.items, equipment: econ.equipment }, { credits: 100, items: { alloy: 4 }, equipment: { 'ship:old-wing:owned': true } });
  expectTrue('C25 loot visible in wallet & ledger (alloy claims rows for all 3 runs)', claimLedgerRows(econ).filter((row) => row.kind === 'items').length === 3 && econ.wallet.items.alloy === 4, P(claimLedgerRows(econ).filter((row) => row.kind === 'items')));

  /* 收据 UI：真实 DB 行 */
  step('chain:receipt-panel');
  await cdp.evaluate('window.ArcadeCareer.openReceipt()');
  await cdp.waitFor('!!document.querySelector(\'[data-career-panel="receipt"]\')', { timeout: 12000 });
  await cdp.waitFor(
    '(() => { var panel = document.querySelector(\'[data-career-panel="receipt"]\'); if (!panel || panel.getAttribute("data-state") !== "ready") return false; return !!panel.querySelector(\'[data-field="credits"]\'); })()',
    { timeout: 15000 }
  );
  const receiptPanel = await cdp.evaluate(
    '(() => {' +
      '  var panel = document.querySelector(\'[data-career-panel="receipt"]\');' +
      '  var creditsNode = panel.querySelector(\'[data-field="credits"]\');' +
      '  var txNodes = Array.prototype.slice.call(panel.querySelectorAll("[data-tx-id]"));' +
      '  return {' +
      '    state: panel.getAttribute("data-state"),' +
      '    credits: creditsNode ? creditsNode.getAttribute("data-credits") : null,' +
      '    txIds: txNodes.map(function (el) { return el.getAttribute("data-tx-id"); }),' +
      '    text: panel.textContent' +
      '  };' +
      '})()'
  );
  const expectedTxIds = econ.ledger.map((row) => row.txId);
  expectTrue('C26 receipt panel reflects DB wallet & ledger txIds (no recomputation)', receiptPanel.state === 'ready' && Number(receiptPanel.credits) === 100 && expectedTxIds.every((txId) => receiptPanel.txIds.indexOf(txId) >= 0), P({ state: receiptPanel.state, credits: receiptPanel.credits, panelTx: receiptPanel.txIds, dbTx: expectedTxIds }));
  expectTrue('C27 receipt panel uses in-fiction copy only (no system words)', ['奖励', '解锁', '签到', '概率', '生涯模式', '职业系统'].every((word) => receiptPanel.text.indexOf(word) < 0), P(receiptPanel.text.slice(0, 200)));
  await cdp.evaluate('window.ArcadeCareerUI.receipt.close()');
  await flushConsole(cdp, 'chain-star-T1-settle');

  /* 无重复奖励 / 无重复扣款：再点一次已入列按钮不会二次扣款 */
  step('chain:duplicate-guard');
  await cdp.evaluate('window.ArcadeCareer.openHangar()');
  await cdp.waitFor('!!document.querySelector(\'[data-career-panel="hangar"]\')', { timeout: 12000 });
  await cdp.waitFor(
    '(() => { var card = document.querySelector(\'.ac-career-hangar__card[data-ship-id="old-wing"]\'); return !!card && card.getAttribute("data-owned") === "true"; })()',
    { timeout: 15000 }
  );
  const dupAttempt = await cdp.evaluate(
    '(() => {' +
      '  var button = document.querySelector(\'[data-action="buy"][data-ship-id="old-wing"]\');' +
      '  if (!button) return { present: false };' +
      '  var disabled = !!button.disabled;' +
      '  if (!disabled) button.click();' +
      '  return { present: true, disabled: disabled, text: button.textContent };' +
      '})()'
  );
  await sleep(600);
  const econDup = await economy(cdp, careerId, 'chain-duplicate-guard');
  expectTrue('C28 re-buy attempt cannot double-charge (owned button disabled, wallet unchanged)', dupAttempt.present === true && dupAttempt.disabled === true && purchaseRows(econDup).length === 1 && econDup.wallet.credits === 100, P({ attempt: dupAttempt, purchases: purchaseRows(econDup).length, credits: econDup.wallet.credits }));
  expectTrue('C29 no duplicate rewards: claims still 3 & ledger claim txIds unique across runs', econDup.counts.claims === 3 && uniqueList(claimLedgerRows(econDup).map((row) => row.txId)).length === claimLedgerRows(econDup).length, P({ claims: econDup.counts.claims }));
  await cdp.evaluate('window.ArcadeCareerUI.hangar.close()');
  await flushConsole(cdp, 'chain-duplicate-guard');
}

/* ------------------------------------------------------------------ *
 * 场景四：租用路线（不打工，零收入）
 * ------------------------------------------------------------------ */

async function scenarioRental(cdp) {
  await deleteDatabase(cdp, 'rental');
  step('rental:page');
  await go(cdp, state.base + '/apps/arcade/games/star-raid.html?careerTest=1#test', 'rental-page');
  const ready = await waitBridge(cdp);
  await waitGameHooks(cdp);
  ensure(ready.available === true, 'star bridge unavailable: ' + P(ready));

  /* 免费租机入口来自真实机库（懒装载 rental.js + items.json） */
  await cdp.evaluate('window.ArcadeCareer.openHangar()');
  await waitHangarReady(cdp, '[data-action="rent"][data-ship-id="old-wing"]', 'rental-entry');
  await cdp.waitFor('!!window.ArcadeCareerRental', { timeout: 12000 });
  await cdp.waitFor('!!document.querySelector(\'[data-action="rent"]\')', { timeout: 12000 });
  const hangar = await cdp.evaluate(
    '(() => {' +
      '  var panel = document.querySelector(\'[data-career-panel="hangar"]\');' +
      '  var rent = panel.querySelector(\'[data-action="rent"][data-ship-id="old-wing"]\');' +
      '  return { rentalModule: !!window.ArcadeCareerRental, rentText: rent ? rent.textContent : null, rentDisabled: rent ? !!rent.disabled : null, mirrored: window.ArcadeCareer.rental === window.ArcadeCareerRental };' +
      '})()'
  );
  expectTrue('R01 free rental entry available in real hangar (mirrored module)', hangar.rentalModule === true && hangar.rentText === '免费租用出击' && hangar.rentDisabled === false && hangar.mirrored === true, P(hangar));
  const careerId = await ensureCareerId(cdp, 'rental');
  await cdp.evaluate('window.ArcadeCareerUI.hangar.close()');
  let econ = await economy(cdp, careerId, 'rental-initial');
  snapshot('rental:initial-zero-income', econ, { careerId: careerId });
  expectEq('R02 new career: 80 credits, 1 initial ledger row, no work claims', { credits: econ.wallet.credits, ledgerRows: econ.ledger.length, claims: econ.counts.claims, items: econ.wallet.items }, { credits: 80, ledgerRows: 1, claims: 0, items: {} });

  /* 第一次租机：失败局（无 boss 事件 → 真实 objective-not-met） */
  step('rental:prepare-1');
  const prep1 = await cdp.evaluate(
    'window.ArcadeCareerRental.prepareCommission({ commissionId: "star-raid.T1", careerId: ' + P(careerId) + ', shipId: "old-wing" }).then(function (x) { return { ok: x.ok, reason: x.reason, ticketId: x.ticketId, url: x.url, owned: x.owned }; })'
  );
  expectTrue('R03 prepareCommission grants free rental & real ticket (owned:false)', prep1.ok === true && typeof prep1.ticketId === 'string' && prep1.owned === false && String(prep1.url).indexOf('career=') >= 0, P(prep1));
  const marker1 = await cdp.evaluate('sessionStorage.getItem(' + P(RENTAL_KEY) + ')');
  expectTrue('R04 rental marker is session-scoped and contains no money fields', !!marker1 && marker1.indexOf('old-wing') >= 0 && marker1.indexOf('credits') < 0 && marker1.indexOf('price') < 0, String(marker1).slice(0, 240));
  econ = await economy(cdp, careerId, 'rental-after-prepare');
  snapshot('rental:after-prepare-1', econ, {});
  expectTrue('R05 rental itself charges nothing (wallet 80 / no purchase rows / no equipment)', econ.wallet.credits === 80 && purchaseRows(econ).length === 0 && P(econ.equipment) === '{}' && econ.ledger.length === 1, P({ credits: econ.wallet.credits, purchases: purchaseRows(econ).length, equipment: econ.equipment }));

  const run1 = await activateStarTicket(cdp, prep1.ticketId, 'rental-flight-1');
  const run1Stats = await cdp.evaluate('window.__arcadeTest.careerInfo()');
  expectTrue('R06 flight carries rental marker (rentalShipId) without ownership', run1.commissionId === 'star-raid.T1' && run1.rentalShipId === 'old-wing' && run1.startParams && run1.startParams.rentalShipId === 'old-wing' && run1Stats.stats.damageMul === 1, P({ rentalShipId: run1.rentalShipId, startParams: run1.startParams, stats: run1Stats.stats }));
  const failResult = await cdp.evaluate('window.ArcadeCareer.finish({ mode: "classic", outcome: "lost", stats: {} })');
  expectTrue('R07 failed rental flight settles as objective-not-met (no fake success)', failResult && failResult.ok === false && failResult.reason === 'objective-not-met' && failResult.observed === 0, P(failResult && { ok: failResult.ok, reason: failResult.reason, observed: failResult.observed }));
  await sleep(400);
  econ = await economy(cdp, careerId, 'rental-after-failure');
  snapshot('rental:after-failed-flight', econ, {});
  const markerAfterFail = await cdp.evaluate('sessionStorage.getItem(' + P(RENTAL_KEY) + ')');
  const ticketAfterFail = await cdp.evaluate('sessionStorage.getItem(' + P(TICKET_KEY) + ')');
  expectTrue('R08 failure keeps wallet/materials/equipment intact & clears rental marker/ticket', econ.wallet.credits === 80 && P(econ.wallet.items) === '{}' && econ.counts.claims === 0 && P(econ.equipment) === '{}' && markerAfterFail === null && ticketAfterFail === null, P({ credits: econ.wallet.credits, items: econ.wallet.items, claims: econ.counts.claims, equipment: econ.equipment, marker: markerAfterFail, ticket: ticketAfterFail }));

  /* 第二次租机：真实击破 boss → 90 + alloy1 */
  step('rental:prepare-2');
  await cdp.evaluate('window.ArcadeCareer.openHangar()');
  await cdp.waitFor('!!window.ArcadeCareerRental', { timeout: 12000 });
  await sleep(300);
  const prep2 = await cdp.evaluate(
    'window.ArcadeCareerRental.prepareCommission({ commissionId: "star-raid.T1", careerId: ' + P(careerId) + ', shipId: "old-wing" }).then(function (x) { return { ok: x.ok, reason: x.reason, ticketId: x.ticketId, owned: x.owned }; })'
  );
  expectTrue('R09 second free rental flight opens (zero charge again)', prep2.ok === true && typeof prep2.ticketId === 'string' && prep2.owned === false, P(prep2));
  await cdp.evaluate('window.ArcadeCareerUI.hangar.close()');
  const run2 = await activateStarTicket(cdp, prep2.ticketId, 'rental-flight-2');
  const flight2 = await flyStarBoss(cdp, 'rental-flight-2');
  expectTrue('R10 rental flight defeats real boss (bossKills=1, clear panel)', flight2.hit.bossKills === 1 && flight2.clearPanel.state === 'clear', P(flight2.clearPanel));
  const settle2 = await waitSettle(cdp, prep2.ticketId, 'rental-flight-2');
  expectTrue('R11 rental settlement pays 90 + alloy 1 with first-time salary', settle2.ok === true && settle2.credits === 90 && settle2.items && settle2.items.alloy === 1 && settle2.repeat === false, P(settle2));
  const card2 = await waitReceiptCard(cdp, 'rental-flight-2');
  expectTrue('R12 rental receipt card visible after settlement', card2.state === 'success' && card2.text.indexOf('+90') >= 0, P({ state: card2.state, text: card2.text.slice(0, 160) }));
  econ = await economy(cdp, careerId, 'rental-final');
  snapshot('rental:final', econ, {});
  const markerFinal = await cdp.evaluate('sessionStorage.getItem(' + P(RENTAL_KEY) + ')');
  const ticketFinal = await cdp.evaluate('sessionStorage.getItem(' + P(TICKET_KEY) + ')');
  expectEq('R13 rental route final wallet/materials (80 + 90 / alloy 1)', { credits: econ.wallet.credits, items: econ.wallet.items }, { credits: 170, items: { alloy: 1 } });
  expectTrue('R14 rental grants no ship ownership (no ship:* keys, no equippedShip, no purchase rows)', P(econ.equipment) === '{}' && purchaseRows(econ).length === 0 && econ.wallet.equipment && Object.keys(econ.wallet.equipment).filter((key) => key.indexOf('ship:') === 0).length === 0 && markerFinal === null && ticketFinal === null, P({ equipment: econ.equipment, purchases: purchaseRows(econ).length, marker: markerFinal, ticket: ticketFinal }));
  assertLedgerInvariants('R15', econ, 170, 1);
  await flushConsole(cdp, 'rental');
}

/* ------------------------------------------------------------------ *
 * 场景五：失败路线 + 非战斗代办
 * ------------------------------------------------------------------ */

async function scenarioFailureAndAlternative(cdp) {
  await deleteDatabase(cdp, 'failure');
  step('failure:page');
  await go(cdp, state.base + '/apps/arcade/games/pendulum-tower.html?careerTest=1#test', 'failure-page');
  const ready = await waitBridge(cdp);
  await waitGameHooks(cdp);
  ensure(ready.available === true, 'tower bridge unavailable: ' + P(ready));

  /* 真实入口（信箱 → 告示板）接 T1 */
  await seedLocal(cdp, 'pendulum-tower', 'CL-pendulum-tower');
  await openMailbox(cdp);
  await clickTownEntry(cdp);
  await boardSnapshot(cdp, 'failure-initial');
  const careerId = await ensureCareerId(cdp, 'failure');
  const acceptFail = await acceptFromBoard(cdp, 'pendulum-tower.T1', 'failure-first');
  const runFail = await activateTicket(cdp, 'pendulum-tower', acceptFail.ticketId, 'failure-first');
  expectTrue('F01 T1 run activated for failure route', runFail.commissionId === 'pendulum-tower.T1' && runFail.careerId === careerId, P({ commissionId: runFail.commissionId }));

  step('failure:one-floor');
  await startOverlayGame(cdp, 'failure-first');
  const floor1 = await dropOneTowerFloor(cdp, 0);
  const eventsFail = await cdp.evaluate('window.ArcadeCareer.info().commissionEvents');
  await collapseTower(cdp);
  const failSettle = await waitSettle(cdp, acceptFail.ticketId, 'failure-first');
  expectTrue('F02 only 1 stable floor recorded then settle returns objective-not-met', floor1 === 1 && eventsFail === 1 && failSettle.ok === false && failSettle.reason === 'objective-not-met' && failSettle.observed === 1 && failSettle.objective && failSettle.objective.atLeast === 4 && failSettle.runUpdated === true, P({ floor1, eventsFail, ok: failSettle.ok, reason: failSettle.reason, observed: failSettle.observed, objective: failSettle.objective }));
  const failCard = await waitReceiptCard(cdp, 'failure-first');
  expectTrue('F03 failure receipt card is in-fiction (no raw reason / system words shown)', failCard.state === 'failure' && failCard.text.indexOf('这趟活儿没干成') >= 0 && failCard.text.indexOf('objective-not-met') < 0 && ['奖励', '解锁', '签到', '概率', '生涯模式'].every((word) => failCard.text.indexOf(word) < 0), P({ state: failCard.state, text: failCard.text.slice(0, 200) }));
  let econ = await economy(cdp, careerId, 'failure-after-fail');
  snapshot('failure:after-1-floor-miss', econ, { ticketId: acceptFail.ticketId, result: { reason: failSettle.reason, observed: failSettle.observed } });
  expectEq('F04 failure leaves wallet/materials/equipment untouched', { credits: econ.wallet.credits, items: econ.wallet.items, equipment: econ.equipment }, { credits: 80, items: {}, equipment: {} });
  expectTrue('F05 failure writes no claim and no reward ledger rows; run status failed', econ.counts.claims === 0 && econ.ledger.length === 1 && sumCredits(econ.ledger) === 80, P({ claims: econ.counts.claims, ledger: econ.ledger.map((row) => row.kind) }));
  const failedRun = await cdp.evaluate('window.__arcadeCareerTest.db().getRun(' + P(acceptFail.ticketId) + ')');
  expectTrue('F05b failed run row is recorded as failed (attributable, not silently dropped)', !!failedRun && failedRun.status === 'failed' && failedRun.reason === 'objective-not-met', P(failedRun && { status: failedRun.status, reason: failedRun.reason }));

  /* 失败不阻断：同一告示板再正常完成 T1 */
  step('failure:retry-board');
  await cdp.evaluate('window.ArcadeCareer.openTown()');
  const boardRetry = await boardSnapshot(cdp, 'failure-retry');
  expectTrue('F06 T1 still available after failure (failure did not consume the commission)', boardRetry.accepts.indexOf('pendulum-tower.T1') >= 0, P(boardRetry.accepts));
  await cdp.evaluate('window.ArcadeCareerUI.town.close()');
  const acceptOk = await acceptFromBoard(cdp, 'pendulum-tower.T1', 'failure-retry');
  const runOk = await activateTicket(cdp, 'pendulum-tower', acceptOk.ticketId, 'failure-retry');
  ensure(runOk.commissionId === 'pendulum-tower.T1', 'retry activation failed');
  const flightOk = await flyTower(cdp, 4, 'failure-retry');
  expectTrue('F07 retry run records 4 real floor settles', flightOk.events === 4 && flightOk.after.floors === 4, P({ events: flightOk.events, floors: flightOk.after.floors }));
  const okSettle = await waitSettle(cdp, acceptOk.ticketId, 'failure-retry');
  expectTrue('F08 retry T1 succeeds with full first-time salary (70 + alloy 1)', okSettle.ok === true && okSettle.credits === 70 && okSettle.items && okSettle.items.alloy === 1 && okSettle.repeat === false, P(okSettle));
  econ = await economy(cdp, careerId, 'failure-after-success');
  snapshot('failure:after-retry-success', econ, { ticketId: acceptOk.ticketId });
  expectEq('F09 wallet after failure+success (80 + 70 / alloy 1)', { credits: econ.wallet.credits, items: econ.wallet.items }, { credits: 150, items: { alloy: 1 } });
  expectTrue('F09b failed run added no ledger rows (only success rows present)', econ.ledger.length === 4 && econ.counts.claims === 1, P({ rows: econ.ledger.map((row) => row.kind), claims: econ.counts.claims }));
  assertLedgerInvariants('F10', econ, 150, 1);
  await flushConsole(cdp, 'failure');

  /* 场景六：非战斗代办（alternatives.buy） */
  step('alternative:load-module');
  /* 0.16 产品入口：town 应通过 bridge preload 加载 alternatives 并渲染「港务处代办」。 */
  const wired = await cdp.evaluate(
    'window.ArcadeCareer.openTown().then(function (r) {' +
      '  return new Promise(function (resolve) {' +
      '    setTimeout(function () {' +
      '      resolve({ opened: !!(r && r.ok), hasButtons: document.querySelectorAll("[data-alt-offer]").length > 0, module: !!window.ArcadeCareerAlternatives });' +
      '    }, 300);' +
      '  });' +
      '})'
  );
  expectTrue('A01 town product path loads alternatives.js and renders 代办 offers', wired.opened === true && wired.hasButtons === true && wired.module === true, P(wired));
  if (!wired.hasButtons) {
    state.gaps.push({
      id: 'GAP-1',
      area: 'alternatives.js 产品入口',
      detail: 'bridge/town 未提供代办入口；0.16 玩家路径无法触达该模块。',
      minimalFix: 'bridge openCareerUi() 追加 ensureLazyModule("alternatives") 并在 town.js 渲染 offers。',
    });
  }
  const injected = await cdp.evaluate(
    'new Promise(function (resolve) {' +
      '  var script = document.createElement("script");' +
      '  script.src = "../career/alternatives.js";' +
      '  script.onload = function () { resolve(true); };' +
      '  script.onerror = function () { resolve(false); };' +
      '  document.head.appendChild(script);' +
      '})'
  );
  expectTrue('A02 real alternatives.js module loads & mirrors onto ArcadeCareer.alternatives', injected === true && (await cdp.evaluate('typeof window.ArcadeCareerAlternatives === "object" && window.ArcadeCareer.alternatives === window.ArcadeCareerAlternatives')), P({ injected }));
  const econBeforeAlt = await economy(cdp, careerId, 'alt-before');
  const buy = await cdp.evaluate(
    'window.ArcadeCareerAlternatives.buy({ careerId: ' + P(careerId) + ', offerId: "alt.courier" }).then(function (x) { return { ok: x.ok, reason: x.reason, cost: x.cost, flags: x.flags, evidence: x.evidence, duplicate: x.duplicate, charged: x.charged, questRows: x.questRows, message: x.message }; })'
  );
  expectTrue('A03 alternatives.buy(alt.courier) charges exactly 120 and grants C1.signal', buy.ok === true && buy.cost && buy.cost.credits === 120 && buy.charged === true && buy.duplicate === false && Array.isArray(buy.flags) && buy.flags.indexOf('C1.signal') >= 0, P(buy));
  const econAfterAlt = await economy(cdp, careerId, 'alt-after');
  snapshot('alternative:after-alt-courier', econAfterAlt, { buy: { cost: buy.cost, flags: buy.flags, questRows: buy.questRows } });
  expectEq('A04 wallet only decreases by 120 (150 → 30), materials unchanged', { credits: econAfterAlt.wallet.credits, items: econAfterAlt.wallet.items }, { credits: 30, items: { alloy: 1 } });
  const altPurchaseRows = purchaseRows(econAfterAlt);
  expectTrue('A05 exactly one new purchase ledger row (-120) and no credit increase', altPurchaseRows.length === 1 && altPurchaseRows[0].credits === -120 && econAfterAlt.ledger.filter((row) => row.kind === 'credits').length === econBeforeAlt.ledger.filter((row) => row.kind === 'credits').length, P(altPurchaseRows));
  const questNodes = econAfterAlt.quests.map((row) => row.nodeId).sort();
  expectTrue('A06 quest rows record C1.signal (story) + alt.courier (alternative), cleared', questNodes.indexOf('C1.signal') >= 0 && questNodes.indexOf('alt.courier') >= 0 && econAfterAlt.quests.filter((row) => row.nodeId === 'C1.signal' && row.status === 'cleared').length === 1, P(econAfterAlt.quests));
  const newQuestNodes = econAfterAlt.quests.map((row) => row.nodeId).filter((node) => econBeforeAlt.quests.map((row) => row.nodeId).indexOf(node) < 0);
  expectEq('A07 alternative adds no combat flags / no battle rows (only its own two rows)', newQuestNodes.sort(), ['C1.signal', 'alt.courier']);
  expectTrue('A08 no fake medal: claims unchanged & wallet only decreased', econAfterAlt.counts.claims === econBeforeAlt.counts.claims && econAfterAlt.wallet.credits === econBeforeAlt.wallet.credits - 120, P({ claimsBefore: econBeforeAlt.counts.claims, claimsAfter: econAfterAlt.counts.claims, before: econBeforeAlt.wallet.credits, after: econAfterAlt.wallet.credits }));
  const duplicateBuy = await cdp.evaluate(
    'window.ArcadeCareerAlternatives.buy({ careerId: ' + P(careerId) + ', offerId: "alt.courier" }).then(function (x) { return { ok: x.ok, duplicate: x.duplicate, alreadyDone: x.alreadyDone, charged: x.charged }; })'
  );
  const econDupAlt = await economy(cdp, careerId, 'alt-duplicate');
  expectTrue('A09 repeating the alternative is idempotent (duplicate, zero charge)', duplicateBuy.ok === true && duplicateBuy.duplicate === true && duplicateBuy.charged === false && econDupAlt.wallet.credits === 30 && purchaseRows(econDupAlt).length === 1, P({ duplicateBuy, credits: econDupAlt.wallet.credits, purchases: purchaseRows(econDupAlt).length }));
  assertLedgerInvariants('A10', econDupAlt, 30, 1);
  await flushConsole(cdp, 'alternative');
}

/* ------------------------------------------------------------------ *
 * 场景七：机体效果可见（真实购买云雀 + 经典机库不受影响）
 * ------------------------------------------------------------------ */

async function scenarioShipEffects(cdp) {
  await deleteDatabase(cdp, 'ship-effects');
  step('ship:classic-baseline');
  await go(cdp, state.base + '/apps/arcade/games/star-raid.html?careerTest=1#test', 'ship-classic-page');
  await waitBridge(cdp);
  await waitGameHooks(cdp);
  const classicBefore = await cdp.evaluate(
    '(() => { var h = window.__arcadeTest.hangarInfo(); return { caps: h.caps, credits: h.credits, runs: h.runs, meta: localStorage.getItem("studiokit:arcade:meta:v1") }; })()'
  );
  expectTrue('E01 classic star page baseline captured (old hangar formula:1 caps, empty meta)', classicBefore.caps.damageMul === 1 && classicBefore.caps.moveSpeed === 320 && classicBefore.caps.maxLives === 5 && classicBefore.caps.startingLives === 3 && classicBefore.meta === null, P(classicBefore));

  /* 真实攒钱：层塔 T1 / T2、星海 T1 / T2 */
  await cdp.evaluate('window.ArcadeCareer.openTown()');
  await cdp.waitFor('!!document.querySelector(\'[data-career-panel="town"]\')', { timeout: 12000 });
  await boardSnapshot(cdp, 'ship-fund');
  const careerId = await ensureCareerId(cdp, 'ship-effects');
  state.coverage.chains.push({ name: 'cloud-lark-effects', careerId });
  await cdp.evaluate('window.ArcadeCareerUI.town.close()');

  const sT1 = await acceptFromBoard(cdp, 'pendulum-tower.T1', 'ship-tower-T1');
  await activateTicket(cdp, 'pendulum-tower', sT1.ticketId, 'ship-tower-T1');
  const shipFlightT1 = await flyTower(cdp, 4, 'ship-tower-T1');
  const shipSettleT1 = await waitSettle(cdp, sT1.ticketId, 'ship-tower-T1');
  ensure(shipFlightT1.events === 4 && shipSettleT1.ok === true && shipSettleT1.credits === 70, 'fund T1 failed: ' + P(shipSettleT1));
  expectTrue('E02 funding run 1: tower T1 real 4 floors → 70 credits', shipFlightT1.events === 4 && shipSettleT1.credits === 70 && shipSettleT1.items.alloy === 1, P({ events: shipFlightT1.events, credits: shipSettleT1.credits }));

  await cdp.evaluate('window.ArcadeCareer.openTown()');
  await boardSnapshot(cdp, 'ship-fund-T2');
  await cdp.evaluate('window.ArcadeCareerUI.town.close()');
  const sT2 = await acceptFromBoard(cdp, 'pendulum-tower.T2', 'ship-tower-T2');
  await activateTicket(cdp, 'pendulum-tower', sT2.ticketId, 'ship-tower-T2');
  const shipFlightT2 = await flyTower(cdp, 6, 'ship-tower-T2');
  const shipSettleT2 = await waitSettle(cdp, sT2.ticketId, 'ship-tower-T2');
  expectTrue('E03 funding run 2: tower T2 real 6 floors → 120 credits (objectiveBonus applied)', shipFlightT2.events === 6 && shipSettleT2.ok === true && shipSettleT2.credits === 120 && shipSettleT2.items.alloy === 2, P({ events: shipFlightT2.events, credits: shipSettleT2.credits }));

  const sS1 = await acceptFromBoard(cdp, 'star-raid.T1', 'ship-star-T1');
  await activateStarTicket(cdp, sS1.ticketId, 'ship-star-T1');
  const shipStar1 = await flyStarBoss(cdp, 'ship-star-T1');
  ensure(shipStar1.hit.bossKills === 1, 'fund star T1 boss failed');
  const shipSettleS1 = await waitSettle(cdp, sS1.ticketId, 'ship-star-T1');
  expectTrue('E04 funding run 3: star T1 real boss → 90 credits', shipSettleS1.ok === true && shipSettleS1.credits === 90 && shipSettleS1.items.alloy === 1, P(shipSettleS1));

  await cdp.evaluate('window.ArcadeCareer.openTown()');
  await boardSnapshot(cdp, 'ship-fund-star-T2');
  await cdp.evaluate('window.ArcadeCareerUI.town.close()');
  const sS2 = await acceptFromBoard(cdp, 'star-raid.T2', 'ship-star-T2');
  await activateStarTicket(cdp, sS2.ticketId, 'ship-star-T2');
  const shipStarPre2 = await cdp.evaluate('window.__arcadeTest.careerInfo()');
  const shipStar2 = await flyStarBoss(cdp, 'ship-star-T2');
  const shipSettleS2 = await waitSettle(cdp, sS2.ticketId, 'ship-star-T2');
  expectTrue('E05 funding run 4: star T2 (start level 3 / storm) real boss → 145 credits', shipStarPre2.startLevel === 3 && shipStarPre2.themeId === 'storm' && shipStar2.boss.stage === 3 && shipStar2.boss.theme === 'storm' && shipSettleS2.ok === true && shipSettleS2.credits === 145 && shipSettleS2.items.alloy === 2 && shipSettleS2.items.crystal === 1, P({ pre: { startLevel: shipStarPre2.startLevel, themeId: shipStarPre2.themeId }, boss: shipStar2.boss, credits: shipSettleS2.credits, items: shipSettleS2.items }));
  let econ = await economy(cdp, careerId, 'ship-after-fund');
  snapshot('ship:after-funding', econ, {});
  expectEq('E06 funding complete: wallet 505 / alloy 6 / crystal 1 (all from real work)', { credits: econ.wallet.credits, items: econ.wallet.items }, { credits: 505, items: { alloy: 6, crystal: 1 } });
  await flushConsole(cdp, 'ship-funding');

  /* 真实按钮购买云雀 + 换上 */
  step('ship:hangar-buy-cloud-lark');
  await cdp.evaluate('window.ArcadeCareer.openHangar()');
  await waitHangarReady(cdp, '[data-action="buy"][data-ship-id="cloud-lark"]', 'ship-cloud-lark-buy');
  const buyClick = await cdp.evaluate(
    '(() => { var b = document.querySelector(\'[data-action="buy"][data-ship-id="cloud-lark"]\'); if (!b) return { clicked: false }; if (b.disabled) return { clicked: false, disabled: true, text: b.textContent }; b.click(); return { clicked: true }; })()'
  );
  await cdp.waitFor('(() => { var card = document.querySelector(\'.ac-career-hangar__card[data-ship-id="cloud-lark"]\'); return !!card && card.getAttribute("data-owned") === "true"; })()', { timeout: 15000 });
  const cloudCard = await cdp.evaluate(
    '(() => { var panel = document.querySelector(\'[data-career-panel="hangar"]\'); var card = panel.querySelector(\'.ac-career-hangar__card[data-ship-id="cloud-lark"]\'); var reasons = Array.prototype.slice.call(panel.querySelectorAll("[data-reason]")).map(function (el) { return el.textContent; }); return { owned: card.getAttribute("data-owned"), reasons: reasons, buyText: (card.querySelector(\'[data-action="buy"]\') || {}).textContent }; })()'
  );
  expectTrue('E07 real buy button purchases cloud-lark (480 + alloy 1)', buyClick.clicked === true && cloudCard.owned === 'true' && cloudCard.reasons.some((text) => text.indexOf('登记好了：云雀') >= 0), P({ buyClick, cloudCard }));
  econ = await economy(cdp, careerId, 'ship-after-buy-cloud-lark');
  snapshot('ship:after-buy-cloud-lark', econ, {});
  expectEq('E08 purchase deducts 480 credits + 1 alloy; ownership recorded', { credits: econ.wallet.credits, items: econ.wallet.items, equipment: econ.equipment }, { credits: 25, items: { alloy: 5, crystal: 1 }, equipment: { 'ship:cloud-lark:owned': true } });
  const cloudPurchase = purchaseRows(econ);
  expectTrue('E09 cloud-lark purchase ledger row records cost 480 + costItems alloy 1', cloudPurchase.length === 1 && cloudPurchase[0].credits === -480 && cloudPurchase[0].cost === 480 && cloudPurchase[0].receipt && cloudPurchase[0].receipt.costItems && cloudPurchase[0].receipt.costItems.alloy === 1, P(cloudPurchase));

  step('ship:hangar-equip-cloud-lark');
  await waitHangarReady(cdp, '[data-action="equip"][data-ship-id="cloud-lark"]', 'ship-cloud-lark-equip');
  const equipClick = await cdp.evaluate(
    '(() => { var b = document.querySelector(\'[data-action="equip"][data-ship-id="cloud-lark"]\'); if (!b) return { clicked: false }; if (b.disabled) return { clicked: false, disabled: true, text: b.textContent }; b.click(); return { clicked: true }; })()'
  );
  await cdp.waitFor('(() => { var card = document.querySelector(\'.ac-career-hangar__card[data-ship-id="cloud-lark"]\'); return !!card && card.getAttribute("data-current") === "true"; })()', { timeout: 15000 });
  const equipped = await cdp.evaluate('window.__arcadeCareerTest.db().getEquipment(' + P(careerId) + ')');
  expectTrue('E10 real equip button switches equippedShip to cloud-lark (zero cost)', equipClick.clicked === true && equipped.ok === true && equipped.equipment && equipped.equipment.equippedShip === 'cloud-lark' && equipped.equipment['ship:cloud-lark:owned'] === true, P({ equipClick, equipment: equipped.equipment }));
  await cdp.evaluate('window.ArcadeCareerUI.hangar.close()');
  await flushConsole(cdp, 'ship-hangar');

  /* 出击 star T1：断言机体数值体现火力/机动提升 */
  const sCloud = await acceptFromBoard(cdp, 'star-raid.T1', 'ship-cloud-lark-flight');
  await activateStarTicket(cdp, sCloud.ticketId, 'ship-cloud-lark-flight');
  step('ship:career-stats');
  const cloudCareer = await cdp.evaluate(
    'window.__arcadeCareerTest.db().getEquipment(' + P(careerId) + ').then(function (eq) {' +
      '  var careerInfo = window.__arcadeTest.careerInfo();' +
      '  var config = window.ArcadeCareerCombatConfig || null;' +
      '  var withItems = null;' +
      '  return fetch("../career/content/items.json").then(function (r) { return r.json(); }).then(function (items) {' +
      '    withItems = config ? config.resolveCareerConfig({ equipment: eq.equipment || {}, items: items }) : null;' +
      '    return { careerInfo: careerInfo, equipment: eq.equipment || {}, withItems: withItems, apiItems: window.ArcadeCareer.items || null };' +
      '  });' +
      '})'
  );
  const stats = cloudCareer.careerInfo && cloudCareer.careerInfo.stats ? cloudCareer.careerInfo.stats : {};
  const expected = cloudCareer.withItems || {};
  const cloudStatsOk =
    cloudCareer.careerInfo.shipName === '云雀' &&
    stats.damageMul === 1.06 && stats.damageMul > 1 &&
    stats.speedMul === 1.12 && stats.speedMul > 1 &&
    stats.magnet === 1.06 && stats.energyCap === 95;
  expectTrue('E11 career battle stats show cloud-lark firepower/speed boost (damageMul 1.06 / speedMul 1.12 / ship 云雀)', cloudStatsOk,
    'expected star-combat-config values from items.json · actual ' + P({ shipName: cloudCareer.careerInfo.shipName, stats: stats, statsSource: cloudCareer.careerInfo.statsSource, apiItems: cloudCareer.apiItems ? 'present' : 'null', resolvedWithItems: expected }));
  if (!cloudStatsOk) {
    state.defects.push({
      id: 'DEF-1',
      severity: 'blocking (机体效果不可见)',
      scenario: 'scenario-6-ship-effects',
      step: 'E11/E12',
      symptom: '真实购买并换上云雀后，生涯星海局仍使用旧翼参数（damageMul=1 / speedMul=1 / shipName=旧翼）',
      rootCause: 'bridge.js 只把 items.json 放进 internal.itemsContent（仅 UI ctx 消费），从未挂到公开 API；star-raid.html 的 resolveCareerBattleStats 读 window.ArcadeCareer.items 恒为 null，star-combat-config.resolveCareerConfig({equipment, items:null}) 因缺少飞船目录回退旧翼（equipment.equippedShip 被忽略）。',
      actual: { pageStats: stats, pageShip: cloudCareer.careerInfo.shipName, apiItems: cloudCareer.apiItems, resolvedWithItems: expected },
      minimalFix: 'apps/arcade/career/bridge.js 的 loadCareerContent() 的 all.then（约 885-887 行）内加一行：if (internal.itemsContent) { api.items = internal.itemsContent; }（并在 definePublicApi 里保留 api.items 默认 null）。改完 star-raid.html 现有 career.items 入参即可生效，无需改游戏页。',
      filesNotModified: ['apps/arcade/career/bridge.js', 'apps/arcade/games/star-raid.html'],
    });
  }
  expectTrue('E12 same-page stats match star-combat-config computed from equipped loadout + items.json', expected.shipId === 'cloud-lark' && expected.damageMul === stats.damageMul && expected.speedMul === stats.speedMul, 'page stats ' + P(stats) + ' · computed ' + P(expected));
  expectTrue('E13 career run does not read/write the classic hangar (meta untouched, credits 0, old caps untouched)', cloudCareer.careerInfo.metaRaw === null && cloudCareer.careerInfo.hangarCredits === 0, P({ metaRaw: cloudCareer.careerInfo.metaRaw, hangarCredits: cloudCareer.careerInfo.hangarCredits }));

  /* 完成这次出击，确认经济仍正常（repeat salary） */
  const cloudFlight = await flyStarBoss(cdp, 'ship-cloud-lark-flight');
  const cloudSettle = await waitSettle(cdp, sCloud.ticketId, 'ship-cloud-lark-flight');
  expectTrue('E14 cloud-lark flight defeats boss & settles repeat salary (30, no duplicate)', cloudFlight.hit.bossKills === 1 && cloudSettle.ok === true && cloudSettle.credits === 30 && cloudSettle.repeat === true && cloudSettle.duplicate === false, P({ bossKills: cloudFlight.hit.bossKills, credits: cloudSettle.credits, repeat: cloudSettle.repeat }));
  econ = await economy(cdp, careerId, 'ship-after-flight');
  snapshot('ship:after-cloud-lark-flight', econ, { receipt: { credits: cloudSettle.credits } });
  expectEq('E15 wallet after cloud-lark flight (25 + 30)', economy_creditsOf(econ), 55);
  expectTrue('E16 cloud-lark equipment persisted (owned + equippedShip) after flight, no legacy hangar key', econ.equipment && econ.equipment['ship:cloud-lark:owned'] === true && econ.equipment.equippedShip === 'cloud-lark' && Object.keys(econ.equipment).every((key) => key.indexOf('formula') !== 0), P(econ.equipment));
  assertLedgerInvariants('E17', econ, 55, 5);
  await flushConsole(cdp, 'ship-cloud-lark-flight');

  /* 经典模式机库数值不受影响（同一页无 ?career 快照对比） */
  step('ship:classic-after');
  await go(cdp, state.base + '/apps/arcade/games/star-raid.html?careerTest=1#test', 'ship-classic-after');
  await waitBridge(cdp);
  await waitGameHooks(cdp);
  const classicAfter = await cdp.evaluate(
    '(() => { var h = window.__arcadeTest.hangarInfo(); return { caps: h.caps, credits: h.credits, runs: h.runs, meta: localStorage.getItem("studiokit:arcade:meta:v1") }; })()'
  );
  expectEq('E18 classic hangar caps identical before/after all career activity', classicAfter.caps, classicBefore.caps);
  expectEq('E19 classic hangar meta (studiokit:arcade:meta:v1) untouched by career purchases', { meta: classicAfter.meta, credits: classicAfter.credits, runs: classicAfter.runs }, { meta: classicBefore.meta, credits: classicBefore.credits, runs: classicBefore.runs });
  expectTrue('E20 career economy lives only in IndexedDB (no career localStorage keys)', (await cdp.evaluate('Object.keys(localStorage).filter(function (key) { return key.indexOf("studiokit:arcade:career") === 0; })')).length === 0, 'unexpected career localStorage keys');
  await flushConsole(cdp, 'ship-classic-after');
}

function economy_creditsOf(econ) {
  return econ && econ.wallet ? econ.wallet.credits : null;
}

/* ------------------------------------------------------------------ *
 * 全局收尾断言
 * ------------------------------------------------------------------ */

async function finalChecks(cdp, content) {
  step('final:cleanup');
  const reset = await deleteDatabase(cdp, 'final');
  expectTrue('G01 final deleteDatabase succeeds', reset && reset.ok === true, P(reset));
  await go(cdp, state.base + '/apps/arcade/index.html', 'final-cleanup-check');
  const leftover = await cdp.evaluate(
    'new Promise(function (resolve) {' +
      '  var request = indexedDB.open(' + P(DB_NAME) + ');' +
      '  request.onsuccess = function () { var db = request.result; var names = Array.prototype.slice.call(db.objectStoreNames); db.close(); resolve({ ok: true, stores: names }); };' +
      '  request.onerror = function () { resolve({ ok: false }); };' +
      '})'
  );
  expectTrue('G02 career IndexedDB is recreated empty after cleanup (no economy left behind)', reset.ok === true && leftover && leftover.ok === true, P({ reset, leftover }));
  const sessionLeft = await cdp.evaluate('({ ticket: sessionStorage.getItem(' + P(TICKET_KEY) + '), rental: sessionStorage.getItem(' + P(RENTAL_KEY) + ') })');
  expectTrue('G03 session ticket/rental markers are all consumed', sessionLeft.ticket === null && sessionLeft.rental === null, P(sessionLeft));
  expectEq('G04 console error total across every page segment', state.errors.length, 0);
  expectTrue('G05 every origin sample emitted zero console errors', state.errors.filter((segment) => segment.label.indexOf('origin:') === 0).length === 0, P(state.errors.map((segment) => segment.label)));
  expectEq('G06 runtime origin samples cover at least 6 distinct origins', state.coverage.originsRuntime.length >= 6, true);
  const distinct = uniqueList(state.coverage.originsRuntime);
  expectTrue('G07 runtime samples are all distinct & include tower/star-excluded origins', distinct.length === state.coverage.originsRuntime.length && ORIGIN_SAMPLES.every((gameId) => distinct.indexOf(gameId) >= 0), P(distinct));
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

async function withScenario(name, fn) {
  const start = state.rec.results.length;
  try {
    await fn();
  } catch (err) {
    const detail = (state.step ? state.step + ': ' : '') + (err && err.message ? err.message : String(err));
    state.rec.record(name + ' aborted', false, detail.slice(0, 700));
    state.defects.push({ scenario: name, step: state.step, error: detail.slice(0, 700) });
  }
  const slice = state.rec.results.slice(start);
  const passed = slice.filter((row) => row.ok).length;
  console.log('\n        [' + name + '] ' + passed + '/' + slice.length + ' checks passed');
}

async function runtimeMain() {
  let port = null;
  let cdpPort = null;
  try {
    port = envPort('CAREER_FF_PORT', 8881);
    cdpPort = envPort('CAREER_FF_CDP', 9481);
  } catch (err) {
    throw new InfraError('端口环境变量非法：' + (err && err.message ? err.message : String(err)));
  }
  if (!fs.existsSync(DEFAULT_CHROME)) {
    throw new InfraError('本机 Chrome 不存在：' + DEFAULT_CHROME + '（可用 CHROME_PATH 指定）');
  }
  state.base = 'http://127.0.0.1:' + port;
  try {
    state.server = await startServer({ port });
  } catch (err) {
    throw new InfraError('静态服务器无法监听 ' + port + '：' + (err && err.message ? err.message : String(err)) + '（可用 CAREER_FF_PORT 覆盖）');
  }
  try {
    state.launched = await launchChrome({ port: cdpPort });
  } catch (err) {
    throw new InfraError('Chrome 启动失败（CDP ' + cdpPort + '）：' + (err && err.message ? err.message : String(err)) + '（可用 CAREER_FF_CDP 覆盖）');
  }
  state.cdp = await openPage({ port: cdpPort, width: 420, height: 900 });
  const cdp = state.cdp;

  const content = loadContent();
  await withScenario('scenario-1-origins', () => scenarioOrigins(cdp, content));
  await withScenario('scenario-2-work-buy-star-loot', () => scenarioEconomyChain(cdp, content));
  await withScenario('scenario-3-free-rental', () => scenarioRental(cdp));
  await withScenario('scenario-4-5-failure-and-alternative', () => scenarioFailureAndAlternative(cdp));
  await withScenario('scenario-6-ship-effects', () => scenarioShipEffects(cdp));
  await withScenario('final-cleanup', () => finalChecks(cdp, content));
}

function usage() {
  console.log([
    'StudioKit Arcade Life 0.16 — D16-12 真实经济闭环 E2E',
    '',
    '用法:',
    '  node tools/career_first_flight_test.mjs              # 全量（真实 Chrome + 真实 IndexedDB）',
    '  node tools/career_first_flight_test.mjs --static-only # 只跑静态断言（无 Chrome）',
    '  node tools/career_first_flight_test.mjs --help',
    '',
    '环境变量:',
    '  CAREER_FF_PORT  静态服务器端口（默认 8881）',
    '  CAREER_FF_CDP   Chrome DevTools 端口（默认 9481）',
    '  CHROME_PATH     Chrome 可执行文件路径',
    '',
    '退出码: 0 全部通过 / 1 有失败 / 2 用法或环境错误',
  ].join('\n'));
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.indexOf('--help') >= 0 || argv.indexOf('-h') >= 0) {
    usage();
    return 0;
  }
  const known = ['--static-only', '--full'];
  const unknown = argv.filter((arg) => known.indexOf(arg) < 0);
  if (unknown.length) {
    console.error('未知参数：' + P(unknown));
    usage();
    return 2;
  }
  const staticOnly = argv.indexOf('--static-only') >= 0;
  const rec = createRecorder();
  state.rec = rec;
  const content = loadContent();
  console.log('StudioKit Arcade Life 0.16 — D16-12 first-flight E2E');
  console.log('content: chapter=' + content.chapter.contentVersion + ' commissions=' + content.commissions.contentVersion + ' items=' + content.items.contentVersion);
  console.log('mode: ' + (staticOnly ? 'static-only' : 'real Chrome + real IndexedDB') + '\n');
  runStaticChecks(rec, content);
  if (!staticOnly) {
    try {
      await runtimeMain();
    } catch (err) {
      if (err && err.name === 'InfraError') {
        console.error('\nENV-ERROR ' + err.message);
        await cleanup();
        return 2;
      }
      rec.record('runtime harness', false, (err && err.stack ? err.stack : String(err)).slice(0, 900));
    }
  }
  await cleanup();
  const summary = rec.summary();
  console.log('\nCHECKS_TOTAL ' + summary.passed + '/' + summary.total);
  console.log('SNAPSHOTS ' + state.snapshots.length + ' · DEFECTS ' + state.defects.length + ' · GAPS ' + state.gaps.length);
  state.gaps.forEach((gap) => console.log('GAP ' + P(gap)));
  state.defects.forEach((defect) => console.log('DEFECT ' + P(defect)));
  return summary.failed === 0 ? 0 : 1;
}

async function cleanup() {
  try {
    if (state.cdp) state.cdp.close();
  } catch (err) {
    /* ignore */
  }
  if (state.launched) {
    try {
      await stopChrome(state.launched);
    } catch (err) {
      /* ignore */
    }
  }
  if (state.server) {
    try {
      await new Promise((resolve) => state.server.close(resolve));
    } catch (err) {
      /* ignore */
    }
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    console.error('FATAL ' + (err && err.stack ? err.stack : String(err)));
    process.exit(2);
  });

