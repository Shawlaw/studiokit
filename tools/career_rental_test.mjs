#!/usr/bin/env node
/**
 * 0.16 免费租机路径测试（D16-07，纯 Node，无浏览器 / 无 DOM / 无网络）
 *
 * 覆盖：
 * - UMD 双端导出（Node require + 浏览器 window.ArcadeCareerRental / ArcadeCareer.rental 镜像）；
 * - configure 从真实 items.json 建立可租白名单（当前仅 old-wing），非法/缺失内容不抛；
 * - 白名单：old-wing 可租，cloud-lark（rental:false）拒绝，未知船拒绝；
 * - rent 只写一张会话凭证（注入的假 storage 只记录 1 次 set）、零扣费、不写其他 key；
 * - current 读回 / missing 返回 null / 坏 JSON 返回 null / 过期只提示不阻塞 / legacy 凭证补 expiresAt；
 * - clear 清理；重复 rent 幂等；已拥有提示（不写凭证）；
 * - prepareCommission 成功路径（假 commission.start 返回 ticket）与失败路径（恢复/清除凭证）；
 * - commission 缺失时 prepareCommission 返回 commission-unavailable，rent 仍然可用；
 * - 静态边界：源码不含 indexedDB / localStorage / fetch( / document. / 金额写入 / 宿主持久存储访问；
 * - 与 bridge 的租机键、读取函数、rentalShipId 合入点静态对齐。
 *
 * 运行：node tools/career_rental_test.mjs
 * 退出码：0 全 PASS；1 有 FAIL；2 用法/环境错误（参数非法或源文件不可读）。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const MODULE_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'rental.js');
const ITEMS_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'items.json');
const BRIDGE_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'bridge.js');

const USAGE = [
  '用法：node tools/career_rental_test.mjs',
  '可选项：--help',
].join('\n');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(2);
}
const unknownArgs = args.filter((arg) => arg !== '--');
if (unknownArgs.length > 0) {
  console.error('未知参数：' + unknownArgs.join(' '));
  console.error(USAGE);
  process.exit(2);
}

function readOrExit(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.error('ENV: 无法读取 ' + path.relative(REPO_ROOT, file) + ' — ' + err.message);
    process.exit(2);
  }
}

const moduleSource = readOrExit(MODULE_PATH);
const bridgeSource = readOrExit(BRIDGE_PATH);

let realItems = null;
try {
  realItems = JSON.parse(readOrExit(ITEMS_PATH));
} catch (err) {
  console.error('ENV: items.json 不是合法 JSON — ' + err.message);
  process.exit(2);
}

let rentalModule;
try {
  rentalModule = require(MODULE_PATH);
} catch (err) {
  console.error('ENV: 无法 require rental.js — ' + (err && err.message ? err.message : err));
  process.exit(2);
}
if (!rentalModule || typeof rentalModule !== 'object') {
  console.error('ENV: rental.js 导出不是对象');
  process.exit(2);
}

const KEY = rentalModule.STORAGE_KEY;
const TTL_MS = rentalModule.DEFAULT_TTL_MS;
const NOTE_FREE = '本次出击免费，不改变拥有/装备';
const NOTE_OWNED = '这艘船本来就在你名下';
const START = '2026-11-23T00:00:00.000Z';
const SIX_HOURS = 6 * 60 * 60 * 1000;

/* ---------------------------------------------------------------- 断言工具 */

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? '' : detail === undefined ? '' : String(detail) });
}
function eq(name, actual, expected) {
  check(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    'expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual)
  );
}
function has(props, key) {
  return !!props && Object.prototype.hasOwnProperty.call(props, key);
}

/* ---------------------------------------------------------------- 假实现 */

function createFakeStorage(options) {
  const opts = options || {};
  const map = new Map();
  if (opts.initial) {
    Object.keys(opts.initial).forEach((key) => map.set(key, String(opts.initial[key])));
  }
  const stats = { get: 0, set: 0, remove: 0, sets: [], removes: [] };
  const storage = {
    stats,
    map,
    failSet: opts.failSet === true,
    failGet: opts.failGet === true,
    failRemove: opts.failRemove === true,
    getItem(key) {
      stats.get += 1;
      if (this.failGet) throw new Error('get-blocked');
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      stats.set += 1;
      stats.sets.push([key, String(value)]);
      if (this.failSet) throw new Error('set-blocked');
      map.set(key, String(value));
    },
    removeItem(key) {
      stats.remove += 1;
      stats.removes.push(key);
      if (this.failRemove) throw new Error('remove-blocked');
      map.delete(key);
    },
    keys() {
      return [...map.keys()];
    },
    raw(key) {
      return map.has(key) ? map.get(key) : null;
    },
  };
  return storage;
}

