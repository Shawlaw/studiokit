# 星海突击｜6 关可实施蓝图

- 游戏 ID：`star-raid`；当前公开主干对应文件：`apps/arcade/games/star-raid.html`
- 数据源：`../levels/star-raid.json`，每关单文件在 `../levels/stages/star-raid-Cxx.json`
- 实施对象：独立 challenge mode，经典模式原样保留；关卡表达：敌人事件/安全带
- 状态：策划版，已运行静态校验；未经过当前引擎物理模拟和真机测试。

## 章节总览

| # | 关卡 | 目标 | 技巧 | 发现 |
|---:|---|---|---|---|
| 1 | 护航第一课 | 击落全部目标/撑到结束标记 | 观察三发扇弹留下的通道 | 安全走位和清怪都能达成任务 |
| 2 | 扫射之门 | 通过五段标记扫射 | 认清连续扫射方向并先移动到安全侧 | 拿激光需穿越中央区域，非必需 |
| 3 | 冲锋预警 | 无碰撞完成冲锋训练 | 先观察冲锋目标线，预警结束才移动 | 冲锋失败时要知道自己是否在预警区域 |
| 4 | 拾取抉择 | 无道具存活并通过结束门 | 危险边缘的拾取物与安全通路形成不同收益 | 不拾取也可完成，拾取可提高局内评价 |
| 5 | 护盾与弱点 | 击败双弱点 Boss | Boss 左右暴露弱点，阶段间有喘息 | 判断是否先清小敌还是抢 Boss 输出窗口 |
| 6 | 星域毕业战 | 击败两阶段 Boss | 先躲确定性弹幕再利用核心暴露窗口 | Boss 第二阶段发射扇弹时安全带移动 |

## 逐关详细规格

### C01 · 护航第一课

