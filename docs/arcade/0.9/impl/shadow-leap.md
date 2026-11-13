# 影跃（`shadow-leap`）0.9 挑战模式实现记录

> 任务：T043 / `task-8` · 分支 `feat/arcade-0.8-gameplay` · 实现者：g-shadow
> 数据源：`docs/arcade/0.9/levels/shadow-leap.json` + `docs/arcade/0.9/levels/stages/shadow-leap-C01..C06.json` + `docs/arcade/0.9/docs/shadow-leap.md`
> 运行时数据：`apps/arcade/challenge/shadow-leap.js`（平台生成物，页面只读，SHA-256 `838fca8dbd98497a7e46499dec6828901ea68ea825838304d95779072f5b44f0`）
> 页面：`apps/arcade/games/shadow-leap.html`（SHA-256 `391fa8f8225b043b54fbe287d0cc8b7d18d379d152aaafb1d8e593e4bb13ec05`）
> 场景模块：`tools/challenge/shadow-leap.mjs`（SHA-256 `96d9f42522f9e5a440b0677fe74dc4946ba44eb638a45bc7580cf18be0ba89a9`）
> 状态：**PASS（自测）**，`--game=shadow-leap --repeat=2` 16/16、`--suite=base` 11/11、`validate_site` PASS；真机项见 §9 UNVERIFIED。

---

## 1. 数据迁移与坐标换算

- 页面不再内嵌 0.8 的 `STAGES-JSON-BEGIN/END` S1–S3 数据块；改为在 `engine.js` 之后加载
  `<script src="../challenge/shadow-leap.js"></script>`，内联脚本通过 `A.Challenge.stages('shadow-leap')`
  读取 6 关数据（不足 6 关 / 缺文件 → 挑战入口禁用并提示「挑战数据不可用」，经典模式照常，fail closed）。
- 坐标换算（与设计 `coordinates` 语义一致，不按屏幕坐标硬编码）：

| 设计字段 | 引擎世界坐标 |
| --- | --- |
| 起始平台（`playerSpawn.platformId`，默认 `mainRoute[0]`）台面 | `CH_START_WORLD_Y = 620`（该平台 `height:0` 的台面 worldY） |
| `platform.height`（向上为正） | `platform.worldY = 620 - height` |
| `platform.xCenter` / `platform.width` | `platform.x = xCenter - width/2`（左上角），`w = width` |
| `goal.xCenter` / `goal.height` / `goal.radius` | 圆心 `(xCenter, 620 - height)`、半径 `radius`；与角色矩形做**圆-矩相交**判定（`A.Physics.circleBox`），不是 AABB 近似。未使用「矩形近似」可选项。 |
| `playerSpawn.offsetX` | 起始出生点 x 相对平台中心的偏移 |
| `height` 与屏幕 | 6 关目标高度 402–435px、最高平台 435px；`420×740` 视口一屏可见，挑战模式固定 `camY = 0` 不滚屏（经典无尽仍为滚动世界）。失败线为 `player.y > 740 + 30`。 |

> 世界基准 620 是实现选择（设计只给相对 height）。它是 C01–C06 都能在一屏内完整展示、且底部留出坠落判定的最小值；写入「设计差异」§8.2。

---

## 2. 支持字段表

