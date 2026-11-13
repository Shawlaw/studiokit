# 贪吃蛇（snake-run）0.9 挑战模式实现记录

> 任务：T045（0.9 关卡落地，记忆/蛇组）。分支 `feat/arcade-0.8-gameplay`（0.8/0.9 合并开发）。
> 设计源（只读）：`docs/arcade/0.9/levels/snake-run.json`、`docs/arcade/0.9/levels/stages/snake-run-C01..C06.json`、`docs/arcade/0.9/docs/snake-run.md`。
> 运行时数据（平台生成物，未手改）：`apps/arcade/challenge/snake-run.js`；测试夹具：`tools/testdata/challenge/snake-run.json`。
> 实现文件：`apps/arcade/games/snake-run.html`；测试模块：`tools/challenge/snake-run.mjs`。

## 1. 支持的字段

| 设计字段 | 支持 | 实现说明 |
| --- | --- | --- |
| `grid.cols/rows = 18×18` | ✅ | 沿用经典 18×18 棋盘与单元格渲染；挑战数据按 18×18 常量坐标加载 |
| `initialSnake[][]` | ✅ | 蛇身坐标按数据原样初始化（头在前），C01 起 `[[3,3],[2,3],[1,3]]` |
| `initialDirection` | ✅ | `R/L/U/D` → 方向向量；C01 起均为 `R` |
| `walls[][]` | ✅ | 固定墙/柱/回廊写入 `obstacles`，与经典障碍同样渲染与碰撞；撞墙即失败（无随机障碍、无金果实） |
| `fruitQueue[][]` | ✅ | 脚本化果实按序出现，**同一时刻只显示下一枚**，绝不随机；`stageObservable().food/fruitIndex` 可观测 |
| `fruitSpawnMode` | ✅ | `scripted-once`：吃掉后按 `fruitQueue` 顺序推进；无经典 `randomFreeCell` 参与 |
| `stepIntervalMs` | ✅ | 每关固定步间隔（C01–C03 230ms，C04–C06 200ms），挑战内不随吃果加速 |
| `win.type=collect-in-order` / `fruitCount` | ✅ | 按序吃满 `fruitCount` 枚 → `state='cleared'` → `A.Challenge.markCleared` |
| `lose.type=wall-or-body` / `lives=1` | ✅ | 撞边界/撞墙/咬到自己 → 立即失败，失败原因按类型可归因（无经典 3 命/无敌帧重置） |
| `turnBuffer`（最大队列 2 / 每步出队 / 拒绝 180°） | ✅ | `chDirQueue` 最多缓存 2 个方向；每逻辑步出队一个；与“最后方向”相反的 180° 输入拒绝 |
| `bonus`（减少总步数） | ✅（可观测） | 挑战不设额外分数，`stageObservable().steps` 与结算用时共同作为“更少步数”的客观证据；未引入战力/奖励 |
| `integration.adaptToHead` | ✅ | 初始蛇头位置直接取 `initialSnake[0]`，不做中心点换算 |
| `requiredFeatures[]` | ✅ | `fixed_snake_map`（固定墙）、`scripted_fruit_queue`、`direction_queue` |

## 2. 挑战流程与 UI（按 INTEGRATION-CONTRACT §4）

