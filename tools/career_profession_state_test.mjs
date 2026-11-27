#!/usr/bin/env node
/**
 * T01 职业披露状态冻结测试（纯 Node，无 Chrome、无端口、无写文件）。
 *
 * 覆盖：初始化/坏快照修复、16 职业参数化状态迁移、重复接受幂等、N+1 职业、
 * 搁置正交、真实旧档证据回填、纯函数不改入参、显式 catalog 校验。
 * 运行：node tools/career_profession_state_test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const S = require(path.join(ROOT, 'apps/arcade/career/profession-state.js'));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? '' : String(detail === undefined ? '' : detail) });
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'expected ' + e + ' got ' + a);
}
function snapshot(value) { return JSON.stringify(value); }
function valid(result, name) {
  check(name + ' ok', result && result.ok === true, JSON.stringify(result));
  return result && result.state ? result.state : null;
}

const NOW = '2026-11-27T01:00:00.000Z';
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/arcade/career/content/registry.json'), 'utf8'));
const commissions = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/arcade/career/content/commissions.json'), 'utf8'));
const clues = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/arcade/career/content/clues.json'), 'utf8'));
const catalog = {
  games: registry.games,
  professions: registry.professions,
  commissions: commissions.commissions,
  clues: clues.clues,
};

/* P-01 初始/规整 */
{
  check('P-00 registry count', catalog.professions.length === 16 && catalog.games.length === 16, JSON.stringify({ p: catalog.professions.length, g: catalog.games.length }));
  check('P-00 ids unique', new Set(catalog.professions.map((row) => row.professionId)).size === catalog.professions.length);
  catalog.professions.forEach((profession) => {
    const game = catalog.games.find((row) => row.professions.indexOf(profession.professionId) >= 0);
    check('P-00 mapping ' + profession.professionId, !!game);
  });
  const s = S.initialState(NOW);
  eq('P-01a schema', S.SCHEMA_VERSION, 1);
  eq('P-01a2 profession version', S.PROFESSION_VERSION, 1);
  eq('P-01b states', S.STATES, ['undiscovered', 'glimpsed', 'read', 'accepted', 'developed', 'completed']);
  eq('P-01c firstDiscovered null', s.firstDiscoveredGameId, null);
  eq('P-01d acceptedOrigin null', s.acceptedOriginGameId, null);
  eq('P-01e active null', s.activeProfessionId, null);
  eq('P-01f no progress', s.professionProgress, {});
  eq('P-01g cursor', s.narrativeCursor, { chapterId: 'C0', nodeId: null });

  const broken = S.normalizeExtension({
    firstSourceGame: 'gold-miner',
    acceptedOriginGameId: 'NOT VALID',
    activeProfessionId: 'nature.miner',
    professionProgress: {
      'nature.miner': { state: 'BAD', discoveredAt: 'x', readAt: 'y', paused: 'yes' },
      'BAD ID': { state: 'accepted' },
    },
    storyEvents: { bad: {}, 'event:1': { at: NOW, source: 'clue' }, 'event:2': null },
  }, NOW);
  eq('P-01h first source fallback', broken.firstDiscoveredGameId, 'gold-miner');
  eq('P-01i invalid origin dropped', broken.acceptedOriginGameId, null);
  eq('P-01j invalid time ignored', broken.professionProgress['nature.miner'].state, 'undiscovered');
  check('P-01k paused normalized', broken.professionProgress['nature.miner'].paused === false);
  check('P-01l bad profession id dropped', !broken.professionProgress['BAD ID']);
  eq('P-01m valid story event kept', broken.storyEvents['event:1'].source, 'clue');
  eq('P-01n bad story events dropped', Object.keys(broken.storyEvents).length, 1);
  const future = S.normalizeExtension({ professionVersion: 2, acceptedOriginGameId: 'gold-miner', futureOnlyField: 7 }, NOW);
  eq('P-01p future version preserved', future.professionVersion, 2);
  eq('P-01q future unknown field preserved', future.futureOnlyField, 7);
  const futureState = S.mergeIntoDiscovery(S.initialState(NOW), future, NOW);
  eq('P-01r future never written back', futureState.professionVersion, 1);
  check('P-01s future unknown field not merged', !Object.prototype.hasOwnProperty.call(futureState, 'futureOnlyField'));
  check('P-01t future state itself preserved read-only', S.normalizeExtension(Object.assign({}, S.initialState(NOW), future), NOW).professionVersion === 2);
  check('P-01o active cannot imply acceptance', !S.validate(S.mergeIntoDiscovery(S.initialState(NOW), { activeProfessionId: 'nature.miner' }, NOW), catalog).ok);
}

