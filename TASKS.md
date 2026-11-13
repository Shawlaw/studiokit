# StudioKit Task Queue

机器可读队列：[`tasks/queue.json`](tasks/queue.json)。状态变更可使用 `python tools/agentctl.py`。

| ID | 类型 | 任务 | 状态 | 依赖 | 备注 |
|---|---|---|---|---|---|
| T001 | agent | 审计启动包、仓库结构与路径约定 | DONE | — | 结构符合 AGENTS.md；Badge Studio 2.2.0 / Schema v3 / autosave key 不变均已核实 |
| T002 | agent | 执行校验/构建/脚手架测试并修复问题 | DONE | T001 | validate/build/node --check 全部通过；脚手架在临时副本验证，主工作树未污染 |
| T003 | review | 独立发布前审查 | DONE | T002 | 独立 Reviewer Agent：APPROVE-WITH-NOTES（0 Blocker / 0 Major / 2 Minor）；两个 Minor 已修复并回归 |
| T004 | agent | 准备首个提交并核验提交内容 | DONE | T003 | 提交 `5fc840b`（分支 `flash/bootstrap-baseline`，37 文件）；diff --check 干净；仅本地，未推送 |
| T005 | agent | 首次 GitHub Pages 发布与线上验证 | DONE | T004 | Owner 提供 remote 并授权 PUBLISH_TO_MAIN；提交 `16b750e`；Actions run `41262967540` 成功；线上 https://shawlaw.github.io/StudioKit/ 验证通过 |
| T006 | agent | 替换默认徽章示例文字为中性项目内容并升版 2.2.1 | DONE | T004 | Owner 指令；默认内容改为 STUDIOKIT/BADGE STUDIO/◎；原始个人示例不出现在任何提交历史；版本全链同步；浏览器验证通过 |
| T007 | agent | 全仓库个人信息泄漏审计与处置 | DONE | T006 | 内容层零泄漏（邮箱/手机/身份证/用户名/路径/base64/注释全查）；Git 提交身份经 Owner 决定保持现状；BASELINE.md 溯源段按 Owner 决定整体删除 |
| T008 | agent | 小写 URL /studiokit 可访问（仓库改名） | DONE | T005 | 仓库改名 Shawlaw/StudioKit→studiokit；https://shawlaw.github.io/studiokit 301→200；浏览器级验证通过；旧混合大小写 URL 不被 Pages 重定向（已记录，无外部链接影响） |
| T009 | agent | 门户去冗余文案（let UI speak for itself） | DONE | T008 | 提交 `65e63b8`；hero/关于/导航/英文标语移除，页脚压缩为单行；run `41265543819` 成功；线上复测零冗余零溢出零 404 |
| T010 | agent | 街机厅 Arcade：竖屏物理小游戏合集 | DONE | T009 | 本地分支 `feat/arcade-hall` 9 提交；中心页 + engine.js + 4 游戏（星海突击/影跃/层塔/雪铃）+ 自研物理与合成音效；registry `draft` v0.1.0 待 Owner 验收；validate/build/node 全过；浏览器实测可玩与窄屏通过；仅本地未推送 |
| T011 | agent | 街机厅增补 GBA 经典三连 + 移动端触控适配 | DONE | T010 | 俄罗斯方块/极速车道/黄金矿工接入，升版 0.2.0；全部游戏 PC+触摸双输入、viewport/滚动/选中触控加固；8 页面 375px 无溢出；浏览器实测三游戏（128 分/287m/$865 超标）通过 |
| T012 | agent | 街机厅 0.3.0：13 款竖屏游戏、局内进度恢复、搜索筛选与人工反馈修复 | DONE | T011 | 新增 6 游戏；RunSave 局内档；搜索/筛选/续玩；雪铃可达、矿工/层塔摆速、星海 4 Buff、方块触屏面板；validate/build/34 项 CDP 冒烟全过 |
| T013 | agent | 街机厅 0.3.0 发布：推送 main 并验证 GitHub Pages | DONE | T012 | 推送 `aba11a9`；Actions run `42501786872` 成功；线上 13 卡/v0.3.0/registry available；13 游戏页 200 |
| T014 | agent | 街机厅 0.3.1：按游戏性评审包优化公平性、输入与移动端布局 | DONE | T013 | 输入多指/取消、雪铃去重、影跃可达、星海波次、赛车安全走廊、矿工关卡、44px 暂停；49/49 CDP；真机/大规模种子 UNVERIFIED |
| T015 | agent | 街机厅 0.3.1 发布：独立审核后 fast-forward 合入 main 并验证 Pages | DONE | T014 | Reviewer A/B/C/D 复核无 Blocker/Major；`793a6fd` ff 合入 main；Actions `42565028915` 成功；线上 0.3.1/13 卡/子路径 shell 正确 |
| T016 | agent | 街机厅 0.3.2：修复矿工夹取显示与记忆翻牌难度曲线 | DONE | T015 | 夹中物仅随钩爪绘制；记忆 6 关 6→24 张、预览 3.2→1.8s；51/51 CDP；提交 `2df2dbd` 已发布 |
| T017 | agent | 街机厅 0.3.2 发布：fast-forward 合入 main 并验证 Pages | DONE | T016 | `2df2dbd` ff 合入 main；Actions `42625773149` 成功；线上 0.3.2/13 卡，无头 Chrome 9/9 通过 |
| T018 | agent | 街机厅 0.4.0：全屏沉浸游玩 + 黄金矿工摆速与限量道具 | DONE | T017 | 全屏/CSS 降级/偏好记忆；矿工摆速 300 起、道具 2/1/1、指哪打哪/加时/绞盘；57/57 CDP、validate/build 全过；仅本地未发布 |
| T019 | agent | 街机厅 0.4.0 发布：提交并推送 main，验证 GitHub Pages | DONE | T018 | `49bc1aa` ff 合入 main；Actions `42846474565` 成功；线上 0.4.0/13 卡/全屏与道具可用；57/57 CDP |
| T020 | agent | 根目录文档同步 Arcade 0.4.0 与当前发布状态 | DONE | T019 | README/CHANGELOG/START-HERE/AGENTS/CONTRIBUTING + docs；链接/validate/build/node 全过；docs-only；Owner 已授权推送 |
| T021 | agent | 街机厅 0.5.0：游玩统计、分享、PWA 安装与离线预载 | DONE | T020 | playtime:v1 独立 Schema；统计/分享/预载 UI；manifest+SW+图标；62/62 CDP（含断网）；validate/build/node 全过；后续随 T023 发布 |
| T022 | agent | 黄金矿工连续使用指哪打哪后钩爪停摆修复 | DONE | T021 | 根因：正下方目标摆角/角速度归零；修复：最小角速度 + 收钩/旧档恢复兜底；连续 3 轮回归；63/63 CDP；commit `c8c049d` |
| T023 | agent | Arcade 0.5.0 发布：推送 main 并验证 GitHub Pages | DONE | T022 | Owner 明确指令“都可以直接提交发布上线”；`b8abe41`+`c8c049d` ff 合入 main；Actions `42974993445` 成功；线上 0.5.0/13 卡/PWA/预载 24-24/矿工连续瞄准通过 |
| T024 | agent | 修复游玩统计连续游玩超过 15 秒后停止累计 | DONE | T023 | 根因：tick flush 后未重新开启时间片；修复 startSegment；新增 17 秒连续游玩回归；63/63；版本 0.5.1；commit `6739521` |
| T025 | agent | Arcade 0.5.1 发布：推送 main 并验证 GitHub Pages | DONE | T024 | Owner 明确指令“可以 提交发布吧”；`6739521` 推送 main；Actions `43008560646` 成功；线上 0.5.1/连续游玩 17 秒 17012ms/SW 缓存 0.5.1/预载 24-24 |
| T026 | agent | 街机厅 0.6.0：星海 Boss/弹种叠加/全屏移动 + 矿工瞄准线/摆幅修复 + 显式全屏 | DONE | T025 | 黄金矿工摆角/朝向分离 + $2/s 瞄准线；星海 30s Boss/三档火力/叠加/整屏移动；点开始不再自动全屏；66/66 CDP；`6debd77` 发布 0.6.0 |
| T027 | agent | Arcade 0.6.1 发布：Boss 入场碰撞热修并验证 Pages | DONE | T026 | Boss 入场 y<100 不碰撞/y>=104 才发弹；清关生命 3→4；`1c9501e`；Actions `43060497094` 成功；线上 0.6.1/缓存 0.6.1/预载 24-24/66-66 |
| T028 | agent | 黄金矿工目标金额取整 + 目标 HUD 可读性优化 | DONE | T027 | 目标与旧档统一整数；画布顶部深色渐隐、DOM 目标金色胶囊；66/66 CDP；validate/build/node 全过；已由 T031 双端发布 |
| T029 | agent | 街机厅俄罗斯方块触屏按钮分区与交互优化 | DONE | T028 | 左手横移 2 大键 + 右手旋转/加速/落底 3 键；图标+文字、64/58px；加速逐格不锁定、落底实心金色+立即锁定+脉冲/轻震；移除画布隐藏触控区；自动连移静音；多指同按；66/66 CDP；320/375/390/430+沉浸+安全区；已由 T031 双端发布 |
| T030 | agent | 开源协议（MIT）与页面 GitHub 源码入口 | DONE | T029 | MIT LICENSE + README 许可说明 + ADR-0005；门户页头与 shellbar「源码」链接（noopener）；validate/build/node --check 全过；arcade_smoke 66/66；320/390/430 无溢出、shellbar 38px；已由 T031 双端发布 |
| T031 | agent | 双目标发布：GitHub Pages + Cloudflare Pages 与 Arcade 0.6.2 | DONE | T030 | `0159437` 推送 main；Actions `43155182519` 四 job 全成功；verify 11/11 文件一致；双端 Arcade 0.6.2 / Badge 2.2.1；CF 项目 studiokit；Token 仅存 GitHub Secrets |
| T032 | agent | Arcade 0.7.0：全游戏趣味性、可选道具与适度游玩优化 | DONE | T031 | 13 款各 2 个主动道具（矿工保留 4 + 两项重平衡）、7 类自然收尾、20 分钟一次性提醒、中心页 🎲；共享 createToolbelt；validate/build/node --check 全过；arcade_smoke 85/85（含 13 款旧档补给、320/375/390/430+横屏、PWA/断网）；本地提交 `0eebc79`（feat/arcade-pure-joy），未推送/未发布；真机 UNVERIFIED |
| T033 | agent | Arcade 0.7.0 发布：试玩截图复核、推送 main 并双端验证 | DONE | T032 | Owner 当前任务明确授权发布；13 页自动试玩+截图复核（320/375/390/430/横屏）无 UI 阻塞，修复道具标签与提示文案后 commit `34f03df` 推送 main；Actions `43274342320` 四 job 成功；verify_deploy 24/24 双端一致，线上 0.7.0；发布后文档同步提交已推送；真机 iOS/Android 仍 UNVERIFIED |
| T034 | agent | Arcade 0.8.0 GP001+GP002：事实冻结与游戏性量表/关卡模板 | DONE | T033 | `docs/arcade/0.8.0-FACTS.md`（HEAD 5fbe897、13 款现状逐条 CONFIRMED/WRONG/UNVERIFIED + 文件行号、3 处文档漂移、#test 钩子与测试入口、GP↔T 映射）与 `GAMEPLAY-DESIGN-RUBRIC.md`（六维 0–4 量表+证据字段、Stage Spec 模板、AFK/无 FOMO 契约、Gate A/B/C、GP004–007 DoD）；`0.8.0-PLAN.md` 记录 GP→T 映射与执行顺序；validate_site PASS；commit `b629b6b`；仅本地未推送 |
| T035 | agent | Arcade 0.8.0 GP003：确定性玩法测试基座与关卡求解器 | DONE | T034 | 抽出零依赖 CDP 库 `tools/lib/arcade_cdp.mjs`，`arcade_smoke.mjs` 85 项行为/输出/默认端口不变；新增 `arcade_gameplay_test.mjs` 11 个确定性场景（seed 复现、影冲单次/落地补充/暂停刷新恢复、旧档恢复、试炼状态机/失败重试/暂停续玩/双路线/卷轴、Boss、赛车走廊，`--repeat=2` 22/22）；新增 `arcade_stage_solver.mjs` 双路径 3/3 PASS；关卡数据冻结 `stages-0.8.json`（sha 432C8AB2…）；commit `8cc689d`；真机 UNVERIFIED |
| T036 | agent | Arcade 0.8.0 GP004：影跃空中影冲与并发输入 | DONE | T035 | 每跳一次影冲（620px/s×0.13s、重力×0.25、落地终止+60% 惯性），每次着陆补充、Shift/J + 独立 ≥44px 触屏按钮、不可用不缓存、暂停/刷新恢复、旧无尽档缺字段默认 1、seed 化平台生成；自测 41 项与 smoke 85/85；commit `4e8f921`（与 GP005/006 同一 feat 提交，文件不可分割）；仅本地未推送 |
| T037 | agent | Arcade 0.8.0 GP005：影跃影之试炼 S1–S3 与进出关卡 | DONE | T036 | 三关手工数据内嵌（页内 STAGES-JSON 与冻结 JSON deep-equal）、影门结算、失足 1 次点击重试、暂停退出、试炼字段写入既有 runs:v1 data、旧档缺 mode 按 classic；求解器 3/3 PASS（S3 关键缺口必须一次影冲、错冲全部回收）；SC-SL-004/005/006 确定性场景；320/375/390/430 截图；commit `4e8f921` |
| T038 | agent | Arcade 0.8.0 GP006：双路线、卷轴探索与失败复盘 | DONE | T037 | S2 稳妥长路/近路快线判定与结算路线标签、失败复盘可归因提示、卷轴可选语义、trialInfo/routeInfo/forceRoute 钩子；SC-SL-007/008；测试门禁 22/22 + smoke 85/85；commit `4e8f921` |
| T039 | review | Arcade 0.8.0 GP007：独立评审与 Owner 试玩包 | BLOCKED | T035,T036,T037,T038 | Agent 侧完成：独立 Reviewer APPROVE-WITH-NOTES（0 Blocker / 2 Major closed / 6 Minor 收尾）、78 项真实输入独立实玩、全门禁复跑；`0.8.0-REVIEW.md` + `0.8.0-PLAYTEST.md`，commit `e456503`。**阻塞原因：Owner 两轮试玩结论未获得，Agent 不可代签，0.8.0 发布门槛未通过** |
| T040 | agent | Arcade 0.8.0 竖切片集成验证与本地提交 | DONE | T034,T035,T036,T037,T038 | Lead 集成：validate/build/node --check（含页内联）/smoke 85/85（运行前后 sha 一致）/gameplay 22/22/solver 双路径 3/3/git diff --check 全过；文档同步 README/CHANGELOG/ROADMAP/RELEASE-RUNBOOK 并修正 3 处历史文档漂移；本地 5 个提交，**未推送/未合并/未发布**；`ARCADE_VERSION` 保持 0.7.0 |
| T041 | agent | Arcade 0.9.0：设计包导入、差异报告、集成合同与计划 | DONE | T040 | 原样导入 Owner 0.9 设计包（SHA-256 `B528BA4E…`：13 游戏 × 6 关 = 78 关、13 份蓝图、校验脚本、离线图谱、建议队列不入库）到 `docs/arcade/0.9/`；产出 `0.8-TO-0.9-DIFF.md`、`INTEGRATION-CONTRACT.md`、`PLAN.md`；commit `1b530e4`；未推送 |
| T042 | agent | Arcade 0.9.0 平台：数据生成器 + A.Challenge + 记录 key + CSS/SW/validate | DONE | T041 | `tools/arcade_09_data.mjs` 校验 1088 设计断言 + 2128 自检、幂等生成 13 个运行时数据（防剧透）与测试夹具；engine.js 新增 `A.Challenge` 与 `studiokit:arcade:challenge:v1`（Schema v1，导出/导入/清除加法兼容）；arcade.css 挑战共享样式；sw.js 预缓存；validate 断言；平台自测 21/21 + CSS 7/7；commit `0e9a156` |
| T043 | agent | Arcade 0.9.0 影跃 C01–C06（0.8 试炼迁移到 0.9 数据） | DONE | T042 | 删除页内 S1–S3、改用生成数据（worldY=620-height、圆-矩影门、侧风/开关/检查点）；影冲/卷轴/双路线/失败复盘保留；旧 `mode:'trial'` 存档映射 C01–C03 或提示重开不删档；CH-SL 8 场景（C01–C06 真实输入回放，C03 证明必须影冲）；经典 11/11 base 零回归；commit `c0e2315` |
| T044 | agent | Arcade 0.9.0 俄罗斯方块 + 2048 挑战模式 | DONE | T042 | 方块固定 20×10 盘面/块序/消行目标（禁 7-bag）、2048 固定盘面/禁随机/目标块；6 关参考通关真实键盘输入（方块清行 1/2/4/2/2/4；2048 终盘=设计 resultBoard）；各 8 场景 ×2 = 16/16；commit `456ed97` |
| T045 | agent | Arcade 0.9.0 记忆翻牌 + 贪吃蛇挑战模式 | DONE | T042 | 固定盘面/线索/限错/镜像函数；固定地图/脚本果实/方向队列；C01 真实输入通关（记忆配对点击、蛇 movesRLE 真实方向键），各 6 场景 ×2 = 12/12；commit `456ed97` |
| T046 | agent | Arcade 0.9.0 打地鼠 + 极速车道挑战模式 | DONE | T042 | 固定事件时间轴（atSec 模拟时间/金鼠/炸弹/假目标/双指并点）与固定车流时隙+真实变道过渡；打地鼠 8 场景 ×2 = 16/16、赛车 7 场景 ×2 = 14/14（C01 real-input，C06 1240m）；commit `456ed97` |
| T047 | agent | Arcade 0.9.0 重力翻转 + 砖块计划挑战模式 | DONE | T042 | 固定障碍序列/推荐翻转窗口/星星；固定 8×5 砖阵 + K 钥匙/G 门（发现 C03/C06 字面不可解并登记最小修正「撞未解锁 G 伤其上 K」）；重力 C01 real-input + C02–C06 engine-replay，砖块 6 关 engine-replay 清场 53.3–101s；各 7 场景 ×2 = 14/14；commit `456ed97` |
| T048 | agent | Arcade 0.9.0 雪铃 + 层塔挑战模式 | DONE | T042 | 固定铃序/休止铃/彩铃；建筑委托 + 确定性初始角速度（设计差异已登记）/无吸附；雪铃 6 场景 ×2 = 12/12（C01 real-input）、层塔 6 场景 ×2 = 12/12（C01 engine-replay）；commit `456ed97` |
| T049 | agent | Arcade 0.9.0 星海突击 + 黄金矿工挑战模式 | DONE | T042 | 固定波次/安全走廊/7 攻击模式/C05–C06 Boss 脚本（弱点时间窗化已登记）；固定矿图/真实钩爪/参考抓取顺序金额达标；各 7 场景 ×2 = 14/14（全部 engine-replay）；commit `456ed97` |
| T056 | agent | Arcade 0.9.0 挑战场景聚合器与 78 关数据门禁 | DONE | T042 | runner 支持 `--suite=base|challenge|all`、`--game`、自动发现 13 个 `tools/challenge/*.mjs`；迁 5 个 0.8 影跃 base 场景到 0.9 语义；CH-DATA-001（designChecks=2256/runtime=13/13）与 CH-CLASSIC-001（13/13）PASS；最终 `--suite=all --repeat=2` **208/208（798.3s）**、smoke **85/85**、产品 29 文件冻结前后 sha 不变；commit `fe79b0f` + 收尾提交 |
| T057 | review | Arcade 0.9.0 独立评审与 Owner 试玩包 | DONE | T056 | 独立 Reviewer：**APPROVE-WITH-NOTES / 0 Blocker / 5 Major（均为需 Owner 裁决的设计差量）/ 6 Minor / 10 类 UNVERIFIED**；独立数据审计 deep-equal、原生 CDP 实玩 47/47、A.Challenge 探针 13/13、smoke 85/85、全量 208/208；`REVIEW.md` + `PLAYTEST.md`；**Owner 两轮试玩未获得 → 0.9 发布门槛未通过，Agent 不代签**；收尾提交 |
| T058 | agent | Arcade 0.9.0 集成验证、文档与任务队列同步、本地提交 | DONE | T041,T042,T043,T044,T045,T046,T047,T048,T049,T056,T057 | Lead 收尾：`validate_site`/`build_site`/全部 `node --check`（含 13 页内联脚本抽样）/smoke **85/85**/base 11/11/CH-DATA-001/CH-CLASSIC-001/数据生成幂等/`git diff --check` 全过；文档同步 `apps/arcade/README|CHANGELOG`、`docs/arcade/README`、`ROADMAP`、`RELEASE-RUNBOOK`、`TASKS`、`queue`；本地提交（含 0.9 提交链），**未推送/未合并/未发布**；`ARCADE_VERSION` 保持 0.7.0 |
| T059 | agent | Arcade 0.8.0 发布：推送 main 并双端验证（GitHub Pages + Cloudflare Pages） | DONE | T058 | Owner 当前任务明确授权「以 0.8.0 名义提交推送并发布 GitHub Pages」；`ARCADE_VERSION`/注册表/SW/中心页版本升至 0.8.0；发布前 smoke 85/85、全量 208/208、截图验证 43/43、commit-time-policy 14/14 合规；提交 `95a063f` 推送 main；Actions `43369758813` 四 job 全成功；`verify_deploy.py` 37/37 文件双端一致，线上 Arcade 0.8.0 / Badge 2.2.1，双端无头 Chrome 12/12；真机与 Owner 试玩仍 UNVERIFIED |

