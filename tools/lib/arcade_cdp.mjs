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
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

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
 * 目录自动补 index.html；找不到文件返回 404。可模拟 Cloudflare Pages 的街机厅地址重定向与压缩。
 * @param {{root?: string, port: number, host?: string, cloudflarePages?: boolean}} options
 * @returns {Promise<import('node:http').Server>}
 */
export function startServer({ root = REPO_ROOT, port, host = '127.0.0.1', cloudflarePages = false } = {}) {
  if (!Number.isInteger(port)) throw new Error('startServer 需要整数 port');
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (cloudflarePages && /^\/apps\/arcade\/(?:index|games\/[a-z0-9-]+)\.html$/.test(urlPath)) {
        const canonical = urlPath === '/apps/arcade/index.html' ? '/apps/arcade/' : urlPath.slice(0, -5);
        const search = new URL(req.url, 'http://localhost').search;
        res.writeHead(308, { Location: canonical + search });
        res.end();
        return;
      }
      let filePath = path.join(root, urlPath.startsWith('/studiokit/') ? urlPath.slice('/studiokit'.length) : urlPath);
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
      /* Cloudflare Pages 的 pretty URL 会把 /x.html 308 到 /x；测试服务器也接受无后缀路径，
         用于回归「线上扩展名被去掉后游戏识别是否仍然正确」。 */
      if (!fs.existsSync(filePath) && !path.extname(filePath)) {
        const htmlCandidate = filePath + '.html';
        if (fs.existsSync(htmlCandidate)) filePath = htmlCandidate;
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const ext = path.extname(filePath);
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
      let body = fs.createReadStream(filePath);
      if (cloudflarePages && urlPath.startsWith('/apps/arcade/') && ext === '.html' && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        headers['Content-Encoding'] = 'gzip';
        body = body.pipe(createGzip());
      }
      res.writeHead(200, headers);
      body.pipe(res);
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
export async function waitForJson(url, timeout = 15000, signal = null) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (signal && signal.aborted) throw new Error('aborted');
    try {
      const res = await fetch(url, signal ? { signal } : undefined);
      if (res.ok) return await res.json();
    } catch (err) {
      if (signal && signal.aborted) throw new Error('aborted');
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

function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (free) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (err) { /* ignore */ }
      resolve(free);
    };
    socket.once('connect', () => finish(false));
    socket.once('error', () => finish(true));
    setTimeout(() => finish(true), 800).unref();
  });
}

/** 最近一次 Chrome 启动失败的证据（供调用方打印，不写入产品文件）。 */
let lastLaunchFailure = null;
const STDERR_TAIL_LIMIT = 4000;

export function getLastLaunchFailure() {
  return lastLaunchFailure ? { ...lastLaunchFailure } : null;
}

function errorText(err) {
  return err && typeof err.message === 'string' && err.message ? err.message : String(err);
}

function tailText(text, limit = STDERR_TAIL_LIMIT) {
  const str = String(text || '');
  return str.length > limit ? str.slice(-limit) : str;
}

function describePortFile(file) {
  try {
    if (!fs.existsSync(file)) return { exists: false, raw: null, port: null, wsPath: null };
    const raw = fs.readFileSync(file, 'utf8');
    const lines = raw.split(/\r?\n/);
    const port = Number(lines[0]);
    const wsPath = (lines[1] || '').trim();
    return {
      exists: true,
      raw: tailText(raw, 300),
      port: Number.isInteger(port) && port > 0 ? port : null,
      wsPath: wsPath || null,
    };
  } catch (err) {
    return { exists: true, error: errorText(err) };
  }
}

function readDevToolsActivePort(profile, timeoutMs = 10000, signal = null) {
  const file = path.join(profile, 'DevToolsActivePort');
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (signal && signal.aborted) { reject(new Error('aborted')); return; }
      try {
        if (fs.existsSync(file)) {
          const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
          const port = Number(lines[0]);
          const wsPath = (lines[1] || '').trim();
          if (Number.isInteger(port) && port > 0 && wsPath) {
            resolve({ port, wsPath });
            return;
          }
        }
      } catch (err) {
        /* 文件可能正在写入，下一轮再读 */
      }
      if (Date.now() - start >= timeoutMs) {
        const detail = describePortFile(file);
        reject(new Error(
          'Chrome DevToolsActivePort 未就绪（等待 ' + (Date.now() - start) + 'ms，profile=' + profile +
          '，文件=' + JSON.stringify(detail) + '）'
        ));
        return;
      }
      setTimeout(tick, 80).unref();
    };
    tick();
  });
}

