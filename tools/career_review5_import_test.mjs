#!/usr/bin/env node
/**
 * 第五轮复审定向回归：备份导入的发现代次与兼容性空导入零写入。
 * 使用动态 CDP 端口 + 独立临时 profile + 动态静态服务器端口；
 * 只关闭本用例 launchChrome 返回的子进程，不按名称/镜像清理任何 Chrome。
 */
import { startServer, launchChrome, openPage, stopChrome, sleep } from './lib/arcade_cdp.mjs';

let total = 0;
let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  total += 1;
  if (ok) { passed += 1; console.log('PASS  ' + name + ' — ' + JSON.stringify(detail).slice(0, 700)); }
  else { failed += 1; console.log('FAIL  ' + name + ' — ' + JSON.stringify(detail).slice(0, 900)); }
}

const server = await startServer({ port: 0 });
const base = 'http://127.0.0.1:' + server.address().port;
let browser = null;
const tabs = [];
try {
  browser = await launchChrome({ port: 0, profilePrefix: 'arcade-review5-' });
  let cdpPort = browser.port;
  check('Chrome 隔离启动：动态 CDP 端口 + 独立临时 profile', Number.isInteger(cdpPort) && cdpPort > 0 && browser.dynamicPort === true && !!browser.profile, { cdpPort, profile: browser.profile });

  async function page() {
    const p = await openPage({ port: cdpPort });
    tabs.push(p);
    return p;
  }
  async function load(p) {
    await p.navigate(base + '/apps/arcade/games/memory-flip.html?careerTest=1#test');
    await p.waitFor('window.ArcadeCareer && ArcadeCareer.ready.then(() => !!ArcadeCareer.db)', { timeout: 10000 });
    await p.waitFor('window.__arcadeCareerTest && window.__arcadeCareerTest.ready', { timeout: 10000 });
    await p.evaluate('window.__arcadeCareerTest.ready.then(() => true)');
  }
  async function dbSnapshot(p) {
    return p.evaluate(`(async () => {
      const open = await new Promise((res, rej) => { const r = indexedDB.open('studiokit:arcade:career'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const stores = ['state','discovery','profiles','runs','claims','ledgers','balances','inventory','equipment','quests','migrations'];
      const out = {};
      for (const name of stores) {
        out[name] = await new Promise((res, rej) => { try { const tx = open.transaction(name); const all = tx.objectStore(name).getAll(); all.onsuccess = () => res(all.result); all.onerror = () => rej(all.error); } catch (err) { res([]); } });
      }
      open.close();
      return out;
    })()`);
  }

  /* ---------- A. 替换导入不得让代次倒退；旧标签写入被拒绝 ---------- */
  {
    const a = await page();
    const b = await page();
    await load(a);
    const career = await a.evaluate(`(async () => { const c = await ArcadeCareer.db.ensureCareer({}); return c.careerId; })()`);
    await a.evaluate(`(async () => { const db = ArcadeCareer.db; await db.resetDiscovery(); await db.resetDiscovery(); })()`);
    const genBefore = await a.evaluate(`(async () => (await ArcadeCareer.db.getDiscoveryGeneration()).generation)()`);
    await a.evaluate(`ArcadeCareer.openSettings()`);
    for (let i = 0; i < 30 && !(await a.evaluate('!!(window.ArcadeCareer && ArcadeCareer.backup)')); i += 1) await sleep(100);
    const exported = await a.evaluate(`(async () => ArcadeCareer.backup.exportCareerLife())()`);
    const text = exported && exported.text ? exported.text : '';
    check('替换导入前置：本地代次为 2，导出档不含内部代次行', genBefore === 2 && exported && exported.ok !== false && typeof text === 'string' && JSON.parse(text).state.every((row) => row.key !== 'discovery-generation'), { genBefore, keys: exported && exported.payload ? Object.keys(exported.payload) : null });

    await load(b);
    const bGen = await b.evaluate(`(async () => { const snap = await ArcadeCareer.db.getDiscoverySnapshot(); return snap.generation; })()`);
    await b.evaluate(`(async () => { const C = ArcadeCareer; C.observe('pair.match', { symbol: 'A', level: 1, moves: 1 }); return C.finish({ mode: 'classic', outcome: 'won', stats: { level: 1, moves: 1, score: 10 } }); })()`);
    await sleep(250);
    const beforeImport = await a.evaluate(`(async () => { const s = await ArcadeCareer.db.getDiscoveryState(); return { clues: Object.keys((s && s.clues) || {}).length }; })()`);
    const imported = await a.evaluate(`(async () => ArcadeCareer.backup.importCareerLife(${JSON.stringify(text)}, { mode: 'replace' }))()`);
    const afterImport = await a.evaluate(`(async () => { const snap = await ArcadeCareer.db.getDiscoverySnapshot(); const s = snap.state; return { generation: snap.generation, clues: Object.keys((s && s.clues) || {}).length }; })()`);
    check('替换导入：同一事务按本地代次 2→3，忽略档案代次，线索清空', imported && imported.ok === true && imported.preserved !== true && afterImport.generation === 3 && afterImport.clues === 0, { bGen, beforeImport, imported: imported && { ok: imported.ok, mode: imported.mode, generation: imported.generation }, afterImport });

    const staleWrite = await b.evaluate(`(async () => { const C = ArcadeCareer; C.observe('pair.match', { symbol: 'B', level: 2, moves: 2 }); return C.finish({ mode: 'classic', outcome: 'won', stats: { level: 1, moves: 2, score: 20 } }); })()`);
    await sleep(250);
    const post = await a.evaluate(`(async () => { const snap = await ArcadeCareer.db.getDiscoverySnapshot(); const rows = await new Promise((res) => { const o = indexedDB.open('studiokit:arcade:career'); o.onsuccess = () => { const db = o.result; const tx = db.transaction('discovery'); const all = tx.objectStore('discovery').getAll(); all.onsuccess = () => { res(all.result.length); db.close(); }; }; }); return { generation: snap.generation, clues: Object.keys((snap.state && snap.state.clues) || {}).length, discoveryRows: rows }; })()`);
    check('旧代次标签结算被拒绝：state.clues 与独立 discovery 表仍为空，代次不回退', staleWrite === null || (staleWrite && staleWrite.persisted !== true) ? post.clues === 0 && post.discoveryRows === 0 && post.generation === 3 : false, { staleWrite, post });

    /* 档案携带更低/更高代次都只按本地值推进，绝不能把本地代次改小或跳大。 */
    const variants = await a.evaluate(`(async () => {
      const base = JSON.parse(${JSON.stringify(text)});
      const run = async (value) => {
        const payload = JSON.parse(JSON.stringify(base));
        payload.state = (payload.state || []).filter((row) => row.key !== 'discovery-generation').concat([{ key: 'discovery-generation', schemaVersion: 1, value, updatedAt: new Date().toISOString() }]);
        const result = await ArcadeCareer.backup.importCareerLife(JSON.stringify(payload), { mode: 'replace' });
        const snap = await ArcadeCareer.db.getDiscoverySnapshot();
        return { result: result && { ok: result.ok, generation: result.generation }, generation: snap.generation };
      };
      return { lower: await run(1), higher: await run(99) };
    })()`);
    check('带更低/更高代次的档案都忽略档案值，按本地代次各 +1', variants.lower && variants.lower.result.ok === true && variants.lower.generation === 4 && variants.higher && variants.higher.result.ok === true && variants.higher.generation === 5, variants);
  }

  /* ---------- B. preserved:true / mode:none 零写入 ---------- */
  {
    /* 新开一个本轮独立浏览器/profile，保证空库，不触碰任何用户 Chrome。 */
    for (const p of tabs) { try { p.ws.close(); } catch (err) { /* ignore */ } }
    tabs.length = 0;
    await stopChrome(browser);
    browser = await launchChrome({ port: 0, profilePrefix: 'arcade-review5-empty-' });
    cdpPort = browser.port;
    const a = await page();
    const b = await page();
    await load(a);
    await load(b);
    await Promise.all([a.evaluate('ArcadeCareer.openSettings()'), b.evaluate('ArcadeCareer.openSettings()')]);
    for (let i = 0; i < 30; i += 1) {
      const ready = await a.evaluate('!!(window.ArcadeCareer && ArcadeCareer.backup)');
      if (ready) break;
      await sleep(100);
    }
    const before = await dbSnapshot(a);
    const classic = JSON.stringify({ version: '0.14.0', exportedAt: '2026-11-22T00:00:00.000Z', scores: { games: { 'memory-flip': { best: 12 } } } });
    const imported = await a.evaluate(`(async () => ArcadeCareer.backup.importCareerLife(${JSON.stringify(classic)}, { mode: 'replace' }))()`);
    const after = await dbSnapshot(a);
    const count = (snap) => Object.keys(snap).reduce((sum, key) => sum + snap[key].length, 0);
    check('旧经典档 preserved:true 返回 ok 且零写入（无生涯/代次/状态行）', imported && imported.ok === true && imported.preserved === true && imported.mode === 'none' && count(before) === count(after), { countsBefore: Object.fromEntries(Object.keys(before).map((k) => [k, before[k].length])), countsAfter: Object.fromEntries(Object.keys(after).map((k) => [k, after[k].length])), imported });

    const saved = await b.evaluate(`(async () => { const r = await ArcadeCareer.setHintsEnabled(false); const s = await ArcadeCareer.db.getDiscoveryState(); return { r, hints: s && s.hintsEnabled }; })()`);
    check('空导入后，原标签仍可保存真实提示设置', saved && saved.r === false && saved.hints === false, saved);

    const existingBefore = await dbSnapshot(a);
    const created = await a.evaluate(`(async () => { const c = await ArcadeCareer.db.ensureCareer({}); return c.careerId; })()`);
    const careerBefore = await dbSnapshot(a);
    const importedExisting = await a.evaluate(`(async () => ArcadeCareer.backup.importCareerLife(${JSON.stringify(classic)}, { mode: 'replace' }))()`);
    const careerAfter = await dbSnapshot(a);
    check('已有生涯的 preserved:true 导入仍零写入（不换生涯/不改状态）', !!created && importedExisting && importedExisting.ok === true && importedExisting.preserved === true && count(careerBefore) === count(careerAfter), { created, importedExisting, countsBefore: Object.fromEntries(Object.keys(careerBefore).map((k) => [k, careerBefore[k].length])), countsAfter: Object.fromEntries(Object.keys(careerAfter).map((k) => [k, careerAfter[k].length])) });
  }

  if (failed) {
    console.log(failed + ' failed / ' + total + ' checks');
    process.exitCode = 1;
  } else {
    console.log('REVIEW5 IMPORT PASS (' + passed + '/' + total + ')');
  }
} finally {
  for (const p of tabs) { try { p.ws.close(); } catch (err) { /* ignore */ } }
  if (browser) await stopChrome(browser);
  server.close();
}
