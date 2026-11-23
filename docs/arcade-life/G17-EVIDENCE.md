# G17 门禁摘要（Arcade Life 0.17.0 — Living World）

- 分支：`feat/arcade-life-015`（本地，未推送、未发布）；基线 `afc5fd4`（0.14.0）；目标 0.17.0
- 独立审计：G17 Reviewer，两轮（首轮 FAIL → 修复 crystal 别名/脏树/a11y 后 PASS）
- 结论：**PASS**（HEAD `159babb`；工作树干净；远端 `main` 仍 `afc5fd4`；无 tag/upstream/push；无发布授权）
- 完整原始证据：仓库外 `qa/evidence/G17-EVIDENCE.md`（含首轮 FAIL 与复核附注）

## 门禁摘要

| 项 | 结果 |
|---|---|
| 96 委托 fixture 可达 + 后继 | PASS（内容 96/96、fixture 16/16；真实 Chrome 16/16 games × 6 tiers = **96/96 tiers、3792/3792 checks**；T4–T6 受控旗标 48/48；后继以解锁链/quest 行成立） |
| T1–T3 公开 / T4–T6 锁定 | PASS（初始 16 条 T1 可接；T2/T3/T4–T6 锁定；T1 清后 T2 出现；T2/T3+C3 后 T4 可接；T5/T6 仍锁；48 条 T4–T6 仅 3 个中性标题） |
| 五材经济不死锁 | PASS（materials 32/32、balance 47/47；来源 3/4/2/5/2、卖价≤买价×0.6、买→卖负利润、首通 3305/重复 8320/单局≤130；`crystal→starcrystal` 原子互通，新 `career_crystal_alias_test` 8/8） |
| 三模块战术差异 | PASS（combat 379/379；独立数值计算 shieldOnce/armorMul/magnet/energyCap/firepowerMul 五项差异；仅生涯星海生效，经典/挑战/割草零影响） |
| 16 起源无 CTA / 旧 78 关保持 | PASS（中心页 career 引用 0；reachability 165/165；gameplay 104/104 + base 22/22；calm 17/17；challenge 78 关数据/引擎零 diff） |
| 职业隔离/旧档 | PASS（resume 45/45、db 38/38、backup 34/34；16/16 `serialize()` 门禁；IDB v1/11 stores 未变；无 localStorage；经典 5 键逐字节） |
| 移动/PWA/a11y | PASS（mobile 318/318、PWA 离线 17/17、a11y 75/75——测试显式仿真 no-preference 后可复现） |
| 防剧透 | PASS（T4–T6 文案中性、内容只戏内信件；无 devkit 路径入库；dist 无 qa/test） |
| 发布授权 | **none**（远端 main 未动、无 push/tag/部署；无 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`） |

## 修复记录（G17 首轮 FAIL → PASS）

- **crystal 无限卖钱/旧库存不可买**：`career-db` 新增 `canonicalItemId/canonicalItemMap`；`applyInventoryCosts`/`sellItems` 优先扣旧 `crystal` 行、`incrementInventory` 写入归一到 `starcrystal`；新增真 Chrome/IDB 回归 8/8。
- **工作树脏**：rental `0.17.9` 修复提交，HEAD 干净。
- **a11y 宿主 reduce 波动**：B11/B27/B31 前显式 `Emulation.setEmulatedMedia no-preference`，门禁可复现 75/75。
- **归档 0.16 first-flight**：0.16 旧奖励金样不再适用 0.17 经济，归档为 `career_first_flight_test_016.mjs`；0.17 由 96 委托回归替代（见 `INTEGRATION-0.17.md`）。

## 未验证项（UNVERIFIED）

真机 iPhone/Android 触控与全屏安全区、VoiceOver/TalkBack、PWA 安装/更新时机、Safari/Firefox、真实断电、真实手指接单/购买/制造、96 阶人类时长与成功率、三模块真实受击的独立真机复现。

## 非阻断残留

- 全量 96 测试在最终修复后仅抽检（solitaire 6/6）；发布前建议再跑全量。
- 0.17 三模块缺仓库内独立效果断言（外部 D17-15 证据）。
- 公开文档仍命名 C3/C4/C5 剧情旗标（非答案）；fixture 4 条跨章 evidence WARN。
- 刷新清空本页事件缓冲；`minValidEngagement` 尚未被 runtime 消费；T6 高阈值依赖 100m 里程碑事件。
