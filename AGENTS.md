# Agent Operating Contract

本文件适用于所有自动化 Agent（Flash / Codex / 其他 Worker）。遇到冲突时，优先级为：Owner 当前明确指令 > 本文件 > 任务卡 > 其他文档。

## 1. 项目事实

- StudioKit 是静态多工具 Monorepo，不是单一 SPA。
- 每个工具独立放在 `apps/<tool-id>/`，默认入口为 `index.html`。
- 首页工具清单唯一来源为 `shared/tool-registry.json`。
- 共享运行时仅限 `shared/site.css` 与 `shared/site-shell.js`；不要引入大型框架。
- 当前 Badge Studio 版本为 2.2.1，配置 Schema 为 v3。
- Rounded Image 尚未实现，不得假设旧功能、控件或参数。

## 2. 不可破坏的约束

1. **先读再改：** 开始任务前阅读本文件、`TASKS.md`、相关 ADR 和目标工具 README。
2. **保护既有工具：** 未经任务明确授权，不重写 Badge Studio 绘制算法、配置 Schema、撤销/重做、导入导出或自动保存行为。
3. **保护用户数据：** 不随意修改 localStorage key、配置字段或 Schema。若必须修改，提供兼容迁移、回滚方案和测试。
4. **默认离线优先：** 不新增 CDN、远程字体、分析 SDK、埋点、后端请求、第三方 API 或远程图片依赖，除非 Owner 明确授权。
5. **路径兼容：** 必须兼容 GitHub Pages 项目站点子路径，避免 `/assets/...` 这类从域名根目录解析的绝对路径。
6. **工具隔离：** 不共享业务状态；localStorage key 必须带工具 ID 命名空间。既有工具的历史 key 为兼容性保留，不得擅自改名。
7. **无构建依赖：** 默认不引入 npm、打包器或运行时框架。确有必要时先提交 ADR 和成本说明。
8. **小步提交：** 使用 Conventional Commits；一个提交聚焦一个意图；不 squash/rebase/force-push 用户未授权的分支。
9. **不伪造结果：** 没有实际执行的测试不能声称通过；没有看到 GitHub Actions 成功和线上页面可访问，不能声称发布成功。
10. **不提交秘密：** 不把 Token、Cookie、个人配置、字体授权文件、私密图片或本地数据写入仓库。

## 3. 标准执行流程

1. `git status --short --branch`，确认工作树与分支；不覆盖未知改动。
2. 阅读 `TASKS.md`，用 `python tools/agentctl.py next` 获取任务。
3. 先复现，再修改；新增行为必须有可验证的验收条件。
4. 执行：
   - `python tools/validate_site.py`
   - `python tools/build_site.py`
   - `node --check shared/home.js`（若 Node 可用）
   - `node --check shared/site-shell.js`（若 Node 可用）
5. 检查 `git diff --check`、`git diff --stat`、完整 diff。
6. 任务完成后更新 `tasks/queue.json` 与 `TASKS.md`，记录证据和未解决项。
7. 提交前确认没有 `dist/`、缓存、私密数据或无关文件。

## 4. Git 与发布授权

- 默认在任务分支工作；不得擅自向 `main` 推送、合并、打 Tag 或发布 GitHub Release。
- Agent 可以创建本地分支、提交本地 commit；远程 push / PR 操作必须有可用认证和明确目标仓库。
- StudioKit 首次 Pages 发布需要 Owner 确认：GitHub 仓库 URL、仓库可见性、Pages 已选择 GitHub Actions，以及是否授权部署到 `main`。
- 只有当前任务明确包含 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN` 时，才可将通过验证的提交推送/合并到 `main` 并触发 Pages 部署。
- Owner 的一般性目标描述不等于允许 Agent 创建公开仓库、改变仓库可见性、修改组织权限或使用未授权凭证。
- 发布后必须检查 GitHub Actions 部署结果，并用最终 URL 做 HTTP/浏览器验证；失败时报告失败，不得重复盲目推送。

## 5. 新工具接入

- 优先运行 `python tools/new_tool.py --id <slug> --name "..." --description "..."`。
- ID 使用小写 kebab-case，创建后不得随意改名（会改变 URL）。
- 将工具完整 HTML 放入 `apps/<id>/index.html`；共享 shell 只负责返回门户，不侵入工具业务 UI。
- 首页注册表状态按 `draft` → `available` 变化；未验收工具不得标为 `available`。
- 每个工具有自己的 README、CHANGELOG、版本和必要的测试说明。
- 详细规范见 `docs/ADD-A-TOOL.md`。

## 6. 完成定义（DoD）

- 任务验收条件逐项通过。
- 静态校验与构建成功。
- 受影响工具在桌面与窄屏布局检查通过。
- 导入/导出、自动保存和配置兼容性无回归（适用时）。
- 文档、注册表、版本和任务状态同步。
- Diff 干净；提交信息清晰；没有未经授权的发布动作。
