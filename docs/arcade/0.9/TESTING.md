# Arcade 0.9 挑战模式测试基座（T056）

> 状态：**阶段 1 完成**（分支 `feat/arcade-0.8-gameplay`；只改 `tools/` 与本文档，不改 `apps/`）。
> 上游依据：`docs/arcade/0.9/INTEGRATION-CONTRACT.md`（尤其 §5/§6）、`docs/arcade/0.9/PLAN.md`、`docs/arcade/0.8.0-TESTING.md`。
> 一句话：**`arcade_smoke.mjs` 保证 0.7/0.8 经典全链路不回退；`arcade_gameplay_test.mjs` 用固定初始状态 + 稳定场景 ID 断言玩法不变量；0.9 起它同时是 13 款游戏挑战场景模块的聚合器与 78 关数据门禁。**

## 1. 三层测试的职责

| 层 | 文件 | 关注点 | 基线 |
| --- | --- | --- | --- |
| 全链路回归 | `tools/arcade_smoke.mjs` | 门户/中心页、13 款游戏经典开始→暂停→存档→续玩、旧档兼容、道具、PWA/断网、320–430px 布局等 | **85/85**，数量与名称不得减少 |
| 确定性玩法（base） | `tools/arcade_gameplay_test.mjs --suite=base` | 11 个内置场景：0.8 的 6 个（教学平台/道具/seed/Boss/安全走廊/影冲存档）+ 影跃 5 个保留 ID、已迁移为 0.9 挑战语义（SC-SL-004..008） | **11/11**（迁移后实测 `--repeat=2` 22/22） |
| 挑战模式（challenge） | `tools/arcade_gameplay_test.mjs --suite=challenge` | 内置全局门禁 `CH-DATA-001`（78 关数据）与 `CH-CLASSIC-001`（13 游戏经典回归）+ 自动发现的 `tools/challenge/*.mjs` 游戏场景 | 全局门禁即日起必须全绿；游戏模块随交付逐批启用 |

三层都复用 `tools/lib/arcade_cdp.mjs`（零 npm 依赖：静态服务器 / Chrome / CDP / 断言记录器），只跑本机无头 Chrome。

## 2. 文件布局与所有权

| 路径 | 职责 | 所有者 |
| --- | --- | --- |
| `tools/arcade_gameplay_test.mjs` | 聚合器：base 场景 + 挑战模块自动发现 + 全局门禁 + CLI | 测试 Agent |
| `tools/lib/arcade_cdp.mjs` | 通用 CDP/服务器/Chrome/断言库（被 smoke 与 runner 共用） | 测试 Agent |
| `tools/challenge/<gameId>.mjs` | 每款游戏的挑战场景模块（协议见第 5 节） | 对应游戏 Agent |
| `docs/arcade/0.9/levels/*.json` | 78 关设计源（只读） | Lead 导入，禁止修改 |
| `apps/arcade/challenge/<gameId>.js` | 运行时挑战数据（生成物） | 平台 Agent |
| `tools/testdata/challenge/<gameId>.json` | 测试夹具（含 referencePlan/acceptance） | 平台 Agent |
| `test-artifacts/` | 运行截图与日志（gitignored，**不要提交**） | 运行产物 |

测试 Agent **不代改**游戏 Agent 的模块；模块问题通过 FAIL 输出与 Lead/对应 Agent 沟通。

## 3. 运行命令

```powershell
# 语法（改 tools/ 后必跑）
node --check tools/arcade_gameplay_test.mjs
node --check tools/lib/arcade_cdp.mjs

# 场景清单（不启动 Chrome/服务器；会做模块发现与结构校验）
node tools/arcade_gameplay_test.mjs --list
node tools/arcade_gameplay_test.mjs --help

# base：0.8 的 11 个场景
node tools/arcade_gameplay_test.mjs --suite=base

# challenge：全局门禁 + 已发现的游戏模块（模块缺失时正常 SKIP）
node tools/arcade_gameplay_test.mjs --suite=challenge

# 单游戏 / 单场景 / 确定性复跑
node tools/arcade_gameplay_test.mjs --game=shadow-leap
node tools/arcade_gameplay_test.mjs --scenario=SC-SL-003 --scenario=CH-SL-001
node tools/arcade_gameplay_test.mjs --repeat=2            # 默认 --suite=all

# 0.9 全量门禁（Wave 2 收口）
node tools/arcade_gameplay_test.mjs --repeat=2
```

