/**
 * Arcade「旧行为不许变」基线金样（B01）—— 冻结 0.14.0 的经典 / 挑战 / 禅 / 星海割草 / 机库 / 双端路由契约。
 *
 * 用途
 *   0.15–0.18「生涯层 Arcade Life」开发期间，任何改动只要打破了 0.14.0 的既有对外契约
 *   （版本链、16 款游戏清单、78 挑战关、星海机库 / 割草隔离、层塔存档门禁、
 *   localStorage 命名空间、双端路由、PWA 相对路径、既有门禁脚本），本测试立刻 FAIL。
 *   它是「生涯层只允许新增、不允许改旧」的机器可读证据，而不是历史通过数的复述。
 *
 * 覆盖范围（共 9 组，逐条 PASS/FAIL 可见）
 *   1 版本链一致性：engine.js ARCADE_VERSION / sw.js VERSION / shared/tool-registry.json
 *     arcade.version / index.html `data-hall-version` 静态串 + tools/validate_site.py 四处字面量；
 *     全部相对比较，**不硬编码 0.14.0**，升 0.15.0 后本测试自动继续通过。
 *   2 16 款游戏清单：从 engine.js 的 `GAMES` 数组解析 id/file，校验冻结的 16 个 id、
 *     每个 apps/arcade/games/<file> 存在、games/ 目录恰好这 16 个页面。
 *   3 78 挑战关：apps/arcade/challenge/ 恰好 13 个 .js、每文件恰好 6 个 <gameId>-C01..C06 舞台、
 *     id 全局唯一共 78、三款棋牌无 challenge 文件、不泄漏 referencePlan / acceptance。
 *   4 星海突击经典机库 / 割草隔离（源码契约，不做行为模拟）：机库 `formula: 1` 与
 *     sanitizeHangar 强制锁公式、星币公式 `Math.floor(score / 16)`、
 *     `GameMeta.set('star-raid', { hangar })` 整对象覆盖现状、gameOver 内 mow 早退、
 *     `serialize()` 在 mow 返回 null、gameOver 内 settleCredits / recordPlay 各 1 个业务调用点。
 *   5 层塔（pendulum-tower）隔离：recordPlay 业务调用恰好 1 处、挑战分流 `mode === 'challenge'`、
 *     `serialize()` 只按 state 门禁（0.16 career 必须自行早退）、文件尚无 career 字样。
 *   6 生涯 / 经典存储隔离：engine.js 旧存储 key 常量集合等于冻结的 7 个
 *     `studiokit:arcade:*:v1`；engine.js 不含 indexedDB，也不含 studiokit:arcade:career。
 *   7 双端路由：GH Pages `.html` 与 CF Pages 无后缀（含大写 / 尾斜杠 / URL 编码 / 按 id 兜底）
 *     用真实 `detectCurrentGame` 源码复算；另有 sw.js `BASE = new URL('./'` / VERSION /
 *     isUpdateActivation 与 manifest `start_url`/`scope` 相对基准。
 *   8 既有门禁脚本存在性（13 个，只断言存在，不执行）。
 *   9 0.14.0 发布证据锚（DESIGN-0.14.0.md 与 CHANGELOG 条目；**不断言任何历史通过数**）。
 *
 * 运行（仓库根目录，零参数）
 *   node tools/career_legacy_baseline_test.mjs
 *
 * 为什么纯 Node
 *   全部断言只读源码文本 + 在一个假 `location` 上复算 `detectCurrentGame`（纯函数），
 *   不需要浏览器、不需要端口、不联网、不写仓库文件；只用 node:fs / node:path / node:url 内置模块，
 *   零 npm 依赖、零 Chrome，因此可在任何机器上 < 1 秒确定性复跑。
 *   输出格式与 tools/lib/arcade_cdp.mjs 的 createRecorder 一致（PASS  name / FAIL  name — detail /
 *   N/N checks passed），但不 import 它——避免把 CDP / Chrome / http 依赖拉进一个静态测试。
 *   （接入 tools/arcade_run_all_gates.py 与 validate_site.py 的 REQUIRED 清单由集成者另做，
 *   本任务只交付脚本本身，不改任何既有文件。）
 *
 * 退出码：0 全过；1 有 FAIL；2 传入参数（本测试不接受参数）。
 *
 * 升级约定
 *   文件里的「冻结清单」是 0.14.0 事实（分支 feat/arcade-life-015，HEAD afc5fd4，Arcade 0.14.0），
 *   不是可以随手改的实现细节。只有明确要改变旧行为时才可改清单，
 *   并且必须在对应 DESIGN-0.1x.0.md 里写清「为什么允许打破 0.14.0 基线」。
 *   与源码冲突时请勿改源码迁就本测试——先确认这是不是有意的旧行为变更。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ----------------------------------------------------------
 * 冻结清单（0.14.0 事实）
 * ---------------------------------------------------------- */

/** apps/arcade/engine.js GAMES 的 16 个 id（顺序即中心页顺序，比较按集合）。 */
const FROZEN_GAME_IDS = [
  'memory-flip',
  'merge-2048',
  'blackjack',
  'gomoku',
  'solitaire',
  'snowbells',
  'brick-breaker',
  'gravity-flip',
  'snake-run',
  'mole-whack',
  'block-drop',
  'star-raid',
  'road-rush',
  'shadow-leap',
  'pendulum-tower',
  'gold-miner',
];

/** 三款平和棋牌：没有挑战关（0.9.0 起如此，生涯层不得给它们补挑战文件冒充旧行为）。 */
const FROZEN_CARD_GAME_IDS = ['blackjack', 'gomoku', 'solitaire'];

