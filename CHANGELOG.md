# Changelog

StudioKit 门户本身没有独立的 semver；以下按仓库里程碑与工具版本记录。各工具的详细变更见 `apps/<tool>/CHANGELOG.md`。

## Arcade 0.11.1 — 2026-11-21（已双端发布）

### Changed
- 结算默认恢复高级模糊蒙层；点专用回看按钮后才透明回看，胶囊可唤回结算。
- 回看按钮按游戏定制文案（赛道/矿场/牌桌/果园等），不再统一叫「回看棋盘」。

### Verification
- `tools/arcade_review_test.mjs` 5/5；全量门禁 ALL GATES PASSED；提交 d51c87e 双端发布，verify_deploy 41/41，线上 12/12（默认模糊蒙层 + 按游戏文案 + 回看切换）。

## Arcade 0.11.0 — 2026-11-21（已双端发布）

### Changed
- 结算回看：16 款游戏结算不再用暗色蒙层盖住最终游戏画面；底部结算卡片 + 「回看棋盘 / 查看结算」一键切换，满足玩家回顾终局画面的需求（共享引擎实现，开局/暂停弹层不变）。
- 五子棋棋盘放大：384×384 → 400×400，格距 34 → 36，棋子半径 14 → 15。

### Verification
- 全量门禁 `tools/arcade_run_all_gates.py` ALL PASSED（smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay all 104/104、base 22/22）；新增 `tools/arcade_review_test.mjs` 5/5。
- 双端发布：提交 `8453baf` 推送 `main`；Actions run `44774786680` 四 job 全绿（首次 Verify 传播延迟后同 SHA 重跑通过）；`verify_deploy.py` **41/41** 双端一致（Arcade `0.11.0`）；双端线上无头 Chrome 各 6/6（结算回看与棋盘放大生效，0 console error）。

## Arcade 0.10.0 — 2026-11-20（已双端发布）

### Added
- 新增夹具驱动测试工具：`tools/lib/arcade_fixture.mjs`、`tools/arcade_stage_coverage.mjs`、`tools/arcade_design_check.py`、`tools/arcade_run_all_gates.py`。

### Fixed
- 三款棋牌：二十一点庄家 natural 立即结算、同点 push 优先；五子棋异常自动对局不再伪装和棋，320/375 增加 44px DOM 确认按钮；纸牌接龙修正提示谎报死局/无意义 K 倒列，刷新恢复撤销栈与提示，增加重发入口。
- 挑战：层塔 C05/C06 目标进入判定；方块 C04–C06 改成真实不同落点/摆法空间并支持 data 驱动的“无自然重力”；2048 文案与步数上限一致；星海 C03/C04 二次换位；车道 +5 门牌与时长校准；雪铃彩铃收益与雪花乐谱；影跃影门半径 20 与 `requireDash`；重力窗口收窄；矿工双路线与移除运行时参考顺序。

### Changed
- 设计源以 `docs/arcade/0.9/scripts/build_pack.py` 为最终 authoring 源，全链路重生成；新增 contentRevision、按游戏字段白名单、supportedFeatures、`--check` 生成一致性校验；设计包断言 1088 → 1090，生成器自检 2128 → 3020。
- 参考回放测试从硬编码答案改为统一夹具读取；哈希统一 canonical JSON + UTF-8 + LF。

### Verification
- 本地门禁：`arcade_smoke.mjs` 94/94、zen 14/14、`arcade_calm_games_test.mjs` 17/17、gameplay all 104/104、base 22/22、派生文件重生成 143/143。
- 双端发布：提交 `fc37d2b` 推送 `main`；Actions run `44681529684` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 文件 SHA-256 双端一致（Arcade `0.10.0` / Badge `2.2.1` / Venue `0.2.0`，manifest `application/manifest+json`）；双端线上无头 Chrome 各 26/26（中心页 0.10.0 + 16 卡 + 三款棋牌注册、三款棋牌 selftest/regression/开始/暂停、0.10.0 挑战数据字段、0 console error）；SW 缓存键 `studiokit-arcade-0.10.0-v1`。

## Arcade 0.8.6 — 2026-11-19（已双端发布）

### Changed
- 13 款游戏经典局与俄罗斯方块禅模式的结算「再来一局」统一回到开始弹层，支持重新选择当前游戏的模式；俄罗斯方块完整复位到经典入口态并显示经典 / 挑战 / 禅模式三入口。2048「继续挑战」与挑战关「重试 / 下一关 / 返回选关」不变。
- 贪吃蛇触屏由绝对方向四按钮改为左右分区的「↺ 左转 / ↻ 右转」双按钮，相对蛇头方向每次转 90°；按钮高 64px，375px 视口每枚宽 170px。经典两级缓冲与挑战方向队列让快速连点按格依次生效，不会单格掉头；键盘、WASD、滑动仍为绝对方向。

