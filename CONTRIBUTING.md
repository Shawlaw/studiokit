# Contributing

## Development

- Python 3.12+（CI 使用 3.12；`tools/agentctl.py` 的 f-string 语法需要 3.12+）。
- Node.js 20+ 可选（CI 使用 22；用于 JavaScript 语法检查和 Arcade 无头浏览器测试）。
- 不需要 npm install。
- Windows 上如果 `python` 指向 2.x，使用 `py -3`。

```powershell
py -3 tools/validate_site.py
py -3 tools/build_site.py
node --check shared/home.js
node --check shared/site-shell.js
node --check apps/arcade/engine.js
node tools/arcade_smoke.mjs   # 需要本机 Chrome；当前 57 项
```

涉及 UI 的改动请在桌面和 375px 左右窄屏各看一次；涉及 Arcade 的改动至少跑通 `arcade_smoke.mjs`，并在任务记录里写清未覆盖的真机/原生能力。

## Commits

使用 Conventional Commits，例如：

- `feat(portal): add tool discovery filters`
- `feat(rounded-image): add corner radius controls`
- `fix(badge-studio): preserve legacy config import`
- `docs: clarify GitHub Pages setup`

一个提交聚焦一个意图。不要在同一个提交里混入无关工具的重构、文档重排或版本升级。

## Pull requests

PR 应包含：目的、用户可见变化、测试证据、截图（若有 UI 变化）、数据/Schema 影响、回滚方式。不要把多个无关工具的重构混在一个 PR。

发布到 `main` 仍受 Owner 授权约束，见 `docs/RELEASE-RUNBOOK.md`。
