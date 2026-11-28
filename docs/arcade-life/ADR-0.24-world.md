# ADR-0.24-world：Arcade 0.24 主线替代路线、职业交汇与历史事件冻结

- 状态：**FROZEN_FOR_T21_T23**（T20 契约层；实现必须按本 ADR，任何字段/语义变更先改本 ADR 并由 lead 串行确认）
- 文件：`docs/arcade-life/ADR-0.24-world.md`（本 ADR 的唯一路径；`ADR-interfaces.md` 的 §24 由 lead 在 T25 追加）
- 日期：2026-11-28
- 分支 / 基线：`feat/arcade-career-024`，基线 `79301da`（0.23.0 收口 `GATE_PASSED / RELEASE_READY`，release 47/47 not full；未发布、未 push）
- 版本链（T25 收口）：Arcade 0.24.0；状态与门禁结论以 [`INTEGRATION-0.24.0.md`](INTEGRATION-0.24.0.md) 为准（本地发布准备，未发布，门禁状态待 L3）。
- 任务：Arcade 0.24 T20。**本文只产出契约与数据设计**：未修改 runtime、内容 JSON、bridge loader、版本链；未运行浏览器、release、full、watch；未 push。
- 本任务新增且只新增三个文件：本 ADR、`tools/career_world_narrative_schema.json`、`tools/career_world_narrative_contract_test.mjs`。**未追加** `ADR-interfaces.md` §24，也未登记 gate（§24 与 gate 注册属 lead/T25 串行收口）。
- 外部依据（仓库外，不进入仓库）：0.24 设计基准包的 `spec/00-product-contract.md`、`spec/01-state-contract.md`、`spec/03-narrative.md`、`execution/02-task-board.md` 的 T20–T24 行。本文只落地可执行的契约，不复制其示例剧情、示例人物或演示状态机。
- 仓库依据：`docs/arcade-life/ADR-interfaces.md` §20–§23；`docs/arcade-life/ADR-0.23-ui.md` §3–§7；`apps/arcade/career/{profession-state,profession-view,commission-core,campaign-core,story-evidence,route-planner,alternatives,career-db,bridge}.js`；`apps/arcade/career/content/{registry,clues,commissions,world-work,chapter-01,campaign,npc,items,narrative-registry,narrative-shards/*}.json`。
- 机器可读契约：`tools/career_world_narrative_schema.json`（下称"schema 文件"）。
- 契约测试：`node tools/career_world_narrative_contract_test.mjs`（纯 Node、零依赖、不启动 Chrome、不写仓库）。

证据标记沿用 0.23 ADR：`[F]` 为当前源码/内容事实，`[I]` 为在事实基础上冻结的实现约定，`[U]` 为未验证且保持 UNVERIFIED。

---

## 1. 范围与不变量

`[I]` 0.24 只允许在 0.23 的同一组件体系与同一状态契约内深化：把**已经存在的**替代机制（世界通用工作、本职业委托、明码代办、免费租机、商店材料、证据组合）写成可信的故事行动；让**双方都已接受**的可选职业交汇有叙事与回执；给玩家可读的"经历"事件定义 schema 与可见性白名单。以下不变量在整个 0.24 内冻结：

1. **不新增委托、不新增奖励、不发货币/材料/证据/旗标。** 替代路线只复用真实存在的委托、代办 offer、材料与证据 token；交汇只产出叙事事件与可选回执文本。
2. **不改变主线唯一解。** 替代路线只解释"为什么这条路在戏内成立"，不新增解锁路径；交汇不注册任何 `campaign.json` 的 `requires`/`rewardFlags`，不产生 `story-evidence` 可判定 token。
3. **不新增持久化面。** 不新增 IndexedDB store / IDB 版本 / localStorage key，不新增 `storyEvents` 之外的事件字段，`contentVersion` 仍 `0.18.0`，`professionVersion` 仍 `1`，`rulesetVersion` 不变。
4. **不可见的东西不进入玩家 DOM。** 未接受职业的交汇节点在投影层就不产出（不是 `display:none`）；内部 id、reason code、证据 token、章节/委托后缀不进玩家文本。
5. **基线 0.23 零回归。** 缺内容文件时按 0.23 原路径降级（交汇与替代叙事为空、经历只显示代码冻结白名单），普通街机、PWA、封存/导入/重置语义不受影响。

## 2. 真实锚点（先核实，再冻结）

### 2.1 起源与人物

- `[F]` `content/chapter-01.json:7-184` 的 `origins[]` 恰有 16 条，每条 `{gameId, professionId, opening, c0Letter{from, body, address}, firstStep}`；`gameId` 与 `registry.json:5-168` 的 16 款游戏一一对应，`professionId` 与 `professions[]`（16 条，`:170-187`）一一对应。**16 个起源信签名人就是 16 位真实 NPC**，`c0Letter.from` 是唯一权威签名文本来源。
- `[F]` `content/npc.json` 只有 3 位真实角色（`characterId` 为 `E-7` 与另两位具名角色），每人按 `chapterId` 给 1–3 条 `replies`（`C0`–`C5`）。`content/chapter-02..05.json` 的 `contacts` 复述的是同一批人物关系。
- `[I]` 0.24 的叙事节点**只允许引用**：① `chapter-01.origins[].c0Letter.from`（按 `gameId` 解引用）；② `npc.json.characters[].characterId`；③ 真实委托 `issuer` 字段。不得发明新人物、不得改写既有关系。

### 2.2 替代机制现状

- `[F]` `content/world-work.json` 是 0.22 T05 冻结的世界通用工作：`commissionIds` 恰 5 个（`star-raid.T1`–`T3`、`pendulum-tower.T1`–`T2`），`entries[]` 给通用 `title/summary`。这 5 个 id **全部已存在于 `commissions.json` 的 96 单里**——世界工作不是新委托，只是披露类别。
- `[F]` `alternatives.js:59-127` 只有两个内置代办 offer：`alt.courier`（120 信用点 → `C1.signal` + `E-C1-courier`）与 `alt.records`（90 信用点 + 1 合金 → `C1.records` + `E-C1-records`），明码标价、立即完成；`FORBIDDEN_FLAGS`（`:82`）禁止代办写 `C1.work_done` / `C1.flight_done` / `C1.storm_done`；`buy()` 只扣费 + 写 `kind:'alternative'`/`kind:'story'` 两行，不发放任何东西。
- `[F]` `route-planner.js:69-70` 冻结 `STEP_KINDS = commission|rental|market|alternative|story`、`ALTERNATIVE_KINDS = work|research|trade|rental|alternative`；`buildWorldWorkPath()`（`:2149-2330`）按 5 个世界工作 id 拓扑排序，战斗游戏缺自有船时插入 `rentalStep`（真实免费租机 `old-wing`），并给出 `blockers`。
- `[F]` `story-evidence.js:125-176` 的内置规则只有 C2/C3/C4 三条，每条至少两条互不依赖分支；证据前缀冻结为 `E|MAP|BP|DEC`（`:53`）；`commissions.json` 的 `chapterGate` 只有 `C3.truth_found`(16) / `C4.city_power_restored`(16) / `C5.star_tower_resolved`(16) 三种取值。
- `[F]` `campaign.json:87-286` 的 C2–C4 各有 3 条路线，`requires` 只用 `anyFlags`/`anyCommissions`/`evidenceAll` 三种真实谓词（如 `:110-123` C2 `mining` 用 `evidenceAll` 两个真实 token）；`endings[]`（`:305-346`）三条终局共用 `entry.allFlags: ["C4.city_power_restored"]`，各发 `C5.star_tower_resolved` + `ending.<approach>`。
- `[F]` `items.json` 的 `ships[old-wing].rental === true` 是唯一免费租机；`materials[]` 五材均有 `buyPrice > 0` 的固定价——缺料永远有商店退路（`route-planner.js` 的 `material-market` 检查）。

