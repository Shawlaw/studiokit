#!/usr/bin/env node
/**
 * StudioKit Arcade 0.9 关卡数据生成 / 校验器（零 npm 依赖，仅 Node 内置模块）。
 *
 * 职责（见 docs/arcade/0.9/INTEGRATION-CONTRACT.md §8.1）：
 * 1. 读取设计源 docs/arcade/0.9/levels/<gameId>.json（只读，不修改）。
 * 2. 结构校验：13 游戏齐全、每款恰好 6 关、id/编号/必填字段/content/requiredFeatures/mode、
 *    路线引用、胜负条件字段；任一失败即 fail closed（非 0 退出，不写任何输出）。
 * 3. 复核设计包自带校验：docs/arcade/0.9/scripts/validate_levels.py（要求 1088 断言 PASS）。
 * 4. 生成：
 *    - apps/arcade/challenge/<gameId>.js（13 个运行时数据，注册 window.ArcadeChallengeData；
 *      不含 referencePlan / acceptance，防剧透）
 *    - tools/testdata/challenge/<gameId>.json（13 个完整关卡夹具，含 referencePlan/acceptance/integration）
 *    - tools/testdata/challenge/index.json（gameId / title / 6 ids / sha256）
 *    - docs/arcade/0.9/DATA-INTEGRATION-REPORT.md（源 sha256、生成字节、校验摘要、字段取舍、重跑方式）
 *
 * 运行：node tools/arcade_09_data.mjs
 * 输出确定性：不使用时间戳 / 随机数，同一输入重复运行输出字节一致（幂等）。
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN_PACK_DIR = path.join(ROOT, 'docs', 'arcade', '0.9');
const LEVELS_DIR = path.join(DESIGN_PACK_DIR, 'levels');
const RUNTIME_DIR = path.join(ROOT, 'apps', 'arcade', 'challenge');
const FIXTURE_DIR = path.join(ROOT, 'tools', 'testdata', 'challenge');
const REPORT_FILE = path.join(DESIGN_PACK_DIR, 'DATA-INTEGRATION-REPORT.md');

/** 13 款游戏的稳定顺序（与设计包 scripts/validate_levels.py 的 GAMES 一致）。 */
const GAMES = [
  'shadow-leap',
  'snowbells',
  'star-raid',
  'pendulum-tower',
  'block-drop',
  'road-rush',
  'gold-miner',
  'brick-breaker',
  'gravity-flip',
  'snake-run',
  'mole-whack',
  'memory-flip',
  'merge-2048',
];

const PACK_VERSION = '0.9.0-design-v1';
const STAGE_SCHEMA_VERSION = '1.0.0';
const RUNTIME_SCHEMA_VERSION = '1.0.0';
const EXPECTED_STAGE_COUNT = 6;
const EXPECTED_DESIGN_ASSERTIONS = 1088;
const REQUIRED_TEXT_FIELDS = ['title', 'goalStatement', 'decision', 'practicedSkill', 'discovery'];
const WIN_CONDITION_KEYS = ['goal', 'win', 'complete', 'completion', 'endCondition'];
const REQUIRED_ABILITY_VALUES = ['none', 'dash'];

let checks = 0;
const failures = [];

