# 雪铃｜6 关可实施蓝图

- 游戏 ID：`snowbells`；当前公开主干对应文件：`apps/arcade/games/snowbells.html`
- 数据源：`../levels/snowbells.json`，每关单文件在 `../levels/stages/snowbells-Cxx.json`
- 实施对象：独立 challenge mode，经典模式原样保留；关卡表达：铃点/顺序
- 状态：策划版，已运行静态校验；未经过当前引擎物理模拟和真机测试。

## 章节总览

| # | 关卡 | 目标 | 技巧 | 发现 |
|---:|---|---|---|---|
| 1 | 四铃开场 | A→B→C→D，四铃顺序击中即可收局 | 连续命中 4 次并学会提前转向 | 最后一颗铃带有不同音色 |
| 2 | 左右对唱 | 按左右交替的音序 A→E | 先预判下一跳的横向跨度 | 正确音序投射在背景星线 |
| 3 | 休止与连奏 | 经过两个休止铃后完成 3 音连奏 | 理解节奏中的非计分落点 | 休止铃声音更轻且形状有空心标记 |
| 4 | 双线谱 | 主音六连击通关，右侧两枚彩铃为可选高分路线 | 同一次反弹规划连续两个目标 | 彩铃路线有肉眼可辨的渐亮轨迹 |
| 5 | 冷暖和声 | 按蓝红交替序列完成六铃 | 观察颜色同时依赖形状文字标志识别 | 颜色与图形同时编码，不能只靠颜色 |
| 6 | 雪夜终曲 | 在一次演奏里完成七节点序列并收尾 | 综合颜色辨认、休止衔接、落点控制 | 终曲完美连击触发仅视觉性的隐藏雪花乐谱 |

## 逐关详细规格

### C01 · 四铃开场

- **通关目标**：A→B→C→D，四铃顺序击中即可收局
- **关卡决策**：分辨下一颗正确铃，不盲目追最近一颗
- **练习重点**：连续命中 4 次并学会提前转向
- **探索反馈**：最后一颗铃带有不同音色
- **建议有效时长**：45–140 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420x740；bell.height相对起点向上；每次命中刷新向上初速 -655，最大理论上升159，实际还需验证横向可达",
  "bells": [
    {
      "id": "A",
      "xCenter": 210,
      "height": 0,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "B",
      "xCenter": 174,
      "height": 77,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "C",
      "xCenter": 239,
      "height": 150,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "D",
      "xCenter": 201,
      "height": 224,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    }
  ],
  "requiredSequence": [
    "A",
    "B",
    "C",
    "D"
  ],
  "completion": "按顺序命中指定铃铛，休止铃只反弹不加连击，不强制收集bonus",
  "wrongBellPolicy": "可反弹但不给计分；0.8s内显示下一个正确目标",
  "comboBreakPolicy": "落空/错序会失去本关完美奖励，普通通关可恢复继续",
  "startBell": "A",
  "goalAfterLast": true
}
```

- **参考通关方案**：

```json
{
  "bellOrder": [
    "A",
    "B",
    "C",
    "D"
  ],
  "optional": [],
  "tactics": "命中后先看下一个目标再进行横移，不依赖局内道具"
}
```

**验收工单**：

1. **成功路径**：指定铃铛间距和弹跳时间允许物理命中且不可重复计分
2. **失败路径**：无道具可完成必经序列；休止铃能弹但不计分
3. **移动端**：显示下一个目标，左右多指操作无粘滞
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：请使用确定性铃点图；连击只统计首次正确命中。

---

### C02 · 左右对唱

- **通关目标**：按左右交替的音序 A→E
- **关卡决策**：错误路径仍可救回，但会丢失完美连击
- **练习重点**：先预判下一跳的横向跨度
- **探索反馈**：正确音序投射在背景星线
- **建议有效时长**：45–140 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420x740；bell.height相对起点向上；每次命中刷新向上初速 -655，最大理论上升159，实际还需验证横向可达",
  "bells": [
    {
      "id": "A",
      "xCenter": 204,
      "height": 0,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "B",
      "xCenter": 125,
      "height": 71,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "C",
      "xCenter": 260,
      "height": 145,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "D",
      "xCenter": 132,
      "height": 220,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "E",
      "xCenter": 231,
      "height": 295,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    }
  ],
  "requiredSequence": [
    "A",
    "B",
    "C",
    "D",
    "E"
  ],
  "completion": "按顺序命中指定铃铛，休止铃只反弹不加连击，不强制收集bonus",
  "wrongBellPolicy": "可反弹但不给计分；0.8s内显示下一个正确目标",
  "comboBreakPolicy": "落空/错序会失去本关完美奖励，普通通关可恢复继续",
  "startBell": "A",
  "goalAfterLast": true
}
```

