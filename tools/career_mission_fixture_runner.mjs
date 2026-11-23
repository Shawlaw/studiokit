#!/usr/bin/env node
/**
 * StudioKit Arcade Life — 0.17 通用委托 fixture runner（D17-02）
 *
 * 职责（docs/arcade-life/ADR-interfaces.md §19.1 / §19.8）：
 * - 动态发现 tools/career_fixture_<gameId>.mjs（16 款），导入并用 commission-schema
 *   校验 fixture 形状；缺失只记录为 missing（不抛异常、不算通过）。
 * - `--validate`：96 委托内容 schema + 16 fixture 形状，输出 PASS/FAIL + 计数 + 每游戏结果。
 * - `--list`：列出内容与 fixture 缺口。
 * - `--self-test`：无 fixture 也验证 runner 自身（schema/事件目录/fixture 形状/退出码语义/缺口报告）。
 * - `--run=<gameId|all>`：通用 Chrome harness，驱动每个 tier 的 success / failure /
 *   suspend / receipt-claim-idempotent 通用证据；fixture 只负责把真实游戏状态驱动到目标附近。
 *
 * 设计约束：
 * - 只使用 Node 内置模块 + tools/lib/arcade_cdp.mjs，无 npm 依赖、不联网；
 * - 不修改游戏页/内容/DB；所有写入只发生在测试 Chrome 的 IndexedDB 与 sessionStorage；
 * - fixture 缺失/导入失败/形状非法都只记录失败原因，绝不伪造 PASS；
 * - 端口显式（CAREER_MISSION_PORT 默认 8920 / CAREER_MISSION_CDP 默认 9520），
 *   端口占用直接报错退出码 2，不静默换端口；
 * - 运行期产物（截图/诊断 JSON）写到仓库外临时目录（CAREER_MISSION_ARTIFACTS 可覆盖）。
 *
 * 退出码约定：0=PASS；1=内容/fixture/tier 失败；2=runner 环境或用法错误。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  REPO_ROOT,
  envPort,
  startServer,
  launchChrome,
  stopChrome,
  openPage,
  sleep,
} from './lib/arcade_cdp.mjs';

const require = createRequire(import.meta.url);
const schema = require('../apps/arcade/career/commission-schema.js');

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

const CAREER_DIR = path.join(REPO_ROOT, 'apps', 'arcade', 'career');
const CONTENT_DIR = path.join(CAREER_DIR, 'content');
const TOOLS_DIR = path.join(REPO_ROOT, 'tools');
/* fixture 默认从 tools/ 发现；CAREER_MISSION_FIXTURE_DIR 仅供自测/隔离环境覆盖（不写仓库）。 */
const FIXTURE_DIR = process.env.CAREER_MISSION_FIXTURE_DIR
  ? path.resolve(process.env.CAREER_MISSION_FIXTURE_DIR)
  : TOOLS_DIR;
const FIXTURE_PREFIX = 'career_fixture_';
const FIXTURE_EXT = '.mjs';
const GAMES = schema.GAME_IDS;
const TIERS = schema.TIERS;
const TICKET_KEY = 'studiokit:arcade:career:ticket.v1';
const DEFAULT_SERVER_PORT = 8920;
const DEFAULT_CDP_PORT = 9520;
const DEFAULT_READY_TIMEOUT_MS = 20000;
const DEFAULT_HANDLER_TIMEOUT_MS = 90000;
const DEFAULT_TIER_TIMEOUT_MS = 240000;
const MAX_HARNESS_ERRORS = 6;
const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_ENV = 2;
/** 结算失败时允许的“目标未达成”归因（ADR §18.2 / §19.2）。 */
const OBJECTIVE_MISS_REASONS = ['objective-not-met', 'value-not-met', 'context-mismatch'];
/** 每 tier 的通用证据（fixture 只负责 success/failure 的真实状态驱动）。 */
const EVIDENCE_CHECKS = ['success', 'receipt-claim', 'failure', 'suspend', 'idempotent'];

/* ------------------------------------------------------------------ *
 * 通用工具
 * ------------------------------------------------------------------ */

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function errorText(err) {
  if (!err) return 'unknown';
  if (typeof err === 'string') return err;
  return typeof err.message === 'string' && err.message ? err.message : String(err);
}

function q(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function pad(value, width) {
  const text = String(value === undefined || value === null ? '' : value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function sortedJson(value) {
  if (Array.isArray(value)) return '[' + value.map(sortedJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => q(key) + ':' + sortedJson(value[key])).join(',') + '}';
  }
  return q(value);
}

function sameJson(a, b) {
  return sortedJson(a) === sortedJson(b);
}

function arrayEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function formatDuration(ms) {
  return (Math.max(0, ms) / 1000).toFixed(1) + 's';
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timeout:' + label + ' after ' + ms + 'ms')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

function diffItems(before, after) {
  const base = isObject(before) ? before : {};
  const next = isObject(after) ? after : {};
  const ids = new Set(Object.keys(base).concat(Object.keys(next)));
  const diff = {};
  ids.forEach((id) => {
    const delta = (Number(next[id]) || 0) - (Number(base[id]) || 0);
    if (delta !== 0) diff[id] = delta;
  });
  return diff;
}

function createCheckList() {
  const list = [];
  return {
    list,
    add(id, ok, detail) {
      list.push({ id, ok: !!ok, detail: detail === undefined || detail === null ? '' : String(detail) });
      return !!ok;
    },
    failed() {
      return list.filter((check) => !check.ok);
    },
  };
}

function writeArtifact(dir, name, payload) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2), 'utf8');
    return file;
  } catch (err) {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 内容 / fixture 装载
 * ------------------------------------------------------------------ */

function readJsonFile(file, label) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (err) {
    return { ok: false, error: label + ': ' + errorText(err) };
  }
}

/**
 * 读取 0.17 内容与注册表；注册表/材料目录用于把 schema 校验绑定到真实集合（避免复制漂移）。
 * @returns {{ok:boolean, errors:string[], commissions:object|null, options:object}}
 */
function loadContentBundle() {
  const errors = [];
  const commissions = readJsonFile(path.join(CONTENT_DIR, 'commissions.json'), 'content/commissions.json');
  if (!commissions.ok) errors.push(commissions.error);
  const registry = readJsonFile(path.join(CONTENT_DIR, 'registry.json'), 'content/registry.json');
  if (!registry.ok) errors.push(registry.error);
  const items = readJsonFile(path.join(CONTENT_DIR, 'items.json'), 'content/items.json');
  if (!items.ok) errors.push(items.error);

  const options = {};
  if (registry.ok && isObject(registry.value)) {
    if (Array.isArray(registry.value.games)) {
      options.gameIds = registry.value.games.map((game) => (isObject(game) ? game.gameId : null)).filter((id) => typeof id === 'string');
    }
    if (Array.isArray(registry.value.professions)) {
      options.professionIds = registry.value.professions
        .map((profession) => (isObject(profession) ? profession.professionId : null))
        .filter((id) => typeof id === 'string');
    }
  }
  if (items.ok && isObject(items.value) && Array.isArray(items.value.materials)) {
    options.materialIds = items.value.materials
      .map((material) => (isObject(material) ? material.itemId : null))
      .filter((id) => typeof id === 'string');
  }
  return {
    ok: errors.length === 0,
    errors,
    commissions: commissions.ok ? commissions.value : null,
    registry: registry.ok ? registry.value : null,
    items: items.ok ? items.value : null,
    options,
  };
}

function validateLoadedContent(bundle, extraOptions) {
  if (!bundle || !bundle.commissions) {
    return {
      ok: false,
      errors: (bundle && bundle.errors ? bundle.errors.slice() : ['content-unavailable']),
      warnings: [],
      counts: { games: 0, tiers: TIERS.length, total: 0 },
      perGame: {},
    };
  }
  const options = Object.assign({}, bundle.options, extraOptions || {});
  return schema.validateCommissionContent(bundle.commissions, options);
}

/** 内容按 gameId → tier 建索引（fixture 阈值驱动用）。 */
function buildContentIndex(commissions) {
  const index = {};
  if (!isObject(commissions) || !Array.isArray(commissions.commissions)) return index;
  commissions.commissions.forEach((commission) => {
    if (!isObject(commission) || typeof commission.gameId !== 'string' || typeof commission.tier !== 'number') return;
    if (!index[commission.gameId]) index[commission.gameId] = {};
    index[commission.gameId][commission.tier] = commission;
  });
  return index;
}

function fixtureRelPath(gameId) {
  return (process.env.CAREER_MISSION_FIXTURE_DIR ? FIXTURE_DIR + '/' : 'tools/') + FIXTURE_PREFIX + gameId + FIXTURE_EXT;
}

function fixtureFilePath(gameId) {
  return path.join(FIXTURE_DIR, FIXTURE_PREFIX + gameId + FIXTURE_EXT);
}

/** 16 款游戏的 fixture 发现结果（不抛异常）。 */
function discoverFixtures() {
  return GAMES.map((gameId) => {
    const file = fixtureFilePath(gameId);
    let present = false;
    try {
      present = fs.existsSync(file);
    } catch (err) {
      present = false;
    }
    return { gameId, file, rel: fixtureRelPath(gameId), present };
  });
}

function pickFixtureModule(mod) {
  if (!mod) return null;
  if (typeof mod.gameId === 'string' || isObject(mod.tiers)) {
    return { gameId: mod.gameId, tiers: mod.tiers, cleanup: mod.cleanup };
  }
  if (mod.default && isObject(mod.default)) {
    return { gameId: mod.default.gameId, tiers: mod.default.tiers, cleanup: mod.default.cleanup };
  }
  return { gameId: mod.gameId, tiers: mod.tiers, cleanup: mod.cleanup };
}

