# ADR-0001 Arcade Life 运行时接口冻结（0.15–0.18）

- 状态：Accepted（B02，0.15 起生效）
- 日期：2026-11-22
- 适用：`apps/arcade/` 下新增的 `career/` 运行时与 16 款游戏页的只读适配
- 约束来源：仓库 `AGENTS.md`、`docs/BASELINE.md`；外部开发包的《产品不可变量》《隐藏发现》《架构与数据》《扩展契约 V1.1》
- 面向读者：实现 Worker、独立 Reviewer、后续版本维护者

本 ADR 只冻结**接口与数据契约**，不记录剧情路线、谜底、阈值答案与策划文案。运行时内容放在 `apps/arcade/career/content/*.json`，由内容任务维护；公开文档与提交信息不得复述其解谜含义。

## 1. 背景与不可破坏边界

0.15 的目标是：**没有显眼的“生涯模式”入口**，16 款游戏都能通过各自真实的有效游玩事件被动产生一条不剧透线索；玩家主动追踪后才逐步进入世界；**任何观察都不发放货币或材料**。

本 ADR 冻结以下边界，后续实现不得突破：

1. `apps/arcade/engine.js` 的既有存储 key / Schema / 玩法逻辑不改；经典、挑战（78 关）、禅模式、星海割草、星海经典星币与机库全部保持原样。
2. 新运行时只允许放在 `apps/arcade/career/`；游戏页只允许按第 14 节的最小适配契约加脚本标签与事件调用。
3. 游戏页（DOM）**永远不能**提交余额、材料、奖励金额或自定义 `txId`。货币与物品只由 `career-core` 依据内容定义和真实事件计算，由 `career-db` 原子提交。
4. 不引入 npm / 打包器 / 框架 / CDN / 远程字体 / 后端 / 遥测；纯静态、离线优先。
5. 生涯数据与经典数据物理隔离：生涯使用独立 IndexedDB；不得写 `studiokit:arcade:meta:v1` 或 `studiokit:arcade:runs:v1`。
6. 新代码不得要求先完成某款游戏、也不得把“16 / 6 / 96 / 六章”写成运行时上限；注册表必须数据驱动（见第 6 节与第 15 节）。
7. 生涯模块任何异常都 **fail-open**：经典游戏与原有记录不受影响；不能因为生涯报错阻塞游戏结算。

## 2. 文件与加载顺序

```
apps/arcade/career/
  registry.js            数据驱动注册表（纯函数，可在 Node 直接 require）
  discovery.js           发现状态机与线索判定（纯函数）
  career-core.js         经济/领奖/故事谓词等纯逻辑（无 DOM、无 IDB）
  career-db.js           IndexedDB 事务层（浏览器）
  bridge.js              游戏页引导：定义 window.ArcadeCareer、装载依赖、缓冲事件
  router.js              gameId / 基路径 / 内容 URL 解析
  content/clues.json     0.15 线索内容（运行时内容）
  content/registry.json  游戏清单 / 职业 / 委托 / 故事节点（按版本扩展）
  ui/clue-surface.js     结算处微线索（0.15）
  ui/clue-surface.css
  ui/mailbox.js          旧港信箱 / 信件（0.15）
  ui/settings.js         线索偏好开关（0.15）
  ui/town.js             城镇告示板（0.16）
  ui/hangar.js           机库 / 飞船（0.16）
  ui/receipt.js          收据 / 钱包（0.16）
  ui/market.js           商店（0.17）
  ui/workshop.js         工作台（0.17）
  entry-router.js        16 源归一化入口（0.15）
  backup.js              生涯独立备份 / 迁移（0.15）
  star-combat-config.js  机体参数提纯（0.16）
  commission-core.js     委托生命周期（0.16）
  rental.js              租机（0.16）
  alternatives.js        非战斗替代路径（0.16）
  materials.js           五材（0.17）
  professions.js         职业（0.17）
  story-evidence.js      章级证据（0.17）
  crafting.js            制造（0.17）
```