- **参考通关方案**：

```json
{
  "bellOrder": [
    "A",
    "B",
    "C",
    "D",
    "E"
  ],
  "optional": [],
  "tactics": "命中后先看下一个目标再进行横移，不依赖局内道具"
}
```

**验收工单**：

1. **成功路径**：指定铃铛间距和弹跳时间允许物理命中且不可重复计分
2. **失败路径**：无道具可完成必经序列；休止铃能弹但不计分
3. **移动端**：显示下一个目标，左右多指操作无粘滞
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：请使用确定性铃点图；连击只统计首次正确命中。

---

### C03 · 休止与连奏

- **通关目标**：经过两个休止铃后完成 3 音连奏
- **关卡决策**：休止铃负责反弹但不计入连击；绕开会掉落
- **练习重点**：理解节奏中的非计分落点
- **探索反馈**：休止铃声音更轻且形状有空心标记
- **建议有效时长**：45–140 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420x740；bell.height相对起点向上；每次命中刷新向上初速 -655，最大理论上升159，实际还需验证横向可达",
  "bells": [
    {
      "id": "A",
      "xCenter": 212,
      "height": 0,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "B",
      "xCenter": 171,
      "height": 76,
      "kind": "rest",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "C",
      "xCenter": 258,
      "height": 150,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "D",
      "xCenter": 189,
      "height": 229,
      "kind": "rest",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "E",
      "xCenter": 222,
      "height": 305,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    }
  ],
  "requiredSequence": [
    "A",
    "B",
    "C",
    "D",
    "E"
  ],
  "completion": "按顺序命中指定铃铛，休止铃只反弹不加连击，不强制收集bonus",
  "wrongBellPolicy": "可反弹但不给计分；0.8s内显示下一个正确目标",
  "comboBreakPolicy": "落空/错序会失去本关完美奖励，普通通关可恢复继续",
  "startBell": "A",
  "goalAfterLast": true
}
```

- **参考通关方案**：

```json
{
  "bellOrder": [
    "A",
    "B",
    "C",
    "D",
    "E"
  ],
  "optional": [],
  "tactics": "命中后先看下一个目标再进行横移，不依赖局内道具"
}
```

**验收工单**：

1. **成功路径**：指定铃铛间距和弹跳时间允许物理命中且不可重复计分
2. **失败路径**：无道具可完成必经序列；休止铃能弹但不计分
3. **移动端**：显示下一个目标，左右多指操作无粘滞
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：请使用确定性铃点图；连击只统计首次正确命中。

---

### C04 · 双线谱

- **通关目标**：主音六连击通关，右侧两枚彩铃为可选高分路线
- **关卡决策**：选择主线稳连或切入彩铃再汇合
- **练习重点**：同一次反弹规划连续两个目标
- **探索反馈**：彩铃路线有肉眼可辨的渐亮轨迹
- **建议有效时长**：45–140 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420x740；bell.height相对起点向上；每次命中刷新向上初速 -655，最大理论上升159，实际还需验证横向可达",
  "bells": [
    {
      "id": "A",
      "xCenter": 210,
      "height": 0,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "B",
      "xCenter": 144,
      "height": 76,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "C",
      "xCenter": 248,
      "height": 151,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "D",
      "xCenter": 143,
      "height": 229,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "E",
      "xCenter": 248,
      "height": 304,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "F",
      "xCenter": 214,
      "height": 378,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "q1",
      "xCenter": 318,
      "height": 214,
      "kind": "bonus",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "q2",
      "xCenter": 318,
      "height": 291,
      "kind": "bonus",
      "radius": 9,
      "consumable": true
    }
  ],
  "requiredSequence": [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F"
  ],
  "completion": "按顺序命中指定铃铛，休止铃只反弹不加连击，不强制收集bonus",
  "wrongBellPolicy": "可反弹但不给计分；0.8s内显示下一个正确目标",
  "comboBreakPolicy": "落空/错序会失去本关完美奖励，普通通关可恢复继续",
  "startBell": "A",
  "goalAfterLast": true
}
```

- **参考通关方案**：

```json
{
  "bellOrder": [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F"
  ],
  "optional": [
    "q1",
    "q2"
  ],
  "tactics": "命中后先看下一个目标再进行横移，不依赖局内道具"
}
```

**验收工单**：

