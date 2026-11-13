#!/usr/bin/env node
/**
 * Arcade 0.8.1 新特性门禁：俄罗斯方块禅模式 + 积分记录表。
 *
 * 契约来源：docs/arcade/0.8.1-CONTRACT.md §3（scores:v1 数据模型）、§4.2（Progress 集成）、
 * §5.5（#test 禅模式钩子）、§6（中心页积分表）与 §7（自动化测试 10 类场景）。
 *
 * 零 npm 依赖：复用 tools/lib/arcade_cdp.mjs（静态服务器 / Chrome / CDP / 断言记录器），
 * 只使用 Node 内置模块与本机 Chrome；不联网、不引入框架。
 *
 * 运行：
 *   node tools/arcade_zen_scores_test.mjs                    # 跑全部 14 个场景
 *   node tools/arcade_zen_scores_test.mjs --list             # 列出场景 ID / 标题（不启动 Chrome）
 *   node tools/arcade_zen_scores_test.mjs --scenario=ZS-03   # 只跑指定场景（可重复传入）
 *
 * 端口（默认 8770 / 9338，避开 smoke 的 8765/9333 与 gameplay 的 8766/9334）：
 *   静态服务器：--port=<n> 或环境变量 ARCADE_ZEN_SCORES_PORT（兼容 HTTP_PORT）
 *   CDP 端口：  --cdp-port=<n> 或环境变量 ARCADE_ZEN_SCORES_CDP_PORT（兼容 CDP_PORT）
 *   CHROME_PATH 可覆盖本机 Chrome 路径。
 *
 * 输出：每项 `✔/✘ 名称 — 证据/失败原因`，结尾 `PASS n/n`；全绿退出码 0，任一失败退出码 1，
 * CLI 用法错误退出码 2。页面 console error / pageerror 一律记为对应场景失败。
 *
 * 独立性：每个场景开始前清空本机存档并重新导航，因此场景之间不依赖执行顺序；可共用同一浏览器。
 * 不改产品文件、不改既有 smoke/gameplay 测试、不 commit/push。
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, createRecorder, envPort, launchChrome, openPage, sleep, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const ARTIFACTS = path.join(REPO_ROOT, 'test-artifacts');
const HALL_PATH = '/apps/arcade/';
const GAME_FILE = 'block-drop.html';
const SCORES_KEY = 'studiokit:arcade:scores:v1';
const LEGACY_KEYS = {
  progress: 'studiokit:arcade:progress:v1',
  runs: 'studiokit:arcade:runs:v1',
  playtime: 'studiokit:arcade:playtime:v1',
  challenge: 'studiokit:arcade:challenge:v1',
};
const ALL_KEYS = [LEGACY_KEYS.progress, LEGACY_KEYS.runs, LEGACY_KEYS.playtime, LEGACY_KEYS.challenge, SCORES_KEY];
const SCORES_METHODS = ['record', 'list', 'stats', 'modeLabel', 'exportData', 'importData', 'resetGame', 'resetAll'];
const ZEN_HOOKS = ['info', 'zenInfo', 'startZen', 'toggleZenFreeze', 'zenSetState', 'zenLineClearScenario', 'endZen'];
const VIEWPORT = { width: 420, height: 900 };

let SERVER_PORT = 0;
let CDP_PORT = 0;
let BASE = '';

/* createRecorder 输出 `PASS  name` / `FAIL  name — detail`；本 runner 用 ✔/✘ 呈现并统一结尾输出 PASS n/n。 */
const CHECK_ICONS = { PASS: '✔', FAIL: '✘' };
const { record, assert, summary } = createRecorder({
  log(line) {
    const matched = /^(PASS|FAIL)  ([\s\S]*)$/.exec(line);
    if (matched) {
      console.log(CHECK_ICONS[matched[1]] + ' ' + matched[2]);
      return;
    }
    /* 跳过 createRecorder 默认的 "x/y checks passed" 汇总行（结尾统一输出 PASS n/n）。 */
    if (/^\d+\/\d+ .*passed$/.test(line.trim())) return;
    if (line.trim()) console.log(line);
  },
});

const round3 = (value) => Math.round(value * 1000) / 1000;

function formatValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(round3(value));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return '[' + value.map(formatValue).join(',') + ']';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatEvidence(evidence) {
  if (evidence === undefined || evidence === null) return '';
  if (typeof evidence === 'string') return evidence;
  return Object.entries(evidence)
    .map(([key, value]) => key + '=' + formatValue(value))
    .join(', ');
}

/* ----------------------------------------------------------
 * 页面准备：每个场景从“空存档 + 固定视口”开始，保证可独立复跑。
 * ---------------------------------------------------------- */

async function setViewport(cdp, width = VIEWPORT.width, height = VIEWPORT.height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
}

async function clearStorageFromHub(cdp) {
  await cdp.navigate(BASE + HALL_PATH);
  await cdp.evaluate('localStorage.clear()');
}

/** 空存档的中心页（清空后重新加载一次，确保内存态与存储一致）。 */
async function prepareHub(cdp) {
  await setViewport(cdp);
  await clearStorageFromHub(cdp);
  await cdp.navigate(BASE + HALL_PATH);
}

/** 空存档 + #test 的游戏页（等待 Arcade 与 __arcadeTest 就绪）。 */
async function prepareGame(cdp, file, tag) {
  await setViewport(cdp);
  await clearStorageFromHub(cdp);
  await cdp.navigate(BASE + '/apps/arcade/games/' + file + '?zs=' + encodeURIComponent(tag) + '#test');
  const ready = await cdp.evaluate(`({
    arcade: !!window.Arcade,
    hooks: !!window.__arcadeTest,
    hash: location.hash,
    overlay: !!document.querySelector('[data-overlay]')
  })`);
  assert(ready.arcade, file + '：Arcade 运行时未加载（engine.js 缺失或脚本报错）');
  assert(ready.hooks, file + '：#test 钩子缺失（URL 必须带 #test）');
  assert(ready.hash === '#test', file + '：URL hash=' + JSON.stringify(ready.hash) + '，期望 #test');
  assert(ready.overlay, file + '：开始弹层缺失');
}

async function startClassic(cdp) {
  await cdp.click('[data-ov-btn]');
  await cdp.waitFor('window.__arcadeTest && typeof window.__arcadeTest.info === "function" && window.__arcadeTest.info().state === "playing"', { timeout: 8000 });
}

async function safeScreenshot(cdp, name) {
  try {
    await cdp.screenshot(name);
  } catch (err) {
    /* 截图失败不影响场景判定 */
  }
}

/* ----------------------------------------------------------
 * localStorage / 引擎 API helper
 * ---------------------------------------------------------- */

async function injectStorage(cdp, entries) {
  const script =
    '(() => {' +
    Object.keys(entries)
      .map((key) => 'localStorage.setItem(' + JSON.stringify(key) + ', ' + JSON.stringify(entries[key]) + ');')
      .join('') +
    ' return true; })()';
  const ok = await cdp.evaluate(script);
  assert(ok === true, '写入 localStorage 失败');
}

async function readStorage(cdp, keys) {
  const script =
    '(() => { const out = {}; ' +
    keys.map((key) => 'out[' + JSON.stringify(key) + '] = localStorage.getItem(' + JSON.stringify(key) + ');').join(' ') +
    ' return out; })()';
  return cdp.evaluate(script);
}

/** 读取中心页积分表 DOM 快照（空状态、行、筛选、滚动容器）。 */
async function hubSnapshot(cdp) {
  return cdp.evaluate(`(() => {
    const visible = (el) => {
      if (!el || el.hidden) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      return el.getClientRects().length > 0;
    };
    const section = document.querySelector('[data-scores-section]');
    const table = document.querySelector('.hall-scores-table');
    const wrap = document.querySelector('[data-scores-wrap]');
    const empty = document.querySelector('[data-scores-empty]');
    const more = document.querySelector('[data-scores-more]');
    const count = document.querySelector('[data-scores-count]');
    const body = document.querySelector('[data-scores-body]');
    const gameSelect = document.querySelector('[data-scores-game]');
    const modeSelect = document.querySelector('[data-scores-mode]');
    return {
      section: !!section,
      table: !!table,
      headers: table ? Array.from(table.querySelectorAll('thead th')).map((th) => ({ text: th.textContent.trim(), scope: th.getAttribute('scope') })) : [],
      rows: body ? Array.from(body.querySelectorAll('tr')).map((tr) => Array.from(tr.cells).map((td) => td.textContent.trim())) : [],
      wrapVisible: visible(wrap),
      wrapOverflowX: wrap ? getComputedStyle(wrap).overflowX : null,
      wrapScrollWidth: wrap ? wrap.scrollWidth : null,
      wrapClientWidth: wrap ? wrap.clientWidth : null,
      emptyVisible: visible(empty),
      emptyText: empty ? empty.textContent.trim() : '',
      moreVisible: visible(more),
      countText: count ? count.textContent.trim() : '',
      gameValue: gameSelect ? gameSelect.value : null,
      modeValue: modeSelect ? modeSelect.value : null,
      gameOptions: gameSelect ? Array.from(gameSelect.options).map((option) => option.value) : [],
      modeOptions: modeSelect ? Array.from(modeSelect.options).map((option) => option.value) : [],
      versionText: (document.querySelector('[data-hall-version]') || {}).textContent || '',
      cards: document.querySelectorAll('.hall-card').length,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth
    };
  })()`);
}

