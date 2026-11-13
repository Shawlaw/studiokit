# 层塔（pendulum-tower）0.9 挑战模式实现记录

> 任务：T048（0.9 关卡落地，记忆/蛇组延伸）。分支 `feat/arcade-0.8-gameplay`（0.8/0.9 合并开发）。
> 设计源（只读）：`docs/arcade/0.9/levels/pendulum-tower.json`、`docs/arcade/0.9/levels/stages/pendulum-tower-C01..C06.json`、`docs/arcade/0.9/docs/pendulum-tower.md`。
> 运行时数据（平台生成物）：`apps/arcade/challenge/pendulum-tower.js`；夹具：`tools/testdata/challenge/pendulum-tower.json`。
> 实现：`apps/arcade/games/pendulum-tower.html`；测试模块：`tools/challenge/pendulum-tower.mjs`。

## 1. 支持的字段

| 设计字段 | 支持 | 实现说明 |
| --- | --- | --- |
| `content.baseCenterX` | ✅ | 委托基座中心（各关 210）；目标偏置以此为基准 |
| `content.boxes[]`（order/width/height/targetOffsetPx/tolerancePx） | ✅ | 逐箱委托：当前箱目标偏置与容差显示在 HUD + 塔顶虚线标记；按 order 顺序落箱 |
| `content.pendulum`（pivotX/pivotY/length/speedFactor/deterministicStartPhaseRad） | ✅ | 固定钟摆：`pend.length`、摆速 `gravity = 680×speedFactor`；起始角取设计值，另加确定性初始角速度以形成约 ±0.95rad 可预测摆幅（见 §4） |
| `content.limits.maxTowerLeanAbs` | ✅ | 挑战倾斜上限（0.075–0.115）；超过即失败（结构失稳），not 使用经典 0.35 |
| `content.limits.maxDroppedBoxes` | ✅ | 允许落空次数；超过即失败 |
| `content.limits.guideUsesAllowed` / `braceUsesAllowed` | ✅ | 挑战道具额度：0 时对应道具禁用；C04 允许配重 1 次 |
| `content.win.floorsAtLeast` | ✅ | 达到楼层且倾斜回落稳定 → 通关 |
| `content.win.noCollapse` | ✅ | 倾斜超限/落空超限 → 失败 |
| `content.win.allMarkTargetsWithinTolerance` | ✅ | 各关为 false（不强制），但用于银牌/金牌评价与测试断言 |
| `content.evaluation`（bronze/silver/gold） | ✅ | 结算按 `content.evaluation` 计算并显示评价：铜=完成稳定；银=全部标记在容差内；金=银+零道具零失误 |
| `physicsNote`（真实 Lean 物理、无吸附） | ✅ | 挑战落箱不吸附：按真实松手 x 落箱，按偏置对塔施加倾斜力矩；无自动对齐 |
| `requiredFeatures: commission_mode/fixed_marks` | ✅ | 固定委托 + 固定标记（塔顶虚线/±容差显示） |
| 挑战内禁随机 | ✅ | 钟摆固定配置/固定初速；落点由玩家释放时机决定，非随机 |

## 2. 挑战流程与 UI（INTEGRATION-CONTRACT §4）

- **入口**：主按钮「开始游戏」保持经典；`[data-ov-btn2]` =「挑战 6 关」（数据缺失时禁用）。
- **选关**：`.ac-challenge-panel`（初始隐藏）、6 个 `.ac-stage-btn[data-stage-id]`、锁定/最佳/返回。
- **关卡内**：`[data-ch-hud]` 显示 `Cxx 标题 · 目标 · 楼层 n/要求 · 当前目标偏置±容差 · 倾斜/上限 · 落空次数 · 用时`；canvas 顶部显示委托/目标；塔顶画目标偏置虚线标记（不吸附，仅提示）；经典分数/层数 HUD 隐藏。
- **状态机**：`ready → playing → paused → playing → cleared | failed`；暂停 btn2「退出挑战」；失焦自动暂停且物理/计时冻结。
- **失败**：倾斜超过 `maxTowerLeanAbs`（结构失稳）或落空次数超过 `maxDroppedBoxes` → 可归因文案 + 「重试本关」（1 次点击）+ 「返回选关」。
- **通关**：楼层达到 `floorsAtLeast` 且倾斜回落稳定（`|lean|≤max·0.98`、`|leanVel|<0.4`）→ `markCleared({timeSec, assisted, collectibles:[]})`；结算 `resultHtml` + 评价等级 + 各层实际偏置；下一关/重玩。
- **assisted**：挑战中使用垂线预览/配重 → `assisted:true` 并记入 `toolsUsed`；经典最高分不受影响。
- **记录边界**：挑战不写 `progress:v1` 最高分、不写 `playtime:v1` 轮次。
- **存档**：`runs:v1.data` 增加 `mode/stageId/chPlaced/chMisses/chMarks/chElapsed/chAssisted/chToolsUsed` + `boxes/pend/towerLean/...`；旧档缺 `mode` 按经典恢复。

