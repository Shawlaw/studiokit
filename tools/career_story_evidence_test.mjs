#!/usr/bin/env node
/**
 * Arcade Life 0.17 证据标记门禁（D17-23）：
 * story-evidence 的 token 白名单、收据去重/幂等、C2–C4 多路径解锁、缺证据归因、
 * chapterGate 只读检查、静态边界与确定性。
 *
 * 纯 Node：读仓库真实内容 apps/arcade/career/content/{commissions,items,chapter-01,registry}.json，
 * require 真实 career-core / registry / career-db（career-db 在 Node 下无 IDB 时只返回结构化失败），
 * quests/claims 写入用内存假实现注入（语义对齐 career-db 的公开方法）。
 *
 * 零 npm 依赖；不启动 Chrome、不写仓库文件。
 * 运行：node tools/career_story_evidence_test.mjs
 * 退出码：0 全部通过；1 有失败；2 装配失败（模块/内容读取失败）。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);

const PATHS = {
  storyEvidence: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'story-evidence.js'),
  careerCore: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'career-core.js'),
  registry: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'registry.js'),
  careerDb: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'career-db.js'),
  commissions: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'commissions.json'),
  items: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'items.json'),
  chapter01: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'chapter-01.json'),
  registryContent: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'registry.json'),
};

const NOW = '2026-11-23T04:45:00.000Z';
const CAREER_ID = 'career-d17-23';
const STORY_FLAGS = ['C2.research_complete', 'C3.truth_found', 'C4.city_power_restored'];

let total = 0;
let passed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function eq(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error((label ? label + ': ' : '') + 'expected ' + right + ' got ' + left);
}

function detail(value) {
  if (value === undefined) return '';
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch (err) {
    text = String(value);
  }
  return text && text.length > 220 ? text.slice(0, 220) + '…' : text;
}

async function check(name, fn) {
  total += 1;
  try {
    const info = await fn();
    passed += 1;
    console.log('PASS  ' + name + (info && typeof info === 'string' ? ' — ' + detail(info) : ''));
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    failures.push(name + ': ' + message);
    console.log('FAIL  ' + name + ' — ' + message);
  }
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function sortedStrings(values) {
  return Array.from(new Set(values.map((item) => String(item)))).sort();
}

function setValues(setLike) {
  return Array.from(setLike).sort();
}

/* ------------------------------------------------------------------ *
 * 装配：真实内容与真实模块
 * ------------------------------------------------------------------ */

let MODULE;
let CORE;
let REGISTRY;
let CAREER_DB;
let COMMISSIONS;
let ITEMS;
let CHAPTER1;
let REGISTRY_CONTENT;
let MODULE_SOURCE;
const commissionIndex = new Map();
const itemsById = new Map();

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assembly() {
  MODULE = require(PATHS.storyEvidence);
  CORE = require(PATHS.careerCore);
  REGISTRY = require(PATHS.registry);
  CAREER_DB = require(PATHS.careerDb);
  COMMISSIONS = loadJson(PATHS.commissions).commissions;
  ITEMS = loadJson(PATHS.items);
  CHAPTER1 = loadJson(PATHS.chapter01);
  REGISTRY_CONTENT = loadJson(PATHS.registryContent);
  MODULE_SOURCE = fs.readFileSync(PATHS.storyEvidence, 'utf8');

  assert(Array.isArray(COMMISSIONS) && COMMISSIONS.length === 96, 'commissions.json must contain 96 commissions');
  COMMISSIONS.forEach((commission) => {
    commissionIndex.set(commission.commissionId, commission);
  });
  (ITEMS.materials || []).forEach((material) => itemsById.set(material.itemId, material));
  assert(typeof MODULE.createStoryEvidence === 'function', 'story-evidence must export createStoryEvidence');
  assert(typeof MODULE.configure === 'function', 'singleton must export configure');
}

/* ------------------------------------------------------------------ *
 * 夹具：真实内容收据 / 内存假 career-db
 * ------------------------------------------------------------------ */

function commissionById(commissionId) {
  const commission = commissionIndex.get(commissionId);
  assert(commission, 'unknown commission: ' + commissionId);
  return commission;
}

function makeReceipt(commissionId, overrides) {
  const commission = commissionById(commissionId);
  const reward = commission.reward || {};
  const base = {
    receiptId: 'commission-test-' + commissionId,
    runId: 'commission-test-' + commissionId,
    careerId: CAREER_ID,
    commissionId,
    credits: 0,
    items: {},
    evidence: Array.isArray(reward.evidence) ? reward.evidence.slice() : [],
    flags: Array.isArray(reward.flags) ? reward.flags.slice() : [],
    txIds: [],
    claimedAt: NOW,
    rulesetVersion: 1,
    contentVersion: '0.17.0',
  };
  if (overrides && typeof overrides === 'object') Object.assign(base, overrides);
  return base;
}

function createFakeDb(options) {
  const opts = options || {};
  const state = {
    quests: new Map(),
    claims: new Map(),
    calls: [],
    failures: Object.assign({ read: false, write: false, claim: false, claimThrow: false }, opts.failures || {}),
  };
  function rowKey(careerId, nodeId) {
    return careerId + '\u0000' + nodeId;
  }
  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }
  function allQuests(careerId) {
    return Array.from(state.quests.values())
      .filter((row) => row.careerId === careerId)
      .map(copy);
  }

  const db = {
    state,
    calls: state.calls,
    failures: state.failures,
    count(name) {
      return state.calls.filter((call) => call.name === name).length;
    },
    callNames() {
      return sortedStrings(state.calls.map((call) => call.name));
    },
    allQuests,
    allClaims() {
      return Array.from(state.claims.values()).map(copy);
    },
    seedQuest(row) {
      state.quests.set(rowKey(row.careerId, row.nodeId), copy(row));
      return db;
    },
    seedClaim(row) {
      state.claims.set(row.runId, copy(row));
      return db;
    },
    /** 对齐 career-db.settleAndClaim 的真实写入结果：claim 行 + 委托 quest 行（含 evidence/flags）。 */
    seedSettled(receipt) {
      const runId = receipt.receiptId || receipt.runId;
      const claim = {
        runId,
        schemaVersion: 1,
        receiptId: receipt.receiptId || runId,
        careerId: receipt.careerId,
        commissionId: receipt.commissionId,
        credits: receipt.credits || 0,
        items: receipt.items || {},
        evidence: Array.isArray(receipt.evidence) ? receipt.evidence.slice() : [],
        flags: Array.isArray(receipt.flags) ? receipt.flags.slice() : [],
        txIds: Array.isArray(receipt.txIds) ? receipt.txIds.slice() : [],
        claimedAt: receipt.claimedAt || NOW,
        rulesetVersion: 1,
        contentVersion: '0.17.0',
      };
      state.claims.set(runId, copy(claim));
      if (typeof receipt.commissionId === 'string' && receipt.commissionId) {
        db.seedQuest({
          careerId: receipt.careerId,
          nodeId: receipt.commissionId,
          kind: 'commission',
          status: 'cleared',
          clearedAt: receipt.claimedAt || NOW,
          evidence: claim.evidence.slice(),
          flags: claim.flags.slice(),
          updatedAt: receipt.claimedAt || NOW,
          schemaVersion: 1,
        });
      }
      return claim;
    },
    async getClaim(runId) {
      state.calls.push({ name: 'getClaim', arg: runId === undefined ? null : runId });
      if (state.failures.claimThrow) throw new Error('injected-claim-boom');
      if (state.failures.claim) return null;
      const row = state.claims.get(runId);
      return row ? copy(row) : null;
    },
    async readQuestState(careerId) {
      state.calls.push({ name: 'readQuestState', arg: careerId });
      if (state.failures.read) return { ok: false, reason: 'injected-read-failed', quests: [] };
      const rows = allQuests(careerId);
      const byNode = {};
      rows.forEach((row) => {
        byNode[row.nodeId] = row;
      });
      return { ok: true, careerId, quests: rows, byNode };
    },
    async putQuests(careerId, rows) {
      state.calls.push({ name: 'putQuests', arg: careerId, count: Array.isArray(rows) ? rows.length : 0 });
      if (state.failures.write) return { ok: false, reason: 'injected-write-failed' };
      assert(Array.isArray(rows), 'putQuests rows must be array');
      rows.forEach((row) => {
        const full = copy(row);
        full.careerId = careerId;
        full.schemaVersion = full.schemaVersion || 1;
        full.updatedAt = full.updatedAt || NOW;
        state.quests.set(rowKey(careerId, full.nodeId), full);
      });
      return { ok: true, count: rows.length };
    },
  };
  return db;
}

function freshStory(options) {
  const opts = options || {};
  const se = MODULE.createStoryEvidence({});
  const chapter = opts.additionalChapterRules ? [CHAPTER1, opts.additionalChapterRules] : CHAPTER1;
  const cfg = se.configure({ commissions: COMMISSIONS, items: ITEMS, chapter, now: NOW });
  return { se, cfg };
}

async function recordOne(se, db, commissionId, options) {
  const opts = options || {};
  const receipt = makeReceipt(commissionId, opts.receipt);
  db.seedSettled(receipt);
  return se.recordFromReceipt({ careerId: opts.careerId || CAREER_ID, receipt, db, now: options && options.now ? options.now : NOW });
}

function contextFromDb(se, db, wallet) {
  return se.contextFor({
    quests: db.allQuests(CAREER_ID),
    claims: db.allClaims(),
    wallet: wallet || { credits: 80, items: {} },
  });
}

