#!/usr/bin/env node
/**
 * StudioKit Arcade 零依赖 CDP 测试库。
 *
 * 从 tools/arcade_smoke.mjs 抽出的通用基础设施，供：
 * - tools/arcade_smoke.mjs：0.8.0 全链路回归冒烟（85 项）
 * - tools/arcade_gameplay_test.mjs：0.8.0 确定性玩法场景
 *
 * 只使用 Node 内置模块（http / fs / os / path / child_process / url）与
 * Node 内置全局 fetch / WebSocket（Node >= 22），不需要任何 npm 依赖，不联网：
 * - 本地静态文件服务器：MIME、/studiokit/ 子路径前缀、403/404、端口可配
 * - launchChrome()：启动本机 Chrome（无头、独立 mkdtemp profile）并等待 /json/version
 * - openPage()：新建页面 target、连接 CDP 并启用 Page/Runtime/Log + 移动端视口
 * - CDP 客户端：send / evaluate / navigate / waitFor / screenshot / click / text /
 *   key / pointer / tap / buttonPointer / drag / on / close，保留 errors 收集语义
 * - createRecorder()：record / assert / summary，输出 `PASS  name` / `FAIL  name — detail`
 *
 * 端口默认值不在这里硬编码：各 runner 通过 envPort() 读取自己的环境变量并传入，
 * 从而保证 arcade_smoke.mjs 默认仍是 8765 / 9333，玩法 runner 默认 8766 / 9334。
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 仓库根目录（本文件位于 <root>/tools/lib/）。 */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 本机 Chrome 路径；可用 CHROME_PATH 环境变量覆盖。 */
export const DEFAULT_CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

/** 静态服务器支持的 MIME 类型。 */
export const MIME = {
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

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 读取端口环境变量；未设置时返回 fallback，设置但非法时直接报错（避免静默串端口）。
 * @param {string} name 环境变量名，例如 ARCADE_SMOKE_PORT
 * @param {number} fallback 默认端口
 * @returns {number}
 */
export function envPort(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} 必须是 1-65535 的整数端口，当前值为 ${JSON.stringify(raw)}`);
  }
  return port;
}

/**
 * 启动本地静态文件服务器（127.0.0.1，仅本机）。
 * 支持 `/studiokit/` 形式的 GitHub Pages 项目站点前缀；禁止路径逃逸（403）；
 * 目录自动补 index.html；找不到文件返回 404。
 * @param {{root?: string, port: number, host?: string}} options
 * @returns {Promise<import('node:http').Server>}
 */
export function startServer({ root = REPO_ROOT, port, host = '127.0.0.1' } = {}) {
  if (!Number.isInteger(port)) throw new Error('startServer 需要整数 port');
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let filePath = path.join(root, urlPath.startsWith('/studiokit/') ? urlPath.slice('/studiokit'.length) : urlPath);
      if (!filePath.startsWith(root)) {
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
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('error', onError);
      reject(new Error(`静态服务器无法监听 ${host}:${port}：${err.message}（可用对应 *_PORT 环境变量覆盖端口）`));
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve(server);
    });
  });
}

/**
 * 轮询一个返回 JSON 的 URL，直到成功或超时。
 * @param {string} url
 * @param {number} [timeout]
 */
export async function waitForJson(url, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (err) {
      /* 端口尚未就绪，继续重试 */
    }
    await sleep(120);
  }
  throw new Error('timeout waiting for ' + url);
}

/** 删除临时 Chrome profile（尽力而为）。 */
function removeProfile(profile) {
  if (!profile) return;
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch (err) {
    /* ignore */
  }
}

/**
 * 启动本机 Chrome 并等待 DevTools 端口就绪。
 * 每次调用使用独立 mkdtemp profile，多个 runner 可并发运行（端口不能相同）。
 * @param {{port: number, chromePath?: string, profilePrefix?: string, windowSize?: string, headless?: boolean, extraArgs?: string[]}} options
 * @returns {Promise<{chrome: import('node:child_process').ChildProcess, profile: string, port: number}>}
 */
export async function launchChrome({
  port,
  chromePath = DEFAULT_CHROME,
  profilePrefix = 'studiokit-arcade-',
  windowSize = '420,900',
  headless = true,
  extraArgs = [],
} = {}) {
  if (!Number.isInteger(port)) throw new Error('launchChrome 需要整数 port');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), profilePrefix));
  const args = [
    ...(headless ? ['--headless=new'] : []),
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${windowSize}`,
    '--hide-scrollbars',
    '--mute-audio',
    ...extraArgs,
    'about:blank',
  ];
  const chrome = spawn(chromePath, args, { stdio: 'ignore' });
  const endpoint = `http://127.0.0.1:${port}`;
  const versionReady = waitForJson(`${endpoint}/json/version`);
  versionReady.catch(() => {
    /* 与 spawn 失败竞速时可能后到，避免 unhandled rejection */
  });
  const spawnFailed = new Promise((resolve, reject) => {
    chrome.once('error', (err) => reject(new Error(`Chrome 启动失败（${chromePath}）：${err.message}`)));
  });
  try {
    await Promise.race([versionReady, spawnFailed]);
  } catch (err) {
    try {
      chrome.kill();
    } catch (killErr) {
      /* ignore */
    }
    removeProfile(profile);
    throw err;
  }
  return { chrome, profile, port };
}

