/**
 * 2048 合成 0.9 挑战模式确定性场景（T045 / CH-MG-001..008）。
 *
 * 证据等级：
 * - 参考通关（CH-MG-002/003）用真实方向键事件驱动 move()，并逐格比对设计 resultBoard，
 *   属 real-input-replay。
 * - 失败/撤销/暂停/经典回归属 engine-replay。
 * - 数据/选关/布局属 ui-only。
 *
 * 只读使用页面 #test 钩子与 DOM，不改游戏代码、不写持久数据（runner 每个场景前清 localStorage）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME = '/apps/arcade/games/merge-2048.html';
const FIXTURE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools', 'testdata', 'challenge', 'merge-2048.json'), 'utf8'));
const STAGE_BY_ID = new Map(FIXTURE.stages.map((stage) => [stage.id, stage]));
const DIR_KEY = { L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp', D: 'ArrowDown' };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 真实按键：keydown 保持 hold ms，确保页面 input 层的边沿检测命中。 */
async function press(cdp, dir, hold = 70) {
  await cdp.key(DIR_KEY[dir], 'down');
  await sleep(hold);
  await cdp.key(DIR_KEY[dir], 'up');
  await sleep(110);
}

/** 挑战中离开页面时引擎 auto-pause 会补存档；若出现续玩弹层先点「重新开始」回到开始弹层。 */
async function ensureStartOverlay(cdp) {
  const state = await cdp.evaluate(`(() => {
    const overlay = document.querySelector('[data-overlay]');
    const title = document.querySelector('[data-ov-title]') ? document.querySelector('[data-ov-title]').textContent : '';
    return { hidden: overlay.hidden, title };
  })()`);
  if (state.hidden) return;
  if (state.title.includes('继续')) {
    await cdp.click('[data-ov-btn2]');
    await sleep(180);
  }
}

async function openPanel(cdp) {
  await cdp.click('[data-ov-btn2]');
  await cdp.waitFor(`!document.querySelector('[data-ch-layer]').hidden && !document.querySelector('[data-ch-panel]').hidden`, { timeout: 5000 });
}

async function startStage(cdp, stageId) {
  const started = await cdp.evaluate(`window.__arcadeTest.startChallenge(${JSON.stringify(stageId)})`);
  if (started !== true) throw new Error('startChallenge(' + stageId + ') 返回 ' + started);
  await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
}

/** 按设计 referencePlan.directions 用真实方向键完成一关，并逐格比对 resultBoard。 */
async function replayStage(cdp, stage, ctx) {
  const plan = stage.referencePlan;
  for (let index = 0; index < plan.directions.length; index += 1) {
    await cdp.waitFor(`window.__arcadeTest.challengeInfo().state === "playing" && window.__arcadeTest.stageObservable().movesUsed === ${index}`, { timeout: 6000 });
    await press(cdp, plan.directions[index]);
  }
  await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "cleared"', { timeout: 6000 });
  const obs = await cdp.evaluate('window.__arcadeTest.stageObservable()');
  ctx.assert(
    JSON.stringify(obs.board) === JSON.stringify(plan.resultBoard),
    stage.id + ' 最终盘面与设计 resultBoard 不一致：实际 ' + JSON.stringify(obs.board)
  );
  ctx.assert(obs.movesUsed === plan.directions.length, stage.id + ' 有效步数 ' + obs.movesUsed + ' ≠ 参考 ' + plan.directions.length);
}

