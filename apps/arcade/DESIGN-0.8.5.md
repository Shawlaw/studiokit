# Arcade 0.8.5 设计：极速车道车流规则 / 贪吃蛇棋盘优先 / 积分记录消去层数

- 版本：Arcade `0.8.5`（`ARCADE_VERSION` / 注册表 / 中心页 / SW `VERSION` 同步）
- 日期：2026-11-19
- 状态：已实现并通过本地门禁；发布证据见文末
- 范围：`apps/arcade/games/road-rush.html`、`apps/arcade/games/snake-run.html`、`apps/arcade/games/block-drop.html`、`apps/arcade/engine.js`；不改 localStorage key / Schema、不改挑战数据、不改其余 10 款游戏。

本文件对本轮 Owner 的 6 条试玩反馈逐条给出根因、方案、实测与回滚方式。

---

## 1. 极速车道：玩一会儿卡死、车辆全部消失（阻断级）

### 根因（已复现）

`drawCar()` 绘制卡车时使用固定像素内缩：`A.draw.roundRect(ctx, -w/2 + 2, -h*0.38, w - 4, h*0.38, 6)`。
车辆在 `z=1`（地平线）生成时 `scaleAt(u) = u^2.6 = 0`，卡车宽度 `w = 44 * sc` 趋近 0，`w - 4` 变成负数；`A.draw.roundRect` 里 `Math.min(r, w/2, h/2)` 得到负圆角，Canvas 2D 的 `roundRect()` 直接抛 `RangeError: Radius value -1.99 is negative`。

异常发生在 `render()` 内、`requestAnimationFrame` 下一帧调度之前，于是 rAF 链断掉：画面停在“只画完天空/路面、车辆与玩家都没画”的半帧上，输入仍在但 update 不再运行 —— 与 Owner 描述的“卡住 + 画面内车辆全部消失”完全一致。卡车只在 `speed > 0.55` 后出现，因此表现为“玩一会儿之后”。用 4× 快进 + 自动驾驶复现到 `RangeError`，栈指向 `engine.js` 的 `roundRect → ctx.roundRect`。

### 修复（两层）

1. **根因**：`A.draw.roundRect` 统一把半径夹到非负（`Math.max(0, Math.min(r, |w|/2, |h|/2))`），并对非有限坐标直接跳过；`drawCar` 改为按比例内缩（`inset = clamp(w*0.06, 0.5, 2)`）、负尺寸取 0、亚像素车身跳过绘制。
2. **兜底**：`createLoop` 的 `update` / `render` 逐帧 `try/catch`；单帧异常只记前 3 次 `console.error`，rAF 继续调度。以后即使某款游戏再出现极端绘制错误，也不会永久冻结整局（测试仍可通过 console error 发现回归）。

另外修复了同一族的“隐形车堆死上限”问题：被玩家甩开的慢车 `z` 会越过地平线一直增大，旧代码只在 `z<-0.14` 回收；现在 `z>2` 直接回收，车辆上限仍为 18 且不会被不可见车占满。

---

## 2. 极速车道：远处的车临近才“长”出来

### 根因

`scaleAt(u) = u^PERSP`（`u = 1 - z`，`PERSP = 2.6`）在 `z=1` 处为 0，而路面宽度在地平线处仍有 `ROAD_W_FAR = 54px`（近端 336px）。车流尺寸与路面透视不一致：车身在地平线是 0 像素，直到中段才指数放大，所以看起来是“临近才凭空收缩成一台车”。

### 修复

- `scaleAt(u)` 改为与路面同一曲线：`(ROAD_W_FAR + (ROAD_W_NEAR - ROAD_W_FAR) * u^PERSP) / ROAD_W_NEAR`。地平线处保留约 **16.1%** 的车身（40×62 → 6.4×10px），远车从地平线起就可见。
- 车辆生成位置提前到 `z = 1.02 ~ 1.52`（可见范围之外），车道、速度、是否打灯在进入视野前就已确定；进入 `z≤1` 时按固定位置出现。
- 车辆按 `z` 过滤/排序绘制，`z>1.02` 不绘制；拾取物同理。
- `laneClearTime` / `futureSafe` / `spawnCar` 的走廊判定继续使用同一 `z`，提前生成的远车也参与预判。

实测：地平线车身 6.4×10px（`visualInfo()` 断言 ≥5×7），远车、树、里程牌与路面同步缩小，不再有“到眼前才出现”的跳变。

---

## 3. 极速车道：转向灯换道规则

