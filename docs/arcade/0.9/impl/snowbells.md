# 雪铃（snowbells）0.9 挑战模式实现记录

> 任务：T048（0.9 关卡落地，记忆/蛇组延伸）。分支 `feat/arcade-0.8-gameplay`（0.8/0.9 合并开发）。
> 设计源（只读）：`docs/arcade/0.9/levels/snowbells.json`、`docs/arcade/0.9/levels/stages/snowbells-C01..C06.json`、`docs/arcade/0.9/docs/snowbells.md`。
> 运行时数据（平台生成物）：`apps/arcade/challenge/snowbells.js`；夹具：`tools/testdata/challenge/snowbells.json`。
> 实现：`apps/arcade/games/snowbells.html`；测试模块：`tools/challenge/snowbells.mjs`。

## 1. 支持的字段

| 设计字段 | 支持 | 实现说明 |
| --- | --- | --- |
| `content.bells[]`（id/xCenter/height/kind/radius/consumable） | ✅ | 固定铃铛按数据加载；世界坐标 `y = (H-120) - height`（首铃 A 在雪台高度 620，其余向上）；`kind` 支持 normal/rest/blue/red/bonus |
| `startBell` | ✅ | 挑战开局把兔子放在 `startBell` 正上方，下落即命中首铃 |
| `requiredSequence[]` | ✅ | 严格按顺序推进 `seqIndex`；只有当前目标铃可被消耗；C03 起含休止铃 |
| `wrongBellPolicy` | ✅ | 错序铃：可反弹但不计分、**不消耗**该铃（后续仍可命中），连击中断、`wrongHits++`，HUD 持续显示下一正确目标 |
| `comboBreakPolicy` | ✅ | 落空/错序清除连击；普通通关可继续（不因一次错序直接失败） |
| 休止铃 `kind:'rest'` | ✅ | 参与 requiredSequence 推进，可反弹但不加连击/不计分 |
| 彩铃 `kind:'bonus'`（C04 q1/q2、C06 q1） | ✅ | 可选收集：命中后写入 `collectibles`，不推进序列；裁决/记录只用于探索 |
| `completion` / `goalAfterLast` | ✅ | 命中最后一颗必需铃后立即 `state='cleared'` → `A.Challenge.markCleared` |
| 蓝/红铃（C05/C06） | ✅ | 保留 kind 视觉区分；按 requiredSequence 顺序判定 |
| 坐标约束（间距/可达） | ✅ | 高度差 60–77 ≤ 单次弹跳上升上界 159；参考通关按真实按键验证可达（CH-SB-002） |
| `requiredFeatures: stage_bell_sequence` | ✅ | 固定铃序列 + 顺序判定 |
| 挑战内禁随机 | ✅ | 挑战不调用经典 `ensureBells`/随机生成；无新铃生成 |

## 2. 挑战流程与 UI（INTEGRATION-CONTRACT §4）

- **入口**：主按钮「开始游戏」保持经典；`[data-ov-btn2]` =「挑战 6 关」（数据缺失时禁用并显示「挑战数据不可用」）。
- **选关**：`.ac-challenge-panel`（`A.Challenge.stageListHtml` 生成，初始隐藏）、6 个 `.ac-stage-btn[data-stage-id]`、锁定 disabled+`.is-locked`、最佳/✅、`返回开始`。
- **关卡内**：`[data-ch-hud]` 显示 `Cxx 标题 · 目标 · 下一铃 · 进度 · 连击/错序 · 用时`；canvas 顶部高亮下一铃并绘制目标/进度；经典分数/最高 HUD 隐藏。
- **状态机**：`ready → playing → paused → playing → cleared | failed`；暂停 btn2「退出挑战」；失焦/切后台自动暂停且不推进计时。
- **失败**：兔子落空坠出画面 → 「落空坠回雪地…」可归因 + 主按钮「重试本关」（1 次点击）+ btn2「返回选关」。
- **通关**：`markCleared({timeSec, assisted, collectibles})`；结算 `resultHtml` + 彩铃/目标提示；C01–C05「下一关」、C06「返回选关」，btn2「重玩本关」。
- **assisted**：挑战中使用铃磁/安可 → `assisted:true`；经典最高分不受影响。
- **记录边界**：挑战不写 `progress:v1` 最高分、不写 `playtime:v1` 轮次。
- **存档**：`runs:v1.data` 增加 `mode/stageId/chSeqIndex/chCombo/chWrongHits/chCollectibles/chConsumed/chElapsed/chAssisted/player`；旧档缺 `mode` 按经典恢复；挑战刷新恢复同关、已踩铃声/进度/连击/兔子位置。

## 3. `#test` 钩子（契约 §5）

保留全部既有钩子（`info/joyInfo/useJoyTool/forceHit`）；新增：

- `challengeStages() → [{id, stageNumber, title, unlocked, best}]`
- `startChallenge(ref) → boolean`
- `challengeInfo() → {mode, stageId, stageIndex, state, elapsedSec, objective, cleared, collectibles, assisted, seqIndex, seqTotal, nextBellId, combo, wrongHits, errorReason}`
- `stageObservable() → {mode, stageId, state, bells[{id,x,y,kind,consumed,optional}], sequence, seqIndex, nextBellId, combo, wrongHits, collectibles, player, elapsedSec, assisted, goalStatement, errorReason, cleared}`
- `forceStageClear(assisted=false)` / `forceStageFail(reason)` / `exitChallenge()`