async function scoresApiState(cdp) {
  return cdp.evaluate(`(() => {
    const arcade = window.Arcade || null;
    const api = arcade && arcade.Scores ? arcade.Scores : null;
    return {
      arcade: !!arcade,
      version: arcade ? arcade.version : null,
      scores: !!api,
      storageKey: api ? api.STORAGE_KEY : null,
      schemaVersion: api ? api.SCHEMA_VERSION : null,
      methods: api ? ${JSON.stringify(SCORES_METHODS)}.filter((name) => typeof api[name] === 'function') : []
    };
  })()`);
}

/** 断言 A.Scores 已按契约导出（缺失时给出“待实现”证据，而不是 ReferenceError）。 */
async function requireScores(cdp) {
  const state = await scoresApiState(cdp);
  assert(state.arcade, 'window.Arcade 缺失：engine.js 未加载');
  assert(state.scores, 'A.Scores 缺失：积分记录引擎（engine-scores）尚未就绪');
  const missing = SCORES_METHODS.filter((name) => state.methods.indexOf(name) === -1);
  assert(missing.length === 0, 'A.Scores 方法缺失：' + missing.join(', '));
  assert(state.storageKey === SCORES_KEY, 'A.Scores.STORAGE_KEY=' + JSON.stringify(state.storageKey) + '，期望 ' + JSON.stringify(SCORES_KEY));
  assert(state.schemaVersion === 1, 'A.Scores.SCHEMA_VERSION=' + JSON.stringify(state.schemaVersion) + '，期望 1');
  return state;
}

/** 断言禅模式 #test 钩子齐全（契约 §5.5）。 */
async function requireZenHooks(cdp) {
  const missing = await cdp.evaluate('(() => { const t = window.__arcadeTest; if (!t) return ' + JSON.stringify(ZEN_HOOKS) + '; return ' + JSON.stringify(ZEN_HOOKS) + '.filter((name) => typeof t[name] !== "function"); })()');
  assert(missing.length === 0, '禅模式 #test 钩子缺失：' + missing.join(', ') + '（tetris-zen 尚未就绪）');
}

async function readScores(cdp, opts) {
  return cdp.evaluate('window.Arcade.Scores.list(' + JSON.stringify(opts || {}) + ')');
}

async function recordScores(cdp, entries) {
  const created = await cdp.evaluate(`(() => {
    const api = window.Arcade && window.Arcade.Scores;
    if (!api || typeof api.record !== 'function') return null;
    return ${JSON.stringify(entries)}.map((entry) => api.record(entry));
  })()`);
  assert(Array.isArray(created) && created.length === entries.length, 'A.Scores.record 批量写入失败：返回 ' + JSON.stringify(created));
  created.forEach((item, index) => {
    assert(item && typeof item === 'object', '第 ' + (index + 1) + ' 条积分记录被拒绝：' + JSON.stringify(entries[index]) + ' → ' + JSON.stringify(item));
  });
  return created;
}

async function setScoresFilter(cdp, which, value) {
  const result = await cdp.evaluate(`(() => {
    const select = document.querySelector('[data-scores-${which}]');
    if (!select) return { error: '缺少 [data-scores-${which}]' };
    select.value = ${JSON.stringify(value)};
    if (select.value !== ${JSON.stringify(value)}) {
      return { error: '无法设置筛选值 ' + ${JSON.stringify(value)} + '，可用值：' + Array.from(select.options).map((option) => option.value).join(',') };
    }
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`);
  assert(result && result.ok, result && result.error ? result.error : '设置积分筛选失败：' + which + '=' + value);
  await sleep(60);
}

function assertZenInfo(info, label) {
  assert(info && typeof info === 'object', label + '：zenInfo() 返回 ' + JSON.stringify(info));
  assert(typeof info.gravitySec === 'number' && Number.isFinite(info.gravitySec), label + '：zenInfo().gravitySec=' + JSON.stringify(info.gravitySec));
  assert(typeof info.zenSpeedLevel === 'number', label + '：zenInfo().zenSpeedLevel=' + JSON.stringify(info.zenSpeedLevel));
  assert(typeof info.level === 'number', label + '：zenInfo().level=' + JSON.stringify(info.level));
}

/** 断言 SCORES_KEY 已写入且解析出的 Schema v1 记录满足 predicate。 */
async function readScoresPayload(cdp) {
  const raw = await readStorage(cdp, [SCORES_KEY]);
  const text = raw[SCORES_KEY];
  assert(typeof text === 'string' && text, 'scores:v1 未写入（localStorage 值为 ' + JSON.stringify(text) + '）');
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    assert(false, 'scores:v1 不是合法 JSON：' + text.slice(0, 80));
  }
  assert(payload && payload.schemaVersion === 1, 'scores:v1 schemaVersion=' + JSON.stringify(payload && payload.schemaVersion) + '，期望 1');
  assert(Array.isArray(payload.records), 'scores:v1 records 不是数组：' + JSON.stringify(payload && payload.records));
  return payload;
}

/* ============================================================================
 * 场景注册表（对应契约 §7 的 10 类场景，拆成 14 条便于定位失败点）：
 *   ZS-01 中心页版本 / 区块 / 空状态          —— §7.1
 *   ZS-02 经典一局 → classic 积分 + high 逻辑 —— §7.2
 *   ZS-03 禅模式 40 行不收局（无限）           —— §7.3
 *   ZS-04 禅模式 HUD / 触屏操作条              —— §5.3
 *   ZS-05 冻结 / 恢复提速（含 Z 键）           —— §7.4
 *   ZS-06 禅模式结算 → zen 记录且不污染经典 high —— §7.5
 *   ZS-07 中心页表格渲染（最新在前 / 列 / 格式化） —— §7.6
 *   ZS-08 游戏 / 模式筛选                       —— §7.6
 *   ZS-09 清除按钮只清 scores                   —— §7.6
 *   ZS-10 导出含 scores + 旧备份保留积分        —— §7.7
 *   ZS-11 新备份导入 + 非法 JSON 回滚           —— §7.7
 *   ZS-12 resetGame / resetAll                 —— §7.8
 *   ZS-13 损坏 scores fail-closed + 旧 key 兼容 —— §7.9
 *   ZS-14 320/375/390/430 布局 + 表格横向滚动   —— §7.10
 * ========================================================================== */
