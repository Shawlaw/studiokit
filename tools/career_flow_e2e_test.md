# career_flow_e2e_test.mjs 说明

生涯首航 V2（DESIGN-0.20.0）零剧情种子真实 UI 链路门禁。工作树分支 `codex/career-flow-test`，基线 `1e22a52`。

## 运行

```
node tools/career_flow_e2e_test.mjs --static-only   # 无 Chrome：内容路线 + 接口矩阵
node tools/career_flow_e2e_test.mjs                # 全量（独占 Chrome 时段）
```

端口环境变量：`CAREER_FLOW_PORT`（默认 9021）、`CAREER_FLOW_CDP`（默认 9521）、`CHROME_PATH`、`CAREER_FLOW_QA_DIR`。替代真实路线可设 `CAREER_FLOW_ALLOW_ALTERNATE=1`，但仍逐单核验真实推进。

退出码：0 全 PASS；1 FAIL 或 BLOCKED；2 用法/环境错误。

## 覆盖清单

- 新 profile 与 `resetAll()`：无 career 身份、无旗标、无 claim，不写 C0/C1/tier quest。
- 经典黑杰克真实 6 手自然结算 → 线索 chip 可点/热区/aria → 故意错过 chip。
- 首页「旧港有一封来信」→ 真实点击 `?careerLetter=1` → 未读信重显 → 关闭回到游戏页 → 读过后「继续旧港来信」。
- 信件单一主动作「按地址投递 · 去港口」→ 一次点击进港。
- 告示板首屏只读推荐单：游戏名/世界目标/数量/原因/主按钮；推荐标记 `推进本章`/`路线进展` 与真实完成性一致。
- 首选路线逐单：`star-raid.T1` → `pendulum-tower.T1` → `shadow-leap.T1`（中间）→ `shadow-leap.T2` → `star-raid.T2`（中间）→ `pendulum-tower.T2`，每单只读 claim/quests/evidence 核验真实旗标与章节状态；中间单不产章节旗标。
- `shadow-leap.T1` 第一次真实做不足 → 失败收据 → 一键重接 → 再次真实成功。
- 收据三回报 + 「下一步：」+「已完成章节：」+ 页内「回告示板 / 读回信」主动作（≥44px、至多一次整页跳转）。
- 终局：C4 后当前屏三终局按钮（≥44px）→ 玩家点击 research → 真实 256+256 合并产出 512 事件 → C5 + ending.research 唯一。
- 玩家可见文本扫描：无 `C0–C5`、`.T1–.T6`、`E-/BP-/MAP-/DEC-`、`active/locked`、长 id。
- 320×700、375×548（0.19 紧凑）、390×844、430×932 四档视口无横向溢出、主动作热区 ≥44px。

## 依赖的产品接口（未集成时显式 BLOCKED，不静默跳过）

| 接口 | 位置 | 状态（基线 1e22a52 静态检查） |
| --- | --- | --- |
| `campaign.recommend`（ADR §20.9） | `apps/arcade/career/campaign-core.js` | BLOCKED |
| `[data-town-recommend-id]` / `[data-town-recommend-kind]` | `apps/arcade/career/ui/town.js` | BLOCKED |
| `路线进展` / `推进本章` 推荐文案 | `apps/arcade/career/ui/town.js` | BLOCKED |
| 收据 `已完成章节：` / `下一步：` | `apps/arcade/career/ui/receipt.js` | BLOCKED |
| 收据 `回告示板` / `读回信` 主动作 | `apps/arcade/career/ui/receipt.js` | BLOCKED |
| 结算 storyFeedback 接线 | `apps/arcade/career/bridge.js` | BLOCKED |
| 首页 `旧港有一封来信` / `继续旧港来信` / `careerLetter=1` | `apps/arcade/index.html` | INTEGRATED |
| 线索 chip `[data-career-clue]` | `apps/arcade/career/ui/clue-surface.js` | INTEGRATED |
| 章节面板 `[data-chapter-id]` / `[data-approach]` | `apps/arcade/career/ui/world-state.js` | INTEGRATED |

静态自检当前结果：PASS 12 / FAIL 1（非关键首屏 `data-town-intro`）/ BLOCKED 6。FAIL 为非关键记录，不阻断；BLOCKED 为关键接口缺失，退出码 1，符合“未集成时明确 fail/blocked”。

## 路线内容一致性

`--static-only` 的 S01–S09 按真实 `commissions.json` / `campaign.json` / `chapter-01.json` / `ending-research.json` 投影首选路线证据，验证 C1→C2→C3→C4 逐单真实完成、中间单不跳章、C5 终局需 C4 且真实产出两个旗标。内容被修正（如 651e9fe）后须重跑静态模式确认路由投影仍成立。

## 不做的改动

不修改产品文件、既有测试、localStorage key、IndexedDB Schema、游戏数值；不 push/merge/rebase；不直接写章节旗标或 tier quest。游戏侧只用页面自带 `?careerTest=1#test` / `#test` 钩子驱动真实事件与结算。