### 2.3 状态与投影现状

- `[F]` `state['discovery'].value.storyEvents` 的行形状只有 `{at, source}`（`profession-state.js:358-375`），key 必须匹配 `EVENT_ID_RE`（`:38`，`^[a-z][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$`），全局上限 `MAX_STORY_EVENTS = 256`（`:39`），超限按 key 字典序淘汰；重复 key 返回 `duplicate:true` 且不改正文/时间。
- `[F]` `career-db.js:104,126,1360` 已有 `RECORD_STORY_EVENT` action 与 `applyProfessionEvent()` 事务入口，但**当前没有任何调用方写入 story event**；`profession-state.recordStoryEvent()` 也未被 bridge 调用。0.24 的写入必须走这条既有链路，不得新开写口。
- `[F]` `profession-view.js:43-46` 的 `PUBLIC_STORY_EVENTS` 目前只有 1 条（`story:C0.port_seen`）；`STORY_EVENT_SOURCES = ['clue','commission','world','story']`（`:46`）；`storyHistory()`（`:546-563`）已实现按 key 排序后按 `at`→`label`→`kind` 升序；`safeStoryEvent()`（`:494-544`）对 `invitation:`/`commission:` 前缀分别过 `canRevealProfession`/`canShowCommission`，其余走白名单。
- `[F]` 白名单已有**三条真实通道**：代码冻结常量（`:476`）、`catalog.publicStoryEventIds` + `catalog.publicStoryEvents`（`:477-490`）、`context.publicStoryEventIds` + `context.publicStoryLabels`（`:480-490`）。这意味着 0.24 扩展可见事件**不需要改代码常量**，只需要内容 + 调用方注入。
- `[F]` 投影只把 `{schemaVersion, originGameId, activeProfessionId, professions, commissions, story:{nextAction,messages,history}, tools}` 交给 UI（`profession-view.js:575-627`）；UI 契约见 `ADR-0.23-ui.md` §3、§4.11（`JournalTimeline` 的 props 只有 `{id?,label,at?,source?}`，不显示总数/百分比/`eventId`）。
- `[F]` `commission-core.js:504-505,952-954,1039-1054` 已把世界工作从职业委托里分出来：`category:'world'`、文案取 `world-work.entries`，任意已接受职业都可承接，但不显示拥有职业名。
- `[F]` `narrative-shards/shard-01..04.json` 的 16 条 entry 已带 `optionalCrossover{releaseVersion:'0.24', requiredProfessionIds[2], acceptanceRule:'双方均已主动接受', text}`，即 0.24 交汇的**内容意图已存在但无 schema、无 resolver、无持久化**。本 ADR 只补这三样。

## 3. 主线替代路线的叙事映射（冻结）

### 3.1 机制枚举 `[I]`

替代路线的叙事节点只能挂在下列 6 种**真实机制**上，枚举与顺序冻结（顺序同时用于 resolver 的稳定排序）：

| # | mechanism | 唯一真实来源 | 允许锚点 | 结算证据来源（只读） | 允许章节 |
|---|---|---|---|---|---|
| 1 | `world-work` | `content/world-work.json.commissionIds`（当前 5 个） | `commissionId` ∈ 该数组 | 委托收据 `quests`/`claims` | C1–C4（按内容真实 `unlock`） |
| 2 | `profession-commission` | `commissions.json` 同职业委托（当前每职业 T1–T6） | `commissionId` ∈ 96 单且**不属于** world-work | 委托收据 | C0–C5 |
| 3 | `errand` | `alternatives.js` 明码 offer（当前 `alt.courier`/`alt.records`） | `offerId` ∈ 内置 offer | `kind:'alternative'` 任务行 + `db.purchase` 流水 | C1–C2 |
| 4 | `rental` | `items.json.ships[].rental === true`（当前 `old-wing`） | `shipId` | 租机后的真实护航委托收据 | C1 |
| 5 | `market-material` | `items.json.materials[]` 固定价 | `itemId` | `db.purchase` 采购流水 | C2/C4 |
| 6 | `evidence-pair` | `story-evidence` 三条内置规则的任一分支所需 token | `evidencePair` 2–3 个真实 token | `claims[].receipt.evidence` 只读投影 | C2–C4 |

`[I]` mechanism → 锚点 kind 与 → `receiptSource` 的映射是**唯一**的，schema 文件 `constants.mechanismAnchorKind` / `constants.mechanismReceiptSource` 逐项冻结，测试逐项断言。

### 3.2 数据节点 `[I]`

替代叙事节点写在**新内容文件** `apps/arcade/career/content/world-narrative.json`（`schemaVersion:1`、`contentVersion:'0.18.0'`）的 `alternativeNarratives[]` 里；该文件由 T21/T22 创建，缺失时整段降级为空。节点形状冻结为 schema 文件的 `schemas.alternativeNarrativeNode`：

```
alternativeNarrativeNode
  sampleKind            : 'alternativeNarrativeNode'
  placeholder           : boolean        // true=占位样例，不得上线
  narrativeNodeId       : 'altn.<C1..C5>.<mechanism>.<slug>'  // 内部 id，不进玩家文本
  chapterId             : 'C1'..'C5'
  mechanism             : 6 值枚举（§3.1）
  anchor                : { kind: 'commission|offer|ship|item|evidencePair', refs: string[1..3] }
  npcRef                : { kind:'origin-letter', gameId } | { kind:'character', characterId }
  signatureFrom         : 'origin-letter|commission-issuer|offer-issuer|npc-character'
  gate                  : { requiresAcceptedProfession:true, requiresSpecificProfession:false,
                            requiresFlagsAny[], requiresFlagsAll[],
                            requiresCommissionsAll[], requiresEvidenceAny[] }
  texts                 : { offer, progress, receipt, next }   // 静态文案，非奖励
  receiptSource         : 4 值枚举（§3.1 映射）
```

