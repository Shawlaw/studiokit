# 极速车道（road-rush）0.9 挑战模式实现记录

> 任务：T046 / task-11（时间轴型游戏组；`docs/arcade/0.9/PLAN.md` 中对应 LD90-ROAD / T049）。
> 分支 `feat/arcade-0.8-gameplay`（0.8/0.9 合并开发，未发布）。
> 设计源（只读，未改）：`docs/arcade/0.9/levels/road-rush.json`、`docs/arcade/0.9/levels/stages/road-rush-C01..C06.json`、`docs/arcade/0.9/docs/road-rush.md`。
> 运行时数据（平台生成物，未手改）：`apps/arcade/challenge/road-rush.js`；测试夹具：`tools/testdata/challenge/road-rush.json`。
> 实现文件：`apps/arcade/games/road-rush.html`；测试模块：`tools/challenge/road-rush.mjs`。
> 边界：未改 `engine.js` / `arcade.css` / `sw.js` / `validate_site.py` / 其它游戏 / 设计源；未新增 localStorage key；未跑 build/完整 smoke；未做 git 操作。

## 1. 支持的字段

| 设计字段 | 支持 | 实现说明 |
| --- | --- | --- |
| `content.laneCount` | ✅ | 挑战按数据车道数渲染与判定（当前 6 关均为 4 车道；经典固定 4 车道不变） |
| `content.startLane` | ✅ | 挑战起始车道；`lane` 为 0-based 内部索引，UI 文案显示为「第 N 车道」（N=lane+1） |
| `content.slotDurationSec` | ✅ | 每个时隙时长（1.05s / 1.15s）；时隙窗口 `[atSec, atSec+slotDurationSec)`；车辆在 `passAt = atSec + slotDurationSec` 到达玩家段 |
| `content.laneChangeTimeSec` | ✅ | 真实变道过渡时长（0.22s）：玩家车道位置为浮点 `lanePos`，从起始车道线性过渡到目标车道；过渡中按真实位置参与碰撞判定 |
| `content.timeline[].slot` | ✅（重排为 1..n） | 顺序即时间轴顺序；测试与 HUD 的「路段 n/N」使用 1-based 序号 |
| `content.timeline[].atSec` | ✅ | 时隙开始时刻（暂停感知模拟时钟） |
| `content.timeline[].occupiedLanes` | ✅ | 该时隙结束（`passAt`）时不可占用的车道；玩家 `lanePos` 与之距离 ≤0.5 车宽即碰撞失败 |
| `content.timeline[].telegraphLeadSec` | ✅ | 时隙开始前该时长内，在画布上用半透明橙色车道带预告被占用车道（可读预警） |
| `content.timeline[].optionalNearPassBonusLanes` | ✅ | `passAt` 时玩家所在车道（四舍五入）在该列表 → 近距超车奖励 `nearPassBonus`；否则 `passBonus` |
| `content.goal.type=survive-all-slots` | ✅ | 走完所有时隙且无碰撞即通关（distance 在 `passAt` 全过时已达到 `minDistanceMeters`） |
| `content.goal.minDistanceMeters` | ✅ | 距离按 `minDistance * simTime / totalDuration` 线性推进；通关时 `distance >= minDistance`（C01 540m → C06 1240m） |
| `content.scoreRules.passBonus` | ✅ | 每过一个时隙加分（10） |
| `content.scoreRules.nearPassBonus` | ✅ | 近距超车额外加分（5），HUD/结算显示近距次数 |
| `content.scoreRules.noDamageGold` | ✅（语义等价） | 挑战任一碰撞即失败，因此“无伤”由通关自动成立；经典模式道具/生命语义不变 |
| `content.spawnerPolicy` | ✅ | 挑战模式完全不调用经典 `spawnCar()`，只按时间轴生成视觉车流；随机车流在挑战内关闭 |
| `content.pathProofModel` | ✅ | 数据级车道证明 + 引擎级真实变道/碰撞测试：`tools/challenge/road-rush.mjs` 校验 `safeLaneBySlot` 每格车道差 ≤1 且不被占用；CH-RR-007 在引擎中逐时隙真实变道走完 6 关 |
| `stage.goalStatement / decision` | ✅ | 开始后 3 秒内 `[data-ch-tip]` 展示；挑战 HUD 常驻目标/路段/用时 |
| `stage.title / stageNumber` | ✅ | 选关按钮与 HUD 的 `Cxx 标题` |
| `referencePlan.safeLaneBySlot` | ✅ | 长度 = 时间轴数 + 1（`[起始车道, 第1段后…]`）；C01 纯实时回放、C01–C06 全关真实变道回放 |
| `referencePlan.bonusStrategy` | ✅（按语义） | 参考解只保证安全，不追求最高分；实际回放 C01 得分 95 / 近距 5 次 |
| `acceptance.*` | ✅ | 成功/失败/移动端/AFK 均有对应场景（见 §5） |

