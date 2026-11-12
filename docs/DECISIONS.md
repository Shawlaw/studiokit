# Architecture Decisions

## ADR-0001: Static HTML first

- **Status:** Accepted
- **Decision:** 每个工具以独立 HTML 为默认交付形式；不引入 SPA 框架或打包器。
- **Reason:** 现有工具是纯前端单页，保持可直接审阅、复制、离线运行和低成本 Agent 维护。
- **Consequence:** 工具之间可能有少量重复代码；只有稳定且真实重复的能力才进入 shared。

## ADR-0002: Registry-driven portal

- **Status:** Accepted
- **Decision:** `shared/tool-registry.json` 是首页工具卡片的唯一数据来源。
- **Reason:** 新增工具只需创建目录并更新一个注册表，不必手动改首页 HTML。
- **Consequence:** 注册表必须由 `validate_site.py` 校验，available 工具必须存在目标页面。

## ADR-0003: Build allowlist

- **Status:** Accepted
- **Decision:** Pages 只部署 `index.html`、`favicon.svg`、`shared/`、`apps/` 和 `.nojekyll`。
- **Reason:** 避免把 Agent Prompt、任务队列、内部开发文档和脚本公开发布。
- **Consequence:** 新增静态资源目录时必须同步更新 `tools/build_site.py` 白名单。

## ADR-0004: Native fullscreen first, CSS immersive fallback

- **Status:** Accepted
- **Decision:** 游戏页优先请求原生 Fullscreen API；不支持或被拒绝时退化为 CSS 沉浸布局，不伪造全屏成功。全屏偏好写入 Arcade 既有 prefs key，不新增存储命名空间。
- **Reason:** 桌面/Android 浏览器支持原生全屏，iPhone Safari 不支持网页元素全屏；只做原生会让一部分移动端按钮“点了没反应”，只做 CSS 又会放弃可用的原生能力。
- **Consequence:** 全屏状态由 Arcade 的 `engine.js` 统一管理；布局必须同时处理 `safe-area-inset-*`、竖屏比例和退出恢复。iPhone Safari 的地址栏无法隐藏，需在界面和文档中说明“可添加到主屏幕”，不能声称是真全屏。自动化测试至少覆盖 CSS 降级路径；原生全屏仍需真机验证。

## ADR-0005: MIT license, brand and trademarks reserved

- **Status:** Accepted
- **Decision:** 根目录 `LICENSE` 采用 MIT（Copyright (c) 2026 Shawlaw），覆盖代码、文档与站点样式；「StudioKit」名称、徽标和站点视觉标识不随代码授权。
- **Reason:** 项目是公开的个人工具集合，MIT 与 Owner 其他公开仓库（LogcatX、DeskFoundry、QuotaBarWin）一致，复用与学习成本最低。MIT 允许商业使用，可支撑未来在自有站点展示少量广告，同时不阻止他人复用。Arcade 各游戏是自研实现与自绘图形，玩法参考对象不构成这些代码的版权障碍。
- **Consequence:** 任何人可复制、修改并以自有名义部署（包括加广告），版权无法阻止换皮克隆，只能靠名称与标识区分官方版本。若之后确实需要限制商业再分发，只能在仍是单一版权人时改为 AGPL-3.0 或非商业许可（后者不再符合 OSI 开源定义），并同步更新 README、LICENSE 与 GitHub 的协议识别。

## ADR-0006: Dual hosting on GitHub Pages and Cloudflare Pages

- **Status:** Accepted
- **Decision:** 一次构建的 `dist/` 同时部署到 GitHub Pages 项目站点与 Cloudflare Pages 项目 `studiokit`。`push main` 触发同一个 workflow：构建一次，两个部署 job 并行，最后由 `tools/verify_deploy.py` 校验两个 origin 的逐文件哈希与版本一致。Cloudflare 使用 Direct Upload（`wrangler pages deploy`），不接 Git 集成；自定义域名以后单独绑定到 Cloudflare。
- **Reason:** 站点全部使用相对路径，同一份静态产物天然适配 GitHub Pages 子路径与 Cloudflare 根路径，应用代码不需要分叉。Direct Upload 复用 GitHub Actions 已通过的构建结果，避免第二套构建环境和两套校验结论；Cloudflare 作为独立的第二入口，降低单一托管故障的影响。
- **Consequence:** 两个部署不是事务性的：任一 job 失败都可能出现一端新、一端旧，必须用 `Re-run failed jobs` 修复，不能推空提交重试。两个域名是独立 origin，localStorage/SW/PWA 不互通。CI 需要 Pages Edit 的 API Token（只放 GitHub Secrets）。本地 Windows 构建为 CRLF，CI Linux 为 LF，校验脚本按文本换行归一化比较；发布以 CI 产物为准。