冻结约束：

1. `gate.requiresSpecificProfession` **恒为 `false`**：主线替代叙事不得以"某个特定其他职业"为前置（产品契约 §主线可达性、验收 A08）。它只要求"玩家至少有一个已接受职业"，并可用真实旗标/委托/token 收窄。
2. `gate` 的四个数组只能填真实事实：flags 必须来自 `commissions.json.reward.flags`、`campaign.json` 的 `allFlags/anyFlags/rewardFlags`、`chapter-01.json.c1.signals` 之一；`requiresCommissionsAll` 必须是 96 个真实 `commissionId`；`requiresEvidenceAny` 必须能被至少一份真实委托 `reward.evidence` 产出。
3. `signatureFrom` 决定落款**从真实内容读**，与 `npcRef`（说话人）相互独立但来源必须自洽：`origin-letter` 读 `chapter-01.origins[gameId].c0Letter.from`（并要求 `npcRef` 是同一类起源信引用）；`commission-issuer` 读锚定委托的 `issuer`（世界通用工作也走这条，因为它们的 5 个 id 都是真实委托，`issuer` 为真实字段）；`offer-issuer` 读代办 offer 的 `issuer`；`npc-character` 读 `npc.json` 的 `name`（要求 `npcRef.kind === 'character'`）。**落款文本不得由作者手写**，否则会漂移成假人物。
4. `texts.receipt` 只能在 `receiptSource` 对应的**真实结算行已存在**时渲染；`texts.offer`/`progress` 不得出现任何数量、金额或"完成后得 X"的承诺。
5. 每个 `(chapterId, mechanism, anchor.refs)` 组合只允许一个节点；同一 `narrativeNodeId` 重复声明按内容加载顺序取第一条，其余丢弃并记 warning（不做"最后写入者胜"）。
6. 内容侧禁止键（fail-closed，镜像 `alternatives.js` 的 `TIMING_KEYS` 思路）：`reward/rewards/credits/items/price/cost/purchase/sell/grant/grants/evidence/flags/unlock/wait/cooldown/deadline/percent/total/score/currency`。schema 文件 `forbidden.contentKeys` 冻结该列表；唯一例外是交汇节点 schema 必填的 `grants` 对象，它必须逐项为零（见 §4.4），不得用来携带奖励。

### 3.3 resolver 冻结 `[I]`

新增纯函数模块 `apps/arcade/career/world-narrative.js`（UMD，浏览器 `window.ArcadeCareer.worldNarrative`，Node `module.exports`，与 `profession-view.js` 同约定；T22 实现，lead 串行接入 loader）：

```js
resolveWorldAlternatives({ chapterId, state, catalog, context }) -> {
  schemaVersion: 1,
  chapterId: 'C1'..'C5',
  nodes: [{
    narrativeNodeId, mechanism, anchor, npcRef, signatureFrom,
    available: boolean,
    reason: null | <§23.3 冻结 reason code>,
    texts: { offer, progress, receipt, next },
    receiptSource
  }],
  crossovers: [{                       // §4；与主线节点分开数组，互不参与排序
    eventId, pairId, npcRefs, texts: { invite, body, receipt, decline },
    receiptSource: 'narrative-event', maxShowsPerCareer: 1
  }]
}
```

冻结语义：

- **纯函数**：不读 DOM/DB/时钟/随机数，不修改入参，不抛异常（异常 → 空数组 + 结构化 reason）。调用方显式注入 `state`（§23.1 扩展快照）、`catalog`（真实内容）、`context`（§23.3 显式输入）。
- **输入只增不改**：`catalog.worldNarrative` 是新增可选键；`context` 复用 §23.3 已冻结的键（`surface/acceptedProfessionIds/activeProfessionId/worldFlags/clearedCommissions/storyEvidence/archived`）。不新增 context 键。
- **reason code 不新增**：逐节点 reason 只能取 §23.3 已冻结的 13 个码（`not-discovered/not-read/not-accepted/paused/wrong-surface/world-locked/story-locked/not-available/historical-only/archived/unknown-profession/unknown-commission/future-version`）。内容缺失、`professionVersion > 1`、封存一律返回空数组，不发明新码；reason code 只供测试/诊断，不渲染。
- **稳定排序**：`(chapterId, mechanismOrder 索引, anchor.refs 字典序, narrativeNodeId 字典序)`；同一输入永远同一输出。
- **可用性口径**：`available = 章节已到达（真实 chapter 旗标或当前章）× gate 满足 × 该机制真实前置成立 × 玩家有已接受职业`。`available:false` 的节点可带 reason 供诊断，但 adapter 不得渲染未满足节点（避免"待解锁"清单化）。
- **投影同步**：resolver 只读投影；UI 仍只经 `projectCareerView`/`careerView` 拿数据。adapter 必须在渲染前剥掉 `narrativeNodeId / anchor / reason`（与 §17、§23.3 的 reason-code 规则一致）。

### 3.4 字段归属：只读 vs 由真实结算产生 `[I]`

| 字段 | 归属 | 可否出现在玩家文本 | 说明 |
|---|---|---|---|
| `narrativeNodeId`, `anchor.refs`, `pairId` | 内容静态（只读） | 否 | 内部 id；adapter 剥除 |
| `chapterId`, `mechanism`, `npcRef`, `signatureFrom`, `receiptSource` | 内容静态（只读） | 仅 `npcRef`/落款解引用后的真实人名 | 人名只能来自 §2.1 的三类来源 |
| `gate.*` | 内容静态声明（只读） | 否 | 由 resolver 校验，不渲染原因 |
| `texts.*` | 内容静态（只读） | 是 | 非奖励文案；不得含数量/金额承诺 |
| `available`, `reason`, `gate` 满足度 | **运行时派生（不落盘）** | 否 | 每次投影重算，不写 state |
| credits / items / evidence / flags / quest status / claim receipt | **真实结算产生（唯一真源：career-db 行）** | 由既有 UI 决定 | 叙事节点**只能引用**，绝不写入；`texts.receipt` 依赖对应行存在 |
| `storyEvents[eventId] = {at, source}` | 真实结算产生（`RECORD_STORY_EVENT` 事务） | 否（只读回显） | 见 §5 |

`[I]` 任何叙事节点都不得携带 `reward`/`credits`/`items`/`flags` 字段。测试断言：schema 的 `forbidden.contentKeys` 与样例顶层键集不交集（交汇的 `grants` 是必填零值证明，逐项为零，见 §4.4），且样例不含经济写入口。

### 3.5 文本规则 `[I]`

