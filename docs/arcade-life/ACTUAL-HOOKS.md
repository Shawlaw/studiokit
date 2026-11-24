# 16 游戏真实事件钩子与结算契约（B00 侦察事实）

- 基线：Arcade `0.14.0`，仓库 `main` `afc5fd4`（2026-11-22），工作树干净
- 用途：0.15 只读微线索适配与后续职业委托的**真实事件锚点**；实现必须引用本文件的函数/行号，不得用 DOM 文本、分数文本、URL 或计时差值推断经济数据
- 约束：本文只记录技术事实，不含剧情路线、谜底或触发阈值；线索阈值在运行时内容文件里
- 原始侦察记录（含更细的逐游戏证据与风险）保存在仓库外开发工作目录，不随仓库分发

## 1. 共享骨架（16/16 同构）

- 脚本顺序：`shared/site-shell.js`（defer）→ `../engine.js`（同步）→ [`../challenge/<id>.js`] → 页内脚本。
- 每页都有：`let state = 'ready'`、`let recordSaved = false`、`[data-overlay]`、`.game-canvas`、`[data-pause]`、`[data-mute]`。
- 结算唯一权威入口：`A.Progress.recordPlay(gameId, score, meta)`，每文件恰好 1 个业务调用点（测试 spy 除外）。
- 局内档：`A.createRunAutosave(...)`（`runs:v1`），刷新后 `A.showResumePrompt`。
- 测试探针：15 款 `if (location.hash === '#test')`；blackjack 用 `location.hash.indexOf('#test') !== -1`。没有 `?test` 入口。
- 挑战局不写 `progress:v1`（`brick-breaker`/`gravity-flip` 的 `finish` 首行 `mode !== 'classic'` 直接 return；其余走 `A.Challenge.markCleared`）。
- 星海割草（mow）不结算：`if (mode === 'mow') return quitMow();`，`serialize()` 返回 null，`recordSaved` 预置 true。

## 2. 逐游戏事件锚点（真实提交点）

| gameId | 事件锚点（函数@行） | 可观察 payload | 结算函数（唯一 `recordPlay`） | 有效局门禁 |
| --- | --- | --- | --- | --- |
| memory-flip | `reveal` 配对分支（`reveal`@860，分支 885-901） | `symbol`、`level`、`moves`、`matchedPairs` | `finish()` | `state==='over'` + `!recordSaved`；经典仅 6 关全通才结算 |
| merge-2048 | `move` 合并分支（`move`@839，分支 859-874） | `value`、`score`、`moves`、`bestTile` | `recordFinalPlay()` | `recordSaved`；胜利弹层不结算 |
| blackjack | `finishHand()`@488（手结算 488-508） | `handNo`、`result`、`points`、`playerTotal`、`dealerTotal` | `finishGame()` | 每局固定 6 手；提前收局也结算 |
| gomoku | `applyPlayerMove()`@581（581-603） | `r`、`c`、`moves`、`turn` | `recordOnce()` | 四种结局均结算 |
| solitaire | `applyMove()`@671（671-710） | `target`、`index`、`count`、`moves`、`foundationCount` | `recordResult()` | `recordSaved && lastRecord` 守卫；手动结束也结算 |
| snowbells | `update` 铃铛消费（981-990） | `combo`、`gain`、`bellScore`（经典铃铛无 id） | `gameOver()` | `state==='over'` + `!recordSaved` |
| brick-breaker | `hitBrick()`@443，击碎分支 450-452 | `level`、`maxHp`、`score` | `finish()` | `mode==='classic'` + `state==='over'` + `!recordSaved` |
| gravity-flip | `flip()`@953 / 障碍通过闩锁 1083-1085 | `dist`、`lives`、`elapsed` | `finish()` | `mode==='classic'` + `state==='over'` + `!recordSaved` |
| snake-run | `stepSnake()`@499，果实分支 527-551 | `foodsEaten`、`score`、`golden` | `finish()` | `state==='over'` + `!recordSaved` |
| mole-whack | `hitSlot()`@670，计分分支 710-738 | `index`、`type`、`gained`、`combo` | `finish()` | `state==='over'` + `!recordSaved` |
| block-drop | `applyClear()`@1567（1567-1599） | `rows`、`lines`、`level`、`score`、`mode` | `gameOver()`（zen/classic 两分支） | `state==='over'` + `!recordSaved` |
| star-raid | `killEnemy()`@3787；classic 普通敌 3869-3880；Boss 击破 3789-3849 | `kind`、`gained`、`score`、`level`、`theme.id` | `gameOver()` | `mode!=='mow'` + `state==='over'` + `!recordSaved` |
| road-rush | 超车闩锁 1474-1476 | `passedCars`、`combo`、`comboBest` | `gameOver()` | `state==='over'` + `!recordSaved` |
| shadow-leap | 高度闩锁 1724-1730（整数米单调不减） | `meters`、`startY`、`topY` | `gameOver()` | `state==='over'` + `!recordSaved` |
| pendulum-tower | `settleDrop()`@1488，落稳分支 1534-1570 | `blocks`、`perfect`、`perfectCombo`、`points`、`comOffset`、`cargoId` | `finishRun()` | `state==='over'` + `!recordSaved`；倒塌会清空 `boxes` |
| gold-miner | `cashIn()`@1197（1197-1229） | `value`、`money`、`holdingId`、`level` | `gameOver()` | `state==='over'` + `!recordSaved`；挑战分支不进 |

> 行号是 `afc5fd4` 时的参考值，会随适配漂移；**函数名 + 分支条件**是权威依据。若行号对不上，以函数名和当前源码为准并更新本表。

