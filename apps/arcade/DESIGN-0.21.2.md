# Arcade 0.21.2 — 首页生涯弹窗与交互细节修复

- 基线：0.21.1（2026-11-26 已双端发布，main `afa5549`，SW `studiokit-arcade-0.21.1-v1`）
- 产品分支：`fix/arcade-career-entry-0211`
- 版本链：0.21.2；SW 缓存键 `studiokit-arcade-0.21.2-v1`
- 验证口径见[集成与验证记录](../../docs/arcade-life/INTEGRATION-0.21.2.md)

## 1. 问题与修复

1. 「旧港生涯 / 回折光港看看」原为 `games/pendulum-tower.html?careerPanel=town` 深链，必须先进入层塔页，再由 bridge 启动后打开告示板。现改为中心页按钮，点击后按需加载 `career/bridge.js` 并直接调用 `openHubCareerPanel('town')`，URL、首页滚动位置与入口焦点不变。
2. 告示板入口文案为「钱包与收据」，收据面板标题却是「钱袋与账本」。面板标题统一为「钱包与收据」。
3. 生涯遮罩 `z-index:70` 低于独立窗口站点导航栏的 `9998`，且没有背景滚动锁。现遮罩为 `10000`，并在生涯遮罩存在时锁定 `html/body` 滚动，面板正文保留独立滚动；关闭全部面板后恢复。
4. 游戏页顶栏标题左侧缺少内边距。现增加 8px 左内边距；`≤360px` 时仍使用页面自身 8px 边距，避免 320px 标题被截断。

## 2. 首页入口与票号路径

- 首页不预载完整生涯 bridge，只沿用既有只读探针决定入口可见性。点击时才动态加载 bridge，并等待 `readyPromise` 完成后打开告示板。
- `openHubCareerPanel()` 增加为 bridge 公开入口，仍复用 `readHubEntry()`、封存门控、旧档判定与现有告示板 UI。
- `commission-core.configure()` 新增可选 `arcadeBase`。游戏页宿主仍用相对 `../`；首页宿主使用 bridge 推导的绝对基址，确保接单/续单生成的 `games/<id>.html?career=<ticket>` 从首页也能正确导航。
- 首页错误提示在当前页显示，不再提供会重新跳转的「返回街机厅」链接；游戏页宿主保留原返回链接。

## 3. 数据与兼容

- 不改 localStorage key、IndexedDB v1 / 11 stores、`careerSchemaVersion 1`、`contentVersion 0.18.0`、`rulesetVersion 1`、玩法数值、关卡/挑战数据或委托奖励。
- 不新增 CDN、远程字体、分析、后端或第三方资源。
- SW 升级沿用只继承旧预载清单、重新联网取当前版本页面的策略。

## 4. 验收

- 首页点击入口后不导航，告示板在当前页打开；关闭后恢复原滚动位置、焦点与背景滚动。
- 钱包入口与弹窗标题一致；独立窗口导航栏不盖住生涯遮罩；滚动只作用于面板正文。
- 16 款游戏页在 320/375/390/430 与高屏均无标题截断或横向溢出。
- 从首页接单/续单仍导航到正确游戏并复用原 ticket；旧档、封存/解冻/完全重置语义不变。
- `arcade_smoke`、`career_flow_e2e`、`career_pwa_offline`、`arcade_compact_touch`、`career_passive_entry`、`career_commission` 通过。

## 5. 回滚

- 回滚本版产品提交与测试断言，版本链回到 0.21.1；无需数据迁移。
- 已执行的本版 SW 升级随 activate 清理旧缓存；生涯 IDB 与经典 localStorage 不受影响。
- 真机与 `full` profile 是否执行以集成记录为准，不把未执行项写成通过。
