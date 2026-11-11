# StudioKit

**StudioKit** 是一个面向个人使用的静态网页工具集合。一个 GitHub 仓库承载多个彼此独立的单页 HTML 工具，通过统一首页、轻量共享外壳和 GitHub Pages 发布。

- **线上站点：** <https://shawlaw.github.io/studiokit/>
- **当前工具：** Badge Studio `2.2.1`；街机厅 Arcade `0.6.1`（13 款竖屏小游戏；本地热修，待验收发布）
- **计划中的工具：** Rounded Image（尚未实现，等待原始需求/规格）
- **最近发布：** 2026-11-12，Arcade 0.6.0（星海 Boss/叠加/全屏移动、矿工瞄准线、显式全屏）；0.6.1 热修已在本地通过 66 项检查，未提交/未推送
- **运行方式：** 纯静态文件；无后端、无账号、无构建依赖、无第三方 CDN

## 目录结构

```text
StudioKit/
├── index.html                       # StudioKit 门户首页
├── shared/
│   ├── site.css                     # 门户 + 工具顶部导航样式
│   ├── site-shell.js                # 工具页统一返回 StudioKit 导航
│   └── tool-registry.json           # 首页工具注册表（新增工具只需登记一次）
├── apps/
│   ├── badge-studio/                # 徽章工作台，当前 v2.2.1
│   │   ├── index.html
│   │   ├── README.md
│   │   └── CHANGELOG.md
│   └── arcade/                      # 街机厅，本地 v0.6.1（线上 0.6.0）
│       ├── index.html               # 游戏中心页（统计/分享/安装/预载）
│       ├── engine.js                # 街机专用共享运行时
│       ├── arcade.css               # 街机专用样式
│       ├── sw.js                    # Service Worker 离线缓存
│       ├── manifest.webmanifest     # PWA 清单
│       ├── icons/*.png              # PWA / Apple Touch 图标
│       ├── games/*.html             # 13 款独立游戏页
│       ├── DESIGN-0.4.0.md          # 全屏/道具设计与回滚说明
│       ├── DESIGN-0.5.0.md          # 统计/分享/PWA/离线设计与回滚说明
│       ├── DESIGN-0.6.0.md          # 星海 Boss/叠加、矿工瞄准线与全屏说明
│       ├── README.md
│       └── CHANGELOG.md
├── templates/single-page-tool/      # 新工具模板
├── tools/
│   ├── new_tool.py                  # 新建工具脚手架
│   ├── validate_site.py             # 静态结构/本地资源/注册表检查
│   ├── build_site.py                # 生成仅含网站文件的 dist/
│   ├── arcade_smoke.mjs             # 街机无头浏览器冒烟测试
│   └── agentctl.py                  # 轻量任务队列命令
├── tasks/queue.json                 # 机器可读任务队列
├── prompts/                         # 历史首次启动/首次发布 Prompt
├── docs/                             # 架构、路线、基线、发布与决策文档
└── .github/workflows/pages.yml      # GitHub Actions 自动部署 Pages
```

先看 [`START-HERE.md`](START-HERE.md) 了解当前状态与 Agent 协作方式。

## 本地预览

建议使用本地 HTTP 服务（门户首页通过 `fetch()` 读取工具注册表，直接双击 `index.html` 会受到浏览器 `file://` 限制）：

```powershell
py -3 -m http.server 8000
```

Linux / macOS 使用 `python3 -m http.server 8000`。浏览器访问：

- 门户：`http://localhost:8000/`
- Badge Studio：`http://localhost:8000/apps/badge-studio/`
- 街机厅：`http://localhost:8000/apps/arcade/`

Arcade 的游戏清单内联在 `apps/arcade/engine.js` 中，子游戏页也支持 `file://` 直接打开；但共享门户的注册表读取仍建议走 HTTP。

## 新增一个单页 HTML 工具

推荐使用脚手架：

```powershell
py -3 tools/new_tool.py --id rounded-image --name "Rounded Image" --description "图片圆角处理与导出" --icon "▧"
```

脚手架会：

1. 从 `templates/single-page-tool/` 创建 `apps/<id>/`。
2. 替换页面标题、工具 ID 和说明。
3. 在 `shared/tool-registry.json` 注册为 `draft`，首页展示但暂不可打开。