## 3. 只读观察的硬规则

1. **事件必须在真实状态提交之后派生**：物理/规则函数体内、`state==='playing'` 时；不得在 `update` 顶部通用 tick、`ui.show` 回调、`revealThen`（层塔结算拉远 0.9s）或 DOM 事件里发。
2. **每局事件由 bridge 分配 `eventId`**；游戏只给 `kind` 与真实 payload 字段，不提供 `runId`/金额/`txId`。
3. **`#test` 静默**：现有 smoke/回归会在 `#test` 下调用真实业务函数（`forceStageClear`、`killAllEnemies`、`advance` 等）。桥在仅 `#test`、无 `careerTest=1` 时必须不持久化、不渲染、不发奖励。
4. **刷新恢复的重复风险**：部分闩锁会随局内档恢复（gravity-flip `o.passed`、road-rush `c.passed` 等），事件判定优先用“状态差值 + 幂等 runId”，不要依赖内存布尔。
5. **三款无挑战的棋牌**（blackjack/gomoku/solitaire）也要能在经典局产生线索；黑杰克“一手”不等于“一局”，事件名与阈值要按手结算口径。
6. **星海 mow 一律排除**：所有 star-raid 钩子先 `if (isMow()) return;`。
7. **层塔稳定层数**：读 `boxes.filter((b) => !b.base).length`（`boxes` 仅 reset/settleDrop/settleChallengeDrop/测试 stackTo 四处变更）；不要读 `floorsReached`（`syncHud` 缓存，测试钩子会与物理对象不一致）。
8. **雪铃经典铃铛无 id**：不要做“唯一铃铛 ID”判定；用“首次踩铃/累计次数”或消费序号派生，禁止从连续 `score` 反推。
9. **重力翻转距离是连续积分**：如要用里程阈值，必须自建一次性跨越闩锁，且只在经典局求值。
10. **影子跳跃卷轴只在挑战关存在**：经典局不可达，不要作为经典线索的唯一条件。
11. **星海 Boss 判定要带 `level`/`theme` 限定**：同一函数有 classic/challenge/mow 三分支；0.16 起职业委托的 T3/T5/T6 目标必须限定真实主题/关卡，不能只判 `boss.defeated`。
12. **不要复用** `challenge/<gameId>.js` 数据承载职业委托：挑战入口要求 `challengeData.length === 6`，混入会顶掉挑战 UI 与解锁链。

## 4. 测试探针可用入口（只读驱动，避免改游戏）

- 层塔：`#test` 下 `forceSettle(offset,cargoId)`、`releaseWhenAligned(offset,tolerance)`、`forceStageClear`、`forceStageFail`、`setLean`、`stackTo`、`physicsInfo()`（`topReachable`/`forecast.landable`）、`viewInfo()`、`alignInfo()`、`regression()`。
- 星海：`#test` 下 `advance(sec)`、`spawnBossNow()`、`damageBoss(n)`、`forceStageClear`、`forceStageFail`、`forceEnergyDeplete()`、`forceMowHit()`、`killAllEnemies()`、`scoresInfo()`、`hangarInfo()`、`challengeInfo()`、`regression()`。
- 其余 14 款：各页 `__arcadeTest` 提供真实业务驱动函数（详见各页 `#test` 块）；smoke 已在用。
- 旧记录零改动断言点：`A.Progress.get`、`A.Scores.list`、`A.Playtime.stats`、`A.Challenge.progress`、`A.GameMeta.get`。

## 5. 已知集成风险（按破坏性）

1. **`GameMeta.set` 整对象覆盖**：任何写入 `games['star-raid']` 的模块必须“读-合并-写”；生涯数据禁止写 `meta:v1`。
2. **星海 `mode === 'classic'` 硬编码**（`killEnemy` 掉落/连击/回能、`stageClear` 得分倍率、`serialize()` `run:` 段）：0.16 职业委托若引入 `career` 分支必须显式 `classicLike`，否则会静默零掉落/丢局内档。
3. **层塔 `serialize()` 无 mode 门禁**：生涯局若不 `return null` 会污染 `runs:v1` 的层塔槽位。
4. **挑战失败/通关回调延迟**：层塔 `revealThen` 延迟 0.9s，`state='revealing'` 期间不属于结算；职业事件必须挂 `settleDrop`/`settleChallengeDrop` 返回处。
5. **`Playtime.setOverlayVisible`**：长时间停留的生涯面板（机库/委托）要暂停计时，避免把浏览时间算成游玩时长。
6. **加载顺序**：`engine.js` 用 `document.currentScript.src` 推断 `ARCADE_BASE`；`career/bridge.js` 必须位于 `engine.js` 之后、页内脚本之前。
7. **SW 预缓存**：新增生涯静态资源若要离线可用，必须加入 `apps/arcade/sw.js` 的 `CORE_PATHS`；`validate_site.py` 只校验 13 条挑战路径，不会提醒。
8. **版本链**：升 Arcade 版本时要同步 engine/sw/registry/index 静态串/validate 断言/6 个测试脚本断言/文档；`arcade_pwa_update_test` 是“当前版→下一版”链路，需整体联动（见 `docs/arcade-life/INTEGRATION-0.15.md` 的版本链清单）。

## 6. 本文件维护规则

- 行号会随 0.15 适配变化；实现后由对应任务把“锚点函数名 + 事件名”更新到 `content/registry.json` 的 `watch`，本文件只保留稳定函数名与契约。
- 任何新增游戏适配必须在 `registry.json` 注册 `gameId`、`watch.kind` 与 `clueRef`，不需要修改本文件。
