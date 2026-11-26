#!/usr/bin/env node
/**
 * StudioKit Arcade Life 0.17 — D17-26：96 委托逐项自动化回归 / 源证据汇总
 *
 * 验收目标（任务卡 D17-26）：
 * - 读取真实 96 委托内容（apps/arcade/career/content/commissions.json）与 16 个
 *   tools/career_fixture_<gameId>.mjs：断言每游戏 T1–T6、fixture 形状、无静默 skip；
 *   缺 fixture / 缺 tier 必须 FAIL（exit 1），不允许“跳过即通过”。
 * - 每款游戏至少一次真实 E2E：用 D17-02 runner 的 `--run=<gameId>` 子进程驱动 6 个 tier
 *   （真实 Chrome + 真实 IndexedDB + 真实 ticket，不 mock），96 tier 全量串行；
 *   子进程端口按游戏递增（默认 M96_PORT/M96_CDP，基准 8942/9542），单轮胎超时 120s。
 * - 每 tier 记录：success（收据 / claim / 流水 / 钱包）、failure（objective-not-met /
 *   value-not-met、零奖励、无收据）、suspend/reload（ticket/run 恢复）、duplicate 幂等；
 *   T4–T6 必须证明受控剧情旗标（C3/C4/C5）。
 * - 跨游戏抽样（独立于 runner 的第二套 Chrome harness，直接复用真实 fixture 模块）：
 *   4 款游戏 × 1 tier 的经典 5 键逐字节不变；4 款挑战/禅/割草入口不可进；
 *   8 条委托的钱包/材料/证据与内容一致。
 * - 输出 PASS/FAIL + 计数；任何失败列出 game/tier/reason；退出码 0/1/2。
 *
 * 约束：
 * - 只读仓库内容/fixture/游戏页/runner，不修改任何生产文件；
 * - runner 顶层会执行 main()，无法 import，因此 E2E 统一走子进程；抽样阶段复用
 *   runner 的浏览器表达式语义（见 §sample harness 注释），不另造一套协议；
 * - 运行产物（逐游戏日志、表格、summary.json）写到仓库外目录：
 *   CAREER_96_ARTIFACTS 或 <tmp>/studiokit-career-96-artifacts。
 *
 * 用法：
 *   node tools/career_96_missions_test.mjs                     # 全量：static + e2e(16×6) + sample
 *   node tools/career_96_missions_test.mjs --static            # 只做内容/fixture/负例门禁
 *   node tools/career_96_missions_test.mjs --e2e               # static + runner 96 tier
 *   node tools/career_96_missions_test.mjs --sample            # static + 独立抽样 E2E
 *   node tools/career_96_missions_test.mjs --games=memory-flip,merge-2048
 *   node tools/career_96_missions_test.mjs --samples=memory-flip.T2,road-rush.T1
 *   node tools/career_96_missions_test.mjs --timeout=120000 --verbose
 *
 * 环境：
 *   M96_PORT / M96_CDP        runner 子进程端口基准（默认 8942 / 9542，逐游戏 +0..15）
 *   CAREER_96_ARTIFACTS       运行产物目录（默认系统临时目录）
 *   CHROME_PATH               本机 Chrome（默认 C:\Program Files\Google\Chrome\Application\chrome.exe）
 *
 * 退出码：0=PASS；1=内容/fixture/tier/抽样失败；2=runner 环境或用法错误（端口/Chrome 等）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
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
 * 常量 / 契约
 * ------------------------------------------------------------------ */

const GAMES = schema.GAME_IDS.slice();
const TIERS = schema.TIERS.slice();
const CONTENT_REL = 'apps/arcade/career/content/commissions.json';
const CONTENT_PATH = path.join(REPO_ROOT, CONTENT_REL);
const RUNNER_REL = 'tools/career_mission_fixture_runner.mjs';
const RUNNER_PATH = path.join(REPO_ROOT, RUNNER_REL);
const TOOLS_DIR = path.join(REPO_ROOT, 'tools');
const FIXTURE_PREFIX = 'career_fixture_';
const FIXTURE_EXT = '.mjs';
const TICKET_KEY = 'studiokit:arcade:career:ticket.v1';
const EXPECTED_TOTAL = GAMES.length * TIERS.length;

/** 职业 run 不得改动的经典 5 键（ADR §19.3）。 */
const ISO_KEYS = [
  'studiokit:arcade:runs:v1',
  'studiokit:arcade:progress:v1',
  'studiokit:arcade:scores:v1',
  'studiokit:arcade:challenge:v1',
  'studiokit:arcade:meta:v1',
];
/** 抽样前写入的哨兵值：engine 的 5 个 key 读取器都 fail-closed 到空，因此不影响页面。 */
const ISO_SENTINEL = '{"d17-26":"classic-sentinel"}';
const DEFAULT_M96_PORT = 8942;
const DEFAULT_M96_CDP = 9542;
const DEFAULT_TIER_TIMEOUT_MS = 120000;
const SAMPLE_PORT_OFFSET = 64;
const PER_GAME_OUTER_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_READY_TIMEOUT_MS = 20000;
const MAX_LOG_CHARS = 6 * 1024 * 1024;

/** runner `--run` 每个 tier 必须出现的证据（打印形式：phase.phase.checkId，见 D17-02）。 */
const REQUIRED_SUCCESS_CHECKS = [
  'success.success.handler',
  'success.success.commission-start',
  'success.success.events-observed',
  'success.success.settle-ok',
  'success.success.receipt',
  'success.success.receipt-commission',
  'success.success.repeat',
  'success.success.credits',
  'success.success.items',
  'success.success.evidence',
  'success.success.flags',
  'success.success.txids',
  'success.success.claim-row',
  'success.success.ledger',
  'success.success.wallet-credits',
  'success.success.wallet-items',
  'success.success.run-claimed',
  'success.idempotent.duplicate',
  'success.idempotent.receipt',
  'success.idempotent.wallet',
];
const REQUIRED_FAILURE_CHECKS = [
  'failure.failure.handler',
  'failure.failure.commission-start',
  'failure.failure.settle-not-ok',
  'failure.failure.reason',
  'failure.failure.attribution',
  'failure.failure.no-receipt',
  'failure.failure.zero-reward',
  'failure.failure.run-status',
];
const REQUIRED_SUSPEND_CHECKS = [
  'suspend.suspend.start',
  'suspend.suspend.active',
  'suspend.suspend.restored',
  'suspend.suspend.ticket-storage',
  'suspend.suspend.run-active',
  'suspend.suspend.no-wallet-change',
  'suspend.suspend.abandon',
  'suspend.suspend.abandon-status',
  'suspend.suspend.abandon-no-reward',
];
const ALLOWED_FAILURE_REASONS = ['objective-not-met', 'value-not-met', 'context-mismatch'];

/**
 * 独立抽样计划（跨游戏）：
 * - classicIsolation=true 的 4 款用于「4 款游戏 × 1 tier 经典 5 键逐字节不变」+ 入口不可进；
 * - 全部 8 条用于「钱包/材料/证据与内容一致」。
 */
const SAMPLE_PLAN = [
  { id: 'memory-flip.T2', classicIsolation: false, entryProbe: null },
  { id: 'merge-2048.T2', classicIsolation: false, entryProbe: null },
  { id: 'blackjack.T3', classicIsolation: false, entryProbe: null },
  { id: 'snake-run.T2', classicIsolation: false, entryProbe: null },
  { id: 'brick-breaker.T2', classicIsolation: true, entryProbe: 'challenge' },
  { id: 'block-drop.T2', classicIsolation: true, entryProbe: 'zen+challenge' },
  { id: 'star-raid.T2', classicIsolation: true, entryProbe: 'mow+challenge' },
  { id: 'road-rush.T1', classicIsolation: true, entryProbe: 'challenge' },
];
/** 失败归因抽样：一条 objective-not-met、一条 value-not-met（真实驱动）。 */
const FAILURE_SAMPLES = [
  { id: 'star-raid.T2', expectedReason: 'objective-not-met' },
  { id: 'road-rush.T1', expectedReason: 'value-not-met' },
];

const ARTIFACTS_DIR = path.resolve(
  process.env.CAREER_96_ARTIFACTS || path.join(os.tmpdir(), 'studiokit-career-96-artifacts')
);

/* ------------------------------------------------------------------ *
 * 通用工具
 * ------------------------------------------------------------------ */

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function errorText(err) {
  if (!err) return 'unknown';
  if (typeof err === 'string') return err;
  if (typeof err.message === 'string' && err.message) return err.message;
  return String(err);
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
    return '{' + Object.keys(value).sort().map((key) => q(key) + ': ' + sortedJson(value[key])).join(',') + '}';
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

function diffItems(before, after) {
  const out = {};
  const keys = new Set(Object.keys(before || {}).concat(Object.keys(after || {})));
  keys.forEach((key) => {
    const delta = Number((after || {})[key] || 0) - Number((before || {})[key] || 0);
    if (delta !== 0) out[key] = delta;
  });
  return out;
}

function formatDuration(ms) {
  return (Math.max(0, Number(ms) || 0) / 1000).toFixed(1) + 's';
}

function splitId(id) {
  const match = /^([a-z0-9-]+)\.T([1-6])$/.exec(String(id || ''));
  if (!match) return null;
  return { gameId: match[1], tier: Number(match[2]) };
}

function relPath(abs) {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

/* ------------------------------------------------------------------ *
 * 记录器（static / sample 用；E2E 走逐 tier 结果）
 * ------------------------------------------------------------------ */

function createRecorder(label) {
  const results = [];
  let index = 0;
  function record(name, ok, detail) {
    index += 1;
    const item = { name, ok: !!ok, detail: detail ? String(detail) : '' };
    results.push(item);
    console.log(
      (item.ok ? 'PASS' : 'FAIL') + '  ' + pad(label + '.' + name, 46) +
      (item.ok || !item.detail ? '' : ' — ' + item.detail)
    );
  }
  function summary() {
    const failed = results.filter((item) => !item.ok);
    return { total: results.length, passed: results.length - failed.length, failed: failed.length, failures: failed };
  }
  return { record, summary, results };
}

/* ------------------------------------------------------------------ *
 * 命令行
 * ------------------------------------------------------------------ */

const USAGE = [
  'StudioKit Arcade Life 0.17 D17-26 — 96 委托自动化回归',
  '',
  '用法：node tools/career_96_missions_test.mjs [选项]',
  '',
  '  默认        static + e2e（16 游戏 × 6 tier）+ sample（8 委托 + 4 入口）',
  '  --static    只做内容/fixture/负例门禁（不启 Chrome）',
  '  --e2e       static + runner 子进程 96 tier',
  '  --sample    static + 独立抽样 E2E',
  '  --games=a,b          只跑指定游戏的 runner E2E（默认 16 款）',
  '  --samples=x.Tn,...   只跑指定抽样委托（默认 8 条）',
  '  --skip-static        父进程已通过 static 时，子进程 runner 跳过重复静态校验（真实 E2E 不跳过）',
  '  --timeout=MS         单 tier 超时（默认 120000，传给 runner --timeout）',
  '  --verbose            展开每条 check 明细',
  '  --help',
  '',
  '环境：M96_PORT=8942 M96_CDP=9542 CAREER_96_ARTIFACTS=<dir> CHROME_PATH=<chrome>',
  '',
  '退出码：0=PASS；1=内容/fixture/tier/抽样失败；2=环境或用法错误。',
].join('\n');

function parseArgs(argv) {
  const options = {
    help: false,
    staticOnly: false,
    e2e: false,
    sample: false,
    games: null,
    samples: null,
    skipStatic: false,
    tierTimeoutMs: DEFAULT_TIER_TIMEOUT_MS,
    verbose: false,
    errors: [],
  };
  (Array.isArray(argv) ? argv : []).forEach((arg) => {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--static') options.staticOnly = true;
    else if (arg === '--e2e') options.e2e = true;
    else if (arg === '--sample') options.sample = true;
    else if (arg === '--skip-static') options.skipStatic = true;
    else if (arg === '--verbose') options.verbose = true;
    else if (arg.indexOf('--games=') === 0) {
      const list = arg.slice('--games='.length).split(',').map((item) => item.trim()).filter(Boolean);
      const bad = list.filter((item) => GAMES.indexOf(item) < 0);
      if (!list.length || bad.length) options.errors.push('--games 含未知 gameId：' + (bad.join(',') || '(empty)'));
      else options.games = Array.from(new Set(list));
    } else if (arg.indexOf('--samples=') === 0) {
      const list = arg.slice('--samples='.length).split(',').map((item) => item.trim()).filter(Boolean);
      const bad = list.filter((item) => !splitId(item) || GAMES.indexOf(splitId(item).gameId) < 0);
      if (!list.length || bad.length) options.errors.push('--samples 含非法委托：' + (bad.join(',') || '(empty)'));
      else options.samples = Array.from(new Set(list));
    } else if (arg.indexOf('--timeout=') === 0) {
      const ms = Number(arg.slice('--timeout='.length));
      if (!Number.isInteger(ms) || ms < 10000 || ms > 1800000) {
        options.errors.push('--timeout 必须是 10000..1800000 的整数毫秒');
      } else options.tierTimeoutMs = ms;
    } else {
      options.errors.push('未知参数：' + arg);
    }
  });
  if (options.staticOnly && (options.e2e || options.sample)) {
    options.errors.push('--static 不能与 --e2e/--sample 同时使用');
  }
  if (options.skipStatic && (options.staticOnly || (!options.e2e && !options.sample))) {
    options.errors.push('--skip-static 只在 E2E/抽样阶段有效（且父进程须已通过 static 门禁）');
  }
  if (!options.staticOnly && !options.e2e && !options.sample) {
    options.e2e = true;
    options.sample = true;
  }
  return options;
}

/* ------------------------------------------------------------------ *
 * 子进程（runner E2E / 负例门禁）
 * ------------------------------------------------------------------ */

function spawnCapture(command, args, { env, cwd, timeoutMs } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let child = null;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Object.assign({
        code: null,
        signal: null,
        timedOut,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      }, payload));
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child) child.kill();
      } catch (err) {
        /* ignore */
      }
    }, Math.max(5000, timeoutMs || PER_GAME_OUTER_TIMEOUT_MS));
    try {
      child = spawn(command, args, {
        cwd: cwd || REPO_ROOT,
        env: env || process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      finish({ error: errorText(err) });
      return;
    }
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_LOG_CHARS) stdout = stdout.slice(-Math.floor(MAX_LOG_CHARS / 2));
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > MAX_LOG_CHARS) stderr = stderr.slice(-Math.floor(MAX_LOG_CHARS / 2));
    });
    child.on('error', (err) => finish({ error: errorText(err) }));
    child.on('close', (code, signal) => finish({ code, signal, ok: !timedOut && code === 0 }));
  });
}