function createClock(iso) {
  let at = Date.parse(iso);
  return {
    now() {
      return new Date(at).toISOString();
    },
    advance(ms) {
      at += ms;
      return this;
    },
    set(value) {
      at = Date.parse(value);
      return this;
    },
  };
}

function createFakeCommission(handler) {
  const calls = [];
  const commission = {
    calls,
    start(request) {
      calls.push(JSON.parse(JSON.stringify(request)));
      if (typeof handler === 'function') return handler(request);
      return Promise.resolve(defaultStartResult(request));
    },
  };
  return commission;
}

function defaultStartResult(request) {
  const careerId = (request && request.careerId) || 'career-alpha';
  const ticketId = 'commission-run-1';
  return {
    ok: true,
    ticket: {
      ticketId,
      runId: ticketId,
      careerId,
      commissionId: request && request.commissionId,
      gameId: 'star-raid',
      startParams: { startLevel: 1, themeId: 'storm' },
      nonce: 'a'.repeat(32),
    },
    ticketId,
    careerId,
    gameId: 'star-raid',
    url: '../games/star-raid.html?career=' + ticketId,
  };
}

function newRental(extra) {
  const opts = extra || {};
  const storage = has(opts, 'storage') ? opts.storage : createFakeStorage();
  const clock = opts.clock || createClock(START);
  const commission = has(opts, 'commission') ? opts.commission : null;
  const rental = rentalModule.create({
    storage,
    now: clock.now,
    commission,
    ttlMs: has(opts, 'ttlMs') ? opts.ttlMs : TTL_MS,
  });
  return { rental, storage, clock, commission };
}

function configured(extra) {
  const opts = extra || {};
  const env = newRental(opts);
  const items = has(opts, 'items') ? opts.items : realItems;
  env.configureResult = env.rental.configure({ items });
  return env;
}

function contentItems(overrides) {
  const base = {
    contentVersion: '0.17.0',
    ships: [],
    modules: [],
    materials: [],
  };
  return Object.assign(base, overrides || {});
}

/* ---------------------------------------------------------------- T-01 模块装配 */

{
  check('T-01a configure 是函数', typeof rentalModule.configure === 'function');
  check('T-01b rent 是函数', typeof rentalModule.rent === 'function');
  check('T-01c current 是函数', typeof rentalModule.current === 'function');
  check('T-01d clear 是函数', typeof rentalModule.clear === 'function');
  check('T-01e prepareCommission 是函数', typeof rentalModule.prepareCommission === 'function');
  check('T-01f create 工厂可独立建实例', typeof rentalModule.create === 'function' && typeof rentalModule.create().rent === 'function');
  check('T-01g MODULE_VERSION 为 0.17.0', rentalModule.MODULE_VERSION === '0.17.0');
  check('T-01h CONTENT_VERSION 为 0.17.0', rentalModule.CONTENT_VERSION === '0.17.0');
  eq('T-01i marker 键为 ADR 约定的会话键', KEY, 'studiokit:arcade:career:rental.v1');
  check('T-01j 默认 TTL 为 6 小时（仅提示）', TTL_MS === SIX_HOURS && rentalModule.DEFAULT_TTL_MS === TTL_MS);
  check('T-01k REASONS 为冻结集合', !!rentalModule.REASONS && typeof rentalModule.REASONS === 'object');
}

/* ---------------------------------------------------------------- T-02 浏览器 UMD 挂载 */

{
  let browserApi = null;
  let browserError = '';
  const fakeStorage = createFakeStorage();
  const clock = createClock(START);
  try {
    const sandbox = { console };
    sandbox.window = { crypto: undefined, ArcadeCareer: {} };
    vm.createContext(sandbox);
    vm.runInContext(moduleSource, sandbox, { filename: 'rental.js' });
    const win = sandbox.window;
    browserApi = win.ArcadeCareerRental;
    check('T-02a 浏览器挂载 window.ArcadeCareerRental', !!browserApi && typeof browserApi.rent === 'function');
    check('T-02b 镜像到 window.ArcadeCareer.rental', win.ArcadeCareer && win.ArcadeCareer.rental === browserApi);
    check('T-02c 浏览器实例不伪造 commissionRun', win.ArcadeCareer && win.ArcadeCareer.commissionRun === undefined);
    const configure = browserApi.configure({ items: realItems, storage: fakeStorage, now: clock.now });
    check('T-02d 浏览器实例可用注入内容与注入 storage 配置', configure.ok === true && configure.rentalCount === 1);
    const rented = browserApi.rent({ careerId: 'career-vm', shipId: 'old-wing' });
    check(
      'T-02e 浏览器实例 rent 写同一张凭证',
      rented.ok === true && fakeStorage.stats.set === 1 && fakeStorage.raw(KEY).indexOf('old-wing') >= 0
    );
  } catch (err) {
    browserError = err && err.message ? err.message : String(err);
  }
  check('T-02f 浏览器 UMD 执行不抛异常', !browserError, browserError);
}