输出约定（与 `arcade_smoke.mjs` 相同）：

```text
PASS  CH-SL-001 影跃·挑战数据与选关 — stages=6, locked=5, evidence=engine-replay · evidence=engine-replay
SKIP  challenge-modules 挑战场景模块 — tools/challenge/ 不存在（游戏 Agent 尚未交付；出现后自动发现）
SKIP  CH-DATA-001/runtime 运行时挑战数据 — apps/arcade/challenge/*.js 尚未生成 → 运行时一致性检查 SKIP（设计源检查照常执行）
FAIL  CH-MODULE tools/challenge/typo.mjs — scenarios 必须是非空数组
13/13 scenario runs passed
```

- 退出码：`0` 全部 PASS（正常 SKIP 不计失败）；`1` 任一场景/模块 FAIL 或运行环境失败；`2` CLI 用法错误（未知参数/未知场景 ID/非法 `--suite`/`--repeat`/`--game`）。
- 每个浏览器场景结束截图到 `test-artifacts/gameplay-<场景ID>[-r<遍数>].png`；`CH-CLASSIC-001` 另存 13 张 `challenge-classic-<gameId>.png`。纯 Node 场景（`CH-DATA-001`）不截图。
- `pending: '原因'` 的场景只打印 `SKIP`，不计入 PASS/FAIL/退出码；钩子交付后必须删除 `pending` 并实测通过，**不允许**用 pending 掩盖失败。

## 4. 端口、环境变量与并发

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `ARCADE_SMOKE_PORT` | `8765` | `arcade_smoke.mjs` 静态服务器（默认值保持不变） |
| `ARCADE_CDP_PORT` | `9333` | `arcade_smoke.mjs` Chrome DevTools 端口（默认值保持不变） |
| `ARCADE_GAMEPLAY_PORT` | `8766` | `arcade_gameplay_test.mjs` 静态服务器 |
| `ARCADE_GAMEPLAY_CDP_PORT` | `9334` | `arcade_gameplay_test.mjs` Chrome DevTools 端口 |
| `CHROME_PATH` | 本机 Chrome 默认路径 | 自定义 Chrome 可执行文件 |

- 两个 runner 默认端口已错开，可同时跑；**多个 Agent 并行时一律用 env 覆盖端口**，避免撞端口/撞 Chrome profile（例如本任务阶段 1 实测用 `8786/9384`，smoke 用 `8796/9396`）。
- 每次运行创建独立 `mkdtemp` Chrome profile 并在结束时清理；runner 只监听 `127.0.0.1`。
- `CH-DATA-001` 是纯 Node 数据审计：若一次运行只选中它，不会启动静态服务器/Chrome。
- 端口冲突排查：`Get-NetTCPConnection -LocalPort <port>`；`EADDRINUSE` = 静态服务器冲突，`timeout waiting for http://127.0.0.1:<port>/json/version` = CDP 端口冲突或 Chrome 无法启动。

## 5. 挑战场景模块协议（`tools/challenge/<gameId>.mjs`）

### 5.1 最小模板