### Verification
- `arcade_smoke.mjs` **91/91**（新增 2 项结算模式选择；贪吃蛇覆盖四档竖屏、双按钮、相对转向与连点）、`arcade_zen_scores_test.mjs` **14/14**、`arcade_gameplay_test.mjs --suite=base --repeat=2` **22/22**；`validate_site.py` / `build_site.py` / `node --check` 全部通过。
- localStorage key / Schema、挑战数据、玩法数值与积分规则不变；真机 iOS/Android 双手手感仍 UNVERIFIED。设计与回滚见 `apps/arcade/DESIGN-0.8.6.md`。
- 双端发布：提交 `14a9160` 推送 `main`；Actions `44553437432` 四 job 全成功；CI 与本地 `tools/verify_deploy.py` 均 **38/38** 文件一致（Arcade `0.8.6` / Badge `2.2.1` / Venue `0.2.0`）；双端线上无头 Chrome **20/20**，SW 缓存键 `studiokit-arcade-0.8.6-v1`。

## Arcade 0.8.5 — 2026-11-19（已发布）

### Fixed
- **极速车道玩一会儿卡死、车辆全部消失（阻断级）**：卡车在地平线缩放到 0 时，`drawCar` 的固定像素内缩（`w-4`）变成负宽度，`A.draw.roundRect` 得到负圆角，Canvas `roundRect()` 抛 `RangeError`；异常发生在 `render()` 内使 rAF 永久停链，画面停在“车全部消失”的半帧。修复 `roundRect` 非负半径夹取与 `drawCar` 比例内缩；`createLoop` 增加逐帧异常兜底，单帧绘制错误不再冻结整局。同时回收 `z>2` 的隐形慢车，避免占满 18 车上限后不再发车。
- **极速车道远处车辆凭空放大**：`scaleAt` 旧公式在地平线为 0，而路面仍有 54px 宽；改为与路面同一条透视曲线（地平线保留 16.1% 车身），并在可见范围外 `z=1.02~1.52` 预生成车辆，进入视野时位置、速度与换道意图已确定。
- **贪吃蛇移动端操作不精准**：逻辑画布 420×740 → 360×430 棋盘优先（375×667 棋盘 180→273px），新增四枚 58px 方向按钮（`pointerdown` 即转向、与键盘/滑动同规则、拦截掉头），触屏隐藏重复 hint。
- **贪吃蛇提速太快**：20 个果实后的速度由 11.8 格/秒放缓到 7.7 格/秒（`max(0.12, 0.2−0.0035n)`）。
- **俄罗斯方块积分记录缺当次消去层数**：经典局写入 `lines`/`level`/`detail: "N 行 · Lv.x"`，中心页积分表详情列显示；禅模式与旧记录不变。

### Added
- 极速车道**转向灯换道**：非卡车随机打灯并线（signal 0.55s → moving 0.5s），车灯闪烁 + 车顶箭头 + 目标车道琥珀虚线导引 + 起灯提示音；目标车道被占或会堵死玩家逃生走廊时放弃；碰撞按连续 `lanePos` 判定。
- 极速车道娱乐点：连超（相邻车道超车累计，4.5s 窗口，≥3 连尾流加速）、加速带（3s +0.16，上限 1.2）、维修箱（+1 车况）、每 1000m 车流加密 5 秒、结算 `S+/S/A/B/C` 评价与“评价 · 最高连超 · 超车数”积分详情。
- 贪吃蛇挑战 HUD 移到顶栏，画布底部常驻本关目标。

### Verification
- `arcade_smoke.mjs` **89/89**（新增极速车道与贪吃蛇 2 项，方块追加消去层数断言）、`arcade_zen_scores_test.mjs` **14/14**、`arcade_gameplay_test.mjs --suite=base --repeat=2` **22/22**；`validate_site.py` / `build_site.py` / `node --check` 通过。
- 4× 快进 + 自动驾驶压力跑（约 3 分钟游戏时间）：0 console error、车流持续存在、转向灯车/加速带出现、最高连超 40、最高有效速度 1.20。
- 兼容：localStorage key/Schema、挑战数据与其余 10 款游戏不变；旧局内档缺新字段按保守默认恢复。
- 双端发布：提交 `bdb1176..ee9b45b`（5 个提交：`cf8979e` 极速车道 / `211d8ca` 贪吃蛇 / `16a2a8b` 方块积分 / `35394a2` 测试 / `ee9b45b` 文档）推送 `main`；Actions `44472286080` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **38/38** 文件 SHA-256 双端一致（Arcade `0.8.5` / Badge `2.2.1` / Venue `0.2.0`，manifest `application/manifest+json`）；双端线上无头 Chrome **20/20**（中心页 0.8.5 + 13 卡、SW `VERSION 0.8.5`、极速车道地平线车身 6.43×9.96px + 打灯车 0→1 完成、贪吃蛇棋盘 309px + 4×58px 按钮 + 向下转向、方块运行时 0.8.5、0 console error）；SW 缓存键 `studiokit-arcade-0.8.5-v1`。

## Arcade 0.8.4 — 2026-11-18（已发布）

