# Arcade 0.20.0 集成与验证（生涯首航 V2）

- 分支：`feat/arcade-career-flow`；基线：0.19.0（已双端发布，main `f8d7e7b`）；目标：0.20.0
- 发布授权：Owner 在独立复审 APPROVE、确认主流程无问题后明确要求「先发版」，视为 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`，双端同时发布。
- 设计 / 契约：`apps/arcade/DESIGN-0.20.0.md`（路线见 §4，当前真实路线）、`docs/arcade-life/ADR-interfaces.md` §20.8–20.10
- 证据：单门禁日志在仓库外 `/tmp/opencode/`；零种子首航说明 `tools/career_flow_e2e_test.md`

## 1. 交付

- 首航入口：错过的线索 chip 在后续有效结算可重显；首页在经典视图目录上方以小字提供「旧港有一封来信 / 继续旧港来信」，读信一次点击完成投递进港（`?careerLetter=1`）。
- 到港体验：C0 首封信明确身份与新目标，阿砾作为首航唯一关键 NPC；告示板首屏只突出当前推荐单（游戏名 / 世界目标 / 数量 / 推荐原因 / 主按钮），其余委托折叠为自由接单。
- 默认主线：由 `campaign.recommend`、`story-evidence`、`route-planner` 按真实规则推导，不使用静态游戏列表；中间单标「路线进展」而非伪装成完成本章。
- 三回报收据：工钱与材料、剧情物件（无内部 token）、世界反应与下一步；收据提供页内「回告示板 / 读回信」主动作，每单至多一次必要整页跳转。
- 连续性：关标签丢失 sessionStorage ticket 后，从 DB live run 只读发现「继续这张单」，玩家显式点击才恢复；终局 C5 唯一、幂等、失败可重试。
- 内容：C0–C5 以 `start / progress / complete` 节拍向后兼容扩展；玩家可见文案不出现 C0/C1、active/locked、E/BP/MAP token 或长凭据号。

## 2. 版本链 0.20.0

- `apps/arcade/engine.js`（`ARCADE_VERSION`）、`apps/arcade/sw.js`（`VERSION`）、`apps/arcade/index.html`（显示版本）、`shared/tool-registry.json` 四处一致为 0.20.0。
- SW 缓存键 `studiokit-arcade-0.20.0-v1`；升级迁移沿用 0.19 策略（只继承旧缓存预载清单、重新联网取当前页面，不复制旧字节）。
- `tools/validate_site.py`、`tools/verify_deploy.py` 的版本断言 / 设计文档白名单 / PATHS 同步；因版本断言失败的相关测试（smoke / pwa_update / pwa_offline / zen / calm / interaction / a11y）同步到 0.20.0。
- 生涯内容 `contentVersion` 仍为 `0.18.0`，`careerSchemaVersion = 1`、`rulesetVersion = 1`、11 stores 与所有 localStorage key 不变。

## 3. 验证结果

| 类别 | 结果 | 说明 |
|---|---|---|
| 静态 / 构建 | PASS | `final-inline.log`、`final-stage.log`；`validate_site.py`、`build_site.py`、`node --check engine.js/sw.js` |
| 新增纯 Node 门禁 | 全 PASS | `final-career_continuation_test.mjs.log` 17/17、recommendation 111/111、route-consistency 94/94、receipt-feedback 103/103、mailbox-flow 56/56、town-flow 21/21、town-recommend-preload 15/15、origin-letter 5/5 |
| 96 委托静态 / E2E | **34/34** / **16/16 游戏、96/96 档、3792/3792 检查** | `final-m96-static.log`；`career-96.log` / `career-flow-final-gates.log` 首次完整 E2E；gates3 受阻档单项重跑通过 |
| campaign E2E | **732/732** | `final-campaign-e2e.log`，多路线 C0→C5、三终局真实结算、经典 5 键不变 |
| 完整零种子首航 E2E | **339/339**（PASS 339 / FAIL 0 / BLOCKED 0） | `final-flow.log`，真实 UI 走完读信→进港→8 单默认路线→研究终局 |
| 移动端 / world-state | **318/318** / **145/145** | `final-mobile.log`、`final-world.log` |
| 冒烟 / 紧凑触控 | **117/117** / **18/18** | `final-smoke.log`、`final-compact.log` |
| gameplay all / base | **208/208**（repeat 2）/ **22/22**（repeat 2） | `final-gameplay-all3.log`、`final-gameplay-base.log` |
| zen / calm / review / pwa_update / interaction / immersive / tower | **14/14** / **17/17** / **5/5** / **9/9** / **5/5** / **42/42** / **23/23** | `final-zen.log`、`final-calm.log`、`final-review.log`、`final-pwa-update.log`、`final-interaction2.log`、`final-immersive.log`、`final-tower.log` |
| PWA 离线 / a11y / db / backup / resume | **18/18** / **75/75** / **38/38** / **34/34** / **45/45** | `career-pwa.log`、`career-a11y.log`、聚合日志对应段、`career-backup.log`、resume 单项重跑 |
| review3 / review4 / review5 / closeout / route_evidence / isolation | 全 PASS | `final-review3.log`、`final-review4.log`、`final-review5.log` 12/12、`final-closeout.log` 6/6、`final-route-evidence.log`、`final-isolation2.log` 9/9 |

- **逐项串行结论**：上述所有单项门禁在最终树上串行执行均通过；**这是逐项串行全绿，不是一次聚合长跑通过**。
- **聚合门禁三次长跑**：`career-flow-final-gates.log`（review4 旧断言，exit 1）、`career-flow-final-gates2.log`（resume 环境阻断，exit 2）、`career-flow-final-gates3.log`（96 E2E 多款 Chrome `DevToolsActivePort 未就绪` 的内存 / 端口偶发）均未输出 `ALL GATES PASSED`；对应单项修复或重跑通过。**不宣称一次聚合通过**。主要日志：`/tmp/opencode/final-*.log`、`/tmp/opencode/career-flow-final-gates*.log`。
- **独立复审**：首轮问题已回灌；最终逐项复验全绿。
- **真机 / 真人**：UNVERIFIED，见 `DESIGN-0.20.0.md` §10 真人首航清单；Owner 已授权双端发布，不把未验证项宣称为已通过。

## 4. 已知边界与未解决项

- 聚合三次长跑被旧断言与 Chrome 启动环境阻断，虽对应单项重跑通过，仍无一次聚合 `ALL GATES PASSED`；不得用逐项全绿替代聚合结论。
- 真机 / 真人首航仍待 Owner；最终逐项串行复验已全绿。
- 真人首航（身份复述、无需提示开始第三单、信用点与星币不混淆、次日回访）未进行；真机 iOS / Android 手感与 PWA 安装态未验证。
- 发布前远端 `main` 与双端线上为 0.19.0；Owner 已授权发布。部署提交、Actions run、双端 `verify_deploy.py` 结果在本节补记。

## 5. 发布记录

- 授权：Owner 在独立复审 APPROVE 后明确要求发布；覆盖 GitHub Pages 与 Cloudflare Pages 双端。
- 部署前状态：本地 0.20.0 逐项串行门禁全绿，独立复审 APPROVE；真机 / 真人首航 UNVERIFIED。
- 发布提交 / Actions run / 双端逐文件校验：待部署完成后补记，不提前声称发布成功。