```js
/**
 * 影跃 0.9 挑战模式确定性场景（示例：实际由影跃 Agent 维护）。
 * 只读使用页面 #test 钩子；不修改游戏代码、不写持久数据。
 */
export default {
  gameId: 'shadow-leap',            // 必须是 0.9 的 13 款游戏之一
  gameFile: 'shadow-leap.html',     // apps/arcade/games/ 下的文件名
  evidence: 'engine-replay',        // 可选：模块默认证据等级（见第 6 节）
  scenarios: [
    {
      id: 'CH-SL-001',              // 稳定 ID：CH-<GAME>-<NNN>，永不复用/重编号
      title: '影跃·挑战数据与选关',
      evidence: 'ui-only',          // 可选：覆盖模块级证据等级
      pending: undefined,           // 可选：依赖钩子未交付时只 SKIP
      async setup(cdp, base) {
        // 固定初始状态：清 localStorage 已由 runner 完成；这里点击开始/调用钩子进入目标状态
        await cdp.waitFor('typeof window.__arcadeTest.startChallenge === "function"', { timeout: 6000 });
        await cdp.evaluate('window.__arcadeTest.startChallenge(1)');
        await cdp.waitFor('window.__arcadeTest.challengeInfo().state === "playing"', { timeout: 8000 });
      },
      async run(cdp, ctx) {
        const stages = await cdp.evaluate('window.__arcadeTest.challengeStages()');
        ctx.assert(Array.isArray(stages) && stages.length === 6, '挑战关卡应为 6 个');
        return { stages: stages.length };   // 证据摘要：只放稳定值/布尔值
      },
    },
  ],
};
```

### 5.2 字段与执行语义

| 字段 | 必填 | 语义 |
| --- | --- | --- |
| `gameId` | 是 | 0.9 的 13 款游戏 ID 之一；同一 gameId 只允许一个模块 |
| `gameFile` | 是 | 必须存在于 `apps/arcade/games/`，用于 runner 的每场景初始导航 |
| `evidence` | 否 | 模块默认证据等级：`real-input-replay` / `engine-replay` / `ui-only` |
| `scenarios[]` | 是 | 非空数组；每项见下 |
| `.id` | 是 | `CH-<GAME>-<NNN>`；全库唯一（与 base/全局场景也不得冲突） |
| `.title` | 是 | 中文短语，会出现在 PASS/FAIL 行 |
| `.setup(cdp, base)` | 否 | 只做“进入固定初始状态”；runner 已清空 localStorage 并带 `?ch009=<id>-<n>#test` 整页加载 |
| `.run(cdp, ctx)` | 是 | 只做观察/状态机操作；失败用 `ctx.assert` 抛错；返回对象 = PASS 行的证据摘要 |
| `.evidence` | 否 | 覆盖模块级证据等级 |
| `.pending` | 否 | 字符串原因；有值时只 SKIP，不计失败（过渡态专用） |
| `.needsBrowser` | 否 | 默认 `true`；`false` 表示纯 Node 场景（不导航/不截图） |

`ctx`（`run(cdp, ctx)` 第二个参数）提供：`base`（静态服务器根 URL）、`repoRoot`、`artifacts`、`assert`、`record`、`sleep`、`round1`、`gameId`、`gameFile`、`scenarioId`、`suite`、`source`、`moduleFile`、`evidenceLevel`、`attempt`、`repeat`。游戏 Agent 可以只依赖 `cdp`，需要通用 helper 时从 `ctx` 取，**不要**在模块里重新实现服务器/Chrome。

### 5.3 自动发现与错误策略

- runner 启动时扫描 `tools/challenge/*.mjs`（按文件名排序）并动态 `import` 默认导出。
- **目录不存在 / 为空**：正常跳过（打印 `SKIP  challenge-modules …`，不判失败）——Wave 1 期间 13 个模块陆续交付时仍可跑全量。
- **模块语法错误 / 默认导出结构非法 / gameId 非法 / gameFile 不存在 / 场景 ID 不合协议或重复 / evidence 非法**：输出 `FAIL  CH-MODULE <文件> — <原因>` 并计入退出码。**不允许**静默忽略，否则坏模块会被当成“没有模块”。
- 同一 `gameId` 出现两个模块、或场景 ID 与内置场景冲突：记录 FAIL 并跳过冲突项。
- 模块之间互相独立：一个模块加载失败不影响其它模块与内置场景执行。

