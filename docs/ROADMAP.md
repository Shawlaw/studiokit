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
- [x] 独立评审与发布前修复：`docs/archive/0.8.1-REVIEW.md` APPROVE-WITH-NOTES（0 Blocker / 2 Major / 8 Minor / 9 UNVERIFIED）；M1 改为发布后证据提交时序，M2 修复 320/375 开始弹层禅模式入口被裁剪（窄屏短文案+紧凑样式，ZS-14 加四档三入口可见断言），m-1/m-2/m-5 已修、m-3/m-4/m-7/m-8 已记录。
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

## 0.8.6 发布批次（2026-11-19 已双端发布）

### Arcade 0.8.6 — 结算重选模式 + 贪吃蛇双拇指相对转向（已发布）

- [x] 13 款游戏经典局与俄罗斯方块禅模式的「再来一局」回到开始弹层重新选模式；俄罗斯方块完整复位三入口，2048 继续挑战与挑战关重试/选关不变。
- [x] 贪吃蛇触屏改为左右相对转向双按钮，64px 高、等宽分区；经典两级缓冲与挑战队列按格执行连点，键盘/WASD/滑动保持绝对方向。
- [x] 兼容：localStorage key/Schema、挑战数据、玩法数值与积分规则不变；设计见 `apps/arcade/DESIGN-0.8.6.md`。
- [x] 门禁：`arcade_smoke.mjs` **91/91**、`arcade_zen_scores_test.mjs` **14/14**、gameplay base **22/22**，validate/build/node 全过；320/375/390/430 布局通过，真机手感 UNVERIFIED。
- [x] 发布证据：提交 `14a9160` 推送 `main`；Actions `44553437432` 四 job 全成功；CI 与本地 `verify_deploy.py` 均 **38/38** 双端一致；双端线上无头 Chrome **20/20**（SW、双按钮、经典/挑战相对转向、结算重选、方块三入口、0 console error）；SW 缓存键 `studiokit-arcade-0.8.6-v1`。

## 0.9.0 发布批次（2026-11-20 已双端发布）

### Arcade 0.9.0 — 挑战公平性修复 + 三款平和棋牌（已发布）

- [x] 13 款既有游戏的挑战模式按「是否公平、是否可读、续档是否可信」逐项修复：记忆翻牌道具锁死与续档、2048 继续挑战丢分、俄罗斯方块挑战换块队列、雪铃无效安可不消耗、砖块拖动误发球、层塔挑战落点偏置与续档、矿工最后一钩结算、极速车道近距超车算反、影跃重试刷最佳时间、星海挑战刷新后续档。**不改挑战关卡数据**。
- [x] 新增三款无倒计时 / 无下注 / 无联网的竖屏单机棋牌：二十一点、五子棋、纸牌接龙（各 2 个可选辅助道具），只复用 `progress:v1` 与 `runs:v1`，不新增存储 key。
- [x] 新增门禁 `tools/arcade_calm_games_test.mjs`（三款棋牌规则自检 / 结算 / 四档布局 + 10 款修复 regression）、`tools/arcade_calm_probe.mjs`（单页接入探针）、`tools/check_inline_scripts.mjs`（全站内联脚本语法）。
- [x] 本地门禁：`arcade_smoke.mjs` **94/94**（17 页 / 16 款）、zen 14/14、gameplay base 22/22、`--suite=all` 104/104、calm 17/17；真机触控、五子棋 AI 手感与 320px 点按精度 UNVERIFIED。
- [x] 发布证据：提交 `eb5e641` 推送 `main`；Actions `44582961215` 四 job 全成功；CI 与本地 `verify_deploy.py` 均 **41/41** 双端一致（Arcade `0.9.0` / Badge `2.2.1` / Venue `0.2.0`）；双端线上无头 Chrome 各 20/20；SW 缓存键 `studiokit-arcade-0.9.0-v1`。设计与回滚见 `apps/arcade/DESIGN-0.9.0.md`，评审见 `docs/archive/0.9.0-REVIEW.md`。

## 0.10.0 发布批次（2026-11-20 已双端发布）

### Arcade 0.10.0 — 棋牌规则修复、挑战深度与数据管线（已发布）

- [x] 三款棋牌规则修复：二十一点 natural 立即结算与同点 push；五子棋异常自动对局不伪装和棋、320/375 DOM 44px 确认按钮；纸牌接龙提示回退/等价移动过滤/撤销与提示续档/重发入口。
- [x] 挑战实现修复：层塔 C05/C06 目标进入判定；方块摆法空间与 place-by-place 重力；2048 步数口径；星海 splits 二次换位；车道 +5 门牌与时长；雪铃彩铃收益/雪花乐谱；影跃半径 20 与 requireDash；重力窗口收窄；矿工双路线与防剧透。
- [x] 数据管线：build_pack.py 为最终 authoring 源；contentRevision、字段白名单、supportedFeatures、canonical 哈希、shadow-summary 不泄答案，运行时删除 referenceCatchOrder，夹具保留。
- [x] 测试：权威夹具读取替换硬编码答案；78 关证据覆盖矩阵；派生文件重生成一致性检查；`arcade_run_all_gates.py` 一键跑全部门禁。
- [x] 本地门禁：`arcade_smoke.mjs` **94/94**、`arcade_zen_scores_test.mjs` **14/14**、`arcade_gameplay_test.mjs --suite=all --repeat=1` **104/104** 与 base **22/22**、`arcade_calm_games_test.mjs` **17/17**、派生重生成 **143/143**；真机与 AI 手感 UNVERIFIED。
- [x] 发布证据：提交 `fc37d2b` 推送 `main`；Actions run `44681529684` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 文件 SHA-256 双端一致（Arcade `0.10.0` / Badge `2.2.1` / Venue `0.2.0`，manifest `application/manifest+json`）；双端线上无头 Chrome 各 26/26（中心页 0.10.0 + 16 卡 + 三款棋牌注册、三款棋牌 selftest/regression/开始/暂停、0.10.0 挑战数据字段、0 console error）；SW 缓存键 `studiokit-arcade-0.10.0-v1`。（详细记录见 `docs/RELEASE-RUNBOOK.md`）

