# 0.8.0 → 0.9.0 差异报告（DIFF REPORT）

> 依据：本地 HEAD `6a7b246`（`feat/arcade-0.8-gameplay`）+ 0.8.0 竖切片实际代码 + 0.9 设计包（`docs/arcade/0.9/`）。
> 设计包要求先出差异报告再实施；本报告是 Agent 侧事实核对，不代表 Owner 决策。

## 1. 0.8.0 已落地资产（实际代码）

| 能力 | 0.8.0 现状 | 证据 |
| --- | --- | --- |
| 影冲 | 每跳一次、落地补充、Shift/J + 独立 ≥44px 按钮、暂停/刷新恢复、旧档默认 | `apps/arcade/games/shadow-leap.html`（GP004） |
| 挑战模式（仅影跃） | 数据驱动 `STAGES` 内嵌 S1–S3、影门 AABB 结算、失足 1 次点击重试、暂停退出、双路线判定/卷轴/失败复盘 | `shadow-leap.html`（GP005/006） |
| 局内存档 | 每游戏单条 `studiokit:arcade:runs:v1`，挑战字段只在 `data` 内 | `apps/arcade/engine.js` `RunSave` |
| 进度/统计 | `progress:v1`（最高分）与 `playtime:v1`（轮次）保持经典语义；挑战不写轮次 | `engine.js` `Progress`/`Playtime` |
| 测试基座 | 零依赖 CDP 库 `tools/lib/arcade_cdp.mjs`；`tools/arcade_gameplay_test.mjs` 11 场景；`tools/arcade_stage_solver.mjs` | 0.8 交付 |
| 发布 | 0.7.0 已双端发布；0.8 竖切片未推送/未发布 | `TASKS.md` T034–T040 |

## 2. 0.9 设计与 0.8 的差异（需新增/适配）

| 维度 | 0.9 要求 | 0.8 现状 | 决策 |
| --- | --- | --- | --- |
| 覆盖游戏 | 13 款 × 6 关 = 78 关 | 仅影跃 3 关（S1–S3，数据格式不同） | 全部按 0.9 数据重做挑战模式；影跃 S1–S3 迁移为 C01–C03 新数据，旧 0.8 试炼字段按新 Cxx id 兼容读取 |
| 关卡数据 | 每游戏独立 JSON（content/referencePlan/acceptance），坐标语义各异 | 影跃单体内嵌 S1–S3 | 设计源入库 `docs/arcade/0.9/levels/`；生成 `apps/arcade/challenge/<gameId>.js` 运行时数据；`referencePlan` 只给测试，不进运行时 |
| 关卡记录 | challenge 模式分离记录（完成/最佳/辅助/收集） | 无跨局挑战记录（仅本局） | 新增 `studiokit:arcade:challenge:v1`（Schema v1），导出/导入加法兼容 |
| 模式入口 | 每游戏「挑战 6 关」入口 + 选关 + 解锁 | 仅影跃试炼 | 统一入口与选关 UI（页面本地 DOM + 共享 CSS），经典主按钮不变 |
| 必做机制 | 逐游戏 requiredFeatures（残局/门牌/时间轴/Boss 阶段/线索/镜像等） | 大部分不存在 | 各游戏按设计实现 challenge 专用机制，**不篡改经典规则** |
| 辅助标记 | 挑战成绩标记 assisted | 0.8 未实现 | challenge 记录 `assisted`；经典不受影响 |
| 测试证据 | 参考路线真实引擎回放/自动回放 + 失败轨迹 | 11 场景 + 求解器 | 每游戏新增 `tools/challenge/<gameId>.mjs` 场景；聚合进总 runner；Reviewer 独立复核 |
| 移动/AFK | 320/390 预检、切后台 2 分钟恢复、刷新续玩 | 0.8 已覆盖影跃 | 全部游戏挑战模式按同一合同；真机仍 UNVERIFIED |
| SW/离线 | 新增运行时数据文件需离线可用 | shell 列表无 challenge 数据 | 更新 `apps/arcade/sw.js` shell 列表（正式发布时再升缓存版本） |
| 版本 | 0.9 候选 | `ARCADE_VERSION=0.7.0`（0.8 未发布） | 本阶段**不升版本**，文档标注 0.8/0.9 均未发布；发布由 Owner 决定 |

## 3. 冲突与保护

1. **经典模式零改动**：所有挑战逻辑在 `mode='challenge'` 分支内；经典主按钮 `[data-ov-btn]`、旧存档键、最高分语义、13 款 0.7.0 道具保持。
2. **影跃旧 S1–S3 数据**：0.8 的 `trial*` 字段与 S1–S3 试炼将被 0.9 C01–C06 取代；旧 `runs:v1` 中的 `mode:'trial'` 存档必须安全降级（可恢复或提示重开，不静默删档）。详见实现记录。
3. **不新增游戏运行时框架**：挑战数据是静态 JS 全局对象 + 每页本地适配，不引入 fetch/打包器/第三方库。
4. **不改设计源**：`docs/arcade/0.9/levels/**` 与设计文档保持原样；任何数值偏差写入各游戏 `impl/<gameId>.md` 的「设计差异」并说明原值/新值/原因。
5. **发布边界**：本地提交，不 push/合并/打 Tag/部署；`tools/`、`docs/` 不进发布产物。

## 4. 需 Owner 决策/试玩的点

- 影跃 C01–C03 新数据的真实手感与「第二次是否愿意练」。
- 78 关整体难度/时长是否符合「短局 + 随时离开」。
- 挑战记录 `challenge:v1` 与经典记录分离的 UX（是否在中心页展示）。
- 是否在正式发布时升 `ARCADE_VERSION` / SW 缓存版本 / 更新注册表。
