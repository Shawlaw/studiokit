# Arcade Life 0.18 故事可理解性 / 新手惊喜 / 难度试玩（D18-15）

- 分支：`feat/arcade-life-015`（本地，未推送、未发布）；批次：0.18 星塔回响（D18 并行）。
- 状态：**走查完成**；问题清单 12 条（5 高 / 5 中 / 2 低）。其中 I1/I2 建议作为产品入口阻塞项、I3–I5 建议在 0.18 收口前处理，其余可随内容/集成卡修正。
- 写入范围：**只写本文件**；未改任何内容 JSON、运行时模块、测试或游戏页；未做 git 操作。
- 证据（仓库外）：`qa/evidence/D18-15.md`（命令、退出码、三份探针全表、Chrome 截图路径）。契约：[ADR-interfaces.md §20](ADR-interfaces.md)；经济口径：[BALANCE-017.md](BALANCE-017.md)；0.17 基线：[G17-EVIDENCE.md](G17-EVIDENCE.md)、[INTEGRATION-0.17.md](INTEGRATION-0.17.md)；入口设计：[INTEGRATION-0.15.md](INTEGRATION-0.15.md)。
- 相关文件：内容 `apps/arcade/career/content/{campaign,campaign 章节,ending-*,npc,side-stories,commissions,clues}.json`；运行时 [campaign-core.js](../../apps/arcade/career/campaign-core.js)、[story-evidence.js](../../apps/arcade/career/story-evidence.js)、[ending-reducer.js](../../apps/arcade/career/ending-reducer.js)、[bridge.js](../../apps/arcade/career/bridge.js)；面板 [world-state.js](../../apps/arcade/career/ui/world-state.js)、[mailbox.js](../../apps/arcade/career/ui/mailbox.js)、[town.js](../../apps/arcade/career/ui/town.js)、[receipt.js](../../apps/arcade/career/ui/receipt.js)；门禁 `tools/career_{campaign_core,graph_reachability,world_state,discovery_accessibility}_test.mjs`。
- 试玩口径：真实 `content/*.json` + 真实 `campaign-core.js` / `story-evidence.js` / `ending-reducer.js` / `ui/world-state.js`，纯 Node 探针（仓库外）+ 本机 Chrome（headless）门禁实跑；**没有真人试玩、没有真机**，所有"玩家会……"结论都是静态/脚本推理，时长与成功率仍为 UNVERIFIED（§6）。

## 1. 方法与证据

| 证据源 | 命令 / 文件 | 结果 |
|---|---|---|
| 章节/旗标内容校验 | `node tools/career_campaign_core_test.mjs` | PASS 53/53，exit 0 |
| 48 条主线可达性 | `node tools/career_graph_reachability_test.mjs` | PASS 48/48 路径、1089/1089 checks，exit 0 |
| 章节面板（真实 Chrome） | `node tools/career_world_state_test.mjs` | PASS 109/109，exit 0（320/375/390/430 无溢出、按钮 ≥44px、Esc/焦点、reduced-motion、经典键零改动） |
| 微线索/信箱（真实 Chrome） | `node tools/career_discovery_accessibility_test.mjs` | PASS 75/75，exit 0（首屏 0 生涯 CTA、chip 44px、忽略 chip 经典可继续） |
| 静态校验 | `py -3 tools/validate_site.py` | PASS，exit 0 |
| 真实内容探针 | 仓库外 `%TEMP%\d1815\probe{,2,3}.mjs` | 见 §2–§4 全部数字（§7 复跑） |
| 视觉核对 | 仓库外 `arcade-life-devkit/work-015-018/qa/artifacts-d18-12/world-*.png` | 面板早期状态与六章卡片实际渲染（§2.2） |

走查内容指纹（SHA-256，本次读取时）：

| 文件 | SHA-256（前 16 位） |
|---|---|
| `content/campaign.json` | `8D1D84BB1BBC9752` |
| `content/chapter-00.json` … `-05.json` | 依次 `2BE94D30…` / `79D339F5…` / `366CBED1…` / `87D303DD…` / `5FAD38F8…` / `E5296515…` |
| `content/npc.json` | `7ECF0CADB4182FA5` |
| `content/side-stories.json` | `DAA5B351B3F878EC` |
| `content/commissions.json` | `85D3C07A63B664F0`（与 BALANCE-017 §2 一致） |
| `content/clues.json` | `95F2FA3D7DBAE592` |
| `career/campaign-core.js` | `F32A4DD5BEEE923A` |
| `career/ending-reducer.js` | `0ED5FAEA3319B38E` |
| `career/ui/world-state.js` | `250455DE74E189A2` |

内容骨架：`campaign` 6 章 / 3 终局 / 16 起源 / 96 委托 / 43 证据 token / 5 支线家族 / 3 NPC；`chapter-01.json` 仍是 `contentVersion=0.17.0`（campaign-core 仅 warning `chapter-content-version:C1`，validate 仍 `ok:true`）。

## 2. 六章走查（真实内容）

### 2.1 总表

