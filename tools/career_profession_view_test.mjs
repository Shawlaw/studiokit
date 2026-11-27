#!/usr/bin/env node
/**
 * T04 统一职业披露投影门禁（纯 Node）。
 * 覆盖真实 16 职业 + 合成第 17 职业：发现/已读未接受/直接 accept 绕过/接受/搁置、
 * surface、故事/世界 gate、真实历史只读、推荐集合、导入后首渲染、工具与 UMD 纯函数边界。
 * 运行：node tools/career_profession_view_test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIEW_PATH = path.join(ROOT, 'apps/arcade/career/profession-view.js');
const STATE_PATH = path.join(ROOT, 'apps/arcade/career/profession-state.js');
const CONTENT = path.join(ROOT, 'apps/arcade/career/content');
const V = require(VIEW_PATH);
const S = require(STATE_PATH);
const NOW = '2026-11-27T01:00:00.000Z';
const registry = JSON.parse(fs.readFileSync(path.join(CONTENT, 'registry.json'), 'utf8'));
const commissions = JSON.parse(fs.readFileSync(path.join(CONTENT, 'commissions.json'), 'utf8'));
const clues = JSON.parse(fs.readFileSync(path.join(CONTENT, 'clues.json'), 'utf8'));

const catalog = JSON.parse(JSON.stringify({
  games: registry.games,
  professions: registry.professions,
  commissions: commissions.commissions,
  clues: clues.clues,
  tools: [],
  worldWorkIds: [],
}));
const synthetic = {
  professionId: 'service.courier',
  displayName: '合成信使',
  domain: 'service',
  gameId: 'virtual-courier',
  commissionId: 'virtual-courier.T1',
};
catalog.professions.push({ professionId: synthetic.professionId, displayName: synthetic.displayName, domain: 'service', capabilities: [] });
catalog.games.push({ gameId: synthetic.gameId, displayName: '虚拟信使', professions: [synthetic.professionId], capabilities: [] });
catalog.clues.push({ clueId: 'CL-' + synthetic.gameId, gameId: synthetic.gameId, professionId: synthetic.professionId });
catalog.commissions.push({
  commissionId: synthetic.commissionId,
  gameId: synthetic.gameId,
  professionId: synthetic.professionId,
  tier: 1,
  title: '合成第一单',
  summary: '把合成包裹送到指定地点。',
  issuer: '合成驿站',
  objective: { kind: 'courier.delivered', atLeast: 1, context: {} },
  reward: { credits: 1, items: {}, evidence: [], flags: [] },
  repeatSalaryCredits: 1,
  unlock: { all: [] },
  risk: 'low',
  durationHint: '一会儿',
});

let total = 0;
let passed = 0;
const failures = [];
function check(name, ok, detail) {
  total += 1;
  if (ok) passed += 1;
  else failures.push(name + ': ' + String(detail === undefined ? '' : detail));
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), 'expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual));
}
function snapshot(value) { return JSON.stringify(value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function gameFor(professionId) {
  return catalog.games.find((row) => row.professions.indexOf(professionId) >= 0);
}
function commissionFor(professionId) {
  return catalog.commissions.find((row) => row.professionId === professionId && /\.T1$/.test(row.commissionId));
}
function contextFor(extra) {
  return Object.assign({
    now: NOW,
    surface: 'work',
    gameId: null,
    openedClueIds: [],
    knownNpcIds: [],
    worldFlags: [],
    storyEvidence: [],
    clearedCommissions: [],
    activeRuns: [],
    history: [],
    walletKnown: true,
    availableIds: [],
    archived: false,
  }, extra || {});
}
function reveal(state, professionId, context) {
  return V.canRevealProfession({ state, catalog, context: context || contextFor(), professionId });
}
function show(state, commissionId, context) {
  return V.canShowCommission({ state, catalog, context: context || contextFor(), commissionId });
}
function accept(state, commissionId, context) {
  return V.canAcceptCommission({ state, catalog, context: context || contextFor(), commissionId });
}
function project(state, context) {
  return V.projectCareerView({ state, catalog, context: context || contextFor() });
}
function acceptedState(professionId) {
  const game = gameFor(professionId);
  let state = S.initialState(NOW);
  state = S.recordGlimpsed(state, { catalog, professionId, gameId: game.gameId, clueId: 'CL-' + game.gameId, at: NOW }).state;
  state = S.recordRead(state, { catalog, professionId, clueId: 'CL-' + game.gameId, at: NOW }).state;
  state = S.acceptInvitation(state, { catalog, professionId, gameId: game.gameId, at: NOW }).state;
  return state;
}
function pausedState(state, professionId) {
  return S.setPaused(state, { catalog, professionId, paused: true, at: NOW }).state;
}
function reasonIsFrozen(result) {
  return result && (result.ok === true || Object.values(V.REASONS).indexOf(result.reason) >= 0);
}

/* P-00 目录与 N+1 */
check('PV-00 real registry has 16 professions/games', catalog.professions.length === 17 && registry.professions.length === 16 && registry.games.length === 16);
check('PV-00 synthetic mapping exists', gameFor(synthetic.professionId).gameId === synthetic.gameId);
check('PV-00 all commission owners registered', catalog.commissions.every((row) => catalog.professions.some((p) => p.professionId === row.professionId)));
eq('PV-00 frozen reasons', Object.values(V.REASONS).sort(), [
  'archived', 'future-version', 'historical-only', 'not-accepted', 'not-available',
  'not-discovered', 'not-read', 'paused', 'story-locked', 'unknown-commission',
  'unknown-profession', 'world-locked', 'wrong-surface',
].sort());

