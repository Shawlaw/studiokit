# 2048 合成 `merge-2048` · 0.9 挑战模式实现记录（T045）

> 实现范围：`apps/arcade/games/merge-2048.html`、`tools/challenge/merge-2048.mjs`。
> 数据源：`apps/arcade/challenge/merge-2048.js`（生成物，6 关）与 `tools/testdata/challenge/merge-2048.json`（含 referencePlan/acceptance）。
> 契约：`docs/arcade/0.9/INTEGRATION-CONTRACT.md` §3–§6。经典模式（随机新块、2048 目标、撤销 3 步、小锤/升一级道具、暂停/自动保存/续玩）未改动。
> 结论：**PASS（6/6 关按参考方向真实输入通关，最终盘面与设计 resultBoard 逐格一致；经典回归全绿）**。Reviewer 结论：待填。

## 1. 挑战入口与流程

| 项 | 实现 |
| --- | --- |
| 入口 | 开始弹层 `[data-ov-btn]` 文案/行为保持「开始游戏」=经典；新增可见 `[data-ov-btn2]`「挑战 6 关」→ `.challenge-layer` 内 `.ac-challenge-panel` 选关（数据不可用时入口隐藏，面板显示「挑战数据不可用」） |
| 选关 | `A.Challenge.stageListHtml('merge-2048')` 6 个 `.ac-stage-btn[data-stage-id]`（C01 恒开、C0N 需前关 cleared、✅ 最佳/🔒），页面本地「返回」按钮回开始弹层；面板默认 `hidden`（满足 CH-CLASSIC-001） |
| 关卡内 | 顶部 HUD `[data-ch-hud]`（桌面）+ canvas 内 HUD（手机可读）：`Cxx 标题 · 目标方块 · 步数 x/y · 用时`；首次进入 3 秒 `[data-ch-tip]` 显示 `goalStatement`、目标与步数上限、操作提示；挑战中隐藏经典分数/最高 HUD |
| 状态机 | `ready → playing → paused → playing → cleared \| failed`；暂停沿用 `bindPause`，挑战暂停弹层 btn2「退出挑战」回选关；失焦/锁屏自动暂停且计时冻结 |
| 失败 | 可归因文案（`有效步数用完了`/`棋盘已经没有可移动的方向`）+ 本关 `goalStatement` + 主按钮「重试本关」（1 次点击）+ btn2「返回选关」 |
| 通关 | `A.Challenge.markCleared` → `A.Challenge.resultHtml`（用时/最佳/收集物/辅助）；主按钮「下一关」（C06「返回选关」）、btn2「重玩本关」 |
| 存档 | `runs:v1` 的 `data` 增加 `mode:'challenge'`、`stageId`、`challenge:{moves,target,maxMoves,elapsed,assisted,undoAllowed,undoUsed}`；缺 `mode` 的旧档按经典恢复；刷新/暂停恢复同一关同盘面同步数；挑战不写最高分与 Playtime 轮次 |
| assisted | 挑战中使用限量道具（小锤/升一级）或撤销 → `assisted:true`，结算显示「辅助」徽章，`challenge:v1` best.assisted 记录 |

## 2. 设计字段支持矩阵（`content`）

| 字段 | 支持 | 实现说明 |
| --- | --- | --- |
| `grid {rows:4, cols:4}` | ✅ | 固定 4×4（与经典一致）；数据不符时 fail closed |
| `initialBoard[4][4]` | ✅ | 只接受 2 的幂或 0；按数据初始化，无随机新块；初始盘面与数据逐格一致（CH-MG-002 断言） |
| `challengeSpawnPolicy: none` | ✅ | 挑战 `move()` 不调用 `spawnTile()`；只有经典模式在每次有效移动后生成随机新块 |
| `maxValidMoves` | ✅ | 只对“实际改变盘面”的移动计步；达到上限仍未达标 → 失败；无效方向不计步 |
| `undoAllowed` | ✅ | 挑战可撤销；`undoDoesNotRefundMoveOnRankedAttempt` 解释为**不退还已用步数**（见 §4 D2） |
| `win.anyTileAtLeast` | ✅ | 每次有效移动/道具使用后检查 `bestTile() >= target` → 通关 |
| `lose` | ✅ | 有效步数用完且未达标 / 无合法移动 → 失败 |
| `scorePolicy` | ✅（解释） | 挑战不写 `progress:v1` 最高分；经典分数逻辑不变；辅助/撤销通过 `assisted` 分层记录 |
| `controls` | ✅ | 沿用经典四方向键/WASD/滑动；滑动阈值不变（22px）；仅有效移动计步 |

## 3. 证据等级与实测

`tools/challenge/merge-2048.mjs` 共 8 场景；`--game=merge-2048 --repeat=2` 结果 **16/16 PASS**（每场景两遍证据逐字一致）。