新增“打灯并线车”（经典模式，挑战模式仍用固定时间轴，不受影响）：

- 生成时按 `16% + 26% × speed` 决定 `wantsChange`（卡车不换道），触发深度 `triggerZ = 1.06 ~ 1.34`（多数在进入视野前就开始打灯）。
- 状态机 `none → signal（0.55s）→ moving（0.5s）→ none`；`lanePos` 用 ease-in-out 平滑横移，`lane` 在完成后才落位。
- **可读性**：车头对应侧琥珀色灯闪烁（约 3Hz）、车顶同向箭头、目标车道铺一条琥珀色虚线导引，起灯时有一声轻提示。
- **公平性**：
  - 目标车道有其它车（`|Δz| ≤ 0.16`）时不打灯；打灯期间被占则取消。
  - 起灯前把车临时放到目标车道跑一次 `futureSafe()`；如果换过去会堵死玩家 ±1 车道的逃生走廊，就放弃这次换道。
  - 只对“其它车”让行；玩家必须自己根据转向灯做反应。
- **碰撞**：碰撞盒改用连续 `lanePos`，变道中的车横跨两条车道；`safeLaneList` / `futureSafe` 在打灯与横移期间同时把两条车道视为占用（最保守）。
- 存档新增 `lanePos` / `changeState` / `signalDir` / `signalLeft` / `changeLeft` / `changeFrom` / `changeTo` / `targetLane` / `blinkPhase` / `wantsChange` / `triggerZ`；旧档缺字段时 `lanePos := lane`、状态回 `none`。

---

## 4. 极速车道：增加娱乐点

| 机制 | 规则 | 反馈 |
|---|---|---|
| 连超（擦身） | 相邻车道（含变道擦身）超车 +1，两条车道以外不续；4.5s 没有新超车或撞车归零 | 画布顶部“连超 ×N”+ 剩余窗口条；3/6/10/15 连时提示音与“尾流加速” |
| 尾流加速 | 连超 ≥3 时有效速度 +0.05（归一化） | km/h HUD 提升 |
| 加速带 | 每 6～9.5s 随机车道生成，最多 3 个，提前在 `z>1` 决定；开过即得 3s +0.16 冲刺（上限 1.2） | 青色箭头 + 光柱、粒子、Toast“加速带：冲刺 3 秒” |
| 维修箱 | 车况 <3 时约 55% 概率替代加速带；开过恢复 1 点车况（上限 3） | 绿色十字 + 光柱、Toast |
| 分段节奏 | 每 1000m 横幅“1000m 达成 · 车流加密 5 秒”，5s 内发车间隔 ×0.78 | 金色横幅 + 铃声 |
| 本局评价 | 0 事故且最高连超 ≥8 → `S+`；否则 0 事故 `S`、1 次 `A`、2 次 `B`、≥3 次 `C` | 结算弹层显示评价/最高连超/超车数/用时；积分记录详情写入“评价 X · 最高连超 ×N · 超车 M 次” |

有效速度 = `min(1.2, cruise + 尾流 + 氮气)`；`cruise` 仍是原来的 0.28→1.0 缓升，撞车后 `cruise` 与速度同时降到 45%，连超/冲刺清零。

---

## 5. 贪吃蛇：移动端交互不精准 + 提速太快

### 棋盘优先画布

旧逻辑画布 `420×740`，18×18 棋盘只有 324px，上下各留 190/226px 空白；在 375×667 上实际棋盘仅约 **180px**（每格 10px）。
改为 `360×430`：`CELL = 17`、`BOARD = 306`、`BOARD_X = 27`、`BOARD_Y = 70`，上下只留 70/54px 标签与留白；`aspect-ratio` 页面级覆盖为 `360/430`（含沉浸模式），保证不变形。

实测棋盘边长（宽×高 = 画布）：

| 视口 | 0.8.4 棋盘 | 0.8.5 棋盘 | 变化 |
|---|---|---|---|
| 320×568 | ~137px | **203px** | +48% |
| 375×667 | ~180px | **273px** | +52% |
| 390×844 | ~257px | **309px** | +20% |
| 430×932 | ~295px | **343px** | +16% |
| 1280×900 | ~307px | **439px** | +43% |

### 四向操作按钮

