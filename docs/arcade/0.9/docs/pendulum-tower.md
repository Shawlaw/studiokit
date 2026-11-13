# 层塔｜6 关可实施蓝图

- 游戏 ID：`pendulum-tower`；当前公开主干对应文件：`apps/arcade/games/pendulum-tower.html`
- 数据源：`../levels/pendulum-tower.json`，每关单文件在 `../levels/stages/pendulum-tower-Cxx.json`
- 实施对象：独立 challenge mode，经典模式原样保留；关卡表达：箱体顺序/偏置
- 状态：策划版，已运行静态校验；未经过当前引擎物理模拟和真机测试。

## 章节总览

| # | 关卡 | 目标 | 技巧 | 发现 |
|---:|---|---|---|---|
| 1 | 稳稳四层 | 校准中心，完成4层 | 学习钟摆过中心的时刻 | 完美层数可作为独立目标 |
| 2 | 交替施工 | 按左右交替标记完成4层 | 小幅偏心的释放时机 | 观察箱体偏移能否互相抵消 |
| 3 | 偏右的委托 | 前两层右偏，后两层向左矫正 | 连续两次偏置后的重心修复 | 从重心可视化读出倾斜的累积 |
| 4 | 有限配重 | 5层达到目标且配重最多用1次 | 预测下一层是否值得修正 | 对比用/不用配重的结构差异 |
| 5 | 窄层挑战 | 六层且连续三层无大偏差 | 追踪稳定区宽度随楼层变化 | 发现摆动速度不是唯一难度来源 |
| 6 | 城市小塔 | 综合六层，并保持塔顶中心距基座≤15px | 交替偏置、修正和有限容错 | 结束时展示结构剖面与偏移走势图 |

## 逐关详细规格

### C01 · 稳稳四层

- **通关目标**：校准中心，完成4层
- **关卡决策**：中心更稳，偏离可获得更快释放但损失稳定度
- **练习重点**：学习钟摆过中心的时刻
- **探索反馈**：完美层数可作为独立目标
- **建议有效时长**：60–170 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420x740；每箱宽64高40，baseCenterX=210；targetOffsetsPx 是箱心相对基座中心的目标偏置，允许±8px",
  "baseCenterX": 210,
  "boxes": [
    {
      "order": 1,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 0,
      "tolerancePx": 8
    },
    {
      "order": 2,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 0,
      "tolerancePx": 8
    },
    {
      "order": 3,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 0,
      "tolerancePx": 8
    },
    {
      "order": 4,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 0,
      "tolerancePx": 8
    }
  ],
  "pendulum": {
    "pivotX": 210,
    "pivotY": 64,
    "length": 135,
    "speedFactor": 1.0,
    "deterministicStartPhaseRad": 0
  },
  "limits": {
    "maxTowerLeanAbs": 0.075,
    "maxDroppedBoxes": 5,
    "braceUsesAllowed": 0,
    "guideUsesAllowed": 0
  },
  "win": {
    "floorsAtLeast": 4,
    "noCollapse": true,
    "allMarkTargetsWithinTolerance": false
  },
  "evaluation": {
    "bronze": "完成并保持稳定",
    "silver": "全部偏置目标±8px内",
    "gold": "满足银牌且零道具、零失误"
  },
  "physicsNote": "本配置仅规定目标/条件；实际放置是否稳定必须在当前 Lean 模型中按帧仿真"
}
```

- **参考通关方案**：

```json
{
  "releaseOffsetsPx": [
    0,
    0,
    0,
    0
  ],
  "strategy": "按目标标记释放，偏置纠正后再看重心指示"
}
```

**验收工单**：

1. **成功路径**：物理模拟能以一组真实释放时机稳定完成目标楼层
2. **失败路径**：超出倾斜极限判倒塔，配重上限按关卡校验
3. **移动端**：放箱是清晰的独立点击，底部按钮不遮住钟摆轨迹
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：禁止运行时强行吸附到targetOffset；mark 是目标提示，真实释放与物理判定必须保留

---

### C02 · 交替施工

- **通关目标**：按左右交替标记完成4层
- **关卡决策**：标记位置与重心的权衡
- **练习重点**：小幅偏心的释放时机
- **探索反馈**：观察箱体偏移能否互相抵消
- **建议有效时长**：60–170 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420x740；每箱宽64高40，baseCenterX=210；targetOffsetsPx 是箱心相对基座中心的目标偏置，允许±8px",
  "baseCenterX": 210,
  "boxes": [
    {
      "order": 1,
      "width": 64,
      "height": 40,
      "targetOffsetPx": -8,
      "tolerancePx": 8
    },
    {
      "order": 2,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 8,
      "tolerancePx": 8
    },
    {
      "order": 3,
      "width": 64,
      "height": 40,
      "targetOffsetPx": -8,
      "tolerancePx": 8
    },
    {
      "order": 4,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 8,
      "tolerancePx": 8
    }
  ],
  "pendulum": {
    "pivotX": 210,
    "pivotY": 64,
    "length": 135,
    "speedFactor": 1.06,
    "deterministicStartPhaseRad": 0
  },
  "limits": {
    "maxTowerLeanAbs": 0.09,
    "maxDroppedBoxes": 5,
    "braceUsesAllowed": 0,
    "guideUsesAllowed": 0
  },
  "win": {
    "floorsAtLeast": 4,
    "noCollapse": true,
    "allMarkTargetsWithinTolerance": false
  },
  "evaluation": {
    "bronze": "完成并保持稳定",
    "silver": "全部偏置目标±8px内",
    "gold": "满足银牌且零道具、零失误"
  },
  "physicsNote": "本配置仅规定目标/条件；实际放置是否稳定必须在当前 Lean 模型中按帧仿真"
}
```