async function runPath(commissionIds, options) {
  const opts = options || {};
  const { se } = freshStory();
  const db = createFakeDb(opts.dbOptions);
  const results = [];
  for (const commissionId of commissionIds) {
    results.push(await recordOne(se, db, commissionId, opts));
  }
  const ctx = contextFromDb(se, db, opts.wallet);
  return { se, db, results, ctx };
}

/* ------------------------------------------------------------------ *
 * 分组 A：装配 / configure
 * ------------------------------------------------------------------ */

async function groupA() {
  console.log('\n# A. 装配与 configure');

  await check('A01 UMD 面：单例 API、createStoryEvidence、版本', async () => {
    eq(MODULE.VERSION, '0.17.0', 'VERSION');
    eq(MODULE.MODULE_VERSION, '0.17.0', 'MODULE_VERSION');
    eq(MODULE.__storyEvidenceMounted, true, 'mounted');
    for (const name of [
      'configure',
      'tokenFromReceipt',
      'recordFromReceipt',
      'contextFor',
      'storyFlags',
      'storyUnlocked',
      'missingFor',
      'chapterGate',
      'validate',
      'evidenceWhitelist',
      'getDefaultRules',
    ]) {
      assert(typeof MODULE[name] === 'function', 'missing API ' + name);
    }
    return 'UMD API surface';
  });

  await check('A02 浏览器 UMD 挂载：全局 ArcadeCareerStoryEvidence + ArcadeCareer.storyEvidence', async () => {
    const sandbox = { window: {}, console };
    vm.runInNewContext(MODULE_SOURCE, sandbox, { filename: 'story-evidence.js' });
    const globalApi = sandbox.window.ArcadeCareerStoryEvidence;
    assert(globalApi && typeof globalApi.configure === 'function', 'global API missing');
    assert(sandbox.window.ArcadeCareer && sandbox.window.ArcadeCareer.storyEvidence === globalApi, 'mirror missing');
    const instance = globalApi.createStoryEvidence({});
    const cfg = instance.configure({ commissions: COMMISSIONS, items: ITEMS, chapter: CHAPTER1 });
    assert(cfg.ok === true, 'browser instance configure failed');
    return 'global + mirror';
  });

  await check('A03 configure 真实内容：白名单计数、C2–C4 旗标、无警告', async () => {
    const { se, cfg } = freshStory();
    const expectedEvidence = COMMISSIONS.reduce((sum, commission) => {
      return sum + ((commission.reward && Array.isArray(commission.reward.evidence)) ? commission.reward.evidence.length : 0);
    }, 0);
    eq(cfg.ok, true, 'ok');
    eq(cfg.evidenceCount, expectedEvidence, 'evidenceCount');
    assert(expectedEvidence > 0, 'content must declare evidence tokens');
    eq(cfg.flags, STORY_FLAGS, 'story flags');
    eq(cfg.chapters, ['C2', 'C3', 'C4'], 'chapters');
    eq(cfg.errors, [], 'errors');
    eq(cfg.warnings, [], 'warnings');
    eq(se.evidenceWhitelist().length, expectedEvidence, 'whitelist size');
    return 'evidence=' + expectedEvidence;
  });

  await check('A04 configure 接受数组 / 内容对象两种输入', async () => {
    const byArray = freshStory();
    const byArrayCfg = byArray.se.configure({ commissions: COMMISSIONS, items: ITEMS });
    const raw = MODULE.createStoryEvidence({});
    const rawCfg = raw.configure({ contentVersion: '0.17.0', commissions: COMMISSIONS });
    const nested = MODULE.createStoryEvidence({});
    const nestedCfg = nested.configure({ content: { commissions: COMMISSIONS, items: ITEMS } });
    eq([byArrayCfg.ok, rawCfg.ok, nestedCfg.ok], [true, true, true], 'ok');
    eq(
      [byArrayCfg.evidenceCount, rawCfg.evidenceCount, nestedCfg.evidenceCount],
      [byArrayCfg.evidenceCount, byArrayCfg.evidenceCount, byArrayCfg.evidenceCount],
      'counts'
    );
    return 'array/object/nested';
  });

  await check('A05 configure 缺内容：结构化失败且未配置', async () => {
    const se = MODULE.createStoryEvidence({});
    const cfg = se.configure({});
    eq(cfg.ok, false, 'ok');
    eq(cfg.evidenceCount, 0, 'evidenceCount');
    eq(cfg.flags, [], 'flags');
    assert(cfg.errors.indexOf('no-commissions') >= 0, 'errors must include no-commissions');
    eq(se.isConfigured(), false, 'isConfigured');
    const tokens = se.tokenFromReceipt({ evidence: ['E-memory-flip.T2'] });
    eq(tokens.ok, false, 'token ok');
    eq(tokens.reason, 'not-configured', 'reason');
    return 'no-commissions';
  });

  await check('A06 configure 确定性：委托顺序打乱不改变白名单/旗标/签名', async () => {
    const a = MODULE.createStoryEvidence({});
    const b = MODULE.createStoryEvidence({});
    const cfgA = a.configure({ commissions: COMMISSIONS.slice(), items: ITEMS, chapter: CHAPTER1 });
    const reversed = COMMISSIONS.slice().reverse();
    const shuffled = reversed.filter((_, index) => index % 2 === 0).concat(reversed.filter((_, index) => index % 2 === 1));
    const cfgB = b.configure({ commissions: shuffled, items: ITEMS, chapter: CHAPTER1 });
    eq(cfgB.evidenceCount, cfgA.evidenceCount, 'evidenceCount');
    eq(cfgB.flags, cfgA.flags, 'flags');
    eq(JSON.stringify(b.evidenceWhitelist()), JSON.stringify(a.evidenceWhitelist()), 'whitelist');
    eq(JSON.stringify(b.validate().witnesses), JSON.stringify(a.validate().witnesses), 'witnesses');
    return 'order-independent';
  });

  await check('A07 configure 不修改输入内容（深拷贝隔离）', async () => {
    const commissionsBefore = clone(COMMISSIONS);
    const itemsBefore = clone(ITEMS);
    const chapterBefore = clone(CHAPTER1);
    const se = MODULE.createStoryEvidence({});
    se.configure({ commissions: COMMISSIONS, items: ITEMS, chapter: CHAPTER1 });
    eq(COMMISSIONS, commissionsBefore, 'commissions mutated');
    eq(ITEMS, itemsBefore, 'items mutated');
    eq(CHAPTER1, chapterBefore, 'chapter mutated');
    return 'input untouched';
  });

  await check('A08 evidenceWhitelist 只读克隆且按 token 排序', async () => {
    const { se } = freshStory();
    const first = se.evidenceWhitelist();
    const tokens = first.map((entry) => entry.token);
    eq(tokens, tokens.slice().sort(), 'sorted');
    first[0].token = 'E-tampered';
    first.push({ token: 'E-injected' });
    const second = se.evidenceWhitelist();
    assert(second[0].token !== 'E-tampered', 'mutation leaked');
    eq(second.length, tokens.length, 'length stable');
    return 'sorted read-only';
  });

  await check('A09 reset 清空配置', async () => {
    const { se } = freshStory();
    eq(se.isConfigured(), true, 'configured before');
    se.reset();
    eq(se.isConfigured(), false, 'configured after');
    const tokens = se.tokenFromReceipt({ evidence: ['E-memory-flip.T2'] });
    eq(tokens.reason, 'not-configured', 'reason');
    return 'reset';
  });

  await check('A10 章节规则覆盖：内容可替换默认 C2 规则', async () => {
    const { se, cfg } = freshStory({
      additionalChapterRules: {
        chapterId: 'C2',
        storyRules: [
          {
            flag: 'C2.research_complete',
            chapter: 'C2',
            label: '自定义研究规则',
            require: { all: [{ class: 'E', atLeast: 1 }] },
          },
        ],
      },
    });
    eq(cfg.ok, true, 'ok');
    const ctx = se.contextFor({ evidence: ['E-memory-flip.T2'] });
    eq(se.storyUnlocked('C2.research_complete', ctx), true, 'custom rule unlock');
    const other = freshStory();
    const otherCtx = other.se.contextFor({ evidence: ['E-memory-flip.T2'] });
    eq(other.se.storyUnlocked('C2.research_complete', otherCtx), false, 'default rule should need 2 distinct games');
    return 'chapter override';
  });

  await check('A11 非法章节规则：忽略并保留默认规则（警告不抛出）', async () => {
    const { se, cfg } = freshStory({
      additionalChapterRules: {
        chapterId: 'C2',
        storyRules: [{ flag: 'C2.research_complete', require: { all: [{ class: 'NOPE', atLeast: 1 }] } }],
      },
    });
    eq(cfg.ok, true, 'ok');
    assert(cfg.warnings.some((warning) => warning.indexOf('chapter-rule-invalid') === 0), 'warning missing');
    const ctx = se.contextFor({ evidence: ['E-memory-flip.T2'] });
    eq(se.storyUnlocked('C2.research_complete', ctx), false, 'default rule retained');
    return 'invalid rule ignored';
  });
}

/* ------------------------------------------------------------------ *
 * 分组 B：tokenFromReceipt 白名单/前缀/非法
 * ------------------------------------------------------------------ */

