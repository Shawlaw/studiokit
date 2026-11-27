#!/usr/bin/env node
/**
 * Arcade 0.24 T20 世界叙事契约门禁（纯 Node、零依赖、不启动 Chrome、不写仓库）。
 *
 * 运行：node tools/career_world_narrative_contract_test.mjs
 * 退出码：0 = 全 PASS；1 = 有 FAIL；2 = 装配失败。
 *
 * 校验对象：docs/arcade-life/ADR-0.24-world.md 的机器可读契约
 * tools/career_world_narrative_schema.json，以及它必须复用的真实内容与真实运行时：
 * - schema 自洽：$ref 可解析、required ⊆ properties、pattern 可编译、object 闭合；
 * - 真实锚点：契约声明的每个来源文件都存在，且引用的 professionId / gameId /
 *   commissionId / offerId / shipId / itemId / 证据 token / 人物引用都能在真实内容里找到；
 * - 16 职业覆盖：契约样例与真实 registry、0.23 narrative shard 的 optionalCrossover 一一对应；
 * - 交汇触发：双方都已接受才可见，任一侧未接受/未读/未发现 → 零节点，paused 不拦截；
 * - 去重：16 条声明折叠成 10 个事件，owner 规则确定、同对文本一致、eventId 通过真实 reducer；
 * - 经历白名单：默认拒绝、代码冻结/内容/引擎前缀三层、未知 namespace 不显示、排序真实；
 * - 文本卫生：样例一律占位、无私有路径、无完整路线攻略词、不泄露真实职业展示名；
 * - 兼容边界：不新增 IDB store/key、contentVersion 仍 0.18.0、event 行仍只有 at/source。
 *
 * 本测试只读真实内容并做纯逻辑模拟，不改任何 runtime / 内容 JSON / 版本链。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);

const SCHEMA_REL = 'tools/career_world_narrative_schema.json';
const ADR_REL = 'docs/arcade-life/ADR-0.24-world.md';
const CONTENT_REL = 'apps/arcade/career/content';

/* ------------------------------------------------------------------ *
 * 结果收集
 * ------------------------------------------------------------------ */

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? '' : detail === undefined ? '' : String(detail).slice(0, 400) });
  return !!ok;
}
function equal(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  return check(name, a === e, 'expected ' + e + ' got ' + a);
}
function unique(values) {
  return new Set(values).size === values.length;
}
function hanCount(text) {
  return (String(text).match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
}
function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}
function readJson(relPath) {
  return JSON.parse(readText(relPath));
}
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function walkStrings(value, prefix = '', out = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, prefix + '[' + index + ']', out));
  } else if (isPlainObject(value)) {
    Object.keys(value).forEach((key) => walkStrings(value[key], prefix ? prefix + '.' + key : key, out));
  } else if (typeof value === 'string') {
    out.push([prefix, value]);
  }
  return out;
}
function canonicalize(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (isPlainObject(value)) {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalize(value[key])).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}
function deepEqual(a, b) {
  return canonicalize(a) === canonicalize(b);
}

/* ------------------------------------------------------------------ *
 * JSON Schema 子集校验器（够用即可：type/enum/const/pattern/长度/
 * items/minItems/maxItems/uniqueItems/properties/required/
 * additionalProperties/allOf/anyOf/oneOf/$ref）
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
    if (schema.uniqueItems === true) {
      const seen = new Set();
      value.forEach((item, index) => {
        const key = canonicalize(item);
        if (seen.has(key)) errors.push(trail + '[' + index + ']: duplicate item');
        seen.add(key);
      });
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
      if (schema.additionalProperties === false) {
        errors.push(trail + ': unexpected property ' + key);
      } else if (isPlainObject(schema.additionalProperties)) {
        validate(doc, schema.additionalProperties, value[key], trail + '.' + key, errors);
      }
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
let adrText;
let registry;
let commissions;
let worldWork;
let chapterOne;
let campaign;
let npc;
let items;
let narrativeRegistry;
let shards;
let professionState;
let professionView;
try {
  contract = readJson(SCHEMA_REL);
  adrText = readText(ADR_REL);
  registry = readJson(CONTENT_REL + '/registry.json');
  commissions = readJson(CONTENT_REL + '/commissions.json');
  worldWork = readJson(CONTENT_REL + '/world-work.json');
  chapterOne = readJson(CONTENT_REL + '/chapter-01.json');
  campaign = readJson(CONTENT_REL + '/campaign.json');
  npc = readJson(CONTENT_REL + '/npc.json');
  items = readJson(CONTENT_REL + '/items.json');
  narrativeRegistry = readJson(CONTENT_REL + '/narrative-registry.json');
  shards = [1, 2, 3, 4].map((index) => readJson(CONTENT_REL + '/narrative-shards/shard-0' + index + '.json'));
  professionState = require(path.join(ROOT, 'apps/arcade/career/profession-state.js'));
  professionView = require(path.join(ROOT, 'apps/arcade/career/profession-view.js'));
} catch (error) {
  console.error('FAIL 装配失败: ' + (error && error.message ? error.message : String(error)));
  process.exit(2);
}

const constants = contract.constants || {};
const samples = contract.samples || {};
const altSamples = Array.isArray(samples.alternativeNarrative) ? samples.alternativeNarrative : [];
const crossoverSamples = Array.isArray(samples.crossover) ? samples.crossover : [];
const journalSamples = Array.isArray(samples.journalEvents) ? samples.journalEvents : [];

const realGames = new Map((registry.games || []).map((game) => [game.gameId, game]));
const realProfessions = new Map((registry.professions || []).map((profession) => [profession.professionId, profession]));
const realProfessionIds = Array.from(realProfessions.keys()).sort();
const realDisplayNames = Array.from(realProfessions.values()).map((profession) => profession.displayName);
const realCommissions = new Map((commissions.commissions || []).map((row) => [row.commissionId, row]));
const realCommissionIds = Array.from(realCommissions.keys());
const realEvidence = new Set();
realCommissions.forEach((row) => {
  ((row.reward && row.reward.evidence) || []).forEach((token) => realEvidence.add(token));
});
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
  if (chapterOne.c1 && Array.isArray(chapterOne.c1.signals)) {
    chapterOne.c1.signals.forEach((signal) => {
      addText(signal.flag);
      addText(signal.mapsTo);
      (signal.from || []).forEach(addText);
    });
  }
})();
const worldWorkIds = new Set(Array.isArray(worldWork.commissionIds) ? worldWork.commissionIds : []);
const originGames = new Map((chapterOne.origins || []).map((origin) => [origin.gameId, origin]));
const npcCharacterIds = new Set((npc.characters || []).map((character) => character.characterId));
const rentalShipIds = new Set((items.ships || []).filter((ship) => ship.rental === true).map((ship) => ship.shipId));
const materialIds = new Set((items.materials || []).map((material) => material.itemId));
const campaignChapters = new Map((campaign.chapters || []).map((chapter) => [chapter.chapterId, chapter]));
const alternativesSource = readText('apps/arcade/career/alternatives.js');

/* ------------------------------------------------------------------ *
 * A. 契约文档自洽
 * ------------------------------------------------------------------ */

equal('schemaId 稳定', contract.schemaId, 'career.world-narrative');
equal('schemaVersion', contract.schemaVersion, '1.0.0');
equal('releaseVersion 为 0.24（不写 0.24.0 版本链）', contract.releaseVersion, '0.24');
equal('contentVersion 仍 0.18.0', contract.contentVersion, '0.18.0');
equal('状态为冻结', contract.status, 'FROZEN_FOR_T21_T23');
equal('runtimeBehavior 为 none（本任务不改 runtime）', contract.runtimeBehavior, 'none');
check('ADR 与契约测试路径指向真实文件', contract.adr === ADR_REL && contract.contractTest === 'tools/career_world_narrative_contract_test.mjs', { adr: contract.adr, test: contract.contractTest });
check('契约测试命令与本次运行一致', contract.contractTestCommand === 'node tools/career_world_narrative_contract_test.mjs', contract.contractTestCommand);
check('contentLayout 只声明未来内容文件且为同源相对路径', isPlainObject(contract.contentLayout)
  && contract.contentLayout.file === 'apps/arcade/career/content/world-narrative.json'
  && contract.contentLayout.contentVersion === '0.18.0'
  && contract.contentLayout.schemaVersion === 1
  && contract.contentLayout.optionalWhenMissing === true
  && !path.posix.isAbsolute(contract.contentLayout.file)
  && !contract.contentLayout.file.includes('\\')
  && !contract.contentLayout.file.includes('..'), JSON.stringify(contract.contentLayout));
check('契约不声称已创建 0.24 内容文件（createInTask 为 T21/T22）', contract.contentLayout.createInTask === 'T21/T22');
check('handoff 覆盖 T21/T22/T23/lead 四方', isPlainObject(contract.handoff)
  && ['T21', 'T22', 'T23', 'lead'].every((key) => typeof contract.handoff[key] === 'string' && contract.handoff[key].length > 10), JSON.stringify(Object.keys(contract.handoff || {})));

/* ---- 真实锚点文件 ---- */

const sourceOfTruth = Array.isArray(contract.sourceOfTruth) ? contract.sourceOfTruth : [];
check('sourceOfTruth 至少 10 个真实来源', sourceOfTruth.length >= 10, sourceOfTruth.length);
const badSourcePath = sourceOfTruth.filter((rel) => typeof rel !== 'string'
  || path.posix.isAbsolute(rel)
  || rel.includes('\\')
  || rel.includes('..')
  || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(rel)
  || !fs.existsSync(path.join(ROOT, rel))
  || !fs.statSync(path.join(ROOT, rel)).isFile());
