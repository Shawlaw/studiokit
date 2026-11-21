# Arcade 0.11.3 设计：iPhone 安装版顶部系统模糊真机修复

## 背景 / Owner 复测

0.11.2 修复了 PWA 更新检测（生效，真机已显示 v0.11.2），但 Owner 真机复测反馈顶部**仍然被模糊一部分**，中心页与游戏页都有。0.11.2 用 CSS 深色背景 + 安全区色条去盖，在真机无效。

## 真正的根因（0.11.2 判断错误的修正）

iOS 26+ 的独立模式（home screen PWA）存在**系统级顶缘模糊**：当页面声明 `viewport-fit=cover` 与 `apple-mobile-web-app-status-bar-style=black-translucent` 时，页面被绘制到状态栏下方，系统在视口顶边叠加一层渐进模糊/淡出（「Liquid Glass」效果），把该区域内的顶栏文字冲淡。关键点：

- 这是**系统叠加在整个视口顶边缘之上**的效果，普通 CSS 背景 / z-index 盖不住 —— 这就是 0.11.2 真机无效的原因。Chrome 无头浏览器不会重现这个系统级合成，所以 0.11.2 的模拟测试「通过」但没有真实意义。
- WebKit 对顶边模糊的处理规则：若有一个 `position: fixed/sticky` 的**不透明元素贴住视口顶边**，iOS 会用该元素的纯色替换模糊（社区已在 Odoo / meshmonitor / clj-ui-framework 等多处验证）。0.11.2 的 `::before` 高度取 `env(safe-area-inset-top)`，但在 `black-translucent` 下该值在某些 iOS 版本返回 0，导致色条没有实际覆盖，未能触发替换。

参考（外部资料，仅作根因佐证）：[clj-ui-framework commit](https://gitea.florianschroedl.com/floscr/clj-ui-framework/commit/4637c9f3677580b2edeb533cb21e41103160fce4)、[okou-ai/okou PR](https://github.com/okou-ai/okou/pull/36386)、[meshmonitor PR](https://github.com/Yeraze/meshmonitor/pull/5309)、[Odoo PR](https://github.com/odoo/odoo/pull/298583)。

## 目标与非目标

**目标**：真机 iOS 安装版顶部不再发虚；保留 0.11.2 已生效的 PWA 更新检测；不回退其他平台布局。

**非目标**：不改玩法、localStorage key/Schema、积分/挑战数据；不改 Badge Studio / Venue Compare。

## 实现（双保险）

1. **移除触发条件（根本）**：全部 17 个 Arcade HTML 页去掉 `viewport-fit=cover`；中心页去掉 `apple-mobile-web-app-status-bar-style=black-translucent`。页面不再画到状态栏下方，iOS 用默认不透明状态栏（配合 `theme-color=#0b1020` 为纯深色），系统顶缘模糊不再覆盖内容。
2. **fixed 顶边纯色条（兜底）**：`html.studiokit-shell-standalone body.arcade-body::before` 为 `position: fixed; top: 0; height: max(1px, env(safe-area-inset-top, 0px))` 的不透明深色条，z-index 高于内容。即使旧主屏图标缓存了半透明 chrome，贴住顶边的元素也会让 WebKit 用纯色替换残留模糊。仅在 standalone 生效，普通标签页无影响。
3. **保留 0.11.2 有益的样式**：深色不透明 shellbar、游戏顶栏 `position: relative; z-index: 5`、舞台 `isolation: isolate`、`-webkit-backdrop-filter` 前缀 —— 它们对其他平台与结算弹层外观无害。

## 兼容性 / 数据

- 不改任何 localStorage key 与 Schema；不改玩法、存档、积分、挑战数据。
- 去掉 `viewport-fit=cover` 后，iOS 独立模式由系统保留状态栏与底部 Home Indicator 区域，页面不再延伸其下；顶部不再需要安全区内边距（值变为 0，原有 `max(4px, env(...))` 写法自动退化为 4px，无副作用）。CDP 模拟的 47px 安全区回归仍全部通过。
- 普通浏览器标签页（Android 空白回归防护）行为不变：shellbar 38px、文字居中。

## 测试与证据

- 新增/更新 `tools/arcade_pwa_update_test.mjs` **7/7**：新增 PU-00 校验所有页面未声明 `viewport-fit=cover` / 半透明状态栏样式（防回归），PU-04 校验 fixed 深色顶边条存在。
- `validate_site.py` 增加断言：中心页不得声明上述两项 meta，`apps/arcade/**/*.html` 不得出现 `viewport-fit=cover`。
- 回归门禁：`arcade_smoke.mjs` 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、validate/build/inline/node --check 全过。
- 注意：Chrome 无头无法重现 iOS 系统级顶缘模糊，本修复的正确性以真机复测为准；模拟测试只防「触发条件回归」与布局溢出。

## 回滚

- 回退 0.11.3 的 HTML meta 与 `::before` 样式，版本链恢复到 0.11.2；无数据迁移。
- 若 iOS 真机出现底部 Home Indicator 遮挡，可按需在独立模式重新引入底部 `env(safe-area-inset-bottom)` 内边距（不涉及顶部模糊触发条件）。

## 待 Owner 确认

- 请 Owner 在真机 iPhone 主屏幕 PWA 上重新打开中心页与任意游戏页，确认顶部文字清晰、无灰白渐层。
- 若旧主屏图标仍显示模糊：删除主屏幕图标后重新「添加到主屏幕」（清掉 iOS 缓存的旧 chrome），再确认。