## 6. 证据等级（引用 INTEGRATION-CONTRACT §6）

每款游戏至少有 1 个“参考通关”场景，并明确证据等级；Runner 会把模块/场景声明的证据等级打印在 PASS 行（`evidence=…`）并在结束时汇总。

| 等级 | 含义 | 可作为关卡 DONE 证据 |
| --- | --- | --- |
| `real-input-replay` | 用真实键/指针事件按设计 `referencePlan` 在真实引擎中完成 | ✅ 最高等级 |
| `engine-replay` | 逐帧确定性驱动或引擎钩子回放（物理/弹幕类难以真实输入时） | ✅ 但必须在 `impl/<gameId>.md` 写明与真实输入的差距 |
| `ui-only` | 只调用 `forceStageClear` 弹通关 UI，未证明关卡可玩 | ❌ 不得作为 DONE 证据；只能用于记录/UI/解锁接线断言 |

每游戏场景最低覆盖（契约 §6 / PLAN §3）：

1. 6 关数据与选关锁定（C01 恒开、C0N 需前一关通关）；
2. C01 参考通关（证据等级写入模块 `evidence` 与 `impl/<gameId>.md`）；
3. 至少 1 个失败路径（可归因文案、2 次点击内重试）；
4. 至少 1 个暂停/刷新恢复断言；
5. 至少 1 个经典回归断言；
6. 320 / 390 宽度无横向溢出断言（无头 Chrome 视口模拟；真机仍为 UNVERIFIED）。

`forceStageClear` 可以用于记录/解锁/结算 UI 断言，但**不能**作为“关卡可玩”的唯一证据。

## 7. 内置全局门禁场景

### 7.1 `CH-DATA-001`：13 游戏 × 6 关数据门禁（纯 Node，无需浏览器）

- **设计源**：`docs/arcade/0.9/levels/*.json`（只读）
  - 13 个文件齐全、`gameId`/`gameName` 合法、每游戏恰好 6 关、全量 78 个关卡 id 唯一；
  - 每关：`id` 符合 `<gameId>-C01..C06`、`stageNumber` 1–6、`title`/`goalStatement`/`decision`/`practicedSkill`/`discovery` 非空、`mode === 'challenge'`、`integration.separateClassicProgress === true`、`requiredFeatures` 非空、`content`/`referencePlan`/`acceptance` 非空、`targetDurationSec` 为合法区间；
  - **content 关键结构**：按设计包 `validate_levels.py` 的检查项精神做独立简化实现（不重写其 1088 条断言）：影跃平台/路线/影门可达、雪铃顺序与上升高度、俄罗斯方块棋盘+参考硬降消行、2048 参考方向与目标块、极速车道安全车道见证、贪吃蛇固定路径仿真、记忆翻牌成对牌面、黄金矿工参考捕获价值+钩爪射线不拦截、打地鼠事件/金鼠/同洞不重叠、砖块 5×8 与锁门钥匙、星海波次时间/预警、重力翻转障碍间距/预警、层塔箱数与目标偏置。
- **运行时数据**（`apps/arcade/challenge/<gameId>.js`，存在才审计）：
  - 用一个只暴露 `window` 的最小沙箱执行生成脚本（等价于语法检查 + 读取全局），断言 `window.ArcadeChallengeData[gameId]` 结构、`schemaVersion`、6 关 id/顺序、`stageNumber`/`title`/`goalStatement`/`requiredFeatures`/`content` 与设计源逐字段一致；
  - **文件缺失时 SKIP**（打印 `SKIP CH-DATA-001/runtime …`），设计源检查照常执行；文件存在但损坏/不一致 → FAIL。
- 输出证据摘要：`games=13, stages=78, designChecks=<n>, runtime=13/13|absent(SKIP), runtimeChecks=<n>`。