check('sourceOfTruth 全是同源相对路径且真实存在', badSourcePath.length === 0, badSourcePath.join(', '));
check('sourceOfTruth 覆盖 ADR 依据的运行时与内容', ['apps/arcade/career/profession-state.js', 'apps/arcade/career/profession-view.js', 'apps/arcade/career/route-planner.js', 'apps/arcade/career/story-evidence.js', 'apps/arcade/career/alternatives.js', 'apps/arcade/career/content/world-work.json', 'apps/arcade/career/content/campaign.json'].every((rel) => sourceOfTruth.includes(rel)), sourceOfTruth.join(','));

/* ------------------------------------------------------------------ *
 * B. schema 自洽（$ref / required / pattern / 闭合）
 * ------------------------------------------------------------------ */

const schemaNames = Object.keys(contract.schemas || {});
check('schemas 集合固定为 10 个定义', schemaNames.length === 10, schemaNames.join(','));
equal('schemas 名称冻结', schemaNames.slice().sort(), [
  'alternativeGate', 'alternativeNarrativeNode', 'alternativeTextBlock', 'crossoverGate',
  'crossoverPair', 'journalEvent', 'npcRef', 'resolverInput', 'resolverOutput', 'textBlock',
]);

const schemaIssues = [];
function inspectSchema(node, trail) {
  if (Array.isArray(node)) {
    node.forEach((child, index) => inspectSchema(child, trail + '[' + index + ']'));
    return;
  }
  if (!isPlainObject(node)) return;
  if (typeof node.$ref === 'string') {
    if (!resolvePointer(contract, node.$ref)) schemaIssues.push(trail + ': unresolved $ref ' + node.$ref);
  }
  if (typeof node.pattern === 'string') {
    try {
      new RegExp(node.pattern);
    } catch (error) {
      schemaIssues.push(trail + ': bad pattern ' + node.pattern);
    }
  }
  if (Array.isArray(node.enum)) {
    if (!node.enum.length) schemaIssues.push(trail + ': empty enum');
    if (!unique(node.enum.map((value) => canonicalize(value)))) schemaIssues.push(trail + ': duplicate enum');
  }
  if (node.type === 'object' && Array.isArray(node.required)) {
    const props = isPlainObject(node.properties) ? Object.keys(node.properties) : [];
    node.required.forEach((key) => {
      if (!props.includes(key)) schemaIssues.push(trail + ': required not in properties -> ' + key);
    });
    if (!props.length) schemaIssues.push(trail + ': required without properties');
  }
  if (node.type === 'object' && isPlainObject(node.properties) && trail.indexOf('resolverInput') < 0 && node.additionalProperties !== false) {
    schemaIssues.push(trail + ': object should be closed (additionalProperties:false)');
  }
  Object.keys(node).forEach((key) => {
    if (key === 'enum' || key === 'const' || key === 'pattern' || key === 'required' || key === 'type') return;
    inspectSchema(node[key], trail + '.' + key);
  });
}
schemaNames.forEach((name) => inspectSchema(contract.schemas[name], 'schemas.' + name));
check('每个 schema 内部自洽（$ref 可解析、pattern 可编译、required ⊆ properties、内容对象闭合）', schemaIssues.length === 0, schemaIssues.slice(0, 6).join(' | '));
check('每个 schema 都有 type 或 $ref', schemaNames.every((name) => {
  const schema = contract.schemas[name];
  return isPlainObject(schema) && (typeof schema.type === 'string' || typeof schema.$ref === 'string');
}));
check('variantRules 可读且引用存在的 schema', Array.isArray(contract.variantRules)
  && contract.variantRules.length === 2
  && contract.variantRules.every((rule) => isPlainObject(rule)
    && contract.schemas[rule.schema]
    && typeof rule.field === 'string'
    && typeof rule.when === 'string'
    && Array.isArray(rule.require)
    && Array.isArray(rule.forbid)), JSON.stringify(contract.variantRules));

/* ---- 样例必须通过对应 schema ---- */

const sampleIssues = [];
const sampleKindSchema = {
  crossoverPair: 'crossoverPair',
  alternativeNarrativeNode: 'alternativeNarrativeNode',
  journalEvent: 'journalEvent',
};
function validateSample(bucket, sample, index) {
  const schemaName = sampleKindSchema[sample && sample.sampleKind];
  const where = bucket + '[' + index + ']';
  if (!schemaName) {
    sampleIssues.push(where + ': unknown sampleKind ' + (sample && sample.sampleKind));
    return;
  }
  const errors = validate(contract, contract.schemas[schemaName], sample, where);
  sampleIssues.push(...errors);
  const rules = Array.isArray(contract.schemas[schemaName].conditionalRules) ? contract.schemas[schemaName].conditionalRules : [];
  rules.forEach((rule) => {
    const matched = Object.keys(rule.when || {}).every((key) => deepEqual(rule.when[key], sample[key]));
    if (!matched) return;
    (rule.require || []).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(sample, key)) sampleIssues.push(where + ': rule requires ' + key);
    });
    (rule.forbid || []).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(sample, key)) sampleIssues.push(where + ': rule forbids ' + key);
    });
    if (rule.textKind === 'placeholder-prefixed' && sample.placeholder === true) {
      (rule.require || []).forEach((key) => {
        if (typeof sample[key] === 'string' && !/^占位[:：]/.test(sample[key])) sampleIssues.push(where + ': placeholder text must start with 占位 -> ' + key);
      });
    }
  });
}
altSamples.forEach((sample, index) => validateSample('alternativeNarrative', sample, index));
crossoverSamples.forEach((sample, index) => validateSample('crossover', sample, index));
journalSamples.forEach((sample, index) => validateSample('journalEvents', sample, index));
check('27 条样例全部通过对应 schema 与条件规则', sampleIssues.length === 0, sampleIssues.slice(0, 6).join(' | '));

/* ---- npcRef variantRules 逐条 ---- */

const npcIssues = [];
function checkNpcRef(ref, where) {
  if (!isPlainObject(ref)) {
    npcIssues.push(where + ': not object');
    return;
  }
  const rule = (contract.variantRules || []).find((candidate) => candidate.field === 'kind' && candidate.when === ref.kind);
  if (!rule) {
    npcIssues.push(where + ': unknown kind ' + ref.kind);
    return;
  }
  rule.require.forEach((key) => {
    if (typeof ref[key] !== 'string' || !ref[key]) npcIssues.push(where + ': missing ' + key);
  });
  rule.forbid.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(ref, key)) npcIssues.push(where + ': forbidden ' + key);
  });
  if (ref.kind === 'origin-letter') {
    const origin = originGames.get(ref.gameId);
    if (!origin) npcIssues.push(where + ': gameId 不是真实起源 -> ' + ref.gameId);
  }
  if (ref.kind === 'character' && !npcCharacterIds.has(ref.characterId)) {
    npcIssues.push(where + ': characterId 不是真实 NPC -> ' + ref.characterId);
  }
}
altSamples.forEach((sample) => checkNpcRef(sample.npcRef, 'alternativeNarrative:' + sample.narrativeNodeId));
crossoverSamples.forEach((sample) => (sample.anchor.npcRefs || []).forEach((ref, index) => checkNpcRef(ref, 'crossover:' + sample.eventId + '#' + index)));
check('全部 npcRef 符合 variantRules 且指向真实起源信/真实 NPC', npcIssues.length === 0, npcIssues.slice(0, 6).join(' | '));

/* ------------------------------------------------------------------ *
 * C. 16 职业覆盖矩阵
 * ------------------------------------------------------------------ */

check('真实 registry 当前 16 职业 16 游戏（0.24 验收快照）', realProfessionIds.length === 16 && realGames.size === 16, realProfessionIds.length + '/' + realGames.size);
check('registry 职业与游戏互映射且 gameId 唯一', Array.from(realProfessions.keys()).every((professionId) => {
  const games = Array.from(realGames.values()).filter((game) => (game.professions || []).includes(professionId));
  return games.length === 1;
}), 'profession-game mapping');

equal('coverageMatrix.professionCount 与真实 registry 一致', contract.coverageMatrix.professionCount, realProfessionIds.length);
equal('crossover 样例数 = 职业数', crossoverSamples.length, contract.coverageMatrix.crossoverSamples);
check('crossover 样例 16 条且覆盖全部真实职业', crossoverSamples.length === 16
  && new Set(crossoverSamples.map((sample) => sample.contentOwnerProfessionId)).size === 16
  && crossoverSamples.every((sample) => realProfessions.has(sample.contentOwnerProfessionId))
  && unique(crossoverSamples.map((sample) => sample.contentOwnerProfessionId)), crossoverSamples.map((sample) => sample.contentOwnerProfessionId).join(','));
equal('每个职业至少出现在一条交汇声明中', realProfessionIds.filter((professionId) => !crossoverSamples.some((sample) => sample.professionIds.includes(professionId))).length, 0);

