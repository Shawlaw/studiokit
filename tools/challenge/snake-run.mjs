/**
 * 0.9 挑战模式确定性场景：贪吃蛇（snake-run）。
 * 协议见 docs/arcade/0.9/INTEGRATION-CONTRACT.md §6 / docs/arcade/0.9/TESTING.md。
 * 证据等级：
 * - C01 参考通关为 real-input-replay（按 referencePlan.movesRLE 用真实方向键逐步输入）；
 * - 其它为 engine-replay（#test 钩子驱动状态机 + 真实 DOM 点击）。
 */

const GAME_ID = 'snake-run';
const KEY = { R: 'ArrowRight', L: 'ArrowLeft', U: 'ArrowUp', D: 'ArrowDown' };

async function pressKey(cdp, key) {
  await cdp.key(key, 'down');
  await new Promise((resolve) => setTimeout(resolve, 70));
  await cdp.key(key, 'up');
  await new Promise((resolve) => setTimeout(resolve, 40));
}

async function enterStageFromPanel(cdp, ctx, stageId) {
  await cdp.click('[data-ov-btn2]');
  await cdp.waitFor('!document.querySelector("[data-ch-layer]").hidden', { timeout: 4000 });
  const panel = await cdp.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.ac-stage-btn')];
    return { count: buttons.length, locked: buttons.filter((b) => b.disabled).length, firstText: buttons[0] ? buttons[0].textContent.trim() : '' };
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
  gameFile: 'snake-run.html',
  evidence: 'engine-replay',
  scenarios: [
    moduleScenario(
      'CH-SN-001',
      '挑战数据/选关面板/锁定与真实进入 C01',
      async (cdp, ctx) => {
        const stages = await cdp.evaluate('window.__arcadeTest.challengeStages()');
        ctx.assert(Array.isArray(stages) && stages.length === 6, '6 关数据缺失：' + JSON.stringify(stages));
        ctx.assert(stages.every((stage) => /^snake-run-C0[1-6]$/.test(stage.id)), '关卡 ID 异常：' + JSON.stringify(stages.map((s) => s.id)));
        ctx.assert(stages[0].unlocked === true && stages[5].unlocked === false, '解锁状态错误：' + JSON.stringify(stages.map((s) => [s.id, s.unlocked])));
        const panel = await enterStageFromPanel(cdp, ctx, 'snake-run-C01');
        ctx.assert(/C01/.test(panel.firstText), 'C01 按钮文案异常：' + panel.firstText);
        const info = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        ctx.assert(info.mode === 'challenge' && info.stageId === 'snake-run-C01', '进入 C01 状态错误：' + JSON.stringify(info));
        const obs = await cdp.evaluate('window.__arcadeTest.stageObservable()');
        ctx.assert(obs.snake.length === 3 && obs.snake[0].x === 3 && obs.snake[0].y === 3, 'C01 初始蛇身错误：' + JSON.stringify(obs.snake));
        ctx.assert(obs.dir.x === 1 && obs.dir.y === 0 && obs.walls.length === 11, 'C01 初始方向/墙错误：' + JSON.stringify({ dir: obs.dir, walls: obs.walls.length }));
        ctx.assert(obs.food && obs.food.x === 7 && obs.food.y === 3 && obs.fruitIndex === 0 && obs.fruitTotal === 3, 'C01 脚本果实错误：' + JSON.stringify({ food: obs.food, index: obs.fruitIndex, total: obs.fruitTotal }));
        ctx.assert(obs.stepIntervalMs === 230, 'C01 步间隔 ' + obs.stepIntervalMs + ' ≠ 230');
        const hud = await cdp.evaluate(`(() => {
          const hud = document.querySelector('[data-ch-hud]');
          return { hidden: hud.hidden, text: hud.textContent, gameHudHidden: document.querySelector('.game-hud').hidden };
        })()`);
        ctx.assert(hud.hidden === false && /C01/.test(hud.text) && hud.gameHudHidden === true, '挑战 HUD 未按合同切换：' + JSON.stringify(hud));
        return { stages: stages.length, panelButtons: panel.count, locked: panel.locked, entered: info.stageId };
      },
      'engine-replay'
    ),
    moduleScenario(
      'CH-SN-002',
      'C01 referencePlan.movesRLE 真实方向键通关（real-input-replay）',
      async (cdp, ctx) => {
        await enterStageFromPanel(cdp, ctx, 'snake-run-C01');
        const plan = [['R', 6], ['D', 7], ['L', 1]];
        let target = 0;
        for (const [key, count] of plan) {
          target += count;
          await pressKey(cdp, KEY[key]);
          await cdp.waitFor(
            'window.__arcadeTest.challengeInfo().state === "cleared" || window.__arcadeTest.stageObservable().steps >= ' + target,
            { timeout: 9000, interval: 40 }
          );
        }
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "cleared"', { timeout: 6000 });
        const cleared = await cdp.evaluate(`({
          info: __arcadeTest.challengeInfo(),
          obs: __arcadeTest.stageObservable(),
          title: document.querySelector('[data-ov-title]').textContent,
          progress: Arcade.Challenge.progress('snake-run')
        })`);
        ctx.assert(cleared.obs.steps === 14, '参考路线步数 ' + cleared.obs.steps + ' ≠ 14');
        ctx.assert(cleared.info.fruitsEaten === 3 && cleared.info.fruitTotal === 3 && cleared.info.cleared === true, 'C01 通关信息错误：' + JSON.stringify(cleared.info));
        ctx.assert(cleared.title === '挑战通关', '通关标题 ' + cleared.title);
        ctx.assert(cleared.progress.cleared.indexOf('snake-run-C01') !== -1, '挑战记录未写入：' + JSON.stringify(cleared.progress));
        const best = cleared.progress.best['snake-run-C01'];
        ctx.assert(best && Number(best.timeSec) > 0, '最佳用时缺失：' + JSON.stringify(best));
        const result = await cdp.evaluate(`(() => { const el = document.querySelector('.ac-challenge-result'); return el ? el.textContent : ''; })()`);
        ctx.assert(/C01/.test(result) && /通关/.test(result), '结算 DOM 缺少 resultHtml：' + result);
        return { steps: cleared.obs.steps, fruits: cleared.info.fruitsEaten, timeSec: best.timeSec, evidence: 'real-input-replay' };
      },
      'real-input-replay'
    ),
    moduleScenario(
      'CH-SN-003',
      '撞墙失败可归因 + 1 次点击重试回本关起点',
      async (cdp, ctx) => {
        ctx.assert(await cdp.evaluate('window.__arcadeTest.startChallenge(1)') === true, 'startChallenge(1) 失败');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        await pressKey(cdp, KEY.U);
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "failed"', { timeout: 6000 });
        const failed = await cdp.evaluate(`({
          info: __arcadeTest.challengeInfo(),
          title: document.querySelector('[data-ov-title]').textContent,
          btn: document.querySelector('[data-ov-btn]').textContent
        })`);
        ctx.assert(failed.info.state === 'failed' && failed.info.stageId === 'snake-run-C01', '失败状态错误：' + JSON.stringify(failed.info));
        ctx.assert(/边界/.test(failed.info.errorReason), '失败原因不可归因：' + failed.info.errorReason);
        ctx.assert(failed.title === '挑战失败' && /重试本关/.test(failed.btn), '失败弹层错误：' + JSON.stringify({ title: failed.title, btn: failed.btn }));
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        const retried = await cdp.evaluate('window.__arcadeTest.stageObservable()');
        ctx.assert(retried.stageId === 'snake-run-C01' && retried.steps === 0, '重试未清零步数：' + JSON.stringify({ stage: retried.stageId, steps: retried.steps }));
        ctx.assert(retried.snake.length === 3 && retried.snake[0].x === 3 && retried.snake[0].y === 3, '重试未回到初始蛇身：' + JSON.stringify(retried.snake));
        ctx.assert(retried.fruitIndex === 0 && retried.food && retried.food.x === 7 && retried.food.y === 3, '重试未回到脚本果实起点：' + JSON.stringify({ food: retried.food, index: retried.fruitIndex }));
        return { reason: failed.info.errorReason, retryStage: retried.stageId, steps: retried.steps };
      },
      'engine-replay'
    ),
    moduleScenario(
      'CH-SN-004',
      '方向队列（两个 90° 按步执行/180° 拒绝）与 assisted 标记',
      async (cdp, ctx) => {
        ctx.assert(await cdp.evaluate('window.__arcadeTest.startChallenge(1)') === true, 'startChallenge(1) 失败');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        const rejected = await cdp.evaluate('window.__arcadeTest.queueChallengeDirection("L") === false && window.__arcadeTest.stageObservable().dirQueue.length === 0');
        ctx.assert(rejected === true, '180° 反向输入未被拒绝');
        const queued = await cdp.evaluate(`(() => {
          const t = __arcadeTest;
          const a = t.queueChallengeDirection('D');
          const b = t.queueChallengeDirection('L');
          const c = t.queueChallengeDirection('U');
          return { a, b, c, queue: t.stageObservable().dirQueue };
        })()`);
        ctx.assert(queued.a === true && queued.b === true && queued.c === false, '方向队列容量/入队结果错误：' + JSON.stringify(queued));
        ctx.assert(queued.queue.length === 2, '方向队列长度 ' + queued.queue.length + ' ≠ 2');
        await cdp.waitFor('window.__arcadeTest.stageObservable().steps >= 2', { timeout: 6000 });
        const turned = await cdp.evaluate('window.__arcadeTest.stageObservable()');
        ctx.assert(turned.dir.x === -1 && turned.dir.y === 0, '两个 90° 未按步执行：' + JSON.stringify(turned.dir));
        ctx.assert(turned.dirQueue.length === 0, '方向队列未出队清空：' + JSON.stringify(turned.dirQueue));
        ctx.assert(turned.snake[0].x === 2 && turned.snake[0].y === 4, '按步执行后蛇头位置错误：' + JSON.stringify(turned.snake[0]));
        const grow = await cdp.evaluate('window.__arcadeTest.growTo(6)');
        ctx.assert(grow === 6, 'growTo=' + grow);
        const trimOk = await cdp.evaluate('window.__arcadeTest.useJoyTool("trim")');
        const assisted = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        ctx.assert(trimOk === true && assisted.assisted === true, '挑战中使用道具未标记 assisted：' + JSON.stringify(assisted));
        ctx.assert(await cdp.evaluate('window.__arcadeTest.forceStageClear(false)') === true, 'forceStageClear 失败');
        const progress = await cdp.evaluate('Arcade.Challenge.progress("snake-run")');
        const best = progress.best['snake-run-C01'];
        ctx.assert(best && best.assisted === true, '挑战记录未保留 assisted：' + JSON.stringify(best));
        return { queue: queued.queue.length, dir: turned.dir, head: turned.snake[0], assisted: best.assisted };
      },
      'engine-replay'
    ),
    moduleScenario(
      'CH-SN-005',
      '暂停 → 刷新 → 续玩恢复同一关/蛇身/步数',
      async (cdp, ctx) => {
        ctx.assert(await cdp.evaluate('window.__arcadeTest.startChallenge(1)') === true, 'startChallenge(1) 失败');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        await pressKey(cdp, KEY.R);
        await cdp.waitFor('window.__arcadeTest.stageObservable().steps >= 2', { timeout: 6000 });
        await cdp.click('[data-pause]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "paused"', { timeout: 4000 });
        const before = await cdp.evaluate('window.__arcadeTest.stageObservable()');
        await cdp.navigate(ctx.base + '/apps/arcade/games/snake-run.html?ch009-resume=1#test');
        const title = await cdp.text('[data-ov-title]');
        ctx.assert(title && title.indexOf('继续') !== -1, '刷新后未显示续玩提示：' + title);
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        const resumed = await cdp.evaluate(`({ info: __arcadeTest.challengeInfo(), obs: __arcadeTest.stageObservable() })`);
        ctx.assert(resumed.info.mode === 'challenge' && resumed.info.stageId === 'snake-run-C01', '恢复模式/关卡错误：' + JSON.stringify(resumed.info));
        ctx.assert(resumed.obs.steps >= before.steps, '恢复后步数回退：' + JSON.stringify({ before: before.steps, after: resumed.obs.steps }));
        ctx.assert(resumed.obs.snake.length === before.snake.length, '恢复后蛇身长度不一致：' + JSON.stringify({ before: before.snake.length, after: resumed.obs.snake.length }));
        ctx.assert(resumed.obs.snake[0].x === before.snake[0].x && resumed.obs.snake[0].y === before.snake[0].y, '恢复后蛇头位置不一致：' + JSON.stringify({ before: before.snake[0], after: resumed.obs.snake[0] }));
        const hud = await cdp.evaluate('!document.querySelector("[data-ch-hud]").hidden');
        ctx.assert(hud === true, '恢复后挑战 HUD 未显示');
        return { stage: resumed.info.stageId, steps: resumed.obs.steps, snakeLength: resumed.obs.snake.length };
      },
      'engine-replay'
    ),
    moduleScenario(
      'CH-SN-006',
      '经典模式回归 + 320/390 无横向溢出',
      async (cdp, ctx) => {
        await cdp.navigate(ctx.base + '/apps/arcade/');
        await cdp.evaluate('localStorage.clear()');
        await cdp.navigate(ctx.base + '/apps/arcade/games/snake-run.html?ch009-classic=1#test');
        const entry = await cdp.evaluate(`(() => {
          const b = document.querySelector('[data-ov-btn2]');
          const r = b ? b.getBoundingClientRect() : null;
          return { hidden: b.hidden, text: b.textContent.trim(), disabled: b.disabled, w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0 };
        })()`);
        ctx.assert(entry.hidden === false && /挑战/.test(entry.text) && entry.disabled === false && entry.h >= 44, '挑战入口不符：' + JSON.stringify(entry));
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().mode === "classic" && document.querySelector("[data-overlay]").hidden', { timeout: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 260));
        const classic = await cdp.evaluate(`({
          info: __arcadeTest.info(),
          chHudHidden: document.querySelector('[data-ch-hud]').hidden,
          gameHudHidden: document.querySelector('.game-hud').hidden
        })`);
        ctx.assert(classic.info.length === 3 && classic.info.lives === 3 && classic.info.goal === 20, '经典 20 果实/3 生命回归：' + JSON.stringify(classic.info));
        ctx.assert(classic.chHudHidden === true && classic.gameHudHidden === false, '经典 HUD 未恢复：' + JSON.stringify(classic));
        const widths = [];
        for (const width of [320, 390]) {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width === 320 ? 568 : 844, deviceScaleFactor: 1, mobile: true });
          await cdp.navigate(ctx.base + '/apps/arcade/games/snake-run.html?ch009-w' + width + '=1#test');
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
        return { classicGoal: classic.info.goal, lives: classic.info.lives, entry: entry.text, widths: widths.join(' ') };
      },
      'engine-replay'
    ),
  ],
};
