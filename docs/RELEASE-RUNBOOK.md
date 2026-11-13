# Release Runbook

## 当前发布状态

- 仓库：<https://github.com/Shawlaw/studiokit>
- GitHub Pages：<https://shawlaw.github.io/studiokit/>
- Cloudflare Pages：<https://studiokit.pages.dev/>
- 最近发布：Arcade `0.7.0`（2026-11-13，已发布）
  - 批次内容：T032 全游戏主动道具/自然收尾/一次性 20 分钟提醒/随机入口、T033 试玩截图复核与发布
  - 提交 `34f03df`；Actions `43274342320` 四个 job 均成功
  - 双端验证：`tools/verify_deploy.py` 24/24 文件 SHA-256 一致，Arcade `0.7.0` / Badge `2.2.1`
- 上一个发布：Arcade `0.6.2`（2026-11-12，已发布）
  - 批次内容：T028 黄金矿工目标取整/HUD、T029 俄罗斯方块左右手触屏按钮、T030 MIT 与源码入口、T031 双端发布
  - 提交 `0159437`；Actions `43155182519` 四个 job 均成功
  - 双端验证：`tools/verify_deploy.py` 当时覆盖的 11 个文件 SHA-256 一致，Arcade `0.6.2` / Badge `2.2.1`（0.7.0 起校验清单扩为 24 个文件）
- 本地开发中（未发布）：Arcade `0.8.0` 影跃影冲/影之试炼竖切片 + `0.9.0` 13 游戏 × 6 关挑战模式（设计包导入 `docs/arcade/0.9/`），分支 `feat/arcade-0.8-gameplay`，未推送、未合并、未发布；`ARCADE_VERSION` 故意保持 `0.7.0`。发布需 Owner 试玩反馈与明确的 `PUBLISH_TO_MAIN` 授权，发布前必须按本 runbook 全量复跑并决定是否升版本/SW 缓存版本/注册表版本。
- 上一个发布：Arcade `0.6.1`（2026-11-12），提交 `1c9501e`，Actions `43060497094` 成功
- 部署目标：
  - GitHub Pages：GitHub Actions（`.github/workflows/deploy.yml`）
  - Cloudflare Pages：Direct Upload，项目 `studiokit`，Production branch `main`

## 一次性设置（已完成，保留备查）

### GitHub

1. 仓库：`Shawlaw/studiokit`，`main` 为生产分支。
2. **Settings → Pages → Source** 选择 **GitHub Actions**。
3. Actions 允许运行；PR 只验证，不部署。

### Cloudflare Pages

1. Workers & Pages → Create → Pages → **Direct Upload**，项目名 `studiokit`，Production branch `main`。
2. 项目地址为 `https://studiokit.pages.dev/`；未绑定自定义域名。
3. 生成最小权限 API Token：Account → Cloudflare Pages → Edit，名称 `StudioKit GitHub Actions Pages`。Token 只存 GitHub Secrets，不写入仓库、日志或截图。
4. GitHub 仓库 **Settings → Secrets and variables → Actions**：
   - Secret `CLOUDFLARE_API_TOKEN`
   - Secret `CLOUDFLARE_ACCOUNT_ID`
   - Variable `CF_PAGES_URL` = `https://studiokit.pages.dev/`
5. 需要轮换 Token 时：新建同权限 Token → 更新 `CLOUDFLARE_API_TOKEN` → 跑一次 `workflow_dispatch` 验证 → 删除旧 Token。

## 自动部署条件

- `push` 到 `main`：`Validate and build` → `Deploy GitHub Pages` + `Deploy Cloudflare Pages` 并行 → `Verify both deployments`。
- `pull_request` 到 `main`：只执行校验与构建，不部署。
- `workflow_dispatch`：仅当所选分支为 `main` 时部署。
- 构建只做一次，两个部署 job 使用同一份 `site-dist` artifact；`verify` 对两个 origin 逐文件比较，并要求 Arcade 的 `engine.js` / `sw.js` / 注册表版本一致。

## 发布前检查

Windows 上若 `python` 指向 2.x，使用 `py -3`；CI 使用 Python 3.12。

```powershell
py -3 tools/validate_site.py
py -3 tools/build_site.py
node --check shared/home.js
node --check shared/site-shell.js
node --check apps/arcade/engine.js
node --check apps/arcade/sw.js
node tools/arcade_smoke.mjs   # 需要本机 Chrome；0.7.0 批次当前 85 项，含 PWA/断网与 13 款旧档回归
git diff --check
git status --short
```

提交时间必须符合 `commit-time-policy`；推送前对所有未推送提交跑一次：

```powershell
py -3 "$env:USERPROFILE\.agents\skills\commit-time-policy\check.py" origin/main..HEAD
```

涉及 Arcade 的发布还应查看 `apps/arcade/DESIGN-0.4.0.md`、`DESIGN-0.5.0.md`、`DESIGN-0.6.0.md`、`DESIGN-0.7.0.md` 和 `DESIGN-block-controls.md`。PWA/离线检查必须在 HTTPS 或 `localhost` 下进行；`file://` 与明文局域网 HTTP 不注册 Service Worker。

