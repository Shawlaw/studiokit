# Arcade 0.21.0 — 被动发现、选择式叙事与生涯归档

- 基线：0.20.0（main `ac56577`，已双端发布，提交 `df91715` / Actions `45719028590` 四项成功 / 双端各 88/88 文件一致）
- 分支：`feat/arcade-career-passive-021`（本地 HEAD `4ffc27d`，**目标发布；未验证 / 未发布，无 `PUBLISH_TO_MAIN` 授权**）
- 目标：把生涯入口收回被动发现；统一面向玩家的选择式叙事；增加可解冻封存与仅生涯完全重置；优化发布回归耗时。
- 版本口径：**目标**版本链 0.21.0 / SW `studiokit-arcade-0.21.0-v1`；当前产品代码（engine / sw / 中心页 / 注册表）与 validate/verify 断言仍为 0.20.0，版本 bump 未执行。本文与其余文档只同步口径，**不代表验证通过或已发布**。本分支实跑：`validate_site.py` / `build_site.py` PASS（因断言仍为 0.20.0）、纯 Node `career_archive_test.mjs` 8/8；Chrome / release / full 门禁、Actions、双端线上与真人均 UNVERIFIED。

## 1. 目标与边界

- 经典首页不出现生涯视图、默认视图切换或常驻告示板/信箱/章节入口。
- 生涯只从游戏结算处的微弱线索、收据与游戏内自然回流入场；未读/未投递来信可在首页以低强调小字找回。
- 生涯已开启或已封存时，中心页页尾提供二级「生涯设置」小字入口，仅用于封存/解冻、重置和档案，不是生涯内容 CTA。
- 故事与任务推进用“你”的视角提问或请求选择；NPC 自述可保留“我”，但不能替玩家决定行动。
- 不改经典 localStorage key、IDB 版本/11 stores、玩法数值、委托奖励、关卡与挑战数据。

## 2. 入口状态机

- 无线索：经典目录，无生涯提示。
- 有未读线索：首页「继续上次」附近一行小字；不自动切视图、不弹窗、不创建生涯。
- 已读未投递：同一小字显示「继续旧港来信」。
- C0 后：保留游戏内章节入口与收据回流，不在中心页常驻章节链接。
- 封存：隐藏生涯内容入口与结算线索，只保留生涯设置；经典游玩不受影响。
- 深链 `?careerLetter=1`、`?careerPanel=*`、`?story=1` 保留为显式入口/测试接口，受封存门控。

## 3. 叙事视角

- 玩家可见的故事、任务和提示优先使用“你愿意……吗？”“你想先……哪一项？”。
- 选项必须对应真实可执行动作/路线/终局，不新增虚假分支。
- `clues.json` 与 `chapter-01.json` 同源信件同步改写；NPC 信件保留说话人的第一人称自述。
- 委托标题/摘要、章节 start/progress/complete/next、路线 hint、NPC 回信、支线与三终局统一视角。

## 4. 封存/解冻

- 在既有 `state` store 增加 `career-archive` 标记行，不新增 store/key/schema。
- 封存保留全部数据与 live run，但禁止新线索、接单、继续委托与结算写入。
- 解冻删除标记并推进代次；写入门禁必须在 DB 事务内重读标记，防止旧标签绕过。
- 备份携带封存标记；replace 导入以文件状态为准。

## 5. 完全重置

- 新增单事务 `resetAllCareer()`，清空生涯库 11 个 store 的玩家数据、封存标记与旧代次；同事务保留有界 `former-career:<id>` 退役标记（最多 256，不进备份）与新一代次，拒绝重置前旧标签继续写生涯资产。
- 退役标记超出上限时，最早退役 ID 不再保证阻断；无 careerId 的发现状态写入仍靠发现代次/动作存在性守卫。
- 不同步清除经典 progress/runs/playtime/scores/challenge/meta/prefs，也不改旧 key。
- bridge 清当前页内存、sessionStorage ticket/rental marker 与线索 UI。
- 设置面板要求二次确认并输入「重置生涯」，提示经典记录不受影响。

## 6. 回归分层

- `static`：校验、构建、全部纯 Node 门禁、96 static、flow static-only。
- `release`：static + 串行关键 Chrome 集（smoke、isolation、gameplay base、mobile、PWA、完整首航、受影响委托游戏）。
- `full`：现有全量 Chrome 集，保持串行。
- 每项记录真实耗时；发布快速集不等于完整集。
- 96 runner 在父进程已 static 后可 `--skip-static`，避免重复静态校验。

## 7. 验收

- 新档与错过 chip 的被动回访链路通过，中心页无生涯常驻 CTA。
- 封存后零生涯写入、经典正常；解冻恢复原进度。
- 完全重置后生涯 11 stores 玩家数据清空、经典存储逐字节不变，旧标签不能通过带 careerId 的资产写入回写；无 careerId 的发现状态以代次/动作守卫为准。
- 文案视角检查通过，所有提问有真实动作承接。
- 320/375/390/430、紧凑视口、读屏/reduced-motion、PWA 离线与两种部署路径通过。
- `release` profile 通过，完整 `full` 单独如实记录；release 结论 `release passed (not full)` 不得冒充 full。
- **待完成（本分支未执行）**：版本链升到 0.21.0、SW `studiokit-arcade-0.21.0-v1`、Actions 四项成功、双端 verify_deploy 一致；未拿到这三项证据前不得声称发布。

## 8. 回滚

- 回退 0.21 功能提交并将版本链归 0.20.0（当前产品代码尚未升版，实际回退只需丢弃功能提交）；SW 新缓存随 activate 清理。
- 生涯 `career-archive` 是 state 行，旧代码会忽略；封存数据不删除。
- 已执行完全重置不可回滚，操作前需导出档案并二次确认。
- 集成与验证记录见 [`docs/arcade-life/INTEGRATION-0.21.md`](../../docs/arcade-life/INTEGRATION-0.21.md)；接口冻结见 `docs/arcade-life/ADR-interfaces.md` §22。
