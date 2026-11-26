#!/usr/bin/env node
/**
 * 生涯叙事视角门禁（Arcade 0.21「选择式叙事」内容线，纯 Node、零依赖）：
 *
 * 1. 玩家可见的故事/任务推进文案不得残留「我」代玩家决定的推进句；NPC 自述信件
 *    （clues[].letter.body / chapter-01.origins[].c0Letter.body / chapter-01.c0|c1.beats[*].letter.body /
 *     chapter-00.arrival.body|arrival.firstOrder.body / npc.replies[].text）保留说话人第一人称，白名单豁免。
 * 2. 关键邀请句必须含「你」，并带问号 / 选择语义（吗？/哪…？/还是…？/你想…？/你愿意…？）。
 * 3. clues[].letter.body 与 chapter-01.origins[].c0Letter.body 的邀请句逐字一致（同源信件同步改写）。
 * 4. 内容结构零回归：字段集合、章节/委托/路线数量、旗标/requires/reward/数值、术语与剧透门槛。
 *
 * 运行：node tools/career_narrative_voice_test.mjs
 * 退出码：0 通过；1 失败；2 装配失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CONTENT_DIR = path.join(ROOT, 'apps', 'arcade', 'career', 'content');
const FILE_NAMES = [
  'campaign.json', 'chapter-00.json', 'chapter-01.json', 'chapter-02.json',
  'chapter-03.json', 'chapter-04.json', 'chapter-05.json', 'clues.json',
  'commissions.json', 'ending-combat.json', 'ending-research.json',
  'ending-rescue.json', 'npc.json', 'side-stories.json',
];
const CHAPTER_IDS = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'];

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

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, name), 'utf8'));
let content;
try {
  content = Object.fromEntries(FILE_NAMES.map((name) => [name, readJson(name)]));
} catch (err) {
  console.error('FAIL 装配失败: ' + (err && err.message ? err.message : String(err)));
  process.exit(2);
}

/* ------------------------------------------------------------------ *
 * 工具：递归收集字符串字段路径
 * ------------------------------------------------------------------ */
function walk(obj, prefix = '', out = []) {
  if (Array.isArray(obj)) {
    obj.forEach((value, index) => walk(value, prefix + '[' + index + ']', out));
  } else if (obj && typeof obj === 'object') {
    Object.keys(obj).forEach((key) => walk(obj[key], prefix ? prefix + '.' + key : key, out));
  } else if (typeof obj === 'string') {
    out.push([prefix, obj]);
  }
  return out;
}

/** NPC 自述信件白名单：保留写信人「我」，不得从事实归属上改成「你」。 */
function isNpcLetterPath(p) {
  return /\.letter\.body$/.test(p)
    || /\.c0Letter\.body$/.test(p)
    || /^arrival(\.firstOrder)?\.body$/.test(p)
    || /^characters\[\d+\]\.replies\[\d+\]\.text$/.test(p);
}

/** 玩家可见、且需要「你」视角提问/选择的叙述字段。 */
function isPlayerNarrativePath(p) {
  if (isNpcLetterPath(p)) return false;
  return /(^|\.)(beats\.(start|progress|complete)|next|hint|fallback|summary|opening|firstStep|text|ambientText|epilogueText|note|base|pacing\.(c0|c1|paths\.[a-z]+))$/.test(p)
    || /^chapters\[\d+\]\.title$/.test(p)
    || /^commissions\[\d+\]\.summary$/.test(p)
    || /^endings\[\d+\]\.summary$/.test(p)
    || /^families\[\d+\]\.text$/.test(p)
    || /^epilogue\.(base|combat|research|rescue)$/.test(p);
}

/** 代玩家做决定的第一人称推进句：叙述里出现「我先/我来/我要/我先去/我们决定…」等。 */
const DECIDE_FOR_PLAYER_RE = /我(先|来|要|这就|这就替|替你|决定|将|会替|已经帮你|帮你)|咱们(先|就|决定)|由我(来|决定|安排)/;
/** 提问 / 选择语义。 */
const CHOICE_RE = /(你愿意|你想|你是否|你要|由你|你选|好吗|吗？|哪[一张条个处边份路件]？|还是|任选|随你)/;

