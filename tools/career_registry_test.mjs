#!/usr/bin/env node
/**
 * B02 契约测试：数据驱动生涯注册表（纯 Node，不需要 Chrome）
 *
 * 覆盖：
 * - 首季 16 个 gameId 可注册，运行时不写死 16 / 96 / 六章；
 * - 事件名字典单一来源：夹具直接从 content/registry.json 读取 watch.kind，不再维护第二份；
 * - 注入虚拟第 17 款游戏（gameId 与 professionId 多对多、单游戏 0..N 委托）；
 * - 同游戏双职业 / 同职业双游戏；0 委托但可发现线索；1 委托独立可枚举；
 * - 故事条件语义（capability / evidence / flag / item / credits / ANY / ALL）；
 * - objective.context 匹配（相等 / gte / lte / 缺失不算 / 多余忽略）；
 * - clueRef 唯一且形如 CL-<gameId>；getGame/list* 返回只读深拷贝；
 * - 非法/缺失内容包只告警不崩溃；重复 ID 保留第一条。
 *
 * 运行：node tools/career_registry_test.mjs
 * 退出码：0 = 全 PASS；1 = 有 FAIL；2 = 使用错误（本脚本无参数）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const registryModule = require(path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'registry.js'));
const { createRegistry, conditionMatches, matchContext } = registryModule;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? '' : detail === undefined ? '' : String(detail) });
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'expected ' + e + ' got ' + a);
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/* 首季 16 款游戏（与 engine.js GAMES 对齐的稳定 ID）；运行时不得用长度做逻辑。 */
const SEASON_GAMES = [
  'memory-flip', 'merge-2048', 'blackjack', 'gomoku', 'solitaire', 'snowbells',
  'brick-breaker', 'gravity-flip', 'snake-run', 'mole-whack', 'block-drop',
  'star-raid', 'road-rush', 'shadow-leap', 'pendulum-tower', 'gold-miner',
];

const REAL_REGISTRY_PATH = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'registry.json');
const realContent = JSON.parse(fs.readFileSync(REAL_REGISTRY_PATH, 'utf8'));

function realKinds(gameId) {
  const game = (realContent.games || []).filter((g) => g.gameId === gameId)[0];
  if (!game || !Array.isArray(game.watch) || !game.watch.length) throw new Error('registry.json 缺少 watch.kind: ' + gameId);
  return game.watch.map((w) => w.kind);
}

function realKind(gameId) {
  return realKinds(gameId)[0];
}

/* 首季基础 bundle：直接复用真实内容（单一事件名字典），测试内只注入合成委托。 */
function baseBundle() {
  const bundle = clone(realContent);
  bundle.commissions = [];
  bundle.story = { schemaVersion: 1, nodes: [], edges: [] };
  return bundle;
}

function syntheticCommission(gameId, overrides) {
  const professionId = ((realContent.games || []).filter((g) => g.gameId === gameId)[0].professions || [])[0];
  return Object.assign(
    {
      commissionId: gameId + '.T1',
      gameId,
      professionId,
      tier: 1,
      tierUnlock: 'RESIDENT',
      objective: { kind: realKind(gameId), atLeast: 3, context: {} },
      reward: { credits: 70, items: { alloy: 1 }, evidence: ['tag-a'], flags: [] },
      repeatSalaryCredits: 75,
      handoff: { text: 'next', evidence: [] },
      failure: { hint: 'retry' },
      minValidEngagement: 0,
    },
    overrides || {}
  );
}

/* ---------- R-01 空/缺失输入不崩溃 ---------- */
{
  const registry = createRegistry(null);
  check('R-01a null bundle does not throw', !!registry);
  eq('R-01b null bundle has no games', registry.listGames().length, 0);
  eq('R-01c null bundle has no commissions', registry.listCommissions().length, 0);
  check('R-01d null bundle exposes warnings array', Array.isArray(registry.warnings));
  const unsupported = createRegistry({ schemaVersion: 9, games: [] });
  check('R-01e unsupported schemaVersion recorded as error', unsupported.errors.length === 1, JSON.stringify(unsupported.errors));
}

