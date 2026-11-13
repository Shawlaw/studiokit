# Changelog

StudioKit 门户本身没有独立的 semver；以下按仓库里程碑与工具版本记录。各工具的详细变更见 `apps/<tool>/CHANGELOG.md`。

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
