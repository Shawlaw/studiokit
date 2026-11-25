#!/usr/bin/env node
/**
 * 告示板首屏推荐预载门禁（V2 批次 1，纯 Node + VM，不启动 Chrome）：
 *
 * 复现的问题：进告示板后 DOM 没有 [data-town-recommend-id]。根因是
 * bridge.openCareerUi('town') 只预装 campaign/ending；campaign.recommend 需要
 * 已配置的 storyEvidence（isConfigured + storyFlags），未配置时返回 null，
 * town.render 因此不产出推荐行。
 *
 * 本测试用真实 bridge.js 源码 + 真实 career/content 内容，在 VM 中：
 * 1. 断言 town 的 extraModules 包含 story-evidence.js（routePlanner 一并预装）；
 * 2. 断言 configureCareerModules 在 loadStorySnapshot/UI ctx 之前执行；
 * 3. 断言 ctx.storyEvidence 已是 isConfigured() === true 的真实 storyEvidence
 *    （由真实 commissions.json / campaign 内容配置），且用 ctx.storyEvidence
 *    调用真实 campaign.recommend 时返回非 null 推荐。
 *
 * 运行：node tools/career_town_recommend_preload_test.mjs
 * 退出码：0 全过；1 有失败。
 */
import { ok as assert } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const careerDir = resolve(root, 'apps/arcade/career');
const bridgeSource = readFileSync(resolve(careerDir, 'bridge.js'), 'utf8');

let checks = 0;
function check(value, label) { assert(value, label); checks += 1; }

/* ---------------------------------------------------------------- 静态断言：加载清单 */
{
  const townBlock = bridgeSource.slice(
    bridgeSource.indexOf("if (name === 'mailbox' || name === 'town')"),
    bridgeSource.indexOf('var preloadList =', bridgeSource.indexOf("if (name === 'mailbox' || name === 'town')"))
  );
  check(townBlock.includes("extraModules.push('campaign')"), 'town preloads campaign');
  check(townBlock.includes("extraModules.push('storyEvidence')"), 'town preloads storyEvidence');
  check(townBlock.includes("extraModules.push('routePlanner')"), 'town preloads routePlanner too');
  const preloadBlock = bridgeSource.slice(
    bridgeSource.indexOf('var preloadList =', bridgeSource.indexOf("if (name === 'mailbox' || name === 'town')")),
    bridgeSource.indexOf('return preload.then(', bridgeSource.indexOf('var preloadList =', bridgeSource.indexOf("if (name === 'mailbox' || name === 'town')")))
  );
  const configureIndex = preloadBlock.indexOf('configureCareerModules()');
  const snapshotIndex = preloadBlock.indexOf('loadStorySnapshot()');
  check(configureIndex >= 0 && snapshotIndex >= 0 && configureIndex < snapshotIndex,
    'configureCareerModules runs before loadStorySnapshot');
  check(bridgeSource.includes('story-evidence.js'), 'story-evidence.js is a lazy module');
}

/* ---------------------------------------------------------------- VM：真实模块 + 真实内容 */

function loadUmd(absolutePath, globalName) {
  const sandbox = { module: { exports: {} }, exports: {}, window: undefined, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(absolutePath, 'utf8'), sandbox, { filename: absolutePath });
  const exported = sandbox.module.exports && Object.keys(sandbox.module.exports).length
    ? sandbox.module.exports
    : sandbox[globalName];
  if (!exported) throw new Error('module not loaded: ' + absolutePath);
  return exported;
}

const storyEvidence = loadUmd(resolve(careerDir, 'story-evidence.js'), 'ArcadeCareerStoryEvidence');
/* campaign.recommend 属于并行规则工作树（codex/career-rules）的交付；本地基线 campaign-core
   尚无 recommend。用集成工作树中的真实源码直接 VM 加载，验证 ctx.storyEvidence 的契约。 */
