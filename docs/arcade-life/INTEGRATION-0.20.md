# Arcade 0.20.0 集成与验证（生涯首航 V2）

- 分支：`feat/arcade-career-flow`（本地，未推送、未发布）
- 基线：0.19.0（已双端发布，main `f8d7e7b`）；目标：0.20.0
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
| 完整零种子首航 E2E | **339/339**（PASS 339 / FAIL 0 / BLOCKED 0） | 全新档案真实 UI 走完读信→进港→8 单默认路线→研究终局；无直接写旗标 / tier quest |
| campaign E2E | **731/731** | 多路线 C0→C5、三终局真实结算、备份恢复、经典 5 键不变 |
| 生涯移动端 | **318/318** | 320/375/390/430 与 0.19 紧凑视口 |
| world-state | **145/145** | 章节面板 / 终局选择 / 后日常 / 降级 / 焦点 / reduced-motion |
| 推荐一致性 | **111/111** | `campaign.recommend` 只读派生与真实可接单一致 |
| 路线一致性 | **94/94** | 推荐路径按真实规则必定产对应旗标，中间单不跳章 |
| career-db | **38/38** | IDB 事务与幂等 |
| 备份 / 导入 | **34/34** | 独立导出 / 导入 / 旧备份兼容 |
| 可访问性 | **75/75** | 焦点、44px 热区、读屏与 reduced-motion |
| PWA 离线 | **18/18** | 两部署路径、断网跨页、升级迁移、生涯 IDB 保留 |
| 矮视口紧凑触控 | **18/18** | 0.19 基线门禁，本版零回退 |
| 通用冒烟 | **117/117** | 16 款经典 / 中心页 / 离线 / 生涯视图 |
| 静态 | PASS | `validate_site.py`、`build_site.py`、`node --check engine.js/sw.js` |

- **聚合门禁**：`tools/arcade_run_all_gates.py` 仍在运行 / 待最终确认。收口时日志 `career-flow-all-gates.log` 在 `career_96_missions` 段中途截断，未出现 `ALL GATES PASSED`；不提前写聚合全绿。
- **独立复审**：首轮问题已回灌并在最终树复跑（零种子 E2E 两轮 339/339、campaign E2E 731/731）；最终复验待完成。
- **真机 / 真人**：UNVERIFIED，见 `DESIGN-0.20.0.md` §10 真人首航清单；未发布，无 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`。

## 4. 已知边界与未解决项

- 聚合门禁最终结论尚未拿到；拿到后须以最终日志更新本节、设计 §13 与 `TASKS.md`，不得用单项通过替代聚合结论。
- 最终独立复审复验待完成。
- 真人首航（身份复述、无需提示开始第三单、信用点与星币不混淆、次日回访）未进行；真机 iOS / Android 手感与 PWA 安装态未验证。
- 本版只在本地分支提交；远端 `main` 与双端线上仍为 0.19.0，发布需 Owner 单独授权。

## 5. 未发布声明

仅本地分支提交；未 push、未合并 main、未打 Tag、未触发任何 Pages 部署；`verify_deploy.py` 的线上双端校验未授权未运行。发布需 Owner `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`。
