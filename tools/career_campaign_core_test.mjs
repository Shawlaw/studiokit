#!/usr/bin/env node
/**
 * Arcade Life 0.18 六章故事图 / 三终局可达核心门禁（D18-01）：
 * campaign-core 的真实内容装配、C0→C5 状态推进、路线图（每章替代路线、16 起源 × 3 终局）、
 * C2–C4 由 story-evidence 旗标驱动、C5/终局汇合、后日常三差异、syncFlags（只补 C0/C1、
 * 幂等、单事务、DB 失败结构化）、坏内容结构化报错、未来内容可插拔与确定性。
 *
 * 纯 Node：读仓库真实内容 apps/arcade/career/content/{campaign,chapter-00..05,npc,
 * side-stories,ending-*,commissions}.json，require 真实 campaign-core / story-evidence；
 * quests/claims 读写用内存假 db（语义对齐 career-db.readQuestState / putQuests）。
 *
 * 零 npm 依赖；不启动 Chrome；不写仓库文件。
 * 运行：node tools/career_campaign_core_test.mjs
 * 退出码：0 全部通过；1 有失败；2 装配失败（模块/内容读取失败）。
 *
 * 自检钩子（仅用于证明退出码，正常跑不带该变量）：
 *   D18_01_SELFTEST=check    在所有真实断言后追加一条故意失败的断言（演示 exit 1）
 *   D18_01_SELFTEST=assembly 装配阶段引用不存在的文件（演示 exit 2）
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);

const CONTENT_DIR = path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content');
const PATHS = {
  campaignCore: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'campaign-core.js'),
  storyEvidence: path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'story-evidence.js'),
  campaign: path.join(CONTENT_DIR, 'campaign.json'),
  npc: path.join(CONTENT_DIR, 'npc.json'),
  sideStories: path.join(CONTENT_DIR, 'side-stories.json'),
  commissions: path.join(CONTENT_DIR, 'commissions.json'),
  endings: {
    combat: path.join(CONTENT_DIR, 'ending-combat.json'),
    research: path.join(CONTENT_DIR, 'ending-research.json'),
    rescue: path.join(CONTENT_DIR, 'ending-rescue.json'),
  },
  chapter: (index) => path.join(CONTENT_DIR, 'chapter-0' + index + '.json'),
};

const NOW = '2026-11-23T09:40:00.000Z';
const CAREER_ID = 'career-d18-01';
const SELF_TEST = process.env.D18_01_SELFTEST || '';

const C0_FLAG = 'C0.port_seen';
const C1_FLAG = 'C1.signal_fragment';
const C2_FLAG = 'C2.research_complete';
const C3_FLAG = 'C3.truth_found';
const C4_FLAG = 'C4.city_power_restored';
const C5_FLAG = 'C5.star_tower_resolved';
const APPROACHES = ['combat', 'research', 'rescue'];
const SUPPORTED_WARNING_CODES = [
  'chapter-title-mismatch',
  'chapter-content-version',
  'route-self-reference',
  'route-label-missing',
  'route-flag-missing',
  'evidence-unverified',
  'side-story-link-duplicate',
  'npc-character-empty',
  'origins-unknown',
  'commissions-missing',
  'chapter-file-duplicate',
  'chapter-file-unknown',
];

let total = 0;
let passed = 0;
const failures = [];

/* ------------------------------------------------------------------ *
 * 断言与输出
 * ------------------------------------------------------------------ */

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function eq(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error((label ? label + ': ' : '') + 'expected ' + right + ' got ' + left);
}

function detail(value) {
  if (value === undefined) return '';
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch (err) {
    text = String(value);
  }
  return text && text.length > 240 ? text.slice(0, 240) + '…' : text;
}

async function check(name, fn) {
  total += 1;
  try {
    const info = await fn();
    passed += 1;
    console.log('PASS  ' + name + (info && typeof info === 'string' ? ' — ' + detail(info) : ''));
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    failures.push(name + ': ' + message);
    console.log('FAIL  ' + name + ' — ' + message);
  }
}

function section(title) {
  console.log('\n### ' + title);
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sortedUnique(values) {
  return Array.from(new Set(values.map((item) => String(item)))).sort();
}

function codesOf(list) {
  return (list || []).map((item) => item.code).filter((code) => typeof code === 'string');
}

function hasCode(list, code) {
  return codesOf(list).indexOf(code) >= 0;
}

function findCode(list, code) {
  return (list || []).find((item) => item.code === code) || null;
}

/* ------------------------------------------------------------------ *
 * 装配：真实模块与真实内容
 * ------------------------------------------------------------------ */

let MODULE;
let STORY_EVIDENCE;
let MODULE_SOURCE;
const CONTENT = {
  campaign: null,
  chapters: [],
  npc: null,
  sideStories: null,
  commissions: [],
  commissionIndex: new Map(),
  evidence: [],
  endings: {},
  gameIds: [],
};

function assembly() {
  if (SELF_TEST === 'assembly') {
    require(path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'no-such-module-for-exit-2.js'));
  }
  MODULE = require(PATHS.campaignCore);
  STORY_EVIDENCE = require(PATHS.storyEvidence);
  MODULE_SOURCE = fs.readFileSync(PATHS.campaignCore, 'utf8');
  CONTENT.campaign = loadJson(PATHS.campaign);
  CONTENT.chapters = [0, 1, 2, 3, 4, 5].map((index) => loadJson(PATHS.chapter(index)));
  CONTENT.npc = loadJson(PATHS.npc);
  CONTENT.sideStories = loadJson(PATHS.sideStories);
  CONTENT.commissions = loadJson(PATHS.commissions).commissions;
  APPROACHES.forEach((approach) => {
    CONTENT.endings[approach] = loadJson(PATHS.endings[approach]);
  });
  CONTENT.commissions.forEach((commission) => {
    CONTENT.commissionIndex.set(commission.commissionId, commission);
    ((commission.reward && commission.reward.evidence) || []).forEach((token) => CONTENT.evidence.push(token));
  });
  CONTENT.evidence = sortedUnique(CONTENT.evidence);
  CONTENT.gameIds = sortedUnique(CONTENT.commissions.map((commission) => commission.gameId));

  assert(MODULE && typeof MODULE.configure === 'function', 'campaign-core must export configure');
  assert(typeof MODULE.state === 'function', 'campaign-core must export state');
  assert(typeof MODULE.routeRequirementsMet === 'function', 'campaign-core must export routeRequirementsMet');
  assert(typeof MODULE.syncFlags === 'function', 'campaign-core must export syncFlags');
  assert(typeof MODULE.endingOptions === 'function', 'campaign-core must export endingOptions');
  assert(typeof MODULE.epilogueFor === 'function', 'campaign-core must export epilogueFor');
  assert(typeof MODULE.validate === 'function', 'campaign-core must export validate');
  assert(typeof MODULE.createCampaign === 'function', 'campaign-core must export createCampaign');
  assert(Array.isArray(CONTENT.campaign.chapters) && CONTENT.campaign.chapters.length === 6, 'campaign must have 6 chapters');
  assert(Array.isArray(CONTENT.campaign.endings) && CONTENT.campaign.endings.length === 3, 'campaign must have 3 endings');
  assert(CONTENT.commissions.length === 96, 'commissions must have 96 rows, got ' + CONTENT.commissions.length);
  assert(CONTENT.chapters.every((chapter) => chapter && typeof chapter.chapterId === 'string'), 'chapter files must be loaded');
}

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

function contentInput(mutate) {
  const input = {
    campaign: clone(CONTENT.campaign),
    chapters: CONTENT.chapters.map((chapter) => clone(chapter)),
    npc: clone(CONTENT.npc),
    sideStories: clone(CONTENT.sideStories),
    commissions: CONTENT.commissions.map((commission) => clone(commission)),
    evidence: CONTENT.evidence.slice(),
  };
  if (typeof mutate === 'function') mutate(input);
  return input;
}

function fresh(mutate) {
  const core = MODULE.createCampaign({});
  const input = contentInput(mutate);
  const cfg = core.configure(input);
  return { core, cfg, input };
}

function campaignChapter(input, chapterId) {
  return input.campaign.chapters.find((chapter) => chapter.chapterId === chapterId);
}

function storyQuests(flags) {
  return flags.map((flag) => ({
    careerId: CAREER_ID,
    nodeId: 'story:' + flag,
    kind: 'story-flag',
    status: 'cleared',
    flags: [flag],
  }));
}

function commissionQuests(rows) {
  return rows.map((entry) => ({
    careerId: CAREER_ID,
    nodeId: entry[0],
    kind: 'commission',
    status: 'cleared',
    flags: entry[1] || [],
    evidence: [],
  }));
}

function statusList(stateResult) {
  return stateResult.chapters.map((chapter) => chapter.chapterId + ':' + chapter.state);
}

function statusMap(stateResult) {
  const map = {};
  stateResult.chapters.forEach((chapter) => {
    map[chapter.chapterId] = chapter.state;
  });
  return map;
}

function chapterView(stateResult, chapterId) {
  const chapter = stateResult.chapters.find((item) => item.chapterId === chapterId);
  assert(chapter, 'missing chapter view: ' + chapterId);
  return chapter;
}

