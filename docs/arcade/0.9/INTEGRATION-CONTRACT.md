# Arcade 0.9 挑战模式集成合同（INTEGRATION CONTRACT）

> 本文件是 0.8 分支上实现 0.9 设计包的**唯一技术契约**。所有游戏实现 Agent、测试 Agent 与 Reviewer 以此为准；与设计包冲突时：本文件管工程约定，设计包管关卡意图/数值，经典模式以 0.8 实际代码为准。
> 版本策略：`ARCADE_VERSION` 保持 `0.7.0`（0.8/0.9 均未发布）；不 push/合并/发布。

## 1. 文件布局与所有权

| 路径 | 内容 | 所有者 |
| --- | --- | --- |
| `docs/arcade/0.9/**` | 设计包原样源数据（不改） | Lead（导入） |
| `apps/arcade/challenge/<gameId>.js` | 运行时关卡数据（生成物，入库） | 平台 Agent（生成器） |
| `tools/testdata/challenge/<gameId>.json` | 测试夹具（含 referencePlan/acceptance） | 平台 Agent（生成器） |
| `tools/arcade_09_data.mjs` | 生成/校验脚本（读设计源 → 写运行时数据+夹具+报告） | 平台 Agent |
| `apps/arcade/engine.js` | 新增 `A.Challenge` 共享帮助（存储/选关/结果/解锁） | 平台 Agent |
| `apps/arcade/arcade.css` | 新增挑战 UI 共享样式类 | 平台 Agent |
| `apps/arcade/sw.js` | shell 列表加入 13 个 challenge 数据文件 | 平台 Agent |
| `tools/validate_site.py` | 新增 challenge 静态断言 | 平台 Agent |
| `apps/arcade/games/<game>.html` | 该游戏挑战模式实现 | 对应游戏 Agent |
| `docs/arcade/0.9/impl/<gameId>.md` | 该游戏实现记录（支持的字段/证据/设计差异/UNVERIFIED） | 对应游戏 Agent |
| `tools/challenge/<gameId>.mjs` | 该游戏确定性场景模块 | 对应游戏 Agent |
| `tools/arcade_gameplay_test.mjs` + `tools/lib/arcade_cdp.mjs` | 测试聚合器（自动发现 `tools/challenge/*.mjs`） | 测试 Agent |

**禁止**：游戏 Agent 改 `engine.js`/`arcade.css`/`sw.js`/`validate_site.py`/`tools/arcade_gameplay_test.mjs`/`docs/arcade/0.9/` 设计源；平台 Agent 改任何 `games/*.html`。

## 2. 运行时数据文件约定

每个 `apps/arcade/challenge/<gameId>.js`：

```js
/* 生成物：由 tools/arcade_09_data.mjs 从 docs/arcade/0.9/levels/<gameId>.json 生成；不要手改。 */
window.ArcadeChallengeData = window.ArcadeChallengeData || {};
window.ArcadeChallengeData['shadow-leap'] = {
  schemaVersion: '1.0.0',
  gameId: 'shadow-leap',
  gameName: '影跃',
  packVersion: '0.9.0-design-v1',
  stages: [
    {
      id: 'shadow-leap-C01', stageNumber: 1, title: '初入影林', difficulty: 1,
      goalStatement: '...', decision: '...', practicedSkill: '...', discovery: '...',
      targetDurationSec: [45, 155],
      requiredFeatures: ['challenge_mode', 'stage_gate'],
      content: { /* 设计源 content 原样字段（不含 referencePlan） */ }
    }
    // 6 个
  ]
};
```

页面加载顺序（每款游戏页）：

```html
<script src="../engine.js"></script>
<script src="../challenge/<gameId>.js"></script>
<script>/* 游戏内联脚本：先 A.Challenge.stages(gameId) 取数据 */</script>
```

数据文件缺失/为空/6 关不齐时：挑战入口禁用并显示「挑战数据不可用」，**fail closed**，不影响经典。

## 3. `A.Challenge` API（engine.js）

