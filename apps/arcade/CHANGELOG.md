# Arcade Changelog

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
- 文档：新增 `apps/arcade/DESIGN-0.8.2.md`（前后对比/兼容/回滚）与 `docs/arcade/0.8.2-CONTRACT.md`、`docs/arcade/0.8.2-REVIEW.md`。
- 发布：提交 `077ccf5` 推送 `main`；Actions `43447829596` 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **37/37** 文件 SHA-256 双端一致（Arcade `0.8.2` / Badge `2.2.1`）；双端线上无头 Chrome **14/14**（门户/中心页 0.8.2 + 13 卡 + 积分区、方块页经典画布 316×558 → 禅模式 348×614（+56）、3 个道具行按钮 44px、hint 隐藏、真实点击冻结按钮切换文案/aria、结算写 zen 记录且经典 high 不变）；SW 缓存键 `studiokit-arcade-0.8.2-v1`。
- 未验证：iOS/Android 真机触控手感与低端机帧率仍为 UNVERIFIED；窄屏 5 键触控面板高度保持不变（为保证「加速/落底」精度）。

## 0.8.1 — 2026-11-13（已发布）

0.8 系列的功能补充版本：俄罗斯方块新增**禅模式**（无限游玩 + 用户可冻结提速），中心页新增**积分记录表**（跨游戏收集并展示每局积分）。既有 5 个 localStorage key 与 Schema 不变，只新增 `studiokit:arcade:scores:v1`。

- 平台：新增 `window.Arcade.Scores`（`studiokit:arcade:scores:v1`，Schema v1：`{ at, gameId, mode, score, lines, level, durationMs, detail }` 最新在前、最多 300 条；`record/list/stats/modeLabel/exportData/importData/resetGame/resetAll`；损坏数据读取 fail-closed，不删除原值）。`A.Progress.recordPlay(gameId, score, meta)` 扩展为模式感知：所有 13 款游戏的统一结算点自动收集经典积分；`mode:'zen'` 时**不更新经典最高分**；`Playtime.recordRound` 返回本轮时长供积分记录使用。导出备份新增 `scores`，旧备份（无 `scores`）导入时保留当前积分记录；`Progress.resetGame/resetAll` 同步清理积分。共享弹层新增可选第三按钮 `btn3`（不提供时其他游戏行为不变）。
- 俄罗斯方块禅模式：开始弹层第三入口「🧘 禅模式」→ 无限局（无 40 行收局、无关卡终点）；速度随等级提升，按 `Z` 或画布下方「❄ 冻结提速」后速度停在当前等级、等级与行数继续累计，恢复时立即追平 `level`；HUD（顶栏 `data-hud-zen` + 画布井顶 `ZEN · 速度 Lv.x`）；暂停弹层「结束本局并记录」与井口结束共用同一结算（「禅模式结束」、不显示失败），结算仅一次写入积分记录；禅模式局内状态写入既有 `runs:v1` 的 `data`（`mode:'zen'` / `zenFrozen` / `zenSpeedLevel` / `zenElapsed`），刷新可恢复冻结状态与速度，旧档缺 `mode` 仍按经典恢复。
- 中心页积分记录表：「游玩统计」之后新增区块（时间 / 游戏 / 模式 / 得分 / 详情），按游戏与模式筛选，最新在前、最多展示最近 50 条，空状态与“仅显示最近 50 条”提示；单独「清除积分记录」只清 `scores:v1`，不影响最高分、游玩时长、局内进度与挑战记录；单游戏清除/清除全部/导入导出提示同步。
- 版本：`ARCADE_VERSION`、注册表、中心页版本标记与 Service Worker 缓存键统一升至 `0.8.1`（`studiokit-arcade-0.8.1-v1`）。
- 测试：新增零依赖 `tools/arcade_zen_scores_test.mjs`（14 场景：禅模式无限/冻结恢复/结算积分/表格筛选清除/导入导出/旧档与损坏兼容/320–430 布局，含四档开始弹层三入口完整可见断言）；`arcade_smoke.mjs` 85/85、`arcade_gameplay_test.mjs --suite=base --repeat=2` 22/22 零回归；独立评审 APPROVE-WITH-NOTES，发布前修复 320/375 窄屏禅模式入口被裁剪（M2）及相关 Minor。
- 文档：新增 `apps/arcade/DESIGN-0.8.1.md`（设计/数值/数据模型/兼容/回滚）与仓库内 `docs/arcade/0.8.1-CONTRACT.md`（并行实施契约）、`docs/arcade/0.8.1-REVIEW.md`（独立评审与 Lead 处理记录）。
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
