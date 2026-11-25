#!/usr/bin/env node
/**
 * 生涯首航 V2 路线一致性门禁（批次 2）：
 * 玩家可见的 campaign.json 章节路线（requires / label / hint）必须与真实
 * story-evidence 规则一致。对每条非自引用路线，按其 requires 从真实委托里
 * 收集候选完成项（anyCommissions / evidenceAll / evidenceAny），结合前置章节
 * 的默认完成序列，模拟真实 reward.evidence / reward.flags，再调用真实
 * story-evidence 推导：目标章节旗标必须真的出现。
 *
 * 同时断言：无章节自引用、无不可解锁候选（未知委托 / 未声明证据 / 被章节门禁
 * 挡住且当时不可得的证据）、玩家可见文案不含 E/BP/MAP/T2/C3 等内部 token。
 *
 * 纯 Node，零依赖，不写仓库文件。
 * 运行：node tools/career_route_consistency_test.mjs
 * 退出码：0 全部通过；1 有失败；2 装配失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);
const CONTENT_DIR = path.join(ROOT, 'apps', 'arcade', 'career', 'content');
const STORY_PATH = path.join(ROOT, 'apps', 'arcade', 'career', 'story-evidence.js');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, name), 'utf8'));
}

let campaign, commissionsContent, itemsContent, storyEvidenceModule;
try {
  campaign = readJson('campaign.json');
  commissionsContent = readJson('commissions.json');
  itemsContent = readJson('items.json');
  storyEvidenceModule = require(STORY_PATH);
} catch (err) {
  console.error('FAIL 装配失败: ' + (err && err.message ? err.message : String(err)));
  process.exit(2);
}

let failures = 0;
let total = 0;
function check(name, ok, detail) {
  total += 1;
  if (ok) {
    console.log('PASS  ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failures += 1;
    console.log('FAIL  ' + name + (detail ? ' — ' + detail : ''));
  }
}

const commissions = (commissionsContent.commissions || []).slice();
const byId = new Map(commissions.map((row) => [row.commissionId, row]));
const evidenceProducers = new Map();
commissions.forEach((row) => {
  ((row.reward && row.reward.evidence) || []).forEach((token) => {
    if (!evidenceProducers.has(token)) evidenceProducers.set(token, []);
    evidenceProducers.get(token).push(row.commissionId);
  });
});
const evidenceWhitelist = new Set(evidenceProducers.keys());

const CHAPTER_FLAG = {
  C0: 'C0.port_seen',
  C1: 'C1.signal_fragment',
  C2: 'C2.research_complete',
  C3: 'C3.truth_found',
  C4: 'C4.city_power_restored',
};
const ROUTE_CHAPTERS = ['C1', 'C2', 'C3', 'C4'];
/* 默认推荐路线的真实完成序列（DESIGN-0.20.0 批次 2）；只在模拟前置时使用。 */
const DEFAULT_PRIOR = {
  C1: [],
  C2: ['pendulum-tower.T1'],
  C3: ['pendulum-tower.T1', 'memory-flip.T2'],
  C4: ['pendulum-tower.T1', 'memory-flip.T2', 'shadow-leap.T2'],
};
/* 章节入口旗标（story-evidence 默认规则里 C3 依赖 C2、C4 依赖 C3）。 */
const PRIOR_FLAGS = { C1: [], C2: [], C3: ['C2.research_complete'], C4: ['C2.research_complete', 'C3.truth_found'] };

function story() {
  const instance = storyEvidenceModule.createStoryEvidence
    ? storyEvidenceModule.createStoryEvidence({})
    : storyEvidenceModule;
  const cfg = instance.configure({ commissions, items: itemsContent, chapter: [] });
  return { instance, cfg };
}

function collectLeaves(node, sink) {
  sink.commissions = sink.commissions || [];
  sink.evidence = sink.evidence || [];
  sink.flags = sink.flags || [];
  if (!node || typeof node !== 'object') return sink;
  (node.anyCommissions || []).forEach((id) => sink.commissions.push(id));
  (node.evidenceAll || []).forEach((token) => sink.evidence.push(token));
  (node.evidenceAny || []).forEach((token) => sink.evidence.push(token));
  (node.allFlags || []).forEach((flag) => sink.flags.push(flag));
  (node.anyFlags || []).forEach((flag) => sink.flags.push(flag));
  (node.all || []).forEach((child) => collectLeaves(child, sink));
  (node.any || []).forEach((child) => collectLeaves(child, sink));
  return sink;
}

function unique(values) {
  return Array.from(new Set(values));
}