| 设计字段 | 支持 | 实现说明 |
| --- | --- | --- |
| `coordinates` | 说明性 | 只作为注释语义，运行时按 §1 换算 |
| `playerSpawn.platformId` / `offsetX` | ✅ | 出生点=起始平台台面中心+offsetX |
| `platforms[].id/xCenter/height/width/kind` | ✅ | `kind`: `static`→normal、`moving`→moving、`fragile`→fragile |
| `platforms[].amplitude/periodSec/phase`（moving） | ✅ | `range=clamp(amplitude,0,30)`、角速度 `2π/periodSec`、`phase` 直接作为初相位，运动完全确定性 |
| `platforms[].breakDelaySec`（fragile） | ✅ | 着陆后先出现裂纹预警 `breakDelaySec`（0.65/0.7/0.8s）再坍塌（0.8 原实现是「落地立即 0.22s 消失」，见 §8.7） |
| `mainRoute` | ✅ | 驱动参考路线/路线进度/分流提示；结算路线判定 |
| `alternativeRoute` | ✅ | 反标平台 `routes`（两条路线都经过=共享）；结算显示「主路线/备选路线/混合/自由路线」；不影响通关与解锁 |
| `goal.type = 'gate'` | ✅ | 绘制月影门；`type` 其它值按 gate 处理 |
| `goal.xCenter/height/radius` | ✅ | 圆-矩判定（§1）；半径缺省 38 |
| `goal.unlock = 'all-switches'` | ✅ | C06：两座半月雕像未全点亮时影门不可进，只提示「还需触碰 N 座」 |
| `requiredAbility` | ⚠️ 数据字段 | 读取/展示/测试可观察（C03+ 为 `dash`），引擎**不硬性门禁**；影冲本身始终可用（见 §8.6） |
| `stageRule` | ✅ | `side-scroll/gap/fork/wind/two-switch` 只决定失败复盘文案与机制开关（wind/two-switch） |
| `collectibles[].id/platformId/optional` | ✅ | 生成在平台中心上方 46px、触发半径 14；**纯收集记录**，不影响通关/解锁/战力；结算显示徽章 |
| `deathPolicy` | ✅ | 解释为「最近成功着陆平台=检查点」（§8.8）：1 次点击重试，计时重置，卷轴/开关不回退 |
| `winds[].heightFrom/heightTo/forceX` | ✅ | C04：角色中心高度落入 `[heightFrom,heightTo]` 时施加固定水平加速度 `forceX=±65 px/s²`，**无随机**；风带/箭头/旗标常驻可视化 |
| `switches[].platformId/persistentWithinAttempt` | ✅ | C06：**亲自落到**开关平台即点亮（不能隔空）；回中央平台/死亡重试不清空；仅「重玩本关」新一次尝试清空 |
| `targetDurationSec` | ⚠️ 仅记录 | 存入 `challengeStages()` 元数据，游戏内未展示（设计建议时长见 §8.4 的实测偏差） |
| `difficulty` | ⚠️ 仅记录 | 面板未显示难度星级 |

---

## 3. 入口 / 选关 / 流程

- **入口**：开始弹层主按钮 `[data-ov-btn]` 文案与行为完全不变（「开始游戏」→ 经典无尽）；
  第二入口 `[data-ov-btn2]` 文案「挑战 6 关」（数据缺失时禁用并显示「挑战数据不可用」）。
- **选关**：页面本地 `.ac-challenge-panel[data-ch-panel]`（**紧邻 `.stage-box` 放在 `.stage-wrap` 内**、绝对定位覆盖舞台区、初始 `hidden`；
  不放进画布内是为了窄机（320×568 时 `.stage-box` 仅约 180–230px 宽）也能完整读到标题/最佳），
  6 个 `.ac-stage-btn[data-stage-id]`：显示 `Cxx 标题`、`未通关 · 目标` / `✅ 最佳 mm:ss`、锁定关
  `disabled + is-locked + 🔒 需先通关上一关`；头部 `n/6 已通关`；返回按钮 `[data-ch-back]` 回开始弹层。
  解锁完全由 `A.Challenge.isUnlocked` 决定（C01 恒开，C0N 需前关已通）。
- **关卡内**：顶栏 `[data-ch-hud]` 显示 `Cxx 标题 · 影门 NNNm · mm:ss`；画布内首 3 秒显示 `goalStatement`
  与短操作提示，之后显示计时/卷轴/半月雕像进度；挑战模式隐藏经典高度/最高 HUD 与米数标尺。
- **状态机**：`ready → playing → paused → playing → cleared | failed`；暂停沿用 `bindPause`，
  挑战暂停弹层 btn2「退出挑战」回选关；`visibilitychange/blur` 自动暂停且不推进计时。
- **失败**：可归因文案（按 `stageRule` 选提示）、主按钮「从最近检查点重试 / 从本关起点重试」1 次点击、
  btn2「返回选关」；无阻塞动画。
- **通关**：`A.Challenge.markCleared(gameId, stageId, {timeSec, assisted, collectibles})` 写入
  `studiokit:arcade:challenge:v1`，结算弹层用 `A.Challenge.resultHtml(stage, result)` +
  路线/影冲次数补充行；主按钮「下一关」（C06「返回选关」）、btn2「重玩本关」。
- **辅助**：挑战中使用羽落/月弹 → 本关 `assisted:true`（结算显示「辅助」徽章）；**影冲不算辅助**。

---

