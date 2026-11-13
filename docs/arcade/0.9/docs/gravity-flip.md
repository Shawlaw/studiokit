# 重力翻转｜6 关可实施蓝图

- 游戏 ID：`gravity-flip`；当前公开主干对应文件：`apps/arcade/games/gravity-flip.html`
- 数据源：`../levels/gravity-flip.json`，每关单文件在 `../levels/stages/gravity-flip-Cxx.json`
- 实施对象：独立 challenge mode，经典模式原样保留；关卡表达：障碍坐标/翻转窗口
- 状态：策划版，已运行静态校验；未经过当前引擎物理模拟和真机测试。

## 章节总览

| # | 关卡 | 目标 | 技巧 | 发现 |
|---:|---|---|---|---|
| 1 | 第一次翻转 | 从起点通过全部固定尖刺并抵达终点 | 认识两次翻转动作的竖向抵达时间 | 至少提前350逻辑距离看到下一障碍 |
| 2 | 双连拍 | 从起点通过全部固定尖刺并抵达终点 | 连续同侧障碍不应机械连续翻转 | 空中停留在安全天花板也是策略 |
| 3 | 上下合奏 | 从起点通过全部固定尖刺并抵达终点 | 逐个观察交错障碍决定切换时间 | 提前把路线留在另一侧而非临门一脚 |
| 4 | 星之岔路 | 从起点通过全部固定尖刺并抵达终点 | 两颗星在中层，需要短暂翻转后再回归安全路线 | 奖励是冒险而非必经 |
| 5 | 双窄门 | 从起点通过全部固定尖刺并抵达终点 | 障碍高度明显增加但预告更早 | 练习观察到行动的稳定延迟 |
| 6 | 重力终章 | 从起点通过全部固定尖刺并抵达终点 | 交错障碍+一次中间奖励路线选择 | 目标是完成清晰的动作序列，不靠纯随机 |

## 逐关详细规格

### C01 · 第一次翻转

- **通关目标**：从起点通过全部固定尖刺并抵达终点
- **关卡决策**：先保持当前安全侧还是提前翻转
- **练习重点**：认识两次翻转动作的竖向抵达时间
- **探索反馈**：至少提前350逻辑距离看到下一障碍
- **建议有效时长**：45–115 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "世界 x 单位 px，player固定屏幕 x=112，障碍的世界x是首次进入场景的路标，不是生成时相机x；场景需换算 cameraOffset",
  "distanceToFinish": 2200,
  "scrollSpeedPxSec": 260,
  "gravity": 2100,
  "obstacles": [
    {
      "id": "o1",
      "x": 520,
      "side": "floor",
      "height": 145,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o2",
      "x": 1050,
      "side": "ceiling",
      "height": 145,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o3",
      "x": 1570,
      "side": "floor",
      "height": 145,
      "width": 42,
      "telegraphLeadPx": 360
    }
  ],
  "recommendedFlipWindows": [
    {
      "xCenter": 250,
      "toward": "ceiling",
      "tolerancePx": 70
    },
    {
      "xCenter": 790,
      "toward": "floor",
      "tolerancePx": 70
    },
    {
      "xCenter": 1310,
      "toward": "ceiling",
      "tolerancePx": 70
    }
  ],
  "bonusStars": [],
  "startGravity": "floor",
  "win": "pass finish marker alive",
  "collision": "lives=2; collision respawn at most recent safe segment, no auto-use shield"
}
```

- **参考通关方案**：

```json
{
  "flipWindows": [
    [
      250,
      "ceiling"
    ],
    [
      790,
      "floor"
    ],
    [
      1310,
      "ceiling"
    ]
  ],
  "skill": "认识两次翻转动作的竖向抵达时间"
}
```

**验收工单**：

1. **成功路径**：物理仿真至少存在一条可无伤通过的翻转时间序列，角度窗口允许手机响应
2. **失败路径**：在无道具前提下可通过；任一尖刺须满足可观察反应窗口
3. **移动端**：整个画布点击与空格一致，停顿后不会误触翻转
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：推荐翻转点是待物理验证的设计初值，不可把列表直接当成无碰撞证明

---

### C02 · 双连拍

- **通关目标**：从起点通过全部固定尖刺并抵达终点
- **关卡决策**：先保持当前安全侧还是提前翻转
- **练习重点**：连续同侧障碍不应机械连续翻转
- **探索反馈**：空中停留在安全天花板也是策略
- **建议有效时长**：45–115 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "世界 x 单位 px，player固定屏幕 x=112，障碍的世界x是首次进入场景的路标，不是生成时相机x；场景需换算 cameraOffset",
  "distanceToFinish": 2200,
  "scrollSpeedPxSec": 260,
  "gravity": 2100,
  "obstacles": [
    {
      "id": "o1",
      "x": 480,
      "side": "floor",
      "height": 160,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o2",
      "x": 890,
      "side": "floor",
      "height": 160,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o3",
      "x": 1430,
      "side": "ceiling",
      "height": 165,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o4",
      "x": 1880,
      "side": "ceiling",
      "height": 165,
      "width": 42,
      "telegraphLeadPx": 360
    }
  ],
  "recommendedFlipWindows": [
    {
      "xCenter": 220,
      "toward": "ceiling",
      "tolerancePx": 70
    },
    {
      "xCenter": 1100,
      "toward": "floor",
      "tolerancePx": 70
    }
  ],
  "bonusStars": [
    {
      "x": 1200,
      "y": 210,
      "required": false
    }
  ],
  "startGravity": "floor",
  "win": "pass finish marker alive",
  "collision": "lives=2; collision respawn at most recent safe segment, no auto-use shield"
}
```

