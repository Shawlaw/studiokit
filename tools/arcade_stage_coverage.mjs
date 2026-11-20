#!/usr/bin/env node
/**
 * Build the 78-stage evidence coverage matrix from static scenario metadata.
 *
 * This does not claim a scenario passed; it only records which stages have a declared
 * replay proof and which evidence tier. Browser results remain authoritative.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS = path.join(ROOT, 'docs', 'arcade', '0.9', 'levels');
const MODULES = path.join(ROOT, 'tools', 'challenge');
const OUT = path.join(ROOT, 'test-artifacts', 'stage-coverage.json');

const GAMES = fs.readdirSync(LEVELS)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replace(/\.json$/, ''))
  .sort();

const byStage = new Map();
for (const gameId of GAMES) {
  const data = JSON.parse(fs.readFileSync(path.join(LEVELS, gameId + '.json'), 'utf8'));
  for (const stage of data.stages) {
    byStage.set(stage.id, {
      stageId: stage.id,
      gameId,
      title: stage.title,
      referencePlan: Object.keys(stage.referencePlan || {}),
      declaredEvidence: [],
    });
  }
}

function collectEvidence(text, source, fallback) {
  const evidence = [];
  const re = /evidence\s*[:=]\s*['"]([^'"]+)['"]/gi;
  let match;
  while ((match = re.exec(text))) evidence.push(match[1]);
  if (!evidence.length) evidence.push(fallback);
  const tiers = [...new Set(evidence)];

  /* 显式 stageId（字面量） */
  const literal = [...text.matchAll(/([a-z0-9-]+-C\d{2})/gi)].map((item) => item[1]);
  const covered = new Set(literal.filter((id) => byStage.has(id)));

  /* 全量回放：模块从夹具读取全部 stages 并循环，标题常写「C01–C06 / 全量 / 逐关」。 */
  const fullSweep = /FIXTURE\.stages|STAGE_IDS|stageData\(STAGE_IDS|全量参考|逐关|C01\s*[–-]\s*C06|六关真实输入连续/.test(text);
  if (fullSweep) {
    const moduleGame = /gameId\s*[:=]\s*['"]([a-z0-9-]+)['"]/.exec(text)
      || /const\s+GAME_ID\s*=\s*['"]([a-z0-9-]+)['"]/.exec(text);
    const gameId = moduleGame ? moduleGame[1] : null;
    if (gameId) {
      for (const [stageId, row] of byStage) {
        if (row.gameId !== gameId) continue;
        covered.add(stageId);
      }
    }
  }

  for (const stageId of covered) {
    const row = byStage.get(stageId);
    if (row) row.declaredEvidence.push({ source, evidence: tiers, fullSweep });
  }
  return covered.size;
}

for (const file of fs.readdirSync(MODULES).filter((name) => name.endsWith('.mjs')).sort()) {
  const text = fs.readFileSync(path.join(MODULES, file), 'utf8');
  collectEvidence(text, file, 'unspecified');
}

const rows = [...byStage.values()];
const summary = {};
for (const row of rows) {
  const tiers = new Set(row.declaredEvidence.flatMap((item) => item.evidence));
  const tier = tiers.has('real-input-replay') ? 'real-input-replay'
    : tiers.has('engine-replay') ? 'engine-replay'
      : tiers.has('ui-only') ? 'ui-only' : 'absent';
  summary[tier] = (summary[tier] || 0) + 1;
}
const payload = { generatedAt: new Date().toISOString(), stageCount: rows.length, summary, stages: rows };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
console.log('PASS  stage coverage matrix: ' + rows.length + ' stages → ' + JSON.stringify(summary));
console.log('WROTE ' + path.relative(ROOT, OUT));
