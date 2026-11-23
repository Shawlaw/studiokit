#!/usr/bin/env node
/**
 * D17-22 契约测试：职业等级与订单选择（纯 Node，不需要 Chrome）
 *
 * 覆盖：
 * - 真实 0.17 内容：16 职业 × 6 委托（96 条）全部可配置/可校验，T1–T6 齐备；
 * - 等级阈值冻结：cleared 0/1/2 → 学徒，3/4/5 → 熟练，6 → 专家（各职业域同一阈值）；
 * - quests/claims 混合计数：commissionId vs nodeId、claim 的 receipt 嵌套、数组/映射、
 *   去重、未 cleared、story/alternative 行、别的职业、未知 ID、坏行都不计数；
 * - 多职业并存：profile 一次返回全部职业的独立等级/进度/证据数；
 * - orderOptions：订单分组/外观/路线标签只随等级解锁，冻结键集合，绝不返回
 *   倍率/加成/奖励/自动通关字段；
 * - 人为坏内容：缺委托、重复 tier、重复 ID、坏 tier/gameId/professionId、
 *   坏 registry 都报错而不抛异常；
 * - 未来插拔：合成第 17 游戏 + 第 17/18 职业（职业跨游戏、同游戏多职业）可插拔，
 *   不硬编码 16 / 96；
 * - 确定性：同一输入重复调用同结果、输入不被修改、实例隔离、无时钟/随机数。
 *
 * 运行：node tools/career_professions_test.mjs
 * 退出码：0 = 全 PASS；1 = 有 FAIL；2 = 使用错误（本脚本不接受参数）。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

if (process.argv.slice(2).length > 0) {
  console.error('usage: node tools/career_professions_test.mjs（不接受参数）');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const MODULE_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'professions.js');
const COMMISSIONS_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'commissions.json');
const REGISTRY_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'registry.json');

const MODULE_SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');
const professions = require(MODULE_PATH);
const CONTENT = JSON.parse(fs.readFileSync(COMMISSIONS_PATH, 'utf8'));
const REGISTRY = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
const REAL = CONTENT.commissions;
const REGISTRY_PROFESSIONS = new Map(REGISTRY.professions.map((p) => [p.professionId, p]));

/* ---------------------------------------------------------------- 断言/工具 */

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? '' : detail === undefined ? '' : String(detail) });
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'expected ' + e + ' got ' + a);
}
function checkEq(name, actual, expected) {
  check(name, actual === expected, 'expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual));
}
function eqKeys(name, actual, expected) {
  const keys = Object.keys(actual).sort();
  const want = expected.slice().sort();
  check(name, JSON.stringify(keys) === JSON.stringify(want), 'expected keys ' + JSON.stringify(want) + ' got ' + JSON.stringify(keys));
}
function includesText(name, haystack, needle) {
  check(name, Array.isArray(haystack) && haystack.some((item) => String(item).indexOf(needle) >= 0), 'missing ' + JSON.stringify(needle) + ' in ' + JSON.stringify(haystack));
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function quest(id, extra) {
  return Object.assign({ nodeId: id, kind: 'commission', status: 'cleared' }, extra || {});
}
function claim(id, extra) {
  return Object.assign({ commissionId: id }, extra || {});
}
function commissionsOf(professionId) {
  return REAL.filter((c) => c.professionId === professionId).slice().sort((a, b) => a.tier - b.tier);
}
function commissionIdsOf(professionId) {
  return commissionsOf(professionId).map((c) => c.commissionId);
}
function metaOf(professionId) {
  return REGISTRY_PROFESSIONS.get(professionId);
}
function fresh() {
  return professions.create();
}
function configuredReal() {
  const instance = fresh();
  const result = instance.configure({ commissions: REAL, registry: REGISTRY });
  return { instance, result };
}

const REAL_PROFESSION_IDS = Array.from(REGISTRY_PROFESSIONS.keys()).sort();
const REAL_GAME_IDS = REGISTRY.games.map((g) => g.gameId).slice().sort();
const FORBIDDEN_KEY_RE = /(multiplier|bonus|boost|reward|payout|salary|credit|score|\bxp\b|auto|instant|grant|\bwin\b)/i;
const FORBIDDEN_TEXT = ['倍率', '加成', '自动通关', '自动完成', '一键通关'];

function scanForbiddenKeys(value, trail, hits) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenKeys(item, trail + '[' + index + ']', hits));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.keys(value).forEach((key) => {
    if (FORBIDDEN_KEY_RE.test(key)) hits.push(trail + '.' + key);
    scanForbiddenKeys(value[key], trail + '.' + key, hits);
  });
}

/* ---------------------------------------------------------------- A 静态边界 */