- 纯函数模块（`registry.js`、`discovery.js`、`career-core.js`、`router.js` 的纯函数部分）必须同时满足：浏览器中挂到 `window.ArcadeCareer`；Node 中可 `require()`（文件末尾 `if (typeof module !== 'undefined' && module.exports) module.exports = api;`）。
- B02 的落盘面（经主控批准的任务面扩展，登记在仓库外 `variance.md`）：`docs/arcade-life/ADR-interfaces.md`、`apps/arcade/career/registry.js`、`apps/arcade/career/content/registry.json`、`tools/career_registry_test.mjs`。其余文件所有权见开发任务 DAG。
- 浏览器中只用普通 `<script>`（非 ES Module），保持 `file://` 下“原游戏可玩”的既有兼容。
- **游戏页只加载一个入口脚本**：`<script src="../career/bridge.js"></script>`。`bridge.js` 同步定义 `window.ArcadeCareer` 后异步串行装载 `router.js → registry.js → discovery.js → career-core.js → career-db.js → ui/*`，再 `fetch` 对应 content JSON。
- 依赖装载失败、`fetch` 失败、IndexedDB 不可用（含 `file://`）时：`ArcadeCareer.available` 为 `false`；`observe` 仍可安全调用（只进内存），`finish` 静默返回 `null`；页面不出现任何生涯 UI；经典结算照常。
- 生命周期：`bridge.js` 在 `DOMContentLoaded` 前完成同步绑定；内容装载在后台进行；游戏结算时若装载未完成，`finish()` 会等待 `ready` Promise（带超时），超时则放弃并保持经典体验。

## 3. 事件模型

### 3.1 观察事件（经典/挑战/禅/割草只读）

游戏页在**真实模拟状态提交之后**调用：

```js
window.ArcadeCareer.observe('pair.match', { board: 4, pairs: 3 });
```

- 第一个参数 `kind`：注册表 `watch` 声明过的点分事件名（如 `tower.floor_stable`）。未声明的事件被丢弃。
- 第二个参数 `payload`：只允许普通 JSON 原始值（string/number/boolean，扁平对象，≤2 KB）；不得含 DOM 节点、函数、金额、`txId`、`careerId`。
- `bridge` 负责补齐信封字段，游戏不得自行提供 `eventId`、`runId`、`careerRunId`、`sourceMode`：

```json
{
  "schemaVersion": 1,
  "eventId": "<runId>:<seq>",
  "runId": "<uuid>",
  "careerRunId": null,
  "gameId": "pendulum-tower",
  "kind": "tower.floor_stable",
  "stage": "run",
  "seq": 4,
  "payload": { "floor": 6 },
  "sourceMode": "classic"
}
```

- `stage` 取值：`"run"`（局内真实状态提交点）或 `"settle"`（自然结算处）；默认 `"run"`。
- 事件名唯一权威来源是 `apps/arcade/career/content/registry.json` 的 `watch[].kind`，`docs/arcade-life/ACTUAL-HOOKS.md` 记录其真实函数锚点；ADR 中的示例只作形状说明，`tower.stable_floors` 等历史候选名一律以 registry 冻结名为准（当前为 `tower.floor_stable`）。
- 序号单调递增、每个事件 `eventId` 唯一；同一页面刷新后 `runId` 重新生成。
- `observe()` 不做持久化写入（允许内存缓冲），不产生任何奖励或货币副作用。
- 结算时游戏页调用一次：

```js
window.ArcadeCareer.finish({
  mode: 'classic',            // classic | challenge | zen | commission
  outcome: 'won',             // won | lost | quit | abandoned
  stats: { pairsMatched: 12, level: 6, moves: 34 }
});
```

`finish()` 才允许触发一次发现判定、微线索 UI 与（0.16 起的）委托完成判定。`mow`（星海割草）不调用 `finish`，也不产生任何生涯记录，只允许在局内以 `observe` 记录纯线索证据（0.15 不启用）。

### 3.2 委托事件（0.16 起，只能来自 ticket）

```js
window.ArcadeCareer.recordCommissionEvent(ticketId, 'boss.defeated', { level: 3, theme: 'electromagnetic' });
```

- 仅当 `ticketId` 与本页 `bridge` 从 `sessionStorage` 读取的当前 ticket 一致时被接受。
- 事件同样由 `bridge` 补信封，`careerRunId` 来自 ticket 对应的 DB run 记录。
- 受 `sourceMode: 'commission'` 与 `modeGuard` 限制：挑战/禅/割草局的事件绝不进入委托判定。
- 结算：`window.ArcadeCareer.settleCommission(ticketId, { outcome, stats })`，由 `commission-core` 校验 DB 中 run 状态、统计事件、计算奖励计划，再交给 `career-db` 单事务 `settleAndClaim`。游戏页不传任何金额。

