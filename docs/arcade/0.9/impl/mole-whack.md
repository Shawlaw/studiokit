# 打地鼠（mole-whack）0.9 挑战模式实现记录

> 任务：T046 / task-11（时间轴型游戏组；`docs/arcade/0.9/PLAN.md` 中对应 LD90-MOLE / T048）。
> 分支 `feat/arcade-0.8-gameplay`（0.8/0.9 合并开发，未发布）。
> 设计源（只读，未改）：`docs/arcade/0.9/levels/mole-whack.json`、`docs/arcade/0.9/levels/stages/mole-whack-C01..C06.json`、`docs/arcade/0.9/docs/mole-whack.md`。
> 运行时数据（平台生成物，未手改）：`apps/arcade/challenge/mole-whack.js`；测试夹具：`tools/testdata/challenge/mole-whack.json`。
> 实现文件：`apps/arcade/games/mole-whack.html`；测试模块：`tools/challenge/mole-whack.mjs`。
> 边界：未改 `engine.js` / `arcade.css` / `sw.js` / `validate_site.py` / 其它游戏 / 设计源；未新增 localStorage key；未跑 build/完整 smoke；未做 git 操作。

## 1. 支持的字段

| 设计字段 | 支持 | 实现说明 |
| --- | --- | --- |
| `content.grid`（rows/cols/slotOrder） | ✅ | 挑战沿用经典 3×3 洞位（`HOLES` row-major 0–8）；`slot` 直接映射洞位序号。逐关校验 `rows/cols=3/3` 后进入；数据不合法时该关不可进入（fail closed 由 `A.Challenge.stages()` 的 6 关完整性检查承担） |
| `content.stageDurationSec` | ✅ | 本关模拟时长（C01 30s → C06 38s）；`elapsedSec >= durationSec` 时统一结算 |
| `content.events[].id` | ✅ | 事件稳定 ID；用于参考解（`referencePlan.hitEventIds`）、存档 `chEvents[{id,hit,missed}]` 与 `stageObservable().events` |
| `content.events[].atSec` | ✅ | 事件出现时刻（暂停感知模拟时钟；`playing` 且页面可见时才推进） |
| `content.events[].slot` | ✅ | 出现洞口（0–8，row-major） |
| `content.events[].kind` | ✅ | `normal` / `gold` / `bomb` / `decoy` 四类；假目标（decoy）灰色虚线轮廓 + × 眼 + 「假」字，与真鼠/金鼠/炸弹明显区分 |
| `content.events[].prewarnSec` | ✅ | 提前 `prewarnSec` 秒在洞口画金色脉冲预兆环（可预测前摇） |
| `content.events[].visibleSec` | ✅ | 可点击窗口 `[atSec, atSec+visibleSec)`；窗口结束未点中记 `missed`（不扣分） |
| `content.events[].score` | ✅（含回落规则） | 事件自带非 0 `score` 时优先使用；`normal/gold` 数据为 1/2 直接生效。**炸弹/假目标数据 `score:0` 时回落到 `content.scoring.bomb=-3` / `decoy=-1`**（否则负分语义丢失，见 §4 设计差异） |
| `content.scoring` | ✅ | `bomb:-3`、`decoy:-1` 生效；`normal/gold` 以事件 `score` 为准（与 `scoring` 1/2 一致）；`miss:0` 表示空点不扣分 |
| `content.tapRule` | ✅ | 仅洞口半径内（`HOLE_R+22`）判定；每个事件最多命中一次（`event.hit` 后不再响应） |
| `content.time` | ✅ | 使用暂停感知逻辑时钟：`state!=='playing'`（暂停/失焦/后台）时不推进；页面 blur/visibilitychange 由共享 loop 自动暂停 |
| `content.win.minValidHits` | ✅ | 结算时 `validHits >= minValidHits`（valid = normal+gold 命中） |
| `content.win.minGoldHits` | ✅ | 结算时 `goldHits >= minGoldHits` |
| `content.win.maxBombHits` | ✅ | 结算时 `bombHits <= maxBombHits`（设计均为 0，误触任一炸弹即失败） |
| `content.win.maxDecoyHits` | ✅ | 结算时 `decoyHits <= maxDecoyHits`（C05/C06 允许 1 次误触） |
| `stage.goalStatement / decision` | ✅ | 选关/开始后 3 秒内 `[data-ch-tip]` 展示；挑战 HUD 常驻目标与进度 |
| `stage.title / stageNumber` | ✅ | 选关按钮与 HUD 的 `Cxx 标题` |
| `referencePlan.hitEventIds` | ✅ | 测试模块按此逐事件真实点击；C01 为纯实时回放，C01–C06 为时钟辅助真实点击（见 §5） |
| `referencePlan.ignoreKinds` | ✅（按语义实现） | 炸弹/假目标不点击即忽略；误触按 scoring 扣分并计入 maxBomb/maxDecoy |
| `acceptance.*` | ✅ | 逐项有对应场景（见 §5）：成功/失败/移动端双指/AFK |

