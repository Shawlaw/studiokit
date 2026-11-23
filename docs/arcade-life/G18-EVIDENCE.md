# G18 独立门禁证据摘要（Arcade 0.18.0，本地未发布）

- 分支：`feat/arcade-life-015`（本地）；审核 HEAD：`a84d15f`（第二轮 PASS），随后 `118f1cc` 修复 W11（告示板终局懒加载）；远端 `main` 仍 `afc5fd4`，无 push/tag/部署/`OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`。
- 契约：ADR §20；设计/回滚：`apps/arcade/DESIGN-0.18.0.md`；集成：`INTEGRATION-0.18.md`。
- 完整原始证据在仓库外：`qa/evidence/G18-AUDIT.md`（首轮 FAIL，B1–B5）、`G18-AUDIT-2.md`（第二轮 PASS + W11）、`G18b-runall.log`、`G18b-recheck.log`、`g18-real-paths/mjs` 等；不含剧透内容。

## 结论

**G18 PASS**（第二轮独立复审，B1–B5 全部关闭；门禁与独立复测全绿）。W11 已由主控修复并独立复测（告示板终局按钮真实导航到对应终局 run）。G18 PASS ≠ 发布授权。

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