- **参考通关方案**：

```json
{
  "releaseOffsetsPx": [
    -8,
    8,
    -8,
    8
  ],
  "strategy": "按目标标记释放，偏置纠正后再看重心指示"
}
```

**验收工单**：

1. **成功路径**：物理模拟能以一组真实释放时机稳定完成目标楼层
2. **失败路径**：超出倾斜极限判倒塔，配重上限按关卡校验
3. **移动端**：放箱是清晰的独立点击，底部按钮不遮住钟摆轨迹
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：禁止运行时强行吸附到targetOffset；mark 是目标提示，真实释放与物理判定必须保留

---

### C03 · 偏右的委托

- **通关目标**：前两层右偏，后两层向左矫正
- **关卡决策**：优先贴标记还是先修正中心
- **练习重点**：连续两次偏置后的重心修复
- **探索反馈**：从重心可视化读出倾斜的累积
- **建议有效时长**：60–170 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420x740；每箱宽64高40，baseCenterX=210；targetOffsetsPx 是箱心相对基座中心的目标偏置，允许±8px",
  "baseCenterX": 210,
  "boxes": [
    {
      "order": 1,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 5,
      "tolerancePx": 8
    },
    {
      "order": 2,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 10,
      "tolerancePx": 8
    },
    {
      "order": 3,
      "width": 64,
      "height": 40,
      "targetOffsetPx": -4,
      "tolerancePx": 8
    },
    {
      "order": 4,
      "width": 64,
      "height": 40,
      "targetOffsetPx": -10,
      "tolerancePx": 8
    },
    {
      "order": 5,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 0,
      "tolerancePx": 8
    }
  ],
  "pendulum": {
    "pivotX": 210,
    "pivotY": 64,
    "length": 135,
    "speedFactor": 1.12,
    "deterministicStartPhaseRad": 0
  },
  "limits": {
    "maxTowerLeanAbs": 0.11,
    "maxDroppedBoxes": 6,
    "braceUsesAllowed": 0,
    "guideUsesAllowed": 0
  },
  "win": {
    "floorsAtLeast": 5,
    "noCollapse": true,
    "allMarkTargetsWithinTolerance": false
  },
  "evaluation": {
    "bronze": "完成并保持稳定",
    "silver": "全部偏置目标±8px内",
    "gold": "满足银牌且零道具、零失误"
  },
  "physicsNote": "本配置仅规定目标/条件；实际放置是否稳定必须在当前 Lean 模型中按帧仿真"
}
```

- **参考通关方案**：

```json
{
  "releaseOffsetsPx": [
    5,
    10,
    -4,
    -10,
    0
  ],
  "strategy": "按目标标记释放，偏置纠正后再看重心指示"
}
```

**验收工单**：

1. **成功路径**：物理模拟能以一组真实释放时机稳定完成目标楼层
2. **失败路径**：超出倾斜极限判倒塔，配重上限按关卡校验
3. **移动端**：放箱是清晰的独立点击，底部按钮不遮住钟摆轨迹
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：禁止运行时强行吸附到targetOffset；mark 是目标提示，真实释放与物理判定必须保留

---

### C04 · 有限配重

- **通关目标**：5层达到目标且配重最多用1次
- **关卡决策**：何时保留配重机会
- **练习重点**：预测下一层是否值得修正
- **探索反馈**：对比用/不用配重的结构差异
- **建议有效时长**：60–170 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420x740；每箱宽64高40，baseCenterX=210；targetOffsetsPx 是箱心相对基座中心的目标偏置，允许±8px",
  "baseCenterX": 210,
  "boxes": [
    {
      "order": 1,
      "width": 64,
      "height": 40,
      "targetOffsetPx": -12,
      "tolerancePx": 8
    },
    {
      "order": 2,
      "width": 64,
      "height": 40,
      "targetOffsetPx": -8,
      "tolerancePx": 8
    },
    {
      "order": 3,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 6,
      "tolerancePx": 8
    },
    {
      "order": 4,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 10,
      "tolerancePx": 8
    },
    {
      "order": 5,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 2,
      "tolerancePx": 8
    }
  ],
  "pendulum": {
    "pivotX": 210,
    "pivotY": 64,
    "length": 135,
    "speedFactor": 1.18,
    "deterministicStartPhaseRad": 0
  },
  "limits": {
    "maxTowerLeanAbs": 0.11,
    "maxDroppedBoxes": 6,
    "braceUsesAllowed": 1,
    "guideUsesAllowed": 0
  },
  "win": {
    "floorsAtLeast": 5,
    "noCollapse": true,
    "allMarkTargetsWithinTolerance": false
  },
  "evaluation": {
    "bronze": "完成并保持稳定",
    "silver": "全部偏置目标±8px内",
    "gold": "满足银牌且零道具、零失误"
  },
  "physicsNote": "本配置仅规定目标/条件；实际放置是否稳定必须在当前 Lean 模型中按帧仿真"
}
```

