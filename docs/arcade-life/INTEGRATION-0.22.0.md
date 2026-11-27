# Arcade 0.22.0 集成与验证

- 状态：LOCAL_VERIFIED / 待最终门禁与独立 review 收口（未完成前不得写 RELEASE_READY 或 PUBLISHED）
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

本文件将在 T08 补入：冻结 SHA、精确命令、filter、测试数量、耗时、退出码、L2/L3 结果、CI 复用判定、漏测项与发布准备结论。当前不得据局部测试推断版本门禁已通过。

## 4. 发布准备

- 未获 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`；不 push main、不合并 main、不打 tag、不创建 Release、不部署。
- 正式发布需双目标（GitHub Pages 项目站点 + Cloudflare Pages `studiokit`）同 SHA 通过既有 workflow 与 `verify_deploy.py`；一次授权覆盖两端。
