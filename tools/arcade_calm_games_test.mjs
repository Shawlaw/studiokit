#!/usr/bin/env node
/**
 * Arcade 0.21.1 门禁：三款平和棋牌小游戏 + 挑战公平性修复回归。
 *
 * 覆盖：
 * - CG-01 中心页 16 款、棋牌分类、离线预载总数
 * - CG-02 三款棋牌通用接入契约（开始/暂停/存档/刷新续玩 + 320/375/390/430）
 * - CG-03 二十一点：规则自检 + 一局 6 手结算与积分记录 + 再来一局回开始
 * - CG-04 五子棋：规则自检 + 种子复现 + 悔棋 + 胜利结算
 * - CG-05 纸牌接龙：规则自检 + 发牌唯一 + 注入近胜局判胜 + 撤销
 * - CG-06 挑战修复回归：记忆翻牌 peek、2048 继续挑战记分、砖块拖拽不发球、
 *   极速车道近距奖励、影跃重试累计时间、层塔下落中刷新、矿工最后一钩宽限
 *
 * 零 npm 依赖：复用 tools/lib/arcade_cdp.mjs；端口默认 8771 / 9339。
 * 运行：node tools/arcade_calm_games_test.mjs [--list] [--scenario=CG-03] [--port=8771] [--cdp-port=9339]
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, createRecorder, envPort, launchChrome, openPage, sleep, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const ARTIFACTS = path.join(REPO_ROOT, 'test-artifacts');
const CALM_GAMES = [
  { id: 'blackjack', file: 'blackjack.html', tools: { swap: 1, peek: 2 } },
  { id: 'gomoku', file: 'gomoku.html', tools: { undo: 3, hint: 2 } },
  { id: 'solitaire', file: 'solitaire.html', tools: { undo: 10, hint: 3 } },
];
const VIEWPORT = { width: 420, height: 900 };
const INSTALL_HINT = '16 款';

let SERVER_PORT = 0;
let CDP_PORT = 0;
let BASE = '';

const { record, assert, summary } = createRecorder();

function arg(name, fallback) {
  const prefix = '--' + name + '=';
  const hit = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const hasFlag = (name) => process.argv.slice(2).indexOf('--' + name) !== -1;

async function setViewport(cdp, width = VIEWPORT.width, height = VIEWPORT.height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
}

async function clearStorage(cdp) {
  await cdp.navigate(BASE + '/apps/arcade/');
  await cdp.evaluate('localStorage.clear()');
}

async function prepareGame(cdp, file, tag) {
  await setViewport(cdp);
  await clearStorage(cdp);
  await cdp.navigate(BASE + '/apps/arcade/games/' + file + '?cg=' + encodeURIComponent(tag) + '#test');
  const ready = await cdp.evaluate(`({ arcade: !!window.Arcade, hooks: !!(window.__arcadeTest && typeof window.__arcadeTest.selftest === 'function'), overlay: !!document.querySelector('[data-overlay]'), hash: location.hash })`);
  assert(ready.arcade, file + '：Arcade 运行时未加载');
  assert(ready.hooks, file + '：缺少 __arcadeTest.selftest() 钩子');
  assert(ready.overlay && ready.hash === '#test', file + '：开始弹层或 #test 缺失');
}

/* ---------------- CG-01 中心页 ---------------- */
const CG_HUB = {
  id: 'CG-01',
  title: '中心页 16 款 + 棋牌分类 + 离线预载总数',
  async run(cdp) {
    await setViewport(cdp);
    await clearStorage(cdp);
    await cdp.navigate(BASE + '/apps/arcade/');
    const hall = await cdp.evaluate(`(() => {
      const games = Arcade.GAMES.map((g) => ({ id: g.id, name: g.name, category: g.category, file: g.file, difficulty: g.difficulty }));
      const chips = [...document.querySelectorAll('.hall-chip')].map((c) => c.dataset.category);
      const cards = document.querySelectorAll('.hall-card').length;
      return { version: Arcade.version, games, chips, cards, offlineTotal: Arcade.Offline && Arcade.Offline.status ? null : null };
    })()`);
    assert(hall.version === '0.21.1', '版本=' + hall.version + '，期望 0.21.1');
    assert(hall.games.length === 16 && hall.cards === 16, '游戏数=' + hall.games.length + '，卡片=' + hall.cards + '，期望 16');
    assert(hall.chips.indexOf('棋牌') !== -1, '缺少「棋牌」分类 chip：' + JSON.stringify(hall.chips));
    for (const game of CALM_GAMES) {
      const found = hall.games.find((item) => item.id === game.id);
      assert(found && found.category === '棋牌' && found.difficulty === 1 + (game.id === 'blackjack' ? 0 : 1), game.id + ' 注册信息异常：' + JSON.stringify(found));
      assert(fs.existsSync(path.join(REPO_ROOT, 'apps/arcade/games', game.file)), game.id + ' 游戏文件缺失');
    }
    /* 棋牌筛选：点「棋牌」后应恰好 3 张卡。 */
    await cdp.evaluate(`(() => { const chip = [...document.querySelectorAll('.hall-chip')].find((c) => c.dataset.category === '棋牌'); if (chip) chip.click(); })()`);
    await sleep(150);
    const filtered = await cdp.evaluate(`document.querySelectorAll('.hall-card').length`);
    assert(filtered === 3, '棋牌筛选卡片数=' + filtered + '，期望 3');
    /* 离线预载清单必须覆盖 16 款游戏页，且三款棋牌都在清单内。 */
    const offline = await cdp.evaluate(`(() => {
      const urls = Arcade.Offline && typeof Arcade.Offline.preloadUrls === 'function' ? Arcade.Offline.preloadUrls() : [];
      return { urls, hasOffline: !!Arcade.Offline, gamesTotal: Arcade.GAMES.length };
    })()`);
    assert(offline.hasOffline, 'Arcade.Offline 未导出');
    assert(offline.gamesTotal === 16, '离线预载游戏总数=' + offline.gamesTotal);
    const gameUrls = offline.urls.filter((url) => /\/games\/[^/]+\.html$/.test(url));
    assert(gameUrls.length === 16, '离线预载清单游戏页数=' + gameUrls.length + '，期望 16');
    for (const game of CALM_GAMES) {
      assert(gameUrls.some((url) => url.endsWith('/games/' + game.file)), '离线预载清单缺少 ' + game.file);
    }
    record('中心页 16 款 / 棋牌分类 3 款 / 预载清单 16 游戏页', true);
  },
};

