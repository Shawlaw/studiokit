# Arcade 0.24.0 集成与验证

- 候选 `4f2d271` 复查修正后通过 release 51/51，见 §6。§3–§4 记录修正前的验证。累计发布采用 PR 验证与双端部署，见 §5。
- 修正前门禁状态：GATE_PASSED / RELEASE_READY（本地发布准备，未发布）。L3 release profile 在 `c5712e5` 通过 51/51；浏览器证据为 flow 624/624、mobile 334/334、smoke 119/119；独立复审 PASS（无 Blocker / 无 Major）。不写 PUBLISHED / ALL GATES PASSED，full / 真机 / 真人 / 线上仍 UNVERIFIED。
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
| T24 世界叙事可见化 | bridge 按需加载 / catalog 注入（`worldNarrative`、`publicStoryEvents{label,text,person}`、按章 `worldChapterAlternatives`）、`profession-view` 加性 `detail`、章节面板与港口经历页公开文案、SW 预缓存 | PASS（纯 Node 范围） | `career_world_narrative_contract_test` 166/166、`career_world_narrative_test` 179/179、`career_journal_experience_test` 59/59（提交 `83e867d` 时点）；`career_route_planner_test` 214/214、`career_economy_balance_test` 47/47 |
| T25 版本链与公开文档 | 版本链 0.23.0 → 0.24.0 全引用点同步；新增本记录与 `DESIGN-0.24.0.md`；CHANGELOG / README / BASELINE / AGENTS / ROADMAP / TASKS / queue / apps README 同步 | PASS（`c5712e5`） | release 51/51；浏览器与 release 证据见 §4，复查修正后的结论见 §6 |

## 2. 集成事实

- **世界主线替代叙事**：`route-planner.chapterAlternatives()` 为 C1–C5 逐章给出替代指引，锚点只能是 6 种真实机制（世界通用工作 / 本职业委托 / 明码代办 / 免费租机 / 商店材料 / 证据组合）；`requiresSpecificProfession` 恒 `false`，落款只从真实内容读，收据只在真实结算行存在时渲染。`catalog.worldNarrative` 缺失时与 0.23 逐字节同形。
- **章节前置解释**：`campaign-core` 的 `chapter.prerequisite` / `chapter.completion` 用既有 `evalRequirement` 计算 `met`，文字逐项来自真实 token；章节面板与港口经历页只渲染公开文本，内部结构不进 DOM，无数据不建节点。
- **可选职业交汇**：16 条职业声明折叠为 10 个无序对；触发要求双方 `accepted/developed/completed`（`paused` 不阻塞），surface 限定 `port/journal/message/receipt/toast/deep-link`；同对只保留一个 owner、事件只写一次（`RECORD_STORY_EVENT`，duplicate 视为成功）；`effects: []` 与 `grants` 全零是内容层硬约束，不改主线、不发奖励。未接受一侧不产出节点，连「存在交汇」都不提示。
- **经历筛选 / 回读**：17 条白名单（10 交汇 + 7 世界替代）合成 `publicStoryEventIds` / `publicStoryEvents`；`profession-view` 只在内容声明时追加 `detail{text,person}`；`ui/journal.js` 人物筛选只取实际出现的人名、职业筛选只取已接受职业，无数据不渲染筛选器；`storyEvents` 落盘形状仍只有 `at` / `source`。
- **bridge / SW**：`world-narrative.js` 与内容按需加载（可选、lazy），普通游戏首屏零生涯加载；SW 预缓存追加 `./career/world-narrative.js`、`./career/ui/journal.js`、`./career/content/world-narrative.json`，缓存迁移策略不变；`VERSION` 随版本链升至 0.24.0（缓存键 `studiokit-arcade-0.24.0-v1`）。
- **降级**：内容 / 模块 / 事实任一缺失 → 交汇与替代叙事为空、经历只显示代码冻结白名单；`professionVersion > 1` → 空视图、只读、不回写；0.23 的界面、封存 / 导入 / 重置 / 备份语义不受影响。

## 3. 门禁记录（本轮实际执行）

本节是 T24 收口时在提交 `1e6d631` 之前的工作树上做的纯文本 / 静态校验与纯 Node 复跑，未启动 Chrome，未跑 release / full / watch，未 push；浏览器与 release 证据在 §4，复查修正后的数字在 §6。下列计数均为当次实际运行结果（退出码 0）：

