#!/usr/bin/env node
/**
 * 0.16 星海机体参数提纯测试（D16-05，纯 Node，无浏览器 / 无 DOM / 无网络）
 *
 * 覆盖：
 * - FORMULA_VERSION=2 常量、UMD 双端导出（Node require + 浏览器 window 挂载/镜像）；
 * - classicHangarStats 与 star-raid.html 现有 formula:1 公式**逐项相等**（读源码常量对照，
 *   hull/power/engine/energy/bay/wing 的 0 / 中值 / 最大值，外加额外项 wing 编队、moveSpeed）；
 * - 生涯默认回退旧翼（owned:false 可玩）与租用路径；
 * - 旧翼/云雀/盾鲸/棱镜参数差异（内容注入，不依赖尚未落地的 items.json）；
 * - 模块等级 clamp、stats 显式覆盖、未知舰/模块/物品的安全降级；
 * - SAFE_LIMITS 数值上限与 energyCap；价格表与购买预览差额（纯计算、不扣款）；
 * - resolveCareerConfig 不读旧 hangar（传入假 hangar 结果不变）、不写存储、确定性；
 * - 与 career-core.RULESET 的价格上限防漂移；
 * - items.json 若已落地则做内容对齐检查，否则 SKIP。
 *
 * 运行：node tools/career_star_combat_config_test.mjs
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
const MODULE_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'star-combat-config.js');
const SOURCE_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'games', 'star-raid.html');
const BRIDGE_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'bridge.js');
const CORE_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'career-core.js');
const ITEMS_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'items.json');

const USAGE = [
  '用法：node tools/career_star_combat_config_test.mjs',
  '可选项：--help',
].join('\n');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(2);
}
const unknownArgs = args.filter((arg) => arg !== '--' && !arg.startsWith('--'));
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
const source = readOrExit(SOURCE_PATH);
const bridgeSource = readOrExit(BRIDGE_PATH);

let combat;
try {
  combat = require(MODULE_PATH);
} catch (err) {
  console.error('ENV: 无法 require star-combat-config.js — ' + (err && err.message ? err.message : err));
  process.exit(2);
}
if (!combat || typeof combat !== 'object') {
  console.error('ENV: star-combat-config.js 导出不是对象');
  process.exit(2);
}

/* ---------------------------------------------------------------- 断言工具 */

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? '' : detail === undefined ? '' : String(detail) });
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    'expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual));
}
function near(name, actual, expected, eps) {
  const tol = typeof eps === 'number' ? eps : 1e-9;
  check(name, typeof actual === 'number' && Math.abs(actual - expected) <= tol,
    'expected ~' + expected + ' got ' + actual);
}
function skip(name, detail) {
  results.push({ name, skip: true, detail: detail || '' });
}
function pick(obj, keys) {
  const out = {};
  keys.forEach((key) => { out[key] = obj ? obj[key] : undefined; });
  return out;
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
  }
  return value;
}
function snapshot(value) {
  return JSON.stringify(value);
}

/* ---------------------------------------------------------------- 内容夹具（不依赖尚未落地的 items.json） */

const ZERO_LEVELS = Object.freeze({ hull: 0, power: 0, engine: 0, energy: 0, bay: 0, wing: 0 });

const FIXTURE_ITEMS = deepFreeze({
  contentVersion: '0.17.0',
  ships: [
    { shipId: 'old-wing', name: '旧翼', price: 260, rental: true, stats: { lives: 3, energy: 100, firepower: 0, speed: 0, magnet: 0 } },
    { shipId: 'cloud-lark', name: '云雀', price: 480, rental: true, stats: { lives: 3, energy: 95, firepower: 0.06, speed: 0.12, magnet: 0.06 } },
    { shipId: 'shield-whale', name: '盾鲸', price: 520, rental: false, stats: { lives: 4, energy: 110, firepower: 0, speed: 0, magnet: 0.03 } },
    { shipId: 'prism', name: '棱镜', price: 540, rental: false, stats: { lives: 3, energy: 90, firepower: 0.12, speed: 0.06, magnet: 0.12 } },
  ],
  modules: [
    { moduleId: 'hull', name: '装甲', levels: [{ level: 1, cost: 80, stats: {} }, { level: 2, cost: 160, stats: {} }, { level: 3, cost: 260, stats: {} }] },
    { moduleId: 'power', name: '火力', levels: [{ level: 1 }, { level: 2 }, { level: 3 }, { level: 4 }, { level: 5 }] },
    { moduleId: 'engine', name: '机动', levels: [{ level: 1 }, { level: 2 }, { level: 3 }, { level: 4 }, { level: 5 }] },
    { moduleId: 'energy', name: '反应堆', levels: [{ level: 1 }, { level: 2 }, { level: 3 }, { level: 4 }, { level: 5 }] },
    { moduleId: 'bay', name: '弹仓', levels: [{ level: 1 }] },
    { moduleId: 'wing', name: '僚机', levels: [{ level: 1 }, { level: 2 }, { level: 3 }] },
  ],
});

const CAREER_KEYS = [
  'formula', 'shipId', 'shipName', 'maxLives', 'lifeCap', 'itemCap',
  'firepowerMul', 'damageMul', 'invul', 'magnet', 'energyCap', 'speedMul', 'owned',
];

const CLASSIC_KEYS = [
  'formula', 'hull', 'power', 'engine', 'energy', 'bay', 'wing',
  'maxLives', 'lifeCap', 'itemCap', 'firepower', 'damageMul',
  'invul', 'invulBonus', 'magnet', 'magnetBonus', 'energyCap', 'speed',
  'formationBaseCharges', 'formationDuration',
];

function shipOf(items, shipId) {
  return items.ships.filter((ship) => ship && ship.shipId === shipId)[0] || null;
}

/* ---------------------------------------------------------------- T-00 装载 / UMD / 静态约束 */