async function groupB() {
  console.log('\n# B. tokenFromReceipt 白名单/前缀/非法输入');

  await check('B01 声明过的稳定 token 被接受', async () => {
    const { se } = freshStory();
    const result = se.tokenFromReceipt({ receiptId: 'r-1', evidence: ['E-memory-flip.T2', 'BP-merge-2048.T3'] });
    eq(result.ok, true, 'ok');
    eq(result.tokens, ['E-memory-flip.T2', 'BP-merge-2048.T3'], 'tokens');
    eq(result.rejected, [], 'rejected');
    return '2 tokens';
  });

  await check('B02 伪造 token（结构合法但未声明）被拒绝', async () => {
    const { se } = freshStory();
    const result = se.tokenFromReceipt({ evidence: ['E-not-a-real-token'] });
    eq(result.ok, false, 'ok');
    eq(result.tokens, [], 'tokens');
    eq(result.rejected.length, 1, 'rejected');
    eq(result.rejected[0].reason, 'not-declared', 'reason');
    return 'not-declared';
  });

  await check('B03 非法前缀被拒绝', async () => {
    const { se } = freshStory();
    const result = se.tokenFromReceipt({ evidence: ['X-memory-flip.T2', 'SITE-memory-flip.T2'] });
    eq(result.ok, false, 'ok');
    eq(result.rejected.map((item) => item.reason), ['bad-shape', 'bad-shape'], 'reasons');
    return 'bad prefix';
  });

  await check('B04 缺后缀/小写前缀/尾随空格被拒绝', async () => {
    const { se } = freshStory();
    const result = se.tokenFromReceipt({ evidence: ['E-', 'e-memory-flip.T2', 'E-memory-flip.T2 ', ' E-memory-flip.T2'] });
    eq(result.ok, false, 'ok');
    eq(result.rejected.length, 4, 'rejected count');
    assert(result.rejected.every((item) => item.reason === 'bad-shape'), 'all bad-shape');
    return 'shape guards';
  });

  await check('B05 非字符串条目被拒绝（不信任任意值）', async () => {
    const { se } = freshStory();
    const result = se.tokenFromReceipt({ evidence: [42, null, { token: 'E-memory-flip.T2' }, ['E-memory-flip.T2'], 'E-memory-flip.T2'] });
    eq(result.ok, false, 'ok');
    eq(result.tokens, ['E-memory-flip.T2'], 'only string token accepted');
    eq(result.rejected.filter((item) => item.reason === 'not-a-string').length, 4, 'not-a-string count');
    return 'non-string rejected';
  });

  await check('B06 收据内重复 token：保留一份并标记 duplicate', async () => {
    const { se } = freshStory();
    const result = se.tokenFromReceipt({ evidence: ['E-memory-flip.T2', 'E-memory-flip.T2'] });
    eq(result.ok, false, 'ok');
    eq(result.tokens, ['E-memory-flip.T2'], 'tokens');
    eq(result.rejected[0].reason, 'duplicate', 'reason');
    return 'duplicate';
  });

  await check('B07 超 24 条上限：多余 token 被拒绝但不越界', async () => {
    const { se } = freshStory();
    const allTokens = se.evidenceWhitelist().map((entry) => entry.token);
    assert(allTokens.length > 25, 'need >25 declared tokens');
    const result = se.tokenFromReceipt({ evidence: allTokens.slice(0, 26) });
    eq(result.ok, false, 'ok');
    eq(result.tokens.length, 24, 'accepted cap');
    eq(result.rejected.filter((item) => item.reason === 'over-cap').length, 2, 'over-cap count');
    return 'cap 24';
  });

  await check('B08 无 evidence 字段 = 无 token（不报错）', async () => {
    const { se } = freshStory();
    const result = se.tokenFromReceipt({ receiptId: 'r-2' });
    eq(result.ok, true, 'ok');
    eq(result.tokens, [], 'tokens');
    return 'no evidence';
  });

  await check('B09 收据 flags 不会被当成 token（防止手填旗标/证据）', async () => {
    const { se } = freshStory();
    const result = se.tokenFromReceipt({ receiptId: 'r-3', flags: ['C2.research_complete', 'E-memory-flip.T2'] });
    eq(result.tokens, [], 'flags must not become tokens');
    eq(result.ok, true, 'ok');
    return 'flags ignored';
  });

  await check('B10 settle 结果包裹与 claims 扁平行都能解析', async () => {
    const { se } = freshStory();
    const wrapped = se.tokenFromReceipt({ ok: true, receipt: { evidence: ['E-C1-site'] } });
    const flat = se.tokenFromReceipt({ runId: 'commission-x', evidence: ['E-C1-site'] });
    eq(wrapped.tokens, ['E-C1-site'], 'wrapped');
    eq(flat.tokens, ['E-C1-site'], 'flat');
    return 'wrapper/flat';
  });

  await check('B11 requireDeclared:false 仅放行结构合法 token（诊断开关）', async () => {
    const { se } = freshStory();
    const strict = se.tokenFromReceipt({ evidence: ['E-D17-23-diagnostic'] });
    const lenient = se.tokenFromReceipt({ evidence: ['E-D17-23-diagnostic'] }, { requireDeclared: false });
    eq(strict.ok, false, 'strict');
    eq(lenient.ok, true, 'lenient');
    eq(lenient.tokens, ['E-D17-23-diagnostic'], 'lenient token');
    return 'diagnostic switch';
  });

  await check('B12 tokenFromReceipt 不修改入参', async () => {
    const { se } = freshStory();
    const receipt = { receiptId: 'r-4', evidence: ['E-memory-flip.T2', 'nope'], flags: ['C1.work_done'] };
    const before = clone(receipt);
    se.tokenFromReceipt(receipt);
    eq(receipt, before, 'receipt mutated');
    return 'read-only';
  });

  await check('B13 非法 receipt 形状：结构化失败', async () => {
    const { se } = freshStory();
    eq(se.tokenFromReceipt(null).reason, 'bad-receipt', 'null');
    eq(se.tokenFromReceipt('E-memory-flip.T2').reason, 'bad-receipt', 'string');
    return 'bad receipt';
  });

  await check('B14 evidence 非数组：拒绝并标记 bad-evidence', async () => {
    const { se } = freshStory();
    const result = se.tokenFromReceipt({ evidence: 'E-memory-flip.T2' });
    eq(result.ok, false, 'ok');
    assert(result.rejected.some((item) => item.reason === 'bad-evidence'), 'bad-evidence');
    return 'bad-evidence';
  });
}

/* ------------------------------------------------------------------ *
 * 分组 C：recordFromReceipt 去重/幂等/失败结构化
 * ------------------------------------------------------------------ */

