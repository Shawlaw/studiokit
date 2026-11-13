# 记忆翻牌｜6 关可实施蓝图

- 游戏 ID：`memory-flip`；当前公开主干对应文件：`apps/arcade/games/memory-flip.html`
- 数据源：`../levels/memory-flip.json`，每关单文件在 `../levels/stages/memory-flip-Cxx.json`
- 实施对象：独立 challenge mode，经典模式原样保留；关卡表达：卡牌面阵/配对答案
- 状态：策划版，已运行静态校验；未经过当前引擎物理模拟和真机测试。

## 章节总览

| # | 关卡 | 目标 | 技巧 | 发现 |
|---:|---|---|---|---|
| 1 | 分区第一步 | 仅看一次预览配对三组 | 按列建立位置记忆 | 观察相同符号不一定相邻 |
| 2 | 两段扫描 | 在4次错误以内配对四组 | 左半→右半顺序扫描降低遗忘 | 发现所有符号恰好一次分布在每行 |
| 3 | 位置线索 | 用分区预览与位置线索完成六对 | 先记每一行再用排除法 | 每对首张与末张的位置可以组成手势记忆 |
| 4 | 镜像试验 | 识别上下两区域镜像配对规律 | 主动先观察规律，再翻牌 | 上下行是镜像排列 |
| 5 | 左右互换 | 找出两层错位关系并完成八对 | 用象限编码而非死记整个棋盘 | 每对图案分散于上下两个半区 |
| 6 | 终局推理 | 在更少的翻错次数内完成8对 | 建立逻辑笔记与优先检查顺序 | 有规律但不完全镜像，可选给出一对线索 |

## 逐关详细规格

### C01 · 分区第一步

- **通关目标**：仅看一次预览配对三组
- **关卡决策**：记忆策略或推理顺序决定翻牌效率
- **练习重点**：按列建立位置记忆
- **探索反馈**：观察相同符号不一定相邻
- **建议有效时长**：35–140 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 2,
    "cols": 3
  },
  "faces": [
    [
      "A",
      "B",
      "C"
    ],
    [
      "A",
      "C",
      "B"
    ]
  ],
  "previewSeconds": 4.5,
  "maxMismatches": 4,
  "turnRules": {
    "flipTwo": "matching pair stay faceup; mismatch waits 0.7s and flips back",
    "pauseDuringMismatchedFlip": true,
    "matchedCardsCannotFlipAgain": true
  },
  "goal": {
    "type": "match-all",
    "pairs": 3
  },
  "clues": {},
  "layoutTransforms": [
    "identity"
  ],
  "transformsApplyToEntireBoard": true,
  "progressPersist": "matched ids + mismatches + active two flips + preview timer"
}
```

- **参考通关方案**：

```json
{
  "pairs": [
    {
      "symbol": "A",
      "positions": [
        [
          0,
          0
        ],
        [
          1,
          0
        ]
      ]
    },
    {
      "symbol": "B",
      "positions": [
        [
          0,
          1
        ],
        [
          1,
          2
        ]
      ]
    },
    {
      "symbol": "C",
      "positions": [
        [
          0,
          2
        ],
        [
          1,
          1
        ]
      ]
    }
  ],
  "approach": "先利用提示再按主题区域扫描，所有匹配都可用该矩阵复核"
}
```

**验收工单**：

1. **成功路径**：每个符号恰好两张，参考配对表覆盖全部格子；线索经过事实校验
2. **失败路径**：错误次数超过限制失败但允许立即重试；变换必须同步更新正确线索
3. **移动端**：触摸单张卡的命中区域≥44px，不会翻同一张两次
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：布局对称变换仅用于重玩变化，关卡原理不变；不能对称变换卡片却不更新线索

---

### C02 · 两段扫描

- **通关目标**：在4次错误以内配对四组
- **关卡决策**：记忆策略或推理顺序决定翻牌效率
- **练习重点**：左半→右半顺序扫描降低遗忘
- **探索反馈**：发现所有符号恰好一次分布在每行
- **建议有效时长**：35–140 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 2,
    "cols": 4
  },
  "faces": [
    [
      "A",
      "B",
      "C",
      "D"
    ],
    [
      "C",
      "A",
      "D",
      "B"
    ]
  ],
  "previewSeconds": 3.8,
  "maxMismatches": 4,
  "turnRules": {
    "flipTwo": "matching pair stay faceup; mismatch waits 0.7s and flips back",
    "pauseDuringMismatchedFlip": true,
    "matchedCardsCannotFlipAgain": true
  },
  "goal": {
    "type": "match-all",
    "pairs": 4
  },
  "clues": {
    "hintText": "每种图案在上下两行各出现一次"
  },
  "layoutTransforms": [
    "identity"
  ],
  "transformsApplyToEntireBoard": true,
  "progressPersist": "matched ids + mismatches + active two flips + preview timer"
}
```