- **参考通关方案**：

```json
{
  "releaseOffsetsPx": [
    -12,
    -8,
    6,
    10,
    2
  ],
  "strategy": "按目标标记释放，偏置纠正后再看重心指示"
}
```

**验收工单**：

1. **成功路径**：物理模拟能以一组真实释放时机稳定完成目标楼层
2. **失败路径**：超出倾斜极限判倒塔，配重上限按关卡校验
3. **移动端**：放箱是清晰的独立点击，底部按钮不遮住钟摆轨迹
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：禁止运行时强行吸附到targetOffset；mark 是目标提示，真实释放与物理判定必须保留

---

### C05 · 窄层挑战

- **通关目标**：六层且连续三层无大偏差
- **关卡决策**：更慢找中心还是拿较小的时间收益
- **练习重点**：追踪稳定区宽度随楼层变化
- **探索反馈**：发现摆动速度不是唯一难度来源
- **建议有效时长**：60–170 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420x740；每箱宽64高40，baseCenterX=210；targetOffsetsPx 是箱心相对基座中心的目标偏置，允许±8px",
  "baseCenterX": 210,
  "boxes": [
    {
      "order": 1,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 0,
      "tolerancePx": 7
    },
    {
      "order": 2,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 12,
      "tolerancePx": 7
    },
    {
      "order": 3,
      "width": 64,
      "height": 40,
      "targetOffsetPx": -10,
      "tolerancePx": 7
    },
    {
      "order": 4,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 8,
      "tolerancePx": 7
    },
    {
      "order": 5,
      "width": 64,
      "height": 40,
      "targetOffsetPx": -8,
      "tolerancePx": 7
    },
    {
      "order": 6,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 0,
      "tolerancePx": 7
    }
  ],
  "pendulum": {
    "pivotX": 210,
    "pivotY": 64,
    "length": 135,
    "speedFactor": 1.24,
    "deterministicStartPhaseRad": 0
  },
  "limits": {
    "maxTowerLeanAbs": 0.095,
    "maxDroppedBoxes": 7,
    "braceUsesAllowed": 0,
    "guideUsesAllowed": 0
  },
  "win": {
    "floorsAtLeast": 6,
    "noCollapse": true,
    "allMarkTargetsWithinTolerance": false
  },
  "evaluation": {
    "bronze": "完成并保持稳定",
    "silver": "全部偏置目标±8px内",
    "gold": "满足银牌且零道具、零失误"
  },
  "physicsNote": "本配置仅规定目标/条件；实际放置是否稳定必须在当前 Lean 模型中按帧仿真"
}
```

- **参考通关方案**：

```json
{
  "releaseOffsetsPx": [
    0,
    12,
    -10,
    8,
    -8,
    0
  ],
  "strategy": "按目标标记释放，偏置纠正后再看重心指示"
}
```

**验收工单**：

1. **成功路径**：物理模拟能以一组真实释放时机稳定完成目标楼层
2. **失败路径**：超出倾斜极限判倒塔，配重上限按关卡校验
3. **移动端**：放箱是清晰的独立点击，底部按钮不遮住钟摆轨迹
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：禁止运行时强行吸附到targetOffset；mark 是目标提示，真实释放与物理判定必须保留

---

### C06 · 城市小塔

- **通关目标**：综合六层，并保持塔顶中心距基座≤15px
- **关卡决策**：两种可行箱序的风险收益
- **练习重点**：交替偏置、修正和有限容错
- **探索反馈**：结束时展示结构剖面与偏移走势图
- **建议有效时长**：60–170 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420x740；每箱宽64高40，baseCenterX=210；targetOffsetsPx 是箱心相对基座中心的目标偏置，允许±8px",
  "baseCenterX": 210,
  "boxes": [
    {
      "order": 1,
      "width": 64,
      "height": 40,
      "targetOffsetPx": -8,
      "tolerancePx": 7
    },
    {
      "order": 2,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 8,
      "tolerancePx": 7
    },
    {
      "order": 3,
      "width": 64,
      "height": 40,
      "targetOffsetPx": -12,
      "tolerancePx": 7
    },
    {
      "order": 4,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 10,
      "tolerancePx": 7
    },
    {
      "order": 5,
      "width": 64,
      "height": 40,
      "targetOffsetPx": -6,
      "tolerancePx": 7
    },
    {
      "order": 6,
      "width": 64,
      "height": 40,
      "targetOffsetPx": 3,
      "tolerancePx": 7
    }
  ],
  "pendulum": {
    "pivotX": 210,
    "pivotY": 64,
    "length": 135,
    "speedFactor": 1.3,
    "deterministicStartPhaseRad": 0
  },
  "limits": {
    "maxTowerLeanAbs": 0.115,
    "maxDroppedBoxes": 7,
    "braceUsesAllowed": 0,
    "guideUsesAllowed": 0
  },
  "win": {
    "floorsAtLeast": 6,
    "noCollapse": true,
    "allMarkTargetsWithinTolerance": false
  },
  "evaluation": {
    "bronze": "完成并保持稳定",
    "silver": "全部偏置目标±8px内",
    "gold": "满足银牌且零道具、零失误"
  },
  "physicsNote": "本配置仅规定目标/条件；实际放置是否稳定必须在当前 Lean 模型中按帧仿真"
}
```

- **参考通关方案**：

```json
{
  "releaseOffsetsPx": [
    -8,
    8,
    -12,
    10,
    -6,
    3
  ],
  "strategy": "按目标标记释放，偏置纠正后再看重心指示"
}
```

**验收工单**：

1. **成功路径**：物理模拟能以一组真实释放时机稳定完成目标楼层
2. **失败路径**：超出倾斜极限判倒塔，配重上限按关卡校验
3. **移动端**：放箱是清晰的独立点击，底部按钮不遮住钟摆轨迹
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：禁止运行时强行吸附到targetOffset；mark 是目标提示，真实释放与物理判定必须保留

---

