# Agent Operating Contract

本文件适用于所有自动化 Agent（Flash / Codex / 其他 Worker）。遇到冲突时，优先级为：Owner 当前明确指令 > 本文件 > 任务卡 > 其他文档。

## 1. 项目事实

- StudioKit 是静态多工具 Monorepo，不是单一 SPA。
- 每个工具独立放在 `apps/<tool-id>/`，默认入口为 `index.html`。
- 首页工具清单唯一来源为 `shared/tool-registry.json`。
- 共享运行时仅限 `shared/site.css` 与 `shared/site-shell.js`；不要引入大型框架。
- 当前 Badge Studio 版本为 2.2.1，配置 Schema 为 v3，基线见 `docs/BASELINE.md`。
- 0.22.0（本地开发版本，未发布）：完善职业独立发现、统一披露与世界通用工作界面——各职业保持平行、被动的发现方式，玩家可见内容由统一披露口径裁决；工作界面以通用文案呈现，与具体职业解耦，不暴露玩家已拥有的职业。版本链 0.22.0 / SW `studiokit-arcade-0.22.0-v1`；不新增 IndexedDB store / localStorage key / Schema，`contentVersion 0.18.0` / IDB v1 / 11 stores / 经典玩法数值零改动。设计 / 回滚 `apps/arcade/DESIGN-0.22.0.md`，状态以 `docs/arcade-life/INTEGRATION-0.22.0.md` 为准：GATE_PASSED / RELEASE_READY（本地发布准备，未发布；release 41/41，not full）；未获发布授权，未 push、未发布，不写 PUBLISHED。线上最近发布版本仍为 0.21.2（2026-11-26 已双端发布，见下条）。
- 0.21.2（2026-11-26 已双端发布，main `bc50e61`，Actions `45858201941` 全绿，双端 91/91 一致；分支 `fix/arcade-career-entry-0211`，SW `studiokit-arcade-0.21.2-v1`）：修复首页「旧港生涯 / 回折光港看看」改为首页直接打开告示板弹窗（按需加载 bridge，关闭恢复焦点与滚动）；钱包标题统一为「钱包与收据」；生涯遮罩高于独立窗口导航栏并锁定背景滚动；游戏页顶栏标题留白（320px 例外）。不改 localStorage key / IDB v1 / 11 stores / `contentVersion 0.18.0` / 玩法数值。设计 / 回滚 `apps/arcade/DESIGN-0.21.2.md`，验证口径 `docs/arcade-life/INTEGRATION-0.21.2.md`。发布前实测：冒烟 119/119、首航 404/404、PWA 18/18、紧凑触控 18/18、入口 71/71、委托 64/64；真机与 full 未验证。
- 0.21.1（2026-11-26 已双端发布，main `cbfeef6`，Actions `45840350943` 全绿，双端 90/90 一致；分支 `fix/arcade-career-entry-0211`，SW `studiokit-arcade-0.21.1-v1`）：修正 0.21.0「身份建立后也无内容入口」的过度实现——中心页仍无生涯视图 / 默认视图切换，身份建立前只有「继续上次」附近的被动来信小字；生涯身份一旦建立（已开生涯或已有章节）即常驻「旧港生涯」内容入口直达 `?careerPanel=town`（44px 热区），封存时隐藏内容入口与来信但保留「生涯设置（已封存）」，解冻恢复，完全重置后内容入口与设置入口一起消失。只改 `apps/arcade/index.html` / `arcade.css` 与对应断言，不改 localStorage key / IDB v1 / 11 stores / `contentVersion 0.18.0` / 玩法数值；版本链 0.21.1 / SW `studiokit-arcade-0.21.1-v1`，已双端发布。设计 / 回滚 `apps/arcade/DESIGN-0.21.1.md`，验证口径 `docs/arcade-life/INTEGRATION-0.21.1.md`。**实测** static 35/35、`career_passive_entry` 61/61、`arcade_smoke` 117/117（含四档窄屏、封存 / 解冻 / 重置）、mobile 318/318、PWA 18/18、archive lifecycle 60/60；独立复审 APPROVE。最终 release 41/41 `release passed (not full)`、96 全量 3792/3792、首航 404/404；full / 真机 / 真人 UNVERIFIED，Actions 与双端 90/90 校验已完成；full / 真机 / 真人 UNVERIFIED。
- 0.21.0（2026-11-26 已双端发布，main `28a0182`，Actions `45752833025` 全绿，双端 89/89 一致；分支 `feat/arcade-career-passive-021`，SW `studiokit-arcade-0.21.0-v1`）：Arcade 生涯被动化与归档——中心页彻底被动（经典目录无生涯视图、默认视图切换或常驻告示板 / 信箱 / 章节入口，只在「继续上次」附近保留低强调来信小字，页尾提供二级「生涯设置」）；故事与任务改为面向玩家的第二人称选择式叙事（选项对应真实动作，NPC 自述保留第一人称）；生涯设置提供封存 / 解冻（既有 `state` store 的 `career-archive` 行、事务内重读守卫、解冻推进代次）与**仅生涯数据**完全重置 `resetAllCareer()`（单事务清空 11 stores 玩家数据，保留最多 256 个不进备份的 `former-career:<id>` 退役标记与新一代次，阻断重置前旧标签回写；不触碰经典 progress/runs/playtime/scores/challenge/meta/prefs）。发现状态写入强制代次；退役上限内本轮身份始终保留。门禁分层 `static` / `release` / `full`（`release passed (not full)` 不等于 full，CI 新增 L0 static job）。经典 localStorage key、IDB v1 / 11 stores、`contentVersion 0.18.0`、玩法数值与挑战数据零变化。设计 / 回滚 `apps/arcade/DESIGN-0.21.0.md`，接口 ADR §22，集成记录 `docs/arcade-life/INTEGRATION-0.21.md`。**验证状态以集成记录为准**：static 35/35、archive 8/8、archive lifecycle 60/60、DB 38/38、backup 34/34、mobile 318/318、smoke 117/117、flow 339/339、PWA 18/18 已通过；96 全量串行最终 16/16 游戏、96/96 tiers、3792/3792 检查通过；最终 release profile 41/41 `release passed (not full)`（1801.411s）。full / 真机与真人仍 UNVERIFIED。
- 0.20.0（2026-11-26 已双端发布；开发分支 `feat/arcade-career-flow`）：Arcade 生涯首航 V2——错过的旧港来信可从首页找回并一次点击投递进港，告示板首屏只突出由 `campaign.recommend` / `story-evidence` / `route-planner` 按真实规则推导的当前推荐单（中间单标「路线进展」），收据给出工钱 / 剧情物件 / 世界反应三类回报与下一步，关标签后可显式继续未完成委托；C0–C5 以 `start / progress / complete` 节拍向后兼容扩展，ADR §21 冻结 `originLetter()` / `chapterZero` / `continuations()` 三个只读接口。生涯内容 `contentVersion` 仍 `0.18.0`，不改 IDB v1 / 11 stores / `rulesetVersion` / localStorage key / 玩法数值；版本链 0.20.0、SW 缓存 `studiokit-arcade-0.20.0-v1`（沿用 0.19 预载迁移）。设计/回滚 `apps/arcade/DESIGN-0.20.0.md`，集成 `docs/arcade-life/INTEGRATION-0.20.md`。单项门禁：零种子首航 339/339、campaign E2E 731/731、mobile 318/318、world 145/145、推荐 111/111、路线 94/94、db 38/38、backup 34/34、a11y 75/75、PWA 18/18、compact 18/18、smoke 117/117；逐项串行全绿但无一次聚合 `ALL GATES PASSED`。Owner 独立复审 APPROVE 后授权 `PUBLISH_TO_MAIN`；发布提交 `df91715`，Actions `45719028590` 四项成功，双端各 88/88 文件一致。真机 / 真人首航 UNVERIFIED。
- 0.24.0（本地发布准备，未发布）：世界主线替代路线的叙事合理化——C1–C5 的替代机制（世界通用工作 / 本职业委托 / 明码代办 / 免费租机 / 商店材料 / 证据组合）写成戏内成立的行动，只引用真实委托 / 代办 / 材料 / 证据，`requiresSpecificProfession` 恒 false，收据只在真实结算行存在时渲染；章节、路线与终局入口补充真实前置与完成解释。双方都已主动接受才产出可选职业交汇（16 条职业声明折叠 10 个事件，同一对只保留一个 owner、只写一次，`effects: []` / `grants` 全零，不改主线、不发奖励、未接受零透露）；经历页按真实人物 / 已接受职业筛选并可静态回读（17 条白名单，`storyEvents` 落盘仍只有 `at` / `source`，旧档只追加）。bridge 按需加载 `world-narrative.js` 与同名内容，缺失时保留 0.23 降级。不改 IDB v1 / 11 stores / `contentVersion 0.18.0` / `professionVersion 1` / 经典 localStorage key 与玩法数值。版本链 0.24.0 / SW `studiokit-arcade-0.24.0-v1`；设计 `apps/arcade/DESIGN-0.24.0.md`，契约 `docs/arcade-life/ADR-0.24-world.md`，验证 `docs/arcade-life/INTEGRATION-0.24.0.md`；状态：本地发布准备，未发布，门禁状态待 L3（lead），不写 PUBLISHED / ALL GATES PASSED。
- 0.23.0（本地发布准备，未发布）：折光港统一生涯界面——`.ac-career-ui` 局部命名空间的 12 个共享组件与精确 token、原型一致的内联港口 SVG、组件化的结算线索/字条/首次到港/后续邀请/回执/港口三分栏/工作/经历；16 个真实职业各一份短叙事 shard，消息只从已接受职业取 0 或 1 条。首次接受仍不接单，首到港用真实 `port` 投影给出第一份工作、消费后关页重开不重播，终局收据保留「读后日谈」。bridge 按需加载组件与叙事，缺失时保留 0.22 降级。不改 IDB v1 / `contentVersion 0.18.0` / 经典 localStorage key 与玩法数值。设计 `apps/arcade/DESIGN-0.23.0.md`，UI 契约 `docs/arcade-life/ADR-0.23-ui.md`，验证 `docs/arcade-life/INTEGRATION-0.23.0.md`；状态 GATE_PASSED / RELEASE_READY（本地发布准备，未发布）。
- 0.19.0（2026-11-25 已双端发布）：矮视口紧凑模式（≤620×700 收起站点壳条与说明行、弹层改为底部弹层、选关/机库面板铺满屏幕）、11 款实时游戏的拇指区暂停、恢复门、结算防误触，以及逐游戏单手手感（上滑影冲、半屏方向锁、挡板相对拖动、抬起确认等）。引擎新增 `bindPress` / `createSideLatch`，`createLoop` 支持 `resume({ gate: true })`。不改任何 localStorage key / Schema、玩法数值与关卡数据。设计与回滚 `apps/arcade/DESIGN-0.19.0.md`。升级时只继承旧缓存的预载清单并重新取当前版本游戏页，不复制旧页面字节。真机手感 UNVERIFIED；聚合门禁必须串行运行。
- 0.18.2（2026-11-25 已双端发布）修复 Cloudflare Pages 上预载后断网跨页失败。迁移 0.18.1 已缓存的游戏页面，SW 缓存键为 `studiokit-arcade-0.18.2-v1`。
- 0.18.1（2026-11-24 已双端发布）：首页续玩与排序记忆、游戏页返回、贪吃蛇及俄罗斯方块触控。已开启生涯后，首页可切换经典与生涯、设置默认视图，并可直达告示板、信箱与已解锁章节。经典是初始默认视图。**该首页生涯视图／默认视图切换自 0.21.0 起移除，改为被动发现与页尾二级生涯设置；0.21.1 仍未恢复视图切换，只补回身份建立后的常驻内容入口。**
- 0.18.0（2026-11-24 已双端发布）：星塔回响——C0–C5 六章、三条并列终局（武力/研究/救援）与后日常；首次生涯沿用线索与信箱入口。新增 `campaign-core/ending-reducer/ui/world-state` 与 campaign/chapter/ending/npc/side-stories 内容；终局复用 commission 生命周期但独立于 96 告示板，C5 唯一、幂等、失败可重试；职业 run 仍不写经典 5 键/旧机库/星币。修复 C0 信箱旗标与终局跨页事件缓冲（adopt/attach）、mustKnow/正文/NPC 渲染、C1 代办路线。接口见 ADR §20，设计与回滚 `apps/arcade/DESIGN-0.18.0.md`，集成 `docs/arcade-life/INTEGRATION-0.18.md`；证据仓库外。发布需 Owner 明确授权。
- 0.15.0（本地开发批次，已并入 0.18.0 基线；分支 `feat/arcade-life-015`）：16 款游戏在经典游玩中被动产出可关闭的微线索（`apps/arcade/career/`，`bridge → discovery → 独立 IndexedDB`），无显眼生涯入口、线索不产生货币/材料/生涯身份；新增独立 IDB `studiokit:arcade:career` v1（11 stores，claim 幂等、单事务、多标签安全），不写既有 localStorage 键；经典/挑战/禅/星海割草/旧机库零改动；接口冻结见 `docs/arcade-life/ADR-interfaces.md`，证据与原始侦察在仓库外。
- Arcade 历史版本 0.14.0（2026-11-22 双端发布，上一版 0.13.3 同日发布）：16 款竖屏小游戏（13 款带 78 关挑战模式 + 二十一点/五子棋/纸牌接龙三款平和棋牌）+ 俄罗斯方块禅模式 + 积分记录表 + 棋盘优先画布 + 极速车道转向灯换道/连超/加速带/维修箱；结算「再来一局」重新打开模式选择，贪吃蛇触屏为相对蛇头方向的左右双按钮；0.11.2 新增 PWA 更新检测（中心页「检查更新」+ SW 版本握手），0.11.3 移除 `viewport-fit=cover` + 半透明状态栏 meta；0.11.4 真机定位「被模糊」对象是中心页共享 shellbar（`StudioKit / 街机厅 Arcade / 源码 ↗`），修复为 standalone 下 shellbar `position: sticky; top: 0` 贴顶；0.11.5 本地修复移动端双击误触放大（17 页 viewport + dblclick 拦截）与五子棋全屏落子按钮文字重影及预览取消出口；0.12.0 全屏底部按钮抬升（`--ac-thumb-lift`）+ 层塔持久重心物理模型（偏置堆叠会塌）+ 层塔全览（按钮/快捷键 3）+ 工地集装箱皮肤与 4 种真实生效属性；0.12.1 修复层塔物理一致性与全览：站立塔不再整体旋转（所见即所判）、倾斜改为支撑面/重心可视化、经典模式吊臂小车跟随塔顶（挑战仍按关卡固定 pivotX）、完美吸附力矩改用吸附后偏移、全览真正 zoom-to-fit（几十层也一屏装下）、落点投影常显；0.12.2 给释放的集装箱补上真实水平速度（`L·cosθ·θ̇ × 0.45`，可见抛物线，落点预测同源）；0.12.3 去掉全览的缩放下限（200/1000 层也能一屏看全塔）；0.12.4 修复 LOD 误按层数触发导致近景集装箱退化成色块的回归（LOD 只看缩放 + 视口裁剪）；0.12.5 层塔难度两段式曲线（约 157 层封顶）+ 升速时振幅归一（层数越高越快、摆幅不再塌缩）；0.12.6 PWA 独立窗口也套用拇指抬升并收起重复 hint 行（底部按钮与全屏同高、画布 +34px）；0.12.7 层塔难度按人类计时能力重标定（封顶完美窗口 28→56.5ms、可落 178→335ms，挑战零改动）；0.13.0 星海突击「星域远征」加入机库永久改装与星币（星币 = `floor(score / 16)` + 整备「军费补给 +40」，只由游玩得分产生，无内购/签到/广告）、局内火力等级 1–5、能量与枯竭（基础 1.2/s、枯竭被动 2.2/s 回能到 25 解除）、临时编队、核弹级大杀器（核弹/轨道炮/时空锚）、6 星区主题轮转（带分数补偿）、CLEAR 三选一整备（卡池 8 种）与动画反馈；机库存于引擎新增的通用游戏数据 key `studiokit:arcade:meta:v1`（`A.GameMeta.get/set/clear`，路径 `games['star-raid'].hangar`，机库 `formula: 1` 锁公式版本；`bay` 满级 1、大杀器槽 2→3；初始生命 `3+hull`、上限 `5+hull`），备份字段为 `gameMeta`；Boss 血量改为 `480 + (level-1)×280` 再乘主题 `bossHp`；挑战 6 关数据与判定零改动；0.13.1 修复 Owner 真机反馈：大杀器并入主道具行（iPhone 非全屏 PWA 也可见）、核弹改为追踪弹命中后爆炸（无 Boss 飞向画面中央）、机动强化（engine id 不变）改为受击无敌 +0.12s/级与拾取吸附 +6%/级（触屏有效）、机库浏览不再计入有效游玩时长；其运行时 `apps/arcade/engine.js` 是工具内共享，不要提升为全站 shared；0.13.2 修复 PWA「检查更新」显示已安装版本的 bug：engine `checkForUpdate()` 改为读取线上 `sw.js` 的 VERSION 并与页面/SW 版本对比（旧实现返回页面自身 ARCADE_VERSION = 已安装版本）、`version` 返回线上最新版本、SW `activate` 改用旧缓存证据判断升级接管并真正广播 `arcade-sw-update-ready`（旧 `firstActivation` 标志恒为 false，广播从未发出）、中心页横幅与提示同时显示最新/当前版本、读不到线上版本时提示失败而不谎报「已是最新」；游玩时长在 iOS 主屏 PWA 永久停摆：`Playtime` 旧实现要求 window `focus`（iOS 主屏 PWA 可能整段生命周期只给 `blur`、回前台只给 `visibilitychange`），漏一次 `focus` 后这一页永久不计时，而积分记录 `scores:v1` 仍照常写入；现改为只认「页面可见 + 弹层关闭」并新增 `syncSegment()` 在可见性/`pageshow`/用户点按按键/15 秒 tick 上自愈、`recordRound()` 结算后续开时间片；复现与设计见 `apps/arcade/DESIGN-0.13.2.md`；0.13.3 修复 Cloudflare Pages 无后缀 URL 导致游戏识别失败、所有游戏计时为 0（CF Pages 把 /games/x.html 308 到 /games/x，`detectCurrentGame()` 精确比较 .html 文件名 → currentGame 恒 null → Playtime 不装载；现改为去 .html 后缀 + 小写化比较并兼容尾斜杠/URL 编码与 id 兜底），测试服务器新增无后缀回退、smoke 109/109，设计见 `apps/arcade/DESIGN-0.13.3.md`；0.14.0 星海突击：同种弹种再次拾取改为叠加有效时长（`BUFF_STACK_CAP = 180s`，不再重置）；新增引擎可选第 4 弹层按钮 + 「星海割草」无尽演武（`mode = 'mow'`）：四种弹种常驻、火力 MAX、大杀器 3 槽满载且无限次、脉冲/星盾/编队无限（均消耗能量）、同屏 32 敌 + 密集掉落、Boss 四套专属弹幕与光晕警戒环；受击只扣能量不掉命，能量是唯一瓶颈；`serialize()` 在割草返回 null，不记分/不给星币/不参与最高分与积分记录、不写局内档，挑战 6 关数据与判定零改动；设计与回滚见 `apps/arcade/DESIGN-0.14.0.md`；旧版设计与回滚见 `apps/arcade/DESIGN-0.13.1.md`（0.13.0 见 `DESIGN-0.13.0.md`；0.12.7 见 `DESIGN-0.12.7.md`；历史版本按 `DESIGN-0.4.0` … `DESIGN-0.12.x` 逐版保留）与 `apps/arcade/DESIGN-block-controls.md`。
- Arcade 的离线能力仅限同源缓存：`apps/arcade/sw.js` 作用域为 `apps/arcade/`，可缓存 `shared/site.css` 与 `shared/site-shell.js`；不得借此引入远程资源、分析或后端。
- Venue Compare（`restaurant-compare`）当前 0.2.0 / `available`：餐厅考察对比、地图标注与外部链接 / 备注（仅 http/https）；IndexedDB 命名空间为 `studiokit:restaurant-compare`，导出为自包含只读 HTML；2026-11-16 双端发布。
- Rounded Image 尚未实现，不得假设旧功能、控件或参数。

