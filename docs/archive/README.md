# 归档文档（`docs/archive/`）

本目录保存**已完成周期的一次性过程记录**：并行实施契约、独立评审、事实冻结、规划与试玩包、冒烟清单等。它们不再是当前工作的入口，只为保留可追溯的证据链。

## 为什么归档而不是删除

- 项目约定要求「任何『已实现 / 已通过』的结论都必须附源码位置或命令结果」，`TASKS.md` 与 `tasks/queue.json` 的历史任务把本目录文件登记为证据。
- 这些文件记录的**当时的判断依据**（例如某次回归的根因、某关设计的取舍）不宜改写，改写就等于篡改历史。
- 因此它们从 `docs/arcade/` 移到这里，正文与内部相对链接保持可用；**当前状态一律以现行文档为准**。

## 归档原则

1. 一个版本发布后，其过程中的**规划 / 契约 / 评审 / 试玩包**归档；**设计与回滚说明不归档**，留在 `apps/arcade/DESIGN-*.md`（面向使用者、随站点发布）。
2. **设计源与生成产物不归档**：`docs/arcade/0.9/levels/`、`docs/arcade/0.9/scripts/`、`docs/arcade/0.9/docs/`、`docs/arcade/0.9/impl/`、`docs/arcade/0.9/tasks/`、`docs/arcade/0.9/PACK-MANIFEST.json`、`docs/arcade/0.9/SHA256SUMS.txt`、`docs/arcade/0.9/LEVEL-ATLAS.html` 仍被 `tools/arcade_09_data.mjs`、`tools/arcade_design_check.py` 等门禁读取，删改会让门禁失败。
3. **现行基准不归档**：`docs/BASELINE.md`、`docs/DECISIONS.md`、`docs/ARCHITECTURE.md`、`docs/ADD-A-TOOL.md`、`docs/RELEASE-RUNBOOK.md`、`docs/ROADMAP.md`、`docs/arcade/stages-0.8.json`（被 `tools/arcade_stage_solver.mjs` 读取）、`docs/arcade/GAMEPLAY-DESIGN-RUBRIC.md`（可复用的游戏性量表）。
4. 归档文件不再更新；如需新结论，写进现行的 `CHANGELOG.md`、`DESIGN-*.md` 或 `docs/BASELINE.md`。

## 内容索引

| 文件 | 说明 |
| --- | --- |
| [`0.8.0-PLAN.md`](0.8.0-PLAN.md) | 0.8.0 竖切片的 `GPxxx` → `Txxx` 任务映射与执行边界 |
| [`0.8.0-FACTS.md`](0.8.0-FACTS.md) | GP001 事实冻结（基线 HEAD `5fbe897`）：13 款游戏现状逐条核实、`#test` 钩子与测试入口 |
| [`0.8.0-STAGES.md`](0.8.0-STAGES.md) | GP005 / GP006：《影跃》S1–S3 手工关卡设计规格 |
| [`0.8.0-TESTING.md`](0.8.0-TESTING.md) | GP003 两层测试基座（全链路回归 + 确定性玩法场景）的协议与扩展方法 |
| [`0.8.0-REVIEW.md`](0.8.0-REVIEW.md) | GP007 独立评审：Blocker / Major / Minor / UNVERIFIED 与逐条验收对照 |
| [`0.8.0-PLAYTEST.md`](0.8.0-PLAYTEST.md) | GP007 Owner 试玩脚本与观察清单（**试玩结论始终未收集**，见下） |
| [`0.8.1-CONTRACT.md`](0.8.1-CONTRACT.md) | 0.8.1 并行实施契约：积分记录数据模型、`A.Scores` API、禅模式状态机 |
| [`0.8.1-REVIEW.md`](0.8.1-REVIEW.md) | 0.8.1 发布前独立评审 |
| [`0.8.2-CONTRACT.md`](0.8.2-CONTRACT.md) | 0.8.2 并行实施契约：俄罗斯方块控制区压缩规格 |
| [`0.8.2-REVIEW.md`](0.8.2-REVIEW.md) | 0.8.2 发布前独立评审与真实输入探针结论 |
| [`0.9.0-REVIEW.md`](0.9.0-REVIEW.md) | 0.9.0 发布前独立评审（16 款游戏 + 10 项修复 + 三款新棋牌） |
| [`arcade-0.9-00-IMPORT-AND-STATUS.md`](arcade-0.9-00-IMPORT-AND-STATUS.md) | 0.9 关卡设计包导入记录（SHA-256）与内容清单 |
| [`arcade-0.9-0.8-TO-0.9-DIFF.md`](arcade-0.9-0.8-TO-0.9-DIFF.md) | 0.8.0 实际代码与 0.9 设计包的差异、冲突保护、需 Owner 决策点 |
| [`arcade-0.9-PLAN.md`](arcade-0.9-PLAN.md) | 设计包落地任务的波次与 DoD |
| [`arcade-0.9-TESTING.md`](arcade-0.9-TESTING.md) | 挑战场景模块协议、证据等级与聚合结果 |
| [`arcade-0.9-REVIEW.md`](arcade-0.9-REVIEW.md) | 设计包落地的独立评审 |
| [`arcade-0.9-PLAYTEST.md`](arcade-0.9-PLAYTEST.md) | Owner 试玩包（**结论同样未收集**） |
| [`arcade-0.9-QA-REPORT.md`](arcade-0.9-QA-REPORT.md) | 设计包自带校验输出与尚待物理验证的风险 |
| [`arcade-0.9-FLASH-START.md`](arcade-0.9-FLASH-START.md) | 面向低成本 Agent 的执行 Prompt（历史） |

## 仍然有效的结论

归档不等于结论作废。相关结论已经沉淀到这些**现行**文档：

- 逐版变更、门禁与发布证据 → `apps/arcade/CHANGELOG.md`
- 逐版设计、数值、兼容与回滚 → `apps/arcade/DESIGN-*.md`
- 当前基线事实（版本 / Schema / 存储键 / 验收覆盖）→ `docs/BASELINE.md`
- 78 关设计源与实施差异 → `docs/arcade/0.9/`（设计源、`impl/`）与 `apps/arcade/README.md`
- 任务与证据登记 → `TASKS.md` / `tasks/queue.json`

**未决项提醒：** 0.8.0 竖切片的 Owner 试玩门槛（`TASKS.md` T039）始终未收集，归档不会改变这一点——它仍然是一个未通过的验收环节，不是已完成事项。
