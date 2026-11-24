#!/usr/bin/env node
/**
 * Arcade Life 生涯独立备份与迁移 v1 门禁（0.15，D15-14）：
 * ADR §10 的备份格式、纯校验（坏档整体拒绝）、迁移、旧档 preserved 语义，
 * 以及真实 Chrome/IndexedDB 下的导出 → 改库 → 导入还原、零半成品、localStorage 零变化、
 * bridge 以可选依赖装载 backup.js 后页面无 404。
 *
 * 覆盖：
 * - A 组（纯 Node，无 Chrome）：buildExportPayload / parseAndValidate / formatFilename /
 *   migrateSnapshot / importCareerLife·exportCareerLife 的结构化失败与注入路径、
 *   源码静态边界（不触达浏览器存储 / DOM / 网络）
 * - B 组（真实 Chrome + CDP）：注入 career-core.js / career-db.js / backup.js 到
 *   apps/arcade/index.html，验证完整生涯+发现数据的导出、改库、单事务导入还原（逐表）、
 *   坏档零写入、旧档 preserved、localStorage 零变化、db 失败结构化返回；
 *   再打开真实游戏页验证 bridge 把 backup.js 作为可选依赖成功装载且无 404
 *
 * 零 npm 依赖：复用 tools/lib/arcade_cdp.mjs；端口默认 CAREER_BACKUP_PORT=8838、
 * CAREER_BACKUP_CDP_PORT=9438（与 smoke / gameplay / 其它 career 门禁不冲突）。
 * 运行：node tools/career_backup_test.mjs [--only=A|B] [--port=8838] [--cdp-port=9438]
 * 退出码：0 全部通过；1 有 FAIL；2 环境/装配失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO_ROOT, createRecorder, envPort, launchChrome, openPage, sleep, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const ARTIFACTS = path.join(REPO_ROOT, 'test-artifacts');
const VIEWPORT = { width: 420, height: 900 };
const DB_NAME = 'studiokit:arcade:career';
const CAREER_DIR = path.join(REPO_ROOT, 'apps', 'arcade', 'career');
const CORE_FILE = path.join(CAREER_DIR, 'career-core.js');
const DB_FILE = path.join(CAREER_DIR, 'career-db.js');
const BACKUP_FILE = path.join(CAREER_DIR, 'backup.js');
const GAME_URL_PATH = '/apps/arcade/games/memory-flip.html?careerTest=1#test';
const FORMAT = 'studiokit-arcade-career';
const STORES = [
  'profiles',
  'state',
  'discovery',
  'runs',
  'claims',
  'ledgers',
  'balances',
  'inventory',
  'equipment',
  'quests',
  'migrations',
];
const PAYLOAD_KEYS = ['format', 'careerSchemaVersion', 'contentVersion', 'rulesetVersion', 'exportedAt'].concat(STORES);

let SERVER_PORT = 0;
let CDP_PORT = 0;
let BASE = '';

const { record, assert, summary } = createRecorder();
const require = createRequire(import.meta.url);

function arg(name, fallback) {
  const prefix = '--' + name + '=';
  const hit = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function detail(value) {
  if (value === undefined) return '';
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 260 ? text.slice(0, 260) + '…' : text;
  } catch (err) {
    return String(value);
  }
}

async function check(name, fn) {
  try {
    const info = await fn();
    record(name, true, detail(info));
  } catch (err) {
    record(name, false, err && err.message ? err.message : String(err));
  }
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        out[key] = sortValue(value[key]);
      });
    return out;
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function storeSlice(payload) {
  const out = {};
  STORES.forEach((name) => {
    out[name] = Array.isArray(payload && payload[name]) ? payload[name] : [];
  });
  return out;
}

function countsOf(payload) {
  const counts = {};
  STORES.forEach((name) => {
    counts[name] = Array.isArray(payload && payload[name]) ? payload[name].length : 0;
  });
  return counts;
}

/* ------------------------------------------------------------------ *
 * 夹具：合法 v1 备份（含 11 store 与跨表引用）
 * ------------------------------------------------------------------ */

function ts(minute, second) {
  return '2026-11-22T01:' + String(minute).padStart(2, '0') + ':' + String(second || 0).padStart(2, '0') + '.000Z';
}

function makePayload() {
  const at = ts(0, 0);
  return {
    format: FORMAT,
    careerSchemaVersion: 1,
    contentVersion: '0.15.0',
    rulesetVersion: 1,
    exportedAt: at,
    profiles: [
      {
        careerId: 'career-a1',
        schemaVersion: 1,
        rulesetVersion: 1,
        originGameId: 'memory-flip',
        createdAt: at,
        updatedAt: at,
        capabilities: ['cap-memory'],
        flags: [],
        evidence: ['EV-memory-1'],
        settings: { hintsEnabled: true },
      },
    ],
    state: [
      { key: 'discovery', schemaVersion: 1, updatedAt: at, value: { schemaVersion: 1, stage: 'GLIMPSED', hintsEnabled: true } },
      { key: 'career', schemaVersion: 1, updatedAt: at, value: { careerId: 'career-a1', originGameId: 'memory-flip', createdAt: at } },
    ],
    discovery: [
      {
        clueId: 'CL-memory-flip',
        sourceGame: 'memory-flip',
        firstSeenRunId: 'run-a1',
        seenAt: at,
        openedAt: null,
        dismissed: false,
        updatedAt: at,
      },
      {
        clueId: 'CL-gomoku',
        sourceGame: 'gomoku',
        firstSeenRunId: null,
        seenAt: at,
        openedAt: null,
        dismissed: true,
        updatedAt: at,
      },
    ],
    runs: [
      {
        runId: 'run-a1',
        careerId: 'career-a1',
        gameId: 'memory-flip',
        commissionId: 'memory-flip.T1',
        nonce: 'nonce-1',
        mode: 'commission',
        sourceMode: 'commission',
        status: 'claimed',
        createdAt: at,
        updatedAt: at,
      },
    ],
    claims: [
      {
        runId: 'run-a1',
        schemaVersion: 1,
        receiptId: 'run-a1',
        careerId: 'career-a1',
        commissionId: 'memory-flip.T1',
        credits: 70,
        items: { 'mat.scrap': 2 },
        evidence: ['EV-memory-1'],
        flags: ['FLAG-alpha'],
        txIds: ['tx:run-a1:1', 'tx:run-a1:2', 'tx:run-a1:3'],
        claimedAt: at,
        rulesetVersion: 1,
        contentVersion: '0.15.0',
      },
    ],
    ledgers: [
      {
        txId: 'tx:init:career-a1:1',
        schemaVersion: 1,
        kind: 'initial-grant',
        careerId: 'career-a1',
        step: 1,
        credits: 80,
        items: {},
        at,
        rulesetVersion: 1,
        contentVersion: '0.15.0',
      },
      {
        txId: 'tx:run-a1:1',
        schemaVersion: 1,
        runId: 'run-a1',
        careerId: 'career-a1',
        step: 1,
        kind: 'credits',
        credits: 70,
        items: {},
        at,
        rulesetVersion: 1,
        contentVersion: '0.15.0',
      },
      {
        txId: 'purchase:P-1',
        schemaVersion: 1,
        kind: 'purchase',
        careerId: 'career-a1',
        purchaseId: 'P-1',
        step: 1,
        credits: -10,
        items: { 'mat.wire': 1 },
        balanceAfter: 140,
        at,
        rulesetVersion: 1,
        contentVersion: '0.15.0',
      },
    ],
    balances: [{ careerId: 'career-a1', credits: 140, revision: 3, createdAt: at, updatedAt: at }],
    inventory: [
      { careerId: 'career-a1', itemId: 'mat.scrap', count: 2, updatedAt: at },
      { careerId: 'career-a1', itemId: 'mat.wire', count: 1, updatedAt: at },
    ],
    equipment: [{ careerId: 'career-a1', ship: 'scout', updatedAt: at }],
    quests: [
      {
        careerId: 'career-a1',
        nodeId: 'memory-flip.T1',
        kind: 'commission',
        status: 'cleared',
        evidence: ['EV-memory-1'],
        flags: ['FLAG-alpha'],
        clearedAt: at,
        updatedAt: at,
      },
    ],
    migrations: [],
  };
}

