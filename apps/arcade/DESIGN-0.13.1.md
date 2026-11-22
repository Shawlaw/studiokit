# Arcade 0.13.1 设计：星海突击反馈修复（道具栏 / 核弹动画 / 机动强化 / 游玩统计）

> 0.13.0 发布后 Owner 真机反馈 4 个问题：①游戏时间统计不对；②iPhone 非全屏 PWA 时大杀器道具栏看不到；
> ③核弹缺「发射 → 追踪 → 命中爆炸」动画（无 Boss 时应飞向画面中央）；④「移动速度」对触屏拖拽无意义。
> 本轮只动经典模式与页面布局，**挑战 6 关数据/判定零改动**；无 localStorage key / Schema 变更。

## 1. 道具栏：并入主道具行，不再依赖第二行

**问题**：0.13.0 把大杀器放在 `.game-tools` 的第二行，并在有道具时才显示；iPhone 独立窗口（非全屏）的
CSS 用更高优先级的 standalone 规则覆盖了 `stage-box` 高度预算，第二行落到视口外，看起来「没有道具栏」。

**方案**：把 4 个大杀器槽并进同一个 `[data-game-tools]` 网格（3 个主动道具 + 最多 3 个军械槽），
默认 `repeat(5, 1fr)`，`bay` 升满变 6 列；空槽位常显「▢ 军械」，玩家随时知道栏位存在。
删除 `[data-item-slots]` 容器与 `has-star-items` 的 stage 高度规则，不再新增页面高度，也就不再受
standalone/PWA 的 stage 高度规则影响。挑战模式隐藏军械槽，网格回落 2 列（脉冲/星盾）。

## 2. 核弹：发射追踪弹，命中后才爆炸

- 使用核弹时不再瞬间清屏，而是在玩家机头生成一枚追踪弹（`run.nukeShots`）。
- 有 Boss：目标实时跟随 Boss 中心（Boss 移动也能追上）；无 Boss：目标为画面中央 `(W/2, H*0.42)`。
- 飞行：速度 460 → 980 px/s 渐进加速 + 转向插值，带推进尾焰粒子；目标处绘制脉冲锁定准星。
- 命中（距离 < 16px 或飞行 1.8s）：清空敌弹、普通敌机 80 伤害、Boss `max(120, min(260, 25% maxHp))`，
  全屏白闪 + 强震屏 + 双层冲击波 + 碎片；无 Boss 时在画面中央同样播放完整爆炸。
- 追踪弹随局内档保存（`run.nukeShots`），刷新后继续飞；新开一局/清关/受击不丢已消耗槽位。

## 3. 机动强化：替换「移动速度」

**问题**：触屏是 1:1 拖拽，速度属性只影响键盘，触屏玩家升级后零收益。
**方案**：保留 `engine` id（兼容已有存档等级），效果改为触屏/键盘都生效：

| 等级 | 受击无敌 | 拾取吸附 |
| --- | --- | --- |
| 0 | 1.80s | ×1.00 |
| 每级 | +0.12s | +6% |
| 5 | 2.40s | ×1.30 |

键盘基础移速固定 320（不再随改装变化）。HUD/机库文案改为「机动强化」；`hangarInfo().caps` 增加
`invulSeconds` / `magnetMultiplier` 便于门禁断言。

## 4. 游玩时长：机库浏览不计入

0.13.0 的机库面板通过 `ui.hide()` 收起 overlay，而 `Playtime` 以 overlay 是否打开作为「是否在游玩」，
导致浏览机库的时间被计入有效游玩。0.13.1 在打开机库后显式调用
`A.Playtime.setOverlayVisible(true)` 暂停计时（会先把已游玩片段落盘），关闭机库回到开始弹层后
由 `ui.show()` 恢复「非游玩」状态，开始游戏后正常计时。

## 5. 兼容与回滚

- 无新增 key / Schema；`engine` 改装 id、等级与成本不变，只改效果语义（已在 README/CHANGELOG 说明）。
- 局内档新增 `run.nukeShots`（最多 3 枚），旧档缺失时为空数组；挑战分支仍 `run: null`。
- 回滚：还原 `star-raid.html` + `engine.js` 版本链即可；机库数据与星币不受影响。

## 6. 验收

1. 静态：`validate_site.py` / `build_site.py` / `check_inline_scripts.mjs` / `arcade_design_check.py` / `node --check engine.js+sw.js` 全过。
2. `arcade_smoke.mjs` **105/105**：核弹追踪飞行中不掉血、命中后清弹并伤害 Boss、无 Boss 中央引爆、
   320px 主道具行 5 列 + standalone 模拟在视口内、机库浏览 Playtime 增量 <120ms。
3. `arcade_tower_test` **23/23**、star-raid 挑战 **7/7** / tower 挑战 **6/6**、gameplay base **11/11**、zen **17/17**、calm **7/7**、review **5/5**、pwa **7/7**、interaction **5/5**、immersive **32/32**、stage coverage 78 关正常。
4. 320/375/390/430 布局 + iPhone standalone 模拟探针 **43/43**：无溢出、按钮 ≥44px。
5. 真机复测（iPhone PWA 非全屏可见道具栏、核弹动画、游玩时长）由 Owner 完成。
