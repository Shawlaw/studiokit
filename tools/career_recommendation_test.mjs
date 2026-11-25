#!/usr/bin/env node
/**
 * Arcade Life 主线推荐纯 Node 门禁：
 * campaign.recommend 的冻结返回形状、C1–C4 真实路线优先级与全程推进、
 * “模拟 reward 后真实 storyFlags 含目标旗标或明确只是 step”的完成口径、
 * 路线锁定 / 已清单 / 缺接口 / 不产证据单 / 真实缺口替代候选。
 *
 * 运行时只加载真实 campaign-core / story-evidence 与真实内容；
 * 不启动 Chrome、不写仓库、不 mock 玩法或 reward。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CONTENT = path.join(ROOT, 'apps', 'arcade', 'career', 'content');
const campaignCore = require(path.join(ROOT, 'apps', 'arcade', 'career', 'campaign-core.js'));
const storyEvidence = require(path.join(ROOT, 'apps', 'arcade', 'career', 'story-evidence.js'));

let total = 0;
let passed = 0;
const failures = [];

const json = (name) => JSON.parse(fs.readFileSync(path.join(CONTENT, name), 'utf8'));
const campaign = json('campaign.json');
const chapters = [0, 1, 2, 3, 4, 5].map((index) => json(`chapter-0${index}.json`));
const commissions = json('commissions.json').commissions;
const commissionById = new Map(commissions.map((row) => [row.commissionId, row]));
const evidence = Array.from(new Set(commissions.flatMap((row) => row.reward.evidence || []))).sort();

function configure() {
  storyEvidence.configure({ commissions });
  const core = campaignCore.createCampaign({});
  const result = core.configure({
    campaign, chapters, npc: json('npc.json'), sideStories: json('side-stories.json'),
    commissions, evidence, storyEvidence,
  });
  if (!result.ok) throw new Error(`campaign configure failed: ${JSON.stringify(result.errors)}`);
  return core;
}

const core = configure();

function eq(actual, expected, message) {
  total += 1;
  if (Object.is(actual, expected)) {
    passed += 1;
    console.log(`PASS  ${message}`);
  } else {
    failures.push(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.log(`FAIL  ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function ok(value, message) {
  eq(Boolean(value), true, message);
}

function section(name) {
  console.log(`\n### ${name}`);
}

const ALL_AVAILABLE = [
  'pendulum-tower.T1', 'pendulum-tower.T2', 'memory-flip.T1', 'memory-flip.T2',
  'shadow-leap.T1', 'shadow-leap.T2', 'gomoku.T1', 'gomoku.T2',
  'star-raid.T1', 'star-raid.T2', 'merge-2048.T2',
];

function recommend({ flags = [], cleared = [], availableIds = ALL_AVAILABLE, evidenceTokens = [], claims = [], withEvidence = true } = {}) {
  const input = {
    flags: ['C0.port_seen', ...flags],
    cleared,
    availableIds,
    evidence: evidenceTokens,
    claims,
  };
  if (withEvidence) input.storyEvidence = storyEvidence;
  const result = core.recommend(input);
  if (result) {
    const forbidden = /C[0-5]\.|\b(?:active|locked)\b|\b(?:E|BP|MAP|DEC)-|真实路线|验算|旗标|章节完成/;
    ok(!forbidden.test(result.goal), '全部推荐：goal 无内部记号或系统口径');
    ok(!forbidden.test(result.reason), '全部推荐：reason 无内部记号或系统口径');
  }
  return { result, input };
}

function expectShape(result, message) {
  ok(result && typeof result === 'object', `${message}：返回对象`);
  eq(Object.keys(result || {}).sort().join(','), 'commissionId,goal,kind,reason', `${message}：冻结四键`);
  ok(commissionById.has(result.commissionId), `${message}：commissionId 是真实委托`);
  ok(typeof result.goal === 'string' && result.goal.length > 0 && !/[A-Za-z0-9][.-]T\d/.test(result.goal), `${message}：goal 为玩家语言`);
  ok(typeof result.reason === 'string' && result.reason.length > 0 && !/[A-Za-z0-9][.-]T\d/.test(result.reason), `${message}：reason 为玩家语言`);
  // 玩家可见文案不得泄漏内部记号或审核口径
  const forbidden = /C[0-5]\.|\b(?:active|locked)\b|\b(?:E|BP|MAP|DEC)-|真实路线|验算|旗标|章节完成/;
  ok(!forbidden.test(result.goal), `${message}：goal 无内部记号`);
  ok(!forbidden.test(result.reason), `${message}：reason 无内部记号或系统口径`);
  ok(['milestone', 'step'].includes(result.kind), `${message}：kind 合法`);
}

function rewardOf(id) {
  const reward = commissionById.get(id).reward;
  return { flags: reward.flags || [], evidence: reward.evidence || [] };
}

/** 把真实 reward 投影到 ctx 后，交给真实 story-evidence 派生旗标（不复制规则）。 */
function projectedStoryFlags(input, id) {
  const reward = rewardOf(id);
  const flags = new Set([...(input.flags || []), ...reward.flags]);
  const evidenceSet = new Set([...(input.evidence || []), ...reward.evidence]);
  const summary = storyEvidence.storyFlags({ flags: [...flags], evidence: [...evidenceSet] });
  return { flags, evidence: evidenceSet, story: summary };
}