function payloadText(mutator) {
  const payload = clone(makePayload());
  if (typeof mutator === 'function') mutator(payload);
  return JSON.stringify(payload);
}

/* ------------------------------------------------------------------ *
 * A 组：纯 Node 契约
 * ------------------------------------------------------------------ */

let backup = null;

async function runNodeChecks() {
  backup = require(BACKUP_FILE);

  await check('A01 API 面与冻结常量（FORMAT / SCHEMA_VERSION / 7 个方法）', async () => {
    const required = ['buildExportPayload', 'parseAndValidate', 'formatFilename', 'exportCareerLife', 'importCareerLife', 'migrateSnapshot'];
    const missing = required.filter((name) => typeof backup[name] !== 'function');
    assert(!missing.length, '缺少方法：' + missing.join(','));
    assert(backup.FORMAT === FORMAT, 'FORMAT=' + backup.FORMAT);
    assert(backup.SCHEMA_VERSION === 1, 'SCHEMA_VERSION=' + backup.SCHEMA_VERSION);
    assert(typeof backup.exportCareerLife({}).then === 'function', 'exportCareerLife 必须返回 Promise');
    assert(typeof backup.importCareerLife('').then === 'function', 'importCareerLife 必须返回 Promise');
    return 'FORMAT=' + backup.FORMAT + ' SCHEMA_VERSION=' + backup.SCHEMA_VERSION;
  });

  await check('A02 buildExportPayload：ADR §10 字段顺序 + 11 store 数组 + 未知字段丢弃', async () => {
    const snapshot = {
      format: 'ignored-snapshot-format',
      exportedAt: '2026-11-22T00:00:00.000Z',
      profiles: [{ careerId: 'career-a1' }],
      claims: [{ runId: 'run-a1' }],
      stray: 'must-not-leak',
    };
    const payload = backup.buildExportPayload(snapshot, {
      contentVersion: '0.15.0-qa',
      rulesetVersion: 1,
      exportedAt: '2026-11-22T02:00:00.000Z',
    });
    assert(sameJson(Object.keys(payload), PAYLOAD_KEYS), '字段顺序错误：' + JSON.stringify(Object.keys(payload)));
    assert(payload.format === FORMAT, 'format=' + payload.format);
    assert(payload.careerSchemaVersion === 1, 'careerSchemaVersion=' + payload.careerSchemaVersion);
    assert(payload.contentVersion === '0.15.0-qa', 'contentVersion=' + payload.contentVersion);
    assert(payload.rulesetVersion === 1, 'rulesetVersion=' + payload.rulesetVersion);
    assert(payload.exportedAt === '2026-11-22T02:00:00.000Z', 'exportedAt=' + payload.exportedAt);
    assert(payload.profiles.length === 1 && payload.claims.length === 1, '已有 store 丢失');
    assert(payload.stray === undefined, '未知顶层字段泄漏到备份');
    assert(STORES.every((name) => Array.isArray(payload[name])), '存在非数组 store');
    assert(payload.state.length === 0 && payload.migrations.length === 0, '缺省 store 应补空数组');
    payload.profiles[0].careerId = 'mutated';
    assert(snapshot.profiles[0].careerId === 'career-a1', 'payload 与快照共享引用（未深拷贝）');
    return 'keys=' + Object.keys(payload).length + ' stores=' + STORES.length;
  });

  await check('A03 buildExportPayload：版本/时间回退链（meta > 运行时 > 快照 > 默认）', async () => {
    const a = backup.buildExportPayload({ contentVersion: '0.15.0-snapshot', exportedAt: '2026-11-22T00:00:00.000Z' }, {});
    assert(a.contentVersion === '0.15.0-snapshot', '快照 contentVersion 未回退：' + a.contentVersion);
    assert(a.exportedAt === '2026-11-22T00:00:00.000Z', '快照 exportedAt 未回退：' + a.exportedAt);
    assert(a.rulesetVersion === 1, 'rulesetVersion 默认应为 1：' + a.rulesetVersion);
    const b = backup.buildExportPayload({}, { contentVersion: '0.15.0-meta', rulesetVersion: 3, now: '2026-11-22T05:06:07.000Z' });
    assert(b.contentVersion === '0.15.0-meta', 'meta contentVersion=' + b.contentVersion);
    assert(b.rulesetVersion === 3, 'meta rulesetVersion=' + b.rulesetVersion);
    assert(b.exportedAt === '2026-11-22T05:06:07.000Z', 'meta.now 未转 exportedAt：' + b.exportedAt);
    const c = backup.buildExportPayload({}, { contentVersion: '', rulesetVersion: 0 });
    assert(c.contentVersion === '0.18.0', '默认 contentVersion 应为 0.18.0：' + c.contentVersion);
    assert(c.rulesetVersion === 1, '默认 rulesetVersion 应为 1：' + c.rulesetVersion);
    assert(!isNaN(Date.parse(c.exportedAt)), '默认 exportedAt 不是 ISO：' + c.exportedAt);
    const previousRuntime = globalThis.ArcadeCareer;
    try {
      globalThis.ArcadeCareer = { version: '0.15.9-runtime' };
      const d = backup.buildExportPayload({ contentVersion: '0.15.0-snapshot' }, {});
      assert(d.contentVersion === '0.15.9-runtime', 'window.ArcadeCareer.version 未优先于快照：' + d.contentVersion);
    } finally {
      globalThis.ArcadeCareer = previousRuntime;
    }
    return 'a=' + a.contentVersion + ' b=' + b.contentVersion + ' default=' + c.contentVersion + ' runtime=0.15.9-runtime';
  });

  await check('A04 formatFilename：YYYYMMDD-HHMMSS + 补零 + 非法 now 兜底', async () => {
    const fixed = new Date(2026, 0, 2, 3, 4, 5);
    const name = backup.formatFilename(fixed);
    assert(name === 'studiokit-arcade-career-20260102-030405.json', '文件名=' + name);
    const fixed2 = new Date(2026, 11, 31, 23, 59, 58);
    assert(backup.formatFilename(fixed2) === 'studiokit-arcade-career-20261231-235958.json', '文件名2=' + backup.formatFilename(fixed2));
    const pattern = /^studiokit-arcade-career-\d{8}-\d{6}\.json$/;
    assert(pattern.test(backup.formatFilename('not-a-date')), '非法 now 未兜底：' + backup.formatFilename('not-a-date'));
    assert(pattern.test(backup.formatFilename()), '缺省 now 未兜底');
    const iso = '2026-11-22T03:04:05.000Z';
    const expected = backup.formatFilename(new Date(iso));
    assert(backup.formatFilename(iso) === expected, 'ISO 字符串与 Date 结果不一致');
    return name;
  });

  await check('A05 parseAndValidate：合法档通过（规范化 / stats / 警告 / 未知字段忽略）', async () => {
    const text = payloadText((payload) => {
      payload.note = 'unknown-top-level';
    });
    const parsed = backup.parseAndValidate(text);
    assert(parsed.ok === true, '解析失败：' + detail(parsed));
    assert(parsed.legacy !== true, '合法档被误判为旧档');
    assert(parsed.payload.format === FORMAT && parsed.payload.careerSchemaVersion === 1, 'payload 元信息错误');
    assert(parsed.payload.contentVersion === '0.15.0' && parsed.payload.rulesetVersion === 1, '版本字段错误');
    assert(sameJson(parsed.payload, backup.buildExportPayload(parsed.payload, {
      contentVersion: '0.15.0',
      rulesetVersion: 1,
      exportedAt: parsed.payload.exportedAt,
    })), 'payload 不是规范化形状');
    const counts = countsOf(parsed.payload);
    assert(counts.profiles === 1 && counts.discovery === 2 && counts.claims === 1 && counts.ledgers === 3, 'counts=' + JSON.stringify(counts));
    assert(sameJson(parsed.stats.counts, counts), 'stats.counts 与 payload 不一致');
    assert(parsed.stats.total === 15, 'stats.total=' + parsed.stats.total);
    assert(parsed.stats.bytes > 0 && parsed.stats.bytes < 2 * 1024 * 1024, 'stats.bytes=' + parsed.stats.bytes);
    assert(parsed.warnings.indexOf('unknown-field:note') !== -1, '未知顶层字段未记 warning：' + JSON.stringify(parsed.warnings));
    const again = backup.parseAndValidate(JSON.stringify(parsed.payload));
    assert(again.ok === true && stableJson(again.payload) === stableJson(parsed.payload), '规范化 payload 不可二次解析');
    return 'bytes=' + parsed.stats.bytes + ' total=' + parsed.stats.total;
  });

  await check('A06 parseAndValidate：坏 JSON / 非对象 / 空文本全部结构化失败', async () => {
    const cases = [
      ['{bad', 'bad-json'],
      ['', 'bad-json'],
      ['[]', 'bad-format'],
      ['"text"', 'bad-format'],
      ['42', 'bad-format'],
      [null, 'bad-input'],
      [123, 'bad-input'],
    ];
    const got = [];
    cases.forEach(([input, expected]) => {
      const result = backup.parseAndValidate(input);
      assert(result.ok === false, '应失败但通过：' + previewOf(input));
      assert(result.error === expected, '错误码=' + result.error + '（期望 ' + expected + '）');
      got.push(result.error);
    });
    return got.join(',');
  });

  await check('A07 parseAndValidate：错 format / 未知 store / 非数组 store 拒绝；缺 migrations 容忍', async () => {
    const badFormat = backup.parseAndValidate(JSON.stringify(Object.assign(clone(makePayload()), { format: 'studiokit-arcade-backup' })));
    assert(!badFormat.ok && badFormat.error === 'bad-format', '错 format：' + detail(badFormat));
    const unknownStore = backup.parseAndValidate(payloadText((payload) => {
      payload.evil = [];
    }));
    assert(!unknownStore.ok && unknownStore.error === 'unknown-store', '未知 store：' + detail(unknownStore));
    const notArray = backup.parseAndValidate(payloadText((payload) => {
      payload.claims = 'no';
    }));
    assert(!notArray.ok && notArray.error === 'bad-record', '非数组 store：' + detail(notArray));
    const noMigrations = backup.parseAndValidate(payloadText((payload) => {
      delete payload.migrations;
    }));
    assert(noMigrations.ok === true && noMigrations.payload.migrations.length === 0, '缺 migrations 未补空：' + detail(noMigrations));
    assert(noMigrations.warnings.indexOf('missing-migrations') !== -1, '缺 migrations 未记 warning');
    return 'bad-format/unknown-store/bad-record 拒绝，缺 migrations 容忍';
  });

  await check('A08 parseAndValidate：未来版本拒绝并提示升级 / 低版本无迁移 / 缺版本为旧档', async () => {
    const future = backup.parseAndValidate(payloadText((payload) => {
      payload.careerSchemaVersion = 2;
    }));
    assert(!future.ok && future.error === 'unsupported-schema', '未来版本：' + detail(future));
    assert(future.upgrade === true && future.fromVersion === 2, '未来版本缺少升级提示');
    const lower = backup.parseAndValidate(payloadText((payload) => {
      payload.careerSchemaVersion = 0;
    }));
    assert(!lower.ok && (lower.error === 'no-migration' || lower.error === 'unsupported-schema'), '低版本：' + detail(lower));
    const missing = backup.parseAndValidate(payloadText((payload) => {
      delete payload.careerSchemaVersion;
    }));
    assert(missing.ok === true && missing.legacy === true && missing.reason === 'legacy', '缺版本应为旧档：' + detail(missing));
    const notNumber = backup.parseAndValidate(payloadText((payload) => {
      payload.careerSchemaVersion = 'v1';
    }));
    assert(!notNumber.ok && notNumber.error === 'bad-version', '非数字版本：' + detail(notNumber));
    return 'future=upgrade, lower=' + lower.error + ', missing=legacy';
  });

  await check('A09 parseAndValidate：11 个唯一键逐表拒绝重复', async () => {
    const cases = [
      ['profiles', (p) => p.profiles.push(clone(p.profiles[0]))],
      ['state', (p) => p.state.push(clone(p.state[0]))],
      ['discovery', (p) => p.discovery.push(clone(p.discovery[0]))],
      ['runs', (p) => p.runs.push(clone(p.runs[0]))],
      ['claims', (p) => p.claims.push(clone(p.claims[0]))],
      ['ledgers', (p) => p.ledgers.push(clone(p.ledgers[0]))],
      ['balances', (p) => p.balances.push(clone(p.balances[0]))],
      ['inventory', (p) => p.inventory.push(clone(p.inventory[0]))],
      ['equipment', (p) => p.equipment.push(clone(p.equipment[0]))],
      ['quests', (p) => p.quests.push(clone(p.quests[0]))],
      ['migrations', (p) => p.migrations.push({ id: 'v0-v1', appliedAt: ts(1), inputHash: 'a'.repeat(16) }, clone({ id: 'v0-v1', appliedAt: ts(1), inputHash: 'a'.repeat(16) }))],
    ];
    const hit = [];
    cases.forEach(([store, mutate]) => {
      const result = backup.parseAndValidate(payloadText(mutate));
      assert(!result.ok, store + ' 重复键未拒绝');
      assert(result.error === 'duplicate-key', store + ' 错误码=' + result.error);
      assert(result.path && result.path.indexOf(store + '[') === 0, store + ' path=' + result.path);
      assert(Array.isArray(result.issues) && result.issues.length >= 1, store + ' 缺少 issues');
      hit.push(store);
    });
    return hit.join(',');
  });

  await check('A10 parseAndValidate：数值上限（负余额 / 非整数 / 库存超上限 / claims 超限）', async () => {
    const cases = [
      ['negative-balance', (p) => { p.balances[0].credits = -1; }],
      ['fraction-balance', (p) => { p.balances[0].credits = 1.5; }],
      ['over-balance', (p) => { p.balances[0].credits = 1000001; }],
      ['over-inventory', (p) => { p.inventory[0].count = 1000; }],
      ['negative-inventory', (p) => { p.inventory[0].count = -2; }],
      ['over-claim-credits', (p) => { p.claims[0].credits = 1000001; }],
      ['over-claim-item', (p) => { p.claims[0].items = { 'mat.x': 1000 }; }],
      ['over-claim-txids', (p) => { p.claims[0].txIds = Array.from({ length: 17 }, (_, i) => 'tx:run-a1:' + i); }],
      ['over-claim-evidence', (p) => { p.claims[0].evidence = Array.from({ length: 25 }, (_, i) => 'EV-' + i); }],
    ];
    const hit = [];
    cases.forEach(([label, mutate]) => {
      const result = backup.parseAndValidate(payloadText(mutate));
      assert(!result.ok, label + ' 未拒绝');
      assert(result.error === 'bad-value' || result.error === 'bad-id', label + ' 错误码=' + result.error);
      hit.push(label);
    });
    return hit.join(',');
  });

  await check('A11 parseAndValidate：引用完整性（runs→profile / claims→run / ledgers→career）', async () => {
    const cases = [
      ['runs→profile', (p) => { p.runs[0].careerId = 'career-missing'; }, 'runs[0].careerId'],
      ['claims→run', (p) => { p.claims[0].runId = 'run-missing'; }, 'claims[0].runId'],
      ['ledgers→career', (p) => { p.ledgers[0].careerId = 'career-missing'; }, 'ledgers[0].careerId'],
    ];
    const hit = [];
    cases.forEach(([label, mutate, path]) => {
      const result = backup.parseAndValidate(payloadText(mutate));
      assert(!result.ok && result.error === 'bad-reference', label + '：' + detail(result));
      assert(result.path === path, label + ' path=' + result.path);
      hit.push(label);
    });
    const valid = backup.parseAndValidate(payloadText());
    assert(valid.ok === true, '合法引用未通过：' + detail(valid));
    return hit.join(',');
  });

  await check('A12 parseAndValidate：坏条目整体拒绝（不允许部分导入）', async () => {
    const result = backup.parseAndValidate(payloadText((payload) => {
      payload.profiles.push({ careerId: 'bad id with spaces' });
    }));
    assert(!result.ok && result.error === 'bad-id', '坏条目：' + detail(result));
    assert(result.path === 'profiles[1].careerId', 'path=' + result.path);
    assert(result.payload === undefined, '坏档不应返回 payload');
    assert(Array.isArray(result.issues) && result.issues.length === 1, 'issues=' + detail(result.issues));
    const unknownRowField = backup.parseAndValidate(payloadText((payload) => {
      payload.profiles[0].note = 'kept-unknown-row-field';
    }));
    assert(unknownRowField.ok === true && unknownRowField.payload.profiles[0].note === 'kept-unknown-row-field', '行内未知字段应先忽略校验、原样保留');
    return 'rejected whole archive';
  });

  await check('A13 parseAndValidate：总量上限（每表 20000 行 / 文本 32MB）', async () => {
    const tooMany = backup.parseAndValidate(payloadText((payload) => {
      payload.profiles = Array.from({ length: 20001 }, (_, i) => ({ careerId: 'career-' + i }));
    }));
    assert(!tooMany.ok && tooMany.error === 'too-many-rows', '超行数：' + detail(tooMany));
    assert(tooMany.path === 'profiles', 'path=' + tooMany.path);
    const huge = '{"format":"' + FORMAT + '","careerSchemaVersion":1,"pad":"' + 'x'.repeat(32 * 1024 * 1024 + 1) + '"}';
    const tooLarge = backup.parseAndValidate(huge);
    assert(!tooLarge.ok && tooLarge.error === 'too-large', '超文本大小：' + detail(tooLarge));
    assert(tooLarge.bytes > 32 * 1024 * 1024, 'bytes=' + tooLarge.bytes);
    const okRows = backup.parseAndValidate(payloadText((payload) => {
      payload.migrations = Array.from({ length: 20000 }, (_, i) => ({ id: 'm-' + i }));
    }));
    assert(okRows.ok === true, '5000 行边界被误拒：' + detail(okRows));
    const bigOk = backup.parseAndValidate(payloadText((payload) => { payload.pad = 'x'.repeat(2 * 1024 * 1024 + 100); }));
    assert(bigOk.ok === true, '2.1MB 合法档被误拒：' + detail(bigOk));
    return 'too-many-rows + too-large(32MB) + 2.1MB/20000 行边界通过';
  });

  await check('A14 migrateSnapshot：v1 no-op / 高版本拒绝 / 低版本无迁移 / 非法输入', async () => {
    const input = clone(makePayload());
    const migrated = backup.migrateSnapshot(input, 1);
    assert(migrated.ok === true, 'v1 迁移失败：' + detail(migrated));
    assert(sameJson(migrated.migrations, []), 'v1 migrations 应为空数组');
    assert(migrated.snapshot.careerSchemaVersion === 1, 'careerSchemaVersion 被改写');
    assert(stableJson(migrated.snapshot) === stableJson(input), 'v1 快照内容被改写');
    assert(migrated.snapshot !== input, '迁移应返回深拷贝');
    migrated.snapshot.profiles[0].careerId = 'mutated';
    assert(input.profiles[0].careerId === 'career-a1', '迁移结果与输入共享引用');
    const derived = backup.migrateSnapshot(clone(makePayload()));
    assert(derived.ok === true, '缺省 fromVersion 未从快照推导');
    const future = backup.migrateSnapshot(clone(makePayload()), 2);
    assert(!future.ok && future.error === 'unsupported-schema' && future.upgrade === true, '未来版本：' + detail(future));
    const lower = backup.migrateSnapshot(clone(makePayload()), 0);
    assert(!lower.ok && lower.error === 'no-migration', '低版本：' + detail(lower));
    const bad = backup.migrateSnapshot(null, 1);
    assert(!bad.ok && bad.error === 'bad-snapshot', 'null 快照：' + detail(bad));
    const badVersion = backup.migrateSnapshot(clone(makePayload()), 'v1');
    assert(!badVersion.ok && badVersion.error === 'bad-version', '非法版本：' + detail(badVersion));
    return 'v1 no-op, future rejected, lower no-migration';
  });

  await check('A15 旧档 preserved 语义（缺字段 / 空生涯 / 0.14 经典备份）', async () => {
    const classic = JSON.stringify({
      version: '0.14.0',
      exportedAt: '2026-11-22T00:00:00.000Z',
      scores: { games: { 'memory-flip': { best: 12 } } },
      gameMeta: { games: {} },
      playtime: { schemaVersion: 1, totalMs: 1000 },
    });
    const cases = [
      ['classic-0.14', classic, 'missing-format'],
      ['missing-format', payloadText((p) => { delete p.format; }), 'missing-format'],
      ['missing-discovery', payloadText((p) => { delete p.discovery; }), 'missing-store:discovery'],
      ['empty-career', payloadText((p) => { p.profiles = []; }), 'empty-career'],
      ['missing-version', payloadText((p) => { delete p.careerSchemaVersion; }), 'missing-career-schema-version'],
    ];
    const hits = [];
    cases.forEach(([label, text, expectedDetail]) => {
      const result = backup.parseAndValidate(text);
      assert(result.ok === true && result.legacy === true, label + ' 未按旧档处理：' + detail(result));
      assert(result.preserved === true && result.reason === 'legacy', label + ' preserved/reason 错误');
      assert(result.detail === expectedDetail, label + ' detail=' + result.detail + '（期望 ' + expectedDetail + '）');
      assert(result.payload === null, label + ' 旧档不应产生可导入 payload');
      hits.push(label);
    });
    return hits.join(',');
  });

  await check('A16 importCareerLife：旧档/坏档零写库，合法档恰好一次 db.importAll', async () => {
    const calls = [];
    const spy = {
      importAll(payload, opts) {
        calls.push({ payload, opts });
        return Promise.resolve({ ok: true, mode: opts.mode, counts: { profiles: payload.profiles.length } });
      },
    };
    const legacyResult = await backup.importCareerLife(JSON.stringify({ version: '0.14.0', scores: {} }), { db: spy });
    assert(legacyResult.ok === true && legacyResult.preserved === true && legacyResult.reason === 'legacy', '旧档：' + detail(legacyResult));
    assert(legacyResult.mode === 'none', '旧档 mode=' + legacyResult.mode);
    assert(calls.length === 0, '旧档仍调用了 db.importAll');
    const badResult = await backup.importCareerLife('{bad', { db: spy });
    assert(badResult.ok === false && badResult.error === 'bad-json', '坏档：' + detail(badResult));
    assert(calls.length === 0, '坏档仍调用了 db.importAll');
    const okResult = await backup.importCareerLife(payloadText(), { db: spy });
    assert(okResult.ok === true && okResult.preserved === false && okResult.mode === 'replace', '合法档：' + detail(okResult));
    assert(calls.length === 1, 'db.importAll 调用次数=' + calls.length);
    assert(calls[0].opts.mode === 'replace', '默认 mode 应为 replace');
    assert(calls[0].payload.format === FORMAT && calls[0].payload.profiles.length === 1, '传给 db 的 payload 错误');
    assert(okResult.counts.profiles === 1, 'counts=' + detail(okResult.counts));
    const mergeResult = await backup.importCareerLife(payloadText(), { db: spy, mode: 'merge' });
    assert(mergeResult.ok === true && mergeResult.mode === 'merge' && calls.length === 2 && calls[1].opts.mode === 'merge', 'merge 模式未透传');
    const failSpy = { importAll: () => Promise.resolve({ ok: false, reason: 'constraint', error: 'simulated' }) };
    const failResult = await backup.importCareerLife(payloadText(), { db: failSpy });
    assert(failResult.ok === false && failResult.error === 'import-failed', 'db 失败：' + detail(failResult));
    assert(String(failResult.detail).indexOf('constraint') !== -1, 'db 失败原因未透出：' + failResult.detail);
    const throwSpy = { importAll: () => Promise.reject(new Error('boom')) };
    const throwResult = await backup.importCareerLife(payloadText(), { db: throwSpy });
    assert(throwResult.ok === false && throwResult.error === 'import-failed', 'db 抛异常：' + detail(throwResult));
    return 'legacy/bad zero-write, valid one call, merge passthrough';
  });

  await check('A17 exportCareerLife：真实无 IDB 时结构化失败；注入 db 时输出可回读备份', async () => {
    const noDb = await backup.exportCareerLife();
    assert(noDb.ok === false && noDb.error === 'export-failed', 'Node 无 IDB：' + detail(noDb));
    assert(String(noDb.detail).indexOf('no-indexeddb') !== -1, 'detail=' + noDb.detail);
    const unavailable = await backup.exportCareerLife({ db: {} });
    assert(unavailable.ok === false && unavailable.error === 'db-unavailable', '缺 exportAll：' + detail(unavailable));
    const fakeDb = { exportAll: () => Promise.resolve({ ok: true, payload: makePayload() }) };
    const exported = await backup.exportCareerLife({
      db: fakeDb,
      contentVersion: '0.15.0-qa',
      rulesetVersion: 1,
      exportedAt: '2026-11-22T06:00:00.000Z',
    });
    assert(exported.ok === true, '注入导出失败：' + detail(exported));
    assert(/^studiokit-arcade-career-\d{8}-\d{6}\.json$/.test(exported.filename), 'filename=' + exported.filename);
    assert(exported.payload.contentVersion === '0.15.0-qa', 'contentVersion=' + exported.payload.contentVersion);
    assert(exported.payload.exportedAt === '2026-11-22T06:00:00.000Z', 'exportedAt=' + exported.payload.exportedAt);
    let reparsed = null;
    try {
      reparsed = JSON.parse(exported.text);
    } catch (err) {
      throw new Error('导出文本不是 JSON：' + err.message);
    }
    assert(stableJson(reparsed) === stableJson(exported.payload), 'text 与 payload 不一致');
    const validated = backup.parseAndValidate(exported.text);
    assert(validated.ok === true, '导出文本未通过自校验：' + detail(validated));
    const failed = await backup.exportCareerLife({ db: { exportAll: () => Promise.resolve({ ok: false, reason: 'blocked' }) } });
    assert(failed.ok === false && failed.error === 'export-failed' && failed.detail === 'blocked', '导出失败：' + detail(failed));
    const thrown = await backup.exportCareerLife({ db: { exportAll: () => Promise.reject(new Error('io')) } });
    assert(thrown.ok === false && thrown.error === 'export-failed', '导出异常：' + detail(thrown));
    return 'filename=' + exported.filename + ' bytes=' + exported.text.length;
  });

  await check('A18 真实 Node require 下 importCareerLife 结构化失败（不回退任何浏览器存储）', async () => {
    const result = await backup.importCareerLife(payloadText());
    assert(result.ok === false && result.error === 'import-failed', 'Node 导入：' + detail(result));
    assert(String(result.detail).indexOf('no-indexeddb') !== -1, 'detail=' + result.detail);
    assert(result.mode === 'replace', 'mode=' + result.mode);
    return 'import-failed/no-indexeddb';
  });

  await check('A19 源码静态边界：无浏览器存储 / DOM / 网络访问', async () => {
    const codeOnly = (text) =>
      text
        .split('\n')
        .filter((line) => {
          const trimmed = line.trim();
          return !(trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//'));
        })
        .join('\n');
    const source = codeOnly(fs.readFileSync(BACKUP_FILE, 'utf8'));
    const banned = [
      'localStorage',
      'sessionStorage',
      'document.',
      'window.document',
      'XMLHttpRequest',
      'fetch(',
      'navigator.',
      'indexedDB',
      'document.cookie',
      'WebSocket',
    ];
    const hits = banned.filter((token) => source.indexOf(token) !== -1);
    assert(!hits.length, '出现禁止的访问：' + hits.join(','));
    assert(source.indexOf('studiokit:arcade:career') === -1, 'backup.js 不应直接引用 DB 名');
    return 'clean (' + banned.length + ' tokens)';
  });
}

function previewOf(value) {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text === undefined ? String(value) : text.slice(0, 80);
  } catch (err) {
    return String(value);
  }
}