/* ---------------- CG-02 通用接入契约 ---------------- */
const CG_CONTRACT = {
  id: 'CG-02',
  title: '三款棋牌：开始/暂停/存档/刷新续玩 + 320–430 布局',
  async run(cdp) {
    for (const game of CALM_GAMES) {
      await prepareGame(cdp, game.file, 'contract-' + game.id);
      const initial = await cdp.evaluate(`(() => {
        const btn = document.querySelector('[data-ov-btn]');
        return { btn: btn ? btn.textContent.trim() : null, title: document.querySelector('[data-ov-title]').textContent };
      })()`);
      assert(initial.btn === '开始游戏', game.id + ' 主按钮=' + JSON.stringify(initial.btn) + '，期望「开始游戏」');
      await cdp.click('[data-ov-btn]');
      await sleep(420);
      const playing = await cdp.evaluate(`({ hidden: document.querySelector('[data-overlay]').hidden, pauseDisabled: document.querySelector('[data-pause]').disabled, joy: window.__arcadeTest.joyInfo ? window.__arcadeTest.joyInfo() : null })`);
      assert(playing.hidden && playing.pauseDisabled === false, game.id + ' 未进入游玩态：' + JSON.stringify(playing));
      assert(playing.joy && playing.joy.state === 'playing', game.id + ' joyInfo.state=' + JSON.stringify(playing.joy && playing.joy.state));
      assert(JSON.stringify(playing.joy.tools) === JSON.stringify(game.tools), game.id + ' 初始道具=' + JSON.stringify(playing.joy.tools) + '，期望 ' + JSON.stringify(game.tools));
      await cdp.click('[data-pause]');
      await sleep(200);
      const paused = await cdp.evaluate(`({ title: document.querySelector('[data-ov-title]').textContent, run: (() => { const raw = localStorage.getItem('studiokit:arcade:runs:v1'); if (!raw) return null; const data = JSON.parse(raw); return data.games && data.games[${JSON.stringify(game.id)}] ? data.games[${JSON.stringify(game.id)}].summary : null; })() })`);
      assert(/已暂停/.test(paused.title) && paused.run, game.id + ' 暂停或存档异常：' + JSON.stringify(paused));
      /* 刷新续玩（带 query 强制整页重载） */
      await cdp.navigate(BASE + '/apps/arcade/games/' + game.file + '?cg=resume-' + game.id + '&t=' + Date.now() + '#test');
      await sleep(380);
      const resume = await cdp.evaluate(`({ title: document.querySelector('[data-ov-title]').textContent, btn: document.querySelector('[data-ov-btn]').textContent })`);
      assert(/继续上次/.test(resume.title), game.id + ' 未提示继续上次：' + JSON.stringify(resume));
      await cdp.click('[data-ov-btn]');
      await sleep(360);
      assert(await cdp.evaluate(`document.querySelector('[data-overlay]').hidden`), game.id + ' 续玩后弹层未关闭');
      assert(cdp.errors.length === 0, game.id + ' console error: ' + cdp.errors.slice(0, 3).join(' | '));
      /* 四档竖屏布局 + 道具按钮尺寸 */
      await cdp.click('[data-pause]');
      await sleep(150);
      for (const [w, h] of [[320, 568], [375, 667], [390, 844], [430, 932]]) {
        await setViewport(cdp, w, h);
        await sleep(140);
        const m = await cdp.evaluate(`(() => {
          const rect = (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), right: Math.round(r.right) }; };
          const canvas = document.querySelector('.game-canvas');
          const cb = canvas ? Math.round(canvas.getBoundingClientRect().bottom) : null;
          return {
            sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
            docH: document.documentElement.scrollHeight, vh: innerHeight,
            canvas: rect(canvas), joy: [...document.querySelectorAll('[data-joy-tool]')].map(rect), canvasBottom: cb,
          };
        })()`);
        assert(m.sw <= m.cw + 1, game.id + ' @' + w + ' 横向溢出');
        assert(m.docH <= m.vh + 1, game.id + ' @' + w + ' 纵向溢出 ' + m.docH + '>' + m.vh);
        assert(m.canvas && m.canvas.w >= 150 && m.canvas.h >= 240, game.id + ' @' + w + ' 画布过小 ' + JSON.stringify(m.canvas));
        assert(m.joy.length === 2 && m.joy.every((b) => b.w >= 44 && b.h >= 44 && b.right <= m.cw + 1), game.id + ' @' + w + ' 道具按钮不合规 ' + JSON.stringify(m.joy));
        assert(m.joy.every((b) => b.top >= m.canvasBottom - 1), game.id + ' @' + w + ' 道具按钮压住画布');
      }
      await setViewport(cdp);
      record(game.id + ' 接入契约（开始/暂停/存档/续玩/四档布局）', true);
    }
  },
};

