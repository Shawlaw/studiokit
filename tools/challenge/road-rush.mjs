#!/usr/bin/env node
/**
 * 极速车道（road-rush）0.9 挑战模式确定性场景模块。
 *
 * 由 tools/arcade_gameplay_test.mjs 自动发现；默认导出
 *   { gameId, gameFile, evidence, scenarios: [{ id, title, evidence?, run(cdp, ctx) }] }
 *
 * 证据等级：
 * - CH-RR-002 参考通关：按 referencePlan.safeLaneBySlot 在真实引擎中逐时隙用触摸按钮真实变道，
 *   走完固定时间轴并断言无碰撞 = real-input-replay；
 * - 其余场景用真实时间轴 + #test 观察钩子 = engine-replay（失败/暂停/记录不冒充通关证据）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const GAME_ID = 'road-rush';
const GAME_FILE = 'road-rush.html';
const GAME_PATH = '/apps/arcade/games/' + GAME_FILE;

const TESTDATA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools', 'testdata', 'challenge', GAME_ID + '.json'), 'utf8'));
const STAGE_IDS = TESTDATA.stages.map((stage) => stage.id);

function stageData(stageId) {
  return TESTDATA.stages.filter((stage) => stage.id === stageId)[0] || null;
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

async function challengeInfo(cdp) {
  return cdp.evaluate('window.__arcadeTest.challengeInfo()');
}

async function stageObservable(cdp) {
  return cdp.evaluate('window.__arcadeTest.stageObservable()');
}

async function enterChallenge(cdp, stageId) {
  await cdp.click('[data-ov-btn2]');
  await cdp.waitFor("(() => { const layer = document.querySelector('[data-ch-layer]'); return !!layer && !layer.hidden; })()", { timeout: 6000 });
  const clicked = await cdp.evaluate(
    `(() => { const btn = document.querySelector('.ac-stage-btn[data-stage-id=${JSON.stringify(stageId)}]'); if (!btn || btn.disabled) return false; btn.click(); return true; })()`
  );
  assertTrue(clicked, '无法点击关卡按钮 ' + stageId);
  await cdp.waitFor("window.__arcadeTest && window.__arcadeTest.challengeInfo().state === 'playing'", { timeout: 6000 });
}

/** 在真实引擎中按 referencePlan.safeLaneBySlot 逐时隙真实变道，走完一整关。 */
async function replayStage(cdp, ctx, stageIndex) {
  const stage = TESTDATA.stages[stageIndex];
  const plan = stage.referencePlan.safeLaneBySlot;
  const started = await cdp.evaluate(`window.__arcadeTest.startChallenge(${JSON.stringify(stage.id)})`);
  assertTrue(started === true, stage.id + ' 无法进入（前关未解锁？）');
  await cdp.waitFor("window.__arcadeTest.challengeInfo().state === 'playing'", { timeout: 6000 });
  const initial = await stageObservable(cdp);
  const slots = initial.slots;
  assertTrue(slots.length === plan.length - 1, stage.id + ' safeLaneBySlot 与时间轴长度不匹配');
  for (let k = 0; k < slots.length; k += 1) {
    assertTrue(Math.abs(plan[k + 1] - plan[k]) <= 1, stage.id + ' 第 ' + (k + 1) + ' 时隙参考车道跳变 > 1');
    assertTrue(slots[k].occupiedLanes.indexOf(plan[k + 1]) === -1, stage.id + ' 第 ' + (k + 1) + ' 时隙参考车道被占用');
  }
  const deadline = Date.now() + 35000;
  let changes = 0;
  while (Date.now() < deadline) {
    const info = await challengeInfo(cdp);
    if (info.state !== 'playing') break;
    const observable = await stageObservable(cdp);
    const k = observable.checkedSlots;
    if (k >= slots.length) break;
    const targetLane = plan[k + 1];
    const changeAt = k === 0 ? 0 : slots[k - 1].passAt + 0.03;
    if (observable.simTime >= changeAt) {
      if (observable.lane !== targetLane) {
        const delta = targetLane > observable.lane ? 1 : -1;
        await cdp.buttonPointer('[data-touch="' + (delta > 0 ? 'right' : 'left') + '"]', 'pointerdown');
        changes += 1;
        await ctx.sleep(50);
      } else {
        await ctx.sleep(35);
      }
    } else {
      await ctx.sleep(35);
    }
  }
  await cdp.waitFor("['cleared','failed'].indexOf(window.__arcadeTest.challengeInfo().state) !== -1", { timeout: 10000 });
  const info = await challengeInfo(cdp);
  assertTrue(info.state === 'cleared', stage.id + ' 参考解未通关：' + JSON.stringify(info.error));
  return { stageId: stage.id, changes, passedSlots: info.passedSlots, distance: Math.round(info.distance), score: info.score };
}