/** apps/arcade/challenge/ 的 13 个 .js（每款 6 关，共 78 关）。 */
const FROZEN_CHALLENGE_IDS = [
  'block-drop',
  'brick-breaker',
  'gold-miner',
  'gravity-flip',
  'memory-flip',
  'merge-2048',
  'mole-whack',
  'pendulum-tower',
  'road-rush',
  'shadow-leap',
  'snake-run',
  'snowbells',
  'star-raid',
];

/** engine.js 旧 localStorage key 常量 → 值。生涯层必须走独立文件 / 独立 key。 */
const FROZEN_STORAGE_KEYS = {
  PROGRESS_KEY: 'studiokit:arcade:progress:v1',
  PREFS_KEY: 'studiokit:arcade:prefs:v1',
  RUNS_KEY: 'studiokit:arcade:runs:v1',
  PLAYTIME_KEY: 'studiokit:arcade:playtime:v1',
  CHALLENGE_KEY: 'studiokit:arcade:challenge:v1',
  SCORES_KEY: 'studiokit:arcade:scores:v1',
  META_KEY: 'studiokit:arcade:meta:v1',
};

/** 既有回归门禁脚本（只断言存在，不执行；执行需要 Chrome，本测试不碰）。 */
const FROZEN_GATE_SCRIPTS = [
  'tools/arcade_smoke.mjs',
  'tools/arcade_gameplay_test.mjs',
  'tools/arcade_tower_test.mjs',
  'tools/arcade_zen_scores_test.mjs',
  'tools/arcade_calm_games_test.mjs',
  'tools/arcade_interaction_test.mjs',
  'tools/arcade_immersive_buttons_test.mjs',
  'tools/arcade_pwa_update_test.mjs',
  'tools/arcade_review_test.mjs',
  'tools/arcade_run_all_gates.py',
  'tools/validate_site.py',
  'tools/build_site.py',
  'tools/check_inline_scripts.mjs',
];

const F = {
  engine: 'apps/arcade/engine.js',
  sw: 'apps/arcade/sw.js',
  hall: 'apps/arcade/index.html',
  registry: 'shared/tool-registry.json',
  validate: 'tools/validate_site.py',
  manifest: 'apps/arcade/manifest.webmanifest',
  gamesDir: 'apps/arcade/games',
  starRaid: 'apps/arcade/games/star-raid.html',
  tower: 'apps/arcade/games/pendulum-tower.html',
  challengeDir: 'apps/arcade/challenge',
  design014: 'apps/arcade/DESIGN-0.14.0.md',
  changelog: 'apps/arcade/CHANGELOG.md',
};

/* ----------------------------------------------------------
 * 记录器 / 断言（格式与 tools/lib/arcade_cdp.mjs createRecorder 一致）
 * ---------------------------------------------------------- */

const results = [];
const memo = new Map();

function record(name, ok, detail) {
  results.push({ name, ok: !!ok });
  const suffix = detail ? ' — ' + detail : '';
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + suffix);
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function check(name, fn) {
  try {
    const detail = fn();
    record(name, true, detail == null ? '' : String(detail));
  } catch (err) {
    record(name, false, err && err.message ? err.message : String(err));
  }
}

function memoize(key, factory) {
  if (memo.has(key)) return memo.get(key);
  const value = factory();
  memo.set(key, value);
  return value;
}

/* ----------------------------------------------------------
 * 只读源码工具
 * ---------------------------------------------------------- */

function abs(rel) {
  return path.join(ROOT, rel);
}

function read(rel) {
  return memoize('read:' + rel, () => {
    try {
      return fs.readFileSync(abs(rel), 'utf8');
    } catch (err) {
      throw new Error('无法读取 ' + rel + '（' + abs(rel) + '）：' + (err.code || err.message));
    }
  });
}

function exists(rel) {
  try {
    return fs.statSync(abs(rel)).isFile();
  } catch (err) {
    return false;
  }
}

/** 在源码中按正则取「恰好一处」的捕获组，多处/零处都给出可读失败信息。 */
function pickExactlyOne(source, re, label, fileRel) {
  const all = [...source.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
  ensure(
    all.length === 1,
    fileRel + ' 中 `' + label + '` 应恰好出现 1 处，实际 ' + all.length + ' 处' + sampleLocations(source, re),
  );
  return all[0][1];
}

function sampleLocations(source, re) {
  const hits = [];
  const scan = new RegExp(re.source, 'g');
  let m;
  while ((m = scan.exec(source))) {
    hits.push(lineOf(source, m.index));
    if (hits.length >= 5) break;
  }
  return hits.length ? '（出现在 ' + hits.join(', ') + '）' : '';
}

function lineOf(source, index) {
  return '第 ' + (source.slice(0, index).split('\n').length) + ' 行';
}

/**
 * 从 source[start]（必须是 [ { ( 之一）扫到配对闭合符，返回含括号的整段。
 * 会跳过字符串 / 模板字符串（含 ${...} 嵌套）/ 行注释 / 块注释，用于稳定切函数体与数据字面量；
 * 括号不配对时抛错（宁可 FAIL 也不静默切错）。
 */
function scanBalanced(source, start) {
  const opener = source[start];
  ensure(opener === '{' || opener === '[' || opener === '(', '内部错误：scanBalanced 起点不是括号（偏移 ' + start + '）');
  const stack = [];
  const templateMarkers = [];
  let quote = null;
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (quote === '`' && ch === '$' && source[i + 1] === '{') {
        templateMarkers.push(stack.length);
        stack.push('{');
        quote = null;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl < 0 ? source.length : nl + 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') {
      stack.push(ch);
      i += 1;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      ensure(stack.length, '括号不配对：偏移 ' + i + ' 处出现多余 `' + ch + '`');
      stack.pop();
      if (templateMarkers.length && templateMarkers[templateMarkers.length - 1] === stack.length) {
        templateMarkers.pop();
        quote = '`';
        i += 1;
        continue;
      }
      if (!stack.length) return source.slice(start, i + 1);
      i += 1;
      continue;
    }
    i += 1;
  }
  throw new Error('括号未闭合：从偏移 ' + start + ' 开始扫描到文件末尾');
}