### 7.2 `CH-CLASSIC-001`：13 游戏经典入口回归（浏览器）

- 从中心页读取 `Arcade.GAMES`，断言 13 款游戏清单与 0.9 设计源一致；
- 逐游戏打开 `…/games/<file>?ch009-classic=<id>#test`：
  - 开始弹层可见；`[data-ov-btn]` 存在/可见/可用，文案保持「开始游戏」；
  - 统计开始弹层第二入口（`[data-ov-btn2]`，0.8 的影跃「影之试炼」属经典流程遗留）与 `.ac-challenge-panel`：**只统计不误判**，挑战入口行为由各游戏模块断言；
  - 点击经典主按钮后开始弹层隐藏（与 `arcade_smoke.mjs` 相同的通用“经典已开始”信号），启动期间无页面报错；每游戏截图。
- 阶段 1 只断言“经典仍可启动、主按钮未被挑战入口占用”；阶段 2（游戏页改造完成后）在同一场景追加：挑战入口可见性（`[data-ov-btn2]` 文案「挑战 6 关」或页面本地入口）、选关面板打开/返回、经典主按钮行为不变。若入口方式差异较大，可拆为 `CH-CLASSIC-002`，不改本场景已发布断言语义。

## 8. 当前阶段状态

### 8.1 阶段 1（已完成）

- `tools/arcade_gameplay_test.mjs`：保留 0.8 的 11 个场景与 `--list/--scenario/--repeat/--help` 语义；新增 `--suite=base|challenge|all`、`--game=<gameId>`、`tools/challenge/*.mjs` 自动发现、`CH-DATA-001`、`CH-CLASSIC-001`、模块证据汇总；退出码 0/1/2 语义保留。
- 影跃 0.9 迁移：`SC-SL-004..008` 保留 ID 但已从 0.8 trial(S1–S3) 改写为 0.9 挑战(C01–C06) 语义；g-shadow 交付 challenge 钩子后已删除 `pending` 并实测 **11/11（`--repeat=2` 22/22）** 全绿。迁移细节见 §8.3。
- 平台 Agent 的 13 个运行时数据文件已生成，`CH-DATA-001` 的运行时一致性检查已启用并通过。
- 游戏场景模块（`tools/challenge/*.mjs`）分批交付中：首批 9/13 模块（shadow-leap、memory-flip、mole-whack、road-rush、snake-run、block-drop、merge-2048、brick-breaker、gravity-flip）已可自动发现；首轮 `--suite=challenge` 见 §8.4，其余 4 个（snowbells、pendulum-tower、star-raid、gold-miner）交付后跑最终全量。

阶段 1 实测（Windows / Node v25.8.1 / 本机 Chrome 无头；端口均 env 覆盖避免并行冲突）：

| 命令 | 结果 |
| --- | --- |
| `node --check tools/arcade_gameplay_test.mjs` / `tools/lib/arcade_cdp.mjs` | 通过（exit 0） |
| `node tools/arcade_gameplay_test.mjs`（默认端口，--suite=all） | **13/13 scenario runs passed**，exit 0，31.2s（11 base + CH-DATA-001 + CH-CLASSIC-001） |
| `node tools/arcade_gameplay_test.mjs --repeat=2` | **26/26 scenario runs passed**，exit 0，49.8s，证据逐遍一致 |
| `node tools/arcade_gameplay_test.mjs --scenario=CH-DATA-001` | PASS：`games=13, stages=78, designChecks=2256, runtime=13/13, runtimeChecks=1281` |
| `node tools/arcade_gameplay_test.mjs --scenario=CH-CLASSIC-001` | PASS：`games=13, classicStarted=13, mainButton=开始游戏, entryButtons=13, challengeEntryVisible=0, legacyVisibleEntries=1, challengePanels=0` |
| 模块发现探针（临时模块，已删除） | 合法模块被自动发现并进入模块证据汇总；缺 `scenarios` 与语法错误分别输出 `FAIL CH-MODULE …`，exit 1；目录为空时 `SKIP` 且 exit 0 |
| `node tools/arcade_gameplay_test.mjs --suite=base`（影跃 0.9 迁移后） | **11/11 scenario runs passed**，exit 0，18.3s；`--repeat=2` → **22/22 passed**，exit 0，35.0s |
| `node tools/arcade_gameplay_test.mjs --game=shadow-leap --repeat=2`（g-shadow 模块） | **16/16 passed**，exit 0，80.2s（8 场景 ×2；证据 real-input-replay/engine-replay/ui-only） |
| `ARCADE_SMOKE_PORT=8796 ARCADE_CDP_PORT=9396 node tools/arcade_smoke.mjs` | 85/85 checks passed，exit 0（详见第 9 节基线记录） |

