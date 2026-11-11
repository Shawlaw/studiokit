# Start Here

## 当前状态

- **线上站点：** <https://shawlaw.github.io/studiokit/>
- **仓库：** <https://github.com/Shawlaw/studiokit>
- **已发布工具：** Badge Studio `2.2.1`、街机厅 Arcade `0.6.1`（13 款竖屏小游戏）
- **规划中：** Rounded Image（尚未实现；等待原始需求/规格，不凭空复刻）
- **最近发布：** 2026-11-12，Arcade 0.6.1（Boss 入场碰撞热修）；提交 `6debd77`（0.6.0）+ `1c9501e`（0.6.1），Actions `43060497094` 成功

首次建仓与首次发布的完整步骤保留在 [`docs/RELEASE-RUNBOOK.md`](docs/RELEASE-RUNBOOK.md)；`prompts/` 下的启动/发布 Prompt 是历史脚本，不再代表当前流程。

## 给 Owner

1. 用 Agent 打开 `StudioKit/` 仓库目录。
2. 给 Agent 一个明确任务：要改哪个工具、验收条件是什么、是否允许发布。
3. 需要正式推送/合并 `main` 并触发 Pages 发布时，在本次任务中保留授权行：

   ```text
   OWNER_AUTHORIZATION: PUBLISH_TO_MAIN
   ```

4. 发布后要求 Agent 返回 commit SHA、Actions run URL、Pages URL，并实际验证门户、Badge Studio 和街机厅。
5. 不要把 Token、Cookie 或个人数据放进仓库或 Prompt 文件。
6. Arcade 的 iOS/Android 真机试玩和原生全屏仍未验证；涉及移动端体验的改动请要求 Agent 说明降级路径。
7. PWA 安装与离线预载只在 HTTPS 或 `localhost` 生效；`file://` 或明文 HTTP 局域网地址只能在线游玩。iOS 安装靠「分享 → 添加到主屏幕」，没有自动安装提示。

## 给 Agent

- 先读 `AGENTS.md`、`TASKS.md`、目标工具的 `README.md`、`CHANGELOG.md` 和设计文档。
- 不要重新生成或覆盖已有 Badge Studio；它已从 v2.2.0 纳入 `apps/badge-studio/`，当前基线 2.2.1。
- 不要把 Badge Studio 的绘制、配置 Schema、撤销/重做、导入导出或自动保存行为当作普通重构对象。
- Arcade 的共享运行时在 `apps/arcade/engine.js`，只服务街机厅；不要把它提升为全站共享层，除非有明确任务与 ADR。
- 不要实现 Rounded Image 的猜测版本；它目前只是注册表中的规划项。
- 不要把 `docs/`、`prompts/`、`tasks/`、`tools/` 发布到 Pages。`tools/build_site.py` 已用白名单生成 `dist/`。
- 未获得本次任务明确授权前，不得向 `main` 发布。
- 本机 Windows 若 `python` 指向 2.x，使用 `py -3` 执行脚本。

## 本地快速验证

```powershell
py -3 tools/validate_site.py
py -3 tools/build_site.py
node --check shared/home.js
node --check shared/site-shell.js
node --check apps/arcade/engine.js
node tools/arcade_smoke.mjs   # 需要本机 Chrome
py -3 -m http.server 8000
```

访问 `http://localhost:8000/`；街机厅在 `http://localhost:8000/apps/arcade/`。
