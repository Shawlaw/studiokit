# Start Here

面向 Owner 与 Agent 的 30 秒入口。所有判断以仓库文件为准，不以口头记忆为准。

## 当前状态

| 项 | 值 |
| --- | --- |
| 线上站点 | <https://shawlaw.github.io/studiokit/> · <https://studiokit.pages.dev/> |
| 仓库 | <https://github.com/Shawlaw/studiokit> |
| Badge Studio | `2.2.1`｜`available` |
| 街机厅 Arcade | `0.17.0`｜`available`（16 款竖屏小游戏，13 款带 6 关挑战；0.15 被动线索与独立生涯数据层；0.16 开放旧港告示板委托、免费租机与飞船机库，经典/挑战/禅/割草零改动） |
| Venue Compare | `0.2.0`｜`available` |
| Rounded Image | `planned`｜**尚未实现**，等待原始需求 / 规格，不凭空复刻 |

- 三个工具均已双端发布（GitHub Pages + Cloudflare Pages）。**变更、门禁结果与发布证据以各工具目录下的 `CHANGELOG.md` 为准**（Arcade 见 [`apps/arcade/CHANGELOG.md`](apps/arcade/CHANGELOG.md)），根目录 [`CHANGELOG.md`](CHANGELOG.md) 记录站点级变更；本文不复述，避免过期。
- 当前基线事实（版本、Schema、存储键）见 [`docs/BASELINE.md`](docs/BASELINE.md)；任务、证据与未决项见 [`TASKS.md`](TASKS.md)。
- 全局未验证项：iOS / Android 真机触控手感、原生全屏、系统分享面板、PWA 安装与更新提示时机均为 **UNVERIFIED**；Arcade 0.8.0 竖切片的 Owner 试玩门槛仍未收集（`TASKS.md` T039 `BLOCKED`）。

## 给 Owner

1. 用 Agent 打开 `StudioKit/` 仓库目录。
2. 给 Agent 一个明确任务：要改哪个工具、验收条件是什么、是否允许发布。
3. 需要正式推送 / 合并 `main` 并触发 Pages 发布时，在本次任务中保留授权行：

   ```text
   OWNER_AUTHORIZATION: PUBLISH_TO_MAIN
   ```

   一次授权覆盖两个部署目标；不允许只发一端后声称发布完成。

4. 发布后要求 Agent 返回 commit SHA、Actions run URL、两个 Pages URL，并实际验证门户、Badge Studio、街机厅与 Venue Compare。
5. 不要把 Token、Cookie 或个人数据放进仓库或 Prompt 文件；Cloudflare Token 只放 GitHub Secrets。
6. 涉及移动端体验的改动，要求 Agent 说明降级路径与真机验证方式——自动化通过不等于真机可用。
7. PWA 安装与离线预载只在 HTTPS 或 `localhost` 生效；`file://` 或明文 HTTP 局域网地址只能在线游玩。iOS 安装靠「分享 → 添加到主屏幕」，没有自动安装提示。

## 给 Agent

- 先读 [`AGENTS.md`](AGENTS.md)（操作契约）、[`TASKS.md`](TASKS.md)、目标工具的 `README.md` / `CHANGELOG.md` 与相关 `DESIGN-*.md`。
- 不要重新生成或覆盖 Badge Studio；它的绘制、配置 Schema、撤销 / 重做、导入导出与自动保存行为不是普通重构对象。
- Arcade 的共享运行时是 `apps/arcade/engine.js`，只服务街机厅；不要把它提升为全站 `shared/`。
- 不要实现 Rounded Image 的猜测版本；它只是注册表里的规划项。
- `docs/`、`tasks/`、`tools/` 与根级 Markdown 不发布；`tools/build_site.py` 用白名单生成 `dist/`（注意 `apps/` 按目录整体复制，工具自己的 README / CHANGELOG / DESIGN 会随站点发布）。
- 未获得本次任务明确授权前，不得向 `main` 推送、合并、打 Tag 或发布。
- 不要伪造结果：没实际执行的测试不写「通过」，没看到 Actions 成功与线上页面可访问不写「已发布」。
- 本机 Windows 若 `python` 指向 2.x，统一用 `py -3`。

## 本地快速验证

```powershell
py -3 tools/validate_site.py
py -3 tools/build_site.py
node --check shared/home.js
node --check shared/site-shell.js
node --check apps/arcade/engine.js
node --check apps/arcade/sw.js

# Arcade 全部门禁（需要本机 Chrome）
py -3 tools/arcade_run_all_gates.py
# 或单跑
node tools/arcade_smoke.mjs
# Venue Compare 冒烟（需要本机 Chrome）
node tools/restaurant_compare_smoke.mjs

py -3 -m http.server 8000
```

访问 <http://localhost:8000/>；街机厅在 <http://localhost:8000/apps/arcade/>，Venue Compare 在 <http://localhost:8000/apps/restaurant-compare/>。

首次建仓与首次发布的完整步骤保留在 [`docs/RELEASE-RUNBOOK.md`](docs/RELEASE-RUNBOOK.md)；已完成周期的过程文档归档在 [`docs/archive/`](docs/archive/README.md)，它们不代表当前流程。