### 8.2 阶段 2 收口步骤（进行中）

1. `node tools/arcade_gameplay_test.mjs --suite=challenge --repeat=2`：先跑全局门禁 + 已交付模块；失败项区分“产品缺陷（报对应游戏 Agent/Lead）”与“测试自身问题（本模块修复/补 helper）”。
2. 逐批核对每款游戏的 `impl/<gameId>.md` 证据等级与模块声明一致；`ui-only` 不得作为关卡 DONE 证据。
3. 全量回归：`node tools/arcade_gameplay_test.mjs --repeat=2` + `ARCADE_SMOKE_PORT=8796 ARCADE_CDP_PORT=9396 node tools/arcade_smoke.mjs` 85/85。
4. 把第 10 节汇总表填成实际结果；必要时扩展本 runner 的通用 helper（只动 `tools/`，不破坏 smoke 85/85）。

### 8.3 影跃 0.8 → 0.9 base 场景迁移（Lead 追加任务）

g-shadow 把影跃从 0.8 的 S1–S3 trial 迁移到 0.9 的 C01–C06 挑战模式后，原 0.8 trial 专用断言语义会失效。裁决：**保留 5 个场景 ID，改写为 0.9 挑战语义**，不允许长期 SKIP。

| 场景 ID | 0.8 旧语义（已废弃） | 0.9 新语义 | 主要依赖钩子 |
| --- | --- | --- | --- |
| `SC-SL-004` | 试炼 3 关摘要、`startTrial/loadStage`、S1 影门清关进 S2 | 挑战 6 关数据（C01–C06）与运行时一致性、选关解锁（C01 恒开/其余锁定）、`startChallenge(1)` → 影门清关 → 结算「下一关」→ C02、C01 写入 `challenge:v1` | `A.Challenge.stages/progress/isUnlocked`、`challengeStages`、`startChallenge`、`challengeInfo`、`forceReachGoal`/`forceStageClear` |
| `SC-SL-005` | 试炼 S1 `forceFall` → 「失足」→ 1 次点击重试回起点、计时重置 | 挑战失败归因文案（标题/正文/主按钮含「重试」）→ 1 次点击重试回本关同关起点、`elapsedSec` 重置 | `startChallenge`、`forceStageFail`、`challengeInfo`、`stageObservable`/`player` |
| `SC-SL-006` | 试炼 S2 暂停→刷新恢复 `mode='trial'`；旧经典档仍经典 | 挑战 C02 暂停→刷新继续恢复 `mode='challenge'`/`stageId`/位置；旧经典档（剥离 `mode/stageId/challenge*`）仍按经典恢复、不进入挑战 | `startChallenge`、`challengeInfo`、`[data-pause]`、`Arcade.RunSave`、`startClassicWithSeed`（可选） |
| `SC-SL-007` | 试炼 S2 双路线「稳妥长路/近路快线」结算标签 | 设计源 + 运行时数据核对 C02/C04/C05 的 `mainRoute`/`alternativeRoute` 平台引用；三关均可 `startChallenge` 进入；若实现提供 `forceRoute`/`route` 字段则固定支线并断言路线记录，否则如实记录“数据级已核对”（以实际实现为准） | `A.Challenge.stage/stages`、`startChallenge`、可选 `forceRoute` |
| `SC-SL-008` | 试炼 S2 失败复盘说明卷轴可选、未收集可通关 | 收集物（卷轴）可选：C01 不收集也能清关并写记录（`collectibles=[]`）；存在收集钩子时收集后再通关，断言进入 `challenge:v1` 记录 | `startChallenge`、`forceStageFail`、可选收集钩子（`forceCollectScroll`/`forceCollectCollectible`…）、`A.Challenge.progress` |

