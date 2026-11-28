# Arcade 0.22.0 — 独立职业披露与世界通用工作

- 版本链：0.22.0；SW 缓存键 `studiokit-arcade-0.22.0-v1`
- 基线：`68529dd`（0.21.2 发布后文档提交）；接口冻结 `docs/arcade-life/ADR-interfaces.md` §23
- 本文件只记录非剧透的设计、边界与回滚；完整产品/执行契约在仓库外，不提交。

## 1. 目标

1. 所有现有职业保持独立、平行、被动发现；第一次发现不等于职业起源，只有玩家主动接受邀请才建立唯一生涯身份并固定起源。
2. 接受邀请与接受第一份委托是两个明确动作；再次接受其他职业不重复身份、初始流水或序章。
3. 未发现/已读未接受的职业、任务、NPC、材料来源与推荐不得进入玩家可见 DOM；统一由纯投影 gate 裁决。
4. 世界主线引入“世界通用工作”类别：以通用戏内文案披露，任何已接受职业都可承接，但不暴露拥有职业，也不要求发现或接受其他职业。
5. 旧存档、封存/解冻、完全重置、导入导出、经典街机与 PWA 离线保持兼容。

## 2. 实现边界

- 不新增游戏、职业、委托总量、章节、终局、签到、货币或付费入口。
- 不新增 IndexedDB store、DB_VERSION、localStorage key；`contentVersion` 仍为 `0.18.0`，rulesetVersion 与经典玩法数值不变。
- 职业扩展挂在既有 `state['discovery']` 快照；`professionVersion = 1`，未来版本只读保留，不降级回写。
- `profession-state.js` 是纯 reducer；`career-db.js` 是唯一落盘 owner；`profession-view.js` 与 `commission-core` 是统一披露/接单 gate；bridge/UI 不再自行读完整 catalog 后过滤。
- 世界通用工作由 `career/content/world-work.json` 定义，只提供现有委托 ID 与通用标题/说明，不克隆委托、不改奖励。终局仍只检查世界条件，不检查职业。

## 3. 数据与事务

- 首次接受邀请时，`state/discovery/profiles/balances/ledgers` 在同一事务提交；第二职业接受时 `created:false`，资产快照不变。
- 重复接受是纯 no-op；切换当前职业与搁置/恢复是独立动作，搁置不阻塞世界主线。
- 旧档迁移只认显式接受集合、明确状态的真实 quest/claim/run 与已有身份起源；线索、全局 stage、catalog unlock、游玩次数、推荐、`profile.updatedAt` 和坏时间戳都不算接受证据。
- 封存、退役 ID、generation、导入替换继续沿用 0.21 的事务内守卫；所有职业写失败整事务回滚。

## 4. UI 与可达性

- 0.22 沿用既有局部视觉，不复制 `prototype/tokens.css` 到全局，也不强行改普通游戏主题；视觉深化属于 0.23。
- 港口工作列表取投影与核心可接集合的交集；眼下主卡取 `story.nextAction`；经历仅取真实事件；工具入口按 `view.tools` 的具体 `toolId` 显示。
- 首次到港段只用真实 `acceptedOriginGameId` 与已接受职业状态；第二职业不重播序章。
- 导入、封存、解冻、重置后已打开面板通过失效订阅关闭或刷新，不残留旧投影。

## 5. 验证口径

- 每任务仅运行精确 L0/L1；主 Agent 在版本门禁统一安排 L2/L3。静态 CI 与 release profile 口径分离，`release passed (not full)` 不等于 full。
- 本版门禁结果、证据 SHA、漏测与发布准备状态见 [`INTEGRATION-0.22.0.md`](../../docs/arcade-life/INTEGRATION-0.22.0.md)。未完成前不得写发布成功。

## 6. 回滚

- 代码回滚到 `68529dd` 前需停止发布并保留职业库导出；旧代码不能读取含职业扩展的新档时，明确禁止静默降级，先使用既有备份/导入流程恢复。
- 由于 IDB 仍为 v1 且扩展字段只追加，旧代码读取新档主要风险是看不到职业扩展而不是清空资产；回滚前仍须在合成档验证身份、资产、章节与终局不变。
- 不重写已共享历史，不删除旧 tag/制品；没有明确 `PUBLISH_TO_MAIN` 授权时不 push main、不打 tag、不创建 Release。