- 玩家可见段落最多 2–3 短段，每段一句主动作；不用打字动画、不自动下一幕。
- 不得出现：系统话术（"系统检测到""恭喜解锁""必须完成"）、内部 id、reason code、证据 token（`E-/BP-/MAP-/DEC-`）、章节码（`C1.`–`C5.`）、委托后缀（`.T1`–`.T6`）、总数/百分比（`3/16`、`60%`）、完整路线攻略词（`第一步/第二步/依次前往/完整路线/通关攻略/必做/必经/唯一解/速通`）。
- 不得出现未接受职业的 `displayName`（防泄底）；交汇文本也不得替玩家预设"你是某职业"。
- 失败/中止只给真实下一步，不惩罚退出；`texts.next` 允许为空动作（"先回港口"）。
- 样例（`placeholder:true`）一律以"占位："开头，用于证明结构而非提供台词；T21/T22 上线前必须替换为真实文案并置 `placeholder:false`。

## 4. 可选职业交汇（crossover，冻结）

### 4.1 数据 `[I]`

交汇对写在 `world-narrative.json` 的 `crossoverPairs[]`，形状冻结为 schema 文件的 `schemas.crossoverPair`。核心字段：

```
eventId  = pairId = 'crossover:<minProfessionId>:<maxProfessionId>'   // 两段字典序升序
professionIds        : 2 个真实 professionId（升序、去重）
contentOwnerProfessionId : 本声明的作者职业（必须 ∈ professionIds 且是真实职业）
anchor.professionGames[2] : {professionId, gameId}（gameId 必须真实映射到该职业）
anchor.chapterIds[1..2]   : 'C1'..'C5'
anchor.npcRefs[1..2]      : §2.1 的三类真实引用
gate : {professionGate:'both-accepted', acceptedStates:['accepted','developed','completed'],
        pausedBlocks:false, requiresFlagsAny[], requiresFlagsAll[],
        requiresCommissionsAll[], requiresEvidenceAny[]}
texts: { invite, body, receipt, decline }
visibleSurfaces ⊆ 6 面；effects: []；grants 全零；touchesMainline:false；affectsIdentity:false
maxShowsPerCareer: 1
```

`[F]` 0.23 的 16 条 shard 已各自声明一条 `optionalCrossover`，折叠后是 **10 个不同 unordered pair**：其中 6 对各有两条独立声明（同对但作者不同），另 4 对只有一条声明。本 ADR 冻结：**同一对只产生一个事件**，作者声明保留、文本只取一个 owner（§4.5）。

### 4.2 触发条件（只用真实事实）`[I]`

一个交汇节点可见 ⇔ **全部**下列条件成立：

1. **双方都已主动接受**：`state.professionProgress[a].state` 与 `[b].state` 均 ∈ `{accepted, developed, completed}`。仅 `read` / `glimpsed` / `undiscovered` 不算；`paused` 不回退状态、也不阻塞（`pausedBlocks:false`，与 §23.1 正交语义一致）。
2. **章节在窗口内**：`context.worldFlags` 含 `anchor.chapterIds` 中任一章节的真实旗标（或当前章节已到达）。
3. **可选的真实前置**：`requiresFlagsAll ⊆ worldFlags`、`requiresFlagsAny ∩ worldFlags ≠ ∅`、`requiresCommissionsAll ⊆ clearedCommissions`、`requiresEvidenceAny ∩ storyEvidence ≠ ∅`；四者都为空表示"只要双方接受 + 章节到达"。
4. **surface 允许**：`visibleSurfaces` 交 `context.surface` 非空；`clue`/`letter`/`shop`/`crafting`/`tools`/`work` 一律禁止（见 §4.3）。
5. **未封存、非未来版本**：`archived === true` 或 `professionVersion > 1` → 不产出。

禁止作为触发条件的东西（冻结）：新计数器、好感度、概率、真实冷却、上线时间、签到、收藏率、"未读总数"、任何以未接受职业为条件的判断。

### 4.3 未接受绝不透露（四层防线）`[I]`

1. **内容层**：交汇节点只声明 id，不含职业展示名、线索、委托标题、章节名；`texts` 不得包含对方 `displayName`（测试对 16 个真实 `displayName` 逐个扫描样例字符串）。
2. **resolver 层**：不满足 §4.2 时**不产出节点**（数组里没有条目），不返回 `disabled`/`locked`/占位对象；`crossovers` 数组上限 = 实际满足的对数。
3. **投影层**：交汇只走 `port/journal/message/receipt/toast/deep-link` 六个面；`clue`/`letter` 面永不出现（邀请阶段不得泄底）。深链/旧 URL 也必须先跑同一 gate（§23.4 既有规则）。
4. **渲染层**：adapter 剥掉 `eventId/pairId`，不渲染"另一个人是谁"之外的职业信息；未接受一侧连"存在某项交汇"都不可提示。

`[I]` 副作用边界：交汇**不得**进入 route-planner 候选、推荐集合、工作栏、材料来源、商店、人物图鉴、空状态与 toast 的"待办"语义；它只出现在"眼下/经历/消息/回执"里，且可被玩家直接忽略。

### 4.4 产出边界 `[I]`

- 产出 = **一个叙事事件**（`crossover:` 事件，见 §5）+ **可选回执文本**（`ReceiptCard` 的 `npcReply` 或 `JournalTimeline` 的一行）。二者都只是文本，不触发任何事务性奖励。
- `effects: []`、`grants.credits:0`、`grants.items:{}`、`grants.evidence:[]`、`grants.flags:[]` 是 schema 硬约束（`additionalProperties:false` + `const`），测试逐项断言。
- **不改主线唯一解**：不写 `campaign.json` 的 `rewardFlags`/`requires`，不产生 `story-evidence` 判定 token，不改变已到达章节、终局 `entry.allFlags`、已解锁委托。测试断言：样例的 `requiresEvidenceAny`/`requiresCommissionsAll` 只能引用**已存在**的 token/委托，且 `effects` 为空。
- **终局后允许一句后日常**：`context` 已有终局旗标时，交汇只能复用 `receipt` 一句，不得改写已经展示过的结局正文或 `epilogue`。
- 每次交汇最多 1 次进经历、每档 `maxShowsPerCareer:1`；重复触发是 no-op（见 §4.5）。

### 4.5 去重与幂等（冻结）`[I]`

**A. 内容层（同一对只留一个 owner）**

1. `eventId = 'crossover:' + [a,b].sort().join(':')`，两段均为真实 professionId（当前真实 id 只含 `.` 与字母，故 `:` 分隔无歧义；整串必须匹配 §5.2 的 eventId 语法，长度 ≤ 120）。
2. 同一 `eventId` 的多条声明（当前 16 条 → 10 对）按下列**唯一**规则选 owner：
   - ① owner 的 `contentOwnerProfessionId === minProfessionId` 者优先；
   - ② 否则 owner 的 `contentOwnerProfessionId` 字典序最小者胜；
   - ③ 仍并列（不可能，除非重复声明同一职业）取内容文件声明顺序第一条，其余丢弃并记 warning。