/* ------------------------------------------------------------------ *
 * 页面辅助（真实 Chrome）
 * ------------------------------------------------------------------ */

async function injectModules(cdp) {
  return cdp.evaluate(`(async () => {
    const base = new URL('career/', location.href).href;
    for (const file of ['career-core.js', 'career-db.js', 'backup.js']) {
      const response = await fetch(base + file, { cache: 'no-store' });
      if (!response.ok) throw new Error('fetch ' + file + ' -> ' + response.status);
      const source = await response.text();
      if (!source || source.length < 1000) throw new Error('fetch ' + file + ' 内容异常：' + source.length);
      (0, eval)(source);
    }
    const ac = window.ArcadeCareer || {};
    return {
      core: !!ac.core,
      db: !!ac.db,
      backup: !!ac.backup,
      format: ac.backup ? ac.backup.FORMAT : null,
      methods: ac.backup ? Object.keys(ac.backup).sort() : [],
      url: location.href,
    };
  })()`);
}

/** 在页面里跑一段 async 代码；db / core / backup 已注入作用域。 */
function pageEval(cdp, body) {
  return cdp.evaluate(`(async () => {
    const ac = window.ArcadeCareer || {};
    const db = ac.db;
    const core = ac.core;
    const backup = ac.backup;
    if (!db || !core || !backup) throw new Error('career modules not injected');
    ${body}
  })()`);
}