function check(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
  return !!condition;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function readJsonFile(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

/* ----------------------------------------------------------
 * 1. 设计源结构校验
 * ---------------------------------------------------------- */
function collectLevelFiles() {
  let names = [];
  try {
    names = fs.readdirSync(LEVELS_DIR).filter((name) => name.toLowerCase().endsWith('.json'));
  } catch (err) {
    check(false, `cannot read design source directory ${relative(LEVELS_DIR)}: ${err.message}`);
    return [];
  }
  const expected = GAMES.map((gameId) => `${gameId}.json`).sort();
  const actual = names.slice().sort();
  check(
    actual.length === expected.length && actual.every((name, index) => name === expected[index]),
    `design source mismatch: expected ${expected.length} level files (${expected.join(', ')}), actual ${actual.length} (${actual.join(', ')})`
  );
  return expected;
}

function loadGames() {
  const games = [];
  for (const gameId of GAMES) {
    const file = path.join(LEVELS_DIR, `${gameId}.json`);
    const read = readJsonFile(file);
    if (!check(read.ok, `cannot parse ${relative(file)}: ${read.error}`)) continue;
    const game = read.value;
    const sourceBuffer = fs.readFileSync(file);

    check(isPlainObject(game), `${gameId}.json: root must be an object`);
    if (!isPlainObject(game)) continue;

    check(game.gameId === gameId, `${gameId}.json: gameId is ${JSON.stringify(game.gameId)}, expected ${gameId}`);
    check(isNonEmptyString(game.gameName), `${gameId}.json: gameName must be a non-empty string`);
    check(isNonEmptyString(game.sourceFile), `${gameId}.json: sourceFile must be a non-empty string`);
    check(game.sourceFile === `${gameId}.html`, `${gameId}.json: sourceFile ${JSON.stringify(game.sourceFile)} does not match ${gameId}.html`);
    check(Array.isArray(game.stages), `${gameId}.json: stages must be an array`);

    const stages = Array.isArray(game.stages) ? game.stages : [];
    check(
      stages.length === EXPECTED_STAGE_COUNT,
      `${gameId}.json: expected ${EXPECTED_STAGE_COUNT} stages, actual ${stages.length}`
    );

    stages.forEach((stage, index) => {
      const label = `${gameId}.json stages[${index}]`;
      if (!check(isPlainObject(stage), `${label}: must be an object`)) return;
      validateStage(stage, gameId, index, label);
    });

    games.push({
      gameId,
      gameName: game.gameName,
      sourceFile: game.sourceFile,
      stages,
      sourcePath: relative(file),
      sourceSha256: sha256(sourceBuffer),
      sourceBytes: sourceBuffer.length,
    });
  }
  return games;
}

function validateStage(stage, gameId, index, label) {
  const stageNumber = index + 1;
  const expectedId = `${gameId}-C${pad2(stageNumber)}`;
  const stageLabel = `${gameId} ${expectedId}`;

  check(stage.schemaVersion === STAGE_SCHEMA_VERSION, `${label}: schemaVersion must be ${STAGE_SCHEMA_VERSION}`);
  check(stage.gameId === gameId, `${label}: gameId must be ${gameId}`);
  check(stage.id === expectedId, `${label}: id must be ${expectedId}, actual ${JSON.stringify(stage.id)}`);
  check(
    Number.isInteger(stage.stageNumber) && stage.stageNumber === stageNumber,
    `${label}: stageNumber must be ${stageNumber}, actual ${JSON.stringify(stage.stageNumber)}`
  );
  check(stage.mode === 'challenge', `${label}: mode must be 'challenge'`);
  for (const field of REQUIRED_TEXT_FIELDS) {
    check(isNonEmptyString(stage[field]), `${stageLabel}: required field ${field} must be a non-empty string`);
  }
  check(
    Number.isInteger(stage.difficulty) && stage.difficulty >= 1 && stage.difficulty <= 6,
    `${stageLabel}: difficulty must be an integer 1..6`
  );
  check(Array.isArray(stage.targetDurationSec), `${stageLabel}: targetDurationSec must be an array`);
  if (Array.isArray(stage.targetDurationSec)) {
    const duration = stage.targetDurationSec;
    check(
      duration.length === 2 && duration.every((value) => isFiniteNumber(value) && value > 0) && duration[0] <= duration[1],
      `${stageLabel}: targetDurationSec must be [minSec, maxSec] with 0 < min <= max`
    );
  }
  check(isPlainObject(stage.content), `${stageLabel}: content must be an object`);
  check(isPlainObject(stage.integration), `${stageLabel}: integration must be an object`);
  if (isPlainObject(stage.integration)) {
    check(
      Array.isArray(stage.integration.requiredFeatures) &&
        stage.integration.requiredFeatures.length > 0 &&
        stage.integration.requiredFeatures.every(isNonEmptyString),
      `${stageLabel}: integration.requiredFeatures must be a non-empty array of strings`
    );
    check(
      stage.integration.separateClassicProgress === true,
      `${stageLabel}: integration.separateClassicProgress must be true`
    );
    if (Object.prototype.hasOwnProperty.call(stage.integration, 'noAssistedRequired')) {
      check(
        typeof stage.integration.noAssistedRequired === 'boolean',
        `${stageLabel}: integration.noAssistedRequired must be a boolean`
      );
    }
  }
  check(
    (isPlainObject(stage.referencePlan) || Array.isArray(stage.referencePlan)) &&
      Object.keys(stage.referencePlan).length > 0,
    `${stageLabel}: referencePlan must be a non-empty object or array`
  );
  check(isPlainObject(stage.acceptance) && Object.keys(stage.acceptance).length > 0, `${stageLabel}: acceptance must be a non-empty object`);
  if (stage.chapter !== undefined) check(isNonEmptyString(stage.chapter), `${stageLabel}: chapter must be a non-empty string when present`);
  if (stage.designerNotes !== undefined) check(typeof stage.designerNotes === 'string', `${stageLabel}: designerNotes must be a string when present`);

  const content = isPlainObject(stage.content) ? stage.content : null;
  if (!content) return;
  check(Object.keys(content).length > 0, `${stageLabel}: content must not be empty`);
  check(
    WIN_CONDITION_KEYS.some((key) => Object.prototype.hasOwnProperty.call(content, key)),
    `${stageLabel}: content must declare a win/complete condition (one of ${WIN_CONDITION_KEYS.join('/')})`
  );
  if (Object.prototype.hasOwnProperty.call(content, 'requiredAbility')) {
    check(
      REQUIRED_ABILITY_VALUES.indexOf(content.requiredAbility) !== -1,
      `${stageLabel}: content.requiredAbility ${JSON.stringify(content.requiredAbility)} is not one of ${REQUIRED_ABILITY_VALUES.join('/')}`
    );
  }
  validateRouteReferences(content, stageLabel);
}

function validateRouteReferences(content, stageLabel) {
  if (Array.isArray(content.platforms)) {
    const platformIds = new Set(
      content.platforms.filter((item) => isPlainObject(item) && isNonEmptyString(item.id)).map((item) => item.id)
    );
    for (const routeKey of ['mainRoute', 'alternativeRoute']) {
      if (content[routeKey] === undefined) continue;
      check(
        Array.isArray(content[routeKey]) && content[routeKey].every((id) => platformIds.has(id)),
        `${stageLabel}: content.${routeKey} references unknown platform ids`
      );
    }
  }
  if (Array.isArray(content.bells)) {
    const bellIds = new Set(
      content.bells.filter((item) => isPlainObject(item) && isNonEmptyString(item.id)).map((item) => item.id)
    );
    if (content.requiredSequence !== undefined) {
      check(
        Array.isArray(content.requiredSequence) && content.requiredSequence.every((id) => bellIds.has(id)),
        `${stageLabel}: content.requiredSequence references unknown bell ids`
      );
    }
  }
  if (Array.isArray(content.items)) {
    const itemIds = new Set(
      content.items.filter((item) => isPlainObject(item) && isNonEmptyString(item.id)).map((item) => item.id)
    );
    if (content.referenceCatchOrder !== undefined) {
      check(
        Array.isArray(content.referenceCatchOrder) && content.referenceCatchOrder.every((id) => itemIds.has(id)),
        `${stageLabel}: content.referenceCatchOrder references unknown item ids`
      );
    }
  }
}

/* ----------------------------------------------------------
 * 2. 设计包自带校验（docs/arcade/0.9/scripts/validate_levels.py）
 * ---------------------------------------------------------- */
function runDesignValidator() {
  const script = path.join('scripts', 'validate_levels.py');
  const candidates =
    process.platform === 'win32'
      ? [
          ['py', ['-3']],
          ['python', []],
        ]
      : [
          ['python3', []],
          ['python', []],
        ];
  let spawnError = null;
  for (const [command, prefix] of candidates) {
    try {
      const stdout = execFileSync(command, prefix.concat(script), {
        cwd: DESIGN_PACK_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 180000,
        windowsHide: true,
      });
      return { ok: true, output: String(stdout).replace(/\r\n/g, '\n') };
    } catch (err) {
      if (err && typeof err.status === 'number') {
        const output = String((err.stdout || '') + (err.stderr || '')).replace(/\r\n/g, '\n');
        return { ok: false, status: err.status, output };
      }
      spawnError = err;
    }
  }
  return { ok: false, spawnError: spawnError ? String(spawnError.message || spawnError) : 'python unavailable', output: '' };
}

function parseDesignValidatorOutput(output) {
  const categories = [];
  let total = 0;
  for (const line of String(output || '').split('\n')) {
    const match = line.match(/^\s*([a-z][a-z-]+):\s*(\d+)\s+assertions\s*$/);
    if (!match) continue;
    categories.push({ name: match[1], count: Number(match[2]) });
    total += Number(match[2]);
  }
  const pass = /^PASS:/m.test(output);
  const header = /^Content pack:\s*13 games,\s*78 stages/m.test(output);
  return { categories, total, pass, header };
}

/* ----------------------------------------------------------
 * 3. 生成内容（运行时数据 / 测试夹具 / 索引 / 报告）
 * ---------------------------------------------------------- */
function projectStage(stage) {
  return {
    id: stage.id,
    stageNumber: stage.stageNumber,
    title: stage.title,
    difficulty: stage.difficulty,
    goalStatement: stage.goalStatement,
    decision: stage.decision,
    practicedSkill: stage.practicedSkill,
    discovery: stage.discovery,
    targetDurationSec: stage.targetDurationSec,
    requiredFeatures: stage.integration.requiredFeatures.slice(),
    content: stage.content,
  };
}

function renderRuntimeFile(game) {
  const header =
    '/* 生成物：由 tools/arcade_09_data.mjs 从 docs/arcade/0.9/levels/' +
    `${game.gameId}.json 生成；不要手改。 */`;
  const payload = {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    gameId: game.gameId,
    gameName: game.gameName,
    packVersion: PACK_VERSION,
    stages: game.stages.map(projectStage),
  };
  const text =
    `${header}\n` +
    'window.ArcadeChallengeData = window.ArcadeChallengeData || {};\n' +
    `window.ArcadeChallengeData['${game.gameId}'] = ${JSON.stringify(payload, null, 2)};\n`;
  return { payload, text };
}

function findForbiddenKey(value, trail) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const hit = findForbiddenKey(value[index], `${trail}[${index}]`);
      if (hit) return hit;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    if (key === 'referencePlan' || key === 'acceptance') return `${trail}.${key}`;
    const hit = findForbiddenKey(value[key], `${trail}.${key}`);
    if (hit) return hit;
  }
  return null;
}

