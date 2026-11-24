import path from 'node:path';
const REPO = 'D:/LocalAgentWorkspace/StudioKit';
const { startServer, launchChrome, openPage, stopChrome, sleep } = await import('file:///' + path.join(REPO, 'tools/lib/arcade_cdp.mjs').replace(/\\/g, '/'));
const PORT = 9040, CDP = 9640;
const server = await startServer({ port: PORT });
const launched = await launchChrome({ port: CDP, profilePrefix: 'review3-regression-' });
let failures = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 1400) : '')); if (!ok) failures += 1; };
const BASE = `http://127.0.0.1:${PORT}`;
async function ready(page) {
  await page.waitFor('window.ArcadeCareer && window.ArcadeCareer.ready');
  await page.evaluate('window.ArcadeCareer.ready');
  await page.waitFor('window.ArcadeCareer.available === true', { timeout: 15000 });
}
async function pageOf() {
  const page = await openPage({ port: CDP, width: 430, height: 900, mobile: true });
  await page.navigate(`${BASE}/apps/arcade/games/pendulum-tower.html?careerTest=1#test`);
  await ready(page);
  return page;
}
async function careerOf(page) { return page.evaluate(`(async () => (await window.__arcadeCareerTest.db().ensureCareer({})).careerId)()`); }
async function resetTo(page) {
  const c = await careerOf(page);
  await page.evaluate(`(async () => { const db = window.__arcadeCareerTest.db(); await db.resetCareer(${JSON.stringify(c)}); await db.ensureCareer({}); })()`);
  await page.navigate(`${BASE}/apps/arcade/games/pendulum-tower.html?careerTest=1#test`);
  await ready(page);
  return careerOf(page);
}
try {
  /* 1) 已 claimed 的 run 不能被迟到失败/放弃写回。 */
  {
    const page = await pageOf();
    const result = await page.evaluate(`(async () => {
      const db = window.__arcadeCareerTest.db();
      const c = await db.ensureCareer({});
      await ArcadeCareer.openTown();
      const t = await ArcadeCareer.commission.start({ commissionId: 'pendulum-tower.T1' });
      for (let i = 0; i < 4; i += 1) ArcadeCareer.commission.recordEvent(t.ticketId, { kind: 'tower.floor_stable', payload: { floor: i + 1 }, seq: i + 1, sourceMode: 'commission' });
      const settled = await ArcadeCareer.commission.settle({ ticketId: t.ticketId, outcome: 'won', stats: {} });
      const lateFail = await db.updateRun(t.ticketId, { status: 'failed', reason: 'late-failure' });
      const run = await db.getRun(t.ticketId);
      return { settled, lateFail, run };
    })()`);
    check('P1.1 claimed run 拒绝迟到 failed 写回', result.settled.ok === true && result.lateFail.ok === false && result.run.status === 'claimed', { lateFail: result.lateFail, runStatus: result.run && result.run.status });
  }

  /* 2) 遗留 reservation 不能卡死新票据：正常修复入口清掉无收据占位。 */
  {
    const page = await pageOf();
    const result = await page.evaluate(`(async () => {
      const db = window.__arcadeCareerTest.db();
      const c = await db.ensureCareer({});
      const marker = 'ending-reservation:' + c.careerId;
      const reserve = await db.reserveEnding({ careerId: c.careerId, markerId: marker, ticketId: 'commission-stale-owner', approach: 'combat' });
      const repair = typeof db.repairEndingRecords === 'function' ? await db.repairEndingRecords({ careerId: c.careerId }) : { ok: false, reason: 'missing-repair' };
      const second = await db.reserveEnding({ careerId: c.careerId, markerId: marker, ticketId: 'commission-new', approach: 'rescue' });
      return { reserve, repair, second };
    })()`);
    check('P1.2 遗留无收据 reservation 可由正常修复入口清理', result.reserve.ok === true && result.repair.ok === true && result.second.ok === true, result);
  }

  /* 3) 首通按第一笔成功提交：B 先提交 90，A 后提交 75；旧 marker 不消耗首通。 */
  {
    const a = await pageOf();
    const b = await pageOf();
    const career = await resetTo(a);
    await b.navigate(`${BASE}/apps/arcade/games/pendulum-tower.html?careerTest=1#test`);
    await ready(b);
    const aTicket = await a.evaluate(`(async () => { await ArcadeCareer.openTown(); const t = await ArcadeCareer.commission.start({ commissionId: 'pendulum-tower.T1' }); return t.ticketId; })()`);
    const bTicket = await b.evaluate(`(async () => { await ArcadeCareer.openTown(); const t = await ArcadeCareer.commission.start({ commissionId: 'pendulum-tower.T1' }); return t.ticketId; })()`);
    await a.evaluate(`window.__arcadeCareerTest.db().reserveCommissionFirstClear({ careerId: ${JSON.stringify(career)}, commissionId: 'pendulum-tower.T1', ticketId: ${JSON.stringify(aTicket)} })`);
    await a.evaluate(`(async () => { for (let i = 0; i < 4; i += 1) ArcadeCareer.commission.recordEvent(${JSON.stringify(aTicket)}, { kind: 'tower.floor_stable', payload: { floor: i + 1 }, seq: i + 1, sourceMode: 'commission' }); })()`);
    const bSettled = await b.evaluate(`(async () => { for (let i = 0; i < 4; i += 1) ArcadeCareer.commission.recordEvent(${JSON.stringify(bTicket)}, { kind: 'tower.floor_stable', payload: { floor: i + 1 }, seq: i + 1, sourceMode: 'commission' }); return ArcadeCareer.commission.settle({ ticketId: ${JSON.stringify(bTicket)}, outcome: 'won', stats: {} }); })()`);
    const aSettled = await a.evaluate(`(async () => ArcadeCareer.commission.settle({ ticketId: ${JSON.stringify(aTicket)}, outcome: 'won', stats: {} }))()`);
    const final = await a.evaluate(`(async () => { const db = window.__arcadeCareerTest.db(); const quests = await db.readQuestState(${JSON.stringify(career)}); return { q: quests.quests.filter((row) => row.nodeId === 'pendulum-tower.T1')[0] || null, wallet: (await db.readWallet(${JSON.stringify(career)})).credits }; })()`);
    check('P2.3 首通按提交顺序 B=90、A=75，旗标/证据/首通引用持久', bSettled && bSettled.receipt && bSettled.receipt.credits === 90 && aSettled && aSettled.receipt && aSettled.receipt.credits === 75 && final.q && (final.q.flags || []).indexOf('C1.work_done') >= 0 && (final.q.evidence || []).indexOf('E-C1-site') >= 0 && typeof final.q.firstClearReceiptId === 'string', { b: bSettled && bSettled.receipt, a: aSettled && aSettled.receipt, q: final.q });
  }

  /* 4) 另一页结算不能用旧快照重新打开已关闭提示。 */
  {
    const a = await pageOf();
    const b = await pageOf();
    const career = await resetTo(a);
    await b.navigate(`${BASE}/apps/arcade/games/memory-flip.html?careerTest=1#test`);
    await ready(b);
    const before = await b.evaluate(`(async () => ((await window.__arcadeCareerTest.db().getDiscoveryState()) || {}).hintsEnabled)()`);
    const off = await a.evaluate(`window.ArcadeCareer.setHintsEnabled(false)`);
    await sleep(200);
    const afterA = await a.evaluate(`(async () => ((await window.__arcadeCareerTest.db().getDiscoveryState()) || {}).hintsEnabled)()`);
    const settled = await b.evaluate(`(async () => { const C = window.ArcadeCareer; C.observe('pair.match', { symbol: 'A', level: 1, moves: 1 }); C.observe('pair.match', { symbol: 'B', level: 2, moves: 2 }); return C.finish({ mode: 'classic', outcome: 'won', stats: { level: 1, moves: 2, score: 20 } }); })()`);
    await sleep(200);
    const afterB = await b.evaluate(`(async () => ((await window.__arcadeCareerTest.db().getDiscoveryState()) || {}).hintsEnabled)()`);
    check('P2.5 关闭提示后另一页结算不会把 hintsEnabled 写回 true', before === true && off === false && afterA === false && settled && afterB === false, { before, off, afterA, afterB });
  }

  /* 5) 2000 条真实委托 run 的历史导出必须能被同一工具导入（超过 2 MiB）。 */
  {
    const page = await pageOf();
    const result = await page.evaluate(`(async () => {
      const db = window.__arcadeCareerTest.db();
      const c = await db.ensureCareer({});
      const idb = indexedDB.open('studiokit:arcade:career');
      const opened = await new Promise((res, rej) => { idb.onsuccess = () => res(idb.result); idb.onerror = () => rej(idb.error); });
      const at = new Date().toISOString();
      await new Promise((res, rej) => {
        const tx = opened.transaction('runs', 'readwrite');
        const store = tx.objectStore('runs');
        for (let i = 0; i < 2000; i += 1) {
          store.put({
            runId: 'commission-history-' + i,
            schemaVersion: 1,
            careerId: c.careerId,
            gameId: 'pendulum-tower',
            commissionId: 'pendulum-tower.T1',
            mode: 'commission',
            sourceMode: 'commission',
            nonce: 'history-nonce-' + i,
            status: i % 2 === 0 ? 'claimed' : 'failed',
            createdAt: at,
            updatedAt: at,
            stats: { score: i, moves: i, summary: 'history sample ' + i + ' ' + 'x'.repeat(400) },
            objective: { kind: 'tower.floor_stable', atLeast: 4, context: { level: 1, theme: 'history' } },
            receipt: { receiptId: 'commission-history-' + i, credits: 70, items: { alloy: 1 }, evidence: ['E-C1-site'], flags: ['C1.work_done'], claimedAt: at }
          });
        }
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      opened.close();
      await ArcadeCareer.openSettings();
      for (let i = 0; i < 60 && !ArcadeCareer.backup; i += 1) await new Promise((r) => setTimeout(r, 100));
      const exp = await ArcadeCareer.backup.exportCareerLife();
      const imp = await ArcadeCareer.backup.importCareerLife(exp.text, { mode: 'replace' });
      return { bytes: exp && exp.text ? exp.text.length : 0, exported: exp && exp.ok !== false, importOk: imp && imp.ok, reason: imp && (imp.reason || imp.error), counts: imp && imp.counts };
    })()`);
    check('P2.6 2000 条真实 run 导出（>2 MiB）可回导', result.exported === true && result.bytes > 2 * 1024 * 1024 && result.importOk === true && result.counts && result.counts.runs === 2000, result);
  }

  /* 6) C2/C4 路线必须要求可真实产出的 E/BP 证据组合。 */
  {
    const page = await pageOf();
    const content = await page.evaluate(`(async () => { const r = await fetch('/apps/arcade/career/content/campaign.json', { cache: 'no-store' }); return r.json(); })()`);
    const c2 = content.chapters.find((ch) => ch.chapterId === 'C2').routes.find((r) => r.routeId === 'mining');
    const c4 = content.chapters.find((ch) => ch.chapterId === 'C4').routes.find((r) => r.routeId === 'build');
    const c2ev = c2 && c2.requires ? c2.requires.evidenceAll || [] : [];
    const c4ev = c4 && c4.requires ? c4.requires.evidenceAll || [] : [];
    check('P2.7 C2 矿脉要求 snowbells.T3 + snake-run.T3 两份 E，不再列矿工 T2/T3', c2ev.indexOf('E-snowbells.T3') >= 0 && c2ev.indexOf('E-snake-run.T3') >= 0 && JSON.stringify(c2.requires).indexOf('gold-miner') < 0, { c2: c2 && c2.requires });
    check('P2.7 C4 建塔要求 mole-whack.T3 + block-drop.T3 的 E 与 merge-2048.T3 的 BP，不再列 pendulum-tower.T3', c4ev.indexOf('E-mole-whack.T3') >= 0 && c4ev.indexOf('E-block-drop.T3') >= 0 && JSON.stringify(c4.requires).indexOf('BP-merge-2048.T3') >= 0 && JSON.stringify(c4.requires).indexOf('pendulum-tower.T3') < 0, { c4: c4 && c4.requires });
  }

  /* 7) 终局 C5 写入失败时不得留下孤立收据；成功后必须同时有 C5 和终局行。 */
  {
    const page = await pageOf();
    const result = await page.evaluate(`(async () => {
      const db = window.__arcadeCareerTest.db();
      const c = await db.ensureCareer({});
      const flags = ['C0.port_seen','C1.flight_done','C1.signal_fragment','C2.research_complete','C3.truth_found','C4.city_power_restored'];
      await db.putQuests(c.careerId, flags.map((flag) => ({ nodeId: 'story:' + flag, kind: 'story-flag', status: 'cleared', flags: [flag] })));
      await ArcadeCareer.openCampaign();
      const started = await ArcadeCareer.ending.startEnding({ approach: 'combat', careerId: c.careerId });
      ArcadeCareer.ending.recordEvent(started.ticketId, { kind: 'boss.defeated', payload: { theme: 'mothership', level: 6 }, seq: 1, sourceMode: 'commission' });
      const original = db.putQuests;
      let failedWrite = false;
      db.putQuests = function () { failedWrite = true; throw new Error('injected-c5-failure'); };
      let settled = null;
      try { settled = await ArcadeCareer.ending.settleEnding({ ticketId: started.ticketId }); } catch (e) { settled = { ok: false, error: String(e) }; }
      db.putQuests = original;
      const claims = await new Promise((resolve) => { const idb = indexedDB.open('studiokit:arcade:career'); idb.onsuccess = () => { const opened = idb.result; const tx = opened.transaction('claims'); const all = tx.objectStore('claims').getAll(); all.onsuccess = () => { resolve(all.result); opened.close(); }; }; });
      const quests = await db.readQuestState(c.careerId);
      const c5 = quests.quests.filter((row) => row.nodeId === 'story:C5.star_tower_resolved');
      return { settled, failedWrite, claims: claims.length, c5: c5.length, c5Row: c5[0] || null };
    })()`);
    check('P1 终局 C5 写入与收据同一提交边界（注入失败不留孤立收据）', result.settled && result.settled.ok === true && result.failedWrite === false && result.claims === 1 && result.c5 === 1, { failedWrite: result.failedWrite, claims: result.claims, c5: result.c5, settled: result.settled });
  }
} finally {
  try { await stopChrome(launched); } catch {}
  try { await new Promise((r) => server.close(r)); } catch {}
}
if (failures) { console.log(failures + ' failed'); process.exitCode = 1; } else console.log('REVIEW3 REGRESSION PASS');
