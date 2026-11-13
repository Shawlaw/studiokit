# 星海突击（star-raid）0.9 挑战模式实现记录（T049）

> 任务：T049 星海突击 C01–C06 挑战模式；地基为 T042（`A.Challenge` + `apps/arcade/challenge/star-raid.js`）。
> 设计源：`docs/arcade/0.9/levels/star-raid.json`、`docs/arcade/0.9/docs/star-raid.md`；测试夹具：`tools/testdata/challenge/star-raid.json`。
> 证据等级定义见 `docs/arcade/0.9/TESTING.md` §6；本文件结论基于 2026-11-13 本机实测（Windows + Chrome headless）。

## 1. 交付文件

| 文件 | 内容 |
| --- | --- |
| `apps/arcade/games/star-raid.html` | 挑战入口/选关面板/HUD/固定波次时间轴/安全走廊/Boss 阶段/失败重试/暂停退出/刷新恢复/记录/结算；`<script src="../challenge/star-raid.js">` |
| `tools/challenge/star-raid.mjs` | 7 个确定性场景（CH-SR-001..007），含 C01–C06 安全走廊回放与 Boss 阶段断言 |
| 本文件 | 支持字段、逐关证据、设计差异、UNVERIFIED、实测输出 |

未改：`engine.js`/`arcade.css`/`sw.js`/`validate_site.py`/设计源/其它游戏页；经典模式代码与随机刷怪路径保持原样。

## 2. 挑战模式实现概要

- **入口**：经典主按钮 `[data-ov-btn]` 不变；开始弹层第二入口 `[data-ov-btn2]`「挑战 6 关」→ `.challenge-select` 容器内注入 `A.Challenge.stageListHtml('star-raid')` + 返回按钮。挑战中隐藏经典 `.game-hud`（契约 §4.3），用 `.ac-challenge-hud` 显示 `C0N 标题 · 生命 · 用时/时长 · 当前波次/Boss`。
- **固定波次时间轴**：挑战用 `content.events` 取代经典随机刷怪/经典 30 秒 Boss 计时。每个事件 `atSec` 启动 → `telegraphSec` 预警（画安全走廊/危险列虚线）→ 攻击窗口 `attackActiveSec`（按 0.45s 节奏生成危险列弹幕）→ 结束。挑战内 `Math.random` 不参与刷怪/掉落。
- **安全走廊（bulletSafeSpace）**：每个事件用 `safeBandXRatio {center, halfWidth}` 计算走廊 `[left,right]`；所有敌弹只在走廊边界 ±16px 之外生成（玩家判定半宽 9 + 最大弹半径 5），因此站在走廊中心数学上不可能被弹命中。**每个新事件开始时清空上一段残留敌弹**，避免旧弹落入下一段的安全走廊（设计 `stopNewThreatsUntilSec` 的等效保障）。
- **攻击模式映射**：
  - `single`/`aimed` → 走廊外侧最近危险列的锁定单发；
  - `fan3`/`fan5` → 走廊两侧危险列按扇面分布（每轮旋转，向外 vx 漂移）；
  - `sweep-lr`/`sweep-rl` → 危险列按左→右 / 右→左逐轮扫描；
  - `mark-charge` → 预警危险列 + 高速冲锋弹（440px/s）；
  - `weak-left-right` / `phase-sweep-and-core` → Boss 专用（见下）。
- **刷怪**：`scout`/`pair`/`sweeper`/`charger` 映射经典 `drone/sine/diver` 视觉；它们按固定轨迹移动、不自行开火（攻击脚本负责弹幕），击落只加分/粒子，不影响通关判定。设计 `endCondition = survive-and-clear-events` 的 C01–C04 在 `stageDurationSec` 到点且生命 >0 时通关；`defeat-boss` 的 C05/C06 在 Boss HP 归零时通关。
- **Boss 阶段**：
  - C05 `weak-left-right`：Boss 悬停在走廊正上方（保证走廊内可命中），5 秒循环「2s 左翼暴露 → 1s 护盾 → 2s 右翼暴露」，只有暴露窗口掉血；HUD/`stageObservable` 暴露 `phase/exposed/weakSide`。
  - C06 `phase-sweep-and-core`：HP >60% 为阶段 1（扫射、可输出）；≤60% 进入阶段 2，3.6 秒循环「1.4s 扫射护盾 → 2.2s 中央核心暴露」，核心窗口才掉血。
  - Boss HP：C05=290、C06=400（按 `targetDurationSec` 与基础武器 DPS 折算，见 §5 差异 2）。
