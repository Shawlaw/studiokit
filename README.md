# StudioKit

**轻量、离线优先的浏览器工具集合。** 一个静态仓库承载多个彼此独立的单页工具，共用一套门户与轻量外壳，同一份构建产物同时发布到 GitHub Pages 与 Cloudflare Pages。

[`● 已上线 3 个工具`](#工具一览) · [`⇅ 双端部署`](#发布流程) · [`◇ 零构建依赖`](#快速开始) · [`⌁ 离线优先`](#数据与隐私) · [`MIT 许可`](#许可证)

| | |
| --- | --- |
| 线上站点 | <https://shawlaw.github.io/studiokit/> · <https://studiokit.pages.dev/> |
| 源码 | <https://github.com/Shawlaw/studiokit> |
| 许可证 | [MIT](LICENSE)（「StudioKit」名称与视觉标识不随代码授权） |
| 技术形态 | 纯静态 HTML / CSS / JavaScript；无框架、无打包器、无 `npm install` |
| 数据 | 全部留在浏览器本地（`localStorage` / IndexedDB）；无后端、无账号、无埋点、无第三方 CDN |
| 发布 | 一次构建 → 两个托管目标；GitHub Actions 校验、部署并逐文件比对两端一致性 |

## 目录

- [工具一览](#工具一览)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [整体架构](#整体架构)
- [新增一个工具](#新增一个工具)
- [验证与构建](#验证与构建)
- [测试工具](#测试工具)
- [发布流程](#发布流程)
- [数据与隐私](#数据与隐私)
- [设计原则](#设计原则)
- [文档地图](#文档地图)
- [已知边界](#已知边界)
- [贡献](#贡献)
- [许可证](#许可证)

## 工具一览

以下三个工具均已双端发布、注册表状态为 `available`；Rounded Image 仅为规划项，**尚未实现**。

| 工具 | 版本 | 状态 | 入口 | 一句话说明 |
| --- | --- | --- | --- | --- |
| ◎ **Badge Studio** | `2.2.1` | `available` | [`apps/badge-studio/`](apps/badge-studio/) | 同心圆徽章工作台：弧形文字排版、多方案并排对比、透明 PNG / SVG 导出 |
| 🕹 **街机厅 Arcade** | `0.18.0` | `available` | [`apps/arcade/`](apps/arcade/) | 16 款竖屏小游戏（13 款带 6 关挑战 + 三款平和棋牌），支持全屏、暂停、本地续玩、分享与离线预载 |
| 🍽 **Venue Compare** | `0.2.0` | `available` | [`apps/restaurant-compare/`](apps/restaurant-compare/) | 餐厅考察对比：地图标注 + 横向对比表 + 外部链接备注，导出可转发的独立 HTML |
| ▧ **Rounded Image** | — | `planned` | — | 预留给图片圆角工具，原始规格待恢复或重新定义；**当前没有实现** |

工具卡片的唯一数据来源是 [`shared/tool-registry.json`](shared/tool-registry.json)（`schemaVersion: 1`），门户首页 [`index.html`](index.html) 通过 [`shared/home.js`](shared/home.js) 读取它渲染。注册表状态只有三种：`available`（可打开）、`draft`（开发中）、`planned`（规划中，不暴露 `href`）。

## 快速开始

零安装。项目本身不需要任何依赖；只是**必须用本地 HTTP 服务**打开门户，因为首页通过 `fetch()` 读取注册表，`file://` 下会被浏览器的同源策略拦住。

```powershell
# 仓库根目录；Windows 上若 python 指向 2.x 请统一用 py -3
py -3 -m http.server 8000
```

Linux / macOS 使用 `python3 -m http.server 8000`。随后访问：

- 门户：<http://localhost:8000/>
- Badge Studio：<http://localhost:8000/apps/badge-studio/>
- 街机厅：<http://localhost:8000/apps/arcade/>
- Venue Compare：<http://localhost:8000/apps/restaurant-compare/>

Arcade 的游戏清单内联在 `apps/arcade/engine.js` 中，子游戏页也支持双击 `file://` 直接打开；但 PWA 安装、Service Worker 与离线预载只在 HTTPS 或 `localhost` 下生效。

## 项目结构

```text
StudioKit/
├── index.html                   # 门户首页（读取注册表渲染工具卡片）
├── favicon.svg
├── LICENSE                      # MIT
├── shared/                      # 共享层：仅门户、导航与稳定样式
│   ├── site.css                 #   门户 + 工具页顶部导航样式
│   ├── home.js                  #   读取 tool-registry.json 渲染首页
│   ├── site-shell.js            #   向工具页注入返回门户的导航条
│   └── tool-registry.json       #   首页工具清单的唯一来源
├── apps/                        # 每个工具一个独立目录
│   ├── badge-studio/            #   index.html + README + CHANGELOG
│   ├── restaurant-compare/      #   index.html + README + CHANGELOG
│   └── arcade/                  # 中心页 + 16 个游戏页 + 引擎 + PWA + 逐版设计文档
├── templates/single-page-tool/  # 新工具脚手架模板
├── tools/                       # 校验、构建、部署核对与测试脚本（不发布）
├── tasks/queue.json             # 机器可读任务队列
├── docs/                        # 架构、ADR、基线、路线、发布手册、Arcade 设计档案
├── AGENTS.md                    # Agent 操作契约
├── START-HERE.md                # Owner / Agent 入口
├── TASKS.md                     # 人类可读任务与证据
├── CHANGELOG.md                 # 全站变更记录
├── CONTRIBUTING.md
└── .github/workflows/deploy.yml # 校验 → 构建 → 双端部署 → 两端核对
```

## 整体架构

StudioKit 是**静态多工具 Monorepo**，不是单一 SPA。核心边界如下（完整说明见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)）：

- **门户与工具解耦。** 门户只渲染卡片；每个工具是 `apps/<tool-id>/index.html` 下可独立加载的单页。
- **共享层保持最小。** `shared/` 只提供门户、`site-shell.js` 注入的返回导航和稳定样式；不把任何工具的业务运行时提升为全站共享。
- **工具内允许自有运行时。** `apps/arcade/engine.js` 是 Arcade 内部共享引擎（固定步长循环、物理辅助、粒子、WebAudio 音效合成、存档、暂停/续玩、全屏/沉浸、游玩计时、分享与离线封装），只被 Arcade 页面引用。
- **路径必须相对。** GitHub Pages 部署在 `/<repository>/` 子路径、Cloudflare Pages 部署在根路径，因此禁止 `/assets/...` 这类从域名根解析的绝对路径；`site-shell.js` 从自身脚本 URL 推导站点根，任意深度的子页面都能返回门户。
- **状态按工具隔离。** 工具之间不共享 `localStorage` key、IndexedDB 数据库或业务对象；每个工具独立演进版本号、配置 Schema 与存储命名空间。
- **构建按白名单。** [`tools/build_site.py`](tools/build_site.py) 只复制 `index.html`、`favicon.svg`、`shared/`、`apps/`，追加 `.nojekyll`；`docs/`、`tools/`、`tasks/`、根级 Markdown 与开发脚本都不会进入发布产物。注意 `apps/` 是按目录整体复制的，所以**各工具自己的 `README.md` / `CHANGELOG.md` / `DESIGN-*.md` 会随站点一起发布**。

## 新增一个工具

推荐用脚手架，它会创建目录、替换标题/ID/说明并在注册表登记为 `draft`：

```powershell
py -3 tools/new_tool.py --id rounded-image --name "Rounded Image" --description "图片圆角处理与导出" --icon "▧"
```

随后：

1. 把完整单页 HTML 放进 `apps/<id>/index.html`，保留共享外壳引用：

   ```html
   <link rel="stylesheet" href="../../shared/site.css" />
   <script src="../../shared/site-shell.js" defer></script>
   ```

2. 在 `<body>` 上声明工具标识，`site-shell.js` 依赖它才会注入导航：

   ```html
   <body data-studiokit-app="rounded-image" data-studiokit-app-title="Rounded Image">
   ```

3. 多级子页面按实际深度调整相对路径（如 `apps/arcade/games/x.html` 用 `../../../shared/...`），并同样设置 `data-studiokit-app`。
4. 补齐该工具自己的 `README.md` 与 `CHANGELOG.md`，完成验收后再把注册表状态从 `draft` 改成 `available`。

`id` 使用小写 kebab-case，同时决定 URL 与存储命名空间，发布后不要改名。完整规范与验收清单见 [`docs/ADD-A-TOOL.md`](docs/ADD-A-TOOL.md)。

## 验证与构建

不需要 `npm install`。CI 使用 Python 3.12 与 Node.js 22（Node 仅在需要 JavaScript 语法检查与无头浏览器测试时使用）。

```powershell
py -3 tools/validate_site.py      # 静态结构与内容校验
py -3 tools/build_site.py         # 先生成校验，再产出 dist/
```

`validate_site.py` 是主要的静态门禁，覆盖：必填文件存在性、注册表 Schema 与状态 / `href` 一致性、可用工具的入口页面存在、站内相对路径不越界且本地引用真实存在、禁止根绝对路径与外部运行时资源、CSS `url()` 不得从域名根解析、Badge Studio 版本与历史自动保存键未被擅改、Arcade 版本链（`engine.js` / `sw.js` / 注册表 / 中心页）与各项历史修复标记仍在、挑战数据不泄漏参考解、PWA 清单与图标齐全、`LICENSE` 与源码链接一致、模板占位符完整。

可选 JavaScript 检查：

```powershell
node --check shared/home.js
node --check shared/site-shell.js
node --check apps/arcade/engine.js
node --check apps/arcade/sw.js
node tools/check_inline_scripts.mjs   # 覆盖所有 HTML 内联脚本，node --check 看不到它们
```

改文档后可以顺手校验 README 集合的相对链接、章节锚点与表格列数：

```powershell
py -3 tools/check_readme_links.py
```

## 测试工具

无头浏览器测试需要本机 Chrome（可用 `CHROME_PATH` 覆盖路径），脚本会自行启动临时静态服务器与 Chrome，全部零 npm 依赖。**门禁项数以实际运行输出为准**，历史结果记录在 [`apps/arcade/CHANGELOG.md`](apps/arcade/CHANGELOG.md) 与 [`TASKS.md`](TASKS.md)，本文档不维护易漂移的计数。

| 脚本 | 覆盖范围 |
| --- | --- |
| [`tools/arcade_run_all_gates.py`](tools/arcade_run_all_gates.py) | Arcade 全部离线门禁串联执行，失败即停；日常最省事的入口 |
| [`tools/arcade_smoke.mjs`](tools/arcade_smoke.mjs) | 中心页 + 16 款游戏的全链路冒烟（道具真实效果、存档与计时、分享、PWA 清单、离线预载与断网、320–430px 布局、子路径与安全区） |
| [`tools/arcade_gameplay_test.mjs`](tools/arcade_gameplay_test.mjs) | 确定性玩法场景回放（`--suite=base\|all`、`--repeat`、`--scenario`） |
| [`tools/arcade_zen_scores_test.mjs`](tools/arcade_zen_scores_test.mjs) | 俄罗斯方块禅模式与中心页积分记录（含导入导出与旧档兼容） |
| [`tools/arcade_calm_games_test.mjs`](tools/arcade_calm_games_test.mjs) | 三款棋牌规则自检/结算 + 10 款挑战修复 regression |
| [`tools/arcade_tower_test.mjs`](tools/arcade_tower_test.mjs) | 层塔物理、全览缩放、集装箱属性与难度曲线 |
| [`tools/arcade_interaction_test.mjs`](tools/arcade_interaction_test.mjs) | 移动端双击放大防护、五子棋落子按钮与预览取消 |
| [`tools/arcade_immersive_buttons_test.mjs`](tools/arcade_immersive_buttons_test.mjs) | 全屏 / PWA 独立窗口底部按钮拇指区抬升 |
| [`tools/arcade_pwa_update_test.mjs`](tools/arcade_pwa_update_test.mjs) | PWA 更新检测（线上版本来源、SW 广播）与独立窗口顶部布局 |
| [`tools/arcade_review_test.mjs`](tools/arcade_review_test.mjs) | 结算回看最终画面、五子棋棋盘放大 |
| [`tools/arcade_calm_probe.mjs`](tools/arcade_calm_probe.mjs) | 单页接入探针（开始 / 暂停 / 存档 / 续玩 / 窄屏布局） |
| [`tools/arcade_stage_solver.mjs`](tools/arcade_stage_solver.mjs) | 《影跃》S1–S3 关卡独立可达性求解 |
| [`tools/arcade_stage_coverage.mjs`](tools/arcade_stage_coverage.mjs) | 78 关证据覆盖矩阵（只登记证据等级，不声称通过） |
| [`tools/arcade_09_data.mjs`](tools/arcade_09_data.mjs) | 78 关设计源校验并生成运行时数据 `apps/arcade/challenge/*.js` |
| [`tools/arcade_design_check.py`](tools/arcade_design_check.py) | 在临时副本里重跑生成器，比对已提交的设计派生文档 |
| [`tools/restaurant_compare_smoke.mjs`](tools/restaurant_compare_smoke.mjs) | Venue Compare 冒烟：空状态、地图标注、链接与备注、撤销、导入导出、独立 HTML、四档布局 |

## 发布流程

1. 推送到 `main`（或手动 `workflow_dispatch`）后，[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) 执行一次校验/构建，把**同一份** `dist/` 并行部署到 GitHub Pages 与 Cloudflare Pages。
2. Actions 中应有四个 job 成功：`Validate and build`、`Deploy GitHub Pages`、`Deploy Cloudflare Pages`、`Verify both deployments`。
3. 末尾的 `Verify both deployments` 会跑 [`tools/verify_deploy.py`](tools/verify_deploy.py)，对固定的 **41 个部署文件**做逐文件 SHA-256 比对，并核对 Arcade `engine.js` / `sw.js` / 注册表版本、Badge Studio 与 Venue Compare 版本一致。它是一份关键的部署清单，不是全站逐文件清单。
4. 需要在本机复核时：`py -3 tools/verify_deploy.py --base https://shawlaw.github.io/studiokit/ --base https://studiokit.pages.dev/`。

Cloudflare 侧项目为 `studiokit`（Production branch `main`），所需 Secrets 为 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`，Variable 为 `CF_PAGES_URL`。Pull Request 只跑校验与构建，不触发部署。

一次双端发布是**不可分割**的：只发了 GitHub Pages 不能声明发布完成；任一端失败应使用 `Re-run failed jobs` 修复，而不是推空提交重试。首次建仓、半发布恢复与回滚步骤见 [`docs/RELEASE-RUNBOOK.md`](docs/RELEASE-RUNBOOK.md)；是否允许 Agent 推送 `main` 见 [Agent 授权边界](#贡献)。

## 数据与隐私

- 所有计算与导出都在浏览器内完成，没有项目自建的服务端接口、账号体系或云同步。
- 存储命名空间按工具隔离，均为历史兼容标识，**不得擅自改名**（改名需双读旧键并提供迁移）：

  | 工具 | 存储 | 键 / 数据库 |
  | --- | --- | --- |
  | Badge Studio | `localStorage` | `concentric_badge_editor_autosave_v2`（历史标识） |
  | Arcade | `localStorage` | `studiokit:arcade:` 下的 `progress:v1`、`runs:v1`、`prefs:v1`、`playtime:v1`、`scores:v1`、`challenge:v1`、`meta:v1` |
  | Venue Compare | IndexedDB | 数据库 `studiokit:restaurant-compare`（v1，store `projects`，记录 key `current`），项目 Schema v3 |

- 两个托管域名是独立 origin：`localStorage`、Service Worker 缓存与已安装 PWA 互不共享，切换主域名需要用户自行导出/导入。
- 清理站点数据会丢失本地记录；各工具都提供 JSON 备份/导入，属于常规操作路径而非兜底手段。
- 新工具的 key 统一格式：`studiokit:<tool-id>:<purpose>:v<version>`。

## 设计原则

1. **先读再改。** 动手前读 [`AGENTS.md`](AGENTS.md)、[`TASKS.md`](TASKS.md)、相关 ADR 与目标工具的 README。
2. **工具独立优先。** 不把业务逻辑合并成 SPA；不为了抽象而抽象共享层。
3. **保护既有工具与用户数据。** 未经明确授权不重写 Badge Studio 的绘制、配置 Schema、撤销/重做、导入导出或自动保存；不改历史 `localStorage` key 与字段。
4. **默认离线优先。** 不引入 CDN、远程字体、分析 SDK、埋点、后端请求、第三方 API 或远程图片依赖，除非 Owner 明确授权。
5. **路径兼容双托管。** 站内引用一律相对路径，同时适配项目站点子路径与根路径。
6. **无构建依赖。** 默认不引入 npm、打包器或运行时框架；确有必要先提交 ADR 与成本说明。
7. **小步提交。** Conventional Commits，一个提交聚焦一个意图；不 squash/rebase/force-push 未授权的分支。
8. **不伪造结果。** 没有实际执行的测试不能声称通过；没看到 Actions 成功与线上页面可访问，不能声称发布成功。
9. **不提交秘密。** Token、Cookie、个人配置、字体授权文件与本地数据不进仓库。

约束的完整版本（含具体红线与完成定义）见 [`AGENTS.md`](AGENTS.md)。

## 文档地图

| 文档 | 作用 |
| --- | --- |
| [`START-HERE.md`](START-HERE.md) | 30 秒入口：当前状态、Owner 与 Agent 的分工和授权边界 |
| [`AGENTS.md`](AGENTS.md) | Agent 操作契约：项目事实、不可破坏的约束、标准流程、DoD |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 环境要求、提交规范、PR 内容要求 |
| [`TASKS.md`](TASKS.md) / [`tasks/queue.json`](tasks/queue.json) | 任务、证据与未决项（人类可读 / 机器可读） |
| [`CHANGELOG.md`](CHANGELOG.md) | 全站变更记录（站点级与早期版本）；Arcade 逐版记录以 [`apps/arcade/CHANGELOG.md`](apps/arcade/CHANGELOG.md) 为准 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 结构边界、路径策略、运行时边界、状态与存储、部署 |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | 架构决策记录（ADR-0001 …） |
| [`docs/BASELINE.md`](docs/BASELINE.md) | 已发布基线事实：版本、Schema、存储键、验收覆盖 |
| [`docs/ADD-A-TOOL.md`](docs/ADD-A-TOOL.md) | 接入新工具的完整规范与验收清单 |
| [`docs/RELEASE-RUNBOOK.md`](docs/RELEASE-RUNBOOK.md) | 首次建仓、双端发布、半发布恢复与回滚 |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 已交付版本与后续方向 |
| [`docs/arcade/`](docs/arcade/) | Arcade 设计与证据索引：现行设计支撑、78 关设计源、游戏性量表 |
| [`docs/archive/`](docs/archive/README.md) | 已完成周期的过程记录（并行契约、独立评审、试玩包）归档；不再更新 |
| [`docs/badge-studio-upstream-readme.md`](docs/badge-studio-upstream-readme.md) | Badge Studio 上游 v2.2.0 说明原文存档（当前集成版本以 `BASELINE.md` 为准） |
| [`apps/<tool>/README.md`](apps/) | 各工具的产品文档（功能、数据模型、边界、测试） |
| [`apps/arcade/DESIGN-*.md`](apps/arcade/) | Arcade 逐版设计与回滚说明（`DESIGN-0.4.0` … `DESIGN-0.18.0`） |

## 已知边界

- **真机能力多为 UNVERIFIED。** iOS/Android 真机触控手感、原生全屏、系统分享面板、PWA 安装与更新提示时机均未在真机上逐项确认；文档中相关结论按 `UNVERIFIED` 处理，不写成已通过。
- **iPhone Safari 不支持网页元素全屏。** Arcade 会退化到 CSS 沉浸布局，不能隐藏 Safari 地址栏；想要更纯粹的显示需要「分享 → 添加到主屏幕」。
- **没有云能力。** 无排行榜、无云存档、无跨设备同步；分享只发送链接，不附带成绩。
- **双端不是事务性的。** 两个部署 job 独立，任一端失败都可能短暂出现一端新一端旧，需要重跑修复。
- **Arcade 挑战模式与经典模式数据完全分离。** 挑战记录走 `challenge:v1`，不进积分表、不写经典最高分；星币只由经典模式得分产生，挑战 6 关不读机库、不写星币。

## 贡献

- 环境：Python 3.12+（`tools/agentctl.py` 使用 3.12 语法）、可选 Node.js 20+（CI 用 22）；不需要 `npm install`。
- 提交前至少跑通 `py -3 tools/validate_site.py` 与 `py -3 tools/build_site.py`；涉及 Arcade 的改动还要跑 `py -3 tools/arcade_run_all_gates.py`，涉及 UI 的改动在桌面与 320/375/390/430px 窄屏各看一次。
- 提交信息用 Conventional Commits，一个提交一个意图；PR 需说明目的、用户可见变化、测试证据、数据/Schema 影响与回滚方式。
- **发布授权：** 向 `main` 推送或触发公开部署必须在本次任务中收到明确的 Owner 授权（`OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`），一次授权覆盖两个部署目标。详见 [`docs/RELEASE-RUNBOOK.md`](docs/RELEASE-RUNBOOK.md)。

## 许可证

[`LICENSE`](LICENSE) 为 MIT 许可证，覆盖代码、文档与站点样式：可自由使用、修改、分发与商用，只需保留版权与许可声明。

- 允许商业使用，包括在部署方自己的站点上展示广告；是否展示由部署方决定。
- 「StudioKit」名称、徽标与站点视觉标识不随 MIT 授权；基于本项目搭建的站点请使用自己的名称与标识，避免用户误认为官方版本。
- 街机厅各游戏为自研代码与自绘图形，未引入第三方素材；若游戏名称与现有商业作品重名（如「俄罗斯方块」「黄金矿工」），相关商标风险由使用与部署方自行评估。
- 变更授权需要全体版权人同意；当前为单一作者，可直接替换根目录 `LICENSE`，并同步更新本文件、[`docs/DECISIONS.md`](docs/DECISIONS.md) 与 [`CHANGELOG.md`](CHANGELOG.md)。