## 2. 不可破坏的约束

1. **先读再改：** 开始任务前阅读本文件、`TASKS.md`、相关 ADR 和目标工具 README。
2. **保护既有工具：** 未经任务明确授权，不重写 Badge Studio 绘制算法、配置 Schema、撤销/重做、导入导出或自动保存行为。
3. **保护用户数据：** 不随意修改 localStorage key、配置字段或 Schema。若必须修改，提供兼容迁移、回滚方案和测试。
4. **默认离线优先：** 不新增 CDN、远程字体、分析 SDK、埋点、后端请求、第三方 API 或远程图片依赖，除非 Owner 明确授权。
5. **路径兼容：** 必须同时兼容 GitHub Pages 项目站点子路径与 Cloudflare Pages 根路径，禁止 `/assets/...` 这类从域名根目录解析的绝对路径。
6. **工具隔离：** 不共享业务状态；localStorage key 必须带工具 ID 命名空间。既有工具的历史 key 为兼容性保留，不得擅自改名。
7. **无构建依赖：** 默认不引入 npm、打包器或运行时框架。确有必要时先提交 ADR 和成本说明。
8. **小步提交：** 使用 Conventional Commits；一个提交聚焦一个意图；不 squash/rebase/force-push 用户未授权的分支。
9. **不伪造结果：** 没有实际执行的测试不能声称通过；没有看到 GitHub Actions 成功和线上页面可访问，不能声称发布成功。
10. **不提交秘密：** 不把 Token、Cookie、个人配置、字体授权文件、私密图片或本地数据写入仓库。