async function loadFixtureModule(entry) {
  try {
    const mod = await import(pathToFileURL(entry.file).href);
    return { ok: true, fixture: pickFixtureModule(mod) };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

/**
 * 校验 16 个 fixture 形状；返回逐游戏结果。
 * @returns {Promise<{entries:Array, present:number, ok:number, invalid:number, missing:number}>}
 */
async function validateFixtures() {
  const entries = [];
  let present = 0;
  let ok = 0;
  let invalid = 0;
  let missing = 0;
  for (const entry of discoverFixtures()) {
    const result = { gameId: entry.gameId, rel: entry.rel, present: entry.present, status: 'missing', errors: [], warnings: [], fixture: null };
    if (!entry.present) {
      missing += 1;
      entries.push(result);
      continue;
    }
    present += 1;
    const loaded = await loadFixtureModule(entry);
    if (!loaded.ok) {
      result.status = 'invalid';
      result.errors.push('import-failed[' + entry.gameId + ']: ' + loaded.error);
      invalid += 1;
      entries.push(result);
      continue;
    }
    result.fixture = loaded.fixture;
    const shape = schema.validateFixtureShape(loaded.fixture);
    result.errors.push.apply(result.errors, shape.errors);
    result.warnings.push.apply(result.warnings, shape.warnings);
    if (loaded.fixture && loaded.fixture.gameId !== entry.gameId) {
      result.errors.push('fixture-gameid-mismatch[' + entry.gameId + ']: 导出 gameId 为 ' + q(loaded.fixture.gameId));
    }
    if (result.errors.length) {
      result.status = 'invalid';
      invalid += 1;
    } else {
      result.status = 'ok';
      ok += 1;
    }
    entries.push(result);
  }
  return { entries, present, ok, invalid, missing };
}

/* ------------------------------------------------------------------ *
 * 报告
 * ------------------------------------------------------------------ */

function reportContent(result, options) {
  const strict = !!(options && options.strict);
  const total = result.counts ? result.counts.total : 0;
  const games = result.counts ? result.counts.games : 0;
  const tiers = result.counts ? result.counts.tiers : 0;
  if (result.ok) {
    console.log('PASS  content-schema  ' + total + '/' + total + '  games=' + games + '  tiers=' + tiers);
  } else {
    console.log('FAIL  content-schema  ' + result.errors.length + ' error(s)  games=' + games + '  tiers=' + tiers);
    result.errors.forEach((item) => console.log('  FAIL  ' + item));
  }
  if (result.warnings && result.warnings.length) {
    const label = strict ? 'FAIL' : 'WARN';
    result.warnings.forEach((item) => console.log('  ' + label + '  ' + item));
  }
  return result.ok && (!strict || !(result.warnings && result.warnings.length));
}

/**
 * --validate 退出码：内容失败（或 --strict 下告警）→1；fixture 形状失败 →1；
 * 缺失 fixture 默认只告警（--strict 视为失败）；其余 0。
 */
function computeValidateExitCode(summary, options) {
  const strict = !!(options && options.strict);
  if (!summary || summary.envError) return EXIT_ENV;
  const contentFailed = !summary.contentOk || (strict && summary.contentWarnings > 0);
  const fixturesFailed = summary.fixtureErrors > 0 || (strict && summary.missing > 0);
  return contentFailed || fixturesFailed ? EXIT_FAIL : EXIT_PASS;
}

/* ------------------------------------------------------------------ *
 * 浏览器表达式
 * ------------------------------------------------------------------ */

const READY_EXPR = `(async () => {
  const api = window.ArcadeCareer;
  if (!api || typeof api.ready === 'undefined') return { ok: false, reason: 'no-bridge' };
  let value = null;
  try { value = await api.ready; } catch (e) { return { ok: false, reason: 'ready-rejected' }; }
  return {
    ok: true,
    available: !!(value && value.available),
    reason: (value && value.reason) || api.reason || null,
    gameId: api.gameId || null,
    testMode: !!window.__arcadeCareerTest,
  };
})()`;

const LOCATION_EXPR = `(() => ({
  ok: true,
  path: String(location.pathname || ''),
  search: String(location.search || ''),
  hash: String(location.hash || ''),
}))()`;

const STATE_EXPR = `(() => {
  const t = window.__arcadeCareerTest || null;
  const api = window.ArcadeCareer || null;
  const call = (fn) => { try { return typeof fn === 'function' ? fn() : null; } catch (e) { return null; } };
  let ticket = null;
  try {
    const raw = sessionStorage.getItem(${q(TICKET_KEY)});
    ticket = raw ? JSON.parse(raw) : null;
  } catch (e) { ticket = null; }
  return {
    ok: true,
    href: String(location.href || ''),
    hash: String(location.hash || ''),
    gameId: (api && api.gameId) || null,
    info: t ? call(t.info) : null,
    commissionRun: t ? call(t.commissionRun) : null,
    commissionState: t ? call(t.commissionState) : null,
    ticket: ticket,
  };
})()`;

const ENSURE_COMMISSION_EXPR = `(async () => {
  const api = window.ArcadeCareer;
  if (!api) return { ok: false, reason: 'no-bridge' };
  const ready = () => !!(api.commission && typeof api.commission.start === 'function');
  if (ready()) return { ok: true, via: 'preloaded' };
  const warm = async (fn) => {
    if (typeof fn !== 'function') return;
    try { await fn.call(api); } catch (e) { /* UI 缺内容时失败不影响模块装载 */ }
  };
  await warm(api.openTown);
  if (ready()) return { ok: true, via: 'openTown' };
  await warm(api.openReceipt);
  if (ready()) return { ok: true, via: 'openReceipt' };
  await warm(api.openTown);
  if (ready()) return { ok: true, via: 'openTown-retry' };
  return { ok: false, reason: 'commission-module-unavailable' };
})()`;

const CLOSE_UI_EXPR = `(() => {
  try {
    const ui = window.ArcadeCareerUI;
    if (ui && ui.town && typeof ui.town.close === 'function') ui.town.close();
  } catch (e) { /* ignore */ }
  try {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  } catch (e) { /* ignore */ }
  return { ok: true };
})()`;

const CLEAR_TICKET_EXPR = `(() => {
  try { sessionStorage.removeItem(${q(TICKET_KEY)}); return { ok: true }; } catch (e) { return { ok: false, reason: 'storage-unavailable' }; }
})()`;

const READ_TICKET_EXPR = `(() => {
  try {
    const raw = sessionStorage.getItem(${q(TICKET_KEY)});
    if (!raw) return { ok: false, reason: 'no-ticket' };
    return { ok: true, ticket: JSON.parse(raw) };
  } catch (e) { return { ok: false, reason: 'ticket-parse-failed' }; }
})()`;

function ensureCareerExpr(gameId) {
  return `(async () => {
    const t = window.__arcadeCareerTest;
    const db = t && typeof t.db === 'function' ? t.db() : null;
    if (!db || typeof db.ensureCareer !== 'function') return { ok: false, reason: 'db-unavailable' };
    let r = null;
    try { r = await db.ensureCareer({ originGameId: ${q(gameId)} }); } catch (e) { return { ok: false, reason: 'ensure-career-threw' }; }
    if (!r || !r.ok || typeof r.careerId !== 'string') return { ok: false, reason: (r && r.reason) || 'ensure-career-failed' };
    return { ok: true, careerId: r.careerId, created: r.created === true };
  })()`;
}

function putQuestsExpr(careerId, rows) {
  return `(async () => {
    const t = window.__arcadeCareerTest;
    const db = t && typeof t.db === 'function' ? t.db() : null;
    if (!db || typeof db.putQuests !== 'function') return { ok: false, reason: 'db-unavailable' };
    let r = null;
    try { r = await db.putQuests(${q(careerId)}, ${q(rows)}); } catch (e) { return { ok: false, reason: 'put-quests-threw' }; }
    if (!r || !r.ok) return { ok: false, reason: (r && r.reason) || 'put-quests-failed' };
    return { ok: true, count: typeof r.count === 'number' ? r.count : ${rows.length} };
  })()`;
}

function startCommissionExpr(commissionId, careerId) {
  return `(async () => {
    const api = window.ArcadeCareer;
    if (!api || !api.commission || typeof api.commission.start !== 'function') return { ok: false, reason: 'commission-module-unavailable' };
    let r = null;
    try { r = await api.commission.start({ commissionId: ${q(commissionId)}, careerId: ${q(careerId)} }); } catch (e) { return { ok: false, reason: 'start-threw' }; }
    if (!r || !r.ok) return { ok: false, reason: (r && r.reason) || 'start-failed', message: (r && r.message) || null };
    return {
      ok: true,
      ticketId: r.ticketId || null,
      careerId: r.careerId || null,
      commissionId: r.commissionId || null,
      gameId: r.gameId || null,
      url: r.url || null,
      reused: r.reused === true,
    };
  })()`;
}

function settleExpr(outcome, stats) {
  return `(async () => {
    const api = window.ArcadeCareer;
    if (!api || typeof api.finish !== 'function') return { ok: false, reason: 'bridge-unavailable' };
    if (typeof api.isCommissionRun === 'function' && !api.isCommissionRun()) return { ok: false, reason: 'no-commission-run' };
    let r = null;
    try { r = await api.finish({ mode: 'classic', outcome: ${q(outcome)}, stats: ${q(stats || {})} }); } catch (e) { return { ok: false, reason: 'finish-threw' }; }
    if (r === null || typeof r !== 'object') return { ok: false, reason: 'finish-null' };
    return r;
  })()`;
}

function resettleExpr(ticketId, outcome, stats) {
  return `(async () => {
    const api = window.ArcadeCareer;
    if (!api || !api.commission || typeof api.commission.settle !== 'function') return { ok: false, reason: 'commission-module-unavailable' };
    let r = null;
    try { r = await api.commission.settle({ ticketId: ${q(ticketId)}, outcome: ${q(outcome)}, stats: ${q(stats || {})} }); } catch (e) { return { ok: false, reason: 'settle-threw' }; }
    if (!r || typeof r !== 'object') return { ok: false, reason: 'settle-null' };
    return r;
  })()`;
}

function abandonExpr(ticketId) {
  return `(async () => {
    const api = window.ArcadeCareer;
    if (!api || !api.commission || typeof api.commission.abandon !== 'function') return { ok: false, reason: 'commission-module-unavailable' };
    let r = null;
    try { r = await api.commission.abandon(${q(ticketId)}); } catch (e) { return { ok: false, reason: 'abandon-threw' }; }
    if (!r || typeof r !== 'object') return { ok: false, reason: 'abandon-null' };
    return r;
  })()`;
}

function walletExpr(careerId) {
  return `(async () => {
    const api = window.ArcadeCareer;
    const t = window.__arcadeCareerTest;
    const db = t && typeof t.db === 'function' ? t.db() : null;
    const careerId = ${q(careerId)};
    if (api && api.commission && typeof api.commission.getWallet === 'function') {
      let r = null;
      try { r = await api.commission.getWallet({ careerId: careerId }); } catch (e) { r = null; }
      if (r && r.ok) return { ok: true, source: 'commission', credits: Number(r.credits) || 0, items: r.items || {} };
    }
    if (db && typeof db.readWallet === 'function') {
      let w = null;
      try { w = await db.readWallet(careerId); } catch (e) { w = null; }
      if (w && w.ok) return { ok: true, source: 'db', credits: Number(w.credits) || 0, items: w.items || {} };
    }
    return { ok: false, reason: 'wallet-unavailable' };
  })()`;
}

function questsExpr(careerId) {
  return `(async () => {
    const t = window.__arcadeCareerTest;
    const db = t && typeof t.db === 'function' ? t.db() : null;
    if (!db || typeof db.readQuestState !== 'function') return { ok: false, reason: 'db-unavailable' };
    let r = null;
    try { r = await db.readQuestState(${q(careerId)}); } catch (e) { return { ok: false, reason: 'quests-threw' }; }
    if (!r || !r.ok) return { ok: false, reason: (r && r.reason) || 'quests-unavailable' };
    return { ok: true, quests: Array.isArray(r.quests) ? r.quests : [] };
  })()`;
}

function claimExpr(runId) {
  return `(async () => {
    const t = window.__arcadeCareerTest;
    const db = t && typeof t.db === 'function' ? t.db() : null;
    if (!db || typeof db.getClaim !== 'function') return { ok: false, reason: 'db-unavailable' };
    let row = null;
    try { row = await db.getClaim(${q(runId)}); } catch (e) { return { ok: false, reason: 'claim-threw' }; }
    return row ? { ok: true, claim: row } : { ok: false, reason: 'no-claim' };
  })()`;
}

function runRowExpr(runId) {
  return `(async () => {
    const t = window.__arcadeCareerTest;
    const db = t && typeof t.db === 'function' ? t.db() : null;
    if (!db || typeof db.getRun !== 'function') return { ok: false, reason: 'db-unavailable' };
    let row = null;
    try { row = await db.getRun(${q(runId)}); } catch (e) { return { ok: false, reason: 'run-threw' }; }
    return row ? { ok: true, run: row } : { ok: false, reason: 'no-run' };
  })()`;
}

function ledgerExpr(careerId) {
  return `(async () => {
    const t = window.__arcadeCareerTest;
    const db = t && typeof t.db === 'function' ? t.db() : null;
    if (!db || typeof db.readLedger !== 'function') return { ok: false, reason: 'db-unavailable' };
    let r = null;
    try { r = await db.readLedger(${q(careerId)}, 50); } catch (e) { return { ok: false, reason: 'ledger-threw' }; }
    if (!r || !r.ok) return { ok: false, reason: (r && r.reason) || 'ledger-unavailable' };
    return { ok: true, rows: Array.isArray(r.rows) ? r.rows : [] };
  })()`;
}

/* ------------------------------------------------------------------ *
 * Chrome harness
 * ------------------------------------------------------------------ */

class MissionHarness {
  constructor(options) {
    const opts = isObject(options) ? options : {};
    this.port = opts.port;
    this.cdpPort = opts.cdpPort;
    this.chromePath = opts.chromePath || undefined;
    this.artifactsDir = opts.artifactsDir;
    this.baseUrl = 'http://127.0.0.1:' + this.port;
    this.server = null;
    this.chrome = null;
    this.chromeProfile = null;
    this.page = null;
    this.harnessErrors = 0;
  }

  async start() {
    this.server = await startServer({ port: this.port, root: REPO_ROOT });
    let launched = null;
    try {
      launched = await launchChrome({
        port: this.cdpPort,
        chromePath: this.chromePath,
        profilePrefix: 'studiokit-career-mission-',
        windowSize: '430,932',
      });
    } catch (err) {
      await this.stop();
      throw err;
    }
    this.chrome = launched.chrome;
    this.chromeProfile = launched.profile;
    this.page = await openPage({
      port: this.cdpPort,
      url: 'about:blank',
      width: 420,
      height: 900,
      artifactsDir: this.artifactsDir,
    });
  }

  async stop() {
    try {
      if (this.page) this.page.close();
    } catch (err) {
      /* ignore */
    }
    try {
      await stopChrome({ chrome: this.chrome, profile: this.chromeProfile });
    } catch (err) {
      /* ignore */
    }
    if (this.server) {
      await new Promise((resolve) => this.server.close(() => resolve()));
    }
    this.server = null;
    this.page = null;
    this.chrome = null;
  }

  gameUrl(gameId, ticketId) {
    const params = [];
    if (typeof ticketId === 'string' && ticketId) params.push('career=' + encodeURIComponent(ticketId));
    params.push('careerTest=1');
    return this.baseUrl + '/apps/arcade/games/' + gameId + '.html?' + params.join('&') + '#test';
  }

  /**
   * 统一 evaluate：只有真正的 CDP/页面异常才返回 {ok:false}；
   * 页面返回的领域结果（例如 settle 的 ok:false）原样放在 {ok:true, value} 里，
   * 由各 harness 方法按业务语义解释，避免把“可归因失败”误判成浏览器故障。
   */
  async evaluate(expression, label) {
    try {
      const value = await this.page.evaluate(expression);
      return { ok: true, value: value };
    } catch (err) {
      this.harnessErrors += 1;
      return { ok: false, reason: 'evaluate-error', detail: (label || 'evaluate') + ': ' + errorText(err) };
    }
  }

  async navigate(url, label) {
    try {
      await this.page.navigate(url);
      return { ok: true };
    } catch (err) {
      this.harnessErrors += 1;
      return { ok: false, reason: 'navigate-error', detail: (label || 'navigate') + ': ' + errorText(err) };
    }
  }

  async location() {
    return this.evaluate(LOCATION_EXPR, 'location');
  }

  async waitReady(timeoutMs) {
    const budget = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : DEFAULT_READY_TIMEOUT_MS;
    const deadline = Date.now() + budget;
    let last = null;
    while (Date.now() < deadline) {
      const res = await this.evaluate(READY_EXPR, 'wait-ready');
      if (res.ok && isObject(res.value) && res.value.ok === true && res.value.testMode === true) return res.value;
      last = res.ok ? res.value : res;
      await sleep(120);
    }
    return {
      ok: false,
      reason: 'bridge-not-ready',
      detail: last && last.reason ? String(last.reason) : 'ArcadeCareer.ready 未在 ' + budget + 'ms 内就绪',
    };
  }

  /** 打开目标游戏的普通（无 ticket）测试页，等桥/测试钩子就绪。 */
  async openGame(gameId) {
    const nav = await this.navigate(this.gameUrl(gameId), 'open-game');
    if (!nav.ok) return nav;
    const ready = await this.waitReady();
    if (!ready.ok) return { ok: false, reason: ready.reason, detail: ready.detail };
    if (ready.gameId !== gameId) {
      return { ok: false, reason: 'game-mismatch', detail: 'expected ' + gameId + ', got ' + q(ready.gameId) };
    }
    return { ok: true, ready };
  }

  /** 若当前已在目标游戏普通测试页则复用（不重复导航）。 */
  async ensurePlainPage(gameId) {
    const loc = await this.location();
    if (loc.ok && isObject(loc.value)) {
      const target = '/apps/arcade/games/' + gameId + '.html';
      const atTarget = String(loc.value.path || '').endsWith(target) && !/(?:^|[?&])career=/.test(String(loc.value.search || ''));
      if (atTarget) return { ok: true, reused: true };
    }
    return this.openGame(gameId);
  }

  async ensureCareer(gameId) {
    const res = await this.evaluate(ensureCareerExpr(gameId), 'ensure-career');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'ensure-career-invalid' };
  }

  async clearTicket() {
    const res = await this.evaluate(CLEAR_TICKET_EXPR, 'clear-ticket');
    return res.ok ? res.value : { ok: false, reason: res.reason, detail: res.detail };
  }

  async readTicket() {
    const res = await this.evaluate(READ_TICKET_EXPR, 'read-ticket');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'ticket-invalid' };
  }

  async putQuests(careerId, rows) {
    const res = await this.evaluate(putQuestsExpr(careerId, rows), 'put-quests');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'put-quests-invalid' };
  }

  /** 机械补齐线性解锁链（把 T<tier 的 commissionCleared 写成 quests 行）。 */
  async seedTierUnlock(gameId, careerId, tier) {
    const rows = [];
    const now = new Date().toISOString();
    for (let lower = 1; lower < tier; lower += 1) {
      rows.push({
        nodeId: gameId + '.T' + lower,
        kind: 'commission',
        status: 'cleared',
        clearedAt: now,
        evidence: [],
        flags: [],
      });
    }
    if (!rows.length) return { ok: true, count: 0 };
    return this.putQuests(careerId, rows);
  }

  /** 受控剧情旗标（仅 T4–T6 fixture 使用）：写 quests 行的 flags 集合。 */
  async seedStoryFlags(careerId, flags) {
    const now = new Date().toISOString();
    const rows = [];
    (Array.isArray(flags) ? flags : []).forEach((flag) => {
      if (typeof flag !== 'string' || !flag) return;
      rows.push({ nodeId: flag, kind: 'story', status: 'cleared', clearedAt: now, evidence: [], flags: [flag] });
    });
    if (!rows.length) return { ok: true, count: 0 };
    return this.putQuests(careerId, rows);
  }

  async ensureCommissionModule() {
    const res = await this.evaluate(ENSURE_COMMISSION_EXPR, 'ensure-commission');
    if (!res.ok) return res;
    const value = isObject(res.value) ? res.value : { ok: false, reason: 'commission-module-invalid' };
    await this.evaluate(CLOSE_UI_EXPR, 'close-ui');
    return value;
  }

  async startCommissionRaw(commissionId, careerId) {
    const res = await this.evaluate(startCommissionExpr(commissionId, careerId), 'start-commission');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'start-invalid' };
  }

  /**
   * 接单全流程（ADR §18.7「接单后跳转对应游戏页」）：
   * 干净页 → 确保生涯 → 补线性解锁链 → 确保委托模块 → start → 校验 ticket 落盘
   * → 导航到 `?career=<ticketId>&careerTest=1#test` 并等待 `info().commissionRun` 激活。
   * fixture 里 `await helpers.startCommission(tier)` 返回时委托 run 已在真实页面激活。
   */
  async startCommissionFlow(input) {
    const opts = isObject(input) ? input : {};
    const gameId = opts.gameId;
    const tier = Number(opts.tier);
    if (GAMES.indexOf(gameId) < 0) return { ok: false, reason: 'bad-game-id', detail: q(gameId) };
    if (TIERS.indexOf(tier) < 0) return { ok: false, reason: 'bad-tier', detail: q(opts.tier) };
    const commissionId = gameId + '.T' + tier;
    const plain = await this.ensurePlainPage(gameId);
    if (!plain.ok) return plain;
    const career = opts.careerId ? { ok: true, careerId: opts.careerId } : await this.ensureCareer(gameId);
    if (!career.ok) return { ok: false, reason: 'career-unavailable', detail: career.reason || null };
    await this.clearTicket();
    const chain = await this.seedTierUnlock(gameId, career.careerId, tier);
    if (!chain.ok) return { ok: false, reason: 'seed-tier-unlock-failed', detail: chain.reason || null };
    const moduleReady = await this.ensureCommissionModule();
    if (!moduleReady.ok) return moduleReady;
    const started = await this.startCommissionRaw(commissionId, career.careerId);
    if (!started.ok) return started;
    const stored = await this.readTicket();
    if (!stored.ok || !isObject(stored.ticket) || stored.ticket.ticketId !== started.ticketId) {
      return {
        ok: false,
        reason: 'ticket-not-stored',
        detail: stored.ok ? 'sessionStorage ticket 缺失/不匹配' : String(stored.reason),
      };
    }
    const activated = await this.navigateCommission(gameId, started.ticketId, commissionId);
    if (!activated.ok) {
      return {
        ok: false,
        reason: 'commission-not-activated',
        detail: String(activated.reason || 'unknown') + (activated.detail ? ' · ' + activated.detail : ''),
        ticketId: started.ticketId,
      };
    }
    return {
      ok: true,
      commissionId,
      ticketId: started.ticketId,
      careerId: started.careerId || career.careerId,
      url: started.url || null,
      reused: started.reused === true,
      commissionRun: activated.commissionRun || null,
    };
  }

  /** 导航到带 ticket 的委托页并等待 commissionRun 激活。 */
  async navigateCommission(gameId, ticketId, expectedCommissionId, timeoutMs) {
    if (typeof ticketId !== 'string' || !ticketId) return { ok: false, reason: 'no-ticket' };
    const nav = await this.navigate(this.gameUrl(gameId, ticketId), 'navigate-commission');
    if (!nav.ok) return nav;
    const ready = await this.waitReady();
    if (!ready.ok) return { ok: false, reason: ready.reason, detail: ready.detail };
    return this.waitCommissionRun(ticketId, expectedCommissionId, timeoutMs);
  }

  async waitCommissionRun(ticketId, expectedCommissionId, timeoutMs) {
    const budget = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 15000;
    const deadline = Date.now() + budget;
    let lastReason = null;
    while (Date.now() < deadline) {
      const res = await this.readState();
      if (res.ok && isObject(res.state)) {
        const run = res.state.commissionRun;
        if (isObject(run) && (!ticketId || run.ticketId === ticketId)) {
          if (expectedCommissionId && run.commissionId !== expectedCommissionId) {
            return { ok: false, reason: 'commission-mismatch', detail: 'expected ' + expectedCommissionId + ', got ' + q(run.commissionId) };
          }
          return { ok: true, commissionRun: run, state: res.state };
        }
        const info = res.state.info;
        if (info && typeof info.reason === 'string' && info.reason) lastReason = info.reason;
      }
      await sleep(150);
    }
    return { ok: false, reason: 'commission-run-missing', detail: lastReason || 'commissionRun 未在 ' + budget + 'ms 内激活' };
  }

  async readState() {
    const res = await this.evaluate(STATE_EXPR, 'read-state');
    if (!res.ok) return res;
    return isObject(res.value) ? { ok: true, state: res.value } : { ok: false, reason: 'state-invalid' };
  }

  async reloadAndWait(ticketId, expectedCommissionId, timeoutMs) {
    try {
      await this.page.send('Page.reload', { ignoreCache: true });
    } catch (err) {
      this.harnessErrors += 1;
      return { ok: false, reason: 'reload-error', detail: errorText(err) };
    }
    await sleep(250);
    const ready = await this.waitReady(timeoutMs);
    if (!ready.ok) return { ok: false, reason: ready.reason, detail: ready.detail };
    return this.waitCommissionRun(ticketId, expectedCommissionId, timeoutMs);
  }

  async settle(outcome, stats) {
    const res = await this.evaluate(settleExpr(outcome, stats), 'settle');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'settle-invalid' };
  }

  async resettle(ticketId, outcome, stats) {
    const res = await this.evaluate(resettleExpr(ticketId, outcome, stats), 'resettle');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'resettle-invalid' };
  }

  async abandon(ticketId) {
    const res = await this.evaluate(abandonExpr(ticketId), 'abandon');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'abandon-invalid' };
  }

  async wallet(careerId) {
    const res = await this.evaluate(walletExpr(careerId), 'wallet');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'wallet-invalid' };
  }

  async quests(careerId) {
    const res = await this.evaluate(questsExpr(careerId), 'quests');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'quests-invalid' };
  }

  async claim(runId) {
    const res = await this.evaluate(claimExpr(runId), 'claim');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'claim-invalid' };
  }

  async runRow(runId) {
    const res = await this.evaluate(runRowExpr(runId), 'run-row');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'run-invalid' };
  }

  async ledger(careerId) {
    const res = await this.evaluate(ledgerExpr(careerId), 'ledger');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'ledger-invalid' };
  }

  async screenshot(name) {
    try {
      return await this.page.screenshot(name);
    } catch (err) {
      return null;
    }
  }
}

