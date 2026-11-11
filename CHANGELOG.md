# Changelog

StudioKit 门户本身没有独立的 semver；以下按仓库里程碑与工具版本记录。各工具的详细变更见 `apps/<tool>/CHANGELOG.md`。

## Arcade 0.5.0 — 2026-11-11

### Added
- 游玩统计：中心页累计/今日/近 7 天时长、完成轮次、7 日柱状图、分游戏时长与最近 30 轮明细；只统计真实游玩时间（暂停/切后台/开始界面不计）。
- `studiokit:arcade:playtime:v1`（Schema v1）；导出/导入备份新增可选 `playtime`，旧备份兼容。
- 分享：中心页合集链接 + 游戏弹层单游戏深链；系统分享优先，剪贴板兜底。
- PWA：`manifest.webmanifest`、`sw.js`、192/512/maskable/Apple Touch 图标；中心页可安装到桌面。
- 离线预载：显式缓存中心页外壳 + 13 款游戏，显示进度；断网可开已预载内容，未预载页显示提示。
- `apps/arcade/DESIGN-0.5.0.md`：统计、分享、缓存策略、兼容与回滚说明。

### Changed
- `ARCADE_VERSION`、注册表、README/CHANGELOG 同步到 0.5.0；既有 progress/runs/prefs key 与 Schema 不变。
- 单游戏清除/全部清除同步清理游玩统计；导入失败回滚 progress/runs/playtime 三个 key。

### Fixed
- 黄金矿工：连续使用「指哪打哪」锁定正下方物品后，摆角被设为 0、角速度清零，收钩回到摆动状态会停在垂直平衡位不再左右摆动。现在瞄准时保留同侧最小角速度，收钩和旧档恢复时也会补起步能量。

### Verification
- `validate_site.py` / `build_site.py` / `node --check` 通过。
- `arcade_smoke.mjs` 63/63：计时与暂停排除、轮次明细、汇总展开、备份兼容、分享兜底、manifest/SW、预载 24 项、停服务器后的中心页/游戏离线打开与未预载提示、矿工连续瞄准三次后恢复摆动。
- 线上运行时验证：13 卡 / PWA 可安装（installability 0 错误）/ SW scope `/studiokit/apps/arcade/` / 预载 24-24 / 矿工连续三轮瞄准后摆角变化 0.4+ / 零 JS 错误。

### Release
- 功能提交 `b8abe41`、摆钩修复 `c8c049d` fast-forward 合入 `main`。
- Actions `42974993445` validate + build + deploy 成功。
- 线上 <https://shawlaw.github.io/studiokit/apps/arcade/> 验证 0.5.0；iOS/Android 真机安装、系统分享面板与原生全屏仍 UNVERIFIED。

## Arcade 0.4.0 — 2026-11-10

### Added
- 13 款游戏共享全屏/沉浸模式：顶栏 `⛶`、开始/暂停弹层入口、键盘 `F`；支持 Fullscreen API 时请求原生全屏并尝试锁定竖屏，不支持或被拒绝时退化为 CSS 沉浸布局（iPhone Safari 走此路径）。
- 全屏偏好记忆：`studiokit:arcade:prefs:v1` 新增 `immersive`，下次从开始/继续弹层进入时自动恢复；主动退出后不再强制。
- 黄金矿工限量道具：🎯 指哪打哪、⏳ 加时 10 秒、💪 强力绞盘；触屏按钮与快捷键 `1 / 2 / 3`，通关按关补给、设上限。
- `apps/arcade/DESIGN-0.4.0.md`：全屏/道具设计、数值、兼容、验收和回滚说明。

### Changed
- 黄金矿工首关摆速由 520 降到 300，随后 380 / 470 / 580 / 700，无尽关 +80/关、上限 1300。
- 道具状态写入既有局内档 Schema v1（`data.tools` / `data.winchArmed`）；旧档缺字段时按初始补给恢复，物品坐标会被抬到道具条上方。
- 手机顶栏为全屏按钮腾位：≤460px 隐藏 DOM HUD、返回链接收成箭头、压缩间距；画布内 HUD 保留，最高分在中心页/结算查看。

