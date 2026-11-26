# Arcade Changelog

## 0.21.1 — 2026-11-26（本地修复，未发布）

本地分支 `fix/arcade-career-entry-0211`，HEAD `242d0a3`；设计与回滚见 [`DESIGN-0.21.1.md`](DESIGN-0.21.1.md)，集成与验证口径见 [`docs/arcade-life/INTEGRATION-0.21.1.md`](../../docs/arcade-life/INTEGRATION-0.21.1.md)。**未发布**：线上仍为 0.21.0，产品版本链与 SW 缓存键仍为 0.21.0 / `studiokit-arcade-0.21.0-v1`（本次未做版本 bump）。

### Fixed

- 修正 0.21.0「身份建立后也无内容入口」的过度实现：生涯身份一旦建立（已开生涯或已有章节），中心页在经典目录旁常驻「旧港生涯」内容入口，直达 `games/pendulum-tower.html?careerPanel=town`，最小热区 44px；身份建立前仍只有「继续上次」附近的被动来信小字。
- 封存时隐藏常驻内容入口与来信小字，但保留页尾「生涯设置（已封存）」；解冻恢复内容入口；完全重置后内容入口与设置入口一起消失。
- 中心页仍无生涯视图 / 默认视图切换，也不恢复常驻告示板 / 信箱 / 章节链接；经典目录、排序记忆、积分与游玩记录零改动。

### Tests

- 0.21.1 实跑：`career_passive_entry` **59/59 PASS**；`arcade_smoke` **117/117 PASS（第一轮）**。
- `arcade_smoke` 加入 320/375/390/430 四档窄屏增强断言后的最终复跑**仍待主 Agent**；其余门禁、full profile、真机 / 真人（0.21.1）UNVERIFIED。0.21.0 的历史通过数字仅作为已发布基线，不作为本版已跑证据。

### Notes

- 只改 `apps/arcade/index.html` / `arcade.css` 与对应测试断言；不改 localStorage key / IDB v1 / 11 stores / `contentVersion 0.18.0` / 玩法数值 / 关卡数据，不引入远程资源。
- 无 `PUBLISH_TO_MAIN`、无 push、无 Actions / 双端校验 / 线上 0.21.1 证据；不得声称发布成功。

## 0.21.0 — 2026-11-26（已双端发布）

本地分支 `feat/arcade-career-passive-021`。设计 / 回滚见 [`DESIGN-0.21.0.md`](DESIGN-0.21.0.md)，接口冻结见 [`docs/arcade-life/ADR-interfaces.md`](../../docs/arcade-life/ADR-interfaces.md) §22，集成与验证口径见 [`docs/arcade-life/INTEGRATION-0.21.md`](../../docs/arcade-life/INTEGRATION-0.21.md)。**版本链 0.21.0 / SW `studiokit-arcade-0.21.0-v1`；2026-11-26 已双端发布。**

### Added / Changed

- 中心页生涯彻底被动：经典目录不再有生涯视图、默认视图切换或常驻告示板 / 信箱 / 章节入口；错过来信只在「继续上次」附近显示低强调小字，C0 后保留游戏内章节入口与收据回流；生涯已开启 / 已封存时页尾提供二级「生涯设置」入口（封存 / 解冻 / 重置 / 档案，不是内容 CTA），封存时隐藏所有生涯内容入口与结算线索。
- 故事与任务改为面向玩家的第二人称选择式叙事：委托标题 / 摘要、章节 start / progress / complete / next、路线 hint、NPC 回信、支线与三终局统一「你愿意……吗？/ 你想先……哪一项？」视角；选项对应真实可执行动作 / 路线 / 终局，不新增虚假分支；NPC 自述仍保留第一人称。`clues.json` 与 `chapter-01.json` 同源信件同步改写。
- 可解冻封存：既有 `state` store 增 `career-archive` 标记行，不新增 store / key / schema；封存保留全部数据与 live run 但禁止新线索、接单、继续委托与结算写入；解冻删除标记并推进代次；写方法必须在 DB 事务内重读标记（`assertCareerWritable`），旧标签不能绕过；备份携带标记，replace 导入以文件为准。接口冻结见 ADR §22。
- **仅生涯数据完全重置**：`resetAllCareer()` 单事务清空生涯库 11 个 store 与封存标记；不触碰经典 progress / runs / playtime / scores / challenge / meta / prefs，不改旧 key；bridge 清当前页内存与线索 UI；设置面板二次确认并输入「重置生涯」，提示经典记录不受影响。操作不可撤销。
- 门禁分层：新增 `static` / `release` / `full` profile（默认无参数仍是 `full`）；`release` 只跑关键 Chrome 集，结论为 `release passed (not full)`，只有 `full` 全绿才写 `ALL GATES PASSED`；输出 `PROFILE SUMMARY` + JSON 与每项真实墙钟耗时，不把「没跑」写成「通过」；96 委托 runner 支持 `--skip-static` 只在父进程已过 static 时生效；CI 新增 L0 `static-gates` job，未启动 Chrome。
- 经典 localStorage key、IDB v1 / 11 stores、`contentVersion 0.18.0`、`rulesetVersion`、玩法数值、委托奖励、关卡与挑战数据零变化。

### Tests

- 已通过：static **35/35**、archive **8/8**、archive lifecycle **60/60**、DB **38/38**、backup **34/34**、mobile **318/318**、smoke **117/117**、完整首航 **339/339**、PWA 离线 **18/18**。
- 最终 96 全量串行 **16/16 游戏、96/96 tiers、3792/3792 checks**；release profile **41/41 `release passed (not full)`**（1801.411s）。Actions `45750286945` 全部成功，双端 `verify_deploy.py` **89/89** 一致；full / 真机 / 真人仍 **UNVERIFIED**。

### Notes

- 发布：main 提交 `14a19b0`，Actions `45750286945` 全绿，双端各 89/89 文件一致；线上中心页 0.21.0、16 卡、无生涯常驻入口，设置深链可用。

## 0.20.0 — 2026-11-26（已双端发布）