/* ---------------------------------------------------------------- T-03 configure 内容 */

{
  const env = newRental();
  const configuredResult = env.rental.configure({ items: realItems });
  check('T-03a configure 真实 items 返回 ok', configuredResult.ok === true, JSON.stringify(configuredResult.errors));
  check('T-03b contentVersion 读回 0.17.0', configuredResult.contentVersion === '0.17.0');
  check('T-03c 飞船总数 4', configuredResult.shipCount === 4);
  check('T-03d 可租数量 1', configuredResult.rentalCount === 1);
  eq('T-03e 可租白名单只有 old-wing', configuredResult.rentals, [{ shipId: 'old-wing', name: '旧翼', price: 260 }]);
  check('T-03f usable=true', configuredResult.usable === true);
  eq('T-03g 无错误', configuredResult.errors, []);

  const rawEnv = newRental();
  const rawResult = rawEnv.rental.configure(realItems);
  check('T-03h 直接传 items 本体也接受', rawResult.ok === true && rawResult.rentalCount === 1);

  const again = env.rental.configure({ items: realItems });
  check('T-03i 重复 configure 幂等', again.ok === true && again.rentalCount === 1);

  const optionsOnly = env.rental.configure({ commission: { start() {} } });
  check('T-03j 只注入 commission 时不误清内容', optionsOnly.ok === true && optionsOnly.rentalCount === 1);
  const rentedAfterOptionsOnly = env.rental.rent({ careerId: 'career-options', shipId: 'old-wing' });
  check('T-03k 只注入 commission 后仍可租机', rentedAfterOptionsOnly.ok === true);
}

/* ---------------------------------------------------------------- T-04 真实内容对齐 */

{
  const ships = Array.isArray(realItems.ships) ? realItems.ships : [];
  const rentalShips = ships.filter((ship) => ship && ship.rental === true).map((ship) => ship.shipId);
  eq('T-04a items.json 中 rental:true 只有 old-wing', rentalShips, ['old-wing']);
  const oldWing = ships.find((ship) => ship && ship.shipId === 'old-wing');
  const cloudLark = ships.find((ship) => ship && ship.shipId === 'cloud-lark');
  check('T-04b old-wing 价格 > 0', oldWing && oldWing.price > 0);
  check('T-04c cloud-lark 不是可租船', cloudLark && cloudLark.rental === false);
}

/* ---------------------------------------------------------------- T-05 内容缺失降级 */

{
  const env = newRental();
  const before = env.rental.rent({ careerId: 'career-missing', shipId: 'old-wing' });
  check('T-05a 未 configure 时 rent 结构化失败', before.ok === false && before.reason === 'content-missing');
  check('T-05b 未 configure 时不写 marker', env.storage.stats.set === 0 && env.storage.keys().length === 0);
  const configuredResult = env.rental.configure({ items: null });
  check('T-05c configure(null) 记录 content-missing', configuredResult.ok === false && configuredResult.errors.indexOf('content-missing') >= 0);
  const after = env.rental.rent({ careerId: 'career-missing', shipId: 'old-wing' });
  check('T-05d 内容缺失时 rent 仍返回 content-missing', after.ok === false && after.reason === 'content-missing');
  check('T-05e 内容缺失时 current 为 null', env.rental.current() === null);
  const cleared = env.rental.clear();
  check('T-05f 空上下文 clear 不抛', cleared.ok === true && cleared.cleared === false);
}

/* ---------------------------------------------------------------- T-06 内容结构非法 */

{
  const env = newRental();
  const configuredResult = env.rental.configure({ items: {} });
  check('T-06a 缺少 ships 数组记 errors 且 ok=false', configuredResult.ok === false && configuredResult.errors.indexOf('ships-not-array') >= 0);
  const rented = env.rental.rent({ careerId: 'career-invalid', shipId: 'old-wing' });
  check('T-06b 结构非法时 rent 返回 content-invalid', rented.ok === false && rented.reason === 'content-invalid');
  check('T-06c 结构非法时零写入', env.storage.stats.set === 0);

  const env2 = newRental();
  const configured2 = env2.rental.configure({ items: { ships: 'nope' } });
  check('T-06d ships 非数组同样记录错误', configured2.ok === false && configured2.errors.indexOf('ships-not-array') >= 0);

  const env3 = newRental();
  const configured3 = env3.rental.configure({ items: contentItems({ ships: [] }) });
  check('T-06e 空 ships 列表记录 ships-empty', configured3.ok === false && configured3.errors.indexOf('ships-empty') >= 0);
  const rentedEmpty = env3.rental.rent({ careerId: 'career-empty', shipId: 'old-wing' });
  check('T-06f 空内容时 rent 结构化失败且零写入', rentedEmpty.ok === false && env3.storage.stats.set === 0);
}

