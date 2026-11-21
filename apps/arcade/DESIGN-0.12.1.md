# Arcade 0.12.1 设计：层塔物理一致性修复 + 全览 zoom-to-fit

基线：0.12.0（2026-11-22 已双端发布）。本版只修层塔（`apps/arcade/games/pendulum-tower.html`），不动其它 15 款游戏、不改 `engine.js`、不改 localStorage key/Schema、不改挑战关卡数据。

## 1. Owner 反馈与复核结论

Owner 两条：

1. 「层塔物理还是不对劲。特别是单向偏置摆放后，原钟摆范围是否可达？不可达的话释放的时候是不是一定失败？」
2. 「全览实现得不好。几十层了，我需要整体缩小到视图能放得下为止。」

独立只读审计（subagent `tower-auditor`，基线 HEAD `bf9fbe2`）复核结论：

- **「塔没倒却再也够不到」的解析死局并不存在**：在未修复版本里，每次偏置落箱的塔顶中心 `D` 恒等于某次松手时的吊钩 x，而摆幅半径衰减最多 35%，`|D| − r_now ≤ 0.35×117 ≈ 41 < 58`（落空阈值）⇒ 永远还能落上（只是偏）。
- **但存在另一种 100% 必然失败，这才是手感来源**：旧渲染把整塔绕塔底 `ctx.rotate(towerLean)` 最多 20°，而落点判定/堆叠/投影全用**未旋转**坐标。视觉塔顶偏移 `h·sin(lean)`：10 层 `h=464` 在 `lean=0.19` 偏 **87.6px**、40 层 `lean=0.286` 偏 **469px**（出画布）。玩家对着**看到的**塔顶松手 ⇒ 实际 `|e|>58` ⇒ 落空 ⇒ 经典模式立即「地基失守」终局。
- **全览确实只是平移、没有缩放**：全文件唯一 `ctx.scale` 在 `drawCrate`；40 层 `span=1704` 对 `H=740` ⇒ 地面底边屏幕 y=1744，**越界 1004px，只能看到约 17.5/40 层**；第 15 层起开始越界。

## 2. 修复设计

### 2.1 所见即所判（物理一致性）

- **站立中的塔不再整体旋转**：`render` 里删掉绕塔底的 `ctx.rotate(towerLean)`。塔身始终轴对齐，视觉位置 == 判定位置；`collapse` 倒塌动画仍逐箱真实旋转（保留观赏性）。
- **倾斜反馈改为诚实表达**：
  - 地基处常显「支撑面 + 重心投影」：重心圆点越过青色支撑线段即变红；
  - 塔顶在 `stress = max(|comOffset|/STABILITY_LIMIT, |towerLean|/LEAN_LIMIT) > 0.62` 时出现虚线描边与「塔身不稳 / ⚠ 塔身将倾」；
  - 底部倾斜条与挑战 HUD 数值保留。
- **完美吸附与力矩一致**：`comMoment` 改用**吸附后**的真实偏移（`settledE`），而不是吸附前的 `e`。旧实现完美分支把箱子吸附到 `top.x`（几何偏移归零）却仍按吸附前 `e` 累积力矩，能堆出「comOffset=0 但 comMoment 很大、塔永久歪而不倒」的假状态。

### 2.2 摆幅可达性保证（吊臂小车滑移）

- 新增 `JIB_MIN_X=120 / JIB_MAX_X=300`（保证最大摆角下吊钩仍在 420 宽画布内）。
- 经典模式：吊臂小车 `jibTargetX()` **跟随塔顶中心**（真实塔吊靠变幅对位），并用 `jibXCur` 以 ≈0.2s 时间常数平滑滑移，避免整根吊臂瞬移。
  于是塔顶永远处于摆幅中心 ⇒ 摆幅区间必然覆盖塔顶 ⇒ **不可能出现「塔没倒但释放必失败」**。
- 挑战模式：**严格按关卡数据固定吊臂**，读 `content.pendulum.pivotX`（6 关均为 210）。审计确认此前草稿误读 `content.pivotX`（恒 undefined）会导致挑战也滑移，已修正为正确数据路径。
- 落点投影**常显**（此前只在 3 层内或消耗「垂线」时显示）：细虚线 + 落点方块，`会落空！` 红字预警；前 3 层或消耗「垂线预览」时追加精确偏差数值（道具价值保留）。

### 2.3 全览 zoom-to-fit