## 2. 挑战流程与 UI（按 INTEGRATION-CONTRACT §4）

- **入口**：开始弹层主按钮 `[data-ov-btn]`「开始游戏」保持经典行为不变；第二入口 `[data-ov-btn2]`「挑战 6 关」（数据不可用时显示「挑战数据不可用」并禁用，fail closed）。
- **选关**：`.challenge-layer` 内嵌 `.ac-challenge-panel`（`A.Challenge.stageListHtml('road-rush')` 生成）；6 个 `.ac-stage-btn[data-stage-id]`，锁定关 `disabled + .is-locked`，显示 ✅/最佳用时；`[data-ch-back]`「返回开始」。
- **关卡内**：`.ac-challenge-hud[data-ch-hud]` 显示 `Cxx 标题 · 目标 Nm · 路段 n/N · 用时`；经典 `.game-hud` 与 canvas 距离/速度/生命 HUD 在挑战模式隐藏；canvas 改画挑战距离进度/得分/近距次数；被占用车道在车辆到达前 `telegraphLeadSec` 秒显示半透明橙色带预警。
- **状态机**：`ready → playing → paused → playing → cleared | failed`；暂停沿用 `A.bindPause`，暂停弹层 btn2「退出挑战」回选关；`blur/visibilitychange` 自动暂停且不推进模拟时间。
- **失败**：碰撞即失败；可归因文案如「第 3 段：第 2 车道有车，变道没有在车辆到达前完成」；主按钮「重试本关」（1 次点击）+ btn2「返回选关」。
- **通关**：走完所有时隙后 `A.Challenge.markCleared(gameId, stageId, {timeSec, assisted, collectibles:[]})`；结算用 `A.Challenge.resultHtml`；C01–C05 主按钮「下一关」、C06「返回选关」，btn2「重玩本关」。
- **记录边界**：挑战不调用 `Progress.recordPlay`，不写 `progress:v1` 最高分/局数、不写 `playtime:v1` 轮次（页面活跃 ms 仍由既有计时机制累计，符合契约 §3 说明）。
- **存档**：`runs:v1.data` 追加 `mode:'challenge' / stageId / challengeState{chSimTime,chSlotCheck,chLane,chLanePos,chLaneFrom,chLaneChangeLeft,chScore,chPassed,chNear,chDistance,chAssisted}`；旧档缺 `mode` 按经典恢复；刷新后恢复同一关同一时隙/车道/过渡/得分。不新增 localStorage key、不改 key/Schema。
- **assisted**：挑战内 0.7 限量道具被禁用（见 §4 差异），正常游玩不会产生 assisted；管线已实现并可被 `forceStageClear(true)` 验证（结算显示「辅助」徽标）。

## 3. `#test` 钩子（契约 §5）

保留全部既有钩子（info/joyInfo/useJoyTool/forceCollision/setDist/stressSpawn）；新增：

- `challengeStages() → [{id, stageNumber, title, unlocked, best}]`
- `startChallenge(ref) → boolean`（stageId / 1-based / 0-based，受解锁约束）
- `challengeInfo() → {mode, stageId, stageIndex, state, elapsedSec, durationSec, objective, decision, cleared, collectibles, assisted, score, distance, goalDistance, lane, lanePos, passedSlots, nearPasses, error, failedSlot}`
- `stageObservable() → {mode, stageId, simTime, durationSec, lane, lanePos, score, distance, goal, laneChangeTimeSec, slots[{slot,atSec,passAt,occupiedLanes,optionalNearPassBonusLanes}], checkedSlots, passedSlots, nearPasses, failedSlot}`
- `forceStageClear(assisted=false) → boolean` / `forceStageFail(reason) → boolean` / `exitChallenge() → boolean`
- 兼容扩展：`forceCollision()` 在挑战模式触发失败（用于旧场景兼容）；经典行为不变。

## 4. 设计差异（原值 → 新值 → 原因）