/* P-01 全部 17 职业参数化状态/披露/绕过/搁置/surface */
catalog.professions.forEach((profession) => {
  const id = profession.professionId;
  const game = gameFor(id);
  const first = commissionFor(id);
  const label = id;
  let state = S.initialState(NOW);
  eq(label + ' initial reveal', reveal(state, id), { ok: false, reason: 'not-discovered' });
  eq(label + ' initial commission', show(state, first.commissionId), { ok: false, reason: 'not-discovered' });
  eq(label + ' initial accept', accept(state, first.commissionId), { ok: false, reason: 'not-discovered' });
  eq(label + ' initial projection professions', project(state).professions, []);
  eq(label + ' initial projection commissions', project(state).commissions, []);

  state = S.recordGlimpsed(state, { catalog, professionId: id, gameId: game.gameId, clueId: 'CL-' + game.gameId, at: NOW }).state;
  eq(label + ' glimpsed reveal', reveal(state, id), { ok: false, reason: 'not-discovered' });
  const bypass = S.acceptInvitation(state, { catalog, professionId: id, gameId: game.gameId, at: NOW });
  check(label + ' direct accept bypass rejected', bypass.ok === false && bypass.reason === 'not-readable' && snapshot(bypass.state) === snapshot(state));
  eq(label + ' bypass cannot show task', show(state, first.commissionId), { ok: false, reason: 'not-discovered' });

  state = S.recordRead(state, { catalog, professionId: id, clueId: 'CL-' + game.gameId, at: NOW }).state;
  eq(label + ' read invitation recovery', reveal(state, id, contextFor({ surface: 'letter' })), { ok: true, invitationOnly: true });
  eq(label + ' read cannot reveal at work', reveal(state, id), { ok: false, reason: 'not-accepted' });
  eq(label + ' read cannot show task', show(state, first.commissionId), { ok: false, reason: 'not-accepted' });
  eq(label + ' read cannot accept task', accept(state, first.commissionId, contextFor({ availableIds: [first.commissionId] })), { ok: false, reason: 'not-accepted' });
  const readProjection = project(state);
  eq(label + ' read projection no profession', readProjection.professions, []);
  eq(label + ' read projection no task', readProjection.commissions, []);

  state = S.acceptInvitation(state, { catalog, professionId: id, gameId: game.gameId, at: NOW }).state;
  eq(label + ' accepted reveal', reveal(state, id), { ok: true });
  eq(label + ' accepted show first', show(state, first.commissionId), { ok: true });
  eq(label + ' accepted not available', accept(state, first.commissionId), { ok: false, reason: 'not-available' });
  eq(label + ' accepted available', accept(state, first.commissionId, contextFor({ availableIds: [first.commissionId] })), { ok: true });
  eq(label + ' commission wrong surface', show(state, first.commissionId, contextFor({ surface: 'shop' })), { ok: false, reason: 'wrong-surface' });
  eq(label + ' archived reveal', reveal(state, id, contextFor({ archived: true })), { ok: false, reason: 'archived' });

  const acceptedProjection = project(state, contextFor({ availableIds: [first.commissionId] }));
  eq(label + ' projection only accepted profession', acceptedProjection.professions.map((row) => row.professionId), [id]);
  eq(label + ' projection only own visible task', acceptedProjection.commissions.map((row) => row.commissionId), [first.commissionId]);
  check(label + ' projection origin', acceptedProjection.originGameId === game.gameId);
  check(label + ' projection active', acceptedProjection.activeProfessionId === id);
  eq(label + ' projection next action', acceptedProjection.story.nextAction, { kind: 'commission', commissionId: first.commissionId, label: first.title });
  const hiddenProfessions = catalog.professions.filter((row) => row.professionId !== id).map((row) => row.professionId);
  check(label + ' no hidden profession id leaks', hiddenProfessions.every((hidden) => snapshot(acceptedProjection).indexOf(hidden) < 0));
  const hiddenCommissions = catalog.commissions.filter((row) => row.commissionId !== first.commissionId).map((row) => row.commissionId);
  check(label + ' no hidden commission id leaks', hiddenCommissions.every((hidden) => snapshot(acceptedProjection).indexOf(hidden) < 0));

  state = pausedState(state, id);
  eq(label + ' paused reveal remains known', reveal(state, id), { ok: true });
  eq(label + ' paused show', show(state, first.commissionId), { ok: false, reason: 'paused' });
  eq(label + ' paused accept', accept(state, first.commissionId, contextFor({ availableIds: [first.commissionId] })), { ok: false, reason: 'paused' });
  eq(label + ' paused projection task withheld', project(state, contextFor({ availableIds: [first.commissionId] })).commissions, []);
  check(label + ' paused projection keeps profession', project(state).professions[0].paused === true);
  check(label + ' all gate reasons frozen', [reveal(state, id), show(state, first.commissionId), accept(state, first.commissionId)].every(reasonIsFrozen));
});