## 3. `#test` 钩子（契约 §5）

保留全部既有钩子（`info/joyInfo/useJoyTool/setLean/stackTo/releaseNow/forceSettle`）；新增：

- `challengeStages() → [{id, stageNumber, title, unlocked, best}]`
- `startChallenge(ref) → boolean`
- `challengeInfo() → {mode, stageId, stageIndex, state, elapsedSec, objective, cleared, collectibles, assisted, floors, floorsRequired, marks, misses, maxDroppedBoxes, towerLean, maxLean, toolsUsed, evaluation, errorReason}`
- `stageObservable() → {mode, stageId, state, boxes, floors, floorsRequired, top, pendulum{x,y,angle,vel,hasBox}, drop, towerLean, leanVel, maxLean, marks, currentTargetOffsetPx, currentTolerancePx, misses, maxDroppedBoxes, tools, toolsUsed, assisted, elapsedSec, evaluation, errorReason, cleared}`
- `releaseWhenAligned(offset, tolerance) → Promise<boolean>`：测试便捷钩子——在钟摆箱中心到达 `baseCenterX+offset` 的下一帧调用真实 `releaseBox()`，用于参考释放序列；仍走真实摆动物理/下落/落箱/倾斜判定（非 `forceSettle`、非 UI-only）
- `forceStageClear(assisted=false)` / `forceStageFail(reason)` / `exitChallenge()`

## 4. 设计差异（原值 → 新值 → 原因）

| 项目 | 原设计 | 实现 | 原因 |
| --- | --- | --- | --- |
| 钟摆初始状态 | `deterministicStartPhaseRad: 0`（只给起始角） | 起始角 0 + 确定性初始角速度 `2.05×speedFactor`（≈±0.95rad 摆幅） | 单纯 angle=0 且 vel=0 时钟摆静止，无法完成 ±8/±12px 目标偏置；加固定初速可复现经典摆幅并保持确定性，未改摆长/摆速 |
| 落箱吸附 | 设计「无自动吸附」 | 挑战按真实落点 x 放箱，不再经典吸附到塔顶中心；偏差进入 `marks` 并产生倾斜力矩 | 忠实委托判定；经典模式吸附逻辑不变 |
| 倾斜上限 | 设计给 `maxTowerLeanAbs`（0.075–0.115） | 挑战用该值判失败，替代经典 0.35 | 委托更难、需管理重心；经典上限不变 |
| 通关判定时机 | `win.floorsAtLeast`/noCollapse | 达到楼层后等倾斜回落稳定再结算（避免在摆动峰值误判） | 真实 Lean 物理有阻尼振荡；回落窗口内结算更符合“保持稳定” |
| `maxDroppedBoxes` 语义 | 设计未细化“dropped” | 解释为可接受的落空（未落到塔顶）次数，超过即失败 | 与“落空”反馈一致；已写入本差异 |
| 金牌条件 | gold=银牌+零道具零失误 | 同上，评价在结算正文与 `challengeInfo.evaluation` 暴露，但不写入 challenge 记录 | `challenge:v1` Schema 只有 timeSec/assisted/collectibles；评价为即时反馈 |
| 参考通关证据 | 真实释放序列 | **engine-replay**：`releaseWhenAligned` 在目标偏置对齐帧触发真实 `releaseBox`；真实指针点击放箱路径另由 CH-PT-001 断言 | 纯外部点击对逐像素时序敏感（无头/真机帧率差异）；engine-replay 仍经过完整摆动物理/落箱/倾斜判定，差距已如实记录 |

目标偏置、容差、楼层数、摆速、倾斜/落空上限、道具限额逐关与设计源一致，未调整数值。

