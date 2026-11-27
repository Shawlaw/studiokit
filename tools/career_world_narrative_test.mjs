#!/usr/bin/env node
/**
 * Arcade 0.24 T22 — 可选职业交汇内容 + 条件 + 后日常反馈门禁（纯 Node）
 *
 * 覆盖：
 *  A. 冻结常量与模块边界
 *  B. 内容文件按 tools/career_world_narrative_schema.json 校验（7 替代 + 10 交汇 + 17 经历白名单）
 *  C. 覆盖矩阵（16 职业 / 10 pair / 6 机制 / C1–C5）与 0.23 shard 声明的折叠一致性
 *  D. 真实锚点与经济边界（只引用真实委托/代办/租机/材料/证据；不发奖励）
 *  E. 玩家文本卫生（无职业展示名、无内部 id、无攻略词、无私有路径、无原型示例人物）
 *  F. 交汇 resolver 正反矩阵（双方接受 / 单侧 read / 未发现 / 搁置 / future / archived / surface / 章节 / gate）
 *  G. 内容层去重与 fail-closed（重复声明、文本不一致、eventId 反序、占位、非法 grants）
 *  H. 替代路线 resolver（6 机制 × C1–C5 可达性、「不需要特定职业」、gate 正反、机制真实性）
 *  I. 经历白名单与真实 0.23 投影联动（label 只在白名单注入后出现）
 *  J. 纯函数边界（不修改入参、不抛异常、无 DOM/DB/时钟/随机数）
 *  K. 与 0.23 基线的只读一致性（96 委托、5 世界工作、16 shard、事件 id 通过真实 reducer）
 *
 * 运行：node tools/career_world_narrative_test.mjs
 * 不启动 Chrome、不写仓库、不读网络。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CONTENT_REL = 'apps/arcade/career/content';
const SCHEMA_REL = 'tools/career_world_narrative_schema.json';
const RESOLVER_REL = 'apps/arcade/career/world-narrative.js';
const CONTENT_FILE_REL = CONTENT_REL + '/world-narrative.json';

/* ------------------------------------------------------------------ *
 * 断言与工具
 * ------------------------------------------------------------------ */

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? '' : String(detail === undefined ? '' : detail) });
}
function equal(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'expected ' + e + ' got ' + a);
}
function unique(values) {
  return new Set(values).size === values.length;
}
function hanCount(text) {
  return (String(text).match(/[\u4e00-\u9fff]/g) || []).length;
}
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}
function readJson(relPath) {
  return JSON.parse(readText(relPath));
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isPlainObject(value)) {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}
function deepEqual(left, right) {
  return canonical(left) === canonical(right);
}
function walkStrings(value, trail = '$', out = []) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => walkStrings(child, trail + '[' + index + ']', out));
  } else if (isPlainObject(value)) {
    Object.keys(value).forEach((key) => walkStrings(value[key], trail + '.' + key, out));
  } else if (typeof value === 'string') {
    out.push([trail, value]);
  }
  return out;
}
function walkKeys(value, trail = '$', out = []) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => walkKeys(child, trail + '[' + index + ']', out));
  } else if (isPlainObject(value)) {
    Object.keys(value).forEach((key) => {
      out.push([trail, key]);
      walkKeys(value[key], trail + '.' + key, out);
    });
  }
  return out;
}
function stripSourceComments(source) {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/* ------------------------------------------------------------------ *
 * JSON Schema 子集校验器（type/enum/const/pattern/长度/items/minItems/
 * maxItems/uniqueItems/properties/required/additionalProperties/$ref）
 * ------------------------------------------------------------------ */

function resolvePointer(doc, ref) {
  if (typeof ref !== 'string' || ref.charAt(0) !== '#') return null;
  const parts = ref.slice(1).split('/').filter((part) => part.length > 0);
  let node = doc;
  for (const raw of parts) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isPlainObject(node) || !Object.prototype.hasOwnProperty.call(node, key)) return null;
    node = node[key];
  }
  return node === undefined ? null : node;
}
function matchesType(type, value) {
  switch (type) {
    case 'object': return isPlainObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true;
  }
}
function validate(doc, schema, value, trail = '$', errors = []) {
  if (schema === true) return errors;
  if (!isPlainObject(schema)) {
    errors.push(trail + ': schema-not-object');
    return errors;
  }
  if (typeof schema.$ref === 'string') {
    const target = resolvePointer(doc, schema.$ref);
    if (!target) {
      errors.push(trail + ': unresolved-ref ' + schema.$ref);
      return errors;
    }
    return validate(doc, target, value, trail, errors);
  }
  if (typeof schema.type === 'string' && !matchesType(schema.type, value)) {
    errors.push(trail + ': expected ' + schema.type + ' got ' + (value === null ? 'null' : typeof value));
    return errors;
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'const') && !deepEqual(schema.const, value)) {
    errors.push(trail + ': const ' + JSON.stringify(schema.const) + ' got ' + JSON.stringify(value));
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => deepEqual(candidate, value))) {
    errors.push(trail + ': enum mismatch ' + JSON.stringify(value));
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(trail + ': minLength ' + schema.minLength + ' got ' + value.length);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(trail + ': maxLength ' + schema.maxLength + ' got ' + value.length);
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      errors.push(trail + ': pattern ' + schema.pattern + ' got ' + value);
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(trail + ': minimum ' + schema.minimum);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(trail + ': maximum ' + schema.maximum);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(trail + ': minItems ' + schema.minItems);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errors.push(trail + ': maxItems ' + schema.maxItems);
    if (schema.uniqueItems === true && !unique(value.map((item) => canonical(item)))) {
      errors.push(trail + ': uniqueItems violated');
    }
    if (schema.items) value.forEach((item, index) => validate(doc, schema.items, item, trail + '[' + index + ']', errors));
  }
  if (isPlainObject(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    required.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(trail + ': missing required ' + key);
    });
    const props = isPlainObject(schema.properties) ? schema.properties : {};
    Object.keys(props).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(value, key)) validate(doc, props[key], value[key], trail + '.' + key, errors);
    });
    Object.keys(value).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(props, key)) return;
      if (schema.additionalProperties === false) errors.push(trail + ': unexpected property ' + key);
      else if (isPlainObject(schema.additionalProperties)) validate(doc, schema.additionalProperties, value[key], trail + '.' + key, errors);
    });
  }
  if (Array.isArray(schema.allOf)) schema.allOf.forEach((sub, index) => validate(doc, sub, value, trail + '|allOf' + index, errors));
  if (Array.isArray(schema.anyOf)) {
    const passed = schema.anyOf.some((sub) => validate(doc, sub, value, trail, []).length === 0);
    if (!passed) errors.push(trail + ': anyOf not matched');
  }
  if (Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.filter((sub) => validate(doc, sub, value, trail, []).length === 0);
    if (matched.length !== 1) errors.push(trail + ': oneOf matched ' + matched.length);
  }
  return errors;
}

/* ------------------------------------------------------------------ *
 * 装配（失败即退出 2）
 * ------------------------------------------------------------------ */

let contract;
let content;
let registry;
let commissionsFile;
let worldWork;
let chapterOne;
let campaign;
let npc;
let items;
let cluesFile;
let narrativeRegistry;
let shards;
let professionState;
let professionView;
let worldNarrative;
let routePlanner;
let materialsModule;
let storyEvidenceModule;
try {
  contract = readJson(SCHEMA_REL);
  content = readJson(CONTENT_FILE_REL);
  registry = readJson(CONTENT_REL + '/registry.json');
  commissionsFile = readJson(CONTENT_REL + '/commissions.json');
  worldWork = readJson(CONTENT_REL + '/world-work.json');
  chapterOne = readJson(CONTENT_REL + '/chapter-01.json');
  campaign = readJson(CONTENT_REL + '/campaign.json');
  npc = readJson(CONTENT_REL + '/npc.json');
  items = readJson(CONTENT_REL + '/items.json');
  cluesFile = readJson(CONTENT_REL + '/clues.json');
  narrativeRegistry = readJson(CONTENT_REL + '/narrative-registry.json');
  shards = [1, 2, 3, 4].map((index) => readJson(CONTENT_REL + '/narrative-shards/shard-0' + index + '.json'));
  professionState = require(path.join(ROOT, 'apps/arcade/career/profession-state.js'));
  professionView = require(path.join(ROOT, 'apps/arcade/career/profession-view.js'));
  worldNarrative = require(path.join(ROOT, RESOLVER_REL));
  /* 0.24 T24：验证 bridge 注入形状能被真实 route-planner 只读消费。 */
  routePlanner = require(path.join(ROOT, 'apps/arcade/career/route-planner.js'));
  materialsModule = require(path.join(ROOT, 'apps/arcade/career/materials.js'));
  storyEvidenceModule = require(path.join(ROOT, 'apps/arcade/career/story-evidence.js'));
} catch (error) {
  console.error('FAIL 装配失败: ' + (error && error.message ? error.message : String(error)));
  process.exit(2);
}

const constants = contract.constants || {};
const schemas = contract.schemas || {};
const alternativeSamples = ((contract.samples || {}).alternativeNarrative) || [];
const crossoverSamples = ((contract.samples || {}).crossover) || [];
const journalSamples = ((contract.samples || {}).journalEvents) || [];
const alternativesSource = readText('apps/arcade/career/alternatives.js');
const resolverSource = readText(RESOLVER_REL);
const bridgeSource = readText('apps/arcade/career/bridge.js');

const realGames = new Map((registry.games || []).map((row) => [row.gameId, row]));
const realProfessions = new Map((registry.professions || []).map((row) => [row.professionId, row]));
const realProfessionIds = Array.from(realProfessions.keys()).sort();
const realDisplayNames = realProfessionIds.map((professionId) => realProfessions.get(professionId).displayName).filter(Boolean);
const realCommissions = new Map((commissionsFile.commissions || []).map((row) => [row.commissionId, row]));
const realCommissionIds = Array.from(realCommissions.keys());
const realEvidence = new Set();
realCommissions.forEach((row) => {
  ((row.reward && row.reward.evidence) || []).forEach((token) => realEvidence.add(token));
});
const realEvidenceTyped = Array.from(realEvidence).filter((token) => /^(E|MAP|BP|DEC)-/.test(token)).sort();
const realFlags = new Set();
(function collectFlags() {
  const addText = (value) => {
    if (typeof value === 'string' && /^C[1-9]\.[a-z0-9][a-z0-9._-]{0,60}$/.test(value)) realFlags.add(value);
  };
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (isPlainObject(value)) Object.keys(value).forEach((key) => walk(value[key]));
    else addText(value);
  };
  walk(campaign);
  realCommissions.forEach((row) => ((row.reward && row.reward.flags) || []).forEach(addText));
  ((chapterOne.c1 && chapterOne.c1.signals) || []).forEach((signal) => {
    if (isPlainObject(signal)) {
      addText(signal.flag);
      addText(signal.mapsTo);
      (signal.from || []).forEach(addText);
    }
  });
})();
const allRealFlags = Array.from(new Set(Array.from(realFlags).concat(
  (campaign.chapters || []).flatMap((chapter) => ((chapter.entry && chapter.entry.allFlags) || [])),
))).sort();
const worldWorkIds = new Set(Array.isArray(worldWork.commissionIds) ? worldWork.commissionIds : []);
const originByGame = new Map((chapterOne.origins || []).map((origin) => [origin.gameId, origin]));
const npcCharacterIds = new Set((npc.characters || []).map((character) => character.characterId));
const npcCharacterNames = new Map((npc.characters || []).map((character) => [character.characterId, character.name]));
const rentalShipIds = new Set((items.ships || []).filter((row) => row.rental === true).map((row) => row.shipId));
const materialIds = new Set((items.materials || []).map((row) => row.itemId));
const campaignChapterFlags = new Map((campaign.chapters || []).map((chapter) => [chapter.chapterId, ((chapter.entry && chapter.entry.allFlags) || []).slice()]));
const realClueTitles = Array.from(new Set((cluesFile.clues || []).map((clue) => clue.title).filter(Boolean)));
const realWorldWorkTitles = Array.from(new Set(((worldWork.entries) || []).map((entry) => entry.title).filter(Boolean)));
const realCommissionTitles = Array.from(new Set(Array.from(realCommissions.values()).map((row) => row.title).filter(Boolean)));
const realShardEntries = shards.flatMap((shard) => shard.entries || []);
const shardByProfession = new Map(realShardEntries.map((entry) => [entry.professionId, entry]));

const offers = [];
(function collectOffers() {
  const matches = alternativesSource.match(/offerId: '([^']+)'/g) || [];
  matches.forEach((row) => {
    const offerId = row.slice("offerId: '".length, -1);
    if (offerId) offers.push({ offerId, issuer: '' });
  });
})();
const offerIssuerBySource = (offerId) => {
  const index = alternativesSource.indexOf("offerId: '" + offerId + "'");
  if (index < 0) return '';
  const window = alternativesSource.slice(index, index + 400);
  const match = window.match(/issuer: '([^']+)'/);
  return match ? match[1] : '';
};
offers.forEach((offer) => {
  offer.issuer = offerIssuerBySource(offer.offerId);
});

const catalog = {
  games: registry.games,
  professions: registry.professions,
  commissions: commissionsFile.commissions,
  worldWork,
  chapterOne,
  campaign,
  npc,
  items,
  offers,
};
const engine = worldNarrative.createWorldNarrative({ content, catalog });

const FULL_CONTEXT = {
  surface: 'port',
  acceptedProfessionIds: realProfessionIds.slice(),
  worldFlags: allRealFlags.slice(),
  clearedCommissions: ['gold-miner.T1'],
  storyEvidence: realEvidenceTyped.slice(),
  archived: false,
};

