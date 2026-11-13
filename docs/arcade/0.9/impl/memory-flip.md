# 记忆翻牌（memory-flip）0.9 挑战模式实现记录

> 任务：T045（GP003 之后的 0.9 关卡落地，记忆/蛇组）。分支 `feat/arcade-0.8-gameplay`（0.8/0.9 合并开发）。
> 设计源（只读）：`docs/arcade/0.9/levels/memory-flip.json`、`docs/arcade/0.9/levels/stages/memory-flip-C01..C06.json`、`docs/arcade/0.9/docs/memory-flip.md`。
> 运行时数据（平台生成物，未手改）：`apps/arcade/challenge/memory-flip.js`；测试夹具：`tools/testdata/challenge/memory-flip.json`。
> 实现文件：`apps/arcade/games/memory-flip.html`；测试模块：`tools/challenge/memory-flip.mjs`。

## 1. 支持的字段

| 设计字段 | 支持 | 实现说明 |
| --- | --- | --- |
| `grid.rows/cols` | ✅ | 挑战盘面按 `rows×cols` 动态布局（C01 2×3 … C06 4×4），复用经典 `computeLayout` 自适应尺寸 |
| `faces[][]` | ✅ | 固定牌面按行/列原样加载；每符号恰好两张由数据保证（测试逐关按 `stageObservable().cards` 复核） |
| `previewSeconds` | ✅ | 每关独立预览时长（2.8–4.5s）；前 0.6s 不可跳过，之后点击画面跳过 |
| `maxMismatches` | ✅ | 每关独立上限；翻错次数 **超过** 上限即失败（C01=4 → 第 5 次翻错失败），失败文案带次数与上限 |
| `turnRules.flipTwo` | ✅ | 两张相同保持翻开；不同则 0.7s 后翻回；已配对牌不可再翻 |
| `turnRules.pauseDuringMismatchedFlip` | ✅ | 暂停/失焦时计时冻结，恢复后继续 0.7s 翻回 |
| `turnRules.matchedCardsCannotFlipAgain` | ✅ | 已配对牌点击无效（`reveal()` 提前返回） |
| `goal.type=match-all` | ✅ | 全部配对 → `state='cleared'` → `A.Challenge.markCleared` |
| `clues.hintText` | ✅ | 显示在挑战 HUD「线索：…」；结算/目标同时可见 |
| `clues.previewMode=row-by-row` | ✅ | 按 `previewEachRowSec`（缺省 `previewSeconds/rows`）逐行揭示 |
| `clues.previewMode=quadrants` | ✅ | 按 `previewEachQuadrantSec`（缺省 `/4`）按象限顺序揭示 |
| `layoutTransforms[]` | ✅（identity 默认） | 实现 `identity` / `mirror-horizontal` / `mirror-vertical` 三种整盘变换函数；**当前挑战固定取 identity**（数据列表均含 identity），见 §4 设计差异 |
| `transformsApplyToEntireBoard` | ✅ | 变换按整盘应用（函数层面），若启用非 identity 会同步 faces，线索文案保持不变 |
| `progressPersist` | ✅ | 存档保存已配对/mismatch/flipped/preview 计时/用时；刷新续玩恢复同一关同一状态 |
| `requiredFeatures[]` | ✅ | `fixed_memory_board`（固定 faces）、`cognitive_clue_mode`（线索/分区预览） |

## 2. 挑战流程与 UI（按 INTEGRATION-CONTRACT §4）

- **入口**：开始弹层主按钮「开始游戏」保持经典不变；第二入口 `[data-ov-btn2]` =「挑战 6 关」（数据缺失时禁用并显示「挑战数据不可用」，fail closed）。
- **选关**：页面内 `.ac-challenge-panel`（`A.Challenge.stageListHtml` 生成，初始隐藏），6 个 `.ac-stage-btn[data-stage-id]`；锁定关 `disabled + .is-locked`；显示 Cxx 标题、最佳、✅；`返回开始` 按钮回开始弹层。
- **关卡内**：`[data-ch-hud]` 显示 `Cxx 标题 · 目标 · [线索] · 用时 · 翻错 n/max`；经典分数/最高 HUD 用 `hidden` 隐藏；canvas 同步绘制目标与进度。
- **状态机**：`ready → playing → paused → playing → cleared | failed`；暂停弹层 btn2 =「退出挑战」（回选关）；`visibilitychange/blur` 自动暂停且不推进计时。
- **失败**：可归因文案（翻错超限 / 测试注入原因）+ 主按钮「重试本关」（1 次点击）+ btn2「返回选关」。
- **通关**：`A.Challenge.markCleared({timeSec, assisted, collectibles})`；结算用 `A.Challenge.resultHtml`；S1/S2 主按钮「下一关」、C06「返回选关」，btn2「重玩本关」。
- **assisted**：挑战中使用 0.7 道具（再看一眼/灵犀提示）→ 本关结果 `assisted:true`，结算显示「辅助」，经典最高分不受影响。
- **记录边界**：挑战不调用 `Progress.recordPlay`，不写 `progress:v1` 最高分、不写 `playtime:v1` 轮次。
- **存档**：`runs:v1.data` 增加 `mode / stageId / chElapsed / chMismatches / chAssisted`；旧档缺 `mode` 按经典恢复；`mode:'challenge'` 恢复同一关、已配对、翻错、预览计时、翻开状态。不新增 localStorage key。

## 3. `#test` 钩子（契约 §5）

保留全部既有钩子；新增：

