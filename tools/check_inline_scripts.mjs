#!/usr/bin/env node
/**
 * 对静态站点里所有 HTML 的内联 <script>（无 src）做 node --check 语法检查。
 * 这些脚本不会被 node --check 直接覆盖，语法错误只会在浏览器里静默炸掉页面。
 *
 * 用法：node tools/check_inline_scripts.mjs [--root=apps]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const prefix = '--' + name + '=';
  const hit = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const target = path.resolve(ROOT, arg('root', 'apps'));
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(full);
  }
}
walk(target);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studiokit-inline-'));
let blocks = 0;
let failed = 0;

for (const file of files.sort()) {
  const source = fs.readFileSync(file, 'utf8');
  let index = 0;
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(source))) {
    const attrs = match[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const body = match[2] || '';
    if (!body.trim()) continue;
    blocks += 1;
    const tmp = path.join(tmpDir, `${path.basename(file, '.html')}-${index}.js`);
    index += 1;
    fs.writeFileSync(tmp, body, 'utf8');
    const result = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    if (result.status !== 0) {
      failed += 1;
      console.error(`FAIL ${path.relative(ROOT, file)} 内联脚本 #${index}:`);
      console.error((result.stderr || '').split('\n').slice(0, 8).join('\n'));
    }
  }
}

fs.rmSync(tmpDir, { recursive: true, force: true });
if (failed) {
  console.error(`\nFAIL 内联脚本语法检查：${failed}/${blocks} 失败`);
  process.exit(1);
}
console.log(`PASS 内联脚本语法检查：${files.length} 个 HTML，${blocks} 段脚本全部通过`);