/* ---------- R-02 首季 16 游戏与真实内容可注册 ---------- */
const bundle = baseBundle();
bundle.commissions.push(syntheticCommission('memory-flip'));
const r16 = createRegistry(bundle);
{
  eq('R-02a listGames length 16', r16.listGames().length, 16);
  eq(
    'R-02b frozen gameId set matches',
    r16.listGames().map((g) => g.gameId).sort(),
    SEASON_GAMES.slice().sort()
  );
  eq('R-02c no registration errors', r16.errors, []);
  check('R-02d every game has clueRef + watch', r16.listGames().every((g) => !!g.clueRef && g.watch.length > 0));
  eq('R-02e professions 16', r16.listProfessions().length, 16);
  eq('R-02f commission for memory-flip', r16.listCommissions({ gameId: 'memory-flip' }).length, 1);
  eq('R-02g commission filter by profession', r16.listCommissions({ professionId: 'research.lattice' }).length, 0);
  eq('R-02h unknown game filter empty', r16.listCommissions({ gameId: 'not-a-game' }).length, 0);
  check('R-02i every watch kind is a non-empty lowercase token', r16.listGames().every((g) => g.watch.every((w) => /^[a-z0-9][a-z0-9._-]*$/.test(w.kind))));
  check('R-02j kind spelling comes from real registry.json (all watches)', r16.listGames().every((g) => JSON.stringify(g.watch.map((w) => w.kind)) === JSON.stringify(realKinds(g.gameId))), JSON.stringify(r16.listGames().filter((g) => JSON.stringify(g.watch.map((w) => w.kind)) !== JSON.stringify(realKinds(g.gameId))).map((g) => g.gameId)));
}

/* ---------- R-03 注入虚拟第 17 款游戏 ---------- */
const virtualBundle = clone(bundle);
virtualBundle.games.push({
  gameId: 'virtual-coffee',
  displayName: '虚拟咖啡店（第17款）',
  adapterVersion: 1,
  discoverable: true,
  clueRef: 'CL-virtual-coffee',
  professions: ['service.barista', 'commerce.shopkeeper'],
  capabilities: ['service.fulfilled_order', 'economy.credits_earned'],
  watch: [{ kind: 'order.fulfilled', payload: { n: 'number' }, modes: ['classic'] }],
  commissions: [],
});
virtualBundle.professions.push(
  { professionId: 'service.barista', displayName: '咖啡师', domain: 'service', capabilities: ['service.fulfilled_order'] },
  { professionId: 'commerce.shopkeeper', displayName: '店主', domain: 'commerce', capabilities: ['economy.credits_earned'] }
);
virtualBundle.commissions.push({
  commissionId: 'virtual-coffee.shift-01',
  gameId: 'virtual-coffee',
  professionId: 'service.barista',
  tier: 1,
  tierUnlock: 'RESIDENT',
  objective: { kind: 'order.fulfilled', atLeast: 3, context: {} },
  reward: { credits: 40, items: {}, evidence: [], flags: [] },
  repeatSalaryCredits: 40,
});
const r17 = createRegistry(virtualBundle);
{
  eq('R-03a listGames 17 after injection', r17.listGames().length, 17);
  check('R-03b virtual game registered', !!r17.getGame('virtual-coffee'));
  eq('R-03c virtual game has 2 professions', r17.getGame('virtual-coffee').professions.slice().sort(), ['commerce.shopkeeper', 'service.barista']);
  eq('R-03d virtual commission enumerable', r17.listCommissions({ gameId: 'virtual-coffee' }).length, 1);
  eq('R-03e virtual profession query', r17.listCommissions({ professionId: 'service.barista' }).length, 1);
  /* 旧 16 款的枚举结果在注入前后不变 */
  const oldIds = SEASON_GAMES.slice();
  const before = oldIds.map((id) => r16.listCommissions({ gameId: id }).length);
  const after = oldIds.map((id) => r17.listCommissions({ gameId: id }).length);
  eq('R-03f old 16 commission lists unchanged', after, before);
  const oldGames = oldIds.map((id) => r16.getGame(id));
  const newOldGames = oldIds.map((id) => r17.getGame(id));
  eq('R-03g old 16 game records unchanged', newOldGames, oldGames);
  check('R-03h no errors after injection', r17.errors.length === 0, JSON.stringify(r17.errors));
}

/* ---------- R-04 多对多：同游戏双职业 / 同职业跨两游戏 ---------- */
const mmBundle = clone(bundle);
mmBundle.professions.push({
  professionId: 'shared.logistics',
  displayName: '共用物流',
  domain: 'engineering',
  capabilities: ['cap.logistics'],
});
const mmGame = mmBundle.games.filter((g) => g.gameId === 'memory-flip')[0];
mmGame.professions.push('shared.logistics');
mmBundle.commissions.push(syntheticCommission('memory-flip', { commissionId: 'memory-flip.shared-01', professionId: 'shared.logistics', tier: 2 }));
mmBundle.commissions.push(syntheticCommission('merge-2048', { commissionId: 'merge-2048.shared-01', professionId: 'shared.logistics', tier: 1 }));
const rmm = createRegistry(mmBundle);
{
  eq('R-04a same game two professions', rmm.getGame('memory-flip').professions.length, 2);
  eq('R-04b listCommissions game filter returns both', rmm.listCommissions({ gameId: 'memory-flip' }).length, 2);
  eq('R-04c listCommissions profession filter union', rmm.listCommissions({ professionId: 'shared.logistics' }).length, 2);
  eq('R-04d dual filter intersection', rmm.listCommissions({ gameId: 'memory-flip', professionId: 'shared.logistics' }).length, 1);
  eq('R-04e tier filter', rmm.listCommissions({ gameId: 'memory-flip', tier: 2 }).length, 1);
  check('R-04f shared profession belongs to game', rmm.getProfession('shared.logistics') !== null);
}