## 4. 影冲保留（0.8 GP004 机制未回退）

- `Shift / J`、独立 `[data-air-dash]` 按钮（≥44px，390px 实测 117×48）、每次空中 1 次、着陆补充、
  冲刺期间重力 25%、落地保留 60% 横向惯性、暂停/刷新恢复 `dashCharges/dashTimer/dashDir`、
  旧经典档缺字段按 1 次恢复——全部保留。
- C03 影冲必要性（真实输入证据，CH-SL-006）：
  - **无影冲不可达 p1→p2**：p1 最右可落脚 `x≈102`，p2 最左可落脚 `x≈303`，需水平位移约 **201px**；
    77px 上升在下降分支的滞空约 **0.708s**，即使以最大水平速度 265px/s 起跳位移上限约 **188px**
    （含「上一次影冲落地保留 60% 冲速」的极限情况约 198px）仍 < 201px → 物理不可达。
    实测：真实按键自动操作 9s 只在 `p0/p1` 往返（`noDashLandings=[p0,p1]`，最终失足），从未落上 p2。
  - **有影冲可达**：0.13s 影冲水平 620px/s 且重力×0.25，既补 ≈46px 水平位移，又把单跳上升高度从
    136.5px 提升到约 196.6px；实测 1.9s 用 1 次影冲清关（落点 p1→p3）。
  - 使用羽落/月弹道具时可不用影冲跨越（道具固有机制，结果会写 `assisted:true`；见 §8.6 与 UNVERIFIED）。

---

## 5. C04 侧风 / C06 开关 / 收集物实现摘要

- **C04 风之回廊**：`winds:[{heightFrom:110,heightTo:230,forceX:-65}]`。角色中心高度进入区间时
  `vx += forceX*dt`，上限放宽到 `±(MAX_VX+60)`；画面常驻风带（半透明区+虚线边界+漂移箭头+「风 ←」），
  不随时间/种子随机。实测真实输入参考通关 0 影冲可完成。
- **C06 月门守卫**：`switches` 两座移动平台；着陆即点亮（粒子+音效+HUD `半月雕像 n/2`）；
  `goal.unlock='all-switches'` 未满足时进入影门圆只显示「影门未开启：还需触碰 N 座半月雕像」不结算；
  回中央平台与死亡重试不清空，新一次「重玩本关」清空。实测参考通关点亮 2/2 后清关。
- **收集物**：C01/C03/C05 各有 1 个卷轴（挂在 `secret` 平台上方）；触发半径 14，收集写入
  `challengeState.collectibles` 与本关记录 `collectibles`；结算显示徽章；不拿可通关（CH-SL-002 无收集通关、
  CH-SL-007 拿取后记录 `['scroll']`）。
- **死亡检查点**：最近一次成功着陆的平台（记录平台 index + 落点 x）；死亡 → 1 次点击重试回该平台，
  计时归零，卷轴/开关/路线进度保留（design `关卡任务不回退`）。

---

## 6. 存档与兼容

`serialize()`（`state === playing|paused` 时）：

```jsonc
{
  "mode": "classic" | "challenge",
  "stageId": "shadow-leap-C0x" | null,
  "stageIndex": 0,
  "player": { "x": 0, "y": 0, "vx": 0, "vy": 0, "face": 1 },
  "platforms": [{ "id", "index", "x", "y", "w", "kind", "baseX", "range", "speed", "broken", "breakTimer", "crackTimer", "phase" }],
  "camY": 0, "topY": 0, "startY": 0, "score": 0, "generatedCount": 0,
  "tools": { "feather": 2, "boost": 2 }, "featherTimer": 0, "boostArmed": false,
  "dashCharges": 1, "dashTimer": 0, "dashDir": 1,
  "challengeState": {  // 仅 challenge
    "elapsed": 12.3, "collectibles": ["scroll"], "switches": ["left-switch"],
    "assisted": false, "dashes": 2,
    "checkpoint": { "platformIndex": 3, "x": 140 },
    "routeLanded": ["main"], "routeShared": true, "routeStep": 4
  }
}
```

`restore(data)` 返回值：`'classic' | 'challenge' | 'legacy-trial' | false`。

