# ADR-0.23-ui：Arcade 生涯 UI 宿主适配、组件与 token 冻结

- 状态：Frozen for T11–T15（实现需按本 ADR；任何字段/数值变更先改本 ADR 并由 lead 串行确认）
- 日期：2026-11-27
- 分支 / 基线：`feat/arcade-career-023`，基线 `7a78f66`（0.22 `RELEASE_READY`，未发布）
- 任务：Arcade 0.23 T10。本文只冻结契约；本任务未修改 runtime/CSS/组件/版本链，未运行测试、浏览器、full 或 push。
- 外部依据：`D:\LocalAgentWorkspace\arcade-career-022-024\spec\02-ui-contract.md`、`spec\03-narrative.md`、`prototype/index.html`、`prototype/tokens.css`、`prototype/reference.js`、`prototype/README.md`、`prototype/reference-letter.png`、`prototype/reference-port.png`、`execution/02-task-board.md`、`execution/T06-ui-plan.md`。
- 仓库依据：`docs/arcade-life/ADR-interfaces.md` §17、§22、§23；`apps/arcade/career/ui/*`；`apps/arcade/career/bridge.js`；`apps/arcade/career/ui/clue-surface.css`；`apps/arcade/arcade.css`；`apps/arcade/engine.js` 的 0.19 紧凑布局；`apps/arcade/career/content/registry.json`、`clues.json`、`commissions.json`、`world-work.json`。

## 1. 范围、原则与证据标记

本 ADR 只回答「原型在真实宿主上如何落地而不重新设计视觉」，并冻结下游 T11–T15 的实现面。原型是视觉/交互基准，不是产品运行时：其左侧状态导航、`demo-nav`、`notice`、示例人物、示例剧情、假分数和「接受工作直接跳回执」全部不得进入产品；产品中的线索、身份、接单、结算仍只由 bridge、投影和真实 DB 事务驱动（ADR §23；外部 `spec/02-ui-contract.md:3,40`；`prototype/README.md:3`）。

证据标记：本文 `[F]` 为当前源码/参考文件事实，`[I]` 为在事实基础上冻结的实现约定，`[U]` 为未验证并保持 UNVERIFIED（本任务没有实机、浏览器或截图执行）。所有截图容差在 T15 验证前都是目标，不是已通过结论。

### 1.1 关键事实锚点

- `[F]` UI 通过 `window.ArcadeCareerUI` 暴露；`uiContext()` 在 `bridge.js:3607-3669` 同时提供旧 ctx、`careerView`、`invitationForClue`、`onCareerDataChanged` 等；`openCareerUi()` 在 `:3937-4030` 给面板注入投影与业务门面。
- `[F]` `careerView(context)` 在 `bridge.js:2440-2464` 是 Promise 只读投影，模块不可用时返回 `null`，不用目录兜底；`renderClue()` 在 `:2897-2945` 只把单条 `clue`、`onOpen`、`host`、`placement`、`anchor`、`state` 交给 UI。
- `[F]` 结算收据 payload 在 `bridge.js:1787-1831` 注入 `result`、`careerView`、`storyFeedback` 与三个 open 方法；`receipt.js:519-569` 已明确 `nextStep` 只取投影，`storyFeedback.nextStep` 被置空。
- `[F]` 现有 UI 模块已有统一浮层、焦点圈闭、Esc、焦点返回与 reduced-motion 约定（`mailbox.js:17,269-329,917-963`；`town.js:19-26,848-872,1866-1940`；`world-state.js:26-27,1519-1534,2190-2263`；`receipt.js:25-30,877-991`；`hangar.js:31-37,1469-1602`；`settings.js:20-22,981-1032`；`market.js:47-48,1836-1966`；`workshop.js:28-29,1435-1565`）。
- `[F]` 样式历史和约束见 `ui/clue-surface.css:1-739`：局部变量仍以 `--ac-career-*` 命名，浮层当前 `max-width:420px`/`380px`、`max-height:min(86dvh,640px)`，并使用 `html:has(...)` 锁定页面滚动。0.23 必须把这些实现细节迁到局部命名空间，不直接修改本文件之外或全局选择器。
- `[F]` 原型 token 精确值见 `prototype/tokens.css:1-2`；参考截图为 440×452 与 440×733 的面板裁切（SHA-256 `d6124bb6…`、`0a558b86…`），不是整页截图。
- `[I]` 本 ADR 冻结的组件是逻辑组件名；T11/T12/T13 的具体新增文件名在第 7 节冻结，lead 负责把它们串行接入 bridge loader。

## 2. 真实宿主差异与必要适配

### 2.1 宿主事实对照