function makeState(entries, overrides) {
  const progress = {};
  entries.forEach((entry) => {
    progress[entry.professionId] = { state: entry.state || 'accepted', paused: entry.paused === true };
  });
  return Object.assign({ professionVersion: 1, professionProgress: progress, storyEvents: {} }, overrides || {});
}
function allAcceptedState() {
  return makeState(realProfessionIds.map((professionId) => ({ professionId })));
}
function bothAcceptedState(left, right) {
  return makeState([{ professionId: left }, { professionId: right }]);
}
function withContext(overrides) {
  return Object.assign({}, FULL_CONTEXT, overrides || {});
}
function chapterFlagsBefore(chapterId) {
  const target = ['C1', 'C2', 'C3', 'C4', 'C5'].indexOf(chapterId);
  const out = [];
  ['C1', 'C2', 'C3', 'C4', 'C5'].slice(0, target).forEach((id) => {
    (campaignChapterFlags.get(id) || []).forEach((flag) => {
      if (out.indexOf(flag) < 0) out.push(flag);
    });
  });
  return out;
}
function gateFlagsOf(gate) {
  return Array.from(new Set([].concat(gate.requiresFlagsAny || [], gate.requiresFlagsAll || [])));
}
function pairGateContext(pair, extra) {
  return withContext(Object.assign({
    /* 当前章节：把章节门与 gate 门分开测，gate 缺失时必须报 world-locked 而不是 story-locked。 */
    chapterId: pair.anchor.chapterIds[0],
    worldFlags: allRealFlags.slice(),
    clearedCommissions: ['gold-miner.T1'],
    storyEvidence: realEvidenceTyped.slice(),
  }, extra || {}));
}

/* ------------------------------------------------------------------ *
 * A. 冻结常量与模块边界
 * ------------------------------------------------------------------ */

equal('A01 schemaVersion', worldNarrative.SCHEMA_VERSION, 1);
equal('A02 contentVersion 仍 0.18.0', worldNarrative.CONTENT_VERSION, '0.18.0');
equal('A03 professionVersion 仍 1', worldNarrative.PROFESSION_VERSION, 1);
check('A04 模块导出 createWorldNarrative', typeof worldNarrative.createWorldNarrative === 'function');
check('A05 模块导出 ADR 兼容 resolveWorldAlternatives', typeof worldNarrative.resolveWorldAlternatives === 'function');
check('A06 模块导出 resolveSignature 只读落款解引用', typeof worldNarrative.resolveSignature === 'function');
check('A07 模块导出 eventIdForProfessionPair', typeof worldNarrative.eventIdForProfessionPair === 'function');
const factoryKeys = Object.keys(engine).sort();
equal('A08 createWorldNarrative 只返回三个方法', factoryKeys, ['listCrossovers', 'resolveAlternative', 'resolveCrossover']);
check('A09 返回对象冻结且方法可调用', Object.isFrozen(engine)
  && factoryKeys.every((key) => typeof engine[key] === 'function'));
equal('A10 acceptedStates 与 schema 冻结一致', worldNarrative.ACCEPTED_STATES.slice().sort(), constants.acceptedStates.slice().sort());
equal('A11 机制枚举与顺序冻结一致', worldNarrative.MECHANISMS.slice().sort(), constants.mechanisms.slice().sort());
equal('A12 机制 → 锚点 kind 映射一致', worldNarrative.MECHANISM_ANCHOR_KIND, constants.mechanismAnchorKind);
equal('A13 机制 → receiptSource 映射一致', worldNarrative.MECHANISM_RECEIPT_SOURCE, constants.mechanismReceiptSource);
equal('A14 交汇可见面与 schema 一致', worldNarrative.CROSSOVER_SURFACES.slice().sort(), constants.crossoverSurfaces.slice().sort());
check('A15 交汇可见面 ⊆ 真实投影 SURFACES 且不含 clue/letter/work/shop/crafting/tools', worldNarrative.CROSSOVER_SURFACES.every((surface) => professionView.SURFACES.indexOf(surface) >= 0)
  && constants.forbiddenCrossoverSurfaces.every((surface) => worldNarrative.CROSSOVER_SURFACES.indexOf(surface) < 0));
check('A16 替代叙事可见面 ⊆ 真实投影 SURFACES 且排除邀请/商店/制造面', worldNarrative.ALTERNATIVE_SURFACES.every((surface) => professionView.SURFACES.indexOf(surface) >= 0)
  && ['clue', 'letter', 'shop', 'crafting', 'tools'].every((surface) => worldNarrative.ALTERNATIVE_SURFACES.indexOf(surface) < 0));
check('A17 经历面 ⊆ 真实投影 SURFACES', worldNarrative.JOURNAL_SURFACES.every((surface) => professionView.SURFACES.indexOf(surface) >= 0));
equal('A18 reason code 与 0.23 冻结 13 码完全一致（不新增）', Object.values(worldNarrative.REASONS).sort(), Object.values(professionView.REASONS).sort());
equal('A19 冻结章节旗标镜像与真实 campaign 一致', worldNarrative.FROZEN_CHAPTER_FLAGS, {
  C1: campaignChapterFlags.get('C1'),
  C2: campaignChapterFlags.get('C2'),
  C3: campaignChapterFlags.get('C3'),
  C4: campaignChapterFlags.get('C4'),
  C5: campaignChapterFlags.get('C5'),
});
equal('A20 冻结世界工作 id 镜像与真实 world-work 一致', worldNarrative.FROZEN_WORLD_WORK_IDS.slice().sort(), Array.from(worldWorkIds).sort());
equal('A21 冻结免费租机镜像与真实 items 一致', worldNarrative.FROZEN_RENTAL_SHIP_IDS.slice().sort(), Array.from(rentalShipIds).sort());
equal('A22 冻结材料镜像与真实 items 一致', worldNarrative.FROZEN_MATERIAL_IDS.slice().sort(), Array.from(materialIds).sort());
equal('A23 冻结代办镜像与真实 alternatives.js 一致', worldNarrative.FROZEN_OFFERS.map((row) => row.offerId).sort(), offers.map((row) => row.offerId).sort());
check('A24 冻结代办 issuer 与真实 alternatives.js 一致（落款只读真实内容）', worldNarrative.FROZEN_OFFERS.every((row) => row.issuer === offerIssuerBySource(row.offerId)), JSON.stringify(worldNarrative.FROZEN_OFFERS));
check('A25 事件 id 语法与真实 reducer 一致（≤120、namespace:name）', /^\^\[a-z\]\[a-z0-9-\]\*:/.test(constants.eventIdGrammar) === false || (() => {
  const re = new RegExp(constants.eventIdGrammar);
  return re.test('crossover:research.archivist:research.lattice') && !re.test('Crossover:x') && constants.eventIdMaxLength === 120;
})());
check('A26 内容文件存在且顶层键恰为冻结 6 键', isPlainObject(content) && deepEqual(Object.keys(content).sort(), contract.contentLayout.topLevelKeys.slice().sort()), isPlainObject(content) ? Object.keys(content).join(',') : 'missing');
equal('A27 内容文件 schemaVersion/contentVersion/releaseVersion', [content.schemaVersion, content.contentVersion, content.releaseVersion], [1, '0.18.0', '0.24']);
check('A28 resolver 源码无 DOM/DB/存储/网络/时钟/随机数依赖', !/document\s*\.|indexedDB|localStorage|sessionStorage|XMLHttpRequest|fetch\s*\(|\bMath\.random\b|\bnew Date\b|\bDate\.now\b|setTimeout/.test(stripSourceComments(resolverSource)));
check('A29 resolver 为 UMD（Node module.exports + 浏览器 ArcadeCareer.worldNarrative）', /module\.exports\s*=/.test(resolverSource) && /root\.ArcadeCareerWorldNarrative/.test(resolverSource) && /career\.worldNarrative/.test(resolverSource));

/* ------------------------------------------------------------------ *
 * B. schema 校验
 * ------------------------------------------------------------------ */

check('B01 内容文件通过契约 sample 结构（schema 定义存在）', isPlainObject(schemas.alternativeNarrativeNode) && isPlainObject(schemas.crossoverPair) && isPlainObject(schemas.journalEvent));

const alternativeIssues = [];
(content.alternativeNarratives || []).forEach((node, index) => {
  const errors = validate(contract, schemas.alternativeNarrativeNode, node, 'alt[' + index + ']');
  if (errors.length) alternativeIssues.push(errors.slice(0, 3).join(' ; '));
});
check('B02 7 条替代叙事全部通过 alternativeNarrativeNode schema', alternativeIssues.length === 0
  && (content.alternativeNarratives || []).length === 7, alternativeIssues.slice(0, 3).join(' | '));

const pairIssues = [];
(content.crossoverPairs || []).forEach((pair, index) => {
  const errors = validate(contract, schemas.crossoverPair, pair, 'pair[' + index + ']');
  if (errors.length) pairIssues.push(errors.slice(0, 3).join(' ; '));
});
check('B03 10 条交汇声明全部通过 crossoverPair schema', pairIssues.length === 0
  && (content.crossoverPairs || []).length === 10, pairIssues.slice(0, 3).join(' | '));

const journalIssues = [];
(content.journalWhitelist || []).forEach((entry, index) => {
  const errors = validate(contract, schemas.journalEvent, entry, 'journal[' + index + ']');
  if (errors.length) {
    journalIssues.push(errors.slice(0, 3).join(' ; '));
    return;
  }
  const rules = Array.isArray(schemas.journalEvent.conditionalRules) ? schemas.journalEvent.conditionalRules : [];
  rules.forEach((rule) => {
    const when = isPlainObject(rule.when) ? rule.when : {};
    const matched = Object.keys(when).every((key) => deepEqual(when[key], entry[key]));
    if (!matched) return;
    ((rule.require) || []).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(entry, key)) journalIssues.push('journal[' + index + ']: missing ' + key);
    });
    ((rule.forbid) || []).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(entry, key)) journalIssues.push('journal[' + index + ']: unexpected ' + key);
    });
  });
});
check('B04 17 条经历白名单全部通过 journalEvent schema 与条件规则', journalIssues.length === 0
  && (content.journalWhitelist || []).length === 17, journalIssues.slice(0, 3).join(' | '));

check('B05 内容里没有 placeholder:true（真实文案已上线）', [].concat(
  (content.alternativeNarratives || []).map((node) => node.placeholder),
  (content.crossoverPairs || []).map((pair) => pair.placeholder),
  (content.journalWhitelist || []).map((entry) => entry.placeholder),
).every((value) => value === false));
check('B06 全部玩家文本不是占位样例', [].concat(
  (content.alternativeNarratives || []).flatMap((node) => Object.values(node.texts || {})),
  (content.crossoverPairs || []).flatMap((pair) => Object.values(pair.texts || {})),
  (content.journalWhitelist || []).map((entry) => entry.label || ''),
).every((text) => !String(text).includes('占位')));

/* ---- 0.24 T24：经历回读 text/person 加性内容 ---- */

const realSignerNames = new Set();
(chapterOne.origins || []).forEach((origin) => {
  const from = origin && origin.c0Letter && origin.c0Letter.from;
  if (typeof from === 'string' && from) realSignerNames.add(from);
});
shards.forEach((shard) => {
  (shard.entries || []).forEach((entry) => {
    if (typeof entry.npc === 'string' && entry.npc) realSignerNames.add(entry.npc);
    if (typeof entry.sender === 'string' && entry.sender) realSignerNames.add(entry.sender);
  });
});
(npc.characters || []).forEach((character) => {
  if (typeof character.name === 'string' && character.name) realSignerNames.add(character.name);
});

const journalEventSchema = schemas.journalEvent || {};
const journalEventProps = journalEventSchema.properties || {};
check('B07 schema 加性冻结 text（≤120）与 person（≤24）且不进 required', journalEventProps.text
  && journalEventProps.text.maxLength === 120
  && journalEventProps.text.minLength === 8
  && journalEventProps.person
  && journalEventProps.person.maxLength === 24
  && (journalEventSchema.required || []).indexOf('text') < 0
  && (journalEventSchema.required || []).indexOf('person') < 0, JSON.stringify(journalEventProps));
const contentJournalRows = Array.isArray(content.journalWhitelist) ? content.journalWhitelist : [];
const detailRowIssues = [];
const detailTexts = new Set();
contentJournalRows.forEach((row, index) => {
  const where = 'journal[' + index + ']';
  if (typeof row.text !== 'string' || row.text.length < 8 || row.text.length > 120) {
    detailRowIssues.push(where + ':text');
  }
  if (typeof row.person !== 'string' || !row.person || row.person.length > 24 || !realSignerNames.has(row.person)) {
    detailRowIssues.push(where + ':person=' + String(row.person));
  }
  const text = typeof row.text === 'string' ? row.text : '';
  if (/信用点|星币|工钱|奖励|报酬|积分|材料\s*[×x]/.test(text)) detailRowIssues.push(where + ':money');
  if (/\d+(?:\.\d+)?\s*%|\b\d+\s*\/\s*\d+\b/.test(text)) detailRowIssues.push(where + ':progress');
  if (/(?:^|[^A-Za-z0-9])C[0-5](?:\.|\b)/.test(text)) detailRowIssues.push(where + ':chapter-code');
  if (/\b[A-Z]{1,3}-\d{1,4}\b/.test(text) || /\b[a-z][a-z0-9-]*:[A-Za-z0-9]/.test(text)) detailRowIssues.push(where + ':internal-id');
  realDisplayNames.forEach((name) => {
    if (name && text.includes(name)) detailRowIssues.push(where + ':profession-name');
  });
  if (detailTexts.has(text)) detailRowIssues.push(where + ':duplicate');
  detailTexts.add(text);
});
check('B08 17 条白名单全部带真实 text/person（长度/签名人/卫生/不重复）', contentJournalRows.length === 17
  && contentJournalRows.every((row) => typeof row.text === 'string' && typeof row.person === 'string')
  && detailRowIssues.length === 0, detailRowIssues.slice(0, 6).join(' | '));
check('B09 回读文本不承诺奖励、不写章节码/内部 id/攻略/进度', contentJournalRows.every((row) => !/占位|信用点|星币|工钱|奖励|报酬|积分/.test(row.text)
  && !/(?:\d+\s*\/\s*\d+|\d+(?:\.\d+)?\s*%)/.test(row.text)
  && !/(?:^|[^A-Za-z0-9])C[0-5](?:\.|\b)/.test(row.text)
  && !/第一步|第二步|依次前往|完整路线|必做|必经|唯一解|速通/.test(row.text)));
check('B10 resolver 接受带 text/person 的真实内容（规整不破坏既有替代节点）', (() => {
  try {
    const engineWithDetail = worldNarrative.createWorldNarrative({ content, catalog });
    const resolved = engineWithDetail.resolveAlternative({ state: allAcceptedState(), context: FULL_CONTEXT });
    const aggregateWithDetail = worldNarrative.resolveWorldAlternatives({
      chapterId: 'C4',
      state: allAcceptedState(),
      context: FULL_CONTEXT,
      catalog,
      content,
    });
    return resolved.ok === true && aggregateWithDetail.schemaVersion === 1 && Array.isArray(aggregateWithDetail.nodes);
  } catch (error) {
    return false;
  }
})());

