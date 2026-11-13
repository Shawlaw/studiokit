# Arcade 0.8.0 设计：影冲 / 影之试炼 与 13 游戏 78 关挑战模式

> 本文件记录 0.8.0 的玩法目标、架构、数据兼容、边界与回滚。实现为纯静态、零依赖、同源离线。
> 0.8.0 同时包含两批工作：影跃「影冲 / 影之试炼」竖切片（0.8 初期）与导入自 Owner 0.9 关卡设计包的 13 游戏 × 6 关挑战模式。设计包目录 `docs/arcade/0.9/` 中的 `0.9` 是**设计包版本**，不是应用版本；应用版本为 `0.8.0`。

## 产品原则

- 短局、随时离开、无签到/体力/限时回流/跨局战力；挑战是第二种入口，不替代经典/无尽。
- 每关一个可练习技巧 + 至少一个有代价的取舍；失败可归因、1 次点击重试；固定布局/脚本，不靠随机决定主路线。
- 挑战与经典记录分离；使用限量道具时标记 assisted；不写经典最高分与 Playtime 轮次。

## 架构

| 层 | 实现 |
| --- | --- |
| 挑战记录 | `studiokit:arcade:challenge:v1`（Schema v1）：`{schemaVersion, games:{<id>:{cleared[], best:{<stageId>:{timeSec, assisted, collectibles[], at}}, updatedAt}}, updatedAt}`；损坏 fail closed 不删原值 |
| 共享 API | `engine.js` → `window.Arcade.Challenge`：`stages/stage/progress/isUnlocked/markCleared/resetGame/exportData/importData/resultHtml/stageListHtml/formatTime`；`Progress.exportText/importText/resetAll/resetGame` 加法集成 |
| 关卡数据 | 设计源 `docs/arcade/0.9/levels/*.json`（13×6，含 referencePlan/acceptance，不发布）；`tools/arcade_09_data.mjs` 校验并生成运行时 `apps/arcade/challenge/<gameId>.js`（只含玩家可见 content，防剧透）+ 测试夹具 `tools/testdata/challenge/` + 数据报告；输出幂等 |
| 页面接入 | 各游戏页 `<script src="../challenge/<gameId>.js">` + 本地挑战分支：开始弹层第二入口「挑战 6 关」→ `.ac-challenge-panel` 选关（按序解锁/最佳/通关标记）→ 挑战 HUD/目标/暂停退出/失败重试/结算；经典主按钮 `[data-ov-btn]` 行为不变 |
| 存档 | 挑战局只写既有 `runs:v1` 的 `data`：`mode:'challenge'`、`stageId`、`challengeState`；旧档缺 `mode` 按经典恢复；影跃旧 `mode:'trial'` 映射 C01–C03 或提示重开 |
| 离线/PWA | `sw.js` shell 预缓存 13 个数据文件；缓存键升至 `studiokit-arcade-0.8.0-v1` |
| 测试 | `tools/arcade_gameplay_test.mjs`（base/challenge/all、`--game`、模块自动发现、CH-DATA-001/CH-CLASSIC-001）与 `tools/arcade_smoke.mjs`（85 项经典回归）；设计包自带 `validate_levels.py`（1088 断言，仅设计数据） |

## 0.8.0 发布验证基线

- `validate_site.py` / `build_site.py` / `node --check`（含 13 页内联脚本）通过。
- `arcade_smoke.mjs` **85/85**；`arcade_gameplay_test.mjs --suite=all --repeat=2` **208/208**（约 798s）；数据生成器重跑字节一致。
- 独立 Reviewer：APPROVE-WITH-NOTES / 0 Blocker；原生 CDP 独立实玩 47/47。

## 已知设计差量（需 Owner 试玩裁决，不是工程阻塞）

1. 影跃影门半径 38 导致部分捷径、实测关卡时长 1.9–4.5s 远短于设计 45–155s；`requiredAbility` 未做硬门禁。
2. 全局 `targetDurationSec` 与实际可完成时长普遍偏短。
3. 砖块 C03/C06 的 K 钥匙在“G 是硬墙”字面语义下不可达；已实现最小修正「撞未解锁 G 时对其正上方 K 造成 1 点伤害」（G 仍实心不可破坏）。若 Owner 否决，这两关会变成 Blocker。
4. 星海 Boss 几何弱点改为可观察的时间窗暴露。
5. 重力翻转推荐窗口的晚半段会撞刺，实现不强制窗口、提示/机器人用早沿。

其余（层塔确定性初始角速度、雪铃世界原点/常驻提示、固定步间隔、TNT 不连锁、打地鼠页内第二指针、挑战内道具口径等）为可接受实现细节或 Minor，详见 `docs/arcade/0.9/REVIEW.md` 与各游戏 `docs/arcade/0.9/impl/<gameId>.md`。

## 兼容与回滚

- **旧存档**：0.7.0/0.8.0 之前的 `progress:v1` / `runs:v1` / `prefs:v1` / `playtime:v1` key 与 Schema 不变；缺少挑战字段的旧档按经典恢复；导出/导入旧备份时保留当前挑战记录（旧备份无 `challenge` 字段）。
- **回滚**：`apps/arcade/*` + `apps/arcade/games/*` + `apps/arcade/challenge/*` + `engine.js`/`sw.js`/`arcade.css` + 注册表版本回退即可；`challenge:v1` 是独立 key，回滚后旧版本忽略它，不影响经典进度；如需彻底清理，中心页「清除全部」会同步删除挑战记录。
- **版本**：`ARCADE_VERSION` / registry / SW 缓存统一 `0.8.0`；Badge Studio 保持 `2.2.1`。
