# G18 独立门禁证据摘要（Arcade 0.18.0，本地未发布）

- 分支：`feat/arcade-life-015`（本地）；审核 HEAD：`a84d15f`（第二轮 PASS），随后 `118f1cc` 修复 W11（告示板终局懒加载）；远端 `main` 仍 `afc5fd4`，无 push/tag/部署/`OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`。
- 契约：ADR §20；设计/回滚：`apps/arcade/DESIGN-0.18.0.md`；集成：`INTEGRATION-0.18.md`。
- 完整原始证据在仓库外：`qa/evidence/G18-AUDIT.md`（首轮 FAIL，B1–B5）、`G18-AUDIT-2.md`（第二轮 PASS + W11）、`G18b-runall.log`、`G18b-recheck.log`、`g18-real-paths/mjs` 等；不含剧透内容。

## 全分支复审（cd9e555）后的 P1/P2 修复（HEAD 6481322）

独立全分支审查提出 6 项 P1、10 项 P2；已在本分支修复并逐项复测（证据仓库外）：

- C0：真实线索 chip → `openClue` 打开信箱后补 `C0.port_seen`，失败不写；中心页回流入口仍可用。
- 五材：`applyInventoryCosts` 不再只遍历 crystal/starcrystal，卖出/扣料五种材料全部生效；新增 12/12 回归（含混合库存/不足/幂等）。
- 长局：commission-core 缓冲满后按 kind 汇总 count/最大值/最后上下文，结算并入摘要；2048 长局 1024 不再丢；E5b/E5c 覆盖。
- 慢启动：16 游戏 career ticket 等待窗 3.5s→10s，经典兜底后 late ticket 不再切模式；真实 3.9s 延迟验证。
- 慢加载：不再为切回职业清经典 `runs:v1`；真实星海旧档 + 2.2s ending-reducer 延迟逐字节不变。
- 终局：career 级 `ending-reservation`（migrations 唯一键）原子抢锁，跨标签仅一个赢家；失败/放弃释放。
- 首通：`commission-first` 原子预留 + quest 检查，跨标签不同票据首通奖只发一次，另一票为重复薪资。
- 其他：替换导入后当前页立即采用恢复状态；备份行上限 20000；双页发现快照合并；市场操作 ID 加会话前缀；记忆翻牌 T3/T5 与五子棋 session.finish 改为真实配对/落子门槛；制造按逐级累计成本；武力终局加载已装备机体；锁定章节不泄漏正文/事实；章节面板可回信箱/告示板；清理尾部空行与绝对路径。

复测：campaign E2E 701/701、world 109/109、a11y 75、PWA 17、smoke 113、mobile 318、backup 34、db 38、commission 63、ending 34、graph 48/48；p1-1/p1-4/p1-5/p1-6/p2-1/p2-3/p2-4/p2-5/p2-8 独立探针全 PASS。完整聚合门禁在本机两次卡在 PWA P16（单独运行 17/17 通过），未把该次写成全量 PASS；96 单跑见下。


**G18 PASS**（第二轮独立复审，B1–B5 全部关闭；门禁与独立复测全绿）。W11 已由主控修复并独立复测（告示板终局按钮真实导航到对应终局 run）。G18 PASS ≠ 发布授权。

## 复审 b71a264 后的再次修复（本地，未发布）

第二次复审确认 6 项 P1 中 4 项已修，仍报 2 项 P1 与 7 项 P2；本轮已处理：

