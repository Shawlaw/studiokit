# 黄金矿工（gold-miner）0.9 挑战模式实现记录（T049）

> 任务：T049 黄金矿工 C01–C06 挑战模式；地基为 T042（`A.Challenge` + `apps/arcade/challenge/gold-miner.js`）。
> 设计源：`docs/arcade/0.9/levels/gold-miner.json`、`docs/arcade/0.9/docs/gold-miner.md`；测试夹具：`tools/testdata/challenge/gold-miner.json`。
> 证据等级定义见 `docs/arcade/0.9/TESTING.md` §6；本文件结论基于 2026-11-13 本机实测（Windows + Chrome headless）。

## 1. 交付文件

| 文件 | 内容 |
| --- | --- |
| `apps/arcade/games/gold-miner.html` | 挑战入口/选关面板/HUD/失败重试/暂停退出/刷新恢复/记录/结算；`<script src="../challenge/gold-miner.js">` |
| `tools/challenge/gold-miner.mjs` | 7 个确定性场景（CH-GM-001..007），含 C01–C06 参考顺序回放 |
| 本文件 | 支持字段、逐关证据、设计差异、UNVERIFIED、实测输出 |

未改：`engine.js`/`arcade.css`/`sw.js`/`validate_site.py`/设计源/其它游戏页；经典模式代码路径保持原样。

## 2. 挑战模式实现概要

- **入口**：经典主按钮 `[data-ov-btn]` 文案与行为不变；开始弹层第二入口 `[data-ov-btn2]`「挑战 6 关」→ `.challenge-select` 容器内注入 `A.Challenge.stageListHtml('gold-miner')` + 返回按钮。
- **选关**：6 个 `.ac-stage-btn[data-stage-id]`，锁定 `disabled.is-locked`；C01 恒开、C0N 需前一关 cleared（`A.Challenge.isUnlocked`）；显示标题/最佳用时/辅助标记。
- **关卡**：`content` 固定物品布局（`items`）、`timeLimitSec`、`targetMoney`、`initialTools`、`referenceCatchOrder`；无随机重排。摆角相位固定（`pend.angle = 0.92rad`、`vel = 0`，设计 "deterministic phase at stage start"）；摆速继承经典 `levelSpec(stageNumber).swing`（C01 300 → C06 700）。
- **钩爪物理**：完全复用经典 `releaseClaw`/`extend`/`collide`/`attachHolding`/`retractSpeed`/`cashIn`；`EXTEND_SPEED = 560` 与设计 `hook.extendSpeedPxSec = 560` 一致，pivot `(210,104)` 一致。
- **通关/失败**：达标（`money >= targetMoney`）后出现「达标 · 结算通关」按钮，点击 `A.Challenge.markCleared` 并按 `resultHtml` 结算；倒计时归零未达标 → 可归因失败弹层「重试本关」/「返回选关」。
- **记录**：`studiokit:arcade:challenge:v1`（Schema v1）；`timeSec` 为本关有效用时，`assisted`、`collectibles`（成功抓取的物品 id）一并写入；**不写** `progress:v1` 最高分、**不写** `playtime:v1` 轮次（页面活跃 ms 由既有机制累计）。
- **暂停/AFK**：暂停弹层 btn2「退出挑战」回选关；`blur/visibilitychange` 走既有 `createLoop` 自动暂停与 `createRunAutosave`，不推进计时。
- **存档**：`runs:v1` 的 data 增加 `mode:'challenge'`、`stageId`、`challenge:{elapsed,assisted,collectibles,caught}`；刷新恢复同一关同一进度；旧 0.8 经典存档（无 `mode`）按经典恢复，不静默删档。
- **HUD**：`.ac-challenge-hud` 显示 `C0N 标题 · 目标 · 用时 · 剩余`；首次进入 3.2 秒展示 `.ac-challenge-tip`（goalStatement + decision）。
- **失败重试**：结算/失败弹层主按钮 1 次点击回本关；挑战失败不清除挑战记录（重试后记录仍按最佳/首通更新）。
- **#test 钩子**（保留原有全部）：`challengeStages()`、`startChallenge(ref)`、`challengeInfo()`、`stageObservable()`、`forceStageClear(assisted)`、`forceStageFail(reason)`、`exitChallenge()`、`openChallengePanel()`、`challengePanelVisible()`、`aimRelease(deg,tol)`、`cancelAimRelease()`、`advanceChallenge(seconds)`。