### 3.3 launchTicket（0.15 冻结形状，0.16 使用）

ticket 由 `commission-core` 在世界内签发，写入 `sessionStorage['studiokit:arcade:career:ticket']`（按标签页隔离），bridge 在游戏页读取；DB `runs` 记录保存 `ticketId + nonce + status` 作为权威。

```json
{
  "schemaVersion": 1,
  "ticketId": "tkt-<uuid>",
  "nonce": "<>=32 hex chars>",
  "careerId": "<careerId>",
  "commissionId": "<stable-id>",
  "gameId": "<gameId>",
  "mode": "commission",
  "seed": "<string>",
  "issuedAt": "ISO-8601",
  "expiresAt": null,
  "rulesetVersion": 1,
  "contentVersion": "<contentVersion>"
}
```

- 游戏页只能提交 `ticketId` 与真实事件；`nonce` 由 bridge 从 sessionStorage 读取并与 DB run 记录比对，游戏 payload 不得包含 nonce/金额/txId。
- ticket 在结算/放弃/刷新后清理；过期或与 DB 不一致的 ticket 拒绝结算（`{ok:false, reason:'ticket'}`），不扣款、不发奖。
- 静态站点无服务端密钥：本契约只防正常环境的重复/错单/跨标签，不承诺抵抗浏览器开发者工具篡改（这是有意识接受的边界，见产品不可变量）。


## 4. 发现状态机

`discovery.js` 输出纯函数：

```js
const api = {
  STAGES: ['DORMANT','GLIMPSED','CURIOUS','LOCAL','RESIDENT','EXPLORER'],
  initialState(),
  normalizeState(raw),
  normalizeClueBundle(raw),        // {schemaVersion, contentVersion, clues, errors, warnings}
  evaluateRun({ state, clueConfigs, runSummary, hintsEnabled, now }),   // -> { clueId, reason, nextState, clue, discovery } | null
  reduce(state, action, deps),     // deps = { clueConfigs }；返回 { state, clue?, transition?, invalid? }
  discoveredClueIds(state), hasClue(state, clueId), stageOf(state),
};
```

- 状态单调前进：`DORMANT → GLIMPSED → CURIOUS → LOCAL → RESIDENT → EXPLORER`。
- “关闭线索提示”是显示偏好（`hintsEnabled=false`），**不是**状态覆盖；已发现线索、信件与生涯资产不丢失，重新开启后继续可见。
- `reduce` 支持的动作：`RUN_ENDED`、`CLUE_OPENED`、`LETTER_FOLLOWED`、`CONTRACT_SIGNED`、`FIRST_RUN_COMPLETED`、`SET_HINTS`。
- 判定规则（接口层，不写具体阈值）：
  - 每局最多产出 1 条线索；同一次 `RUN_ENDED` 命中多条时按内容配置顺序取第一条未发现的。
  - 线索来自该游戏 `watch` 声明的事件计数达到内容阈值，**或**同一游戏累计有效局达到内容配置的保底局数（`guarantee.maxEligibleRuns`，首季要求 ≤ 3 且确定可达）。
  - 只有 `classic` / `challenge` / `zen` 计入“有效局”；`mow` 不计；暂停、未结算、中途退出不算有效局。
  - 线索不等于货币；`GLIMPSED` 只写发现证据，不创建钱包、`careerId` 或任何资产。
- 状态持久化到 DB `state` 与 `discovery` 两个 store（见第 7 节），由 `career-db` 以单事务提交。

## 5. 内容契约

### 5.1 线索内容 `content/clues.json`

```json
{
  "schemaVersion": 1,
  "contentVersion": "0.15.0",
  "clues": [
    {
      "clueId": "CL-<gameId>",
      "gameId": "<gameId>",
      "family": "industrial | signal | record | bio | route",
      "title": "戏内物件短名",
      "ambientLabel": "结算处可点按的短标签",
      "ambientText": "戏内一句话",
      "letter": {
        "sender": "戏内署名",
        "body": "40–70 字信件正文",
        "address": "折光港地址（戏内语言）",
        "actionLabel": "投递/看告示"
      },
      "trigger": { "kind": "<watch.kind>", "atLeast": 1 },
      "guarantee": { "maxEligibleRuns": 3 },
      "next": { "kind": "letter" }
    }
  ]
}
```