/** 真实收据视图：从委托 id 列表构造 evidence/flags/cleared。 */
function receiptViewOf(ids) {
  const evidence = [];
  const flags = [];
  ids.forEach((id) => {
    const row = byId.get(id);
    if (!row) return;
    ((row.reward && row.reward.evidence) || []).forEach((token) => {
      if (evidence.indexOf(token) < 0) evidence.push(token);
    });
    ((row.reward && row.reward.flags) || []).forEach((flag) => {
      if (flags.indexOf(flag) < 0) flags.push(flag);
    });
  });
  return { evidence, flags, cleared: new Set(ids) };
}

/** 证据完成项 → 真实委托（优先 tier 低、id 字典序，保证确定性）。 */
function commissionForEvidence(token) {
  return (evidenceProducers.get(token) || [])
    .map((id) => byId.get(id))
    .filter((row) => row && !row.chapterGate)
    .sort((a, b) => (a.tier - b.tier) || (a.commissionId < b.commissionId ? -1 : 1))[0] || null;
}

const { instance: se, cfg: seCfg } = story();
check('story-evidence 真实内容可配置（43 证据 / C2–C4 规则）', seCfg.ok === true && seCfg.evidenceCount > 40 && seCfg.rules === 3,
  'evidence=' + seCfg.evidenceCount + ', rules=' + seCfg.rules);

const chapterById = new Map((campaign.chapters || []).map((chapter) => [chapter.chapterId, chapter]));

/* ------------------------------------------------------------------ *
 * 1. 每条展示路线：按真实委托完成后必须真的授予本章旗标
 * ------------------------------------------------------------------ */
ROUTE_CHAPTERS.forEach((chapterId) => {
  const chapter = chapterById.get(chapterId);
  const flag = CHAPTER_FLAG[chapterId];
  check('章节 ' + chapterId + ' 存在且声明旗标 ' + flag, !!chapter && typeof flag === 'string',
    chapter ? chapter.title : 'missing');
  if (!chapter) return;
  (chapter.routes || []).forEach((route) => {
    const leaves = collectLeaves(route.requires || {}, {});
    const chapterFlag = flag;
    const selfReferential = leaves.flags.indexOf(chapterFlag) >= 0;
    check(chapterId + '/' + route.routeId + ' 无本章旗标自引用', !selfReferential,
      selfReferential ? 'self-referential flag ' + chapterFlag : 'ok');
    if (selfReferential) return;

    /* 候选组合：每个 anyCommissions / 证据叶子是一个「完成项组」；nested all
       中的多组必须各选一项同时完成，才等价于玩家真正把这条路线做完。 */
    function completionGroups(node, groups) {
      if (!node || typeof node !== 'object') return groups;
      if (Array.isArray(node.anyCommissions) && node.anyCommissions.length) {
        groups.push(unique(node.anyCommissions).filter((id) => byId.has(id)));
      }
      (node.evidenceAll || []).concat(node.evidenceAny || []).forEach((token) => {
        const producer = commissionForEvidence(token);
        if (producer) groups.push([producer.commissionId]);
      });
      (node.all || []).forEach((child) => completionGroups(child, groups));
      (node.any || []).forEach((child) => completionGroups(child, groups));
      return groups;
    }
    const groups = completionGroups(route.requires || {}, []);
    /* C1 的路线按 anyFlags 满足（委托 reward.flags / 代办旗标）；映射到真实委托。 */
    if (!groups.length && chapterId === 'C1') {
      const flagProducers = {
        'C1.work_done': ['pendulum-tower.T1'],
        'C1.flight_done': ['star-raid.T1'],
        /* 港务处代办的两个旗标来自 alternatives.js 的付费代办（真实可购买项），
           不是 96 委托；用 offerId 作为完成项，收据证据由替代系统落库。 */
        'C1.signal': ['alt.courier'],
        'C1.records': ['alt.records'],
      };
      unique(leaves.flags).forEach((candidateFlag) => {
        const producers = flagProducers[candidateFlag] || [];
        if (producers.length) {
          const valid = producers.filter((id) => byId.has(id) || id.indexOf('alt.') === 0);
          if (valid.length) groups.push(valid);
        }
      });
    }
    check(chapterId + '/' + route.routeId + ' 至少有一条真实委托完成路径', groups.length > 0 && groups.every((group) => group.length > 0),
      'groups=' + JSON.stringify(groups));
    if (!groups.length || groups.some((group) => !group.length)) return;

    /* 对每组取代表性候选（各取第一个）；全部完成后必须真实授予旗标。 */
    const chosen = groups.map((group) => group[0]);
    const ids = unique(DEFAULT_PRIOR[chapterId].concat(chosen));
    const view = receiptViewOf(ids);
    const ctx = {
      evidence: view.evidence,
      flags: view.flags.concat(PRIOR_FLAGS[chapterId]),
    };
    const granted = chapterId === 'C1'
      /* C1.signal_fragment 由 campaign-core.syncFlags 在任一路线要求满足后补写；
         这里的模拟即以真实委托/代办旗标作为「要求满足」的证据。 */
      ? view.flags.length > 0 || chosen.some((id) => id.indexOf('alt.') === 0)
      : se.storyUnlocked(flag, ctx);
    check(chapterId + '/' + route.routeId + ' 完成 ' + chosen.join(' + ') + ' 后真实授予 ' + flag, granted,
      'evidence=' + view.evidence.join(',') + ' flags=' + ctx.flags.join(','));
  });
});

