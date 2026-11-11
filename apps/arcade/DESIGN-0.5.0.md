# Arcade 0.5.0 设计：游玩统计、分享、PWA 与离线预载

本文件记录 0.5.0 的数据模型、计时语义、分享路径、Service Worker 缓存策略、兼容与回滚方式。实现不引入 npm、构建器、远程资源或后端。

## 1. 目标与非目标

**目标**

1. 记录真实游玩时长，并在中心页汇总（累计 / 今日 / 近 7 天）与按游戏、按轮次展示。
2. 分享合集或单款游戏的公开链接；优先系统分享，失败时复制链接。
3. 中心页可安装为 PWA，以独立窗口从桌面启动。
4. 用户显式点击后，把中心页、引擎与 13 款游戏预载到浏览器缓存；断网仍可游玩。

**非目标**

- 不做账号、云存档、排行榜、在线好友。
- 不上传成绩、时长或任何个人数据。
- 不预载未注册的游戏，不缓存第三方域名。
- 不引入自动更新提示弹窗；版本更新后重新预载即可。

## 2. 游玩统计

### 2.1 计时语义

只有同时满足下列条件的时间才计入：

1. 页面可见（`document.visibilityState === 'visible'`）；
2. 开始/暂停/结算弹层已关闭（`createOverlayUi` 的 `hide()` 之后）；
3. 游戏页已初始化且能识别当前游戏（路径匹配 `games/<file>`）。

因此以下时间**不计入**：

- 停在开始界面、暂停弹层、结算弹层；
- 切到后台、锁屏、最小化；
- 浏览器失焦触发的自动暂停（页面隐藏路径）；
- 中心页浏览与已结束游戏的停留时间。

计时以 `performance.now()` 计算单调时间，关闭时间片时累加到内存；每 15 秒、暂停、结算、页面隐藏、`pagehide` 时写入 localStorage。每次写入即 `closeSegment()` 后累计，避免重复计时。

**轮次**：每款游戏调用 `Arcade.Progress.recordPlay(gameId, score)` 时，额外写入一条轮次记录。`Progress.recordPlay` 的原有行为、返回值和 `progress:v1` Schema 不变。未正常结算的局不产生轮次明细，但其有效游玩时间会计入总时长。

### 2.2 存储模型