```js
A.Challenge = {
  SCHEMA_VERSION: 1,
  STORAGE_KEY: 'studiokit:arcade:challenge:v1',

  stages(gameId) -> Array<stage>        // 返回 ArenaChallengeData[gameId]?.stages 的浅拷贝；无数据返回 []
  stage(gameId, ref) -> stage|null      // ref: stageId 字符串 / 1-based stageNumber / 0-based index
  progress(gameId) -> { cleared: string[], best: {[stageId]: {timeSec, assisted, collectibles:string[], at}}, updatedAt }
  isUnlocked(gameId, ref) -> boolean    // C01 恒 true；其余需前一关 id 在 cleared
  markCleared(gameId, stageId, result)  // result: {timeSec, assisted?, collectibles?}；写入并返回 progress；失败静默不抛
  resetGame(gameId)                     // 清空该游戏挑战记录（导出/清除入口用）
  exportData() -> object                // {schemaVersion, games, updatedAt}
  importData(obj) -> {ok, count}        // 校验后整体替换；非法 fail closed
  resultHtml(stage, result) -> string   // 统一结算 HTML（用时/收集/assisted/最佳）
  stageListHtml(gameId) -> string       // 6 关列表 HTML（已通关/最佳/锁定），供选关弹层使用
  formatTime(sec) -> 'mm:ss'
}
```

- 存储 Schema v1：`{schemaVersion:1, games:{<gameId>:{cleared:[], best:{}, updatedAt}}, updatedAt}`。
- **不新增其它 localStorage key**；损坏数据 fail closed（返回空），**不静默删除**原值。
- `Progress.exportText()` 增加 `challenge: A.Challenge.exportData()`；`Progress.importText()` 对 `challenge` 做加法导入（旧备份没有该字段时保留当前挑战记录；配额失败回滚包含该 key）。
- 挑战不写 `progress:v1` 最高分、不写 `playtime:v1` 轮次（沿用 0.8 约定；页面活跃 ms 由既有机制累计，文档说明）。

## 4. 每个游戏页的挑战模式 UI/流程合同

1. **入口**：开始弹层的经典主按钮（`[data-ov-btn]`）文案与行为**完全不变**；新增第二入口 `[data-ov-btn2]` 文案「挑战 6 关」（若该页 btn2 已被经典流程占用，必须在开始弹层内用页面本地 DOM 增加独立按钮，但仍不得改变主按钮行为）。
2. **选关**：页面本地 DOM 面板 `.ac-challenge-panel`（放在 `.stage-box` 内或紧邻），6 个 `.ac-stage-btn[data-stage-id]`；锁定关 `disabled` 且带 `.is-locked`；显示标题、最佳用时、✅；返回按钮回开始弹层。选关 DOM 初始 `hidden`。
3. **关卡内**：顶部 HUD（页面本地 `[data-ch-hud]` 或复用现有 game-hud 增加子元素）显示 `Cxx 标题 · 目标 · 用时`；首次进入 3 秒内展示 `goalStatement` 与操作提示；挑战模式不显示经典分数/高度 HUD（用 hidden 切换）。
4. **状态机**：`ready → playing → paused → playing → cleared | failed`；暂停沿用 `bindPause`（挑战模式暂停弹层 btn2「退出挑战」回选关）；`visibilitychange/blur/pagehide` 自动暂停且不推进计时；刷新/重开恢复同一关同一状态（`runs:v1` 的 `data` 内）。
5. **失败**：可归因文案（关卡特定）+ 主按钮「重试本关」（1 次点击） + btn2「返回选关」；不得用长动画阻塞重试。
6. **通关**：`A.Challenge.markCleared` 写入记录；结算弹层用 `A.Challenge.resultHtml`；主按钮「下一关」（C06 时「返回选关」）、btn2「重玩本关」。
7. **存档**：`serialize()` 增加 `mode:'challenge'`、`stageId`、`challengeState`（游戏自定义可恢复状态）；`restore()` 对 `mode` 缺失按经典恢复；**旧 0.8 `mode:'trial'`/影跃 S1–S3 存档必须安全降级**（影跃改为新 Cxx：能映射则映射 C01–C03，否则提示重开，不静默删档）。
8. **assisted**：挑战中使用限量道具（0.7 道具、影冲不算辅助）时把本关结果 `assisted:true`；结算显示「辅助」标记；经典最高分不受影响。
9. **收集物**：设计 content 中 `collectibles`/bonus 等可选探索项记录进 `collectibles` 数组；不影响通关与战力。
10. **数据认真**：主路线/目标/胜负条件严格按设计 content；不按屏幕坐标硬编码；不随机生成必经路线；发现设计不可达时**先出证据与最小修正建议**，写入 `impl/<gameId>.md` 的「设计差异」，不得静默改目标/删支线。

## 5. 必须提供的 `#test` 钩子（`location.hash === '#test'` 内）

保留现有全部钩子；新增：

