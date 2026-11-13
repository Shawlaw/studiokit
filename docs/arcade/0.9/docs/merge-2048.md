# 2048合成｜6 关可实施蓝图

- 游戏 ID：`merge-2048`；当前公开主干对应文件：`apps/arcade/games/merge-2048.html`
- 数据源：`../levels/merge-2048.json`，每关单文件在 `../levels/stages/merge-2048-Cxx.json`
- 实施对象：独立 challenge mode，经典模式原样保留；关卡表达：4×4盘面/求解答案
- 状态：策划版，已运行静态校验；未经过当前引擎物理模拟和真机测试。

## 章节总览

| # | 关卡 | 目标 | 技巧 | 发现 |
|---:|---|---|---|---|
| 1 | 第一次合并 | 把两枚2合成4 | 方向一次选择，合并后的格子位置会改变 | 可用向左也可用向右，方案多于一种 |
| 2 | 双排规划 | 形成一枚8 | 同一滑动可能发生两次不同合并 | 观察合并是“每一格每回合最多合并一次” |
| 3 | 先八后十六 | 三步内得到16 | 先把两枚4合成8，再用两个8合16 | 第二次同向移动仍然可能有效 |
| 4 | 纵向接力 | 最多三步得到8 | 先横向再纵向组合两排 | 合并顺序会影响最终位置 |
| 5 | 双列八进位 | 四步内获得16 | 先合并列再观察8如何重合 | 棋盘上下移动可改变相邻关系 |
| 6 | 终极转位 | 六步内获得32 | 允许暂时远离目标，先安排大数对位 | 分辨合并不能直接跨越不同数值 |

## 逐关详细规格

### C01 · 第一次合并

- **通关目标**：把两枚2合成4
- **关卡决策**：每一步选择朝向并预判合并次序
- **练习重点**：方向一次选择，合并后的格子位置会改变
- **探索反馈**：可用向左也可用向右，方案多于一种
- **建议有效时长**：15–95 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 4,
    "cols": 4
  },
  "initialBoard": [
    [
      2,
      2,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ]
  ],
  "challengeSpawnPolicy": "none (no new random or scripted tile after move)",
  "maxValidMoves": 2,
  "undoAllowed": true,
  "undoDoesNotRefundMoveOnRankedAttempt": true,
  "win": {
    "anyTileAtLeast": 4
  },
  "lose": "valid moves used up without target or no legal move",
  "scorePolicy": "挑战按有效步数、辅助使用分层统计；经典分数保持不变",
  "controls": "四方向滑动；仅有效改变盘面的滑动计步"
}
```

- **参考通关方案**：

```json
{
  "directions": [
    "L"
  ],
  "resultBoard": [
    [
      4,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ]
  ]
}
```

**验收工单**：

1. **成功路径**：宽搜可在限定步数找到方案；无解题卡不可入库
2. **失败路径**：超出有效步数/无可移动后失败，撤销的成绩标签与普通成绩不同
3. **移动端**：四向滑动阈值一致，不因页面滚动误触，画布外不禁用普通触摸
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C02 · 双排规划

- **通关目标**：形成一枚8
- **关卡决策**：每一步选择朝向并预判合并次序
- **练习重点**：同一滑动可能发生两次不同合并
- **探索反馈**：观察合并是“每一格每回合最多合并一次”
- **建议有效时长**：15–95 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 4,
    "cols": 4
  },
  "initialBoard": [
    [
      2,
      2,
      4,
      4
    ],
    [
      0,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ]
  ],
  "challengeSpawnPolicy": "none (no new random or scripted tile after move)",
  "maxValidMoves": 2,
  "undoAllowed": true,
  "undoDoesNotRefundMoveOnRankedAttempt": true,
  "win": {
    "anyTileAtLeast": 8
  },
  "lose": "valid moves used up without target or no legal move",
  "scorePolicy": "挑战按有效步数、辅助使用分层统计；经典分数保持不变",
  "controls": "四方向滑动；仅有效改变盘面的滑动计步"
}
```

- **参考通关方案**：

```json
{
  "directions": [
    "L"
  ],
  "resultBoard": [
    [
      4,
      8,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ]
  ]
}
```

**验收工单**：

1. **成功路径**：宽搜可在限定步数找到方案；无解题卡不可入库
2. **失败路径**：超出有效步数/无可移动后失败，撤销的成绩标签与普通成绩不同
3. **移动端**：四向滑动阈值一致，不因页面滚动误触，画布外不禁用普通触摸
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C03 · 先八后十六