3. 同一对的全部声明**必须携带完全相同的 `texts`/`anchor`/`gate`**；不一致判内容非法（fail-closed，不"取并集"）。
4. 内容加载器把结果整理成 `Map<eventId, pair>`；resolver 只遍历该 Map，故结构性不会产出重复事件。

**B. 状态层（写一次）**

1. 唯一写入路径：`career-db.applyProfessionEvent({action:'RECORD_STORY_EVENT', input:{eventId, source:'world', at}})`，同一事务内 `assertCareerWritable` + `generation` 守卫；不新开写口。
2. 重复写入：`profession-state.recordStoryEvent` 返回 `{ok:true, duplicate:true}`，**不改** `at`、不改文案、不重放消息；调用方把 duplicate 视为成功（不显示第二次回执）。
3. 交汇写入保留 `narrativeCursor`。首到港仍只由玩家成功接下起源职业委托或世界工作消费。
4. 失败：事务回滚、UI 不显示成功；重试安全（幂等）。
5. 跨标签：写成功后重新读快照再渲染；另一标签的 `onCareerDataChanged` 只触发一次重投影，不重复写。

**C. 渲染层（不多话）**

1. `maxShowsPerCareer:1`（持久事件已存在则不再主动弹）。
2. `sessionEchoMax:1`：同一会话内最多在 `port`/`receipt` 回显一次，其余只进经历。
3. 经历列表按 §5.5 排序，一条事件一行，不显示"已解锁 n 条"。

**D. 重试与并发**

- 网络/DB 失败：`retry.policy = idempotent-retry`，`duplicateIsSuccess = true`，不允许部分写入（`partialWriteAllowed:false`）。
- 同一 tick 多次触发（例如连续两张回执）：先写先赢，后到者返回 duplicate；UI 只渲染第一次成功。

### 4.6 覆盖矩阵（16 职业 × 1 交汇样例）`[I]`

schema 文件的 `samples.crossover` 覆盖真实 registry 的 16 个职业各 1 条声明，折叠后 10 个不同 pair。矩阵（`pairId` 升序、owner 标记 ★）：

| pairId（升序） | 声明者（16） | 章节窗口 | 锚定游戏 | 真实前置（样例） |
|---|---|---|---|---|
| `crossover:adventure.pilot:research.gravity` | ★adventure.pilot / research.gravity | C3 | star-raid / gravity-flip | `requiresFlagsAny:[C3.truth_found]` |
| `crossover:adventure.relicseeker:research.archivist` | ★adventure.relicseeker | C3 | shadow-leap / memory-flip | `requiresFlagsAny:[C3.truth_found]` |
| `crossover:engineering.demolition:engineering.structural` | ★engineering.demolition / engineering.structural | C4 | brick-breaker / pendulum-tower | `requiresFlagsAny:[C4.city_power_restored]` + `requiresEvidenceAny:[E-mole-whack.T3]` |
| `crossover:engineering.dispatcher:engineering.driver` | ★engineering.dispatcher / engineering.driver | C1 | solitaire / road-rush | `requiresFlagsAny:[C1.signal_fragment]` |
| `crossover:engineering.maintenance:engineering.warehouse` | ★engineering.maintenance / engineering.warehouse | C4 | mole-whack / block-drop | `requiresFlagsAny:[C4.city_power_restored]` |
| `crossover:intel.risk:intel.tactics` | ★intel.risk | C1–C2 | blackjack / gomoku | `requiresFlagsAny:[C1.signal_fragment]` |
| `crossover:intel.tactics:research.archivist` | ★intel.tactics | C2 | gomoku / memory-flip | `requiresFlagsAny:[C2.research_complete]` |
| `crossover:nature.ecologist:nature.snowscout` | ★nature.ecologist / nature.snowscout | C2 | snake-run / snowbells | `requiresFlagsAny:[C2.research_complete]` |
| `crossover:nature.miner:research.lattice` | ★nature.miner | C2 | gold-miner / merge-2048 | `requiresFlagsAny:[C2.research_complete]` + `requiresCommissionsAll:[gold-miner.T1]` |
| `crossover:research.archivist:research.lattice` | ★research.archivist / research.lattice | C2 | memory-flip / merge-2048 | `requiresFlagsAny:[C2.research_complete]` |

`[I]` 该矩阵只证明**结构与真实引用自洽**；具体台词、人物口吻与章节贴合度由 T22 编写并由其自身门禁复核。样例文案全部为"占位："说明，禁止直接上线。

## 5. 历史事件 schema（玩家"经历"，冻结）

### 5.1 持久化形状：不新增字段 `[I]`

`[F]` 现有形状 `state['discovery'].value.storyEvents[eventId] = {at, source}`，`at` 为合法 ISO-8601 或 `null`，`source` 为字符串。0.24 **保持该形状**：

- 冻结 `persistedFields = ['at','source']`；禁止新增 `label/text/title/professionId/commissionId/credits/items/percent` 等持久字段。
- **玩家可见文案不落盘**：`label` 在投影时由内容白名单解析（§5.3）。这样新事件不需要迁移、不需要写版本，也不会把文案冻结进旧档。
- `at` 必须是合法 ISO；坏字符串不升级、不排序证据（沿用 `profession-state` 的 `iso()` 规则）。

### 5.2 eventId 语法与命名空间 `[I]`

语法与 `profession-state.js:38` 的 `EVENT_ID_RE` **逐字一致**：`^[a-z][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$`（≤120 字符；name 部分允许字母/数字/`.`/`:`/`-`，**不允许** `_`、`+`、`~`）。

| namespace | 可写 | 含义 | 允许 source | label 来源 |
|---|---|---|---|---|
| `story` | 是 | 主线叙事节点（引擎已有语义） | `story` / `clue` | 代码冻结或内容白名单 |
| `world` | 是 | 世界替代路线推进（含代办、世界通用工作、材料退路、证据合成） | `world` / `commission` | 内容白名单 |
| `crossover` | 是 | 可选职业交汇（§4） | `world` | 内容白名单 |
| `invitation` | 否（引擎只读） | 接受邀请事实（§23 已定义前缀语义） | `story` | 职业展示名（引擎拼装） |
| `commission` | 否（引擎只读） | 真实委托结算事实 | `commission` | 真实委托标题（引擎拼装） |

`[I]` 命名空间白名单是**闭集**：未列出的 namespace 既不写入也不显示，但**必须保留**（不删除、不改写）。示例 id：

- `world:C2.errand.alt-courier`（代办 → `source:'commission'`）
- `crossover:research.archivist:research.lattice`（交汇 → `source:'world'`）
- `commission:memory-flip.T2`（引擎前缀 → `source:'commission'`）

### 5.3 可见性白名单 `[I]`

玩家"经历"只显示满足下列**任一**层的事件，且必须通过 surface 与状态门：

