#!/usr/bin/env node
/**
 * Arcade 0.23 T14 短叙事内容门禁（纯 Node、零依赖）。
 *
 * 运行：node tools/career_narrative_content_test.mjs
 * 退出码：0 = 全 PASS；1 = 有 FAIL；2 = 内容装配失败。
 *
 * 覆盖真实 registry 的全部职业，不把 16 写死为运行时上限；本测试只把当前真实
 * 内容快照的 16 个职业作为验收事实。叙事引用必须逐字回到 clues / commissions /
 * chapter-01，玩家可见文本不得借系统话术、原型假数据或路线攻略替代角色说话。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CONTENT_DIR = path.join(ROOT, 'apps', 'arcade', 'career', 'content');
const REGISTRY_FILE = 'narrative-registry.json';
const SHARD_FILES = [
  'narrative-shards/shard-01.json',
  'narrative-shards/shard-02.json',
  'narrative-shards/shard-03.json',
  'narrative-shards/shard-04.json',
];

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? '' : detail === undefined ? '' : String(detail) });
}
function equal(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'expected ' + e + ' got ' + a);
}
function unique(values) {
  return new Set(values).size === values.length;
}
function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, relativePath), 'utf8'));
}
function hanCount(text) {
  return (String(text).match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
}
function hasHanRange(text, min, max) {
  const count = hanCount(text);
  return count >= min && count <= max;
}
function walkStrings(value, prefix = '', out = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, prefix + '[' + index + ']', out));
  } else if (value && typeof value === 'object') {
    Object.keys(value).forEach((key) => walkStrings(value[key], prefix ? prefix + '.' + key : key, out));
  } else if (typeof value === 'string') {
    out.push([prefix, value]);
  }
  return out;
}
function isPlainRelativeUrl(value) {
  return typeof value === 'string'
    && value.length > 0
    && !path.posix.isAbsolute(value)
    && !/^[A-Za-z]:[\\/]/.test(value)
    && !value.includes('\\')
    && !value.includes('..')
    && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

let registry;
let realRegistry;
let cluesContent;
let commissionsContent;
let chapter;
let shards;
try {
  registry = readJson(REGISTRY_FILE);
  realRegistry = readJson('registry.json');
  cluesContent = readJson('clues.json');
  commissionsContent = readJson('commissions.json');
  chapter = readJson('chapter-01.json');
  shards = SHARD_FILES.map((file) => ({ file, data: readJson(file) }));
} catch (error) {
  console.error('FAIL 装配失败: ' + (error && error.message ? error.message : String(error)));
  process.exit(2);
}

const realGames = new Map((realRegistry.games || []).map((game) => [game.gameId, game]));
const realProfessions = new Map((realRegistry.professions || []).map((profession) => [profession.professionId, profession]));
const realProfessionIds = Array.from(realProfessions.keys());
const clues = new Map((cluesContent.clues || []).map((clue) => [clue.clueId, clue]));
const commissions = new Map((commissionsContent.commissions || []).map((commission) => [commission.commissionId, commission]));
const origins = new Map((chapter.origins || []).map((origin) => [origin.gameId, origin]));
const entries = shards.flatMap(({ data }) => data.entries || []);

const REQUIRED_FIELDS = [
  'narrativeId', 'gameId', 'professionId', 'sourceClueId', 'trigger', 'settlementFacts',
  'clueTitle', 'clueTeaser', 'icon', 'readTitle', 'readBody', 'sender', 'npc',
  'npcSourceGameId', 'invitationAction', 'laterLabel', 'freshIntro', 'existingIntro',
  'firstCommissionId', 'firstActionHint', 'firstReceipt', 'nextAction', 'exitLabel',
  'pauseLine', 'returnLine', 'completedLine', 'mainlineConnection', 'optionalCrossover',
  'storyMessages',
];
const VISIBLE_FIELDS = [
  'clueTitle', 'clueTeaser', 'readTitle', 'readBody', 'sender', 'npc',
  'invitationAction', 'laterLabel', 'freshIntro', 'existingIntro', 'firstActionHint',
  'firstReceipt', 'nextAction', 'exitLabel', 'pauseLine', 'returnLine',
  'completedLine', 'mainlineConnection',
];
const ALLOWED_ICONS = new Set(['gem', 'scroll', 'mail', 'pick', 'wallet', 'store', 'tool', 'check', 'x', 'chevron']);
const FAMILY_ICON = { record: 'mail', signal: 'scroll', bio: 'gem', industrial: 'pick', route: 'chevron' };
const INVITATION_VERBS = /^(核对|查看|辨认|沿|比对|复算|测量)/;
const FORBIDDEN_SYSTEM_TEXT = [
  '系统检测到', '恭喜解锁', '你获得了神秘信件', '一封神秘信件', '必须完成',
];
const FORBIDDEN_PROTOTYPE_TEXT = ['阿砾', '矿石', '月影'];
const FORBIDDEN_ROUTE_TEXT = /第一步|第二步|依次前往|完整路线|路线攻略|通关攻略/;
const FORBIDDEN_PRIVATE_PATH = /(?:^|[^\w])(?:[A-Za-z]:[\\/]|file:\/\/|\/Users\/|\/home\/|https?:\/\/)/i;

/* ---------------------------------------------------------------- 全局结构 */
check('真实 registry 当前恰有 16 个职业作为 T14 验收快照', realProfessionIds.length === 16, realProfessionIds.length);
check('真实 registry 当前恰有 16 款游戏作为 T14 验收快照', realGames.size === 16, realGames.size);
equal('narrative-registry schemaVersion', registry.schemaVersion, 1);
equal('narrative-registry contentVersion', registry.contentVersion, '0.18.0');
equal('narrative-registry 四个稳定 shard', registry.shards.map((row) => row.shardId), [
  'career-narrative-shard-01', 'career-narrative-shard-02',
  'career-narrative-shard-03', 'career-narrative-shard-04',
]);
equal('narrative-registry shard URL 与文件一一对应', registry.shards.map((row) => row.url), SHARD_FILES);
equal('narrative-registry 职业集合与真实 registry 完全一致', registry.professionIds.slice().sort(), realProfessionIds.slice().sort());
check('narrative-registry 的 16 个 professionId 唯一', unique(registry.professionIds));
check('narrative-registry shard URL 全是同源相对路径', registry.shards.every((row) => isPlainRelativeUrl(row.url)), JSON.stringify(registry.shards.map((row) => row.url)));