- 终局预留改为带 owner 的 `ending-reservation`：同票据刷新可恢复；其它票据放弃只释放自己的预留；持有者 run 仅 failed/abandoned 才允许回收；真实三终局场景验证 winner 唯一收据/C5、loser `already-resolved`、重复结算读原收据。
- 慢启动共享模式：bridge `bootTimedOut` 后 late ticket 拒绝激活，4 款棋牌/落物页补 `__arcadeMode='classic'`；延迟 4.8s 的真实服务器验证只经典、无职业 run/收据。
- 首通预留带 ticket：同票据中断恢复领 90 + 首通旗标；不同活跃票据仍只发 75。
- 发现写入改为 DB 同事务读-合-写；空 clues 普通保存不再覆盖，显式清空仍走 resetDiscovery。
- 备份 DB 导入上限 5000→20000；真实 5001 行导出/回导通过；替换导入同步本页 cached careerId，章节面板读取新生涯 C0。
- 市场「卖出全部」使用会话前缀 ID，刷新后可再卖；制造卡显示累计报价，DB 购买事务拒绝降级/重复扣款。
- 章节 C2/C4 的 `anyCommissions` 移入 `requires`，运行时实际生效；溢出汇总保留 theme/level 上下文分组，storm/blockade 不再互相覆盖。

复测：campaign E2E 701/701、world 109/109、a11y 75、PWA 17、smoke 113、commission 64/64、db 38、backup 34、ending 34、graph 48/48；96 全部 16 游戏分批/单游戏 PASS；p1-6、p2-1、p2-2、p2-3、p2-4b、p2-5、workshop、blackjack 慢启动探针 PASS。完整聚合门禁在 `8fc73f1` 实跑 **ALL GATES PASSED（exit 0）**；第二次整轮唯一一次 CH-SB-002 波动已在 `8fc73f1` 前以 shadow 卷轴重试消除，第三次整轮通过。


**G18 PASS**（第二轮独立复审，B1–B5 全部关闭；门禁与独立复测全绿）。随后全分支复审提出的 P1/P2 已在 `6481322` 修复并逐项复测；G18 PASS ≠ 发布授权。

## 第三轮复审（400db62）后的修复（HEAD `009bc77`，已过完整门禁）

第三轮复审提出 2 个 P1、5 个 P2；回归用例先在 `219bd67`（基线 `400db62`）落地并失败，随后在 `009bc77` 修复：

- 终局：新增 `career-db.settleEndingAndClaim`，在同一个 IndexedDB readwrite 事务内完成 claim 唯一性、C5/终局 quest 行、收据/流水、balance/inventory、run=claimed；别的路线已提交时 `already-resolved` 且零写入；`updateRun` 拒绝 claimed → failed/abandoned，失败/放弃不再能覆盖赢家。
- 中断恢复：`repairEndingRecords` 从正常入口补齐历史“已领奖缺 C5”记录（复用原收据、不新增流水），清理无收据旧预留；同票据重交读原收据。
- 首通：普通委托一次事务内读 quest 选择首通/重复计划，`firstClearReceiptId` 持久化；旧 `commission-first` 占位不再消耗首通；测试 B=90、A=75、旗标/证据引用完整。
- 制造：请求携带 `expectedLevel`，事务比对当前装备等级；旧面板报价返回 `price-changed` 零写入，面板刷新新价；重放购买 ID duplicate 零扣款。
- 发现：`mergeDiscoveryState` 按动作合并最新状态；SET_HINTS 才改提示，RUN_ENDED 用基线 delta 累加计数，跨标签清空/导入不复活旧线索。
- 备份：统一导出/导入 32 MiB 字节预算与 20000 行上限；2000 条 2.1 MiB 真实 run 导出可回导。
- 路线：C2 要求 `E-snowbells.T3 + E-snake-run.T3`，C4 要求 `E-mole-whack.T3 + E-block-drop.T3 + BP-merge-2048.T3`；chapter 配置证据白名单自动纳入委托奖励 token，world-state 按 evidenceAll 判定。

验证：新增 `career_review3_regression_test`、`career_review3_workshop_test`、`career_route_evidence_test` 已加入 `arcade_run_all_gates.py`。在 `009bc77` 实跑完整聚合门禁 **ALL GATES PASSED（exit 0）**，日志 `REVIEW3-GATE4.log`；campaign E2E 700/700、96 全绿、PWA 17/17、96 三终局/历史修复/首通/制造/发现/备份/路线均通过。