/* ---------- R-05 0 委托的游戏仍可发现线索 ---------- */
{
  const g = r17.getGame('virtual-coffee');
  check('R-05a discoverable virtual game', g.discoverable === true && g.clueRef === 'CL-virtual-coffee');
  const zeroBundle = baseBundle();
  const zero = createRegistry(zeroBundle);
  eq('R-05b zero-commission game enumerates empty', zero.listCommissions({ gameId: 'merge-2048' }).length, 0);
  check('R-05c zero-commission game still discoverable', zero.getGame('merge-2048').discoverable === true);
}

/* ---------- R-06 故事条件谓词语义 ---------- */
{
  const ctx = {
    capabilities: ['service.fulfilled_order'],
    evidence: ['tag-a'],
    flags: ['flag.c2'],
    items: { alloy: 2, building: 0 },
    credits: 100,
    cleared: ['fixture.commission'],
  };
  check('R-06a capability true', conditionMatches({ capability: 'service.fulfilled_order' }, ctx));
  check('R-06b evidence true', conditionMatches({ evidence: 'tag-a' }, ctx));
  check('R-06c chapterFlag true', conditionMatches({ chapterFlag: 'flag.c2' }, ctx));
  check('R-06d item atLeast true', conditionMatches({ item: 'alloy', atLeast: 2 }, ctx));
  check('R-06e credits atLeast true', conditionMatches({ credits: { atLeast: 100 } }, ctx));
  check('R-06f commissionCleared true', conditionMatches({ commissionCleared: 'fixture.commission' }, ctx));
  check('R-06g all empty true', conditionMatches({ all: [] }, ctx));
  check('R-06h any empty false', !conditionMatches({ any: [] }, ctx));
  check('R-06i all combination', conditionMatches({ all: [{ evidence: 'tag-a' }, { credits: { atLeast: 50 } }] }, ctx));
  check('R-06j any fallback', conditionMatches({ any: [{ capability: 'nope' }, { evidence: 'tag-a' }] }, ctx));
  check('R-06k missing fails', !conditionMatches({ capability: 'missing.cap' }, ctx));
  check('R-06l unknown condition fails', !conditionMatches({ bogusKey: true }, ctx));
  check('R-06m null condition fails', !conditionMatches(null, ctx));
  check('R-06n credits short fails', !conditionMatches({ credits: { atLeast: 101 } }, ctx));
  /* 虚拟第 17 款能力满足既有节点；没有它旧路线仍可达（替代条件）。 */
  const storyNode = {
    nodeId: 'node.research-fixture',
    chapter: 'chapter-2',
    requires: {
      all: [
        { chapterFlag: 'flag.c1' },
        {
          any: [
            { capability: 'service.fulfilled_order' },
            { commissionCleared: 'fixture.commission' },
          ],
        },
      ],
    },
    grants: { flags: ['flag.c2'], evidence: [], capabilities: [] },
  };
  const storyBundle = baseBundle();
  storyBundle.games.push({
    gameId: 'virtual-coffee',
    displayName: 'virtual-coffee',
    adapterVersion: 1,
    discoverable: true,
    clueRef: 'CL-virtual-coffee',
    professions: ['service.barista'],
    capabilities: ['service.fulfilled_order'],
    watch: [{ kind: 'order.fulfilled' }],
    commissions: [],
  });
  storyBundle.professions.push({ professionId: 'service.barista', displayName: '咖啡师', domain: 'service', capabilities: [] });
  storyBundle.story.nodes = [storyNode];
  const sr = createRegistry(storyBundle);
  const ctxWithVirtual = { flags: ['flag.c1'], capabilities: ['service.fulfilled_order'], cleared: [] };
  const ctxOldRoute = { flags: ['flag.c1'], capabilities: [], cleared: ['fixture.commission'] };
  const ctxNeither = { flags: ['flag.c1'], capabilities: [], cleared: [] };
  check('R-06o story node satisfied by virtual capability', sr.resolveStory(storyNode.requires, ctxWithVirtual));
  check('R-06p story node satisfied by old route', sr.resolveStory(storyNode.requires, ctxOldRoute));
  check('R-06q story node unsatisfied without either', !sr.resolveStory(storyNode.requires, ctxNeither));
  eq('R-06r satisfiedStoryNodes returns node', sr.satisfiedStoryNodes(ctxOldRoute).map((n) => n.nodeId), ['node.research-fixture']);
}

