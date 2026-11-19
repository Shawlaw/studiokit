# Arcade 文档索引

本目录保存 Arcade 各版本的设计/验收支撑文档，不是产品文档，也不进入发布产物（`tools/build_site.py` 的白名单只含 `index.html`、`favicon.svg`、`shared`、`apps`）。

## 0.8.6（结算重选模式 + 贪吃蛇双拇指相对转向；2026-11-19 待发布）

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| `apps/arcade/DESIGN-0.8.6.md` | 13 款游戏结算回到模式选择、俄罗斯方块经典/禅模式完整复位、贪吃蛇左右相对转向与两级连点、四档竖屏布局、兼容与回滚 | 已实现，待发布 |
| `apps/arcade/CHANGELOG.md` / `apps/arcade/README.md` | 变更摘要、门禁与发布证据 | 随 0.8.6 更新 |

门禁：`arcade_smoke.mjs` **91/91**、`arcade_zen_scores_test.mjs` **14/14**、`arcade_gameplay_test.mjs --suite=base --repeat=2` **22/22**、`validate_site.py` / `build_site.py` / `node --check` 通过；320/375/390/430 双按钮布局通过，真机手感 UNVERIFIED。发布证据待双端核验后回填。

## 0.8.5（极速车道车流规则 + 贪吃蛇棋盘优先 + 积分记录消去层数；2026-11-19 已双端发布）

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| `apps/arcade/DESIGN-0.8.5.md` | 卡死根因（负圆角 `RangeError` → rAF 断链）、远景透视、转向灯换道与公平性、连超/加速带/维修箱/评价、贪吃蛇 360×430 与四向按钮、提速曲线、方块积分消去层数、兼容与逐文件回滚 | 已随 0.8.5 发布 |
| `apps/arcade/CHANGELOG.md` / `apps/arcade/README.md` | 变更摘要、门禁与发布证据 | 已随 0.8.5 发布 |

门禁：`arcade_smoke.mjs` **89/89**、`arcade_zen_scores_test.mjs` **14/14**、`arcade_gameplay_test.mjs --suite=base --repeat=2` **22/22**、`validate_site.py` / `build_site.py` / `node --check` 通过。

发布证据（0.8.5）：提交 `bdb1176..ee9b45b`（5 个提交：`cf8979e` 极速车道 / `211d8ca` 贪吃蛇 / `16a2a8b` 方块积分 / `35394a2` 测试 / `ee9b45b` 文档）推送 `main`；Actions `44472286080` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **38/38** 文件 SHA-256 双端一致（Arcade `0.8.5` / Badge `2.2.1` / Venue `0.2.0`，manifest `application/manifest+json`）；双端线上无头 Chrome **20/20**（中心页 0.8.5 + 13 卡、SW `VERSION 0.8.5`、极速车道地平线车身 6.43×9.96px + 打灯车 0→1 完成、贪吃蛇棋盘 309px + 4×58px 按钮 + 向下转向、方块运行时 0.8.5、0 console error）；SW 缓存键 `studiokit-arcade-0.8.5-v1`。

## 0.8.4（棋盘优先画布 + 道具坞 + 地铁单手暂停；2026-11-18 已双端发布）

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| `apps/arcade/DESIGN-0.8.4.md` | 棋盘优先画布 340×610、道具坞、拇指区暂停/双击暂停、五档占屏比实测、`.tool-icon` 冲突修复、矮视口回退、兼容与回滚 | 已随 0.8.4 发布 |
| `apps/arcade/CHANGELOG.md` / `apps/arcade/README.md` | 变更摘要、门禁与“未推送/未发布”说明 | 已随 0.8.4 发布 |

门禁：`arcade_smoke.mjs` **87/87**、`arcade_zen_scores_test.mjs` **14/14**、`arcade_gameplay_test.mjs --suite=base --repeat=2` **22/22**、`validate_site.py` / `build_site.py` / `node --check` 通过。

发布证据（0.8.4）：提交 `77cb02a..ecfdda4`（3 个提交：`853739c` 道具坞 / `0756490` 地铁单手暂停 / `ecfdda4` 棋盘优先画布）推送 `main`；Actions `44122372096` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **38/38** 文件 SHA-256 双端一致（Arcade `0.8.4` / Badge `2.2.1` / Venue `0.2.0`，manifest `application/manifest+json`）；双端线上无头 Chrome **18/18**（中心页 0.8.4 + 13 卡、SW VERSION 0.8.4、方块页运行时 0.8.4、390×844 棋盘 257×513、道具坞 3 格含暂停 / 禅模式 4 格含冻结、触屏 hint 隐藏、0 console error）；SW 缓存键 `studiokit-arcade-0.8.4-v1`。

## 0.8.3（共享 shell Android 顶部导航条空白修复；已发布）

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| `apps/arcade/CHANGELOG.md` / `apps/arcade/README.md` | 根因、修复、兼容与门禁 | 已随 0.8.3 发布 |
| [../DECISIONS.md](../DECISIONS.md) ADR-0007 | 顶部安全区只在独立窗口应用 | 已接受 |

发布证据（0.8.3）：提交 `c1727e7` 推送 `main`；Actions `43670060561` 四个 job 全成功；CI 与本地 `verify_deploy.py` 均 37/37 文件双端一致（Arcade `0.8.3` / Badge `2.2.1`）；双端线上无头 Chrome 复测浏览器模式（40px 安全区下 shellbar 38px、文字居中）与独立窗口（78px），SW 缓存键 `studiokit-arcade-0.8.3-v1`，0 console error。

## 0.8.2（俄罗斯方块控制区压缩；已发布）

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [0.8.2-CONTRACT.md](0.8.2-CONTRACT.md) | 并行实施契约：控件压缩规格、冻结按钮并入道具行、画布高度回收、测试与发布要求 | 已执行（0.8.2 发布） |
| [0.8.2-REVIEW.md](0.8.2-REVIEW.md) | 独立 Reviewer 发布前评审：结论、Blocker/Major/Minor、UNVERIFIED 与 DoD 对照 | 评审文档 |
| `apps/arcade/DESIGN-0.8.2.md` | 面向使用者的前后画布对比、兼容与回滚说明（发布产物内） | 已随 0.8.2 发布 |

发布证据（0.8.2）：提交 `077ccf5` 推送 `main`；Actions `43447829596` 四个 job 全成功；CI 与本地 `verify_deploy.py` 均 37/37 文件双端一致（Arcade `0.8.2` / Badge `2.2.1`）；双端线上无头 Chrome 14/14（含五档画布增量、冻结按钮真实切换、结算写 zen 记录）。

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