/** 切出 `function <name>(...) { ... }` 的整段源码（含 function 关键字与花括号）。 */
function functionSource(fileRel, fnName) {
  return memoize('fn:' + fileRel + ':' + fnName, () => {
    const source = read(fileRel);
    const marker = 'function ' + fnName + '(';
    const at = source.indexOf(marker);
    ensure(at >= 0, fileRel + ' 中找不到 `' + marker + '`');
    const brace = source.indexOf('{', at);
    ensure(brace >= 0, fileRel + ' 中 `' + marker + '` 之后找不到函数体起始 `{`');
    const body = scanBalanced(source, brace);
    return source.slice(at, brace + body.length);
  });
}

/** 函数体内部文本（不含最外层花括号）。 */
function functionBody(fileRel, fnName) {
  const source = functionSource(fileRel, fnName);
  const brace = source.indexOf('{');
  return source.slice(brace + 1, -1);
}

function countOf(source, re) {
  return (source.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || []).length;
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function describe(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/* ----------------------------------------------------------
 * 版本链（不硬编码版本号）
 * ---------------------------------------------------------- */

function engineVersion() {
  return memoize('engineVersion', () => {
    const version = pickExactlyOne(read(F.engine), /const ARCADE_VERSION = '([^']+)'/, 'const ARCADE_VERSION', F.engine);
    ensure(/^\d+\.\d+\.\d+$/.test(version), F.engine + ' 的 ARCADE_VERSION 不是 MAJOR.MINOR.PATCH 形式：' + describe(version));
    return version;
  });
}

function swVersion() {
  return memoize('swVersion', () =>
    pickExactlyOne(read(F.sw), /const VERSION = '([^']+)'/, 'const VERSION', F.sw),
  );
}

function registryVersion() {
  return memoize('registryVersion', () => {
    const source = read(F.registry);
    let data;
    try {
      data = JSON.parse(source);
    } catch (err) {
      throw new Error(F.registry + ' 不是合法 JSON：' + err.message);
    }
    const tool = Array.isArray(data.tools) ? data.tools.find((item) => item && item.id === 'arcade') : null;
    ensure(tool, F.registry + ' 的 tools[] 中找不到 id=arcade 条目');
    ensure(typeof tool.version === 'string' && tool.version, F.registry + ' 的 arcade.version 缺失或不是字符串（' + describe(tool.version) + '）');
    return tool.version;
  });
}

function hallVersion() {
  return memoize('hallVersion', () =>
    pickExactlyOne(
      read(F.hall),
      /data-hall-version\s*>\s*([0-9][0-9A-Za-z.+-]*)\s*</,
      'data-hall-version>...</span> 静态串',
      F.hall,
    ),
  );
}

/** tools/validate_site.py 里 4 处版本字面量（升版本时必须同步改的那 4 行）。 */
function validateLiterals() {
  return memoize('validateLiterals', () => {
    const source = read(F.validate);
    return {
      engine: pickExactlyOne(source, /const ARCADE_VERSION = '([^']+)'/, "const ARCADE_VERSION = '<ver>'", F.validate),
      hall: pickExactlyOne(source, /data-hall-version>([0-9][0-9A-Za-z.+-]*)'/, "data-hall-version><ver>", F.validate),
      sw: pickExactlyOne(source, /const VERSION = '([^']+)'/, "const VERSION = '<ver>'", F.validate),
      registry: pickExactlyOne(source, /arcade\.get\('version'\)\s*!=\s*'([^']+)'/, "arcade.get('version') != '<ver>'", F.validate),
    };
  });
}

function sameVersion(actual, expected, what) {
  ensure(
    actual === expected,
    what + ' 是 ' + describe(actual) + '，但 engine.js ARCADE_VERSION 是 ' + describe(expected) + '；四处版本链必须完全一致',
  );
  return actual;
}

/* ----------------------------------------------------------
 * 游戏清单解析（GAMES 数组）
 * ---------------------------------------------------------- */

/** 从 `const GAMES = [` 到配对 `]` 的数组体（不含方括号）。 */
function gamesArrayBody() {
  return memoize('gamesArrayBody', () => {
    const source = read(F.engine);
    const at = source.indexOf('const GAMES = [');
    ensure(at >= 0, F.engine + ' 中找不到 `const GAMES = [`');
    const bracket = source.indexOf('[', at);
    ensure(bracket >= 0, F.engine + ' 中 `const GAMES = [` 之后找不到数组起始 `[`');
    return scanBalanced(source, bracket).slice(1, -1);
  });
}

/** 把数组体按顶层对象切开（跳过字符串 / 注释，避免把 how 文本里的花括号当对象）。 */
function splitTopLevelObjects(body) {
  const pieces = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '{') {
      const piece = scanBalanced(body, i);
      pieces.push(piece);
      i += piece.length;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < body.length) {
        if (body[i] === '\\') {
          i += 2;
          continue;
        }
        if (body[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '/' && body[i + 1] === '/') {
      const nl = body.indexOf('\n', i);
      i = nl < 0 ? body.length : nl + 1;
      continue;
    }
    if (ch === '/' && body[i + 1] === '*') {
      const end = body.indexOf('*/', i + 2);
      i = end < 0 ? body.length : end + 2;
      continue;
    }
    i += 1;
  }
  return pieces;
}

