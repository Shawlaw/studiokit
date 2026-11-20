import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export function loadChallengeFixture(gameId) {
  const file = path.join(ROOT, 'tools', 'testdata', 'challenge', gameId + '.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = new Map(data.stages.map((stage) => [stage.id, stage]));
  return { data, byId, stage(id) {
    const found = byId.get(id);
    if (!found) throw new Error('fixture missing stage ' + id);
    return found;
  } };
}

export function parseMovesRLE(plan) {
  if (!Array.isArray(plan)) throw new Error('referencePlan.movesRLE is not an array');
  const KEY = { R: 'ArrowRight', L: 'ArrowLeft', U: 'ArrowUp', D: 'ArrowDown' };
  const out = [];
  for (const token of plan) {
    const match = /^([RLUD])(\d+)$/.exec(String(token));
    if (!match) throw new Error('invalid movesRLE token ' + token);
    const key = KEY[match[1]];
    const count = Number(match[2]);
    for (let i = 0; i < count; i += 1) out.push(key);
  }
  return out;
}

import { createHash } from 'node:crypto';

export function canonicalHash(value) {
  const text = JSON.stringify(value, Object.keys(value).sort());
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
}
