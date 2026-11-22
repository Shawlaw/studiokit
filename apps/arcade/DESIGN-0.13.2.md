# Arcade 0.13.2 设计：PWA「检查更新」版本来源 + iOS 游玩时长永久停摆

## 背景 / Owner 反馈

> 街机厅的 PWA 检查更新的功能好像有 bug？没显示最新版本而是显示已安装版本？

> 你调研一下是不是街机厅所有的游戏时间计算逻辑都出bug了 怎么我用iPhone装pwa版玩一天了 首页显示的游戏时间一直是零 但游戏记录表格又是有数据的

真机场景一：主屏幕已安装 PWA 停留在 `0.13.0`，线上已发布 `0.13.1`；点中心页「🔄 检查更新」，提示里出现的却是 `0.13.0`（也就是当前已安装版本），SW 接管后横幅只显示「发现新版本，刷新后生效。」（没有版本号）。

真机场景二：iPhone 主屏 PWA 游玩一整天后，中心页「累计时长」始终是 `0 分钟`，但「积分记录」表格里有每局的分数与时间。两者是**同一版本里两条独立的写入链路**，本版分别修复。

## 根因（无头 Chrome 已复现，见「验证」）

复现方式：临时副本站点先以 `0.13.1` 注册 SW，再把服务器上的 `apps/arcade/sw.js` 的 `VERSION` 改成 `0.13.2` 调用 `Arcade.Offline.checkForUpdate()`：

```text
page version: 0.13.1
sw version (installed): 0.13.1
server sw.js now VERSION 0.13.2
checkForUpdate result: {"supported":true,"checked":true,"updateFound":true,"version":"0.13.1"}   ← 已安装版本
messages: []                                                                                      ← 新 SW 从未广播
controllerchange count: 1
banner: "发现新版本，刷新后生效。"                                                                  ← 无版本号
sw version after update: 0.13.2
```

1. **`checkForUpdate()` 的版本来源错了（主因）**：`apps/arcade/engine.js` 旧实现直接
   `version: ARCADE_VERSION` 返回，而 `ARCADE_VERSION` 是**页面自己的版本 = 已安装版本**。
   整条链路里没有任何地方读取「线上最新版本是多少」，所以「新版本号」必然显示成旧版本。
2. **SW 永远不会广播新版本**：`apps/arcade/sw.js` 旧实现用模块级 `firstActivation = true`
   判断「是否首次安装」：
   ```js
   let firstActivation = true;
   const isUpdate = !firstActivation && clients.length > 0;
   firstActivation = false;
   ```
   该标志在每个 SW 实例里都从 `true` 开始，而 `notifyUpdateReady()` 在 `activate` 里只调用
   一次，所以 `!firstActivation` 恒为 `false` → `arcade-sw-update-ready` 从未发出。
   于是页面只剩 `updatefound` / `controllerchange` 两个**不带版本号**的信号。
3. **`updateFound` 判定依赖瞬时槽位**：旧实现用
   `!!(registration.waiting || registration.installing)` 判断，但本 SW 在 `install` 里立刻
   `skipWaiting()`，`update()` 返回时新 SW 往往已经进入 activating/activated，
   `waiting` / `installing` 都为 `null`；是否报「有更新」变成时序抽奖。
4. **无版本号信号会覆盖已有版本号**：`controllerchange` 触发 `emitUpdate({ version: null })`，
   可能把 SW 消息带来的 `0.13.2` 覆盖掉，横幅退化成泛化文案。

## 目标与非目标

**目标**：点「检查更新」时提示里出现的是**线上最新版本**，并同时说明当前版本；新 SW 激活后用
`arcade-sw-update-ready` 主动把新版本号送给受控页面；线上版本读取失败时提示失败而不是谎报
「已是最新」。

**非目标**：不做强制更新、不自动刷新打断游玩；不新增远程请求/分析/后端（`sw.js` 为同源
现有文件）；不改任何 localStorage key / Schema / 玩法 / 挑战数据；不在本任务发布。

## 实现