/* ------------------------------------------------------------------ *
 * 证据上下文 / helpers（ADR §19.8：ctx = { cdp, page, port, tier, helpers }）
 * ------------------------------------------------------------------ */

function createSession(h, gameId, tier, commission, careerId) {
  const session = {
    gameId,
    tier,
    commissionId: gameId + '.T' + tier,
    commission,
    careerId: careerId || null,
    ticketId: null,
    active: false,
    settled: false,
    result: null,
  };
  const helpers = {
    async startCommission(tierArg) {
      const target = Number.isInteger(tierArg) ? tierArg : tier;
      if (target !== tier) return { ok: false, reason: 'tier-mismatch', detail: 'helper tier=' + target + ' != ctx.tier=' + tier };
      if (session.ticketId) return { ok: false, reason: 'already-started', ticketId: session.ticketId };
      const started = await h.startCommissionFlow({ gameId, tier: target, careerId: session.careerId });
      /* 即使激活失败也保留 ticketId（便于 runner 清理 run / 诊断），但不标记 active。 */
      if (started.ticketId && !session.ticketId) {
        session.ticketId = started.ticketId;
        if (started.careerId) session.careerId = started.careerId;
      }
      if (!started.ok) return started;
      session.active = true;
      session.commissionRun = started.commissionRun || null;
      return {
        ok: true,
        commissionId: started.commissionId,
        ticketId: started.ticketId,
        careerId: session.careerId,
        url: started.url || null,
        reused: started.reused === true,
        commissionRun: session.commissionRun,
      };
    },
    async navigateGame() {
      if (!session.ticketId) return { ok: false, reason: 'no-ticket' };
      /* startCommission 已进入委托页；这里优先复用已激活 run（fixture 两种写法都成立）。 */
      const current = await h.readState();
      if (current.ok && isObject(current.state) && isObject(current.state.commissionRun) && current.state.commissionRun.ticketId === session.ticketId) {
        session.active = true;
        session.commissionRun = current.state.commissionRun;
        return { ok: true, reused: true, commissionRun: current.state.commissionRun };
      }
      const res = await h.navigateCommission(gameId, session.ticketId, session.commissionId);
      if (res.ok) {
        session.active = true;
        session.commissionRun = res.commissionRun || null;
      }
      return { ok: res.ok, reason: res.reason, detail: res.detail, commissionRun: res.commissionRun || null };
    },
    async seedStoryFlags(flags) {
      let careerId = session.careerId;
      if (!careerId) {
        const career = await h.ensureCareer(gameId);
        if (!career.ok) return { ok: false, reason: 'career-unavailable', detail: career.reason || null };
        careerId = career.careerId;
        session.careerId = careerId;
      }
      const res = await h.seedStoryFlags(careerId, flags);
      return { ok: res.ok, careerId, seeded: res.count || 0, reason: res.reason };
    },
    async seedClearedCommissions(ids) {
      let careerId = session.careerId;
      if (!careerId) {
        const career = await h.ensureCareer(gameId);
        if (!career.ok) return { ok: false, reason: 'career-unavailable' };
        careerId = career.careerId;
        session.careerId = careerId;
      }
      const now = new Date().toISOString();
      const rows = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string').map((id) => ({
        nodeId: id,
        kind: 'commission',
        status: 'cleared',
        clearedAt: now,
        evidence: [],
        flags: [],
      }));
      if (!rows.length) return { ok: true, careerId, seeded: 0 };
      const res = await h.putQuests(careerId, rows);
      return { ok: res.ok, careerId, seeded: res.count || 0, reason: res.reason };
    },
    async seedTierUnlock(tierArg) {
      const target = Number.isInteger(tierArg) ? tierArg : tier;
      let careerId = session.careerId;
      if (!careerId) {
        const career = await h.ensureCareer(gameId);
        if (!career.ok) return { ok: false, reason: 'career-unavailable' };
        careerId = career.careerId;
        session.careerId = careerId;
      }
      const res = await h.seedTierUnlock(gameId, careerId, target);
      return { ok: res.ok, careerId, seeded: res.count || 0, reason: res.reason };
    },
    async reload() {
      if (!session.ticketId) return { ok: false, reason: 'no-ticket' };
      const res = await h.reloadAndWait(session.ticketId, session.commissionId);
      return { ok: res.ok, reason: res.reason, detail: res.detail, commissionRun: res.commissionRun || null };
    },
    async settle(outcome, stats) {
      if (session.settled) return { ok: true, duplicate: true, reusedLocal: true, result: session.result };
      const res = await h.settle(typeof outcome === 'string' && outcome ? outcome : 'won', isObject(stats) ? stats : {});
      session.settled = true;
      session.result = res;
      return res;
    },
    async readState() {
      const res = await h.readState();
      if (!res.ok) return { ok: false, reason: res.reason, detail: res.detail };
      const state = res.state;
      const commissionState = isObject(state.commissionState) ? state.commissionState : null;
      const events = commissionState && Array.isArray(commissionState.events) ? commissionState.events : [];
      /* 扁平 + 嵌套两种视图都提供，fixture 里 res.info / res.state.info 都成立。 */
      return {
        ok: true,
        href: state.href,
        gameId: state.gameId,
        info: state.info,
        commissionRun: state.commissionRun,
        commissionState: commissionState,
        events: events,
        ticket: state.ticket,
        state: state,
      };
    },
    async wallet() {
      if (!session.careerId) {
        const career = await h.ensureCareer(gameId);
        if (!career.ok) return { ok: false, reason: 'career-unavailable' };
        session.careerId = career.careerId;
      }
      return h.wallet(session.careerId);
    },
    async claims() {
      if (!session.careerId) {
        const career = await h.ensureCareer(gameId);
        if (!career.ok) return { ok: false, reason: 'career-unavailable' };
        session.careerId = career.careerId;
      }
      const wallet = await h.wallet(session.careerId);
      const quests = await h.quests(session.careerId);
      const claim = session.ticketId ? await h.claim(session.ticketId) : { ok: false, reason: 'no-ticket' };
      return { ok: wallet.ok && quests.ok, wallet, quests, claim };
    },
    async snapshot() {
      const state = await h.readState();
      const wallet = session.careerId ? await h.wallet(session.careerId) : { ok: false, reason: 'no-career' };
      const claim = session.ticketId ? await h.claim(session.ticketId) : { ok: false, reason: 'no-ticket' };
      const row = session.ticketId ? await h.runRow(session.ticketId) : { ok: false, reason: 'no-ticket' };
      return {
        ok: state.ok,
        at: new Date().toISOString(),
        gameId,
        tier,
        careerId: session.careerId,
        ticketId: session.ticketId,
        state: state.ok ? state.state : { ok: false, reason: state.reason },
        wallet,
        claim,
        run: row.ok ? { status: row.run && row.run.status, commissionId: row.run && row.run.commissionId } : row,
      };
    },
    getCommission(tierArg) {
      const target = Number.isInteger(tierArg) ? tierArg : tier;
      return target === tier ? commission : null;
    },
    commission,
    evaluate(expression) {
      return h.page.evaluate(expression);
    },
    waitFor(expression, opts) {
      return h.page.waitFor(expression, opts);
    },
  };
  session.helpers = helpers;
  session.ctx = {
    gameId,
    tier,
    port: h.port,
    cdp: h.page,
    page: h.page,
    helpers,
    content: commission,
    careerId: session.careerId,
    artifactsDir: h.artifactsDir,
  };
  return session;
}