/**
 * 关闭 Chrome 并清理临时 profile。
 * @param {{chrome?: import('node:child_process').ChildProcess, profile?: string}} launched
 */
export async function stopChrome({ chrome, profile } = {}) {
  try {
    if (chrome) chrome.kill();
  } catch (err) {
    /* ignore */
  }
  await sleep(300);
  removeProfile(profile);
}

const CHROME_KEY_CODES = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, ' ': 32 };

/**
 * Chrome DevTools Protocol 客户端（WebSocket 直连，零依赖）。
 *
 * 构造时立即开始连接；使用前先 await ready()。navigate() 会清空 errors，
 * 页面抛出的异常 / console.error / Log error 会累积到 errors 数组，
 * 由调用方在关键节点检查，从而把“静默报错”变成失败。
 */
export class CDP {
  /**
   * @param {string} wsUrl
   * @param {{artifactsDir?: string}} [options] 截图输出目录，默认 <cwd>/test-artifacts
   */
  constructor(wsUrl, { artifactsDir = path.resolve(process.cwd(), 'test-artifacts') } = {}) {
    this.artifactsDir = artifactsDir;
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
        /* 页面可能仍在导航 */
      }
      await sleep(80);
    }
    await sleep(180);
  }

  /**
   * 轮询表达式直到返回真值；用于等待“固定初始状态”就绪，
   * 避免用固定 sleep 猜游戏循环帧（确定性场景必须稳定）。
   * @param {string} expression 求值为真值即返回
   * @param {{timeout?: number, interval?: number}} [options]
   */
  async waitFor(expression, { timeout = 5000, interval = 50 } = {}) {
    const end = Date.now() + timeout;
    let lastError = null;
    while (Date.now() < end) {
      try {
        const value = await this.evaluate(expression);
        if (value) return value;
      } catch (err) {
        lastError = err;
      }
      await sleep(interval);
    }
    throw new Error('waitFor 超时（' + timeout + 'ms）：' + expression + (lastError ? ' · 最近错误：' + lastError.message : ''));
  }

  async screenshot(name) {
    fs.mkdirSync(this.artifactsDir, { recursive: true });
    const shot = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(this.artifactsDir, name), Buffer.from(shot.data, 'base64'));
    return path.join(this.artifactsDir, name);
  }

  async click(selector) {
    const ok = await this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
    if (!ok) throw new Error('selector not found: ' + selector);
  }

  async text(selector) {
    return this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.textContent : null; })()`);
  }

  async key(key, type = 'both') {
    const code = CHROME_KEY_CODES[key] || key.toUpperCase().charCodeAt(0);
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

/**
 * 新建页面 target 并连接 CDP，启用 Page / Runtime / Log 与移动端视口模拟。
 * @param {{port: number, width?: number, height?: number, deviceScaleFactor?: number, mobile?: boolean, artifactsDir?: string, url?: string}} options
 * @returns {Promise<CDP>}
 */
export async function openPage({
  port,
  width = 420,
  height = 900,
  deviceScaleFactor = 1,
  mobile = true,
  artifactsDir,
  url = 'about:blank',
} = {}) {
  if (!Number.isInteger(port)) throw new Error('openPage 需要整数 port');
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }).then((r) => r.json());
  const cdp = new CDP(target.webSocketDebuggerUrl, { artifactsDir });
  await cdp.ready();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  return cdp;
}

/**
 * 创建断言记录器：record() 输出 `PASS  name` / `FAIL  name — detail`，
 * assert() 失败即抛错（由各 runner 决定是继续下一条还是中止），
 * summary() 输出 `x/y checks passed` 并返回统计对象。
 * @param {{log?: (line: string) => void}} [options]
 */
export function createRecorder({ log = (line) => console.log(line) } = {}) {
  const results = [];
  function record(name, ok, detail = '') {
    results.push({ name, ok: !!ok, detail });
    log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  }
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  function summary(label = 'checks') {
    const failed = results.filter((r) => !r.ok);
    log(`\n${results.length - failed.length}/${results.length} ${label} passed`);
    return { total: results.length, passed: results.length - failed.length, failed: failed.length };
  }
  return { results, record, assert, summary };
}
