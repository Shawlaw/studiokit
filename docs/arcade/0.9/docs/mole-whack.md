# 打地鼠｜6 关可实施蓝图

- 游戏 ID：`mole-whack`；当前公开主干对应文件：`apps/arcade/games/mole-whack.html`
- 数据源：`../levels/mole-whack.json`，每关单文件在 `../levels/stages/mole-whack-Cxx.json`
- 实施对象：独立 challenge mode，经典模式原样保留；关卡表达：洞口事件时间轴
- 状态：策划版，已运行静态校验；未经过当前引擎物理模拟和真机测试。

## 章节总览

| # | 关卡 | 目标 | 技巧 | 发现 |
|---:|---|---|---|---|
| 1 | 看准再敲 | 连续六次准确点击 | 观察鼠出现的窗口，而不是狂点屏幕 | 洞口闪动是可预测前摇 |
| 2 | 金鼠优先 | 至少点中两只金鼠与五个普通目标 | 选择稀有高分目标优先 | 金鼠图案有星形边框而不只颜色不同 |
| 3 | 识别炸弹 | 至少七次正确敲击并避开所有炸弹 | 停止点击比击中目标同样重要 | 爆炸物有不同轮廓和出现前警告 |
| 4 | 双目标节奏 | 同时出现两只时优先点金鼠 | 两指各点击不同洞可节约时间 | 同一时刻多洞出现不构成无法完成的操作窗 |
| 5 | 假象训练 | 识别假目标，并在有限窗口稳定得分 | 放弃疑似陷阱，保留命中率 | 假目标不提供分数且打中扣一次评价 |
| 6 | 洞口终考 | 命中10个有效目标，其中金鼠≥3且零炸弹 | 分清优先级，比高频无脑点击更有效 | 终局综合金鼠、炸弹和假目标规律 |

## 逐关详细规格

### C01 · 看准再敲

- **通关目标**：连续六次准确点击
- **关卡决策**：敲有效目标或主动忽略炸弹/假目标
- **练习重点**：观察鼠出现的窗口，而不是狂点屏幕
- **探索反馈**：洞口闪动是可预测前摇
- **建议有效时长**：30–40 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 3,
    "cols": 3,
    "slotOrder": "row-major from 0 to 8"
  },
  "stageDurationSec": 30,
  "events": [
    {
      "id": "e1",
      "atSec": 2,
      "slot": 0,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e2",
      "atSec": 5,
      "slot": 4,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e3",
      "atSec": 8,
      "slot": 8,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e4",
      "atSec": 11,
      "slot": 2,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e5",
      "atSec": 14,
      "slot": 6,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e6",
      "atSec": 17,
      "slot": 1,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e7",
      "atSec": 20,
      "slot": 7,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e8",
      "atSec": 23,
      "slot": 3,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    }
  ],
  "win": {
    "minValidHits": 6,
    "minGoldHits": 0,
    "maxBombHits": 0,
    "maxDecoyHits": 0
  },
  "scoring": {
    "normal": 1,
    "gold": 2,
    "bomb": -3,
    "decoy": -1,
    "miss": 0
  },
  "tapRule": "仅洞口可点击范围判定，每个事件最多命中一次",
  "time": "使用暂停感知逻辑时钟；进入后台事件不推进"
}
```

- **参考通关方案**：

```json
{
  "hitEventIds": [
    "e1",
    "e2",
    "e3",
    "e4",
    "e5",
    "e6",
    "e7",
    "e8"
  ],
  "ignoreKinds": [
    "bomb",
    "decoy"
  ]
}
```

**验收工单**：

1. **成功路径**：脚本全部有效目标数≥过关需求，spawn不重叠同一洞口时间窗
2. **失败路径**：炸弹和假目标扣分正确且误触不会连击多次
3. **移动端**：两个同时有效目标可用双指点击，不被UI控件遮挡
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C02 · 金鼠优先

- **通关目标**：至少点中两只金鼠与五个普通目标
- **关卡决策**：敲有效目标或主动忽略炸弹/假目标
- **练习重点**：选择稀有高分目标优先
- **探索反馈**：金鼠图案有星形边框而不只颜色不同
- **建议有效时长**：31–41 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 3,
    "cols": 3,
    "slotOrder": "row-major from 0 to 8"
  },
  "stageDurationSec": 31,
  "events": [
    {
      "id": "e1",
      "atSec": 2,
      "slot": 0,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e2",
      "atSec": 4.5,
      "slot": 4,
      "kind": "gold",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 2
    },
    {
      "id": "e3",
      "atSec": 7,
      "slot": 2,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e4",
      "atSec": 9.5,
      "slot": 8,
      "kind": "gold",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 2
    },
    {
      "id": "e5",
      "atSec": 12,
      "slot": 1,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e6",
      "atSec": 15,
      "slot": 3,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e7",
      "atSec": 18,
      "slot": 5,
      "kind": "gold",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 2
    },
    {
      "id": "e8",
      "atSec": 21,
      "slot": 7,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e9",
      "atSec": 24,
      "slot": 6,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    }
  ],
  "win": {
    "minValidHits": 7,
    "minGoldHits": 2,
    "maxBombHits": 0,
    "maxDecoyHits": 0
  },
  "scoring": {
    "normal": 1,
    "gold": 2,
    "bomb": -3,
    "decoy": -1,
    "miss": 0
  },
  "tapRule": "仅洞口可点击范围判定，每个事件最多命中一次",
  "time": "使用暂停感知逻辑时钟；进入后台事件不推进"
}
```