async function groupC() {
  console.log('\n# C. recordFromReceipt 去重、幂等与 DB 失败');

  await check('C01 首次记录：写入收据标记行 + 证据行，零经济发放', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    const result = await recordOne(se, db, 'memory-flip.T2');
    eq(result.ok, true, 'ok');
    eq(result.duplicate, false, 'duplicate');
    eq(result.newTokens, ['E-memory-flip.T2'], 'newTokens');
    eq(result.newFlags, [], 'newFlags');
    eq(result.written, 2, 'written');
    eq(result.claimVerified, true, 'claimVerified');
    eq(result.economy, { credits: 0, items: {} }, 'economy');
    /* 1 行来自 settleAndClaim 的委托 quest 行 + 1 行收据标记 + 1 行证据。 */
    eq(db.allQuests(CAREER_ID).length, 3, 'rows');
    return 'marker+evidence';
  });

  await check('C02 证据行形状：nodeId/kind/status/token/flags/时间戳', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    await recordOne(se, db, 'memory-flip.T2');
    const rows = db.allQuests(CAREER_ID);
    const evidenceRow = rows.filter((row) => row.nodeId === 'evidence:E-memory-flip.T2')[0];
    assert(evidenceRow, 'evidence row missing');
    eq(evidenceRow.kind, 'evidence', 'kind');
    eq(evidenceRow.status, 'cleared', 'status');
    eq(evidenceRow.token, 'E-memory-flip.T2', 'token');
    eq(evidenceRow.evidence, ['E-memory-flip.T2'], 'evidence');
    eq(evidenceRow.flags, [], 'flags');
    eq(evidenceRow.sourceReceipt, 'commission-test-memory-flip.T2', 'sourceReceipt');
    eq(evidenceRow.clearedAt, NOW, 'clearedAt');
    eq(evidenceRow.schemaVersion, 1, 'schemaVersion');
    const marker = rows.filter((row) => row.nodeId === 'receipt:commission-test-memory-flip.T2')[0];
    assert(marker, 'marker row missing');
    eq(marker.kind, 'receipt', 'marker kind');
    eq(marker.status, 'cleared', 'marker status');
    eq([...marker.tokens].sort(), ['E-memory-flip.T2'], 'marker tokens');
    return 'row shape';
  });

  await check('C03 同一 receipt 重复记录：duplicate=true 且零写入', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    const receipt = makeReceipt('memory-flip.T2');
    db.seedSettled(receipt);
    const first = await se.recordFromReceipt({ careerId: CAREER_ID, receipt, db, now: NOW });
    const rowsBefore = db.allQuests(CAREER_ID).length;
    const callsBefore = db.count('putQuests');
    const second = await se.recordFromReceipt({ careerId: CAREER_ID, receipt, db, now: NOW });
    eq(first.ok, true, 'first ok');
    eq(second.ok, true, 'second ok');
    eq(second.duplicate, true, 'duplicate');
    eq(second.written, 0, 'written');
    eq(second.zeroWrite, true, 'zeroWrite');
    eq(db.allQuests(CAREER_ID).length, rowsBefore, 'rows unchanged');
    eq(db.count('putQuests'), callsBefore, 'no extra putQuests');
    return 'idempotent';
  });

  await check('C04 未领奖的收据不能登记证据（receipt-not-claimed，零写入）', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    const receipt = makeReceipt('memory-flip.T2');
    const result = await se.recordFromReceipt({ careerId: CAREER_ID, receipt, db, now: NOW });
    eq(result.ok, false, 'ok');
    eq(result.reason, 'receipt-not-claimed', 'reason');
    eq(db.allQuests(CAREER_ID).length, 0, 'no rows');
    eq(db.count('putQuests'), 0, 'no writes');
    return 'claim required';
  });

  await check('C05 收据新增 claim 之外的 token：receipt-mismatch，零写入', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    const honest = makeReceipt('memory-flip.T2');
    db.seedSettled(honest);
    const forged = makeReceipt('memory-flip.T2', { evidence: ['E-memory-flip.T2', 'E-star-raid.T3'], receiptId: honest.receiptId });
    const result = await se.recordFromReceipt({ careerId: CAREER_ID, receipt: forged, db, now: NOW });
    eq(result.ok, false, 'ok');
    eq(result.reason, 'receipt-mismatch', 'reason');
    eq(db.count('putQuests'), 0, 'no writes');
    eq(db.allQuests(CAREER_ID).filter((row) => row.kind === 'evidence' || row.kind === 'receipt').length, 0, 'no evidence/marker rows');
    return 'forged evidence rejected';
  });

  await check('C06 收据 token 不属于该委托：receipt-mismatch，零写入', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    const receipt = makeReceipt('memory-flip.T2');
    receipt.evidence = ['E-C1-site'];
    db.seedSettled(receipt);
    const result = await se.recordFromReceipt({ careerId: CAREER_ID, receipt, db, now: NOW });
    eq(result.ok, false, 'ok');
    eq(result.reason, 'receipt-mismatch', 'reason');
    eq(db.count('putQuests'), 0, 'no writes');
    return 'commission scope';
  });

  await check('C07 careerId 不匹配：career-mismatch，零写入', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    const receipt = makeReceipt('memory-flip.T2');
    db.seedSettled(receipt);
    const result = await se.recordFromReceipt({ careerId: 'career-other', receipt, db, now: NOW });
    eq(result.ok, false, 'ok');
    eq(result.reason, 'career-mismatch', 'reason');
    eq(db.count('putQuests'), 0, 'no writes');
    eq(db.allQuests('career-other').length, 0, 'no rows for other career');
    eq(db.allQuests(CAREER_ID).filter((row) => row.kind === 'evidence' || row.kind === 'receipt').length, 0, 'no evidence/marker rows');
    return 'career mismatch';
  });

  await check('C08 DB 读失败：db-read-failed，零写入', async () => {
    const { se } = freshStory();
    const db = createFakeDb({ failures: { read: true } });
    const receipt = makeReceipt('memory-flip.T2');
    db.seedSettled(receipt);
    const result = await se.recordFromReceipt({ careerId: CAREER_ID, receipt, db, now: NOW });
    eq(result.ok, false, 'ok');
    eq(result.reason, 'db-read-failed', 'reason');
    eq(db.count('putQuests'), 0, 'no writes');
    return 'read failed';
  });

  await check('C09 DB 写失败：db-write-failed，不谎报成功', async () => {
    const { se } = freshStory();
    const db = createFakeDb({ failures: { write: true } });
    const receipt = makeReceipt('memory-flip.T2');
    db.seedSettled(receipt);
    const result = await se.recordFromReceipt({ careerId: CAREER_ID, receipt, db, now: NOW });
    eq(result.ok, false, 'ok must be false');
    eq(result.reason, 'db-write-failed', 'reason');
    eq(result.wrote, 0, 'wrote');
    assert(result.written === undefined, 'must not report written count on failure');
    assert(result.economy === undefined, 'must not report economy on failure');
    eq(db.allQuests(CAREER_ID).filter((row) => row.kind === 'evidence' || row.kind === 'receipt').length, 0, 'store unchanged');
    return 'write failed structured';
  });

  await check('C10 getClaim 抛异常：db-read-failed（不向调用方抛出）', async () => {
    const { se } = freshStory();
    const db = createFakeDb({ failures: { claimThrow: true } });
    const receipt = makeReceipt('memory-flip.T2');
    const result = await se.recordFromReceipt({ careerId: CAREER_ID, receipt, db, now: NOW });
    eq(result.ok, false, 'ok');
    eq(result.reason, 'db-read-failed', 'reason');
    return 'claim throw';
  });

  await check('C11 无 getClaim 的最小 db：可写但标记 claimVerified=false + 警告', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    const receipt = makeReceipt('memory-flip.T2');
    db.seedSettled(receipt);
    const shim = { readQuestState: db.readQuestState, putQuests: db.putQuests };
    const result = await se.recordFromReceipt({ careerId: CAREER_ID, receipt, db: shim, now: NOW });
    eq(result.ok, true, 'ok');
    eq(result.claimVerified, false, 'claimVerified');
    assert(result.warnings.indexOf('claim-not-verified') >= 0, 'warning missing');
    eq(db.allQuests(CAREER_ID).length, 3, 'rows');
    return 'shim compatibility';
  });

  await check('C12 真实 career-db（Node 无 IDB）：结构化失败且不抛出', async () => {
    const { se } = freshStory();
    const receipt = makeReceipt('memory-flip.T2');
    const claimOnly = { getClaim: async () => clone(receipt), readQuestState: CAREER_DB.readQuestState, putQuests: CAREER_DB.putQuests };
    const result = await se.recordFromReceipt({ careerId: CAREER_ID, receipt, db: claimOnly, now: NOW });
    eq(result.ok, false, 'ok');
    eq(result.reason, 'db-read-failed', 'reason');
    const direct = await se.recordFromReceipt({ careerId: CAREER_ID, receipt, db: CAREER_DB, now: NOW });
    eq(direct.ok, false, 'direct ok');
    assert(direct.reason === 'receipt-not-claimed' || direct.reason === 'db-read-failed', 'structured reason: ' + direct.reason);
    return 'real db structured';
  });

  await check('C13 缺少 db / 非法 careerId：结构化失败', async () => {
    const { se } = freshStory();
    const receipt = makeReceipt('memory-flip.T2');
    eq((await se.recordFromReceipt({ careerId: CAREER_ID, receipt })).reason, 'db-unavailable', 'db');
    eq((await se.recordFromReceipt({ careerId: 'bad career id!', receipt, db: createFakeDb() })).reason, 'bad-career-id', 'careerId');
    eq((await se.recordFromReceipt({ careerId: CAREER_ID, receipt: 'nope', db: createFakeDb() })).reason, 'bad-receipt', 'receipt');
    return 'guards';
  });

  await check('C14 只调用 quests/claims 读取与 putQuests（无经济写入口）', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    await recordOne(se, db, 'memory-flip.T2');
    eq(db.callNames(), ['getClaim', 'putQuests', 'readQuestState'], 'call names');
    eq(db.allClaims().length, 1, 'claims untouched');
    return 'no economy calls';
  });

  await check('C15 并发重复记录同一 receipt：不产生重复行、不重复发旗标', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    const receipt = makeReceipt('memory-flip.T2');
    db.seedSettled(receipt);
    const [first, second] = await Promise.all([
      se.recordFromReceipt({ careerId: CAREER_ID, receipt, db, now: NOW }),
      se.recordFromReceipt({ careerId: CAREER_ID, receipt, db, now: NOW }),
    ]);
    eq([first.ok, second.ok], [true, true], 'both ok');
    const rows = db.allQuests(CAREER_ID);
    const nodeIds = sortedStrings(rows.map((row) => row.nodeId));
    eq(nodeIds, ['evidence:E-memory-flip.T2', 'memory-flip.T2', 'receipt:commission-test-memory-flip.T2'], 'rows');
    eq(new Set(nodeIds).size, nodeIds.length, 'unique nodeIds');
    return 'race idempotent';
  });

  await check('C16 已存在同 token 证据行时，新 receipt 只写标记行且不重复证据', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    const first = makeReceipt('memory-flip.T2', { receiptId: 'commission-repeat-a' });
    const second = makeReceipt('memory-flip.T2', { receiptId: 'commission-repeat-b' });
    db.seedSettled(first);
    db.seedSettled(second);
    await se.recordFromReceipt({ careerId: CAREER_ID, receipt: first, db, now: NOW });
    const result = await se.recordFromReceipt({ careerId: CAREER_ID, receipt: second, db, now: NOW });
    eq(result.ok, true, 'ok');
    eq(result.duplicate, false, 'duplicate');
    eq(result.newTokens, [], 'newTokens');
    eq(result.written, 1, 'marker only');
    const evidenceRows = db.allQuests(CAREER_ID).filter((row) => row.nodeId.indexOf('evidence:') === 0);
    eq(evidenceRows.length, 1, 'single evidence row');
    return 'token-level dedupe';
  });

  await check('C17 零证据收据：首次只写标记行，重复 duplicate', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    const receipt = makeReceipt('memory-flip.T1');
    eq(receipt.evidence, [], 'fixture has no evidence');
    db.seedSettled(receipt);
    const first = await se.recordFromReceipt({ careerId: CAREER_ID, receipt, db, now: NOW });
    const second = await se.recordFromReceipt({ careerId: CAREER_ID, receipt, db, now: NOW });
    eq([first.ok, first.duplicate, first.written], [true, false, 1], 'first');
    eq([second.ok, second.duplicate, second.written], [true, true, 0], 'second');
    const rows = db.allQuests(CAREER_ID);
    eq(rows.filter((row) => row.kind === 'receipt').length, 1, 'marker only written');
    eq(rows.filter((row) => row.kind === 'evidence').length, 0, 'no evidence rows');
    return 'zero-evidence receipt';
  });

  await check('C18 收据/claim 里的剧情旗标不参与授予（只认证据组合）', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    const receipt = makeReceipt('memory-flip.T1', { flags: ['C2.research_complete'] });
    receipt.flags = ['C2.research_complete'];
    db.seedSettled(receipt);
    const result = await se.recordFromReceipt({ careerId: CAREER_ID, receipt, db, now: NOW });
    eq(result.ok, true, 'ok');
    eq(result.newFlags, [], 'no flag from receipt flags');
    eq(result.flags, [], 'no story flag derived without evidence');
    const summary = se.storyFlags({ quests: db.allQuests(CAREER_ID), claims: db.allClaims() });
    eq(summary.flags, [], 'stored forged flag cannot grant');
    assert(summary.storedFlags.indexOf('C2.research_complete') >= 0, 'forged flag is merely observed');
    return 'receipt flags ignored for grants';
  });

  await check('C19 伪造的剧情旗标行不能解锁下游旗标（旗标只由证据组合授予）', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    db.seedQuest({
      careerId: CAREER_ID,
      nodeId: 'story:C3.truth_found',
      kind: 'story-flag',
      status: 'cleared',
      flags: ['C3.truth_found'],
      evidence: [],
    });
    db.seedQuest({
      careerId: CAREER_ID,
      nodeId: 'story:C2.research_complete',
      kind: 'story-flag',
      status: 'cleared',
      flags: ['C2.research_complete'],
      evidence: [],
    });
    const ctx = contextFromDb(se, db);
    eq(ctx.flags.has('C2.research_complete'), false, 'forged C2 not trusted');
    eq(ctx.flags.has('C3.truth_found'), false, 'forged C3 not trusted');
    eq(se.storyUnlocked('C4.city_power_restored', ctx), false, 'C4 not unlocked');
    eq(se.storyFlags({ quests: db.allQuests(CAREER_ID) }).flags, [], 'storyFlags empty');
    return 'forged flags not trusted';
  });

  await check('C20 记录不修改收据对象', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    const receipt = makeReceipt('memory-flip.T2');
    db.seedSettled(receipt);
    const before = clone(receipt);
    await se.recordFromReceipt({ careerId: CAREER_ID, receipt, db, now: NOW });
    eq(receipt, before, 'receipt mutated');
    return 'receipt read-only';
  });
}