## 0.11.0 / 0.11.1 发布批次（2026-11-21 已双端发布）

- [x] 0.11.0 — 16 款游戏共 45 处结算弹层不再用暗色蒙层盖住终局画面：结算卡片移到底部、新增「回看」按钮与「查看结算」胶囊一键切换（共享引擎 `result:true`，页面模板零改动）；五子棋棋盘 384→400、格距 34→36、棋子半径 14→15。门禁 `arcade_run_all_gates.py` ALL PASSED（smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay all 104/104、base 22/22，新增 `arcade_review_test.mjs` 5/5）。发布：`8453baf` / Actions `44774786680`（首次 Verify 遇 CF 传播延迟，同 SHA `--failed` 重跑通过）。
- [x] 0.11.1 — 结算默认恢复高级模糊蒙层，点专用回看按钮才透明回看；回看按钮按游戏定制文案（赛道 / 矿场 / 牌桌 / 果园等）。发布：`d51c87e` / Actions `44876176661` / `verify_deploy.py` 41/41 / 线上 12/12。设计见 `apps/arcade/DESIGN-0.11.0.md`、`DESIGN-0.11.1.md`。

## 0.11.2–0.11.5 修复批次（2026-11-21）

- [x] 0.11.2 — PWA 更新检测（中心页「检查更新」按钮 + 更新横幅 + SW 主动广播 + `checkForUpdate/applyUpdate/onUpdate/swVersion`），并修 iPhone 安装版顶部灰白渐层与顶栏文字发虚；新增 `tools/arcade_pwa_update_test.mjs`（6/6）。发布：`f2f1cd1` / Actions `44899492208` / 41/41 / SW `0.11.2-v1`。
- [x] 0.11.3 — 移除全部 17 页 `viewport-fit=cover` 与中心页半透明状态栏 meta（iOS 26+ 系统级顶缘模糊的真因），保留贴顶不透明深色条兜底；validate 增加防回归断言。发布：`82db383` / Actions `44904562855` / SW `0.11.3-v1`。
- [x] 0.11.4 — 真机诊断确认「被模糊」对象是中心页共享 shellbar；standalone 下改 `position: sticky; top: 0` 贴顶，临时诊断页删除；PU-04 新增 sticky 断言。发布：`87795d7` / Actions `44909647508` / SW `0.11.4-v1`。
- [x] 0.11.5（未单独发布，已并入 0.12.0）— 移动端双击误触放大防护（17 页 viewport + `touch-action` + `dblclick` 拦截）、五子棋落子按钮文字重影（画布为唯一文字源 + DOM 透明命中层）、预览取消出口（拆「取消 / 落子」）；新增 `tools/arcade_interaction_test.mjs`（5/5）。
- [ ] 真机复测：iOS 26+ 顶部观感与 PWA 更新提示时机待 Owner 确认（UNVERIFIED，无头 Chrome 无法重现系统级模糊）。

## 0.12.0–0.12.7 层塔与拇指区批次（2026-11-22 已双端发布）

- [x] 0.12.0 — 全屏 / PWA 底部按钮拇指区抬升（`--ac-thumb-lift` 36px）；层塔持久重心 / 支撑物理模型（偏置堆叠会真的塌）；层塔全览（按钮 + 快捷键 3）；工地集装箱皮肤与 4 种真实生效属性；合并 0.11.5。新增 `arcade_immersive_buttons_test`（16/16）与 `arcade_tower_test`（13/13）。
- [x] 0.12.1 — 层塔「所见即所判」：塔身轴对齐（不再整体旋转但用未旋转坐标判定）、倾斜改为支撑面 / 重心可视化、经典模式吊臂跟随塔顶、完美吸附力矩修正、全览 zoom-to-fit、落点投影常显；tower **17/17**。发布：`7d2a80a` / Actions `44961843208`。
- [x] 0.12.2 — 集装箱释放水平速度（`L·cosθ·θ̇ × 0.45`，上限 240px/s）与抛物线落点预测；tower **18/18**（预测误差 ≤3px，实测 ≤0.6px）。发布：`7c6a4a9` / Actions `44964004148`。
- [x] 0.12.3 — 全览去掉缩放下限（200 / 1000 层都能一屏看全塔）+ 超高塔 LOD + 层号抽稀；tower **19/19**。发布：`79be219` / Actions `44968445299`。
- [x] 0.12.4 — 修复 LOD 误按层数触发导致近景集装箱退化成色块（LOD 只看缩放 + 视口裁剪）；tower **20/20**。发布：`d79d500`。
- [x] 0.12.5 — 层塔难度两段式曲线（约 157 层封顶）+ 升速时振幅归一（摆幅不再塌缩）；tower **21/21**。发布：`7593b0a` / Actions `44973571565`。
- [x] 0.12.6 — PWA 独立窗口套用拇指抬升并收起重复 hint（底部按钮与全屏同高、画布 +34px）；immersive **32/32**（新增 IB-06）。发布：`c1c2186` / Actions `44977911963`。
- [x] 0.12.7 — 层塔难度按人类计时能力重标定（封顶完美窗口 28→56.5ms、可落 178→335ms，挑战零改动）；tower **23/23**（新增 TP-14 真实毫秒窗口守卫）。发布：`0d267d9` / Actions `44986037865`。

## 0.13.0 发布批次（2026-11-22 已双端发布）

### Arcade 0.13.0 — 星海突击「星域远征」（机库 / 能量 / 编队 / 大杀器 / 星区主题）

Owner 反馈六件事（每关都是白板装备、难度没有差异、机体没有大升级与常态 buff、想要核弹级稀缺大伤害道具、想要油量/能量这类局限、想要临时编队等出击状态），设计源为 `apps/arcade/DESIGN-0.13.0.md`。**挑战 6 关数据与判定零改动。**