| 章 | 玩家在不知道故事的情况下能做什么 | 必须知道的事实能否在戏内回看 | 三条替代路线能否看懂 | NPC 回信能否跳过 |
|---|---|---|---|---|
| C0 | 读线索信 → 按地址投递（唯一动作；也可完全不理） | ✗（面板/信件都不复述 C0 事实；14/16 起源的信件不含全文里的关键编号） | 1 条（ADR §20.2 对 C0 允许单入口，可懂） | ✓ 1 条，可跳过 |
| C1 | 接任一 T1 委托、租机、买代办；不被告诉哪条算数 | ✗（事实只出现在 C1 完成后的港口广播，且是隐喻） | ✗（3 条都不渲染；"租机/代办"文案与实际要求不符，见 §2.3） | ✓ 2 条，可跳过 |
| C2 | 做任一 T2（需先做同游戏 T1）、买材料、制模块 | 部分（第 1 条在 E-7 的 C2 回信；第 2 条要等 C3 回信才有一句暗示） | ✗（只显示 1 条 hint；mining 路线无产证委托，market hint 指向不存在的窗口） | ✓ 最多 3 条，可跳过 |
| C3 | 做 T2/T3；面板只给"月影"一条提示 | 部分（两条事实都要靠 C3 回信与广播拼，无明文） | △（explore 可在 T2 产证；ecology/archive 只有 T3 产证；不显示三条） | ✓ 最多 3 条，可跳过 |
| C4 | 做 T2/T3；面板默认会指向 build | ✗/部分（第 1 条要 C4 完成后的广播；第 2 条只在后日谈里出现） | ✗（build 路线 3 条委托全部不产证；logistics 只有 T3 产证） | ✓ 最多 3 条，可跳过 |
| C5 | C4 后选择三条终局之一（面板显示标题+一句话）；进游戏后能看到数值目标 | ✓（三条终局提示 + 后日谈，但只有重新打开面板才看得到） | ✓ 三条终局标题/摘要可读；未标游戏与难度 | ✓ 最多 3 条，可跳过 |

### 2.2 每章观察

**C0（不起眼的印记）**
- 能做什么：点开结算处的小邮戳 chip → 读信 → 「按地址投递」→ 进旧港告示板；不点则对经典无任何影响。除投递外没有任何 C0 专属动作或资源。
- 必须知道的事实能否回看：**不能**。`campaign.json` 的 `mustKnow` 只被 `campaign-core.state()` 读出（`chapterViews`，`campaign-core.js:1666-1693`），面板 `ui/world-state.js` 只渲染标题/状态/一条 hint（`chapterRowOf`，`:1324-1337`）；`chapter-01.json` 的 16 段起源信（每段都有更完整的叙事与地址）**没有任何 UI 消费者**（只有 `route-planner.js:571` 读 `c0Letter`，而 route-planner 没有 UI 入口）。
- 路线：单条投递路线，信中有地址 + 按钮，可懂。
- 回信：阿砾 C0 一条（关于免费租机），可跳过。

**C1（旧港的第一封信）**
- 能做什么：告示板 16 张 T1；免费租机；两块「港务处代办」（120 信用点 / 90 信用点+合金 1）。玩家不知道"三条路线"是哪三条，也不知道哪条会推进章节。
- 必须知道的事实：事实只在本章完成后的港口广播里出现一次（`world-state.js:101-114` 的 `BROADCAST`），且没有"信号与编号吻合"的明文；面板 hint 只有一句。
- 路线：**不可懂，且文案与实际相反**（详见 §2.3/§4.5）：
  - `rental`「免费租机出航」实际要求 `C1.flight_done` = `star-raid.T1` 的 boss 战（`commissions.json` 中 `star-raid.T1` 的 `reward.flags` 才发 `C1.flight_done`）；租机本身不发任何章节旗标。
  - `noncombat`「委托港务处代办 / 不想战斗，也能把信号买回来」实际要求 `C1.work_done` 或 `C1.storm_done`（`pendulum-tower.T1` / `star-raid.T2`）；代办只发 `C1.signal`/`C1.records`（`alternatives.js:105-127`），既不在任何 C1 路线要求里，也不被 `campaign-core.syncFlags` 认（`campaign-core.js:1948-1970`、`firstMetRoute` `:1844-1852`）。花 120 信用点不会推进章节（探针：`C0 + C1.signal + C1.records` → C1 仍 `active`、三条路线 `available:false`）。
- 回信：E-7 + 阿砾各一条，可跳过。

**C2（谁留下了七号货柜）**
- 能做什么：做任一 T2（T2 需先清同游戏 T1）；没有路线列表，只有一条 hint（research："晨光研究院愿意看晶格模型。"）。
- 必须知道的事实：第 1 条在 E-7 的 C2 回信里（当前章可见）；第 2 条要等玩家进 C3 后由 E-7 的 C3 回信间接带出，且从不明文；`chapter-02.json` 的 body 不渲染。
- 路线：**不可懂**。面板只显示 research 一条；mining 与 market 两条在章节 active 时不可见（`pickHint` 取第一条可用 hint，`world-state.js:824-843`）。实际：
  - research：有产证委托（`memory-flip.T2` 给 E；`merge-2048.T3` 给 BP），本路线 2–3 局；注意 C2 还要求"另一个不同游戏的 E"，所以单靠本路线不够；
  - mining：`gold-miner.T2/T3` **都不产证据**，严格按提示做完不会完成 C2；
  - market：hint 指向"港务处的贸易窗口买研究院认证的样本"，但市场只卖 5 种材料、全仓库无"认证样本"物品/机制（`materials.js`/`items.json` 探针）；真正能产证的是 `gomoku.T2`（E），`blackjack.T2`/`solitaire.T2` 不产证。