/* P-02 全部真实职业遍历：发现→已读→接受→当前/搁置→进阶 */
{
  catalog.professions.forEach((profession) => {
    const id = profession.professionId;
    const game = catalog.games.find((row) => row.professions.indexOf(id) >= 0);
    let state = S.initialState(NOW);
    state = valid(S.recordGlimpsed(state, { catalog, professionId: id, gameId: game.gameId, clueId: 'CL-' + game.gameId, at: NOW }), id + '-glimpse');
    eq(id + ' state glimpsed', state.professionProgress[id].state, 'glimpsed');
    eq(id + ' first discovered', state.firstDiscoveredGameId, game.gameId);
    check(id + ' origin still null', !state.acceptedOriginGameId);
    state = valid(S.recordRead(state, { catalog, professionId: id, clueId: 'CL-' + game.gameId, at: NOW }), id + '-read');
    eq(id + ' state read', state.professionProgress[id].state, 'read');
    check(id + ' origin still null until invite', !state.acceptedOriginGameId);
    const accepted = S.acceptInvitation(state, { catalog, professionId: id, gameId: game.gameId, at: NOW });
    state = valid(accepted, id + '-accept');
    check(id + ' origin fixed', state.acceptedOriginGameId === game.gameId);
    check(id + ' newly accepted first', accepted.newlyAccepted === true);
    eq(id + ' active', state.activeProfessionId, id);
    const duplicate = S.acceptInvitation(state, { catalog, professionId: id, gameId: game.gameId, at: NOW });
    check(id + ' duplicate flagged', duplicate.ok && duplicate.duplicate === true && duplicate.newlyAccepted === false);
    eq(id + ' duplicate state unchanged', snapshot(duplicate.state), snapshot(state));
    state = valid(S.setPaused(state, { catalog, professionId: id, paused: true, at: NOW }), id + '-pause');
    eq(id + ' paused', state.professionProgress[id].paused, true);
    eq(id + ' state still accepted', state.professionProgress[id].state, 'accepted');
    state = valid(S.setActive(state, { catalog, professionId: id, at: NOW }), id + '-active');
    state = valid(S.markDeveloped(state, { catalog, professionId: id, at: NOW }), id + '-developed');
    state = valid(S.markCompleted(state, { catalog, professionId: id, at: NOW }), id + '-completed');
    eq(id + ' completed', state.professionProgress[id].state, 'completed');
    check(id + ' paused orthogonal', state.professionProgress[id].paused === true);
    check(id + ' validate passes', S.validate(state, catalog).ok === true);
  });
}

/* P-03 直接 accept 绕过 read 必须拒绝；多职业平行；N+1 */
{
  const s = S.initialState(NOW);
  check('P-03a direct accept rejected', S.acceptInvitation(s, { catalog, professionId: 'nature.miner', gameId: 'gold-miner', at: NOW }).reason === 'not-readable');
  check('P-03b setActive unaccepted rejected', S.setActive(s, { catalog, professionId: 'nature.miner', at: NOW }).reason === 'not-accepted');

  let state = S.initialState(NOW);
  for (const [professionId, gameId] of [['nature.miner', 'gold-miner'], ['research.archivist', 'memory-flip']]) {
    state = S.recordGlimpsed(state, { catalog, professionId, gameId, at: NOW }).state;
    state = S.recordRead(state, { catalog, professionId, at: NOW }).state;
    state = S.acceptInvitation(state, { catalog, professionId, gameId, at: NOW }).state;
  }
  eq('P-03c origin fixed to first accepted', state.acceptedOriginGameId, 'gold-miner');
  eq('P-03d two professions accepted', Object.keys(state.professionProgress).length, 2);
  eq('P-03e later accept does not change origin', state.acceptedOriginGameId, 'gold-miner');
  const beforeDuplicate = snapshot(state);
  const duplicateOther = S.acceptInvitation(state, { catalog, professionId: 'nature.miner', gameId: 'gold-miner', at: '2026-11-27T02:00:00.000Z' });
  check('P-03h duplicate other is no-op', duplicateOther.ok && duplicateOther.duplicate === true && duplicateOther.newlyAccepted === false && snapshot(duplicateOther.state) === beforeDuplicate);
  eq('P-03i active remains explicit second profession', duplicateOther.state.activeProfessionId, 'research.archivist');
  check('P-03j wrong game mapping rejected', S.recordGlimpsed(S.initialState(NOW), { catalog, professionId: 'nature.miner', gameId: 'memory-flip', at: NOW }).reason === 'profession-game-mismatch');
  check('P-03k direct read rejected', S.recordRead(S.initialState(NOW), { catalog, professionId: 'nature.miner', clueId: 'CL-gold-miner', at: NOW }).reason === 'not-discovered');
  const glimpsedWithoutGame = S.recordGlimpsed(S.initialState(NOW), { catalog, professionId: 'nature.miner', gameId: 'gold-miner', at: NOW }).state;
  const readWithoutGame = S.recordRead(glimpsedWithoutGame, { catalog, professionId: 'nature.miner', at: NOW }).state;
  check('P-03l first accept without game rejected', S.acceptInvitation(readWithoutGame, { catalog, professionId: 'nature.miner' }).reason === 'missing-game-id');
  const extended = JSON.parse(JSON.stringify(catalog));
  extended.professions.push({ professionId: 'service.courier', displayName: '合成职业', domain: 'service' });
  extended.games.push({ gameId: 'virtual-courier', professions: ['service.courier'], displayName: '虚拟职业' });
  let n = S.initialState(NOW);
  n = S.recordGlimpsed(n, { catalog: extended, professionId: 'service.courier', gameId: 'virtual-courier', at: NOW }).state;
  n = S.recordRead(n, { catalog: extended, professionId: 'service.courier', at: NOW }).state;
  n = S.acceptInvitation(n, { catalog: extended, professionId: 'service.courier', gameId: 'virtual-courier', at: NOW }).state;
  check('P-03f N+1 validates', S.validate(n, extended).ok === true);
  check('P-03g N+1 origin', n.acceptedOriginGameId === 'virtual-courier');
}