const pairIssues = [];
crossoverSamples.forEach((sample) => {
  const ids = sample.professionIds;
  const where = 'crossover:' + sample.contentOwnerProfessionId;
  if (!Array.isArray(ids) || ids.length !== 2) pairIssues.push(where + ': professionIds 必须恰 2');
  if (!deepEqual(ids, ids.slice().sort())) pairIssues.push(where + ': professionIds 必须字典序升序');
  if (!ids.includes(sample.contentOwnerProfessionId)) pairIssues.push(where + ': owner 必须 ∈ professionIds');
  const expectedEventId = 'crossover:' + ids.slice().sort().join(':');
  if (sample.eventId !== expectedEventId) pairIssues.push(where + ': eventId 应为 ' + expectedEventId);
  if (sample.pairId !== expectedEventId) pairIssues.push(where + ': pairId 应与 eventId 一致');
  if (sample.eventId.length > constants.eventIdMaxLength) pairIssues.push(where + ': eventId 超长');
  const games = sample.anchor.professionGames || [];
  if (games.length !== 2) pairIssues.push(where + ': professionGames 必须 2 条');
  games.forEach((row) => {
    const game = realGames.get(row.gameId);
    if (!game || !(game.professions || []).includes(row.professionId)) pairIssues.push(where + ': 游戏与职业映射不真实 -> ' + row.professionId + '/' + row.gameId);
    if (!ids.includes(row.professionId)) pairIssues.push(where + ': professionGames 含非本对职业 ' + row.professionId);
  });
  if (!unique(games.map((row) => row.professionId))) pairIssues.push(where + ': professionGames 职业重复');
  (sample.anchor.chapterIds || []).forEach((chapterId) => {
    if (!campaignChapters.has(chapterId)) pairIssues.push(where + ': 章节不在真实 campaign -> ' + chapterId);
  });
  if (!sample.anchor.chapterIds.length) pairIssues.push(where + ': chapterIds 不能为空');
  if (!sample.anchor.npcRefs.length || sample.anchor.npcRefs.length > 2) pairIssues.push(where + ': npcRefs 必须 1–2 条');
});
check('交汇对结构自洽（升序、owner ∈ pair、eventId 规范、章节/游戏/人物真实）', pairIssues.length === 0, pairIssues.slice(0, 6).join(' | '));

/* ---- 与 0.23 narrative shard 的 optionalCrossover 对齐 ---- */

const shardEntries = shards.flatMap((shard) => shard.entries || []);
const shardByProfession = new Map(shardEntries.map((entry) => [entry.professionId, entry]));
const shardIssues = [];
crossoverSamples.forEach((sample) => {
  const entry = shardByProfession.get(sample.contentOwnerProfessionId);
  if (!entry || !isPlainObject(entry.optionalCrossover)) {
    shardIssues.push(sample.contentOwnerProfessionId + ': 0.23 shard 缺 optionalCrossover');
    return;
  }
  const declared = (entry.optionalCrossover.requiredProfessionIds || []).slice().sort();
  if (!deepEqual(declared, sample.professionIds.slice().sort())) {
    shardIssues.push(sample.contentOwnerProfessionId + ': 与 shard 声明的对不一致 ' + declared.join('+') + ' vs ' + sample.professionIds.slice().sort().join('+'));
  }
  if (entry.optionalCrossover.releaseVersion !== '0.24') shardIssues.push(sample.contentOwnerProfessionId + ': shard 未标注 0.24');
});
check('16 条交汇声明与 0.23 shard 的 optionalCrossover 逐条一致（不发明新对）', shardIssues.length === 0, shardIssues.slice(0, 6).join(' | '));
check('shard 的 16 个职业与契约覆盖一致', shardByProfession.size === 16 && crossoverSamples.every((sample) => shardByProfession.has(sample.contentOwnerProfessionId)));

/* ------------------------------------------------------------------ *
 * D. 双边接受与"未接受绝不透露"
 * ------------------------------------------------------------------ */

check('两条 gate 定义都要求 both-accepted 才允许', contract.schemas.crossoverGate.properties.professionGate.const === 'both-accepted'
  && contract.schemas.crossoverGate.properties.pausedBlocks.const === false
  && deepEqual(contract.schemas.crossoverGate.properties.acceptedStates.items.enum, ['accepted', 'developed', 'completed']), JSON.stringify(contract.schemas.crossoverGate.properties));
check('主线替代 gate 不允许依赖特定其他职业', contract.schemas.alternativeGate.properties.requiresSpecificProfession.const === false
  && contract.schemas.alternativeGate.properties.requiresAcceptedProfession.const === true);
check('constants.acceptedStates 与 schema 冻结一致', deepEqual(constants.acceptedStates.slice().sort(), ['accepted', 'completed', 'developed']));
check('全部交汇样例 gate 都是 both-accepted 且 paused 不拦截', crossoverSamples.every((sample) => sample.gate.professionGate === 'both-accepted'
  && sample.gate.pausedBlocks === false
  && deepEqual(sample.gate.acceptedStates.slice().sort(), ['accepted', 'completed', 'developed'])), 'gate');
check('全部交汇样例明确不动身份/主线且无副作用', crossoverSamples.every((sample) => sample.affectsIdentity === false
  && sample.touchesMainline === false
  && Array.isArray(sample.effects) && sample.effects.length === 0), 'effects');
check('全部交汇样例 grants 全零（不发货币/材料/证据/旗标）', crossoverSamples.every((sample) => sample.grants.credits === 0
  && Object.keys(sample.grants.items || {}).length === 0
  && (sample.grants.evidence || []).length === 0
  && (sample.grants.flags || []).length === 0), 'grants');
check('交汇可见面 ⊆ 冻结 6 面且排除 clue/letter/工作/商店', crossoverSamples.every((sample) => sample.visibleSurfaces.every((surface) => constants.crossoverSurfaces.includes(surface)
  && !constants.forbiddenCrossoverSurfaces.includes(surface))), 'surfaces');
check('每条交汇每档最多 1 次', crossoverSamples.every((sample) => sample.maxShowsPerCareer === 1) && constants.maxCrossoversPerCareer === 1);

/* ---- 纯逻辑模拟：只有双方接受才产出节点 ---- */

const ACCEPTED = ['accepted', 'developed', 'completed'];
const PROFESSION_VERSION_FROZEN = 1;
function professionAccepted(state, professionId) {
  const row = (state.professionProgress || {})[professionId];
  return !!row && ACCEPTED.includes(row.state);
}
function chapterReached(chapterId) {
  const chapter = campaignChapters.get(chapterId);
  if (!chapter || !chapter.entry || !Array.isArray(chapter.entry.allFlags) || !chapter.entry.allFlags.length) return [];
  return chapter.entry.allFlags;
}
function simulateCrossovers(input) {
  const state = input.state || {};
  const context = input.context || {};
  const accepted = new Set(context.acceptedProfessionIds || []);
  const flags = new Set(context.worldFlags || []);
  const cleared = new Set(context.clearedCommissions || []);
  const evidence = new Set(context.storyEvidence || []);
  if ((state.professionVersion || PROFESSION_VERSION_FROZEN) > PROFESSION_VERSION_FROZEN) return [];
  if (context.archived === true) return [];
  const surface = context.surface;
  if (!constants.crossoverSurfaces.includes(surface) || constants.forbiddenCrossoverSurfaces.includes(surface)) return [];
  const out = [];
  input.pairs.forEach((pair) => {
    if (!pair.professionIds.every((professionId) => accepted.has(professionId) && professionAccepted(state, professionId))) return;
    const chapterOk = pair.anchor.chapterIds.some((chapterId) => {
      const entryFlags = chapterReached(chapterId);
      return entryFlags.every((flag) => flags.has(flag));
    });
    if (!chapterOk) return;
    if (!pair.gate.requiresFlagsAll.every((flag) => flags.has(flag))) return;
    if (pair.gate.requiresFlagsAny.length && !pair.gate.requiresFlagsAny.some((flag) => flags.has(flag))) return;
    if (!pair.gate.requiresCommissionsAll.every((commissionId) => cleared.has(commissionId))) return;
    if (pair.gate.requiresEvidenceAny.length && !pair.gate.requiresEvidenceAny.some((token) => evidence.has(token))) return;
    out.push({
      eventId: pair.eventId,
      pairId: pair.pairId,
      npcRefs: pair.anchor.npcRefs,
      texts: pair.texts,
      receiptSource: 'narrative-event',
      maxShowsPerCareer: 1,
    });
  });
  return out;
}

const uniquePairs = [];
const pairByEventId = new Map();
crossoverSamples.forEach((sample) => {
  if (pairByEventId.has(sample.eventId)) return;
  pairByEventId.set(sample.eventId, sample);
  uniquePairs.push(sample);
});
equal('16 条声明折叠为 10 个不同事件（去重生效）', uniquePairs.length, contract.coverageMatrix.distinctCrossoverPairs);

function makeState(professionIds, overrides) {
  const progress = {};
  professionIds.forEach((entry) => {
    progress[entry.professionId] = { state: entry.state, paused: entry.paused === true };
  });
  return Object.assign({ professionVersion: 1, professionProgress: progress }, overrides || {});
}

const pairArchivistLattice = pairByEventId.get('crossover:research.archivist:research.lattice');
const pairMinerLattice = pairByEventId.get('crossover:nature.miner:research.lattice');
const pairPilotGravity = pairByEventId.get('crossover:adventure.pilot:research.gravity');
const pairDispatcherDriver = pairByEventId.get('crossover:engineering.dispatcher:engineering.driver');
check('模拟前置：关键四对存在', !!pairArchivistLattice && !!pairMinerLattice && !!pairPilotGravity && !!pairDispatcherDriver);

