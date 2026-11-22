# Arcade 0.17.0 集成与验证（Living World）

- 分支：`feat/arcade-life-015`（本地，未推送、未发布）
- 基线：0.16.0（G16 PASS）；目标：0.17.0
- 契约：[`ADR-interfaces.md`](ADR-interfaces.md) §19；设计：[`DESIGN-0.17.0.md`](../../apps/arcade/DESIGN-0.17.0.md)；平衡：[`BALANCE-017.md`](BALANCE-017.md)
- 证据：仓库外 `qa/evidence/D17-*.md`；G17 摘要见 `docs/arcade-life/G17-EVIDENCE.md`（G17 后落盘）

## 1. 交付内容

- **96 委托**（`content/commissions.json`）：16 游戏 × T1–T6；T1–T3 公开，T4–T6 由 C3/C4/C5 旗标解锁；目标支持次数与 `minValue` 数值阈值。
- **16 游戏职业模式**：目标行、真实事件、职业收工、经典/挑战/禅/割草隔离、`serialize()` 门禁。
- **经济**：五材（建材/合金/电子元件/星晶/生物材料）、固定价差商店、`db.sellItems` 原子卖料、3 件模块/15 层制造、4 船价格不变；`crystal→starcrystal` 别名。
- **成长与证据**：16 职业学徒/熟练/专家、收据证据去重与 C2–C4、单职业路线规划。
- **UI**：告示板只列已解锁委托 + 商店/制造台入口；机库/钱包/收据沿用 0.16；中心页仍无生涯 CTA。

## 2. 版本链（0.17.0）

- `engine.js` `ARCADE_VERSION`、`sw.js` `VERSION` + `studiokit-arcade-0.17.0-v1`、`index.html` `data-hall-version`、`shared/tool-registry.json`、5 个 content JSON、career 模块默认版本、`validate_site.py`、`verify_deploy.PATHS`、7+ 测试断言。
- SW `CORE_PATHS` 与 `verify_deploy` 已含 `commission-schema/materials/crafting/professions/story-evidence/route-planner/ui/market/ui/workshop`。

## 3. 数据与兼容

- 复用 IDB `studiokit:arcade:career` v1（11 stores）；无 localStorage 新增；sessionStorage 仍仅 ticket/rental。
- `career-db` 新增 `sellItems`（单事务扣库存→加信用点→ledger `sale`）；`purchase` 支持 `costItems`；`getEquipment/writeEquipment/readLedger` 保持。
- `crystal` 0.16 库存读取时合并到 `starcrystal`；棱镜需求与扣料统一 `starcrystal`。
- 职业 run 不写 `runs:v1`/`meta:v1`/progress/scores/challenge/playtime 轮次；经典键逐字节回归。

## 4. 验证结果（本地，0.17.0 版本链）

| 类别 | 结果 |
|---|---|
| 96 委托回归 | `career_96_missions_test` **96/96 tiers、3792/3792 checks**，failure 归因 79 objective / 17 value，T4–T6 旗标 48/48 |
| fixture/schema | 内容 96/96、16/16 fixture 形状 PASS；schema 负例矩阵 21/21 |
| 纯 Node | materials 32/32、professions 213/213、story 90/90、route 214/214、balance 47/47、commission 61/61、combat 379/379、legacy 78/78、registry 90/90、discovery 84/84、entry 37/37 |
| Chrome 回归 | smoke 113/113、reachability 165/165、a11y 75/75、db 38/38、backup 34/34、PWA 离线 17/17、review 5/5、zen 14/14、calm 17/17、tower 23/23、interaction 5/5、immersive 32/32、pwa_update 9/9 |
| 待办 | 0.16 first-flight/resume/mobile 的 0.17 内容更新；G17 独立复跑；真机 UNVERIFIED |

> 0.17 期间修复：层塔职业 `finishRun` 写经典记录；影跃经典 `height.reached` 被 20m career 门禁误伤；雪铃复踩去重；DB `writeEquipment` 引用未定义 `isFiniteNumber`；棱镜 `crystal` 与 `starcrystal` 不一致；review 金样 46→55。

## 5. 已知风险 / UNVERIFIED

- 刷新清空本页事件缓冲（既有架构）：刷新前未结算进度不计功，ticket/run 可恢复。
- `minValidEngagement` 尚未被 runtime 消费：极短失败局仍可能拿参与薪资（无奖励），需 0.18 前评估。
- 96 条目标/时长基于内容候选值，真实玩家成功率/时长未标定；T6 3000/5000m 依赖 100m 里程碑事件。
- 真机触控/安全区/读屏器/PWA 安装更新、Safari/Firefox、真实断电：UNVERIFIED。

## 6. 未发布声明

本版只存在本地分支提交；远端 `main` 仍为 `afc5fd4`，无 push、tag、部署。任何公开合并/发布需 Owner 明确 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`。
