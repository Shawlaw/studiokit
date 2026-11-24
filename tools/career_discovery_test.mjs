#!/usr/bin/env node
/**
 * 0.15 发现状态机测试（D15-01/D15-16，纯 Node，无 Chrome、无端口、无写文件）
 *
 * 覆盖：DOM 无关的 DORMANT→GLIMPSED→CURIOUS→LOCAL→RESIDENT→EXPLORER、每局≤1 条、
 * 真实事件阈值与 3 局保底、关闭提示不产生线索但保留计数/已发现内容、mow 不计有效局、
 * 内容 schema 校验、持久化快照修复、首源归一化。
 *
 * 运行：node tools/career_discovery_test.mjs
 * 退出码：0 全 PASS；1 有 FAIL；2 用法错误（无参数）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const D = require(path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'discovery.js'));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? '' : detail === undefined ? '' : String(detail) });
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'expected ' + e + ' got ' + a);
}

const CLUES = [
  { clueId: 'CL-game-a', gameId: 'game-a', family: 'industrial', trigger: { kind: 'pair.match', atLeast: 2 }, guarantee: { maxEligibleRuns: 3 }, title: 't1' },
  { clueId: 'CL-game-a-2', gameId: 'game-a', family: 'signal', trigger: { kind: 'boss.defeated', atLeast: 1 }, guarantee: { maxEligibleRuns: 3 }, title: 't2' },
  { clueId: 'CL-game-b', gameId: 'game-b', family: 'bio', trigger: { kind: 'fruit.eaten', atLeast: 2 }, guarantee: { maxEligibleRuns: 3 }, title: 't3' },
];

function run(state, summary, opts) {
  return D.reduce(state, { type: 'RUN_ENDED', run: summary }, { clueConfigs: (opts && opts.clues) || CLUES });
}
function classic(gameId, runId, events) {
  return { gameId, runId, mode: 'classic', outcome: 'won', events: events || {} };
}

/* ---------- H-01 初始状态 ---------- */
{
  const s = D.initialState('2026-01-01T00:00:00.000Z');
  eq('H-01a stage DORMANT', s.stage, 'DORMANT');
  check('H-01b hints enabled by default', s.hintsEnabled === true);
  eq('H-01c no clues', Object.keys(s.clues).length, 0);
  eq('H-01d schemaVersion', s.schemaVersion, 1);
}

/* ---------- H-02 事件阈值 ---------- */
{
  let s = D.initialState();
  let r = run(s, classic('game-a', 'r1', { 'pair.match': 1 }));
  check('H-02a below threshold no clue', r.clue === null, JSON.stringify(r.clue));
  eq('H-02b eligible run counted', r.state.runs['game-a'].eligibleRuns, 1);
  r = run(r.state, classic('game-a', 'r2', { 'pair.match': 2 }));
  check('H-02c threshold reached clue fired', r.clue && r.clue.clueId === 'CL-game-a', JSON.stringify(r.clue));
  eq('H-02d reason event', r.clue.reason, 'event');
  eq('H-02e stage GLIMPSED', r.state.stage, 'GLIMPSED');
  eq('H-02f firstSourceGame', r.state.firstSourceGame, 'game-a');
  eq('H-02g firstClueId', r.state.firstClueId, 'CL-game-a');
  check('H-02h discovery record sourceGame', r.state.clues['CL-game-a'].sourceGame === 'game-a');
  check('H-02i firstSeenRunId recorded', r.state.clues['CL-game-a'].firstSeenRunId === 'r2');
}

/* ---------- H-03 3 局保底 ---------- */
{
  let s = D.initialState();
  const low = { 'pair.match': 1 };
  let r = run(s, classic('game-a', 'g1', low));
  check('H-03a run1 no clue', r.clue === null);
  r = run(r.state, classic('game-a', 'g2', low));
  check('H-03b run2 no clue', r.clue === null);
  r = run(r.state, classic('game-a', 'g3', low));
  check('H-03c run3 guaranteed clue', r.clue && r.clue.clueId === 'CL-game-a', JSON.stringify(r.clue));
  eq('H-03d reason guarantee', r.clue.reason, 'guarantee');
}