- `clueId` 一旦发布不得复用、改名或改变所属 `gameId`；文案可润色。
- `trigger.kind` 必须出现在对应游戏 manifest 的 `watch` 列表中；`atLeast` 为整数。
- 每条线索必须有确定性保底，不允许随机掉落。
- 文案遵守“戏内物件、无模式口吻、不出现 RPG/签到/奖励/概率”的规则；不得在 README / CHANGELOG / 提交信息复述。

### 5.2 注册表 `content/registry.json`

```json
{
  "schemaVersion": 1,
  "contentVersion": "0.15.0",
  "games": [
    {
      "gameId": "<stable-id>",
      "displayName": "游戏名",
      "adapterVersion": 1,
      "discoverable": true,
      "clueRef": "CL-<gameId>",
      "professions": ["<professionId>"],
      "capabilities": ["<capability>"],
      "watch": [
        { "kind": "pair.match", "payload": { "board": "number" }, "modes": ["classic", "challenge"] }
      ]
    }
  ],
  "professions": [
    { "professionId": "<stable-id>", "displayName": "职业名", "domain": "engineering | research | nature | intel | adventure", "capabilities": [] }
  ],
  "commissions": [
    {
      "commissionId": "<stable-id>",
      "gameId": "<gameId>",
      "professionId": "<professionId>",
      "tier": 1,
      "tierUnlock": "RESIDENT | chapter-flag",
      "objective": { "kind": "<watch.kind>", "atLeast": 1, "context": {} },
      "reward": { "credits": 0, "items": {}, "evidence": [], "flags": [] },
      "repeatSalaryCredits": 0,
      "handoff": { "text": "", "evidence": [] },
      "failure": { "hint": "" },
      "minValidEngagement": 0
    }
  ],
  "story": {
    "schemaVersion": 1,
    "nodes": [
      { "nodeId": "<stable-id>", "chapter": "C0", "requires": { "all": [] }, "grants": { "flags": [], "evidence": [], "capabilities": [] } }
    ],
    "edges": [ { "from": "<nodeId>", "to": "<nodeId>" } ]
  }
}
```

- `gameId`、`professionId`、`commissionId`、`nodeId` 都是稳定 ID；新增游戏不需要修改旧游戏源码、共享钱包、旧账本或旧章节文件。
- `gameId` 与 `professionId` 多对多；同一游戏 `professions` 可为空（仅线索），`commissions` 可为 0..N。
- `objective.context` 语义（冻结）：字段名对应事件 payload 字段。取值可以是原始值（严格相等），或 `{ "gte": number }` / `{ "lte": number }` / `{ "gte": number, "lte": number }`（数值区间，含端点）。payload 缺少 context 声明的字段 → 不匹配；payload 多余字段忽略。`registry.matchContext(context, payload)` 是唯一判定函数；`registry.js` 对非法 context 字段做丢弃并告警。例：`{"theme":"electromagnetic","level":{"gte":3}}` 只匹配电磁星区且 level≥3 的真实事件。
- 注册表 API（`registry.js`，纯函数）：
  - `createRegistry(bundle)` → 实例
  - `listGames()` / `getGame(gameId)`
  - `listProfessions()` / `getProfession(professionId)`
  - `listCommissions({ gameId?, professionId?, tier? })` / `getCommission(commissionId)`（单一过滤返回对应集合并集；同时给 gameId+professionId 时为交集）
  - `matchContext(context, payload)` → boolean（委托目标 context 判定）
  - `resolveStory(conditions, ctx)` → boolean（见第 8 节谓词）
  - `listStoryNodes(chapter?)` / `satisfiedStoryNodes(ctx)`
- 返回值只读：`getGame/getCommission/list*` 返回深拷贝（调用方修改不会污染注册表实例）。
- 运行时禁止出现 `GAMES.length === 16`、`missions.length === 96`、`chapterId === 'C3'` 之类的规模/顺序断言；`ARRAY[16]`、两两写死的游戏数组一律不允许。

## 6. 故事条件谓词（0.15 冻结，0.18 使用）

条件是不可变 JSON，支持 AND / OR：

```
condition :=
  { "all": [condition, ...] }
| { "any": [condition, ...] }
| { "capability": "<id>" }
| { "evidence": "<id>" }
| { "chapterFlag": "<flag>" }
| { "item": "<itemId>", "atLeast": 1 }
| { "credits": { "atLeast": 0 } }
| { "commissionCleared": "<commissionId>" }
```