/* P-02 推荐不能绕过 availableIds/gate；多职业当前职业优先 */
{
  const a = 'nature.miner';
  const b = 'research.archivist';
  const aJob = commissionFor(a).commissionId;
  const bJob = commissionFor(b).commissionId;
  let state = acceptedState(a);
  state = S.recordGlimpsed(state, { catalog, professionId: b, gameId: gameFor(b).gameId, at: NOW }).state;
  state = S.recordRead(state, { catalog, professionId: b, at: NOW }).state;
  state = S.acceptInvitation(state, { catalog, professionId: b, gameId: gameFor(b).gameId, at: NOW }).state;
  state = S.setActive(state, { catalog, professionId: b, at: NOW }).state;
  eq('PV-02 origin fixed to first acceptance', state.acceptedOriginGameId, gameFor(a).gameId);
  eq('PV-02 recommendation prefers active accepted', V.getNextNarrativeAction({
    state, catalog, context: contextFor({ availableIds: [aJob, bJob] }),
  }), { kind: 'commission', commissionId: bJob, label: commissionFor(b).title });
  eq('PV-02 recommendation unavailable empty', V.getNextNarrativeAction({ state, catalog, context: contextFor() }), null);
  eq('PV-02 recommendation cannot select locked', V.getNextNarrativeAction({
    state, catalog, context: contextFor({ availableIds: ['memory-flip.T2'] }),
  }), null);
  eq('PV-02 recommendation cannot select hidden', V.getNextNarrativeAction({
    state, catalog, context: contextFor({ availableIds: [commissionFor('intel.risk').commissionId] }),
  }), null);
}