/* ------------------------------------------------------------------ *
 * 通用证据
 * ------------------------------------------------------------------ */

/**
 * 每个证据开始前：放弃上一趟未结算 run、清 sessionStorage ticket、打开目标游戏普通页、确保生涯。
 */
async function prepareFreshRun(h, gameId) {
  const before = await h.readState();
  if (before.ok && isObject(before.state) && isObject(before.state.commissionRun) && typeof before.state.commissionRun.ticketId === 'string') {
    await h.abandon(before.state.commissionRun.ticketId);
  }
  await h.clearTicket();
  const opened = await h.ensurePlainPage(gameId);
  if (!opened.ok) return opened;
  const career = await h.ensureCareer(gameId);
  if (!career.ok) return career;
  await h.clearTicket();
  return { ok: true, careerId: career.careerId, created: career.created === true };
}

/** 归一化 fixture 返回的 events 声明（对象 kind→次数 或 [{kind,payload}]）。 */
function normalizeDeclaredEvents(raw) {
  const out = [];
  if (!raw) return out;
  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      if (!isObject(item) || typeof item.kind !== 'string' || !item.kind) return;
      out.push({ kind: item.kind, count: 1 });
    });
    return out;
  }
  if (isObject(raw)) {
    Object.keys(raw).forEach((kind) => {
      if (!kind) return;
      const count = Number(raw[kind]);
      out.push({ kind, count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 1 });
    });
  }
  return out;
}

/** 从 bridge 委托缓冲统计 kind→次数。 */
function countObservedEvents(commissionState) {
  const counts = {};
  if (!isObject(commissionState) || !Array.isArray(commissionState.events)) return counts;
  commissionState.events.forEach((event) => {
    if (!isObject(event) || typeof event.kind !== 'string') return;
    counts[event.kind] = (counts[event.kind] || 0) + 1;
  });
  return counts;
}

/** 取已结算结果：优先本地 helper 结果，其次页面 commissionLastResult。 */
function settledResultOf(state) {
  if (!isObject(state)) return null;
  const info = state.info;
  if (!isObject(info)) return null;
  const last = info.commissionLastResult;
  return isObject(last) ? last : null;
}

function expectedFirstClear(commission) {
  const reward = isObject(commission && commission.reward) ? commission.reward : {};
  return {
    credits: Number(reward.credits) || 0,
    items: isObject(reward.items) ? reward.items : {},
    evidence: Array.isArray(reward.evidence) ? reward.evidence.slice() : [],
    flags: Array.isArray(reward.flags) ? reward.flags.slice() : [],
  };
}

function receiptOf(result) {
  if (isObject(result) && isObject(result.receipt)) return result.receipt;
  return null;
}

/**
 * failure 证据的归因自洽判定（纯函数，便于 --self-test 覆盖）：
 * - objective-not-met：observed 必须小于 atLeast；
 * - value-not-met：计数/上下文已过（observed 缺失或 >= atLeast）且内容声明了 minValue；
 * - context-mismatch：可归因；
 * 其它 reason 一律不通过。
 * @param {string} reason settle 返回的失败原因
 * @param {{observed?:number}} settleResult
 * @param {object} objective 内容 objective
 * @returns {boolean}
 */
function failureAttributionOk(reason, settleResult, objective) {
  const observed = settleResult && Number.isFinite(Number(settleResult.observed)) ? Number(settleResult.observed) : null;
  const target = isObject(objective) ? objective : {};
  if (reason === 'objective-not-met') {
    return observed !== null && observed < Number(target.atLeast || 0);
  }
  if (reason === 'value-not-met') {
    return isObject(target.minValue) && (observed === null || observed >= Number(target.atLeast || 0));
  }
  if (reason === 'context-mismatch') return true;
  return false;
}

async function abandonIfLive(h, ticketId) {
  if (typeof ticketId !== 'string' || !ticketId) return { ok: true, skipped: true };
  const res = await h.abandon(ticketId);
  if (!res.ok) return { ok: false, reason: res.reason || 'abandon-failed' };
  return { ok: true };
}

/**
 * success 证据：fixture 驱动真实状态达标 → 结算收据/领奖/流水/钱包 → 幂等复结算。
 * @returns {Promise<{checks:Array, diagnostics:object|null}>}
 */
