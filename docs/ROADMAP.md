# Roadmap

## Shipped

### v0.1.0 — Foundation（2026-10-31）

- [x] 单仓库多工具目录结构。
- [x] StudioKit 门户和工具注册表。
- [x] Badge Studio v2.2.0 接入，发布前升到 2.2.1。
- [x] 共享返回导航与新工具模板。
- [x] 静态校验、构建和 Pages Actions。
- [x] Flash Agent 运行约定和任务队列。

### Arcade 0.2.0–0.4.0（2026-11-08 → 2026-11-10）

- [x] 街机厅中心页、游戏清单和统一共享外壳。
- [x] 13 款竖屏小游戏，由简到难，支持键盘与触屏。
- [x] 局内进度自动保存、「继续上次」、搜索/筛选/排序和 JSON 导出/导入。
- [x] 移动端输入、safe-area、44px 触控目标和 320–430px 布局加固。
- [x] 全屏/沉浸模式：原生 Fullscreen API 优先，CSS 降级，偏好记忆。
- [x] 黄金矿工摆速下调与限量道具（指哪打哪 / 加时 / 强力绞盘）。
- [x] `tools/arcade_smoke.mjs` 57 项无头浏览器检查；线上 0.4.0 已发布并验证。

### Arcade 0.5.0（2026-11-11，已发布）

- [x] 游玩时长与轮次统计：累计/今日/近 7 天、分游戏、最近 30 轮；暂停与后台不计时。
- [x] 分享合集与单游戏深链：系统分享优先，剪贴板兜底，不附带成绩。
- [x] PWA manifest / 图标 / Service Worker：可安装到桌面，显式预载 13 款游戏后断网可玩。
- [x] 修复黄金矿工连续使用「指哪打哪」后停在垂直位置不再摆动。
- [x] `tools/arcade_smoke.mjs` 63 项无头浏览器检查（含断网回归与矿工连续瞄准）。
- [x] 发布 `b8abe41` + `c8c049d`，Actions `42974993445` 成功；线上 0.5.0 运行时验证通过。

### Arcade 0.5.1（2026-11-11，已发布）

- [x] 修复连续游玩超过 15 秒后游玩统计停止累计：定时落盘后重新开启时间片。
- [x] 新增连续 17 秒游玩回归检查，`arcade_smoke.mjs` 保持 63/63。
- [x] Service Worker 缓存版本升至 0.5.1，已安装 PWA 自动获取新引擎。
- [x] 发布 `6739521`，Actions `43008560646` 成功；线上连续游玩 17 秒实测 17012ms。

### Arcade 0.6.2（2026-11-12，已发布）

- [x] 黄金矿工目标金额统一取整，旧小数目标恢复时取整；画布顶部 HUD 深色渐隐，DOM 目标改为金色胶囊。
- [x] 俄罗斯方块触屏按钮改为左右手分区：左手横移、右手旋转/加速/落底；`加速` 按住逐格下落，`落底` 点按立即锁定；画布不再劫持触摸。
- [x] `arcade_smoke.mjs` 66/66；`validate_site.py` / `build_site.py` / `node --check` 通过；320/375/390/430 无横向溢出。
- [x] 版本与 SW 缓存升至 0.6.2。
- [x] 提交 `0159437`；Actions `43155182519` 双端发布，`verify_deploy.py` 11/11 文件一致。

### Arcade 0.6.1（2026-11-12，已发布）

- [x] 修复星海 Boss 入场阶段穿过贴顶玩家造成碰撞；入场完成前不出弹。
- [x] Boss 清关断言增加生命 +1；66/66 通过；SW 缓存升至 0.6.1。
- [x] 发布 `1c9501e`，Actions `43060497094` 成功；线上 0.6.1。

### Arcade 0.6.0（2026-11-12，已发布）

