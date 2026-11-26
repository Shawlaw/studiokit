# Arcade 0.21.0 集成与验证（发布前）

- 分支：`feat/arcade-career-passive-021`；基线：0.20.0（main `ac56577`，已双端发布，提交 `df91715`、Actions `45719028590` 四项成功、双端各 88/88 文件一致）。
- 设计 / 回滚：`apps/arcade/DESIGN-0.21.0.md`；接口冻结：`docs/arcade-life/ADR-interfaces.md` §22；门禁分层：`tools/README-gates.md`。
- 版本链已同步 `0.21.0` / SW `studiokit-arcade-0.21.0-v1`。本文件只记录实际执行结果；未执行项保持 UNVERIFIED。

## 1. 交付范围

- **中心页彻底 passive**：删除生涯视图、默认视图与常驻告示板/信箱/章节入口；经典目录始终可见。未读/已读未投递来信只在「继续上次」附近显示低强调小字。生涯已开启或封存时，页尾提供二级「生涯设置」；封存隐藏来信与内容入口，经典游玩不受影响。深链保留并受封存门控。
- **选择式叙事**：玩家可见故事、委托、章节、路线、NPC 回信、支线与终局统一面向「你」提问/请求选择；NPC 自述保留第一人称。`clues.json` 与 `chapter-01.json` 同源信件同步；不新增虚假分支，不改任务数值、奖励、解锁、关卡与挑战数据。
- **可解冻封存**：既有 `state` store 增 `career-archive`，不新增 store/key/schema。封存保留全部数据和 live run；事务内 `assertCareerWritable` 阻断新线索、接单、继续与结算。解冻删除标记并推进发现代次；备份携带标记，replace 以文件为准。
- **仅生涯数据完全重置**：单事务清空 11 stores 的玩家数据、封存标记与旧代次；同事务保留最多 256 个 `former-career:<id>` 内部退役标记与新一代次，拒绝重置前旧标签继续写带 careerId 的生涯资产。标记不进备份；发现状态写入强制携带当前代次。经典 progress/runs/playtime/scores/challenge/meta/prefs 的 key、Schema 与内容不变。
- **退役上限**：本轮当前身份始终保留，不参与字典序淘汰；超出 256 个退役 ID 时，最早退役 ID 不再保证阻断。无 careerId 的发现状态依靠代次与动作存在性守卫，不声称提供旧身份隔离。
- **分层门禁**：`static`（35 项，无 Chrome）、`release`（static + 串行关键 Chrome 集）、`full`（历史全量串行）。`release passed (not full)` 不等于 full；每项记录真实墙钟耗时，环境错误/跳过绝不计 PASS。

## 2. 实际验证结果

| 项目 | 结果 | 说明 |
|---|---|---|
| `arcade_run_all_gates.py --profile static --workers 3` | **35/35 PASS** | `static passed`，最近一轮 9.114s |
| `career_archive_test.mjs` | **8/8 PASS** | 含旧身份资产回写、发现代次、终局/预留、256 上限当前身份保留 |
| `career_archive_lifecycle_e2e_test.mjs` | **60/60 PASS** | 真实 IDB + 两个 CDP 标签：封存保留、冻结阻断、经典可写、解冻恢复、完全重置、旧标签拒绝、设置深链 |
| `career_db_test.mjs` | **38/38 PASS** | 含真实 Chrome 多标签并发与隔离 |
| `career_backup_test.mjs` | **34/34 PASS** | 含封存标记 API、replace/merge、坏档零写、经典键零变化 |
| `career_mobile_016_test.mjs` | **318/318 PASS** | 320/375/390/430、键盘、reduced-motion、PWA safe-area、触控 |
| `arcade_smoke.mjs` | **117/117 PASS** | 含被动入口、封存后设置入口、经典目录/排序不变 |
| `career_flow_e2e_test.mjs` | **339/339 PASS** | 零种子完整首航、真实路线、收据回流、C5 研究终局 |
| `career_pwa_offline_test.mjs` | **18/18 PASS** | 0.21.0 缓存、0.18.2 预载清单迁移、GH 子路径与 CF 无后缀 |
| `career_chrome_isolation_test.mjs` | **9/9 PASS** | 动态端口、profile 归属、失败清理 |
| `arcade_gameplay_test.mjs --suite=base --repeat=2` | **22/22 PASS** | release profile 内通过 |
| 96 委托 Chrome E2E | 首轮 13/16 游戏通过；blackjack/solitaire/pendulum-tower 因 `DevToolsActivePort` 环境错误未执行 | 三款单独串行重跑均 6/6 tiers（各 237/237 checks）；全量串行复跑结果见本节后续更新 |
| `release` profile | 首轮 **37/40 PASS，3 FAIL** | 96 的三个 Chrome 启动环境错误；mobile 种子缺代次（已修复并 318/318）；smoke 旧版本断言（已修复并 117/117）。不得声称首轮 release 通过 |
| `full` profile | **UNVERIFIED** | 未执行完整 56 项集合 |
| GitHub Actions / 双端 `verify_deploy.py` / 线上页面 | **UNVERIFIED** | 尚未 push / 触发部署 |
| 真机 / 真人、读屏、PWA 安装态 | **UNVERIFIED** | 无真实设备证据 |

## 3. 首轮 release 失败闭环

- `career_96_missions`：exit 2，blackjack / solitaire / pendulum-tower 的 Chrome `DevToolsActivePort` 未就绪，属于环境错误，未执行 tier。定向复跑中 solitaire 通过，blackjack 与 pendulum-tower 仍遇到相同环境错误；三者随后各自单独运行均通过 6/6 tiers。全量串行复跑用于消除逐进程启动波动。
- `career_mobile`：`seedState()` 未传 action，发现写入缺少必填代次；已在测试种子路径显式注入 `SEED_STATE`，复跑 318/318。
- `smoke`：版本断言仍为 0.20.0；已同步 0.21.0，复跑 117/117。

## 4. 版本与兼容

- `engine.js` / `sw.js` / 中心页 / `shared/tool-registry.json` / `validate_site.py` / `verify_deploy.py` 与相关测试硬编码均为 0.21.0。
- SW 升级沿用 0.19 策略：只继承旧缓存预载清单，重新联网取当前版本游戏页，不复制旧页面字节。
- 生涯内容 `contentVersion 0.18.0`、`careerSchemaVersion 1`、`rulesetVersion 1`、IDB v1 / 11 stores 与所有经典 localStorage key 不变。
- `career-archive` 与 `former-career:<id>` 都是既有 state store 行，旧代码会忽略；回退功能不会删除封存数据。已执行完全重置不可回滚，只能靠事先导出的档案恢复。

## 5. 未解决项与发布门槛

1. 完成全量 96 串行复跑与最终 release profile；若仍只有环境错误，必须保留真实失败记录并逐项重跑，不得伪称一次聚合通过。
2. `full` profile 未执行；release 通过不能替代 full，更不等于发布就绪。
3. 需要真实设备/真人验证被动来信、封存/解冻、重置提示与经典记录保留。
4. 发布后检查 Actions 四个 job 成功，并用 `tools/verify_deploy.py` 双端逐文件校验；此前不得声称 0.21.0 已发布。