const SCENARIOS = [
  {
    id: 'ZS-01',
    title: '中心页版本 0.8.1 + 积分记录区块 + 空状态',
    async run(cdp) {
      await prepareHub(cdp);
      const api = await requireScores(cdp);
      assert(api.version === '0.8.1', 'A.version=' + JSON.stringify(api.version) + '，期望 0.8.1');
      const dom = await hubSnapshot(cdp);
      assert(dom.section, '中心页缺少 [data-scores-section] 积分记录区块');
      assert(dom.versionText.trim() === '0.8.1', '[data-hall-version]=' + JSON.stringify(dom.versionText) + '，期望 0.8.1');
      assert(dom.table, '缺少 .hall-scores-table 积分表格');
      const headers = dom.headers.map((item) => item.text).join('/');
      assert(headers === '时间/游戏/模式/得分/详情', '表头=' + JSON.stringify(headers) + '，期望 时间/游戏/模式/得分/详情');
      assert(dom.headers.length === 5 && dom.headers.every((item) => item.scope === 'col'), '表头数量/scope 不合格：' + JSON.stringify(dom.headers));
      assert(dom.emptyVisible, '空存档时 [data-scores-empty] 空状态未显示');
      assert(dom.emptyText.length > 0, '空状态文案为空');
      assert(dom.rows.length === 0, '空存档时表格行数=' + dom.rows.length + '，期望 0');
      assert(dom.countText === '共 0 条', '[data-scores-count]=' + JSON.stringify(dom.countText) + '，期望 共 0 条');
      const list = await readScores(cdp);
      assert(Array.isArray(list) && list.length === 0, 'A.Scores.list()=' + JSON.stringify(list) + '，空存档应返回 []');
      const stats = await cdp.evaluate('window.Arcade.Scores.stats()');
      assert(stats && stats.total === 0, 'A.Scores.stats()=' + JSON.stringify(stats) + '，期望 total 0');
      return { version: api.version, headers, emptyText: dom.emptyText.slice(0, 24) };
    },
  },
  {
    id: 'ZS-02',
    title: '经典一局结束写入 classic 积分且 progress 最高分逻辑不变',
    async run(cdp) {
      await prepareGame(cdp, GAME_FILE, 'zs02');
      await requireScores(cdp);
      await startClassic(cdp);
      assert((await cdp.evaluate('window.__arcadeTest.lineClearScenario(39)')) === true, 'lineClearScenario(39) 未返回 true');
      await cdp.waitFor('window.__arcadeTest.info().state === "over"', { timeout: 8000 });
      const first = await cdp.evaluate(`(() => ({
        info: window.__arcadeTest.info(),
        progress: window.Arcade.Progress.get('block-drop'),
        records: window.Arcade.Scores.list({ gameId: 'block-drop', mode: 'classic' })
      }))()`);
      assert(first.info.lines >= 40, '经典 40 行收局后 lines=' + first.info.lines + '，期望 ≥40');
      const high = first.info.score;
      assert(high > 0, '经典 40 行收局得分=' + high + '，期望 > 0');
      assert(first.progress.plays === 1, '首局结束后 plays=' + first.progress.plays + '，期望 1');
      assert(first.progress.high === high, '首局结束后 high=' + first.progress.high + '，期望 ' + high);
      assert(first.progress.lastScore === high, '首局结束后 lastScore=' + first.progress.lastScore + '，期望 ' + high);
      assert(first.records.length === 1, 'scores:v1 classic 记录数=' + first.records.length + '，期望 1');
      const record = first.records[0];
      assert(record.gameId === 'block-drop', 'classic 记录 gameId=' + JSON.stringify(record.gameId) + '，期望 block-drop');
      assert(record.mode === 'classic', 'classic 记录 mode=' + JSON.stringify(record.mode) + '，期望 classic');
      assert(record.score === high, 'classic 记录 score=' + record.score + ' 与结算得分 ' + high + ' 不一致');
      assert(typeof record.at === 'string' && !Number.isNaN(Date.parse(record.at)), 'classic 记录 at=' + JSON.stringify(record.at) + ' 不是合法时间');
      const payload = await readScoresPayload(cdp);
      assert(payload.records.length === 1, 'scores:v1 原始记录数=' + payload.records.length + '，期望 1');
      assert(payload.records[0].gameId === 'block-drop' && payload.records[0].mode === 'classic', 'scores:v1 首条记录字段错误：' + JSON.stringify(payload.records[0]));

      /* 第二局等效得分：最高分不得被覆盖/降低，plays 递增。 */
      await cdp.click('[data-ov-btn]');
      await cdp.waitFor('window.__arcadeTest.info().state === "playing"', { timeout: 8000 });
      await cdp.evaluate('window.__arcadeTest.lineClearScenario(39)');
      await cdp.waitFor('window.__arcadeTest.info().state === "over"', { timeout: 8000 });
      const second = await cdp.evaluate(`(() => ({
        info: window.__arcadeTest.info(),
        progress: window.Arcade.Progress.get('block-drop'),
        records: window.Arcade.Scores.list({ gameId: 'block-drop', mode: 'classic' })
      }))()`);
      assert(second.progress.plays === 2, '第二局后 plays=' + second.progress.plays + '，期望 2');
      assert(second.progress.high === high, '第二局后 high=' + second.progress.high + '，应保持 ' + high + '（未被 0 分/低分覆盖）');
      assert(second.progress.lastScore === second.info.score, '第二局后 lastScore=' + second.progress.lastScore + '，期望 ' + second.info.score);
      assert(second.records.length === 2, '第二局后 classic 记录数=' + second.records.length + '，期望 2');
      assert(second.records.every((item) => item.mode === 'classic'), 'classic 记录中出现非 classic 模式：' + JSON.stringify(second.records.map((item) => item.mode)));
      return { score: high, plays: second.progress.plays, classicRecords: second.records.length };
    },
  },
  {
    id: 'ZS-03',
    title: '禅模式无限：40 行后仍在 playing 且无结算弹层',
    async run(cdp) {
      await prepareGame(cdp, GAME_FILE, 'zs03');
      await requireZenHooks(cdp);
      assert((await cdp.evaluate('window.__arcadeTest.startZen()')) === true, 'startZen() 未返回 true');
      await cdp.waitFor('window.__arcadeTest.zenInfo().state === "playing"', { timeout: 8000 });
      const preset = await cdp.evaluate('window.__arcadeTest.zenSetState({ lines: 39 })');
      assertZenInfo(preset, 'lines=39');
      assert(preset.mode === 'zen', 'zenSetState 后 mode=' + JSON.stringify(preset.mode) + '，期望 zen');
      assert(preset.lines === 39, 'zenSetState 后 lines=' + preset.lines + '，期望 39');
      assert(preset.level === 4, 'lines=39 时 level=' + preset.level + '，期望 4');
      assert((await cdp.evaluate('window.__arcadeTest.zenLineClearScenario(39)')) === true, 'zenLineClearScenario(39) 未返回 true');
      await cdp.waitFor('window.__arcadeTest.zenInfo().lines >= 40', { timeout: 6000 });
      const info = await cdp.evaluate('window.__arcadeTest.zenInfo()');
      assert(info.lines >= 40, '清行后 lines=' + info.lines + '，期望 ≥40');
      assert(info.state === 'playing', '40 行后 state=' + JSON.stringify(info.state) + '，禅模式应继续 playing（不结算）');
      assert(info.mode === 'zen', '40 行后 mode=' + JSON.stringify(info.mode) + '，期望 zen');
      assert(info.shortRun === false, 'zenInfo().shortRun=' + JSON.stringify(info.shortRun) + '，期望 false');
      assert(typeof info.high === 'number', 'zenInfo().high 缺失：' + JSON.stringify(info.high));
      const overlay = await cdp.evaluate(`({
        hidden: document.querySelector('[data-overlay]').hidden,
        title: document.querySelector('[data-ov-title]') ? document.querySelector('[data-ov-title]').textContent : null
      })`);
      assert(overlay.hidden === true, '40 行后出现结算弹层：' + JSON.stringify(overlay.title));
      return { lines: info.lines, level: info.level, state: info.state };
    },
  },
  {
    id: 'ZS-04',
    title: '禅模式 HUD 与触屏操作条（§5.3）',
    async run(cdp) {
      await prepareGame(cdp, GAME_FILE, 'zs04');
      await requireZenHooks(cdp);
      const beforeStart = await cdp.evaluate(`(() => {
        const visible = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
        const zen = document.querySelector('[data-hud-zen]');
        return {
          zenHidden: zen ? zen.hidden : null,
          zenText: zen ? zen.textContent.trim() : '',
          zenVisible: visible(zen),
          barVisible: visible(document.querySelector('.zen-bar'))
        };
      })()`);
      assert(beforeStart.zenHidden === true && beforeStart.zenText === '', '经典开始界面不应处于禅模式 HUD 状态：' + JSON.stringify(beforeStart));
      assert(beforeStart.zenVisible === false, '经典开始界面不应显示禅模式 HUD');
      assert(beforeStart.barVisible === false, '经典开始界面不应显示 .zen-bar 操作条');

      assert((await cdp.evaluate('window.__arcadeTest.startZen()')) === true, 'startZen() 未返回 true');
      await cdp.waitFor('window.__arcadeTest.zenInfo().state === "playing"', { timeout: 8000 });

      /* 420px（手机视口）下 .game-hud 整体由既有 CSS 隐藏、分数画在画布内；
         这里先断言 DOM 状态正确（hidden 属性 / 文案 / 最高分隐藏），再切宽视口验证真实可见性。 */
      const state = await cdp.evaluate(`(() => {
        const zen = document.querySelector('[data-hud-zen]');
        const highWrap = document.querySelector('[data-hud-highwrap]');
        const bar = document.querySelector('.zen-bar');
        return {
          zenExists: !!zen,
          zenHidden: zen ? zen.hidden : null,
          zenText: (zen ? zen.textContent : '').replace(/\\s+/g, ' ').trim(),
          highWrapExists: !!highWrap,
          highWrapHidden: highWrap ? highWrap.hidden : null,
          barExists: !!bar,
          barHidden: bar ? bar.hidden : null,
          barText: (bar ? bar.textContent : '').replace(/\\s+/g, ' ').trim(),
          barButtons: bar ? Array.from(bar.querySelectorAll('button')).map((button) => { const rect = button.getBoundingClientRect(); return { w: Math.round(rect.width), h: Math.round(rect.height), hidden: button.hidden, disabled: button.disabled }; }) : []
        };
      })()`);
      assert(state.zenExists, '缺少 [data-hud-zen] 禅模式 HUD 元素');
      assert(state.zenHidden === false, '禅模式时 [data-hud-zen].hidden=' + JSON.stringify(state.zenHidden) + '，期望 false');
      assert(state.zenText.indexOf('禅模式') !== -1, '禅模式 HUD 文案=' + JSON.stringify(state.zenText) + '，应包含「禅模式」');
      assert(state.zenText.indexOf('速度 Lv.') !== -1, '禅模式 HUD 文案=' + JSON.stringify(state.zenText) + '，应包含「速度 Lv.」');
      assert(state.zenText.indexOf('行数') !== -1, '禅模式 HUD 文案=' + JSON.stringify(state.zenText) + '，应包含「行数」');
      assert(state.highWrapExists && state.highWrapHidden === true, '禅模式未隐藏经典「最高」：highWrap.hidden=' + JSON.stringify(state.highWrapHidden) + '（避免误读为禅模式最高分）');
      assert(state.barExists, '缺少 .zen-bar 禅模式触屏操作条');
      assert(state.barHidden === false, '禅模式时 .zen-bar.hidden=' + JSON.stringify(state.barHidden) + '，期望 false');
      assert(state.barButtons.length >= 2, '.zen-bar 按钮数=' + state.barButtons.length + '，期望 ≥2');
      assert(state.barButtons.every((button) => button.hidden === false), '.zen-bar 有按钮被隐藏：' + JSON.stringify(state.barButtons));
      assert(state.barButtons.every((button) => button.w >= 44 && button.h >= 44), '.zen-bar 按钮小于 44px：' + JSON.stringify(state.barButtons));
      assert(state.barText.indexOf('冻结') !== -1, '.zen-bar 文案=' + JSON.stringify(state.barText) + '，应包含「冻结提速」');
      assert(state.barText.indexOf('结束') !== -1, '.zen-bar 文案=' + JSON.stringify(state.barText) + '，应包含「结束本局」');

      /* 宽视口：.game-hud 不再被窄屏 CSS 隐藏，验证禅模式 HUD 真实可见、经典「最高」不可见。 */
      await setViewport(cdp, 900, 640);
      await sleep(160);
      const wide = await cdp.evaluate(`(() => {
        const visible = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
        const hud = document.querySelector('.game-hud');
        return {
          hudDisplay: hud ? getComputedStyle(hud).display : null,
          zenVisible: visible(document.querySelector('[data-hud-zen]')),
          highVisible: visible(document.querySelector('[data-hud-high]')),
          zenText: (document.querySelector('[data-hud-zen]') || {}).textContent || ''
        };
      })()`);
      assert(wide.hudDisplay !== 'none', '900px 视口下 .game-hud 仍不可见：display=' + JSON.stringify(wide.hudDisplay));
      assert(wide.zenVisible === true, '900px 视口下禅模式 [data-hud-zen] 不可见');
      assert(wide.highVisible === false, '900px 视口下禅模式仍显示经典「最高」');
      assert(wide.zenText.indexOf('禅模式') !== -1, '900px 视口禅模式 HUD 文案=' + JSON.stringify(wide.zenText));
      await setViewport(cdp);
      return { zenText: state.zenText.slice(0, 40), barButtons: state.barButtons.length, wideHudVisible: wide.zenVisible };
    },
  },
  {
    id: 'ZS-05',
    title: '禅模式冻结/恢复提速：冻结时速度不变，恢复后追平 level（含 Z 键）',
    async run(cdp) {
      await prepareGame(cdp, GAME_FILE, 'zs05');
      await requireZenHooks(cdp);
      assert((await cdp.evaluate('window.__arcadeTest.startZen()')) === true, 'startZen() 未返回 true');
      await cdp.waitFor('window.__arcadeTest.zenInfo().state === "playing"', { timeout: 8000 });

      const base = await cdp.evaluate('window.__arcadeTest.zenSetState({ lines: 20 })');
      assertZenInfo(base, 'lines=20');
      assert(base.level === 3, 'lines=20 时 level=' + base.level + '，期望 3');
      assert(base.zenFrozen === false, '初始 zenFrozen=' + JSON.stringify(base.zenFrozen) + '，期望 false');
      assert(base.zenSpeedLevel === base.level, '未冻结时 zenSpeedLevel=' + base.zenSpeedLevel + '，应追平 level=' + base.level);

      const toggled = await cdp.evaluate('window.__arcadeTest.toggleZenFreeze()');
      assert(toggled && toggled.zenFrozen === true, 'toggleZenFreeze() 未冻结：' + JSON.stringify(toggled));
      const frozen = await cdp.evaluate('window.__arcadeTest.zenInfo()');
      assertZenInfo(frozen, '冻结后');
      assert(frozen.zenFrozen === true, '冻结后 zenFrozen=' + JSON.stringify(frozen.zenFrozen));
      assert(frozen.zenSpeedLevel === base.zenSpeedLevel, '冻结后 zenSpeedLevel=' + frozen.zenSpeedLevel + '，应保持 ' + base.zenSpeedLevel);
      assert(Math.abs(frozen.gravitySec - base.gravitySec) <= 1e-9, '冻结后 gravitySec=' + frozen.gravitySec + '，应保持 ' + base.gravitySec);

      /* 冻结期间提升到 level 5：zenSpeedLevel 与重力必须原地不动。 */
      const raised = await cdp.evaluate('window.__arcadeTest.zenSetState({ lines: 40 })');
      assertZenInfo(raised, '冻结后 lines=40');
      assert(raised.level === 5, '冻结后 lines=40 时 level=' + raised.level + '，期望 5');
      assert(raised.zenFrozen === true, 'zenSetState 解除了冻结：zenFrozen=' + JSON.stringify(raised.zenFrozen));
      assert(raised.zenSpeedLevel === base.zenSpeedLevel, '冻结提速后 zenSpeedLevel=' + raised.zenSpeedLevel + '，应保持 ' + base.zenSpeedLevel);
      assert(Math.abs(raised.gravitySec - base.gravitySec) <= 1e-9, '冻结提速后 gravitySec=' + raised.gravitySec + '，应保持 ' + base.gravitySec);
      await sleep(60);
      const frozenBar = await cdp.evaluate(`(() => { const bar = document.querySelector('.zen-bar'); return bar ? bar.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`);
      assert(frozenBar.indexOf('恢复') !== -1, '冻结后 .zen-bar 文案=' + JSON.stringify(frozenBar) + '，应切换为「恢复提速」');

      /* 恢复：zenSpeedLevel 立即追平当前 level，重力变小。 */
      const resumedToggle = await cdp.evaluate('window.__arcadeTest.toggleZenFreeze()');
      assert(resumedToggle && resumedToggle.zenFrozen === false, '再次 toggleZenFreeze() 未恢复：' + JSON.stringify(resumedToggle));
      const resumed = await cdp.evaluate('window.__arcadeTest.zenInfo()');
      assertZenInfo(resumed, '恢复后');
      assert(resumed.zenFrozen === false, '恢复后 zenFrozen=' + JSON.stringify(resumed.zenFrozen));
      assert(resumed.zenSpeedLevel === raised.level, '恢复提速后 zenSpeedLevel=' + resumed.zenSpeedLevel + '，应追平 level=' + raised.level);
      assert(resumed.gravitySec < base.gravitySec, '恢复提速后 gravitySec=' + resumed.gravitySec + '，应小于冻结时 ' + base.gravitySec);
      const resumedBar = await cdp.evaluate(`(() => { const bar = document.querySelector('.zen-bar'); return bar ? bar.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`);
      assert(resumedBar.indexOf('冻结') !== -1, '恢复后 .zen-bar 文案=' + JSON.stringify(resumedBar) + '，应恢复「冻结提速」');

      /* Z 键真实键盘输入（按住 ≥1 帧后松开，验证边沿触发）。 */
      await cdp.key('z', 'down');
      await sleep(180);
      await cdp.key('z', 'up');
      await sleep(120);
      const byKey = await cdp.evaluate('window.__arcadeTest.zenInfo()');
      assert(byKey.zenFrozen === true, '按 Z 键未冻结提速：zenFrozen=' + JSON.stringify(byKey.zenFrozen));
      await cdp.key('z', 'down');
      await sleep(180);
      await cdp.key('z', 'up');
      await sleep(120);
      const byKeyAgain = await cdp.evaluate('window.__arcadeTest.zenInfo()');
      assert(byKeyAgain.zenFrozen === false, '再次按 Z 键未恢复提速：zenFrozen=' + JSON.stringify(byKeyAgain.zenFrozen));
      return {
        frozenSpeedLevel: raised.zenSpeedLevel,
        levelAfterRaise: raised.level,
        gravityFrozen: base.gravitySec,
        gravityResumed: resumed.gravitySec,
        zKeyToggles: true,
      };
    },
  },
  {
    id: 'ZS-06',
    title: '禅模式结算写入 zen 积分且不污染经典最高分',
    async run(cdp) {
      await prepareGame(cdp, GAME_FILE, 'zs06');
      await requireScores(cdp);
      await requireZenHooks(cdp);

      /* 先跑一局经典，建立可验证的经典最高分基线。 */
      await startClassic(cdp);
      assert((await cdp.evaluate('window.__arcadeTest.lineClearScenario(39)')) === true, '经典 lineClearScenario(39) 未返回 true');
      await cdp.waitFor('window.__arcadeTest.info().state === "over"', { timeout: 8000 });
      const baseline = await cdp.evaluate(`({
        progress: window.Arcade.Progress.get('block-drop'),
        records: window.Arcade.Scores.list({ gameId: 'block-drop', mode: 'classic' })
      })`);
      const classicHigh = baseline.progress.high;
      assert(classicHigh > 0 && baseline.progress.plays === 1, '经典基线未建立：' + JSON.stringify({ high: classicHigh, plays: baseline.progress.plays }));
      assert(baseline.records.length === 1, '经典基线积分记录数=' + baseline.records.length + '，期望 1');

      assert((await cdp.evaluate('window.__arcadeTest.startZen()')) === true, 'startZen() 未返回 true');
      await cdp.waitFor('window.__arcadeTest.zenInfo().state === "playing"', { timeout: 8000 });
      assert((await cdp.evaluate('window.__arcadeTest.zenLineClearScenario(39)')) === true, 'zenLineClearScenario(39) 未返回 true');
      await cdp.waitFor('window.__arcadeTest.zenInfo().lines >= 40', { timeout: 6000 });
      assert((await cdp.evaluate('window.__arcadeTest.endZen()')) === true, 'endZen() 返回非 true（结算未走真实逻辑）');
      await sleep(160);
      const settled = await cdp.evaluate(`(() => ({
        overlayVisible: !document.querySelector('[data-overlay]').hidden,
        title: (document.querySelector('[data-ov-title]') || {}).textContent || '',
        text: ((document.querySelector('[data-ov-text]') || {}).textContent || '').replace(/\\s+/g, ' ').trim(),
        button: (document.querySelector('[data-ov-btn]') || {}).textContent || '',
        scores: window.Arcade.Scores.list(),
        progress: window.Arcade.Progress.get('block-drop'),
        zen: window.__arcadeTest.zenInfo()
      }))()`);
      assert(settled.overlayVisible, 'endZen() 后结算弹层未显示');
      assert(settled.title.indexOf('禅') !== -1, '禅模式结算标题=' + JSON.stringify(settled.title) + '，应包含「禅」');
      assert(settled.button.indexOf('再来') !== -1 || settled.button.indexOf('开始') !== -1, '结算主按钮=' + JSON.stringify(settled.button) + '，应为「再来一局」或「回到开始」');
      assert(settled.zen.state !== 'playing', 'endZen() 后仍处于 playing：' + JSON.stringify(settled.zen.state));
      assert(settled.progress.high === classicHigh, '禅模式污染经典最高分：high=' + settled.progress.high + '，期望 ' + classicHigh);
      assert(settled.progress.plays === 2, 'endZen() 后 plays=' + settled.progress.plays + '，期望 2');
      assert(settled.progress.lastScore === settled.zen.score, 'endZen() 后 lastScore=' + settled.progress.lastScore + '，期望 ' + settled.zen.score);
      const zenRecords = settled.scores.filter((item) => item.mode === 'zen');
      assert(zenRecords.length === 1, '禅模式积分记录数=' + zenRecords.length + '，期望 1');
      const zenRecord = zenRecords[0];
      assert(zenRecord.gameId === 'block-drop', '禅记录 gameId=' + JSON.stringify(zenRecord.gameId) + '，期望 block-drop');
      assert(zenRecord.score === settled.zen.score, '禅记录 score=' + zenRecord.score + ' 与 zenInfo().score=' + settled.zen.score + ' 不一致');
      assert(zenRecord.lines >= 40, '禅记录 lines=' + zenRecord.lines + '，期望 ≥40');
      assert(typeof zenRecord.detail === 'string' && zenRecord.detail.indexOf('禅模式') !== -1, '禅记录 detail=' + JSON.stringify(zenRecord.detail) + '，应包含「禅模式」');
      assert(settled.scores.filter((item) => item.mode === 'classic').length === 1, '经典积分记录数被改变：' + JSON.stringify(settled.scores.map((item) => item.mode)));

      /* 重复结算不得重复记录（recordSaved 保护）。 */
      const countBeforeAgain = settled.scores.length;
      await cdp.evaluate(`(() => { try { return { value: window.__arcadeTest.endZen() }; } catch (err) { return { error: String(err) }; } })()`);
      const afterAgain = await readScores(cdp);
      assert(afterAgain.length === countBeforeAgain, '重复 endZen() 产生了额外积分记录：' + (afterAgain.length - countBeforeAgain) + ' 条');
      await safeScreenshot(cdp, 'zen-settlement.png');
      return { zenScore: zenRecord.score, classicHigh, plays: settled.progress.plays, title: settled.title.slice(0, 20) };
    },
  },
  {
    id: 'ZS-07',
    title: '中心页积分表格：多条记录、最新在前、列与格式化',
    async run(cdp) {
      await prepareHub(cdp);
      await requireScores(cdp);
      const created = await recordScores(cdp, [
        { gameId: 'block-drop', mode: 'classic', score: 1234, lines: 40, level: 5, durationMs: 93000, detail: '40 行 · Lv.5', at: '2026-11-13T12:00:00.000Z' },
        { gameId: 'block-drop', mode: 'zen', score: 999, lines: 41, level: 5, detail: '禅模式 · 41 行 · Lv.5', at: '2026-11-13T12:01:00.000Z' },
        { gameId: 'snake-run', mode: 'classic', score: 321, detail: '20 个果实', at: '2026-11-13T12:02:00.000Z' },
      ]);
      assert(created.length === 3, '注入积分记录数=' + created.length + '，期望 3');
      await cdp.navigate(BASE + HALL_PATH);
      const dom = await hubSnapshot(cdp);
      assert(dom.rows.length === 3, '表格行数=' + dom.rows.length + '，期望 3');
      assert(dom.emptyVisible === false, '有数据时仍显示空状态');
      assert(dom.wrapVisible === true, '有数据时积分表格容器不可见');
      assert(dom.moreVisible === false, '3 条记录不应显示「仅显示最近 50 条」');
      assert(dom.countText === '共 3 条', '[data-scores-count]=' + JSON.stringify(dom.countText) + '，期望 共 3 条');
      assert(dom.headers.map((item) => item.text).join('/') === '时间/游戏/模式/得分/详情', '表头=' + JSON.stringify(dom.headers.map((item) => item.text)));
      assert(dom.headers.every((item) => item.scope === 'col'), '表头缺少 scope="col"：' + JSON.stringify(dom.headers));

      const expectedNewestTime = await cdp.evaluate("window.Arcade.formatRoundAt('2026-11-13T12:02:00.000Z')");
      assert(dom.rows[0][0] === expectedNewestTime, '最新记录时间=' + JSON.stringify(dom.rows[0][0]) + '，期望 ' + JSON.stringify(expectedNewestTime));
      assert(dom.rows[0][1].indexOf('贪吃蛇') !== -1, '最新记录游戏列=' + JSON.stringify(dom.rows[0][1]) + '，应包含「贪吃蛇」（最新在前）');
      assert(dom.rows[0][2] === '经典', '最新记录模式列=' + JSON.stringify(dom.rows[0][2]) + '，期望「经典」');
      assert(dom.rows[0][3] === '321', '最新记录得分列=' + JSON.stringify(dom.rows[0][3]) + '，期望 321');
      assert(dom.rows[0][4] === '20 个果实', '最新记录详情列=' + JSON.stringify(dom.rows[0][4]) + '，期望「20 个果实」');
      assert(dom.rows[1][2] === '禅模式', '第二条记录模式列=' + JSON.stringify(dom.rows[1][2]) + '，期望「禅模式」');
      assert(dom.rows[1][3] === '999', '第二条记录得分列=' + JSON.stringify(dom.rows[1][3]) + '，期望 999');
      assert(dom.rows[2][1].indexOf('俄罗斯方块') !== -1, '第三条记录游戏列=' + JSON.stringify(dom.rows[2][1]) + '，应包含「俄罗斯方块」');
      assert(dom.rows[2][3] === '1,234', '千分位格式化=' + JSON.stringify(dom.rows[2][3]) + '，期望 1,234');
      assert(dom.rows[2][4] === '40 行 · Lv.5', '第三条记录详情列=' + JSON.stringify(dom.rows[2][4]) + '，期望「40 行 · Lv.5」');
      assert(dom.gameOptions.indexOf('block-drop') !== -1 && dom.gameOptions.indexOf('snake-run') !== -1, '游戏筛选缺少有记录的游戏：' + JSON.stringify(dom.gameOptions));
      assert(dom.modeOptions.join(',') === 'all,classic,zen', '模式筛选选项=' + JSON.stringify(dom.modeOptions) + '，期望 all,classic,zen');
      await safeScreenshot(cdp, 'zen-scores-hub.png');
      return { rows: dom.rows.length, countText: dom.countText, newest: dom.rows[0][1] + '/' + dom.rows[0][2] };
    },
  },
  {
    id: 'ZS-08',
    title: '中心页积分表格：游戏/模式筛选正确',
    async run(cdp) {
      await prepareHub(cdp);
      await requireScores(cdp);
      await recordScores(cdp, [
        { gameId: 'block-drop', mode: 'classic', score: 1234, detail: '40 行 · Lv.5', at: '2026-11-13T12:00:00.000Z' },
        { gameId: 'block-drop', mode: 'zen', score: 999, detail: '禅模式 · 41 行 · Lv.5', at: '2026-11-13T12:01:00.000Z' },
        { gameId: 'snake-run', mode: 'classic', score: 321, detail: '20 个果实', at: '2026-11-13T12:02:00.000Z' },
      ]);
      await cdp.navigate(BASE + HALL_PATH);

      await setScoresFilter(cdp, 'game', 'block-drop');
      let dom = await hubSnapshot(cdp);
      assert(dom.gameValue === 'block-drop', '游戏筛选值=' + JSON.stringify(dom.gameValue) + '，期望 block-drop');
      assert(dom.rows.length === 2, '筛选游戏 block-drop 后行数=' + dom.rows.length + '，期望 2');
      assert(dom.rows.every((row) => row[1].indexOf('俄罗斯方块') !== -1), '筛选后出现其它游戏：' + JSON.stringify(dom.rows.map((row) => row[1])));

      await setScoresFilter(cdp, 'mode', 'zen');
      dom = await hubSnapshot(cdp);
      assert(dom.modeValue === 'zen', '模式筛选值=' + JSON.stringify(dom.modeValue) + '，期望 zen');
      assert(dom.rows.length === 1, '游戏=block-drop + 模式=禅模式后行数=' + dom.rows.length + '，期望 1');
      assert(dom.rows[0][2] === '禅模式' && dom.rows[0][3] === '999', '禅模式筛选结果错误：' + JSON.stringify(dom.rows[0]));

      await setScoresFilter(cdp, 'game', '');
      dom = await hubSnapshot(cdp);
      assert(dom.rows.length === 1, '模式=禅模式 + 全部游戏后行数=' + dom.rows.length + '，期望 1');
      assert(dom.rows[0][1].indexOf('俄罗斯方块') !== -1, '全部游戏/禅模式结果错误：' + JSON.stringify(dom.rows[0][1]));

      await setScoresFilter(cdp, 'mode', 'classic');
      dom = await hubSnapshot(cdp);
      assert(dom.rows.length === 2, '模式=经典后行数=' + dom.rows.length + '，期望 2');
      assert(dom.rows.every((row) => row[2] === '经典'), '经典筛选出现非经典记录：' + JSON.stringify(dom.rows.map((row) => row[2])));

      await setScoresFilter(cdp, 'mode', 'all');
      dom = await hubSnapshot(cdp);
      assert(dom.rows.length === 3, '恢复全部模式后行数=' + dom.rows.length + '，期望 3');
      assert(dom.wrapOverflowX === 'auto' || dom.wrapOverflowX === 'scroll', '积分表格容器 overflow-x=' + JSON.stringify(dom.wrapOverflowX) + '，无法横向滚动');
      return { gameFilterRows: 2, zenRows: 1, classicRows: 2, overflowX: dom.wrapOverflowX };
    },
  },
  {
    id: 'ZS-09',
    title: '清除积分按钮：只清 scores，progress/playtime/challenge 原样保留',
    async run(cdp) {
      await prepareHub(cdp);
      await requireScores(cdp);
      const seeded = {
        [LEGACY_KEYS.progress]: JSON.stringify({ schemaVersion: 1, games: { 'block-drop': { high: 500, plays: 3, lastAt: '2026-11-01T08:00:00.000Z', lastScore: 120 } } }),
        [LEGACY_KEYS.playtime]: JSON.stringify({
          schemaVersion: 1,
          games: { 'block-drop': { ms: 60000, count: 1, lastAt: '2026-11-01T08:00:00.000Z', days: { '2026-11-01': 60000 }, rounds: [] } },
          updatedAt: '2026-11-01T08:00:00.000Z',
        }),
        [LEGACY_KEYS.challenge]: JSON.stringify({
          schemaVersion: 1,
          games: { 'block-drop': { cleared: ['block-drop-C01'], best: {}, updatedAt: '2026-11-01T08:00:00.000Z' } },
          updatedAt: '2026-11-01T08:00:00.000Z',
        }),
      };
      await injectStorage(cdp, seeded);
      await recordScores(cdp, [
        { gameId: 'block-drop', mode: 'classic', score: 700, at: '2026-11-13T13:00:00.000Z' },
        { gameId: 'block-drop', mode: 'zen', score: 300, at: '2026-11-13T13:01:00.000Z' },
        { gameId: 'snake-run', mode: 'classic', score: 50, at: '2026-11-13T13:02:00.000Z' },
      ]);
      await cdp.navigate(BASE + HALL_PATH);
      const before = await readStorage(cdp, [LEGACY_KEYS.progress, LEGACY_KEYS.playtime, LEGACY_KEYS.challenge]);
      const domBefore = await hubSnapshot(cdp);
      assert(domBefore.rows.length === 3, '清除前行数=' + domBefore.rows.length + '，期望 3');

      /* 无头 Chrome 用真实按钮点击 + confirm 计数桩：验证清除走确认分支，避免原生对话框挂起。 */
      await cdp.evaluate(`(() => {
        window.__zsConfirmCalls = 0;
        window.__zsConfirmMessage = '';
        window.confirm = (message) => { window.__zsConfirmCalls += 1; window.__zsConfirmMessage = String(message || ''); return true; };
        return true;
      })()`);
      await cdp.click('[data-scores-clear]');
      await sleep(180);
      const after = await cdp.evaluate(`(() => ({
        confirmCalls: window.__zsConfirmCalls || 0,
        confirmMessage: window.__zsConfirmMessage || '',
        scores: window.Arcade.Scores.list(),
        stats: window.Arcade.Scores.stats(),
        progress: window.Arcade.Progress.get('block-drop'),
        playtimeTotalMs: window.Arcade.Playtime.stats().totalMs,
        challengeCleared: window.Arcade.Challenge.progress('block-drop').cleared,
        storage: {
          progress: localStorage.getItem(${JSON.stringify(LEGACY_KEYS.progress)}),
          playtime: localStorage.getItem(${JSON.stringify(LEGACY_KEYS.playtime)}),
          challenge: localStorage.getItem(${JSON.stringify(LEGACY_KEYS.challenge)}),
          scores: localStorage.getItem(${JSON.stringify(SCORES_KEY)})
        }
      }))()`);
      const domAfter = await hubSnapshot(cdp);
      assert(after.confirmCalls >= 1, '清除积分未走 confirm 确认：confirmCalls=' + after.confirmCalls);
      assert(Array.isArray(after.scores) && after.scores.length === 0, '清除后 A.Scores.list() 条数=' + JSON.stringify(after.scores && after.scores.length) + '，期望 0');
      assert(after.stats && after.stats.total === 0, '清除后 A.Scores.stats()=' + JSON.stringify(after.stats));
      assert(after.storage.progress === before[LEGACY_KEYS.progress], '清除积分改动了 progress:v1：' + JSON.stringify(after.storage.progress));
      assert(after.storage.playtime === before[LEGACY_KEYS.playtime], '清除积分改动了 playtime:v1：' + JSON.stringify(after.storage.playtime));
      assert(after.storage.challenge === before[LEGACY_KEYS.challenge], '清除积分改动了 challenge:v1：' + JSON.stringify(after.storage.challenge));
      assert(after.progress.high === 500 && after.progress.plays === 3, '清除积分后最高分/局数被改动：' + JSON.stringify(after.progress));
      assert(after.playtimeTotalMs === 60000, '清除积分后游玩时长被改动：' + after.playtimeTotalMs);
      assert(Array.isArray(after.challengeCleared) && after.challengeCleared.length === 1, '清除积分后挑战记录被改动：' + JSON.stringify(after.challengeCleared));
      assert(after.storage.scores === null || JSON.parse(after.storage.scores).records.length === 0, '清除后 scores:v1 仍含记录：' + String(after.storage.scores).slice(0, 120));
      assert(domAfter.rows.length === 0, '清除后表格行数=' + domAfter.rows.length + '，期望 0');
      assert(domAfter.emptyVisible === true, '清除后空状态未显示');
      assert(domAfter.countText === '共 0 条', '清除后计数=' + JSON.stringify(domAfter.countText) + '，期望 共 0 条');
      return { confirmCalls: after.confirmCalls, clearedRows: domBefore.rows.length, progressHigh: after.progress.high, playtimeMs: after.playtimeTotalMs };
    },
  },
  {
    id: 'ZS-10',
    title: '导出备份含 scores；导入旧备份（无 scores）保留当前积分记录',
    async run(cdp) {
      await prepareHub(cdp);
      await requireScores(cdp);
      await recordScores(cdp, [
        { gameId: 'block-drop', mode: 'classic', score: 4321, detail: '40 行 · Lv.5', at: '2026-11-13T10:00:00.000Z' },
        { gameId: 'snake-run', mode: 'zen', score: 88, detail: '禅模式 · 22 行 · Lv.3', at: '2026-11-13T10:01:00.000Z' },
      ]);
      const exported = await cdp.evaluate('window.Arcade.Progress.exportText()');
      assert(typeof exported === 'string' && exported.indexOf('"scores"') !== -1, '导出备份缺少 scores 字段：' + String(exported).slice(0, 160));
      const backup = JSON.parse(exported);
      assert(backup.scores && backup.scores.schemaVersion === 1, '备份 scores Schema=' + JSON.stringify(backup.scores && backup.scores.schemaVersion) + '，期望 1');
      assert(Array.isArray(backup.scores.records) && backup.scores.records.length === 2, '备份 scores 记录数=' + JSON.stringify(backup.scores.records && backup.scores.records.length) + '，期望 2');
      const current = await readScores(cdp);
      assert(current.length === 2, '导出前 A.Scores.list() 条数=' + current.length + '，期望 2');

      const oldBackup = JSON.parse(exported);
      delete oldBackup.scores;
      const oldImport = await cdp.evaluate('window.Arcade.Progress.importText(' + JSON.stringify(JSON.stringify(oldBackup)) + ')');
      assert(oldImport && oldImport.ok === true, '导入旧备份失败：' + JSON.stringify(oldImport));
      assert(typeof oldImport.scoreCount === 'number', '导入结果缺少 scoreCount 字段（契约 §3）：' + JSON.stringify(oldImport));
      const preserved = await readScores(cdp);
      assert(JSON.stringify(preserved) === JSON.stringify(current), '导入旧备份后当前积分记录变化：' + JSON.stringify({ before: current, after: preserved }));

      /* 导入新备份应整体替换积分记录（数量一致）。 */
      const roundTrip = await cdp.evaluate('window.Arcade.Progress.importText(' + JSON.stringify(exported) + ')');
      assert(roundTrip && roundTrip.ok === true, '导入新备份失败：' + JSON.stringify(roundTrip));
      assert(roundTrip.scoreCount === 2, '导入新备份 scoreCount=' + JSON.stringify(roundTrip.scoreCount) + '，期望 2');
      const afterRoundTrip = await readScores(cdp);
      assert(JSON.stringify(afterRoundTrip) === JSON.stringify(current), '导入新备份后积分记录不一致：' + JSON.stringify(afterRoundTrip));
      return { backupScores: backup.scores.records.length, scoreCount: roundTrip.scoreCount, preserved: preserved.length };
    },
  },
  {
    id: 'ZS-11',
    title: '导入非法 JSON 失败且积分记录不变',
    async run(cdp) {
      await prepareHub(cdp);
      await requireScores(cdp);
      await recordScores(cdp, [
        { gameId: 'block-drop', mode: 'classic', score: 3210, detail: '30 行 · Lv.4', at: '2026-11-13T11:00:00.000Z' },
        { gameId: 'memory-flip', mode: 'classic', score: 120, detail: '6 关', at: '2026-11-13T11:01:00.000Z' },
      ]);
      const before = await readScores(cdp);
      const beforeRaw = await readStorage(cdp, [SCORES_KEY]);
      assert(before.length === 2, '导入前积分记录数=' + before.length + '，期望 2');

      const brokenJson = '{"format":"studiokit-arcade-progress","schemaVersion":1,';
      const brokenResult = await cdp.evaluate('window.Arcade.Progress.importText(' + JSON.stringify(brokenJson) + ')');
      assert(brokenResult && brokenResult.ok === false, '导入非法 JSON 返回 ' + JSON.stringify(brokenResult) + '，期望 ok=false');
      const afterBroken = await readScores(cdp);
      const afterBrokenRaw = await readStorage(cdp, [SCORES_KEY]);
      assert(JSON.stringify(afterBroken) === JSON.stringify(before), '非法 JSON 导入后积分记录变化：' + JSON.stringify({ before, after: afterBroken }));
      assert(afterBrokenRaw[SCORES_KEY] === beforeRaw[SCORES_KEY], '非法 JSON 导入改写了 scores:v1 原始值');

      const notBackup = JSON.stringify({ hello: 'world' });
      const notBackupResult = await cdp.evaluate('window.Arcade.Progress.importText(' + JSON.stringify(notBackup) + ')');
      assert(notBackupResult && notBackupResult.ok === false, '导入非备份 JSON 返回 ' + JSON.stringify(notBackupResult) + '，期望 ok=false');
      const afterNotBackup = await readScores(cdp);
      assert(JSON.stringify(afterNotBackup) === JSON.stringify(before), '非备份 JSON 导入后积分记录变化：' + JSON.stringify(afterNotBackup));
      return { records: before.length, brokenOk: brokenResult.ok, notBackupOk: notBackupResult.ok };
    },
  },
  {
    id: 'ZS-12',
    title: 'Progress.resetGame 只清该游戏积分；resetAll 清空全部积分',
    async run(cdp) {
      await prepareHub(cdp);
      await requireScores(cdp);
      await injectStorage(cdp, {
        [LEGACY_KEYS.progress]: JSON.stringify({
          schemaVersion: 1,
          games: {
            'block-drop': { high: 900, plays: 2, lastAt: '2026-11-03T08:00:00.000Z', lastScore: 700 },
            'snake-run': { high: 50, plays: 1, lastAt: '2026-11-03T08:00:00.000Z', lastScore: 50 },
          },
        }),
      });
      await recordScores(cdp, [
        { gameId: 'block-drop', mode: 'classic', score: 700, at: '2026-11-13T09:00:00.000Z' },
        { gameId: 'block-drop', mode: 'zen', score: 300, at: '2026-11-13T09:01:00.000Z' },
        { gameId: 'snake-run', mode: 'classic', score: 50, at: '2026-11-13T09:02:00.000Z' },
      ]);
      await cdp.evaluate("window.Arcade.Progress.resetGame('block-drop')");
      const afterGame = await cdp.evaluate(`(() => ({
        blockScores: window.Arcade.Scores.list({ gameId: 'block-drop' }),
        snakeScores: window.Arcade.Scores.list({ gameId: 'snake-run' }),
        total: window.Arcade.Scores.list().length,
        blockProgress: window.Arcade.Progress.get('block-drop'),
        snakeProgress: window.Arcade.Progress.get('snake-run')
      }))()`);
      assert(afterGame.blockScores.length === 0, 'resetGame 后 block-drop 积分记录数=' + afterGame.blockScores.length + '，期望 0');
      assert(afterGame.snakeScores.length === 1, 'resetGame 误清其它游戏积分：snake-run 记录数=' + afterGame.snakeScores.length + '，期望 1');
      assert(afterGame.total === 1, 'resetGame 后积分总条数=' + afterGame.total + '，期望 1');
      assert(afterGame.blockProgress.high === 0 && afterGame.blockProgress.plays === 0, 'resetGame 未清理 block-drop 进度：' + JSON.stringify(afterGame.blockProgress));
      assert(afterGame.snakeProgress.high === 50 && afterGame.snakeProgress.plays === 1, 'resetGame 误清其它游戏进度：' + JSON.stringify(afterGame.snakeProgress));

      await cdp.evaluate('window.Arcade.Progress.resetAll()');
      const afterAll = await cdp.evaluate(`(() => ({
        scores: window.Arcade.Scores.list(),
        stats: window.Arcade.Scores.stats(),
        progressGames: Object.keys(window.Arcade.Progress.load().games)
      }))()`);
      assert(afterAll.scores.length === 0, 'resetAll 后积分记录数=' + afterAll.scores.length + '，期望 0');
      assert(afterAll.stats && afterAll.stats.total === 0, 'resetAll 后 A.Scores.stats()=' + JSON.stringify(afterAll.stats));
      assert(afterAll.progressGames.length === 0, 'resetAll 后 progress 仍含游戏：' + JSON.stringify(afterAll.progressGames));
      return { remainingAfterResetGame: afterGame.total, remainingAfterResetAll: afterAll.scores.length };
    },
  },
  {
    id: 'ZS-13',
    title: '损坏 scores:v1 fail-closed，旧 progress/runs/playtime/challenge 不被删除或改名',
    async run(cdp) {
      await prepareHub(cdp);
      await requireScores(cdp);
      const corrupted = '{"schemaVersion":1,"records":[{"gameId":"block-drop",';
      const seeded = {
        [LEGACY_KEYS.progress]: JSON.stringify({ schemaVersion: 1, games: { 'block-drop': { high: 777, plays: 5, lastAt: '2026-11-02T08:00:00.000Z', lastScore: 100 } } }),
        [LEGACY_KEYS.runs]: JSON.stringify({ schemaVersion: 1, games: { 'block-drop': { savedAt: '2026-11-02T08:00:00.000Z', score: 12, summary: '12 行', data: { lines: 12 } } } }),
        [LEGACY_KEYS.playtime]: JSON.stringify({
          schemaVersion: 1,
          games: { 'block-drop': { ms: 120000, count: 2, lastAt: '2026-11-02T08:00:00.000Z', days: { '2026-11-02': 120000 }, rounds: [] } },
          updatedAt: '2026-11-02T08:00:00.000Z',
        }),
        [LEGACY_KEYS.challenge]: JSON.stringify({
          schemaVersion: 1,
          games: { 'block-drop': { cleared: ['block-drop-C01'], best: {}, updatedAt: '2026-11-02T08:00:00.000Z' } },
          updatedAt: '2026-11-02T08:00:00.000Z',
        }),
        [SCORES_KEY]: corrupted,
      };
      await injectStorage(cdp, seeded);
      await cdp.navigate(BASE + HALL_PATH);
      const state = await cdp.evaluate(`(() => {
        let list = null;
        let listError = '';
        try { list = window.Arcade.Scores.list(); } catch (err) { listError = String(err); }
        let stats = null;
        try { stats = window.Arcade.Scores.stats(); } catch (err) { stats = null; }
        return {
          list,
          listError,
          stats,
          storage: {
            progress: localStorage.getItem(${JSON.stringify(LEGACY_KEYS.progress)}),
            runs: localStorage.getItem(${JSON.stringify(LEGACY_KEYS.runs)}),
            playtime: localStorage.getItem(${JSON.stringify(LEGACY_KEYS.playtime)}),
            challenge: localStorage.getItem(${JSON.stringify(LEGACY_KEYS.challenge)}),
            scores: localStorage.getItem(${JSON.stringify(SCORES_KEY)})
          },
          progress: window.Arcade.Progress.get('block-drop'),
          runCount: window.Arcade.RunSave.count(),
          playtimeTotalMs: window.Arcade.Playtime.stats().totalMs,
          challengeCleared: window.Arcade.Challenge.progress('block-drop').cleared,
          cards: document.querySelectorAll('.hall-card').length,
          keyNames: Object.keys(localStorage).filter((key) => key.indexOf('studiokit:arcade:') === 0).sort()
        };
      })()`);
      assert(state.listError === '', '读取损坏 scores:v1 抛错：' + state.listError);
      assert(Array.isArray(state.list) && state.list.length === 0, '损坏 scores fail-closed 失败：list=' + JSON.stringify(state.list));
      assert(state.stats && state.stats.total === 0, '损坏 scores 时 stats=' + JSON.stringify(state.stats));
      assert(state.storage.scores === corrupted, '损坏的 scores:v1 被静默删除/覆盖：' + JSON.stringify(state.storage.scores));
      assert(state.storage.progress === seeded[LEGACY_KEYS.progress], 'progress:v1 被改动：' + JSON.stringify(state.storage.progress));
      assert(state.storage.runs === seeded[LEGACY_KEYS.runs], 'runs:v1 被改动：' + JSON.stringify(state.storage.runs));
      assert(state.storage.playtime === seeded[LEGACY_KEYS.playtime], 'playtime:v1 被改动：' + JSON.stringify(state.storage.playtime));
      assert(state.storage.challenge === seeded[LEGACY_KEYS.challenge], 'challenge:v1 被改动：' + JSON.stringify(state.storage.challenge));
      assert(state.progress.high === 777 && state.progress.plays === 5, '损坏 scores 影响 progress 读取：' + JSON.stringify(state.progress));
      assert(state.runCount === 1, 'runs:v1 读取失败：count=' + state.runCount + '，期望 1');
      assert(state.playtimeTotalMs === 120000, 'playtime:v1 读取失败：totalMs=' + state.playtimeTotalMs + '，期望 120000');
      assert(Array.isArray(state.challengeCleared) && state.challengeCleared.length === 1, 'challenge:v1 读取失败：' + JSON.stringify(state.challengeCleared));
      assert(state.cards === 13, '损坏 scores 导致中心页游戏卡片数=' + state.cards + '，期望 13');
      const missingKeys = ALL_KEYS.filter((key) => state.keyNames.indexOf(key) === -1);
      assert(missingKeys.length === 0, '旧 localStorage key 被改名/删除：缺少 ' + missingKeys.join(', ') + '（实际 ' + state.keyNames.join(', ') + '）');
      const dom = await hubSnapshot(cdp);
      assert(dom.rows.length === 0, '损坏 scores 时表格行数=' + dom.rows.length + '，期望 0');
      assert(dom.emptyVisible === true, '损坏 scores 时空状态未显示');
      return { corruptedKept: true, legacyKeys: state.keyNames.length, cards: state.cards, progressHigh: state.progress.high };
    },
  },
  {
    id: 'ZS-14',
    title: '320/375/390/430 中心页无横向溢出 + 积分表格容器可横向滚动',
    async run(cdp) {
      await prepareHub(cdp);
      await requireScores(cdp);
      await recordScores(cdp, [
        { gameId: 'block-drop', mode: 'classic', score: 1234, detail: '40 行 · Lv.5', at: '2026-11-13T14:00:00.000Z' },
        { gameId: 'snake-run', mode: 'classic', score: 321, detail: '20 个果实', at: '2026-11-13T14:01:00.000Z' },
        { gameId: 'memory-flip', mode: 'zen', score: 88, detail: '禅模式 · 12 关', at: '2026-11-13T14:02:00.000Z' },
        { gameId: 'merge-2048', mode: 'classic', score: 2048, detail: '达成 2048', at: '2026-11-13T14:03:00.000Z' },
      ]);
      const widths = [
        [320, 568],
        [375, 667],
        [390, 844],
        [430, 932],
      ];
      const results = [];
      for (const [width, height] of widths) {
        await setViewport(cdp, width, height);
        await cdp.navigate(BASE + HALL_PATH);
        const metrics = await cdp.evaluate(`(() => {
          const wrap = document.querySelector('[data-scores-wrap]');
          const table = document.querySelector('.hall-scores-table');
          return {
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            wrapOverflowX: wrap ? getComputedStyle(wrap).overflowX : null,
            wrapScrollWidth: wrap ? wrap.scrollWidth : null,
            wrapClientWidth: wrap ? wrap.clientWidth : null,
            tableWidth: table ? Math.round(table.getBoundingClientRect().width) : null,
            rows: document.querySelectorAll('[data-scores-body] tr').length,
            headers: table ? table.querySelectorAll('thead th[scope="col"]').length : 0
          };
        })()`);
        assert(metrics.scrollWidth <= metrics.clientWidth + 1, width + 'px 中心页横向溢出：scrollWidth=' + metrics.scrollWidth + ' > clientWidth=' + metrics.clientWidth);
        assert(metrics.wrapOverflowX === 'auto' || metrics.wrapOverflowX === 'scroll', width + 'px 积分表格容器 overflow-x=' + JSON.stringify(metrics.wrapOverflowX) + '，不能横向滚动');
        assert(metrics.wrapScrollWidth > metrics.wrapClientWidth, width + 'px 积分表格容器未产生横向滚动：scrollWidth=' + metrics.wrapScrollWidth + '，clientWidth=' + metrics.wrapClientWidth);
        assert(metrics.rows === 4, width + 'px 积分表格行数=' + metrics.rows + '，期望 4');
        assert(metrics.headers === 5, width + 'px 表头 scope=col 数量=' + metrics.headers + '，期望 5');
        results.push({ width, overflow: metrics.scrollWidth - metrics.clientWidth, wrapScroll: metrics.wrapScrollWidth - metrics.wrapClientWidth, tableWidth: metrics.tableWidth });
        if (width === 320) await safeScreenshot(cdp, 'zen-scores-320.png');
      }
      await setViewport(cdp);
      assert(results.length === 4, '布局检查档位数=' + results.length + '，期望 4');
      return { widths: results.map((item) => item.width + 'px:' + item.wrapScroll + 'px可滚动').join(', ') };
    },
  },
];

