# Flash Agent Prompt — First GitHub Pages Publish

> 历史脚本：StudioKit 已完成首次发布（当前线上 <https://shawlaw.github.io/studiokit/>）。日常发布请使用 `docs/RELEASE-RUNBOOK.md`，不要再把本文件当作当前发布清单。

请按 StudioKit 的 AGENTS.md、TASKS.md 和 docs/RELEASE-RUNBOOK.md 完成首个 GitHub Pages 发布。

## Owner 提供的信息

- Target repository URL: `<填写 GitHub 仓库 URL>`
- Repository visibility: `<public 或 private>`
- GitHub Pages Source: `GitHub Actions`（Owner 已在 Settings → Pages 设置）

## 发布授权

OWNER_AUTHORIZATION: PUBLISH_TO_MAIN

## 执行要求

1. 先检查当前 Git 工作树、remote、分支和认证状态；不要覆盖未知改动。
2. 执行 T001–T004，所有验证与独立 Review 通过后才进入 T005。
3. 如果仓库 URL、可见性、Pages 设置或 GitHub 认证缺失，停止在安全边界内并报告缺项。
4. 不得自行改变仓库可见性、组织权限或创建另一个公开仓库。
5. 推送/合并到 main 后等待 Actions 完成；仅在部署成功且线上首页、Badge Studio 均可访问后报告发布成功。
6. 最终报告 commit SHA、Actions run URL、Pages URL、验证结果和遗留风险。