/* ------------------------------------------------------------------ *
 * 分组 D：C2/C3/C4 多路径解锁 + 门禁证据
 * ------------------------------------------------------------------ */

const PATH_RESEARCH = ['memory-flip.T2', 'merge-2048.T3', 'gravity-flip.T3'];
const PATH_ENGINEERING = ['solitaire.T3', 'mole-whack.T3', 'block-drop.T3', 'road-rush.T3', 'pendulum-tower.T1'];
const PATH_TRADE = ['blackjack.T3', 'gomoku.T2', 'solitaire.T3', 'memory-flip.T2', 'snowbells.T3'];
const PATH_NARROW = ['pendulum-tower.T1', 'pendulum-tower.T2', 'star-raid.T1', 'star-raid.T2', 'star-raid.T3'];

async function groupD() {
  console.log('\n# D. C2–C4 多路径解锁与门禁');

  const paths = [
    ['D01 研究路径（memory-flip + merge-2048 + gravity-flip）', PATH_RESEARCH],
    ['D02 工程路径（solitaire/mole-whack/block-drop/road-rush/pendulum-tower）', PATH_ENGINEERING],
    ['D03 贸易/非战斗路径（blackjack + gomoku + solitaire + memory-flip + snowbells）', PATH_TRADE],
    ['D04 窄路径（只玩 pendulum-tower + star-raid）', PATH_NARROW],
  ];

  for (const [name, path] of paths) {
    await check(name + ' 解锁 C2→C3→C4', async () => {
      const { se, db, ctx } = await runPath(path);
      eq(ctx.resolvedFlags, STORY_FLAGS, 'resolved flags');
      for (const flag of STORY_FLAGS) {
        eq(se.storyUnlocked(flag, ctx), true, flag);
        eq(se.missingFor(flag, ctx).unlocked, true, flag + ' missingFor');
      }
      const rows = db.allQuests(CAREER_ID);
      eq(rows.filter((row) => row.nodeId.indexOf('evidence:') === 0).length, path.length, 'evidence rows');
      assert(rows.every((row) => row.status === 'cleared'), 'all rows cleared');
      return '3/3 flags';
    });
  }

  await check('D05 多路径证据来源互不依赖（不用同一 gameId 作唯一前置）', async () => {
    const outputs = [];
    for (const path of [PATH_RESEARCH, PATH_ENGINEERING, PATH_TRADE, PATH_NARROW]) {
      const { ctx } = await runPath(path);
      const games = new Set(ctx.evidence.size ? setValues(ctx.evidence).map((token) => tokenGame(token)) : []);
      outputs.push({ flags: ctx.resolvedFlags.slice(), games: sortedStrings(Array.from(games)) });
    }
    outputs.forEach((item) => eq(item.flags, STORY_FLAGS, 'path flags'));
    eq(outputs[0].games, ['gravity-flip', 'memory-flip', 'merge-2048'], 'research games');
    eq(outputs[1].games, ['block-drop', 'mole-whack', 'pendulum-tower', 'road-rush', 'solitaire'], 'engineering games');
    eq(outputs[2].games, ['blackjack', 'gomoku', 'memory-flip', 'snowbells', 'solitaire'], 'trade games');
    eq(outputs[3].games, ['pendulum-tower', 'star-raid'], 'narrow games');
    return '4 independent paths';
  });

  await check('D06 单游戏不足以前置：只有 memory-flip 不解锁 C2，缺证据可归因', async () => {
    const { se, ctx } = await runPath(['memory-flip.T2', 'memory-flip.T4']);
    eq(ctx.resolvedFlags, [], 'no flag');
    eq(se.storyUnlocked('C2.research_complete', ctx), false, 'C2');
    const missing = se.missingFor('C2.research_complete', ctx);
    eq(missing.unlocked, false, 'missingFor');
    assert(missing.missing.length >= 1, 'missing detail');
    const classMissing = missing.missing.filter((item) => item.kind === 'class' && item.class === 'E')[0];
    assert(classMissing, 'E class missing');
    eq(classMissing.have, 1, 'one distinct game only');
    eq(classMissing.need, 1, 'need one more game');
    eq(classMissing.distinctGames, true, 'distinctGames');
    assert(missing.suggestions.length > 0, 'suggestions');
    assert(missing.suggestions.every((token) => token.indexOf('E-') === 0), 'E suggestions');
    return 'single-game counterexample';
  });

  await check('D07 缺 C2 时 C3/C4 的 missing 归因到前置旗标', async () => {
    const { se, ctx } = await runPath(['memory-flip.T2']);
    const missingC3 = se.missingFor('C3.truth_found', ctx);
    const missingC4 = se.missingFor('C4.city_power_restored', ctx);
    eq(missingC3.unlocked, false, 'C3');
    assert(missingC3.missing.some((item) => item.kind === 'flag' && item.flag === 'C2.research_complete'), 'C3 needs C2');
    assert(missingC4.missing.some((item) => item.kind === 'flag' && item.flag === 'C3.truth_found'), 'C4 needs C3');
    return 'causal attribution';
  });

  await check('D08 缺证据时 C2 归因到 E 类数量与候选 token', async () => {
    const { se } = freshStory();
    const missing = se.missingFor('C2.research_complete', se.contextFor({}));
    const classMissing = missing.missing.filter((item) => item.kind === 'class' && item.class === 'E')[0];
    assert(classMissing, 'E missing');
    eq(classMissing.atLeast, 2, 'atLeast');
    eq(classMissing.have, 0, 'have');
    eq(classMissing.need, 2, 'need');
    assert(Array.isArray(classMissing.candidates) && classMissing.candidates.length > 0, 'candidates');
    assert(classMissing.candidates.every((token) => token.indexOf('E-') === 0), 'candidate class');
    return 'attribution detail';
  });

  await check('D09 受 C4 门禁的 MAP 证据不能在 C2 之前生效（防循环）', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    const base = await recordOne(se, db, 'memory-flip.T2');
    eq(base.newFlags, [], 'no flags from one record');
    const gated = await recordOne(se, db, 'star-raid.T5');
    eq(gated.ok, true, 'gated receipt recorded as evidence');
    eq(gated.newTokens, ['MAP-star-raid.T5'], 'token stored');
    eq(gated.newFlags, [], 'no flag from gated evidence');
    const ctx = contextFromDb(se, db);
    eq(ctx.resolvedFlags, [], 'flags remain empty');
    eq(se.storyUnlocked('C2.research_complete', ctx), false, 'C2 still locked');
    const missing = se.missingFor('C2.research_complete', ctx);
    assert(missing.missing.some((item) => item.kind === 'class' && item.class === 'E'), 'E still missing');
    const ungated = await recordOne(se, db, 'star-raid.T1');
    eq(ungated.newFlags.indexOf('C2.research_complete') >= 0, true, 'C2 unlocks from ungated evidence only');
    return 'gate folded';
  });

  await check('D10 逐阶段记录：C2/C3/C4 在该批次内按旗标顺序授予', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    const steps = [];
    for (const commissionId of PATH_NARROW) {
      const result = await recordOne(se, db, commissionId);
      steps.push({ commissionId, newFlags: result.newFlags.slice() });
    }
    eq(steps[0].newFlags, [], 'T1 pendulum no flag');
    eq(steps[1].newFlags, [], 'T2 pendulum no flag');
    eq(steps[2].newFlags, ['C2.research_complete', 'C3.truth_found'], 'star T1 grants C2+C3');
    eq(steps[3].newFlags, [], 'star T2 no flag');
    eq(steps[4].newFlags, ['C4.city_power_restored'], 'star T3 grants C4');
    const flagsOnRows = sortedStrings(
      db
        .allQuests(CAREER_ID)
        .reduce((acc, row) => acc.concat(row.flags || []), [])
        .filter((flag) => /^C[234]\./.test(flag))
    );
    eq(flagsOnRows, STORY_FLAGS, 'story flags persisted on rows');
    return 'staged grants';
  });

  await check('D11 记录顺序不影响最终旗标集合', async () => {
    const forward = await runPath(PATH_TRADE);
    const reversed = await runPath(PATH_TRADE.slice().reverse());
    eq(reversed.ctx.resolvedFlags, forward.ctx.resolvedFlags, 'flags');
    eq(setValues(reversed.ctx.evidence), setValues(forward.ctx.evidence), 'evidence');
    eq(reversed.db.allQuests(CAREER_ID).length, forward.db.allQuests(CAREER_ID).length, 'row count');
    return 'order independent';
  });

  await check('D12 重复委托局（重复工资收据）不会重复授予旗标', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    for (const commissionId of PATH_NARROW) await recordOne(se, db, commissionId);
    const before = se.storyFlags(contextFromDb(se, db)).flags;
    const repeatReceipt = makeReceipt('star-raid.T1', {
      receiptId: 'commission-test-star-raid.T1-repeat',
      evidence: [],
      flags: [],
      credits: 0,
    });
    db.seedSettled(repeatReceipt);
    const result = await se.recordFromReceipt({ careerId: CAREER_ID, receipt: repeatReceipt, db, now: NOW });
    eq(result.ok, true, 'ok');
    eq(result.newFlags, [], 'no new flags');
    const after = se.storyFlags(contextFromDb(se, db)).flags;
    eq(after, before, 'flags unchanged');
    return 'no replay grant';
  });
}