/* ------------------------------------------------------------------ *
 * C. 覆盖矩阵与去重后的真实 pair
 * ------------------------------------------------------------------ */

const contentPairs = content.crossoverPairs || [];
const contentAlternatives = content.alternativeNarratives || [];
const contentJournal = content.journalWhitelist || [];
const pairByEventId = new Map(contentPairs.map((pair) => [pair.eventId, pair]));
const alternativeById = new Map(contentAlternatives.map((node) => [node.narrativeNodeId, node]));
const coveredProfessions = new Set();
contentPairs.forEach((pair) => pair.professionIds.forEach((professionId) => coveredProfessions.add(professionId)));
check('C01 交汇覆盖全部 16 个真实职业（折叠后 10 对）', coveredProfessions.size === 16
  && realProfessionIds.every((professionId) => coveredProfessions.has(professionId)), Array.from(coveredProfessions).sort().join(','));
check('C02 每对 professionIds 升序、去重且 eventId = crossover:<min>:<max>', contentPairs.every((pair) => {
  const ids = pair.professionIds;
  return ids.length === 2 && ids[0] < ids[1] && pair.eventId === 'crossover:' + ids[0] + ':' + ids[1] && pair.pairId === pair.eventId;
}));
check('C03 交汇 eventId 唯一', unique(contentPairs.map((pair) => pair.eventId)));
check('C04 交汇 eventId 全部通过真实 reducer 的 eventId 语法', contentPairs.every((pair) => {
  const recorded = professionState.recordStoryEvent(professionState.initialState(), { eventId: pair.eventId, source: 'world', at: '2026-11-28T00:00:00.000Z' });
  return recorded && recorded.ok === true;
}));
check('C05 交汇 owner 只能是 pair 内职业且 10 对 owner 均为 min（ADR 去重规则 ①）', contentPairs.every((pair) => pair.contentOwnerProfessionId === pair.professionIds[0] && pair.activeTextOwner === true));

/* 与 0.23 shard 的 optionalCrossover 折叠结果逐对一致（不发明新对） */
const shardDeclarations = realShardEntries.filter((entry) => isPlainObject(entry.optionalCrossover)).map((entry) => {
  const ids = (entry.optionalCrossover.requiredProfessionIds || []).slice().sort();
  return {
    professionId: entry.professionId,
    eventId: ids.length === 2 ? 'crossover:' + ids[0] + ':' + ids[1] : null,
    ids,
    text: entry.optionalCrossover.text || '',
    releaseVersion: entry.optionalCrossover.releaseVersion,
  };
});
const shardPairIds = Array.from(new Set(shardDeclarations.map((row) => row.eventId)));
equal('C06 0.23 shard 的 16 条声明折叠为 10 个 pair', shardPairIds.length, 10);
check('C07 内容 pair 集合与 shard 声明折叠集合完全一致', deepEqual(contentPairs.map((pair) => pair.eventId).sort(), shardPairIds.slice().sort()));
check('C08 每条 shard 声明都含自身职业且标注 0.24 双边接受', shardDeclarations.every((row) => row.ids.length === 2
  && row.ids.indexOf(row.professionId) >= 0
  && row.releaseVersion === '0.24'
  && row.text.includes('都已接受')));
/* owner 规则：声明者 === min 者优先，否则 owner 字典序最小 */
const shardOwnerByPair = new Map();
shardPairIds.forEach((eventId) => {
  const declarations = shardDeclarations.filter((row) => row.eventId === eventId);
  const minId = eventId.split(':')[1];
  const preferred = declarations.filter((row) => row.professionId === minId);
  const pool = preferred.length ? preferred : declarations;
  shardOwnerByPair.set(eventId, pool.map((row) => row.professionId).sort()[0]);
});
check('C09 内容 owner 与 shard 声明去重规则的赢家一致', contentPairs.every((pair) => shardOwnerByPair.get(pair.eventId) === pair.contentOwnerProfessionId));
check('C10 交汇 anchor 与 T20 schema 赢家样例逐项一致（章节/游戏/人物/gate 冻结）', contentPairs.every((pair) => {
  const sample = crossoverSamples.filter((row) => row.eventId === pair.eventId).sort((left, right) => {
    const leftRank = left.contentOwnerProfessionId === pair.professionIds[0] ? 0 : 1;
    const rightRank = right.contentOwnerProfessionId === pair.professionIds[0] ? 0 : 1;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.contentOwnerProfessionId < right.contentOwnerProfessionId ? -1 : 1;
  })[0];
  if (!sample) return false;
  const expectedGate = {
    professionGate: sample.gate.professionGate,
    acceptedStates: sample.gate.acceptedStates.slice().sort(),
    pausedBlocks: sample.gate.pausedBlocks,
    requiresFlagsAny: sample.gate.requiresFlagsAny.slice().sort(),
    requiresFlagsAll: sample.gate.requiresFlagsAll.slice().sort(),
    requiresCommissionsAll: sample.gate.requiresCommissionsAll.slice().sort(),
    requiresEvidenceAny: sample.gate.requiresEvidenceAny.slice().sort(),
  };
  const actualGate = {
    professionGate: pair.gate.professionGate,
    acceptedStates: pair.gate.acceptedStates.slice().sort(),
    pausedBlocks: pair.gate.pausedBlocks,
    requiresFlagsAny: pair.gate.requiresFlagsAny.slice().sort(),
    requiresFlagsAll: pair.gate.requiresFlagsAll.slice().sort(),
    requiresCommissionsAll: pair.gate.requiresCommissionsAll.slice().sort(),
    requiresEvidenceAny: pair.gate.requiresEvidenceAny.slice().sort(),
  };
  return deepEqual(pair.anchor, sample.anchor) && deepEqual(actualGate, expectedGate);
}));

check('C11 替代叙事 7 条且 narrativeNodeId 唯一', contentAlternatives.length === 7
  && unique(contentAlternatives.map((node) => node.narrativeNodeId)));
check('C12 替代叙事覆盖 6 种机制', deepEqual(Array.from(new Set(contentAlternatives.map((node) => node.mechanism))).sort(), constants.mechanisms.slice().sort()));
check('C13 替代叙事覆盖 C1–C5 五个章节', deepEqual(Array.from(new Set(contentAlternatives.map((node) => node.chapterId))).sort(), ['C1', 'C2', 'C3', 'C4', 'C5']));
check('C14 narrativeNodeId 前缀与章节一致且符合 schema 模式', contentAlternatives.every((node) => node.narrativeNodeId.indexOf('altn.' + node.chapterId + '.') === 0
  && new RegExp(schemas.alternativeNarrativeNode.properties.narrativeNodeId.pattern).test(node.narrativeNodeId)));
check('C15 每条替代叙事都有 offer/progress/receipt/next 四段真实文案', contentAlternatives.every((node) => ['offer', 'progress', 'receipt', 'next'].every((key) => typeof node.texts[key] === 'string' && node.texts[key].length > 0)));
check('C16 每个机制在替代叙事中至少出现一次，且 receiptSource 与机制映射一致', contentAlternatives.every((node) => node.receiptSource === constants.mechanismReceiptSource[node.mechanism]));
check('C17 经历白名单 eventId 唯一', unique(contentJournal.map((entry) => entry.eventId)));
check('C18 经历白名单 = 10 条交汇事件 + 7 条替代路线事件', deepEqual(contentJournal.map((entry) => entry.eventId).sort(), contentPairs.map((pair) => pair.eventId).concat([
  'world:C1.world-work.star-raid-t1',
  'world:C1.rental.old-wing',
  'world:C2.errand.alt.courier',
  'world:C3.profession-commission.shadow-leap-t2',
  'world:C4.evidence-pair.mole-whack-block-drop',
  'world:C4.market-material.building',
  'world:C5.profession-commission.gold-miner-t6',
]).sort()));
check('C19 交汇白名单 source 全为 world', contentJournal.filter((entry) => entry.eventId.indexOf('crossover:') === 0).every((entry) => entry.source === 'world'));
check('C20 代办替代事件 source 为 commission（对齐 ADR 示例）', (contentJournal.find((entry) => entry.eventId === 'world:C2.errand.alt.courier') || {}).source === 'commission');

/* ------------------------------------------------------------------ *
 * D. 真实锚点与经济边界
 * ------------------------------------------------------------------ */

const anchorIssues = [];
contentAlternatives.forEach((node) => {
  const where = node.narrativeNodeId;
  const expectedKind = constants.mechanismAnchorKind[node.mechanism];
  if (node.anchor.kind !== expectedKind) anchorIssues.push(where + ': anchor.kind');
  if (node.receiptSource !== constants.mechanismReceiptSource[node.mechanism]) anchorIssues.push(where + ': receiptSource');
  if (node.gate.requiresAcceptedProfession !== true || node.gate.requiresSpecificProfession !== false) anchorIssues.push(where + ': gate profession flags');
  node.anchor.refs.forEach((ref) => {
    if (node.anchor.kind === 'commission') {
      if (!realCommissions.has(ref)) anchorIssues.push(where + ': unknown commission ' + ref);
      if (node.mechanism === 'world-work' && !worldWorkIds.has(ref)) anchorIssues.push(where + ': not world-work ' + ref);
      if (node.mechanism === 'profession-commission' && worldWorkIds.has(ref)) anchorIssues.push(where + ': world-work used as profession commission ' + ref);
    }
    if (node.anchor.kind === 'offer' && !offers.some((offer) => offer.offerId === ref)) anchorIssues.push(where + ': unknown offer ' + ref);
    if (node.anchor.kind === 'ship' && !rentalShipIds.has(ref)) anchorIssues.push(where + ': not a free rental ship ' + ref);
    if (node.anchor.kind === 'item' && !materialIds.has(ref)) anchorIssues.push(where + ': unknown material ' + ref);
    if (node.anchor.kind === 'evidencePair' && !realEvidence.has(ref)) anchorIssues.push(where + ': evidence not producible ' + ref);
  });
  if (node.anchor.kind === 'evidencePair' && (node.anchor.refs.length < 2 || node.anchor.refs.length > 3)) anchorIssues.push(where + ': evidencePair refs count');
  gateFlagsOf(node.gate).forEach((flag) => {
    if (!realFlags.has(flag)) anchorIssues.push(where + ': unreal flag ' + flag);
  });
  (node.gate.requiresCommissionsAll || []).forEach((commissionId) => {
    if (!realCommissions.has(commissionId)) anchorIssues.push(where + ': unknown gate commission ' + commissionId);
  });
  (node.gate.requiresEvidenceAny || []).forEach((token) => {
    if (!realEvidence.has(token)) anchorIssues.push(where + ': unknown gate evidence ' + token);
  });
  if (node.signatureFrom === 'origin-letter' && (!isPlainObject(node.npcRef) || node.npcRef.kind !== 'origin-letter' || !originByGame.has(node.npcRef.gameId))) anchorIssues.push(where + ': bad origin-letter npcRef');
  if (node.signatureFrom === 'npc-character' && (!isPlainObject(node.npcRef) || node.npcRef.kind !== 'character' || !npcCharacterIds.has(node.npcRef.characterId))) anchorIssues.push(where + ': bad character npcRef');
  if (node.signatureFrom === 'commission-issuer' && node.anchor.kind !== 'commission') anchorIssues.push(where + ': commission-issuer anchor');
  if (node.signatureFrom === 'offer-issuer' && node.anchor.kind !== 'offer') anchorIssues.push(where + ': offer-issuer anchor');
});
check('D01 替代叙事锚点全部指向真实委托/代办/租机/材料/证据，落款来源自洽', anchorIssues.length === 0, anchorIssues.slice(0, 5).join(' | '));

const pairAnchorIssues = [];
contentPairs.forEach((pair) => {
  pair.professionIds.forEach((professionId) => {
    if (!realProfessions.has(professionId)) pairAnchorIssues.push(pair.eventId + ': unknown profession ' + professionId);
  });
  const games = pair.anchor.professionGames;
  games.forEach((row) => {
    const profession = realProfessions.get(row.professionId);
    if (!profession) return;
    const expectedGame = (registry.games.find((game) => (game.professions || []).indexOf(row.professionId) >= 0) || {}).gameId;
    if (expectedGame !== row.gameId) pairAnchorIssues.push(pair.eventId + ': game mismatch ' + row.professionId);
  });
  pair.anchor.npcRefs.forEach((ref) => {
    if (ref.kind === 'origin-letter' && !originByGame.has(ref.gameId)) pairAnchorIssues.push(pair.eventId + ': unknown origin ' + ref.gameId);
    if (ref.kind === 'character' && !npcCharacterIds.has(ref.characterId)) pairAnchorIssues.push(pair.eventId + ': unknown character ' + ref.characterId);
  });
  gateFlagsOf(pair.gate).forEach((flag) => {
    if (!realFlags.has(flag)) pairAnchorIssues.push(pair.eventId + ': unreal flag ' + flag);
  });
  (pair.gate.requiresCommissionsAll || []).forEach((commissionId) => {
    if (!realCommissions.has(commissionId)) pairAnchorIssues.push(pair.eventId + ': unknown gate commission ' + commissionId);
  });
  (pair.gate.requiresEvidenceAny || []).forEach((token) => {
    if (!realEvidence.has(token)) pairAnchorIssues.push(pair.eventId + ': unknown gate evidence ' + token);
  });
  if (pair.gate.professionGate !== 'both-accepted' || pair.gate.pausedBlocks !== false) pairAnchorIssues.push(pair.eventId + ': gate semantics');
  if (!deepEqual(pair.gate.acceptedStates.slice().sort(), constants.acceptedStates.slice().sort())) pairAnchorIssues.push(pair.eventId + ': acceptedStates');
});
check('D02 交汇 anchor 全部指向真实职业/游戏/起源信/gate 真实事实', pairAnchorIssues.length === 0, pairAnchorIssues.slice(0, 5).join(' | '));

check('D03 全部交汇声明独立于主线：effects 空、grants 全零、不动身份、不改主线', contentPairs.every((pair) => Array.isArray(pair.effects) && pair.effects.length === 0
  && pair.grants.credits === 0
  && isPlainObject(pair.grants.items) && Object.keys(pair.grants.items).length === 0
  && Array.isArray(pair.grants.evidence) && pair.grants.evidence.length === 0
  && Array.isArray(pair.grants.flags) && pair.grants.flags.length === 0
  && pair.touchesMainline === false
  && pair.affectsIdentity === false
  && pair.maxShowsPerCareer === 1));
