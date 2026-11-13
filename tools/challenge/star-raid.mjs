/**
 * 星海突击（star-raid）0.9 挑战模式确定性场景（T049）。
 *
 * 证据策略：
 * - CH-SR-002 / CH-SR-003 用 #test 的 advanceChallenge(seconds)（固定 1/60 步长按真实 update 推进）
 *   与 setPlayerPos 把玩家放在设计 safeBandXRatio 的安全走廊中心，按固定波次时间轴回放；
 *   断言零伤害、攻击段敌弹全部落在安全走廊之外、Boss 阶段/弱点窗口可观测。
 *   它绕过的是“真人拖动躲避”，但完整跑了引擎的敌弹生成/碰撞/伤害与 Boss HP/阶段逻辑，
 *   因此记为 engine-replay（差距见 impl 文档）。
 * - 其余场景为 UI/记录/存档/经典回归断言。
 */
import fs from 'node:fs';
import path from 'node:path';

let fixtureCache = null;
function readFixture(ctx) {
  if (!fixtureCache) {
    const file = path.join(ctx.repoRoot, 'tools', 'testdata', 'challenge', 'star-raid.json');
    fixtureCache = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return fixtureCache;
}

async function challengeStages(cdp) {
  return cdp.evaluate('window.__arcadeTest.challengeStages()');
}
async function challengeInfo(cdp) {
  return cdp.evaluate('window.__arcadeTest.challengeInfo()');
}
async function startChallenge(cdp, ref) {
  const started = await cdp.evaluate('window.__arcadeTest.startChallenge(' + JSON.stringify(ref) + ')');
  await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 8000 });
  return started;
}
async function readChallengeRecord(cdp) {
  return cdp.evaluate(`(() => {
    const raw = JSON.parse(localStorage.getItem('studiokit:arcade:challenge:v1') || 'null');
    return raw && raw.games && raw.games['star-raid'] ? raw.games['star-raid'] : null;
  })()`);
}

/** 在页面内一次性完成“按事件时间轴移动 + 推进”回放，返回每段可观测证据。 */
async function replayStage(cdp, stageRef) {
  return cdp.evaluate(`(() => {
    const t = window.__arcadeTest;
    const started = t.startChallenge(${JSON.stringify(stageRef)});
    if (!started) return { started: false };
    const steps = [];
    let guard = 0;
    while (t.challengeInfo().state === 'playing' && guard++ < 800) {
      const obs = t.stageObservable();
      const next = obs.events.find((ev) => !ev.started);
      if (next) {
        t.advanceChallenge(Math.max(0, next.atSec - obs.time + 0.02));
        const current = t.stageObservable();
        const band = (current.events.find((ev) => ev.id === next.id) || {}).safeBand;
        if (band) t.setPlayerPos(band.center * 420, 690);
        const after = t.stageObservable();
        const unsafe = !!(after.safeBand && (after.shots || []).some((shot) =>
          shot.x + shot.r > after.safeBand.left + 0.5 && shot.x - shot.r < after.safeBand.right - 0.5));
        steps.push({ event: next.id, time: Math.round(after.time * 10) / 10, health: after.health, unsafe });
        continue;
      }
      t.advanceChallenge(1.5);
    }
    const final = t.stageObservable();
    return {
      started: true,
      steps,
      final: {
        mode: final.mode,
        stageId: final.stageId,
        state: final.state,
        time: Math.round(final.time * 10) / 10,
        health: final.health,
        damage: final.damageLog,
        bossDefeated: final.bossDefeated,
        bossMaxPhase: final.bossMaxPhase,
        bossExposedSeconds: final.bossExposedSeconds,
        bossHits: final.bossHits,
        eventsDone: final.eventsDone,
        eventsTotal: final.eventsTotal,
        endCondition: final.endCondition,
        title: document.querySelector('[data-ov-title]').textContent,
      },
    };
  })()`);
}