/* ---------- R-07 非法内容降级 ---------- */
{
  const bad = baseBundle();
  bad.games.push({ gameId: 'UPPER CASE', displayName: 'bad' });
  bad.games.push({ gameId: 'ok-extra', displayName: 'ok', adapterVersion: 1, discoverable: false, clueRef: null, professions: ['ghost.profession'], watch: [] });
  bad.games.push({ gameId: 'memory-flip', displayName: 'duplicate' });
  bad.commissions.push({ commissionId: 'bad.commission', gameId: 'missing-game', professionId: 'research.archivist', objective: { kind: 'x.y', atLeast: 1 } });
  const rb = createRegistry(bad);
  check('R-07a bad game id ignored with warning', rb.listGames().some((g) => g.displayName === 'bad') === false, JSON.stringify(rb.warnings));
  check('R-07b unknown profession reference warned and stripped', rb.getGame('ok-extra').professions.length === 0, JSON.stringify(rb.getGame('ok-extra')));
  check('R-07c duplicate gameId recorded as error', rb.errors.some((e) => e.indexOf('重复 gameId') === 0), JSON.stringify(rb.errors));
  check('R-07d commission with unknown game ignored', !rb.getCommission('bad.commission'));
  check('R-07e no throw on malformed bundle', !!rb);
}

/* ---------- R-08 不得把首季规模写死为上限 ---------- */
{
  const one = createRegistry({ schemaVersion: 1, games: [], professions: [], commissions: [] });
  eq('R-08a empty registry works', one.listGames().length, 0);
  const many = { schemaVersion: 1, games: [], professions: [], commissions: [] };
  for (let i = 0; i < 120; i += 1) {
    many.games.push({
      gameId: 'synthetic-' + i,
      displayName: 'S' + i,
      adapterVersion: 1,
      discoverable: false,
      clueRef: null,
      professions: [],
      watch: [],
    });
  }
  const rm = createRegistry(many);
  eq('R-08b 120 synthetic games register', rm.listGames().length, 120);
  eq('R-08c no hardcoded cap errors', rm.errors.length, 0);
}

/* ---------- R-09 真实内容结构校验 ---------- */
{
  const real = createRegistry(realContent);
  check('R-09a real registry.json has no errors', real.errors.length === 0, JSON.stringify(real.errors));
  eq('R-09b real registry has 16 season games', real.listGames().length, 16);
  check('R-09c every real game has gameId/watch', real.listGames().every((g) => g.gameId && Array.isArray(g.watch) && g.watch.length > 0));
  const ids = real.listGames().map((g) => g.gameId);
  const missing = SEASON_GAMES.filter((id) => ids.indexOf(id) < 0);
  check('R-09d season ids all present', missing.length === 0, missing.join(','));
  check('R-09e real content version present', typeof real.contentVersion === 'string' && real.contentVersion.length > 0);
  const games = real.listGames();
  const clueRefs = games.filter((g) => g.clueRef).map((g) => g.clueRef);
  eq('R-09f clueRef unique', new Set(clueRefs).size, clueRefs.length);
  check('R-09g clueRef naming CL-<gameId>', games.every((g) => !g.discoverable || g.clueRef === 'CL-' + g.gameId), JSON.stringify(games.filter((g) => g.discoverable && g.clueRef !== 'CL-' + g.gameId).map((g) => g.gameId)));
  check('R-09h every watch kind unique within game', games.every((g) => new Set(g.watch.map((w) => w.kind)).size === g.watch.length));
  const professions = real.listProfessions();
  const professionIds = new Set(professions.map((p) => p.professionId));
  check('R-09i game profession references all registered', games.every((g) => g.professions.every((p) => professionIds.has(p))));
}