- 回信：E-7 / 阿砾（C1 的旧条）/ 黎序，最多 3 条，可跳过。

**C3（月影里的时间差）**
- 能做什么：T2/T3；面板默认只给 explore 一条（"旧观测站的坐标在月影一侧。"）。
- 必须知道的事实：两条都只在 C3 回信里被间接表达（暗示而非明文，且需要玩家把两章信息拼起来），body 不渲染。
- 路线：△ 三条都"能推进"，但 **ecology / archive 只有 T3 级委托产证**（`snowbells.T3`、`snake-run.T3`、`solitaire.T3`）；T2（`snowbells.T2`、`snake-run.T2`、`solitaire.T2`、`memory-flip.T3`）不产证。玩家按"看一眼就够"的 hint 做完 T2 会发现章节没动。
- 回信：E-7 / 阿砾（旧）/ 黎序，可跳过。

**C4（停摆的城市）**
- 能做什么：T2/T3；面板在玩家做完 `mole-whack.T2` 后会把 hint 切成 build（"港口需要一座稳定的临时能源塔。"）。
- 必须知道的事实：第 1 条（供电恢复）要等 C4 完成后的广播；第 2 条只在终局后的后日谈里出现。面板正文没有事实回看。
- 路线：✗/△。**build 的三张委托（`pendulum-tower.T3`、`brick-breaker.T3`、`mole-whack.T2`）全部不产证据**——按提示做完 build 路线不会完成 C4；logistics 只有 T3 产证；maintenance 只有 `gomoku.T2` 产证（1 条，通常不足以单独跨过 C4 的证据门槛）。玩家最可能被面板主动引到唯一"完全无效"的那条路线上（见 §4.5）。
- 回信：E-7 / 阿砾 / 黎序（旧），可跳过。

**C5（星塔的回响）**
- 能做什么：C4 完成后，面板出现三终局（标题+摘要+按钮），点击直接进对应游戏；游戏内目标行会显示数值（大数值用"目标 N 米/N 次"，`road-rush.html:354-362`、`merge-2048.html:270-275`）。
- 必须知道的事实：三条终局提示 + 完成后后日谈，**可回看**（`epilogueSectionOf`，`world-state.js:1508-1519`）；但入口仍只有"信箱→章节"（见问题 I1）。
- 路线：三条终局可读；未写"用哪款游戏/多难"。终局失败可重打（不写 C5）；同生涯只能解决一次（`ending-reducer` 语义）。
- 回信：E-7 / 阿砾（旧）/ 黎序，可跳过。

### 2.3 三条替代路线：实际有效性与可读性

> 关键前提：`campaign.json` 的 `routes` **只用于展示与 `campaign-core` 可达性推导**，运行时 C2–C4 旗标由 `story-evidence.js` 按"证据类目计数"授予（`story-evidence.js:125-176`），C5 由 `ending-reducer`。因此"路线要求"与"实际推章"是两套东西。

| 章 | 路线 | 面板可见？ | 声明的委托（tier） | 其中产证委托 | 按声明委托能否推章 |
|---|---|---|---|---|---|
| C1 | work_ship / rental / noncombat | ✗（只有 1 句 hint；三条名字只在锁定态 fallback 里出现） | 实为 `C1.work_done/flight_done/storm_done` | `pendulum-tower.T1`、`star-raid.T1/T2` | work_ship ✓；rental ✓ 但文案误导；noncombat △（可由 work_done 满足，但 label/hint 指向的代办不算 → 文案死路） |
| C2 | research | ✓（active 时默认显示） | `merge-2048.T2/T3`、`memory-flip.T2/T3` | `merge-2048.T3`(BP)、`memory-flip.T2`(E) | ✓（2–3 局；仍需另一个不同游戏的 E） |
| C2 | mining | ✗（做掉 gold.T2 后会替换成这条） | `gold-miner.T2/T3` | 无 | **✗ 死路** |
| C2 | market | ✗ | `blackjack.T2`、`gomoku.T2`、`solitaire.T2` | `gomoku.T2`(E) | ✓（但 hint 指向不存在的窗口） |
| C3 | explore | ✓（默认） | `shadow-leap.T2/T3`、`gravity-flip.T2/T3` | `shadow-leap.T2`(E)、`gravity-flip.T3`(BP) | ✓（T2 或 T3） |
| C3 | ecology | ✗ | `snowbells.T2/T3`、`snake-run.T2/T3` | `snowbells.T3`、`snake-run.T3` | △ 仅 T3 |
| C3 | archive | ✗ | `memory-flip.T3`、`solitaire.T2/T3` | `solitaire.T3` | △ 仅 T3 |
| C4 | build | ✓（做完 mole.T2 后替换成这条） | `pendulum-tower.T3`、`brick-breaker.T3`、`mole-whack.T2` | 无 | **✗ 死路** |
| C4 | logistics | ✗ | `road-rush.T2/T3`、`block-drop.T2/T3` | `road-rush.T3`、`block-drop.T3` | △ 仅 T3 |
| C4 | maintenance | ✗ | `mole-whack.T2`、`gomoku.T2`、`blackjack.T2` | `gomoku.T2` | △ 1 条证据，通常不够 |