### Changed
- 俄罗斯方块画布改为**棋盘优先 340×610**（井口 240×480 占画布 79% 高 / 71% 宽，0.8.3 为 65% / 57%）：右侧信息栏 100→76px、顶部信息带 46px、底部 84px 道具坞带；画布外道具行与触屏重复 hint 移除。经典棋盘占屏比 320 13.3%→25.2%、375 15.9%→28.3%、390 23.9%→40.0%、430 25.7%→40.7%，**棋盘面积 +58%～+89%，棋盘格边长 +26%～+36%**。
- 道具坞：经典/挑战 3 格（换块 / 慢落 / 暂停）、禅模式 4 格（+ ❄ 冻结提速），44px 高、≥44×44、单行不换行；快捷键 `1/2/Z` 与禁用态不变。
- 地铁单手暂停：暂停键为道具坞最后一格（屏幕约 78–85% 高度），并支持触屏双击画面任意位置暂停（320ms/30px，鼠标不触发）；顶部按钮、`P`/`Esc`、切后台自动暂停保留，共用 `pauseByUser()`。

### Fixed
- `shared/site.css` 门户 `.tool-icon`（46×46 图标卡）命中街机厅道具按钮同名 class，把 emoji 撑成方块；街机厅改用 `.tool-glyph`，13 款游戏道具按钮恢复 16px emoji。

### Verification
- `arcade_smoke.mjs` **87/87**（新增拇指区暂停/双击暂停 1 项）、`arcade_zen_scores_test.mjs` **14/14**、`arcade_gameplay_test.mjs --suite=base --repeat=2` **22/22**；`validate_site.py` / `build_site.py` / `node --check` 通过。
- 双端发布：提交 `77cb02a..ecfdda4`（3 个提交：`853739c` 道具坞 / `0756490` 地铁单手暂停 / `ecfdda4` 棋盘优先画布）推送 `main`；Actions `44122372096` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **38/38** 文件 SHA-256 双端一致（Arcade `0.8.4` / Badge `2.2.1` / Venue `0.2.0`，manifest `application/manifest+json`）；双端线上无头 Chrome **18/18**（中心页 0.8.4 + 13 卡、SW VERSION 0.8.4、方块页运行时 0.8.4、390×844 棋盘 257×513、道具坞 3 格含暂停 / 禅模式 4 格含冻结、触屏 hint 隐藏、0 console error）；SW 缓存键 `studiokit-arcade-0.8.4-v1`。
- 兼容：localStorage key/Schema（`progress/runs/prefs/playtime/challenge/scores`）、玩法、存档、积分记录与挑战记录全部不变；`#test` 钩子字段不变。

## Arcade 0.8.3 — 2026-11-15（已发布）

### Fixed
- Android 手机浏览器里 StudioKit 顶部导航条上方多出一条空白（Owner 实机反馈：浏览器报告约 40px 顶部安全区，但顶部实际已被浏览器 UI 占据）。共享 `.studiokit-shellbar` 现在只在独立窗口（安装到桌面/主屏幕）应用 `safe-area-inset-top`，并把安全区加在 38px 导航行之外；普通标签页保持 38px、文字垂直居中。
- `site-shell.js` 用 `display-mode: standalone` / `navigator.standalone` 判断独立窗口；`--studiokit-shellbar-h` 在 resize 时同步，旋转后游戏页扣减高度不再使用旧值。
- Arcade 版本全链升至 `0.8.3`（`ARCADE_VERSION`、注册表、中心页版本标记、SW `VERSION` 与缓存键 `studiokit-arcade-0.8.3-v1`），已装 SW 的用户会随版本刷新 `shared/site.css` 与 `site-shell.js`。

### Verification
- `arcade_smoke.mjs` **86/86**（新增浏览器模式安全区回归断言；独立窗口安全区断言改为真实 standalone 模拟，校验 38px 导航行 + 安全区与文字居中）；`arcade_zen_scores_test.mjs` 14/14、`arcade_gameplay_test.mjs --suite=base --repeat=2` 22/22；`validate_site.py` / `build_site.py` / `node --check` 通过。
- 双端发布：提交 `c1727e7` 推送 `main`；Actions `43670060561` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **37/37** 文件 SHA-256 双端一致，线上 Arcade `0.8.3` / Badge `2.2.1`；双端线上无头 Chrome 复测普通浏览器模式（模拟 40px 顶部安全区时 shellbar 仍为 38px、文字居中）与独立窗口（40+38=78px），SW 缓存键 `studiokit-arcade-0.8.3-v1`，0 console error。Owner 的那台 Android 浏览器仍建议发布后复测。

## Arcade 0.8.2 — 2026-11-13（已发布）

### Changed
- 俄罗斯方块控制区压缩（Owner 试玩反馈：按钮区占太多游戏画面）：删除禅模式独立按钮行，冻结/恢复提速并入道具行（同一行第 3 个按钮）；结束本局保留在暂停弹层；禅模式隐藏重复 hint；道具行按钮固定 44px、页面间距与底部留白压缩；画布高度规则回收空间。
- 实测禅模式画布面积相对同版本经典模式 **+18%～+47%**、相对 0.8.1 禅模式 **+41.6%～+126.8%**（320/375/390/430/桌面），画布高度比经典多 56–60px，四档与桌面 0 溢出；经典/挑战/存档/积分记录行为与 localStorage key/Schema 全部不变。

