# Arcade 0.11.2 设计：PWA 更新检测 + iPhone 安装版顶部显示修复

## 背景 / Owner 反馈

1. **已安装 PWA 无法感知更新**：Owner 的 iPhone 主屏幕 PWA 中心页仍显示 `v0.10.0`，而线上已是 `0.11.1`。现有 Service Worker 虽然会 `skipWaiting` + `clients.claim`，但从不通知已打开的页面；页面也没有 `updatefound` / `controllerchange` 监听或「检查更新」入口，导致安装版长期停在旧版本（中心页外壳走 SW 缓存优先，导航网络优先只能更新 HTML，但缓存的 engine.js / arcade.css 仍是旧的）。
2. **iPhone 安装版顶部不对劲**：截图显示中心页顶部状态栏到 shell 导航条之间是一条灰白渐层，文字看起来「被模糊掉一半」；游戏页沉浸模式下顶栏文字与按钮也发虚。根因：
   - 共享 shellbar 默认浅色 `#f8f9fc`，而 Arcade 是深色主题 `#0b1020`；`apple-mobile-web-app-status-bar-style=black-translucent` 让页面延伸到半透明状态栏下方，47px 安全区被浅色填充后叠加出灰白渐层，浅色状态下状态栏文字对比度不足。
   - `.overlay { backdrop-filter: blur(2px) }` 在 iOS Safari 的合成层里会渗到相邻顶栏，使文字发虚。

## 目标与非目标

**目标**：安装版能主动发现并提示新版本；iPhone 安装版顶部与安全区显示清晰、与深色主题一致；不改变玩法、存档 key/Schema、积分/挑战数据。

**非目标**：不做强制更新、不自动刷新打断游玩、不新增远程依赖/分析/后端、不改 Badge Studio / Venue Compare 行为、不在本任务中发布（无 `PUBLISH_TO_MAIN` 授权）。

## 实现

### 1. Service Worker（`apps/arcade/sw.js`）

- `VERSION` 升至 `0.11.2`（缓存键 `studiokit-arcade-0.11.2-v1`），确保旧缓存随新 SW 激活被清理。
- `activate` 时调用 `notifyUpdateReady()`：`clients.matchAll({ type: 'window' })` 后向受控页面 `postMessage({ type: 'arcade-sw-update-ready', version })`。用 `firstActivation` 保护，首次安装（无既有客户端）不打扰用户，只有真正接管旧客户端才提示。
- 新增页面 → SW 消息：
  - `arcade-sw-version`：通过 `MessageChannel` 回传当前 SW `VERSION`，供诊断/测试握手。
  - `arcade-sw-skip-waiting`：让 waiting/installing 的 SW 立即激活（配合页面刷新完成升级）。

### 2. 引擎（`apps/arcade/engine.js`，`A.Offline`）

- `installUpdateWatching(registration)` 订阅三类信号并去重到 `updateState`：
  - `registration.updatefound` + installing `statechange === 'installed'`（且已有 controller）；
  - `navigator.serviceWorker.controllerchange`（仅当页面原本受控，排除首次安装）；
  - SW 主动消息 `arcade-sw-update-ready`（带版本号）。
- 新增导出：`checkForUpdate()`（主动 `registration.update()` 并返回结果）、`applyUpdate()`（触发 skipWaiting + update）、`onUpdate(fn)`（订阅，返回取消函数；订阅时若已有更新立即回调）、`swVersion()`（查询 SW 版本）。
- 注册仍由 `autoRegister()` 在所有 Arcade 页面自动完成；获取已有注册时补装事件监听，覆盖「旧 SW 已存在」的页面。

### 3. 中心页 UI（`apps/arcade/index.html`）

- 工具行新增「🔄 检查更新」按钮（仅在支持 SW 时显示）与更新横幅：
  - 发现新版本显示「发现新版本（x.y.z），刷新后生效。」+「立即刷新」+「稍后」；
  - 「立即刷新」先 `applyUpdate()` 再 `location.reload()`；
  - 「稍后」本次会话不再提示（内存标志，不写 localStorage）。
- 按钮点击结果用 `A.showToast` 反馈（已是最新 / 发现新版本 / 环境不支持）。
- 版本展示 `0.11.1 → 0.11.2`。

### 4. iPhone 顶部修复（`apps/arcade/arcade.css`）

- `body.arcade-body > .studiokit-shellbar`：Arcade 的 shell 导航条改为深色不透明背景 `#0b1020`、深色分隔线、金色首页链接与浅色文字，状态栏文字保持清晰（与 `theme-color: #0b1020` 一致）。
- `html.studiokit-shell-standalone body.arcade-body::before`：独立窗口时在 47px 顶部安全区铺一层纯深色固定背景，消除半透明状态栏与浅色导航条叠加的灰白渐层；不拦截点击。
- `body.arcade-body .game-topbar`：`position: relative; z-index: 5` 且背景不透明，避免被舞台模糊蒙层的合成层影响；沉浸模式沿用 `#05070f`。
- `.stage-box { isolation: isolate }`：把 `backdrop-filter: blur()` 限制在舞台内部；为 `.overlay` / `.ac-dialog::backdrop` 补 `-webkit-backdrop-filter` 前缀。0.11.1 结算默认模糊蒙层与回看透明切换的外观不变。

## 兼容性 / 数据

- **不改**任何 localStorage key 与 Schema（`progress` / `runs` / `prefs` / `playtime` / `challenge` / `scores` / `runs`）。
- 旧备份导入、导出、清除、禅模式、积分记录与挑战数据零变更。
- 普通标签页 shellbar 仍为 38px、顶部安全区不生效（Android 空白回归防护保持不变）。
- 安装版首次打开不会因「初次安装」误报更新；只有旧客户端被接管或版本变化时提示。

## 测试与证据

- 新增 `tools/arcade_pwa_update_test.mjs` **6/6**：检查更新按钮/横幅/API、`checkForUpdate`/`swVersion` 握手、模拟新版本通知横幅与「稍后」、独立窗口 + 安全区下深色 shellbar 与清晰顶栏、普通标签页不回归。
- 回归：`arcade_smoke.mjs` **94/94**、`arcade_zen_scores_test.mjs` **14/14**、`arcade_calm_games_test.mjs` **17/17**、`arcade_review_test.mjs` **5/5**、`arcade_gameplay_test.mjs --suite=base` **11/11**、`validate_site.py` / `build_site.py` / `check_inline_scripts.mjs` / 全部 `node --check` 通过。
- 真机 iOS 安装版顶部观感与系统更新提示时机仍需 Owner 实机确认（UNVERIFIED）；无头 Chrome 已用 `display-mode: standalone` + 47px 安全区模拟验证布局。

## 回滚

- 代码层：回退 `sw.js` / `engine.js` / `index.html` / `arcade.css` 的 0.11.2 改动，并把版本链恢复到 0.11.1；SW 缓存键随之恢复，旧版本用户刷新后自动清掉新缓存。
- 数据层：无 Schema/key 变更，无需数据迁移。
- 若 iPhone 顶部深色 shellbar 与个别主题冲突，只需移除 `body.arcade-body > .studiokit-shellbar` 与 `::before` 两段样式，其余更新检测逻辑独立可用。