/* ------------------------------------------------------------------ *
 * 端口预检：默认 M96_PORT/M96_CDP（8942/9542）；若该范围已被本机其他并行任务占用，
 * 整体平移 50 的倍数并显式记录（“子进程端口递增避免冲突”不被外部占用破坏）。
 * ------------------------------------------------------------------ */

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      try {
        server.close(() => resolve(true));
      } catch (err) {
        resolve(true);
      }
    });
  });
}

async function rangeFree(portBase, cdpBase, count) {
  for (let offset = 0; offset < count; offset += 1) {
    if (!(await isPortFree(portBase + offset))) return false;
    if (!(await isPortFree(cdpBase + offset))) return false;
  }
  return true;
}

async function selectPortRange(requestedPortBase, requestedCdpBase) {
  const shifts = [0, 50, 100, 150, 200, 250, 300, 350, 400];
  for (const shift of shifts) {
    const portBase = requestedPortBase + shift;
    const cdpBase = requestedCdpBase + shift;
    if (!(await rangeFree(portBase, cdpBase, GAMES.length))) continue;
    const samplePort = requestedPortBase + shift + SAMPLE_PORT_OFFSET;
    const sampleCdp = requestedCdpBase + shift + SAMPLE_PORT_OFFSET;
    if (!(await isPortFree(samplePort)) || !(await isPortFree(sampleCdp))) continue;
    return {
      ok: true,
      shift,
      portBase,
      cdpBase,
      samplePort,
      sampleCdp,
      requested: { portBase: requestedPortBase, cdpBase: requestedCdpBase },
    };
  }
  return { ok: false, requested: { portBase: requestedPortBase, cdpBase: requestedCdpBase } };
}

function ensureArtifactsDir() {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  return ARTIFACTS_DIR;
}function writeTextArtifact(name, text) {
  try {
    ensureArtifactsDir();
    const file = path.join(ARTIFACTS_DIR, name);
    fs.writeFileSync(file, text, 'utf8');
    return file;
  } catch (err) {
    return null;
  }
}

function writeJsonArtifact(name, payload) {
  return writeTextArtifact(name, JSON.stringify(payload, null, 2) + '\n');
}

/* ------------------------------------------------------------------ *
 * 静态阶段 1：内容（96 委托）
 * ------------------------------------------------------------------ */

