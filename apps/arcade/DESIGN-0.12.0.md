# Arcade 0.12.0 设计：全屏拇指区抬升 + 层塔物理/全览/工地集装箱改造

基线：0.11.5（本地提交，未发布）。本版是把 Owner 一轮四条反馈一并落地的功能版本；发布后即为当前最新发布版。

## 1. 背景与问题

Owner 反馈：
1. 全屏/PWA 模式下底部道具按钮太靠下，单手拇指不好够；
2. 层塔物理模型有 bug —— 「一直偏置堆叠也不会塌」；
3. 层塔希望有从地基到最高层的全览（游戏中可切换 + 结束时动画缩放展示）；
4. 层塔换更像真实工地的皮肤（塔吊/集装箱），并加箱子属性增加乐趣。

## 2. 事实核查与根因

1. **底部按钮**：全屏（immersive）下 `.touch-pad` 只有 `padding-bottom: max(6px, safe-area)`，按钮贴视口底边（无安全区时 gap≈6px）。
2. **层塔不塌**：`towerLean` 是 `leanAcc = -6.2*lean - 0.9*vel` 的阻尼弹簧，平衡点恒为 0；`settleDrop` 的偏落只是瞬时 `leanVel += e*0.01*...` 冲量，盒子 `x` 从不位移，渲染只对整塔 `ctx.rotate(towerLean)`。因此偏置堆叠没有持久重心累积，塔永不倒。
3. 全览/皮肤/属性此前不存在。

## 3. 设计

### 3.1 全屏拇指区抬升（arcade.css）

- `body.arcade-immersive` 新增 `--ac-thumb-lift: 36px`（横屏短视口 `max-height:560px` 降到 20px）。
- 画布外道具行 `.touch-pad`：padding-bottom 叠加 lift，按钮行整体上移；舞台不缩小，最大化画布（负 margin 方案会覆盖按钮命中层，已排除）。
- 矿工 `.has-subhud` 画布内道具坞：`stage-wrap` padding-bottom 叠加 lift，画布/道具坞同步上移；其 `measureItemFloor()` 自动重算地面。
- `.ac-toast` bottom 抬升 `100px + 2*lift + 2*safe-area`，避免压住上移后的道具坞。
- 安全区 `env(safe-area-inset-bottom)` 完整保留并叠加。实测（影跃）：四档按钮距底 6→42px（+36），安全区 34→70px；横屏 6→26px。

### 3.2 层塔持久重心模型（pendulum-tower.html）

- 每箱按其重量与高度增益把「相对塔顶水平偏心 × 重量 × (1+层数×0.06)」累加进持久 `comMoment`；并由全部箱子的加权箱心算出 `comOffset`。
- 弹簧平衡点改为 `comGain*comOffset + comMoment*增益`，不再回归 0；新增「重心投影超出支撑半宽 0.62×BOX_W 且塔体明显倾斜」倒塌判定，保留 LEAN_LIMIT=0.35。
- 配重道具现在还会把 `comMoment×0.75`，真实减重心。
- 挑战模式用独立低增益 `comGain=0.0016`、箱重统一 1，仍按关卡 `chMaxLean` 判定；目标/容差与 C05/C06 门槛语义不变（6/6 场景 PASS）。
- 效果：连续右偏 18px 第 4 层倒塌；左右交替 ±18px 14 层稳定（COM≈7px < 支撑半宽 19.84px）。

### 3.3 全览 Overview

- 第三枚 44px 按钮「🗺 全览」+ 快捷键 3（不与 1 垂线 / 2 配重冲突），三列等宽 touch-pad。
- `overviewT` 0→1 约 0.45s 缩放动画（reduce-motion 下静态瞬切）；相机取地基到塔顶完整范围，每箱画层号与属性图标，显示「重心 ±N.Npx / 支撑面」标尺。
- 全览期间 `input` 与 `releaseBox` 禁止落箱；再次按 3 / 点按钮返回。
- 结算前 `revealThen` 做 0.9s 动画式拉远（collapse 收尾实测 853ms 到结算弹层）；结算弹层仍为 `result:'回看塔身'`（3 处标记保留，回看切换不受影响）。

### 3.4 工地皮肤 + 箱子属性

- 黄昏工地：暖灰天空/城市剪影/远处塔吊；黄黑塔吊桁架吊臂+配重臂+吊具横梁随钟摆摇摆；集装箱竖波纹板/上下横梁/四角角件/编号/属性色带+emoji。
- 属性 4 种（确定性 LCG 伪随机，`cargoSeed` 存取档）：📦标准 weight1；⚓重型 weight1.65（放大重心与冲量，同偏移 COM 3.08→4.51）；🍷易碎 weight0.8（完美稳放一次性 +20）；💎奖励 weight1（直接 +25 分）。当前/下一箱属性画布可读提示。
- 属性真实影响物理或计分，不是贴图。

## 4. 兼容与不变量

- 不改任何 localStorage key / Schema 版本；层塔 `serialize/restore` 新字段均有缺省值，旧档可续玩。
- 16 款游戏玩法/AI/计分、挑战关卡数据、`A.Challenge` 判定/结算字段、结算回看语义不变；五子棋 0.11.5 修复保留。
- 路径兼容：相对路径，兼容 GitHub Pages 子路径与 Cloudflare Pages 根路径。
- 320/375/390/430 + 全屏横屏 0 溢出，按钮 ≥44px。

## 5. 验收与门禁

- 新增/更新门禁：`arcade_immersive_buttons_test` 16/16、`arcade_tower_test` 13/13、`arcade_interaction_test` 5/5、smoke 94/94、zen 14/14、calm 17/17（pendulum-tower regression 26 条）、review 5/5、gameplay base 11/11、gameplay tower challenge 6/6、pwa 7/7、validate/build/inline/node --check 全过。
- 版本链 0.12.0：engine / sw / registry / hub / validate / 测试 / README / CHANGELOG / 设计文档 / 任务队列同步；SW 缓存键 `studiokit-arcade-0.12.0-v1`。
- 真机触控/手感 UNVERIFIED（按惯例待 Owner 实机确认）。

## 6. 回滚

单独 revert 提交即可；无数据 Schema 变更，缓存键随版本更新使旧缓存自动失效。