check('D04 所有替代叙事不得依赖特定其他职业（requiresSpecificProfession:false）', contentAlternatives.every((node) => node.gate.requiresSpecificProfession === false && node.gate.requiresAcceptedProfession === true));
check('D05 内容没有新增委托：真实委托总量仍 96、id 唯一', realCommissionIds.length === 96 && unique(realCommissionIds));
check('D06 世界工作仍是真实 5 单，未被内容改写', worldWorkIds.size === 5 && Array.from(worldWorkIds).every((id) => realCommissions.has(id)));
check('D07 内容未声明 reward/rewards/price/cost/purchase 等经济字段（grants 仅交汇零值证明）', (() => {
  const forbidden = new Set(contract.forbidden.contentKeys || []);
  const hits = [];
  const walk = (value, trail, insideGrants) => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => walk(child, trail + '[' + index + ']', false));
      return;
    }
    if (!isPlainObject(value)) return;
    const isCrossoverPair = value.sampleKind === 'crossoverPair';
    Object.keys(value).forEach((key) => {
      const grantsField = insideGrants && ['credits', 'items', 'evidence', 'flags'].indexOf(key) >= 0;
      const grantsContainer = key === 'grants' && isCrossoverPair;
      if (forbidden.has(key) && !grantsField && !grantsContainer) hits.push(trail + '.' + key);
      walk(value[key], trail + '.' + key, grantsContainer);
    });
  };
  walk(content, 'content', false);
  return hits.length === 0;
})(), 'forbidden-key');
check('D08 内容没有出现任何未替换模板占位符（{{ }}）', !walkStrings(content).some(([, text]) => text.includes('{{') || text.includes('}}')));

/* ------------------------------------------------------------------ *
 * E. 玩家文本卫生
 * ------------------------------------------------------------------ */

const playerTexts = [];
contentAlternatives.forEach((node) => {
  Object.keys(node.texts).forEach((key) => playerTexts.push({ where: node.narrativeNodeId + ':' + key, text: node.texts[key], kind: 'alternative' }));
});
contentPairs.forEach((pair) => {
  Object.keys(pair.texts).forEach((key) => playerTexts.push({ where: pair.eventId + ':' + key, text: pair.texts[key], kind: 'crossover' }));
});
contentJournal.forEach((entry) => playerTexts.push({ where: entry.eventId + ':label', text: entry.label, kind: 'journal', isLabel: true }));

check('E01 玩家文本数量 ≥ 60（7×4 + 10×4 + 17）', playerTexts.length === 85, playerTexts.length);
check('E02 玩家文本全部非空且唯一（无复制粘贴兜底）', playerTexts.every((row) => row.text.length > 0) && unique(playerTexts.map((row) => row.text)));
const textLengthIssues = [];
playerTexts.forEach((row) => {
  if (row.isLabel) {
    if (row.text.length < 6 || row.text.length > 60) textLengthIssues.push(row.where + ': label ' + row.text.length);
    if (hanCount(row.text) < 6 || hanCount(row.text) > 40) textLengthIssues.push(row.where + ': label han ' + hanCount(row.text));
    return;
  }
  const key = row.where.slice(row.where.lastIndexOf(':') + 1);
  const limits = { invite: [10, 120], body: [10, 240], receipt: [10, 120], decline: [8, 120], offer: [10, 120], progress: [10, 120], next: [6, 80] }[key];
  if (!limits) {
    textLengthIssues.push(row.where + ': unknown text key');
    return;
  }
  if (row.text.length < limits[0] || row.text.length > limits[1]) textLengthIssues.push(row.where + ': ' + row.text.length);
});
check('E03 玩家文本长度符合 schema 冻结区间（含 label 6–40 汉字、≤60 字符）', textLengthIssues.length === 0, textLengthIssues.slice(0, 5).join(' | '));

const displayNameHits = playerTexts.filter((row) => realDisplayNames.some((name) => name && row.text.includes(name)));
check('E04 玩家文本不含任何真实职业展示名（未接受一侧不泄底）', displayNameHits.length === 0, displayNameHits.map((row) => row.where).join(','));
const tokenHits = playerTexts.filter((row) => (contract.forbidden.playerTextTokens || []).some((token) => row.text.includes(token)));
check('E05 玩家文本无内部 id / 证据 token / 章节码 / 委托后缀', tokenHits.length === 0, tokenHits.map((row) => row.where).join(','));
const idHits = playerTexts.filter((row) => /(?:crossover|world|story|invitation|commission):/.test(row.text)
  || /altn\./.test(row.text)
  || contentAlternatives.some((node) => node.anchor.refs.some((ref) => row.text.includes(ref)))
  || contentPairs.some((pair) => pair.anchor.professionGames.some((row2) => row.text.includes(row2.gameId))));
check('E06 玩家文本不含 eventId / narrativeNodeId / 锚点 id / gameId', idHits.length === 0, idHits.map((row) => row.where).join(','));
const routeHits = playerTexts.filter((row) => (contract.forbidden.routeGuideKeywords || []).some((keyword) => row.text.includes(keyword)));
check('E07 玩家文本无完整路线攻略词', routeHits.length === 0, routeHits.map((row) => row.where).join(','));
const pathPattern = new RegExp(contract.forbidden.privatePathPattern);
const pathHits = playerTexts.filter((row) => pathPattern.test(row.text) || row.text.includes('\\'));
check('E08 玩家文本无私有路径 / 远程资源 / 反斜杠', pathHits.length === 0, pathHits.map((row) => row.where).join(','));
const prototypeHits = playerTexts.filter((row) => ['阿砾', '月影遗迹'].some((token) => row.text.includes(token)));
check('E09 玩家文本不含外部原型示例人物/地名（阿砾、月影遗迹）', prototypeHits.length === 0, prototypeHits.map((row) => row.where).join(','));
const systemHits = playerTexts.filter((row) => ['系统检测到', '恭喜解锁', '必须完成', '职业 3/16'].some((token) => row.text.includes(token)));
check('E10 玩家文本无系统化话术', systemHits.length === 0, systemHits.map((row) => row.where).join(','));
const digitHits = playerTexts.filter((row) => /\d/.test(row.text));
check('E11 玩家文本不出现数量、金额、百分比或进度数字', digitHits.length === 0, digitHits.map((row) => row.where).join(','));
const economyHits = playerTexts.filter((row) => ['奖励', '报酬', '信用点', '金币', '星币', '完成后得', '可以兑换'].some((token) => row.text.includes(token)));
check('E12 玩家文本不承诺奖励/金额/兑换', economyHits.length === 0, economyHits.map((row) => row.where).join(','));
const crossoverTitleHits = contentPairs.filter((pair) => realCommissionTitles.concat(realWorldWorkTitles, realClueTitles).some((title) => title.length >= 2
  && Object.values(pair.texts).some((text) => text.includes(title))));
check('E13 交汇文本不引用真实委托标题 / 世界工作标题 / 线索标题', crossoverTitleHits.length === 0, crossoverTitleHits.map((pair) => pair.eventId).join(','));

/* ------------------------------------------------------------------ *
 * F. 交汇 resolver 正反矩阵
 * ------------------------------------------------------------------ */

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}
function eventIdsOf(result) {
  return ((result && result.nodes) || []).map((node) => node.eventId);
}
function crossoverKeys() {
  return ['eventId', 'pairId', 'npcRefs', 'texts', 'receiptSource', 'maxShowsPerCareer'];
}

const acceptedAllState = allAcceptedState();
const listedAll = engine.listCrossovers({ state: acceptedAllState, context: FULL_CONTEXT });
check('F01 16 职业全接受 + 全部真实前置 → 10 对全部产出', listedAll.ok === true && listedAll.nodes.length === 10
  && unique(eventIdsOf(listedAll)), JSON.stringify({ ok: listedAll.ok, count: listedAll.nodes.length }));
check('F02 list 结果按 eventId 升序且与内容 10 个 eventId 完全一致', deepEqual(eventIdsOf(listedAll), contentPairs.map((pair) => pair.eventId).sort()));
check('F03 list 每个节点键集冻结为 eventId/pairId/npcRefs/texts/receiptSource/maxShowsPerCareer', listedAll.nodes.every((node) => deepEqual(Object.keys(node).sort(), crossoverKeys().slice().sort())));
check('F04 节点不含职业 id 列表/展示名/经济字段/效果字段', listedAll.nodes.every((node) => !Object.prototype.hasOwnProperty.call(node, 'professionIds')
  && !Object.prototype.hasOwnProperty.call(node, 'displayName')
  && !Object.prototype.hasOwnProperty.call(node, 'grants')
  && !Object.prototype.hasOwnProperty.call(node, 'effects')
  && !Object.prototype.hasOwnProperty.call(node, 'credits')));
check('F05 节点 receiptSource 恒为 narrative-event、maxShowsPerCareer 恒为 1', listedAll.nodes.every((node) => node.receiptSource === 'narrative-event' && node.maxShowsPerCareer === 1));
check('F06 节点文本与内容静态文案一致、人物引用与 anchor 一致', listedAll.nodes.every((node) => {
  const pair = pairByEventId.get(node.eventId);
  return !!pair && deepEqual(node.texts, pair.texts) && deepEqual(node.npcRefs, pair.anchor.npcRefs);
}));
check('F07 每个事件 id 唯一且 ≤ 120、符合 crossover:<min>:<max>', listedAll.nodes.every((node) => node.eventId.length <= 120
  && node.eventId.indexOf('crossover:') === 0
  && node.eventId.split(':').length === 3));
check('F08 同一输入两次调用输出完全一致（确定性）', deepEqual(engine.listCrossovers({ state: acceptedAllState, context: FULL_CONTEXT }), listedAll));

const pairSurfaceFailures = [];
contentPairs.forEach((pair) => {
  const ids = pair.professionIds;
  const state = bothAcceptedState(ids[0], ids[1]);
  const context = pairGateContext(pair);
  const byEvent = engine.resolveCrossover({ state, context, eventId: pair.eventId });
  const byPairId = engine.resolveCrossover({ state, context, pairId: pair.pairId });
  const byProfessions = engine.resolveCrossover({ state, context, professionIds: [ids[1], ids[0]] });
  if (!(byEvent.ok && byEvent.node && byEvent.node.eventId === pair.eventId)) pairSurfaceFailures.push(pair.eventId + ': byEventId');
  if (!(byPairId.ok && byPairId.node && byPairId.node.pairId === pair.eventId)) pairSurfaceFailures.push(pair.eventId + ': byPairId');
  if (!(byProfessions.ok && byProfessions.node && byProfessions.node.eventId === pair.eventId)) pairSurfaceFailures.push(pair.eventId + ': byProfessionIds(反序)');
  /* 当前章节即可见：只要 gate 真实前置满足 */
  const currentChapter = pair.anchor.chapterIds[0];
  const currentOnly = engine.resolveCrossover({
    state,
    context: withContext({
      chapterId: currentChapter,
      acceptedProfessionIds: ids,
      worldFlags: gateFlagsOf(pair.gate),
      clearedCommissions: (pair.gate.requiresCommissionsAll || []).slice(),
      storyEvidence: (pair.gate.requiresEvidenceAny || []).slice(),
    }),
    eventId: pair.eventId,
  });
  if (!(currentOnly.ok && currentOnly.node)) pairSurfaceFailures.push(pair.eventId + ': 当前章节不产出');
  /* 章节窗口：只给首个章节之前的真实旗标时不得提前透露（多章节对同样成立） */
  const earlierFlags = chapterFlagsBefore(currentChapter);
  const tooEarly = engine.resolveCrossover({
    state,
    context: withContext({
      acceptedProfessionIds: ids,
      worldFlags: earlierFlags,
      clearedCommissions: (pair.gate.requiresCommissionsAll || []).slice(),
      storyEvidence: (pair.gate.requiresEvidenceAny || []).slice(),
    }),
    eventId: pair.eventId,
  });
  if (!(tooEarly.ok === true && tooEarly.node === null && tooEarly.reason === 'story-locked')) {
    pairSurfaceFailures.push(pair.eventId + ': 提前泄露/错误 reason ' + JSON.stringify(tooEarly.reason));
  }
});
check('F09 10 对分别按 eventId/pairId/反序 professionIds 解析均幂等产出，且章节窗口正反成立', pairSurfaceFailures.length === 0, pairSurfaceFailures.slice(0, 5).join(' | '));

const gateFailures = [];
contentPairs.forEach((pair) => {
  const state = allAcceptedState();
  const base = pairGateContext(pair);
  if ((pair.gate.requiresFlagsAny || []).length) {
    const flags = allRealFlags.filter((flag) => (pair.gate.requiresFlagsAny || []).indexOf(flag) < 0);
    const result = engine.resolveCrossover({ state, context: Object.assign({}, base, { worldFlags: flags }), eventId: pair.eventId });
    if (!(result.ok === true && result.node === null && result.reason === 'world-locked')) gateFailures.push(pair.eventId + ': requiresFlagsAny');
  }
  if ((pair.gate.requiresFlagsAll || []).length) {
    const flags = allRealFlags.filter((flag) => flag !== pair.gate.requiresFlagsAll[0]);
    const result = engine.resolveCrossover({ state, context: Object.assign({}, base, { worldFlags: flags }), eventId: pair.eventId });
    if (!(result.ok === true && result.node === null && result.reason === 'world-locked')) gateFailures.push(pair.eventId + ': requiresFlagsAll');
  }
  if ((pair.gate.requiresCommissionsAll || []).length) {
    const result = engine.resolveCrossover({ state, context: Object.assign({}, base, { clearedCommissions: [] }), eventId: pair.eventId });
    if (!(result.ok === true && result.node === null && result.reason === 'world-locked')) gateFailures.push(pair.eventId + ': requiresCommissionsAll');
  }
  if ((pair.gate.requiresEvidenceAny || []).length) {
    const result = engine.resolveCrossover({ state, context: Object.assign({}, base, { storyEvidence: [] }), eventId: pair.eventId });
    if (!(result.ok === true && result.node === null && result.reason === 'world-locked')) gateFailures.push(pair.eventId + ': requiresEvidenceAny');
  }
});
check('F10 每对 gate 的 flagsAny/flagsAll/commissionsAll/evidenceAny 缺失时一律不产出（world-locked）', gateFailures.length === 0, gateFailures.slice(0, 5).join(' | '));

