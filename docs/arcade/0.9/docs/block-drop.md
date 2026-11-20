# 俄罗斯方块｜6 关可实施蓝图

- 游戏 ID：`block-drop`；当前公开主干对应文件：`apps/arcade/games/block-drop.html`
- 数据源：`../levels/block-drop.json`，每关单文件在 `../levels/stages/block-drop-Cxx.json`
- 实施对象：独立 challenge mode，经典模式原样保留；关卡表达：20×10残局/操作答案
- 状态：策划版，已运行静态校验；未经过当前引擎物理模拟和真机测试。

## 章节总览

| # | 关卡 | 目标 | 技巧 | 发现 |
|---:|---|---|---|---|
| 1 | 第一道横井 | 用横向 I 填平一行 | 横向 I 一次清行；不要空场堆叠 | 横井的宽度等于4格 |
| 2 | 双行方井 | 用 O 一次清两行 | 精确移动到中央两格 | 理解O方块落在连续2×2空间 |
| 3 | 纵井四消 | 用竖直 I 清四行 | 需要旋转 I 而非横放 | 知道Tetris四消的井的开法 |
| 4 | 两次横修 | 两个 I 分别落入错开的不同横井 | 先放上层右侧井(列3-6)清一行，再放下层左侧井(列1-4) | 上层清除后下层井才从上方可达，两 I 落点不同 |
| 5 | T形锁孔 | 先 O 填上方方井，再以 T 锁下方异形孔 | 两个落点都可试放，但只有 O 先上、T 后下能清四行 | 旋转与顺序共同决定成败，直落任意一孔会留残砖 |
| 6 | 复合工坊 | 先 O 后 T，完成连续四行清除 | 若先考虑下方T，会被上方方井阻挡 | 清除顺序就是核心解题空间 |

## 逐关详细规格

### C01 · 第一道横井

- **通关目标**：用横向 I 填平一行
- **关卡决策**：选择摆放方向和顺序（挑战模式固定出块）
- **练习重点**：横向 I 一次清行；不要空场堆叠
- **探索反馈**：横井的宽度等于4格
- **建议有效时长**：25–110 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "boardWidth": 10,
  "boardHeight": 20,
  "boardTopToBottom": [
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "###....###"
  ],
  "pieceQueue": [
    "I"
  ],
  "holdEnabled": false,
  "gravityMode": "place-by-place with no time pressure, hard drop + rotate",
  "spawnPolicy": "only fixed pieceQueue; no bag-7 randomness",
  "initialActivePiece": "I",
  "win": {
    "type": "clear-lines",
    "count": 1,
    "maxPlacedPieces": 1
  },
  "lose": {
    "type": "queue-exhausted-or-top-out",
    "ifGoalUnmet": true
  },
  "pieceDefinitions": {
    "I-H": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        2,
        0
      ],
      [
        3,
        0
      ]
    ],
    "I-V": [
      [
        0,
        0
      ],
      [
        0,
        1
      ],
      [
        0,
        2
      ],
      [
        0,
        3
      ]
    ],
    "O-N": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        0,
        1
      ],
      [
        1,
        1
      ]
    ],
    "T-STEM-DOWN": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        2,
        0
      ],
      [
        1,
        1
      ]
    ]
  },
  "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping.",
  "gravityModel": "place-by-place"
}
```

- **参考通关方案**：

```json
[
  {
    "piece": "I",
    "orientation": "H",
    "leftCol": 3,
    "action": "rotate/place/hardDrop"
  }
]
```

**验收工单**：

1. **成功路径**：按参考队列执行能在最大置块数内清行并达标
2. **失败路径**：提前耗尽队列而未达标应失败，且经典7-bag绝不改动
3. **移动端**：左右/旋转/硬降有独立触摸按钮，连续点击不会粘键
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C02 · 双行方井

- **通关目标**：用 O 一次清两行
- **关卡决策**：选择摆放方向和顺序（挑战模式固定出块）
- **练习重点**：精确移动到中央两格
- **探索反馈**：理解O方块落在连续2×2空间
- **建议有效时长**：25–110 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "boardWidth": 10,
  "boardHeight": 20,
  "boardTopToBottom": [
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "####..####",
    "####..####"
  ],
  "pieceQueue": [
    "O"
  ],
  "holdEnabled": false,
  "gravityMode": "place-by-place with no time pressure, hard drop + rotate",
  "spawnPolicy": "only fixed pieceQueue; no bag-7 randomness",
  "initialActivePiece": "O",
  "win": {
    "type": "clear-lines",
    "count": 2,
    "maxPlacedPieces": 1
  },
  "lose": {
    "type": "queue-exhausted-or-top-out",
    "ifGoalUnmet": true
  },
  "pieceDefinitions": {
    "I-H": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        2,
        0
      ],
      [
        3,
        0
      ]
    ],
    "I-V": [
      [
        0,
        0
      ],
      [
        0,
        1
      ],
      [
        0,
        2
      ],
      [
        0,
        3
      ]
    ],
    "O-N": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        0,
        1
      ],
      [
        1,
        1
      ]
    ],
    "T-STEM-DOWN": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        2,
        0
      ],
      [
        1,
        1
      ]
    ]
  },
  "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping.",
  "gravityModel": "place-by-place"
}
```