- [x] 黄金矿工：摆角与钩爪朝向分离，连续瞄准后摆幅/能量不衰减；新增按秒 $2 的瞄准线。
- [x] 星海突击：每 30 秒关卡后 Boss 战、Boss 血条/三档火力、击破进关；弹种可叠加；全屏纵向移动。
- [x] 移除“点开始/继续自动全屏”，只有显式全屏入口生效。
- [x] 修复长摘要撑宽 320px 中心页续玩卡片。
- [x] `arcade_smoke.mjs` 66/66；版本与 SW 缓存升至 0.6.0；提交 `6debd77` 发布，Actions `43057971576` 成功。

### Arcade 0.7.0（2026-11-13，已发布）

- [x] 13 款游戏各增加 2 个主动可选道具（黄金矿工保留 4 个并重平衡），共享 `A.createToolbelt` 统一道具栏与快捷键。
- [x] 7 类自然收尾：2048 达成、砖块第 3 关、重力 3000m、贪吃蛇 20 果实、方块 40 行、星海 Boss CLEAR、赛车 5000m；旧无尽档按标志保持原玩法。
- [x] 中心页「惊喜一下」随机入口（返回后不立刻重复，不写存储）与页脚「快乐约定」；无签到、每日奖励、商店或付费抽奖。
- [x] 每页面一次 20 分钟有效游玩温柔提醒：不自动暂停、不反复催促、不新增存储 key。
- [x] `arcade_smoke.mjs` 扩至 85 项：共享道具栏异常/快捷键、一次性提醒真实计时路径、13 款旧档补给、道具真实效果、320/375/390/430 + 横屏 + 安全区、PWA/断网。
- [x] 提交 `34f03df` 推送 `main`；Actions `43274342320` 四 job 成功；`verify_deploy.py` 双端 24/24 文件一致，线上 0.7.0；iOS/Android 真机与原生全屏仍 UNVERIFIED。

## 0.8.0 发布批次（2026-11-13 已双端发布）

### Arcade 0.8.0 — 影跃影冲 / 影之试炼（已发布）

按外部游戏性重构任务包先做**一款游戏的竖切片**，验证“明确目标/决策/可练习技巧/探索/即时反馈”后再推广；影冲/影之试炼随后与 0.9 设计包的 78 关挑战一起以 `0.8.0` 发布。

- [x] GP001/GP002：事实冻结（13 款现状逐条核实、3 处文档漂移记录）与六维游戏性量表/单关规格模板（`docs/arcade/`）。
- [x] GP003：抽出零依赖 CDP 测试库 `tools/lib/arcade_cdp.mjs`（`arcade_smoke.mjs` 85 项行为不变），新增 `tools/arcade_gameplay_test.mjs` 确定性场景与 `tools/arcade_stage_solver.mjs` 关卡可达性求解器。
- [x] GP004：影跃影冲（每跳一次、落地补充、Shift/J + 独立触屏按钮、旧档兼容、seed 化测试钩子）。
- [x] GP005：影之试炼 S1–S3 手工关卡、影门出口、失足 1 次点击重试、暂停退出、试炼状态写入既有 `runs:v1` data；求解器 3/3 PASS。
- [x] GP006：S2 双路线判定与结算路线标签、可选卷轴探索、失败复盘提示；不写经典最高分/Playtime 轮次。
- [x] 集成验证：`arcade_smoke.mjs` 85/85、`arcade_gameplay_test.mjs` 11 场景、求解器双路径 3/3、`validate_site.py` / `build_site.py` / `node --check` 全过；未执行 `verify_deploy.py`（未发布）。
- [ ] GP007：Owner 两轮试玩（第一轮理解影冲/目标，第二轮主动找路线/卷轴）与独立 Reviewer 结论；**Owner 未反馈前不推进其余 12 款、不发布**。真机触控/手感/低端机帧率仍 UNVERIFIED。

### Arcade 0.8.0 挑战模式 — 13 游戏 × 6 关（基于 0.9 设计包；已发布）