async function runSuccessEvidence(h, gameId, tier, fixture, commission, options) {
  const checks = createCheckList();
  const diagnostics = { evidence: 'success', gameId, tier, steps: {} };
  const handler = fixture && fixture.tiers && fixture.tiers[String(tier)] ? fixture.tiers[String(tier)].success : null;
  if (typeof handler !== 'function') {
    checks.add('success.handler', false, 'fixture.tiers[' + tier + '].success 不是函数');
    return { checks: checks.list, diagnostics };
  }
  const prepared = await prepareFreshRun(h, gameId);
  if (!prepared.ok) {
    checks.add('success.prepare', false, prepared.reason || 'prepare-failed');
    return { checks: checks.list, diagnostics };
  }
  const session = createSession(h, gameId, tier, commission, prepared.careerId);
  const walletBefore = await h.wallet(prepared.careerId);
  diagnostics.steps.walletBefore = walletBefore;
  let handlerReturn = null;
  let handlerError = null;
  try {
    handlerReturn = await withTimeout(
      Promise.resolve(handler(session.ctx)),
      options.handlerTimeoutMs,
      'success-handler'
    );
  } catch (err) {
    handlerError = errorText(err);
  }
  if (handlerError) {
    checks.add('success.handler', false, handlerError);
    diagnostics.steps.handlerError = handlerError;
    await abandonIfLive(h, session.ticketId);
    return { checks: checks.list, diagnostics };
  }
  checks.add('success.handler', true);
  const normalized = isObject(handlerReturn) ? handlerReturn : {};
  diagnostics.steps.handlerReturn = normalized;
  if (!session.ticketId) {
    checks.add('success.commission-start', false, 'fixture 未调用 helpers.startCommission(tier)');
    return { checks: checks.list, diagnostics };
  }
  checks.add('success.commission-start', true, session.ticketId);
  const observedState = await h.readState();
  const observedCounts = observedState.ok ? countObservedEvents(observedState.state.commissionState) : {};
  const declared = normalizeDeclaredEvents(normalized.events);
  if (declared.length) {
    const missing = declared.filter((item) => (observedCounts[item.kind] || 0) < item.count);
    if (observedState.ok && isObject(observedState.state) && isObject(observedState.state.commissionRun)) {
      checks.add(
        'success.events-observed',
        missing.length === 0,
        missing.map((item) => item.kind + ' 需 ' + item.count + ' 次，实际 ' + (observedCounts[item.kind] || 0) + ' 次').join('; ')
      );
    } else {
      checks.add('success.events-observed', true, 'fixture 内部已结算，事件缓冲不可回读（以收据为准）');
    }
    const notInCatalog = declared.filter((item) => !schema.eventSpec(gameId, item.kind));
    if (notInCatalog.length) {
      checks.add(
        'success.events-catalog',
        false,
        notInCatalog.map((item) => item.kind + ' 不在 §19.4 ' + gameId + ' 事件目录').join('; ')
      );
    } else {
      checks.add('success.events-catalog', true);
    }
  } else {
    checks.add('success.events-observed', true, 'fixture 未声明事件（仅以收据判定）');
  }
  let settleResult = session.result;
  if (!settleResult) {
    const liveRun = observedState.ok && isObject(observedState.state) ? observedState.state.commissionRun : null;
    if (isObject(liveRun)) {
      settleResult = await h.settle('won', isObject(normalized.stats) ? normalized.stats : {});
      session.settled = true;
      session.result = settleResult;
    } else {
      settleResult = settledResultOf(observedState.state) || { ok: false, reason: 'settle-result-missing' };
    }
  }
  diagnostics.steps.settle = settleResult;
  checks.add('success.settle-ok', settleResult && settleResult.ok === true, settleResult && settleResult.reason ? 'reason=' + settleResult.reason : '');
  const receipt = receiptOf(settleResult);
  const expected = expectedFirstClear(commission);
  checks.add('success.receipt', !!receipt, receipt ? '' : 'settle 未返回收据');
  if (receipt) {
    checks.add('success.receipt-commission', receipt.commissionId === session.commissionId, q(receipt.commissionId));
    checks.add('success.repeat', settleResult.repeat === false, 'repeat=' + q(settleResult.repeat));
    checks.add('success.credits', Number(receipt.credits) === expected.credits, 'expected ' + expected.credits + ', got ' + q(receipt.credits));
    checks.add('success.items', sameJson(receipt.items || {}, expected.items), 'expected ' + sortedJson(expected.items) + ', got ' + sortedJson(receipt.items || {}));
    checks.add('success.evidence', arrayEqual(receipt.evidence || [], expected.evidence), 'expected ' + sortedJson(expected.evidence) + ', got ' + sortedJson(receipt.evidence || []));
    checks.add('success.flags', arrayEqual(receipt.flags || [], expected.flags), 'expected ' + sortedJson(expected.flags) + ', got ' + sortedJson(receipt.flags || []));
    checks.add('success.txids', Array.isArray(receipt.txIds) && receipt.txIds.length > 0, 'txIds=' + (receipt.txIds || []).length);
    const claim = await h.claim(session.ticketId);
    diagnostics.steps.claim = claim;
    checks.add('success.claim-row', claim.ok === true, claim.ok ? '' : 'reason=' + q(claim.reason));
    const ledger = await h.ledger(session.careerId);
    diagnostics.steps.ledger = ledger.ok ? { ok: true, count: (ledger.rows || []).length } : ledger;
    const ledgerIds = ledger.ok ? new Set((ledger.rows || []).map((row) => row && row.txId).filter(Boolean)) : new Set();
    const missingTx = (receipt.txIds || []).filter((txId) => !ledgerIds.has(txId));
    checks.add('success.ledger', ledger.ok && missingTx.length === 0, ledger.ok ? (missingTx.length ? '缺少流水 ' + missingTx.join(',') : '') : 'reason=' + q(ledger.reason));
    const walletAfter = await h.wallet(session.careerId);
    diagnostics.steps.walletAfter = walletAfter;
    const creditsDelta = walletAfter.ok ? Number(walletAfter.credits) - Number(walletBefore.credits) : NaN;
    checks.add('success.wallet-credits', walletAfter.ok && creditsDelta === expected.credits, 'delta=' + q(creditsDelta) + ' expected=' + expected.credits);
    const itemsDelta = walletAfter.ok ? diffItems(walletBefore.items, walletAfter.items) : {};
    checks.add('success.wallet-items', walletAfter.ok && sameJson(itemsDelta, expected.items), 'delta=' + sortedJson(itemsDelta));
    const row = await h.runRow(session.ticketId);
    checks.add('success.run-claimed', row.ok === true && row.run && row.run.status === 'claimed', row.ok ? 'status=' + q(row.run && row.run.status) : 'reason=' + q(row.reason));
    /* 幂等：同一 runId 再次结算必须返回原收据且零增量（receipt/claim 幂等）。 */
    const walletBeforeDup = walletAfter;
    const dup = await h.resettle(session.ticketId, 'won', isObject(normalized.stats) ? normalized.stats : {});
    diagnostics.steps.resettle = dup;
    const dupReceipt = receiptOf(dup);
    checks.add('idempotent.duplicate', dup && dup.ok === true && dup.duplicate === true, dup && dup.reason ? 'reason=' + dup.reason : 'duplicate=' + q(dup && dup.duplicate));
    checks.add(
      'idempotent.receipt',
      !!dupReceipt && dupReceipt.receiptId === receipt.receiptId && Number(dupReceipt.credits) === Number(receipt.credits) && sameJson(dupReceipt.items || {}, receipt.items || {}) && arrayEqual(dupReceipt.txIds || [], receipt.txIds || []),
      dupReceipt ? '' : '复结算未返回原收据'
    );
    const walletAfterDup = await h.wallet(session.careerId);
    const dupCreditsDelta = walletAfterDup.ok && walletBeforeDup.ok ? Number(walletAfterDup.credits) - Number(walletBeforeDup.credits) : NaN;
    checks.add('idempotent.wallet', walletAfterDup.ok && dupCreditsDelta === 0 && sameJson(diffItems(walletBeforeDup.items, walletAfterDup.items), {}), 'delta=' + q(dupCreditsDelta));
  } else {
    const walletAfter = await h.wallet(session.careerId);
    checks.add('success.wallet-credits', walletAfter.ok && Number(walletAfter.credits) === Number(walletBefore.credits), '收据缺失时钱包不得变化');
  }
  await abandonIfLive(h, session.ticketId);
  return { checks: checks.list, diagnostics };
}

/** failure 证据：fixture 让目标未达成 → 可归因失败、零奖励、run 状态 failed。 */
async function runFailureEvidence(h, gameId, tier, fixture, commission, options) {
  const checks = createCheckList();
  const diagnostics = { evidence: 'failure', gameId, tier, steps: {} };
  const handler = fixture && fixture.tiers && fixture.tiers[String(tier)] ? fixture.tiers[String(tier)].failure : null;
  if (typeof handler !== 'function') {
    checks.add('failure.handler', false, 'fixture.tiers[' + tier + '].failure 不是函数');
    return { checks: checks.list, diagnostics };
  }
  const prepared = await prepareFreshRun(h, gameId);
  if (!prepared.ok) {
    checks.add('failure.prepare', false, prepared.reason || 'prepare-failed');
    return { checks: checks.list, diagnostics };
  }
  const session = createSession(h, gameId, tier, commission, prepared.careerId);
  const walletBefore = await h.wallet(prepared.careerId);
  diagnostics.steps.walletBefore = walletBefore;
  let handlerReturn = null;
  let handlerError = null;
  try {
    handlerReturn = await withTimeout(
      Promise.resolve(handler(session.ctx)),
      options.handlerTimeoutMs,
      'failure-handler'
    );
  } catch (err) {
    handlerError = errorText(err);
  }
  if (handlerError) {
    checks.add('failure.handler', false, handlerError);
    await abandonIfLive(h, session.ticketId);
    return { checks: checks.list, diagnostics };
  }
  checks.add('failure.handler', true);
  const normalized = isObject(handlerReturn) ? handlerReturn : {};
  diagnostics.steps.handlerReturn = normalized;
  if (!session.ticketId) {
    checks.add('failure.commission-start', false, 'fixture 未调用 helpers.startCommission(tier)');
    return { checks: checks.list, diagnostics };
  }
  checks.add('failure.commission-start', true, session.ticketId);
  const observedState = await h.readState();
  const observedCounts = observedState.ok ? countObservedEvents(observedState.state.commissionState) : {};
  const declared = normalizeDeclaredEvents(normalized.events);
  if (declared.length && observedState.ok && isObject(observedState.state) && isObject(observedState.state.commissionRun)) {
    const missing = declared.filter((item) => (observedCounts[item.kind] || 0) < item.count);
    checks.add('failure.events-observed', missing.length === 0, missing.map((item) => item.kind + ' 缺口').join('; '));
  } else {
    checks.add('failure.events-observed', true, '未声明事件或不需回读（以结算归因为准）');
  }
  let settleResult = session.result;
  if (!settleResult) {
    const liveRun = observedState.ok && isObject(observedState.state) ? observedState.state.commissionRun : null;
    if (isObject(liveRun)) {
      settleResult = await h.settle('lost', isObject(normalized.stats) ? normalized.stats : {});
      session.settled = true;
      session.result = settleResult;
    } else {
      settleResult = settledResultOf(observedState.state) || { ok: false, reason: 'settle-result-missing' };
    }
  }
  diagnostics.steps.settle = settleResult;
  checks.add('failure.settle-not-ok', settleResult && settleResult.ok === false, settleResult && settleResult.ok ? 'fail 证据却结算成功' : '');
  const reason = settleResult && settleResult.reason ? String(settleResult.reason) : '';
  checks.add('failure.reason', OBJECTIVE_MISS_REASONS.indexOf(reason) >= 0, 'reason=' + q(reason) + ' expected∈' + OBJECTIVE_MISS_REASONS.join('|'));
  const objective = isObject(commission && commission.objective) ? commission.objective : {};
  const observed = settleResult && Number.isFinite(Number(settleResult.observed)) ? Number(settleResult.observed) : null;
  const attributionOk = failureAttributionOk(reason, settleResult, objective);
  checks.add('failure.attribution', attributionOk, 'observed=' + q(observed) + ' atLeast=' + q(objective.atLeast) + (objective.minValue ? ' minValue=' + q(objective.minValue) : ''));
  checks.add('failure.no-receipt', !receiptOf(settleResult), receiptOf(settleResult) ? '失败却返回收据' : '');
  const walletAfter = await h.wallet(session.careerId);
  const creditsDelta = walletAfter.ok && walletBefore.ok ? Number(walletAfter.credits) - Number(walletBefore.credits) : NaN;
  const itemDelta = walletAfter.ok ? diffItems(walletBefore.items, walletAfter.items) : {};
  checks.add('failure.zero-reward', walletAfter.ok && creditsDelta === 0 && sameJson(itemDelta, {}), 'creditsΔ=' + q(creditsDelta) + ' itemsΔ=' + sortedJson(itemDelta));
  const row = await h.runRow(session.ticketId);
  checks.add('failure.run-status', row.ok === true && row.run && row.run.status === 'failed', row.ok ? 'status=' + q(row.run && row.run.status) : 'reason=' + q(row.reason));
  return { checks: checks.list, diagnostics };
}