### 1. `apps/arcade/engine.js`（`A.Offline`）

- 新增 `compareVersions(a, b)`：逐段数值比较，缺失/非法返回 0。
- 新增 `publishedVersion()`：`fetch('./sw.js', { cache: 'no-store' })` 后解析 `const VERSION = '…'`。
  浏览器不允许 SW 拦截自己的脚本请求，因此它拿到的是**网络上的当前发布版本**；失败返回 `null`。
- 抽出 `workerVersion(worker)` / `activeWorker(registration)`，`swVersion()` 复用；
  握手消息仍为 `arcade-sw-version`（协议不变）。
- 重写 `checkForUpdate()`：
  1. 先记录**已安装 SW 版本**（此时 active 仍是旧 SW）；
  2. 触发 `registration.update()`（拉取并安装新 SW，失败不阻塞结论）；
  3. 读取 `publishedVersion()`；读不到时退回本次 `update()` 是否拉到新 SW 并握手取版本；
  4. `updateFound = 线上版本 > 页面版本 || 线上版本 > 已安装 SW 版本`（后者覆盖
     「SW 已更新但页面还是旧的」这种刷新前状态）；
  5. 返回 `{ version, latestVersion, installedVersion, pageVersion, updateReason, checked, updateFound }`，
     其中 `version` 是**线上最新版本**，`updateReason` 为 `published` / `service-worker` / `null`，
     `checked` 仅在真的读到线上版本时为 `true`。
- `emitUpdate()` 改为「版本号粘性」：收到不带版本号的信号时保留已知道的最新版本。
- `A.version` 仍为页面自身版本（用于中心页版本标记），语义不变。

### 2. `apps/arcade/sw.js`

- 删除 `firstActivation` 判断，改为 `isUpdateActivation()`：`activate` 里**在清理旧缓存之前**
  检查前缀 `studiokit-arcade-` 下是否还有非当前 `CACHE_NAME` 的缓存；有 = 本次是升级接管。
- `activate`：`replacedOldVersion = await isUpdateActivation()` → 清旧缓存 → `clients.claim()`
  → 仅升级接管时 `notifyUpdateReady()` 广播 `{ type: 'arcade-sw-update-ready', version: VERSION }`。
  首次安装没有任何旧缓存，不打扰用户（原设计意图不变，判断依据改为可观测证据）。

### 3. `apps/arcade/index.html`（中心页）

- 横幅：`发现新版本 v{最新}（当前 v{页面}），刷新后生效。`；
  版本相同但 SW 缓存落后时显示「检测到更新缓存已就绪（当前 vX），刷新后生效。」；
  只有无版本号信号时保留泛化文案。
- 按钮提示：发现更新 → `发现新版本 v{最新}（当前 v{页面}），请按提示刷新。`；
  已同步 → `已是最新版本（v{最新}）。`；`checked === false` → `检查更新失败，请检查网络后重试。`
  （旧实现把读取失败落到「已是最新版本」，属于误导）。

## 4. 游玩时长：iOS 主屏 PWA 漏发 focus 后永久停摆

### 4.1 根因

16 款游戏共用 `apps/arcade/engine.js` 里的同一个 `Playtime` 模块，**不存在 16 份各自的时间算法**；每局结算时 `Progress.recordPlay` 先调 `Playtime.recordRound` 记录本轮时长，再写 `scores:v1` 积分记录。两者是独立写入链路，所以会出现「积分记录有数据、累计时长为 0」。

旧实现的计时门槛是 `startSegment()` 里的 `!currentGame || overlayOpen || !visible || !focused || segStart`，其中 `focused` **只由 window `focus` 事件恢复**（`blur` 置 false 并落盘）。iOS 主屏 PWA 的 `focus` 事件不可靠：回到前台常常只有 `visibilitychange`，应用从主屏/多任务恢复时页面也不会像浏览器标签页那样重新加载（iOS 13+ 直接沿用原页面）。只要漏掉一次 `focus`（开局前切一次聊天软件、锁屏、通知横幅、键盘收起等都可能触发 `blur`），这一页的计时就**永久停摆**：之后每局 `round` 都记为 0ms，积分记录照写，于是出现「玩一天还是 0 分钟、积分记录有数据」。