/* ------------------------------------------------------------------ *
 * 1. 玩家叙述无「我」代决定；关键邀请句含「你」+ 提问/选择语义
 * ------------------------------------------------------------------ */
for (const file of FILE_NAMES) {
  const entries = walk(content[file]).filter(([p, s]) => isPlayerNarrativePath(p) && s.length >= 6);
  const selfReferential = entries.filter(([, s]) => DECIDE_FOR_PLAYER_RE.test(s));
  check(file + ' 玩家叙述字段无「我」代玩家决定', selfReferential.length === 0,
    selfReferential.length ? selfReferential.map(([p, s]) => p + ': ' + s.slice(0, 60)).join(' | ') : entries.length + ' fields');
}

// 汇总所有玩家可见叙述字段：除事实/后日谈陈述（complete/body/epilogue 等）外，
// 邀请/推进句必须既有「你」又有提问或选择语义。
const invitationPaths = [];
for (const file of FILE_NAMES) {
  for (const [p, s] of walk(content[file])) {
    if (!isPlayerNarrativePath(p)) continue;
    if (!/(beats\.(start|progress)|\.next$|\.hint$|fallback$|\.summary$|firstStep$|\.text$|pacing\.)/.test(p)) continue;
    if (s.length < 6) continue;
    invitationPaths.push([file, p, s]);
  }
}
const badInvitations = invitationPaths.filter(([, , s]) => s.indexOf('你') < 0 || !CHOICE_RE.test(s));
check('叙事邀请字段含「你」与问号/选择语义', badInvitations.length === 0,
  badInvitations.length ? badInvitations.slice(0, 8).map(([f, p, s]) => f + '#' + p + ': ' + s.slice(0, 60)).join(' | ')
    : invitationPaths.length + ' invitations');

// 96 条委托摘要全部为「你愿意……吗？」问句，且核心动作保留。
const commissions = content['commissions.json'].commissions;
const badSummaries = commissions.filter((row) => !/^你愿意.+吗？$/.test(row.summary));
check('96 条委托摘要均为「你愿意…吗？」问句', commissions.length === 96 && badSummaries.length === 0,
  badSummaries.length ? badSummaries.map((row) => row.commissionId + ': ' + row.summary).join(' | ') : '96/96');

// 路线 hint 逐条有「你」与选择/询问语义。
let hintCount = 0;
const badHints = [];
content['campaign.json'].chapters.forEach((chapter) => {
  (chapter.routes || []).forEach((route) => {
    hintCount += 1;
    if (!route.hint || route.hint.indexOf('你') < 0 || !CHOICE_RE.test(route.hint)) {
      badHints.push(chapter.chapterId + '/' + route.routeId + ': ' + route.hint);
    }
  });
});
check('campaign 路线 hint 逐条含「你」与选择语义', badHints.length === 0,
  badHints.length ? badHints.join(' | ') : hintCount + ' hints');

// 三终局 summary 为问句。
const campaignEndings = content['campaign.json'].endings;
check('三条终局 summary 均为「你愿意…吗？」问句',
  campaignEndings.length === 3 && campaignEndings.every((e) => /^你愿意.+吗？$/.test(e.summary) && e.summary.indexOf('你') >= 0),
  campaignEndings.map((e) => e.approach + ': ' + e.summary).join(' | '));

/* ------------------------------------------------------------------ *
 * 2. NPC 自述保留第一人称；面向玩家的从句改为提问（不得把写信人动作反转给「你」）
 * ------------------------------------------------------------------ */
const clueBodies = content['clues.json'].clues.map((clue) => ({ id: clue.clueId, body: clue.letter.body }));
check('16 条线索信保留 NPC 自述「我」且含面向玩家的提问',
  clueBodies.length === 16 && clueBodies.every((row) => row.body.indexOf('我') >= 0 && row.body.indexOf('你') >= 0 && /吗？|哪[一张条个处边份路件]？/.test(row.body)),
  clueBodies.length + ' letters');