- [x] 设计落盘：三层循环（战斗 / 关卡 / 远征）、机库六项改装与星币结算（`floor(score / 16)` + 整备「军费补给 +40」）、局内火力等级 1–5、能量与枯竭、临时编队、大杀器（反物质核弹 / 轨道炮 / 时空锚）、6 星区主题压力轴与分数补偿、Boss 血量重标（`480 + (level-1) × 280`）、CLEAR 三选一整备、动画与反馈、存档兼容与回滚。
- [x] 版本链与文档同步：`ARCADE_VERSION` / 注册表 / SW 缓存键（`studiokit-arcade-0.13.0-v1`）/ 中心页 `data-hall-version` 升至 `0.13.0`；CHANGELOG、README、BASELINE、RELEASE-RUNBOOK 标记为未发布。
- [x] 数据兼容：新增引擎通用游戏数据 `studiokit:arcade:meta:v1`（`A.GameMeta.get/set/clear`，机库在 `games['star-raid'].hangar`，`formula: 1` 锁公式版本）与备份字段 `gameMeta`；`runs:v1` 只追加 `data.run`（挑战分支 `run: null`），既有 6 个 key 与 Schema 不变，旧档缺字段按默认恢复；中心页「清除记录」同步清机库。
- [x] 门禁（本地已执行）：`check_inline_scripts.mjs` PASS（19 HTML / 20 段脚本）、`node --check engine.js/sw.js` PASS、`validate_site.py` PASS、`build_site.py` PASS、`arcade_smoke.mjs` **103/103**（含 9 项 0.13.0 回归）、挑战 6 关 **7/7**（`--suite=challenge --game=star-raid`）、gameplay base 11/11、tower **23/23** 与 tower challenge **6/6**（0.12.7 基线同批复跑）、zen 17/17、calm 7/7、review 5/5、pwa 7/7、interaction 5/5、immersive 32/32、stage coverage 78 关矩阵正常。
- [x] 布局验收：320 / 375 / 390 / 430px 下机库面板、道具行、编队按钮、整备卡无横向溢出、按钮 ≥44px；320/390 已固化为 smoke 回归（`star-hangar-390.png` / `star-refit-320.png`）。
- [x] 双端发布：Owner 本轮明确选择「确认发布（PUBLISH_TO_MAIN）」；提交 `faf1772` 推送 `main`；Actions run `44990933121` 四 job 全绿；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端一致（arcade 0.13.0 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 实测 0.13.0、GameMeta/6 主题/机库/编队/核弹/整备与 0 console error。
- [ ] 真机试玩：星币经济节奏（一局大约多少星币、六项改装多久满级）、能量枯竭与编队的取舍手感、大杀器稀缺度、6 星区主题差异是否可感知；未试玩前不宣称通过。

## 0.13.1 修复批次（2026-11-22 已双端发布）

- [x] 大杀器栏并入主道具行：3 主动 + 最多 3 军械（5/6 列），空槽常显「军械」；删除第二行与 `has-star-items` 高度规则，修复 iPhone 非全屏 PWA 看不到道具栏
- [x] 核弹改为追踪弹：Boss 实时追踪、无 Boss 飞画面中央，命中后才清弹/结算伤害并播放白闪 + 震屏 + 冲击波；`run.nukeShots` 随档保存
- [x] 「机动强化」（`engine` id 不变）：受击无敌 +0.12s/级、拾取吸附 +6%/级；键盘移速固定 320，触屏也有收益
- [x] 机库浏览暂停 `Playtime`，不再计入有效游玩时长
- [x] 挑战 6 关零改动；无新增 localStorage key / Schema；版本链与 SW `studiokit-arcade-0.13.1-v1`
- [x] 本机门禁：smoke 105/105、tower 23/23、挑战 7/7 + 6/6、base 11/11、zen/calm/review/pwa/interaction/immersive、320–430 + standalone 布局 43/43、validate/build/inline/design 全过
- [x] 双端发布：Owner 本轮明确选择「确认发布 0.13.1（PUBLISH_TO_MAIN）」；提交 `01eb5b4` 推送 `main`；Actions run `44996450758` 四 job 全绿（Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments）；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.13.1 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 实测：中心页 0.13.1、主道具行 5 列（3 主动 + 2 军械槽，空槽「军械」）、390×844 standalone 模拟行底 ≤ 视口、核弹发射后 0.26s 仍在飞行且 Boss 480 血不变、命中后 Boss 354 血 + flash 0.70 + 冲击波 2 + 0 console error；SW 缓存键 `studiokit-arcade-0.13.1-v1`。
## 0.13.2 修复批次（2026-11-22 已双端发布）

Owner 两条真机反馈：①已安装 PWA 点「检查更新」显示的是已安装版本，不是线上最新版本；②iPhone 主屏 PWA 玩一天后中心页「累计时长」一直为 `0 分钟`，但积分记录表格有数据。都已在无头 Chrome 复现并修复（设计与复现输出见 `apps/arcade/DESIGN-0.13.2.md`）：

