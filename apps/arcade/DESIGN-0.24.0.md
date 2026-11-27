# Arcade 0.24.0 — 世界主线替代路线、可选职业交汇与经历回读

- 状态：**本地发布准备，未发布**（门禁状态待 L3（lead）；未获 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`，未 push、未打 tag、未部署）
- 版本链：0.24.0；SW 缓存键 `studiokit-arcade-0.24.0-v1`
- 基线：0.23.0 候选 `79301da`（GATE_PASSED / RELEASE_READY，本地发布准备，未发布）；0.24 开发分支自 `cf81f12` 起基于该候选
- 契约：`docs/arcade-life/ADR-0.24-world.md`（T20 冻结，T24 增补 §9）；机器可读 `tools/career_world_narrative_schema.json`
- 验证口径：[`docs/arcade-life/INTEGRATION-0.24.0.md`](../../docs/arcade-life/INTEGRATION-0.24.0.md)

## 1. 目标

0.24 不新增章节、委托、职业、终局或奖励，只把 0.23 已经存在的替代机制（世界通用工作、本职业委托、明码代办、免费租机、商店材料、证据组合）写成**戏内成立的故事行动**；为**双方都已主动接受**的职业交汇提供叙事与可选回执；给玩家可读的「经历」定义可回读的白名单文本。三件事都在 0.23 的同一组件体系与同一状态契约内完成。

## 2. 不变量（全篇冻结）

1. **不新增委托、不新增奖励。** 不发货币/材料/证据/旗标；替代路线只复用真实存在的委托、代办 offer、材料与证据 token。
2. **不改变主线唯一解。** 替代叙事只解释「为什么这条路在戏内成立」，不新增解锁路径；交汇不注册 `campaign.json` 的 `requires`/`rewardFlags`，不产生 `story-evidence` 可判定 token。
3. **不新增持久化面。** 不新增 IndexedDB store / IDB 版本 / localStorage key，不新增 `storyEvents` 之外的事件字段；IDB 仍 v1 / 11 stores，`contentVersion` 仍 `0.18.0`，`professionVersion` 仍 `1`，`rulesetVersion` 不变。
4. **未接受的职业不进入 DOM。** 不满足条件时投影层**不产出**节点（不是 `display:none`）；内部 id、reason code、证据 token、章节/委托后缀不进玩家文本。
5. **0.23 零回归。** 新内容/新模块缺失时按 0.23 原路径降级；普通街机、PWA、封存 / 导入 / 重置语义不受影响。

## 3. 世界主线替代路线（叙事合理化）

### 3.1 机制枚举

替代叙事只能挂在下列 6 种真实机制上，映射是唯一的（schema 文件 `constants.mechanismAnchorKind` / `constants.mechanismReceiptSource` 逐项冻结，契约测试逐项断言）：

| mechanism | 真实锚点 | 唯一真实来源 | 结算证据来源（只读） |
|---|---|---|---|
| `world-work` | `commissionId` | `content/world-work.json` 的 5 个世界通用工作（全部已存在于 96 单真实委托） | 委托收据 |
| `profession-commission` | `commissionId` | 96 单真实委托中不属于世界工作的本职业委托 | 委托收据 |
| `errand` | `offerId` | `alternatives.js` 的明码代办 offer | `kind:'alternative'` 任务行 + 购买流水 |
| `rental` | `shipId` | `items.json` 中 `rental === true` 的唯一免费租机 | 租机后的真实护航委托收据 |
| `market-material` | `itemId` | `items.json` 五材固定价 | 采购流水 |
| `evidence-pair` | `evidencePair` | `story-evidence` 三条内置规则的真实 token | 证据发放记录 |

### 3.2 内容与 resolver

- 新内容文件 `apps/arcade/career/content/world-narrative.json`（`schemaVersion:1`、`contentVersion:'0.18.0'`、`releaseVersion:'0.24'`）；`alternativeNarratives[]` 当前 **7 条**，覆盖 C1–C5 与全部 6 种机制。
- 新纯 resolver `apps/arcade/career/world-narrative.js`（UMD，浏览器 `window.ArcadeCareer.worldNarrative`，Node `module.exports` 同 API）：不读 DOM/DB/时钟/随机数、不修改入参、不抛异常；异常与内容缺失一律返回空结果 + 既有 reason code，不发明新码。
- **可用性口径**：`available = 章节已到达（真实章旗标） × gate 满足 × 该机制真实前置成立 × 玩家至少有一个已接受职业`。`gate.requiresSpecificProfession` **恒为 `false`**——主线不得以某个特定其他职业为前置。
- **落款只从真实内容读**：起源信签名人（`chapter-01.json` 的 `c0Letter.from`）、真实委托 `issuer`、代办 issuer、`npc.json` 角色名；不手写人名，不发明新人物。
- **收据只在真实结算行存在时渲染**：委托收据、代办购买流水、租机后护航委托、采购流水、证据发放。叙事节点**只读**这些行，绝不写入。
- **文案规则**：每段一句主动作、2–3 短段；不给数量/金额/「完成后得 X」承诺；不出现系统话术、内部 id、reason code、证据 token 前缀、章节码、委托后缀、总数/百分比、完整路线攻略词；不出现未接受职业的展示名。
- T21 只改 `content/world-work.json` 的 5 条通用文案（旧港通用活计），**不改 id 列表、不新增委托、不改奖励**。

### 3.3 章节前置解释

- `campaign-core` 为每章入口 `entry` 与完成里程碑旗标生成公开解释（与真实 gate 同源，`met` 由既有 `evalRequirement` 计算，不新增 reason code、不改判定）：
  - `chapter.prerequisite = { met, empty, mode, kind, requirement, tokens, items, groups, body, text }`；`text` 以「前置已经齐了：」/「还差这些前置：」开头，token 逐项来自真实 `allFlags`/`anyFlags`/`anyCommissions`/`evidenceAll`。
  - `chapter.completion = { flag, met, text }`，说明本章认的里程碑旗标及真实获得提示。
  - 同一形状也用于路线与终局入口（`route.prerequisite` / ending 入口），因此解释与实际解锁条件不会漂移。
- **UI 落点**：章节面板（`ui/world-state.js`）每章行只**加性**渲染 `prerequisite.text`、`completion.text` 与当前章替代指引的 `texts.{offer,next}`；港口经历页顶部（`ui/town.js`）复用同一公开字段。无数据不建节点，DOM 与 0.23 一致；`requirement`/`tokens`/`anchor`/`narrativeNodeId`/`mechanism` 不进 DOM；不新增总数或进度压力文案。

## 4. 可选职业交汇（双方接受、去重、无奖励）

- **内容**：`crossoverPairs[]` 由 0.23 已声明的 16 条职业 `optionalCrossover` 折叠而成，当前 **10 个无序对**（6 对各有两条独立声明，4 对只有一条）；同一对只产生一个事件。
- **触发条件（只用真实事实）**：
  1. 双方都已主动接受：`state.professionProgress[a|b].state ∈ {accepted, developed, completed}`；仅 `read` / `glimpsed` / `undiscovered` 不算；`paused` 不回退状态、也不阻塞。
  2. 章节在窗口内：`context.worldFlags` 含声明的章节真实旗标（或当前章已到达）。
  3. 可选真实前置：真实旗标 / 已清委托 / 已得证据 token 的交集判定；四者皆空表示「只要双方接受 + 章节到达」。
  4. surface 允许：只走 `port` / `journal` / `message` / `receipt` / `toast` / `deep-link`；`clue` / `letter` / `work` / `shop` / `crafting` / `tools` 一律禁止。
  5. 未封存、非未来版本（`archived === true` 或 `professionVersion > 1` 不产出）。
- **去重（内容层 + 状态层）**：
  - `eventId = 'crossover:' + 两职业 id 字典序`；同 `eventId` 的多条声明按唯一 owner 规则保留一条（`contentOwnerProfessionId === 最小 id` 优先，否则字典序最小者，仍并列取文件声明第一条并记 warning）；同对的全部声明必须携带完全相同的 `texts`/`anchor`/`gate`，不一致判内容非法（fail-closed，不取并集）。
  - 状态层只写一次：`career-db.applyProfessionEvent({action:'RECORD_STORY_EVENT'})`（`source:'world'`，同一事务内代次守卫）；重复写入返回 `duplicate:true` 视为成功，不改 `at`、不重放消息；`maxShowsPerCareer:1`，同一会话最多回显一次。
- **无奖励、不改主线**：`effects: []`、`grants.credits:0` / `items:{}` / `evidence:[]` / `flags:[]` 为 schema 硬约束（`additionalProperties:false` + `const`，测试逐项断言）；不写 `campaign.json` 的 `rewardFlags`/`requires`，不产生证据 token，`touchesMainline:false`、`affectsIdentity:false`。终局后最多复用一句后日常，不改已展示结局或 `epilogue`。
- **未接受绝不透露（四层防线）**：内容层不含对方展示名/线索/委托标题/章节名；resolver 层不满足就**不产出节点**（没有 locked/disabled 占位）；投影层未接受一侧连「存在某项交汇」都不可提示；渲染层剥掉 `eventId/pairId`。交汇不进入 route-planner 候选、推荐集合、工作栏、材料来源、商店、人物图鉴或 toast 的待办语义。

## 5. 经历筛选与回读

- **白名单**：`world-narrative.json.journalWhitelist[]` 当前 **17 条**（10 条交汇事件 + 7 条世界替代事件），`whitelistLayer:'content'`；`label` 与回读文本是内容静态字符串——同一 `eventId` 永远同一文案。
- **落盘形状不变**：`storyEvents[eventId] = { at, source }`；`label`/`text`/`person` 只在投影时由白名单解析，**不落盘、不迁移、不写版本**（旧档不需要迁移）。
- **加性投影（T24 增补）**：白名单可显式声明 `text`（8–120 字符，玩家可见回读）与 `person`（真实签名人/签发人，≤24 字符）；`profession-view` 只在内容声明时给 `story.history[]` 追加可选 `detail{text,person}`，并在行上补 `person` 与 `professionId`（后者仅在该职业已被接受时才出现，只用于筛选），旧内容零 `detail`、与 0.23 逐字节同形。
- **筛选**：`ui/journal.js` 的人物选项只来自实际出现事件里的真实人名；职业选项只来自投影里**已接受**的职业（未接受职业不进筛选器）；没有任何可筛选数据时不渲染筛选器（不显示空控件）。
- **回读**：点击已发生事件只展开白名单静态文本与人物；不出现任务、奖励或状态写入；关闭后焦点回到原条目；不显示总数/百分比/锁定项/内部 id。
- **排序**：沿用 `storyHistory()` 既有比较器——`at` 升序，空 `at` 视为空串排最前，同级按 `label` 再按 `kind`；DOM 顺序即真实发生顺序。
- **降级**：`ui/journal.js` 缺失时港口回落到 0.23 的只读 `JournalTimeline`，不显示空筛选器、不报错。

## 6. 接线与降级

- bridge 按需加载 `career/world-narrative.js`（可选、lazy）与同源 `career/content/world-narrative.json`；普通游戏首屏仍零生涯加载，加载失败保留 0.23 降级。
- `careerCatalog()`：
  - `catalog.worldNarrative` = 原始内容对象（供 resolver 使用）；
  - `publicStoryEventIds` / `publicStoryEvents` 由 `journalWhitelist` 合成 `{label,text,person,professionId?}`（不改代码冻结常量 `PUBLIC_STORY_EVENTS`）；
  - `catalog.worldChapterAlternatives` 按章懒计算并注入 resolver 的 `nodes`，按真实事实快照身份缓存；内容、模块或事实任一缺失都**不注入该键**。
- `route-planner.chapterAlternatives()` 优先读 `catalog.worldChapterAlternatives`，未注入时退回 `catalog.worldNarrative` 的 resolver 输出；两者都缺失时与 0.23 逐字节同形（`worldNarrative:'absent'`）。
- 写入面单一：交汇首次展示成功后 bridge 调 `recordWorldNarrativeEvent`，复用 `career-db.applyProfessionEvent({action:'RECORD_STORY_EVENT'})` 的既有事务与代次守卫；不新开写口、不新增 store / key / 方法面（只加薄封装）。
- SW 预缓存追加 `./career/world-narrative.js`、`./career/ui/journal.js`、`./career/content/world-narrative.json`；缓存迁移策略不变（只继承预载清单、重新联网取当前页面字节）。
- 降级：内容/模块/事实缺失 → 交汇与替代叙事为空、经历只显示代码冻结白名单；`professionVersion > 1`（未来档）→ 空视图、只读、不回写。

## 7. 兼容与回滚

- **不新增 store / key**：IDB `studiokit:arcade:career` v1 / 11 stores 不变；经典 localStorage key 不变；`storyEvents` 仍写在既有 `state/discovery` 行。
- **内容版本**：`contentVersion` 仍 `0.18.0`（新内容文件自带 `contentVersion:'0.18.0'` 与 `schemaVersion:1`）；`professionVersion` 仍 1；`rulesetVersion` 不变；不新增 reason code。
- **旧档只追加**：0.24 不重写任何既有 `storyEvents` 行、不补 `label`、不为旧档猜测新增事件；未知 namespace / 未知 eventId 保留并隐藏（任何读取路径都不删除）；坏扩展字段按既有 `normalizeExtension` 修复；上限沿用 `MAX_STORY_EVENTS = 256`（不修改 `profession-state.js`）。
- **封存 / 导入 / 重置 / 备份**沿用既有语义：`storyEvents` 随 `state/discovery` 行整体处理，不新增迁移步骤。
- **回滚**：删除 `career/content/world-narrative.json`、`career/world-narrative.js`、`career/ui/journal.js` 并回退 bridge / profession-view / route-planner / campaign-core / town / world-state 的加性接线即回到 0.23 行为；已写入的 `storyEvents` 行只是惰性字符串，0.23 读不到白名单时只隐藏、不破坏旧档。回滚须同时把版本链与 SW 缓存键归回 0.23.0，并在发布前先停发布、保留导出、验证合成档。

## 8. 证据边界

本轮（T25 前半，只做纯文本/静态校验与纯 Node 复跑；不启动 Chrome，不跑 release / full / watch；未 push、未发布）：

- `node tools/career_world_narrative_contract_test.mjs` **166/166**（T20 契约层 158/158 → T24 加性字段后 166/166）
- `node tools/career_world_narrative_test.mjs` **179/179**（T22 内容/resolver 163/163 → T24 后 179/179）
- `node tools/career_journal_experience_test.mjs` **59/59**（T23 49/49 → T24 后 59/59）
- `node tools/career_world_route_narrative_test.mjs` **80/80**、`node tools/career_route_planner_test.mjs` **214/214**、`node tools/career_economy_balance_test.mjs` **47/47**、`node tools/career_world_work_test.mjs` **400/400**
- `node tools/career_legacy_baseline_test.mjs` **78/78**（版本链一致性）、`node tools/career_profession_extension_test.mjs` **92/92**（`sw.js VERSION === engine ARCADE_VERSION`）
- `py -3 tools/validate_site.py` PASS、`py -3 tools/check_readme_links.py` PASS、`git diff --check` PASS

浏览器、release、full、真机、真人与线上部署仍未验证（UNVERIFIED），留给 lead 的 L3；本文不写 GATE_PASSED、不写 ALL GATES PASSED、不写发布成功。完整台账与未验证项见 [`INTEGRATION-0.24.0.md`](../../docs/arcade-life/INTEGRATION-0.24.0.md)。
