# Release Runbook

## 当前发布状态

- 仓库：<https://github.com/Shawlaw/studiokit>
- 线上：<https://shawlaw.github.io/studiokit/>
- 最近发布：Arcade `0.4.0`（2026-11-10）
  - 功能提交 `49bc1aa`，任务归档 `1b9ce14`
  - Actions `42846474565`、`42848635797` 均 validate + build + deploy 成功
- 本地待发布：Arcade `0.5.0`（游玩统计 / 分享 / PWA / 离线预载），分支 `feat/arcade-0.5.0-playtime-pwa`，63/63 CDP 通过
- Pages Source：GitHub Actions（`.github/workflows/pages.yml`）

## 首次仓库设置（已完成，保留备查）

1. 在 GitHub 创建目标仓库，并确认仓库名称与可见性（Public / Private）。不要把密钥或个人数据放进仓库。
2. 将 StudioKit 源码推送到 `main`。
3. 打开 **Settings → Pages**，将 **Source** 设为 **GitHub Actions**。
4. 确认仓库 Actions 权限允许工作流运行。

## 自动部署条件

- `push` 到 `main`：执行验证、构建和 Pages 部署。
- `pull_request` 到 `main`：只执行验证与构建，不部署。
- `workflow_dispatch`：仅当所选分支为 `main` 时部署。

## 发布前检查

Windows 上若 `python` 指向 2.x，使用 `py -3`；CI 使用 Python 3.12。

```powershell
py -3 tools/validate_site.py
py -3 tools/build_site.py
node --check shared/home.js
node --check shared/site-shell.js
node --check apps/arcade/engine.js
node --check apps/arcade/sw.js
node tools/arcade_smoke.mjs   # 需要本机 Chrome；当前 63 项，含 PWA/断网回归
git diff --check
git status --short
```

涉及 Arcade 的发布还应查看 `apps/arcade/DESIGN-0.4.0.md`、`apps/arcade/DESIGN-0.5.0.md` 和 `apps/arcade/README.md` 的已知边界。PWA/离线检查必须在 HTTPS 或 `localhost` 下进行；`file://` 与明文局域网 HTTP 不注册 Service Worker。

如果本机/团队启用了 `commit-time-policy`，推送前运行对应检查器；本文不复制其时间窗口细节，避免规则漂移。

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

1. 检查 GitHub Actions 中 `Validate and build` 与 `Deploy StudioKit` 均为成功。
2. 从部署日志获取 Pages URL，不要猜 URL。
3. 访问门户首页，确认工具卡片加载、Badge Studio 与街机厅入口可点击。
4. 打开 Arcade 中心页，确认版本与工具注册表一致（0.5.0 / 13 款），并检查：
   - 「游玩统计」有数据或空状态文案；开一局后返回中心页，累计时长/轮次增加，展开能看到轮次明细。
   - 「分享给朋友」能调起系统分享或复制链接；游戏开始/暂停弹层内「分享给朋友」分享当前游戏深链。
   - 「安装到桌面」按平台给出安装提示（Chrome/Edge 可触发原生安装，iOS 给出添加到主屏幕说明）。
   - 「预载全部游戏」显示进度；完成后断网刷新中心页仍能打开，已预载游戏可进入，未预载页显示离线提示。
5. 打开 Badge Studio，确认共享导航、预览和导出正常。
6. 打开黄金矿工，确认 `⛶` 全屏按钮、道具条和暂停/继续可用；手机上至少检查 375px 宽度下的道具条和全屏降级。
7. 检查浏览器控制台无资源 404 / JavaScript 错误（`favicon.ico` 自动请求的 404 可忽略）。Service Worker 缓存旧版本时，使用 DevTools → Application → Service Workers 注销并清除 Storage 后复测。
8. 记录 commit SHA、Actions run URL、最终 Pages URL 和验证结果。

如果 Pages 未启用或认证缺失，明确报告阻塞点，不要宣称已发布。

## 回滚

- 优先通过 revert 已发布提交回滚，不要 force-push。
- 如果只是单个工具有问题，可先将注册表状态改为 `draft` 或 `planned`，但要确保门户仍可加载。
- Arcade 的道具/全屏出现阻断问题时，可先回退 `prefs.immersive` 的默认读取或禁用全屏入口；局内档中的 `tools` / `winchArmed` 是追加字段，旧代码会忽略，不需要数据迁移。
- 数据格式或 localStorage key 变更必须先有迁移与回滚策略；不要为了回滚删除用户数据。