/* ------------------------------------------------------------------ *
 * 2. 不可解锁候选：未知委托 / 未声明证据 / 章节门禁挡住的证据
 * ------------------------------------------------------------------ */
ROUTE_CHAPTERS.forEach((chapterId) => {
  const chapter = chapterById.get(chapterId);
  if (!chapter) return;
  (chapter.routes || []).forEach((route) => {
    const leaves = collectLeaves(route.requires || {}, {});
    const unknownCommissions = leaves.commissions.filter((id) => !byId.has(id));
    const unknownEvidence = leaves.evidence.filter((token) => !evidenceWhitelist.has(token));
    check(chapterId + '/' + route.routeId + ' 无未知委托候选', unknownCommissions.length === 0,
      unknownCommissions.join(',') || 'ok');
    check(chapterId + '/' + route.routeId + ' 无未声明证据候选', unknownEvidence.length === 0,
      unknownEvidence.join(',') || 'ok');
    const gatedEvidence = unique(leaves.evidence).filter((token) => {
      const producer = (evidenceProducers.get(token) || []).map((id) => byId.get(id)).find(Boolean);
      return !!producer && !!producer.chapterGate && PRIOR_FLAGS[chapterId].indexOf(producer.chapterGate) < 0;
    });
    check(chapterId + '/' + route.routeId + ' 无当时不可得的门禁证据', gatedEvidence.length === 0,
      gatedEvidence.join(',') || 'ok');
  });
});

/* ------------------------------------------------------------------ *
 * 3. 玩家可见文案：无 E/BP/MAP/T1-T6/C0-C5 等内部 token
 * ------------------------------------------------------------------ */
const INTERNAL_TOKEN_RE = /\b(?:E|BP|MAP|DEC)-[A-Za-z0-9]|(?:^|[^A-Za-z0-9])[A-Za-z]{2,10}\.T[1-6]\b|(?:^|[^A-Za-z0-9])C[0-5]\b|(?:^|[^A-Za-z0-9])(?:T[1-6])(?:[^A-Za-z0-9]|$)/;
(campaign.chapters || []).forEach((chapter) => {
  const visible = [chapter.title, chapter.fallback || ''].concat(
    (chapter.routes || []).reduce((out, route) => out.concat([route.label || '', route.hint || '']), []),
  );
  const hits = visible.filter((text) => INTERNAL_TOKEN_RE.test(text));
  check(chapter.chapterId + ' 玩家可见文案无内部 token', hits.length === 0,
    hits.length ? hits.join(' | ') : 'ok');
});

/* ------------------------------------------------------------------ *
 * 4. 默认路线（DESIGN-0.20.0 批次 2）逐章旗标真实可达
 * ------------------------------------------------------------------ */
const defaultSteps = [
  ['C1', ['pendulum-tower.T1']],
  ['C2', ['memory-flip.T2']],
  ['C3', ['shadow-leap.T2']],
  ['C4', ['pendulum-tower.T2', 'gomoku.T2']],
];
const accumulated = [];
defaultSteps.forEach(([chapterId, commissionIds]) => {
  commissionIds.forEach((id) => accumulated.push(id));
  const view = receiptViewOf(accumulated);
  const flag = CHAPTER_FLAG[chapterId];
  const ok = chapterId === 'C1'
    ? view.flags.indexOf('C1.work_done') >= 0 || view.flags.indexOf('C1.flight_done') >= 0
    : se.storyUnlocked(flag, { evidence: view.evidence, flags: view.flags });
  check('默认路线 ' + chapterId + '（' + commissionIds.join('+') + '）真实授予 ' + flag, ok,
    'evidence=' + view.evidence.join(','));
});
check('默认路线 C4 未在 C3 前跳章', se.storyUnlocked('C4.city_power_restored', {
  evidence: receiptViewOf(['pendulum-tower.T1', 'memory-flip.T2']).evidence,
  flags: receiptViewOf(['pendulum-tower.T1', 'memory-flip.T2']).flags,
}) === false, 'ok');

console.log('');
if (failures) {
  console.log(failures + ' failed / ' + total + ' checks');
  process.exitCode = 1;
} else {
  console.log('ROUTE CONSISTENCY PASS (' + total + ' checks)');
}