| 维度 | 原型 `[F]` | Arcade 真实宿主 `[F]` | 0.23 冻结适配 `[I]` |
|---|---|---|---|
| 页面结构 | 独立 `demo-shell` + 状态导航 + `.stage` + `.panel`，`viewport-fit=cover` | 中心页 / 16 个游戏页共享 `shared/site.css`、`arcade.css`、`engine.js`；游戏页刻意不声明 `viewport-fit=cover`，用不透明 `theme-color` 修复 iOS 顶缘模糊（`apps/arcade/index.html:5-15`、`games/*.html:5-8`、`arcade.css:50-99`） | 只复刻面板内部构图；面板挂到 `document.body` 的 career 根节点，不复制 demo 外壳；不得恢复 `viewport-fit=cover`。安全区用 `env(...,0px)`，无安全区时为 0。 |
| 全局主题 | `tokens.css` 在 `:root` 写 `color-scheme:dark`、字体、14px/1.65、`background:#101419`；还使用 `*`、`button`、`h1/h2/h3/p` 全局选择器 | `arcade.css:6-16` 在 `:root` 写 `--ac-bg/#0b1020`、`--ac-panel/#151d3a`、`--ac-accent/#ffd23f` 等；`:18` 全局 `box-sizing`；`body.arcade-body` 有渐变背景、`user-select:none`、`touch-action:manipulation`、`overscroll-behavior:contain`（`:26-41`） | 不写 `:root`、`html`、`body`、`*`，不写裸 `button/h1/h2/h3/p`；仅在 `.ac-career-ui` 容器上声明本地 token、字体与行高。宿主主题和经典游戏画面保持不变。 |
| 16 款游戏主题色 | 固定金色 `#d6b477` 主按钮 | 每页 body 通过 inline style 覆盖 `--ac-accent` / `--card-accent`，现有主按钮会随游戏变色；16 个真实值见 2.2 | career 内部一律使用本地 `--ac-career-ui-gold:#d6b477`，不读取宿主 `--ac-accent`；离开 career 后游戏主题不变。clue chip 虽在结算页，仍带 `.ac-career-ui` 根并使用同一金色。 |
| 字体 | `system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif` | 宿主 body 为 `system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif`（无 `BlinkMacSystemFont` / `PingFang SC`） | 在 `.ac-career-ui` 上原样使用原型字体栈；不加载远程字体。截图对齐要求同 OS/浏览器；若实际 fallback 不同，记录为文字换行差异，不通过改字号硬凑。 |
| 浮层层级 | 原型没有 modal 遮罩；页面内 `.panel` 阴影 `0 20px 70px #0006` | 游戏结算 `.overlay` 在低层；career 现有 `.ac-career-overlay` 为 `z-index:10000`，覆盖 PWA 独立窗口 sticky shellbar（`ui/clue-surface.css:158-171`；`arcade.css:62-99`） | 保留高于 shellbar 的 career 层级；遮罩按契约冻结为 `#0009`。不得修改 `--ac-thumb-lift`、shellbar 或游戏 overlay 规则。 |
| 滚动锁 | 原型无背景锁 | 当前用 `html:has(.ac-career-overlay), body:has(...)` 锁 `overflow:hidden`（`ui/clue-surface.css:153-156`） | T11 改用命名空间状态类（建议 `html.ac-career-ui-scroll-lock`）并精确恢复原 `overflow`；不依赖 `:has()` 兼容旧浏览器，不写裸 html/body 规则。多个 career 面板叠加时引用计数，只关最后一层时解锁。 |
| 0.19 紧凑模式 | 原型只在 `@media(max-width:740px)` 收起导航；没有 ≤620×700 游戏专用规则 | `engine.js:3814-3851` 测量 hint 高度写 `--ac-hint-refund`；`arcade.css:2145-2244` 在 `≤620×700` 隐藏 shellbar/hint、游戏 overlay 变底部弹层、选关/机库铺满剩余屏幕 | career 浮层是 body 级面板，不受 `.game-page .overlay` 底部弹层选择器约束；仍固定 440px 面板、`calc(100% - 24px)` 窄屏宽、`min(86dvh, 视口 - 24px - safe-area)` 内部滚动。不得用 fixed height 截断剧情，不得吃游戏画布。 |
| PWA 独立窗口 | 无 standalone 概念 | `html.studiokit-shell-standalone` 下 shellbar sticky、顶部安全区、按钮拇指抬升（`arcade.css:74-99,1474-1517`） | career 面板自身处理 `env(safe-area-inset-*)`，关闭后焦点回到原触发点；不复制或覆盖 `--ac-thumb-lift`。 |
| 横屏 844×390 | 原型只做窄屏导航重排 | 游戏在 `orientation:landscape` 且 `max-height:560px` 时缩短拇指抬升（`arcade.css:1368-1370,1676`） | career 面板按短视口内部滚动，标题和关闭键固定可见；不触发游戏横屏方向锁或全屏。 |
| 内容注入 | `reference.js` 直接拼示例 HTML 字符串 | UI 模块以 `textContent` 注入内容；receipt 金额只从 DB 读取；不显示 reason code（ADR §17/§23.3） | 所有文本节点用 `textContent`/受控组件 props；SVG 仅本地内联或同源静态资源且 `aria-hidden="true"`；不把原型示例剧情写入产品。 |

### 2.2 普通游戏主题色（16 个真实值，`[F]`）

下表只描述宿主游戏主题；career 面板内不继承这些强调色。来源为各 `apps/arcade/games/<id>.html` 的 body inline style；游戏名来自 `career/content/registry.json:5-168`。

| gameId | displayName | `--ac-accent` / `--card-accent` |
|---|---|---|
| `memory-flip` | 记忆翻牌 | `#5ad1a0` |
| `merge-2048` | 2048 合成 | `#f2b33d` |
| `blackjack` | 二十一点 | accent `#ffd23f`，card `#e0688a` |
| `gomoku` | 五子棋 | `#d9b06a` |
| `solitaire` | 纸牌接龙 | `#7fd0c8` |
| `snowbells` | 雪铃 | `#2fa8a0` |
| `brick-breaker` | 砖块计划 | `#4fc3f7` |
| `gravity-flip` | 重力翻转 | `#9b7cff` |
| `snake-run` | 贪吃蛇 | `#66d36e` |
| `mole-whack` | 打地鼠 | `#ff9a3d` |
| `block-drop` | 俄罗斯方块 | `#7c5cff` |
| `star-raid` | 星海突击 | `#4f7cff` |
| `road-rush` | 极速车道 | `#ff7847` |
| `shadow-leap` | 影跃 | `#e0567f` |
| `pendulum-tower` | 层塔 | `#e5941b` |
| `gold-miner` | 黄金矿工 | `#f5c542` |

`star-raid` 的六个 canvas 星区主题（巡逻星域 / 陨石带 / 电磁风暴 / 舰队封锁 / 星云迷雾 / 母舰防线）只改变画布背景、敌机与 HUD，不改变 DOM career 面板；career 内容只消费 bridge 投影中的公开字段，不读 `themeId` 或主题数值（`apps/arcade/games/star-raid.html:731-738,944,4829-4881`，ADR §23.3）。

### 2.3 已识别的宿主差异决策

| 编号 | 差异 | 冻结决策 | 状态 |
|---|---|---|---|
| H1 | 原型按钮固定金色，宿主 16 页强调色不同 | career 局部 token 固定金色；游戏本体零改动 | Frozen `[I]` |
| H2 | 原型 `viewport-fit=cover`，宿主因 iOS 顶缘模糊刻意移除 | 不恢复；仅用 `env(safe-area-inset-*)` 兜底 | Frozen `[I]` |
| H3 | 原型聚焦面板标题，宿主各面板聚焦关闭键 | 打开时聚焦关闭键；标题保留 `tabindex="-1"` 供状态导航程序化聚焦。T15 记录此差异，不判视觉 FAIL | Frozen `[I]` |
| H4 | 原型 P01 线索在结算面板内；宿主只能经 `renderClue({host,placement})` 挂在结算安全点 | 保持宿主锚定（结算弹层角/页面角），不抢「再来一局」；T15 对 ClueRow 元素本身做对齐，不对整张结算弹层做像素阈值 | Frozen，待 lead 在 T15 确认截图口径 `[I]` |
| H5 | 当前 career CSS 使用 `html:has(...)` 全局锁滚动、全局 keyframes 和 420/380px 面板 | T11 改命名空间状态类与 440px 面板；不修改普通游戏样式 | Frozen `[I]` |
| H6 | 0.19 紧凑模式把游戏 overlay 变底部弹层 | career 面板不复用该选择器，独立短视口内部滚动 | Frozen `[I]` |
| H7 | 原型示例数据/导航可见 | 只把 P01–P10 fixture 放进私有 QA 路由或测试工具，不进入正式页面 | Frozen `[I]` |