导入 Owner 提供的 0.9 关卡设计包（13 游戏 × 6 关 = 78 关），为每款游戏实现独立**挑战模式**；经典/无尽保持一级入口。0.9 是设计包版本，应用以 `0.8.0` 发布。

- [x] 设计包原样导入 `docs/arcade/0.9/`（78 关设计源、13 份蓝图、独立校验脚本、离线图谱、建议队列不导入）；差异报告、集成契约、实施计划落盘。
- [x] 平台：`A.Challenge` 共享 API、`studiokit:arcade:challenge:v1` 独立记录（导出/导入/清除加法兼容）、13 个运行时数据生成器（校验 1088 设计断言 + 2128 自检、幂等）、挑战 UI 共享样式、SW 预缓存、validate 断言。
- [x] 13 游戏挑战模式 C01–C06：固定盘面/地图/时间轴/车流/障碍/砖阵/铃序/委托/波次/矿图，选关解锁、记录/最佳/assisted/收集、暂停退出、1 次点击重试、`runs:v1` 挑战局存档；影跃 0.8 试炼迁移到 0.9 数据且旧档安全降级。
- [x] 测试：`arcade_gameplay_test.mjs` 支持 base/challenge/all 套件与模块自动发现；全量 104 场景 ×2 = **208/208 PASS**（798s）、`arcade_smoke` **85/85**、78 关数据门禁与 13 游戏经典入口门禁 PASS、数据生成幂等。
- [ ] **Owner 两轮试玩与设计差异裁决（发布后继续收集）**：影跃捷径/实测时长偏短、砖块 K 钥匙可达性最小修正、星海 Boss 弱点时间窗、重力翻转推荐窗口晚半段、挑战模式禁用道具等需 Owner/Reviewer 决定；真机 iOS/Android 触控与手感仍 UNVERIFIED。Owner 未反馈前不升版本、不发布。
- [x] 0.8.0 已发布：`ARCADE_VERSION`/注册表/SW 缓存升至 `0.8.0`；提交 `95a063f` 推送 `main`，Actions `43369758813` 四 job 成功，`verify_deploy.py` 37/37 双端一致，线上 Arcade `0.8.0` / Badge `2.2.1`；双端无头 Chrome 12/12。后续 0.9 设计包剩余关卡仍需 Owner 授权。

## 0.8.1 发布批次（2026-11-13 已双端发布）

### Arcade 0.8.1 — 俄罗斯方块禅模式 + 积分记录表（已发布）

- [x] 俄罗斯方块禅模式：开始弹层第三入口；无限游玩（无 40 行收局）；速度随等级提升，`Z` / 触屏「❄ 冻结提速 / ▶ 恢复提速」停止或恢复速率增加；禅模式 HUD（顶栏 + 画布）、暂停「结束本局并记录」与井口结算；`runs:v1` 局内恢复；不写经典最高分。
- [x] 积分记录平台：`A.Scores` + `studiokit:arcade:scores:v1`（Schema v1，最新在前、300 条上限）；13 款游戏统一结算点自动收集经典积分，禅模式追加 `mode:'zen'`；`Progress.recordPlay` 模式感知、导出/导入/清除/单游戏清除接入；共享弹层可选第三按钮。
- [x] 中心页「积分记录」表：时间/游戏/模式/得分/详情，游戏与模式筛选，最新在前、最多 50 条，空状态与单独清除；四档视口无横向溢出，表格容器内部滚动。
- [x] 测试与验证：新增 `tools/arcade_zen_scores_test.mjs` 14 场景；`arcade_smoke.mjs` 85/85、`arcade_gameplay_test.mjs --suite=base --repeat=2` 22/22；独立 Reviewer 评审；`validate_site.py` / `build_site.py` / 全部 `node --check` 通过。
- [x] 独立评审与发布前修复：`docs/arcade/0.8.1-REVIEW.md` APPROVE-WITH-NOTES（0 Blocker / 2 Major / 8 Minor / 9 UNVERIFIED）；M1 改为发布后证据提交时序，M2 修复 320/375 开始弹层禅模式入口被裁剪（窄屏短文案+紧凑样式，ZS-14 加四档三入口可见断言），m-1/m-2/m-5 已修、m-3/m-4/m-7/m-8 已记录。
- [x] 发布证据：提交 `575a766`（功能）+ `41fa79e`（评审修复）推送 `main`；Actions `43423208129` 四个 job 全成功；CI 与本地 `verify_deploy.py` 均 **37/37** 文件双端一致（Arcade `0.8.1` / Badge `2.2.1`）；双端线上无头 Chrome **10/10**；SW 缓存键 `studiokit-arcade-0.8.1-v1`。
- 未验证：iOS/Android 真机触控（禅模式按钮与 Z 键替代）与低端机帧率仍 UNVERIFIED；积分记录不提供排行榜/跨设备同步。