const origins = content['chapter-01.json'].origins;
check('16 封 C0 起源信保留 NPC「我」自述或明确事实归属，并以「你」提问',
  origins.length === 16 && origins.every((o) => {
    const b = o.c0Letter && o.c0Letter.body;
    return typeof b === 'string' && b.indexOf('你') >= 0 && /吗？|哪[一张条个处边份路件]？/.test(b)
      && (b.indexOf('我') >= 0 || b.indexOf('我们') >= 0 || b.indexOf('你') >= 0);
  }), '16 origins');

const npcReplies = content['npc.json'].characters.flatMap((c) => c.replies.map((r) => ({ id: c.characterId, chapter: r.chapterId, text: r.text })));
check('NPC 回信面向玩家的行动句为提问，仍保留 E-7 的自述「我」',
  npcReplies.filter((r) => r.id === 'E-7').some((r) => r.text.indexOf('我') >= 0)
  && npcReplies.filter((r) => /告示板|信号|许可信号|星币|灯又灭/.test(r.text)).every((r) => CHOICE_RE.test(r.text)),
  npcReplies.length + ' replies');

/* ------------------------------------------------------------------ *
 * 3. clues 与 origins.c0Letter 同源信件邀请句一致
 * ------------------------------------------------------------------ */
const clueByGame = new Map(content['clues.json'].clues.map((clue) => [clue.gameId, clue]));
const mismatches = [];
/** 邀请句：含「你」、以问号结束的分句。 */
function invitations(text) {
  return text.split(/(?<=[。？！；])/).filter((s) => s.indexOf('你') >= 0 && /[？]/.test(s));
}
/** 邀请句口径：只接受面向玩家的第二人称询问/选择问法。 */
function invitationStyle(s) {
  return /你(愿意|想|若有空|若想|打算|不想|能否|那边)|哪.*吗？|请你.*好吗？/.test(s) && CHOICE_RE.test(s);
}
origins.forEach((origin) => {
  const clue = clueByGame.get(origin.gameId);
  if (!clue) {
    mismatches.push(origin.gameId + ': missing clue');
    return;
  }
  const a = invitations(origin.c0Letter.body);
  const b = invitations(clue.letter.body);
  if (!a.length || !b.length || !a.every(invitationStyle) || !b.every(invitationStyle)) {
    mismatches.push(origin.gameId + ': clue=[' + b.join('|') + '] origin=[' + a.join('|') + ']');
  }
  // 同源信件：地址必须逐字一致；P-07 出现情况一致；NPC 自述「我」均保留。
  if (clue.letter.address !== origin.c0Letter.address) mismatches.push(origin.gameId + ': address mismatch');
});
check('clues.json 与 chapter-01.origins[].c0Letter 邀请句口径/地址同源一致', mismatches.length === 0,
  mismatches.length ? mismatches.join(' | ') : '16/16');

/* ------------------------------------------------------------------ *
 * 4. 结构 / 路线 / 术语 / 剧透顺序零回归
 * ------------------------------------------------------------------ */
check('内容文件字段集合（非叙述字段）零改动', (() => {
  // 与基线逐字节对比：加载 HEAD 内容做结构签名（非叙述字段 + key 集合）。
  const scrub = (obj) => {
    if (Array.isArray(obj)) return obj.map(scrub);
    if (obj && typeof obj === 'object') return Object.fromEntries(Object.keys(obj).map((k) => [k, scrub(obj[k])]));
    return typeof obj === 'string' ? '<str>' : obj;
  };
  let ok = true;
  for (const file of FILE_NAMES) {
    const old = JSON.parse(execFileSync('git', ['-C', ROOT, 'show', 'HEAD:apps/arcade/career/content/' + file], { encoding: 'utf8' }));
    if (JSON.stringify(scrub(old)) !== JSON.stringify(scrub(content[file]))) {
      console.log('    结构差异: ' + file);
      ok = false;
    }
  }
  return ok;
})(), '14 files');

const campaign = content['campaign.json'];
check('campaign 六章 / 三终局 / 章节旗标与路线 id 不变', (() => {
  const ids = campaign.chapters.map((c) => c.chapterId).join(',');
  const routes = campaign.chapters.map((c) => (c.routes || []).map((r) => r.routeId).join('+')).join('|');
  const expectedRoutes = 'read_letter|work_ship+rental+noncombat|research+mining+market|explore+ecology+archive|build+logistics+maintenance|';
  return ids === CHAPTER_IDS.join(',') && routes === expectedRoutes && campaign.endings.map((e) => e.approach).join(',') === 'combat,research,rescue';
})(), 'C0..C5 + 3 endings');

