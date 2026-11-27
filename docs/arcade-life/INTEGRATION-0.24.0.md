# Arcade 0.24.0 集成与验证

- 状态：**本地发布准备，未发布**（未获 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`，未 push、未打 tag、未部署）
- 门禁状态：**待 L3（lead）**。本轮只做纯文本 / 静态校验与纯 Node 复跑，没有浏览器、release、full、watch 结论；不写 GATE_PASSED、不写 ALL GATES PASSED。
- 设计 / 回滚：[`DESIGN-0.24.0.md`](../../apps/arcade/DESIGN-0.24.0.md)；数据 / 叙事契约：[`ADR-0.24-world.md`](ADR-0.24-world.md)（T20 冻结，T24 增补 §9）、[`tools/career_world_narrative_schema.json`](../../tools/career_world_narrative_schema.json)
- 基线：0.23.0 候选 `79301da`（GATE_PASSED / RELEASE_READY，本地发布准备，未发布；其 L3 为 47/47 `release passed (not full)`，见 [`INTEGRATION-0.23.0.md`](INTEGRATION-0.23.0.md)）；0.24 开发分支自 `cf81f12` 起基于该候选。版本链 0.24.0，SW `studiokit-arcade-0.24.0-v1`。
- 冻结边界：IDB v1 / 11 stores、经典 localStorage key、`contentVersion 0.18.0`、`professionVersion 1`、`rulesetVersion`、经典玩法数值与封存 / 导入 / 重置语义全部不变。

## 1. 任务台账（T20–T25）

| 任务 | 内容 | 状态 | 证据 |
|---|---|---|---|
| T20 契约冻结 | `ADR-0.24-world.md`、`tools/career_world_narrative_schema.json`、`tools/career_world_narrative_contract_test.mjs`；只产出契约，不改 runtime / 内容 / 版本链 | PASS（契约层） | `node tools/career_world_narrative_contract_test.mjs` **158/158**（`202d116` 复跑）；`py -3 tools/validate_site.py` PASS |
| T21 主线深度 | 世界主线替代路线叙事合理化 + 章节前置 / 完成解释（`route-planner.chapterAlternatives`、`campaign-core` 解释、`world-work.json` 通用文案）；不新增委托 / 奖励 | PASS（数据范围） | `node tools/career_world_route_narrative_test.mjs` **80/80**；同轮 `career_route_planner_test` 214/214、`career_world_work_test` 400/400、`career_economy_balance_test` 47/47、`career_world_narrative_contract_test` 158/158、`career_campaign_core_test` 54/54（提交 `7164c4c` 记录） |
| T22 交汇 + 纯 resolver | 新增 `career/content/world-narrative.json`（7 替代 + 10 交汇 + 17 经历白名单）与 `career/world-narrative.js` 纯 resolver；双方接受、未接受零透露、去重 / 幂等、无奖励 | PASS（数据范围） | `node tools/career_world_narrative_test.mjs` **163/163**（`b54fc4a` 复跑） |
| T23 经历与人物反馈 | 新增 `career/ui/journal.js` 经历筛选 / 回读，`ui/town.js` 接入经历页；无总数、无内部 id、迁移覆盖 | PASS（范围） | `node tools/career_journal_experience_test.mjs` **49/49**（`e581fae` 复跑） |
| T24 世界叙事可见化 | bridge 按需加载 / catalog 注入（`worldNarrative`、`publicStoryEvents{label,text,person}`、按章 `worldChapterAlternatives`）、`profession-view` 加性 `detail`、章节面板与港口经历页公开文案、SW 预缓存 | PASS（纯 Node 范围） | `career_world_narrative_contract_test` **166/166**、`career_world_narrative_test` **179/179**、`career_journal_experience_test` **59/59**（HEAD 复跑，见 §3）；`career_route_planner_test` 214/214、`career_economy_balance_test` 47/47（HEAD 复跑） |
| T25 版本链与公开文档 | 版本链 0.23.0 → 0.24.0 全引用点同步；新增本记录与 `DESIGN-0.24.0.md`；CHANGELOG / README / BASELINE / AGENTS / ROADMAP / TASKS / queue / apps README 同步 | 待 L3（lead） | 见 §3；浏览器 / release / full 未执行 |

## 2. 集成事实

- **世界主线替代叙事**：`route-planner.chapterAlternatives()` 为 C1–C5 逐章给出替代指引，锚点只能是 6 种真实机制（世界通用工作 / 本职业委托 / 明码代办 / 免费租机 / 商店材料 / 证据组合）；`requiresSpecificProfession` 恒 `false`，落款只从真实内容读，收据只在真实结算行存在时渲染。`catalog.worldNarrative` 缺失时与 0.23 逐字节同形。
- **章节前置解释**：`campaign-core` 的 `chapter.prerequisite` / `chapter.completion` 用既有 `evalRequirement` 计算 `met`，文字逐项来自真实 token；章节面板与港口经历页只渲染公开文本，内部结构不进 DOM，无数据不建节点。
- **可选职业交汇**：16 条职业声明折叠为 10 个无序对；触发要求双方 `accepted/developed/completed`（`paused` 不阻塞），surface 限定 `port/journal/message/receipt/toast/deep-link`；同对只保留一个 owner、事件只写一次（`RECORD_STORY_EVENT`，duplicate 视为成功）；`effects: []` 与 `grants` 全零是内容层硬约束，不改主线、不发奖励。未接受一侧不产出节点，连「存在交汇」都不提示。
- **经历筛选 / 回读**：17 条白名单（10 交汇 + 7 世界替代）合成 `publicStoryEventIds` / `publicStoryEvents`；`profession-view` 只在内容声明时追加 `detail{text,person}`；`ui/journal.js` 人物筛选只取实际出现的人名、职业筛选只取已接受职业，无数据不渲染筛选器；`storyEvents` 落盘形状仍只有 `at` / `source`。
- **bridge / SW**：`world-narrative.js` 与内容按需加载（可选、lazy），普通游戏首屏零生涯加载；SW 预缓存追加 `./career/world-narrative.js`、`./career/ui/journal.js`、`./career/content/world-narrative.json`，缓存迁移策略不变；`VERSION` 随版本链升至 0.24.0（缓存键 `studiokit-arcade-0.24.0-v1`）。
- **降级**：内容 / 模块 / 事实任一缺失 → 交汇与替代叙事为空、经历只显示代码冻结白名单；`professionVersion > 1` → 空视图、只读、不回写；0.23 的界面、封存 / 导入 / 重置 / 备份语义不受影响。

## 3. 门禁记录（本轮实际执行）

只做纯文本 / 静态校验与纯 Node 复跑；未启动 Chrome，未跑 release / full / watch，未 push。下列计数均为本轮在 HEAD 实际运行结果（退出码 0）：

- `node tools/career_world_narrative_contract_test.mjs` **166/166**
- `node tools/career_world_narrative_test.mjs` **179/179**
- `node tools/career_journal_experience_test.mjs` **59/59**
- `node tools/career_world_route_narrative_test.mjs` **80/80**
- `node tools/career_route_planner_test.mjs` **214/214**
- `node tools/career_economy_balance_test.mjs` **47/47**
- `node tools/career_world_work_test.mjs` **400/400**
- `node tools/career_legacy_baseline_test.mjs` **78/78**（版本链一致性：engine / sw / registry / 中心页 / `validate_site.py` 字面量逐项相等，不硬编码版本号）
- `node tools/career_profession_extension_test.mjs` **92/92**（含 `sw.js VERSION === engine ARCADE_VERSION`）
- `py -3 tools/validate_site.py` **PASS**
- `py -3 tools/check_readme_links.py` **PASS**
- `node --check apps/arcade/engine.js`、`node --check apps/arcade/sw.js`、registry / queue JSON 解析 **PASS**
- `git diff --check` **PASS**

历史时点计数（分别在对应提交上复跑，不是本轮 HEAD 数字）：T20 `158/158`（`202d116`）、T22 `163/163`（`b54fc4a`）、T23 `49/49`（`e581fae`）；T21 的 `80/80` 与其同轮 214/214、400/400、47/47、158/158、54/54 来自提交 `7164c4c` 的记录，其中 80/80 与 214/214 本轮在 HEAD 复跑一致。

## 4. 未验证项（UNVERIFIED，留给 L3 / lead）

- **release profile 与 full profile**：0.24 尚未跑 `py -3 tools/arcade_run_all_gates.py` 的任何 profile；没有 release / full 结论。
- **浏览器门禁**：`arcade_smoke`、`career_flow_e2e`、`career_pwa_offline`、`arcade_pwa_update`、`arcade_calm_games`、`arcade_interaction`、`arcade_zen_scores`、`career_discovery_accessibility`、`career_passive_entry` 等含版本字面量的测试本轮**只改字面量、未运行**（需 Chrome）。
- **真机**：iOS / Android 触控、PWA 安装与更新、离线往返；**真人**：叙事可读性与交汇触发体感；**线上**：未部署，无 CI、无 Actions、无 `verify_deploy.py` 结果。
- **门禁登记（事实）**：`tools/arcade_run_all_gates.py` 已在 static 段登记 4 个 0.24 纯 Node 套件（world narrative contract / world narrative / world route narrative / journal experience，均为 static 类，默认进入 static / release / full 三个 profile）；因此 release profile 的条目数预期从 0.23 的 47 增至 **51**（0.23 的 47 + 4），实际条目与结果以 L3 运行为准。本任务未改该文件。
- **本任务改动面**：`tools/verify_deploy.py` 的 `PATHS` 追加 `career/world-narrative.js`、`career/content/world-narrative.json`、`career/ui/journal.js` 与 `apps/arcade/DESIGN-0.24.0.md`（当前 110 条），发布时的逐文件计数会相应增加。

## 5. 发布准备

- 未获 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`；不 push main、不打 tag、不创建 Release、不部署。
- 正式发布需双目标同 SHA 通过 workflow 与 `verify_deploy.py`；一次授权覆盖两端。
- 发布前至少需要：L3 release profile 通过、版本链复核（engine / sw / index / registry / validate_site / verify_deploy 一致）、`git grep` 复核 0.23.0 只余历史文档。