/* ----------------------------------------------------------
 * CLI 与主流程
 * ---------------------------------------------------------- */

class UsageError extends Error {}

function parsePort(raw, label) {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UsageError(label + ' 需要 1-65535 的整数端口，当前为 ' + JSON.stringify(raw));
  }
  return port;
}

function parseArgs(argv) {
  const options = { help: false, list: false, port: null, cdpPort: null, scenarioIds: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--list' || arg === '-l') {
      options.list = true;
    } else if (arg === '--port') {
      options.port = parsePort(argv[i + 1], '--port');
      i += 1;
    } else if (arg.startsWith('--port=')) {
      options.port = parsePort(arg.slice('--port='.length), '--port');
    } else if (arg === '--cdp-port') {
      options.cdpPort = parsePort(argv[i + 1], '--cdp-port');
      i += 1;
    } else if (arg.startsWith('--cdp-port=')) {
      options.cdpPort = parsePort(arg.slice('--cdp-port='.length), '--cdp-port');
    } else if (arg === '--scenario') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new UsageError('--scenario 需要一个场景 ID');
      options.scenarioIds.push(value);
      i += 1;
    } else if (arg.startsWith('--scenario=')) {
      const value = arg.slice('--scenario='.length);
      if (!value) throw new UsageError('--scenario= 不能为空');
      options.scenarioIds.push(value);
    } else {
      throw new UsageError('未知参数：' + arg + '（用 --help 查看用法）');
    }
  }
  return options;
}