function tokenGame(token) {
  const entry = evidenceEntry(token);
  return entry ? entry.gameId : '?';
}

let whitelistIndex = null;
function evidenceEntry(token) {
  if (!whitelistIndex) {
    const { se } = freshStory();
    whitelistIndex = new Map();
    se.evidenceWhitelist().forEach((entry) => whitelistIndex.set(entry.token, entry));
  }
  return whitelistIndex.get(token);
}

/* ------------------------------------------------------------------ *
 * 分组 E：contextFor / storyFlags / storyUnlocked / missingFor / chapterGate
 * ------------------------------------------------------------------ */

async function groupE() {
  console.log('\n# E. 只读上下文、旗标汇总、chapterGate');

  await check('E01 contextFor 空输入：完整谓词上下文形状', async () => {
    const { se } = freshStory();
    const ctx = se.contextFor({ wallet: { credits: 80, items: { alloy: 1 } } });
    eq(ctx.ok, true, 'ok');
    for (const key of ['capabilities', 'evidence', 'flags', 'cleared']) assert(ctx[key] instanceof Set, key + ' Set');
    assert(ctx.items instanceof Map, 'items Map');
    eq(ctx.credits, 80, 'credits');
    eq(ctx.items.get('alloy'), 1, 'items');
    eq(ctx.resolvedFlags, [], 'resolvedFlags');
    eq(ctx.storedFlags, [], 'storedFlags');
    eq(ctx.derivedFlags, [], 'derivedFlags');
    eq(ctx.readOnly, true, 'readOnly');
    assert(Array.isArray(ctx.snapshot.evidence), 'snapshot evidence');
    return 'shape';
  });

  await check('E02 contextFor 汇总 quests/claims/profile/wallet，并派生 C2', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    await recordOne(se, db, 'pendulum-tower.T1');
    await recordOne(se, db, 'star-raid.T1');
    const ctx = se.contextFor({
      quests: db.allQuests(CAREER_ID),
      claims: db.allClaims(),
      wallet: { credits: 123, items: { alloy: 2, crumb: 1 } },
      profile: { capabilities: ['basic'] },
    });
    assert(ctx.evidence.has('E-C1-site') && ctx.evidence.has('E-C1-patrol'), 'evidence collected');
    assert(ctx.storedFlags.indexOf('C1.work_done') >= 0, 'C1 flag collected');
    assert(ctx.flags.has('C2.research_complete'), 'derived C2');
    assert(ctx.resolvedFlags.indexOf('C2.research_complete') >= 0, 'resolvedFlags');
    /* C2 已在 record 时持久化到证据行 → storedFlags 含 C2，derivedFlags 只列“未持久化”的新旗标。 */
    assert(ctx.storedFlags.indexOf('C2.research_complete') >= 0, 'C2 persisted');
    eq(ctx.derivedFlags, [], 'no pending flags');
    assert(ctx.cleared.has('pendulum-tower.T1') && ctx.cleared.has('star-raid.T1'), 'cleared');
    eq(ctx.credits, 123, 'credits');
    eq(ctx.items.get('alloy'), 2, 'items');
    assert(ctx.capabilities.has('basic'), 'capabilities');
    return 'aggregation';
  });

  await check('E03 contextFor 输出可被 career-core.storyContextFrom 消费（往返稳定）', async () => {
    const { se, ctx } = await runPath(PATH_NARROW);
    const ctx2 = CORE.storyContextFrom(ctx);
    eq(setValues(ctx2.evidence), setValues(ctx.evidence), 'evidence');
    eq(setValues(ctx2.flags), setValues(ctx.flags), 'flags');
    eq(setValues(ctx2.capabilities), setValues(ctx.capabilities), 'capabilities');
    eq(setValues(ctx2.cleared), setValues(ctx.cleared), 'cleared');
    eq(ctx2.credits, ctx.credits, 'credits');
    eq(Array.from(ctx2.items.entries()).sort(), Array.from(ctx.items.entries()).sort(), 'items');
    eq(CORE.resolveStory({ chapterFlag: 'C3.truth_found' }, ctx2), true, 'resolveStory flag');
    eq(CORE.resolveStory({ evidence: 'E-C1-site' }, ctx2), true, 'resolveStory evidence');
    eq(CORE.resolveStory({ chapterFlag: 'C5.star_tower_resolved' }, ctx2), false, 'C5 not granted');
    return 'storyContextFrom round-trip';
  });

  await check('E04 真实 registry 条件：C2 节点与 T4 委托 unlock 条件求值', async () => {
    const { se, ctx } = await runPath(PATH_TRADE);
    const registry = REGISTRY.createRegistry({
      schemaVersion: 1,
      contentVersion: '0.17.0',
      games: REGISTRY_CONTENT.games,
      professions: REGISTRY_CONTENT.professions,
      commissions: [],
      story: {
        schemaVersion: 1,
        nodes: [
          {
            nodeId: 'C2.research',
            chapter: 'C2',
            requires: { all: [{ chapterFlag: 'C2.research_complete' }, { evidence: 'E-blackjack.T3' }] },
            grants: { flags: [] },
          },
          {
            nodeId: 'C4.power',
            chapter: 'C4',
            requires: { all: [{ chapterFlag: 'C3.truth_found' }, { commissionCleared: 'blackjack.T3' }] },
            grants: { flags: [] },
          },
        ],
        edges: [],
      },
    });
    eq(registry.errors, [], 'registry errors');
    const ctx2 = CORE.storyContextFrom(ctx);
    const satisfied = registry.satisfiedStoryNodes(ctx2).map((node) => node.nodeId);
    eq(sortedStrings(satisfied), ['C2.research', 'C4.power'], 'satisfied nodes');
    const t4 = commissionById('blackjack.T4');
    eq(registry.resolveStory(t4.unlock, ctx2), true, 'real T4 unlock condition');
    eq(registry.resolveStory(t4.unlock, CORE.storyContextFrom({ wallet: { credits: 0, items: {} } })), false, 'unmet T4');
    eq(registry.resolveStory({ any: [] }, ctx2), false, 'empty any false');
    eq(registry.resolveStory({ all: [] }, ctx2), true, 'empty all true');
    return 'registry conditions';
  });

  await check('E05 storyFlags() 无参：只读目录汇总', async () => {
    const { se, cfg } = freshStory();
    const summary = se.storyFlags();
    eq(summary.ok, true, 'ok');
    eq(summary.configured, true, 'configured');
    eq(summary.flags, STORY_FLAGS, 'flags');
    eq(summary.chapters, ['C2', 'C3', 'C4'], 'chapters');
    eq(summary.evidenceCount, cfg.evidenceCount, 'evidenceCount');
    eq(summary.rules, 3, 'rules');
    eq(summary.readOnly, true, 'readOnly');
    summary.flags.push('C9.hacked');
    eq(se.storyFlags().flags, STORY_FLAGS, 'mutation leaked');
    return 'catalog';
  });

  await check('E06 storyFlags({quests,claims}) 返回已解锁/缺失/派生信息', async () => {
    const { se, db } = await runPath(PATH_NARROW);
    const summary = se.storyFlags({ quests: db.allQuests(CAREER_ID), claims: db.allClaims() });
    eq(summary.ok, true, 'ok');
    eq(summary.flags, STORY_FLAGS, 'flags');
    eq(summary.unlocked, {
      'C2.research_complete': true,
      'C3.truth_found': true,
      'C4.city_power_restored': true,
    }, 'unlocked');
    eq(summary.missing, {
      'C2.research_complete': [],
      'C3.truth_found': [],
      'C4.city_power_restored': [],
    }, 'missing');
    eq(summary.readOnly, true, 'readOnly');
    assert(summary.tokens.length >= 5, 'tokens');
    return 'storyFlags(input)';
  });

  await check('E07 storyUnlocked 对空/垃圾输入返回 false 且不抛出', async () => {
    const { se } = freshStory();
    const ctx = se.contextFor({});
    eq(se.storyUnlocked('C2.research_complete', ctx), false, 'empty');
    eq(se.storyUnlocked('C2.research_complete'), false, 'no ctx');
    eq(se.storyUnlocked('C9.unknown', ctx), false, 'unknown flag');
    eq(se.storyUnlocked(null, ctx), false, 'null flag');
    eq(se.storyUnlocked('C2.research_complete', 'garbage'), false, 'garbage ctx');
    eq(se.storyUnlocked('C2.research_complete', { evidence: [null, 42], flags: 'nope' }), false, 'junk ctx');
    return 'no throw';
  });

  await check('E08 missingFor 未知旗标 known=false 且可归因', async () => {
    const { se } = freshStory();
    const result = se.missingFor('C9.unknown', se.contextFor({}));
    eq(result.ok, true, 'ok');
    eq(result.known, false, 'known');
    eq(result.unlocked, false, 'unlocked');
    eq(result.missing[0].reason, 'unknown-flag', 'reason');
    return 'unknown flag';
  });

  await check('E09 chapterGate 只读：T4/T5/T6 门禁映射', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    await recordOne(se, db, 'pendulum-tower.T1');
    const ctxPartial = contextFromDb(se, db);
    const gate4 = se.chapterGate(4);
    eq(gate4.ok, true, 'gate4 ok');
    eq(gate4.readOnly, true, 'readOnly');
    eq(gate4.gate, 'C3.truth_found', 'gate4');
    eq(gate4.known, true, 'gate4 known');
    eq(gate4.unlocked, false, 'gate4 no ctx');
    eq(gate4.reason, 'no-context', 'gate4 reason');
    const gate5 = se.chapterGate(5);
    eq(gate5.gate, 'C4.city_power_restored', 'gate5');
    eq(gate5.known, true, 'gate5 known');
    const gate6 = se.chapterGate(6);
    eq(gate6.gate, 'C5.star_tower_resolved', 'gate6');
    eq(gate6.known, false, 'gate6 external');
    eq(gate6.unlocked, false, 'gate6 not unlocked');
    eq(gate6.reason, 'unknown-chapter-gate', 'gate6 reason');
    eq(se.chapterGate(4, ctxPartial).unlocked, false, 'gate4 with partial ctx');
    eq(se.chapterGate(9).reason, 'unknown-tier', 'unknown tier');
    eq(se.chapterGate({ commissionId: 'nope.T4' }).reason, 'missing-commission', 'unknown commission');
    eq(se.chapterGate({ commissionId: 'pendulum-tower.T1' }).reason, 'no-chapter-gate', 'T1 no gate');
    eq(se.chapterGate('not-a-flag').ok, false, 'invalid gate');
    return 'T4/T5/T6 read-only';
  });

  await check('E10 chapterGate 在 C3/C4 解锁后只读放行；C5 永不由本模块放行', async () => {
    const { se, ctx } = await runPath(PATH_NARROW);
    const gate4 = se.chapterGate(4, ctx);
    const gate5 = se.chapterGate(5, ctx);
    eq([gate4.unlocked, gate5.unlocked], [true, true], 'T4/T5 unlocked');
    const forgedCtx = se.contextFor({ flags: ['C5.star_tower_resolved'], evidence: ['DEC-star-raid.T6'] });
    const gate6 = se.chapterGate(6, forgedCtx);
    eq(gate6.unlocked, false, 'C5 cannot be spoofed');
    eq(gate6.reason, 'unknown-chapter-gate', 'C5 reason');
    const byObject = se.chapterGate({ commissionId: 'star-raid.T5' }, ctx);
    eq(byObject.gate, 'C4.city_power_restored', 'object gate');
    eq(byObject.unlocked, true, 'object unlocked');
    return 'gate read-only';
  });

  await check('E11 chapterGate 检查不产生任何 DB 调用或状态变化', async () => {
    const { se, db } = await runPath(PATH_NARROW);
    const rowsBefore = JSON.stringify(db.allQuests(CAREER_ID));
    const callsBefore = db.calls.length;
    se.chapterGate(4);
    se.chapterGate(5);
    se.chapterGate(6);
    se.chapterGate('C3.truth_found');
    eq(JSON.stringify(db.allQuests(CAREER_ID)), rowsBefore, 'rows changed');
    eq(db.calls.length, callsBefore, 'db called');
    return 'pure read';
  });

  await check('E12 证据门禁后仍存入 token 但不提前授予旗标', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    const gated = await recordOne(se, db, 'shadow-leap.T4');
    eq(gated.ok, true, 'ok');
    eq(gated.newTokens, ['MAP-shadow-leap.T4'], 'stored');
    eq(gated.newFlags, [], 'no flags');
    const summary = se.storyFlags({ quests: db.allQuests(CAREER_ID), claims: db.allClaims() });
    eq(summary.flags, [], 'story flags empty');
    assert(summary.tokens.indexOf('MAP-shadow-leap.T4') >= 0, 'token visible in context');
    return 'gated evidence stored, not granting';
  });
}