/* P-03 真实历史只读；已接受但前置变化也保留历史入口 */
{
  const id = 'nature.miner';
  const job = commissionFor(id);
  let state = S.initialState(NOW);
  state = S.recordGlimpsed(state, { catalog, professionId: id, gameId: gameFor(id).gameId, at: NOW }).state;
  state = S.recordRead(state, { catalog, professionId: id, at: NOW }).state;
  const history = [{ commissionId: job.commissionId, status: 'claimed', claimedAt: NOW, receiptId: 'r1' }];
  const journal = contextFor({ surface: 'journal', history });
  eq('PV-03 unaccepted real history visible', show(state, job.commissionId, journal), { ok: true, reason: 'historical-only', historicalOnly: true });
  eq('PV-03 history not actionable', accept(state, job.commissionId, Object.assign({}, journal, { availableIds: [job.commissionId] })), { ok: false, reason: 'historical-only' });
  eq('PV-03 history not in work', show(state, job.commissionId, contextFor({ history })), { ok: false, reason: 'not-accepted' });
  const projected = V.getVisibleCommissions({ state, catalog, context: journal });
  eq('PV-03 history projection count', projected.length, 1);
  check('PV-03 history readOnly', projected[0].readOnly === true && projected[0].historicalOnly === true);
  check('PV-03 history strips owner id', !Object.prototype.hasOwnProperty.call(projected[0], 'professionId'));
  eq('PV-03 history projection no profession array', project(state, journal).professions, []);

  state = acceptedState(id);
  const tier2 = catalog.commissions.find((row) => row.professionId === id && /\.T2$/.test(row.commissionId));
  eq('PV-03 accepted locked story', show(state, tier2.commissionId), { ok: false, reason: 'story-locked' });
  const active = [{ commissionId: tier2.commissionId, status: 'active', runId: 'run-1' }];
  eq('PV-03 active run keeps read-only explanation in projection', show(state, tier2.commissionId, contextFor({ surface: 'journal', activeRuns: active })), { ok: true, reason: 'historical-only', historicalOnly: true });
  eq('PV-03 projection alone never authorizes new acceptance', accept(state, tier2.commissionId, contextFor({ surface: 'journal', activeRuns: active, availableIds: [tier2.commissionId] })), { ok: false, reason: 'historical-only' });
}

/* P-04 世界通用工作：任一已接受职业可承接，paused 不阻塞世界主线，不暴露拥有职业 */
{
  const ownerJob = commissionFor('adventure.pilot');
  const worldCatalog = clone(catalog);
  worldCatalog.worldWork = {
    commissionIds: [ownerJob.commissionId],
    works: [{ commissionId: ownerJob.commissionId, title: '旧港通用巡逻', summary: '沿旧航道完成一次通用巡查。' }],
  };
  const accepted = acceptedState('nature.miner');
  const paused = pausedState(accepted, 'nature.miner');
  const context = contextFor({ availableIds: [ownerJob.commissionId] });
  const shown = V.canShowCommission({ state: paused, catalog: worldCatalog, context, commissionId: ownerJob.commissionId });
  eq('PV-04 world work visible while profession paused', shown, { ok: true });
  const visible = V.getVisibleCommissions({ state: paused, catalog: worldCatalog, context });
  eq('PV-04 world work projected', visible.map((row) => row.commissionId), [ownerJob.commissionId]);
  check('PV-04 world category', visible[0].category === 'world' && visible[0].worldWork === true);
  check('PV-04 world owner id stripped', !Object.prototype.hasOwnProperty.call(visible[0], 'professionId'));
  check('PV-04 world owner name absent', snapshot(visible[0]).indexOf('星际飞行员') < 0);
  eq('PV-04 world generic title', visible[0].title, '旧港通用巡逻');
  eq('PV-04 world generic summary', visible[0].summary, '沿旧航道完成一次通用巡查。');
  check('PV-04 owner title/summary withheld', snapshot(visible[0]).indexOf(ownerJob.title) < 0 && snapshot(visible[0]).indexOf(ownerJob.summary) < 0);
  eq('PV-04 world work no accepted profession', V.canShowCommission({
    state: S.initialState(NOW), catalog: worldCatalog, context, commissionId: ownerJob.commissionId,
  }), { ok: false, reason: 'not-accepted' });
}