## 4. 设计差异（原值 → 新值 → 原因）

| 项目 | 原设计 | 实现 | 原因 |
| --- | --- | --- | --- |
| 世界坐标原点 | `height` 相对起点向上，未给绝对原点 | 首铃 y = H-120（雪台高度 620），其余 `620-height` | 经典雪台在 `H-150` 附近；固定原点让 6 关坐标可离线复算、全部铃在 420×740 内（最高 445 → 屏幕 y≥175），挑战不需要滚动 |
| 下一目标提示时长 | wrongBellPolicy 写「0.8s 内显示下一个正确目标」 | 下一目标常驻高亮 + HUD 进度 | 常驻更适配 AFK/触屏；错序时仍只提示、不强制暂停，行为等价或更清晰 |
| 失败判定 | 设计只说落空/错序失去完美奖励、普通通关可恢复 | 兔子坠出画面判失败（错序仍可恢复，不直接失败） | 挑战固定铃序列必须给出可归因失败与 1 次点击重试；错序按设计可恢复 |
| 彩铃收益 | 可选高分路线 | 只记录 collectibles，不写经典分/不设跨局战力 | 挑战记录只用 timeSec/assisted/collectibles；避免挑战污染经典分数 |
| 连击与记录 | comboBreakPolicy 语义 | combo 仅用于即时反馈，不写入 `challenge:v1` | 记录 Schema 只覆盖时间/辅助/收集；完美与否由错序次数在关卡内反馈 |
| 挑战内随机 | 禁随机 | 挑战完全不生成新铃、不掷点 | 固定序列可复现（逐关 `requiredSequence` 与 `bells` 原样） |

铃坐标、序列、休止/彩铃位置与设计源逐关一致，未调整数值。

## 5. 每关证据等级与实测

| 场景 | 覆盖 | 证据等级 |
| --- | --- | --- |
| `CH-SB-001` | 6 关数据/锁定、选关面板真实点击进入 C01、固定铃坐标/顺序/HUD | engine-replay |
| `CH-SB-002` | C01 按 `requiredSequence`（A→B→C→D）**真实左右方向键**逐铃踩中（真实碰撞反弹/可达性） | **real-input-replay** |
| `CH-SB-003` | 落空坠落失败可归因 + 1 次点击重试回 C01 起点 | engine-replay |
| `CH-SB-004` | 暂停 → 刷新 → 续玩恢复同关/已踩铃进度 | engine-replay |
| `CH-SB-005` | C03 两个休止铃结构、C04 两枚彩铃 optional、铃磁 assisted 记录 | engine-replay |
| `CH-SB-006` | 经典随机铃回归 + 320×568 / 390×844 无横向溢出、挑战入口 ≥44px | engine-replay |

C02–C06 的参考顺序结构与 C01 同一套顺序判定代码；本轮只有 C01 做真实输入回放（见 UNVERIFIED）。C03/C04 的结构与 rest/bonus 行为已在 CH-SB-005 断言。

```powershell
# 内联脚本 node --check（抽取 <script>）
node -e "const fs=require('fs');const s=fs.readFileSync('apps/arcade/games/snowbells.html','utf8');fs.writeFileSync(process.env.TEMP+'/sb-inline.js',[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n'))"
node --check "$env:TEMP/sb-inline.js"        # exit 0

$env:ARCADE_GAMEPLAY_PORT='8806'; $env:ARCADE_GAMEPLAY_CDP_PORT='9406'
node tools/arcade_gameplay_test.mjs --game=snowbells --repeat=2
# → 12/12 scenario runs passed，exit 0（6 场景 ×2）
#   CH-SB-002: seq=4, timeSec=2.7, evidence=real-input-replay
#   CH-SB-003: reason=落空坠回雪地：先预判下一颗铃的横向位置再起跳
#   CH-SB-004: stage=snowbells-C01, seqIndex=1
#   CH-SB-005: restBells=2, optionalBells=2, assisted=true
#   CH-SB-006: widths=320:320/320 390:390/390
node tools/arcade_gameplay_test.mjs --suite=base --repeat=2   # → 22/22 PASS（T056 维护的 base suite）
```

## 6. UNVERIFIED / 风险

- 真机 iOS/Android 与多点触控未测试（UNVERIFIED）：无头 Chrome 用逻辑坐标/键盘模拟，真实手指命中/滚动需真机。
- C02–C06 **未逐关做真实输入回放**：仅 C01 真实按键通关；其余关卡按同一顺序判定与固定数据驱动，结构由 CH-SB-005 / CH-DATA-001 覆盖。交付前需 Reviewer/真人试玩逐关确认可达。
- 完整 85 项 smoke 与 13 游戏全量 challenge suite 由 Lead 统一跑；本 Agent 未跑完整 smoke。
- 挑战中错序不会硬失败（按设计可恢复），因此“完美通关”仅通过 wrongHits 在关卡内反馈，未写入 `challenge:v1`。

## 7. Reviewer 结论占位

- Verdict：待 T057 独立评审。
- 建议复核点：C01 真实按键通关截图/录像（`test-artifacts/gameplay-CH-SB-002.png`）、C03 休止铃、C04 彩铃可选、assisted 记录、320/390 截图、C02–C06 真人可达性。