- **参考通关方案**：

```json
{
  "pairs": [
    {
      "symbol": "A",
      "positions": [
        [
          0,
          0
        ],
        [
          1,
          1
        ]
      ]
    },
    {
      "symbol": "B",
      "positions": [
        [
          0,
          1
        ],
        [
          1,
          3
        ]
      ]
    },
    {
      "symbol": "C",
      "positions": [
        [
          0,
          2
        ],
        [
          1,
          0
        ]
      ]
    },
    {
      "symbol": "D",
      "positions": [
        [
          0,
          3
        ],
        [
          1,
          2
        ]
      ]
    }
  ],
  "approach": "先利用提示再按主题区域扫描，所有匹配都可用该矩阵复核"
}
```

**验收工单**：

1. **成功路径**：每个符号恰好两张，参考配对表覆盖全部格子；线索经过事实校验
2. **失败路径**：错误次数超过限制失败但允许立即重试；变换必须同步更新正确线索
3. **移动端**：触摸单张卡的命中区域≥44px，不会翻同一张两次
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：布局对称变换仅用于重玩变化，关卡原理不变；不能对称变换卡片却不更新线索

---

### C03 · 位置线索

- **通关目标**：用分区预览与位置线索完成六对
- **关卡决策**：记忆策略或推理顺序决定翻牌效率
- **练习重点**：先记每一行再用排除法
- **探索反馈**：每对首张与末张的位置可以组成手势记忆
- **建议有效时长**：35–140 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 3,
    "cols": 4
  },
  "faces": [
    [
      "A",
      "B",
      "C",
      "D"
    ],
    [
      "E",
      "F",
      "A",
      "B"
    ],
    [
      "F",
      "E",
      "D",
      "C"
    ]
  ],
  "previewSeconds": 4.0,
  "maxMismatches": 5,
  "turnRules": {
    "flipTwo": "matching pair stay faceup; mismatch waits 0.7s and flips back",
    "pauseDuringMismatchedFlip": true,
    "matchedCardsCannotFlipAgain": true
  },
  "goal": {
    "type": "match-all",
    "pairs": 6
  },
  "clues": {
    "previewMode": "row-by-row",
    "previewEachRowSec": 1.5
  },
  "layoutTransforms": [
    "identity",
    "mirror-horizontal",
    "mirror-vertical"
  ],
  "transformsApplyToEntireBoard": true,
  "progressPersist": "matched ids + mismatches + active two flips + preview timer"
}
```

- **参考通关方案**：

```json
{
  "pairs": [
    {
      "symbol": "A",
      "positions": [
        [
          0,
          0
        ],
        [
          1,
          2
        ]
      ]
    },
    {
      "symbol": "B",
      "positions": [
        [
          0,
          1
        ],
        [
          1,
          3
        ]
      ]
    },
    {
      "symbol": "C",
      "positions": [
        [
          0,
          2
        ],
        [
          2,
          3
        ]
      ]
    },
    {
      "symbol": "D",
      "positions": [
        [
          0,
          3
        ],
        [
          2,
          2
        ]
      ]
    },
    {
      "symbol": "E",
      "positions": [
        [
          1,
          0
        ],
        [
          2,
          1
        ]
      ]
    },
    {
      "symbol": "F",
      "positions": [
        [
          1,
          1
        ],
        [
          2,
          0
        ]
      ]
    }
  ],
  "approach": "先利用提示再按主题区域扫描，所有匹配都可用该矩阵复核"
}
```

**验收工单**：

1. **成功路径**：每个符号恰好两张，参考配对表覆盖全部格子；线索经过事实校验
2. **失败路径**：错误次数超过限制失败但允许立即重试；变换必须同步更新正确线索
3. **移动端**：触摸单张卡的命中区域≥44px，不会翻同一张两次
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：布局对称变换仅用于重玩变化，关卡原理不变；不能对称变换卡片却不更新线索

---

### C04 · 镜像试验

- **通关目标**：识别上下两区域镜像配对规律
- **关卡决策**：记忆策略或推理顺序决定翻牌效率
- **练习重点**：主动先观察规律，再翻牌
- **探索反馈**：上下行是镜像排列
- **建议有效时长**：35–140 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 4,
    "cols": 4
  },
  "faces": [
    [
      "A",
      "B",
      "C",
      "D"
    ],
    [
      "E",
      "F",
      "G",
      "H"
    ],
    [
      "D",
      "C",
      "B",
      "A"
    ],
    [
      "H",
      "G",
      "F",
      "E"
    ]
  ],
  "previewSeconds": 3.0,
  "maxMismatches": 6,
  "turnRules": {
    "flipTwo": "matching pair stay faceup; mismatch waits 0.7s and flips back",
    "pauseDuringMismatchedFlip": true,
    "matchedCardsCannotFlipAgain": true
  },
  "goal": {
    "type": "match-all",
    "pairs": 8
  },
  "clues": {
    "hintText": "上半区与下半区存在镜像关系"
  },
  "layoutTransforms": [
    "identity",
    "mirror-horizontal",
    "mirror-vertical"
  ],
  "transformsApplyToEntireBoard": true,
  "progressPersist": "matched ids + mismatches + active two flips + preview timer"
}
```