/** suspend 证据：接单 → 进入委托页 → 刷新 → ticket/run 恢复；随后 abandon 不发奖。 */
async function runSuspendEvidence(h, gameId, tier, commission) {
  const checks = createCheckList();
  const diagnostics = { evidence: 'suspend', gameId, tier, steps: {} };
  const prepared = await prepareFreshRun(h, gameId);
  if (!prepared.ok) {
    checks.add('suspend.prepare', false, prepared.reason || 'prepare-failed');
    return { checks: checks.list, diagnostics };
  }
  const session = createSession(h, gameId, tier, commission, prepared.careerId);
  const chapterFlag = schema.CHAPTER_FLAGS[tier] || null;
  if (chapterFlag) {
    const seeded = await h.seedStoryFlags(prepared.careerId, [chapterFlag]);
    diagnostics.steps.seedFlag = { flag: chapterFlag, ok: seeded.ok, reason: seeded.reason };
    checks.add('suspend.seed-flag', seeded.ok === true, seeded.ok ? chapterFlag : 'reason=' + q(seeded.reason));
  }
  const started = await session.helpers.startCommission(tier);
  diagnostics.steps.start = { ok: started.ok, ticketId: started.ticketId, reason: started.reason };
  checks.add('suspend.start', started.ok === true, started.ok ? started.ticketId : 'reason=' + q(started.reason));
  if (!started.ok) return { checks: checks.list, diagnostics };
  const navigated = await session.helpers.navigateGame();
  diagnostics.steps.navigate = { ok: navigated.ok, reason: navigated.reason };
  checks.add('suspend.active', navigated.ok === true, navigated.ok ? session.commissionId : 'reason=' + q(navigated.reason) + ' ' + (navigated.detail || ''));
  const walletBefore = await h.wallet(prepared.careerId);
  const reloaded = await session.helpers.reload();
  diagnostics.steps.reload = { ok: reloaded.ok, reason: reloaded.reason, run: reloaded.commissionRun };
  checks.add('suspend.restored', reloaded.ok === true && isObject(reloaded.commissionRun) && reloaded.commissionRun.ticketId === session.ticketId, reloaded.ok ? '' : 'reason=' + q(reloaded.reason) + ' ' + (reloaded.detail || ''));
  const stateAfter = await h.readState();
  const restoredTicket = stateAfter.ok && isObject(stateAfter.state) ? stateAfter.state.ticket : null;
  checks.add('suspend.ticket-storage', isObject(restoredTicket) && restoredTicket.ticketId === session.ticketId, restoredTicket ? '' : 'sessionStorage ticket 丢失');
  const row = await h.runRow(session.ticketId);
  checks.add('suspend.run-active', row.ok === true && row.run && (row.run.status === 'active' || row.run.status === 'issued'), row.ok ? 'status=' + q(row.run && row.run.status) : 'reason=' + q(row.reason));
  const walletAfterReload = await h.wallet(prepared.careerId);
  checks.add(
    'suspend.no-wallet-change',
    walletAfterReload.ok && Number(walletAfterReload.credits) === Number(walletBefore.credits) && sameJson(diffItems(walletBefore.items, walletAfterReload.items), {}),
    'creditsΔ=' + q(Number(walletAfterReload.credits) - Number(walletBefore.credits))
  );
  const abandoned = await h.abandon(session.ticketId);
  diagnostics.steps.abandon = abandoned;
  checks.add('suspend.abandon', abandoned.ok === true, abandoned.ok ? '' : 'reason=' + q(abandoned.reason));
  const rowAfter = await h.runRow(session.ticketId);
  checks.add('suspend.abandon-status', rowAfter.ok === true && rowAfter.run && rowAfter.run.status === 'abandoned', rowAfter.ok ? 'status=' + q(rowAfter.run && rowAfter.run.status) : 'reason=' + q(rowAfter.reason));
  const walletFinal = await h.wallet(prepared.careerId);
  checks.add(
    'suspend.abandon-no-reward',
    walletFinal.ok && Number(walletFinal.credits) === Number(walletBefore.credits) && sameJson(diffItems(walletBefore.items, walletFinal.items), {}),
    'creditsΔ=' + q(Number(walletFinal.credits) - Number(walletBefore.credits))
  );
  return { checks: checks.list, diagnostics };
}

/**
 * 单 tier 全量证据：success（含 receipt/claim/idempotent）+ failure + suspend。
 * @returns {Promise<{tier:number, ok:boolean, checks:Array, failures:Array, durationMs:number, diagnostics:Array}>}
 */
async function runTier(h, input) {
  const opts = isObject(input) ? input : {};
  const gameId = opts.gameId;
  const tier = opts.tier;
  const fixture = opts.fixture;
  const commission = opts.commission;
  const options = {
    handlerTimeoutMs: opts.handlerTimeoutMs || DEFAULT_HANDLER_TIMEOUT_MS,
    tierTimeoutMs: opts.tierTimeoutMs || DEFAULT_TIER_TIMEOUT_MS,
  };
  const startedAt = Date.now();
  const checks = [];
  const diagnostics = [];
  let timeout = null;
  try {
    await withTimeout((async () => {
      const success = await runSuccessEvidence(h, gameId, tier, fixture, commission, options);
      checks.push.apply(checks, success.checks.map((check) => Object.assign({ phase: 'success' }, check)));
      if (success.diagnostics) diagnostics.push(success.diagnostics);
      const failure = await runFailureEvidence(h, gameId, tier, fixture, commission, options);
      checks.push.apply(checks, failure.checks.map((check) => Object.assign({ phase: 'failure' }, check)));
      if (failure.diagnostics) diagnostics.push(failure.diagnostics);
      const suspend = await runSuspendEvidence(h, gameId, tier, commission);
      checks.push.apply(checks, suspend.checks.map((check) => Object.assign({ phase: 'suspend' }, check)));
      if (suspend.diagnostics) diagnostics.push(suspend.diagnostics);
    })(), options.tierTimeoutMs, 'tier-' + gameId + '-T' + tier);
  } catch (err) {
    timeout = errorText(err);
    checks.push({ phase: 'tier', id: 'tier.timeout', ok: false, detail: timeout });
  }
  const failures = checks.filter((check) => !check.ok);
  return {
    gameId,
    tier,
    ok: failures.length === 0 && !timeout,
    checks,
    failures,
    durationMs: Date.now() - startedAt,
    diagnostics,
    timeout,
  };
}

/* ------------------------------------------------------------------ *
 * 模式：--validate / --list / --run
 * ------------------------------------------------------------------ */

async function runValidateMode(options) {
  const bundle = loadContentBundle();
  const contentResult = validateLoadedContent(bundle);
  const contentOk = reportContent(contentResult, options);
  const fixtures = await validateFixtures();
  fixtures.entries.forEach((entry) => {
    if (entry.status === 'missing') {
      console.log('MISSING  fixture  ' + pad(entry.gameId, 16) + entry.rel);
      return;
    }
    entry.warnings.forEach((item) => console.log('  WARN  ' + item));
    if (entry.status === 'ok') {
      const tierCount = isObject(entry.fixture && entry.fixture.tiers) ? Object.keys(entry.fixture.tiers).length : 0;
      console.log('OK       fixture  ' + pad(entry.gameId, 16) + 'tiers=' + tierCount + '  ' + entry.rel);
      return;
    }
    entry.errors.forEach((item) => console.log('  FAIL  ' + item));
    console.log('INVALID  fixture  ' + pad(entry.gameId, 16) + entry.rel);
  });
  const summary = {
    contentOk: contentResult.ok,
    contentWarnings: contentResult.warnings ? contentResult.warnings.length : 0,
    fixtureErrors: fixtures.invalid,
    missing: fixtures.missing,
  };
  const exitCode = computeValidateExitCode(summary, options);
  console.log(
    'SUMMARY  validate  content=' + (contentResult.ok ? 'PASS' : 'FAIL') +
    '  games=' + (contentResult.counts ? contentResult.counts.games : 0) +
    '  tiers=' + (contentResult.counts ? contentResult.counts.tiers : 0) +
    '  total=' + (contentResult.counts ? contentResult.counts.total : 0) +
    '  warnings=' + summary.contentWarnings +
    '  fixtures(present=' + fixtures.present + ' ok=' + fixtures.ok + ' invalid=' + fixtures.invalid + ' missing=' + fixtures.missing + ')' +
    '  exit=' + exitCode
  );
  return exitCode;
}

async function runListMode() {
  const bundle = loadContentBundle();
  const contentResult = validateLoadedContent(bundle);
  console.log(
    'CONTENT  ' + (contentResult.counts ? contentResult.counts.total : 0) + '/' + (GAMES.length * TIERS.length) +
    '  games=' + (contentResult.counts ? contentResult.counts.games : 0) +
    '  errors=' + (contentResult.errors ? contentResult.errors.length : 0) +
    '  warnings=' + (contentResult.warnings ? contentResult.warnings.length : 0)
  );
  const index = buildContentIndex(bundle.commissions);
  const fixtures = await validateFixtures();
  const gaps = [];
  console.log('GAME              CONTENT  FIXTURE');
  fixtures.entries.forEach((entry) => {
    const tiersPresent = index[entry.gameId] ? Object.keys(index[entry.gameId]).length : 0;
    if (entry.status !== 'ok') gaps.push(entry);
    console.log(
      pad(entry.gameId, 18) + pad(tiersPresent + '/' + TIERS.length, 9) +
      (entry.status === 'ok' ? 'OK' : entry.status === 'missing' ? 'MISSING  ' + entry.rel : 'INVALID')
    );
  });
  console.log('FIXTURE GAPS  ' + gaps.length + '/' + GAMES.length);
  gaps.forEach((entry) => console.log('  ' + pad(entry.gameId, 18) + (entry.status === 'missing' ? 'MISSING' : 'INVALID') + '  ' + entry.rel));
  return EXIT_PASS;
}

