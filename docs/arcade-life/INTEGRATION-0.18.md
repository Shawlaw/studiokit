# Arcade 0.18.0 集成与验证（星塔回响）

- 分支：`feat/arcade-life-015`（本地，未推送、未发布）
- 基线：0.17.0（G17 PASS）；目标：0.18.0
- 契约/设计：ADR §20、`apps/arcade/DESIGN-0.18.0.md`、`PLAYTEST-018.md`
- 证据：仓库外 `qa/evidence/D18-*.md`；G18 摘要 `G18-EVIDENCE.md`

## 1. 交付

- 六章 C0–C5 内容与状态机（campaign-core）、三终局一次性汇合（ending-reducer）、章节/终局 UI（world-state）。
- 内容：campaign/chapter-00..05/ending-combat|research|rescue/npc/side-stories。
- 入口：信箱「旧港来信 · 章节」；中心页 C0 后一行小字回流入口（`?story=1`）。
- 修复：C0 信箱旗标、终局跨页事件缓冲（adopt/attach）、路线完成展示、mustKnow/正文/NPC 渲染、C1 代办路线。

## 2. 版本链 0.18.0

- engine/sw（`studiokit-arcade-0.18.0-v1`）/index/tool-registry/5+ 内容 JSON/career 模块/validate/7+ 测试断言。
- SW CORE_PATHS 含 campaign-core/ending-reducer/world-state/全部 0.18 内容；verify_deploy PATHS 同步。

## 3. 验证结果

| 类别 | 结果 |
|---|---|
| campaign-core | 53/53（六章/三终局/48 路径要求/坏内容） |
| ending-reducer | 34/34（一次性 C5、幂等、失败可重试、经济等价） |
| graph 可达 | **48/48 路径、死锁 0**、T4–T6 顺序 16/16 |
| world-state | 109/109（六章/终局/后日谈/降级/320–430/焦点/媒体） |
| campaign E2E | **701/701**：3 条路线 C0→C5、三终局真实结算、备份恢复 24/24、经典 5 键逐字节 |
| 0.17 回归 | 96/96 tiers、resume 45/45、mobile 318、PWA 17、a11y 75、smoke 113、review 5/5、gameplay 104/104（G18 复跑） |
| 待跑 | 0.18 全聚合门禁与 G18 独立复核；真机/读屏器/PWA 安装态 UNVERIFIED |

## 4. 已知问题（PLAYTEST-018）

- I4：章节完成无全局即时反馈（面板/收据侧可见）；I3：展示路线与产证仍有内容差异（E2E 用受控种子）。
- I1：首次进入仍依赖新线索 chip；C0 后已有中心页小字回流入口。
- 刷新清空本页事件缓冲；终局跨页已 attach，未结算进度需重打。

## 5. 未发布声明

仅本地分支提交；远端 `main` 仍 `afc5fd4`，无 push/tag/部署；发布需 Owner `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`。