## 3. 冻结的桥接输入面（下游唯一可用数据源）

UI/adapter 不得读 `ctx.commissions`、`careerCatalog()`、`ctx.chapters` 的未投影完整目录，不得 `listAvailable({ensure:true})`，不得用 `display:none` 占位隐藏未披露职业（ADR §23.3、`execution/T06-ui-plan.md:29,46`）。下表是 T12/T13 可消费的冻结门面；bridge 的扩展由 lead 串行集成 `[I]`。

| 门面 | 冻结输入 | 冻结输出 / 失败语义 |
|---|---|---|
| `careerView(context)` | `{surface: 'clue'|'letter'|'port'|'work'|'journal'|'receipt'|'message'|... , gameId?: string|null}` | `Promise<View|null>`；`View = {schemaVersion:1, originGameId, activeProfessionId, professions:[{professionId,displayName,domain,state,paused,active}], commissions:[公开字段 + category:'world'|'profession' + historicalOnly/readOnly?], story:{nextAction,messages:[{label,text?,from?,at?}],history:[]}, tools:[{toolId,name}]}`；`tools` 当前真实形状只有 `toolId/name`，且已被 bridge 排序；缺失/异常返回 `null`，UI 显示自然空态 |
| `invitationForClue(clueId)` | 单个真实 clueId | `null | {professionId,gameId,displayName,state:'glimpsed'|'read'|'accepted',canAccept:boolean}`；只来自已 gate  invitation 小面 |
| `acceptProfessionInvitation(input)` | `{professionId,gameId}` | `Promise<{ok,duplicate?,newlyAccepted?,created?,careerId?,generation,reason?}>`；只建立身份，不接单、不发资源 |
| `setActiveProfession` / `setProfessionPaused` | `{professionId}` / `{professionId,paused}` | 只改职业当前选择 / 折叠状态；不回退历史、不阻塞主线 |
| `onCareerDataChanged(listener)` | listener | 返回 unsubscribe；接受邀请、导入非 `preserved/none`、封存、解冻、重置后触发一次 |
| `renderClue` 传给 ClueRow | 完整单条已校验 `clue:{clueId,gameId,family,title,ambientLabel,ambientText,letter:{sender,body,address,actionLabel},trigger,...}`；`onOpen(clueId)`、`host`、`placement:'result-host'|'page-corner'|'list'`、`anchor`、`state`（`stateSnapshot()` 原始快照） | UI 只消费 §3.1 冻结的派生 props；`anchor` 只用于挂载，`state` 是 DiscoveryState 快照而非组件状态；不推导职业/任务详情 |
| `receipt.show(payload)` | `{api,result,careerView,storyFeedback,careerId,reducedMotion,announce,openTown,openCampaign,openMailbox}` | 可见下一步只取 `careerView.story.nextAction`；`storyFeedback` 只可贡献 `status` 与 NPC 回话，禁止 `nextStep` 回填 |
| `reducedMotion`, `announce(text)` | ctx 字段 | 动画关闭双保险；异步状态用 polite 播报，不显示 reason code |

### 3.1 真实输入到组件 props 的唯一派生规则 `[I]`

#### ToolGrid：`careerView.tools` → 组件 props

当前 bridge 的真实 catalog 只有四个 toolId：`wallet | shop | workshop | hangar`（`bridge.js:2266-2271`）；投影只输出 `{toolId,name}`（`profession-view.js:616-625`）。T13 adapter 必须按表派生，不得把视觉图标名当 toolId：

| toolId | 组件 `id` | `label` | 组件 `icon` | `onClick` 来源（`ctx` 或 `ctx.api`） |
|---|---|---|---|---|
| `wallet` | `wallet` | `name` ⟶ `钱包` | `wallet` | `openReceipt()` |
| `shop` | `shop` | `name` ⟶ `商店` | `store` | `openMarket()` |
| `workshop` | `workshop` | `name` ⟶ `工作台` | `tool` | `openWorkshop()` |
| `hangar` | `hangar` | `name` ⟶ `机库` | `tool` | `openHangar()` |

- `store` 只是 `shop` 的**线性图标名**，永远不是 toolId，也不是玩家可见标签；`hangar` 是真实存在的第四个工具，P07 必须展示。四个已知 toolId 全部展示，未知 toolId 忽略且不显示锁位。
- `label` 优先取投影 `name`，缺失时按表回退；`icon` 上表唯一映射；`onClick` 由 adapter 从 ctx 受控方法装配并交给 QA stub 注入器，JSON 中不序列化函数。组件顺序固定为 `wallet → shop → workshop → hangar`（保留原型前三项顺序、把真实第四项 hangar 追加在末尾），不采用投影的字母序。
- 三列 grid 自动换行；320px 文字可换行，不因新增 hangar 改成四列或缩小热区。

#### ClueRow：`renderClue({clue,state,...})` → 组件 props

`clue` 是当前真实内容对象（含 `clueId/gameId/family/title/ambientLabel/ambientText/letter/trigger`），`state` 是 `stateSnapshot()`（`bridge.js:2897-2920`）；UI 不得把原始 `state.stage` 当成组件状态。

| 组件 prop | 唯一派生规则 |
|---|---|
| `clueId` | `clue.clueId`，必须能在 `clues.json` 找到 |
| `gameId` | `clue.gameId`，必须能在 `registry.json.games` 找到；不使用展示名反查 |
| `professionId`（内部） | 优先 `invitationForClue(clueId)?.professionId`；无邀请时取 registry 中该 game 的唯一 `professions[0]`；多个或缺失时为 `null`。仅用于内部 gate，不在 ClueRow 渲染 |
| `icon` | `state='recoverable'` 时用 `mail`（信箱找回）；其余按 `family` 映射：`record→mail`、`signal→scroll`、`bio→gem`、`industrial→pick`、`route→chevron`。未知 family 回退 `gem`，语义由文字承担 |
| `title` | `ambientLabel || title`，保持既有 chip 文案优先级 |
| `teaser` | `ambientText || ''`；空串时不建摘要节点 |
| `actionLabel` | `state='glimpsed'` 时为 `仔细看看`；`state='recoverable'` 时取 `letter.actionLabel`（无效则 `按地址投递`）；`state='read'` 时为 `查看这封信` |
| `state` | 按固定优先级求值（**recoverable 优先于 glimpsed/read 的展示分支**）：① `clueId` 不在 `state.clues` → `hidden`（无 DOM）；② `openedAt` 为合法 ISO → `read`（`dismissed` 不再改变已读）；③ 信箱找回 surface 且 `openedAt` 缺失、`portSeenAt` 缺失、stage 为 `GLIMPSED/CURIOUS` 且存在已读线索 → `recoverable`，即使 `dismissed:true` 也只恢复列表行、不重弹 chip；④ `dismissed:true` 且非 list surface → `hidden`；⑤ 其余记录存在且无 `openedAt` → `glimpsed`。`invitationForClue().state` 只能交叉确认 `glimpsed/read`，绝不产出 `recoverable`（`bridge.js:4582-4584`、`career-db.js:1211-1213`） |
| `onOpen` | 直接使用 bridge 传入的同名回调，每次激活只调一次 |

