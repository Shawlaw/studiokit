# 俄罗斯方块 `block-drop` · 0.9 挑战模式实现记录（T044）

> 实现范围：`apps/arcade/games/block-drop.html`、`tools/challenge/block-drop.mjs`。
> 数据源：`apps/arcade/challenge/block-drop.js`（生成物，6 关）与 `tools/testdata/challenge/block-drop.json`（含 referencePlan/acceptance）。
> 契约：`docs/arcade/0.9/INTEGRATION-CONTRACT.md` §3–§6。经典模式（7-bag、40 行收局、换块/慢落道具、暂停/自动保存/续玩）未改动。
> 结论：**PASS（6/6 关真实输入回放通关；经典回归 11/11 场景与 CH-CLASSIC-001 全绿）**。Reviewer 结论：待填。

## 1. 挑战入口与流程

| 项 | 实现 |
| --- | --- |
| 入口 | 开始弹层 `[data-ov-btn]` 文案/行为保持「开始游戏」=经典；新增可见 `[data-ov-btn2]`「挑战 6 关」→ `.challenge-layer` 内 `.ac-challenge-panel` 选关（数据不可用时入口隐藏，面板显示「挑战数据不可用」） |
| 选关 | `A.Challenge.stageListHtml('block-drop')` 的 6 个 `.ac-stage-btn[data-stage-id]`（C01 恒开、C0N 需前关 cleared、显示 ✅ 最佳用时/🔒），页面本地「返回」按钮回开始弹层；面板默认 `hidden`（满足 CH-CLASSIC-001 门禁） |
| 关卡内 | 顶部 HUD：`[data-ch-hud]`（桌面）+ canvas 内 HUD（手机 ≤460px 时 DOM HUD 隐藏后仍可读）；首次进入 3 秒 `[data-ch-tip]` 显示 `goalStatement`、目标消行数与操作提示；经典分数/最高 HUD 在挑战中隐藏 |
| 状态机 | `ready → playing → paused → playing → cleared \| failed`；暂停沿用 `bindPause`，挑战暂停弹层 btn2「退出挑战」回选关；`visibilitychange/blur/pagehide` 由 `createLoop.onAutoPause` 自动暂停且不推进计时 |
| 失败 | 可归因文案（`出块次数用完`/`出块队列用完`/`方块堆到井口`）+ 本关 `goalStatement` + 主按钮「重试本关」（1 次点击）+ btn2「返回选关」 |
| 通关 | `A.Challenge.markCleared` → `A.Challenge.resultHtml` 结算（用时/最佳/收集物/辅助）；主按钮「下一关」（C06「返回选关」）、btn2「重玩本关」 |
| 存档 | `runs:v1` 的 `data` 增加 `mode:'challenge'`、`stageId`、`challenge:{queue,queueIndex,pieces,lines,target,maxPieces,elapsed,assisted}`；`restore()` 对缺 `mode` 的旧档按经典恢复；刷新/暂停恢复同一关同盘面同块序同步数；挑战不写 `progress:v1` 最高分与 `playtime:v1` 轮次 |
| assisted | 挑战中使用限量道具（换块/慢落）→ 本关 `assisted:true`，结算显示「辅助」徽章，`challenge:v1` best.assisted 记录 |

## 2. 设计字段支持矩阵（`content`）

| 字段 | 支持 | 实现说明 |
| --- | --- | --- |
| `boardWidth/boardHeight` | ✅ | 固定 10×20（与经典一致）；数据不符时 `startChallenge` 返回 false（fail closed） |
| `boardTopToBottom[20]` | ✅ | 逐字符解析：`#` → 预填块（统一色），`.` → 空；盘面底行与数据逐字一致（CH-BD-002 断言） |
| `pieceQueue[]` | ✅ | 固定出块序列（`I/O/T/S/Z/J/L`），挑战**不调用 7-bag**；`initialActivePiece` = 队列首块 |
| `holdEnabled:false` | ✅ | 经典无 hold，挑战同样无 hold |
| `gravityMode` | ✅（解释） | 保留经典自然重力（0.8s/格，无时间压力）+ 立即硬降/旋转；未新增倒计时 |
| `spawnPolicy` | ✅ | 只从 `pieceQueue` 出块，无随机 |
| `win.type:'clear-lines'` + `count` + `maxPlacedPieces` | ✅ | `chLines >= count` → 通关；`chPieces >= maxPlacedPieces` 或队列耗尽且未达标 → 失败 |
| `lose.type:'queue-exhausted-or-top-out'` | ✅ | 队列耗尽 / 出块次数用完 / 出生位置碰撞（top-out）→ 失败 |
| `pieceDefinitions` | ✅（校验用） | 用其归一化格集识别当前朝向名（`I-H/I-V/O-N/T-STEM-DOWN`），测试按参考计划旋转到目标朝向并断言，确保经典旋转系统支持设计所需朝向 |
| `coordinates` | ✅（解释） | 参考计划 `leftCol` 按“占用格最小列”解释（见 §4 差异 D1） |

## 3. 证据等级与实测

`tools/challenge/block-drop.mjs` 共 8 场景；`--game=block-drop --repeat=2` 结果 **16/16 PASS**（每场景两遍证据逐字一致）。