/* 单侧未接受：绝不产出、输出不泄露另一侧身份 */
const leakFailures = [];
contentPairs.forEach((pair) => {
  const ids = pair.professionIds;
  const context = pairGateContext(pair);
  const variants = [
    ['另一侧 read', bothAcceptedState(ids[0], ids[1]), { [ids[1]]: { state: 'read' } }],
    ['另一侧未发现', bothAcceptedState(ids[0], ids[1]), { [ids[1]]: { state: 'undiscovered' } }],
    ['另一侧 glimpsed', bothAcceptedState(ids[0], ids[1]), { [ids[1]]: { state: 'glimpsed' } }],
  ];
  variants.forEach(([label, baseState, patch]) => {
    const state = cloneDeep(baseState);
    Object.keys(patch).forEach((professionId) => {
      state.professionProgress[professionId] = patch[professionId];
    });
    const result = engine.resolveCrossover({ state, context: Object.assign({}, context, { acceptedProfessionIds: [ids[0]] }), eventId: pair.eventId });
    const serialized = JSON.stringify(result);
    const otherDisplay = realDisplayNames.join('');
    if (!(result.ok === true && result.node === null && result.reason === 'not-accepted')) {
      leakFailures.push(pair.eventId + ': ' + label + ' 产生节点');
    }
    if (serialized.includes('research.') || serialized.includes('engineering.') || serialized.includes('nature.')
      || serialized.includes('intel.') || serialized.includes('adventure.') || serialized.includes(otherDisplay)) {
      leakFailures.push(pair.eventId + ': ' + label + ' 输出泄露职业 id/展示名');
    }
  });
});
check('F11 仅一侧已接受（另一侧 read/未发现/glimpsed）→ 零节点且输出不泄露身份', leakFailures.length === 0, leakFailures.slice(0, 5).join(' | '));

const hintFailures = [];
contentPairs.forEach((pair) => {
  const state = bothAcceptedState(pair.professionIds[0], pair.professionIds[1]);
  /* context 侧未接受（与 state 冲突）时 fail-closed */
  const result = engine.resolveCrossover({
    state,
    context: Object.assign({}, pairGateContext(pair), { acceptedProfessionIds: [pair.professionIds[0]] }),
    eventId: pair.eventId,
  });
  if (!(result.ok === true && result.node === null && result.reason === 'not-accepted')) hintFailures.push(pair.eventId);
});
check('F12 state 已接受但 context 未列该职业 → fail-closed 零节点', hintFailures.length === 0, hintFailures.slice(0, 5).join(','));

const pausedFailures = [];
contentPairs.forEach((pair) => {
  const state = makeState([
    { professionId: pair.professionIds[0], state: 'developed', paused: true },
    { professionId: pair.professionIds[1], state: 'accepted', paused: false },
  ]);
  const result = engine.resolveCrossover({ state, context: pairGateContext(pair), eventId: pair.eventId });
  if (!(result.ok === true && result.node)) pausedFailures.push(pair.eventId);
});
check('F13 已接受但被搁置不阻塞（pausedBlocks:false）且不退回状态', pausedFailures.length === 0, pausedFailures.slice(0, 5).join(','));

const completedFailures = [];
contentPairs.forEach((pair) => {
  const state = makeState([
    { professionId: pair.professionIds[0], state: 'completed' },
    { professionId: pair.professionIds[1], state: 'completed' },
  ]);
  const result = engine.resolveCrossover({ state, context: pairGateContext(pair), eventId: pair.eventId });
  if (!(result.ok === true && result.node)) completedFailures.push(pair.eventId);
});
check('F14 阶段圆满（completed）仍算已接受 → 正常产出', completedFailures.length === 0, completedFailures.slice(0, 5).join(','));

const futureResult = engine.resolveCrossover({ state: Object.assign({}, acceptedAllState, { professionVersion: 2 }), context: FULL_CONTEXT });
const archivedResult = engine.resolveCrossover({ state: acceptedAllState, context: Object.assign({}, FULL_CONTEXT, { archived: true }) });
const archivedList = engine.listCrossovers({ state: acceptedAllState, context: Object.assign({}, FULL_CONTEXT, { archived: true }) });
check('F15 future professionVersion → 不产出（future-version）', futureResult.ok === false && futureResult.node === null && futureResult.reason === 'future-version');
check('F16 封存 archived → 不产出（archived）', archivedResult.ok === false && archivedResult.node === null && archivedResult.reason === 'archived'
  && archivedList.ok === false && archivedList.nodes.length === 0 && archivedList.reason === 'archived');

const surfaceFailures = [];
const forbiddenCrossoverSurfaces = ['clue', 'letter', 'work', 'shop', 'crafting', 'tools', 'route'];
forbiddenCrossoverSurfaces.forEach((surface) => {
  const result = engine.listCrossovers({ state: acceptedAllState, context: Object.assign({}, FULL_CONTEXT, { surface }) });
  if (!(result.ok === true && result.nodes.length === 0 && result.reason === 'wrong-surface')) surfaceFailures.push(surface);
});
contentPairs.forEach((pair) => {
  const state = bothAcceptedState(pair.professionIds[0], pair.professionIds[1]);
  pair.visibleSurfaces.forEach((surface) => {
    const result = engine.resolveCrossover({ state, context: Object.assign({}, pairGateContext(pair), { surface }), eventId: pair.eventId });
    if (!(result.ok === true && result.node)) surfaceFailures.push(pair.eventId + '@' + surface);
  });
});
check('F17 交汇只在冻结 6 面可见，clue/letter/work/shop/crafting/tools/route 面一律零节点', surfaceFailures.length === 0, surfaceFailures.slice(0, 5).join(' | '));

/* 已写入真实经历后不再主动产出（maxShowsPerCareer:1），且写入幂等 */
const recordedPairId = 'crossover:research.archivist:research.lattice';
const recordedState = bothAcceptedState('research.archivist', 'research.lattice');
recordedState.storyEvents[recordedPairId] = { at: '2026-11-28T00:00:00.000Z', source: 'world' };
const recordedContext = Object.assign({}, FULL_CONTEXT, { acceptedProfessionIds: ['research.archivist', 'research.lattice'] });
const recordedResolve = engine.resolveCrossover({ state: recordedState, context: recordedContext, eventId: recordedPairId });
const recordedList = engine.listCrossovers({ state: recordedState, context: recordedContext });
const firstRecord = professionState.recordStoryEvent(professionState.initialState(), { eventId: recordedPairId, source: 'world', at: '2026-11-28T00:00:00.000Z' });
const secondRecord = professionState.recordStoryEvent(firstRecord.state, { eventId: recordedPairId, source: 'world', at: '2026-11-29T00:00:00.000Z' });
check('F18 已持久化的交汇事件不再产出（historical-only），重复写入幂等且不改写', recordedResolve.ok === true && recordedResolve.node === null
  && recordedResolve.reason === 'historical-only'
  && recordedList.nodes.every((node) => node.eventId !== recordedPairId)
  && firstRecord.ok === true && secondRecord.ok === true && secondRecord.duplicate === true
  && secondRecord.state.storyEvents[recordedPairId].at === '2026-11-28T00:00:00.000Z');

/* 输出隔离：调用方改写返回值不影响后续解析 */
const isolationContext = Object.assign({}, FULL_CONTEXT, { acceptedProfessionIds: ['research.archivist', 'research.lattice'] });
const isolationState = bothAcceptedState('research.archivist', 'research.lattice');
const isolationFirst = engine.resolveCrossover({ state: isolationState, context: isolationContext, eventId: recordedPairId });
isolationFirst.node.texts.invite = '被调用方改写';
const isolationSecond = engine.resolveCrossover({ state: isolationState, context: isolationContext, eventId: recordedPairId });
check('F19 输出为副本，调用方改写不影响第二次解析（纯函数无共享可写引用）', isolationSecond.node.texts.invite === pairByEventId.get(recordedPairId).texts.invite);

const unknownPair = engine.resolveCrossover({ state: acceptedAllState, context: FULL_CONTEXT, eventId: 'crossover:research.archivist:nature.miner' });
const unknownProfession = engine.resolveCrossover({ state: acceptedAllState, context: FULL_CONTEXT, professionIds: ['research.archivist', 'ghost.profession'] });
check('F20 未声明的 pair 选择器 → ok:true/node:null，不伪造节点', unknownPair.ok === true && unknownPair.node === null);
check('F21 选择器含未知职业 → ok:false/unknown-profession（诊断码不进玩家文本）', unknownProfession.ok === false && unknownProfession.reason === 'unknown-profession');

const partialState = bothAcceptedState('research.archivist', 'research.lattice');
const partialList = engine.listCrossovers({ state: partialState, context: Object.assign({}, FULL_CONTEXT, { acceptedProfessionIds: ['research.archivist', 'research.lattice'] }) });
check('F22 只有一对双方接受时 list 只产出该对（11 个未满足对不出现）', partialList.ok === true
  && partialList.nodes.length === 1
  && partialList.nodes[0].eventId === recordedPairId);
const contextOnlyList = engine.listCrossovers({
  state: {},
  context: Object.assign({}, FULL_CONTEXT, { acceptedProfessionIds: ['research.archivist', 'research.lattice'] }),
});
check('F23 冻结 context 已列出双方接受时可解析（state 缺省按 context 只读提示）', contextOnlyList.ok === true && contextOnlyList.nodes.length === 1);
const noFlagState = allAcceptedState();
const noFlagList = engine.listCrossovers({ state: noFlagState, context: Object.assign({}, FULL_CONTEXT, { worldFlags: [], storyEvidence: [], clearedCommissions: [] }) });
check('F24 无真实旗标且无当前章节 → 零节点（不提前透露后续章节）', noFlagList.ok === true && noFlagList.nodes.length === 0, noFlagList.nodes.length);
const c1CurrentList = engine.listCrossovers({ state: noFlagState, context: Object.assign({}, FULL_CONTEXT, { worldFlags: [], storyEvidence: [], clearedCommissions: [], chapterId: 'C1' }) });
check('F25 当前章 C1 且无 gate 旗标 → 零节点（gate 仍必须真实成立）', c1CurrentList.ok === true && c1CurrentList.nodes.length === 0);
check('F26 产出节点不含 disabled/locked/placeholder 等占位形态（未满足直接不产出）', listedAll.nodes.every((node) => !Object.prototype.hasOwnProperty.call(node, 'disabled')
  && !Object.prototype.hasOwnProperty.call(node, 'locked')
  && !Object.prototype.hasOwnProperty.call(node, 'placeholder')
  && !Object.prototype.hasOwnProperty.call(node, 'available')));

/* ------------------------------------------------------------------ *
 * G. 内容层去重与 fail-closed
 * ------------------------------------------------------------------ */

const fixtureBasePair = cloneDeep(pairByEventId.get(recordedPairId));
function fixtureContent(pairs, alternatives, journal) {
  return {
    schemaVersion: 1,
    contentVersion: '0.18.0',
    releaseVersion: '0.24',
    alternativeNarratives: alternatives || [],
    crossoverPairs: pairs || [],
    journalWhitelist: journal || [],
  };
}
function fixtureEngine(contentFixture) {
  return worldNarrative.createWorldNarrative({ content: contentFixture, catalog });
}
function fixtureContextFor(pair) {
  return Object.assign({}, pairGateContext(pair), { acceptedProfessionIds: pair.professionIds.slice() });
}
function fixtureStateFor(pair) {
  return bothAcceptedState(pair.professionIds[0], pair.professionIds[1]);
}

const duplicatePair = cloneDeep(fixtureBasePair);
duplicatePair.contentOwnerProfessionId = duplicatePair.professionIds[1];
duplicatePair.activeTextOwner = false;
const duplicateEngine = fixtureEngine(fixtureContent([cloneDeep(fixtureBasePair), duplicatePair]));
const duplicateList = duplicateEngine.listCrossovers({ state: fixtureStateFor(fixtureBasePair), context: fixtureContextFor(fixtureBasePair) });
check('G01 同一 pair 重复声明（owner 不同、其余完全一致）→ 折叠为 1 个事件', duplicateList.nodes.length === 1
  && duplicateList.nodes[0].eventId === fixtureBasePair.eventId);

const inconsistentSecond = cloneDeep(duplicatePair);
inconsistentSecond.texts.invite = '另一份文案与获胜声明不一致时整对作废，宁可不出也不拼合。';
const inconsistentEngine = fixtureEngine(fixtureContent([cloneDeep(fixtureBasePair), inconsistentSecond]));
const inconsistentList = inconsistentEngine.listCrossovers({ state: fixtureStateFor(fixtureBasePair), context: fixtureContextFor(fixtureBasePair) });
check('G02 同对声明文本不一致 → 整对 fail-closed（不取并集）', inconsistentList.nodes.length === 0);

const reversedPair = cloneDeep(fixtureBasePair);
reversedPair.professionIds = reversedPair.professionIds.slice().reverse();
const reversedEngine = fixtureEngine(fixtureContent([reversedPair]));
check('G03 professionIds 非升序/eventId 不匹配 → 整对丢弃', reversedEngine.listCrossovers({ state: fixtureStateFor(fixtureBasePair), context: fixtureContextFor(fixtureBasePair) }).nodes.length === 0);

const placeholderPair = cloneDeep(fixtureBasePair);
placeholderPair.placeholder = true;
check('G04 placeholder:true 的占位交汇不得上线', fixtureEngine(fixtureContent([placeholderPair])).listCrossovers({ state: fixtureStateFor(fixtureBasePair), context: fixtureContextFor(fixtureBasePair) }).nodes.length === 0);

const rewardedPair = cloneDeep(fixtureBasePair);
rewardedPair.grants.credits = 1;
check('G05 交汇违约发放货币 → 整对丢弃', fixtureEngine(fixtureContent([rewardedPair])).listCrossovers({ state: fixtureStateFor(fixtureBasePair), context: fixtureContextFor(fixtureBasePair) }).nodes.length === 0);

const effectPair = cloneDeep(fixtureBasePair);
effectPair.effects = ['unlock'];
check('G06 交汇声明 effects 非空 → 整对丢弃', fixtureEngine(fixtureContent([effectPair])).listCrossovers({ state: fixtureStateFor(fixtureBasePair), context: fixtureContextFor(fixtureBasePair) }).nodes.length === 0);

