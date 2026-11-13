# Arcade 0.8.0 文档索引

本目录保存 Arcade 0.8.0 游戏性重构的**计划、事实与验收工具**，不是产品文档，也不进入发布产物（`tools/build_site.py` 的白名单只含 `index.html`、`favicon.svg`、`shared`、`apps`）。

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [0.8.0-PLAN.md](0.8.0-PLAN.md) | GPxxx 与仓库 Txxx 的映射、竖切片执行顺序、不变量与回滚 | 已执行到 GP007（T034–T040） |
| [0.8.0-FACTS.md](0.8.0-FACTS.md) | GP001 事实冻结：HEAD/分支/版本、13 款游戏现状矩阵逐条核实、`#test` 钩子与测试入口、GP↔T 冲突映射、竖切片先决条件 | 已完成（基线 HEAD `5fbe897`） |
| [GAMEPLAY-DESIGN-RUBRIC.md](GAMEPLAY-DESIGN-RUBRIC.md) | GP002：六维 0–4 游戏性量表（含证据字段）、单关规格模板、AFK/无 FOMO 契约、评审 Gate 与 GP004–GP007 DoD | 已完成 |
| [0.8.0-STAGES.md](0.8.0-STAGES.md) | GP005/GP006：S1–S3 手工关卡设计规格（学习目标/路线/卷轴/失败复盘/求解证据） | 已完成，坐标与实现对齐 |
| [stages-0.8.json](stages-0.8.json) | S1–S3 机器可读关卡数据（页内 `STAGES-JSON` 标记块同源） | 已冻结（sha256 `432C8AB2…`） |
| [0.8.0-TESTING.md](0.8.0-TESTING.md) | GP003：两层测试基座（`arcade_smoke.mjs` 全链路回归 + `arcade_gameplay_test.mjs` 确定性场景）、场景协议、seed 契约与扩展方法 | 已完成（11 场景） |
| [0.8.0-REVIEW.md](0.8.0-REVIEW.md) | GP007：独立 Reviewer 结论（Blocker/Major/Minor/UNVERIFIED）与逐条验收对照 | 已完成：APPROVE-WITH-NOTES（0 Blocker / 2 Major closed / 6 Minor 已由 Lead 收尾） |
| [0.8.0-PLAYTEST.md](0.8.0-PLAYTEST.md) | GP007：Owner 两轮试玩脚本、观察问题清单与截图 | **待 Owner 试玩（Agent 不可代签，发布门槛未通过）** |

约定：

- 本目录文档为中文；引用仓库文件用相对路径，引用外部任务包只写章节号（任务包不入库）。
- 基线事实以 `5fbe897` 为准；并行 Worker 的未提交改动不写入事实文档，除非另有说明。
- 任何“已实现/通过”的结论都必须附源码位置或命令结果；未验证项标 `UNVERIFIED`。
- 不覆盖任何 DONE 任务（T001–T033），不修改 `tasks/queue.json`、`TASKS.md` 或版本号；0.8.0 竖切片的仓库任务登记为 T034–T040（见 `0.8.0-PLAN.md`）。
- 0.8.0 竖切片未发布：`apps/arcade` 的 `ARCADE_VERSION` 保持 `0.7.0`，发布与否由 Owner 决定（见 `0.8.0-PLAYTEST.md`）。