| 存档形态 | 行为 |
| --- | --- |
| 缺 `mode`（0.7/0.8 经典无尽档） | 按 **classic** 恢复，位置/平台/相机/道具/影冲全部沿用旧逻辑（旧档缺 `dashCharges` 按初始 1 次） |
| `mode:'challenge'` + 合法 `stageId` | 重建该关世界后恢复 `challengeState`（计时/收集/开关/辅助/检查点/路线）+ 平台动态状态 + 玩家状态，`camY=0` |
| `mode:'challenge'` 但 `stageId` 非法/数据不可用 | 返回 `false`，清局内档并回开始弹层（不删 `challenge:v1`/`progress:v1`） |
| `mode:'trial'`（0.8 影之试炼 S1–S3） | 返回 `'legacy-trial'`，弹层提示「试炼数据已升级」：`stageIndex 0/1/2 → C01/C02/C03`，主按钮「继续 C0x」（从该关起点开始）/ btn2「返回开始」；**不静默删档**，`challenge:v1` 与 `progress:v1` 在提示与继续前后均保持不变（CH-SL-004 实测 `recordPreserved=true`） |

不新增 localStorage key；挑战记录只写平台提供的 `studiokit:arcade:challenge:v1`；挑战不写
`progress:v1` 最高分、不写 `playtime:v1` 轮次（沿用 0.8 约定）。

---

## 7. `#test` 钩子

保留全部旧钩子：`info / joyInfo / useJoyTool / setMotion / setPosition / fallInfo / setFeatherTimer /
forceLand / dashInfo / triggerDash / setSeed / seed / resetWithSeed / startClassicWithSeed / airborne`。

新增契约 §5 钩子：

| 钩子 | 说明 |
| --- | --- |
| `challengeStages()` | 6 关 `{id,stageNumber,title,difficulty,goalStatement,requiredAbility,stageRule,unlocked,cleared,best,platforms,collectibles,routeIds,targetDurationSec}` |
| `startChallenge(ref)` | 测试用进入指定关（`ref`=stageId/number/index；**绕过 UI 解锁**以便逐关验证，真实解锁仍由面板 disabled 控制）→ boolean |
| `challengeInfo()` | `{mode,stageId,stageIndex,stageNumber,state,elapsedSec,objective,cleared,failed,collectibles,collectiblesTotal,assisted,switches,switchRequired,route,routeLabel,routeInfo,checkpoint,dashes,failReason,goal{unlocked},player,panelOpen,results}` |
| `stageObservable()` | 平台（含移动相位/裂纹/碎裂）、影门圆、角色矩形、`mainRoute/alternativeRoute`、`routeStep/lastLandedId/landings`、收集物、开关、winds、HUD 提示态 |
| `forceStageClear(assisted?)` | 仅测试：按当前状态直接结算（记录/解锁/UI 验证；不作为可玩性证据） |
| `forceStageFail(reason)` | 仅测试：触发失败路径 |
| `exitChallenge()` | 退出挑战回选关 |

0.8 试炼钩子名保留并迁移到 C01–C06 语义（旧脚本不崩）：`stageList / startTrial / loadStage / trialInfo /
routeInfo / forceRoute / stagePlatforms / forceReachGoal / forceFall / forceCollectScroll / trialResults`。

---

## 8. 设计差异（原值 → 实现值/实测 → 原因）

> 原则：不静默改设计数值。以下均为「设计语义在真实引擎中的落地解释」或「设计数值与引擎物理的偏差」，目标/主线/奖励未被删改。

### 8.1 影门判定几何（设计未给形状 → 圆-矩）

- 原值：`goal:{xCenter,height,radius:38}`，未规定判定形状。
- 实现：圆心 `(xCenter, 620-height)`、半径 38 的圆 vs 角色 26×30 矩形（`A.Physics.circleBox`）。
- 原因：`radius` 语义即圆；引擎已有 circleBox，比 AABB 更贴合设计。未用矩形近似。

### 8.2 世界 y 基准（相对 height → `CH_START_WORLD_Y=620`）

- 原值：height 相对起始平台、向上为正，无绝对世界坐标。
- 实现：起始台面 worldY=620；整关一屏、挑战不滚屏。
- 原因：目标高度最大 435px，420×740 视口一屏可容纳；固定相机让失败线/风带/HUD 稳定。

### 8.3 参考落点序列偏差（影门半径导致的捷径，未改数值）

实测参考通关（真实输入自动操作，`--repeat=2` 两遍一致）：