- **参考通关方案**：

```json
{
  "hitEventIds": [
    "e1",
    "e2",
    "e3",
    "e4",
    "e5",
    "e6",
    "e7",
    "e8",
    "e9"
  ],
  "ignoreKinds": [
    "bomb",
    "decoy"
  ]
}
```

**验收工单**：

1. **成功路径**：脚本全部有效目标数≥过关需求，spawn不重叠同一洞口时间窗
2. **失败路径**：炸弹和假目标扣分正确且误触不会连击多次
3. **移动端**：两个同时有效目标可用双指点击，不被UI控件遮挡
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C03 · 识别炸弹

- **通关目标**：至少七次正确敲击并避开所有炸弹
- **关卡决策**：敲有效目标或主动忽略炸弹/假目标
- **练习重点**：停止点击比击中目标同样重要
- **探索反馈**：爆炸物有不同轮廓和出现前警告
- **建议有效时长**：32–42 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 3,
    "cols": 3,
    "slotOrder": "row-major from 0 to 8"
  },
  "stageDurationSec": 32,
  "events": [
    {
      "id": "e1",
      "atSec": 2,
      "slot": 0,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e2",
      "atSec": 4,
      "slot": 4,
      "kind": "bomb",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 0
    },
    {
      "id": "e3",
      "atSec": 6,
      "slot": 8,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e4",
      "atSec": 8,
      "slot": 2,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e5",
      "atSec": 10,
      "slot": 6,
      "kind": "bomb",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 0
    },
    {
      "id": "e6",
      "atSec": 12,
      "slot": 1,
      "kind": "gold",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 2
    },
    {
      "id": "e7",
      "atSec": 15,
      "slot": 5,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e8",
      "atSec": 17,
      "slot": 3,
      "kind": "bomb",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 0
    },
    {
      "id": "e9",
      "atSec": 19,
      "slot": 7,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e10",
      "atSec": 22,
      "slot": 4,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 1
    },
    {
      "id": "e11",
      "atSec": 25,
      "slot": 0,
      "kind": "gold",
      "prewarnSec": 0.42,
      "visibleSec": 1.4,
      "score": 2
    }
  ],
  "win": {
    "minValidHits": 7,
    "minGoldHits": 1,
    "maxBombHits": 0,
    "maxDecoyHits": 0
  },
  "scoring": {
    "normal": 1,
    "gold": 2,
    "bomb": -3,
    "decoy": -1,
    "miss": 0
  },
  "tapRule": "仅洞口可点击范围判定，每个事件最多命中一次",
  "time": "使用暂停感知逻辑时钟；进入后台事件不推进"
}
```

- **参考通关方案**：

```json
{
  "hitEventIds": [
    "e1",
    "e3",
    "e4",
    "e6",
    "e7",
    "e9",
    "e10",
    "e11"
  ],
  "ignoreKinds": [
    "bomb",
    "decoy"
  ]
}
```

**验收工单**：

1. **成功路径**：脚本全部有效目标数≥过关需求，spawn不重叠同一洞口时间窗
2. **失败路径**：炸弹和假目标扣分正确且误触不会连击多次
3. **移动端**：两个同时有效目标可用双指点击，不被UI控件遮挡
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C04 · 双目标节奏

- **通关目标**：同时出现两只时优先点金鼠
- **关卡决策**：敲有效目标或主动忽略炸弹/假目标
- **练习重点**：两指各点击不同洞可节约时间
- **探索反馈**：同一时刻多洞出现不构成无法完成的操作窗
- **建议有效时长**：34–44 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 3,
    "cols": 3,
    "slotOrder": "row-major from 0 to 8"
  },
  "stageDurationSec": 34,
  "events": [
    {
      "id": "e1",
      "atSec": 2,
      "slot": 0,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e2",
      "atSec": 4,
      "slot": 4,
      "kind": "gold",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 2
    },
    {
      "id": "e3",
      "atSec": 4,
      "slot": 8,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e4",
      "atSec": 7,
      "slot": 1,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e5",
      "atSec": 7,
      "slot": 7,
      "kind": "gold",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 2
    },
    {
      "id": "e6",
      "atSec": 10,
      "slot": 2,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e7",
      "atSec": 10,
      "slot": 6,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e8",
      "atSec": 13,
      "slot": 0,
      "kind": "gold",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 2
    },
    {
      "id": "e9",
      "atSec": 13,
      "slot": 8,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e10",
      "atSec": 16,
      "slot": 3,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e11",
      "atSec": 16,
      "slot": 5,
      "kind": "gold",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 2
    },
    {
      "id": "e12",
      "atSec": 20,
      "slot": 4,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e13",
      "atSec": 23,
      "slot": 2,
      "kind": "bomb",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 0
    }
  ],
  "win": {
    "minValidHits": 8,
    "minGoldHits": 2,
    "maxBombHits": 0,
    "maxDecoyHits": 0
  },
  "scoring": {
    "normal": 1,
    "gold": 2,
    "bomb": -3,
    "decoy": -1,
    "miss": 0
  },
  "tapRule": "仅洞口可点击范围判定，每个事件最多命中一次",
  "time": "使用暂停感知逻辑时钟；进入后台事件不推进"
}
```