- **参考通关方案**：

```json
{
  "flipWindows": [
    [
      220,
      "ceiling"
    ],
    [
      1100,
      "floor"
    ]
  ],
  "skill": "连续同侧障碍不应机械连续翻转"
}
```

**验收工单**：

1. **成功路径**：物理仿真至少存在一条可无伤通过的翻转时间序列，角度窗口允许手机响应
2. **失败路径**：在无道具前提下可通过；任一尖刺须满足可观察反应窗口
3. **移动端**：整个画布点击与空格一致，停顿后不会误触翻转
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：推荐翻转点是待物理验证的设计初值，不可把列表直接当成无碰撞证明

---

### C03 · 上下合奏

- **通关目标**：从起点通过全部固定尖刺并抵达终点
- **关卡决策**：先保持当前安全侧还是提前翻转
- **练习重点**：逐个观察交错障碍决定切换时间
- **探索反馈**：提前把路线留在另一侧而非临门一脚
- **建议有效时长**：45–115 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "世界 x 单位 px，player固定屏幕 x=112，障碍的世界x是首次进入场景的路标，不是生成时相机x；场景需换算 cameraOffset",
  "distanceToFinish": 2400,
  "scrollSpeedPxSec": 260,
  "gravity": 2100,
  "obstacles": [
    {
      "id": "o1",
      "x": 520,
      "side": "floor",
      "height": 162,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o2",
      "x": 1050,
      "side": "ceiling",
      "height": 162,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o3",
      "x": 1590,
      "side": "floor",
      "height": 170,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o4",
      "x": 2130,
      "side": "ceiling",
      "height": 170,
      "width": 42,
      "telegraphLeadPx": 360
    }
  ],
  "recommendedFlipWindows": [
    {
      "xCenter": 230,
      "toward": "ceiling",
      "tolerancePx": 70
    },
    {
      "xCenter": 740,
      "toward": "floor",
      "tolerancePx": 70
    },
    {
      "xCenter": 1280,
      "toward": "ceiling",
      "tolerancePx": 70
    },
    {
      "xCenter": 1830,
      "toward": "floor",
      "tolerancePx": 70
    }
  ],
  "bonusStars": [
    {
      "x": 1380,
      "y": 180,
      "required": false
    }
  ],
  "startGravity": "floor",
  "win": "pass finish marker alive",
  "collision": "lives=2; collision respawn at most recent safe segment, no auto-use shield"
}
```

- **参考通关方案**：

```json
{
  "flipWindows": [
    [
      230,
      "ceiling"
    ],
    [
      740,
      "floor"
    ],
    [
      1280,
      "ceiling"
    ],
    [
      1830,
      "floor"
    ]
  ],
  "skill": "逐个观察交错障碍决定切换时间"
}
```

**验收工单**：

1. **成功路径**：物理仿真至少存在一条可无伤通过的翻转时间序列，角度窗口允许手机响应
2. **失败路径**：在无道具前提下可通过；任一尖刺须满足可观察反应窗口
3. **移动端**：整个画布点击与空格一致，停顿后不会误触翻转
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：推荐翻转点是待物理验证的设计初值，不可把列表直接当成无碰撞证明

---

### C04 · 星之岔路

- **通关目标**：从起点通过全部固定尖刺并抵达终点
- **关卡决策**：先保持当前安全侧还是提前翻转
- **练习重点**：两颗星在中层，需要短暂翻转后再回归安全路线
- **探索反馈**：奖励是冒险而非必经
- **建议有效时长**：45–115 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "世界 x 单位 px，player固定屏幕 x=112，障碍的世界x是首次进入场景的路标，不是生成时相机x；场景需换算 cameraOffset",
  "distanceToFinish": 2340,
  "scrollSpeedPxSec": 260,
  "gravity": 2100,
  "obstacles": [
    {
      "id": "o1",
      "x": 500,
      "side": "floor",
      "height": 170,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o2",
      "x": 1030,
      "side": "ceiling",
      "height": 170,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o3",
      "x": 1550,
      "side": "floor",
      "height": 170,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o4",
      "x": 2070,
      "side": "ceiling",
      "height": 175,
      "width": 42,
      "telegraphLeadPx": 360
    }
  ],
  "recommendedFlipWindows": [
    {
      "xCenter": 220,
      "toward": "ceiling",
      "tolerancePx": 70
    },
    {
      "xCenter": 730,
      "toward": "floor",
      "tolerancePx": 70
    },
    {
      "xCenter": 1260,
      "toward": "ceiling",
      "tolerancePx": 70
    },
    {
      "xCenter": 1800,
      "toward": "floor",
      "tolerancePx": 70
    }
  ],
  "bonusStars": [
    {
      "x": 850,
      "y": 245,
      "required": false
    },
    {
      "x": 1390,
      "y": 410,
      "required": false
    }
  ],
  "startGravity": "floor",
  "win": "pass finish marker alive",
  "collision": "lives=2; collision respawn at most recent safe segment, no auto-use shield"
}
```