### Verification
- 门禁：`arcade_zen_scores_test.mjs` **14/14**（ZS-04 含控件压缩/画布增量断言）；`arcade_smoke.mjs` **85/85**；`arcade_gameplay_test.mjs --suite=base --repeat=2` **22/22**；`validate_site.py` / `build_site.py` / 全部 `node --check` / `git diff --check` 通过；取舍见 `apps/arcade/DESIGN-0.8.2.md`。
- 双端发布：提交 `077ccf5` 推送 `main`；Actions `43447829596` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **37/37** 文件 SHA-256 双端一致，线上 Arcade `0.8.2` / Badge `2.2.1`；双端线上无头 Chrome **14/14**（门户/中心页 0.8.2 + 13 卡 + 积分区；方块页经典画布 316×558、禅模式 348×614（+56）；3 个道具行按钮 44px、hint 隐藏、无独立按钮行；真实点击冻结按钮切换文案/aria；结算写 zen 记录且经典 high 不变）；SW 缓存键 `studiokit-arcade-0.8.2-v1`。iOS/Android 真机触控与低端机帧率仍 UNVERIFIED。

## Arcade 0.8.1 — 2026-11-13（已发布）

### Added
- 俄罗斯方块禅模式：开始弹层第三入口「🧘 禅模式」，无限游玩（不设 40 行收局与关卡终点）；速度随等级提升，键盘 `Z` / 画布下方「❄ 冻结提速」可停止速率增加，「▶ 恢复提速」立即追平当前等级；顶栏与画布内禅模式 HUD、暂停「结束本局并记录」与井口结束结算；禅模式局内状态写入既有 `runs:v1` data，刷新可恢复；不写经典最高分。
- 中心页积分记录表：新增 `A.Scores` 与独立存储 `studiokit:arcade:scores:v1`（Schema v1，最新在前、最多 300 条）；13 款游戏统一结算点自动收集经典积分，禅模式结算追加 `mode:'zen'` 记录；中心页「游玩统计」之后新增表格（时间 / 游戏 / 模式 / 得分 / 详情），支持游戏与模式筛选、单独清除、导出/导入。
- 0.8.1 设计/契约：`apps/arcade/DESIGN-0.8.1.md`、`docs/arcade/0.8.1-CONTRACT.md`、`docs/arcade/0.8.1-REVIEW.md`。

### Changed
- `ARCADE_VERSION`、注册表、中心页版本标记与 Service Worker 缓存键统一升至 `0.8.1`；共享弹层支持可选第三按钮（其他游戏零改动）。
- 测试新增 `tools/arcade_zen_scores_test.mjs`（14 场景）；`arcade_smoke.mjs` 85/85 与 `arcade_gameplay_test.mjs --suite=base --repeat=2` 22/22 保持零回归。

### Compatibility
- `progress:v1` / `runs:v1` / `prefs:v1` / `playtime:v1` / `challenge:v1` 的 key 与 Schema 全部未变；只新增 `scores:v1`。旧备份导入时保留当前积分记录；损坏积分数据读取 fail-closed；禅模式不改变经典最高分与挑战记录。

### Verification
- 发布前独立评审：**APPROVE-WITH-NOTES / 0 Blocker / 2 Major / 8 Minor / 9 UNVERIFIED**（`docs/arcade/0.8.1-REVIEW.md`）；2 Major（发布声明时序、320/375 窄屏禅模式入口被裁剪）与相关 Minor 已在发布前修复/记录。
- 门禁：`arcade_zen_scores_test.mjs` **14/14**（含新增四档三入口可见断言）；`arcade_smoke.mjs` **85/85**；`arcade_gameplay_test.mjs --suite=base --repeat=2` **22/22**；`validate_site.py` / `build_site.py` / 全部 `node --check` / `git diff --check` 通过；commit-time-policy 2/2 合规。
- 双端发布：提交 `575a766`（功能）+ `41fa79e`（评审修复）推送 `main`；Actions `43423208129` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 四个 job 全部成功；`tools/verify_deploy.py` **37/37** 文件 SHA-256 双端一致，线上 Arcade `0.8.1` / Badge `2.2.1`；双端线上无头 Chrome **10/10**（门户/中心页/积分记录区/方块页 0.8.1/禅模式无限/冻结恢复/结算不污染最高分/中心页表格显示禅记录）；SW 缓存键 `studiokit-arcade-0.8.1-v1`。iOS/Android 真机触控、30 分钟以上长局与真人理解度仍 UNVERIFIED。

## Arcade 0.8.0 — 2026-11-13（已发布）

### Added
- 影跃：空中影冲（每次着陆补充一次，Shift/J + 独立触屏按钮）与「影之试炼」挑战模式（影门出口、失败 1 次点击重试、可选卷轴、双路线、失败复盘）；0.8 试炼随后迁移为 0.9 设计包的 C01–C06。
- 挑战模式：导入 Owner 0.9 关卡设计包（13 游戏 × 6 关 = 78 关），每款游戏新增第二种入口「挑战 6 关」：固定盘面/地图/时间轴/车流/障碍/砖阵/铃序/委托/波次/矿图，选关解锁、记录/最佳/assisted/收集、暂停退出、1 次点击重试。
- 平台：`A.Challenge` 共享 API 与独立记录 key `studiokit:arcade:challenge:v1`（导出/导入/清除兼容）；`tools/arcade_09_data.mjs` 校验设计包并幂等生成 13 个运行时数据；挑战 UI 共享样式与 SW 预缓存。

