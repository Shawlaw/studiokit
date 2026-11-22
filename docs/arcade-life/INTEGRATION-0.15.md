# 0.15 集成、版本链与门禁记录

状态：IN_PROGRESS（D15-17 整合中；完成后冻结）
分支：`feat/arcade-life-015`（本地，未推送）
基线：`afc5fd4`（Arcade 0.14.0）

## 1. 版本目标（0.15 / The Whisper）

- 16/16 游戏都能在**正常经典游玩**中被动产生一条不剧透微线索；无线索时经典/挑战/禅/割草体验与 0.14.0 等价。
- 没有显眼的“进入生涯模式”入口；不点线索完全不受影响；忽略后可找回；可在设置中关闭/重新开启。
- 只读观察与线索不产生任何货币、材料、`careerId`；生涯经济档案在 0.16 玩家主动签收后才创建。
- 新增独立 IndexedDB 生涯数据层（发现状态与后续账本），不写既有 localStorage 键。

## 2. 0.15 新增/修改文件

新增（运行时，会随 `apps/` 发布）：
- `apps/arcade/career/registry.js`、`discovery.js`、`career-core.js`、`career-db.js`、`bridge.js`、`router.js`、`entry-router.js`、`backup.js`
- `apps/arcade/career/content/registry.json`、`clues.json`
- `apps/arcade/career/ui/clue-surface.js`、`clue-surface.css`、`mailbox.js`、`settings.js`

修改（受控最小）：
- 16 个 `apps/arcade/games/*.html`：加载 `../career/bridge.js`；在真实事件锚点调用 `observe`；在自然结算调用一次 `finish`；保留原有全部探针与行为。
- `apps/arcade/sw.js`：`VERSION` 升 0.15.0；`CORE_PATHS` 追加 career 运行时/内容/UI/CSS（离线可读信箱）。
- 版本链：`engine.js`、`sw.js`、`shared/tool-registry.json`、`apps/arcade/index.html`、`tools/validate_site.py`、相关测试断言、README/CHANGELOG/AGENTS/BASELINE 等。
- `tools/verify_deploy.py`：`PATHS` 追加 career 静态资源（发布前）。
- 不修改：`engine.js` 的任何存储 APIs/玩法逻辑；中心页不新增显眼生涯入口（如需信箱找回入口，只做角落小字，并在 G15 复验）。

## 3. 数据与事务（摘要）

- DB：`studiokit:arcade:career` v1，11 个 stores（见 ADR §7）。
- 0.15 只写：`state`（发现状态、偏好）、`discovery`（线索证据）。
- `claims/ledgers/balances/inventory/equipment/quests` 建表并由 `career_db_test` 验证事务/幂等，但 0.15 游玩路径不产生经济记录。
- 经典 localStorage 7 键不变；`#test` 静默（无 `?careerTest=1` 时不写 DB、不渲染）。

## 4. 版本链清单（0.15.0 必改）

硬门禁（逐项）：
1. `apps/arcade/engine.js` `ARCADE_VERSION = '0.15.0'`
2. `apps/arcade/sw.js` `VERSION = '0.15.0'`（缓存键自动变 `studiokit-arcade-0.15.0-v1`）
3. `shared/tool-registry.json` arcade `version` + description（非剧透）
4. `apps/arcade/index.html` `data-hall-version>0.15.0`
5. `tools/validate_site.py`：ARCADE_VERSION / data-hall-version / SW VERSION / registry 版本与文案
6. `tools/validate_site.py` `REQUIRED` 增加 `apps/arcade/DESIGN-0.15.0.md`，并建议加入 `tools/career_*_test.mjs`
7. `tools/verify_deploy.py` `PATHS` 增加 career 资源

测试断言：
8. `tools/arcade_smoke.mjs` 版本断言 6 处
9. `tools/arcade_zen_scores_test.mjs` 2 处
10. `tools/arcade_calm_games_test.mjs` 1 处
11. `tools/arcade_interaction_test.mjs` 1 处
12. `tools/arcade_pwa_update_test.mjs` 9 处（整体改为 0.15.0 → 0.15.1 发版链路）

文档/元数据（事实同步，非剧透）：
13. `README.md`、`START-HERE.md`、`AGENTS.md`、`apps/arcade/README.md`、根 `CHANGELOG.md`、`apps/arcade/CHANGELOG.md`
14. `docs/BASELINE.md`（新增 career 存储事实）、`docs/ARCHITECTURE.md`（存储清单）、`docs/ROADMAP.md`、`docs/RELEASE-RUNBOOK.md`、`docs/DECISIONS.md`
15. `apps/arcade/manifest.webmanifest` / `index.html` meta description（仅在用户可见事实变化时）
16. `TASKS.md` / `tasks/queue.json` 追加任务行（不改历史）
17. 新建 `apps/arcade/DESIGN-0.15.0.md`（设计/回滚，非剧透；不写剧情路线）
18. `docs/arcade-life/INTEGRATION-0.15.md`（本文件，不上线）

## 5. 测试与门禁

### 5.1 本地实跑结果（2026-11-22/23，分支 `feat/arcade-life-015`）