function deleteDatabaseRaw(cdp) {
  return cdp.evaluate(`new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), 4000);
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const request = indexedDB.deleteDatabase(${JSON.stringify(DB_NAME)});
    request.onsuccess = () => finish({ ok: true });
    request.onerror = () => finish({ ok: false, error: String(request.error) });
    request.onblocked = () => finish({ ok: false, reason: 'blocked' });
  })`);
}

async function readStorage(cdp) {
  return cdp.evaluate(`(() => {
    const out = {};
    Object.keys(localStorage).sort().forEach((key) => { out[key] = localStorage.getItem(key); });
    return out;
  })()`);
}

async function seedStorage(cdp) {
  return cdp.evaluate(`(() => {
    localStorage.setItem('studiokit:arcade:scores:v1', JSON.stringify({ games: { 'memory-flip': { best: 12 } } }));
    localStorage.setItem('studiokit:arcade:meta:v1', JSON.stringify({ games: { 'star-raid': { hangar: { formula: 1 } } } }));
    localStorage.setItem('studiokit:arcade:playtime:v1', JSON.stringify({ schemaVersion: 1, totalMs: 54321 }));
    return Object.keys(localStorage).sort();
  })()`);
}

/* ------------------------------------------------------------------ *
 * B 组：真实 Chrome + IndexedDB
 * ------------------------------------------------------------------ */