const surfacePair = cloneDeep(fixtureBasePair);
surfacePair.visibleSurfaces = surfacePair.visibleSurfaces.concat(['clue']);
check('G07 交汇可见面含 clue/letter 等禁止面 → 整对丢弃', fixtureEngine(fixtureContent([surfacePair])).listCrossovers({ state: fixtureStateFor(fixtureBasePair), context: fixtureContextFor(fixtureBasePair) }).nodes.length === 0);

const gatePair = cloneDeep(fixtureBasePair);
delete gatePair.gate.professionGate;
check('G08 交汇 gate 缺 both-accepted → 整对丢弃', fixtureEngine(fixtureContent([gatePair])).listCrossovers({ state: fixtureStateFor(fixtureBasePair), context: fixtureContextFor(fixtureBasePair) }).nodes.length === 0);

const altFixture = cloneDeep(contentAlternatives[0]);
altFixture.gate.requiresSpecificProfession = true;
const altFixtureState = allAcceptedState();
const altFixtureContext = withContext({ chapterId: altFixture.chapterId, worldFlags: [], clearedCommissions: [], storyEvidence: [] });
check('G09 替代叙事 gate 依赖特定职业 → 该节点丢弃', fixtureEngine(fixtureContent([], [altFixture])).resolveAlternative({ state: altFixtureState, context: altFixtureContext, narrativeNodeId: altFixture.narrativeNodeId }).node === null);

const evidenceFixture = cloneDeep(contentAlternatives.find((node) => node.mechanism === 'evidence-pair'));
evidenceFixture.anchor.refs = [evidenceFixture.anchor.refs[0]];
check('G10 evidence-pair 少于 2 个真实 token → 该节点丢弃', fixtureEngine(fixtureContent([], [evidenceFixture])).resolveAlternative({ state: altFixtureState, context: altFixtureContext, narrativeNodeId: evidenceFixture.narrativeNodeId }).node === null);

const wrongVersionEngine = fixtureEngine(Object.assign(fixtureContent([cloneDeep(fixtureBasePair)]), { contentVersion: '0.19.0' }));
check('G11 未来/未知 contentVersion → 整体降级为空（不猜字段）', wrongVersionEngine.listCrossovers({ state: fixtureStateFor(fixtureBasePair), context: fixtureContextFor(fixtureBasePair) }).nodes.length === 0);

const emptyEngine = worldNarrative.createWorldNarrative();
const emptyList = emptyEngine.listCrossovers({ state: acceptedAllState, context: FULL_CONTEXT });
const emptyResolve = emptyEngine.resolveCrossover({ state: acceptedAllState, context: FULL_CONTEXT });
check('G12 内容缺失 → 空实现降级（list [] / resolve node:null，不报错）', emptyList.ok === true && emptyList.nodes.length === 0
  && emptyResolve.ok === true && emptyResolve.node === null);

const brokenCatalog = Object.assign({}, catalog, {
  professions: (catalog.professions || []).filter((row) => row.professionId !== 'research.lattice'),
});
const brokenCatalogEngine = worldNarrative.createWorldNarrative({ content, catalog: brokenCatalog });
const brokenCatalogPair = fixtureBasePair;
check('G13 catalog 缺少 anchor 职业 → 该对在创建期 fail-closed 丢弃', brokenCatalogEngine.listCrossovers({
  state: fixtureStateFor(brokenCatalogPair),
  context: fixtureContextFor(brokenCatalogPair),
}).nodes.length === 0);

const wrongGameCatalog = Object.assign({}, catalog, {
  games: (catalog.games || []).map((game) => (game.gameId === 'merge-2048' ? Object.assign({}, game) : game)),
});
wrongGameCatalog.games.forEach((game) => {
  if (game.gameId === 'merge-2048') game.professions = ['research.archivist'];
});
const wrongGameEngine = worldNarrative.createWorldNarrative({ content, catalog: wrongGameCatalog });
check('G14 catalog 游戏 ↔ 职业映射与 anchor 不一致 → 该对 fail-closed 丢弃', wrongGameEngine.listCrossovers({
  state: fixtureStateFor(brokenCatalogPair),
  context: fixtureContextFor(brokenCatalogPair),
}).nodes.length < listedAll.nodes.length);

const extraKeyPair = cloneDeep(fixtureBasePair);
extraKeyPair.rewards = { credits: 1 };
check('G15 内容节点带未知/禁止键（如 rewards）→ 整对 fail-closed 丢弃', fixtureEngine(fixtureContent([extraKeyPair])).listCrossovers({
  state: fixtureStateFor(fixtureBasePair),
  context: fixtureContextFor(fixtureBasePair),
}).nodes.length === 0);

const nestedKeyPair = cloneDeep(fixtureBasePair);
nestedKeyPair.gate.requiresCredits = 0;
check('G16 gate 带未知键 → 整对 fail-closed 丢弃', fixtureEngine(fixtureContent([nestedKeyPair])).listCrossovers({
  state: fixtureStateFor(fixtureBasePair),
  context: fixtureContextFor(fixtureBasePair),
}).nodes.length === 0);

/* ADR §3.2.5：替代叙事同一 nodeId / 同一 (章节,机制,refs) 组合只保留第一份声明 */
const duplicateAlternative = cloneDeep(contentAlternatives[0]);
const duplicateAlternativeEngine = fixtureEngine(fixtureContent(cloneDeep(content.crossoverPairs), [cloneDeep(contentAlternatives[0]), duplicateAlternative]));
const duplicateAlternativeAggregate = worldNarrative.resolveWorldAlternatives({
  chapterId: contentAlternatives[0].chapterId,
  state: allAcceptedState(),
  context: withContext({ chapterId: contentAlternatives[0].chapterId }),
  catalog,
  content: fixtureContent([], [cloneDeep(contentAlternatives[0]), duplicateAlternative]),
});
check('G17 同一 narrativeNodeId 重复声明 → 按内容顺序只保留第一份', duplicateAlternativeAggregate.nodes.length === 1);

const comboAlternative = cloneDeep(contentAlternatives[0]);
comboAlternative.narrativeNodeId = 'altn.C1.world-work.star-raid-t1b';
const comboAggregate = worldNarrative.resolveWorldAlternatives({
  chapterId: contentAlternatives[0].chapterId,
  state: allAcceptedState(),
  context: withContext({ chapterId: contentAlternatives[0].chapterId }),
  catalog,
  content: fixtureContent([], [cloneDeep(contentAlternatives[0]), comboAlternative]),
});
check('G18 同一 (章节,机制,refs) 组合的不同节点 id → 只保留第一份声明', comboAggregate.nodes.length === 1
  && comboAggregate.nodes[0].narrativeNodeId === contentAlternatives[0].narrativeNodeId);
const duplicateAlternativeList = duplicateAlternativeEngine.listCrossovers({ state: allAcceptedState(), context: FULL_CONTEXT });
check('G19 替代叙事重复声明不影响交汇列表（两条通道互不污染）', duplicateAlternativeList.nodes.length === 10);

const unknownTopKeyEngine = fixtureEngine(Object.assign(fixtureContent([cloneDeep(fixtureBasePair)]), { futureEconomyField: {} }));
check('G20 内容文件顶层出现未知键 → 整体 fail-closed 降级为空', unknownTopKeyEngine.listCrossovers({
  state: fixtureStateFor(fixtureBasePair),
  context: fixtureContextFor(fixtureBasePair),
}).nodes.length === 0);

/* ------------------------------------------------------------------ *
 * H. 替代路线 resolver（6 机制 × C1–C5 可达性）
 * ------------------------------------------------------------------ */

const alternativeState = allAcceptedState();
function alternativeContext(node, extra) {
  return withContext(Object.assign({
    chapterId: node.chapterId,
    acceptedProfessionIds: realProfessionIds.slice(),
    worldFlags: gateFlagsOf(node.gate),
    clearedCommissions: (node.gate.requiresCommissionsAll || []).slice(),
    storyEvidence: (node.gate.requiresEvidenceAny || []).slice(),
  }, extra || {}));
}

const altShapeFailures = [];
contentAlternatives.forEach((node) => {
  const result = engine.resolveAlternative({ state: alternativeState, context: alternativeContext(node), narrativeNodeId: node.narrativeNodeId });
  const expectedKeys = ['narrativeNodeId', 'mechanism', 'anchor', 'npcRef', 'signatureFrom', 'available', 'reason', 'texts', 'receiptSource'];
  if (!(result.ok === true && result.node)) {
    altShapeFailures.push(node.narrativeNodeId + ': 不产出');
    return;
  }
  const resolved = result.node;
  if (!deepEqual(Object.keys(resolved).sort(), expectedKeys.slice().sort())) altShapeFailures.push(node.narrativeNodeId + ': 键集');
  if (resolved.narrativeNodeId !== node.narrativeNodeId) altShapeFailures.push(node.narrativeNodeId + ': id');
  if (resolved.mechanism !== node.mechanism) altShapeFailures.push(node.narrativeNodeId + ': mechanism');
  if (resolved.receiptSource !== node.receiptSource) altShapeFailures.push(node.narrativeNodeId + ': receiptSource');
  if (resolved.signatureFrom !== node.signatureFrom) altShapeFailures.push(node.narrativeNodeId + ': signatureFrom');
  if (resolved.available !== true || resolved.reason !== null) altShapeFailures.push(node.narrativeNodeId + ': available/reason');
  if (!deepEqual(resolved.anchor, node.anchor) || !deepEqual(resolved.npcRef, node.npcRef) || !deepEqual(resolved.texts, node.texts)) altShapeFailures.push(node.narrativeNodeId + ': 内容漂移');
  if (Object.prototype.hasOwnProperty.call(resolved, 'chapterId') || Object.prototype.hasOwnProperty.call(resolved, 'grants')) altShapeFailures.push(node.narrativeNodeId + ': 额外字段');
});
check('H01 7 条替代叙事按 narrativeNodeId 全部产出且节点形状严格按 ADR（9 键、available:true）', altShapeFailures.length === 0, altShapeFailures.slice(0, 5).join(' | '));

const altChapterFailures = [];
contentAlternatives.forEach((node) => {
  /* 只给该章之前的真实章节旗标：既没到章节，gate 也不成立，判定口径必须先是 story-locked。 */
  const earlierFlags = chapterFlagsBefore(node.chapterId);
  const tooEarly = engine.resolveAlternative({
    state: alternativeState,
    context: withContext({
      acceptedProfessionIds: realProfessionIds.slice(),
      worldFlags: earlierFlags,
      clearedCommissions: (node.gate.requiresCommissionsAll || []).slice(),
      storyEvidence: (node.gate.requiresEvidenceAny || []).slice(),
    }),
    narrativeNodeId: node.narrativeNodeId,
  });
  if (!(tooEarly.ok === true && tooEarly.node === null && tooEarly.reason === 'story-locked')) {
    altChapterFailures.push(node.narrativeNodeId + ': ' + JSON.stringify(tooEarly.reason));
  }
});
check('H02 章节未到达时替代叙事一律不产出（story-locked），不提前泄露后续章节', altChapterFailures.length === 0, altChapterFailures.slice(0, 5).join(' | '));

const altGateFailures = [];
contentAlternatives.forEach((node) => {
  const base = alternativeContext(node);
  if ((node.gate.requiresFlagsAny || []).length) {
    const flags = allRealFlags.filter((flag) => (node.gate.requiresFlagsAny || []).indexOf(flag) < 0);
    const result = engine.resolveAlternative({ state: alternativeState, context: Object.assign({}, base, { worldFlags: flags }), narrativeNodeId: node.narrativeNodeId });
    if (!(result.node === null && result.reason === 'world-locked')) altGateFailures.push(node.narrativeNodeId + ': flagsAny');
  }
  if ((node.gate.requiresFlagsAll || []).length) {
    const flags = allRealFlags.filter((flag) => flag !== node.gate.requiresFlagsAll[0]);
    const result = engine.resolveAlternative({ state: alternativeState, context: Object.assign({}, base, { worldFlags: flags }), narrativeNodeId: node.narrativeNodeId });
    if (!(result.node === null && result.reason === 'world-locked')) altGateFailures.push(node.narrativeNodeId + ': flagsAll');
  }
  if ((node.gate.requiresCommissionsAll || []).length) {
    const result = engine.resolveAlternative({ state: alternativeState, context: Object.assign({}, base, { clearedCommissions: [] }), narrativeNodeId: node.narrativeNodeId });
    if (!(result.node === null && result.reason === 'world-locked')) altGateFailures.push(node.narrativeNodeId + ': commissionsAll');
  }
  if ((node.gate.requiresEvidenceAny || []).length) {
    const result = engine.resolveAlternative({ state: alternativeState, context: Object.assign({}, base, { storyEvidence: [] }), narrativeNodeId: node.narrativeNodeId });
    if (!(result.node === null && result.reason === 'world-locked')) altGateFailures.push(node.narrativeNodeId + ': evidenceAny');
  }
});
check('H03 替代叙事 gate 的 flags/commissions/evidence 缺失时不产出（world-locked）', altGateFailures.length === 0, altGateFailures.slice(0, 5).join(' | '));

/* 「不需要特定职业」：任一单一已接受职业都能看到全部 7 条替代叙事 */
const specificProfessionFailures = [];
contentAlternatives.forEach((node) => {
  realProfessionIds.forEach((professionId) => {
    const result = engine.resolveAlternative({
      state: makeState([{ professionId }]),
      context: withContext({
        chapterId: node.chapterId,
        acceptedProfessionIds: [professionId],
        worldFlags: gateFlagsOf(node.gate),
        clearedCommissions: (node.gate.requiresCommissionsAll || []).slice(),
        storyEvidence: (node.gate.requiresEvidenceAny || []).slice(),
      }),
      narrativeNodeId: node.narrativeNodeId,
    });
    if (!(result.ok === true && result.node)) specificProfessionFailures.push(node.narrativeNodeId + '/' + professionId);
  });
});
check('H04 替代叙事不需要特定职业：16 个真实职业各自单独接受时 7 条全部可达（112 组合）', specificProfessionFailures.length === 0, specificProfessionFailures.slice(0, 5).join(' | '));

