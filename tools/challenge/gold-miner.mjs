/**
 * 黄金矿工（gold-miner）0.9 挑战模式确定性场景（T049）。
 *
 * 证据策略：
 * - CH-GM-002 用 #test 的 aimRelease(deg, tol) 等待真实摆角进入目标区间后调用引擎真实的
 *   releaseClaw 物理（伸出→撞取→回收→入账），按设计 referencePlan 顺序完成 C01 并达标结算；
 *   它绕过的是“人眼判断放钩时机”，没有跳过钩爪物理，因此记为 engine-replay（差距见 impl 文档）。
 * - 其余场景为 UI/记录/存档/经典回归断言。
 *
 * 只使用页面 #test 钩子与前缀固定的挑战存储；不修改游戏代码、不写其它持久数据。
 */
import fs from 'node:fs';
import path from 'node:path';

let fixtureCache = null;
function readFixture(ctx) {
  if (!fixtureCache) {
    const file = path.join(ctx.repoRoot, 'tools', 'testdata', 'challenge', 'gold-miner.json');
    fixtureCache = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return fixtureCache;
}
function stageFixture(ctx, ref) {
  const fixture = readFixture(ctx);
  return fixture.stages.find((stage) => stage.id === ref) || null;
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
    return raw && raw.games && raw.games['gold-miner'] ? raw.games['gold-miner'] : null;
  })()`);
}
async function catchWithRealSwing(cdp, angleDeg) {
  const before = await cdp.evaluate('window.__arcadeTest.challengeInfo().money');
  await cdp.evaluate('window.__arcadeTest.aimRelease(' + Number(angleDeg) + ', 2.2)');
  await cdp.waitFor('window.__arcadeTest.challengeInfo().money > ' + before, { timeout: 12000 });
  await cdp.waitFor('window.__arcadeTest.challengeInfo().clawState === "swing"', { timeout: 12000 });
  return challengeInfo(cdp);
}

export default {
  gameId: 'gold-miner',
  gameFile: 'gold-miner.html',
  evidence: 'engine-replay',
  scenarios: [
    {
      id: 'CH-GM-001',
      title: '黄金矿工·六关数据与选关锁定',
      evidence: 'ui-only',
      async setup(cdp) {
        await cdp.waitFor('typeof window.__arcadeTest.challengeStages === "function"', { timeout: 6000 });
      },
      async run(cdp, ctx) {
        const stages = await challengeStages(cdp);
        ctx.assert(Array.isArray(stages) && stages.length === 6, '挑战关卡应为 6 关，实际 ' + JSON.stringify(stages && stages.length));
        ctx.assert(stages[0].unlocked === true, 'C01 应恒解锁');
        ctx.assert(stages.slice(1).every((stage) => stage.unlocked === false), '初始只应解锁 C01');
        const startOverlay = await cdp.evaluate(`({
          title: document.querySelector('[data-ov-title]').textContent,
          main: document.querySelector('[data-ov-btn]').textContent,
          second: document.querySelector('[data-ov-btn2]').textContent
        })`);
        ctx.assert(startOverlay.title === '黄金矿工' && startOverlay.main === '开始游戏', '经典开始弹层被改动：' + JSON.stringify(startOverlay));
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
        return { stages: stages.length, unlocked: stages.filter((stage) => stage.unlocked).length, panelButtons: panel.buttons };
      },
    },
    {
      id: 'CH-GM-002',
      title: '黄金矿工·C01 参考顺序真实摆动抓取通关',
      evidence: 'engine-replay',
      async setup(cdp) {
        await cdp.waitFor('typeof window.__arcadeTest.aimRelease === "function"', { timeout: 6000 });
      },
      async run(cdp, ctx) {
        const reference = stageFixture(ctx, 'gold-miner-C01');
        ctx.assert(reference && reference.referencePlan, 'C01 测试夹具缺少 referencePlan');
        const order = reference.referencePlan.map((entry) => entry.itemId);
        const angles = Object.create(null);
        reference.referencePlan.forEach((entry) => {
          angles[entry.itemId] = entry.angleDeg;
        });
        await startChallenge(cdp, 'gold-miner-C01');
        const start = await challengeInfo(cdp);
        ctx.assert(start.stageId === 'gold-miner-C01' && start.target === 550, 'C01 目标不符：' + JSON.stringify(start));
        const observable = await cdp.evaluate('window.__arcadeTest.stageObservable()');
        const itemIds = observable.items.map((item) => item.id);
        ctx.assert(itemIds.length === 5 && itemIds.join(',') === 'm1,m2,l1,s1,r1', '固定物品布局不符：' + JSON.stringify(itemIds));
        ctx.assert(observable.tools.aim === 0 && observable.tools.winch === 0 && observable.tools.time === 0, '挑战应无可选道具：' + JSON.stringify(observable.tools));

        const caught = [];
        for (const itemId of order) {
          const info = await catchWithRealSwing(cdp, angles[itemId]);
          caught.push(itemId);
          ctx.assert(info.caught.join(',') === caught.join(','), '抓取顺序 ' + caught.join(',') + ' 实际 ' + info.caught.join(','));
        }
        const afterCatch = await challengeInfo(cdp);
        ctx.assert(afterCatch.money >= 550, '参考顺序金额未达标：$' + afterCatch.money);
        const cashout = await cdp.evaluate(`({ visible: !document.querySelector('[data-cashout]').hidden, text: document.querySelector('[data-cashout]').textContent })`);
        ctx.assert(cashout.visible && cashout.text.indexOf('结算通关') !== -1, '达标后结算按钮缺失：' + JSON.stringify(cashout));
        await cdp.click('[data-cashout]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "cleared"', { timeout: 6000 });
        const cleared = await cdp.evaluate(`({
          info: window.__arcadeTest.challengeInfo(),
          title: document.querySelector('[data-ov-title]').textContent,
          record: (() => {
            const raw = JSON.parse(localStorage.getItem('studiokit:arcade:challenge:v1') || 'null');
            return raw && raw.games && raw.games['gold-miner'] ? raw.games['gold-miner'].best['gold-miner-C01'] : null;
          })()
        })`);
        ctx.assert(cleared.info.cleared === true && cleared.title.indexOf('通关') !== -1, '通关结算弹层缺失：' + JSON.stringify(cleared.title));
        ctx.assert(cleared.record && cleared.record.timeSec > 0 && cleared.record.assisted === false, '挑战记录不符：' + JSON.stringify(cleared.record));
        ctx.assert(Array.isArray(cleared.record.collectibles) && cleared.record.collectibles.length >= 3, '收集物记录缺失：' + JSON.stringify(cleared.record.collectibles));
        const stages = await challengeStages(cdp);
        ctx.assert(stages[1].unlocked === true, 'C01 通关后 C02 未解锁');
        return {
          order: order.join('>'),
          money: afterCatch.money,
          timeSec: cleared.record.timeSec,
          collectibles: cleared.record.collectibles.length,
          evidence: 'engine-replay(aimRelease + real hook physics)',
        };
      },
    },
    {
      id: 'CH-GM-003',
      title: '黄金矿工·失败可归因与 1 次点击重试',
      evidence: 'ui-only',
      async setup(cdp) {
        await startChallenge(cdp, 'gold-miner-C01');
      },
      async run(cdp, ctx) {
        const failed = await cdp.evaluate('window.__arcadeTest.forceStageFail("倒计时归零，未达标")');
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
        ctx.assert(overlay.text.indexOf('倒计时归零') !== -1, '失败原因不可归因：' + JSON.stringify(overlay.text));
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 8000 });
        const retried = await challengeInfo(cdp);
        ctx.assert(retried.stageId === 'gold-miner-C01' && retried.timeLeft > 50, '重试未回到同关：' + JSON.stringify(retried));
        return { retryClicks: 1, reason: '倒计时归零，未达标' };
      },
    },
    {
      id: 'CH-GM-004',
      title: '黄金矿工·暂停退出与刷新恢复同一挑战关',
      evidence: 'engine-replay',
      async setup(cdp) {
        await startChallenge(cdp, 'gold-miner-C01');
      },
      async run(cdp, ctx) {
        await cdp.evaluate('window.__arcadeTest.aimRelease(0.8, 2.2)');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().clawState !== "swing"', { timeout: 8000 });
        await cdp.waitFor('window.__arcadeTest.challengeInfo().clawState === "swing"', { timeout: 12000 });
        await cdp.click('[data-pause]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "paused"', { timeout: 4000 });
        const paused = await cdp.evaluate(`({ title: document.querySelector('[data-ov-title]').textContent, second: document.querySelector('[data-ov-btn2]').textContent })`);
        ctx.assert(paused.title.indexOf('已暂停') !== -1 && paused.second === '退出挑战', '暂停弹层不符合契约：' + JSON.stringify(paused));
        const savedMode = await cdp.evaluate(`(() => {
          const raw = JSON.parse(localStorage.getItem('studiokit:arcade:runs:v1') || 'null');
          return raw && raw.games && raw.games['gold-miner'] ? raw.games['gold-miner'].data.mode : null;
        })()`);
        ctx.assert(savedMode === 'challenge', '局内存档 mode 不是 challenge：' + savedMode);
        await cdp.navigate(ctx.base + '/apps/arcade/games/gold-miner.html?resume=1#test');
        const prompt = await cdp.evaluate(`document.querySelector('[data-ov-title]').textContent`);
        ctx.assert(prompt.indexOf('继续') !== -1, '刷新后未出现续玩提示：' + prompt);
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 8000 });
        const restored = await challengeInfo(cdp);
        ctx.assert(restored.mode === 'challenge' && restored.stageId === 'gold-miner-C01', '刷新恢复的挑战关不符：' + JSON.stringify(restored));
        ctx.assert(restored.timeLeft > 0 && restored.timeLeft <= 60, '刷新恢复剩余时间异常：' + restored.timeLeft);
        return { restoredStage: restored.stageId, timeLeft: Math.round(restored.timeLeft), pausedMode: savedMode };
      },
    },
    {
      id: 'CH-GM-005',
      title: '黄金矿工·经典模式零回归（入口/道具/第 1 关）',
      evidence: 'ui-only',
      async run(cdp, ctx) {
        const before = await cdp.evaluate(`({
          title: document.querySelector('[data-ov-title]').textContent,
          main: document.querySelector('[data-ov-btn]').textContent,
          second: document.querySelector('[data-ov-btn2]').textContent
        })`);
        ctx.assert(before.main === '开始游戏' && before.second === '挑战 6 关', '开始弹层入口不符：' + JSON.stringify(before));
        await cdp.click('[data-ov-btn]');
        await cdp.waitFor('window.__arcadeTest.info().timeLeft < 60', { timeout: 8000 });
        const classic = await cdp.evaluate(`(() => {
          const info = window.__arcadeTest.info();
          const used = window.__arcadeTest.useToolNow('time');
          return { info, used, after: window.__arcadeTest.info(), mode: window.__arcadeTest.stageObservable().mode, chHudHidden: document.querySelector('[data-ch-hud]').hidden };
        })()`);
        ctx.assert(classic.mode === 'classic', '经典模式 mode 不符：' + classic.mode);
        ctx.assert(classic.info.level === 1 && classic.info.money === 0 && classic.info.target === 650, '经典第 1 关初始化不符：' + JSON.stringify(classic.info));
        ctx.assert(classic.chHudHidden === true, '经典模式仍显示挑战 HUD');
        ctx.assert(classic.used === true && classic.after.tools.time === 0 && classic.after.timeLeft > classic.info.timeLeft, '经典加时道具失效：' + JSON.stringify({ used: classic.used, after: classic.after.tools, time: [classic.info.timeLeft, classic.after.timeLeft] }));
        return { level: classic.info.level, target: classic.info.target, toolsBefore: classic.info.tools };
      },
    },
    {
      id: 'CH-GM-006',
      title: '黄金矿工·320/390 挑战面板无横向溢出',
      evidence: 'ui-only',
      async run(cdp, ctx) {
        const results = [];
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
          results.push({ width, docOverflow: layout.docOverflow, minButtonHeight: Math.round(layout.minButtonHeight) });
          await cdp.evaluate('window.__arcadeTest.exitChallenge ? window.__arcadeTest.exitChallenge() : true');
        }
        return { layouts: results };
      },
    },
    {
      id: 'CH-GM-007',
      title: '黄金矿工·C02–C06 参考顺序确定性回放通关',
      evidence: 'engine-replay',
      async setup(cdp) {
        await cdp.waitFor('typeof window.__arcadeTest.advanceChallenge === "function"', { timeout: 6000 });
        await cdp.evaluate(`(() => {
          Arcade.Challenge.markCleared('gold-miner', 'gold-miner-C01', { timeSec: 6.5 });
          return true;
        })()`);
      },
      async run(cdp, ctx) {
        const refs = ['gold-miner-C02', 'gold-miner-C03', 'gold-miner-C04', 'gold-miner-C05', 'gold-miner-C06'];
        const results = [];
        for (const ref of refs) {
          const stage = stageFixture(ctx, ref);
          ctx.assert(stage && Array.isArray(stage.referencePlan), ref + ' 夹具缺少 referencePlan');
          const order = stage.referencePlan.map((entry) => entry.itemId);
          const angles = Object.create(null);
          stage.referencePlan.forEach((entry) => {
            angles[entry.itemId] = entry.angleDeg;
          });
          const replay = await cdp.evaluate(`(() => {
            const t = window.__arcadeTest;
            const order = ${JSON.stringify(order)};
            const angles = ${JSON.stringify(angles)};
            const started = t.startChallenge(${JSON.stringify(ref)});
            if (!started) return { started: false };
            const caught = [];
            const failures = [];
            for (const itemId of order) {
              t.aimRelease(angles[itemId], 2.2);
              let ok = false;
              for (let i = 0; i < 120 && !ok; i += 1) {
                t.advanceChallenge(0.25);
                const info = t.challengeInfo();
                ok = info.caught.indexOf(itemId) !== -1;
                if (info.state !== 'playing') break;
              }
              if (!ok) { failures.push(itemId); break; }
              caught.push(itemId);
            }
            const before = t.challengeInfo();
            const money = before.money;
            const cashout = document.querySelector('[data-cashout]');
            const ready = cashout && !cashout.hidden;
            if (ready) cashout.click();
            const final = t.challengeInfo();
            return {
              started,
              caught,
              failures,
              money,
              ready,
              state: final.state,
              cleared: final.cleared,
              stageId: final.stageId,
              timeLeft: final.timeLeft,
              title: document.querySelector('[data-ov-title]').textContent
            };
          })()`);
          ctx.assert(replay.started === true, ref + ' 未能进入挑战');
          ctx.assert(replay.failures.length === 0 && replay.caught.join(',') === order.join(','), ref + ' 参考顺序抓取失败：' + JSON.stringify(replay));
          ctx.assert(replay.cleared === true && replay.state === 'cleared', ref + ' 未通关：' + JSON.stringify(replay));
          ctx.assert(replay.timeLeft > 0, ref + ' 回放在时限内未完成：' + JSON.stringify(replay));
          results.push({ id: ref, order: order.join('>'), money: replay.money, timeLeft: Math.round(replay.timeLeft) });
          await ctx.sleep(120);
        }
        const record = await readChallengeRecord(cdp);
        const clearedIds = refs.filter((ref) => record && record.best[ref]);
        ctx.assert(clearedIds.length === refs.length, '回放记录缺失：' + JSON.stringify(record && record.best));
        return {
          stages: results.map((item) => item.id).join(','),
          detail: results,
          evidence: 'engine-replay(aimRelease + advanceChallenge, real hook physics)',
        };
      },
    },
  ],
};