发布提交 `df91715`，[Actions 45719028590](https://github.com/Shawlaw/studiokit/actions/runs/45719028590) 四项成功；两个正式域名各 88/88 文件与本地产物一致，版本 arcade 0.20.0。线上 HTML 均包含生涯视图与「旧港有一封来信」入口。真机 / 真人首航 UNVERIFIED。

生涯首航与剧情流畅度 V2。设计与回滚见 [`DESIGN-0.20.0.md`](DESIGN-0.20.0.md)，集成与门禁结果见 [`docs/arcade-life/INTEGRATION-0.20.md`](../../docs/arcade-life/INTEGRATION-0.20.md)。

### Added / Changed
- 错过的首封线索可在同一游戏后续有效结算重显，首页经典视图目录上方提供小字入口「旧港有一封来信 / 继续旧港来信」，读信一次点击完成投递进港（`?careerLetter=1`），不自动投递、不创建生涯身份。
- 到港后 C0 首封信明确玩家身份与当前目标，告示板首屏只突出真实可执行的推荐单；默认路线由 `campaign.recommend` / `story-evidence` / `route-planner` 按真实规则推导，中间单标「路线进展」。
- 收据给出工钱材料、剧情物件与世界反应三类回报及下一步，提供页内「回告示板 / 读回信」主动作；关标签丢 ticket 后可从 DB live run 只读发现并显式继续；终局 C5 唯一、幂等、失败可重试。
- C0–C5 内容以 `start / progress / complete` 节拍向后兼容扩展；新增 ADR §21 冻结 `originLetter()` / `chapterZero` / `continuations()` 三个只读接口。
- 版本链 0.20.0（engine / sw / 中心页 / 注册表 / validate / verify_deploy）；SW 缓存键 `studiokit-arcade-0.20.0-v1`，沿用 0.19 的「只继承预载清单、重取当前页面」迁移策略。生涯内容 `contentVersion` 仍 `0.18.0`，不改 IDB v1 / 11 stores / `rulesetVersion` / localStorage key。

### Tests
- 完整零种子首航 339/339、campaign E2E 731/731、移动端 318/318、world 145/145、推荐 111/111、路线一致性 94/94、db 38/38、备份 34/34、a11y 75/75、PWA 18/18、紧凑触控 18/18、冒烟 117/117；静态校验与构建、`node --check engine/sw` 通过。
- 发布前状态：聚合门禁 `arcade_run_all_gates.py` 无一次 `ALL GATES PASSED`（逐项串行全绿，部分聚合长跑被旧断言 / Chrome 环境阻断后单项重跑通过）；真机与真人首航 UNVERIFIED。Owner 独立复审 APPROVE 后授权发布，见本节开头发布记录。

### Notes
- 发布后状态：提交 `df91715` 合入 `main`，Actions `45719028590` 四项成功，双端各 88/88 文件一致，线上为 0.20.0；真机 / 真人首航 UNVERIFIED。

## 0.19.0 — 2026-11-25（已双端发布）

按「路上走着玩 / 地铁站着玩 / 等车坐着玩」三种场景审视 16 款游戏的交互后的改进（已合入 `main` 并双端发布）。设计与回滚见 [`DESIGN-0.19.0.md`](DESIGN-0.19.0.md)。

### Added
- **矮视口紧凑模式**（≤620×700）：收起与游戏顶栏重复的站点壳条、键盘提示行让位给画布、弹层改为贴底部的底部弹层、选关与机库面板铺满顶栏以下屏幕。375×548 标签页下画布占屏 25–32% → 33–47%，390×664 标签页 41–43% → 52–61%；「开始游戏」从 10 款首屏不可见变为 16 款全部可见。高屏布局不变，拇指抬升量不变。
- **拇指区暂停**：11 款实时游戏都能单手一键暂停——道具行行尾独立一格（雪铃、重力翻转、影跃、层塔、极速车道、贪吃蛇、砖块计划、打地鼠）、画布右下角悬浮钮（星海突击）、道具坞第 5 格（黄金矿工）；俄罗斯方块沿用 0.8.4 的暂停键。挑战模式下同样保留。
- **恢复门**：触屏点「继续」后只解冻画面，下一次触控才恢复；按住 / 拖动类操作的同一触控直接生效，点按类的那一下不会翻转、放箱或放钩。鼠标会话行为不变。
- **结算防误触**：结算与 CLEAR 整备弹层出现后 450ms 内不接收触摸，挡掉死亡瞬间的连点。
- 新增门禁 `tools/arcade_compact_touch_test.mjs`（18 项）：5 档紧凑视口 × 16 款的布局矩阵，以及用真实触控事件验证的恢复门、暂停、防抖、方向锁、上滑影冲、相对拖动、抬起确认、选关面板；已登记进聚合门禁。

### Changed / Fixed
- 修复记忆翻牌、贪吃蛇、雪铃、层塔的挑战选关层「返回开始」点击无反应（函数只有定义没有绑定）。
- 修复黄金矿工具品坞间隙与内边距穿透到画布、点偏一点就放钩。
- 修复俄罗斯方块在视口高度不超过 560px 时页面溢出、操作键下半部分被切。
- 影跃：按住不抬指上滑即影冲，单手也能「按住方向 + 定向影冲」。
- 雪铃、影跃：半屏方向锁，触点要越过中线 40 逻辑像素才换向。
- 砖块计划：挡板改为相对拖动（增益 1.2），手指不再挡住挡板和来球；发球判定 8px → 14px。
- 二十一点、记忆翻牌：按下预览、抬起确认、滑出取消；记忆翻牌命中取最近牌心。
- 2048：撤销键放进道具行行尾。打地鼠：经典模式也认第二根手指。星海突击：窄屏开局文案精简、空槽收起为一格容量指示、道具按下即触发。动作类游戏的道具键触屏按下即触发。贪吃蛇高屏下方向键贴底。
- `career_96_missions` 夹具同步到 0.18.1 的贪吃蛇固定四向键（该门禁在 0.18.1 基线上本就失败）。
- 合并 0.18.2 后修正 PWA 升级迁移：0.18.2 把旧缓存里的游戏 HTML 直接复制进新缓存，那一版游戏页未改动所以安全；本版改动了全部 16 款游戏页与引擎，直接复制会变成「新引擎 + 旧页面」。现在只继承旧缓存中「预载过哪些游戏」的 URL 清单，安装时重新联网取当前版本页面；离线安装则留空，不复制旧字节。`career_pwa_offline` P16 改为在旧缓存种入过期页面，断言升级后缓存的是 0.19.0 页面而不是旧字节。
- 同步有意变更的断言：冒烟的返回入口与全屏增量阈值（60 → 40px）、重力翻转与砖块计划的挑战模式道具断言。

### Tests
- `arcade_compact_touch_test` 18/18；`arcade_smoke` 117/117；`arcade_interaction` 5/5；`arcade_immersive_buttons` 42/42；`arcade_pwa_update` 9/9；`arcade_review` 5/5；`arcade_tower` 23/23；`validate_site` / `build_site` / 内联脚本语法通过。
- 聚合门禁 `arcade_run_all_gates.py` 在只含本版改动的提交树上串行跑完：冒烟 117/117、`career_96_missions` 96/96 档、career_mobile 318/318、campaign E2E 700/700、玩法 104/104 与 22/22、其余各门禁通过。单轮里 `career_96_missions`（Chrome 启动超时）、`career_closeout`（时间戳差 1 毫秒）、`arcade_pwa_update`（等待 SW 接管超时）各偶发失败一次，单独重跑均通过；明细见 [`DESIGN-0.19.0.md`](DESIGN-0.19.0.md) 第 5 节。
- 合并 0.18.2 后在合并树上又完整跑了一轮：`career_pwa_offline` 的 P16 暴露预载迁移缺陷并已修复（重跑 18/18）、`compact_touch` 的 CT-18 断言随机性已修正（连跑两轮 18/18）、`career_world_state` 与 `career_closeout` 偶发失败单独重跑通过（109/109、6/6）；其余门禁与 4 个独立门禁全过。见设计文档第 5.1 节。

### Notes
- 版本链 0.19.0 / SW 缓存键 `studiokit-arcade-0.19.0-v1`。不改任何 localStorage key / Schema、玩法数值与关卡数据。
- 真机触控手感 UNVERIFIED：方向锁 40px、挡板增益 1.2、上滑影冲 56px/350ms、防抖 450ms 是首版取值，等待 Owner 试玩裁决。

## 0.18.2 — 2026-11-25

- 修复 Cloudflare Pages 上点击预载后断网仍无法跨页的问题。Service Worker 可用已缓存的页面响应打开游戏和中心页，并兼容带 `.html` 和无后缀的游戏地址。更新时保留 0.18.1 已缓存的游戏页。

## 0.18.1 — 2026-11-24

- 中心页优先显示最近存档与紧凑游戏目录，可一键续玩。记住目录排序，统计、积分与清除记录集中到目录下方。
- 贪吃蛇改用固定方向和即时滑动。俄罗斯方块将道具移到画布上方，PWA 和全屏的主控抬升，暂停保留在下方。游戏页顶栏返回街机厅。
- 已有生涯身份可切换经典目录与生涯首页，并设定下次打开的视图。生涯入口可打开告示板、信箱和解锁的章节。
- Service Worker 使用缓存 `studiokit-arcade-0.18.1-v3`。生涯内容版本沿用 `0.18.0`。

## 0.18.0 — 2026-11-24（已双端发布）

星塔回响共有六章 C0–C5、三条并列终局与后日常。

### Added
- 六章内容 `campaign.json` / `chapter-00..05` / `npc.json` / `side-stories.json`；三终局 `ending-{combat,research,rescue}.json`。
- `campaign-core.js`（章节/路线/状态/C0-C1 同步）、`ending-reducer.js`（C5 一次性汇合/幂等/失败可重试）、`ui/world-state.js`（章节/终局/后日谈/港口灯光）。
- 中心页 C0 后小字「旧港来信」回流入口（`?story=1`）；信箱「旧港来信 · 章节」按钮。

### Changed / Fixed
- 全分支复审修复：真实线索 chip 补 `C0.port_seen`；五材卖出/扣料不再只遍历晶体；长局事件缓冲按 kind 汇总 count/最大值/上下文；慢启动（3.5s→10s）与 late ticket 模式竞态；不再为职业切换清经典星海档；终局/首通跨标签原子唯一；替换导入后当前页立即采用恢复状态；双页发现快照合并；市场操作 ID 会话前缀；记忆翻牌 T3/T5 与五子棋 session.finish 要求真实配对/落子；制造逐级累计成本；武力终局加载已装备机体；锁定章节不泄漏正文/事实；章节面板可回信箱/告示板。
- 版本链 0.18.0 / SW `studiokit-arcade-0.18.0-v1`。

### Tests
- campaign-core 53/53、ending 34/34、graph 48/48、world 109/109、campaign E2E 701/701；0.17 回归保持。

## 0.17.0 — 2026-11-23（本地未发布；等待 Owner 发布授权）

活世界：96 委托、五材商店、制造台、职业成长、剧情证据与单职业路线（分支 `feat/arcade-life-015`，不推送、不发布）。

### Added
- **96 份职业委托**（16 游戏 × T1–T6）：T1–T3 告示板公开；T4–T6 实现但由 `C3.truth_found` / `C4.city_power_restored` / `C5.star_tower_resolved` 旗标解锁，受控 fixture 证明。
- **16 款游戏职业 run**：目标行（≤2 行）、真实目标事件、真实结算、职业专属收工出口；挑战/禅/割草不可进入。
- **五类材料**：建材/合金/电子元件/星晶/生物材料；固定买卖价差，`crystal` 0.16 别名统一到 `starcrystal`。
- **材料商店**（`ui/market.js`）：买/卖、余额/材料不足归因、请求中禁用、payout 拆单；卖料走 `db.sellItems` 单事务。
- **制造台**（`ui/workshop.js` + `crafting.js`）：3 件生涯模块（相位护盾/货舱磁吸/能量电池）、15 层配方；材料+信用点原子扣减；模块只生涯生效。
- **16 职业等级**（学徒/熟练/专家）：按已清委托/claims 去重，只影响可选订单/展示。
- **剧情证据**（`story-evidence.js`）：`E/MAP/BP/DEC-*` 白名单、去重、不可消耗/重放；C2–C4 多路径。
- **单职业路线**（`route-planner.js`）：16×16 组合可执行或可解释 blocker；免费租机/市场/代办替代。
- **内容**：`commissions.json`（96）、`items.json`（五材/4 船/7 模块）、`chapter-01.json`（16 起源）。

### Changed / Fixed
- `career-core` 目标支持 `minValue` 数值阈值与 `value-not-met`；`commission-core` 失败返回 `reached`。
- 新增真实事件：`session.finish`、`tile.created`、`move.legal`、`stock.face_up`、`foundation.move`、`bell.unique`、`stage.clear`、`distance.reached`、`combo.reached`、`wave.completed`、`scroll.collected` 等。
- 职业隔离补全：层塔 `finishRun` 不再写经典记录；影跃经典 `height.reached` 恢复逐米、雪铃经典事件保持；`serialize()`/autosave/挑战/GameMeta 门禁逐页验证。
- `bridge.js` 懒装载 materials/crafting/professions/storyEvidence/routePlanner，公开 `openMarket/openWorkshop`；结算后登记证据。
- `career-db`：`sellItems` 原子卖料、`writeEquipment` 修复 `isFiniteNumber` 未定义、材料别名读取合并。
- `review` 金样 55 处回看标记；SW `CORE_PATHS`/`verify_deploy.PATHS` 同步 0.17。

### Tests
- **96 委托回归**：`career_96_missions_test` **96/96 tiers、3792/3792 checks**（真实 Chrome/IndexedDB，16 游戏各 6 阶 success/failure/suspend/claim/幂等）。
- fixture runner `--validate`：内容 96/96、16/16 fixture 形状 PASS；schema 负例矩阵。
- 纯 Node：materials 32/32、professions 213/213、story-evidence 90/90、route-planner 214/214、economy-balance 47/47、commission 61/61、combat 379/379、legacy 78/78、registry 90/90、discovery 84/84、entry 37/37。
- Chrome：reachability 165/165、a11y 75/75、db 38/38、backup 34/34、PWA 离线 17/17、smoke 113/113、review 5/5、zen 14/14、calm 17/17、tower 23/23、interaction 5/5、immersive 32/32、pwa_update 9/9。
- 0.16 first-flight 金样归档为 `career_first_flight_test_016.mjs`（0.17 经济重标后旧断言不再适用），0.17 由 96 委托回归替代；G17 首轮发现的 `crystal` 无限卖钱已修复并新增 `career_crystal_alias_test` 8/8；真机 UNVERIFIED。

### Notes
- 版本链 0.17.0 / SW `studiokit-arcade-0.17.0-v1`；接口 ADR §19；设计与回滚 `DESIGN-0.17.0.md`；平衡 `BALANCE-017.md`；集成 `INTEGRATION-0.17.md`。
- 未发布：无 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`；远端 `main` 仍 `afc5fd4`。

## 0.16.0 — 2026-11-23（本地未发布；等待 Owner 发布授权）

首航：旧港告示板委托、免费租机、飞船机库与职业收据（分支 `feat/arcade-life-015`，不推送、不发布）。

### Added
- 旧港告示板（`ui/town.js`）：仅从 LOCAL 线索信按地址进入；列出层塔施工 T1/T2、星海护航 T1/T2（戏内标题/一句话目标/工钱材料/时长），接单后带 ticket 跳转对应游戏页；另有「港务处代办」（明码标价，非战斗路径）与机库/钱包入口。
- 委托运行时（`commission-core.js`）：ticket（`ticketId === runId`，sessionStorage）→ 游戏页 `?career=` 激活 → 真实事件缓冲 → 目标判定（`career-core.validateCommission`）→ 首发奖励/repeatSalary → `settleAndClaim` 单事务；重复结算返回原收据、失败零写入、刷新可恢复、放弃不发奖。
- 层塔施工 T1/T2：职业 run 内开局弹层显示戏内目标，挑战入口隐藏，旧局内档 `runs:v1` 全程不读不写；稳定层仍由真实物理提交点产生。
- 星海护航 T1/T2：`startParams.startLevel/themeId` 决定起始关/主题，职业 run `classicLike` 但跳过星币入账、旧机库读写、Progress/Scores/RunSave；Boss 事件带真实 level/theme。
- 免费租机（`rental.js`）：会话 marker、零扣费、不改变拥有/装备；失败不丢装备。
- 非战斗代办（`alternatives.js`）：明码标价、只扣信用点/材料与写 `alternative/story` 行，不发钱、不给战斗奖章。
- 飞船机库（`ui/hangar.js`）：旧翼 260 / 云雀 480（合金 1）/ 盾鲸 520（合金 2）/ 棱镜 540（合金 2+棱晶 1）；`purchase.costItems` 同事务扣材料与信用点，切换走 `writeEquipment`；余额/材料不足可归因、purchaseId 幂等。
- 钱包/收据（`ui/receipt.js`）：家当、原收据、最近流水；结算后收据卡懒加载显示；同 run/txId 不重复展示。
- 内容：`commissions.json`（4 条 T1/T2）、`items.json`（4 船/模块/材料）、`chapter-01.json`（16 起源 C0 信 + C1 三路径）。

### Changed / Fixed
- 0.16 前置修复：星海 `GameMeta.set` 改为读-合并-写（旧字段保留，`formula:1` 不变）；`classicLike` 统一经典/职业玩法分支；`serialize()` 在职业 run/mow 返回 null。
- `bridge.js`：新增 commission 模式、`openTown/openHangar/openReceipt`、`getCommissionLoadout`、`api.items`；新模块全部按需装载（普通页与 `#test` 零额外请求、零 404）。
- `career-core.purchasePlan` 增加 `costItems`（材料成本同事务校验/扣减），`career-db.purchase` 原子扣减；新增 `getEquipment/writeEquipment/readLedger`。
- `sw.js` CORE_PATHS 预缓存 0.16 career 资源；`verify_deploy.PATHS` 同步；中心页仍无生涯 CTA。
- `arcade_smoke` 核弹用例改为按实际槽位取核弹（修复随机整备后偶发失败，非产品回归）。

### Tests
- 纯 Node：commission **61/61**（另真实 IDB 17/17、真实 bridge E2E 8/8）、star-combat-config **379/379**、rental **153/153**、alternatives **67/67**、legacy 金样 **78/78**、registry **90/90**、discovery **84/84**、router/entry **37/37**。
- Chrome/CDP：resume **45/45**、first-flight **192/192**、mobile **318/318**、a11y **75/75**、career_db **38/38**、backup **34/34**、PWA 离线 **17/17**。
- 既有回归：smoke、zen、calm、review、tower、interaction、immersive、pwa_update、gameplay all/base（G16 独立复跑）。
- 真机 iPhone/Android 触控、安全区、VoiceOver/TalkBack、PWA 安装/更新时机：**UNVERIFIED**。

### Notes
- 复用 0.15 IDB v1（11 stores），无新 store、无 localStorage 新增/改名；sessionStorage 仅 ticket/rental 两个命名空间键。
- 版本链 0.16.0 / SW `studiokit-arcade-0.16.0-v1`；接口见 ADR §18，设计/回滚见 `DESIGN-0.16.0.md`；证据在仓库外 `qa/evidence/`。
- 未发布：无 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`。

## 0.15.0 — 2026-11-22（本地未发布；等待 Owner 发布授权）

新增「被动线索」与独立生涯数据层（分支 `feat/arcade-life-015`，不推送、不发布）。

### Added
- 16 款游戏在**经典游玩**中被动产出可关闭的微线索：结算安全点出现戏内物件，点开是一封短信用；不点不影响原玩法，忽略后可从信箱找回；设置可关闭/恢复，已发现内容不丢失。
- `apps/arcade/career/` 运行时：`bridge`（游戏页唯一入口）、`registry`（数据驱动游戏/职业/委托/故事，虚拟第 17 款插拔测试）、`discovery`（发现状态机纯函数）、`career-core`（纯函数经济/领奖计划）、`career-db`（IndexedDB 事务层）、`router`/`entry-router`、`backup`（独立 `careerLife`）、`content/*.json`、`ui/*`（线索 chip/信箱/设置）。普通 `<script>`，无框架、无 CDN、无网络请求（同源 fetch 内容除外）。
- 独立 IndexedDB `studiokit:arcade:career` v1：11 个 stores（`state/discovery/profiles/runs/claims/ledgers/balances/inventory/equipment/quests/migrations`）；单 `readwrite` 事务领奖、`claims.runId` 唯一 + 重复返回原收据、购买双击幂等、余额不为负、多标签 `ConstraintError` 重读、`onblocked` 超时、IDB 不可用时 fail-open。0.15 游玩路径只写发现状态与证据，不产生货币/材料/生涯身份。
- 线索内容 schema 与发现状态机（`DORMANT → GLIMPSED → CURIOUS → LOCAL → RESIDENT → EXPLORER`）；每局最多 1 条、同游戏保底 ≤3 局、星海割草不计有效局。
- ticket/claim/receipt 接口冻结（0.16 使用）；故事条件谓词（`all/any/capability/evidence/chapterFlag/item/credits/commissionCleared`）与 `objective.context` 匹配。
- 独立生涯备份 `format: studiokit-arcade-career`（导出/导入/迁移/坏档回滚/旧档保留）。

### Changed
- 16 个游戏页各新增：`<script src="../career/bridge.js">`、`const career = window.ArcadeCareer || null`、真实事件 `observe()`、每局一次 `finish()`；挑战局不产生线索事件，星海割草显式排除。经典/挑战/禅模式、78 关挑战数据、旧星币与机库零改动。
- `apps/arcade/sw.js`：`VERSION` 升 `0.15.0`，`CORE_PATHS` 追加 career 运行时/内容/UI（离线可读信箱）。
- 版本链：engine `ARCADE_VERSION`、registry `version`、中心页 `data-hall-version`、`validate_site` 断言、6 个既有测试脚本断言同步；`tools/verify_deploy.py` 的 `PATHS` 追加 career 静态资源。

### Tests
- 纯 Node：`career_registry_test` **90/90**、`career_discovery_test` **84/84**、`career_legacy_baseline_test` **78/78**、`career_entry_router_test` **37/37**。
- Chrome/CDP：`career_db_test` **38/38**（事务/幂等/多标签/失败零写入）、`career_backup_test` **34/34**、`career_games_reachability_test` **165/165**（16/16 真实可达 + 真实挑战隔离回归）、`career_discovery_accessibility_test` **75/75**、`career_pwa_offline_test` **17/17**。
- 既有回归：聚合器 `arcade_run_all_gates.py` = `ALL GATES PASSED`（smoke 113/113、zen、calm、review、gameplay all/base）；聚合器外 tower 23/23、immersive 32/32、interaction 5/5、pwa_update 9/9。
- **G15 独立门禁：首轮 FAIL（挑战共享输入路径泄漏 career 事件）→ 修复后第二轮独立复核 PASS**（HEAD `5e71004`；工作树干净；远端 `main` 未动）。
- 真机 iPhone/Android 触控与 PWA 安装/更新时机：**UNVERIFIED**。

### Notes
- 无 localStorage key 新增/改名，7 个既有键与 Schema 不变；SW 缓存键 `studiokit-arcade-0.15.0-v1`。
- 设计与回滚见 `DESIGN-0.15.0.md`；接口冻结见 `docs/arcade-life/ADR-interfaces.md`；证据与原始侦察在仓库外（`qa/evidence/`），公开文档不含剧情路线/谜底。
- 本版未发布：无 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`，未推送 `main`、未触发双端部署。

## 0.14.0 — 2026-11-22（已双端发布）

Owner 本轮两条：①星海突击同种弹药 Buff 多吃时应**叠加有效时长**而不是重置；②新增“模拟割草”模式（实现命名「星海割草」）——所有弹药 Buff 常驻、大杀器库满载、手动道具无限，同时敌人/掉落极其密集、Boss 招式更炫，玩家唯一瓶颈是能量；该模式**不参与任何积分与货币获取**。设计与调参见 `DESIGN-0.14.0.md`；挑战 6 关数据与判定零改动。

### Added
- **星海割草（无尽演武）**：开始弹层第 4 按钮进入，engine `createOverlayUi` 新增可选 `btn4`（其他 15 款游戏不传，零变化）。
  - 四种弹种常驻、火力固定 LV5；大杀器 3 槽满载 `核弹/轨道炮/时空锚`，使用后不消耗槽位；脉冲/星盾/编队无限次。所有手动道具与编队启动均消耗能量，能量是唯一资源。
  - 敌潮密集：0.26s 刷怪、85% 双刷、同屏上限 32；敌人血量 ×3.2；Boss 战保留 20 架护卫持续补充。
  - 掉落密集：12% 能量核心（8 杀保底，+7）、重装敌机 50% 火力核心、2% 军械箱；Boss 掉 10 能量核心 + 4 火力核心；拾取上限 90。
  - Boss 四套专属弹幕：扇形齐射 / 螺旋星雨 / 交叉扫射 / 环爆三连；Boss 血量 ×2.6、横向巡航更大、入场不清场、弹幕上限 100；旋转警戒环 + 双层光晕 + 相位震屏/闪白；全部尊重 `prefers-reduced-motion`。
  - 受击不掉命，改为扣 `maxEnergy × 22%` 能量并结束编队；Boss 击破自动进入下一潮（无 CLEAR 整备弹层）；暂停 →「结束演武」返回开始界面。
- **HUD/入口**：割草顶栏隐藏分数/星币/最高，画布左上显示「割草 N」击坠数、右上 ∞、中央 `STG N · 星海割草`；道具按钮显示 `-30⚡` 等能量成本；320px 下 4 按钮入口与 6 列无限道具行均 ≥44px、无溢出。

### Changed
- **同种弹种叠加**：拾取由 `max(剩余, 固定时长)` 改为 `min(180s, 剩余 + 固定时长)`；浮字显示 `散射弹 +12s · 共 24s`，HUD 显示累计剩余时长；180s 为护栏上限。
- 割草模式统一走经典战斗管线（能量/编队/大杀器/主题/掉落），但跳过 `stageClear`/`gameOver` 结算；`serialize()` 在 `mode === 'mow'` 返回 null，不写局内档，刷新不会出现「继续演武」残留。
- 版本链升至 `0.14.0`，SW 缓存键 `studiokit-arcade-0.14.0-v1`；中心页 `data-hall-version`、注册表 `version`、`ARCADE_VERSION` 与 `GAMES` 文案同步。

### Compatibility
- 无新增 localStorage key / Schema；`progress` / `runs` / `prefs` / `playtime` / `scores` / `challenge` / `meta` 全部不动。
- 挑战模式与经典模式的数值、弹道、结算路径不变；同种弹种叠加是唯一玩法差异，挑战每关同类 powerup 不重复，实际难度零变化。
- 割草不写 `scores:v1`、不更新最高分/机库 `runs/best`、不调用 `Progress.recordPlay`/`settleCredits`；真实游玩时长仍计入 `Playtime`（统计，不是积分/货币）。

### Verification
- 本地实跑（Windows / Node v25.8.1 / Python 3.14 / 本机 Chrome）：`node tools/arcade_smoke.mjs` **113/113**（新增 4 项：叠加时长/上限/实际拾取、割草常驻无限与密集掉落、Boss 四套弹幕/自动进潮/受击扣能量/无积分、320px 4 按钮与 6 列道具行）；`--scenario=SC-STAR-001` 经典 Boss 闭环 **1/1**；挑战矩阵 78 关 **7/7**。
- 其余门禁：`arcade_pwa_update_test` **9/9**（临时发版链路改 0.14.0→0.14.1）、`arcade_zen_scores_test` **17/17**、`arcade_calm_games_test` **17/17**、`arcade_interaction_test` **5/5**、`arcade_tower_test` **23/23**、`arcade_immersive_buttons_test` **32/32**、`arcade_review_test` **5/5**、`arcade_design_check` 143 文件、`arcade_stage_coverage` 78 关矩阵。
- 全量门禁：`py -3 tools/arcade_run_all_gates.py` → **ALL GATES PASSED**（validate/build/design/inline/stage/smoke 113/113、zen 17/17、calm 17/17、review 5/5、gameplay all 104/104、base 22/22）。
- 静态：`validate_site.py`（0.14.0 版本链 + 叠加/割草守护标记）、`build_site.py`、`check_inline_scripts.mjs`、`arcade_design_check.py`、`node --check engine.js/sw.js`。
- **发布**：提交 `4c90a4c` 推送 `main`；Actions run `45010510889` 四 job 全绿；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.14.0 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 实测版本 0.14.0、星海割草入口可见、进入后常驻/满载/无限与 `score=0` 均正确、无 console error；SW 缓存键 `studiokit-arcade-0.14.0-v1`；真机手感（能量节奏、割草密度、Boss 弹幕可读性）仍 **UNVERIFIED**，待 Owner 试玩。

## 0.13.3 — 2026-11-22（已双端发布）

Owner 在 iPhone 主屏 PWA（`studiokit.pages.dev`）复测 0.13.2：星海突击 / 2048 / 俄罗斯方块玩完，
累计时长与每局时长仍全是 `0`，但积分记录有数据；同一自检页用 Edge 打开正常。
设备自检页抓到根因并修复（设计与证据见 `DESIGN-0.13.3.md`）；**玩法/存档/挑战零改动**。

### Fixed
- **Cloudflare Pages 无后缀 URL 导致游戏识别失败（计时全 0 的根因）**：CF Pages 的 pretty URL 会把
  `GET /apps/arcade/games/x.html` **308** 到 `/apps/arcade/games/x`；`detectCurrentGame()` 旧实现用
  `g.file === 'x.html'` 精确比较 pathname 里拿到的 `x` → `currentGame` 恒 `null` →
  `Playtime.install()` 直接返回（不挂监听/不开 tick）→ `canTrack()` 恒 false（时间片从不启动）→
  `recordRound()` 返回 `duration: 0`（积分记录照写）→ `playtime:v1` 从未写入。
  GitHub Pages 保留 `.html`，所以 Edge/GH 侧正常。
  修复：识别时去掉 `.html` 后缀并小写化后比较，同时兼容尾斜杠、URL 编码，并增加按游戏 id 的兜底；
  `ARCADE_BASE` 仍优先取 `document.currentScript.src`，无后缀 URL 下相对资源与 SW 注册不受影响。
- **诊断页保留**：`apps/arcade/diag.html`（中心页「游玩统计 → 计时自检」）保留到本版供真机复验；
  `block-drop.html` 的 `?diag=1` 顶层探针在定位完成后移除。

### Changed
- 版本链升至 `0.13.3`，SW 缓存键 `studiokit-arcade-0.13.3-v1`；中心页 `data-hall-version`、
  注册表 `version` 与 `ARCADE_VERSION` 同步。

### Compatibility
- 无 localStorage key / Schema 变更；`playtime:v1` / `scores:v1` 数据格式不变。
- 历史上记成 `0ms` 的轮次不会回填（无法补算）；修复后从下一局开始正常累计。
- GitHub Pages 的 `.html` URL 与 Cloudflare 的无后缀 URL 两种形态现在都能正确识别游戏。

### Verification
- 线上实测（修复前 → 修复后，同一 CF 无后缀 URL）：`currentGame: null / tracking:false / timer:false`
  → `currentGame:"block-drop" / tracking:true / timer:true`；点开始游玩 1.6s 后 `totalMs = 1606`。
- 线上诊断页（CF 无后缀）：iframe 真实一局显示「计时正常 记录到 3508ms」，`currentGame` 已识别。
- `tools/lib/arcade_cdp.mjs` 测试服务器新增「无后缀 → `x.html`」回退以模拟 CF pretty URL；
  `arcade_smoke` 108 → **109/109**（新增「Cloudflare pretty URL 仍识别游戏并计时」）。
- 回归：pwa 9/9、tower 23/23、zen 14/14、calm 17/17、review 5/5、interaction 5/5、
  immersive 32/32、gameplay all 104/104、base 22/22、挑战矩阵 78 关、
  `validate_site` / `build_site` / `check_inline_scripts` / `arcade_design_check` 全过。
- **发布**：提交 `b3a8c7e` 推送 `main`；Actions run `45007754972` 四 job 全绿；CI 与本地
  `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.13.3 / badge 2.2.1 / venue 0.2.0）；
  双端线上无头 Chrome 实测：CF 无后缀 URL `currentGame=block-drop` 且游玩计时正常、GH `.html` 正常、
  诊断页 iframe 计时正常、0 console error。
- 真机 iOS 主屏 PWA 复验（更新后「计时自检」应显示「计时正常 ≥2000ms」，累计/积分记录时长不再为 0）
  待 Owner 确认（UNVERIFIED）。

## 0.13.2 — 2026-11-22（已双端发布）

Owner 两条真机反馈：①已安装 PWA 的「🔄 检查更新」显示的是**已安装版本**，不是线上最新版本；②iPhone 主屏 PWA 玩一天后中心页「累计时长」始终为 `0 分钟`，但积分记录表格有数据。两条都用无头 Chrome 复现并逐条修复（复现命令与设计见 `DESIGN-0.13.2.md`）；**挑战/玩法/存档零改动**，无新增 localStorage key / Schema。

### Fixed
- **iPhone 主屏 PWA 游玩时长永久停摆（主因）**：16 款游戏共用 `Playtime`，旧实现 `startSegment()` 要求 `focused`，而 `focused` 只在 window `focus` 事件里恢复；iOS 主屏 PWA 的 `focus` 不可靠（回前台常常只有 `visibilitychange`，页面按 iOS 13+ 语义也不会重新加载），漏一次 `focus` 后这一页的计时就永久停摆，但 `scores:v1` 仍照常写入 —— 复现输出：先 `blur` 再无 `focus` 时 `snake-run` 记录 `ms=0`、结算 `durationMs: 0`，之后点按也不恢复。现在计时只认「页面可见 + 弹层关闭」：删除 `focused` 门槛，`blur` 仍立即落盘，真正的暂停由 `createLoop` 自动暂停 + 暂停弹层承担；新增 `syncSegment()` 并在 `visibilitychange` / `focus` / `pageshow` / 用户 `pointerdown` / `keydown` / `touchstart` / 15 秒 tick 上自愈，`recordRound()` 结算后立即续开时间片；20 分钟休息提醒不再被永远等不到的 `focus` 吞掉。
- **「检查更新」显示已安装版本**：`A.Offline.checkForUpdate()` 旧实现直接 `version: ARCADE_VERSION` 返回，而 `ARCADE_VERSION` 是页面自己的版本 = 已安装版本，整条链路从不读取线上版本。现在 `fetch('./sw.js', { cache: 'no-store' })` 解析 `const VERSION` 作为**线上最新版本**，再与页面版本、已安装 SW 版本逐段数值比较；返回值新增 `latestVersion` / `installedVersion` / `pageVersion` / `updateReason`，`version` 即线上最新版本。
- **SW 永远不会广播新版本**：`activate` 里用模块级 `firstActivation = true` 判断「是否首次安装」，但每个 SW 实例的该标志都从 `true` 开始、`activate` 只调用一次，`!firstActivation` 恒为 `false` → `arcade-sw-update-ready` 从未发出，页面只能拿到不带版本号的 `updatefound` / `controllerchange` 信号。改为在清理旧缓存**之前**检查前缀相同但名字不同的旧缓存（`isUpdateActivation()`），确认是升级接管才广播当前 `VERSION`。
- **`updateFound` 依赖瞬时槽位（时序抽奖）**：旧实现看 `registration.waiting || registration.installing`，但 SW 在 `install` 里立即 `skipWaiting()`，`update()` 返回时新 SW 往往已进入 activating/activated、两个槽位都是 `null`。现在按「线上版本 > 页面版本 || 线上版本 > 已安装 SW 版本」判定，**新 SW 已接管但页面尚未刷新时也会提示刷新**。
- **无版本号信号覆盖已知版本**：`controllerchange` 的 `{ version: null }` 可能把 SW 消息带回来的新版本号冲掉，横幅退化成泛化文案。`emitUpdate()` 改为版本号粘性（已知版本不被 `null` 覆盖）。
- **读不到线上版本时谎报「已是最新」**：新增 `checked` 语义，读取失败时中心页提示「检查更新失败，请检查网络后重试。」，不再落到「已是最新版本」。
- **SW 缓存拦截页面读取 sw.js**：页面 `fetch('./sw.js')` 会被 SW 的 `cacheFirst` 用已安装版本的旧脚本回答（复现时 `latestVersion` 因此停在旧版本）。SW 现在对 `sw.js` 请求一律交给网络。

### Changed
- 中心页更新横幅：`发现新版本 v{最新}（当前 v{当前}），刷新后生效。`；版本相同但 SW 离线缓存落后时显示「检测到更新缓存已就绪（当前 vX），刷新后生效。」；按钮提示同样带出最新/当前两个版本。
- 版本链升至 `0.13.2`，SW 缓存键 `studiokit-arcade-0.13.2-v1`；中心页 `data-hall-version`、注册表 `version` 与 `ARCADE_VERSION` 同步。

### Compatibility
- 无 localStorage key / Schema 变更；`progress` / `runs` / `prefs` / `playtime` / `scores` / `challenge` / `meta` 全部不动。
- 计时口径仍是「只统计有效游玩」：页面可见且开始/暂停/结算弹层关闭才计时；失焦时游戏自动暂停并弹出暂停层、仍不计时。变化只在于恢复计时不再依赖 window `focus` 事件，改由可见性/点按/落盘 tick 自愈。
- SW 消息协议（`arcade-sw-version` / `arcade-sw-skip-waiting` / `arcade-precache` / `arcade-sw-update-ready`）与缓存键格式 `studiokit-arcade-<VERSION>-v1` 不变：旧页面配新 SW、新页面配旧 SW 都不会报错（新字段只被新页面读取）。
- 新增同源 `GET ./sw.js`（`no-store`，约 8KB）：只读仓库里已有的脚本，不引入远程依赖、后端或分析。
- 升级路径：0.13.1 页面（旧引擎）首次打开时仍复用旧的泛化横幅；SW 更新并刷新一次后即运行 0.13.2 逻辑。

### Verification
- 复现（更新检测，修复前，临时副本站点 + 无头 Chrome）：`checkForUpdate()` → `{"version":"0.13.1","updateFound":true}`、SW 消息 `[]`、横幅「发现新版本，刷新后生效。」；修复后同场景 → `{"version":"0.13.3","installedVersion":"0.13.2"}`、收到 `arcade-sw-update-ready:0.13.3`、横幅「发现新版本 v0.13.3（当前 v0.13.2），刷新后生效。」。
- 复现（游玩时长，修复前，无头 Chrome；同一页面先 `blur` 再无 `focus`）：正常页面 `totalMs=1205`；新游戏页点开始后 `snake-run ms=0`、结算 `durationMs: 0`、再点按仍为 `1205`。修复后同一脚本：`snake-run ms=1504`、结算 `durationMs: 1504`、点按后继续累计。
- `node tools/arcade_pwa_update_test.mjs` **9/9**（新增 PU-06 真实发版链路、PU-07 读取失败诚实提示；PU-02/PU-03 改为断言最新版本与双版本文案）。
- 回归：`arcade_smoke` **108/108**（新增 3 项 iOS 「漏发 focus」计时回归：开局前 blur 仍计时、失焦暂停后点继续仍计时、结算轮次时长 ≥900ms 写入积分记录）、`arcade_tower_test` **23/23**、`arcade_zen_scores_test` **14/14**、`arcade_calm_games_test` **17/17**、`arcade_review_test` **5/5**、`arcade_interaction_test` **5/5**、`arcade_immersive_buttons_test` **32/32**、`arcade_gameplay_test --suite=all` **104/104**、`--suite=base --repeat=2` **22/22**（11 场景 ×2 遍）、挑战矩阵 78 关、320/375/390/430 与 standalone 布局探针全过。
- 静态：`validate_site.py`（新增 0.13.2 版本来源/广播断言 + 游玩计时自愈标记/旧 focus 门槛禁回归断言）、`build_site.py`、`check_inline_scripts.mjs`（19 HTML / 20 段脚本）、`arcade_design_check.py`（143 个设计包文件一致）、`node --check engine.js/sw.js` PASS。
- **发布**：提交 `8493cf7`（PWA 更新检测）+ `78858e0`（游玩时长 + 文档）ff 合入 `main` 推送（`a98cb3d..78858e0`）；Actions run `45002523350` 四 job 全绿（Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments）；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.13.2 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 各 8 项全过（中心页 0.13.2 + 16 卡 + 检查更新按钮、SW 版本握手 0.13.2、`checkForUpdate` 已同步并返回线上 0.13.2 不误报更新、线上 `sw.js` 含升级广播修复、缓存键 `studiokit-arcade-0.13.2-v1`、游戏页可加载、0 console error）；真机 iOS 主屏幕 PWA 的更新提示时机与游玩时长/积分记录时长待 Owner 复测（UNVERIFIED）。

## 0.13.1 — 2026-11-22（已双端发布）

Owner 在 iPhone PWA 非全屏实测反馈 4 点：游玩时间统计不对、大杀器道具栏看不到、核弹缺发射/追踪/命中爆炸动画、移动速度对触屏无意义。本轮逐条修复，**挑战 6 关数据与判定零改动**，设计与验收见 `DESIGN-0.13.1.md`。

### Fixed
- **机库浏览被计入有效游玩时长**：机库面板收起 overlay 后 `Playtime` 继续计时；现在打开机库显式 `A.Playtime.setOverlayVisible(true)` 暂停（先把已游玩片段落盘），关闭机库回到开始弹层后仍不计时，开始游戏后恢复。
- **iPhone 非全屏 PWA 看不到大杀器道具栏**：原第二行在 standalone 的高优先级 stage 高度规则下被挤出视口。现把 4 个军械槽并入主道具行（3 主动 + 最多 3 军械，默认 5 列、`bay` 满级 6 列），空槽位常显「▢ 军械」；删除 `[data-item-slots]` 容器与 `has-star-items` 高度规则。
- **核弹瞬发无动画**：改为发射追踪弹（速度 460→980 px/s、转向插值、尾焰粒子、目标锁定准星）；Boss 在场时实时追踪 Boss 中心，无 Boss 飞向画面中央 `(W/2, 0.42H)`；命中后才清空敌弹、结算普通敌机 80 / Boss `max(120, min(260, 25% maxHp))` 并播放白闪 + 震屏 + 双层冲击波 + 碎片。追踪弹写入局内档 `run.nukeShots`（≤3），刷新继续飞。
- **「移动速度」对触屏无收益**：保留 `engine` id 兼容老档，效果改为受击无敌 +0.12s/级（1.8→2.4s）与拾取吸附 +6%/级（×1.30）；键盘基础移速固定 320。机库文案改为「机动强化」，`hangarInfo().caps` 增加 `invulSeconds` / `magnetMultiplier`。

### Changed
- 版本链升至 `0.13.1`，SW 缓存键 `studiokit-arcade-0.13.1-v1`；中心页 `data-hall-version`、注册表 `version` 与 `ARCADE_VERSION` 同步。
- 大杀器快捷键提示仍为 4–7；挑战模式隐藏军械槽，道具行回落 2 列。

### Compatibility
- 无新增 localStorage key / Schema；`run.nukeShots` 为 0.13.1 新增可选字段，旧档缺失按空数组恢复；挑战分支仍 `run: null`。
- `engine` 改装 id / 等级 / 成本不变，仅效果语义变化（移动速度 → 受击无敌 + 拾取吸附）。

### Verification
- 静态：`node tools/check_inline_scripts.mjs` PASS（19 HTML / 20 段脚本）、`node --check apps/arcade/engine.js` / `sw.js` PASS、`python tools/validate_site.py` PASS、`python tools/build_site.py` PASS、`python tools/arcade_design_check.py` PASS。
- `node tools/arcade_smoke.mjs` **105/105**（原 103 + 核弹追踪/无 Boss 中央引爆 + 机库浏览计时 3 项断言；320px 道具行改为 5 列 + standalone 模拟在视口内）。
- `arcade_tower_test` **23/23**（0.12.7 层塔门禁同批）、star-raid 挑战 **7/7**、tower 挑战 **6/6**、gameplay base **11/11**、zen **17/17**、calm **7/7**、review **5/5**、pwa **7/7**、interaction **5/5**、immersive **32/32**、stage coverage 78 关矩阵正常。
- 320 / 375 / 390 / 430px 与 iPhone standalone 模拟布局探针 **43/43**：道具行 5 列、按钮 ≥44px、无横向/纵向溢出。
- iPhone PWA 真机复测（非全屏道具栏可见、核弹动画、游玩时长）待 Owner 确认。
- 发布：提交 `01eb5b4` 推送 `main`；Actions run `44996450758` 四 job 全绿（Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments）；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.13.1 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 实测：中心页 0.13.1、主道具行 5 列（3 主动 + 2 军械槽，空槽「军械」）、390×844 standalone 模拟行底 ≤ 视口、核弹发射后 0.26s 仍在飞行且 Boss 480 血不变、命中后 Boss 354 血 + flash 0.70 + 冲击波 2 + 0 console error；SW 缓存键 `studiokit-arcade-0.13.1-v1`。
## 0.13.0 — 2026-11-22（已双端发布）

星海突击「星域远征」：把 Owner 反馈的六件事——每关都是白板装备、关卡难度没有差异、机体没有大升级与常态 buff、想要稀缺的核弹级大伤害道具、想要油量/能量这类局限、想要临时编队等出击状态——落到一条「战斗 → 关卡 → 远征」的三层循环里。**经典模式全部改动；挑战 6 关的数据与判定零改动。** 设计、数值与回滚见 `DESIGN-0.13.0.md`。

### Added

- **机库永久改装与星币（跨局成长）**：结算按 `floor(score / 16)` + 整备卡「军费补给 +40」发放星币，写入**引擎新增的通用游戏数据** `studiokit:arcade:meta:v1` 的 `games['star-raid'].hangar`（Schema `v1`，机库内 `formula: 1` 锁定公式版本）——0.13.0 不新增专属机库 key。开始弹层第三入口与结算弹层第二入口进入「机库改装」，退出回到开始弹层；CLEAR 整备摘要显示「星币 +N」，结算弹层显示「+N 星币（机库共 M）」。六项改装：装甲强化 `hull`（0–3，初始生命 +1、上限生命 +1）、火力校准 `power`（0–5，全部子弹伤害 +6%/级）、引擎调校 `engine`（0–5，移动速度 +6%/级）、反应堆 `energy`（0–5，能量上限 +10/级）、弹仓扩容 `bay`（0–1，大杀器槽 2→3，220 星币）、僚机中队 `wing`（0–3，编队时长 +2s、编队充能 +1）；成本 60–600 星币/级。初始生命 = `3 + hull`，上限生命 = `5 + hull`，每关 CLEAR 回 1 生命但不超上限。
- **局内火力等级 `power` 1–5**：等级 1 双发 → 2 加中央 → 3 加两发内斜 → 4 加两发外侧 → 5 加中央重弹（单发 2 伤害），射击间隔 0.13s → 0.127s / 0.124s / ≈0.117s。Boss 击破必 +1（封顶 5）、整备卡「火力核心」+1、重装敌机 30% 掉落火力核心；受击时 `power = max(1, power - 1)`，保底不回到白板。
- **能量与枯竭**：上限 `100 + 10 × energy改装`，开局满、跨关保留，CLEAR +40、Boss 击破 +45；消耗为基础 **1.2/s**，每种「第二份起」的弹种 Buff 额外 +0.45/s、编队期间 +3.0/s、电磁风暴主题 ×1.6；恢复为击杀 +0.6/架、能量核心（普通击杀 7%、18 杀保底，+18）、火力核心满级转 +12 能量、道具槽满时拾取 +10。能量 ≤0 即枯竭：射击间隔 ×1.8、伤害 ×0.7、移速 ×0.92、无法启动编队并强制结束当前编队、HUD 红色警告；枯竭时被动回能 2.2/s，回到 25 解除，吃到能量核心立即解除。掉命时能量保底到上限的 40%，避免「掉命 → 没能量 → 再掉命」的死亡螺旋。画布顶部能量条在低于 25% 时脉冲高亮。
- **临时编队（僚机）**：初始充能 1 + `wing` 改装等级（上限 3），每局重置；启动消耗 1 充能，2 架僚机入场 `8 + 2×wing` 秒，跟随玩家左右 ±34px，每 0.22s 各射 1 发（伤害 0.8 + 火力修正），各有 2 点耐久可拦截敌弹（命中白闪 + 碎片）后损毁，全部损毁或能量枯竭立即结束；结束前 2 秒有浮动文字预警。HUD 显示充能数与剩余时间，僚机有独立受击闪白与拖尾。
- **大杀器（稀缺道具，携带/使用）**：槽位 `2 + bay改装`（最多 3），按槽保存、跨关携带，新开一局清空；击杀稀有掉落 0.6%（核弹 / 轨道炮 / 时空锚同池，180 击杀保底），也可由 Boss 后整备卡获得；触屏按钮或快捷键 4–7 使用，用后槽位清空。反物质核弹清空全部敌弹（普通敌机 80 伤害；Boss 受 `max(120, min(260, 25% maxHp))`）+ 全屏白闪与强震屏；轨道炮 3.2s 垂直光柱（宽 28px，跟随玩家 x，每 0.2s 对柱内目标 40/55 伤害）；时空锚 5s 内敌弹速度 ×0.25、敌机速度 ×0.3、Boss 行动 ×0.55，并叠蓝色时停滤镜。
- **6 星区主题轮转（带分数补偿）**：`themeIndex = (level - 1) % 6`，同一关固定不随机。巡逻星域（无修正，分数 ×1.00）、陨石带（每 4.2s 刷陨石，HP 4+，撞机扣命、可击碎，敌机生命 ×1.05，×1.05）、电磁风暴（能量消耗 ×1.6、敌弹速度 ×1.12、星空电弧特效，×1.10）、舰队封锁（刷怪 ×1.22、重装敌机权重 ×2、敌机生命 ×1.08，×1.15）、星云迷雾（边缘暗角雾、敌弹 ×0.88、瞄准抖动 ±0.08rad、掉落 +20%，×1.10）、母舰防线（Boss 生命 ×1.35、射击间隔 ×0.9、普通刷怪 ×0.8，×1.20）。分数补偿计入击杀/Boss 分与星币，避免只刷最容易的关卡。Boss 血量按「白板 DPS × 可接受时长」重标为 `480 + (level-1) × 280`（0.12 的 700/300 偏肉），再乘主题 `bossHp`。关卡基础缩放仍沿用 0.12 的线性递增，主题只做乘法叠加。
- **CLEAR 三选一整备**：Boss 击破后保留旧行为（火力 +1、生命 +1、能量 +45、脉冲/星盾补给），并给出 3 张整备卡。卡池共 8 种：火力核心（power +1，满级转 +20 能量）、装甲修复（+1 生命）、能量电池（回满 + 本局上限 +10）、僚机补给（+1 充能）、军费补给（本局结算 +40 星币）、核弹 ×1、轨道炮 ×1、时空锚 ×1（后三种仅在道具槽未满时进入卡池）。卡片按局内种子确定性抽取（便于刷新恢复与回归测试），一次只可选 1 张；主按钮「下一关」、次按钮「圆满收局」保持旧契约。
- **动画与打击反馈**：双层视差星空 + 关卡切换跃迁光带 + 主题染色（陨石褐 / 风暴青 / 母舰红）；玩家推进器粒子拖尾、左右移动机身倾斜（只影响绘制）、枪口闪光；敌机 70ms 白闪、Boss 伤害数字、击杀冲击波圆环；受击红屏闪、核弹白闪、Boss 入场警戒横幅、能量条低电量脉冲、编队入场光环与结束预警、陨石旋转、时空锚蓝色滤镜。全部动效读取 `A.reducedMotion`，降级时减粒子/取消震屏，不改判定与数值。
- **引擎通用游戏数据 `A.GameMeta`**：新增独立 key `studiokit:arcade:meta:v1`（Schema v1，`{ schemaVersion: 1, games: { <gameId>: {...} } }`；只存普通 JSON、单游戏 ≤32KB、损坏数据 fail closed 且不覆盖原值），提供 `get/set/clear/clearAll/exportData/importData`。星海突击用 `A.GameMeta.get('star-raid')` / `A.GameMeta.set('star-raid', { hangar })` 读写机库；中心页「清除记录」与 `Progress.resetGame/resetAll` 调 `A.GameMeta.clear` 同步清理；备份 JSON 新增可选 `gameMeta` 字段，旧备份缺该字段时保留当前机库，导入失败整体回滚（含 meta key）。

### Changed

- 版本链升至 `0.13.0`，SW 缓存键 `studiokit-arcade-0.13.0-v1`；中心页 `data-hall-version`、注册表 `version` 与 `ARCADE_VERSION` 同步。
- 星海突击 HUD 扩为「生命 / 火力等级 / 能量条 / 编队充能 / 大杀器槽 / 主题名」；「机库改装」入口在开始弹层第三按钮与结算弹层第二按钮，退出后回到开始弹层；CLEAR 整备弹层摘要显示「星币 +N」，结算弹层显示「+N 星币（机库共 M）」。
- **挑战 6 关数据与判定零改动**：`challenge/star-raid.js` 的关卡数据、Boss 规格与判定链路未修改；挑战分支不读机库改装、不写星币，序列化结构也与旧版一致。

### Compatibility

- 新增 localStorage key：只有引擎通用游戏数据 `studiokit:arcade:meta:v1` 一个（Schema v1），机库存于 `games['star-raid'].hangar = { v, formula, credits, upgrades{hull,power,engine,energy,bay,wing}, runs, best }`，`formula: 1` 锁定星币公式版本。原有 `progress:v1` / `runs:v1` / `prefs:v1` / `playtime:v1` / `scores:v1` / `challenge:v1` 的 key 与 Schema 不变。
- 局内存档 `serialize()` 在 `data` 内新增 `run` 字段（power / energy / maxEnergy / depleted / items / formationCharges / formationTimer / combo / comboTimer / creditsBonus / refitOfferIds / refitChosen / seed / lance / freezeTimer），挑战分支为 `run: null`、结构不变；旧档缺失时按默认值恢复，不迁移、不中断旧局。
- 机库 `hangar` 带 `v` 与 `formula`；非法 JSON、单游戏超过 32KB 或越界数值按 fail closed 回退默认且不覆盖原值；清空只需删 key 或调 `A.GameMeta.clear(gameId)`。
- 备份 JSON 新增可选 `gameMeta` 字段（`A.GameMeta.exportData()` 的快照）；旧备份无该字段时保留当前机库，导入失败回滚相关存储 key（含 meta key）。
- 回滚：删 `studiokit:arcade:meta:v1` + 还原相关文件即可；旧版页面会忽略 `run` 字段与 `gameMeta`。

### Verification

- 静态：`node tools/check_inline_scripts.mjs` PASS（19 个 HTML / 20 段脚本）、`node --check apps/arcade/engine.js` / `sw.js` PASS、`python tools/validate_site.py` PASS、`python tools/build_site.py` PASS。
- `node tools/arcade_smoke.mjs` **103/103**（原 94 项 + 0.13.0 新增 9 项：六星区主题轮转与陨石、火力 1/3/5 弹道、能量被动消耗/枯竭/核心恢复、编队充能/双僚机/能量归零返航、核弹清弹/重创 Boss/反馈、CLEAR 整备三选一 + Boss 火力 +1、机库购买/刷新持久化/备份/清除记录、机库面板 390px、道具行与整备卡 320px）。375px 全游戏页布局、320px 全游戏页布局、PWA/离线、导入导出与版本链断言同步为 0.13.0。
- 基于 `origin/main` `a5951d8`（Arcade 0.12.7，层塔重标定）rebase 后在干净树上完整复跑：`arcade_tower_test` **23/23**、挑战 `pendulum-tower` **6/6**，0.12.7 的层塔改动与本版共存无回归。
- 挑战 6 关零回归：`node tools/arcade_gameplay_test.mjs --suite=challenge --game=star-raid` **7/7**（C01/C02–C04/C05–C06 仍 engine-replay 零伤害通关，失败归因、暂停刷新恢复、320/390 面板无溢出均通过）。
- 其余门禁：gameplay base **11/11**、zen **17/17**、calm **7/7**、review **5/5**、pwa **7/7**、interaction **5/5**、immersive **32/32**、tower **23/23**、stage coverage 78 关矩阵正常。
- 新 UI 布局：320 / 375 / 390 / 430px 下机库面板、道具行、编队按钮、CLEAR 整备卡无横向溢出、按钮 ≥44px（320/390 已固化为 smoke 回归）。
- 真机手感（能量节奏、核弹手感、编队拦截反馈）UNVERIFIED。
- 发布：提交 `faf1772` 推送 `main`；Actions run `44990933121` 四 job 全绿（Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments）；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.13.0 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 实测：中心页 0.13.0 + 16 卡、`A.GameMeta`（key `studiokit:arcade:meta:v1`）、6 星区主题、机库/编队入口、核弹清弹与 Boss 480→360、CLEAR 三选一整备、0 console error；SW 缓存键 `studiokit-arcade-0.13.0-v1`。

## 0.12.7 — 2026-11-22（已双端发布）

### Fixed
- **层塔高层「太快太难」**：0.12.5 把难度上限推到 `SWING_G_CAP = 4000`，封顶层的**完美判定窗口只剩 24~28ms**（60fps 只有 1.4~1.7 帧，比一次显示刷新还短，也只有手机触摸→显示固有延迟 ~78ms 的 1/3）—— 玩家的反馈回路滞后约 3 个窗口，技巧无法建立，命中率按高斯误差估算仅 45%（训练者）/16%（普通玩家），手感等于抽奖。根因是落点标记的横向扫描速度由「释放横移项」主导（封顶层约 700px/s），完美窗口近似按 **1/g²** 收缩，只压上限并不够。
- 按人类计时能力重新标定（重合计时变量误差：训练者 ~20ms SD、普通成人 60~100ms）：上限 **4000→1500**、起始 g **680→560**、两段斜率 **34/14→4/8**（146 层封顶）、振幅 **0.92−0.004f → 0.80−0.0015f**（120 层收到 0.62rad 下限）。
- 结果：封顶完美窗口 **28 → 56.5ms**（≥3 帧、≈2.75× 训练者 SD），封顶可落窗口 **178 → 335ms**；封顶仍是 10 层的 71% 窗口 / 63% 周期（确实变难）；命中率估算 45%→84%（训练者）、16%→36%（普通玩家），落空率 ≈0.2%。
- 挑战模式完全隔离：`updateSwingDifficulty()` 对 challenge 提前返回，关卡摆速仍是 `680 × speedFactor`；新增静态门禁锁住这两点。

### Changed
- 版本链升至 `0.12.7`，SW 缓存键 `studiokit-arcade-0.12.7-v1`。无 localStorage key / Schema / 挑战关卡数据变更；只改 `pendulum-tower.html`（常量与注释）。

### Verification
- 实测（0.5ms 页内积分 + 实时 rAF 交叉校验）：周期 2800→3085ms（0 层）、1154→1885ms（封顶）；完美窗口 63.5→82ms（0 层）、28.5→56.5ms（封顶）；另用独立的逐帧连续段测量交叉复核，结论一致（含 1 帧量化误差）。
- `arcade_tower_test` 21 → **23/23**（TP-13 重写阈值 + 新增静态「不渗入挑战」锁；**新增 TP-14 真实毫秒窗口门禁**：封顶完美 ≥54ms、可落 ≥150ms、窗口单调、封顶 ≤0.75×10 层窗口 / ≤0.65×10 层周期、实时与解析周期差 ≤8%）；`gameplay --suite=challenge --game=pendulum-tower` **6/6**；smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、pwa 7/7、interaction 5/5、immersive 32/32、validate/build/inline/node --check 全过。设计见 `DESIGN-0.12.7.md`。
- 发布：提交 `0d267d9` 推送 `main`；Actions run `44986037865` 四 job 全绿；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.12.7 / badge 2.2.1 / venue 0.2.0）；双端线上实测 0/30/200 层 `g` 560/680/1500、周期 3085/2800/1885ms、目标振幅 0.80/0.76/0.62、逐帧完美窗口 64.1/66.5/41.9–45.8ms（含 1 帧量化误差）、0 console error；SW `studiokit-arcade-0.12.7-v1`。

## 0.12.6 — 2026-11-22（已双端发布）

### Fixed
- **PWA 独立窗口底部按钮比全屏更靠下**：`--ac-thumb-lift` 原先只定义在 `body.arcade-immersive` 上，安装为 PWA 后（非全屏）按钮行拿不到拇指抬升；同时画布下方那行与顶栏重复的 `.game-hint` 说明还在占高度。实测按钮距视口底：浏览器/PWA 60px、全屏 42px，画布 590px vs 687px。
  现在独立窗口（`html.studiokit-shell-standalone`）也套用同一套 36px 抬升、收起重复的 hint 行、去掉其残留的 14px 页面底部留白，并把省下的 34px 还给画布高度预算。
- 修复后 PWA 按钮距底与全屏**完全一致**：无安全区 42px、有安全区 70px（4 档视口 × 2 游戏 × 2 安全区全部通过）；独立窗口画布平均增大 34px（390×844：590 → 624）。
- 横屏短视口沿用既有「允许纵向滚动」策略，逐项指标与 0.12.5 一致（未改动）。

### Changed
- 版本链升至 `0.12.6`，SW 缓存键 `studiokit-arcade-0.12.6-v1`。无 JS 改动、无 localStorage key / Schema / 挑战关卡数据变更；只改 `arcade.css`（52 行新增，单 hunk）。

### Verification
- `arcade_immersive_buttons_test` 16 → **32/32**（新增 IB-06：4 档竖屏 × {无安全区, 安全区 34} × 2 游戏，断言独立窗口识别、hint 收起、按钮 ≥44px 完整可点、0 横向/纵向溢出、**PWA 与全屏按钮距底差 ≤2px**）；smoke 94/94、tower 21/21、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、tower challenge 6/6、pwa 7/7、interaction 5/5、validate/build/inline/node --check 全过。设计见 `DESIGN-0.12.6.md`。
- 发布：提交 `c1c2186` 推送 `main`；Actions run `44977911963` 四 job 全绿；CI 与本地 `verify_deploy.py` 均 **41/41** 双端一致（arcade 0.12.6）；双端线上实测 PWA 与全屏按钮距底 Δ=0（42/42、70/70）、画布 624/543、0 溢出、0 console error；SW `studiokit-arcade-0.12.6-v1`。

## 0.12.5 — 2026-11-22（已双端发布）

### Fixed
- **层塔难度在 30 层就封顶**（`swingGravity = min(1700, 680+34f)`，34×30 已触顶），导致 200 层与 30 层手感完全相同 —— 这是「200 层后很容易完美连击」的根因。改为两段式：`min(4000, 680 + 34*min(f,56) + 14*max(0,f-56))`，前 56 层快速加压、之后缓慢加码、约 **157 层封顶**。
- **摆幅无序塌缩**：`g` 在任意摆动相位阶跃时会把能量悄悄吃掉（实测 216px→154px 且抖动）。现在升速后按「当前角度 + 目标振幅」反解速度大小做**振幅归一**，摆幅恒等于目标值（`max(0.62, 0.92-0.004f) rad`，摆幅 214→159px 后稳定），不再塌到几乎没有。
- 起始摆幅同样归一（保留随机起始相位，振幅可复现）。
- 挑战模式隔离：`updateSwingDifficulty()` 在 challenge 下直接 return，关卡速度仍由 `content.pendulum.speedFactor` 决定。

### Changed
- 版本链升至 `0.12.5`，SW 缓存键 `studiokit-arcade-0.12.5-v1`。无 localStorage key / Schema / 挑战关卡数据变更；只改 `pendulum-tower.html`。

### Verification
- 实测：周期 2800→1154ms（快 2.4×）、完美窗口 61→24ms（难约 2.5×）、摆幅 214→159px（不再塌缩）；`g` 与周期随层数单调，振幅与目标偏差 ≤0.012rad。
- `arcade_tower_test` **21/21**（新增 TP-13 难度曲线门禁：单调性 + 每档必须更快 + 157 层附近收敛 + 振幅归一 + 摆幅下限）、smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、tower challenge 6/6、pwa 7/7、interaction 5/5、immersive 16/16、validate/build/inline/node --check 全过。设计见 `DESIGN-0.12.5.md`。
- 发布：提交 `7593b0a` 推送 `main`；Actions run `44973571565` 四 job 全绿；CI 与本地 `verify_deploy.py` 均 **41/41** 双端一致（arcade 0.12.5）；双端线上实测 0/30/100/200 层 g 680→4000、周期 2800→1154ms、振幅恒等目标、摆幅 217→159px、0 console error；SW `studiokit-arcade-0.12.5-v1`。

## 0.12.4 — 2026-11-22（已双端发布）

### Fixed
- **回归：近景集装箱退化成纯色方块**。0.12.3 的 LOD 判据写成 `boxes.length > 60 || view.scale < 0.35`，于是塔一超过 60 层，**普通 1:1 跟随视角**也被判为 `dense`，波纹/角件/编号/属性图标全部丢失。现改为**只由缩放决定**：`dense = view.scale < 0.2`（0.2 以上箱体屏幕仍有 ~13×8px，细节保留更好看；120 层 0.10、1000 层 0.013 才压缩为色块）。
- **性能改用视口裁剪**：正常视角按世界 y 范围裁掉不可见箱子（`H/2/scale + 2×BOX_H` 余量），实测 1000 层近景每帧只画 23~24 只（共 1002），因此「近景完整细节」与「千层不卡」可同时成立。
- 结构轮廓只在 `view.scale < 0.35`（真正压缩视图）绘制，不再按层数触发。
- 新增 `#test` 探针 `physicsInfo().renderLod = { dense, scale, drawnBoxes, totalBoxes }`。

### Changed
- 版本链升至 `0.12.4`，SW 缓存键 `studiokit-arcade-0.12.4-v1`。无 localStorage key / Schema / 挑战关卡数据变更；只改 `pendulum-tower.html`。

### Verification
- `arcade_tower_test` **20/20**（新增 TP-12：3/40/120/1000 层近景必须 `dense=false` 且有裁剪，40 层全览仍保留细节、120/1000 层全览才压缩）；实测近景绘制 5/22/24/24 只（对应总 5/42/122/1002），0 console error；smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、tower challenge 6/6、pwa 7/7、interaction 5/5、immersive 16/16、validate/build/inline/node --check 全过。设计见 `DESIGN-0.12.4.md`。
- 发布：提交 `d79d500` 推送 `main`；Actions 四 job 全绿；CI 与本地 `verify_deploy.py` 均 **41/41** 双端一致（arcade 0.12.4）；双端线上实测 40/120/1000 层近景 `dense=false` 且 scale=1（细节保留）、全览 0.2913/0.1028/0.0127 均完整入屏、0 console error；SW `studiokit-arcade-0.12.4-v1`。

## 0.12.3 — 2026-11-22（已双端发布）

### Fixed
- **全览有缩放下限导致高塔看不全**：`overviewFit()` 里 `clamp(avail/span, 0.08, 1)` 的下限 0.08 使 200 层（需 0.0624）溢出 144px、1000 层（需 0.0127）溢出 2704px。现改为 `Math.min(1, avail/span)`，任何层数都严格等比缩到可视区；并让 `overviewT` 在接近目标时吸附（旧指数插值残留 ~3% 偏差会让塔顶塔底各溢出十几 px）。

### Added
- **超高塔 LOD**：`boxes>60 || scale<0.35` 时箱体改为按属性色填充的色块 + 最小 8px 屏幕宽的「塔身脊线」，>60 层再补一圈结构轮廓；1000 层每帧绘制从 ~9000 次降到 ~1000 次 `fillRect`，且极压缩下仍能看出整塔轮廓与属性分布。
- 层号抽稀步长按屏幕间距自适应（1000 层每 ~32 层标一次，首尾必标）；全览横幅在 scale<0.5 时显示「压缩 0.013×」。
- `#test` 的 `stackTo` 上限 40 → 1200，供 1000 层门禁；逐层 `syncHud()` 改为循环后同步一次（避免 O(n²)）。

### Changed
- 版本链升至 `0.12.3`，SW 缓存键 `studiokit-arcade-0.12.3-v1`。无 localStorage key / Schema / 挑战关卡数据变更；只改 `pendulum-tower.html`。

### Verification
- `arcade_tower_test` **19/19**（新增 TP-11：40/200/1000 层均完整入屏、缩放随层数收缩、塔顶落 100–132 / 塔底落 608–640）；实测 40 层 0.2913×、200 层 0.0624×、1000 层 0.0127×，三者屏幕范围均为 116–624（可视区上下留白内），0 溢出、0 console error；smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、tower challenge 6/6、pwa 7/7、interaction 5/5、immersive 16/16、validate/build/inline/node --check 全过。设计见 `DESIGN-0.12.3.md`。
- 发布：提交 `79be219` 推送 `main`；Actions run `44968445299` 四 job 全绿；CI 与本地 `verify_deploy.py` 均 **41/41** 双端一致（arcade 0.12.3）；双端线上实测 200/1000 层 scale 0.0624/0.0127、屏幕 y 均 116–624、0 溢出、0 console error；SW `studiokit-arcade-0.12.3-v1`。

## 0.12.2 — 2026-11-22（已双端发布）

### Added
- **集装箱释放水平速度（抛物线落点）**：此前 `drop` 只有 `vy`、箱子永远垂直落下。现按真实单摆切向速度 `L·cosθ·θ̇` 经吊具阻尼（`RELEASE_VX_K=0.45`、上限 240px/s）传给箱子，落体水平匀速 ⇒ 可见抛物线。先做 7×4 参数扫描再定系数：0.45 时**完美对齐窗口 63–115ms 反而比旧的 43–69ms 更宽**（技能从「等摆到正中」变成「提前放手、看预测落点」），0.15–1.0 全区间均可解。
- **预测升级**：落点预测改为 `释放点 + vx × t`（`t` 由真实落体参数反解），画布从垂直虚线改为**按落体参数采样的抛物线** + 释放点虚影 + 预计落点方框 + 「横移 ±N px」文案；挑战 `releaseWhenAligned()` 改用预测落点判定。
- `#test` 新增 `releaseVx / fallTime / lastRelease{predicted,drift}` 探针；`serialize/restore` 增可选 `drop.vx`（旧档缺省 0，向后兼容垂直下落）。

### Changed
- 版本链升至 `0.12.2`，SW 缓存键 `studiokit-arcade-0.12.2-v1`。无 localStorage key / Schema / 挑战关卡数据变更；只改 `pendulum-tower.html`。

### Verification
- `arcade_tower_test` **18/18**（新增 TP-10：vx 峰值 >50px/s、仍存在完美相位、真实横移 >10px、**预测落点误差 ≤3px**）、smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、tower challenge 6/6、pwa 7/7、interaction 5/5、immersive 16/16、validate/build/inline/node --check 全过。实测 vx 峰值 111–134px/s、预测误差 ≤0.6px、单次横移 40–45px。设计见 `DESIGN-0.12.2.md`。
- 发布：提交 `7c6a4a9` 推送 `main`；Actions run `44964004148` 四 job 全绿；CI 与本地 `verify_deploy.py` 均 **41/41** 双端一致（arcade 0.12.2）；双端线上实测释放 vx 124–138px/s、预测落点误差 **0px**、0 console error；SW `studiokit-arcade-0.12.2-v1`。

## 0.12.1 — 2026-11-22（已双端发布）

### Fixed
- **层塔「物理不对劲」根因**：站立中的塔被 `ctx.rotate(towerLean)` 整体绕塔底旋转最多 20°，而落点判定/堆叠/投影全用未旋转坐标。10 层在 lean=0.19 时视觉塔顶偏 **87.6px**（>58px 落空阈值）、40 层偏 469px ⇒ 玩家对着看到的塔顶松手必然判偏并立即终局。现塔身始终轴对齐（所见即所判），倒塌动画仍逐箱旋转；倾斜改为「支撑面 + 重心投影」常显指示、塔顶虚线与「塔身不稳/将倾」预警。
- **摆幅可达性**：经典模式吊臂小车跟随塔顶中心（`JIB_MIN_X..JIB_MAX_X`，≈0.2s 平滑滑移），塔顶恒处摆幅中心 ⇒ 不存在「塔没倒但释放必失败」。挑战模式严格按关卡数据固定 `content.pendulum.pivotX`（审计发现草稿误读 `content.pivotX` 已修正）。
- **完美吸附力矩不一致**：`comMoment` 改用吸附后的真实偏移，消除「每次都完美但偏 +9.5px ⇒ comOffset=0 却永久歪塔不倒」的假状态。
- **全览 zoom-to-fit**：全览从「只平移」改为真正缩放适配（40 层 `scale≈0.29`，整塔落在 y 116–624 / 740；3 层 `≈1.0` 不缩），层号改屏幕空间绘制并按间距抽稀，重心标注随缩放换算；结算 0.9s 拉远现在真的会缩放（此前只淡入横幅）。
- 落点投影**常显**并新增「会落空！」红色预警（此前第 4 层起完全无参考）；「垂线预览」道具保留精确偏差数值增值。
- 结算拉远后会**保持**全塔缩放（旧实现弹层一出现就把 overviewT 归 0，塔高时又只剩塔顶可见）；开局不再因 overviewT 初值先缩小再放大。
- 全览退出不再残留相机插值（消除「松手时箱子生成到塔顶下方穿过塔身被判负」的窗口）；结算态横幅不再承诺无效的「再按 3 返回」。

### Changed
- 版本链升至 `0.12.1`，SW 缓存键 `studiokit-arcade-0.12.1-v1`。无 localStorage key / Schema / 挑战关卡数据变更；仅改 `apps/arcade/games/pendulum-tower.html`。

### Verification
- `arcade_tower_test` **17/17**（新增 TP-07 可达性 / TP-08 zoom-to-fit / TP-09 所见即所判）、smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、tower challenge 6/6、pwa 7/7、interaction 5/5、immersive 16/16、validate/build/inline/node --check 全过。独立只读审计（subagent）复核并确认根因与遗留项。设计见 `DESIGN-0.12.1.md`。
- 发布：提交 `7d2a80a` 推送 `main`；Actions run `44961843208` 四 job 全绿；CI 与本地 `verify_deploy.py` 均 **41/41** 双端一致（arcade 0.12.1）；双端线上无头 Chrome 各 6/6；SW `studiokit-arcade-0.12.1-v1`。

## 0.12.0 — 2026-11-22（已双端发布）

### Fixed
- **全屏/PWA 底部按钮抬升**：`--ac-thumb-lift=36px`（横屏 20px）让沉浸式道具行从贴底升到拇指区；四档按钮距底 6→42px、安全区 34→70px；toast 同步抬升避免压住道具坞。
- **层塔「偏置堆叠不塌」物理 bug**：根因是 lean 弹簧平衡点恒为 0、盒子 x 从不位移。新增持久重心/支撑模型：偏心×重量×高度为 comMoment，弹簧平衡点随 comOffset 偏移，重心超出支撑半宽且塔体明显倾斜即倒塌；配重道具真实减重心。连续右偏 4 层塌，左右交替 14 层稳。
- 合并 0.11.5（本地未发布）的三项修复：双击放大防护、五子棋落子重影、预览取消出口。

### Added
- **层塔全览**：「🗺 全览」按钮 + 快捷键 3，0.45s 缩放动画、层号/属性/重心标尺，全览期间禁止落箱；结算前 0.9s 动画拉远展示全塔，结算弹层保留「回看塔身」。
- **层塔工地集装箱皮肤**：黄昏工地/塔吊桁架/吊具随钟摆摇摆，集装箱波纹板/角件/编号；4 种真实生效属性（标准/重型 1.65×/易碎完美 +20/奖励 +25），确定性伪随机，画布可读提示。
- 新增门禁 `tools/arcade_immersive_buttons_test.mjs`（16/16）与 `tools/arcade_tower_test.mjs`（13/13）。

### Changed
- 版本链升至 `0.12.0`，SW 缓存键 `studiokit-arcade-0.12.0-v1`。无 localStorage key / Schema / 关卡数据变更；挑战 6 关 6/6。

### Verification
- `arcade_immersive_buttons_test` 16/16、`arcade_tower_test` 13/13、`arcade_interaction_test` 5/5、smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、tower challenge 6/6、pwa 7/7、validate/build/inline/node --check 全过；真机触控 UNVERIFIED。设计见 `DESIGN-0.12.0.md`。

## 0.11.5 — 2026-11-21（本地提交，未发布，已并入 0.12.0）

### Fixed
- **移动端双击误触放大**：17 个页面 viewport meta 统一加 `maximum-scale=1, user-scalable=no`；`arcade.css` 给 html 补 `touch-action: manipulation` 兜底；`engine.js` 的 `installSfxUnlock()` 全局拦截 `dblclick` 默认行为。不引入 `viewport-fit` 回归。
- **五子棋全屏落子按钮文字重影**：根因是画布 `drawPlaceButton()` 与 DOM 覆盖按钮各画一份「落子」（字号/位置不同，全屏缩放后错位）。改为画布为唯一文字源，DOM 层退化为两枚**透明命中层**（无文字/边框/底色），重影消失。
- **五子棋预览无操作出口**：预览确认区拆为「取消 / 落子」两枚按钮，点「取消」只清预览、不动棋盘/回合；画布/提示/页脚文案同步说明。逻辑按钮区 200→280 保证 320px 窄屏两半各 ≥44px。

### Added
- `tools/arcade_interaction_test.mjs`（IX-01…IX-05）：17 页 viewport 防护、dblclick 拦截、透明命中层、四档 + 全屏布局、取消/落子互不干扰。五子棋 `selftest()` 新增第 18 条。

### Changed
- 版本链升至 `0.11.5`，SW 缓存键 `studiokit-arcade-0.11.5-v1`。无 localStorage key / Schema / 玩法数值变更。

### Verification
- 门禁：`arcade_interaction_test` 5/5、smoke 94/94、zen 14/14、calm 17/17（五子棋自检 18 条）、review 5/5、gameplay base 11/11、validate/build/inline/node --check 全过；真机触控与双击放大防护待 Owner 复测（UNVERIFIED）。设计见 `DESIGN-0.11.5.md`。

## 0.11.4 — 2026-11-21（已双端发布）

### Fixed
- iPhone PWA 顶部导航条（共享 shellbar「StudioKit / 街机厅 Arcade / 源码 ↗」）发虚真机修复：之前几轮误改游戏标题栏。真机诊断页逐方案对比确认——把 shellbar 改为 `position: sticky; top: 0`（方案 1/9/10）后文字清晰且无副作用，`fixed`（方案 3）会致下方贴边不可用。本版仅 standalone 下让 shellbar sticky 贴顶，让 WebKit 用其深色纯色替换 iOS 26+ 系统顶缘模糊。
- 移除临时诊断页 `diagnose.html`（定位完成）。

### Changed
- 版本链升至 `0.11.4`，SW 缓存键 `studiokit-arcade-0.11.4-v1`。
- `arcade_pwa_update_test` PU-04 新增 sticky 贴顶断言。

### Verification
- 门禁：`arcade_pwa_update_test` 7/7、`arcade_smoke` 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、validate/build/inline/node --check 全过；滚动 600px 后 shellbar 仍 sticky 贴顶且下方内容正常。无 Schema/key 变更。设计见 `DESIGN-0.11.4.md`。
- 发布：提交 `87795d7` 推送 `main`；Actions run `44909647508` 四 job 全绿；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端一致（Arcade `0.11.4` / Badge `2.2.1` / Venue `0.2.0`）；线上 arcade.css 确认含 sticky 规则、中心页版本 0.11.4、诊断页已 404 移除。真机 iOS 顶部观感待 Owner 复测确认。

## 0.11.3 — 2026-11-21（已双端发布）

### Fixed
- iPhone 安装版顶部模糊真机修复：0.11.2 用 CSS 盖不住 iOS 26+ 的系统级顶缘模糊（真机复测仍发虚）。根因是 `viewport-fit=cover` + 半透明状态栏样式让页面画到状态栏下方，系统在顶缘叠加模糊。本版移除全部 17 页的 `viewport-fit=cover` 与中心页的半透明状态栏 meta（根本），并保留贴住顶边的 fixed 不透明深色条让 WebKit 用纯色替换残留模糊（兜底）。
- PWA 更新检测保持 0.11.2 的行为不变（真机已确认升级到 0.11.2）。

### Changed
- 版本链升至 `0.11.3`，SW 缓存键 `studiokit-arcade-0.11.3-v1`。
- `validate_site.py` 增加防回归断言；`arcade_pwa_update_test.mjs` 新增 PU-00 元信息防护与 fixed 顶边条断言（7/7）。

### Verification
- 门禁：`arcade_pwa_update_test` 7/7、`arcade_smoke` 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、validate/build/inline/node --check 全过。无 Schema/key 变更。设计见 `DESIGN-0.11.3.md`。
- 发布：提交 `82db383` 推送 `main`；Actions run `44904562855` 四 job 全绿；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端一致（Arcade `0.11.3` / Badge `2.2.1` / Venue `0.2.0`）；两端线上 HTML 实测无 `viewport-fit=cover` 与半透明状态栏声明。真机 iOS 顶部观感待 Owner 复测确认（无头 Chrome 无法重现系统级模糊）。

## 0.11.2 — 2026-11-21（已双端发布）

### Added
- PWA 更新检测：中心页「检查更新」按钮 + 更新横幅（发现新版本时提示「立即刷新 / 稍后」，不自动刷新打断游玩）；SW 激活后主动向受控页面广播新版本，`A.Offline` 新增 `checkForUpdate` / `applyUpdate` / `onUpdate` / `swVersion`，首次安装不误报更新。
- iPhone 安装版顶部修复：Arcade shell 导航条改为深色不透明背景、独立窗口顶部安全区铺纯深色底，消除状态栏下的灰白渐层；游戏顶栏提升为独立合成层、舞台 `isolation: isolate` 约束 `backdrop-filter`，顶栏文字不再发虚。

### Changed
- 版本链升至 `0.11.2`，SW 缓存键 `studiokit-arcade-0.11.2-v1`。
- 新增 `tools/arcade_pwa_update_test.mjs`（6 项：更新 UI/API、SW 版本握手、更新横幅、独立窗口深色 shellbar 与清晰顶栏、普通标签页不回归）。

### Verification
- 门禁：`arcade_pwa_update_test.mjs` 6/6、`arcade_smoke.mjs` 94/94、`arcade_zen_scores_test.mjs` 14/14、`arcade_calm_games_test.mjs` 17/17、`arcade_review_test.mjs` 5/5、`arcade_gameplay_test.mjs --suite=base` 11/11、`validate_site.py` / `build_site.py` / `check_inline_scripts.mjs` / 全部 `node --check` 通过。无 Schema/key 变更。设计见 `DESIGN-0.11.2.md`。
- 发布：提交 `f2f1cd1` 推送 `main`；Actions run `44899492208` 四个 job 全绿（Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments）；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 文件 SHA-256 双端一致（Arcade `0.11.2` / Badge `2.2.1` / Venue `0.2.0`，manifest 正确）；双端线上无头 Chrome 各 7/7（中心页 0.11.2 + 16 卡 + 深色 shellbar + 检查更新按钮 + 独立窗口安全区 + checkForUpdate 可用 + 五子棋沉浸顶栏清晰，0 console error）；SW 缓存键 `studiokit-arcade-0.11.2-v1`。真机 iOS 顶部观感与系统更新提示时机 UNVERIFIED。

## 0.11.1 — 2026-11-21（已双端发布）

### Changed
- 结算样式回归：默认恢复 0.10.0 的高级模糊蒙层结算弹层（居中卡片 + 暗色背景 + 模糊），只有点专用回看按钮后才切换到透明回看模式，右上角胶囊可唤回结算卡片。
- 回看按钮按游戏命名：五子棋/2048「回看棋盘」、二十一点/接龙「回看牌桌」、俄罗斯方块「回看井口」、砖块「回看砖场」、矿工「回看矿场」、重力「回看关卡」、记忆「回看牌面」、打地鼠「回看鼹鼠洞」、层塔「回看塔身」、赛车「回看赛道」、影跃「回看影林」、贪吃蛇「回看果园」、雪铃「回看雪夜」、星海「回看战场」；`result` 支持字符串文案，`result:true` 兼容回退为「回看终局」。
- 版本链升至 `0.11.1`，SW 缓存键 `studiokit-arcade-0.11.1-v1`。

### Verification
- `tools/arcade_review_test.mjs` 5/5（静态文案映射 + 默认 blur/回看透明切换 + 四档布局）；全量门禁 ALL GATES PASSED；提交 d51c87e 推送 main、Actions run 44876176661 四 job 全绿、verify_deploy 41/41 双端一致（Arcade 0.11.1）；双端线上 12/12（默认模糊蒙层 + 按游戏文案 + 回看切换，0 console error）；SW `studiokit-arcade-0.11.1-v1`。设计见 `DESIGN-0.11.1.md`。

## 0.11.0 — 2026-11-21（已双端发布）

### Added
- 结算回看：16 款游戏共 45 处结算弹层不再用暗色蒙层盖住最终游戏画面；结算卡片移到底部、取消遮罩与模糊，新增「回看棋盘」按钮与「查看结算」胶囊一键切换，玩家可完整回顾终局棋盘/场景。开局、暂停、错误与续玩弹层外观与行为不变（共享引擎 `createOverlayUi` 的 `result:true` 选项，页面 HTML 模板零改动）。

### Changed
- 五子棋棋盘适度放大：逻辑画布仍 420×740，棋盘 384×384 → 400×400（+8.5% 面积），格距 34 → 36，棋子半径 14 → 15；状态栏、落子按钮与页脚位置不变，旧局内存档与 AI 逻辑不受几何变化影响。
- 版本链升至 `0.11.0`，SW 缓存键 `studiokit-arcade-0.11.0-v1`。

### Verification
- 全量门禁 `tools/arcade_run_all_gates.py` ALL PASSED：validate/build/design 143/inline/stage 78/smoke 94/94/zen 14/14/calm 17/17/review 5/5/gameplay all 104/104/base 22/22。设计见 `DESIGN-0.11.0.md`。
- 双端发布：提交 `8453baf` 推送 `main`；Actions run `44774786680` 首次 Verify 因 CF 生产域传播延迟 1 文件 hash 差异，同一 SHA `--failed` 重跑后四 job 全绿；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 文件 SHA-256 双端一致（Arcade `0.11.0` / Badge `2.2.1` / Venue `0.2.0`）；双端线上无头 Chrome 各 6/6（中心页/棋盘 400/结算透明/回看切换/0 console error）；SW 缓存键 `studiokit-arcade-0.11.0-v1`。

## 0.10.0 — 2026-11-20（已双端发布）

### Added
- 新增 `tools/arcade_fixture.mjs`、`tools/arcade_stage_coverage.mjs`、`tools/arcade_design_check.py`、`tools/arcade_run_all_gates.py`：统一夹具读取、78 关证据矩阵、派生文件重生成一致性与一键门禁。

### Fixed
- 二十一点：庄家 natural 立即结算，同点 push 优先于普通 21 奖励，`swap` 不再救援已结算手。
- 五子棋：`playToEnd()` 异常不再伪装和棋；320/375 增加 44px DOM 落子确认按钮；AI 文案改为启发式、不代表最优。
- 纸牌接龙：修正提示谎报死局和无意义 K 倒列；刷新恢复撤销栈与提示剩余秒数；新增低摩擦重发。
- 挑战：层塔 C05/C06 目标进入判定；方块换块队列/自然重力契约；2048 目标步数口径；星海 C03/C04 二次换位；车道 +5 门牌与时长校准；雪铃彩铃收益/雪花乐谱；影跃影门半径 20 与 `requireDash`；重力窗口收窄；矿工双路线与移除运行时参考顺序。

### Changed
- 设计源统一以 `docs/arcade/0.9/scripts/build_pack.py` 为最终 authoring 源，全链路重生成 78 关派生物；新增每关 contentRevision、按游戏字段白名单、supportedFeatures 与 `--check` 幂等比对。
- 测试侧将贪吃蛇/雪铃/层塔/影跃硬编码答案改为夹具读取；设计包静态断言 1088 → 1090，生成器自检 2128 → 3020。
- 哈希口径改为 canonical JSON + UTF-8 + LF，`SHA256SUMS.txt` 纳入 `--check`；运行时删除 `referenceCatchOrder`，防剧透口径改为“运行时最小化，不声称源码保密”。

### Verification
- 双端发布：提交 `fc37d2b` 推送 `main`；Actions run `44681529684` 四 job 全成功；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 文件 SHA-256 双端一致（Arcade `0.10.0` / Badge `2.2.1` / Venue `0.2.0`）；双端线上无头 Chrome 各 26/26（中心页 0.10.0 + 16 卡、三款棋牌 selftest/regression/开始/暂停、0.10.0 挑战数据字段、0 console error）；SW 缓存键 `studiokit-arcade-0.10.0-v1`。
## 0.9.0 — 2026-11-20（已双端发布）

在 0.8.6 基础上做两件事：逐款修复挑战模式的公平性/续档/计分问题，并新增三款无倒计时单机棋牌。设计与回滚见 `DESIGN-0.9.0.md`；**不改挑战关卡数据、localStorage key 与 Schema**（2048 继续挑战记录语义除外）。

- **新增棋牌**：二十一点（6 手、无下注、换牌/看底牌）、五子棋（11 路、本地 AI、悔棋/提示）、纸牌接龙（Klondike 抽 1、撤销/提示）。三款均为点按优先、无计时、无联网，复用既有进度与局内档。
- **阻断级修复**：记忆翻牌挑战 peek 锁死翻牌与续档丢道具；2048 继续挑战后最终成绩不再丢失；砖块拖动挡板不再误发球；层塔下落中刷新不再重开一箱；矿工时间到允许最后一钩完成结算。
- **公平性与可读性**：2048 滑动阈值按 CSS 尺寸换算；方块挑战换块同步队列；雪铃按 kind 区分休止/彩铃/蓝红铃并禁用无效安可；砖块 C03/C06 锁定门常驻提示；层塔挑战对齐改用关卡目标偏置并记录真实最大倾斜；矿工标注价值/重量；极速车道近距奖励由误算的 5 改为 10+5，出生车道不安全时自动移位；影跃最佳成绩改为跨重试累计时间并可视化易碎平台；星海挑战刷新恢复 Boss 计时与拾取游标、隐藏重复 HUD。
- **兼容**：三款新游戏只使用 `studiokit:arcade:progress:v1` 与 `studiokit:arcade:runs:v1`，不新增 key；既有备份、导入导出与积分记录格式不变。
- **版本**：`ARCADE_VERSION`、注册表、中心页与 SW `VERSION` 统一升至 `0.9.0`，缓存键 `studiokit-arcade-0.9.0-v1`。
- **测试**：`arcade_smoke.mjs` **94/94**、`arcade_zen_scores_test.mjs` **14/14**、`arcade_gameplay_test.mjs --suite=all --repeat=1` **104/104** 与 base **22/22**、新增 `arcade_calm_games_test.mjs` **17/17**、`validate_site.py` / `build_site.py` / `node --check` / `check_inline_scripts.mjs` 全部通过；真机触控与 AI 手感 UNVERIFIED。
- **发布**：提交 `eb5e641` 推送 `main`；Actions run `44582961215` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 文件 SHA-256 双端一致（Arcade `0.9.0` / Badge `2.2.1` / Venue `0.2.0`，manifest `application/manifest+json`）；双端线上无头 Chrome 各 20/20（中心页 0.9.0 + 16 卡 + 三款棋牌注册、三款棋牌规则自检/开始/暂停/续玩、SW 缓存键 `studiokit-arcade-0.9.0-v1`、0 console error）。

## 0.8.6 — 2026-11-19（已双端发布）

Owner 试玩反馈两项：结算「再来一局」应等价于重新开始并支持改选模式；贪吃蛇移动端只需要相对蛇头方向的左右转向按钮。设计与回滚见 `DESIGN-0.8.6.md`。

- **结算模式重选**：13 款游戏经典局与俄罗斯方块禅模式的「再来一局」回到开始弹层；经典 / 挑战 / 禅模式入口按各游戏支持情况显示。俄罗斯方块复用 `returnToStart()` 完整复位到经典入口态，并移除禅结算重复的第二按钮。2048「继续挑战」和挑战关重试 / 下一关 / 选关不变。
- **贪吃蛇相对转向**：触屏改为左右两枚 64px 高宽按钮，左键逆时针、右键顺时针 90°；375px 实测每枚 170×64px。经典 `nextDir + queuedTurn` 与挑战 `chDirQueue` 都按待执行方向处理连点，每格只转一次，避免单格掉头；键盘、WASD、滑动保持绝对方向。
- **兼容**：localStorage key / Schema、挑战数据、玩法数值、积分记录均不变；触屏附加缓冲不写入存档。
- **版本**：`ARCADE_VERSION`、注册表、中心页与 SW `VERSION` 统一升至 `0.8.6`，缓存键 `studiokit-arcade-0.8.6-v1`。
- **测试**：`arcade_smoke.mjs` **91/91**、`arcade_zen_scores_test.mjs` **14/14**、`arcade_gameplay_test.mjs --suite=base --repeat=2` **22/22**；`validate_site.py`（含全 13 游戏结算回调与贪吃蛇按钮静态检查）/ `build_site.py` / `node --check` 全部通过；320/375/390/430 布局通过，真机手感 UNVERIFIED。
- **发布**：提交 `14a9160` 推送 `main`；Actions `44553437432` 四 job 全成功；CI 与本地 `tools/verify_deploy.py` 均 **38/38** 双端一致；双端线上无头 Chrome **20/20**，覆盖 SW、双按钮、经典/挑战相对转向、结算重选、方块三入口与 0 console error；SW 缓存键 `studiokit-arcade-0.8.6-v1`。

## 0.8.5 — 2026-11-19（已发布）

Owner 试玩反馈 6 条：极速车道卡死/车辆消失、远车临近才出现、缺少转向灯换道规则、娱乐点不足；贪吃蛇移动端不精准、提速太快；方块积分记录缺消去层数。0.8.5 一并修复并扩充，设计与根因见 `DESIGN-0.8.5.md`。

- **极速车道卡死（阻断）**：卡车在地平线 `scaleAt=0` 时 `drawCar` 的固定像素内缩产生负宽度，`A.draw.roundRect` 收到负圆角，Canvas `roundRect()` 抛 `RangeError`；异常发生在 `render()` 内导致 rAF 永久停链，画面停在“车辆全部消失”的半帧。修复 `roundRect` 非负半径夹取、`drawCar` 比例内缩与亚像素跳过；`createLoop` 增加逐帧异常兜底（单帧异常不再冻结整局，仍保留 console error 供测试发现）。
- **远车透视**：`scaleAt` 改为与路面同一曲线，地平线保留 16.1% 车身（40×62 → 6.4×10px）；车辆在可见范围外 `z=1.02~1.52` 预生成，进入视野时车道/速度/换道意图已确定；`z>2` 的隐形慢车回收，避免占满 18 车上限。
- **转向灯换道**：非卡车按 `16%+26%×speed` 打灯并线，`signal 0.55s → moving 0.5s` 平滑横移；车灯闪烁 + 车顶箭头 + 目标车道琥珀虚线导引 + 起灯提示音。目标车道被占或会堵死玩家逃生走廊时放弃（`futureSafe`）；碰撞与安全走廊改用连续 `lanePos`，变道中同时占两条车道。
- **娱乐点**：相邻车道超车累计连超（4.5s 窗口，≥3 连尾流 +0.05，撞车清零）；加速带 3s +0.16（上限 1.2）与维修箱 +1 车况随机出现；每 1000m 车流加密 5s；结算给出 `S+/S/A/B/C` 评价并写入积分记录详情。
- **贪吃蛇棋盘优先**：逻辑画布 420×740 → 360×430（CELL 17、18×18 棋盘 306px），375×667 实测棋盘 180→273px；新增 `← ↑ ↓ →` 四枚 58px 方向按钮（与键盘/滑动同规则、拦掉头），触屏隐藏重复 hint；挑战 HUD 移到顶栏，底部常驻本关目标；提速曲线 20 果实 11.8→7.7 格/秒。
- **方块积分记录**：经典局 `recordPlay` 追加 `{ lines, level, detail: "N 行 · Lv.x" }`，中心页积分表详情列显示当次消去层数；禅模式与旧记录不变。
- 兼容：不改 localStorage key/Schema、挑战数据与其余 10 款游戏；旧局内档缺新字段按保守默认恢复。
- 版本：`ARCADE_VERSION`、注册表、中心页版本标记与 SW `VERSION` 统一升至 `0.8.5`，缓存键 `studiokit-arcade-0.8.5-v1`。
- 测试：`arcade_smoke.mjs` **89/89**（新增极速车道远景/打灯换道/拾取/连超与贪吃蛇棋盘/四向/提速 2 项）、`arcade_zen_scores_test.mjs` **14/14**、`arcade_gameplay_test.mjs --suite=base --repeat=2` **22/22**、`validate_site.py` / `build_site.py` / `node --check` 通过。
- 发布：提交 `bdb1176..ee9b45b`（5 个提交：`cf8979e` 极速车道 / `211d8ca` 贪吃蛇 / `16a2a8b` 方块积分 / `35394a2` 测试 / `ee9b45b` 文档）推送 `main`；Actions `44472286080` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **38/38** 文件 SHA-256 双端一致（Arcade `0.8.5` / Badge `2.2.1` / Venue `0.2.0`，manifest `application/manifest+json`）；双端线上无头 Chrome **20/20**（中心页 0.8.5 + 13 卡、SW `VERSION 0.8.5`、极速车道地平线车身 6.43×9.96px + 打灯车 0→1 完成、贪吃蛇棋盘 309px + 4×58px 按钮 + 向下转向、方块运行时 0.8.5、0 console error）；SW 缓存键 `studiokit-arcade-0.8.5-v1`。

## 0.8.4 — 2026-11-18（已发布）

Owner 三轮反馈：「道具区极大挤占了游戏画面」「暂停按钮不方便，主要在地铁上玩」「游戏画面占屏比还是太小」。0.8.4 把画布重排为棋盘优先，并把暂停放进拇指区；不改玩法与数据。

- 棋盘优先画布：画布 420×740 → 340×610，井口 240×480 占画布 79% 高、71% 宽；右侧信息栏 100→76px，顶部带 46px，底部 84px 道具坞带；经典棋盘面积 +58%～+89%，棋盘格边长 +26%～+36%。
- 占屏比（经典，画布/棋盘）：320 35.9→45.3% / 13.3→25.2%；375 42.8→51.0% / 15.9→28.3%；390 64.4→72.1% / 23.9→40.0%；430 69.2→73.2% / 25.7→40.7%；1280×900 21.9→24.6% / 8.1→13.7%。
- 道具坞：经典/挑战 3 格（换块/慢落/暂停）、禅 4 格（+冻结提速），44px 高、≥44×44；旧版画布外道具行与触屏重复 hint 行移除。
- 地铁单手暂停：暂停键为道具坞最后一格 + 触屏双击画面暂停（320ms/30px，鼠标不触发）；顶部按钮、P/Esc、切后台自动暂停保留，共用 pauseByUser()。
- 共享样式冲突修复：`shared/site.css` 门户 `.tool-icon`（46×46）命中道具按钮同名 class，改用 `.tool-glyph`，13 款游戏道具按钮恢复 16px emoji。
- 矮视口回退：viewport ≤560px 高时道具坞回到画布外，保留 0.8.3 布局。
- 兼容：localStorage key/Schema、玩法、存档、积分记录、挑战记录与 `#test` 钩子不变。
- 版本：`ARCADE_VERSION`、注册表、中心页版本标记与 SW `VERSION` 统一升至 `0.8.4`，缓存键 `studiokit-arcade-0.8.4-v1`。
- 测试：`arcade_smoke.mjs` **87/87**（新增拇指区暂停/双击暂停 1 项）、`arcade_zen_scores_test.mjs` **14/14**、`arcade_gameplay_test.mjs --suite=base --repeat=2` **22/22**、`validate_site.py` / `build_site.py` / `node --check` 通过。
- 发布：提交 `77cb02a..ecfdda4`（3 个提交：`853739c` 道具坞 / `0756490` 地铁单手暂停 / `ecfdda4` 棋盘优先画布）推送 `main`；Actions `44122372096` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **38/38** 文件 SHA-256 双端一致（Arcade `0.8.4` / Badge `2.2.1` / Venue `0.2.0`，manifest `application/manifest+json`）；双端线上无头 Chrome **18/18**（中心页 0.8.4 + 13 卡、SW VERSION 0.8.4、方块页运行时 0.8.4、390×844 棋盘 257×513、道具坞 3 格含暂停 / 禅模式 4 格含冻结、触屏 hint 隐藏、0 console error）；SW 缓存键 `studiokit-arcade-0.8.4-v1`。 设计与回滚见 `DESIGN-0.8.4.md`。

## 0.8.3 — 2026-11-15（已发布）

Owner 实机反馈：Android 手机浏览器里中心页顶部导航条上方多出一条空白。

- 根因：部分 Android 浏览器在普通标签页也返回约 40px 的 `env(safe-area-inset-top)`；共享 `.studiokit-shellbar` 把该值当作内边距，而 `* { box-sizing: border-box }` 让 38px 的 `min-height` 被安全区吃掉，导航文字被压到条底，上方留下整块空白。
- 修复：`shared/site.css` 的 shellbar 显式 `box-sizing: border-box`；顶部安全区只在 `html.studiokit-shell-standalone` 下应用，并用 `min-height: calc(38px + env(safe-area-inset-top))` 把安全区加在 38px 导航行之外；窄屏媒体查询同步移除顶部内边距。`shared/site-shell.js` 通过 `display-mode: standalone` / `navigator.standalone` 加类，并在 `resize` 时同步 `--studiokit-shellbar-h`。
- 版本：`ARCADE_VERSION`、注册表、中心页版本标记与 Service Worker `VERSION` 统一升至 `0.8.3`，缓存键为 `studiokit-arcade-0.8.3-v1`；已装 SW 用户会随版本刷新共享资源。
- 测试：`arcade_smoke.mjs` 新增「浏览器模式安全区：shellbar 保持 38px 且文字居中（Android 空白回归防护）」，独立窗口安全区用例改为真实模拟 standalone（38px + 安全区、文字居中）；**86/86** 通过；`arcade_zen_scores_test.mjs` 14/14、`arcade_gameplay_test.mjs --suite=base --repeat=2` 22/22；`validate_site.py` / `build_site.py` / `node --check` 通过。
- 发布：提交 `c1727e7` 推送 `main`；Actions `43670060561` 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **37/37** 文件 SHA-256 双端一致（Arcade `0.8.3` / Badge `2.2.1`）；双端线上无头 Chrome 复测浏览器模式（40px 安全区下 shellbar 38px、文字居中）与独立窗口（78px），SW 缓存键 `studiokit-arcade-0.8.3-v1`，0 console error。Owner 的那台 Android 浏览器仍建议发布后复测。

## 0.8.2 — 2026-11-13（已发布）

Owner 对 0.8.1 的试玩反馈：「模式没问题，但是按钮区占了太多游戏画面区域了」。0.8.2 只优化俄罗斯方块画布外的控件布局，不减少功能、不改变玩法与数据。

- 控件压缩：删除禅模式独立的 `.zen-bar` 按钮行，冻结/恢复提速按钮并入道具行（禅模式同一行 3 个按钮、经典/挑战仍 2 个；`[data-zen-freeze]` 保持 ≥44px，文案/aria 在「冻结提速 ↔ 恢复提速」切换，键盘 `Z` 不变）；结束本局保留在暂停弹层「结束本局并记录」，不常驻以避免误触。
- 空间回收：禅模式隐藏重复 hint（顶栏 HUD + 画布井顶已提示），道具行按钮固定 44px，禅模式页面 gap 8→6px、底部留白 14→6px，画布高度规则扣减常量 302/298px → 190/182px。
- 实测画布（经典 → 禅模式）：320×568 161×286 → 196×346、375×667 215×381 → 247×437、390×844 316×558 → 348×614、430×932 366×646 → 398×702、1280×900 348×614 → 379×670；**面积相对同版本经典模式 +18%～+47%**，相对 0.8.1 禅模式 **+41.6%～+126.8%**；四档与桌面 0 溢出，禅模式画布高度比经典多 56–60px。
- 测试：`arcade_zen_scores_test.mjs` ZS-04 重写为「禅模式 HUD / 控件压缩 / 画布增量」（zen 道具行 3 按钮 ≥44px、无独立按钮行、hint 隐藏、四档画布比经典高 ≥40px），仍为 14 场景；`arcade_smoke.mjs` 85/85、`arcade_gameplay_test.mjs --suite=base --repeat=2` 22/22 零回归。
- 版本：`ARCADE_VERSION`、注册表、中心页版本标记与 Service Worker 缓存键统一升至 `0.8.2`（`studiokit-arcade-0.8.2-v1`）。
- 文档：新增 `apps/arcade/DESIGN-0.8.2.md`（前后对比/兼容/回滚）与 `docs/archive/0.8.2-CONTRACT.md`、`docs/archive/0.8.2-REVIEW.md`。
- 发布：提交 `077ccf5` 推送 `main`；Actions `43447829596` 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **37/37** 文件 SHA-256 双端一致（Arcade `0.8.2` / Badge `2.2.1`）；双端线上无头 Chrome **14/14**（门户/中心页 0.8.2 + 13 卡 + 积分区、方块页经典画布 316×558 → 禅模式 348×614（+56）、3 个道具行按钮 44px、hint 隐藏、真实点击冻结按钮切换文案/aria、结算写 zen 记录且经典 high 不变）；SW 缓存键 `studiokit-arcade-0.8.2-v1`。
- 未验证：iOS/Android 真机触控手感与低端机帧率仍为 UNVERIFIED；窄屏 5 键触控面板高度保持不变（为保证「加速/落底」精度）。

## 0.8.1 — 2026-11-13（已发布）

0.8 系列的功能补充版本：俄罗斯方块新增**禅模式**（无限游玩 + 用户可冻结提速），中心页新增**积分记录表**（跨游戏收集并展示每局积分）。既有 5 个 localStorage key 与 Schema 不变，只新增 `studiokit:arcade:scores:v1`。

- 平台：新增 `window.Arcade.Scores`（`studiokit:arcade:scores:v1`，Schema v1：`{ at, gameId, mode, score, lines, level, durationMs, detail }` 最新在前、最多 300 条；`record/list/stats/modeLabel/exportData/importData/resetGame/resetAll`；损坏数据读取 fail-closed，不删除原值）。`A.Progress.recordPlay(gameId, score, meta)` 扩展为模式感知：所有 13 款游戏的统一结算点自动收集经典积分；`mode:'zen'` 时**不更新经典最高分**；`Playtime.recordRound` 返回本轮时长供积分记录使用。导出备份新增 `scores`，旧备份（无 `scores`）导入时保留当前积分记录；`Progress.resetGame/resetAll` 同步清理积分。共享弹层新增可选第三按钮 `btn3`（不提供时其他游戏行为不变）。
- 俄罗斯方块禅模式：开始弹层第三入口「🧘 禅模式」→ 无限局（无 40 行收局、无关卡终点）；速度随等级提升，按 `Z` 或画布下方「❄ 冻结提速」后速度停在当前等级、等级与行数继续累计，恢复时立即追平 `level`；HUD（顶栏 `data-hud-zen` + 画布井顶 `ZEN · 速度 Lv.x`）；暂停弹层「结束本局并记录」与井口结束共用同一结算（「禅模式结束」、不显示失败），结算仅一次写入积分记录；禅模式局内状态写入既有 `runs:v1` 的 `data`（`mode:'zen'` / `zenFrozen` / `zenSpeedLevel` / `zenElapsed`），刷新可恢复冻结状态与速度，旧档缺 `mode` 仍按经典恢复。
- 中心页积分记录表：「游玩统计」之后新增区块（时间 / 游戏 / 模式 / 得分 / 详情），按游戏与模式筛选，最新在前、最多展示最近 50 条，空状态与“仅显示最近 50 条”提示；单独「清除积分记录」只清 `scores:v1`，不影响最高分、游玩时长、局内进度与挑战记录；单游戏清除/清除全部/导入导出提示同步。
- 版本：`ARCADE_VERSION`、注册表、中心页版本标记与 Service Worker 缓存键统一升至 `0.8.1`（`studiokit-arcade-0.8.1-v1`）。
- 测试：新增零依赖 `tools/arcade_zen_scores_test.mjs`（14 场景：禅模式无限/冻结恢复/结算积分/表格筛选清除/导入导出/旧档与损坏兼容/320–430 布局，含四档开始弹层三入口完整可见断言）；`arcade_smoke.mjs` 85/85、`arcade_gameplay_test.mjs --suite=base --repeat=2` 22/22 零回归；独立评审 APPROVE-WITH-NOTES，发布前修复 320/375 窄屏禅模式入口被裁剪（M2）及相关 Minor。
- 文档：新增 `apps/arcade/DESIGN-0.8.1.md`（设计/数值/数据模型/兼容/回滚）与仓库内 `docs/archive/0.8.1-CONTRACT.md`（并行实施契约）、`docs/archive/0.8.1-REVIEW.md`（独立评审与 Lead 处理记录）。
- 发布：提交 `575a766`（功能）+ `41fa79e`（评审修复）推送 `main`；Actions `43423208129` 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **37/37** 文件 SHA-256 双端一致（Arcade `0.8.1` / Badge `2.2.1`）；双端线上无头 Chrome **10/10**（门户、中心页积分记录区、方块页 0.8.1、禅模式无限/冻结恢复/结算不污染最高分、中心页表格展示禅记录）；SW 缓存键 `studiokit-arcade-0.8.1-v1`。
- 未验证：iOS/Android 真机触控（含禅模式按钮与 Z 键替代）、低端机帧率仍为 UNVERIFIED；积分记录无跨设备同步/排行榜（离线优先约束）。

## 0.8.0 — 2026-11-13（已发布）

本版本以 `0.8.0` 名义发布，同时包含影跃影冲竖切片与外部 0.9 关卡设计包的 13 游戏 × 6 关（78 关）挑战模式；`docs/arcade/0.9/` 中的 `0.9` 是设计包版本，不是应用版本。

把外部 0.9 关卡设计包（13 游戏 × 6 关 = 78 关）落地为每款游戏的独立挑战模式；经典/无尽保持一级入口，引擎、注册表与 SW 缓存统一升至 0.8.0。

- 平台：新增 `window.Arcade.Challenge`（`studiokit:arcade:challenge:v1` 记录：cleared/best/assisted/collectibles；取关/解锁/结算 HTML/选关 HTML；导出/导入加法兼容；`Progress.resetAll/resetGame` 同步清理挑战记录）。新增 `tools/arcade_09_data.mjs`：校验设计包并生成 13 个运行时数据 `apps/arcade/challenge/<gameId>.js`（不含参考解）+ 测试夹具 + 数据报告，输出幂等。`arcade.css` 增加挑战选关/结算/标记共享样式；`sw.js` 预缓存 13 个数据文件且缓存版本升至 0.8.0。
- 影跃：0.8 影之试炼迁移为 0.9 C01–C06 数据驱动（影冲/影门/支线卷轴/侧风/开关/检查点/失败复盘），旧 `mode:'trial'` 存档映射 C01–C03 或提示重开、不静默删档；新增 CH-SL 场景（C01–C06 真实输入回放）。
- 12 款其余游戏：俄罗斯方块/2048/记忆翻牌/贪吃蛇/打地鼠/极速车道/重力翻转/砖块计划/雪铃/层塔/星海突击/黄金矿工 各增 6 关挑战模式（固定盘面/地图/脚本时间轴/固定车流/固定障碍/固定砖阵/铃序/委托/波次/矿图），逐游戏实现契约 §4 的统一入口/选关/记录/暂停退出/失败重试/存档/assisted，并保留全部 0.7/0.8 经典机制。
- 测试：`tools/arcade_gameplay_test.mjs` 支持 `--suite=base|challenge|all`、`--game`、自动发现 `tools/challenge/*.mjs`；新增 78 关设计↔运行时数据门禁（CH-DATA-001）与 13 游戏经典入口门禁（CH-CLASSIC-001）；13 游戏各新增确定性场景模块。`arcade_smoke.mjs` 85/85 保持。
- 文档：仓库内 `docs/arcade/0.9/` 完整导入设计源与校验脚本、差异报告、集成契约、实施计划、数据报告、13 份实现记录（证据等级/设计差异/UNVERIFIED）、独立评审与 Owner 试玩包。
- 未验证：iOS/Android 真机触控/手感/低端机帧率；良多物理/弹幕/摆钩关卡为 engine-replay 证据而非真人输入；设计层差异（影跃捷径/时长、砖块 K 可达性最小修正、星海 Boss 时间窗弱点等）需 Owner/Reviewer 决定。78 关数据与参考解由设计包自检证明存在性，不代表真实可玩性。
- 发布：提交 `95a063f` 推送 `main`；Actions `43369758813` 四个 job 全部成功；`verify_deploy.py` 37/37 文件双端一致（含 13 个挑战数据脚本），线上 Arcade `0.8.0` / Badge `2.2.1`；双端线上无头 Chrome 12/12；SW 缓存键 `studiokit-arcade-0.8.0-v1`。

## 0.8.0 影跃竖切片（同一版本发布；以下为开发过程记录）

本轮只做《影跃》的玩法深度竖切片，用 Owner 试玩验证“一款游戏先出现真正的目标/决策/技巧/探索”后再决定是否推广到其余 12 款；其余游戏与 0.7.0 一致；本竖切片随后与 0.9 设计包一起以 `0.8.0` 发布。

- 影冲（GP004）：新增空中一次短水平冲刺（620px/s × 0.13s ≈ 80 逻辑像素，重力 ×0.25，落地终止并保留 60% 横向惯性）；每次成功着陆补充一次、开局/重开各一次；不可用时不缓存。键盘 `Shift`/`J` + 独立 ≥44px 触屏按钮（可与画布左右半屏多指并发），按钮/画布状态与残影音效同步；存档只向既有 `runs:v1` 的 `data` 追加 `dashCharges/dashTimer/dashDir`，旧档缺字段按 1/0 恢复；新增 `setSeed/resetWithSeed/startClassicWithSeed` 等确定性测试钩子。
- 影之试炼（GP005）：新增 S1 初入影林 / S2 月下断桥 / S3 影冲试炼 三关手写关卡、顶部影门结算、失足 1 次点击重试、暂停退出本关；经典主按钮保持「开始游戏」，`btn2` 进入试炼；三关手工数据内嵌，独立求解器 3/3 PASS（S3 关键缺口几何上必须一次影冲，错误冲刺全部回收不判死）；进行中状态写入既有 `runs:v1` 的 `data`（`mode/stageIndex/trialElapsed/trialScrolls/trialResults/...`），旧档缺 `mode` 按经典恢复；试炼不写经典最高分/Playtime 轮次、不新增 localStorage key、不改 Schema、结算不区分 assisted（是否使用羽落/月弹不单独标记）。
- 双路线与探索（GP006）：S2「稳妥长路 / 近路快线」双路线均可通关（求解器理论最短 11.12s vs 7.88s），结算/三关总结显示路线与卷轴；金色卷轴为可选探索（不影响战力）；失足复盘按关卡给出可归因提示与「卷轴是可选的」说明；新增 `trialInfo.route/routeLabel/routes/routeInfo/scrollsCollected/scrollsTotal` 与只读 `routeInfo()/forceRoute()` 测试钩子。
- 测试基座（GP003）：从 `tools/arcade_smoke.mjs` 抽出零依赖 CDP 库 `tools/lib/arcade_cdp.mjs`（85 项 smoke 行为与数量不变、端口可 env 覆盖）；新增 `tools/arcade_gameplay_test.mjs` 确定性场景（11 个：seed 复现、影冲单次/落地补充/暂停刷新恢复、旧档恢复、试炼三关状态机、失败重试、暂停刷新恢复、双路线判定、卷轴可选、Boss 生成清关、赛车安全走廊）；新增 `tools/arcade_stage_solver.mjs` 三关独立可达性求解器。
- 文档：新增 `docs/arcade/`（事实冻结、六维量表、S1–S3 数据与设计、确定性测试协议、独立评审与 Owner 试玩包）；不进发布产物。
- 测试：`arcade_smoke.mjs` 85/85（经典与 13 款零回归）、`arcade_gameplay_test.mjs --repeat=2` 11 场景×2 全绿、`arcade_stage_solver.mjs` 双路径 3/3 PASS、`validate_site.py` / `build_site.py` / `node --check` 全过；`verify_deploy.py` 在 0.8.0 发布时对双端逐文件校验通过。
- 未验证：iOS/Android 真机多指触控与手感、真人通关率/难度、低端机 60fps——均保留 UNVERIFIED，等待 Owner 试玩（GP007 门槛）。

## 0.7.0 — 2026-11-13（已发布）

本轮主题是“更快乐、但不要求沉迷”：13 款游戏都增加了由玩家主动决定何时使用的道具、更直接的即时反馈，或更自然的收尾目标；没有签到、每日奖励、商店、付费抽奖、跨局成长或限时回归任务。

- 共享运行时新增 `A.createToolbelt(defs, options)`：统一创建画布内道具栏，支持剩余次数、禁用态、激活态、可选快捷键、编辑态保护与异常隔离；各游戏自己持有次数、效果和存档字段，共享层不隐式扣次数。新增 `.joy-toolbelt` 样式（含 `prefers-reduced-motion` 降级）。
- 新增一次性休息提醒：单个游戏页累计有效游玩 20 分钟后，用本地 Toast 温柔提示一次（可暂停喝水或带着成绩收工），不自动暂停、不反复催促、不写入存储；暂停、切后台、失焦和开始/结算弹层都不计时。`Playtime` 只新增只读 `rest` 与 `#test` 测试入口。
- 中心页新增 🎲「惊喜一下」：从 13 款游戏中随机打开一款，连续点击不重复上一款；不附奖励、不产生每日任务。页脚加入「快乐约定」说明。
- 记忆翻牌：👀 再看一眼 ×2（显示未配对牌 1.2s），💡 灵犀提示 ×2（下一次首张翻牌后描边它的伙伴 1.5s）；预览至少 0.6 秒后可点按跳过。
- 2048 合成：🧹 小锤 ×2（移除 ≤64 方块）、✨ 升一级 ×1（≤256 方块翻倍），两者不额外生成方块、不加步数/分数且可撤销；撤销快照带次数，旧快照不会复制道具；首次合成 2048 后真正进入可收尾的胜利结算，也可继续挑战。
- 打地鼠：🌟 金鼠三连 ×1（之后三次实际刷出固定为金鼠、不出炸弹）、🛡 安心锤 ×1（6 秒内炸弹不扣心/时间/连击且不得分）；新增实际得分跳字，快捷键 `Q / E`。
- 砖块计划：↔ 宽板 ×1（主动 10 秒加宽）、🔨 重锤球 ×1（接下来 3 次真实砖碰直接击碎并按原规则计分）；完成第 3 关即圆满收局，旧档高于第 3 关仍保留原流程。
- 重力翻转：🛡 相位护盾 ×1（下一次撞障碍才消耗）、🧲 星星磁铁 ×2（8 秒吸附 180px 内星星，不动障碍）；距离达到 3000m 穿过星门完成旅程。
- 贪吃蛇：🫧 慢速泡泡 ×2（6 秒内步进间隔 +0.06s）、✂ 轻身剪 ×1（去掉尾部 6 节，最短保留 3 节，不扣分）；普通与金果实合计 20 个即果园丰收。道具次数与慢放剩余时间写入既有 `runs:v1` 的 `data`，刷新继续不丢。
- 俄罗斯方块：🔀 换块 ×2（交换当前块与 NEXT，不动 7-bag）、🫧 慢落 ×2（6 秒自然重力计时减半）；新局 40 行轻快收尾，旧档缺 `shortRun` 时按无尽局恢复，避免续玩突然结束。
- 星海突击：💥 电磁脉冲（清空敌弹、普通敌机击坠、Boss 扣 100 HP，无可作用目标不消耗）、🛡 星盾（5 秒护盾，独立于受击无敌）；每次击破 Boss 进入 CLEAR，可选「下一关」或「圆满收局」，Boss 固定补给两种道具各 1 次。
- 极速车道：🛡 防撞气囊 ×1（真实撞车才消耗，不扣命不减速）、🫧 车流慢放 ×2（6 秒敌车相对位移 ×0.55，玩家速度与安全走廊预测不变）；5000m 抵达终点。
- 影跃：🪶 羽落 ×2（5 秒内仅下落重力 ×0.35、最大落速 360）、🌙 月弹 ×2（下一次着陆起跳 -768，之后恢复 -640）；落地显示「稳！/借势！/快跳！/月弹！」。
- 层塔：📐 垂线预览 ×3（前 3 层教学后，主动消耗显示下一箱落点投影）、⚖ 配重 ×2（当前倾斜减半、角速度降至 25%，保留物理惯性）；普通落点报告方向与像素偏差。
- 黄金矿工：保留原来 4 个道具并减少浪费——瞄准线只在钩爪摆动时按 $2/s 计费，伸出/回收/暂停不扣费；强力绞盘改为夹物成功入账才扣次数，抓空或炸药不浪费，旧档 `winchArmed=true, winch=0` 不会变负；夹中当帧即显示物品与价值。
- 数据兼容：`progress:v1` / `runs:v1` / `prefs:v1` / `playtime:v1` 的 key 与 Schema 全部不变；新字段只追加在各游戏 `runs:v1` 的 `data`，旧档缺字段按每局初始补给恢复，存在字段逐项 clamp。回滚只需还原相关页面与共享文件。
- 文档：新增 `DESIGN-0.7.0.md`，记录产品原则、每款数值、兼容与回滚；README 增加道具总表与“快乐约定”。
- 独立复审修复：
  - 记忆翻牌 / 2048 / 打地鼠 / 砖块计划 / 俄罗斯方块五个画布内道具栏改为画布外，避免 320×568 与横屏短舞台遮住挡板、棋盘或井底；共享 `createToolbelt` 新增 `placement: 'below'`、`destroy()`、CapsLock/输入法/禁用态按键处理、`getCount` 非有限数失败关闭、空定义不插入空栏。
  - 极速车道 / 重力翻转 / 贪吃蛇新增 `shortRun` 标记：只有 0.7.0 新局启用 5000m/3000m/20 果实目标，旧版无尽档恢复后不会被首帧强制收尾。
  - 砖块计划主动宽板不再因失球被清零，失球后同步按钮状态；2048 的 +2048 胜利奖励只发一次；星海 CLEAR 刷新后重新显示「下一关 / 圆满收局」；层塔垂线预览改为释放时扣次数；矿工绞盘补 `aria-pressed` 与重复点击提示；暂停不再清空已武装的道具状态。
  - 20 分钟提醒测试改为走真实 `closeSegment→提醒` 路径，并校验阈值、只触发一次、不写任何 localStorage；中心页随机入口验证返回后不重复且不写存储。
  - 增加横屏 667×375 布局、320/375/390/430 道具按钮不压画布、旧档 13 款补给、次数耗尽/旧快照等回归；`tools/verify_deploy.py` 校验清单从 11 个文件扩到 24 个（13 游戏页 + `arcade.css`）。
- 测试：`arcade_smoke.mjs` 85/85（连续两次通过）；`validate_site.py` / `build_site.py` / `node --check` 全过。

## 0.6.2 — 2026-11-12

- 黄金矿工：目标金额统一取整。瞄准线按秒扣费会留下小数，之前提前结算进入下一关时会把小数带进目标，HUD/结算出现很长的数字；现在关卡起点按 HUD 显示的整数金额计算，旧档中的小数目标在恢复时也会取整。
- 黄金矿工 HUD 可读性：画布顶部增加深色渐隐背景，金额/关卡/倒计时改用高对比浅色；DOM 子 HUD 的「目标」改为金色胶囊并放大数字，窄屏下仍保持单行。
- 回归：`arcade_smoke.mjs` 的矿工关卡检查加入「小数余额 + 提前结算后目标必须为整数」断言；检查总数仍为 66。
- 俄罗斯方块触屏按钮重排：从五键等宽横排改为双手分区——左手 `←` / `→` 大键横移，右手 `↻` 旋转、`↓` 加速、`⇓` 落底；按钮增高到 64px（320px 下 58px），加入图标 + 文字标签、分组间距与落底实心金色强调，支持左手横移与右手加速双指同按。
- 两个下降键的区分：`加速`按 0.06s/格逐格下落、按住时青色高亮，不会立即锁定；`落底`为实心金色按钮，点按立即锁定并触发短促下沉/金色边框脉冲与更低沉的 slam 音效，支持的设备附带 16ms 轻震；触屏/键盘提示统一改为“↓ 按住加速 · ⇓ 点按落底”与“↓ 加速 / 空格落底”。
- 俄罗斯方块画布不再承担隐藏触摸区：移除左右半屏横移、中列旋转与底部软降，以及“按住此区 = 软降”提示；点按/按住画布不会再误移动或误软降。
- 俄罗斯方块提示与音效：触屏/键盘提示拆分为按设备显示的单行文案；DAS/ARR 自动连移不再逐格播放 UI 音效，避免按住时每秒约 20 次叠音。
- 回归：`arcade_smoke.mjs` 扩充按钮顺序/标签/尺寸/分组、加速与落底的样式/行为差异（加速不锁定、落底锁定 + 脉冲类）、左右手多指同按、画布不劫持、320/390/430 与底部安全区断言；检查总数仍为 66。
- 版本与缓存：`ARCADE_VERSION`、`shared/tool-registry.json`、中心页版本号与 Service Worker 缓存统一升至 `0.6.2`；已安装 PWA 会获取新引擎。
- 发布：提交 `0159437` 推送 `main`；Actions `43155182519` 的 `Validate and build`、`Deploy GitHub Pages`、`Deploy Cloudflare Pages`、`Verify both deployments` 全部成功；双端 11/11 文件一致，线上 `0.6.2`。

## 0.6.1 — 2026-11-12

- 星海突击：Boss 从顶部入场穿过时不再与贴顶玩家发生机体碰撞，入场完成前也不会发射弹幕；避免刚进入 Boss 战就被无预警撞掉一条命。
- 回归：Boss 清关断言增加生命 +1 校验；仍为 66 项检查。
- Service Worker 缓存版本升至 `0.6.1`，已安装 PWA 会获取修复后的引擎。

## 0.6.0 — 2026-11-11

- 黄金矿工：
  - 修复连续使用「指哪打哪」后摆幅逐渐变小、摆速变慢：摆角（`pend`）与钩爪朝向（`clawAngle`）分离，瞄准只改伸出方向，收钩后恢复原摆动能量；旧档缺少 `clawAngle` 时回退到摆角。
  - 新增第四个道具 📐 瞄准线（快捷键 `4`）：开启后从矿工沿当前钩爪方向画虚线，高亮第一个命中物并标出价值/炸药；每秒扣 `$2`，余额不足自动关闭；支持暂停存档恢复，暂停期间不计费。
- 星海突击：
  - 新增关卡节奏：每 30 秒普通波次后生成关卡 Boss（赤焰旗舰/雷霆母舰/虚空堡垒等），Boss 有独立血条、三档火力（扇形弹幕 + 低血量环形弹幕），击破后生命 +1、掉落 3 份 Buff 并进入下一关；HUD 显示关卡与 Boss 血条。
  - 弹种改为叠加：普通弹始终发射，散射 / 激光 / 追踪 / 速射各自追加弹型，可同时生效；Buff 掉落优先补未拥有类型，HUD 显示各 Buff 剩余秒数。
  - 玩家纵向移动范围从底部 380–710 扩展到 46–714（仅避开顶部 HUD），整屏可移动。
  - 旧单弹种局内档自动迁移为对应 Buff；新增关卡/Boss 字段仍写在既有 `runs:v1` Schema v1 的 `data` 中。
- 全屏：
  - 移除“点开始/继续弹层任意位置自动进入全屏”的 0.4.0 行为；现在只有 `⛶`、键盘 `F` 或弹层内「全屏模式」按钮会显式进入。`prefs.immersive` 仍记录上次选择，但不再劫持开始/继续触控。
- 其他：
  - 修复中心页「继续上次」长摘要（星海关卡信息）在 320px 撑宽页面的问题（`min-width:0`）。
  - `arcade_smoke.mjs` 扩至 66 项：新增黄金矿工摆动能量、瞄准线计费、星海弹种叠加、Boss 清关、全屏移动与“点开始不自动全屏”检查。
  - 版本升至 `0.6.0`；Service Worker 缓存版本同步，安装后的 PWA 会获取新引擎。

## 0.5.1 — 2026-11-11

- 修复游玩统计在连续游玩超过 15 秒后停止累计的问题：15 秒定时落盘会关闭当前时间片，现在落盘后立即开启下一段；暂停、切后台、失焦、开始界面仍不计时。
- `arcade_smoke.mjs` 新增连续游玩 17 秒的回归检查（手动 flush 后累计时长 ≥16 秒），总检查数保持 63 项。
- Service Worker 缓存版本升至 `0.5.1`，已安装 PWA 会拉取新的 `engine.js`，而不是继续使用 0.5.0 的旧缓存。
- 发布：提交 `6739521`；Actions `43008560646` validate + build + deploy 成功；线上连续游玩 17 秒实测 `17012ms`，PWA 缓存键 `studiokit-arcade-0.5.1-v1`，预载 24/24。

## 0.5.0 — 2026-11-11

- 游玩时长与轮次统计：
  - 中心页新增「游玩统计」：累计时长、今日、近 7 天、完成轮次；近 7 天柱状图；按游戏列出时长/轮次/最近游玩，并可展开最近 30 轮（时间、单轮用时、得分、新纪录）。
  - 只累计真实游玩时间：开始/暂停/结算弹层关闭且页面可见；暂停、切后台、停在开始界面不计时。游戏页每 15 秒落盘，暂停、结算、隐藏、`pagehide` 立即落盘。
  - 新增 `studiokit:arcade:playtime:v1`（Schema v1）；既有 `progress:v1` / `runs:v1` / `prefs:v1` 的 key 与 Schema 不变。导出/导入备份新增可选 `playtime` 字段，旧备份仍兼容；导入失败回滚三个 key；单游戏清除与全部清除同步清理统计。
- 分享：
  - 中心页「分享给朋友」分享合集；游戏开始/暂停/结算弹层新增「↗ 分享给朋友」分享当前游戏深链。
  - 优先 `navigator.share`，取消不报错；不支持时复制推荐文案 + 链接，剪贴板不可用再提示手动复制。分享内容不包含任何成绩或本地数据。
- PWA 与离线预载：
  - 新增 `manifest.webmanifest`、`sw.js` 与 192/512/maskable/Apple Touch 图标；中心页可安装到桌面，以独立窗口启动；iOS 走「分享 → 添加到主屏幕」说明。
  - 中心页新增「预载全部游戏」：SW 安装时缓存中心页外壳（11 项），点击后逐项缓存 13 款游戏并显示进度；完成后断网可从桌面图标/中心页进入。未预载游戏断网时显示离线提示页，不伪造内容。
  - SW 导航网络优先、静态资源缓存优先，仅处理同源 Arcade 与 `shared/` 资源；版本更新清理旧缓存，需重新预载。`file://` / 不支持 SW 的环境自动降级，在线游玩不受影响。
- 黄金矿工：修复连续使用「指哪打哪」后钩爪停在垂直平衡位置、不再左右摆动的问题；瞄准正下方目标时保留最小角速度，收钩与旧档恢复时补起步能量，避免摆角 0 / 角速度 0 的死状态。
- 文档与测试：新增 `DESIGN-0.5.0.md`；`validate_site.py` 校验 0.5.0 版本、playtime key、统计/分享/离线标记、manifest 与图标；`arcade_smoke.mjs` 扩至 63 项，覆盖计时与暂停排除、轮次明细、汇总展开、备份兼容、分享兜底、PWA 清单、预载 24 项、断网回归与矿工连续瞄准后恢复摆动。
- 发布：`b8abe41`（功能）+ `c8c049d`（矿工摆钩修复）fast-forward 合入 `main`；Actions `42974993445` validate + build + deploy 成功；线上 0.5.0 验证 13 卡、PWA 可安装、预载 24/24、矿工连续三轮瞄准仍摆动、零 JS 错误。

## 0.4.0 — 2026-11-10

- 全屏 / 沉浸游玩（13 款游戏共享）：
  - 游戏顶栏新增 `⛶` 按钮（44×44），开始/暂停弹层增加 `⛶ 全屏模式` 入口；支持键盘 `F` 切换。
  - 支持 Fullscreen API 时请求整页全屏并尝试锁定竖屏；iPhone Safari 等不支持的环境自动退化为 CSS 沉浸布局，并给出一次可关闭的说明。
  - 全屏下隐藏 shellbar、DOM HUD 与操作提示，保留紧凑标题与暂停/静音/退出按钮；画布按 420:740 吃满视口（375×667 上约 250×441 → 349×615），四周适配 safe-area；画布内已有分数/关卡/时间 HUD，因此不重复占位。
  - 记住用户选择：`prefs.immersive`；下次从开始/继续弹层进入时自动恢复，主动退出后不再强制。
  - 修复旋转/全屏切换后的画布尺寸延迟：`createStage` 增加 `orientationchange` 重算，输入层记录指针是否出现过。
  - 普通模式顶栏为全屏按钮腾位：≤460px 隐藏 DOM HUD、返回链接只留箭头并压缩间距；画布内 HUD 不受影响，最高分仍可在中心页/结算查看，320/375 标题不再被裁切。
- 黄金矿工：
  - 起始摆速由 520 降至 300（第一关周期约 +32%），逐关 380 / 470 / 580 / 700，之后每关 +80、上限 1300；HUD 的“摆速 ×”改以 300 为基准。
  - 新增底部限量道具条，不额外占用页面高度；物品生成下限按道具条实际高度动态换算（含旧档恢复与全屏/旋转重算），避免物品被道具条遮挡：
    - 🎯 指哪打哪：初始 2、每关 +1、上限 3；激活后点金块/钻石/石头，钩爪直线抓取；点空或点炸药不扣次数，飞行途中不误触其他物品。
    - ⏳ 加时：初始 1、偶数关 +1、上限 2；本关 +10 秒，最多比基础时长多 10 秒。
    - 💪 强力绞盘：初始 1、每 3 关 +1、上限 2；下一次成功回收无视重量（980 px/s），入账时才消耗。
  - 道具支持触屏按钮与快捷键 `1 / 2 / 3`，有剩余次数徽标、禁用态、`aria-label` 与 320px 窄屏布局；暂停/结算自动取消瞄准；中心页搜索文案同步道具操作。
  - 达标提示改为画布内、道具条上方（原先固定底边会挡住道具）；钩爪也不再伸到道具条后面。
  - 局内档在既有 Schema v1 内追加 `tools` 与 `winchArmed`，旧档缺字段时按初始补给恢复；最高分与进度 key 不变。
- 文档与校验：新增 `DESIGN-0.4.0.md`；`validate_site.py` 校验 0.4.0 版本、全屏 helper 与矿工道具标记；`arcade_smoke.mjs` 扩至 57 项，覆盖全屏/沉浸、偏好自动恢复、道具消耗与存档恢复、TNT 不可锁定、动态物品下限、320/375/390/430 布局与刘海安全区。

## 0.3.2 — 2026-11-09

- 黄金矿工：修复夹中的物品仍绘制在原位置的问题；现在被夹物只跟随钩爪回收，原位置不再残留。
- 记忆翻牌：难度曲线由 5 关改为 6 关由少到多（6→8→12→16→20→24 张），预览时间 3.2→1.8 秒平滑递减，低关不匹配停留时间延长，降低前几关陡峭感。
- 测试：`tools/arcade_smoke.mjs` 扩至 51 项，新增记忆 6 关配置与黄金矿工夹取跟随断言；全部通过。

## 0.3.1 — 2026-11-09

- 按《Arcade 游戏性评审 PRD》完成一轮公平性、移动端输入与生命周期打磨（13 款游戏回归）。
- 共享输入：`createInput` 增加 active pointerId、第二指隔离、pointercancel 与 blur/visibility 清理；键盘不再拦截可编辑控件。
- 移动端布局：暂停按钮统一 44×44 CSS px；移除全页 `user-scalable=no`；加入 safe-area 内边距；俄罗斯方块/赛车为控制区预留高度，黄金矿工增加可读的 DOM 子 HUD；320×568 与 375×667 全页无横向溢出。
- 雪铃：铃铛标记 `consumed`，同一铃铛每局只奖励一次；已用铃铛淡出；波纹改为世界坐标随相机移动。
- 影跃：前 8 块静态教学平台；平台横向偏移按真实跳跃滞空与加速度计算并留安全余量；移动/易碎平台延后引入；平台序号独立于数组长度。
- 星海突击：4 阶段波次（巡逻/俯冲/弹幕/精英）+ 休整窗口；敌机与敌弹数量上限；撞机不再获得击杀分。
- 极速车道：改为一次操作移动一条车道；车道分隔线按真实边界绘制；生成时模拟未来 2.4 秒，保证当前/相邻车道始终有可躲避车道；移动端左右按钮面板。
- 层塔：前 3 层落点投影与“对齐/左右微调”提示；完美/普通/落空反馈文字；结束路径统一暂停并只结算一次；偏心倒塌系数修正为实际可触发。
- 黄金矿工：前 5 关独立 `levelSpec`（目标/时长/物品池/炸药/摆速）；前 2 关无炸药；生成后按本关目标价值保底；达标可提前进入下一关并结算剩余时间奖励，且使用本关增量目标防止连锁空兑现；关键数值增加 DOM 子 HUD。
- 数据与导航：修复 GitHub Pages `/studiokit/` 子路径下 shell 首页链接（`../../` → `../`）；shellbar 增加 safe-area；导入改为写失败回滚、runs 仅接受已注册游戏且限制 256KB；`localStorage` 满时导入不再谎报成功。
- 移动端：修复空 secondary 按钮可聚焦、2048 标题被按钮挤掉、黄金矿工为隐藏 cashout 预留空白；返回链接/主按钮 44px；320/390/430 视口标题、按钮与画布尺寸纳入自动断言。
- 俄罗斯方块：补充 7-bag 与 1 行消除计分测试；触屏五动作面板保持 44px 以上。
- 测试：`tools/arcade_smoke.mjs` 扩至 49 项，新增多指/取消/失焦、波次/撞机、雪铃重复计分、影跃可达域、赛车安全走廊、黄金矿工关卡可行性、7-bag/消行、320/390/430 视口、/studiokit/ 子路径、旧档迁移、配额失败回滚；全部通过。

## 0.3.0 — 2026-11-09

- 新增 6 款竖屏碎片时间游戏，全部由简到难、可暂停、局内进度自动保存：
  - 记忆翻牌（memory-flip）：5 关翻牌配对，牌数与预览时间逐关递增/缩短；
  - 2048 合成（merge-2048）：4×4 滑动合并，支持一步撤销与达成 2048 后继续；
  - 砖块计划（brick-breaker）：挡板反弹、砖块 HP、加宽/减速/加命道具、逐关加速；
  - 重力翻转（gravity-flip）：一键翻转重力、上下尖刺、星星与生命；
  - 贪吃蛇（snake-run）：方向键/滑动、加速、障碍、金果实与 3 生命；
  - 打地鼠（mole-whack）：45 秒限时、连击倍率、炸弹/金鼠、逐渐加快。
- 引擎升级：新增 `RunSave`（`studiokit:arcade:runs:v1`）、`createRunAutosave`、`createOverlayUi`、`bindPause`、`showResumePrompt`、`formatSavedAt`；每款游戏接入统一暂停按钮、自动暂停与「继续上次」提示。
- 中心页重做：搜索、类型筛选、只看玩过、五种排序、结果计数、继续上次区域、难度/时长徽章、单游戏清除同时清理局内进度；导出/导入备份包含局内进度。
- 修复与平衡：
  - 雪铃：首排固定一颗正对雪台中心的铃铛，确保起跳必中；后续每排从上一排可达位置生成，限制横向偏移，并修复高度分从起点计算；
  - 黄金矿工：钟摆起始速度降低，改为随关卡逐关加速；过关时重置钩爪状态；
  - 层塔：钟摆起始速度降低，改为随层数逐层加速；
  - 星海突击：新增散射 / 激光 / 追踪 / 速射四种弹种 Buff 掉落与 HUD 提示；
  - 影跃：高度分从起点计算，平台落点横向距离受控，保证可达；
  - 极速车道：修正车道虚线画在车道中心的问题（改为画在车道分隔线）；
  - 俄罗斯方块/极速车道/黄金矿工：补齐暂停按钮、局内进度保存/恢复。
  - 俄罗斯方块：新增移动端触屏按钮面板（左移 / 旋转 / 右移 / 软降 / 硬降，按住连续操作），解决触屏难以游玩的问题。
- 工具注册表状态由 `draft` 更新为 `available`，版本 0.3.0；`validate_site.py` 增加新游戏必备文件、引擎版本、局内存档 key 与 GAMES 数量校验。

## 0.2.0 — 2026-11-08

- 新增 3 款 GBA 风格经典复刻（均为自研实现与自绘图形，无版权资产）：
  - 俄罗斯方块（block-drop）：Bag-7 随机、简化 SRS 踢墙旋转、DAS 横移、软降/硬降、幽灵块、锁定延迟、消行动画与等级加速，支持触摸分区操作；
  - 极速车道（road-rush）：伪 3D 背后视角四车道避障竞速，透视车道滚动、速度渐增、生命与撞击减速、路边视差装饰；
  - 黄金矿工（gold-miner）：单摆钩爪、抓取判定、重量决定拉回速度、钻石/金块/石头/炸药、限时达标逐关递增目标。
- 游戏清单（engine.js `GAMES`）扩至 7 款；`validate_site.py` 必备文件同步覆盖新游戏页。

## 0.1.0 — 2026-11-08

- 街机厅工具首个版本：中心页（游戏卡片网格、最高分/游玩统计、进度导出/导入/清除）。
- 自研轻量运行时 `engine.js`：固定步长游戏循环、AABB/圆碰撞、单向平台、单摆积分、粒子系统、WebAudio 合成音效、进度存储（`studiokit:arcade:progress:v1`，Schema v1）。
- 首批 4 款竖屏游戏：
  - 星海突击（雷电式纵版弹幕射击，自动开火、四类敌机、难度递增）；
  - 影跃（忍者无尽上跳：普通/移动/易碎平台，触墙反弹）；
  - 层塔（钟摆叠箱：单摆释放、偏心力矩致塔倾斜倒塌、完美对齐连击）；
  - 雪铃（兔子跳铃铛：圆碰撞弹起、连击音阶与倍率）。
- 每个游戏独立单页（`games/*.html`），支持键盘与触摸、暂停/自动暂停、静音偏好、最高分本地记录。