- **生命**：挑战使用 `content.startingHealth`（3）独立血量，中弹 -1、1.8s 无敌；归零 → 可归因失败弹层「重试本关」/「返回选关」。经典 `lives` 语义不变。
- **道具/辅助**：挑战保留 0.7 两个主动道具（脉冲/星盾各 1 次）；在挑战中使用任意一个 → 本关 `assisted:true`。拾取弹种 Buff（powerups）**不**算辅助，但会记入 `collectibles`。
- **记录**：`studiokit:arcade:challenge:v1`；`timeSec` 为挑战时间轴用时、`assisted`、`collectibles`（拾取的 powerup kind）写入；**不写** `progress:v1` 最高分、**不写** `playtime:v1` 轮次。
- **暂停/AFK**：暂停弹层 btn2「退出挑战」；`blur/visibilitychange` 复用既有 `createLoop` 自动暂停，挑战时间/位置/未完成目标不变化，恢复后手动继续。
- **存档**：`runs:v1` data 增加 `mode:'challenge'`、`stageId`、`challenge:{time,health,assisted,collectibles,damageLog,events 状态,boss 状态}`；刷新恢复同一关同一事件/Boss 进度；旧经典存档（无 `mode`）按经典恢复，不静默删档。
- **#test 钩子**（保留原有全部）：`challengeStages()`、`startChallenge(ref)`、`challengeInfo()`、`stageObservable()`、`forceStageClear(assisted)`、`forceStageFail(reason)`、`exitChallenge()`、`openChallengePanel()`、`challengePanelVisible()`、`advanceChallenge(seconds)`（固定 1/60 步长同步推进真实 update）、`setPlayerPos(x,y)`。

## 3. 支持字段（content）

| 字段 | 使用方式 |
| --- | --- |
| `playerSpawn {xRatio,yRatio}` | 挑战出生点（C01–C06 与设计一致） |
| `stageDurationSec` | survive 关卡的结束标记时间（C01 35 / C02 42 / C03 46 / C04 48） |
| `startingHealth` | 挑战独立生命（3） |
| `events[]` | `atSec` 启动、`telegraphSec` 预警、`attackActiveSec` 攻击窗口、`enemyType` 视觉/移动、`spawnXRatio` 危险列基准、`attackPattern` 弹幕/ Boss 脚本、`safeBandXRatio` 安全走廊；`stopNewThreatsUntilSec` 由“每事件开始清残留弹”等效实现 |
| `powerups[]` | `atSec` 掉落固定 `kind`（spread/laser/homing/rapid）于 `xRatio`；拾取记 `collectibles`，非必需 |
| `endCondition` | `survive-and-clear-events`（C01–C04）在时长到点且存活时通关；`defeat-boss`（C05/C06）Boss 归零通关 |
| `patternContract` | 作为实现语义索引；单发/扇弹/扫射/冲锋/弱点/双阶段均按上表映射（见 §5 差异 1/5） |
| `bulletSafeSpace` | 由“危险列只在走廊 ±16px 外”构造保证；CH-SR-002/007 每事件采样断言敌弹无一进入走廊 |

## 4. 逐关证据等级

回放方式：`tools/challenge/star-raid.mjs` 用 #test `advanceChallenge(seconds)`（固定 1/60 步长驱动真实 `update`，含敌弹生成/移动/碰撞/伤害/Boss 逻辑）与 `setPlayerPos` 把玩家放在该事件 `safeBandXRatio` 的走廊中心；事件之间不移动，攻击段保持走廊内。断言：零伤害、每段敌弹全部在走廊外、事件/ Boss 阶段可观测、记录写入。记为 **engine-replay**（与真人拖动的差距见 §6）。

| 关卡 | 目标 | 实测回放结果 | 证据等级 |
| --- | --- | --- | --- |
| C01 护航第一课 | survive 35s，5 事件 | CH-SR-002：cleared，health=3，damage=0，unsafeSteps=0，用时 35s，生还 | **engine-replay** |
| C02 扫射之门 | survive 42s，5 事件 | CH-SR-007：cleared，health=3，damage=0，unsafe=0 | **engine-replay** |
| C03 冲锋预警 | survive 46s，5 事件 | CH-SR-007：cleared，health=3，damage=0，unsafe=0 | **engine-replay** |
| C04 拾取抉择 | survive 48s，5 事件 | CH-SR-007：cleared，health=3，damage=0，unsafe=0 | **engine-replay** |
| C05 护盾与弱点 | 击败双弱点 Boss，5 事件 | CH-SR-003：cleared，phase=1，暴露窗口 14.1s，Boss 命中 290，用时 56.3s（目标 55–90） | **engine-replay** |
| C06 星域毕业战 | 击败两阶段 Boss，6 事件 | CH-SR-003：cleared，`bossMaxPhase=2`，暴露窗口 17.3s，Boss 命中 361，用时 69.6s（目标 65–100） | **engine-replay** |

## 5. 设计差异（原值 → 实现值 → 原因）

