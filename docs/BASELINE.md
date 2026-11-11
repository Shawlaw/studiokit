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

- App version: `0.5.0`（`apps/arcade/engine.js` 的 `ARCADE_VERSION` 与注册表保持一致；本地待发布，线上仍为 0.4.0）
- Registry entry: `shared/tool-registry.json` → `id: "arcade"`，`href: "./apps/arcade/"`
- Games: 13（清单唯一来源是 `engine.js` 顶部的 `GAMES` 数组）
- Run state schema: `v1`（`studiokit:arcade:runs:v1`）
- Progress schema: `v1`（`studiokit:arcade:progress:v1`）
- Playtime schema: `v1`（`studiokit:arcade:playtime:v1`；0.5.0 新增，独立 key）
- Preferences key: `studiokit:arcade:prefs:v1`；字段 `muted`、`immersive`
- 0.4.0 的黄金矿工道具状态是局内档 `data` 的追加字段（`tools` / `winchArmed`），不新增 localStorage key，不改变 Schema 版本
- 0.5.0 的游玩统计按游戏保存总时长、完成轮次、最近 30 轮与最近 120 天日汇总；备份新增可选 `playtime` 字段，旧备份兼容
- 全屏/沉浸模式：原生 Fullscreen API 优先，不支持时使用 CSS 沉浸；iPhone Safari 不支持网页元素全屏，**真机与原生全屏仍未验证**
- PWA/离线：manifest + `apps/arcade/sw.js`，作用域 `apps/arcade/`；显式预载 24 项（11 外壳 + 13 游戏），断网回归已自动化；**iOS/Android 真机安装与系统分享面板仍未验证**
- Automated coverage: `node tools/arcade_smoke.mjs` 63/63（需要本机 Chrome）
- Design/rollback reference: `apps/arcade/DESIGN-0.4.0.md`、`apps/arcade/DESIGN-0.5.0.md`
- Arcade README/CHANGELOG: `apps/arcade/README.md`、`apps/arcade/CHANGELOG.md`

变更 Arcade 版本、GAMES 数量、存储 key、Schema 或玩法基线时，必须同步更新本文件、注册表、Arcade README/CHANGELOG 与相关测试。