- **参考通关方案**：

```json
{
  "hitEventIds": [
    "e1",
    "e2",
    "e3",
    "e4",
    "e5",
    "e6",
    "e7",
    "e8",
    "e9",
    "e10",
    "e11",
    "e12"
  ],
  "ignoreKinds": [
    "bomb",
    "decoy"
  ]
}
```

**验收工单**：

1. **成功路径**：脚本全部有效目标数≥过关需求，spawn不重叠同一洞口时间窗
2. **失败路径**：炸弹和假目标扣分正确且误触不会连击多次
3. **移动端**：两个同时有效目标可用双指点击，不被UI控件遮挡
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C05 · 假象训练

- **通关目标**：识别假目标，并在有限窗口稳定得分
- **关卡决策**：敲有效目标或主动忽略炸弹/假目标
- **练习重点**：放弃疑似陷阱，保留命中率
- **探索反馈**：假目标不提供分数且打中扣一次评价
- **建议有效时长**：34–44 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 3,
    "cols": 3,
    "slotOrder": "row-major from 0 to 8"
  },
  "stageDurationSec": 34,
  "events": [
    {
      "id": "e1",
      "atSec": 2,
      "slot": 0,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e2",
      "atSec": 4,
      "slot": 1,
      "kind": "decoy",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 0
    },
    {
      "id": "e3",
      "atSec": 6,
      "slot": 2,
      "kind": "gold",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 2
    },
    {
      "id": "e4",
      "atSec": 8,
      "slot": 3,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e5",
      "atSec": 10,
      "slot": 4,
      "kind": "bomb",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 0
    },
    {
      "id": "e6",
      "atSec": 12,
      "slot": 5,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e7",
      "atSec": 14,
      "slot": 6,
      "kind": "decoy",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 0
    },
    {
      "id": "e8",
      "atSec": 16,
      "slot": 7,
      "kind": "gold",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 2
    },
    {
      "id": "e9",
      "atSec": 18,
      "slot": 8,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e10",
      "atSec": 21,
      "slot": 0,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e11",
      "atSec": 24,
      "slot": 4,
      "kind": "gold",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 2
    }
  ],
  "win": {
    "minValidHits": 7,
    "minGoldHits": 2,
    "maxBombHits": 0,
    "maxDecoyHits": 1
  },
  "scoring": {
    "normal": 1,
    "gold": 2,
    "bomb": -3,
    "decoy": -1,
    "miss": 0
  },
  "tapRule": "仅洞口可点击范围判定，每个事件最多命中一次",
  "time": "使用暂停感知逻辑时钟；进入后台事件不推进"
}
```

- **参考通关方案**：

```json
{
  "hitEventIds": [
    "e1",
    "e3",
    "e4",
    "e6",
    "e8",
    "e9",
    "e10",
    "e11"
  ],
  "ignoreKinds": [
    "bomb",
    "decoy"
  ]
}
```

**验收工单**：

1. **成功路径**：脚本全部有效目标数≥过关需求，spawn不重叠同一洞口时间窗
2. **失败路径**：炸弹和假目标扣分正确且误触不会连击多次
3. **移动端**：两个同时有效目标可用双指点击，不被UI控件遮挡
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C06 · 洞口终考

- **通关目标**：命中10个有效目标，其中金鼠≥3且零炸弹
- **关卡决策**：敲有效目标或主动忽略炸弹/假目标
- **练习重点**：分清优先级，比高频无脑点击更有效
- **探索反馈**：终局综合金鼠、炸弹和假目标规律
- **建议有效时长**：38–48 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "grid": {
    "rows": 3,
    "cols": 3,
    "slotOrder": "row-major from 0 to 8"
  },
  "stageDurationSec": 38,
  "events": [
    {
      "id": "e1",
      "atSec": 2,
      "slot": 0,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e2",
      "atSec": 4,
      "slot": 4,
      "kind": "gold",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 2
    },
    {
      "id": "e3",
      "atSec": 4,
      "slot": 8,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e4",
      "atSec": 7,
      "slot": 1,
      "kind": "bomb",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 0
    },
    {
      "id": "e5",
      "atSec": 9,
      "slot": 7,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e6",
      "atSec": 11,
      "slot": 3,
      "kind": "gold",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 2
    },
    {
      "id": "e7",
      "atSec": 13,
      "slot": 5,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e8",
      "atSec": 15,
      "slot": 2,
      "kind": "decoy",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 0
    },
    {
      "id": "e9",
      "atSec": 17,
      "slot": 6,
      "kind": "gold",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 2
    },
    {
      "id": "e10",
      "atSec": 19,
      "slot": 4,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e11",
      "atSec": 21,
      "slot": 0,
      "kind": "bomb",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 0
    },
    {
      "id": "e12",
      "atSec": 24,
      "slot": 8,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e13",
      "atSec": 26,
      "slot": 2,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    },
    {
      "id": "e14",
      "atSec": 29,
      "slot": 6,
      "kind": "gold",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 2
    },
    {
      "id": "e15",
      "atSec": 32,
      "slot": 3,
      "kind": "normal",
      "prewarnSec": 0.42,
      "visibleSec": 1.25,
      "score": 1
    }
  ],
  "win": {
    "minValidHits": 10,
    "minGoldHits": 3,
    "maxBombHits": 0,
    "maxDecoyHits": 1
  },
  "scoring": {
    "normal": 1,
    "gold": 2,
    "bomb": -3,
    "decoy": -1,
    "miss": 0
  },
  "tapRule": "仅洞口可点击范围判定，每个事件最多命中一次",
  "time": "使用暂停感知逻辑时钟；进入后台事件不推进"
}
```

- **参考通关方案**：

```json
{
  "hitEventIds": [
    "e1",
    "e2",
    "e3",
    "e5",
    "e6",
    "e7",
    "e9",
    "e10",
    "e12",
    "e13",
    "e14",
    "e15"
  ],
  "ignoreKinds": [
    "bomb",
    "decoy"
  ]
}
```

**验收工单**：

1. **成功路径**：脚本全部有效目标数≥过关需求，spawn不重叠同一洞口时间窗
2. **失败路径**：炸弹和假目标扣分正确且误触不会连击多次
3. **移动端**：两个同时有效目标可用双指点击，不被UI控件遮挡
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