async function runMode(options) {
  const target = options.gameId;
  if (target !== 'all' && GAMES.indexOf(target) < 0) {
    console.error('USAGE  --run=<gameId|all>：未知 gameId ' + q(target));
    return EXIT_ENV;
  }
  const bundle = loadContentBundle();
  const contentResult = validateLoadedContent(bundle);
  if (!reportContent(contentResult, options)) {
    console.error('FAIL   内容 schema 未通过，拒绝驱动 fixture（请看上面的 errors/warnings；或去掉 --strict 仅跑内容告警版本）');
    return EXIT_FAIL;
  }
  const index = buildContentIndex(bundle.commissions);
  const fixtures = await validateFixtures();
  const targets = target === 'all' ? GAMES.slice() : [target];
  const runnable = [];
  let missing = 0;
  let invalid = 0;
  for (const gameId of targets) {
    const entry = fixtures.entries.filter((item) => item.gameId === gameId)[0];
    if (!entry || entry.status === 'missing') {
      missing += 1;
      console.log('SKIP    ' + pad(gameId, 16) + 'MISSING  ' + fixtureRelPath(gameId));
      continue;
    }
    if (entry.status !== 'ok') {
      invalid += 1;
      console.log('FAIL    ' + pad(gameId, 16) + 'fixture 形状非法（先跑 --validate）');
      continue;
    }
    const missingTiers = TIERS.filter((tier) => !index[gameId] || !index[gameId][tier]);
    if (missingTiers.length) {
      invalid += 1;
      console.log('FAIL    ' + pad(gameId, 16) + '内容缺少 tier ' + missingTiers.join(','));
      continue;
    }
    runnable.push({ gameId, fixture: entry.fixture, content: bundle.commissions });
  }
  if (!runnable.length) {
    console.error('FAIL   没有可运行的 fixture（missing=' + missing + ' invalid=' + invalid + '）；--validate 可查看缺口');
    return EXIT_FAIL;
  }
  let serverPort = DEFAULT_SERVER_PORT;
  let cdpPort = DEFAULT_CDP_PORT;
  try {
    serverPort = envPort('CAREER_MISSION_PORT', DEFAULT_SERVER_PORT);
    cdpPort = envPort('CAREER_MISSION_CDP', DEFAULT_CDP_PORT);
  } catch (err) {
    console.error('ENV    ' + errorText(err));
    return EXIT_ENV;
  }
  /* Chrome 会拦截 <1024 的低端口（ERR_UNSAFE_PORT）；在这里显式拒绝，避免伪装成 tier 失败。 */
  if (serverPort < 1024 || cdpPort < 1024) {
    console.error(
      'ENV    CAREER_MISSION_PORT/CAREER_MISSION_CDP 必须 >=1024（Chrome 拦截低端口）：' +
      serverPort + '/' + cdpPort
    );
    return EXIT_ENV;
  }
  const artifactsDir = process.env.CAREER_MISSION_ARTIFACTS || path.join(os.tmpdir(), 'studiokit-career-mission-artifacts');
  const tiers = Array.isArray(options.tiers) && options.tiers.length ? options.tiers : TIERS.slice();
  console.log(
    'RUN     port=' + serverPort + ' cdp=' + cdpPort + ' games=' + runnable.map((item) => item.gameId).join(',') +
    ' tiers=' + tiers.join(',') + ' strict=' + (options.strict === true) + ' artifacts=' + artifactsDir
  );
  const harness = new MissionHarness({
    port: serverPort,
    cdpPort: cdpPort,
    chromePath: process.env.CHROME_PATH || undefined,
    artifactsDir,
  });
  let tierPass = 0;
  let tierFail = 0;
  let aborted = false;
  try {
    try {
      await harness.start();
    } catch (err) {
      console.error('ENV    浏览器/服务启动失败：' + errorText(err));
      return EXIT_ENV;
    }
    for (const item of runnable) {
      const cleanupCtx = {
        gameId: item.gameId,
        tier: null,
        port: serverPort,
        cdp: harness.page,
        page: harness.page,
        helpers: {},
        content: index[item.gameId],
      };
      try {
        for (const tier of tiers) {
          const commission = index[item.gameId][tier];
          const result = await runTier(harness, {
            gameId: item.gameId,
            tier,
            fixture: item.fixture,
            commission,
            handlerTimeoutMs: options.handlerTimeoutMs || DEFAULT_HANDLER_TIMEOUT_MS,
            tierTimeoutMs: options.tierTimeoutMs || DEFAULT_TIER_TIMEOUT_MS,
          });
          result.checks.forEach((check) => {
            if (!check.ok || options.verbose) {
              console.log('  ' + (check.ok ? 'PASS' : 'FAIL') + '  ' + pad(item.gameId, 16) + 'T' + tier + ' ' + check.phase + '.' + check.id + (check.detail ? ' — ' + check.detail : ''));
            }
          });
          if (result.ok) {
            tierPass += 1;
            console.log('PASS    ' + pad(item.gameId, 16) + 'T' + tier + '  ' + result.checks.length + '/' + result.checks.length + ' checks  ' + formatDuration(result.durationMs));
          } else {
            tierFail += 1;
            const reason = result.failures.map((check) => check.phase + '.' + check.id + ': ' + check.detail).join('; ');
            console.log('FAIL    ' + pad(item.gameId, 16) + 'T' + tier + '  ' + (result.checks.length - result.failures.length) + '/' + result.checks.length + ' checks  ' + formatDuration(result.durationMs) + ' — ' + reason);
            const artifact = writeArtifact(
              artifactsDir,
              'fail-' + item.gameId + '-T' + tier + '.json',
              { gameId: item.gameId, tier, checks: result.checks, diagnostics: result.diagnostics, url: harness.page ? harness.gameUrl(item.gameId) : null }
            );
            if (artifact) console.log('  ARTIFACT  ' + artifact);
            if (harness.page) await harness.screenshot('fail-' + item.gameId + '-T' + tier + '.png');
          }
          if (result.timeout) {
            aborted = true;
            break;
          }
          if (harness.harnessErrors >= MAX_HARNESS_ERRORS) {
            console.error('ENV    连续 harness 错误过多（' + harness.harnessErrors + '），中止剩余 tier');
            aborted = true;
            break;
          }
        }
      } finally {
        if (typeof item.fixture.cleanup === 'function') {
          try {
            await withTimeout(Promise.resolve(item.fixture.cleanup(cleanupCtx)), 30000, 'cleanup-' + item.gameId);
          } catch (err) {
            console.log('WARN    ' + pad(item.gameId, 16) + 'cleanup 失败/超时：' + errorText(err));
          }
        }
      }
      if (aborted) break;
    }
  } finally {
    await harness.stop();
  }
  console.log(
    'SUMMARY  run  tiers pass=' + tierPass + ' fail=' + tierFail + ' missing=' + missing + ' invalid=' + invalid +
    ' harnessErrors=' + harness.harnessErrors
  );
  if (aborted) return EXIT_ENV;
  const strictMissing = options.strict === true && missing > 0;
  if (tierFail > 0 || invalid > 0 || strictMissing) return EXIT_FAIL;
  if (missing > 0 && options.allowMissing !== true) {
    console.error('ENV    fixture 缺失不计为通过（missing=' + missing + '）；确需忽略请用 --allow-missing');
    return EXIT_FAIL;
  }
  return EXIT_PASS;
}