**G18 PASS**（第二轮独立复审，B1–B5 全部关闭；门禁与独立复测全绿）。随后两轮全分支复审提出的 P1/P2 已在本分支修复并复测；G18 PASS ≠ 发布授权。

## 第四轮复审（9ce51ec）后的修复（HEAD `ab79c79`，已过完整门禁）

第四轮复审提出 1 个 P1、4 个 P2；附录同路线探针先在基线 `9ce51ec` 实跑 exit 1（两张武力收据/两条流水），修复后在 `ab79c79` 通过：

- P1 同路线双票：终局事务以该生涯的规范终局收据 ID 判断唯一性；已有任何终局（包括同路线另一张票）时，当前票只有等于规范收据才幂等，其他票返回 `already-resolved` 零写入。页面同路线捷径区分原票/他票，不再 `ok:true` 配空收据。门禁 `career_review4_same_route_test.mjs` 按报告附录真实页面交错时序回归。
- P2 清除旧标签：发现状态新增代次元数据 `discovery-generation`；设置清除/替换导入递增代次并同步本页；`mergeDiscoveryState` 拒绝旧代次动作。正常入口清除后旧标签结算不会把旧线索写回，独立 discovery 表保持为空。
- P2 旧档首通：`hasPendingFirstClear` 用旧占位 + 实际同版本重复收据/流水证明未发首通；下一张成功票补发一次首通计划（90 + 旗标/证据/首通引用），之后继续 75。
- P2 导出边界：导出与导入共享 32 MiB + 单表 20000 行上限；20000 行可导出/回导，20001 行导出即 `too-many-rows`，设置面板显示原因。
- P2 C2/C4 面板：章节内容回退路径把 evidence 传给 `contentRoutesOf`；提示改用告示板真实委托名（冰桥观察/生态样本/检修记录/信标电路）。

验证：`career_review4_same_route_test` 已加入门禁；`career_review3_regression_test` 增加旧档补发、清除代次、20000/20001 行断言。`ab79c79` 实跑 `py -3 tools/arcade_run_all_gates.py` **ALL GATES PASSED（exit 0）**，日志 `REVIEW4-GATE6.log`（4452 行）；campaign 700/700、96 96/96、gameplay 104/104、PWA 17/17。


**G18 PASS**（第二轮独立复审，B1–B5 全部关闭；门禁与独立复测全绿）。随后三轮全分支复审提出的 P1/P2 已在本分支修复并复测；G18 PASS ≠ 发布授权。

## 第五轮复审（50af2f1）后的修复（HEAD `8267038`，已过完整门禁）

第五轮复审的 1 个 P1 已在上轮关闭，本轮修复 2 个 P2，并补齐 Chrome 隔离：

- P2 替换导入代次倒退：`career-db.importAll` 在同一个 readwrite 事务内先读本地代次、清空/写入后写 `local+1`；忽略档案携带的 `discovery-generation`；导出默认排除该内部元数据。`getDiscoverySnapshot` 在同一只读事务返回状态与代次，页面写入要求代次完全相等；旧页冲突时重新载入最新状态并返回未保存，不再提交旧快照。覆盖无代次、更低代次、更高代次三份档案。
- P2 preserved 空导入写库：bridge 在 `preserved:true` 或 `mode:'none'` 时直接返回，发生在 `ensureCareer`、代次推进和重载之前；空库与已有生涯均验证零写入，原标签随后仍可写入一次真实提示设置。
- Chrome 隔离：`launchChrome` 支持 `--remote-debugging-port=0` 从独立 profile 的 `DevToolsActivePort` 读取实际端口并核对 `/json/version`；固定端口先做占用检测，被占用时无副作用失败，绝不连接/清理占用者；`stopChrome` 只处理本次子进程句柄。新增 `career_chrome_isolation_test` 哨兵用例。

