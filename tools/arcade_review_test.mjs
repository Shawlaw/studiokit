#!/usr/bin/env node
/**
 * Arcade 0.11.0 门禁：结算回看最终游戏画面 + 五子棋棋盘放大。
 *
 * 覆盖：
 * - RV-01 静态：16 款游戏所有结算 ui.show 均携带 result:true，开局/暂停/错误弹层不带；
 *              shared engine 暴露 reviewState，CSS 含 .is-result 规则。
 * - RV-02 运行时（gomoku）：playToEnd 结算后蒙层为 is-result 且无暗色遮罩；
 *              回看按钮/胶囊切换面板可见性；棋盘几何 400×400 / 格距 36 / 棋子 15。
 * - RV-03 运行时（block-drop）：经典 40 行收尾后 is-result + 回看切换；禅模式无回归。
 * - RV-04 布局：gomoku 320/375/390/430 回看胶囊 ≥44px、面板不溢出。
 *
 * 零 npm 依赖，复用 tools/lib/arcade_cdp.mjs；默认端口 8773 / 9341。
 * 运行：node tools/arcade_review_test.mjs [--port=8773] [--cdp-port=9341] [--scenario=RV-02]
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, createRecorder, envPort, launchChrome, openPage, sleep, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const ARTIFACTS = path.join(REPO_ROOT, 'test-artifacts');
const GAME_DIR = path.join(REPO_ROOT, 'apps', 'arcade', 'games');
const GAMES = [
  'blackjack', 'block-drop', 'brick-breaker', 'gold-miner', 'gomoku', 'gravity-flip',
  'memory-flip', 'merge-2048', 'mole-whack', 'pendulum-tower', 'road-rush',
  'shadow-leap', 'snake-run', 'snowbells', 'solitaire', 'star-raid',
];

let SERVER_PORT = 0;
let CDP_PORT = 0;
let BASE = '';
const { record, assert, summary } = createRecorder();

function arg(name, fallback) {
  const hit = process.argv.slice(2).find((item) => item.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const hasFlag = (name) => process.argv.slice(2).some((item) => item === '--' + name || item.startsWith('--' + name + '='));
const shouldRun = (id) => !hasFlag('scenario') || arg('scenario', '') === id;

/* ---------------- RV-01 静态门禁 ---------------- */
const STATIC = {
  id: 'RV-01',
  async run() {
    const engine = fs.readFileSync(path.join(REPO_ROOT, 'apps', 'arcade', 'engine.js'), 'utf8');
    assert(/reviewLabel = typeof o\.result/.test(engine), 'engine: show() 未读取回看按钮文案');
    assert(/classList\.toggle\('is-reviewing'/.test(engine), 'engine: 未根据回看状态切换 is-reviewing');
    assert(/get reviewState\(\)/.test(engine), 'engine: 缺少 reviewState getter');
    assert(/data-ov-review-fab/.test(engine), 'engine: 缺少回看胶囊控件');
    const css = fs.readFileSync(path.join(REPO_ROOT, 'apps', 'arcade', 'arcade.css'), 'utf8');
    assert(/\.overlay\.is-result\.is-reviewing\s*\{[\s\S]*?background:\s*transparent/.test(css), 'CSS: 仅回看模式应移除暗色背景');
    assert(!/\.overlay\.is-result\s*\{[\s\S]*?background:\s*transparent/.test(css), 'CSS: 默认结算仍应保持模糊蒙层');
    assert(/\.overlay\.is-result \.overlay-panel\.review-hidden/.test(css), 'CSS: 缺少 review-hidden 规则');

    /* 每款游戏的结算标记数量来自 0.10.0 结算弹层逐页审计（共 45 处）；
       用精确数量防止漏标或误标到开局/暂停/错误弹层。 */
    const EXPECTED = {
      blackjack: ['回看牌桌', 1], 'block-drop': ['回看井口', 4], 'brick-breaker': ['回看砖场', 3],
      'gold-miner': ['回看矿场', 3], gomoku: ['回看棋盘', 1], 'gravity-flip': ['回看关卡', 3],
      'memory-flip': ['回看牌面', 3], 'merge-2048': ['回看棋盘', 3], 'mole-whack': ['回看鼹鼠洞', 3],
      'pendulum-tower': ['回看塔身', 3], 'road-rush': ['回看赛道', 3], 'shadow-leap': ['回看影林', 3],
      'snake-run': ['回看果园', 3], snowbells: ['回看雪夜', 3], solitaire: ['回看牌桌', 2],
      'star-raid': ['回看战场', 4],
    };
    let resultCount = 0;
    for (const game of GAMES) {
      const file = path.join(GAME_DIR, game + '.html');
      const src = fs.readFileSync(file, 'utf8');
      const [label, count] = EXPECTED[game];
      const occurrences = (src.match(new RegExp("result: '" + label + "'", 'g')) || []).length;
      assert(occurrences === count, game + ': result:"' + label + '" 数量 ' + occurrences + '，期望 ' + count);
      assert(!/result:\s*true/.test(src), game + ': 仍有未带文案的 result:true');
      resultCount += occurrences;
    }
    assert(resultCount === 45, '结算标记总数 ' + resultCount + '，期望 45');
    record('静态：engine/CSS/16 款结算标记 ' + resultCount + ' 处（按游戏区分文案）', true);
  },
};

/* ---------------- 浏览器通用 helper ---------------- */
async function prepare(cdp, game, tag) {
  await cdp.navigate(BASE + '/apps/arcade/games/' + game + '.html?v=' + encodeURIComponent(tag) + '&t=' + Date.now() + '#test');
  await cdp.waitFor('document.readyState === "complete" && !!window.__arcadeTest', { timeout: 8000 });
}

function reviewSnapshot() {
  return `(() => {
    const overlay = document.querySelector('[data-overlay]');
    const panel = overlay && overlay.querySelector('.overlay-panel');
    const fab = overlay && overlay.querySelector('[data-ov-review-fab]');
    const btn = overlay && overlay.querySelector('[data-ov-review]');
    const cs = overlay ? getComputedStyle(overlay) : null;
    return {
      hidden: overlay ? overlay.hidden : null,
      isResult: overlay ? overlay.classList.contains('is-result') : false,
      background: cs ? cs.backgroundColor : null,
      backdrop: cs ? (cs.backdropFilter || cs.webkitBackdropFilter) : null,
      panelHidden: panel ? panel.classList.contains('review-hidden') : null,
      fabHidden: fab ? fab.hidden : null,
      fabText: fab ? fab.textContent.trim() : null,
      btnText: btn ? btn.textContent.trim() : null,
      engineState: window.Arcade && window.Arcade.createOverlayUi ? null : null,
    };
  })()`;
}

/* ---------------- RV-02 gomoku ---------------- */
const RV_GOMOKU = {
  id: 'RV-02',
  async run(cdp) {
    await prepare(cdp, 'gomoku', 'review-gomoku');
    const geom = await cdp.evaluate('window.__arcadeTest.info().boardGeometry');
    assert(geom && geom.w === 400 && geom.h === 400 && geom.grid === 36 && geom.stoneR === 15, '五子棋棋盘几何异常：' + JSON.stringify(geom));
    record('五子棋棋盘放大 400×400 / 格距 36 / 棋子 15', true);

    const ended = await cdp.evaluate(`(async () => {
      const t = window.__arcadeTest;
      const out = t.playToEnd(6);
      return { out, info: t.info() };
    })()`);
    assert(ended.out && ended.out.ok === true, 'gomoku playToEnd 未成功结束：' + JSON.stringify(ended.out));
    assert(ended.info.state === 'over' && ended.info.result, 'gomoku 结算状态异常：' + JSON.stringify({ state: ended.info.state, result: ended.info.result }));
    const snap = await cdp.evaluate(reviewSnapshot());
    assert(snap.hidden === false && snap.isResult === true, '结算蒙层未进入 is-result：' + JSON.stringify(snap));
    assert(!/transparent|rgba\(0, 0, 0, 0\)/.test(snap.background), '结算默认背景不应透明：' + snap.background);
    assert(/blur/.test(String(snap.backdrop || '')), '结算默认应保留高级模糊蒙层：' + snap.backdrop);
    assert(snap.btnText === '回看棋盘' && snap.fabHidden === true, '回看按钮初始状态异常：' + JSON.stringify(snap));

    await cdp.click('[data-ov-review]');
    let after = await cdp.evaluate(reviewSnapshot());
    assert(after.panelHidden === true && after.fabHidden === false && after.fabText === '查看结算', '点击回看棋盘后状态异常：' + JSON.stringify(after));
    assert(after.background === 'rgba(0, 0, 0, 0)' || after.background === 'transparent', '回看模式背景应透明：' + after.background);
    assert(!/blur/.test(String(after.backdrop || '')), '回看模式应去掉模糊：' + after.backdrop);

    await cdp.click('[data-ov-review-fab]');
    after = await cdp.evaluate(reviewSnapshot());
    assert(after.panelHidden === false && after.fabHidden === true && after.btnText === '回看棋盘', '点击胶囊恢复结算失败：' + JSON.stringify(after));
    assert(/blur/.test(String(after.backdrop || '')), '恢复结算后应回到模糊蒙层：' + after.backdrop);

    const info = await cdp.evaluate('window.__arcadeTest.info()');
    /* 胶囊只在回看模式（面板隐藏）可见；此时面板已恢复，应为 false。 */
    assert(info.resultReview && info.resultReview.isResult === true && info.resultReview.reviewVisible === true && info.resultReview.fabVisible === false, 'reviewState 钩子异常：' + JSON.stringify(info.resultReview));
    assert(cdp.errors.length === 0, 'gomoku console error: ' + cdp.errors.slice(0, 3).join(' | '));
    record('gomoku 结算回看切换（面板/胶囊/引擎状态）', true);
  },
};

/* ---------------- RV-03 block-drop ---------------- */
const RV_BLOCK = {
  id: 'RV-03',
  async run(cdp) {
    await prepare(cdp, 'block-drop', 'review-block');
    const finished = await cdp.evaluate(`(() => {
      const t = window.__arcadeTest;
      t.startGame ? t.startGame() : null;
      const out = t.lineClearScenario ? t.lineClearScenario(39) : t.topOutScenario ? t.topOutScenario() : null;
      return { out, info: t.joyInfo ? t.joyInfo() : t.info() };
    })()`);
    await cdp.waitFor('window.__arcadeTest.joyInfo().state === "over"', { timeout: 5000 });
    const finalInfo = await cdp.evaluate('window.__arcadeTest.joyInfo()');
    assert(finalInfo && finalInfo.state === 'over', 'block 未进入结算：' + JSON.stringify(finalInfo));
    const snap = await cdp.evaluate(reviewSnapshot());
    assert(snap.isResult === true && /blur/.test(String(snap.backdrop || '')), 'block 结算默认应保留模糊蒙层：' + JSON.stringify(snap));
    assert(snap.btnText === '回看井口', 'block 回看按钮文案异常：' + snap.btnText);
    await cdp.click('[data-ov-review]');
    const after = await cdp.evaluate(reviewSnapshot());
    assert(after.panelHidden === true && after.fabHidden === false, 'block 回看切换失败：' + JSON.stringify(after));
    assert(cdp.errors.length === 0, 'block console error: ' + cdp.errors.slice(0, 3).join(' | '));
    record('block-drop 结算回看切换', true);
  },
};

/* ---------------- RV-04 布局 ---------------- */
const RV_LAYOUT = {
  id: 'RV-04',
  async run(cdp) {
    await prepare(cdp, 'gomoku', 'review-layout');
    await cdp.evaluate('window.__arcadeTest.playToEnd(6)');
    for (const [w, h] of [[320, 568], [375, 667], [390, 844], [430, 932]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
      await sleep(120);
      const m = await cdp.evaluate(`(() => {
        const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top), bottom: Math.round(b.bottom), right: Math.round(b.right) }; };
        const panel = document.querySelector('.overlay.is-result .overlay-panel');
        const btn = document.querySelector('[data-ov-review]');
        const fab = document.querySelector('[data-ov-review-fab]');
        return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, panel: r(panel), btn: r(btn), fab: r(fab) };
      })()`);
      assert(m.sw <= m.cw + 1, w + 'px 回看模式横向溢出');
      assert(m.btn && m.btn.w >= 44 && m.btn.h >= 44, w + 'px 回看按钮过小：' + JSON.stringify(m.btn));
      assert(m.panel && m.panel.bottom <= h + 1 && m.panel.right <= w + 1, w + 'px 结算面板越界：' + JSON.stringify(m.panel));
      /* 胶囊隐藏时 fab 为 null；点击回看后必须 >=44px。 */
      await cdp.click('[data-ov-review]');
      const fab = await cdp.evaluate(`(() => { const b = document.querySelector('[data-ov-review-fab]'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()`);
      assert(fab && fab.w >= 44 && fab.h >= 44, w + 'px 回看胶囊过小：' + JSON.stringify(fab));
      await cdp.click('[data-ov-review-fab]');
    }
    assert(cdp.errors.length === 0, 'layout console error: ' + cdp.errors.slice(0, 3).join(' | '));
    record('gomoku 回看布局 320/375/390/430 无溢出、按钮 ≥44px', true);
  },
};

const SCENARIOS = [STATIC, RV_GOMOKU, RV_BLOCK, RV_LAYOUT];

let server, chrome, cdp;
try {
  if (SCENARIOS.some((s) => shouldRun(s.id) && s.id !== 'RV-01')) {
    SERVER_PORT = envPort('ARCADE_REVIEW_PORT', Number(arg('port', '8773')));
    CDP_PORT = envPort('ARCADE_REVIEW_CDP_PORT', Number(arg('cdp-port', '9341')));
    BASE = 'http://127.0.0.1:' + SERVER_PORT;
    server = await startServer({ port: SERVER_PORT });
    const launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'studiokit-arcade-review-' });
    chrome = launched.chrome;
    cdp = await openPage({ port: CDP_PORT, artifactsDir: ARTIFACTS });
  }
  for (const scenario of SCENARIOS) {
    if (!shouldRun(scenario.id)) continue;
    await scenario.run(cdp);
  }
  const result = summary('Arcade 0.12.7 结算回看门禁');
  process.exitCode = result.failed ? 1 : 0;
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
} finally {
  if (cdp) cdp.close();
  if (chrome) await stopChrome({ chrome });
  if (server) server.close();
}
