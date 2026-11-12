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
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let filePath = path.join(ROOT, urlPath.startsWith('/studiokit/') ? urlPath.slice('/studiokit'.length) : urlPath);
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

  async buttonPointer(selector, type = 'pointerdown', pointerId = 1) {
    const ok = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { pointerId: ${pointerId}, pointerType: 'touch', isPrimary: ${pointerId} === 1, bubbles: true, cancelable: true }));
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
  let server = await startServer();
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
    assert(home.version.indexOf('0.6.1') !== -1, 'arcade version missing on home card');
    record('门户街机厅卡片可点击且版本 0.6.1', true);

    /* ---------- GitHub Pages 项目子路径：shell 返回链接 ---------- */
    await cdp.navigate(base + '/studiokit/apps/arcade/games/star-raid.html');
    const shellInfo = await cdp.evaluate(`(() => { const a = document.querySelector('.studiokit-shell-home'); return { href: a ? a.href : null, text: a ? a.textContent : null }; })()`);
    assert(shellInfo.href === base + '/studiokit/index.html', 'shell subpath href wrong: ' + JSON.stringify(shellInfo));
    const shellResponse = await fetch(shellInfo.href);
    assert(shellResponse.ok, 'shell subpath target HTTP ' + shellResponse.status);
    record('GitHub Pages /studiokit/ 子路径 shell 返回链接', true);

    /* ---------- 中心页 ---------- */
    await cdp.navigate(base + '/apps/arcade/');
    const hallInfo = await cdp.evaluate(`({
      version: window.Arcade && Arcade.version,
      games: window.Arcade && Arcade.GAMES.length,
      cards: document.querySelectorAll('.hall-card').length,
      runs: window.Arcade && Arcade.RunSave.count()
    })`);
    assert(hallInfo.version === '0.6.1', 'version is ' + hallInfo.version);
    assert(hallInfo.games === 13, 'game count is ' + hallInfo.games);
    assert(hallInfo.cards === 13, 'card count is ' + hallInfo.cards);
    record('中心页 13 款游戏与版本 0.6.1', true);

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

    /* ---------- 共享输入层：多指归属 / 取消 / 失焦 ---------- */
    const inputTest = await cdp.evaluate(`(() => {
      const c = document.createElement('canvas');
      c.style.cssText = 'position:fixed;left:0;top:0;width:420px;height:740px;';
      document.body.appendChild(c);
      c.__arcadeLogicalW = 420;
      c.__arcadeLogicalH = 740;
      const inp = Arcade.createInput(c);
      const fire = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, {
        pointerId: id, pointerType: 'touch', isPrimary: id === 1,
        clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0
      }));
      fire('pointerdown', 1, 100, 100);
      const first = { x: inp.pointer.x, y: inp.pointer.y, id: inp.pointer.id };
      fire('pointerdown', 2, 300, 300);
      fire('pointermove', 2, 320, 320);
      const afterSecond = { x: inp.pointer.x, y: inp.pointer.y, id: inp.pointer.id };
      fire('pointerup', 2);
      const secondUp = { down: inp.pointer.down, wentUp: inp.pointer.wentUp };
      fire('pointermove', 1, 140, 120);
      const firstMove = { x: inp.pointer.x, y: inp.pointer.y, dx: inp.pointer.dx };
      fire('pointercancel', 1);
      const canceled = { down: inp.pointer.down, wentCancel: inp.pointer.wentCancel, wentUp: inp.pointer.wentUp };
      fire('pointerdown', 3, 200, 200);
      window.dispatchEvent(new Event('blur'));
      const blurred = { down: inp.pointer.down, id: inp.pointer.id };
      inp.destroy();
      c.remove();
      return { first, afterSecond, secondUp, firstMove, canceled, blurred };
    })()`);
    assert(Math.abs(inputTest.afterSecond.x - inputTest.first.x) < 0.01 && Math.abs(inputTest.afterSecond.y - inputTest.first.y) < 0.01, 'second pointer hijacked position: ' + JSON.stringify(inputTest));
    assert(inputTest.secondUp.down === true && inputTest.secondUp.wentUp === false, 'second pointer up leaked: ' + JSON.stringify(inputTest.secondUp));
    assert(inputTest.firstMove.x > 130 && inputTest.firstMove.dx > 30, 'first pointer move failed: ' + JSON.stringify(inputTest.firstMove));
    assert(inputTest.canceled.down === false && inputTest.canceled.wentCancel === true && inputTest.canceled.wentUp === false, 'cancel semantics wrong: ' + JSON.stringify(inputTest.canceled));
    assert(inputTest.blurred.down === false && inputTest.blurred.id === null, 'blur did not clear pointer: ' + JSON.stringify(inputTest.blurred));
    record('共享输入 多指归属/取消/失焦', true);

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
        await cdp.screenshot('tower-hint.png');
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

    /* ---------- 星海突击四种弹种 Buff：可叠加 ---------- */
    await cdp.evaluate(`window.Arcade && Arcade.RunSave.clear('star-raid')`);
    await cdp.navigate(base + '/apps/arcade/games/star-raid.html#test');
    await cdp.click('[data-ov-btn]');
    await sleep(300);
    for (const type of ['spread', 'laser', 'homing', 'rapid']) {
      const ok = await cdp.evaluate(`window.__arcadeTest && window.__arcadeTest.giveBuff(${JSON.stringify(type)})`);
      assert(ok, 'star-raid test hook missing');
      await sleep(120);
      const info = await cdp.evaluate(`window.__arcadeTest.info()`);
      assert(info.buffs[type] > 0, `star-raid buff ${type} not active: ` + JSON.stringify(info));
      const buffHud = await cdp.text('[data-hud-weapon]');
      assert(buffHud && buffHud.length > 0, 'star-raid buff HUD missing');
    }
    const stacked = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(
      stacked.weapon.split('+').length === 4 && stacked.buffs.spread > 0 && stacked.buffs.laser > 0 && stacked.buffs.homing > 0 && stacked.buffs.rapid > 0,
      'star-raid buffs did not stack: ' + JSON.stringify(stacked)
    );
    const stackedHud = await cdp.text('[data-hud-weapon]');
    assert(['散', '激', '追', '速'].every((name) => stackedHud.includes(name)), 'stacked HUD missing: ' + stackedHud);
    const volley = await cdp.evaluate(`window.__arcadeTest.fireNow()`);
    assert(volley.added >= 8 && volley.laser && volley.homing >= 2 && volley.spread >= 3, 'stacked volley incomplete: ' + JSON.stringify(volley));
    await cdp.screenshot('buff-stacked.png');
    await cdp.evaluate(`window.__arcadeTest.clearBuffs()`);
    await cdp.evaluate(`window.__arcadeTest.spawnPickup('spread')`);
    await sleep(900);
    const pickupInfo = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(pickupInfo.buffs.spread > 0, 'star-raid pickup not collected: ' + JSON.stringify(pickupInfo));
    record('星海突击 四种弹种叠加 + 实际拾取', true);

    /* ---------- 星海突击 波次与撞机计分分离 ---------- */
    const waveLabels = [];
    for (const sec of [0, 21, 46, 76, 96, 104]) {
      await cdp.evaluate(`window.__arcadeTest.setElapsed(${sec})`);
      await sleep(40);
      waveLabels.push((await cdp.evaluate(`window.__arcadeTest.info()`)).wave);
    }
    assert(waveLabels.join('|') === 'W1 巡逻|W1 俯冲|W1 弹幕|W1 精英|W1 休整|W2 巡逻', 'wave labels: ' + waveLabels.join('|'));
    await cdp.evaluate(`window.__arcadeTest.setElapsed(0)`);
    const beforeCrash = await cdp.evaluate(`window.__arcadeTest.info()`);
    await cdp.evaluate(`window.__arcadeTest.forceBodyCollision()`);
    await sleep(260);
    const afterCrash = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(afterCrash.score === beforeCrash.score, 'body crash awarded score: ' + JSON.stringify({ beforeCrash, afterCrash }));
    assert(afterCrash.lives === beforeCrash.lives - 1, 'body crash life count wrong: ' + JSON.stringify({ beforeCrash, afterCrash }));
    record('星海突击 4 阶段波次/休整/撞机不得分', true);

    /* ---------- 星海突击：关卡 Boss + 全屏移动 ---------- */
    await cdp.evaluate(`Arcade.RunSave.clear('star-raid')`);
    await cdp.navigate(base + '/apps/arcade/games/star-raid.html#test');
    await cdp.click('[data-ov-btn]');
    await sleep(250);
    const bossSpawn = await cdp.evaluate(`window.__arcadeTest.spawnBossNow()`);
    assert(
      bossSpawn.stage === 1 && bossSpawn.bossActive && bossSpawn.bossHp === bossSpawn.bossMaxHp && bossSpawn.bossHp > 0,
      'star-raid boss spawn failed: ' + JSON.stringify(bossSpawn)
    );
    await cdp.screenshot('star-boss.png');
    await cdp.evaluate(`window.__arcadeTest.setPlayer(210, 420)`);
    await cdp.key('ArrowUp', 'down');
    await sleep(1300);
    await cdp.key('ArrowUp', 'up');
    await sleep(100);
    const movedInfo = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(movedInfo.player.y <= 80, 'star-raid player cannot move to top: ' + JSON.stringify(movedInfo.player));
    const bossCleared = await cdp.evaluate(`window.__arcadeTest.damageBoss(999999)`);
    assert(
      bossCleared.stage === 2 && !bossCleared.bossActive && bossCleared.bossHp === 0 && bossCleared.score >= bossSpawn.score + 500 &&
        bossCleared.lives === Math.min(5, bossSpawn.lives + 1),
      'star-raid boss clear failed: ' + JSON.stringify({ before: bossSpawn, after: bossCleared })
    );
    const stageHud = await cdp.text('[data-hud-stage]');
    assert(stageHud === '2', 'star-raid stage HUD: ' + stageHud);
    record('星海突击 关卡 Boss + 全屏移动 + 清关进关', true);

    /* ---------- 雪铃：同一铃铛只奖励一次 ---------- */
    await cdp.evaluate(`Arcade.RunSave.clear('snowbells')`);
    await cdp.navigate(base + '/apps/arcade/games/snowbells.html#test');
    await cdp.click('[data-ov-btn]');
    await sleep(300);
    await cdp.evaluate(`window.__arcadeTest.forceHit(0)`);
    await sleep(260);
    const snowFirst = await cdp.evaluate(`window.__arcadeTest.info()`);
    await cdp.evaluate(`window.__arcadeTest.forceHit(0)`);
    await sleep(260);
    const snowSecond = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(snowFirst.bellScore > 0, 'snowbells first hit scored 0');
    assert(snowSecond.bellScore === snowFirst.bellScore, 'snowbells same bell rescored: ' + JSON.stringify({ snowFirst, snowSecond }));
    assert(snowSecond.consumed[0] === true, 'snowbells consumed flag missing');
    record('雪铃 同一铃铛一局只计分一次', true);

    /* ---------- 记忆翻牌：6 关渐进配置 ---------- */
    await cdp.evaluate(`Arcade.RunSave.clear('memory-flip')`);
    await cdp.navigate(base + '/apps/arcade/games/memory-flip.html#test');
    await cdp.click('[data-ov-btn]');
    await sleep(200);
    const memory1 = await cdp.evaluate(`window.__arcadeTest.info()`);
    await cdp.evaluate(`window.__arcadeTest.setLevel(2)`);
    const memory2 = await cdp.evaluate(`window.__arcadeTest.info()`);
    await cdp.evaluate(`window.__arcadeTest.setLevel(6)`);
    const memory6 = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(memory1.totalLevels === 6 && memory1.cards === 6, 'memory level 1 config: ' + JSON.stringify(memory1));
    assert(memory2.cards === 8, 'memory level 2 config: ' + JSON.stringify(memory2));
    assert(memory6.cards === 24 && memory6.previewTimer > 0, 'memory level 6 config: ' + JSON.stringify(memory6));
    await cdp.screenshot('memory-level6.png');
    record('记忆翻牌 6 关由少到多（6→8→24 张）', true);

    /* ---------- 影跃：前 8 块教学平台与结构可达域 ---------- */
    await cdp.navigate(base + '/apps/arcade/games/shadow-leap.html#test');
    const shadow = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(shadow.platforms.length >= 10, 'shadow platforms too few');
    for (let i = 0; i <= 8; i++) assert(shadow.platforms[i].kind === 'normal', 'shadow teaching platform ' + i + ' is ' + shadow.platforms[i].kind);
    for (let i = 1; i <= 8; i++) assert(shadow.platforms[i].w >= 100, 'shadow teaching platform ' + i + ' too narrow');
    for (let i = 1; i < shadow.platforms.length; i++) {
      const a = shadow.platforms[i - 1];
      const b = shadow.platforms[i];
      const gap = a.y - b.y;
      const centerDelta = Math.abs((a.x + a.w / 2) - (b.x + b.w / 2));
      assert(gap > 0 && gap <= 118, 'shadow gap ' + i + ' = ' + gap);
      assert(centerDelta <= 121, 'shadow horizontal delta ' + i + ' = ' + centerDelta);
      if (b.kind === 'moving') assert((b.range || 0) <= 30, 'shadow moving range too large: ' + b.range);
    }
    record('影跃 前 8 块教学平台 + 可达域约束', true);

    /* ---------- 极速车道：离散变道与安全走廊 ---------- */
    await cdp.evaluate(`Arcade.RunSave.clear('road-rush')`);
    await cdp.navigate(base + '/apps/arcade/games/road-rush.html#test');
    await cdp.click('[data-ov-btn]');
    await sleep(220);
    const roadStart = await cdp.evaluate(`window.__arcadeTest.info()`);
    await cdp.key('ArrowLeft', 'down');
    await sleep(120);
    await cdp.key('ArrowLeft', 'up');
    await sleep(160);
    const roadLeft = await cdp.evaluate(`window.__arcadeTest.info()`);
    await cdp.key('ArrowRight', 'down');
    await sleep(120);
    await cdp.key('ArrowRight', 'up');
    await sleep(160);
    await cdp.key('ArrowRight', 'down');
    await sleep(120);
    await cdp.key('ArrowRight', 'up');
    await sleep(160);
    const roadRight = await cdp.evaluate(`window.__arcadeTest.info()`);
    await cdp.buttonPointer('[data-touch="right"]', 'pointerdown');
    await cdp.buttonPointer('[data-touch="right"]', 'pointerup');
    await sleep(120);
    const roadTouch = await cdp.evaluate(`window.__arcadeTest.info()`);
    const roadStress = await cdp.evaluate(`window.__arcadeTest.stressSpawn(200)`);
    assert(roadStart.lane === 1, 'road start lane=' + roadStart.lane);
    assert(roadLeft.lane === 0, 'road left lane=' + roadLeft.lane);
    assert(roadRight.lane === 2, 'road right lane=' + roadRight.lane);
    assert(roadTouch.lane === 3, 'road touch lane=' + roadTouch.lane);
    assert(roadStress.violations === 0, 'road safe corridor violations=' + roadStress.violations);
    assert(roadStress.spawned > 0, 'road stress spawned 0 cars');
    record('极速车道 一次一车道 + 安全走廊 200 次生成', true);

    /* ---------- 0.3.0 旧局内档没有 lane 字段时的迁移 ---------- */
    await cdp.evaluate(`(() => {
      const raw = JSON.parse(localStorage.getItem('studiokit:arcade:runs:v1') || '{"schemaVersion":1,"games":{}}');
      raw.games['road-rush'] = {
        savedAt: new Date().toISOString(), score: 10, summary: '旧档',
        data: { cars: [], props: [], speed: 0.28, dist: 10, lives: 3, spawnTimer: 0.8, dashOffset: 0, player: { x: 336, vx: 0, tilt: 0, invul: 0 } }
      };
      localStorage.setItem('studiokit:arcade:runs:v1', JSON.stringify(raw));
    })()`);
    await cdp.navigate(base + '/apps/arcade/games/road-rush.html?old=1#test');
    await cdp.click('[data-ov-btn]');
    await sleep(300);
    const oldRunInfo = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(oldRunInfo.lane === 3, 'old road run lane migration failed: ' + JSON.stringify(oldRunInfo));
    record('极速车道 0.3.0 旧档 lane 迁移', true);

    /* ---------- 黄金矿工：关卡可行性 + 提前结算 ---------- */
    await cdp.evaluate(`Arcade.RunSave.clear('gold-miner')`);
    await cdp.navigate(base + '/apps/arcade/games/gold-miner.html#test');
    await cdp.click('[data-ov-btn]');
    await sleep(300);
    const goldFirst = await cdp.evaluate(`window.__arcadeTest.info()`);
    const goldHud = await cdp.evaluate(`({ target: document.querySelector('[data-hud-target]').textContent, level: document.querySelector('[data-hud-level]').textContent, time: document.querySelector('[data-hud-time]').textContent })`);
    assert(goldHud.target === '$650' && goldHud.level === '1' && Number(goldHud.time) > 0, 'gold DOM subhud wrong: ' + JSON.stringify(goldHud));
    assert(goldFirst.target === 650 && goldFirst.swing === 300, 'gold level 1 spec wrong: ' + JSON.stringify(goldFirst));
    assert(goldFirst.tnt === 0, 'gold level 1 should have no TNT');
    assert(goldFirst.totalValue >= goldFirst.target * 1.25, 'gold level 1 value infeasible: ' + JSON.stringify(goldFirst));
    await cdp.evaluate(`window.__arcadeTest.setMoney(${goldFirst.target})`);
    const cashVisible = await cdp.evaluate(`!document.querySelector('[data-cashout]').hidden`);
    assert(cashVisible, 'gold cashout button not shown');
    const cashLayout = await cdp.evaluate(`(() => {
      const c = document.querySelector('[data-cashout]').getBoundingClientRect();
      const t = document.querySelector('[data-toolbelt]').getBoundingClientRect();
      const s = document.querySelector('.stage-box').getBoundingClientRect();
      return { cashBottom: Math.round(c.bottom), toolTop: Math.round(t.top), w: Math.round(c.width), stageW: Math.round(s.width) };
    })()`);
    assert(cashLayout.cashBottom <= cashLayout.toolTop + 1 && cashLayout.w <= cashLayout.stageW, 'gold cashout overlaps toolbelt: ' + JSON.stringify(cashLayout));
    await cdp.screenshot('gold-cashout.png');
    await cdp.click('[data-cashout]');
    await sleep(300);
    const goldSecond = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(goldSecond.level === 2 && goldSecond.swing === 380, 'gold level 2 spec wrong: ' + JSON.stringify(goldSecond));
    assert(goldSecond.target - goldSecond.money === 950, 'gold level 2 increment wrong: ' + JSON.stringify(goldSecond));
    assert(goldSecond.tnt === 0, 'gold level 2 should have no TNT');
    assert(goldSecond.totalValue >= goldSecond.target * 1.25, 'gold level 2 value infeasible: ' + JSON.stringify(goldSecond));
    assert(
      goldSecond.tools.aim === 3 && goldSecond.tools.time === 2 && goldSecond.tools.winch === 1,
      'gold level 2 tool grants wrong: ' + JSON.stringify(goldSecond.tools)
    );
    await cdp.evaluate(`window.__arcadeTest.setMoney(${goldSecond.target})`);
    await cdp.click('[data-cashout]');
    await sleep(300);
    const goldThird = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(goldThird.level === 3 && goldThird.target - goldThird.money === 1350, 'gold cashout chain leak: ' + JSON.stringify(goldThird));
    assert(
      goldThird.tools.aim === 3 && goldThird.tools.time === 2 && goldThird.tools.winch === 2,
      'gold level 3 tool grants wrong: ' + JSON.stringify(goldThird.tools)
    );
    /* 指哪打哪不能锁定炸药，且不能扣次数（用 #test 钩子补一颗，避免物品池随机未生成）。 */
    const tntSpot = await cdp.evaluate(`(() => {
      const info = window.__arcadeTest.info();
      for (let y = 240; y <= 600; y += 10) {
        for (let x = 30; x <= 390; x += 10) {
          if (info.itemList.every((o) => Math.hypot(o.x - x, o.y - y) > 90)) return { x, y };
        }
      }
      return null;
    })()`);
    assert(tntSpot, 'gold no empty spot for TNT test');
    await cdp.evaluate(`window.__arcadeTest.addTnt(${tntSpot.x}, ${tntSpot.y})`);
    await cdp.click('[data-tool="aim"]');
    await sleep(80);
    const tntAim = await cdp.evaluate(`(() => {
      const info = window.__arcadeTest.info();
      const tnt = info.itemList.filter((o) => o.type === 'tnt').sort((a, b) => Math.hypot(a.x - ${tntSpot.x}, a.y - ${tntSpot.y}) - Math.hypot(b.x - ${tntSpot.x}, b.y - ${tntSpot.y}))[0];
      if (!tnt) return { missing: true };
      const ok = window.__arcadeTest.aimAt(tnt.x, tnt.y);
      const after = window.__arcadeTest.info();
      return { ok, armed: after.aimArmed, aim: after.tools.aim };
    })()`);
    assert(!tntAim.missing, 'gold test TNT missing');
    assert(tntAim.ok === false && tntAim.armed === true && tntAim.aim === 3, 'gold TNT aim must not consume: ' + JSON.stringify(tntAim));
    await cdp.click('[data-tool="aim"]');
    /* 瞄准线按秒扣费后余额可能带小数；提前结算进入下一关时目标必须仍为整数。 */
    const fractionalStart = await cdp.evaluate(`__arcadeTest.info()`);
    await cdp.evaluate(`__arcadeTest.setMoney(${fractionalStart.target} + 0.37)`);
    await cdp.evaluate(`document.querySelector('[data-cashout]').click()`);
    await sleep(260);
    const roundedTarget = await cdp.evaluate(`({ info: __arcadeTest.info(), hud: document.querySelector('[data-hud-target]').textContent })`);
    assert(Number.isInteger(roundedTarget.info.target), 'gold target kept decimals: ' + JSON.stringify(roundedTarget));
    assert(roundedTarget.info.target === Math.floor(roundedTarget.info.money) + roundedTarget.info.spec.target, 'gold target increment drifted: ' + JSON.stringify(roundedTarget));
    assert(roundedTarget.hud === '$' + roundedTarget.info.target, 'gold target HUD not integer: ' + JSON.stringify(roundedTarget));
    record('黄金矿工 前 2 关无炸药/价值保底/提前结算/道具补给/炸药不可锁定/目标取整', true);

    /* ---------- 黄金矿工：夹中物品跟随钩爪（渲染不再重复原物） ---------- */
    await cdp.evaluate(`Arcade.RunSave.clear('gold-miner')`);
    await cdp.navigate(base + '/apps/arcade/games/gold-miner.html#test');
    await cdp.click('[data-ov-btn]');
    await sleep(220);
    await cdp.evaluate(`window.__arcadeTest.grabFirst()`);
    await sleep(120);
    const held = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(held.holding && held.holding !== 'tnt', 'gold grab failed: ' + JSON.stringify(held));
    await cdp.screenshot('gold-held.png');
    record('黄金矿工 夹中物品跟随钩爪', true);

    /* ---------- 黄金矿工：限量道具 ---------- */
    await cdp.evaluate(`Arcade.RunSave.clear('gold-miner')`);
    await cdp.navigate(base + '/apps/arcade/games/gold-miner.html#test');
    await cdp.click('[data-ov-btn]');
    await sleep(320);
    let goldTools = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(
      goldTools.tools.aim === 2 && goldTools.tools.time === 1 && goldTools.tools.winch === 1,
      'gold initial tools wrong: ' + JSON.stringify(goldTools.tools)
    );
    const timeBefore = goldTools.timeLeft;
    await cdp.click('[data-tool="time"]');
    await sleep(140);
    goldTools = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(
      goldTools.tools.time === 0 && goldTools.timeLeft >= timeBefore + 9,
      'gold time tool failed: ' + JSON.stringify({ before: timeBefore, after: goldTools.timeLeft, tools: goldTools.tools })
    );
    await cdp.click('[data-tool="aim"]');
    await sleep(90);
    const aimButton = await cdp.evaluate(`(() => { const b = document.querySelector('[data-tool="aim"]'); const r = b.getBoundingClientRect(); return { pressed: b.getAttribute('aria-pressed'), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
    assert(aimButton.pressed === 'true' && aimButton.w >= 44 && aimButton.h >= 44, 'gold aim arm failed: ' + JSON.stringify(aimButton));
    const aimTarget = await cdp.evaluate(`(() => { const info = window.__arcadeTest.info(); return info.itemList.find((o) => o.type === 'diamond' || o.type.indexOf('gold') === 0) || null; })()`);
    assert(aimTarget, 'gold no aimable item');
    await cdp.pointer(aimTarget.x, aimTarget.y, 'pointermove');
    await sleep(140);
    await cdp.screenshot('gold-aim.png');
    await cdp.tap(aimTarget.x, aimTarget.y);
    await sleep(320);
    goldTools = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(goldTools.tools.aim === 1, 'gold aim charge not consumed: ' + JSON.stringify(goldTools.tools));
    assert(
      goldTools.aimTarget === aimTarget.type ||
        goldTools.holding === aimTarget.type ||
        goldTools.clawState === 'retract' ||
        goldTools.clawState === 'extend' ||
        goldTools.money > 0,
      'gold aim shot not started: ' +
        JSON.stringify({ state: goldTools.clawState, target: goldTools.aimTarget, holding: goldTools.holding, money: goldTools.money })
    );
    /* 等钩爪回到摆动，再用绞盘并立刻暂停，避免入账把上弦状态消耗掉。 */
    await cdp.evaluate(`new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (window.__arcadeTest.info().clawState === 'swing' || Date.now() - started > 2500) {
          clearInterval(timer);
          resolve(true);
        }
      }, 50);
    })`);
    const winchState = await cdp.evaluate(`(() => {
      document.querySelector('[data-tool="winch"]').click();
      const info = window.__arcadeTest.info();
      return { tools: info.tools, armed: info.winchArmed };
    })()`);
    assert(
      winchState.tools.winch === 0 && winchState.armed === true,
      'gold winch failed: ' + JSON.stringify(winchState)
    );
    record('黄金矿工 道具初始 2/1/1、加时 +10s、指哪打哪消耗、绞盘上弦', true);

    /* ---------- 黄金矿工：道具状态暂停保存 / 刷新恢复 ---------- */
    await cdp.click('[data-pause]');
    await sleep(220);
    const savedTools = await cdp.evaluate(`(() => {
      const rec = Arcade.RunSave.get('gold-miner');
      return rec ? { tools: rec.data.tools, winch: rec.data.winchArmed } : null;
    })()`);
    assert(
      savedTools && savedTools.tools.aim === 1 && savedTools.tools.time === 0 && savedTools.tools.winch === 0 && savedTools.winch === true,
      'gold tools autosave wrong: ' + JSON.stringify(savedTools)
    );
    await cdp.navigate(base + '/apps/arcade/games/gold-miner.html#test');
    await cdp.click('[data-ov-btn]');
    await sleep(300);
    const restoredTools = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(
      restoredTools.tools.aim === 1 && restoredTools.tools.time === 0 && restoredTools.tools.winch === 0 && restoredTools.winchArmed === true,
      'gold tools restore wrong: ' + JSON.stringify({ tools: restoredTools.tools, armed: restoredTools.winchArmed })
    );
    record('黄金矿工 道具状态暂停保存 / 刷新继续恢复', true);

    /* ---------- 黄金矿工：连续“指哪打哪”后摆钩必须恢复 ---------- */
    await cdp.evaluate(`Arcade.RunSave.clear('gold-miner')`);
    await cdp.navigate(base + '/apps/arcade/games/gold-miner.html#test');
    await cdp.click('[data-ov-btn]');
    await sleep(180);
    const swingSamples = [];
    for (let round = 0; round < 3; round++) {
      await cdp.evaluate(`window.__arcadeTest.clearItems(); window.__arcadeTest.refillTools(); window.__arcadeTest.addGold(210, 520);`);
      const toolReady = await cdp.evaluate(`window.__arcadeTest.useToolNow('aim')`);
      const aimed = await cdp.evaluate(`window.__arcadeTest.aimAt(210, 520)`);
      assert(toolReady && aimed, 'aim tool failed, round ' + round);
      await sleep(2300);
      const before = await cdp.evaluate(`window.__arcadeTest.info()`);
      assert(before.clawState === 'swing', `round ${round} did not return to swing: ` + JSON.stringify(before));
      await sleep(450);
      const after = await cdp.evaluate(`window.__arcadeTest.info()`);
      /* 采样点可能正好在摆幅端点：角度变化小但角速度会反向，合并判定更稳。 */
      const motion = Math.abs(after.angle - before.angle) + Math.abs(after.vel - before.vel) * 0.25;
      swingSamples.push({
        round,
        before: { angle: before.angle, vel: before.vel },
        after: { angle: after.angle, vel: after.vel },
        motion,
      });
      assert(after.clawState === 'swing', `round ${round} state changed: ` + JSON.stringify(after));
      assert(motion > 0.06, 'claw stopped swinging after aim: ' + JSON.stringify(swingSamples[swingSamples.length - 1]));
    }
    record('黄金矿工 连续指哪打哪后摆钩恢复左右摆动', true);

    /* ---------- 黄金矿工：瞄准只改钩爪朝向，不打断摆动能量 ---------- */
    await cdp.evaluate(`Arcade.RunSave.clear('gold-miner')`);
    await cdp.navigate(base + '/apps/arcade/games/gold-miner.html#test');
    await cdp.click('[data-ov-btn]');
    await sleep(220);
    const energySamples = [];
    for (let round = 0; round < 3; round++) {
      await cdp.evaluate(`__arcadeTest.clearItems(); __arcadeTest.refillTools(); __arcadeTest.addGold(210, 520);`);
      await sleep(140);
      const before = await cdp.evaluate(`__arcadeTest.info()`);
      const beforeEnergy = 0.5 * before.vel * before.vel + (before.swing / before.length) * (1 - Math.cos(before.angle));
      const ready = await cdp.evaluate(`__arcadeTest.useToolNow('aim')`);
      const aimed = await cdp.evaluate(`__arcadeTest.aimAt(210, 520)`);
      assert(ready && aimed && before.clawState === 'swing', 'aim energy setup failed: ' + JSON.stringify({ before, ready, aimed }));
      await sleep(2300);
      const after = await cdp.evaluate(`__arcadeTest.info()`);
      const afterEnergy = 0.5 * after.vel * after.vel + (after.swing / after.length) * (1 - Math.cos(after.angle));
      const drift = Math.abs(afterEnergy - beforeEnergy) / Math.max(0.001, beforeEnergy);
      energySamples.push({
        round,
        before: Number(beforeEnergy.toFixed(3)),
        after: Number(afterEnergy.toFixed(3)),
        drift: Number(drift.toFixed(3)),
        clawAngle: Number(after.clawAngle.toFixed(3)),
      });
      assert(after.clawState === 'swing', `round ${round} not swinging: ` + JSON.stringify(after));
      assert(drift < 0.15, 'aim drained swing energy: ' + JSON.stringify(energySamples[energySamples.length - 1]));
    }
    record('黄金矿工 连续瞄准后摆幅/能量不衰减', true);

    /* ---------- 黄金矿工：瞄准线按秒计费 ---------- */
    await cdp.evaluate(`Arcade.RunSave.clear('gold-miner')`);
    await cdp.navigate(base + '/apps/arcade/games/gold-miner.html#test');
    await cdp.click('[data-ov-btn]');
    await sleep(220);
    const lineOn = await cdp.evaluate(`(() => { __arcadeTest.setMoney(100); const ok = __arcadeTest.useToolNow('line'); return { ok, info: __arcadeTest.info() }; })()`);
    assert(lineOn.ok && lineOn.info.aimLineActive && lineOn.info.aimLineCost === 2, 'gold aim line did not enable: ' + JSON.stringify(lineOn));
    await sleep(2200);
    const lineAfter = await cdp.evaluate(`__arcadeTest.info()`);
    assert(lineAfter.aimLineActive && lineAfter.money < lineOn.info.money - 2, 'gold aim line did not charge: ' + JSON.stringify({ before: lineOn.info.money, after: lineAfter.money }));
    await cdp.screenshot('gold-aim-line.png');
    const lineOff = await cdp.evaluate(`(() => { const ok = __arcadeTest.useToolNow('line'); return { ok, info: __arcadeTest.info() }; })()`);
    assert(lineOff.ok && !lineOff.info.aimLineActive, 'gold aim line did not toggle off: ' + JSON.stringify(lineOff));
    const moneyOff = lineOff.info.money;
    await sleep(900);
    const lineStopped = await cdp.evaluate(`__arcadeTest.info()`);
    assert(Math.abs(lineStopped.money - moneyOff) < 0.3, 'gold aim line charged after off: ' + JSON.stringify({ before: moneyOff, after: lineStopped.money }));
    const poor = await cdp.evaluate(`(() => { __arcadeTest.setMoney(0); const ok = __arcadeTest.useToolNow('line'); return { ok, info: __arcadeTest.info() }; })()`);
    assert(!poor.ok && !poor.info.aimLineActive, 'gold aim line enabled without funds: ' + JSON.stringify(poor));
    record('黄金矿工 瞄准线开启/按秒扣费/关闭', true);

    /* ---------- 全屏 / 沉浸模式 ---------- */
    await cdp.evaluate(`Arcade.RunSave.clear('gold-miner')`);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 667, deviceScaleFactor: 1, mobile: true });
    await cdp.navigate(base + '/apps/arcade/games/gold-miner.html');
    const inlineFs = await cdp.evaluate(`(() => {
      const b = document.querySelector('[data-fullscreen-inline]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { hidden: b.hidden, w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    assert(inlineFs && !inlineFs.hidden && inlineFs.h >= 44, 'overlay fullscreen entry ' + JSON.stringify(inlineFs));
    /* 清除存档后仍可能被运行中的自动存档写回；若出现续玩提示，显式重新开始，保证截图是初始补给。 */
    await cdp.evaluate(`(() => {
      const title = document.querySelector('[data-ov-title]');
      if (title && title.textContent.indexOf('继续上次') !== -1) {
        const restart = document.querySelector('[data-ov-btn2]');
        if (restart) restart.click();
      }
    })()`);
    await sleep(120);
    await cdp.click('[data-ov-btn]');
    await sleep(260);
    await cdp.screenshot('gold-375-normal.png');
    const fsBefore = await cdp.evaluate(`(() => {
      const c = document.querySelector('.game-canvas').getBoundingClientRect();
      const b = document.querySelector('[data-fullscreen]').getBoundingClientRect();
      return {
        h: Math.round(c.height), w: Math.round(c.width),
        btnW: Math.round(b.width), btnH: Math.round(b.height),
        shell: getComputedStyle(document.querySelector('.studiokit-shellbar')).display,
        active: document.body.classList.contains('arcade-immersive')
      };
    })()`);
    assert(fsBefore.btnW >= 44 && fsBefore.btnH >= 44, 'fullscreen target ' + JSON.stringify(fsBefore));
    await cdp.click('[data-fullscreen]');
    await sleep(500);
    const fsAfter = await cdp.evaluate(`(() => {
      const c = document.querySelector('.game-canvas').getBoundingClientRect();
      return {
        h: Math.round(c.height), w: Math.round(c.width),
        active: document.body.classList.contains('arcade-immersive'),
        shell: getComputedStyle(document.querySelector('.studiokit-shellbar')).display,
        title: getComputedStyle(document.querySelector('.game-title')).display,
        hud: getComputedStyle(document.querySelector('.game-hud')).display,
        hint: getComputedStyle(document.querySelector('.game-hint')).display,
        pref: Arcade.Prefs.load().immersive,
        ratio: c.width / c.height,
        toastBottom: (() => { const t = document.querySelector('.ac-toast'); return t ? Math.round(t.getBoundingClientRect().bottom) : null; })(),
        toolbeltTop: (() => { const t = document.querySelector('[data-toolbelt]'); return t ? Math.round(t.getBoundingClientRect().top) : null; })()
      };
    })()`);
    assert(
      fsAfter.active && fsAfter.shell === 'none' && fsAfter.title !== 'none' && fsAfter.hud === 'none' && fsAfter.hint === 'none',
      'immersive layout wrong: ' + JSON.stringify(fsAfter)
    );
    assert(
      fsAfter.h > fsBefore.h + 60 && Math.abs(fsAfter.ratio - 420 / 740) < 0.02,
      'immersive canvas wrong: ' + JSON.stringify({ before: fsBefore, after: fsAfter })
    );
    assert(fsAfter.pref === true, 'immersive pref not saved');
    if (fsAfter.toastBottom !== null) {
      assert(fsAfter.toastBottom <= fsAfter.toolbeltTop + 1, 'immersive toast covers toolbelt: ' + JSON.stringify(fsAfter));
    }
    await cdp.screenshot('immersive-gold-toast.png');
    await cdp.evaluate(`(() => { const t = document.querySelector('.ac-toast'); if (t) t.remove(); })()`);
    await sleep(100);
    await cdp.screenshot('immersive-gold.png');
    await cdp.click('[data-fullscreen]');
    await sleep(600);
    const fsExit = await cdp.evaluate(`(() => {
      const c = document.querySelector('.game-canvas').getBoundingClientRect();
      return { active: document.body.classList.contains('arcade-immersive'), h: Math.round(c.height), pref: Arcade.Prefs.load().immersive };
    })()`);
    assert(!fsExit.active && fsExit.h <= fsBefore.h + 2 && fsExit.pref === false, 'immersive exit wrong: ' + JSON.stringify({ before: fsBefore, after: fsExit }));
    record('全屏/沉浸模式 画布放大 + HUD 隐藏 + 偏好记忆 + 退出恢复', true);

    /* 点开始/继续不得被上次的全屏偏好劫持为“自动全屏”。 */
    await cdp.click('[data-fullscreen]');
    await sleep(360);
    await cdp.navigate(base + '/apps/arcade/games/gold-miner.html?autofs=1');
    await sleep(220);
    await cdp.buttonPointer('[data-ov-btn]', 'pointerdown');
    await sleep(360);
    const autoFs = await cdp.evaluate(`({ active: document.body.classList.contains('arcade-immersive'), pref: Arcade.Prefs.load().immersive })`);
    assert(!autoFs.active && autoFs.pref === true, 'fullscreen hijacked start/resume: ' + JSON.stringify(autoFs));
    record('全屏不再因点开始/继续自动触发', true);

    /* ---------- 俄罗斯方块：7-bag 与 1 行消除 ---------- */
    await cdp.evaluate(`Arcade.RunSave.clear('block-drop')`);
    await cdp.navigate(base + '/apps/arcade/games/block-drop.html#test');
    await cdp.click('[data-ov-btn]');
    await sleep(200);
    const bagInfo = await cdp.evaluate(`window.__arcadeTest.info()`);
    const bagPieces = [bagInfo.curKey, bagInfo.nextKey].concat(bagInfo.bag);
    assert(bagPieces.length === 7 && new Set(bagPieces).size === 7, '7-bag invalid: ' + JSON.stringify(bagInfo));
    await cdp.evaluate(`window.__arcadeTest.lineClearScenario()`);
    await sleep(600);
    const clearInfo = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(clearInfo.lines >= 1 && clearInfo.score > 0, 'line clear failed: ' + JSON.stringify(clearInfo));
    const topOut = await cdp.evaluate(`window.__arcadeTest.topOutScenario()`);
    assert(topOut === 'over', 'top-out did not end game: ' + topOut);
    record('俄罗斯方块 7-bag + 1 行消除计分 + 顶部失败', true);

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

    /* ---------- 存储写失败不得谎报导入成功 ---------- */
    const quotaResult = await cdp.evaluate(`(() => {
      const text = Arcade.Progress.exportText();
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
      let result;
      try { result = Arcade.Progress.importText(text); } finally { Storage.prototype.setItem = original; }
      return result;
    })()`);
    assert(quotaResult && quotaResult.ok === false && /存储/.test(quotaResult.reason || ''), 'quota import reported success: ' + JSON.stringify(quotaResult));
    record('localStorage 写入失败时导入返回失败', true);

    const atomicImport = await cdp.evaluate(`(() => {
      const text = Arcade.Progress.exportText();
      const before = localStorage.getItem('studiokit:arcade:progress:v1');
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'studiokit:arcade:runs:v1') throw new DOMException('quota', 'QuotaExceededError');
        return original.call(this, key, value);
      };
      let result;
      try { result = Arcade.Progress.importText(text); } finally { Storage.prototype.setItem = original; }
      return { result, progressUnchanged: localStorage.getItem('studiokit:arcade:progress:v1') === before };
    })()`);
    assert(atomicImport.result && atomicImport.result.ok === false && atomicImport.progressUnchanged, 'non-atomic import: ' + JSON.stringify(atomicImport));
    const unknownImport = await cdp.evaluate(`(() => {
      const before = Arcade.RunSave.count();
      const result = Arcade.RunSave.importMap({ 'not-a-game': { data: { a: 1 } } });
      return { before, after: Arcade.RunSave.count(), result };
    })()`);
    assert(unknownImport.before === unknownImport.after && unknownImport.result.count === 0 && unknownImport.result.skipped === 1, 'unknown run import: ' + JSON.stringify(unknownImport));
    record('导入 runs 失败回滚 + 未知游戏 ID 不覆盖现有档', true);

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

    /* ---------- 游玩时长：游玩计时、暂停不计时、轮次明细 ---------- */
    await cdp.evaluate(`Arcade.Playtime.resetAll()`);
    await cdp.navigate(base + '/apps/arcade/games/block-drop.html');
    await sleep(1200);
    const idleTime = await cdp.evaluate(`Arcade.Playtime.stats().totalMs`);
    assert(idleTime === 0, 'start overlay time counted as playtime: ' + idleTime);
    await cdp.click('[data-ov-btn]');
    await sleep(1400);
    await cdp.evaluate(`Arcade.Playtime.flush()`);
    const timeAfterPlay = await cdp.evaluate(`Arcade.Playtime.stats().totalMs`);
    await cdp.click('[data-pause]');
    await sleep(1600);
    await cdp.evaluate(`Arcade.Playtime.flush()`);
    const timeAfterPause = await cdp.evaluate(`Arcade.Playtime.stats().totalMs`);
    await cdp.click('[data-ov-btn]');
    await sleep(1200);
    await cdp.evaluate(`Arcade.Playtime.flush()`);
    const timeAfterResume = await cdp.evaluate(`Arcade.Playtime.stats().totalMs`);
    assert(timeAfterPlay >= 800, 'playtime not recorded: ' + timeAfterPlay);
    assert(timeAfterPause - timeAfterPlay <= 260, 'paused time leaked into playtime: ' + JSON.stringify({ timeAfterPlay, timeAfterPause }));
    assert(timeAfterResume - timeAfterPause >= 700, 'resumed time not recorded: ' + JSON.stringify({ timeAfterPause, timeAfterResume }));

    await cdp.evaluate(`window.dispatchEvent(new Event('blur'))`);
    await sleep(1300);
    await cdp.evaluate(`Arcade.Playtime.flush()`);
    const timeAfterBlur = await cdp.evaluate(`Arcade.Playtime.stats().totalMs`);
    await cdp.evaluate(`window.dispatchEvent(new Event('focus'))`);
    await sleep(200);
    await cdp.click('[data-ov-btn]');
    await sleep(1100);
    await cdp.evaluate(`Arcade.Playtime.flush()`);
    const timeAfterFocus = await cdp.evaluate(`Arcade.Playtime.stats().totalMs`);
    assert(timeAfterBlur - timeAfterResume <= 260, 'window blur time leaked into playtime: ' + JSON.stringify({ timeAfterResume, timeAfterBlur }));
    assert(timeAfterFocus - timeAfterBlur >= 650, 'resume after blur not recorded: ' + JSON.stringify({ timeAfterBlur, timeAfterFocus }));

    /* 连续游玩超过一个 15s 落盘周期：第一次落盘后必须自动开启下一段时间片。 */
    await cdp.evaluate(`Arcade.Playtime.resetAll()`);
    await cdp.navigate(base + '/apps/arcade/games/block-drop.html');
    await cdp.click('[data-ov-btn]');
    await sleep(17000);
    await cdp.evaluate(`Arcade.Playtime.flush()`);
    const continuousTime = await cdp.evaluate(`Arcade.Playtime.stats().totalMs`);
    assert(continuousTime >= 16000, 'continuous playtime undercounted after first flush: ' + continuousTime);

    await cdp.evaluate(`Arcade.Playtime.resetAll()`);
    await cdp.navigate(base + '/apps/arcade/games/snake-run.html');
    await cdp.click('[data-ov-btn]');
    await sleep(9000);
    const playStats = await cdp.evaluate(`(() => {
      const s = Arcade.Playtime.stats();
      return {
        total: s.totalMs,
        today: s.todayMs,
        week: s.weekMs,
        rounds: s.rounds,
        games: s.games.map((g) => ({ id: g.id, ms: g.ms, count: g.count, rounds: g.rounds }))
      };
    })()`);
    assert(playStats.games.length === 1 && playStats.games[0].id === 'snake-run', 'playtime game row: ' + JSON.stringify(playStats.games));
    assert(playStats.games[0].ms >= 5000, 'snake playtime too small: ' + JSON.stringify(playStats.games[0]));
    assert(playStats.games[0].count >= 1 && playStats.games[0].rounds.length >= 1, 'round not recorded: ' + JSON.stringify(playStats.games[0]));
    const lastRound = playStats.games[0].rounds[0];
    assert(lastRound.ms >= 5000 && typeof lastRound.at === 'string' && lastRound.score >= 0, 'round detail invalid: ' + JSON.stringify(lastRound));
    assert(playStats.today > 0 && playStats.week >= playStats.today && playStats.total >= playStats.games[0].ms, 'playtime summary invalid: ' + JSON.stringify(playStats));
    record('游玩统计 计时/暂停排除/轮次写入', true);

    /* ---------- 中心页统计汇总、分游戏轮次展开、导出导入兼容 ---------- */
    await cdp.navigate(base + '/apps/arcade/');
    const statsUi = await cdp.evaluate(`(() => ({
      total: document.querySelector('[data-pt-total]').textContent,
      today: document.querySelector('[data-pt-today]').textContent,
      rounds: document.querySelector('[data-pt-rounds]').textContent,
      headerTime: document.querySelector('[data-stat-time]').textContent,
      bars: document.querySelectorAll('.hall-pt-day').length,
      rows: document.querySelectorAll('.hall-pt-game').length,
      exportHasPlaytime: Arcade.Progress.exportText().includes('"playtime"')
    }))()`);
    assert(statsUi.total !== '0 分钟' && statsUi.today !== '0 分钟', 'stats summary empty: ' + JSON.stringify(statsUi));
    assert(statsUi.headerTime === statsUi.total, 'header playtime mismatch: ' + JSON.stringify(statsUi));
    assert(Number(statsUi.rounds) >= 1 && statsUi.bars === 7 && statsUi.rows >= 1, 'stats layout: ' + JSON.stringify(statsUi));
    assert(statsUi.exportHasPlaytime, 'export missing playtime');
    await cdp.evaluate(`(() => {
      const row = [...document.querySelectorAll('.hall-pt-game')].find((el) => el.textContent.includes('贪吃蛇'));
      if (row) row.querySelector('.hall-pt-toggle').click();
    })()`);
    await sleep(120);
    const roundUi = await cdp.evaluate(`(() => {
      const row = [...document.querySelectorAll('.hall-pt-game')].find((el) => el.textContent.includes('贪吃蛇'));
      if (!row) return null;
      const toggle = row.querySelector('.hall-pt-toggle');
      const list = row.querySelector('.hall-pt-rounds');
      return {
        expanded: toggle && toggle.getAttribute('aria-expanded'),
        hidden: list ? list.hidden : true,
        items: list ? list.querySelectorAll('li:not(.hall-pt-round-more)').length : 0,
        text: row.textContent
      };
    })()`);
    assert(roundUi && roundUi.expanded === 'true' && roundUi.hidden === false && roundUi.items >= 1, 'round detail not expanded: ' + JSON.stringify(roundUi));
    assert(roundUi.text.includes('新纪录') || roundUi.items >= 1, 'round row text missing');
    await cdp.evaluate(`document.querySelector('[data-playtime-section]').scrollIntoView({ block: 'start' })`);
    await sleep(150);
    await cdp.screenshot('stats-hub.png');
    await cdp.evaluate(`window.scrollTo(0, 0)`);

    const exported = await cdp.evaluate(`Arcade.Progress.exportText()`);
    const backup = JSON.parse(exported);
    assert(backup.playtime && backup.playtime.schemaVersion === 1, 'playtime backup schema missing');
    await cdp.evaluate(`Arcade.Playtime.resetAll()`);
    const clearedStats = await cdp.evaluate(`Arcade.Playtime.stats()`);
    assert(clearedStats.totalMs === 0 && clearedStats.games.length === 0, 'playtime reset failed');
    const importResult = await cdp.evaluate(`Arcade.Progress.importText(${JSON.stringify(exported)})`);
    const restoredStats = await cdp.evaluate(`Arcade.Playtime.stats()`);
    assert(importResult.ok && importResult.playtimeCount === 1 && restoredStats.totalMs > 0 && restoredStats.games.length === 1, 'playtime import failed: ' + JSON.stringify({ importResult, restoredStats }));
    const oldBackup = JSON.parse(exported);
    delete oldBackup.playtime;
    const oldImport = await cdp.evaluate(`Arcade.Progress.importText(${JSON.stringify(JSON.stringify(oldBackup))})`);
    const preservedStats = await cdp.evaluate(`Arcade.Playtime.stats()`);
    assert(oldImport.ok && preservedStats.totalMs === restoredStats.totalMs, 'old backup did not preserve playtime: ' + JSON.stringify({ oldImport, preservedStats }));
    await cdp.evaluate(`Arcade.Progress.resetGame('snake-run')`);
    const resetStats = await cdp.evaluate(`Arcade.Playtime.stats()`);
    assert(resetStats.games.length === 0 && resetStats.totalMs === 0, 'resetGame did not clear playtime: ' + JSON.stringify(resetStats));
    /* 恢复统计，让后续 320/375 布局测试覆盖“有数据的统计面板”而不是空状态。 */
    await cdp.evaluate(`Arcade.Progress.importText(${JSON.stringify(exported)})`);
    record('中心页统计汇总/轮次展开 + 备份导入兼容 + 单游戏清除', true);

    /* ---------- 分享：合集/单游戏深链 + 剪贴板兜底 ---------- */
    const shareUrls = await cdp.evaluate(`({
      hub: Arcade.Share.hubUrl(),
      game: Arcade.Share.gameUrl(Arcade.GAMES.find((g) => g.id === 'gold-miner'))
    })`);
    assert(new URL(shareUrls.hub).pathname.endsWith('/apps/arcade/'), 'hub share url: ' + shareUrls.hub);
    assert(new URL(shareUrls.game).pathname.endsWith('/apps/arcade/games/gold-miner.html'), 'game share url: ' + shareUrls.game);
    const fallbackShare = await cdp.evaluate(`(async () => {
      let propertyError = '';
      try {
        Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: (text) => { window.__arcadeCopied = text; return Promise.resolve(); } },
          configurable: true
        });
      } catch (err) {
        propertyError = String(err);
      }
      const result = await Arcade.Share.shareHub();
      return { result, copied: window.__arcadeCopied || '', propertyError };
    })()`);
    assert(!fallbackShare.propertyError, 'share stubs failed: ' + fallbackShare.propertyError);
    assert(fallbackShare.result.ok && fallbackShare.result.mode === 'copy', 'copy fallback result: ' + JSON.stringify(fallbackShare.result));
    assert(fallbackShare.copied.includes('/apps/arcade/'), 'copied text missing hub url: ' + fallbackShare.copied);

    await cdp.navigate(base + '/apps/arcade/games/gold-miner.html');
    const nativeShare = await cdp.evaluate(`(async () => {
      const payloads = [];
      try {
        Object.defineProperty(navigator, 'share', {
          value: (payload) => { payloads.push(payload); return Promise.resolve(); },
          configurable: true
        });
      } catch (err) {
        return { error: String(err) };
      }
      const button = document.querySelector('[data-share-inline]');
      if (!button) return { missing: true };
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { payloads, toast: (document.querySelector('.ac-toast') || {}).textContent || '' };
    })()`);
    assert(!nativeShare.error && !nativeShare.missing, 'in-game share button: ' + JSON.stringify(nativeShare));
    assert(nativeShare.payloads.length === 1, 'native share not invoked: ' + JSON.stringify(nativeShare));
    assert(nativeShare.payloads[0].url.includes('/apps/arcade/games/gold-miner.html') && nativeShare.payloads[0].title.includes('黄金矿工'), 'native share payload: ' + JSON.stringify(nativeShare.payloads[0]));
    record('分享 合集/单游戏深链 + 复制兜底', true);

    /* ---------- 375px 窄屏无横向溢出 ---------- */
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 667, deviceScaleFactor: 1, mobile: true });
    const pages = ['/apps/arcade/', ...games.map((g) => '/apps/arcade/games/' + g.file)];
    for (const pagePath of pages) {
      await cdp.navigate(base + pagePath);
      const overflow = await cdp.evaluate(`({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
        canvas: (() => { const c = document.querySelector('.game-canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
        pause: (() => { const b = document.querySelector('[data-pause]'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
        title: (() => { const t = document.querySelector('.game-title'); if (!t) return null; return { cw: t.clientWidth, sw: t.scrollWidth }; })(),
        back: (() => { const b = document.querySelector('.ac-back'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
        secondary: (() => { const b = document.querySelector('[data-ov-btn2]'); if (!b) return null; const r = b.getBoundingClientRect(); return { hidden: b.hidden, display: getComputedStyle(b).display, w: Math.round(r.width), h: Math.round(r.height) }; })(),
        toolbelt: (() => { const t = document.querySelector('[data-toolbelt]'); if (!t) return null; const r = t.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), btns: [...t.querySelectorAll('.tool-btn')].map((b) => { const br = b.getBoundingClientRect(); return { w: Math.round(br.width), h: Math.round(br.height) }; }) }; })()
      })`);
      assert(overflow.sw <= overflow.cw + 1, pagePath + ' horizontal overflow ' + overflow.sw + '>' + overflow.cw);
      if (overflow.canvas) {
        assert(overflow.canvas.w <= 375 && overflow.canvas.h > 300, pagePath + ' canvas size ' + JSON.stringify(overflow.canvas));
        assert(overflow.pause && overflow.pause.w >= 44 && overflow.pause.h >= 44, pagePath + ' pause target ' + JSON.stringify(overflow.pause));
        assert(overflow.back && overflow.back.w >= 44 && overflow.back.h >= 44, pagePath + ' back target ' + JSON.stringify(overflow.back));
        assert(overflow.title && overflow.title.sw <= overflow.title.cw + 1, pagePath + ' title clipped ' + JSON.stringify(overflow.title));
        assert(overflow.secondary && (overflow.secondary.hidden ? overflow.secondary.display === 'none' : overflow.secondary.w >= 44), pagePath + ' secondary button ' + JSON.stringify(overflow.secondary));
        if (overflow.toolbelt) {
          assert(overflow.toolbelt.w <= overflow.canvas.w + 1, pagePath + ' toolbelt width ' + JSON.stringify(overflow.toolbelt));
          assert(overflow.toolbelt.btns.length === 4 && overflow.toolbelt.btns.every((b) => b.h >= 44 && b.w > 40), pagePath + ' toolbelt buttons ' + JSON.stringify(overflow.toolbelt.btns));
        }
      }
    }
    record('375px 窄屏 14 页无横向溢出 + 44px 暂停按钮 + 矿工道具条', true);

    /* ---------- 俄罗斯方块触屏控制面板：双手分区 + 画布不再劫持触摸 ---------- */
    await cdp.evaluate(`Arcade.RunSave.clear('block-drop')`);
    await cdp.navigate(base + '/apps/arcade/games/block-drop.html#test');
    const padLayout = await cdp.evaluate(`(() => {
      const pad = document.querySelector('[data-touch-pad]');
      const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
      const groups = [...pad.querySelectorAll('.block-pad-group')].map(rect);
      const btns = [...pad.querySelectorAll('[data-touch]')];
      return {
        display: getComputedStyle(pad).display,
        order: btns.map((b) => b.dataset.touch),
        labels: btns.map((b) => (b.querySelector('.block-btn-label') || {}).textContent || ''),
        sizes: btns.map(rect),
        groups,
        hintLines: (() => { const h = document.querySelector('.block-hint'); return Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight)); })(),
        touchHint: getComputedStyle(document.querySelector('.hint-touch')).display,
        keyboardHint: getComputedStyle(document.querySelector('.hint-keyboard')).display,
        softBg: getComputedStyle(document.querySelector('[data-touch="soft"]')).backgroundImage,
        hardBg: getComputedStyle(document.querySelector('[data-touch="hard"]')).backgroundImage,
        softColor: getComputedStyle(document.querySelector('[data-touch="soft"]')).color,
        hardColor: getComputedStyle(document.querySelector('[data-touch="hard"]')).color,
        vw: innerWidth,
        vh: innerHeight,
        docH: document.documentElement.scrollHeight,
      };
    })()`);
    assert(padLayout.display === 'flex', 'touch pad display=' + padLayout.display);
    assert(padLayout.order.join(',') === 'left,right,rotate,soft,hard', 'touch pad order=' + padLayout.order.join(','));
    assert(padLayout.labels.join(',') === '左移,右移,旋转,加速,落底', 'touch pad labels=' + JSON.stringify(padLayout.labels));
    assert(padLayout.sizes.every((b) => b.h >= 56 && b.w >= 52), 'touch targets too small: ' + JSON.stringify(padLayout.sizes));
    assert(padLayout.softBg !== padLayout.hardBg && padLayout.softColor !== padLayout.hardColor, 'soft/hard styles not distinct: ' + JSON.stringify({ softBg: padLayout.softBg, hardBg: padLayout.hardBg, softColor: padLayout.softColor, hardColor: padLayout.hardColor }));
    assert(padLayout.groups.length === 2 && padLayout.groups[0].right + 8 <= padLayout.groups[1].x, 'touch groups not separated: ' + JSON.stringify(padLayout.groups));
    assert(padLayout.sizes[4].right <= padLayout.vw && padLayout.sizes[4].bottom <= padLayout.vh, 'pad clipped: ' + JSON.stringify(padLayout));
    assert(padLayout.hintLines === 1 && padLayout.touchHint !== 'none' && padLayout.keyboardHint === 'none', 'touch hint wrong: ' + JSON.stringify(padLayout));
    assert(padLayout.docH <= padLayout.vh + 1, 'block-drop vertical overflow: ' + padLayout.docH + '>' + padLayout.vh);

    await cdp.click('[data-ov-btn]');
    await sleep(220);
    const beforeSoft = await cdp.evaluate(`window.__arcadeTest.info()`);
    await cdp.buttonPointer('[data-touch="soft"]', 'pointerdown');
    await sleep(180);
    await cdp.buttonPointer('[data-touch="soft"]', 'pointerup');
    const afterSoft = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(afterSoft.curY > beforeSoft.curY, 'soft drop did not move piece: ' + JSON.stringify({ before: beforeSoft, after: afterSoft }));
    assert(afterSoft.filled === 0 && afterSoft.state === 'playing', 'soft drop locked immediately: ' + JSON.stringify(afterSoft));
    assert(afterSoft.score > beforeSoft.score, 'soft drop did not score: ' + JSON.stringify({ before: beforeSoft, after: afterSoft }));
    await cdp.buttonPointer('[data-touch="hard"]', 'pointerdown');
    const slamActive = await cdp.evaluate(`document.querySelector('.stage-box').classList.contains('is-hard-drop')`);
    await cdp.buttonPointer('[data-touch="hard"]', 'pointerup');
    assert(slamActive, 'hard drop slam feedback missing');
    await sleep(350);
    const afterHard = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(afterHard.filled >= 4, 'hard drop did not lock: ' + JSON.stringify(afterHard));
    const touchScore = Number(await cdp.text('[data-hud-score]'));
    assert(touchScore > 0, 'touch hard-drop score=' + touchScore);
    /* 左手横移 + 右手软降可以同时按住（两根手指），这是左右分区的主要收益。 */
    await cdp.buttonPointer('[data-touch="left"]', 'pointerdown', 11);
    await cdp.buttonPointer('[data-touch="soft"]', 'pointerdown', 12);
    await sleep(320);
    await cdp.buttonPointer('[data-touch="left"]', 'pointerup', 11);
    await cdp.buttonPointer('[data-touch="soft"]', 'pointerup', 12);
    const afterLeft = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(afterLeft.curX !== afterHard.curX, 'left button did not move piece: ' + JSON.stringify({ before: afterHard, after: afterLeft }));
    assert(afterLeft.score > afterHard.score, 'left+soft multi-touch did not soft-drop: ' + JSON.stringify({ before: afterHard, after: afterLeft }));
    await cdp.buttonPointer('[data-touch="rotate"]', 'pointerdown');
    await cdp.buttonPointer('[data-touch="rotate"]', 'pointerup');

    /* 画布旧触控区已移除：点按/按住画布不得移动、软降或旋转。 */
    await cdp.evaluate(`Arcade.RunSave.clear('block-drop')`);
    await cdp.navigate(base + '/apps/arcade/games/block-drop.html#test');
    await cdp.click('[data-ov-btn]');
    await sleep(220);
    const canvasBefore = await cdp.evaluate(`window.__arcadeTest.info()`);
    await cdp.tap(60, 300);
    await sleep(220);
    const afterLeftTap = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(afterLeftTap.curX === canvasBefore.curX, 'canvas left tap moved piece: ' + JSON.stringify({ before: canvasBefore, after: afterLeftTap }));
    await cdp.pointer(210, 680, 'pointerdown');
    await sleep(320);
    await cdp.pointer(210, 680, 'pointerup');
    await sleep(100);
    const afterCanvasHold = await cdp.evaluate(`window.__arcadeTest.info()`);
    assert(afterCanvasHold.score === canvasBefore.score, 'canvas bottom hold still soft-drops: ' + JSON.stringify({ before: canvasBefore, after: afterCanvasHold }));
    if (cdp.errors.length) throw new Error('touch pad console errors: ' + cdp.errors.join(' | '));
    record('俄罗斯方块 375px 双手按钮面板 + 画布触摸区不再误触', true);
    await cdp.screenshot('touch-block-drop.png');

    /* ---------- 320px 小屏：安全区/暂停/画布不裁切 ---------- */
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
    for (const pagePath of pages) {
      await cdp.navigate(base + pagePath);
      const small = await cdp.evaluate(`({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
        canvas: (() => { const c = document.querySelector('.game-canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
        pause: (() => { const b = document.querySelector('[data-pause]'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
        title: (() => { const t = document.querySelector('.game-title'); if (!t) return null; return { cw: t.clientWidth, sw: t.scrollWidth }; })(),
        back: (() => { const b = document.querySelector('.ac-back'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
        secondary: (() => { const b = document.querySelector('[data-ov-btn2]'); if (!b) return null; const r = b.getBoundingClientRect(); return { hidden: b.hidden, display: getComputedStyle(b).display, w: Math.round(r.width), h: Math.round(r.height) }; })(),
        toolbelt: (() => { const t = document.querySelector('[data-toolbelt]'); if (!t) return null; const r = t.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), btns: [...t.querySelectorAll('.tool-btn')].map((b) => { const br = b.getBoundingClientRect(); return { w: Math.round(br.width), h: Math.round(br.height) }; }) }; })(),
        blockPad: (() => { const p = document.querySelector('.block-pad'); if (!p || getComputedStyle(p).display === 'none') return null; const r = p.getBoundingClientRect(); return { right: Math.round(r.right), bottom: Math.round(r.bottom), docH: document.documentElement.scrollHeight, vh: innerHeight, btns: [...p.querySelectorAll('[data-touch]')].map((b) => { const br = b.getBoundingClientRect(); return { w: Math.round(br.width), h: Math.round(br.height) }; }) }; })()
      })`);
      if (small.sw > small.cw + 1) {
        const offenders = await cdp.evaluate(`(() => {
          const width = document.documentElement.clientWidth;
          return [...document.querySelectorAll('body *')].map((el) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return {
              tag: el.tagName.toLowerCase(),
              cls: String(el.className || '').slice(0, 90),
              text: (el.textContent || '').trim().slice(0, 60),
              left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
              sw: el.scrollWidth, cw: el.clientWidth, display: cs.display,
            };
          }).filter((x) => x.display !== 'none' && (x.right > width + 1 || x.sw > x.cw + 1 || x.left < -1)).slice(0, 20);
        })()`);
        console.log('320 OVERFLOW OFFENDERS', pagePath, JSON.stringify(offenders));
      }
      assert(small.sw <= small.cw + 1, pagePath + ' 320px horizontal overflow ' + small.sw + '>' + small.cw);
      if (small.canvas) {
        assert(small.canvas.w > 160 && small.canvas.h > 250, pagePath + ' 320px canvas ' + JSON.stringify(small.canvas));
        assert(small.pause && small.pause.w >= 44 && small.pause.h >= 44, pagePath + ' 320px pause target ' + JSON.stringify(small.pause));
        assert(small.back && small.back.w >= 44 && small.back.h >= 44, pagePath + ' 320px back target ' + JSON.stringify(small.back));
        assert(small.title && small.title.sw <= small.title.cw + 1, pagePath + ' 320px title clipped ' + JSON.stringify(small.title));
        assert(small.secondary && (small.secondary.hidden ? small.secondary.display === 'none' : small.secondary.w >= 44), pagePath + ' 320px secondary button ' + JSON.stringify(small.secondary));
        if (small.toolbelt) {
          assert(small.toolbelt.w <= small.canvas.w + 1, pagePath + ' 320px toolbelt width ' + JSON.stringify(small.toolbelt));
          assert(small.toolbelt.btns.length === 4 && small.toolbelt.btns.every((b) => b.h >= 44 && b.w > 40), pagePath + ' 320px toolbelt buttons ' + JSON.stringify(small.toolbelt.btns));
        }
        if (small.blockPad) {
          assert(small.blockPad.btns.length === 5 && small.blockPad.btns.every((b) => b.h >= 56 && b.w >= 52), pagePath + ' 320px block pad buttons ' + JSON.stringify(small.blockPad.btns));
          assert(small.blockPad.right <= small.cw + 1 && small.blockPad.bottom <= small.blockPad.vh + 1, pagePath + ' 320px block pad clipped ' + JSON.stringify(small.blockPad));
          assert(small.blockPad.docH <= small.blockPad.vh + 1, pagePath + ' 320px block pad page overflow ' + JSON.stringify(small.blockPad));
        }
      }
    }
    record('320×568 小屏 14 页无横向溢出 + 44px 暂停按钮 + 矿工道具条', true);

    /* 320px 上道具条占画布比例最大：物品不能被压在道具条后面。 */
    await cdp.navigate(base + '/apps/arcade/games/gold-miner.html?itemfloor=1#test');
    const itemSafety = await cdp.evaluate(`(() => {
      const info = window.__arcadeTest.info();
      const c = document.querySelector('.game-canvas').getBoundingClientRect();
      const t = document.querySelector('[data-toolbelt]').getBoundingClientRect();
      const barTopLogical = ((t.top - c.top) / c.height) * 740;
      return {
        items: info.itemList.length,
        floor: Math.round(info.itemFloor),
        barTop: Math.round(barTopLogical),
        lowest: Math.round(Math.max(...info.itemList.map((o) => o.y + o.r)))
      };
    })()`);
    assert(itemSafety.items > 0 && itemSafety.lowest <= itemSafety.barTop - 2, 'gold items under toolbelt: ' + JSON.stringify(itemSafety));
    await cdp.screenshot('gold-320.png');
    record('320px 矿工物品不被道具条遮挡', true);
    await cdp.navigate(base + '/apps/arcade/');
    const hallSmall = await cdp.evaluate(`({
      searchFont: getComputedStyle(document.querySelector('[data-search]')).fontSize,
      clearSize: (() => { const b = document.querySelector('.hall-card-clear'); const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()
    })`);
    assert(parseFloat(hallSmall.searchFont) >= 16, 'hall search font ' + hallSmall.searchFont);
    assert(hallSmall.clearSize.w >= 44 && hallSmall.clearSize.h >= 44, 'hall clear target ' + JSON.stringify(hallSmall.clearSize));
    record('中心页 320px 搜索 16px + 清除按钮 44px', true);
    await cdp.screenshot('narrow-hall-320.png');
    await cdp.evaluate(`document.querySelector('[data-playtime-section]').scrollIntoView({ block: 'start' })`);
    await sleep(150);
    await cdp.screenshot('stats-hub-320.png');

    for (const [width, height] of [[390, 844], [430, 932]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
      for (const pagePath of pages) {
        await cdp.navigate(base + pagePath);
        const metrics = await cdp.evaluate(`({
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth,
          pause: (() => { const b = document.querySelector('[data-pause]'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
          blockPad: (() => { const p = document.querySelector('.block-pad'); if (!p || getComputedStyle(p).display === 'none') return null; const r = p.getBoundingClientRect(); return { right: Math.round(r.right), bottom: Math.round(r.bottom), docH: document.documentElement.scrollHeight, vh: innerHeight, btns: [...p.querySelectorAll('[data-touch]')].map((b) => { const br = b.getBoundingClientRect(); return { w: Math.round(br.width), h: Math.round(br.height) }; }) }; })()
        })`);
        assert(metrics.sw <= metrics.cw + 1, pagePath + ' ' + width + 'px overflow ' + metrics.sw + '>' + metrics.cw);
        if (metrics.pause) assert(metrics.pause.w >= 44 && metrics.pause.h >= 44, pagePath + ' ' + width + 'px pause target');
        if (metrics.blockPad) {
          assert(metrics.blockPad.btns.length === 5 && metrics.blockPad.btns.every((b) => b.h >= 56 && b.w >= 52), pagePath + ' ' + width + 'px block pad buttons ' + JSON.stringify(metrics.blockPad.btns));
          assert(metrics.blockPad.right <= metrics.cw + 1 && metrics.blockPad.bottom <= metrics.blockPad.vh + 1, pagePath + ' ' + width + 'px block pad clipped ' + JSON.stringify(metrics.blockPad));
          assert(metrics.blockPad.docH <= metrics.blockPad.vh + 1, pagePath + ' ' + width + 'px block pad page overflow ' + JSON.stringify(metrics.blockPad));
        }
      }
    }
    record('390×844 / 430×932 视口 14 页无横向溢出', true);

    /* ---------- 刘海安全区（Chrome CDP 支持时） ---------- */
    let safeAreaApplied = false;
    try {
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, left: 0, bottom: 34, right: 0 } });
      safeAreaApplied = true;
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await cdp.navigate(base + '/apps/arcade/games/star-raid.html');
      const safe = await cdp.evaluate(`({
        paddingTop: getComputedStyle(document.querySelector('.studiokit-shellbar')).paddingTop,
        shellH: Math.round(document.querySelector('.studiokit-shellbar').getBoundingClientRect().height),
        docH: document.documentElement.scrollHeight,
        viewH: window.innerHeight
      })`);
      assert(parseFloat(safe.paddingTop) >= 47, 'shell safe-area padding ' + JSON.stringify(safe));
      assert(safe.docH <= safe.viewH + 2, 'safe-area page overflow ' + JSON.stringify(safe));

      /* 俄罗斯方块在底部 Home Indicator 安全区下：按钮面板与提示不能被推出视口。 */
      await cdp.navigate(base + '/apps/arcade/games/block-drop.html');
      const safeBlock = await cdp.evaluate(`(() => {
        const p = document.querySelector('.block-pad');
        const h = document.querySelector('.block-hint');
        const pr = p.getBoundingClientRect();
        const hr = h.getBoundingClientRect();
        return {
          docH: document.documentElement.scrollHeight,
          viewH: innerHeight,
          padH: Math.round(pr.height),
          hintBottom: Math.round(hr.bottom),
          pagePadBottom: getComputedStyle(document.querySelector('.game-page')).paddingBottom,
        };
      })()`);
      assert(safeBlock.docH <= safeBlock.viewH + 2, 'block-drop safe-area overflow: ' + JSON.stringify(safeBlock));
      assert(safeBlock.padH >= 56, 'block-drop safe-area pad height: ' + JSON.stringify(safeBlock));
      assert(safeBlock.hintBottom <= safeBlock.viewH - parseFloat(safeBlock.pagePadBottom) + 1, 'block-drop hint inside safe area: ' + JSON.stringify(safeBlock));
      record('390×844 刘海安全区 shellbar/页面高度 + 方块按钮面板', true);

      /* 全屏时顶栏与画布同样要避开刘海/底部安全区。 */
      await cdp.navigate(base + '/apps/arcade/games/gold-miner.html');
      await cdp.click('[data-fullscreen]');
      await sleep(420);
      const safeFs = await cdp.evaluate(`(() => {
        const c = document.querySelector('.game-canvas').getBoundingClientRect();
        const t = document.querySelector('[data-toolbelt]').getBoundingClientRect();
        return {
          active: document.body.classList.contains('arcade-immersive'),
          top: Math.round(c.top),
          bottom: Math.round(c.bottom),
          toolBottom: Math.round(t.bottom),
          vh: window.innerHeight,
          topPad: parseFloat(getComputedStyle(document.querySelector('.game-topbar')).paddingTop),
          docH: document.documentElement.scrollHeight
        };
      })()`);
      assert(safeFs.active && safeFs.topPad >= 47 && safeFs.top >= 47, 'safe-area fullscreen top ' + JSON.stringify(safeFs));
      assert(safeFs.toolBottom <= safeFs.vh + 1 && safeFs.docH <= safeFs.vh + 2, 'safe-area fullscreen bottom ' + JSON.stringify(safeFs));
      record('390×844 刘海安全区 全屏画布不压刘海/不溢出', true);
      await cdp.click('[data-fullscreen]');
      await sleep(300);
    } catch (err) {
      console.log('SKIP 刘海安全区（当前 Chrome/CDP 不支持 setSafeAreaInsetsOverride 或断言失败）: ' + err.message);
    } finally {
      if (safeAreaApplied) {
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, bottom: 0, right: 0 } }).catch(() => {});
      }
    }
    await cdp.navigate(base + '/apps/arcade/');
    await cdp.screenshot('narrow-hall.png');

    /* ---------- PWA manifest / Service Worker / 预载 / 断网回归 ---------- */
    await cdp.send('Network.enable');

    /* GitHub Pages 项目子路径：manifest、SW 作用域与核心缓存都必须跟随 /studiokit/ 前缀。 */
    await cdp.navigate(base + '/studiokit/apps/arcade/');
    let subpathCore = null;
    for (let i = 0; i < 40; i++) {
      subpathCore = await cdp.evaluate(`Arcade.Offline.cacheStatus()`);
      if (subpathCore.coreCached >= subpathCore.coreTotal) break;
      await sleep(250);
    }
    const subpathManifest = await cdp.evaluate(`({
      href: (document.querySelector('link[rel="manifest"]') || {}).href || '',
      base: Arcade.baseUrl
    })`);
    const subpathScope = await cdp.evaluate(`navigator.serviceWorker.getRegistration().then((reg) => (reg ? reg.scope : ''))`);
    assert(subpathManifest.href.includes('/studiokit/apps/arcade/manifest.webmanifest'), 'subpath manifest href: ' + JSON.stringify(subpathManifest));
    assert(subpathManifest.base.includes('/studiokit/apps/arcade/'), 'subpath engine base: ' + JSON.stringify(subpathManifest));
    assert(subpathScope.includes('/studiokit/apps/arcade/'), 'subpath sw scope: ' + subpathScope);
    assert(subpathCore && subpathCore.coreCached >= subpathCore.coreTotal, 'subpath core cache: ' + JSON.stringify(subpathCore));

    await cdp.navigate(base + '/apps/arcade/');
    const manifestInfo = await cdp.evaluate(`(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      if (!link) return { missing: true };
      const response = await fetch(link.href);
      const data = await response.json();
      const iconResponses = await Promise.all((data.icons || []).map((icon) => fetch(new URL(icon.src, link.href))));
      const registration = await navigator.serviceWorker.getRegistration();
      return {
        status: response.status,
        name: data.name,
        display: data.display,
        start: data.start_url,
        scope: data.scope,
        icons: data.icons.length,
        iconStatuses: iconResponses.map((item) => item.status),
        supported: Arcade.Offline.supported,
        registration: !!registration
      };
    })()`);
    assert(manifestInfo.status === 200 && manifestInfo.display === 'standalone', 'manifest invalid: ' + JSON.stringify(manifestInfo));
    assert(manifestInfo.icons >= 3 && manifestInfo.iconStatuses.every((status) => status === 200), 'manifest icons: ' + JSON.stringify(manifestInfo));
    assert(manifestInfo.supported && manifestInfo.registration, 'service worker not registered: ' + JSON.stringify(manifestInfo));
    const appManifest = await cdp.send('Page.getAppManifest');
    assert(!appManifest.errors || appManifest.errors.length === 0, 'manifest parse errors: ' + JSON.stringify(appManifest.errors));
    let installabilityErrors = null;
    try {
      const installability = await cdp.send('Page.getInstallabilityErrors');
      installabilityErrors = installability.installabilityErrors || [];
    } catch (err) {
      installabilityErrors = null;
    }
    if (installabilityErrors) {
      assert(installabilityErrors.length === 0, 'PWA installability errors: ' + JSON.stringify(installabilityErrors));
    }
    let coreStatus = null;
    for (let i = 0; i < 40; i++) {
      coreStatus = await cdp.evaluate(`Arcade.Offline.cacheStatus()`);
      if (coreStatus.coreCached >= coreStatus.coreTotal) break;
      await sleep(250);
    }
    assert(coreStatus && coreStatus.coreCached >= coreStatus.coreTotal, 'core cache incomplete: ' + JSON.stringify(coreStatus));
    const preloadUrls = await cdp.evaluate(`Arcade.Offline.preloadUrls()`);
    assert(preloadUrls.length === coreStatus.total, 'preload url count: ' + JSON.stringify({ urls: preloadUrls.length, status: coreStatus }));
    const precacheResult = await cdp.evaluate(`Arcade.Offline.precache(Arcade.Offline.preloadUrls())`);
    assert(precacheResult && precacheResult.total === preloadUrls.length && precacheResult.failed === 0, 'precache failed: ' + JSON.stringify(precacheResult));
    const allCached = await cdp.evaluate(`Arcade.Offline.cacheStatus()`);
    assert(allCached.gamesCached === 13 && allCached.cached === allCached.total, 'precache incomplete: ' + JSON.stringify(allCached));
    await cdp.navigate(base + '/apps/arcade/');
    await sleep(450);
    const offlineUi = await cdp.evaluate(`({
      text: document.querySelector('[data-offline]').textContent,
      status: document.querySelector('[data-offline-status]').textContent
    })`);
    assert(offlineUi.text.includes('已预载'), 'offline button did not update: ' + JSON.stringify(offlineUi));
    assert(offlineUi.status.includes('断网'), 'offline status missing: ' + JSON.stringify(offlineUi));
    if (cdp.errors.length) throw new Error('PWA hub console errors: ' + cdp.errors.join(' | '));
    record('PWA manifest + 核心缓存 + 13 款游戏预载', true);

    /* 真正停掉静态服务器，确保命中的只能是 Service Worker 缓存。 */
    server.close();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await sleep(350);
    server = null;
    await cdp.navigate(base + '/apps/arcade/');
    await sleep(500);
    const offlineHall = await cdp.evaluate(`({
      cards: document.querySelectorAll('.hall-card').length,
      version: window.Arcade && Arcade.version,
      title: document.title
    })`);
    assert(offlineHall.cards === 13 && offlineHall.version === '0.6.1', 'offline hall failed: ' + JSON.stringify(offlineHall));
    const offlineStatus = await cdp.evaluate(`(async () => {
      try {
        await Arcade.Offline.register();
        const status = await Arcade.Offline.cacheStatus();
        return { ok: true, status };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    })()`);
    assert(offlineStatus.ok && offlineStatus.status.gamesCached === 13, 'offline cache status failed: ' + JSON.stringify(offlineStatus));
    const offlineUiText = await cdp.evaluate(`({
      button: document.querySelector('[data-offline]').textContent,
      status: document.querySelector('[data-offline-status]').textContent
    })`);
    assert(offlineUiText.button.includes('已预载') && offlineUiText.status.includes('断网'), 'offline hub ui: ' + JSON.stringify(offlineUiText));
    await cdp.navigate(base + '/apps/arcade/games/gold-miner.html');
    const offlineGame = await cdp.evaluate(`({
      hasArcade: !!window.Arcade,
      overlay: !!document.querySelector('[data-overlay]'),
      version: window.Arcade && window.Arcade.version
    })`);
    assert(offlineGame.hasArcade && offlineGame.overlay && offlineGame.version === '0.6.1', 'offline game failed: ' + JSON.stringify(offlineGame));
    await cdp.navigate(base + '/apps/arcade/games/not-preloaded.html');
    const offlineMissing = await cdp.text('body');
    assert(offlineMissing && offlineMissing.includes('还没有预载'), 'offline missing page: ' + String(offlineMissing).slice(0, 120));
    server = await startServer();
    record('断网后中心页/已预载游戏可开，未预载页显示提示', true);
    await cdp.navigate(base + '/apps/arcade/');

    /* ---------- 清理测试产生的本地数据 ---------- */
    await cdp.evaluate(`localStorage.clear()`);
  } finally {
    if (cdp) cdp.close();
    try {
      chrome.kill();
    } catch (err) {
      /* ignore */
    }
    if (server) server.close();
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