结论：**9 条 C2–C4 路线里 2 条完全不产证、3 条只有 T3 才产证；UI 上任何时刻最多只显示 1 条 hint（且常是被玩家刚做完的委托"点亮"的那条），所以"三条替代路线"在戏内既不可见，也不都成立。** 这是 0.18 故事可理解性的核心结构问题（问题 I3/I4/I9）。

### 2.4 NPC 回信

- **可跳过**：面板默认展开回信，`「跳过回信」/「看看回信」` 切换（`world-state.js:1357-1397`），`aria-pressed`、44px、有播报；不读回信不阻塞任何操作。Chrome 测试覆盖（109/109 中的 REPLIES 组）。
- **不可回看历史**：`repliesOf` 只取"每个角色当前章或之前最新的一条"（`:1156-1196`）。C2 时能看到 E-7 的 C2 回信；进入 C3 后它被 C3 那条替换、不再出现；同理黎序的 C2 条到 C4 时已被 C3 条顶掉。玩家想复看上一章回信只能凭记忆（问题 I10）。
- 可见性正确：不会提前显示未来章节的回信（探针逐章核对：C0 → 1 条；C1 → 2 条；C2/C3 → 3 条，且全部 ≤ 当前章）。
- 每章至少 1 条（campaign-core validate 强制），当前 6/6 章满足。

### 2.5 六章走查的横向结论

1. **故事的"骨架"（mustKnow + chapter body）在戏内没有阅读面**：面板只有标题/状态/一句 hint；body 被 `normalizeSnapshot` 丢弃（`:579-624`）；16 段起源信无消费者。
2. **章节推进没有即时反馈**：委托结算后 `bridge` 调用 `story-evidence.recordFromReceipt` 写入 C2–C4 旗标（`bridge.js:1240-1258`），返回值被忽略；收据 UI 只有钱/材料（`receipt.js` 无证据/剧情字段）。玩家要自己回到章节面板才知道"刚那一局推了一章"。
3. **章节可能被"跨级"完成**：见 §4.1。

## 3. 新手惊喜与"不被入口剧透"检查

| 检查项 | 结果 | 证据 |
|---|---|---|
| 中心页无生涯 CTA / 无信箱入口 | ✓ 0 处 | `apps/arcade/index.html` 全文无 `career/信箱/旧港/mailbox/线索` 匹配；G17 门禁"中心页 career 引用 0" |
| 游戏首屏无 CTA / 无 chip / 无弹窗 | ✓ | 真 Chrome `P01/P02`、`Q01/Q02`：positive=0、careerNodes=0、dialogs=0、chips=0 |
| 信箱入口只在发现线索后出现 | ✓（chip 仅在新发现+持久化成功+提示开启时渲染，`bridge.js:2263,2283-2297,2291`） | 无发现时 chip=0（P02/Q02）；B36 忽略 chip 经典照常 |
| 线索 chip 不压中心区 / ≥44px | ✓ | P03/P04/Q03/Q04，chip 约 123–135×44，y≈673–749 |
| 章节面板不自动弹 | ✓ | 唯一玩家入口是信箱按钮（`mailbox.js:413-427`）；`openCampaign` 只在点击时调用；委托/终局结算与面板无关（`bridge.js:2834-2836`） |
| 面板在投递前不剧透 | ✓（仅一句"信还没送到旧港……"） | `revealedOf`（`:1034-1040`）与 `GATE_TEXT`（`:46`） |
| 终局 C4 前不可见 | ✓ | `model.endingVisible`（`:1028`）；`campaign-core.endingOptions` C4 前全 `available:false`（探针） |
| T4–T6 不提前出现在告示板 | ✓ | 告示板只列已解锁委托（`town.js` `applyUnlocked`）；T4–T6 有 `chapterGate`（探针：48/48 有 gate） |
| 无强制阅读 / 计时等待 | ✓ | 生涯 UI 无倒计时/自动翻页；仅 `settings` 30ms 状态、`workshop` 防抖、chip host 100ms×20 轮询、DB 事务超时，均非玩家等待 |
| 老玩家忽略线索不被打扰 | ✓ | 真 Chrome B36：忽略 chip 后点"开始游戏"经典可继续；面板/棋布/存档不变（SAFE 组） |
| 关闭线索提示的入口 | △ 只在生涯内（告示板「线索提示」），纯经典玩家无法关闭 | `town.js:49,965`；settings 无独立入口 |
| 章节完成通知 | ✗ 无 | 见 §2.5-2 |