const allAcceptedProfessionIds = realProfessionIds.slice();
const allAcceptedState = makeState(allAcceptedProfessionIds.map((professionId) => ({ professionId, state: 'accepted' })));
const allReachableFlags = ['C0.port_seen', 'C1.signal_fragment', 'C2.research_complete', 'C3.truth_found', 'C4.city_power_restored'];
const allAcceptedContext = {
  surface: 'port',
  acceptedProfessionIds: allAcceptedProfessionIds,
  worldFlags: allReachableFlags,
  clearedCommissions: ['gold-miner.T1'],
  storyEvidence: ['E-mole-whack.T3'],
  archived: false,
};
const bothAcceptedState = makeState([
  { professionId: 'research.archivist', state: 'accepted' },
  { professionId: 'research.lattice', state: 'accepted' },
]);
const bothAcceptedContext = allAcceptedContext;
const allVisibleNodes = simulateCrossovers({ state: allAcceptedState, context: allAcceptedContext, pairs: uniquePairs });
check('16 职业全部接受 + 全部真实前置 → 10 对全部产出', allVisibleNodes.length === 10
  && unique(allVisibleNodes.map((node) => node.eventId)), allVisibleNodes.map((node) => node.eventId).join(','));
check('全部可见时事件 id 与去重后的 10 个 eventId 完全一致', deepEqual(allVisibleNodes.map((node) => node.eventId).sort(), uniquePairs.map((pair) => pair.eventId).sort()));
const bothAcceptedNodes = simulateCrossovers({ state: bothAcceptedState, context: bothAcceptedContext, pairs: uniquePairs });
check('双方都已接受 + 真实旗标 → 产出交汇节点', bothAcceptedNodes.length >= 1
  && bothAcceptedNodes.some((node) => node.eventId === 'crossover:research.archivist:research.lattice'), bothAcceptedNodes.map((node) => node.eventId).join(','));

const c1OnlyContext = Object.assign({}, allAcceptedContext, { worldFlags: ['C0.port_seen', 'C1.signal_fragment'] });
const c1OnlyNodes = simulateCrossovers({ state: allAcceptedState, context: c1OnlyContext, pairs: uniquePairs });
check('只有 C1 真实前置时只产出可在 C1 成立的两对（不提前泄露后续章节）', c1OnlyNodes.length === 2
  && c1OnlyNodes.some((node) => node.eventId === pairDispatcherDriver.eventId)
  && !c1OnlyNodes.some((node) => node.eventId === pairArchivistLattice.eventId), c1OnlyNodes.map((node) => node.eventId).join(','));

const oneReadContext = Object.assign({}, allAcceptedContext, { acceptedProfessionIds: ['research.archivist'] });
const oneReadState = makeState([
  { professionId: 'research.archivist', state: 'accepted' },
  { professionId: 'research.lattice', state: 'read' },
]);
const oneReadNodes = simulateCrossovers({ state: oneReadState, context: oneReadContext, pairs: uniquePairs });
check('仅一侧接受、另一侧 read → 零节点（未接受绝不透露）', oneReadNodes.length === 0, oneReadNodes.map((node) => node.eventId).join(','));
check('仅一侧接受时不会泄露另一侧（节点数组完全为空）', oneReadNodes.every((node) => !node.pairId.includes('research.lattice')));

const oneUndiscoveredState = makeState([{ professionId: 'research.archivist', state: 'accepted' }]);
const oneUndiscoveredNodes = simulateCrossovers({ state: oneUndiscoveredState, context: oneReadContext, pairs: uniquePairs });
check('仅一侧接受、另一侧未发现 → 零节点', oneUndiscoveredNodes.length === 0, oneUndiscoveredNodes.length);

const pausedContext = Object.assign({}, allAcceptedContext, { acceptedProfessionIds: ['research.archivist', 'research.lattice'] });
const pausedState = makeState([
  { professionId: 'research.archivist', state: 'accepted' },
  { professionId: 'research.lattice', state: 'developed', paused: true },
]);
const pausedNodes = simulateCrossovers({ state: pausedState, context: pausedContext, pairs: uniquePairs });
check('已接受但被搁置不阻塞（pausedBlocks:false）', pausedNodes.length === 1 && pausedNodes[0].eventId === 'crossover:research.archivist:research.lattice', pausedNodes.length);

const completedState = makeState([
  { professionId: 'research.archivist', state: 'completed' },
  { professionId: 'research.lattice', state: 'completed' },
]);
check('阶段圆满（completed）仍算接受', simulateCrossovers({ state: completedState, context: pausedContext, pairs: uniquePairs }).length === 1);

const noFlagContext = Object.assign({}, pausedContext, { worldFlags: ['C0.port_seen', 'C1.signal_fragment'] });
check('缺真实前置旗标 → 该对不产出（不提前透露）', simulateCrossovers({ state: bothAcceptedState, context: noFlagContext, pairs: uniquePairs }).every((node) => node.eventId !== 'crossover:research.archivist:research.lattice'));

const minerState = makeState([
  { professionId: 'nature.miner', state: 'accepted' },
  { professionId: 'research.lattice', state: 'accepted' },
]);
const minerBaseContext = {
  surface: 'journal',
  acceptedProfessionIds: ['nature.miner', 'research.lattice'],
  worldFlags: ['C1.signal_fragment', 'C2.research_complete'],
  clearedCommissions: [],
  storyEvidence: [],
  archived: false,
};
check('requiresCommissionsAll 未满足 → 不产出', simulateCrossovers({ state: minerState, context: minerBaseContext, pairs: uniquePairs }).every((node) => node.eventId !== pairMinerLattice.eventId));
check('requiresCommissionsAll 满足 → 产出', simulateCrossovers({
  state: minerState,
  context: Object.assign({}, minerBaseContext, { clearedCommissions: ['gold-miner.T1'] }),
  pairs: uniquePairs,
}).some((node) => node.eventId === pairMinerLattice.eventId));

check('future professionVersion → 零节点', simulateCrossovers({ state: makeState([{ professionId: 'research.archivist', state: 'accepted' }, { professionId: 'research.lattice', state: 'accepted' }], { professionVersion: 2 }), context: pausedContext, pairs: uniquePairs }).length === 0);
check('封存 archived → 零节点', simulateCrossovers({ state: bothAcceptedState, context: Object.assign({}, pausedContext, { archived: true }), pairs: uniquePairs }).length === 0);
check('clue / letter 面 → 零节点（邀请阶段不泄底）', ['clue', 'letter'].every((surface) => simulateCrossovers({ state: bothAcceptedState, context: Object.assign({}, pausedContext, { surface }), pairs: uniquePairs }).length === 0));
check('work / shop / crafting / tools 面 → 零节点', ['work', 'shop', 'crafting', 'tools'].every((surface) => simulateCrossovers({ state: bothAcceptedState, context: Object.assign({}, pausedContext, { surface }), pairs: uniquePairs }).length === 0));

const frozenNodeKeys = ['eventId', 'pairId', 'npcRefs', 'texts', 'receiptSource', 'maxShowsPerCareer'];
const nodeKeyIssues = bothAcceptedNodes.filter((node) => !deepEqual(Object.keys(node).sort(), frozenNodeKeys.slice().sort()));
check('resolver 输出节点键集冻结，且不含职业展示名/职业 id 列表/经济字段', nodeKeyIssues.length === 0
  && bothAcceptedNodes.every((node) => !Object.prototype.hasOwnProperty.call(node, 'professionIds')
    && !Object.prototype.hasOwnProperty.call(node, 'displayName')
    && !Object.prototype.hasOwnProperty.call(node, 'credits')), nodeKeyIssues.map((node) => Object.keys(node).join(',')).join(' | '));

/* ------------------------------------------------------------------ *
 * E. 去重与幂等规则
 * ------------------------------------------------------------------ */

const dedupe = contract.dedupe || {};
equal('去重模板冻结', dedupe.crossoverEventIdTemplate, 'crossover:{minProfessionId}:{maxProfessionId}');
equal('去重分隔符为冒号（与真实 eventId 语法兼容）', dedupe.pairSeparator, ':');
check('内容层去重规则可执行（owner 优先 min、再字典序）', Array.isArray(dedupe.contentLevel.winnerRule)
  && dedupe.contentLevel.winnerRule.length === 2
  && dedupe.contentLevel.loserPolicy === 'drop-text'
  && dedupe.contentLevel.textsMustBeIdenticalWithinPair === true, JSON.stringify(dedupe.contentLevel));
check('状态层写入走真实 RECORD_STORY_EVENT 且 duplicate 不改写', dedupe.stateLevel.recorder === 'career-db.applyProfessionEvent'
  && dedupe.stateLevel.action === 'RECORD_STORY_EVENT'
  && dedupe.stateLevel.duplicateResult.duplicate === true
  && dedupe.stateLevel.duplicateResult.rewrite === false, JSON.stringify(dedupe.stateLevel));
check('渲染层每档 1 次、每会话回显 1 次', dedupe.renderLevel.maxShowsPerCareer === 1
  && dedupe.renderLevel.sessionEchoMax === 1
  && deepEqual(dedupe.renderLevel.echoSurfaces, ['port', 'receipt']), JSON.stringify(dedupe.renderLevel));