/* ---------- H-04 关闭提示 ---------- */
{
  let s = D.initialState();
  s = D.reduce(s, { type: 'SET_HINTS', enabled: false }).state;
  let r = run(s, classic('game-a', 'x1', { 'pair.match': 9 }));
  check('H-04a hints off never emits clue', r.clue === null);
  eq('H-04b hints off still counts eligible runs', r.state.runs['game-a'].eligibleRuns, 1);
  s = D.reduce(r.state, { type: 'SET_HINTS', enabled: true }).state;
  r = run(s, classic('game-a', 'x2', { 'pair.match': 9 }));
  check('H-04c re-enable can discover again', r.clue && r.clue.clueId === 'CL-game-a');
  check('H-04d discovered record persisted through hints off', !!r.state.clues['CL-game-a']);
}

/* ---------- H-05 每局最多 1 条 + 内容顺序 ---------- */
{
  let s = D.initialState();
  const r = run(s, classic('game-a', 'multi', { 'pair.match': 5, 'boss.defeated': 2 }));
  check('H-05a only one clue per run', r.clue && r.clue.clueId === 'CL-game-a');
  eq('H-05b content order wins', r.clue.clueId, 'CL-game-a');
  eq('H-05c only one clue record', Object.keys(r.state.clues).length, 1);
  const r2 = run(r.state, classic('game-a', 'multi2', { 'pair.match': 5, 'boss.defeated': 2 }));
  check('H-05d second clue on later run', r2.clue && r2.clue.clueId === 'CL-game-a-2', JSON.stringify(r2.clue));
}

/* ---------- H-06 mow / 模式过滤 ---------- */
{
  const s = D.initialState();
  const mow = D.evaluateRun({ state: s, clueConfigs: CLUES, runSummary: { gameId: 'game-a', runId: 'm1', mode: 'mow', events: { 'pair.match': 99 } } });
  check('H-06a mow never eligible', mow === null);
  eq('H-06b mow not counted', D.reduce(s, { type: 'RUN_ENDED', run: { gameId: 'game-a', runId: 'm1', mode: 'mow', events: {} } }, { clueConfigs: CLUES }).state.runs['game-a'] === undefined, true);
  const zen = D.evaluateRun({ state: s, clueConfigs: CLUES, runSummary: { gameId: 'game-a', runId: 'z1', mode: 'zen', events: { 'pair.match': 2 } } });
  check('H-06c zen eligible for clue', !!zen);
  const challenge = D.evaluateRun({ state: s, clueConfigs: CLUES, runSummary: { gameId: 'game-a', runId: 'c1', mode: 'challenge', events: { 'pair.match': 2 } } });
  check('H-06d challenge eligible for clue', !!challenge);
  const invalid = D.evaluateRun({ state: s, clueConfigs: CLUES, runSummary: { gameId: 'game-a', runId: 'i1', mode: 'random', events: { 'pair.match': 2 } } });
  check('H-06e unknown mode rejected', invalid === null);
  const eligibleFalse = D.evaluateRun({ state: s, clueConfigs: CLUES, runSummary: { gameId: 'game-a', runId: 'e0', mode: 'classic', eligible: false, events: { 'pair.match': 5 } } });
  check('H-06f explicit eligible:false rejected', eligibleFalse === null);
}

