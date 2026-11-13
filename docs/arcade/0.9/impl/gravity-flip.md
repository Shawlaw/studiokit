# 重力翻转（gravity-flip）0.9 挑战模式实现记录

> 任务：T047 / task-12（GP 0.9 落地的物理组之一）。负责人：level-designer。
> 代码：`apps/arcade/games/gravity-flip.html`（唯一业务改动文件）；测试：`tools/challenge/gravity-flip.mjs`。
> 设计源（只读）：`docs/arcade/0.9/levels/gravity-flip.json`、`docs/arcade/0.9/levels/stages/gravity-flip-C01..C06.json`、`docs/arcade/0.9/docs/gravity-flip.md`；运行时数据：`apps/arcade/challenge/gravity-flip.js`（平台生成物）。经典 3000m 模式/道具/记录不变。

## 1. 支持的 content 字段（逐项实现）

| 字段 | 实现 |
| --- | --- |
| `distanceToFinish` | 世界前进距离（px）。`offset = 已滚动 px`，终点 marker 世界 x=该值；`offset + PLAYER_X >= distanceToFinish` 即通关（“pass finish marker alive”） |
| `scrollSpeedPxSec` | 挑战内恒定滚动速度（本包 260），`offset += speed*dt` |
| `gravity` | 挑战内重力加速度（本包 2100，与经典 `GRAVITY` 一致）；翻转只改变方向 |
| `startGravity` | `floor`（1）/`ceiling`（-1）决定初始重力方向与出生侧 |
| `obstacles[]` | `{id,x,side,height,width,telegraphLeadPx}`；屏幕 x = `x - offset`；`side=floor` 时 box 为 `FLOOR-height..FLOOR`，`ceiling` 时为 `CEILING..CEILING+height`；`telegraphLeadPx` 内高亮预告（设计值 360，满足“至少提前 350 逻辑距离”） |
| `recommendedFlipWindows[]` | `{xCenter,toward,tolerancePx}` 作为**提示/参考**与测试机器人触发依据；不强制玩家必须在该窗口翻转（玩家可自由翻转） |
| `bonusStars[]` | `{x,y}` 可选收集：世界 x、屏幕 y；`id` 由实现生成为 `star1..`；进入 26px 半径记录到 `collectibles`，不影响通关 |
| `win` | `pass finish marker alive` → 见 distanceToFinish |
| `collision` | 解析 `lives=N`（本包 N=2）：撞击 → 生命-1、1.6s 无敌、移除该障碍、回到 floor 侧继续，生命 0 → 挑战失败 |
| 关卡 meta | `title/goalStatement/decision/practicedSkill/discovery` 用于选关、HUD 与首次入场 3.6s 目标提示 |
| `targetDurationSec` | 仅作为设计目标展示/记录，不用于倒计时或失败判定（原因见 §4） |

经典模式字段（`levelConfig`、随机障碍/星星、羽落？——本游戏经典道具为护盾/磁铁）完全不受挑战代码影响；挑战分支在 `update()`/`render()` 顶部按 `mode` 分流。

## 2. 证据等级

| 证据 | 等级 | 说明 |
| --- | --- | --- |
| C01 参考通关 | **real-input-replay** | 真实运行时 + 真实指针输入：按 `recommendedFlipWindows` 早窗口（`xCenter - tolerancePx + 8`）派发画布点击翻转；断言 0 碰撞、2 生命通关、3 次翻转全部落在窗口内、结算/记录/解锁正确（`CH-GF-002`） |
| C02–C06 可达性 | **engine-replay** | 页面内 `#test` 钩子 `challengeReplayFlip(ref)`：固定 1/60 步长驱动**同一份** `updateChallenge` 物理，按窗口早沿脚本翻转；6 关均 0 碰撞通关（`CH-GF-007`，用时 8.0/8.0/8.8/8.6/8.5/9.3s） |
| 数据/选关/解锁/记录/assisted/暂停恢复/经典回归/320-390 | **ui-only + real-ui** | `CH-GF-001/003/004/005/006`；失败路径为真实“不翻转被尖刺击杀两次”；暂停→刷新→继续为真实页面 reload；assisted 通过 `forceStageClear(true)` 验证记录徽章（该钩子只用于记录/UI 测试，不作为可玩性证据） |