- [x] **版本来源**：`A.Offline.checkForUpdate()` 不再返回页面自身的 `ARCADE_VERSION`（= 已安装版本），改为解析线上 `sw.js` 的 `VERSION` 作为最新版本，并与页面/SW 版本比较；返回 `latestVersion` / `installedVersion` / `pageVersion` / `updateReason`
- [x] **SW 广播**：`activate` 删除 `firstActivation`（该标志恒为 false，`arcade-sw-update-ready` 从未发出），改为清理旧缓存前用「旧版本缓存是否存在」判断升级接管后再广播
- [x] **判定与文案**：`updateFound` 改为按版本号比较（新 SW 已接管但页面未刷新也提示刷新）；`controllerchange` 不再覆盖已知版本号；横幅/按钮提示同时显示最新与当前版本；读不到线上版本时提示「检查更新失败」，不谎报「已是最新」
- [x] **SW 不缓存自己**：页面读取 `sw.js` 的请求交给网络，避免被 `cacheFirst` 用已安装版本的旧脚本回答
- [x] **游玩时长停摆**：16 款游戏共用的 `Playtime` 不再要求 window `focus`（iOS 主屏 PWA 回前台常常只给 `visibilitychange`；漏一次 focus 就永久停摆，而 `scores:v1` 仍照写），改为「页面可见 + 弹层关闭」并新增 `syncSegment()` 在可见性/`pageshow`/用户点按按键/15 秒 tick 上自愈；`recordRound()` 结算后续开时间片
- [x] 无 localStorage key / Schema 变更；挑战/玩法/存档零改动；版本链 0.13.2 / SW `studiokit-arcade-0.13.2-v1`
- [x] 门禁：pwa **9/9**（新增真实发版链路与读取失败）、smoke **108/108**（新增 3 项 iOS 漏发 focus 计时回归）、tower 23/23、zen 14/14、calm 17/17、review 5/5、interaction 5/5、immersive 32/32、gameplay all 104/104 + base 22/22（11 场景 ×2 遍）、挑战矩阵 78 关、320–430 + standalone 布局、validate/build/inline/design 全过
- [x] 双端发布：Owner 本轮明确授权发布（`PUBLISH_TO_MAIN`）；提交 `8493cf7`（PWA 更新检测）+ `78858e0`（游玩时长 + 文档）ff 合入 `main`；Actions run `45002523350` 四 job 全绿（Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments）；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.13.2 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 各 8 项全过（中心页 0.13.2 + 检查更新返回线上 0.13.2 且不误报、SW 握手 0.13.2、缓存键 `studiokit-arcade-0.13.2-v1`、游戏页可加载、0 console error）
- [ ] 真机复测：iOS 主屏幕 PWA 的「检查更新」提示时机与「累计时长/积分记录时长」待 Owner 确认（UNVERIFIED）

## 0.19.0 单手触屏与矮视口（2026-11-25 已双端发布）

- [x] 矮视口紧凑模式（≤620×700）：收起站点壳条与说明行、底部弹层、选关 / 机库面板铺满屏幕；375×548 下画布占屏 25–32% → 33–47%，开局按钮 16 款全部首屏可见；高屏布局与拇指抬升量不变
- [x] 11 款实时游戏的拇指区暂停（挑战模式同样保留）、恢复门、结算防误触
- [x] 单手手感：影跃上滑影冲、雪铃 / 影跃半屏方向锁、砖块计划挡板相对拖动、二十一点 / 记忆翻牌抬起确认、2048 撤销入行、打地鼠经典双指、星海突击空槽收起
- [x] 修复：4 款游戏挑战选关「返回开始」无反应、黄金矿工具品坞间隙误放钩、俄罗斯方块矮视口操作键被切、`career_96_missions` 贪吃蛇夹具漂移
- [x] 新增门禁 `arcade_compact_touch_test`（18 项，真实触控事件）并入聚合门禁；版本链 0.19.0
- [ ] Owner 真机试玩并裁决首版取值（半屏方向锁 40px、挡板增益 1.2、上滑影冲 56px/350ms、防抖 450ms）；发布需 Owner 明确授权

## 0.21.2 首页生涯弹窗与交互细节（2026-11-26 已双端发布）

- [x] 「旧港生涯 / 回折光港看看」改为首页直接打开告示板弹窗，关闭恢复原滚动位置、焦点与背景滚动
- [x] 钱包标题统一为「钱包与收据」；生涯弹窗层级高于置顶导航栏并锁定背景滚动
- [x] 游戏页顶栏标题留白；320px 保留页面边距避免截断
- [x] 版本链 0.21.2 / SW `studiokit-arcade-0.21.2-v1`；key / Schema / IDB / 玩法数值零变化
- [x] 发布前实测：冒烟 119/119、首航 404/404、PWA 18/18、紧凑触控 18/18、入口 71/71、委托 64/64
- [x] 双端发布与 `verify_deploy` 校验：main `bc50e61`，Actions `45858201941` 全绿，双端 91/91 一致；full profile / 真机 / 真人 UNVERIFIED

## 0.21.1 生涯身份建立后的常驻旧港入口（2026-11-26 已双端发布）

- [x] 修正 0.21.0「身份建立后也无内容入口」的过度实现：身份建立后经典目录旁常驻「旧港生涯」入口（`?careerPanel=town`，44px 热区）；身份建立前仍只有被动来信小字
- [x] 不恢复生涯视图 / 默认视图切换或常驻章节链接；封存隐藏内容入口但保留生涯设置，解冻恢复，完全重置后入口消失；经典目录与排序不变
- [x] 产品行为只改中心页 HTML / CSS 与对应断言；key / Schema / IDB / 玩法数值零变化；版本链 0.21.1 / SW `studiokit-arcade-0.21.1-v1`，main `cbfeef6`，双端 90/90 一致
- [x] 设计 / 回滚 `apps/arcade/DESIGN-0.21.1.md`、验证口径 `docs/arcade-life/INTEGRATION-0.21.1.md` 与根 / 工具文档、任务记录同步
- [x] 主 Agent 实跑：static 35/35、`career_passive_entry` 61/61、`arcade_smoke` 117/117（含四档窄屏、封存 / 解冻 / 重置）、mobile 318/318、PWA 18/18、archive lifecycle 60/60；独立复审 APPROVE
- [x] `arcade_smoke` 最终 118/118，含四档窄屏（320/375/390/430）、封存 / 解冻 / 重置
- [x] release 41/41、96 全量 3792/3792、首航 404/404；Actions `45840350943` 全绿，双端 90/90 一致
- [ ] full profile / 真机 / 真人验证 UNVERIFIED

## 0.21.0 生涯被动化与归档（2026-11-26 已双端发布）