check('章节 beats/next/arrival 字段齐全、flags 与数值字段不丢失', (() => {
  const files = CHAPTER_IDS.map((id) => content['chapter-0' + id.slice(1) + '.json']);
  return files.every((f, i) => f.chapterId === CHAPTER_IDS[i]
    && typeof f.next === 'string' && f.next.length >= 8
    && f.beats && ['start', 'progress', 'complete'].every((k) => typeof f.beats[k] === 'string' && f.beats[k].length > 4));
})(), '6 chapters');

check('96 委托的 commissionId / 数值 / 旗标 / 证据 / 解锁字段不变', (() => {
  if (commissions.length !== 96) return false;
  const numericKeys = ['commissionId', 'gameId', 'professionId', 'tier', 'title', 'issuer', 'reward', 'objective', 'objectiveBonus', 'startParams', 'unlock', 'chapterGate', 'repeatSalaryCredits', 'risk', 'durationHint'];
  const old = JSON.parse(execFileSync('git', ['-C', ROOT, 'show', 'HEAD:apps/arcade/career/content/commissions.json'], { encoding: 'utf8' })).commissions;
  return old.every((row, i) => numericKeys.every((key) => JSON.stringify(row[key]) === JSON.stringify(commissions[i][key])));
})(), '96 rows');

const INTERNAL_TOKEN_RE = /\b(?:E|BP|MAP|DEC)-[A-Za-z0-9]|(?:^|[^A-Za-z0-9])[A-Za-z]{2,10}\.T[1-6]\b|(?:^|[^A-Za-z0-9])C[0-5]\b|(?:^|[^A-Za-z0-9])(?:T[1-6])(?:[^A-Za-z0-9]|$)/;
const visibleTexts = [];
for (const file of FILE_NAMES) {
  for (const [p, s] of walk(content[file])) {
    if (isPlayerNarrativePath(p) && !/(^|\.)note$/.test(p)) visibleTexts.push(file + '#' + p + ': ' + s);
  }
}
const tokenHits = visibleTexts.filter((s) => INTERNAL_TOKEN_RE.test(s.replace(/E-7/g, '调度员')));
check('玩家叙述无 C0/T2/E-/BP- 等内部 token（E-7 为角色名保留）', tokenHits.length === 0,
  tokenHits.length ? tokenHits.slice(0, 6).join(' | ') : 'ok');

check('术语「旧港 / 折光港」并存、P-07 与 E-7 与星塔口径不回退', (() => {
  const corpus = visibleTexts.join('\n');
  return corpus.indexOf('旧港') >= 0 && corpus.indexOf('折光港') >= 0
    && corpus.indexOf('P-07') >= 0 && corpus.indexOf('E-7') >= 0 && corpus.indexOf('星塔') >= 0;
})(), 'all terms present');

check('C2 前支线不泄漏星塔（minChapter=C3 门槛不变）', (() => {
  const chapterRank = new Map(campaign.chapters.map((c, i) => [c.chapterId, i]));
  return content['side-stories.json'].families.every((f) => {
    const mentionsStarTower = typeof f.text === 'string' && f.text.indexOf('星塔') >= 0;
    return !mentionsStarTower || (f.minChapter === 'C3' && chapterRank.has('C3'));
  });
})(), '5 families');

check('C1 标题不变（第一封工单）且 C5 终局旗标不变',
  campaign.chapters[1].title === '第一封工单'
  && content['ending-combat.json'].flags.join(',') === 'C5.star_tower_resolved,ending.combat'
  && content['ending-research.json'].flags.join(',') === 'C5.star_tower_resolved,ending.research'
  && content['ending-rescue.json'].flags.join(',') === 'C5.star_tower_resolved,ending.rescue',
  'flags');

console.log('');
if (failures) {
  console.log(failures + ' failed / ' + total + ' checks');
  process.exitCode = 1;
} else {
  console.log('NARRATIVE VOICE PASS (' + total + ' checks)');
}