export default {
  gameId: 'star-raid',
  gameFile: 'star-raid.html',
  evidence: 'engine-replay',
  scenarios: [
    {
      id: 'CH-SR-001',
      title: '星海突击·六关数据与选关锁定',
      evidence: 'ui-only',
      async setup(cdp) {
        await cdp.waitFor('typeof window.__arcadeTest.challengeStages === "function"', { timeout: 6000 });
      },
      async run(cdp, ctx) {
        const stages = await challengeStages(cdp);
        ctx.assert(Array.isArray(stages) && stages.length === 6, '挑战关卡应为 6 关，实际 ' + JSON.stringify(stages && stages.length));
        ctx.assert(stages[0].unlocked === true && stages.slice(1).every((stage) => stage.unlocked === false), '初始解锁状态不符');
        const runtime = await cdp.evaluate(`(() => Arcade.Challenge.stages('star-raid').map((stage) => ({
          id: stage.id,
          duration: stage.content.stageDurationSec,
          events: stage.content.events.length,
          features: stage.requiredFeatures,
          end: stage.content.endCondition
        })))()`);
        ctx.assert(runtime.every((stage) => stage.features.indexOf('fixed_wave_timeline') !== -1), '缺少固定波次时间轴特性：' + JSON.stringify(runtime.map((stage) => stage.features)));
        const bossStages = runtime.filter((stage) => stage.end === 'defeat-boss');
        ctx.assert(bossStages.length === 2 && bossStages.every((stage) => stage.features.indexOf('boss_phase_script') !== -1), 'C05/C06 Boss 阶段特性不符：' + JSON.stringify(bossStages));
        const startOverlay = await cdp.evaluate(`({
          title: document.querySelector('[data-ov-title]').textContent,
          main: document.querySelector('[data-ov-btn]').textContent,
          second: document.querySelector('[data-ov-btn2]').textContent
        })`);
        ctx.assert(startOverlay.title === '星海突击' && startOverlay.main === '开始游戏', '经典开始弹层被改动：' + JSON.stringify(startOverlay));
        ctx.assert(startOverlay.second === '挑战 6 关', '挑战第二入口缺失：' + JSON.stringify(startOverlay));
        const opened = await cdp.evaluate('window.__arcadeTest.openChallengePanel()');
        ctx.assert(opened === true, 'openChallengePanel() 返回 ' + opened);
        const panel = await cdp.evaluate(`({
          visible: !document.querySelector('[data-ch-panel]').hidden,
          buttons: document.querySelectorAll('[data-ch-panel] .ac-stage-btn').length,
          locked: document.querySelectorAll('[data-ch-panel] .ac-stage-btn.is-locked').length,
          back: !!document.querySelector('[data-ch-panel] [data-ch-back]')
        })`);
        ctx.assert(panel.visible && panel.buttons === 6 && panel.locked === 5 && panel.back, '选关面板不符合契约：' + JSON.stringify(panel));
        return { stages: stages.length, bossStages: bossStages.map((stage) => stage.id), panelButtons: panel.buttons };
      },
    },
    {
      id: 'CH-SR-002',
      title: '星海突击·C01 固定波次安全走廊回放通关',
      evidence: 'engine-replay',
      async setup(cdp) {
        await cdp.waitFor('typeof window.__arcadeTest.advanceChallenge === "function"', { timeout: 6000 });
      },
      async run(cdp, ctx) {
        const fixture = readFixture(ctx);
        const stage = fixture.stages.find((item) => item.id === 'star-raid-C01');
        ctx.assert(stage && stage.content.events.length === 5, 'C01 设计源事件数不符');
        const replay = await replayStage(cdp, 'star-raid-C01');
        ctx.assert(replay.started === true, 'C01 挑战未能开始');
        ctx.assert(replay.final.state === 'cleared', 'C01 回放未通关：' + JSON.stringify(replay.final));
        ctx.assert(replay.final.health === 3 && replay.final.damage.length === 0, 'C01 回放出现伤害：' + JSON.stringify({ health: replay.final.health, damage: replay.final.damage }));
        ctx.assert(replay.steps.length === 5 && replay.steps.every((step) => step.unsafe === false), '攻击段敌弹进入安全走廊：' + JSON.stringify(replay.steps));
        ctx.assert(replay.final.eventsDone === replay.final.eventsTotal && replay.final.title.indexOf('通关') !== -1, '事件/结算不符：' + JSON.stringify(replay.final));
        const record = await readChallengeRecord(cdp);
        ctx.assert(record && record.best['star-raid-C01'] && record.best['star-raid-C01'].timeSec >= 35, 'C01 记录缺失或时间异常：' + JSON.stringify(record && record.best));
        const stages = await challengeStages(cdp);
        ctx.assert(stages[1].unlocked === true, 'C01 通关后 C02 未解锁');
        return {
          events: replay.steps.map((step) => step.event).join('>'),
          clearTimeSec: Math.round(replay.final.time * 10) / 10,
          health: replay.final.health,
          unsafeSteps: replay.steps.filter((step) => step.unsafe).length,
          evidence: 'engine-replay(advanceChallenge + safeBand positioning)',
        };
      },
    },
    {
      id: 'CH-SR-003',
      title: '星海突击·C05/C06 Boss 双翼弱点与两阶段回放',
      evidence: 'engine-replay',
      async setup(cdp) {
        await cdp.waitFor('typeof window.__arcadeTest.advanceChallenge === "function"', { timeout: 6000 });
        /* 用平台 API 写入 C01–C04 挑战记录以解锁 C05（记录写入不是玩法证据，Boss 战本身仍走真实引擎）。 */
        await cdp.evaluate(`(() => {
          for (let i = 1; i <= 4; i += 1) Arcade.Challenge.markCleared('star-raid', 'star-raid-C0' + i, { timeSec: 10 });
          return true;
        })()`);
      },
      async run(cdp, ctx) {
        const unlocked = await challengeStages(cdp);
        ctx.assert(unlocked[4].unlocked === true, 'C05 未解锁：' + JSON.stringify(unlocked.map((stage) => stage.unlocked)));
        const c05 = await replayStage(cdp, 'star-raid-C05');
        ctx.assert(c05.started && c05.final.state === 'cleared', 'C05 回放未通关：' + JSON.stringify(c05.final));
        ctx.assert(c05.final.bossDefeated === true && c05.final.bossMaxPhase >= 1, 'C05 Boss 未击败/阶段不可观测：' + JSON.stringify({ defeated: c05.final.bossDefeated, phase: c05.final.bossMaxPhase }));
        ctx.assert(c05.final.bossExposedSeconds >= 5, 'C05 弱点暴露窗口不足：' + c05.final.bossExposedSeconds);
        ctx.assert(c05.final.health === 3 && c05.final.damage.length === 0, 'C05 回放出现伤害：' + JSON.stringify(c05.final.damage));
        const c06 = await replayStage(cdp, 'star-raid-C06');
        ctx.assert(c06.started && c06.final.state === 'cleared', 'C06 回放未通关：' + JSON.stringify(c06.final));
        ctx.assert(c06.final.bossMaxPhase >= 2, 'C06 未观测到第 2 阶段：' + c06.final.bossMaxPhase);
        ctx.assert(c06.final.health === 3 && c06.final.damage.length === 0, 'C06 回放出现伤害：' + JSON.stringify(c06.final.damage));
        const record = await readChallengeRecord(cdp);
        ctx.assert(record && record.best['star-raid-C05'] && record.best['star-raid-C06'], 'Boss 关记录缺失：' + JSON.stringify(record && record.best));
        return {
          c05: { phase: c05.final.bossMaxPhase, exposedSec: c05.final.bossExposedSeconds, hits: c05.final.bossHits, time: c05.final.time },
          c06: { phase: c06.final.bossMaxPhase, exposedSec: c06.final.bossExposedSeconds, hits: c06.final.bossHits, time: c06.final.time },
          evidence: 'engine-replay(advanceChallenge + safeBand positioning)',
        };
      },
    },
    {
      id: 'CH-SR-004',
      title: '星海突击·失败可归因与 1 次点击重试',
      evidence: 'ui-only',
      async setup(cdp) {
        await startChallenge(cdp, 'star-raid-C01');
      },
      async run(cdp, ctx) {
        const failed = await cdp.evaluate('window.__arcadeTest.forceStageFail("机体损毁 · 生命归零")');
        ctx.assert(failed === true, 'forceStageFail 未返回 true');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "failed"', { timeout: 6000 });
        const overlay = await cdp.evaluate(`({
          title: document.querySelector('[data-ov-title]').textContent,
          text: document.querySelector('[data-ov-text]').textContent,
          main: document.querySelector('[data-ov-btn]').textContent,
          second: document.querySelector('[data-ov-btn2]').textContent
        })`);
        ctx.assert(overlay.title === '挑战失败', '失败标题不符：' + JSON.stringify(overlay));
        ctx.assert(overlay.main === '重试本关' && overlay.second === '返回选关', '失败按钮不符：' + JSON.stringify(overlay));
        ctx.assert(overlay.text.indexOf('生命归零') !== -1, '失败原因不可归因：' + JSON.stringify(overlay.text));
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 8000 });
        const retried = await challengeInfo(cdp);
        ctx.assert(retried.stageId === 'star-raid-C01' && retried.health === 3, '重试未回到同关/满血：' + JSON.stringify(retried));
        return { retryClicks: 1, reason: '机体损毁 · 生命归零' };
      },
    },
    {
      id: 'CH-SR-005',
      title: '星海突击·暂停退出与刷新恢复同一挑战关',
      evidence: 'engine-replay',
      async setup(cdp) {
        await startChallenge(cdp, 'star-raid-C01');
      },
      async run(cdp, ctx) {
        await cdp.evaluate('window.__arcadeTest.advanceChallenge(2.5)');
        const before = await challengeInfo(cdp);
        await cdp.click('[data-pause]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "paused"', { timeout: 4000 });
        const paused = await cdp.evaluate(`({ title: document.querySelector('[data-ov-title]').textContent, second: document.querySelector('[data-ov-btn2]').textContent })`);
        ctx.assert(paused.title.indexOf('已暂停') !== -1 && paused.second === '退出挑战', '暂停弹层不符合契约：' + JSON.stringify(paused));
        const savedMode = await cdp.evaluate(`(() => {
          const raw = JSON.parse(localStorage.getItem('studiokit:arcade:runs:v1') || 'null');
          return raw && raw.games && raw.games['star-raid'] ? raw.games['star-raid'].data.mode : null;
        })()`);
        ctx.assert(savedMode === 'challenge', '局内存档 mode 不是 challenge：' + savedMode);
        await cdp.navigate(ctx.base + '/apps/arcade/games/star-raid.html?resume=1#test');
        const prompt = await cdp.evaluate(`document.querySelector('[data-ov-title]').textContent`);
        ctx.assert(prompt.indexOf('继续') !== -1, '刷新后未出现续玩提示：' + prompt);
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 8000 });
        const restored = await challengeInfo(cdp);
        ctx.assert(restored.mode === 'challenge' && restored.stageId === 'star-raid-C01', '刷新恢复的挑战关不符：' + JSON.stringify(restored));
        ctx.assert(restored.elapsedSec >= before.elapsedSec - 0.5, '刷新后挑战时间回退：' + JSON.stringify({ before: before.elapsedSec, after: restored.elapsedSec }));
        return { restoredStage: restored.stageId, elapsedSec: restored.elapsedSec, pausedMode: savedMode };
      },
    },
    {
      id: 'CH-SR-006',
      title: '星海突击·经典零回归与 320/390 面板无溢出',
      evidence: 'ui-only',
      async run(cdp, ctx) {
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.info().state === "playing"', { timeout: 8000 });
        const classic = await cdp.evaluate(`({
          info: window.__arcadeTest.info(),
          hasChallengeClass: document.body.classList.contains('has-challenge'),
          chHudHidden: document.querySelector('[data-ch-hud]').hidden
        })`);
        ctx.assert(classic.info.state === 'playing' && classic.info.stage === 1 && classic.info.lives === 3, '经典模式初始化不符：' + JSON.stringify(classic.info));
        ctx.assert(classic.hasChallengeClass === false && classic.chHudHidden === true, '经典模式残留挑战 chrome');
        const layouts = [];
        for (const width of [320, 390]) {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width === 320 ? 568 : 844, deviceScaleFactor: 1, mobile: true });
          await ctx.sleep(120);
          await cdp.evaluate('window.__arcadeTest.openChallengePanel()');
          await ctx.sleep(140);
          const layout = await cdp.evaluate(`(() => {
            const panel = document.querySelector('[data-ch-panel]');
            const buttons = [...panel.querySelectorAll('.ac-stage-btn')];
            const rect = (el) => el.getBoundingClientRect();
            return {
              width: window.innerWidth,
              docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              panelOverflow: panel.scrollWidth - panel.clientWidth,
              minButtonHeight: Math.min(...buttons.map((button) => rect(button).height)),
              maxRight: Math.max(...buttons.map((button) => rect(button).right))
            };
          })()`);
          ctx.assert(layout.docOverflow <= 1, width + 'px 页面横向溢出 ' + layout.docOverflow);
          ctx.assert(layout.panelOverflow <= 1, width + 'px 面板横向溢出 ' + layout.panelOverflow);
          ctx.assert(layout.minButtonHeight >= 44, width + 'px 关卡按钮高度 ' + layout.minButtonHeight);
          ctx.assert(layout.maxRight <= layout.width + 1, width + 'px 按钮越界 ' + JSON.stringify(layout));
          layouts.push({ width, docOverflow: layout.docOverflow, minButtonHeight: Math.round(layout.minButtonHeight) });
          await cdp.evaluate('window.__arcadeTest.exitChallenge()');
        }
        return { classicStage: classic.info.stage, layouts };
      },
    },
    {
      id: 'CH-SR-007',
      title: '星海突击·C02–C04 固定波次安全走廊回放通关',
      evidence: 'engine-replay',
      async setup(cdp) {
        await cdp.waitFor('typeof window.__arcadeTest.advanceChallenge === "function"', { timeout: 6000 });
        await cdp.evaluate(`(() => {
          Arcade.Challenge.markCleared('star-raid', 'star-raid-C01', { timeSec: 35 });
          return true;
        })()`);
      },
      async run(cdp, ctx) {
        const refs = ['star-raid-C02', 'star-raid-C03', 'star-raid-C04'];
        const results = [];
        for (const ref of refs) {
          const fixture = readFixture(ctx);
          const stage = fixture.stages.find((item) => item.id === ref);
          ctx.assert(stage && Array.isArray(stage.content.events), ref + ' 夹具缺少 events');
          const replay = await replayStage(cdp, ref);
          ctx.assert(replay.started === true, ref + ' 未能进入挑战');
          ctx.assert(replay.final.state === 'cleared', ref + ' 回放未通关：' + JSON.stringify(replay.final));
          ctx.assert(replay.final.health === 3 && replay.final.damage.length === 0, ref + ' 回放出现伤害：' + JSON.stringify(replay.final.damage));
          ctx.assert(replay.steps.length === stage.content.events.length, ref + ' 事件数不符：' + JSON.stringify(replay.steps.map((step) => step.event)));
          ctx.assert(replay.steps.every((step) => step.unsafe === false), ref + ' 敌弹进入安全走廊：' + JSON.stringify(replay.steps.filter((step) => step.unsafe)));
          results.push({ id: ref, clearTime: Math.round(replay.final.time * 10) / 10, events: replay.steps.length });
          await ctx.sleep(100);
        }
        const record = await readChallengeRecord(cdp);
        ctx.assert(refs.every((ref) => record && record.best[ref]), 'C02–C04 回放记录缺失：' + JSON.stringify(record && record.best));
        return {
          stages: results.map((item) => item.id).join(','),
          clearTimes: results.map((item) => item.clearTime).join('/'),
          evidence: 'engine-replay(advanceChallenge + safeBand positioning)',
        };
      },
    },
  ],
};
