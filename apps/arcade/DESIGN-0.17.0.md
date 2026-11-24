# Arcade Life 0.17.0 设计、数值与回滚（本地未发布）

- 分支：`feat/arcade-life-015`；基线：0.16.0（G16 PASS）；目标：0.17.0
- 契约：[`ADR-interfaces.md`](../../docs/arcade-life/ADR-interfaces.md) §19；平衡：[`BALANCE-017.md`](../../docs/arcade-life/BALANCE-017.md)；集成：[`INTEGRATION-0.17.md`](../../docs/arcade-life/INTEGRATION-0.17.md)
- 证据：仓库外 `qa/evidence/D17-*.md`；独立门禁摘要 `docs/arcade-life/G17-EVIDENCE.md`（G17 后落盘）

## 1. 目标与边界

0.17「活世界」把 0.16 的首航切片扩到 **16 游戏 × 6 阶 = 96 委托**，加入五类材料、商店买卖、飞船模块制造、职业成长、剧情证据与单职业路线：

- **T1–T3（48 份）**：告示板可见、可直接接取；每份用真实游戏事件判定。
- **T4–T6（48 份）**：实现并用受控故事旗标 fixture 验证，但运行时由 `C3.truth_found` / `C4.city_power_restored` / `C5.star_tower_resolved` 解锁，0.17 不提前剧透。
- 仍无顶层生涯 CTA；仅从 LOCAL 线索信进入告示板；经典/挑战/禅/割草/旧星币与旧机库零改动。
- 不新增体力/燃料/签到/月卡/抽卡/离线计时；不新增 localStorage 键、不改 IDB v1 结构。

## 2. 运行时结构（新增）

| 文件 | 作用 |
|---|---|
| `career/commission-schema.js` | 96 条内容与 fixture 形状校验、事件目录、剧透/系统词检查 |
| `career/materials.js` | 五材目录/价差/别名（`crystal→starcrystal`）/来源与双来源校验 |
| `career/crafting.js` | 15 条模块配方、纯计划/预览、`MODULE_EFFECTS` |
| `career/professions.js` | 16 职业学徒/熟练/专家，只影响可选订单/展示 |
| `career/story-evidence.js` | 收据证据 token 白名单/去重/C2–C4 上下文 |
| `career/route-planner.js` | 任一起源 + 单职业主线路线与替代路径 |
| `career/ui/market.js` / `workshop.js` | 材料买卖 / 制造台 |
| `tools/career_mission_fixture_runner.mjs` | 16 fixture 装载与逐阶驱动 |
| `tools/career_96_missions_test.mjs` | 96 阶真实 Chrome 回归 |
| `tools/career_fixture_<game>.mjs` | 每游戏 6 阶成功/失败驱动 |

桥接：`bridge.js` 懒装载并公开 `api.materials/crafting/professions/storyEvidence/routePlanner` 与 `openMarket/openWorkshop`；结算成功后把收据证据交给 `storyEvidence.recordFromReceipt`（失败不影响结算）。告示板只列**当前已解锁**委托（16 条 T1 起步），完成 T1 后出现 T2。

## 3. 委托与经济

- 内容字段：`commissionId/gameId/professionId/tier/title/summary/objective/reward/repeatSalaryCredits/unlock/chapterGate`；`objective` 支持 `atLeast` 次数与 `minValue{field,value}` 数值阈值（距离/高度/格子值/连击）。
- 解锁链：T2←T1、T3←T2；T4←T3+C3、T5←T4+C4、T6←T5+C5。`career-core` 新增 `maxima` 摘要与 `value-not-met` 归因；`commission-core` 失败结算返回 `reached`。
- 首次奖励只发一次（claim/quest 去重）；每个新的有效 run 发 `repeatSalaryCredits`；首通信用点合计 3,305、重复薪资一轮 8,320，单局上限 130（cap 400）。
- 经济闭环：初始 80 → 3 份 T1 至少 290 → 旧翼 260（可跳过，免费租机）→ 云雀 480 / 盾鲸 520 / 棱镜 540；五材买/卖固定价差（卖价 ≤ 买价×0.6）；模块 15 层合计 2,680 + 材料；无拆解正利润、无负余额、无「卖→买→卖」套利。
- `crystal` 为 0.16 别名：读取库存合并到 `starcrystal`，棱镜需求与 DB 扣料统一到 `starcrystal`；旧 `crystal` 行不再产生新写入。

## 4. 真实事件与 16 游戏

0.17 统一事件目录见 ADR §19.4；新增事件均由真实状态提交点产生，避免 DOM/最高分反推：

