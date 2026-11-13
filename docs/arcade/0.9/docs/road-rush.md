# 极速车道｜6 关可实施蓝图

- 游戏 ID：`road-rush`；当前公开主干对应文件：`apps/arcade/games/road-rush.html`
- 数据源：`../levels/road-rush.json`，每关单文件在 `../levels/stages/road-rush-Cxx.json`
- 实施对象：独立 challenge mode，经典模式原样保留；关卡表达：车流时隙/安全路线
- 状态：策划版，已运行静态校验；未经过当前引擎物理模拟和真机测试。

## 章节总览

| # | 关卡 | 目标 | 技巧 | 发现 |
|---:|---|---|---|---|
| 1 | 入门超车 | 识别阻挡车道并提前改变车道 | 慢车停留的车道一段时间保持不变 | 分数奖励安全超车而不是随机变道 |
| 2 | 左右交替 | 交错车流中识别下一秒的安全区域 | 贴近拥堵时可以选择暂留安全车道 | 看预告比最后时刻换道更好 |
| 3 | 施工收窄 | 提前避开占据两个车道的施工路段 | 中途选择左绕还是右绕 | 施工障碍不应瞬间刷新 |
| 4 | 车队夹缝 | 以两车道内的安全空间连续变道 | 放弃贴身超车奖励或挑战高分 | 优先看未来两个位置而不是当前空挡 |
| 5 | 近距奖励 | 在保命路线之外选择近车道超车积分 | 拥堵车道额外加分但不强迫冒险 | 看懂奖励门牌并在恰当时刻避开 |
| 6 | 最终路书 | 持续读出拥堵变化，抵达最后路标 | 先作安全变道规划，再考虑高分贴近车流 | 将前五关的选择合并为连续动作 |

## 逐关详细规格

### C01 · 入门超车