/* P-05 故事/世界条件、surface、future、unknown */
{
  const id = 'engineering.structural';
  const state = acceptedState(id);
  const custom = clone(catalog);
  custom.commissions.push({
    commissionId: 'world.test.item', gameId: 'pendulum-tower', professionId: id, tier: 1,
    title: '合成世界条件', summary: '需要合成材料。', issuer: '旧港',
    objective: { kind: 'tower.floor_stable', atLeast: 1, context: {} },
    reward: { credits: 0, items: {}, evidence: [], flags: [] }, repeatSalaryCredits: 0,
    unlock: { all: [{ kind: 'item', value: 'alloy', atLeast: 2 }] }, risk: 'low', durationHint: '',
  });
  eq('PV-05 world locked', V.canShowCommission({ state, catalog: custom, context: contextFor(), commissionId: 'world.test.item' }), { ok: false, reason: 'world-locked' });
  eq('PV-05 world condition met', V.canShowCommission({ state, catalog: custom, context: contextFor({ items: { alloy: 2 } }), commissionId: 'world.test.item' }), { ok: true });
  eq('PV-05 invalid surface', reveal(state, id, contextFor({ surface: 'not-a-surface' })), { ok: false, reason: 'wrong-surface' });
  eq('PV-05 unknown profession', reveal(state, 'hidden.profession'), { ok: false, reason: 'unknown-profession' });
  eq('PV-05 unknown commission', show(state, 'hidden.T1'), { ok: false, reason: 'unknown-commission' });
  const future = Object.assign({}, state, { professionVersion: 2, futureOnly: true });
  eq('PV-05 future reveal', reveal(future, id), { ok: false, reason: 'future-version' });
  eq('PV-05 future commission', show(future, commissionFor(id).commissionId), { ok: false, reason: 'future-version' });
  eq('PV-05 future projection', project(future), {
    schemaVersion: 1, originGameId: null, activeProfessionId: null, professions: [], commissions: [],
    story: { nextAction: null, messages: [], history: [] }, tools: [],
  });
}