| 关 | referencePlan 主路线 | 实测落点序列（触门即结算） | 结论 |
| --- | --- | --- | --- |
| C01 | p0,p1,p2,p3,p4,p5 | p0,p1,p2,p3 | 从 p3 起跳即可触门（影门圆心高 402，p3 高 214；p3 起跳后角色上沿可达高度约 380.5，与圆心差约 21.5 < 半径 38） |
| C02 | p0,p1,p2,p3,p4,p5 | p0,p1,p2,p3,p4 | 从 p4 起跳触门 |
| C03 | p0,p1,p2,p3,p4,p5 | p0,p1,(影冲)p3 | 影冲把单跳上升高度提到约 196.6px，p1 直接落 p3；p2 未落 |
| C04 | p0,p1,p2,p3,p4,p5 | p0,p1,p2,p3,p4 | 从 p4 起跳触门 |
| C05 | p0,p1,l2,l3,l4,p5 | p0,p1,l2,secret,l4 | 自动操作在 l2 后被卷轴平台吸引，最终 `mixed` 路线；主路线末两跳未落 |
| C06 | p0,p1,left-switch,center,right-switch,center,upper,p6 | p0,p1,left-switch,center,right-switch,center,upper | 两开关正确点亮；从 upper 起跳触门，未落 p6 |

- 原因：影门半径 38 + 单跳上升 136.5px（影冲 196.6px）+ 平台间距 70–83px，使影门可从比设计末台低
  1–3 层的平台触达（经验阈值：平台高度 ≥ 目标高度 − 204.5 即可在跳跃上升段触门）。
- 处理：未改 `goal`/平台数值；登记为设计-引擎偏差（偏「捷径过多、时长偏短」）。建议 Reviewer/Owner 决定：
  ① `radius` 降至 ~20 且 `goal.height` 抬高到最后平台 +30 以上；或 ② 增加主路线平台数（见 8.4）；或 ③ 接受捷径。
  三者都会改变关卡体验/数值，按合同不在本任务静默实施。

### 8.4 关卡目标时长偏差（45–155s → 实测 1.9–4.5s）

- 原值：每关 `targetDurationSec:[45,155]`，设计文档写「每关 45–120 秒」（0.8 参考）。
- 实测（真实输入参考通关，两遍一致）：C01 2.5s / C02 2.9s / C03 1.9s / C04 2.9s / C05 2.9s / C06 4.5s。
- 原因：0.9 每关仅 6–10 块平台、自动起跳、每跳约 0.7s；0.8 试炼 S1–S3 有 18/26/20 块平台（约 15–20s）。
  设计高度 435px 在 70–83px 步高下只需 6–7 跳。
- 处理：未改关卡数/跳跃参数；登记为设计-引擎偏差。建议加长主路线（平台数 ~18+）或增加横向绕行，
  使参考通关接近 45s。

### 8.5 C03 p1→p2（无影冲不可达成立；有影冲「更短路线」是 p3）

- 原值：`p1(height 78)` → `p2(height 155, xCenter 365,w 76)` 需要影冲。
- 实测：无影冲 9s 只能在 p0/p1 往返（最终失足），从未落 p2；有影冲清关但直接落 p3。
- 原因：见 §4 的物理量；影冲同时提供水平与高度收益。
- 处理：保留原数值；p1→p2 单独落点未回放，标注 UNVERIFIED；「无影冲不可达」已证。

### 8.6 `requiredAbility:'dash'`（C03–C06）不做硬门禁

- 原值：C03–C06 `requiredAbility:'dash'`。
- 实现：字段读取/展示；影冲始终可用，引擎不阻止无影冲玩法。
- 实测：C04/C05/C06 的自动操作参考通关均 **0 次影冲** 也能完成（C03 无影冲不可达）。
- 原因：设计没有定义「未使用影冲即失败」的胜负条件，只表达设计意图；加硬门禁会改变设计语义。
- 风险：C04–C06 的影冲教学/使用动机不足；建议后续用缺口/风区/开关相位设计逼出影冲，或 Owner 明确要求硬门禁。
- 另：羽落/月弹可替代影冲跨越 C03 缺口（道具机制固有），结果 `assisted:true`，不当作无辅助通关证据。

### 8.7 易碎平台预警（0.8 「落地立即碎」→ 0.9 `breakDelaySec` 裂纹预警）

