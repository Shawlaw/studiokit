/**
 * 俄罗斯方块 0.9 挑战模式确定性场景（T044 / CH-BD-001..008）。
 *
 * 证据等级：
 * - 参考通关（CH-BD-002/003）用真实键盘事件（←/→/↑/空格）经页面 input 层驱动，
 *   旋转、横移、硬降全部走真实引擎，属 real-input-replay。
 * - 失败/暂停/经典回归属 engine-replay（真实输入 + 引擎状态断言）。
 * - 数据/选关/布局属 ui-only（不作为“关卡可玩”的唯一证据）。
 *
 * 只读使用页面 #test 钩子与 DOM，不改游戏代码、不写持久数据（runner 每个场景前清 localStorage）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME = '/apps/arcade/games/block-drop.html';
const FIXTURE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools', 'testdata', 'challenge', 'block-drop.json'), 'utf8'));
const STAGE_BY_ID = new Map(FIXTURE.stages.map((stage) => [stage.id, stage]));
/** 参考计划里的 orientation 短名 → 页面 pieceDefinitions 的完整名。 */
const ORIENTATION_KEY = { H: 'I-H', V: 'I-V', N: 'O-N', 'STEM-DOWN': 'T-STEM-DOWN' };
/** 从经典出生朝向旋转到目标朝向需要的顺时针次数。 */
const ROTATIONS = { 'I-H': 0, 'I-V': 1, 'O-N': 0, 'T-STEM-DOWN': 2 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 真实按键：keydown 保持 hold ms 让引擎的边沿检测/输入层看到，再 keyup。 */
async function press(cdp, key, hold = 80) {
  await cdp.key(key, 'down');
  await sleep(hold);
  await cdp.key(key, 'up');
  await sleep(60);
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

/** 按设计 referencePlan 用真实输入完成一关（可多块）。 */
async function replayStage(cdp, stage, ctx) {
  const plan = stage.referencePlan;
  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index];
    await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing" && window.__arcadeTest.stageObservable().piece !== null', { timeout: 6000 });
    let obs = await cdp.evaluate('window.__arcadeTest.stageObservable()');
    ctx.assert(obs.piece && obs.piece.key === step.piece, stage.id + ' 第 ' + (index + 1) + ' 块应为 ' + step.piece + '，实际 ' + (obs.piece && obs.piece.key));
    const targetOrientation = ORIENTATION_KEY[step.orientation];
    const rotations = ROTATIONS[targetOrientation];
    for (let r = 0; r < rotations; r += 1) {
      await press(cdp, 'ArrowUp');
      obs = await cdp.evaluate('window.__arcadeTest.stageObservable()');
    }
    ctx.assert(obs.piece.orientation === targetOrientation, stage.id + ' 旋转后朝向 ' + obs.piece.orientation + ' ≠ ' + targetOrientation);
    const dx = step.leftCol - obs.piece.minCol;
    for (let k = 0; k < Math.abs(dx); k += 1) await press(cdp, dx > 0 ? 'ArrowRight' : 'ArrowLeft', 60);
    obs = await cdp.evaluate('window.__arcadeTest.stageObservable()');
    ctx.assert(obs.piece.minCol === step.leftCol, stage.id + ' 左列 ' + obs.piece.minCol + ' ≠ ' + step.leftCol);
    await press(cdp, ' ', 100);
    await cdp.waitFor(`window.__arcadeTest.challengeInfo().state !== "playing" || window.__arcadeTest.stageObservable().piecesPlaced > ${index}`, { timeout: 6000 });
    await sleep(150);
  }
  await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "cleared"', { timeout: 6000 });
}