## 0.8.2 发布批次（2026-11-13 已双端发布）

### Arcade 0.8.2 — 俄罗斯方块控制区压缩（已发布）

- [x] 删除禅模式独立按钮行，冻结/恢复提速并入道具行（同一行 3 按钮、经典仍 2 按钮；按钮 ≥44px；结束本局保留在暂停弹层）；禅模式隐藏重复 hint；道具行 44px、页面 gap/底部留白压缩；画布高度规则回收空间。
- [x] 实测 320/375/390/430 与桌面 1280×900：禅模式画布面积 +18%～+47%，画布高度比经典多 56–60px，页面 0 溢出；经典/挑战/存档/积分记录/localStorage key 与 Schema 不变。
- [x] 测试：`arcade_zen_scores_test.mjs` ZS-04 重写为「禅模式 HUD / 控件压缩 / 画布增量」；`arcade_smoke.mjs` 85/85、gameplay base 22/22 零回归；独立评审（在功能发布后完成，证据提交回填）与发布前门禁。
- [x] 发布证据：提交 `077ccf5` 推送 `main`；Actions `43447829596` 四 job 全成功；CI 与本地 `verify_deploy.py` 均 37/37 双端一致（Arcade `0.8.2` / Badge `2.2.1`）；双端线上无头 Chrome 14/14；SW 缓存键 `studiokit-arcade-0.8.2-v1`。
- 未验证：iOS/Android 真机触控手感与低端机帧率仍为 UNVERIFIED。

## 0.8.3 发布批次（2026-11-15 已双端发布）

### Arcade 0.8.3 — 共享 shell Android 顶部导航条空白修复（已发布）

- [x] Owner Android 实机反馈顶部导航条上方整块空白；定位为部分 Android 浏览器普通标签页也返回约 40px `safe-area-inset-top`，与 `*{box-sizing:border-box}` 叠加后把 38px 导航行压扁、文字贴底。
- [x] 共享 shell：顶部安全区只在 standalone/独立窗口应用，并计入 `min-height: calc(38px + env(...))`；普通标签页保持 38px、文字居中；`--studiokit-shellbar-h` 在 resize 同步；Badge Studio 一并修复。
- [x] 测试：`arcade_smoke.mjs` 新增浏览器模式安全区回归断言 + standalone 真实模拟，**86/86**；`arcade_zen_scores_test.mjs` 14/14、gameplay base 22/22；`validate_site.py` / `build_site.py` / `node --check` 通过。
- [x] 发布证据：提交 `c1727e7` 推送 `main`；Actions `43670060561` 四 job 全成功；CI 与本地 `verify_deploy.py` 均 **37/37** 文件双端一致（Arcade `0.8.3` / Badge `2.2.1`）；双端线上无头 Chrome 浏览器模式（40px 安全区下 shellbar 38px、文字居中）+ 独立窗口（78px）+ SW 缓存键 `studiokit-arcade-0.8.3-v1`，0 console error。
- 未验证：Owner 的那台 Android 浏览器发布后复测；iPhone/Android 真机触控与低端机帧率仍 UNVERIFIED。

