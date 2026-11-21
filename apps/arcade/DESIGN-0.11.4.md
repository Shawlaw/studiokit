# Arcade 0.11.4 设计：iPhone PWA 顶部导航条模糊真机定位与 sticky 修复

## 背景 / Owner 真机诊断

0.11.3 移除了 `viewport-fit=cover` 与半透明状态栏，但 Owner 真机复测顶部**仍然发虚**。经过三轮盲改无效后，改用真机诊断页（`diagnose.html`，使用站点真实 shellbar）逐方案对比，Owner 反馈：

- 方案 1 / 9 / 10（shellbar 改 `position: sticky; top: 0`）→ **文字清晰、无副作用**；
- 方案 3（`position: fixed; top: 0`）→ 清晰，但脱离文档流导致下方内容贴边（不可用）；
- 原 `static` 的 shellbar → 发虚（即线上现状）。

**关键澄清**：Owner 说的「被模糊」对象一直是**中心页最顶上那条 `StudioKit / 街机厅 Arcade / 源码 ↗` 导航条（共享 shellbar）**，不是游戏页的标题栏。前几轮改游戏页方向错误。

## 根因

iOS 26+ 系统级顶缘模糊：独立模式 PWA 的视口顶边会被系统叠加一层模糊/淡出。WebKit 的规避机制是——若有一个 **`position: sticky/fixed` 且贴住视口顶边的不透明元素**，系统改用该元素的纯色替换模糊。

共享 shellbar 原本是 `position: static`（在文档流顶部但滚动时不贴顶），不满足「贴住顶边」的判定，因此被系统模糊冲淡。0.11.2 加的 `fixed ::before` 色条高度取 `env(safe-area-inset-top)`（去掉 cover 后该值为 0，退化为 1px），未能有效替换整条导航条的模糊。

## 实现（0.11.4）

**核心修复**（`apps/arcade/arcade.css`）：仅安装版 standalone 下让 shellbar sticky 贴顶：

```css
html.studiokit-shell-standalone body.arcade-body > .studiokit-shellbar {
  position: sticky;
  top: 0;
  z-index: 9998;
}
```

- `sticky` 仍在文档流，不像 `fixed` 那样让下方内容贴边（真机方案 3 的副作用），因此无副作用。
- 深色不透明背景由 0.11.2 的 `body.arcade-body > .studiokit-shellbar { background: #0b1020 }` 提供。
- 仅 standalone 生效，普通浏览器标签页 shellbar 仍为 static 38px（Android 空白回归防护不变）。作用域限定 `body.arcade-body >`，不影响 Badge Studio / Venue Compare。

保留 0.11.2 / 0.11.3 的既有措施（`::before` 深色条、移除 cover/半透明 meta、深色 shellbar、游戏顶栏分层）——它们与 sticky 不冲突。

## 兼容性 / 数据

- 不改任何 localStorage key / Schema、玩法、存档、积分、挑战数据。
- 版本链升至 `0.11.4`，SW 缓存键 `studiokit-arcade-0.11.4-v1`，确保安装版拿到新 CSS。
- 普通标签页与沉浸式游戏的布局不变（smoke 94/94 含 standalone/浏览器双模式安全区回归）。

## 测试与证据

- `tools/arcade_pwa_update_test.mjs` **7/7**：PU-04 新增断言——独立窗口 shellbar `position: sticky` / `top: 0px` / `z-index ≥ 1`。
- 布局探针（真机结论的程序化复核）：滚动 600px 后 shellbar 仍 `top: 0 / height: 85 / sticky`，下方元素正常（`elementFromPoint` 命中内容 P，非被遮挡），无 fixed 的贴边副作用。
- 回归：smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、validate/build/inline/node --check 全过。
- 真机诊断页 `diagnose.html` 为临时工具，定位完成后从发布产物中删除。

## 回滚

- 移除 `html.studiokit-shell-standalone body.arcade-body > .studiokit-shellbar` 的 sticky 规则，版本链回退；无数据迁移。
