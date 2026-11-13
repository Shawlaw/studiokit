#!/usr/bin/env node
/**
 * 打地鼠（mole-whack）0.9 挑战模式确定性场景模块。
 *
 * 由 tools/arcade_gameplay_test.mjs 自动发现；默认导出
 *   { gameId, gameFile, evidence, scenarios: [{ id, title, evidence?, run(cdp, ctx) }] }
 *
 * 证据等级：
 * - CH-MW-002 参考通关使用真实指针点击（每个事件按 atSec 真实出现后点击洞口）= real-input-replay；
 * - 其余场景用 #test 钩子做确定性快进/状态断言 = engine-replay（失败/暂停/记录不冒充通关证据）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const GAME_ID = 'mole-whack';
const GAME_FILE = 'mole-whack.html';
const GAME_PATH = '/apps/arcade/games/' + GAME_FILE;

const TESTDATA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools', 'testdata', 'challenge', GAME_ID + '.json'), 'utf8'));
const STAGE_IDS = TESTDATA.stages.map((stage) => stage.id);

function stageData(stageId) {
  return TESTDATA.stages.filter((stage) => stage.id === stageId)[0] || null;
}

/** 打开开始弹层第二入口 → 选关面板 → 点击指定关卡。走真实 DOM 点击路径。 */
async function enterChallenge(cdp, stageId) {
  await cdp.click('[data-ov-btn2]');
  await cdp.waitFor("(() => { const layer = document.querySelector('[data-ch-layer]'); return !!layer && !layer.hidden; })()", { timeout: 6000 });
  const clicked = await cdp.evaluate(
    `(() => { const btn = document.querySelector('.ac-stage-btn[data-stage-id=${JSON.stringify(stageId)}]'); if (!btn || btn.disabled) return false; btn.click(); return true; })()`
  );
  assertTrue(clicked, '无法点击关卡按钮 ' + stageId);
  await cdp.waitFor("window.__arcadeTest && window.__arcadeTest.challengeInfo().state === 'playing'", { timeout: 6000 });
}