| 场景 | 证据等级 | 实测要点 |
| --- | --- | --- |
| CH-BD-001 挑战数据与选关锁定 | ui-only | 6 关 id/顺序与夹具一致；C01 解锁、C02–C06 锁定；面板默认 hidden；打开/返回；0/6 进度 |
| CH-BD-002 C01 参考硬降真实输入通关 | **real-input-replay** | 真实键盘 `空格` 硬降；底行 `###....###` 与数据一致；清 1 行；`markCleared` 写入；点「下一关」进入 C02 |
| CH-BD-003 C01–C06 全量参考回放与解锁链 | **real-input-replay** | 6 关按 `referencePlan` 逐块真实旋转/横移/硬降；清行数分别 1/2/4/2/2/4，全部与 `win.count` 一致；解锁链 C01→C06 全通，选关 6/6 |
| CH-BD-004 失败归因与 1 次点击重试 | engine-replay | 故意把 I 移到最右错过横井 → 出块用完失败；文案含原因与目标；重试回本关起点、进度未写 |
| CH-BD-005 挑战暂停/刷新恢复 | engine-replay | C02（先真实通关 C01 解锁）；暂停弹层含「退出挑战」；刷新续玩后 mode=challenge、同关同盘面同当前方块 |
| CH-BD-006 经典回归 | engine-replay | 主按钮仍「开始游戏」→ classic；`shortRun=true`（40 行）、7-bag 仍在、NEXT 正常；暂停弹层无 btn2；挑战面板默认隐藏 |
| CH-BD-007 320/390 无溢出 | ui-only | 320×568 / 390×844：选关面板与按钮 ≥44px、无横向溢出；目标提示不超出舞台；挑战页无纵向溢出 |
| CH-BD-008 辅助道具计入 assisted | engine-replay | 挑战中使用慢落 → assisted=true；仍可真实通关；结算含「辅助」；best.assisted=true |

关键命令与真实输出：

```text
node --check tools/challenge/block-drop.mjs                      → exit 0
内联脚本提取 node --check（PowerShell 抽 <script> → %TEMP%\bd-check.js） → exit 0
ARCADE_GAMEPLAY_PORT=8802 ARCADE_GAMEPLAY_CDP_PORT=9402 node tools/arcade_gameplay_test.mjs --game=block-drop --repeat=2
  → 16/16 scenario runs passed（8 场景 ×2；证据等级 ui-only/real-input-replay/engine-replay）
node tools/arcade_gameplay_test.mjs --suite=base                 → 11/11 scenario runs passed
node tools/arcade_gameplay_test.mjs --scenario=CH-DATA-001       → PASS（games=13, stages=78, runtime=13/13）
node tools/arcade_gameplay_test.mjs --scenario=CH-CLASSIC-001    → PASS（13/13 经典入口；challengeEntryVisible=13）
py -3 tools/validate_site.py                                     → PASS
```

## 4. 设计差异（原值 → 新值 → 原因）

| # | 设计/预期 | 实现 | 原因 |
| --- | --- | --- | --- |
| D1 | `coordinates`：参考放置给“top-left bounding-box column” | 以占用格**最小列** `leftCol` 对齐（I-V 的 4×4 矩阵占用列会因旋转偏移，测试按实际 minCol 校正） | 经典旋转矩阵含空白列，直接按矩阵 x 会偏 2 列；用 minCol 与设计语义一致且可断言 |
| D2 | `pieceDefinitions` 朝向名 `I-H/I-V/O-N/T-STEM-DOWN` | 运行时用经典旋转系统；朝向名仅用于测试识别（归一化格集匹配）；I-V=1 次顺时针、T-STEM-DOWN=2 次 | 不引入第二套方块定义，保持经典规则唯一来源 |
| D3 | `gravityMode: place-by-place with no time pressure` | 保留经典自然重力（0.8s/格）+ 硬降；不新增计时/步数限制 | “无时间压力”成立；设计未要求倒计时，减少额外规则 |
| D4 | 失败条件 `queue-exhausted-or-top-out` | 除队列耗尽外，`maxPlacedPieces` 用尽也判失败（C01 仅 1 块） | 与 `win.maxPlacedPieces` 语义一致，避免无限试错破坏残局题 |
| D5 | `targetDurationSec` 25–110s | 只显示用时并写入最佳，不强制限时 | 设计为“建议有效时长”，契约未要求倒计时 |

## 5. UNVERIFIED / 风险

- **真机 iOS/Android** 触控与手感未测（无头 Chrome 仅模拟 320/390 视口与键盘输入）；真机结论一律 UNVERIFIED。
- `targetDurationSec` 目标时长与真人难度曲线未验证（自动化只用参考计划，最快通关约 1–2 秒；人类首次预计接近设计区间，需 Owner/Reviewer 试玩）。
- 挑战中仍可使用经典限量道具（换块/慢落）→ 标记 assisted；这是契约 §4.8 允许的行为，但是否应完全禁用未由设计明确。
- 完整 `arcade_smoke.mjs` 85/85 与 `build_site.py` 由 Lead 统一执行（本 Agent 未跑，避免共享端口/构建冲突）。
- Reviewer 结论：**待填**。