迁移实现约定：

- 场景代码只依赖 `INTEGRATION-CONTRACT.md` §3/§5 的 0.9 API 与 `#test` 钩子；Node 侧只读 `docs/arcade/0.9/levels/shadow-leap.json` 做设计源比对，**不修改游戏文件**。
- 对实现可能尚未提供的钩子（影门清关、收集、路线）用能力检测 + 明确 fallback，不允许“钩子缺失 = PASS”；g-shadow stable 后按实际实现收紧文案/字段断言并删除 `pending`。
- 当前状态：g-shadow 已交付 0.9 挑战钩子（`shadow-leap.html`，challengeStages/startChallenge/challengeInfo/stageObservable/forceStageClear/forceStageFail/exitChallenge）与 `tools/challenge/shadow-leap.mjs`；5 个 base 场景的 `pending` 已删除并实测 **11/11（重复 2 遍 22/22）** 全绿，另跑 `--game=shadow-leap --repeat=2` **16/16** 全绿。仅旧 trial 钩子名保留兼容，不再作为断言依据。
- 其余 base 场景（`SC-SL-001/002/003/009`、STAR、ROAD）保持原语义；若影跃迁移破坏了 0.8 经典钩子（`startClassicWithSeed/dashInfo/triggerDash/forceLand` 等），属产品回归，报 g-shadow/Lead，不得改断言掩盖。

### 8.4 阶段 2 首批实测（9/13 模块）

- 首轮 `--suite=challenge`：**25/26 passed**（26 = 2 全局门禁 + 24 个模块场景），exit 1；唯一失败 `CH-MW-003` 经查是模块/游戏页正在被对应 Agent 同时写入造成的瞬态，随后 `--game=mole-whack --repeat=2` 为 **12/12 passed**，非产品缺陷。
- `--game=shadow-leap --repeat=2`：**16/16 passed**，exit 0（8 场景 ×2，含 C01–C06 六关真实输入连续参考通关）。
- 结论：聚合器与模块协议在真实交付上可用；模块错误会带 `[tools/challenge/<gameId>.mjs]` 后缀、加载/结构错误会 `FAIL CH-MODULE`，与设计一致。
- 待最终收口：剩余 4 个模块（snowbells / pendulum-tower / star-raid / gold-miner）交付后，跑 `--suite=all --repeat=2` + smoke 85/85，并填写第 10 节表。

## 9. 阶段 1 基线记录（实测）

- 环境：Windows 10/11、Node `v25.8.1`、Python `3.14.3`；无头 Chrome `C:\Program Files\Google\Chrome\Application\chrome.exe`。
- 端口：gameplay 运行 `ARCADE_GAMEPLAY_PORT=8786` / `ARCADE_GAMEPLAY_CDP_PORT=9384`；smoke 运行 `ARCADE_SMOKE_PORT=8796` / `ARCADE_CDP_PORT=9396`。
- 设计源 78 关：`docs/arcade/0.9/levels/*.json`；运行时 13 个数据文件：`apps/arcade/challenge/*.js`（平台 Agent 生成，`node --check` 通过）。
- 0.8 base 证据摘要与 `docs/arcade/0.8.0-TESTING.md` 第 11 节一致（11 场景 ×2 全绿）。

## 10. 阶段 2 证据等级汇总表（待填）

