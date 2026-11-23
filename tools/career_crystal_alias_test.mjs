#!/usr/bin/env node
/**
 * 0.17 材料别名回归：0.16 遗留 crystal 库存必须与 starcrystal 原子互通。
 * 真 Chrome/IndexedDB：卖料扣旧 crystal 行、重复 sale 不加钱、购买 costItems 可消耗旧库存、
 * 超出库存结构化失败且零写入。端口 CAREER_CRYSTAL_PORT=8991 / CAREER_CRYSTAL_CDP=9591。
 */
import path from 'node:path';
import { REPO_ROOT, envPort, launchChrome, openPage, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const PORT = envPort('CAREER_CRYSTAL_PORT', 8991);
const CDP_PORT = envPort('CAREER_CRYSTAL_CDP', 9591);
const DB_NAME = 'studiokit:arcade:career';
let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { passed += 1; console.log('PASS  ' + name); return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
  console.log('FAIL  ' + name + (detail ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), 'actual=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected));
}

const server = await startServer({ port: PORT });
const launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'studiokit-crystal-alias-' });
const page = await openPage({ port: CDP_PORT, width: 390, height: 844, mobile: true });
try {
  await page.navigate(`http://127.0.0.1:${PORT}/apps/arcade/games/pendulum-tower.html?careerTest=1#test`);
  await page.waitFor('window.ArcadeCareer && window.ArcadeCareer.ready');
  await page.evaluate('window.ArcadeCareer.ready');
  await page.waitFor('window.ArcadeCareer.available === true', { timeout: 15000 });
  const seed = await page.evaluate(`(async () => {
    const db = window.__arcadeCareerTest.db();
    const career = await db.ensureCareer({});
    const careerId = career.careerId;
    const idb = indexedDB.open(${JSON.stringify(DB_NAME)});
    const opened = await new Promise((resolve, reject) => { idb.onsuccess = () => resolve(idb.result); idb.onerror = () => reject(idb.error); });
    await new Promise((resolve, reject) => {
      const tx = opened.transaction('inventory', 'readwrite');
      tx.objectStore('inventory').put({ careerId, itemId: 'crystal', count: 5, updatedAt: new Date().toISOString() });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    const wallet = await db.readWallet(careerId);
    return { careerId, wallet };
  })()`);
  eq('C01 旧 crystal 库存读取并入 starcrystal=5', seed.wallet.items, { starcrystal: 5 });
  const sell = await page.evaluate(`(async () => {
    const db = window.__arcadeCareerTest.db();
    const careerId = ${JSON.stringify(seed.careerId)};
    const r1 = await db.sellItems({ careerId, saleId: 'crystal-sell-1', items: { starcrystal: 2 }, credits: 96 });
    const w1 = await db.readWallet(careerId);
    const r2 = await db.sellItems({ careerId, saleId: 'crystal-sell-1', items: { starcrystal: 2 }, credits: 96 });
    const w2 = await db.readWallet(careerId);
    const r3 = await db.sellItems({ careerId, saleId: 'crystal-sell-2', items: { starcrystal: 3 }, credits: 144 });
    const w3 = await db.readWallet(careerId);
    return { r1, w1, r2, w2, r3, w3 };
  })()`);
  check('C02 卖 starcrystal 消耗旧 crystal 行（80→176，库存 5→3）', sell.r1.ok === true && sell.r1.duplicate === false && sell.w1.credits === 176 && sell.w1.items.starcrystal === 3, JSON.stringify(sell.r1));
  check('C03 同 saleId 重放 duplicate=true 且零增量', sell.r2.duplicate === true && sell.w2.credits === 176 && sell.w2.items.starcrystal === 3, JSON.stringify(sell.r2));
  check('C04 换 saleId 再次卖 3 件清空旧库存（176+144=320）', sell.r3.ok === true && sell.w3.credits === 320 && !sell.w3.items.starcrystal, JSON.stringify(sell.w3));
  const over = await page.evaluate(`(async () => {
    const db = window.__arcadeCareerTest.db();
    const careerId = ${JSON.stringify(seed.careerId)};
    const r = await db.sellItems({ careerId, saleId: 'crystal-sell-over', items: { starcrystal: 2 }, credits: 96 });
    const w = await db.readWallet(careerId);
    return { r, w };
  })()`);
  check('C05 空库存再卖 → insufficient-items 且零写入', over.r.ok === false && over.r.reason === 'insufficient-items' && over.w.credits === 320, JSON.stringify(over.r));
  const buy = await page.evaluate(`(async () => {
    const db = window.__arcadeCareerTest.db();
    const careerId = ${JSON.stringify(seed.careerId)};
    const before = await db.readWallet(careerId);
    return { before };
  })()`);
  check('C06 卖空后无残留可重复加钱', buy.before.credits === 320, JSON.stringify(buy.before));
  const purchase = await page.evaluate(`(async () => {
    const db = window.__arcadeCareerTest.db();
    const careerId = ${JSON.stringify(seed.careerId)};
    const idb = indexedDB.open(${JSON.stringify(DB_NAME)});
    const opened = await new Promise((resolve, reject) => { idb.onsuccess = () => resolve(idb.result); idb.onerror = () => reject(idb.error); });
    await new Promise((resolve, reject) => {
      const tx = opened.transaction('inventory', 'readwrite');
      tx.objectStore('inventory').put({ careerId, itemId: 'crystal', count: 2, updatedAt: new Date().toISOString() });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    const r = await db.purchase({ careerId, purchaseId: 'crystal-buy-1', cost: 1, costItems: { starcrystal: 2 }, grants: { items: { alloy: 1 } } });
    const w = await db.readWallet(careerId);
    const r2 = await db.purchase({ careerId, purchaseId: 'crystal-buy-2', cost: 1, costItems: { starcrystal: 1 }, grants: { items: { alloy: 1 } } });
    const w2 = await db.readWallet(careerId);
    return { r, w, r2, w2 };
  })()`);
  check('C07 costItems 可从旧 crystal 行扣料并原子发放 alloy', purchase.r.ok === true && purchase.w.items.starcrystal === undefined && purchase.w.items.alloy === 1 && purchase.w.credits === 319, JSON.stringify(purchase.w));
  check('C08 旧库存用尽后 costItems 不足 → insufficient-items 零写入', purchase.r2.ok === false && purchase.r2.reason === 'insufficient-items' && purchase.w2.items.alloy === 1, JSON.stringify(purchase.r2));
  await page.evaluate(`(async () => { await window.__arcadeCareerTest.db().deleteDatabase(); })()`).catch(() => {});
} finally {
  try { await stopChrome(launched); } catch {}
  try { await new Promise((resolve) => server.close(resolve)); } catch {}
}
console.log('\n' + passed + '/' + (passed + failures.length) + ' checks passed');
if (failures.length) {
  console.log('FAILED: ' + failures.join(' | '));
  process.exitCode = 1;
} else {
  console.log('PASS: crystal alias atomicity');
}