/* ------------------------------------------------------------------ *
 * 分组 F：validate 静态边界与确定性
 * ------------------------------------------------------------------ */

async function groupF() {
  console.log('\n# F. validate 静态校验与边界');

  await check('F01 真实内容 validate：全部检查通过，仅 C5 外部门禁警告', async () => {
    const { se } = freshStory();
    const report = se.validate();
    eq(report.ok, true, 'ok');
    eq(report.configured, true, 'configured');
    eq(report.checksPassed, report.checksTotal, 'checks');
    eq(report.errors, [], 'errors');
    const outOfScope = report.warnings.filter((warning) => warning.indexOf('gate-out-of-scope') === 0);
    eq(outOfScope, ['gate-out-of-scope:T6=C5.star_tower_resolved'], 'warnings');
    assert(report.checksTotal >= 20, 'checks total');
    return report.checksPassed + '/' + report.checksTotal;
  });

  await check('F02 validate witnesses 是真实可解锁的证据组合', async () => {
    const { se } = freshStory();
    const report = se.validate();
    for (const flag of STORY_FLAGS) {
      const witnessTokens = report.witnesses[flag];
      assert(Array.isArray(witnessTokens) && witnessTokens.length > 0, flag + ' witness');
      const ctx = se.contextFor({ evidence: witnessTokens });
      eq(se.storyUnlocked(flag, ctx), true, flag + ' witness unlock');
    }
    return 'witness sets';
  });

  await check('F03 单游戏依赖反例：单 token 规则被 validate 判 FAIL', async () => {
    const single = MODULE.createStoryEvidence({});
    single.configure({
      commissions: COMMISSIONS,
      items: ITEMS,
      chapter: {
        chapterId: 'C2',
        storyRules: [
          {
            flag: 'C2.research_complete',
            chapter: 'C2',
            require: { all: [{ token: 'E-memory-flip.T2' }] },
          },
        ],
      },
    });
    const report = single.validate();
    eq(report.ok, false, 'ok');
    assert(report.errors.some((error) => error.indexOf('rules-no-single-game') === 0), 'single-game error');
    assert(report.errors.some((error) => error.indexOf('rules-alternatives') === 0), 'alternatives error');
    return report.errors.slice(0, 2).join(' | ');
  });

  await check('F04 validate：重复声明同一证据 token 判 FAIL', async () => {
    const se = MODULE.createStoryEvidence({});
    se.configure({
      commissions: [
        { commissionId: 'a.T1', gameId: 'memory-flip', professionId: 'research.archivist', tier: 1, chapterGate: null, reward: { credits: 0, items: {}, evidence: ['E-a.T1'], flags: [] } },
        { commissionId: 'b.T1', gameId: 'gomoku', professionId: 'intel.tactics', tier: 1, chapterGate: null, reward: { credits: 0, items: {}, evidence: ['E-a.T1'], flags: [] } },
      ],
    });
    const report = se.validate();
    eq(report.ok, false, 'ok');
    assert(report.errors.some((error) => error.indexOf('evidence-unique') === 0), 'evidence-unique error');
    return 'duplicate token rejected';
  });

  await check('F05 validate：内容直写 C2–C4 旗标判 FAIL（只能由证据组合授予）', async () => {
    const se = MODULE.createStoryEvidence({});
    se.configure({
      commissions: [
        {
          commissionId: 'a.T2',
          gameId: 'memory-flip',
          professionId: 'research.archivist',
          tier: 2,
          chapterGate: null,
          reward: { credits: 0, items: {}, evidence: ['E-a.T2'], flags: ['C2.research_complete'] },
        },
      ],
    });
    const report = se.validate();
    eq(report.ok, false, 'ok');
    assert(report.errors.some((error) => error.indexOf('flags-derived-only') === 0), 'flags-derived-only error');
    return 'hand-granted flag rejected';
  });

  await check('F06 validate：证据 token 同时被当可交易物品判 FAIL', async () => {
    const se = MODULE.createStoryEvidence({});
    se.configure({
      commissions: [
        {
          commissionId: 'a.T2',
          gameId: 'memory-flip',
          professionId: 'research.archivist',
          tier: 2,
          chapterGate: null,
          reward: { credits: 0, items: { 'E-a.T2': 1 }, evidence: ['E-a.T2'], flags: [] },
        },
      ],
    });
    const report = se.validate();
    eq(report.ok, false, 'ok');
    assert(report.errors.some((error) => error.indexOf('evidence-not-tradable') === 0), 'evidence-not-tradable error');
    return 'tradable evidence rejected';
  });

  await check('F07 validate：C2–C4 规则依赖 C5 门禁的 DEC 证据判 FAIL', async () => {
    const se = MODULE.createStoryEvidence({});
    se.configure({
      commissions: COMMISSIONS,
      items: ITEMS,
      chapter: {
        chapterId: 'C2',
        storyRules: [
          {
            flag: 'C2.research_complete',
            chapter: 'C2',
            require: { any: [{ class: 'DEC', atLeast: 1 }, { class: 'E', atLeast: 2, distinctGames: true }] },
          },
        ],
      },
    });
    const report = se.validate();
    eq(report.ok, false, 'ok');
    assert(report.errors.some((error) => error.indexOf('rules-no-gated-evidence') === 0), 'gated evidence error');
    return 'gated class rejected';
  });

  await check('F08 validate 未 configure 时结构化失败', async () => {
    const se = MODULE.createStoryEvidence({});
    const report = se.validate();
    eq(report.ok, false, 'ok');
    eq(report.configured, false, 'configured');
    eq(report.errors, ['not-configured'], 'errors');
    eq(report.checksTotal, 1, 'checksTotal');
    return 'not-configured';
  });

  await check('F09 validate 两次调用结果一致（确定性）', async () => {
    const { se } = freshStory();
    const first = se.validate();
    const second = se.validate();
    eq(JSON.stringify(second), JSON.stringify(first), 'validate deterministic');
    return 'deterministic';
  });

  await check('F10 静态边界：模块源码不含 DOM/网络/浏览器存储/经济写入口字面量', async () => {
    const forbidden = [
      'local' + 'Storage',
      'session' + 'Storage',
      'docu' + 'ment.',
      'win' + 'dow.',
      'fet' + 'ch(',
      'XMLHttp' + 'Request',
      'indexed' + 'DB',
      'settle' + 'AndClaim',
      'pu' + 'rchase(',
      'sell' + 'Items(',
      '.del' + 'ete(',
      'ArcadeCareer.' + 'db',
    ];
    const hits = forbidden.filter((literal) => MODULE_SOURCE.indexOf(literal) >= 0);
    eq(hits, [], 'forbidden literals');
    return 'source clean';
  });

  await check('F11 API 面不含经济写方法', async () => {
    const economy = Object.keys(MODULE).filter((name) => /(purchase|sell|settle|grant|ledger|balance|wallet)/i.test(name));
    eq(economy, [], 'economy methods');
    assert(typeof MODULE.createStoryEvidence === 'function', 'factory');
    return 'no economy surface';
  });

  await check('F12 validate static-boundaries 检查项通过', async () => {
    const { se } = freshStory();
    const report = se.validate();
    const boundary = report.checks.filter((item) => item.id === 'static-boundaries')[0];
    assert(boundary, 'static-boundaries check missing');
    eq(boundary.ok, true, 'static-boundaries');
    const guard = report.checks.filter((item) => item.id === 'receipt-token-guard')[0];
    assert(guard && guard.ok === true, 'receipt-token-guard');
    return 'runtime boundary checks';
  });

  await check('F13 validate 的 chapter gates 汇总为 T4/T5/T6（每阶唯一）', async () => {
    const { se } = freshStory();
    const report = se.validate();
    eq(report.gates[4], ['C3.truth_found'], 'T4 gate');
    eq(report.gates[5], ['C4.city_power_restored'], 'T5 gate');
    eq(report.gates[6], ['C5.star_tower_resolved'], 'T6 gate');
    return 'gate summary';
  });

  await check('F14 validate：规则旗标循环依赖判 FAIL', async () => {
    const se = MODULE.createStoryEvidence({});
    se.configure({
      commissions: COMMISSIONS,
      items: ITEMS,
      chapter: {
        chapterId: 'C2',
        storyRules: [
          { flag: 'C2.research_complete', chapter: 'C2', require: { any: [{ class: 'E', atLeast: 2, distinctGames: true }, { flag: 'C3.truth_found' }] } },
          { flag: 'C3.truth_found', chapter: 'C3', require: { any: [{ class: 'E', atLeast: 3 }, { flag: 'C2.research_complete' }] } },
        ],
      },
    });
    const report = se.validate();
    eq(report.ok, false, 'ok');
    assert(report.errors.some((error) => error.indexOf('rules-acyclic') === 0), 'cycle error');
    return 'cycle rejected';
  });

  await check('F15 不读写经典分数/进度/局内档（职业证据与经典记录隔离）', async () => {
    const forbiddenKeys = [
      'studiokit:arcade:runs:v1',
      'studiokit:arcade:meta:v1',
      'studiokit:arcade:scores:v1',
      'studiokit:arcade:progress:v1',
      'A.Progress',
      'A.Scores',
      'GameMeta',
      'RunSave',
      'recordPlay',
    ];
    const hits = forbiddenKeys.filter((key) => MODULE_SOURCE.indexOf(key) >= 0);
    eq(hits, [], 'classic storage references');
    return 'career-only reads';
  });
}

