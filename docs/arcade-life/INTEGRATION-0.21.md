# Arcade 0.21.0 集成与验证（目标发布，未验证 / 未发布）

- 分支：`feat/arcade-career-passive-021`，HEAD `4ffc27d`；基线：0.20.0（main `ac56577`，已双端发布，提交 `df91715`、Actions `45719028590` 四项成功、双端各 88/88 文件一致）
- **状态**：目标版本 0.21.0；**未验证、未发布，无 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`**。本文件只记录已实际执行的结果，不把「没跑」写成「通过」。
- 设计 / 回滚：`apps/arcade/DESIGN-0.21.0.md`；接口冻结：`docs/arcade-life/ADR-interfaces.md` §22；门禁分层说明：`tools/README-gates.md`
- 版本口径：**目标**版本链 0.21.0 / SW `studiokit-arcade-0.21.0-v1`。当前产品代码（`engine.js` / `sw.js` / 中心页 / 注册表）与 `validate_site.py` / `verify_deploy.py` 断言仍为 0.20.0，版本 bump 未执行；本任务只改文档 / 任务记录，不改产品代码、测试或门禁脚本。

## 1. 交付范围（目标行为）

- **中心页彻底 passive**：经典目录不再出现生涯视图、默认视图切换或常驻告示板 / 信箱 / 章节入口。错过旧港来信只在「继续上次」附近以低强调小字找回（「旧港有一封来信」/「继续旧港来信」）；未读 / 未投递线索不自动切视图、不弹窗、不创建生涯身份。C0 后保留游戏内章节入口与收据回流。生涯已开启或已封存时，页尾提供二级「生涯设置」小字入口，仅承载封存 / 解冻 / 重置 / 档案，不是生涯内容 CTA；封存时隐藏所有生涯内容入口与结算线索，经典游玩不受影响。深链 `?careerLetter=1`、`?careerPanel=*`、`?story=1` 保留为显式入口 / 测试接口，受封存门控。
- **选择式叙事**：玩家可见的委托标题 / 摘要、章节 start / progress / complete / next、路线 hint、NPC 回信、支线与三终局统一第二人称提问 / 请求选择；选项必须对应真实可执行动作 / 路线 / 终局，不新增虚假分支；NPC 自述保留第一人称。`clues.json` 与 `chapter-01.json` 同源信件同步改写。
- **可解冻封存**：既有 `state` store 增 `career-archive` 标记行，不新增 store / key / schema。封存保留全部数据和 live run，但新线索、接单、继续委托与结算写入全部被 `assertCareerWritable` 在 DB 事务内重读标记后拒绝；解冻删除标记并推进代次；备份携带封存标记，replace 导入以文件状态为准。接口冻结见 ADR §22。
- **仅生涯数据完全重置**：`resetAllCareer()` 单事务清空生涯库 11 个 store 与封存标记。**不触碰**经典 `progress:v1` / `runs:v1` / `playtime:v1` / `scores:v1` / `challenge:v1` / `meta:v1` / `prefs:v1`，不改旧 key、不改 Schema；bridge 清当前页内存与线索 UI；设置面板二次确认并输入「重置生涯」，不可撤销，操作前需导出档案。
- **经典零变化**：IDB `studiokit:arcade:career` v1 / 11 stores、`contentVersion 0.18.0`、`rulesetVersion`、玩法数值、委托奖励、关卡与挑战数据均不变。
- **分层门禁**：`static`（校验 / 构建 / 全部纯 Node 门禁 / 96 static / flow static-only，CI L0 job，不启动 Chrome）、`release`（static + 关键 Chrome 集串行）、`full`（历史全量 Chrome 集串行）。`release passed (not full)` 不等于 full 通过；只有 full 全绿才可写 `ALL GATES PASSED`。输出 `PROFILE SUMMARY` + JSON 与每项真实墙钟耗时，环境错误 / 跳过绝不计为 PASS。

## 2. 本分支实际运行结果（如实记录）

| 项目 | 结果 | 说明 |
|---|---|---|
| `py -3 tools/validate_site.py` | PASS | 因版本断言仍为 0.20.0 而通过，不证明 0.21 版本链已同步 |
| `py -3 tools/build_site.py` | PASS | 生成 `dist/`，发布白名单 `index.html` / `favicon.svg` / `shared` / `apps` / `.nojekyll`；未提交产物 |
| `node tools/career_archive_test.mjs` | **8/8 PASS** | CA-01 接口形状、CA-02 封存往返、CA-03 事务内 guard 零半提交、CA-04 只读可用、CA-05 resetAllCareer 清空 11 stores 且经典存储零触碰、CA-06 备份 / replace / 旧档兼容、CA-07 设置确认门、CA-08 静态边界 |
| `git diff --check` | PASS（exit 0） | 提交前实际执行；`py -3 tools/check_readme_links.py` 也 PASS（9 文档链接 / 锚点 / 表格一致） |
| Chrome 门禁（smoke / mobile / PWA / 首航 E2E / 96 等） | **UNVERIFIED** | 本分支未执行 |
| `arcade_run_all_gates.py --profile static/release/full` | **UNVERIFIED** | 本分支未执行；无任何 `release passed` / `ALL GATES PASSED` 输出 |
| GitHub Actions / 双端 `verify_deploy.py` / 线上页面 | **UNVERIFIED** | 未 push / 未触发部署；远端 `main` 与两个正式域名仍为 0.20.0 |
| 真机 / 真人、读屏 / reduced-motion、PWA 安装态 | **UNVERIFIED** | 无真实设备证据 |

本轮为文档分支；以上 PASS 项只覆盖静态校验 / 构建和封存重置的纯 Node 逻辑，不能替代 0.21 的版本 bump、Chrome 回归与发布验证。

## 3. 版本链与数据兼容

- 目标四处同步：`engine.js` 的 `ARCADE_VERSION`、`sw.js` 的 `VERSION`、中心页显示版本、`shared/tool-registry.json` 的 `version`，并同步 `validate_site.py` / `verify_deploy.py` 的版本断言与相关测试的硬编码版本。**当前仍全部为 0.20.0，未执行。**
- 目标 SW 缓存键 `studiokit-arcade-0.21.0-v1`，升级沿用 0.19 策略：只继承旧缓存的预载清单，重新联网取当前版本游戏页，不复制旧页面字节。
- 生涯内容 `contentVersion 0.18.0`、`careerSchemaVersion 1`、`rulesetVersion 1`、IDB v1 / 11 stores 与所有经典 localStorage key 不变。
- `career-archive` 只是既有 `state` store 的一行，旧代码会忽略；回退 0.21 功能不会删除封存数据。已执行完全重置不可回滚，只能靠事先导出的档案恢复。

## 4. 未解决项与发布门槛

1. 版本 bump（engine / sw / 中心页 / 注册表 / 校验断言 / 测试硬编码）到 0.21.0 尚未执行，因此在当前树上 `validate_site.py` / `build_site.py` 的 PASS 只说明 0.20 口径仍自洽。
2. `static` / `release` / `full` 分层门禁本分支均未跑；`release` 通过不能替代 `full`，更不等于发布就绪。
3. 需要真机 / 真人验证被动来信回访、封存 / 解冻与仅限生涯的重置提示，确认经典记录逐字节不变。
4. 发布必须另有明确 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`；发布后需检查 Actions 四个 job 成功并用 `tools/verify_deploy.py` 双端逐文件校验。在此之前不得声称 0.21.0 已发布。

## 5. 回滚

- 回退 0.21 功能提交即可；因产品版本链尚未升级，无需额外降版，SW 新缓存随 activate 清理。
- `career-archive` 是 state 行，旧代码忽略，封存数据保留；完全重置不可回滚。