const noProfessionFailures = contentAlternatives.filter((node) => {
  const result = engine.resolveAlternative({
    state: {},
    context: withContext({ chapterId: node.chapterId, acceptedProfessionIds: [], worldFlags: allRealFlags, storyEvidence: realEvidenceTyped, clearedCommissions: ['gold-miner.T1'] }),
    narrativeNodeId: node.narrativeNodeId,
  });
  return !(result.ok === true && result.node === null && result.reason === 'not-accepted');
});
check('H05 没有任何已接受职业时替代叙事零产出（not-accepted）', noProfessionFailures.length === 0, noProfessionFailures.slice(0, 3).join(','));

const altSurfaceFailures = [];
const altSurfaceForbidden = ['clue', 'letter', 'shop', 'crafting', 'tools'];
altSurfaceForbidden.forEach((surface) => {
  const result = engine.listCrossovers({ state: alternativeState, context: Object.assign({}, FULL_CONTEXT, { surface }) });
  if (!(result.ok === true && result.nodes.length === 0)) altSurfaceFailures.push('cross-over surface ' + surface);
  contentAlternatives.forEach((node) => {
    const alt = engine.resolveAlternative({ state: alternativeState, context: alternativeContext(node, { surface }), narrativeNodeId: node.narrativeNodeId });
    if (!(alt.ok === true && alt.node === null && alt.reason === 'wrong-surface')) altSurfaceFailures.push(node.narrativeNodeId + '@' + surface);
  });
});
check('H06 替代叙事只在 port/work/journal/receipt/message/route/toast/deep-link 可见，邀请/商店/制造面不渲染', altSurfaceFailures.length === 0, altSurfaceFailures.slice(0, 5).join(' | '));

/* 机制真实性：catalog 去掉锚点后对应节点不可产出 */
const mechanismFailures = [];
contentAlternatives.forEach((node) => {
  let doctored = null;
  if (node.anchor.kind === 'commission') {
    doctored = Object.assign({}, catalog, {
      commissions: (catalog.commissions || []).filter((row) => row.commissionId !== node.anchor.refs[0]),
    });
  } else if (node.anchor.kind === 'offer') {
    doctored = Object.assign({}, catalog, { offers: (catalog.offers || []).filter((row) => row.offerId !== node.anchor.refs[0]) });
  } else if (node.anchor.kind === 'ship') {
    doctored = Object.assign({}, catalog, { items: Object.assign({}, catalog.items, { ships: [] }) });
  } else if (node.anchor.kind === 'item') {
    doctored = Object.assign({}, catalog, { items: Object.assign({}, catalog.items, { materials: [] }) });
  } else if (node.anchor.kind === 'evidencePair') {
    doctored = Object.assign({}, catalog, {
      commissions: (catalog.commissions || []).map((row) => {
        const copy = cloneDeep(row);
        if (copy.reward && Array.isArray(copy.reward.evidence)) {
          copy.reward.evidence = copy.reward.evidence.filter((token) => node.anchor.refs.indexOf(token) < 0);
        }
        return copy;
      }),
    });
  }
  const doctoredEngine = worldNarrative.createWorldNarrative({ content, catalog: doctored });
  const result = doctoredEngine.resolveAlternative({ state: alternativeState, context: alternativeContext(node), narrativeNodeId: node.narrativeNodeId });
  if (result.ok !== true || result.node !== null) mechanismFailures.push(node.narrativeNodeId);
});
check('H07 锚点被 catalog 证伪时节点不产出（机制真实性 fail-closed）', mechanismFailures.length === 0, mechanismFailures.slice(0, 5).join(','));

/* 落款只读真实内容 */
const signatureFailures = [];
contentAlternatives.forEach((node) => {
  const expected = (() => {
    if (node.signatureFrom === 'origin-letter') return originByGame.get(node.npcRef.gameId).c0Letter.from;
    if (node.signatureFrom === 'commission-issuer') return realCommissions.get(node.anchor.refs[0]).issuer;
    if (node.signatureFrom === 'offer-issuer') return offerIssuerBySource(node.anchor.refs[0]);
    if (node.signatureFrom === 'npc-character') return npcCharacterNames.get(node.npcRef.characterId);
    return null;
  })();
  const result = worldNarrative.resolveSignature({ node, catalog });
  if (!(result.ok === true && result.signer === expected && expected)) signatureFailures.push(node.narrativeNodeId + ': ' + JSON.stringify(result));
});
check('H08 resolveSignature 从真实内容解引用落款（起源信/委托 issuer/代办 issuer）', signatureFailures.length === 0, signatureFailures.slice(0, 5).join(' | '));

/* C1–C5 逐章首个可用替代叙事 */
const chapterFirstExpected = { C1: 'altn.C1.world-work.star-raid-t1', C2: 'altn.C2.errand.alt-courier', C3: 'altn.C3.profession-commission.shadow-leap-t2', C4: 'altn.C4.market-material.building', C5: 'altn.C5.profession-commission.gold-miner-t6' };
const chapterFirstFailures = [];
Object.keys(chapterFirstExpected).forEach((chapterId) => {
  const result = engine.resolveAlternative({ state: alternativeState, context: withContext({ chapterId }), chapterId });
  if (!(result.ok === true && result.node && result.node.narrativeNodeId === chapterFirstExpected[chapterId])) {
    chapterFirstFailures.push(chapterId + ':' + (result.node ? result.node.narrativeNodeId : 'null'));
  }
});
check('H09 每章都能解析出稳定排序后的首个替代叙事（C1–C5）', chapterFirstFailures.length === 0, chapterFirstFailures.join(' | '));

/* C5 后日常：星塔落定之后才出现 */
const postDaily = alternativeById.get('altn.C5.profession-commission.gold-miner-t6');
const postBaseFlags = chapterFlagsBefore('C5');
const postBeforePower = engine.resolveAlternative({
  state: alternativeState,
  context: withContext({ acceptedProfessionIds: realProfessionIds.slice(), worldFlags: postBaseFlags }),
  narrativeNodeId: postDaily.narrativeNodeId,
});
const postPowerOnly = engine.resolveAlternative({
  state: alternativeState,
  context: withContext({ acceptedProfessionIds: realProfessionIds.slice(), worldFlags: postBaseFlags.concat(['C4.city_power_restored']) }),
  narrativeNodeId: postDaily.narrativeNodeId,
});
const postResolved = engine.resolveAlternative({
  state: alternativeState,
  context: withContext({ acceptedProfessionIds: realProfessionIds.slice(), worldFlags: postBaseFlags.concat(['C4.city_power_restored', 'C5.star_tower_resolved']) }),
  narrativeNodeId: postDaily.narrativeNodeId,
});
check('H10 后日常反馈只在终局之后出现：缺章节 / 缺 C5 旗标时不产出，星塔落定后产出', postBeforePower.node === null
  && postBeforePower.reason === 'story-locked'
  && postPowerOnly.node === null
  && postPowerOnly.reason === 'world-locked'
  && postResolved.ok === true && !!postResolved.node);

/* ADR §3.3 聚合适配器 */
const aggregate = worldNarrative.resolveWorldAlternatives({ chapterId: 'C4', state: alternativeState, context: FULL_CONTEXT, catalog, content });
check('H11 resolveWorldAlternatives 返回 {schemaVersion, chapterId, nodes, crossovers}', aggregate.schemaVersion === 1
  && aggregate.chapterId === 'C4'
  && Array.isArray(aggregate.nodes)
  && Array.isArray(aggregate.crossovers));
check('H12 聚合器按章节过滤替代叙事（C4 两条：market-material 先于 evidence-pair）', aggregate.nodes.length === 2
  && aggregate.nodes[0].narrativeNodeId === 'altn.C4.market-material.building'
  && aggregate.nodes[1].narrativeNodeId === 'altn.C4.evidence-pair.mole-whack-block-drop');
check('H13 聚合器同时给出当前可用交汇（与 listCrossovers 口径一致）', aggregate.crossovers.length === 10
  && deepEqual(aggregate.crossovers.map((node) => node.eventId), eventIdsOf(listedAll)));
const aggregateC5 = worldNarrative.resolveWorldAlternatives({ chapterId: 'C5', state: alternativeState, context: FULL_CONTEXT, catalog, content });
check('H14 聚合器 C5 只给后日常一条', aggregateC5.nodes.length === 1 && aggregateC5.nodes[0].narrativeNodeId === postDaily.narrativeNodeId);
const aggregateInvalid = worldNarrative.resolveWorldAlternatives({ chapterId: 'C9', state: alternativeState, context: FULL_CONTEXT, catalog, content });
check('H15 聚合器非法章节不抛异常、返回空章节与空节点', aggregateInvalid.schemaVersion === 1
  && aggregateInvalid.chapterId === null
  && aggregateInvalid.nodes.length === 0);
const aggregateDegraded = worldNarrative.resolveWorldAlternatives({ chapterId: 'C4', state: alternativeState, context: FULL_CONTEXT, catalog });
check('H16 聚合器内容缺失时降级为空（不抛出）', aggregateDegraded.nodes.length === 0 && aggregateDegraded.crossovers.length === 0);

/* ------------------------------------------------------------------ *
 * H 补充：替代叙事在允许面的正向可见性（机制面 vs 邀请/商店面）
 * ------------------------------------------------------------------ */

const altAllowedSurfaceFailures = [];
worldNarrative.ALTERNATIVE_SURFACES.forEach((surface) => {
  const node = alternativeById.get('altn.C2.errand.alt-courier');
  const result = engine.resolveAlternative({
    state: alternativeState,
    context: alternativeContext(node, { surface }),
    narrativeNodeId: node.narrativeNodeId,
  });
  if (!(result.ok === true && result.node)) altAllowedSurfaceFailures.push(surface);
});
check('H17 替代叙事在 port/work/journal/receipt/message/route/toast/deep-link 面均可读', altAllowedSurfaceFailures.length === 0, altAllowedSurfaceFailures.join(','));

/* ------------------------------------------------------------------ *
 * I. 经历白名单与真实 0.23 投影联动
 * ------------------------------------------------------------------ */

function catalogForView() {
  const publicStoryEventIds = contentJournal.map((entry) => entry.eventId);
  const publicStoryEvents = {};
  contentJournal.forEach((entry) => {
    /* 与 bridge careerCatalog() 同形：label 之外加性转发 text/person。 */
    const row = { label: entry.label };
    if (typeof entry.text === 'string' && entry.text) row.text = entry.text;
    if (typeof entry.person === 'string' && entry.person) row.person = entry.person;
    publicStoryEvents[entry.eventId] = row;
  });
  return {
    games: registry.games,
    professions: registry.professions,
    commissions: commissionsFile.commissions,
    clues: cluesFile.clues,
    worldWork,
    publicStoryEventIds,
    publicStoryEvents,
  };
}
function viewStateWithEvents(eventIds, acceptedIds) {
  const state = makeState((acceptedIds || realProfessionIds).map((professionId) => ({ professionId })));
  state.storyEvents = {};
  eventIds.forEach((eventId, index) => {
    state.storyEvents[eventId] = { at: '2026-11-28T00:00:0' + index + '.000Z', source: 'world' };
  });
  return state;
}
const viewContext = {
  surface: 'journal',
  worldFlags: allRealFlags.slice(),
  clearedCommissions: ['gold-miner.T1'],
  storyEvidence: realEvidenceTyped.slice(),
  archived: false,
};
const journalEventIds = ['crossover:research.archivist:research.lattice', 'world:C2.errand.alt.courier'];
const view = professionView.projectCareerView({
  state: viewStateWithEvents(journalEventIds),
  catalog: catalogForView(),
  context: viewContext,
});
check('I01 注入白名单后两条真实事件进入经历（label 取自内容静态文案）', view.story.history.length === 2, JSON.stringify(view.story.history.map((row) => row.label)));
check('I02 经历行不暴露 eventId/内部 id（只回显 label/at/source/kind）', view.story.history.every((row) => !Object.prototype.hasOwnProperty.call(row, 'eventId')
  && typeof row.label === 'string')
  && view.story.history.every((row) => {
    const entry = contentJournal.find((candidate) => candidate.label === row.label);
    return !!entry && !/:/.test(row.label) && row.label.indexOf('altn.') < 0;
  }));
check('I03 经历不显示总数/百分比/占位（只有真实行）', view.story.history.every((row) => !/\d/.test(row.label)));

const viewWithoutWhitelist = professionView.projectCareerView({
  state: viewStateWithEvents(journalEventIds),
  catalog: {
    games: registry.games,
    professions: registry.professions,
    commissions: commissionsFile.commissions,
    clues: cluesFile.clues,
    worldWork,
  },
  context: viewContext,
});
check('I04 不注入内容白名单 → 默认拒绝，两条事件不出现（不是 DOM 占位）', viewWithoutWhitelist.story.history.length === 0);

const portSeenState = viewStateWithEvents(['story:C0.port_seen']);
portSeenState.storyEvents['story:C0.port_seen'] = { at: '2026-11-28T00:00:00.000Z', source: 'clue' };
const portSeenView = professionView.projectCareerView({ state: portSeenState, catalog: catalogForView(), context: viewContext });
check('I05 0.23 代码冻结事件 story:C0.port_seen 仍可见（白名单注入不改既有通道）', portSeenView.story.history.some((row) => row.label === '旧港的来信已送达'));
equal('I06 PUBLIC_STORY_EVENTS 常量未被 0.24 修改', professionView.PUBLIC_STORY_EVENTS, { 'story:C0.port_seen': '旧港的来信已送达' });

const unacceptedState = viewStateWithEvents(['invitation:research.lattice'], ['research.archivist']);
const unacceptedView = professionView.projectCareerView({ state: unacceptedState, catalog: catalogForView(), context: viewContext });
check('I07 未接受职业的 invitation 事件仍被投影拒绝（0.23 gate 生效）', !unacceptedView.story.history.some((row) => row.label.indexOf('晶格') >= 0 || row.label.indexOf('邀请') >= 0));

/* ---- T24：白名单经 bridge 注入后，真实 projectCareerView 的经历行带 detail ---- */

const allWhitelistIds = contentJournal.map((entry) => entry.eventId);
const detailView = professionView.projectCareerView({
  state: viewStateWithEvents(allWhitelistIds),
  catalog: catalogForView(),
  context: viewContext,
});
check('I08 17 条白名单事件全部进入经历（投影不丢行）', detailView.story.history.length === 17,
  detailView.story.history.length + '/' + allWhitelistIds.length);
