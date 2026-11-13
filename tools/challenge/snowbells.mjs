/**
 * 0.9 挑战模式确定性场景：雪铃（snowbells）。
 * 协议见 docs/arcade/0.9/INTEGRATION-CONTRACT.md §6 / docs/arcade/0.9/TESTING.md。
 * 证据等级：
 * - C01 参考通关为 real-input-replay（按 requiredSequence 用真实左右方向键踩铃，真实碰撞反弹）；
 * - 其它为 engine-replay（#test 钩子驱动状态机 + 真实 DOM 点击）。
 */

const GAME_ID = 'snowbells';

async function pressKey(cdp, key, down) {
  await cdp.key(key, down ? 'down' : 'up');
}

/** 预测落点的横向控制：把兔子移动到下一颗目标铃的 x 附近（真实按键，逐帧反馈）。
 *  只负责命中「下一颗铃」（seqIndex 前进或状态变化即停止），由调用方逐铃推进。 */
async function steerToNextBell(cdp, fromSeqIndex, timeoutMs = 15000) {
  const started = Date.now();
  let held = null;
  while (Date.now() - started < timeoutMs) {
    const obs = await cdp.evaluate('window.__arcadeTest.stageObservable()');
    if (obs.state !== 'playing' || obs.seqIndex > fromSeqIndex) return obs;
    const target = obs.bells.find((bell) => bell.id === obs.nextBellId);
    if (!target) return obs;
    const tFall = obs.player.vy > 20 ? Math.max(0, (target.y - obs.player.y) / obs.player.vy) : 0;
    const predicted = obs.player.x + obs.player.vx * Math.min(tFall, 0.9);
    const err = target.x - predicted;
    let want = null;
    if (err > 5) want = 'right';
    else if (err < -5) want = 'left';
    if (want !== held) {
      if (held) await pressKey(cdp, held === 'left' ? 'ArrowLeft' : 'ArrowRight', false);
      if (want) await pressKey(cdp, want === 'left' ? 'ArrowLeft' : 'ArrowRight', true);
      held = want;
    }
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  if (held) await pressKey(cdp, held === 'left' ? 'ArrowLeft' : 'ArrowRight', false);
  return cdp.evaluate('window.__arcadeTest.stageObservable()');
}

async function enterStageFromPanel(cdp, ctx, stageId) {
  await cdp.click('[data-ov-btn2]');
  await cdp.waitFor('!document.querySelector("[data-ch-layer]").hidden', { timeout: 4000 });
  const panel = await cdp.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.ac-stage-btn')];
    return { count: buttons.length, locked: buttons.filter((b) => b.disabled).length };
  })()`);
  ctx.assert(panel.count === 6, '选关按钮数 ' + panel.count + ' ≠ 6');
  ctx.assert(panel.locked === 5, '初始锁定关数 ' + panel.locked + ' ≠ 5');
  await cdp.click('[data-stage-id="' + stageId + '"]');
  await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
  return panel;
}

function moduleScenario(id, title, run, evidence) {
  return { id, title, run, evidence };
}

export default {
  gameId: GAME_ID,
  gameFile: 'snowbells.html',
  evidence: 'engine-replay'
,
  scenarios: [
    moduleScenario(
      'CH-SB-001',
      '挑战数据/选关面板/锁定与真实进入 C01',
      async (cdp, ctx) => {
        const stages = await cdp.evaluate('window.__arcadeTest.challengeStages()');
        ctx.assert(Array.isArray(stages) && stages.length === 6, '6 关数据缺失');
        ctx.assert(stages.every((stage) => /^snowbells-C0[1-6]$/.test(stage.id)), '关卡 ID 异常：' + JSON.stringify(stages.map((s) => s.id)));
        ctx.assert(stages[0].unlocked === true && stages[5].unlocked === false, '解锁状态错误：' + JSON.stringify(stages.map((s) => [s.id, s.unlocked])));
        const panel = await enterStageFromPanel(cdp, ctx, 'snowbells-C01');
        const info = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        ctx.assert(info.mode === 'challenge' && info.stageId === 'snowbells-C01', '进入 C01 状态错误：' + JSON.stringify(info));
        ctx.assert(info.seqTotal === 4 && info.nextBellId === 'A', 'C01 序列/下一铃错误：' + JSON.stringify(info));
        const obs = await cdp.evaluate('window.__arcadeTest.stageObservable()');
        ctx.assert(obs.sequence.join('') === 'ABCD' && obs.bells.length === 4, 'C01 固定铃数据错误：' + JSON.stringify({ seq: obs.sequence, bells: obs.bells.length }));
        ctx.assert(obs.bells.every((bell) => bell.kind === 'normal' && bell.consumed === false), 'C01 铃类型/初始消耗错误');
        ctx.assert(Math.abs(obs.bells[0].x - 210) < 1 && Math.abs(obs.bells[0].y - (740 - 120)) < 1, 'C01 首铃坐标错误：' + JSON.stringify(obs.bells[0]));
        const hud = await cdp.evaluate(`(() => {
          const hud = document.querySelector('[data-ch-hud]');
          return { hidden: hud.hidden, text: hud.textContent, gameHudHidden: document.querySelector('.game-hud').hidden };
        })()`);
        ctx.assert(hud.hidden === false && /C01/.test(hud.text) && /下一铃 A/.test(hud.text) && hud.gameHudHidden === true, '挑战 HUD 未按合同切换：' + JSON.stringify(hud));
        return { stages: stages.length, panelButtons: panel.count, seq: obs.sequence.join(''), entered: info.stageId };
      },
      'engine-replay'
    ),
    moduleScenario(
      'CH-SB-002',
      'C01 requiredSequence 真实方向键踩铃通关（real-input-replay）',
      async (cdp, ctx) => {
        await enterStageFromPanel(cdp, ctx, 'snowbells-C01');
        const expectOrder = ['A', 'B', 'C', 'D'];
        for (const id of expectOrder) {
          const info = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
          if (info.state !== 'playing') break;
          ctx.assert(info.nextBellId === id, '下一铃应为 ' + id + '，实际 ' + info.nextBellId);
          await steerToNextBell(cdp, info.seqIndex, 15000);
        }
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "cleared"', { timeout: 5000 });
        const cleared = await cdp.evaluate(`({
          info: __arcadeTest.challengeInfo(),
          title: document.querySelector('[data-ov-title]').textContent,
          progress: Arcade.Challenge.progress('snowbells')
        })`);
        ctx.assert(cleared.title === '挑战通关', '通关标题 ' + cleared.title);
        ctx.assert(cleared.info.seqIndex === 4 && cleared.info.cleared === true, '通关进度错误：' + JSON.stringify(cleared.info));
        ctx.assert(cleared.progress.cleared.indexOf('snowbells-C01') !== -1, '挑战记录未写入');
        const best = cleared.progress.best['snowbells-C01'];
        ctx.assert(best && Number(best.timeSec) > 0, '最佳用时缺失：' + JSON.stringify(best));
        const result = await cdp.evaluate(`(() => { const el = document.querySelector('.ac-challenge-result'); return el ? el.textContent : ''; })()`);
        ctx.assert(/C01/.test(result) && /通关/.test(result), '结算 DOM 缺少 resultHtml：' + result);
        return { seq: cleared.info.seqIndex, timeSec: best.timeSec, assisted: !!best.assisted, evidence: 'real-input-replay' };
      },
      'real-input-replay'
    ),
    moduleScenario(
      'CH-SB-003',
      '落空失败可归因 + 1 次点击重试本关',
      async (cdp, ctx) => {
        ctx.assert(await cdp.evaluate('window.__arcadeTest.startChallenge(1)') === true, 'startChallenge(1) 失败');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        /* 一直向左侧移动，错过下一颗铃后坠落。 */
        await pressKey(cdp, 'ArrowLeft', true);
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "failed"', { timeout: 12000 });
        await pressKey(cdp, 'ArrowLeft', false);
        const failed = await cdp.evaluate(`({
          info: __arcadeTest.challengeInfo(),
          title: document.querySelector('[data-ov-title]').textContent,
          btn: document.querySelector('[data-ov-btn]').textContent
        })`);
        ctx.assert(failed.info.state === 'failed' && failed.info.stageId === 'snowbells-C01', '失败状态错误：' + JSON.stringify(failed.info));
        ctx.assert(/落空/.test(failed.info.errorReason), '失败原因不可归因：' + failed.info.errorReason);
        ctx.assert(failed.title === '挑战失败' && /重试本关/.test(failed.btn), '失败弹层错误：' + JSON.stringify({ title: failed.title, btn: failed.btn }));
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        const retried = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        ctx.assert(retried.stageId === 'snowbells-C01' && retried.seqIndex === 0 && retried.wrongHits === 0, '重试未回到本关起点：' + JSON.stringify(retried));
        return { reason: failed.info.errorReason, retryStage: retried.stageId };
      },
      'engine-replay'
    ),
    moduleScenario(
      'CH-SB-004',
      '暂停 → 刷新 → 续玩恢复同一关/踩铃进度',
      async (cdp, ctx) => {
        ctx.assert(await cdp.evaluate('window.__arcadeTest.startChallenge(1)') === true, 'startChallenge(1) 失败');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        await steerToNextBell(cdp, 0, 15000); /* 命中 A */
        await cdp.waitFor('window.__arcadeTest.challengeInfo().seqIndex >= 1', { timeout: 6000 });
        const before = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        await cdp.click('[data-pause]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "paused"', { timeout: 4000 });
        await cdp.navigate(ctx.base + '/apps/arcade/games/snowbells.html?ch009-resume=1#test');
        const title = await cdp.text('[data-ov-title]');
        ctx.assert(title && title.indexOf('继续') !== -1, '刷新后未显示续玩提示：' + title);
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        const resumed = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        ctx.assert(resumed.mode === 'challenge' && resumed.stageId === 'snowbells-C01', '恢复模式/关卡错误：' + JSON.stringify(resumed));
        ctx.assert(resumed.seqIndex >= 1, '恢复后踩铃进度回退：' + JSON.stringify({ before: before.seqIndex, after: resumed.seqIndex }));
        const hud = await cdp.evaluate('!document.querySelector("[data-ch-hud]").hidden');
        ctx.assert(hud === true, '恢复后挑战 HUD 未显示');
        return { stage: resumed.stageId, seqIndex: resumed.seqIndex, elapsed: resumed.elapsedSec };
      },
      'engine-replay'
    ),
    moduleScenario(
      'CH-SB-005',
      '休止铃/彩铃数据与 assisted 标记',
      async (cdp, ctx) => {
        /* 解锁 C02/C03 后查看休止铃结构；C04 查看彩铃 optional。 */
        ctx.assert(await cdp.evaluate('window.__arcadeTest.startChallenge(1)') === true, 'C01 进入失败');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        ctx.assert(await cdp.evaluate('window.__arcadeTest.forceStageClear(false)') === true, 'C01 记录失败');
        ctx.assert(await cdp.evaluate('window.__arcadeTest.startChallenge(2)') === true, 'C02 进入失败');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        ctx.assert(await cdp.evaluate('window.__arcadeTest.forceStageClear(false)') === true, 'C02 记录失败');
        ctx.assert(await cdp.evaluate('window.__arcadeTest.startChallenge(3)') === true, 'C03 进入失败');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        const c03 = await cdp.evaluate('window.__arcadeTest.stageObservable()');
        ctx.assert(c03.sequence.join('') === 'ABCDE' && c03.bells.filter((bell) => bell.kind === 'rest').length === 2, 'C03 休止铃结构错误：' + JSON.stringify(c03.bells.map((b) => [b.id, b.kind])));
        ctx.assert(await cdp.evaluate('window.__arcadeTest.forceStageClear(false)') === true, 'C03 记录失败');
        ctx.assert(await cdp.evaluate('window.__arcadeTest.startChallenge(4)') === true, 'C04 进入失败');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        const c04 = await cdp.evaluate('window.__arcadeTest.stageObservable()');
        ctx.assert(c04.bells.filter((bell) => bell.optional).length === 2 && c04.sequence.join('') === 'ABCDEF', 'C04 彩铃/序列结构错误：' + JSON.stringify({ optional: c04.bells.filter((b) => b.optional).map((b) => b.id), seq: c04.sequence }));
        ctx.assert(await cdp.evaluate('window.__arcadeTest.useJoyTool("magnet")') === true, '使用铃磁失败');
        const assisted = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        ctx.assert(assisted.assisted === true, '挑战中使用道具未标记 assisted：' + JSON.stringify(assisted));
        ctx.assert(await cdp.evaluate('window.__arcadeTest.forceStageClear(false)') === true, 'C04 记录失败');
        const progress = await cdp.evaluate('Arcade.Challenge.progress("snowbells")');
        ctx.assert(progress.best['snowbells-C04'] && progress.best['snowbells-C04'].assisted === true, 'assisted 记录未保存：' + JSON.stringify(progress.best['snowbells-C04']));
        return { restBells: 2, optionalBells: 2, assisted: true, cleared: progress.cleared.length };
      },
      'engine-replay'
    ),
    moduleScenario(
      'CH-SB-006',
      '经典模式回归 + 320/390 无横向溢出',
      async (cdp, ctx) => {
        await cdp.navigate(ctx.base + '/apps/arcade/');
        await cdp.evaluate('localStorage.clear()');
        await cdp.navigate(ctx.base + '/apps/arcade/games/snowbells.html?ch009-classic=1#test');
        const entry = await cdp.evaluate(`(() => {
          const b = document.querySelector('[data-ov-btn2]');
          const r = b ? b.getBoundingClientRect() : null;
          return { hidden: b.hidden, text: b.textContent.trim(), disabled: b.disabled, w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0 };
        })()`);
        ctx.assert(entry.hidden === false && /挑战/.test(entry.text) && entry.disabled === false && entry.h >= 44, '挑战入口不符：' + JSON.stringify(entry));
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().mode === "classic" && document.querySelector("[data-overlay]").hidden', { timeout: 6000 });
        const classic = await cdp.evaluate(`({
          info: __arcadeTest.info(),
          chHudHidden: document.querySelector('[data-ch-hud]').hidden,
          gameHudHidden: document.querySelector('.game-hud').hidden,
          consumed: __arcadeTest.info().consumed.length
        })`);
        ctx.assert(classic.consumed >= 4, '经典随机铃生成回归：' + JSON.stringify(classic.info.consumed.length));
        ctx.assert(classic.chHudHidden === true && classic.gameHudHidden === false, '经典 HUD 未恢复：' + JSON.stringify(classic));
        const widths = [];
        for (const width of [320, 390]) {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width === 320 ? 568 : 844, deviceScaleFactor: 1, mobile: true });
          await cdp.navigate(ctx.base + '/apps/arcade/games/snowbells.html?ch009-w' + width + '=1#test');
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
        return { classicBells: classic.consumed, entry: entry.text, widths: widths.join(' ') };
      },
      'engine-replay'
    ),
  ],
};
