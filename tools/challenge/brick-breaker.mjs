/**
 * 0.9 挑战模式确定性场景 · 砖块计划（brick-breaker C01–C06）
 * ============================================================================
 * 证据等级：engine-replay（全关清场）+ real-input（输入/挡板/发球路径）
 *   - 没有把“物理弹道清场”包装成 real-input：清场证据来自页面内 #test 钩子
 *     `challengeReplayClear(stage)`，它用固定 1/60 步长驱动**同一份** update 物理，
 *     挡板由确定性瞄准控制器移动（真实玩家可用偏心接球近似），因此标注 engine-replay。
 *   - 参考通关仍用真实指针：拖挡板、点击发球、球真实飞行/反弹；随后再做确定性回放清场。
 *   - C03/C06 的 K 钥匙砖修正见 impl 文档「设计差异」（撞击未解锁 G 门会震落正上方 K）。
 * 真机（iOS/Android）未测：UNVERIFIED。
 * 运行：
 *   node tools/arcade_gameplay_test.mjs --game=brick-breaker --repeat=2
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const T = {
  info: (cdp) => cdp.evaluate('window.__arcadeTest.challengeInfo()'),
  stages: (cdp) => cdp.evaluate('window.__arcadeTest.challengeStages()'),
  observable: (cdp) => cdp.evaluate('window.__arcadeTest.stageObservable()'),
};

async function waitChallengeState(cdp, wanted, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
  let last = null;
  while (Date.now() < deadline) {
    last = await T.info(cdp);
    if (last && last.state === wanted) return last;
    await sleep(25);
  }
  throw new Error('等待挑战 state=' + wanted + ' 超时；最后=' + JSON.stringify(last));
}

async function startStage(cdp, ref) {
  const started = await cdp.evaluate('window.__arcadeTest.startChallenge(' + JSON.stringify(ref) + ')');
  if (started !== true) throw new Error('startChallenge(' + JSON.stringify(ref) + ') 返回 ' + started);
  await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
  return T.info(cdp);
}

/** 真实输入：拖动挡板移动到指定逻辑 x；再点击发球。 */
async function dragPaddleTo(cdp, logicalX) {
  await cdp.drag(210, 640, Math.max(24, Math.min(396, logicalX)), 640);
}