async function runChromeChecks(cdp) {
  const injected = await injectModules(cdp);
  assert(injected.core && injected.db && injected.backup, '模块注入失败：' + JSON.stringify(injected));

  const isolated = await pageEval(cdp, 'const reset = await db.__coreTest.deleteDatabase(); return reset;');
  assert(isolated.ok, '起始 deleteDatabase 失败：' + JSON.stringify(isolated));

  const storageKeys = await seedStorage(cdp);
  const storageAtStart = await readStorage(cdp);
  let careerId = null;
  let beforePayload = null;
  let exportedText = '';
  let exportedPayload = null;

  await check('B01 注入后 API 面完整 + 起始 deleteDatabase（测试隔离）', async () => {
    assert(injected.format === FORMAT, 'browser FORMAT=' + injected.format);
    const required = ['FORMAT', 'SCHEMA_VERSION', 'buildExportPayload', 'parseAndValidate', 'formatFilename', 'exportCareerLife', 'importCareerLife', 'migrateSnapshot'];
    const missing = required.filter((name) => injected.methods.indexOf(name) === -1);
    assert(!missing.length, '缺少方法：' + missing.join(','));
    assert(injected.methods.length === required.length, 'API 面多了未知方法：' + JSON.stringify(injected.methods));
    assert(storageKeys.filter((key) => key.indexOf('studiokit:arcade:') === 0).length >= 3, '种子 localStorage 键丢失');
    return 'methods=' + injected.methods.length + ' storageKeys=' + storageKeys.length;
  });

  await check('B02 建完整生涯数据（career/discovery/run/claim/purchase）', async () => {
    const setup = await pageEval(
      cdp,
      `const state = {
         schemaVersion: 1,
         stage: 'GLIMPSED',
         firstSourceGame: 'memory-flip',
         firstClueId: 'CL-memory-flip',
         hintsEnabled: true,
         portSeenAt: null,
         careerSignedAt: null,
         explorerAt: null,
         updatedAt: '2026-11-22T01:00:00.000Z',
         clues: {
           'CL-memory-flip': { clueId: 'CL-memory-flip', sourceGame: 'memory-flip', firstSeenRunId: null, seenAt: '2026-11-22T01:00:00.000Z', openedAt: null, dismissed: false }
         },
         runs: { 'memory-flip': { eligibleRuns: 2, lastRunId: null, lastRunAt: '2026-11-22T01:00:00.000Z' } }
       };
       const savedState = await db.saveDiscoveryState(state);
       const put = await db.putDiscovery([
         { clueId: 'CL-memory-flip', sourceGame: 'memory-flip', firstSeenRunId: null, seenAt: '2026-11-22T01:00:00.000Z', openedAt: null, dismissed: false },
         { clueId: 'CL-gomoku', sourceGame: 'gomoku', firstSeenRunId: null, seenAt: '2026-11-22T01:00:00.000Z', openedAt: null, dismissed: true }
       ]);
       const ensured = await db.ensureCareer({ originGameId: 'memory-flip', now: '2026-11-22T01:00:00.000Z' });
       if (!ensured.ok) throw new Error('ensureCareer: ' + JSON.stringify(ensured));
       const runId = core.newId('run');
       const created = await db.createRun({ runId, careerId: ensured.careerId, gameId: 'memory-flip', commissionId: 'memory-flip.T1', nonce: 'nonce-b1', mode: 'commission', sourceMode: 'commission', status: 'completed' });
       const claimed = await db.settleAndClaim({
         runId,
         careerId: ensured.careerId,
         nonce: 'nonce-b1',
         plan: { credits: 70, items: { 'mat.scrap': 2 }, evidence: ['EV-memory-1'], flags: ['FLAG-alpha'] },
         now: '2026-11-22T01:01:00.000Z'
       });
       const purchased = await db.purchase({
         careerId: ensured.careerId,
         purchaseId: 'P-b1',
         cost: 10,
         grants: { items: { 'mat.wire': 1 }, equipment: { ship: 'scout' } },
         now: '2026-11-22T01:02:00.000Z'
       });
       const exported = await db.exportAll();
       const wallet = await db.readWallet(ensured.careerId);
       return { careerId: ensured.careerId, runId, savedState, put, created, claimed, purchased, payload: exported.payload, wallet, state };`,
    );
    assert(setup.savedState.ok, 'saveDiscoveryState=' + JSON.stringify(setup.savedState));
    assert(setup.put.ok && setup.put.count === 2, 'putDiscovery=' + JSON.stringify(setup.put));
    assert(setup.careerId, 'careerId 缺失');
    assert(setup.created.ok, 'createRun=' + JSON.stringify(setup.created));
    assert(setup.claimed.ok && setup.claimed.duplicate === false, 'settleAndClaim=' + JSON.stringify(setup.claimed));
    assert(setup.purchased.ok && setup.purchased.duplicate === false, 'purchase=' + JSON.stringify(setup.purchased));
    const counts = countsOf(setup.payload);
    assert(counts.profiles === 1 && counts.state === 2 && counts.discovery === 2, 'counts=' + JSON.stringify(counts));
    assert(counts.runs === 1 && counts.claims === 1, 'runs/claims=' + counts.runs + '/' + counts.claims);
    assert(counts.ledgers === 5, 'ledgers=' + counts.ledgers + '（初始1+领奖3+购买1）');
    assert(counts.balances === 1 && counts.inventory === 2 && counts.equipment === 1 && counts.quests === 1, 'wallet stores 不完整：' + JSON.stringify(counts));
    assert(setup.wallet.credits === 140, 'credits=' + setup.wallet.credits);
    careerId = setup.careerId;
    beforePayload = setup.payload;
    return 'careerId=' + careerId + ' counts=' + JSON.stringify(counts);
  });

  await check('B03 exportCareerLife：文件名/格式/版本/11 stores + 自校验通过', async () => {
    const result = await pageEval(
      cdp,
      `const exported = await backup.exportCareerLife({ now: '2026-11-22T03:04:05.000Z', contentVersion: '0.15.0-qa', rulesetVersion: 1 });
       const defaulted = await backup.exportCareerLife();
       const expectedFilename = backup.formatFilename('2026-11-22T03:04:05.000Z');
       const parsed = exported.ok ? backup.parseAndValidate(exported.text) : null;
       return { exported, defaulted, expectedFilename, parsed };`,
    );
    assert(result.exported.ok, '导出失败：' + detail(result.exported));
    assert(result.defaulted.ok, '默认导出失败：' + detail(result.defaulted));
    assert(result.defaulted.payload.contentVersion === '0.18.0', '默认 contentVersion 应为 0.18.0：' + result.defaulted.payload.contentVersion);
    assert(result.defaulted.payload.rulesetVersion === 1, '默认 rulesetVersion 应为 1：' + result.defaulted.payload.rulesetVersion);
    assert(result.defaulted.payload.careerSchemaVersion === 1, '默认 careerSchemaVersion 应为 1');
    assert(/^studiokit-arcade-career-\d{8}-\d{6}\.json$/.test(result.exported.filename), 'filename=' + result.exported.filename);
    assert(result.exported.filename === result.expectedFilename, 'filename 与 formatFilename 不一致：' + result.exported.filename + ' vs ' + result.expectedFilename);
    assert(result.exported.payload.format === FORMAT && result.exported.payload.careerSchemaVersion === 1, 'payload 元信息错误');
    assert(result.exported.payload.contentVersion === '0.15.0-qa' && result.exported.payload.rulesetVersion === 1, '版本字段错误');
    assert(result.exported.payload.exportedAt === '2026-11-22T03:04:05.000Z', 'exportedAt=' + result.exported.payload.exportedAt);
    assert(sameJson(Object.keys(result.exported.payload), PAYLOAD_KEYS), 'payload 字段顺序错误');
    assert(STORES.every((name) => Array.isArray(result.exported.payload[name])), '存在非数组 store');
    assert(result.exported.text.length < 2 * 1024 * 1024, '导出文本过大：' + result.exported.text.length);
    assert(result.parsed && result.parsed.ok === true, '导出文本未通过自校验：' + detail(result.parsed));
    assert(sameJson(result.parsed.stats.counts, countsOf(beforePayload)), '导出 stats 与数据库不一致');
    exportedText = result.exported.text;
    exportedPayload = result.exported.payload;
    return 'filename=' + result.exported.filename + ' bytes=' + result.exported.text.length;
  });
  await check('B04 清空/改库（clearAll + 新 decoy 生涯）后与导出基准确认不同', async () => {
    const result = await pageEval(
      cdp,
      `const cleared = await db.__coreTest.clearAll();
       const decoy = await db.ensureCareer({ originGameId: 'gomoku', now: '2026-11-22T01:10:00.000Z' });
       const after = await db.exportAll();
       return { cleared, decoy, payload: after.payload };`,
    );
    assert(result.cleared.ok, 'clearAll=' + JSON.stringify(result.cleared));
    assert(result.decoy.ok && result.decoy.careerId !== careerId, 'decoy 生涯未创建或沿用了旧 id');
    assert(!sameJson(storeSlice(result.payload), storeSlice(beforePayload)), '改库后快照仍与基准相同');
    assert(result.payload.discovery.length === 0, '改库后 discovery 未清空');
    return 'decoy careerId=' + result.decoy.careerId;
  });

  await check('B05 importCareerLife(replace)：11 store + discovery + 钱包逐表还原', async () => {
    const result = await pageEval(
      cdp,
      `const imported = await backup.importCareerLife(${JSON.stringify(exportedText)}, { mode: 'replace' });
       const after = await db.exportAll();
       const wallet = await db.readWallet(${JSON.stringify(careerId)});
       const discoveryState = await db.getDiscoveryState();
       const listed = await db.listDiscovery();
       const profile = await db.getProfile(${JSON.stringify(careerId)});
       return { imported, payload: after.payload, wallet, discoveryState, listed: listed.map((row) => row.clueId).sort(), profile };`,
    );
    assert(result.imported.ok === true, '导入失败：' + detail(result.imported));
    assert(result.imported.mode === 'replace' && result.imported.preserved === false, 'mode/preserved 错误：' + detail(result.imported));
    assert(stableJson(result.imported.counts) === stableJson(countsOf(beforePayload)), '导入 counts 与导出基准不一致：' + detail(result.imported.counts));
    const diff = STORES.filter((name) => stableJson(result.payload[name]) !== stableJson(beforePayload[name]));
    assert(!diff.length, '逐表还原不一致：' + diff.join(','));
    const beforeStateValue = (beforePayload.state.find((row) => row.key === 'discovery') || {}).value;
    assert(stableJson(result.discoveryState) === stableJson(beforeStateValue), 'state 里的 discovery 快照未还原');
    assert(sameJson(result.listed, ['CL-gomoku', 'CL-memory-flip']), 'discovery store 未还原：' + JSON.stringify(result.listed));
    assert(result.wallet.credits === 140, 'credits=' + result.wallet.credits);
    assert(result.wallet.items['mat.scrap'] === 2 && result.wallet.items['mat.wire'] === 1, 'items=' + JSON.stringify(result.wallet.items));
    assert(result.wallet.equipment.ship === 'scout', 'equipment=' + JSON.stringify(result.wallet.equipment));
    assert(result.profile && result.profile.originGameId === 'memory-flip', 'profile 未还原：' + detail(result.profile));
    return '11 stores restored, credits=' + result.wallet.credits;
  });

  await check('B06 坏档导入失败后数据库逐表与导入前一致（零半成品）', async () => {
    const badCases = [
      ['bad-json', '{broken'],
      ['bad-reference', payloadText((p) => { p.runs[0].careerId = 'career-missing'; })],
      ['future-version', payloadText((p) => { p.careerSchemaVersion = 2; })],
      ['duplicate-claim', payloadText((p) => { p.claims.push(clone(p.claims[0])); })],
      ['negative-balance', payloadText((p) => { p.balances[0].credits = -3; })],
      ['unknown-store', payloadText((p) => { p.evil = []; })],
    ];
    const results = await pageEval(
      cdp,
      `const cases = ${JSON.stringify(badCases)};
       const out = [];
       for (const [label, text] of cases) out.push({ label, result: await backup.importCareerLife(text, { mode: 'replace' }) });
       const after = await db.exportAll();
       return { out, payload: after.payload };`,
    );
    results.out.forEach((entry) => {
      assert(entry.result.ok === false, entry.label + ' 应失败：' + detail(entry.result));
    });
    assert(!sameJson(storeSlice(results.payload), storeSlice({})), '数据库被清空（不应发生）');
    const diff = STORES.filter((name) => stableJson(results.payload[name]) !== stableJson(beforePayload[name]));
    assert(!diff.length, '坏档导入留下了半成品：' + diff.join(','));
    assert(results.out.every((entry) => entry.result.error), '坏档失败缺少 error code');
    return results.out.map((entry) => entry.label + ':' + entry.result.error).join(',');
  });

  await check('B07 旧档导入 preserved：不覆盖、不删除现有生涯（零写库）', async () => {
    const classic = JSON.stringify({
      version: '0.14.0',
      exportedAt: '2026-11-22T00:00:00.000Z',
      scores: { games: { 'memory-flip': { best: 7 } } },
      gameMeta: { games: { 'star-raid': { hangar: { formula: 1 } } } },
      playtime: { schemaVersion: 1, totalMs: 2000 },
    });
    const emptyCareer = payloadText((p) => {
      p.profiles = [];
    });
    const missingDiscovery = payloadText((p) => {
      delete p.discovery;
    });
    const result = await pageEval(
      cdp,
      `const cases = [
         ['classic-0.14', ${JSON.stringify(classic)}],
         ['empty-career', ${JSON.stringify(emptyCareer)}],
         ['missing-discovery', ${JSON.stringify(missingDiscovery)}]
       ];
       const out = [];
       for (const [label, text] of cases) out.push({ label, result: await backup.importCareerLife(text, { mode: 'replace' }) });
       const after = await db.exportAll();
       const wallet = await db.readWallet(${JSON.stringify(careerId)});
       return { out, payload: after.payload, wallet };`,
    );
    result.out.forEach((entry) => {
      assert(entry.result.ok === true, entry.label + ' 应返回 ok：' + detail(entry.result));
      assert(entry.result.preserved === true && entry.result.reason === 'legacy', entry.label + ' preserved/reason 错误：' + detail(entry.result));
      assert(entry.result.mode === 'none', entry.label + ' mode=' + entry.result.mode);
    });
    const diff = STORES.filter((name) => stableJson(result.payload[name]) !== stableJson(beforePayload[name]));
    assert(!diff.length, '旧档导入改动了数据库：' + diff.join(','));
    assert(result.wallet.credits === 140, '旧档导入后余额=' + result.wallet.credits);
    return result.out.map((entry) => entry.label + ':' + entry.result.detail).join(',');
  });

  await check('B08 导出/导入后 studiokit:arcade:* localStorage 键与内容零变化', async () => {
    const after = await readStorage(cdp);
    assert(sameJson(after, storageAtStart), 'localStorage 变化：' + detail({ before: storageAtStart, after }));
    const arcadeKeys = Object.keys(after).filter((key) => key.indexOf('studiokit:arcade') === 0);
    const careerKeys = arcadeKeys.filter((key) => key.indexOf('career') !== -1);
    assert(!careerKeys.length, '出现 career 相关 localStorage 键：' + JSON.stringify(careerKeys));
    assert(arcadeKeys.every((key) => key !== DB_NAME), 'DB 名被写成 localStorage 键');
    return 'unchanged (' + arcadeKeys.length + ' keys)';
  });

  await check('B09 db.importAll 失败时 backup 返回结构化失败且真库零变化', async () => {
    const result = await pageEval(
      cdp,
      `const fake = { importAll: () => Promise.resolve({ ok: false, reason: 'constraint', error: 'simulated' }) };
       const failed = await backup.importCareerLife(${JSON.stringify(exportedText)}, { db: fake, mode: 'replace' });
       const after = await db.exportAll();
       return { failed, payload: after.payload };`,
    );
    assert(result.failed.ok === false && result.failed.error === 'import-failed', '注入失败：' + detail(result.failed));
    assert(String(result.failed.detail).indexOf('constraint') !== -1, 'detail=' + result.failed.detail);
    const diff = STORES.filter((name) => stableJson(result.payload[name]) !== stableJson(beforePayload[name]));
    assert(!diff.length, 'db 失败后 backup 又写了库：' + diff.join(','));
    return 'import-failed:constraint, zero writes';
  });

  await check('B10 importCareerLife(merge) 透传 mode 且同档合并后逐表不变', async () => {
    const result = await pageEval(
      cdp,
      `const merged = await backup.importCareerLife(${JSON.stringify(exportedText)}, { mode: 'merge' });
       const after = await db.exportAll();
       return { merged, payload: after.payload };`,
    );
    assert(result.merged.ok === true && result.merged.mode === 'merge' && result.merged.preserved === false, 'merge 结果：' + detail(result.merged));
    const diff = STORES.filter((name) => stableJson(result.payload[name]) !== stableJson(beforePayload[name]));
    assert(!diff.length, 'merge 同档后逐表不一致：' + diff.join(','));
    return 'mode=merge, stores unchanged';
  });

  await check('B11 测试结束 deleteDatabase：库为空且可重建', async () => {
    const result = await pageEval(
      cdp,
      `const deleted = await db.__coreTest.deleteDatabase();
       const reopened = await db.open();
       const counts = [];
       for (const name of db.STORES) counts.push(await db.__coreTest.countRecords(name));
       return { deleted, reopened: reopened.ok, counts };`,
    );
    assert(result.deleted.ok, 'deleteDatabase=' + JSON.stringify(result.deleted));
    assert(result.reopened === true, '删除后重新 open 失败');
    assert(result.counts.length === 11 && result.counts.every((count) => count === 0), '删除后库不为空：' + JSON.stringify(result.counts));
    return 'empty database after delete';
  });
}