#### `careerView.story.messages` 的生产者

`profession-view.js:586` 的纯投影继续只初始化 `messages:[]`；真实的一条消息由下列链路**加性注入**，不改变 §23 冻结的纯接口：

1. T14 在 `career/content/narrative-shards/shard-01.json` … `shard-04.json` 提供按稳定 `messageId` 与真实 `professionId` 编目的公开短句 `{messageId,professionId,surface,label,text?,from?,at}`；未见过的职业不得产出条目。
2. T12 adapter（letter/arrival/receipt）按真实 `invitationForClue`、`state.clues[*].openedAt` 与当前 surface 选择**零条或一条**候选；`read` 未接受职业返回 `null`，候选 `professionId` 必须在 `view.professions` 中。
3. lead 串行集成的 `bridge.careerView()` 在 `projectCareerView()` 之后、返回 UI 之前注入候选：多条时按合法 `at` 降序、再按 `messageId` 字典序取第一条，硬上限 1；无候选时保持 `[]`。
4. T13 只消费 `view.story.messages`；`world-state.js:1898-1916` 已支持的 `label/text/from/at` 是唯一公开形状。不得由 UI 直接读取 T14 shard、NPC/章节目录或 `storyFeedback.nextStep` 补写消息。
5. 夹具中的 `bridgeInput.state` 必须由真实 `professionState.mergeIntoDiscovery/extensionOf` 形状生成，并与夹具 `projection.professions`、`story.messages`、`tools` 自洽；只允许在 fixture 中持久化该快照，不把合成状态写回产品。

## 4. 冻结组件契约

记法：`string` 非空字符串；`Action = {id,label,kind:'primary'|'secondary'|'text',onClick(),disabled?,busy?,ariaLabel?,describedBy?}`；`Node` 为 DOM 节点或可渲染内容。所有 props 均为只读输入；组件不得自行读存储、发请求或修改业务状态。所有 `data-*` 值稳定，供 T15 对齐与断言使用。

### 4.1 公共输出与焦点规则

- 所有浮层由 `CareerShell` 提供：根 `.ac-career-ui` 包含 `.ac-career-ui__overlay[data-career-panel]` 与 `.ac-career-ui__panel[role=dialog][aria-modal=true][aria-labelledby][tabindex=-1]`。`data-career-panel` 取值沿用 `mailbox|town|world-state|receipt|hangar|market|workshop|settings|arrival|journal`，新值须在本 ADR 登记。
- `open(ctx)` 返回 `{ok:boolean,panel?:Element,reason?:string}`；`render(ctx)` 返回同形且不重复建层；`close()` 返回 `boolean`。`clueSurface.render()` 返回 `Element|null`，`clear()` 返回 `boolean`。重复 `open/render` 幂等，不叠层、不抢已聚焦控件。
- Esc / 关闭按钮 / 点遮罩都只关闭最上层；Tab / Shift+Tab 在面板内循环；打开时保存 `document.activeElement`，关闭且节点仍连接时恢复。普通游戏快捷键在面板关闭后恢复，面板打开时不响应游戏键。
- 按钮全部是 `<button type="button">`，热区 ≥44×44 CSS px；`disabled` 与 `busy` 同时有可见文字说明；`:focus-visible` 为 `2px solid var(--ac-career-ui-gold-light)`、offset `3px`。
- 状态用 `data-state` / `aria-busy` / `aria-selected` / `aria-current` 表达，颜色不单独承载语义；文本全部 `textContent`；reason code、内部 ID、总数与进度不进入玩家可见 DOM。
- JSON 夹具不能序列化函数：夹具中的每个 `Action` 以 `id` 为 `actionId`；T15 QA 工具必须按 `actionId` 注入 `onClick` stub，记录调用次数并返回 `{ok:true}`。默认 stub 为一次性成功；测 `busy` 时第二次点击前不得再调用 stub，测 `disabled` 时 stub 调用数必须为 0。stub 只存在测试宿主，不进入产品。

### 4.2 CareerShell

| 项 | 冻结值 |
|---|---|
| Props | `title:string`, `descriptionId?:string`, `state:'normal'|'scroll'|'loading'|'error'`, `size?:'default'|'small'`, `showHeader?:boolean`（默认 `true`，字条与邀请使用 `false` 并保留对话框名称）, `body:Node`, `footer?:Node`, `reducedMotion:boolean`, `onClose():void`, `initialFocus?:Element|string`, `returnFocus?:Element|null` |
| 输出 / 状态 | 面板宽 `min(440px, 100%)`；窄屏 `calc(100% - 24px)`；面板圆角 16、padding 16（≤360px 按 token 降为 12）；`data-shell-state` 取 `normal|scroll|loading|error`；loading 设 `aria-busy=true` 且保留结构；error 提供可见重试文本；body 独立滚动，`overscroll-behavior:contain` |
| 键盘 / 焦点 | 打开优先聚焦 `initialFocus`，其次为可见的关闭按钮或对话框本身；标题 `tabindex=-1` 只作程序化焦点；Esc / close / 遮罩关闭；Tab 圈闭；关闭恢复 `returnFocus ?? 打开前元素` |
| 状态 / 事件 | `onClose` 每次关闭只调用一次；滚动状态变化不改业务状态 |

### 4.3 ClueRow

| 项 | 冻结值 |
|---|---|
| Props | `clueId:string`, `gameId:string`, `professionId:string|null`, `icon:'gem'|'scroll'|'mail'|'pick'|'wallet'|'store'|'tool'|'check'|'x'|'chevron'`, `title:string`, `teaser:string`, `actionLabel:string`, `state:'hidden'|'glimpsed'|'read'|'recoverable'`, `placement:'result-host'|'page-corner'|'list'`, `onOpen(clueId):void`, `reducedMotion:boolean` |
| 输出 / 状态 | 24px 线性金色 icon（stroke 1.6–1.7）、标题、摘要、金色文字动作；`state=hidden` 时节点完全不存在；`result-host/page-corner` 仍 ≥44px 且不遮挡主结果按钮；不显示职业、任务、报酬或 reason code |
| 键盘 / 焦点 | 原生 button；Enter/Space 激活 `onOpen` 一次；不自动抢焦点、不弹大窗、无声音/震动；列表位置可用 Tab 到达，结算位置位于主按钮之后 |
| 来源 / 派生 | 唯一来源是 §3.1 的 `renderClue({clue,state,...})` 派生表；`bridge.renderClue` 的完整 clue 与 DiscoveryState 快照先派生为 props 再渲染；职业 ID 只用于内部 gate |