- 原值（0.8 实现）：着陆即 `broken`，0.22s 后移除，没有预警窗口。
- 实现：着陆开始裂纹计数 `breakDelay`（0.65/0.7/0.8s），期间照常站立/可再弹跳，倒计时结束才坍塌。
- 原因：设计 `易碎平台在脚下有 0.65 秒醒目裂纹提示，不能无预警坍塌`；`breakDelaySec` 字段此前未使用。

### 8.8 死亡检查点语义（设计未列检查点平台）

- 原值：`deathPolicy: 落出关卡边界后从最近房间检查点重试，关卡任务不回退`。
- 实现：检查点 = **最近一次成功着陆的平台**（记录平台 index 与落点 x）；死亡后 1 次点击重试回该平台，
  计时归零，卷轴/开关/路线进度保留。
- 原因：关卡数据无「房间/检查点」字段；按任务卡「本关起点或最近过的检查点平台」与 deathPolicy 落地。
  「重玩本关」（结算/暂停）视为新一次尝试，清空开关与收集。

### 8.9 C06 双路线判定

- 原值：mainRoute 与 alternativeRoute 只是开关顺序不同，平台集合基本一致。
- 实现：两条路线反标后共享平台带双 route 标签 → 路线判定为「自由路线」（未走过独占平台时）或「混合」。
- 原因：路线的「独占平台」集合为空，无法区分顺序；不虚构路线标签。

### 8.10 数据结构字段收敛

- `moving.phase` 设计写作 1.57/3.14 等弧度值，运行时直接作为初相位；`amplitude` 限制 ≤30（与经典/0.8 一致）。
- `collectibles` 设计只在 `secret` 平台；实现按平台中心上方 46px 生成，未改平台。
- `targetDurationSec/difficulty` 只进测试元数据，游戏内不展示（未设计对应 UI）。

---

## 9. 测试场景与证据等级

`tools/challenge/shadow-leap.mjs`，`--game=shadow-leap --repeat=2` 实测 **16/16 PASS**（8 场景 × 2 遍，结果逐遍一致）。

| 场景 | 内容 | 证据等级 |
| --- | --- | --- |
| CH-SL-001 | 6 关数据/标题/requiredAbility、C01 恒开、C02 初始锁、选关面板 6 按钮/锁定态/返回、forceStageClear 后解锁 C02 + `challenge:v1` 记录/最佳/✅ 展示 | ui-only |
| CH-SL-002 | C01 参考通关（面板点入 → 真实 KeyboardEvent 自动操作 → 影门）：cleared、结算「影门开启/下一关/重玩本关」、用时/收集物、`challenge:v1` 写入 | **real-input-replay** |
| CH-SL-003 | 失败归因文案 + 1 次点击重试回起点/计时重置；`forceStageFail` 与真实 `forceFall`（走 update 坠落判定）两条路径 | engine-replay |
| CH-SL-004 | 挑战 C02 暂停→刷新→继续（mode/stageId/玩家位置/计时恢复）；旧经典档（无 `mode`）仍经典；旧 `mode:'trial'` 档提示升级并映射 C02，`challenge:v1` 前后不变 | engine-replay |
| CH-SL-005 | 主按钮经典 + 挑战入口仅第二按钮；暂停无挑战退出按钮；320×568 / 390×844 选关无横向溢出、按钮 ≥44px、影冲按钮 ≥44px（390 实测 117×48）、挑战 HUD | ui-only |
| CH-SL-006 | C03 无影冲真实输入 9s 只落 p0/p1（最终失足）→ 不可达；有影冲 1.9s 通关 | **real-input-replay**（负向+正向） |
| CH-SL-007 | C01 卷轴收集 + 备选路线 → 结算展示「收集物/备选路线」且记录 `collectibles:['scroll']`；C02 月弹 → assisted=true/结算「辅助」/记录 assisted | ui-only |
| CH-SL-008 | 六关连续真实输入参考通关（从面板 C01 起，逐关「下一关」）：每关 cleared、C06 后选关 6/6、六关最佳用时写入 | **real-input-replay** |

参考通关落点/用时（CH-SL-008，两遍一致）：C01 2.5s(4 落) · C02 2.9s(5) · C03 1.9s(3 落,1 影冲) · C04 2.9s(5) ·
C05 2.9s(5) · C06 4.5s(7,2 开关)。