check('跨标签/重试策略冻结', dedupe.crossTab.transaction === true
  && dedupe.crossTab.generationGuard === true
  && dedupe.crossTab.showOnlyAfterOk === true
  && dedupe.retry.policy === 'idempotent-retry'
  && dedupe.retry.duplicateIsSuccess === true
  && dedupe.retry.partialWriteAllowed === false, JSON.stringify(dedupe.crossTab) + JSON.stringify(dedupe.retry));

const grouped = new Map();
crossoverSamples.forEach((sample) => {
  if (!grouped.has(sample.eventId)) grouped.set(sample.eventId, []);
  grouped.get(sample.eventId).push(sample);
});
const groupIssues = [];
grouped.forEach((declarations, eventId) => {
  const ids = eventId.slice('crossover:'.length).split(':');
  const minProfessionId = ids.slice().sort()[0];
  const ranked = declarations.slice().sort((left, right) => {
    const leftRank = left.contentOwnerProfessionId === minProfessionId ? 0 : 1;
    const rightRank = right.contentOwnerProfessionId === minProfessionId ? 0 : 1;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.contentOwnerProfessionId < right.contentOwnerProfessionId ? -1 : 1;
  });
  const winner = ranked[0];
  const declaredWinners = declarations.filter((sample) => sample.activeTextOwner === true);
  if (declaredWinners.length !== 1) groupIssues.push(eventId + ': activeTextOwner 必须恰 1，实际 ' + declaredWinners.length);
  else if (declaredWinners[0].contentOwnerProfessionId !== winner.contentOwnerProfessionId) {
    groupIssues.push(eventId + ': 期望 owner ' + winner.contentOwnerProfessionId + ' 实际 ' + declaredWinners[0].contentOwnerProfessionId);
  }
  const textKeys = new Set(declarations.map((sample) => canonicalize(sample.texts)));
  if (textKeys.size !== 1) groupIssues.push(eventId + ': 同一对声明文本不一致');
  const gateKeys = new Set(declarations.map((sample) => canonicalize(sample.gate)));
  if (gateKeys.size !== 1) groupIssues.push(eventId + ': 同一对声明 gate 不一致');
  const anchorKeys = new Set(declarations.map((sample) => canonicalize(sample.anchor)));
  if (anchorKeys.size !== 1) groupIssues.push(eventId + ': 同一对声明 anchor 不一致');
});
check('同一事件的多条声明：owner 规则确定、文本/gate/anchor 完全一致', groupIssues.length === 0, groupIssues.slice(0, 6).join(' | '));

const winnerInvites = Array.from(grouped.values()).filter((declarations) => declarations.some((sample) => sample.activeTextOwner)).map((declarations) => declarations.find((sample) => sample.activeTextOwner).texts.invite);
check('每个获胜声明的 invite 文案唯一（无重复兜底）', unique(winnerInvites), winnerInvites.length + ' winners');
check('coverageMatrix 去重计数与实测一致', contract.coverageMatrix.activeTextOwners === winnerInvites.length
  && contract.coverageMatrix.distinctCrossoverPairs === grouped.size, contract.coverageMatrix.activeTextOwners + '/' + grouped.size);

/* ---- 真实 reducer 接受这些 eventId，且行形状只有 at/source ---- */

const allEventIds = Array.from(new Set([
  ...crossoverSamples.map((sample) => sample.eventId),
  ...journalSamples.map((sample) => sample.eventId),
]));
const baseState = professionState.initialState();
const reducerIssues = [];
const rowShapeIssues = [];
const eventIdGrammar = new RegExp(constants.eventIdGrammar);
allEventIds.forEach((eventId) => {
  if (!eventIdGrammar.test(eventId)) reducerIssues.push(eventId + ': 不匹配契约语法');
  const first = professionState.recordStoryEvent(baseState, { eventId, source: 'world', at: '2026-11-28T00:00:00.000Z' });
  if (!first || first.ok !== true) reducerIssues.push(eventId + ': real reducer 拒绝 ' + (first && first.reason));
  else {
    const row = first.state.storyEvents[eventId];
    if (!deepEqual(Object.keys(row).sort(), ['at', 'source'])) rowShapeIssues.push(eventId + ': 行字段 ' + Object.keys(row).join(','));
    const second = professionState.recordStoryEvent(first.state, { eventId, source: 'world', at: '2027-01-01T00:00:00.000Z' });
    if (!second || second.ok !== true || second.duplicate !== true) reducerIssues.push(eventId + ': 重复写入未返回 duplicate');
    else if (second.state.storyEvents[eventId].at !== '2026-11-28T00:00:00.000Z') reducerIssues.push(eventId + ': duplicate 改写了 at');
    else if (second.state.storyEvents[eventId].source !== 'world') reducerIssues.push(eventId + ': duplicate 改写了 source');
  }
});
check('全部样例 eventId 通过真实 profession-state reducer', reducerIssues.length === 0, reducerIssues.slice(0, 6).join(' | '));
check('真实 reducer 持久行只有 at/source（不新增持久字段）', rowShapeIssues.length === 0, rowShapeIssues.slice(0, 6).join(' | '));
check('写入是纯函数且不修改传入状态', Object.keys(baseState.storyEvents).length === 0 && baseState.narrativeCursor.nodeId === null);
equal('compatibility.persistedEventFields 与真实行形状一致', contract.compatibility.persistedEventFields.slice().sort(), ['at', 'source']);

/* ------------------------------------------------------------------ *
 * F. 历史事件：可见性白名单、来源、排序、迁移、上限
 * ------------------------------------------------------------------ */

const journal = contract.journal || {};
const visibility = journal.visibility || {};
const namespaceTable = journal.namespaces || {};
check('经历持久化形状只声明 at/source，且禁止 label/text 落盘', deepEqual(journal.stateShape.persistedFields, ['at', 'source'])
  && journal.stateShape.forbiddenPersistedFields.includes('label')
  && journal.stateShape.forbiddenPersistedFields.includes('text'), JSON.stringify(journal.stateShape));
check('eventId 语法与真实 reducer 一致（同一正则口径）', constants.eventIdGrammar === '^[a-z][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
  && constants.eventIdMaxLength === 120);
check('经历来源白名单 = clue/commission/world/story', deepEqual(constants.journalSources.slice().sort(), ['clue', 'commission', 'story', 'world']));
check('命名空间表 5 项且可写面恰 3 个', Object.keys(namespaceTable).length === 5
  && ['story', 'world', 'crossover'].every((name) => namespaceTable[name].writable === true)
  && ['invitation', 'commission'].every((name) => namespaceTable[name].writable === false), Object.keys(namespaceTable).join(','));
check('每个 namespace 的允许 source ⊆ journalSources', Object.keys(namespaceTable).every((name) => (namespaceTable[name].sources || []).every((source) => constants.journalSources.includes(source))));
check('命名空间名匹配真实 eventId 语法的 namespace 段', Object.keys(namespaceTable).every((name) => new RegExp('^[a-z][a-z0-9-]*$').test(name)));
check('可见性三层与默认拒绝冻结', visibility.whitelistRequired === true
  && deepEqual(visibility.layers, ['code-frozen', 'content-catalog', 'content-context'])
  && visibility.defaultPolicy === 'omit'
  && visibility.unacceptedProfessionPolicy === 'omit'
  && visibility.unknownNamespacePolicy === 'omit-and-preserve'
  && visibility.noDomPlaceholder === true
  && visibility.reasonCodeInPlayerText === false, JSON.stringify(visibility));
equal('代码冻结白名单与真实 PUBLIC_STORY_EVENTS 完全一致', visibility.codeFrozenEvents, Object.keys(professionView.PUBLIC_STORY_EVENTS));
check('引擎前缀白名单与真实投影前缀一致', deepEqual(visibility.enginePrefixes.slice().sort(), ['commission:', 'invitation:']));
check('经历可见面 ⊆ 真实投影 SURFACES 且不含 clue/letter/work', constants.journalSurfaces.every((surface) => professionView.SURFACES.includes(surface))
  && !constants.journalSurfaces.includes('clue')
  && !constants.journalSurfaces.includes('letter')
  && !constants.journalSurfaces.includes('work'), constants.journalSurfaces.join(','));
check('交汇可见面 ⊆ 真实投影 SURFACES', constants.crossoverSurfaces.every((surface) => professionView.SURFACES.includes(surface)));
check('标签格式冻结：6–40 汉字、≤60 字符、不显示 id', deepEqual(journal.labels.hanRange, [6, 40])
  && journal.labels.maxLength === 60
  && journal.labels.playerVisibleIds === false, JSON.stringify(journal.labels));
check('排序沿用真实 storyHistory 口径', journal.ordering.source === 'profession-view.storyHistory'
  && journal.ordering.primary === 'at-ascending'
  && journal.ordering.emptyAt === 'first'
  && journal.ordering.domOrderIsRealOrder === true
  && journal.ordering.totalCountShown === false, JSON.stringify(journal.ordering));
check('迁移只追加且不新增 store/key', journal.migration.mode === 'append-only'
  && journal.migration.rewriteExisting === false
  && journal.migration.backfillRewards === false
  && journal.migration.newStore === false
  && journal.migration.newKey === false
  && journal.migration.unknownNamespace === 'preserve-invisible'
  && journal.migration.futureProfessionVersion === 'read-only-empty-view', JSON.stringify(journal.migration));