- [x] 中心页生涯彻底被动：经典目录无生涯视图 / 默认视图切换 / 常驻告示板、信箱、章节入口；未读 / 未投递来信只在「继续上次」附近低强调小字找回；生涯已开启 / 已封存时页尾二级「生涯设置」入口，封存时隐藏生涯内容 CTA
- [x] 故事与任务改为面向玩家的第二人称选择式叙事，选项对应真实动作 / 路线 / 终局；NPC 自述保留第一人称；`clues.json` / `chapter-01.json` 同源改写
- [x] 可解冻封存：`state` store 的 `career-archive` 行、事务内重读守卫、解冻推进代次、备份携带标记；ADR §22 冻结接口
- [x] 仅生涯完全重置 `resetAllCareer()`：单事务清空 11 stores，经典 progress / runs / playtime / scores / challenge / meta / prefs 零触碰；二次确认输入「重置生涯」，不可撤销
- [x] 门禁分层 `static` / `release` / `full`；release 不等于 full；CI 新增 L0 static job；96 `--skip-static`；输出真实耗时，没跑不说通过
- [x] 设计 `apps/arcade/DESIGN-0.21.0.md`、集成 `docs/arcade-life/INTEGRATION-0.21.md`、ADR §22 同步；目标版本链 0.21.0 / SW `studiokit-arcade-0.21.0-v1`
- [x] 版本链 0.21.0 / SW `studiokit-arcade-0.21.0-v1`；release 41/41、96 3792/3792、首航 339/339、mobile 318/318、smoke 117/117、archive lifecycle 60/60；full / 真机 UNVERIFIED
- [x] main `28a0182`，Actions `45752833025` 全绿，双端 89/89 文件一致
- [x] Chrome 门禁与 release 41/41、Actions `45750286945`、双端 `verify_deploy` 89/89 已完成（发布证据见 `INTEGRATION-0.21.md`）
- [ ] full profile 与真机 / 真人验证 UNVERIFIED；不得把 release 结论写成 full
- [x] Owner 授权与双端发布已完成（main `14a19b0`，无遗留 push 动作）

## 0.20.0 生涯首航 V2（2026-11-26 已双端发布）

- [x] 错过的首封线索可从首页找回并一次点击投递进港；到港首信明确身份与当前目标，告示板只突出真实可执行的推荐单
- [x] 默认路线由 `campaign.recommend` / `story-evidence` / `route-planner` 按真实规则推导，中间单标「路线进展」；收据三回报 + 下一步 + 页内回告示板 / 读回信
- [x] 关标签丢 ticket 后可显式继续未完成委托；终局 C5 唯一、幂等、失败可重试
- [x] C0–C5 以 `start / progress / complete` 节拍向后兼容扩展；ADR §21 冻结 `originLetter()` / `chapterZero()` / `continuations()` 只读接口；内容 `contentVersion` 仍 `0.18.0`，IDB / key / 数值零改动
- [x] 版本链 0.20.0 / SW `studiokit-arcade-0.20.0-v1`；单门禁：首航 339/339、campaign E2E 731/731、mobile 318/318、world 145/145、推荐 111/111、路线 94/94、db 38/38、backup 34/34、a11y 75/75、PWA 18/18、compact 18/18、smoke 117/117（逐项串行全绿，无一次聚合 `ALL GATES PASSED`）
- [x] Owner 独立复审 APPROVE 后授权 `PUBLISH_TO_MAIN`；发布提交 `df91715`，Actions `45719028590` 四项成功，双端各 88/88 文件一致，线上 0.20.0
- [ ] 真机 / 真人首航 UNVERIFIED

## 0.18.0 星塔回响：六章、三终局与后日常（2026-11-24 已双端发布）

- [x] C0–C5 六章（`campaign.json` + `chapter-00..05`）：信箱/告示板进入，无顶层生涯 CTA
- [x] 三终局（武力/研究/救援）：独立 commission 实例、C4 后三选一、C5 唯一、幂等、失败可重试；后日常按方式差异
- [x] 章节/终局 UI（`ui/world-state.js`）：六章状态/路线、mustKnow/正文、NPC 回信/支线、后日谈、港口灯光；320–430/焦点/reduced-motion
- [x] 16×3=48 主线路径图证明；campaign E2E 701/701（3 条真实路线 C0→C5 + 三终局 + 备份恢复 24/24）
- [x] 修复：C0 信箱旗标、终局跨页事件缓冲（adopt/attach）、mustKnow 渲染、C1 代办路线、中心页 C0 后小字回流入口
- [x] 版本链 0.18.0；`campaign-core` 53/53、`ending-reducer` 34/34、world-state 109/109
- [ ] G18 独立门禁与 Owner 发布授权；真机/读屏器/PWA 安装态 UNVERIFIED

## 0.17.0 活世界：96 委托、五材商店、制造台与职业成长（2026-11-23 本地未发布）

- [x] 96 委托内容（16×T1–T6）：T1–T3 公开；T4–T6 由 C3/C4/C5 旗标解锁，受控 fixture 证明
- [x] 16 游戏职业 run 真实目标/事件/隔离：新增 session.finish、tile.created、move.legal、stock.face_up、foundation.move、bell.unique、stage.clear、distance.reached、combo.reached、wave.completed、scroll.collected 等真实提交点；挑战/禅/割草不可进
- [x] 五材（建材/合金/电子元件/星晶/生物材料）+ 固定价差商店；`db.sellItems` 原子卖料、purchase 材料成本
- [x] 制造台：3 件生涯模块（相位护盾/货舱磁吸/能量电池）与 15 层配方；`MODULE_EFFECTS` 只生涯生效
- [x] 16 职业学徒/熟练/专家（0–2/3–5/≥6 已清委托），只影响可选订单/展示
- [x] 剧情证据去重（E/MAP/BP/DEC）与 C2–C4 多路径；单职业路线规划 16×16 可执行
- [x] 96 委托回归：16 游戏 × 6 阶 96/96 tier、3792 checks；平衡测试 47/47
- [x] 版本链 0.18.0；职业隔离补齐层塔 `finishRun` 缺口、阴影/雪铃经典事件恢复
- [ ] 0.16 first-flight/resume/mobile 按 0.17 内容更新；G17 独立门禁与 Owner 发布授权；真机/PWA 安装态 UNVERIFIED

## 0.16.0 首航：告示板委托、免费租机与飞船机库（2026-11-23 本地未发布）

