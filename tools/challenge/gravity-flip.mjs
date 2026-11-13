/**
 * 0.9 挑战模式确定性场景 · 重力翻转（gravity-flip C01–C06）
 * ============================================================================
 * 证据等级：real-input-replay
 *   - C01 参考通关使用真实指针输入：运行时按 recommendedFlipWindows 的早窗口
 *     （xCenter - tolerance）触发画布点击，由页面真实 update 物理跑完 2200px，
 *     断言 0 碰撞、3 次翻转都落在推荐窗口内。
 *   - 数据/选关/失败/重试/暂停刷新恢复/经典回归/320-390 布局均为 UI+状态真实断言。
 * 真机（iOS/Android）未测：UNVERIFIED。
 * 运行：
 *   node tools/arcade_gameplay_test.mjs --game=gravity-flip --repeat=2
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const T = {
  info: (cdp) => cdp.evaluate('window.__arcadeTest.challengeInfo()'),
  stages: (cdp) => cdp.evaluate('window.__arcadeTest.challengeStages()'),
  observable: (cdp) => cdp.evaluate('window.__arcadeTest.stageObservable()'),
  viewport: (cdp) => cdp.evaluate('({ w: window.innerWidth, h: window.innerHeight, scrollW: document.documentElement.scrollWidth })'),
};

async function waitChallengeState(cdp, wanted, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
  let last = null;
  while (Date.now() < deadline) {
    last = await T.info(cdp);
    if (last && last.state === wanted) return last;
    await sleep(20);
  }
  throw new Error('等待挑战 state=' + wanted + ' 超时；最后=' + JSON.stringify(last));
}

/** 真实指针输入按推荐翻转窗口走完一关；返回过程证据。 */
async function playStageWithRecommendedWindows(cdp, ref) {
  const started = await cdp.evaluate('window.__arcadeTest.startChallenge(' + JSON.stringify(ref) + ')');
  if (started !== true) throw new Error('startChallenge(' + ref + ') 返回 ' + started);
  await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 5000 });
  const windows = await cdp.evaluate('window.__arcadeTest.stageObservable().windows');
  if (!Array.isArray(windows) || windows.length === 0) throw new Error('stageObservable().windows 为空');
  let flips = 0;
  let last = null;
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    last = await T.info(cdp);
    if (!last || last.state !== 'playing') break;
    if (flips < windows.length) {
      const w = windows[flips];
      /* 早窗口触发：留出 ~0.05s 的 CDP 派发延迟余量，仍在 xCenter±tolerance 内。 */
      const triggerX = Math.max(0, w.xCenter - w.tolerancePx + 8);
      if (last.distance >= triggerX) {
        await cdp.tap(210, 370);
        flips += 1;
      }
    }
    await sleep(16);
  }
  const final = await T.info(cdp);
  const observable = await T.observable(cdp);
  return { windows, flips, final, observable };
}