/** 用确定性钩子依次通关前置关卡，解锁目标关（解锁语义本身由 CH-MW-002 真实验证）。 */
async function unlockUntil(cdp, ctx, targetIndex) {
  for (let index = 0; index < targetIndex; index += 1) {
    const started = await cdp.evaluate(`window.__arcadeTest.startChallenge(${JSON.stringify(STAGE_IDS[index])})`);
    assertTrue(started === true, '解锁前置关卡失败：' + STAGE_IDS[index]);
    await cdp.waitFor("window.__arcadeTest.challengeInfo().state === 'playing'", { timeout: 5000 });
    const cleared = await cdp.evaluate('window.__arcadeTest.forceStageClear(false)');
    assertTrue(cleared === true, '前置关卡结算失败：' + STAGE_IDS[index]);
    await ctx.sleep(70);
  }
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

/** 320/390 无横向溢出断言（返回 {scrollWidth, clientWidth}）。 */
async function assertNoOverflow(cdp, width, height, label) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await cdp.evaluate('window.scrollTo(0, 0)');
  await new Promise((resolve) => setTimeout(resolve, 120));
  const metrics = await cdp.evaluate(`({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    bodySw: document.body ? document.body.scrollWidth : 0,
    panel: (() => { const p = document.querySelector('.ac-challenge-panel'); if (!p) return null; const r = p.getBoundingClientRect(); return { w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right) }; })()
  })`);
  assertTrue(metrics.sw <= metrics.cw + 1, label + ' ' + width + 'px 横向溢出 ' + metrics.sw + '>' + metrics.cw);
  if (metrics.panel) {
    assertTrue(metrics.panel.left >= -1 && metrics.panel.right <= metrics.cw + 1, label + ' 挑战面板越界 ' + JSON.stringify(metrics.panel));
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
      id: 'CH-MW-001',
      title: '打地鼠·6 关数据/选关锁定/返回与 320px 无溢出',
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
      id: 'CH-MW-002',
      title: '打地鼠·C01 参考通关（按事件时间轴真实点击）',
      evidence: 'real-input-replay',
      async run(cdp, ctx) {
        const reference = stageData(STAGE_IDS[0]).referencePlan;
        const expectHits = stageData(STAGE_IDS[0]).content.win.minValidHits;
        await enterChallenge(cdp, STAGE_IDS[0]);
        const info0 = await challengeInfo(cdp);
        assertTrue(info0.mode === 'challenge' && info0.stageId === STAGE_IDS[0], '未进入 C01 挑战: ' + JSON.stringify(info0));
        assertTrue(info0.goldHits === 0 && info0.bombHits === 0, '初始统计应为 0');
        const deadline = Date.now() + 45000;
        let clicks = 0;
        let lastState = 'playing';
        while (Date.now() < deadline) {
          const info = await challengeInfo(cdp);
          lastState = info.state;
          if (info.state !== 'playing') break;
          const observable = await stageObservable(cdp);
          const active = observable.events.filter((event) => event.state === 'active' && !event.hit);
          for (const event of active) {
            const hole = observable.holes[event.slot];
            await cdp.tap(hole.x, hole.y);
            clicks += 1;
            if (reference.hitEventIds.indexOf(event.id) === -1 && event.kind === 'normal') {
              throw new Error('出现了参考解之外的有效事件：' + event.id);
            }
          }
          await ctx.sleep(60);
        }
        const info = await challengeInfo(cdp);
        assertTrue(info.state === 'cleared', 'C01 未通关，最终状态 ' + lastState + '，错误 ' + JSON.stringify(info.error));
        assertTrue(info.cleared === true && info.validHits >= expectHits, '通关但有效命中不足: ' + JSON.stringify(info));
        const progress = await cdp.evaluate(`window.Arcade.Challenge.progress(${JSON.stringify(GAME_ID)})`);
        assertTrue(progress.cleared.indexOf(STAGE_IDS[0]) !== -1, '通关记录未写入: ' + JSON.stringify(progress.cleared));
        assertTrue(progress.best[STAGE_IDS[0]] && progress.best[STAGE_IDS[0]].timeSec > 0, '最佳用时未写入');
        const stages = await cdp.evaluate('window.__arcadeTest.challengeStages()');
        assertTrue(stages[1].unlocked === true, 'C01 通关后 C02 应解锁');
        const title = await cdp.text('[data-ov-title]');
        assertTrue(title.includes('挑战通关'), '通关弹层标题 ' + title);
        const progressAfter = progress.cleared.length;
        return { clicks, validHits: info.validHits, elapsedSec: Math.round(info.elapsedSec * 10) / 10, cleared: progressAfter };
      },
    },
    {
      id: 'CH-MW-003',
      title: '打地鼠·炸弹误触扣分/失败归因/一次点击重试',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const stage = stageData(STAGE_IDS[2]);
        /* C03 需要先通关 C01/C02 才解锁：用确定性钩子快速完成前两关（解锁语义由 CH-MW-002 真实验证）。 */
        for (const unlockId of [STAGE_IDS[0], STAGE_IDS[1]]) {
          const started = await cdp.evaluate(`window.__arcadeTest.startChallenge(${JSON.stringify(unlockId)})`);
          assertTrue(started === true, '解锁前置关卡失败：' + unlockId);
          await cdp.waitFor("window.__arcadeTest.challengeInfo().state === 'playing'", { timeout: 5000 });
          const cleared = await cdp.evaluate('window.__arcadeTest.forceStageClear(false)');
          assertTrue(cleared === true, '前置关卡结算失败：' + unlockId);
          await ctx.sleep(80);
        }
        /* 面板入口已在 CH-MW-001 验证；这里用钩子直接进入已解锁的 C03。 */
        const startedThird = await cdp.evaluate(`window.__arcadeTest.startChallenge(${JSON.stringify(STAGE_IDS[2])})`);
        assertTrue(startedThird === true, 'C03 解锁后仍无法进入');
        await cdp.waitFor("window.__arcadeTest.challengeInfo().state === 'playing'", { timeout: 5000 });
        const observable0 = await stageObservable(cdp);
        const bomb = observable0.events.filter((event) => event.kind === 'bomb')[0];
        assertTrue(!!bomb, 'C03 设计应包含炸弹事件');
        const scoreBefore = (await challengeInfo(cdp)).score;
        await cdp.evaluate(`window.__arcadeTest.setChallengeClock(${bomb.atSec + 0.05})`);
        await ctx.sleep(80);
        const hole = observable0.holes[bomb.slot];
        await cdp.tap(hole.x, hole.y);
        await ctx.sleep(120);
        const afterBomb = await challengeInfo(cdp);
        assertTrue(afterBomb.bombHits === 1, '炸弹命中计数 ' + afterBomb.bombHits);
        assertTrue(afterBomb.score === scoreBefore - 3, '炸弹应为 -3：' + scoreBefore + ' → ' + afterBomb.score);
        assertTrue(afterBomb.state === 'playing', '单次炸弹不应立即结束');
        await cdp.evaluate('window.__arcadeTest.setChallengeClock(window.__arcadeTest.challengeInfo().durationSec)');
        await cdp.waitFor("window.__arcadeTest.challengeInfo().state === 'failed'", { timeout: 5000 });
        const failed = await challengeInfo(cdp);
        assertTrue(/炸弹|有效/.test(failed.error || ''), '失败归因缺失：' + JSON.stringify(failed.error));
        const failTitle = await cdp.text('[data-ov-title]');
        assertTrue(failTitle.includes('挑战失败'), '失败弹层标题 ' + failTitle);
        const retryLabel = await cdp.text('[data-ov-btn]');
        assertTrue(retryLabel.trim() === '重试本关', '失败主按钮应为「重试本关」：' + JSON.stringify(retryLabel));
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor("window.__arcadeTest.challengeInfo().state === 'playing'", { timeout: 5000 });
        const retried = await challengeInfo(cdp);
        assertTrue(retried.stageId === STAGE_IDS[2] && retried.elapsedSec < 1, '重试未重置本关: ' + JSON.stringify(retried));
        return { bombAtSec: bomb.atSec, error: failed.error, retryStage: retried.stageId };
      },
    },
    {
      id: 'CH-MW-004',
      title: '打地鼠·暂停不推进模拟时间 + 刷新恢复同一关',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        await enterChallenge(cdp, STAGE_IDS[0]);
        await cdp.waitFor('window.__arcadeTest.challengeInfo().elapsedSec >= 1.2', { timeout: 10000 });
        await cdp.click('[data-pause]');
        const paused = await challengeInfo(cdp);
        assertTrue(paused.state === 'paused', '暂停状态 ' + paused.state);
        await ctx.sleep(700);
        const stillPaused = await challengeInfo(cdp);
        assertTrue(Math.abs(stillPaused.elapsedSec - paused.elapsedSec) < 0.05, '暂停后模拟时间仍在推进：' + paused.elapsedSec + ' → ' + stillPaused.elapsedSec);
        const exitLabel = await cdp.text('[data-ov-btn2]');
        assertTrue(exitLabel.includes('退出挑战'), '暂停弹层缺少退出挑战：' + JSON.stringify(exitLabel));
        const restartLabel = await cdp.text('[data-ov-btn]');
        assertTrue(restartLabel.trim() === '继续', '暂停主按钮应为继续：' + JSON.stringify(restartLabel));
        const savedShape = await cdp.evaluate(`(() => {
          const rec = window.Arcade.RunSave.get(${JSON.stringify(GAME_ID)});
          if (!rec || !rec.data) return null;
          return {
            mode: rec.data.mode,
            stageId: rec.data.stageId,
            hasChallengeState: !!(rec.data.challengeState && typeof rec.data.challengeState === 'object'),
            simTime: rec.data.challengeState ? rec.data.challengeState.chElapsed : null
          };
        })()`);
        assertTrue(savedShape && savedShape.mode === 'challenge' && savedShape.stageId === STAGE_IDS[0] && savedShape.hasChallengeState, '挑战存档结构不符合契约（mode/stageId/challengeState）: ' + JSON.stringify(savedShape));
        await cdp.navigate(ctx.base + GAME_PATH + '?ch009=CH-MW-004-resume#test');
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
      id: 'CH-MW-005',
      title: '打地鼠·经典模式回归 + 390px 无溢出',
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
        const classic = await cdp.evaluate('window.__arcadeTest.joyInfo()');
        assertTrue(classic.state === 'playing' && classic.hearts === 3 && classic.timeLeft > 44, '经典 45 秒/3 心不变量: ' + JSON.stringify(classic));
        const info = await cdp.evaluate('window.__arcadeTest.info()');
        assertTrue(Array.isArray(info.slots) && info.slots.length === 9, '经典 3×3 洞口数 ' + (info.slots && info.slots.length));
        const challengeProgress = await cdp.evaluate(`window.Arcade.Challenge.progress(${JSON.stringify(GAME_ID)})`);
        assertTrue(challengeProgress.cleared.length === 0, '经典模式不应写入挑战记录');
        const classicProgress = await cdp.evaluate(`window.Arcade.Progress.get(${JSON.stringify(GAME_ID)})`);
        assertTrue(classicProgress.high === 0, '经典模式在未结束时不应写最高分');
        const metrics = await assertNoOverflow(cdp, 390, 844, '经典游玩');
        await resetViewport(cdp);
        return { hearts: classic.hearts, slots: info.slots.length, width: metrics.cw };
      },
    },
    {
      id: 'CH-MW-006',
      title: '打地鼠·通关记录/辅助标记/解锁；挑战不写经典最高分与轮次',
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
        assertTrue(/挑战通关|通关/.test(resultHtml) && /辅助/.test(resultHtml), '结算未显示通关/辅助标记: ' + resultHtml.slice(0, 160));
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
      id: 'CH-MW-007',
      title: '打地鼠·C04 双目标同时出现：双指并点两个洞口',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const stage = stageData(STAGE_IDS[3]);
        const events = stage.content.events;
        const pair = (() => {
          for (const first of events) {
            const second = events.filter(
              (event) => event !== first && event.atSec === first.atSec && ['normal', 'gold'].indexOf(event.kind) !== -1 && ['normal', 'gold'].indexOf(first.kind) !== -1
            )[0];
            if (second && second.slot !== first.slot) return [first, second];
          }
          return null;
        })();
        assertTrue(!!pair, 'C04 设计应包含两个同时出现的有效目标');
        await unlockUntil(cdp, ctx, 3);
        const started = await cdp.evaluate(`window.__arcadeTest.startChallenge(${JSON.stringify(STAGE_IDS[3])})`);
        assertTrue(started === true, 'C04 解锁后仍无法进入');
        await cdp.waitFor("window.__arcadeTest.challengeInfo().state === 'playing'", { timeout: 5000 });
        await cdp.evaluate(`window.__arcadeTest.setChallengeClock(${pair[0].atSec + 0.03})`);
        await ctx.sleep(80);
        const observable = await stageObservable(cdp);
        const slots = pair.map((event) => observable.events.filter((item) => item.id === event.id)[0].slot);
        const holes = pair.map((event, index) => observable.holes[slots[index]]);
        const dispatched = await cdp.evaluate(`(() => {
          const canvas = document.querySelector('.game-canvas');
          const rect = canvas.getBoundingClientRect();
          const make = (x, y, id) => new PointerEvent('pointerdown', {
            pointerId: id, pointerType: 'touch', isPrimary: id === 11, bubbles: true, cancelable: true,
            clientX: rect.left + (x / 420) * rect.width, clientY: rect.top + (y / 740) * rect.height
          });
          canvas.dispatchEvent(make(${holes[0].x}, ${holes[0].y}, 11));
          canvas.dispatchEvent(make(${holes[1].x}, ${holes[1].y}, 12));
          return true;
        })()`);
        assertTrue(dispatched === true, '双指事件派发失败');
        await ctx.sleep(200);
        const info = await challengeInfo(cdp);
        const network = await stageObservable(cdp);
        const hitIds = network.events.filter((event) => event.hit).map((event) => event.id);
        assertTrue(hitIds.indexOf(pair[0].id) !== -1 && hitIds.indexOf(pair[1].id) !== -1, '双指并点未同时命中两个目标：' + JSON.stringify(hitIds));
        assertTrue(info.validHits >= 2, '双目标有效命中数 ' + info.validHits);
        await cdp.evaluate('window.__arcadeTest.forceStageFail("双指测试结束")');
        await cdp.evaluate('window.__arcadeTest.exitChallenge()');
        return { pair: pair.map((event) => event.id), slots: slots, validHits: info.validHits };
      },
    },
    {
      id: 'CH-MW-008',
      title: '打地鼠·C01–C06 全关参考解点击回放（时钟辅助真实指针）与数据可解性',
      evidence: 'engine-replay',
      async run(cdp, ctx) {
        const results = [];
        for (let index = 0; index < TESTDATA.stages.length; index += 1) {
          const stage = TESTDATA.stages[index];
          const content = stage.content;
          const win = content.win;
          const validCount = content.events.filter((event) => event.kind === 'normal' || event.kind === 'gold').length;
          const goldCount = content.events.filter((event) => event.kind === 'gold').length;
          assertTrue(validCount >= (win.minValidHits || 0), stage.id + ' 有效事件 ' + validCount + ' < 目标 ' + win.minValidHits);
          assertTrue(goldCount >= (win.minGoldHits || 0), stage.id + ' 金鼠事件 ' + goldCount + ' < 目标 ' + win.minGoldHits);
          const started = await cdp.evaluate(`window.__arcadeTest.startChallenge(${JSON.stringify(stage.id)})`);
          assertTrue(started === true, stage.id + ' 无法进入（前关未解锁？）');
          await cdp.waitFor("window.__arcadeTest.challengeInfo().state === 'playing'", { timeout: 5000 });
          const observable0 = await stageObservable(cdp);
          const plan = (stage.referencePlan.hitEventIds || [])
            .map((id) => observable0.events.filter((event) => event.id === id)[0])
            .filter(Boolean)
            .sort((a, b) => a.atSec - b.atSec);
          for (const event of plan) {
            await cdp.evaluate(`window.__arcadeTest.setChallengeClock(${event.atSec + 0.03})`);
            await ctx.sleep(55);
            const hole = observable0.holes[event.slot];
            await cdp.tap(hole.x, hole.y);
            await ctx.sleep(70);
          }
          await cdp.evaluate('window.__arcadeTest.setChallengeClock(window.__arcadeTest.challengeInfo().durationSec)');
          await cdp.waitFor("['cleared','failed'].indexOf(window.__arcadeTest.challengeInfo().state) !== -1", { timeout: 5000 });
          const info = await challengeInfo(cdp);
          assertTrue(info.state === 'cleared' && info.cleared === true, stage.id + ' 参考解未通关：' + JSON.stringify(info.error));
          results.push({ stageId: stage.id, hits: plan.length, validHits: info.validHits });
        }
        const progress = await cdp.evaluate(`window.Arcade.Challenge.progress(${JSON.stringify(GAME_ID)})`);
        assertTrue(progress.cleared.length === 6, '通关记录数 ' + progress.cleared.length + ' ≠ 6: ' + JSON.stringify(progress.cleared));
        await cdp.evaluate('window.__arcadeTest.exitChallenge()');
        return { stages: results.length, totalHits: results.reduce((sum, item) => sum + item.hits, 0) };
      },
    },
  ],
};
