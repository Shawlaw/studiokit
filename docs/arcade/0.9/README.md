# StudioKit Arcade 0.9 · 78 关关卡设计包

> **状态（2026-11-22 更新）：本包已全部导入并落地。** 目录版本 `0.9` 指**设计包版本**，不是应用版本——它在应用 **Arcade 0.8.0** 中实现为 13 款游戏各 6 关的挑战模式（共 78 关），并由后续版本持续修复公平性问题。
>
> 本文档下方「设计候选包 / 尚未开发」的历史声明属于导入时（2026-11-13）的状态，**现已过期**，保留仅为记录当时的边界与理由。
>
> - 设计源（唯一权威）：本目录的 `levels/` 与 `docs/`，改设计必须改 `scripts/build_pack.py` 后重新生成。
> - 运行时数据（由设计源生成，不含参考解）：`apps/arcade/challenge/<gameId>.js`
> - 当前用户可见行为与挑战玩法：`apps/arcade/README.md`
> - 落地实施记录与设计差量：`impl/`、`INTEGRATION-CONTRACT.md`、`DATA-INTEGRATION-REPORT.md`
> - 全目录索引与未决项：`docs/arcade/README.md`

## 交付清单

| 文件 | 内容 |
| --- | --- |
| `levels/<game>.json`（13 个） | 每款 6 关的机器可读设计：玩家目标、学习技巧、探索奖励、地图 / 棋盘 / 事件脚本、参考通关、失败 / 移动端 / AFK 验收 |
| `levels/stages/<game>-Cxx.json`（78 个） | 单关原子数据，供任务卡逐关引用 |
| `docs/LEVEL-INDEX.md` | 78 关总览 |
| `docs/<game>.md`（13 个） | 逐关完整的人类可读设计 |
| `docs/01-PRODUCT-AND-LEARNING.md` | 游戏性的统一方法与关卡组合原则 |
| `docs/02-INTEGRATION-AND-SCHEMA.md` | 坐标、模式、状态迁移、适配接口与校验范围 |
| `docs/03-MOBILE-AFK-ACCESSIBILITY.md` | 触摸、暂停与中断、可访问性细则 |
| `docs/04-PLAYTEST-QUALITY-GATES.md` | 自动 / 人工验收分类、发布准入与证据模板 |
| `docs/05-0.8-TO-0.9-MIGRATION.md` | 并行开发安全边界与差异核对步骤 |
| `docs/06-BALANCE-AND-REVIEW.md` | 实际调参与失败反馈、Owner 试玩阶段 |
| `PACK-MANIFEST.json` | 版本、数量与数据源清单 |
| `LEVEL-ATLAS.html` | 无需联网、无 CDN 的交互式 78 关布局图谱（双击本地浏览器打开；不是游戏运行截图） |
| `SHA256SUMS.txt` | 原始导入校验和 |
| `scripts/build_pack.py` | 设计数据源与生成器；**改设计先改这里**，再重跑 build → render → validate |
| `scripts/render_docs.py` | 由 JSON 生成蓝图、单关文件与候选任务清单（只写本目录内文件） |
| `scripts/render_atlas.py` | 由最新关卡数据重新生成离线图谱 |
| `scripts/validate_levels.py` | 零依赖内容校验与简化解答复放 |
| `INTEGRATION-CONTRACT.md` | 唯一技术契约：数据文件、`A.Challenge` API、记录 key、UI / 流程、证据等级 |
| `DATA-INTEGRATION-REPORT.md` | 13 份数据生成 / 校验报告（sha256、字段取舍、重跑命令） |
| `impl/<game>.md`（13 个） | 各游戏实现记录：支持字段、证据等级、设计差量、UNVERIFIED |
| `tasks/PROPOSED-QUEUE-NOT-IMPORTED.json` | 84 张**仅建议**任务卡；从未导入 `tasks/queue.json` |

导入记录、任务映射、验收清单、独立评审与试玩包属于**已完成周期的过程记录**，已归档到 `docs/archive/`：

| 归档文件 | 内容 |
| --- | --- |
| [`../../archive/arcade-0.9-00-IMPORT-AND-STATUS.md`](../../archive/arcade-0.9-00-IMPORT-AND-STATUS.md) | 导入记录（SHA-256）、内容清单与已核实事实 |
| [`../../archive/arcade-0.9-0.8-TO-0.9-DIFF.md`](../../archive/arcade-0.9-0.8-TO-0.9-DIFF.md) | 0.8.0 实际代码与设计包的差异、冲突保护、需 Owner 决策点 |
| [`../../archive/arcade-0.9-PLAN.md`](../../archive/arcade-0.9-PLAN.md) | `GP`/`LD` 任务 → 仓库 `T041–T058` 映射、并行波次与风险 |
| [`../../archive/arcade-0.9-QA-REPORT.md`](../../archive/arcade-0.9-QA-REPORT.md) | 设计包自检输出、已修正的设计缺陷、尚待物理验证的风险 |
| [`../../archive/arcade-0.9-TESTING.md`](../../archive/arcade-0.9-TESTING.md) | 挑战场景协议与聚合结果 |
| [`../../archive/arcade-0.9-REVIEW.md`](../../archive/arcade-0.9-REVIEW.md) | 独立评审结论与设计差量 |
| [`../../archive/arcade-0.9-PLAYTEST.md`](../../archive/arcade-0.9-PLAYTEST.md) | Owner 试玩包（结论未收集） |
| [`../../archive/arcade-0.9-FLASH-START.md`](../../archive/arcade-0.9-FLASH-START.md) | 面向低成本 Flash Agent 的执行 Prompt（历史） |

