# Arcade 0.16.0 集成与版本链（First Flight）

- 分支：`feat/arcade-life-015`（本地，未推送、未发布）
- 基线：0.15.0（G15 PASS）；目标：0.16.0
- 契约：[`ADR-interfaces.md`](ADR-interfaces.md) §18；设计：[`DESIGN-0.16.0.md`](../../apps/arcade/DESIGN-0.16.0.md)
- 证据：仓库外 `qa/evidence/D16-*.md`；独立门禁摘要见 `docs/arcade-life/G16-EVIDENCE.md`（G16 复评后落盘）

## 1. 新增文件与所有权

| 文件 | 任务 | 说明 |
|---|---|---|
| `career/commission-core.js` | D16-02 | 目录/ticket/事件缓冲/目标判定/结算/恢复/放弃 |
| `career/star-combat-config.js` | D16-05 | 经典 formula 1 只读映射；生涯 formula 2（装备） |
| `career/rental.js` | D16-07 | 免费租机会话凭证 |
| `career/alternatives.js` | D16-10 | 非战斗代办（只扣费 + alternative/story 行） |
| `career/ui/town.js` | D16-01 | 告示板 + 代办 + 机库/钱包入口 |
| `career/ui/hangar.js` | D16-06 | 飞船商店/切换/租用入口 |
| `career/ui/receipt.js` | D16-08 | 钱包/原收据/流水/结算收据卡 |
| `career/content/commissions.json` | 主控 | 4 条 T1/T2（层塔、星海） |
| `career/content/items.json` | D16-06 | 4 船 / 模块 / 材料 |
| `career/content/chapter-01.json` | D16-09 | 16 起源 C0 信 + C1 三路径 |
| `ui/mailbox.js`（+100 行） | D16-01 | LOCAL 信件的「按地址投递 · 去港口」入口 |
| `games/pendulum-tower.html` | D16-03 | 职业目标行、挑战隐藏、旧局内档断开 |
| `games/star-raid.html` | D16-04 | 职业出击、classicLike、GameMeta 读-合并-写、序列化门禁 |

## 2. 版本链（0.16.0）

- `engine.js` `ARCADE_VERSION='0.16.0'`；`sw.js` `VERSION='0.16.0'`，缓存键 `studiokit-arcade-0.16.0-v1`
- `index.html` `data-hall-version`、`shared/tool-registry.json` arcade `version`、`content/registry.json` 与 `content/clues.json` 的 `contentVersion`、`bridge/backup/core/db` 默认内容版本
- `validate_site.py` 断言、7 个版本断言测试脚本（smoke/zen/calm/interaction/pwa_update/career_pwa_offline/a11y）同步 0.16.0；`verify_deploy.py` 追加 0.16 career 静态资源
- SW `CORE_PATHS` 追加 commission/combat/rental/alternatives/内容 JSON/town/hangar/receipt

## 3. 数据与兼容

- 复用 IDB `studiokit:arcade:career` v1（11 stores）；新增 DB 方法 `getEquipment/writeEquipment/readLedger`（单事务、扁平装备键）；`purchase` 新增 `costItems` 原子扣材料。
- 无 localStorage 新增/改名；sessionStorage 仅 `studiokit:arcade:career:ticket.v1` 与 `studiokit:arcade:career:rental.v1`（会话级）。
- 职业 run 全程不写 `studiokit:arcade:runs:v1`、`studiokit:arcade:meta:v1`、`progress/scores/playtime/challenge`（resume/first-flight 测试逐字节/逐键断言）。
- 经典、挑战、禅、星海割草、旧星币与机库公式零改动（smoke/baseline/游戏页 diff）。

## 4. 本地门禁结果（2026-11-23，0.16.0 版本链）

| 类别 | 命令 | 结果 |
|---|---|---|
| 纯 Node | `career_registry_test` / `career_discovery_test` / `career_legacy_baseline_test` / `career_entry_router_test` | 90/90 · 84/84 · 78/78 · 37/37 |
| 纯 Node | `career_commission_test` / `career_star_combat_config_test` / `career_rental_test` / `career_alternatives_test` | 61/61（另真实 IDB 17/17、bridge E2E 8/8）· 379/379 · 153/153（另 Chrome 22/22）· 67/67（另真实 IDB 13/13） |
| Chrome/CDP | `career_run_resume_test` / `career_first_flight_test` / `career_mobile_016_test` | 45/45 · 192/192 · 318/318 |
| Chrome/CDP | `career_discovery_accessibility_test` / `career_db_test` / `career_backup_test` / `career_pwa_offline_test` / `career_games_reachability_test` | 75/75 · 38/38 · 34/34 · 17/17 · 165/165 |
| 既有回归 | `arcade_run_all_gates.py`（validate/build/design/inline/stage + career 全组 + smoke 113/113 + zen + calm + review + gameplay all/base） | 见 G16 复跑 |
| 独立门禁 | G16 Reviewer 复跑 | **PASS**（HEAD `b494ee1`；16 起源首航 192/192、经济闭环、恢复 45/45、移动端 318/318、smoke 113/113；非剧透摘要见 `G16-EVIDENCE.md`） |

> 0.16 期间发现并修复的测试/产品问题：①`arcade_smoke` 核弹固定槽位在随机整备后偶发失败（已按实际槽位修复）；②窄屏目标行 3–4 行（改为只显示标题）；③机库 Esc 同时关掉叠层两个面板（加最上层守卫）；④`bridge` 未公开 `api.items` 导致机体配置回退旧翼（已公开）；⑤`alternatives` 无产品入口（bridge preload + 告示板「港务处代办」）。
>
> 门禁脚本应串行运行：首次 4 个 Chrome 并行复跑 `career_run_resume_test` 出现 1 项 9s 超时（43/45），隔离复跑与历史多次均 45/45；`arcade_run_all_gates.py` 已串行。

## 5. 已知风险 / UNVERIFIED

- 职业 run 事件缓冲 400/局；0.17 深塔/长星区需评估分段。
- 租机 marker 会话级；关标签页丢失（符合“本次出击免费”）。
- `chapter-01.json` 的 `C1.signal` 与 0.17 章节 token 需一次映射。
- 真机 iPhone/Android 触控与安全区、VoiceOver/TalkBack、PWA 安装/更新时机、Safari/Firefox 兼容、真实断电恢复：**UNVERIFIED**，需 Owner 或持真机 Reviewer 复测。

## 6. 未发布声明

本版只存在本地分支 `feat/arcade-life-015` 的提交；远端 `main` 仍为 `afc5fd4`，无 push、无 tag、无部署。任何公开发布 / 合并 `main` 需 Owner 明确 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`。
