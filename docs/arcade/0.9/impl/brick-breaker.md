# 砖块计划（brick-breaker）0.9 挑战模式实现记录

> 任务：T047 / task-12（GP 0.9 落地的物理组之一）。负责人：level-designer。
> 代码：`apps/arcade/games/brick-breaker.html`（唯一业务改动文件）；测试：`tools/challenge/brick-breaker.mjs`。
> 设计源（只读）：`docs/arcade/0.9/levels/brick-breaker.json`、`docs/arcade/0.9/levels/stages/brick-breaker-C01..C06.json`、`docs/arcade/0.9/docs/brick-breaker.md`；运行时数据：`apps/arcade/challenge/brick-breaker.js`（平台生成物）。经典 3 关/道具/最高分不变。

## 1. 支持的 content 字段（逐项实现）

| 字段 | 实现 |
| --- | --- |
| `brickRows[5][8]` | 5 行 × 8 列符号阵；坐标固定按设计注释：`x = 20 + col*48`、`y = 128 + row*24`，砖尺寸沿用经典 `w=44,h=20`（gap 4），与经典砖阵同格 |
| `tokenLegend` | `.`=空；`1/2/3`=HP；`K`=1HP 钥匙砖；`G`=锁定门砖（未解锁时不受伤、仍是实心硬墙；全部 K 击毁后变成普通 1HP 砖） |
| `mechanics` | `K`：全部 K 击毁 → 所有 G 解锁为可破坏砖（同时刷新提示与音效）；`G` 未解锁前不计入“剩余”显示 |
| `ball.speed` | 挑战球速（C01–C06：285/293/301/309/317/325），移动子步沿用经典 `ceil(speed*dt/7)` |
| `ball.startingPaddleX` / `paddleWidth` | 挡板初始中心与宽度；挡板可指针拖动或 ←→ 移动，边界 clamp 到场地内 |
| `ball.lives` | 生命数（本包 3）；球掉出底部生命-1，0 → 挑战失败 |
| `win.type` | `destroy_all_breakable_including_unlocked_gates`：所有非空砖（含已解锁 G）全部击毁即通关 |
| `stuckBallRecovery.ifNoBrickContactSec` | 挑战内连续 12s 无砖接触：第一次只提示（不扣命），之后每次把球速方向旋转 +0.4rad 并提示，不扣命 |
| `requiredFeatures`/meta | `fixed_brick_layout`；`title/goalStatement/decision/practicedSkill/discovery` 用于选关、HUD 与入场目标提示 |
| `targetDurationSec` | 仅作设计目标展示，不用于倒计时/失败（见 §4） |

- 挡板反弹角沿用经典公式：`offset = clamp((ball.x - paddleCenter)/(paddle.w/2), -1, 1)`，`angle = offset * 0.95`，`vx=sin(angle)*speed`、`vy=-cos(angle)*speed` —— 即“挡板接球位置决定反弹角”，content 未覆盖该系数。
- 球与墙/场地顶反弹、砖块法线反弹均复用经典几何（`A.Physics.circleBox`，按 |dx|/w 与 |dy|/h 决定反弹轴）。
- 挑战不生成经典随机掉落道具（加宽/减速/加命）；经典 `spawnPickup` 逻辑原样保留在 classic 分支。

## 2. 证据等级

| 证据 | 等级 | 说明 |
| --- | --- | --- |
| C01 参考通关 | **engine-replay**（含真实输入 sanity） | 先真实指针拖动挡板 + 点击发球，确认球真实离板飞行；再用 `#test` 钩子 `challengeReplayClear(1)` 以固定 1/60 步长驱动**同一份** update 物理 + 确定性挡板瞄准控制器清场（74.0s、0 丢命）。**未把回放标成 real-input**（`CH-BB-002`，模块 evidence=`engine-replay`） |
| C01–C06 逐关清场 | **engine-replay** | `challengeReplayClear(1..6)` 逐关回放：53.3 / 56.5 / 101 / 53.3 / 54 / 81.3s，全部 `remaining=0`、`lives=3`、无 >12s 空转死循环（`CH-BB-007`） |
| 输入/失败路径 | **real-input-replay** | 真实指针拖挡板（跟随误差 ≤40px 断言）、真实点击发球、真实连续丢 3 球触发失败与一键重试（`CH-BB-002/003`） |
| 数据/选关/解锁/记录/assisted/暂停恢复/经典回归/320-390 | **ui-only** | `CH-BB-001/004/005/006`；assisted 通过 `forceStageClear(true)` 验证记录与徽章（仅用于记录/UI 测试，不作为可玩性证据） |