### 3.1 三类玩家观察

**新手（第一次从经典局发现线索）**
- 惊喜点是成立的：结算处出现一枚暗色小邮戳，点开是一封有人名、有旧港地址的信；投递后进入告示板，戏内语言统一、没有"生涯模式/等级/奖励"字样（`receipt.js` 甚至内置禁用词表）。整条链路 0 强制弹窗、0 倒计时。
- 第一次能做的全部动作只有"投递"；这足够，但没有任何文字说明"这封信会开启一段六章故事"，也没有"回旧港"之类的常驻入口。
- 风险：投递后玩家会看到 16 张 T1 工单（告示板全量列出已解锁项）；面板章节入口在投递前就可点（看到一句"信还没送到旧港"），属轻度死点击。
- 新手最容易被 C1「不想战斗，也能把信号买回来」误导：花 120 信用点买代办后章节不动，而这是新手在本作里最贵的一次误消费（初始 80 + 1 局 T1 才够 120）。

**回流（0.15–0.17 已发现过线索、甚至已有委托记录）**
- 严重的入口断点：信箱没有常驻入口——唯一的 UI 通道是"新线索 chip"（`bridge.js` 仅在 `alreadyDiscovered=false` 时渲染）。已把常玩游戏线索拿全的回流玩家，刷新后**没有任何 UI 能再次打开信箱/告示板/章节面板**（`openMailbox` 只挂在 JS API 与测试 API 上，仓库内无调用方；中心页/游戏页/收据页均无按钮）。`INTEGRATION-0.15.md` 的"忽略后可找回"与 `settings.js` 的"已发现内容仍可在信箱找回"目前只在 API 层成立。
- 一次委托结束后同样没有回告示板的路径（收据只有"收起"）；终局结算后也不会自动打开后日谈，玩家想读后日谈必须再走一遍"信箱→章节"——而这一步在拿到结局后往往已不可达（该游戏线索早已发现）。
- 章节状态方面：0.17 存档里已有 C2–C4 的 quest 旗标与 T1/T2 的 `C1.*` 旗标；0.18 首次打开信箱时 `campaign.syncFlags` 会补 C0/C1，因此回流玩家可能一次性看到"六章里大半已完成"，直接从终局开始——与"六章逐步揭开"的叙事节奏不符（按旗标推导；无真实 0.17 存档 fixture，UNVERIFIED）。
- 正面：0.18 未新增存储键，回流玩家的经典记录/线索/委托数据都还在（`world-state` SAFE 组与 G17 证据）。

**只玩经典（从不点线索）**
- 无 CTA、无弹窗、无强制等待；唯一的视觉差异是每款游戏首次触发线索时的一枚 44px 暗色 chip，位于结算层角落，不压画布中心（P04/Q04）。
- 职业 run 才出现的"委托目标行"不会出现在经典局；章节面板打开时经典画布尺寸/位置不变、不写 localStorage/经典存档（D18-12 Chrome SAFE 组）。
- 唯一不便：想关掉 chip 必须先进入生涯（设置入口在告示板）；不过忽略它没有任何惩罚，也不影响记录。

## 4. 难度与节奏

### 4.1 真实推章路径 ≠ 展示路线

`story-evidence.js` 默认规则（`:125-176`）：

| 旗标 | 证据条件（摘要） |
|---|---|
| C2 | 2 个 E（不同游戏）或 E+BP 或 E+MAP |
| C3 | C2 且（3 个 E 或 BP 或 2E 不同游戏+MAP 或 2MAP 或 E+BP） |
| C4 | C3 且（5 个 E 或 2E 不同游戏+BP 或 2BP 或 2MAP 或 E+MAP+BP） |

用真实内容跑出的最小路径（探针 D）：

| 已结算委托（局数） | 推导出的旗标 |
|---|---|
| `pendulum-tower.T1`（1） | — |
| +`star-raid.T1`（2） | **C2** |
| +`gomoku.T1/T2`（4） | C2 + **C3** |
| +`gravity-flip.T1/T2/T3`（5） | **C2+C3+C4（同一次结算里三章一起完成）** |
| `pendulum-tower.T1` + `memory-flip.T2` + `merge-2048.T1/T2/T3`（6，全程非战斗） | C2+C3+C4 |

- **C2 会在第 2 局被动完成**：C1 的自然路线（工单 = `pendulum-tower.T1`；租机 = `star-raid.T1`）恰好就是 C2 需要的两个 E（不同游戏）。玩家还没看 C2 面板，C2 已完成。
- **C3+C4 可在同一结算完成**：拿到一个 BP（`merge-2048.T3` 或 `gravity-flip.T3`）后，C2/C3/C4 三条规则同时满足。玩家会看到章节面板"一次亮两章"。
- 所以"六章"实际节奏是 C0 →（1 局）C1 →（再 1 局）C2 →（2–3 局）C3+C4 →（1 局终局）C5；**最短约 5 局委托 + 1 局终局**。展示路线自己算出来是 C2 2 局、C3 2 局、C4 2 局 = 6 局（+C1 1 局 +终局 1 局 = 8 局），与真实路径不一致。