随后把已有 HTML 放入 `apps/<id>/index.html`，保留或补齐共享外壳引用：

```html
<link rel="stylesheet" href="../../shared/site.css" />
<script src="../../shared/site-shell.js" defer></script>
```

并在 `<body>` 设置：

```html
<body data-studiokit-app="rounded-image" data-studiokit-app-title="Rounded Image">
```

如果工具包含多级子页面（参考 `apps/arcade/games/`），相对路径要按实际深度调整（例如 `../../../shared/...`）；`site-shell.js` 会从自身脚本 URL 推导站点根，因此任意深度都能返回门户。

完成验收后，将注册表中的 `status` 改为 `available`。详细步骤见 [`docs/ADD-A-TOOL.md`](docs/ADD-A-TOOL.md)。

## 验证与构建

不需要 `npm install`。Windows 下如果 `python` 指向 2.x，统一使用 `py -3`；CI 使用 Python 3.12。

```powershell
py -3 tools/validate_site.py
py -3 tools/build_site.py
```

可选 JavaScript 语法检查（需要 Node.js）：

```powershell
node --check shared/home.js
node --check shared/site-shell.js
node --check apps/arcade/engine.js
node --check apps/arcade/sw.js
node tools/arcade_smoke.mjs
```

`arcade_smoke.mjs` 需要本机 Chrome，会启动临时静态服务器与无头浏览器；当前覆盖 66 项检查（显式全屏、道具/瞄准线/摆动能量、星海 Boss/弹种叠加/全屏移动、存档、游玩计时与轮次、分享、PWA 安装清单、离线预载/断网、320–430px 布局、子路径和刘海安全区）。

构建产物位于 `dist/`。它只包含要发布的网站资源，不包含 Agent Prompt、任务队列、内部文档和开发脚本。

## GitHub Pages 发布

站点已上线：<https://shawlaw.github.io/studiokit/>。

1. 推送到 `main` 后，`.github/workflows/pages.yml` 会执行校验、构建并部署到 GitHub Pages。
2. 在 Actions 中确认 `Validate and build` 与 `Deploy StudioKit` 均成功。
3. 打开 Pages URL，验证门户卡片、Badge Studio 和街机厅实际可访问。
4. 首次建仓、Pages Source 设置和完整发布边界见 [`docs/RELEASE-RUNBOOK.md`](docs/RELEASE-RUNBOOK.md)。

项目站点 URL 形如：

```text
https://<github-user>.github.io/<repository-name>/
```

所有页面内的本地资源引用均使用相对路径，支持项目站点的仓库前缀。

**发布边界：** Agent 可以在授权范围内完成代码、测试、构建、提交和发布准备。推送到 `main` 或触发公开部署前，必须确认目标仓库、仓库可见性和 Owner 授权。具体流程见 [`docs/RELEASE-RUNBOOK.md`](docs/RELEASE-RUNBOOK.md)。

## 设计原则

- 每个工具是独立 HTML 页面；不把业务逻辑强行合并成一个 SPA。
- 默认纯前端、本地处理；除非 Owner 明确要求，不接入后端、埋点、远程字体、CDN 或第三方分析。
- 各工具独立版本号、配置 Schema 和本地存储命名空间。
- 共享层只负责门户、导航和稳定的通用样式；不要为了抽象而抽象。
- 原工具的配置格式、导入导出行为和用户本地数据必须优先兼容。
- GitHub Pages 只托管静态文件；不会替工具保存编辑数据。

## 当前状态

- 线上已发布：Badge Studio `2.2.1`、街机厅 Arcade `0.6.0`。
- 本地待发布：街机厅 Arcade `0.6.1`（星海 30 秒关卡 Boss/弹种叠加/全屏移动、Boss 入场碰撞修复、黄金矿工瞄准线与摆幅修复、点开始不再自动全屏），已通过 66 项无头浏览器检查。
- 规划中：Rounded Image（等待原始需求/规格，不凭空复刻）。
- 任务、证据和未决项见 [`TASKS.md`](TASKS.md)；后续方向见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。
- Arcade 的玩法、数据键和已知边界见 [`apps/arcade/README.md`](apps/arcade/README.md)。
