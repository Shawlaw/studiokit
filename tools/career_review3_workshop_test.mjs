import path from 'node:path';
const REPO = 'D:/LocalAgentWorkspace/StudioKit';
const { startServer, launchChrome, openPage, stopChrome, sleep } = await import('file:///' + path.join(REPO, 'tools/lib/arcade_cdp.mjs').replace(/\\/g, '/'));
const PORT = 9041, CDP = 9641;
const server = await startServer({ port: PORT });
const launched = await launchChrome({ port: CDP, profilePrefix: 'review3-workshop-' });
let failures = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 1600) : '')); if (!ok) failures += 1; };
const BASE = `http://127.0.0.1:${PORT}`;
async function openGame() {
  const page = await openPage({ port: CDP, width: 430, height: 900, mobile: true });
  await page.navigate(`${BASE}/apps/arcade/games/pendulum-tower.html?careerTest=1#test`);
  await page.waitFor('window.ArcadeCareer && window.ArcadeCareer.ready');
  await page.evaluate('window.ArcadeCareer.ready');
  await page.waitFor('window.ArcadeCareer.available === true', { timeout: 15000 });
  return page;
}
async function seed(page) {
  return page.evaluate(`(async () => {
    const db = window.__arcadeCareerTest.db();
    const c = await db.ensureCareer({});
    const idb = indexedDB.open('studiokit:arcade:career');
    const opened = await new Promise((res, rej) => { idb.onsuccess = () => res(idb.result); idb.onerror = () => rej(idb.error); });
    await new Promise((res, rej) => {
      const tx = opened.transaction(['balances', 'inventory', 'equipment'], 'readwrite');
      tx.objectStore('balances').put({ careerId: c.careerId, credits: 800, revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      tx.objectStore('inventory').put({ careerId: c.careerId, itemId: 'alloy', count: 7, updatedAt: new Date().toISOString() });
      tx.objectStore('equipment').put({ careerId: c.careerId, updatedAt: new Date().toISOString() });
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    opened.close();
    return c.careerId;
  })()`);
}
async function openWorkshop(page) {
  await page.evaluate(`ArcadeCareer.openWorkshop()`);
  await page.waitFor(`!!document.querySelector('[data-career-panel="workshop"] [data-action="craft"][data-module-id="hull"][data-level="1"]')`, { timeout: 15000 });
  await sleep(300);
}
async function click(page, level) {
  const clicked = await page.evaluate(`(() => { const b = document.querySelector('[data-action="craft"][data-module-id="hull"][data-level="${level}"]'); if (!b || b.disabled) return false; b.click(); return true; })()`);
  await sleep(900);
  return clicked;
}
async function wallet(page, career) {
  return page.evaluate(`(async () => { const db = window.__arcadeCareerTest.db(); const w = await db.readWallet(${JSON.stringify(career)}); return { credits: w.credits, alloy: w.items.alloy || 0, level: w.equipment['module:hull:level'] || 0 }; })()`);
}
try {
  const a = await openGame();
  const b = await openGame();
  const career = await seed(a);
  await openWorkshop(a);
  await openWorkshop(b);
  const q0 = await b.evaluate(`(() => { const row = document.querySelector('[data-module-id="hull"] [data-level="3"] .ac-career-workshop__cost'); return row ? row.textContent : null; })()`);
  const aClicked = await click(a, 1);
  const afterA = await wallet(a, career);
  const bClicked = await click(b, 3);
  const afterStale = await wallet(a, career);
  const bStatus = await b.evaluate(`(() => { const panel = document.querySelector('[data-career-panel="workshop"]'); const status = panel ? panel.querySelector('.ac-career-status') : null; return status ? (status.getAttribute('data-reason') + '|' + status.textContent) : null; })()`);
  const qNew = await b.evaluate(`(() => { const row = document.querySelector('[data-module-id="hull"] [data-level="3"] .ac-career-workshop__cost'); return row ? row.textContent : null; })()`);
  const bClicked2 = await click(b, 3);
  const afterFinal = await wallet(a, career);
  check('P2.4 A 买 L1 后为 710 / 合金 6', aClicked === true && afterA.credits === 710 && afterA.alloy === 6 && afterA.level === 1, { afterA, q0 });
  check('P2.4 B 旧 L3 报价被 price-changed 拒绝，零扣款', bClicked === true && afterStale.credits === 710 && afterStale.alloy === 6 && afterStale.level === 1 && /报价变了/.test(bStatus || ''), { afterStale, status: bStatus });
  check('P2.4 面板刷新为新报价 500 + 合金 5 后确认成功', qNew && qNew.indexOf('500') >= 0 && qNew.indexOf('5') >= 0 && bClicked2 === true && afterFinal.credits === 210 && afterFinal.alloy === 1 && afterFinal.level === 3, { qNew, afterFinal });
  const replay = await a.evaluate(`(async () => { const db = window.__arcadeCareerTest.db(); return db.purchase({ careerId: ${JSON.stringify(career)}, purchaseId: 'craft:${career}:hull:3', cost: 500, costItems: { alloy: 5 }, grants: { equipment: { 'module:hull:owned': true, 'module:hull:level': 3 } }, expectedLevel: 1, contentVersion: '0.18.0' }); })()`);
  const afterReplay = await wallet(a, career);
  check('P2.4 同一购买 ID 重放返回 duplicate 且零扣款', replay && replay.ok === true && replay.duplicate === true && afterReplay.credits === 210 && afterReplay.alloy === 1 && afterReplay.level === 3, { replay, afterReplay });
} finally {
  try { await stopChrome(launched); } catch {}
  try { await new Promise((r) => server.close(r)); } catch {}
}
if (failures) { console.log(failures + ' failed'); process.exitCode = 1; } else console.log('REVIEW3 WORKSHOP PASS');
