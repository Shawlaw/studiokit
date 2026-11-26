# Arcade 0.21.1 集成与验证（本地修复，未发布）

- 本地产品分支：`fix/arcade-career-entry-0211`，HEAD `242d0a3`；文档分支：`codex/career-entry-0211-docs`（基于 `242d0a3` 的独立 worktree，只改文档 / 任务记录）。
- 基线：0.21.0，2026-11-26 已双端发布，main `14a19b0`，Actions `45750286945` 全绿，双端 89/89 一致。
- 设计 / 回滚：`apps/arcade/DESIGN-0.21.1.md`；0.21.0 接口冻结：`docs/arcade-life/ADR-interfaces.md` §22；门禁分层：`tools/README-gates.md`。
- 本文件只记录实际发生的事情。**0.21.1 未发布**：线上仍为 0.21.0，版本链 / SW 缓存键仍为 0.21.0 / `studiokit-arcade-0.21.0-v1`；没有 `PUBLISH_TO_MAIN`，不声称 Actions 或双端校验成功。

## 1. 交付范围

- 修正 0.21.0「身份建立后也无内容入口」的过度实现：身份一旦建立，中心页在经典目录旁显示常驻「旧港生涯」内容入口，直达 `?careerPanel=town`；身份建立前仍只有被动来信小字。
- 中心页始终没有生涯视图 / 默认视图切换，也不恢复常驻告示板 / 信箱 / 章节链接；经典目录、排序记忆、页尾管理与积分记录不变。
- 封存时隐藏内容入口与来信小字，页尾保留「生涯设置（已封存）」；解冻后恢复内容入口；完全重置后内容入口与设置入口一起消失。
- 只改中心页 HTML / CSS 与对应断言；不改 localStorage key、IndexedDB v1 / 11 stores、`contentVersion 0.18.0`、玩法数值、关卡 / 挑战数据，不引入远程资源或后端。

## 2. 0.21.1 实际验证结果

| 项目 | 结果 | 说明 |
|---|---|---|
| `career_passive_entry_test.mjs` | **59/59 PASS** | 主 Agent 实际完成：身份建立前无内容入口、建立后常驻、封存隐藏、重置消失等断言 |
| `arcade_smoke.mjs` | **117/117 PASS（第一轮）** | 主 Agent 实际完成的第一轮；加入 320/375/390/430 四档窄屏增强断言后的**最终复跑仍待主 Agent** |
| 其他 Chrome 门禁 / 96 全量 / `full` profile / 真机 / 真人 | **UNVERIFIED** | 0.21.1 未执行，不以任何历史结果代替 |
| Actions / 双端线上 / `verify_deploy` | **未执行** | 本地未发布，无发布授权 |
| 文档工作树检查（静态校验、构建、README 链接、diff 空白） | 见本文件末尾「文档检查」小节 | 只覆盖文档改动，不等于产品门禁 |

## 3. 0.21.0 历史结果（已发布基线，不是 0.21.1 实跑）

以下数字来自 [`INTEGRATION-0.21.md`](INTEGRATION-0.21.md)，是 0.21.0 已双端发布的既有证据；**不得作为 0.21.1 已跑的证明**：

- static 35/35、archive 8/8、archive lifecycle 60/60、DB 38/38、backup 34/34、mobile 318/318、smoke 117/117、flow 339/339、PWA 18/18。
- 96 全量串行最终 16/16 游戏、96/96 tiers、3792/3792 checks；release profile 41/41 `release passed (not full)`（1801.411s）；`full` profile UNVERIFIED。
- 2026-11-26 已双端发布：main `14a19b0`，Actions `45750286945` 全绿，双端 89/89 文件一致；线上中心页 0.21.0。

## 4. 版本与兼容

- `engine.js` / `sw.js` / 中心页版本标记 / `shared/tool-registry.json` / `validate_site.py` / `verify_deploy.py` 的版本仍为 0.21.0；0.21.1 目前只是本地修复与文档目标版本，未做版本 bump。
- SW 缓存键仍为 `studiokit-arcade-0.21.0-v1`，升级仍按 0.19 策略只继承预载清单、重取当前页面。
- 生涯内容 `contentVersion 0.18.0`、`careerSchemaVersion 1`、`rulesetVersion 1`、IDB v1 / 11 stores 与经典 localStorage key 均未变化。
- 封存标记仍在既有 `state` store；完全重置仍不可回滚，需事先导出档案。

## 5. 未解决项与发布门槛

1. `arcade_smoke` 四档窄屏增强断言加入后的最终复跑仍待主 Agent 执行；在此之前 0.21.1 只有第一轮 smoke 与 `career_passive_entry` 的实测结果。
2. `full` profile、96 全量、PWA、mobile、首航等 0.21.1 回归未跑；真机 / 真人验证仍 UNVERIFIED。
3. 未版本 bump；若进入发布流程需先决定版本链与 SW 缓存键，并取得明确的 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`，随后双端 Actions 与逐文件校验均须实际成功。
4. 当前无 push、无 PR、无部署动作。

## 文档检查

本工作树执行并记录如下（只覆盖文档改动，不代表产品门禁重跑）：

- `py -3 -c "import json; json.load(...)"`：`tasks/queue.json` JSON 解析通过。
- `py -3 tools/validate_site.py`：PASS，exit 0。
- `py -3 tools/build_site.py`：PASS，exit 0（产物写入被忽略的 `dist/`）。
- `py -3 tools/check_readme_links.py`：PASS，9 份文档的链接、锚点与表格一致，exit 0。
- `git diff --check`：无空白错误，exit 0。
