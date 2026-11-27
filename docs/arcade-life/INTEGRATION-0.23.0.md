# Arcade 0.23.0 集成与验证

- 状态：IN_PROGRESS（T15 视觉/可访问性/PWA 验证与 T16 版本门禁未完成前不得写 RELEASE_READY 或 PUBLISHED）
- 设计 / 回滚：[`DESIGN-0.23.0.md`](../../apps/arcade/DESIGN-0.23.0.md)
- 基线：0.22.0 `7a78f66`；版本链 0.23.0，SW `studiokit-arcade-0.23.0-v1`
- 冻结边界：0.22 的 IDB v1、localStorage key、`contentVersion 0.18.0`、玩法数值、经典街机与封存/导入语义不变。

## 1. 已完成任务

| 任务 | 状态 | 证据 |
|---|---|---|
| T10 UI 契约与夹具 | PASS（契约层） | `ADR-0.23-ui.md`、P01–P10 fixtures；coverage missing=0；t10-reviewer PASS |
| T11 共享组件 | PASS（范围） | components 210/210；harbor 逐字一致；t11-reviewer PASS |
| T12 邀请/回执适配 | PASS（范围） | invitation adapters 109/109；t12-reviewer PASS |
| T13 港口/工作/经历适配 | PASS（owner） | port/journal 43/43；t13-reviewer PASS |
| T14 全职业叙事 | PASS（数据范围） | narrative 612/612；16/16 职业；t14-reviewer PASS |

## 2. 集成事实

- bridge 按需加载 `components.js`、`harbor.js`、`invitation.js` 与同源 `tokens.css`/`components.css`，并注入 `uiComponents/uiHarbor/narrative/openInvitation`；缺失时保留 0.22 降级路径。
- `careerView` 的 `story.messages` 仅从已接受职业叙事卡取 0/1 条；可用终局优先于普通下一步。
- 叙事 registry 与四个 shard 为同源可选内容；加载失败不影响经典/0.22 流程。
- 所有视觉组件限定 `.ac-career-ui`，普通游戏主题与首页入口保持原样。

## 3. 门禁记录

- 候选产品提交 `01b64d4`，独立 QA 工作树 `f8021dc`。`node tools/career_ui_visual_test.mjs --visual` 25.794s，退出 0，13/13 场景通过（P01–P09、P10 四变体），16/16 交互通过，76 张截图。普通宽屏和移动窄屏的同内容对照覆盖 1280×800 与 390×844，指定场景额外检查 320×640 和 844×390。几何差异最大 2 CSS px，无横向溢出。
- `node tools/career_ui_visual_test.mjs --pwa-only` 3.897s，退出 0，6/6。0.23.0 SW 版本握手、UI 与叙事资源缓存、真实离线 reload、零服务器文档请求及离线信箱打开均通过。报告、截图和 QA 源存于仓库外 `execution/qa-023-candidate`。桌面 Chrome 的离线和窄屏验证有效，真机与线上部署尚无验证证据。
- 针对性纯测试：组件 277/277、邀请适配 122/122、港口/经历 54/54、回执反馈 134/134。独立复审、真实首航和整版 release 门禁仍待完成。

## 4. 发布准备

- 未获 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`；不 push main、不打 tag、不创建 Release、不部署。
- 正式发布需双目标同 SHA 通过 workflow 与 `verify_deploy.py`；一次授权覆盖两端。