{
  check('T-00a 模块可 require 且为对象', !!combat && typeof combat === 'object');
  eq('T-00b FORMULA_VERSION = 2', combat.FORMULA_VERSION, 2);
  eq('T-00c CLASSIC_FORMULA_VERSION = 1', combat.CLASSIC_FORMULA_VERSION, 1);
  eq('T-00d 默认旧翼 ID', combat.DEFAULT_SHIP_ID, 'old-wing');
  eq('T-00e 默认旧翼名', combat.DEFAULT_SHIP_NAME, '旧翼');
  eq('T-00f EXPECTED_SHIP_IDS', combat.EXPECTED_SHIP_IDS, ['old-wing', 'cloud-lark', 'shield-whale', 'prism']);
  eq('T-00g EXPECTED_PRICES', combat.EXPECTED_PRICES,
    { 'old-wing': 260, 'cloud-lark': 480, 'shield-whale': 520, prism: 540 });
  eq('T-00h EXPECTED_PRICES 键顺序完整', Object.keys(combat.EXPECTED_PRICES).sort(),
    ['cloud-lark', 'old-wing', 'prism', 'shield-whale']);
  check('T-00i EXPECTED_PRICES 冻结', Object.isFrozen(combat.EXPECTED_PRICES));
  check('T-00j SAFE_LIMITS 冻结且分层', Object.isFrozen(combat.SAFE_LIMITS) &&
    Object.isFrozen(combat.SAFE_LIMITS.energyCap) &&
    Object.isFrozen(combat.SAFE_LIMITS.damageMul));
  eq('T-00k BUILTIN_MODULE_MAX', combat.BUILTIN_MODULE_MAX,
    { hull: 3, power: 5, engine: 5, energy: 5, bay: 1, wing: 3 });
  eq('T-00l DEFAULT_SHIP_NAMES', combat.DEFAULT_SHIP_NAMES,
    { 'old-wing': '旧翼', 'cloud-lark': '云雀', 'shield-whale': '盾鲸', prism: '棱镜' });
  check('T-00m 四个公开函数齐全', ['classicHangarStats', 'resolveCareerConfig', 'previewPurchase', 'clampLevels']
    .every((name) => typeof combat[name] === 'function'));
  check('T-00n Node require 不污染全局', typeof globalThis.ArcadeCareerCombatConfig === 'undefined');

  check('T-00o 源码声明浏览器挂载 window.ArcadeCareerCombatConfig',
    /root\.ArcadeCareerCombatConfig\s*=\s*api/.test(moduleSource));
  check('T-00p 源码镜像 window.ArcadeCareer.combatConfig（bridge 依赖约定）',
    /root\.ArcadeCareer\.combatConfig\s*=\s*api/.test(moduleSource));
  check('T-00q UMD Node 分支导出 factory()', /module\.exports\s*=\s*factory\(\)/.test(moduleSource));
  check('T-00r 无 DOM 依赖', !/\bdocument\b/.test(moduleSource));
  check('T-00s 无 localStorage / sessionStorage', !/\blocalStorage\b/.test(moduleSource) && !/\bsessionStorage\b/.test(moduleSource));
  check('T-00t 无 IndexedDB / GameMeta', !/\bindexedDB\b/.test(moduleSource) && !/\bGameMeta\b/.test(moduleSource));
  check('T-00u 无网络请求', !/\bfetch\s*\(/.test(moduleSource) && !/\bXMLHttpRequest\b/.test(moduleSource));
  check('T-00v 无 DOM 事件/定时器', !/\bsetTimeout\b/.test(moduleSource) &&
    !/\bsetInterval\b/.test(moduleSource) && !/\baddEventListener\b/.test(moduleSource));
  check('T-00w 无随机/时间依赖', !/Math\.random/.test(moduleSource) &&
    !/\bnew Date\b/.test(moduleSource) && !/Date\.now/.test(moduleSource));
  const codeOnly = moduleSource.split(/\r?\n/).filter((line) => {
    const text = line.trim();
    return !(text.startsWith('*') || text.startsWith('/*') || text.startsWith('//'));
  }).join('\n');
  check('T-00x 运行代码不使用 CommonJS require()', !/\brequire\s*\(/.test(codeOnly));

  const sandbox = { window: {} };
  vm.createContext(sandbox);
  let vmError = null;
  try {
    vm.runInContext(moduleSource, sandbox, { filename: 'star-combat-config.js', timeout: 5000 });
  } catch (err) {
    vmError = err;
  }
  check('T-00y 浏览器 UMD 求值不抛', !vmError, vmError && vmError.message);
  const mounted = sandbox.window.ArcadeCareerCombatConfig;
  check('T-00z window.ArcadeCareerCombatConfig 已挂载', !!mounted && mounted.FORMULA_VERSION === 2);
  check('T-00aa window.ArcadeCareer.combatConfig 为同一对象',
    !!sandbox.window.ArcadeCareer && sandbox.window.ArcadeCareer.combatConfig === mounted);
  let vmCallOk = false;
  try {
    vmCallOk = mounted.classicHangarStats({ upgrades: { hull: 1 } }).lifeCap === 6 &&
      mounted.previewPurchase({ ship: { shipId: 'old-wing', price: 260 }, wallet: { credits: 80 } }).creditShortfall === 180;
  } catch (err) {
    vmCallOk = false;
  }
  check('T-00ab 浏览器挂载后函数可调用', vmCallOk);

  check('T-00ac bridge DEPENDENCIES 声明 star-combat-config → combatConfig',
    /file:\s*'star-combat-config\.js',\s*global:\s*'combatConfig'/.test(bridgeSource));
}

/* ---------------------------------------------------------------- T-01 价格表与购买预览（纯计算） */

{
  const walletZero = { credits: 0, items: {} };
  const startWallet = { credits: 80, items: { alloy: 1, crystal: 1 } };
  ['old-wing', 'cloud-lark', 'shield-whale', 'prism'].forEach((shipId) => {
    const price = combat.EXPECTED_PRICES[shipId];
    const preview = combat.previewPurchase({
      ship: { shipId, price },
      wallet: startWallet,
    });
    check('T-01a ' + shipId + ' 价格回显', preview.price === price, 'price=' + preview.price);
    check('T-01b ' + shipId + ' 起始钱包不足（差额=' + (price - 80) + '）',
      preview.ok === false && preview.reason === 'insufficient-credits' &&
      preview.creditShortfall === price - 80,
      JSON.stringify(preview));
    eq('T-01c ' + shipId + ' expectedPrice 回显', preview.expectedPrice, price);
    check('T-01d ' + shipId + ' 预览不扣款（钱包对象不变）', startWallet.credits === 80);
  });

  const rich = combat.previewPurchase({
    ship: { shipId: 'old-wing', price: 260 },
    wallet: { credits: 300 },
  });
  check('T-01e 余额充足可购买', rich.ok === true && rich.reason === null && rich.creditShortfall === 0, JSON.stringify(rich));
  eq('T-01f 余额回显', rich.credits, 300);
  eq('T-01g 材料需求为空', rich.materials, {});
  eq('T-01h 缺料为空', rich.missingMaterials, {});

  const requiresShip = { shipId: 'prism', price: 540, requires: { alloy: 2, crystal: 1 } };
  const requiresPreview = combat.previewPurchase({ ship: requiresShip, wallet: { credits: 600, items: { alloy: 2 } } });
  check('T-01i2 requires 形状材料需求可识别',
    requiresPreview.reason === 'insufficient-materials' && requiresPreview.missingMaterials.crystal === 1,
    JSON.stringify(requiresPreview));

  const materialsShip = { shipId: 'prism', price: 540, materials: { alloy: 2, crystal: 1 } };
  const lackMaterial = combat.previewPurchase({ ship: materialsShip, wallet: { credits: 600, items: { alloy: 2 } } });
  check('T-01i 材料不足给出差额', lackMaterial.ok === false && lackMaterial.reason === 'insufficient-materials', JSON.stringify(lackMaterial));
  eq('T-01j 缺料表', lackMaterial.missingMaterials, { crystal: 1 });
  eq('T-01k 已满足材料不重复计入', lackMaterial.materials, { alloy: 2, crystal: 1 });
  eq('T-01l 材料不足时信用点差额为 0', lackMaterial.creditShortfall, 0);

  const enough = combat.previewPurchase({ ship: materialsShip, wallet: { credits: 600, items: { alloy: 2, crystal: 1 } } });
  check('T-01m 材料与余额都满足', enough.ok === true && enough.reason === null, JSON.stringify(enough));

  const bothLack = combat.previewPurchase({ ship: materialsShip, wallet: { credits: 100, items: {} } });
  check('T-01n 双重不足优先报余额', bothLack.reason === 'insufficient-credits' &&
    bothLack.creditShortfall === 440 && bothLack.missingMaterials.alloy === 2 && bothLack.missingMaterials.crystal === 1,
    JSON.stringify(bothLack));

  const owned = combat.previewPurchase({ ship: { shipId: 'old-wing', price: 260, owned: true }, wallet: { credits: 999 } });
  check('T-01o 已拥有不重复售卖', owned.ok === false && owned.reason === 'already-owned' && owned.owned === true, JSON.stringify(owned));

  const free = combat.previewPurchase({ ship: { shipId: 'old-wing', price: 0 }, wallet: walletZero });
  check('T-01p 零价免费机体可取得', free.ok === true && free.price === 0, JSON.stringify(free));

  const costObj = combat.previewPurchase({ ship: { shipId: 'cloud-lark', cost: { credits: 480, items: { alloy: 1 } } }, wallet: { credits: 480, items: { alloy: 1 } } });
  check('T-01q 兼容 cost{credits,items} 形状', costObj.ok === true && costObj.price === 480 && costObj.materials.alloy === 1, JSON.stringify(costObj));

  const invalidShip = combat.previewPurchase({ ship: null, wallet: { credits: 100 } });
  check('T-01r 缺失 ship 安全', invalidShip.ok === false && invalidShip.reason === 'invalid-ship', JSON.stringify(invalidShip));
  const invalidPrice = combat.previewPurchase({ ship: { shipId: 'old-wing', price: 'abc' }, wallet: { credits: 100 } });
  check('T-01s 非法价格安全', invalidPrice.ok === false && invalidPrice.reason === 'invalid-price', JSON.stringify(invalidPrice));
  const fractional = combat.previewPurchase({ ship: { shipId: 'old-wing', price: 260.5 }, wallet: { credits: 900 } });
  check('T-01t 非整数价格拒绝', fractional.reason === 'invalid-price', JSON.stringify(fractional));
  const overCap = combat.previewPurchase({ ship: { shipId: 'old-wing', price: combat.RULESET_MIRROR.maxPurchaseCost + 1 }, wallet: { credits: 99999999 } });
  check('T-01u 超过 RULESET 价格上限拒绝', overCap.reason === 'invalid-price', JSON.stringify(overCap));

  const unknownShip = combat.previewPurchase({ ship: { shipId: 'prototype', price: 100 }, wallet: { credits: 200 } });
  check('T-01v 未知舰无 expectedPrice 仍可预览', unknownShip.ok === true && unknownShip.expectedPrice === null, JSON.stringify(unknownShip));

  const badWallet = combat.previewPurchase({ ship: { shipId: 'old-wing', price: 260 }, wallet: 'nope' });
  check('T-01w 非法钱包安全归零', badWallet.credits === 0 && badWallet.creditShortfall === 260, JSON.stringify(badWallet));

  eq('T-01x 预览公式版本', rich.formula, 2);
  const unknownItems = combat.previewPurchase({
    ship: { shipId: 'old-wing', price: 100, materials: { alloy: 1 } },
    wallet: { credits: 100, items: { alloy: 1, 'bad:id': 9 } },
  });
  check('T-01x2 未知物品键安全忽略', unknownItems.ok === true &&
    JSON.stringify(unknownItems.materials) === JSON.stringify({ alloy: 1 }), JSON.stringify(unknownItems));
  const frozenWallet = deepFreeze({ credits: 100, items: { alloy: 2 } });
  const frozenShip = deepFreeze({ shipId: 'prism', price: 540, materials: { alloy: 2 } });
  let frozenThrew = false;
  try {
    combat.previewPurchase({ ship: frozenShip, wallet: frozenWallet });
  } catch (err) {
    frozenThrew = true;
  }
  check('T-01y 冻结输入可预览且不抛', !frozenThrew);
}

/* ---------------------------------------------------------------- T-02 经典公式逐项对照 star-raid 源码 */

let anchorsOk = true;
/* 先去掉注释：star-raid 的 moveSpeed() 等函数体内有说明注释，锚点只看可执行代码。
 * 用花括号配对取整个函数体（容忍 D16-04 可能在体内加 classic/career 分支，
 * 但 18.9 保证经典路径仍是同一 formula:1 常量）。 */
const sourceForAnchors = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '');
function grabBody(name) {
  const marker = 'function ' + name + '(';
  const start = sourceForAnchors.indexOf(marker);
  if (start < 0) return null;
  const braceStart = sourceForAnchors.indexOf('{', start);
  if (braceStart < 0) return null;
  let depth = 0;
  for (let i = braceStart; i < sourceForAnchors.length; i += 1) {
    const ch = sourceForAnchors[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return sourceForAnchors.slice(braceStart + 1, i).replace(/\s+/g, ' ').trim();
    }
  }
  return null;
}
function anchorNumber(label, text, re, group) {
  const match = text ? re.exec(text) : null;
  check(label, !!match, '源码锚点缺失：' + re + ' on ' + JSON.stringify(text));
  if (!match) {
    anchorsOk = false;
    return NaN;
  }
  const value = Number(match[group === undefined ? 1 : group]);
  if (!Number.isFinite(value)) {
    anchorsOk = false;
    check(label + '（数值）', false, '非数值锚点：' + match[0]);
  }
  return value;
}

const bodyStart = grabBody('startingLives');
const bodyCap = grabBody('maxLives');
const bodyItem = grabBody('itemCap');
const bodyDamage = grabBody('damageMul');
const bodyInvul = grabBody('invulSeconds');
const bodyMagnet = grabBody('magnetMultiplier');
const bodyEnergy = grabBody('energyCap');
const bodyWingCharges = grabBody('formationBaseCharges');
const bodyWingDuration = grabBody('formationDuration');
const bodyMoveSpeed = grabBody('moveSpeed');

check('T-02a 源码 startingLives 锚点', !!bodyStart, bodyStart);
check('T-02b 源码 maxLives 锚点', !!bodyCap, bodyCap);
check('T-02c 源码 itemCap 锚点', !!bodyItem, bodyItem);
check('T-02d 源码 damageMul 锚点', !!bodyDamage, bodyDamage);
check('T-02e 源码 invulSeconds 锚点', !!bodyInvul, bodyInvul);
check('T-02f 源码 magnetMultiplier 锚点', !!bodyMagnet, bodyMagnet);
check('T-02g 源码 energyCap 锚点', !!bodyEnergy, bodyEnergy);
check('T-02h 源码 formationBaseCharges 锚点', !!bodyWingCharges, bodyWingCharges);
check('T-02i 源码 formationDuration 锚点', !!bodyWingDuration, bodyWingDuration);
check('T-02j 源码 moveSpeed 锚点', !!bodyMoveSpeed, bodyMoveSpeed);
check('T-02ja 源码 moveSpeed 经典常量 320 仍在', !!bodyMoveSpeed && /(?:^|[^\d.])320(?:[^\d.]|$)/.test(bodyMoveSpeed), bodyMoveSpeed);

const SRC = {
  startBase: anchorNumber('T-02k startingLives 起始生命基数', bodyStart, /clamp\((\d+) \+ hangar\.upgrades\.hull, 1, maxLives\(\)\)/),
  capBase: anchorNumber('T-02l maxLives 上限基数', bodyCap, /(\d+) \+ hangar\.upgrades\.hull/),
  itemBase: anchorNumber('T-02m itemCap 基数', bodyItem, /(\d+) \+ hangar\.upgrades\.bay/),
  damageBase: anchorNumber('T-02n damageMul 基数', bodyDamage, /(\d+(?:\.\d+)?) \+ hangar\.upgrades\.power \* ([\d.]+)/, 1),
  damageStep: anchorNumber('T-02o damageMul 每级', bodyDamage, /(\d+(?:\.\d+)?) \+ hangar\.upgrades\.power \* ([\d.]+)/, 2),
  invulBase: anchorNumber('T-02p invulSeconds 基数', bodyInvul, /(\d+(?:\.\d+)?) \+ hangar\.upgrades\.engine \* ([\d.]+)/, 1),
  invulStep: anchorNumber('T-02q invulSeconds 每级', bodyInvul, /(\d+(?:\.\d+)?) \+ hangar\.upgrades\.engine \* ([\d.]+)/, 2),
  magnetBase: anchorNumber('T-02r magnetMultiplier 基数', bodyMagnet, /(\d+(?:\.\d+)?) \+ hangar\.upgrades\.engine \* ([\d.]+)/, 1),
  magnetStep: anchorNumber('T-02s magnetMultiplier 每级', bodyMagnet, /(\d+(?:\.\d+)?) \+ hangar\.upgrades\.engine \* ([\d.]+)/, 2),
  energyBase: anchorNumber('T-02t energyCap 基数', bodyEnergy, /(\d+(?:\.\d+)?) \+ hangar\.upgrades\.energy \* ([\d.]+)/, 1),
  energyStep: anchorNumber('T-02u energyCap 每级', bodyEnergy, /(\d+(?:\.\d+)?) \+ hangar\.upgrades\.energy \* ([\d.]+)/, 2),
  wingBase: anchorNumber('T-02v formationBaseCharges 基数', bodyWingCharges, /(\d+(?:\.\d+)?) \+ hangar\.upgrades\.wing(?!\s*\*)/),
  wingDurationBase: anchorNumber('T-02w formationDuration 基数', bodyWingDuration, /(\d+(?:\.\d+)?) \+ hangar\.upgrades\.wing \* ([\d.]+)/, 1),
  wingDurationStep: anchorNumber('T-02x formationDuration 每级', bodyWingDuration, /(\d+(?:\.\d+)?) \+ hangar\.upgrades\.wing \* ([\d.]+)/, 2),
  moveSpeed: 320,
};

/* 源码 HANGAR_UPGRADES[].max 与模块内置上限逐项一致 */
const sourceMax = {};
{
  const re = /\{\s*id:\s*'([a-z]+)',\s*name:\s*'[^']*',\s*icon:\s*'[^']*',\s*max:\s*(\d+),\s*costs:/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    if (!sourceMax[match[1]]) sourceMax[match[1]] = Number(match[2]);
  }
  eq('T-02z 源码六个机库改装', Object.keys(sourceMax).sort(), ['bay', 'energy', 'engine', 'hull', 'power', 'wing']);
  Object.keys(sourceMax).forEach((id) => {
    eq('T-02za ' + id + ' 上限与源码一致', combat.BUILTIN_MODULE_MAX[id], sourceMax[id]);
  });
  check('T-02zb 旧机库 formula 1 锁定仍在源码', /base\.formula = 1;/.test(source));
  check('T-02zc star-raid 未出现 formula 2', !/formula\s*:\s*2/.test(source));
}

function expectedClassic(levels) {
  const hull = levels.hull || 0;
  const power = levels.power || 0;
  const engine = levels.engine || 0;
  const energy = levels.energy || 0;
  const bay = levels.bay || 0;
  const wing = levels.wing || 0;
  return {
    formula: 1,
    hull, power, engine, energy, bay, wing,
    maxLives: SRC.startBase + hull,
    lifeCap: SRC.capBase + hull,
    itemCap: SRC.itemBase + bay,
    firepower: SRC.damageBase + power * SRC.damageStep,
    damageMul: SRC.damageBase + power * SRC.damageStep,
    invul: SRC.invulBase + engine * SRC.invulStep,
    invulBonus: SRC.invulStep * engine,
    magnet: SRC.magnetBase + engine * SRC.magnetStep,
    magnetBonus: SRC.magnetStep * engine,
    energyCap: SRC.energyBase + energy * SRC.energyStep,
    speed: SRC.moveSpeed,
    formationBaseCharges: SRC.wingBase + wing,
    formationDuration: SRC.wingDurationBase + wing * SRC.wingDurationStep,
  };
}

const CORE_CLASSIC_FIELDS = ['maxLives', 'lifeCap', 'itemCap', 'firepower', 'damageMul', 'invul', 'magnet', 'energyCap'];
const EXTRA_CLASSIC_FIELDS = ['invulBonus', 'magnetBonus', 'speed', 'formationBaseCharges', 'formationDuration'];

if (anchorsOk) {
  const scenarios = [
    ['zero', Object.assign({}, ZERO_LEVELS)],
    ['all-max', { hull: 3, power: 5, engine: 5, energy: 5, bay: 1, wing: 3 }],
    ['mixed', { hull: 1, power: 2, engine: 3, energy: 4, bay: 1, wing: 2 }],
  ];
  Object.keys(ZERO_LEVELS).forEach((id) => {
    const max = combat.BUILTIN_MODULE_MAX[id];
    const mid = max >= 2 ? Math.floor(max / 2) : 1;
    scenarios.push([id + '-mid', Object.assign({}, ZERO_LEVELS, { [id]: mid })]);
    scenarios.push([id + '-max', Object.assign({}, ZERO_LEVELS, { [id]: max })]);
  });

  scenarios.forEach(([label, levels]) => {
    const hangar = { v: 1, formula: 1, credits: 1234, runs: 7, best: 999, upgrades: levels };
    const actual = combat.classicHangarStats(hangar);
    const expected = expectedClassic(levels);
    eq('T-02zd ' + label + ' 等级回显', pick(actual, ['formula', 'hull', 'power', 'engine', 'energy', 'bay', 'wing']),
      pick(expected, ['formula', 'hull', 'power', 'engine', 'energy', 'bay', 'wing']));
    CORE_CLASSIC_FIELDS.forEach((field) => {
      eq('T-02ze ' + label + ' ' + field, actual[field], expected[field]);
    });
    eq('T-02zf ' + label + ' 额外项', pick(actual, EXTRA_CLASSIC_FIELDS), pick(expected, EXTRA_CLASSIC_FIELDS));
  });

  eq('T-02zg 经典字段集合', Object.keys(combat.classicHangarStats(null)).sort(), CLASSIC_KEYS.slice().sort());
  check('T-02zh 零等级与旧机库基线一致',
    combat.classicHangarStats(null).maxLives === 3 &&
    combat.classicHangarStats(null).lifeCap === 5 &&
    combat.classicHangarStats(null).itemCap === 2 &&
    combat.classicHangarStats(null).energyCap === 100);
}

{
  /* 输入形状/边界：与 star-raid sanitizeHangar() 的兼容语义一致 */
  eq('T-02zi null hangar 全 0', pick(combat.classicHangarStats(null), ['hull', 'power', 'engine', 'energy', 'bay', 'wing']), ZERO_LEVELS);
  eq('T-02zj 非对象 hangar 全 0', pick(combat.classicHangarStats('bad'), ['hull', 'power', 'engine', 'energy', 'bay', 'wing']), ZERO_LEVELS);
  eq('T-02zk upgrades 非对象 全 0', pick(combat.classicHangarStats({ upgrades: 'bad' }), ['hull', 'power', 'engine', 'energy', 'bay', 'wing']), ZERO_LEVELS);
  eq('T-02zl 字符串等级可解析', combat.classicHangarStats({ upgrades: { hull: '2' } }).hull, 2);
  eq('T-02zm 小数向下取整', combat.classicHangarStats({ upgrades: { hull: 2.9 } }).hull, 2);
  eq('T-02zn 负数夹 0', combat.classicHangarStats({ upgrades: { hull: -5 } }).hull, 0);
  eq('T-02zo 超上限夹到 max', combat.classicHangarStats({ upgrades: { hull: 99 } }).hull, 3);
  eq('T-02zp Infinity 夹到 max（同旧 clamp）', combat.classicHangarStats({ upgrades: { hull: Infinity } }).hull, 3);
  eq('T-02zq NaN 归 0（同旧 clamp）', combat.classicHangarStats({ upgrades: { hull: NaN } }).hull, 0);
  eq('T-02zr 旧 credits/runs 不影响参数', combat.classicHangarStats({ credits: 999999, runs: 42, best: 7, upgrades: { power: 1 } }).firepower,
    combat.classicHangarStats({ upgrades: { power: 1 } }).firepower);
  eq('T-02zs formula 恒为 1', combat.classicHangarStats({ formula: 2, upgrades: { hull: 3 } }).formula, 1);

  const frozenHangar = deepFreeze({ v: 1, formula: 1, credits: 10, upgrades: { hull: 2, power: 1, engine: 3, energy: 2, bay: 1, wing: 1 } });
  const before = snapshot(frozenHangar);
  let readOnlyThrew = false;
  let frozenStats = null;
  try {
    frozenStats = combat.classicHangarStats(frozenHangar);
  } catch (err) {
    readOnlyThrew = true;
  }
  check('T-02zt 冻结 hangar 只读不抛', !readOnlyThrew && !!frozenStats);
  eq('T-02zu 只读不改输入', snapshot(frozenHangar), before);
  const fresh = combat.classicHangarStats(frozenHangar);
  fresh.hull = 99;
  eq('T-02zv 每次返回新对象', combat.classicHangarStats(frozenHangar).hull, frozenHangar.upgrades.hull);
  check('T-02zw 忽略第二参数（不读装备）',
    JSON.stringify(combat.classicHangarStats({ upgrades: { hull: 1 } }, { equipment: { equippedShip: 'prism' } })) ===
    JSON.stringify(combat.classicHangarStats({ upgrades: { hull: 1 } })));
}

/* ---------------------------------------------------------------- T-03 生涯默认回退 / 租用可玩 */

const CAREER_BASE_EXPECTED = {
  formula: 2,
  shipId: 'old-wing',
  shipName: '旧翼',
  maxLives: 3,
  lifeCap: 5,
  itemCap: 2,
  firepowerMul: 1,
  damageMul: 1,
  invul: 1.8,
  magnet: 1,
  energyCap: 100,
  speedMul: 1,
  owned: false,
};

{
  eq('T-03a 无参数回退旧翼默认', combat.resolveCareerConfig(), CAREER_BASE_EXPECTED);
  eq('T-03b null 回退默认', combat.resolveCareerConfig(null), CAREER_BASE_EXPECTED);
  eq('T-03c 字符串回退默认', combat.resolveCareerConfig('bad'), CAREER_BASE_EXPECTED);
  eq('T-03d 数组回退默认', combat.resolveCareerConfig([]), CAREER_BASE_EXPECTED);
  eq('T-03e 垃圾字段回退默认', combat.resolveCareerConfig({ equipment: 'x', items: 5, shipId: 7, modules: 'bad' }), CAREER_BASE_EXPECTED);
  eq('T-03f 生涯字段集合', Object.keys(combat.resolveCareerConfig()).sort(), CAREER_KEYS.slice().sort());
  check('T-03g formula 恒为 2', combat.resolveCareerConfig().formula === 2);

  eq('T-03h 无装备时 equippedShip 不存在 → 旧翼 owned:false',
    combat.resolveCareerConfig({ items: FIXTURE_ITEMS }).shipId, 'old-wing');
  check('T-03i 无装备时旧翼不可声称拥有', combat.resolveCareerConfig({ items: FIXTURE_ITEMS }).owned === false);

  const ownedOld = combat.resolveCareerConfig({
    items: FIXTURE_ITEMS,
    equipment: { equippedShip: 'old-wing', 'ship:old-wing:owned': true },
  });
  check('T-03j 装备里 owned 生效', ownedOld.owned === true && ownedOld.shipId === 'old-wing');

  const rented = combat.resolveCareerConfig({
    items: FIXTURE_ITEMS,
    equipment: { equippedShip: 'cloud-lark' },
  });
  check('T-03k 租用路径可出战（owned:false 仍返回完整参数）',
    rented.shipId === 'cloud-lark' && rented.owned === false &&
    rented.maxLives === 3 && rented.energyCap === 95, JSON.stringify(rented));

  eq('T-03l 未知 equippedShip 回退旧翼',
    combat.resolveCareerConfig({ items: FIXTURE_ITEMS, equipment: { equippedShip: 'ghost-ship' } }).shipId, 'old-wing');
  check('T-03m 未知 equippedShip owned:false',
    combat.resolveCareerConfig({ items: FIXTURE_ITEMS, equipment: { equippedShip: 'ghost-ship' } }).owned === false);
  eq('T-03n 未知显式 shipId 回退旧翼',
    combat.resolveCareerConfig({ items: FIXTURE_ITEMS, shipId: 'ghost-ship' }).shipId, 'old-wing');
  eq('T-03o 无内容时云雀视为未知回退旧翼',
    combat.resolveCareerConfig({ equipment: { equippedShip: 'cloud-lark' } }).shipId, 'old-wing');

  const fakeHangar = { v: 1, formula: 1, credits: 999999, runs: 88, upgrades: { hull: 3, power: 5, engine: 5, energy: 5, bay: 1, wing: 3 } };
  const noHangar = combat.resolveCareerConfig({ items: FIXTURE_ITEMS, equipment: { equippedShip: 'prism', 'ship:prism:owned': true } });
  const withHangar = combat.resolveCareerConfig({
    items: FIXTURE_ITEMS,
    equipment: { equippedShip: 'prism', 'ship:prism:owned': true, hangar: fakeHangar, upgrades: fakeHangar.upgrades },
    hangar: fakeHangar,
  });
  eq('T-03p 传入假 hangar 不改变生涯结果', withHangar, noHangar);
  check('T-03q 生涯参数不受旧机库满级影响',
    withHangar.maxLives === 3 && withHangar.firepowerMul === 1.12 && withHangar.energyCap === 90);

  const fakeItems = { credits: 500, upgrades: { hull: 3 } };
  eq('T-03r 旧机库字段冒充 items 不影响', combat.resolveCareerConfig({ items: fakeItems }), CAREER_BASE_EXPECTED);

  const equipmentOnlyModules = combat.resolveCareerConfig({ equipment: { 'module:hull:level': 1 } });
  check('T-03s 无内容但有内置模块等级仍生效', equipmentOnlyModules.maxLives === 4 && equipmentOnlyModules.lifeCap === 6,
    JSON.stringify(equipmentOnlyModules));
}

/* ---------------------------------------------------------------- T-04 四舰参数差异 */

{
  const baseItems = FIXTURE_ITEMS;
  const oldWing = combat.resolveCareerConfig({
    items: baseItems,
    equipment: { equippedShip: 'old-wing', 'ship:old-wing:owned': true },
  });
  eq('T-04a 旧翼与经典基线一致', pick(oldWing, ['maxLives', 'lifeCap', 'itemCap', 'firepowerMul', 'damageMul', 'invul', 'magnet', 'energyCap', 'speedMul']),
    { maxLives: 3, lifeCap: 5, itemCap: 2, firepowerMul: 1, damageMul: 1, invul: 1.8, magnet: 1, energyCap: 100, speedMul: 1 });

  const cloudLark = combat.resolveCareerConfig({
    items: baseItems,
    equipment: { equippedShip: 'cloud-lark', 'ship:cloud-lark:owned': true },
  });
  eq('T-04b 云雀参数', pick(cloudLark, ['maxLives', 'lifeCap', 'energyCap', 'damageMul', 'speedMul', 'magnet', 'owned']),
    { maxLives: 3, lifeCap: 5, energyCap: 95, damageMul: 1.06, speedMul: 1.12, magnet: 1.06, owned: true });

  const shieldWhale = combat.resolveCareerConfig({
    items: baseItems,
    equipment: { equippedShip: 'shield-whale', 'ship:shield-whale:owned': true },
  });
  eq('T-04c 盾鲸参数', pick(shieldWhale, ['maxLives', 'lifeCap', 'energyCap', 'damageMul', 'speedMul', 'magnet', 'owned']),
    { maxLives: 4, lifeCap: 6, energyCap: 110, damageMul: 1, speedMul: 1, magnet: 1.03, owned: true });

  const prism = combat.resolveCareerConfig({
    items: baseItems,
    equipment: { equippedShip: 'prism', 'ship:prism:owned': true },
  });
  eq('T-04d 棱镜参数', pick(prism, ['maxLives', 'lifeCap', 'energyCap', 'damageMul', 'speedMul', 'magnet', 'owned']),
    { maxLives: 3, lifeCap: 5, energyCap: 90, damageMul: 1.12, speedMul: 1.06, magnet: 1.12, owned: true });

  const seen = new Set([oldWing, cloudLark, shieldWhale, prism].map((config) => JSON.stringify(config)));
  check('T-04e 四舰配置两两不同', seen.size === 4);

  const rentCloud = combat.resolveCareerConfig({ items: baseItems, equipment: { equippedShip: 'cloud-lark' } });
  check('T-04f 云雀租用可玩', rentCloud.owned === false && rentCloud.shipId === 'cloud-lark' &&
    rentCloud.speedMul === 1.12 && rentCloud.energyCap === 95, JSON.stringify(rentCloud));

  const missingNameItems = {
    ships: [
      { shipId: 'prism', price: 540, stats: { energy: 110 } },
      { shipId: 'cloud-lark', name: '', price: 480, stats: {} },
    ],
  };
  eq('T-04g 缺 name 用默认中文名', combat.resolveCareerConfig({ items: missingNameItems, shipId: 'prism' }).shipName, '棱镜');
  eq('T-04h 空 name 用默认中文名', combat.resolveCareerConfig({ items: missingNameItems, shipId: 'cloud-lark' }).shipName, '云雀');

  const duplicateItems = {
    ships: [
      { shipId: 'prism', name: '棱镜', stats: { energy: 110 } },
      { shipId: 'prism', name: '棱镜改', stats: { energy: 200 } },
    ],
  };
  eq('T-04i 重复 shipId 首次生效', combat.resolveCareerConfig({ items: duplicateItems, shipId: 'prism' }).energyCap, 110);

  const weirdItems = { ships: [{ shipId: 'bad:id', name: '坏', stats: {} }, null, 'x', { shipId: 42 }] };
  eq('T-04j 非法 ship 条目安全', combat.resolveCareerConfig({ items: weirdItems, shipId: 'bad:id' }).shipId, 'old-wing');
  const notArray = { ships: 'bad' };
  eq('T-04k ships 非数组安全', combat.resolveCareerConfig({ items: notArray }), CAREER_BASE_EXPECTED);
}

/* ---------------------------------------------------------------- T-05 模块等级 / 覆盖 / 未知安全 */

{
  const allOne = {
    'module:hull:level': 1,
    'module:power:level': 1,
    'module:engine:level': 1,
    'module:energy:level': 1,
    'module:bay:level': 1,
  };
  const oneEach = combat.resolveCareerConfig({ items: FIXTURE_ITEMS, equipment: allOne });
  eq('T-05a 每模块 1 级', pick(oneEach, ['maxLives', 'lifeCap', 'itemCap', 'damageMul', 'invul', 'magnet', 'energyCap']),
    { maxLives: 4, lifeCap: 6, itemCap: 3, damageMul: 1.06, invul: 1.92, magnet: 1.06, energyCap: 110 });
  check('T-05b 模块不改变 firepowerMul（船体固有）', oneEach.firepowerMul === 1);
  check('T-05c 模块等级不改变 owned', oneEach.owned === false);

  const allMax = combat.resolveCareerConfig({
    items: FIXTURE_ITEMS,
    equipment: {
      'module:hull:level': 3,
      'module:power:level': 5,
      'module:engine:level': 5,
      'module:energy:level': 5,
      'module:bay:level': 1,
      'module:wing:level': 3,
    },
  });
  eq('T-05d 全模块满级', pick(allMax, ['maxLives', 'lifeCap', 'itemCap', 'damageMul', 'invul', 'magnet', 'energyCap']),
    { maxLives: 6, lifeCap: 8, itemCap: 3, damageMul: 1.3, invul: 2.4, magnet: 1.3, energyCap: 150 });

  const overMax = combat.resolveCareerConfig({
    items: FIXTURE_ITEMS,
    equipment: { 'module:hull:level': 99, 'module:power:level': 99, 'module:energy:level': 99 },
  });
  eq('T-05e 超上限夹到 max', pick(overMax, ['maxLives', 'lifeCap', 'damageMul', 'energyCap']),
    { maxLives: 6, lifeCap: 8, damageMul: 1.3, energyCap: 150 });

  const negatives = combat.resolveCareerConfig({
    items: FIXTURE_ITEMS,
    equipment: { 'module:hull:level': -3, 'module:power:level': -2, 'module:energy:level': -9 },
  });
  check('T-05f 负数等级归 0', negatives.maxLives === 3 && negatives.damageMul === 1 && negatives.energyCap === 100);
  const nanLevel = combat.resolveCareerConfig({ items: FIXTURE_ITEMS, equipment: { 'module:hull:level': NaN, 'module:power:level': 'abc' } });
  check('T-05g NaN/非数字等级归 0', nanLevel.maxLives === 3 && nanLevel.damageMul === 1);
  const stringLevel = combat.resolveCareerConfig({ items: FIXTURE_ITEMS, equipment: { 'module:hull:level': '2', 'module:power:level': '3' } });
  check('T-05h 数字字符串等级可解析', stringLevel.maxLives === 5 && stringLevel.lifeCap === 7 && stringLevel.damageMul === 1.18,
    JSON.stringify(stringLevel));
  check('T-05i 小数等级向下取整',
    combat.resolveCareerConfig({ items: FIXTURE_ITEMS, equipment: { 'module:hull:level': 2.9 } }).maxLives === 5);

  const unknownModule = combat.resolveCareerConfig({ items: FIXTURE_ITEMS, equipment: { 'module:warp:level': 9 } });
  eq('T-05j 未知模块忽略', unknownModule, CAREER_BASE_EXPECTED);

  /* 内容 max 显式声明优先于 levels 长度 */
  const maxOverrideItems = {
    ships: [{ shipId: 'old-wing', name: '旧翼', stats: {} }],
    modules: [
      { moduleId: 'power', max: 2, levels: [{ level: 1 }, { level: 2 }, { level: 3 }, { level: 4 }, { level: 5 }] },
    ],
  };
  const maxOverride = combat.resolveCareerConfig({ items: maxOverrideItems, equipment: { 'module:power:level': 9 } });
  check('T-05k 内容 max 限制等级', maxOverride.damageMul === 1.12, JSON.stringify(maxOverride));

  /* 显式 stats 覆盖同键内置增量，未覆盖的键继续用内置增量 */
  const overrideItems = {
    ships: [{ shipId: 'old-wing', name: '旧翼', stats: {} }],
    modules: [
      { moduleId: 'hull', levels: [{ level: 1, stats: { lives: 2 } }, { level: 2, stats: { lifeCap: 3 } }] },
    ],
  };
  const hullOne = combat.resolveCareerConfig({ items: overrideItems, equipment: { 'module:hull:level': 1 } });
  check('T-05l 模块 stats 覆盖 lives 增量', hullOne.maxLives === 5 && hullOne.lifeCap === 6, JSON.stringify(hullOne));
  const hullTwo = combat.resolveCareerConfig({ items: overrideItems, equipment: { 'module:hull:level': 2 } });
  check('T-05m 模块 stats 按级线性叠加（每级增量 × 等级）', hullTwo.maxLives === 5 && hullTwo.lifeCap === 11, JSON.stringify(hullTwo));

  /* 非内置模块 ID + 显式 stats 增量 */
  const altItems = {
    ships: [{ shipId: 'old-wing', name: '旧翼', stats: {} }],
    modules: [
      { moduleId: 'armor', levels: [{ level: 1, stats: { lives: 1, invul: 0.2 } }, { level: 2, stats: { lives: 1, invul: 0.2 } }] },
      { moduleId: 'reactor', levels: [{ level: 1, stats: { energy: 20 } }] },
    ],
  };
  const armor = combat.resolveCareerConfig({ items: altItems, equipment: { 'module:armor:level': 2 } });
  check('T-05n 未知 ID 的内容 stats 按级生效', armor.maxLives === 5 && armor.invul === 2.2, JSON.stringify(armor));
  const reactor = combat.resolveCareerConfig({ items: altItems, equipment: { 'module:reactor:level': 1 } });
  check('T-05o energy 别名映射到 energyCap', reactor.energyCap === 120, JSON.stringify(reactor));

  /* levels 缺 level 字段时按数组顺序 */
  const noLevelItems = {
    ships: [{ shipId: 'old-wing', name: '旧翼', stats: {} }],
    modules: [{ moduleId: 'armor2', levels: [{ stats: { lives: 1 } }] }],
  };
  const noLevel = combat.resolveCareerConfig({ items: noLevelItems, equipment: { 'module:armor2:level': 1 } });
  check('T-05p levels 缺 level 字段按顺序', noLevel.maxLives === 4, JSON.stringify(noLevel));

  /* wing 只影响编队，不影响机体参数 */
  const wingOnly = combat.resolveCareerConfig({ items: FIXTURE_ITEMS, equipment: { 'module:wing:level': 3 } });
  eq('T-05q wing 不改变机体参数', wingOnly, CAREER_BASE_EXPECTED);

  /* modules 参数可覆盖 items.modules */
  const overrideCatalog = [
    { moduleId: 'power', levels: [{ level: 1 }] },
  ];
  const withOverride = combat.resolveCareerConfig({
    items: FIXTURE_ITEMS,
    modules: overrideCatalog,
    equipment: { 'module:power:level': 1, 'module:energy:level': 1 },
  });
  check('T-05r modules 参数覆盖内容目录', withOverride.damageMul === 1.06 && withOverride.energyCap === 110,
    JSON.stringify(withOverride));

  /* clampLevels 三种输入形状 */
  eq('T-05s clampLevels 扁平 equipment', combat.clampLevels({ 'module:hull:level': 9, 'module:power:level': 2 }, null),
    { hull: 3, power: 2 });
  eq('T-05t clampLevels 普通映射', combat.clampLevels({ hull: 2, energy: 4 }, FIXTURE_ITEMS.modules),
    { hull: 2, energy: 4 });
  eq('T-05u clampLevels 数组', combat.clampLevels([{ moduleId: 'bay', level: 2 }, { moduleId: 'engine', level: 1 }], FIXTURE_ITEMS.modules),
    { bay: 1, engine: 1 });
  eq('T-05u2 clampLevels 数组目录按内容 max 限制',
    combat.clampLevels({ power: 5 }, [{ moduleId: 'power', levels: [{ level: 1 }] }]), { power: 1 });
  eq('T-05v clampLevels 未知模块丢弃', combat.clampLevels({ 'module:ghost:level': 1, 'module:hull:level': 1 }), { hull: 1 });
  eq('T-05w clampLevels 非法输入空对象', combat.clampLevels(null), {});
  eq('T-05x clampLevels 忽略 ship/equippedShip 键', combat.clampLevels({ 'ship:hull:owned': true, equippedShip: 'old-wing', 'module:hull:level': 1 }),
    { hull: 1 });
  eq('T-05y clampLevels 负数归 0', combat.clampLevels({ 'module:hull:level': -2 }), { hull: 0 });
}

/* ---------------------------------------------------------------- T-06 数值上限与 energyCap */

{
  const HARD_ITEMS = deepFreeze({
    ships: [
      {
        shipId: 'prism',
        name: '棱镜',
        stats: { lives: 999, lifeCap: 999, itemCap: 999, energy: 9999, firepower: 99, speed: 99, magnet: 99, invul: 99, damage: 99 },
      },
      {
        shipId: 'old-wing',
        name: '旧翼',
        stats: { lives: -5, lifeCap: -10, energy: -50, firepower: -2, speed: -1, magnet: -1, invul: -3, damage: -1 },
      },
    ],
    modules: [
      { moduleId: 'power', levels: [{ level: 1, stats: { damage: 50 } }, { level: 2, stats: { damage: 500 } }] },
    ],
  });
  const hard = combat.resolveCareerConfig({ items: HARD_ITEMS, shipId: 'prism' });
  eq('T-06a 上限夹紧', pick(hard, ['maxLives', 'lifeCap', 'itemCap', 'firepowerMul', 'damageMul', 'invul', 'magnet', 'energyCap', 'speedMul']),
    { maxLives: 9, lifeCap: 12, itemCap: 5, firepowerMul: 3, damageMul: 3.5, invul: 6, magnet: 3, energyCap: 260, speedMul: 2 });

  const hardModules = combat.resolveCareerConfig({ items: HARD_ITEMS, shipId: 'prism', equipment: { 'module:power:level': 2 } });
  check('T-06b 模块异常增量仍夹紧', hardModules.damageMul === 3.5 && hardModules.energyCap === 260, JSON.stringify(hardModules));

  const floor = combat.resolveCareerConfig({ items: HARD_ITEMS, shipId: 'old-wing' });
  eq('T-06c 下限夹紧', pick(floor, ['maxLives', 'lifeCap', 'itemCap', 'firepowerMul', 'damageMul', 'invul', 'magnet', 'energyCap', 'speedMul']),
    { maxLives: 1, lifeCap: 1, itemCap: 2, firepowerMul: 0.5, damageMul: 0.5, invul: 0, magnet: 0.5, energyCap: 60, speedMul: 0.5 });

  const nanItems = {
    ships: [{ shipId: 'prism', name: '棱镜', stats: { lives: NaN, energy: Infinity, firepower: 'abc', magnet: null, speed: true } },
      { shipId: 'old-wing', name: '旧翼', stats: {} }],
  };
  const nanShip = combat.resolveCareerConfig({ items: nanItems, shipId: 'old-wing' });
  eq('T-06d NaN/非法 stat 回退默认', pick(nanShip, ['maxLives', 'energyCap', 'firepowerMul', 'magnet', 'speedMul']),
    { maxLives: 3, energyCap: 100, firepowerMul: 1, magnet: 1, speedMul: 1 });
  const infShip = combat.resolveCareerConfig({
    items: { ships: [{ shipId: 'prism', name: '棱镜', stats: { lives: Infinity, energy: Infinity, firepower: Infinity } }] },
    shipId: 'prism',
  });
  check('T-06e Infinity stat 夹到上限', infShip.maxLives === 9 && infShip.energyCap === 260 && infShip.firepowerMul === 3,
    JSON.stringify(infShip));

  const lifeCapItems = { ships: [{ shipId: 'prism', name: '棱镜', stats: { lives: 9, lifeCap: 1 } }] };
  const lifeCapShip = combat.resolveCareerConfig({ items: lifeCapItems, shipId: 'prism' });
  check('T-06f lifeCap 不得低于 maxLives', lifeCapShip.maxLives === 9 && lifeCapShip.lifeCap === 9, JSON.stringify(lifeCapShip));

  const lowCap = combat.resolveCareerConfig({
    items: { ships: [{ shipId: 'prism', name: '棱镜', stats: { lives: 2, lifeCap: 2 } }] },
    shipId: 'prism',
  });
  check('T-06g 显式低 lifeCap 生效', lowCap.maxLives === 2 && lowCap.lifeCap === 2);

  const itemCapItems = { ships: [{ shipId: 'prism', name: '棱镜', stats: { itemCap: 0 } }] };
  check('T-06h itemCap 下限 1', combat.resolveCareerConfig({ items: itemCapItems, shipId: 'prism' }).itemCap === 1);
  const bigItemCap = combat.resolveCareerConfig({ items: HARD_ITEMS, shipId: 'prism' });
  check('T-06i itemCap 上限 5', bigItemCap.itemCap === 5);
  check('T-06j energyCap 上限为 260', hard.energyCap === 260);
  check('T-06k energyCap 下限为 60', floor.energyCap === 60);

  const stringStats = { ships: [{ shipId: 'prism', name: '棱镜', stats: { lives: '4', energy: '120', firepower: '0.1', speed: '0.2', magnet: '0.3' } }] };
  eq('T-06l 数字字符串 stat 可解析', pick(combat.resolveCareerConfig({ items: stringStats, shipId: 'prism' }),
    ['maxLives', 'energyCap', 'damageMul', 'speedMul', 'magnet']),
    { maxLives: 4, energyCap: 120, damageMul: 1.1, speedMul: 1.2, magnet: 1.3 });
}

/* ---------------------------------------------------------------- T-07 纯函数 / 确定性 / 不写存储 */

{
  const frozenItems = deepFreeze(FIXTURE_ITEMS);
  const frozenEquipment = deepFreeze({
    equippedShip: 'shield-whale',
    'ship:shield-whale:owned': true,
    'module:hull:level': 2,
    'module:power:level': 3,
  });
  const itemsBefore = snapshot(frozenItems);
  const equipmentBefore = snapshot(frozenEquipment);
  let purityThrew = false;
  let purityResult = null;
  try {
    purityResult = combat.resolveCareerConfig({ items: frozenItems, equipment: frozenEquipment, hangar: deepFreeze({ upgrades: { hull: 3 } }) });
  } catch (err) {
    purityThrew = true;
  }
  check('T-07a 冻结输入不抛', !purityThrew);
  eq('T-07b 不修改 items', snapshot(frozenItems), itemsBefore);
  eq('T-07c 不修改 equipment', snapshot(frozenEquipment), equipmentBefore);
  check('T-07d 结果为普通对象', purityResult && typeof purityResult === 'object' && purityResult.formula === 2);
  const again = combat.resolveCareerConfig({ items: FIXTURE_ITEMS, equipment: { equippedShip: 'shield-whale', 'ship:shield-whale:owned': true, 'module:hull:level': 2, 'module:power:level': 3 } });
  eq('T-07e 重复调用确定性一致', again, purityResult);

  /* owned 只看 ship:<id>:owned === true，不接受 truthy 字符串 */
  const truthy = combat.resolveCareerConfig({ items: FIXTURE_ITEMS, equipment: { equippedShip: 'prism', 'ship:prism:owned': 'true' } });
  check('T-07f owned 严格要求布尔 true', truthy.owned === false);
  const ownedTrue = combat.resolveCareerConfig({ items: FIXTURE_ITEMS, equipment: { equippedShip: 'prism', 'ship:prism:owned': true } });
  check('T-07g owned 布尔 true 生效', ownedTrue.owned === true);

  /* 返回对象字段都是合法类型 */
  const sample = combat.resolveCareerConfig({ items: FIXTURE_ITEMS, equipment: { equippedShip: 'prism' } });
  const ints = { maxLives: sample.maxLives, lifeCap: sample.lifeCap, itemCap: sample.itemCap, energyCap: sample.energyCap };
  check('T-07h 整数字段为整数',
    Object.keys(ints).every((key) => Number.isInteger(ints[key]) && ints[key] > 0), JSON.stringify(ints));
  const floats = { firepowerMul: sample.firepowerMul, damageMul: sample.damageMul, invul: sample.invul, magnet: sample.magnet, speedMul: sample.speedMul };
  check('T-07i 倍率字段为有限数',
    Object.keys(floats).every((key) => Number.isFinite(floats[key]) && floats[key] >= 0), JSON.stringify(floats));
  check('T-07j 文本字段为字符串', typeof sample.shipId === 'string' && typeof sample.shipName === 'string' && sample.shipName.length > 0);
  check('T-07k owned 为布尔', typeof sample.owned === 'boolean');
  check('T-07l 模块不改变 formula', combat.resolveCareerConfig({ items: FIXTURE_ITEMS, equipment: { 'module:hull:level': 3 } }).formula === 2);
}

/* ---------------------------------------------------------------- T-08 RULESET 对齐与价格上限 */

{
  let core = null;
  try {
    core = require(CORE_PATH);
  } catch (err) {
    core = null;
  }
  check('T-08a career-core 可 require', !!core && !!core.RULESET);
  eq('T-08b 价格上限镜像 RULESET.maxPurchaseCost',
    combat.RULESET_MIRROR.maxPurchaseCost, core && core.RULESET ? core.RULESET.maxPurchaseCost : -1);
  eq('T-08c 单物品上限镜像 RULESET.itemCapPerItem',
    combat.RULESET_MIRROR.itemCapPerItem, core && core.RULESET ? core.RULESET.itemCapPerItem : -1);
  check('T-08d RULESET_MIRROR 冻结', Object.isFrozen(combat.RULESET_MIRROR));
  check('T-08e 价格表均为正整数',
    Object.keys(combat.EXPECTED_PRICES).every((shipId) => Number.isInteger(combat.EXPECTED_PRICES[shipId]) && combat.EXPECTED_PRICES[shipId] > 0));
  check('T-08f 价格不超过 RULESET 上限',
    Object.keys(combat.EXPECTED_PRICES).every((shipId) => combat.EXPECTED_PRICES[shipId] <= combat.RULESET_MIRROR.maxPurchaseCost));
  check('T-08g 价格高于初始钱包（需先赚取）',
    Object.keys(combat.EXPECTED_PRICES).every((shipId) => combat.EXPECTED_PRICES[shipId] > (core && core.RULESET ? core.RULESET.initialCredits : 80)));

  const capPrice = combat.previewPurchase({
    ship: { shipId: 'prototype', price: combat.RULESET_MIRROR.maxPurchaseCost },
    wallet: { credits: combat.RULESET_MIRROR.maxPurchaseCost },
  });
  check('T-08h 恰好等于上限仍可预览', capPrice.ok === true && capPrice.price === combat.RULESET_MIRROR.maxPurchaseCost);
}

/* ---------------------------------------------------------------- T-09 items.json 内容对齐（未落地则 SKIP） */

{
  let itemsContent = null;
  try {
    itemsContent = JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf8'));
  } catch (err) {
    itemsContent = null;
  }
  if (!itemsContent) {
    skip('T-09 内容对齐 items.json', '尚未落地（D16-06 并行创建），已用 EXPECTED_PRICES 夹具覆盖');
  } else {
    check('T-09a items.json 可解析', !!itemsContent && typeof itemsContent === 'object');
    check('T-09b ships 为数组', Array.isArray(itemsContent.ships));
    check('T-09c modules 为数组', Array.isArray(itemsContent.modules));
    const contentShips = Array.isArray(itemsContent.ships) ? itemsContent.ships : [];
    const byId = {};
    contentShips.forEach((ship) => {
      if (ship && typeof ship.shipId === 'string') byId[ship.shipId] = ship;
    });
    combat.EXPECTED_SHIP_IDS.forEach((shipId) => {
      check('T-09d ' + shipId + ' 在 items.json 中', !!byId[shipId]);
      if (byId[shipId]) {
        eq('T-09e ' + shipId + ' 价格与 EXPECTED_PRICES 一致', byId[shipId].price, combat.EXPECTED_PRICES[shipId]);
        const resolved = combat.resolveCareerConfig({ items: itemsContent, shipId });
        check('T-09f ' + shipId + ' 真实内容可解析', resolved.formula === 2 && resolved.shipId === shipId);
        const preview = combat.previewPurchase({ ship: byId[shipId], wallet: { credits: byId[shipId].price } });
        check('T-09g ' + shipId + ' 真实价格可预览', preview.price === byId[shipId].price);
        if (byId[shipId].requires && Object.keys(byId[shipId].requires).length > 0) {
          const needPreview = combat.previewPurchase({ ship: byId[shipId], wallet: { credits: byId[shipId].price, items: {} } });
          check('T-09h ' + shipId + ' 真实 requires 材料被识别', needPreview.reason === 'insufficient-materials' &&
            Object.keys(needPreview.missingMaterials).length === Object.keys(byId[shipId].requires).length,
            JSON.stringify(needPreview));
        }
      }
    });
  }
}

/* ---------------------------------------------------------------- 汇总 */

let failed = 0;
let passed = 0;
let skipped = 0;
for (const item of results) {
  if (item.skip) {
    skipped += 1;
    console.log('SKIP  ' + item.name + (item.detail ? ' — ' + item.detail : ''));
  } else if (item.ok) {
    passed += 1;
    console.log('PASS  ' + item.name);
  } else {
    failed += 1;
    console.log('FAIL  ' + item.name + (item.detail ? ' — ' + item.detail : ''));
  }
}
const total = passed + failed;
console.log('');
console.log(`${passed}/${total} checks passed` + (skipped ? ` (${skipped} skipped)` : ''));
if (failed > 0) {
  console.error(`FAILED: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('PASS  career star-combat-config test');