/* ---------------------------------------------------------------- T-07 内容版本 */

{
  const env = newRental();
  const oldContent = contentItems({
    contentVersion: '0.15.0',
    ships: [{ shipId: 'old-wing', name: '旧翼', price: 260, rental: true, stats: {} }],
  });
  const configuredResult = env.rental.configure({ items: oldContent });
  check('T-07a 0.15 内容记录版本不匹配', configuredResult.ok === false && configuredResult.errors.some((code) => code.indexOf('content-version-mismatch') === 0));
  const rented = env.rental.rent({ careerId: 'career-version', shipId: 'old-wing' });
  check('T-07b 版本不匹配时拒绝租机且零写入', rented.ok === false && rented.reason === 'content-version-mismatch' && env.storage.stats.set === 0);

  const env2 = newRental();
  const patchContent = contentItems({
    contentVersion: '0.17.9',
    ships: [{ shipId: 'old-wing', name: '旧翼', price: 260, rental: true, stats: {} }],
  });
  const configured2 = env2.rental.configure({ items: patchContent });
  check('T-07c 0.17.x 补丁版本兼容', configured2.ok === true && configured2.usable === true);
}

/* ---------------------------------------------------------------- T-08 可租条目校验 */

{
  const env = newRental();
  const zeroPrice = contentItems({
    ships: [{ shipId: 'old-wing', name: '旧翼', price: 0, rental: true, stats: {} }],
  });
  const configuredResult = env.rental.configure({ items: zeroPrice });
  check('T-08a 价格 0 的 rental 条目记错误', configuredResult.ok === false && configuredResult.errors.indexOf('rental-price-invalid:old-wing') >= 0);
  check('T-08b 价格 0 不进入可租白名单', configuredResult.rentalCount === 0);
  const rented = env.rental.rent({ careerId: 'career-zero', shipId: 'old-wing' });
  check('T-08c 价格 0 的船拒绝租机', rented.ok === false && rented.reason === 'not-rentable');

  const env2 = newRental();
  const mixed = contentItems({
    ships: [
      { shipId: 'old-wing', name: '旧翼', price: 260, rental: true, stats: {} },
      { shipId: '', name: '坏条目', price: 10, rental: false },
    ],
  });
  const configured2 = env2.rental.configure({ items: mixed });
  check('T-08d 单条坏条目记错误但保留有效条目', configured2.ok === false && configured2.rentalCount === 1);
  const rented2 = env2.rental.rent({ careerId: 'career-mixed', shipId: 'old-wing' });
  check('T-08e 有效旧翼仍可租', rented2.ok === true && env2.storage.stats.set === 1);
}

/* ---------------------------------------------------------------- T-09 rent 基本路径 */

{
  const env = configured();
  const result = env.rental.rent({ careerId: 'career-alpha', shipId: 'old-wing' });
  check('T-09a rent 成功', result.ok === true);
  check('T-09b 返回 rental 字段', !!result.rental && result.rental.shipId === 'old-wing' && result.rental.careerId === 'career-alpha');
  check('T-09c 返回免费提示', result.note === NOTE_FREE);
  check('T-09d 标记为「写了凭证」', result.marker === true && result.owned === false);
  eq('T-09e 船信息来自内容', result.ship, { shipId: 'old-wing', name: '旧翼', price: 260, rental: true });
  check('T-09f 零扣费：只调用 1 次 set', env.storage.stats.set === 1);
  check('T-09g 不调用 remove', env.storage.stats.remove === 0);
  eq('T-09h 只写 marker 一个 key', env.storage.keys(), [KEY]);
  check('T-09i 结果不含金额/钱包字段', !has(result, 'credits') && !has(result, 'wallet') && !has(result, 'price'));

  const raw = env.storage.raw(KEY);
  const marker = JSON.parse(raw);
  check('T-09j marker 键形状符合 bridge 读取', marker.shipId === 'old-wing' && marker.careerId === 'career-alpha');
  check('T-09k marker.at 为注入时钟的 ISO 时间', marker.at === START);
  check(
    'T-09l marker.expiresAt 为 6 小时后（仅提示）',
    marker.expiresAt === new Date(Date.parse(START) + SIX_HOURS).toISOString()
  );
  check('T-09m marker.nonce 为 32+ hex', typeof marker.nonce === 'string' && /^[0-9a-f]{32,}$/.test(marker.nonce));
  check('T-09n marker 不含金额/钱包字段', !('credits' in marker) && !('wallet' in marker) && !('price' in marker));
  check('T-09o marker 体积 < 512 字节', Buffer.byteLength(raw, 'utf8') <= 512);
}

/* ---------------------------------------------------------------- T-10 白名单拒绝 */

