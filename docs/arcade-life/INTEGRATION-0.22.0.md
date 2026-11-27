# Arcade 0.22.0 集成与验证

- 状态：RELEASE_READY（本地发布准备完成；未获 `PUBLISH_TO_MAIN`，未发布）
- 设计 / 回滚：[`DESIGN-0.22.0.md`](../../apps/arcade/DESIGN-0.22.0.md)
- 基线与版本：`68529dd` → 本分支本地提交；Arcade `0.22.0`，SW `studiokit-arcade-0.22.0-v1`
- 冻结边界：IDB `studiokit:arcade:career` v1 / 11 stores；`contentVersion 0.18.0`；经典 localStorage key 与玩法数值零改动。

## 1. 已完成任务

| 任务 | 状态 | 证据 |
|---|---|---|
| T00 基线审计 | PASS | `execution/T00-state-audit.md`、`T00-test-audit.md`、`T00-cross-review.md`（仓库外） |
| T01 接口冻结 | PASS | ADR §23；`career_profession_state_test.mjs` 431/431；三轮独立 review |
| T02 发现/bridge | PASS（范围） | discovery 84/84；entry-router 37/37；passive 71/71；profession-discovery 145/145 |
| T03 DB/迁移 | PASS（范围） | profession DB 33/33；archive 8/8；DB A 11/11；backup A 19/19 |
| T04 投影/核心 gate | PASS（范围） | commission 100/100；profession-view 613/613 |
| T05 世界工作/路线 | PASS（范围） | world-work 400/400；route 214/214；campaign 54/54；graph 1089/1089，48/48 |
| T06a 工作/经历 UI | PASS（范围） | UI work/journal 37/37；town flow 26/26；recommend preload 15/15 |
| T06b 邀请/工具 UI | 待终审 | invitation/tools、mailbox、receipt、passive |
| T07 扩展/隐私/旧档测试 | 待复跑 | extension、privacy、legacy 三个新增测试 |

## 2. 共享接口冻结

- `state['discovery']` 扩展：`professionVersion`、`firstDiscoveredGameId`、`acceptedOriginGameId`、`activeProfessionId`、`narrativeCursor`、`storyEvents`、`professionProgress`。
- 纯模块：`profession-state.js`、`profession-view.js`；DB owner：`career-db.applyProfessionEvent`；bridge 门面：`careerView`、`acceptProfessionInvitation`、`setActiveProfession`、`setProfessionPaused`、`invitationForClue`、`onCareerDataChanged`、`invalidateCareerData`。
- 世界通用工作：`content/world-work.json`；`commission-core` 与 route/campaign 通过同源注入读取，不硬编码职业/游戏数量。

## 3. 门禁记录

### 3.1 集成纯逻辑/L1（SHA `52ab52d`）

- 26 个精确 runner 串行执行，全部 exit 0；完整逐项日志在仓库外 `execution/T08-pure-gates.log`。
- 关键数量：profession-state 431/431、discovery 84/84、profession-discovery 145/145、profession DB 33/33、commission 100/100、profession-view 613/613、world-work 400/400、graph-reachability 1089/1089（48/48 路径）、extension 92/92、privacy 2367/2367、legacy 54/54、UI work/journal 39/39、invitation/tools 55/55、receipt 134/134。
- `py -3 tools/validate_site.py` PASS；`git diff --check` PASS。

### 3.2 真实 IDB/L2（SHA `52ab52d`）

- `node tools/career_db_test.mjs --only=B`：27/27，exit 0。
- `node tools/career_backup_test.mjs --only=B`：15/15，exit 0。
- 测试夹具已同步加载 `profession-state.js`，坏数据/往返断言按 additive 扩展与单调时间语义更新，未降低产品断言。

### 3.3 L3 首轮与修复

- 首轮 `py -3 tools/arcade_run_all_gates.py --profile release`（SHA `52ab52d`）：41 项中 35 PASS / 6 FAIL，571.645s；失败为 `career_ending_reducer`、`career_continuation`、`career_pwa_offline`、`career_96_missions`、`career_mobile`、`career_flow_e2e`。
- 定位到两类契约迁移问题：旧测试/夹具未先显式接受职业；DB 动作名误写为 `GLIMPSIED` 而真实事件为 `GLIMPSED`。
- 动作名修复后 `career_pwa_offline` 18/18；profession DB 33/33、extension 92/92。纯 ending/continuation 夹具修复为 35/35、18/18。
- 96 fixture 代表样本通过（static 34/34、2 games、12 tiers、runner 474/474）；移动端 330/330；首航全流程 376/376。
- 第二次 release 门禁冻结 SHA `28d4b2373b3e9510148de5773df6361b774667aa`：`py -3 tools/arcade_run_all_gates.py --profile release` **41/41 PASS**，2838.147s，`verdict: release passed (not full)`，日志在仓库外 `execution/T08-release-gate-2.log`。首轮失败项均通过；`fully_passed=false`，不宣称 full 或 ALL GATES PASSED。
- 本 SHA 没有同 SHA 的线上 CI/双端发布证据；CI 仍只覆盖 static，release 为本机真实 Chrome 串行结果。未运行 full、真机或线上部署。

## 4. 发布准备

- 未获 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`；不 push main、不合并 main、不打 tag、不创建 Release、不部署。
- 正式发布需双目标（GitHub Pages 项目站点 + Cloudflare Pages `studiokit`）同 SHA 通过既有 workflow 与 `verify_deploy.py`；一次授权覆盖两端。