| 层 | 真实实现 | 0.24 用法 |
|---|---|---|
| `code-frozen` | `profession-view.js:43-45` 的常量（当前仅 `story:C0.port_seen`） | 只读；**0.24 不修改该常量** |
| `content-catalog` | `catalog.publicStoryEventIds` + `catalog.publicStoryEvents[id].label`（`:477-490`） | 0.24 白名单主通道；由 `world-narrative.json.journalWhitelist` 注入 |
| `content-context` | `context.publicStoryEventIds` + `context.publicStoryLabels`（`:480-490`） | UI 侧已投影白名单（经历页专用） |
| `engine-prefix` | `invitation:`→`canRevealProfession`、`commission:`→`canShowCommission`（`:500-535`） | 沿用既有 gate，未接受职业不出现 |

冻结规则：

1. **默认拒绝**：不在白名单 → `safeStoryEvent()` 返回 `null`，该行**不存在**于 `story.history`（不是空占位、不是 `display:none`）。
2. **未接受职业不显示**：`invitation:<未接受>` 被 gate 拒绝；`crossover:` 只有在 §4.2 全条件成立时才进白名单（resolver 不产出 → 白名单也不含），从而实现"未接受绝不透露"。
3. **只读面**：`surfaces = port|journal|receipt|message|toast|deep-link`；`work`/`shop`/`crafting`/`tools`/`clue`/`letter` 不渲染经历行。
4. **不显示总数**：不显示"共 n 条"、百分比、未发生项、"还差 n 条"；`JournalTimeline` 只按 DOM 顺序渲染已发生事实（`ADR-0.23-ui.md` §4.11）。
5. **reason code 不进文本**：`safeStoryEvent` 的 reason 只在测试/诊断可见。

### 5.4 玩家文本规则 `[I]`

- `label` 6–40 汉字、≤60 字符；单行、第二人称或中性叙述，不用系统话术。
- 禁止：内部 id（eventId / commissionId / offerId / narrativeNodeId）、reason code、证据 token 前缀、章节码 `C1.`–`C5.`、委托后缀 `.T1`–`.T6`、数字进度（`3/16`、`60%`）、未发现/未接受职业的展示名、完整路线攻略词。
- 落款/人物只显示真实人名（§2.1），不显示角色内部 `characterId`。
- 同一条事件的 `label` 必须是内容里的**静态字符串**（同一 eventId 永远同一文案）；需要随状态变化的措辞由 resolver 选择不同 eventId，而不是改写同一条。

### 5.5 排序 `[I]`

沿用 `storyHistory()`（`profession-view.js:546-563`）的既有比较器，冻结为：

1. 先按 `eventId` 字典序（读取顺序，仅影响稳定性，不影响展示）；
2. 展示按 `at` **升序**；`at` 为 `null`/空串视为空串 → 排最前（既有行为，不改）；
3. `at` 相同时按 `label` 字典序，再按 `kind`（`invitation|commission|story`）。
4. **DOM 顺序即真实时间顺序**；新增写入必须给合法 ISO `at`，因此空 `at` 只可能来自旧档。

### 5.6 迁移规则 `[I]`

- **只追加**：0.24 不重写任何既有 `storyEvents` 行，不补 `label`，不补 `source`，不为旧档"猜测"新增事件。
- 旧档无 `storyEvents` → 空历史；`storyEvents` 非对象 → 按空对象修复（`normalizeExtension` 既有行为）。
- 未知 namespace / 未知 eventId → **保留并隐藏**；任何读取路径都不得删除它们。
- `professionVersion > 1`（未来档）→ 投影返回空视图（`future-version`），只读、不回写、不降级；普通街机不受影响。
- 封存/导入/重置/备份：沿用 §22 与 §23.2 语义；`storyEvents` 随 `state/discovery` 行整体处理，不新增迁移步骤、不新增 store、不新增 key。
- 迁移测试要求（T23 提交）：新档、旧档无字段、旧档坏字段、未知 namespace、未来版本、重复导入、封存往返、重置后无残留事件。

### 5.7 上限与淘汰 `[I]`

- 全局上限沿用 `MAX_STORY_EVENTS = 256`。规整旧档和追加记录共用同一规则，优先按 key 字典序淘汰普通记录，最后才处理 `source:'world'` 的交汇记录。
- 软预算为 `200`。每个 eventId 只占一个槽位，当前内容最多有十个交汇，旧档接近上限时仍可保留这些记录作为跨页去重凭据。若导入数据已占满优先保留槽位且新事件无法保存，写入返回失败，港口可在下次打开重试。
- 淘汰只作用于经历，保留职业接受、委托结算、章节旗标与钱包等事实。

## 6. 0.24 与 0.23 的兼容边界（冻结）

| 维度 | 冻结结论 | 依据 |
|---|---|---|
| IndexedDB | 不新增 store、不改 IDB 版本（仍 v1、11 stores）；`storyEvents` 写在既有 `state/discovery` 行 | §23.1、§23.2、§22 |
| localStorage | 不新增 key，不改任何经典 key | §23、§22.3 |
| 内容版本 | `contentVersion` 仍 `0.18.0`；新增内容文件自带 `contentVersion:'0.18.0'` 与 `schemaVersion:1` | `registry.json`/`world-work.json`/shard 现状 |
| 状态版本 | `professionVersion` 仍 `1`；不新增扩展字段 | §23.1 |
| 规则/经济 | `rulesetVersion` 不变；不新增 reason code；不新增货币/材料/证据/旗标 | `alternatives.js`/`story-evidence.js`/§23.3 |
| 旧档读取 | **只追加**：读旧档不改既有值；写新事件才追加一行；坏档只修扩展字段 | §23.1、§5.6 |
| 0.23 UI | 组件 props 与 token 不变；`JournalTimeline` 仍只吃 `{id?,label,at?,source?}` | `ADR-0.23-ui.md` §4.11 |
| 降级 | 新内容文件缺失/损坏/`professionVersion>1`/封存 → 交汇 `[]`、替代叙事 `[]`、经历仅代码冻结白名单；0.23 路径完全可用 | 既有 loader 降级约定 |
| 版本链 | T20 不改 `ARCADE_VERSION`/SW/README/CHANGELOG；由 T25 收口 | 任务所有权 |
| 回滚 | 删除 `content/world-narrative.json` 并回退 loader 即回到 0.23；事件行是惰性字符串，残留不会破坏 0.23 | 本 ADR |

## 7. 留给 T21–T23 的实现边界与接口请求

### 7.1 写面划分（不重叠）`[I]`

