# StudioKit

**StudioKit** 是一个面向个人使用的静态网页工具集合。一个 GitHub 仓库承载多个彼此独立的单页 HTML 工具，通过统一首页、轻量共享外壳和 GitHub Pages 发布。

- **当前站点版本：** `0.1.0`
- **首个工具：** Badge Studio `2.2.1`
- **计划中的工具：** Rounded Image（尚未实现，等待原始需求/规格）
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
│   └── badge-studio/
│       ├── index.html               # Badge Studio（自 v2.2.0 导入，当前 v2.2.1），保留独立运行
│       ├── README.md
│       └── CHANGELOG.md
├── templates/single-page-tool/      # 新工具模板
├── tools/
│   ├── new_tool.py                  # 新建工具脚手架
│   ├── validate_site.py             # 静态结构/本地资源/注册表检查
│   ├── build_site.py                # 生成仅含网站文件的 dist/
│   └── agentctl.py                  # 轻量任务队列命令
├── tasks/queue.json                 # 机器可读任务队列
├── prompts/                         # Flash Agent 启动与新增工具 Prompt
├── docs/                             # 架构、接入、发布与决策文档
└── .github/workflows/pages.yml      # GitHub Actions 自动部署 Pages
```

先看 [`START-HERE.md`](START-HERE.md) 完成 Owner / Agent 首次启动。

## 本地预览

建议使用本地 HTTP 服务（门户首页通过 `fetch()` 读取工具注册表，直接双击 `index.html` 会受到浏览器 `file://` 限制）：

```powershell
python -m http.server 8000
```

浏览器访问：

- 门户：`http://localhost:8000/`
- Badge Studio：`http://localhost:8000/apps/badge-studio/`

Badge Studio 本身仍然是一个独立 HTML 文件；它的编辑、配置、预览和导出逻辑没有迁移到共享运行时。

## 新增一个单页 HTML 工具

推荐使用脚手架：

```powershell
python tools/new_tool.py --id rounded-image --name "Rounded Image" --description "图片圆角处理与导出" --icon "▧"
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

完成验收后，将注册表中的 `status` 改为 `available`。详细步骤见 [`docs/ADD-A-TOOL.md`](docs/ADD-A-TOOL.md)。

## 验证与构建

不需要 `npm install`：

```powershell
python tools/validate_site.py
python tools/build_site.py
```

可选 JavaScript 语法检查（需要 Node.js）：

```powershell
node --check shared/home.js
node --check shared/site-shell.js
```

构建产物位于 `dist/`。它只包含要发布的网站资源，不包含 Agent Prompt、任务队列、内部文档和开发脚本。

## GitHub Pages 发布

1. 将本目录作为一个 Git 仓库推送到 GitHub。
2. 打开仓库 **Settings → Pages**。
3. 在 **Build and deployment → Source** 中选择 **GitHub Actions**。
4. 推送到 `main` 后，`.github/workflows/pages.yml` 会先执行校验和构建，再部署到 GitHub Pages。
5. 在 Actions 中确认 `Deploy StudioKit` 成功，再打开 GitHub Pages 给出的 URL。

可直接使用 [`prompts/FLASH-BOOTSTRAP.md`](prompts/FLASH-BOOTSTRAP.md) 启动 Agent；首次发布时填写 [`prompts/FLASH-FIRST-PUBLISH.md`](prompts/FLASH-FIRST-PUBLISH.md) 中的仓库信息和授权。

项目站点通常为：

```text
https://<github-user>.github.io/<repository-name>/
```

所有页面内的本地资源引用均使用相对路径，支持项目站点的仓库前缀。

**发布边界：** Agent 可以在授权范围内完成代码、测试、构建、提交和发布准备。首次推送到远程、合并到 `main` 或触发公开部署前，必须确认目标仓库、仓库可见性和 Owner 授权。具体流程见 [`docs/RELEASE-RUNBOOK.md`](docs/RELEASE-RUNBOOK.md)。

## 设计原则

- 每个工具是独立 HTML 页面；不把业务逻辑强行合并成一个 SPA。
- 默认纯前端、本地处理；除非 Owner 明确要求，不接入后端、埋点、远程字体、CDN 或第三方分析。
- 各工具独立版本号、配置 Schema 和本地存储命名空间。
- 共享层只负责门户、导航和稳定的通用样式；不要为了抽象而抽象。
- 原工具的配置格式、导入导出行为和用户本地数据必须优先兼容。
- GitHub Pages 只托管静态文件；不会替工具保存编辑数据。

## 当前状态

见 [`TASKS.md`](TASKS.md) 和 [`docs/ROADMAP.md`](docs/ROADMAP.md)。
