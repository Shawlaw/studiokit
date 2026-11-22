# 存储 / 备份 / 生命周期审计（B00 侦察事实）

- 基线：Arcade `0.14.0`，`apps/arcade/engine.js` 3663 行，仓库 `main` `afc5fd4`（2026-11-22）
- 结论口径：索引为源码静态审计 + 本机实际执行（`validate_site` / `node --check` / `check_inline_scripts` / `arcade_smoke` 113/113）后的行号；浏览器行为未实测的部分会明确标注 **UNVERIFIED**
- 用途：0.15 生涯 IndexedDB 与备份实现的事实依据；**生涯不得写任何既有 localStorage 键**

## 1. localStorage 键（全部懒创建）

| 键 | Schema | 写入方（行号） | 上限/容错 | 进备份 |
| --- | --- | --- | --- | --- |
| `studiokit:arcade:progress:v1` | `{schemaVersion:1,games:{[id]:{high,plays,lastAt,lastScore}}}` | `Progress.recordPlay` 1529 / `save` 1514 / `resetGame` 1557 / `resetAll` 1567 | 损坏返回空 map 不删除；写失败静默 | `state`（必填） |
| `studiokit:arcade:runs:v1` | `{schemaVersion:1,games:{[id]:{savedAt,score,summary,data}}}` | `RunSave.save` 346 / `createRunAutosave` 410 | 导入单条 data ≤256K；save 无上限；写失败返回 false | `runs` |
| `studiokit:arcade:playtime:v1` | `{schemaVersion:1,games:{[id]:{ms,count,lastAt,days,rounds}},updatedAt}` | `addTime` 648 / `recordRound` 679 | 最近 30 轮 / 120 天；sanitize 丢坏字段 | `playtime` |
| `studiokit:arcade:challenge:v1` | `{schemaVersion:1,games:{[id]:{cleared,best}},updatedAt}` | `challengeMarkCleared` 1051 / 导入 1114 | 损坏 `{valid:false}` 不删除 | `challenge` |
| `studiokit:arcade:scores:v1` | `{schemaVersion:1,records:[...≤300],updatedAt}` | `Scores.record` 1310 / 导入 1361 | 300 条；detail 120 字符 | `scores` |
| `studiokit:arcade:meta:v1` | `{schemaVersion:1,games:{[id]:plain JSON}}`（当前仅 `star-raid.hangar`） | `GameMeta.set` 1449 / 导入 1474 | 单游戏 ≤32K；损坏按游戏丢弃 | `gameMeta`（可选） |
| `studiokit:arcade:prefs:v1` | `{muted,immersive,...}` | `Prefs.save` 1726 | 无 schemaVersion；未知字段保留 | **不进备份、不参与 reset** |
| `studiokit:diag:*` | 诊断探针 | `diag.html` | 自清理 | 否 |

- 通用安全封装：`safeGetJSON`/`safeSetJSON`/`safeGetRaw`/`safeRestoreRaw`（277-307）吞掉所有异常；`file://`/隐私模式写失败返回 false，页面继续。
- **不要新增 `studiokit:arcade:*` localStorage 键承载生涯**；生涯唯一存储为 IndexedDB。

## 2. 引擎公开 API（`window.Arcade`，3622-3662）

- 无 `A.Backup`、`A.Registry`、`A.Career`、`A.Storage` 命名空间；全部是具名 API。
- 关键语义：
  - `A.Progress.recordPlay(gameId, score, meta)`：唯一结算写入口；`plays+1`、非 zen 更新 `high`、写 `Scores`、调 `Playtime.recordRound`。
  - `A.Challenge.markCleared(gameId, stageId, result)`：挑战唯一写入口。
  - `A.GameMeta.get/set/clear/clearAll/exportData/importData`：`set` 为**整对象覆盖**（`data.games[id] = clean`），任何同 key 多用途写入必须读-合并-写。
  - `A.Playtime.setOverlayVisible(value)`：弹层打开时暂停计时；长时间生涯面板必须调用。
  - `A.Offline`：`supported` 要求 https/http；`file://` 自动 false。
- 存储常量封闭在 IIFE 内，外部无法遍历全部键；新增功能只能通过上述 API 与独立存储。