### Changed
- `ARCADE_VERSION`、注册表、中心页版本号与 Service Worker 缓存统一升至 `0.8.0`。
- 影跃 0.8 `mode:'trial'` 旧档安全降级（映射 C01–C03 或提示重开，不静默删档）。

### Compatibility
- `progress:v1` / `runs:v1` / `prefs:v1` / `playtime:v1` 的 key 与 Schema 均未改变；挑战局状态只追加在 `runs:v1` 的 `data`，挑战记录使用独立 `challenge:v1`；挑战不写经典最高分与 Playtime 轮次。

### Verification
- `validate_site.py` / `build_site.py` / 全部 `node --check`（含 13 页内联脚本）通过；`arcade_smoke.mjs` **85/85**；`arcade_gameplay_test.mjs --suite=all --repeat=2` **208/208**（798s）；78 关设计与运行时数据门禁、13 游戏经典入口门禁 PASS；`tools/arcade_09_data.mjs` 重跑字节一致。
- 独立 Reviewer：APPROVE-WITH-NOTES / 0 Blocker（5 项设计差量需 Owner 裁决）；原生 CDP 独立实玩 47/47。
- 双端发布：提交 `95a063f` 推送 `main`；Actions `43369758813` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 四个 job 全部成功；`verify_deploy.py` 37/37 文件 SHA-256 双端一致（含 13 个挑战数据脚本），线上 Arcade `0.8.0` / Badge `2.2.1`；双端线上无头 Chrome 12/12。iOS/Android 真机手感与 Owner 两轮试玩仍 UNVERIFIED。

## Arcade 0.7.0 — 2026-11-13（已发布）

### Added
- 13 款游戏全部增加由玩家主动使用的局内道具（每款 2 个；黄金矿工保留原有 4 个并重新平衡），共享 `A.createToolbelt` 统一 UI、次数、禁用态与可选快捷键；没有商店、货币、签到、每日奖励或付费抽奖。
- 自然收尾与即时反馈：2048 合成 2048 后的胜利结算、砖块计划第 3 关圆满收局、重力翻转 3000m 星门、贪吃蛇 20 果实丰收、俄罗斯方块新局 40 行、星海 Boss 击破后的「下一关 / 圆满收局」、极速车道 5000m 终点；以及记忆跳过预览、地鼠得分跳字、影跃落点提示、层塔落点偏差、矿工夹中收益提示等。
- 中心页 🎲「惊喜一下」随机打开一款游戏（连续点击不重复上一款，不附奖励）；页脚「快乐约定」说明无签到/无每日目标。
- 单个游戏页有效游玩累计 20 分钟后的一次性温柔休息提醒：不自动暂停、不反复催促、不写入存储。
- `apps/arcade/DESIGN-0.7.0.md` 记录产品原则、每款数值、兼容与回滚。

### Changed
- `ARCADE_VERSION`、注册表、中心页版本号与 Service Worker 缓存统一升至 `0.7.0`。
- 黄金矿工两项减少浪费的重平衡：瞄准线只在钩爪摆动时计费；强力绞盘改为夹物成功入账才扣次数。

### Compatibility
- `progress:v1` / `runs:v1` / `prefs:v1` / `playtime:v1` 的 key 与 Schema 均未改变；新字段只追加在各游戏 `runs:v1` 的 `data` 内，旧档缺字段按初始补给恢复，存在字段逐项 clamp。

### Verification
- `validate_site.py` / `build_site.py` / `node --check` 与扩展后的 `arcade_smoke.mjs` 通过（共享道具栏、一次性提醒、随机入口、13 款道具真实效果、13 款旧档补给、320/375/390/430 + 横屏 + 安全区、PWA/断网），套件连续两次 85/85。
- 独立复审提出的两个 Major（画布内道具栏遮挡、旧无尽档被强制收尾）已修复并加入回归；`verify_deploy.py` 双端校验清单扩到 24 个文件。
- 提交 `34f03df` 推送 `main`；Actions `43274342320` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 全部成功。
- GitHub Pages <https://shawlaw.github.io/studiokit/> 与 Cloudflare Pages <https://studiokit.pages.dev/> 双端 24/24 关键文件 SHA-256 一致；线上 Arcade `0.7.0` / Badge `2.2.1`。iOS/Android 真机试玩与原生全屏仍 UNVERIFIED。

## Arcade 0.6.2 — 2026-11-12

### Fixed
- 黄金矿工：目标金额统一取整。瞄准线按秒扣费会留下小数，之前提前结算进入下一关时会把小数带进目标，HUD/结算出现很长的数字；现在关卡起点按 HUD 显示的整数金额计算，旧档中的小数目标在恢复时也会取整。
- 黄金矿工 HUD 可读性：画布顶部增加深色渐隐背景，金额/关卡/倒计时改用高对比浅色；DOM 子 HUD 的「目标」改为金色胶囊并放大数字，窄屏下仍保持单行。
- 俄罗斯方块：触屏按钮从五键等宽横排改为左右手分区——左手 `←` / `→` 大键横移，右手 `↻` 旋转、`↓` 加速、`⇓` 落底；按钮增高到 64px（320px 下 58px），加入图标 + 文字标签、分组间距与落底实心金色强调，支持左手横移与右手加速双指同按。
- 俄罗斯方块：`加速` 按住按 0.06s/格逐格下落、不立即锁定；`落底` 点按立即锁定并触发短促下沉/金色脉冲/低沉音效，支持的设备附带 16ms 轻震；提示统一为“↓ 按住加速 · ⇓ 点按落底”。
- 俄罗斯方块：移除画布隐藏触摸区（左右半屏横移、中列旋转、底部软降）；点按/按住画布不再误移动或误软降。DAS/ARR 自动连移不再逐格播放 UI 音效。