### 4.4 LetterCard

| 项 | 冻结值 |
|---|---|
| Props | `title:string`, `paragraphs:string[]`, `sender:string`, `ambientLabel?:string`, `state:'unread'|'read'|'deferred'`, `actions:Action[]` |
| 输出 / 状态 | `.ac-career-ui__letter` 背景 `#292822`、radius 10、padding 16；标题 gold-light，段落 14/1.65，段间 8；签名右对齐金色；最多两个动作（接受 / 以后再说 或 投递 / 回看），`data-letter-state` 精确取值 |
| 键盘 / 焦点 | 打开信箱不抢走信件文本焦点；动作是原生按钮；`busy` 时 `aria-busy=true` 且忽略重复点击；`deferred` 关闭后焦点回原线索行 |
| 内容边界 | `read` 未接受只恢复邀请，不出现工作标题、目标或报酬；不读取完整 catalog |

### 4.5 NPCDialogue

| 项 | 冻结值 |
|---|---|
| Props | `name:string`, `paragraphs:string[]`, `avatar?:{kind:'user'|'initial',label?:string,src?:string}`, `state:'first'|'return'|'optional'|'error'`, `actions?:Action[]` |
| 输出 / 状态 | 44×44 头像（同名本地/同源资源或线性 user 图标，`aria-hidden`）+ 金色姓名 + 2–3 短段；`data-npc-state` 精确取值；error 用戏内自然语言，不显示 reason code |
| 键盘 / 焦点 | 默认非交互、不抢焦点；若传 `actions` 则每个都是原生按钮；无打字动画、无自动下一幕 |

### 4.6 PrimaryAction / SecondaryAction

| 项 | 冻结值 |
|---|---|
| Props | `label:string`, `onClick():void`, `disabled?:boolean`, `busy?:boolean`, `ariaLabel?:string`, `describedBy?:string`, `id?:string`；`SecondaryAction` 另有 `variant:'border'|'text'` |
| 输出 / 状态 | `<button type=button>`、min-height 44、radius 8、font 14/600；primary 满宽、gold 底 / on-gold 字、hover gold-light、active `translateY(1px)`；secondary 透明 + `1px solid #ffffff30` 或 text；状态 `default|hover|focus|pressed|disabled|loading` 用原生状态 + `disabled` + `aria-busy` + `data-action-state` 表示 |
| 键盘 / 焦点 | Enter/Space；busy/disabled 时不再触发；visible focus 按公共规则；每个面板最多一个 primary，true action 才更新状态 |

### 4.7 StoryCard

| 项 | 冻结值 |
|---|---|
| Props | `eyebrow?:string`, `title:string`, `summary:string`, `state:'current'|'no-action'|'completed'`, `tags?:string[]`, `action?:Action` |
| 输出 / 状态 | `.ac-career-ui__surface.stack.small`；标签 + 标题 + 说明 + 最多一个主动作；completed/no-action 不渲染 gold 主按钮；`data-story-state` 精确取值 |
| 键盘 / 焦点 | 动作是原生按钮；卡片本身不抢焦点；刷新后保持焦点在触发按钮或其替代控件 |

### 4.8 SegmentedTabs

| 项 | 冻结值 |
|---|---|
| Props | `tabs:[{id:'home'|'work'|'journal',label:'眼下'|'工作'|'经历',disabled?:boolean}]`, `selectedId`, `onSelect(id):void`, `label:string`, `controlsId?:string` |
| 输出 / 状态 | `role=tablist`，三项等分；`button[role=tab][aria-selected][tabindex]`，选中 tab `aria-selected=true`/`tabindex=0`，其余 `-1`；选中背景 `#343a43`、字色 `--ink`、非金色填充；关联 `role=tabpanel` |
| 键盘 / 焦点 | ArrowLeft/ArrowRight 循环移动选中项并聚焦；Home/End 到首/末；Enter/Space 调 `onSelect`；roving tabindex；320px 标签可换行但热区 ≥44px |

### 4.9 WorkCard

| 项 | 冻结值 |
|---|---|
| Props | `professionId:string|null`（职业卡必须是真实 registry ID 且已接受；世界工作变体必须为 `null`）, `displayName:string`, `icon`, `state:'active'|'optional'|'paused'|'empty'`, `commissions:[{commissionId,category:'world'|'profession',title,summary,gameName?,objectiveText?,rewardText?}]`, `onStart?(commissionId):void`, `onPause?(professionId,paused):void`, `expanded?:boolean`；adapter-only `internalParentProfessionId` 必须是同一 fixture `projection.professions` 中已接受且由 commission-core `availableIds` 授权的真实职业，只用于核心授权，不进入组件 props/DOM |
| 输出 / 状态 | `.ac-career-ui__surface`，图标 + 名字 + 状态；首条工作可见，其余可展开；paused 折叠且不显示任务详情；`category:'world'` 用 `professionId:null` 的独立卡片，只用通用标题/说明，不显示 gameName、displayName、professionId 或职业报酬；`data-work-state` 精确取值；empty 为自然空态 |
| 键盘 / 焦点 | 展开用原生 `<details>/<summary>` 或等价 button + `aria-expanded`；接单/搁置为原生按钮；paused 恢复后焦点留在恢复按钮；不渲染未接受职业占位 |

### 4.10 ReceiptCard

| 项 | 冻结值 |
|---|---|
| Props | `outcome:'success'|'failure'`, `state:'success'|'failure'|'no-duplicate-reward'`, `title:string`, `resultLine:string`, `rewards?:{credits?:number,materials?:[{name,count}],identity?:string,experience?:string}`, `npcReply?:NPCDialogue props`, `nextAction?:Action`, `exitAction?:Action` |
| 输出 / 状态 | `.ac-career-ui__surface` + `.ac-career-ui__success`（或 failure）+ `.kv`；报酬只来自真实结算 DB 行；`no-duplicate-reward` 不重复显示奖励；下一动作只取投影 `story.nextAction`；最多两个动作（继续 / 今天到这里） |
| 键盘 / 焦点 | 非 modal 卡为 `role=status`/`aria-live=polite`，不抢焦点；按钮原生可点；modal 钱包仍按 CareerShell 圈闭 |
| 内容边界 | 不显示 credits 计算过程、txId、runId、reason code；失败给真实下一步 |

