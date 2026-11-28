# Arcade 0.24.1 集成与验证

- 版本链：0.24.1 / SW `studiokit-arcade-0.24.1-v1`
- 基线：已发布 0.24.0，`main` `6744a3d`
- 设计 / 回滚：[`DESIGN-0.24.1.md`](../../apps/arcade/DESIGN-0.24.1.md)
- Owner 授权：`OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`，fast-forward 合入 `main` 并双端发布。

## 1. 修复范围

- 折光港底部和首页页尾原地打开生涯设置；封存、解冻、输入确认词完全重置可用，经典记录不变。
- 三级生涯弹窗统一标题栏、关闭按钮、面板尺寸与颜色；正文滚动条与文字分离，标题和港口底部操作固定可见。
- 首页初次打开与恢复时自动核对线上版本；新 SW 已激活但页面未刷新时也会显示更新横幅。

## 2. 定向证据

| 门禁 | 结果 |
|---|---|
| `arcade_pwa_update_test` | 11/11；含新 SW 已激活后重开首页自动提示、稍后不重复提示 |
| `career_pwa_offline_test` | 18/18 |
| `career_mobile_016_test` | 335/335 |
| `career_archive_lifecycle_e2e_test` | 61/61 |
| `career_archive_test` | 8/8 |
| `career_ui_components_test` | 282/282 |
| `career_ui_invitation_adapters_test` | 142/142 |
| `career_ui_port_journal_test` | 58/58 |
| `career_passive_entry_test` | 71/71 |
| 320px 港口刷新后设置关闭回焦 | PASS |
| 贪吃蛇转向队列定向复测 | 5/5 |

- 旧代码复现：新 SW 激活后重开首页，更新横幅仍隐藏；修复后无需点击自动显示。
- 完整冒烟在修复分支出现两次贪吃蛇转向队列 1200ms 断言超时；同路径定向 5/5，未修改的 0.24.0 基线完整冒烟 119/119。最终以本轮 release profile 的实际结果为准。
- 旧版 `career_discovery_accessibility_test` 的线索入口断言、`career_closeout_test` 的跨标签读信时间一致性断言在未修改的 0.24.0 基线亦失败；本版不将其结果伪报为通过。

## 3. 发布门禁

- 首次完整 release：50/51，96 委托 3792/3792、移动端 335/335、封存生命周期 61/61、冒烟 119/119 均通过；唯一失败为 375×548 港口推荐单被固定底栏遮挡。
- 修正：短视口压缩面板间距与港口插图高度，推荐单恢复可见可点；完整生涯流程定向复测 645/645。
- 最终完整 release：候选 `bf4877c` **51/51 PASS**，2895.416s，`release passed (not full)`、`fully_passed: false`。96 委托 3792/3792、移动端 335/335、封存生命周期 61/61、冒烟 119/119、生涯流程 645/645 均通过。

## 4. 部署验证

- 已 fast-forward 合入并推送 `main`：发布提交 `5a20785`。
- [Actions `46175355611`](https://github.com/Shawlaw/studiokit/actions/runs/46175355611) 的 Validate and build、Arcade static gates、Deploy GitHub Pages、Deploy Cloudflare Pages、Verify both deployments 全部成功。
- 本地 `verify_deploy.py`：**111/111** 文件在 GitHub Pages 与 Cloudflare Pages 逐字节一致；Arcade 0.24.1、Badge 2.2.1、Venue 0.2.0。
- 两端线上 Chromium：首页版本 0.24.1、16 张游戏卡、更新按钮可见、无更新时横幅隐藏、页面标题正确。

## 5. 未验证项

- iOS / Android 真机生涯触控与 PWA 自动更新提示：UNVERIFIED。
- full profile 与真人体验：UNVERIFIED。