/* P-04 旧档迁移只认真实证据 */
{
  const clean = S.initialState(NOW);
  const nullResult = S.deriveLegacyAcceptance(clean, {
    catalog,
    records: {
      profile: { acceptedProfessionIds: [], originGameId: null },
      quests: [{ careerId: 'c1', nodeId: 'story:C0.port_seen', status: 'cleared' }],
      claims: [],
      runs: [],
    },
    now: NOW,
  });
  eq('P-04a clue/task-free migration zero', nullResult.derived.length, 0);
  eq('P-04b no fabricated origin', nullResult.state.acceptedOriginGameId, null);

  const legacy = JSON.parse(JSON.stringify(clean));
  legacy.firstSourceGame = 'shadow-leap';
  legacy.firstDiscoveredGameId = 'shadow-leap';
  legacy.clues = { 'CL-shadow-leap': { sourceGame: 'shadow-leap', openedAt: NOW } };
  const result = S.deriveLegacyAcceptance(legacy, {
    catalog,
    records: {
      profile: { careerId: 'legacy', originGameId: null, updatedAt: NOW },
      quests: [
        { careerId: 'legacy', nodeId: 'shadow-leap.T1', status: 'cleared', clearedAt: '2026-11-20T00:00:00.000Z' },
        { careerId: 'legacy', nodeId: 'memory-flip.T2', status: 'active' },
      ],
      claims: [{ careerId: 'legacy', commissionId: 'memory-flip.T1', claimedAt: '2026-11-21T00:00:00.000Z' }],
      runs: [{ careerId: 'legacy', commissionId: 'gold-miner.T1', status: 'failed', createdAt: '2026-11-19T00:00:00.000Z' }],
    },
    now: NOW,
  });
  check('P-04c migration ok', result.ok === true);
  const ids = result.derived.map((row) => row.professionId).sort();
  eq('P-04d only real accepted professions', ids, ['adventure.relicseeker', 'nature.miner', 'research.archivist'].sort());
  eq('P-04e origin from earliest evidence', result.state.acceptedOriginGameId, 'gold-miner');
  eq('P-04f discovery fact preserved', result.state.firstDiscoveredGameId, 'shadow-leap');
  eq('P-04g active remains null without explicit choice', result.state.activeProfessionId, null);
  check('P-04h migration validate passes', S.validate(result.state, catalog).ok === true);
  const repeated = S.deriveLegacyAcceptance(result.state, {
    catalog,
    records: { profile: null, quests: [], claims: [], runs: [] },
    now: NOW,
  });
  eq('P-04i migration idempotent', snapshot(repeated.state), snapshot(result.state));
  const unknownTime = S.deriveLegacyAcceptance(S.initialState(NOW), {
    catalog,
    records: {
      profile: { acceptedProfessionIds: ['research.archivist'], acceptedAt: {}, updatedAt: NOW },
      quests: [{ commissionId: 'nature.miner', status: 'unknown' }],
      claims: [],
      runs: [],
    },
    now: NOW,
  });
  eq('P-04j accepted without time keeps origin null', unknownTime.state.acceptedOriginGameId, null);
  eq('P-04k accepted without time keeps active null', unknownTime.state.activeProfessionId, null);
  eq('P-04l accepted evidence still recorded', unknownTime.state.professionProgress['research.archivist'].state, 'accepted');
  check('P-04m unknown quest status ignored', !unknownTime.state.professionProgress['nature.miner']);
  const explicit = S.deriveLegacyAcceptance(S.initialState(NOW), {
    catalog,
    records: {
      profile: { acceptedProfessionIds: ['research.archivist', 'nature.miner'], acceptedAt: { 'research.archivist': '2026-11-20T00:00:00.000Z', 'nature.miner': '2026-11-19T00:00:00.000Z' }, activeProfessionId: 'research.archivist' },
      quests: [], claims: [], runs: [],
    },
    now: NOW,
  });
  eq('P-04n explicit active preserved', explicit.state.activeProfessionId, 'research.archivist');
  eq('P-04o earliest valid acceptedAt origin', explicit.state.acceptedOriginGameId, 'gold-miner');
  const badTime = S.normalizeExtension({ professionProgress: { 'nature.miner': { state: 'accepted', acceptedAt: 'garbage' } } }, NOW);
  eq('P-04p garbage acceptance time ignored', badTime.professionProgress['nature.miner'].acceptedAt, null);
  const timeOrder = S.deriveLegacyAcceptance(S.initialState(NOW), {
    catalog,
    records: {
      profile: { acceptedProfessionIds: ['nature.miner'], acceptedAt: {} },
      quests: [],
      claims: [],
      runs: [{ commissionId: 'gold-miner.T1', createdAt: '2026-11-19T00:00:00.000Z' }],
    },
    now: NOW,
  });
  eq('P-04q valid time replaces unknown time', timeOrder.state.acceptedOriginGameId, 'gold-miner');
}