> `real-input-replay` 说明：测试侧通过页面内 `window.__slAutoRun` 读取 `challengeInfo()/stageObservable()`
> 的只读状态，向 `window` 派发真实 `KeyboardEvent`（keydown/keyup/Shift），经引擎 `createInput` 输入管线
> 驱动角色；不使用传送/改坐标通关。合成事件 `isTrusted=false`，物理键盘未单独复跑（同一输入管线）。

---

## 10. 运行命令与实测输出

```text
# 1) 内联脚本语法（PowerShell 抽取 <script> 内容到 %TEMP% 后 node --check）
node --check %TEMP%\g-shadow\shadow-leap-inline.js          → exit 0
node --check tools/challenge/shadow-leap.mjs                → exit 0

# 2) 0.9 挑战场景（模块自动发现；端口避开 smoke/他人 runner）
$env:ARCADE_GAMEPLAY_PORT='8801'; $env:ARCADE_GAMEPLAY_CDP_PORT='9401'
node tools/arcade_gameplay_test.mjs --game=shadow-leap --repeat=2
→ PASS CH-SL-001..008（16/16 scenario runs passed）
→ 证据汇总：shadow-leap 场景=8 证据=ui-only+real-input-replay+engine-replay PASS=16 FAIL=0

# 3) 0.8 base 套件（11 场景，含 challenge-test-infra 迁移后的 SC-SL-004..008）
node tools/arcade_gameplay_test.mjs --suite=base
→ 11/11 scenario runs passed（SC-SL-001/002/003/009 经典无尽+影冲+旧档全绿）

# 4) 静态校验
py -3 tools/validate_site.py
→ PASS: StudioKit validation succeeded（exit 0）

# 5) 布局截图（runner 产物）
test-artifacts/shadow-leap-320.png / shadow-leap-390.png / shadow-leap-390-ingame.png
```

未运行 85 项完整 `arcade_smoke.mjs`（按任务边界由 Lead 统一跑）；未运行 `build_site.py`。

---

## 11. UNVERIFIED / 风险

1. **真机未测**：iOS/Android 真实多点触控（左/右键 + 影冲同时按）、触摸手感、刘海/安全区（env(safe-area)）
   均未验证；320/390 仅为 CDP 模拟。
2. **输入证据等级**：参考通关使用页面内合成 `KeyboardEvent`（`isTrusted=false`），未用物理键盘/真实触摸重跑；
   与 `tools/lib/arcade_cdp.mjs` 既有 `cdp.key` 同一输入管线。
3. **关卡时长**：45–155s 目标未达成（实测 1.9–4.5s，见 §8.4）；真人试玩时长/难度曲线未知。
4. **捷径**：影门半径 38 使 C01–C06 均可从比设计末台低 1–3 层的平台触门（§8.3）；是否接受待 Reviewer/Owner 决定。
5. **C03 p1→p2 落点**：无影冲不可达已证；有影冲「精确落到 p2」未单独回放（实际用更短路线落到 p3）。
6. **requiredAbility 不硬门禁**：C04–C06 可 0 影冲完成（§8.6）；是否需要强制影冲待设计决策。
7. **跨设备挑战记录**：`challenge:v1` 的导出/导入由 `A.Challenge`/平台负责，本游戏页只验证写入/读取/最佳；
   导出导入链路由平台任务与 Reviewer 覆盖。
8. **CH-CLASSIC-001 全局经典回归**（13 游戏遍历）未由本 Worker 运行（其他游戏并行开发中）；本页经典行为由
   base 套件 SC-SL-001/002/003/009 + CH-SL-005 覆盖。
9. **真实物理键盘的 Shift+方向并发**：现有 0.8 机制 + CH-SL-006 的合成 Shift+方向已验证，真机键盘未测。

---

## 12. Reviewer 结论占位

| 项 | 结论 | 备注 |
| --- | --- | --- |
| 6 关数据/解锁/记录 | 待复核 | CH-SL-001/008 |
| 参考通关证据等级 | 待复核 | real-input-replay（C01–C06） |
| 失败/重试/暂停恢复 | 待复核 | CH-SL-003/004 |
| 经典零回归 | 待复核 | base SC-SL-001/002/003/009 |
| 320/390 布局 | 待复核 | CH-SL-005 + 截图 |
| 设计差异接受度 | 待 Owner/Reviewer | §8.3/8.4/8.6 |
| 真机 | UNVERIFIED | §11.1 |