## 2. 挑战流程与 UI（按 INTEGRATION-CONTRACT §4）

- **入口**：开始弹层主按钮 `[data-ov-btn]`「开始游戏」保持经典行为不变；第二入口 `[data-ov-btn2]`「挑战 6 关」（挑战数据缺失/不足 6 关时显示「挑战数据不可用」并禁用，fail closed，不影响经典）。
- **选关**：`.challenge-layer` 内嵌 `.ac-challenge-panel`（由 `A.Challenge.stageListHtml('mole-whack')` 生成）；6 个 `.ac-stage-btn[data-stage-id]`，锁定关 `disabled + .is-locked`，显示 ✅/最佳用时；`[data-ch-back]`「返回开始」回开始弹层。
- **关卡内**：`.ac-challenge-hud[data-ch-hud]` 显示 `Cxx 标题 · 有效 n/min · 金 n/min · 用时 mm:ss / mm:ss`；经典 `.game-hud` 与 canvas 经典分数/连击/心数标签在挑战模式隐藏，canvas 改画挑战进度；首次 3 秒 `[data-ch-tip]` 显示 goalStatement + 决策提示。
- **状态机**：`ready → playing → paused → playing → cleared | failed`；外部读取状态为 `playing/paused/cleared/failed`；暂停沿用 `A.bindPause`，暂停弹层 btn2「退出挑战」回选关；`blur/visibilitychange` 自动暂停且不推进模拟时间。
- **失败**：结算统一在 `elapsedSec >= durationSec` 时按 win 条件判定；可归因文案如「未达标：有效命中 0/7 · 金鼠 0/1 · 炸弹 1/上限 0」；主按钮「重试本关」（1 次点击）+ btn2「返回选关」。
- **通关**：`A.Challenge.markCleared(gameId, stageId, {timeSec, assisted, collectibles:[]})`；结算用 `A.Challenge.resultHtml`；C01–C05 主按钮「下一关」、C06「返回选关」，btn2「重玩本关」。
- **记录边界**：挑战不调用 `Progress.recordPlay`，不写 `progress:v1` 最高分/局数、不写 `playtime:v1` 轮次（页面活跃 ms 仍由既有计时机制累计，符合契约 §3 说明）。
- **存档**：`runs:v1.data` 追加 `mode:'challenge' / stageId / challengeState{chElapsed,chScore,chValid,chGold,chBomb,chDecoy,chMiss,chAssisted,combo,comboTimer,hearts,chEvents[{id,hit,missed}]}`；旧档缺 `mode` 按经典恢复；刷新后恢复到同一关同一模拟时间与事件进度。不新增 localStorage key、不改 key/Schema。
- **assisted**：挑战内 0.7 限量道具被禁用（见 §4 差异），因此正常游玩不会产生 assisted；结算/记录管线已实现并可被 `forceStageClear(true)` 验证（结算显示「辅助」徽标）。

## 3. `#test` 钩子（契约 §5）

保留全部既有钩子（info/joyInfo/useJoyTool/setSlot/clearSlots/spawnNow/hitSlotNow）；新增：

- `challengeStages() → [{id, stageNumber, title, unlocked, best}]`
- `startChallenge(ref) → boolean`（stageId / 1-based / 0-based，受解锁约束）
- `challengeInfo() → {mode, stageId, stageIndex, state, elapsedSec, durationSec, objective, decision, cleared, collectibles, assisted, score, validHits, goldHits, bombHits, decoyHits, misses, error}`
- `stageObservable() → {mode, stageId, simTime, durationSec, goal, scoring, holes[{x,y,r}], events[{id,slot,kind,atSec,prewarnSec,visibleSec,score,state,hit,missed}], score, validHits, goldHits, bombHits, decoyHits, misses}`
- `forceStageClear(assisted=false) → boolean` / `forceStageFail(reason) → boolean` / `exitChallenge() → boolean`
- 测试辅助（非契约要求）：`setChallengeClock(sec)`（把模拟时钟跳到指定秒，仅用于失败/全关回放测试；真实通关证据不依赖它）、`tapHole(index)`