### 4.11 JournalTimeline

| 项 | 冻结值 |
|---|---|
| Props | `events:[{id?:string,label:string,at?:string,source?:string}]`, `state:'empty'|'filled'`；数据只来自 `careerView.story.history` |
| 输出 / 状态 | `<ol class="ac-career-ui__timeline">`，1px 竖线与 7px 金色节点；DOM 顺序即真实事件顺序；时间只显示合法 ISO 的 `YYYY-MM-DD`；不显示总数、百分比、未发生项或 eventId |
| 键盘 / 焦点 | 非交互；empty 为自然语言；按 DOM 读屏顺序可访问 |

### 4.12 ToolGrid

| 项 | 冻结值 |
|---|---|
| Props | `tools:[{id:'wallet'|'shop'|'workshop'|'hangar',label:string,icon:'wallet'|'store'|'tool',onClick():void}]`（由 §3.1 的唯一映射从 `careerView.tools` 派生）, `state:'hidden'|'available'`, `label:string` |
| 输出 / 状态 | 三列 grid、gap 8；每格 icon + 文字、radius 8、背景 `#ffffff08`、hover `#ffffff12`；四个真实工具按三列自动换行，320px 文字可换行；`hidden` 时无 DOM |
| 键盘 / 焦点 | 原生按钮 ≥44px；装饰 icon `aria-hidden`；未知工具不渲染，不显示锁位或介绍演示导航 |

### 4.13 组件状态枚举总表

| 组件 | 冻结状态 |
|---|---|
| CareerShell | `normal` / `scroll` / `loading` / `error` |
| ClueRow | `hidden` / `glimpsed` / `read` / `recoverable` |
| LetterCard | `unread` / `read` / `deferred` |
| NPCDialogue | `first` / `return` / `optional` / `error` |
| PrimaryAction / SecondaryAction | `default` / `hover` / `focus` / `pressed` / `disabled` / `loading` |
| StoryCard | `current` / `no-action` / `completed` |
| SegmentedTabs | `selected` / `focus` |
| WorkCard | `active` / `optional` / `paused` / `empty` |
| ReceiptCard | `success` / `failure` / `no-duplicate-reward` |
| JournalTimeline | `empty` / `filled` |
| ToolGrid | `hidden` / `available` |

## 5. 冻结局部命名空间与精确 token 值

### 5.1 命名空间规则 `[I]`

1. 唯一 career UI 根类为 `.ac-career-ui`。所有面板、chip、SVG、动画、状态类必须以 `.ac-career-ui` 为祖先或本身；允许的根级例外只有命名空间状态类（如 `html.ac-career-ui-scroll-lock`）。
2. 自定义属性统一 `--ac-career-ui-*`，只声明在 `.ac-career-ui` 上。禁止在 `:root`/`html`/`body` 写 career token，禁止覆写宿主 `--ac-*`、`--studiokit-shellbar-h`、`--ac-hint-refund`、`--ac-thumb-lift`。
3. 禁止无作用域的 `.panel` / `.surface` / `.primary` / `.secondary` / `.icon` / `.tabs` / `.tool` / `.timeline` / `.close` / `.stack` 等通用类名；这些只允许作为 `.ac-career-ui__*` 或带根前缀的组合。keyframes 统一 `ac-career-ui-*`。
4. 旧模块注入的一次性 `<style>`（town/world-state/hangar/market/workshop）由各自 adapter 的 T12/T13 迁移到 T11 共享 CSS；迁移完成前不得扩大它们的选择器范围。T11 CSS 只装载一次，重复装载要有幂等保护。
5. 不引入 CDN、远程字体/图片、框架或测试入口；图片资产仅本地内联 SVG 或同源静态资源，装饰元素 `aria-hidden="true"`。

### 5.2 精确 token（来自 `prototype/tokens.css`，不得换算或近似）

```css
.ac-career-ui {
  color-scheme: dark;
  --ac-career-ui-bg: #171b21;
  --ac-career-ui-surface: #20252c;
  --ac-career-ui-story: #292822;
  --ac-career-ui-border: #ffffff20;
  --ac-career-ui-ink: #f0f1ee;
  --ac-career-ui-muted: #aeb6c2;
  --ac-career-ui-gold: #d6b477;
  --ac-career-ui-gold-light: #e6d4ac;
  --ac-career-ui-on-gold: #1c1917;
  --ac-career-ui-success: #6ee7b7;
  --ac-career-ui-danger: #f3a49a;
  --ac-career-ui-radius: 10px;
  --ac-career-ui-panel: 440px;
  --ac-career-ui-pad: 16px;
  --ac-career-ui-gap: 16px;
  /* 下列四个 raw 值来自 prototype/tokens.css / spec/02-ui-contract.md，必须保留原字面值 */
  --ac-career-ui-stage: #101419;
  --ac-career-ui-scrim: #0009;
  --ac-career-ui-panel-shadow: 0 20px 70px #0006;
  --ac-career-ui-secondary-border: #ffffff30;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  line-height: 1.65;
  color: var(--ac-career-ui-ink);
}
```

### 5.3 派生的精确数值与 raw 字面值

| 类别 | 冻结值 |
|---|---|
| 排版 | 正文 14px/1.65；h1 22px/1.35/600；h2 20px/1.35/600；h3 16px/1.45/600；caption/muted 12px/1.6；分数 32px/1.2/600 且 `font-variant-numeric:tabular-nums`，分数色 `#fbbf24` |
| 间距 | 4 / 8 / 12 / 16 / 24；panel padding `--pad=16px`（≤360px 为 12px）；section gap `--gap=16px`（≤360px 为 12px）；surface/card padding 12px；letter padding 16px；正文段间 8px；按钮 padding 10px 12px |
| 圆角 / 线宽 | panel 16px；surface/letter 10px；primary/secondary/text 8px；tabs 容器 10px / tab 7px；tool 8px；close 8px；harbor 6px；线条 1px |
| 尺寸 | panel 最大 440px；窄屏 `calc(100% - 24px)`；遮罩 `inset:0` + `env(safe-area-inset-*)`；按钮与头像 44×44；icon 24×24 stroke 1.6–1.7；harbor 320:100 / dock 320:112 |
| 背景 raw 值 | tabs 容器 `#101419`；selected tab `#343a43`；avatar `#ffffff0c`；tool 常态 `#ffffff08` / hover `#ffffff12`；secondary hover / text hover `#ffffff08`；close hover `#ffffff10`；timeline line `#ffffff30` |
| 状态 | button disabled `opacity:.55`；primary active `translateY(1px)`；focus `2px solid #e6d4ac` offset 3px；动画淡入 120–180ms（overlay 140ms、sheet 160ms、clue 160ms，ease-out，仅一次） |
| 减动效 | `@media (prefers-reduced-motion:reduce)` 与 `reducedMotion=true` 双保险：无 animation / transition / transform / scroll-behavior 动画；结构仍完整 |