| 任务 | 唯一可写 | 禁止触碰 | 交付 |
|---|---|---|---|
| T21 主线深度 | `career/content/world-work.json`（仅文案/条目，不新增委托）、`career/route-planner.js`、`career/campaign-core.js`、T21 专属测试 | 交汇 resolver、经历 UI、bridge、DB、版本链 | 替代路线在戏内成立；全起源路径仍可达；资源不凭空生成 |
| T22 交汇数据 + 纯 resolver | 新增 `career/content/world-narrative.json`（`alternativeNarratives`/`crossoverPairs`/`journalWhitelist`）、新增 `career/world-narrative.js`、T22 专属测试 | UI、bridge、DB、`narrative-shards/*`、0.23 内容、版本链 | 按本 ADR 的 schema；双边接受；未接受零透露；去重/幂等；文案 `placeholder:false` |
| T23 经历与人物反馈 | `career/ui/world-state.js`、`career/ui/receipt.js`（经历/回执呈现）、T23 专属测试 | resolver、DB、bridge schema、0.23 组件 API、token | 真实历史回读、无总数、无内部 id、迁移覆盖 |
| lead（串行） | `career/bridge.js`（loader/`careerView` 注入白名单）、`career/registry.js` 公共映射、gate 注册、版本链 | 覆盖 worker 未提交改动 | 见 §7.2 |

### 7.2 交给 lead 的接口请求（逐项、可验收）

1. **loader**：按 0.22/0.23 既有按需加载模式接入 `career/world-narrative.js` 与同源 `career/content/world-narrative.json`；缺失/解析失败 → `window.ArcadeCareer.worldNarrative` 为空实现，`careerView` 不报错。**不得**在普通游戏首屏加载（保持零生涯首屏）。
2. **catalog 注入**：`projectCareerView({catalog})` 增加可选键 `worldNarrative`（内容对象）、并继续支持既有 `publicStoryEventIds`/`publicStoryEvents`；把 `world-narrative.json.journalWhitelist[].eventId` 合成 `publicStoryEventIds`、把 `{eventId→label}` 合成 `publicStoryEvents`。**不改** `PUBLIC_STORY_EVENTS` 常量。
3. **context 注入**：`career-view` 的 `context` 继续只传 §23.3 冻结键；由 bridge 把 DB 只读快照（`clearedCommissions`/`storyEvidence`/`worldFlags`/`acceptedProfessionIds`）喂入。若需要"章节已到达"，用既有 `worldFlags` 表达，**不新增** context 键。
4. **写入门面**：交汇首次展示成功后，由 bridge 调 `db.applyProfessionEvent({action:'RECORD_STORY_EVENT', input:{eventId, source:'world', at}})`；只在 `ok===true` 后渲染回执；`duplicate:true` 视为成功且不再弹。**不新增** bridge 方法名（复用既有 `applyProfessionEvent` 门面），若确需薄封装，命名限定为 `recordWorldNarrativeEvent`。
5. **gate 注册**：把 `node tools/career_world_narrative_contract_test.mjs` 注册进 `tools/arcade_run_all_gates.py` 的纯 Node 段（T20 不自行登记，避免与 lead 的 gate 台账冲突）。
6. **§24 收口**：若要把本 ADR 并入 `ADR-interfaces.md`，由 lead 在 T25 追加 §24 并回链本文；T20 未改该文件。

### 7.3 验收映射（0.24 目标）

| 验收 ID | 本 ADR 的支撑点 |
|---|---|
| A03 未接受职业无任务泄漏 | §4.3 四层防线；§5.3 默认拒绝；测试断言未接受→0 节点 |
| A05 阅读不接受、接受不暗中接单 | §4.4 交汇不接单、不发奖；`effects:[]` 硬约束 |
| A07 忽略/搁置不阻塞 | §4.2 `pausedBlocks:false`；交汇可忽略且不留待办 |
| A08 每起源有可行完整主线 | §3.1 六机制全复用既有路径；`requiresSpecificProfession:false` 禁止跨职业唯一解 |
| A09 第二职业不重复身份/奖励 | §4.4 `affectsIdentity:false`、`grants` 全零 |
| A13 无总数/占位/攻略/未知奖励 | §3.5、§5.4 文本规则；测试扫描禁用词与真实 `displayName` |
| A14 离线/刷新/恢复 | §5.6 只追加、幂等写入、降级路径 |
| 0.24 新增：交汇双边接受 | §4.2 条件 1；测试用状态组合断言（双方接受 / read / 未发现 / completed / paused / future / archived / 面过滤 / 旗标 / 委托 / 证据） |
| 0.24 新增：历史事件可回读 | §5.1–§5.7；T23 迁移矩阵 |

### 7.4 未决与风险（不阻塞 T21–T23 开工）

1. `[U]` 交汇"回执文本"具体挂在 `ReceiptCard.npcReply` 还是 `JournalTimeline` 一行，由 T23 在 0.23 组件契约内二选一；两者都不新增 props。本 ADR 不指定。
2. `[U]` 16 条 shard 已写的 `optionalCrossover.text` 与 T22 新 schema 的 `texts` 可能是两份文案；**冻结**：以 `world-narrative.json` 为唯一运行时来源，shard 里的旧字段保持只读、T22 不删除（避免改 0.23 已发布内容），由 lead 在 T25 决定是否清理。
3. `[U]` 是否在"经历"里给 `world:` 事件加"回看原文"由 T23 决定；任何回看都只能读内容静态 `texts`，不得重放结算。
4. `[U]` 浏览器、真机、PWA、release、full、watch 与 push 全部未执行；本 ADR 的结论仅覆盖契约与纯逻辑数据层。

## 8. 证据边界

- 本任务实际运行：`node tools/career_world_narrative_contract_test.mjs`（纯 Node、零依赖、不启浏览器、不写仓库，158/158 通过、退出码 0，重复运行结果一致）、`node --check` 语法检查，以及只读的 `py -3 tools/validate_site.py`（PASS）。未运行 `build_site.py`、arcade smoke、release、full、watch 与任何浏览器/真机路径。
- 本文所有 `[F]` 断言都可在 §2 引用的文件里逐条核对；所有 `[I]` 断言由 schema 文件与契约测试机械可验；`[U]` 项在 T21–T25 验证前保持 UNVERIFIED。
- 未 push、未打 tag、未创建 release、未部署；0.23.0 为本地 `GATE_PASSED / RELEASE_READY`（未发布），0.24.0 同口径收口。

## 9. T24 增补：世界叙事可见化（加性、向后兼容）

本节记录 T24 在**不改变 §1–§8 冻结语义**前提下落地的三处接线；实现与契约测试同源，无新增 store / localStorage key / contentVersion / 版本链。

### 9.1 经历回读 `text` / `person`（加性字段）

- `journalEvent` 增加两个**可选**字段（不进 `required`）：
  - `text`：`string`，8–120 字符；玩家可见的静态回读文本，不落盘。
  - `person`：`string`，≤24 字符；真实签名人 / 签发人，取自 0.23 叙事 shard 的 `npc` 或 `chapter-01.json` 的 `c0Letter.from` 或 `npc.json` 角色名。
