# Arcade 0.23.0 集成与验证

- 状态：GATE_PASSED / RELEASE_READY（本地发布准备，未发布；未获 `PUBLISH_TO_MAIN`，未 push、未打 tag、未部署）
- 设计 / 回滚：[`DESIGN-0.23.0.md`](../../apps/arcade/DESIGN-0.23.0.md)；UI 契约：[`ADR-0.23-ui.md`](ADR-0.23-ui.md)
- 基线：0.22.0 `7a78f66`（GATE_PASSED / RELEASE_READY）；版本链 0.23.0，SW `studiokit-arcade-0.23.0-v1`
- 冻结边界：0.22 的 IDB v1、11 stores、localStorage key、`contentVersion 0.18.0`、玩法数值、经典街机与封存/导入语义不变。

## 1. 任务台账

| 任务 | 状态 | 证据 |
|---|---|---|
| T10 UI 契约与夹具 | PASS（契约层） | `ADR-0.23-ui.md`、P01–P10 夹具；coverage missing=0、Action ID 0 缺失、hiddenTexts 冲突 0；t10-reviewer PASS |
| T11 共享组件 | PASS（范围） | components 281/281（含 harbor 指纹、layer、叠层 Esc）；t11-reviewer PASS |
| T12 邀请 / 回执适配 | PASS（范围） | invitation adapters 127/127；t12-reviewer PASS |
| T13 港口 / 工作 / 经历适配 | PASS（owner） | port/journal 54/54；t13-reviewer PASS |
| T14 全职业叙事 | PASS（数据范围） | narrative content 612/612；16/16 职业；t14-reviewer PASS |
| T15 视觉 / 键盘 / 离线 | PASS（桌面 Chrome） | 13/13 场景、16/16 交互、6/6 PWA 离线；几何差异最大 2 CSS px |
| T16 真实 E2E 迁移 | PASS | 首航 405/405、移动端 334/334；旧钩子逐个有 0.23 等价或更强断言 |

## 2. 集成事实

- bridge 按需加载 `ui/components.js`、`ui/harbor.js`、`ui/invitation.js` 与同源 `ui/tokens.css`、`ui/components.css`，并注入 `uiComponents/uiHarbor/uiStyles/narrative/openInvitation/invitationForClue`；缺失时保留 0.22 降级路径，经典游戏首屏零生涯加载。
- `careerView` 的 `story.messages` 只从**已接受**职业的叙事卡取 0 或 1 条；可用终局优先于普通下一步。
- 首次到港使用真实 `port` 投影：`careerView({surface:'letter'})` 依契约不披露委托，所以邀请适配器只在**持久首到港标记**存在时改读 `port`。该标记由 `acceptedOriginGameId` 与 `narrativeCursor.nodeId === 'invitation:<professionId>'` 推导，关页重开仍成立；接受邀请本身不接单。
- 首到港由真实开局消费：`CONSUME_FIRST_ARRIVAL` 只把游标推进到 `arrival:<professionId>`（不改职业状态、不发奖励、不写故事事件），重复调用与关页重开都是纯 no-op；已消费的已接受信件改为「去港口」而不是重播到港。
- 叙事 shard 的作者字段在 bridge 一次性归一为适配器冻结 props（`invitationAction→acceptLabel`、`laterLabel→deferLabel`、`exitLabel→leaveLabel` 等），正文不改写，缺失标签才用统一 UI 文案。
- 终局收据在组件路径保留 0.22 的「读后日谈」主动作（`read-epilogue` → 章节面板），不再被下一单职业委托顶掉。
- 组件 shell 的层叠上下文整体位于 career layer（`ac-career-ui--layer`），0.19 紧凑态游戏弹层（`stage-box` z-index 6）不再遮挡港口；三层叠层（town→hangar→receipt）的 Esc 只交给最上层 career 面板。
- 所有视觉组件限定 `.ac-career-ui`，普通游戏主题与首页入口保持原样；QA 夹具与截图仅在仓库外。

## 3. 门禁记录

- 视觉 / 交互 / 离线：`node tools/career_ui_visual_test.mjs --visual` 25.648s 退出 0，13/13 场景通过、16/16 交互通过、77 张截图；`--pwa-only` 3.819s 退出 0，6/6。同内容对照覆盖 1280×800 与 390×844，指定场景额外检查 320×640 与 844×390；**映射元素**几何差异最大 2 CSS px，无横向溢出。panel 高度差（如 P02 +54、P07 −194.89）来自无页头面板与内部滚动，不作为元素错位；完整报告 `execution/qa-023-final/report.json`，QA 源 `career_ui_visual_test.mjs` / `career_ui_visual_fixture.html` 一并归档于仓库外。
- 真实流程：`node tools/career_flow_e2e_test.mjs` **410/410**（真实首航、首到港首单、C1–C5、W5E 顺序、终局读后日谈，以及「真实接单后关页重开、信件只余去港口且到港面板不再重播」的首到港消费证据）；`node tools/career_mobile_016_test.mjs` 334/334（320/375/390/430 紧凑矩阵、44px、三层叠层 Esc）。
- 纯 Node：components 281/281、invitation adapters 127/127、port/journal 54/54、narrative 612/612、profession state 439/439、privacy 2367/2367、receipt feedback 134/134。
- 独立复审：`execution/V023-final-review.md` 判定产品候选 PASS，阻断项为发布台账（B1）、门禁注册（B2）、私有路径（M3）、首到港消费（M1）与本记录陈旧（M2）；B1/B2/M2/M3/M4 已在收口提交处理（门禁新增 6 个纯 Node 套件、私有绝对路径与外部原型依赖已删除）；M1 的首到港消费在 `bd0a24a` 只覆盖到港面板，复核指出工作页/任何入口开局都不会消费，已改为在 bridge 的真实 `commission.start` 成功路径统一消费，并新增真实浏览器证据（关页重开后信件只余「去港口」，到港面板不再重播）。
- L3 release profile：见下节（同候选 SHA 只启动一次）。

## 4. L3 结果

- 冻结 SHA `6218646`：`py -3 tools/arcade_run_all_gates.py --profile release` **47/47 PASS**，3008.288s，`verdict: release passed (not full)`、`fully_passed: false`。release profile 现已包含 6 个 0.23 纯 Node 套件（components / invitation adapters / port journal / narrative content / work journal / invitation tools），CI 的 static job 同样覆盖。
- 首轮同版本运行 `dd7eb03` 为 44/47（`career_pwa_offline`、`smoke`、`career_flow_e2e`），失败项均为 0.23 界面替换后的真实回归或旧钩子：信箱列表丢失真实信件标题（产品已修）、smoke 仍点旧告示板钱包入口（迁移到 `[data-tool=wallet]` 并改用真实已接受职业夹具）、港口装载完成会重建 body 导致装载期点击丢失（测试等待 shell normal 后再点）。修复后定向复跑全部通过，再以新 SHA 完整重跑一次 L3。
- 本 SHA 无同 SHA 的线上 CI 或发布证据；`release passed (not full)` 不得写成 full / ALL GATES PASSED。full、真机、真人、线上部署仍为 UNVERIFIED。

## 5. 发布准备

- 未获 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`；不 push main、不打 tag、不创建 Release、不部署。
- 正式发布需双目标同 SHA 通过 workflow 与 `verify_deploy.py`；一次授权覆盖两端。
- full、真机、真人、线上部署仍属 UNVERIFIED；`release passed (not full)` 不得写成 full 或 ALL GATES PASSED。