- **参考通关方案**：

```json
{
  "pairs": [
    {
      "symbol": "A",
      "positions": [
        [
          0,
          0
        ],
        [
          2,
          3
        ]
      ]
    },
    {
      "symbol": "B",
      "positions": [
        [
          0,
          1
        ],
        [
          2,
          2
        ]
      ]
    },
    {
      "symbol": "C",
      "positions": [
        [
          0,
          2
        ],
        [
          2,
          1
        ]
      ]
    },
    {
      "symbol": "D",
      "positions": [
        [
          0,
          3
        ],
        [
          2,
          0
        ]
      ]
    },
    {
      "symbol": "E",
      "positions": [
        [
          1,
          0
        ],
        [
          3,
          3
        ]
      ]
    },
    {
      "symbol": "F",
      "positions": [
        [
          1,
          1
        ],
        [
          3,
          2
        ]
      ]
    },
    {
      "symbol": "G",
      "positions": [
        [
          1,
          2
        ],
        [
          3,
          1
        ]
      ]
    },
    {
      "symbol": "H",
      "positions": [
        [
          1,
          3
        ],
        [
          3,
          0
        ]
      ]
    }
  ],
  "approach": "先利用提示再按主题区域扫描，所有匹配都可用该矩阵复核"
}
```

**验收工单**：

1. **成功路径**：每个符号恰好两张，参考配对表覆盖全部格子；线索经过事实校验
2. **失败路径**：错误次数超过限制失败但允许立即重试；变换必须同步更新正确线索
3. **移动端**：触摸单张卡的命中区域≥44px，不会翻同一张两次
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：布局对称变换仅用于重玩变化，关卡原理不变；不能对称变换卡片却不更新线索

---

### C05 · 左右互换