## Venue Compare 0.2.0 发布批次（2026-11-16 已双端发布）

### Venue Compare — 餐厅考察对比与地图标注（已发布）

- [x] 从 Owner 提供的单文件 HTML 接入为 StudioKit 工具：共享 shell、IndexedDB 命名空间、空状态/示例、响应式卡片、撤销重做与自动保存。
- [x] 0.2.0 增加每餐厅外部链接（大众点评/官网/小红书/地图预设、分享文案提取与备注、http(s) 白名单）。
- [x] 验证：`restaurant_compare_smoke.mjs` 19/19；`validate_site.py` / `build_site.py` / `node --check` 通过；320/375/390/430px 无横向溢出。
- [x] 0.2.0 已双端发布：注册表 `draft` → `available`；提交 `2276194`（含 `81684b9` / `f7146f8` / `ec0359d`）；Actions `43809215680` 四 job 成功；`verify_deploy.py` **38/38** 双端一致；双端线上无头 Chrome 2/2。

## 0.8.4 发布批次（2026-11-18 已双端发布）

### Arcade 0.8.4 — 棋盘优先画布 + 道具坞 + 地铁单手暂停（已发布）

- [x] Owner 三轮试玩反馈（道具区挤占画面 / 暂停按钮不便，地铁上玩 / 游戏画面占屏比太小）→ 道具坞移入画布、画布重排为 340×610（井口占画布 79% 高 / 71% 宽）、经典棋盘占屏 320 13.3→25.2%、375 15.9→28.3%、390 23.9→40.0%、430 25.7→40.7%（棋盘面积 +58%～+89%，格边长 +26%～+36%）。
- [x] 道具坞：经典/挑战 3 格（换块/慢落/暂停）、禅 4 格（+冻结提速），均 ≥44×44 单行；暂停键为拇指区最后一格 + 触屏双击画面暂停；顶部按钮/P/Esc/切后台自动暂停保留，共用 `pauseByUser()`。
- [x] 修复共享样式冲突：门户 `.tool-icon`（46×46）改为街机厅 `.tool-glyph`，13 款游戏道具按钮恢复 16px emoji；≤560px 高视口自动回退画布外。
- [x] 测试：`arcade_smoke.mjs` **87/87**（新增拇指区暂停/双击暂停 1 项）、`arcade_zen_scores_test.mjs` **14/14**、gameplay base **22/22**、`validate_site.py` / `build_site.py` / `node --check` 通过。
- [x] 发布证据：提交 `77cb02a..ecfdda4` 推送 `main`；Actions `44122372096` 四 job 全成功；CI 与本地 `verify_deploy.py` 均 **38/38** 双端一致（Arcade `0.8.4` / Badge `2.2.1` / Venue `0.2.0`）；双端线上无头 Chrome **18/18**；SW 缓存键 `studiokit-arcade-0.8.4-v1`。
- 未验证：iOS/Android 真机触控（棋盘格大小手感、双击暂停在颠簸场景）与低端机帧率仍 UNVERIFIED。

## 0.8.5 发布批次（2026-11-19 已双端发布）

### Arcade 0.8.5 — 极速车道车流规则 + 贪吃蛇棋盘优先 + 积分记录消去层数（已发布）