- `resolveStory` 只读上下文 `{ capabilities:Set, evidence:Set, flags:Set, items:Map, credits:number, cleared:Set }`。
- 任何章节不得把单个游戏的单个委托写成唯一必需项；至少存在一条不依赖该游戏的替代条件（内容评审负责，测试用图可达性验证）。
- 空 `all`/`any` 的语义：`all: []` 为真，`any: []` 为假。

## 7. 存储与事务

### 7.1 IndexedDB

- 数据库名：`studiokit:arcade:career`；schema 版本 `careerSchemaVersion = 1`。
- Object stores（keyPath）：

| store | keyPath | 用途 |
|---|---|---|
| `state` | `key` | 发现状态机快照、偏好、schema/content 版本；第一条记录 `key: 'discovery'` |
| `discovery` | `clueId` | 每条线索的 `sourceGame / firstSeenRun / seenAt / openedAt / dismissed` |
| `profiles` | `careerId` | 生涯身份与设置；只有玩家在世界内签收工作/租机后才创建 |
| `runs` | `runId` | 委托局 ticket、状态、事件摘要 |
| `claims` | `runId` | 领奖幂等凭据（**唯一**） |
| `ledgers` | `txId` | 不可变流水；索引 `runId` |
| `balances` | `careerId` | `credits` + `revision` |
| `inventory` | `[careerId, itemId]` | 材料/收藏数量 |
| `equipment` | `careerId` | 飞船所有权、当前机体、模块 |
| `quests` | `[careerId, nodeId]` | 章节/委托进度与证据引用 |
| `migrations` | `id` | 迁移记录（`appliedAt`、`inputHash`） |

- 所有跨表变更在同一 `readwrite` 事务内提交：`claims`、`ledgers`、`balances`、`inventory`、`quests` 要么全部成功要么全部回滚。禁止用 `localStorage` 的 get+set 实现领奖。
- `claims` 的 `runId` 是唯一键：第二次领取必须返回**同一收据**且零新增奖励；并发/多标签下捕获 `ConstraintError` 后重读既有 claim 返回。
- 余额永不为负；购买/制造在事务内先校验余额与库存，再扣减并写入流水。
- 每个 `txId` 由 core 生成且可重放：`tx:<runId>:<step>` 或 `tx:<purchaseId>:<step>`；同一 `txId` 不会二次入账。

### 7.2 与经典存储的隔离

- 生涯运行时**只读**引擎公开 API（`A.GameMeta.get` 等）来复用经典参数；**不得**调用 `A.GameMeta.set/clear`、`A.RunSave.save` 或 `A.Progress.recordPlay` 来记录生涯数据。
- `A.GameMeta.set` 是**整对象覆盖**（engine.js:1449-1456）：任何仍需要写 `meta:v1` 的模块必须“读-合并-写”，不得只写自己的分量；0.16 星海职业委托只读 `get`，不写 `set`。
- 中心页“清除记录”的既有行为不变；新增“清除当前生涯”必须独立二次确认（0.15 起实现，见 `career-db.js` 的 `resetCareer()`）。
- 备份格式与导入详见第 10 节。

### 7.3 career-db 公开方法（0.15 冻结）

`apps/arcade/career/career-db.js` 浏览器挂 `window.ArcadeCareer.db`，Node `require()` 返回同一 API（IDB 调用在 Node 返回 `{ok:false, reason:'no-indexeddb'}`）：

```js
{
  DB_NAME, DB_VERSION, SCHEMA_VERSION, STORES,
  open() -> Promise<{ok, db?, error?}>, close(),
  isAvailable() -> Promise<boolean>,
  getDiscoveryState() -> Promise<state|null>,
  saveDiscoveryState(state) -> Promise<{ok, error?}>,     // 全量覆盖写 state store key 'discovery'
  listDiscovery() -> Promise<records[]>,
  putDiscovery(records) -> Promise<{ok, count, error?}>,  // 单事务批量 put
  getProfile(careerId) -> Promise<profile|null>,
  ensureCareer({originGameId, now}) -> Promise<{ok, careerId?, profile?, balance?, created?, error?}>,
  createRun(run) -> Promise<{ok, error?}>, getRun(runId), updateRun(runId, patch),
  getClaim(runId) -> Promise<claim|null>,
  settleAndClaim({runId, careerId, nonce, receipt, plan, now}) -> Promise<{ok, duplicate?, receipt?, error?, reason?}>,
  purchase({careerId, purchaseId, cost, grants, now}) -> Promise<{ok, duplicate?, receipt?, error?, reason?}>,
  readWallet(careerId) -> Promise<{ok, credits, items, equipment, error?}>,
  readQuestState(careerId) / putQuests(careerId, quests),
  resetCareer(careerId) -> Promise<{ok, error?}>,
  resetDiscovery() -> Promise<{ok, error?}>,
  exportAll() -> Promise<{ok, payload?, error?}>,
  importAll(snapshot, {mode}) -> Promise<{ok, error?}>,
}
```