- `node tools/career_world_narrative_contract_test.mjs` **166/166**
- `node tools/career_world_narrative_test.mjs` **180/180**
- `node tools/career_journal_experience_test.mjs` **60/60**
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

## 4. 未验证项（UNVERIFIED）

- **浏览器门禁（已在 0.24.0 版本链之后实跑）**：`career_flow_e2e` **624/624**（150.1s，含 46 条 0.24 交汇/经历/章节指引 gate）、`career_mobile_016` **334/334**（131.0s）、`arcade_smoke` **119/119**（370.3s）；证据 SHA 为 `83e867d` + 已提交的 flow 测试 `349a304`，版本链之后由 L3 的 51/51 覆盖同一批 Chrome 门禁（`arcade_pwa_update`、`career_pwa_offline` 等）。
- **L3**：`py -3 tools/arcade_run_all_gates.py --profile release` 在 `c5712e5` **51/51 PASS**，2964.331s，`verdict: release passed (not full)`、`fully_passed: false`；日志 `execution/T25-release-gate-024.log`。门禁条目数由 0.23 的 47 增至 51（新增 4 个 0.24 纯 Node 套件），与本节登记一致。
- **独立复审**：`execution/V024-review.md` 判定 PASS（无 Blocker / 无 Major，6 条 Minor 属文档口径与覆盖缺口）；其中「179/179 → 180/180、59/59 → 60/60」的计数已在本记录更正。
- **真机**：iOS / Android 触控、PWA 安装与更新、离线往返；**真人**：叙事可读性与交汇触发体感；**线上**：未部署，无 CI、无 Actions、无 `verify_deploy.py` 结果；full profile 未运行。
- **已知内容边界（如实记录，不伪造数据）**：复查修正前，`journalWhitelist` 的 7 条 `world:*` 没有运行期写入方，经历页「按职业筛选」在真实数据下不出现筛选组，T24 E2E 曾按此如实断言。修正后 6 条由真实已清记录推导（见 §6 与 ADR §10.3）；免费租机不留持久记录，`world:C1.rental.old-wing` 仍没有写入方。
- **本任务改动面**：`tools/verify_deploy.py` 的 `PATHS` 追加 `career/world-narrative.js`、`career/content/world-narrative.json`、`career/ui/journal.js` 与 `apps/arcade/DESIGN-0.24.0.md`（当前 110 条），发布时的逐文件计数会相应增加。
- **ADR 决策**：`ADR-interfaces.md` 的 §24 不追加 0.24 接口章节；0.24 的接口/数据契约以 `ADR-0.24-world.md` + `ADR-0.23-ui.md` 为准（避免同一契约两处维护）。

## 5. 发布准备