- **参考通关方案**：

```json
{
  "flipWindows": [
    [
      220,
      "ceiling"
    ],
    [
      730,
      "floor"
    ],
    [
      1260,
      "ceiling"
    ],
    [
      1800,
      "floor"
    ]
  ],
  "skill": "两颗星在中层，需要短暂翻转后再回归安全路线"
}
```

**验收工单**：

1. **成功路径**：物理仿真至少存在一条可无伤通过的翻转时间序列，角度窗口允许手机响应
2. **失败路径**：在无道具前提下可通过；任一尖刺须满足可观察反应窗口
3. **移动端**：整个画布点击与空格一致，停顿后不会误触翻转
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：推荐翻转点是待物理验证的设计初值，不可把列表直接当成无碰撞证明

---

### C05 · 双窄门

- **通关目标**：从起点通过全部固定尖刺并抵达终点
- **关卡决策**：先保持当前安全侧还是提前翻转
- **练习重点**：障碍高度明显增加但预告更早
- **探索反馈**：练习观察到行动的稳定延迟
- **建议有效时长**：45–115 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "世界 x 单位 px，player固定屏幕 x=112，障碍的世界x是首次进入场景的路标，不是生成时相机x；场景需换算 cameraOffset",
  "distanceToFinish": 2320,
  "scrollSpeedPxSec": 260,
  "gravity": 2100,
  "obstacles": [
    {
      "id": "o1",
      "x": 490,
      "side": "floor",
      "height": 190,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o2",
      "x": 990,
      "side": "ceiling",
      "height": 190,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o3",
      "x": 1510,
      "side": "floor",
      "height": 205,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o4",
      "x": 2050,
      "side": "ceiling",
      "height": 205,
      "width": 42,
      "telegraphLeadPx": 360
    }
  ],
  "recommendedFlipWindows": [
    {
      "xCenter": 210,
      "toward": "ceiling",
      "tolerancePx": 70
    },
    {
      "xCenter": 690,
      "toward": "floor",
      "tolerancePx": 70
    },
    {
      "xCenter": 1220,
      "toward": "ceiling",
      "tolerancePx": 70
    },
    {
      "xCenter": 1740,
      "toward": "floor",
      "tolerancePx": 70
    }
  ],
  "bonusStars": [],
  "startGravity": "floor",
  "win": "pass finish marker alive",
  "collision": "lives=2; collision respawn at most recent safe segment, no auto-use shield"
}
```

- **参考通关方案**：

```json
{
  "flipWindows": [
    [
      210,
      "ceiling"
    ],
    [
      690,
      "floor"
    ],
    [
      1220,
      "ceiling"
    ],
    [
      1740,
      "floor"
    ]
  ],
  "skill": "障碍高度明显增加但预告更早"
}
```

**验收工单**：

1. **成功路径**：物理仿真至少存在一条可无伤通过的翻转时间序列，角度窗口允许手机响应
2. **失败路径**：在无道具前提下可通过；任一尖刺须满足可观察反应窗口
3. **移动端**：整个画布点击与空格一致，停顿后不会误触翻转
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：推荐翻转点是待物理验证的设计初值，不可把列表直接当成无碰撞证明

---

### C06 · 重力终章

- **通关目标**：从起点通过全部固定尖刺并抵达终点
- **关卡决策**：先保持当前安全侧还是提前翻转
- **练习重点**：交错障碍+一次中间奖励路线选择
- **探索反馈**：目标是完成清晰的动作序列，不靠纯随机
- **建议有效时长**：45–115 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "世界 x 单位 px，player固定屏幕 x=112，障碍的世界x是首次进入场景的路标，不是生成时相机x；场景需换算 cameraOffset",
  "distanceToFinish": 2530,
  "scrollSpeedPxSec": 260,
  "gravity": 2100,
  "obstacles": [
    {
      "id": "o1",
      "x": 500,
      "side": "floor",
      "height": 155,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o2",
      "x": 940,
      "side": "ceiling",
      "height": 165,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o3",
      "x": 1370,
      "side": "floor",
      "height": 165,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o4",
      "x": 1810,
      "side": "ceiling",
      "height": 185,
      "width": 42,
      "telegraphLeadPx": 360
    },
    {
      "id": "o5",
      "x": 2260,
      "side": "floor",
      "height": 195,
      "width": 42,
      "telegraphLeadPx": 360
    }
  ],
  "recommendedFlipWindows": [
    {
      "xCenter": 210,
      "toward": "ceiling",
      "tolerancePx": 70
    },
    {
      "xCenter": 650,
      "toward": "floor",
      "tolerancePx": 70
    },
    {
      "xCenter": 1090,
      "toward": "ceiling",
      "tolerancePx": 70
    },
    {
      "xCenter": 1520,
      "toward": "floor",
      "tolerancePx": 70
    },
    {
      "xCenter": 1960,
      "toward": "ceiling",
      "tolerancePx": 70
    }
  ],
  "bonusStars": [
    {
      "x": 730,
      "y": 270,
      "required": false
    },
    {
      "x": 1600,
      "y": 380,
      "required": false
    }
  ],
  "startGravity": "floor",
  "win": "pass finish marker alive",
  "collision": "lives=2; collision respawn at most recent safe segment, no auto-use shield"
}
```

- **参考通关方案**：

```json
{
  "flipWindows": [
    [
      210,
      "ceiling"
    ],
    [
      650,
      "floor"
    ],
    [
      1090,
      "ceiling"
    ],
    [
      1520,
      "floor"
    ],
    [
      1960,
      "ceiling"
    ]
  ],
  "skill": "交错障碍+一次中间奖励路线选择"
}
```

**验收工单**：

1. **成功路径**：物理仿真至少存在一条可无伤通过的翻转时间序列，角度窗口允许手机响应
2. **失败路径**：在无道具前提下可通过；任一尖刺须满足可观察反应窗口
3. **移动端**：整个画布点击与空格一致，停顿后不会误触翻转
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：推荐翻转点是待物理验证的设计初值，不可把列表直接当成无碰撞证明

---

