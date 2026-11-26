# Arcade 0.21.2 集成与验证

- 基线：0.21.1（main `afa5549`，双端已发布）
- 分支：`fix/arcade-career-entry-0211`
- 设计 / 回滚：`apps/arcade/DESIGN-0.21.2.md`

## 1. 交付范围

- 首页「旧港生涯 / 回折光港看看」直接打开告示板弹窗，不先跳层塔游戏页。
- 钱包弹窗标题统一为「钱包与收据」。
- 生涯遮罩高于独立窗口导航栏；弹窗期间背景不滚动，面板正文独立滚动；关闭后恢复首页位置与焦点。
- 游戏页顶栏标题左侧留白；320px 保留页面边距避免截断。
- 版本链 0.21.2 / SW `studiokit-arcade-0.21.2-v1`。不改 key、IDB Schema、contentVersion、玩法数值或奖励。

## 2. 发布前实测

| 项目 | 结果 | 说明 |
|---|---|---|
| `arcade_smoke.mjs` | **119/119 PASS** | 含首页直接弹窗、钱包标题、背景滚动锁、关闭恢复、标题留白、四档窄屏与旧档兼容 |
| `career_flow_e2e_test.mjs` | **404/404 PASS** | 首航、失败重签、跨标签续单、终局；首页入口与票号路径 |
| `career_pwa_offline_test.mjs` | **18/18 PASS** | 0.21.2 SW 缓存、GH 子路径、CF 无后缀、预载迁移 |
| `arcade_compact_touch_test.mjs` | **18/18 PASS** | 5 档紧凑视口 × 16 游戏、真实触控、标题无截断 |
| `career_passive_entry_test.mjs` | **71/71 PASS** | 入口可见性、旧档、封存/解冻/重置 |
| `career_commission_test.mjs` | **64/64 PASS** | 委托票号、URL、幂等与奖励 |
| `validate_site.py` / `build_site.py` / `node --check` | **PASS** | 静态校验、构建与脚本语法 |

## 3. 发布证据

待发布完成后补充：main 提交、Actions run、双端 `verify_deploy` 文件数、线上版本与浏览器功能复核。

## 4. 未解决项

- `full` profile 与真机 / 真人体验：以最终实际执行记录为准；未执行不宣称通过。
- PWA 更新依赖 SW 新缓存接管，线上文件校验通过后仍可能短时存在旧页面缓存。