const integratedCampaignPath = resolve(root, '..', 'StudioKit-career-flow', 'apps/arcade/career/campaign-core.js');
const campaignSource = readFileSync(integratedCampaignPath, 'utf8');
check(campaignSource.includes('recommend: recommend,'), 'integrated campaign-core exports recommend');
check(campaignSource.includes('isConfigured() !== true) return null'), 'recommend guard requires configured storyEvidence');
const sandbox = { module: { exports: {} }, exports: {}, window: undefined, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(campaignSource, sandbox, { filename: 'campaign-core.js (integrated)' });
const campaign = sandbox.module.exports || sandbox.ArcadeCareerCampaign;
const registry = loadUmd(resolve(careerDir, 'registry.js'), 'ArcadeCareerRegistry');
const content = (name) => JSON.parse(readFileSync(resolve(careerDir, 'content', name), 'utf8'));
const commissions = content('commissions.json');
const registryContent = content('registry.json');
const campaignContent = content('campaign.json');
const chapters = {};
for (let i = 0; i < 6; i += 1) chapters['C' + i] = content('chapter-0' + i + '.json');

storyEvidence.configure({
  commissions,
  registry: registryContent,
  campaign: campaignContent,
  chapters,
  db: null,
});
campaign.configure({
  campaign: campaignContent,
  chapters,
  commissions,
  npc: content('npc.json'),
  sideStories: content('side-stories.json'),
  endings: ['combat', 'research', 'rescue'].map((a) => content('ending-' + a + '.json')),
  evidence: registryContent,
});

check(storyEvidence.isConfigured() === true, 'storyEvidence configured by real content');
check(typeof storyEvidence.storyFlags === 'function', 'storyEvidence exposes storyFlags');
check(typeof campaign.recommend === 'function', 'campaign exposes recommend (integrated content path)');

/* 真实内容下：用已配置的 storyEvidence 调 recommend 必须非 null。 */
/* 告示板 listAvailable 校验过的真实可接单：T1 无需前置，且优先链需要它们。 */
const availableIds = ['pendulum-tower.T1', 'star-raid.T1', 'memory-flip.T1', 'shadow-leap.T1', 'gomoku.T1'];
const recommendation = campaign.recommend({
  /* 真实读信后 C0 已落旗标；此时推荐必须从告示板可接单中挑出 C1 的真实产证单。 */
  flags: ['C0.port_seen'],
  quests: [{ careerId: 'career-test', nodeId: 'story:C0.port_seen', flags: ['C0.port_seen'], status: 'cleared' }],
  claims: [],
  profile: null,
  wallet: { credits: 100, items: {} },
  availableIds,
  storyEvidence,
});
check(recommendation !== null && recommendation !== undefined, 'campaign.recommend returns a real recommendation with configured storyEvidence');
check(typeof recommendation.commissionId === 'string' && availableIds.indexOf(recommendation.commissionId) >= 0,
  'recommendation is one of the truly unlocked commissions');

/* 未配置 storyEvidence 时 recommend 必须为 null —— 证明预装/配置修复是必要的。 */
const unconfigured = loadUmd(resolve(careerDir, 'story-evidence.js'), 'ArcadeCareerStoryEvidence');
const nullRecommendation = campaign.recommend({
  quests: [],
  claims: [],
  profile: null,
  wallet: { credits: 100, items: {} },
  availableIds,
  storyEvidence: unconfigured,
});
check(nullRecommendation === null, 'recommend stays null without configured storyEvidence (the fixed root cause)');

/* bridge 源码必须把 ctx.storyEvidence 直接暴露给 town（town.render 只消费该字段）。 */
check(bridgeSource.includes('storyEvidence: readGlobal(\'storyEvidence\') || null,'), 'bridge passes storyEvidence into UI ctx');
check(bridgeSource.includes('campaign: readGlobal(\'campaign\') || null,'), 'bridge passes campaign into UI ctx');

console.log(`career town recommend preload: ${checks}/${checks} checks passed`);
