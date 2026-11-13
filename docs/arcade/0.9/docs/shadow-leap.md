# 影跃｜6 关可实施蓝图

- 游戏 ID：`shadow-leap`；当前公开主干对应文件：`apps/arcade/games/shadow-leap.html`
- 数据源：`../levels/shadow-leap.json`，每关单文件在 `../levels/stages/shadow-leap-Cxx.json`
- 实施对象：独立 challenge mode，经典模式原样保留；关卡表达：平台位点/世界高度
- 状态：策划版，已运行静态校验；未经过当前引擎物理模拟和真机测试。

## 章节总览

| # | 关卡 | 目标 | 技巧 | 发现 |
|---:|---|---|---|---|
| 1 | 初入影林 | 抵达高度402的影门 | 观察惯性并提前对准落点 | 右侧银树标记提示有可选卷轴 |
| 2 | 月下断桥 | 通过移动桥与易碎桥后抵达影门 | 等待移动相位，易碎平台起跳前预留方向 | 两条路径不同步且都能到终点 |
| 3 | 影冲试炼 | 用至少一次影冲越过月蚀裂隙 | 起跳后蓄势，空中定向影冲，落地刷新 | 左端石碑明确标示冲刺仅落地恢复 |
| 4 | 风之回廊 | 在两段风口中抵达高门 | 提前看风向旗、对冲时机作选择 | 壁画揭示风向每次固定，不做随机风 |
| 5 | 双影岔路 | 任选一条主路线抵达分岔山门 | 读地图构图决定风险与步数 | 在左下角的发光纹样发现门钥匙线索 |
| 6 | 月门守卫 | 集齐两座房间开关后抵达最终影门 | 连续预判相位、冲刺与保留检查点 | 两个半月雕像需要被亲自触碰，不能隔空触发 |

## 逐关详细规格

### C01 · 初入影林