### Changed
- `ARCADE_VERSION`、`shared/tool-registry.json`、中心页版本号与 Service Worker 缓存统一升至 `0.6.2`；已安装 PWA 会获取新引擎。
- 新增 `apps/arcade/DESIGN-block-controls.md`，记录触屏按钮布局、兼容与回滚边界。

### Verification
- `validate_site.py` / `build_site.py` / `node --check`（home、site-shell、engine、sw）通过。
- `arcade_smoke.mjs` 66/66：覆盖按钮顺序/标签/尺寸/分组、多指同按、画布不劫持、黄金矿工目标取整、320/375/390/430 与安全区。
- GitHub Pages 与 Cloudflare Pages 双端逐文件 SHA-256 一致；线上运行时验证结果见 T031。

### Release
- 提交 `0159437`；Actions `43155182519` 的 `Validate and build`、`Deploy GitHub Pages`、`Deploy Cloudflare Pages`、`Verify both deployments` 全部成功。
- GitHub Pages <https://shawlaw.github.io/studiokit/> 与 Cloudflare Pages <https://studiokit.pages.dev/> 双端 11/11 关键文件 SHA-256 一致；Arcade `0.6.2` / Badge `2.2.1`。

## Site — 2026-11-12

### Added
- 根目录新增 `LICENSE`（MIT，Copyright (c) 2026 Shawlaw）；README 增加源码入口与「许可」说明（含品牌/商标保留与商业使用边界）。
- 门户页头与所有工具页的共享导航条新增「源码」链接，指向 <https://github.com/Shawlaw/studiokit>，新标签页打开并带 `rel="noopener noreferrer"`。

### Changed
- `shared/site-shell.js`：右侧改为操作区容器；窄屏只隐藏 `LOCAL-FIRST TOOLS` 标语，源码链接保留；工具名过长时省略，不再撑宽导航条。
- `tools/validate_site.py`：`LICENSE` 纳入必检文件，新增 MIT 文本、两处源码链接与 `rel=noopener` 校验。
- `docs/DECISIONS.md`：新增 ADR-0005，记录 MIT 取舍、商标保留与后续换协议的前提。
- `docs/ARCHITECTURE.md`：补充共享 shell 现在同时提供源码入口。

### Verification
- `validate_site.py` / `build_site.py` / `node --check shared/site-shell.js` / `node --check shared/home.js` 通过。
- `arcade_smoke.mjs` 66/66（含 320/375/390/430 无横向溢出与刘海安全区 shellbar 高度）。
- CDP 实测 320/390/430：shellbar 高度 38px、`scrollWidth` 等于 `innerWidth`，门户/徽章工作台/街机厅/黄金矿工页链接 `href`、`target="_blank"`、`rel="noopener noreferrer"` 正确；截图复核页头与导航条排版。
- 随 Arcade 0.6.2 发布（提交 `0159437`，Actions `43155182519`），双端逐文件校验通过。

## Arcade 0.6.1 — 2026-11-12

### Fixed
- 星海突击：Boss 从顶部入场穿过时不再与贴顶玩家发生机体碰撞，入场完成前也不会发射弹幕；避免刚进入 Boss 战就被无预警撞掉一条命。
- 回归：Boss 清关断言增加生命 +1 校验，`arcade_smoke.mjs` 仍为 66/66。

### Changed
- `ARCADE_VERSION` / Service Worker 缓存版本升至 `0.6.1`，已安装 PWA 会获取修复后的引擎。

### Release
- 提交 `1c9501e`；Actions `43060497094` validate + build + deploy 成功。
- 线上 <https://shawlaw.github.io/studiokit/apps/arcade/> 验证 0.6.1：Boss 清关生命 3→4、入场无碰撞、叠加/移动/瞄准线/显式全屏与缓存 0.6.1 均通过；iOS/Android 真机仍 UNVERIFIED。

## Arcade 0.6.0 — 2026-11-12

### Added
- 星海突击：每 30 秒普通波次后进入关卡 Boss 战，Boss 有独立血条与三档火力，击破后生命 +1、掉落 3 份 Buff 并进入下一关。
- 星海突击：散射 / 激光 / 追踪 / 速射改为可叠加，普通弹始终发射，HUD 同时显示各 Buff 剩余时间。
- 星海突击：玩家可在整屏纵向移动（46–714，仅避开顶部 HUD）。
- 黄金矿工：第四个道具「瞄准线」（快捷键 4），显示当前钩爪方向与首个命中物，开启后每秒扣 $2，余额不足自动关闭。

### Fixed
- 黄金矿工：连续使用「指哪打哪」后摆幅变小、摆速变慢。摆角与钩爪朝向分离，瞄准只改伸出方向，收钩后恢复原摆动能量；旧档缺少朝向时回退到摆角。
- 全屏：移除“点开始/继续弹层任意位置自动全屏”的 0.4.0 行为，只有 `⛶` / `F` / 弹层按钮显式进入；`prefs.immersive` 仍记录但不再劫持普通触控。
- 中心页「继续上次」长摘要在 320px 撑宽页面：续玩卡片补 `min-width:0`。

