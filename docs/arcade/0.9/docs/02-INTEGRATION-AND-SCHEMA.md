# 02｜关卡内容与运行时适配合同

## 程序入口与总体策略

- 当前公开主干使用纯静态 HTML/JS，`apps/arcade/engine.js` 共享运行时，`apps/arcade/games/*.html` 各游戏独立页面。
- 请先读本地 `AGENTS.md`, `START-HERE.md`, `tasks/queue.json`, 0.8.0 当前变更，实际 API 为准。
- 不引第三方框架、后端或 CDN；原则上每款游戏增设**挑战模式** `challenge`，解析本包定义的数据；保留旧 `classic` 路径和旧高分/存档键。
- 本包 JSON 是 **策划源数据格式**，并非 0.7.0 原生 API。Agent 要写轻量适配层，不能把文件当作直接在旧引擎下跑得通的成品。

## 数据通用字段

```text
schemaVersion  关卡内容格式版本，不等于 Arcade 应用版本
id             gameId-C01...C06，稳定不随名称变更
mode           challenge；经典与挑战记录分离
gameId         对应 games/<sourceFile>
content        权威布局/棋盘/时间轴/目标规则
referencePlan  设计者给出的候选通过方式/经过求解器的可行路线
acceptance     正向/反向/触控/中断验收
integration    需实现的特性与旧行为保护
```

不要把 `referencePlan` 作为“玩家答案泄露”；它只供测试脚本/Reviewer。游戏只显示关卡目标、合适的下一步提示，不显示完整路线。

## 关键坐标规则

- 《影跃》：420×740 逻辑画布，平台 `xCenter`（像素），`height`（**相对起始平台向上为正**，不是 Canvas 的原生 y）；当前世界坐标 `worldY = startPlatformWorldY - height`。相机平移必须统一处理。
- 《雪铃》：同上，铃的 `height` 也是相对首铃上方的高度；序列 `requiredSequence` 是关卡胜利顺序。
- 《黄金矿工》：420×740，物品 `x/y` 绝对像素，钩轴 (210,104)，给定角度只用来验证预想瞄准方向，不可直接瞬移抓取。
- 《重力翻转》：障碍 `x` 为**赛道世界前进距离**，需要由镜头偏移换算成屏幕坐标；物理参数按当前引擎实现。
- 《砖块计划》：8×5 砖阵，(col,row) 映射到现有 `BRICK_X=20 / BRICK_Y=128` 和间距48/24。`K` = 机关钥匙，`G` = 未解锁门，经典中没有的新机制只能在 challenge 实现。
- 《俄罗斯方块》：20 行×10 列，`boardTopToBottom` 从上到下，`#`为预填格、`.`为空；`leftCol`表示参考姿态包围盒左边界，不是旧 `piece.x` 的内部 SRS 锚点。
- 《贪吃蛇》：18×18，左上 (0,0)，`initialSnake[0]` 为头，参考 `movesRLE` 包含真实身体避让。
- 《记忆翻牌》：faces 方阵的每个符号恰好出现两次；预览、限错、镜像等只属于挑战模式。
- 《2048》：4×4 方阵，挑战关不在有效滑动后随机生成新数字；经典依旧正常生成。排名中区别 classic/challenge 和辅助情况。
- 《极速车道》：4 车道 0..3；时间轴每格约1秒，`occupiedLanes` 表示该时隙不可占用。需要额外计算换道动画全过程的真实碰撞，不得把离散证明当完整交通仿真。
- 《打地鼠》：3×3，洞位0..8按行排序；`atSec` 是暂停感知的**模拟时间**。
- 《星海突击》：`spawnXRatio` 在[0,1]，攻击脚本和 `safeBandXRatio` 是可复现的设计约束；现有攻击/伤害物理需实测。
- 《层塔》：`targetOffsetPx` 是玩家看到的目标位置，不是魔法吸附；真实落箱仍按钟摆+倾斜物理运行。

## 建议适配接口（伪代码，不要求重写整个引擎）

```javascript
function loadChallengeStage(stageData, currentGameAdapter) {
  validateStageSchema(stageData);                  // fail closed
  currentGameAdapter.resetForChallenge(stageData.content);
  currentGameAdapter.bindStageGoal(stageData.content.win || stageData.content.goal);
  currentGameAdapter.restoreOrStart(stageData.id);
}
```

各 gameAdapter 只需暴露 `resetForChallenge`, `tick(fixedDt)`, `serialize`, `restore`, `getObservableState`, `finishStage`；对应操作与正在开发的 0.8.0 新接口比对，**优先复用现有结构，不平行创造第二套引擎**。

## 推荐存档记录形态

```json
{
  "version": 2,
  "gameId": "shadow-leap",
  "mode": "challenge",
  "stageId": "shadow-leap-C03",
  "stageSchemaVersion": "1.0.0",
  "timeActiveSec": 31.4,
  "state": {"player": {}, "objects": [], "rngState": 0},
  "record": {"completed": false, "assisted": false, "secretFound": false}
}
```

该对象是**目标协议示例**，不是旧 `Progress` 或 Autosave 接口的真实参数；必须适配现有存档版本。旧存档解析失败不得默默删档，应提供清晰恢复/重开选择并记录迁移测试。

## 状态机

`ready → playing → paused → playing → finished / failed`。`visibilitychange/blur/pagehide` 从 playing 必须安全进入 paused，不能在恢复回调中擅自 resume。时钟累积只按有效更新帧；物理循环严禁把后台巨大时间差视为单帧推进。

## 对本包证据的保守解释

`scripts/validate_levels.py` 使用独立简化规则回放：2048、方块、蛇、车道等可以证明**在脚本约定的规则下存在参考解**；它不会读取 StudioKit 运行时，不能证明你集成后碰撞/操作/存档正确。
