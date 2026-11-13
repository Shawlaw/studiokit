#!/usr/bin/env node
/**
 * 影跃 0.9 挑战模式确定性场景模块（自动被 tools/arcade_gameplay_test.mjs 发现）。
 *
 * 协议：`export default { gameId, gameFile, scenarios: [{ id, title, setup?, run }] }`
 * 场景 ID：CH-SL-001..008；证据等级见每个场景的 `evidence` 字段与
 * docs/arcade/0.9/impl/shadow-leap.md。
 *
 * 参考通关证据（real-input-replay）：
 *   测试侧注入 window.__slAutoRun（页面内读取 #test 观察钩子 → 向 window 派发真实
 *   KeyboardEvent keydown/keyup / Shift，经 engine createInput 的真实输入管线驱动角色）。
 *   不使用传送到目标位置的通关捷径；only 失败重试/记录类场景使用 force* 钩子。
 */
const GAME_URL = '/apps/arcade/games/shadow-leap.html';
const STAGE_IDS = [
  'shadow-leap-C01',
  'shadow-leap-C02',
  'shadow-leap-C03',
  'shadow-leap-C04',
  'shadow-leap-C05',
  'shadow-leap-C06',
];
const STAGE_TITLES = ['初入影林', '月下断桥', '影冲试炼', '风之回廊', '双影岔路', '月门守卫'];

/** 页面内自动操作器：读取 #test 观察数据，用真实 KeyboardEvent 驱动一关到影门。 */
const AUTOPILOT_SOURCE = [
  'window.__slAutoRun = function (opts) {',
  '  opts = opts || {};',
  '  return new Promise(function (resolve) {',
  '    var t = window.__arcadeTest;',
  '    var st = { key: null, done: false, log: [] };',
  '    var route = t.stageObservable().mainRoute;',
  '    var step = 1;',
  '    var seen = 0;',
  '    var dashes = 0;',
  '    var start = performance.now();',
  '    function press(name) {',
  '      if (st.key === name) return;',
  '      if (st.key) window.dispatchEvent(new KeyboardEvent("keyup", { key: st.key, bubbles: true }));',
  '      st.key = name;',
  '      if (name) window.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));',
  '    }',
  '    function finish(result) {',
  '      if (st.done) return;',
  '      st.done = true;',
  '      press(null);',
  '      clearInterval(iv);',
  '      clearTimeout(to);',
  '      resolve(result);',
  '    }',
  '    var iv = setInterval(function () {',
  '      if (st.done) return;',
  '      var info = t.challengeInfo();',
  '      if (!info || info.state !== "playing") {',
  '        finish({ ok: !!(info && info.state === "cleared"), state: info && info.state, elapsed: info && info.elapsedSec, landings: seen, step: step, dashes: dashes, log: st.log });',
  '        return;',
  '      }',
  '      var obs = t.stageObservable();',
  '      if (obs.landings.length !== seen) {',
  '        seen = obs.landings.length;',
  '        var id = obs.lastLandedId;',
  '        if (route[step] === id) step += 1;',
  '        else {',
  '          for (var k = step; k < route.length; k += 1) { if (route[k] === id) { step = k + 1; break; } }',
  '        }',
  '        st.log.push({ t: Math.round(performance.now() - start), land: id, step: step });',
  '      }',
  '      if (step >= route.length) {',
  '        var g = obs.goal;',
  '        var gx = obs.player.x + obs.player.w / 2;',
  '        var gdx = g.cx - gx;',
  '        press(Math.abs(gdx) > 6 ? (gdx > 0 ? "ArrowRight" : "ArrowLeft") : null);',
  '        return;',
  '      }',
  '      var targetId = route[step];',
  '      var target = null;',
  '      for (var i = 0; i < obs.platforms.length; i += 1) { if (obs.platforms[i].id === targetId) { target = obs.platforms[i]; break; } }',
  '      if (!target) { finish({ ok: false, reason: "no-target:" + targetId, step: step, seen: seen }); return; }',
  '      var px = obs.player.x + obs.player.w / 2;',
  '      var tx = target.x + target.w / 2;',
  '      var dx = tx - px;',
  '      var dead = opts.dead === undefined ? 6 : opts.dead;',
  '      var dir = dx > dead ? "ArrowRight" : dx < -dead ? "ArrowLeft" : null;',
  '      press(dir);',
  '      if (opts.dash !== false) {',
  '        var gap = Math.abs(dx) - target.w / 2;',
  '        var di = t.dashInfo();',
  '        if (di.dashCharges > 0 && di.dashing === false && gap > (opts.dashGap === undefined ? 120 : opts.dashGap) && obs.player.vy < 120) {',
  '          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));',
  '          dashes += 1;',
  '          st.log.push({ t: Math.round(performance.now() - start), dash: Math.round(dx) });',
  '        }',
  '      }',
  '    }, 12);',
  '    var to = setTimeout(function () { finish({ ok: false, reason: "timeout", step: step, seen: seen, dashes: dashes, log: st.log }); }, opts.timeout || 25000);',
  '  });',
  '};',
  '"installed"',
].join('\n');

const ROUND1 = (value) => Math.round(value * 10) / 10;

function freshPageUrl(base, tag) {
  return base + GAME_URL + '?ch-sl=' + encodeURIComponent(String(tag)) + '#test';
}

function neutralPageUrl(base, tag) {
  return base + GAME_URL + '?ch-sl-neutral=' + encodeURIComponent(String(tag));
}