- **通关目标**：抵达高度402的影门
- **关卡决策**：走中路稳妥通关或偏右获取卷轴
- **练习重点**：观察惯性并提前对准落点
- **探索反馈**：右侧银树标记提示有可选卷轴
- **建议有效时长**：45–155 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420×740逻辑像素；平台 xCenter 与 height 均为世界坐标；height=0为出发平台，向上为正；禁止按屏幕坐标硬编码",
  "playerSpawn": {
    "platformId": "p0",
    "offsetX": 0
  },
  "platforms": [
    {
      "id": "p0",
      "xCenter": 210,
      "height": 0,
      "width": 120,
      "kind": "static"
    },
    {
      "id": "p1",
      "xCenter": 184,
      "height": 70,
      "width": 110,
      "kind": "static"
    },
    {
      "id": "p2",
      "xCenter": 228,
      "height": 142,
      "width": 96,
      "kind": "static"
    },
    {
      "id": "p3",
      "xCenter": 183,
      "height": 214,
      "width": 106,
      "kind": "static"
    },
    {
      "id": "p4",
      "xCenter": 236,
      "height": 286,
      "width": 98,
      "kind": "static"
    },
    {
      "id": "p5",
      "xCenter": 205,
      "height": 358,
      "width": 110,
      "kind": "static"
    },
    {
      "id": "secret",
      "xCenter": 326,
      "height": 203,
      "width": 70,
      "kind": "static"
    }
  ],
  "mainRoute": [
    "p0",
    "p1",
    "p2",
    "p3",
    "p4",
    "p5"
  ],
  "alternativeRoute": [
    "p2",
    "secret",
    "p4"
  ],
  "goal": {
    "type": "gate",
    "xCenter": 210,
    "height": 402,
    "radius": 38
  },
  "requiredAbility": "none",
  "stageRule": "side-scroll",
  "collectibles": [
    {
      "id": "scroll",
      "platformId": "secret",
      "optional": true
    }
  ],
  "deathPolicy": "落出关卡边界后从最近房间检查点重试，关卡任务不回退"
}
```

- **参考通关方案**：

```json
{
  "main": [
    "p0",
    "p1",
    "p2",
    "p3",
    "p4",
    "p5"
  ],
  "optional": [
    "p2",
    "secret",
    "p4"
  ],
  "tactics": "不使用影冲也可完成；偏右卷轴不参与通关"
}
```

**验收工单**：

1. **成功路径**：主路径 ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'] 能在允许动作集下连贯落地并触发出口
2. **失败路径**：无影冲前两关必须可解；S3 起必需动作与奖励路线独立；死亡返回关内检查点
3. **移动端**：左右持续按压与影冲按钮支持两指并发，屏幕边缘影冲按钮≥44CSS px
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：不使用影冲也可完成；偏右卷轴不参与通关

---

### C02 · 月下断桥

- **通关目标**：通过移动桥与易碎桥后抵达影门
- **关卡决策**：移动桥短路 vs 宽静态平台绕行
- **练习重点**：等待移动相位，易碎平台起跳前预留方向
- **探索反馈**：两条路径不同步且都能到终点
- **建议有效时长**：45–155 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420×740逻辑像素；平台 xCenter 与 height 均为世界坐标；height=0为出发平台，向上为正；禁止按屏幕坐标硬编码",
  "playerSpawn": {
    "platformId": "p0",
    "offsetX": 0
  },
  "platforms": [
    {
      "id": "p0",
      "xCenter": 205,
      "height": 0,
      "width": 120,
      "kind": "static"
    },
    {
      "id": "p1",
      "xCenter": 171,
      "height": 72,
      "width": 103,
      "kind": "moving",
      "amplitude": 18,
      "periodSec": 3.0,
      "phase": 0
    },
    {
      "id": "p2",
      "xCenter": 267,
      "height": 146,
      "width": 85,
      "kind": "fragile",
      "breakDelaySec": 0.65
    },
    {
      "id": "p3",
      "xCenter": 239,
      "height": 219,
      "width": 94,
      "kind": "moving",
      "amplitude": 22,
      "periodSec": 2.6,
      "phase": 1.57
    },
    {
      "id": "p4",
      "xCenter": 165,
      "height": 291,
      "width": 100,
      "kind": "static"
    },
    {
      "id": "p5",
      "xCenter": 214,
      "height": 363,
      "width": 105,
      "kind": "static"
    },
    {
      "id": "q2",
      "xCenter": 92,
      "height": 149,
      "width": 93,
      "kind": "static"
    },
    {
      "id": "q3",
      "xCenter": 106,
      "height": 221,
      "width": 95,
      "kind": "static"
    }
  ],
  "mainRoute": [
    "p0",
    "p1",
    "p2",
    "p3",
    "p4",
    "p5"
  ],
  "alternativeRoute": [
    "p1",
    "q2",
    "q3",
    "p4"
  ],
  "goal": {
    "type": "gate",
    "xCenter": 210,
    "height": 405,
    "radius": 38
  },
  "requiredAbility": "none",
  "stageRule": "fork",
  "collectibles": [],
  "deathPolicy": "落出关卡边界后从最近房间检查点重试，关卡任务不回退"
}
```

- **参考通关方案**：

```json
{
  "main": [
    "p0",
    "p1",
    "p2",
    "p3",
    "p4",
    "p5"
  ],
  "optional": [
    "p1",
    "q2",
    "q3",
    "p4"
  ],
  "tactics": "易碎平台在脚下有0.65秒醒目裂纹提示，不能无预警坍塌"
}
```

**验收工单**：

1. **成功路径**：主路径 ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'] 能在允许动作集下连贯落地并触发出口
2. **失败路径**：无影冲前两关必须可解；S3 起必需动作与奖励路线独立；死亡返回关内检查点
3. **移动端**：左右持续按压与影冲按钮支持两指并发，屏幕边缘影冲按钮≥44CSS px
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：易碎平台在脚下有0.65秒醒目裂纹提示，不能无预警坍塌

---

### C03 · 影冲试炼

