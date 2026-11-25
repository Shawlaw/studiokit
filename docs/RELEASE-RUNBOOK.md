# Release Runbook

## 当前发布状态

- 仓库：<https://github.com/Shawlaw/studiokit>
- GitHub Pages：<https://shawlaw.github.io/studiokit/>
- Cloudflare Pages：<https://studiokit.pages.dev/>
- Arcade `0.19.0` 已于 2026-11-25 双端发布，发布提交 `f8d7e7b`（含与 0.18.2 的合并及合并后修复）。矮视口紧凑模式、拇指区暂停、恢复门、结算防误触与逐游戏单手手感。
  - [Actions 发布记录](https://github.com/Shawlaw/studiokit/actions/runs/45554384478) 四项任务全部成功；`tools/verify_deploy.py` 双端各 87/87 文件与本地产物一致，arcade 0.19.0 / badge 2.2.1 / venue 0.2.0。
  - 合并后复验：聚合门禁与 4 个独立门禁串行跑完；P16 预载迁移缺陷与 CT-18 断言随机性已修复，最终树上离线 18/18、compact_touch 两轮 18/18、冒烟 117/117、PWA 更新 9/9；明细见 `apps/arcade/DESIGN-0.19.0.md` 第 5.1 节。
  - 线上运行时检查（无头 Chrome，375×548）：两个站点的中心页均为 0.19.0、16 张卡；记忆翻牌「开始游戏」首屏可见、无页面溢出、无 console error。真机手感 UNVERIFIED。
- Arcade `0.18.2` 已于 2026-11-25 双端发布，提交 `fd064ee`。修复预载后断网跨页，并迁移 0.18.1 已缓存的游戏页。
  - [Actions 发布记录](https://github.com/Shawlaw/studiokit/actions/runs/45520196313) 四项任务通过，两个正式站点及 Cloudflare 部署地址的 87/87 项文件一致。本地逐文件复验确认两个正式站点各 87/87 项与发布产物相符。
  - 冒烟 117/117、离线 18/18、PWA 更新 9/9。Chromium 模拟两种部署路径从 0.18.1 更新，关停服务器后可打开首页、进入黄金矿工并返回。手机真机待验证。
- Arcade `0.18.1` 已于 2026-11-24 双端发布，提交 `5c16586`。包含首页续玩与排序记忆、触控与游戏返回、生涯首页切换。
  - 四项部署任务成功。两端各 87/87 项文件哈希与本地发布产物一致。见 [Actions 发布记录](https://github.com/Shawlaw/studiokit/actions/runs/45427632073)。
  - 冒烟 117/117。双端 Chromium 确认页面与 SW 都是 0.18.1，俄罗斯方块可在拇指区暂停，从顶栏返回街机厅后直接续玩。用正式产物复验从 0.18.0 手动检查更新、刷新与保留旧存档。部署切换期间，GitHub Pages 的旧页检测到 0.18.1，首次刷新确认超时。
- Arcade `0.18.0` 已于 2026-11-24 双端发布，包含星塔回响与生涯 96 份委托。提交 `cfd8119` 的四个部署任务全部成功。见 [Actions 发布记录](https://github.com/Shawlaw/studiokit/actions/runs/45411473922)。
- 更早发布的 Arcade `0.13.3`（2026-11-22）
  - 批次内容：Cloudflare Pages 无后缀 URL 下的游戏识别修复（计时全 0 根因）；测试服务器新增无后缀回退、smoke 108 → 109；无 key/Schema 变更；保留 `apps/arcade/diag.html` 供真机复验
  - 发布：提交 `b3a8c7e` 推送 `main`；Actions run `45007754972` 四 job 全绿；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.13.3 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 实测：CF 无后缀 URL `currentGame=block-drop`、游玩 1.6s 记到 1606ms，GH `.html` 正常，诊断页 iframe 显示「计时正常 3508ms」，0 console error；真机 iOS 复验待 Owner（UNVERIFIED）
- 最近发布：Arcade `0.13.2`（2026-11-22，已双端发布）
  - 批次内容：PWA「检查更新」显示已安装版本修复（版本来源改为线上 `sw.js` 的 VERSION + SW 激活广播修复 + 横幅双版本 + 读取失败诚实提示）+ iOS 主屏 PWA 游玩时长永久停摆修复（Playtime 自愈）；无 key/Schema 变更
  - 发布：提交 `8493cf7`（PWA 更新检测）+ `78858e0`（游玩时长 + 文档）ff 合入 `main`（`a98cb3d..78858e0`）；Actions run `45002523350` 四 job 全绿（Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments）；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.13.2 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 各 8 项全过（中心页 0.13.2 + 16 卡 + 检查更新按钮、SW 握手 0.13.2、`checkForUpdate` 返回线上 0.13.2 且不误报、线上 `sw.js` 含升级广播修复、缓存键 `studiokit-arcade-0.13.2-v1`、游戏页可加载、0 console error）；真机 iOS 更新提示时机与游玩时长待 Owner 复测（UNVERIFIED）
- 最近发布：Arcade `0.13.1`（2026-11-22，已双端发布）
  - 批次内容：星海突击真机反馈修复——大杀器栏并入主道具行（iPhone 非全屏 PWA 可见，空槽常显）、核弹追踪弹命中后爆炸（无 Boss 飞画面中央）、机动强化改为受击无敌 + 拾取吸附（触屏有效，engine id 不变）、机库浏览不再计入游玩时长；挑战 6 关零改动，无新增 key/Schema
  - 门禁：smoke **105/105**、tower **23/23**、star-raid 挑战 **7/7**、tower 挑战 **6/6**、gameplay base 11/11、zen 17/17、calm 7/7、review 5/5、pwa 7/7、interaction 5/5、immersive 32/32、320–430 + standalone 布局 43/43、validate/build/inline/design 全过
  - 设计见 `apps/arcade/DESIGN-0.13.1.md`；提交 `01eb5b4` 推送 `main`；Actions run `44996450758` 四 job 全绿（Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments）；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.13.1 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 实测：中心页 0.13.1、主道具行 5 列（3 主动 + 2 军械槽，空槽「军械」）、390×844 standalone 模拟行底 ≤ 视口、核弹发射后 0.26s 仍在飞行且 Boss 480 血不变、命中后 Boss 354 血 + flash 0.70 + 冲击波 2 + 0 console error；SW 缓存键 `studiokit-arcade-0.13.1-v1`。
- 最近发布：Arcade `0.13.0`（2026-11-22，已双端发布）
  - 批次内容：星海突击「星域远征」——机库永久改装 + 星币（引擎通用游戏数据 `studiokit:arcade:meta:v1`，`A.GameMeta`，备份 `gameMeta`）、局内火力 1–5、能量/枯竭、临时编队、核弹/轨道炮/时空锚、6 星区主题与分数补偿、CLEAR 三选一整备、动画反馈；挑战 6 关数据与判定零改动；基于 0.12.7 层塔重标定 rebase 后共存无回归
  - 门禁：smoke **103/103**、tower **23/23**、star-raid 挑战 **7/7**、tower 挑战 **6/6**、gameplay base 11/11、zen 17/17、calm 7/7、review 5/5、pwa 7/7、interaction 5/5、immersive 32/32、validate/build/inline/design/stage coverage 全过
  - 设计见 `apps/arcade/DESIGN-0.13.0.md`；提交 `faf1772` 推送 `main`；Actions run `44990933121` 四 job 全绿（Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments）；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.13.0 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 实测：中心页 0.13.0 + 16 卡、`A.GameMeta`（key `studiokit:arcade:meta:v1`）、6 星区主题、机库/编队入口、核弹清弹与 Boss 480→360、CLEAR 三选一整备、0 console error；SW 缓存键 `studiokit-arcade-0.13.0-v1`。
- 最近发布：Arcade `0.12.7`（2026-11-22，已双端发布）
  - 批次内容：层塔难度按人类计时能力重标定——0.12.5 把上限推到 4000 导致封顶层完美窗口只剩 24~28ms（1.4~1.7 帧，低于一次显示刷新，也远低于手机触摸→显示延迟）；现上限 1500、起始 g 560、斜率 4/8（146 层封顶）、振幅 0.80−0.0015f，封顶完美窗口 28→56.5ms、可落 178→335ms；挑战模式零改动
  - 门禁：`arcade_tower_test` 21→**23/23**（TP-13 重写 + 新增 TP-14 真实毫秒窗口）、challenge 6/6、smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、pwa 7/7、interaction 5/5、immersive 32/32、validate/build/inline/node --check 全过
  - 设计见 `apps/arcade/DESIGN-0.12.7.md`；SW 缓存键 `studiokit-arcade-0.12.7-v1`；发布：提交 `0d267d9` 推送 `main`；Actions run `44986037865` 四 job 全绿；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.12.7 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 实测 0/30/200 层：`g` 560/680/1500、周期 3085/2800/1885ms、目标振幅 0.80/0.76/0.62，逐帧完美窗口 64.1/66.5/41.9–45.8ms（含 1 帧量化误差，校正后 ≈80/83/57ms），0 console error；SW 缓存键 `studiokit-arcade-0.12.7-v1`
- 最近发布：Arcade `0.12.6`（2026-11-22，已双端发布）
  - 批次内容：PWA 独立窗口底部按钮适配——`--ac-thumb-lift` 原先只给 `body.arcade-immersive`，安装后按钮拿不到抬升（距底 60px vs 全屏 42px）；现在独立窗口同样抬升 36px、收起重复 `.game-hint`、去掉残留 14px 页面留白、省下的 34px 还给画布预算；横屏短视口沿用既有滚动策略不动；纯 CSS（52 行单 hunk），无 JS/key/Schema/关卡数据变更
  - 门禁：`arcade_immersive_buttons_test` 16→**32/32**（新增 IB-06：4 档竖屏 × {无安全区, 安全区 34} × 2 游戏，PWA 与全屏按钮距底差 ≤2px）、smoke 94/94、tower 21/21、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、tower challenge 6/6、pwa 7/7、interaction 5/5、validate/build/inline/node --check 全过；实测 PWA 与全屏按钮距底 42/42（无安全区）、70/70（安全区 34），画布 590→624
  - 发布：提交 `c1c2186` 推送 `main`；Actions run `44977911963` 四 job 全绿；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.12.6 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 实测（standalone stub，390×844/375×667 × {无安全区, 安全区 34} × 2 游戏）：**PWA 与全屏按钮距底完全一致**（42/42、70/70，Δ=0）、画布 624/543、0 溢出、hint 已收起、0 console error；SW 缓存键 `studiokit-arcade-0.12.6-v1`；设计见 `apps/arcade/DESIGN-0.12.6.md`
- 最近发布：Arcade `0.12.5`（2026-11-22，已双端发布）
  - 批次内容：层塔难度曲线修正——旧 `swingGravity` 30 层触顶导致 200 层与 30 层手感相同；改两段式（前 56 层 +34/层、之后 +14/层、约 157 层封顶 4000）+ 升速时振幅归一（消除 g 阶跃吃能量造成的摆幅塌缩）；挑战模式隔离不动；无 key/Schema/关卡数据变更
  - 门禁：`arcade_tower_test` **21/21**（新增 TP-13 难度曲线）、smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、tower challenge 6/6、pwa 7/7、interaction 5/5、immersive 16/16、validate/build/inline/node --check 全过；实测周期 2800→1154ms、完美窗口 61→24ms、摆幅 214→159px 稳定
  - 发布：提交 `7593b0a` 推送 `main`；Actions run `44973571565` 四 job 全绿；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.12.5 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 实测 0/30/100/200 层：g 680→1700→3200→4000、周期 2800→1771→1291→1154ms、振幅恒等目标（0.92/0.80/0.62/0.62）、摆幅 217→159px 稳定、0 console error；SW 缓存键 `studiokit-arcade-0.12.5-v1`；设计见 `apps/arcade/DESIGN-0.12.5.md`
- 最近发布：Arcade `0.12.4`（2026-11-22，已双端发布）
  - 批次内容：修复 0.12.3 回归——LOD 判据 `boxes.length>60 || scale<0.35` 使 60 层以上近景退化成纯色块；改为只按缩放 `scale<0.2`，性能改视口裁剪（1000 层近景每帧 23~24/1002）；轮廓只在 scale<0.35 绘制；新增 renderLod 探针；无 key/Schema/关卡数据变更
  - 门禁：`arcade_tower_test` **20/20**（新增 TP-12）、smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、tower challenge 6/6、pwa 7/7、interaction 5/5、immersive 16/16、validate/build/inline/node --check 全过；实测近景绘制 5/22/24/24（总 5/42/122/1002）、40 层全览仍保留细节、120/1000 层全览压缩
  - 发布：提交 `d79d500` 推送 `main`；Actions run 四 job 全绿；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.12.4 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 实测 40/120/1000 层**近景 `dense=false` 且 `scale=1`**（细节保留，绘制 17~24 只/总 42~1002）、40 层全览仍保留细节（0.2913）、120 层（0.1028）与 1000 层（0.0127）全览压缩色块、三者 `fits=true` 溢出 0、0 console error；SW 缓存键 `studiokit-arcade-0.12.4-v1`；设计见 `apps/arcade/DESIGN-0.12.4.md`
- 最近发布：Arcade `0.12.3`（2026-11-22，已双端发布）
  - 批次内容：全览去掉缩放下限（`clamp(...,0.08,1)` → `Math.min(1, avail/span)`），200/1000 层也完整入屏；`overviewT` 接近目标吸附消除 ~3% 残留；超高塔 LOD（>60 层或 scale<0.35 用属性色块 + 最小 8px 脊线 + 轮廓，1000 层每帧 ~1000 次 fillRect）；层号屏幕空间抽稀；横幅显示压缩比；`stackTo` 上限 40→1200；无 key/Schema/关卡数据变更
  - 门禁：`arcade_tower_test` **19/19**（新增 TP-11）、smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、tower challenge 6/6、pwa 7/7、interaction 5/5、immersive 16/16、validate/build/inline/node --check 全过；实测 40/200/1000 层 scale=0.2913/0.0624/0.0127、屏幕范围均 116–624、0 溢出、0 console error
  - 发布：提交 `79be219` 推送 `main`；Actions run `44968445299` 四 job 全绿；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.12.3 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 实测 200 层 scale=0.0624、1000 层 scale=0.0127，两者屏幕 y 均 116–624（画布 740）、溢出 0、fits=true、0 console error；SW 缓存键 `studiokit-arcade-0.12.3-v1`；设计见 `apps/arcade/DESIGN-0.12.3.md`
- 最近发布：Arcade `0.12.2`（2026-11-22，已双端发布）
  - 批次内容：集装箱释放水平速度（真实单摆切向速度 × 吊具阻尼 0.45，上限 240px/s）+ 落点预测改为 `释放点 + vx·t` 并画真实抛物线 + 释放点虚影/横移量提示 + 挑战 releaseWhenAligned 改用预测落点；`serialize/restore` 增可选 `drop.vx`（旧档缺省 0）；无 key/Schema/关卡数据变更，仅改 `pendulum-tower.html`
  - 门禁：`arcade_tower_test` **18/18**（新增 TP-10 释放水平速度：vx 峰值、可解性、横移量、预测误差 ≤3px）、smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、tower challenge 6/6、pwa 7/7、interaction 5/5、immersive 16/16、validate/build/inline/node --check 全过；实测 vx 峰值 111–134px/s、预测误差 ≤0.6px、单次横移 40–45px；真机手感 UNVERIFIED
  - 发布：提交 `7c6a4a9` 推送 `main`；Actions run `44964004148` 四 job 全绿；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.12.2 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 实测：中心页 0.12.2 + 16 卡、释放 vx 峰值 124–138px/s、横移 32–41px、**预测落点与实际落点误差 0px**、最优可达偏移 2.8–5px（完美相位存在）、0 console error；SW 缓存键 `studiokit-arcade-0.12.2-v1`；设计见 `apps/arcade/DESIGN-0.12.2.md`；真机手感待 Owner 复测
- 最近发布：Arcade `0.12.1`（2026-11-22，已双端发布）
  - 批次内容：层塔物理一致性（站立塔不再整体旋转、倾斜改支撑面/重心可视化、经典模式吊臂跟随塔顶保证可达、完美吸附力矩改用吸附后偏移）+ 全览真正 zoom-to-fit（40 层 0.29×、3 层 1.0×）+ 层号屏幕空间抽稀 + 落点投影常显含「会落空！」预警；无 localStorage key/Schema/挑战关卡数据变更，仅改 `pendulum-tower.html`
  - 门禁：`arcade_tower_test` **17/17**（新增 TP-07 可达性 / TP-08 zoom-to-fit / TP-09 所见即所判 + 结算保持缩放）、smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、tower challenge 6/6、pwa 7/7、interaction 5/5、immersive 16/16、validate/build/inline/node --check 全过；真机手感 UNVERIFIED
  - 发布：提交 `7d2a80a` 推送 `main`；Actions run `44961843208` 四 job 全绿（Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments）；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 双端逐文件一致（arcade 0.12.1 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 各 6/6（中心页 0.12.1 + 16 卡、`physicsInfo/viewInfo` 钩子、偏置后 `topReachable=true` 且 `pivot==target==topCenter`、摆幅区间覆盖塔顶、40 层全览 `scale=0.292` 整塔 y 116–624/740、0 console error）；SW 缓存键 `studiokit-arcade-0.12.1-v1`；设计见 `apps/arcade/DESIGN-0.12.1.md`；真机手感待 Owner 复测
- 最近发布：Arcade `0.12.0`（2026-11-22，已双端发布）
  - 批次内容：全屏/PWA 底部按钮抬升（`--ac-thumb-lift`，四档 6→42px、安全区 34→70px，toast 同步抬升）；层塔持久重心/支撑物理模型（连续右偏 4 层塌、左右交替 14 层稳）；层塔全览（按钮+快捷键 3、0.45s 缩放、结算前 0.9s 动画拉远）；层塔工地集装箱皮肤 + 4 种真实生效属性；合并 0.11.5 三项修复（双击放大防护 / 五子棋落子重影 / 预览取消出口）。无 localStorage key/Schema/关卡数据变更
  - 门禁：`arcade_immersive_buttons_test` 16/16、`arcade_tower_test` 13/13、`arcade_interaction_test` 5/5、smoke 94/94（一次星海拾取同帧抖动 flake，复跑 94/94）、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、tower challenge 6/6、pwa 7/7、validate/build/inline/node --check 全过；真机手感 UNVERIFIED
  - 发布：本地提交 `29141c1`（0.11.5）+ `874b72b`（0.12.0）ff 合入 `main` 推送（首次 SSH 连接被断开，重试成功）；Actions run `44923180812` 四 job 全绿（Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments）；本地 `tools/verify_deploy.py` **41/41** 双端逐文件一致（arcade 0.12.0 / badge 2.2.1 / venue 0.2.0）；双端线上无头 Chrome 各 6/6（中心页 0.12.0 + 16 卡、层塔全览钩子/按钮、沉浸按钮距底 42px、0 console error）；SW 缓存键 `studiokit-arcade-0.12.0-v1`；设计见 `apps/arcade/DESIGN-0.12.0.md`
- 最近发布：Arcade `0.11.4`（2026-11-21，已双端发布）
  - 批次内容：真机诊断定位「被模糊」对象是中心页共享 shellbar（非游戏标题栏），修复为 standalone 下 shellbar `position: sticky; top: 0` 贴顶（真机方案 1/9/10 清晰无副作用；fixed 会致下方贴边）；删除临时诊断页；不改 localStorage key/Schema/玩法
  - 门禁：`arcade_pwa_update_test` 7/7（PU-04 增 sticky 断言）、smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、validate/build/inline/node --check 全过
  - 提交 `87795d7` 推送 `main`；Actions run `44909647508` 四 job 全成功；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 文件 SHA-256 双端一致（Arcade `0.11.4` / Badge `2.2.1` / Venue `0.2.0`，manifest 正确）；线上 arcade.css 含 sticky 规则、中心页版本 0.11.4、诊断页 404；SW 缓存键 `studiokit-arcade-0.11.4-v1`；真机 iOS 顶部观感待 Owner 复测确认
- 上一个发布：Arcade `0.11.3`（2026-11-21，已双端发布）
  - 批次内容：真机修复 iPhone 独立模式 PWA 顶部系统模糊（移除 `viewport-fit=cover` + 半透明状态栏 meta，保留 fixed 顶边纯色条兜底）；PWA 更新检测（0.11.2）不变；不改 localStorage key/Schema、玩法或数据
  - 门禁：`arcade_pwa_update_test` 7/7（新增 PU-00 meta 防护）、smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、validate/build/inline/node --check 全过
  - 提交 `82db383` 推送 `main`；Actions run `44904562855` 四 job 全成功；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 文件 SHA-256 双端一致（Arcade `0.11.3` / Badge `2.2.1` / Venue `0.2.0`，manifest 正确）；两端线上 HTML 实测无 `viewport-fit=cover` 与半透明状态栏声明；SW 缓存键 `studiokit-arcade-0.11.3-v1`；真机 iOS 顶部观感待 Owner 复测确认
- 上一个发布：Arcade `0.11.2`（2026-11-21，已双端发布）
  - 批次内容：PWA 更新检测（中心页「检查更新」+ SW 版本握手 + 更新横幅，不自动刷新）与 iPhone 安装版顶部修复（深色不透明 shellbar + 安全区纯色底 + 游戏顶栏独立合成层，消除灰白渐层与文字发虚）；不改 localStorage key/Schema、玩法或数据
  - 门禁：`arcade_pwa_update_test` 6/6、smoke 94/94、zen 14/14、calm 17/17、review 5/5、gameplay base 11/11、validate/build/inline/node --check 全过
  - 提交 `f2f1cd1` 推送 `main`；Actions run `44899492208` 四 job 全成功；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 文件 SHA-256 双端一致（Arcade `0.11.2` / Badge `2.2.1` / Venue `0.2.0`，manifest 正确）；双端线上无头 Chrome 各 7/7（中心页 0.11.2 + 16 卡 + 深色 shellbar + 检查更新按钮 + 独立窗口安全区 + checkForUpdate 可用 + 五子棋沉浸顶栏清晰，0 console error）；SW 缓存键 `studiokit-arcade-0.11.2-v1`；真机 iOS 顶部观感与系统更新提示时机 UNVERIFIED
- 上一个发布：Arcade `0.11.1`（2026-11-21，已双端发布）：结算默认保留模糊蒙层 + 回看按钮按游戏命名；提交 `d51c87e` / Actions `44876176661` / verify 41/41
- 历史发布：Arcade `0.9.0`（2026-11-20，已双端发布）
  - 批次内容：新增二十一点 / 五子棋 / 纸牌接龙三款无倒计时单机棋牌（16 款 = 13 挑战 + 3 棋牌）；修复 10 款既有游戏的挑战公平性、续档与计分问题；localStorage key/Schema 与挑战关卡数据不变
  - 提交 `eb5e641` 推送 `main`；Actions run `44582961215` 四 job 全成功；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 文件 SHA-256 双端一致（Arcade `0.9.0` / Badge `2.2.1` / Venue `0.2.0`）；双端线上无头 Chrome 各 20/20；SW 缓存键 `studiokit-arcade-0.9.0-v1`。
- 最近发布：Arcade `0.10.0`（2026-11-20，已双端发布）
  - 批次内容：棋牌规则修复、挑战深度优化、设计源/生成器/参考解升级；不新增 key/Schema
  - 门禁：smoke 94/94、zen 14/14、calm 17/17、gameplay all 104/104、base 22/22、派生重生成 143/143；独立评审 Blocker 已闭环
  - 提交 `fc37d2b` 推送 `main`；Actions run `44681529684` 的 Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments 四个 job 全部成功；CI 与本地 `tools/verify_deploy.py` 均 **41/41** 文件 SHA-256 双端一致（Arcade `0.10.0` / Badge `2.2.1` / Venue `0.2.0`，manifest `application/manifest+json`）；双端线上无头 Chrome 各 26/26（中心页 0.10.0 + 16 卡 + 三款棋牌注册、三款棋牌 selftest/regression/开始/暂停、0.10.0 挑战数据字段、0 console error）；SW 缓存键 `studiokit-arcade-0.10.0-v1`。
- 上一个发布：Arcade `0.8.6`（2026-11-19，已发布）
  - 批次内容：13 款游戏经典局与俄罗斯方块禅模式结算「再来一局」回到开始弹层重新选模式；俄罗斯方块完整复位三入口；贪吃蛇改为左右相对转向双按钮，经典/挑战连点按格执行；不改数据 key/Schema 或玩法数值
  - 提交 `14a9160` 推送 `main`；Actions `44553437432` 四个 job 均成功
  - 双端验证：CI 与本地 `tools/verify_deploy.py` 均 **38/38** 文件 SHA-256 一致（Arcade `0.8.6` / Badge `2.2.1` / Venue `0.2.0`）；双端线上无头 Chrome **20/20**（SW、中心页、双按钮、经典/挑战相对转向、贪吃蛇结算重选、方块三入口 ready、0 console error）；SW 缓存键 `studiokit-arcade-0.8.6-v1`；真机双手手感仍 UNVERIFIED
- 上一个发布：Arcade `0.8.5`（2026-11-19，已发布）
  - 批次内容：极速车道修复卡死/车辆消失与远景透视，新增转向灯换道、连超尾流、加速带、维修箱、每 1000m 车流加密与 S+/S/A/B/C 评价；贪吃蛇棋盘优先 360×430 + 四向按钮 + 放缓提速；方块经典积分记录补当次消去层数；引擎 `roundRect` 夹取与逐帧兜底
  - 提交 `bdb1176..ee9b45b`（`cf8979e` / `211d8ca` / `16a2a8b` / `35394a2` / `ee9b45b`）推送 `main`；Actions `44472286080` 四个 job 均成功
  - 双端验证：CI 与本地 `tools/verify_deploy.py` 均 **38/38** 文件 SHA-256 一致（Arcade `0.8.5` / Badge `2.2.1` / Venue `0.2.0`）；双端线上无头 Chrome **20/20**（中心页 0.8.5 + 13 卡、SW `VERSION 0.8.5`、极速车道地平线车身 6.43×9.96px + 打灯车 0→1 完成、贪吃蛇棋盘 309px + 4×58px 按钮 + 向下转向、方块运行时 0.8.5、0 console error）；SW 缓存键 `studiokit-arcade-0.8.5-v1`；真机触控/转向灯可读性仍 UNVERIFIED
- 上一个发布：Arcade `0.8.4`（2026-11-18，已发布）
  - 批次内容：棋盘优先画布 340×610（经典棋盘占屏 +58%～+89%）、道具坞（经典 3 格 / 禅 4 格，含暂停）、地铁单手暂停（拇指区暂停键 + 触屏双击画面暂停）、`.tool-icon` 同名 class 冲突修复；无数据/玩法变更
  - 提交 `77cb02a..ecfdda4`（`853739c` / `0756490` / `ecfdda4`）推送 `main`；Actions `44122372096` 四个 job 均成功
  - 双端验证：CI 与本地 `tools/verify_deploy.py` 均 **38/38** 文件 SHA-256 一致（Arcade `0.8.4` / Badge `2.2.1` / Venue `0.2.0`）；双端线上无头 Chrome **18/18**；SW 缓存键 `studiokit-arcade-0.8.4-v1`
- 上一个发布：Venue Compare `0.2.0`（2026-11-16，已发布）
  - 批次内容：新工具从 draft 转 available：餐厅考察对比、地图标注、外部链接 / 分享备注；单页 HTML + 共享 shell；自包含只读 HTML 导出；无第三方运行时
  - 提交 `2276194`（含 `81684b9` / `f7146f8` / `ec0359d`）推送 `main`；Actions `43809215680` 四个 job 均成功
  - 双端验证：CI 与本地 `tools/verify_deploy.py` 均 **38/38** 文件 SHA-256 一致（Venue `0.2.0` / `available`，Arcade `0.8.3`，Badge `2.2.1`）；双端线上无头 Chrome **2/2**（首页卡片可用、空状态、示例 5 家 / 5 标记 / 2 链接、详情 6 项费用 + 2 链接 + 2 媒体）；0 console error；真机触控仍 UNVERIFIED
- 上一个发布：Arcade `0.8.3`（2026-11-15，已发布）
  - 批次内容：共享 shell 修复 Android 普通浏览器顶部导航条空白：顶部安全区只在安装/独立窗口应用并计入导航行总高度；普通标签页保持 38px、文字居中；SW 缓存键随 0.8.3 刷新；无数据/玩法变更
  - 提交 `c1727e7` 推送 `main`；Actions `43670060561` 四个 job 均成功
  - 双端验证：CI 与本地 `tools/verify_deploy.py` 均 **37/37** 文件 SHA-256 一致，Arcade `0.8.3` / Badge `2.2.1`；双端线上无头 Chrome 浏览器模式（40px 安全区下 shellbar 38px、文字居中）、独立窗口 78px（40+38）、SW 缓存键 `studiokit-arcade-0.8.3-v1`，0 console error
- 上一个发布：Arcade `0.8.2`（2026-11-13，已发布）
  - 批次内容：T065–T068 Owner 试玩反馈「按钮区占了太多游戏画面区域」修复：删除禅模式独立按钮行、冻结/恢复并入道具行、zen 隐藏重复 hint、道具行 44px、画布高度回收；实测禅模式画布面积 +18%～+47%、高度比经典多 56–60px；无数据/玩法变更
  - 提交 `077ccf5` 推送 `main`；Actions `43447829596` 四个 job 均成功
  - 双端验证：CI 与本地 `tools/verify_deploy.py` 均 **37/37** 文件 SHA-256 一致，Arcade `0.8.2` / Badge `2.2.1`；双端线上无头 Chrome **14/14**（门户/中心页 0.8.2、方块页经典 316×558 → 禅模式 348×614、3 按钮 44px、hint 隐藏、冻结按钮真实切换、结算写 zen 记录且经典 high 不变）；SW 缓存键 `studiokit-arcade-0.8.2-v1`
- 上一个发布：Arcade `0.8.1`（2026-11-13，已发布）
  - 批次内容：T060–T064 俄罗斯方块禅模式（无限游玩 + 冻结/恢复提速）、中心页积分记录表（`studiokit:arcade:scores:v1`）、独立评审（APPROVE-WITH-NOTES，发布前修复 2 Major + 相关 Minor）、小屏开始弹层入口可见性修复
  - 提交 `575a766`（功能）+ `41fa79e`（评审修复）推送 `main`；Actions `43423208129` 四个 job 均成功
  - 双端验证：CI 与本地 `tools/verify_deploy.py` 均 **37/37** 文件 SHA-256 一致，Arcade `0.8.1` / Badge `2.2.1`，manifest `application/manifest+json`；双端线上无头 Chrome **10/10**（门户/中心页 0.8.1 + 13 卡 + 积分记录区、方块页 0.8.1 + 禅模式入口、线上禅模式无限/冻结恢复/结算写 zen 记录且经典 high 不变、中心页表格展示禅记录）；SW 缓存键 `studiokit-arcade-0.8.1-v1`
- 上一个发布：Arcade `0.8.0`（2026-11-13，已发布）
  - 批次内容：T041–T059 影跃影冲/影之试炼、13 游戏 × 6 关挑战模式（基于 0.9 关卡设计包）、`challenge:v1` 记录与数据管线
  - 提交 `95a063f` 推送 `main`；Actions `43369758813` 四个 job 均成功
  - 双端验证：`tools/verify_deploy.py` 37/37 文件 SHA-256 一致（含 13 个挑战数据脚本），Arcade `0.8.0` / Badge `2.2.1`；双端线上无头 Chrome 12/12（hub/中心页/挑战入口/选关/C01）
- 上一个发布：Arcade `0.7.0`（2026-11-13，已发布）
  - 批次内容：T032 全游戏主动道具/自然收尾/一次性 20 分钟提醒/随机入口、T033 试玩截图复核与发布
  - 提交 `34f03df`；Actions `43274342320` 四个 job 均成功
  - 双端验证：`tools/verify_deploy.py` 24/24 文件 SHA-256 一致，Arcade `0.7.0` / Badge `2.2.1`
- 上一个发布：Arcade `0.6.2`（2026-11-12，已发布）
  - 批次内容：T028 黄金矿工目标取整/HUD、T029 俄罗斯方块左右手触屏按钮、T030 MIT 与源码入口、T031 双端发布
  - 提交 `0159437`；Actions `43155182519` 四个 job 均成功
  - 双端验证：`tools/verify_deploy.py` 当时覆盖的 11 个文件 SHA-256 一致，Arcade `0.6.2` / Badge `2.2.1`（0.7.0 起校验清单扩为 24 个文件）
- 发布授权：Owner 2026-11-13 当前任务明确指令「给俄罗斯方块添加 zen mode … 添加游戏积分记录表格收集和展示 你自己推进到发版」；据此按双目标规则同时部署 GitHub Pages 与 Cloudflare Pages 并逐文件校验。上一次 0.8.0 的授权为「以 0.8.0 版本名义提交推送并发布 GitHub Pages」。
- 上一个发布：Arcade `0.6.1`（2026-11-12），提交 `1c9501e`，Actions `43060497094` 成功
- 部署目标：
  - GitHub Pages：GitHub Actions（`.github/workflows/deploy.yml`）
  - Cloudflare Pages：Direct Upload，项目 `studiokit`，Production branch `main`

## 一次性设置（已完成，保留备查）

### GitHub

1. 仓库：`Shawlaw/studiokit`，`main` 为生产分支。
2. **Settings → Pages → Source** 选择 **GitHub Actions**。
3. Actions 允许运行；PR 只验证，不部署。

### Cloudflare Pages

1. Workers & Pages → Create → Pages → **Direct Upload**，项目名 `studiokit`，Production branch `main`。
2. 项目地址为 `https://studiokit.pages.dev/`；未绑定自定义域名。
3. 生成最小权限 API Token：Account → Cloudflare Pages → Edit，名称 `StudioKit GitHub Actions Pages`。Token 只存 GitHub Secrets，不写入仓库、日志或截图。
4. GitHub 仓库 **Settings → Secrets and variables → Actions**：
   - Secret `CLOUDFLARE_API_TOKEN`
   - Secret `CLOUDFLARE_ACCOUNT_ID`
   - Variable `CF_PAGES_URL` = `https://studiokit.pages.dev/`
5. 需要轮换 Token 时：新建同权限 Token → 更新 `CLOUDFLARE_API_TOKEN` → 跑一次 `workflow_dispatch` 验证 → 删除旧 Token。

## 自动部署条件

- `push` 到 `main`：`Validate and build` → `Deploy GitHub Pages` + `Deploy Cloudflare Pages` 并行 → `Verify both deployments`。
- `pull_request` 到 `main`：只执行校验与构建，不部署。
- `workflow_dispatch`：仅当所选分支为 `main` 时部署。
- 构建只做一次，两个部署 job 使用同一份 `site-dist` artifact；`verify` 对两个 origin 逐文件比较，并要求 Arcade 的 `engine.js` / `sw.js` / 注册表版本一致。

## 发布前检查

Windows 上若 `python` 指向 2.x，使用 `py -3`；CI 使用 Python 3.12。

```powershell
py -3 tools/validate_site.py
py -3 tools/build_site.py
node --check shared/home.js
node --check shared/site-shell.js
node --check apps/arcade/engine.js
node --check apps/arcade/sw.js
node tools/arcade_zen_scores_test.mjs   # 0.8.1 禅模式/积分记录 14 场景（默认端口 8770/9338）
node tools/check_inline_scripts.mjs   # 全站 HTML 内联脚本语法
node tools/arcade_smoke.mjs   # 需要本机 Chrome；当前 94 项，含 PWA/断网与 16 款旧档回归
node tools/arcade_calm_games_test.mjs   # 三款棋牌规则/结算/四档布局 + 10 款修复 regression
node tools/arcade_gameplay_test.mjs --suite=base --repeat=2   # 22/22 确定性玩法回归
git diff --check
git status --short
```

提交时间必须符合 `commit-time-policy`；推送前对所有未推送提交跑一次：

```powershell
py -3 "$env:USERPROFILE\.agents\skills\commit-time-policy\check.py" origin/main..HEAD
```

涉及 Arcade 的发布还应查看 `apps/arcade/DESIGN-0.4.0.md`、`DESIGN-0.5.0.md`、`DESIGN-0.6.0.md`、`DESIGN-0.7.0.md`、`DESIGN-0.8.0.md`、`DESIGN-0.8.1.md` 和 `DESIGN-block-controls.md`。PWA/离线检查必须在 HTTPS 或 `localhost` 下进行；`file://` 与明文局域网 HTTP 不注册 Service Worker。

本地 Windows 构建会把文本文件写成 CRLF，CI 的 Linux checkout 是 LF。`verify_deploy.py` 在比较前统一换行，但正式发布以 CI artifact 为准；不要用本地 `dist/` 覆盖 CI 产物。

## Agent 授权边界

正式发布是双目标：GitHub Pages + Cloudflare Pages。一次 `PUBLISH_TO_MAIN` 授权覆盖两端，不允许只发一端后声称发布完成。

发布前 Owner 必须提供：

- 目标 GitHub 仓库 URL；
- 仓库可见性；
- Pages 使用 GitHub Actions 的确认；
- 明确授权 Agent 推送/合并到 `main` 并触发公开站点部署。

推荐在具体任务中加入精确授权行：

```text
OWNER_AUTHORIZATION: PUBLISH_TO_MAIN
```

没有这行时，Agent 可以完成代码、测试、构建、分支提交和 PR 准备，但不得推送到 `main` 或触发正式发布。不得自行改变仓库可见性、组织权限或创建未经确认的公开仓库。

## 发布后验证

1. 检查 GitHub Actions 四个 job 均成功：`Validate and build`、`Deploy GitHub Pages`、`Deploy Cloudflare Pages`、`Verify both deployments`。
2. 从 run 日志或 job output 获取两个最终 URL，不要猜。
3. 跑一次独立校验：

   ```powershell
   py -3 tools/verify_deploy.py `
     --base "https://shawlaw.github.io/studiokit/" `
     --base "https://studiokit.pages.dev/" `
     --retries 15 --delay 8
   ```

   预期：两个 URL 的 41 个关键文件哈希一致（含 16 款游戏页与 `arcade.css`），Arcade 版本与本次提交的注册表一致，Badge 为 `2.2.1`，Venue 为 `0.2.0`，manifest 为 `application/manifest+json`。
4. 打开两个门户，确认工具卡片加载、源码链接、Badge Studio 与街机厅入口可点击。
5. 打开 Arcade 中心页，确认本次发布的版本和 16 款游戏（13 挑战 + 3 棋牌），并检查：
   - 每款游戏都有 2 个主动道具按钮（黄金矿工保留 4 个），按钮在画布外/内均不遮挡核心操作；三款新棋牌无倒计时、无下注、无签到/每日奖励。
   - 三款新棋牌可开始/暂停/续玩，五子棋先预览再确认、纸牌接龙无限翻回牌库；320/375 宽度下无横向溢出。
   - 中心页「惊喜一下」可随机打开一款，返回后再点不会立刻重复；页脚显示「快乐约定」。
   - `游玩统计`、`分享`、`安装到桌面`、`预载全部游戏` 的既有行为无回归；预载总数 27 项（11 外壳 + 16 游戏）；SW 缓存键为 `studiokit-arcade-0.9.0-v1`。
   - 经典/禅模式结算点「再来一局」回到开始弹层并可重新选模式；挑战关仍可直接重试或返回选关。
   - 贪吃蛇可用固定四向键与即时滑动，触控目标至少 44px，方向缓冲逐格执行。
   - 自然收尾：2048 达成、砖块第 3 关、重力 3000m、贪吃蛇 20 果实、方块 40 行、星海 Boss CLEAR、赛车 5000m 至少抽测 3 项。
   - 暂停后继续、刷新续玩与旧档（缺新字段）恢复至少抽测 3 款；道具次数与计时不丢失、不翻倍。
6. 打开 Badge Studio，确认共享导航、预览和导出正常。
7. 检查浏览器控制台无资源 404 / JavaScript 错误（`favicon.ico` 自动请求的 404 可忽略）。Service Worker 缓存旧版本时，使用 DevTools → Application → Service Workers 注销并清除 Storage 后复测。
8. 记录 commit SHA、Actions run URL、两个最终 URL 和验证结果到 `TASKS.md` 与 `tasks/queue.json`。

## 半发布恢复

两个部署 job 并行，Cloudflare 或 GitHub Pages 任一失败都可能出现“一端新、一端旧”。处理顺序：

1. 在 Actions run 页面确认失败的是哪个 job；不要重新推一个新提交来“重试”。
2. 如果是 Secret/Token、项目名或权限问题：修复设置后，对同一次 run 点 **Re-run failed jobs**；它使用同一个 commit SHA 和同一份构建产物。
3. 如果是构建/校验失败：修复代码后重新提交并推送，两个 job 会一起重跑。
4. 如果是 Cloudflare 侧已成功、Pages 侧失败：Pages 修复后重跑失败 job；不要只在 Cloudflare dashboard 手动改，以免两端分叉。
5. 恢复后必须重新执行 `verify_deploy.py`，确认两个 origin 的哈希一致，再宣称发布完成。

## 回滚

- 优先通过 `git revert` 已发布提交并推送，让两端一起回到旧版本；不要 force-push。
- 紧急情况下可以在 Cloudflare dashboard 回滚单个 deployment，但这会让两端版本不一致；必须紧接着用 revert 或旧 run 重跑把 GitHub Pages 一起回退。
- 重跑历史成功 run 也是一种一致回滚：它使用旧 SHA 同时部署两端，内容与当时的 artifact 一致。
- 如果只是单个工具有问题，可先将注册表状态改为 `draft` 或 `planned`，但要确保门户仍可加载。
- 数据格式或 localStorage key 变更必须先有迁移与回滚策略；不要为了回滚删除用户数据。

## 自定义域名（可选，尚未绑定）

1. 决定使用子域（如 `studiokit.example.com`）还是 apex；子域不影响 apex 的邮箱/其他记录，优先推荐。
2. 在 Cloudflare 项目 → Custom domains → Set up a domain 添加域名；若 zone 在同一 CF 账户下，CF 会自动创建 CNAME。不要先手动建 CNAME，否则可能 522。
3. 等证书 Active；若一直 pending，检查 CAA 记录是否允许 Cloudflare 的 CA。
4. 绑定后把 GitHub Variable `CF_PAGES_URL` 改为自定义域名，再跑一次发布/校验。
5. 不要在仓库放 `CNAME` 文件，也不要把同一个主机名同时绑定到 GitHub Pages 和 Cloudflare Pages；GitHub Pages 继续使用 `shawlaw.github.io/studiokit/`。
6. `studiokit.pages.dev` 仍可访问；若要只保留自定义域名，可另加 Bulk Redirect（可选）。