| T060 | agent | Arcade 0.8.1 俄罗斯方块禅模式 + 积分记录平台（并行实现与契约） | DONE | T059 | 4 个并行 Worker 按 `docs/arcade/0.8.1-CONTRACT.md` 实现：engine `A.Scores`（`scores:v1`，fail-closed、300 条上限）与模式感知 `Progress.recordPlay`（13 款经典自动收集、zen 不污染经典最高分、导出/导入/清除接入、可选第三弹层按钮）；方块页禅模式（无限、Z/触屏冻结提速、HUD/暂停结束、单次结算、`runs:v1` 恢复、`#test` 钩子）；中心页积分记录表（筛选/清除/响应式/a11y）；版本/注册表/SW/断言升至 0.8.1；新增 `DESIGN-0.8.1.md` 与契约；worker 自测 65/65+5/5、55/55、41/41；commit `575a766` |
| T061 | agent | Arcade 0.8.1 自动化测试与全量门禁 | DONE | T060 | 新增零依赖 `tools/arcade_zen_scores_test.mjs` 14 场景（禅无限/冻结恢复/结算不污染最高分/表格筛选清除/导入导出/损坏与旧档兼容/320–430 布局）；集成期定位并闭环 375/390 hint 换行 docH 溢出回归；最终树 `arcade_smoke` 85/85、new test 14/14、gameplay base 22/22、validate/build/node --check 全过 |
| T062 | review | Arcade 0.8.1 独立发布前评审 | DONE | T061 | `docs/arcade/0.8.1-REVIEW.md`：APPROVE-WITH-NOTES / 0 Blocker / 2 Major / 8 Minor / 9 UNVERIFIED；独立复跑 new test 14/14、smoke 85/85、gameplay 22/22、validate/build，自建真实输入 CDP 探针 61/62（唯一 FAIL 即 M2），168 请求全同源、0 console error |
| T063 | agent | Arcade 0.8.1 集成、版本、评审修复与发布前门禁 | DONE | T062 | M1 采用发布后证据提交时序（发布声明文档不入功能提交）；M2 修复：≤460px 开始弹层短文案+紧凑样式，320/375/390/430 三入口 44px 完整可见，ZS-14 增加四档断言；m-1 hook `loop.resume()`、m-2 `scoresImported` 导入提示、m-5 筛选计数、m-3/m-4/m-7/m-8 文档化；修复后 new test 14/14、smoke 85/85、gameplay 22/22、validate/build/node --check、M2 探针 5/5、inline `node --check`、commit-time-policy 2/2 全过；commit `41fa79e` |
| T064 | agent | Arcade 0.8.1 发布：推送 main 并双端验证（GitHub Pages + Cloudflare Pages） | DONE | T063 | Owner 当前任务明确指令「你自己推进到发版」；推送 `de70117..41fa79e`；Actions run `43423208129` 四个 job 全成功（Validate and build / Deploy GitHub Pages / Deploy Cloudflare Pages / Verify both deployments）；CI 与本地 `verify_deploy.py` 均 37/37 文件 SHA-256 双端一致，Arcade `0.8.1` / Badge `2.2.1`；双端线上无头 Chrome 10/10（门户/中心页/积分记录区/方块页 0.8.1/禅模式无限/冻结恢复/结算写 zen 记录且经典 high 不变/中心页表格显示禅记录）；SW 缓存 `studiokit-arcade-0.8.1-v1`；真机与长局仍 UNVERIFIED |

## 任务命令

```powershell
python tools/agentctl.py list
python tools/agentctl.py next
python tools/agentctl.py claim T001
python tools/agentctl.py done T001 --evidence "validate_site.py passed; baseline inspected"
```

T005 必须额外提供授权标志：

```powershell
python tools/agentctl.py claim T005 --owner-authorized
```

`--owner-authorized` 只是队列状态门槛，不替代 Owner 在当前任务中对目标仓库和发布行为的明确授权。
