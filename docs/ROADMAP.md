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

## 0.8.6 发布批次（2026-11-19 已双端发布）

### Arcade 0.8.6 — 结算重选模式 + 贪吃蛇双拇指相对转向（已发布）

- [x] 13 款游戏经典局与俄罗斯方块禅模式的「再来一局」回到开始弹层重新选模式；俄罗斯方块完整复位三入口，2048 继续挑战与挑战关重试/选关不变。
- [x] 贪吃蛇触屏改为左右相对转向双按钮，64px 高、等宽分区；经典两级缓冲与挑战队列按格执行连点，键盘/WASD/滑动保持绝对方向。
- [x] 兼容：localStorage key/Schema、挑战数据、玩法数值与积分规则不变；设计见 `apps/arcade/DESIGN-0.8.6.md`。
- [x] 门禁：`arcade_smoke.mjs` **91/91**、`arcade_zen_scores_test.mjs` **14/14**、gameplay base **22/22**，validate/build/node 全过；320/375/390/430 布局通过，真机手感 UNVERIFIED。
- [x] 发布证据：提交 `14a9160` 推送 `main`；Actions `44553437432` 四 job 全成功；CI 与本地 `verify_deploy.py` 均 **38/38** 双端一致；双端线上无头 Chrome **20/20**（SW、双按钮、经典/挑战相对转向、结算重选、方块三入口、0 console error）；SW 缓存键 `studiokit-arcade-0.8.6-v1`。

## 0.10.0 发布批次（2026-11-20 已双端发布）

### Arcade 0.10.0 — 棋牌规则修复、挑战深度与数据管线（已发布）

- [x] 三款棋牌规则修复：二十一点 natural 立即结算与同点 push；五子棋异常自动对局不伪装和棋、320/375 DOM 44px 确认按钮；纸牌接龙提示回退/等价移动过滤/撤销与提示续档/重发入口。
- [x] 挑战实现修复：层塔 C05/C06 目标进入判定；方块摆法空间与 place-by-place 重力；2048 步数口径；星海 splits 二次换位；车道 +5 门牌与时长；雪铃彩铃收益/雪花乐谱；影跃半径 20 与 requireDash；重力窗口收窄；矿工双路线与防剧透。
- [x] 数据管线：build_pack.py 为最终 authoring 源；contentRevision、字段白名单、supportedFeatures、canonical 哈希、shadow-summary 不泄答案，运行时删除 referenceCatchOrder，夹具保留。
- [x] 测试：权威夹具读取替换硬编码答案；78 关证据覆盖矩阵；派生文件重生成一致性检查；`arcade_run_all_gates.py` 一键跑全部门禁。
- [x] 本地门禁：`arcade_smoke.mjs` **94/94**、`arcade_zen_scores_test.mjs` **14/14**、`arcade_gameplay_test.mjs --suite=all --repeat=1` **104/104** 与 base **22/22**、`arcade_calm_games_test.mjs` **17/17**、派生重生成 **143/143**；真机与 AI 手感 UNVERIFIED。
- [x] 发布证据：提交 `fc37d2b` 推送 `main`；Actions run `44681529684` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 文件 SHA-256 双端一致（Arcade `0.10.0` / Badge `2.2.1` / Venue `0.2.0`，manifest `application/manifest+json`）；双端线上无头 Chrome 各 26/26（中心页 0.10.0 + 16 卡 + 三款棋牌注册、三款棋牌 selftest/regression/开始/暂停、0.10.0 挑战数据字段、0 console error）；SW 缓存键 `studiokit-arcade-0.10.0-v1`。（详细记录见 `docs/RELEASE-RUNBOOK.md`）

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

## 0.13.3 修复批次（2026-11-22 已双端发布）

Owner 在 iPhone 主屏 PWA（Cloudflare Pages）复测 0.13.2：星海/2048/俄罗斯方块玩完时长仍全 0、积分记录有数据，Edge 正常。设备自检页定位根因并修复（设计与证据见 `apps/arcade/DESIGN-0.13.3.md`）：

- [x] 根因：CF Pages pretty URL 把 `/games/x.html` 308 到 `/games/x`，`detectCurrentGame()` 精确比较 `.html` 文件名 → `currentGame` 恒 `null` → `Playtime` 不装载、时间片不启动、`recordRound` 返回 0
- [x] 修复：去 `.html` 后缀 + 小写化比较，兼容尾斜杠/URL 编码，增加按 id 兜底；GH Pages 的 `.html` 行为不变
- [x] 测试基础设施：静态服务器新增「无后缀 → `x.html`」回退（模拟 CF pretty URL），smoke 108 → **109/109**
- [x] 移除 `block-drop.html?diag=1` 临时探针；保留 `apps/arcade/diag.html` 供真机复验
- [x] 版本链 0.13.3 / SW `studiokit-arcade-0.13.3-v1`；无 key/Schema/玩法/挑战改动
- [x] 双端发布：提交 `b3a8c7e`；Actions run `45007754972` 四 job 全绿；`tools/verify_deploy.py` **41/41** 双端一致；线上实测 CF 无后缀 URL `currentGame=block-drop`、游玩 1.6s 记到 1606ms，诊断页 iframe「计时正常」
- [ ] 真机复验：iOS 主屏 PWA 更新后「计时自检」应显示计时正常，累计/积分记录时长不再为 0（UNVERIFIED）

## Now

1. **Arcade 0.13.0 真机试玩**：已双端发布（见上一节）；剩余真机试玩（星币节奏/能量取舍/核弹稀缺度/主题可感知度）。
2. **Arcade 0.10.0 真机试玩**：重点验证三款棋牌的点按精度（320px 五子棋/接龙）、五子棋 AI 难度是否合适、挑战修复后的手感（砖块拖动发球、层塔对齐提示、矿工最后一钩、影跃累计计时文案）。
3. **挑战内容密度**：俄罗斯方块 C04 重复、2048 C05 一步可解、影跃参考通关过短等内容问题需要改设计源 + 生成器 + 参考解，另行排期；本轮只修判定/提示/续档/计分。
4. **Arcade 0.8.0/0.9 设计差量试玩**：按 `docs/arcade/0.8.0-PLAYTEST.md` 与 `docs/arcade/0.9/PLAYTEST.md` 在真机做两轮试玩并裁决 5 项设计差量；真机未验证前不宣称通过。
5. **数值反馈**：收集道具次数、自然收尾目标与休息提醒时长的真实反馈，再决定是否微调。
6. **双端发布维护**：观察 GitHub Pages 与 Cloudflare Pages 版本一致性；需要时再绑定自定义域名或调整缓存策略。

## Next

1. **Rounded Image**：用户曾提出圆角图片编辑/导出需求，但原 HTML 和完整规格暂未找回。先不要凭空复刻；等原需求补充后再确定功能边界。
2. **门户级 Tool discovery**：门户工具数量继续增加后，再考虑门户层分类、搜索和标签过滤；Arcade 中心页自己的搜索/筛选已完成，不重复造轮子。
3. **Shared utilities**：只有出现两个以上真实重复实现时，才抽取文件下载、图片解码等公共能力；Arcade 的 `engine.js` 保持工具内共享，不提升为全站运行时。
4. **Arcade 统计扩展（待需求）**：跨设备同步、周/月报表或成就系统都需要账号或后端，当前离线优先架构下不默认实现。