{
  check('A01 Node require 返回 API', !!professions && typeof professions === 'object');
  ['configure', 'progress', 'profile', 'orderOptions', 'validate', 'reset', 'create'].forEach((name) => {
    check('A02 module.' + name + ' 是函数', typeof professions[name] === 'function');
  });

  eq('A03 LEVELS 精确冻结值', professions.LEVELS, [
    { level: 1, id: 'apprentice', name: '学徒' },
    { level: 2, id: 'veteran', name: '熟练' },
    { level: 3, id: 'expert', name: '专家' },
  ]);
  check('A04 LEVELS/条目均 Object.freeze', Object.isFrozen(professions.LEVELS) && professions.LEVELS.every((item) => Object.isFrozen(item)));
  eq('A05 THRESHOLDS 精确冻结值', professions.THRESHOLDS, { apprentice: 0, veteran: 3, expert: 6 });
  check('A06 THRESHOLDS 冻结', Object.isFrozen(professions.THRESHOLDS));

  check(
    'A07 无 DOM/IDB/网络/宿主存储',
    !/(document\.|indexedDB|XMLHttpRequest|fetch\s*\(|localStorage|sessionStorage|navigator\.)/.test(MODULE_SOURCE),
    'source touched DOM/IDB/network/storage'
  );
  check('A08 无时钟/随机数（等级不按时间）', !/\bDate\b|Math\.random|performance\.now/.test(MODULE_SOURCE), 'source has clock/random');
  check('A09 不读取 score / 分数', !/\.score\b|['"]score['"]/.test(MODULE_SOURCE), 'source reads score');
  check('A10 无写库/写存储调用', !/\.put\s*\(|\.add\s*\(|\.delete\s*\(|indexedDB/.test(MODULE_SOURCE), 'source writes a store');
  check('A11 无 require（纯 UMD 自包含）', !/\brequire\s*\(/.test(MODULE_SOURCE), 'source requires another module');
  check('A12 UMD 暴露两个浏览器全局名', MODULE_SOURCE.includes('ArcadeCareerProfessions') && MODULE_SOURCE.includes('career.professions'), 'UMD globals missing');

  /* 在伪造的浏览器 window 中执行同一份源码，验证双全局与可用性。 */
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(MODULE_SOURCE, sandbox, { filename: 'professions.js' });
  const browserApi = sandbox.window.ArcadeCareerProfessions;
  check('A13 window.ArcadeCareerProfessions 已挂载', !!browserApi && typeof browserApi === 'object');
  check(
    'A14 window.ArcadeCareer.professions 与主全局同一对象',
    !!sandbox.window.ArcadeCareer && browserApi === sandbox.window.ArcadeCareer.professions
  );
  const browserConfig = browserApi.configure({ commissions: REAL, registry: REGISTRY });
  check('A15 浏览器全局实例可 configure', browserConfig.ok === true && browserConfig.professionCount === 16, JSON.stringify(browserConfig));
  const browserProgress = browserApi.progress({ professionId: 'engineering.structural', quests: [quest('pendulum-tower.T1')] });
  eq('A16 浏览器全局实例可 progress', browserProgress, { level: 1, clearedCount: 1, maxTier: 1, nextThreshold: 3 });
  check('A17 Node require 不污染 globalThis', typeof globalThis.ArcadeCareerProfessions === 'undefined', 'Node require leaked a browser global');
}

/* ---------------------------------------------------------------- B 真实内容 */

{
  const configured = configuredReal();
  const P = configured.instance;
  eq('B01 configure 真实内容返回', configured.result, { ok: true, professionCount: 16, errors: [] });

  const wrapper = fresh().configure({ commissions: CONTENT, registry: REGISTRY });
  eq('B02 configure 接受内容包 {commissions}', wrapper, { ok: true, professionCount: 16, errors: [] });

  const registryInstance = fresh().configure({
    commissions: REAL,
    registry: { listProfessions: () => clone(REGISTRY.professions) },
  });
  eq('B03 configure 接受 registry 实例（listProfessions）', registryInstance, { ok: true, professionCount: 16, errors: [] });

  const bridgePayload = fresh().configure({ items: {}, commissions: REAL, chapter: {} });
  eq('B03b configure 接受 bridge 装载 payload（无 registry）', bridgePayload, { ok: true, professionCount: 16, errors: [] });
  const fallbackProfession = fresh();
  fallbackProfession.configure({ commissions: REAL });
  const fallbackRow = fallbackProfession.profile().professions.find((row) => row.professionId === 'research.archivist');
  eq('B03c 无 registry 时 displayName 回退 professionId', fallbackRow.displayName, 'research.archivist');
  eq('B03d 无 registry 时 domain 由 professionId 推导', fallbackRow.domain, 'research');

  eq('B04 真实内容恰有 16 职业', REAL_PROFESSION_IDS.length, 16);
  eq('B05 真实内容恰有 16 游戏', REAL_GAME_IDS.length, 16);
  eq('B06 真实内容恰有 96 委托', REAL.length, 96);
  check(
    'B07 每职业每 tier 恰好一条',
    REAL_PROFESSION_IDS.every((id) => {
      const rows = commissionsOf(id);
      return rows.length === 6 && rows.every((row, index) => row.tier === index + 1);
    }),
    JSON.stringify(REAL_PROFESSION_IDS.filter((id) => commissionsOf(id).length !== 6))
  );

  const realValidate = P.validate({ commissions: REAL, registry: REGISTRY });
  eq('B08 validate 真实内容仅四字段之外全通过', { ok: realValidate.ok, errors: realValidate.errors, warnings: realValidate.warnings }, { ok: true, errors: [], warnings: [] });
  checkEq('B09 validate professionCount=16', realValidate.professionCount, 16);
  checkEq('B10 validate commissionCount=96', realValidate.commissionCount, 96);
  eqKeys('B11 validate 返回键集合冻结', realValidate, ['ok', 'errors', 'warnings', 'professionCount', 'commissionCount']);

  let allOptionsOk = true;
  let allTiersOk = true;
  let allNamesOk = true;
  let allCountsOk = true;
  REAL_PROFESSION_IDS.forEach((professionId) => {
    const options = P.orderOptions({ professionId });
    const expectedIds = commissionIdsOf(professionId);
    const actualIds = options.ok ? options.orders.map((order) => order.commissionId) : [];
    const meta = metaOf(professionId);
    if (!options.ok || options.orders.length !== 6) allOptionsOk = false;
    if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) allCountsOk = false;
    if (options.orders.some((order, index) => order.tier !== index + 1)) allTiersOk = false;
    if (options.displayName !== meta.displayName || options.domain !== meta.domain) allNamesOk = false;
  });
  check('B12 16 职业 orderOptions 均 ok 且各 6 单', allOptionsOk);
  check('B13 16 职业订单委托 ID 与内容逐一对应且按 tier 排序', allCountsOk);
  check('B14 16 职业订单 tier 1..6 连续', allTiersOk);
  check('B15 16 职业 displayName/domain 与 registry 一致', allNamesOk);

  const noArgValidate = P.validate();
  check('B16 configure 后 validate() 无参可自检', noArgValidate.ok === true && noArgValidate.commissionCount === 96 && noArgValidate.professionCount === 16, JSON.stringify(noArgValidate));

  const bad = fresh().configure({ commissions: [{ commissionId: 'x.T1' }] });
  check('B17 坏内容 configure 失败返回 ok:false', bad.ok === false && bad.errors.length > 0, JSON.stringify(bad));
  const restored = fresh();
  restored.configure({ commissions: [{ commissionId: 'x.T1' }] });
  const restoredResult = restored.configure({ commissions: REAL, registry: REGISTRY });
  eq('B18 可重新 configure 恢复真实内容', restoredResult, { ok: true, professionCount: 16, errors: [] });
}

/* ---------------------------------------------------------------- C 等级阈值 */

{
  const P = configuredReal().instance;
  const structuralIds = commissionIdsOf('engineering.structural');
  const cases = [
    { n: 0, level: 1, maxTier: 0, next: 3 },
    { n: 1, level: 1, maxTier: 1, next: 3 },
    { n: 2, level: 1, maxTier: 2, next: 3 },
    { n: 3, level: 2, maxTier: 3, next: 6 },
    { n: 4, level: 2, maxTier: 4, next: 6 },
    { n: 5, level: 2, maxTier: 5, next: 6 },
    { n: 6, level: 3, maxTier: 6, next: null },
  ];
  cases.forEach((testCase) => {
    const questRows = structuralIds.slice(0, testCase.n).map((id) => quest(id));
    eq(
      'C01 阈值 cleared=' + testCase.n,
      P.progress({ professionId: 'engineering.structural', quests: questRows, claims: [] }),
      { level: testCase.level, clearedCount: testCase.n, maxTier: testCase.maxTier, nextThreshold: testCase.next }
    );
  });

  eq('C02 空输入默认学徒', P.progress({ professionId: 'engineering.structural' }), {
    level: 1,
    clearedCount: 0,
    maxTier: 0,
    nextThreshold: 3,
  });

  const allSix = REAL_PROFESSION_IDS.every((professionId) => {
    const rows = commissionIdsOf(professionId).map((id) => quest(id));
    const result = P.progress({ professionId, quests: rows, claims: [] });
    return result.level === 3 && result.clearedCount === 6 && result.maxTier === 6 && result.nextThreshold === null;
  });
  check('C03 16 职业全部 6 清 → 专家', allSix);

  const domainSame = ['research.archivist', 'engineering.structural', 'nature.miner', 'adventure.pilot'].every((professionId) => {
    const ids = commissionIdsOf(professionId).slice(0, 3);
    return P.progress({ professionId, quests: ids.map((id) => quest(id)) }).level === 2;
  });
  check('C04 阈值跨职业域一致（不按域微调）', domainSame);

  const claimsOnly3 = P.progress({
    professionId: 'research.archivist',
    claims: commissionIdsOf('research.archivist').slice(0, 3).map((id) => claim(id)),
  });
  const claimsOnly6 = P.progress({
    professionId: 'research.archivist',
    claims: commissionIdsOf('research.archivist').map((id) => claim(id)),
  });
  eq('C05 claims-only 3 条 → 熟练', claimsOnly3, { level: 2, clearedCount: 3, maxTier: 3, nextThreshold: 6 });
  eq('C06 claims-only 6 条 → 专家', claimsOnly6, { level: 3, clearedCount: 6, maxTier: 6, nextThreshold: null });

  eqKeys('C07 progress 返回键冻结（仅四字段）', P.progress({ professionId: 'research.archivist' }), ['level', 'clearedCount', 'maxTier', 'nextThreshold']);
  eq(
    'C08 nextThreshold 阶梯',
    cases.map((testCase) => P.progress({ professionId: 'engineering.structural', quests: structuralIds.slice(0, testCase.n).map((id) => quest(id)) }).nextThreshold),
    [3, 3, 3, 6, 6, 6, null]
  );

  eq('C09 未知职业默认学徒且不抛异常', P.progress({ professionId: 'ghost.prof', quests: [quest('pendulum-tower.T1')] }), {
    level: 1,
    clearedCount: 0,
    maxTier: 0,
    nextThreshold: 3,
  });
  eq('C10 无参 progress 不抛异常', P.progress(), { level: 1, clearedCount: 0, maxTier: 0, nextThreshold: 3 });
  eq('C11 非法输入 progress 不抛异常', P.progress('nope'), { level: 1, clearedCount: 0, maxTier: 0, nextThreshold: 3 });
}

/* ---------------------------------------------------------------- D quests/claims 混合 */

{
  const P = configuredReal().instance;
  const archivistIds = commissionIdsOf('research.archivist');

  const d01 = P.progress({ professionId: 'research.archivist', quests: [quest(archivistIds[0])] });
  eq('D01 nodeId-only cleared 行计数', { level: d01.level, cleared: d01.clearedCount, maxTier: d01.maxTier }, { level: 1, cleared: 1, maxTier: 1 });

  const d02 = P.progress({ professionId: 'research.archivist', quests: [{ commissionId: archivistIds[1], status: 'cleared' }] });
  eq('D02 无 kind 的 commissionId 行也计数', { cleared: d02.clearedCount, maxTier: d02.maxTier }, { cleared: 1, maxTier: 2 });

  const d03 = P.progress({ professionId: 'research.archivist', quests: [quest(archivistIds[2], { kind: 'story' })] });
  eq('D03 story 行即使 nodeId 撞委托也不计数', d03.clearedCount, 0);

  const d04 = P.progress({ professionId: 'research.archivist', claims: [claim(archivistIds[0])] });
  eq('D04 claim 行计数', { cleared: d04.clearedCount, maxTier: d04.maxTier }, { cleared: 1, maxTier: 1 });

  const d05 = P.progress({
    professionId: 'research.archivist',
    claims: [{ receipt: { commissionId: archivistIds[1] } }],
  });
  eq('D05 claim.receipt.commissionId 嵌套计数', { cleared: d05.clearedCount, maxTier: d05.maxTier }, { cleared: 1, maxTier: 2 });

  const d06 = P.progress({
    professionId: 'research.archivist',
    quests: [quest(archivistIds[0])],
    claims: [claim(archivistIds[0])],
  });
  eq('D06 quest+claim 同一委托只计一次', { cleared: d06.clearedCount, maxTier: d06.maxTier }, { cleared: 1, maxTier: 1 });

  const d07 = P.progress({
    professionId: 'research.archivist',
    quests: [quest(archivistIds[0]), quest(archivistIds[0]), quest(archivistIds[0])],
  });
  eq('D07 重复 quest 行去重', d07.clearedCount, 1);

  const d08 = P.progress({
    professionId: 'research.archivist',
    claims: [claim(archivistIds[0]), claim(archivistIds[0]), claim(archivistIds[0])],
  });
  eq('D08 重复 claim 行去重', d08.clearedCount, 1);

  const d09 = P.progress({
    professionId: 'research.archivist',
    quests: [
      quest(archivistIds[0], { status: 'active' }),
      quest(archivistIds[1], { status: 'failed' }),
      quest(archivistIds[2], { status: 'abandoned' }),
      quest(archivistIds[3], { status: 'pending' }),
      { nodeId: archivistIds[4], kind: 'commission', clearedAt: '2999-01-01T00:00:00.000Z' },
    ],
  });
  eq('D09 未 cleared 不计数（含只有 clearedAt 的行）', d09.clearedCount, 0);

  const d10 = P.progress({
    professionId: 'research.archivist',
    quests: [quest('C2.story.found'), quest('pendulum-tower.T1'), quest('ghost.commission.T1')],
    claims: [claim('memory-flip.unknown')],
  });
  eq('D10 未知 ID / 别的职业委托不计入', d10.clearedCount, 0);

  const d11 = P.progress({
    professionId: 'research.archivist',
    claims: [claim(commissionIdsOf('intel.risk')[0])],
  });
  eq('D11 别的职业的 claim 不计入', d11.clearedCount, 0);

  const d12 = P.progress({
    professionId: 'research.archivist',
    quests: [null, 'x', 42, [], {}],
    claims: [null, 'y', 7, []],
  });
  eq('D12 坏行/空行不计数也不抛异常', d12.clearedCount, 0);

  const d13 = P.progress({
    professionId: 'research.archivist',
    quests: {
      'memory-flip.T1': quest(archivistIds[0]),
      'memory-flip.T2': quest(archivistIds[1]),
    },
  });
  eq('D13 quests 按 byNode 映射读取', d13.clearedCount, 2);

  const d14 = P.progress({
    professionId: 'research.archivist',
    claims: { run1: claim(archivistIds[0]), run2: claim(archivistIds[1]) },
  });
  eq('D14 claims 按 runId 映射读取', d14.clearedCount, 2);

  const d15 = P.progress({
    professionId: 'research.archivist',
    quests: [quest(archivistIds[0]), quest(archivistIds[1])],
    claims: [claim(archivistIds[2]), claim(archivistIds[1])],
  });
  eq('D15 quests+claims 混合去重计数', { cleared: d15.clearedCount, maxTier: d15.maxTier, level: d15.level }, { cleared: 3, maxTier: 3, level: 2 });

  const d16 = P.progress({
    professionId: 'research.archivist',
    claims: [claim(archivistIds[1]), claim(archivistIds[3])],
  });
  eq('D16 非连续 tier 仍按真实 cleared 统计', { cleared: d16.clearedCount, maxTier: d16.maxTier, level: d16.level }, { cleared: 2, maxTier: 4, level: 1 });

  const d17 = P.progress({ professionId: 'research.archivist', claims: [{ runId: 'r1' }, { receipt: {} }] });
  eq('D17 无 commissionId 的 claim 忽略', d17.clearedCount, 0);

  const baseline = P.progress({ professionId: 'research.archivist', quests: [quest(archivistIds[0]), quest(archivistIds[1]), quest(archivistIds[2])] });
  const noisy = P.progress({
    professionId: 'research.archivist',
    quests: [
      quest(archivistIds[0], { score: 999999, credits: 999999, stats: { score: 999999 } }),
      quest(archivistIds[1], { clearedAt: '2999-01-01T00:00:00.000Z', durationMs: 1 }),
      quest(archivistIds[2], { score: 0, time: 0 }),
    ],
  });
  eq('D18 分数/时间/金额字段不改变等级', noisy, baseline);

  const scoreOnly = P.progress({
    professionId: 'research.archivist',
    quests: [{ nodeId: archivistIds[0], score: 999999, credits: 999999, stats: { score: 999999 } }],
  });
  eq('D19 只有分数没有 cleared 不升级', scoreOnly.level, 1);
  eq('D20 只有分数没有 cleared 计数为 0', scoreOnly.clearedCount, 0);
}

/* ---------------------------------------------------------------- E profile（多职业并存） */

{
  const P = configuredReal().instance;
  const archivistIds = commissionIdsOf('research.archivist');
  const structuralIds = commissionIdsOf('engineering.structural');
  const minerIds = commissionIdsOf('nature.miner');
  const quests = [
    ...archivistIds.slice(0, 2).map((id) => quest(id)),
    ...structuralIds.slice(0, 3).map((id) => quest(id)),
    ...minerIds.map((id) => quest(id)),
  ];
  const prof = P.profile({ quests, claims: [], wallet: { credits: 1234 } });

  eqKeys('E01 profile 顶层键集合', prof, ['ok', 'professionCount', 'professions', 'totals', 'wallet']);
  checkEq('E02 profile professionCount', prof.professionCount, 16);
  eq('E03 profile 职业按 professionId 稳定排序', prof.professions.map((row) => row.professionId), REAL_PROFESSION_IDS.slice().sort());
  eqKeys('E04 profile 单职业条目键集合', prof.professions[0], [
    'professionId',
    'displayName',
    'domain',
    'level',
    'levelId',
    'levelName',
    'clearedCount',
    'maxTier',
    'nextThreshold',
    'missingToNext',
    'commissionCount',
    'evidenceCount',
  ]);
  const byId = new Map(prof.professions.map((row) => [row.professionId, row]));
  eq('E05 档案分析员 2 清 → 学徒', { level: byId.get('research.archivist').level, cleared: byId.get('research.archivist').clearedCount, maxTier: byId.get('research.archivist').maxTier }, { level: 1, cleared: 2, maxTier: 2 });
  eq('E06 建筑工程师 3 清 → 熟练', { level: byId.get('engineering.structural').level, cleared: byId.get('engineering.structural').clearedCount, next: byId.get('engineering.structural').nextThreshold }, { level: 2, cleared: 3, next: 6 });
  eq('E07 采矿员 6 清 → 专家', { level: byId.get('nature.miner').level, cleared: byId.get('nature.miner').clearedCount, maxTier: byId.get('nature.miner').maxTier, next: byId.get('nature.miner').nextThreshold }, { level: 3, cleared: 6, maxTier: 6, next: null });
  eq('E08 其余职业独立保持学徒', byId.get('intel.risk').level, 1);
  eq('E09 totals 汇总', prof.totals, { apprentice: 14, veteran: 1, expert: 1, cleared: 11 });
  eq('E10 钱包只读展示 credits', prof.wallet, { credits: 1234 });
  eq('E11 单职业 commissionCount', byId.get('research.archivist').commissionCount, 6);
  eq('E12 missingToNext 由阈值推导', byId.get('research.archivist').missingToNext, 1);
  eq('E13 专家 missingToNext=0', byId.get('engineering.structural').missingToNext, 3);
  check('E14 displayName/domain 来自 registry', prof.professions.every((row) => row.displayName === metaOf(row.professionId).displayName && row.domain === metaOf(row.professionId).domain));

  const richWallet = P.profile({ quests, claims: [], wallet: { credits: 1000000 } });
  eq('E15 巨额钱包不改变任何等级', richWallet.professions.map((row) => row.level), prof.professions.map((row) => row.level));
  eq('E16 巨额钱包不改变计数', richWallet.totals, prof.totals);
  const invalidWallet = P.profile({ quests, claims: [], wallet: { credits: -5 } });
  eq('E17 负钱包显示归 0', invalidWallet.wallet.credits, 0);
  eq('E18 null 钱包显示 0', P.profile({ quests, claims: [], wallet: null }).wallet.credits, 0);
  eq('E19 非法钱包显示 0', P.profile({ quests, claims: [], wallet: 'oops' }).wallet.credits, 0);

  const evidenceQuests = [
    quest(archivistIds[0], { evidence: ['E-a', 'E-b', 'E-a'] }),
    quest(archivistIds[1], { evidence: ['E-b'] }),
    quest(archivistIds[2], { status: 'active', evidence: ['E-ignored'] }),
    quest('C2.story.found', { kind: 'story', evidence: ['E-story'] }),
  ];
  const evidenceClaims = [
    claim(archivistIds[1], { evidence: ['E-b', 'E-c'] }),
    claim(archivistIds[2], { receipt: { commissionId: archivistIds[2], evidence: ['E-d'] } }),
    claim(archivistIds[3], { evidence: ['E-e', 42, 'bad token!', ''] }),
  ];
  const evidenceProf = P.profile({ quests: evidenceQuests, claims: evidenceClaims });
  const evidenceRow = evidenceProf.professions.find((row) => row.professionId === 'research.archivist');
  eq('E20 证据 token 去重计数（quests+claims+receipt）', evidenceRow.evidenceCount, 5);
  const noEvidenceQuests = evidenceQuests.map((row) => {
    const copy = Object.assign({}, row);
    delete copy.evidence;
    return copy;
  });
  const noEvidenceClaims = evidenceClaims.map((row) => {
    const copy = Object.assign({}, row);
    delete copy.evidence;
    if (copy.receipt) copy.receipt = Object.assign({}, copy.receipt);
    if (copy.receipt) delete copy.receipt.evidence;
    return copy;
  });
  const noEvidenceRow = P.profile({ quests: noEvidenceQuests, claims: noEvidenceClaims }).professions.find(
    (row) => row.professionId === 'research.archivist'
  );
  eq(
    'E21 证据数不影响等级/进度',
    { level: evidenceRow.level, cleared: evidenceRow.clearedCount, maxTier: evidenceRow.maxTier },
    { level: noEvidenceRow.level, cleared: noEvidenceRow.clearedCount, maxTier: noEvidenceRow.maxTier }
  );
  eq('E22 证据数为 0 时仍按 cleared 计数', noEvidenceRow.evidenceCount, 0);

  const unconfigured = fresh().profile({ quests: [], claims: [], wallet: { credits: 5 } });
  check('E23 未 configure 的 profile 结构化失败', unconfigured.ok === false && unconfigured.reason === 'content-missing', JSON.stringify(unconfigured));
  eq('E24 未 configure 时职业为空', unconfigured.professions, []);
  eq('E25 未 configure 时 totals 归零', unconfigured.totals, { apprentice: 0, veteran: 0, expert: 0, cleared: 0 });

  const before = JSON.stringify({ quests, claims: [] });
  P.profile({ quests, claims: [], wallet: { credits: 9 } });
  eq('E26 profile 不修改输入', { quests, claims: [] }, JSON.parse(before));
}

/* ---------------------------------------------------------------- F orderOptions（无加成字段） */

{
  const P = configuredReal().instance;
  const structuralIds = commissionIdsOf('engineering.structural');

  const apprentice = P.orderOptions({ professionId: 'engineering.structural' });
  eqKeys('F01 orderOptions 顶层键冻结', apprentice, [
    'ok',
    'professionId',
    'displayName',
    'domain',
    'level',
    'levelId',
    'levelName',
    'clearedCount',
    'nextThreshold',
    'orders',
    'appearances',
    'routes',
    'display',
  ]);
  eqKeys('F02 order 条目键冻结', apprentice.orders[0], ['commissionId', 'tier', 'title', 'group', 'state']);
  eqKeys('F03 appearance 条目键冻结', apprentice.appearances[0], ['appearanceId', 'name', 'minLevel', 'unlocked']);
  eqKeys('F04 route 条目键冻结', apprentice.routes[0], ['routeId', 'label', 'minLevel', 'unlocked', 'note']);
  eqKeys('F05 display 键冻结', apprentice.display, ['headline', 'progressText', 'nextText']);
  checkEq('F06 未 cleared 学徒 level=1', apprentice.level, 1);
  eq('F07 学徒分组：T1-T2 可选、T3-T6 锁定', apprentice.orders.map((order) => order.state), ['available', 'available', 'locked', 'locked', 'locked', 'locked']);
  eq('F08 分组 id 按 tier 冻结', apprentice.orders.map((order) => order.group), ['apprentice', 'apprentice', 'veteran', 'veteran', 'expert', 'expert']);
  eq('F09 学徒外观解锁状态', apprentice.appearances.map((item) => item.unlocked), [true, false, false]);
  eq('F10 学徒路线解锁状态', apprentice.routes.map((item) => item.unlocked), [true, false, false]);
  check('F11 学徒 headline 含职业与等级', apprentice.display.headline.includes('建筑工程师') && apprentice.display.headline.includes('学徒'), apprentice.display.headline);
  eq('F12 学徒进度文本', apprentice.display.progressText, '已交差 0/6 条委托');

  const veteran = P.orderOptions({ professionId: 'engineering.structural', quests: structuralIds.slice(0, 3).map((id) => quest(id)) });
  eq('F13 3 清 → 熟练', veteran.level, 2);
  eq('F14 熟练订单状态', veteran.orders.map((order) => order.state), ['cleared', 'cleared', 'cleared', 'available', 'locked', 'locked']);
  eq('F15 熟练外观解锁', veteran.appearances.map((item) => item.unlocked), [true, true, false]);
  eq('F16 熟练路线解锁', veteran.routes.map((item) => item.unlocked), [true, true, false]);
  eq('F17 熟练 nextThreshold=6', veteran.nextThreshold, 6);
  check('F18 熟练 nextText 指向专家', veteran.display.nextText.includes('专家'), veteran.display.nextText);

  const expert = P.orderOptions({ professionId: 'engineering.structural', quests: structuralIds.map((id) => quest(id)) });
  eq('F19 6 清 → 专家', expert.level, 3);
  eq('F20 专家订单全部 cleared', expert.orders.map((order) => order.state), ['cleared', 'cleared', 'cleared', 'cleared', 'cleared', 'cleared']);
  eq('F21 专家外观全部解锁', expert.appearances.map((item) => item.unlocked), [true, true, true]);
  eq('F22 专家路线全部解锁', expert.routes.map((item) => item.unlocked), [true, true, true]);
  eq('F23 专家 nextThreshold=null', expert.nextThreshold, null);
  check('F24 专家 nextText 显示已达专家', expert.display.nextText.includes('专家'), expert.display.nextText);

  const hits = [];
  scanForbiddenKeys(expert, 'orderOptions', hits);
  eq('F25 递归无倍率/加成/奖励/自动字段', hits, []);
  const serialized = JSON.stringify(expert);
  eq('F26 文本无加成/自动通关字样', FORBIDDEN_TEXT.filter((word) => serialized.includes(word)), []);
  eq('F27 不返回游戏内数值字段（credits/reward/score）', ['credits', 'reward', 'score', 'items'].filter((key) => Object.prototype.hasOwnProperty.call(expert, key)), []);

  eq('F28 未知职业结构化失败', P.orderOptions({ professionId: 'ghost.prof' }), {
    ok: false,
    reason: 'unknown-profession',
    professionId: 'ghost.prof',
  });
  eq('F29 空职业 ID 结构化失败', P.orderOptions({ professionId: '' }), { ok: false, reason: 'bad-profession-id', professionId: null });
  eq('F30 非法职业 ID 结构化失败', P.orderOptions({ professionId: 42 }), { ok: false, reason: 'bad-profession-id', professionId: null });
  eq('F31 未 configure 结构化失败', fresh().orderOptions({ professionId: 'engineering.structural' }), {
    ok: false,
    reason: 'content-missing',
    professionId: 'engineering.structural',
  });
  check('F32 无参 orderOptions 不抛异常', fresh().orderOptions().ok === false);

  const again = P.orderOptions({ professionId: 'engineering.structural', quests: structuralIds.slice(0, 3).map((id) => quest(id)) });
  eq('F33 orderOptions 确定性（重复调用同结果）', again, veteran);

  const apprenticeIds = apprentice.orders.map((order) => order.commissionId);
  const expertIds = expert.orders.map((order) => order.commissionId);
  eq('F34 等级不改变订单集合（只改可选状态）', expertIds, apprenticeIds);
  eq('F35 等级不修改 title 等展示内容', expert.orders.map((order) => order.title), apprentice.orders.map((order) => order.title));

  const inputQuests = structuralIds.slice(0, 3).map((id) => quest(id));
  const before = JSON.stringify(inputQuests);
  P.orderOptions({ professionId: 'engineering.structural', quests: inputQuests });
  eq('F36 orderOptions 不修改输入', inputQuests, JSON.parse(before));

  const flatIds = apprentice.orders.map((order) => order.commissionId);
  eq('F37 订单按 tier 稳定排序', flatIds, structuralIds);
}

/* ---------------------------------------------------------------- G 人为坏内容 */

{
  const P = fresh();

  eq('G01 configure(null) 报缺失', { ok: P.configure(null).ok, count: P.configure(null).professionCount }, { ok: false, count: 0 });
  check('G02 configure(null) errors 含 commissions-missing', P.configure(null).errors.includes('commissions-missing'), JSON.stringify(P.configure(null).errors));
  check('G03 configure({}) errors 含 commissions-missing', P.configure({}).errors.includes('commissions-missing'), JSON.stringify(P.configure({}).errors));
  check('G04 configure 空数组 errors 含 commissions-empty', P.configure({ commissions: [] }).errors.includes('commissions-empty'), JSON.stringify(P.configure({ commissions: [] }).errors));
  check('G05 configure 非数组 errors 含 commissions-missing', P.configure({ commissions: 'nope' }).errors.includes('commissions-missing'), JSON.stringify(P.configure({ commissions: 'nope' }).errors));
  check(
    'G06 configure 坏 registry errors 含 registry:professions-missing',
    P.configure({ commissions: REAL, registry: { professions: 'nope' } }).errors.includes('registry:professions-missing'),
    JSON.stringify(P.configure({ commissions: REAL, registry: { professions: 'nope' } }).errors)
  );
  check(
    'G07 configure 重复 registry 职业报错',
    P.configure({
      commissions: REAL,
      registry: { professions: [REGISTRY.professions[0], REGISTRY.professions[0]] },
    }).errors.some((error) => error.includes('registry:duplicate-profession')),
    JSON.stringify(P.configure({ commissions: REAL, registry: { professions: [REGISTRY.professions[0], REGISTRY.professions[0]] } }).errors)
  );
  check(
    'G08 configure 坏 registry 条目报错',
    P.configure({ commissions: REAL, registry: { professions: [null, 'bad', { professionId: '' }] } }).errors.some((error) => error.includes('registry:bad-profession')),
    JSON.stringify(P.configure({ commissions: REAL, registry: { professions: [null, 'bad', { professionId: '' }] } }).errors)
  );

  const badRecords = [
    null,
    { commissionId: 'fail.T1', professionId: 'ghost.prof', gameId: 'bad-game', tier: 1, title: '未知职业' },
    { commissionId: 'fail.T2', professionId: 'research.archivist', gameId: 'memory-flip', tier: 7 },
    { commissionId: 'fail.T3', professionId: 'research.archivist', gameId: 'memory-flip', tier: '1' },
    { commissionId: 'fail.T4', professionId: 'research.archivist', gameId: 'memory-flip', tier: 2, title: '可用行' },
    { commissionId: 'fail.T4', professionId: 'research.archivist', gameId: 'memory-flip', tier: 3, title: '重复 ID' },
    { professionId: 'research.archivist', gameId: 'memory-flip', tier: 1, title: '缺 ID' },
    { commissionId: 'fail.T5', gameId: 'memory-flip', tier: 1, title: '缺职业' },
    { commissionId: 'fail.T6', professionId: 'research.archivist', tier: 1, title: '缺游戏' },
  ];
  const badConfigure = P.configure({ commissions: badRecords, registry: REGISTRY });
  check('G09 坏内容 configure 不抛异常且 ok:false', badConfigure.ok === false && Array.isArray(badConfigure.errors), JSON.stringify(badConfigure));
  includesText('G10 记录非对象报错', badConfigure.errors, 'not-object');
  includesText('G11 坏 commissionId 报错', badConfigure.errors, 'bad-commissionId');
  includesText('G12 坏 professionId 报错', badConfigure.errors, 'bad-professionId');
  includesText('G13 坏 gameId 报错', badConfigure.errors, 'bad-gameId');
  includesText('G14 坏 tier 报错', badConfigure.errors, 'bad-tier');
  includesText('G15 重复 commissionId 报错', badConfigure.errors, 'duplicate-commissionId');
  includesText('G16 未知职业报错', badConfigure.errors, 'unknown-profession');
  const failOpen = P.orderOptions({ professionId: 'research.archivist' });
  check('G17 坏内容中仍保留合法行（fail-open）', failOpen.ok === true && failOpen.orders.length === 1 && failOpen.orders[0].commissionId === 'fail.T4', JSON.stringify(failOpen).slice(0, 200));

  /* validate：逐类坏内容都要能归因，且不改输入。 */
  const fromReal = () => ({ commissions: clone(REAL), registry: clone(REGISTRY) });

  {
    const bundle = fromReal();
    const structural = bundle.commissions.filter((c) => c.professionId === 'engineering.structural');
    const removeId = structural[structural.length - 1].commissionId;
    bundle.commissions = bundle.commissions.filter((c) => c.commissionId !== removeId);
    const report = P.validate(bundle);
    check('G18 缺一条委托 → ok:false', report.ok === false);
    includesText('G19 缺一条委托 → expected-6-found-5', report.errors, 'expected-6-found-5');
    includesText('G20 缺一条委托 → missing-tier-6', report.errors, 'missing-tier-6');
  }

  {
    const bundle = fromReal();
    const target = bundle.commissions.find((c) => c.professionId === 'engineering.structural' && c.tier === 2);
    target.tier = 1;
    const report = P.validate(bundle);
    includesText('G21 重复 tier → duplicate-tier-1', report.errors, 'duplicate-tier-1');
    includesText('G22 重复 tier → missing-tier-2', report.errors, 'missing-tier-2');
  }

  {
    const bundle = fromReal();
    const target = bundle.commissions.find((c) => c.commissionId === 'pendulum-tower.T1');
    bundle.commissions.push(Object.assign({}, target));
    const report = P.validate(bundle);
    includesText('G23 重复 commissionId → duplicate-commissionId', report.errors, 'duplicate-commissionId');
    checkEq('G24 重复 commissionId 只接受一次（不重复计数）', report.commissionCount, 96);
  }

  {
    const bundle = fromReal();
    bundle.commissions.push({ commissionId: 'ghost.T1', gameId: 'memory-flip', professionId: 'ghost.prof', tier: 1, title: '幽灵' });
    const report = P.validate(bundle);
    includesText('G25 未知职业 → unknown-profession', report.errors, 'unknown-profession');
    includesText('G26 未知职业 → expected-6-found-1', report.errors, 'profession ghost.prof:expected-6-found-1');
  }

  {
    const bundle = fromReal();
    bundle.commissions.find((c) => c.commissionId === 'pendulum-tower.T1').gameId = 42;
    includesText('G27 坏 gameId 报错', P.validate(bundle).errors, 'bad-gameId');
  }

  {
    const bundle = fromReal();
    bundle.commissions.find((c) => c.commissionId === 'pendulum-tower.T1').tier = 0;
    bundle.commissions.find((c) => c.commissionId === 'pendulum-tower.T2').tier = 7;
    bundle.commissions.find((c) => c.commissionId === 'pendulum-tower.T3').tier = '3';
    const report = P.validate(bundle);
    includesText('G28 tier 0/7/字符串 全部报 bad-tier', report.errors, 'bad-tier');
    checkEq('G29 非法 tier 记录不进入 commissionCount', report.commissionCount, 93);
  }

  {
    const bundle = fromReal();
    bundle.commissions.push(null);
    bundle.commissions.push({ professionId: 'research.archivist', gameId: 'memory-flip', tier: 1 });
    const report = P.validate(bundle);
    includesText('G30 非对象记录报错', report.errors, 'not-object');
    includesText('G31 缺 commissionId 报错', report.errors, 'bad-commissionId');
  }

  {
    const bundle = fromReal();
    bundle.commissions.push({ commissionId: 'bad.T0', professionId: 'research.archivist', gameId: 'memory-flip', tier: 0, title: '坏 tier' });
    const snapshot = JSON.stringify(bundle);
    const before = JSON.stringify(bundle);
    const report = P.validate(bundle);
    eq('G32 validate 不修改输入', JSON.stringify(bundle), before);
    check('G33 validate 坏内容 ok:false 且 errors 非空', report.ok === false && report.errors.length > 0);
    eq('G34 坏内容快照不变', JSON.stringify(bundle), snapshot);
  }

  eq('G35 validate 非对象参数 → bad-input', P.validate('nope'), {
    ok: false,
    errors: ['bad-input'],
    warnings: [],
    professionCount: 0,
    commissionCount: 0,
  });
  includesText('G36 validate 缺 commissions 报错', fresh().validate({ commissions: null, registry: clone(REGISTRY) }).errors, 'commissions-missing');
  includesText('G37 validate 空 commissions 报错', P.validate({ commissions: [], registry: clone(REGISTRY) }).errors, 'commissions-empty');

  {
    const report = P.validate({ commissions: clone(REAL) });
    check('G38 无 registry 时仅覆盖校验并告警', report.ok === true && report.warnings.includes('registry-missing'), JSON.stringify(report));
    checkEq('G39 无 registry 时 professionCount 从内容推导', report.professionCount, 16);
  }

  {
    const report = P.validate({
      commissions: clone(REAL),
      registry: { professions: [null, { professionId: 'research.archivist' }, { professionId: 'research.archivist' }] },
    });
    includesText('G40 坏 registry 条目报错', report.errors, 'registry:bad-profession');
    includesText('G41 重复 registry 职业报错', report.errors, 'registry:duplicate-profession');
  }

  eq('G42 validate 真实内容坏前快照比对仍可通过', P.validate({ commissions: clone(REAL), registry: clone(REGISTRY) }).ok, true);
}

/* ---------------------------------------------------------------- H 未来插拔（第 17 游戏/职业） */

function syntheticBundle() {
  const registry = clone(REGISTRY);
  const commissions = clone(REAL);

  registry.games.push({
    gameId: 'virtual-observatory',
    displayName: '虚拟天文台',
    adapterVersion: 1,
    discoverable: false,
    clueRef: 'CL-virtual-observatory',
    professions: ['science.astronomer', 'service.guide'],
    capabilities: [],
    watch: [{ kind: 'star.logged', payload: { n: 'number' }, modes: ['classic'] }],
  });
  registry.professions.push(
    { professionId: 'science.astronomer', displayName: '星际制图师', domain: 'science', capabilities: [] },
    { professionId: 'service.guide', displayName: '观星向导', domain: 'service', capabilities: [] }
  );

  for (let tier = 1; tier <= 3; tier += 1) {
    commissions.push({
      commissionId: 'virtual-observatory.ast.T' + tier,
      gameId: 'virtual-observatory',
      professionId: 'science.astronomer',
      tier,
      title: '星图工单 ' + tier,
    });
  }
  for (let tier = 4; tier <= 6; tier += 1) {
    commissions.push({
      commissionId: 'memory-flip.ast.T' + tier,
      gameId: 'memory-flip',
      professionId: 'science.astronomer',
      tier,
      title: '星图工单 ' + tier,
    });
  }
  for (let tier = 1; tier <= 6; tier += 1) {
    commissions.push({
      commissionId: 'virtual-observatory.T' + tier,
      gameId: 'virtual-observatory',
      professionId: 'service.guide',
      tier,
      title: '观星班次 ' + tier,
    });
  }

  return { commissions, registry, commissionsContent: { contentVersion: '0.18.0', commissions } };
}

{
  const synthetic = syntheticBundle();
  const P = fresh();
  const configured = P.configure({ commissions: synthetic.commissionsContent, registry: synthetic.registry });
  eq('H01 合成内容 configure ok，扩展为 18 职业', configured, { ok: true, professionCount: 18, errors: [] });

  const report = P.validate({ commissions: synthetic.commissionsContent, registry: synthetic.registry });
  eq('H02 合成内容 validate 全通过', { ok: report.ok, errors: report.errors, warnings: report.warnings }, { ok: true, errors: [], warnings: [] });
  checkEq('H03 合成内容 professionCount=18', report.professionCount, 18);
  checkEq('H04 合成内容 commissionCount=108', report.commissionCount, 108);

  const oldOk = REAL_PROFESSION_IDS.every((professionId) => {
    const options = P.orderOptions({ professionId });
    return options.ok === true && options.orders.length === 6;
  });
  check('H05 旧 16 职业在合成内容下不受影响', oldOk);

  const astronomer = P.orderOptions({ professionId: 'science.astronomer' });
  check('H06 第 17 职业可查询订单选项', astronomer.ok === true && astronomer.orders.length === 6, JSON.stringify(astronomer).slice(0, 200));
  eq('H07 第 17 职业展示名来自新 registry', { displayName: astronomer.displayName, domain: astronomer.domain }, { displayName: '星际制图师', domain: 'science' });
  eq('H08 第 17 职业订单 tier 1..6', astronomer.orders.map((order) => order.tier), [1, 2, 3, 4, 5, 6]);
  eq(
    'H09 第 17 职业可跨游戏（委托 ID 前缀来自两款游戏）',
    Array.from(new Set(astronomer.orders.map((order) => order.commissionId.split('.')[0]))).sort(),
    ['memory-flip', 'virtual-observatory']
  );

  const guide = P.orderOptions({ professionId: 'service.guide' });
  check('H10 同一新游戏允许两个职业', guide.ok === true && guide.orders.length === 6, JSON.stringify(guide).slice(0, 160));
  eq('H11 已登记职业数不等于硬编码 16', configured.professionCount === 18 && report.professionCount === 18, true);

  const astronomerIds = [];
  for (let tier = 1; tier <= 3; tier += 1) astronomerIds.push('virtual-observatory.ast.T' + tier);
  for (let tier = 4; tier <= 6; tier += 1) astronomerIds.push('memory-flip.ast.T' + tier);
  const thresholdCases = [
    { n: 0, level: 1, next: 3 },
    { n: 2, level: 1, next: 3 },
    { n: 3, level: 2, next: 6 },
    { n: 6, level: 3, next: null },
  ];
  const thresholdOk = thresholdCases.every((testCase) => {
    const result = P.progress({
      professionId: 'science.astronomer',
      quests: astronomerIds.slice(0, testCase.n).map((id) => quest(id)),
    });
    return result.level === testCase.level && result.clearedCount === testCase.n && result.nextThreshold === testCase.next;
  });
  check('H12 第 17 职业沿用同一等级阈值', thresholdOk);

  const withoutRegistry = fresh().configure({ commissions: synthetic.commissionsContent });
  eq('H13 不传 registry 也能按内容推导 18 职业', withoutRegistry.professionCount, 18);
  const oldContentCount = REAL_PROFESSION_IDS.every((professionId) => P.progress({ professionId, quests: commissionIdsOf(professionId).map((id) => quest(id)) }).level === 3);
  check('H14 旧 16 职业在扩展内容下仍可独立到专家', oldContentCount);
}

/* ---------------------------------------------------------------- I 确定性 */

{
  const P = configuredReal().instance;
  const structuralIds = commissionIdsOf('engineering.structural');
  const quests = structuralIds.slice(0, 3).map((id) => quest(id));
  const claims = [claim(structuralIds[3])];

  const firstConfigure = P.configure({ commissions: REAL, registry: REGISTRY });
  const secondConfigure = P.configure({ commissions: REAL, registry: REGISTRY });
  eq('I01 configure 幂等（重复调用同结果）', secondConfigure, firstConfigure);

  const p1 = P.progress({ professionId: 'engineering.structural', quests, claims });
  const p2 = P.progress({ professionId: 'engineering.structural', quests, claims });
  eq('I02 progress 确定性', p2, p1);

  const f1 = P.profile({ quests, claims, wallet: { credits: 42 } });
  const f2 = P.profile({ quests, claims, wallet: { credits: 42 } });
  eq('I03 profile 确定性', f2, f1);

  const o1 = P.orderOptions({ professionId: 'engineering.structural', quests, claims });
  const o2 = P.orderOptions({ professionId: 'engineering.structural', quests, claims });
  eq('I04 orderOptions 确定性', o2, o1);

  const shuffled = [claims[0]].concat(quests.slice().reverse());
  eq(
    'I05 quests/claims 顺序不影响计数',
    P.progress({ professionId: 'engineering.structural', quests: shuffled.slice(1), claims: shuffled.slice(0, 1) }),
    P.progress({ professionId: 'engineering.structural', quests, claims })
  );

  const mapA = { r1: claim(structuralIds[0]), r2: claim(structuralIds[1]) };
  const mapB = { r2: claim(structuralIds[1]), r1: claim(structuralIds[0]) };
  eq(
    'I06 claims 映射键顺序不影响计数',
    P.progress({ professionId: 'engineering.structural', claims: mapA }),
    P.progress({ professionId: 'engineering.structural', claims: mapB })
  );

  const contentSnapshot = JSON.stringify(REAL);
  const registrySnapshot = JSON.stringify(REGISTRY);
  P.validate({ commissions: REAL, registry: REGISTRY });
  P.progress({ professionId: 'engineering.structural', quests, claims });
  P.profile({ quests, claims, wallet: { credits: 1 } });
  P.orderOptions({ professionId: 'engineering.structural', quests, claims });
  eq('I07 真实内容/registry 不被任何查询修改', { commissions: JSON.stringify(REAL), registry: JSON.stringify(REGISTRY) }, { commissions: contentSnapshot, registry: registrySnapshot });

  const other = configuredReal().instance;
  eq(
    'I08 独立实例同输入同结果',
    other.orderOptions({ professionId: 'engineering.structural', quests, claims }),
    o1
  );

  const isolated = fresh();
  isolated.configure({ commissions: REAL, registry: REGISTRY });
  P.configure({ commissions: [{ commissionId: 'only.T1', professionId: 'only.prof', gameId: 'only-game', tier: 1, title: '唯一' }] });
  const isolatedStillOk = isolated.orderOptions({ professionId: 'engineering.structural' }).orders.length === 6;
  check('I09 实例隔离（重配一个实例不影响另一个）', isolatedStillOk);
  P.configure({ commissions: REAL, registry: REGISTRY });

  const resetResult = P.reset();
  eq('I10 reset 清空内容', resetResult, { ok: true, professionCount: 0, errors: [] });
  eq('I11 reset 后 profile 结构化失败', P.profile().ok, false);
  eq('I12 reset 后 progress 默认学徒', P.progress({ professionId: 'engineering.structural' }), { level: 1, clearedCount: 0, maxTier: 0, nextThreshold: 3 });
  eq('I13 reset 后可重新 configure', P.configure({ commissions: REAL, registry: REGISTRY }), { ok: true, professionCount: 16, errors: [] });
}

/* ---------------------------------------------------------------- 汇总 */

let failed = 0;
for (const item of results) {
  if (item.ok) {
    console.log('PASS  ' + item.name);
  } else {
    failed += 1;
    console.log('FAIL  ' + item.name + (item.detail ? ' — ' + item.detail : ''));
  }
}
console.log('');
console.log(`${results.length - failed}/${results.length} checks passed`);
if (failed > 0) {
  console.error(`FAILED: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('PASS  career professions contract test');