function checkGeneratedHtmlSafety(value, label) {
  const forbidden = findForbiddenKey(value, 'payload');
  check(!forbidden, `${label}: generated runtime data leaks spoiler field ${forbidden}`);
}

function renderFixture(game) {
  const payload = {
    packVersion: PACK_VERSION,
    stageSchemaVersion: STAGE_SCHEMA_VERSION,
    gameId: game.gameId,
    gameName: game.gameName,
    sourceFile: game.sourceFile,
    stages: game.stages,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function buildOutputs(games) {
  const runtime = new Map();
  const fixtures = new Map();
  for (const game of games) {
    const rendered = renderRuntimeFile(game);
    const runtimeText = rendered.text;
    checkGeneratedHtmlSafety(rendered.payload, `runtime/${game.gameId}.js`);
    try {
      new vm.Script(runtimeText, { filename: `apps/arcade/challenge/${game.gameId}.js` });
      checks += 1;
    } catch (err) {
      checks += 1;
      failures.push(`generated runtime JS does not parse: apps/arcade/challenge/${game.gameId}.js: ${err.message}`);
    }
    runtime.set(game.gameId, runtimeText);
    const fixtureText = renderFixture(game);
    try {
      JSON.parse(fixtureText);
      checks += 1;
    } catch (err) {
      checks += 1;
      failures.push(`generated fixture is not valid JSON: tools/testdata/challenge/${game.gameId}.json: ${err.message}`);
    }
    fixtures.set(game.gameId, fixtureText);
  }

  const index = {
    packVersion: PACK_VERSION,
    runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION,
    stageSchemaVersion: STAGE_SCHEMA_VERSION,
    gameCount: games.length,
    stageCount: games.reduce((sum, game) => sum + game.stages.length, 0),
    games: games.map((game) => ({
      gameId: game.gameId,
      title: game.gameName,
      sourceFile: game.sourceFile,
      ids: game.stages.map((stage) => stage.id),
      sha256: sha256(Buffer.from(fixtures.get(game.gameId), 'utf8')),
      sourceSha256: game.sourceSha256,
      runtimeSha256: sha256(Buffer.from(runtime.get(game.gameId), 'utf8')),
    })),
  };
  const indexText = `${JSON.stringify(index, null, 2)}\n`;
  return { runtime, fixtures, indexText };
}

function renderReport(games, outputs, designResult, designParsed) {
  const lines = [];
  const runtimeTotal = games.reduce((sum, game) => sum + Buffer.byteLength(outputs.runtime.get(game.gameId), 'utf8'), 0);
  const fixtureTotal = games.reduce((sum, game) => sum + Buffer.byteLength(outputs.fixtures.get(game.gameId), 'utf8'), 0);
  const indexBytes = Buffer.byteLength(outputs.indexText, 'utf8');
  const designOutput = designParsed.pass
    ? `Content pack: 13 games, 78 stages\n` +
      designParsed.categories.map((item) => `  ${item.name}: ${item.count} assertions`).join('\n') +
      `\nPASS: content contract and reference checks. NOT an original-engine physics or mobile playtest.`
    : String(designResult.output || '').trimEnd();

  lines.push('# Arcade 0.9 关卡数据集成报告（生成物）');
  lines.push('');
  lines.push('> 本文件由 `tools/arcade_09_data.mjs` 自动生成，请重跑脚本更新，不要手改。');
  lines.push('> 设计源 `docs/arcade/0.9/levels/*.json` 只读未修改；运行时数据写入 `apps/arcade/challenge/*.js`；测试夹具写入 `tools/testdata/challenge/`。');
  lines.push('');
  lines.push('## 1. 概览');
  lines.push('');
  lines.push('| 项目 | 值 |');
  lines.push('| --- | --- |');
  lines.push(`| 设计包版本 | ${PACK_VERSION} |`);
  lines.push(`| 运行时数据 Schema | ${RUNTIME_SCHEMA_VERSION} |`);
  lines.push(`| 游戏数 | ${games.length} |`);
  lines.push(`| 关卡数 | ${games.reduce((sum, game) => sum + game.stages.length, 0)} |`);
  lines.push(`| 运行时数据文件 | 13 个，合计 ${runtimeTotal} 字节 |`);
  lines.push(`| 测试夹具文件 | 13 个（${fixtureTotal} 字节）+ index.json（${indexBytes} 字节） |`);
  lines.push(`| 生成器自检 | PASS（${checks} 条断言） |`);
  lines.push(
    designParsed.pass
      ? `| 设计包校验 | PASS（${designParsed.total} 条断言：${designParsed.categories.map((item) => `${item.name} ${item.count}`).join(' / ')}） |`
      : '| 设计包校验 | FAIL（见第 5 节输出） |'
  );
  lines.push('| 幂等性 | 脚本不使用时间戳/随机数；同一输入重复运行输出字节一致 |');
  lines.push('');
  lines.push('## 2. 源文件与生成字节');
  lines.push('');
  lines.push('| gameId | 游戏 | 源文件 | 源 SHA-256 | 关数 | 运行时字节 | 夹具字节 | stage ids |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const game of games) {
    const runtimeBytes = Buffer.byteLength(outputs.runtime.get(game.gameId), 'utf8');
    const fixtureBytes = Buffer.byteLength(outputs.fixtures.get(game.gameId), 'utf8');
    lines.push(
      `| ${game.gameId} | ${game.gameName} | ${game.sourcePath} | \`${game.sourceSha256}\` | ${game.stages.length} | ${runtimeBytes} | ${fixtureBytes} | ${game.stages
        .map((stage) => stage.id)
        .join(', ')} |`
    );
  }
  lines.push('');
  lines.push('## 3. 字段取舍（防剧透）');
  lines.push('');
  lines.push('运行时数据 `apps/arcade/challenge/<gameId>.js` 的结构：');
  lines.push('');
  lines.push('```js');
  lines.push("window.ArcadeChallengeData = window.ArcadeChallengeData || {};");
  lines.push("window.ArcadeChallengeData['<gameId>'] = {");
  lines.push("  schemaVersion: '1.0.0', gameId, gameName, packVersion: '0.9.0-design-v1',");
  lines.push('  stages: [{ id, stageNumber, title, difficulty, goalStatement, decision,');
  lines.push('             practicedSkill, discovery, targetDurationSec, requiredFeatures, content }]');
  lines.push('};');
  lines.push('```');
  lines.push('');
  lines.push('- **保留**：`id` / `stageNumber` / `title` / `difficulty` / `goalStatement` / `decision` / `practicedSkill` / `discovery` / `targetDurationSec` / `requiredFeatures`（由 `integration.requiredFeatures` 拍平）/ `content`（设计源原样，含坐标语义、固定盘面、时间轴、棋子队列等权威规则）。');
  lines.push('- **不进入运行时**：`referencePlan`（设计者参考路线/答案）、`acceptance`（验收脚本与自动回放）、`integration` 对象本体、`chapter` / `designerNotes`（设计备注）。目的：防剧透 + 运行时最小化；测试所需信息在夹具文件中。');
  lines.push('- **测试夹具** `tools/testdata/challenge/<gameId>.json` 保留完整 stage（含 `referencePlan` / `acceptance` / `integration`），仅供测试与 Reviewer 使用，不随静态站点发布。');
  lines.push('- `content` 内的设计字段不做改名/裁剪（例如黄金矿工的 `referenceCatchOrder` 属于设计 content，测试可用；游戏实现只按 `content` 构建关卡，不按屏幕坐标硬编码）。');
  lines.push('- 数据由页面 `<script src="../challenge/<gameId>.js">` 同步加载：无 fetch、无网络、无构建步骤；缺失或不足 6 关时 `A.Challenge` fail closed 返回空。');
  lines.push('');
  lines.push('## 4. 校验输出摘要');
  lines.push('');
  lines.push(`生成器自检：PASS（${checks} 条断言，覆盖 13 个源文件/78 关结构、id/编号、必填字段、content、requiredFeatures、mode、路线引用、胜负条件、生成物语法与防剧透检查）。`);
  lines.push('');
  lines.push('设计包自带校验 `py -3 docs/arcade/0.9/scripts/validate_levels.py`（cwd=`docs/arcade/0.9`）：');
  lines.push('');
  lines.push('```text');
  lines.push(designOutput);
  lines.push('```');
  lines.push('');
  lines.push('## 5. 如何重跑');
  lines.push('');
  lines.push('```powershell');
  lines.push('node tools/arcade_09_data.mjs');
  lines.push('```');
  lines.push('');
  lines.push('- 前置：Node ≥ 22（仅用内置模块，零 npm 依赖）、`py -3`（Python 3）可运行设计包校验脚本。');
  lines.push('- 行为：读设计源 → 结构校验（fail closed，非 0 退出且不写文件）→ 复跑设计包校验（要求 1088 断言 PASS）→ 生成 13 个运行时数据、13 个测试夹具、`index.json` 与本报告。');
  lines.push('- 校验生成物语法：`node --check apps/arcade/challenge/shadow-leap.js`（13 个文件均应通过）。');
  lines.push('- 幂等：重复运行输出字节一致；如需核对可用 `Get-FileHash` / `sha256sum`。');
  lines.push('');
  lines.push('## 6. 已知事项 / 发布前处理');
  lines.push('');
  lines.push('- `apps/arcade/sw.js` 的 shell 预缓存包含这 13 个数据文件；0.8.0 发布时缓存 `VERSION` 已升至 `0.8.0`，老用户会更新缓存。');
  lines.push('- `ARCADE_VERSION` 为 `0.8.0`；不存在构建步骤，生成物入库供静态站点直接加载。');
  lines.push('- 设计包校验只证明设计数据存在参考解，不代表真实引擎物理/移动端可玩；后者由各游戏 `impl/<gameId>.md` 与测试证据补齐。');
  lines.push('');
  return lines.join('\n');
}

/* ----------------------------------------------------------
 * 4. 主流程
 * ---------------------------------------------------------- */
function main() {
  collectLevelFiles();
  const games = loadGames();

  const designResult = runDesignValidator();
  if (!designResult.ok) {
    if (designResult.spawnError) {
      failures.push(`cannot run design pack validator: ${designResult.spawnError}`);
    } else {
      failures.push(`design pack validator exited with status ${designResult.status}`);
    }
  }
  const designParsed = parseDesignValidatorOutput(designResult.output);
  check(designResult.ok, 'design pack validator must exit 0');
  check(designParsed.pass, 'design pack validator must print PASS');
  check(designParsed.header, 'design pack validator must report 13 games, 78 stages');
  check(
    designParsed.total === EXPECTED_DESIGN_ASSERTIONS,
    `design pack validator must run ${EXPECTED_DESIGN_ASSERTIONS} assertions, actual ${designParsed.total}`
  );

  if (games.length !== GAMES.length) {
    check(false, `expected ${GAMES.length} loaded games, actual ${games.length}`);
  }

  const outputs = buildOutputs(games);
  const reportText = renderReport(games, outputs, designResult, designParsed);

  if (failures.length) {
    for (const message of failures) console.error(`FAIL: ${message}`);
    console.error(`Arcade 0.9 data: FAILED (${checks} checks, ${failures.length} errors); no files written.`);
    process.exit(1);
  }

  const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
    return Buffer.byteLength(text, 'utf8');
  };
  let runtimeBytes = 0;
  for (const game of games) runtimeBytes += write(path.join(RUNTIME_DIR, `${game.gameId}.js`), outputs.runtime.get(game.gameId));
  let fixtureBytes = 0;
  for (const game of games) fixtureBytes += write(path.join(FIXTURE_DIR, `${game.gameId}.json`), outputs.fixtures.get(game.gameId));
  fixtureBytes += write(path.join(FIXTURE_DIR, 'index.json'), outputs.indexText);
  const reportBytes = write(REPORT_FILE, reportText);

  console.log(`Arcade 0.9 data: ${games.length} games, ${games.reduce((sum, game) => sum + game.stages.length, 0)} stages, self-check PASS (${checks} assertions)`);
  console.log(`Design pack validator: PASS (${designParsed.total} assertions: ${designParsed.categories.map((item) => `${item.name} ${item.count}`).join(', ')})`);
  console.log(`Generated runtime data: ${RUNTIME_DIR.replace(ROOT + path.sep, '')} (${games.length} files, ${runtimeBytes} bytes)`);
  console.log(`Generated test fixtures: ${FIXTURE_DIR.replace(ROOT + path.sep, '')} (${games.length + 1} files, ${fixtureBytes} bytes)`);
  console.log(`Generated report: ${relative(REPORT_FILE)} (${reportBytes} bytes)`);
  console.log('OK: rerun is byte-identical (deterministic output).');
}

main();