export default {
  gameId: 'block-drop',
  gameFile: 'block-drop.html',
  evidence: 'real-input-replay',
  scenarios: [
    {
      id: 'CH-BD-001',
      title: '俄罗斯方块·挑战数据与选关锁定',
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
          const panel = document.querySelector('[data-ch-panel]');
          const btns = [...document.querySelectorAll('.ac-stage-btn[data-stage-id]')];
          const back = document.querySelector('.challenge-back');
          return {
            btns: btns.length,
            locked: btns.filter((b) => b.disabled).length,
            ids: btns.map((b) => b.dataset.stageId),
            back: !!back,
            head: document.querySelector('.ac-challenge-head') ? document.querySelector('.ac-challenge-head').textContent : '',
          };
        })()`);
        ctx.assert(panel.btns === 6, '选关按钮应为 6 个，实际 ' + panel.btns);
        ctx.assert(panel.locked === 5, '初始应锁定 5 关，实际 ' + panel.locked);
        ctx.assert(panel.back === true, '选关面板缺少「返回」按钮');
        ctx.assert(panel.head.includes('0/6'), '选关进度应为 0/6：' + panel.head);
        await cdp.click('.challenge-back');
        await sleep(150);
        const backState = await cdp.evaluate(`({ panelHidden: document.querySelector('[data-ch-panel]').hidden, overlay: !document.querySelector('[data-overlay]').hidden, title: document.querySelector('[data-ov-title]').textContent })`);
        ctx.assert(backState.panelHidden === true && backState.overlay === true && backState.title === '俄罗斯方块', '返回后应回开始弹层：' + JSON.stringify(backState));
        return { stages: stages.length, locked: panel.locked, backToStart: true };
      },
    },
    {
      id: 'CH-BD-002',
      title: '俄罗斯方块·C01 参考硬降真实输入通关',
      evidence: 'real-input-replay',
      async run(cdp, ctx) {
        const stage = STAGE_BY_ID.get('block-drop-C01');
        await startStage(cdp, stage.id);
        const before = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        ctx.assert(before.mode === 'challenge' && before.stageId === stage.id, '挑战模式/关卡未加载：' + JSON.stringify({ mode: before.mode, stage: before.stageId }));
        ctx.assert(before.targetLines === stage.content.win.count, '目标消行数应来自数据：' + before.targetLines);
        const preset = await cdp.evaluate(`window.__arcadeTest.stageObservable().boardText.split('\\n').slice(-1)[0]`);
        ctx.assert(preset === stage.content.boardTopToBottom[19], '预填盘面底行应来自数据：' + preset);
        await replayStage(cdp, stage, ctx);
        const after = await cdp.evaluate(`({ info: window.__arcadeTest.challengeInfo(), obs: window.__arcadeTest.stageObservable(), ov: { title: document.querySelector('[data-ov-title]').textContent, text: document.querySelector('[data-ov-text]').textContent }, progress: Arcade.Challenge.progress('block-drop') })`);
        ctx.assert(after.info.state === 'cleared' && after.info.lines === 1, 'C01 应按参考计划清 1 行：' + JSON.stringify(after.info));
        ctx.assert(after.ov.title === '关卡完成' && after.ov.text.includes('C01') && after.ov.text.includes('通关'), '通关结算文案异常：' + after.ov.text);
        ctx.assert(after.progress.cleared.includes(stage.id), '通关未写入挑战记录');
        ctx.assert(after.progress.best[stage.id] && after.progress.best[stage.id].assisted === false, '参考通关不应标记辅助');
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().stageId === "block-drop-C02" && window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        return { stage: stage.id, lines: after.info.lines, nextStage: 'block-drop-C02', evidence: 'real-input-replay' };
      },
    },
    {
      id: 'CH-BD-003',
      title: '俄罗斯方块·C01–C06 全量参考回放与解锁链',
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
          ctx.assert(info.lines === stage.content.win.count, stage.id + ' 清行数 ' + info.lines + ' ≠ 目标 ' + stage.content.win.count);
          results.push({ id: stage.id, lines: info.lines, pieces: info.piecesPlaced });
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
      id: 'CH-BD-004',
      title: '俄罗斯方块·失败归因与 1 次点击重试',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const stage = STAGE_BY_ID.get('block-drop-C01');
        await startStage(cdp, stage.id);
        /* 故意把 I 移到最右，错过 3–6 列横井；出块用完 → 失败。 */
        for (let k = 0; k < 3; k += 1) await press(cdp, 'ArrowRight', 60);
        await press(cdp, ' ', 100);
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "over"', { timeout: 6000 });
        const failed = await cdp.evaluate(`({ info: window.__arcadeTest.challengeInfo(), title: document.querySelector('[data-ov-title]').textContent, text: document.querySelector('[data-ov-text]').textContent, progress: Arcade.Challenge.progress('block-drop') })`);
        ctx.assert(failed.title === '挑战失败', '失败弹层标题异常：' + failed.title);
        ctx.assert(failed.text.includes('出块次数') || failed.text.includes('出块队列'), '失败文案缺少可归因原因：' + failed.text);
        ctx.assert(failed.text.includes('目标：' + stage.goalStatement), '失败文案缺少本关目标：' + failed.text);
        ctx.assert(failed.progress.cleared.length === 0, '失败不应写入通关记录');
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        const retried = await cdp.evaluate('window.__arcadeTest.challengeInfo()');
        ctx.assert(retried.stageId === stage.id && retried.lines === 0 && retried.piecesPlaced === 0 && retried.elapsedSec < 2, '重试未回到本关起点：' + JSON.stringify(retried));
        return { failTitle: '挑战失败', retryStage: retried.stageId, cleared: false };
      },
    },
    {
      id: 'CH-BD-005',
      title: '俄罗斯方块·挑战暂停/刷新恢复同一关',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const stage = STAGE_BY_ID.get('block-drop-C02');
        /* C02 需要 C01 通关：先按参考计划真实通关 C01。 */
        await startStage(cdp, 'block-drop-C01');
        await replayStage(cdp, STAGE_BY_ID.get('block-drop-C01'), ctx);
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().stageId === "block-drop-C02" && window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        await sleep(220);
        const before = await cdp.evaluate(`({ info: window.__arcadeTest.challengeInfo(), obs: window.__arcadeTest.stageObservable() })`);
        await cdp.click('[data-pause]');
        await sleep(160);
        const paused = await cdp.evaluate(`({ title: document.querySelector('[data-ov-title]').textContent, btn2: document.querySelector('[data-ov-btn2]').textContent, btn2Hidden: document.querySelector('[data-ov-btn2]').hidden })`);
        ctx.assert(paused.title === '已暂停' && paused.btn2Hidden === false && paused.btn2 === '退出挑战', '挑战暂停弹层应含「退出挑战」：' + JSON.stringify(paused));
        await cdp.navigate(ctx.base + GAME + '?ch-bd-resume=1#test');
        await cdp.waitFor(`document.querySelector('[data-ov-title]') && document.querySelector('[data-ov-title]').textContent.includes('继续')`, { timeout: 6000 });
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 6000 });
        const resumed = await cdp.evaluate(`({ info: window.__arcadeTest.challengeInfo(), obs: window.__arcadeTest.stageObservable() })`);
        ctx.assert(resumed.info.mode === 'challenge', '刷新恢复后 mode 应为 challenge：' + resumed.info.mode);
        ctx.assert(resumed.info.stageId === stage.id, '刷新恢复后关卡应为 ' + stage.id + '，实际 ' + resumed.info.stageId);
        ctx.assert(JSON.stringify(resumed.obs.board) === JSON.stringify(before.obs.board), '刷新恢复后盘面不一致');
        ctx.assert(resumed.obs.piece && before.obs.piece && resumed.obs.piece.key === before.obs.piece.key, '刷新恢复后当前方块不一致');
        return { resumedStage: resumed.info.stageId, mode: resumed.info.mode, boardEqual: true };
      },
    },
    {
      id: 'CH-BD-006',
      title: '俄罗斯方块·经典回归（7-bag/40 行/主按钮）',
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
        ctx.assert(classic.joy.shortRun === true && classic.joy.targetLines === 40, '经典 40 行收局应保持不变：' + JSON.stringify(classic.joy));
        ctx.assert(Array.isArray(classic.info.bag) && classic.info.bag.length >= 4, '经典 7-bag 应保持随机袋：' + JSON.stringify(classic.info.bag));
        ctx.assert(classic.info.nextKey, '经典应生成 NEXT 方块');
        await cdp.click('[data-pause]');
        await sleep(150);
        const pause = await cdp.evaluate(`({ title: document.querySelector('[data-ov-title]').textContent, btn2Hidden: document.querySelector('[data-ov-btn2]').hidden })`);
        ctx.assert(pause.title === '已暂停' && pause.btn2Hidden === true, '经典暂停弹层应保持原样（无 btn2）：' + JSON.stringify(pause));
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.joyInfo().state === "playing"', { timeout: 6000 });
        return { classicMode: classic.info.mode, shortRun: classic.joy.shortRun, bag: classic.info.bag.length };
      },
    },
    {
      id: 'CH-BD-007',
      title: '俄罗斯方块·320/390 挑战面板与页面无溢出',
      evidence: 'ui-only',
      async run(cdp, ctx) {
        const report = [];
        for (const [width, height] of [[320, 568], [390, 844]]) {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
          await cdp.navigate(ctx.base + GAME + '?ch-bd-layout=' + width + '#test');
          await cdp.evaluate(`Arcade.RunSave.clear('block-drop')`);
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
          await cdp.evaluate(`document.querySelector('.ac-stage-btn[data-stage-id="block-drop-C01"]').click()`);
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
          report.push({ width, panel: panel.minBtnH, tip: playing.tipVisible });
        }
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });
        return { viewports: report };
      },
    },
    {
      id: 'CH-BD-008',
      title: '俄罗斯方块·辅助道具计入 assisted 记录',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const stage = STAGE_BY_ID.get('block-drop-C01');
        await startStage(cdp, stage.id);
        const used = await cdp.evaluate(`window.__arcadeTest.useJoyTool('slow')`);
        ctx.assert(used === true, '挑战中应能使用限量道具（useJoyTool 返回 false）');
        const assisted = await cdp.evaluate('window.__arcadeTest.challengeInfo().assisted');
        ctx.assert(assisted === true, '使用限量道具后 assisted 应为 true');
        await replayStage(cdp, stage, ctx);
        const result = await cdp.evaluate(`({ info: window.__arcadeTest.challengeInfo(), text: document.querySelector('[data-ov-text]').textContent, progress: Arcade.Challenge.progress('block-drop') })`);
        ctx.assert(result.info.state === 'cleared', '辅助后仍应可通关：' + JSON.stringify(result.info));
        ctx.assert(result.text.includes('辅助'), '结算应显示「辅助」标记：' + result.text);
        const best = result.progress.best[stage.id];
        ctx.assert(best && best.assisted === true, '挑战记录 best.assisted 应为 true：' + JSON.stringify(best));
        return { assisted: true, cleared: true, bestTime: best.timeSec };
      },
    },
  ],
};