- **通关目标**：找出两层错位关系并完成八对
- **关卡决策**：记忆策略或推理顺序决定翻牌效率
- **练习重点**：用象限编码而非死记整个棋盘
- **探索反馈**：每对图案分散于上下两个半区
- **建议有效时长**：35–140 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 4,
    "cols": 4
  },
  "faces": [
    [
      "A",
      "B",
      "C",
      "D"
    ],
    [
      "E",
      "F",
      "G",
      "H"
    ],
    [
      "E",
      "G",
      "F",
      "H"
    ],
    [
      "B",
      "D",
      "A",
      "C"
    ]
  ],
  "previewSeconds": 3.0,
  "maxMismatches": 5,
  "turnRules": {
    "flipTwo": "matching pair stay faceup; mismatch waits 0.7s and flips back",
    "pauseDuringMismatchedFlip": true,
    "matchedCardsCannotFlipAgain": true
  },
  "goal": {
    "type": "match-all",
    "pairs": 8
  },
  "clues": {
    "previewMode": "quadrants",
    "previewEachQuadrantSec": 1.4
  },
  "layoutTransforms": [
    "identity",
    "mirror-horizontal",
    "mirror-vertical"
  ],
  "transformsApplyToEntireBoard": true,
  "progressPersist": "matched ids + mismatches + active two flips + preview timer"
}
```

- **参考通关方案**：

```json
{
  "pairs": [
    {
      "symbol": "A",
      "positions": [
        [
          0,
          0
        ],
        [
          3,
          2
        ]
      ]
    },
    {
      "symbol": "B",
      "positions": [
        [
          0,
          1
        ],
        [
          3,
          0
        ]
      ]
    },
    {
      "symbol": "C",
      "positions": [
        [
          0,
          2
        ],
        [
          3,
          3
        ]
      ]
    },
    {
      "symbol": "D",
      "positions": [
        [
          0,
          3
        ],
        [
          3,
          1
        ]
      ]
    },
    {
      "symbol": "E",
      "positions": [
        [
          1,
          0
        ],
        [
          2,
          0
        ]
      ]
    },
    {
      "symbol": "F",
      "positions": [
        [
          1,
          1
        ],
        [
          2,
          2
        ]
      ]
    },
    {
      "symbol": "G",
      "positions": [
        [
          1,
          2
        ],
        [
          2,
          1
        ]
      ]
    },
    {
      "symbol": "H",
      "positions": [
        [
          1,
          3
        ],
        [
          2,
          3
        ]
      ]
    }
  ],
  "approach": "先利用提示再按主题区域扫描，所有匹配都可用该矩阵复核"
}
```

**验收工单**：

1. **成功路径**：每个符号恰好两张，参考配对表覆盖全部格子；线索经过事实校验
2. **失败路径**：错误次数超过限制失败但允许立即重试；变换必须同步更新正确线索
3. **移动端**：触摸单张卡的命中区域≥44px，不会翻同一张两次
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：布局对称变换仅用于重玩变化，关卡原理不变；不能对称变换卡片却不更新线索

---

### C06 · 终局推理

- **通关目标**：在更少的翻错次数内完成8对
- **关卡决策**：记忆策略或推理顺序决定翻牌效率
- **练习重点**：建立逻辑笔记与优先检查顺序
- **探索反馈**：有规律但不完全镜像，可选给出一对线索
- **建议有效时长**：35–140 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 4,
    "cols": 4
  },
  "faces": [
    [
      "A",
      "B",
      "C",
      "D"
    ],
    [
      "E",
      "F",
      "G",
      "H"
    ],
    [
      "H",
      "A",
      "F",
      "C"
    ],
    [
      "D",
      "G",
      "B",
      "E"
    ]
  ],
  "previewSeconds": 2.8,
  "maxMismatches": 4,
  "turnRules": {
    "flipTwo": "matching pair stay faceup; mismatch waits 0.7s and flips back",
    "pauseDuringMismatchedFlip": true,
    "matchedCardsCannotFlipAgain": true
  },
  "goal": {
    "type": "match-all",
    "pairs": 8
  },
  "clues": {
    "hintText": "四个角不是同一种图案；右下角能与第二行图案配对"
  },
  "layoutTransforms": [
    "identity",
    "mirror-horizontal",
    "mirror-vertical"
  ],
  "transformsApplyToEntireBoard": true,
  "progressPersist": "matched ids + mismatches + active two flips + preview timer"
}
```

- **参考通关方案**：

```json
{
  "pairs": [
    {
      "symbol": "A",
      "positions": [
        [
          0,
          0
        ],
        [
          2,
          1
        ]
      ]
    },
    {
      "symbol": "B",
      "positions": [
        [
          0,
          1
        ],
        [
          3,
          2
        ]
      ]
    },
    {
      "symbol": "C",
      "positions": [
        [
          0,
          2
        ],
        [
          2,
          3
        ]
      ]
    },
    {
      "symbol": "D",
      "positions": [
        [
          0,
          3
        ],
        [
          3,
          0
        ]
      ]
    },
    {
      "symbol": "E",
      "positions": [
        [
          1,
          0
        ],
        [
          3,
          3
        ]
      ]
    },
    {
      "symbol": "F",
      "positions": [
        [
          1,
          1
        ],
        [
          2,
          2
        ]
      ]
    },
    {
      "symbol": "G",
      "positions": [
        [
          1,
          2
        ],
        [
          3,
          1
        ]
      ]
    },
    {
      "symbol": "H",
      "positions": [
        [
          1,
          3
        ],
        [
          2,
          0
        ]
      ]
    }
  ],
  "approach": "先利用提示再按主题区域扫描，所有匹配都可用该矩阵复核"
}
```

**验收工单**：

1. **成功路径**：每个符号恰好两张，参考配对表覆盖全部格子；线索经过事实校验
2. **失败路径**：错误次数超过限制失败但允许立即重试；变换必须同步更新正确线索
3. **移动端**：触摸单张卡的命中区域≥44px，不会翻同一张两次
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：布局对称变换仅用于重玩变化，关卡原理不变；不能对称变换卡片却不更新线索

---

