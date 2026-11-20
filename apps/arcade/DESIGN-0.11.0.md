# Arcade 0.11.0 设计：结算可回看最终画面 + 五子棋棋盘放大

发布状态：本地实现（未推送 / 未发布）。基线：0.10.0（2026-11-20 双端发布）。

## 1. 背景与问题

Owner 反馈：五子棋输了之后结算蒙层直接盖住棋盘，玩家看不到输在哪；要求所有游戏结束后玩家能回顾最终游戏画面。另要求五子棋棋盘再大一点。

事实核查（0.10.0）：

- 16 款游戏共用 `apps/arcade/arcade.css` 的 `.overlay`：`position:absolute; inset:0; background:rgba(7,11,24,0.72); backdrop-filter:blur(2px)`，覆盖整个画布，结算面板居中。
- 16 款游戏共 41 处结算 `ui.show()`（详见 `TASKS.md` 证据）；开局/暂停/错误弹层不属于结算。
- `createLoop.frame()` 在 `loop.pause()` 后仍每 ~200ms 重绘一次；游戏结束时最终帧仍在画布上，只是被暗色蒙层遮住。**渲染层无需改动，改覆盖层即可。**

## 2. 目标与非目标

目标：

1. 结算后默认仍能看清整块棋盘/最终游戏画面（不被暗色遮罩覆盖）。
2. 结算卡片不挡住核心游戏区域；玩家可一键隐藏/恢复卡片，只看最终画面。
3. 保留原有「再来一局 / 下一关 / 返回选关」等按钮与键盘/触屏可用性；开局、暂停、错误弹层外观与行为完全不变。
4. 玩法、分数、挑战判定、localStorage key/Schema、离线缓存策略、路径兼容均不变。
5. 五子棋棋盘适度放大。

非目标：重画游戏、改变结算数值、新增远程依赖、改分享/积分/挑战数据格式。

## 3. 设计

### 3.1 共享结算样式（arcade.css）

新增 `.overlay.is-result`（由引擎按需加在 `.overlay` 上）：

- 只作用于结算弹层：去掉全屏暗色 `background` 与 `backdrop-filter`，改为透明（画布完整可见）。
- 结算面板 `align-self:flex-end; margin-bottom:10px; max-height:42%; padding 缩小`，背景为高不透明度深色卡片，保证文字可读。
- 面板内提供「回看棋盘」按钮（`data-ov-review`，由引擎动态创建），文案在「回看棋盘 / 查看结算」间切换：
  - 点击「回看棋盘」→ 给 overlay 加 `.review-hidden`，面板隐藏，只保留右上角一个 44px「查看结算」胶囊按钮。
  - 点击胶囊或面板内「查看结算」→ 恢复面板。
- 回看模式下画布区域不接收游戏输入（游戏已 `state='over'`），点击画布不会改变结果或记录。
- 320/375/390/430、沉浸全屏、横屏均须保证：胶囊 ≥44×44px、结算面板不越界、不产生页面溢出。

### 3.2 共享引擎（engine.js）

`createOverlayUiBase(dom)` 的 `show(opts)` 支持可选 `opts.result`（布尔，默认 false）：

- `dom.overlay.classList.toggle('is-result', !!opts.result)`；非结算弹层恢复原样。
- 首次遇到结算弹层时，引擎在 `.overlay` 内动态创建回看胶囊与按钮（若 dom 未自带）：
  - `<button class="ac-review-fab" data-ov-review-fab hidden>回看棋盘</button>`（显示于右上角）。
  - 在面板内 `<button class="ac-btn ac-btn-review" data-ov-review>回看棋盘</button>`（插在主按钮前）。
  - 两个按钮都走 `Sfx.play('ui')`。
- 状态变量 `reviewHidden=false`；`hide()` 与下一次 `show()` 重置为面板可见；切换时同步胶囊的 `hidden`、面板的 `.review-hidden`、aria-pressed、按钮文案。
- 不新增 dom 契约：不改任何 HTML 模板；不传 `result` 时完全保持旧行为。
- `opts.result` 不影响 Playtime（结算仍暂停计时）。

### 3.3 各游戏结算标记

把 41 处结算 `ui.show()`（含 4 个 wrapper：`showOverlay()` in block-drop / brick-breaker / gravity-flip / road-rush）补上 `result: true`。wrapper 场景按其参数约定增加 result 参数或调用点直传，避免改变开局/暂停弹层。

### 3.4 五子棋棋盘放大

逻辑画布保持 420×740，棋盘由 `{x:18,y:178,w:384,h:384}` 放大到 `{x:10,y:174,w:400,h:400}`，格距 `GRID` 由 34 增至 36，`GRID_X=42`、`GRID_Y=196`，使 11 路格点（跨度 360）仍处于棋盘内并留出坐标标签空间；棋子半径 14→15。状态栏（y≤146）、落子按钮（y=590）、页脚（y=674）位置不变，避免挤占。交互 `cellAt()` 用常量计算，随之上新；存档只存棋盘数组，不受几何变化影响。`#test` 钩子增加棋盘几何信息，供门禁断言。

## 4. 验收条件

1. 结算后：`.overlay.is-result` 无暗色遮罩；画布棋盘像素可见；结算卡片在底部且 ≤42% 高度；主/次/第三按钮可点。
2. 「回看棋盘」→ `.review-hidden` 生效，面板不可见，胶囊可见；再点胶囊恢复；焦点不丢失。
3. 开局/暂停/错误/续玩弹层不携带 `is-result`，外观与 0.10.0 一致；按钮行为、暂停/续玩、存档、积分记录零回归。
4. 五子棋：棋盘区域 400×400（+4.2% 边长 / +8.5% 面积）、格距 36（+5.9%）；320/375/390/430 布局无溢出，触控目标 ≥44px；旧局内存档仍可恢复。
5. 全量门禁：validate/build/node --check/inline/smoke 94+/zen 14/calm 17/gameplay base 22 全过；新增结算回看专项测试覆盖至少 16 款代表弹层（含挑战结算）。
6. 版本链 0.11.0：engine/sw/registry/index/validate/smoke/calm/zen/README/CHANGELOG/设计文档与任务队列同步；SW 缓存键 `studiokit-arcade-0.11.0-v1`。
7. 发布（本轮 Owner 明确授权）：推送 main 后 Actions 四 job 全绿，verify_deploy 双端逐文件一致，线上无头浏览器验证。

## 5. 回滚

单独 revert 提交即可；不改动算法与数据 Schema，缓存键随版本更新使旧缓存自动失效。