/* ------------------------------------------------------------------ *
 * 分组 G：整体确定性 / 回归
 * ------------------------------------------------------------------ */

async function groupG() {
  console.log('\n# G. 确定性与整体回归');

  await check('G01 两个全新实例对同内容产生相同 validate 报告', async () => {
    const first = freshStory().se.validate();
    const second = freshStory().se.validate();
    eq(JSON.stringify(second), JSON.stringify(first), 'reports equal');
    return 'stable';
  });

  await check('G02 相同收据序列产生相同结果与相同 quests', async () => {
    const first = await runPath(PATH_NARROW);
    const second = await runPath(PATH_NARROW);
    eq(JSON.stringify(second.results), JSON.stringify(first.results), 'results');
    eq(JSON.stringify(second.db.allQuests(CAREER_ID)), JSON.stringify(first.db.allQuests(CAREER_ID)), 'quests');
    return 'stable records';
  });

  await check('G03 contextFor 对同一输入产生相同 snapshot', async () => {
    const first = await runPath(PATH_TRADE);
    const a = first.se.contextFor({ quests: first.db.allQuests(CAREER_ID), claims: first.db.allClaims(), wallet: { credits: 80 } });
    const b = first.se.contextFor({ quests: first.db.allQuests(CAREER_ID), claims: first.db.allClaims(), wallet: { credits: 80 } });
    eq(JSON.stringify(b.snapshot), JSON.stringify(a.snapshot), 'snapshot');
    return 'stable context';
  });

  await check('G04 getDefaultRules 返回默认规则副本（不共享可变状态）', async () => {
    const { se } = freshStory();
    const rules = se.getDefaultRules();
    eq(rules.map((rule) => rule.flag), STORY_FLAGS, 'flags');
    rules[0].require = { all: [] };
    eq(se.getDefaultRules()[0].require.any.length, 3, 'mutation leaked');
    const ctx = se.contextFor({});
    eq(se.storyUnlocked('C2.research_complete', ctx), false, 'default rules intact');
    return 'rules copy';
  });

  await check('G05 证据行只增不删（不可消耗）', async () => {
    const { se, db } = await runPath(PATH_RESEARCH);
    const before = db.allQuests(CAREER_ID).filter((row) => row.nodeId.indexOf('evidence:') === 0).map((row) => row.nodeId);
    await recordOne(se, db, 'star-raid.T1');
    const after = db.allQuests(CAREER_ID).filter((row) => row.nodeId.indexOf('evidence:') === 0).map((row) => row.nodeId);
    assert(after.length > before.length, 'new evidence appended');
    assert(before.every((nodeId) => after.indexOf(nodeId) >= 0), 'old evidence still present');
    assert(se.storyUnlocked('C4.city_power_restored', contextFromDb(se, db)), 'flags remain');
    return 'append-only';
  });

  await check('G06 本章证据不被跨生涯污染：不同 careerId 各自去重', async () => {
    const { se } = freshStory();
    const db = createFakeDb();
    const receiptA = makeReceipt('memory-flip.T2', { careerId: CAREER_ID });
    db.seedSettled(receiptA);
    await se.recordFromReceipt({ careerId: CAREER_ID, receipt: receiptA, db, now: NOW });
    const receiptB = makeReceipt('memory-flip.T2', { careerId: 'career-other', receiptId: 'commission-test-other' });
    db.seedSettled(receiptB);
    const resultB = await se.recordFromReceipt({ careerId: 'career-other', receipt: receiptB, db, now: NOW });
    eq(resultB.ok, true, 'other career ok');
    eq(resultB.newTokens, ['E-memory-flip.T2'], 'own evidence row');
    const rowsA = db.allQuests(CAREER_ID).filter((row) => row.nodeId.indexOf('evidence:') === 0).length;
    const rowsB = db.allQuests('career-other').filter((row) => row.nodeId.indexOf('evidence:') === 0).length;
    eq([rowsA, rowsB], [1, 1], 'per-career rows');
    return 'career scoped';
  });
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

async function main() {
  try {
    assembly();
  } catch (err) {
    console.error('FAIL  装配失败：' + (err && err.stack ? err.stack : err));
    console.error('\n0/0 checks passed（装配未完成）');
    return 2;
  }

  await groupA();
  await groupB();
  await groupC();
  await groupD();
  await groupE();
  await groupF();
  await groupG();

  const failed = failures.length;
  console.log('');
  if (failed === 0) {
    console.log('PASS: ' + passed + '/' + total + ' checks passed');
    return 0;
  }
  console.log('FAIL: ' + passed + '/' + total + ' checks passed');
  failures.forEach((item, index) => console.log('  ' + (index + 1) + '. ' + item));
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('FAIL  ' + (err && err.stack ? err.stack : err));
    console.error('\n0/0 checks passed（装配未完成）');
    process.exit(2);
  });