function verifyBrowserCdp(version, timeoutMs = 4000, signal = null) {
  const url = version && version.webSocketDebuggerUrl;
  if (signal && signal.aborted) return Promise.reject(new Error('aborted'));
  if (typeof url !== 'string' || !url) return Promise.reject(new Error('CDP /json/version 缺少 webSocketDebuggerUrl'));
  if (typeof version.Browser !== 'string' || !/^Chrome\//.test(version.Browser)) {
    return Promise.reject(new Error('CDP /json/version 不是 Chrome: ' + version.Browser));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws = null;
    const timer = setTimeout(() => finish(new Error('CDP Browser.getVersion 超时')), timeoutMs);
    const onAbort = () => finish(new Error('aborted'));
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    function finish(err, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      try { if (ws) ws.close(); } catch (closeErr) { /* ignore */ }
      if (err) reject(err); else resolve(value);
    }
    try {
      ws = new WebSocket(url);
    } catch (err) {
      finish(err);
      return;
    }
    ws.addEventListener('open', () => {
      try { ws.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' })); } catch (err) { finish(err); }
    });
    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg && msg.id === 1) {
          const product = msg.result && msg.result.product;
          if (typeof product === 'string' && /^Chrome\//.test(product)) finish(null, product);
          else finish(new Error('CDP WebSocket 不是 Chrome: ' + String(product)));
        }
      } catch (err) {
        finish(err);
      }
    });
    ws.addEventListener('error', () => finish(new Error('CDP WebSocket 连接失败')));
  });
}

const ownedBrowsers = new Map();

/**
 * 单次 Chrome 启动尝试：捕获 stderr/exit/profile/端口证据，不并发、不触碰其它实例。
 * 返回 { ok, launched, evidence }；evidence 在失败时由外层记录/重试。
 */
async function launchChromeOnce({
  requestedPort, chromePath, profilePrefix, windowSize, headless, extraArgs,
}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), profilePrefix));
  const args = [
    ...(headless ? ['--headless=new'] : []),
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--remote-allow-origins=*',
    /* 始终动态端口：固定端口请求仅作调用方兼容别名，实际端口由本轮 profile 的 DevToolsActivePort 证明。 */
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${windowSize}`,
    '--hide-scrollbars',
    '--mute-audio',
    ...extraArgs,
    'about:blank',
  ];
  /* 不再 stdio:'ignore'：stderr 是诊断 Chrome 启动失败的关键证据，仅在内存保存尾部，不落盘产品文件。 */
  const chrome = spawn(chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stderr = '';
  let stdout = '';
  let exitInfo = null;
  chrome.stderr.on('data', (chunk) => { stderr = tailText(stderr + String(chunk)); });
  chrome.stdout.on('data', (chunk) => { stdout = tailText(stdout + String(chunk)); });
  chrome.once('exit', (code, signal) => { exitInfo = { code, signal }; });
  const evidence = () => ({
    profile,
    portFile: describePortFile(path.join(profile, 'DevToolsActivePort')),
    exit: exitInfo,
    pid: Number.isInteger(chrome.pid) ? chrome.pid : null,
    chromePath,
    stderrTail: tailText(stderr),
    stdoutTail: tailText(stdout, 800),
  });
  const exited = new Promise((resolve, reject) => {
    chrome.once('exit', (code, signal) => reject(new Error('Chrome 提前退出（code=' + code + ', signal=' + signal + '）')));
  });
  const spawnFailed = new Promise((resolve, reject) => {
    chrome.once('error', (err) => reject(new Error('Chrome 启动失败（' + chromePath + '）：' + err.message)));
  });
  exited.catch(() => { /* 成功后不再需要，避免 unhandled rejection */ });
  spawnFailed.catch(() => { /* 与 ready 竞速，失败时由外层 catch 处理 */ });
  const abort = new AbortController();
  try {
    const actual = await Promise.race([
      readDevToolsActivePort(profile, 10000, abort.signal),
      spawnFailed,
      exited,
    ]);
    const endpoint = `http://127.0.0.1:${actual.port}`;
    const versionReady = waitForJson(`${endpoint}/json/version`, 15000, abort.signal).then((version) => {
      if (!version || typeof version.webSocketDebuggerUrl !== 'string') throw new Error('CDP /json/version 缺少 webSocketDebuggerUrl');
      const expectedPath = actual.wsPath ? actual.wsPath.replace(/^\/+/, '') : '';
      if (expectedPath && !version.webSocketDebuggerUrl.includes('/' + expectedPath)) {
        throw new Error('CDP /json/version 与 DevToolsActivePort 不匹配');
      }
      return version;
    }).then((version) => verifyBrowserCdp(version, 4000, abort.signal).then((product) => ({ version, cdpProduct: product })));
    versionReady.catch(() => {});
    const ready = await Promise.race([versionReady, exited, spawnFailed]);
    if (chrome.exitCode !== null) throw new Error('Chrome 启动后已退出');
    const entry = {
      child: chrome,
      wsPath: ready && ready.version ? ready.version.webSocketDebuggerUrl : null,
      actualPort: actual.port,
    };
    ownedBrowsers.set(actual.port, entry);
    if (requestedPort > 0 && requestedPort !== actual.port) ownedBrowsers.set(requestedPort, entry);
    return {
      ok: true,
      evidence: evidence(),
      launched: {
        chrome, profile, port: actual.port, requestedPort, dynamicPort: true,
        cdpProduct: ready && ready.cdpProduct,
        browserWsPath: ready && ready.version ? ready.version.webSocketDebuggerUrl : null,
      },
    };
  } catch (err) {
    abort.abort();
    try {
      if (chrome.exitCode === null) chrome.kill();
    } catch (killErr) { /* ignore */ }
    /* 保留证据副本：随后 removeProfile 会删掉 DevToolsActivePort 文件。 */
    const failure = { message: errorText(err), ...evidence() };
    removeProfile(profile);
    return { ok: false, evidence: failure };
  }
}

