# Arcade 0.23.0 — 折光港统一视觉与职业叙事界面

- 版本链：0.23.0；SW 缓存键 `studiokit-arcade-0.23.0-v1`
- 基线：0.22.0 `GATE_PASSED / RELEASE_READY`（`7a78f66`）
- UI 契约：`docs/arcade-life/ADR-0.23-ui.md`；设计原型与截图在仓库外，不提交。

## 1. 目标

1. 将 0.22 已成立的职业披露、平行邀请、世界通用工作与真实经历统一到一套局部港口组件体系。
2. 视觉严格对齐私有原型的暗色港口、金色邀请、440px 面板、眼下/工作/经历与 harbor SVG；普通 16 款游戏保留各自主题。
3. 为全部真实职业提供数据驱动的短叙事卡，区分首次到港与已有身份后续邀请，不重复身份、奖励或序章。
4. 保持 0.22 的状态、事务、迁移、封存、导入、离线和经典游戏不变量。

## 2. 实现边界

- 不新增游戏、职业、委托、章节、终局、货币、签到或远程资源；IDB 仍 v1 / 11 stores，`contentVersion` 仍 `0.18.0`。
- 组件与样式只在 `.ac-career-ui` 局部命名空间；不使用 `:root/html/body/*` 全局覆盖，不引入框架、CDN、字体或图标库。
- 共享文件：`career/ui/components.js`、`components.css`、`tokens.css`、`harbor.js`；叙事数据：`career/content/narrative-registry.json` 与四个 shard。
- bridge 只在真实进入生涯 UI 时按需加载组件/CSS/叙事内容，失败时保留 0.22 降级路径；经典游戏零生涯首屏加载与零样式污染。
- 未接受职业、隐藏任务与内部 ID 继续由 `careerView`/`commission-core` gate 排除；组件不读取完整 catalog 自行过滤。

## 3. 组件与交互

- CareerShell、ClueRow、LetterCard、NPCDialogue、Primary/SecondaryAction、StoryCard、SegmentedTabs、WorkCard、ReceiptCard、JournalTimeline、ToolGrid 的 props/状态/DOM/键盘契约以 ADR 为准。
- dialog 提供初始焦点、Tab trap、ESC、关闭回焦；所有按钮 touch target ≥44px；异步状态使用 aria-live polite；reduced-motion 禁用非必要动画。
- 320/390/844×390/1280 使用内部滚动与安全区，不固定剧情高度；PWA 不恢复 `viewport-fit=cover`。
- harbor SVG 逐字复刻原型 `reference.js` 的 320:100 / 320:112 构图，仅作装饰，文字独立渲染。

## 4. 叙事数据

- 四个 shard 各覆盖 4 个真实职业，共 16 个；来源限真实 registry/clues/commissions/chapter-01/npc。
- 每职业包含真实触发、首委托、首次/已有身份介绍、人物回信、下一步、搁置/返回与 0.24 可选交汇条件。
- 消息只从已接受职业取 0/1 条；交汇内容只在双方已接受后由后续 resolver 使用，本版不泄露未接受关系。

## 5. 验证与回滚

- 精确组件/适配/数据/隐私测试通过后，T15 使用同一 fixture 对产品与 QA-only 同内容原型做 1280/390 截图，并检查 320/横屏、键盘、焦点与 PWA 离线。
- 0.23 release 门禁结果与证据见 `docs/arcade-life/INTEGRATION-0.23.0.md`；未完成前不得写发布成功。
- 回退到 0.22 代码时，新增 JSON/CSS/JS 仅追加且不影响职业 DB；若旧代码不读取叙事文件，界面降级而不丢资产。仍须先停发布、保留导出并验证合成档。