{
  const env = configured();
  const cloud = env.rental.rent({ careerId: 'career-alpha', shipId: 'cloud-lark' });
  check('T-10a cloud-lark 拒绝（rental:false）', cloud.ok === false && cloud.reason === 'not-rentable');
  const ghost = env.rental.rent({ careerId: 'career-alpha', shipId: 'ghost-wing' });
  check('T-10b 未知船拒绝', ghost.ok === false && ghost.reason === 'unknown-ship');
  const badShape = env.rental.rent({ careerId: 'career-alpha', shipId: 'old wing' });
  check('T-10c 非法 shipId 形状拒绝', badShape.ok === false && badShape.reason === 'bad-ship-id');
  const badNumber = env.rental.rent({ careerId: 'career-alpha', shipId: 42 });
  check('T-10d 非字符串 shipId 拒绝', badNumber.ok === false && badNumber.reason === 'bad-ship-id');
  check('T-10e 全部拒绝均零写入', env.storage.stats.set === 0 && env.storage.keys().length === 0);
  check('T-10f 全部拒绝后 current 为 null', env.rental.current() === null);
}

/* ---------------------------------------------------------------- T-11 careerId 校验 */

{
  const env = configured();
  const objectId = env.rental.rent({ careerId: { bad: true }, shipId: 'old-wing' });
  check('T-11a careerId 为对象时结构化失败', objectId.ok === false && objectId.reason === 'bad-career-id');
  const numberId = env.rental.rent({ careerId: 7, shipId: 'old-wing' });
  check('T-11b careerId 为数字时结构化失败', numberId.ok === false && numberId.reason === 'bad-career-id');
  check('T-11c 非法 careerId 零写入', env.storage.stats.set === 0);

  const wildcard = env.rental.rent({ careerId: 'career-wild', shipId: 'old-wing' });
  check('T-11d 宽松字符串 careerId 通过', wildcard.ok === true && wildcard.rental.careerId === 'career-wild');

  const env2 = configured();
  const unknownCareer = env2.rental.rent({ shipId: 'old-wing' });
  check(
    'T-11e 未创建生涯时允许通配凭证（careerId 为空，bridge 按通配处理）',
    unknownCareer.ok === true && JSON.parse(env2.storage.raw(KEY)).careerId === ''
  );
}

/* ---------------------------------------------------------------- T-12 current 读回 / 清理 / 过期 */

{
  const env = configured();
  check('T-12a 未租时 current 为 null', env.rental.current() === null);
  env.rental.rent({ careerId: 'career-alpha', shipId: 'old-wing' });
  const current = env.rental.current();
  check(
    'T-12b current 读回同一张凭证',
    current && current.ok === true && current.shipId === 'old-wing' && current.careerId === 'career-alpha'
  );
  check('T-12c current 带 at / expiresAt / nonce', current.at === START && current.expiresAt === new Date(Date.parse(START) + SIX_HOURS).toISOString() && /^[0-9a-f]{32,}$/.test(current.nonce));
  check('T-12d 未过期标记为 false', current.expired === false && current.note === NOTE_FREE);

  env.clock.advance(7 * 60 * 60 * 1000);
  const expired = env.rental.current();
  check('T-12e 过期只提示不阻塞（仍返回凭证）', expired && expired.shipId === 'old-wing' && expired.expired === true);
  check('T-12f 过期提示文案为戏内语言', typeof expired.note === 'string' && expired.note.indexOf('过期') >= 0);

  const refreshed = env.rental.rent({ careerId: 'career-alpha', shipId: 'old-wing' });
  check('T-12g 重新租机刷新凭证', refreshed.ok === true && env.rental.current().expired === false);

  const invalidStore = createFakeStorage({ initial: { [KEY]: '{not-json' } });
  const invalidEnv = configured({ storage: invalidStore });
  check('T-12h 坏 JSON 的凭证按 missing 处理', invalidEnv.rental.current() === null);

  const legacyMarker = JSON.stringify({ shipId: 'old-wing', careerId: 'career-legacy', at: START, nonce: 'b'.repeat(32) });
  const legacyStore = createFakeStorage({ initial: { [KEY]: legacyMarker } });
  const legacyEnv = configured({ storage: legacyStore });
  const legacy = legacyEnv.rental.current();
  check(
    'T-12i legacy 凭证缺 expiresAt 时按内容推导',
    legacy && legacy.expiresAt === new Date(Date.parse(START) + SIX_HOURS).toISOString()
  );

  const noShipStore = createFakeStorage({ initial: { [KEY]: JSON.stringify({ careerId: 'x', at: START }) } });
  const noShipEnv = configured({ storage: noShipStore });
  check('T-12j 缺少 shipId 的凭证按 missing 处理', noShipEnv.rental.current() === null);
}

/* ---------------------------------------------------------------- T-13 clear / 幂等 */

