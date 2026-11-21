# Arcade 0.12.2 设计：集装箱释放水平速度（抛物线落点）

基线：0.12.1（2026-11-22 已双端发布）。本版只改层塔（`apps/arcade/games/pendulum-tower.html`）与门禁/文档，不动其它 15 款游戏、`engine.js`、localStorage key/Schema、挑战关卡数据。

## 1. 背景

Owner 反馈：「包括箱子释放后好像都没有合理的水平速度，这个补上会不会更好些？」

事实核查：`releaseBox()` 生成的 `drop` 只有 `{x, y, vy}`，**没有 `vx`**；`update()` 里只积分 `vy`，`drop.x` 全程不变。所以无论钟摆摆得多快，集装箱都是「原地垂直落下」——与真实吊装完全不符（真实吊钩释放时物体继承切向速度）。

## 2. 可行性分析（先算再改）

真实单摆切向速度 `dx/dt = L·cosθ·θ̇`。若 100% 继承，横移量 `drift = vx × t_fall` 会远超箱宽，导致无法对齐。因此引入吊具阻尼传递系数 `k`，并对 `k ∈ {0, 0.15, 0.25, 0.35, 0.5, 0.75, 1.0}` × `g ∈ {680, 1020, 1360, 1700}` 做扫描（A=0.95，塔顶屏幕 y=430）：

| k | 可完美对齐（±9.6px） | 完美窗口 | 可落上窗口 | 需要的提前量 θ* |
| --- | --- | --- | --- | --- |
| 0（旧） | 是 | 43–69ms | 281–445ms | θ=0（摆到正中） |
| **0.45** | **是** | **约 63–115ms** | **378–703ms** | θ≈0.47–0.62 |
| 1.0 | 是 | 47–91ms | 270–538ms | θ≈0.69–0.80 |

结论：**加入水平速度不会降低可解性，反而让「完美窗口」更宽**（因为提前量与偏移互补），只是把技能从「等摆到正中」变成「提前一点、看着预测落点放手」。因此取 `k = 0.45`、`|vx| ≤ 240px/s`。

## 3. 实现

- `RELEASE_VX_K = 0.45`、`RELEASE_VX_MAX = 240`、`DROP_VY0 = 60`。
- `pendulumBoxVx(angle, vel) = clamp(cosθ · θ̇ · L · k)`（纯函数，挑战模式用 `pend.length` 自适应）。
- `releaseBox()` 写入 `drop.vx`；`update()` 两处落体分支加 `drop.x += drop.vx * dt`（自由落体水平方向无加速度）。
- **预测同步**：新增 `dropFallTime(releaseScreenY)`（按 `DROP_VY0 + ½gt²` 反解到塔顶的时间），`landingForecast(centerX, vx, releaseScreenY)` 返回 `landingX = 释放点 + vx·t`、`drift`、`offset`、`overlap`。预测与真实落点共用同一组常量。
- **画布反馈**：落点预测从「垂直虚线」升级为**按真实落体参数采样的抛物线**（10 段），并画出释放点虚影 + 预计落点方框；文案追加「横移 ±N px」；三态（会落空红 / 可落偏黄 / 完美绿）保留。
- **挑战钩子** `releaseWhenAligned()` 改用「预测落点」与目标比较，而不是松手瞬间的位置。
- `serialize/restore` 增加 `drop.vx`（旧档缺省 `0`，仍是垂直下落，行为向后兼容）。
- `#test` 增加 `releaseVx / releaseVxK / fallTime / lastRelease{predicted,drift,fallTime}` 探针。

## 4. 验收（`tools/arcade_tower_test.mjs` 17 → 18 项）

| 新增项 | 断言 |
| --- | --- |
| TP-10 释放水平速度 | 整段摆幅中 `|releaseVx|` 峰值 > 50px/s；同段内仍存在 `|预测偏移| ≤ 9.6px` 的完美相位（可解性）；`lastRelease.drift` 绝对值 > 10px（确认真实横移）；`lastRelease.predicted` 与真实落定塔顶中心误差 ≤ 3px |

实测：vx 峰值 111–134px/s、最优可达偏移 2.7–4.1px、预测误差 ≤ 0.6px（多数样本 0–1px）、单次落箱横移 40–45px。挑战 6 关 `tools/arcade_gameplay_test.mjs --suite=challenge --game=pendulum-tower` 仍 6/6。

## 5. 兼容与不变量

- 无 localStorage key / Schema 变更：`serialize` 只多一个可选数值字段 `drop.vx`，`restore` 缺省 0。
- 挑战关卡数据、`maxLean`/容差/目标偏置语义不变（6/6 场景通过）。
- 其它 15 款游戏、`engine.js`、`arcade.css` 零改动。
- 落空仍是立即终局；现由抛物线预测 + 红色「会落空！」三重提示缓解。

## 6. 遗留

- `k = 0.45` 是「可见抛物线 vs 手感」的取舍值，真机手感仍 UNVERIFIED；如需更强/更弱的抛手感，调 `RELEASE_VX_K` 单个常量即可（扫描表已给出 0.15–1.0 的可行性）。
- 完美窗口随 `swingGravity` 递增（层数越高）从 ~115ms 收窄到 ~63ms，属既有难度曲线的一部分。

## 7. 回滚

单独 revert 本版提交即可；无数据迁移。