- [x] Owner 试玩反馈 6 条：极速车道卡死/车辆消失（负圆角 `RangeError` → rAF 断链）、远车临近才出现、缺转向灯换道、娱乐点不足；贪吃蛇移动端不精准/提速太快；方块积分记录缺消去层数。
- [x] 极速车道：`roundRect` 非负半径 + `drawCar` 比例内缩 + `createLoop` 逐帧兜底；`scaleAt` 与路面同一透视（地平线 16.1% 车身）、`z=1.02~1.52` 预生成、`z>2` 隐形车回收；转向灯换道（车灯/箭头/虚线导引、目标车道占用与走廊公平性检查）；连超尾流、加速带、维修箱、每 1000m 车流加密、S+/S/A/B/C 评价与积分详情。
- [x] 贪吃蛇：逻辑画布 420×740→360×430（375×667 棋盘 180→273px）、四向 58px 按钮（与键盘/滑动同规则、拦掉头）、挑战 HUD 移顶栏、底部常驻目标；提速 20 果实 11.8→7.7 格/秒。
- [x] 方块：经典局积分记录写入 `lines/level/detail`，中心页详情列显示当次消去层数。
- [x] 测试：`arcade_smoke.mjs` **89/89**（新增 2 项、方块追加消去层数断言）、`arcade_zen_scores_test.mjs` **14/14**、gameplay base **22/22**、`validate_site.py` / `build_site.py` / `node --check` 通过；4× 快进自动驾驶压力跑 0 console error。
- [x] 发布证据：提交 `bdb1176..ee9b45b`（5 个提交：`cf8979e` 极速车道 / `211d8ca` 贪吃蛇 / `16a2a8b` 方块积分 / `35394a2` 测试 / `ee9b45b` 文档）推送 `main`；Actions `44472286080` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **38/38** 文件 SHA-256 双端一致（Arcade `0.8.5` / Badge `2.2.1` / Venue `0.2.0`，manifest `application/manifest+json`）；双端线上无头 Chrome **20/20**（中心页 0.8.5 + 13 卡、SW `VERSION 0.8.5`、极速车道地平线车身 6.43×9.96px + 打灯车 0→1 完成、贪吃蛇棋盘 309px + 4×58px 按钮 + 向下转向、方块运行时 0.8.5、0 console error）；SW 缓存键 `studiokit-arcade-0.8.5-v1`。
- 未验证：iOS/Android 真机按钮手感、转向灯可读性与双击暂停仍 UNVERIFIED。

## Now

1. **Arcade 0.8.5 线上观察**：重点观察极速车道转向灯换道的真机可读性/公平性、连超与拾取节奏，贪吃蛇四向按钮的拇指手感与棋盘大小，以及 SW 缓存 `studiokit-arcade-0.8.5-v1` 刷新。
2. **Arcade 0.8.0 试玩**：按 `docs/arcade/0.8.0-PLAYTEST.md` 与 `docs/arcade/0.9/PLAYTEST.md` 在桌面与 iOS/Android 真机做两轮试玩（影冲理解、挑战选关/路线/难度、失败归因），并裁决 5 项设计差量；真机未验证前不宣称通过。
3. **数值反馈**：收集道具次数、自然收尾目标（5000m/3000m/20 果实/40 行）和休息提醒时长的真实反馈，再决定是否微调；不为了“有更新”而改。
4. **双端发布维护**：观察 GitHub Pages 与 Cloudflare Pages 的版本一致性；需要时再绑定自定义域名或调整缓存策略。
5. **文档维护**：工具版本、根目录 README/CHANGELOG、发布记录和任务队列保持一致。

## Next

1. **Rounded Image**：用户曾提出圆角图片编辑/导出需求，但原 HTML 和完整规格暂未找回。先不要凭空复刻；等原需求补充后再确定功能边界。
2. **门户级 Tool discovery**：门户工具数量继续增加后，再考虑门户层分类、搜索和标签过滤；Arcade 中心页自己的搜索/筛选已完成，不重复造轮子。
3. **Shared utilities**：只有出现两个以上真实重复实现时，才抽取文件下载、图片解码等公共能力；Arcade 的 `engine.js` 保持工具内共享，不提升为全站运行时。
4. **Arcade 统计扩展（待需求）**：跨设备同步、周/月报表或成就系统都需要账号或后端，当前离线优先架构下不默认实现。
