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
| `arcade_pwa_update_test.mjs` | **9/9 PASS** | 0.21.2 当前版本与 0.21.3 模拟线上新版本，横幅/广播/刷新前后判定 |
| `career_passive_entry_test.mjs` | **71/71 PASS** | 入口可见性、旧档、封存/解冻/重置 |
| `career_commission_test.mjs` | **64/64 PASS** | 委托票号、URL、幂等与奖励 |
| `validate_site.py` / `build_site.py` / `node --check` | **PASS** | 静态校验、构建与脚本语法 |
| `arcade_run_all_gates.py --profile release` | **40/41 PASS** | 唯一失败为测试缓存键字面量误写 `-v2`；产品 SW 实际为 `0.21.2-v1`。修正断言后 `career_pwa_offline` 18/18、`arcade_pwa_update` 9/9、static 35/35 均复跑通过；其余 40 项未重跑，未改产品代码 |

## 3. 发布证据

- 发布提交：`bc50e61`；[Actions 45858201941](https://github.com/Shawlaw/studiokit/actions/runs/45858201941) 的 Validate and build、Arcade static gates、Deploy GitHub Pages、Deploy Cloudflare Pages、Verify both deployments 全部成功。
- 双端校验：`verify_deploy.py` → **91/91 files identical**，Arcade 0.21.2 / Badge 2.2.1 / Venue 0.2.0。
- 线上浏览器实测：GitHub Pages 与 Cloudflare Pages 均为 `Arcade.version=0.21.2`；建立测试生涯后点击「旧港生涯」，URL 保持中心页且告示板直接打开；钱包弹窗标题为「钱包与收据」、遮罩层级 `10000`、背景滚动锁 `hidden`；两端均无 console error。

## 4. 未解决项

- `full` profile 与真机 / 真人体验：以最终实际执行记录为准；未执行不宣称通过。
- PWA 更新依赖 SW 新缓存接管，线上文件校验通过后仍可能短时存在旧页面缓存。
