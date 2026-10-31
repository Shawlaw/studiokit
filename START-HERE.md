# Start Here

## 给 Owner

1. 解压 `StudioKit-startup-v0.1.0.zip` 到你的工作目录。
2. 用 Flash 级 Agent 打开 `StudioKit/` 仓库目录。
3. 将 `prompts/FLASH-BOOTSTRAP.md` 的完整内容交给 Agent，让它先审计、验证、构建并准备首个提交。
4. 如果还没有 GitHub 仓库，先在 GitHub 创建一个空仓库，并决定 Public / Private。不要把 Token 放进仓库或 Prompt 文件。
5. 在 `prompts/FLASH-FIRST-PUBLISH.md` 中填写目标仓库 URL 和可见性；确认仓库 **Settings → Pages → Source** 为 **GitHub Actions**。
6. 需要 Agent 正式推送/合并 `main` 并触发 Pages 发布时，在本次交给 Agent 的任务中保留授权行：

   ```text
   OWNER_AUTHORIZATION: PUBLISH_TO_MAIN
   ```

7. 发布后要求 Agent 返回 commit SHA、Actions run URL、Pages URL，并实际验证首页和 Badge Studio。

## 给 Agent

- 先读 `AGENTS.md`、`TASKS.md` 和 `prompts/FLASH-BOOTSTRAP.md`。
- 不要重新生成或覆盖已有 Badge Studio；它已从 v2.2.0 纳入 `apps/badge-studio/`。
- 不要实现 Rounded Image 的猜测版本；它目前只是注册表中的规划项。
- 不要把 `docs/`、`prompts/`、`tasks/`、`tools/` 发布到 Pages。`tools/build_site.py` 已用白名单生成 `dist/`。
- 未获得本次任务明确授权前，不得向 `main` 发布。

## 本地快速验证

```powershell
python tools/validate_site.py
python tools/build_site.py
python -m http.server 8000
```

访问 `http://localhost:8000/`。