| 项目 | 原设计 | 实现 | 原因 |
| --- | --- | --- | --- |
| 挑战内 0.7 限量道具 | 设计包未要求道具；契约 §4.8 只规定“使用限量道具时记录 assisted” | **挑战模式禁用「防撞气囊」「车流慢放」**（按钮禁用 + Toast 提示），经典模式不变 | 固定车阵下气囊会吃掉唯一一次碰撞、慢放会改变车流相对速度，使参考解与碰撞归因不可复现；禁用后挑战内必然无 assisted，`assisted` 管线保留 |
| 生命/失败语义 | 设计只给 `goal.type=survive-all-slots`，未规定生命数 | **挑战单次碰撞立即失败**（1 条命） | 固定路书强调“路线正确性”；多次容错会削弱 `safeLaneBySlot` 参考解的证明价值；经典模式 3 命不变 |
| 碰撞判定时刻 | `pathProofModel` 只给离散车道；策划备注要求“把相邻车道过渡也纳入碰撞测试” | 车辆在 `passAt`（时隙结束）到达；判定 `|lanePos - occupiedLane| <= 0.5`，`lanePos` 包含 0.22s 变道过渡 | 既保留“提前变道”的可读节奏，又能在过渡未完成时判碰撞；参考解在上一时隙结束后 0.03s 立即变道，过渡 0.22s 远早于下一次 `passAt` |
| 车流视觉 | 时间轴只给 `occupiedLanes` | 每段车辆从地平线驶到玩家段的视觉动画（z 由 `(simTime-atSec)/slotDuration` 驱动），仅视觉，不参与碰撞位置判定 | 让固定时间轴可读；碰撞窗口固定在 `passAt`，避免“视觉位置与判定不一致”的隐性不公平 |
| 挑战分数/距离 | 设计给 scoreRules 与 minDistanceMeters | 分数与距离在 HUD/结算显示；`timeSec` 为通关模拟时长；**分数不写入挑战记录**（平台 Schema 仅 timeSec/assisted/collectibles） | 不扩展平台存储 Schema；记录口径跨游戏统一 |
| 距离目标达成方式 | `goal.type=survive-all-slots` + `minDistanceMeters` | 距离按时间线性映射到 `minDistanceMeters`，走完所有时隙即达标；另有防死循环兜底（若到时距离不足则失败） | 数据同时给“存活全部时隙”和“最小距离”，两者在通关时等价；兜底防御异常时间轴 |
| 车道编号文案 | 数据 lane 为 0-based | 内部按 0-based 计算；失败文案显示「第 N 车道」= index+1 | 与玩家认知一致，避免“第 0 车道” |
| 计时器/暂停 | 设计验收要求 AFK 不推进 | 模拟时间 `chSimTime` 只在 `state==='playing'` 推进；暂停/失焦由共享 loop 暂停 | 与 0.8 暂停契约一致，CH-RR-004 验证 |

其余数据（laneCount/startLane/slotDurationSec/laneChangeTimeSec/timeline/goal/scoreRules）逐关与设计源一致，未调整数值、未增删时隙。

## 5. 证据等级与实测命令

| 场景 | 覆盖 | 证据等级 |
| --- | --- | --- |
| `CH-RR-001` | 6 关数据、C01 解锁/C02+ 锁定、真实点击选关面板、返回开始、320×568 无溢出、关卡按钮 ≥44px | engine-replay |
| `CH-RR-002` | **C01 参考通关**：按 `safeLaneBySlot` 逐时隙用真实触摸按钮变道走完 12 时隙；changes=7、score=95、nearPasses=5、distance=540、无碰撞；记录/最佳写入、C02 解锁 | **real-input-replay** |
| `CH-RR-003` | C01 保持起始车道 → 第 3 段真实碰撞失败（failedSlot=3，「第 2 车道有车…」）；「重试本关」1 次点击回 C01 起点 | engine-replay |
| `CH-RR-004` | 暂停 700ms 模拟时间不推进（1.03→1.03）；刷新「继续上次」→ 恢复同一关同一时隙；暂停 btn2「退出挑战」 | engine-replay |
| `CH-RR-005` | 经典回归：主按钮/距离 HUD/5000m 目标推进、挑战记录不写入；390×844 无溢出 | engine-replay |
| `CH-RR-006` | `forceStageClear(true)`：通关/最佳/辅助标记写入；挑战不写经典最高分与局数、不写 playtime 轮次；退出回选关 | engine-replay |
| `CH-RR-007` | **C01–C06 全关参考解真实变道通关**：每关先做数据级车道证明（车道差 ≤1、参考车道未被占用），再在引擎中逐时隙真实变道；总变道 38 次，距离 [540,680,820,960,1100,1240]m；记录 6 条 | **real-input-replay** |