const registryEntryMap = new Map((registry.entries || []).map((entry) => [entry.professionId, entry]));
check('narrative-registry entries 无重复职业', registryEntryMap.size === (registry.entries || []).length);
equal('narrative-registry entries 覆盖全部真实职业', Array.from(registryEntryMap.keys()).sort(), realProfessionIds.slice().sort());

shards.forEach(({ file, data }, index) => {
  const label = 'shard-0' + (index + 1);
  equal(label + ' schemaVersion', data.schemaVersion, 1);
  equal(label + ' contentVersion', data.contentVersion, '0.18.0');
  equal(label + ' shardId 与 registry 一致', data.shardId, registry.shards[index].shardId);
  equal(label + ' 每片恰有四个职业', (data.entries || []).length, 4);
  equal(label + ' professionIds 与 entries 一致', data.professionIds, (data.entries || []).map((entry) => entry.professionId));
  check(label + ' 四个职业 ID 唯一', unique(data.professionIds));
  check(label + ' 四个 narrativeId 唯一', unique((data.entries || []).map((entry) => entry.narrativeId)));
  check(label + ' 文件实际存在且为普通文件', fs.statSync(path.join(CONTENT_DIR, file)).isFile(), file);
});

/* ---------------------------------------------------------------- 逐职业事实与编辑目标 */
const allMessages = [];
const coverageRows = [];
const uniquenessFields = [
  'narrativeId', 'gameId', 'professionId', 'sourceClueId', 'firstCommissionId',
  'clueTitle', 'clueTeaser', 'readTitle', 'invitationAction', 'laterLabel',
  'firstActionHint', 'firstReceipt', 'nextAction', 'exitLabel', 'pauseLine',
  'returnLine', 'completedLine', 'mainlineConnection',
];
const fieldValues = Object.fromEntries(uniquenessFields.map((field) => [field, []]));
const visibleStrings = [];