/* P-06 导入后首渲染、故事/工具过滤与纯函数 */
{
  const acceptedId = 'nature.miner';
  const hiddenId = 'adventure.pilot';
  let state = acceptedState(acceptedId);
  state = S.recordGlimpsed(state, { catalog, professionId: hiddenId, gameId: gameFor(hiddenId).gameId, at: NOW }).state;
  state = S.recordRead(state, { catalog, professionId: hiddenId, at: NOW }).state;
  state = S.recordStoryEvent(state, { eventId: 'invitation:' + hiddenId, source: 'clue', at: NOW }).state;
  state = S.recordStoryEvent(state, { eventId: 'commission:' + commissionFor(hiddenId).commissionId, source: 'commission', at: NOW }).state;
  state = S.recordStoryEvent(state, { eventId: 'story:' + hiddenId + '.secret', source: 'story', at: NOW }).state;
  state = S.recordStoryEvent(state, { eventId: 'invitation:' + acceptedId, source: 'clue', at: NOW }).state;
  state = S.recordStoryEvent(state, { eventId: 'commission:' + commissionFor(acceptedId).commissionId, source: 'commission', at: NOW }).state;
  state = S.recordStoryEvent(state, { eventId: 'story:world_arrival', source: 'world', at: NOW }).state;
  state = S.recordStoryEvent(state, { eventId: 'tech:debug_trace', source: 'system', at: NOW }).state;
  const imported = JSON.parse(JSON.stringify(state));
  const withTools = clone(catalog);
  withTools.publicStoryEventIds = ['story:world_arrival'];
  withTools.publicStoryEvents = { 'story:world_arrival': { label: '旧港重新亮起' } };
  withTools.tools = [
    { toolId: 'tool.accepted', name: '已引入工具', professionId: acceptedId },
    { toolId: 'tool.hidden', name: '未引入工具', professionId: hiddenId },
    { toolId: 'tool.world', name: '世界工具', worldFlag: 'world.tools_ready' },
  ];
  const context = contextFor({ availableIds: [commissionFor(acceptedId).commissionId], worldFlags: ['world.tools_ready'] });
  const beforeState = snapshot(imported);
  const beforeCatalog = snapshot(withTools);
  const beforeContext = snapshot(context);
  const first = V.projectCareerView({ state: imported, catalog: withTools, context });
  const second = V.projectCareerView({ state: imported, catalog: withTools, context });
  eq('PV-06 import first render deterministic', first, second);
  eq('PV-06 input state untouched', snapshot(imported), beforeState);
  eq('PV-06 input catalog untouched', snapshot(withTools), beforeCatalog);
  eq('PV-06 input context untouched', snapshot(context), beforeContext);
  eq('PV-06 tools only introduced', first.tools.map((row) => row.toolId), ['tool.accepted', 'tool.world']);
  check('PV-06 hidden invitation not in story', snapshot(first.story.history).indexOf(hiddenId) < 0);
  check('PV-06 hidden commission/story events not in projection', snapshot(first).indexOf(commissionFor(hiddenId).commissionId) < 0);
  check('PV-06 technical event not in projection', snapshot(first).indexOf('tech:debug_trace') < 0);
  check('PV-06 hidden profession absent after import', snapshot(first).indexOf(hiddenId) < 0);
  check('PV-06 public history uses player labels', first.story.history.some((row) => row.label === '旧港重新亮起'));
  check('PV-06 accepted invitation uses player label', first.story.history.some((row) => row.kind === 'invitation' && row.professionId === acceptedId));
  check('PV-06 accepted commission event is visible', first.story.history.some((row) => row.kind === 'commission' && row.commissionId === commissionFor(acceptedId).commissionId));
  check('PV-06 no raw internal eventId emitted', first.story.history.every((row) => !Object.prototype.hasOwnProperty.call(row, 'eventId')));
  const source = fs.readFileSync(VIEW_PATH, 'utf8');
  const forbidden = [/\bDate\s*\(/, /\blocalStorage\s*[.[]/, /\bindexedDB\b/, /\bdocument\s*\./, /\bfetch\s*\(/];
  check('PV-06 no DOM/DB/clock/network', forbidden.every((pattern) => !pattern.test(source)));
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'profession-view.js' });
  check('PV-06 browser UMD mount', !!sandbox.ArcadeCareerProfessionView && sandbox.ArcadeCareer.professionView === sandbox.ArcadeCareerProfessionView);
  eq('PV-06 Node/browser API parity', Object.keys(sandbox.ArcadeCareerProfessionView).sort(), Object.keys(V).sort());
}

const failed = failures.length;
console.log((passed) + '/' + total + ' checks passed');
if (failed) {
  failures.forEach((item, index) => console.error('FAIL  ' + (index + 1) + '. ' + item));
  console.error('FAIL  career profession view test');
  process.exit(1);
}
console.log('PASS  career profession view test');