### 5.4 T11 必须实现的精确 harbor inline SVG `[I]`

`career/ui/harbor.js` 必须原样实现 `prototype/reference.js:4` 的 `harbor(dock=false)`：无远程资源、无外部图片、无重新配色或重画；只有 `dock` 布尔切换 320:112 / 320:100，根节点 `aria-hidden="true"`，文字另由 DOM 提供。T15 用同一函数在原型等价 fixture 与产品面板渲染。

```js
const harbor=(dock=false)=>`<svg class="harbor" viewBox="0 0 320 ${dock?112:100}" aria-hidden="true"><rect width="320" height="112" fill="#122331"/><circle cx="${dock?250:228}" cy="25" r="16" fill="#d7bd8c"/><path d="M0 57 L50 29 100 57 150 34 211 55 260 41 320 61 V112 H0Z" fill="#243d4c"/>${[8,45,84,126,167,217,266].map((x,i)=>{const y=47+i%3*6;return `<rect x="${x}" y="${y}" width="${30+i%2*7}" height="30" fill="#37474e"/><path d="M${x-2} ${y} l17 -12 l20 12Z" fill="#1c303e"/><rect x="${x+8}" y="${y+9}" width="7" height="8" fill="#d7bd8c" opacity=".7"/>`;}).join('')}${dock?'<path d="M44 81 V24 H100 M65 24 L44 43 M92 24 V49 M199 82 V17 H235 M225 17 V43" fill="none" stroke="#52616a" stroke-width="3"/>':''}<rect y="77" width="320" height="35" fill="#142d3d"/>${[20,62,135,180,234,273].map((x,i)=>`<path d="M${x} ${86+i%2*7} h25" stroke="#d7bd8c" stroke-width="1.5" opacity=".25"/>`).join('')}${dock?'<text x="12" y="16" font-size="9" fill="#e6d4ac" letter-spacing="2">REFRACTION HARBOR</text>':''}</svg>`;
```

fixture 中的 harbor props 只描述 `variant` 与 `viewBox`；实际 DOM 由 T11 `harbor.js` 输出，不使用字符串占位路径。

## 6. P01–P10 截图夹具冻结

机器可读夹具见同任务新增的 `tools/career_ui_fixture_states.json`。以下为冻结语义；JSON 是唯一数据源，本文不重复所有文案 `[I]`。

| ID | 状态 | 关键组件、数据与负向断言 |
|---|---|---|
| P01 | 普通结算 + 线索轻提示 | 真实映射 `CL-gold-miner` / `gold-miner` / `nature.miner`；ClueRow 在结算主按钮之后，分数与「再来一局」优先；未触发时无 chip，不显示任务/报酬 |
| P02 | 字条 | LetterCard unread，金色标题、两段合成正文、右签名；两个动作：接受邀请 / 以后再说；不显示任务字段 |
| P03 | 首次到港 | 本地 dock harbor SVG + NPCDialogue first + 首份合成委托；接受工作与离开两个动作；SVG 装饰且文字独立 |
| P04 | 工作回执 | ReceiptCard success，真实 ID `gold-miner.T1`；结果、报酬、身份、经历、NPC 回话、继续/离开；`duplicate=false` 不重复奖励 |
| P05 | 已有身份的另一游戏 | `CL-shadow-leap` / `shadow-leap` / `adventure.relicseeker` 独立线索；不重播首次身份/序章，不显示已有职业任务 |
| P06 | 后续邀请 | NPCDialogue optional + 接受/以后再说；保留已知世界语境；无任务标题、目标或奖励 |
| P07 | 港口眼下 | CareerShell + harbor + SegmentedTabs(home) + StoryCard(current) + 至多一条 ClueRow(recoverable) + **至多一条**由 §3.1 注入的 `story.messages` + ToolGrid 四个真实工具 `wallet/shop/workshop/hangar`（`store` 仅为 `shop` 图标名） |
| P08 | 工作 | SegmentedTabs(work)；仅已接受职业卡使用真实 registry ID；世界工作卡 `professionId:null`，`pendulum-tower.T1` 只用通用文案，不暴露职业或游戏来源 |
| P09 | 经历 | SegmentedTabs(journal) + JournalTimeline(filled)；真实历史顺序，无总数/占位/锁定项 |
| P10 | 空 / 加载 / 失败 / 长文本 | 四个 variant：empty、loading(`aria-busy`)、error(可重试)、longText(滚动不截断)；纯街机路径不受阻 |

夹具内容规则：

- 所有 `clueId` / `gameId` / `professionId` / `commissionId` 必须来自 `career/content/registry.json`、`clues.json`、`commissions.json`、`world-work.json` 的真实映射；文本一律合成、非剧透，且不在正式页面出现。
- 夹具不使用外部包中的示例人物、示例物件、示例任务名或示例分数；`productionVisible:false` 是硬标记。T15 若把夹具接到 dev/test 路由，必须在正式构建中不可达，且不留页面内调试入口。
- 所有 `Action` 的 `id` 即 `actionId`；T15 QA 工具按 `actionId` 注入 `onClick` stub（见 §4.1），用于验证 busy/disabled/重复点击，不改变产品组件。
- 四条 harbor / ToolGrid / ClueRow / messages 派生规则见 §3.1；夹具里的 `bridgeInput` / `sourceClueId` / `internalParentProfessionId` 都是 QA 元数据，不属于玩家可见 props。P07 第 4 个 tool 只在产品侧由 `productOnlyAssertions` 单独断言，原型侧只覆盖前三项；P10 `letter-longtext` 是 QA-only 新建状态，不属于原型 `screens`。
- 截图矩阵：P01–P09 在 1280×800 与 390×844；P03/P06/P07/P08/P09/P10-longText 另在 320×640 与 844×390 验证；host mode 覆盖普通浏览器、0.19 紧凑模式、PWA standalone（与游戏全屏共存时不改游戏快捷键）。

## 7. 文件所有权冻结（0.23）

下表为唯一可写面；未列出的 runtime / CSS / 组件 / 版本链文件一律不得由 T10–T14 修改。lead 串行整合 bridge loader 与 registry loader，worker 不碰共享集成点 `[I]`。