### Fixed
- 道具条按实际高度动态计算物品下限，320px 小屏、全屏切换、地址栏收放和旧档恢复都不会把物品压在道具条后面。
- 达标提示按钮从固定视口底边移到画布内、道具条上方；钩爪不再伸到道具条后面。
- 旋转/全屏切换后画布尺寸延迟重算；指针状态增加 `seen` 字段，供瞄准预览使用。

### Release
- 提交 `49bc1aa`（功能）、`1b9ce14`（任务归档）fast-forward 合入 `main`。
- GitHub Actions `42846474565`、`42848635797` 均 validate + build + deploy 成功。
- 线上 <https://shawlaw.github.io/studiokit/apps/arcade/> 验证 0.4.0 / 13 卡 / 全屏与道具可用；`arcade_smoke.mjs` 57/57。

### Docs
- 根目录 README、START-HERE、ARCHITECTURE、ROADMAP、BASELINE、RELEASE-RUNBOOK、DECISIONS、CONTRIBUTING 与 AGENTS 项目事实同步到当前 0.4.0 状态。

## Arcade 0.3.2 — 2026-11-09

### Fixed
- 黄金矿工：夹中的物品只跟随钩爪绘制，原位置不再重复显示。
- 记忆翻牌：改为 6 关由少到多（6→24 张），预览时间 3.2→1.8 秒平滑递减。

### Release
- `tools/arcade_smoke.mjs` 扩至 51 项；提交 `2df2dbd` 经 fast-forward 合入 `main` 并发布。

## Arcade 0.3.1 — 2026-11-09

### Changed
- 按游戏性评审完成公平性、移动端输入和生命周期打磨：多指隔离、pointercancel/失焦清理、44px 暂停按钮、safe-area、移除全页 `user-scalable=no`。
- 雪铃去重、影跃可达平台、星海波次上限、赛车安全走廊、层塔落点投影、黄金矿工前 5 关独立配置。
- `tools/arcade_smoke.mjs` 扩至 49 项。

### Release
- 独立 Reviewer A/B/C/D 复核无 Blocker/Major；`793a6fd` fast-forward 合入 `main`，Actions `42565028915` 成功。

## Arcade 0.3.0 — 2026-11-09

### Added
- 街机厅扩至 13 款竖屏游戏，新增记忆翻牌、2048、砖块计划、重力翻转、贪吃蛇、打地鼠。
- 局内进度自动保存与「继续上次」；中心页搜索、类型筛选、只看玩过、排序、续玩区和 JSON 导出/导入。
- 共享运行时新增 `RunSave`、`createRunAutosave`、`createOverlayUi`、`bindPause`、`showResumePrompt`。

### Release
- 版本 0.3.0 发布；提交 `aba11a9`，Actions `42501786872` 成功。

## Arcade 0.2.0 — 2026-11-08

### Added
- 俄罗斯方块、极速车道、黄金矿工三款 GBA 风格复刻，街机厅扩至 7 款。
- 全部游戏支持键盘 + 触摸双输入；俄罗斯方块触屏按钮面板、车道变道按钮。

## 0.1.0 — 2026-10-31

### Added
- 建立 StudioKit 静态多工具 Monorepo。
- 增加统一门户、工具注册表和工具页共享导航。
- 纳入 Badge Studio v2.2.0；发布前默认示例改为中性内容并升到 v2.2.1。
- 增加单页工具模板、新工具脚手架、站点校验与静态构建脚本。
- 增加 GitHub Pages Actions 部署流程与 Flash Agent 工作约定。

### Fixed
- 共享导航条注入后把实测高度写入 `--studiokit-shellbar-h` CSS 变量；Badge Studio 桌面端视口高度计算扣除该变量，消除 38px 垂直溢出。
- 工具注册表 planned 项版本号改为空字符串，避免门户卡片渲染出 "v—" 徽标。

### Notes
- Rounded Image 仅列入规划，当前版本不包含该工具实现。