> 数据来源：`node tools/arcade_gameplay_test.mjs --suite=challenge --repeat=2` 的 PASS/SKIP/FAIL 行与模块汇总；证据等级取模块/场景 `evidence` 字段，并与 `docs/arcade/0.9/impl/<gameId>.md` 核对。

| gameId | 游戏 | 场景数 | 证据等级 | PASS | SKIP | FAIL | impl 文档 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| shadow-leap | 影跃 | 8（挑战模块；另 base 侧 5 个已迁移） | real-input-replay / engine-replay / ui-only | 16/16（`--repeat=2`） | 0 | 0 | 见 §8.3 | C01–C06 六关真实输入连续参考通关通过；`--suite=base` 11/11、22/22 |
| block-drop | 俄罗斯方块 | 待模块交付 | 待填 | — | — | — | — | — |
| merge-2048 | 2048 合成 | 待模块交付 | 待填 | — | — | — | — | — |
| memory-flip | 记忆翻牌 | 待模块交付 | 待填 | — | — | — | — | — |
| snake-run | 贪吃蛇 | 待模块交付 | 待填 | — | — | — | — | — |
| mole-whack | 打地鼠 | 待模块交付 | 待填 | — | — | — | — | — |
| road-rush | 极速车道 | 待模块交付 | 待填 | — | — | — | — | — |
| gravity-flip | 重力翻转 | 待模块交付 | 待填 | — | — | — | — | — |
| brick-breaker | 砖块计划 | 待模块交付 | 待填 | — | — | — | — | — |
| snowbells | 雪铃 | 待模块交付 | 待填 | — | — | — | — | — |
| pendulum-tower | 层塔 | 待模块交付 | 待填 | — | — | — | — | — |
| star-raid | 星海突击 | 待模块交付 | 待填 | — | — | — | — | — |
| gold-miner | 黄金矿工 | 待模块交付 | 待填 | — | — | — | — | — |

## 11. 失败排查

1. 先看 `test-artifacts/gameplay-<场景ID>.png` 与 stdout 的 `FAIL … — 原因`；`[tools/challenge/<gameId>.mjs]` 后缀表示该 FAIL 来自游戏模块。
2. `CH-MODULE … — 模块加载失败/结构非法`：先修模块导出结构（对照第 5.1/5.2 节），再重跑 `--list` 确认模块被发现。
3. `#test 钩子缺失`：确认 URL 以 `#test` 结尾、游戏页仍保留 `location.hash === '#test'` 钩子块；新增钩子只允许加法，删除/改名会同时破坏 smoke 与场景。
4. `页面加载/初始化报错`：`cdp.errors` 已收集页面异常 / `console.error` / `Log error`；到浏览器控制台看首个堆栈。
5. 断言数值抖动：多数是场景在断言随机/计时值；改成结构不变量、固定 seed 或 `waitFor` 等待状态（不要用固定 `sleep` 猜帧）。
6. `--repeat` 第二遍失败：检查是否残留 localStorage / 未重新导航 / 未清局内存档。
7. `CH-DATA-001/runtime` SKIP：`apps/arcade/challenge/*.js` 不存在（平台数据尚未生成）；先跑 `node tools/arcade_09_data.mjs`。
8. 端口冲突：第 4 节 env 覆盖；确认 Chrome 路径。
9. 本基座只覆盖无头 Chrome（桌面引擎）；**iOS/Android 真机仍为人工验收**，未执行时在任务报告中标注 `UNVERIFIED`。

## 12. 仓库卫生

- `test-artifacts/` 已 gitignored；提交前确认没有把截图/临时日志纳入版本控制。
- `tools/`、`docs/` 不进入发布 allowlist（`tools/build_site.py` 只发布 `index.html`/`favicon.svg`/`shared`/`apps` 等），因此本 runner 与本文档不影响线上发布内容。
- 默认端口不变：`arcade_smoke.mjs` 仍是 8765/9333，gameplay runner 是 8766/9334；新增 `#test` 钩子不改变正式游玩入口。