## 3. 备份 / 导入 / 清除（0.14.0 现状）

- 导出：`A.Progress.exportText()`（1575-1590）同步返回 JSON 字符串，字段 `format`（`studiokit-arcade-progress`）、`schemaVersion=1`、`appVersion`、`exportedAt`、`state`（必填）、`runs`、`playtime`、`challenge`、`scores`、`gameMeta`（可选）。UI 在中心页内联脚本下载固定文件名。
- 导入：`A.Progress.importText(text)`（1591-1714）同步；先写 progress，再依次 runs/playtime/challenge/scores/gameMeta；任一步失败用 6 键原始字符串回滚（`restoreAll`），但**回滚本身也可能失败**，不是原子操作。
- 旧备份缺字段：`runs`/`playtime`/`challenge`/`scores`/`gameMeta` 缺失都保留当前值；`state` 缺失拒绝整个备份。
- 已发现的兼容缺口（不在本包修复范围，但生涯实现必须避开）：
  - `playtime` schema 不符时被当成“成功 0 条”，不回滚；
  - `scores` schema 不符被误报为“存储已满”；
  - 导入无条目/大小上限（`state` 无白名单），仅 runs/meta 有单条限制。
- 清除：单游戏 `resetGame` 清 progress/runs/playtime/challenge/scores/meta 中该游戏；`resetAll` 写空 progress 并 remove 其余键；**prefs 不参与清除**。UI 文案未提挑战/机库，也未提未来生涯。
- 生涯接入（ADR §10）：
  - 0.15：独立 `career/backup.js` 异步导出/导入，**不改** `Progress.exportText/importText`（保持同步契约，现有 8+ 处调用与测试依赖）；
  - 0.16：中心页导出 handler 异步合成可选 `careerLife` 字段；导入采用“先校验 → career 事务 → classic 写入 → 失败补偿”，两套存储物理上无法原子；
  - “清除当前生涯”独立二次确认，不从同步 reset API 触发；中心页清除全部记录保持原语义并在文案说明生涯不在其中。

## 4. 多标签 / 幂等（现状与生涯要求）

- 现状：全仓无 `storage` 事件监听、无 `BroadcastChannel`、无 `navigator.locks`；所有 localStorage 写入都是读-改-写，多标签后写覆盖先写（已知缺陷，含 `GameMeta` 星币/机库）。
- 生涯要求（ADR §7）：IndexedDB 单 `readwrite` 事务完成 claim/流水/余额/库存/任务；`claims` 以 `runId` 为 keyPath（唯一）；`ledgers.txId` 唯一；`ConstraintError` 捕获后重读既有 claim 返回同一收据；余额事务内先校验再扣；事务内不得 `await` 非 IDB Promise。
- 多标签升级：`versionchange` 关闭连接；`onblocked` 需超时 + 提示，不能永久挂起；连接可缓存但需在 `versionchange` 时主动关闭。
- 测试隔离：`localStorage.clear()` 不清 IndexedDB；career 测试必须显式 `indexedDB.deleteDatabase('studiokit:arcade:career')` 或 `__arcadeCareerTest.resetAll()`。
- sessionStorage（0.16 起 ticket）：键名必须带命名空间（建议 `studiokit:arcade:career:ticket`）；按标签页隔离；结算/放弃/刷新后清理；DB run 状态才是权威。

## 5. 页面生命周期 / 路由

