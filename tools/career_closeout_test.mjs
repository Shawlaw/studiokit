#!/usr/bin/env node
/**
 * 第七轮收口定向：同代次动作合并、saveState 旧对象、设置/清除失败恢复。
 * 动态端口 + 独立 profile；只关闭本轮子进程。
 */
import { startServer, launchChrome, openPage, stopChrome, sleep } from './lib/arcade_cdp.mjs';

let total = 0, failed = 0;
function check(name, ok, detail) {
  total += 1;
  if (ok) console.log('PASS  ' + name + ' — ' + JSON.stringify(detail).slice(0, 700));
  else { failed += 1; console.log('FAIL  ' + name + ' — ' + JSON.stringify(detail).slice(0, 1000)); }
}
const server = await startServer({ port: 0 });
const base = 'http://127.0.0.1:' + server.address().port;
let browser = null;
const tabs = [];
try {
  browser = await launchChrome({ port: 0, profilePrefix: 'arcade-closeout-' });
  const cdpPort = browser.port;
  async function page() { const p = await openPage({ port: cdpPort }); tabs.push(p); return p; }
  async function load(p, game) {
    await p.navigate(base + '/apps/arcade/games/' + game + '.html?careerTest=1#test');
    await p.waitFor('window.ArcadeCareer && ArcadeCareer.ready.then(() => !!ArcadeCareer.db)', { timeout: 10000 });
    await p.waitFor('window.__arcadeCareerTest && window.__arcadeCareerTest.ready', { timeout: 10000 });
    await p.evaluate('window.__arcadeCareerTest.ready.then(() => true)');
  }
  async function snap(p) {
    return p.evaluate(`(async () => { const s = await ArcadeCareer.db.getDiscoveryState(); const rows = await ArcadeCareer.db.listDiscovery(); return { clues: Object.keys((s && s.clues) || {}), opened: s && s.clues && s.clues['CL-memory-flip'] ? s.clues['CL-memory-flip'].openedAt : null, stage: s && s.stage, hints: s && s.hintsEnabled, rows: rows.length }; })()`);
  }
  const a = await page(), b = await page(), c = await page();
  await load(a, 'memory-flip');
  await load(b, 'merge-2048');
  await load(c, 'memory-flip');
  await a.evaluate('(async () => { const c = await ArcadeCareer.db.ensureCareer({}); return c.careerId; })()');
  await a.evaluate('ArcadeCareer.setHintsEnabled(true)');
  await sleep(150);
  await a.evaluate(`(async () => { const C = ArcadeCareer; C.observe('pair.match', { symbol: 'A', level: 1, moves: 1 }); C.observe('pair.match', { symbol: 'C', level: 2, moves: 2 }); return C.finish({ mode: 'classic', outcome: 'won', stats: { level: 1, moves: 2, score: 20 } }); })()`);
  await sleep(250);
  await b.evaluate(`(async () => { const C = ArcadeCareer; C.observe('tile.merged', { value: 4, level: 1, moves: 1 }); C.observe('tile.merged', { value: 8, level: 1, moves: 2 }); return C.finish({ mode: 'classic', outcome: 'won', stats: { score: 8, moves: 2, bestTile: 8 } }); })()`);
  await sleep(250);
  const opened = await a.evaluate(`(async () => ArcadeCareer.openClue('CL-memory-flip'))()`);
  const toggled = await b.evaluate(`(async () => { const r = await ArcadeCareer.setHintsEnabled(false); return { r }; })()`);
  await c.evaluate(`(async () => { const C = ArcadeCareer; C.observe('pair.match', { symbol: 'D', level: 1, moves: 1 }); C.observe('pair.match', { symbol: 'E', level: 2, moves: 2 }); return C.finish({ mode: 'classic', outcome: 'won', stats: { level: 1, moves: 2, score: 20 } }); })()`);
  await sleep(300);
  const merged = await snap(a);
  const rowAfterDuplicate = await a.evaluate(`(async () => { const rows = await ArcadeCareer.db.listDiscovery(); const row = rows.filter((r) => r.clueId === 'CL-memory-flip')[0] || null; return { openedAt: row && row.openedAt, count: rows.length }; })()`);
  const reread = await a.evaluate(`(async () => { const r = await ArcadeCareer.openClue('CL-memory-flip'); const s = await ArcadeCareer.db.getDiscoveryState(); const rows = await ArcadeCareer.db.listDiscovery(); const row = rows.filter((x) => x.clueId === 'CL-memory-flip')[0] || null; return { r, stateOpened: s.clues['CL-memory-flip'].openedAt, rowOpened: row && row.openedAt }; })()`);
  const bView = await b.evaluate(`(() => { const s = ArcadeCareer.state(); return { opened: s.clues && s.clues['CL-memory-flip'] ? s.clues['CL-memory-flip'].openedAt : null, stage: s.stage, hints: s.hintsEnabled }; })()`);
  check('同代次读信 + 另一标签改设置 + 重复发现/阅读：两张表 openedAt 始终相等', opened && opened.ok === true && toggled.r === false && merged.clues.length === 2 && merged.opened && merged.rows === 2 && merged.stage !== 'GLIMPSED' && merged.hints === false && rowAfterDuplicate.count === 2 && rowAfterDuplicate.openedAt === merged.opened && reread.r && reread.r.ok === true && reread.stateOpened === merged.opened && reread.rowOpened === merged.opened && bView.opened === merged.opened && bView.stage === merged.stage && bView.hints === false, { opened, toggled, merged, rowAfterDuplicate, reread, bView });

  /* saveState 原样旧对象：清除后连续两次都必须拒绝，新状态可保存。 */
  await b.evaluate(`window.__oldState = ArcadeCareer.state()`);
  await b.evaluate(`window.__oldCopy = JSON.parse(JSON.stringify(window.__oldState))`);
  await a.evaluate(`(async () => ArcadeCareer.db.resetDiscovery())()`);
  const stale1 = await b.evaluate(`(async () => { const r = await ArcadeCareer.saveState(window.__oldState); return { r, clues: Object.keys((ArcadeCareer.state().clues) || {}).length }; })()`);
  const stale2 = await b.evaluate(`(async () => { const r = await ArcadeCareer.saveState(window.__oldState); return { r, clues: Object.keys((ArcadeCareer.state().clues) || {}).length }; })()`);
  const staleCopy1 = await b.evaluate(`(async () => { const r = await ArcadeCareer.saveState(window.__oldCopy); return { r, clues: Object.keys((ArcadeCareer.state().clues) || {}).length }; })()`);
  const staleCopy2 = await b.evaluate(`(async () => { const r = await ArcadeCareer.saveState(window.__oldCopy); return { r, clues: Object.keys((ArcadeCareer.state().clues) || {}).length }; })()`);
  const fresh = await b.evaluate(`(async () => { const r = await ArcadeCareer.saveState(ArcadeCareer.state()); return { r }; })()`);
  const afterSave = await snap(a);
  check('公开 saveState 旧对象与 JSON 复制版均持续拒绝，重读后的新快照可保存', stale1.r.ok === false && stale1.r.error === 'stale-generation' && stale2.r.ok === false && stale2.r.error === 'stale-generation' && staleCopy1.r.ok === false && staleCopy1.r.error === 'stale-generation' && staleCopy2.r.ok === false && staleCopy2.r.error === 'stale-generation' && fresh.r.ok === true && afterSave.clues.length === 0, { stale1, stale2, staleCopy1, staleCopy2, fresh, afterSave });

  /* 普通设置写入失败：UI/内存/DB 都保持开启；恢复后重试可关闭。 */
  await a.evaluate('ArcadeCareer.setHintsEnabled(true)');
  await sleep(150);
  await a.evaluate(`(async () => { const C = ArcadeCareer; C.observe('pair.match', { symbol: 'X', level: 1, moves: 1 }); C.observe('pair.match', { symbol: 'Y', level: 2, moves: 2 }); return C.finish({ mode: 'classic', outcome: 'won', stats: { level: 1, moves: 2, score: 20 } }); })()`);
  await sleep(250);
  await a.evaluate('ArcadeCareer.openSettings()');
  await a.waitFor(`!!document.querySelector('[data-career-panel="settings"] #ac-career-settings-hints')`, { timeout: 5000 });
  await a.evaluate(`(async () => { const db = ArcadeCareer.db; window.__realMerge = db.mergeDiscoveryState; db.mergeDiscoveryState = async () => ({ ok: false, error: 'injected-write' }); })()`);
  await a.evaluate(`document.querySelector('[data-career-panel="settings"] #ac-career-settings-hints').click()`);
  await sleep(400);
  const failedView = await a.evaluate(`(async () => { const s = await ArcadeCareer.db.getDiscoveryState(); const panel = document.querySelector('[data-career-panel="settings"]'); const btn = panel.querySelector('#ac-career-settings-hints'); const status = panel.querySelector('.ac-career-status'); return { checked: btn.getAttribute('aria-checked'), status: status && !status.hidden ? status.textContent : null, hints: s.hintsEnabled, memory: ArcadeCareer.state().hintsEnabled }; })()`);
  await a.evaluate(`ArcadeCareer.db.mergeDiscoveryState = window.__realMerge`);
  await a.evaluate(`document.querySelector('[data-career-panel="settings"] #ac-career-settings-hints').click()`);
  await sleep(400);
  const retried = await a.evaluate(`(async () => { const s = await ArcadeCareer.db.getDiscoveryState(); const panel = document.querySelector('[data-career-panel="settings"]'); return { checked: panel.querySelector('#ac-career-settings-hints').getAttribute('aria-checked'), hints: s.hintsEnabled, memory: ArcadeCareer.state().hintsEnabled }; })()`);
  check('普通设置写入失败：UI/内存/DB 一致保持开启并提示；重试后关闭', failedView.checked === 'true' && failedView.hints === true && failedView.memory === true && failedView.status && failedView.status.indexOf('没能') >= 0 && retried.checked === 'false' && retried.hints === false && retried.memory === false, { failedView, retried });

  /* 清除失败：内存/DB 线索保留；重试成功清空。 */
  await a.evaluate(`(async () => { const db = ArcadeCareer.db; window.__realReset = db.resetDiscovery; db.resetDiscovery = async () => ({ ok: false, error: 'injected-clear' }); })()`);
  await a.evaluate(`(() => { const panel = document.querySelector('[data-career-panel="settings"]'); const b = Array.from(panel.querySelectorAll('button')).find((n) => (n.innerText || '').indexOf('清除本机线索记录') >= 0); b.click(); })()`);
  await a.waitFor(`!!document.querySelector('[data-career-panel="settings"] .ac-career-confirm:not([hidden])')`, { timeout: 5000 });
  await a.evaluate(`(() => { const panel = document.querySelector('[data-career-panel="settings"]'); const b = Array.from(panel.querySelectorAll('button')).find((n) => (n.innerText || '').trim() === '确认清除'); b.click(); })()`);
  await sleep(400);
  const clearFail = await a.evaluate(`(async () => { const s = await ArcadeCareer.db.getDiscoveryState(); const st = ArcadeCareer.state(); const panel = document.querySelector('[data-career-panel="settings"]'); const status = panel.querySelector('.ac-career-status'); return { db: Object.keys((s && s.clues) || {}).length, memory: Object.keys((st.clues) || {}).length, status: status && !status.hidden ? status.textContent : null }; })()`);
  await a.evaluate(`ArcadeCareer.db.resetDiscovery = window.__realReset`);
  await a.evaluate(`(() => { const panel = document.querySelector('[data-career-panel="settings"]'); const b = Array.from(panel.querySelectorAll('button')).find((n) => (n.innerText || '').indexOf('清除本机线索记录') >= 0); b.click(); })()`);
  await a.waitFor(`!!document.querySelector('[data-career-panel="settings"] .ac-career-confirm:not([hidden])')`, { timeout: 5000 });
  await a.evaluate(`(() => { const panel = document.querySelector('[data-career-panel="settings"]'); const b = Array.from(panel.querySelectorAll('button')).find((n) => (n.innerText || '').trim() === '确认清除'); b.click(); })()`);
  await sleep(500);
  const clearRetry = await a.evaluate(`(async () => { const s = await ArcadeCareer.db.getDiscoveryState(); const st = ArcadeCareer.state(); return { db: Object.keys((s && s.clues) || {}).length, memory: Object.keys((st.clues) || {}).length }; })()`);
  check('清除写入失败保留内存/DB 线索，重试后成功清空', clearFail.db === 1 && clearFail.memory === 1 && clearFail.status && clearFail.status.indexOf('没能') >= 0 && clearRetry.db === 0 && clearRetry.memory === 0, { clearFail, clearRetry });

  /* 旧信箱动作：恢复空档后旧线索不得推进 C0；当前有效线索可以正常推进。 */
  await a.evaluate('ArcadeCareer.openSettings()');
  await a.waitFor(`!!document.querySelector('[data-career-panel="settings"]')`, { timeout: 5000 });
  await a.evaluate(`(async () => { window.__emptyBackup = (await ArcadeCareer.backup.exportCareerLife()).text; })()`);
  await a.evaluate(`(async () => ArcadeCareer.backup.importCareerLife(window.__emptyBackup, { mode: 'replace' }))()`);
  await b.evaluate(`(async () => { const db = ArcadeCareer.db; const c = await db.ensureCareer({}); const raw = indexedDB.open('studiokit:arcade:career'); const opened = await new Promise((res, rej) => { raw.onsuccess = () => res(raw.result); raw.onerror = () => rej(raw.error); }); await new Promise((res, rej) => { const tx = opened.transaction('quests', 'readwrite'); tx.objectStore('quests').delete([c.careerId, 'story:C0.port_seen']); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); opened.close(); })()`);
  const c0BeforeOld = await b.evaluate(`(async () => { const db = ArcadeCareer.db; const c = await db.ensureCareer({}); const q = await db.readQuestState(c.careerId); return { hasC0: q.quests.some((row) => row.nodeId === 'story:C0.port_seen') }; })()`);
  const oldMail = await b.evaluate(`(async () => ArcadeCareer.openClue('CL-merge-2048'))()`);
  const oldMailbox = await b.evaluate(`(async () => ArcadeCareer.openMailbox())()`);
  await sleep(700);
  const c0AfterOld = await b.evaluate(`(async () => { const db = ArcadeCareer.db; const c = await db.ensureCareer({}); const q = await db.readQuestState(c.careerId); return { hasC0: q.quests.some((row) => row.nodeId === 'story:C0.port_seen'), result: null }; })()`);
  const guardStale = await b.evaluate(`(async () => { const db = ArcadeCareer.db; const c = await db.ensureCareer({}); const snap = await db.getDiscoverySnapshot(); const r = await db.putQuestsGuarded(c.careerId, [{ nodeId: 'story:C0.port_seen', kind: 'story-flag', status: 'cleared', flags: ['C0.port_seen'] }], { generation: 0, requireClue: true }); const q = await db.readQuestState(c.careerId); return { r, currentGeneration: snap.generation, hasC0: q.quests.some((row) => row.nodeId === 'story:C0.port_seen') }; })()`);
  check('C0 写事务守卫：旧代次/无线索的章节旗标写入零写入', guardStale && guardStale.r && guardStale.r.ok === false && guardStale.r.reason === 'stale-generation' && guardStale.hasC0 === false && guardStale.currentGeneration > 0, guardStale);
  await a.evaluate('ArcadeCareer.setHintsEnabled(true)');
  await sleep(150);
  await a.evaluate(`(async () => { const C = ArcadeCareer; C.observe('pair.match', { symbol: 'A', level: 1, moves: 1 }); C.observe('pair.match', { symbol: 'B', level: 2, moves: 2 }); return C.finish({ mode: 'classic', outcome: 'won', stats: { level: 1, moves: 2, score: 20 } }); })()`);
  await sleep(300);
  const validMail = await a.evaluate(`(async () => ArcadeCareer.openClue('CL-memory-flip'))()`);
  await sleep(900);
  const c0AfterValid = await a.evaluate(`(async () => { const db = ArcadeCareer.db; const c = await db.ensureCareer({}); const q = await db.readQuestState(c.careerId); return q.quests.some((row) => row.nodeId === 'story:C0.port_seen'); })()`);
  check('旧标签信箱/回信箱不推进 C0；当前有效线索打开后 C0 幂等写入', oldMail && oldMail.ok === false && oldMailbox && oldMailbox.ok === true && c0BeforeOld.hasC0 === false && c0AfterOld.hasC0 === false && validMail && validMail.ok === true && c0AfterValid === true, { oldMail, oldMailbox, c0BeforeOld, c0AfterOld, validMail, c0AfterValid });

  if (failed) { console.log(failed + ' failed / ' + total + ' checks'); process.exitCode = 1; }
  else console.log('CLOSEOUT PASS (' + total + '/' + total + ')');
} finally {
  for (const p of tabs) { try { p.ws.close(); } catch (err) { /* ignore */ } }
  if (browser) await stopChrome(browser);
  server.close();
}