async function assertNoOverflow(cdp, width, height, label) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await cdp.evaluate('window.scrollTo(0, 0)');
  await new Promise((resolve) => setTimeout(resolve, 120));
  const metrics = await cdp.evaluate(`({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    panel: (() => { const p = document.querySelector('.ac-challenge-panel'); if (!p) return null; const r = p.getBoundingClientRect(); return { w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right) }; })(),
    buttons: [...document.querySelectorAll('.ac-stage-btn')].map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })
  })`);
  assertTrue(metrics.sw <= metrics.cw + 1, label + ' ' + width + 'px 横向溢出 ' + metrics.sw + '>' + metrics.cw);
  if (metrics.panel) {
    assertTrue(metrics.panel.left >= -1 && metrics.panel.right <= metrics.cw + 1, label + ' 挑战面板越界 ' + JSON.stringify(metrics.panel));
  }
  if (metrics.buttons.length) {
    assertTrue(metrics.buttons.every((btn) => btn.h >= 44), label + ' 关卡按钮高度不足 44px: ' + JSON.stringify(metrics.buttons));
  }
  return metrics;
}

async function resetViewport(cdp) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });
}

export default {
  gameId: GAME_ID,
  gameFile: GAME_FILE,
  evidence: 'real-input-replay',
  scenarios: [
    {
      id: 'CH-RR-001',
      title: '极速车道·6 关数据/选关锁定/返回与 320px 无溢出',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const stages = await cdp.evaluate('window.__arcadeTest.challengeStages()');
        assertTrue(Array.isArray(stages) && stages.length === 6, 'challengeStages 数量 ' + (stages && stages.length));
        assertTrue(stages[0].id === STAGE_IDS[0] && stages[0].unlocked === true, 'C01 应默认解锁');
        assertTrue(stages.slice(1).every((stage) => stage.unlocked === false), 'C02+ 初始不应解锁');
        const entryText = (await cdp.text('[data-ov-btn2]')).trim();
        assertTrue(entryText === '挑战 6 关', '挑战入口文案 ' + JSON.stringify(entryText));
        const mainText = (await cdp.text('[data-ov-btn]')).trim();
        assertTrue(mainText === '开始游戏', '经典主按钮文案被改动：' + JSON.stringify(mainText));
        await cdp.click('[data-ov-btn2]');
        await cdp.waitFor("(() => { const layer = document.querySelector('[data-ch-layer]'); return !!layer && !layer.hidden; })()", { timeout: 6000 });
        const panel = await cdp.evaluate(`({
          buttons: document.querySelectorAll('.ac-stage-btn').length,
          locked: document.querySelectorAll('.ac-stage-btn.is-locked').length,
          disabled: document.querySelectorAll('.ac-stage-btn[disabled]').length,
          panelVisible: (() => { const p = document.querySelector('.ac-challenge-panel'); return !!p && !p.hidden; })()
        })`);
        assertTrue(panel.buttons === 6, '选关按钮数 ' + panel.buttons);
        assertTrue(panel.locked === 5 && panel.disabled === 5, '锁定关数量 ' + JSON.stringify(panel));
        assertTrue(panel.panelVisible === true, '选关面板应可见');
        const smallMetrics = await assertNoOverflow(cdp, 320, 568, '选关面板');
        await cdp.click('[data-ch-back]');
        await cdp.waitFor("(() => { const layer = document.querySelector('[data-ch-layer]'); return !!layer && layer.hidden; })()", { timeout: 4000 });
        const backToStart = await cdp.evaluate("(() => { const o = document.querySelector('[data-overlay]'); const b = document.querySelector('[data-ov-btn]'); return !!o && !o.hidden && b && b.textContent.trim() === '开始游戏'; })()");
        assertTrue(backToStart, '返回后应回到开始弹层且主按钮不变');
        await resetViewport(cdp);
        return { stages: stages.length, locked: panel.locked, smallWidth: smallMetrics.cw };
      },
    },
    {
      id: 'CH-RR-002',
      title: '极速车道·C01 参考通关（按安全车道序列真实变道走完时间轴）',
      evidence: 'real-input-replay',
      async run(cdp, ctx) {
        const stage = stageData(STAGE_IDS[0]);
        const plan = stage.referencePlan.safeLaneBySlot;
        const goalDistance = stage.content.goal.minDistanceMeters;
        await enterChallenge(cdp, STAGE_IDS[0]);
        const info0 = await challengeInfo(cdp);
        assertTrue(info0.mode === 'challenge' && info0.stageId === STAGE_IDS[0], '未进入 C01 挑战: ' + JSON.stringify(info0));
        const initial = await stageObservable(cdp);
        const slots = initial.slots;
        assertTrue(slots.length === plan.length - 1, 'safeLaneBySlot 与时间轴长度不匹配');
        assertTrue(slots.every((slot) => Array.isArray(slot.occupiedLanes)), '时间轴时隙缺少 occupiedLanes');
        const deadline = Date.now() + 35000;
        let changes = 0;
        let lastState = 'playing';
        while (Date.now() < deadline) {
          const info = await challengeInfo(cdp);
          lastState = info.state;
          if (info.state !== 'playing') break;
          const observable = await stageObservable(cdp);
          const k = observable.checkedSlots;
          if (k >= slots.length) break;
          const targetLane = plan[k + 1];
          const changeAt = k === 0 ? 0 : slots[k - 1].passAt + 0.03;
          if (observable.simTime >= changeAt) {
            if (observable.lane !== targetLane) {
              const delta = targetLane > observable.lane ? 1 : -1;
              await cdp.buttonPointer('[data-touch="' + (delta > 0 ? 'right' : 'left') + '"]', 'pointerdown');
              changes += 1;
              await ctx.sleep(50);
            } else {
              await ctx.sleep(35);
            }
          } else {
            await ctx.sleep(35);
          }
        }
        await cdp.waitFor("['cleared','failed'].indexOf(window.__arcadeTest.challengeInfo().state) !== -1", { timeout: 10000 });
        const info = await challengeInfo(cdp);
        assertTrue(info.state === 'cleared', 'C01 未通关：最终状态 ' + lastState + '，错误 ' + JSON.stringify(info.error));
        assertTrue(info.passedSlots === slots.length, '通过时隙数 ' + info.passedSlots + ' ≠ ' + slots.length);
        assertTrue(info.distance + 0.5 >= goalDistance, '距离 ' + info.distance + ' 未达目标 ' + goalDistance);
        assertTrue(info.failedSlot === null, '参考通关出现碰撞：' + JSON.stringify(info.error));
        const progress = await cdp.evaluate(`window.Arcade.Challenge.progress(${JSON.stringify(GAME_ID)})`);
        assertTrue(progress.cleared.indexOf(STAGE_IDS[0]) !== -1, '通关记录未写入');
        assertTrue(progress.best[STAGE_IDS[0]] && progress.best[STAGE_IDS[0]].timeSec > 0, '最佳用时未写入');
        const stages = await cdp.evaluate('window.__arcadeTest.challengeStages()');
        assertTrue(stages[1].unlocked === true, 'C01 通关后 C02 应解锁');
        const title = await cdp.text('[data-ov-title]');
        assertTrue(title.includes('挑战通关'), '通关弹层标题 ' + title);
        return { changes, passedSlots: info.passedSlots, score: info.score, nearPasses: info.nearPasses, distance: Math.round(info.distance) };
      },
    },
    {
      id: 'CH-RR-003',
      title: '极速车道·固定车阵真实碰撞失败/归因/一次点击重试',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        await enterChallenge(cdp, STAGE_IDS[0]);
        const observable = await stageObservable(cdp);
        assertTrue(observable.slots[2].occupiedLanes.indexOf(1) !== -1, 'C01 第 3 段应占用起始车道 1（设计源）');
        const deadline = Date.now() + 12000;
        let lastState = 'playing';
        while (Date.now() < deadline) {
          const info = await challengeInfo(cdp);
          lastState = info.state;
          if (info.state !== 'playing') break;
          await ctx.sleep(120);
        }
        const failed = await challengeInfo(cdp);
        assertTrue(failed.state === 'failed', '保持车道应发生碰撞，最终状态 ' + lastState);
        assertTrue(/第 3 段/.test(failed.error || '') && /车道/.test(failed.error || ''), '失败归因不含时隙/车道：' + JSON.stringify(failed.error));
        assertTrue(failed.failedSlot === 3, '失败时隙 ' + failed.failedSlot);
        const failTitle = await cdp.text('[data-ov-title]');
        assertTrue(failTitle.includes('挑战失败'), '失败弹层标题 ' + failTitle);
        assertTrue((await cdp.text('[data-ov-btn]')).trim() === '重试本关', '失败主按钮应为重试本关');
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor("window.__arcadeTest.challengeInfo().state === 'playing'", { timeout: 5000 });
        const retried = await challengeInfo(cdp);
        assertTrue(retried.stageId === STAGE_IDS[0] && retried.elapsedSec < 1 && retried.failedSlot === null, '重试未重置: ' + JSON.stringify(retried));
        return { failedSlot: failed.failedSlot, error: failed.error, retryAt: Math.round(retried.elapsedSec * 100) / 100 };
      },
    },
    {
      id: 'CH-RR-004',
      title: '极速车道·暂停不推进模拟时间 + 刷新恢复同一关',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        await enterChallenge(cdp, STAGE_IDS[0]);
        await cdp.waitFor('window.__arcadeTest.challengeInfo().elapsedSec >= 1.0', { timeout: 10000 });
        await cdp.click('[data-pause]');
        const paused = await challengeInfo(cdp);
        assertTrue(paused.state === 'paused', '暂停状态 ' + paused.state);
        await ctx.sleep(700);
        const stillPaused = await challengeInfo(cdp);
        assertTrue(Math.abs(stillPaused.elapsedSec - paused.elapsedSec) < 0.05, '暂停后模拟时间仍在推进：' + paused.elapsedSec + ' → ' + stillPaused.elapsedSec);
        assertTrue((await cdp.text('[data-ov-btn2]')).includes('退出挑战'), '暂停弹层缺少退出挑战');
        const savedShape = await cdp.evaluate(`(() => {
          const rec = window.Arcade.RunSave.get(${JSON.stringify(GAME_ID)});
          if (!rec || !rec.data) return null;
          return {
            mode: rec.data.mode,
            stageId: rec.data.stageId,
            hasChallengeState: !!(rec.data.challengeState && typeof rec.data.challengeState === 'object'),
            simTime: rec.data.challengeState ? rec.data.challengeState.chSimTime : null
          };
        })()`);
        assertTrue(savedShape && savedShape.mode === 'challenge' && savedShape.stageId === STAGE_IDS[0] && savedShape.hasChallengeState, '挑战存档结构不符合契约（mode/stageId/challengeState）: ' + JSON.stringify(savedShape));
        await cdp.navigate(ctx.base + GAME_PATH + '?ch009=CH-RR-004-resume#test');
        await cdp.waitFor("(() => { const t = document.querySelector('[data-ov-title]'); return !!t && t.textContent.includes('继续上次'); })()", { timeout: 6000 });
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor("window.__arcadeTest && window.__arcadeTest.challengeInfo().state === 'playing'", { timeout: 6000 });
        const resumed = await challengeInfo(cdp);
        assertTrue(resumed.stageId === STAGE_IDS[0], '刷新后关卡不一致：' + resumed.stageId);
        assertTrue(Math.abs(resumed.elapsedSec - paused.elapsedSec) < 0.8, '刷新后模拟时间不连续：' + paused.elapsedSec + ' → ' + resumed.elapsedSec);
        await cdp.click('[data-pause]');
        await cdp.click('[data-ov-btn2]');
        await cdp.waitFor("(() => { const layer = document.querySelector('[data-ch-layer]'); return !!layer && !layer.hidden; })()", { timeout: 4000 });
        return { pausedAt: Math.round(paused.elapsedSec * 100) / 100, resumedAt: Math.round(resumed.elapsedSec * 100) / 100 };
      },
    },
    {
      id: 'CH-RR-005',
      title: '极速车道·经典模式回归 + 390px 无溢出',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const mainText = (await cdp.text('[data-ov-btn]')).trim();
        assertTrue(mainText === '开始游戏', '经典主按钮文案 ' + JSON.stringify(mainText));
        const idle = await cdp.evaluate(`({
          hudVisible: !document.querySelector('.game-hud').hidden,
          challengeHudHidden: document.querySelector('[data-ch-hud]').hidden,
          layerHidden: document.querySelector('[data-ch-layer]').hidden
        })`);
        assertTrue(idle.hudVisible && idle.challengeHudHidden && idle.layerHidden, '开始界面 HUD 初始状态错误: ' + JSON.stringify(idle));
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor("window.__arcadeTest.joyInfo().state === 'playing'", { timeout: 5000 });
        const before = await cdp.evaluate('window.__arcadeTest.joyInfo()');
        await ctx.sleep(500);
        const after = await cdp.evaluate('window.__arcadeTest.joyInfo()');
        assertTrue(after.dist > before.dist, '经典模式距离未推进: ' + before.dist + ' → ' + after.dist);
        const challengeProgress = await cdp.evaluate(`window.Arcade.Challenge.progress(${JSON.stringify(GAME_ID)})`);
        assertTrue(challengeProgress.cleared.length === 0, '经典模式不应写入挑战记录');
        const metrics = await assertNoOverflow(cdp, 390, 844, '经典游玩');
        await resetViewport(cdp);
        return { dist: Math.round(after.dist), goal: after.goal, width: metrics.cw };
      },
    },
    {
      id: 'CH-RR-006',
      title: '极速车道·通关记录/辅助标记/解锁；挑战不写经典最高分与轮次',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const started = await cdp.evaluate(`window.__arcadeTest.startChallenge(${JSON.stringify(STAGE_IDS[0])})`);
        assertTrue(started === true, 'startChallenge 钩子返回 ' + started);
        await cdp.waitFor("window.__arcadeTest.challengeInfo().state === 'playing'", { timeout: 5000 });
        const cleared = await cdp.evaluate('window.__arcadeTest.forceStageClear(true)');
        assertTrue(cleared === true, 'forceStageClear 返回 ' + cleared);
        await ctx.sleep(120);
        const progress = await cdp.evaluate(`window.Arcade.Challenge.progress(${JSON.stringify(GAME_ID)})`);
        assertTrue(progress.cleared.indexOf(STAGE_IDS[0]) !== -1, '记录未写入');
        const best = progress.best[STAGE_IDS[0]];
        assertTrue(best && best.assisted === true, '辅助标记未写入: ' + JSON.stringify(best));
        const resultHtml = await cdp.evaluate("(() => { const t = document.querySelector('[data-ov-text]'); return t ? t.innerHTML : ''; })()");
        assertTrue(/通关/.test(resultHtml) && /辅助/.test(resultHtml), '结算未显示通关/辅助: ' + resultHtml.slice(0, 160));
        const classicSide = await cdp.evaluate(`({
          progress: window.Arcade.Progress.get(${JSON.stringify(GAME_ID)}),
          playtime: window.Arcade.Playtime.stats().games.filter((g) => g.id === ${JSON.stringify(GAME_ID)}).map((g) => ({ count: g.count, rounds: (g.rounds || []).length }))
        })`);
        assertTrue(classicSide.progress.high === 0 && classicSide.progress.plays === 0, '挑战写入了经典最高分/局数: ' + JSON.stringify(classicSide.progress));
        assertTrue(classicSide.playtime.every((row) => row.count === 0 && row.rounds === 0), '挑战写入了经典游玩轮次: ' + JSON.stringify(classicSide.playtime));
        await cdp.evaluate('window.__arcadeTest.exitChallenge()');
        await cdp.waitFor("(() => { const layer = document.querySelector('[data-ch-layer]'); return !!layer && !layer.hidden; })()", { timeout: 4000 });
        return { bestTimeSec: best.timeSec, assisted: best.assisted };
      },
    },
    {
      id: 'CH-RR-007',
      title: '极速车道·C01–C06 全关参考解真实变道通关（数据级车道证明 + 引擎回放）',
      evidence: 'real-input-replay',
      async run(cdp, ctx) {
        const results = [];
        for (let index = 0; index < TESTDATA.stages.length; index += 1) {
          results.push(await replayStage(cdp, ctx, index));
        }
        const progress = await cdp.evaluate(`window.Arcade.Challenge.progress(${JSON.stringify(GAME_ID)})`);
        assertTrue(progress.cleared.length === 6, '通关记录数 ' + progress.cleared.length + ' ≠ 6: ' + JSON.stringify(progress.cleared));
        const stages = await cdp.evaluate('window.__arcadeTest.challengeStages()');
        assertTrue(stages.every((stage) => stage.unlocked === true || progress.cleared.indexOf(stage.id) !== -1), '全通后选关状态异常');
        await cdp.evaluate('window.__arcadeTest.exitChallenge()');
        return { stages: results.length, totalChanges: results.reduce((sum, item) => sum + item.changes, 0), distances: results.map((item) => item.distance) };
      },
    },
  ],
};
