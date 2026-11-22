#!/usr/bin/env node
/**
 * 0.15 路由与 16 源入口归一化测试（D15-12 / D15-13 的纯函数部分，无 Chrome）
 *
 * 覆盖：
 * - router.detectGameId：GitHub Pages 子路径 / Cloudflare 无后缀 / 大写 / 尾斜杠 / URL 编码 / 非法路径；
 * - careerBase/contentUrl：以 bridge.js 的 document.currentScript 推断 apps/arcade/ 基址；
 * - isTestMode/isHashTest：?careerTest=1 与既有 #test 探针共存；
 * - entry-router：真实 16 条线索两两 greeting 不同、单条即可进入 LOCAL、未来第 17 源不写死数量。
 *
 * 运行：node tools/career_entry_router_test.mjs
 * 退出码：0 全 PASS；1 有 FAIL；2 用法错误（无参数）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const router = require(path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'router.js'));
const entry = require(path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'entry-router.js'));
const clues = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'apps', 'arcade', 'career', 'content', 'clues.json'), 'utf8')).clues;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? '' : detail === undefined ? '' : String(detail) });
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), 'expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual));
}
function loc(pathname, search, hash) {
  return { pathname, search: search || '', hash: hash || '' };
}

/* ---------- R-01 detectGameId ---------- */
{
  eq('R-01a GH 子路径 .html', router.detectGameId(loc('/studiokit/apps/arcade/games/memory-flip.html')), 'memory-flip');
  eq('R-01b CF 无后缀', router.detectGameId(loc('/apps/arcade/games/memory-flip')), 'memory-flip');
  eq('R-01c 大写 + .HTML', router.detectGameId(loc('/apps/arcade/games/Memory-Flip.HTML')), 'memory-flip');
  eq('R-01d 尾斜杠', router.detectGameId(loc('/apps/arcade/games/snake-run/')), 'snake-run');
  eq('R-01e URL 编码', router.detectGameId(loc('/apps/arcade/games/memory%2Dflip.html')), 'memory-flip');
  eq('R-01f 本地 file:// 风格', router.detectGameId(loc('/repo/apps/arcade/games/pendulum-tower.html')), 'pendulum-tower');
  eq('R-01g 中心页返回 null', router.detectGameId(loc('/apps/arcade/')), null);
  eq('R-01h 空 games 目录返回 null', router.detectGameId(loc('/apps/arcade/games/')), null);
  eq('R-01i 子目录不猜测', router.detectGameId(loc('/apps/arcade/games/sub/x.html')), null);
  eq('R-01j 无 games 段返回 null', router.detectGameId(loc('/foo')), null);
  eq('R-01k 空 location 返回 null', router.detectGameId(null), null);
}

/* ---------- R-02 careerBase / contentUrl ---------- */
{
  const doc = {
    currentScript: { src: 'http://127.0.0.1:8765/apps/arcade/career/bridge.js' },
    location: { href: 'http://127.0.0.1:8765/apps/arcade/games/memory-flip.html', search: '', hash: '' },
  };
  eq('R-02a careerBase 相对 bridge.js', router.careerBase(doc), 'http://127.0.0.1:8765/apps/arcade/');
  eq('R-02b contentUrl', router.contentUrl('clues.json', doc), 'http://127.0.0.1:8765/apps/arcade/career/content/clues.json');
  const gh = {
    currentScript: { src: 'https://shawlaw.github.io/studiokit/apps/arcade/career/bridge.js' },
    location: { href: 'https://shawlaw.github.io/studiokit/apps/arcade/games/memory-flip.html', search: '', hash: '' },
  };
  eq('R-02c GH 子路径 base', router.careerBase(gh), 'https://shawlaw.github.io/studiokit/apps/arcade/');
  const cf = {
    currentScript: { src: 'https://studiokit.pages.dev/apps/arcade/career/bridge.js' },
    location: { href: 'https://studiokit.pages.dev/apps/arcade/games/memory-flip', search: '', hash: '' },
  };
  eq('R-02d CF 根路径 base', router.careerBase(cf), 'https://studiokit.pages.dev/apps/arcade/');
  eq('R-02e 绝对文件名不被当成根绝对路径', router.contentUrl('/clues.json', doc).indexOf('http://127.0.0.1:8765/apps/arcade/career/content/clues.json'), 0);
}