const gravityFlipModule = {
  gameId: 'gravity-flip',
  gameFile: 'gravity-flip.html',
  evidence: 'real-input-replay',
  scenarios: [
    {
      id: 'CH-GF-001',
      title: '重力翻转·挑战数据/入口/6 关选关与锁定',
      evidence: 'ui-only',
      async run(cdp, ctx) {
        const stages = await T.stages(cdp);
        ctx.assert(Array.isArray(stages) && stages.length === 6, 'challengeStages() 不是 6 关：' + JSON.stringify(stages));
        ctx.assert(
          stages.map((s) => s.id).join(',') === 'gravity-flip-C01,gravity-flip-C02,gravity-flip-C03,gravity-flip-C04,gravity-flip-C05,gravity-flip-C06',
          '关卡 id/顺序不符：' + stages.map((s) => s.id).join(',')
        );
        ctx.assert(stages[0].unlocked === true, 'C01 应恒解锁');
        stages.slice(1).forEach((s) => ctx.assert(s.unlocked === false, s.id + ' 初始不应解锁'));
        ctx.assert(stages.every((s) => s.stageNumber >= 1 && s.stageNumber <= 6), 'stageNumber 越界');
        ctx.assert(stages.every((s) => typeof s.title === 'string' && s.title.length > 0), '关卡标题缺失');

        /* 运行时数据字段：每关必须有固定障碍序列、推荐翻转窗口、终点距离 */
        const contentOk = await cdp.evaluate(`(() => {
          const stages = Arcade.Challenge.stages('gravity-flip');
          return stages.map((stage) => {
            const c = stage.content || {};
            return {
              id: stage.id,
              obstacles: Array.isArray(c.obstacles) ? c.obstacles.length : -1,
              windows: Array.isArray(c.recommendedFlipWindows) ? c.recommendedFlipWindows.length : -1,
              distance: c.distanceToFinish,
              speed: c.scrollSpeedPxSec,
              startGravity: c.startGravity,
              hasFinish: typeof c.win === 'string' && c.win.indexOf('finish') !== -1,
            };
          });
        })()`);
        contentOk.forEach((item) => {
          ctx.assert(item.obstacles >= 2, item.id + ' obstacles 少于 2');
          ctx.assert(item.windows >= 1 && item.windows <= item.obstacles, item.id + ' 推荐翻转窗口数异常：' + item.windows);
          ctx.assert(item.distance >= 2000 && item.distance <= 3000, item.id + ' distanceToFinish 越界：' + item.distance);
          ctx.assert(item.speed === 260, item.id + ' scrollSpeedPxSec 应为 260，实际 ' + item.speed);
          ctx.assert(item.startGravity === 'floor', item.id + ' startGravity 应为 floor');
          ctx.assert(item.hasFinish, item.id + ' win 字段不是 pass finish marker alive');
        });

        /* 开始弹层：经典主按钮保持不变 + 第二入口「挑战 6 关」，选关面板初始隐藏 */
        const entry = await cdp.evaluate(`(() => {
          const btn = document.querySelector('[data-ov-btn]');
          const btn2 = document.querySelector('[data-ov-btn2]');
          const panel = document.querySelector('[data-ch-panel]');
          const rect = btn2 ? btn2.getBoundingClientRect() : null;
          return {
            mainText: btn ? btn.textContent.trim() : null,
            btn2Text: btn2 ? btn2.textContent.trim() : null,
            btn2Visible: !!(btn2 && !btn2.hidden && rect && rect.height >= 44),
            panelHidden: panel ? panel.hidden : null,
            panelExists: !!panel,
          };
        })()`);
        ctx.assert(entry.mainText === '开始游戏', '经典主按钮文案被改动：' + entry.mainText);
        ctx.assert(/挑战/.test(entry.btn2Text || ''), '第二入口文案应含「挑战」，实际 ' + entry.btn2Text);
        ctx.assert(entry.btn2Visible, '第二入口不可见或触控高度 <44px');
        ctx.assert(entry.panelExists && entry.panelHidden === true, '选关面板应存在且初始隐藏');

        await cdp.click('[data-ov-btn2]');
        await sleep(120);
        const panel = await cdp.evaluate(`(() => {
          const panel = document.querySelector('[data-ch-panel]');
          const buttons = [...panel.querySelectorAll('[data-stage-id]')];
          return {
            hidden: panel.hidden,
            count: buttons.length,
            states: buttons.map((b) => ({ id: b.dataset.stageId, disabled: b.disabled, locked: b.classList.contains('is-locked'), h: b.getBoundingClientRect().height })),
            back: !!panel.querySelector('[data-ch-back]'),
          };
        })()`);
        ctx.assert(panel.hidden === false, '点击第二入口后选关面板未显示');
        ctx.assert(panel.count === 6, '选关面板按钮数 ' + panel.count + ' ≠ 6');
        ctx.assert(panel.back, '选关面板缺少返回按钮');
        const first = panel.states[0];
        ctx.assert(first.id === 'gravity-flip-C01' && first.disabled === false, 'C01 应可点击');
        panel.states.slice(1).forEach((s) => ctx.assert(s.disabled === true && s.locked === true, s.id + ' 应锁定且 disabled'));
        panel.states.forEach((s) => ctx.assert(s.h >= 44, '关卡按钮触控高度 ' + s.h + ' < 44'));

        /* 锁定关不能开始 */
        const lockedStart = await cdp.evaluate('window.__arcadeTest.startChallenge(2)');
        ctx.assert(lockedStart === false, '锁定关 startChallenge(2) 应返回 false，实际 ' + lockedStart);

        /* 返回开始界面 */
        await cdp.click('[data-ch-back]');
        await sleep(120);
        const back = await cdp.evaluate(`(() => ({
          panelHidden: document.querySelector('[data-ch-panel]').hidden,
          overlayVisible: !document.querySelector('[data-overlay]').hidden,
          title: document.querySelector('[data-ov-title]').textContent,
        }))()`);
        ctx.assert(back.panelHidden === true, '返回后选关面板应隐藏');
        ctx.assert(back.overlayVisible === true && back.title === '重力翻转', '返回后应回到开始弹层');
        return { stages: stages.length, c01Unlocked: stages[0].unlocked, lockedCount: 5, panelButtons: panel.count };
      },
    },
    {
      id: 'CH-GF-002',
      title: '重力翻转·C01 参考通关（真实翻转输入，0 碰撞）',
      evidence: 'real-input-replay',
      async run(cdp, ctx) {
        const run = await playStageWithRecommendedWindows(cdp, 1);
        ctx.assert(run.final.state === 'cleared', 'C01 未通关：' + JSON.stringify(run.final));
        ctx.assert(run.final.cleared === true, 'challengeInfo().cleared 应为 true');
        ctx.assert(run.final.hits === 0, 'C01 参考通关出现碰撞 ' + run.final.hits + ' 次');
        ctx.assert(run.final.lives === 2, 'C01 通关时生命应为 2，实际 ' + run.final.lives);
        ctx.assert(run.final.flipCount === run.windows.length, '翻转次数 ' + run.final.flipCount + ' ≠ 推荐窗口数 ' + run.windows.length);
        ctx.assert(run.flips === run.windows.length, '测试派发的翻转次数 ' + run.flips + ' ≠ ' + run.windows.length);
        ctx.assert(run.final.elapsedSec >= 7 && run.final.elapsedSec <= 12, 'C01 通关用时异常：' + run.final.elapsedSec);
        /* 每次翻转都必须落在 recommendedFlipWindows 的 xCenter±tolerance 内 */
        run.observable.flipLog.forEach((entry, index) => {
          const window = run.windows[index];
          ctx.assert(Math.abs(entry[0] - window.xCenter) <= window.tolerancePx, '第 ' + (index + 1) + ' 次翻转 x=' + entry[0] + ' 超出推荐窗口 ' + JSON.stringify(window));
          ctx.assert(entry[1] === window.toward, '第 ' + (index + 1) + ' 次翻转方向 ' + entry[1] + ' ≠ ' + window.toward);
        });
        ctx.assert(run.observable.obstacles.every((o) => o.passed === true), '通关时仍有障碍未被通过');
        /* 结算与记录 */
        const overlay = run.final.overlay;
        ctx.assert(overlay.visible === true, '通关后结算弹层不可见');
        ctx.assert(overlay.title.indexOf('通关') !== -1, '结算标题异常：' + overlay.title);
        ctx.assert(overlay.btn === '下一关', 'C01 结算主按钮应为「下一关」，实际 ' + overlay.btn);
        const records = await T.stages(cdp);
        ctx.assert(records[0].cleared === true && records[0].best && records[0].best.timeSec > 0, 'C01 记录/最佳未写入');
        ctx.assert(records[1].unlocked === true, 'C01 通关后 C02 应解锁');
        const keys = await cdp.evaluate(`({
          progress: localStorage.getItem('studiokit:arcade:progress:v1'),
          challenge: localStorage.getItem('studiokit:arcade:challenge:v1'),
        })`);
        ctx.assert(keys.progress === null, '挑战通关不应写 progress:v1，实际 ' + keys.progress);
        ctx.assert(keys.challenge && keys.challenge.indexOf('gravity-flip-C01') !== -1, 'challenge:v1 未记录 C01');
        return { cleared: true, hits: 0, flips: run.flips, seconds: run.final.elapsedSec, best: records[0].best.timeSec };
      },
    },
    {
      id: 'CH-GF-003',
      title: '重力翻转·失败路径与一键重试',
      evidence: 'real-input-replay',
      async run(cdp, ctx) {
        const started = await cdp.evaluate('window.__arcadeTest.startChallenge(1)');
        ctx.assert(started === true, 'startChallenge(1) 失败');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 5000 });
        /* 不做任何翻转：o1 撞一次、o3 再撞一次 → 2 条生命耗尽失败 */
        const failed = await waitChallengeState(cdp, 'failed', 20000);
        ctx.assert(failed.failed === true, 'challengeInfo().failed 应为 true');
        ctx.assert(failed.lives === 0, '失败时生命应为 0，实际 ' + failed.lives);
        ctx.assert(failed.hits >= 2, '失败前应至少被撞 2 次，实际 ' + failed.hits);
        const failOverlay = await cdp.evaluate(`(() => ({
          visible: !document.querySelector('[data-overlay]').hidden,
          title: document.querySelector('[data-ov-title]').textContent,
          btn: document.querySelector('[data-ov-btn]').textContent.trim(),
          btn2: document.querySelector('[data-ov-btn2]').hidden ? null : document.querySelector('[data-ov-btn2]').textContent.trim(),
          text: document.querySelector('[data-ov-text]').textContent,
        }))()`);
        ctx.assert(failOverlay.visible === true, '失败后弹层不可见');
        ctx.assert(failOverlay.title.indexOf('失败') !== -1, '失败标题异常：' + failOverlay.title);
        ctx.assert(failOverlay.btn === '重试本关', '失败主按钮应为「重试本关」，实际 ' + failOverlay.btn);
        ctx.assert(failOverlay.btn2 === '返回选关', '失败次按钮应为「返回选关」');
        ctx.assert(failOverlay.text.indexOf('提示') !== -1, '失败文案缺少可归因提示');
        /* 1 次点击重试 */
        await cdp.click('[data-ov-btn]');
        const playing = await waitChallengeState(cdp, 'playing', 5000);
        ctx.assert(playing.stageId === 'gravity-flip-C01', '重试后 stageId 应为 C01，实际 ' + playing.stageId);
        ctx.assert(playing.lives === 2, '重试后生命应重置为 2，实际 ' + playing.lives);
        ctx.assert(playing.elapsedSec <= 1.5, '重试后 elapsed 未重置：' + playing.elapsedSec);
        const afterRetry = await T.stages(cdp);
        ctx.assert(afterRetry[0].cleared === false, '失败不应把 C01 记为已通关');
        return { failed: true, hits: failed.hits, retried: true, retryElapsed: playing.elapsedSec };
      },
    },
    {
      id: 'CH-GF-004',
      title: '重力翻转·暂停/退出挑战/刷新恢复同一关',
      evidence: 'real-input-replay',
      async run(cdp, ctx) {
        const started = await cdp.evaluate('window.__arcadeTest.startChallenge(1)');
        ctx.assert(started === true, 'startChallenge(1) 失败');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 5000 });
        await sleep(1400);
        await cdp.key('p');
        const paused = await waitChallengeState(cdp, 'paused', 4000);
        ctx.assert(paused.distance > 150, '暂停前应已前进一段距离，实际 ' + paused.distance);
        const pauseOverlay = await cdp.evaluate(`(() => ({
          title: document.querySelector('[data-ov-title]').textContent,
          btn2: document.querySelector('[data-ov-btn2]').hidden ? null : document.querySelector('[data-ov-btn2]').textContent.trim(),
        }))()`);
        ctx.assert(pauseOverlay.title.indexOf('暂停') !== -1, '暂停标题异常：' + pauseOverlay.title);
        ctx.assert(pauseOverlay.btn2 === '退出挑战', '挑战暂停的次按钮应为「退出挑战」，实际 ' + pauseOverlay.btn2);
        /* 重新加载页面（同一 URL + #test）→ 应出现「继续上次？」恢复提示 */
        const url = await cdp.evaluate('location.href');
        const reloadUrl = url.replace('#test', '&reload=' + Date.now() + '#test');
        await cdp.navigate(reloadUrl);
        await sleep(500);
        const prompt = await cdp.evaluate(`(() => ({
          visible: !document.querySelector('[data-overlay]').hidden,
          title: document.querySelector('[data-ov-title]').textContent,
          btn: document.querySelector('[data-ov-btn]').textContent.trim(),
        }))()`);
        ctx.assert(prompt.visible === true && prompt.title === '继续上次？', '刷新后未出现恢复提示：' + JSON.stringify(prompt));
        ctx.assert(prompt.btn === '继续上次', '恢复提示主按钮异常：' + prompt.btn);
        await cdp.click('[data-ov-btn]');
        const resumed = await waitChallengeState(cdp, 'playing', 6000);
        ctx.assert(resumed.mode === 'challenge', '恢复后后台模式不是 challenge：' + resumed.mode);
        ctx.assert(resumed.stageId === 'gravity-flip-C01', '恢复后关卡不是 C01：' + resumed.stageId);
        ctx.assert(resumed.elapsedSec >= paused.elapsedSec - 0.3, '恢复后用时回退：' + resumed.elapsedSec + ' < ' + paused.elapsedSec);
        ctx.assert(resumed.distance >= paused.distance - 8, '恢复后距离回退：' + resumed.distance + ' < ' + paused.distance);
        /* 暂停 → 退出挑战：回到开始界面且恢复经典模式 */
        await sleep(300);
        await cdp.key('p');
        await waitChallengeState(cdp, 'paused', 4000);
        await cdp.click('[data-ov-btn2]');
        await sleep(200);
        const exited = await cdp.evaluate(`(() => ({
          overlayTitle: document.querySelector('[data-ov-title]').textContent,
          panelHidden: document.querySelector('[data-ch-panel]').hidden,
          mode: window.__arcadeTest.info().mode,
          state: window.__arcadeTest.info().state,
        }))()`);
        ctx.assert(exited.mode === 'classic', '退出挑战后 mode 应回到 classic，实际 ' + exited.mode);
        ctx.assert(exited.overlayTitle === '重力翻转', '退出挑战后应回到开始弹层，实际 ' + exited.overlayTitle);
        ctx.assert(exited.panelHidden === true, '退出挑战后选关面板应隐藏');
        return { pausedDistance: paused.distance, resumedDistance: resumed.distance, resumeElapsed: resumed.elapsedSec, exitedMode: exited.mode };
      },
    },
    {
      id: 'CH-GF-005',
      title: '重力翻转·记录/解锁/assisted/经典隔离',
      evidence: 'ui-only',
      async run(cdp, ctx) {
        const started = await cdp.evaluate('window.__arcadeTest.startChallenge(1)');
        ctx.assert(started === true, 'startChallenge(1) 失败');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 5000 });
        const forced = await cdp.evaluate('window.__arcadeTest.forceStageClear(false)');
        ctx.assert(forced === true, 'forceStageClear(false) 失败');
        await sleep(120);
        const clearedInfo = await T.info(cdp);
        ctx.assert(clearedInfo.cleared === true, '跳过结算后 cleared 应为 true');
        let stages = await T.stages(cdp);
        ctx.assert(stages[0].cleared === true && stages[0].best && stages[0].best.assisted === false, 'C01 记录/assisted 异常：' + JSON.stringify(stages[0]));
        ctx.assert(stages[1].unlocked === true, 'C01 通关后 C02 未解锁');
        const progressAfter = await cdp.evaluate(`localStorage.getItem('studiokit:arcade:progress:v1')`);
        ctx.assert(progressAfter === null, '挑战不得写经典最高分 progress:v1');

        /* C02 用 assisted 结算：记录带辅助标记，结算 UI 出现「辅助」徽章 */
        const started2 = await cdp.evaluate('window.__arcadeTest.startChallenge(2)');
        ctx.assert(started2 === true, 'C02 解锁后 startChallenge(2) 失败');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 5000 });
        const forced2 = await cdp.evaluate('window.__arcadeTest.forceStageClear(true)');
        ctx.assert(forced2 === true, 'forceStageClear(true) 失败');
        await sleep(120);
        stages = await T.stages(cdp);
        ctx.assert(stages[1].cleared === true && stages[1].best && stages[1].best.assisted === true, 'C02 assisted 记录异常：' + JSON.stringify(stages[1]));
        const resultHtml = await cdp.evaluate(`document.querySelector('[data-ov-text]').innerHTML`);
        ctx.assert(resultHtml.indexOf('ac-assisted-badge') !== -1, 'assisted 结算未显示「辅助」徽章');
        ctx.assert(stages[2].unlocked === true, 'C02 通关后 C03 未解锁');
        const challengeKey = await cdp.evaluate(`localStorage.getItem('studiokit:arcade:challenge:v1')`);
        ctx.assert(challengeKey && challengeKey.indexOf('gravity-flip-C02') !== -1, 'challenge:v1 未记录 C02');
        const exported = await cdp.evaluate('Arcade.Challenge.progress("gravity-flip")');
        ctx.assert(exported.cleared.length === 2, 'challenge 进度 cleared 应为 2，实际 ' + JSON.stringify(exported.cleared));
        return { cleared: exported.cleared, c02Assisted: stages[1].best.assisted, c03Unlocked: stages[2].unlocked };
      },
    },
    {
      id: 'CH-GF-006',
      title: '重力翻转·经典回归 + 320/390 无横向溢出',
      evidence: 'ui-only',
      async run(cdp, ctx) {
        /* 经典主按钮仍启动经典模式 */
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.info().state === "playing"', { timeout: 6000 });
        const classic = await cdp.evaluate(`(() => {
          const info = window.__arcadeTest.info();
          const hud = [...document.querySelectorAll('.game-hud > span')];
          return {
            mode: info.mode,
            state: info.state,
            lives: info.lives,
            chHudHidden: document.querySelector('[data-ch-hud]').hidden,
            classicHudHidden: hud.every((el) => el.hidden),
            toolsVisible: (document.querySelector('[data-game-tools]').style.display !== 'none'),
            panelHidden: document.querySelector('[data-ch-panel]').hidden,
          };
        })()`);
        ctx.assert(classic.mode === 'classic', '经典主按钮进入的不是 classic：' + classic.mode);
        ctx.assert(classic.state === 'playing', '经典模式未进入 playing');
        ctx.assert(classic.lives === 3, '经典生命应为 3，实际 ' + classic.lives);
        ctx.assert(classic.chHudHidden === true, '经典模式不应显示挑战 HUD');
        ctx.assert(classic.classicHudHidden === false, '经典模式经典 HUD 被隐藏');
        ctx.assert(classic.toolsVisible === true, '经典模式道具区被隐藏');
        ctx.assert(classic.panelHidden === true, '经典模式选关面板不应显示');

        /* 挑战模式 HUD/道具区切换 */
        await cdp.evaluate('window.__arcadeTest.exitChallenge()');
        await cdp.evaluate('window.__arcadeTest.startChallenge(1)');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 5000 });
        const chUi = await cdp.evaluate(`(() => ({
          chHudHidden: document.querySelector('[data-ch-hud]').hidden,
          classicHudHidden: [...document.querySelectorAll('.game-hud > span')].every((el) => el.hidden),
          toolsDisplay: document.querySelector('[data-game-tools]').style.display,
          toolsDisabled: [...document.querySelectorAll('[data-game-tools] button')].every((b) => b.disabled),
        }))()`);
        ctx.assert(chUi.chHudHidden === false, '挑战模式挑战 HUD 未显示');
        ctx.assert(chUi.classicHudHidden === true, '挑战模式经典 HUD 未隐藏');
        ctx.assert(chUi.toolsDisplay === 'none', '挑战模式道具区未隐藏');
        ctx.assert(chUi.toolsDisabled === true, '挑战模式道具按钮未禁用');

        /* 320×568 与 390×844 无横向溢出，按钮 ≥44px */
        const viewports = [
          { width: 320, height: 568 },
          { width: 390, height: 844 },
        ];
        const results = [];
        for (const vp of viewports) {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: true });
          await sleep(220);
          await cdp.evaluate('window.__arcadeTest.exitChallenge()');
          await sleep(150);
          const uiState = await cdp.evaluate(`({ panel: !document.querySelector('[data-ch-panel]').hidden, overlay: !document.querySelector('[data-overlay]').hidden })`);
          if (uiState.panel) {
            await cdp.click('[data-ch-back]');
            await sleep(150);
          }
          const entryMetrics = await cdp.evaluate(`(() => {
            const btn2 = document.querySelector('[data-ov-btn2]');
            const rect = btn2 ? btn2.getBoundingClientRect() : null;
            return { visible: !!(btn2 && !btn2.hidden && rect && rect.height >= 44), height: rect ? rect.height : 0 };
          })()`);
          ctx.assert(entryMetrics.visible, vp.width + 'px 开始弹层入口不可见或高度 <44：' + JSON.stringify(entryMetrics));
          await cdp.click('[data-ov-btn2]');
          await sleep(150);
          const layout = await cdp.evaluate(`(() => {
            const stageBtns = [...document.querySelectorAll('[data-stage-id]')];
            const panel = document.querySelector('.ac-challenge-panel');
            const root = document.documentElement;
            return {
              overflow: root.scrollWidth - window.innerWidth,
              panelOverflow: panel ? panel.scrollWidth - panel.clientWidth : 0,
              stageBtnMin: Math.min(...stageBtns.map((b) => b.getBoundingClientRect().height)),
              stageBtnWidthMax: Math.max(...stageBtns.map((b) => b.getBoundingClientRect().width)),
              panelWidth: panel ? panel.getBoundingClientRect().width : 0,
            };
          })()`);
          ctx.assert(layout.overflow <= 1, vp.width + 'px 横向溢出 ' + layout.overflow + 'px');
          ctx.assert(layout.panelOverflow <= 1, vp.width + 'px 选关面板内部横向溢出 ' + layout.panelOverflow + 'px');
          ctx.assert(layout.stageBtnMin >= 44, vp.width + 'px 关卡按钮高度 ' + layout.stageBtnMin + ' < 44');
          ctx.assert(layout.panelWidth <= vp.width, vp.width + 'px 选关面板宽 ' + layout.panelWidth + ' 超出视口');
          results.push({ vp: vp.width, overflow: layout.overflow, stageBtnMin: layout.stageBtnMin });
        }
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });
        await sleep(150);
        return { classicMode: classic.mode, classicLives: classic.lives, layouts: results };
      },
    },
    {
      id: 'CH-GF-007',
      title: '重力翻转·C02–C06 逐关可达性回放（真实引擎物理）',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const results = [];
        for (let ref = 1; ref <= 6; ref += 1) {
          const replay = await cdp.evaluate('window.__arcadeTest.challengeReplayFlip(' + ref + ')');
          ctx.assert(replay && replay.cleared === true, 'C0' + ref + ' 引擎回放未通关：' + JSON.stringify(replay));
          ctx.assert(replay.hits === 0, 'C0' + ref + ' 回放出现碰撞 ' + replay.hits + ' 次');
          ctx.assert(replay.lives === 2, 'C0' + ref + ' 回放后生命 ' + replay.lives + ' ≠ 2');
          ctx.assert(replay.flips === replay.windows, 'C0' + ref + ' 翻转数 ' + replay.flips + ' ≠ 窗口数 ' + replay.windows);
          ctx.assert(replay.seconds >= 7 && replay.seconds <= 12, 'C0' + ref + ' 回放用时异常：' + replay.seconds);
          results.push({ stage: replay.stageId, seconds: replay.seconds, hits: replay.hits, flips: replay.flips });
          await sleep(80);
        }
        const stages = await T.stages(cdp);
        ctx.assert(stages.every((s) => s.cleared === true), 'C01–C06 未全部记为已通关：' + JSON.stringify(stages.map((s) => s.cleared)));
        const progressKey = await cdp.evaluate(`localStorage.getItem('studiokit:arcade:progress:v1')`);
        ctx.assert(progressKey === null, '6 关回放不得写经典 progress:v1');
        return { clearedStages: results.length, results };
      },
    },  ],
};

export default gravityFlipModule;