### Verification
- `validate_site.py` / `build_site.py` / `node --check` 通过。
- `arcade_smoke.mjs` 66/66：新增矿工摆动能量、瞄准线计费、星海弹种叠加、Boss 清关、全屏移动、点开始不自动全屏与 320px 道具条宽度检查。
- 线上 0.6.0 无头浏览器验证：13 卡、PWA installability 0 错误、缓存键 `studiokit-arcade-0.6.0-v1`、预载 24/24、叠加/移动/Boss/瞄准线/显式全屏与零 JS 错误通过；iOS/Android 真机、系统分享与原生全屏仍 UNVERIFIED。

### Release
- 提交 `6debd77`；Actions `43057971576` validate + build + deploy 成功。
- 线上 <https://shawlaw.github.io/studiokit/apps/arcade/> 已更新到 0.6.0。

## Arcade 0.5.1 — 2026-11-11

### Fixed
- 游玩统计在连续游玩超过 15 秒后停止累计：15 秒定时落盘关闭了当前时间片却没有重新开启，导致第一次落盘后必须暂停/切后台/重新聚焦才继续计时。现在每次落盘后立即开启下一段时间片；暂停、失焦、后台、开始界面仍不计时。
- 修复前的历史统计不会自动补回；需要干净数据时可清除对应游戏记录。

### Changed
- Service Worker 缓存版本升至 `0.5.1`，已安装 PWA 会获取新的 `engine.js`，不会继续使用 0.5.0 的旧缓存。
- 数据 Schema 不变：仍为 `studiokit:arcade:playtime:v1`（Schema v1）及既有 progress/runs/prefs key。

### Verification
- `validate_site.py` / `build_site.py` / `node --check` 通过。
- `arcade_smoke.mjs` 63/63，新增连续游玩 17 秒的回归检查（手动 flush 后 ≥16 秒）。
- 线上 0.5.1 无头浏览器验证：13 卡、PWA installability 0 错误、缓存键 `studiokit-arcade-0.5.1-v1`、预载 24/24、连续游玩 17 秒实测 `17012ms`、矿工连续瞄准与零 JS 错误均通过。

### Release
- 提交 `6739521`；Actions `43008560646` validate + build + deploy 成功。
- 线上 <https://shawlaw.github.io/studiokit/apps/arcade/> 已更新到 0.5.1。iOS/Android 真机安装、系统分享面板与原生全屏仍 UNVERIFIED。

## Arcade 0.5.0 — 2026-11-11

### Added
- 游玩统计：中心页累计/今日/近 7 天时长、完成轮次、7 日柱状图、分游戏时长与最近 30 轮明细；只统计真实游玩时间（暂停/切后台/开始界面不计）。
- `studiokit:arcade:playtime:v1`（Schema v1）；导出/导入备份新增可选 `playtime`，旧备份兼容。
- 分享：中心页合集链接 + 游戏弹层单游戏深链；系统分享优先，剪贴板兜底。
- PWA：`manifest.webmanifest`、`sw.js`、192/512/maskable/Apple Touch 图标；中心页可安装到桌面。
- 离线预载：显式缓存中心页外壳 + 13 款游戏，显示进度；断网可开已预载内容，未预载页显示提示。
- `apps/arcade/DESIGN-0.5.0.md`：统计、分享、缓存策略、兼容与回滚说明。

### Changed
- `ARCADE_VERSION`、注册表、README/CHANGELOG 同步到 0.5.0；既有 progress/runs/prefs key 与 Schema 不变。
- 单游戏清除/全部清除同步清理游玩统计；导入失败回滚 progress/runs/playtime 三个 key。

### Fixed
- 黄金矿工：连续使用「指哪打哪」锁定正下方物品后，摆角被设为 0、角速度清零，收钩回到摆动状态会停在垂直平衡位不再左右摆动。现在瞄准时保留同侧最小角速度，收钩和旧档恢复时也会补起步能量。

### Verification
- `validate_site.py` / `build_site.py` / `node --check` 通过。
- `arcade_smoke.mjs` 63/63：计时与暂停排除、轮次明细、汇总展开、备份兼容、分享兜底、manifest/SW、预载 24 项、停服务器后的中心页/游戏离线打开与未预载提示、矿工连续瞄准三次后恢复摆动。
- 线上运行时验证：13 卡 / PWA 可安装（installability 0 错误）/ SW scope `/studiokit/apps/arcade/` / 预载 24-24 / 矿工连续三轮瞄准后摆角变化 0.4+ / 零 JS 错误。

### Release
- 功能提交 `b8abe41`、摆钩修复 `c8c049d` fast-forward 合入 `main`。
- Actions `42974993445` validate + build + deploy 成功。
- 线上 <https://shawlaw.github.io/studiokit/apps/arcade/> 验证 0.5.0；iOS/Android 真机安装、系统分享面板与原生全屏仍 UNVERIFIED。

## Arcade 0.4.0 — 2026-11-10

