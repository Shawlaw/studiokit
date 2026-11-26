# Arcade 0.21.1 集成与验证（已双端发布）

- 本地分支 `fix/arcade-career-entry-0211`。T142 入口补丁的产品代码截止 `87746d4`，以 `89fd9e6` 为 T143 复审补丁基线。
- 基线：0.21.0（2026-11-26 已双端发布，main `28a0182`，Actions `45752833025` 全绿，双端 89/89 一致）。
- 设计 / 回滚：`apps/arcade/DESIGN-0.21.1.md`；0.21.0 接口冻结：`docs/arcade-life/ADR-interfaces.md` §22；门禁分层：`tools/README-gates.md`。
- **2026-11-26 已双端发布**：main `cbfeef6`，[Actions 45840350943](https://github.com/Shawlaw/studiokit/actions/runs/45840350943) 全部成功；双端 `verify_deploy.py` **90/90** 文件一致，Arcade 0.21.1 / SW `studiokit-arcade-0.21.1-v1`。

## 1. 交付范围

- 修正 0.21.0「身份建立后也无内容入口」的过度实现：生涯身份一旦建立，中心页在经典目录旁显示常驻「旧港生涯」内容入口，直达 `?careerPanel=town`；身份建立前仍只有被动来信小字。
- 中心页始终没有生涯视图 / 默认视图切换，也不恢复常驻告示板 / 信箱 / 章节链接；经典目录、排序记忆、页尾管理与积分记录不变。
- 封存时隐藏内容入口与来信小字，页尾保留「生涯设置（已封存）」；解冻后恢复内容入口；完全重置后内容入口与设置入口一起消失。
- 入口隐藏时移除 `href`，不可聚焦。T143 让首页和宿主页使用同一只读判定。正常档以及可唯一定位且档案、账册齐全的旧档进入告示板。残缺或无法唯一确认的旧档显示具体原因、返回街机厅入口和导入原档指引，避免点回港后停在层塔开局。
- 首单结算后从收据主动作直接回告示板，剧情回信仍可另读。交付「旧档案夹」实际新解锁「差一张的照片」时，收据写明两单关系。
- 到港第一句由阿德确认收到二十一点单据，或由老周确认收到记忆翻牌的存根。无法从既有多来源旧档核对实际投递物时显示中性确认。「港口实习」仍是默认推荐。「看看出航」默认收起，展开后才显示阿砾、租机说明与已解锁的「首次巡航」，并复用现有接单和机库入口。
- 不改 localStorage key、IndexedDB v1 / 11 stores、`contentVersion 0.18.0`、玩法数值、关卡 / 挑战数据，不引入远程资源或后端。

## 2. T142 入口补丁验证结果

| 项目 | 结果 | 说明 |
|---|---|---|
| `arcade_run_all_gates.py --profile static --workers 3` | **35/35 PASS** | `static passed`，6.762s |
| `career_passive_entry_test.mjs` | **61/61 PASS** | 身份建立前无入口、建立即常驻、旧档 C0、封存 / 解冻 / 重置、代际防竞态 |
| `arcade_smoke.mjs` | **117/117 PASS** | 最终复跑；含 320/375/390/430 四档入口热区与溢出、点击进告示板、封存隐藏、解冻恢复、重置消失 |
| `career_mobile_016_test.mjs` | **318/318 PASS** | 四档面板、键盘、reduced-motion、PWA safe-area、触控 |
| `career_pwa_offline_test.mjs` | **18/18 PASS** | 0.21.1 缓存、0.18.2 预载清单迁移、GH 子路径与 CF 无后缀 |
| `career_archive_lifecycle_e2e_test.mjs` | **60/60 PASS** | 真实 IDB + 双 CDP 标签，封存 / 解冻 / 重置 / 旧标签阻断 |
| 独立只读复审 | **APPROVE，无 P0** | 发现的测试桩保真 P1 已修正并补旧档 / 解冻覆盖 |
| `release` profile | **41/41 PASS** | 稳定 HEAD `5e3f2af`，`release passed (not full)`，1799.477s |
| 96 全量 E2E | **16/16 游戏、96/96 tiers、3792/3792 checks PASS** | release profile 内一次通过，0 环境错误 |
| `full` profile、真机 / 真人 | **UNVERIFIED** | 本补丁未执行，不以 0.21.0 历史结果代替 |
| Actions / 双端线上 / `verify_deploy` | **PASS** | Actions `45840350943` 全绿；双端 90/90 文件一致，Arcade 0.21.1 |

## 3. T143 整体验证

产品提交为 `68b83fb`（到港）、`5d45afc`（收据）、`eef710b`（回港）和 `425656e`（矮屏首航）。集成测试提交为 `c4574bd`、`c565c97`、`25e5d1d`、`e2ba8f4`、`b71be01`、`d9a962f` 和 `c2080d4`，测试说明见 `0187fe7`。T142 结果保留在上一节。

| 项目 | 结果 | 执行范围 |
|---|---|---|
| `static` profile | **35/35 PASS** | 最终集成 |
| `career_passive_entry_test.mjs` | **71/71 PASS** | 最终集成 |
| 收据专项 | **134/134 PASS** | 最终集成 |
| `career_town_flow_test.mjs` | **24/24 PASS** | 最终集成 |
| `arcade_smoke.mjs` | **118/118 PASS** | 最终产品版。真实旧档复用原档和钱包，孤立 C0 明确提示并提供返回入口 |
| `career_mobile_016_test.mjs` / `career_pwa_offline_test.mjs` / `career_archive_lifecycle_e2e_test.mjs` | **319/319 / 18/18 / 60/60 PASS** | 单项串行通过。移动端实际展开出航，机库入口热区 69×44 |
| 章节面板 / DB / 备份专项 | **145/145 / 38/38 / 34/34 PASS** | 独立执行 |
| `career_flow_e2e_test.mjs` | **404/404 PASS** | 二十一点与记忆翻牌真实进港，首单收据从界面续接，失败后签新票并成功，跨标签恢复原票和 nonce，原页打开后日谈 |
| 真机 / 真人 | **UNVERIFIED** | 无真实设备或真人体验证据 |
| Actions / 双端线上 | **PASS** | main `cbfeef6`，Actions `45840350943`，双端 90/90 |

第三轮首航为 398/400。两处失败分别是折叠内容可见性判定与影跃目标比较。当时 375×548 的出航摘要在 y575–619，这项为独立的首屏位置测量。矮屏调整后，集成 `c2080d4` 的最终复跑在 375×548 实测接单按钮 y372–416、「看看出航」y437–481，两项都能在未滚动时实际点中。首两单的收据也在该视口实点「回告示板看看」，均在当前页打开告示板。

## 4. T142 修复过程中的真实失败

- 首次增强 smoke 复跑发现仍在断言 0.21.0，版本 bump 后同步为 0.21.1。
- 四档窄屏断言误用了不存在的 `setViewport` helper；改为 smoke 现有的 `Emulation.setDeviceMetricsOverride` 后最终 117/117 通过。
- 独立复审指出原 IDB 桩的 `getAll()` 返回包装对象、数组 key 不一致、重置用例替换了 fixture 引用，可能造成假通过；已按真实 IndexedDB 语义修正，最终 61/61。

## 5. 版本与兼容

- `engine.js` / `sw.js` / 中心页版本标记 / `shared/tool-registry.json` / `validate_site.py` 与相关测试断言均为 0.21.1。
- SW 缓存键 `studiokit-arcade-0.21.1-v1`；升级仍按 0.19 策略只继承预载清单、重取当前页面。
- `validate_site.py` 与 `verify_deploy.py` 发布清单已纳入 `DESIGN-0.21.1.md`。
- 生涯内容 `contentVersion 0.18.0`、`careerSchemaVersion 1`、`rulesetVersion 1`、IDB v1 / 11 stores 与经典 localStorage key 均未变化。
- 封存标记仍在既有 `state` store；完全重置仍不可回滚，需事先导出档案。

## 6. 未解决项与发布门槛

1. T143 最终 `release` profile 41/41 与 96 委托全量 E2E 已通过；`full` profile 未执行，真机与真人首航仍待验证。
2. 发布已完成：Actions `45840350943` 全部成功，双端逐文件校验 90/90。
3. 封存期间内容入口按 0.21.0 既有语义隐藏；若 Owner 希望封存时仍显示常驻入口，需要另行调整产品语义。

## 7. 发布后证据

- 发布提交：`cbfeef6`；[Actions 45840350943](https://github.com/Shawlaw/studiokit/actions/runs/45840350943) 的 Validate and build、Arcade static gates、Deploy GitHub Pages、Deploy Cloudflare Pages、Verify both deployments 全部成功。
- 双端校验：`verify_deploy.py --base https://shawlaw.github.io/studiokit/ --base https://studiokit.pages.dev/` → **90/90 files identical**，Arcade 0.21.1 / Badge 2.2.1 / Venue 0.2.0。
- Cloudflare 线上浏览器实测：中心页 `Arcade.version=0.21.1`、16 卡、无生涯视图；建立测试身份后「旧港生涯」入口可见、44px、`?careerPanel=town`，测试档案随后清理。GitHub Pages 的旧 Service Worker 仍可能短时提供 0.21.0 缓存，文件校验已确认部署产物为 0.21.1。
- `full` profile 与真机 / 真人仍 UNVERIFIED。