```js
challengeStages() -> [{id, stageNumber, title, unlocked, best}]   // 数据+记录
startChallenge(ref) -> boolean                                    // 进入挑战并加载关卡
challengeInfo() -> { mode, stageId, stageIndex, state, elapsedSec, objective, cleared,
                     collectibles, assisted, ... 游戏关键可观测状态 }
stageObservable() -> 游戏自定义对象（棋盘/蛇/车流/铃/矿/塔/弹幕等，供测试断言）
forceStageClear(assisted=false) -> boolean                        // 仅测试用：按当前状态直接结算（用于记录/UI/解锁测试）
forceStageFail(reason) -> boolean                                 // 仅测试用：触发失败路径
exitChallenge() -> boolean
```

测试 Agent 的 CDP 场景会调用这些钩子；`forceStageClear` 不得作为“关卡可玩”的唯一证据（见 §6）。

## 6. 测试与证据合同

- 每款游戏新增 `tools/challenge/<gameId>.mjs`：

```js
export default {
  gameId: 'shadow-leap',
  gameFile: 'shadow-leap.html',
  scenarios: [
    { id: 'CH-SL-001', title: '挑战数据与选关', setup: async (cdp, base) => {}, run: async (cdp, ctx) => {} },
    // 至少覆盖：6 关数据/选关锁定、C01 参考通关、失败重试、暂停刷新恢复、经典不回归
  ]
};
```

- `tools/arcade_gameplay_test.mjs` 自动发现 `tools/challenge/*.mjs`（测试 Agent 负责），`--game=<id>` 可筛选；原有 11 场景保持绿。
- **参考通关证据**：优先用真实输入（键/指针事件）按设计 `referencePlan` 在真实引擎中完成；确实无法自动化的物理关卡，可用逐帧确定性驱动/钩子回放，但必须在 `impl/<gameId>.md` 明确证据等级（`real-input-replay` / `engine-replay` / `ui-only`）并说明差距。**`ui-only`（只弹通关 UI）不得作为 DONE 证据**。
- 每游戏至少 1 个失败路径 + 1 个暂停/刷新恢复断言 + 1 个经典回归断言 + 320/390 无横向溢出断言。
- 静态门禁：`py -3 tools/validate_site.py`、`py -3 tools/build_site.py`（Lead 跑）、`node --check` 全部 JS、`node tools/arcade_smoke.mjs` 必须保持 **85/85**。

## 7. 共享样式类（arcade.css，平台 Agent 提供）

`.ac-challenge-panel`、`.ac-challenge-head`、`.ac-challenge-grid`、`.ac-stage-btn`、`.ac-stage-btn.is-locked`、`.ac-stage-btn.is-cleared`、`.ac-stage-meta`、`.ac-challenge-hud`、`.ac-challenge-tip`、`.ac-challenge-result`、`.ac-assisted-badge`、`.ac-collect-badge`。游戏可加页面内 `<style>` 微调，但不得改其它游戏可见的全局行为。

## 8. 平台 Agent 必做清单（P1）

1. `tools/arcade_09_data.mjs`：读 `docs/arcade/0.9/levels/*.json`，校验（13 游戏×6 关、id/编号/必填字段、路线引用、goal/win 存在、requiredAbility 合法、`validate_levels.py` 可复跑），生成 13 个运行时数据 + 测试夹具 + `docs/arcade/0.9/DATA-INTEGRATION-REPORT.md`。
2. engine.js `A.Challenge`（§3）+ export/import 加法集成；不破坏 85 项 smoke。
3. arcade.css 挑战样式（§7）。
4. sw.js shell 列表加入 13 个 challenge 数据文件（缓存版本暂不升，文档标注发布前处理）。
5. validate_site.py 增加：13 个 challenge 数据文件存在且含对应 gameId；`A.Challenge` 标记与 `STORAGE_KEY` 常量存在；不改变既有版本断言。
6. 跑 `node tools/arcade_smoke.mjs` 85/85、`node --check`、`validate_site.py`、`build_site.py`，并在回报中给真实输出。

## 9. 完成定义（每游戏）

- 6 关全部可从选关进入并真实可完成（或记录明确不可达证据 + Owner/Reviewer 审批的偏差）。
- 记录/解锁/最佳/assisted 正确；刷新/暂停恢复；失败 2 次点击内重试。
- 经典模式与 0.7 道具无回归；85 项 smoke 全绿。
- 320×568 / 390×844 模拟无溢出、按钮 ≥44px、双指并发可用（真机 UNVERIFIED 要写明）。
- `impl/<gameId>.md` 完成：支持字段、证据等级、设计差异（原值→新值→原因）、UNVERIFIED、Reviewer 结论占位。