- 所有写方法失败必须返回结构化失败（`{ok:false, reason, error?}`），禁止静默成功；事务内不得 `await` 非 IDB Promise。
- `open()` 负责连接缓存、`versionchange` 关闭、`onblocked` 超时；`indexedDB` 不可用时 `isAvailable=false`，不得回退 localStorage。

## 8. 奖励与领奖（0.16 起使用，0.15 冻结）

- 唯一入口：`career-db.settleAndClaim({runId, careerId, nonce, receipt, plan, now})`；返回：

```json
{
  "ok": true,
  "duplicate": false,
  "receipt": {
    "receiptId": "<runId>",
    "careerId": "<careerId>",
    "commissionId": "<commissionId>",
    "credits": 70,
    "items": {},
    "evidence": [],
    "flags": [],
    "txIds": ["<runId>:1"],
    "claimedAt": "ISO-8601",
    "rulesetVersion": 1,
    "contentVersion": "0.16.0"
  }
}
```

- 奖励金额由 `career-core.rewardPlan(commission, eventDigest, context)` 计算：
  - `credits = clamp(baseByMission + objectiveBonus + masteryBonus, 0, payoutCap)`；数值来自内容配置与 ruleset，不在游戏页。
  - 首次完成特有条件奖励只发一次；同一委托的**新有效局**可重复领取固定 `repeatSalaryCredits`；同一局重播不发薪。
  - 不得按 `score` 做统一汇率；不得把线索当材料；不得因负余额倒扣。
- `settleAndClaim` 在校验失败时返回 `{ok:false, reason}`，**不写任何记录**。

## 9. 失败与降级

| 场景 | 行为 |
|---|---|
| `fetch` 内容失败 / 404 / 语法错误 | `available=false`；无生涯 UI；经典照常 |
| IndexedDB 不可用 / 配额不足 / `file://` | 不持久化；不弹奖励；控制台 `console.warn` 一次；经典照常 |
| 事务失败 | 不写半成品；返回失败；玩家可重试；不重复扣款 |
| 页面刷新在结算前 | 若 run 状态为 `completed` 未 claim，重试同一事务；已 claim 则展示原收据 |
| 多标签同时结算 | 唯一 `claims` 约束；第二个返回“已在其他窗口结算”的原收据 |
| SW 新旧内容混用 | 内容文件带 `contentVersion`；版本不一致时拒绝委托结算并提示刷新，线索查看照常 |

## 10. 备份与迁移

- 生涯独立备份 `careerLife`：

```json
{
  "format": "studiokit-arcade-career",
  "careerSchemaVersion": 1,
  "contentVersion": "<version>",
  "exportedAt": "ISO-8601",
  "profiles": [], "state": [], "discovery": [], "runs": [], "claims": [],
  "ledgers": [], "balances": [], "inventory": [], "equipment": [], "quests": []
}
```

- 导出/导入由 `career/backup.js` 完成，校验结构、白名单 ID、数量上限、唯一性、引用完整性；导入采用 `staging → validate → migrate → activate`，失败时保留现有生涯。
- 与引擎备份的关系：0.15 只做独立导出/导入；0.16 起在中心页备份中追加可选字段 `careerLife`（异步读取后合成），**旧备份缺该字段时必须保留当前生涯**。
- 迁移：`careerSchemaVersion` 只增不减；每次迁移写 `migrations` 记录并在测试中覆盖旧版本输入。

## 11. 路由

`career/router.js`：

```js
detectGameId(locationLike)   // 语义与 engine.detectCurrentGame 一致：/games/ 之后、去 .html、小写、URL 解码、尾斜杠容错、无后缀兼容
careerBase()                 // 相对 bridge.js 的 apps/arcade/ 基址（GH 子路径 / CF 根路径 / 本地）
contentUrl(name)             // base + 'career/content/' + name
isTestMode(locationLike)     // ?careerTest=1
```

