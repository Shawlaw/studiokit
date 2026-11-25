import { startServer, launchChrome, openPage, stopChrome } from './lib/arcade_cdp.mjs';
const port = 18792, cdpPort = 19492;
const base = 'http://127.0.0.1:' + port;
const server = await startServer({ port });
let chrome;
const tabs = [];
async function page() { const p = await openPage({ port: cdpPort }); tabs.push(p); return p; }
const game = '/apps/arcade/games/pendulum-tower.html';
const load = async (p, route) => {
  await p.navigate(new URL(route, base + game).href);
  await p.waitFor('window.ArcadeCareer && ArcadeCareer.ready.then(() => !!ArcadeCareer.db)', { timeout: 10000 });
};
try {
  chrome = await launchChrome({ port: cdpPort, profilePrefix: 'arcade-review4-' });
  const a = await page(), b = await page(), c = await page();
  await Promise.all([a, b, c].map((p) => load(p, game)));
  const careerId = await a.evaluate('(async()=>{const d=ArcadeCareer.db,x=await d.ensureCareer({});for(const flag of ["C0.port_seen","C1.signal_fragment","C2.research_complete","C3.truth_found","C4.city_power_restored"])await d.putQuests(x.careerId,[{nodeId:"story:"+flag,status:"cleared",kind:"story-flag",flags:[flag]}]);return x.careerId})()');
  await Promise.all([a, b, c].map((p) => p.evaluate('ArcadeCareer.openCampaign()')));
  const endings = await Promise.all([a, b, c].map((p, i) => p.evaluate('ArcadeCareer.ending.startEnding({approach:' + JSON.stringify(['combat', 'research', 'combat'][i]) + '})')));
  if (endings.some((x) => !x.ok)) throw new Error(JSON.stringify(endings));
  await Promise.all([a, b, c].map((p, i) => load(p, endings[i].url)));
  await a.evaluate('ArcadeCareer.observe("boss.defeated",{theme:"mothership",level:6})');
  await c.evaluate('ArcadeCareer.observe("boss.defeated",{theme:"mothership",level:6})');
  const begin = '(()=>{const db=ArcadeCareer.db,real=db.settleEndingAndClaim;db.settleEndingAndClaim=async(args)=>{window.commitInput=args;await new Promise(resolve=>window.commit=resolve);return real(args)};void ArcadeCareer.finish({mode:"classic",outcome:"won"}).then(result=>window.settleResult=result);return true})()';
  await Promise.all([a, c].map((p) => p.evaluate(begin)));
  await Promise.all([a, c].map((p) => p.waitFor('typeof window.commit==="function"')));
  await a.evaluate('void window.commit()');
  const one = await a.waitFor('window.settleResult');
  await c.evaluate('void window.commit()');
  const two = await c.waitFor('window.settleResult');
  const state = await a.evaluate('ArcadeCareer.db.exportAll().then(x=>({claims:x.payload.claims.map(y=>[y.runId,y.commissionId]),ledger:x.payload.ledgers.filter(y=>y.runId).map(y=>y.runId),quests:x.payload.quests.filter(y=>y.nodeId.includes("C5")||y.kind==="ending").map(y=>[y.nodeId,y.receiptId]),runs:x.payload.runs.map(y=>[y.runId,y.status])}))');
  console.log(JSON.stringify({ careerId, one, two, state }));
  const c5Rows = state.quests.filter(([nodeId]) => nodeId.includes('C5'));
  const endingRows = state.quests.filter(([nodeId]) => nodeId === 'ending.combat');

  /* 0.20 continuations 原子去重后有两种合法并发形态：
     A) 不同 ticket：败者 already-resolved / settled:false / 未写；
     B) 同 ticket：败者复用同一 run，duplicate:true / wrote:false / settled:true，
        且返回同一收据（不重复入账）。两者都必须满足：一 claim / 一 ledger / 一 C5 /
        一 ending / 同一 receiptId。 */
  const sameTicket = !!two && !!one && two.ticketId === one.ticketId;
  const loserOk = sameTicket
    ? !!(two.ok === true && two.duplicate === true && two.wrote === false && two.settled === true)
    : !!(two.ok === false && two.reason === 'already-resolved' && two.settled === false && two.wrote === false);
  const receiptId = one && one.receipt && one.receipt.receiptId;
  const twoReceiptId = two && two.receipt && two.receipt.receiptId;
  const invariants =
    !!one && one.ok === true && one.wrote === true && one.settled === true &&
    !!receiptId &&
    loserOk &&
    (!twoReceiptId || twoReceiptId === receiptId) &&
    state.claims.length === 1 && state.ledger.length === 1 &&
    state.quests.length === 2 && c5Rows.length === 1 && endingRows.length === 1 &&
    state.quests.every(([, rowReceiptId]) => rowReceiptId === receiptId) &&
    state.claims.every(([runId]) => runId === receiptId) &&
    state.ledger.every((runId) => runId === receiptId);
  console.log(JSON.stringify({ form: sameTicket ? 'same-ticket-duplicate' : 'already-resolved', receiptId, loserOk, invariants }));
  if (!invariants) process.exitCode = 1;
} finally {
  for (const p of tabs) { try { p.ws.close(); } catch {} }
  await stopChrome(chrome);
  server.close();
}