本地 Windows 构建会把文本文件写成 CRLF，CI 的 Linux checkout 是 LF。`verify_deploy.py` 在比较前统一换行，但正式发布以 CI artifact 为准；不要用本地 `dist/` 覆盖 CI 产物。

## Agent 授权边界

正式发布是双目标：GitHub Pages + Cloudflare Pages。一次 `PUBLISH_TO_MAIN` 授权覆盖两端，不允许只发一端后声称发布完成。

发布前 Owner 必须提供：

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

1. 检查 GitHub Actions 四个 job 均成功：`Validate and build`、`Deploy GitHub Pages`、`Deploy Cloudflare Pages`、`Verify both deployments`。
2. 从 run 日志或 job output 获取两个最终 URL，不要猜。
3. 跑一次独立校验：

   ```powershell
   py -3 tools/verify_deploy.py `
     --base "https://shawlaw.github.io/studiokit/" `
     --base "https://studiokit.pages.dev/" `
     --retries 15 --delay 8
   ```

   预期：两个 URL 的 24 个关键文件哈希一致（含 13 款游戏页与 `arcade.css`），Arcade 版本为 `0.7.0`，Badge 为 `2.2.1`，manifest 为 `application/manifest+json`。
4. 打开两个门户，确认工具卡片加载、源码链接、Badge Studio 与街机厅入口可点击。
5. 打开 Arcade 中心页，确认线上版本 `0.7.0` / 13 款，并检查：
   - 每款游戏都有 2 个主动道具按钮（黄金矿工保留 4 个），按钮在画布外/内均不遮挡核心操作；无签到、每日奖励或付费抽奖入口。
   - 中心页「惊喜一下」可随机打开一款，返回后再点不会立刻重复；页脚显示「快乐约定」。
   - `游玩统计`、`分享`、`安装到桌面`、`预载全部游戏` 的既有行为无回归；SW 缓存键为 `studiokit-arcade-0.7.0-v1`。
   - 自然收尾：2048 达成、砖块第 3 关、重力 3000m、贪吃蛇 20 果实、方块 40 行、星海 Boss CLEAR、赛车 5000m 至少抽测 3 项。
   - 暂停后继续、刷新续玩与旧档（缺新字段）恢复至少抽测 3 款；道具次数与计时不丢失、不翻倍。
6. 打开 Badge Studio，确认共享导航、预览和导出正常。
7. 检查浏览器控制台无资源 404 / JavaScript 错误（`favicon.ico` 自动请求的 404 可忽略）。Service Worker 缓存旧版本时，使用 DevTools → Application → Service Workers 注销并清除 Storage 后复测。
8. 记录 commit SHA、Actions run URL、两个最终 URL 和验证结果到 `TASKS.md` 与 `tasks/queue.json`。

## 半发布恢复

两个部署 job 并行，Cloudflare 或 GitHub Pages 任一失败都可能出现“一端新、一端旧”。处理顺序：

1. 在 Actions run 页面确认失败的是哪个 job；不要重新推一个新提交来“重试”。
2. 如果是 Secret/Token、项目名或权限问题：修复设置后，对同一次 run 点 **Re-run failed jobs**；它使用同一个 commit SHA 和同一份构建产物。
3. 如果是构建/校验失败：修复代码后重新提交并推送，两个 job 会一起重跑。
4. 如果是 Cloudflare 侧已成功、Pages 侧失败：Pages 修复后重跑失败 job；不要只在 Cloudflare dashboard 手动改，以免两端分叉。
5. 恢复后必须重新执行 `verify_deploy.py`，确认两个 origin 的哈希一致，再宣称发布完成。

## 回滚

- 优先通过 `git revert` 已发布提交并推送，让两端一起回到旧版本；不要 force-push。
- 紧急情况下可以在 Cloudflare dashboard 回滚单个 deployment，但这会让两端版本不一致；必须紧接着用 revert 或旧 run 重跑把 GitHub Pages 一起回退。
- 重跑历史成功 run 也是一种一致回滚：它使用旧 SHA 同时部署两端，内容与当时的 artifact 一致。
- 如果只是单个工具有问题，可先将注册表状态改为 `draft` 或 `planned`，但要确保门户仍可加载。
- 数据格式或 localStorage key 变更必须先有迁移与回滚策略；不要为了回滚删除用户数据。

## 自定义域名（可选，尚未绑定）

1. 决定使用子域（如 `studiokit.example.com`）还是 apex；子域不影响 apex 的邮箱/其他记录，优先推荐。
2. 在 Cloudflare 项目 → Custom domains → Set up a domain 添加域名；若 zone 在同一 CF 账户下，CF 会自动创建 CNAME。不要先手动建 CNAME，否则可能 522。
3. 等证书 Active；若一直 pending，检查 CAA 记录是否允许 Cloudflare 的 CA。
4. 绑定后把 GitHub Variable `CF_PAGES_URL` 改为自定义域名，再跑一次发布/校验。
5. 不要在仓库放 `CNAME` 文件，也不要把同一个主机名同时绑定到 GitHub Pages 和 Cloudflare Pages；GitHub Pages 继续使用 `shawlaw.github.io/studiokit/`。
6. `studiokit.pages.dev` 仍可访问；若要只保留自定义域名，可另加 Bulk Redirect（可选）。