## 4. 设计差异（原值 → 新值 → 原因）

| 项目 | 原设计 | 实现 | 原因 |
| --- | --- | --- | --- |
| 挑战内 0.7 限量道具 | 设计包未要求道具；契约 §4.8 只规定“挑战中使用限量道具时记录 assisted” | **挑战模式禁用「金鼠三连」「安心锤」**（按钮禁用 + `A.showToast` 提示），经典模式不变 | 固定事件时间轴下，金鼠三连会改写脚本事件、安心锤会改写炸弹扣分语义，使参考解/评分不可复现；禁用后挑战内必然无 assisted，`assisted` 字段仍保留管线供 future 启用 |
| 炸弹/假目标分数来源 | 事件 JSON 中 `score:0`，`scoring` 中 `bomb:-3/decoy:-1` | 事件 `score` 非 0 时用之；为 0 时回落到 `scoring[kind]` | 数据原值保持零修改；验收工单要求「炸弹和假目标扣分正确（-3/-1）」，回落规则让两者同时成立 |
| 失败判定时机 | 设计只给 win 条件，未规定即时/结算判定 | **整关时长结束时统一判定** win 四项 | 保留完整事件窗口（C01 有效目标 8 个，目标 6 个，玩家可在末段补足）；避免早退导致「已达成仍被判失败」的歧义；失败文案列出全部未达标项 |
| 假目标视觉 | 设计只要求“可识别、假目标不提供分数” | 灰色半透明轮廓 + 虚线边框 + 红色 × 眼 + 「假」字；不新增颜色歧视风险 | 与普通/金鼠/炸弹在形状与纹理上区分，不只靠颜色 |
| 分数记录 | 设计给 scoring，但 `A.Challenge` 记录 Schema 仅 `timeSec/assisted/collectibles` | 分数只在 HUD 与挑战内显示；**不写入挑战记录** | 不扩展平台存储 Schema；若要记录分数需平台新增字段（跨游戏统一，本任务不改） |
| 预兆表现 | 「洞口闪动是可预测前摇」 | `prewarnSec` 期间洞口外圈金色脉冲环 | 把数据字段变成可读反馈；不改变判定窗口 |
| 双指并点 | 验收工单要求“两个同时有效目标可用双指点击” | 共享输入只跟踪一根画布指针，因此**挑战模式页内新增第二指针路径**：额外 pointerdown（`pointerId !== 主指针`）直接命中洞口；经典模式行为不变 | 不修改共享 `engine.js` 输入层（跨 13 游戏回归风险）；挑战内 C04/C05/C06 存在同秒多目标，必须支持 |
| 挑战内输入按键 | 未规定 | 保留 1–9 数字键直接敲对应洞口（与经典一致） | 键盘可完成；与触屏等价 |

其余数据（grid/events/win/scoring/tapRule/time/时长/主题/decision）逐关与设计源一致，未调整数值、未增删事件。

## 5. 证据等级与实测命令

| 场景 | 覆盖 | 证据等级 |
| --- | --- | --- |
| `CH-MW-001` | 6 关数据、C01 解锁/C02+ 锁定、真实点击选关面板、返回开始、320×568 无溢出、按钮 ≥44px | engine-replay |
| `CH-MW-002` | **C01 参考通关**：按事件 `atSec` 实时出现后真实指针点击洞口（8 次点击，validHits=8），记录/最佳写入、C02 解锁、通关弹层 | **real-input-replay** |
| `CH-MW-003` | C03 炸弹误触：-3 分、bombHits=1；快进到结束失败（有效 0/7、金鼠 0/1、炸弹 1/上限 0）；「重试本关」1 次点击回本关 | engine-replay |
| `CH-MW-004` | 暂停 700ms 模拟时间不推进（1.22→1.22）；刷新出现「继续上次」→ 恢复同一关同一模拟时间（1.22）；暂停 btn2「退出挑战」 | engine-replay |
| `CH-MW-005` | 经典回归：主按钮/45s/3 心/3×3 不变、挑战记录不写入；390×844 无溢出 | engine-replay |
| `CH-MW-006` | `forceStageClear(true)`：通关/最佳/辅助标记写入；挑战不写经典最高分与局数、不写 playtime 轮次；退出回选关 | engine-replay |
| `CH-MW-007` | C04 同秒双目标：双指 PointerEvent 并点两洞（slots 4/8，pair e2/e3），两个目标同时命中 validHits=2 | engine-replay（双指合成事件） |
| `CH-MW-008` | C01–C06 全关：数据可解性（有效事件 ≥ minValidHits、金鼠 ≥ minGoldHits）+ 时钟辅助真实点击回放 → 6/6 cleared、记录 6 条、总有效命中 57 | engine-replay（时钟辅助） |

