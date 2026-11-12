# Baseline

## Badge Studio

Current Badge Studio baseline facts:

- App version: `2.2.1`
- Config schema: `v3`
- Autosave key: `concentric_badge_editor_autosave_v2`
- Default scheme content is project-neutral (`STUDIOKIT` / `BADGE STUDIO` / `◎`); personal default samples must not appear in the repository or its history.
- The editor's drawing, configuration, autosave and export logic is intended to remain unchanged. Any future version upgrade must update this record and the app changelog deliberately.

## Arcade

Current Arcade baseline facts:

- App version: `0.7.0`（`apps/arcade/engine.js` 的 `ARCADE_VERSION` 与注册表保持一致；2026-11-13 已双端发布，提交 `34f03df`，Actions `43274342320`）
- Registry entry: `shared/tool-registry.json` → `id: "arcade"`，`href: "./apps/arcade/"`
- Games: 13（清单唯一来源是 `engine.js` 顶部的 `GAMES` 数组）
- Run state schema: `v1`（`studiokit:arcade:runs:v1`）
- Progress schema: `v1`（`studiokit:arcade:progress:v1`）
- Playtime schema: `v1`（`studiokit:arcade:playtime:v1`；0.5.0 新增，独立 key）
- Preferences key: `studiokit:arcade:prefs:v1`；字段 `muted`、`immersive`
- 0.4.0 的黄金矿工道具状态是局内档 `data` 的追加字段（`tools` / `winchArmed`），不新增 localStorage key，不改变 Schema 版本
- 0.5.0 的游玩统计按游戏保存总时长、完成轮次、最近 30 轮与最近 120 天日汇总；备份新增可选 `playtime` 字段，旧备份兼容
- 0.5.1 修复连续游玩超过 15 秒后计时停止：每次定时落盘后重新开启时间片；Service Worker 缓存版本同步升至 0.5.1
- 0.6.0 已发布：星海突击每 30 秒关卡后 Boss 战、弹种可叠加、玩家全屏纵向移动；黄金矿工摆角/钩爪朝向分离（瞄准不损耗摆动能量）与按秒 $2 瞄准线；移除点开始/继续自动全屏。局内档仍为 `runs:v1` Schema v1，新增字段只写在 `data` 内
- 0.6.1 已发布：Boss 入场穿过顶部时关闭机体碰撞与弹幕，避免贴顶玩家被撞；SW 缓存版本升至 0.6.1；提交 1c9501e，Actions 43060497094
- 0.6.2 已发布：黄金矿工目标金额统一取整（含旧小数档恢复），HUD 顶部深色渐隐与金色目标胶囊；俄罗斯方块触屏按钮改为左右手分区，`加速`按住逐格下落、`落底`点按立即锁定，画布不再劫持触摸；SW 缓存升至 0.6.2；提交 0159437，Actions 43155182519 双端发布
- 0.7.0 已发布：13 款游戏各增加 2 个主动可选道具（黄金矿工保留 4 个并重平衡），共享 `A.createToolbelt` 统一道具栏；新增自然收尾（2048/砖块 3 关/重力 3000m/贪吃蛇 20 果实/方块 40 行/星海 CLEAR/赛车 5000m）；新增每页面一次 20 分钟有效游玩提醒；中心页加 🎲 随机入口。没有签到、每日奖励、商店或付费抽奖。`runs:v1` 等 key 与 Schema 不变，新字段只写在各游戏 `data` 内
- 全屏/沉浸模式：原生 Fullscreen API 优先，不支持时使用 CSS 沉浸；iPhone Safari 不支持网页元素全屏，**真机与原生全屏仍未验证**
- PWA/离线：manifest + `apps/arcade/sw.js`，作用域 `apps/arcade/`；显式预载 24 项（11 外壳 + 13 游戏），断网回归已自动化；**iOS/Android 真机安装与系统分享面板仍未验证**
- Automated coverage: `node tools/arcade_smoke.mjs` 85/85（需要本机 Chrome；0.7.0 批次连续两次通过，2026-11-13）；线上双端 24/24 文件一致
- Design/rollback reference: `apps/arcade/DESIGN-0.4.0.md`、`apps/arcade/DESIGN-0.5.0.md`、`apps/arcade/DESIGN-0.6.0.md`、`apps/arcade/DESIGN-0.7.0.md`
- Arcade README/CHANGELOG: `apps/arcade/README.md`、`apps/arcade/CHANGELOG.md`

变更 Arcade 版本、GAMES 数量、存储 key、Schema 或玩法基线时，必须同步更新本文件、注册表、Arcade README/CHANGELOG 与相关测试。