1. **成功路径**：指定铃铛间距和弹跳时间允许物理命中且不可重复计分
2. **失败路径**：无道具可完成必经序列；休止铃能弹但不计分
3. **移动端**：显示下一个目标，左右多指操作无粘滞
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：请使用确定性铃点图；连击只统计首次正确命中。

---

### C05 · 冷暖和声

- **通关目标**：按蓝红交替序列完成六铃
- **关卡决策**：选错颜色不立刻死，但本关完美评价失败
- **练习重点**：观察颜色同时依赖形状文字标志识别
- **探索反馈**：颜色与图形同时编码，不能只靠颜色
- **建议有效时长**：45–140 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420x740；bell.height相对起点向上；每次命中刷新向上初速 -655，最大理论上升159，实际还需验证横向可达",
  "bells": [
    {
      "id": "A",
      "xCenter": 210,
      "height": 0,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "B",
      "xCenter": 160,
      "height": 72,
      "kind": "blue",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "C",
      "xCenter": 246,
      "height": 148,
      "kind": "red",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "D",
      "xCenter": 160,
      "height": 223,
      "kind": "blue",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "E",
      "xCenter": 246,
      "height": 300,
      "kind": "red",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "F",
      "xCenter": 208,
      "height": 377,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    }
  ],
  "requiredSequence": [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F"
  ],
  "completion": "按顺序命中指定铃铛，休止铃只反弹不加连击，不强制收集bonus",
  "wrongBellPolicy": "可反弹但不给计分；0.8s内显示下一个正确目标",
  "comboBreakPolicy": "落空/错序会失去本关完美奖励，普通通关可恢复继续",
  "startBell": "A",
  "goalAfterLast": true
}
```

- **参考通关方案**：

```json
{
  "bellOrder": [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F"
  ],
  "optional": [],
  "tactics": "命中后先看下一个目标再进行横移，不依赖局内道具"
}
```

**验收工单**：

1. **成功路径**：指定铃铛间距和弹跳时间允许物理命中且不可重复计分
2. **失败路径**：无道具可完成必经序列；休止铃能弹但不计分
3. **移动端**：显示下一个目标，左右多指操作无粘滞
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：请使用确定性铃点图；连击只统计首次正确命中。

---

### C06 · 雪夜终曲

- **通关目标**：在一次演奏里完成七节点序列并收尾
- **关卡决策**：彩铃捷径与稳妥七连，高手争取无断连
- **练习重点**：综合颜色辨认、休止衔接、落点控制
- **探索反馈**：终曲完美连击触发仅视觉性的隐藏雪花乐谱
- **建议有效时长**：45–140 秒
- **角色/地图/时间轴/布局精确配置（适配当前游戏架构）**：

```json
{
  "coordinates": "420x740；bell.height相对起点向上；每次命中刷新向上初速 -655，最大理论上升159，实际还需验证横向可达",
  "bells": [
    {
      "id": "A",
      "xCenter": 206,
      "height": 0,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "B",
      "xCenter": 146,
      "height": 74,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "C",
      "xCenter": 259,
      "height": 150,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "D",
      "xCenter": 209,
      "height": 224,
      "kind": "rest",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "E",
      "xCenter": 145,
      "height": 296,
      "kind": "blue",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "F",
      "xCenter": 267,
      "height": 370,
      "kind": "red",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "G",
      "xCenter": 210,
      "height": 445,
      "kind": "normal",
      "radius": 9,
      "consumable": true
    },
    {
      "id": "q1",
      "xCenter": 325,
      "height": 297,
      "kind": "bonus",
      "radius": 9,
      "consumable": true
    }
  ],
  "requiredSequence": [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G"
  ],
  "completion": "按顺序命中指定铃铛，休止铃只反弹不加连击，不强制收集bonus",
  "wrongBellPolicy": "可反弹但不给计分；0.8s内显示下一个正确目标",
  "comboBreakPolicy": "落空/错序会失去本关完美奖励，普通通关可恢复继续",
  "startBell": "A",
  "goalAfterLast": true
}
```

- **参考通关方案**：

```json
{
  "bellOrder": [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G"
  ],
  "optional": [
    "q1"
  ],
  "tactics": "命中后先看下一个目标再进行横移，不依赖局内道具"
}
```

**验收工单**：

1. **成功路径**：指定铃铛间距和弹跳时间允许物理命中且不可重复计分
2. **失败路径**：无道具可完成必经序列；休止铃能弹但不计分
3. **移动端**：显示下一个目标，左右多指操作无粘滞
4. **AFK**：任一有效游玩时刻切后台/锁屏/恢复，剩余时间、玩家位置与未完成目标不变化；恢复后手动继续

**策划备注**：请使用确定性铃点图；连击只统计首次正确命中。

---