真机（iOS/Android）未测 → **UNVERIFIED**。

## 3. 挑战模式实现要点

- 入口：开始弹层经典主按钮「开始游戏」行为完全不变；第二按钮「挑战 6 关」打开页面本地 `.ac-challenge-panel` 选关（锁定关 disabled+`.is-locked`）；数据缺失/不足 6 关时按钮显示「挑战数据不可用」并禁用（fail closed）。
- 状态机：`ready → playing → paused → playing → cleared|failed`；挑战复用同一 `state`，`mode` 区分；暂停弹层次按钮「退出挑战」回选关/开始界面。
- 计时只累计 `state==='playing'` 的挑战有效时间；失焦/`visibilitychange`/`pagehide` 自动暂停（复用 `A.createLoop`/`bindPause`）。
- 存档：`runs:v1.data` 写入 `{mode:'challenge', stageId, challengeState, classic}`；`restore()` 对缺少 `mode` 的 0.8 旧档按经典恢复；挑战不写 `progress:v1` 最高分、不写 `playtime:v1` 轮次（Playtime 仅累计页面活跃 ms，既有机制）。
- 结算：`A.Challenge.markCleared` + `A.Challenge.resultHtml`；主按钮「下一关」/C06「返回选关」，次按钮「重玩本关」；失败 1 次点击「重试本关」。
- 挑战不提供经典主动道具（content 未定义道具），道具区隐藏并禁用；`assisted` 记录路径保留并通过测试钩子验证。
- 新增 `#test` 钩子（契约 §5）：`challengeStages/startChallenge/challengeInfo/stageObservable/forceStageClear/forceStageFail/exitChallenge` + 本游戏额外 `challengeReplayFlip(ref)`；原有 `info/joyInfo/useJoyTool/forceObstacleHit/spawnCoinNear/setDist` 全部保留。
- 320×568 / 390×844 断言：`document.documentElement.scrollWidth - innerWidth ≤ 1`、选关面板无内部横向溢出、入口与关卡按钮高度 ≥44px（`CH-GF-006`）。

## 4. 设计差异（原值 → 实现值 → 原因；不修改设计源）

1. **`targetDurationSec` 与 content 数值不一致**
   - 设计：C01–C06 `targetDurationSec=[45,115]`。
   - content：`distanceToFinish 2200–2530`、`scrollSpeedPxSec=260` → 理论时长 8.5–9.7s。
   - 实现：按 content 显式数值实现（8–9.3s 可通关），`targetDurationSec` 仅作展示/设计目标，不做倒计时或失败。
   - 原因：`obstacles[].x` 最大 2260 与 `distanceToFinish` 2530 同量纲（px）；若把 distance 当“米/距离单位”换算会得到终点前 90% 无内容，判定 45–115s 为模板默认值。建议 Reviewer/Owner 复核是否把 `distanceToFinish` 改为“米”并补内容。
2. **推荐翻转窗口的晚半段不安全**
   - 设计：`tolerancePx=70`（中心 ±70 视为推荐窗口）。
   - 物理扫描（复刻本页常量的离线仿真 + 页面 engine-replay）：C01/C02/C04 在窗口晚半段（约 `xCenter+50..70`）翻转会在尖刺到达前无法完成竖向转移而碰撞；早半段（`xCenter-70..xCenter`）全部安全。C03/C05/C06 早半段同样安全。
   - 实现：不修改数据；参考提示与测试机器人使用窗口早沿（`xCenter - tolerancePx + 8`）；`impl` 记录该风险，建议设计把 `xCenter` 前移或容差改为“早 70 / 晚 10”。