export default {
  gameId: 'merge-2048',
  gameFile: 'merge-2048.html',
  evidence: 'real-input-replay',
  scenarios: [
    {
      id: 'CH-MG-001',
      title: '2048·挑战数据与选关锁定',
      evidence: 'ui-only',
      async run(cdp, ctx) {
        const stages = await cdp.evaluate('window.__arcadeTest.challengeStages()');
        ctx.assert(Array.isArray(stages) && stages.length === 6, '挑战关卡应为 6 个，实际 ' + (stages && stages.length));
        ctx.assert(stages.map((s) => s.id).join(',') === FIXTURE.stages.map((s) => s.id).join(','), '关卡 id/顺序与设计夹具不一致');
        ctx.assert(stages[0].unlocked === true, 'C01 应恒解锁');
        ctx.assert(stages.slice(1).every((s) => s.unlocked === false), 'C02–C06 初始应锁定');
        ctx.assert(stages.every((s) => s.cleared === false && s.best === null), '初始不应有通关记录');
        const panelHidden = await cdp.evaluate(`document.querySelector('[data-ch-panel]').hidden`);
        ctx.assert(panelHidden === true, '选关面板默认应 hidden（CH-CLASSIC-001 门禁）');
        await openPanel(cdp);
        const panel = await cdp.evaluate(`(() => {
          const btns = [...document.querySelectorAll('.ac-stage-btn[data-stage-id]')];
          return {
            btns: btns.length,
            locked: btns.filter((b) => b.disabled).length,
            back: !!document.querySelector('.challenge-back'),
            head: document.querySelector('.ac-challenge-head') ? document.querySelector('.ac-challenge-head').textContent : '',
          };
        })()`);
        ctx.assert(panel.btns === 6 && panel.locked === 5, '选关按钮/锁定数异常：' + JSON.stringify(panel));
        ctx.assert(panel.head.includes('0/6'), '选关进度应为 0/6：' + panel.head);
        await cdp.click('.challenge-back');
        await sleep(150);
        const backState = await cdp.evaluate(`({ panelHidden: document.querySelector('[data-ch-panel]').hidden, overlay: !document.querySelector('[data-overlay]').hidden, title: document.querySelector('[data-ov-title]').textContent })`);
        ctx.assert(backState.panelHidden === true && backState.overlay === true && backState.title === '2048 合成', '返回后应回开始弹层：' + JSON.stringify(backState));
        return { stages: stages.length, locked: panel.locked, backToStart: true };
      },
    },
    {
      id: 'CH-MG-002',
      title: '2048·C01 参考方向真实输入通关',
      evidence: 'real-input-replay',
      async run(cdp, ctx) {
        const stage = STAGE_BY_ID.get('merge-2048-C01');
        await startStage(cdp, stage.id);
        const before = await cdp.evaluate(`({ info: window.__arcadeTest.challengeInfo(), obs: window.__arcadeTest.stageObservable() })`);
        ctx.assert(before.info.mode === 'challenge' && before.info.stageId === stage.id, '挑战模式/关卡未加载：' + JSON.stringify({ mode: before.info.mode, stage: before.info.stageId }));
        ctx.assert(JSON.stringify(before.obs.board) === JSON.stringify(stage.content.initialBoard), '初始盘面应来自设计数据：' + JSON.stringify(before.obs.board));
        ctx.assert(before.info.maxValidMoves === stage.content.maxValidMoves, '有效步数上限应来自数据：' + before.info.maxValidMoves);
        ctx.assert(before.info.target === stage.content.win.anyTileAtLeast, '目标方块应来自数据：' + before.info.target);
        await replayStage(cdp, stage, ctx);
        const after = await cdp.evaluate(`({ info: window.__arcadeTest.challengeInfo(), ov: { title: document.querySelector('[data-ov-title]').textContent, text: document.querySelector('[data-ov-text]').textContent }, progress: Arcade.Challenge.progress('merge-2048') })`);
        ctx.assert(after.info.state === 'cleared' && after.info.bestTile >= after.info.target, 'C01 未按参考方向达标：' + JSON.stringify(after.info));
        ctx.assert(after.ov.title === '关卡完成' && after.ov.text.includes('C01'), '通关结算文案异常：' + after.ov.text);
        ctx.assert(after.progress.cleared.includes(stage.id), '通关未写入挑战记录');
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().stageId === "merge-2048-C02" && window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        return { stage: stage.id, bestTile: after.info.bestTile, nextStage: 'merge-2048-C02', evidence: 'real-input-replay' };
      },
    },
    {
      id: 'CH-MG-003',
      title: '2048·C01–C06 全量参考回放与解锁链',
      evidence: 'real-input-replay',
      async run(cdp, ctx) {
        const results = [];
        for (let index = 0; index < FIXTURE.stages.length; index += 1) {
          const stage = FIXTURE.stages[index];
          if (index === 0) await startStage(cdp, stage.id);
          else {
            await cdp.click('[data-ov-btn]');
            await cdp.waitFor(`window.__arcadeTest.challengeInfo().stageId === ${JSON.stringify(stage.id)} && window.__arcadeTest.challengeInfo().state === "playing"`, { timeout: 6000 });
          }
          await replayStage(cdp, stage, ctx);
          const info = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
          ctx.assert(info.state === 'cleared', stage.id + ' 未通关：' + JSON.stringify(info));
          results.push({ id: stage.id, bestTile: info.bestTile, moves: info.movesUsed });
          const stages = await cdp.evaluate('window.__arcadeTest.challengeStages()');
          ctx.assert(stages[index].cleared === true, stage.id + ' 通关记录缺失');
          if (index < FIXTURE.stages.length - 1) ctx.assert(stages[index + 1].unlocked === true, stage.id + ' 通关后下一关未解锁');
        }
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor(`!document.querySelector('[data-ch-panel]').hidden`, { timeout: 6000 });
        const panel = await cdp.evaluate(`document.querySelector('.ac-challenge-head').textContent`);
        ctx.assert(panel.includes('6/6'), '选关进度应为 6/6：' + panel);
        return { clearedStages: results.length, panel, results };
      },
    },
    {
      id: 'CH-MG-004',
      title: '2048·步数耗尽失败与 1 次点击重试',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const stage = STAGE_BY_ID.get('merge-2048-C01');
        await startStage(cdp, stage.id);
        /* C01 上限 2 步：先下移再上移（不合并）→ 步数用完仍未到 4。 */
        await press(cdp, 'D');
        await press(cdp, 'U');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "over"', { timeout: 6000 });
        const failed = await cdp.evaluate(`({ info: window.__arcadeTest.challengeInfo(), title: document.querySelector('[data-ov-title]').textContent, text: document.querySelector('[data-ov-text]').textContent, progress: Arcade.Challenge.progress('merge-2048') })`);
        ctx.assert(failed.title === '挑战失败', '失败弹层标题异常：' + failed.title);
        ctx.assert(failed.text.includes('步数用完'), '失败文案缺少可归因原因：' + failed.text);
        ctx.assert(failed.text.includes('目标：' + stage.goalStatement), '失败文案缺少本关目标：' + failed.text);
        ctx.assert(failed.info.movesUsed === failed.info.maxValidMoves, '失败时应已用完有效步数：' + JSON.stringify(failed.info));
        ctx.assert(failed.progress.cleared.length === 0, '失败不应写入通关记录');
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        const retried = await cdp.evaluate(`({ info: window.__arcadeTest.challengeInfo(), obs: window.__arcadeTest.stageObservable() })`);
        ctx.assert(retried.info.stageId === stage.id && retried.info.movesUsed === 0 && retried.info.elapsedSec < 2, '重试未回到本关起点：' + JSON.stringify(retried.info));
        ctx.assert(JSON.stringify(retried.obs.board) === JSON.stringify(stage.content.initialBoard), '重试后盘面应重置为初始盘面');
        return { failTitle: '挑战失败', retryStage: retried.info.stageId, movesUsed: retried.info.movesUsed };
      },
    },
    {
      id: 'CH-MG-005',
      title: '2048·挑战暂停/刷新恢复同一关同步数',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const stage = STAGE_BY_ID.get('merge-2048-C01');
        await startStage(cdp, stage.id);
        await press(cdp, 'D');
        const before = await cdp.evaluate(`({ info: window.__arcadeTest.challengeInfo(), obs: window.__arcadeTest.stageObservable() })`);
        ctx.assert(before.info.movesUsed === 1, '暂停前应已走 1 步：' + before.info.movesUsed);
        await cdp.click('[data-pause]');
        await sleep(160);
        const paused = await cdp.evaluate(`({ title: document.querySelector('[data-ov-title]').textContent, btn2: document.querySelector('[data-ov-btn2]').textContent, btn2Hidden: document.querySelector('[data-ov-btn2]').hidden })`);
        ctx.assert(paused.title === '已暂停' && paused.btn2Hidden === false && paused.btn2 === '退出挑战', '挑战暂停弹层应含「退出挑战」：' + JSON.stringify(paused));
        await cdp.navigate(ctx.base + GAME + '?ch-mg-resume=1#test');
        await cdp.waitFor(`document.querySelector('[data-ov-title]') && document.querySelector('[data-ov-title]').textContent.includes('继续')`, { timeout: 6000 });
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        const resumed = await cdp.evaluate(`({ info: window.__arcadeTest.challengeInfo(), obs: window.__arcadeTest.stageObservable() })`);
        ctx.assert(resumed.info.mode === 'challenge', '刷新恢复后 mode 应为 challenge：' + resumed.info.mode);
        ctx.assert(resumed.info.stageId === stage.id, '刷新恢复后关卡应为 ' + stage.id + '，实际 ' + resumed.info.stageId);
        ctx.assert(resumed.info.movesUsed === before.info.movesUsed, '刷新恢复后步数不一致：' + resumed.info.movesUsed + ' vs ' + before.info.movesUsed);
        ctx.assert(JSON.stringify(resumed.obs.board) === JSON.stringify(before.obs.board), '刷新恢复后盘面不一致');
        return { resumedStage: resumed.info.stageId, movesUsed: resumed.info.movesUsed, boardEqual: true };
      },
    },
    {
      id: 'CH-MG-006',
      title: '2048·撤销不退还步数且标记辅助',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const stage = STAGE_BY_ID.get('merge-2048-C03');
        /* C03 需要 C01/C02 通关：先按参考方向真实通关两关。 */
        await startStage(cdp, 'merge-2048-C01');
        await replayStage(cdp, STAGE_BY_ID.get('merge-2048-C01'), ctx);
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().stageId === "merge-2048-C02" && window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        await replayStage(cdp, STAGE_BY_ID.get('merge-2048-C02'), ctx);
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().stageId === "merge-2048-C03" && window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        await press(cdp, 'L');
        const moved = await cdp.evaluate('window.__arcadeTest.stageObservable()');
        ctx.assert(moved.movesUsed === 1 && moved.bestTile === 8, 'C03 第一步后应为 1 步/最大 8：' + JSON.stringify(moved));
        const undone = await cdp.evaluate(`(() => { window.__arcadeTest.undoNow(); return window.__arcadeTest.stageObservable(); })()`);
        ctx.assert(undone.movesUsed === 1, '撤销不应退还步数：' + undone.movesUsed);
        ctx.assert(undone.undoUsed === 1 && undone.assisted === true, '撤销应记录并标记辅助：' + JSON.stringify({ undoUsed: undone.undoUsed, assisted: undone.assisted }));
        ctx.assert(JSON.stringify(undone.board) === JSON.stringify(stage.content.initialBoard), '撤销应恢复初始盘面');
        /* 撤销后仍可按参考计划通关，但成绩标记 assisted。 */
        await press(cdp, 'L');
        await press(cdp, 'L');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "cleared"', { timeout: 6000 });
        const result = await cdp.evaluate(`({ info: window.__arcadeTest.challengeInfo(), text: document.querySelector('[data-ov-text]').textContent, progress: Arcade.Challenge.progress('merge-2048') })`);
        ctx.assert(result.text.includes('辅助'), '使用撤销后结算应显示「辅助」：' + result.text);
        const best = result.progress.best[stage.id];
        ctx.assert(best && best.assisted === true, '挑战记录 best.assisted 应为 true：' + JSON.stringify(best));
        return { undoUsed: undone.undoUsed, assisted: true, movesUsed: result.info.movesUsed, bestTile: result.info.bestTile };
      },
    },
    {
      id: 'CH-MG-007',
      title: '2048·经典回归（随机新块/道具/主按钮）',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const startOverlay = await cdp.evaluate(`({ btn: document.querySelector('[data-ov-btn]').textContent, btn2: document.querySelector('[data-ov-btn2]').textContent, btn2Hidden: document.querySelector('[data-ov-btn2]').hidden, panelHidden: document.querySelector('[data-ch-panel]').hidden })`);
        ctx.assert(startOverlay.btn === '开始游戏', '经典主按钮文案必须保持「开始游戏」：' + startOverlay.btn);
        ctx.assert(startOverlay.btn2Hidden === false && startOverlay.btn2.includes('挑战'), '开始弹层应有「挑战 6 关」第二入口：' + JSON.stringify(startOverlay));
        ctx.assert(startOverlay.panelHidden === true, '选关面板默认应隐藏');
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.joyInfo().state === "playing"', { timeout: 6000 });
        const classic = await cdp.evaluate(`({ info: window.__arcadeTest.info(), joy: window.__arcadeTest.joyInfo() })`);
        ctx.assert(classic.info.mode === 'classic', '主按钮应进入经典模式：' + classic.info.mode);
        const tiles = classic.info.board.flat().filter((v) => v > 0).length;
        ctx.assert(tiles === 2, '经典开局应有 2 个随机方块：' + tiles);
        ctx.assert(classic.info.tools.hammer === 2 && classic.info.tools.upgrade === 1, '经典道具初始数量应不变：' + JSON.stringify(classic.info.tools));
        /* 经典滑动仍会生成随机新块（挑战禁随机，经典不变）。 */
        await press(cdp, 'L');
        const afterMove = await cdp.evaluate('window.__arcadeTest.info()');
        ctx.assert(afterMove.moves >= 1, '经典滑动应计步：' + afterMove.moves);
        await cdp.click('[data-pause]');
        await sleep(150);
        const pause = await cdp.evaluate(`({ title: document.querySelector('[data-ov-title]').textContent, btn2Hidden: document.querySelector('[data-ov-btn2]').hidden })`);
        ctx.assert(pause.title === '已暂停' && pause.btn2Hidden === true, '经典暂停弹层应保持原样（无 btn2）：' + JSON.stringify(pause));
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.joyInfo().state === "playing"', { timeout: 6000 });
        return { classicMode: classic.info.mode, startTiles: tiles, tools: classic.info.tools };
      },
    },
    {
      id: 'CH-MG-008',
      title: '2048·320/390 挑战面板与页面无溢出',
      evidence: 'ui-only',
      async run(cdp, ctx) {
        const report = [];
        for (const [width, height] of [[320, 568], [390, 844]]) {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
          await cdp.navigate(ctx.base + GAME + '?ch-mg-layout=' + width + '#test');
          await cdp.evaluate(`Arcade.RunSave.clear('merge-2048')`);
          await ensureStartOverlay(cdp);
          await openPanel(cdp);
          const panel = await cdp.evaluate(`(() => {
            const p = document.querySelector('[data-ch-panel]');
            const layer = document.querySelector('[data-ch-layer]');
            const btns = [...document.querySelectorAll('.ac-stage-btn')];
            const back = document.querySelector('.challenge-back');
            const pr = p.getBoundingClientRect();
            const lr = layer.getBoundingClientRect();
            return {
              sw: document.documentElement.scrollWidth,
              cw: document.documentElement.clientWidth,
              panelRight: Math.round(pr.right),
              layerRight: Math.round(lr.right),
              minBtnH: Math.min(...btns.map((b) => Math.round(b.getBoundingClientRect().height))),
              minBtnW: Math.min(...btns.map((b) => Math.round(b.getBoundingClientRect().width))),
              backH: Math.round(back.getBoundingClientRect().height),
            };
          })()`);
          ctx.assert(panel.sw <= panel.cw + 1, width + 'px 选关面板横向溢出：' + panel.sw + '>' + panel.cw);
          ctx.assert(panel.panelRight <= panel.layerRight + 1, width + 'px 选关面板超出舞台：' + JSON.stringify(panel));
          ctx.assert(panel.minBtnH >= 44 && panel.minBtnW >= 44, width + 'px 关卡按钮应 ≥44px：' + JSON.stringify(panel));
          ctx.assert(panel.backH >= 44, width + 'px 返回按钮应 ≥44px：' + panel.backH);
          await cdp.evaluate(`document.querySelector('.ac-stage-btn[data-stage-id="merge-2048-C01"]').click()`);
          await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
          const playing = await cdp.evaluate(`(() => {
            const tip = document.querySelector('[data-ch-tip]');
            const box = document.querySelector('.stage-box').getBoundingClientRect();
            const tr = tip && !tip.hidden ? tip.getBoundingClientRect() : null;
            return {
              sw: document.documentElement.scrollWidth,
              cw: document.documentElement.clientWidth,
              docH: document.documentElement.scrollHeight,
              vh: innerHeight,
              tipVisible: !!tr,
              tipInside: tr ? tr.left >= box.left - 1 && tr.right <= box.right + 1 : true,
            };
          })()`);
          ctx.assert(playing.sw <= playing.cw + 1, width + 'px 挑战页横向溢出：' + playing.sw + '>' + playing.cw);
          ctx.assert(playing.tipInside, width + 'px 目标提示超出舞台：' + JSON.stringify(playing));
          ctx.assert(playing.docH <= playing.vh + 1, width + 'px 挑战页纵向溢出：' + playing.docH + '>' + playing.vh);
          report.push({ width, minBtnH: panel.minBtnH, tip: playing.tipVisible });
        }
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });
        return { viewports: report };
      },
    },
  ],
};