同一处代码里 `createLoop` 的自动暂停/恢复是「`blur` 或 `visibilitychange` 都认」，而 `Playtime` 只认 `focus`，两者语义不一致，是停摆的直接原因。

无头 Chrome 复现（同一游戏页先派发 `blur` 再点开始，之后不再派发 `focus`）：

```text
normal totalMs = 1205            ← 修复前，正常页面可计时
after blur(no focus) totalMs = 1205  snake row = null   ← 新游戏页完全不计时
settle = { score.durationMs: 0, total: 1205,
           games: [block-drop 1205, snake-run 0], rounds: 1 }
after more taps totalMs = 1205   ← 再点按也不会恢复（没有 focus 事件）
```

### 4.2 修复（`apps/arcade/engine.js` 的 `Playtime`）

- 新增 `canTrack()`：**只认「页面可见 + 开始/暂停/结算弹层已关闭」**。全部 16 款游戏在失焦/隐藏时都会经 `createLoop.onAutoPause → pauseByUser` 自动暂停并打开暂停弹层，弹层已足够拦住失焦时间，`focus` 门槛是多余且危险的。
- 删除 `focused` 变量与 `|| !focused`；`blur` 仍先 `flushTime()` 落盘，真正暂停交给游戏自动暂停 + 暂停弹层。
- 新增 `syncSegment()`：按实时 `document.hidden` 对时间片自愈一次——可见且弹层关闭就补开时间片，否则先把已游玩片段落盘。
- 自愈触发点：`visibilitychange`、window `focus`、`pageshow`、**用户 `pointerdown` / `keydown` / `touchstart`（capture + passive）**、以及每 15 秒的落盘 tick。iOS 上任何一次真实点按都会在同一个事件里恢复计时，不再依赖永远等不到的 `focus`。
- `recordRound()` 结算写完时长后调用 `syncSegment()`：逐手结算（如二十一点）不会关掉时间片后要等 15 秒 tick 才恢复。
- 20 分钟休息提醒不再以 `focused` 延后（iOS 可能永远收不到 `focus` 会把一次性提醒吞掉），只按页面可见性延后。

### 4.3 验证

- 复现对照：同一时序（先 `blur`、再无 `focus`）修复前 `snake-run` 时长 0ms、结算 `durationMs: 0`；修复后同一脚本得到 `snake-run ms=1504`、结算 `durationMs: 1504`、之后点按继续累计。
- `tools/arcade_smoke.mjs` 新增 3 项回归（105 → **108/108**）：
  1. 开局前只有 `blur`、之后没有 `focus`，点「开始游戏」仍计时（≥900ms）；
  2. 游玩中失焦自动暂停且不泄漏暂停时间；没有 `focus` 事件时点「继续」仍恢复计时；
  3. 同一路径结算写进积分记录的 `durationMs` ≥900ms（不再是 0）。
- 真机：0.13.2 发布后需 Owner 在 iPhone 主屏 PWA 上复测「玩一局 → 回中心页累计时长/今日/近 7 天」，并确认积分记录的时长不再是 `00:00`（UNVERIFIED）。

## 兼容性 / 数据

- 无 localStorage key / Schema 变更；不改 `progress` / `runs` / `prefs` / `playtime` /
  `challenge` / `scores` / `meta`。
- SW 消息协议（`arcade-sw-version` / `arcade-sw-skip-waiting` / `arcade-precache` /
  `arcade-sw-update-ready`）与缓存键格式 `studiokit-arcade-<VERSION>-v1` 不变，
  旧页面与新 SW、新页面与旧 SW 均可共存：旧页面不读 `latestVersion` 字段也不报错。
- 新增同源请求 `GET ./sw.js`（no-store，约 8KB）：只读现有文件，不引入任何新依赖或远程资源；
  离线时请求失败，走「检查更新失败」提示。