- **入口**：开始弹层主按钮「开始游戏」保持经典不变；第二入口 `[data-ov-btn2]` =「挑战 6 关」（数据缺失时禁用并显示「挑战数据不可用」）。
- **选关**：`.ac-challenge-panel` 由 `A.Challenge.stageListHtml` 生成（初始隐藏），6 个 `.ac-stage-btn[data-stage-id]`；锁定关 `disabled + .is-locked`；`返回开始` 按钮回开始弹层。
- **关卡内**：`[data-ch-hud]` 显示 `Cxx 标题 · 目标 · 果实 n/N · 用时 · 步数`；经典分数/最高/生命 HUD 用 `hidden` 隐藏；canvas 同步绘制目标提示（前 3 秒）、墙、脚本果实、蛇身。
- **状态机**：`ready → playing → paused → playing → cleared | failed`；暂停弹层 btn2 =「退出挑战」（回选关）；失焦/切后台自动暂停且不推进计时。
- **失败**：可归因文案（撞到边界墙 / 撞到石墙 / 咬到自己的身体 + 本关目标）+ 主按钮「重试本关」（1 次点击重置本关蛇身/脚本果实/步数）+ btn2「返回选关」。
- **通关**：`A.Challenge.markCleared({timeSec, assisted, collectibles})`；结算用 `A.Challenge.resultHtml`；C01–C05 主按钮「下一关」、C06「返回选关」，btn2「重玩本关」。
- **assisted**：挑战中使用 0.7 道具（慢速泡泡/轻身剪）→ 本关结果 `assisted:true`，结算显示「辅助」；经典最高分不受影响。
- **记录边界**：挑战不调用 `Progress.recordPlay`，不写最高分、不写 Playtime 轮次。
- **存档**：`runs:v1.data` 增加 `mode / stageId / chElapsed / chSteps / chFruitIndex / chFruitsEaten / chAssisted / dirQueue`；旧档缺 `mode` 按经典恢复；挑战恢复同一关、蛇身、方向队列、脚本果实进度、步数与用时。不新增 localStorage key。

## 3. `#test` 钩子（契约 §5）

保留全部既有钩子；新增：

- `challengeStages() → [{id, stageNumber, title, unlocked, best}]`
- `startChallenge(ref) → boolean`（受解锁约束；C01 恒开）
- `challengeInfo() → {mode, stageId, stageIndex, state, elapsedSec, objective, cleared, collectibles, assisted, fruitsEaten, fruitTotal, steps, errorReason}`
- `stageObservable() → {mode, stageId, state, snake, dir, dirQueue, food, walls, fruitIndex, fruitTotal, fruitsEaten, steps, stepIntervalMs, elapsedSec, assisted, errorReason, cleared}`
- `queueChallengeDirection('U'|'D'|'L'|'R'|{x,y}) → boolean`（供确定性测试补充真实输入；仍遵守 180° 拒绝与队列上限）
- `forceStageClear(assisted=false) → boolean` / `forceStageFail(reason) → boolean` / `exitChallenge() → boolean`

## 4. 设计差异（原值 → 新值 → 原因）

| 项目 | 原设计 | 实现 | 原因 |
| --- | --- | --- | --- |
| 挑战速度曲线 | 设计只给固定 `stepIntervalMs`（230/200ms） | 挑战内保持固定步间隔，不随吃果加速；慢速道具仍可临时 +60ms | 固定间隔是参考路线 `movesRLE` 可复现的前提；加速会让按键时序依赖帧率 |
| 挑战生命 | `lose.lives=1` | 1 次撞墙/咬身即失败（不重置蛇身） | 与设计一致；避免经典 3 命/无敌帧语义混入挑战 |
| 金果实/随机障碍 | 设计无 | 挑战完全不生成金果实与随机障碍 | `scripted-once` 保证固定地图与脚本果实；金果实属于经典玩法 |
| 经典道具体感 | 0.7 道具仍可用 | 挑战中可用慢速/轻身，但标记 `assisted` | 合同 §4.8 要求使用限量道具时记录 assisted；不强制禁用 |
| `bonus` | “减少总步数” | 不设额外奖励，仅暴露 `steps` 与结算用时 | 设计未定义 bonus 数值；避免跨关战力/奖励，保持无 FOMO |
| 渲染速度文字 | 经典 HUD 显示“x 格/秒” | 挑战 HUD 显示果实进度/步数/用时，不显示速度 | 固定步间隔不需要速度暗示；突出关卡目标 |
| 结束动画 | 经典 1 命失败有粒子/短暂停顿 | 挑战立即失败弹层（无长动画阻塞） | 合同要求失败 2 次点击内重试、不被长动画阻塞 |

坐标、墙、脚本果实、步间隔、胜负条件均逐关与设计源一致，未调整数值。

## 5. 证据等级与实测命令