/* ---------------- CG-03/04/05 规则自检 ---------------- */
function selftestScenario(game, minPass) {
  return {
    id: 'CG-' + (game.id === 'blackjack' ? '03' : game.id === 'gomoku' ? '04' : '05'),
    title: game.id + ' 规则自检 + 结算记录',
    async run(cdp) {
      await prepareGame(cdp, game.file, 'rules-' + game.id);
      const result = await cdp.evaluate(`(async () => {
        const t = window.__arcadeTest;
        const out = t.selftest ? t.selftest() : { pass: 0, fail: 1, details: ['no selftest'] };
        return out;
      })()`);
      assert(result && result.fail === 0, game.id + ' selftest 失败 ' + JSON.stringify((result && result.details || []).slice(0, 4)));
      assert(result && result.pass >= minPass, game.id + ' selftest 断言数 ' + (result && result.pass) + ' < ' + minPass);
      /* 结算：通过测试钩子跑完一局并检查 Progress 与积分记录。 */
      const settle = await cdp.evaluate(`(async () => {
        const t = window.__arcadeTest;
        if (typeof t.playToEnd !== 'function') return { skipped: true };
        const done = t.playToEnd();
        if (done && typeof done.then === 'function') await done;
        const progress = Arcade.Progress.get(${JSON.stringify(game.id)});
        const scores = Arcade.Scores.list();
        const mine = scores.filter((row) => row.gameId === ${JSON.stringify(game.id)});
        const overlay = document.querySelector('[data-overlay]');
        return {
          skipped: false,
          plays: progress.plays,
          high: progress.high,
          scores: mine.length,
          mode: mine[0] && mine[0].mode,
          overlayVisible: overlay ? !overlay.hidden : false,
          title: (document.querySelector('[data-ov-title]') || {}).textContent || '',
          btn: (document.querySelector('[data-ov-btn]') || {}).textContent || '',
        };
      })()`);
      if (!settle.skipped) {
        assert(settle.plays === 1, game.id + ' 结算后 plays=' + settle.plays + '，期望 1');
        assert(settle.scores === 1 && settle.mode === 'classic', game.id + ' 积分记录异常：' + JSON.stringify(settle));
        assert(settle.overlayVisible && /再来一局/.test(settle.btn), game.id + ' 结算弹层异常：' + JSON.stringify(settle));
        /* 再来一局必须回开始弹层（不得直接重开）。 */
        await cdp.click('[data-ov-btn]');
        await sleep(260);
        const replay = await cdp.evaluate(`({ overlay: !document.querySelector('[data-overlay]').hidden, btn: document.querySelector('[data-ov-btn]').textContent.trim(), run: !!localStorage.getItem('studiokit:arcade:runs:v1') })`);
        assert(replay.overlay && replay.btn === '开始游戏', game.id + ' 再来一局未回到开始弹层：' + JSON.stringify(replay));
      }
      record(game.id + ' 规则自检 ' + result.pass + ' 条' + (settle.skipped ? '（未提供 playToEnd，结算未覆盖：视为失败）' : ' + 结算记录'), true);
      assert(!settle.skipped, game.id + ' 缺少 playToEnd() 结算钩子，无法验证结算与记录');
    },
  };
}