验证：`career_review5_import_test`（8/8）与 `career_chrome_isolation_test`（5/5）已加入门禁。`8267038` 实跑 `py -3 tools/arcade_run_all_gates.py` **ALL GATES PASSED（exit 0）**，日志 `REVIEW5-GATE.log`（4469 行，无 RETRY）；campaign 700/700、96 96/96、gameplay 104/104、PWA 17/17。


**G18 PASS**（第二轮独立复审，B1–B5 全部关闭；门禁与独立复测全绿）。随后四轮全分支复审提出的 P1/P2 已在本分支修复并复测；G18 PASS ≠ 发布授权。

## 第六轮复审（ea15623）后的修复（HEAD `aca3cd4`，已过完整门禁）

第六轮复审的导入问题已关闭；本轮修复 2 个产品 P2 与 Chrome 隔离缺口：

- Chrome 固定端口归属：预检后仍在窗口期被占用时，`launchChrome` 会通过 `/json/version` 的 Chrome 身份 + CDP WebSocket `Browser.getVersion` 确认端口属于本次 Chrome；哨兵/替身直接失败，不连接、不返回成功。
- 启动失败清理：恢复子进程 `error` 监听并与 `exit`、就绪过程一起竞速；无效 Chrome 路径立即拒绝，异常/退出都会删除本轮临时 profile，不再出现 unhandled error。
- `saveState` 代次校验：公开快照写入也携带 `SAVE_STATE` 动作元数据，与动作类型独立；旧标签保存旧快照返回 `{ok:false,error:'stale-generation'}`，两张发现表不被写回，重载后的新快照可保存。
- 设置开关冲突：`setHintsEnabledDetailed` 返回结构化结果；写入被拒时面板恢复真实 `aria-checked`/文案并播报失败，只有真正落库后才显示「关」。紧接一次重试可关闭并持久化。

验证：`career_review5_import_test` 扩展到 **12/12**，`career_chrome_isolation_test` 扩展到 **6/6**（含无效路径与 profile 清理）。`aca3cd4` 实跑 `py -3 tools/arcade_run_all_gates.py` **ALL GATES PASSED（exit 0）**，日志 `REVIEW6-GATE.log`（4474 行，无 RETRY）。


**G18 PASS**（第二轮独立复审，B1–B5 全部关闭；门禁与独立复测全绿）。随后五轮全分支复审提出的 P1/P2 已在本分支修复并复测；G18 PASS ≠ 发布授权。

## 第七轮收口（ae88f29）后的修复（HEAD `9851aac`，已过完整门禁）

按收口清单一次性修复三类共享逻辑：

- Chrome 归属贯穿启动与连接：固定端口在首次 CDP 握手前要求 Chrome 身份 + `Browser.getVersion`；`openPage` 通过本轮归属注册表核对 browser WebSocket 路径后才新建 target。启动错误/提前退出/超时会 abort 未完成的端口轮询、HTTP 与 WebSocket 握手；无效路径/提前退出均清理本轮 profile。
- 发现动作按事务内当前状态归约：`SET_HINTS` 只改偏好；`CLUE_OPENED/LETTER_FOLLOWED` 要求当前 DB 仍有线索；`SAVE_STATE` 合并线索（保留 openedAt/dismissed）与阶段单调前进；RUN_ENDED 保持 delta 计数。同代次 A 读信 + B 改设置不再擦掉已读时间/阶段，两枚线索并集与 discovery 行一致。
- 保存/清除/信箱按确认结果更新：`saveState` 对快照采集代次做弱引用校验，旧对象重载后仍被拒；设置普通写入失败恢复 DB/内存/UI 一致并提示，重试可完成；清除失败保留线索，重试可清空；旧信箱/旧线索不推进 C0，当前有效线索仍可幂等推进。

验证：新增 `career_closeout_test` **5/5**，`career_review5_import_test` **12/12**，`career_chrome_isolation_test` **7/7**。`9851aac` 实跑 `py -3 tools/arcade_run_all_gates.py` **ALL GATES PASSED（exit 0）**，日志 `CLOSEOUT-GATE.log`（4482 行，无 RETRY）。