{
  const env = configured();
  env.rental.rent({ careerId: 'career-alpha', shipId: 'old-wing' });
  const cleared = env.rental.clear();
  check('T-13a clear 清掉凭证', cleared.ok === true && cleared.cleared === true);
  check('T-13b clear 后 current 为 null', env.rental.current() === null);
  check('T-13c clear 调用了 removeItem', env.storage.stats.remove === 1);
  const again = env.rental.clear();
  check('T-13d 重复 clear 不抛且返回 cleared:false', again.ok === true && again.cleared === false);

  const once = env.rental.rent({ careerId: 'career-alpha', shipId: 'old-wing' });
  const twice = env.rental.rent({ careerId: 'career-alpha', shipId: 'old-wing' });
  check('T-13e 重复 rent 均成功', once.ok === true && twice.ok === true);
  check('T-13f 重复 rent 仍是同一张凭证（单 key）', env.storage.keys().length === 1);
  check('T-13g 重复 rent 只覆盖不叠加', env.storage.stats.set === 3 && env.storage.keys().length === 1);
  check('T-13h 重复 rent 后 current 有效', env.rental.current().shipId === 'old-wing');
}

/* ---------------------------------------------------------------- T-14 已拥有提示 */

{
  const env = configured();
  const ownedByEquipment = env.rental.rent({
    careerId: 'career-alpha',
    shipId: 'old-wing',
    equipment: { 'ship:old-wing:owned': true },
  });
  check('T-14a 已拥有时返回 owned:true', ownedByEquipment.ok === true && ownedByEquipment.owned === true);
  check('T-14b 已拥有提示文案', ownedByEquipment.note === NOTE_OWNED && ownedByEquipment.rental === null);
  check('T-14c 已拥有不写凭证', ownedByEquipment.marker === false && env.storage.stats.set === 0);

  const ownedByWallet = env.rental.rent({
    careerId: 'career-alpha',
    shipId: 'old-wing',
    wallet: { equipment: { 'ship:old-wing:owned': true } },
  });
  check('T-14d 从钱包装备快照识别已拥有', ownedByWallet.ok === true && ownedByWallet.owned === true);

  const ownedFlag = env.rental.rent({ careerId: 'career-alpha', shipId: 'old-wing', owned: true });
  check('T-14e 显式 owned:true 识别已拥有', ownedFlag.ok === true && ownedFlag.owned === true);

  const ownedShip = env.rental.rent({ careerId: 'career-alpha', shipId: 'old-wing', ship: { owned: true } });
  check('T-14f 船对象带 owned 时识别已拥有', ownedShip.ok === true && ownedShip.owned === true);
}

/* ---------------------------------------------------------------- T-15 存储边界 */

{
  const noStorage = configured({ storage: null });
  const result = noStorage.rental.rent({ careerId: 'career-alpha', shipId: 'old-wing' });
  check('T-15a 无注入 storage 时结构化失败', result.ok === false && result.reason === 'storage-unavailable');
  check('T-15b 无 storage 时 current 为 null', noStorage.rental.current() === null);
  const cleared = noStorage.rental.clear();
  check('T-15c 无 storage 时 clear 结构化失败', cleared.ok === false && cleared.reason === 'storage-unavailable');

  const fullStorage = createFakeStorage({ failSet: true });
  const fullEnv = configured({ storage: fullStorage });
  const failed = fullEnv.rental.rent({ careerId: 'career-alpha', shipId: 'old-wing' });
  check('T-15d setItem 失败时返回 write-failed', failed.ok === false && failed.reason === 'write-failed');
  check('T-15e 写失败不留凭证', fullStorage.keys().length === 0 && fullEnv.rental.current() === null);

  const removeFailStorage = createFakeStorage({ failRemove: true });
  const removeFailEnv = configured({ storage: removeFailStorage });
  removeFailEnv.rental.rent({ careerId: 'career-alpha', shipId: 'old-wing' });
  const removeFailed = removeFailEnv.rental.clear();
  check('T-15f removeItem 失败时返回 remove-failed', removeFailed.ok === false && removeFailed.reason === 'remove-failed');
}

/* ---------------------------------------------------------------- T-16 prepareCommission 成功 */

{
  const commission = createFakeCommission();
  const env = configured({ commission });
  const promise = env.rental.prepareCommission({ commissionId: 'star-raid.T1.01', careerId: 'career-alpha', shipId: 'old-wing' });
  check('T-16a prepareCommission 返回 thenable', !!promise && typeof promise.then === 'function');
  const result = await promise;
  check('T-16b prepareCommission 成功', result.ok === true);
  check('T-16c 返回 ticket / ticketId / url', result.ticketId === 'commission-run-1' && result.url === '../games/star-raid.html?career=commission-run-1' && result.ticket && result.ticket.gameId === 'star-raid');
  check('T-16d 返回租机信息', result.rental && result.rental.shipId === 'old-wing' && result.note === NOTE_FREE);
  check('T-16e 调用一次 commission.start', commission.calls.length === 1);
  eq('T-16f start 入参只含委托与生涯', commission.calls[0], { commissionId: 'star-raid.T1.01', careerId: 'career-alpha' });
  check('T-16g start 成功后凭证仍在（本次出击生效）', env.storage.raw(KEY) !== null && env.rental.current().shipId === 'old-wing');
  check('T-16h 只写一次凭证（careerId 已知时不收紧）', env.storage.stats.set === 1);
}