新 key：`studiokit:arcade:playtime:v1`，独立 Schema v1，既有 `progress:v1` / `runs:v1` / `prefs:v1` 均不变。

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-11-11T05:00:00.000Z",
  "games": {
    "snake-run": {
      "ms": 123456,
      "count": 3,
      "lastAt": "2026-11-11T04:59:00.000Z",
      "days": { "2026-11-11": 90000, "2026-11-10": 33456 },
      "rounds": [
        { "at": "2026-11-11T04:59:00.000Z", "ms": 42000, "score": 120, "newHigh": true }
      ]
    }
  }
}
```

- `ms`：该游戏累计有效游玩时长（含未完成轮次）。
- `count`：该游戏累计完成轮次（可能大于 `rounds.length`）。
- `days`：按本地自然日汇总，最多保留 120 天；更早数据只保留在 `ms` 总量中。
- `rounds`：最近 30 轮，新的在前；每轮 `at` / `ms` / `score` / `newHigh`。
- 读取时做白名单校验（游戏 ID、日期格式、数值范围、轮次上限）；损坏条目丢弃，不阻塞页面。
- 单游戏清除与「清除全部」同时清除对应时长与轮次；「今日/近 7 天」由每款游戏的 `days` 重新求和，不会因单游戏清除而残留。

### 2.3 汇总与展示

中心页新增「游玩统计」区块：

- 汇总卡：累计时长、今日、近 7 天（含今天）、完成轮次。
- 近 7 天柱状图：按本地自然日；无数据日显示占位。
- 分游戏列表：按累计时长降序，显示时长、完成轮次、最近游玩相对时间。
- 每款游戏可展开最近轮次：日期时间、单轮用时、得分、新纪录标记；超过 30 轮时提示仅显示最近 30 轮。
- 计时口径在区块标题下方明确说明，避免把暂停时间误认为游玩时间。

导出备份新增可选字段 `playtime`；导入时若存在则恢复，缺失时保留当前统计。导入任何一步失败都会回滚 `progress` / `runs` / `playtime` 三个 key。

## 3. 分享

- 中心页「分享给朋友」：分享 `apps/arcade/` 合集链接。
- 游戏开始/暂停/结算弹层内「分享给朋友」：分享 `apps/arcade/games/<file>` 深链。
- 统一走 `Arcade.Share.open(payload)`：
  1. 有 `navigator.share` 时调用系统分享；
  2. 用户取消（`AbortError` / `NotAllowedError`）不视为失败，不弹错误；
  3. 不支持或非取消失败时，复制「推荐文案 + URL」到剪贴板；
  4. 剪贴板也不可用时提示手动复制地址栏。
- 分享内容只包含标题、推荐文案、公开 URL；不读取最高分、时长或存储数据。
- URL 由 `engine.js` 自身脚本 URL 推导（`ARCADE_BASE`），兼容 GitHub Pages `/studiokit/` 子路径与任意深度游戏页。

## 4. PWA 与离线预载

### 4.1 文件

- `manifest.webmanifest`：`id` / `start_url` / `scope` 均为相对当前目录的 `./`；`display: standalone`；`orientation: portrait`；192/512/maskable 图标与 Apple Touch 图标。
- `sw.js`：作用域 `apps/arcade/`，同时缓存页面引用的 `shared/site.css`、`shared/site-shell.js`。
- `icons/*.png`：预渲染 PNG，无外部字体或图片依赖。

### 4.2 缓存策略

- **安装**：`skipWaiting` + 预缓存中心页外壳（`./`、`index.html`、`engine.js`、`arcade.css`、manifest、4 个图标、共享 CSS/JS）。单个资源失败不阻断安装。
- **激活**：删除同前缀的旧版本缓存，`clients.claim()` 让当前页立即可用。
- **导航请求**：网络优先；成功时顺手更新缓存；离线时按请求 URL 匹配缓存，中心页回退 `index.html`，未预载的游戏页返回内联离线提示（不伪造游戏内容）。
- **静态资源**：缓存优先；未命中时联网并写入缓存；跨域请求不拦截。
- **显式预载**：中心页把 `preloadUrls()` 发给 active Service Worker；SW 逐项 `fetch` + `cache.put`，通过 `MessageChannel` 回传 `done/total/failed/bytes`；页面显示进度条与按钮文案。预载列表 = 11 个外壳资源 + 13 款游戏页。
- **状态检查**：页面用 `caches.match(url, {ignoreSearch: true})` 统计核心与游戏缓存命中数；不依赖 SW 自定义状态，刷新/重进仍准确。
- **更新**：`CACHE_NAME` 带应用版本；新 SW 激活后旧缓存清理，用户需要重新预载 13 款游戏。缓存名与 `sw.js` 的 `VERSION` 必须随应用版本同步。

### 4.3 兼容与降级

- `file://`、Service Worker 不可用或非安全上下文：`Arcade.Offline.supported === false`，隐藏/禁用预载入口，在线（本机文件）游玩不受影响。
- iOS Safari：无 `beforeinstallprompt`，安装按钮改为「分享 → 添加到主屏幕」说明；不承诺原生全屏。
- 预载失败/部分失败：保留已成功项，按钮显示「继续预载」，可重试补全。
- 离线打开未预载页面：显示提示页与返回中心页链接，不返回空白或错误 JSON。

## 5. 兼容、回滚与验收

**兼容**

- 旧版本没有 `playtime:v1`：统计为空，所有游戏与既有进度正常。
- 旧备份没有 `runs` / `playtime`：导入保留当前对应数据。
- 13 款游戏页面无需改动即可获得计时（共享 `createOverlayUi` 与 `Progress.recordPlay` 钩子）；游戏内分享按钮由引擎注入到既有弹层。
- 不改变 `progress` / `runs` / `prefs` 的 key、Schema 或字段语义。

**回滚**

1. 删除中心页统计区块与 `Playtime` 初始化，可停止写入；`playtime:v1` 留在本机不影响旧代码。
2. 删除 `manifest` link、`sw.js` 注册代码与「安装/预载」UI；浏览器下次访问会自然淘汰 SW，必要时在 DevTools 注销。
3. 恢复 `ARCADE_VERSION`、注册表版本、README/CHANGELOG 与 `validate_site.py` 断言。
4. 旧版本会忽略 `playtime` 备份字段；如需完全恢复旧备份，删除该字段即可。

**验收**

- `validate_site.py` / `build_site.py` / `node --check` 通过。
- `arcade_smoke.mjs` 覆盖：计时、暂停排除、轮次写入、汇总与展开、导出/导入/旧备份兼容、单游戏清除、分享深链与复制兜底、manifest/图标、SW 注册、预载 24 项、断网中心页与已预载游戏、未预载提示。
- 320 / 375 / 390 / 430px 中心页与 14 个页面无横向溢出；新增按钮/统计卡片不挤压标题。
- 未执行 iOS/Android 真机安装与系统分享面板，保留为 UNVERIFIED。