check('上限 256 且淘汰为 key 字典序（与真实实现一致）', journal.limits.maxStoryEvents === 256
  && constants.maxStoryEvents === 256
  && journal.limits.eviction === 'lexicographic-key-ascending'
  && journal.limits.capOwner === 'profession-state.recordStoryEvent'
  && journal.limits.evictionDoesNotAffectFacts === true
  && journal.limits.softBudget < journal.limits.maxStoryEvents, JSON.stringify(journal.limits));
check('真实实现确实冻结 256 上限（源码核对）', /MAX_STORY_EVENTS\s*=\s*256/.test(readText('apps/arcade/career/profession-state.js')));
check('真实实现确实只允许 clue/commission/world/story 四种 source（源码核对）', (() => {
  const match = readText('apps/arcade/career/profession-view.js').match(/STORY_EVENT_SOURCES\s*=\s*\[([^\]]*)\]/);
  if (!match) return false;
  const tokens = match[1].split(',').map((part) => part.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).sort();
  return deepEqual(tokens, ['clue', 'commission', 'story', 'world']);
})());

/* ---- 纯逻辑模拟：默认拒绝 + 三层白名单 + 排序 ---- */

const codeFrozen = professionView.PUBLIC_STORY_EVENTS;
const contentWhitelist = {
  'world:C2.errand.alt.courier': '占位标签甲',
  'crossover:research.archivist:research.lattice': '占位标签乙',
};
const acceptedCommissionIds = new Set(['memory-flip.T2']);
const acceptedInvitationIds = new Set(['research.archivist']);
function simulateJournal(input) {
  const rows = [];
  (input.events || []).forEach((event) => {
    const eventId = event.eventId;
    let label = null;
    let origin = null;
    if (Object.prototype.hasOwnProperty.call(codeFrozen, eventId)) {
      label = codeFrozen[eventId];
      origin = 'code-frozen';
    } else if (Object.prototype.hasOwnProperty.call(contentWhitelist, eventId)) {
      label = contentWhitelist[eventId];
      origin = 'content';
    } else if (eventId.indexOf('invitation:') === 0) {
      if (!acceptedInvitationIds.has(eventId.slice('invitation:'.length))) return;
      label = '占位：已接受邀请';
      origin = 'engine-prefix';
    } else if (eventId.indexOf('commission:') === 0) {
      if (!acceptedCommissionIds.has(eventId.slice('commission:'.length))) return;
      label = '占位：真实委托标题';
      origin = 'engine-prefix';
    } else {
      return;
    }
    if (!constants.journalSurfaces.includes(input.surface)) return;
    rows.push({ eventId, label, at: event.at || null, source: event.source, origin });
  });
  rows.sort((left, right) => {
    const leftAt = left.at || '';
    const rightAt = right.at || '';
    if (leftAt !== rightAt) return leftAt < rightAt ? -1 : 1;
    if (left.label !== right.label) return left.label < right.label ? -1 : 1;
    return left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0;
  });
  return rows;
}
const journalFixture = [
  { eventId: 'story:C0.port_seen', source: 'clue', at: '2026-01-02T00:00:00.000Z' },
  { eventId: 'world:C2.errand.alt.courier', source: 'commission', at: '2026-01-03T00:00:00.000Z' },
  { eventId: 'crossover:research.archivist:research.lattice', source: 'world', at: '2026-01-01T00:00:00.000Z' },
  { eventId: 'invitation:research.archivist', source: 'story', at: '2026-01-04T00:00:00.000Z' },
  { eventId: 'invitation:research.lattice', source: 'story', at: '2026-01-05T00:00:00.000Z' },
  { eventId: 'commission:memory-flip.T2', source: 'commission', at: '2026-01-06T00:00:00.000Z' },
  { eventId: 'commission:gold-miner.T2', source: 'commission', at: '2026-01-07T00:00:00.000Z' },
  { eventId: 'lore:internal_note', source: 'world', at: '2026-01-08T00:00:00.000Z' },
];
const journalRows = simulateJournal({ events: journalFixture, surface: 'journal' });
const visibleIds = journalRows.map((row) => row.eventId);
check('代码冻结事件可见（story:C0.port_seen）', visibleIds.includes('story:C0.port_seen'));
check('内容白名单事件可见（world / crossover）', visibleIds.includes('world:C2.errand.alt.courier') && visibleIds.includes('crossover:research.archivist:research.lattice'));
check('未接受职业的 invitation 事件不显示', !visibleIds.includes('invitation:research.lattice'));
check('已接受职业的 invitation 事件显示', visibleIds.includes('invitation:research.archivist'));
check('未公开的 commission 事件不显示、已可见的显示', !visibleIds.includes('commission:gold-miner.T2') && visibleIds.includes('commission:memory-flip.T2'));
check('未知 namespace 默认拒绝且不出现在结果里', !visibleIds.includes('lore:internal_note'));
check('可见结果不做 DOM 占位（没有 hidden 标记）', journalRows.every((row) => !Object.prototype.hasOwnProperty.call(row, 'hidden')));
check('经历排序为 at 升序（DOM 顺序即真实顺序）', deepEqual(visibleIds, [
  'crossover:research.archivist:research.lattice',
  'story:C0.port_seen',
  'world:C2.errand.alt.courier',
  'invitation:research.archivist',
  'commission:memory-flip.T2',
]), visibleIds.join(','));
check('经历不在 work/shop/crafting/tools 面渲染', ['work', 'shop', 'crafting', 'tools'].every((surface) => simulateJournal({ events: journalFixture, surface }).length === 0));
check('经历事件 source 全部 ∈ 冻结四值', journalSamples.every((sample) => constants.journalSources.includes(sample.source)));
check('经历样例覆盖全部四种 source', deepEqual(Array.from(new Set(journalSamples.map((sample) => sample.source))).sort(), ['clue', 'commission', 'story', 'world']));
check('经历样例覆盖三层白名单', deepEqual(Array.from(new Set(journalSamples.map((sample) => sample.whitelistLayer))).sort(), ['code-frozen', 'content', 'engine-prefix']));
check('经历样例数与封装的 journalSamples 计数一致', contract.coverageMatrix.journalSamples === journalSamples.length, contract.coverageMatrix.journalSamples + '/' + journalSamples.length);
check('经历样例覆盖的 source 数与矩阵一致', contract.coverageMatrix.journalSourcesCovered === new Set(journalSamples.map((sample) => sample.source)).size);
check('命名空间数与矩阵一致', contract.coverageMatrix.namespaces === Object.keys(journal.namespaces || {}).length);
check('替代叙事覆盖章节数与矩阵一致', contract.coverageMatrix.chapters === new Set(altSamples.map((sample) => sample.chapterId)).size);
check('labelMode=content 的样例带 label，其余不带（条件规则已生效）', journalSamples.every((sample) => (sample.labelMode === 'content')
  === Object.prototype.hasOwnProperty.call(sample, 'label')));
check('内容标签为 6–40 汉字、≤60 字符且占位前缀', journalSamples.filter((sample) => sample.labelMode === 'content').every((sample) => {
  const count = hanCount(sample.label);
  return count >= 6 && count <= 40 && sample.label.length <= 60 && /^占位[:：]/.test(sample.label);
}), JSON.stringify(journalSamples.map((sample) => sample.label || null)));
check('经历样例的 namespace 与 source 符合命名空间表', journalSamples.every((sample) => {
  const namespace = sample.eventId.slice(0, sample.eventId.indexOf(':'));
  const row = (journal.namespaces || {})[namespace];
  return isPlainObject(row) && (row.sources || []).includes(sample.source);
}), journalSamples.map((sample) => sample.eventId + ':' + sample.source).join(','));
check('经历样例的可见面 ⊆ 冻结经历面', journalSamples.every((sample) => (sample.surfaces || []).every((surface) => constants.journalSurfaces.includes(surface) && professionView.SURFACES.includes(surface))));
check('经历样例的 whitelistLayer 与冻结/内容/引擎前缀定义一致', journalSamples.every((sample) => {
  if (sample.whitelistLayer === 'code-frozen') return Object.prototype.hasOwnProperty.call(professionView.PUBLIC_STORY_EVENTS, sample.eventId);
  if (sample.whitelistLayer === 'engine-prefix') return sample.eventId.indexOf('invitation:') === 0 || sample.eventId.indexOf('commission:') === 0;
  if (sample.whitelistLayer === 'content') {
    const isEnginePrefix = sample.eventId.indexOf('invitation:') === 0 || sample.eventId.indexOf('commission:') === 0;
    return !isEnginePrefix && !Object.prototype.hasOwnProperty.call(professionView.PUBLIC_STORY_EVENTS, sample.eventId);
  }
  return false;
}), journalSamples.map((sample) => sample.whitelistLayer + ':' + sample.eventId).join(','));

/* ------------------------------------------------------------------ *
 * G. 主线替代路线：机制、锚点、章节覆盖、真实事实
 * ------------------------------------------------------------------ */

check('机制枚举 6 值且顺序冻结', deepEqual(constants.mechanisms.slice().sort(), ['errand', 'evidence-pair', 'market-material', 'profession-commission', 'rental', 'world-work'])
  && constants.mechanismOrder.length === 6
  && deepEqual(constants.mechanisms.slice().sort(), constants.mechanismOrder.slice().sort()));
check('机制 → 锚点 kind 映射完整', deepEqual(Object.keys(constants.mechanismAnchorKind).sort(), constants.mechanisms.slice().sort()));
check('机制 → receiptSource 映射完整且值 ∈ 枚举', deepEqual(Object.keys(constants.mechanismReceiptSource).sort(), constants.mechanisms.slice().sort())
  && Object.keys(constants.mechanismReceiptSource).every((key) => ['commission-receipt', 'alternative-purchase', 'purchase-ledger', 'evidence-grant'].includes(constants.mechanismReceiptSource[key])));