/* ---------------------------------------------------------------- T-17 prepareCommission 失败清理 */

{
  const commission = createFakeCommission(() => ({ ok: false, reason: 'locked' }));
  const env = configured({ commission });
  const result = await env.rental.prepareCommission({ commissionId: 'star-raid.T1.01', careerId: 'career-alpha', shipId: 'old-wing' });
  check('T-17a start 失败时返回原因为结构化失败', result.ok === false && result.reason === 'locked');
  check('T-17b start 失败时清除刚写的凭证', env.storage.raw(KEY) === null && env.rental.current() === null);
  check('T-17c 返回 markerCleared 标记', result.markerCleared === true);
  check('T-17d 不返回 ticket/url', result.ticket === null && result.url === null);

  const previousRaw = JSON.stringify({
    schemaVersion: 1,
    shipId: 'old-wing',
    careerId: 'career-beta',
    at: START,
    expiresAt: new Date(Date.parse(START) + SIX_HOURS).toISOString(),
    nonce: 'c'.repeat(32),
  });
  const restoreStore = createFakeStorage({ initial: { [KEY]: previousRaw } });
  const restoreCommission = createFakeCommission(() => Promise.resolve({ ok: false, reason: 'abandoned' }));
  const restoreEnv = configured({ storage: restoreStore, commission: restoreCommission });
  const restored = await restoreEnv.rental.prepareCommission({ commissionId: 'star-raid.T1.01', careerId: 'career-alpha', shipId: 'old-wing' });
  check('T-17e start 失败时恢复调用前的旧凭证', restored.ok === false && restoreStore.raw(KEY) === previousRaw);
  check('T-17f 旧凭证内容未被破坏', restoreEnv.rental.current().careerId === 'career-beta');

  const throwingCommission = createFakeCommission(() => {
    throw new Error('boom');
  });
  const throwEnv = configured({ commission: throwingCommission });
  const thrown = await throwEnv.rental.prepareCommission({ commissionId: 'star-raid.T1.01', careerId: 'career-alpha', shipId: 'old-wing' });
  check('T-17g start 同步抛错时结构化失败', thrown.ok === false && thrown.reason === 'commission-failed');
  check('T-17h start 抛错时清除凭证', throwEnv.storage.raw(KEY) === null);

  const rejectingCommission = createFakeCommission(() => Promise.reject(new Error('nope')));
  const rejectEnv = configured({ commission: rejectingCommission });
  const rejected = await rejectEnv.rental.prepareCommission({ commissionId: 'star-raid.T1.01', careerId: 'career-alpha', shipId: 'old-wing' });
  check('T-17i start reject 时结构化失败', rejected.ok === false && rejected.reason === 'commission-failed');
  check('T-17j start reject 时清除凭证', rejectEnv.storage.raw(KEY) === null);

  const badIdEnv = configured({ commission: createFakeCommission() });
  const badId = await badIdEnv.rental.prepareCommission({ commissionId: '', careerId: 'career-alpha', shipId: 'old-wing' });
  check('T-17k 缺 commissionId 时结构化失败', badId.ok === false && badId.reason === 'bad-commission-id');
  check('T-17l 参数非法时零写入', badIdEnv.storage.stats.set === 0);
}

/* ---------------------------------------------------------------- T-18 commission 不可用 */

{
  const env = configured();
  const result = await env.rental.prepareCommission({ commissionId: 'star-raid.T1.01', careerId: 'career-alpha', shipId: 'old-wing' });
  check('T-18a commission 缺失时返回 commission-unavailable', result.ok === false && result.reason === 'commission-unavailable');
  check('T-18b commission 缺失时不留凭证', env.storage.stats.set === 0 && env.storage.raw(KEY) === null);
  const rented = env.rental.rent({ careerId: 'career-alpha', shipId: 'old-wing' });
  check('T-18c commission 缺失时 rent 仍可用', rented.ok === true);

  const env2 = newRental();
  env2.rental.configure({ items: realItems, commission: createFakeCommission() });
  const injectedViaConfigure = await env2.rental.prepareCommission({ commissionId: 'star-raid.T1.01', careerId: 'career-alpha', shipId: 'old-wing' });
  check('T-18d configure 注入 commission 同样生效', injectedViaConfigure.ok === true);

  const globalCommission = createFakeCommission();
  globalThis.ArcadeCareer = Object.assign({}, globalThis.ArcadeCareer || {}, { commission: globalCommission });
  try {
    const env3 = configured();
    const fromGlobal = await env3.rental.prepareCommission({ commissionId: 'star-raid.T1.01', careerId: 'career-alpha', shipId: 'old-wing' });
    check('T-18e 回退到 window.ArcadeCareer.commission', fromGlobal.ok === true && globalCommission.calls.length === 1);
  } finally {
    delete globalThis.ArcadeCareer;
  }
}