- 中心页：`engine.js` 同步执行（`Playtime` 检测到中心页 → 不装计时）→ body 末尾内联脚本 `render()` 同步读 localStorage → DOMContentLoaded 注册 SW / 显示模式 → `pageshow`/`visibilitychange` 重新 `render()`。
- 游戏页：`site-shell.js`(defer) → `engine.js`(同步；`detectCurrentGame` 命中 → 安装计时) → [`challenge/<id>.js`] → 页内游戏脚本；离开时 flush 时长。
- `career/bridge.js` 必须在 engine 之后、挑战数据与页内脚本之前；bridge 同步定义 `window.ArcadeCareer`（依赖异步串行装载，不能阻塞游戏脚本）。
- `file://`：engine 存储写失败被吞；`Offline.supported=false`。生涯在 IDB 不可用时 fail-open（`available=false`，无 UI、无奖励，经典照常），**不得回退 localStorage**。
- SW（`apps/arcade/sw.js`）：
  - `VERSION`（12）、`CACHE_PREFIX`（13）、`CACHE_NAME`（17，当前 `studiokit-arcade-0.14.0-v1`）；`CORE_PATHS`（26-51）27 项，含 13 个 challenge、engine、arcade.css、manifest、icons、shared；**不含 16 个游戏 HTML 与 career 资源**。
  - 导航 network-first，静态 cache-first；`sw.js` 自身放行网络；activate 用“旧缓存是否还在”判断升级接管后广播更新事件。
  - 生涯资源要离线可用必须加入 `sw.js` 的 `CORE_PATHS`（D15-13 负责）；`validate_site.py` 只校验 13 条 challenge，不会提醒漏加。
  - SW 升级不清 IDB；清除站点数据/卸载 PWA 会清 IDB → 生涯 UI 必须提供独立导出。
- 路由：`detectCurrentGame()`（489-506）兼容 `/games/x.html` 与 Cloudflare `/games/x`（去后缀、小写、尾斜杠、URL 解码、按 id 兜底）；`ARCADE_BASE` 由 `document.currentScript.src` 推断，支持 GH 子路径与 CF 根路径。

## 6. 新增 `apps/arcade/career/` 的静态约束

- `tools/build_site.py` 白名单 `['index.html','favicon.svg','shared','apps']`；`apps/arcade/career/**` **会自动上线**。禁止在该目录放测试夹具、笔记、答案或任何非运行时文件。
- `apps/**/*.html` 校验：禁止根绝对路径、外部链接、失效相对引用；`apps/**/*.css` 禁止 `url(/...)`；`apps/arcade/**/*.html` 禁止 `viewport-fit=cover`。
- 升 0.15.0 必须同步（字面量断言）：
  - `apps/arcade/engine.js` `ARCADE_VERSION`；`apps/arcade/sw.js` `VERSION`；`shared/tool-registry.json` arcade version；`apps/arcade/index.html` `data-hall-version`；
  - `tools/validate_site.py` 的 4 处版本字面量与 `REQUIRED` 中的 `DESIGN-0.15.0.md`；
  - 测试脚本版本断言：`arcade_smoke.mjs`、`arcade_zen_scores_test.mjs`、`arcade_calm_games_test.mjs`、`arcade_interaction_test.mjs`、`arcade_pwa_update_test.mjs`（后者是“当前版→下一版”链路，需整体改为 0.15.0→0.15.1）。
- 发布校验：`tools/verify_deploy.py` 的 `PATHS` 是 41 条硬编码，career 上线前必须追加 career 静态资源；`server` MIME 需覆盖 `.json`。
- CI 只跑 `validate_site` + 4 个 `node --check` + `build_site`；不跑 Chrome 门禁。career 测试不要加进 CI 的 build job，本地门禁另行执行。
- 建议在本地门禁追加：`node --check` 所有 career JS、`node tools/career_*_test.mjs`、以及现有 `arcade_run_all_gates.py`（注意其覆盖不全：tower/immersive/interaction/pwa 不在聚合器内）。

## 7. 对生涯实现的硬约束（摘自审计）

1. **不得写** `meta:v1`、`runs:v1`，不得调用 `A.Progress.recordPlay` / `A.Challenge.markCleared` 记录生涯。
2. **不得新增** `studiokit:arcade:*` localStorage 键；唯一 IDB 名 `studiokit:arcade:career`。
3. `GameMeta.set` 是整对象覆盖：任何同 key 多用途写入必须读-合并-写（0.16 星海前置修复）。
4. `serialize()`/`RunSave` 不得被生涯局写入（层塔无 mode 门禁、星海 `run:` 段只认 classic，需各自早退）。
5. 生涯 UI 长时间停留要调用 `A.Playtime.setOverlayVisible(true/false)`。
6. 备份不改变 `Progress.exportText/importText` 的同步契约；生涯独立异步备份先行。
7. IndexedDB 失败必须结构化返回失败（不静默成功），且不写半成品；配额错误在 `tx.onabort` 捕获。