| 场景 | 证据等级 | 实测要点 |
| --- | --- | --- |
| CH-MG-001 挑战数据与选关锁定 | ui-only | 6 关 id/顺序与夹具一致；C01 解锁、其余锁定；面板默认 hidden；打开/返回；0/6 进度 |
| CH-MG-002 C01 参考方向真实输入通关 | **real-input-replay** | 初始盘面/目标/步数上限与数据一致；真实 `←` 一步合成 4；最终盘面 = `resultBoard`；结算含 C01；点「下一关」进入 C02 |
| CH-MG-003 C01–C06 全量参考回放与解锁链 | **real-input-replay** | 6 关按 `referencePlan.directions` 真实按键；逐关最终盘面与 `resultBoard` **逐格一致**；最大方块 4/8/16/8/16/32 与目标一致；解锁链全通 6/6 |
| CH-MG-004 步数耗尽失败与 1 次点击重试 | engine-replay | C01 上限 2 步：下移+上移不合并 → 步数用完失败；文案含原因与目标；重试回初始盘面、步数 0、记录未写 |
| CH-MG-005 挑战暂停/刷新恢复 | engine-replay | 走 1 步后暂停；暂停弹层含「退出挑战」；刷新续玩后 mode=challenge、同关同步数同盘面 |
| CH-MG-006 撤销不退还步数且标记辅助 | engine-replay | C03（真实通关 C01/C02 解锁）：走 1 步→撤销：步数仍 1、undoUsed=1、assisted=true、盘面回初始；再按参考通关，结算含「辅助」，best.assisted=true |
| CH-MG-007 经典回归 | engine-replay | 主按钮仍「开始游戏」→ classic；开局 2 个随机方块；道具 2/1；经典滑动后仍生成随机新块；暂停弹层无 btn2；面板默认隐藏 |
| CH-MG-008 320/390 无溢出 | ui-only | 320×568 / 390×844：选关面板与按钮 ≥44px、无横向溢出；目标提示不超出舞台；挑战页无纵向溢出 |

关键命令与真实输出：

```text
node --check tools/challenge/merge-2048.mjs                      → exit 0
内联脚本提取 node --check（PowerShell 抽 <script> → %TEMP%\mg-check.js） → exit 0
ARCADE_GAMEPLAY_PORT=8802 ARCADE_GAMEPLAY_CDP_PORT=9402 node tools/arcade_gameplay_test.mjs --game=merge-2048 --repeat=2
  → 16/16 scenario runs passed（8 场景 ×2；证据等级 ui-only/real-input-replay/engine-replay）
node tools/arcade_gameplay_test.mjs --suite=base                 → 11/11 scenario runs passed
node tools/arcade_gameplay_test.mjs --scenario=CH-DATA-001       → PASS（games=13, stages=78, runtime=13/13）
node tools/arcade_gameplay_test.mjs --scenario=CH-CLASSIC-001    → PASS（13/13 经典入口；challengeEntryVisible=13）
py -3 tools/validate_site.py                                     → PASS
```

## 4. 设计差异（原值 → 新值 → 原因）

| # | 设计/预期 | 实现 | 原因 |
| --- | --- | --- | --- |
| D1 | 参考方向 `["L"]` 等 → `resultBoard` | 完全按参考方向真实按键，最终盘面逐格相等（无偏差） | 验证经典合并规则（每格每回合最多合并一次）与设计一致 |
| D2 | `undoDoesNotRefundMoveOnRankedAttempt:true`；验收“撤销的成绩标签与普通成绩不同” | 撤销**不退还**已用步数；撤销后本关 `assisted:true`（结算「辅助」+ 记录分层） | 契约只有 assisted 布尔字段可表达“标签不同”；不回退步数避免撤销刷步数破坏题面 |
| D3 | 挑战禁止随机新块 | 挑战 `move()` 跳过 `spawnTile()`；经典不变 | 保证固定盘面题可解且可复现 |
| D4 | `maxValidMoves` | 仅统计“实际改变盘面”的移动；无效方向不计步也不判负 | 与设计 `controls`“仅有效改变盘面的滑动计步”一致 |
| D5 | `targetDurationSec` 15–95s | 只显示用时并写入最佳，不强制限时 | 设计为“建议有效时长”，契约未要求倒计时 |
| D6 | 道具在挑战中的定位 | 保留经典小锤/升一级可用（使用即 assisted） | 契约 §4.8：使用限量道具 → assisted；设计 `noAssistedRequired` 不禁止使用 |

## 5. UNVERIFIED / 风险

- **真机 iOS/Android** 触控/滑动阈值与手感未测（无头 Chrome 仅模拟视口与键盘输入）；真机结论一律 UNVERIFIED。
- `targetDurationSec` 与真人难度曲线未验证；自动化参考解最快约 1–2 秒（真实人类首次预计在 15–95s 区间，需 Owner/Reviewer 试玩）。
- 挑战中撤销不退还步数的语义是本次实现的解释（设计未给出字段级规则）；若 Reviewer 认为撤销应直接禁用，只需把 `chUndoAllowed` 置 false（1 行改动）。
- 完整 `arcade_smoke.mjs` 85/85 与 `build_site.py` 由 Lead 统一执行（本 Agent 未跑）。
- Reviewer 结论：**待填**。
