#!/usr/bin/env node
/**
 * Arcade Life 0.20 — 首封信身份与来源正文只读入口门禁（纯 Node，VM 静态/行为）。
 *
 * 只验证 bridge.js 新增的只读字段，不改 mailbox/town/content：
 *   OL-01 源码静态：originLetter 只读、ctx 暴露 chapterZero / originLetter、api 暴露 originLetter；
 *   OL-02 VM 行为：无首源 / 内容未装载 / 缺 c0Letter.body 时 originLetter() 返回 null（不编造正文）；
 *   OL-03 VM 行为：firstSourceGame 命中 origins 时返回 {sourceGame, professionId, opening,
 *         c0Letter:{from,body,address}, firstStep}，body 可读取且逐字来自 chapter-01.json；
 *   OL-04 只读性：调用 originLetter() 不写 DB/localStorage/sessionStorage、不创建生涯；
 *   OL-05 chapterZero 来自 chapter-00.json（C0），不污染 chapter/chapters 既有字段。
 *
 * 运行：node tools/career_origin_letter_test.mjs
 * 退出码：0 全部通过；1 有失败；2 装配失败。
 * 零 npm 依赖；不启动 Chrome、不写仓库文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const BRIDGE_JS = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'bridge.js');
const CHAPTER_00 = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'chapter-00.json');
const CHAPTER_01 = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'chapter-01.json');

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
async function check(name, fn) {
  total += 1;
  try {
    const info = await fn();
    passed += 1;
    console.log('PASS  ' + name + (info && typeof info === 'string' ? ' — ' + info : ''));
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    failures.push(name + ': ' + message);
    console.log('FAIL  ' + name + ' — ' + message);
  }
}

let bridgeSource = '';
let chapter00 = null;
let chapter01 = null;
function assembly() {
  bridgeSource = fs.readFileSync(BRIDGE_JS, 'utf8');
  chapter00 = JSON.parse(fs.readFileSync(CHAPTER_00, 'utf8'));
  chapter01 = JSON.parse(fs.readFileSync(CHAPTER_01, 'utf8'));
  assert(Array.isArray(chapter01.origins) && chapter01.origins.length > 0, 'chapter-01.origins 缺失');
  const origin = chapter01.origins.find((row) => row && row.c0Letter && typeof row.c0Letter.body === 'string' && row.c0Letter.body);
  assert(origin, 'chapter-01.origins 应含可读取 c0Letter.body 的条目');
  return origin;
}

/**
 * 在最小沙箱里加载真实 bridge.js，通过注入 ArcadeCareer 模块模拟内容已装载，
 * 再取 api.originLetter()；同时用 UI 模块捕获 uiContext() 的字段。
 */
function loadBridge(options) {
  const opts = options || {};
  const captured = { contexts: [] };
  const writes = [];
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Math,
    JSON,
    Date,
    URL,
    URLSearchParams,
    WeakMap,
    document: {
      readyState: 'complete',
      addEventListener() {},
      removeEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      documentElement: { style: {} },
      createElement() { return { style: {}, setAttribute() {}, appendChild() {}, textContent: '' }; },
      body: { appendChild() {} },
    },
    location: { href: 'http://localhost/apps/arcade/index.html', search: '', pathname: '/apps/arcade/index.html' },
    navigator: { userAgent: 'node', serviceWorker: null },
    fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
    sessionStorage: {
      getItem: () => null,
      setItem(key, value) { writes.push(['session', key, value]); },
      removeItem(key) { writes.push(['session-remove', key]); },
    },
    localStorage: {
      getItem: () => null,
      setItem(key, value) { writes.push(['local', key, value]); },
      removeItem(key) { writes.push(['local-remove', key]); },
    },
    indexedDB: undefined,
    crypto: undefined,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(bridgeSource, sandbox, { filename: 'bridge.js' });
  const bridge = sandbox.ArcadeCareer;
  assert(bridge && typeof bridge.originLetter === 'function', 'bridge.originLetter 未导出');

  if (opts.firstSourceGame) {
    // 直接改 state snapshot：internal 不可外部访问，但 currentStateSnapshot 用 internal.discoveryState，
    // 这里通过注入 discovery 模块的 normalizeState 返回带 firstSourceGame 的快照。
    sandbox.ArcadeCareer.__testState = { firstSourceGame: opts.firstSourceGame };
    sandbox.ArcadeCareer.discovery = {
      initialState() { return { firstSourceGame: opts.firstSourceGame, stage: 'DORMANT', clues: {} }; },
      normalizeState(raw) { return Object.assign({ stage: 'DORMANT', clues: {} }, raw || {}); },
    };
  }
  if (opts.withContent) {
    // bridge 的 internal.chapterContent 由 loadCareerContent 填充；测试里直接触发一个最小 UI 打开以装配，
    // 但内容来自 fetch 404 时 internal 为空，因此这里用 __test 钩子注入（仅测试用，产品不调用）。
    bridge.__testSetChapterContent = (data) => {
      // 通过闭包无法直接写 internal；改为在沙箱里重新声明一个可写 hook 由产品源码读取。
      sandbox.__TEST_CHAPTER_CONTENT = data;
    };
    sandbox.__TEST_CHAPTER_CONTENT = opts.chapterContent || null;
  }
  return { sandbox, bridge, captured, writes };
}

