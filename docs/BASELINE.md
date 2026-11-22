# Baseline

## Badge Studio

Current Badge Studio baseline facts:

- App version: `2.2.1`
- Config schema: `v3`
- Autosave key: `concentric_badge_editor_autosave_v2`
- Default scheme content is project-neutral (`STUDIOKIT` / `BADGE STUDIO` / `◎`); personal default samples must not appear in the repository or its history.
- The editor's drawing, configuration, autosave and export logic is intended to remain unchanged. Any future version upgrade must update this record and the app changelog deliberately.

## Venue Compare

Current Venue Compare baseline facts:

- App version: `0.2.0`（`apps/restaurant-compare/index.html` 的 `APP_VERSION` 与注册表一致）
- Registry entry: `shared/tool-registry.json` → `id: "restaurant-compare"`，`href: "./apps/restaurant-compare/"`，`status: "available"`
- Storage: IndexedDB `studiokit:restaurant-compare`（version 1，store `projects`，记录 key `current`）；项目 Schema `v3`；旧库 `restaurant-compare-editor` 只读兼容
- Links: 每餐厅最多 12 个 http/https 链接，`{ label, url, note? }`；label ≤ 30、url ≤ 1000、note ≤ 300 字符
- Export: 展示 HTML 自包含，不依赖 `shared/`；查看端只读，外部链接仅点击时联网
- Automated coverage: `node tools/restaurant_compare_smoke.mjs` 19/19（需要本机 Chrome）；`validate_site.py` / `build_site.py` / `node --check` 通过
- 0.2.0 已双端发布（2026-11-16）：提交 `2276194`（含 `81684b9` / `f7146f8` / `ec0359d`）；Actions `43809215680` 四个 job 全成功；`verify_deploy.py` **38/38** 双端一致；双端线上无头 Chrome 2/2；注册表状态 `available`

## Arcade

Current Arcade baseline facts:

- App version: `0.15.0`（本地分支 `feat/arcade-life-015`，未发布；基于 0.14.0。`apps/arcade/engine.js` 的 `ARCADE_VERSION` 与注册表保持一致。0.15 新增可关闭的被动线索与独立生涯数据层，经典/挑战/禅/星海割草/旧机库零改动，设计见 `apps/arcade/DESIGN-0.15.0.md`；0.14.0 已于 2026-11-22 双端发布，0.14.0 在星海突击加入同种弹种叠加时长与无积分/无星币的「星海割草」无尽演武，设计与回滚见 `apps/arcade/DESIGN-0.14.0.md`；0.13.3 已于 2026-11-22 双端发布（提交 `b3a8c7e`，Actions run `45007754972` 四 job 全绿，`tools/verify_deploy.py` 41/41 双端一致），修复 Cloudflare Pages 无后缀 URL（`/games/x.html` 308 → `/games/x`）导致 `detectCurrentGame()` 失败、所有游戏计时为 0 的问题，设计与证据见 `apps/arcade/DESIGN-0.13.3.md`；0.13.2 已于同日双端发布（PWA 更新检测版本来源 + iOS 游玩时长自愈），见 `apps/arcade/DESIGN-0.13.2.md`；0.13.1 / 0.13.0 同已双端发布）
- Registry entry: `shared/tool-registry.json` → `id: "arcade"`，`href: "./apps/arcade/"`
- Games: 16（13 款带 6 关挑战 + 3 款平和棋牌：二十一点、五子棋、纸牌接龙；清单唯一来源是 `engine.js` 顶部的 `GAMES` 数组）
- Run state schema: `v1`（`studiokit:arcade:runs:v1`）
- Progress schema: `v1`（`studiokit:arcade:progress:v1`）
- Playtime schema: `v1`（`studiokit:arcade:playtime:v1`；0.5.0 新增，独立 key）
- Preferences key: `studiokit:arcade:prefs:v1`；字段 `muted`、`immersive`
- 0.13.0 新增 key：`studiokit:arcade:meta:v1`（引擎通用游戏数据，Schema `v1`，`{ schemaVersion: 1, games: { <gameId>: {...} } }`；只存普通 JSON、单游戏 ≤32KB、损坏 fail closed，API `A.GameMeta.get/set/clear/clearAll/exportData/importData`）。目前仅星海突击使用：`games['star-raid'].hangar = { v: 1, formula: 1, credits, upgrades{hull,power,engine,energy,bay,wing}, runs, best }`，`formula: 1` 锁定星币公式版本；星币 = `floor(score / 16)` + 整备「军费补给 +40」，只由游玩得分产生，无内购/签到/广告。原有 `progress:v1` / `runs:v1` / `prefs:v1` / `playtime:v1` / `scores:v1` / `challenge:v1` 的 key 与 Schema 版本不变
- 0.13.0 备份与重置：备份 JSON 新增可选 `gameMeta`（`A.GameMeta.exportData()` 快照）；旧备份无 `gameMeta` 时保留当前机库，导入失败整体回滚（含 meta key）；中心页「清除记录」与 `Progress.resetGame/resetAll` 调用 `A.GameMeta.clear(gameId)` 同步清理；既有备份字段含义不变
- 0.13.0 星海突击经典模式：机库六项改装（装甲强化 `hull` 0–3、火力校准 `power` 0–5、引擎调校 `engine` 0–5、反应堆 `energy` 0–5、弹仓扩容 `bay` 0–1、僚机中队 `wing` 0–3；初始生命 `3+hull`、上限生命 `5+hull`）、局内火力等级 1–5、能量与枯竭（基础 1.2/s、枯竭被动 2.2/s 回能到 25 解除、掉命能量保底 40%）、临时编队、大杀器（反物质核弹 / 轨道炮 / 时空锚）、6 星区主题轮转（`themeIndex = (level - 1) % 6`，各带分数补偿）、Boss 血量 `480 + (level-1) × 280` × 主题 `bossHp`、CLEAR 三选一整备（卡池 8 种）；**挑战 6 关数据与判定零改动**，挑战分支不读机库、不写星币
- 0.4.0 的黄金矿工道具状态是局内档 `data` 的追加字段（`tools` / `winchArmed`），不新增 localStorage key，不改变 Schema 版本
- 0.5.0 的游玩统计按游戏保存总时长、完成轮次、最近 30 轮与最近 120 天日汇总；备份新增可选 `playtime` 字段，旧备份兼容
- 0.5.1 修复连续游玩超过 15 秒后计时停止：每次定时落盘后重新开启时间片；Service Worker 缓存版本同步升至 0.5.1
- 0.6.0 已发布：星海突击每 30 秒关卡后 Boss 战、弹种可叠加、玩家全屏纵向移动；黄金矿工摆角/钩爪朝向分离（瞄准不损耗摆动能量）与按秒 $2 瞄准线；移除点开始/继续自动全屏。局内档仍为 `runs:v1` Schema v1，新增字段只写在 `data` 内
- 0.6.1 已发布：Boss 入场穿过顶部时关闭机体碰撞与弹幕，避免贴顶玩家被撞；SW 缓存版本升至 0.6.1；提交 1c9501e，Actions 43060497094
- 0.6.2 已发布：黄金矿工目标金额统一取整（含旧小数档恢复），HUD 顶部深色渐隐与金色目标胶囊；俄罗斯方块触屏按钮改为左右手分区，`加速`按住逐格下落、`落底`点按立即锁定，画布不再劫持触摸；SW 缓存升至 0.6.2；提交 0159437，Actions 43155182519 双端发布
- 0.8.0 已发布：影跃新增影冲与影之试炼；导入 0.9 关卡设计包为 13 款游戏各增 6 关（共 78 关）挑战模式，新增 `studiokit:arcade:challenge:v1` 独立记录 key（不写经典最高分/Playtime 轮次），经典/无尽与旧档保持兼容；`arcade_smoke` 85/85、挑战全量 208/208
- 0.7.0 已发布：13 款游戏各增加 2 个主动可选道具（黄金矿工保留 4 个并重平衡），共享 `A.createToolbelt` 统一道具栏；新增自然收尾（2048/砖块 3 关/重力 3000m/贪吃蛇 20 果实/方块 40 行/星海 CLEAR/赛车 5000m）；新增每页面一次 20 分钟有效游玩提醒；中心页加 🎲 随机入口。没有签到、每日奖励、商店或付费抽奖。`runs:v1` 等 key 与 Schema 不变，新字段只写在各游戏 `data` 内
- 0.8.1 已发布：俄罗斯方块新增禅模式（无限游玩、速度随等级提升且可按 `Z`/触屏按钮冻结/恢复提速、不写经典最高分、局内状态写入既有 `runs:v1` data）；新增 `A.Scores` 与独立积分记录 key `studiokit:arcade:scores:v1`（Schema v1，最新在前、最多 300 条，13 款游戏统一结算点自动收集，中心页「积分记录」表展示/筛选/清除/导出导入）。既有 5 个 key 与 Schema 不变；`arcade_smoke` 85/85、新增 `arcade_zen_scores_test.mjs` 14 场景、gameplay base 22/22；提交 `575a766` + `41fa79e`，Actions `43423208129` 双端发布成功
- 0.8.2 已发布：俄罗斯方块控制区压缩（Owner 试玩反馈）：删除禅模式独立按钮行，冻结/恢复按钮并入道具行（同一行 3 按钮、经典仍 2 按钮）；禅模式隐藏重复 hint；道具行 44px、页面间距压缩；画布高度规则回收空间后禅模式画布面积 +18%～+47%、高度比经典多 56–60px。localStorage key/Schema、玩法与存档全部不变；`arcade_smoke` 85/85、`arcade_zen_scores_test.mjs` 14 场景（含控件压缩/画布增量断言）、gameplay base 22/22
- 0.8.3 已发布：修复 Android 普通浏览器顶部导航条空白（Owner 实机反馈）：共享 shellbar 只在 standalone/独立窗口应用顶部 `safe-area-inset-top` 并计入 38px 导航行之外，普通标签页保持 38px、文字居中；Badge Studio 共用同一 shell 一并修复。localStorage key/Schema、玩法与存档不变；`arcade_smoke` 86/86、`arcade_zen_scores_test.mjs` 14/14、gameplay base 22/22
- 0.8.4 已发布（2026-11-18）：俄罗斯方块画布改为棋盘优先 340×610（井口 240×480 占画布 79% 高/71% 宽），画布外道具行与触屏 hint 移除；经典棋盘占屏 320 13.3%→25.2%、375 15.9%→28.3%、390 23.9%→40.0%、430 25.7%→40.7%，棋盘面积 +58%～+89%；道具坞 3/4 格（含暂停）≥44×44，拇指区暂停键 + 触屏双击画面暂停；≤560px 高视口回退画布外。另修 `shared/site.css` 门户 `.tool-icon` 同名 class 冲突（改 `.tool-glyph`）。localStorage key/Schema、玩法、存档、积分与挑战不变；`arcade_smoke` 87/87、`arcade_zen_scores_test.mjs` 14/14、gameplay base 22/22；双端发布提交 `77cb02a..ecfdda4`、Actions `44122372096` 四 job 成功、`verify_deploy.py` 38/38 双端一致、线上无头 Chrome 18/18，SW 缓存键 `studiokit-arcade-0.8.4-v1`
- 0.8.5 已发布（2026-11-19）：极速车道修复卡车在地平线缩放下 `roundRect` 负圆角导致的 `RangeError` → rAF 断链卡死/车辆全消失（引擎 `roundRect` 夹取 + `createLoop` 逐帧兜底）；`scaleAt` 与路面同一透视、地平线保留 16.1% 车身，车辆在 `z=1.02~1.52` 预生成；新增转向灯换道（signal 0.55s → moving 0.5s、车灯/箭头/虚线导引、公平性 `futureSafe` 检查）、连超尾流、加速带、维修箱、每 1000m 车流加密与 S+/S/A/B/C 评价；贪吃蛇逻辑画布 420×740→360×430（375×667 棋盘 180→273px）、新增四向 58px 按钮、提速 11.8→7.7 格/秒；方块经典积分记录写入 `lines/level/detail`。localStorage key/Schema、挑战数据与其余 10 款游戏不变；`arcade_smoke` **89/89**、`arcade_zen_scores_test.mjs` 14/14、gameplay base 22/22；双端发布 提交 `bdb1176..ee9b45b`（5 个提交：`cf8979e` 极速车道 / `211d8ca` 贪吃蛇 / `16a2a8b` 方块积分 / `35394a2` 测试 / `ee9b45b` 文档）推送 `main`；Actions `44472286080` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **38/38** 文件 SHA-256 双端一致（Arcade `0.8.5` / Badge `2.2.1` / Venue `0.2.0`，manifest `application/manifest+json`）；双端线上无头 Chrome **20/20**（中心页 0.8.5 + 13 卡、SW `VERSION 0.8.5`、极速车道地平线车身 6.43×9.96px + 打灯车 0→1 完成、贪吃蛇棋盘 309px + 4×58px 按钮 + 向下转向、方块运行时 0.8.5、0 console error）；SW 缓存键 `studiokit-arcade-0.8.5-v1`。
- 0.8.6 已双端发布（2026-11-19）：13 款游戏经典局与俄罗斯方块禅模式的「再来一局」回到开始弹层重新选模式；俄罗斯方块完整复位 `mode='classic'` / `state='ready'`，2048 继续挑战与挑战关重试/选关不变。贪吃蛇触屏改为左右相对转向双按钮（64px 高、左右等宽分区），经典两级缓冲与挑战方向队列按格消费连点，键盘/WASD/滑动保持绝对方向。localStorage key/Schema、挑战数据、玩法数值与积分规则不变；`arcade_smoke` **91/91**、zen **14/14**、gameplay base **22/22**，validate/build/node 全过；真机手感 UNVERIFIED。发布提交 `14a9160`，Actions `44553437432` 四 job 全成功；CI 与本地 `verify_deploy.py` 均 **38/38** 文件一致；双端线上无头 Chrome **20/20**；SW 缓存键 `studiokit-arcade-0.8.6-v1`。
- 0.9.0 发布批次（2026-11-20）：新增二十一点、五子棋、纸牌接龙三款无倒计时单机棋牌（复用 `progress:v1` / `runs:v1`，不新增 key）；修复 10 款既有游戏的挑战公平性与续档/计分问题（记忆翻牌 peek 锁死与续档丢道具、2048 继续挑战丢最终分、砖块拖动误发球、层塔续档重开一箱、矿工最后一钩不结算、极速车道近距奖励算反、影跃重试刷最佳时间、星海刷新重置 Boss 计时、俄罗斯方块挑战换块不同步队列、雪铃铃铛类型不可辨）。挑战关卡数据、参考解与既有 Schema 不变；新增 `tools/arcade_calm_games_test.mjs`、`tools/arcade_calm_probe.mjs`、`tools/check_inline_scripts.mjs`。发布：提交 `eb5e641`，Actions `44582961215` 四 job 成功，`verify_deploy.py` **41/41** 双端一致，双端线上无头 Chrome 各 20/20，SW 缓存键 `studiokit-arcade-0.9.0-v1`。
- 全屏/沉浸模式：原生 Fullscreen API 优先，不支持时使用 CSS 沉浸；iPhone Safari 不支持网页元素全屏，**真机与原生全屏仍未验证**
- PWA/离线：manifest + `apps/arcade/sw.js`，作用域 `apps/arcade/`；显式预载 27 项（11 外壳 + 16 游戏），断网回归已自动化；**iOS/Android 真机安装与系统分享面板仍未验证**
- Automated coverage: `node tools/arcade_smoke.mjs` **94/94**（需要本机 Chrome）；`node tools/arcade_zen_scores_test.mjs` **14/14**；`node tools/arcade_gameplay_test.mjs --suite=all --repeat=1` **104/104** 与 `--suite=base --repeat=2` **22/22**；`node tools/arcade_calm_games_test.mjs` **6 场景**（三款棋牌规则自检/结算/四档布局 + 10 款修复 regression）；`check_inline_scripts.mjs` 覆盖 19 个 HTML 的 20 段内联脚本
- 0.13.0 已在 `arcade_smoke.mjs` 落地的回归（主题轮转与陨石、火力 1/3/5 弹道、能量消耗/枯竭/核心恢复、编队充能与能量归零返航、核弹清弹/重创 Boss/反馈、CLEAR 整备三选一、机库购买/刷新持久化/备份/清除记录；smoke 103/103），并已复跑挑战 6 关 7/7与挑战 6 关 `arcade_challenge_test.mjs` **尚未执行**；本文件不记录未发生的门禁结论，数字以实际执行输出为准
- Design/rollback reference: `apps/arcade/DESIGN-0.4.0.md` … `DESIGN-0.9.0.md`（逐版一份）、`DESIGN-0.10.0.md` 之后的逐版设计文件（0.11.x / 0.12.x 全量保留）、最新 `DESIGN-0.13.0.md`
- Arcade README/CHANGELOG: `apps/arcade/README.md`、`apps/arcade/CHANGELOG.md`

变更 Arcade 版本、GAMES 数量、存储 key、Schema 或玩法基线时，必须同步更新本文件、注册表、Arcade README/CHANGELOG 与相关测试。变更 Venue Compare 版本、存储 Schema 或链接限制时，必须同步更新本文件、注册表、README/CHANGELOG 与 `restaurant_compare_smoke.mjs`。