/* P-05 纯函数、故事事件与边界 */
{
  const base = S.initialState(NOW);
  const before = snapshot(base);
  const r = S.recordGlimpsed(base, { catalog, professionId: 'nature.miner', gameId: 'gold-miner', at: NOW });
  eq('P-05a input untouched', snapshot(base), before);
  check('P-05b result is new object', r.state !== base);
  eq('P-05c bad clue id rejected', S.recordRead(base, { catalog, professionId: 'nature.miner', clueId: 'BAD ID', at: NOW }).reason, 'bad-clue-id');
  const event = S.recordStoryEvent(r.state, { eventId: 'story:invitation', source: 'clue', at: NOW });
  eq('P-05d story event stored', event.state.storyEvents['story:invitation'].source, 'clue');
  eq('P-05e cursor follows event', event.state.narrativeCursor.nodeId, 'story:invitation');
  const duplicateEvent = S.recordStoryEvent(event.state, { eventId: 'story:invitation', source: 'changed', at: '2026-11-27T02:00:00.000Z' });
  check('P-05g duplicate story event no-op', duplicateEvent.duplicate === true && snapshot(duplicateEvent.state) === snapshot(event.state));
  let many = S.initialState(NOW);
  for (let i = 0; i < 257; i += 1) {
    many = S.recordStoryEvent(many, { eventId: 'story:e' + String(i).padStart(3, '0'), source: 'test', at: NOW }).state;
  }
  eq('P-05h story event cap', Object.keys(many.storyEvents).length, 256);
  check('P-05i oldest event evicted deterministically', !many.storyEvents['story:e000'] && many.storyEvents['story:e256']);
  check('P-05j no clock used', S.initialState().updatedAt === '');
  const preserved = S.mergeIntoDiscovery(
    Object.assign({}, base, { stage: 'GLIMPSED', clues: { 'CL-gold-miner': { sourceGame: 'gold-miner' } } }),
    r.state,
    NOW
  );
  eq('P-05k legacy discovery facts preserved', preserved.stage, 'GLIMPSED');
  check('P-05l extension survives merge', preserved.professionProgress['nature.miner'].state === 'glimpsed' && preserved.firstDiscoveredGameId === 'gold-miner');
}

const failed = results.filter((row) => !row.ok);
results.forEach((row) => console.log((row.ok ? 'PASS  ' : 'FAIL  ') + row.name + (row.ok ? '' : ' — ' + row.detail)));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) {
  console.error('FAIL  career profession state test');
  process.exit(1);
}
console.log('PASS  career profession state test');