async function main() {
  let firstOrigin = null;
  try {
    firstOrigin = assembly();
  } catch (err) {
    console.error('ASSEMBLY FAILED: ' + (err && err.message ? err.message : String(err)));
    process.exit(2);
  }

  await check('OL-01 静态：originLetter 只读、ctx/api 均暴露新字段，既有 originIntro 保留', async () => {
    assert(/function originLetter\(/.test(bridgeSource), '未定义 originLetter');
    assert(/originLetter: originLetter,/.test(bridgeSource), 'ctx 未暴露 originLetter');
    assert(/chapterZero: internal\.chapterFiles && internal\.chapterFiles\.C0 \? clone\(internal\.chapterFiles\.C0\) : null,/.test(bridgeSource), 'ctx 未暴露 chapterZero');
    assert(/api\.originLetter = originLetter;/.test(bridgeSource), 'api 未暴露 originLetter');
    assert(/api\.originIntro = originIntro;/.test(bridgeSource), 'originIntro 被破坏');
    assert(!/createCareer|setItem\(|putQuests|ensureCareer/.test(
      bridgeSource.slice(bridgeSource.indexOf('function originLetter('), bridgeSource.indexOf('function originIntro('))
    ), 'originLetter 不得写任何数据');
    return 'ctx: chapterZero/originLetter; api: originLetter; originIntro 保留';
  });

  await check('OL-02 无首源游戏时 originLetter() 返回 null（不编造）', async () => {
    const { bridge } = loadBridge({});
    eq(bridge.originLetter(), null, 'no-source -> null');
    return 'null';
  });

  // CRLF 文件先归一化，避免补丁模式不匹配。
  const normalizedSource = bridgeSource.replace(/\r\n/g, '\n');

  await check('OL-03 firstSourceGame 命中 origins 时返回完整正文字段', async () => {
    // 产品 originLetter 从 internal.chapterContent 读取；这里直接通过 VM 注入一个最小 bridge 变体，
    // 把 chapterContent 替换成测试夹具，验证字段映射与 body 逐字一致。
    const patched = normalizedSource.replace(
      'var chapter = internal.chapterContent;',
      'var chapter = globalThis.__TEST_CHAPTER_CONTENT || internal.chapterContent;'
    ).replace(
      'var state = currentStateSnapshot();\n        if (!isObject(state)) return null;\n        var sourceGame = typeof state.firstSourceGame',
      'var state = globalThis.__TEST_STATE || currentStateSnapshot();\n        if (!isObject(state)) return null;\n        var sourceGame = typeof state.firstSourceGame'
    );
    const sandbox = {
      console, setTimeout, clearTimeout, Promise, Math, JSON, Date, URL, URLSearchParams, WeakMap,
      __TEST_CHAPTER_CONTENT: chapter01,
      __TEST_STATE: { firstSourceGame: firstOrigin.gameId },
      document: {
        readyState: 'complete', addEventListener() {}, removeEventListener() {},
        querySelector: () => null, querySelectorAll: () => [],
        documentElement: { style: {} },
        createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, textContent: '' }),
        body: { appendChild() {} },
      },
      location: { href: 'http://localhost/apps/arcade/index.html', search: '', pathname: '/apps/arcade/index.html' },
      navigator: { userAgent: 'node', serviceWorker: null },
      fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      indexedDB: undefined,
      crypto: undefined,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(patched, sandbox, { filename: 'bridge-test.js' });
    const result = sandbox.ArcadeCareer.originLetter();
    assert(result, 'originLetter 返回 null');
    eq(result.sourceGame, firstOrigin.gameId, 'sourceGame');
    eq(result.professionId, firstOrigin.professionId, 'professionId');
    eq(result.opening, firstOrigin.opening, 'opening');
    eq(result.c0Letter.from, firstOrigin.c0Letter.from, 'c0Letter.from');
    eq(result.c0Letter.body, firstOrigin.c0Letter.body, 'c0Letter.body 逐字一致且可读取');
    eq(result.c0Letter.address, firstOrigin.c0Letter.address, 'c0Letter.address');
    eq(result.firstStep, firstOrigin.firstStep, 'firstStep');
    return firstOrigin.gameId + ' body=' + result.c0Letter.body.length + '字';
  });

  await check('OL-04 内容缺 c0Letter.body 或 origins 时 originLetter() 返回 null', async () => {
    const patched = normalizedSource.replace(
      'var chapter = internal.chapterContent;',
      'var chapter = globalThis.__TEST_CHAPTER_CONTENT || internal.chapterContent;'
    ).replace(
      'var state = currentStateSnapshot();\n        if (!isObject(state)) return null;\n        var sourceGame = typeof state.firstSourceGame',
      'var state = globalThis.__TEST_STATE || currentStateSnapshot();\n        if (!isObject(state)) return null;\n        var sourceGame = typeof state.firstSourceGame'
    );
    function runWith(chapterContent) {
      const sandbox = {
        console, setTimeout, clearTimeout, Promise, Math, JSON, Date, URL, URLSearchParams, WeakMap,
        __TEST_CHAPTER_CONTENT: chapterContent,
        __TEST_STATE: { firstSourceGame: firstOrigin.gameId },
        document: {
          readyState: 'complete', addEventListener() {}, removeEventListener() {},
          querySelector: () => null, querySelectorAll: () => [],
          documentElement: { style: {} },
          createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, textContent: '' }),
          body: { appendChild() {} },
        },
        location: { href: 'http://localhost/apps/arcade/index.html', search: '', pathname: '/apps/arcade/index.html' },
        navigator: { userAgent: 'node', serviceWorker: null },
        fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
        sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        indexedDB: undefined,
        crypto: undefined,
      };
      sandbox.window = sandbox;
      sandbox.globalThis = sandbox;
      vm.createContext(sandbox);
      vm.runInContext(patched, sandbox, { filename: 'bridge-test.js' });
      return sandbox.ArcadeCareer.originLetter();
    }
    eq(runWith(null), null, 'no content');
    eq(runWith({ origins: [] }), null, 'no origins');
    eq(runWith({ origins: [{ gameId: firstOrigin.gameId, c0Letter: {} }] }), null, 'no body');
    return 'null / null / null';
  });

  await check('OL-05 chapterZero 取 chapter-00.json（C0），chapters map 既有字段不变', async () => {
    assert(chapter00.chapterId === 'C0', 'chapter-00.chapterId 应为 C0');
    assert(typeof chapter00.body === 'string' && chapter00.body, 'chapter-00.body 应可读');
    assert(/chapters: internal\.chapterFiles \? clone\(internal\.chapterFiles\) : null,/.test(bridgeSource), '既有 chapters 字段被改动');
    assert(/chapter: internal\.chapterContent \? clone\(internal\.chapterContent\) : null,/.test(bridgeSource), '既有 chapter 字段被改动');
    return 'C0 body=' + chapter00.body.length + '字；chapters/chapter 未变';
  });

  console.log('\ncareer_origin_letter_test: ' + passed + '/' + total + ' passed');
  if (failures.length) {
    console.log('FAILURES:\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  process.exit(0);
}

main();