真机（iOS/Android）未测 → **UNVERIFIED**。

## 3. 挑战模式实现要点

- 入口：开始弹层经典主按钮「开始游戏」行为不变；第二按钮「挑战 6 关」打开 `.ac-challenge-panel` 选关（锁定关 disabled + `.is-locked`）；数据缺失/不足 6 关 fail closed（按钮「挑战数据不可用」+ 禁用）。
- 状态机：`ready → playing → paused → playing → cleared|failed`；`mode` 区分经典/挑战；暂停弹层次按钮「退出挑战」。
- 计时只累计挑战 `state==='playing'`；失焦/切后台自动暂停；刷新恢复同一关（`runs:v1.data` 内 `mode/stageId/challengeState`，含砖块 hp/alive、挡板、球位置速度、生命、未砖接触计时等）。
- 结算：`A.Challenge.markCleared` + `resultHtml`；「下一关」/C06「返回选关」+「重玩本关」；失败「重试本关」（1 次点击）+「返回选关」。
- 挑战不提供经典主动道具（宽板/重锤），经典道具栏隐藏且 `useTool` 在挑战返回 false；`assisted` 记录路径保留并验证。
- 新增 `#test` 钩子（契约 §5）：`challengeStages/startChallenge/challengeInfo/stageObservable/forceStageClear/forceStageFail/exitChallenge` + 本游戏额外 `challengeReplayClear(ref)`；经典既有钩子全部保留。
- 320×568 / 390×844：`scrollWidth-innerWidth ≤ 1`、选关面板无内部溢出、入口与关卡按钮 ≥44px（`CH-BB-006`，实测 overflow=0、按钮高 50/53）。

## 4. 设计差异（原值 → 实现值 → 原因；不修改设计源）

### 4.1 K 钥匙砖在“G 是硬墙”的字面语义下不可达（**已最小修正**）

- 设计（原值）：`G` = 锁定门砖，未解锁时“只作硬墙”；`K` = 1HP 触发砖；全部 K 击毁后 G 才可破坏。
- 几何事实：C03 的 K 在 row0 col3/4，正下方 row1 就是 G；C06 的 K 在 row0 col0 与 col7 两个角落，正下方 row1 col0/1、col6/7 是 G。球只能从下方、上方或侧面接近：
  - 下方被 G 实心硬墙挡住；
  - 上方需要先通过某条“空列”到砖阵上方，而砖阵上方可横向漂移的高度只有 ~22px（场地顶到砖阵顶），最大漂移 ≈ tan(54°)×22 ≈ 30px，无法从中央空列飘到 C06 左右角落（需要 >120px）；
  - 侧面 4px 缝隙小于球直径 14px，球无法穿过。
- 实测证据（本机引擎回放，非臆测）：
  - 按字面“G 硬墙 + K 必须被球直接击毁”实现时：C01/C02/C04/C05 可清场（53–74s），**C03 在 240s 回放上限内失败（剩 13 砖）**，加入顶部攻击控制器后 C03 仍要约 244s 且 13 次空转恢复、**C06 在 300s 上限内失败（剩 5 砖）**；
  - 若把锁定 G 当作“可穿透”（非设计语义）则 6 关 53–74s 全部可过 —— 反证问题只出在 K 的可达性，而非球/挡板/砖阵本身。
- 最小实现修正（新值）：**球撞击未解锁 G 时，对“正上方紧邻的 K”造成 1 点伤害**（门保持实心硬墙、仍不可破坏；K→G 的解锁关系与胜利条件完全不变；提示“撞门震钥匙”）。未修改任何设计数据/目标/砖阵。
- 修正后证据：`CH-BB-007` 六关 engine-replay 全部清场：C03 101s、C06 81.3s，其余 53.3–74s；全部 0 丢命。
- 建议 Reviewer/Owner 决策：接受该“撞门震钥匙”交互，或回改设计把 K 移到可直接触达的位置（例如 row0 空列两侧 / 门上方留一格缺口）。

### 4.2 发球角度：随机 → 固定序列

- 经典：`angle = rand(-0.62, 0.62)`（随机）。
- 挑战（新值）：固定序列 `[0.45, -0.45, 0.3, -0.3, 0.6, -0.6]`，按发球次数循环。
- 原因：content 未定义发球角；挑战需要“同一输入 → 同一结果”（可重复回放证据、记录可比、assisted 公平）；同时仍保留左右两侧发球差异供玩家练习接球角。