/* ---------- H-07 状态机单调与动作 ---------- */
{
  let s = D.initialState();
  let r = run(s, classic('game-a', 'a1', { 'pair.match': 2 }));
  s = r.state;
  eq('H-07a GLIMPSED after run', s.stage, 'GLIMPSED');
  s = D.reduce(s, { type: 'CLUE_OPENED', clueId: 'CL-game-a', at: '2026-01-01T00:00:01Z' }).state;
  eq('H-07b CURIOUS after open', s.stage, 'CURIOUS');
  check('H-07c openedAt set', !!s.clues['CL-game-a'].openedAt);
  s = D.reduce(s, { type: 'LETTER_FOLLOWED', at: '2026-01-01T00:00:02Z' }).state;
  eq('H-07d LOCAL after follow', s.stage, 'LOCAL');
  s = D.reduce(s, { type: 'CONTRACT_SIGNED', at: '2026-01-01T00:00:03Z' }).state;
  eq('H-07e RESIDENT after signing', s.stage, 'RESIDENT');
  s = D.reduce(s, { type: 'FIRST_RUN_COMPLETED', at: '2026-01-01T00:00:04Z' }).state;
  eq('H-07f EXPLORER after first run', s.stage, 'EXPLORER');
  /* 单调：再次 RUN_ENDED / CLUE_OPENED 不会回退 */
  const back = D.reduce(s, { type: 'CLUE_OPENED', clueId: 'CL-game-a' }).state;
  eq('H-07g stage never regresses', back.stage, 'EXPLORER');
  const unknown = D.reduce(s, { type: 'CLUE_OPENED', clueId: 'missing' });
  eq('H-07h unknown clue rejected safely', unknown.invalid, 'unknown-clue');
  const noop = D.reduce(s, { type: 'NOT_A_TYPE' });
  eq('H-07i unknown action rejected safely', noop.invalid, 'unknown-action');
}

/* ---------- H-08 纯函数不改变入参 ---------- */
{
  const s = D.initialState();
  const snapshot = JSON.stringify(s);
  const r = run(s, classic('game-a', 'pure', { 'pair.match': 2 }));
  eq('H-08a input state untouched', JSON.stringify(s), snapshot);
  check('H-08b result state is new object', r.state !== s);
  const s2 = JSON.parse(JSON.stringify(r.state));
  const snap2 = JSON.stringify(s2);
  D.evaluateRun({ state: s2, clueConfigs: CLUES, runSummary: classic('game-a', 'pure2', { 'pair.match': 2 }) });
  eq('H-08c evaluateRun does not mutate input', JSON.stringify(s2), snap2);
}

/* ---------- H-09 坏快照修复 ---------- */
{
  const broken = {
    stage: 'NOT_A_STAGE',
    hintsEnabled: 'no',
    clues: { 'CL-game-a': { sourceGame: 'game-a' }, bad: { sourceGame: 'x' } },
    runs: { 'game-a': { eligibleRuns: -5 }, 'BAD ID': { eligibleRuns: 2 } },
    updatedAt: 42,
  };
  const s = D.normalizeState(broken);
  eq('H-09a invalid stage falls back, evidence implies GLIMPSED', s.stage, 'GLIMPSED');
  const emptyBroken = D.normalizeState({ stage: 'NOT_A_STAGE' });
  eq('H-09a2 invalid stage without evidence falls back to DORMANT', emptyBroken.stage, 'DORMANT');
  check('H-09b hintsEnabled non-false is kept true', s.hintsEnabled === true);
  check('H-09c valid clue record kept', !!s.clues['CL-game-a']);
  check('H-09d clue without sourceGame dropped', !s.clues.bad);
  eq('H-09e negative runs clamped', s.runs['game-a'].eligibleRuns, 0);
  check('H-09f invalid gameId runs dropped', s.runs['BAD ID'] === undefined);
  check('H-09g invalid updatedAt replaced', typeof s.updatedAt === 'string');
  const evidenceOnly = D.normalizeState({ stage: 'DORMANT', clues: { 'CL-game-a': { sourceGame: 'game-a', seenAt: 'x' } } });
  eq('H-09h clues imply at least GLIMPSED', evidenceOnly.stage, 'GLIMPSED');
}