function parseGames() {
  return memoize('games', () => {
    const pieces = splitTopLevelObjects(gamesArrayBody());
    return pieces.map((piece, index) => {
      const id = (piece.match(/(?:^|[^A-Za-z0-9_$])id\s*:\s*'([^']+)'/) || [])[1];
      const file = (piece.match(/(?:^|[^A-Za-z0-9_$])file\s*:\s*'([^']+)'/) || [])[1];
      const name = (piece.match(/(?:^|[^A-Za-z0-9_$])name\s*:\s*'([^']+)'/) || [])[1];
      ensure(id, 'GAMES[' + index + '] 解析不到 id（' + F.engine + '）');
      ensure(file, 'GAMES[' + index + ']（id=' + id + '）解析不到 file（' + F.engine + '）');
      return { id, file, name: name || '' };
    });
  });
}

/* ----------------------------------------------------------
 * 挑战关解析
 * ---------------------------------------------------------- */

function challengeFiles() {
  return memoize('challengeFiles', () => {
    let names;
    try {
      names = fs.readdirSync(abs(F.challengeDir));
    } catch (err) {
      throw new Error('无法列出 ' + F.challengeDir + '（' + abs(F.challengeDir) + '）：' + (err.code || err.message));
    }
    return names.filter((name) => name.endsWith('.js')).sort();
  });
}

