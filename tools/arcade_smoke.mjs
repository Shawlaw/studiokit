#!/usr/bin/env node
/**
 * 街机厅无头浏览器冒烟测试。
 * 零 npm 依赖：Node 内置 http + WebSocket + 本机 Chrome DevTools Protocol。
 * 运行：node tools/arcade_smoke.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.join(ROOT, 'test-artifacts');
const SERVER_PORT = 8765;
const CDP_PORT = 9333;
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let filePath = path.join(ROOT, urlPath);
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err));
    }
  });
  return new Promise((resolve) => server.listen(SERVER_PORT, '127.0.0.1', () => resolve(server)));
}

async function waitForJson(url, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (err) {
      /* retry */
    }
    await sleep(120);
  }
  throw new Error('timeout waiting for ' + url);
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
    this.errors = [];
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.errors.push('exception: ' + (d.exception?.description || d.text || 'unknown'));
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        const entry = msg.params.entry;
        const url = entry.url || '';
        if (url.includes('favicon.ico')) return;
        this.errors.push('log: ' + entry.text + (url ? ' [' + url + ']' : ''));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.errors.push('console: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
      const handlers = this.events.get(msg.method);
      if (handlers) handlers.forEach((fn) => fn(msg.params));
    });
  }

  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.events.has(method)) this.events.set(method, new Set());
    this.events.get(method).add(fn);
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error('evaluate failed: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text));
    }
    return result.result?.value;
  }

  async navigate(url) {
    this.errors = [];
    await this.send('Page.navigate', { url });
    await sleep(220);
    for (let i = 0; i < 60; i++) {
      try {
        const state = await this.evaluate('document.readyState');
        if (state === 'complete') break;
      } catch (err) {
        /* page may still be navigating */
      }
      await sleep(80);
    }
    await sleep(180);
  }

  async screenshot(name) {
    const shot = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ARTIFACTS, name), Buffer.from(shot.data, 'base64'));
  }

  async click(selector) {
    const ok = await this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
    if (!ok) throw new Error('selector not found: ' + selector);
  }

  async text(selector) {
    return this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.textContent : null; })()`);
  }

  async key(key, type = 'both') {
    const code = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, ' ': 32 }[key] || key.toUpperCase().charCodeAt(0);
    const opts = { key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, bubbles: true };
    if (type !== 'up') await this.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify(opts)}))`);
    if (type !== 'down') await this.evaluate(`window.dispatchEvent(new KeyboardEvent('keyup', ${JSON.stringify(opts)}))`);
  }

  async pointer(x, y, type) {
    await this.evaluate(`(() => {
      const c = document.querySelector('.game-canvas');
      if (!c) return false;
      const r = c.getBoundingClientRect();
      const cx = r.left + (${x} / 420) * r.width;
      const cy = r.top + (${y} / 740) * r.height;
      c.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { clientX: cx, clientY: cy, pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true }));
      return true;
    })()`);
  }

  async tap(x, y) {
    await this.pointer(x, y, 'pointerdown');
    await sleep(30);
    await this.pointer(x, y, 'pointerup');
  }

  async buttonPointer(selector, type = 'pointerdown') {
    const ok = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true }));
      return true;
    })()`);
    if (!ok) throw new Error('button not found: ' + selector);
  }

  async drag(x1, y1, x2, y2) {
    await this.pointer(x1, y1, 'pointerdown');
    await sleep(30);
    await this.pointer(x2, y2, 'pointermove');
    await sleep(30);
    await this.pointer(x2, y2, 'pointerup');
  }

  close() {
    try {
      this.ws.close();
    } catch (err) {
      /* ignore */
    }
  }
}

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'studiokit-arcade-'));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--remote-allow-origins=*',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      '--window-size=420,900',
      '--hide-scrollbars',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let cdp = null;
  try {
    const version = await waitForJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const target = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' }).then((r) => r.json());
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.ready();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });

    const base = `http://127.0.0.1:${SERVER_PORT}`;

    /* ---------- 门户入口 ---------- */
    await cdp.navigate(base + '/');
    await sleep(450);
    const home = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('.tool-card')];
      const arcade = cards.find((c) => c.textContent.includes('街机厅 Arcade'));
      return { cards: cards.length, href: arcade ? (arcade.getAttribute('href') || '') : '', version: arcade ? arcade.textContent : '' };
    })()`);
    assert(home.cards >= 2, 'home cards=' + home.cards);
    assert(home.href.indexOf('apps/arcade') !== -1, 'arcade card not clickable: ' + JSON.stringify(home));
    assert(home.version.indexOf('0.3.0') !== -1, 'arcade version missing on home card');
    record('门户街机厅卡片可点击且版本 0.3.0', true);

    /* ---------- 中心页 ---------- */
    await cdp.navigate(base + '/apps/arcade/');
    const hallInfo = await cdp.evaluate(`({
      version: window.Arcade && Arcade.version,
      games: window.Arcade && Arcade.GAMES.length,
      cards: document.querySelectorAll('.hall-card').length,
      runs: window.Arcade && Arcade.RunSave.count()
    })`);
    assert(hallInfo.version === '0.3.0', 'version is ' + hallInfo.version);
    assert(hallInfo.games === 13, 'game count is ' + hallInfo.games);
    assert(hallInfo.cards === 13, 'card count is ' + hallInfo.cards);
    record('中心页 13 款游戏与版本 0.3.0', true);

    await cdp.evaluate(`(() => { const i = document.querySelector('[data-search]'); i.value = '雪铃'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(120);
    let count = await cdp.evaluate(`document.querySelectorAll('.hall-card').length`);
    assert(count === 1, 'search count is ' + count);
    record('中心页搜索「雪铃」', true);

    await cdp.evaluate(`(() => { const i = document.querySelector('[data-search]'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(80);
    await cdp.evaluate(`(() => { const chip = [...document.querySelectorAll('.hall-chip')].find((c) => c.dataset.category === '反应'); chip && chip.click(); })()`);
    await sleep(100);
    count = await cdp.evaluate(`document.querySelectorAll('.hall-card').length`);
    assert(count === 3, 'category count is ' + count);
    record('中心页类型筛选「反应」', true);
    await cdp.evaluate(`(() => { const chip = [...document.querySelectorAll('.hall-chip')].find((c) => c.dataset.category === '全部'); chip && chip.click(); })()`);
    await cdp.screenshot('hall.png');

    /* ---------- 每个游戏的基础闭环 ---------- */
    const games = await cdp.evaluate(`Arcade.GAMES.map((g) => ({ id: g.id, file: g.file, name: g.name }))`);
    for (const game of games) {
      const url = `${base}/apps/arcade/games/${game.file}`;
      await cdp.navigate(url);
      const info = await cdp.evaluate(`({ hasArcade: !!window.Arcade, overlay: document.querySelector('[data-overlay]') ? !document.querySelector('[data-overlay]').hidden : false, title: document.querySelector('[data-ov-title]')?.textContent })`);
      assert(info.hasArcade, game.id + ': Arcade missing');
      assert(info.overlay, game.id + ': start overlay missing');
      await cdp.click('[data-ov-btn]');
      await sleep(450);
      const playing = await cdp.evaluate(`document.querySelector('[data-overlay]').hidden`);
      assert(playing, game.id + ': overlay did not hide');
      await cdp.click('[data-pause]');
      await sleep(120);
      const pauseTitle = await cdp.text('[data-ov-title]');
      assert(pauseTitle && pauseTitle.indexOf('已暂停') !== -1, game.id + ': pause title=' + pauseTitle);
      const run = await cdp.evaluate(`(() => { const raw = localStorage.getItem('studiokit:arcade:runs:v1'); if (!raw) return null; const d = JSON.parse(raw); return d.games && d.games[${JSON.stringify(game.id)}] ? d.games[${JSON.stringify(game.id)}].summary : null; })()`);
      assert(run, game.id + ': run save missing');
      await cdp.click('[data-ov-btn]');
      await sleep(160);
      await cdp.navigate(url);
      const resumeTitle = await cdp.text('[data-ov-title]');
      assert(resumeTitle && resumeTitle.indexOf('继续上次') !== -1, game.id + ': resume title=' + resumeTitle);
      await cdp.click('[data-ov-btn]');
      await sleep(260);
      const resumed = await cdp.evaluate(`document.querySelector('[data-overlay]').hidden`);
      assert(resumed, game.id + ': resume overlay did not hide');
      if (cdp.errors.length) throw new Error(game.id + ': console errors: ' + cdp.errors.join(' | '));
      await cdp.screenshot('game-' + game.id + '.png');
      record(`${game.name} 开始/暂停/存档/续玩`, true);
    }

    /* ---------- 各游戏关键交互 ---------- */
    const actions = {
      'memory-flip': async () => {
        await cdp.click('[data-ov-btn]');
        await sleep(2600);
        await cdp.tap(100, 250);
        await cdp.tap(150, 250);
        await sleep(900);
      },
      'merge-2048': async () => {
        await cdp.click('[data-ov-btn]');
        await sleep(200);
        await cdp.key('ArrowLeft');
        await sleep(250);
        await cdp.key('ArrowDown');
        await sleep(250);
      },
      'brick-breaker': async () => {
        await cdp.click('[data-ov-btn]');
        await cdp.tap(210, 600);
        await sleep(1800);
      },
      'gravity-flip': async () => {
        await cdp.click('[data-ov-btn]');
        await sleep(1200);
        await cdp.tap(200, 400);
        await sleep(1000);
        const score = Number(await cdp.text('[data-hud-score]'));
        assert(score > 0, 'gravity score is ' + score);
      },
      'snake-run': async () => {
        await cdp.click('[data-ov-btn]');
        await sleep(300);
        await cdp.key('ArrowDown');
        await sleep(900);
      },
      'mole-whack': async () => {
        await cdp.click('[data-ov-btn]');
        await sleep(800);
        for (const hole of [[90, 300], [210, 300], [330, 300], [90, 430], [210, 430], [330, 430], [90, 560], [210, 560], [330, 560]]) {
          await cdp.tap(hole[0], hole[1]);
          await sleep(60);
        }
        await sleep(300);
      },
      'star-raid': async () => {
        await cdp.click('[data-ov-btn]');
        await sleep(1800);
      },
      'shadow-leap': async () => {
        await cdp.click('[data-ov-btn]');
        await sleep(500);
        await cdp.key('ArrowRight', 'down');
        await sleep(700);
        await cdp.key('ArrowRight', 'up');
        await sleep(500);
      },
      'pendulum-tower': async () => {
        await cdp.click('[data-ov-btn]');
        await sleep(700);
        await cdp.tap(210, 350);
        await sleep(900);
      },
      'snowbells': async () => {
        await cdp.click('[data-ov-btn]');
        await sleep(2200);
        const score = Number(await cdp.text('[data-hud-score]'));
        assert(score > 0, 'snowbells first bell not reached, score=' + score);
      },
      'gold-miner': async () => {
        await cdp.click('[data-ov-btn]');
        await sleep(500);
        await cdp.tap(210, 500);
        await sleep(1300);
      },
      'road-rush': async () => {
        await cdp.click('[data-ov-btn]');
        await sleep(600);
        await cdp.key('ArrowLeft');
        await sleep(900);
      },
    };
    for (const [id, action] of Object.entries(actions)) {
      const game = games.find((g) => g.id === id);
      await cdp.navigate(`${base}/apps/arcade/games/${game.file}`);
      try {
        await action();
      } catch (err) {
        throw new Error(id + ' action failed: ' + err.message);
      }
      if (cdp.errors.length) throw new Error(id + ' interaction console errors: ' + cdp.errors.join(' | '));
      await cdp.screenshot('action-' + id + '.png');
      record(`${game.name} 关键交互`, true);
    }

    /* ---------- 星海突击四种弹种 Buff ---------- */
    await cdp.evaluate(`window.Arcade && Arcade.RunSave.clear('star-raid')`);
    await cdp.navigate(base + '/apps/arcade/games/star-raid.html#test');
    await cdp.click('[data-ov-btn]');
    await sleep(300);
    for (const type of ['spread', 'laser', 'homing', 'rapid']) {
      const ok = await cdp.evaluate(`window.__arcadeTest && window.__arcadeTest.giveBuff(${JSON.stringify(type)})`);
      assert(ok, 'star-raid test hook missing');
      await sleep(500);
      const info = await cdp.evaluate(`window.__arcadeTest.info()`);
      assert(info.weapon === type, `star-raid buff ${type} not active: ` + JSON.stringify(info));
      const buffHud = await cdp.text('[data-hud-weapon]');
      assert(buffHud && buffHud.length > 0, 'star-raid buff HUD missing');
      await cdp.screenshot('buff-' + type + '.png');
    }
    await cdp.evaluate(`window.__arcadeTest.giveBuff('normal')`);
    await cdp.evaluate(`window.__arcadeTest.spawnPickup('spread')`);
    await sleep(900);
    const pickupInfo = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(pickupInfo.weapon === 'spread', 'star-raid pickup not collected: ' + JSON.stringify(pickupInfo));
    record('星海突击 散射/激光/追踪/速射 Buff + 实际拾取', true);

    /* ---------- 中心页续玩区与导出导入 ---------- */
    /* 先为每款游戏各留一条未完成进度，确保续玩区覆盖全部 13 款。 */
    for (const game of games) {
      await cdp.evaluate(`window.Arcade && Arcade.RunSave.clear(${JSON.stringify(game.id)})`);
      await cdp.navigate(`${base}/apps/arcade/games/${game.file}`);
      await cdp.click('[data-ov-btn]');
      await sleep(180);
      await cdp.click('[data-pause]');
      await sleep(100);
    }
    await cdp.navigate(base + '/apps/arcade/');
    const resumeInfo = await cdp.evaluate(`(() => ({
      visible: document.querySelectorAll('.hall-resume-card').length,
      more: document.querySelector('[data-resume-more]') ? document.querySelector('[data-resume-more]').textContent : '',
      runs: Arcade.RunSave.count()
    }))()`);
    assert(resumeInfo.runs === 13, 'run count is ' + resumeInfo.runs);
    assert(resumeInfo.visible === 6, 'resume visible cards is ' + resumeInfo.visible);
    assert(resumeInfo.more.indexOf('13') !== -1, 'resume expand button missing: ' + resumeInfo.more);
    await cdp.screenshot('hall-resume.png');
    await cdp.evaluate(`(() => { const b = document.querySelector('[data-resume-more] button'); if (b) b.click(); })()`);
    await sleep(120);
    const expanded = await cdp.evaluate(`document.querySelectorAll('.hall-resume-card').length`);
    assert(expanded === 13, 'resume expanded cards is ' + expanded);
    const exportCheck = await cdp.evaluate(`(() => {
      const text = Arcade.Progress.exportText();
      const data = JSON.parse(text);
      const imported = Arcade.Progress.importText(text);
      return { runs: Object.keys(data.runs || {}).length, ok: imported.ok, runCount: imported.runCount, games: Object.keys(data.state || {}).length };
    })()`);
    assert(exportCheck.ok && exportCheck.runs >= 13 && exportCheck.runCount >= 13, 'export/import runs failed: ' + JSON.stringify(exportCheck));
    record('中心页续玩区 13 条折叠/展开 + 导出/导入含局内进度', true);
    await cdp.screenshot('hall-resume.png');

    /* ---------- 自然结束一局：结算写入最高分并清掉局内存档 ---------- */
    await cdp.evaluate(`Arcade.RunSave.clear('snake-run')`);
    await cdp.navigate(base + '/apps/arcade/games/snake-run.html');
    await cdp.click('[data-ov-btn]');
    await sleep(9000);
    const overState = await cdp.evaluate(`(() => ({
      overlay: !document.querySelector('[data-overlay]').hidden,
      title: document.querySelector('[data-ov-title]').textContent,
      plays: Arcade.Progress.get('snake-run').plays,
      run: !!Arcade.RunSave.get('snake-run')
    }))()`);
    assert(overState.overlay && overState.title.indexOf('游戏结束') !== -1, 'snake did not finish: ' + JSON.stringify(overState));
    assert(overState.plays >= 1, 'snake plays not recorded');
    assert(overState.run === false, 'snake run not cleared after game over');
    record('贪吃蛇 自然结束/记录写入/局内档清理', true);
    await cdp.screenshot('gameover-snake.png');

    /* ---------- 375px 窄屏无横向溢出 ---------- */
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 667, deviceScaleFactor: 1, mobile: true });
    const pages = ['/apps/arcade/', ...games.map((g) => '/apps/arcade/games/' + g.file)];
    for (const pagePath of pages) {
      await cdp.navigate(base + pagePath);
      const overflow = await cdp.evaluate(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, canvas: (() => { const c = document.querySelector('.game-canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() })`);
      assert(overflow.sw <= overflow.cw + 1, pagePath + ' horizontal overflow ' + overflow.sw + '>' + overflow.cw);
      if (overflow.canvas) {
        assert(overflow.canvas.w <= 375 && overflow.canvas.h > 300, pagePath + ' canvas size ' + JSON.stringify(overflow.canvas));
      }
    }
    record('375px 窄屏 14 页无横向溢出', true);

    /* ---------- 俄罗斯方块触屏控制面板 ---------- */
    await cdp.navigate(base + '/apps/arcade/games/block-drop.html');
    const padVisible = await cdp.evaluate(`(() => { const p = document.querySelector('[data-touch-pad]'); return p ? getComputedStyle(p).display : 'missing'; })()`);
    assert(padVisible === 'grid', 'touch pad display=' + padVisible);
    await cdp.click('[data-ov-btn]');
    await sleep(220);
    await cdp.buttonPointer('[data-touch="hard"]', 'pointerdown');
    await cdp.buttonPointer('[data-touch="hard"]', 'pointerup');
    await sleep(350);
    const touchScore = Number(await cdp.text('[data-hud-score]'));
    assert(touchScore > 0, 'touch hard-drop score=' + touchScore);
    await cdp.buttonPointer('[data-touch="left"]', 'pointerdown');
    await sleep(320);
    await cdp.buttonPointer('[data-touch="left"]', 'pointerup');
    await cdp.buttonPointer('[data-touch="rotate"]', 'pointerdown');
    await cdp.buttonPointer('[data-touch="rotate"]', 'pointerup');
    await cdp.buttonPointer('[data-touch="soft"]', 'pointerdown');
    await sleep(260);
    await cdp.buttonPointer('[data-touch="soft"]', 'pointerup');
    if (cdp.errors.length) throw new Error('touch pad console errors: ' + cdp.errors.join(' | '));
    record('俄罗斯方块 375px 触屏按钮面板可操作', true);
    await cdp.screenshot('touch-block-drop.png');

    await cdp.screenshot('narrow-hall.png');

    /* ---------- 清理测试产生的本地数据 ---------- */
    await cdp.evaluate(`localStorage.clear()`);
  } finally {
    if (cdp) cdp.close();
    try {
      chrome.kill();
    } catch (err) {
      /* ignore */
    }
    server.close();
    await sleep(300);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (err) {
      /* ignore */
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.stack || err);
  process.exitCode = 1;
});