### 4.2 每条 C2–C4 路线的 tier / 材料合理性

- **tier 合理**：C2 只需 T2（个别 T3），C3/C4 只需 T2–T3；T4–T6 全部由 C3/C4/C5 门禁锁住，主线不需要 T4+。T3 的 `unlock` 只是"同游戏 T2 已清"，没有额外材料/信用点要求——`commissions.json` 的 96 条**没有 `cost`/`requires` 字段**，接单与失败都不收费。
- **材料不构成门槛**：五材只作为奖励，主线路线（C1–C4）不需要消耗任何材料/信用点；`BALANCE-017.md` §5.3 的制造/飞船/模块全部是可选沉没成本。唯一与经济相撞的是 C1 的代办（120/90 信用点买一个不推进章节的旗标，见 I5）。
- **收入节奏与 BALANCE-017 对得上**：T2/T3 首通常见为 0 信用点（`BALANCE-017.md` §3.1：60/96 首通为 0），收入靠重复薪资 75–95；单局最高 130（`star-raid.T4`），远低于 `payoutCap=400`。主线既然不花钱，"章节推进=技能通关"这一结论成立；但这也意味着**章节路线给不了经济回报**，C2–C4 的 T2/T3 多做只多材料。
- **技能门槛**：路线要求的 T2/T3 都是硬阈值（如 `merge-2048.T2` 生成 64、`gravity-flip.T3` 800 米、`snowbells.T3` 高度 240、`road-rush.T3` 1500 米），没有部分进度。BALANCE-017 的 0.55/0.75/0.9 成功率是任务卡假设（§8 UNVERIFIED），不能代表新手；但失败只损失时间（可重接）。

### 4.3 时长估算（全部 UNVERIFIED）

| 口径 | 局数 | 按内容 `durationHint` 2–5 分钟 | 按 BALANCE 2.5 分钟中位 |
|---|---|---|---|
| 展示路线（C1 1 + C2 2 + C3 2 + C4 2 + 终局 1） | 8 | 16–40 分钟 | ≈20 分钟 |
| 证据最优（C1/C2 共用 2 局 + C3/C4 共用 3 局 + 终局） | 6 | 12–30 分钟 | ≈15 分钟 |
| 误走死路（C2 mining 多 5 局；C4 build 多 8 局） | 8–13 | 16–65 分钟 | ≈20–33 分钟 |

不含菜单/加载/重开/失败重试；真实人类节奏与成功率未采样（`BALANCE-017.md` §8 同样标注 UNVERIFIED）。

### 4.4 终局

| approach | 游戏 | 目标 | 起始参数 | 工钱 | 备注 |
|---|---|---|---|---|---|
| combat 武力解除 | star-raid | 击败 Boss（theme=mothership） | `startLevel:6, themeId:mothership` | 0 | 需要能打到 6 关母舰 |
| research 理性重启 | merge-2048 | 生成 512 | `{}` | 0 | 面板不写"512"，进游戏后目标行显示 |
| rescue 运输救援 | road-rush | 5000 米 | `{}` | 0 | 同上；大阈值依赖 100m 里程碑事件 |

- 三条都可失败重打（不写 C5，不消耗终局）；同一生涯只解决一次（C5 唯一）。
- **没有"放弃委托/换一条终局"的 UI**：`commission-core.abandon` / `ending-reducer.abandonEnding` 只有 API；玩家若开了某条终局又打不动，只能在那款游戏里打到 quit/失败，期间其它终局返回 `occupied`。属软卡（可自解，但玩家不知道怎么做）。
- 终局势必把玩家推进一款"本命游戏之外"的游戏；面板只给标题+一句话，没有"用哪款游戏/大概多难"的提示，接受度未验证。

### 4.5 会让玩家卡死/误导的文案与门槛（内容侧）

| # | 位置 | 现象 | 后果 |
|---|---|---|---|
| A | C1 `noncombat` hint（campaign.json） | "不想战斗，也能把信号买回来"；代办 120/90 信用点 → `C1.signal`/`C1.records`，不是任何 C1 路线要求，也不被 syncFlags 认 | 玩家花掉几乎全部现金，章节 0 进展；这是全作最贵的误消费 |
| B | C1 `rental` label/hint | "免费租机出航" → 实际要求 `star-raid.T1` boss 战 | 玩家以为租船即可；实际要在星海打赢 boss |
| C | C2 `mining` hint | 玩家做完 `gold-miner.T2` 后 hint 切成"矿井里最近有奇怪的晶脉"；gold T2/T3 均不产证 | 玩家按面板指示做 T3，C2 仍不动；面板持续指向死路 |
| D | C2 `market` hint | "港务处的贸易窗口能买到研究院认证的样本"；无此物品/窗口（市场只卖 5 材） | 玩家去找不存在的机制 |
| E | C4 `build` hint | 玩家做完 `mole-whack.T2` 后 hint 切成"港口需要一座稳定的临时能源塔"；build 三委托均不产证 | 玩家连做 2–8 局仍不完成 C4；面板持续指向死路 |
| F | 章节面板 hint 机制 | 锁定章显示 fallback（含三条路线名），active 后只显示一条 | 三条路线信息在真正需要时反而消失 |
| G | 信箱/章节面板入口 | 只有"新线索 chip"能打开；无常驻入口 | 回流玩家 / 委托结算后的玩家无法继续（非文案，但会让人以为"故事到此为止"） |
| H | 章节完成/终局完成 | 无任何即时提示；收据不写剧情 | 玩家不知道刚才那局推进了故事；后日谈需要自己找回来 |

