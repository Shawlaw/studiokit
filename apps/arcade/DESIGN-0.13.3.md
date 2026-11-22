# Arcade 0.13.3 设计：Cloudflare Pages 无后缀 URL 导致游戏识别失败（计时全 0）

## 背景 / Owner 反馈

0.13.2 发布后，Owner 在 iPhone 主屏 PWA 里复测：多款游戏（星海突击 / 2048 / 俄罗斯方块）玩完，
中心页「累计时长 / 今日 / 近 7 天」仍全是 `0 分钟`，**积分记录里每一局的时长也是 0**；
但同一份自检页用 Edge（桌面）打开完全正常。引擎版本确认 0.13.2。

## 根因（设备自检 + 线上响应确认）

设备自检页（`apps/arcade/diag.html`）在 PWA 内抓到关键数据：

```text
pageHref  = https://studiokit.pages.dev/apps/arcade/diag
frameHref = https://studiokit.pages.dev/apps/arcade/games/block-drop   ← 没有 .html
framePath = /apps/arcade/games/block-drop
file      = "block-drop"                                                ← 不是 block-drop.html
Playtime.currentGame = null     tracking = false    timer = false
playtimeRawLength = 0（从未写入过）
```

线上响应确认这是 Cloudflare Pages 的 **pretty URL** 行为：

```text
GET https://studiokit.pages.dev/apps/arcade/games/block-drop.html
→ 308 Location: /apps/arcade/games/block-drop

GET https://shawlaw.github.io/studiokit/apps/arcade/games/block-drop.html
→ 200（GitHub Pages 保留 .html）
```

而 `engine.js` 的 `detectCurrentGame()` 用**精确文件名**比对：

```js
const file = pathname.slice(marker + '/games/'.length);   // "block-drop"
return GAMES.find((g) => g.file === file) || null;        // g.file 是 "block-drop.html"
```

→ 在 Cloudflare 部署（也就是 Owner 的 PWA 来源）上 `currentGame` 恒为 `null`：

1. `Playtime` 的 `install()` 直接 return → 不挂任何监听、不开 tick；
2. `canTrack()` 恒 false → 时间片从未开始；
3. `Progress.recordPlay()` 里 `Playtime.recordRound()` 因 `currentGame` 为空直接返回
   `{ duration: 0 }` → 积分记录仍照常写入，但每局时长是 `00:00`；
4. `playtime:v1` 从未被写入 → 累计/今日/近 7 天全 `0 分钟`。

Edge 打开时走的是带 `.html` 的地址（或 GitHub Pages），所以表现正常——与 Owner 的观察一致。

## 修复

### `apps/arcade/engine.js`（`detectCurrentGame`）

不再精确比较文件名，改为规范化后比较，同时兼容三种来源：

- GitHub Pages：`/games/block-drop.html`；
- Cloudflare Pages pretty URL：`/games/block-drop`（308 后）；
- 尾斜杠、URL 编码、大小写差异。

```js
const raw = pathname.slice(marker + '/games/'.length).replace(/\/+$/, '');
const file = raw.replace(/\.html$/i, '').toLowerCase();
return GAMES.find((g) => g.file.replace(/\.html$/i, '').toLowerCase() === file) ||
       GAMES.find((g) => g.id.toLowerCase() === file) || null;
```

`ARCADE_BASE` 仍优先取 `document.currentScript.src`，因此无后缀 URL 下 SW/分享链接不受影响
（游戏页相对路径的目录层级不变，`../engine.js`、`../arcade.css`、`../../../shared/` 均可解析）。

### 版本链

`0.13.3`：`ARCADE_VERSION` / `sw.js VERSION` / 中心页 `data-hall-version` / 注册表 /
`validate_site.py` 断言 / 各门禁测试统一；SW 缓存键 `studiokit-arcade-0.13.3-v1`。

### 测试基础设施

`tools/lib/arcade_cdp.mjs` 的静态服务器增加「无后缀 → `x.html`」回退，等价模拟 Cloudflare
pretty URL；`tools/arcade_smoke.mjs` 新增回归（108 → **109/109**）：

- 打开 `/apps/arcade/games/block-drop`（无 `.html`）后 `Playtime.currentGame.id === 'block-drop'`、
  `tracking === true`、`timer` 已安装；
- 该 URL 下点「开始游戏」运行 1.3 秒，`Playtime.stats().totalMs ≥ 900`。

其余测试（pwa 9/9、zen、calm、review、interaction、immersive、tower、gameplay、挑战矩阵、
320–430px 布局）版本断言同步升至 0.13.3，行为零改动。

### 临时诊断页

`apps/arcade/diag.html`（中心页「游玩统计 → 计时自检」）保留到本版，用于 Owner 在真机确认
「计时正常 ≥2000ms」；`block-drop.html` 的 `?diag=1` 顶层探针在定位后已移除。

## 兼容性 / 数据

- 无 localStorage key / Schema 变更；`playtime:v1` / `scores:v1` 格式不变；
- 历史上记成 0ms 的轮次不会回填（无法补算），修复后从下一局开始正常累计；
- GitHub Pages 与 Cloudflare Pages 两种 URL 形态现在都能正确识别游戏；
- 回滚：还原 `detectCurrentGame()` 并把版本链降回 0.13.2（会重新出现 CF 上计时为 0，不推荐）。

## 验证

- 已双端发布（2026-11-22）：提交 `b3a8c7e`，Actions run `45007754972` 四 job 全绿；`tools/verify_deploy.py` **41/41** 双端一致（arcade 0.13.3）。
- 线上实测：CF 无后缀 URL 修复前 `currentGame=null / tracking:false / timer:false`，修复后 `currentGame:"block-drop" / tracking:true / timer:true`，点开始游玩 1.6s 后 `totalMs=1606`；GH Pages `.html` 路径 `currentGame=block-drop` 同样正常；线上诊断页 iframe 显示「计时正常 记录到 3508ms」；0 console error。
- 线上（CF）确认：`block-drop.html` 308 → `/block-drop`；修复后无后缀 URL 下
  `Playtime.currentGame.id === 'block-drop'` 且游玩 1.3s 后 `totalMs ≥ 900`；
- 设备：Owner 在 PWA 内打开「计时自检」，应显示「计时正常 记录到 ≥2000ms」；
  再玩一局确认累计时长/积分记录时长不再是 0；
- 门禁：`arcade_smoke` **109/109**、pwa 9/9、zen 14/14、calm 17/17、review 5/5、
  interaction 5/5、immersive 32/32、tower 23/23、gameplay all 104/104 + base 22/22、
  挑战矩阵 78 关、`validate_site` / `build_site` / `check_inline_scripts` / `node --check` /
  `arcade_design_check` 全过；双端 `verify_deploy.py` 41/41 一致。

## 回滚

- 代码层：还原 `detectCurrentGame()`（精确文件名比较），版本链降回 `0.13.2`；
  SW 缓存键随 `VERSION` 恢复，旧缓存下次激活自动清理。
- 数据层：无迁移。
- 诊断页：确认修复后可从中心页移除入口并删除 `apps/arcade/diag.html`（不影响游戏）。