function loadContent() {
  try {
    const raw = fs.readFileSync(CONTENT_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return { ok: true, content: parsed, raw };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

function indexCommissions(commissions) {
  const index = new Map();
  (Array.isArray(commissions) ? commissions : []).forEach((commission) => {
    if (!isObject(commission) || typeof commission.commissionId !== 'string') return;
    index.set(commission.commissionId, commission);
  });
  return index;
}

/** 每游戏 T1–T6 矩阵检查（纯函数，供真实内容与负例复用）。 */
function analyzeTierMatrix(commissions) {
  const errors = [];
  const byGame = new Map();
  (Array.isArray(commissions) ? commissions : []).forEach((commission) => {
    if (!isObject(commission)) {
      errors.push('非对象委托条目');
      return;
    }
    const gameId = commission.gameId;
    if (GAMES.indexOf(gameId) < 0) errors.push('未知 gameId：' + q(gameId));
    if (!byGame.has(gameId)) byGame.set(gameId, new Map());
    const tiers = byGame.get(gameId);
    const tier = Number(commission.tier);
    if (TIERS.indexOf(tier) < 0) errors.push((commission.commissionId || gameId) + ' tier 非法：' + q(commission.tier));
    if (tiers.has(tier)) errors.push(gameId + ' 重复 tier：T' + tier);
    tiers.set(tier, commission);
    if (commission.commissionId !== gameId + '.T' + tier) {
      errors.push('commissionId 与 gameId/tier 不一致：' + q(commission.commissionId) + ' vs ' + gameId + '.T' + tier);
    }
  });
  GAMES.forEach((gameId) => {
    const tiers = byGame.get(gameId);
    if (!tiers) {
      errors.push(gameId + ' 缺少全部 tier');
      return;
    }
    TIERS.forEach((tier) => {
      if (!tiers.has(tier)) errors.push(gameId + ' 缺少 T' + tier);
    });
    Array.from(tiers.keys()).forEach((tier) => {
      if (TIERS.indexOf(tier) < 0) errors.push(gameId + ' 出现越界 tier：' + q(tier));
    });
  });
  return { ok: errors.length === 0, errors, byGame, games: byGame.size, tiers: TIERS.length };
}

/** 内容自洽：解锁链 / 章节门 / 事件目录 / 奖励 token（跑在 schema 校验之外的独立断言）。 */
function analyzeContentContract(commissions, byGame) {
  const errors = [];
  const warnings = [];
  GAMES.forEach((gameId) => {
    const tiers = byGame.get(gameId) || new Map();
    for (let tier = 1; tier <= 6; tier += 1) {
      const commission = tiers.get(tier);
      if (!commission) continue;
      const objective = isObject(commission.objective) ? commission.objective : {};
      if (!schema.eventKindsFor(gameId).includes(objective.kind)) {
        errors.push(commission.commissionId + ' objective.kind 不在 §19.4 ' + gameId + ' 事件目录：' + q(objective.kind));
      }
      const unlock = isObject(commission.unlock) && Array.isArray(commission.unlock.all) ? commission.unlock.all : [];
      if (tier === 1) {
        if (unlock.length !== 0) errors.push(commission.commissionId + ' T1 不应有前置解锁');
        if (commission.chapterGate !== null && commission.chapterGate !== undefined) errors.push(commission.commissionId + ' T1 不应有 chapterGate');
      } else {
        const expectedPrev = gameId + '.T' + (tier - 1);
        if (!unlock.some((item) => isObject(item) && item.commissionCleared === expectedPrev)) {
          errors.push(commission.commissionId + ' 解锁链缺少 commissionCleared=' + expectedPrev);
        }
        const expectedFlag = tier >= 4 ? schema.CHAPTER_FLAGS[tier] : null;
        if (expectedFlag) {
          if (commission.chapterGate !== expectedFlag) {
            errors.push(commission.commissionId + ' chapterGate 应为 ' + expectedFlag + '，实际 ' + q(commission.chapterGate));
          }
          if (!unlock.some((item) => isObject(item) && item.chapterFlag === expectedFlag)) {
            errors.push(commission.commissionId + ' 解锁链缺少 chapterFlag=' + expectedFlag);
          }
        } else if (commission.chapterGate) {
          errors.push(commission.commissionId + ' T' + tier + ' 不应有 chapterGate');
        }
      }
      const reward = isObject(commission.reward) ? commission.reward : {};
      const credits = Number(reward.credits) || 0;
      const salary = Number(commission.repeatSalaryCredits) || 0;
      if (!Number.isInteger(credits) || credits < 0 || credits > schema.LIMITS.maxCredits) {
        errors.push(commission.commissionId + ' reward.credits 越界：' + q(reward.credits));
      }
      if (!Number.isInteger(salary) || salary < 0 || salary > schema.LIMITS.maxSalary) {
        errors.push(commission.commissionId + ' repeatSalaryCredits 越界：' + q(commission.repeatSalaryCredits));
      }
      const items = isObject(reward.items) ? reward.items : {};
      Object.keys(items).forEach((key) => {
        if (schema.MATERIAL_IDS.indexOf(key) < 0) errors.push(commission.commissionId + ' reward.items 非五材：' + key);
        if (!Number.isInteger(Number(items[key])) || Number(items[key]) < 1) {
          errors.push(commission.commissionId + ' reward.items[' + key + '] 非正整数');
        }
      });
      const evidence = Array.isArray(reward.evidence) ? reward.evidence : [];
      evidence.forEach((token) => {
        const prefixOk = schema.EVIDENCE_PREFIXES.some((prefix) => String(token).indexOf(prefix) === 0);
        if (!prefixOk) errors.push(commission.commissionId + ' reward.evidence token 非法：' + q(token));
        if (schema.MATERIAL_IDS.indexOf(token) >= 0) errors.push(commission.commissionId + ' reward.evidence 不得是可交易材料：' + q(token));
      });
      const flags = Array.isArray(reward.flags) ? reward.flags : [];
      flags.forEach((flag) => {
        if (!/^C[1-5]\.[a-z0-9_]+$/.test(String(flag))) errors.push(commission.commissionId + ' reward.flags 非法：' + q(flag));
      });
      if (gameId === 'star-raid') {
        const startParams = isObject(commission.startParams) ? commission.startParams : {};
        if (startParams.startLevel !== tier) errors.push(commission.commissionId + ' 星海 startLevel 应等于 tier：' + q(startParams.startLevel));
        if (schema.STAR_RAID_THEMES.indexOf(startParams.themeId) < 0) {
          errors.push(commission.commissionId + ' 星海 themeId 非法：' + q(startParams.themeId));
        }
      } else if (isObject(commission.startParams) && Object.keys(commission.startParams).length) {
        warnings.push(commission.commissionId + ' 非星海 startParams 非空：' + sortedJson(commission.startParams));
      }
      if (commission.professionId && schema.DEFAULT_PROFESSION_IDS.indexOf(commission.professionId) < 0) {
        errors.push(commission.commissionId + ' professionId 非法：' + q(commission.professionId));
      }
    }
  });
  return { ok: errors.length === 0, errors, warnings };
}

/* ------------------------------------------------------------------ *
 * 静态阶段 2：fixture（16 × 6）
 * ------------------------------------------------------------------ */

async function loadFixtures() {
  const entries = [];
  for (const gameId of GAMES) {
    const rel = 'tools/' + FIXTURE_PREFIX + gameId + FIXTURE_EXT;
    const file = path.join(TOOLS_DIR, FIXTURE_PREFIX + gameId + FIXTURE_EXT);
    const entry = {
      gameId,
      rel,
      file,
      exists: fs.existsSync(file),
      fixture: null,
      shape: null,
      errors: [],
      warnings: [],
    };
    if (entry.exists) {
      try {
        entry.fixture = await import(pathToFileURL(file).href);
      } catch (err) {
        entry.errors.push('import-failed: ' + errorText(err));
      }
    }
    entries.push(entry);
  }
  let extras = [];
  try {
    extras = fs.readdirSync(TOOLS_DIR)
      .filter((name) => name.indexOf(FIXTURE_PREFIX) === 0 && name.endsWith(FIXTURE_EXT))
      .map((name) => name.slice(FIXTURE_PREFIX.length, name.length - FIXTURE_EXT.length))
      .filter((gameId) => GAMES.indexOf(gameId) < 0)
      .map((gameId) => 'tools/' + FIXTURE_PREFIX + gameId + FIXTURE_EXT);
  } catch (err) {
    extras = [];
  }
  return { entries, extras };
}

/** fixture 形状检查（纯函数；同时用于真实 fixture 与缺 tier 负例）。 */
function analyzeFixtureShape(entry) {
  const errors = [];
  const fixture = entry && entry.fixture;
  if (!fixture) {
    errors.push('fixture 缺失或 import 失败（' + relPath(entry.file) + '）');
    return { ok: false, errors, warnings: [], tierCount: 0 };
  }
  const shape = schema.validateFixtureShape(fixture);
  errors.push.apply(errors, Array.isArray(shape.errors) ? shape.errors : []);
  if (fixture.gameId !== entry.gameId) errors.push('fixture-gameid-mismatch: 导出 ' + q(fixture.gameId) + '，期望 ' + q(entry.gameId));
  const tiers = fixture.tiers;
  const missing = [];
  TIERS.forEach((tier) => {
    const handlers = tiers && tiers[String(tier)];
    if (!handlers) {
      missing.push('T' + tier);
      return;
    }
    if (typeof handlers.success !== 'function') missing.push('T' + tier + '.success');
    if (typeof handlers.failure !== 'function') missing.push('T' + tier + '.failure');
  });
  if (missing.length) errors.push('fixture-tier-missing: ' + entry.gameId + ' 缺少 ' + missing.join(','));
  if (typeof fixture.cleanup !== 'function') errors.push('fixture-cleanup: ' + entry.gameId + ' cleanup 必须是函数');
  const tierCount = tiers && typeof tiers === 'object' ? Object.keys(tiers).length : 0;
  return {
    ok: errors.length === 0,
    errors,
    warnings: Array.isArray(shape.warnings) ? shape.warnings : [],
    tierCount,
  };
}

/** 完整性总判定（缺 fixture / 缺 tier / 形状非法 → ok=false + exit 1）。 */
function analyzeFixtureCompleteness(entries) {
  const errors = [];
  let present = 0;
  let okCount = 0;
  let invalid = 0;
  let missing = 0;
  entries.forEach((entry) => {
    if (!entry.exists) {
      missing += 1;
      errors.push('MISSING ' + entry.rel);
      return;
    }
    present += 1;
    const shape = analyzeFixtureShape(entry);
    entry.shape = shape;
    entry.errors = shape.errors.slice();
    entry.warnings = shape.warnings.slice();
    if (shape.ok) okCount += 1;
    else {
      invalid += 1;
      shape.errors.forEach((item) => errors.push('INVALID ' + entry.rel + ' — ' + item));
    }
  });
  const ok = errors.length === 0 && present === GAMES.length;
  return { ok, errors, present, okCount, invalid, missing };
}

function exitCodeForFixtureAnalysis(result) {
  if (!result) return 2;
  return result.ok ? 0 : 1;
}

/** 缺 tier 负例：拷贝第 1 个 fixture 的导出形状并删掉 T6（纯内存，不写仓库）。 */
function syntheticMissingTierFixture(entry) {
  const fixture = entry.fixture;
  const tiers = {};
  TIERS.forEach((tier) => {
    const handlers = fixture.tiers[String(tier)];
    tiers[String(tier)] = {
      success: handlers ? handlers.success : function success() {},
      failure: handlers ? handlers.failure : function failure() {},
    };
  });
  delete tiers['6'];
  return { gameId: fixture.gameId, tiers, cleanup: fixture.cleanup };
}

/* ------------------------------------------------------------------ *
 * 静态阶段 3：负例门禁（真实子进程 + 纯函数）
 * ------------------------------------------------------------------ */

function writeSyntheticFixtureDir(baseDir, { omitTierGame, omitTier } = {}) {
  fs.mkdirSync(baseDir, { recursive: true });
  GAMES.forEach((gameId) => {
    const lines = ["export const gameId = " + q(gameId) + ';'];
    lines.push('export const tiers = {');
    TIERS.forEach((tier) => {
      if (omitTierGame === gameId && omitTier === tier) return;
      lines.push('  ' + tier + ': { async success() { return {}; }, async failure() { return {}; } },');
    });
    lines.push('};');
    lines.push('export async function cleanup() {}');
    fs.writeFileSync(path.join(baseDir, FIXTURE_PREFIX + gameId + FIXTURE_EXT), lines.join('\n') + '\n', 'utf8');
  });
}

async function runNegativeGates(recorder, fixtureEntries) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studiokit-d1726-negative-'));
  try {
    /* N1：fixture 目录为空 → runner 必须 FAIL（exit 1），且不得出现任何 PASS tier。 */
    const emptyDir = path.join(tempRoot, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    const n1 = await spawnCapture(process.execPath, [RUNNER_PATH, '--run=all'], {
      env: Object.assign({}, process.env, { CAREER_MISSION_FIXTURE_DIR: emptyDir }),
      timeoutMs: 60000,
    });
    const n1PassTier = /^(?:PASS|FAIL) {2,}\S+ +T[1-6] /.test(String(n1.stdout || ''));
    const n1Missing = String(n1.stdout || '').indexOf('MISSING') !== -1;
    recorder.record(
      'gate.missing-fixture-exit1',
      n1.code === 1 && n1Missing && !n1PassTier,
      'exit=' + q(n1.code) + ' MISSING=' + n1Missing + ' tierLines=' + n1PassTier
    );

    /* N2：一个 fixture 缺 T6 → --validate 必须 FAIL（exit 1，fixture-tier-missing）。 */
    const brokenDir = path.join(tempRoot, 'broken');
    writeSyntheticFixtureDir(brokenDir, { omitTierGame: 'memory-flip', omitTier: 6 });
    const n2 = await spawnCapture(process.execPath, [RUNNER_PATH, '--validate'], {
      env: Object.assign({}, process.env, { CAREER_MISSION_FIXTURE_DIR: brokenDir }),
      timeoutMs: 60000,
    });
    const n2Text = String(n2.stdout || '');
    recorder.record(
      'gate.missing-tier-exit1',
      n2.code === 1 && n2Text.indexOf('fixture-tier-missing') !== -1,
      'exit=' + q(n2.code) + ' rule=' + (n2Text.indexOf('fixture-tier-missing') !== -1)
    );

    /* N3：纯函数 —— 空 fixture 集合 / 缺 tier 的 fixture 都必须判失败（不被静默跳过）。 */
    const emptyEntries = GAMES.map((gameId) => ({
      gameId,
      rel: 'tools/' + FIXTURE_PREFIX + gameId + FIXTURE_EXT,
      file: path.join(TOOLS_DIR, FIXTURE_PREFIX + gameId + FIXTURE_EXT),
      exists: false,
      fixture: null,
    }));
    const emptyResult = analyzeFixtureCompleteness(emptyEntries);
    recorder.record(
      'gate.completeness-empty',
      emptyResult.ok === false && exitCodeForFixtureAnalysis(emptyResult) === 1 && emptyResult.missing === GAMES.length,
      'missing=' + emptyResult.missing + ' exit=' + exitCodeForFixtureAnalysis(emptyResult)
    );

    const tierEntry = fixtureEntries.filter((entry) => entry.fixture)[0];
    const tierResult = tierEntry
      ? analyzeFixtureShape({ gameId: tierEntry.gameId, file: tierEntry.file, fixture: syntheticMissingTierFixture(tierEntry) })
      : { ok: true, errors: [] };
    recorder.record(
      'gate.completeness-missing-tier',
      tierResult.ok === false && tierResult.errors.some((item) => String(item).indexOf('fixture-tier-missing') === 0),
      tierEntry ? tierResult.errors.join('; ') : '无可复用 fixture'
    );

    /* N4：内容缺一条 → schema 必须判失败（content-count）。 */
    const content = loadContent();
    if (content.ok) {
      const mutated = JSON.parse(JSON.stringify(content.content));
      mutated.commissions.pop();
      const result = schema.validateCommissionContent(mutated);
      recorder.record(
        'gate.content-missing-tier',
        result.ok === false && (result.errors || []).some((item) => String(item).indexOf('content-count') === 0),
        'ok=' + result.ok + ' errors=' + (result.errors || []).length
      );
    } else {
      recorder.record('gate.content-missing-tier', false, '内容不可读：' + content.error);
    }
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (err) {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------------ *
 * 静态阶段入口
 * ------------------------------------------------------------------ */

async function runStaticPhase(options) {
  const recorder = createRecorder('static');
  const contentResult = loadContent();
  recorder.record('content.read', contentResult.ok, contentResult.ok ? relPath(CONTENT_PATH) : contentResult.error);
  if (!contentResult.ok) {
    return { recorder, content: null, fixtures: null, envErrors: [], failure: true };
  }
  const content = contentResult.content;
  recorder.record(
    'content.version',
    content.contentVersion === schema.CONTENT_VERSION,
    'contentVersion=' + q(content.contentVersion) + ' expected=' + q(schema.CONTENT_VERSION)
  );
  const commissions = Array.isArray(content.commissions) ? content.commissions : [];
  recorder.record('content.total', commissions.length === EXPECTED_TOTAL, 'total=' + commissions.length + ' expected=' + EXPECTED_TOTAL);
  const matrix = analyzeTierMatrix(commissions);
  recorder.record('content.matrix', matrix.ok, matrix.ok ? '16 games × 6 tiers' : matrix.errors.slice(0, 6).join('; '));
  recorder.record(
    'content.ids-unique',
    new Set(commissions.map((item) => item.commissionId)).size === commissions.length,
    'unique=' + new Set(commissions.map((item) => item.commissionId)).size
  );
  const schemaResult = schema.validateCommissionContent(content);
  recorder.record(
    'content.schema',
    schemaResult.ok === true,
    schemaResult.ok ? '96/96' : (schemaResult.errors || []).slice(0, 6).join('; ')
  );
  const contract = analyzeContentContract(commissions, matrix.byGame);
  recorder.record('content.contract', contract.ok, contract.ok ? 'unlock/chapter/kind/reward 一致' : contract.errors.slice(0, 6).join('; '));
  if (contract.warnings.length) console.log('WARN  static.content-contract  ' + contract.warnings.length + ' warning(s)：' + contract.warnings.slice(0, 4).join('; '));

  const fixtureBundle = await loadFixtures();
  const completeness = analyzeFixtureCompleteness(fixtureBundle.entries);
  recorder.record('fixtures.files', fixtureBundle.entries.every((entry) => entry.exists) && fixtureBundle.entries.length === GAMES.length, 'present=' + completeness.present + '/' + GAMES.length);
  recorder.record('fixtures.extras', fixtureBundle.extras.length === 0, fixtureBundle.extras.length ? fixtureBundle.extras.join(', ') : '无额外 fixture');
  recorder.record(
    'fixtures.shape',
    completeness.ok,
    completeness.ok ? '16/16 ok, tiers=6' : completeness.errors.slice(0, 8).join('; ')
  );
  recorder.record(
    'fixtures.exit-semantics',
    exitCodeForFixtureAnalysis(completeness) === 0,
    'completeness ok=' + completeness.ok + ' exit=' + exitCodeForFixtureAnalysis(completeness)
  );
  fixtureBundle.entries.forEach((entry) => {
    const shape = entry.shape || analyzeFixtureShape(entry);
    recorder.record(
      'fixture.' + entry.gameId,
      entry.exists && shape.ok,
      entry.exists ? ('tiers=' + shape.tierCount + ' errors=' + shape.errors.length) : 'MISSING ' + entry.rel
    );
  });

  /* runner 侧交叉验证：--validate / --list（真实内容 + 真实 fixture 目录）。 */
  const validateRun = await spawnCapture(process.execPath, [RUNNER_PATH, '--validate'], { timeoutMs: 120000 });
  const validateText = String(validateRun.stdout || '');
  recorder.record(
    'runner.validate',
    validateRun.code === 0 && /content=PASS/.test(validateText) && /fixtures\(present=16 ok=16 invalid=0 missing=0\)/.test(validateText),
    'exit=' + q(validateRun.code) + ' ' + (validateText.split(/\r?\n/).filter((line) => line.indexOf('SUMMARY') === 0)[0] || '(no summary)')
  );
  const listRun = await spawnCapture(process.execPath, [RUNNER_PATH, '--list'], { timeoutMs: 120000 });
  const listText = String(listRun.stdout || '');
  recorder.record(
    'runner.list',
    listRun.code === 0 && /FIXTURE GAPS {2}0\/16/.test(listText) && /CONTENT {2}96\/96/.test(listText),
    'exit=' + q(listRun.code)
  );

  /* 负例门禁：缺 fixture / 缺 tier / 内容缺一条都必须 FAIL（exit 1），不静默跳过。 */
  await runNegativeGates(recorder, fixtureBundle.entries);

  const summary = recorder.summary();
  return {
    recorder,
    content,
    fixtures: fixtureBundle,
    completeness,
    matrix,
    envErrors: [],
    failure: summary.failed > 0,
    summary,
  };
}

/* ------------------------------------------------------------------ *
 * E2E 阶段：runner `--run=<gameId>` 子进程 × 16，每游戏 6 tier
 * ------------------------------------------------------------------ */

const CHECK_LINE_RE = /^ {2}(PASS|FAIL) {2}(\S+) +T(\d+) ([A-Za-z]+\.[A-Za-z0-9_.-]+)(?: — (.*))?$/;
const TIER_LINE_RE = /^(PASS|FAIL) +(\S+) +T(\d+) +(\d+)\/(\d+) checks +([0-9.]+)s/;
const SUMMARY_RE = /^SUMMARY +run +tiers pass=(\d+) fail=(\d+) missing=(\d+) invalid=(\d+) harnessErrors=(\d+)/;

function parseRunnerOutput(gameId, output) {
  const tiers = new Map();
  const failures = [];
  let summary = null;
  let skipped = 0;
  let sawContentPASS = false;
  const lines = String(output || '').split(/\r?\n/);
  lines.forEach((line) => {
    /* SKIP-STATIC 是父进程已验证 static 后的显式优化标记，不是跳过 tier 证据。 */
    if (line.indexOf('SKIP') === 0 && line.indexOf('SKIP-STATIC') !== 0) skipped += 1;
    if (/^PASS {2}content-schema/.test(line)) sawContentPASS = true;
    const summaryMatch = SUMMARY_RE.exec(line);
    if (summaryMatch) {
      summary = {
        pass: Number(summaryMatch[1]),
        fail: Number(summaryMatch[2]),
        missing: Number(summaryMatch[3]),
        invalid: Number(summaryMatch[4]),
        harnessErrors: Number(summaryMatch[5]),
      };
      return;
    }
    const tierMatch = TIER_LINE_RE.exec(line);
    if (tierMatch && tierMatch[2] === gameId) {
      const tier = Number(tierMatch[3]);
      if (!tiers.has(tier)) tiers.set(tier, { tier, ok: false, passed: 0, total: 0, durationMs: 0, checks: new Map(), tierLine: line, failures: [] });
      const record = tiers.get(tier);
      record.ok = tierMatch[1] === 'PASS';
      record.passed = Number(tierMatch[4]);
      record.total = Number(tierMatch[5]);
      record.durationMs = Math.round(Number(tierMatch[6]) * 1000);
      record.tierLine = line;
      return;
    }
    const checkMatch = CHECK_LINE_RE.exec(line);
    if (checkMatch && checkMatch[2] === gameId) {
      const tier = Number(checkMatch[3]);
      if (!tiers.has(tier)) tiers.set(tier, { tier, ok: false, passed: 0, total: 0, durationMs: 0, checks: new Map(), tierLine: null, failures: [] });
      const record = tiers.get(tier);
      const id = checkMatch[4];
      record.checks.set(id, { ok: checkMatch[1] === 'PASS', detail: checkMatch[5] || '' });
      if (checkMatch[1] !== 'PASS') failures.push({ source: 'check', tier, id, detail: checkMatch[5] || '' });
      return;
    }
    if (/^FAIL {2,}\S+ +T\d+/.test(line)) failures.push({ source: 'tier-line', detail: line.trim() });
  });
  return { tiers, failures, summary, skipped, sawContentPASS };
}

function parseJsonDetail(text) {
  try {
    return { ok: true, value: JSON.parse(String(text)) };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

/** 单 tier 校验：证据齐全 + 内容一致性 + 受控旗标 + 归因自洽。 */
function validateTier(gameId, tier, record, commission) {
  const failures = [];
  const add = (id, reason) => failures.push({ gameId, tier, id, reason });
  const requireChecks = (ids, phaseName) => {
    ids.forEach((id) => {
      const check = record.checks.get(id);
      if (!check) add(id, phaseName + ' 缺少 check（未执行/被跳过）');
      else if (!check.ok) add(id, check.detail || 'check failed');
    });
  };
  requireChecks(REQUIRED_SUCCESS_CHECKS, 'success');
  requireChecks(REQUIRED_FAILURE_CHECKS, 'failure');
  requireChecks(REQUIRED_SUSPEND_CHECKS, 'suspend');

  /* 受控剧情旗标：T4/T5/T6 分别 C3.truth_found / C4.city_power_restored / C5.star_tower_resolved。 */
  if (tier >= 4) {
    const expected = schema.CHAPTER_FLAGS[tier];
    const check = record.checks.get('suspend.suspend.seed-flag');
    if (!check) add('suspend.suspend.seed-flag', 'T' + tier + ' 缺少受控旗标 check');
    else if (!check.ok) add('suspend.suspend.seed-flag', check.detail || '受控旗标注入失败');
    else if (String(check.detail).trim() !== expected) add('suspend.suspend.seed-flag', '旗标应为 ' + expected + '，实际 ' + q(check.detail));
  }

  /* success 收据字段必须与内容逐字段一致。 */
  const reward = isObject(commission.reward) ? commission.reward : {};
  const expected = {
    credits: Number(reward.credits) || 0,
    items: isObject(reward.items) ? reward.items : {},
    evidence: Array.isArray(reward.evidence) ? reward.evidence : [],
    flags: Array.isArray(reward.flags) ? reward.flags : [],
  };
  const creditsCheck = record.checks.get('success.success.credits');
  if (creditsCheck && creditsCheck.ok) {
    const match = /expected (-?\d+), got (-?\d+)/.exec(creditsCheck.detail);
    if (!match) add('success.success.credits', '无法解析 detail：' + q(creditsCheck.detail));
    else if (Number(match[1]) !== expected.credits || Number(match[2]) !== expected.credits) {
      add('success.success.credits', '收据工钱与内容不一致：' + creditsCheck.detail + ' content=' + expected.credits);
    }
  }
  const compareJsonCheck = (id, expectedValue) => {
    const check = record.checks.get(id);
    if (!check || !check.ok) return;
    const match = /expected (.+), got (.+)$/.exec(check.detail);
    if (!match) {
      add(id, '无法解析 detail：' + q(check.detail));
      return;
    }
    const exp = parseJsonDetail(match[1]);
    const got = parseJsonDetail(match[2]);
    if (!exp.ok || !got.ok) {
      add(id, 'detail JSON 解析失败：' + q(check.detail));
      return;
    }
    if (!sameJson(exp.value, expectedValue)) add(id, '赛前期望与内容不一致：' + q(exp.value) + ' content=' + sortedJson(expectedValue));
    if (!sameJson(got.value, expectedValue)) add(id, '收据与内容不一致：' + q(got.value) + ' content=' + sortedJson(expectedValue));
  };
  compareJsonCheck('success.success.items', expected.items);
  compareJsonCheck('success.success.evidence', expected.evidence);
  compareJsonCheck('success.success.flags', expected.flags);

  const receiptCommission = record.checks.get('success.success.receipt-commission');
  if (receiptCommission && receiptCommission.ok && String(receiptCommission.detail).trim() !== q(gameId + '.T' + tier)) {
    add('success.success.receipt-commission', '收据委托号不符：' + q(receiptCommission.detail));
  }
  const repeatCheck = record.checks.get('success.success.repeat');
  if (repeatCheck && repeatCheck.ok && !/repeat=false/.test(repeatCheck.detail)) add('success.success.repeat', '首通不应 repeat=true：' + q(repeatCheck.detail));
  const dupCheck = record.checks.get('success.idempotent.duplicate');
  if (dupCheck && dupCheck.ok && !/duplicate=true/.test(dupCheck.detail)) add('success.idempotent.duplicate', '复结算应 duplicate=true：' + q(dupCheck.detail));

  /* 钱包增量：credits/items 必须等于内容奖励（零奖励阶为 0/{}）。 */
  const walletCredits = record.checks.get('success.success.wallet-credits');
  if (walletCredits && walletCredits.ok) {
    const match = /delta=(-?\d+) expected=(-?\d+)/.exec(walletCredits.detail);
    if (!match) add('success.success.wallet-credits', '无法解析 detail：' + q(walletCredits.detail));
    else if (Number(match[1]) !== expected.credits || Number(match[2]) !== expected.credits) {
      add('success.success.wallet-credits', '钱包增量与内容不一致：' + walletCredits.detail);
    }
  }
  const walletItems = record.checks.get('success.success.wallet-items');
  if (walletItems && walletItems.ok) {
    const match = /delta=(.+)$/.exec(walletItems.detail);
    const parsed = match ? parseJsonDetail(match[1]) : { ok: false };
    if (!parsed.ok) add('success.success.wallet-items', '无法解析 detail：' + q(walletItems.detail));
    else if (!sameJson(parsed.value, expected.items)) add('success.success.wallet-items', '钱包材料增量与内容不一致：' + q(parsed.value) + ' content=' + sortedJson(expected.items));
  }

  /* failure：可归因 reason + 零奖励 + 无收据 + run failed + 归因数值自洽。 */
  const reasonCheck = record.checks.get('failure.failure.reason');
  let reason = null;
  if (reasonCheck && reasonCheck.ok) {
    const match = /reason=("(?:[^"\\]|\\.)*")/.exec(reasonCheck.detail);
    if (!match) add('failure.failure.reason', '无法解析 detail：' + q(reasonCheck.detail));
    else {
      reason = JSON.parse(match[1]);
      if (ALLOWED_FAILURE_REASONS.indexOf(reason) < 0) add('failure.failure.reason', '归因不在允许集合：' + q(reason));
    }
  }
  const attribution = record.checks.get('failure.failure.attribution');
  if (attribution && attribution.ok) {
    const match = /observed=(null|-?\d+) atLeast=(\d+)(?: minValue=(\{.*\}))?$/.exec(attribution.detail);
    if (!match) add('failure.failure.attribution', '无法解析 detail：' + q(attribution.detail));
    else {
      const observed = match[1] === 'null' ? null : Number(match[1]);
      const atLeast = Number(match[2]);
      const objective = isObject(commission.objective) ? commission.objective : {};
      if (reason === 'objective-not-met' && !(observed !== null && observed < atLeast)) {
        add('failure.failure.attribution', 'objective-not-met 但 observed 不满足 < atLeast：' + q(attribution.detail));
      }
      if (reason === 'value-not-met') {
        const hasMinValue = isObject(objective.minValue);
        if (!hasMinValue) add('failure.failure.attribution', 'value-not-met 但内容无 minValue');
        if (!(observed === null || observed >= atLeast)) add('failure.failure.attribution', 'value-not-met 但 observed < atLeast：' + q(attribution.detail));
      }
    }
  }
  const zeroReward = record.checks.get('failure.failure.zero-reward');
  if (zeroReward && zeroReward.ok && !/creditsΔ=0 itemsΔ=\{\}/.test(zeroReward.detail)) {
    add('failure.failure.zero-reward', '失败必须零奖励：' + q(zeroReward.detail));
  }
  const runStatus = record.checks.get('failure.failure.run-status');
  if (runStatus && runStatus.ok && String(runStatus.detail).trim() !== 'status="failed"') {
    add('failure.failure.run-status', 'run 状态应为 failed：' + q(runStatus.detail));
  }
  const claimed = record.checks.get('success.success.run-claimed');
  if (claimed && claimed.ok && String(claimed.detail).trim() !== 'status="claimed"') {
    add('success.success.run-claimed', 'run 状态应为 claimed：' + q(claimed.detail));
  }

  return { failures, reason, evidence: summarizeTierEvidence(record) };
}

function summarizeTierEvidence(record) {
  const get = (id) => record.checks.get(id);
  const ok = (id) => !!(get(id) && get(id).ok);
  const reasonDetail = get('failure.failure.reason');
  const reasonMatch = reasonDetail ? /reason=("(?:[^"\\]|\\.)*")/.exec(reasonDetail.detail) : null;
  let reason = null;
  if (reasonMatch) {
    try {
      reason = JSON.parse(reasonMatch[1]);
    } catch (err) {
      reason = null;
    }
  }
  return {
    successReceipt: ok('success.success.receipt') && ok('success.success.txids'),
    claim: ok('success.success.claim-row') && ok('success.success.run-claimed'),
    ledgerWallet: ok('success.success.ledger') && ok('success.success.wallet-credits') && ok('success.success.wallet-items'),
    failureReason: reason,
    failureZeroReward: ok('failure.failure.zero-reward') && ok('failure.failure.no-receipt'),
    suspendReload: ok('suspend.suspend.restored') && ok('suspend.suspend.ticket-storage') && ok('suspend.suspend.run-active'),
    duplicateIdempotent: ok('success.idempotent.duplicate') && ok('success.idempotent.receipt') && ok('success.idempotent.wallet'),
    controlledFlag: tierFlagOf(record),
  };
}

function tierFlagOf(record) {
  const check = record.checks.get('suspend.suspend.seed-flag');
  return check && check.ok ? String(check.detail).trim() : null;
}

async function runE2EPhase(options, basePort, baseCdp) {
  const recorder = createRecorder('e2e');
  const games = options.games || GAMES.slice();
  const perGame = [];
  const failures = [];
  let totalChecks = 0;
  let passedChecks = 0;
  let envErrors = 0;
  for (let index = 0; index < games.length; index += 1) {
    const gameId = games[index];
    const port = basePort + index;
    const cdpPort = baseCdp + index;
    const logName = 'e2e-' + gameId + '.log';
    const startedAt = Date.now();
    /* 同机其他并行任务可能在 preflight 之后抢占端口：EADDRINUSE 时换 +100 端口重试（最多 3 次）。 */
    let run = null;
    let parsed = null;
    let combined = '';
    let portUsed = port;
    let cdpUsed = cdpPort;
    let attempts = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      attempts = attempt + 1;
      portUsed = port + attempt * 100;
      cdpUsed = cdpPort + attempt * 100;
      const runnerArgs = [RUNNER_PATH, '--run=' + gameId, '--timeout=' + options.tierTimeoutMs, '--verbose'];
      if (options.skipStatic) runnerArgs.push('--skip-static');
      run = await spawnCapture(
        process.execPath,
        runnerArgs,
        {
          env: Object.assign({}, process.env, {
            CAREER_MISSION_PORT: String(portUsed),
            CAREER_MISSION_CDP: String(cdpUsed),
            CAREER_MISSION_ARTIFACTS: path.join(ARTIFACTS_DIR, 'runner-artifacts'),
          }),
          timeoutMs: PER_GAME_OUTER_TIMEOUT_MS,
        }
      );
      combined = String(run.stdout || '') + (run.stderr ? '\n[stderr]\n' + run.stderr : '');
      writeTextArtifact('e2e-' + gameId + (attempt ? '-retry' + attempt : '') + '.log', combined);
      parsed = parseRunnerOutput(gameId, run.stdout || '');
      const portConflict = /EADDRINUSE|address already in use/i.test(combined);
      if (run.code === 2 && portConflict && attempt < 2) {
        console.log('RETRY   e2e.' + pad(gameId, 16) + ' 端口冲突 ' + portUsed + '/' + cdpUsed + ' → 换端口重试');
        await sleep(600);
        continue;
      }
      break;
    }
    const logFile = writeTextArtifact(logName, combined);
    const gameFailures = [];
    if (run.error) gameFailures.push({ gameId, tier: null, reason: 'runner spawn 失败：' + run.error });
    if (run.timedOut) gameFailures.push({ gameId, tier: null, reason: 'runner 超时（' + formatDuration(PER_GAME_OUTER_TIMEOUT_MS) + '）' });
    if (run.code === 2) {
      envErrors += 1;
      gameFailures.push({ gameId, tier: null, reason: 'runner 环境错误（exit 2）：' + combined.split(/\r?\n/).filter((line) => line.indexOf('ENV') === 0).join(' ') });
    } else if (!run.error && !run.timedOut && run.code !== 0) {
      gameFailures.push({ gameId, tier: null, reason: 'runner exit=' + q(run.code) });
    }
    if (!parsed.sawContentPASS) gameFailures.push({ gameId, tier: null, reason: 'runner 未打印 content-schema PASS' });
    if (parsed.skipped > 0) gameFailures.push({ gameId, tier: null, reason: '出现 SKIP（静默跳过）' + parsed.skipped + ' 次' });
    const summary = parsed.summary;
    if (!summary) gameFailures.push({ gameId, tier: null, reason: '缺少 SUMMARY run 行' });
    else if (summary.missing !== 0 || summary.invalid !== 0 || summary.harnessErrors !== 0 || summary.fail !== 0) {
      gameFailures.push({
        gameId,
        tier: null,
        reason: 'SUMMARY pass=' + summary.pass + ' fail=' + summary.fail + ' missing=' + summary.missing +
          ' invalid=' + summary.invalid + ' harnessErrors=' + summary.harnessErrors,
      });
    }
    if (summary && summary.pass !== TIERS.length) {
      gameFailures.push({ gameId, tier: null, reason: 'PASS tier 数 ' + summary.pass + '/' + TIERS.length });
    }

    const tierRecords = [];
    for (const tier of TIERS) {
      const record = parsed.tiers.get(tier);
      if (!record) {
        gameFailures.push({ gameId, tier, reason: '缺少 tier 结果（未执行）' });
        continue;
      }
      const commission = options.contentIndex.get(gameId + '.T' + tier);
      if (!commission) {
        gameFailures.push({ gameId, tier, reason: '内容缺少该 tier' });
        continue;
      }
      const validation = validateTier(gameId, tier, record, commission);
      validation.failures.forEach((item) => gameFailures.push(item));
      totalChecks += record.checks.size;
      let passed = 0;
      record.checks.forEach((check) => {
        if (check.ok) passed += 1;
      });
      passedChecks += passed;
      const tierRecord = {
        gameId,
        tier,
        ok: record.ok && validation.failures.length === 0,
        checks: record.checks.size,
        passed,
        durationMs: record.durationMs,
        evidence: validation.evidence,
        failures: validation.failures,
      };
      tierRecords.push(tierRecord);
      if (!record.ok) gameFailures.push({ gameId, tier, reason: 'runner tier FAIL：' + (record.tierLine || '') });
      if (validation.failures.length) {
        if (options.verbose) validation.failures.forEach((item) => console.log('  FAIL  ' + gameId + ' T' + tier + ' ' + item.id + ' — ' + item.reason));
      }
    }
    const ok = gameFailures.length === 0;
    gameFailures.forEach((item) => failures.push(item));
    perGame.push({
      gameId,
      ok,
      port: portUsed,
      cdpPort: cdpUsed,
      requestedPort: port,
      requestedCdp: cdpPort,
      attempts,
      durationMs: Date.now() - startedAt,
      logFile,
      summary,
      skipped: parsed.skipped,
      tiers: tierRecords,
      failures: gameFailures,
    });
    if (ok) {
      const checks = tierRecords.reduce((sum, record) => sum + record.checks, 0);
      console.log(
        'PASS  e2e.' + pad(gameId, 16) + ' 6/6 tiers  ' + checks + ' checks  ' +
        formatDuration(perGame[perGame.length - 1].durationMs) + '  port=' + portUsed + '/' + cdpUsed +
        (attempts > 1 ? ' (attempts=' + attempts + ')' : '')
      );
    } else {
      const reason = gameFailures.map((item) => (item.tier ? 'T' + item.tier + ': ' : '') + (item.id ? item.id + ': ' : '') + item.reason).join(' | ');
      console.log('FAIL  e2e.' + pad(gameId, 16) + ' — ' + reason);
    }
  }
  const summary = recorder.summary();
  return {
    perGame,
    failures,
    totalChecks,
    passedChecks,
    envErrors,
    gamesRun: games.length,
    portRange: games.length ? basePort + '..' + (basePort + games.length - 1) + ' / ' + baseCdp + '..' + (baseCdp + games.length - 1) : null,
  };
}

/* ------------------------------------------------------------------ *
 * 抽样阶段：独立 Chrome harness（真实 fixture 模块 + runner 等价表达式）
 *
 * 说明：D17-02 runner 顶层执行 main()，不能 import；这里复用其“表达式语义”：
 * - READY/STATE/TICKET/COMMISSION/wallet/claim/run/quests 与 runner 同名同义；
 * - helpers 与 runner 的 ctx.helpers 保持一致（startCommission/navigateGame/
 *   seedStoryFlags/settle/getCommission/evaluate），因此可以直接驱动 16 个真实 fixture。
 * 抽样阶段不读取 runner 产物，独立在真实 Chrome + IndexedDB 中重跑。
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
    try { await fn.call(api); } catch (e) { /* ignore */ }
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

function classicSnapshotExpr() {
  return `(() => {
    const keys = ${q(ISO_KEYS)};
    const out = {};
    keys.forEach((key) => { try { out[key] = localStorage.getItem(key); } catch (e) { out[key] = null; } });
    return out;
  })()`;
}

function classicSeedExpr() {
  return `(() => {
    const keys = ${q(ISO_KEYS)};
    const raw = ${q(ISO_SENTINEL)};
    keys.forEach((key) => { try { localStorage.setItem(key, raw); } catch (e) { /* ignore */ } });
    return true;
  })()`;
}

const CAREER_INFO_EXPR = `(function(){ try { return window.__arcadeTest && typeof window.__arcadeTest.careerInfo === 'function' ? window.__arcadeTest.careerInfo() : null; } catch (e) { return null; } })()`;

function entryProbeExpr() {
  return `(function(){
    const t = window.__arcadeTest;
    if (!t) return { ok: false, reason: 'no-test-api' };
    const info = typeof t.careerInfo === 'function' ? t.careerInfo() : null;
    const stages = typeof t.challengeStages === 'function' ? (t.challengeStages() || []) : [];
    const ref = stages.length && stages[0] ? stages[0].id : null;
    let challengeStarted = null;
    let challengeThrew = null;
    if (ref && typeof t.startChallenge === 'function') {
      try { challengeStarted = t.startChallenge(ref); } catch (e) { challengeThrew = String(e && e.message ? e.message : e); }
    }
    let zenStarted = null;
    let zenThrew = null;
    if (typeof t.startZen === 'function') {
      try { zenStarted = t.startZen(); } catch (e) { zenThrew = String(e && e.message ? e.message : e); }
    }
    let mowStarted = null;
    let mowThrew = null;
    if (typeof t.startMow === 'function') {
      try { mowStarted = t.startMow(); } catch (e) { mowThrew = String(e && e.message ? e.message : e); }
    }
    const after = typeof t.careerInfo === 'function' ? t.careerInfo() : null;
    const panel = document.querySelector('[data-ch-layer], [data-ch-panel]');
    return {
      ok: true,
      ref: ref,
      challengeStarted: challengeStarted,
      challengeThrew: challengeThrew,
      zenStarted: zenStarted,
      zenThrew: zenThrew,
      mowStarted: mowStarted,
      mowThrew: mowThrew,
      challengeLayerHidden: !panel || panel.hidden === true,
      hasStartChallenge: typeof t.startChallenge === 'function',
      hasStartZen: typeof t.startZen === 'function',
      hasStartMow: typeof t.startMow === 'function',
      before: info,
      after: after,
    };
  })()`;
}

class SampleHarness {
  constructor({ port, cdpPort }) {
    this.port = port;
    this.cdpPort = cdpPort;
    this.baseUrl = 'http://127.0.0.1:' + port;
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
        profilePrefix: 'studiokit-career-96-sample-',
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
      artifactsDir: ARTIFACTS_DIR,
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
    if (this.server) await new Promise((resolve) => this.server.close(() => resolve()));
    this.server = null;
    this.page = null;
    this.chrome = null;
  }

  async evaluate(expression) {
    return this.page.evaluate(expression);
  }

  async evalWithOk(expression, label) {
    try {
      return { ok: true, value: await this.page.evaluate(expression) };
    } catch (err) {
      this.harnessErrors += 1;
      return { ok: false, reason: 'evaluate-error', detail: (label || 'evaluate') + ': ' + errorText(err) };
    }
  }

  gameUrl(gameId, ticketId) {
    const params = [];
    if (typeof ticketId === 'string' && ticketId) params.push('career=' + encodeURIComponent(ticketId));
    params.push('careerTest=1');
    return this.baseUrl + '/apps/arcade/games/' + gameId + '.html?' + params.join('&') + '#test';
  }

  async waitReady(timeoutMs) {
    const budget = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : DEFAULT_READY_TIMEOUT_MS;
    const deadline = Date.now() + budget;
    let last = null;
    while (Date.now() < deadline) {
      const res = await this.evalWithOk(READY_EXPR, 'ready');
      if (res.ok && isObject(res.value) && res.value.ok === true && res.value.testMode === true) return res.value;
      last = res.ok ? res.value : res;
      await sleep(120);
    }
    return { ok: false, reason: 'bridge-not-ready', detail: last && last.reason ? String(last.reason) : 'ArcadeCareer.ready 未在 ' + budget + 'ms 内就绪' };
  }

  async location() {
    const res = await this.evalWithOk(LOCATION_EXPR, 'location');
    return res.ok ? res.value : { ok: false, reason: res.reason, detail: res.detail };
  }

  async openGame(gameId) {
    try {
      await this.page.navigate(this.gameUrl(gameId));
    } catch (err) {
      this.harnessErrors += 1;
      return { ok: false, reason: 'navigate-error', detail: errorText(err) };
    }
    const ready = await this.waitReady();
    if (!ready.ok) return { ok: false, reason: ready.reason, detail: ready.detail };
    if (ready.gameId !== gameId) return { ok: false, reason: 'game-mismatch', detail: 'expected ' + gameId + ', got ' + q(ready.gameId) };
    return { ok: true, ready };
  }

  async ensurePlainPage(gameId) {
    const loc = await this.location();
    if (loc.ok && isObject(loc)) {
      const target = '/apps/arcade/games/' + gameId + '.html';
      const atTarget = String(loc.path || '').endsWith(target) && !/(?:^|[?&])career=/.test(String(loc.search || ''));
      if (atTarget) return { ok: true, reused: true };
    }
    return this.openGame(gameId);
  }

  async ensureCareer(gameId) {
    const res = await this.evalWithOk(ensureCareerExpr(gameId), 'ensure-career');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'ensure-career-invalid' };
  }

  async clearTicket() {
    const res = await this.evalWithOk(CLEAR_TICKET_EXPR, 'clear-ticket');
    return res.ok ? res.value : { ok: false, reason: res.reason, detail: res.detail };
  }

  async readTicket() {
    const res = await this.evalWithOk(READ_TICKET_EXPR, 'read-ticket');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'ticket-invalid' };
  }

  async putQuests(careerId, rows) {
    const res = await this.evalWithOk(putQuestsExpr(careerId, rows), 'put-quests');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'put-quests-invalid' };
  }

  async seedTierUnlock(gameId, careerId, tier) {
    const rows = [];
    const now = new Date().toISOString();
    for (let lower = 1; lower < tier; lower += 1) {
      rows.push({ nodeId: gameId + '.T' + lower, kind: 'commission', status: 'cleared', clearedAt: now, evidence: [], flags: [] });
    }
    if (!rows.length) return { ok: true, count: 0 };
    return this.putQuests(careerId, rows);
  }

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
    const res = await this.evalWithOk(ENSURE_COMMISSION_EXPR, 'ensure-commission');
    if (!res.ok) return res;
    const value = isObject(res.value) ? res.value : { ok: false, reason: 'commission-module-invalid' };
    await this.evalWithOk(CLOSE_UI_EXPR, 'close-ui');
    return value;
  }

  async startCommissionRaw(commissionId, careerId) {
    const res = await this.evalWithOk(startCommissionExpr(commissionId, careerId), 'start-commission');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'start-invalid' };
  }

  async readState() {
    const res = await this.evalWithOk(STATE_EXPR, 'read-state');
    if (!res.ok) return res;
    return isObject(res.value) ? { ok: true, state: res.value } : { ok: false, reason: 'state-invalid' };
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

  async navigateCommission(gameId, ticketId, expectedCommissionId) {
    if (typeof ticketId !== 'string' || !ticketId) return { ok: false, reason: 'no-ticket' };
    try {
      await this.page.navigate(this.gameUrl(gameId, ticketId));
    } catch (err) {
      this.harnessErrors += 1;
      return { ok: false, reason: 'navigate-error', detail: errorText(err) };
    }
    const ready = await this.waitReady();
    if (!ready.ok) return { ok: false, reason: ready.reason, detail: ready.detail };
    return this.waitCommissionRun(ticketId, expectedCommissionId);
  }

  async settle(outcome, stats) {
    const res = await this.evalWithOk(settleExpr(outcome, stats), 'settle');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'settle-invalid' };
  }

  async abandon(ticketId) {
    const res = await this.evalWithOk(abandonExpr(ticketId), 'abandon');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'abandon-invalid' };
  }

  async wallet(careerId) {
    const res = await this.evalWithOk(walletExpr(careerId), 'wallet');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'wallet-invalid' };
  }

  async quests(careerId) {
    const res = await this.evalWithOk(questsExpr(careerId), 'quests');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'quests-invalid' };
  }

  async claim(runId) {
    const res = await this.evalWithOk(claimExpr(runId), 'claim');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'claim-invalid' };
  }

  async runRow(runId) {
    const res = await this.evalWithOk(runRowExpr(runId), 'run-row');
    if (!res.ok) return res;
    return isObject(res.value) ? res.value : { ok: false, reason: 'run-invalid' };
  }

  async classicSnapshot() {
    const res = await this.evalWithOk(classicSnapshotExpr(), 'classic-snapshot');
    return res.ok ? res.value : null;
  }

  async seedClassicSentinel() {
    const res = await this.evalWithOk(classicSeedExpr(), 'classic-seed');
    return res.ok && res.value === true;
  }

  async careerInfo() {
    return this.evalWithOk(CAREER_INFO_EXPR, 'career-info').then((res) => (res.ok ? res.value : null));
  }

  async pageErrors() {
    try {
      return this.page.errors.slice();
    } catch (err) {
      return [];
    }
  }
}