/**
 * 启动本机 Chrome 并等待 DevTools 端口就绪。
 * 每次调用使用独立 mkdtemp profile；port 省略或传 0 时由 Chrome 选择动态端口，
 * 从该 profile 的 DevToolsActivePort 读取实际端口，绝不连接端口上已有的其它服务。
 * 固定端口在启动前先检测占用，并在就绪后通过 Chrome 身份 + Browser.getVersion
 * （CDP WebSocket）确认归属；冲突/替身时无副作用退出，不触碰占用者。
 *
 * 启动韧性：Chrome 冷启动偶尔在 10s 内未写出 DevToolsActivePort（系统资源/磁盘抖动）。
 * 这里对「未完成握手」做有限次数**串行**重试（每次新 profile + 新子进程，前一次先 kill/清 profile），
 * 不并发、不接触用户浏览器；确定性失败（路径不存在、端口被占、CDP 身份不符、提前退出）立即终止。
 * 每次失败证据记录到 getLastLaunchFailure()，重试耗尽时完整抛给用户，不掩盖真实失败。
 *
 * @param {{port?: number, chromePath?: string, profilePrefix?: string, windowSize?: string, headless?: boolean, extraArgs?: string[], attempts?: number}} options
 * @returns {Promise<{chrome: import('node:child_process').ChildProcess, profile: string, port: number, dynamicPort: boolean}>}
 */
export async function launchChrome({
  port = 0,
  chromePath = DEFAULT_CHROME,
  profilePrefix = 'studiokit-arcade-',
  windowSize = '420,900',
  headless = true,
  extraArgs = [],
  attempts = 3,
} = {}) {
  if (!Number.isInteger(port) || port < 0) throw new Error('launchChrome 需要非负整数 port');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) {
    throw new Error('launchChrome.attempts 必须是 1-5 的整数');
  }
  const requestedPort = port;
  if (requestedPort > 0 && !(await isPortFree(requestedPort))) {
    throw new Error('launchChrome: CDP 端口已被占用，拒绝启动（未触碰占用进程）: ' + requestedPort);
  }
  const failures = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await launchChromeOnce({
      requestedPort, chromePath, profilePrefix, windowSize, headless, extraArgs,
    });
    if (result.ok) {
      lastLaunchFailure = null;
      return result.launched;
    }
    failures.push({ attempt, ...result.evidence });
    const msg = result.evidence.message;
    /* 确定性错误不重试：路径不存在、端口占用、身份/CDP 不符或子进程提前退出。 */
    const fatal = /启动失败（|CDP \/json\/version|提前退出|启动后已退出/.test(msg);
    if (fatal) break;
    if (attempt < attempts) await sleep(300 * attempt);
  }
  lastLaunchFailure = { attempts: failures.length, failures };
  const summary = failures.map((f) =>
    '#' + f.attempt + ' ' + f.message +
    ' [exit=' + JSON.stringify(f.exit) + ', pid=' + f.pid +
    ', profile=' + f.profile + ', portFile=' + JSON.stringify(f.portFile) +
    ', stderr=' + JSON.stringify(f.stderrTail.slice(-500)) + ']'
  ).join(' | ');
  throw new Error('Chrome 启动重试 ' + failures.length + '/' + attempts + ' 次均失败：' + summary);
}

/**
 * 关闭本次启动的 Chrome 子进程并清理其临时 profile；只操作传入的子进程句柄。
 * @param {{chrome?: import('node:child_process').ChildProcess, profile?: string}} launched
 */
export async function stopChrome({ chrome, profile } = {}) {
  for (const [port, entry] of ownedBrowsers) {
    if (entry.child === chrome) ownedBrowsers.delete(port);
  }
  if (chrome && chrome.exitCode === null) {
    try { chrome.kill(); } catch (err) { /* ignore */ }
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      chrome.once('exit', finish);
      setTimeout(finish, 3000);
    });
  }
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
  const owned = ownedBrowsers.get(port);
  if (!owned) throw new Error('openPage: CDP 端口未登记或已失效，拒绝在发请求前连接: ' + port);
  const actualPort = owned.actualPort || port;
  if (!owned.child || owned.child.exitCode !== null) throw new Error('openPage: 本轮 Chrome 已退出，拒绝连接 ' + port);
  const version = await fetch(`http://127.0.0.1:${actualPort}/json/version`).then((r) => r.json());
  if (!owned.wsPath || version.webSocketDebuggerUrl !== owned.wsPath) {
    throw new Error('openPage: CDP 端口归属已变化，拒绝向非本轮 Chrome 新建 target');
  }
  const target = await fetch(`http://127.0.0.1:${actualPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }).then((r) => r.json());
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