- **通关目标**：击落全部目标/撑到结束标记
- **关卡决策**：继续待在安全带还是穿越危险区取武器
- **练习重点**：观察三发扇弹留下的通道
- **探索反馈**：安全走位和清怪都能达成任务
- **建议有效时长**：35–70 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "stageDurationSec": 35,
  "playerSpawn": {
    "xRatio": 0.5,
    "yRatio": 0.85
  },
  "startingHealth": 3,
  "events": [
    {
      "id": "w1",
      "atSec": 3,
      "enemyType": "scout",
      "spawnXRatio": 0.22,
      "attackPattern": "single",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.64,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 5.2
    },
    {
      "id": "w2",
      "atSec": 8,
      "enemyType": "scout",
      "spawnXRatio": 0.78,
      "attackPattern": "single",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.2,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 10.2
    },
    {
      "id": "w3",
      "atSec": 14,
      "enemyType": "pair",
      "spawnXRatio": 0.5,
      "attackPattern": "fan3",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.05,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 16.2
    },
    {
      "id": "w4",
      "atSec": 21,
      "enemyType": "scout",
      "spawnXRatio": 0.2,
      "attackPattern": "aimed",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.75,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 23.2
    },
    {
      "id": "w5",
      "atSec": 27,
      "enemyType": "pair",
      "spawnXRatio": 0.64,
      "attackPattern": "fan3",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.15,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 29.2
    }
  ],
  "powerups": [
    {
      "atSec": 16,
      "kind": "spread",
      "xRatio": 0.8,
      "required": false
    }
  ],
  "endCondition": "survive-and-clear-events",
  "patternContract": {
    "single": "向下单发，瞄准当前位置后锁定",
    "aimed": "预警瞄准后单发",
    "fan3": "三个固定发散角-22/0/+22度",
    "fan5": "五个固定发散角-32/-16/0/+16/+32度",
    "sweep-lr": "左向右扫描危险带，预先显示扫线",
    "sweep-rl": "右向左扫描危险带，预先显示扫线",
    "mark-charge": "标线1.4秒后沿直线冲锋，标线期间锁定落点",
    "weak-left-right": "先左翼2.5s后右翼2.5s，重复至弱点耗尽",
    "phase-sweep-and-core": "第1阶段扫线，第2阶段中央核心暴露3s，循环"
  },
  "bulletSafeSpace": "所有攻击段至少保留一条玩家可达≥56逻辑px宽的安全走廊，待模拟验证"
}
```

- **参考通关方案**：

```json
{
  "events": [
    "w1",
    "w2",
    "w3",
    "w4",
    "w5"
  ],
  "plan": "读取预警线，移向 safeBandXRatio，Boss 露弱点后再进攻"
}
```

**验收工单**：

1. **成功路径**：定时事件不依赖Math.random且预警与伤害开始时间可复测
2. **失败路径**：弹幕演算留出可达安全区；阶段目标可在基础武器下完成
3. **移动端**：按住拖动+技能点击两指并发，子弹/弱点在小屏可辨
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C02 · 扫射之门

- **通关目标**：通过五段标记扫射
- **关卡决策**：继续待在安全带还是穿越危险区取武器
- **练习重点**：认清连续扫射方向并先移动到安全侧
- **探索反馈**：拿激光需穿越中央区域，非必需
- **建议有效时长**：42–77 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "stageDurationSec": 42,
  "playerSpawn": {
    "xRatio": 0.5,
    "yRatio": 0.85
  },
  "startingHealth": 3,
  "events": [
    {
      "id": "w1",
      "atSec": 3,
      "enemyType": "sweeper",
      "spawnXRatio": 0.25,
      "attackPattern": "sweep-lr",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.8,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 5.2
    },
    {
      "id": "w2",
      "atSec": 10,
      "enemyType": "scout",
      "spawnXRatio": 0.8,
      "attackPattern": "aimed",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.1,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 12.2
    },
    {
      "id": "w3",
      "atSec": 18,
      "enemyType": "sweeper",
      "spawnXRatio": 0.75,
      "attackPattern": "sweep-rl",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.12,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 20.2
    },
    {
      "id": "w4",
      "atSec": 27,
      "enemyType": "pair",
      "spawnXRatio": 0.48,
      "attackPattern": "fan3",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.08,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 29.2
    },
    {
      "id": "w5",
      "atSec": 34,
      "enemyType": "sweeper",
      "spawnXRatio": 0.3,
      "attackPattern": "sweep-lr",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.82,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 36.2
    }
  ],
  "powerups": [
    {
      "atSec": 18,
      "kind": "laser",
      "xRatio": 0.5,
      "required": false
    }
  ],
  "endCondition": "survive-and-clear-events",
  "patternContract": {
    "single": "向下单发，瞄准当前位置后锁定",
    "aimed": "预警瞄准后单发",
    "fan3": "三个固定发散角-22/0/+22度",
    "fan5": "五个固定发散角-32/-16/0/+16/+32度",
    "sweep-lr": "左向右扫描危险带，预先显示扫线",
    "sweep-rl": "右向左扫描危险带，预先显示扫线",
    "mark-charge": "标线1.4秒后沿直线冲锋，标线期间锁定落点",
    "weak-left-right": "先左翼2.5s后右翼2.5s，重复至弱点耗尽",
    "phase-sweep-and-core": "第1阶段扫线，第2阶段中央核心暴露3s，循环"
  },
  "bulletSafeSpace": "所有攻击段至少保留一条玩家可达≥56逻辑px宽的安全走廊，待模拟验证"
}
```

- **参考通关方案**：

```json
{
  "events": [
    "w1",
    "w2",
    "w3",
    "w4",
    "w5"
  ],
  "plan": "读取预警线，移向 safeBandXRatio，Boss 露弱点后再进攻"
}
```

**验收工单**：

1. **成功路径**：定时事件不依赖Math.random且预警与伤害开始时间可复测
2. **失败路径**：弹幕演算留出可达安全区；阶段目标可在基础武器下完成
3. **移动端**：按住拖动+技能点击两指并发，子弹/弱点在小屏可辨
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C03 · 冲锋预警

