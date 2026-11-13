# Arcade 0.9 Level Design Pack · 导入记录与当前状态

> 本目录是外部设计交付包 `StudioKit-Arcade-0.9-Level-Design-78-Stages.zip` 的**原样导入副本**（设计源，不是实现，不进入发布产物）。
> 原始包 SHA-256：`B528BA4E4D734B2CFC128CD7DD748A617F60BF5F520EB8DEB3A6E62846153D79`
> 导入日期：2026-11-13；来源：Owner 提供的本地任务包。

## 1. 内容清单（未改动）

| 路径 | 内容 |
| --- | --- |
| `README.md` / `FLASH-START.md` / `PACK-MANIFEST.json` / `QA-REPORT.md` / `SHA256SUMS.txt` | 交付包的原始说明、执行 Prompt、清单、自检报告与校验和 |
| `docs/01..06-*.md` | 产品/学习曲线、集成与 Schema、移动端与 AFK、验收门禁、0.8→0.9 迁移治理、平衡与评审 |
| `docs/<game>.md`（13 个） | 每款游戏六关的人类可读蓝图 |
| `levels/<game>.json`（13 个） | 每款游戏 6 关的机器可读设计（含 content / referencePlan / acceptance / integration） |
| `levels/stages/<game>-Cxx.json`（78 个） | 单关原子数据（任务卡引用） |
| `scripts/validate_levels.py` | 独立内容校验（零依赖，1088 条断言） |
| `scripts/build_pack.py` / `render_docs.py` / `render_atlas.py` | 设计源生成/渲染脚本（只在包目录内写文件） |
| `tasks/PROPOSED-QUEUE-NOT-IMPORTED.json` | 仅建议的 84 张任务卡，**未导入** `tasks/queue.json` |
| `LEVEL-ATLAS.html` | 离线 78 关布局图谱（双击即可浏览，无 CDN） |

## 2. 已验证事实

```text
Content pack: 13 games, 78 stages
  design-contract: 234 assertions
  exact-simulation: 454 assertions
  geometry: 220 assertions
  inventory: 117 assertions
  ray-clearance: 51 assertions
  timeline: 12 assertions
PASS: content contract and reference checks. NOT an original-engine physics or mobile playtest.
```

- 设计包自检：`py -3 docs\arcade\0.9\scripts\validate_levels.py` → PASS（1088 断言）。
- 设计包**不证明**真实引擎物理、移动端、可玩性；这些由本仓库的实现与测试补齐（见 `INTEGRATION-CONTRACT.md` 与各游戏 `impl/<gameId>.md`）。

## 3. 当前落地方式

- 设计源保留在原样路径，**不改动**；运行时数据由 `tools/arcade_09_data.mjs` 从 `levels/*.json` 生成到 `apps/arcade/challenge/<gameId>.js`（生成物入库，静态站点无构建步骤）。
- 集成约定见 [INTEGRATION-CONTRACT.md](INTEGRATION-CONTRACT.md)，差异报告见 [0.8-TO-0.9-DIFF.md](0.8-TO-0.9-DIFF.md)，任务映射见 [PLAN.md](PLAN.md)。
- 0.9 关卡是**挑战模式**增量：经典/无尽、旧高分与旧存档不被改写；`ARCADE_VERSION` 未升版（0.8/0.9 均未发布）。
- 发布仍需 Owner 授权；Owner 试玩门槛见 [../0.8.0-PLAYTEST.md](../0.8.0-PLAYTEST.md) 与各游戏 `impl/<gameId>.md` 的 UNVERIFIED 列表。