- **参考通关方案**：

```json
[
  {
    "piece": "O",
    "orientation": "N",
    "leftCol": 4,
    "action": "rotate/place/hardDrop"
  }
]
```

**验收工单**：

1. **成功路径**：按参考队列执行能在最大置块数内清行并达标
2. **失败路径**：提前耗尽队列而未达标应失败，且经典7-bag绝不改动
3. **移动端**：左右/旋转/硬降有独立触摸按钮，连续点击不会粘键
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C03 · 纵井四消

- **通关目标**：用竖直 I 清四行
- **关卡决策**：选择摆放方向和顺序（挑战模式固定出块）
- **练习重点**：需要旋转 I 而非横放
- **探索反馈**：知道Tetris四消的井的开法
- **建议有效时长**：25–110 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "boardWidth": 10,
  "boardHeight": 20,
  "boardTopToBottom": [
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "#####.####",
    "#####.####",
    "#####.####",
    "#####.####"
  ],
  "pieceQueue": [
    "I"
  ],
  "holdEnabled": false,
  "gravityMode": "place-by-place with no time pressure, hard drop + rotate",
  "spawnPolicy": "only fixed pieceQueue; no bag-7 randomness",
  "initialActivePiece": "I",
  "win": {
    "type": "clear-lines",
    "count": 4,
    "maxPlacedPieces": 1
  },
  "lose": {
    "type": "queue-exhausted-or-top-out",
    "ifGoalUnmet": true
  },
  "pieceDefinitions": {
    "I-H": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        2,
        0
      ],
      [
        3,
        0
      ]
    ],
    "I-V": [
      [
        0,
        0
      ],
      [
        0,
        1
      ],
      [
        0,
        2
      ],
      [
        0,
        3
      ]
    ],
    "O-N": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        0,
        1
      ],
      [
        1,
        1
      ]
    ],
    "T-STEM-DOWN": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        2,
        0
      ],
      [
        1,
        1
      ]
    ]
  },
  "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping.",
  "gravityModel": "place-by-place"
}
```

- **参考通关方案**：

```json
[
  {
    "piece": "I",
    "orientation": "V",
    "leftCol": 5,
    "action": "rotate/place/hardDrop"
  }
]
```

**验收工单**：

1. **成功路径**：按参考队列执行能在最大置块数内清行并达标
2. **失败路径**：提前耗尽队列而未达标应失败，且经典7-bag绝不改动
3. **移动端**：左右/旋转/硬降有独立触摸按钮，连续点击不会粘键
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C04 · 两次横修

- **通关目标**：两个 I 分别落入错开的不同横井
- **关卡决策**：选择摆放方向和顺序（挑战模式固定出块）
- **练习重点**：先放上层右侧井(列3-6)清一行，再放下层左侧井(列1-4)
- **探索反馈**：上层清除后下层井才从上方可达，两 I 落点不同
- **建议有效时长**：25–110 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "boardWidth": 10,
  "boardHeight": 20,
  "boardTopToBottom": [
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "###....###",
    "#....#####"
  ],
  "pieceQueue": [
    "I",
    "I"
  ],
  "holdEnabled": false,
  "gravityMode": "place-by-place with no time pressure, hard drop + rotate",
  "spawnPolicy": "only fixed pieceQueue; no bag-7 randomness",
  "initialActivePiece": "I",
  "win": {
    "type": "clear-lines",
    "count": 2,
    "maxPlacedPieces": 2
  },
  "lose": {
    "type": "queue-exhausted-or-top-out",
    "ifGoalUnmet": true
  },
  "pieceDefinitions": {
    "I-H": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        2,
        0
      ],
      [
        3,
        0
      ]
    ],
    "I-V": [
      [
        0,
        0
      ],
      [
        0,
        1
      ],
      [
        0,
        2
      ],
      [
        0,
        3
      ]
    ],
    "O-N": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        0,
        1
      ],
      [
        1,
        1
      ]
    ],
    "T-STEM-DOWN": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        2,
        0
      ],
      [
        1,
        1
      ]
    ]
  },
  "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping.",
  "gravityModel": "place-by-place"
}
```