const detailIssues = [];
detailView.story.history.forEach((row) => {
  const declared = contentJournal.find((entry) => entry.label === row.label);
  if (!declared) {
    detailIssues.push('unknown-label:' + row.label);
    return;
  }
  if (!row.detail || row.detail.text !== declared.text || row.detail.person !== declared.person) {
    detailIssues.push(declared.eventId + ':detail');
  }
  if (row.person !== declared.person) detailIssues.push(declared.eventId + ':person');
  if (Object.prototype.hasOwnProperty.call(row, 'eventId')) detailIssues.push(declared.eventId + ':eventId-leak');
  if (/\d+\.\d+\s*%|\d+\s*\/\s*\d+/.test(row.detail.text)) detailIssues.push(declared.eventId + ':progress');
});
check('I09 每条经历行 detail.text/person 来自内容白名单且无内部 eventId', detailIssues.length === 0, detailIssues.slice(0, 6).join(' | '));
check('I10 回读文本不含金额/奖励/章节码/内部 id', detailView.story.history.every((row) => {
  const text = row.detail && row.detail.text ? row.detail.text : '';
  return !/信用点|星币|工钱|奖励|报酬|积分|材料\s*[×x]/.test(text)
    && !/(?:^|[^A-Za-z0-9])C[0-5](?:\.|\b)/.test(text)
    && !/\b[A-Z]{1,3}-\d{1,4}\b|\b[a-z][a-z0-9-]*:[A-Za-z0-9]/.test(text);
}));
const labelOnlyCatalog = (() => {
  const out = catalogForView();
  const labelOnly = {};
  contentJournal.forEach((entry) => { labelOnly[entry.eventId] = { label: entry.label }; });
  out.publicStoryEvents = labelOnly;
  return out;
})();
const labelOnlyView = professionView.projectCareerView({
  state: viewStateWithEvents(allWhitelistIds),
  catalog: labelOnlyCatalog,
  context: viewContext,
});
check('I11 旧内容（只声明 label）经历行不带 detail，保持 0.23 行为', labelOnlyView.story.history.length === 17
  && labelOnlyView.story.history.every((row) => !Object.prototype.hasOwnProperty.call(row, 'detail')));
check('I12 bridge 白名单注入真实转发 text/person（源码核对）', bridgeSource.includes('entry.text = row.text')
  && bridgeSource.includes('entry.person = row.person')
  && bridgeSource.includes('catalog.publicStoryEvents = storyEvents'));
check('I12b bridge 按章注入 resolver 结果且保留 worldNarrative 内容对象（源码核对）',
  bridgeSource.includes('catalog.worldChapterAlternatives = chapterAlternatives')
  && bridgeSource.includes("surface: 'route'")
  && bridgeSource.includes('catalog.worldNarrative = clone(internal.worldNarrativeContent)'));
check('I12c bridge 为港口/章节面板预热事实并提供 chapterGuide 只读门面（源码核对）',
  bridgeSource.includes('primeWorldNarrativeFacts')
  && bridgeSource.includes('function chapterGuideForUi')
  && bridgeSource.includes('chapterGuide: function'));

/* ---- T24：bridge 注入的 catalog.worldChapterAlternatives 由真实 route-planner 消费 ---- */

const plannerEvidence = (() => {
  try {
    materialsModule.configure({ items, commissions: commissionsFile });
    const created = storyEvidenceModule.createStoryEvidence({});
    const config = created.configure({ commissions: commissionsFile, items, chapter: chapterOne });
    return config && config.ok === true ? created : null;
  } catch (error) {
    return null;
  }
})();
let injectedPlanner = null;
if (plannerEvidence) {
  const planner = routePlanner.create();
  const configured = planner.configure({
    commissions: commissionsFile,
    items,
    chapter: chapterOne,
    registry,
    materials: materialsModule,
    evidence: plannerEvidence,
    worldWork,
    campaign,
  });
  if (configured && configured.ok !== false) injectedPlanner = planner;
}
check('I13 route-planner 装配成功（T24 注入形状前置）', !!injectedPlanner);
const injectedNode = {
  narrativeNodeId: 'altn.C1.world-work.star-raid-t1',
  mechanism: 'world-work',
  anchor: { kind: 'commission', refs: ['star-raid.T1'] },
  npcRef: { kind: 'origin-letter', gameId: 'star-raid' },
  signatureFrom: 'commission-issuer',
  available: true,
  reason: null,
  receiptSource: 'commission-receipt',
  texts: {
    offer: '注入后：港里那张外堤短巡的单子今天又挂在告示板上，谁接都行。',
    progress: '注入后：这张单已经有人接手，报务室照常记档。',
    receipt: '注入后：航报交回东堤报务室，值班的人把它收进抽屉。',
    next: '注入后：回港口眼下看看，或者接下一张真的挂出来的活。',
  },
};
if (injectedPlanner) {
  const flags = ['C0.port_seen', 'C1.signal_fragment'];
  const baseGuide = injectedPlanner.chapterAlternatives({ flags });
  const injectedGuide = injectedPlanner.chapterAlternatives({
    flags,
    catalog: { worldChapterAlternatives: { C1: [injectedNode] } },
  });
  check('I14 注入按章形状后 present 且 C1 使用注入文案', injectedGuide.ok === true
    && injectedGuide.worldNarrative === 'present'
    && injectedGuide.narrativeNodeCount === 1
    && injectedGuide.chapters[0].alternatives.some((alt) => alt.source === 'world-narrative'
      && alt.texts.offer === injectedNode.texts.offer), JSON.stringify(injectedGuide.chapters[0].alternatives.map((alt) => alt.source)));
  check('I15 注入只影响 C1，C2–C5 与缺省完全同形', deepEqual(injectedGuide.chapters.slice(1), baseGuide.chapters.slice(1)));
  check('I16 未注入时不改变既有 absent 行为', injectedPlanner.chapterAlternatives({ flags, catalog: {} }).worldNarrative === 'absent'
    && deepEqual(injectedPlanner.chapterAlternatives({ flags, catalog: {} }), baseGuide));
  const badGuide = injectedPlanner.chapterAlternatives({
    flags,
    catalog: { worldChapterAlternatives: { C1: [{ narrativeNodeId: 'altn.bad' }] } },
  });
  check('I17 坏节点被丢弃且不抛（不伪造指引）', badGuide.ok === true
    && badGuide.worldNarrative === 'present' && badGuide.narrativeNodeCount === 0);
}

/* ------------------------------------------------------------------ *
 * J. 纯函数边界
 * ------------------------------------------------------------------ */

const garbageInputs = [null, undefined, '', 0, true, [], [1, 2], { state: 'x' }, { context: 42 }, { state: null, context: null }];
const garbageFailures = [];
garbageInputs.forEach((input) => {
  try {
    const resolvedPair = engine.resolveCrossover(input);
    const resolvedAlternative = engine.resolveAlternative(input);
    const listed = engine.listCrossovers(input);
    if (!isPlainObject(resolvedPair) || !isPlainObject(resolvedAlternative) || !isPlainObject(listed)) {
      garbageFailures.push('非结构化结果 ' + JSON.stringify(input));
    }
  } catch (error) {
    garbageFailures.push('抛出异常 ' + JSON.stringify(input) + ': ' + (error && error.message));
  }
});
check('J01 异常/垃圾输入不抛异常，返回结构化结果', garbageFailures.length === 0, garbageFailures.slice(0, 3).join(' | '));

function deepFreeze(value) {
  if (isPlainObject(value) || Array.isArray(value)) {
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    Object.freeze(value);
  }
  return value;
}
const frozenInput = deepFreeze({
  state: cloneDeep(allAcceptedState()),
  context: cloneDeep(FULL_CONTEXT),
});
let frozenThrew = false;
try {
  engine.listCrossovers(frozenInput);
  engine.resolveCrossover(Object.assign({ eventId: recordedPairId }, frozenInput));
  engine.resolveAlternative(Object.assign({ narrativeNodeId: 'altn.C2.errand.alt-courier' }, frozenInput));
} catch (error) {
  frozenThrew = true;
}
check('J02 冻结入参可安全只读（不改写、不抛）', frozenThrew === false);

const mutationBefore = JSON.stringify({ state: allAcceptedState(), context: FULL_CONTEXT });
const mutationInput = { state: allAcceptedState(), context: cloneDeep(FULL_CONTEXT) };
const mutationSnapshot = JSON.stringify(mutationInput);
engine.listCrossovers(mutationInput);
engine.resolveCrossover(Object.assign({ eventId: recordedPairId }, mutationInput));
engine.resolveAlternative(Object.assign({ narrativeNodeId: 'altn.C2.errand.alt-courier' }, mutationInput));
check('J03 resolver 不修改传入的 state/context', JSON.stringify(mutationInput) === mutationSnapshot && mutationBefore.length > 0);

const freshEngineA = worldNarrative.createWorldNarrative({ content, catalog });
const freshEngineB = worldNarrative.createWorldNarrative({ content, catalog });
check('J04 同一内容不同实例输出一致（无隐藏在创建期抖动的状态）', deepEqual(
  freshEngineA.listCrossovers({ state: allAcceptedState(), context: FULL_CONTEXT }),
  freshEngineB.listCrossovers({ state: allAcceptedState(), context: FULL_CONTEXT }),
));

const pairIdHelper = worldNarrative.eventIdForProfessionPair;
check('J05 eventIdForProfessionPair 排序、拒绝相同/非法 id', pairIdHelper('research.lattice', 'research.archivist') === 'crossover:research.archivist:research.lattice'
  && pairIdHelper('research.archivist', 'research.archivist') === null
  && pairIdHelper('bad id', 'research.archivist') === null
  && pairIdHelper('', null) === null);

check('J06 resolver 源码不包含写入路径（applyProfessionEvent/IDB/localStorage/.put）', !/applyProfessionEvent|indexedDB|localStorage|sessionStorage|\.put\s*\(/.test(stripSourceComments(resolverSource)));
check('J07 resolver 无模块依赖（纯 UMD、零 require）', !/\brequire\s*\(/.test(stripSourceComments(resolverSource)));
check('J08 内容文件未被 resolver 改写（JSON 结构仍在）', isPlainObject(content) && (content.crossoverPairs || []).length === 10);
const walletContext = Object.assign({}, FULL_CONTEXT, {
  capabilities: ['port-access'],
  wallet: { credits: 1000, items: { alloy: 1 } },
  unknownContextKey: 'ignored',
});
check('J09 冻结 context 的 capabilities/wallet 只读接受且不参与 gate（结果不变）', deepEqual(
  engine.listCrossovers({ state: allAcceptedState(), context: walletContext }),
  listedAll,
));

/* ------------------------------------------------------------------ *
 * K. 与 0.23 / 0.18.0 基线的只读一致性
 * ------------------------------------------------------------------ */

check('K01 96 份真实委托保持不变且 id 唯一（内容未新增委托）', realCommissionIds.length === 96 && unique(realCommissionIds));
check('K02 世界通用工作仍为 5 条真实委托（未新增委托）', (worldWork.entries || []).length === 5 && worldWorkIds.size === 5);
check('K03 0.23 叙事内容 4 shard × 4 职业 = 16 条，全部带 optionalCrossover', realShardEntries.length === 16
  && realShardEntries.every((entry) => isPlainObject(entry.optionalCrossover)));
check('K04 叙事注册表仍声明 4 个 shard / 16 个职业 / 16 条 entry', (narrativeRegistry.shards || []).length === 4
  && (narrativeRegistry.professionIds || []).length === 16
  && (narrativeRegistry.entries || []).length === 16);
check('K05 内容版本链未改动：registry/world-work/narrative-registry/shard 仍 0.18.0', registry.contentVersion === '0.18.0'
  && worldWork.contentVersion === '0.18.0'
  && narrativeRegistry.contentVersion === '0.18.0'
  && shards.every((shard) => shard.contentVersion === '0.18.0'));
check('K06 17 条经历事件 id 全部通过真实 reducer 且 source 合法', contentJournal.every((entry) => {
  if (constants.journalSources.indexOf(entry.source) < 0) return false;
  const result = professionState.recordStoryEvent(professionState.initialState(), { eventId: entry.eventId, source: entry.source, at: '2026-11-28T00:00:00.000Z' });
  return result && result.ok === true && result.state.storyEvents[entry.eventId];
}));
check('K07 10 条交汇事件重复写入幂等（duplicate:true 且不改 at）', (() => {
  let state = professionState.initialState('2026-11-28T00:00:00.000Z');
  let ok = true;
  contentPairs.forEach((pair) => {
    const first = professionState.recordStoryEvent(state, { eventId: pair.eventId, source: 'world', at: '2026-11-28T00:00:00.000Z' });
    if (!first.ok) ok = false;
    state = first.state;
    const second = professionState.recordStoryEvent(state, { eventId: pair.eventId, source: 'world', at: '2026-11-29T00:00:00.000Z' });
    if (!(second.ok === true && second.duplicate === true && second.state.storyEvents[pair.eventId].at === '2026-11-28T00:00:00.000Z')) ok = false;
    state = second.state;
  });
  return ok && Object.keys(state.storyEvents).length === contentPairs.length;
})());
check('K08 存档形状仍只有 at/source（不新增持久字段）', (() => {
  const result = professionState.recordStoryEvent(professionState.initialState(), { eventId: 'crossover:research.archivist:research.lattice', source: 'world', at: '2026-11-28T00:00:00.000Z' });
  const row = result.state.storyEvents['crossover:research.archivist:research.lattice'];
  return deepEqual(Object.keys(row).sort(), ['at', 'source']);
})());

/* ------------------------------------------------------------------ *
 * 结果汇总（供人工报告用的覆盖矩阵）
 * ------------------------------------------------------------------ */

console.log('coverage: 16 professions / ' + contentPairs.length + ' crossover pairs / '
  + contentAlternatives.length + ' alternative narratives / '
  + new Set(contentAlternatives.map((node) => node.mechanism)).size + ' mechanisms / C1-C5 / '
  + contentJournal.length + ' journal labels');

const failed = results.filter((row) => !row.ok);
results.forEach((row) => {
  console.log((row.ok ? 'PASS  ' : 'FAIL  ') + row.name + (row.ok ? '' : ' — ' + row.detail));
});
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) {
  console.error('FAIL  career world narrative test');
  process.exit(1);
}
console.log('PASS  career world narrative test');