- [x] 旧港告示板（town）：从 LOCAL 信件按地址进入，列出 T1/T2 委托、明码工钱/材料与时长，接单后跳转对应游戏页
- [x] 委托生命周期：ticket（ticketId=runId）→ `?career=` 激活 → 真实事件缓冲 → 目标判定 → `settleAndClaim` 幂等 → 收据；刷新/暂停可恢复、失败可归因、放弃不发奖
- [x] 层塔施工 T1/T2（稳定 4/6 层真实物理事件、倒塌不计、职业 run 断开旧局内档）与星海护航 T1/T2（startLevel/theme 真实关卡、Boss 真实事件、跳过星币/旧机库/Progress/Scores）
- [x] 免费租机（会话 marker、零扣费、不改拥有）与非战斗代办（明码标价、只写 alternative/story 行、不发战斗奖章）
- [x] 飞船机库：4 艘价格/材料门槛，`purchase.costItems` 同事务扣减 + `writeEquipment` 切换；钱包/流水/原收据 UI
- [x] 0.16 前置修复：星海 GameMeta 读-合并-写、classicLike、serialize 门禁；旧机库 formula 1/经典/挑战/割草零改动
- [x] 内容：commissions.json 4 条、items.json 4 船/模块/材料、chapter-01.json 16 起源 + C1 三路径
- [x] 测试：commission 61+17+8、combat 379、rental 153+22、alternatives 67+13、resume 45、first-flight 192、mobile 318、a11y 75、db 38、backup 34、PWA 离线 17
- [ ] G16 独立门禁与 Owner 发布授权；真机触控/安全区/PWA 安装态 UNVERIFIED

## 0.15.0 被动线索与独立生涯数据层（2026-11-22 本地未发布）

- [x] 16 款游戏在经典游玩中被动产出可关闭的微线索；无显眼生涯入口；不点不影响原玩法；可在设置关闭/恢复，已发现内容可从信箱找回
- [x] `apps/arcade/career/` 运行时（bridge/registry/discovery/career-core/career-db/router/entry-router/backup/content/ui）；普通脚本、无框架、无远程资源
- [x] 独立 IndexedDB `studiokit:arcade:career` v1（11 stores；claim 幂等/单事务/多标签/失败零写入/fail-open）；0.15 游玩只写发现状态与证据
- [x] 接口冻结：事件信封、线索 schema、发现状态机、注册表多对多与虚拟第 17 款插拔、ticket/claim/receipt、故事谓词、备份/迁移、路由/降级
- [x] 16 页最小适配（1 行 bridge 标签 + 真实事件 observe + 每局一次 finish）；经典/挑战/禅/割草/旧机库零改动
- [x] 测试：registry 90/90、discovery 84/84、legacy baseline 78/78、career_db 38/38、backup 与 16 页 CDP 适配实测；PWA/SW 预缓存 career 资源
- [ ] G15 独立门禁复跑（smoke/gameplay/tower/zen/calm/review/interaction/immersive/pwa）与 Owner 发布授权；真机 UNVERIFIED

## 0.14.0 星海突击：弹种叠加 + 星海割草无尽演武（2026-11-22 已双端发布）

Owner 本轮两条：①同种弹药 Buff 多吃时叠加有效时长而不是重置；②新增“模拟割草”模式——所有弹药 Buff 常驻、大杀器库满载、手动道具无限，同时敌潮/掉落极为密集、Boss 招式更炫；玩家唯一瓶颈是能量，且不参与任何积分/货币获取。设计见 `apps/arcade/DESIGN-0.14.0.md`。

- [x] 同种弹种拾取改为 `min(180s, 剩余 + 固定时长)`；浮字显示增加量/累计时长，HUD 显示累计剩余；挑战每关同类 powerup 不重复，实际数据零变化
- [x] 星海割草：开始弹层第 4 按钮（engine 可选 `btn4`，其余游戏零变化）；四弹种常驻、火力 MAX、大杀器 3 槽满载无限次、脉冲/星盾/编队无限（均消耗能量）
- [x] 密集敌潮/掉落：0.26s 刷怪、85% 双刷、同屏 32、敌人血量 ×3.2；Boss 战 20 架护卫持续补充；12% 能量核心（8 杀保底）、重装 50% 火力核心、2% 军械；拾取上限 90
- [x] Boss 四套专属弹幕：扇形齐射 / 螺旋星雨 / 交叉扫射 / 环爆三连；血量 ×2.6、横向巡航、入场不清场、弹幕上限 100；警戒环/光晕/相位反馈并尊重 reduced-motion
- [x] 唯一瓶颈能量：被动 `(1.2 + 3×0.45) × 2.6 ≈ 6.6/s`、击杀 +0.12、核心 +7；受击只扣 22% 能量不掉命；手动道具/编队消耗能量；枯竭沿用惩罚但不死亡
- [x] 无积分/货币：割草不写 score、不调用 `settleCredits`/`Progress.recordPlay`、不更新最高分/机库 runs/best、不写 `scores:v1`；`serialize()` 在 `mode==='mow'` 返回 null，不写局内档
- [x] 无新增 localStorage key / Schema；挑战 6 关数据与判定零改动；版本链 0.14.0 / SW `studiokit-arcade-0.14.0-v1`
- [x] 门禁：smoke **113/113**（新增 4 项）、`SC-STAR-001` 经典 Boss 闭环、挑战矩阵 78 关、320px 4 按钮入口与 6 列道具行、validate/build/inline/design/node --check
- [x] 发布：提交 `4c90a4c` 推送 `main`；Actions run `45010510889` 四 job 全绿；`tools/verify_deploy.py` 41/41 双端一致（arcade 0.14.0 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 实测 0.14.0 与星海割草入口/常驻状态/无 console error
- [ ] 真机试玩：能量节奏、割草密度、Boss 弹幕可读性仍 UNVERIFIED

## 0.13.3 修复批次（2026-11-22 已双端发布）

