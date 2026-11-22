# Arcade 0.15.0 — The Whisper（悄然回响）设计与回滚

- 发布日期：未发布（本地分支 `feat/arcade-life-015`，等待 Owner 发布授权）
- 基线：0.14.0（`afc5fd4`）
- 关联：`docs/arcade-life/ADR-interfaces.md`（接口冻结）、`docs/arcade-life/ACTUAL-HOOKS.md`（真实事件锚点）、`docs/arcade-life/STORAGE-AUDIT.md`（存储事实）、`docs/arcade-life/INTEGRATION-0.15.md`（版本链/门禁）

## 1. 目标与边界

0.15 只做“世界的第一次出现”，不做经济与生涯玩法：

1. 16 款游戏都能在**正常经典游玩**中被动产生一条不剧透的微线索；不点不打扰，忽略后可从信箱找回，可关闭/恢复。
2. 没有显眼的“生涯模式”入口、没有签到/每日/概率/强制弹窗；首页与中心页不新增 CTA。
3. 经典、挑战（78 关）、禅、星海割草、星海经典星币与机库行为零改动；线索不产生货币/材料/`careerId`。
4. 新增**独立 IndexedDB** 生涯数据层（发现状态 + 为 0.16 准备的账户/流水/领奖表结构），不写既有 localStorage 键。
5. 新运行时全部 fail-open：内容/DB/UI 任一失败时回到“原游戏 + 无生涯 UI”。

## 2. 运行时结构

```
apps/arcade/career/
  bridge.js          游戏页唯一入口（同步定义 window.ArcadeCareer，异步装载依赖）
  router.js          gameId / base / content URL（GH 子路径 / CF 无后缀 / file:// 兼容）
  registry.js        数据驱动游戏/职业/委托/故事注册表（17 款插拔由契约测试覆盖）
  discovery.js       发现状态机纯函数（DORMANT→…→EXPLORER）
  career-core.js     纯函数：ID/奖励计划/收据/购买计划/故事上下文
  career-db.js       IndexedDB v1（11 stores、单事务领奖、claim 幂等、多标签安全）
  entry-router.js    16 源归一化入口（数据驱动，无 16 硬编码）
  backup.js          独立 careerLife 导出/导入/迁移
  content/registry.json  游戏清单/职业/watch 事件（运行时内容）
  content/clues.json     16 条微线索内容（运行时内容）
  ui/clue-surface.js|css 结算处微线索 chip（44px 热区/键盘/读屏/reduced-motion）
  ui/mailbox.js          旧港信箱与信件（可关闭、可找回、可投递到 LOCAL）
  ui/settings.js         线索提示开关 + 清除线索（二次确认）+ 旧港档案导入导出
```

加载：游戏页 `engine.js → career/bridge.js → challenge/*.js → 页内脚本`。`bridge` 只读观察真实状态事件；`finish()` 每局一次把事件汇总交给 discovery；发现证据写入 IDB；`?careerTest=1` 才暴露测试钩子，仅 `#test` 时完全静默（现有 smoke/回归不受污染）。

## 3. 数据与不变量

- DB：`studiokit:arcade:career` v1，stores：`state/discovery/profiles/runs/claims/ledgers/balances/inventory/equipment/quests/migrations`。
- 0.15 游玩路径只写 `state`（发现快照/偏好）与 `discovery`（线索证据）；其余表由 `career_db_test` 验证事务/幂等/多标签，但 0.15 不产生经济记录。
- 经典 localStorage 7 键不变；`engine.js` 不新增存储 key、不写 IDB。
- 线索阈值/保底在 `content/clues.json`；每局最多 1 条、保底 ≤3 局、mow 不计有效局。
- 版本字段：`careerSchemaVersion=1`、`contentVersion=0.15.0`、`rulesetVersion=1`。

## 4. 16 款游戏适配（只读）

统一最小改动：head 加 1 行 bridge 脚本；页内加 `const career = window.ArcadeCareer || null;`；在真实状态提交点加 1–2 行 `career.observe(kind, payload)`；自然结算处加 1 次 `career.finish({mode:'classic',...})`。挑战局不产生线索事件；星海 mow 显式排除；层塔稳定层在 `settleDrop` 提交后取值、不挂 0.9s 结算回调；16 款事件 kind 与 `content/registry.json` 唯一权威逐字一致。

## 5. 测试与门禁

- 纯 Node：`career_registry_test`（90 项，含虚拟第 17 款插拔）、`career_discovery_test`（84 项，16 源单源可达）、`career_legacy_baseline_test`（78 项，0.14.0 契约金样）。
- Chrome/CDP：`career_db_test`（38 项：事务/幂等/多标签/配额失败）、`career_backup_test`（格式/迁移/旧档/坏档回滚）、16 款游戏适配的 CDP 实测（每组独立证据）。
- 既有回归：`arcade_smoke`、`arcade_gameplay_test --suite=all`、`arcade_tower_test`、`arcade_zen_scores_test`、`arcade_calm_games_test`、`arcade_review_test`、`arcade_interaction_test`、`arcade_immersive_buttons_test`、`arcade_pwa_update_test`，以及 `validate_site/build_site/check_inline_scripts/design_check/stage_coverage`。
- 全部证据路径与命令见仓库外 `qa/evidence/`；G15 门禁另见 `docs/arcade-life/G15-EVIDENCE.md`（生成后）。
- 真机 iPhone/Android 触控与 PWA 安装/更新时机：**UNVERIFIED**，需 Owner 复测。

## 6. 已知风险

- 事件是真实状态派生，但 payload 字段语义/单位仍需 0.16 委托目标（`objective.context`）消费时校验；`theme` 目前取 `run.theme.id`。
- 部分游戏（memory-flip 经典仅通关结算、solitaire 手动结束）依赖事件阈值而非局末保底；首局 1–3 分钟内可达，已由内容与 CDP 实测约束。
- 浏览器 `file://` 下 IDB/fetch 行为未实测；按设计 fail-open（无线索 UI、经典照常）。
- `arcade_design_check` 的 135 vs 历史文档 143、78 关 17 关 absent 属既有基线问题，不在本版修复。
- 本地 `arcade_run_all_gates.py` 覆盖不全（tower/immersive/interaction/pwa 需单独跑）；发布前按 `INTEGRATION-0.15.md` 清单逐条执行。

## 7. 回滚

1. 代码回滚：`git revert` 0.15 批次（B02/0.15 提交），或从 `afc5fd4` 重新拉分支；本版未推送远端。
2. 版本链回退：engine `ARCADE_VERSION`、sw `VERSION`、registry arcade 版本、index 静态版本串、validate 四处断言、6 个测试脚本断言一并回退；SW 旧缓存由 `activate` 清理。
3. 数据：0.15 不迁移/不删除经典数据；IDB 为新增库，旧页面忽略。需要清除线索时用设置面板独立二次确认；卸载 PWA/清除站点数据会清 IDB。
4. 若需临时关闭功能而不回滚代码：设置面板关闭“街机里的神秘线索”（不丢已发现内容）；或移除 16 页 bridge 脚本标签（经典立即恢复原状）。