- 本次经 Owner 授权，将 0.22、0.23 的改进随 0.24 通过同一个 PR 累计发布。PR 的构建与静态检查通过后合并；合并触发双端生产部署。部署状态以 [GitHub Actions](https://github.com/Shawlaw/studiokit/actions/workflows/deploy.yml?query=branch%3Amain) 对合并提交的结果为准。
- 正式发布需双目标同 SHA 通过 workflow 与 `verify_deploy.py`；一次授权覆盖两端。
- 发布前补测：在同一 Chrome 配置和项目站点路径下，由 `68529dd` 的 0.21.2 实际制品切换到 0.24.0。合成旧档的身份、钱包、待续委托、章节标记和经典进度均保留，旧版预载的游戏升级后仍能离线打开。

## 6. 复查修正（2026-11-28）

按原始契约复查候选实现后确认并修复的问题。全部是本地提交，未发布；版本链、IDB v1 / 11 stores、`contentVersion 0.18.0` 与 `professionVersion 1` 不变。契约细节见 [`ADR-0.24-world.md`](ADR-0.24-world.md) §10。

| 问题 | 修正 | 提交 | 定向证据 |
|---|---|---|---|
| 交汇写入入口接受任意非空事件 ID，不复核披露条件，也不回读；港口先渲染再异步落库，数据库拒绝或事务未提交时仍会显示成功；重开港口后经历页拿不到刚写入的交汇 | 只接受 `crossover:` 事件，写入前用同一 resolver 与当前事实复核并沿用发起时的代次；写入后必须回读确认才返回成功，港口只在成功后渲染，失败或未提交不显示、下次可重试；双标签竞争时先提交者展示一次；成功或 duplicate 后刷新同一港口的经历页 | `eeb4939` | 交汇浏览器场景 255/255（含写入被拒、事务未提交、双标签竞争） |
| 经历里的交汇没有职业关联，「按职业筛选」在真实数据下不可达 | 交汇经历行带两位参与职业，且只在双方都已接受时进入六个交汇面；导入的经历行不能替代接受事实；筛选按 `professionIds` 匹配 | `eeb4939` | narrative 200/200、交汇浏览器场景 |
| 7 条 `world:*` 世界替代经历没有任何写入方；代办一条的白名单 ID 还与节点 ID 不一致 | 新增只读纯函数 `deriveJournalEvents`，从真实已清的委托/代办/证据/采购记录推导，只进入经历面投影、不落盘；统一 ID 并加契约断言 | `eeb4939`、`8c1083e` | narrative 200/200（L01–L12）、contract 168/168；真实浏览器：外堤短巡结算后进入经历且不写 storyEvents |
| bridge 的按需加载对该模块返回只读门面，推导函数在真实浏览器里取不到 | 经历合成改读原始模块 | `8c1083e` | 完整浏览器流程 645/645 |
| 职业专属委托的替代叙事对所有已接受职业可见 | 该机制只在委托所属职业已接受时产出；其余五种机制对每个起源开放 | `eeb4939` | narrative H04（112 组合） |
| 交汇写入会改写叙事游标；经历接近上限时交汇记录可能被先淘汰，重开后再次首次触发 | 交汇与世界经历写入不改游标；淘汰先处理普通记录、最后处理交汇记录 | `eeb4939` | state 439/439、narrative F18a |
| 0.23 的六项修复（首到港归属与首单、旧档迁移入口、后续邀请、首到港恢复）未进入 0.24 | 逐个挑入并解决 bridge / 港口的冲突 | `0e777bd`、`a2a4bfa`、`ad6e1c0`、`ef13733`、`95c593e`、`68a4de4`、`bc67c96` | discovery 157/157、adapters 143/143、narrative content 628/628、legacy 73/73、port/journal 58/58 |
| 三个既有门禁的预期与修复后的行为不一致：封存往返与冒烟的旧档夹具（同 0.22 §5）；移动端测试把「层塔起源的到港面板没有首单动作」这一缺陷写成了预期（同 0.23 §6） | 旧档种子真实落盘并先正常启动一次再逐字节比对；冒烟只禁止产生另一个身份；移动端改为断言第一份工作出现在到港面板且未自动接单 | `c41df95`、`9247b06` | archive lifecycle 61/61、mobile 334/334、smoke 119/119 |

- **浏览器（`8c1083e`）**：`node tools/career_flow_e2e_test.mjs --crossover-only` **255/255**，57.8s；`node tools/career_flow_e2e_test.mjs` **645/645**，150.1s（原 624，新增 21 条：外堤短巡经历、职业筛选、经历页即时刷新、写入被拒 / 未提交 / 双标签、已有身份的后续邀请、离开后回到初次到港）。日志在仓库外 `execution/review-024-crossover-final.log`、`review-024-flow.log`。
- **纯 Node（`8c1083e`）**：narrative contract 168/168、narrative 200/200、journal/experience 60/60、privacy 2367/2367、profession view 614/614、state 439/439、profession DB 34/34、world route narrative 80/80、route planner 214/214、port/journal 58/58、legacy baseline 78/78、extension 92/92、discovery 157/157、economy balance 47/47、world work 400/400、campaign core 54/54、invitation adapters 143/143、invitation tools 55/55、narrative content 628/628、legacy 73/73、components 281/281、work journal 39/39；`py -3 tools/validate_site.py` 与 `py -3 tools/check_readme_links.py` PASS。
- **浏览器预检（`9247b06`）**：`career_archive_lifecycle_e2e_test` 61/61、`career_mobile_016_test` 334/334、`arcade_smoke` 119/119（完整 release 门禁会再跑一次）。
- **视觉夹具对照未重跑**：信箱的后续邀请块与港口的恢复动作是复用已冻结组件的新组合，不在 13 个夹具状态内。
- **L3 release profile（候选冻结 SHA `4f2d271bdc87ba993ef071cf6a405b167b15b3e9`）**：`py -3 tools/arcade_run_all_gates.py --profile release` **51/51 PASS**，2900.348s，`verdict: release passed (not full)`、`fully_passed: false`；门禁内的真实流程 645/645。本版本只启动了一次 release 门禁。日志在仓库外 `execution/review-024-release-gate.log`。门禁之后只有文档提交。
- full、真机与真人仍未验证；线上部署证据单独见 §5。
