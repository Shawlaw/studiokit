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

待 0.24.1 版本链完成后串行运行 `py -3 tools/arcade_run_all_gates.py --profile release`。结论以实际 JSON 为准；release 不等于 full。

## 4. 部署验证

待 fast-forward 推送后记录 main 提交、Actions run、双端 `verify_deploy.py` 文件数与线上浏览器结果。未完成前不写 PUBLISHED。

## 5. 未验证项

- iOS / Android 真机生涯触控与 PWA 自动更新提示：UNVERIFIED。
- full profile 与真人体验：UNVERIFIED。