| 类别 | 命令 | 结果 |
|---|---|---|
| 静态 | `py -3 tools/validate_site.py` / `build_site.py` / `node tools/check_inline_scripts.mjs` / `arcade_design_check.py` / `arcade_stage_coverage.mjs` / `check_readme_links.py` | 全部 exit 0 |
| 纯 Node | `career_registry_test` 90/90；`career_discovery_test` 84/84；`career_legacy_baseline_test` 78/78；`career_entry_router_test` 37/37 | 全部 exit 0 |
| Chrome/CDP | `career_db_test` 38/38；`career_backup_test` 34/34；`career_games_reachability_test` 161/161（16/16 真实可达）；`career_discovery_accessibility_test` 75/75；`career_pwa_offline_test` 17/17 | 全部 exit 0 |
| 既有回归（聚合器） | `py -3 tools/arcade_run_all_gates.py`：validate/build/design/inline/stage + career 全组 + smoke 113/113 + zen + calm + review + gameplay all/base | `ALL GATES PASSED` |
| 既有回归（聚合器外） | `arcade_tower_test` 23/23、`arcade_immersive_buttons_test` 32/32、`arcade_interaction_test` 5/5、`arcade_pwa_update_test` 9/9 | 全部 exit 0 |
| 独立门禁 | G15 Reviewer 复跑（见 `G15-EVIDENCE.md` 与仓库外证据） | 待/见该文件 |

> 说明：一次并行运行（多个 Chrome 门禁同时跑）曾导致 smoke 的星海核弹时序断言偶发失败；单独复跑 113/113 通过，并在无并发 Chrome 的干净环境重跑聚合器确认。报告与证据中保留该事实，不把并发抖动写成产品缺陷。

### 5.2 每次合入最低门禁

```powershell
py -3 tools/validate_site.py
py -3 tools/build_site.py
node tools/check_inline_scripts.mjs
node --check apps/arcade/engine.js
node --check apps/arcade/sw.js
node --check apps/arcade/career/<每个新 JS>
node tools/career_registry_test.mjs
node tools/career_discovery_test.mjs
node tools/career_entry_router_test.mjs
node tools/career_legacy_baseline_test.mjs
$env:CAREER_DB_PORT='8830'; $env:CAREER_DB_CDP_PORT='9430'; node tools/career_db_test.mjs
$env:CAREER_BACKUP_PORT='8831'; $env:CAREER_BACKUP_CDP_PORT='9431'; node tools/career_backup_test.mjs
$env:CAREER_A11Y_PORT='8832'; $env:CAREER_A11Y_CDP_PORT='9432'; node tools/career_discovery_accessibility_test.mjs
$env:CAREER_GAMES_PORT='8833'; $env:CAREER_GAMES_CDP_PORT='9433'; node tools/career_games_reachability_test.mjs
$env:CAREER_PWA_PORT='8839'; $env:CAREER_PWA_CDP_PORT='9439'; node tools/career_pwa_offline_test.mjs
py -3 tools/check_readme_links.py
py -3 tools/arcade_run_all_gates.py
```

### 5.3 G15 门禁（独立 Reviewer，全部实际执行）

- 16/16 游戏可被动触发线索；无显眼生涯 CTA；不点线索经典/挑战/禅/割草与 0.14.0 等价。
- 原 78 挑战关、星海氪金/机库、割草零经济回归：`arcade_smoke`、`arcade_gameplay_test --suite=all`、`arcade_tower_test`、`arcade_zen_scores_test`、`arcade_calm_games_test`、`arcade_review_test`、`arcade_interaction_test`、`arcade_immersive_buttons_test`、`arcade_pwa_update_test`。
- 数据壳：首次新档、旧档、损坏档、`#test` 静默、多标签 claim、备份导入导出（career 独立）。
- PWA：GH 子路径 + CF 无后缀、离线信箱、SW 升级不清 IDB。
- 320/375/390/430 布局、键盘、读屏、reduced-motion。
- **真机 UNVERIFIED**：iPhone/Android 触控手感、PWA 安装与更新提示时机，需 Owner 复测；报告中必须如实标注。

## 6. 回滚

- 代码：`git revert` 0.15 提交；或从 `afc5fd4` 重新拉分支。
- 数据：0.15 不迁移/不删除任何经典存储；IDB 为新增库，回滚后旧页面忽略它。若需彻底清除生涯线索，设置面板提供独立二次确认；卸载 PWA/清除站点数据会清 IDB。
- 版本：回退 engine/sw/registry/index 四处版本与 SW 缓存键；旧 SW 会在 `activate` 清理 0.15 缓存。

## 7. 已知风险 / UNVERIFIED

- 星海 `GameMeta.set` 整对象覆盖、层塔 `serialize` 无 mode 门禁、星海 `run:` 段只认 classic：0.16 前置修复清单（0.15 不触碰）。
- 部分游戏事件是派生判定（层塔稳定层、雪铃唯一铃、重力距离）：0.15 只用于线索，已按 B00-A 建议使用最可靠锚点；D15-16 用确定性 fixture 复验。
- `arcade_design_check` 135 vs 文档 143、78 关 17 关 absent：既有基线问题，不在 0.15 修复。
- 真机/PWA 实机、多标签 IDB 升级 `blocked`、`file://` IDB 行为：UNVERIFIED，需真机或后续浏览器实测。

## 8. 证据索引（仓库外，不提交）

- `qa/evidence/B00.md`、`B01.md`、`B02*.md`、`D15-*.md`、`G15-EVIDENCE.md`（后续）
- 原始侦察报告：`notes/B00-*.md`
- 进度：`planning/progress.json`