/** 取挑战文件里所有 `<stem>-C0n` 舞台 id（嵌套 content 里的 w1/m1 等短 id 不计入）。 */
function stageIdsOf(source, stem) {
  const re = /(?:^|[^A-Za-z0-9_$])["']?id["']?\s*:\s*["']([^"']+)["']/g;
  const stageRe = new RegExp('^' + escapeRe(stem) + '-C\\d\\d$');
  const ids = [];
  let m;
  while ((m = re.exec(source))) {
    if (stageRe.test(m[1])) ids.push(m[1]);
  }
  return ids;
}

/* ----------------------------------------------------------
 * 路由复算：用 engine.js 里真实的 detectCurrentGame 源码
 * ---------------------------------------------------------- */

function buildDetectCurrentGame(games) {
  const source = functionSource(F.engine, 'detectCurrentGame');
  const factory = new Function('location', 'GAMES', 'return (' + source + ');');
  return (pathname) => {
    const fn = factory({ pathname }, games);
    return fn();
  };
}

function routeCase(label, pathname, expectedId) {
  check('双端路由：detectCurrentGame ' + label, () => {
    const detect = buildDetectCurrentGame(parseGames());
    const hit = detect(pathname);
    const actualId = hit && typeof hit === 'object' ? hit.id : null;
    ensure(
      actualId === expectedId,
      '路径 ' + describe(pathname) + ' 期望识别为 ' + describe(expectedId) + '，实际为 ' + describe(actualId),
    );
    return '→ ' + actualId;
  });
}

/* ----------------------------------------------------------
 * 主流程
 * ---------------------------------------------------------- */

function main() {
  console.log('Arcade 0.14.0 旧行为基线金样（纯 Node，无 Chrome）：' + F.engine + ' 等 ' + Object.keys(F).length + ' 个来源');

  /* ---------- 1. 版本链一致性（不硬编码） ---------- */
  check('版本链：engine.js ARCADE_VERSION 可解析且为 MAJOR.MINOR.PATCH', () => engineVersion());
  check('版本链：sw.js VERSION == engine.js ARCADE_VERSION', () => sameVersion(swVersion(), engineVersion(), 'apps/arcade/sw.js 的 VERSION'));
  check('版本链：shared/tool-registry.json arcade.version == engine.js ARCADE_VERSION', () =>
    sameVersion(registryVersion(), engineVersion(), 'shared/tool-registry.json 的 arcade.version'),
  );
  check('版本链：apps/arcade/index.html data-hall-version 静态串 == engine.js ARCADE_VERSION', () =>
    sameVersion(hallVersion(), engineVersion(), 'apps/arcade/index.html 的 data-hall-version'),
  );
  check('版本链：validate_site.py ARCADE_VERSION 字面量 == engine.js ARCADE_VERSION', () =>
    sameVersion(validateLiterals().engine, engineVersion(), 'tools/validate_site.py 的 ARCADE_VERSION 字面量'),
  );
  check('版本链：validate_site.py data-hall-version 标记 == engine.js ARCADE_VERSION', () =>
    sameVersion(validateLiterals().hall, engineVersion(), 'tools/validate_site.py 的 data-hall-version 标记'),
  );
  check('版本链：validate_site.py sw VERSION 字面量 == engine.js ARCADE_VERSION', () =>
    sameVersion(validateLiterals().sw, engineVersion(), 'tools/validate_site.py 的 sw VERSION 字面量'),
  );
  check('版本链：validate_site.py registry version 断言 == engine.js ARCADE_VERSION', () =>
    sameVersion(validateLiterals().registry, engineVersion(), 'tools/validate_site.py 的 registry version 断言'),
  );

  /* ---------- 2. 16 款游戏清单 ---------- */
  check('游戏清单：GAMES 数组解析成功且恰好 16 款', () => {
    const games = parseGames();
    ensure(games.length === 16, F.engine + ' 的 GAMES 应恰好 16 款，实际 ' + games.length + ' 款：' + games.map((g) => g.id).join(', '));
    const ids = games.map((g) => g.id);
    ensure(new Set(ids).size === ids.length, 'GAMES 里存在重复 id：' + ids.join(', '));
    return '16 款';
  });
  check('游戏清单：GAMES id 集合等于冻结的 16 款', () => {
    const ids = parseGames().map((g) => g.id);
    const missing = FROZEN_GAME_IDS.filter((id) => !ids.includes(id));
    const extra = ids.filter((id) => !FROZEN_GAME_IDS.includes(id));
    ensure(
      !missing.length && !extra.length,
      F.engine + ' 的 GAMES id 集合与 0.14.0 冻结清单不一致；缺少 [' + missing.join(', ') + ']，多出 [' + extra.join(', ') + ']',
    );
    return '16/16 一致';
  });
  check('游戏清单：GAMES file 均为 <id>.html（16 款）', () => {
    const bad = parseGames().filter((game) => game.file !== game.id + '.html');
    ensure(!bad.length, F.engine + ' 的 GAMES file 应等于 <id>.html；不符合：' + bad.map((g) => g.id + '→' + g.file).join(', '));
    return '16/16 命名一致';
  });
  check('游戏清单：' + F.gamesDir + ' 恰好这 16 个 .html 页面', () => {
    let names;
    try {
      names = fs.readdirSync(abs(F.gamesDir));
    } catch (err) {
      throw new Error('无法列出 ' + F.gamesDir + '（' + abs(F.gamesDir) + '）：' + (err.code || err.message));
    }
    const actual = names.filter((name) => name.endsWith('.html')).sort();
    const expected = FROZEN_GAME_IDS.map((id) => id + '.html').sort();
    const missing = expected.filter((name) => !actual.includes(name));
    const extra = actual.filter((name) => !expected.includes(name));
    ensure(
      !missing.length && !extra.length,
      F.gamesDir + ' 的游戏页集合变化：缺少 [' + missing.join(', ') + ']，多出 [' + extra.join(', ') + ']；新增游戏会改变 16 款基线，必须显式升级本测试',
    );
    return actual.length + ' 个页面';
  });
  check('游戏清单：每个 apps/arcade/games/<file> 文件存在', () => {
    const missing = parseGames().map((game) => game.file).filter((file) => !exists(path.join(F.gamesDir, file)));
    ensure(!missing.length, 'GAMES 声明了但文件不存在：' + missing.map((file) => F.gamesDir + '/' + file).join(', '));
    return '16/16 存在';
  });

  /* ---------- 3. 78 挑战关 ---------- */
  check('挑战关：' + F.challengeDir + ' 恰好 13 个 .js 文件', () => {
    const files = challengeFiles();
    ensure(files.length === 13, F.challengeDir + ' 应恰好 13 个 .js，实际 ' + files.length + ' 个：' + files.join(', '));
    return files.length + ' 个文件';
  });
  check('挑战关：文件名集合等于冻结的 13 款（每款 6 关）', () => {
    const stems = challengeFiles().map((name) => name.slice(0, -'.js'.length));
    const missing = FROZEN_CHALLENGE_IDS.filter((id) => !stems.includes(id));
    const extra = stems.filter((id) => !FROZEN_CHALLENGE_IDS.includes(id));
    ensure(
      !missing.length && !extra.length,
      F.challengeDir + ' 挑战文件集合变化：缺少 [' + missing.map((id) => id + '.js').join(', ') + ']，多出 [' + extra.map((id) => id + '.js').join(', ') + ']',
    );
    return '13/13 一致';
  });
  check('挑战关：三款棋牌（blackjack/gomoku/solitaire）没有 challenge 文件', () => {
    const stems = challengeFiles().map((name) => name.slice(0, -'.js'.length));
    const bad = FROZEN_CARD_GAME_IDS.filter((id) => stems.includes(id));
    ensure(!bad.length, '三款平和棋牌不应有挑战关：' + bad.map((id) => F.challengeDir + '/' + id + '.js').join(', '));
    return '0 个（符合预期）';
  });

  for (const stem of FROZEN_CHALLENGE_IDS) {
    check('挑战关：' + stem + '.js 注册 ArcadeChallengeData 且舞台为 ' + stem + '-C01..C06', () => {
      const fileRel = F.challengeDir + '/' + stem + '.js';
      const source = read(fileRel);
      ensure(exists(fileRel), fileRel + ' 不存在');
      const registration = new RegExp('window\\.ArcadeChallengeData\\[\\s*[\'"]' + escapeRe(stem) + '[\'"]\\s*\\]');
      ensure(registration.test(source), fileRel + ' 缺少 `window.ArcadeChallengeData[\'' + stem + '\']` 注册');
      const gameId = (source.match(/["']?gameId["']?\s*:\s*["']([^"']+)["']/) || [])[1];
      ensure(gameId === stem, fileRel + ' 的 gameId 应为 ' + describe(stem) + '，实际 ' + describe(gameId));
      const ids = stageIdsOf(source, stem);
      ensure(
        ids.length === 6,
        fileRel + ' 应恰好 6 个 ' + stem + '-C0n 舞台，实际 ' + ids.length + ' 个：[' + ids.join(', ') + ']',
      );
      const expected = [1, 2, 3, 4, 5, 6].map((n) => stem + '-C0' + n);
      const missing = expected.filter((id) => !ids.includes(id));
      const extra = ids.filter((id) => !expected.includes(id));
      ensure(!missing.length && !extra.length, fileRel + ' 舞台 id 应等于 ' + expected.join(' / ') + '；缺少 [' + missing.join(', ') + ']，多出 [' + extra.join(', ') + ']');
      return '6 关 + 注册';
    });
  }

  check('挑战关：78 个舞台 id 全局唯一（13 × 6）', () => {
    const all = [];
    for (const name of challengeFiles()) {
      const stem = name.slice(0, -'.js'.length);
      all.push(...stageIdsOf(read(F.challengeDir + '/' + name), stem));
    }
    ensure(all.length === 78, F.challengeDir + ' 的舞台总数应为 78，实际 ' + all.length);
    const unique = new Set(all);
    ensure(unique.size === all.length, '舞台 id 存在重复：' + all.filter((id, i) => all.indexOf(id) !== i).join(', '));
    return '78/78 唯一';
  });
  check('挑战关：13 个挑战文件均不含 referencePlan / acceptance', () => {
    const bad = [];
    for (const name of challengeFiles()) {
      const source = read(F.challengeDir + '/' + name);
      for (const token of ['referencePlan', 'acceptance']) {
        if (source.includes(token)) bad.push(F.challengeDir + '/' + name + ' 含 ' + token);
      }
    }
    ensure(!bad.length, '挑战运行时数据不得泄漏设计字段：' + bad.join('；'));
    return '0 处泄漏';
  });

  /* ---------- 4. 星海突击：经典机库 / 割草隔离 ---------- */
  check('星海机库：emptyHangar 存档含 formula: 1（公式版本锁）', () => {
    const body = functionBody(F.starRaid, 'emptyHangar');
    ensure(/formula\s*:\s*1/.test(body), F.starRaid + ' 的 emptyHangar() 缺少 `formula: 1`（机库存档必须锁星币公式版本）');
    return 'formula: 1';
  });
  check('星海机库：sanitizeHangar 读档强制锁 base.formula = 1', () => {
    const body = functionBody(F.starRaid, 'sanitizeHangar');
    ensure(/base\.formula\s*=\s*1\s*;/.test(body), F.starRaid + ' 的 sanitizeHangar() 缺少 `base.formula = 1;`（读档必须强制锁公式版本，不能沿用老档语义）');
    return 'base.formula = 1';
  });
  check('星海机库：星币结算公式为 Math.floor(score / 16)', () => {
    const body = functionBody(F.starRaid, 'settleCredits');
    ensure(
      /Math\.floor\(\s*score\s*\/\s*16\s*\)/.test(body),
      F.starRaid + ' 的 settleCredits() 中找不到 `Math.floor(score / 16)`；0.14.0 冻结公式为 floor(score/16) + 整备军费补给',
    );
    ensure(/return\s+earned\s*;/.test(body), F.starRaid + ' 的 settleCredits() 应 `return earned;`（结算幂等返回值）');
    return 'Math.floor(score / 16)';
  });
  check('星海机库：GameMeta.set(\'star-raid\') 只写 { hangar }（整对象覆盖现状冻结）', () => {
    const source = read(F.starRaid);
    const calls = countOf(source, /A\.GameMeta\.set\(\s*'star-raid'/);
    ensure(calls === 1, F.starRaid + ' 应恰好 1 处 `A.GameMeta.set(\'star-raid\'`，实际 ' + calls + ' 处');
    ensure(
      /A\.GameMeta\.set\(\s*'star-raid'\s*,\s*\{\s*hangar\s*:\s*data\s*\}\s*\)/.test(source),
      F.starRaid + ' 的 GameMeta 写入必须是 `A.GameMeta.set(\'star-raid\', { hangar: data })`；'
        + '0.14.0 的 GameMeta.set 是整对象覆盖（不是合并），改 payload 形状前必须显式升级本测试',
    );
    return '1 处写入，payload={ hangar }';
  });
  check('星海割草：gameOver 首段 `if (mode === \'mow\') return quitMow();` 早退', () => {
    const body = functionBody(F.starRaid, 'gameOver');
    const guard = body.match(/if \(mode === 'mow'\)\s*return quitMow\(\);/);
    ensure(guard, F.starRaid + ' 的 gameOver() 缺少割草早退 `if (mode === \'mow\') return quitMow();`');
    const settleAt = body.indexOf('settleCredits(');
    ensure(settleAt >= 0, F.starRaid + ' 的 gameOver() 里找不到 settleCredits( 调用');
    ensure(body.indexOf(guard[0]) < settleAt, F.starRaid + ' 的割草早退必须早于 settleCredits 调用（割草不给星币）');
    return '割草早退在结算之前';
  });
  check('星海割草：serialize() 在 mow 模式返回 null（不写局内档）', () => {
    const body = functionBody(F.starRaid, 'serialize');
    ensure(/if \(mode === 'mow'\)\s*return null;/.test(body), F.starRaid + ' 的 serialize() 缺少 `if (mode === \'mow\') return null;`（割草不记分、不写局内档）');
    return 'mow → null';
  });
  check('星海结算：gameOver 内 settleCredits 业务调用恰好 1 处', () => {
    const body = functionBody(F.starRaid, 'gameOver');
    const calls = countOf(body, /settleCredits\(/);
    ensure(calls === 1, F.starRaid + ' 的 gameOver() 内 settleCredits( 调用应恰好 1 处，实际 ' + calls + ' 处（重复结算会多给星币）');
    return '1 处';
  });
  check('星海结算：gameOver 内 A.Progress.recordPlay(\'star-raid\') 恰好 1 处', () => {
    const body = functionBody(F.starRaid, 'gameOver');
    const calls = countOf(body, /A\.Progress\.recordPlay\('star-raid'/);
    ensure(calls === 1, F.starRaid + ' 的 gameOver() 内 A.Progress.recordPlay(\'star-raid\' 应恰好 1 处，实际 ' + calls + ' 处（重复记分会被 in-flight 去重掩盖）');
    return '1 处';
  });

  /* ---------- 5. 层塔（pendulum-tower）隔离 ---------- */
  check('层塔隔离：recordPlay(\'pendulum-tower\') 业务调用恰好 1 处', () => {
    const calls = countOf(read(F.tower), /A\.Progress\.recordPlay\('pendulum-tower'/);
    ensure(calls === 1, F.tower + ' 应恰好 1 处 `A.Progress.recordPlay(\'pendulum-tower\'`，实际 ' + calls + ' 处');
    return '1 处';
  });
  check('层塔隔离：挑战分流标记 mode === \'challenge\' 存在（≥3 处）', () => {
    const source = read(F.tower);
    const markers = countOf(source, /mode === 'challenge'/);
    ensure(markers >= 3, F.tower + ' 的挑战分流标记 `mode === \'challenge\'` 应 ≥3 处（0.14.0 有 20+ 处），实际 ' + markers + ' 处');
    ensure(/if \(mode === 'challenge'\)/.test(source), F.tower + ' 缺少 `if (mode === \'challenge\')` 分流块');
    return markers + ' 处';
  });
  check('层塔隔离：serialize() 只按 state 门禁（career 必须自行早退）', () => {
    const body = functionBody(F.tower, 'serialize');
    ensure(
      /^if \(state !== 'playing' && state !== 'paused'\) return null;/.test(body.trim()),
      F.tower + ' 的 serialize() 第一句应为 `if (state !== \'playing\' && state !== \'paused\') return null;`；'
        + '0.16 生涯模式必须在该函数里自行早退，不得依赖此处已有的门禁',
    );
    ensure(!/mode === 'mow'/.test(body), F.tower + ' 的 serialize() 不应出现割草分支（层塔没有 mow 模式）');
    return 'state 门禁';
  });
  check('层塔隔离：0.15 适配前文件不含 career / ArcadeCareer 字样', () => {
    const source = read(F.tower);
    const hit = source.search(/career/i);
    ensure(hit < 0, F.tower + ' 在 ' + lineOf(source, hit) + ' 出现 career 字样；0.14.0 层塔页不含生涯适配，0.15 开始适配后必须显式升级本基线');
    return '0 处';
  });

  /* ---------- 6. 生涯 / 经典存储隔离 ---------- */
  check('存储隔离：engine.js 恰好 7 个 studiokit:arcade:*:v1 key 常量', () => {
    const source = read(F.engine);
    const values = [...source.matchAll(/'studiokit:arcade:([a-z-]+):v1'/g)].map((m) => m[0].slice(1, -1));
    const unique = [...new Set(values)].sort();
    const expected = Object.values(FROZEN_STORAGE_KEYS).sort();
    const missing = expected.filter((key) => !unique.includes(key));
    const extra = unique.filter((key) => !expected.includes(key));
    ensure(
      !missing.length && !extra.length,
      F.engine + ' 的 studiokit:arcade:*:v1 key 集合变化：缺少 [' + missing.join(', ') + ']，多出 [' + extra.join(', ') + ']；'
        + '旧 key 不得改名/删除，生涯存储必须放在独立文件里（本测试不认可在 engine.js 加第 8 个旧命名空间 key）',
    );
    return unique.length + ' 个 key';
  });
  check('存储隔离：7 个旧 key 常量名与值等于冻结映射', () => {
    const source = read(F.engine);
    const bad = [];
    for (const [name, value] of Object.entries(FROZEN_STORAGE_KEYS)) {
      const re = new RegExp('const\\s+' + name + '\\s*=\\s*\'([^\']+)\'');
      const hit = source.match(re);
      if (!hit) bad.push(F.engine + ' 找不到常量 ' + name);
      else if (hit[1] !== value) bad.push(name + ' 是 ' + describe(hit[1]) + '，应为 ' + describe(value));
    }
    ensure(!bad.length, '旧存储 key 常量被改名或改值：' + bad.join('；'));
    return Object.keys(FROZEN_STORAGE_KEYS).length + ' 个常量';
  });
  check('存储隔离：engine.js 不含 indexedDB（旧引擎只用 localStorage）', () => {
    const source = read(F.engine);
    const hit = source.search(/indexedDB/i);
    ensure(hit < 0, F.engine + ' 在 ' + lineOf(source, hit) + ' 出现 indexedDB；0.14.0 引擎只用 localStorage，生涯若需要 IndexedDB 必须走独立文件');
    return '0 处';
  });
  check('存储隔离：engine.js 不含 studiokit:arcade:career（生涯存储独立）', () => {
    const source = read(F.engine);
    const hit = source.indexOf('studiokit:arcade:career');
    ensure(hit < 0, F.engine + ' 在 ' + lineOf(source, hit) + ' 出现 studiokit:arcade:career；生涯存档必须独立于经典 7 个 key');
    return '0 处';
  });

  /* ---------- 7. 双端路由 ---------- */
  routeCase('GH Pages 子路径 + .html', '/studiokit/apps/arcade/games/snake-run.html', 'snake-run');
  routeCase('CF Pages 无后缀 pretty URL', '/apps/arcade/games/snake-run', 'snake-run');
  routeCase('无后缀 + 根路径（CF 根部署）', '/apps/arcade/games/star-raid', 'star-raid');
  routeCase('大写文件名 + .HTML（toLowerCase）', '/apps/arcade/games/Snake-Run.HTML', 'snake-run');
  routeCase('尾斜杠', '/studiokit/apps/arcade/games/snake-run/', 'snake-run');
  routeCase('URL 编码（decodeURIComponent）', '/apps/arcade/games/%73nake-run.html', 'snake-run');
  routeCase('非游戏页返回 null', '/apps/arcade/index.html', null);
  routeCase('空游戏名返回 null', '/apps/arcade/games/', null);
  routeCase('未知游戏返回 null', '/apps/arcade/games/not-a-game.html', null);
  check('双端路由：detectCurrentGame 按 id 兜底（file 与 id 不同形时）', () => {
    const detect = buildDetectCurrentGame([{ id: 'snake-run', file: 'legacy-snake.html' }]);
    const hit = detect('/apps/arcade/games/snake-run');
    ensure(
      hit && hit.id === 'snake-run',
      '路径 /apps/arcade/games/snake-run、GAMES=[{id:snake-run,file:legacy-snake.html}] 应靠 id 兜底命中，实际 ' + describe(hit && hit.id),
    );
    return 'id 兜底生效';
  });
  check('双端路由：detectCurrentGame 源码含 URL 解码 / 去尾斜杠 / 去 .html / 小写化', () => {
    const body = functionBody(F.engine, 'detectCurrentGame');
    const markers = [
      ['decodeURIComponent', body.includes('decodeURIComponent')],
      ['去尾斜杠 replace(/\\/+$/)', body.includes('/\\/+$/')],
      ['去 .html 后缀 replace(/\\.html$/i)', countOf(body, /\.html\$\/i/) >= 2],
      ['小写化 toLowerCase()', countOf(body, /\.toLowerCase\(\)/) >= 2],
    ];
    const missing = markers.filter(([, ok]) => !ok).map(([name]) => name);
    ensure(!missing.length, F.engine + ' 的 detectCurrentGame() 缺少归一化步骤：' + missing.join('、'));
    return markers.length + ' 个归一化步骤';
  });
  check('双端路由：detectCurrentGame 含按 id 兜底与「非游戏页返回 null」守卫', () => {
    const body = functionBody(F.engine, 'detectCurrentGame');
    ensure(/if \(marker < 0\) return null;/.test(body), F.engine + ' 的 detectCurrentGame() 缺少 `if (marker < 0) return null;`（中心页/非游戏页必须识别为无游戏）');
    ensure(
      /GAMES\.find\(\s*\(g\)\s*=>\s*g\.id\.toLowerCase\(\)\s*===\s*file\s*\)/.test(body),
      F.engine + ' 的 detectCurrentGame() 缺少按 id 兜底 `GAMES.find((g) => g.id.toLowerCase() === file)`',
    );
    return 'id 兜底 + marker 守卫';
  });
  check('双端路由：detectCurrentGame 不再直接比较原始文件名（反向断言）', () => {
    const body = functionBody(F.engine, 'detectCurrentGame');
    ensure(!body.includes('g.file === file'), F.engine + ' 的 detectCurrentGame() 出现 `g.file === file`（0.13.3 之前的无后缀 bug 写法）');
    ensure(!body.includes('=== raw'), F.engine + ' 的 detectCurrentGame() 出现 `=== raw`（用未归一化路径直接比较会重现 CF Pages 计时为 0 的 bug）');
    return '0 处原始比较';
  });
  check('双端路由：sw.js 以 new URL(\'./\', self.location.href) 为路径基准', () => {
    const source = read(F.sw);
    ensure(
      /const BASE = new URL\('\.\/', self\.location\.href\);/.test(source),
      F.sw + ' 缺少 `const BASE = new URL(\'./\', self.location.href);`（GH Pages 子路径与 CF 根路径双端通吃的相对基准）',
    );
    ensure(/const SCOPE_PATH = BASE\.pathname;/.test(source), F.sw + ' 缺少 `const SCOPE_PATH = BASE.pathname;`');
    return 'BASE 相对基准';
  });
  check('双端路由：sw.js 含 VERSION 常量与 isUpdateActivation 更新握手', () => {
    const source = read(F.sw);
    ensure(/const VERSION = '[^']+';/.test(source), F.sw + ' 缺少 `const VERSION = \'<ver>\';`（缓存键与版本握手来源）');
    ensure(/\bfunction isUpdateActivation\s*\(/.test(source) || /\bisUpdateActivation\b/.test(source), F.sw + ' 缺少 isUpdateActivation（0.13.2 起的升级接管判定）');
    ensure(source.includes('skipWaiting'), F.sw + ' 缺少 skipWaiting');
    ensure(source.includes('clients.claim'), F.sw + ' 缺少 clients.claim');
    return 'VERSION + isUpdateActivation';
  });
  check('双端路由：manifest.webmanifest start_url / scope 均为 ./', () => {
    const source = read(F.manifest);
    let data;
    try {
      data = JSON.parse(source);
    } catch (err) {
      throw new Error(F.manifest + ' 不是合法 JSON：' + err.message);
    }
    ensure(data.start_url === './', F.manifest + ' 的 start_url 应为 "./"，实际 ' + describe(data.start_url) + '（禁止绝对路径）');
    ensure(data.scope === './', F.manifest + ' 的 scope 应为 "./"，实际 ' + describe(data.scope) + '（禁止绝对路径）');
    return 'start_url=./ scope=./';
  });

  /* ---------- 8. 既有门禁脚本存在性 ---------- */
  for (const script of FROZEN_GATE_SCRIPTS) {
    check('门禁脚本存在：' + script, () => {
      ensure(exists(script), script + ' 不存在；0.15–0.18 不得删除既有回归门禁（本测试只断言存在，不执行）');
      return '存在';
    });
  }

  /* ---------- 9. 0.14.0 发布证据锚（不校验历史通过数） ---------- */
  check('证据锚：apps/arcade/DESIGN-0.14.0.md 存在（0.14.0 设计与回滚）', () => {
    ensure(exists(F.design014), F.design014 + ' 不存在；0.14.0 的设计与回滚记录不得删除');
    return '存在';
  });
  check('证据锚：apps/arcade/CHANGELOG.md 含 0.14.0 发布条目（不断言历史通过数）', () => {
    const source = read(F.changelog);
    ensure(/(^|\n)#{1,4}[^\n]*\b0\.14\.0\b/.test(source), F.changelog + ' 找不到 0.14.0 条目；历史发版记录不得删除（本测试只断言条目存在，不校验 113/113 之类会过期的数字）');
    return '0.14.0 条目存在';
  });

  /* ---------- 汇总 ---------- */
  const failed = results.filter((item) => !item.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  if (failed.length) {
    console.log('\nFAILED:');
    for (const item of failed) console.log('  - ' + item.name);
    process.exitCode = 1;
  }
}

const argv = process.argv.slice(2);
if (argv.length) {
  console.error('用法错误：本测试不接受参数（无参数运行）。收到：' + argv.join(' '));
  console.error('运行：node tools/career_legacy_baseline_test.mjs');
  process.exit(2);
}

main();
