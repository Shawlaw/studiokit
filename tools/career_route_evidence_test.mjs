#!/usr/bin/env node
/**
 * C2/C4 路线证据组合门禁（第三轮复审 #6）：
 * - 路线 requires.evidenceAll 引用的 token 必须由真实委托 reward.evidence 产出；
 * - 用 story-evidence 内置规则实测：单独一份不足，组合后授予章节旗标；
 * - C2 = E-snowbells.T3 + E-snake-run.T3；C4 = 两份 E + BP-merge-2048.T3（且需 C3）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);
const se = require(path.join(ROOT, 'apps/arcade/career/story-evidence.js'));
const commissions = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/arcade/career/content/commissions.json'), 'utf8'));
const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/arcade/career/content/items.json'), 'utf8'));
const campaign = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/arcade/career/content/campaign.json'), 'utf8'));

let failures = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 600) : '')); if (!ok) failures += 1; };
const produced = new Set();
(commissions.commissions || []).forEach((row) => {
  ((row.reward && row.reward.evidence) || []).forEach((token) => produced.add(token));
});
const routeOf = (chapterId, routeId) => {
  const chapter = (campaign.chapters || []).find((row) => row.chapterId === chapterId);
  return chapter && (chapter.routes || []).find((row) => row.routeId === routeId);
};
const cfg = se.configure({ commissions, items, chapter: [] });
const unlocked = (flag, evidence, flags) => se.storyUnlocked(flag, { evidence, flags: flags || [] });

const c2 = routeOf('C2', 'mining');
const c4 = routeOf('C4', 'build');
const c2ev = (c2 && c2.requires && c2.requires.evidenceAll) || [];
const c4ev = (c4 && c4.requires && c4.requires.evidenceAll) || [];

check('story-evidence configure 成功', cfg.ok === true, cfg);
check('C2 路线引用两份真实产出的 E', c2ev.indexOf('E-snowbells.T3') >= 0 && c2ev.indexOf('E-snake-run.T3') >= 0 && c2ev.every((token) => produced.has(token)), { c2ev });
check('C4 路线引用两份 E + 一份 BP 且均由真实委托产出', c4ev.indexOf('E-mole-whack.T3') >= 0 && c4ev.indexOf('E-block-drop.T3') >= 0 && c4ev.indexOf('BP-merge-2048.T3') >= 0 && c4ev.every((token) => produced.has(token)), { c4ev });
check('C2 单独一份 E 不足，两份 E 授予 C2.research_complete', unlocked('C2.research_complete', ['E-snowbells.T3']) === false && unlocked('C2.research_complete', ['E-snake-run.T3']) === false && unlocked('C2.research_complete', ['E-snowbells.T3', 'E-snake-run.T3']) === true, {
  one: unlocked('C2.research_complete', ['E-snowbells.T3']),
  both: unlocked('C2.research_complete', ['E-snowbells.T3', 'E-snake-run.T3']),
});
check('C4 两份 E 单独不足，补 BP 并满足 C3 后授予 C4.city_power_restored', unlocked('C4.city_power_restored', ['E-mole-whack.T3', 'E-block-drop.T3'], ['C3.truth_found']) === false && unlocked('C4.city_power_restored', ['E-mole-whack.T3', 'E-block-drop.T3', 'BP-merge-2048.T3'], ['C3.truth_found']) === true, {
  two: unlocked('C4.city_power_restored', ['E-mole-whack.T3', 'E-block-drop.T3'], ['C3.truth_found']),
  all: unlocked('C4.city_power_restored', ['E-mole-whack.T3', 'E-block-drop.T3', 'BP-merge-2048.T3'], ['C3.truth_found']),
});
check('C2/C4 路线标题与提示不再提矿工/旧塔无证据项', !/gold-miner|矿工/.test(JSON.stringify(c2)) && !/pendulum-tower\.T3/.test(JSON.stringify(c4)), { c2Hint: c2 && c2.hint, c4Hint: c4 && c4.hint });

if (failures) { console.log(failures + ' failed'); process.exitCode = 1; } else console.log('ROUTE EVIDENCE PASS');