function legacyClassicSave() {
  return {
    schemaVersion: 1,
    games: {
      'shadow-leap': {
        savedAt: new Date().toISOString(),
        score: 5,
        summary: '高度 5m · 最高 9m',
        data: {
          player: { x: 200, y: 400, vx: 0, vy: 0, face: 1 },
          platforms: [
            { x: 40, y: 680, w: 340, kind: 'normal', baseX: 40, range: 0, speed: 0, broken: false, breakTimer: 0, phase: 0 },
            { x: 140, y: 500, w: 100, kind: 'normal', baseX: 140, range: 0, speed: 0, broken: false, breakTimer: 0, phase: 0 },
          ],
          camY: 0,
          topY: 400,
          startY: 400,
          score: 5,
          generatedCount: 1,
          tools: { feather: 1, boost: 2 },
        },
      },
    },
  };
}

function legacyTrialSave() {
  return {
    schemaVersion: 1,
    games: {
      'shadow-leap': {
        savedAt: new Date().toISOString(),
        score: 12.3,
        summary: '试炼 S2 月下断桥 · 00:12 · 卷轴 0/1',
        data: {
          mode: 'trial',
          stageIndex: 1,
          trialElapsed: 12.3,
          trialScrolls: [],
          trialResults: [],
          trialDashes: 0,
          player: { x: 197, y: 2000, vx: 0, vy: 0, face: 1 },
          platforms: [
            { x: 140, y: 2030, w: 140, kind: 'normal', baseX: 140, range: 0, speed: 0, broken: false, breakTimer: 0, phase: 0 },
          ],
          camY: 1160,
          topY: 2000,
          startY: 2000,
          score: 0,
          generatedCount: 0,
          tools: { feather: 2, boost: 2 },
          featherTimer: 0,
          boostArmed: false,
          dashCharges: 1,
          dashTimer: 0,
          dashDir: 1,
        },
      },
    },
  };
}

async function waitPlaying(cdp, ctx) {
  await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
  ctx.assert(true, 'challenge playing');
}

async function startStage(cdp, ctx, stageId) {
  const started = await cdp.evaluate('window.__arcadeTest.startChallenge(' + JSON.stringify(stageId) + ')');
  ctx.assert(started === true, 'startChallenge(' + stageId + ') 返回 ' + started);
  await waitPlaying(cdp, ctx);
  const info = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
  ctx.assert(info.stageId === stageId, '进入关卡 ' + info.stageId + ' ≠ ' + stageId);
  return info;
}

async function installAutopilot(cdp) {
  await cdp.evaluate(AUTOPILOT_SOURCE);
}

async function runAutopilot(cdp, options) {
  return cdp.evaluate('window.__slAutoRun(' + JSON.stringify(options || {}) + ')');
}

async function writeRunsSave(cdp, base, tag, payload) {
  /* 先到非游玩态页面，避免当前页面的自动存档把夹具覆盖掉。 */
  await cdp.navigate(neutralPageUrl(base, tag));
  await cdp.evaluate('localStorage.clear()');
  await cdp.evaluate('localStorage.setItem("studiokit:arcade:runs:v1", ' + JSON.stringify(JSON.stringify(payload)) + ')');
  await cdp.navigate(freshPageUrl(base, tag + '-load'));
}

/** 清空本机存档并回到带 #test 的全新页面（避免运行中自动存档写回造成续玩弹层）。 */
async function resetStorage(cdp, base, tag) {
  await cdp.navigate(neutralPageUrl(base, tag));
  await cdp.evaluate('localStorage.clear()');
  await cdp.navigate(freshPageUrl(base, tag));
}

