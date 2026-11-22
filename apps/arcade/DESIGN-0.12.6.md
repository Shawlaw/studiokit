# Arcade 0.12.6 设计：PWA 独立窗口底部按钮适配（与全屏一致）

基线：0.12.5（2026-11-22 已双端发布）。本版只改 `apps/arcade/arcade.css` 与门禁/文档，不改任何游戏逻辑。

## 1. Owner 反馈

> 「PWA 时的按钮会比全屏时按钮更靠下，是不是适配得不够好？」

## 2. 实测根因

在真实运行时量了「按钮底边到视口底的距离」（390×844，mobile 仿真，独立窗口用 `display-mode: standalone` 匹配 + site-shell 注入 `html.studiokit-shell-standalone`）：

| 游戏 | 浏览器 | PWA 独立窗口 | 全屏沉浸 |
| --- | --- | --- | --- |
| shadow-leap 按钮距底 | 60px | **60px** | **42px** |
| shadow-leap 画布高 | 590px | 590px | 687px |
| gold-miner（画布内道具坞） | 105px | 105px | 76px |

两个原因：

1. **拇指抬升只给了沉浸模式**：`--ac-thumb-lift: 36px` 定义在 `body.arcade-immersive` 上，`body.arcade-immersive .touch-pad` 才把 `padding-bottom` 加成 `max(6px, safe) + lift`。独立窗口没有这个类，按钮行只有页面默认留白。
2. **`.game-hint` 说明行占着画布下方**：非沉浸模式渲染一行操作说明（内容与顶栏/按钮自带文案重复），按钮行被推到它上方，同时压掉画布高度 ≈97px。

结果：独立窗口既没有抬升，又把高度浪费在重复说明上 —— 与全屏观感明显不一致。

## 3. 修复（纯 CSS，16 款游戏统一生效）

```css
html.studiokit-shell-standalone body.arcade-body:not(.arcade-immersive) { --ac-thumb-lift: 36px; }

@media (min-height: 561px) {
  /* 与全屏同一套抬升 */
  html.studiokit-shell-standalone body.arcade-body:not(.arcade-immersive) .touch-pad { padding-bottom: calc(max(6px, env(safe-area-inset-bottom)) + var(--ac-thumb-lift)); }
  /* 收起与顶栏重复的说明行 */
  html.studiokit-shell-standalone body.arcade-body:not(.arcade-immersive) .game-hint { display: none; }
  /* 说明行收起后残留的 14px 底部留白也去掉，按钮距底 = 42px（与全屏同值） */
  html.studiokit-shell-standalone body.arcade-body:not(.arcade-immersive) .game-page { padding-bottom: 0; }
  /* 把省下的 34px 还给画布（各 body 变体的既有高度预算 - 34px） */
  … .has-game-tools / .has-joy-row / .has-joy-row.has-extra-controls / .has-subhud .stage-box { height: min(calc(100dvh - shellbar - (214/226/246/188 - 34)px - safe), 画布比例上限); }
}
```

要点：

- **限定 `(min-height: 561px)`**：横屏短视口（667×375 等）本就采用「允许纵向滚动找道具行」的既有策略，不动它，避免回归（实测横屏各项指标与 0.12.5 完全一致）。
- **不使用负 margin**：抬升只靠按钮行 padding，不动画布命中层（0.11.5 的血泪教训）。
- 安全区仍然叠加：有 `env(safe-area-inset-bottom)` 时按钮距底 = 安全区 + 36px。

## 4. 验收数据（本地 CDP）

| 视口 | 场景 | PWA 按钮距底 | 全屏按钮距底 | 画布（PWA） | 纵向溢出 |
| --- | --- | --- | --- | --- | --- |
| 320×568 | 无安全区 | 42 | 42 | 348（旧 314） | 0 |
| 375×667 | 无安全区 | 42 | 42 | 447（旧 413） | 0 |
| 390×844 | 无安全区 | 42 | 42 | 624（旧 590） | 0 |
| 430×932 | 无安全区 | 42 | 42 | 712（旧 676） | 0 |
| 320×568 | 安全区 34 | 70 | 70 | 267 | 0 |
| 375×667 | 安全区 34 | 70 | 70 | 366 | 0 |
| 390×844 | 安全区 34 | 70 | 70 | 543 | 0 |
| 430×932 | 安全区 34 | 70 | 70 | 631 | 0 |
| 667×375 | 横屏（不处理） | 与 0.12.5 逐项一致（0/41 等） | — | 215 | 允许滚动（既有设计） |

- 按钮位置：**PWA 与全屏完全同值**（无安全区 42px、有安全区 70px）。
- 画布：独立窗口平均增大 **34px**（390×844：590 → 624），因为收起了重复说明行。
- 横向溢出 0、按钮边长 ≥44px、命中层可点。

## 5. 门禁

`tools/arcade_immersive_buttons_test.mjs` 16 → **32** 项，新增 IB-06：

- 4 档竖屏 × {无安全区, 安全区 34} × {shadow-leap, pendulum-tower} = 16 组；
- 每组断言：识别为独立窗口、`hint` 已收起、按钮 ≥44px 且完整可见可点、横向/纵向 0 溢出、
  **PWA 与同页全屏的按钮距底之差 ≤2px**、按钮距底 ≥38px（有安全区时 ≥66px）。

## 6. 兼容与不变量

- 无 localStorage key / Schema / 挑战关卡数据变更；无 JS 改动。
- 浏览器（非独立窗口）表现完全不变（`html.studiokit-shell-standalone` 不成立）。
- 沉浸模式表现完全不变（新规则都带 `:not(.arcade-immersive)`）。

## 7. 遗留

- 真机（iOS/Android 安装后）观感 UNVERIFIED：仿真无法复现 iOS 独立窗口的真实视口与手势区几何；若真机仍偏差，`--ac-thumb-lift` 与 stage-box 预算常数是仅有的两个调节点。
- 横屏独立窗口仍沿用「允许滚动」，未做专门优化。

## 8. 回滚

单独 revert 本版提交即可。