- 不得依赖域名根绝对路径；不得把 `location.pathname` 尾缀当作唯一判据。
- 中心页（`index.html`）不是游戏页，不装载 `bridge.js`；只有玩家主动打开的信箱/城镇入口才加载对应 UI 脚本。

## 12. 版本与锁定

- `careerSchemaVersion = 1`（IDB 结构）；`contentVersion` 随 Arcade 版本递增；`rulesetVersion = 1`（奖励/判定规则）。
- 每次 claim 记录 `rulesetVersion` 与 `contentVersion`；版本不匹配的旧 run 只展示收据，不再重算。
- 经典引擎 `ARCADE_VERSION` 与 SW `VERSION`、`shared/tool-registry.json`、README/AGENTS/BASELINE/CHANGELOG 的版本链按既有流程同步。

## 13. 测试接口

仅在 `?careerTest=1` 时，`bridge.js` 暴露：

```js
window.__arcadeCareerTest = {
  ready,                       // Promise
  state(),                     // 发现状态快照（深拷贝）
  clues(),                     // 当前内容线索（只读）
  simulateRun(summary),        // 纯函数路径：返回 evaluateRun 结果，不写库
  seedState(patch),            // 测试专用：写 DB state/discovery（测试后才允许）
  resetAll(),                  // 清空 career DB（仅测试域）
  lastFinish(),                // 最近一次 finish 的输入与结果
  registry(),                  // 注册表实例只读视图
  db()                         // DB 句柄（只读用途）
};
```

- 生产 URL 不暴露该对象；测试不得依赖 `setTimeout` 竞态，须等待 `ready`。
- **既有 `#test` 探针必须保持静默**：15 款游戏的 `location.hash === '#test'`（blackjack 为 `indexOf`）会暴露真实业务驱动函数（`forceStageClear`、`killAllEnemies`、`advance` 等），smoke/回归会调用它们。`bridge.js` 在“仅 `#test`、无 `?careerTest=1`”时不得持久化、不得渲染 UI、不得发任何奖励；游戏页的 `observe`/`finish` 调用可以无条件保留。career 测试 URL 统一写成 `...?careerTest=1#test`（需要游戏探针时）或 `...?careerTest=1`。
- 新增测试脚本命名：`tools/career_*_test.mjs`，复用 `tools/lib/arcade_cdp.mjs`，使用独立端口环境变量（`CAREER_*_PORT`），不得与 smoke/gameplay 默认端口冲突。


## 14. 游戏页最小适配契约（16 款统一）

```html
<script src="../engine.js"></script>
<script src="../career/bridge.js"></script>
<script src="../challenge/<gameId>.js"></script>
...
<script>
  /* 在脚本顶部获取一次；bridge 同步定义了该对象 */
  const career = window.ArcadeCareer || null;
  ...
  /* 仅在真实状态提交后调用；payload 不含金额/ID */
  if (career) career.observe('<watch.kind>', { /* 真实字段 */ });
  ...
  /* 每个自然结算只调用一次 */
  if (career) career.finish({ mode: 'classic', outcome: won ? 'won' : 'lost', stats: { /* 真实统计 */ } });
</script>
```

- 挑战模式：`mode: 'challenge'`；禅模式：`mode: 'zen'`（仅 `block-drop`）；星海割草不调用 `finish`。
- 结算 UI 由 `bridge`/`ui/clue-surface.js` 负责，游戏页不得自建生涯按钮、不得出现“进入生涯/开始冒险”等 CTA。
- 微线索 UI 规则：仅在结算安全点出现；默认无声音无震动；视觉层级不高于结算次要信息；可点区域 ≥ 44px；键盘可聚焦；屏幕阅读器可读；尊重 `prefers-reduced-motion`；忽略后不重复弹大窗，可从信箱找回。
- 原游戏函数、物理、计分、挑战判定、存档字段**行为零改动**；只允许新增脚本标签、`observe`/`finish` 调用与（必要时）导出测试探针。真实锚点的 payload 约定见 `docs/arcade-life/ACTUAL-HOOKS.md`。
- 观察事件名与注册表 `watch.kind` 以真实状态提交点为准（如 `pair.match`、`tower.floor_stable`），不得为了凑 `candidateEvent` 而伪造不存在的事件；内容侧 `trigger.kind` 必须能对到 `registry.json` 的 `watch` 列表。

