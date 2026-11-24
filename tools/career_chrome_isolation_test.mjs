#!/usr/bin/env node
/**
 * Chrome 隔离证明：固定端口被占用时不启动/不连接/不清理占用者；
 * 正常启动使用动态端口与独立临时 profile，只关闭本次子进程。
 */
import http from 'node:http';
import { launchChrome, openPage, stopChrome } from './lib/arcade_cdp.mjs';

let total = 0;
let failed = 0;
function check(name, ok, detail) {
  total += 1;
  if (ok) console.log('PASS  ' + name + ' — ' + JSON.stringify(detail).slice(0, 600));
  else { failed += 1; console.log('FAIL  ' + name + ' — ' + JSON.stringify(detail).slice(0, 900)); }
}

const sentinel = http.createServer((req, res) => {
  if (req.url === '/json/version') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ Browser: 'Sentinel', webSocketDebuggerUrl: 'ws://127.0.0.1/sentinel' }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});
await new Promise((resolve, reject) => { sentinel.once('error', reject); sentinel.listen(0, '127.0.0.1', resolve); });
const sentinelPort = sentinel.address().port;
let hits = 0;
sentinel.on('request', () => { hits += 1; });
try {
  let rejected = null;
  try {
    await launchChrome({ port: sentinelPort, profilePrefix: 'arcade-isolation-bad-' });
  } catch (err) {
    rejected = String(err && err.message);
  }
  const response = await new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: sentinelPort, path: '/json/version' }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', (err) => resolve({ status: 0, error: String(err) }));
  });
  check('固定端口被占用：launchChrome 无副作用失败，哨兵保持响应', !!rejected && /占用/.test(rejected) && response.status === 200, { rejected, response, hits });
  check('失败前未连接哨兵（占用检测先于启动/连接）', hits <= 1, { hits });

  const launched = await launchChrome({ port: 0, profilePrefix: 'arcade-isolation-good-' });
  const alive = launched.chrome && launched.chrome.exitCode === null && launched.chrome.pid > 0;
  const version = await fetch('http://127.0.0.1:' + launched.port + '/json/version').then((res) => res.json());
  check('动态端口启动：pid/profile/实际端口可用且与 DevToolsActivePort 一致', alive && launched.dynamicPort && launched.port > 0 && typeof version.webSocketDebuggerUrl === 'string' && version.webSocketDebuggerUrl.includes(':' + launched.port), { pid: launched.chrome.pid, port: launched.port, profile: launched.profile, browser: version.Browser });
  const p = await openPage({ port: launched.port });
  await p.navigate('about:blank');
  check('独立 profile 页面可连接', p.ws && p.ws.readyState === 1, { readyState: p.ws && p.ws.readyState });
  try { p.ws.close(); } catch (err) { /* ignore */ }
  await stopChrome(launched);
  check('只关闭本轮子进程后，哨兵仍保持响应', (launched.chrome.exitCode !== null || launched.chrome.killed === true || launched.chrome.signalCode !== null) && (await fetch('http://127.0.0.1:' + sentinelPort + '/json/version')).ok, { childExit: launched.chrome.exitCode, killed: launched.chrome.killed, signal: launched.chrome.signalCode, sentinelPort });
} finally {
  await new Promise((resolve) => sentinel.close(resolve));
}
if (failed) { console.log(failed + ' failed / ' + total + ' checks'); process.exitCode = 1; }
else console.log('CHROME ISOLATION PASS (' + total + '/' + total + ')');
