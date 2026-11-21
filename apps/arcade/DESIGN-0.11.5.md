# Arcade 0.11.5 设计：移动端双击放大防护 + 五子棋落子按钮重影 / 预览取消出口

基线：0.11.4（2026-11-21 已双端发布）。本版未发布（本地提交）。

## 1. 背景与问题

Owner 试玩反馈三点：

1. 所有游戏页在手机上会被**双击误触放大**。
2. **五子棋全屏时落子按钮文字有重影**。
3. **单击棋盘进入预览后，没有悔棋/取消的操作出口**（Owner 确认为「预览时无法取消」）。

## 2. 事实核查与根因

1. **双击放大**：17 个页面（中心页 + 16 游戏）的 viewport meta 均为 `width=device-width, initial-scale=1`，未声明 `maximum-scale=1/user-scalable=no`；`arcade.css` 的 `body { touch-action: manipulation }` 还显式允许双击缩放。真机浏览器双击会把游戏画面放大，影响操作。
2. **落子重影**：五子棋「落子」按钮被画了两遍 —— 画布 `drawPlaceButton()` 用 18px 粗体画一份，DOM 覆盖按钮 `placeButton.textContent='落子'` 又用 15px 画一份。二者字号/位置不同，全屏缩放后 DOM 按钮与画布按钮产生像素级错位，文字看起来重影。
3. **预览无出口**：`tapAt()` 首次点空格进入 `preview`，只能再次点同一点或点「落子」确认；既没有取消按钮，点其它地方也没有明确的退出语义。

## 3. 设计

### 3.1 全站双击放大防护

- 17 页 viewport meta 统一改为 `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no`，从浏览器视口层禁止双击放大/捏合放大。
- 保持 `viewport-fit=cover` / `apple-mobile-web-app-status-bar-style` 不回归（0.11.3/0.11.4 顶缘模糊修复约束）。
- `arcade.css` 给 `html` 补 `touch-action: manipulation` 兜底（touch-action 不继承，显式声明覆盖非交互区），与 body 既有值一致，不引入 `pan-y`/`none`，不破坏页面纵向滚动与可访问性手势。
- `engine.js` 的 `installSfxUnlock()`（16 款游戏页均调用）追加全局 `dblclick` 默认行为拦截（`e.preventDefault()`，不 stopPropagation），避免双击选中/缩放合成事件扰乱 UI；各游戏自绑定的单击/双击逻辑不受影响。
- 中心页不调用 `installSfxUnlock()`，但 viewport meta 已覆盖；中心页无游戏输入，双击放大防护同样生效。

### 3.2 落子按钮重影根除

- DOM 覆盖层由「一枚有文字/边框/底色的按钮」改为「两枚**透明命中层**」（`data-cancel-preview` / `data-place-confirm`）：`background:transparent; border:0; color:transparent; textContent=''`，只承担 ≥44px 命中职责。
- 画布 `drawActionButton()` 成为按钮外观与文字的**唯一来源**：预览中左「取消」右「落子」，非预览时单个「先预览再落子」。全屏下只有画布一份文字，重影消失。
- 命中层与画布按钮使用同一组逻辑矩形常量（`CANCEL_BTN` / `PLACE_RECT`），缩放同步一致，不会错位。

### 3.3 预览取消出口

- 预览中新增「取消」按钮（画布 + 透明命中层）：`cancelPreview()` 只清 `preview`、播 UI 音效、存档并同步 UI，不动棋盘/回合/步数/悔棋栈。
- 提示文案同步：游戏页 hint、开始弹层、画布状态引导与页脚均说明「点「落子」确认 / 「取消」退出预览」。
- 原有落下确认路径不变：再次点同一点或点「落子」按钮仍正常落子；工具「悔棋 / 提示」不变。

## 4. 兼容与不变量

- 不改任何 localStorage key / Schema（progress/runs/prefs/playtime/challenge/scores 全部不变）；存档格式与旧档恢复不变（`preview` 字段语义不变）。
- 不改 AI、计分、挑战判定与离线策略；16 款游戏 except 五子棋的玩法零改动（仅共享 CSS 兜底与 dblclick 拦截）。
- 路径兼容：所有改动均为相对路径，兼容 GitHub Pages 子路径与 Cloudflare Pages 根路径。
- 五子棋 `#test` 增加 `cancelPreview()` / `actionButtons()` 钩子；`selftest()` 新增第 18 条（预览取消与落子确认互不干扰），原第 17 条改为校验两枚透明命中层。

## 5. 验收条件

1. 17 页 viewport 含 `maximum-scale=1/user-scalable=no`，无 `viewport-fit` 回归；游戏页 `dblclick` 默认行为被引擎拦截。
2. 五子棋全屏下「落子 / 取消」文字只有画布一份，无重影；DOM 命中层无文字、透明、≥44px。
3. 点「取消」只清预览；点「落子」仍正常落子；selftest 18/18。
4. 320/375/390/430 + 全屏 0 溢出、两按钮不重叠、命中区 ≥44px。
5. 全量门禁：`validate_site` / `build_site` / `node --check` / `arcade_interaction_test`（新增）/ smoke / zen / calm / review / gameplay base 全过。
6. 版本链 0.11.5：engine / sw / registry / hub / validate / 测试 / README / CHANGELOG / 设计文档 / 任务队列同步；SW 缓存键 `studiokit-arcade-0.11.5-v1`。

## 6. 回滚

单独 revert 提交即可；无数据 Schema 变更，缓存键随版本更新使旧缓存自动失效。