/* ---------- R-10 objective.context 匹配 ---------- */
{
  const ctx = { theme: 'electromagnetic', level: 4, boss: 'mothership', extra: 'ignored' };
  check('R-10a equality match', matchContext({ theme: 'electromagnetic' }, ctx));
  check('R-10b missing payload field fails', !matchContext({ theme: 'electromagnetic', stage: 3 }, ctx));
  check('R-10c mismatched value fails', !matchContext({ theme: 'meteor' }, ctx));
  check('R-10d gte match', matchContext({ level: { gte: 3 } }, ctx));
  check('R-10e gte fail', !matchContext({ level: { gte: 5 } }, ctx));
  check('R-10f lte match', matchContext({ level: { lte: 4 } }, ctx));
  check('R-10g range match', matchContext({ level: { gte: 3, lte: 4 } }, ctx));
  check('R-10h range fail', !matchContext({ level: { gte: 1, lte: 3 } }, ctx));
  check('R-10i extra payload ignored', matchContext({ boss: 'mothership' }, ctx));
  check('R-10j empty context matches', matchContext({}, ctx));
  check('R-10k null context matches', matchContext(null, ctx));
  /* 运行时 context 校验：非法字段被丢弃并告警，合法区间保留 */
  const ctxBundle = baseBundle();
  ctxBundle.commissions.push(syntheticCommission('star-raid', {
    commissionId: 'star-raid.T3',
    objective: { kind: realKind('star-raid'), atLeast: 1, context: { theme: 'electromagnetic', level: { gte: 3 }, bad: { foo: 1 }, worse: null } },
  }));
  const rctx = createRegistry(ctxBundle);
  const c = rctx.getCommission('star-raid.T3');
  eq('R-10l valid context fields kept', c.objective.context, { theme: 'electromagnetic', level: { gte: 3 } });
  check('R-10m invalid context fields warned', rctx.warnings.some((w) => w.indexOf('objective.context') === 0), JSON.stringify(rctx.warnings));
  check('R-10n runtime match uses sanitized context', rctx.matchContext(c.objective.context, { theme: 'electromagnetic', level: 4, boss: 'x' }));
  check('R-10o runtime match rejects wrong theme', !rctx.matchContext(c.objective.context, { theme: 'meteor', level: 4 }));
}

/* ---------- R-11 只读返回值 ---------- */
{
  const r = createRegistry(bundle);
  const snapshot = JSON.stringify(r.listGames());
  const g = r.getGame('memory-flip');
  g.professions.push('hacked.profession');
  g.watch[0].kind = 'hacked.kind';
  const list = r.listCommissions({ gameId: 'memory-flip' });
  list[0].reward.credits = 999999;
  eq('R-11a getGame returns deep copy', JSON.stringify(r.listGames()), snapshot);
  eq('R-11b getCommission/listCommissions return deep copy', r.listCommissions({ gameId: 'memory-flip' })[0].reward.credits, 70);
  check('R-11c getProfession returns copy', (function () {
    const p = r.getProfession('research.archivist');
    p.capabilities.push('hacked');
    return r.getProfession('research.archivist').capabilities.indexOf('hacked') < 0;
  })());
}

/* ---------- R-12 重复 clueRef / 重复 ID ---------- */
{
  const dup = baseBundle();
  dup.games[1].clueRef = dup.games[0].clueRef;
  const rd = createRegistry(dup);
  check('R-12a duplicate clueRef warned', rd.warnings.some((w) => w.indexOf('重复 clueRef') === 0), JSON.stringify(rd.warnings));
  eq('R-12b first clueRef kept', rd.getGame(dup.games[0].gameId).clueRef, dup.games[0].clueRef);
  eq('R-12c duplicate clueRef cleared on later game', rd.getGame(dup.games[1].gameId).clueRef, null);
  const dupProf = baseBundle();
  dupProf.professions.push(clone(dupProf.professions[0]));
  const rp = createRegistry(dupProf);
  check('R-12d duplicate professionId recorded as error', rp.errors.some((e) => e.indexOf('重复 professionId') === 0), JSON.stringify(rp.errors));
  const dupCom = baseBundle();
  dupCom.commissions.push(syntheticCommission('memory-flip'));
  dupCom.commissions.push(syntheticCommission('memory-flip'));
  const rc = createRegistry(dupCom);
  check('R-12e duplicate commissionId recorded as error', rc.errors.some((e) => e.indexOf('重复 commissionId') === 0), JSON.stringify(rc.errors));
}

/* ---------- 汇总 ---------- */
let failed = 0;
for (const item of results) {
  if (item.ok) {
    console.log('PASS  ' + item.name);
  } else {
    failed += 1;
    console.log('FAIL  ' + item.name + (item.detail ? ' — ' + item.detail : ''));
  }
}
console.log('');
console.log(`${results.length - failed}/${results.length} checks passed`);
if (failed > 0) {
  console.error(`FAILED: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('PASS  career registry contract test');