**G18 PASS**（第二轮独立复审，B1–B5 全部关闭；门禁与独立复测全绿）。随后六轮全分支复审提出的 P1/P2 已在本分支修复并复测；G18 PASS ≠ 发布授权。

## 收口复测（2f3bcf2）后的修复（HEAD `8b41986`，已过完整门禁）

按复测报告补齐三项残余：

- Chrome 固定端口不再直接复用：请求的固定端口只作调用方兼容别名，实际进程始终使用独立临时 profile 的动态端口；`openPage` 通过归属表解析实际端口并核对 browser WebSocket，两个同轮实例请求同一固定端口时页签只落在本轮实例。固定端口预检占用仍无副作用失败；错误/退出/超时取消未完成握手。
- 快照代次可复制：公开 `state()` 在快照内携带可枚举 `__snapshotGeneration`，`saveState` 先校验对象弱身份或 JSON 复制后的内联代次；同一旧快照及其 JSON 复制版在重载后继续被拒，失去代次的快照返回明确 `missing-snapshot-generation`。
- 两张发现表同源：RUN_ENDED/重复发现写独立 discovery 行时与现有行合并，已读 `openedAt` 不再被空值覆盖；`OPENED/HINTS` 同代次交错后 state 与 discovery 的 `openedAt` 相等。
- 信箱 C0 边界：`syncCampaignFlags(mailboxOpened:true)` 在当前 DB 仍至少有一条线索时才推进 C0；旧标签 chip、章节「回信箱」与投递都不能在恢复空档后写 `story:C0.port_seen`，当前有效读信仍幂等推进。

验证：`career_closeout_test` **5/5**（含 JSON 复制快照、重复发现 openedAt、旧信箱 C0）、`career_chrome_isolation_test` **8/8**（含两个固定端口请求）、`career_review5_import_test` **12/12**。`8b41986` 实跑 `py -3 tools/arcade_run_all_gates.py` **ALL GATES PASSED（exit 0）**，日志 `VERIFY-GATE.log`（4487 行，无 RETRY）。


**G18 PASS**（第二轮独立复审，B1–B5 全部关闭；门禁与独立复测全绿）。随后七轮全分支复审/收口提出的 P1/P2 已在本分支修复并复测；G18 PASS ≠ 发布授权。

## 收口复验（6c208e1）后的修复（HEAD `f87e690`，已过完整门禁）

补齐三条剩余边界：

- 失效端口别名：`openPage` 在发送 `/json/version` 或 `/json/new` 前必须命中本轮归属表；停止实例后旧固定端口别名直接拒绝，不再回退到未登记端口。两个同轮实例请求同一固定端口、停止前旧别名只命中第二实例、停止后拒绝均有探针覆盖。
- 重复阅读两表一致：`CLUE_OPENED` 写独立 discovery 行时保留首次 `openedAt`，与 state 使用同一事务合并结果；同标签重读与两标签重复发现后两张表时间相等。
- C0 写事务守卫：`putQuestsGuarded` 在写章节旗标的同一事务内重核发现代次与“当前仍有线索”；回信箱检查通过后若发生替换导入，旧请求返回 `stale-generation`/`no-clue` 零写入。当前有效读信仍幂等推进。

验证：`career_chrome_isolation_test` **9/9**、`career_closeout_test` **6/6**、`career_review5_import_test` **12/12**。`f87e690` 实跑 `py -3 tools/arcade_run_all_gates.py` **ALL GATES PASSED（exit 0）**，日志 `FINAL-GATE.log`（4489 行，无 RETRY）。


**G18 PASS**（第二轮独立复审，B1–B5 全部关闭；门禁与独立复测全绿）。随后七轮全分支复审/收口/复测提出的 P1/P2 已在本分支修复并复测；G18 PASS ≠ 发布授权。

## 结论

