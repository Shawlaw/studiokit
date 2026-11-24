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
  if (!one.ok || two.ok || two.reason !== 'already-resolved' || two.settled !== false || state.claims.length !== 1 || state.ledger.length !== 1 || state.quests.length !== 2 || c5Rows.length !== 1 || endingRows.length !== 1 || state.quests.some(([, receiptId]) => receiptId !== one.ticketId)) {
    process.exitCode = 1;
  }
} finally {
  for (const p of tabs) { try { p.ws.close(); } catch {} }
  await stopChrome(chrome);
  server.close();
}