function createSampleSession(harness, gameId, tier, commission, careerId) {
  const session = {
    gameId,
    tier,
    commissionId: gameId + '.T' + tier,
    commission,
    careerId: careerId || null,
    ticketId: null,
    active: false,
    settled: false,
    commissionRun: null,
    result: null,
    settleCalls: [],
  };
  const helpers = {
    async startCommission(tierArg) {
      const target = Number.isInteger(tierArg) ? tierArg : tier;
      if (target !== tier) return { ok: false, reason: 'tier-mismatch', detail: 'helper tier=' + target + ' != ctx.tier=' + tier };
      if (session.ticketId) return { ok: false, reason: 'already-started', ticketId: session.ticketId };
      const plain = await harness.ensurePlainPage(gameId);
      if (!plain.ok) return plain;
      const career = session.careerId ? { ok: true, careerId: session.careerId } : await harness.ensureCareer(gameId);
      if (!career.ok) return { ok: false, reason: 'career-unavailable', detail: career.reason || null };
      await harness.clearTicket();
      const chain = await harness.seedTierUnlock(gameId, career.careerId, target);
      if (!chain.ok) return { ok: false, reason: 'seed-tier-unlock-failed', detail: chain.reason || null };
      const moduleReady = await harness.ensureCommissionModule();
      if (!moduleReady.ok) return moduleReady;
      const started = await harness.startCommissionRaw(gameId + '.T' + target, career.careerId);
      if (!started.ok) return started;
      if (started.ticketId) session.ticketId = started.ticketId;
      if (started.careerId) session.careerId = started.careerId;
      else session.careerId = career.careerId;
      const stored = await harness.readTicket();
      if (!stored.ok || !isObject(stored.ticket) || stored.ticket.ticketId !== started.ticketId) {
        return { ok: false, reason: 'ticket-not-stored', detail: stored.ok ? 'sessionStorage ticket 缺失/不匹配' : String(stored.reason), ticketId: started.ticketId };
      }
      const activated = await harness.navigateCommission(gameId, started.ticketId, gameId + '.T' + target);
      if (!activated.ok) {
        return { ok: false, reason: 'commission-not-activated', detail: String(activated.reason || 'unknown') + (activated.detail ? ' · ' + activated.detail : ''), ticketId: started.ticketId };
      }
      session.active = true;
      session.commissionRun = activated.commissionRun || null;
      return {
        ok: true,
        commissionId: gameId + '.T' + target,
        ticketId: started.ticketId,
        careerId: session.careerId,
        url: started.url || null,
        reused: started.reused === true,
        commissionRun: session.commissionRun,
      };
    },
    async navigateGame() {
      if (!session.ticketId) return { ok: false, reason: 'no-ticket' };
      const current = await harness.readState();
      if (current.ok && isObject(current.state) && isObject(current.state.commissionRun) && current.state.commissionRun.ticketId === session.ticketId) {
        session.active = true;
        session.commissionRun = current.state.commissionRun;
        return { ok: true, reused: true, commissionRun: current.state.commissionRun };
      }
      const res = await harness.navigateCommission(gameId, session.ticketId, gameId + '.T' + tier);
      if (res.ok) {
        session.active = true;
        session.commissionRun = res.commissionRun || null;
      }
      return { ok: res.ok, reason: res.reason, detail: res.detail, commissionRun: res.commissionRun || null };
    },
    async seedStoryFlags(flags) {
      let activeCareerId = session.careerId;
      if (!activeCareerId) {
        const career = await harness.ensureCareer(gameId);
        if (!career.ok) return { ok: false, reason: 'career-unavailable', detail: career.reason || null };
        activeCareerId = career.careerId;
        session.careerId = activeCareerId;
      }
      const res = await harness.seedStoryFlags(activeCareerId, flags);
      return { ok: res.ok, careerId: activeCareerId, seeded: res.count || 0, reason: res.reason };
    },
    async seedClearedCommissions(ids) {
      let activeCareerId = session.careerId;
      if (!activeCareerId) {
        const career = await harness.ensureCareer(gameId);
        if (!career.ok) return { ok: false, reason: 'career-unavailable' };
        activeCareerId = career.careerId;
        session.careerId = activeCareerId;
      }
      const now = new Date().toISOString();
      const rows = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string').map((id) => ({
        nodeId: id, kind: 'commission', status: 'cleared', clearedAt: now, evidence: [], flags: [],
      }));
      if (!rows.length) return { ok: true, careerId: activeCareerId, seeded: 0 };
      const res = await harness.putQuests(activeCareerId, rows);
      return { ok: res.ok, careerId: activeCareerId, seeded: res.count || 0, reason: res.reason };
    },
    async settle(outcome, stats) {
      if (session.settled) return { ok: true, duplicate: true, reusedLocal: true, result: session.result };
      const res = await harness.settle(outcome, stats);
      session.settled = true;
      session.result = res;
      session.settleCalls.push({ outcome: outcome, stats: stats || {} });
      return res;
    },
    async readState() {
      const res = await harness.readState();
      if (!res.ok) return { ok: false, reason: res.reason, detail: res.detail };
      const state = res.state;
      const commissionState = isObject(state.commissionState) ? state.commissionState : null;
      const events = commissionState && Array.isArray(commissionState.events) ? commissionState.events : [];
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
        const career = await harness.ensureCareer(gameId);
        if (!career.ok) return { ok: false, reason: 'career-unavailable' };
        session.careerId = career.careerId;
      }
      return harness.wallet(session.careerId);
    },
    async claims() {
      if (!session.careerId) {
        const career = await harness.ensureCareer(gameId);
        if (!career.ok) return { ok: false, reason: 'career-unavailable' };
        session.careerId = career.careerId;
      }
      const wallet = await harness.wallet(session.careerId);
      const quests = await harness.quests(session.careerId);
      const claim = session.ticketId ? await harness.claim(session.ticketId) : { ok: false, reason: 'no-ticket' };
      return { ok: wallet.ok && quests.ok, wallet, quests, claim };
    },
    async snapshot() {
      const state = await harness.readState();
      return {
        ok: state.ok,
        at: new Date().toISOString(),
        gameId,
        tier,
        careerId: session.careerId,
        ticketId: session.ticketId,
        state: state.ok ? state.state : { ok: false, reason: state.reason },
      };
    },
    getCommission(tierArg) {
      const target = Number.isInteger(tierArg) ? tierArg : tier;
      return target === tier ? commission : null;
    },
    commission,
    evaluate(expression) {
      return harness.page.evaluate(expression);
    },
    waitFor(expression, opts) {
      return harness.page.waitFor(expression, opts);
    },
  };
  session.helpers = helpers;
  session.ctx = {
    gameId,
    tier,
    port: harness.port,
    cdp: harness.page,
    page: harness.page,
    helpers,
    content: commission,
    careerId: session.careerId,
    artifactsDir: ARTIFACTS_DIR,
  };
  return session;
}