/**
 * 严格完成性断言：
 * - kind='milestone'：模拟本单 reward 后，真实 storyFlags（C2–C4）或真实
 *   campaign.syncFlags 路线（C1）必须含目标旗标，否则失败；
 * - kind='step'：必须明确“本单不完成本章”（reward 不足以授予目标旗标），
 *   且本单必须真实产证/产旗标或是通向真实产证单的前置，不允许空口承诺。
 */
function assertCompletionContract(result, input, chapterFlag, message) {
  const reward = rewardOf(result.commissionId);
  const projected = projectedStoryFlags(input, result.commissionId);
  if (result.kind === 'milestone') {
    if (chapterFlag === 'C1.signal_fragment') {
      const route = campaign.chapters.find((c) => c.chapterId === 'C1').routes
        .find((r) => r.rewardFlags.includes(chapterFlag));
      const met = route && projected.flags.size > 0
        && (route.requires.anyFlags || []).some((f) => projected.flags.has(f));
      ok(met, `${message}：C1 milestone 经真实 syncFlags 路线验算可授旗`);
    } else {
      ok(projected.story.ok && projected.story.allFlags.includes(chapterFlag),
        `${message}：milestone 模拟 reward 后真实 storyFlags 含 ${chapterFlag}`);
    }
    return;
  }
  // step：本单模拟完成后不得授予本章旗标（C1 同步旗标不来自本单 reward 字段）。
  const storyGrants = projected.story.ok && projected.story.allFlags.includes(chapterFlag);
  const c1Grants = chapterFlag === 'C1.signal_fragment'
    && reward.flags.includes('C1.signal_fragment');
  ok(!storyGrants && !c1Grants, `${message}：step 明确本单不完成本章`);
  const contributes = reward.flags.length > 0 || reward.evidence.length > 0;
  const unlocksProducer = commissions.some((row) =>
    (row.reward.flags.length > 0 || row.reward.evidence.length > 0)
    && (row.unlock?.all || []).some((node) => node.commissionCleared === result.commissionId));
  ok(contributes || unlocksProducer, `${message}：step 有真实产证/产旗标或真实前置`);
}

section('A. 冻结接口与降级');
ok(typeof core.recommend === 'function', 'campaign-core 导出 recommend');
// 显式构造无 role 的旧内容：真实章节文件可能已带 role。
const legacyCore = campaignCore.createCampaign({});
legacyCore.configure({
  campaign,
  chapters: chapters.map((chapter) => {
    const copy = { ...chapter };
    delete copy.role;
    return copy;
  }),
  npc: json('npc.json'), sideStories: json('side-stories.json'), commissions, evidence, storyEvidence,
});
eq(legacyCore.state({ flags: ['C0.port_seen'] }).chapters[0].role, '', '显式无 role 的旧内容 C0 role 缺省空串，推荐核心仍可用');
eq(JSON.stringify(recommend({ availableIds: [] }).result), 'null', '空 availableIds 降级 null');
eq(JSON.stringify(recommend({ withEvidence: false }).result), 'null', '缺 storyEvidence 降级 null');
eq(JSON.stringify(core.recommend(null)), 'null', 'null 输入降级 null');
eq(JSON.stringify(recommend({ flags: ['C1.signal_fragment', 'C2.research_complete', 'C3.truth_found', 'C4.city_power_restored'] }).result), 'null', '终局已开放降级 null');
eq(JSON.stringify(recommend({ flags: ['C1.signal_fragment', 'C2.research_complete', 'C3.truth_found', 'C4.city_power_restored', 'C5.star_tower_resolved'] }).result), 'null', '后日常降级 null');
eq(JSON.stringify(recommend({ availableIds: ['ghost.T1'] }).result), 'null', '未知委托不推荐');