- **参考通关方案**：

```json
[
  {
    "piece": "I",
    "orientation": "H",
    "leftCol": 3,
    "action": "rotate/place/hardDrop"
  },
  {
    "piece": "I",
    "orientation": "H",
    "leftCol": 1,
    "action": "rotate/place/hardDrop"
  }
]
```

**验收工单**：

1. **成功路径**：按参考队列执行能在最大置块数内清行并达标
2. **失败路径**：提前耗尽队列而未达标应失败，且经典7-bag绝不改动
3. **移动端**：左右/旋转/硬降有独立触摸按钮，连续点击不会粘键
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C05 · T形锁孔

- **通关目标**：先 O 填上方方井，再以 T 锁下方异形孔
- **关卡决策**：选择摆放方向和顺序（挑战模式固定出块）
- **练习重点**：两个落点都可试放，但只有 O 先上、T 后下能清四行
- **探索反馈**：旋转与顺序共同决定成败，直落任意一孔会留残砖
- **建议有效时长**：25–110 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "boardWidth": 10,
  "boardHeight": 20,
  "boardTopToBottom": [
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "###..#####",
    "###..#####",
    "####...###",
    "#####.####"
  ],
  "pieceQueue": [
    "O",
    "T"
  ],
  "holdEnabled": false,
  "gravityMode": "place-by-place with no time pressure, hard drop + rotate",
  "spawnPolicy": "only fixed pieceQueue; no bag-7 randomness",
  "initialActivePiece": "O",
  "win": {
    "type": "clear-lines",
    "count": 4,
    "maxPlacedPieces": 2
  },
  "lose": {
    "type": "queue-exhausted-or-top-out",
    "ifGoalUnmet": true
  },
  "pieceDefinitions": {
    "I-H": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        2,
        0
      ],
      [
        3,
        0
      ]
    ],
    "I-V": [
      [
        0,
        0
      ],
      [
        0,
        1
      ],
      [
        0,
        2
      ],
      [
        0,
        3
      ]
    ],
    "O-N": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        0,
        1
      ],
      [
        1,
        1
      ]
    ],
    "T-STEM-DOWN": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        2,
        0
      ],
      [
        1,
        1
      ]
    ]
  },
  "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping.",
  "gravityModel": "place-by-place",
  "placementSpace": {
    "description": "每块存在多个可硬降落点，只有特定朝向/列组合能完成目标；参考解是众多合法落点中的一种",
    "legalButLosingExamples": [
      {
        "piece": "O",
        "orientation": "N",
        "leftCol": 1,
        "result": "偏离方井，无法配合 T 清四行"
      },
      {
        "piece": "T",
        "orientation": "STEM-DOWN",
        "leftCol": 4,
        "result": "无 O 垫底，T 落入异形孔仍剩残砖"
      }
    ],
    "winningPlacementCount": 1
  }
}
```

- **参考通关方案**：

```json
[
  {
    "piece": "O",
    "orientation": "N",
    "leftCol": 3,
    "action": "rotate/place/hardDrop"
  },
  {
    "piece": "T",
    "orientation": "STEM-DOWN",
    "leftCol": 4,
    "action": "rotate/place/hardDrop"
  }
]
```

**验收工单**：

1. **成功路径**：按参考队列执行能在最大置块数内清行并达标
2. **失败路径**：提前耗尽队列而未达标应失败，且经典7-bag绝不改动
3. **移动端**：左右/旋转/硬降有独立触摸按钮，连续点击不会粘键
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C06 · 复合工坊

- **通关目标**：先 O 后 T，完成连续四行清除
- **关卡决策**：选择摆放方向和顺序（挑战模式固定出块）
- **练习重点**：若先考虑下方T，会被上方方井阻挡
- **探索反馈**：清除顺序就是核心解题空间
- **建议有效时长**：25–110 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "boardWidth": 10,
  "boardHeight": 20,
  "boardTopToBottom": [
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "..........",
    "#..#######",
    "#..#######",
    "####...###",
    "#####.####"
  ],
  "pieceQueue": [
    "O",
    "T"
  ],
  "holdEnabled": false,
  "gravityMode": "place-by-place with no time pressure, hard drop + rotate",
  "spawnPolicy": "only fixed pieceQueue; no bag-7 randomness",
  "initialActivePiece": "O",
  "win": {
    "type": "clear-lines",
    "count": 4,
    "maxPlacedPieces": 2
  },
  "lose": {
    "type": "queue-exhausted-or-top-out",
    "ifGoalUnmet": true
  },
  "pieceDefinitions": {
    "I-H": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        2,
        0
      ],
      [
        3,
        0
      ]
    ],
    "I-V": [
      [
        0,
        0
      ],
      [
        0,
        1
      ],
      [
        0,
        2
      ],
      [
        0,
        3
      ]
    ],
    "O-N": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        0,
        1
      ],
      [
        1,
        1
      ]
    ],
    "T-STEM-DOWN": [
      [
        0,
        0
      ],
      [
        1,
        0
      ],
      [
        2,
        0
      ],
      [
        1,
        1
      ]
    ]
  },
  "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping.",
  "gravityModel": "place-by-place",
  "placementSpace": {
    "description": "每块存在多个可硬降落点，只有特定朝向/列组合能完成目标；参考解是众多合法落点中的一种",
    "legalButLosingExamples": [
      {
        "piece": "O",
        "orientation": "N",
        "leftCol": 0,
        "result": "无法落入方井，停在顶端"
      },
      {
        "piece": "T",
        "orientation": "STEM-UP",
        "leftCol": 4,
        "result": "只清1行"
      }
    ],
    "winningPlacementCount": 1
  }
}
```

- **参考通关方案**：

```json
[
  {
    "piece": "O",
    "orientation": "N",
    "leftCol": 1,
    "action": "rotate/place/hardDrop"
  },
  {
    "piece": "T",
    "orientation": "STEM-DOWN",
    "leftCol": 4,
    "action": "rotate/place/hardDrop"
  }
]
```

**验收工单**：

1. **成功路径**：按参考队列执行能在最大置块数内清行并达标
2. **失败路径**：提前耗尽队列而未达标应失败，且经典7-bag绝不改动
3. **移动端**：左右/旋转/硬降有独立触摸按钮，连续点击不会粘键
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