- **通关目标**：三步内得到16
- **关卡决策**：每一步选择朝向并预判合并次序
- **练习重点**：先把两枚4合成8，再用两个8合16
- **探索反馈**：第二次同向移动仍然可能有效
- **建议有效时长**：15–95 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 4,
    "cols": 4
  },
  "initialBoard": [
    [
      4,
      4,
      8,
      0
    ],
    [
      0,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ]
  ],
  "challengeSpawnPolicy": "none (no new random or scripted tile after move)",
  "maxValidMoves": 3,
  "undoAllowed": true,
  "undoDoesNotRefundMoveOnRankedAttempt": true,
  "win": {
    "anyTileAtLeast": 16
  },
  "lose": "valid moves used up without target or no legal move",
  "scorePolicy": "挑战按有效步数、辅助使用分层统计；经典分数保持不变",
  "controls": "四方向滑动；仅有效改变盘面的滑动计步"
}
```

- **参考通关方案**：

```json
{
  "directions": [
    "L",
    "L"
  ],
  "resultBoard": [
    [
      16,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ]
  ]
}
```

**验收工单**：

1. **成功路径**：宽搜可在限定步数找到方案；无解题卡不可入库
2. **失败路径**：超出有效步数/无可移动后失败，撤销的成绩标签与普通成绩不同
3. **移动端**：四向滑动阈值一致，不因页面滚动误触，画布外不禁用普通触摸
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C04 · 纵向接力

- **通关目标**：最多三步得到8
- **关卡决策**：每一步选择朝向并预判合并次序
- **练习重点**：先横向再纵向组合两排
- **探索反馈**：合并顺序会影响最终位置
- **建议有效时长**：15–95 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 4,
    "cols": 4
  },
  "initialBoard": [
    [
      2,
      2,
      0,
      0
    ],
    [
      2,
      2,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ]
  ],
  "challengeSpawnPolicy": "none (no new random or scripted tile after move)",
  "maxValidMoves": 3,
  "undoAllowed": true,
  "undoDoesNotRefundMoveOnRankedAttempt": true,
  "win": {
    "anyTileAtLeast": 8
  },
  "lose": "valid moves used up without target or no legal move",
  "scorePolicy": "挑战按有效步数、辅助使用分层统计；经典分数保持不变",
  "controls": "四方向滑动；仅有效改变盘面的滑动计步"
}
```

- **参考通关方案**：

```json
{
  "directions": [
    "L",
    "U"
  ],
  "resultBoard": [
    [
      8,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ]
  ]
}
```

**验收工单**：

1. **成功路径**：宽搜可在限定步数找到方案；无解题卡不可入库
2. **失败路径**：超出有效步数/无可移动后失败，撤销的成绩标签与普通成绩不同
3. **移动端**：四向滑动阈值一致，不因页面滚动误触，画布外不禁用普通触摸
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C05 · 双列八进位

- **通关目标**：四步内获得16
- **关卡决策**：每一步选择朝向并预判合并次序
- **练习重点**：先合并列再观察8如何重合
- **探索反馈**：棋盘上下移动可改变相邻关系
- **建议有效时长**：15–95 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 4,
    "cols": 4
  },
  "initialBoard": [
    [
      2,
      4,
      2,
      0
    ],
    [
      2,
      4,
      2,
      0
    ],
    [
      4,
      8,
      4,
      0
    ],
    [
      0,
      0,
      0,
      0
    ]
  ],
  "challengeSpawnPolicy": "none (no new random or scripted tile after move)",
  "maxValidMoves": 4,
  "undoAllowed": true,
  "undoDoesNotRefundMoveOnRankedAttempt": true,
  "win": {
    "anyTileAtLeast": 16
  },
  "lose": "valid moves used up without target or no legal move",
  "scorePolicy": "挑战按有效步数、辅助使用分层统计；经典分数保持不变",
  "controls": "四方向滑动；仅有效改变盘面的滑动计步"
}
```

- **参考通关方案**：

```json
{
  "directions": [
    "U",
    "U"
  ],
  "resultBoard": [
    [
      8,
      16,
      8,
      0
    ],
    [
      0,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ]
  ]
}
```

**验收工单**：

1. **成功路径**：宽搜可在限定步数找到方案；无解题卡不可入库
2. **失败路径**：超出有效步数/无可移动后失败，撤销的成绩标签与普通成绩不同
3. **移动端**：四向滑动阈值一致，不因页面滚动误触，画布外不禁用普通触摸
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C06 · 终极转位

- **通关目标**：六步内获得32
- **关卡决策**：每一步选择朝向并预判合并次序
- **练习重点**：允许暂时远离目标，先安排大数对位
- **探索反馈**：分辨合并不能直接跨越不同数值
- **建议有效时长**：15–95 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 4,
    "cols": 4
  },
  "initialBoard": [
    [
      4,
      0,
      0,
      0
    ],
    [
      16,
      2,
      8,
      2
    ],
    [
      4,
      0,
      4,
      0
    ],
    [
      0,
      2,
      8,
      0
    ]
  ],
  "challengeSpawnPolicy": "none (no new random or scripted tile after move)",
  "maxValidMoves": 5,
  "undoAllowed": true,
  "undoDoesNotRefundMoveOnRankedAttempt": true,
  "win": {
    "anyTileAtLeast": 32
  },
  "lose": "valid moves used up without target or no legal move",
  "scorePolicy": "挑战按有效步数、辅助使用分层统计；经典分数保持不变",
  "controls": "四方向滑动；仅有效改变盘面的滑动计步"
}
```

- **参考通关方案**：

```json
{
  "directions": [
    "U",
    "L",
    "L",
    "U"
  ],
  "resultBoard": [
    [
      32,
      2,
      0,
      0
    ],
    [
      4,
      4,
      0,
      0
    ],
    [
      0,
      8,
      0,
      0
    ],
    [
      0,
      0,
      0,
      0
    ]
  ]
}
```

**验收工单**：

1. **成功路径**：宽搜可在限定步数找到方案；无解题卡不可入库
2. **失败路径**：超出有效步数/无可移动后失败，撤销的成绩标签与普通成绩不同
3. **移动端**：四向滑动阈值一致，不因页面滚动误触，画布外不禁用普通触摸
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