- **通关目标**：无碰撞完成冲锋训练
- **关卡决策**：继续待在安全带还是穿越危险区取武器
- **练习重点**：先观察冲锋目标线，预警结束才移动
- **探索反馈**：冲锋失败时要知道自己是否在预警区域
- **建议有效时长**：46–81 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "stageDurationSec": 46,
  "playerSpawn": {
    "xRatio": 0.5,
    "yRatio": 0.85
  },
  "startingHealth": 3,
  "events": [
    {
      "id": "w1",
      "atSec": 4,
      "enemyType": "charger",
      "spawnXRatio": 0.25,
      "attackPattern": "mark-charge",
      "telegraphSec": 1.4,
      "safeBandXRatio": {
        "center": 0.75,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 6.2
    },
    {
      "id": "w2",
      "atSec": 12,
      "enemyType": "charger",
      "spawnXRatio": 0.75,
      "attackPattern": "mark-charge",
      "telegraphSec": 1.4,
      "safeBandXRatio": {
        "center": 0.25,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 14.2
    },
    {
      "id": "w3",
      "atSec": 20,
      "enemyType": "pair",
      "spawnXRatio": 0.52,
      "attackPattern": "fan5",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.1,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 22.2
    },
    {
      "id": "w4",
      "atSec": 29,
      "enemyType": "charger",
      "spawnXRatio": 0.5,
      "attackPattern": "mark-charge",
      "telegraphSec": 1.4,
      "safeBandXRatio": {
        "center": 0.85,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 31.2
    },
    {
      "id": "w5",
      "atSec": 38,
      "enemyType": "scout",
      "spawnXRatio": 0.7,
      "attackPattern": "aimed",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.15,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 40.2
    }
  ],
  "powerups": [
    {
      "atSec": 22,
      "kind": "homing",
      "xRatio": 0.7,
      "required": false
    }
  ],
  "endCondition": "survive-and-clear-events",
  "patternContract": {
    "single": "向下单发，瞄准当前位置后锁定",
    "aimed": "预警瞄准后单发",
    "fan3": "三个固定发散角-22/0/+22度",
    "fan5": "五个固定发散角-32/-16/0/+16/+32度",
    "sweep-lr": "左向右扫描危险带，预先显示扫线",
    "sweep-rl": "右向左扫描危险带，预先显示扫线",
    "mark-charge": "标线1.4秒后沿直线冲锋，标线期间锁定落点",
    "weak-left-right": "先左翼2.5s后右翼2.5s，重复至弱点耗尽",
    "phase-sweep-and-core": "第1阶段扫线，第2阶段中央核心暴露3s，循环"
  },
  "bulletSafeSpace": "所有攻击段至少保留一条玩家可达≥56逻辑px宽的安全走廊，待模拟验证"
}
```

- **参考通关方案**：

```json
{
  "events": [
    "w1",
    "w2",
    "w3",
    "w4",
    "w5"
  ],
  "plan": "读取预警线，移向 safeBandXRatio，Boss 露弱点后再进攻"
}
```

**验收工单**：

1. **成功路径**：定时事件不依赖Math.random且预警与伤害开始时间可复测
2. **失败路径**：弹幕演算留出可达安全区；阶段目标可在基础武器下完成
3. **移动端**：按住拖动+技能点击两指并发，子弹/弱点在小屏可辨
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C04 · 拾取抉择

- **通关目标**：无道具存活并通过结束门
- **关卡决策**：继续待在安全带还是穿越危险区取武器
- **练习重点**：危险边缘的拾取物与安全通路形成不同收益
- **探索反馈**：不拾取也可完成，拾取可提高局内评价
- **建议有效时长**：48–83 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "stageDurationSec": 48,
  "playerSpawn": {
    "xRatio": 0.5,
    "yRatio": 0.85
  },
  "startingHealth": 3,
  "events": [
    {
      "id": "w1",
      "atSec": 4,
      "enemyType": "pair",
      "spawnXRatio": 0.38,
      "attackPattern": "fan3",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.87,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 6.2
    },
    {
      "id": "w2",
      "atSec": 11,
      "enemyType": "sweeper",
      "spawnXRatio": 0.76,
      "attackPattern": "sweep-rl",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.1,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 13.2
    },
    {
      "id": "w3",
      "atSec": 19,
      "enemyType": "pair",
      "spawnXRatio": 0.44,
      "attackPattern": "fan5",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.15,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 21.2
    },
    {
      "id": "w4",
      "atSec": 28,
      "enemyType": "charger",
      "spawnXRatio": 0.24,
      "attackPattern": "mark-charge",
      "telegraphSec": 1.4,
      "safeBandXRatio": {
        "center": 0.75,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 30.2
    },
    {
      "id": "w5",
      "atSec": 37,
      "enemyType": "sweeper",
      "spawnXRatio": 0.5,
      "attackPattern": "sweep-lr",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.9,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 39.2
    }
  ],
  "powerups": [
    {
      "atSec": 9,
      "kind": "rapid",
      "xRatio": 0.8,
      "required": false
    },
    {
      "atSec": 30,
      "kind": "laser",
      "xRatio": 0.2,
      "required": false
    }
  ],
  "endCondition": "survive-and-clear-events",
  "patternContract": {
    "single": "向下单发，瞄准当前位置后锁定",
    "aimed": "预警瞄准后单发",
    "fan3": "三个固定发散角-22/0/+22度",
    "fan5": "五个固定发散角-32/-16/0/+16/+32度",
    "sweep-lr": "左向右扫描危险带，预先显示扫线",
    "sweep-rl": "右向左扫描危险带，预先显示扫线",
    "mark-charge": "标线1.4秒后沿直线冲锋，标线期间锁定落点",
    "weak-left-right": "先左翼2.5s后右翼2.5s，重复至弱点耗尽",
    "phase-sweep-and-core": "第1阶段扫线，第2阶段中央核心暴露3s，循环"
  },
  "bulletSafeSpace": "所有攻击段至少保留一条玩家可达≥56逻辑px宽的安全走廊，待模拟验证"
}
```

- **参考通关方案**：

```json
{
  "events": [
    "w1",
    "w2",
    "w3",
    "w4",
    "w5"
  ],
  "plan": "读取预警线，移向 safeBandXRatio，Boss 露弱点后再进攻"
}
```

**验收工单**：

1. **成功路径**：定时事件不依赖Math.random且预警与伤害开始时间可复测
2. **失败路径**：弹幕演算留出可达安全区；阶段目标可在基础武器下完成
3. **移动端**：按住拖动+技能点击两指并发，子弹/弱点在小屏可辨
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C05 · 护盾与弱点

- **通关目标**：击败双弱点 Boss
- **关卡决策**：继续待在安全带还是穿越危险区取武器
- **练习重点**：Boss 左右暴露弱点，阶段间有喘息
- **探索反馈**：判断是否先清小敌还是抢 Boss 输出窗口
- **建议有效时长**：55–90 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "stageDurationSec": 55,
  "playerSpawn": {
    "xRatio": 0.5,
    "yRatio": 0.85
  },
  "startingHealth": 3,
  "events": [
    {
      "id": "w1",
      "atSec": 4,
      "enemyType": "scout",
      "spawnXRatio": 0.32,
      "attackPattern": "aimed",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.85,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 6.2
    },
    {
      "id": "w2",
      "atSec": 11,
      "enemyType": "pair",
      "spawnXRatio": 0.6,
      "attackPattern": "fan5",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.1,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 13.2
    },
    {
      "id": "w3",
      "atSec": 19,
      "enemyType": "sweeper",
      "spawnXRatio": 0.28,
      "attackPattern": "sweep-lr",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.8,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 21.2
    },
    {
      "id": "w4",
      "atSec": 27,
      "enemyType": "charger",
      "spawnXRatio": 0.74,
      "attackPattern": "mark-charge",
      "telegraphSec": 1.4,
      "safeBandXRatio": {
        "center": 0.18,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 29.2
    },
    {
      "id": "w5",
      "atSec": 37,
      "enemyType": "boss",
      "spawnXRatio": 0.5,
      "attackPattern": "weak-left-right",
      "telegraphSec": 1.25,
      "safeBandXRatio": {
        "center": 0.15,
        "halfWidth": 0.12
      },
      "attackActiveSec": 16,
      "stopNewThreatsUntilSec": 39.2
    }
  ],
  "powerups": [
    {
      "atSec": 23,
      "kind": "spread",
      "xRatio": 0.75,
      "required": false
    }
  ],
  "endCondition": "defeat-boss",
  "patternContract": {
    "single": "向下单发，瞄准当前位置后锁定",
    "aimed": "预警瞄准后单发",
    "fan3": "三个固定发散角-22/0/+22度",
    "fan5": "五个固定发散角-32/-16/0/+16/+32度",
    "sweep-lr": "左向右扫描危险带，预先显示扫线",
    "sweep-rl": "右向左扫描危险带，预先显示扫线",
    "mark-charge": "标线1.4秒后沿直线冲锋，标线期间锁定落点",
    "weak-left-right": "先左翼2.5s后右翼2.5s，重复至弱点耗尽",
    "phase-sweep-and-core": "第1阶段扫线，第2阶段中央核心暴露3s，循环"
  },
  "bulletSafeSpace": "所有攻击段至少保留一条玩家可达≥56逻辑px宽的安全走廊，待模拟验证"
}
```

- **参考通关方案**：

```json
{
  "events": [
    "w1",
    "w2",
    "w3",
    "w4",
    "w5"
  ],
  "plan": "读取预警线，移向 safeBandXRatio，Boss 露弱点后再进攻"
}
```

**验收工单**：

1. **成功路径**：定时事件不依赖Math.random且预警与伤害开始时间可复测
2. **失败路径**：弹幕演算留出可达安全区；阶段目标可在基础武器下完成
3. **移动端**：按住拖动+技能点击两指并发，子弹/弱点在小屏可辨
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

### C06 · 星域毕业战

- **通关目标**：击败两阶段 Boss
- **关卡决策**：继续待在安全带还是穿越危险区取武器
- **练习重点**：先躲确定性弹幕再利用核心暴露窗口
- **探索反馈**：Boss 第二阶段发射扇弹时安全带移动
- **建议有效时长**：65–100 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "stageDurationSec": 65,
  "playerSpawn": {
    "xRatio": 0.5,
    "yRatio": 0.85
  },
  "startingHealth": 3,
  "events": [
    {
      "id": "w1",
      "atSec": 3,
      "enemyType": "sweeper",
      "spawnXRatio": 0.25,
      "attackPattern": "sweep-lr",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.85,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 5.2
    },
    {
      "id": "w2",
      "atSec": 9,
      "enemyType": "charger",
      "spawnXRatio": 0.78,
      "attackPattern": "mark-charge",
      "telegraphSec": 1.4,
      "safeBandXRatio": {
        "center": 0.2,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 11.2
    },
    {
      "id": "w3",
      "atSec": 16,
      "enemyType": "pair",
      "spawnXRatio": 0.5,
      "attackPattern": "fan5",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.1,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 18.2
    },
    {
      "id": "w4",
      "atSec": 25,
      "enemyType": "sweeper",
      "spawnXRatio": 0.76,
      "attackPattern": "sweep-rl",
      "telegraphSec": 0.9,
      "safeBandXRatio": {
        "center": 0.15,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 27.2
    },
    {
      "id": "w5",
      "atSec": 34,
      "enemyType": "charger",
      "spawnXRatio": 0.28,
      "attackPattern": "mark-charge",
      "telegraphSec": 1.4,
      "safeBandXRatio": {
        "center": 0.8,
        "halfWidth": 0.12
      },
      "attackActiveSec": 3.4,
      "stopNewThreatsUntilSec": 36.2
    },
    {
      "id": "w6",
      "atSec": 44,
      "enemyType": "boss",
      "spawnXRatio": 0.5,
      "attackPattern": "phase-sweep-and-core",
      "telegraphSec": 1.25,
      "safeBandXRatio": {
        "center": 0.1,
        "halfWidth": 0.12
      },
      "attackActiveSec": 16,
      "stopNewThreatsUntilSec": 46.2
    }
  ],
  "powerups": [
    {
      "atSec": 18,
      "kind": "laser",
      "xRatio": 0.8,
      "required": false
    },
    {
      "atSec": 40,
      "kind": "homing",
      "xRatio": 0.2,
      "required": false
    }
  ],
  "endCondition": "defeat-boss",
  "patternContract": {
    "single": "向下单发，瞄准当前位置后锁定",
    "aimed": "预警瞄准后单发",
    "fan3": "三个固定发散角-22/0/+22度",
    "fan5": "五个固定发散角-32/-16/0/+16/+32度",
    "sweep-lr": "左向右扫描危险带，预先显示扫线",
    "sweep-rl": "右向左扫描危险带，预先显示扫线",
    "mark-charge": "标线1.4秒后沿直线冲锋，标线期间锁定落点",
    "weak-left-right": "先左翼2.5s后右翼2.5s，重复至弱点耗尽",
    "phase-sweep-and-core": "第1阶段扫线，第2阶段中央核心暴露3s，循环"
  },
  "bulletSafeSpace": "所有攻击段至少保留一条玩家可达≥56逻辑px宽的安全走廊，待模拟验证"
}
```

- **参考通关方案**：

```json
{
  "events": [
    "w1",
    "w2",
    "w3",
    "w4",
    "w5",
    "w6"
  ],
  "plan": "读取预警线，移向 safeBandXRatio，Boss 露弱点后再进攻"
}
```

**验收工单**：

1. **成功路径**：定时事件不依赖Math.random且预警与伤害开始时间可复测
2. **失败路径**：弹幕演算留出可达安全区；阶段目标可在基础武器下完成
3. **移动端**：按住拖动+技能点击两指并发，子弹/弱点在小屏可辨
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：无额外备注

---