/* ------------------------------------------------------------------ *
 * 真实游戏页：bridge 以可选依赖装载 backup.js 且页面无 404
 * ------------------------------------------------------------------ */

async function runBridgeLoadChecks(cdp, networkResponses) {
  await check('B12 bridge 以可选依赖装载 backup.js（真实游戏页 ?careerTest=1）', async () => {
    networkResponses.length = 0;
    cdp.errors = [];
    await cdp.navigate(BASE + GAME_URL_PATH);
    await cdp.waitFor(`window.__arcadeCareerTest && window.__arcadeCareerTest.ready ? window.__arcadeCareerTest.ready.then(() => true) : false`, {
      timeout: 15000,
    });
    const infoBefore = await cdp.evaluate(`window.__arcadeCareerTest.info()`);
    assert(infoBefore, '游戏页未暴露 __arcadeCareerTest.info（careerTest=1 未生效）');
    const eagerLoaded = await cdp.evaluate(`!!(window.ArcadeCareer && window.ArcadeCareer.backup)`);
    const deferred = Array.isArray(infoBefore.deferredModules) ? infoBefore.deferredModules : [];
    assert(eagerLoaded || deferred.indexOf('backup.js') !== -1, 'backup.js 既未装载也不是 bridge 的延迟可选依赖：' + detail(infoBefore.deferredModules));
    const requestsBeforeWarm = networkResponses.filter((entry) => entry.url.indexOf('/career/backup.js') !== -1).length;
    if (!eagerLoaded) {
      /* bridge 把 backup.js 声明为 deferred：真实使用生涯时（打开信箱）按需装载。 */
      assert(requestsBeforeWarm === 0, '延迟依赖在 boot 阶段就被请求：' + requestsBeforeWarm);
      await cdp.evaluate(`window.__arcadeCareerTest.openMailbox()`);
      await cdp.waitFor(`!!(window.ArcadeCareer && window.ArcadeCareer.backup && window.ArcadeCareer.backup.FORMAT)`, { timeout: 10000 });
    }
    const info = await cdp.evaluate(`window.__arcadeCareerTest.info()`);
    const backupLoad = info.loadedScripts && info.loadedScripts['backup.js'];
    assert(backupLoad && backupLoad.ok === true, 'backup.js 未被 bridge 成功装载：' + detail(backupLoad));
    assert(info.backupLoaded === true, 'info.backupLoaded=' + info.backupLoaded);
    assert(info.loadErrors.length === 0, 'bridge 装载错误：' + detail(info.loadErrors));
    const api = await cdp.evaluate(`({ format: window.ArcadeCareer && window.ArcadeCareer.backup && window.ArcadeCareer.backup.FORMAT, hasParse: typeof (window.ArcadeCareer && window.ArcadeCareer.backup && window.ArcadeCareer.backup.parseAndValidate) })`);
    assert(api.format === FORMAT, 'window.ArcadeCareer.backup.FORMAT=' + api.format);
    assert(api.hasParse === 'function', 'window.ArcadeCareer.backup.parseAndValidate 缺失');
    return 'loadedScripts[backup.js]=' + backupLoad.detail + ' deferred=' + JSON.stringify(deferred);
  });

  await check('B13 页面无 404：backup.js 返回 200，且普通 #test 页面也不产生 404', async () => {
    const backupResponses = networkResponses.filter((entry) => entry.url.indexOf('/career/backup.js') !== -1);
    assert(backupResponses.length >= 1, '未观察到 backup.js 的网络响应');
    assert(backupResponses.every((entry) => entry.status === 200), 'backup.js 响应状态异常：' + JSON.stringify(backupResponses));
    const notFound = networkResponses.filter((entry) => entry.status === 404 && entry.url.indexOf('favicon.ico') === -1);
    assert(!notFound.length, '页面出现 404：' + JSON.stringify(notFound.slice(0, 5)));
    const consoleErrors = (cdp.errors || []).filter((line) => line.indexOf('404') !== -1 || line.indexOf('backup.js') !== -1);
    assert(!consoleErrors.length, '控制台出现 404/backup.js 错误：' + consoleErrors.slice(0, 3).join(' | '));
    /* 既有 smoke 场景：普通游戏页仅带 #test（无 careerTest），页面同样不得出现 404。 */
    networkResponses.length = 0;
    cdp.errors = [];
    await cdp.navigate(BASE + '/apps/arcade/games/memory-flip.html#test');
    await cdp.waitFor(`document.readyState === 'complete'`, { timeout: 10000 });
    await sleep(1200);
    const silentNotFound = networkResponses.filter((entry) => entry.status === 404 && entry.url.indexOf('favicon.ico') === -1);
    assert(!silentNotFound.length, '普通 #test 页面出现 404：' + JSON.stringify(silentNotFound.slice(0, 5)));
    const silentBackup = networkResponses.filter((entry) => entry.url.indexOf('/career/backup.js') !== -1);
    assert(!silentBackup.length, '普通 #test 页面不应请求延迟依赖 backup.js：' + JSON.stringify(silentBackup));
    return 'careerTest 页 backup.js 200 / #test 页零请求零 404';
  });

  await check('B15 游戏页测试后清理：deleteDatabase 成功', async () => {
    await cdp.navigate(BASE + '/apps/arcade/index.html');
    const cleanup = await deleteDatabaseRaw(cdp);
    assert(cleanup.ok, '游戏页测试后 deleteDatabase 失败：' + JSON.stringify(cleanup));
    return 'cleaned';
  });
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main() {
  const only = (arg('only', '') || '').toUpperCase();
  const runA = !only || only.indexOf('A') !== -1;
  const runB = !only || only.indexOf('B') !== -1;

  [CORE_FILE, DB_FILE, BACKUP_FILE].forEach((file) => {
    if (!fs.existsSync(file)) throw new Error('缺少文件：' + file);
  });

  let server = null;
  let launched = null;
  let cdp = null;
  let hardFailure = false;
  try {
    if (runA) await runNodeChecks();
    if (runB) {
      SERVER_PORT = envPort('CAREER_BACKUP_PORT', Number(arg('port', 8838)) || 8838);
      CDP_PORT = envPort('CAREER_BACKUP_CDP_PORT', Number(arg('cdp-port', 9438)) || 9438);
      BASE = 'http://127.0.0.1:' + SERVER_PORT;
      fs.mkdirSync(ARTIFACTS, { recursive: true });
      server = await startServer({ root: REPO_ROOT, port: SERVER_PORT });
      launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'studiokit-career-backup-' });
      cdp = await openPage({ port: CDP_PORT, ...VIEWPORT, deviceScaleFactor: 1, mobile: true, artifactsDir: ARTIFACTS });
      await cdp.send('Network.enable');
      const networkResponses = [];
      cdp.on('Network.responseReceived', (params) => {
        try {
          networkResponses.push({ url: params.response.url, status: params.response.status });
        } catch (err) {
          /* ignore */
        }
      });
      await cdp.navigate(BASE + '/apps/arcade/index.html');
      const ready = await cdp.evaluate(`({ arcade: !!window.Arcade, title: document.title.indexOf('街机') !== -1 || document.title.length > 0 })`);
      if (!ready.arcade) throw new Error('apps/arcade/index.html 未加载 Arcade 运行时');
      const errorsBefore = cdp.errors.length;
      try {
        await runChromeChecks(cdp);
        await runBridgeLoadChecks(cdp, networkResponses);
      } finally {
        try {
          await cdp.navigate(BASE + '/apps/arcade/index.html');
          await deleteDatabaseRaw(cdp);
        } catch (err) {
          /* 清理尽力而为 */
        }
      }
      const newErrors = cdp.errors.slice(errorsBefore);
      record('B14 注入/事务期间页面控制台无 error', newErrors.length === 0, newErrors.slice(0, 3).join(' | '));
    }
    const result = summary();
    return result.failed ? 1 : 0;
  } catch (err) {
    hardFailure = true;
    console.error('FAIL  环境/装配失败：' + (err && err.stack ? err.stack : err));
    return 2;
  } finally {
    if (cdp) {
      try {
        cdp.close();
      } catch (err) {
        /* ignore */
      }
    }
    if (launched) await stopChrome(launched);
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (hardFailure) console.error('\n0/0 checks passed（装配未完成）');
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('FAIL  ' + (err && err.stack ? err.stack : err));
    process.exit(2);
  });