## 3. 支持字段（content）

| 字段 | 使用方式 | 备注 |
| --- | --- | --- |
| `coordinates` / `hook.pivot` | 逻辑画布 420×740，pivot `(210,104)` 与经典一致 | 不按屏幕坐标硬编码 |
| `items[].id/type/x/y/value/weight` | 固定布局直接落位；radius 复用经典 `TYPES`；重量/价值用设计值 | 实测 6 关坐标未被 `itemFloor` 修正 |
| `items[].aimAngleDeg` | 仅测试参考角度（`referencePlan`），玩家端不显示 | 防剧透 |
| `timeLimitSec` | 挑战倒计时 | 经典关卡时长不受影响 |
| `targetMoney` | 挑战目标金额（HUD/结算/达标判定） | 整数取整 |
| `initialTools` | `{aim:0,winch:0,time:0}` → 挑战禁用经典道具（见 §5 差异 1） | — |
| `referenceCatchOrder` | 测试模块按序抓取回放；玩家端不显示 | — |
| `hook.extendSpeedPxSec` | 复用经典 `EXTEND_SPEED=560` | 一致 |
| `hook.baseRetractSpeed: "inherit engine"` | 复用经典 `retractSpeed()`（按重量） | — |
| `hook.swing: "inherit engine but use deterministic phase"` | 挑战固定初始相位；摆速按关卡号继承经典 | — |
| `complete` | 达标后手动点「结算通关」，不要求抓光 | — |
| `fail` | 倒计时归零且未达标 → 失败 | — |
| `hazards` | TNT 碰触只损失本次抓取收益；挑战不连锁炸毁周围矿物 | 见 §5 差异 2 |

## 4. 逐关证据等级

回放方式：`tools/challenge/gold-miner.mjs` 的 `aimRelease(deg, tol=2.2°)` 等待真实摆角进入目标区间后，把摆角精确对准设计 `aimAngleDeg`（微调 ≤2.2°，保留角速度），再调用引擎真实 `releaseClaw` 物理：伸出 → 圆周碰撞判定 → 夹取 → 按重量回收 → 入账。除“人眼判断放钩时机”外，未跳过钩爪物理/碰撞/回收时间，故记 **engine-replay**；与真实输入的差距见 §6。

| 关卡 | 参考顺序（金额） | 回放结果（实测） | 证据等级 |
| --- | --- | --- | --- |
| C01 轻金快取 | m1→m2→l1（$650 ≥ 550） | CH-GM-002 通过；`money=650`，`timeSec=6.5`，collectibles=3 | **engine-replay** |
| C02 钻石的代价 | d1→m1（$750 = 750） | CH-GM-007 通过；`money=750`，模拟剩余 56s | **engine-replay** |
| C03 第一颗炸药 | l1→d1（$950 ≥ 900） | CH-GM-007 通过；`money=950`，模拟剩余 54s | **engine-replay** |
| C04 双钻矿脉 | d1→d2（$1200 = 1200） | CH-GM-007 通过；`money=1200`，模拟剩余 51s | **engine-replay** |
| C05 限时三钩 | d1→l1→m1（$1100 ≥ 1000） | CH-GM-007 通过；`money=1100`，模拟剩余 46s | **engine-replay** |
| C06 矿工毕业考 | d1→d2→l1（$1550 ≥ 1300） | CH-GM-007 通过；`money=1550`，模拟剩余 46s | **engine-replay** |

补充：设计包自带 `validate_levels.py` 的 `ray-clearance`（51 断言）已验证参考抓取顺序在几何上不被其它物品遮挡；C03 的 l1 射线距 r1 边缘仅约 3px，是逐关回放最容易偏离的一关（测试用精确角度对准后通过）。

## 5. 设计差异（原值 → 实现值 → 原因）

