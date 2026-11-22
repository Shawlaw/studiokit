# Arcade 设计与证据索引（`docs/arcade/`）

本目录保存 Arcade 的**现行**设计支撑材料与 78 关关卡设计源；已完成周期的一次性过程记录已移入 [`docs/archive/`](../archive/README.md)。

> **本目录不进入发布产物。** `tools/build_site.py` 的白名单只有 `index.html`、`favicon.svg`、`shared/`、`apps/`。
>
> 想找什么：
> - **当前版本与用户可见行为** → [`apps/arcade/README.md`](../../apps/arcade/README.md)
> - **逐版设计、数值、兼容与回滚** → `apps/arcade/DESIGN-*.md`（索引见 [apps/arcade/README.md § 版本与设计档案](../../apps/arcade/README.md#版本与设计档案)）
> - **逐版变更与门禁证据** → [`apps/arcade/CHANGELOG.md`](../../apps/arcade/CHANGELOG.md)
> - **当前已发布基线事实** → [`docs/BASELINE.md`](../BASELINE.md)
> - **已完成周期的契约 / 评审 / 试玩包** → [`docs/archive/`](../archive/README.md)
> - **任务、证据与未决项** → [`TASKS.md`](../../TASKS.md)

## 文档分层

| 位置 | 角色 | 是否发布 |
| --- | --- | --- |
| `apps/arcade/DESIGN-*.md` | 面向使用者的逐版设计说明（数值、兼容、回滚） | ✅ 随站点发布 |
| `apps/arcade/CHANGELOG.md` | 逐版变更、门禁结果与发布证据 | ✅ 随站点发布 |
| `docs/arcade/stages-0.8.json` | 《影跃》S1–S3 机器可读关卡数据（`tools/arcade_stage_solver.mjs` 读取） | ❌ 仅仓库 |
| `docs/arcade/GAMEPLAY-DESIGN-RUBRIC.md` | 六维 0–4 游戏性量表、单关规格模板、AFK / 无 FOMO 契约 | ❌ 仅仓库 |
| `docs/arcade/0.9/` | 78 关关卡设计包（设计源 + 生成器 + 离线图谱 + 设计文档 + 实施记录） | ❌ 仅仓库 |
| `docs/archive/` | 已完成周期的规划 / 契约 / 评审 / 试玩包 | ❌ 仅仓库 |
| `tools/` | 生成、校验与无头浏览器门禁脚本 | ❌ 仅仓库 |

## 可复用的设计工具

- [`GAMEPLAY-DESIGN-RUBRIC.md`](GAMEPLAY-DESIGN-RUBRIC.md)：新增机制或关卡时用来判断「怎样才算有游戏性、需要什么证据、什么情况必须驳回」。它不是玩法承诺，是验收工具。
- [`stages-0.8.json`](stages-0.8.json)：《影跃》S1–S3 关卡的机器可读数据，与页面内 `STAGES-JSON` 标记块同源；`tools/arcade_stage_solver.mjs` 用它独立复算可达性。

## 0.9 关卡设计包

目录版本 `0.9` 指**设计包版本**，不是应用版本——它在应用 `0.8.0` 中落地为 13 款游戏的挑战模式，每款 6 关，共 78 关。设计源是唯一权威，运行时数据由它生成。

- 入口与阅读顺序：[`0.9/README.md`](0.9/README.md)
- 78 关总览：[`0.9/docs/LEVEL-INDEX.md`](0.9/docs/LEVEL-INDEX.md)
- 逐关蓝图：[`0.9/docs/`](0.9/docs/)
- 集成契约：[`0.9/INTEGRATION-CONTRACT.md`](0.9/INTEGRATION-CONTRACT.md)
- 数据与实施：[`0.9/DATA-INTEGRATION-REPORT.md`](0.9/DATA-INTEGRATION-REPORT.md)、[`0.9/impl/`](0.9/impl/)
- 校验清单 / 评审 / 试玩包：[`../archive/arcade-0.9-QA-REPORT.md`](../archive/arcade-0.9-QA-REPORT.md)、[`../archive/arcade-0.9-TESTING.md`](../archive/arcade-0.9-TESTING.md)、[`../archive/arcade-0.9-REVIEW.md`](../archive/arcade-0.9-REVIEW.md)、[`../archive/arcade-0.9-PLAYTEST.md`](../archive/arcade-0.9-PLAYTEST.md)
- 离线图谱：[`0.9/LEVEL-ATLAS.html`](0.9/LEVEL-ATLAS.html)（双击本地打开，无联网、无 CDN）

**数据流**：`docs/arcade/0.9/levels/<gameId>.json`（设计源，只读）→ `tools/arcade_09_data.mjs` 校验 → `apps/arcade/challenge/<gameId>.js`（运行时数据，不含参考解）。

`docs/arcade/0.9/` 里的生成产物由 `tools/arcade_design_check.py` 守住：它会在临时副本里重跑四个生成器，逐字比对已提交文件。因此**不要手改** `levels/stages/`、`docs/<game>.md`、`docs/LEVEL-INDEX.md`、`tasks/PROPOSED-QUEUE-NOT-IMPORTED.json`、`PACK-MANIFEST.json`、`LEVEL-ATLAS.html`。

## 未决项与证据等级

- **Owner 试玩门槛未收集。** [`../archive/0.8.0-PLAYTEST.md`](../archive/0.8.0-PLAYTEST.md) 与 [`../archive/arcade-0.9-PLAYTEST.md`](../archive/arcade-0.9-PLAYTEST.md) 的结论不能由 Agent 代签；`TASKS.md` 中 T039（0.8.0 GP007 Owner 试玩包）仍为 `BLOCKED`。0.8.0 及其后续版本是在 Owner 明确授权下发布的，**这不等同于试玩门槛已通过**。
- **真机能力一律 UNVERIFIED**：iOS / Android 触控手感、原生全屏、系统分享面板、PWA 安装与更新提示时机、低端机帧率。当前清单见 [apps/arcade/README.md § 已知边界](../../apps/arcade/README.md#已知边界)。
- **78 关存在待裁决的设计差量**（影跃影门半径、砖块 C03/C06 钥匙可达性、重力翻转安全窗口、层塔初始角速度、星海 Boss 弱点时机、矿工禁用经典道具、打地鼠与赛车简化道具等）。实现未擅自改设计源，差量登记在各 [`0.9/impl/`](0.9/impl/) 文档与 `DESIGN-0.9.0.md`。
- **0.9.0 只改运行时判定，未重做关卡几何**：俄罗斯方块 C04 与 C03 目标落点重复、2048 C05 一步可解、影跃参考通关 1.9–4.5 秒等内容密度问题仍存在，需改设计源后另行排期。
- **证据等级**：`real-input-replay` > `engine-replay` > `ui-only`。各游戏的实际等级登记在 [`0.9/impl/`](0.9/impl/)，`tools/arcade_stage_coverage.mjs` 汇总为 78 关覆盖矩阵——矩阵只登记证据等级，**不声称已通过**。

## 写作约定

1. 本目录文档为中文；引用仓库文件用相对路径，引用外部任务包只写章节号（任务包不入库）。
2. 任何「已实现 / 已通过」的结论必须附源码位置（`file:line` 或函数名）或可复跑的命令结果。
3. 未验证项标 `UNVERIFIED`，不得用「应该可以」「大概没问题」替代证据。
4. 事实文档以某个 commit 为基线，并显式写出该 commit；并行 Worker 的未提交改动不作为事实。
5. 不覆盖已 `DONE` 的任务，不修改 `tasks/queue.json`、`TASKS.md` 或版本号——这些由 Lead 在任务收尾时统一更新。
6. 设计源改动只走 `0.9/scripts/build_pack.py`，然后重跑 `build → render_docs → render_atlas → validate_levels`；不要直接手改衍生 JSON 或 HTML 图谱。
7. 一个版本发布后，把该版本的过程记录（规划 / 契约 / 评审 / 试玩包）移入 [`docs/archive/`](../archive/README.md)，设计说明留在 `DESIGN-*.md`。

## 校验命令

```powershell
# 78 关设计包：静态数据校验与简化解答复放（零外部依赖，路径相对脚本自身）
py -3 docs/arcade/0.9/scripts/validate_levels.py

# 设计源 → 运行时数据（幂等生成，不含参考解）
node tools/arcade_09_data.mjs

# 证据覆盖矩阵（只登记，不判定通过）
node tools/arcade_stage_coverage.mjs

# 在临时副本重跑生成器并与已提交文件逐字比对
py -3 tools/arcade_design_check.py

# 影跃 S1–S3 独立可达性求解
node tools/arcade_stage_solver.mjs --stages=docs/arcade/stages-0.8.json
```
