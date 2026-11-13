/* 生成物：由 tools/arcade_09_data.mjs 从 docs/arcade/0.9/levels/pendulum-tower.json 生成；不要手改。 */
window.ArcadeChallengeData = window.ArcadeChallengeData || {};
window.ArcadeChallengeData['pendulum-tower'] = {
  "schemaVersion": "1.0.0",
  "gameId": "pendulum-tower",
  "gameName": "层塔",
  "packVersion": "0.9.0-design-v1",
  "stages": [
    {
      "id": "pendulum-tower-C01",
      "stageNumber": 1,
      "title": "稳稳四层",
      "difficulty": 1,
      "goalStatement": "校准中心，完成4层",
      "decision": "中心更稳，偏离可获得更快释放但损失稳定度",
      "practicedSkill": "学习钟摆过中心的时刻",
      "discovery": "完美层数可作为独立目标",
      "targetDurationSec": [
        60,
        170
      ],
      "requiredFeatures": [
        "commission_mode",
        "fixed_marks"
      ],
      "content": {
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
          "speedFactor": 1,
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
    },
    {
      "id": "pendulum-tower-C02",
      "stageNumber": 2,
      "title": "交替施工",
      "difficulty": 2,
      "goalStatement": "按左右交替标记完成4层",
      "decision": "标记位置与重心的权衡",
      "practicedSkill": "小幅偏心的释放时机",
      "discovery": "观察箱体偏移能否互相抵消",
      "targetDurationSec": [
        60,
        170
      ],
      "requiredFeatures": [
        "commission_mode",
        "fixed_marks"
      ],
      "content": {
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
    },
    {
      "id": "pendulum-tower-C03",
      "stageNumber": 3,
      "title": "偏右的委托",
      "difficulty": 3,
      "goalStatement": "前两层右偏，后两层向左矫正",
      "decision": "优先贴标记还是先修正中心",
      "practicedSkill": "连续两次偏置后的重心修复",
      "discovery": "从重心可视化读出倾斜的累积",
      "targetDurationSec": [
        60,
        170
      ],
      "requiredFeatures": [
        "commission_mode",
        "fixed_marks"
      ],
      "content": {
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
    },
    {
      "id": "pendulum-tower-C04",
      "stageNumber": 4,
      "title": "有限配重",
      "difficulty": 4,
      "goalStatement": "5层达到目标且配重最多用1次",
      "decision": "何时保留配重机会",
      "practicedSkill": "预测下一层是否值得修正",
      "discovery": "对比用/不用配重的结构差异",
      "targetDurationSec": [
        60,
        170
      ],
      "requiredFeatures": [
        "commission_mode",
        "fixed_marks"
      ],
      "content": {
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
    },
    {
      "id": "pendulum-tower-C05",
      "stageNumber": 5,
      "title": "窄层挑战",
      "difficulty": 5,
      "goalStatement": "六层且连续三层无大偏差",
      "decision": "更慢找中心还是拿较小的时间收益",
      "practicedSkill": "追踪稳定区宽度随楼层变化",
      "discovery": "发现摆动速度不是唯一难度来源",
      "targetDurationSec": [
        60,
        170
      ],
      "requiredFeatures": [
        "commission_mode",
        "fixed_marks"
      ],
      "content": {
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
    },
    {
      "id": "pendulum-tower-C06",
      "stageNumber": 6,
      "title": "城市小塔",
      "difficulty": 6,
      "goalStatement": "综合六层，并保持塔顶中心距基座≤15px",
      "decision": "两种可行箱序的风险收益",
      "practicedSkill": "交替偏置、修正和有限容错",
      "discovery": "结束时展示结构剖面与偏移走势图",
      "targetDurationSec": [
        60,
        170
      ],
      "requiredFeatures": [
        "commission_mode",
        "fixed_marks"
      ],
      "content": {
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
    }
  ]
};