/* ------------------------------------------------------------------ *
 * --self-test：无 fixture 也验证 runner 自身
 * ------------------------------------------------------------------ */

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function runSelfTest() {
  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail: detail || '' });
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok || !detail ? '' : ' — ' + detail));
  };
  const expectIssues = (result, rule) => {
    const issues = (result && result.errors) || [];
    return issues.some((item) => String(item).indexOf(rule) === 0);
  };

  /* 1) schema 模块 API */
  const apiNames = ['validateCommissionContent', 'validateFixtureShape', 'tierUnlockPlan', 'assertNoSpoilers'];
  record('schema.api', apiNames.every((name) => typeof schema[name] === 'function'), apiNames.join(','));
  record('schema.event-catalog-frozen', Object.isFrozen(schema.EVENT_CATALOG) && GAMES.every((gameId) => Object.isFrozen(schema.EVENT_CATALOG[gameId])), 'EVENT_CATALOG 只读');
  record('schema.event-catalog-games', Object.keys(schema.EVENT_CATALOG).length === 16 && GAMES.every((gameId) => schema.eventKindsFor(gameId).length > 0), '16 游戏均有事件');

  /* 2) 浏览器 UMD 双挂载 */
  try {
    const sourcePath = require.resolve('../apps/arcade/career/commission-schema.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sandbox = {};
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'commission-schema.js' });
    const mounted = sandbox.ArcadeCareerCommissionSchema;
    const scoped = sandbox.ArcadeCareer && sandbox.ArcadeCareer.commissionSchema;
    record('schema.umd-browser-mount', !!mounted && !!scoped && mounted === scoped, 'window 双挂载');
    record('schema.static-boundary', !/require\(\s*['"](node:)?(fs|child_process)['"]/.test(source), '不 require fs/child_process');
  } catch (err) {
    record('schema.umd-browser-mount', false, errorText(err));
    record('schema.static-boundary', false, errorText(err));
  }

  /* 3) 真实内容 96 条 */
  const bundle = loadContentBundle();
  record('content.load', bundle.ok === true, (bundle.errors || []).join('; '));
  const contentResult = validateLoadedContent(bundle);
  record('content.schema-96', contentResult.ok === true && contentResult.counts.total === 96 && contentResult.counts.games === 16 && contentResult.counts.tiers === 6, 'counts=' + sortedJson(contentResult.counts));
  record('content.warnings-non-blocking', contentResult.ok === true, '内容告警不影响 ok（warnings=' + contentResult.warnings.length + '）');
  record('content.strict-spoilers', schema.validateCommissionContent(bundle.commissions, Object.assign({}, bundle.options, { strictSpoilers: true })).errors.some((item) => String(item).indexOf('spoiler-term') === 0 || String(item).indexOf('system-term') === 0), 'strict 可把剧透/系统词升级为错误');

  /* 4) 内容负例逐项（每条只做一次定点破坏） */
  const mutations = [
    ['bad-commission-id', 'commission-id-mismatch', (content) => { content.commissions[0].commissionId = 'memory-flip.T9'; }],
    ['bad-tier', 'tier-invalid', (content) => { content.commissions[0].tier = 7; }],
    ['bad-kind', 'objective-kind-unknown', (content) => { content.commissions[0].objective.kind = 'no.such.event'; }],
    ['bad-atleast', 'objective-atleast', (content) => { content.commissions[0].objective.atLeast = 0; }],
    ['bad-minvalue', 'objective-minvalue', (content) => { const target = content.commissions.filter((item) => item.objective.minValue)[0]; target.objective.minValue = { field: 'nope', value: 'x' }; }],
    ['bad-unlock', 'unlock-missing-prereq', (content) => { content.commissions.filter((item) => item.tier === 2)[0].unlock = { all: [] }; }],
    ['bad-chapter-gate', 'chapter-gate-mismatch', (content) => { content.commissions.filter((item) => item.tier === 4)[0].chapterGate = null; }],
    ['bad-salary', 'repeat-salary-invalid', (content) => { content.commissions[0].repeatSalaryCredits = 401; }],
    ['bad-credits', 'reward-credits', (content) => { content.commissions[0].reward.credits = 401; }],
    ['bad-evidence-material', 'reward-evidence-token', (content) => { content.commissions[0].reward.evidence = ['alloy']; }],
    ['bad-flag', 'reward-flag-token', (content) => { content.commissions[0].reward.flags = ['not-a-flag']; }],
    ['bad-profession', 'profession-id-invalid', (content) => { content.commissions[0].professionId = 'nope.prof'; }],
    ['bad-star-startparams', 'startparams-star', (content) => { const target = content.commissions.filter((item) => item.gameId === 'star-raid')[0]; target.startParams = { startLevel: 2, themeId: 'storm' }; }],
    ['bad-content-version', 'content-version', (content) => { content.contentVersion = '0.18.0'; }],
    ['duplicate-commission-id', 'duplicate-commission-id', (content) => { content.commissions[1].commissionId = content.commissions[0].commissionId; }],
    ['missing-tier', 'content-count', (content) => { content.commissions.pop(); }],
  ];
  mutations.forEach((item) => {
    const content = cloneJson(bundle.commissions);
    try {
      item[2](content);
    } catch (err) {
      record('schema.negative-' + item[0], false, '突变执行失败：' + errorText(err));
      return;
    }
    const result = schema.validateCommissionContent(content, bundle.options);
    record('schema.negative-' + item[0], result.ok === false && expectIssues(result, item[1]), 'expected rule ' + item[1] + (result.errors.length ? ' · got ' + result.errors[0] : ''));
  });

  /* 5) 不抛异常 / 降级 */
  record('schema.no-throw-null', schema.validateCommissionContent(null).ok === false, 'null 内容返回失败');
  record('schema.no-throw-array', schema.validateCommissionContent([]).ok === false, '数组内容返回失败');
  record('schema.no-throw-empty', schema.validateCommissionContent({}).ok === false, '空对象返回失败');
  record('spoilers.no-throw-null', Array.isArray(schema.assertNoSpoilers(null)) && schema.assertNoSpoilers(null).length === 0, 'null 返回空数组');
  record('unlock-plan.no-throw-null', schema.tierUnlockPlan(null).ok === false, 'null 返回 ok:false');
  record('fixture-shape.no-throw-null', schema.validateFixtureShape(null).ok === false, 'null 返回 ok:false');

  /* 6) 剧透检测（合成内容） */
  const synthetic = {
    contentVersion: schema.CONTENT_VERSION,
    commissions: [
      { commissionId: 'memory-flip.T2', tier: 2, title: '整理归档', summary: '进入系统结算流程' },
      { commissionId: 'memory-flip.T5', tier: 5, title: '结局之后', summary: '完成通信档案配对' },
      { commissionId: 'memory-flip.T6', tier: 6, title: '应急工单', summary: '核对 E-7 的残留信号' },
    ],
  };
  const hits = schema.assertNoSpoilers(synthetic);
  record('spoilers.t46-title', hits.some((hit) => hit.tier === 5 && hit.field === 'title' && hit.term === '结局'), '命中 T5 标题');
  record('spoilers.t46-summary', hits.some((hit) => hit.tier === 6 && hit.field === 'summary' && hit.term === 'E-7'), '命中 T6 summary');
  record('spoilers.t13-system', hits.some((hit) => hit.tier === 2 && hit.field === 'summary' && hit.term === '系统'), '命中 T2 系统词');
  record('spoilers.real-titles-clean', schema.assertNoSpoilers(bundle.commissions).filter((hit) => hit.tier >= 4 && hit.field === 'title').length === 0, '真实 T4-T6 标题无剧透词');

  /* 7) 解锁计划 */
  const planT1 = schema.tierUnlockPlan(cloneJson(bundle.commissions.commissions.filter((c) => c.commissionId === 'memory-flip.T1')[0]));
  const planT4 = schema.tierUnlockPlan(cloneJson(bundle.commissions.commissions.filter((c) => c.commissionId === 'memory-flip.T4')[0]));
  const planT6 = schema.tierUnlockPlan(cloneJson(bundle.commissions.commissions.filter((c) => c.commissionId === 'memory-flip.T6')[0]));
  record('unlock-plan.t1', planT1.ok === true && planT1.prerequisites.length === 0 && planT1.text === '无需前置（T1）', sortedJson(planT1));
  record('unlock-plan.t4', planT4.ok === true && planT4.prerequisites.some((item) => item.type === 'chapterFlag' && item.value === 'C3.truth_found') && planT4.prerequisites.some((item) => item.type === 'commissionCleared' && item.value === 'memory-flip.T3'), sortedJson(planT4.prerequisites));
  record('unlock-plan.t6', planT6.ok === true && planT6.prerequisites.some((item) => item.type === 'chapterFlag' && item.value === 'C5.star_tower_resolved'), sortedJson(planT6.prerequisites));

  /* 8) fixture 形状 */
  const goodFixture = { gameId: 'memory-flip', tiers: {}, cleanup: async () => {} };
  TIERS.forEach((tier) => {
    goodFixture.tiers[tier] = { success: async () => ({}), failure: async () => ({}) };
  });
  const goodShape = schema.validateFixtureShape(goodFixture);
  record('fixture-shape.good', goodShape.ok === true && goodShape.errors.length === 0, (goodShape.errors || []).join('; '));
  const badFixture = cloneJson({ gameId: 'nope', tiers: { 1: { success: 1 } }, cleanup: 2 });
  const badShape = schema.validateFixtureShape(badFixture);
  record(
    'fixture-shape.bad',
    badShape.ok === false && expectIssues(badShape, 'fixture-gameid-unknown') && expectIssues(badShape, 'fixture-tier-handler') && expectIssues(badShape, 'fixture-tier-missing') && expectIssues(badShape, 'fixture-cleanup'),
    (badShape.errors || []).slice(0, 2).join('; ')
  );
  const extraFixture = { gameId: 'memory-flip', tiers: goodFixture.tiers, notes: 'x' };
  const extraShape = schema.validateFixtureShape(extraFixture);
  record('fixture-shape.unknown-export-warns', extraShape.ok === true && extraShape.warnings.some((item) => item.indexOf('fixture-extra-export') === 0), '未知导出只告警');

  /* 9) 发现/缺口报告（不依赖实际文件内容） */
  const discovered = discoverFixtures();
  record(
    'runner.fixture-discovery',
    discovered.length === 16 && discovered.every((entry) => entry.rel === 'tools/' + FIXTURE_PREFIX + entry.gameId + FIXTURE_EXT && typeof entry.present === 'boolean'),
    discovered.length + ' 条'
  );
  const fixtureReport = await validateFixtures();
  record('runner.fixture-report-missing', fixtureReport.present + fixtureReport.missing === 16 && fixtureReport.ok + fixtureReport.invalid === fixtureReport.present, 'present=' + fixtureReport.present + ' missing=' + fixtureReport.missing);

  /* 10) 退出码语义 */
  record('exit.validate-clean', computeValidateExitCode({ contentOk: true, contentWarnings: 8, fixtureErrors: 0, missing: 16 }, {}) === EXIT_PASS, '内容 PASS + 全缺失 → 0');
  record('exit.validate-strict', computeValidateExitCode({ contentOk: true, contentWarnings: 8, fixtureErrors: 0, missing: 16 }, { strict: true }) === EXIT_FAIL, '--strict → 1');
  record('exit.validate-content-fail', computeValidateExitCode({ contentOk: false, contentWarnings: 0, fixtureErrors: 0, missing: 16 }, {}) === EXIT_FAIL, '内容失败 → 1');
  record('exit.validate-fixture-fail', computeValidateExitCode({ contentOk: true, contentWarnings: 0, fixtureErrors: 1, missing: 15 }, {}) === EXIT_FAIL, 'fixture 形状失败 → 1');
  record('exit.env', computeValidateExitCode({ envError: true }, {}) === EXIT_ENV, '环境错误 → 2');

  /* 11) harness 计划形状（无浏览器也可断言） */
  record('runner.evidence-plan', EVIDENCE_CHECKS.length === 5 && EVIDENCE_CHECKS.indexOf('success') === 0 && EVIDENCE_CHECKS.indexOf('failure') > 0 && EVIDENCE_CHECKS.indexOf('suspend') > 0 && EVIDENCE_CHECKS.indexOf('idempotent') > 0, EVIDENCE_CHECKS.join(','));
  record('runner.constants', DEFAULT_SERVER_PORT === 8920 && DEFAULT_CDP_PORT === 9520 && TICKET_KEY === 'studiokit:arcade:career:ticket.v1', '端口/ticket 契约');

  /* 12) failure 归因纯函数（value-not-met 无 reached 回传时的判定） */
  const objectiveWithValue = { kind: 'tile.created', atLeast: 1, minValue: { field: 'value', value: 64 } };
  const objectiveCountOnly = { kind: 'pair.match', atLeast: 3 };
  record('attribution.objective-not-met-ok', failureAttributionOk('objective-not-met', { observed: 2 }, objectiveCountOnly) === true, 'observed 2 < atLeast 3');
  record('attribution.objective-not-met-bad', failureAttributionOk('objective-not-met', { observed: 3 }, objectiveCountOnly) === false, 'observed 3 >= atLeast 3');
  record('attribution.value-not-met-ok', failureAttributionOk('value-not-met', { observed: 1 }, objectiveWithValue) === true, '计数已过 + minValue 存在');
  record('attribution.value-not-met-bad', failureAttributionOk('value-not-met', { observed: 1 }, objectiveCountOnly) === false, '无 minValue 不得判 value-not-met');
  record('attribution.context-mismatch', failureAttributionOk('context-mismatch', {}, objectiveCountOnly) === true, '上下文不匹配可归因');
  record('attribution.unknown-reason', failureAttributionOk('something-else', {}, objectiveCountOnly) === false, '未知原因不通过');

  const failed = results.filter((item) => !item.ok);
  console.log('');
  console.log('SELF-TEST  ' + (results.length - failed.length) + '/' + results.length + ' PASS  failed=' + failed.length);
  return failed.length === 0 ? EXIT_PASS : EXIT_FAIL;
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const USAGE = [
  'StudioKit Arcade Life 0.17 — 委托内容 schema + fixture runner（D17-02）',
  '',
  '用法：',
  '  node tools/career_mission_fixture_runner.mjs --validate [--strict]   # 96 内容 schema + 16 fixture 形状（不启 Chrome）',
  '  node tools/career_mission_fixture_runner.mjs --list                  # 列出内容/fixture 缺口',
  '  node tools/career_mission_fixture_runner.mjs --self-test             # runner 自检（无 fixture 也可）',
  '  node tools/career_mission_fixture_runner.mjs --run=<gameId|all> [--tier=1,4,6] [--allow-missing] [--verbose]',
  '',
  '选项：',
  '  --strict          内容告警/缺失 fixture 视为失败（门禁模式）',
  '  --allow-missing   --run=all 时允许缺失 fixture（默认缺失不算通过）',
  '  --verbose         打印每条证据检查结果',
  '  --timeout=<ms>    harness 单 tier 超时（默认 ' + DEFAULT_TIER_TIMEOUT_MS + 'ms）',
  '  --help            显示本帮助',
  '',
  '环境变量：',
  '  CAREER_MISSION_PORT        静态服务器端口（默认 ' + DEFAULT_SERVER_PORT + '）',
  '  CAREER_MISSION_CDP         Chrome DevTools 端口（默认 ' + DEFAULT_CDP_PORT + '）',
  '  CAREER_MISSION_ARTIFACTS   失败截图/诊断输出目录（默认系统临时目录）',
  '  CAREER_MISSION_FIXTURE_DIR 覆盖 fixture 发现目录（默认 tools/，仅供自测/隔离环境）',
  '  CHROME_PATH                本机 Chrome 路径',
  '',
  '退出码：0=PASS；1=内容/fixture/tier 失败；2=runner 环境或用法错误。',
].join('\n');

function parseArgs(argv) {
  const options = {
    mode: null,
    gameId: null,
    tiers: null,
    strict: false,
    verbose: false,
    allowMissing: false,
    help: false,
    handlerTimeoutMs: DEFAULT_HANDLER_TIMEOUT_MS,
    tierTimeoutMs: DEFAULT_TIER_TIMEOUT_MS,
    unknown: [],
    errors: [],
  };
  const setMode = (mode) => {
    if (options.mode && options.mode !== mode) {
      options.errors.push('只能选择一种模式（已选 ' + options.mode + '，又见 ' + mode + '）');
      return;
    }
    options.mode = mode;
  };
  (Array.isArray(argv) ? argv : []).forEach((arg) => {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--validate') setMode('validate');
    else if (arg === '--list') setMode('list');
    else if (arg === '--self-test') setMode('self-test');
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--allow-missing') options.allowMissing = true;
    else if (arg.indexOf('--run=') === 0) {
      setMode('run');
      options.gameId = arg.slice('--run='.length);
      if (options.gameId !== 'all' && GAMES.indexOf(options.gameId) < 0) {
        options.errors.push('--run 的值必须是 16 款游戏之一或 all：' + q(options.gameId));
      }
    } else if (arg.indexOf('--tier=') === 0) {
      const raw = arg.slice('--tier='.length);
      const tiers = raw.split(',').map((part) => Number(part.trim())).filter((value) => Number.isInteger(value));
      if (!tiers.length || tiers.some((value) => TIERS.indexOf(value) < 0)) {
        options.errors.push('--tier 必须是 1..6 的逗号列表：' + q(raw));
      } else {
        options.tiers = Array.from(new Set(tiers)).sort((a, b) => a - b);
      }
    } else if (arg.indexOf('--timeout=') === 0) {
      const ms = Number(arg.slice('--timeout='.length));
      if (!Number.isInteger(ms) || ms < 5000 || ms > 1800000) {
        options.errors.push('--timeout 必须是 5000..1800000 的整数毫秒');
      } else {
        options.tierTimeoutMs = ms;
      }
    } else {
      options.unknown.push(arg);
    }
  });
  if (options.unknown.length) options.errors.push('未知参数：' + options.unknown.join(' '));
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return EXIT_PASS;
  }
  if (options.errors.length) {
    options.errors.forEach((message) => console.error('USAGE  ' + message));
    console.error('');
    console.error(USAGE);
    return EXIT_ENV;
  }
  if (!options.mode) {
    console.error(USAGE);
    return EXIT_ENV;
  }
  try {
    if (options.mode === 'validate') return await runValidateMode(options);
    if (options.mode === 'list') return await runListMode(options);
    if (options.mode === 'self-test') return await runSelfTest(options);
    if (options.mode === 'run') return await runMode(options);
    console.error('USAGE  未知模式');
    return EXIT_ENV;
  } catch (err) {
    console.error('ENV    runner 未捕获异常：' + errorText(err));
    return EXIT_ENV;
  }
}

process.exitCode = await main(process.argv.slice(2));