## 3. 标准执行流程

1. `git status --short --branch`，确认工作树与分支；不覆盖未知改动。
2. 阅读 `TASKS.md`，用 `python tools/agentctl.py next` 获取任务。Windows 本机若 `python` 指向 2.x，统一改用 `py -3`。
3. 先复现，再修改；新增行为必须有可验证的验收条件。
4. 执行：
   - `python tools/validate_site.py`
   - `python tools/build_site.py`
   - `node --check shared/home.js`（若 Node 可用）
   - `node --check shared/site-shell.js`（若 Node 可用）
   - Arcade 改动：`node --check apps/arcade/engine.js` + `node --check apps/arcade/sw.js` + `node tools/arcade_smoke.mjs`（需要本机 Chrome）
5. 检查 `git diff --check`、`git diff --stat`、完整 diff。
6. 任务完成后更新 `tasks/queue.json` 与 `TASKS.md`，记录证据和未解决项。
7. 提交前确认没有 `dist/`、`.wrangler/`、缓存、私密数据或无关文件。

## 4. Git 与发布授权

- 默认在任务分支工作；不得擅自向 `main` 推送、合并、打 Tag 或发布 GitHub Release。
- Agent 可以创建本地分支、提交本地 commit；远程 push / PR 操作必须有可用认证和明确目标仓库。
- StudioKit 正式发布是双目标：GitHub Pages 项目站点 + Cloudflare Pages 项目 `studiokit`。一次 `PUBLISH_TO_MAIN` 授权覆盖两端，不允许只发一端后声称发布完成。
- 首次 Pages 发布需要 Owner 确认：GitHub 仓库 URL、仓库可见性、Pages 已选择 GitHub Actions，以及是否授权部署到 `main`。Cloudflare 侧需要项目已存在、Production branch 为 `main`，并已配置 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` Secrets 与 `CF_PAGES_URL` Variable。
- 只有当前任务明确包含 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN` 时，才可将通过验证的提交推送/合并到 `main` 并触发双端部署。
- Owner 的一般性目标描述不等于允许 Agent 创建公开仓库、改变仓库可见性、修改组织权限或使用未授权凭证。
- Cloudflare Token 只能存 GitHub Secrets；不得写入仓库、日志、截图或提交说明。发布后必须检查 Actions 的 `Validate and build`、`Deploy GitHub Pages`、`Deploy Cloudflare Pages`、`Verify both deployments` 均为成功，并用 `tools/verify_deploy.py` 对两个最终 URL 做逐文件校验；失败时报告失败，不得重复盲目推送。

## 5. 新工具接入

- 优先运行 `python tools/new_tool.py --id <slug> --name "..." --description "..."`（Windows 用 `py -3`）。
- ID 使用小写 kebab-case，创建后不得随意改名（会改变 URL）。
- 将工具完整 HTML 放入 `apps/<id>/index.html`；共享 shell 只负责返回门户，不侵入工具业务 UI。
- 首页注册表状态按 `draft` → `available` 变化；未验收工具不得标为 `available`。
- 每个工具有自己的 README、CHANGELOG、版本和必要的测试说明。
- 详细规范见 `docs/ADD-A-TOOL.md`。

## 6. 完成定义（DoD）

- 任务验收条件逐项通过。
- 静态校验与构建成功。
- 受影响工具在桌面与窄屏布局检查通过。
- Arcade 改动通过 `arcade_smoke.mjs`（或明确记录为何无法运行）与 320/375/390/430px 布局检查。
- 发布任务通过 `tools/verify_deploy.py` 校验 GitHub Pages 与 Cloudflare Pages 内容和版本一致。
- 导入/导出、自动保存和配置兼容性无回归（适用时）。
- 文档、注册表、版本和任务状态同步。
- Diff 干净；提交信息清晰；没有未经授权的发布动作。
