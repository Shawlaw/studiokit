/**
 * 0.9 挑战模式确定性场景：记忆翻牌（memory-flip）。
 * 协议见 docs/arcade/0.9/INTEGRATION-CONTRACT.md §6 / docs/arcade/0.9/TESTING.md。
 * 证据等级：
 * - C01 参考通关为 real-input-replay（按参考配对表真实指针点击像素坐标）；
 * - 其它为 engine-replay（使用 #test 钩子驱动状态机与真实 DOM 点击）。
 */

const GAME_ID = 'memory-flip';

async function waitGame(cdp, expression, timeout = 6000) {
  await cdp.waitFor(expression, { timeout, interval: 40 });
}

/** 选关面板：真实点击开始弹层第二入口，断言 6 关/锁定，再点 C01 进入。 */
async function openPanelAndEnterC01(cdp) {
  await cdp.click('[data-ov-btn2]');
  await waitGame(cdp, '!document.querySelector("[data-ch-layer]").hidden');
  const panel = await cdp.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.ac-stage-btn')];
    return {
      count: buttons.length,
      locked: buttons.filter((b) => b.disabled).length,
      cleared: buttons.filter((b) => b.classList.contains('is-cleared')).length,
      firstText: buttons[0] ? buttons[0].textContent.trim() : '',
      panelHidden: (() => { const p = document.querySelector('.ac-challenge-panel'); return p ? p.hidden : null; })(),
    };
  })()`);
  return panel;
}

async function skipPreview(cdp) {
  await new Promise((resolve) => setTimeout(resolve, 950));
  await cdp.tap(210, 400);
  await cdp.waitFor('window.__arcadeTest.stageObservable().previewTimer === 0', { timeout: 4000 });
}

function moduleScenario(id, title, run, evidence) {
  return { id, title, run, evidence };
}

export default {
  gameId: GAME_ID,
  gameFile: 'memory-flip.html',
  evidence: 'engine-replay',
  scenarios: [
    moduleScenario(
      'CH-MF-001',
      '挑战数据/选关面板/锁定与真实进入 C01',
      async (cdp, ctx) => {
        const stages = await cdp.evaluate('window.__arcadeTest.challengeStages()');
        ctx.assert(Array.isArray(stages) && stages.length === 6, '6 关数据缺失：' + JSON.stringify(stages));
        ctx.assert(stages[0].unlocked === true && stages[5].unlocked === false, '解锁状态错误：' + JSON.stringify(stages.map((s) => [s.id, s.unlocked])));
        ctx.assert(stages.every((stage) => /^memory-flip-C0[1-6]$/.test(stage.id)), '关卡 ID 异常：' + JSON.stringify(stages.map((s) => s.id)));
        const panel = await openPanelAndEnterC01(cdp);
        ctx.assert(panel.count === 6, '选关按钮数 ' + panel.count + ' ≠ 6');
        ctx.assert(panel.locked === 5, '锁定关数 ' + panel.locked + ' ≠ 5');
        ctx.assert(panel.cleared === 0, '初始已通关数 ' + panel.cleared + ' ≠ 0');
        ctx.assert(panel.panelHidden === false, '选关面板未显示');
        ctx.assert(/C01/.test(panel.firstText), 'C01 按钮文案异常：' + panel.firstText);
        await cdp.click('[data-stage-id="memory-flip-C01"]');
        await waitGame(cdp, 'window.__arcadeTest.challengeInfo().state === "playing"');
        const info = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        ctx.assert(info.mode === 'challenge' && info.stageId === 'memory-flip-C01', '进入 C01 状态错误：' + JSON.stringify(info));
        ctx.assert(info.pairsTotal === 3 && info.maxMismatches === 4, 'C01 目标/限错错误：' + JSON.stringify(info));
        const hud = await cdp.evaluate(`(() => {
          const hud = document.querySelector('[data-ch-hud]');
          const gameHud = document.querySelector('.game-hud');
          return { hudHidden: hud.hidden, hudText: hud.textContent, gameHudHidden: gameHud.hidden };
        })()`);
        ctx.assert(hud.hudHidden === false && /C01/.test(hud.hudText) && hud.gameHudHidden === true, '挑战 HUD 未按合同切换：' + JSON.stringify(hud));
        return { stages: stages.length, panelButtons: panel.count, locked: panel.locked, entered: info.stageId };
      },
      'engine-replay'
    ),
    moduleScenario(
      'CH-MF-002',
      'C01 参考配对表真实点击通关（real-input-replay）',
      async (cdp, ctx) => {
        ctx.assert(await cdp.evaluate('window.__arcadeTest.startChallenge(1)') === true, 'startChallenge(1) 失败');
        await waitGame(cdp, 'window.__arcadeTest.challengeInfo().state === "playing"');
        await skipPreview(cdp);
        const observable = await cdp.evaluate('window.__arcadeTest.stageObservable()');
        const groups = new Map();
        for (const card of observable.cards) {
          if (!groups.has(card.symbol)) groups.set(card.symbol, []);
          groups.get(card.symbol).push(card);
        }
        ctx.assert(groups.size === 3, 'C01 符号种类 ' + groups.size + ' ≠ 3');
        for (const [symbol, pair] of groups) {
          ctx.assert(pair.length === 2, '符号 ' + symbol + ' 数量 ' + pair.length + ' ≠ 2');
          for (const card of pair) {
            await cdp.tap(Math.round(card.x + card.w / 2), Math.round(card.y + card.h / 2));
            await new Promise((resolve) => setTimeout(resolve, 130));
          }
          await new Promise((resolve) => setTimeout(resolve, 240));
          const matched = await cdp.evaluate('window.__arcadeTest.challengeInfo().pairsMatched');
          ctx.assert(matched >= 1, '真实点击未产生配对');
        }
        await waitGame(cdp, 'window.__arcadeTest.challengeInfo().state === "cleared"');
        const cleared = await cdp.evaluate(`({
          info: __arcadeTest.challengeInfo(),
          title: document.querySelector('[data-ov-title]').textContent,
          progress: Arcade.Challenge.progress('memory-flip')
        })`);
        ctx.assert(cleared.info.cleared === true && cleared.info.stageId === 'memory-flip-C01', 'C01 未标记清关：' + JSON.stringify(cleared.info));
        ctx.assert(cleared.title === '挑战通关', '通关标题 ' + cleared.title);
        ctx.assert(cleared.progress.cleared.indexOf('memory-flip-C01') !== -1, '挑战记录未写入：' + JSON.stringify(cleared.progress));
        const best = cleared.progress.best['memory-flip-C01'];
        ctx.assert(best && Number(best.timeSec) > 0, '最佳用时缺失：' + JSON.stringify(best));
        const result = await cdp.evaluate(`(() => { const el = document.querySelector('.ac-challenge-result'); return el ? el.textContent : ''; })()`);
        ctx.assert(/C01/.test(result) && /通关/.test(result), '结算 DOM 缺少 resultHtml：' + result);
        return { pairs: groups.size, timeSec: best.timeSec, assisted: !!best.assisted, evidence: 'real-input-replay' };
      },
      'real-input-replay'
    ),
    moduleScenario(
      'CH-MF-003',
      '翻错超限失败可归因 + 1 次点击重试本关',
      async (cdp, ctx) => {
        /* 先通过 C01 解锁 C02，再在 C02 用真实翻牌触发超限失败（C02 maxMismatches=4）。 */
        ctx.assert(await cdp.evaluate('window.__arcadeTest.startChallenge(1)') === true, 'startChallenge(1) 失败');
        await waitGame(cdp, 'window.__arcadeTest.challengeInfo().state === "playing"');
        ctx.assert(await cdp.evaluate('window.__arcadeTest.forceStageClear(false)') === true, 'C01 清关记录失败');
        ctx.assert(await cdp.evaluate('window.__arcadeTest.startChallenge(2)') === true, 'C02 未解锁或无法进入');
        await waitGame(cdp, 'window.__arcadeTest.challengeInfo().state === "playing"');
        const info = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        ctx.assert(info.stageId === 'memory-flip-C02' && info.maxMismatches === 4, 'C02 状态错误：' + JSON.stringify(info));
        await skipPreview(cdp);
        const observables = await cdp.evaluate('window.__arcadeTest.stageObservable()');
        const first = observables.cards[0];
        const different = observables.cards.find((card) => card.symbol !== first.symbol);
        ctx.assert(different, '找不到不同符号的两张牌');
        for (let attempt = 0; attempt < 6; attempt += 1) {
          await cdp.evaluate('window.__arcadeTest.revealById(0)');
          await new Promise((resolve) => setTimeout(resolve, 120));
          await cdp.evaluate('window.__arcadeTest.revealById(' + different.id + ')');
          await waitGame(cdp, 'window.__arcadeTest.challengeInfo().state === "failed" || window.__arcadeTest.stageObservable().mismatchTimer === 0', 4000);
          const state = await cdp.evaluate('window.__arcadeTest.challengeInfo().state');
          if (state === 'failed') break;
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
        const failed = await cdp.evaluate(`({
          info: __arcadeTest.challengeInfo(),
          title: document.querySelector('[data-ov-title]').textContent,
          btn: document.querySelector('[data-ov-btn]').textContent
        })`);
        ctx.assert(failed.info.state === 'failed', '翻错超限未失败：' + JSON.stringify(failed.info));
        ctx.assert(failed.info.mismatches > failed.info.maxMismatches, '翻错计数 ' + failed.info.mismatches + ' 未超过上限 ' + failed.info.maxMismatches);
        ctx.assert(/翻错/.test(failed.info.errorReason), '失败原因不可归因：' + failed.info.errorReason);
        ctx.assert(failed.title === '挑战失败' && /重试本关/.test(failed.btn), '失败弹层错误：' + JSON.stringify({ title: failed.title, btn: failed.btn }));
        await cdp.click('[data-ov-btn]');
        await waitGame(cdp, 'window.__arcadeTest.challengeInfo().state === "playing"');
        const retried = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        ctx.assert(retried.stageId === 'memory-flip-C02' && retried.mismatches === 0 && retried.pairsMatched === 0, '重试未回到本关起点：' + JSON.stringify(retried));
        return { reason: failed.info.errorReason, mismatches: failed.info.mismatches, maxMismatches: failed.info.maxMismatches, retryStage: retried.stageId };
      },
      'engine-replay'
    ),
    moduleScenario(
      'CH-MF-004',
      '暂停 → 刷新 → 续玩恢复同一关/翻开状态',
      async (cdp, ctx) => {
        ctx.assert(await cdp.evaluate('window.__arcadeTest.startChallenge(1)') === true, 'startChallenge(1) 失败');
        await waitGame(cdp, 'window.__arcadeTest.challengeInfo().state === "playing"');
        await skipPreview(cdp);
        const observable = await cdp.evaluate('window.__arcadeTest.stageObservable()');
        const card = observable.cards[0];
        await cdp.tap(Math.round(card.x + card.w / 2), Math.round(card.y + card.h / 2));
        await cdp.waitFor('window.__arcadeTest.stageObservable().flippedIds.length === 1', { timeout: 3000 });
        const before = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        await cdp.click('[data-pause]');
        await waitGame(cdp, 'window.__arcadeTest.challengeInfo().state === "paused"');
        await cdp.navigate(ctx.base + '/apps/arcade/games/memory-flip.html?ch009-resume=1#test');
        const title = await cdp.text('[data-ov-title]');
        ctx.assert(title && title.indexOf('继续') !== -1, '刷新后未显示续玩提示：' + title);
        await cdp.click('[data-ov-btn]');
        await waitGame(cdp, 'window.__arcadeTest.challengeInfo().state === "playing"');
        const resumed = await cdp.evaluate(`({ info: __arcadeTest.challengeInfo(), obs: __arcadeTest.stageObservable() })`);
        ctx.assert(resumed.info.mode === 'challenge' && resumed.info.stageId === 'memory-flip-C01', '恢复模式/关卡错误：' + JSON.stringify(resumed.info));
        ctx.assert(resumed.obs.flippedIds.length === 1, '恢复后未保留已翻开牌：' + JSON.stringify(resumed.obs.flippedIds));
        const hud = await cdp.evaluate('!document.querySelector("[data-ch-hud]").hidden');
        ctx.assert(hud === true, '恢复后挑战 HUD 未显示');
        return { stage: resumed.info.stageId, flipped: resumed.obs.flippedIds.length, elapsed: resumed.info.elapsedSec, pausedElapsed: before.elapsedSec };
      },
      'engine-replay'
    ),
    moduleScenario(
      'CH-MF-005',
      'assisted 标记 + 布局变换/clue 可观测',
      async (cdp, ctx) => {
        ctx.assert(await cdp.evaluate('window.__arcadeTest.startChallenge(1)') === true, 'startChallenge(1) 失败');
        await waitGame(cdp, 'window.__arcadeTest.challengeInfo().state === "playing"');
        await skipPreview(cdp);
        ctx.assert(await cdp.evaluate('window.__arcadeTest.useJoyTool("peek")') === true, '使用再看一眼失败');
        const used = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        ctx.assert(used.assisted === true, '使用道具后 assisted 未标记：' + JSON.stringify(used));
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 3000 });
        ctx.assert(await cdp.evaluate('window.__arcadeTest.forceStageClear(false)') === true, 'forceStageClear 失败');
        const progress = await cdp.evaluate('Arcade.Challenge.progress("memory-flip")');
        const best = progress.best['memory-flip-C01'];
        ctx.assert(best && best.assisted === true, '挑战记录未保留 assisted：' + JSON.stringify(best));
        const obs = await cdp.evaluate('window.__arcadeTest.stageObservable()');
        ctx.assert(obs.layoutTransform === 'identity', '默认布局变换应为 identity：' + obs.layoutTransform);
        ctx.assert(obs.clues && typeof obs.clues === 'object', 'stageObservable 缺少 clues');
        ctx.assert(obs.faces && obs.faces.length === 2, 'stageObservable 缺少 faces');
        return { assisted: best.assisted, transform: obs.layoutTransform, faces: obs.faces.length };
      },
      'engine-replay'
    ),
    moduleScenario(
      'CH-MF-006',
      '经典模式回归 + 320/390 无横向溢出',
      async (cdp, ctx) => {
        await cdp.navigate(ctx.base + '/apps/arcade/');
        await cdp.evaluate('localStorage.clear()');
        await cdp.navigate(ctx.base + '/apps/arcade/games/memory-flip.html?ch009-classic=1#test');
        const entry = await cdp.evaluate(`(() => {
          const b = document.querySelector('[data-ov-btn2]');
          const r = b ? b.getBoundingClientRect() : null;
          return { hidden: b.hidden, text: b.textContent.trim(), disabled: b.disabled, w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0 };
        })()`);
        ctx.assert(entry.hidden === false && /挑战/.test(entry.text) && entry.disabled === false && entry.h >= 44, '挑战入口不符：' + JSON.stringify(entry));
        await cdp.click('[data-ov-btn]');
        await waitGame(cdp, 'window.__arcadeTest.challengeInfo().mode === "classic" && document.querySelector("[data-overlay]").hidden');
        const classic = await cdp.evaluate(`({
          info: __arcadeTest.info(),
          chHudHidden: document.querySelector('[data-ch-hud]').hidden,
          gameHudHidden: document.querySelector('.game-hud').hidden
        })`);
        ctx.assert(classic.info.level === 1 && classic.info.totalLevels === 6, '经典 6 关配置回归：' + JSON.stringify(classic.info));
        ctx.assert(classic.chHudHidden === true && classic.gameHudHidden === false, '经典 HUD 未恢复：' + JSON.stringify(classic));
        const widths = [];
        for (const width of [320, 390]) {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width === 320 ? 568 : 844, deviceScaleFactor: 1, mobile: true });
          await cdp.navigate(ctx.base + '/apps/arcade/games/memory-flip.html?ch009-w' + width + '=1#test');
          const layout = await cdp.evaluate(`(() => {
            const b = document.querySelector('[data-ov-btn2]');
            const r = b ? b.getBoundingClientRect() : null;
            return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, btn2: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null };
          })()`);
          ctx.assert(layout.sw <= layout.cw + 1, width + 'px 横向溢出 ' + layout.sw + '>' + layout.cw);
          ctx.assert(layout.btn2 && layout.btn2.h >= 44, width + 'px 挑战入口触控目标不足：' + JSON.stringify(layout.btn2));
          widths.push(width + ':' + layout.sw + '/' + layout.cw);
        }
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });
        return { classicLevels: classic.info.totalLevels, entry: entry.text, widths: widths.join(' ') };
      },
      'engine-replay'
    ),
  ],
};