/* ---------------------------------------------------------------- T-19 prepareCommission 未生涯 / 已拥有 */

{
  const commission = createFakeCommission((request) => {
    const careerId = request.careerId || 'career-ensured-9';
    return Promise.resolve({
      ok: true,
      ticket: {
        ticketId: 'commission-run-2',
        careerId,
        commissionId: request.commissionId,
        gameId: 'star-raid',
      },
      ticketId: 'commission-run-2',
      careerId,
      url: '../games/star-raid.html?career=commission-run-2',
    });
  });
  const env = configured({ commission });
  const result = await env.rental.prepareCommission({ commissionId: 'star-raid.T1.01', shipId: 'old-wing' });
  check('T-19a 未创建生涯时仍可租机 + 接单', result.ok === true && result.careerId === 'career-ensured-9');
  check('T-19b 通配凭证被 ticket 的 careerId 收紧', env.rental.current() && env.rental.current().careerId === 'career-ensured-9');
  check('T-19c start 未传空 careerId', commission.calls.length === 1 && !has(commission.calls[0], 'careerId'));

  const ownedCommission = createFakeCommission();
  const ownedEnv = configured({ commission: ownedCommission });
  const owned = await ownedEnv.rental.prepareCommission({
    commissionId: 'star-raid.T1.01',
    careerId: 'career-alpha',
    shipId: 'old-wing',
    equipment: { 'ship:old-wing:owned': true },
  });
  check('T-19d 已拥有时 prepare 仍能接单', owned.ok === true && owned.owned === true && owned.rental === null);
  check('T-19e 已拥有时不写凭证', ownedEnv.storage.stats.set === 0 && ownedEnv.rental.current() === null);
}

/* ---------------------------------------------------------------- T-20 静态边界 */

{
  check('T-20a 源码不含 indexedDB', !/indexedDB/i.test(moduleSource));
  check('T-20b 源码不含 localStorage', !/localStorage/i.test(moduleSource));
  check('T-20c 源码不含 fetch(', !/fetch\s*\(/.test(moduleSource));
  check('T-20d 源码不含 document.', !/document\./.test(moduleSource));
  check('T-20e 源码不含 XHR/WebSocket/sendBeacon', !/XMLHttpRequest|WebSocket|sendBeacon/.test(moduleSource));
  check('T-20f 源码不直接访问 sessionStorage', !/sessionStorage/.test(moduleSource));
  check('T-20g 源码不含信用点写入 token', !/\bcredits\b/i.test(moduleSource) && !/purchase\s*\(/.test(moduleSource));
  check('T-20h 源码不写生涯数据库/旧机库', !/writeEquipment|settleAndClaim|createRun|GameMeta/.test(moduleSource));
  check('T-20i 源码不触碰 bridge 的 commissionRun 状态', !/commissionRun/.test(moduleSource));
  eq('T-20j 源码只有一个会话键字面量', (moduleSource.match(/studiokit:/g) || []).length, 1);
  check('T-20k 源码使用注入 storage 键常量', moduleSource.indexOf("var STORAGE_KEY = 'studiokit:arcade:career:rental.v1'") >= 0);
}

/* ---------------------------------------------------------------- T-21 bridge 静态对齐 */

{
  check('T-21a bridge 引用同一租机键', bridgeSource.indexOf("'studiokit:arcade:career:rental.v1'") >= 0);
  check('T-21b bridge 有租机凭证读取函数', /function\s+readRentalMarker\s*\(/.test(bridgeSource));
  check('T-21c bridge 把 marker 合入 startParams.rentalShipId', bridgeSource.indexOf('startParams.rentalShipId') >= 0);
  check('T-21d bridge 结算后清理租机凭证', /clearRentalMarker\s*\(/.test(bridgeSource));
  check('T-21e bridge 依赖表登记 rental.js', bridgeSource.indexOf('rental.js') >= 0);
}

/* ---------------------------------------------------------------- 汇总 */

let failed = 0;
let passed = 0;
for (const item of results) {
  if (item.ok) {
    passed += 1;
    console.log('PASS  ' + item.name);
  } else {
    failed += 1;
    console.log('FAIL  ' + item.name + (item.detail ? ' — ' + item.detail : ''));
  }
}
const total = passed + failed;
console.log('');
console.log(`${passed}/${total} checks passed`);
if (failed > 0) {
  console.error(`FAILED: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('PASS: ' + passed + '/' + total + ' checks passed');
process.exit(0);