Owner 在 iPhone 主屏 PWA（Cloudflare Pages）复测 0.13.2：星海/2048/俄罗斯方块玩完时长仍全 0、积分记录有数据，Edge 正常。设备自检页定位根因并修复（设计与证据见 `apps/arcade/DESIGN-0.13.3.md`）：

- [x] 根因：CF Pages pretty URL 把 `/games/x.html` 308 到 `/games/x`，`detectCurrentGame()` 精确比较 `.html` 文件名 → `currentGame` 恒 `null` → `Playtime` 不装载、时间片不启动、`recordRound` 返回 0
- [x] 修复：去 `.html` 后缀 + 小写化比较，兼容尾斜杠/URL 编码，增加按 id 兜底；GH Pages 的 `.html` 行为不变
- [x] 测试基础设施：静态服务器新增「无后缀 → `x.html`」回退（模拟 CF pretty URL），smoke 108 → **109/109**
- [x] 移除 `block-drop.html?diag=1` 临时探针；保留 `apps/arcade/diag.html` 供真机复验
- [x] 版本链 0.13.3 / SW `studiokit-arcade-0.13.3-v1`；无 key/Schema/玩法/挑战改动
- [x] 双端发布：提交 `b3a8c7e`；Actions run `45007754972` 四 job 全绿；`tools/verify_deploy.py` **41/41** 双端一致；线上实测 CF 无后缀 URL `currentGame=block-drop`、游玩 1.6s 记到 1606ms，诊断页 iframe「计时正常」
- [ ] 真机复验：iOS 主屏 PWA 更新后「计时自检」应显示计时正常，累计/积分记录时长不再为 0（UNVERIFIED）

## Arcade 0.24.1 发布批次（2026-11-29，已双端发布）

- [x] 在已发布 0.24.0 上恢复折光港与首页的生涯设置入口，沿用封存 / 解冻 / 完全重置 API。
- [x] 统一三级生涯弹窗标题栏、面板与滚动留白；修复港口刷新后的设置关闭回焦。
- [x] 首页初次打开与恢复时自动核对线上版本，覆盖新 SW 已激活但旧页面未收到事件的缺口。
- [x] 版本链 0.24.1 / SW `studiokit-arcade-0.24.1-v1`；不新增 key / store / schema，不改经典玩法或生涯内容版本。
- [x] release 51/51（not full）、fast-forward main `5a20785`、Actions `46175355611` 全绿、双端 111/111 一致；证据见 `docs/arcade-life/INTEGRATION-0.24.1.md`。

## Arcade 0.24.0 本地发布准备批次（2026-11-28，GATE_PASSED / RELEASE_READY，未发布）

- [x] 版本链本地升至 0.24.0 / SW `studiokit-arcade-0.24.0-v1`；设计 / 回滚见 `apps/arcade/DESIGN-0.24.0.md`，契约见 `docs/arcade-life/ADR-0.24-world.md`，状态见 `docs/arcade-life/INTEGRATION-0.24.0.md`。
- [x] 世界主线替代路线叙事合理化：C1–C5 替代机制只引用真实委托 / 代办 / 材料 / 证据，`requiresSpecificProfession` 恒 false，收据只在真实结算行存在时渲染；章节、路线与终局入口补充真实前置与完成解释。
- [x] 可选职业交汇：双方都已主动接受才产出（16 条职业声明折叠 10 个事件），同一对只保留一个 owner、只写一次，`effects: []` / `grants` 全零；未接受一侧零透露，不进主线候选、推荐或待办。
- [x] 经历筛选与静态回读：17 条白名单，按真实人物 / 已接受职业筛选，无总数、无内部 id；`storyEvents` 落盘仍只有 `at` / `source`，旧档只追加、不迁移。
- [x] 冻结边界：不新增 IDB store / localStorage key / Schema，`contentVersion 0.18.0` / `professionVersion 1` / IDB v1 / 11 stores / 经典玩法数值零改动。
- [x] T25 纯 Node 与静态证据（提交 `83e867d` 时点）：contract 166/166、world 179/179、journal 59/59、route 214/214、economy 47/47、world-work 400/400、route narrative 80/80；`validate_site.py` / `check_readme_links.py` PASS。
- [x] L3（`c5712e5`，复查修正前）：release 51/51 `release passed (not full)`，浏览器 flow 624/624、mobile 334/334、smoke 119/119；full / 真机 / 真人仍 UNVERIFIED。
- [x] 2026-11-28 复查修正：交汇写入复核与回读、经历关联两位参与职业、世界替代经历从真实记录只读推导、职业专属委托的替代叙事只向该职业公开，并带入 0.23 的六项修复；真实流程 645/645。细节见 `docs/arcade-life/INTEGRATION-0.24.0.md` §6 与 `ADR-0.24-world.md` §10。
- [x] 复查修正后的 release 门禁：候选 `4f2d271` 51/51 `release passed (not full)`；不写 ALL GATES PASSED。
- [ ] Owner 发布授权；未获 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN` 前不 push / 不打 tag / 不部署。线上最近发布版本仍为 0.21.2（2026-11-26 已双端发布，main `bc50e61`，Actions `45858201941` 全绿，双端 91/91 一致）。

## Arcade 0.23.0 本地发布准备批次（2026-11-28，GATE_PASSED / RELEASE_READY，未发布）

- [x] 版本链本地升至 0.23.0 / SW `studiokit-arcade-0.23.0-v1`；设计 / 回滚见 `apps/arcade/DESIGN-0.23.0.md`，UI 契约见 `docs/arcade-life/ADR-0.23-ui.md`，状态见 `docs/arcade-life/INTEGRATION-0.23.0.md`。
- [x] 折光港统一界面：局部命名空间组件与精确 token、原型一致 harbor SVG、结算线索/字条/首次到港/后续邀请/回执/港口三分栏/工作/经历全部组件化；普通游戏主题不变。
- [x] 16 个真实职业短叙事 shard；接受邀请不自动接单、首到港真实 `port` 投影给首单、消费后不重播、终局收据保留「读后日谈」；`contentVersion 0.18.0` / IDB v1 / 11 stores / 经典 localStorage key / 玩法数值零改动。
- [x] 视觉与交互证据：13/13 场景、16/16 键盘交互、6/6 PWA 离线（桌面 Chrome），首航 405/405、移动端 334/334；独立复审与版本门禁结果见 `docs/arcade-life/INTEGRATION-0.23.0.md`。full / 真机 / 真人仍 UNVERIFIED。
- [ ] Owner 发布授权；未获 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN` 前不 push / 不打 tag / 不部署。
- [ ] 发布后证据回填；当前线上最近发布版本仍为 0.21.2（2026-11-26 已双端发布，main `bc50e61`，Actions `45858201941` 全绿，双端 91/91 一致）。