1. **Boss 弱点位置**：设计 `patternContract` 写「先左翼 2.5s 后右翼 2.5s」「第 2 阶段中央核心暴露 3s」，意图是几何上的左右弱点。
   → 实现：Boss 悬停在**安全走廊正上方**（否则玩家在走廊内无法命中几何侧翼弱点，而离开走廊必被弹幕命中）；弱点/核心改为**时间窗暴露**（C05 2s 左/1s 盾/2s 右；C06 阶段 2 1.4s 盾/2.2s 核心），`weakSide` 仍随窗口交替并在 HUD/observable 可见，暴露窗口才掉血。
   原因：固定 `safeBandXRatio` 走廊与几何左右弱点互斥；时间窗保留“露弱点再进攻”的决策与可观测性。**建议 Reviewer/Owner 判断是否接受该最小修正**。
2. **Boss HP**：设计未给数值 → C05=290、C06=400。
   原因：按 `targetDurationSec`（55–90 / 65–100）与基础武器 DPS（约 15.4/s）× 暴露窗口折算；实测清除用时 56.3s / 69.6s 落在设计区间内。玩家拾取 spread/laser/homing 会更快（见差异 5）。
3. **`stopNewThreatsUntilSec`**：设计用于压制经典随机刷怪 → 挑战无随机刷怪，改为「每个新事件开始时清空上一段挑战敌弹」。
   原因：避免上一段残留弹在下一段走廊内造成“不可避免伤害”，保证 bulletSafeSpace 真实成立。
4. **通关判定**：设计 success 文案「击落全部目标/撑到结束标记」 → C01–C04 采用 `endCondition=survive-and-clear-events`（撑到时长结束 + 事件全部走完即通关，敌人可不清空）；C05/C06 采用 `defeat-boss`。
   原因：各事件刷出的视觉敌机是弹幕载体而非独立目标；以 `endCondition` 字段为准，避免“必须击落全部随机视觉敌机”与设计 endCondition 冲突。
5. **弹道形状**：经典 `fan3/fan5/aimed` 是从敌机位置发射的真实扇形/瞄准弹；挑战为“走廊外侧垂直危险列 + 扇面列序/向外漂移”的等效表达。
   原因：必须保证走廊内绝对无弹（数学可证）；同时保留逐轮扇面/扫射的节奏差异。视觉上以预警虚线与危险区高亮呈现。
6. **拾取物吸附**：经典引擎对拾取物有轻微吸附（既有机制）→ 挑战沿用；自动回放因此可能顺路吃到可选 powerup（不影响 `assisted`，只记 `collectibles`）。
   原因：复用既有 0.7 机制，不新增行为。

## 6. UNVERIFIED / 风险

- **真机**：iOS/Android 触控拖动 + 道具双指并发、safe-area、真实帧率下的子弹可读性未真机验证（仅 CDP 模拟 320/390 与弹幕采样）。
- **engine-replay 差距**：回放用 `advanceChallenge` + `setPlayerPos` 直接置于安全走廊中心，替代真人“读预警→移动到走廊”的输入；虽然完整跑了引擎敌弹/碰撞/伤害/Boss 逻辑，但不足以证明真人可完成，需 Owner 试玩。C02–C04 各只跑 1 条参考路线；未覆盖中弹后的失败→重试。
- **Boss 几何弱点修正**见 §5 差异 1，需 Reviewer 复核是否可接受。
- **视觉/音频**：安全走廊/危险列预警按契约实现，但未做真机小屏可辨性测试。
- **经典回归**：本任务未运行完整 `arcade_smoke`（由 Lead 统一跑）；挑战分支未改经典 `startGame/gameOver/reset/update` 经典主循环（挑战走独立分支），CH-SR-006 断言经典入口/第 1 关/挑战 chrome 清理；完整 85 项 smoke 以 Lead 实测为准。
- **记录/导出**：挑战记录走 `A.Challenge` 平台实现（T042 已单测 21/21），本任务未重复验证导入导出。

## 7. 实测命令与输出（2026-11-13）

```text
node --check tools/challenge/star-raid.mjs → exit 0
node --check apps/arcade/games/star-raid.html（抽取内联脚本 vm.Script）→ syntax OK

ARCADE_GAMEPLAY_PORT=8807 ARCADE_GAMEPLAY_CDP_PORT=9407 \
  node tools/arcade_gameplay_test.mjs --game=star-raid --repeat=2
  → 12/12 scenario runs passed（6 场景 × 2 遍；PASS=12 FAIL=0）

CH-SR-002：events=w1>w2>w3>w4>w5, clearTimeSec=35, health=3, unsafeSteps=0
CH-SR-003：c05={phase:1, exposedSec:14.1, hits:290, time:56.3}
           c06={phase:2, exposedSec:17.3, hits:361, time:69.6}
CH-SR-007：C02/C03/C04 cleared，health=3，damage=0，unsafe=0
```

复跑：

```powershell
$env:ARCADE_GAMEPLAY_PORT='8807'; $env:ARCADE_GAMEPLAY_CDP_PORT='9407'
node tools/arcade_gameplay_test.mjs --game=star-raid --repeat=2
```
