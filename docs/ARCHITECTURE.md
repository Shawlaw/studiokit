# Architecture

## 目标

StudioKit 将多个轻量单页 HTML 工具集中到一个 GitHub Pages 站点，同时保留工具级独立性。它不是把所有页面重构为同一个 SPA。

## 结构边界

- `index.html`：门户入口，不包含工具业务逻辑。
- `shared/tool-registry.json`：工具卡片与路由注册表，门户的唯一数据源。
- `shared/home.js`：读取注册表并渲染首页卡片。
- `shared/site.css`：门户样式和带 `studiokit-` 前缀的共享导航样式。
- `shared/site-shell.js`：仅为工具页注入返回门户的导航条；从自身脚本 URL 推导站点根，兼容任意深度的子页面。
- `apps/<id>/index.html`：独立工具页面，工具自己的 CSS/JS/状态留在应用内。
- `apps/arcade/`：街机厅例外，一个工具内含中心页 + 多款游戏页：
  - `index.html`：中心页（搜索/筛选/续玩/进度管理）。
  - `engine.js`：街机专用共享运行时（循环、物理、输入、音效、局内档、全屏/沉浸），只被 Arcade 页面引用。
  - `arcade.css`：街机专用样式（舞台、道具条、沉浸布局）。
  - `games/*.html`：13 款互相独立的游戏页；一个游戏出错不影响其他游戏。
- `templates/single-page-tool/`：新增工具的标准起点。
- `tools/build_site.py`：把公开站点白名单复制到 `dist/`；Agent 文档、任务队列、Prompt 和开发脚本不发布。

## 为什么暂不引入 Vite / React / Vue

目前工具均为可独立运行的 HTML，体量小且无 npm 依赖。引入构建系统会增加安装、锁文件、升级和 Agent 排障成本，而没有明确收益。若未来出现模块复用、测试复杂度或资源管理需求，再以 ADR 讨论是否升级。

## 路径策略

GitHub Pages 项目站点会部署在 `/<repository>/` 子路径下。所有站内链接使用相对路径：

- 门户 → 工具：`./apps/<id>/`
- 工具 → 共享资源：`../../shared/...`
- 工具 → 门户：`../../index.html`
- 工具子页面（如 `apps/arcade/games/gold-miner.html`）→ 共享资源：`../../../shared/...`

禁止在工具资源引用中默认使用 `/shared/...` 这类域名根路径。共享 shell 会根据脚本自身 URL 计算门户地址，而不是写死层级。

## 运行时边界

- 共享层只提供门户、导航和稳定样式；不把任一工具的业务运行时提升为全站共享层。
- `apps/arcade/engine.js` 是 Arcade 内部共享运行时，负责固定步长循环、物理辅助、粒子和音效合成、局内存档、暂停/续玩 UI，以及全屏/沉浸模式。
- Arcade 画布逻辑分辨率固定 420×740，由 CSS 等比缩放；全屏时按可用视口和 `safe-area-inset-*` 重排，不改变逻辑坐标。
- 全屏优先使用原生 Fullscreen API；不支持或被拒绝时使用 CSS 沉浸布局，不伪造全屏成功。

## 状态与存储

- 工具间不共享 localStorage key、IndexedDB 数据库或业务对象。
- 新工具 key 格式：`studiokit:<tool-id>:<purpose>:v<version>`。
- 现有 Badge Studio key `concentric_badge_editor_autosave_v2` 为历史兼容标识，不要擅自改名。
- Arcade 使用独立命名空间：
  - `studiokit:arcade:progress:v1`（最高分/游玩记录）
  - `studiokit:arcade:runs:v1`（局内档，Schema v1）
  - `studiokit:arcade:prefs:v1`（静音、全屏偏好）
- 每个工具的配置 Schema 与应用版本独立演进；Arcade 0.4.0 的道具状态是既有局内档 Schema v1 内的追加字段，不是新 key。

## 部署

GitHub Actions 执行：静态验证 → 构建 `dist/` → 上传 Pages artifact → 部署 Pages。只部署 `main` 分支；Pull Request 仅执行验证和构建，不发布。当前线上地址：<https://shawlaw.github.io/studiokit/>。