function routeView(stateResult, chapterId, routeId) {
  const chapter = chapterView(stateResult, chapterId);
  const route = chapter.routes.find((item) => item.routeId === routeId);
  assert(route, 'missing route view: ' + chapterId + '/' + routeId);
  return route;
}

function endingView(stateResult, approach) {
  const ending = stateResult.endings.find((item) => item.approach === approach);
  assert(ending, 'missing ending view: ' + approach);
  return ending;
}

function makeReceipt(commissionId) {
  const commission = CONTENT.commissionIndex.get(commissionId);
  assert(commission, 'unknown commission: ' + commissionId);
  const reward = commission.reward || {};
  return {
    receiptId: 'receipt-d1801-' + commissionId,
    runId: 'receipt-d1801-' + commissionId,
    careerId: CAREER_ID,
    commissionId: commissionId,
    credits: 0,
    items: {},
    evidence: (reward.evidence || []).slice(),
    flags: (reward.flags || []).slice(),
    txIds: [],
    claimedAt: NOW,
    rulesetVersion: 1,
    contentVersion: '0.18.0',
  };
}

function createFakeDb(options) {
  const opts = options || {};
  const rows = new Map();
  const calls = { read: 0, write: 0, batches: [] };
  const failures = Object.assign(
    { read: false, readThrow: false, write: false, writeThrow: false },
    opts.failures || {}
  );
  function key(row) {
    return row.careerId + '\u0000' + row.nodeId;
  }
  const db = {
    calls,
    failures,
    allQuests(careerId) {
      return Array.from(rows.values())
        .filter((row) => row.careerId === careerId)
        .map(clone);
    },
    nodeIds(careerId) {
      return db.allQuests(careerId).map((row) => row.nodeId).sort();
    },
    flagsOf(careerId) {
      const flags = [];
      db.allQuests(careerId).forEach((row) => {
        (row.flags || []).forEach((flag) => flags.push(flag));
        if (typeof row.nodeId === 'string' && row.nodeId.indexOf('story:') === 0) {
          flags.push(row.nodeId.slice('story:'.length));
        }
      });
      return sortedUnique(flags);
    },
    seed(row) {
      rows.set(key(row), clone(row));
      return db;
    },
    async readQuestState(careerId) {
      calls.read += 1;
      if (failures.readThrow) throw new Error('fake-read-failure');
      if (failures.read) return { ok: false, reason: 'read-failed' };
      return { ok: true, careerId: careerId, quests: db.allQuests(careerId) };
    },
    async putQuests(careerId, list) {
      calls.write += 1;
      calls.batches.push(clone(list));
      if (failures.writeThrow) throw new Error('fake-write-failure');
      if (failures.write) return { ok: false, reason: 'write-failed' };
      list.forEach((row) => {
        const stored = clone(row);
        stored.careerId = careerId;
        rows.set(key(stored), stored);
      });
      return { ok: true, count: list.length };
    },
  };
  return db;
}

/** 16 起源：去掉某一游戏后，用其余游戏的委托与旗标构造 routeRequirementsMet 上下文。 */
function originContext(origin) {
  const usable = CONTENT.commissions.filter((commission) => commission.gameId !== origin);
  const flags = new Set([C0_FLAG]);
  const cleared = new Set();
  usable.forEach((commission) => {
    cleared.add(commission.commissionId);
    ((commission.reward && commission.reward.flags) || []).forEach((flag) => flags.add(flag));
  });
  return { flags: flags, cleared: cleared, evidence: new Set() };
}

const CHAPTER_FLAG_SEQUENCE = [
  ['C1', C1_FLAG],
  ['C2', C2_FLAG],
  ['C3', C3_FLAG],
  ['C4', C4_FLAG],
];

/* ------------------------------------------------------------------ *
 * A. 真实内容 configure / validate
 * ------------------------------------------------------------------ */