| 任务 | 唯一可写文件 / 目录 | 禁止触碰 | 交付 |
|---|---|---|---|
| T10（本任务） | `docs/arcade-life/ADR-0.23-ui.md`、`tools/career_ui_fixture_states.json` | 其他一切文件 | 宿主差异、props/token/夹具/所有权冻结；无测试与浏览器结论 |
| T11 | 新增 `career/ui/tokens.css`、`career/ui/components.css`、`career/ui/components.js`、`career/ui/harbor.js`；共享 token、12 个逻辑组件、原型精确 inline harbor、焦点/滚动/浮层基座 | 现有 adapter 的业务分支、bridge/DB/registry、版本链、游戏页 | `harbor.js` 必须实现 §5.4 的原型精确 SVG，不接受 SVG 文件替代或待决占位；命名空间 CSS 与组件 API，不得写全局选择器 |
| T12 | `career/ui/clue-surface.js`、`career/ui/mailbox.js`、`career/ui/receipt.js`、`career/ui/invitation.js`，以及新测试；P01–P06 | T11 文件、bridge、DB、T13 文件 | 结算线索、字条、首次到港、邀请、回执只消费冻结 props 与投影 |
| T13 | `career/ui/town.js`、`career/ui/world-state.js`、`career/ui/market.js`、`career/ui/workshop.js`、`career/ui/hangar.js`、`career/ui/settings.js`、`apps/arcade/index.html`，以及新测试；P07–P10 | T11/T12 文件、bridge、DB、content JSON | 港口首页 / 工作 / 经历 / 工具 grid 与空、加载、失败、长文状态 |
| T14 | 只新增 `career/content/narrative-shards/shard-01.json` … `shard-04.json`（16 职业按 4 shard，稳定 ID 来自 registry）及 T14 专属测试 | UI、bridge、DB、`registry.json` 公共映射、版本链；不得改已发布 content | 16 个真实职业的完整节拍、已有身份变体与 §3.1 所需的公开 `story.messages` 条目；由 lead 串行合并/注入 |
| lead（串行） | `career/bridge.js`（loader / uiContext）、`career/registry.js` 与 `career/content/registry.json` 的公共映射、`apps/arcade/sw.js`、版本链、测试与集成分支 | 覆盖 worker 未提交改动 | T11–T14 文件接入顺序、SW 预缓存、版本与门禁 |

T15 只消费本 ADR 与夹具做截图/可访问性验证；发现契约问题应回写本 ADR，不得在 adapter 内私改 props 或 token。

## 8. 视觉对齐测量方法（目标，非通过结论）

1. **QA DOM fixture + 同视口**：T15 在相同 OS、浏览器与 DPR=1、缩放 100% 下，用同一份 fixture 同时渲染两侧。产品侧消费冻结组件 props；原型侧按 `capture.referenceInjection.byFixture`（含 `P01`–`P09`、`P10-empty|loading|error|longtext`）对 QA-only 原型副本执行完整同构规范化：`text` 覆盖真实存在的节点、`remove` 删除未映射的示例节点（P02 第三段、P10-loading「恢复示例」、P10-longtext 克隆主按钮）、`create` 为产品已有的 P07 `story.messages` / P08 世界工作卡 / P10 longText 状态创建同构可比较节点；产品独有第 4 tool 只列入 `productOnlyAssertions`，不参与原型比较。未映射的旧示例文本不得残留。每张 reference PNG 只作构图/几何参考，不与示例文案逐元素比较；不做整图像素阈值比对。
2. **只比面板区域**：原型抓 `.panel`，产品抓 `.ac-career-ui__panel`；先按 panel 左上角归一化，再比较其间元素相对坐标。P01 只比 ClueRow 元素与其在结算中的相对次序，宿主结算弹层属于游戏样式，不要求与原型一致。
3. **精确项**：computed `color` / `background-color` / `font-family` / `font-size` / `line-height` / `font-weight` / `border-width` / `border-radius` / `padding` / `gap` 必须与第 5 节一致；几何项（panel 宽、卡片宽、按钮高、icon/avatar 尺寸、harbor 比例、相邻元素左右对齐）目标 `<=4 CSS px`。
4. **文字换行差异**：若度量相同但行数/换行点不同，记录两侧实际字体 fallback、每行文本、元素宽度与 `scrollHeight`，标为「可解释的换行差异」，不把整行像素差当 FAIL；不得通过改字号、letter-spacing 或牺牲 44px 热区强行对齐。
5. **短视口**：320×640 与 844×390 只验证 P03/P06/P07/P08/P09/P10-longText 的可读、可滚、可退出和横向零溢出；允许内容因换行产生高度差，但不允许固定高度截断、按钮被裁或页面横向滚动。
6. **状态断言**：P10 loading 保留骨架且 `aria-busy=true`；error 有可见重试；empty 无占位职业；长文可滚到底部且关闭按钮始终可达。任一明显构图/层级/按钮/断点偏差由 T15 reviewer 判 FAIL。
7. **静态覆盖 validator**：截图前先运行纯静态检查，遍历 `referenceInjection.byFixture` 与 `referenceInjection.targets`：每个 byFixture key 必须存在对应 targets；每个 `prototypeSelectors` 必须由同 fixture 的 `text/remove/create` 操作覆盖（`create` 用 `createsSelector` 匹配）；每个 `productFixturePaths` 必须能在 fixture 中解析且被至少一个操作引用；`productOnlyAssertions` 不得出现在 prototype targets；P02/P10-loading/P10-longtext 的必需 remove 必须存在。报告按 fixture 输出 `targets/covered/missing/productOnlyExcluded`，`missingCount=0` 才可进入 T15 截图。本轮已运行该静态检查并通过，但不等于视觉/浏览器通过。
8. **证据边界**：本任务未运行截图、浏览器或 full；上述 `<=4px` 是 T15 目标。原型 README 已声明其自身只在 Chromium 做过无溢出/脚本错误检查，未验证目标仓库、真实存档或 PWA（`prototype/README.md:5`），不得据此声称 0.23 已对齐。

## 9. 待决策与未验证

1. `[已串行集成]` T11/T12/T13 新增文件按第 7 节文件名接入 bridge loader、uiContext 与 SW 预缓存；叙事 shard 经 narrative-registry 同源加载。
2. `[待 T15 确认]` H4：P01 ClueRow 在宿主结算弹层锚定、原型在面板内；建议保持宿主锚定并只比线索元素本身。
3. `[已冻结并记录]` H3：宿主打开面板聚焦关闭键，而原型聚焦标题；T15 不把焦点落点差异判为视觉 FAIL，但必须验证键盘可达与关闭回焦。
4. `[待 T14]` 16 职业真实叙事文案尚未产出；夹具只绑定既有 registry 真实 ID 与合成文本，禁止把夹具文案提升到 `narrative-shards/*.json`。
5. `[U]` 真机、PWA 实机、0.19 紧凑真机手感、full、发布与双端验证全部未执行；本 ADR 不对它们作通过声明。