## 5. 每关证据等级与实测

| 场景 | 覆盖 | 证据等级 |
| --- | --- | --- |
| `CH-PT-001` | 6 关数据/锁定、选关面板真实点击进入 C01、固定钟摆配置/目标/限制、**真实指针点击放箱**路径、HUD | engine-replay |
| `CH-PT-002` | C01 按 `referencePlan.releaseOffsetsPx=[0,0,0,0]` 逐层真实物理落箱，达成 4 层委托，落点均在容差内并得到金牌评价 | **engine-replay**（真实摆动/下落/落箱/倾斜；松手由对齐钩子触发，见 §4） |
| `CH-PT-003` | 倾斜超限 → 结构失稳失败可归因 + 1 次点击重试回 C01 起点 | engine-replay |
| `CH-PT-004` | 暂停 → 刷新 → 续玩恢复同关/楼层/落点记录/钟摆状态 | engine-replay |
| `CH-PT-005` | 解锁 C01–C04；C04 配重限额 1 次、使用后 assisted=true 并写入记录 | engine-replay |
| `CH-PT-006` | 经典 3 垂线/2 配重/无尽叠塔回归 + 320×568 / 390×844 无横向溢出、挑战入口 ≥44px | engine-replay |

C02–C06 与 C01 共用同一挑战物理/落箱/倾斜代码，仅数据（目标偏置/摆速/上限）不同；本轮只有 C01 做了参考释放通关（见 UNVERIFIED）。

```powershell
# 内联脚本 node --check（抽取 <script>）
node -e "const fs=require('fs');const s=fs.readFileSync('apps/arcade/games/pendulum-tower.html','utf8');fs.writeFileSync(process.env.TEMP+'/pt-inline.js',[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n'))"
node --check "$env:TEMP/pt-inline.js"        # exit 0

$env:ARCADE_GAMEPLAY_PORT='8806'; $env:ARCADE_GAMEPLAY_CDP_PORT='9406'
node tools/arcade_gameplay_test.mjs --game=pendulum-tower --repeat=2
# → 12/12 scenario runs passed，exit 0（6 场景 ×2）
#   CH-PT-001: floorsRequired=4, maxLean=0.075, clickReleased=true
#   CH-PT-002: floors=4, marks=[4.6,4.3,-3.8,3.1], evaluation=gold, timeSec=5
#   CH-PT-003: reason=塔身倾斜 0.200 超过委托上限 0.075，结构失稳
#   CH-PT-004: stage=pendulum-tower-C01, floors=1, marks=1
#   CH-PT-005: toolsUsed={"guide":0,"brace":1}, assisted=true
#   CH-PT-006: classicTools={"guide":3,"brace":2}, widths=320:320/320 390:390/390
node tools/arcade_gameplay_test.mjs --suite=base --repeat=2   # → 22/22 PASS（T056 维护的 base suite）
```

## 6. UNVERIFIED / 风险

- **CH-PT-002 是 engine-replay 而非纯人工点击回放**：松手由 `releaseWhenAligned` 钩子在目标偏置信道内触发；真实指针点击路径已由 CH-PT-001 单独验证。若 Reviewer 要求纯点击回放，需要更精确的外部时序控制，当前未做。
- **C02–C06 未逐关参考回放**：G02 交替偏置、C03+ 多箱/更小倾斜上限的可行性由设计包参考解给出；实现共用同一物理与落箱代码，但逐关“真实释放序列稳定通关”未逐关实测（UNVERIFIED）。CH-DATA-001 只证明数据存在。
- 真机 iOS/Android 与触屏点击放箱未测试（UNVERIFIED）：无头 Chrome 逻辑坐标模拟。
- 完整 85 项 smoke 与 13 游戏全量 challenge suite 由 Lead 统一跑；本 Agent 未跑完整 smoke。
- 经典模式 `settleDrop`/吸附/0.35 倾斜上限/3+2 道具额度未改；CH-PT-006 覆盖经典配置回归。

## 7. Reviewer 结论占位

- Verdict：待 T057 独立评审。
- 建议复核点：C01 参考释放截图（`test-artifacts/gameplay-CH-PT-002.png`）、落点偏置数组、倾斜/落空归因、C04 配重 assisted、320/390 截图、C02–C06 真人逐关可达性。