### 4.3 `targetDurationSec` 与回放用时

- 设计：C01–C06 `targetDurationSec=[75,180]`。
- 回放（确定性完美瞄准）：53.3–101s，其中 C04/C05 低于 75s 下限、C01=74s 接近下限。
- 判定：回放使用“完美瞄准”控制器，人类玩家需读角度、接球、多球回合，实际用时会更长；不修改数据、不把 targetDurationSec 作为失败条件。建议 Reviewer/Owner 以真人体感为准。

### 4.4 其他

- 挑战不生成随机掉落道具（content 无道具），经典随机掉落与 3 关流程不变。
- 经典道具在挑战隐藏/禁用；`assisted` 记录能力保留（`forceStageClear(true)` → `best.assisted=true` + 结算「辅助」徽章）。
- 空转恢复严格按 content：12s 首次仅提示、之后微调方向且不扣命；回放中 C03 触发 3 次恢复，仍可清场，未观察到墙角/水平死循环。

## 5. 不可达 / 死局证据汇总

- 按原始字面语义：C03/C06 K 不可达（证据见 §4.1），其余四关可清场。
- 修正后：6 关全部可清场（engine-replay 53.3–101s，0 丢命，无 >12s 死循环；`maxNoBrickSec` 最大 12s 由恢复机制处理）。
- 无“必须依赖经典道具”段：回放全程未使用宽板/重锤。
- 无随机必经路线：砖阵、球速、发球角、挡板逻辑全部确定性。

## 6. 命令与真实输出

```powershell
$env:ARCADE_GAMEPLAY_PORT='8805'; $env:ARCADE_GAMEPLAY_CDP_PORT='9405'
node tools/arcade_gameplay_test.mjs --game=brick-breaker --repeat=2
# => 14/14 scenario runs passed（7 场景 × 2 遍），exit 0，约 50s
#   CH-BB-001 PASS stages=6, gateStages=[C03,C06], panelButtons=6
#   CH-BB-002 PASS cleared=true, seconds=74, launches=1, maxNoBrickSec=7.1, realInputLaunched=true
#   CH-BB-003 PASS failed=true, livesAtFail=0, retried=true, retryRemaining=22
#   CH-BB-004 PASS pausedElapsed=1.6, resumedElapsed=1.6, resumedRemaining=21
#   CH-BB-005 PASS cleared=[true,true,true], c03Assisted=true, c04Unlocked=true
#   CH-BB-006 PASS classicMode=classic, classicBricks=32, layouts=[{vp:320,overflow:0,stageBtnMin:50},{vp:390,overflow:0,stageBtnMin:53}]
#   CH-BB-007 PASS clearedStages=6,
#     results=[C01 74s, C02 56.5s, C03 101s(recoveries=3), C04 53.3s, C05 54s, C06 81.3s]

node tools/arcade_gameplay_test.mjs --suite=base        # => 11/11 passed, exit 0（经典回归）
node tools/arcade_gameplay_test.mjs --scenario=CH-CLASSIC-001
# => PASS games=13, classicStarted=13, mainButton=开始游戏, challengeEntryVisible=13
py -3 tools/validate_site.py                            # => PASS: StudioKit validation succeeded

node --check tools/challenge/brick-breaker.mjs          # exit 0
# 页面内联脚本由测试 runner 真实加载执行；cdp.errors 为空通过场景断言
```

## 7. UNVERIFIED

- iOS Safari / Android Chrome 真机触控拖动挡板（手指是否遮挡接球判定需真机）、刘海/安全区。
- 人类玩家在 C03/C06 的“撞门震钥匙”交互是否清晰、是否有趣（Owner 试玩）。
- 低端机性能、音效可读性、完整 `arcade_smoke` 85 项（Lead/测试 Agent 统一跑，本人按边界未跑）。
- “完美瞄准”回放到真人操作的难度换算。

## 8. Reviewer 结论占位

- [ ] 6 关数据/入口/选关/解锁/记录正确
- [ ] C01 real-input sanity + engine-replay 清场证据等级认可
- [ ] §4.1 K/G 最小修正是否接受（或要求回改设计）
- [ ] §4.2 固定发球角、§4.3 时长差异是否接受
- [ ] 经典模式回归（base 11/11 + CH-CLASSIC-001）
- [ ] 320/390 布局与触控
- Verdict：__________（PASS / NEEDS_FIX / NEEDS_OWNER）