- 新增 `[data-dpad]`：`← ↑ ↓ →` 四枚 58px 高按钮（320px 上仍 70px 宽），带“左/上/下/右”小字标签；`pointerdown` 即转向、阻止默认与长按菜单。
- 与键盘/滑动共用同一规则：经典模式拦掉头并写入 `nextDir`；挑战模式走 `queueChallengeDir`（2 个缓冲、掉头无效）。
- 位置在道具行上方；触屏隐藏重复 hint，把高度还给棋盘（`snake-hint`）。
- 舞台高度：`100dvh − shellbar − 243px`（横屏矮视口回到共享的 120px 规则），375/320 均无纵向溢出。

### 提速曲线

`stepInterval` 从 `0.19 → 0.2` 起步，吃果实改为 `max(0.12, 0.2 − foodsEaten × 0.0035)`（旧：`max(0.085, 0.19 − foodsEaten × 0.006)`）。20 个果实时由 **11.8 格/秒** 降到 **7.7 格/秒**；旧档恢复夹在 `[0.11, 0.26]`。

### 挑战 HUD

挑战徽标从画布内绝对定位层移到顶栏 `.game-hud`（与 block-drop 一致），只切换经典分数/最高两个 span；画布顶部画 `C0X 标题 / 用时 / 果实·步数`，底部留白常驻显示本关目标（≤460px 顶栏隐藏 HUD 时仍可读）。

---

## 6. 俄罗斯方块：积分记录补充当次消去层数

- 经典模式 `gameOver` 调用 `A.Progress.recordPlay('block-drop', score, { lines, level, detail: lines + ' 行 · Lv.' + level })`；禅模式原本已带 `lines/level/detail`，保持不变。
- `Scores` 的结构化字段 `lines`、`level` 一并写入；中心页积分表 `scoreDetail()` 优先显示 `detail`，旧记录缺 `detail` 时回退 `N 行 · Lv.x`。
- 不改变最高分语义（经典最高分仍是分数）、不改 key/Schema、不迁移旧记录。

---

## 兼容性与回滚

- **不改**：localStorage key / Schema（`progress:v1`、`runs:v1`、`playtime:v1`、`challenge:v1`、`scores:v1`）、挑战数据、其余 10 款游戏、Badge Studio / Venue Compare。
- **兼容旧档**：road-rush 旧局内档缺 `lanePos/changeState/pickups/连超` 等字段时按“车道即位置、无拾取、连超 0”恢复；snake 旧档 `stepInterval` 夹在新区间。
- **回滚**：本次提交按游戏分文件，可单独 revert：
  - 极速车道 → revert `road-rush.html`（引擎兜底可保留，它只把“永久冻结”降级为“单帧跳过”）；
  - 贪吃蛇 → revert `snake-run.html`；
  - 方块积分 → revert `block-drop.html` 的 4 行 meta；
  - 引擎 → revert `engine.js` 的 `roundRect` 夹取与 `createLoop` guard。
  回滚后需把 `ARCADE_VERSION` / 注册表 / 中心页 / SW `VERSION` 一起降回，避免 `validate_site.py` 与 `verify_deploy.py` 的版本一致性检查失败。
- **SW**：缓存键自动变为 `studiokit-arcade-0.8.5-v1`，旧缓存由 `activate` 清理。

---

## 门禁与证据

- `node tools/arcade_smoke.mjs`：**89/89**（新增“极速车道 远景出场/打灯换道/加速带/维修箱/连超评价”“贪吃蛇 棋盘优先画布 + 四向按钮 + 提速放缓”2 项；方块测试追加积分记录消去层数断言；版本断言升 0.8.5）。
- `node tools/arcade_zen_scores_test.mjs`：**14/14**（版本断言升 0.8.5；禅模式/积分表行为不变）。
- `node tools/arcade_gameplay_test.mjs --suite=base --repeat=2`：**22/22**（SC-ROAD-001 安全走廊与 18 车上限保持）。
- `py -3 tools/validate_site.py` / `py -3 tools/build_site.py` / `node --check`（engine/sw/road-rush/snake/block-drop 内联脚本）：通过。
- 4× 快进 + 自动驾驶压力跑（约 3 分钟游戏时间、多次重开）：`console` 0 错误、车流持续存在、转向灯车出现率约 18% 采样、加速带约 21% 采样、最高连超 40、最高有效速度 1.20。
- 发布：见 `apps/arcade/README.md` 的 0.8.5 小节与 `CHANGELOG.md`（发布后回填 Actions / verify_deploy 证据）。
- **UNVERIFIED**：真机 iOS/Android 的按钮手感、转向灯可读性与双击暂停仍未实机验证。