function resolveEnvPort(primaryName, aliasName, fallback) {
  const primary = process.env[primaryName];
  if (primary !== undefined && primary !== '') return envPort(primaryName, fallback);
  return envPort(aliasName, fallback);
}

function selectScenarios(options) {
  if (!options.scenarioIds.length) return SCENARIOS.slice();
  const byId = new Map(SCENARIOS.map((scenario) => [scenario.id, scenario]));
  const picked = [];
  for (const id of options.scenarioIds) {
    const scenario = byId.get(id);
    if (!scenario) throw new UsageError('未知场景 ID：' + id + '\n可用场景：' + SCENARIOS.map((item) => item.id).join(', '));
    if (picked.indexOf(scenario) === -1) picked.push(scenario);
  }
  return picked;
}

function printUsage() {
  console.log(`用法：node tools/arcade_zen_scores_test.mjs [选项]

  --list                    列出全部场景 ID / 标题（不启动 Chrome）
  --scenario=<id>           只跑指定场景；可重复传入多个
  --port=<n>                本地静态服务器端口（默认 8770）
  --cdp-port=<n>            Chrome DevTools 端口（默认 9338）
  --help                    显示本帮助

端口也可用环境变量覆盖（避免与 smoke/gameplay 冲突）：
  ARCADE_ZEN_SCORES_PORT      静态服务器，默认 8770（兼容 HTTP_PORT）
  ARCADE_ZEN_SCORES_CDP_PORT  CDP 端口，默认 9338（兼容 CDP_PORT）
  CHROME_PATH                 自定义 Chrome 可执行文件路径

覆盖契约 docs/arcade/0.8.1-CONTRACT.md §7 的 10 类场景（拆成 14 个断言项）。`);
}