3. **`collision: "lives=2; collision respawn at most recent safe segment"`**
   - 实现：撞击即移除该障碍、生命-1、1.6s 无敌、回到 floor 侧并**继续当前滚动位置**；不做位置/时间回退。
   - 原因：固定滚动 + 固定障碍序列下回退会造成二次碰撞与归因不清；当前实现满足“有生命容错、失败可归因、不会必死”。
4. **道具/assisted**：经典护盾/磁铁在挑战隐藏禁用（content 无道具定义）；`assisted` 记录能力保留（`forceStageClear(true)` → `best.assisted=true` + 结算「辅助」徽章），供未来若要开放道具时直接生效。
5. **挑战星星**：不使用经典随机生成星星；仅按 `bonusStars` 固定位置生成可选收集（`star1..`），写 `collectibles`，不影响通关。

## 5. 不可达 / 风险证据

- 6 关在固定 content 下均可达：`CH-GF-007` 页面引擎回放 6/6 通关、0 碰撞；`CH-GF-002` C01 真实输入通关。
- 未发现必须依赖经典道具的段（求解不需要护盾/磁铁）。
- 设计风险（非不可达）：§4.1 时长与 content 不一致、§4.2 推荐窗口晚半段不安全；两者均未改设计数据，交由 Reviewer/Owner 决策。

## 6. 命令与真实输出

```powershell
$env:ARCADE_GAMEPLAY_PORT='8805'; $env:ARCADE_GAMEPLAY_CDP_PORT='9405'
node tools/arcade_gameplay_test.mjs --game=gravity-flip --repeat=2
# => 14/14 scenario runs passed（7 场景 × 2 遍），exit 0，约 55s
#   CH-GF-001 PASS stages=6, c01Unlocked=true, lockedCount=5, panelButtons=6
#   CH-GF-002 PASS cleared=true, hits=0, flips=3, seconds=8, best=8
#   CH-GF-003 PASS failed=true, hits=2, retried=true, retryElapsed=0
#   CH-GF-004 PASS pausedDistance=364, resumedDistance=364, resumeElapsed=1.4, exitedMode=classic
#   CH-GF-005 PASS cleared=[C01,C02], c02Assisted=true, c03Unlocked=true
#   CH-GF-006 PASS classicMode=classic, classicLives=3, layouts=[{vp:320,overflow:0,stageBtnMin:50},{vp:390,overflow:0,stageBtnMin:53}]
#   CH-GF-007 PASS clearedStages=6, results=[8.0s/8.0s/8.8s/8.6s/8.5s/9.3s, hits=0, flips=3/2/4/4/4/5]

node tools/arcade_gameplay_test.mjs --suite=base        # => 11/11 passed, exit 0（经典回归）
node tools/arcade_gameplay_test.mjs --scenario=CH-CLASSIC-001
# => PASS games=13, classicStarted=13, mainButton=开始游戏, challengeEntryVisible=13
py -3 tools/validate_site.py                            # => PASS: StudioKit validation succeeded
```

内联脚本语法（与 `node --check` 等价）：

```powershell
node --check tools/challenge/gravity-flip.mjs   # exit 0
# 页面内联脚本由测试 runner 真实加载执行；cdp.errors 为空通过场景断言
```

## 7. UNVERIFIED

- iOS Safari / Android Chrome 真机触控、刘海/安全区、锁屏恢复（模拟器/桌面 Chrome 已测）。
- C02–C06 真人试玩与手感（当前为引擎回放证据）。
- 低端机 30fps 性能、音频可读性。
- 完整 `node tools/arcade_smoke.mjs` 85 项（Lead/测试 Agent 统一跑；本人按边界未跑）。

## 8. Reviewer 结论占位

- [ ] 6 关数据/入口/选关/解锁/记录正确
- [ ] C01 real-input 参考通关成立；C02–C06 engine-replay 证据等级认可
- [ ] 设计差异 §4.1/§4.2 是否接受或要求回改设计
- [ ] 经典模式回归（base 11/11 + CH-CLASSIC-001）
- [ ] 320/390 布局与触控
- Verdict：__________（PASS / NEEDS_FIX / NEEDS_OWNER）
