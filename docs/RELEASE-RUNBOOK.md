# Release Runbook

## 一次性仓库设置

1. 在 GitHub 创建目标仓库，并确认仓库名称与可见性（Public / Private）。不要把密钥或个人数据放进仓库。
2. 将 StudioKit 源码推送到 `main`。
3. 打开 **Settings → Pages**，将 **Source** 设为 **GitHub Actions**。
4. 确认仓库 Actions 权限允许工作流运行。

## 自动部署条件

- `push` 到 `main`：执行验证、构建和 Pages 部署。
- `pull_request` 到 `main`：只执行验证与构建，不部署。
- `workflow_dispatch`：仅当所选分支为 `main` 时部署。

## 发布前检查

```powershell
python tools/validate_site.py
python tools/build_site.py
node --check shared/home.js
node --check shared/site-shell.js
git diff --check
git status --short
```

## Agent 授权边界

首次发布前 Owner 必须提供：

- 目标 GitHub 仓库 URL；
- 仓库可见性；
- Pages 使用 GitHub Actions 的确认；
- 明确授权 Agent 推送/合并到 `main` 并触发公开站点部署。

推荐在具体任务中加入精确授权行：

```text
OWNER_AUTHORIZATION: PUBLISH_TO_MAIN
```

没有这行时，Agent 可以完成代码、测试、构建、分支提交和 PR 准备，但不得推送到 `main` 或触发正式发布。不得自行改变仓库可见性、组织权限或创建未经确认的公开仓库。

## 发布后验证

1. 检查 GitHub Actions 中 `Deploy StudioKit` 工作流的最终状态为成功。
2. 从部署日志获取 Pages URL，不要猜 URL。
3. 访问门户首页，确认工具卡片加载。
4. 打开 Badge Studio，确认共享导航、预览和导出正常。
5. 检查浏览器控制台无资源 404 / JavaScript 错误。
6. 记录 commit SHA、Actions run URL、最终 Pages URL 和验证结果。

如果 Pages 未启用或认证缺失，明确报告阻塞点，不要宣称已发布。

## 回滚

- 优先通过 revert 已发布提交回滚，不要 force-push。
- 如果只是单个工具有问题，可先将注册表状态改为 `draft` 或 `planned`，但要确保门户仍可加载。
- 数据格式或 localStorage key 变更必须先有迁移与回滚策略。