entries.forEach((entry) => {
  const id = entry && entry.professionId ? entry.professionId : '<missing-profession>';
  const prefix = id + ' ';
  const game = realGames.get(entry.gameId);
  const profession = realProfessions.get(entry.professionId);
  const clue = clues.get(entry.sourceClueId);
  const commission = commissions.get(entry.firstCommissionId);
  const origin = origins.get(entry.gameId);

  check(prefix + '必填字段齐全', REQUIRED_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(entry, field)), REQUIRED_FIELDS.filter((field) => !Object.prototype.hasOwnProperty.call(entry, field)).join(','));
  check(prefix + 'gameId/professionId 引用真实 registry', !!game && !!profession && game.professions.includes(entry.professionId), entry.gameId + ' / ' + entry.professionId);
  check(prefix + 'narrativeId 稳定且匹配游戏', entry.narrativeId === 'career-narrative.' + entry.gameId, entry.narrativeId);
  check(prefix + '线索引用真实且与游戏一致', !!clue && clue.clueId === game.clueRef && clue.gameId === entry.gameId, entry.sourceClueId);
  check(prefix + 'sender 逐字来自真实线索', !!clue && entry.sender === clue.letter.sender, entry.sender);
  equal(prefix + 'trigger 逐字来自真实线索', entry.trigger, clue ? { clueId: clue.clueId, ...clue.trigger } : null);
  check(prefix + 'icon 是本地线性图标且按 family 映射', ALLOWED_ICONS.has(entry.icon) && clue && entry.icon === FAMILY_ICON[clue.family], entry.icon);
  check(prefix + 'NPC 逐字来自真实 chapter-01 起源信', !!origin && entry.npc === origin.c0Letter.from && entry.npcSourceGameId === entry.gameId, entry.npc);

  check(prefix + '首委托存在且属于同一游戏/职业', !!commission && commission.gameId === entry.gameId && commission.professionId === entry.professionId, entry.firstCommissionId);
  check(prefix + '首委托为合法 tier 1 且无章节门槛', !!commission && commission.tier === 1 && commission.chapterGate === null && commission.unlock.all.length === 0, entry.firstCommissionId);
  equal(prefix + 'settlementFacts 与首委托事实完全一致', entry.settlementFacts, commission ? {
    commissionId: commission.commissionId,
    tier: commission.tier,
    objective: commission.objective,
    reward: commission.reward,
    unlock: commission.unlock,
    chapterGate: commission.chapterGate,
  } : null);
  check(prefix + 'settlementFacts.commissionId 与 firstCommissionId 一致', entry.settlementFacts.commissionId === entry.firstCommissionId);

  check(prefix + 'clueTeaser 为 10–25 汉字', hasHanRange(entry.clueTeaser, 10, 25), hanCount(entry.clueTeaser));
  check(prefix + 'readBody 为两短段且合计 40–80 汉字', Array.isArray(entry.readBody) && entry.readBody.length === 2 && entry.readBody.every((line) => hanCount(line) > 0) && hasHanRange(entry.readBody.join(''), 40, 80), hanCount(entry.readBody.join('')));
  check(prefix + 'freshIntro 为 2–3 段且合计 60–120 汉字', Array.isArray(entry.freshIntro) && entry.freshIntro.length >= 2 && entry.freshIntro.length <= 3 && entry.freshIntro.every((line) => hanCount(line) > 0) && hasHanRange(entry.freshIntro.join(''), 60, 120), hanCount(entry.freshIntro.join('')));
  check(prefix + 'existingIntro 为 40–80 汉字', hasHanRange(entry.existingIntro, 40, 80), hanCount(entry.existingIntro));
  check(prefix + 'firstReceipt 为 20–60 汉字', hasHanRange(entry.firstReceipt, 20, 60), hanCount(entry.firstReceipt));
  check(prefix + '首邀请为动词+对象', INVITATION_VERBS.test(entry.invitationAction) && hanCount(entry.invitationAction) >= 4, entry.invitationAction);
  check(prefix + '回执包含人物反馈与新问题', /问|吗？|还是/.test(entry.firstReceipt) && /[。！？]/.test(entry.firstReceipt), entry.firstReceipt);
  check(prefix + 'freshIntro/existingIntro 不假设新人相识', entry.freshIntro.join('').includes('你') && entry.existingIntro.includes('你') && !/第一次见你|刚认识你|初次见面/.test(entry.existingIntro), entry.existingIntro);
  check(prefix + 'pause/return/completed 文案齐全且不重复', [entry.pauseLine, entry.returnLine, entry.completedLine].every((text) => typeof text === 'string' && hanCount(text) >= 8) && unique([entry.pauseLine, entry.returnLine, entry.completedLine]));
  check(prefix + 'mainlineConnection 连接真实旧港事实', hanCount(entry.mainlineConnection) >= 20 && /P-07|航报|异常信号|旧调度/.test(entry.mainlineConnection), entry.mainlineConnection);

  const crossover = entry.optionalCrossover;
  check(prefix + 'optionalCrossover 仅在 0.24 显现', crossover && crossover.releaseVersion === '0.24');
  check(prefix + 'optionalCrossover 明确双方已主动接受', crossover && crossover.acceptanceRule === '双方均已主动接受' && /若/.test(crossover.text) && /都已接受/.test(crossover.text));
  check(prefix + 'optionalCrossover 引用本职业与另一真实职业', crossover && Array.isArray(crossover.requiredProfessionIds) && crossover.requiredProfessionIds.length === 2 && unique(crossover.requiredProfessionIds) && crossover.requiredProfessionIds.includes(entry.professionId) && crossover.requiredProfessionIds.every((professionId) => realProfessions.has(professionId)), JSON.stringify(crossover && crossover.requiredProfessionIds));

  check(prefix + 'story.messages 恰有一条候选', Array.isArray(entry.storyMessages) && entry.storyMessages.length === 1);
  const message = entry.storyMessages[0];
  check(prefix + 'story.message 形状/人物/选择语义合法', message && message.professionId === entry.professionId && ['letter', 'arrival', 'receipt', 'port'].includes(message.surface) && typeof message.label === 'string' && message.label.length > 0 && typeof message.text === 'string' && message.text.includes('你') && /[？?]|还是/.test(message.text) && message.from === entry.npc && (message.at === undefined || /^\d{4}-\d{2}-\d{2}T/.test(message.at)), JSON.stringify(message));
  allMessages.push(message);

  const registryEntry = registryEntryMap.get(entry.professionId);
  equal(prefix + 'narrative-registry 条目索引一致', registryEntry, {
    narrativeId: entry.narrativeId,
    gameId: entry.gameId,
    professionId: entry.professionId,
    shardId: shards.find(({ data }) => data.entries.includes(entry)).data.shardId,
    messageIds: entry.storyMessages.map((row) => row.messageId),
  });

  uniquenessFields.forEach((field) => fieldValues[field].push(entry[field]));
  const playerVisible = {
    ...Object.fromEntries(VISIBLE_FIELDS.map((field) => [field, entry[field]])),
    optionalCrossoverText: entry.optionalCrossover.text,
    storyMessageText: entry.storyMessages[0].text,
  };
  visibleStrings.push(...walkStrings(playerVisible).filter(([, text]) => hanCount(text) >= 8));

  const forbiddenSystem = FORBIDDEN_SYSTEM_TEXT.filter((text) => walkStrings(playerVisible).some(([, value]) => value.includes(text)));
  check(prefix + '无系统话术', forbiddenSystem.length === 0, forbiddenSystem.join(','));
  const forbiddenPrototype = FORBIDDEN_PROTOTYPE_TEXT.filter((text) => walkStrings(playerVisible).some(([, value]) => value.includes(text)));
  check(prefix + '无原型阿砾/矿石/月影假数据', forbiddenPrototype.length === 0, forbiddenPrototype.join(','));
  check(prefix + '无职业进度数字话术', !/职业\s*\d+\s*\/\s*16/.test(JSON.stringify(playerVisible)));
  const pathHits = walkStrings(playerVisible).filter(([, text]) => FORBIDDEN_PRIVATE_PATH.test(text));
  check(prefix + '无私有路径或远程资源', pathHits.length === 0, pathHits.map(([field]) => field).join(','));
  check(prefix + '无完整路线攻略', !FORBIDDEN_ROUTE_TEXT.test(JSON.stringify(playerVisible)));
  check(prefix + '可见文本无占位符/内部委托章节 token', !walkStrings(playerVisible).some(([, text]) => /\{\{[^}]+\}\}|\b(?:E|BP|MAP|DEC)-[A-Za-z0-9]|\bC[0-5]\b|\.[Tt][1-6]\b/.test(text)));

  coverageRows.push({
    professionId: entry.professionId,
    gameId: entry.gameId,
    trigger: entry.trigger.kind + '>=' + entry.trigger.atLeast,
    firstCommissionId: entry.firstCommissionId,
    npc: entry.npc,
    han: {
      clueTeaser: hanCount(entry.clueTeaser),
      readBody: hanCount(entry.readBody.join('')),
      freshIntro: hanCount(entry.freshIntro.join('')),
      existingIntro: hanCount(entry.existingIntro),
      firstReceipt: hanCount(entry.firstReceipt),
    },
  });
});