**G18 PASS**（第二轮独立复审，B1–B5 全部关闭；门禁与独立复测全绿）。随后多轮全分支复审/收口/复验提出的 P1/P2 已在本分支修复并复测；G18 PASS ≠ 发布授权。

## 首轮阻塞与本轮关闭

| 阻塞 | 关闭证据 |
|---|---|
| B1 中心页「旧港来信」`?story=1` gate=c0 | `loadStorySnapshot` 解析已存在生涯；独立 F1/F2：cards=6、gate=false、readonly=false |
| B2 章节正文 body 未渲染 | `bodies=6`，含真实章节正文；跨页入口同验 |
| B3 支线 links 与线索 ID 不匹配/目录当已发现 | 5 家族 links 全为真实线索 ID；1 线索→仅命中家族，2 线索→2 家族；无 XL 残留 |
| B4 verify_deploy 缺 0.18 内容 | 新增 11 路径，PATHS 87 全存在，0.18 内容 12/12；静态检查 exit 0 |
| B5 告示板无章节/终局 | `[data-town-campaign]` 六章、C4 前三终局隐藏、C4 后三按钮可见可点；W11 点击真实导航 |
| W11 终局按钮点击无效 | `startEnding` 懒加载终局模块；独立点击脚本 `runCommissionId=ending.combat`、`isCommissionRun=true` |

## 门禁结果（第二轮独立 Reviewer 实跑）

- `py -3 tools/arcade_run_all_gates.py` → **ALL GATES PASSED**（HEAD `a84d15f`；96 一次跑完、最长单游戏 245.6s）。
- 0.18：campaign-core 53/53、ending-reducer 34/34、graph 48/48 路径（1089 checks，死锁 0）、world-state 109/109、campaign E2E 701/701（3 路线、3 终局、备份恢复 24/24）。
- 0.17 回归：96/96 tiers、3792/3792 checks、235/235 samples；resume 45/45、mobile 318/318、rental 153/153、db 38/38、backup 34/34、crystal 8/8；a11y 75/75、reachability 165、PWA 17/17、smoke 113/113、review 5/5、gameplay 104/104 + 22/22、stage_coverage PASS。
- 独立复测：`g18-real-paths` 44/44、combat 13/13、rescue 11/11、recheck 29/29、town-ending click PASS。
- 最终 HEAD `118f1cc` 受影响项复跑：campaign E2E 701/701、world 109/109、graph 48/48、a11y 75/75、PWA 17/17、W11 点击 PASS。完整聚合门禁在 `118f1cc` 复跑时环境卡在 96 fixture 启动（无失败输出），以 `a84d15f` 的全绿聚合 + `118f1cc` 受影响项复跑作为最终证据，未伪造为同一 HEAD 全量。

## 版本链 / 隔离 / 发布边界

- engine/sw（`studiokit-arcade-0.18.0-v1`）/index/registry/16 内容/模块常量/validate/verify_deploy/SW CORE_PATHS 均 0.18.0；无 0.17.0 运行时残留；历史 DESIGN/CHANGELOG 未误改。
- 96 告示板不含终局；终局 C5 唯一、幂等、失败可重试、credits 0；经典 5 键/挑战/禅/割草/旧机库零改动；首屏无生涯 CTA。
- 无发布动作；在线双端 `verify_deploy` 未运行（无授权/无网络），不得声称线上一致。

## 已知残留（非阻塞，公开推送前处理）

- 真机触控/读屏器/PWA 安装态/Safari/Firefox 与离线章节面板：UNVERIFIED。
- 刷新清空本页终局事件缓冲（需重打未结算进度）；多标签并发未复测。
- 试玩文档为仓库外证据；公开仓库只保留运行时可公开内容，无完整规划/隐藏条件/谜题路线。
- W1 mailbox Esc 叠层、W4 E2E 测试卫生、W5 路线产证展示差异、W10 首入依赖线索 chip、W12 清空线索后支线回退（合成/离线渲染策略）为 WARN。