```powershell
# 内联脚本语法（抽取最后一个内联 <script> 后 node --check）
node -e "const fs=require('fs');const s=fs.readFileSync('apps/arcade/games/road-rush.html','utf8');const m=[...s.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)];fs.writeFileSync(process.env.TEMP+'/rr-inline.js',m[m.length-1][1])"
node --check "$env:TEMP/rr-inline.js"            # exit 0
node --check tools/challenge/road-rush.mjs        # exit 0

$env:ARCADE_GAMEPLAY_PORT='8804'; $env:ARCADE_GAMEPLAY_CDP_PORT='9404'
node tools/arcade_gameplay_test.mjs --game=road-rush --repeat=1
# → 7/7 scenario runs passed，exit 0
node tools/arcade_gameplay_test.mjs --game=road-rush --repeat=2
# → 14/14 scenario runs passed，exit 0
#   CH-RR-002: changes=7, passedSlots=12, score=95, nearPasses=5, distance=540, evidence=real-input-replay
#   CH-RR-003: failedSlot=3, error=第 3 段：第 2 车道有车，变道没有在车辆到达前完成, retryAt=0
#   CH-RR-004: pausedAt=1.03, resumedAt=1.03
#   CH-RR-006: bestTimeSec=13.8, assisted=true
#   CH-RR-007: stages=6, totalChanges=38, distances=[540,680,820,960,1100,1240]

node tools/arcade_gameplay_test.mjs --suite=base
# → 11/11 scenario runs passed，exit 0（0.8 基座未被本页改动破坏）
py -3 tools/validate_site.py
# → PASS: StudioKit validation succeeded，exit 0（平台 Agent 更新后的校验）
```

截图（`test-artifacts/`，gitignore）：`gameplay-CH-RR-001.png`（选关/320）、`gameplay-CH-RR-002.png`（C01 通关结算）、`gameplay-CH-RR-007.png`（末关结算）。已人工查看 CH-RR-002 截图：挑战 HUD（C01/目标 540m/路段 12/12/用时）、结算用时/最佳/收集物、下一关/重玩按钮正常，无溢出。

## 6. UNVERIFIED / 风险

- **真机 iOS/Android 未测试**（UNVERIFIED）：变道按钮为真实 PointerEvent 点击，真实手指滑动/双手操作/安全区需真机确认。
- **全部 6 关仅无头 Chrome 回放**：CH-RR-007 全关为真实输入 + 真实引擎时间轴（每关 12–14 时隙），但人类节奏下的读招/手感、60fps 车流动画表现未做真机或长时间试玩。
- **挑战内禁用 0.7 道具**：属于对设计包的有意偏差（§4）；若 Owner 要求挑战内可用气囊/慢放，需要重新定义它们与固定车阵碰撞的交互并更新参考解/失败归因。
- **分数与最佳综合表现不持久化**：挑战记录只有用时/辅助/收集物；分数字段若被要求进入记录，需平台扩展 `A.Challenge` Schema。
- **碰撞判定的“视觉一致性”**：车流动画从地平线到玩家段，判定固定在 `passAt`；碰撞瞬间视觉车可能与玩家车相距约一个车身，需要试玩确认可读性（已在失败弹层给车道/时隙归因）。
- **长 AFK**：CH-RR-004 验证 700ms 暂停不推进；≥5 分钟锁屏后真机后台回收未验证。
- **完整 85 项 `arcade_smoke` 未由本 Agent 运行**（Lead 统一跑）：本页只追加挑战分支、`mode:'classic'` 存档字段与挑战入口；经典开始/暂停/续玩/道具逻辑保持原实现，CH-RR-005 + base suite 已覆盖关键路径。
- **挑战数据导出/导入**：由平台 `A.Challenge.exportData/importData` 统一处理（本页不直接读写 storage）；游戏级未单独回归。

## 7. Reviewer 结论占位

- Verdict：待 T057 独立评审。
- 建议复核点：CH-RR-002/007 的真实变道回放日志与截图、C01 参考解与失败路径归因、`lanePos` 过渡判定的公平性（0.22s 是否足够）、挑战 HUD 与安全车道预告可读性、320/390 截图、classic 主按钮与 HUD 隐藏切换。
