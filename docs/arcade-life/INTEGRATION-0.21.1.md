# Arcade 0.21.1 集成与验证（本地修复，未发布）

- 本地分支：`fix/arcade-career-entry-0211`，HEAD `87746d4`。
- 基线：0.21.0（2026-11-26 已双端发布，main `28a0182`，Actions `45752833025` 全绿，双端 89/89 一致）。
- 设计 / 回滚：`apps/arcade/DESIGN-0.21.1.md`；0.21.0 接口冻结：`docs/arcade-life/ADR-interfaces.md` §22；门禁分层：`tools/README-gates.md`。
- **0.21.1 未发布**：线上仍为 0.21.0；本地版本链已同步 0.21.1 / SW `studiokit-arcade-0.21.1-v1`。没有 `PUBLISH_TO_MAIN`，不声称 Actions 或双端校验成功。

## 1. 交付范围

- 修正 0.21.0「身份建立后也无内容入口」的过度实现：生涯身份一旦建立，中心页在经典目录旁显示常驻「旧港生涯」内容入口，直达 `?careerPanel=town`；身份建立前仍只有被动来信小字。
- 中心页始终没有生涯视图 / 默认视图切换，也不恢复常驻告示板 / 信箱 / 章节链接；经典目录、排序记忆、页尾管理与积分记录不变。
- 封存时隐藏内容入口与来信小字，页尾保留「生涯设置（已封存）」；解冻后恢复内容入口；完全重置后内容入口与设置入口一起消失。
- 旧档无 profile 但有 C0 的兼容状态同样显示入口。入口隐藏时移除 `href`，不可聚焦。
- 不改 localStorage key、IndexedDB v1 / 11 stores、`contentVersion 0.18.0`、玩法数值、关卡 / 挑战数据，不引入远程资源或后端。

## 2. 0.21.1 实际验证结果

| 项目 | 结果 | 说明 |
|---|---|---|
| `arcade_run_all_gates.py --profile static --workers 3` | **35/35 PASS** | `static passed`，6.762s |
| `career_passive_entry_test.mjs` | **61/61 PASS** | 身份建立前无入口、建立即常驻、旧档 C0、封存 / 解冻 / 重置、代际防竞态 |
| `arcade_smoke.mjs` | **117/117 PASS** | 最终复跑；含 320/375/390/430 四档入口热区与溢出、点击进告示板、封存隐藏、解冻恢复、重置消失 |
| `career_mobile_016_test.mjs` | **318/318 PASS** | 四档面板、键盘、reduced-motion、PWA safe-area、触控 |
| `career_pwa_offline_test.mjs` | **18/18 PASS** | 0.21.1 缓存、0.18.2 预载清单迁移、GH 子路径与 CF 无后缀 |
| `career_archive_lifecycle_e2e_test.mjs` | **60/60 PASS** | 真实 IDB + 双 CDP 标签，封存 / 解冻 / 重置 / 旧标签阻断 |
| 独立只读复审 | **APPROVE，无 P0** | 发现的测试桩保真 P1 已修正并补旧档 / 解冻覆盖 |
| `release` / `full` profile、96 全量 E2E、首航、真机 / 真人 | **UNVERIFIED** | 本补丁未执行，不以 0.21.0 历史结果代替 |
| Actions / 双端线上 / `verify_deploy` | **未执行** | 本地未发布，无发布授权 |

## 3. 修复过程中的真实失败

- 首次增强 smoke 复跑发现仍在断言 0.21.0，版本 bump 后同步为 0.21.1。
- 四档窄屏断言误用了不存在的 `setViewport` helper；改为 smoke 现有的 `Emulation.setDeviceMetricsOverride` 后最终 117/117 通过。
- 独立复审指出原 IDB 桩的 `getAll()` 返回包装对象、数组 key 不一致、重置用例替换了 fixture 引用，可能造成假通过；已按真实 IndexedDB 语义修正，最终 61/61。

## 4. 版本与兼容

- `engine.js` / `sw.js` / 中心页版本标记 / `shared/tool-registry.json` / `validate_site.py` 与相关测试断言均为 0.21.1。
- SW 缓存键 `studiokit-arcade-0.21.1-v1`；升级仍按 0.19 策略只继承预载清单、重取当前页面。
- `validate_site.py` 与 `verify_deploy.py` 发布清单已纳入 `DESIGN-0.21.1.md`。
- 生涯内容 `contentVersion 0.18.0`、`careerSchemaVersion 1`、`rulesetVersion 1`、IDB v1 / 11 stores 与经典 localStorage key 均未变化。
- 封存标记仍在既有 `state` store；完全重置仍不可回滚，需事先导出档案。

## 5. 未解决项与发布门槛

1. `release` / `full` profile、96 全量 E2E、首航未跑；真机 / 真人验证仍 UNVERIFIED。
2. 未 push、未 PR、未部署；若进入发布流程需取得明确的 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`，随后双端 Actions 与逐文件校验均须实际成功。
3. 封存期间内容入口按 0.21.0 既有语义隐藏；若 Owner 希望封存时仍显示常驻入口，需要另行调整产品语义。