- **通关目标**：用至少一次影冲越过月蚀裂隙
- **关卡决策**：保留影冲以越过横向大缺口；卷轴奖励需额外精度
- **练习重点**：起跳后蓄势，空中定向影冲，落地刷新
- **探索反馈**：左端石碑明确标示冲刺仅落地恢复
- **建议有效时长**：45–155 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420×740逻辑像素；平台 xCenter 与 height 均为世界坐标；height=0为出发平台，向上为正；禁止按屏幕坐标硬编码",
  "playerSpawn": {
    "platformId": "p0",
    "offsetX": 0
  },
  "platforms": [
    {
      "id": "p0",
      "xCenter": 110,
      "height": 0,
      "width": 118,
      "kind": "static"
    },
    {
      "id": "p1",
      "xCenter": 66,
      "height": 78,
      "width": 76,
      "kind": "static"
    },
    {
      "id": "p2",
      "xCenter": 365,
      "height": 155,
      "width": 76,
      "kind": "static"
    },
    {
      "id": "p3",
      "xCenter": 285,
      "height": 234,
      "width": 99,
      "kind": "static"
    },
    {
      "id": "p4",
      "xCenter": 191,
      "height": 310,
      "width": 103,
      "kind": "static"
    },
    {
      "id": "p5",
      "xCenter": 225,
      "height": 386,
      "width": 98,
      "kind": "static"
    },
    {
      "id": "secret",
      "xCenter": 349,
      "height": 264,
      "width": 66,
      "kind": "static"
    }
  ],
  "mainRoute": [
    "p0",
    "p1",
    "p2",
    "p3",
    "p4",
    "p5"
  ],
  "alternativeRoute": [
    "p2",
    "secret",
    "p3"
  ],
  "goal": {
    "type": "gate",
    "xCenter": 225,
    "height": 428,
    "radius": 38
  },
  "requiredAbility": "dash",
  "stageRule": "gap",
  "collectibles": [
    {
      "id": "scroll",
      "platformId": "secret",
      "optional": true
    }
  ],
  "deathPolicy": "落出关卡边界后从最近房间检查点重试，关卡任务不回退"
}
```

- **参考通关方案**：

```json
{
  "main": [
    "p0",
    "p1",
    "p2",
    "p3",
    "p4",
    "p5"
  ],
  "optional": [
    "p2",
    "secret",
    "p3"
  ],
  "tactics": "平台 p1→p2 需以真实轨迹证明无影冲不可达、有影冲可达；若达不到，必须调整间距并保留测试"
}
```

**验收工单**：

1. **成功路径**：主路径 ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'] 能在允许动作集下连贯落地并触发出口
2. **失败路径**：无影冲前两关必须可解；S3 起必需动作与奖励路线独立；死亡返回关内检查点
3. **移动端**：左右持续按压与影冲按钮支持两指并发，屏幕边缘影冲按钮≥44CSS px
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：平台 p1→p2 需以真实轨迹证明无影冲不可达、有影冲可达；若达不到，必须调整间距并保留测试

---

### C04 · 风之回廊

- **通关目标**：在两段风口中抵达高门
- **关卡决策**：逆风短路要精确影冲，背风外圈更稳定
- **练习重点**：提前看风向旗、对冲时机作选择
- **探索反馈**：壁画揭示风向每次固定，不做随机风
- **建议有效时长**：45–155 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420×740逻辑像素；平台 xCenter 与 height 均为世界坐标；height=0为出发平台，向上为正；禁止按屏幕坐标硬编码",
  "playerSpawn": {
    "platformId": "p0",
    "offsetX": 0
  },
  "platforms": [
    {
      "id": "p0",
      "xCenter": 202,
      "height": 0,
      "width": 119,
      "kind": "static"
    },
    {
      "id": "p1",
      "xCenter": 253,
      "height": 76,
      "width": 105,
      "kind": "static"
    },
    {
      "id": "p2",
      "xCenter": 322,
      "height": 152,
      "width": 86,
      "kind": "moving",
      "amplitude": 14,
      "periodSec": 3.2,
      "phase": 0
    },
    {
      "id": "p3",
      "xCenter": 244,
      "height": 230,
      "width": 92,
      "kind": "static"
    },
    {
      "id": "p4",
      "xCenter": 159,
      "height": 309,
      "width": 100,
      "kind": "static"
    },
    {
      "id": "p5",
      "xCenter": 220,
      "height": 390,
      "width": 102,
      "kind": "static"
    },
    {
      "id": "q2",
      "xCenter": 170,
      "height": 151,
      "width": 92,
      "kind": "static"
    },
    {
      "id": "q3",
      "xCenter": 135,
      "height": 231,
      "width": 98,
      "kind": "static"
    }
  ],
  "mainRoute": [
    "p0",
    "p1",
    "p2",
    "p3",
    "p4",
    "p5"
  ],
  "alternativeRoute": [
    "p1",
    "q2",
    "q3",
    "p4"
  ],
  "goal": {
    "type": "gate",
    "xCenter": 210,
    "height": 431,
    "radius": 38
  },
  "requiredAbility": "dash",
  "stageRule": "wind",
  "collectibles": [],
  "deathPolicy": "落出关卡边界后从最近房间检查点重试，关卡任务不回退",
  "winds": [
    {
      "heightFrom": 110,
      "heightTo": 230,
      "forceX": -65,
      "telegraph": "旗子+粒子"
    }
  ]
}
```