check('替代叙事样例覆盖全部 6 种机制', deepEqual(Array.from(new Set(altSamples.map((sample) => sample.mechanism))).sort(), constants.mechanisms.slice().sort()));
check('替代叙事样例覆盖 C1–C5 五个章节', deepEqual(Array.from(new Set(altSamples.map((sample) => sample.chapterId))).sort(), ['C1', 'C2', 'C3', 'C4', 'C5']));
equal('coverageMatrix.mechanismsCovered 与实测一致', contract.coverageMatrix.mechanismsCovered, new Set(altSamples.map((sample) => sample.mechanism)).size);
equal('coverageMatrix.alternativeSamples 与实测一致', contract.coverageMatrix.alternativeSamples, altSamples.length);
check('替代叙事 narrativeNodeId 唯一且章节前缀一致', unique(altSamples.map((sample) => sample.narrativeNodeId))
  && altSamples.every((sample) => sample.narrativeNodeId.indexOf('altn.' + sample.chapterId + '.') === 0));

const altIssues = [];
altSamples.forEach((sample) => {
  const where = sample.narrativeNodeId;
  const expectedKind = constants.mechanismAnchorKind[sample.mechanism];
  if (sample.anchor.kind !== expectedKind) altIssues.push(where + ': anchor.kind 应为 ' + expectedKind);
  if (sample.receiptSource !== constants.mechanismReceiptSource[sample.mechanism]) altIssues.push(where + ': receiptSource 与机制不符');
  if (sample.gate.requiresSpecificProfession !== false) altIssues.push(where + ': 不得依赖特定其他职业');
  if (sample.gate.requiresAcceptedProfession !== true) altIssues.push(where + ': 必须要求已接受职业');
  sample.anchor.refs.forEach((ref) => {
    if (sample.anchor.kind === 'commission') {
      if (!realCommissions.has(ref)) altIssues.push(where + ': 委托不存在 ' + ref);
      const isWorld = worldWorkIds.has(ref);
      if (sample.mechanism === 'world-work' && !isWorld) altIssues.push(where + ': world-work 锚点不在 world-work.json ' + ref);
      if (sample.mechanism === 'profession-commission' && isWorld) altIssues.push(where + ': world-work 委托被当成职业委托 ' + ref);
    }
    if (sample.anchor.kind === 'offer' && alternativesSource.indexOf("offerId: '" + ref + "'") < 0) altIssues.push(where + ': 代办 offer 不存在 ' + ref);
    if (sample.anchor.kind === 'ship' && !rentalShipIds.has(ref)) altIssues.push(where + ': 租机 shipId 不存在或非免费租用 ' + ref);
    if (sample.anchor.kind === 'item' && !materialIds.has(ref)) altIssues.push(where + ': 材料 itemId 不存在 ' + ref);
    if (sample.anchor.kind === 'evidencePair' && !realEvidence.has(ref)) altIssues.push(where + ': 证据 token 不是真实产出 ' + ref);
  });
  if (sample.anchor.kind === 'evidencePair' && (sample.anchor.refs.length < 2 || sample.anchor.refs.length > 3)) altIssues.push(where + ': evidencePair 需 2–3 个真实 token');
  (sample.gate.requiresFlagsAny || []).concat(sample.gate.requiresFlagsAll || []).forEach((flag) => {
    if (!realFlags.has(flag)) altIssues.push(where + ': 旗标不是真实事实 ' + flag);
  });
  (sample.gate.requiresCommissionsAll || []).forEach((commissionId) => {
    if (!realCommissions.has(commissionId)) altIssues.push(where + ': 前置委托不存在 ' + commissionId);
  });
  (sample.gate.requiresEvidenceAny || []).forEach((token) => {
    if (!realEvidence.has(token)) altIssues.push(where + ': 前置证据不存在 ' + token);
  });
});
check('替代叙事锚点全部指向真实委托/代办/租机/材料/证据', altIssues.length === 0, altIssues.slice(0, 6).join(' | '));
check('signatureFrom 与 npcRef/anchor 的来源自洽（落款只能读真实字段）', altSamples.every((sample) => {
  if (sample.signatureFrom === 'origin-letter') return sample.npcRef.kind === 'origin-letter';
  if (sample.signatureFrom === 'npc-character') return sample.npcRef.kind === 'character';
  if (sample.signatureFrom === 'commission-issuer') return sample.anchor.kind === 'commission';
  if (sample.signatureFrom === 'offer-issuer') return sample.anchor.kind === 'offer';
  return false;
}), altSamples.map((sample) => sample.signatureFrom + '/' + sample.npcRef.kind + '/' + sample.anchor.kind).join(','));
check('world-work 的 5 个 id 全部存在于 96 单（不新增委托总量）', worldWorkIds.size === 5 && Array.from(worldWorkIds).every((id) => realCommissions.has(id)), Array.from(worldWorkIds).filter((id) => !realCommissions.has(id)).join(','));
check('真实委托总量未被改写（≥96 且 id 唯一）', realCommissionIds.length >= 96 && unique(realCommissionIds), realCommissionIds.length);
check('章节门槛只用三个真实旗标', Array.from(new Set(Array.from(realCommissions.values()).map((row) => row.chapterGate).filter(Boolean))).sort(),
  ['C3.truth_found', 'C4.city_power_restored', 'C5.star_tower_resolved'].filter((flag) => realFlags.has(flag)).sort());

/* ------------------------------------------------------------------ *
 * H. 文本卫生：占位、无私有路径、无攻略、不泄露展示名、无内部 id
 * ------------------------------------------------------------------ */

check('全部样例都标记 placeholder:true（占位不可上线）', altSamples.every((sample) => sample.placeholder === true)
  && crossoverSamples.every((sample) => sample.placeholder === true)
  && journalSamples.every((sample) => sample.placeholder === true));

function playerTexts(sample) {
  const out = [];
  if (isPlainObject(sample.texts)) Object.keys(sample.texts).forEach((key) => out.push([key, sample.texts[key]]));
  if (typeof sample.label === 'string') out.push(['label', sample.label]);
  return out.filter(([, text]) => typeof text === 'string');
}
const allSampleTexts = [];
altSamples.concat(crossoverSamples).concat(journalSamples).forEach((sample) => {
  playerTexts(sample).forEach(([key, text]) => allSampleTexts.push([sample.sampleKind + ':' + key, text]));
});
check('样例玩家文本全部以“占位”开头（非剧透占位说明）', allSampleTexts.every(([, text]) => /^占位[:：]/.test(text)), allSampleTexts.filter(([, text]) => !/^占位[:：]/.test(text)).map(([where]) => where).join(','));
check('样例文本数量 ≥ 60（16 交汇 × 4 + 7 替代 × 4 + 标签）', allSampleTexts.length >= 60, allSampleTexts.length);

const privatePathPattern = new RegExp(contract.forbidden.privatePathPattern);
const samplePathHits = allSampleTexts.filter(([, text]) => privatePathPattern.test(text) || text.includes('\\'));
check('样例玩家文本无私有路径/远程资源/反斜杠', samplePathHits.length === 0, samplePathHits.map(([where]) => where).join(','));
const contractWithoutForbidden = Object.assign({}, contract);
delete contractWithoutForbidden.forbidden;
const contractPathHits = walkStrings(contractWithoutForbidden).filter(([, text]) => privatePathPattern.test(text) || text.includes('\\'));
check('契约文件（除 forbidden 自身模式外）无私有路径/反斜杠', contractPathHits.length === 0, contractPathHits.slice(0, 4).map(([where]) => where).join(','));
const adrPathHits = privatePathPattern.test(adrText) || adrText.includes('\\');
check('ADR 正文无私有路径/反斜杠', adrPathHits === false, 'adr');
check('契约文件无未替换的模板占位符', !contractWithoutForbiddenTextHas('{{') && !contractWithoutForbiddenTextHas('}}'));
function contractWithoutForbiddenTextHas(token) {
  return walkStrings(contractWithoutForbidden).some(([, text]) => text.includes(token));
}

const routeKeywords = contract.forbidden.routeGuideKeywords;
check('攻略词表冻结为 10+ 条', Array.isArray(routeKeywords) && routeKeywords.length >= 10, (routeKeywords || []).length);
const routeHits = allSampleTexts.filter(([, text]) => routeKeywords.some((keyword) => text.includes(keyword)));
check('样例玩家文本无完整路线攻略词', routeHits.length === 0, routeHits.map(([where]) => where).join(','));

const displayNameHits = allSampleTexts.filter(([, text]) => realDisplayNames.some((name) => typeof name === 'string' && name && text.includes(name)));
check('样例玩家文本不含任何真实职业展示名（不泄底）', displayNameHits.length === 0, displayNameHits.map(([where]) => where).join(','));

const tokenHits = allSampleTexts.filter(([, text]) => contract.forbidden.playerTextTokens.some((token) => text.includes(token)));
check('样例玩家文本无内部 id/token/章节码/委托后缀', tokenHits.length === 0, tokenHits.map(([where]) => where).join(','));
const idHits = allSampleTexts.filter(([, text]) => /(?:crossover|world|story|invitation|commission):/.test(text) || /altn\./.test(text));
check('样例玩家文本不含 eventId / narrativeNodeId', idHits.length === 0, idHits.map(([where]) => where).join(','));
const sysHits = allSampleTexts.filter(([, text]) => ['系统检测到', '恭喜解锁', '必须完成', '职业 3/16'].some((bad) => text.includes(bad)));
check('样例玩家文本无系统话术', sysHits.length === 0, sysHits.map(([where]) => where).join(','));