### Added
- 13 款游戏共享全屏/沉浸模式：顶栏 `⛶`、开始/暂停弹层入口、键盘 `F`；支持 Fullscreen API 时请求原生全屏并尝试锁定竖屏，不支持或被拒绝时退化为 CSS 沉浸布局（iPhone Safari 走此路径）。
- 全屏偏好记忆：`studiokit:arcade:prefs:v1` 新增 `immersive`，下次从开始/继续弹层进入时自动恢复；主动退出后不再强制。
- 黄金矿工限量道具：🎯 指哪打哪、⏳ 加时 10 秒、💪 强力绞盘；触屏按钮与快捷键 `1 / 2 / 3`，通关按关补给、设上限。
- `apps/arcade/DESIGN-0.4.0.md`：全屏/道具设计、数值、兼容、验收和回滚说明。

### Changed
- 黄金矿工首关摆速由 520 降到 300，随后 380 / 470 / 580 / 700，无尽关 +80/关、上限 1300。
- 道具状态写入既有局内档 Schema v1（`data.tools` / `data.winchArmed`）；旧档缺字段时按初始补给恢复，物品坐标会被抬到道具条上方。
- 手机顶栏为全屏按钮腾位：≤460px 隐藏 DOM HUD、返回链接收成箭头、压缩间距；画布内 HUD 保留，最高分在中心页/结算查看。

### Fixed
- 道具条按实际高度动态计算物品下限，320px 小屏、全屏切换、地址栏收放和旧档恢复都不会把物品压在道具条后面。
- 达标提示按钮从固定视口底边移到画布内、道具条上方；钩爪不再伸到道具条后面。
- 旋转/全屏切换后画布尺寸延迟重算；指针状态增加 `seen` 字段，供瞄准预览使用。

### Release
- 提交 `49bc1aa`（功能）、`1b9ce14`（任务归档）fast-forward 合入 `main`。
- GitHub Actions `42846474565`、`42848635797` 均 validate + build + deploy 成功。
- 线上 <https://shawlaw.github.io/studiokit/apps/arcade/> 验证 0.4.0 / 13 卡 / 全屏与道具可用；`arcade_smoke.mjs` 57/57。

### Docs
- 根目录 README、START-HERE、ARCHITECTURE、ROADMAP、BASELINE、RELEASE-RUNBOOK、DECISIONS、CONTRIBUTING 与 AGENTS 项目事实同步到当前 0.4.0 状态。

## Arcade 0.3.2 — 2026-11-09

### Fixed
- 黄金矿工：夹中的物品只跟随钩爪绘制，原位置不再重复显示。
- 记忆翻牌：改为 6 关由少到多（6→24 张），预览时间 3.2→1.8 秒平滑递减。

### Release
- `tools/arcade_smoke.mjs` 扩至 51 项；提交 `2df2dbd` 经 fast-forward 合入 `main` 并发布。

## Arcade 0.3.1 — 2026-11-09

### Changed
- 按游戏性评审完成公平性、移动端输入和生命周期打磨：多指隔离、pointercancel/失焦清理、44px 暂停按钮、safe-area、移除全页 `user-scalable=no`。
- 雪铃去重、影跃可达平台、星海波次上限、赛车安全走廊、层塔落点投影、黄金矿工前 5 关独立配置。
- `tools/arcade_smoke.mjs` 扩至 49 项。

### Release
- 独立 Reviewer A/B/C/D 复核无 Blocker/Major；`793a6fd` fast-forward 合入 `main`，Actions `42565028915` 成功。

## Arcade 0.3.0 — 2026-11-09

### Added
- 街机厅扩至 13 款竖屏游戏，新增记忆翻牌、2048、砖块计划、重力翻转、贪吃蛇、打地鼠。
- 局内进度自动保存与「继续上次」；中心页搜索、类型筛选、只看玩过、排序、续玩区和 JSON 导出/导入。
- 共享运行时新增 `RunSave`、`createRunAutosave`、`createOverlayUi`、`bindPause`、`showResumePrompt`。

### Release
- 版本 0.3.0 发布；提交 `aba11a9`，Actions `42501786872` 成功。

## Arcade 0.2.0 — 2026-11-08

### Added
- 俄罗斯方块、极速车道、黄金矿工三款 GBA 风格复刻，街机厅扩至 7 款。
- 全部游戏支持键盘 + 触摸双输入；俄罗斯方块触屏按钮面板、车道变道按钮。

## 0.1.0 — 2026-10-31

### Added
- 建立 StudioKit 静态多工具 Monorepo。
- 增加统一门户、工具注册表和工具页共享导航。
- 纳入 Badge Studio v2.2.0；发布前默认示例改为中性内容并升到 v2.2.1。
- 增加单页工具模板、新工具脚手架、站点校验与静态构建脚本。
- 增加 GitHub Pages Actions 部署流程与 Flash Agent 工作约定。

### Fixed
- 共享导航条注入后把实测高度写入 `--studiokit-shellbar-h` CSS 变量；Badge Studio 桌面端视口高度计算扣除该变量，消除 38px 垂直溢出。
- 工具注册表 planned 项版本号改为空字符串，避免门户卡片渲染出 "v—" 徽标。

### Notes
- Rounded Image 仅列入规划，当前版本不包含该工具实现。