- 版本链：`ARCADE_VERSION` / SW `VERSION` / `data-hall-version` / 注册表 / `validate_site.py`
  断言 / 各门禁测试统一 `0.13.2`，SW 缓存键 `studiokit-arcade-0.13.2-v1`。

## 测试与证据

- 复现：见上「根因」的实跑输出（修复前 `version=0.13.1`、`messages=[]`、横幅无版本号）。
- `tools/arcade_pwa_update_test.mjs` 扩到 **9/9**（新增 PU-06/PU-07，PU-02/PU-03 改写）：
  - PU-02：版本一致时 `updateFound === false`、`version/latestVersion === '0.13.2'`；
  - PU-03：模拟 SW 消息 `0.13.3`，横幅同时显示「0.13.3」与「当前 v0.13.2」；
  - PU-06：临时副本站点真实发版（改 `sw.js` VERSION → `0.13.3`）后，
    `checkForUpdate` 返回 `0.13.3`（`installedVersion` 仍是 `0.13.2`）、
    SW 主动广播 `arcade-sw-update-ready: 0.13.3`、`controllerchange` 触发、
    横幅含两个版本、新 SW 接管后再次检查仍判有更新、按钮提示含新版本号；
  - PU-07：拦截 `sw.js` 请求模拟离线 → `checked === false`，按钮提示「检查更新失败」。
- `tools/arcade_smoke.mjs` 105 → **108/108**（新增 3 项 iOS 漏发 focus 的计时回归）：
  - 模拟 iOS 时序「blur → visibilitychange（无 focus）」后点「开始游戏」，1300ms 后累计 1314ms；
  - 游玩中同样的「blur → visibilitychange（无 focus）」：自动暂停期间零泄漏，点「继续」后 1300ms 累计 +1318ms；
  - 同一路径手动结算，写进 `scores:v1` 的本轮 `durationMs` 为 2632ms（旧实现为 0）。
- 门禁：`validate_site.py`（新增 0.13.2 版本来源/广播断言 + 游玩计时自愈标记与「旧 focus 门槛」禁回归断言）、`build_site.py`、
  `check_inline_scripts.mjs`、`node --check engine.js/sw.js`、`arcade_design_check.py`；
  回归 `arcade_smoke` **108/108**、`arcade_pwa_update_test` **9/9**、`arcade_zen_scores_test` **14/14**、
  `arcade_calm_games_test` **17/17**、`arcade_review_test` **5/5**、`arcade_interaction_test` **5/5**、
  `arcade_tower_test` **23/23**、`arcade_immersive_buttons_test` **32/32**、
  `arcade_gameplay_test --suite=base --repeat=2` **22/22** 与 320–430px 布局。
- 真机：iOS 主屏幕 PWA 从 0.13.1 → 0.13.2 的实际更新提示时机，以及「玩一局 → 回中心页看累计/今日/近 7 天 + 积分记录时长不再是 00:00」仍需 Owner 复测（UNVERIFIED）。

## 回滚

- 代码层：回退 `engine.js`（`publishedVersion` / `checkForUpdate` / `emitUpdate`）、`sw.js`
  （`isUpdateActivation` 与 activate 广播条件）、`index.html`（文案）三处，并把版本链降回
  `0.13.1`；SW 缓存键随 `VERSION` 恢复为 `studiokit-arcade-0.13.1-v1`，旧缓存会在下次激活时清理。
- 游玩时长：把 `Playtime` 的 `focused` 门槛与 install 监听还原即可（数据格式未变）；
  修复期间写入的 0ms 轮次不会被自动纠正（历史数据无法补算），回滚也不影响已累计的非零时长。
- 数据层：无 Schema/key 变更，无需迁移。
- 更新检测与离线缓存相互独立：即使回退广播逻辑，离线预载、缓存优先/网络优先策略均不受影响。
- 游玩计时与积分记录、局内档相互独立：回退计时逻辑不会影响 `scores:v1` / `runs:v1` 的读取与导出。