/* ---------------- CG-06 挑战公平性修复回归 ---------------- */
const FIXED_GAME_FILES = [
  'memory-flip.html',
  'merge-2048.html',
  'block-drop.html',
  'snowbells.html',
  'brick-breaker.html',
  'pendulum-tower.html',
  'gold-miner.html',
  'star-raid.html',
  'road-rush.html',
  'shadow-leap.html',
];
const CG_REGRESSIONS = {
  id: 'CG-06',
  title: '挑战公平性修复回归（10 款游戏 regression()）',
  async run(cdp) {
    for (const file of FIXED_GAME_FILES) {
      const gameId = file.replace(/\.html$/, '');
      await setViewport(cdp);
      await clearStorage(cdp);
      await cdp.navigate(BASE + '/apps/arcade/games/' + file + '?cg=fix-' + gameId + '#test');
      await sleep(320);
      const result = await cdp.evaluate(`(() => {
        const t = window.__arcadeTest;
        if (!t || typeof t.regression !== 'function') return { missing: true };
        try {
          return t.regression();
        } catch (err) {
          return { missing: false, pass: 0, fail: 1, details: ['regression 抛错：' + String(err && err.message ? err.message : err)] };
        }
      })()`);
      assert(!result.missing, gameId + ' 缺少 __arcadeTest.regression()（修复必须自带确定性回归）');
      if (!result.missing) {
        assert(result.fail === 0, gameId + ' regression 失败：' + JSON.stringify((result.details || []).slice(0, 4)));
        assert(result.pass >= 3, gameId + ' regression 断言数 ' + result.pass + ' < 3');
      }
      assert(cdp.errors.length === 0, gameId + ' console error: ' + cdp.errors.slice(0, 3).join(' | '));
      record(gameId + ' regression ' + (result.pass || 0) + ' 条', true);
    }
  },
};

/* ---------------- 场景注册 ---------------- */
const scenarios = [
  CG_HUB,
  CG_CONTRACT,
  selftestScenario(CALM_GAMES[0], 6),
  selftestScenario(CALM_GAMES[1], 8),
  selftestScenario(CALM_GAMES[2], 8),
  CG_REGRESSIONS,
];

async function main() {
  if (hasFlag('list')) {
    scenarios.forEach((item) => console.log(item.id + '  ' + item.title));
    return 0;
  }
  const selected = process.argv.slice(2).filter((item) => item.startsWith('--scenario=')).map((item) => item.slice('--scenario='.length));
  const runList = selected.length ? scenarios.filter((item) => selected.indexOf(item.id) !== -1) : scenarios;
  if (!runList.length) {
    console.error('没有匹配的场景：' + selected.join(', '));
    return 2;
  }
  SERVER_PORT = envPort('ARCADE_CALM_PORT', Number(arg('port', 8771)) || 8771);
  CDP_PORT = envPort('ARCADE_CALM_CDP_PORT', Number(arg('cdp-port', 9339)) || 9339);
  BASE = 'http://127.0.0.1:' + SERVER_PORT;
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  let server = null;
  let launched = null;
  let cdp = null;
  try {
    server = await startServer({ root: REPO_ROOT, port: SERVER_PORT });
    launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'studiokit-calm-' });
    cdp = await openPage({ port: CDP_PORT, ...VIEWPORT, deviceScaleFactor: 1, mobile: true, artifactsDir: ARTIFACTS });
    for (const scenario of runList) {
      const before = cdp.errors.length;
      try {
        await scenario.run(cdp);
      } catch (err) {
        record('场景 ' + scenario.id + ' 异常：' + (err && err.message ? err.message : err), false);
      }
      if (cdp.errors.length > before) {
        record('场景 ' + scenario.id + ' 期间出现 console error：' + cdp.errors.slice(before, before + 3).join(' | '), false);
      }
    }
    const result = summary();
    return result.failed ? 1 : 0;
  } finally {
    if (cdp) {
      try {
        cdp.close();
      } catch (err) {
        /* ignore */
      }
    }
    if (launched) await stopChrome(launched);
    if (server) await server.close();
  }
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('FAIL  ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