## 15. 动态扩展验收（B02 必须通过）

`tools/career_registry_test.mjs`（纯 Node，不依赖 Chrome）必须至少断言：

1. 首季 16 个 `gameId` 全部可注册、`listGames().length === 16`，但代码中没有 16/96 硬编码（用第 17 款注入验证）。
2. 注入虚拟第 17 款 manifest（`gameId: 'virtual-coffee'`，两个职业、1 条线索、0 或 1 条委托）后：`listGames() === 17`；线索可独立发现（线索发现路径由 D15-01 测试覆盖）；委托可枚举；旧 16 款的清单与结算结果不变。
3. 同一游戏关联两个职业、同一职业关联两个游戏时，`listCommissions({gameId})` / `({professionId})` 返回正确并集；同时给两个过滤条件时返回交集。
4. 单游戏 0 条委托但 `discoverable=true` 仍可发现线索；1 条委托可独立结算。
5. 故事谓词：新职业产出的 `capability` 能满足既有节点；去掉该游戏后旧路线仍可满足同一节点（替代条件）。
6. 内容包缺失/版本不兼容时注册表忽略该可选游戏而非整体失败；未知 ID 在备份中保留为 `unavailable`，不静默删除。
7. 本 B02 契约测试只冻结“可注册/可枚举/多对多/谓词/17 款插拔”；线索发现与奖励推导的实际路径由 D15-01/D15-03 的测试覆盖。

## 16. 变更控制

- 任何字段新增：先改本 ADR + `career_registry_test.mjs`/对应 schema 校验，再改实现；旧字段不得删除或改变语义。
- 任何核心接口变化必须给出原因、影响、兼容/迁移方案与新测试，并由独立 Reviewer 复核。
- 与产品不可变量冲突时，不得自行重设计；记录到外部工作目录的 `variance.md`，由主控裁决最小兼容改法。

## 17. UI 模块契约（0.15 冻结）

`bridge.js` 装载 UI 后建立 `window.ArcadeCareerUI`；UI 模块不得自行读写 IndexedDB 或 localStorage，全部通过 bridge 传入的上下文：

```js
window.ArcadeCareerUI = {
  clueSurface: { render({ clue, onOpen, host }), clear() },
  mailbox:     { open(ctx), close() },
  settings:    { open(ctx), close() },
};
```

`ctx`（bridge 构造，只读 + 三个写操作）：

```js
{
  state,                  // 发现状态快照
  saveState(next),        // 持久化发现状态（bridge 负责 DB 单事务；失败返回 {ok:false}）
  setHintsEnabled(bool),  // 偏好开关（写 discovery state，不清任何证据）
  openClue(clueId),       // 打开指定线索信件（记录 CLUE_OPENED）
  followLetter(),         // 记录 LETTER_FOLLOWED → LOCAL；不创建钱包
  resetDiscovery(),       // 二次确认后清除本机线索记录（仅 discovery/state，不清任何生涯资产）
  originIntro(),          // 首源短文案（entry-router 数据驱动）
  clues: [],              // 已校验的线索内容
  registry,               // 注册表实例
  reducedMotion: bool,
  announce(text),         // 屏幕阅读器播报（aria-live polite）
  close(),                // 关闭当前面板
}
```

硬规则：
- 线索 chip：只在结算安全点出现；默认无声音、无震动、不抢焦点；可点区域 ≥44×44px；`role="button"`；`aria-label` 使用“发现一封来源不明的信”一类戏内措辞；可键盘聚焦；忽略后不再重复弹大窗。
- 信箱/设置面板：覆盖当前页面的轻量浮层，必须可关闭（按钮 + Esc）、可焦点返回、不写游记/不自动跳转；320/375/390/430 宽度不溢出；`prefers-reduced-motion` 下无动画。
- 文案：全部戏内语言；禁止“生涯模式 / 解锁 / 奖励 / 签到 / 概率”等按钮式或营销式措辞；不得在 UI 中解释系统规则。
- 样式：所有 career UI 样式集中在 `ui/clue-surface.css`（bridge 装载一次），禁止 `url(/...)` 与外部字体。
- 0.15 不创建钱包/`careerId`；`followLetter()` 只推进到 LOCAL 并展示折光港地址/告示快照。