/* ------------------------------------------------------------------ *
 * 抽样阶段：success / failure / 入口探测
 * ------------------------------------------------------------------ */

function expectedReward(commission) {
  const reward = isObject(commission.reward) ? commission.reward : {};
  return {
    credits: Number(reward.credits) || 0,
    items: isObject(reward.items) ? reward.items : {},
    evidence: Array.isArray(reward.evidence) ? reward.evidence.slice() : [],
    flags: Array.isArray(reward.flags) ? reward.flags.slice() : [],
  };
}

async function readLastResult(harness) {
  const state = await harness.readState();
  if (!state.ok || !isObject(state.state) || !isObject(state.state.info)) return null;
  const last = state.state.info.commissionLastResult;
  return isObject(last) ? last : null;
}

function receiptOf(result) {
  return isObject(result) && isObject(result.receipt) ? result.receipt : null;
}

function classicEqual(before, after) {
  if (!before || !after) return { ok: false, detail: '快照缺失' };
  const changed = ISO_KEYS.filter((key) => before[key] !== after[key]);
  return {
    ok: changed.length === 0,
    detail: changed.length ? changed.map((key) => key + ': ' + q(before[key]) + ' -> ' + q(after[key])).join('; ') : '5/5 键逐字节一致',
    changed,
  };
}

