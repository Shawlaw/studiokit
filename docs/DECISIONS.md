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