- **通关目标**：识别阻挡车道并提前改变车道
- **关卡决策**：避让是硬目标，近距超车只增加评价
- **练习重点**：慢车停留的车道一段时间保持不变
- **探索反馈**：分数奖励安全超车而不是随机变道
- **建议有效时长**：20–75 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "laneCount": 4,
  "slotDurationSec": 1.15,
  "laneChangeTimeSec": 0.22,
  "startLane": 1,
  "timeline": [
    {
      "slot": 1,
      "atSec": 0.0,
      "occupiedLanes": [
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    },
    {
      "slot": 2,
      "atSec": 1.15,
      "occupiedLanes": [
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    },
    {
      "slot": 3,
      "atSec": 2.3,
      "occupiedLanes": [
        1
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 4,
      "atSec": 3.45,
      "occupiedLanes": [
        1
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 5,
      "atSec": 4.6,
      "occupiedLanes": [
        0
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1
      ]
    },
    {
      "slot": 6,
      "atSec": 5.75,
      "occupiedLanes": [
        0
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1
      ]
    },
    {
      "slot": 7,
      "atSec": 6.9,
      "occupiedLanes": [
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        2
      ]
    },
    {
      "slot": 8,
      "atSec": 8.05,
      "occupiedLanes": [
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        2
      ]
    },
    {
      "slot": 9,
      "atSec": 9.2,
      "occupiedLanes": [
        1
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 10,
      "atSec": 10.35,
      "occupiedLanes": [
        1
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 11,
      "atSec": 11.5,
      "occupiedLanes": [
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    },
    {
      "slot": 12,
      "atSec": 12.65,
      "occupiedLanes": [
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    }
  ],
  "goal": {
    "type": "survive-all-slots",
    "minDistanceMeters": 540
  },
  "scoreRules": {
    "passBonus": 10,
    "nearPassBonus": 5,
    "noDamageGold": true
  },
  "spawnerPolicy": "challenge only; disable classic random spawn while timeline active",
  "pathProofModel": "at each slot lane must not be occupied, consecutive lane indices differ ≤1; physics transitions must also be tested"
}
```

- **参考通关方案**：

```json
{
  "safeLaneBySlot": [
    1,
    0,
    1,
    2,
    3,
    2,
    1,
    1,
    1,
    0,
    0,
    0,
    0
  ],
  "bonusStrategy": "不求最高分，只给出可活着完成的安全车道序列"
}
```

**验收工单**：

1. **成功路径**：时间展开DP存在连续相邻车道安全路径，并检查换道过渡0.22秒内的碰撞
2. **失败路径**：把任一车阵改到无可行路径时校验器必须拒绝；碰撞有清晰责任归因
3. **移动端**：左右手势和按键一次恰好一车道，按住不重复跳道
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：lane proof只按离散格成立；真正实现必须把相邻车道过渡也纳入碰撞测试

---

### C02 · 左右交替

- **通关目标**：交错车流中识别下一秒的安全区域
- **关卡决策**：避让是硬目标，近距超车只增加评价
- **练习重点**：贴近拥堵时可以选择暂留安全车道
- **探索反馈**：看预告比最后时刻换道更好
- **建议有效时长**：20–75 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "laneCount": 4,
  "slotDurationSec": 1.15,
  "laneChangeTimeSec": 0.22,
  "startLane": 1,
  "timeline": [
    {
      "slot": 1,
      "atSec": 0.0,
      "occupiedLanes": [
        1
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 2,
      "atSec": 1.15,
      "occupiedLanes": [
        1,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        3
      ]
    },
    {
      "slot": 3,
      "atSec": 2.3,
      "occupiedLanes": [
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    },
    {
      "slot": 4,
      "atSec": 3.45,
      "occupiedLanes": [
        2,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1
      ]
    },
    {
      "slot": 5,
      "atSec": 4.6,
      "occupiedLanes": [
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        2
      ]
    },
    {
      "slot": 6,
      "atSec": 5.75,
      "occupiedLanes": [
        0
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1
      ]
    },
    {
      "slot": 7,
      "atSec": 6.9,
      "occupiedLanes": [
        0,
        1
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        2
      ]
    },
    {
      "slot": 8,
      "atSec": 8.05,
      "occupiedLanes": [
        1
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 9,
      "atSec": 9.2,
      "occupiedLanes": [
        1,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        3
      ]
    },
    {
      "slot": 10,
      "atSec": 10.35,
      "occupiedLanes": [
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    },
    {
      "slot": 11,
      "atSec": 11.5,
      "occupiedLanes": [
        1,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        3
      ]
    },
    {
      "slot": 12,
      "atSec": 12.65,
      "occupiedLanes": [
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        2
      ]
    }
  ],
  "goal": {
    "type": "survive-all-slots",
    "minDistanceMeters": 680
  },
  "scoreRules": {
    "passBonus": 10,
    "nearPassBonus": 5,
    "noDamageGold": true
  },
  "spawnerPolicy": "challenge only; disable classic random spawn while timeline active",
  "pathProofModel": "at each slot lane must not be occupied, consecutive lane indices differ ≤1; physics transitions must also be tested"
}
```

- **参考通关方案**：

```json
{
  "safeLaneBySlot": [
    1,
    0,
    0,
    0,
    1,
    2,
    3,
    2,
    2,
    3,
    3,
    3,
    2
  ],
  "bonusStrategy": "不求最高分，只给出可活着完成的安全车道序列"
}
```

**验收工单**：

1. **成功路径**：时间展开DP存在连续相邻车道安全路径，并检查换道过渡0.22秒内的碰撞
2. **失败路径**：把任一车阵改到无可行路径时校验器必须拒绝；碰撞有清晰责任归因
3. **移动端**：左右手势和按键一次恰好一车道，按住不重复跳道
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：lane proof只按离散格成立；真正实现必须把相邻车道过渡也纳入碰撞测试

---

### C03 · 施工收窄

- **通关目标**：提前避开占据两个车道的施工路段
- **关卡决策**：避让是硬目标，近距超车只增加评价
- **练习重点**：中途选择左绕还是右绕
- **探索反馈**：施工障碍不应瞬间刷新
- **建议有效时长**：20–75 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "laneCount": 4,
  "slotDurationSec": 1.15,
  "laneChangeTimeSec": 0.22,
  "startLane": 1,
  "timeline": [
    {
      "slot": 1,
      "atSec": 0.0,
      "occupiedLanes": [
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        2
      ]
    },
    {
      "slot": 2,
      "atSec": 1.15,
      "occupiedLanes": [
        2,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1
      ]
    },
    {
      "slot": 3,
      "atSec": 2.3,
      "occupiedLanes": [
        2,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1
      ]
    },
    {
      "slot": 4,
      "atSec": 3.45,
      "occupiedLanes": [
        1,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 5,
      "atSec": 4.6,
      "occupiedLanes": [
        1,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        3
      ]
    },
    {
      "slot": 6,
      "atSec": 5.75,
      "occupiedLanes": [
        1,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        3
      ]
    },
    {
      "slot": 7,
      "atSec": 6.9,
      "occupiedLanes": [
        0,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    },
    {
      "slot": 8,
      "atSec": 8.05,
      "occupiedLanes": [
        0,
        1
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        2
      ]
    },
    {
      "slot": 9,
      "atSec": 9.2,
      "occupiedLanes": [
        0,
        1
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        2
      ]
    },
    {
      "slot": 10,
      "atSec": 10.35,
      "occupiedLanes": [
        0
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1
      ]
    },
    {
      "slot": 11,
      "atSec": 11.5,
      "occupiedLanes": [
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        2
      ]
    },
    {
      "slot": 12,
      "atSec": 12.65,
      "occupiedLanes": [
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        2
      ]
    }
  ],
  "goal": {
    "type": "survive-all-slots",
    "minDistanceMeters": 820
  },
  "scoreRules": {
    "passBonus": 10,
    "nearPassBonus": 5,
    "noDamageGold": true
  },
  "spawnerPolicy": "challenge only; disable classic random spawn while timeline active",
  "pathProofModel": "at each slot lane must not be occupied, consecutive lane indices differ ≤1; physics transitions must also be tested"
}
```

- **参考通关方案**：

```json
{
  "safeLaneBySlot": [
    1,
    0,
    1,
    1,
    2,
    3,
    3,
    3,
    2,
    2,
    2,
    2,
    2
  ],
  "bonusStrategy": "不求最高分，只给出可活着完成的安全车道序列"
}
```

**验收工单**：

1. **成功路径**：时间展开DP存在连续相邻车道安全路径，并检查换道过渡0.22秒内的碰撞
2. **失败路径**：把任一车阵改到无可行路径时校验器必须拒绝；碰撞有清晰责任归因
3. **移动端**：左右手势和按键一次恰好一车道，按住不重复跳道
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：lane proof只按离散格成立；真正实现必须把相邻车道过渡也纳入碰撞测试

---

### C04 · 车队夹缝

- **通关目标**：以两车道内的安全空间连续变道
- **关卡决策**：避让是硬目标，近距超车只增加评价
- **练习重点**：放弃贴身超车奖励或挑战高分
- **探索反馈**：优先看未来两个位置而不是当前空挡
- **建议有效时长**：20–75 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "laneCount": 4,
  "slotDurationSec": 1.05,
  "laneChangeTimeSec": 0.22,
  "startLane": 1,
  "timeline": [
    {
      "slot": 1,
      "atSec": 0.0,
      "occupiedLanes": [
        0,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        2
      ]
    },
    {
      "slot": 2,
      "atSec": 1.05,
      "occupiedLanes": [
        0,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        2
      ]
    },
    {
      "slot": 3,
      "atSec": 2.1,
      "occupiedLanes": [
        1,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 4,
      "atSec": 3.15,
      "occupiedLanes": [
        1,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 5,
      "atSec": 4.2,
      "occupiedLanes": [
        0,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    },
    {
      "slot": 6,
      "atSec": 5.25,
      "occupiedLanes": [
        0,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    },
    {
      "slot": 7,
      "atSec": 6.3,
      "occupiedLanes": [
        0,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        2
      ]
    },
    {
      "slot": 8,
      "atSec": 7.35,
      "occupiedLanes": [
        1,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 9,
      "atSec": 8.4,
      "occupiedLanes": [
        1,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 10,
      "atSec": 9.45,
      "occupiedLanes": [
        2,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1
      ]
    },
    {
      "slot": 11,
      "atSec": 10.5,
      "occupiedLanes": [
        2,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1
      ]
    },
    {
      "slot": 12,
      "atSec": 11.55,
      "occupiedLanes": [
        0,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        2
      ]
    }
  ],
  "goal": {
    "type": "survive-all-slots",
    "minDistanceMeters": 960
  },
  "scoreRules": {
    "passBonus": 10,
    "nearPassBonus": 5,
    "noDamageGold": true
  },
  "spawnerPolicy": "challenge only; disable classic random spawn while timeline active",
  "pathProofModel": "at each slot lane must not be occupied, consecutive lane indices differ ≤1; physics transitions must also be tested"
}
```

- **参考通关方案**：

```json
{
  "safeLaneBySlot": [
    1,
    2,
    1,
    0,
    0,
    1,
    1,
    1,
    0,
    0,
    0,
    0,
    1
  ],
  "bonusStrategy": "不求最高分，只给出可活着完成的安全车道序列"
}
```

**验收工单**：

1. **成功路径**：时间展开DP存在连续相邻车道安全路径，并检查换道过渡0.22秒内的碰撞
2. **失败路径**：把任一车阵改到无可行路径时校验器必须拒绝；碰撞有清晰责任归因
3. **移动端**：左右手势和按键一次恰好一车道，按住不重复跳道
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：lane proof只按离散格成立；真正实现必须把相邻车道过渡也纳入碰撞测试

---

### C05 · 近距奖励

- **通关目标**：在保命路线之外选择近车道超车积分
- **关卡决策**：避让是硬目标，近距超车只增加评价
- **练习重点**：拥堵车道额外加分但不强迫冒险
- **探索反馈**：看懂奖励门牌并在恰当时刻避开
- **建议有效时长**：20–75 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "laneCount": 4,
  "slotDurationSec": 1.05,
  "laneChangeTimeSec": 0.22,
  "startLane": 1,
  "timeline": [
    {
      "slot": 1,
      "atSec": 0.0,
      "occupiedLanes": [
        0
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1
      ]
    },
    {
      "slot": 2,
      "atSec": 1.05,
      "occupiedLanes": [
        0,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    },
    {
      "slot": 3,
      "atSec": 2.1,
      "occupiedLanes": [
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    },
    {
      "slot": 4,
      "atSec": 3.15,
      "occupiedLanes": [
        1,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        3
      ]
    },
    {
      "slot": 5,
      "atSec": 4.2,
      "occupiedLanes": [
        1
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 6,
      "atSec": 5.25,
      "occupiedLanes": [
        1,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 7,
      "atSec": 6.3,
      "occupiedLanes": [
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        2
      ]
    },
    {
      "slot": 8,
      "atSec": 7.35,
      "occupiedLanes": [
        2,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1
      ]
    },
    {
      "slot": 9,
      "atSec": 8.4,
      "occupiedLanes": [
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    },
    {
      "slot": 10,
      "atSec": 9.45,
      "occupiedLanes": [
        0,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    },
    {
      "slot": 11,
      "atSec": 10.5,
      "occupiedLanes": [
        0
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1
      ]
    },
    {
      "slot": 12,
      "atSec": 11.55,
      "occupiedLanes": [
        0,
        1
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        2
      ]
    }
  ],
  "goal": {
    "type": "survive-all-slots",
    "minDistanceMeters": 1100
  },
  "scoreRules": {
    "passBonus": 10,
    "nearPassBonus": 5,
    "noDamageGold": true
  },
  "spawnerPolicy": "challenge only; disable classic random spawn while timeline active",
  "pathProofModel": "at each slot lane must not be occupied, consecutive lane indices differ ≤1; physics transitions must also be tested"
}
```

- **参考通关方案**：

```json
{
  "safeLaneBySlot": [
    1,
    2,
    1,
    1,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    1,
    2
  ],
  "bonusStrategy": "不求最高分，只给出可活着完成的安全车道序列"
}
```

**验收工单**：

1. **成功路径**：时间展开DP存在连续相邻车道安全路径，并检查换道过渡0.22秒内的碰撞
2. **失败路径**：把任一车阵改到无可行路径时校验器必须拒绝；碰撞有清晰责任归因
3. **移动端**：左右手势和按键一次恰好一车道，按住不重复跳道
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：lane proof只按离散格成立；真正实现必须把相邻车道过渡也纳入碰撞测试

---

### C06 · 最终路书

- **通关目标**：持续读出拥堵变化，抵达最后路标
- **关卡决策**：避让是硬目标，近距超车只增加评价
- **练习重点**：先作安全变道规划，再考虑高分贴近车流
- **探索反馈**：将前五关的选择合并为连续动作
- **建议有效时长**：20–75 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "laneCount": 4,
  "slotDurationSec": 1.05,
  "laneChangeTimeSec": 0.22,
  "startLane": 1,
  "timeline": [
    {
      "slot": 1,
      "atSec": 0.0,
      "occupiedLanes": [
        0,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        2
      ]
    },
    {
      "slot": 2,
      "atSec": 1.05,
      "occupiedLanes": [
        0,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        2
      ]
    },
    {
      "slot": 3,
      "atSec": 2.1,
      "occupiedLanes": [
        1,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 4,
      "atSec": 3.15,
      "occupiedLanes": [
        1,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        3
      ]
    },
    {
      "slot": 5,
      "atSec": 4.2,
      "occupiedLanes": [
        0,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    },
    {
      "slot": 6,
      "atSec": 5.25,
      "occupiedLanes": [
        0,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    },
    {
      "slot": 7,
      "atSec": 6.3,
      "occupiedLanes": [
        1,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 8,
      "atSec": 7.35,
      "occupiedLanes": [
        1,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 9,
      "atSec": 8.4,
      "occupiedLanes": [
        0,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    },
    {
      "slot": 10,
      "atSec": 9.45,
      "occupiedLanes": [
        0,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    },
    {
      "slot": 11,
      "atSec": 10.5,
      "occupiedLanes": [
        1,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 12,
      "atSec": 11.55,
      "occupiedLanes": [
        1,
        3
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        0,
        2
      ]
    },
    {
      "slot": 13,
      "atSec": 12.6,
      "occupiedLanes": [
        0,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    },
    {
      "slot": 14,
      "atSec": 13.65,
      "occupiedLanes": [
        0,
        2
      ],
      "telegraphLeadSec": 1.5,
      "optionalNearPassBonusLanes": [
        1,
        3
      ]
    }
  ],
  "goal": {
    "type": "survive-all-slots",
    "minDistanceMeters": 1240
  },
  "scoreRules": {
    "passBonus": 10,
    "nearPassBonus": 5,
    "noDamageGold": true
  },
  "spawnerPolicy": "challenge only; disable classic random spawn while timeline active",
  "pathProofModel": "at each slot lane must not be occupied, consecutive lane indices differ ≤1; physics transitions must also be tested"
}
```

- **参考通关方案**：

```json
{
  "safeLaneBySlot": [
    1,
    2,
    1,
    0,
    0,
    1,
    1,
    2,
    2,
    3,
    3,
    2,
    2,
    1,
    1
  ],
  "bonusStrategy": "不求最高分，只给出可活着完成的安全车道序列"
}
```

**验收工单**：

1. **成功路径**：时间展开DP存在连续相邻车道安全路径，并检查换道过渡0.22秒内的碰撞
2. **失败路径**：把任一车阵改到无可行路径时校验器必须拒绝；碰撞有清晰责任归因
3. **移动端**：左右手势和按键一次恰好一车道，按住不重复跳道
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：lane proof只按离散格成立；真正实现必须把相邻车道过渡也纳入碰撞测试

---