/**
 * fixture 只负责把真实状态驱动到目标附近；若它没有自行结算（runner 语义同样如此），
 * 由测试通过真实 bridge `api.finish({mode:'classic'})` 补一次结算，再读取 commissionLastResult。
 */
async function settleIfNeeded(harness, add, handlerReturn, outcome) {
  const existing = await readLastResult(harness);
  if (existing) return { lastResult: existing, supplemented: false };
  const live = await harness.readState();
  if (!live.ok || !isObject(live.state) || !isObject(live.state.commissionRun)) {
    add('post-settle', false, 'fixture 返回后既无 commissionLastResult 也无 live run');
    return { lastResult: null, supplemented: false };
  }
  const stats = isObject(handlerReturn) && isObject(handlerReturn.stats) ? handlerReturn.stats : {};
  const settled = await harness.settle(outcome, stats);
  await sleep(80);
  const after = await readLastResult(harness);
  const result = after || settled;
  const ok = outcome === 'won' ? !!(settled && settled.ok === true) : !!(settled && settled.ok === false);
  add(
    'post-settle',
    ok,
    '补 ' + outcome + ' 结算：' + (settled ? (settled.ok ? 'ok' : 'reason=' + q(settled.reason)) : 'no-result')
  );
  return { lastResult: result, supplemented: true };
}

async function runSampleSuccess(harness, recorder, fixture, sample, commission) {
  const parsed = splitId(sample.id);
  if (!parsed) return { ok: false, id: sample.id, reason: '非法委托 id' };
  const { gameId, tier } = parsed;
  const checks = [];
  const add = (name, ok, detail) => {
    const item = { name: sample.id + '.' + name, ok: !!ok, detail: detail ? String(detail) : '' };
    checks.push(item);
    recorder.record(item.name, item.ok, item.detail);
  };
  const startedAt = Date.now();
  const opened = await harness.openGame(gameId);
  if (!opened.ok) {
    add('open', false, opened.reason + (opened.detail ? ' · ' + opened.detail : ''));
    return { ok: false, id: sample.id, reason: 'open:' + opened.reason, checks, durationMs: Date.now() - startedAt };
  }
  const career = await harness.ensureCareer(gameId);
  if (!career.ok) {
    add('career', false, career.reason);
    return { ok: false, id: sample.id, reason: 'career:' + career.reason, checks, durationMs: Date.now() - startedAt };
  }
  const seeded = await harness.seedClassicSentinel();
  add('classic-sentinel-seed', seeded, seeded ? '5 键哨兵已写入' : '哨兵写入失败');
  const before = await harness.classicSnapshot();
  const walletBefore = await harness.wallet(career.careerId);
  add('wallet-before', walletBefore.ok, walletBefore.ok ? 'credits=' + walletBefore.credits : walletBefore.reason);

  const session = createSampleSession(harness, gameId, tier, commission, career.careerId);
  let handlerReturn = null;
  let handlerError = null;
  try {
    handlerReturn = await fixture.tiers[String(tier)].success(session.ctx);
  } catch (err) {
    handlerError = errorText(err);
  }
  add('fixture-success-run', !handlerError, handlerError || '真实 fixture success 驱动完成');
  const after = await harness.classicSnapshot();
  const classic = classicEqual(before, after);
  add('classic-5-bytes', classic.ok, classic.detail);
  const settledInfo = await settleIfNeeded(harness, add, handlerReturn, 'won');
  const lastResult = settledInfo.lastResult;
  const receipt = receiptOf(lastResult);
  const expected = expectedReward(commission);
  add('last-result', !!lastResult, lastResult ? 'ok=' + q(lastResult.ok) + ' duplicate=' + q(lastResult.duplicate) : '缺少 commissionLastResult');
  add('result-ok', !!lastResult && lastResult.ok === true, lastResult ? 'ok=' + q(lastResult.ok) : '无结算结果');
  add('receipt', !!receipt, receipt ? 'commissionId=' + q(receipt.commissionId) : '无收据');
  if (receipt) {
    add('receipt-commission', receipt.commissionId === sample.id, q(receipt.commissionId));
    add('receipt-credits', Number(receipt.credits) === expected.credits, 'got=' + q(receipt.credits) + ' expected=' + expected.credits);
    add('receipt-items', sameJson(receipt.items || {}, expected.items), 'got=' + sortedJson(receipt.items || {}));
    add('receipt-evidence', arrayEqual(receipt.evidence || [], expected.evidence), 'got=' + sortedJson(receipt.evidence || []));
    add('receipt-flags', arrayEqual(receipt.flags || [], expected.flags), 'got=' + sortedJson(receipt.flags || []));
  }
  const walletAfter = await harness.wallet(career.careerId);
  const creditsDelta = walletAfter.ok && walletBefore.ok ? Number(walletAfter.credits) - Number(walletBefore.credits) : NaN;
  const itemsDelta = walletAfter.ok && walletBefore.ok ? diffItems(walletBefore.items, walletAfter.items) : {};
  add('wallet-credits-delta', walletAfter.ok && creditsDelta === expected.credits, 'delta=' + q(creditsDelta) + ' expected=' + expected.credits);
  add('wallet-items-delta', walletAfter.ok && sameJson(itemsDelta, expected.items), 'delta=' + sortedJson(itemsDelta));
  const ticketId = session.ticketId;
  if (ticketId) {
    const claim = await harness.claim(ticketId);
    add('claim-row', claim.ok === true, claim.ok ? 'claim 行存在' : claim.reason);
    const row = await harness.runRow(ticketId);
    add('run-claimed', row.ok === true && row.run && row.run.status === 'claimed', row.ok ? 'status=' + q(row.run && row.run.status) : row.reason);
    const quests = await harness.quests(career.careerId);
    const quest = quests.ok ? (quests.quests || []).filter((item) => item && item.nodeId === sample.id)[0] : null;
    add('quest-row', !!quest && quest.status === 'cleared', quest ? 'status=' + q(quest.status) + ' evidence=' + sortedJson(quest.evidence || []) : '缺少委托完成行');
    if (quest) {
      const questEvidence = Array.isArray(quest.evidence) ? quest.evidence : [];
      add('quest-evidence', questEvidence.length === 0 || sameJson(questEvidence, expected.evidence), 'got=' + sortedJson(questEvidence));
    }
  } else {
    add('claim-row', false, 'fixture 未产生 ticket');
  }
  const pageErrors = await harness.pageErrors();
  add('page-errors', pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : '0');
  const failures = checks.filter((item) => !item.ok);
  return {
    id: sample.id,
    gameId,
    tier,
    ok: failures.length === 0,
    reasons: failures.map((item) => item.name + ': ' + item.detail),
    checks,
    classic: { before, after, ok: classic.ok, detail: classic.detail },
    receipt: receipt ? { credits: Number(receipt.credits) || 0, items: receipt.items || {}, evidence: receipt.evidence || [], flags: receipt.flags || [] } : null,
    expected,
    walletDelta: { credits: Number.isFinite(creditsDelta) ? creditsDelta : null, items: itemsDelta },
    durationMs: Date.now() - startedAt,
  };
}