| 场景 | 覆盖 | 证据等级 |
| --- | --- | --- |
| `CH-SN-001` | 6 关数据、锁定/解锁、选关面板真实点击进入 C01、固定地图/初始蛇身/脚本果实/步间隔、HUD 切换 | engine-replay |
| `CH-SN-002` | C01 按 `referencePlan.movesRLE`（R6/D7/L1）**真实方向键逐步输入**（keydown→keyup，按步等待）完成 14 步、吃满 3 枚脚本果实 | **real-input-replay** |
| `CH-SN-003` | 真实方向键向上撞边界 → 失败可归因（撞到边界墙）+ 1 次点击重试回本关起点（蛇身/果实/步数重置） | engine-replay（失败由真实方向输入触发） |
| `CH-SN-004` | 方向队列：两个 90° 快速入队按步执行、180° 反向拒绝、队列上限 2；使用轻身剪 → assisted=true 并写入记录 | engine-replay |
| `CH-SN-005` | 暂停 → 刷新 → 续玩恢复同一关/蛇身/步数/HUD | engine-replay |
| `CH-SN-006` | 经典 20 果实/3 生命/开始按钮回归 + 320×568 / 390×844 无横向溢出、挑战入口 ≥44px | engine-replay |

```powershell
# 内联脚本语法（抽取 <script> 后 node --check）
node -e "const fs=require('fs');const s=fs.readFileSync('apps/arcade/games/snake-run.html','utf8');fs.writeFileSync(process.env.TEMP+'/sn-inline.js',[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n'))"
node --check "$env:TEMP/sn-inline.js"          # exit 0

$env:ARCADE_GAMEPLAY_PORT='8803'; $env:ARCADE_GAMEPLAY_CDP_PORT='9403'
node tools/arcade_gameplay_test.mjs --game=snake-run --repeat=2
# → 12/12 scenario runs passed，exit 0（6 场景 ×2）
#   CH-SN-002: steps=14, fruits=3, timeSec=3.2, evidence=real-input-replay
#   CH-SN-003: reason=撞到边界墙：先看缺口再决定掉头或绕行
#   CH-SN-004: queue=2, dir={"x":-1,"y":0}, head={"x":2,"y":4}, assisted=true
#   CH-SN-005: stage=snake-run-C01, steps=2
#   CH-SN-006: widths=320:320/320 390:390/390
node tools/arcade_gameplay_test.mjs --suite=base --repeat=2   # → 12/12 PASS（base suite 当前由 T056 维护，5 个 pending）
```

## 6. UNVERIFIED / 风险

- **真机 iOS/Android 与滑动手势未测试**（UNVERIFIED）：触摸滑动在无头 Chrome 以逻辑坐标模拟，真实手指滑动/多指/滚动需真机确认。
- **长蛇 + 极限转向**：参考路线只验证 C01；C02–C06 的参考解由设计包静态校验提供，本实现的**真实输入回放仅覆盖 C01**，其余关卡按同一数据驱动逻辑（自动测试只覆盖 C01 通关 + 失败/暂停/经典回归），C02–C06 完整通关未逐关回放（UNVERIFIED，需 Reviewer/真人试玩）。
- **完整 85 项 smoke 未由本 Agent 运行**（Lead 统一跑）：本页 classic 分支只增加 `mode:'classic'` 存档字段与挑战入口按钮；CH-SN-006 与 base suite 覆盖开始弹层、经典配置与存档恢复，但 13 游戏全量 smoke 需 Lead 执行。
- 挑战记录/导出导入由平台 `A.Challenge` 统一处理（本游戏不直接读写 storage）。
- 挑战中“步数更少”没有额外奖励，仅作为可复盘指标（见 §4）。

## 7. Reviewer 结论占位

- Verdict：待 T057 独立评审。
- 建议复核点：C01 `movesRLE` 真实输入回放录像/截图（`test-artifacts/gameplay-CH-SN-002.png`）、方向队列 180° 拒绝、assisted 记录、320/390 截图、C02–C06 真人试玩。