- 新增 `overviewFit()`：`scale = clamp((H − 2×116) / span, 0.08, 1)`、`centerY = (top + bottom)/2`；`span` 由 `towerExtent()`（地基→塔顶）给出。
- 新增 `viewParams()`：把「1:1 跟随视角（scale=1、centerY=camY+H/2）」与「全览 fit」按 `overviewT` 插值，渲染用统一变换 `translate(W/2·(1−s), H/2 − cy·s); scale(s,s)`；`scale=1` 时与旧 `translate(0, −camY)` 完全等价（零回归）。
- 上下留白 `VIEW_MARGIN_Y=116`：避开顶部 HUD（y=20/44/62）与全览横幅（74–102）。
- 层号 `#N` 改为**屏幕空间**绘制（不随缩放变小），并按 `BOX_H×scale` 自动抽稀（间隔 <16px 时每 N 层标一次，首尾层必标 + 附属性图标）。
- 重心/支撑面标注改用 `worldToScreen()`，缩放后仍贴着地基；吊臂与吊钩随 `overviewT` 淡出，避免与缩小的塔身脱节。
- 结算前 `revealThen` 的 0.9s 拉远现在**真的会缩放**（旧版只淡入横幅，被审计判为「空操作」），并且拉远完成后 `overviewSettled` 保持全塔视图，避免弹层一出现又缩回只看得见塔顶的 1:1；`overviewT` 初值由 1 改为 0，消除开局先缩小再放大的抖动。

### 2.4 顺带修正

- `overviewTargetCam` 移除：`camY` 恒为跟随相机（`top − 430`），不再被全览改写。这消除了审计指出的 D04 风险——全览退出瞬间 `camY` 仍在插值时松手会把箱子生成到塔顶**下方**、穿过塔身被兜底判负。
- 全览横幅在结算拉远态不再显示「再按 3 返回」（此时按钮已禁用）。
- 新增 `#test` 探针：`physicsInfo()`（`pivotX/jibTargetX/reach/topCenter/topReachable/forecast/floors`）与 `viewInfo()`（`scale/centerY/fitScale/span/extent/screen/fitsOnScreen`）。

## 3. 验收（`tools/arcade_tower_test.mjs` 13 → 17 项）

| 新增项 | 断言 |
| --- | --- |
| TP-07 可达性 | 连续 `+18px` 单向偏置逐步落箱：每步 `topReachable===true`、吊臂收敛到 `jibTargetX`（<0.5px）、行程内时精确对上塔顶、**摆幅区间必须覆盖塔顶中心**；挑战模式 `pivotX` 仍固定 210 |
| TP-08 全览 zoom-to-fit | 3 层 `scale>0.9` 且完整入屏；40 层 `scale<0.9`、`fitsOnScreen===true`、`topY≥0 && bottomY≤740`；层数越多缩得越小；退出后回到 `scale≈1` |
| TP-08b 结算保持缩放 | 14 层落空结案：弹层可见时 `scale<0.95` 且整塔完整入屏（旧实现弹层出现即缩回 1:1） |
| TP-09 所见即所判 | 站立塔绘制段不得出现 `rotate(towerLean)`；`setLean(0.3)` 后塔顶逻辑位置不变（<0.01px）；倒塌动画仍保留逐箱旋转；落点预测字段恒存在 |

实测：偏置 `+18px` 时塔顶中心 210→228→246→264、吊臂同步跟位且摆幅区间始终覆盖；40 层 `scale=0.29`、整塔落在屏幕 y 116–624（画布 740）；12 层 `scale=0.81`。

## 4. 兼容与不变量

- 无 localStorage key / Schema 变更；`serialize/restore` 新字段（`jibXCur` 不入档，恢复时按目标收敛）均有缺省值，旧档可续玩。
- 挑战 6 关数据、`A.Challenge` 判定/结算、`chMaxLean`/`chPeakLean`/`noCollapse` 语义不变（6/6 场景 PASS）。
- 其它 15 款游戏、`engine.js`、`arcade.css` 零改动。
- 路径兼容（相对路径）、离线优先（无新增远程资源）不变。

## 5. 已知遗留（本版不修，记录在案）

- 初始摆幅 `rand(0.75,1.05)` 与 `cargoSeed` 取 `Date.now`，同操作序列不可复现（每局难度有随机浮动）。属既有设计选择。
- `releaseWhenAligned` 测试钩子仍是「全知玩家」（直接用逻辑坐标对准），无法覆盖视觉/投影问题；本版用 TP-07/TP-09 从渲染一致性侧补足。
- 落空仍是立即终局；现由常显投影 + 红色「会落空！」预警缓解，不改结算规则。
- 真机触控手感 UNVERIFIED。

## 6. 回滚

单独 revert 本版提交即可；无数据 Schema 变更，SW 缓存键随版本更新（`studiokit-arcade-0.12.1-v1`）使旧缓存自动失效。