async function runSampleFailure(harness, recorder, fixture, sample, commission) {
  const parsed = splitId(sample.id);
  if (!parsed) return { ok: false, id: sample.id, reason: '非法委托 id' };
  const { gameId, tier } = parsed;
  const checks = [];
  const add = (name, ok, detail) => {
    const item = { name: 'failure.' + sample.id + '.' + name, ok: !!ok, detail: detail ? String(detail) : '' };
    checks.push(item);
    recorder.record(item.name, item.ok, item.detail);
  };
  const startedAt = Date.now();
  const opened = await harness.openGame(gameId);
  if (!opened.ok) {
    add('open', false, opened.reason);
    return { ok: false, id: sample.id, reason: 'open:' + opened.reason, checks, durationMs: Date.now() - startedAt };
  }
  const career = await harness.ensureCareer(gameId);
  if (!career.ok) {
    add('career', false, career.reason);
    return { ok: false, id: sample.id, reason: 'career:' + career.reason, checks, durationMs: Date.now() - startedAt };
  }
  const seeded = await harness.seedClassicSentinel();
  add('classic-sentinel-seed', seeded, seeded ? '5 键哨兵已写入' : '哨兵写入失败');
  const before = await harness.classicSnapshot();
  const walletBefore = await harness.wallet(career.careerId);
  add('wallet-before', walletBefore.ok, walletBefore.ok ? 'credits=' + walletBefore.credits : walletBefore.reason);

  const session = createSampleSession(harness, gameId, tier, commission, career.careerId);
  let handlerReturn = null;
  let handlerError = null;
  try {
    handlerReturn = await fixture.tiers[String(tier)].failure(session.ctx);
  } catch (err) {
    handlerError = errorText(err);
  }
  add('fixture-failure-run', !handlerError, handlerError || '真实 fixture failure 驱动完成');
  const after = await harness.classicSnapshot();
  const classic = classicEqual(before, after);
  add('classic-5-bytes', classic.ok, classic.detail);
  const settledInfo = await settleIfNeeded(harness, add, handlerReturn, 'lost');
  const lastResult = settledInfo.lastResult;
  const reason = lastResult && typeof lastResult.reason === 'string' ? lastResult.reason : null;
  add('result-not-ok', !!lastResult && lastResult.ok === false, lastResult ? 'ok=' + q(lastResult.ok) : '缺少 commissionLastResult');
  add('reason', reason === sample.expectedReason, 'reason=' + q(reason) + ' expected=' + q(sample.expectedReason));
  add('no-receipt', !receiptOf(lastResult), receiptOf(lastResult) ? '失败却返回收据' : '无收据');
  const walletAfter = await harness.wallet(career.careerId);
  const creditsDelta = walletAfter.ok && walletBefore.ok ? Number(walletAfter.credits) - Number(walletBefore.credits) : NaN;
  const itemsDelta = walletAfter.ok && walletBefore.ok ? diffItems(walletBefore.items, walletAfter.items) : {};
  add('zero-reward', walletAfter.ok && creditsDelta === 0 && sameJson(itemsDelta, {}), 'creditsΔ=' + q(creditsDelta) + ' itemsΔ=' + sortedJson(itemsDelta));
  if (session.ticketId) {
    const row = await harness.runRow(session.ticketId);
    add('run-failed', row.ok === true && row.run && row.run.status === 'failed', row.ok ? 'status=' + q(row.run && row.run.status) : row.reason);
    const claim = await harness.claim(session.ticketId);
    add('no-claim', claim.ok !== true, claim.ok ? '失败 run 不应有 claim 行' : '无 claim 行');
  } else {
    add('run-failed', false, 'fixture 未产生 ticket');
  }
  const pageErrors = await harness.pageErrors();
  add('page-errors', pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : '0');
  const failures = checks.filter((item) => !item.ok);
  return {
    id: sample.id,
    gameId,
    tier,
    expectedReason: sample.expectedReason,
    reason,
    ok: failures.length === 0,
    reasons: failures.map((item) => item.name + ': ' + item.detail),
    checks,
    classic: { before, after, ok: classic.ok, detail: classic.detail },
    durationMs: Date.now() - startedAt,
  };
}

function entryVisibility(info) {
  const has = (key) => isObject(info) && Object.prototype.hasOwnProperty.call(info, key);
  const evaluate = (defs) => {
    let present = false;
    let hidden = true;
    defs.forEach((def) => {
      if (!has(def.key)) return;
      present = true;
      hidden = hidden && def.hidden(info[def.key]);
    });
    return { present, hidden };
  };
  return {
    challenge: evaluate([
      { key: 'challengeEntryHidden', hidden: (value) => value === true },
      { key: 'challengeEntry', hidden: (value) => value === false },
      { key: 'challengeEntryVisible', hidden: (value) => value === false },
      { key: 'challengeVisible', hidden: (value) => value === false },
    ]),
    zen: evaluate([
      { key: 'zenEntryHidden', hidden: (value) => value === true },
      { key: 'zenEntryVisible', hidden: (value) => value === false },
      { key: 'zenVisible', hidden: (value) => value === false },
    ]),
    mow: evaluate([
      { key: 'mowEntryVisible', hidden: (value) => value === false },
      { key: 'mowEntryHidden', hidden: (value) => value === true },
      { key: 'mowVisible', hidden: (value) => value === false },
    ]),
  };
}

async function runEntryProbe(harness, recorder, fixture, sample, commission) {
  const parsed = splitId(sample.id);
  if (!parsed) return null;
  const { gameId, tier } = parsed;
  const startedAt = Date.now();
  const checks = [];
  const add = (name, ok, detail) => {
    const item = { name: 'entry.' + sample.id + '.' + name, ok: !!ok, detail: detail ? String(detail) : '' };
    checks.push(item);
    recorder.record(item.name, item.ok, item.detail);
  };
  const opened = await harness.openGame(gameId);
  if (!opened.ok) {
    add('open', false, opened.reason);
    return { id: sample.id, gameId, ok: false, checks, reasons: ['open: ' + opened.reason], durationMs: Date.now() - startedAt };
  }
  const career = await harness.ensureCareer(gameId);
  if (!career.ok) {
    add('career', false, career.reason);
    return { id: sample.id, gameId, ok: false, checks, reasons: ['career: ' + career.reason], durationMs: Date.now() - startedAt };
  }
  const session = createSampleSession(harness, gameId, tier, commission, career.careerId);
  const started = await session.helpers.startCommission(tier);
  add('commission-start', started.ok === true, started.ok ? started.ticketId : started.reason + (started.detail ? ' · ' + started.detail : ''));
  if (!started.ok) {
    return { id: sample.id, gameId, ok: false, checks, reasons: ['commission-start: ' + started.reason], durationMs: Date.now() - startedAt };
  }
  try {
    await harness.page.waitFor(
      '(function(){ try { var i = window.__arcadeTest && window.__arcadeTest.careerInfo ? window.__arcadeTest.careerInfo() : null; return !!(i && i.isCommission === true && (typeof i.locked === "undefined" || i.locked === true)); } catch (e) { return false; } })()',
      { timeout: 12000, interval: 100 }
    );
  } catch (err) {
    add('career-locked', false, errorText(err));
  }
  const probeRes = await harness.evalWithOk(entryProbeExpr(), 'entry-probe');
  const probe = probeRes.ok ? probeRes.value : null;
  add('probe-ok', !!probe && probe.ok === true, probeRes.ok ? (probe && probe.reason) || '' : probeRes.detail);
  const walletBefore = await harness.wallet(career.careerId);
  if (probe) {
    const before = probe.before || {};
    const after = probe.after || {};
    const flags = entryVisibility(before);
    const lockedOk = before.isCommission === true && (typeof before.locked === 'undefined' || before.locked === true);
    add('career-run-locked', lockedOk, 'isCommission=' + q(before.isCommission) + ' locked=' + q(before.locked));
    add('serialize-null', before.serializeNull === true, 'serializeNull=' + q(before.serializeNull));
    add('challenge-hidden', flags.challenge.present && flags.challenge.hidden, 'present=' + flags.challenge.present + ' hidden=' + flags.challenge.hidden);
    if (sample.entryProbe && sample.entryProbe.indexOf('challenge') !== -1) {
      add('challenge-rejected', probe.hasStartChallenge === true && probe.challengeStarted === false, 'started=' + q(probe.challengeStarted) + (probe.challengeThrew ? ' threw=' + q(probe.challengeThrew) : ''));
      add('challenge-mode', before.mode !== 'challenge' && after.mode !== 'challenge', 'mode=' + q(before.mode) + ' -> ' + q(after.mode));
    }
    if (sample.entryProbe && sample.entryProbe.indexOf('zen') !== -1) {
      add('zen-hidden', flags.zen.present && flags.zen.hidden, 'present=' + flags.zen.present + ' hidden=' + flags.zen.hidden);
      add('zen-rejected', probe.hasStartZen === true && probe.zenStarted === false, 'started=' + q(probe.zenStarted) + (probe.zenThrew ? ' threw=' + q(probe.zenThrew) : ''));
      add('zen-mode', before.mode !== 'zen' && after.mode !== 'zen', 'mode=' + q(before.mode) + ' -> ' + q(after.mode));
    }
    if (sample.entryProbe && sample.entryProbe.indexOf('mow') !== -1) {
      add('mow-hidden', flags.mow.present && flags.mow.hidden, 'present=' + flags.mow.present + ' hidden=' + flags.mow.hidden);
      add('mow-rejected', probe.hasStartMow === true && probe.mowStarted === false, 'started=' + q(probe.mowStarted) + (probe.mowThrew ? ' threw=' + q(probe.mowThrew) : ''));
      add('mow-mode', before.mode !== 'mow' && after.mode !== 'mow', 'mode=' + q(before.mode) + ' -> ' + q(after.mode));
    }
    add('challenge-layer-hidden', probe.challengeLayerHidden === true || (sample.entryProbe && sample.entryProbe.indexOf('challenge') === -1), 'layerHidden=' + q(probe.challengeLayerHidden));
    add('still-commission', after.isCommission === true, 'isCommission=' + q(after.isCommission));
  }
  const abandoned = await harness.abandon(session.ticketId);
  add('abandon', abandoned.ok === true, abandoned.ok ? 'abandoned' : abandoned.reason);
  const walletAfter = await harness.wallet(career.careerId);
  const creditsDelta = walletAfter.ok && walletBefore.ok ? Number(walletAfter.credits) - Number(walletBefore.credits) : NaN;
  const itemsDelta = walletAfter.ok && walletBefore.ok ? diffItems(walletBefore.items, walletAfter.items) : {};
  add('abandon-no-reward', walletAfter.ok && creditsDelta === 0 && sameJson(itemsDelta, {}), 'creditsΔ=' + q(creditsDelta));
  const row = await harness.runRow(session.ticketId);
  add('run-abandoned', row.ok === true && row.run && row.run.status === 'abandoned', row.ok ? 'status=' + q(row.run && row.run.status) : row.reason);
  const pageErrors = await harness.pageErrors();
  add('page-errors', pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : '0');
  const failures = checks.filter((item) => !item.ok);
  return {
    id: sample.id,
    gameId,
    tier,
    mode: probe && probe.before ? probe.before.mode : null,
    ok: failures.length === 0,
    checks,
    reasons: failures.map((item) => item.name + ': ' + item.detail),
    durationMs: Date.now() - startedAt,
  };
}

async function runSamplePhase(options, contentIndex, fixtures) {
  const recorder = createRecorder('sample');
  const failures = [];
  const successResults = [];
  const failureResults = [];
  const entryResults = [];
  const envErrors = 0;
  const basePort = options.samplePort;
  const baseCdp = options.sampleCdp;
  let harness = new SampleHarness({ port: basePort, cdpPort: baseCdp });
  let started = false;
  let lastStartError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = new SampleHarness({ port: basePort + attempt * 50, cdpPort: baseCdp + attempt * 50 });
    try {
      await candidate.start();
      harness = candidate;
      started = true;
      if (attempt > 0) {
        console.log('RETRY   sample 端口冲突后改用 ' + candidate.port + '/' + candidate.cdpPort);
        options.samplePort = candidate.port;
        options.sampleCdp = candidate.cdpPort;
      }
      break;
    } catch (err) {
      lastStartError = errorText(err);
      await candidate.stop().catch(() => {});
      if (!/EADDRINUSE|address already in use|静态服务器无法监听/i.test(lastStartError)) break;
    }
  }
  if (!started) {
    recorder.record('harness.start', false, lastStartError || 'unknown');
    return { recorder, failures: [{ gameId: null, tier: null, reason: 'sample harness start: ' + (lastStartError || 'unknown') }], successResults, failureResults, entryResults, envErrors: 1 };
  }
  try {
    const sampleIds = options.samples || SAMPLE_PLAN.map((item) => item.id);
    const plan = SAMPLE_PLAN.filter((item) => sampleIds.indexOf(item.id) >= 0);
    for (const sample of plan) {
      const parsed = splitId(sample.id);
      const commission = contentIndex.get(sample.id);
      const entry = fixtures.entries.filter((item) => item.gameId === parsed.gameId)[0];
      if (!commission || !entry || !entry.fixture) {
        recorder.record('sample.' + sample.id + '.available', false, !commission ? '内容缺失' : 'fixture 缺失');
        failures.push({ gameId: parsed.gameId, tier: parsed.tier, reason: '抽样前置缺失（内容或 fixture）' });
        continue;
      }
      const result = await runSampleSuccess(harness, recorder, entry.fixture, sample, commission);
      successResults.push(result);
      if (!result.ok) failures.push({ gameId: parsed.gameId, tier: parsed.tier, reason: 'sample ' + sample.id + ': ' + (result.reasons || [result.reason]).join('; ') });
      if (sample.entryProbe) {
        const probe = await runEntryProbe(harness, recorder, entry.fixture, sample, commission);
        if (probe) {
          entryResults.push(probe);
          if (!probe.ok) failures.push({ gameId: parsed.gameId, tier: parsed.tier, reason: 'entry ' + sample.id + ': ' + probe.reasons.join('; ') });
        }
        /* 清理：恢复普通页，避免上一轮 ticket 状态影响后续失败抽样。 */
        await harness.clearTicket().catch(() => {});
      }
    }
    const failurePlan = options.samples
      ? FAILURE_SAMPLES.filter((item) => options.samples.indexOf(item.id) >= 0)
      : FAILURE_SAMPLES.slice();
    for (const sample of failurePlan) {
      const parsed = splitId(sample.id);
      const commission = contentIndex.get(sample.id);
      const entry = fixtures.entries.filter((item) => item.gameId === parsed.gameId)[0];
      if (!commission || !entry || !entry.fixture) {
        failures.push({ gameId: parsed.gameId, tier: parsed.tier, reason: '失败抽样前置缺失' });
        continue;
      }
      const result = await runSampleFailure(harness, recorder, entry.fixture, sample, commission);
      failureResults.push(result);
      if (!result.ok) failures.push({ gameId: parsed.gameId, tier: parsed.tier, reason: 'failure-sample ' + sample.id + ': ' + (result.reasons || [result.reason]).join('; ') });
    }
  } finally {
    if (started) await harness.stop();
  }
  return { recorder, failures, successResults, failureResults, entryResults, envErrors, harnessErrors: harness.harnessErrors };
}

/* ------------------------------------------------------------------ *
 * 报告（证据表 / summary.json）
 * ------------------------------------------------------------------ */