- **参考通关方案**：

```json
{
  "main": [
    "p0",
    "p1",
    "p2",
    "p3",
    "p4",
    "p5"
  ],
  "optional": [
    "p1",
    "q2",
    "q3",
    "p4"
  ],
  "tactics": "风区域 height=[115,225] 加速度按 x 方向±65px/s²；风矢量始终可视"
}
```

**验收工单**：

1. **成功路径**：主路径 ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'] 能在允许动作集下连贯落地并触发出口
2. **失败路径**：无影冲前两关必须可解；S3 起必需动作与奖励路线独立；死亡返回关内检查点
3. **移动端**：左右持续按压与影冲按钮支持两指并发，屏幕边缘影冲按钮≥44CSS px
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：风区域 height=[115,225] 加速度按 x 方向±65px/s²；风矢量始终可视

---

### C05 · 双影岔路

- **通关目标**：任选一条主路线抵达分岔山门
- **关卡决策**：右侧影冲捷径节省两跳；左侧宽平台收集线索
- **练习重点**：读地图构图决定风险与步数
- **探索反馈**：在左下角的发光纹样发现门钥匙线索
- **建议有效时长**：45–155 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420×740逻辑像素；平台 xCenter 与 height 均为世界坐标；height=0为出发平台，向上为正；禁止按屏幕坐标硬编码",
  "playerSpawn": {
    "platformId": "p0",
    "offsetX": 0
  },
  "platforms": [
    {
      "id": "p0",
      "xCenter": 205,
      "height": 0,
      "width": 120,
      "kind": "static"
    },
    {
      "id": "p1",
      "xCenter": 182,
      "height": 77,
      "width": 100,
      "kind": "static"
    },
    {
      "id": "l2",
      "xCenter": 102,
      "height": 153,
      "width": 98,
      "kind": "static"
    },
    {
      "id": "l3",
      "xCenter": 121,
      "height": 229,
      "width": 94,
      "kind": "static"
    },
    {
      "id": "l4",
      "xCenter": 179,
      "height": 305,
      "width": 99,
      "kind": "static"
    },
    {
      "id": "r2",
      "xCenter": 357,
      "height": 153,
      "width": 78,
      "kind": "static"
    },
    {
      "id": "r3",
      "xCenter": 336,
      "height": 231,
      "width": 78,
      "kind": "fragile",
      "breakDelaySec": 0.7
    },
    {
      "id": "r4",
      "xCenter": 293,
      "height": 307,
      "width": 86,
      "kind": "static"
    },
    {
      "id": "p5",
      "xCenter": 239,
      "height": 382,
      "width": 102,
      "kind": "static"
    },
    {
      "id": "secret",
      "xCenter": 92,
      "height": 273,
      "width": 72,
      "kind": "static"
    }
  ],
  "mainRoute": [
    "p0",
    "p1",
    "l2",
    "l3",
    "l4",
    "p5"
  ],
  "alternativeRoute": [
    "p1",
    "r2",
    "r3",
    "r4",
    "p5"
  ],
  "goal": {
    "type": "gate",
    "xCenter": 210,
    "height": 425,
    "radius": 38
  },
  "requiredAbility": "dash",
  "stageRule": "fork",
  "collectibles": [
    {
      "id": "scroll",
      "platformId": "secret",
      "optional": true
    }
  ],
  "deathPolicy": "落出关卡边界后从最近房间检查点重试，关卡任务不回退"
}
```

- **参考通关方案**：

```json
{
  "main": [
    "p0",
    "p1",
    "l2",
    "l3",
    "l4",
    "p5"
  ],
  "optional": [
    "p1",
    "r2",
    "r3",
    "r4",
    "p5"
  ],
  "tactics": "影冲短路与主线都能通关；卷轴仅影响收藏记录，不影响解锁"
}
```

**验收工单**：

1. **成功路径**：主路径 ['p0', 'p1', 'l2', 'l3', 'l4', 'p5'] 能在允许动作集下连贯落地并触发出口
2. **失败路径**：无影冲前两关必须可解；S3 起必需动作与奖励路线独立；死亡返回关内检查点
3. **移动端**：左右持续按压与影冲按钮支持两指并发，屏幕边缘影冲按钮≥44CSS px
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：影冲短路与主线都能通关；卷轴仅影响收藏记录，不影响解锁

---

### C06 · 月门守卫

- **通关目标**：集齐两座房间开关后抵达最终影门
- **关卡决策**：先左开关还是右开关自由，回中央安全平台调整
- **练习重点**：连续预判相位、冲刺与保留检查点
- **探索反馈**：两个半月雕像需要被亲自触碰，不能隔空触发
- **建议有效时长**：45–155 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420×740逻辑像素；平台 xCenter 与 height 均为世界坐标；height=0为出发平台，向上为正；禁止按屏幕坐标硬编码",
  "playerSpawn": {
    "platformId": "p0",
    "offsetX": 0
  },
  "platforms": [
    {
      "id": "p0",
      "xCenter": 210,
      "height": 0,
      "width": 120,
      "kind": "static"
    },
    {
      "id": "p1",
      "xCenter": 210,
      "height": 82,
      "width": 105,
      "kind": "static"
    },
    {
      "id": "left-switch",
      "xCenter": 95,
      "height": 157,
      "width": 94,
      "kind": "moving",
      "amplitude": 13,
      "periodSec": 3.4,
      "phase": 0
    },
    {
      "id": "right-switch",
      "xCenter": 326,
      "height": 159,
      "width": 96,
      "kind": "moving",
      "amplitude": 13,
      "periodSec": 3.4,
      "phase": 3.14
    },
    {
      "id": "center",
      "xCenter": 210,
      "height": 233,
      "width": 119,
      "kind": "static"
    },
    {
      "id": "upper",
      "xCenter": 253,
      "height": 312,
      "width": 95,
      "kind": "fragile",
      "breakDelaySec": 0.8
    },
    {
      "id": "p6",
      "xCenter": 210,
      "height": 390,
      "width": 115,
      "kind": "static"
    }
  ],
  "mainRoute": [
    "p0",
    "p1",
    "left-switch",
    "center",
    "right-switch",
    "center",
    "upper",
    "p6"
  ],
  "alternativeRoute": [
    "p1",
    "right-switch",
    "center",
    "left-switch",
    "center",
    "upper",
    "p6"
  ],
  "goal": {
    "type": "gate",
    "xCenter": 210,
    "height": 435,
    "radius": 38,
    "unlock": "all-switches"
  },
  "requiredAbility": "dash",
  "stageRule": "two-switch",
  "collectibles": [],
  "deathPolicy": "落出关卡边界后从最近房间检查点重试，关卡任务不回退",
  "switches": [
    {
      "platformId": "left-switch",
      "persistentWithinAttempt": true
    },
    {
      "platformId": "right-switch",
      "persistentWithinAttempt": true
    }
  ]
}
```

- **参考通关方案**：

```json
{
  "main": [
    "p0",
    "p1",
    "left-switch",
    "center",
    "right-switch",
    "center",
    "upper",
    "p6"
  ],
  "optional": [
    "p1",
    "right-switch",
    "center",
    "left-switch",
    "center",
    "upper",
    "p6"
  ],
  "tactics": "开关触发顺序不限；回中心平台不会重置开关；死亡从房间检查点重试"
}
```

**验收工单**：

1. **成功路径**：主路径 ['p0', 'p1', 'left-switch', 'center', 'right-switch', 'center', 'upper', 'p6'] 能在允许动作集下连贯落地并触发出口
2. **失败路径**：无影冲前两关必须可解；S3 起必需动作与奖励路线独立；死亡返回关内检查点
3. **移动端**：左右持续按压与影冲按钮支持两指并发，屏幕边缘影冲按钮≥44CSS px
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：开关触发顺序不限；回中心平台不会重置开关；死亡从房间检查点重试

---