section('B. C1–C4 真实优先路线与完成口径');
const c1 = recommend({ flags: [], evidenceTokens: [] });
eq(c1.result.commissionId, 'pendulum-tower.T1', 'C1 首选层塔 T1 港口实习');
eq(c1.result.kind, 'milestone', 'C1 层塔 T1 真实 reward 已足以完成本章');
expectShape(c1.result, 'C1 推荐');
assertCompletionContract(c1.result, c1.input, 'C1.signal_fragment', 'C1');

const c1Cleared = recommend({ flags: [], cleared: ['pendulum-tower.T1'], evidenceTokens: [] });
eq(c1Cleared.result.commissionId, 'star-raid.T1', 'C1 主单已首次清掉时降级星海 T1 次选');
eq(c1Cleared.result.kind, 'milestone', 'C1 星海 T1 同为真实完成路线');

const c2 = recommend({ flags: ['C1.signal_fragment'], cleared: ['pendulum-tower.T1'], evidenceTokens: ['E-C1-site'] });
eq(c2.result.commissionId, 'memory-flip.T1', 'C2 首选记忆翻牌 T1 旧档案夹');
eq(c2.result.kind, 'step', 'C2 T1 不产证据，标 step');
expectShape(c2.result, 'C2 T1 推荐');
assertCompletionContract(c2.result, c2.input, 'C2.research_complete', 'C2 T1');

const c2Step = recommend({ flags: ['C1.signal_fragment'], cleared: ['pendulum-tower.T1', 'memory-flip.T1'], evidenceTokens: ['E-C1-site'] });
eq(c2Step.result.commissionId, 'memory-flip.T2', 'C2 下一步是记忆翻牌 T2 差一张的照片');
eq(c2Step.result.kind, 'milestone', 'C2 T2 真实产证后完成本章');
eq(rewardOf(c2Step.result.commissionId).evidence[0], 'E-memory-flip.T2', 'C2 T2 reward 真实产出 E');
assertCompletionContract(c2Step.result, c2Step.input, 'C2.research_complete', 'C2 T2');

const c3Flags = ['C1.signal_fragment', 'C2.research_complete'];
const c3Evidence = ['E-C1-site', 'E-memory-flip.T2'];
const c3Cleared = ['pendulum-tower.T1', 'memory-flip.T2'];
const c3 = recommend({ flags: c3Flags, cleared: c3Cleared, evidenceTokens: c3Evidence });
eq(c3.result.commissionId, 'shadow-leap.T1', 'C3 首选影跃 T1');
eq(c3.result.kind, 'step', 'C3 T1 不产证据，标 step');
expectShape(c3.result, 'C3 T1 推荐');
assertCompletionContract(c3.result, c3.input, 'C3.truth_found', 'C3 T1');

const c3Step = recommend({ flags: c3Flags, cleared: [...c3Cleared, 'shadow-leap.T1'], evidenceTokens: c3Evidence });
eq(c3Step.result.commissionId, 'shadow-leap.T2', 'C3 下一步是影跃 T2');
eq(c3Step.result.kind, 'milestone', 'C3 T2 真实产证后完成本章');
eq(rewardOf(c3Step.result.commissionId).evidence[0], 'E-shadow-leap.T2', 'C3 T2 reward 真实产出 E');
assertCompletionContract(c3Step.result, c3Step.input, 'C3.truth_found', 'C3 T2');

const c4Flags = ['C1.signal_fragment', 'C2.research_complete', 'C3.truth_found'];
const c4BaseEvidence = ['E-C1-site', 'E-memory-flip.T2', 'E-shadow-leap.T2'];
const c4BaseCleared = ['pendulum-tower.T1', 'memory-flip.T2', 'shadow-leap.T2'];
const c4 = recommend({ flags: c4Flags, cleared: c4BaseCleared, evidenceTokens: c4BaseEvidence });
eq(c4.result.commissionId, 'pendulum-tower.T2', 'C4 首选层塔 T2 码头脚手架');
eq(c4.result.kind, 'step', 'C4 层塔 T2 是中间步骤');
expectShape(c4.result, 'C4 层塔 T2 推荐');
assertCompletionContract(c4.result, c4.input, 'C4.city_power_restored', 'C4 层塔 T2');