const brickBreakerModule = {
  gameId: 'brick-breaker',
  gameFile: 'brick-breaker.html',
  evidence: 'engine-replay',
  scenarios: [
    {
      id: 'CH-BB-001',
      title: '砖块计划·挑战数据/入口/6 关选关与锁定',
      evidence: 'ui-only',
      async run(cdp, ctx) {
        const stages = await T.stages(cdp);
        ctx.assert(Array.isArray(stages) && stages.length === 6, 'challengeStages() 不是 6 关');
        ctx.assert(
          stages.map((s) => s.id).join(',') ===
            'brick-breaker-C01,brick-breaker-C02,brick-breaker-C03,brick-breaker-C04,brick-breaker-C05,brick-breaker-C06',
          '关卡 id/顺序不符：' + stages.map((s) => s.id).join(',')
        );
        ctx.assert(stages[0].unlocked === true, 'C01 应恒解锁');
        stages.slice(1).forEach((s) => ctx.assert(s.unlocked === false, s.id + ' 初始不应解锁'));

        const content = await cdp.evaluate(`(() => Arcade.Challenge.stages('brick-breaker').map((stage) => {
          const c = stage.content || {};
          return {
            id: stage.id,
            rows: Array.isArray(c.brickRows) ? c.brickRows.length : -1,
            cols: Array.isArray(c.brickRows) && c.brickRows[0] ? c.brickRows[0].length : -1,
            tokens: Array.isArray(c.brickRows) ? c.brickRows.join('') : '',
            speed: c.ball && c.ball.speed,
            paddleW: c.ball && c.ball.paddleWidth,
            lives: c.ball && c.ball.lives,
            winType: c.win && c.win.type,
            recovery: c.stuckBallRecovery && c.stuckBallRecovery.ifNoBrickContactSec,
          };
        }))()`);
        content.forEach((item) => {
          ctx.assert(item.rows === 5, item.id + ' brickRows 行数 ' + item.rows + ' ≠ 5');
          ctx.assert(item.cols === 8, item.id + ' brickRows 列数 ' + item.cols + ' ≠ 8');
          ctx.assert(/^[123KG.]+$/.test(item.tokens), item.id + ' 砖阵含非法符号');
          ctx.assert(item.speed >= 200 && item.speed <= 400, item.id + ' 球速越界：' + item.speed);
          ctx.assert(item.paddleW >= 60 && item.paddleW <= 120, item.id + ' 挡板宽越界：' + item.paddleW);
          ctx.assert(item.lives === 3, item.id + ' 生命应为 3');
          ctx.assert(item.winType === 'destroy_all_breakable_including_unlocked_gates', item.id + ' win.type 不符');
          ctx.assert(item.recovery === 12, item.id + ' stuckBallRecovery 应为 12s');
        });
        /* K/G 成对：有 G 关必须有 K（与设计校验一致） */
        const gateStages = content.filter((item) => item.tokens.indexOf('G') !== -1);
        gateStages.forEach((item) => ctx.assert(item.tokens.indexOf('K') !== -1, item.id + ' 有 G 无 K'));

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
        ctx.assert(/挑战/.test(entry.btn2Text || ''), '第二入口文案应含「挑战」');
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
        ctx.assert(panel.count === 6, '选关按钮数 ' + panel.count + ' ≠ 6');
        ctx.assert(panel.back, '选关面板缺少返回按钮');
        ctx.assert(panel.states[0].id === 'brick-breaker-C01' && panel.states[0].disabled === false, 'C01 应可点击');
        panel.states.slice(1).forEach((s) => ctx.assert(s.disabled === true && s.locked === true, s.id + ' 应锁定'));
        panel.states.forEach((s) => ctx.assert(s.h >= 44, '关卡按钮触控高度 ' + s.h + ' < 44'));
        const lockedStart = await cdp.evaluate('window.__arcadeTest.startChallenge(3)');
        ctx.assert(lockedStart === false, '锁定关 startChallenge(3) 应返回 false');
        await cdp.click('[data-ch-back]');
        await sleep(120);
        const back = await cdp.evaluate(`({
          panelHidden: document.querySelector('[data-ch-panel]').hidden,
          overlayVisible: !document.querySelector('[data-overlay]').hidden,
          title: document.querySelector('[data-ov-title]').textContent,
        })`);
        ctx.assert(back.panelHidden === true && back.overlayVisible === true && back.title === '砖块计划', '返回开始界面失败：' + JSON.stringify(back));
        return { stages: stages.length, gateStages: gateStages.map((s) => s.id), panelButtons: panel.count };
      },
    },
    {
      id: 'CH-BB-002',
      title: '砖块计划·C01 参考通关（真实输入 + engine-replay 清场）',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const started = await startStage(cdp, 1);
        ctx.assert(started.remaining === 22, 'C01 初始剩余砖数应为 22，实际 ' + started.remaining);
        /* 真实指针：偏心拖动挡板 + 点击发球，球真实飞行并击砖 */
        await dragPaddleTo(cdp, 300);
        await sleep(120);
        const paddlePos = await cdp.evaluate('window.__arcadeTest.stageObservable().paddle');
        ctx.assert(Math.abs(paddlePos.x + paddlePos.w / 2 - 300) <= 40, '挡板未跟随指针到 300 附近：' + JSON.stringify(paddlePos));
        await cdp.tap(210, 640);
        await sleep(500);
        const afterLaunch = await T.info(cdp);
        ctx.assert(afterLaunch.launched === true, '点击后未发球');
        const moved = await cdp.evaluate(`(() => {
          const s = window.__arcadeTest.stageObservable();
          return { bx: s.ball.x, by: s.ball.y, remaining: s.remaining };
        })()`);
        ctx.assert(moved.by < 630, '发球后球未离开挡板：' + JSON.stringify(moved));
        /* 确定性回放：同一关从头用引擎物理 + 确定性挡板控制器清场 */
        const replay = await cdp.evaluate('window.__arcadeTest.challengeReplayClear(1)');
        ctx.assert(replay && replay.cleared === true, 'C01 engine-replay 未清场：' + JSON.stringify(replay));
        ctx.assert(replay.remaining === 0, '回放结束仍有 ' + replay.remaining + ' 块砖');
        ctx.assert(replay.lives === 3, '回放过程丢命：lives=' + replay.lives);
        ctx.assert(replay.maxNoBrickSec < 12, '回放出现 >12s 无砖接触（可能空转）：' + replay.maxNoBrickSec);
        ctx.assert(replay.recoveries <= 4, '回放触发空转微调次数过多：' + replay.recoveries);
        ctx.assert(replay.winType === 'destroy_all_breakable_including_unlocked_gates', 'winType 不符：' + replay.winType);
        const info = await T.info(cdp);
        ctx.assert(info.state === 'cleared' && info.cleared === true, '回放后未进入 cleared 状态');
        ctx.assert(info.overlay.visible === true && info.overlay.btn === '下一关', '结算弹层/主按钮异常：' + JSON.stringify(info.overlay));
        const records = await T.stages(cdp);
        ctx.assert(records[0].cleared === true && records[0].best && records[0].best.timeSec > 0, 'C01 记录未写入');
        ctx.assert(records[1].unlocked === true, 'C01 通关后 C02 未解锁');
        const progressKey = await cdp.evaluate(`localStorage.getItem('studiokit:arcade:progress:v1')`);
        ctx.assert(progressKey === null, '挑战通关不应写经典 progress:v1');
        return { cleared: true, seconds: replay.seconds, launches: replay.launches, maxNoBrickSec: replay.maxNoBrickSec, realInputLaunched: afterLaunch.launched };
      },
    },
    {
      id: 'CH-BB-003',
      title: '砖块计划·失败路径（真实丢球）与一键重试',
      evidence: 'real-input-replay',
      async run(cdp, ctx) {
        await startStage(cdp, 1);
        /* 真实失败：发球后把挡板拖走，连续丢 3 球 → 挑战失败 */
        let last = null;
        for (let i = 0; i < 3; i += 1) {
          last = await T.info(cdp);
          if (last.state !== 'playing') break;
          await cdp.tap(210, 640);
          await sleep(120);
          await dragPaddleTo(cdp, 40);
          const before = last.lives;
          const deadline = Date.now() + 12000;
          while (Date.now() < deadline) {
            last = await T.info(cdp);
            if (last.state !== 'playing' || last.lives < before) break;
            await sleep(40);
          }
        }
        const failed = await waitChallengeState(cdp, 'failed', 8000);
        ctx.assert(failed.failed === true, '挑战未进入 failed');
        ctx.assert(failed.lives === 0, '失败时生命应为 0，实际 ' + failed.lives);
        const failOverlay = await cdp.evaluate(`(() => ({
          visible: !document.querySelector('[data-overlay]').hidden,
          title: document.querySelector('[data-ov-title]').textContent,
          btn: document.querySelector('[data-ov-btn]').textContent.trim(),
          btn2: document.querySelector('[data-ov-btn2]').hidden ? null : document.querySelector('[data-ov-btn2]').textContent.trim(),
          text: document.querySelector('[data-ov-text]').textContent,
        }))()`);
        ctx.assert(failOverlay.visible === true, '失败弹层不可见');
        ctx.assert(failOverlay.title.indexOf('失败') !== -1, '失败标题异常：' + failOverlay.title);
        ctx.assert(failOverlay.btn === '重试本关', '失败主按钮应为「重试本关」，实际 ' + failOverlay.btn);
        ctx.assert(failOverlay.btn2 === '返回选关', '失败次按钮应为「返回选关」');
        ctx.assert(failOverlay.text.indexOf('提示') !== -1, '失败文案缺少提示');
        this.retryOverlayRect = null;
        await cdp.click('[data-ov-btn]');
        const retried = await waitChallengeState(cdp, 'playing', 6000);
        ctx.assert(retried.stageId === 'brick-breaker-C01', '重试后关卡应为 C01，实际 ' + retried.stageId);
        ctx.assert(retried.lives === 3, '重试后生命应重置为 3，实际 ' + retried.lives);
        ctx.assert(retried.remaining === 22, '重试后砖阵应重置为 22，实际 ' + retried.remaining);
        ctx.assert(retried.elapsedSec <= 1.5, '重试后 elapsed 未重置：' + retried.elapsedSec);
        return { failed: true, livesAtFail: failed.lives, retried: true, retryRemaining: retried.remaining };
      },
    },
    {
      id: 'CH-BB-004',
      title: '砖块计划·暂停/退出挑战/刷新恢复同一关',
      evidence: 'real-input-replay',
      async run(cdp, ctx) {
        await startStage(cdp, 1);
        await cdp.tap(210, 640);
        await sleep(1600);
        await cdp.key('p');
        const paused = await waitChallengeState(cdp, 'paused', 4000);
        ctx.assert(paused.launched === true, '暂停前应已发球');
        const pausedObs = await cdp.evaluate('window.__arcadeTest.stageObservable()');
        const pausedPaddleX = pausedObs.paddle.x;
        const pauseOverlay = await cdp.evaluate(`({
          title: document.querySelector('[data-ov-title]').textContent,
          btn2: document.querySelector('[data-ov-btn2]').hidden ? null : document.querySelector('[data-ov-btn2]').textContent.trim(),
        })`);
        ctx.assert(pauseOverlay.title.indexOf('暂停') !== -1, '暂停标题异常：' + pauseOverlay.title);
        ctx.assert(pauseOverlay.btn2 === '退出挑战', '挑战暂停次按钮应为「退出挑战」');
        const url = await cdp.evaluate('location.href');
        const reloadUrl = url.replace('#test', '&reload=' + Date.now() + '#test');
        await cdp.navigate(reloadUrl);
        await sleep(500);
        const prompt = await cdp.evaluate(`({
          visible: !document.querySelector('[data-overlay]').hidden,
          title: document.querySelector('[data-ov-title]').textContent,
          btn: document.querySelector('[data-ov-btn]').textContent.trim(),
        })`);
        ctx.assert(prompt.visible === true && prompt.title === '继续上次？', '刷新后未出现恢复提示：' + JSON.stringify(prompt));
        await cdp.click('[data-ov-btn]');
        const resumed = await waitChallengeState(cdp, 'playing', 6000);
        ctx.assert(resumed.mode === 'challenge', '恢复后 mode 不是 challenge：' + resumed.mode);
        ctx.assert(resumed.stageId === 'brick-breaker-C01', '恢复后关卡不是 C01：' + resumed.stageId);
        ctx.assert(resumed.elapsedSec >= paused.elapsedSec - 0.3, '恢复后用时回退：' + resumed.elapsedSec + ' < ' + paused.elapsedSec);
        ctx.assert(resumed.remaining === paused.remaining, '恢复后剩余砖数不一致：' + resumed.remaining + ' vs ' + paused.remaining);
        const paddleResume = await cdp.evaluate('window.__arcadeTest.stageObservable().paddle');
        ctx.assert(Math.abs(paddleResume.x - pausedPaddleX) < 0.5, '恢复后挡板位置不一致');
        /* 暂停 → 退出挑战 */
        await sleep(250);
        await cdp.key('p');
        const paused2 = await waitChallengeState(cdp, 'paused', 4000);
        const paddlePaused = await cdp.evaluate('window.__arcadeTest.stageObservable().paddle');
        ctx.assert(Math.abs(paddlePaused.x - pausedPaddleX) < 0.5, '暂停期间挡板位置发生变化');
        ctx.assert(paused2.remaining === paused.remaining, '暂停期间剩余砖数变化');
        await cdp.click('[data-ov-btn2]');
        await sleep(200);
        const exited = await cdp.evaluate(`({
          overlayTitle: document.querySelector('[data-ov-title]').textContent,
          mode: window.__arcadeTest.info().mode,
          state: window.__arcadeTest.info().state,
        })`);
        ctx.assert(exited.mode === 'classic', '退出挑战后 mode 应回到 classic，实际 ' + exited.mode);
        ctx.assert(exited.overlayTitle === '砖块计划' && exited.state === 'ready', '退出挑战后应回开始弹层：' + JSON.stringify(exited));
        return { pausedElapsed: paused.elapsedSec, resumedElapsed: resumed.elapsedSec, resumedRemaining: resumed.remaining };
      },
    },
    {
      id: 'CH-BB-005',
      title: '砖块计划·记录/解锁/assisted/经典隔离',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        await startStage(cdp, 1);
        const clear1 = await cdp.evaluate('window.__arcadeTest.challengeReplayClear(1)');
        ctx.assert(clear1 && clear1.cleared === true, 'C01 回放清场失败');
        await sleep(120);
        let stages = await T.stages(cdp);
        ctx.assert(stages[0].cleared === true && stages[0].best && stages[0].best.assisted === false, 'C01 记录异常');
        ctx.assert(stages[1].unlocked === true, 'C01 后 C02 未解锁');
        const progressKey = await cdp.evaluate(`localStorage.getItem('studiokit:arcade:progress:v1')`);
        ctx.assert(progressKey === null, '挑战不得写 progress:v1');
        /* C02 用既有目标（真实物理回放）解锁 C03 */
        const clear2 = await cdp.evaluate('window.__arcadeTest.startChallenge(2)');
        ctx.assert(clear2 === true, 'C02 解锁后无法开始');
        const replay2 = await cdp.evaluate('window.__arcadeTest.challengeReplayClear(2)');
        ctx.assert(replay2 && replay2.cleared === true, 'C02 回放清场失败');
        await sleep(120);
        stages = await T.stages(cdp);
        ctx.assert(stages[2].unlocked === true, 'C02 后 C03 未解锁');
        /* C03 用 assisted 结算：记录带辅助标记 + 结算显示「辅助」徽章 */
        const started3 = await cdp.evaluate('window.__arcadeTest.startChallenge(3)');
        ctx.assert(started3 === true, 'C03 解锁后无法开始');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        const forced = await cdp.evaluate('window.__arcadeTest.forceStageClear(true)');
        ctx.assert(forced === true, 'forceStageClear(true) 失败');
        await sleep(120);
        stages = await T.stages(cdp);
        ctx.assert(stages[2].cleared === true && stages[2].best && stages[2].best.assisted === true, 'C03 assisted 记录异常：' + JSON.stringify(stages[2]));
        const resultHtml = await cdp.evaluate(`document.querySelector('[data-ov-text]').innerHTML`);
        ctx.assert(resultHtml.indexOf('ac-assisted-badge') !== -1, 'assisted 结算未显示「辅助」徽章');
        const challengeKey = await cdp.evaluate(`localStorage.getItem('studiokit:arcade:challenge:v1')`);
        ctx.assert(challengeKey && challengeKey.indexOf('brick-breaker-C03') !== -1, 'challenge:v1 未记录 C03');
        return { cleared: [stages[0].cleared, stages[1].cleared, stages[2].cleared], c03Assisted: stages[2].best.assisted, c04Unlocked: stages[3].unlocked };
      },
    },
    {
      id: 'CH-BB-006',
      title: '砖块计划·经典回归 + 320/390 无横向溢出',
      evidence: 'ui-only',
      async run(cdp, ctx) {
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.info().state === "playing"', { timeout: 6000 });
        const classic = await cdp.evaluate(`(() => {
          const info = window.__arcadeTest.info();
          return {
            mode: info.mode,
            state: info.state,
            level: info.level,
            lives: info.lives,
            bricks: info.bricks.length,
            chHudHidden: document.querySelector('[data-ch-hud]').hidden,
            classicHudHidden: [...document.querySelectorAll('.game-hud > span')].every((el) => el.hidden),
            toolsVisible: (document.querySelector('.game-tools') ? document.querySelector('.game-tools').style.display !== 'none' : true),
            panelHidden: document.querySelector('[data-ch-panel]').hidden,
            launched: info.launched,
          };
        })()`);
        ctx.assert(classic.mode === 'classic', '经典主按钮进入的不是 classic：' + classic.mode);
        ctx.assert(classic.state === 'playing' && classic.level === 1, '经典模式未进入第 1 关 playing');
        ctx.assert(classic.lives === 3 && classic.bricks > 0, '经典开局状态异常：' + JSON.stringify(classic));
        ctx.assert(classic.chHudHidden === true, '经典模式不应显示挑战 HUD');
        ctx.assert(classic.classicHudHidden === false, '经典模式经典 HUD 被隐藏');
        ctx.assert(classic.panelHidden === true, '经典模式选关面板不应显示');

        /* 挑战模式：挑战 HUD 显示、经典 HUD 隐藏、经典道具栏隐藏 */
        await cdp.evaluate('window.__arcadeTest.exitChallenge()');
        await cdp.evaluate('window.__arcadeTest.startChallenge(1)');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        const chUi = await cdp.evaluate(`(() => {
          const tool = document.querySelector('.game-tools');
          return {
            chHudHidden: document.querySelector('[data-ch-hud]').hidden,
            classicHudHidden: [...document.querySelectorAll('.game-hud > span')].every((el) => el.hidden),
            toolsDisplay: tool ? tool.style.display : 'missing',
          };
        })()`);
        ctx.assert(chUi.chHudHidden === false, '挑战模式挑战 HUD 未显示');
        ctx.assert(chUi.classicHudHidden === true, '挑战模式经典 HUD 未隐藏');
        ctx.assert(chUi.toolsDisplay === 'none', '挑战模式经典道具栏未隐藏：' + chUi.toolsDisplay);

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
        return { classicMode: classic.mode, classicBricks: classic.bricks, layouts: results };
      },
    },
    {
      id: 'CH-BB-007',
      title: '砖块计划·C01–C06 逐关 engine-replay 清场与解锁链',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const results = [];
        for (let ref = 1; ref <= 6; ref += 1) {
          const replay = await cdp.evaluate('window.__arcadeTest.challengeReplayClear(' + ref + ')');
          ctx.assert(replay && replay.cleared === true, 'C0' + ref + ' engine-replay 未清场：' + JSON.stringify(replay));
          ctx.assert(replay.remaining === 0, 'C0' + ref + ' 回放结束仍有 ' + (replay.remaining) + ' 块砖');
          ctx.assert(replay.lives === 3, 'C0' + ref + ' 回放丢命：lives=' + replay.lives);
          ctx.assert(replay.maxNoBrickSec <= 12.5, 'C0' + ref + ' 出现 >12s 无砖接触：' + replay.maxNoBrickSec);
          ctx.assert(replay.recoveries <= 6, 'C0' + ref + ' 空转微调次数过多：' + replay.recoveries);
          ctx.assert(replay.seconds <= 180, 'C0' + ref + ' 回放用时 ' + replay.seconds + 's 超出目标上限');
          results.push({ stage: replay.stageId, seconds: replay.seconds, launches: replay.launches, maxNoBrickSec: replay.maxNoBrickSec, recoveries: replay.recoveries });
          await sleep(80);
        }
        const stages = await T.stages(cdp);
        ctx.assert(stages.every((s) => s.cleared === true), 'C01–C06 未全部记为已通关');
        const progressKey = await cdp.evaluate(`localStorage.getItem('studiokit:arcade:progress:v1')`);
        ctx.assert(progressKey === null, '6 关回放不得写经典 progress:v1');
        return { clearedStages: results.length, results };
      },
    },  ],
};

export default brickBreakerModule;