async function groupA() {
  section('A. 真实内容 configure / validate');

  await check('A01 API 表面 + 浏览器全局镜像（UMD）', async () => {
    const sandbox = { window: {} };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(MODULE_SOURCE, sandbox, { filename: 'campaign-core.js' });
    const browser = sandbox.window.ArcadeCareerCampaign;
    assert(browser, 'ArcadeCareerCampaign global missing');
    assert(sandbox.window.ArcadeCareer && sandbox.window.ArcadeCareer.campaign === browser, 'ArcadeCareer.campaign mirror missing');
    const cfg = browser.configure(contentInput());
    eq(cfg.ok, true, 'browser configure ok');
    eq(cfg.chapterCount, 6, 'browser chapterCount');
    const forbiddenApi = Object.keys(MODULE).filter((key) => /(purchase|sell|grant|ledger|balance)/i.test(key));
    eq(forbiddenApi, [], 'no economy write entries');
    return 'global + mirror + ' + Object.keys(browser).length + ' keys';
  });

  await check('A02 静态边界：无 DOM/IDB/网络/本地存储/直连全局 db', async () => {
    const forbidden = [
      'docu' + 'ment.',
      'win' + 'dow.',
      'indexed' + 'DB.',
      'fet' + 'ch(',
      'XMLHttp' + 'Request',
      'local' + 'Storage',
      'session' + 'Storage',
      'Web' + 'Socket',
      'send' + 'Beacon',
      'naviga' + 'tor.',
      'require' + '(',
    ];
    const hits = forbidden.filter((token) => MODULE_SOURCE.indexOf(token) >= 0);
    eq(hits, [], 'forbidden source tokens');
    assert(MODULE.moduleSource().indexOf('campaignFactory') >= 0, 'moduleSource should expose factory source');
    const declared = MODULE.forbiddenSource();
    assert(declared.length >= 6, 'forbiddenSource list too short');
    assert(MODULE_SOURCE.length > 20000, 'module source unexpectedly small');
    return 'source ' + MODULE_SOURCE.length + ' bytes, ' + declared.length + ' forbidden markers';
  });

  await check('A03 configure 真实内容：六章/三终局、零错误、警告仅限已知容差', async () => {
    const { cfg } = fresh();
    eq(cfg.ok, true, 'ok');
    eq(cfg.chapterCount, 6, 'chapterCount');
    eq(cfg.endingCount, 3, 'endingCount');
    eq(cfg.errors, [], 'errors');
    eq(cfg.chapters.map((chapter) => chapter.chapterId), ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'], 'chapter ids');
    eq(cfg.endings.map((ending) => ending.approach).sort(), APPROACHES.slice().sort(), 'ending approaches');
    const unknownWarnings = codesOf(cfg.warnings).filter((code) => SUPPORTED_WARNING_CODES.indexOf(code) < 0);
    eq(unknownWarnings, [], 'unexpected warning codes');
    return 'warnings=' + JSON.stringify(codesOf(cfg.warnings));
  });

  await check('A03b 可选章节 role：注入后可读、旧内容缺省空串、不进 validate/signature', async () => {
    const ROLE = '你是刚到折光港、靠接零工维生的自由职业者。';
    const withoutRole = fresh();
    eq(withoutRole.cfg.ok, true, '旧内容（无 role）configure ok');
    const oldView = withoutRole.core.state({ flags: ['C0.port_seen'] });
    eq(oldView.chapters[0].chapterId, 'C0', 'C0 chapter first');
    eq(oldView.chapters[0].role, '', '旧内容无 role 缺省空串');

    const { core, cfg, input } = fresh((value) => {
      const chapter00 = value.chapters.find((chapter) => chapter.chapterId === 'C0');
      chapter00.role = ROLE;
    });
    eq(cfg.ok, true, '含 role 内容 configure ok');
    const view = core.state({ flags: ['C0.port_seen'] });
    eq(view.chapters[0].role, ROLE, 'campaign.state().chapters[0].role 可读');
    eq(view.chapters[1].role, '', '未注入 role 的章节仍为空串');
    const report = core.validate();
    eq(report.ok, true, 'role 不参与必需校验');
    const plain = fresh();
    eq(cfg.signature, plain.cfg.signature, 'role 不改变内容 signature');
    eq(input.chapters[0].role, ROLE, 'configure 不篡改输入 role');
    return 'role forwarded, legacy empty, signature stable';
  });

  await check('A04 validate 真实内容：可达性摘要、每章替代路线', async () => {
    const { core, cfg } = fresh();
    eq(cfg.ok, true, 'configure ok');
    const report = core.validate();
    eq(report.ok, true, 'validate ok');
    eq(report.errors, [], 'validate errors');
    eq(report.chapterCount, 6, 'chapterCount');
    eq(report.endingCount, 3, 'endingCount');
    eq(report.origins.slice().sort(), CONTENT.gameIds.slice().sort(), 'origins = 16 games');
    eq(report.origins.length, CONTENT.gameIds.length, 'origin count');
    assert(cfg.chapters[0].routeCount >= 1, 'C0 needs at least one route');
    ['C1', 'C2', 'C3', 'C4'].forEach((chapterId) => {
      assert(report.alternatives[chapterId] >= 2, chapterId + ' needs >=2 alternatives, got ' + report.alternatives[chapterId]);
    });
    eq(report.alternatives.C5, 3, 'C5 = three endings');
    return 'origins=' + report.origins.length + ' alternatives=' + JSON.stringify(report.alternatives);
  });

  await check('A05 确定性：重复 configure / validate / state / endingOptions 稳定', async () => {
    const first = fresh();
    const second = fresh();
    eq(first.cfg, second.cfg, 'configure output');
    eq(first.core.validate(), second.core.validate(), 'validate output');
    const flags = [C0_FLAG, C1_FLAG, C2_FLAG];
    eq(first.core.state({ flags }), second.core.state({ flags }), 'state output');
    eq(first.core.endingOptions({ flags: [C4_FLAG] }), second.core.endingOptions({ flags: [C4_FLAG] }), 'endingOptions output');
    const repeat = first.core.validate();
    eq(repeat, first.core.validate(), 'repeat validate stable');
    eq(first.cfg.signature, second.cfg.signature, 'signature stable');
    return 'signature ' + first.cfg.signature;
  });

  await check('A06 终局内容与 campaign 终局一致（旗标/游戏/零工钱/后日谈）', async () => {
    const campaignEndings = new Map(CONTENT.campaign.endings.map((ending) => [ending.approach, ending]));
    const texts = new Set();
    for (const approach of APPROACHES) {
      const ending = CONTENT.endings[approach];
      const campaignEnding = campaignEndings.get(approach);
      assert(campaignEnding, 'campaign ending missing: ' + approach);
      eq(ending.approach, approach, approach + ' approach');
      eq(ending.flags.slice().sort(), campaignEnding.flags.slice().sort(), approach + ' flags match campaign');
      assert(ending.flags.indexOf(C5_FLAG) >= 0, approach + ' must grant C5 flag');
      assert(ending.flags.indexOf('ending.' + approach) >= 0, approach + ' must grant ending flag');
      assert(CONTENT.gameIds.indexOf(ending.gameId) >= 0, approach + ' gameId must be one of 16 games');
      eq(ending.repeatSalaryCredits, 0, approach + ' repeat salary must be 0');
      assert(ending.objective && typeof ending.objective.kind === 'string' && ending.objective.kind.length > 0, approach + ' objective kind');
      assert(typeof ending.epilogueText === 'string' && ending.epilogueText.length > 0, approach + ' epilogueText');
      texts.add(ending.epilogueText);
    }
    eq(texts.size, 3, 'ending epilogue texts distinct');
    eq(CONTENT.campaign.endings.every((ending) => (ending.entry.allFlags || []).indexOf(C4_FLAG) >= 0), true, 'all endings gated by C4');
    return '3 endings consistent';
  });

  await check('A07 campaign 内容契约：入口/出口/必须事实/后日常三差异', async () => {
    eq(CONTENT.campaign.chapters.map((chapter) => chapter.chapterId), ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'], 'C0..C5 order');
    CONTENT.campaign.chapters.forEach((chapter, index) => {
      assert(chapter.entry && typeof chapter.entry === 'object', chapter.chapterId + ' entry');
      assert(Array.isArray(chapter.mustKnow) && chapter.mustKnow.length >= 1, chapter.chapterId + ' mustKnow');
      assert(Array.isArray(chapter.routes), chapter.chapterId + ' routes');
      if (index < 5) eq(chapter.handoff, 'C' + (index + 1), chapter.chapterId + ' handoff');
      else eq(chapter.handoff, 'EPILOGUE', 'C5 handoff');
    });
    const epilogue = CONTENT.campaign.epilogue;
    assert(typeof epilogue.base === 'string' && epilogue.base.length > 0, 'epilogue base');
    eq(new Set(APPROACHES.map((approach) => epilogue[approach])).size, 3, 'epilogue approaches distinct');
    return '6 chapters + epilogue';
  });
}

/* ------------------------------------------------------------------ *
 * B. C0→C5 状态推进
 * ------------------------------------------------------------------ */

async function groupB() {
  section('B. C0→C5 状态推进（合成 quests / claims / flags）');

  await check('B01 空白生涯：C0 active，其余 locked，currentChapter=C0', async () => {
    const { core } = fresh();
    const st = core.state({});
    eq(st.ok, true, 'state ok');
    eq(statusList(st), ['C0:active', 'C1:locked', 'C2:locked', 'C3:locked', 'C4:locked', 'C5:locked'], 'statuses');
    eq(st.currentChapter, 'C0', 'currentChapter');
    eq(st.endingChosen, null, 'endingChosen');
    eq(st.epilogue, null, 'epilogue');
    eq(st.endings.map((ending) => ending.available), [false, false, false], 'endings locked');
    const c0route = chapterView(st, 'C0').routes[0];
    eq(c0route.routeId, 'read_letter', 'C0 route id');
    eq(c0route.available, true, 'C0 route available');
    eq(chapterView(st, 'C1').routes.every((route) => route.available === false), true, 'C1 routes locked');
    return statusList(st).join(' ');
  });

  await check('B02 C0 旗标：C0 complete，C1 active', async () => {
    const { core } = fresh();
    const st = core.state({ quests: storyQuests([C0_FLAG]) });
    const map = statusMap(st);
    eq([map.C0, map.C1, map.C2], ['complete', 'active', 'locked'], 'C0/C1/C2');
    eq(st.currentChapter, 'C1', 'currentChapter');
    eq(chapterView(st, 'C0').routes[0].complete, true, 'C0 route complete');
    return 'C0 complete → C1 active';
  });

  await check('B03 C1 路线要求：仅 C1.flight_done 时 rental 可用，C1 仍 active', async () => {
    const { core } = fresh();
    const st = core.state({ quests: storyQuests([C0_FLAG]).concat(commissionQuests([['star-raid.T1', ['C1.flight_done']]])) });
    const map = statusMap(st);
    eq([map.C0, map.C1, map.C2], ['complete', 'active', 'locked'], 'statuses');
    const rental = routeView(st, 'C1', 'rental');
    eq(rental.met, true, 'rental met');
    eq(rental.available, true, 'rental available');
    eq(routeView(st, 'C1', 'work_ship').met, true, 'work_ship also met via flight_done');
    eq(routeView(st, 'C1', 'noncombat').met, false, 'noncombat not met');
    return 'rental + work_ship met';
  });

  await check('B04 C1.signal_fragment：C1 complete，C2 active 且三条路线都未满足', async () => {
    const { core } = fresh();
    const st = core.state({ quests: storyQuests([C0_FLAG, C1_FLAG]).concat(commissionQuests([['star-raid.T1', ['C1.flight_done']]])) });
    const map = statusMap(st);
    eq([map.C1, map.C2], ['complete', 'active'], 'C1/C2');
    eq(st.currentChapter, 'C2', 'currentChapter');
    eq(chapterView(st, 'C2').routes.map((route) => route.available), [false, false, false], 'C2 routes unavailable');
    return 'C2 active';
  });

  await check('B05 C2 由委托结算驱动：单份现场记录只满足路线、不授予旗标；两份跨游戏记录才推进', async () => {
    const { core } = fresh();
    /* 路线可满足 ≠ 章节旗标已授予：真实 C2 规则要求跨游戏的两份现场记录。 */
    const one = storyQuests([C0_FLAG, C1_FLAG]).concat(commissionQuests([['memory-flip.T2', []]]));
    const before = core.state({ quests: one });
    eq([routeView(before, 'C2', 'research').met, routeView(before, 'C2', 'research').available], [true, true], 'research route met by one E commission');
    eq(statusMap(before).C2, 'active', 'C2 flag not granted by one E token');
    eq(routeView(before, 'C2', 'mining').met, false, 'mining not met');
    /* 旗标由 story-evidence 真实推导（C05 有完整落库证明），这里只验证视图随旗标推进。 */
    const after = core.state({ quests: one.concat(storyQuests([C2_FLAG])) });
    eq(statusMap(after).C2, 'complete', 'C2 complete');
    eq(statusMap(after).C3, 'active', 'C3 active');
    return 'one E meets route but not flag; C2 complete after derived flag';
  });

  await check('B06 C3/C4 推进：真实产证据的委托驱动路线（不再把无证据 T2 当完章充分条件）', async () => {
    const { core } = fresh();
    /* 无证据的 solitaire.T2 / road-rush.T2 仍可清单，但不得让任何 C3/C4 路线显示为已满足。 */
    const staleQuests = storyQuests([C0_FLAG, C1_FLAG, C2_FLAG]).concat(commissionQuests([['solitaire.T2', []], ['road-rush.T2', []]]));
    const stale = core.state({ quests: staleQuests });
    eq(stale.chapters.find((item) => item.chapterId === 'C3').routes.map((route) => route.met), [false, false, false], 'no-evidence T2 routes not met');
    eq(statusMap(stale).C3, 'active', 'C3 active');
    /* 真实产记录/底稿的 T3 委托才让路线可用；旗标按真实 story-evidence 推导后再推进。 */
    const quests = storyQuests([C0_FLAG, C1_FLAG, C2_FLAG]).concat(commissionQuests([['solitaire.T3', []], ['block-drop.T3', []], ['merge-2048.T3', []]]));
    const st = core.state({ quests });
    eq(routeView(st, 'C3', 'archive').met, true, 'archive met by solitaire.T3');
    eq(routeView(st, 'C3', 'explore').met, false, 'explore not met by archive evidence');
    const st3 = core.state({ quests: quests.concat(storyQuests([C3_FLAG])) });
    eq(statusMap(st3).C3, 'complete', 'C3 complete');
    eq(statusMap(st3).C4, 'active', 'C4 active');
    eq(routeView(st3, 'C4', 'logistics').met, true, 'logistics met by block-drop.T3');
    return 'C3/C4 route requirements driven by real evidence-producing commissions';
  });

  await check('B07 C4 完成：C5 available（终局三选一开放），currentChapter=C5', async () => {
    const { core } = fresh();
    const flags = [C0_FLAG, C1_FLAG, C2_FLAG, C3_FLAG, C4_FLAG];
    const st = core.state({ flags });
    eq(statusMap(st).C4, 'complete', 'C4 complete');
    eq(statusMap(st).C5, 'available', 'C5 available');
    eq(st.currentChapter, 'C5', 'currentChapter');
    eq(st.endings.map((ending) => ending.available), [true, true, true], 'three endings available');
    eq(chapterView(st, 'C5').routes.map((route) => route.routeId), ['ending.combat', 'ending.research', 'ending.rescue'], 'C5 routes = endings');
    eq(chapterView(st, 'C5').routes.every((route) => route.available), true, 'C5 ending routes available');
    return 'C5 available with 3 endings';
  });

  await check('B08 claims 路径：收据 flags 与 commissionId 同时驱动 C2–C4', async () => {
    const { core } = fresh();
    const claims = [
      { runId: 'run-c2', receiptId: 'run-c2', careerId: CAREER_ID, commissionId: 'memory-flip.T2', flags: [C2_FLAG], evidence: ['E-memory-flip.T2'] },
      { runId: 'run-c3', receiptId: 'run-c3', careerId: CAREER_ID, commissionId: 'shadow-leap.T2', flags: [C3_FLAG] },
      { runId: 'run-c4', receiptId: 'run-c4', careerId: CAREER_ID, commissionId: 'pendulum-tower.T3', flags: [C4_FLAG] },
    ];
    const st = core.state({ claims, profile: { flags: [C0_FLAG, C1_FLAG], evidence: [] } });
    const map = statusMap(st);
    eq([map.C0, map.C1, map.C2, map.C3, map.C4, map.C5], ['complete', 'complete', 'complete', 'complete', 'complete', 'available'], 'claims-driven statuses');
    eq(st.cleared.indexOf('pendulum-tower.T3') >= 0, true, 'cleared commissions exposed');
    eq(st.evidenceCount, 1, 'evidence count');
    return 'claims drive C2–C4';
  });

  await check('B09 story-evidence 落库行驱动 C2–C4（story: 前缀与 flags 两种形态）', async () => {
    const { core } = fresh();
    const quests = storyQuests([C0_FLAG, C1_FLAG, C2_FLAG, C3_FLAG, C4_FLAG]);
    const st = core.state({ quests });
    eq(statusMap(st).C4, 'complete', 'C4 complete from story rows');
    const mixed = [
      { careerId: CAREER_ID, nodeId: 'story:C0.port_seen', kind: 'story-flag', status: 'cleared', flags: [C0_FLAG] },
      { careerId: CAREER_ID, nodeId: 'evidence:E-memory-flip.T2', kind: 'evidence', status: 'cleared', flags: [C1_FLAG, C2_FLAG, C3_FLAG], evidence: ['E-memory-flip.T2'] },
      { careerId: CAREER_ID, nodeId: 'story:C4.city_power_restored', kind: 'story-flag', status: 'cleared', flags: [] },
    ];
    const st2 = core.state({ quests: mixed });
    eq(statusMap(st2).C4, 'complete', 'C4 complete from nodeId-only row');
    return 'story:/flags rows both recognised';
  });

  await check('B10 每章视图带 mustKnow / handoff / npc 回信（六章齐全）', async () => {
    const { core } = fresh();
    const st = core.state({});
    eq(st.chapters.length, 6, 'chapter views');
    st.chapters.forEach((chapter) => {
      assert(Array.isArray(chapter.mustKnow) && chapter.mustKnow.length >= 1, chapter.chapterId + ' mustKnow');
      assert(typeof chapter.handoff === 'string' && chapter.handoff.length > 0, chapter.chapterId + ' handoff');
      assert(Array.isArray(chapter.replies) && chapter.replies.length >= 1, chapter.chapterId + ' replies');
    });
    eq(st.chapters[5].handoff, 'EPILOGUE', 'C5 handoff');
    return 'six chapters carry mustKnow/handoff/replies';
  });
}

/* ------------------------------------------------------------------ *
 * C. 路线图与可达性
 * ------------------------------------------------------------------ */

async function groupC() {
  section('C. 路线图：每章替代、16 起源 × 3 终局、C2–C4 证据驱动');

  await check('C01 每章 ≥2 条可玩替代路线（C0 序章 1 条、C5 三终局）', async () => {
    const { core } = fresh();
    const report = core.validate();
    eq(report.ok, true, 'validate ok');
    eq(report.alternatives.C0, 1, 'C0 single prologue route');
    ['C1', 'C2', 'C3', 'C4'].forEach((chapterId) => {
      assert(report.alternatives[chapterId] >= 2, chapterId + ' alternatives');
    });
    eq(report.alternatives.C5, 3, 'C5 three endings');
    const c2 = CONTENT.campaign.chapters.find((chapter) => chapter.chapterId === 'C2');
    assert(c2.routes.length >= 3, 'C2 keeps the self-referential confirmation route plus two playable routes');
    return JSON.stringify(report.alternatives);
  });

  await check('C02 16 起源 × 3 终局 = 48 条主线路径可达（routeRequirementsMet）', async () => {
    const { core } = fresh();
    const report = core.validate();
    eq(report.origins.length, CONTENT.gameIds.length, 'origin count matches 16 games');
    const blocked = [];
    let endingPaths = 0;
    report.origins.forEach((origin) => {
      const ctx = originContext(origin);
      CHAPTER_FLAG_SEQUENCE.forEach((entry) => {
        const chapter = CONTENT.campaign.chapters.find((item) => item.chapterId === entry[0]);
        const hit = chapter.routes.find((route) => core.routeRequirementsMet(route, ctx));
        if (!hit) {
          blocked.push(origin + ':' + entry[0]);
          return;
        }
        ctx.flags.add(entry[1]);
      });
      const endings = CONTENT.campaign.endings.filter((ending) => core.routeRequirementsMet(ending, ctx));
      if (endings.length !== 3) blocked.push(origin + ':endings=' + endings.length);
      else endingPaths += 3;
    });
    eq(blocked, [], 'no origin blocked');
    eq(endingPaths, report.origins.length * 3, 'ending paths count');
    return report.origins.length + ' origins × 3 = ' + endingPaths + ' ending paths';
  });

  await check('C03 路线要求语义：allFlags/anyFlags/anyCommissions/anyChaosFlags/evidenceAll/evidenceAny/nested', async () => {
    const met = {
      allFlags: [{ allFlags: [C4_FLAG, C0_FLAG] }, true],
      anyFlags: [{ anyFlags: ['C9.nope', C4_FLAG] }, true],
      anyCommissions: [{ anyCommissions: ['merge-2048.T2', 'nope.T9'] }, true],
      anyChaosFlags: [{ anyChaosFlags: [C1_FLAG] }, true],
      evidenceAll: [{ evidenceAll: ['E-memory-flip.T2'] }, true],
      evidenceAny: [{ evidenceAny: ['E-memory-flip.T2', 'E-x'] }, true],
      nestedAll: [{ all: [{ anyFlags: [C4_FLAG] }, { anyCommissions: ['merge-2048.T2'] }] }, true],
      nestedAny: [{ any: [{ allFlags: ['C9.nope'] }, { allFlags: [C4_FLAG] }] }, true],
      empty: [{}, true],
      emptyAllFlags: [{ allFlags: [] }, true],
      missingAll: [{ allFlags: [C4_FLAG, 'C9.nope'] }, false],
      missingAny: [{ anyFlags: ['C9.nope'] }, false],
      emptyAny: [{ anyFlags: [] }, false],
      wrongCommission: [{ anyCommissions: ['nope.T1'] }, false],
      wrongEvidence: [{ evidenceAny: ['MAP-nope'] }, false],
      nestedFail: [{ all: [{ anyFlags: [C4_FLAG] }, { anyFlags: ['C9.nope'] }] }, false],
    };
    const ctx = {
      flags: new Set([C0_FLAG, C1_FLAG, C4_FLAG]),
      cleared: new Set(['merge-2048.T2']),
      evidence: new Set(['E-memory-flip.T2']),
    };
    const wrong = [];
    Object.keys(met).forEach((key) => {
      const pair = met[key];
      const actual = MODULE.routeRequirementsMet(pair[0], ctx);
      if (actual !== pair[1]) wrong.push(key + '=' + actual);
    });
    eq(wrong, [], 'requirement semantics');
    eq(MODULE.routeRequirementsMet(null, ctx), false, 'null route false');
    eq(MODULE.routeRequirementsMet({ requires: { anyFlags: [C4_FLAG] } }, { quests: storyQuests([C4_FLAG]) }), true, 'ctx from quests rows');
    return Object.keys(met).length + ' semantic cases';
  });

  await check('C04 单游戏不得成为唯一前置：每章对每个起源都有不依赖该游戏的路线', async () => {
    const { core } = fresh();
    const report = core.validate();
    eq(hasCode(report.errors, 'single-game-lock'), false, 'validate has no single-game-lock');
    const blocked = [];
    let checked = 0;
    report.origins.forEach((origin) => {
      const ctx = originContext(origin);
      ['C1', 'C2', 'C3', 'C4'].forEach((chapterId) => {
        const chapter = CONTENT.campaign.chapters.find((item) => item.chapterId === chapterId);
        checked += 1;
        const hit = chapter.routes.filter((route) => core.routeRequirementsMet(route, ctx));
        if (!hit.length) blocked.push(origin + ':' + chapterId);
        const flags = chapter.routes[0] && chapter.routes[0].rewardFlags;
        assert(Array.isArray(flags), chapterId + ' routes carry flags');
      });
    });
    eq(blocked, [], 'blocked chapter/origin pairs');
    return checked + ' chapter×origin pairs have an independent route';
  });

  await check('C05 C2–C4 由 story-evidence 真实旗标驱动（memory-flip→shadow-leap→snowbells→snake-run→gomoku）', async () => {
    const se = STORY_EVIDENCE.createStoryEvidence({});
    const seCfg = se.configure({ commissions: CONTENT.commissions, now: NOW });
    eq(seCfg.ok, true, 'story-evidence configure ok');
    const db = createFakeDb();
    const c2 = await se.recordFromReceipt({ careerId: CAREER_ID, receipt: makeReceipt('memory-flip.T2'), db: db, now: NOW });
    eq(c2.ok, true, 'memory-flip receipt recorded');
    eq(db.flagsOf(CAREER_ID).indexOf(C2_FLAG) >= 0, false, 'C2 not yet derived with one E token');
    const c2b = await se.recordFromReceipt({ careerId: CAREER_ID, receipt: makeReceipt('shadow-leap.T2'), db: db, now: NOW });
    eq(c2b.ok, true, 'shadow-leap receipt recorded');
    assert(db.flagsOf(CAREER_ID).indexOf(C2_FLAG) >= 0, 'C2 flag derived from two distinct-game E tokens');
    const { core } = fresh();
    const afterC2 = core.state({ quests: db.allQuests(CAREER_ID) });
    eq(statusMap(afterC2).C2, 'complete', 'campaign sees C2 complete from story-evidence rows');
    eq(statusMap(afterC2).C3, 'available', 'C3 entry met (C2 flag) but earlier chapters incomplete');
    assert(statusMap(afterC2).C3 !== 'complete', 'C3 must not be complete yet');
    const c3 = await se.recordFromReceipt({ careerId: CAREER_ID, receipt: makeReceipt('snowbells.T3'), db: db, now: NOW });
    eq(c3.ok, true, 'snowbells receipt recorded');
    assert(db.flagsOf(CAREER_ID).indexOf(C3_FLAG) >= 0, 'C3 flag derived from three E tokens');
    const c4a = await se.recordFromReceipt({ careerId: CAREER_ID, receipt: makeReceipt('snake-run.T3'), db: db, now: NOW });
    eq(c4a.ok, true, 'snake-run receipt recorded');
    eq(db.flagsOf(CAREER_ID).indexOf(C4_FLAG) >= 0, false, 'C4 not yet derived with four E tokens');
    const c4b = await se.recordFromReceipt({ careerId: CAREER_ID, receipt: makeReceipt('gomoku.T2'), db: db, now: NOW });
    eq(c4b.ok, true, 'gomoku receipt recorded');
    assert(db.flagsOf(CAREER_ID).indexOf(C4_FLAG) >= 0, 'C4 flag derived from five E tokens');
    const afterC4 = core.state({ quests: db.allQuests(CAREER_ID) });
    eq(statusMap(afterC4).C4, 'complete', 'campaign sees C4 complete from story-evidence rows');
    eq(afterC4.evidenceCount, 5, 'five evidence tokens visible');
    return 'story-evidence → C2/C3/C4 flags → campaign state';
  });

  await check('C06 C5 终局门：锁定→可选→汇合；无终局内容时即使 C4 完成也保持 locked', async () => {
    const { core } = fresh();
    const beforeC4 = core.state({ flags: [C0_FLAG, C1_FLAG, C2_FLAG, C3_FLAG] });
    eq(statusMap(beforeC4).C5, 'locked', 'C5 locked before C4');
    eq(beforeC4.endings.map((ending) => ending.available), [false, false, false], 'endings locked before C4');
    const afterC4 = core.state({ flags: [C0_FLAG, C1_FLAG, C2_FLAG, C3_FLAG, C4_FLAG] });
    eq(statusMap(afterC4).C5, 'available', 'C5 available after C4');
    const resolved = core.state({ flags: [C0_FLAG, C1_FLAG, C2_FLAG, C3_FLAG, C4_FLAG, C5_FLAG, 'ending.combat'] });
    eq(statusMap(resolved).C5, 'complete', 'C5 complete after ending flags');
    eq(resolved.endingChosen, 'combat', 'endingChosen');
    eq(resolved.endings.map((ending) => ending.available), [false, false, false], 'endings closed after choice');
    const noEndings = fresh((input) => {
      input.campaign.endings = [];
    });
    eq(noEndings.cfg.ok, false, 'configure without endings fails');
    const noEndingState = noEndings.core.state({ flags: [C0_FLAG, C1_FLAG, C2_FLAG, C3_FLAG, C4_FLAG] });
    eq(statusMap(noEndingState).C5, 'locked', 'C5 locked without ending content');
    return 'locked → available → complete';
  });

  await check('C07 endingOptions / endingChosen 只读推导（含 ending-reducer 两种行形态）', async () => {
    const { core } = fresh();
    eq(core.endingOptions().map((ending) => ending.available), [false, false, false], 'no ctx → all locked');
    eq(core.endingOptions({ flags: [C4_FLAG] }).map((ending) => ending.available), [true, true, true], 'C4 → all available');
    const byRow = core.state({ quests: [{ careerId: CAREER_ID, nodeId: 'story:C5.star_tower_resolved', kind: 'story-flag', status: 'cleared', flags: [C5_FLAG] }, { careerId: CAREER_ID, nodeId: 'ending:research', kind: 'ending', status: 'cleared', approach: 'research' }] });
    eq(byRow.endingChosen, 'research', 'nodeId ending:research recognised');
    const byKind = core.state({ quests: [{ careerId: CAREER_ID, nodeId: 'ending.settle', kind: 'ending', status: 'cleared', approach: 'rescue' }] });
    eq(byKind.endingChosen, 'rescue', 'kind:ending approach recognised');
    const byReceipt = core.state({ claims: [{ runId: 'run-e', receiptId: 'run-e', careerId: CAREER_ID, approach: 'combat' }] });
    eq(byReceipt.endingChosen, 'combat', 'claim receipt approach recognised');
    const byDirectFlag = core.state({ quests: [{ careerId: CAREER_ID, nodeId: 'ending.rescue', kind: 'ending', status: 'cleared' }] });
    eq(byDirectFlag.endingChosen, 'rescue', 'nodeId that is itself a flag recognised');
    const c5Only = core.state({ quests: [{ careerId: CAREER_ID, nodeId: C5_FLAG, kind: 'story-flag', status: 'cleared' }] });
    eq(statusMap(c5Only).C5, 'complete', 'C5 nodeId-only row completes C5');
    return 'three ending row shapes recognised';
  });

  await check('C08 章节视图暴露路线要求/奖励旗标/任务 id（UI 只读契约）', async () => {
    const { core } = fresh();
    const st = core.state({ flags: [C0_FLAG, C1_FLAG] });
    const c2 = chapterView(st, 'C2');
    eq(c2.routes.map((route) => route.routeId), ['research', 'mining', 'market'], 'C2 route ids');
    c2.routes.forEach((route) => {
      assert(route.requires && typeof route.requires === 'object', route.routeId + ' requires');
      assert(Array.isArray(route.rewardFlags) && route.rewardFlags.indexOf(C2_FLAG) >= 0, route.routeId + ' reward flags');
      assert(typeof route.hint === 'string' && route.hint.length > 0, route.routeId + ' hint');
      assert(Array.isArray(route.missions), route.routeId + ' missions');
    });
    eq(c2.routes[0].missions, ['memory-flip.T2', 'merge-2048.T3'], 'research missions (real evidence-producing commissions)');
    eq(c2.routes[2].missions, ['blackjack.T3', 'solitaire.T3'], 'market missions (trade-window records)');
    eq(c2.routes[2].selfReferential, false, 'market route uses records, not self flag');
    return 'routes expose requires/rewardFlags/missions/hint';
  });
}

/* ------------------------------------------------------------------ *
 * D. 后日常与终局文本
 * ------------------------------------------------------------------ */

async function groupD() {
  section('D. 后日常（epilogue）三差异');

  await check('D01 epilogueFor：三条差异文本 + 未知 approach 结构化失败', async () => {
    const { core } = fresh();
    const base = CONTENT.campaign.epilogue.base;
    const texts = APPROACHES.map((approach) => {
      const epilogue = core.epilogueFor(approach);
      eq(epilogue.ok, true, approach + ' ok');
      eq(epilogue.approach, approach, approach + ' approach');
      eq(epilogue.base, base, approach + ' base');
      eq(epilogue.extra, CONTENT.campaign.epilogue[approach], approach + ' extra');
      eq(epilogue.text, base + CONTENT.campaign.epilogue[approach], approach + ' composed text');
      eq(epilogue[approach], CONTENT.campaign.epilogue[approach], approach + ' keeps campaign three-key shape');
      assert(epilogue.text.length > base.length, approach + ' text differs from base');
      return epilogue.text;
    });
    eq(new Set(texts).size, 3, 'three distinct epilogues');
    const unknown = core.epilogueFor('diplomacy');
    eq(unknown.ok, false, 'unknown approach ok=false');
    eq(unknown.reason, MODULE.REASONS.unknownApproach, 'unknown reason');
    eq(unknown.known, false, 'unknown known=false');
    eq(unknown.text, base, 'unknown falls back to base');
    return '3 distinct epilogues + unknown fallback';
  });

  await check('D02 state.epilogue 与 epilogueFor 一致（选择后才有）', async () => {
    const { core } = fresh();
    const flags = [C0_FLAG, C1_FLAG, C2_FLAG, C3_FLAG, C4_FLAG];
    eq(core.state({ flags }).epilogue, null, 'no epilogue before choice');
    APPROACHES.forEach((approach) => {
      const st = core.state({ flags: flags.concat([C5_FLAG, 'ending.' + approach]) });
      eq(st.endingChosen, approach, approach + ' chosen');
      eq(st.epilogue, core.epilogueFor(approach), approach + ' epilogue matches');
    });
    return 'epilogue only after ending choice';
  });

  await check('D03 后日常缺失/重复文本结构化报错（坏内容）', async () => {
    const missing = fresh((input) => {
      input.campaign.epilogue = { base: '', combat: '', research: '', rescue: '' };
    });
    eq(missing.cfg.ok, false, 'missing epilogue fails');
    assert(hasCode(missing.cfg.errors, 'epilogue-missing'), 'epilogue-missing reported');
    const duplicated = fresh((input) => {
      input.campaign.epilogue.research = input.campaign.epilogue.combat;
    });
    eq(duplicated.cfg.ok, false, 'duplicate epilogue fails');
    assert(hasCode(duplicated.cfg.errors, 'epilogue-not-distinct'), 'epilogue-not-distinct reported');
    return 'missing + duplicate epilogue detected';
  });
}

/* ------------------------------------------------------------------ *
 * E. syncFlags
 * ------------------------------------------------------------------ */

async function groupE() {
  section('E. syncFlags：只补 C0/C1、幂等、单事务、失败不谎报');

  await check('E01 信箱打开 → 只写 C0.port_seen 一行，单次 putQuests', async () => {
    const { core } = fresh();
    const db = createFakeDb();
    const result = await core.syncFlags({ careerId: CAREER_ID, db: db, mailboxOpened: true, now: NOW });
    eq(result.ok, true, 'ok');
    eq(result.changed, true, 'changed');
    eq(result.written, 1, 'written');
    eq(result.added, [C0_FLAG], 'added');
    eq(db.calls.read, 1, 'read count');
    eq(db.calls.write, 1, 'write count');
    eq(db.calls.batches.length, 1, 'single transaction');
    eq(db.nodeIds(CAREER_ID), ['story:' + C0_FLAG], 'row nodeId');
    const row = db.allQuests(CAREER_ID)[0];
    eq(row.kind, 'story-flag', 'row kind');
    eq(row.status, 'cleared', 'row status');
    eq(row.flags, [C0_FLAG], 'row flags');
    eq(row.source, 'campaign', 'row source');
    eq(row.clearedAt, NOW, 'row clearedAt');
    return 'C0 only';
  });

  await check('E02 C1 路线满足 → 同一事务写 C0+C1 两行', async () => {
    const { core } = fresh();
    const db = createFakeDb();
    db.seed({ careerId: CAREER_ID, nodeId: 'star-raid.T1', kind: 'commission', status: 'cleared', flags: ['C1.flight_done'], evidence: ['E-C1-patrol'] });
    const result = await core.syncFlags({ careerId: CAREER_ID, db: db, mailboxOpened: true, now: NOW });
    eq(result.ok, true, 'ok');
    eq(result.written, 2, 'written');
    eq(result.added, [C0_FLAG, C1_FLAG], 'added');
    eq(result.via, 'work_ship', 'matched C1 route');
    eq(db.calls.write, 1, 'one transaction');
    eq(db.calls.batches[0].length, 2, 'two rows in one batch');
    eq(db.nodeIds(CAREER_ID), ['star-raid.T1', 'story:' + C0_FLAG, 'story:' + C1_FLAG], 'nodeIds');
    const stateAfter = core.state({ quests: db.allQuests(CAREER_ID) });
    eq(statusMap(stateAfter).C1, 'complete', 'campaign sees C1 complete');
    eq(statusMap(stateAfter).C2, 'active', 'C2 active');
    return 'C0+C1 atomic';
  });

  await check('E03 幂等：第二次 no-op（changed=false，零写入）', async () => {
    const { core } = fresh();
    const db = createFakeDb();
    db.seed({ careerId: CAREER_ID, nodeId: 'star-raid.T1', kind: 'commission', status: 'cleared', flags: ['C1.flight_done'], evidence: [] });
    await core.syncFlags({ careerId: CAREER_ID, db: db, mailboxOpened: true, now: NOW });
    const rowsBefore = db.nodeIds(CAREER_ID);
    const callsBefore = db.calls.write;
    const second = await core.syncFlags({ careerId: CAREER_ID, db: db, mailboxOpened: true, now: NOW });
    eq(second.ok, true, 'ok');
    eq(second.changed, false, 'changed=false');
    eq(second.written, 0, 'written=0');
    eq(second.added, [], 'added empty');
    eq(db.calls.write, callsBefore, 'no extra write');
    eq(db.nodeIds(CAREER_ID), rowsBefore, 'rows unchanged');
    eq(core.state({ quests: db.allQuests(CAREER_ID) }).flags, [C0_FLAG, 'C1.flight_done', C1_FLAG], 'flags stable and sorted');
    return 'idempotent';
  });

  await check('E04 无信箱证据：不写 C0，C1 也因入口未满足而跳过', async () => {
    const { core } = fresh();
    const db = createFakeDb();
    db.seed({ careerId: CAREER_ID, nodeId: 'star-raid.T1', kind: 'commission', status: 'cleared', flags: ['C1.flight_done'], evidence: [] });
    const result = await core.syncFlags({ careerId: CAREER_ID, db: db, now: NOW });
    eq(result.ok, true, 'ok');
    eq(result.changed, false, 'nothing written');
    eq(db.calls.write, 0, 'no write');
    const skipped = new Map(result.skipped.map((item) => [item.flag, item.reason]));
    eq(skipped.get(C0_FLAG), 'no-mailbox-evidence', 'C0 skip reason');
    eq(skipped.get(C1_FLAG), 'entry-not-met', 'C1 skip reason');
    return 'no mailbox → no write';
  });

  await check('E05 绝不写 C2–C4/C5：即使证据与旗标都满足', async () => {
    const { core } = fresh();
    const db = createFakeDb();
    db.seed({ careerId: CAREER_ID, nodeId: 'memory-flip.T2', kind: 'commission', status: 'cleared', flags: ['C1.flight_done'], evidence: ['E-memory-flip.T2'] });
    db.seed({ careerId: CAREER_ID, nodeId: 'evidence:E-memory-flip.T2', kind: 'evidence', status: 'cleared', flags: [C2_FLAG], evidence: ['E-memory-flip.T2'] });
    const before = db.nodeIds(CAREER_ID);
    const result = await core.syncFlags({ careerId: CAREER_ID, db: db, mailboxOpened: true, now: NOW });
    eq(result.ok, true, 'ok');
    eq(result.added, [C0_FLAG, C1_FLAG], 'only C0/C1 added');
    const after = db.nodeIds(CAREER_ID);
    const newNodes = after.filter((nodeId) => before.indexOf(nodeId) < 0);
    eq(newNodes, ['story:' + C0_FLAG, 'story:' + C1_FLAG], 'only C0/C1 story rows written');
    const writtenFlags = [];
    db.calls.batches.forEach((batch) => {
      batch.forEach((row) => (row.flags || []).forEach((flag) => writtenFlags.push(flag)));
    });
    eq(writtenFlags.filter((flag) => flag !== C0_FLAG && flag !== C1_FLAG), [], 'syncFlags never writes C2–C5 flags');
    eq(db.flagsOf(CAREER_ID).filter((flag) => /^C[2-5]\./.test(flag)), [C2_FLAG], 'C2 flag only from pre-seeded story-evidence row');
    return 'C2–C4 untouched';
  });

  await check('E06 claims 提供 C1 证据时同样可补 C1', async () => {
    const { core } = fresh();
    const db = createFakeDb();
    const result = await core.syncFlags({
      careerId: CAREER_ID,
      db: db,
      mailboxOpened: true,
      claims: [{ runId: 'run-c1', receiptId: 'run-c1', careerId: CAREER_ID, commissionId: 'star-raid.T1', flags: ['C1.flight_done'] }],
      now: NOW,
    });
    eq(result.ok, true, 'ok');
    eq(result.added, [C0_FLAG, C1_FLAG], 'added');
    eq(result.via, 'work_ship', 'via route');
    return 'claims drive C1';
  });

  await check('E07 DB 读失败：结构化 {ok:false,reason:db-read-failed}，零写入', async () => {
    const { core } = fresh();
    const throwing = createFakeDb({ failures: { readThrow: true } });
    const r1 = await core.syncFlags({ careerId: CAREER_ID, db: throwing, mailboxOpened: true, now: NOW });
    eq(r1.ok, false, 'ok=false');
    eq(r1.reason, MODULE.REASONS.dbReadFailed, 'read reason');
    eq(throwing.calls.write, 0, 'no write');
    const failedRead = createFakeDb({ failures: { read: true } });
    const r2 = await core.syncFlags({ careerId: CAREER_ID, db: failedRead, mailboxOpened: true, now: NOW });
    eq(r2.ok, false, 'ok=false');
    eq(r2.reason, MODULE.REASONS.dbReadFailed, 'read result reason');
    eq(failedRead.calls.write, 0, 'no write');
    return 'read failure structured';
  });

  await check('E08 DB 写失败：结构化 db-write-failed、wrote=0、库里无新增行', async () => {
    const { core } = fresh();
    const rejecting = createFakeDb({ failures: { write: true } });
    const r1 = await core.syncFlags({ careerId: CAREER_ID, db: rejecting, mailboxOpened: true, now: NOW });
    eq(r1.ok, false, 'ok=false');
    eq(r1.reason, MODULE.REASONS.dbWriteFailed, 'write reason');
    eq(r1.wrote, 0, 'wrote=0');
    eq(rejecting.allQuests(CAREER_ID), [], 'no rows stored');
    const throwing = createFakeDb({ failures: { writeThrow: true } });
    const r2 = await core.syncFlags({ careerId: CAREER_ID, db: throwing, mailboxOpened: true, now: NOW });
    eq(r2.ok, false, 'ok=false');
    eq(r2.reason, MODULE.REASONS.dbWriteFailed, 'throw reason');
    eq(r2.wrote, 0, 'wrote=0 on throw');
    return 'write failure structured';
  });

  await check('E09 入参与依赖缺失：bad-career-id / db-unavailable / not-configured', async () => {
    const configured = fresh();
    eq((await configured.core.syncFlags({ careerId: 'bad id!', db: createFakeDb() })).reason, MODULE.REASONS.badCareerId, 'bad career id');
    const noDb = await configured.core.syncFlags({ careerId: CAREER_ID, now: NOW });
    eq(noDb.ok, false, 'no db ok=false');
    eq(noDb.reason, MODULE.REASONS.dbUnavailable, 'no db reason');
    const writeOnly = { putQuests: async () => ({ ok: true }) };
    const noRead = await configured.core.syncFlags({ careerId: CAREER_ID, db: writeOnly, now: NOW });
    eq(noRead.reason, MODULE.REASONS.dbUnavailable, 'missing readQuestState');
    const unconfigured = MODULE.createCampaign({});
    const nc = await unconfigured.syncFlags({ careerId: CAREER_ID, db: createFakeDb(), mailboxOpened: true });
    eq(nc.ok, false, 'unconfigured ok=false');
    eq(nc.reason, MODULE.REASONS.notConfigured, 'unconfigured reason');
    const brokenContent = fresh((input) => {
      input.campaign.chapters = input.campaign.chapters.filter((chapter) => chapter.chapterId !== 'C1');
    });
    eq(brokenContent.cfg.ok, false, 'broken content configure fails');
    const brokenDb = createFakeDb();
    const brokenSync = await brokenContent.core.syncFlags({ careerId: CAREER_ID, db: brokenDb, mailboxOpened: true, now: NOW });
    eq(brokenSync.ok, false, 'broken content sync ok=false');
    eq(brokenSync.reason, MODULE.REASONS.contentInvalid, 'broken content reason');
    eq(brokenDb.calls.write, 0, 'broken content never writes');
    return 'structured input errors';
  });

  await check('E10 单事务原子性：C0 已存在时只补 C1 一行；批内不多写', async () => {
    const { core } = fresh();
    const db = createFakeDb();
    db.seed({ careerId: CAREER_ID, nodeId: 'story:' + C0_FLAG, kind: 'story-flag', status: 'cleared', flags: [C0_FLAG] });
    db.seed({ careerId: CAREER_ID, nodeId: 'star-raid.T1', kind: 'commission', status: 'cleared', flags: ['C1.flight_done'], evidence: [] });
    const result = await core.syncFlags({ careerId: CAREER_ID, db: db, mailboxOpened: true, now: NOW });
    eq(result.ok, true, 'ok');
    eq(result.added, [C1_FLAG], 'only C1 added');
    eq(db.calls.write, 1, 'one transaction');
    eq(db.calls.batches[0].map((row) => row.nodeId), ['story:' + C1_FLAG], 'batch nodeIds');
    eq(result.skipped.length, 1, 'C0 reported skipped');
    eq(result.skipped[0].reason, 'already-present', 'C0 already-present');
    return 'single-row atomic write';
  });
}

/* ------------------------------------------------------------------ *
 * F. 坏内容结构化报错
 * ------------------------------------------------------------------ */

async function groupF() {
  section('F. 坏内容：结构化失败且不抛');

  await check('F01 缺章：chapter-missing，configure 不抛', async () => {
    const { cfg } = fresh((input) => {
      input.campaign.chapters = input.campaign.chapters.filter((chapter) => chapter.chapterId !== 'C3');
    });
    eq(cfg.ok, false, 'ok=false');
    assert(hasCode(cfg.errors, 'chapter-missing'), 'chapter-missing');
    eq(findCode(cfg.errors, 'chapter-missing').chapterId, 'C3', 'missing chapter id');
    return 'C3 missing detected';
  });

  await check('F02 缺终局：ending-missing / ending-count-wrong', async () => {
    const { cfg } = fresh((input) => {
      input.campaign.endings = input.campaign.endings.filter((ending) => ending.approach !== 'rescue');
    });
    eq(cfg.ok, false, 'ok=false');
    assert(hasCode(cfg.errors, 'ending-count-wrong'), 'ending-count-wrong');
    const missing = findCode(cfg.errors, 'ending-missing');
    assert(missing, 'ending-missing');
    eq(missing.approach, 'rescue', 'missing rescue');
    return 'missing ending detected';
  });

  await check('F03 单一游戏硬锁：C3 全部路线依赖 memory-flip → single-game-lock', async () => {
    const { cfg } = fresh((input) => {
      const c3 = campaignChapter(input, 'C3');
      c3.routes = [
        { routeId: 'solo-a', label: 'A', requires: { anyCommissions: ['memory-flip.T2'] }, rewardFlags: [C3_FLAG], hint: 'h' },
        { routeId: 'solo-b', label: 'B', requires: { anyCommissions: ['memory-flip.T3'] }, rewardFlags: [C3_FLAG], hint: 'h' },
      ];
    });
    eq(cfg.ok, false, 'ok=false');
    const lock = findCode(cfg.errors, 'single-game-lock');
    assert(lock, 'single-game-lock');
    eq([lock.chapterId, lock.gameId], ['C3', 'memory-flip'], 'lock detail');
    return 'single-game lock detected';
  });

  await check('F04 循环旗标：章节入口倒指 → cyclic-chapter-entry；路线倒指 → route-cycle', async () => {
    const cyclicEntry = fresh((input) => {
      campaignChapter(input, 'C1').entry = { allFlags: [C2_FLAG] };
    });
    eq(cyclicEntry.cfg.ok, false, 'ok=false');
    const entryError = findCode(cyclicEntry.cfg.errors, 'cyclic-chapter-entry');
    assert(entryError, 'cyclic-chapter-entry');
    eq(entryError.chapterId, 'C1', 'cyclic chapter');
    const routeCycle = fresh((input) => {
      campaignChapter(input, 'C2').routes[0].requires = { anyCommissions: ['shadow-leap.T2'], allFlags: [C3_FLAG] };
    });
    eq(routeCycle.cfg.ok, false, 'ok=false');
    assert(hasCode(routeCycle.cfg.errors, 'route-cycle'), 'route-cycle');
    return 'entry cycle + route cycle detected';
  });

  await check('F05 side-stories 被当成唯一必需资源 → side-story-required', async () => {
    const { cfg } = fresh((input) => {
      const link = input.sideStories.families[0].links[0];
      campaignChapter(input, 'C2').routes[0].requires = { evidenceAny: [link] };
    });
    eq(cfg.ok, false, 'ok=false');
    assert(hasCode(cfg.errors, 'side-story-required'), 'side-story-required');
    assert(hasCode(cfg.errors, 'unknown-evidence'), 'unknown-evidence');
    return 'side-story-only requirement rejected';
  });

  await check('F06 每章替代不足：C3 只剩 1 条 → chapter-too-few-routes', async () => {
    const { cfg } = fresh((input) => {
      const c3 = campaignChapter(input, 'C3');
      c3.routes = c3.routes.slice(0, 1);
    });
    eq(cfg.ok, false, 'ok=false');
    const tooFew = findCode(cfg.errors, 'chapter-too-few-routes');
    assert(tooFew, 'chapter-too-few-routes');
    eq(tooFew.chapterId, 'C3', 'C3 too few');
    return 'route count floor enforced';
  });

  await check('F07 npc 回信缺章 → npc-missing-chapter', async () => {
    const { cfg } = fresh((input) => {
      input.npc.characters.forEach((character) => {
        character.replies = character.replies.filter((reply) => reply.chapterId !== 'C3');
      });
    });
    eq(cfg.ok, false, 'ok=false');
    const missing = findCode(cfg.errors, 'npc-missing-chapter');
    assert(missing, 'npc-missing-chapter');
    eq(missing.chapterId, 'C3', 'C3 npc reply missing');
    return 'npc coverage enforced';
  });

  await check('F08 路线要求键非法 / 条件不可满足的形状 → requirement-key-unknown', async () => {
    const { cfg } = fresh((input) => {
      campaignChapter(input, 'C2').routes[1].requires = { gameId: 'memory-flip' };
    });
    eq(cfg.ok, false, 'ok=false');
    const unknown = findCode(cfg.errors, 'requirement-key-unknown');
    assert(unknown, 'requirement-key-unknown');
    eq(unknown.key, 'gameId', 'unknown key detail');
    return 'single gameId prerequisite rejected by schema';
  });

  await check('F09 垃圾输入：configure 绝不抛，全部结构化失败', async () => {
    const garbage = [null, undefined, [], 'text', 42, { campaign: null }, { campaign: { chapters: 'nope' } }];
    const results = garbage.map((value) => {
      const core = MODULE.createCampaign({});
      const cfg = core.configure(value);
      assert(cfg && cfg.ok === false, 'garbage must fail: ' + detail(value));
      assert(Array.isArray(cfg.errors) && cfg.errors.length >= 1, 'garbage must carry errors: ' + detail(value));
      return cfg.errors[0].code;
    });
    eq(results[0], 'missing-campaign', 'null → missing-campaign');
    eq(results[1], 'missing-campaign', 'undefined → missing-campaign');
    const recycled = MODULE.createCampaign({});
    recycled.configure(contentInput());
    eq(recycled.validate().ok, true, 'valid configure');
    recycled.configure(null);
    eq(recycled.validate().ok, false, 'garbage configure resets instance');
    eq(recycled.validate().errors[0].code, MODULE.REASONS.notConfigured, 'not-configured after garbage');
    return results.length + ' garbage shapes';
  });

  await check('F10 缺内容文件 / 缺 commissions：章节文件、npc、支线、委托告警', async () => {
    const missingFile = fresh((input) => {
      input.chapters = input.chapters.filter((chapter) => chapter.chapterId !== 'C4');
    });
    eq(missingFile.cfg.ok, false, 'missing file ok=false');
    assert(hasCode(missingFile.cfg.errors, 'chapter-file-missing'), 'chapter-file-missing');
    const missingNpc = fresh((input) => {
      delete input.npc;
    });
    assert(hasCode(missingNpc.cfg.errors, 'missing-npc'), 'missing-npc');
    const missingSide = fresh((input) => {
      delete input.sideStories;
    });
    assert(hasCode(missingSide.cfg.errors, 'missing-side-stories'), 'missing-side-stories');
    const missingCommissions = fresh((input) => {
      delete input.commissions;
    });
    assert(hasCode(missingCommissions.cfg.warnings, 'commissions-missing'), 'commissions-missing warning');
    eq(missingCommissions.core.validate().ok, true, 'validate still ok without commissions content');
    return 'missing files/content reported';
  });
}

/* ------------------------------------------------------------------ *
 * G. 可插拔与确定性
 * ------------------------------------------------------------------ */

async function groupG() {
  section('G. 可插拔（第 17 游戏 / 第 6 条旁路）与确定性');

  await check('G01 第 17 游戏可插拔：新增委托与新路线不破坏 validate', async () => {
    const { core, cfg } = fresh((input) => {
      input.commissions.push({ commissionId: 'future-game.T2', gameId: 'future-game', tier: 2, reward: { credits: 0, items: {}, evidence: ['E-future-game.T2'], flags: [] } });
      campaignChapter(input, 'C3').routes.push({
        routeId: 'future-branch',
        label: '未来旁路',
        requires: { anyCommissions: ['future-game.T2'] },
        rewardFlags: [C3_FLAG],
        hint: 'future',
      });
    });
    eq(cfg.ok, true, 'ok');
    eq(cfg.errors, [], 'no errors');
    const report = core.validate();
    eq(report.origins.length, CONTENT.gameIds.length + 1, 'origins +1');
    assert(report.origins.indexOf('future-game') >= 0, 'future-game is an origin');
    eq(report.alternatives.C3, 4, 'C3 now has 4 alternatives');
    return '17 origins, C3 4 alternatives';
  });

  await check('G02 第 6 条支线家族 / 第 4 条 C4 旁路可插拔', async () => {
    const { core, cfg } = fresh((input) => {
      input.sideStories.families.push({ familyId: 'future_family', title: '未来旁路', links: ['XL11', 'XL12'], text: '新增的可选解释，不提供唯一必需资源。' });
      campaignChapter(input, 'C4').routes.push({
        routeId: 'backup',
        label: '备用协调线',
        requires: { anyCommissions: ['blackjack.T3'] },
        rewardFlags: [C4_FLAG],
        hint: 'backup',
      });
    });
    eq(cfg.ok, true, 'ok');
    eq(cfg.errors, [], 'no errors');
    eq(cfg.warnings.filter((warning) => warning.code === 'side-story-required'), [], 'no side-story-required');
    eq(core.validate().alternatives.C4, 4, 'C4 4 alternatives');
    return 'pluggable side story + route';
  });

  await check('G03 configure 不修改输入内容（纯函数契约）', async () => {
    const input = contentInput();
    const before = JSON.stringify(input);
    const core = MODULE.createCampaign({});
    core.configure(input);
    eq(JSON.stringify(input), before, 'input content untouched');
    const { core: other, cfg } = fresh();
    eq(cfg.ok, true, 'real content ok');
    const stateInput = { flags: [C0_FLAG], quests: storyQuests([C0_FLAG]) };
    const stateBefore = JSON.stringify(stateInput);
    other.state(stateInput);
    eq(JSON.stringify(stateInput), stateBefore, 'state input untouched');
    return 'no input mutation';
  });

  await check('G04 确定性：两个实例输出逐字节一致，重复调用稳定', async () => {
    const a = fresh();
    const b = fresh();
    eq(JSON.stringify(a.cfg), JSON.stringify(b.cfg), 'configure identical');
    eq(JSON.stringify(a.core.validate()), JSON.stringify(b.core.validate()), 'validate identical');
    const input = { quests: storyQuests([C0_FLAG, C1_FLAG, C2_FLAG]), claims: [{ runId: 'r', commissionId: 'solitaire.T2' }] };
    eq(JSON.stringify(a.core.state(input)), JSON.stringify(b.core.state(input)), 'state identical');
    eq(JSON.stringify(a.core.endingOptions({ flags: [C4_FLAG] })), JSON.stringify(b.core.endingOptions({ flags: [C4_FLAG] })), 'endingOptions identical');
    eq(a.cfg.signature, b.cfg.signature, 'signature identical');
    const firstState = JSON.stringify(a.core.state({ flags: [C0_FLAG] }));
    eq(JSON.stringify(a.core.state({ flags: [C0_FLAG] })), firstState, 'repeat state stable');
    return 'byte-identical outputs';
  });

  await check('G05 状态与旗标排序确定性：flags/cleared 排序输出、章节顺序 C0→C5', async () => {
    const { core } = fresh();
    const st = core.state({
      flags: [C4_FLAG, C0_FLAG, C1_FLAG, C2_FLAG, C3_FLAG],
      cleared: ['solitaire.T2', 'memory-flip.T2', 'road-rush.T2'],
    });
    eq(st.flags, [C0_FLAG, C1_FLAG, C2_FLAG, C3_FLAG, C4_FLAG], 'flags sorted');
    eq(st.cleared, ['memory-flip.T2', 'road-rush.T2', 'solitaire.T2'], 'cleared sorted');
    eq(st.chapters.map((chapter) => chapter.chapterId), ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'], 'chapter order');
    return 'deterministic ordering';
  });
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

async function main() {
  try {
    assembly();
  } catch (err) {
    console.error('FAIL  装配失败：' + (err && err.stack ? err.stack : err));
    console.error('\n0/0 checks passed（装配未完成）');
    return 2;
  }

  await groupA();
  await groupB();
  await groupC();
  await groupD();
  await groupE();
  await groupF();
  await groupG();

  if (SELF_TEST === 'check') {
    await check('SELFTEST 故意失败（仅用于证明 exit 1）', async () => {
      assert(false, 'intentional self-test failure');
    });
  }

  const failed = failures.length;
  console.log('');
  if (failed === 0) {
    console.log('PASS: ' + passed + '/' + total + ' checks passed');
    return 0;
  }
  console.log('FAIL: ' + passed + '/' + total + ' checks passed');
  failures.forEach((item, index) => console.log('  ' + (index + 1) + '. ' + item));
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('FAIL  ' + (err && err.stack ? err.stack : err));
    console.error('\n0/0 checks passed（未捕获异常）');
    process.exit(2);
  });