const c4Gomoku = recommend({
  flags: c4Flags,
  cleared: [...c4BaseCleared, 'pendulum-tower.T2'],
  evidenceTokens: [...c4BaseEvidence, 'E-C1-site-2'],
});
eq(c4Gomoku.result.commissionId, 'gomoku.T1', 'C4 层塔 T2 后接五子棋 T1 布局练习');
eq(c4Gomoku.result.kind, 'step', 'C4 五子棋 T1 不产证据，标 step');
assertCompletionContract(c4Gomoku.result, c4Gomoku.input, 'C4.city_power_restored', 'C4 五子棋 T1');

const c4Final = recommend({
  flags: c4Flags,
  cleared: [...c4BaseCleared, 'pendulum-tower.T2', 'gomoku.T1'],
  evidenceTokens: [...c4BaseEvidence, 'E-C1-site-2'],
});
eq(c4Final.result.commissionId, 'gomoku.T2', 'C4 首选五子棋 T2 破解防线（2048.T2 不替代）');
eq(c4Final.result.kind, 'milestone', 'C4 五子棋 T2 真实产证后完成本章');
assertCompletionContract(c4Final.result, c4Final.input, 'C4.city_power_restored', 'C4 五子棋 T2');
eq(rewardOf('merge-2048.T2').evidence.length, 0, '2048.T2 不产 E，不能替代 E 路线');
eq(JSON.stringify(recommend({ availableIds: ['merge-2048.T2'], evidenceTokens: [] }).result), 'null', '只给不产证据的 2048.T2 不推荐');

// 复审 Blocker：即便 prefer 里有不产证前置单，也不能在可用单存在真实缺口补齐者时推荐伪进展 step。
const blockerCase = recommend({
  flags: ['C1.signal_fragment'],
  cleared: ['pendulum-tower.T1'],
  evidenceTokens: ['E-C1-site'],
  availableIds: ['shadow-leap.T1', 'shadow-leap.T2', 'blackjack.T3'],
});
ok(blockerCase.result.commissionId !== 'shadow-leap.T1', 'C2 不推荐做完仍不过章的影跃 T1 伪进展');
ok(['shadow-leap.T2', 'blackjack.T3'].includes(blockerCase.result.commissionId), 'C2 改推真实补齐当前缺口的单');
assertCompletionContract(blockerCase.result, blockerCase.input, 'C2.research_complete', 'C2 复审 blocker');

section('C. 路线锁定、已清单、缺接口与非主线');
eq(JSON.stringify(recommend({ cleared: ['snowbells.T2'], availableIds: ['snowbells.T3'] }).result), 'null', '路线锁定单不推荐');
eq(JSON.stringify(recommend({ cleared: ['pendulum-tower.T1'], availableIds: ['pendulum-tower.T1'] }).result), 'null', '已首次清掉的单不重复推荐');
eq(JSON.stringify(recommend({ flags: ['C1.signal_fragment'], cleared: ['pendulum-tower.T1'], availableIds: ['ghost.T1'] }).result), 'null', '非主线/未知委托不推荐');

const onlyAlternative = recommend({
  flags: c4Flags,
  cleared: [...c4BaseCleared, 'pendulum-tower.T2', 'snowbells.T2'],
  evidenceTokens: [...c4BaseEvidence, 'E-C1-site-2'],
  availableIds: ['snowbells.T3', 'snake-run.T3', 'blackjack.T3', 'mole-whack.T3', 'road-rush.T3'],
});
ok(['snowbells.T3', 'snake-run.T3', 'mole-whack.T3'].includes(onlyAlternative.result.commissionId), '只有替代候选时从真实缺口选出可补缺的非战斗单');
eq(onlyAlternative.result.kind, 'milestone', '替代候选同样经真实 storyFlags 验算里程碑');
assertCompletionContract(onlyAlternative.result, onlyAlternative.input, 'C4.city_power_restored', '替代候选');
eq(storyEvidence.missingFor('C4.city_power_restored', {
  flags: ['C0.port_seen', ...c4Flags],
  evidence: [...c4BaseEvidence, 'E-C1-site-2'],
}).missing[0].class, 'E', '替代候选来自 storyEvidence.missingFor 的真实缺口');

section('D. 输入兼容与静态边界');
const withClaim = recommend({ flags: ['C1.work_done'], claims: [], evidenceTokens: [] });
eq(withClaim.result.kind, 'milestone', 'claims/quests 缺失时仍按现有 flags 判定');
ok(!campaignCore.moduleSource().includes('fetch('), 'recommend 不引入网络');
ok(!campaignCore.moduleSource().includes('localStorage'), 'recommend 不引入本地存储');

console.log(`\n${passed}/${total} checks passed`);
if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