```powershell
# 内联脚本语法（抽取最后一个内联 <script> 后 node --check）
node -e "const fs=require('fs');const s=fs.readFileSync('apps/arcade/games/mole-whack.html','utf8');const m=[...s.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)];fs.writeFileSync(process.env.TEMP+'/mw-inline.js',m[m.length-1][1])"
node --check "$env:TEMP/mw-inline.js"            # exit 0
node --check tools/challenge/mole-whack.mjs       # exit 0

$env:ARCADE_GAMEPLAY_PORT='8804'; $env:ARCADE_GAMEPLAY_CDP_PORT='9404'
node tools/arcade_gameplay_test.mjs --game=mole-whack --repeat=1
# → 8/8 scenario runs passed，exit 0
node tools/arcade_gameplay_test.mjs --game=mole-whack --repeat=2
# → 16/16 scenario runs passed，exit 0
#   CH-MW-002: clicks=8, validHits=8, elapsedSec=30, cleared=1, evidence=real-input-replay
#   CH-MW-003: bombAtSec=4, error=未达标：有效命中 0/7 · 金鼠 0/1 · 炸弹 1/上限 0, retryStage=mole-whack-C03
#   CH-MW-004: pausedAt=1.25, resumedAt=1.25
#   CH-MW-006: bestTimeSec=30, assisted=true
#   CH-MW-007: pair=[e2,e3], slots=[4,8], validHits=2
#   CH-MW-008: stages=6, totalHits=57

node tools/arcade_gameplay_test.mjs --suite=base
# → 11/11 scenario runs passed，exit 0（0.8 基座未被本页改动破坏）
py -3 tools/validate_site.py
# → PASS: StudioKit validation succeeded，exit 0（平台 Agent 更新后的校验）
```

截图（`test-artifacts/`，gitignore）：`gameplay-CH-MW-001.png`（选关/320）、`gameplay-CH-MW-002.png`（C01 通关）、`gameplay-CH-MW-007.png`（双目标/选关状态）。已人工查看 CH-MW-007 截图：选关 6 卡、锁定/最佳、返回按钮正常，无横向溢出。

## 6. UNVERIFIED / 风险

- **真机 iOS/Android 未测试**（UNVERIFIED）：双指并点为 CDP 合成 PointerEvent（pointerId 11/12），真实手指同时按下、系统手势冲突、安全区表现需真机确认。
- **C02–C06 未做“纯实时”整体回放**：CH-MW-008 使用 `setChallengeClock` 跳过等待、点击仍为真实指针；C01 为纯实时（`real-input-replay`）。因此 C02–C06 的「人类节奏下的可完成性」证据弱于 C01，需 T057/Owner 试玩补强。
- **挑战内禁用 0.7 道具**：属于对设计包的有意偏差（§4）；若 Owner 要求挑战内可用道具，需要重新定义金鼠三连与脚本事件的交互并更新参考解。
- **分数不持久化**：挑战记录只有用时/辅助/收集物；分数字段若被要求进入记录，需平台扩展 `A.Challenge` Schema。
- **长 AFK**：暂停/失焦不推进模拟时间已由 `bindPause`/visibility 机制保证并在 CH-MW-004 验证 700ms；≥5 分钟锁屏后真机后台回收未验证。
- **完整 85 项 `arcade_smoke` 未由本 Agent 运行**（Lead 统一跑）：本页只追加挑战分支、`mode:'classic'` 存档字段与挑战入口；经典开始/暂停/续玩/道具逻辑保持原实现，CH-MW-005 + base suite 已覆盖关键路径。
- **挑战数据导出/导入**：由平台 `A.Challenge.exportData/importData` 统一处理（本页不直接读写 storage）；游戏级未单独回归。

## 7. Reviewer 结论占位

- Verdict：待 T057 独立评审。
- 建议复核点：CH-MW-002 截图与 8 次真实点击时序、CH-MW-007 双指命中证据、C03 炸弹 -3 与失败文案、C01/C04/C06 的 win 阈值展示、320/390 截图、classic 主按钮与 HUD 隐藏切换。