- 注入链：`world-narrative.json.journalWhitelist[]` → bridge `careerCatalog().publicStoryEvents[eventId] = {label,text,person}` → `profession-view.publicStoryRow()` 生成 `story.history[].detail{text,person}` → T23 `ui/journal.js` 只读展开。
- 落盘形状不变：`storyEvents[eventId]` 仍只有 `at` / `source`；旧内容缺 `text/person` 时经历行与 0.23 完全一致（无 `detail`）。
- resolver 的 `normalizeJournalEntry` 对 `text/person` 只做类型/长度透传，未知键仍然 fail-closed。

### 9.2 `catalog.worldChapterAlternatives`（bridge 按章懒注入）

命名与形状（T24 冻结）：

```json
{
  "worldChapterAlternatives": {
    "C1": [ { "narrativeNodeId": "...", "mechanism": "...", "anchor": {...}, "npcRef": {...},
              "signatureFrom": "...", "available": true, "reason": null,
              "texts": { "offer": "...", "progress": "...", "receipt": "...", "next": "..." },
              "receiptSource": "commission-receipt" } ],
    "C2": [], "C3": [], "C4": [], "C5": []
  }
}
```

- 每个数组是 T22 `resolveWorldAlternatives({chapterId})` 的 `nodes`，`surface` 固定 `route`；bridge 只在内容、resolver 模块、真实事实快照三者齐备时计算一次并按事实快照身份缓存，任何缺失都**不注入该键**。
- `catalog.worldNarrative` 保持原始内容对象不变（供 resolver 使用）；两者并存、互不改写。
- `route-planner.readWorldChapterAlternativesInput()` 接受该形状（也接受 `{chapters:{C1:[...]}}`），节点校验与 resolver 输出同一套；`chapterAlternatives()` 在 `catalog.worldNarrative` 无可用节点时才读它，缺失时与 0.23 逐字节同形。
- 不写库、不发奖、不新增 reason code；内部 `anchor/npcRef/reason/narrativeNodeId` 只保留在只读结果里，UI 负责剥除。

### 9.3 UI 落点

- `ui/world-state.js` 章节面板：章节行只加性渲染 `chapter.prerequisite.text`、`chapter.completion.text` 与当前章 `guide.chapters[].alternatives[].texts.{offer,next}`；无数据不建节点。
- `ui/town.js` 港口经历页（journal tab）：顶部只读章节说明复用同一公开字段；`town.js` 旧版 legacy 面板同步保留同一渲染。
- `ui/town.js` 以及 `ui/world-state.js` 只消费公开文本，`requirement/tokens/anchor/narrativeNodeId/mechanism` 不进入 DOM；不新增总数/百分比/进度压力文案；无数据时 DOM 与 0.23 完全一致。
- `sw.js` 预缓存清单追加 `./career/content/world-narrative.json`；**不改** `VERSION` / 缓存键（版本链属 T25）。

### 9.4 T24 证据

- `node tools/career_world_narrative_contract_test.mjs`：166/166，含 17 条白名单真实 `text/person` 的 schema / 长度 / 卫生 / 真实签名人断言。
- `node tools/career_world_narrative_test.mjs`：177/177，含 bridge 同形注入后真实 `projectCareerView` 的 `detail.text/person`、旧内容零 `detail`、注入形状被真实 route-planner 消费。
- `node tools/career_journal_experience_test.mjs`：59/59，含有数据渲染 / 无数据零差异 / 内部字段不泄漏。
- 其余必跑纯 Node gate 与 `py -3 tools/validate_site.py` 见交付报告；未启动 Chrome，未 push，未发布。

## 10. 复查修正（0.24.0 候选，2026-11-28）

本节记录候选复审确认的缺口及其修正。§1–§9 的冻结语义不变，只把原先没有写入方、或写入方没有校验的地方补齐。

### 10.1 交汇写入与展示（修订 §4.5）

- `bridge.recordWorldNarrativeEvent()` 只接受 `crossover:` 事件，写入前用同一 resolver 与当前真实事实复核该对仍然可披露，并沿用发起时的 `discovery-generation`；封存、代次变化或复核不通过都不写。
- 写入后必须重读并确认该行已在 `storyEvents` 里，才向调用方返回成功。UI 只在成功后渲染交汇；数据库拒绝或事务未提交时港口不显示、经历不增加，下次打开可重试。
- 两个标签页同时打开港口时，先提交的面板展示一次，后提交的拿到 duplicate 后只刷新经历。成功写入或拿到 duplicate 后，同一港口实例的经历页会重新读取。
- 港口「眼下」只在已有章节时附加替代指引；`texts.progress` 不再作为「下一步」提示渲染。

### 10.2 经历行与两位参与职业（修订 §5.3、§9.1）

- `crossover:<a>:<b>` 的经历行带 `professionIds:[a,b]`，只在两位职业都已接受、`source` 为 `world`、且 `a < b` 时进入 `port/journal/message/receipt/toast/deep-link`。导入的经历行不能替代任何一方的接受事实。
- `ui/journal.js` 的「按职业筛选」按 `professionIds` 匹配：筛任意一位参与职业都保留同一条交汇。
- 白名单行若声明 `surfaces`、`source` 或 `professionId`，投影按声明收紧；未声明时与 0.23 / §9.1 一致。bridge 原样转发这三个字段，职业委托类经历的职业关联取自正式委托目录。

### 10.3 替代经历从真实记录推导（`world:*` 写入方）

- `world-narrative.deriveJournalEvents({state, catalog, context, records})` 是只读纯函数：节点在当前事实下可达，且有带合法时间的真实记录时才产出 `{eventId, at, source}`。委托与世界通用工作读 `quests` 的 `commission` 行，代办读 `alternative` 行（`source:'commission'`），证据组合要求各证据都已清并取较晚时间，商店材料读该材料最早一次真实采购流水。
- 经历 ID 统一为 `world:` + 替代节点 ID 去掉 `altn.`。代办一条的白名单 ID 原写作 `world:C2.errand.alt.courier`，与节点 `altn.C2.errand.alt-courier` 不一致，已改为 `world:C2.errand.alt-courier`；契约测试断言每条替代节点都有同 ID 的白名单行。
- bridge 只在 `journal` 面调用它，结果只进入当次投影：不改写、不落盘任何 `storyEvents` 行，是否显示仍由内容白名单与投影 gate 决定。结算后真实事实缓存失效，下一次投影重读。
- 免费租机不留任何持久记录，`world:C1.rental.old-wing` 仍没有写入方，保持不可达；不为它新增结算写入。

### 10.4 上限与叙事游标（修订 §4.5 第 3 条、§5.7）

- 交汇与世界经历的写入不再改写 `narrativeCursor`，首次到港仍只由真实接单消费。
- 规整旧档与追加记录共用同一淘汰规则：先按 key 字典序淘汰普通记录，`source:'world'` 的交汇记录最后处理；保留槽位已满且新事件无法保存时写入返回失败，由调用方重试。schema 的 `cursorEffect` / `eviction` 常量同步更新。