function buildTierTable(e2e) {
  const lines = [];
  lines.push('| game | tier | checks | success(receipt+claim) | failure(reason / 零奖励) | suspend/reload | duplicate 幂等 | 受控旗标 | 耗时 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  e2e.perGame.forEach((game) => {
    game.tiers.forEach((tier) => {
      const ev = tier.evidence || {};
      lines.push(
        '| ' + tier.gameId + ' | T' + tier.tier + ' | ' + tier.passed + '/' + tier.checks + ' | ' +
        (ev.successReceipt && ev.claim ? '✅ 收据+claim' : '❌') + ' | ' +
        (ev.failureZeroReward ? (ev.failureReason || '?') + ' / 零奖励' : '❌') + ' | ' +
        (ev.suspendReload ? '✅ ticket 恢复' : '❌') + ' | ' +
        (ev.duplicateIdempotent ? '✅' : '❌') + ' | ' +
        (tier.tier >= 4 ? (ev.controlledFlag || '❌') : '—') + ' | ' +
        formatDuration(tier.durationMs) + ' |'
      );
    });
  });
  return lines.join('\n');
}

function buildSampleTable(samples) {
  const lines = [];
  lines.push('| 委托 | 内容奖励 credits/items/evidence/flags | 收据 | 钱包增量 | claim/run | 经典 5 键 |');
  lines.push('|---|---|---|---|---|---|');
  samples.forEach((sample) => {
    if (!sample.id) return;
    const expected = sample.expected
      ? sample.expected.credits + ' / ' + sortedJson(sample.expected.items) + ' / ' + sortedJson(sample.expected.evidence) + ' / ' + sortedJson(sample.expected.flags)
      : '—';
    const receipt = sample.receipt
      ? sample.receipt.credits + ' / ' + sortedJson(sample.receipt.items) + ' / ' + sortedJson(sample.receipt.evidence) + ' / ' + sortedJson(sample.receipt.flags)
      : '❌';
    const wallet = sample.walletDelta ? sample.walletDelta.credits + ' / ' + sortedJson(sample.walletDelta.items) : '—';
    const claimRun = sample.ok === undefined ? '—' : (sample.ok ? '✅' : '❌');
    lines.push('| ' + sample.id + ' | ' + expected + ' | ' + receipt + ' | ' + wallet + ' | ' + claimRun + ' | ' + (sample.classic ? (sample.classic.ok ? '✅ 逐字节一致' : '❌') : '—') + ' |');
  });
  return lines.join('\n');
}

function buildEntryTable(entries) {
  const lines = [];
  lines.push('| 委托 | game | 挑战入口隐藏 | 挑战 start 拒绝 | 禅入口隐藏/拒绝 | 割草入口隐藏/拒绝 | mode 未切换 | 结果 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  entries.forEach((entry) => {
    const check = (name) => {
      const item = (entry.checks || []).filter((candidate) => candidate.name === name)[0];
      return item ? (item.ok ? '✅' : '❌') : '—';
    };
    const base = 'entry.' + entry.id + '.';
    lines.push('| ' + entry.id + ' | ' + entry.gameId + ' | ' + check(base + 'challenge-hidden') + ' | ' + check(base + 'challenge-rejected') + ' | ' +
      check(base + 'zen-hidden') + ' / ' + check(base + 'zen-rejected') + ' | ' + check(base + 'mow-hidden') + ' / ' + check(base + 'mow-rejected') + ' | ' +
      check(base + 'challenge-mode') + ' | ' + (entry.ok ? '✅' : '❌') + ' |');
  });
  return lines.join('\n');
}

function buildStaticTable(staticResult) {
  const lines = [];
  lines.push('| 检查 | 结果 | 明细 |');
  lines.push('|---|---|---|');
  (staticResult.recorder ? staticResult.recorder.results : []).forEach((item) => {
    lines.push('| ' + item.name + ' | ' + (item.ok ? 'PASS' : 'FAIL') + ' | ' + (item.detail || '').replace(/\|/g, '\\|') + ' |');
  });
  return lines.join('\n');
}

function buildEvidenceMarkdown(data) {
  const lines = [];
  lines.push('# D17-26 运行产物（自动生成）');
  lines.push('');
  lines.push('- 生成时间：' + new Date().toISOString());
  lines.push('- 仓库：`' + REPO_ROOT + '`');
  lines.push('- 端口：runner `' + data.options.portBase + '/' + data.options.cdpBase + '`（逐游戏递增），抽样 `' + data.options.samplePort + '/' + data.options.sampleCdp + '`');
  lines.push('- 单轮胎超时：' + data.options.tierTimeoutMs + 'ms');
  lines.push('');
  lines.push('## 1. static 门禁');
  lines.push('');
  lines.push(buildStaticTable(data.static));
  lines.push('');
  lines.push('## 2. runner E2E（96 tier）');
  lines.push('');
  lines.push(buildTierTable(data.e2e));
  lines.push('');
  lines.push('## 3. 独立抽样（8 委托）');
  lines.push('');
  lines.push(buildSampleTable(data.successResults));
  lines.push('');
  lines.push('## 4. 入口探测（挑战/禅/割草）');
  lines.push('');
  lines.push(buildEntryTable(data.entryResults));
  return lines.join('\n') + '\n';
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (options.errors.length) {
    options.errors.forEach((message) => console.error('USAGE  ' + message));
    console.error('');
    console.error(USAGE);
    return 2;
  }
  let portBase;
  let cdpBase;
  try {
    portBase = envPort('M96_PORT', DEFAULT_M96_PORT);
    cdpBase = envPort('M96_CDP', DEFAULT_M96_CDP);
    if (portBase < 1024 || cdpBase < 1024) throw new Error('M96_PORT/M96_CDP 必须 >=1024（Chrome 拦截低端口）');
    if (portBase + GAMES.length + SAMPLE_PORT_OFFSET + 1 + 400 > 65535 || cdpBase + GAMES.length + SAMPLE_PORT_OFFSET + 1 + 400 > 65535) {
      throw new Error('端口上界超出 65535');
    }
  } catch (err) {
    console.error('ENV  ' + errorText(err));
    return 2;
  }
  let portRange = { shift: 0, portBase, cdpBase, samplePort: portBase + SAMPLE_PORT_OFFSET, sampleCdp: cdpBase + SAMPLE_PORT_OFFSET, requested: { portBase, cdpBase } };
  if (options.e2e || options.sample) {
    const selected = await selectPortRange(portBase, cdpBase);
    if (!selected.ok) {
      console.error(
        'ENV  M96_PORT/M96_CDP 范围无空闲端口：请求 ' + portBase + '/' + cdpBase +
        '（连续 ' + GAMES.length + ' 个端口，已尝试 +0/+50/../+400 平移）'
      );
      return 2;
    }
    portRange = selected;
    if (selected.shift !== 0) {
      console.log(
        'PORT    preflight 平移 +' + selected.shift + '：请求 ' + portBase + '/' + cdpBase +
        ' 被同机并行任务占用，改用 ' + selected.portBase + '/' + selected.cdpBase
      );
    }
  }
  options.portBase = portRange.portBase;
  options.cdpBase = portRange.cdpBase;
  options.samplePort = portRange.samplePort;
  options.sampleCdp = portRange.sampleCdp;
  options.portShift = portRange.shift;
  options.requestedPortBase = portRange.requested.portBase;
  options.requestedCdpBase = portRange.requested.cdpBase;
  ensureArtifactsDir();

  console.log('D17-26  96 委托自动化回归');
  const staticEnabled = !options.e2e && !options.sample;
  console.log(
    'RUN     static=' + staticEnabled + ' e2e=' + options.e2e + ' sample=' + options.sample +
    ' skipStatic=' + options.skipStatic +
    ' port=' + options.portBase + '/' + options.cdpBase + ' (requested ' + portBase + '/' + cdpBase + ', shift=' + options.portShift + ')' +
    ' samplePort=' + options.samplePort + '/' + options.sampleCdp +
    ' timeout=' + options.tierTimeoutMs + 'ms artifacts=' + ARTIFACTS_DIR
  );

  const staticResult = await runStaticPhase(options);
  const allFailures = [];
  if (staticResult.failure) {
    allFailures.push({ gameId: null, tier: null, reason: 'static 门禁失败（见上）' });
  }
  const content = staticResult.content;
  const contentIndex = content ? indexCommissions(content.commissions) : new Map();
  const fixtures = staticResult.fixtures || { entries: [] };

  let e2e = null;
  let sample = null;
  let envErrors = 0;
  let exitCode = 0;

  if (options.e2e) {
    if (!content) {
      envErrors += 1;
      console.log('ENV  内容不可读，跳过 E2E');
    } else {
      options.contentIndex = contentIndex;
      e2e = await runE2EPhase(options, options.portBase, options.cdpBase);
      envErrors += e2e.envErrors;
      e2e.failures.forEach((item) => allFailures.push(item));
    }
  }
  if (options.sample) {
    if (!content) {
      envErrors += 1;
      console.log('ENV  内容不可读，跳过抽样');
    } else {
      sample = await runSamplePhase(options, contentIndex, fixtures);
      envErrors += sample.envErrors;
      sample.failures.forEach((item) => allFailures.push(item));
    }
  }

  /* 汇总计数 */
  const staticSummary = staticResult.recorder ? staticResult.recorder.summary() : { total: 0, passed: 0, failed: 0 };
  const sampleSummary = sample && sample.recorder ? sample.recorder.summary() : { total: 0, passed: 0, failed: 0 };
  const e2eTiers = e2e ? e2e.perGame.reduce((sum, game) => sum + game.tiers.length, 0) : 0;
  const e2eTierPassed = e2e ? e2e.perGame.reduce((sum, game) => sum + game.tiers.filter((tier) => tier.ok).length, 0) : 0;
  const e2eGamesPassed = e2e ? e2e.perGame.filter((game) => game.ok).length : 0;

  console.log('');
  console.log('SUMMARY  static   ' + staticSummary.passed + '/' + staticSummary.total + ' checks');
  if (e2e) {
    console.log(
      'SUMMARY  e2e      games=' + e2eGamesPassed + '/' + (e2e.gamesRun || 0) +
      '  tiers=' + e2eTierPassed + '/' + e2eTiers +
      '  runnerChecks=' + e2e.passedChecks + '/' + e2e.totalChecks +
      '  ports=' + (e2e.portRange || '—')
    );
  }
  if (sample) {
    const sampleSuccess = sample.successResults.filter((item) => item.ok).length;
    const sampleFailure = sample.failureResults.filter((item) => item.ok).length;
    const entryPassed = sample.entryResults.filter((item) => item.ok).length;
    console.log(
      'SUMMARY  sample   success=' + sampleSuccess + '/' + sample.successResults.length +
      '  failure=' + sampleFailure + '/' + sample.failureResults.length +
      '  entry=' + entryPassed + '/' + sample.entryResults.length +
      '  checks=' + sampleSummary.passed + '/' + sampleSummary.total
    );
  }
  const isolationSamples = sample ? sample.successResults.filter((result) => result.classic) : [];
  const isolationPassed = isolationSamples.filter((result) => result.classic.ok).length;
  if (sample) {
    console.log('SUMMARY  isolation classic5=' + isolationPassed + '/' + isolationSamples.length + ' samples');
  }
  if (allFailures.length) {
    console.log('');
    console.log('FAILURES  ' + allFailures.length);
    allFailures.forEach((item) => {
      console.log('  FAIL  ' + (item.gameId || 'static') + (item.tier ? ' T' + item.tier : '') + (item.id ? ' ' + item.id : '') + ' — ' + item.reason);
    });
  }

  /* 证据 / 数据落盘（仓库外） */
  const data = {
    generatedAt: new Date().toISOString(),
    options: {
      requestedPortBase: options.requestedPortBase,
      requestedCdpBase: options.requestedCdpBase,
      portShift: options.portShift,
      portBase: options.portBase,
      cdpBase: options.cdpBase,
      samplePort: options.samplePort,
      sampleCdp: options.sampleCdp,
      skipStatic: options.skipStatic === true,
      tierTimeoutMs: options.tierTimeoutMs,
      artifacts: ARTIFACTS_DIR,
    },
    static: {
      summary: staticSummary,
      results: staticResult.recorder ? staticResult.recorder.results : [],
    },
    e2e: e2e
      ? {
        gamesPassed: e2eGamesPassed,
        gamesRun: e2e.gamesRun,
        tiersPassed: e2eTierPassed,
        tiersTotal: e2eTiers,
        runnerChecksPassed: e2e.passedChecks,
        runnerChecksTotal: e2e.totalChecks,
        perGame: e2e.perGame,
        failures: e2e.failures,
      }
      : null,
    sample: sample
      ? {
        summary: sampleSummary,
        success: sample.successResults,
        failure: sample.failureResults,
        entry: sample.entryResults,
        failures: sample.failures,
      }
      : null,
    failures: allFailures,
  };
  const tables = buildEvidenceMarkdown({
    options: options,
    static: { recorder: staticResult.recorder },
    e2e: e2e || { perGame: [] },
    successResults: sample ? sample.successResults : [],
    entryResults: sample ? sample.entryResults : [],
  });
  const tablesPath = writeTextArtifact('D17-26-tables.md', tables);
  const summaryPath = writeJsonArtifact('D17-26-summary.json', data);
  if (!staticResult.failure) {
    const exitForFailures = allFailures.length > 0;
    if (envErrors > 0) exitCode = 2;
    else if (exitForFailures) exitCode = 1;
  } else {
    exitCode = envErrors > 0 ? 2 : 1;
  }
  console.log('');
  console.log(
    'RESULT   ' + (exitCode === 0 ? 'PASS' : exitCode === 1 ? 'FAIL' : 'ENV-ERROR') +
    '  exit=' + exitCode + '  failures=' + allFailures.length + '  envErrors=' + envErrors
  );
  if (tablesPath) console.log('ARTIFACT ' + tablesPath);
  if (summaryPath) console.log('ARTIFACT ' + summaryPath);
  return exitCode;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  console.error('ENV    test 未捕获异常：' + errorText(err));
  process.exitCode = 2;
}