/* ---------- R-03 测试模式 ---------- */
{
  check('R-03a ?careerTest=1', router.isTestMode(loc('/games/x.html', '?careerTest=1')) === true);
  check('R-03b ?careerTest=1 与其它参数', router.isTestMode(loc('/games/x.html', '?a=1&careerTest=1')) === true);
  check('R-03c ?careerTest=0 不命中', router.isTestMode(loc('/games/x.html', '?careerTest=0')) === false);
  check('R-03d 无参数不命中', router.isTestMode(loc('/games/x.html', '')) === false);
  check('R-03e #test 被识别', router.isHashTest(loc('/games/x.html', '', '#test')) === true);
  check('R-03f ?careerTest=1#test 两者都命中', router.isTestMode(loc('/games/x.html', '?careerTest=1', '#test')) && router.isHashTest(loc('/games/x.html', '?careerTest=1', '#test')));
  check('R-03g 无 #test 不命中', router.isHashTest(loc('/games/x.html', '', '')) === false);
}

/* ---------- R-04 16 源入口归一化（真实内容） ---------- */
{
  eq('R-04a 真实线索 16 条', clues.length, 16);
  const greetings = [];
  let ok = true;
  clues.forEach((clue) => {
    const g = entry.greetingForClue(clue);
    const address = entry.addressOf(clue);
    if (!g || !address || g.length > entry.MAX_GREETING_CHARS) ok = false;
    greetings.push(g);
    const info = entry.entryForClue(clue, null);
    if (!info || info.sourceGame !== clue.gameId || info.clueId !== clue.clueId || !info.greeting || !info.address) ok = false;
    if (!entry.canEnterLocal(null, clue)) ok = false;
  });
  check('R-04b 每条线索都有 greeting/address 且可单源进入 LOCAL', ok);
  eq('R-04c 16 条 greeting 两两不同', new Set(greetings).size, greetings.length);
  const origins = entry.normalizeOrigins(clues);
  eq('R-04d normalizeOrigins 16 条', origins.length, 16);
  check('R-04e originKey 稳定', clues.every((clue) => entry.originKey(clue) === entry.originKey(clue)));
  eq('R-04f LOCAL_STAGE', entry.LOCAL_STAGE, 'LOCAL');
}

/* ---------- R-05 未发现时不泄露 / 已发现时可进入 ---------- */
{
  const clue = clues[0];
  const otherState = { clues: { 'CL-not-this-one': { clueId: 'CL-not-this-one' } }, firstClueId: 'CL-not-this-one' };
  eq('R-05a 未发现该线索时不返回入口', entry.entryForClue(clue, otherState), null);
  const ownState = { clues: { [clue.clueId]: { clueId: clue.clueId } }, firstClueId: clue.clueId };
  const info = entry.entryForClue(clue, ownState);
  check('R-05b 已发现该线索时返回入口', info && info.clueId === clue.clueId);
  check('R-05c canEnterLocal 只认已发现', entry.canEnterLocal(ownState, clue) === true && entry.canEnterLocal(otherState, clue) === false);
}

/* ---------- R-06 未来第 17 源不写死数量 ---------- */
{
  const virtual = {
    clueId: 'CL-virtual-coffee',
    gameId: 'virtual-coffee',
    family: 'record',
    title: '虚拟咖啡店',
    ambientText: '杯底压着一张手写便条。',
    letter: { sender: '夜班店员', body: '便条是常客留下的，我把它收在杯垫下。', address: '折光港港口咖啡角 · 杯垫架', actionLabel: '按地址投递' },
    trigger: { kind: 'order.fulfilled', atLeast: 1 },
    guarantee: { maxEligibleRuns: 3 },
    next: { kind: 'letter' },
  };
  const virtualGreeting = entry.greetingForClue(virtual);
  check('R-06a 第 17 源 greeting 可用', !!virtualGreeting && virtualGreeting.length <= entry.MAX_GREETING_CHARS);
  const info = entry.entryForClue(virtual, null);
  check('R-06b 第 17 源可独立进入 LOCAL', info && info.sourceGame === 'virtual-coffee' && info.clueId === 'CL-virtual-coffee');
  eq('R-06c normalizeOrigins 不写死 16（3 条）', entry.normalizeOrigins(clues.slice(0, 3)).length, 3);
  const many = [];
  for (let i = 0; i < 20; i += 1) many.push(Object.assign({}, virtual, { clueId: 'CL-synthetic-' + i, gameId: 'synthetic-' + i }));
  eq('R-06d normalizeOrigins 支持 20 条', entry.normalizeOrigins(many).length, 20);
  check('R-06e 未知/空线索安全返回', !entry.greetingForClue(null));
}

/* ---------- 汇总 ---------- */
let failed = 0;
for (const item of results) {
  if (item.ok) console.log('PASS  ' + item.name);
  else {
    failed += 1;
    console.log('FAIL  ' + item.name + (item.detail ? ' — ' + item.detail : ''));
  }
}
console.log('');
console.log(`${results.length - failed}/${results.length} checks passed`);
if (failed > 0) {
  console.error(`FAILED: ${failed} check(s) failed`);
  process.exit(1);
}
console.log('PASS  career router / entry-router test');