1. **挑战道具**：设计 `initialTools = {aim:0, winch:0, time:0}` → 实现挑战内禁用经典 4 道具（含按秒计费「瞄准线」），`toolbelt` 按钮全部禁用；`assisted` 在正常挑战路径恒为 `false`。
   原因：按设计不给道具，且契约 §4.8 的 assisted 只针对“限量道具”。影响：契约 §4.8 的 assisted 在黄金矿工挑战中无正常触发路径；`forceStageClear(true)` 可用于记录/UI 的 assisted 断言（CH-GM-002 已验证 false、平台层单测已验证 true）。**建议 Owner/Reviewer 决定是否为挑战放量 1 次辅助道具**。
2. **TNT 连锁爆炸**：经典实现 TNT 会连带炸毁 95px 内物品；挑战实现只移除 TNT 本身，损失本次抓取收益。
   原因：设计 `hazards` 只规定“碰到立即销毁本次抓取收益”，固定布局下连锁炸毁会让关卡永久不可完成；挑战独占该规则，经典不变（原值：经典连锁；设计未规定 → 挑战新值：不连锁）。
3. **摆角初始相位**：经典 `rand(±0.92~1.0rad)` 随机 → 挑战固定 `angle=0.92rad, vel=0`。
   原因：设计 `hook.swing` 要求 deterministic phase；保证测试与玩家可复现。
4. **摆速**：设计未给数值（“inherit engine”）→ 按关卡号继承经典 `LEVEL_SPECS` 摆动重力 C01=300、C06=700。
   原因：与经典手感一致且确定。
5. **物品底部边界**：经典 `itemFloor` 按道具条高度自适应并把物品上抬；挑战沿用同一安全规则，但 6 关设计 y 坐标均 ≤600、实测 `itemFloor≈630`，落位与设计一致（`stageObservable().items` 与设计逐字段一致）。
6. **结算时机**：达标后不自动结束，必须点「达标 · 结算通关」。
   原因：设计 `complete` 明确“达标即可选择立即结算，不要求抓光”。

## 6. UNVERIFIED / 风险

- **真机**：iOS/Android 触控、safe-area、短按放钩/长按瞄准线（挑战禁用瞄准线）未在真机验证，仅 CDP 视口模拟。
- **engine-replay 差距**：回放用 `aimRelease` 替代人眼判断放钩时机（含精确角度对准 ≤2.2°）；真人操作存在反应/角度偏差，实际可玩性与手感仍需 Owner 试玩。C02–C06 每关只跑了 1 条参考路线，未覆盖失败重试后的状态。
- **C03 几何边界**：l1 射线与 r1 边缘仅 ~3px 余量，玩家稍有角度偏差会先夹到石头（损失时间，不直接失败）；属设计数据边界偏紧，未改设计源。
- **经典回归**：本任务未运行完整 `arcade_smoke`（由 Lead 统一跑）；挑战分支未改经典 `startGame/gameOver/nextLevel/cashOut/toolbelt` 路径，CH-GM-005 仅断言经典入口/第 1 关/道具；完整 85 项 smoke 以 Lead 实测为准。
- **记录/导出**：挑战记录走 `A.Challenge` 平台实现（T042 已单测 21/21），本任务未重复验证导入导出。

## 7. 实测命令与输出（2026-11-13）

```text
node --check tools/challenge/gold-miner.mjs  → exit 0
node --check apps/arcade/games/gold-miner.html（抽取内联脚本 vm.Script）→ syntax OK

ARCADE_GAMEPLAY_PORT=8807 ARCADE_GAMEPLAY_CDP_PORT=9407 \
  node tools/arcade_gameplay_test.mjs --game=gold-miner --repeat=2
  → 12/12 scenario runs passed（7 场景 × 2 遍；PASS=12 FAIL=0）

CH-GM-002 证据摘要：order=m1>m2>l1, money=650, timeSec=6.5, collectibles=3
CH-GM-007 证据摘要：
  C02 order=d1>m1 money=750  timeLeft=56
  C03 order=l1>d1 money=950  timeLeft=54
  C04 order=d1>d2 money=1200 timeLeft=51
  C05 order=d1>l1>m1 money=1100 timeLeft=46
  C06 order=d1>d2>l1 money=1550 timeLeft=46
  evidence=engine-replay(aimRelease + advanceChallenge, real hook physics)
```

复跑：

```powershell
$env:ARCADE_GAMEPLAY_PORT='8807'; $env:ARCADE_GAMEPLAY_CDP_PORT='9407'
node tools/arcade_gameplay_test.mjs --game=gold-miner --repeat=2
```