/* ---------------------------------------------------------------- 唯一性、兜底与总索引 */
equal('16 个职业各有一个叙事 entry', entries.length, realProfessionIds.length);
equal('叙事 entry 职业集合与真实 registry 完全一致', entries.map((entry) => entry.professionId).sort(), realProfessionIds.slice().sort());
uniquenessFields.forEach((field) => {
  check('跨职业 ' + field + ' 唯一', unique(fieldValues[field]), fieldValues[field].filter((value, index, all) => all.indexOf(value) !== index).join(' | '));
});
check('全部 story.messageId 唯一', unique(allMessages.map((message) => message.messageId)));
check('全部 story.message 文本唯一', unique(allMessages.map((message) => message.text)));
check('可见长文本无重复兜底', unique(visibleStrings.map(([, text]) => text)), visibleStrings.filter(([field, text], index, all) => all.findIndex(([, other]) => other === text) !== index).map(([field, text]) => field + ': ' + text).join(' | '));
check('所有 shard 条目合计覆盖 registry 的 16 个职业', new Set(entries.map((entry) => entry.professionId)).size === registry.professionIds.length && registry.professionIds.length === 16);
equal('registry messageIds 与全部 shard 消息一一对应',
  (registry.entries || []).flatMap((entry) => entry.messageIds).sort(),
  allMessages.map((message) => message.messageId).sort());

/* ---------------------------------------------------------------- 报告 */
console.log('T14 COVERAGE MATRIX');
console.log('professionId\tgameId\ttrigger\tfirstCommissionId\tNPC\tHan(teaser/read/fresh/existing/receipt)');
coverageRows.forEach((row) => {
  console.log([
    row.professionId,
    row.gameId,
    row.trigger,
    row.firstCommissionId,
    row.npc,
    [row.han.clueTeaser, row.han.readBody, row.han.freshIntro, row.han.existingIntro, row.han.firstReceipt].join('/'),
  ].join('\t'));
});
console.log('');

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
console.log((results.length - failed) + '/' + results.length + ' checks passed; 16/16 professions covered');
if (failed > 0) {
  console.error('FAILED: ' + failed + ' check(s) failed');
  process.exit(1);
}
console.log('PASS  career narrative content test');
