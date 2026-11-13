/**
 * 0.9 挑战模式确定性场景：层塔（pendulum-tower）。
 * 协议见 docs/arcade/0.9/INTEGRATION-CONTRACT.md §6 / docs/arcade/0.9/TESTING.md。
 * 证据等级：
 * - C01 委托通关为 engine-replay（真实钟摆物理 + 真实 releaseBox 落箱/倾斜判定；
 *   松手由 #test 便捷钩子在目标偏置对齐的下一帧触发，非逐像素人工点击 —— 差距见 impl 文档）；
 * - 真实指针点击放箱路径在 CH-PT-001 单独断言；
 * - 其它为 engine-replay。
 */

const GAME_ID = 'pendulum-tower';

async function unlockThrough(cdp, ctx, lastIndex) {
  for (let index = 1; index <= lastIndex; index += 1) {
    ctx.assert(await cdp.evaluate('window.__arcadeTest.startChallenge(' + index + ')') === true, 'startChallenge(' + index + ') 失败');
    await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
    if (index < lastIndex) {
      ctx.assert(await cdp.evaluate('window.__arcadeTest.forceStageClear(false)') === true, 'C0' + index + ' 记录失败');
    }
  }
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

async function dropAligned(cdp, ctx, offset) {
  await cdp.waitFor('window.__arcadeTest.stageObservable().pendulum.hasBox === true && window.__arcadeTest.stageObservable().drop === null', { timeout: 8000 });
  const released = await cdp.evaluate('__arcadeTest.releaseWhenAligned(' + offset + ', 6)');
  ctx.assert(released === true, '按目标偏置 ' + offset + 'px 松手失败');
  return released;
}

function moduleScenario(id, title, run, evidence) {
  return { id, title, run, evidence };
}

export default {
  gameId: GAME_ID,
  gameFile: 'pendulum-tower.html',
  evidence: 'engine-replay',
  scenarios: [
    moduleScenario(
      'CH-PT-001',
      '挑战数据/选关面板/锁定/真实点击放箱',
      async (cdp, ctx) => {
        const stages = await cdp.evaluate('window.__arcadeTest.challengeStages()');
        ctx.assert(Array.isArray(stages) && stages.length === 6, '6 关数据缺失');
        ctx.assert(stages.every((stage) => /^pendulum-tower-C0[1-6]$/.test(stage.id)), '关卡 ID 异常：' + JSON.stringify(stages.map((s) => s.id)));
        ctx.assert(stages[0].unlocked === true && stages[5].unlocked === false, '解锁状态错误：' + JSON.stringify(stages.map((s) => [s.id, s.unlocked])));
        const panel = await enterStageFromPanel(cdp, ctx, 'pendulum-tower-C01');
        const info = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        ctx.assert(info.mode === 'challenge' && info.stageId === 'pendulum-tower-C01', '进入 C01 状态错误：' + JSON.stringify(info));
        ctx.assert(info.floors === 0 && info.floorsRequired === 4 && info.maxLean === 0.075 && info.maxDroppedBoxes === 5, 'C01 委托目标/限制错误：' + JSON.stringify(info));
        ctx.assert(info.toolsUsed.guide === 0 && info.toolsUsed.brace === 0, 'C01 不应允许道具：' + JSON.stringify(info.toolsUsed));
        await ctx.sleep(220); /* 等首帧钟摆积分，再断言确定性摆动 */
        const obs = await cdp.evaluate('window.__arcadeTest.stageObservable()');
        ctx.assert(obs.currentTargetOffsetPx === 0 && obs.currentTolerancePx === 8, 'C01 当前目标偏置错误：' + JSON.stringify(obs));
        ctx.assert(obs.pendulum && Math.abs(obs.pendulum.angle) > 0.005, '钟摆未按确定性初始角速度摆动：' + JSON.stringify(obs.pendulum));
        const hud = await cdp.evaluate(`(() => {
          const hud = document.querySelector('[data-ch-hud]');
          return { hidden: hud.hidden, text: hud.textContent, gameHudHidden: document.querySelector('.game-hud').hidden };
        })()`);
        ctx.assert(hud.hidden === false && /C01/.test(hud.text) && /目标 0px/.test(hud.text) && hud.gameHudHidden === true, '挑战 HUD 未按合同切换：' + JSON.stringify(hud));
        /* 真实指针点击放箱路径（不依赖便捷钩子）。 */
        await cdp.tap(210, 320);
        await cdp.waitFor('window.__arcadeTest.stageObservable().drop !== null || window.__arcadeTest.stageObservable().pendulum.hasBox === false', { timeout: 4000 });
        const afterClick = await cdp.evaluate('window.__arcadeTest.stageObservable()');
        ctx.assert(afterClick.pendulum.hasBox === false, '真实点击未触发放箱：' + JSON.stringify(afterClick.pendulum));
        return { stages: stages.length, panelButtons: panel.count, floorsRequired: info.floorsRequired, maxLean: info.maxLean, clickReleased: true };
      },
      'engine-replay'
    ),
    moduleScenario(
      'CH-PT-002',
      'C01 referencePlan.releaseOffsetsPx 参考释放通关（engine-replay）',
      async (cdp, ctx) => {
        await enterStageFromPanel(cdp, ctx, 'pendulum-tower-C01');
        const plan = [0, 0, 0, 0];
        for (let index = 0; index < plan.length; index += 1) {
          await dropAligned(cdp, ctx, plan[index]);
          await cdp.waitFor('window.__arcadeTest.stageObservable().floors >= ' + (index + 1), { timeout: 8000 });
          await cdp.waitFor('window.__arcadeTest.stageObservable().drop === null', { timeout: 5000 });
        }
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "cleared"', { timeout: 5000 });
        const cleared = await cdp.evaluate(`({
          info: __arcadeTest.challengeInfo(),
          title: document.querySelector('[data-ov-title]').textContent,
          text: document.querySelector('[data-ov-text]').textContent,
          progress: Arcade.Challenge.progress('pendulum-tower')
        })`);
        ctx.assert(cleared.title === '挑战通关', '通关标题 ' + cleared.title);
        ctx.assert(cleared.info.floors === 4 && cleared.info.state === 'cleared', '通关楼层错误：' + JSON.stringify(cleared.info));
        ctx.assert(cleared.info.marks.length === 4 && cleared.info.marks.every((mark) => mark.withinTolerance), '落点标记未全部在容差内：' + JSON.stringify(cleared.info.marks));
        ctx.assert(cleared.progress.cleared.indexOf('pendulum-tower-C01') !== -1, '挑战记录未写入');
        const best = cleared.progress.best['pendulum-tower-C01'];
        ctx.assert(best && Number(best.timeSec) > 0, '最佳用时缺失：' + JSON.stringify(best));
        ctx.assert(/金牌|银牌|铜牌/.test(cleared.text), '结算缺少评价等级：' + cleared.text.slice(0, 160));
        const result = await cdp.evaluate(`(() => { const el = document.querySelector('.ac-challenge-result'); return el ? el.textContent : ''; })()`);
        ctx.assert(/C01/.test(result) && /通关/.test(result), '结算 DOM 缺少 resultHtml：' + result);
        return { floors: cleared.info.floors, marks: cleared.info.marks.map((m) => m.actualOffsetPx), evaluation: cleared.info.evaluation, timeSec: best.timeSec, evidence: 'engine-replay' };
      },
      'engine-replay'
    ),
    moduleScenario(
      'CH-PT-003',
      '倾斜超限失败可归因 + 1 次点击重试本关',
      async (cdp, ctx) => {
        ctx.assert(await cdp.evaluate('window.__arcadeTest.startChallenge(1)') === true, 'startChallenge(1) 失败');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        await cdp.evaluate('window.__arcadeTest.setLean(0.2, 0)');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "failed"', { timeout: 4000 });
        const failed = await cdp.evaluate(`({
          info: __arcadeTest.challengeInfo(),
          title: document.querySelector('[data-ov-title]').textContent,
          btn: document.querySelector('[data-ov-btn]').textContent
        })`);
        ctx.assert(failed.info.stageId === 'pendulum-tower-C01' && /倾斜/.test(failed.info.errorReason), '失败原因不可归因：' + failed.info.errorReason);
        ctx.assert(failed.title === '挑战失败' && /重试本关/.test(failed.btn), '失败弹层错误：' + JSON.stringify({ title: failed.title, btn: failed.btn }));
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        const retried = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        ctx.assert(retried.stageId === 'pendulum-tower-C01' && retried.floors === 0 && retried.marks.length === 0, '重试未回到本关起点：' + JSON.stringify(retried));
        return { reason: failed.info.errorReason, retryStage: retried.stageId };
      },
      'engine-replay'
    ),
    moduleScenario(
      'CH-PT-004',
      '暂停 → 刷新 → 续玩恢复同一关/楼层/落点记录',
      async (cdp, ctx) => {
        ctx.assert(await cdp.evaluate('window.__arcadeTest.startChallenge(1)') === true, 'startChallenge(1) 失败');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        await dropAligned(cdp, ctx, 0);
        await cdp.waitFor('window.__arcadeTest.stageObservable().floors === 1', { timeout: 8000 });
        await cdp.waitFor('window.__arcadeTest.stageObservable().drop === null', { timeout: 5000 });
        const before = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        await cdp.click('[data-pause]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "paused"', { timeout: 4000 });
        await cdp.navigate(ctx.base + '/apps/arcade/games/pendulum-tower.html?ch009-resume=1#test');
        const title = await cdp.text('[data-ov-title]');
        ctx.assert(title && title.indexOf('继续') !== -1, '刷新后未显示续玩提示：' + title);
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        const resumed = await cdp.evaluate(`({ info: __arcadeTest.challengeInfo(), obs: __arcadeTest.stageObservable() })`);
        ctx.assert(resumed.info.mode === 'challenge' && resumed.info.stageId === 'pendulum-tower-C01', '恢复模式/关卡错误：' + JSON.stringify(resumed.info));
        ctx.assert(resumed.info.floors >= 1 && resumed.obs.boxes.length >= 2, '恢复后楼层/箱体丢失：' + JSON.stringify({ floors: resumed.info.floors, boxes: resumed.obs.boxes.length }));
        ctx.assert(resumed.info.marks.length >= 1 && resumed.obs.pendulum.hasBox === true, '恢复后落点记录/钟摆状态丢失：' + JSON.stringify({ marks: resumed.info.marks.length, hasBox: resumed.obs.pendulum.hasBox }));
        const hud = await cdp.evaluate('!document.querySelector("[data-ch-hud]").hidden');
        ctx.assert(hud === true, '恢复后挑战 HUD 未显示');
        return { stage: resumed.info.stageId, floors: resumed.info.floors, marks: resumed.info.marks.length };
      },
      'engine-replay'
    ),
    moduleScenario(
      'CH-PT-005',
      '配重 assisted 标记与记录（C04 允许 1 次）',
      async (cdp, ctx) => {
        await unlockThrough(cdp, ctx, 4);
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        const c04 = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        ctx.assert(c04.stageId === 'pendulum-tower-C04', 'C04 未解锁/进入失败：' + JSON.stringify(c04.stageId));
        const obs = await cdp.evaluate('window.__arcadeTest.stageObservable()');
        ctx.assert(obs.tools.brace === 1 && obs.tools.guide === 0, 'C04 道具限额未按设计加载：' + JSON.stringify(obs.tools));
        await cdp.evaluate('window.__arcadeTest.setLean(0.06, 0.1)');
        const braceOk = await cdp.evaluate('window.__arcadeTest.useJoyTool("brace")');
        const assisted = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        ctx.assert(braceOk === true && assisted.assisted === true && assisted.toolsUsed.brace === 1, '配重 assisted 标记错误：' + JSON.stringify(assisted));
        ctx.assert(await cdp.evaluate('window.__arcadeTest.forceStageClear(false)') === true, 'C04 记录失败');
        const progress = await cdp.evaluate('Arcade.Challenge.progress("pendulum-tower")');
        ctx.assert(progress.best['pendulum-tower-C04'] && progress.best['pendulum-tower-C04'].assisted === true, 'assisted 记录未保存：' + JSON.stringify(progress.best['pendulum-tower-C04']));
        return { stage: c04.stageId, tools: obs.tools, toolsUsed: assisted.toolsUsed, assisted: true };
      },
      'engine-replay'
    ),
    moduleScenario(
      'CH-PT-006',
      '经典模式回归 + 320/390 无横向溢出',
      async (cdp, ctx) => {
        await cdp.navigate(ctx.base + '/apps/arcade/');
        await cdp.evaluate('localStorage.clear()');
        await cdp.navigate(ctx.base + '/apps/arcade/games/pendulum-tower.html?ch009-classic=1#test');
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
          tools: __arcadeTest.joyInfo().tools
        })`);
        ctx.assert(classic.tools.guide === 3 && classic.tools.brace === 2, '经典道具配置回归：' + JSON.stringify(classic.tools));
        ctx.assert(classic.chHudHidden === true && classic.gameHudHidden === false, '经典 HUD 未恢复：' + JSON.stringify(classic));
        const widths = [];
        for (const width of [320, 390]) {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width === 320 ? 568 : 844, deviceScaleFactor: 1, mobile: true });
          await cdp.navigate(ctx.base + '/apps/arcade/games/pendulum-tower.html?ch009-w' + width + '=1#test');
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
        return { classicTools: classic.tools, entry: entry.text, widths: widths.join(' ') };
      },
      'engine-replay'
    ),
  ],
};
