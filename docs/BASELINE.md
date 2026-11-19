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

- App version: `0.8.5`（`apps/arcade/engine.js` 的 `ARCADE_VERSION` 与注册表保持一致；2026-11-19 已双端发布，发布证据见下方 0.8.5 条目）
- Registry entry: `shared/tool-registry.json` → `id: "arcade"`，`href: "./apps/arcade/"`
- Games: 13（清单唯一来源是 `engine.js` 顶部的 `GAMES` 数组）
- Run state schema: `v1`（`studiokit:arcade:runs:v1`）
- Progress schema: `v1`（`studiokit:arcade:progress:v1`）
- Playtime schema: `v1`（`studiokit:arcade:playtime:v1`；0.5.0 新增，独立 key）
- Preferences key: `studiokit:arcade:prefs:v1`；字段 `muted`、`immersive`
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
- 0.8.5 已发布（2026-11-19）：极速车道修复卡车在地平线缩放下 `roundRect` 负圆角导致的 `RangeError` → rAF 断链卡死/车辆全消失（引擎 `roundRect` 夹取 + `createLoop` 逐帧兜底）；`scaleAt` 与路面同一透视、地平线保留 16.1% 车身，车辆在 `z=1.02~1.52` 预生成；新增转向灯换道（signal 0.55s → moving 0.5s、车灯/箭头/虚线导引、公平性 `futureSafe` 检查）、连超尾流、加速带、维修箱、每 1000m 车流加密与 S+/S/A/B/C 评价；贪吃蛇逻辑画布 420×740→360×430（375×667 棋盘 180→273px）、新增四向 58px 按钮、提速 11.8→7.7 格/秒；方块经典积分记录写入 `lines/level/detail`。localStorage key/Schema、挑战数据与其余 10 款游戏不变；`arcade_smoke` **89/89**、`arcade_zen_scores_test.mjs` 14/14、gameplay base 22/22；发布证据见 `apps/arcade/CHANGELOG.md`
- 全屏/沉浸模式：原生 Fullscreen API 优先，不支持时使用 CSS 沉浸；iPhone Safari 不支持网页元素全屏，**真机与原生全屏仍未验证**
- PWA/离线：manifest + `apps/arcade/sw.js`，作用域 `apps/arcade/`；显式预载 24 项（11 外壳 + 13 游戏），断网回归已自动化；**iOS/Android 真机安装与系统分享面板仍未验证**
- Automated coverage: `node tools/arcade_smoke.mjs` 89/89（需要本机 Chrome）；`node tools/arcade_zen_scores_test.mjs` 14/14（0.8.1）；`node tools/arcade_gameplay_test.mjs --suite=all --repeat=2` 208/208；0.8.1 发布时 `verify_deploy.py` 覆盖关键文件并双端逐文件校验
- Design/rollback reference: `apps/arcade/DESIGN-0.4.0.md`、`apps/arcade/DESIGN-0.5.0.md`、`apps/arcade/DESIGN-0.6.0.md`、`apps/arcade/DESIGN-0.7.0.md`、`apps/arcade/DESIGN-0.8.0.md`、`apps/arcade/DESIGN-0.8.1.md`、`apps/arcade/DESIGN-0.8.2.md`、`apps/arcade/DESIGN-0.8.4.md`、`apps/arcade/DESIGN-0.8.5.md`
- Arcade README/CHANGELOG: `apps/arcade/README.md`、`apps/arcade/CHANGELOG.md`

变更 Arcade 版本、GAMES 数量、存储 key、Schema 或玩法基线时，必须同步更新本文件、注册表、Arcade README/CHANGELOG 与相关测试。变更 Venue Compare 版本、存储 Schema 或链接限制时，必须同步更新本文件、注册表、README/CHANGELOG 与 `restaurant_compare_smoke.mjs`。