/* ---------- H-10 线索内容 schema ---------- */
{
  const bundle = D.normalizeClueBundle({ schemaVersion: 1, contentVersion: 'test', clues: CLUES.map((c) => Object.assign({ letter: { body: 'x'.repeat(50) } }, c)) });
  eq('H-10a valid bundle no errors', bundle.errors, []);
  eq('H-10b valid bundle count', bundle.clues.length, 3);
  const dup = D.normalizeClueBundle({ schemaVersion: 1, clues: [CLUES[0], CLUES[0]] });
  check('H-10c duplicate clueId rejected', dup.errors.some((e) => e.indexOf('重复 clueId') === 0), JSON.stringify(dup.errors));
  const bad = D.normalizeClueBundle({ schemaVersion: 1, clues: [{ clueId: 'X', gameId: 'UPPER', trigger: { kind: 'a.b', atLeast: 1 }, guarantee: { maxEligibleRuns: 3 } }] });
  check('H-10d bad gameId rejected', bad.errors.length > 0);
  const badGuarantee = D.normalizeClueBundle({ schemaVersion: 1, clues: [{ clueId: 'CL-z', gameId: 'game-z', trigger: { kind: 'a.b', atLeast: 1 }, guarantee: { maxEligibleRuns: 9 } }] });
  check('H-10e guarantee > 5 rejected', badGuarantee.errors.length > 0);
  const warnGuarantee = D.normalizeClueBundle({ schemaVersion: 1, clues: [{ clueId: 'CL-z', gameId: 'game-z', trigger: { kind: 'a.b', atLeast: 1 }, guarantee: { maxEligibleRuns: 4 } }] });
  check('H-10f guarantee 4 warned (not error)', warnGuarantee.errors.length === 0 && warnGuarantee.warnings.length > 0);
  const missing = D.normalizeClueBundle(null);
  check('H-10g null bundle fails closed', missing.errors.length > 0 && missing.clues.length === 0);
}

/* ---------- H-11 真实内容文件（存在时）---------- */
{
  const realPath = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'clues.json');
  if (!fs.existsSync(realPath)) {
    check('H-11 real clues.json not created yet (skip)', true);
  } else {
    const raw = JSON.parse(fs.readFileSync(realPath, 'utf8'));
    const bundle = D.normalizeClueBundle(raw);
    eq('H-11a real clues no errors', bundle.errors, []);
    eq('H-11b real clues count 16', bundle.clues.length, 16);
    const ids = bundle.clues.map((c) => c.clueId);
    eq('H-11c real clueIds unique', new Set(ids).size, ids.length);
    check('H-11d every real clue has non-empty letter body', bundle.clues.every((c) => c.letter && typeof c.letter.body === 'string' && c.letter.body.length >= 30));
    check('H-11e guarantees <= 3', bundle.clues.every((c) => c.guarantee.maxEligibleRuns <= 3));
    const regPath = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'registry.json');
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    const watchMap = {};
    reg.games.forEach((g) => { watchMap[g.gameId] = g.watch.map((w) => w.kind); });
    check('H-11f every clue kind is registered in registry watch', bundle.clues.every((c) => (watchMap[c.gameId] || []).indexOf(c.trigger.kind) >= 0));
    const missingGames = reg.games.filter((g) => ids.indexOf(g.clueRef) < 0);
    eq('H-11g every discoverable game has a clue', missingGames.map((g) => g.gameId), []);
    /* 16 源各自可达：单独一条线索即可进入 LOCAL（无跨游戏前置） */
    let state = D.initialState();
    for (const clue of bundle.clues) {
      const result = D.evaluateRun({ state, clueConfigs: bundle.clues, runSummary: { gameId: clue.gameId, runId: 'solo-' + clue.gameId, mode: 'classic', events: { [clue.trigger.kind]: clue.trigger.atLeast } } });
      check('H-11h single-source reachable: ' + clue.gameId, result && result.clueId === clue.clueId);
      state = result ? result.nextState : state;
    }
    eq('H-11i single-source runs reach GLIMPSED', state.stage, 'GLIMPSED');
    eq('H-11j all 16 clues discovered independently', Object.keys(state.clues).length, 16);
  }
}

/* ---------- 汇总 ---------- */
let failed = 0;
for (const item of results) {
  if (item.ok) console.log('PASS  ' + item.name);
  else {
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
console.log('PASS  career discovery state machine test');
