# Arcade 文档索引

本目录保存 Arcade 各版本的设计/验收支撑文档，不是产品文档，也不进入发布产物（`tools/build_site.py` 的白名单只含 `index.html`、`favicon.svg`、`shared`、`apps`）。

## 0.8.1（俄罗斯方块禅模式 + 积分记录表；已发布）

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [0.8.1-CONTRACT.md](0.8.1-CONTRACT.md) | 并行实施契约：积分记录数据模型、`A.Scores`/`Progress.recordPlay` API、禅模式状态机与 `#test` 钩子、中心页表格、测试与文件所有权 | 已执行（0.8.1 发布） |
| [0.8.1-REVIEW.md](0.8.1-REVIEW.md) | 独立 Reviewer 发布前评审：结论、Blocker/Major/Minor、UNVERIFIED 与 DoD 对照；附 Lead 处理记录（M1/M2/Minor 闭环） | 评审完成，发布前修复已闭环 |
| `apps/arcade/DESIGN-0.8.1.md` | 面向使用者的设计/数值/数据模型/兼容/回滚说明（发布产物内） | 已随 0.8.1 发布 |

发布证据（0.8.1）：提交 `575a766`（功能）+ `41fa79e`（评审修复）推送 `main`；Actions `43423208129` 四个 job 全成功；CI 与本地 `verify_deploy.py` 均 37/37 文件双端一致（Arcade `0.8.1` / Badge `2.2.1`）；双端线上无头 Chrome 10/10。

## 0.8.0 竖切片（已随 0.8.0 发布）

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

## 0.9 关卡设计包落地（随 Arcade 0.8.0 发布；目录版本指设计包）

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [0.9/00-IMPORT-AND-STATUS.md](0.9/00-IMPORT-AND-STATUS.md) | 设计包导入记录（SHA-256）、内容清单、已验证事实与落地方式 | 已完成 |
| [0.9/0.8-TO-0.9-DIFF.md](0.9/0.8-TO-0.9-DIFF.md) | 0.8.0 实际代码 vs 0.9 设计差异、冲突保护、需 Owner 决策点 | 已完成 |
| [0.9/INTEGRATION-CONTRACT.md](0.9/INTEGRATION-CONTRACT.md) | 唯一技术契约：数据文件、A.Challenge API、记录 key、UI/流程、测试与证据等级、平台清单 | 已完成 |
| [0.9/PLAN.md](0.9/PLAN.md) | GP/LD90 → T041–T058 任务映射、并行波次、DoD 与风险 | 已完成 |
| [0.9/LEVEL-INDEX.md](0.9/LEVEL-INDEX.md) / [0.9/docs/](0.9/docs/) | 设计包原始 78 关索引与 13 份逐关蓝图（只读源） | 原样导入 |
| [0.9/DATA-INTEGRATION-REPORT.md](0.9/DATA-INTEGRATION-REPORT.md) | 13 关数据生成/校验报告（sha256、字段取舍、重跑命令） | 已完成（幂等，2128 自检 + 1088 设计断言） |
| [0.9/TESTING.md](0.9/TESTING.md) | 挑战场景模块协议、证据等级、运行命令与聚合结果 | 已完成（104 场景 ×2 = 208/208，798s） |
| [0.9/impl/](0.9/impl/) | 各游戏实现记录：支持字段、证据等级、设计差异、UNVERIFIED | 已完成（13/13） |
| [0.9/REVIEW.md](0.9/REVIEW.md) / [0.9/PLAYTEST.md](0.9/PLAYTEST.md) | 独立评审与 Owner 试玩包 | 评审完成（0 Blocker / 设计差异待 Owner 裁决）；Owner 门槛不可代签 |

约定：

- 本目录文档为中文；引用仓库文件用相对路径，引用外部任务包只写章节号（任务包不入库）。
- 基线事实以 `5fbe897` 为准；并行 Worker 的未提交改动不写入事实文档，除非另有说明。
- 任何“已实现/通过”的结论都必须附源码位置或命令结果；未验证项标 `UNVERIFIED`。
- 不覆盖任何 DONE 任务（T001–T033），不修改 `tasks/queue.json`、`TASKS.md` 或版本号；0.8.0 竖切片的仓库任务登记为 T034–T040（见 `0.8.0-PLAN.md`）。
- 0.8.0 已双端发布；`apps/arcade` 的 `ARCADE_VERSION` 为 `0.8.0`。Owner 试玩与 5 项设计差量裁决仍待收集（见 `0.8.0-PLAYTEST.md`、`0.9/PLAYTEST.md`）。