- `challengeStages() → [{id, stageNumber, title, unlocked, best}]`
- `startChallenge(ref) → boolean`（stageId / 1-based / 0-based，受解锁约束）
- `challengeInfo() → {mode, stageId, stageIndex, state, elapsedSec, objective, cleared, collectibles, assisted, mismatches, maxMismatches, pairsMatched, pairsTotal, previewTimer, errorReason}`
- `stageObservable() → {mode, stageId, state, rows, cols, faces, cards(含 rect/x/y/w/h), matched, flippedIds, previewTimer, mismatchTimer, mismatches, maxMismatches, clues, layoutTransform, assisted, cleared}`
- `forceStageClear(assisted=false) → boolean` / `forceStageFail(reason) → boolean` / `exitChallenge() → boolean`

## 4. 设计差异（原值 → 新值 → 原因）

| 项目 | 原设计 | 实现 | 原因 |
| --- | --- | --- | --- |
| 布局变换默认值 | C03–C06 `layoutTransforms` 列 identity/镜像，供重玩变化 | 三种变换函数已实现，但挑战固定 identity | `tools/testdata/challenge/memory-flip.json` 的 referencePlan 按 identity 坐标给出；自动测试与参考通关需要确定性盘面。非 identity 可作为后续“重玩变化”开关（需同步更新线索与测试夹具） |
| 预览可跳过 | 设计未规定可跳过 | 前 0.6s 禁止跳过、之后点击可跳过 | 沿用经典操作契约，减少等待；不影响配对正确性 |
| 目标展示 | 首次进入 3 秒内提示 | 挑战 HUD 常驻目标 + canvas 目标行（不自动消失） | 常驻更利于 AFK 回来继续；不遮挡牌面操作 |
| 线索展示位置 | 设计仅给字段 | 挑战 HUD「线索：…」+ 分区预览生效 | 让 C03/C05 的 row-by-row/quadrant 认知辅助可被玩家感知 |
| 挑战 `score` | 设计无数值分 | 不显示分数，仅用时/翻错/配对；经典分数逻辑不变 | 避免挑战污染经典最高分，同时保留“更快更少错”的可比较记录 |

其余数据（faces/previewSeconds/maxMismatches/clues/turnRules/goal）逐关与设计源一致，未调整数值。

## 5. 证据等级与实测命令

| 场景 | 覆盖 | 证据等级 |
| --- | --- | --- |
| `CH-MF-001` | 6 关数据、锁定/解锁、选关面板真实点击进入 C01、HUD 切换 | engine-replay |
| `CH-MF-002` | C01 参考通关：按 `stageObservable().cards` 的符号配对表**真实指针点击**像素坐标完成 3 对 | **real-input-replay** |
| `CH-MF-003` | C02 翻错超限（5 > 上限 4）真实翻牌 → 失败可归因 + 1 次点击重试 | engine-replay |
| `CH-MF-004` | 暂停 → 刷新 → 续玩恢复同一关/已翻开牌/HUD | engine-replay |
| `CH-MF-005` | 使用「再看一眼」→ assisted=true 写入记录；`layoutTransform/clues/faces` 可观测 | engine-replay |
| `CH-MF-006` | 经典 6 关/开始按钮回归 + 320×568 / 390×844 无横向溢出、挑战入口 ≥44px | engine-replay |

```powershell
# 内联脚本语法（抽取 <script> 后 node --check）
node -e "const fs=require('fs');const s=fs.readFileSync('apps/arcade/games/memory-flip.html','utf8');fs.writeFileSync(process.env.TEMP+'/mf-inline.js',[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n'))"
node --check "$env:TEMP/mf-inline.js"          # exit 0

$env:ARCADE_GAMEPLAY_PORT='8803'; $env:ARCADE_GAMEPLAY_CDP_PORT='9403'
node tools/arcade_gameplay_test.mjs --game=memory-flip --repeat=2
# → 12/12 scenario runs passed，exit 0（6 场景 ×2）
#   CH-MF-002: pairs=3, timeSec=2.4, evidence=real-input-replay
#   CH-MF-003: reason=翻错 5 次，超过本关上限 4 次
#   CH-MF-004: stage=memory-flip-C01, flipped=1
#   CH-MF-005: assisted=true, transform=identity
#   CH-MF-006: widths=320:320/320 390:390/390
node tools/arcade_gameplay_test.mjs --suite=base --repeat=2   # → 12/12 PASS（base suite 当前由 T056 维护，5 个 pending）
```

## 6. UNVERIFIED / 风险

- **真机 iOS/Android 未测试**（UNVERIFIED）：触摸命中按逻辑坐标模拟，真实手指尺寸/滚动/安全区表现需真机确认。
- **非 identity 布局变换未启用**：C03–C06 的重玩镜像变化未作为默认行为；启用前需同步线索与测试夹具（见 §4）。
- **长时间 AFK**：暂停/失焦不推进计时由 `bindPause`/visibility 机制保证，但 ≥5 分钟锁屏后的恢复仅在本机无头 Chrome 验证，真机后台回收未验证。
- **完整 85 项 smoke 未由本 Agent 运行**（Lead 统一跑）：本页 classic 分支只增加了 `mode:'classic'` 存档字段与挑战入口按钮，经典开始/暂停/续玩/道具逻辑未改；CH-MF-006 与 base suite 已覆盖开始弹层、存档恢复与 320/390。
- 挑战记录与导出/导入由平台 `A.Challenge` 统一处理（本游戏不直接读写 storage）；导出/导入回归由平台与 Lead 覆盖。

## 7. Reviewer 结论占位

- Verdict：待 T057 独立评审。
- 建议复核点：C01 真实点击通关录像/截图（`test-artifacts/gameplay-CH-MF-002.png`）、翻错超限文案、assisted 记录、320/390 截图。