## 5. 问题清单（12 条，建议交给 D18-16/17 与集成/面板 owner）

严重度：高＝会阻断故事或让玩家花真金白银误操作；中＝明显误导/信息缺失；低＝体验瑕疵。
"阻塞?" 是建议口径，不代表发布裁决。

| ID | 严重度 | 阻塞? | 位置 | 问题与证据 | 建议 |
|---|---|---|---|---|---|
| I1 | 高 | **建议阻塞** | 信箱/章节面板入口（`bridge.js` `openMailbox`；`ui/mailbox.js`） | 玩家侧唯一入口是"新线索 chip"（`bridge.js:2263,2283-2297`）；中心页/游戏页/收据页 0 按钮；`openMailbox` 只有 JS/测试 API 调用方。回流玩家与"做完一单想回去"的玩家都回不到告示板/章节面板；终局后也回不到后日谈 | 按 `INTEGRATION-0.15.md` §2 允许的"角落小字"补一个**只在发现后出现**的常驻入口（如游戏页角标/中心页页脚"旧港"），保持发现前 0 CTA；或给委托收据加"回旧港"按钮 |
| I2 | 高 | **建议阻塞** | 章节面板（`ui/world-state.js`） | `mustKnow` 与 `chapter-0X.body` 均无渲染面（`buildChapter:885-919` 收进模型、`chapterRowOf:1324-1337` 不渲染；`normalizeSnapshot` 不拷 body）→ **"必须知道的事实"不可在戏内回看** | 已完成章节卡片加可折叠"这封信记下的事"（渲染 mustKnow + body；仅 complete 章节展开，避免剧透锁定章） |
| I3 | 高 | 建议收口前 | `campaign.json` C2–C4 路线 vs `story-evidence.js` 规则 | 路线不是推章依据：C2 `mining`、C4 `build` 无产证委托（严格按提示做完永不完成）；C3 `ecology/archive`、C4 `logistics` 仅 T3 产证；C2 `market` 只有 `gomoku.T2` 产证。全 9 条路线中 2 死、3 仅 T3 有效 | 让路线委托与产证对齐（给这些 T2 增补证据 token，或把路线改指向产证委托）；若保留"证据类目"规则，至少让 `route.requires` 与实际产证一致，并让 graph 门禁把"产证"纳入可达性 |
| I4 | 高 | 建议收口前 | 章节可达/完成反馈（`bridge.js` 结算后） | 章节完成无任何 UI 反馈；`recordFromReceipt` 返回值被忽略；收据无剧情字段 → 玩家不知道推进 | 结算后若新增/变更 C2–C4/C5 旗标，在收据或角标给一行戏内提示（"港里来信了"），不剧透 |
| I5 | 高 | 建议收口前 | C1 `noncombat` / 代办（`campaign.json` + `alternatives.js`） | "把信号买回来"：代办 120/90 信用点只发 `C1.signal/C1.records`，不满足任何 C1 路线（`campaign-core.js:1948-1970`），花光新手现金也不推章；探针：C0+C1.signal+C1.records → C1 仍 active、路线全 false | 二选一：①C1 路线 `anyFlags` 纳入 `C1.signal`；②代办改发 `C1.work_done` 等价语义/或退钱；并改 hint 不再暗示"买=推章" |
| I6 | 中 | 否 | C1 `rental` label/hint | "免费租机出航"实际要求 `star-raid.T1` boss 战（`C1.flight_done`） | label 改为"租机护航"并把"要在星海打赢首航"写进 hint；或 C1 route 改用租机凭证旗标 |
| I7 | 中 | 否 | 章节 hint 渲染（`world-state.js:824-843,1324-1337`） | 每章只显示 1 条 hint；锁定章显示三条路线 fallback，active 后反而只剩一条；且 hint 会在玩家做完某条委托后切到"死路"那条（C2 mining / C4 build） | active 章节也给出三条路线摘要（label 列表，可点开看要求）；或 hint 只在"该路线能产证"时切换 |
| I8 | 中 | 否 | `side-stories.json` ↔ `world-state.sideStoriesOf` | 5 个家族 links 全为 `XL01–XL10`，`clues.json` 只有 16 个 `CL-*`；真实玩家 `discovered.size>0` 时一律隐藏 → **0.18 可选支线 0 可达**（D18-13 §11.2 已提，仍未修） | 把 links 映射到真实 `CL-*`（或补 XL 节点）；确保"触发后可见"的 Chrome 断言行得通 |
| I9 | 中 | 否 | `chapter-01.json` 起源内容 | 16 段 `c0Letter`（每段含关键编号与地址）没有 UI 消费者；而 `clues.json` 只有 2/16 封信提到该编号 → 14/16 起源在 C1 前拿不到全部前置信息 | 让信箱 C0 信件按首源 `gameId` 优先使用 `chapter-01.origins[].c0Letter`；或把编号写回 `clues.json` 信件 |
| I10 | 中 | 否 | NPC 回信历史（`repliesOf:1156-1196`） | 只显示每角色"当前章最近一条"，旧章回信消失，无法回看；与"可回看"目标冲突 | 章节面板加折叠"往期回信"日志（只列已到达章节） |
| I11 | 低 | 否 | 章节面板锁定章 | 锁定章也显示标题（C2–C5 标题含"七号货柜/星塔"）与 fallback 三路线文案；属轻度前瞻，非答案 | 若要严格零前瞻，锁定章只显示"第 N 封信·尚未送到"，路线文案留到解锁后 |
| I12 | 低 | 否 | 对话式逃离/放弃 | `abandon`/`abandonEnding` 无 UI；开了终局打不动时，其它终局返回 `occupied`，玩家不知道如何换路 | 终局面板给"暂不选择/换一条"的明确出口（调用 abandonEnding） |