- 记忆翻牌 `pair.match`/`session.finish`；2048 `tile.created{value}`；二十一点 `hand.settled`；五子棋 `move.legal`/`session.finish`；接龙 `stock.face_up`/`foundation.move`/`move.legal`；雪铃 `bell.unique`/`height.reached`；打砖块 `brick.destroyed`/`stage.clear`；重力翻转 `gravity.flip`/`distance.reached`；贪吃蛇 `fruit.eaten`；打地鼠 `mole.hit`/`combo.reached`；俄罗斯方块 `lines.cleared`；星海 `boss.defeated`（level/theme）/`wave.completed`；极速车道 `distance.reached`；影跃 `height.reached`/`scroll.collected`；层塔 `tower.floor_stable`；黄金矿工 `mineral.returned`。
- 职业隔离：职业 run 中 `serialize()=null`、autosave 四出口 no-op、不 `recordPlay`/Scores/挑战/GameMeta/RunSave；修复了 0.16 层塔 `finishRun` 仍写记录的缺口；挑战/禅/割草入口在职业 run 内不可进。
- 星海模块：`phase-shield`（一次短护盾）、`cargo-magnet`（磁吸 + 装甲代价）、`energy-cell`（能量上限 + 火力代价）由 `star-combat-config` 的生涯分支合并，经典/挑战/割草不生效。

## 5. 商店/制造/职业/证据

- 商店：买走 `db.purchase`（材料入账），卖走新增 `db.sellItems`（单事务扣库存→加信用点→ledger `kind:'sale'`，`saleId` 幂等）；UI 不提交价格，只消费 `materials` 计划；Payout 上限自动拆单并如实提示。
- 制造：`crafting.plan` 只算计划，UI 用 `db.purchase({cost,costItems,grants:{equipment:{'module:<id>:owned','module:<id>:level:<n>'}})`) 原子扣材料与信用点；已拥有/满级 noop；无拆解。
- 职业：0–2 学徒、3–5 熟练、≥6 专家（按已清委托/claims 去重）；只影响可选订单/展示，不自动通关、不改经典得分。
- 证据：只接受收据里的稳定 token（`E/MAP/BP/DEC-*`），去重、不可重放、不可消耗；C2–C4 规则支持多路径（研究/工程/贸易/非战斗），不把单一 gameId 作为唯一前置。
- 路线：`route-planner` 对 16×16 组合给出可执行路线或可解释 blockers；不买机可用免费租机；材料缺口可由市场/代办补齐。

## 6. 测试与门禁

- 纯 Node：materials **32/32**、professions **213/213**、story-evidence **90/90**、route-planner **214/214**、economy-balance **47/47**、commission 生命周期 **61/61**、combat **379/379**、legacy **78/78**、registry **90/90**、discovery **84/84**、entry **37/37**。
- fixture：runner `--validate` 内容 96/96、16/16 形状 PASS；`career_96_missions_test` **16 游戏 × 6 阶 = 96/96 tiers，3792/3792 checks**，含 success/failure/suspend/claim/幂等抽样。
- Chrome：db 38/38、backup 34/34、a11y 75/75、PWA 离线 17/17、reachability 165/165、smoke 113/113、review 5/5、zen 14/14、calm 17/17、layer tower 23/23、interaction 5/5、immersive 32/32、pwa_update 9/9；16 页线框/经典文案与局内档逐字节回归。
- 0.16 的 first-flight / resume / mobile 测试需按 0.17 内容与职业隔离更新（G17 前完成）。

## 7. 已知风险 / UNVERIFIED

- 事件缓冲 400/局：T6 高阈值（3000/5000m）依赖页面按 100m 里程碑发事件，避免溢出；真实高延迟设备待测。
- 刷新会清空本页内存事件缓冲（既有架构）：刷新前未结算的进度不计功；ticket/run 可恢复，需重新达成。
- 96 条目标与时长按内容候选值实现，真实玩家成功率/时长未标定（BALANCE-017 的 0.55/0.75/0.9 为假设）。
- `minValidEngagement` 尚未被 runtime 消费：极短失败局仍发参与薪资（0 奖励，无刷币），需 0.18 前评估冷却/最短有效局。
- 真机触控/安全区/读屏器/PWA 安装更新、Safari/Firefox、真实断电：UNVERIFIED。

## 8. 回滚

1. 回退 0.17 批次提交（内容/模块/UI/16 游戏页/feat 测试），保留 0.16 基线；2. 版本链归零：`engine.js`、`sw.js` VERSION/缓存前缀、`index.html`、tool-registry、career 模块常量、`validate_site.py`、`verify_deploy.PATHS`；3. 删除 SW 缓存 `studiokit-arcade-0.17.0-*` 并在 activate 清旧前缀；4. 数据：IDB v1 与 11 stores 未变，0.17 新增的装备键/证据 quest 行可按 token 忽略，`crystal` 别名读取兼容；5. 游戏页可整体回退到 0.16 版本，经典/挑战/禅/割草/旧机库不受影响；6. 免费租机/收据/委托内容可保留（0.16 兼容），不阻断回退。