## Arcade 0.22.0 本地发布准备批次（2026-11-27，GATE_PASSED / RELEASE_READY，未发布）

- [x] 版本链本地升至 0.22.0 / SW `studiokit-arcade-0.22.0-v1`；设计 / 回滚见 `apps/arcade/DESIGN-0.22.0.md`，状态见 `docs/arcade-life/INTEGRATION-0.22.0.md`。
- [x] 非剧透范围：完善各职业独立发现与统一披露，并新增世界通用工作界面；各职业保持平行与被动发现，工作界面以通用文案呈现，不暴露玩家已拥有的职业。
- [x] 冻结边界：不新增 key / store / schema，`contentVersion 0.18.0` / IDB v1 / 11 stores / 经典 localStorage key / 玩法数值零改动；不新增职业、委托总量、章节或终局。
- [x] release 门禁 41/41 `release passed (not full)` 与版本门禁 reviewer PASS（4 个非阻断 Minor 已同步文档）；状态 GATE_PASSED / RELEASE_READY（本地发布准备，未发布），full / 真机 / 真人仍 UNVERIFIED。依据见 `docs/arcade-life/INTEGRATION-0.22.0.md`。
- [ ] Owner 发布授权；未获 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN` 前不 push / 不打 tag / 不部署。
- [ ] 发布后证据回填；当前线上最近发布版本仍为 0.21.2（2026-11-26 已双端发布，main `bc50e61`，Actions `45858201941` 全绿，双端 91/91 一致）。

## Now

当前已发布版本：Arcade 0.24.1 / SW `studiokit-arcade-0.24.1-v1`（2026-11-29 双端发布，main `5a20785`，Actions `46175355611`，双端 111/111 一致；见 `docs/arcade-life/INTEGRATION-0.24.1.md`）。

1. **Arcade 0.24.1 发布收尾**：release 门禁、fast-forward 推送与双端部署验证待回填；full / 真机 / 真人仍 UNVERIFIED。
2. **Arcade 0.24.0 真机 / 真人 / full 收尾**（已双端发布）：复查修正后 release 51/51、真实流程 645/645；full / 真机 / 真人仍 UNVERIFIED，不写 ALL GATES PASSED。
2. **Arcade 0.23.0 真机 / full 收尾**（本地发布准备，未发布）：复查修正后候选 `01219c2` release 47/47 `release passed (not full)`；full / 真机 / 真人仍 UNVERIFIED。
3. **Arcade 0.21.1 真机 / full 收尾**（已双端发布）：release 41/41、96 全量 3792/3792、首航 404/404，main `cbfeef6`，Actions `45840350943` 全绿，双端 90/90 一致；full / 真机 / 真人仍 UNVERIFIED。
4. **Arcade 0.21.0 真机 / full 收尾**（已双端发布）：release 41/41 与双端 89/89 已完成；full profile、真机 / 真人体验仍 UNVERIFIED，不得把 release 结论冒充 full。
5. **Arcade 0.19.0 真机试玩**（已双端发布，手感待裁决）：按「走路 / 地铁站立 / 等车坐着」三种场景试 16 款游戏，重点裁决半屏方向锁、挡板相对拖动、上滑影冲、恢复门与结算防抖的首版取值，以及紧凑模式在真机标签页里的实际高度。
6. **Arcade 0.13.0 真机试玩**：已双端发布（见上一节）；剩余真机试玩（星币节奏/能量取舍/核弹稀缺度/主题可感知度）。
7. **Arcade 0.10.0 真机试玩**：重点验证三款棋牌的点按精度（320px 五子棋/接龙）、五子棋 AI 难度是否合适、挑战修复后的手感（砖块拖动发球、层塔对齐提示、矿工最后一钩、影跃累计计时文案）。
8. **挑战内容密度**：俄罗斯方块 C04 重复、2048 C05 一步可解、影跃参考通关过短等内容问题需要改设计源 + 生成器 + 参考解，另行排期；本轮只修判定/提示/续档/计分。
9. **Arcade 0.8.0/0.9 设计差量试玩**：按 `docs/archive/0.8.0-PLAYTEST.md` 与 `docs/archive/arcade-0.9-PLAYTEST.md` 在真机做两轮试玩并裁决 5 项设计差量；真机未验证前不宣称通过。
10. **数值反馈**：收集道具次数、自然收尾目标与休息提醒时长的真实反馈，再决定是否微调。
11. **双端发布维护**：观察 GitHub Pages 与 Cloudflare Pages 版本一致性；需要时再绑定自定义域名或调整缓存策略。

## Next

1. **Rounded Image**：用户曾提出圆角图片编辑/导出需求，但原 HTML 和完整规格暂未找回。先不要凭空复刻；等原需求补充后再确定功能边界。
2. **门户级 Tool discovery**：门户工具数量继续增加后，再考虑门户层分类、搜索和标签过滤；Arcade 中心页自己的搜索/筛选已完成，不重复造轮子。
3. **Shared utilities**：只有出现两个以上真实重复实现时，才抽取文件下载、图片解码等公共能力；Arcade 的 `engine.js` 保持工具内共享，不提升为全站运行时。
4. **Arcade 统计扩展（待需求）**：跨设备同步、周/月报表或成就系统都需要账号或后端，当前离线优先架构下不默认实现。