### 5.1 建议优先级

1. **先解 I1/I2**（产品入口 + 事实回看）：没有它们，0.18 的六章故事即使内容全对，玩家也读不到、回不去。
2. **再修 I3/I5**（内容对齐）：死路路线与"买了不推进"的代办是玩家实际会踩的坑；改内容 JSON 请走 D18-16/17，并同步 `BALANCE-017` 的口径。
3. **最后 I4/I7/I8/I9/I10**（反馈与内容补全）：可与 0.18 收口并行，不阻塞门禁（当前 graph/campaign 测试只验"委托可接"，验不出"产证/可读"）。

## 6. UNVERIFIED（明确未验证）

- **真机触控/安全区**：chip、面板、收据在 iPhone/Android 真机的拇指热区与 safe-area 未测（只有 Chrome 仿真 320/375/390/430）。
- **读屏器**：VoiceOver / TalkBack 的真实朗读顺序未测；本报告只引用 `career_discovery_accessibility_test` / `career_world_state_test` 的 Chrome a11y 树断言。
- **PWA/离线/更新**：0.18 `sw.js` 缓存清单与旧版本更新、离线打开章节面板未验证（0.18 内容 JSON 新增文件；`sw.js` 当前为并行 worker 修改中）。
- **真实人类时长与成功率**：§4.3 全部是按内容 hint 与 BALANCE-017 假设（2.5 分钟中位、0.55/0.75/0.9）的推算；没有真人采样。
- **真实 0.17 存档迁移**：回流玩家"章节大半已完成"是按 quest 旗标推导，没有真实 0.17 save fixture 回放。
- **终局人类难度**：star-raid 6 关母舰、merge 512、road 5000m 的可达性未做真人/回放验证；fixture 是脚本驱动。
- **多标签/DB 并发/断电**：未验证（沿用 0.17 结论）。
- **D18-01/12/14 外部证据**：本卡写稿时仓库外只有 `D18-09.md`、`D18-13.md` 可读；D18-01/12/14 证据尚未落盘（D18-12 的测试本卡已实跑 109/109）。终局 E2E（D18-14）未跑，不能声称终局真机链路通过。

## 7. 复现

```powershell
cd D:\LocalAgentWorkspace\StudioKit
node tools/career_campaign_core_test.mjs
node tools/career_graph_reachability_test.mjs
node tools/career_world_state_test.mjs            # 需要本机 Chrome（109/109）
node tools/career_discovery_accessibility_test.mjs # 需要本机 Chrome（75/75）
node "$env:TEMP\d1815\probe.mjs"                  # 真实内容：configure/validate/state/路线/回信/支线
node "$env:TEMP\d1815\probe2.mjs"                 # 证据推章序列与"跳章"证明
node "$env:TEMP\d1815\probe3.mjs"                 # 路线矩阵/产证/时长/终局表
py -3 tools/validate_site.py
```

- 完整命令输出、退出码、三份探针全表、截图路径：仓库外 `qa/evidence/D18-15.md`（`D:\LocalAgentWorkspace\qa\evidence\D18-15.md`）。
- 本卡只写本文件；`git status --short` 中本卡只新增 `?? docs/arcade-life/PLAYTEST-018.md`。

## 8. 结论

- 0.18 的"不剧透入口 / 不强制 / 可跳过"三条产品边界成立（中心页 0 CTA、chip 44px、面板不自动弹、回信可跳过、无计时）。
- 但**故事可理解性未达标**：六章的 mustKnow/正文在戏内不可回看；三条替代路线在 UI 上最多显示一条，且其中 2 条无产证、3 条只有 T3 产证；章节可被跨级完成；C1 代办是花钱不推进的陷阱；章节完成/终局完成无反馈；回流玩家没有回生涯 UI 的入口。
- 以上均为内容/集成/面板接线问题，**不需要改游戏玩法或经典记录**；按 §5 的 I1–I5 优先处理后再做一次真人走查（本卡的时长/成功率结论仍为 UNVERIFIED）。