## 阅读顺序

给 Owner 与 Agent 的建议路径：

1. 本 README 的「状态」段，然后 [`../../archive/arcade-0.9-00-IMPORT-AND-STATUS.md`](../../archive/arcade-0.9-00-IMPORT-AND-STATUS.md) 确认包的内容边界。
2. `docs/LEVEL-INDEX.md` 浏览 78 关的主题、技巧与探索差异。
3. 目标游戏的 `docs/<game>.md` 与 `levels/stages/<game>-Cxx.json`。
4. `INTEGRATION-CONTRACT.md` + `docs/02-INTEGRATION-AND-SCHEMA.md` + `docs/03-MOBILE-AFK-ACCESSIBILITY.md`。
5. `DATA-INTEGRATION-REPORT.md` 看生成结果，`impl/` 看实际落地与差量，[`../../archive/arcade-0.9-REVIEW.md`](../../archive/arcade-0.9-REVIEW.md) / [`../../archive/arcade-0.9-PLAYTEST.md`](../../archive/arcade-0.9-PLAYTEST.md) 看评审结论与未决项。

## 数据流与落地位置

```text
scripts/build_pack.py      ← 设计源（改设计只改这里）
        │
        ├── levels/<game>.json       （13 × 6 关，设计源）
        ├── levels/stages/*.json     （78 个单关原子数据）
        └── docs/<game>.md           （人类可读蓝图，由 render_docs.py 生成）

levels/<game>.json
        │  tools/arcade_09_data.mjs（结构校验 + 复核本包 1088 断言）
        └── apps/arcade/challenge/<game>.js  →  window.ArcadeChallengeData（不含参考解）
```

## 已证明与未证明

**已由构建与门禁机械验证**：78 关数量与关卡编号序列、必填设计字段、世界坐标界限、地图与参考答案存在、方块参考落点清行、2048 合并结果、贪吃蛇路径包含真实蛇身、四车道离散转移序列、记忆配对完备性、矿工价值与直线先触达障碍、关卡事件时间序列约束。运行时数据已不含 `referencePlan` / `acceptance`（`validate_site.py` 会拦）。

**已在《影跃》等游戏用确定性回放验证**：关卡在该引擎真实物理下可达、S3 必须使用影冲、错误冲刺可回收、卷轴为可选内容（`tools/arcade_stage_solver.mjs`）。

**仍未被证明**：真机触控手感与帧率；部分设计差量（影门半径、砖块 C03/C06 钥匙可达性、重力翻转安全窗口、层塔确定性初始角速度、星海 Boss 弱点时机、矿工禁用经典道具、打地鼠与赛车道具简化）尚未由 Owner 裁决；0.9.0 只修运行时判定而未重做关卡几何，内容密度问题（俄罗斯方块 C04 与 C03 落点重复、2048 C05 一步可解、影跃参考通关 1.9–4.5 秒）仍待改设计源。

**设计布局 ≠ 已完成关卡开发**：本包适合让 Agent 做工程落地、让 Reviewer 检查公平性、让 Owner 判断是否好玩，三者不能互相替代。

## 风格约束

**不沉迷设计**：无签到、无日常登录、无失效奖励、无体力、无强制在线排行榜、无跨局战力压迫。每关可随时暂停、刷新与恢复，不玩没有损失。难度来自选择与技巧，不是偷袭、纯 RNG 或对触屏不友好。

## 命令

```powershell
# 在本目录内执行（零联网、零第三方 Python 包）
py -3 scripts\validate_levels.py

# 需要重新生成衍生 JSON / Markdown / 图谱时：先改 scripts\build_pack.py
py -3 scripts\build_pack.py
py -3 scripts\render_docs.py
py -3 scripts\render_atlas.py
py -3 scripts\validate_levels.py
```

本包**从未**导入 `tasks/PROPOSED-QUEUE-NOT-IMPORTED.json`，也不修改 `TASKS.md` 或 `tasks/queue.json`；实际落地的仓库任务是 `T041–T058`（见 `PLAN.md`）。