function printScenarioList() {
  console.log('可用场景（' + SCENARIOS.length + ' 个）：');
  for (const scenario of SCENARIOS) console.log('  ' + scenario.id + '  ' + scenario.title);
  console.log('提示：--scenario=<id> 可只跑指定场景；端口用 --port/--cdp-port 或环境变量覆盖。');
}

function printHeader(selected) {
  console.log('# Arcade 0.8.1 禅模式 + 积分记录测试 · ' + selected.length + ' 个场景');
  console.log('# 静态服务器 http://127.0.0.1:' + SERVER_PORT + ' · CDP 端口 ' + CDP_PORT + ' · 截图 ' + path.relative(REPO_ROOT, ARTIFACTS));
  console.log('# 契约：docs/arcade/0.8.1-CONTRACT.md §3/§4/§5.5/§7');
  console.log('');
}

async function runScenario(cdp, scenario) {
  console.log('# ' + scenario.id + ' ' + scenario.title);
  try {
    const evidence = await scenario.run(cdp);
    if (cdp.errors.length) throw new Error('页面报错：' + cdp.errors.join(' | '));
    record(scenario.id + ' ' + scenario.title, true, formatEvidence(evidence));
  } catch (err) {
    const detail = (err && err.message) || String(err);
    record(scenario.id + ' ' + scenario.title, false, detail);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  SERVER_PORT = options.port !== null ? options.port : resolveEnvPort('ARCADE_ZEN_SCORES_PORT', 'HTTP_PORT', 8770);
  CDP_PORT = options.cdpPort !== null ? options.cdpPort : resolveEnvPort('ARCADE_ZEN_SCORES_CDP_PORT', 'CDP_PORT', 9338);
  BASE = 'http://127.0.0.1:' + SERVER_PORT;
  const selected = selectScenarios(options);
  if (options.list) {
    printScenarioList();
    return;
  }

  fs.mkdirSync(ARTIFACTS, { recursive: true });
  printHeader(selected);

  let server = null;
  let launched = null;
  let cdp = null;
  try {
    server = await startServer({ root: REPO_ROOT, port: SERVER_PORT });
    launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'studiokit-zen-scores-' });
    cdp = await openPage({
      port: CDP_PORT,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: true,
      artifactsDir: ARTIFACTS,
    });
    /* 本 runner 只验证产品行为：绕过 Service Worker / HTTP 缓存，避免读到旧缓存或队友写入中途的混合版本。 */
    try {
      await cdp.send('Network.enable');
      await cdp.send('Network.setBypassServiceWorker', { bypass: true });
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    } catch (err) {
      /* 个别 Chrome 版本不支持该 CDP 方法时忽略（每次启动都是全新 profile，仍不会读到历史缓存）。 */
    }

    for (const scenario of selected) {
      await runScenario(cdp, scenario);
      await sleep(60);
    }
    /* 清理测试产生的本地数据（与 arcade_smoke 行为一致）。 */
    try {
      await cdp.navigate(BASE + HALL_PATH);
      await cdp.evaluate('localStorage.clear()');
    } catch (err) {
      /* 清理失败不影响测试结果 */
    }
  } finally {
    if (cdp) cdp.close();
    if (server) server.close();
    await stopChrome(launched || {});
  }

  const outcome = summary();
  console.log('\nPASS ' + outcome.passed + '/' + outcome.total);
  if (outcome.failed) process.exitCode = 1;
}

main().catch((err) => {
  if (err instanceof UsageError) {
    console.error('用法错误：' + err.message);
    process.exitCode = 2;
    return;
  }
  console.error('ZEN-SCORES TEST FAILED:', err.stack || err);
  process.exitCode = 1;
});