/* ---- 文本长度目标 ---- */

check('替代叙事文案长度目标（10–120 字符 / next 6–80）', altSamples.every((sample) => ['offer', 'progress', 'receipt'].every((key) => sample.texts[key].length >= 10 && sample.texts[key].length <= 120)
  && sample.texts.next.length >= 6 && sample.texts.next.length <= 80));
check('交汇文案长度目标（invite/receipt/decline ≤120，body ≤240）', crossoverSamples.every((sample) => sample.texts.invite.length <= 120
  && sample.texts.body.length <= 240
  && sample.texts.receipt.length <= 120
  && sample.texts.decline.length <= 120));

/* ------------------------------------------------------------------ *
 * I. 0.24 与 0.23 兼容边界（与真实文件交叉核对）
 * ------------------------------------------------------------------ */

const compatibility = contract.compatibility || {};
check('不新增 IDB store / IDB 版本 / localStorage key', deepEqual(compatibility.newIdbStores, [])
  && compatibility.newIdbVersion === null
  && deepEqual(compatibility.newLocalStorageKeys, []), JSON.stringify(compatibility));
check('contentVersion 仍 0.18.0 且与全部真实内容一致', compatibility.contentVersion === '0.18.0'
  && contract.contentVersion === '0.18.0'
  && registry.contentVersion === '0.18.0'
  && commissions.contentVersion === '0.18.0'
  && worldWork.contentVersion === '0.18.0'
  && chapterOne.contentVersion === '0.18.0'
  && campaign.contentVersion === '0.18.0'
  && items.contentVersion === '0.18.0'
  && narrativeRegistry.contentVersion === '0.18.0', [registry.contentVersion, commissions.contentVersion, worldWork.contentVersion, chapterOne.contentVersion, campaign.contentVersion, items.contentVersion, narrativeRegistry.contentVersion].join(','));
check('professionVersion 仍 1 且与真实 reducer 一致', compatibility.professionVersion === 1 && professionState.initialState().professionVersion === 1);
check('不新增 rulesetVersion / 不新增 reason code', compatibility.rulesetVersion === null && compatibility.newReasonCodes === false);
check('reasonCodes 与真实 profession-view.REASONS 完全一致（不新增码）', deepEqual(constants.reasonCodes.slice().sort(), Object.values(professionView.REASONS).sort()));
equal('reasonCodes 数量与真实实现一致', constants.reasonCodes.length, Object.keys(professionView.REASONS).length);
check('resolverInput.surface 枚举 = 真实投影 SURFACES', deepEqual(contract.schemas.resolverInput.properties.context.properties.surface.enum.slice().sort(), professionView.SURFACES.slice().sort()));
check('resolver 只读面与真实模块一致（无 DB/DOM/时钟）', contract.resolver.pure === true
  && contract.resolver.methods.length === 1
  && contract.resolver.methods[0].name === 'resolveWorldAlternatives'
  && contract.resolver.methods[0].noDom === true
  && contract.resolver.methods[0].noDb === true
  && contract.resolver.methods[0].noClock === true
  && contract.resolver.methods[0].noRandom === true
  && contract.resolver.methods[0].mutatesInput === false
  && contract.resolver.methods[0].throws === false, JSON.stringify(contract.resolver.methods[0]));
check('resolver 输出必须由 adapter 剥除内部 id/reason', deepEqual(contract.resolver.outputVisibility.adapterMustStrip, ['narrativeNodeId', 'pairId', 'reason', 'anchor'])
  && contract.resolver.outputVisibility.internalIdsInPlayerText === false
  && contract.resolver.outputVisibility.hiddenProfessionInOutput === false);
check('旧档读取只追加、内容缺失可降级、T20 不动版本链', compatibility.oldArchiveRead === 'append-only'
  && compatibility.degradeWhenContentMissing === true
  && compatibility.versionChainTouchedByT20 === false, JSON.stringify(compatibility));
check('契约与 ADR 不含 0.24 版本链/SW 缓存名', !JSON.stringify(contract).includes('studiokit-arcade-0.24')
  && !JSON.stringify(contract).includes('0.24.0')
  && !adrText.includes('studiokit-arcade-0.24'));

/* ---- 禁止键约束 ---- */

check('forbidden.contentKeys 覆盖经济/计时/进度键', ['reward', 'credits', 'items', 'price', 'cost', 'purchase', 'sell', 'grant', 'grants', 'evidence', 'flags', 'unlock', 'wait', 'cooldown', 'deadline', 'percent', 'total', 'score', 'currency']
  .every((key) => contract.forbidden.contentKeys.includes(key)), contract.forbidden.contentKeys.join(','));
const economyKeyHits = [];
altSamples.forEach((sample) => {
  contract.forbidden.contentKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(sample, key)) economyKeyHits.push('alternativeNarrative: top-level ' + key);
  });
});
crossoverSamples.forEach((sample) => {
  contract.forbidden.contentKeys.forEach((key) => {
    // grants 是交汇 schema 的必填零值证明字段，已在上面逐项断言全零；其余被禁键一律不允许出现。
    if (key === 'grants') return;
    if (Object.prototype.hasOwnProperty.call(sample, key)) economyKeyHits.push('crossoverPair: top-level ' + key);
  });
});
check('样例顶层不含任何被禁的经济/计时/进度键（grants 仅作零值证明）', economyKeyHits.length === 0, economyKeyHits.slice(0, 6).join(','));

/* ------------------------------------------------------------------ *
 * J. ADR 与契约一致
 * ------------------------------------------------------------------ */

check('ADR 存在且标注冻结状态', adrText.includes('FROZEN_FOR_T21_T23') && adrText.length > 8000, adrText.length);
check('ADR 声明本任务只产出契约、未改 runtime', /只产出契约与数据设计/.test(adrText) && /未修改 runtime/.test(adrText));
check('ADR 记录契约测试命令', adrText.includes('node tools/career_world_narrative_contract_test.mjs'));
check('ADR 覆盖六种机制与三份交付', ['world-work', 'profession-commission', 'errand', 'rental', 'market-material', 'evidence-pair'].every((value) => adrText.includes(value))
  && adrText.includes('ADR-0.24-world.md')
  && adrText.includes('career_world_narrative_schema.json')
  && adrText.includes('career_world_narrative_contract_test.mjs'));
check('ADR 明确 0.24 不新增 store/key 与 contentVersion 0.18.0', adrText.includes('不新增 IndexedDB store') && adrText.includes('0.18.0'));
check('ADR 明确未 push/未发布/未跑浏览器', /未 push/.test(adrText) && /未运行浏览器/.test(adrText));
check('ADR 记录了 T21–T23 的写面划分与 lead 接口请求', /T21/.test(adrText) && /T22/.test(adrText) && /T23/.test(adrText) && /接口请求/.test(adrText));
check('ADR 写明交汇不改主线唯一解与未接受绝不透露', adrText.includes('不改主线唯一解') && adrText.includes('未接受绝不透露'));
check('ADR 写明不新增委托/奖励与只追加迁移', adrText.includes('不新增委托') && adrText.includes('只追加'));

/* ------------------------------------------------------------------ *
 * 覆盖矩阵报告
 * ------------------------------------------------------------------ */

console.log('T20 CROSSOVER COVERAGE MATRIX');
console.log('professionId\tgameId\teventId\towner\tchapters\tactive');
crossoverSamples.slice().sort((left, right) => left.contentOwnerProfessionId.localeCompare(right.contentOwnerProfessionId)).forEach((sample) => {
  const game = sample.anchor.professionGames.find((row) => row.professionId === sample.contentOwnerProfessionId);
  console.log([
    sample.contentOwnerProfessionId,
    game ? game.gameId : '?',
    sample.eventId,
    sample.contentOwnerProfessionId,
    sample.anchor.chapterIds.join(','),
    sample.activeTextOwner ? 'yes' : 'no',
  ].join('\t'));
});
console.log('');
console.log('distinct pairs: ' + grouped.size + '; declarations: ' + crossoverSamples.length + '; active owners: ' + winnerInvites.length);
console.log('alternative nodes: ' + altSamples.length + '; mechanisms: ' + new Set(altSamples.map((sample) => sample.mechanism)).size + '; chapters: ' + new Set(altSamples.map((sample) => sample.chapterId)).size);
console.log('journal samples: ' + journalSamples.length + '; sources: ' + new Set(journalSamples.map((sample) => sample.source)).size);
console.log('');

/* ------------------------------------------------------------------ *
 * 结果
 * ------------------------------------------------------------------ */

let failed = 0;
results.forEach((item) => {
  if (item.ok) {
    console.log('PASS  ' + item.name);
  } else {
    failed += 1;
    console.log('FAIL  ' + item.name + (item.detail ? ' — ' + item.detail : ''));
  }
});
console.log('');
console.log((results.length - failed) + '/' + results.length + ' checks passed');
if (failed > 0) {
  console.error('FAILED: ' + failed + ' check(s) failed');
  process.exit(1);
}
console.log('PASS  career world narrative contract test');
