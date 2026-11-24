# G15 门禁摘要（Arcade Life 0.15.0）

- 分支：`feat/arcade-life-015`（本地，未推送、未发布）
- 基线：`afc5fd4`（Arcade 0.14.0）；目标版本 0.15.0
- 完整原始证据（命令输出、探针、截图、复现细节）在仓库外开发工作目录的 `qa/evidence/G15-EVIDENCE.md`；本文件只保留非剧透的结论摘要与可复跑命令。
- 发布授权：**none**。远端 `main` 仍为 `afc5fd4`，本分支无 upstream、远端无同名分支、无 tag；未触发任何部署。

## 结论

| 门禁项 | 结果 |
|---|---|
| 16/16 游戏可被动触发线索、无显眼生涯入口 | PASS（静态 + 运行时；16/16 真实经典局） |
| 不点线索经典/挑战/禅/割草与 0.14.0 等价 | PASS（smoke 113/113、兼容金样 78/78、16 页 diff 纯新增） |
| 挑战局不产生线索事件 | PASS（首轮审计发现 2 处共享输入路径泄漏 → 已修复并补真实挑战回归；reachability 165/165） |
| 独立 IDB 账本/claim 幂等/多标签/失败零写入/备份 | PASS（career_db 38/38、career_backup 34/34） |
| PWA GH 子路径 + CF 无后缀 + 离线信箱 + SW 不清 IDB | PASS（career_pwa_offline 17/17、pwa_update 9/9） |
| 320/375/390/430、键盘、读屏、reduced-motion | PASS（a11y 75/75、immersive 32/32、smoke 布局项） |
| 防剧透（提交信息/公开文档/仓库树/dist） | PASS（无剧情路线/谜底/阈值答案/外部策划包/Prompt） |

### 复核签核

- 首轮独立审计：**FAIL**（F-15-01 挑战事件泄漏、F-15-02 工作树不干净、F-15-03 EOF 空行、F-15-04 证据引用）。
- 修复：`8193ffa`（挑战守卫 + 真实挑战回归）、`5e71004`（非剧透摘要与证据路径）。
- 第二轮独立复核：**PASS**（HEAD `5e71004`；工作树干净；`git diff --check` 0；reachability 165/165、smoke 113/113、a11y 75/75、validate/build/inline、4 个纯 Node 契约测试全部 exit 0；独立探针验证挑战内 `eventCount=0` 且退出后经典结算不再兑换线索；远端 `main` 仍为 `afc5fd4`、本分支未推送、无 tag）。
- 复核遗留 minor：两个测试文件内的内部路径字符串已中性化；本摘要已按签核后状态更新。真机/读屏器/PWA 实机仍 UNVERIFIED（见下）。

## 首轮审计发现与修复

1. **挑战模式 career 事件泄漏（BLOCKER）**：`bridge` 默认 `sourceMode='classic'`，16 页未接 `setSourceMode`；`memory-flip`/`merge-2048` 的共享输入路径会在挑战局写入 `pair.match`/`tile.merged`，可被随后经典结算兑换成线索。
   - 修复：12 款带挑战游戏的所有 `career.observe`/`career.finish` 增加 `mode === 'classic'` 守卫（提交 `8193ffa`）；
   - 回归：`career_games_reachability_test` 新增真实挑战输入 + 退出后经典结算用例（165/165）。
2. **交付卫生（BLOCKER）**：审计期间工作树有未提交的集成文档；已提交。
3. **minor**：`git diff --check` EOF 空行（已修）；证据路径引用（本文件为仓库内非剧透摘要，完整证据在仓库外）；兼容金样依赖本地 git 对象 `afc5fd4`（shallow clone 下会 SKIP 而非误报）。

## 复跑命令（本地）

```powershell
py -3 tools/validate_site.py
py -3 tools/build_site.py
node tools/check_inline_scripts.mjs
node tools/career_registry_test.mjs
node tools/career_discovery_test.mjs
node tools/career_entry_router_test.mjs
node tools/career_legacy_baseline_test.mjs
$env:CAREER_DB_PORT='8830'; $env:CAREER_DB_CDP_PORT='9430'; node tools/career_db_test.mjs
$env:CAREER_BACKUP_PORT='8831'; $env:CAREER_BACKUP_CDP_PORT='9431'; node tools/career_backup_test.mjs
$env:CAREER_A11Y_PORT='8832'; $env:CAREER_A11Y_CDP_PORT='9432'; node tools/career_discovery_accessibility_test.mjs
$env:CAREER_GAMES_PORT='8833'; $env:CAREER_GAMES_CDP_PORT='9433'; node tools/career_games_reachability_test.mjs
$env:CAREER_PWA_PORT='8839'; $env:CAREER_PWA_CDP_PORT='9439'; node tools/career_pwa_offline_test.mjs
$env:ARCADE_SMOKE_PORT='8851'; $env:ARCADE_CDP_PORT='9451'; node tools/arcade_smoke.mjs
```

## 未验证项（UNVERIFIED）

真机 iPhone/Android 触控与全屏安全区、VoiceOver/TalkBack 实际播报、PWA 安装与更新提示时机、Safari/Firefox 与旧版 Chrome 的 IndexedDB/CSS 兼容、`file://` 下 IDB/fetch 的真实表现（代码路径已按 fail-open 复核）、真实手指操作对挑战隔离的复现、首局线索出现节奏体感。以上需 Owner 或持真机 Reviewer 复测。
