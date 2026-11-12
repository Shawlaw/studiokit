# StudioKit

**StudioKit** 是一个面向个人使用的静态网页工具集合。一个 GitHub 仓库承载多个彼此独立的单页 HTML 工具，通过统一首页、轻量共享外壳，同时发布到 GitHub Pages 与 Cloudflare Pages。

- **线上站点：** <https://shawlaw.github.io/studiokit/> · <https://studiokit.pages.dev/>
- **源码：** <https://github.com/Shawlaw/studiokit>（MIT 许可）
- **当前工具：** Badge Studio `2.2.1`；街机厅 Arcade `0.6.2`（13 款竖屏小游戏，本次发布）
- **计划中的工具：** Rounded Image（尚未实现，等待原始需求/规格）
- **最近发布：** 2026-11-12，Arcade 0.6.2（黄金矿工目标金额取整、俄罗斯方块左右手分区触屏按钮、加速/落底区分）
- **运行方式：** 纯静态文件；无后端、无账号、无构建依赖、无第三方 CDN

## 目录结构

```text
StudioKit/
├── index.html                       # StudioKit 门户首页
├── LICENSE                          # MIT 许可证
├── shared/
│   ├── site.css                     # 门户 + 工具顶部导航样式
│   ├── site-shell.js                # 工具页统一返回 StudioKit 导航
│   └── tool-registry.json           # 首页工具注册表（新增工具只需登记一次）
├── apps/
│   ├── badge-studio/                # 徽章工作台，当前 v2.2.1
│   │   ├── index.html
│   │   ├── README.md
│   │   └── CHANGELOG.md
│   └── arcade/                      # 街机厅，当前 v0.6.2
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
│   ├── verify_deploy.py             # 双端发布后的逐文件/版本校验
│   └── agentctl.py                  # 轻量任务队列命令
├── tasks/queue.json                 # 机器可读任务队列
├── prompts/                         # 历史首次启动/首次发布 Prompt
├── docs/                             # 架构、路线、基线、发布与决策文档
└── .github/workflows/deploy.yml     # GitHub Actions 双端自动部署
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

## 发布（GitHub Pages + Cloudflare Pages）

站点已上线：

- GitHub Pages：<https://shawlaw.github.io/studiokit/>
- Cloudflare Pages：<https://studiokit.pages.dev/>

1. 推送到 `main` 后，`.github/workflows/deploy.yml` 会执行一次校验/构建，把同一份 `dist/` 并行部署到 GitHub Pages 与 Cloudflare Pages。
2. Actions 中应有 `Validate and build`、`Deploy GitHub Pages`、`Deploy Cloudflare Pages`、`Verify both deployments` 四个 job 成功。
3. 发布后用 `py -3 tools/verify_deploy.py --base <Pages URL> --base <Cloudflare URL>` 复核：逐文件 SHA-256 一致，且 Arcade / Badge 版本与注册表一致。
4. Cloudflare 侧项目为 `studiokit`（Production branch `main`），Secrets 为 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`，Variable 为 `CF_PAGES_URL`。完整设置、半发布恢复与回滚见 [`docs/RELEASE-RUNBOOK.md`](docs/RELEASE-RUNBOOK.md)。

GitHub Pages 项目站点 URL 形如：

```text
https://<github-user>.github.io/<repository-name>/
```

Cloudflare Pages 部署在域名根路径（当前为 `studiokit.pages.dev`，以后可绑定自定义域名）。所有页面内的本地资源引用均使用相对路径，因此同一份 `dist/` 能同时适配子路径与根路径。

**发布边界：** Agent 可以在授权范围内完成代码、测试、构建、提交和发布准备。推送到 `main` 或触发公开部署前，必须确认目标仓库、仓库可见性和 Owner 授权；一次授权覆盖两个部署目标，不能只发一端就宣称完成。具体流程见 [`docs/RELEASE-RUNBOOK.md`](docs/RELEASE-RUNBOOK.md)。

## 设计原则

- 每个工具是独立 HTML 页面；不把业务逻辑强行合并成一个 SPA。
- 默认纯前端、本地处理；除非 Owner 明确要求，不接入后端、埋点、远程字体、CDN 或第三方分析。
- 各工具独立版本号、配置 Schema 和本地存储命名空间。
- 共享层只负责门户、导航和稳定的通用样式；不要为了抽象而抽象。
- 原工具的配置格式、导入导出行为和用户本地数据必须优先兼容。
- GitHub Pages / Cloudflare Pages 只托管静态文件；不会替工具保存编辑数据。

## 当前状态

- 本次发布：Badge Studio `2.2.1`、街机厅 Arcade `0.6.2`（黄金矿工目标金额取整与 HUD 可读性、俄罗斯方块左右手分区触屏按钮、加速/落底区分；含 0.6.1 Boss 入场碰撞修复）。
- Arcade 0.6.2 已通过 66 项本地无头浏览器检查，双端一致性验证在发布后执行。
- 规划中：Rounded Image（等待原始需求/规格，不凭空复刻）。
- 任务、证据和未决项见 [`TASKS.md`](TASKS.md)；后续方向见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。
- Arcade 的玩法、数据键和已知边界见 [`apps/arcade/README.md`](apps/arcade/README.md)。

## 许可

- 代码、文档与站点样式采用 [MIT 许可证](LICENSE)：可以自由使用、修改、分发和商用，只需保留版权与许可声明。
- 许可允许商业使用，包括在部署方自己的站点上展示广告；是否展示广告由部署方决定。
- 「StudioKit」名称、徽标与站点视觉标识不随 MIT 授权。基于本项目搭建的站点请使用自己的名称与标识，避免用户误认为官方版本。
- 街机厅各游戏为自研代码与自绘图形，未引入第三方素材；玩法规则本身通常不受版权保护，但若游戏名称与现有商业作品重名（例如「俄罗斯方块」「黄金矿工」），相关商标风险由使用与部署方自行评估。
- 变更授权需要全体版权人同意。目前版权人为单一作者，可直接替换根目录 `LICENSE`，并同步更新本文件、[`docs/DECISIONS.md`](docs/DECISIONS.md) 与 [`CHANGELOG.md`](CHANGELOG.md)。
