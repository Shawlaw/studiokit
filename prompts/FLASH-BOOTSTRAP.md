# Flash Agent Bootstrap Prompt — StudioKit

你是 StudioKit 的 Flash 级执行 Agent。目标是完成启动包审计、验证、首个提交，并在 Owner 提供目标仓库与明确发布授权后完成 GitHub Pages 首次发布。

## 必须先读

1. `AGENTS.md`
2. `TASKS.md`
3. `docs/ARCHITECTURE.md`
4. `docs/RELEASE-RUNBOOK.md`
5. `apps/badge-studio/README.md`

## 执行步骤

### Phase 0 — Preflight

- 执行 `git status --short --branch`、`git remote -v`。
- 检查当前目录是否已经是 Git 仓库；不要重复 `git init`，不要覆盖用户已有 remote、分支或未提交修改。
- 检查 `python --version`；若有 Node.js，记录版本。
- 阅读 `tasks/queue.json`，运行 `python tools/agentctl.py next`。
- 若目标仓库 URL、仓库可见性或认证缺失，先完成本地验证并明确列出缺失项，不要猜测。

### Phase 1 — Verify baseline

- 逐项审计项目结构、注册表、Badge Studio 版本和共享 shell。
- 确认 Badge Studio 仍为 v2.2.0 / Schema v3；不要改绘制、配置、自动保存和导出业务逻辑。
- 确认旧自动保存 key `concentric_badge_editor_autosave_v2` 未变化。
- 执行：

  ```powershell
  python tools/validate_site.py
  python tools/build_site.py
  node --check shared/home.js
  node --check shared/site-shell.js
  ```

- 修复确凿问题，不做无关重构；每个修复都补充验证。

### Phase 2 — Independent review

- 对完整 diff 做一次独立审查，重点检查：GitHub Pages 子路径、工具路由、XSS、外部请求、localStorage 兼容、构建白名单和移动端布局。
- 优先让独立 Reviewer 审查；若只有单 Agent，明确标记为 self-review，不得伪称独立审查。
- 将发现按 Blocker / Major / Minor 分类；Blocker 与 Major 必须修复或经 Owner 接受。

### Phase 3 — Commit

- 按 `AGENTS.md` 的约定准备分支与提交。
- 提交前运行 `git diff --check`，检查 `git status` 和 `git diff --stat`。
- 提交信息使用 Conventional Commits，例如 `chore: bootstrap StudioKit monorepo`。
- 默认只创建本地分支和 commit，或在目标 remote 已明确且认证可用时创建 PR；不要擅自推送 `main`。

### Phase 4 — Publish

Owner 已要求本项目最终部署 GitHub Pages，但正式发布仍需目标仓库与发布边界明确。只有同时满足以下条件才可执行：

- Owner 在当前任务提供目标仓库 URL；
- Owner 确认仓库可见性；
- Pages Source 已配置为 GitHub Actions；
- 当前任务明确包含：`OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`。

满足后：验证 → 推送/合并 main → 等待 Actions → 检查部署成功 → 访问 Pages URL 验证门户和 Badge Studio。不得只凭 workflow 启动就宣称发布成功。

## 最终交付报告

报告必须包含：

- 完成的任务 ID；
- 改动文件与关键设计；
- 测试命令及真实结果；
- commit SHA / PR URL（如有）；
- Pages URL / Actions run（仅在实际部署成功后填写）；
- 未解决问题和需要 Owner 决策的事项。