export default {
  gameId: 'shadow-leap',
  gameFile: 'shadow-leap.html',
  evidence: 'real-input-replay',
  scenarios: [
    /* ===================================================================== */
    {
      id: 'CH-SL-001',
      title: '影跃·0.9 六关数据/选关面板/解锁与记录写入',
      evidence: 'ui-only',
      async run(cdp, ctx) {
        const { assert } = ctx;
        const stages = await cdp.evaluate('window.__arcadeTest.challengeStages()');
        assert(Array.isArray(stages) && stages.length === 6, 'challengeStages() 应为 6 项，实际 ' + (stages && stages.length));
        assert(stages.map((s) => s.id).join(',') === STAGE_IDS.join(','), '关卡 id 顺序错误：' + stages.map((s) => s.id).join(','));
        assert(stages.map((s) => s.title).join(',') === STAGE_TITLES.join(','), '关卡标题错误：' + stages.map((s) => s.title).join(','));
        assert(stages.every((s) => s.platforms >= 6), '每关平台数应 ≥6：' + JSON.stringify(stages.map((s) => s.platforms)));
        assert(stages.every((s) => s.goalStatement && s.goalStatement.length > 0), '每关 goalStatement 不应为空');
        assert(stages[0].unlocked === true, 'C01 应恒解锁');
        assert(stages.slice(1).every((s) => s.unlocked === false), 'C02–C06 初始应锁定：' + JSON.stringify(stages.map((s) => [s.id, s.unlocked])));
        assert(stages.slice(2).every((s) => s.requiredAbility === 'dash'), 'C03+ requiredAbility 应为 dash：' + JSON.stringify(stages.map((s) => [s.id, s.requiredAbility])));

        /* 开始弹层：主按钮保持经典文案，挑战入口只在第二按钮；选关面板初始隐藏。 */
        const entry = await cdp.evaluate(`(() => {
          const btn = document.querySelector('[data-ov-btn]');
          const btn2 = document.querySelector('[data-ov-btn2]');
          const panel = document.querySelector('[data-ch-panel]');
          return {
            btn: btn ? btn.textContent.trim() : null,
            btnDisabled: btn ? btn.disabled : null,
            btn2: btn2 ? btn2.textContent.trim() : null,
            btn2Hidden: btn2 ? btn2.hidden : null,
            panelHidden: panel ? panel.hidden : null,
            otherChallengeEntries: [...document.querySelectorAll('[data-ov-btn], [data-ov-btn2]')].filter((b) => /挑战/.test(b.textContent) && b.hasAttribute('data-ov-btn')).length
          };
        })()`);
        assert(entry.btn === '开始游戏' && entry.btnDisabled === false, '经典主按钮文案/状态错误：' + JSON.stringify(entry));
        assert(entry.btn2 && entry.btn2.indexOf('挑战 6 关') !== -1 && entry.btn2Hidden === false, '第二入口应为可见的「挑战 6 关」：' + JSON.stringify(entry));
        assert(entry.panelHidden === true, '选关面板初始应隐藏');
        assert(entry.otherChallengeEntries === 0, '挑战入口不应占用经典主按钮');

        /* 打开选关面板：6 个 .ac-stage-btn，锁定态 disabled + is-locked。 */
        await cdp.click('[data-ov-btn2]');
        await cdp.waitFor("document.querySelector('[data-ch-panel]').hidden === false", { timeout: 4000 });
        const panel = await cdp.evaluate(`(() => {
          const host = document.querySelector('[data-ch-panel]');
          const btns = [...host.querySelectorAll('.ac-stage-btn')];
          return {
            count: btns.length,
            names: btns.map((b) => (b.querySelector('.ac-stage-name') || {}).textContent || ''),
            metas: btns.map((b) => (b.querySelector('.ac-stage-meta') || {}).textContent || ''),
            disabled: btns.map((b) => !!b.disabled),
            locked: btns.map((b) => b.classList.contains('is-locked')),
            ids: btns.map((b) => b.getAttribute('data-stage-id')),
            head: (host.querySelector('.ac-challenge-head') || {}).textContent || '',
            back: !!host.querySelector('[data-ch-back]')
          };
        })()`);
        assert(panel.count === 6, '选关面板应有 6 个 .ac-stage-btn，实际 ' + panel.count);
        assert(panel.ids.join(',') === STAGE_IDS.join(','), '选关按钮 data-stage-id 错误：' + panel.ids.join(','));
        assert(panel.disabled[0] === false && panel.disabled.slice(1).every(Boolean), '初始只有 C01 可点：' + JSON.stringify(panel.disabled));
        assert(panel.locked[0] === false && panel.locked.slice(1).every(Boolean), 'C02–C06 应带 is-locked');
        assert(panel.names.every((name, i) => name.indexOf('C0' + (i + 1)) === 0 && name.indexOf(STAGE_TITLES[i]) !== -1), '按钮标题错误：' + JSON.stringify(panel.names));
        assert(panel.metas[0].indexOf('未通关') !== -1, 'C01 初始 meta 应为未通关：' + panel.metas[0]);
        assert(panel.back === true, '选关面板缺少返回按钮');
        assert(panel.head.indexOf('/6') !== -1 || panel.head.indexOf('0/6') !== -1, '选关头部通关节数错误：' + panel.head);

        /* 点 C01 进入关卡；HUD/objective 可观察。 */
        await cdp.click('[data-ch-panel] [data-stage-id="shadow-leap-C01"]');
        await waitPlaying(cdp, ctx);
        const info = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        assert(info.mode === 'challenge' && info.stageId === 'shadow-leap-C01' && info.stageIndex === 0, '进入 C01 状态错误：' + JSON.stringify({ mode: info.mode, stageId: info.stageId }));
        assert(info.objective && info.objective.length > 0, 'challengeInfo().objective 为空');
        assert(info.collectiblesTotal === 1, 'C01 卷轴数应为 1：' + info.collectiblesTotal);

        /* 记录/解锁：完成 C01 后 C02 解锁，记录写入 challenge:v1。 */
        const cleared = await cdp.evaluate('window.__arcadeTest.forceStageClear()');
        assert(cleared === true, 'forceStageClear() 返回 ' + cleared);
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "cleared"', { timeout: 4000 });
        const after = await cdp.evaluate(`({
          stages: __arcadeTest.challengeStages(),
          record: JSON.parse(localStorage.getItem('studiokit:arcade:challenge:v1') || 'null')
        })`);
        assert(after.stages[1].unlocked === true, 'C01 通关后 C02 应解锁：' + JSON.stringify(after.stages[1]));
        const game = after.record && after.record.games ? after.record.games['shadow-leap'] : null;
        assert(game && game.cleared.indexOf('shadow-leap-C01') !== -1, 'challenge:v1 未写入 C01 通关：' + JSON.stringify(after.record));
        assert(game.best['shadow-leap-C01'] && typeof game.best['shadow-leap-C01'].timeSec === 'number', 'challenge:v1 缺少最佳用时');
        assert(after.record.schemaVersion === 1, 'challenge:v1 schemaVersion 应为 1');

        /* 返回选关：C01 显示 ✅ 最佳。 */
        await cdp.evaluate('window.__arcadeTest.exitChallenge()');
        await cdp.waitFor("document.querySelector('[data-ch-panel]').hidden === false", { timeout: 4000 });
        const bestMeta = await cdp.evaluate(`document.querySelector('[data-ch-panel] [data-stage-id="shadow-leap-C01"] .ac-stage-meta').textContent`);
        const clearedClass = await cdp.evaluate(`document.querySelector('[data-ch-panel] [data-stage-id="shadow-leap-C01"]').classList.contains('is-cleared')`);
        assert(/✅/.test(bestMeta) && /最佳/.test(bestMeta), 'C01 面板未显示 ✅ 最佳：' + bestMeta);
        assert(clearedClass === true, 'C01 按钮缺少 is-cleared');

        return { stages: stages.length, c01: 'unlocked', c02InitiallyLocked: true, c02AfterClear: 'unlocked', record: 'challenge:v1', bestMeta };
      },
    },

    /* ===================================================================== */
    {
      id: 'CH-SL-002',
      title: '影跃·C01 真实输入参考通关（起点→影门）与结算/记录',
      evidence: 'real-input-replay',
      async run(cdp, ctx) {
        const { assert } = ctx;
        await cdp.click('[data-ov-btn2]');
        await cdp.waitFor("document.querySelector('[data-ch-panel]').hidden === false", { timeout: 4000 });
        await cdp.click('[data-ch-panel] [data-stage-id="shadow-leap-C01"]');
        await waitPlaying(cdp, ctx);
        await installAutopilot(cdp);
        const result = await runAutopilot(cdp, { timeout: 20000 });
        assert(result.ok === true && result.state === 'cleared', 'C01 真实输入参考通关失败：' + JSON.stringify(result));
        const cleared = await cdp.evaluate(`({
          info: __arcadeTest.challengeInfo(),
          title: document.querySelector('[data-ov-title]').textContent,
          text: document.querySelector('[data-ov-text]').textContent,
          btn: document.querySelector('[data-ov-btn]').textContent,
          btn2: document.querySelector('[data-ov-btn2]').textContent,
          overlay: !document.querySelector('[data-overlay]').hidden,
          record: JSON.parse(localStorage.getItem('studiokit:arcade:challenge:v1') || 'null')
        })`);
        assert(cleared.overlay === true && cleared.title.indexOf('影门开启') !== -1, 'C01 结算弹层标题错误：' + JSON.stringify({ title: cleared.title, overlay: cleared.overlay }));
        assert(cleared.info.state === 'cleared' && cleared.info.stageId === 'shadow-leap-C01' && cleared.info.cleared === true, 'C01 通关状态错误：' + JSON.stringify({ state: cleared.info.state, stageId: cleared.info.stageId }));
        assert(cleared.info.elapsedSec >= 1, 'C01 通关用时异常：' + cleared.info.elapsedSec);
        assert(cleared.btn.indexOf('下一关') !== -1, 'C01 结算主按钮应为「下一关」：' + cleared.btn);
        assert(cleared.btn2.indexOf('重玩本关') !== -1, 'C01 结算副按钮应为「重玩本关」：' + cleared.btn2);
        assert(cleared.text.indexOf('用时') !== -1 && cleared.text.indexOf('收集物') !== -1, '结算未显示用时/收集物：' + cleared.text);
        const best = cleared.record.games['shadow-leap'].best['shadow-leap-C01'];
        assert(best && best.timeSec > 0 && best.assisted === false, 'C01 记录错误：' + JSON.stringify(best));
        assert(Array.isArray(best.collectibles) && best.collectibles.length === 0, 'C01 未收集卷轴时 collectibles 应为空：' + JSON.stringify(best.collectibles));
        return {
          evidence: 'real-input-replay',
          elapsed: ROUND1(cleared.info.elapsedSec),
          landings: result.landings,
          dashes: result.dashes,
          recordTime: best.timeSec,
        };
      },
    },

    /* ===================================================================== */
    {
      id: 'CH-SL-003',
      title: '影跃·挑战失败归因 + 1 次点击重试（含真实失足路径）',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const { assert } = ctx;
        await startStage(cdp, ctx, 'shadow-leap-C01');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().elapsedSec > 0.1', { timeout: 3000 });
        const forced = await cdp.evaluate('window.__arcadeTest.forceStageFail("test-forced")');
        assert(forced === true, 'forceStageFail() 返回 ' + forced);
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "over"', { timeout: 4000 });
        const failed = await cdp.evaluate(`({
          info: __arcadeTest.challengeInfo(),
          title: document.querySelector('[data-ov-title]').textContent,
          text: document.querySelector('[data-ov-text]').textContent,
          btn: document.querySelector('[data-ov-btn]').textContent,
          btn2: document.querySelector('[data-ov-btn2]').textContent,
          overlay: !document.querySelector('[data-overlay]').hidden
        })`);
        assert(failed.overlay === true && failed.title.indexOf('失足') !== -1, '失败弹层标题错误：' + JSON.stringify({ overlay: failed.overlay, title: failed.title }));
        assert(failed.info.stageId === 'shadow-leap-C01', '失败后关卡状态错误：' + failed.info.stageId);
        assert(failed.text.indexOf('落点') !== -1 || failed.text.indexOf('影冲') !== -1, '失败复盘缺少可归因提示：' + failed.text);
        assert(failed.text.indexOf('可选') !== -1 || failed.text.indexOf('不影响') !== -1, '失败复盘未说明卷轴可选：' + failed.text);
        assert(failed.btn.indexOf('重试') !== -1, '失败主按钮应含「重试」：' + failed.btn);
        assert(failed.btn2.indexOf('返回选关') !== -1, '失败副按钮应为「返回选关」：' + failed.btn2);

        /* 1 次点击重试 → 回本关起点、计时重置。 */
        await cdp.click('[data-ov-btn]');
        await waitPlaying(cdp, ctx);
        const retried = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        assert(retried.stageId === 'shadow-leap-C01' && retried.elapsedSec < 1, '重试后未回本关起点/计时未重置：' + JSON.stringify({ stageId: retried.stageId, elapsed: retried.elapsedSec }));
        assert(retried.failed === false && retried.state === 'playing', '重试后状态应回到 playing：' + retried.state);

        /* 真实失足路径：forceFall() 走 update() 的坠落判定，同样 1 次点击重试。 */
        await cdp.evaluate('window.__arcadeTest.forceFall()');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "over"', { timeout: 5000 });
        const realFailTitle = await cdp.text('[data-ov-title]');
        assert(realFailTitle.indexOf('失足') !== -1, '真实失足弹层标题错误：' + realFailTitle);
        await cdp.click('[data-ov-btn]');
        await waitPlaying(cdp, ctx);
        const retried2 = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        assert(retried2.state === 'playing' && retried2.elapsedSec < 1, '真实失足后 1 次点击重试失败：' + JSON.stringify(retried2));

        return { forcedFailTitle: failed.title, retryClicks: 1, realFall: 'ok', elapsedReset: ROUND1(retried2.elapsedSec) };
      },
    },

    /* ===================================================================== */
    {
      id: 'CH-SL-004',
      title: '影跃·挑战暂停/刷新恢复 + 旧经典档仍经典 + 旧 trial 档降级提示',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const { assert, base } = ctx;
        /* 1) 挑战 C02 暂停 → 刷新 → 续玩，恢复 mode/stageId/位置/计时。 */
        await startStage(cdp, ctx, 'shadow-leap-C02');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().elapsedSec > 0.2', { timeout: 3000 });
        await cdp.click('[data-pause]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "paused"', { timeout: 4000 });
        const paused = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        assert(paused.mode === 'challenge' && paused.stageId === 'shadow-leap-C02', '暂停时挑战状态错误：' + JSON.stringify({ mode: paused.mode, stageId: paused.stageId }));

        await cdp.navigate(freshPageUrl(base, 'CH-SL-004-resume'));
        const resumeTitle = await cdp.text('[data-ov-title]');
        assert(resumeTitle && resumeTitle.indexOf('继续') !== -1, '挑战局刷新后未显示续玩提示：' + resumeTitle);
        await cdp.click('[data-ov-btn]');
        await waitPlaying(cdp, ctx);
        const resumed = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        assert(resumed.mode === 'challenge' && resumed.stageId === 'shadow-leap-C02', '刷新恢复后挑战状态错误：' + JSON.stringify({ mode: resumed.mode, stageId: resumed.stageId }));
        assert(Math.abs(resumed.elapsedSec - paused.elapsedSec) < 1.5, '刷新恢复后计时误差过大：' + JSON.stringify({ paused: paused.elapsedSec, resumed: resumed.elapsedSec }));
        assert(Math.abs(resumed.player.x - paused.player.x) < 3 && Math.abs(resumed.player.y - paused.player.y) < 6, '刷新恢复后玩家位置错误：' + JSON.stringify({ paused: paused.player, resumed: resumed.player }));
        await cdp.evaluate('window.__arcadeTest.exitChallenge()');

        /* 2) 旧经典档（无 mode 字段）仍按经典恢复。 */
        await writeRunsSave(cdp, base, 'CH-SL-004-legacy-classic', legacyClassicSave());
        const oldTitle = await cdp.text('[data-ov-title]');
        assert(oldTitle && oldTitle.indexOf('继续') !== -1, '旧经典档刷新后未显示续玩提示：' + oldTitle);
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.joyInfo().state === "playing"', { timeout: 6000 });
        const legacy = await cdp.evaluate('window.__arcadeTest.trialInfo()');
        assert(legacy.mode === 'classic' && legacy.stageId === null, '旧经典档缺 mode 未按经典恢复：' + JSON.stringify({ mode: legacy.mode, stageId: legacy.stageId }));

        /* 3) 旧 0.8 mode:'trial' 存档：提示升级 + 映射 C02，且不删挑战记录。 */
        await cdp.navigate(neutralPageUrl(base, 'CH-SL-004-legacy-trial'));
        await cdp.evaluate('localStorage.clear()');
        await cdp.evaluate(`Arcade.Challenge.markCleared('shadow-leap', 'shadow-leap-C01', { timeSec: 5, assisted: false, collectibles: [] })`);
        const recordBefore = await cdp.evaluate("localStorage.getItem('studiokit:arcade:challenge:v1')");
        await cdp.evaluate('localStorage.setItem("studiokit:arcade:runs:v1", ' + JSON.stringify(JSON.stringify(legacyTrialSave())) + ')');
        await cdp.navigate(freshPageUrl(base, 'CH-SL-004-legacy-trial-load'));
        const legacyPrompt = await cdp.evaluate(`({
          title: document.querySelector('[data-ov-title]').textContent,
          text: document.querySelector('[data-ov-text]').textContent,
          btn: document.querySelector('[data-ov-btn]').textContent,
          btn2: document.querySelector('[data-ov-btn2]').textContent
        })`);
        assert(legacyPrompt.title.indexOf('试炼数据已升级') !== -1, '旧 trial 档未提示升级：' + legacyPrompt.title);
        assert(legacyPrompt.text.indexOf('C02') !== -1, '旧 trial 档未映射 C02：' + legacyPrompt.text);
        assert(legacyPrompt.btn.indexOf('继续 C02') !== -1, '旧 trial 档续玩按钮错误：' + legacyPrompt.btn);
        const recordDuringPrompt = await cdp.evaluate("localStorage.getItem('studiokit:arcade:challenge:v1')");
        assert(recordDuringPrompt === recordBefore, '旧 trial 降级提示静默改动了 challenge:v1');
        await cdp.click('[data-ov-btn]');
        await waitPlaying(cdp, ctx);
        const mapped = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        assert(mapped.stageId === 'shadow-leap-C02' && mapped.state === 'playing', '旧 trial 档未映射到 C02：' + JSON.stringify({ stageId: mapped.stageId, state: mapped.state }));
        const recordAfter = await cdp.evaluate("localStorage.getItem('studiokit:arcade:challenge:v1')");
        assert(recordAfter === recordBefore, '旧 trial 降级续玩后 challenge:v1 被改写');

        return { resumed: resumed.stageId, elapsed: ROUND1(resumed.elapsedSec), legacyClassic: legacy.mode, legacyTrialMapped: mapped.stageId, recordPreserved: true };
      },
    },

    /* ===================================================================== */
    {
      id: 'CH-SL-005',
      title: '影跃·经典入口零回归 + 320/390 布局无横向溢出',
      evidence: 'ui-only',
      async run(cdp, ctx) {
        const { assert, base } = ctx;
        /* 1) 主按钮 = 经典无尽；挑战入口只在第二按钮；选关面板默认隐藏。 */
        const entry = await cdp.evaluate(`(() => {
          const btn = document.querySelector('[data-ov-btn]');
          const btn2 = document.querySelector('[data-ov-btn2]');
          return {
            btn: btn ? btn.textContent.trim() : null,
            btn2: btn2 ? btn2.textContent.trim() : null,
            btn2Hidden: btn2 ? btn2.hidden : null,
            overlay: !document.querySelector('[data-overlay]').hidden,
            panelHidden: document.querySelector('[data-ch-panel]').hidden
          };
        })()`);
        assert(entry.overlay === true && entry.btn === '开始游戏', '开始弹层/主按钮错误：' + JSON.stringify(entry));
        assert(entry.btn2 && entry.btn2.indexOf('挑战 6 关') !== -1, '挑战入口文案错误：' + entry.btn2);
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('document.querySelector("[data-overlay]").hidden === true', { timeout: 6000 });
        const classic = await cdp.evaluate(`({
          joy: __arcadeTest.joyInfo(),
          mode: __arcadeTest.trialInfo().mode,
          stageId: __arcadeTest.trialInfo().stageId,
          panelHidden: document.querySelector('[data-ch-panel]').hidden,
          joyTools: document.querySelectorAll('[data-joy-tool]').length,
          dash: (() => { const b = document.querySelector('[data-air-dash]'); const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()
        })`);
        assert(classic.joy.state === 'playing' && classic.mode === 'classic' && classic.stageId === null, '主按钮未进入经典无尽：' + JSON.stringify(classic));
        assert(classic.panelHidden === true && classic.joyTools === 2, '经典态不应显示挑战面板/道具按钮数量应为 2：' + JSON.stringify(classic));
        assert(classic.dash.w >= 44 && classic.dash.h >= 44, '影冲按钮小于 44px：' + JSON.stringify(classic.dash));
        await cdp.click('[data-pause]');
        await cdp.waitFor('window.__arcadeTest.joyInfo().state === "paused"', { timeout: 4000 });
        const pauseBtn2Hidden = await cdp.evaluate(`document.querySelector('[data-ov-btn2]').hidden`);
        assert(pauseBtn2Hidden === true, '经典暂停弹层不应出现挑战退出按钮');
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.joyInfo().state === "playing"', { timeout: 4000 });

        /* 2) 320×568：选关面板 6 按钮无横向溢出、触控目标 ≥44px。 */
        const layout = async (width, height, tag) => {
          await resetStorage(cdp, base, tag);
          await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
          await cdp.navigate(freshPageUrl(base, tag + '-layout'));
          await cdp.click('[data-ov-btn2]');
          await cdp.waitFor("document.querySelector('[data-ch-panel]').hidden === false", { timeout: 4000 });
          const panel = await cdp.evaluate(`(() => {
            const host = document.querySelector('[data-ch-panel]');
            const btns = [...host.querySelectorAll('.ac-stage-btn')];
            const back = host.querySelector('[data-ch-back]');
            const backRect = back ? back.getBoundingClientRect() : null;
            return {
              sw: document.documentElement.scrollWidth,
              cw: document.documentElement.clientWidth,
              btnCount: btns.length,
              minH: Math.min(...btns.map((b) => b.getBoundingClientRect().height)),
              minW: Math.min(...btns.map((b) => b.getBoundingClientRect().width)),
              backH: backRect ? backRect.height : 0,
              panelOverflowX: host.scrollWidth > host.clientWidth + 1,
              nameClipped: btns.some((b) => { const n = b.querySelector('.ac-stage-name'); return n && n.scrollWidth > n.clientWidth + 1; })
            };
          })()`);
          await cdp.screenshot('shadow-leap-' + width + '.png');
          return panel;
        };
        const p320 = await layout(320, 568, 'CH-SL-005-320');
        assert(p320.sw <= p320.cw + 1, '320px 有横向溢出：' + JSON.stringify(p320));
        assert(p320.btnCount === 6 && p320.minH >= 44 && p320.minW >= 44 && p320.backH >= 44, '320px 选关触控目标不足 44px：' + JSON.stringify(p320));
        assert(p320.panelOverflowX === false, '320px 选关面板内部横向溢出');

        /* 3) 390×844：同上 + 进关后画布/影冲按钮/道具按钮尺寸。 */
        const p390 = await layout(390, 844, 'CH-SL-005-390');
        assert(p390.sw <= p390.cw + 1 && p390.btnCount === 6 && p390.minH >= 44, '390px 布局错误：' + JSON.stringify(p390));
        await cdp.click('[data-ch-panel] [data-stage-id="shadow-leap-C01"]');
        await waitPlaying(cdp, ctx);
        const inGame = await cdp.evaluate(`(() => {
          const dash = document.querySelector('[data-air-dash]').getBoundingClientRect();
          const tools = [...document.querySelectorAll('[data-joy-tool]')].map((b) => b.getBoundingClientRect());
          return {
            sw: document.documentElement.scrollWidth,
            cw: document.documentElement.clientWidth,
            dash: { w: Math.round(dash.width), h: Math.round(dash.height) },
            toolCount: tools.length,
            toolsMin: Math.min(...tools.map((r) => Math.min(r.width, r.height))),
            hud: document.querySelector('[data-ch-hud]').textContent
          };
        })()`);
        assert(inGame.sw <= inGame.cw + 1, '390px 挑战中横向溢出：' + JSON.stringify(inGame));
        assert(inGame.dash.w >= 44 && inGame.dash.h >= 44 && inGame.toolCount === 2 && inGame.toolsMin >= 44, '390px 影冲/道具按钮不足 44px：' + JSON.stringify(inGame));
        assert(inGame.hud && /C01/.test(inGame.hud), '挑战 HUD 未显示关卡：' + inGame.hud);
        await cdp.screenshot('shadow-leap-390-ingame.png');
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });

        return { classic: 'ok', p320: { overflow: false, btnH: Math.round(p320.minH) }, p390: { overflow: false, dash: inGame.dash }, joyTools: classic.joyTools };
      },
    },

    /* ===================================================================== */
    {
      id: 'CH-SL-006',
      title: '影跃·C03 影冲必要性（无影冲不可达 p1→p2 / 有影冲可通关）',
      evidence: 'real-input-replay',
      async run(cdp, ctx) {
        const { assert } = ctx;
        await startStage(cdp, ctx, 'shadow-leap-C03');
        await installAutopilot(cdp);

        /* 负向：真实按键但不按影冲，持续 9 秒只能在 p0/p1 往返，无法跨过月蚀裂隙。 */
        const noDash = await runAutopilot(cdp, { dash: false, timeout: 9000 });
        assert(noDash.ok === false, 'C03 无影冲不应通关：' + JSON.stringify(noDash));
        const noDashLandings = noDash.log.filter((item) => item.land).map((item) => item.land);
        assert(noDashLandings.length > 0, 'C03 无影冲尝试没有任何着陆记录：' + JSON.stringify(noDash));
        assert(noDashLandings.every((id) => id === 'p0' || id === 'p1'), 'C03 无影冲越过了裂隙平台：' + JSON.stringify(noDashLandings));
        const noDashState = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        assert(noDashState.stageId === 'shadow-leap-C03', 'C03 无影冲尝试后关卡状态异常：' + JSON.stringify({ stageId: noDashState.stageId }));
        assert(noDashState.cleared === false, 'C03 无影冲不应写入通关');
        /* 无影冲尝试可能因始终够不到 p2 而失足；两种情况都不影响“不可达”结论。 */
        const noDashOutcome = noDashState.state;
        if (noDashState.state === 'over') {
          await cdp.click('[data-ov-btn]');
          await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 5000 });
        }

        /* 正向：同一起点，一次空中影冲即清关。 */
        await cdp.evaluate('window.__arcadeTest.exitChallenge()');
        await cdp.waitFor("document.querySelector('[data-ch-panel]').hidden === false", { timeout: 4000 });
        await startStage(cdp, ctx, 'shadow-leap-C03');
        const withDash = await runAutopilot(cdp, { timeout: 20000 });
        assert(withDash.ok === true && withDash.state === 'cleared', 'C03 有影冲真实输入通关失败：' + JSON.stringify(withDash));
        assert(withDash.dashes >= 1, 'C03 参考通关未使用影冲：' + withDash.dashes);
        const cleared = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        assert(cleared.cleared === true && cleared.stageId === 'shadow-leap-C03', 'C03 清关状态错误：' + JSON.stringify({ cleared: cleared.cleared }));
        const record = await cdp.evaluate("JSON.parse(localStorage.getItem('studiokit:arcade:challenge:v1') || 'null')");
        assert(record && record.games['shadow-leap'].cleared.indexOf('shadow-leap-C03') !== -1, 'C03 通关记录未写入');

        return {
          noDashLandings: noDashLandings.slice(0, 8),
          noDashOutcome,
          noDashCleared: false,
          withDash: 'cleared',
          dashes: withDash.dashes,
          elapsed: ROUND1(withDash.elapsed),
          p2SkippedNote: '参考通关在 p1 起跳后一次影冲直接落到 p3（影冲期间重力 25% 提升跳跃高度）；p1→p2 仅作负向不可达证据',
        };
      },
    },

    /* ===================================================================== */
    {
      id: 'CH-SL-007',
      title: '影跃·双路线/卷轴可选/assisted 标记与结算展示',
      evidence: 'ui-only',
      async run(cdp, ctx) {
        const { assert } = ctx;
        /* 1) C01：拿到卷轴 + 走备选路线 → 结算显示收集物与路线，记录写入 collectibles/route。 */
        await startStage(cdp, ctx, 'shadow-leap-C01');
        await cdp.evaluate('window.__arcadeTest.forceCollectScroll(0)');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().collectibles.length === 1', { timeout: 4000 });
        const collected = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        assert(collected.collectibles.length === 1 && collected.collectibles[0] === 'scroll', 'C01 卷轴收集记录错误：' + JSON.stringify(collected.collectibles));
        const routeForced = await cdp.evaluate('window.__arcadeTest.forceRoute("alt")');
        assert(routeForced === true, 'forceRoute("alt") 返回 ' + routeForced);
        const routeInfo = await cdp.evaluate('window.__arcadeTest.routeInfo()');
        assert(routeInfo.route === 'alt' && routeInfo.routeLabel === '备选路线', '备选路线判定错误：' + JSON.stringify(routeInfo));
        await cdp.evaluate('window.__arcadeTest.forceReachGoal()');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "cleared"', { timeout: 4000 });
        const clearText = await cdp.evaluate(`({ text: document.querySelector('[data-ov-text]').textContent })`);
        assert(clearText.text.indexOf('收集物') !== -1 && clearText.text.indexOf('scroll') !== -1, '结算未展示收集物：' + clearText.text);
        assert(clearText.text.indexOf('备选路线') !== -1, '结算未展示路线：' + clearText.text);
        const record1 = await cdp.evaluate("JSON.parse(localStorage.getItem('studiokit:arcade:challenge:v1') || 'null')");
        const best = record1.games['shadow-leap'].best['shadow-leap-C01'];
        assert(best.collectibles.indexOf('scroll') !== -1, 'C01 记录未保存卷轴：' + JSON.stringify(best));

        /* 2) C02：使用月弹 → assisted=true，结算显示「辅助」。 */
        await startStage(cdp, ctx, 'shadow-leap-C02');
        const used = await cdp.evaluate('window.__arcadeTest.useJoyTool("boost")');
        assert(used === true, '挑战中使用月弹失败');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().assisted === true', { timeout: 3000 });
        const clearC02 = await cdp.evaluate('window.__arcadeTest.forceStageClear()');
        assert(clearC02 === true, 'forceStageClear() 返回 ' + clearC02);
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "cleared"', { timeout: 4000 });
        const assisted = await cdp.evaluate(`({
          text: document.querySelector('[data-ov-text]').textContent,
          info: __arcadeTest.challengeInfo(),
          record: JSON.parse(localStorage.getItem('studiokit:arcade:challenge:v1') || 'null')
        })`);
        assert(assisted.info.assisted === true && assisted.text.indexOf('辅助') !== -1, 'assisted 未显示：' + JSON.stringify({ assisted: assisted.info.assisted, text: assisted.text }));
        assert(assisted.record.games['shadow-leap'].best['shadow-leap-C02'].assisted === true, 'assisted 未写入记录');

        return { collectibles: ['scroll'], route: '备选路线', assisted: true, recordKeys: Object.keys(assisted.record.games['shadow-leap'].best) };
      },
    },

    /* ===================================================================== */
    {
      id: 'CH-SL-008',
      title: '影跃·六关真实输入连续参考通关与解锁链',
      evidence: 'real-input-replay',
      async run(cdp, ctx) {
        const { assert } = ctx;
        await cdp.click('[data-ov-btn2]');
        await cdp.waitFor("document.querySelector('[data-ch-panel]').hidden === false", { timeout: 4000 });
        await cdp.click('[data-ch-panel] [data-stage-id="shadow-leap-C01"]');
        await waitPlaying(cdp, ctx);
        await installAutopilot(cdp);
        const results = [];
        for (let index = 0; index < STAGE_IDS.length; index += 1) {
          const result = await runAutopilot(cdp, { timeout: 25000 });
          assert(result.ok === true && result.state === 'cleared', STAGE_IDS[index] + ' 真实输入参考通关失败：' + JSON.stringify(result));
          const info = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
          assert(info.stageId === STAGE_IDS[index] && info.cleared === true, STAGE_IDS[index] + ' 清关状态错误：' + JSON.stringify({ stageId: info.stageId, cleared: info.cleared }));
          results.push({ stage: STAGE_IDS[index], elapsed: ROUND1(info.elapsedSec), landings: result.landings, dashes: result.dashes });
          if (index < STAGE_IDS.length - 1) {
            await cdp.click('[data-ov-btn]');
            await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
            const next = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
            assert(next.stageId === STAGE_IDS[index + 1], '「下一关」进入 ' + next.stageId + ' ≠ ' + STAGE_IDS[index + 1]);
          }
        }
        const finalOverlay = await cdp.evaluate(`({
          title: document.querySelector('[data-ov-title]').textContent,
          btn: document.querySelector('[data-ov-btn]').textContent,
          btn2: document.querySelector('[data-ov-btn2]').textContent,
          info: __arcadeTest.challengeInfo()
        })`);
        assert(finalOverlay.title.indexOf('影门开启') !== -1 && finalOverlay.btn.indexOf('返回选关') !== -1, 'C06 结算按钮应为「返回选关」：' + JSON.stringify(finalOverlay));
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor("document.querySelector('[data-ch-panel]').hidden === false", { timeout: 4000 });
        const panel = await cdp.evaluate(`(() => {
          const host = document.querySelector('[data-ch-panel]');
          return {
            head: (host.querySelector('.ac-challenge-head') || {}).textContent || '',
            cleared: host.querySelectorAll('.ac-stage-btn.is-cleared').length,
            disabled: [...host.querySelectorAll('.ac-stage-btn')].filter((b) => b.disabled).length,
            stages: __arcadeTest.challengeStages()
          };
        })()`);
        assert(panel.cleared === 6 && panel.disabled === 0, '六关通关后选关面板状态错误：' + JSON.stringify({ cleared: panel.cleared, disabled: panel.disabled }));
        assert(panel.head.indexOf('6/6') !== -1, '选关头部未显示 6/6：' + panel.head);
        assert(panel.stages.every((s) => s.cleared === true && s.unlocked === true), 'challengeStages 未全部 cleared/unlocked');
        const record = await cdp.evaluate("JSON.parse(localStorage.getItem('studiokit:arcade:challenge:v1') || 'null')");
        assert(record.games['shadow-leap'].cleared.length === 6, 'challenge:v1 未记录六关通关：' + JSON.stringify(record.games['shadow-leap'].cleared));
        for (const stage of STAGE_IDS) {
          const best = record.games['shadow-leap'].best[stage];
          assert(best && best.timeSec > 0, stage + ' 缺少最佳用时记录');
        }
        return { stages: results, panelCleared: panel.cleared, bestTimes: STAGE_IDS.map((id) => record.games['shadow-leap'].best[id].timeSec) };
      },
    },
  ],
};
