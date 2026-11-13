/* 生成物：由 tools/arcade_09_data.mjs 从 docs/arcade/0.9/levels/snowbells.json 生成；不要手改。 */
window.ArcadeChallengeData = window.ArcadeChallengeData || {};
window.ArcadeChallengeData['snowbells'] = {
  "schemaVersion": "1.0.0",
  "gameId": "snowbells",
  "gameName": "雪铃",
  "packVersion": "0.9.0-design-v1",
  "stages": [
    {
      "id": "snowbells-C01",
      "stageNumber": 1,
      "title": "四铃开场",
      "difficulty": 1,
      "goalStatement": "A→B→C→D，四铃顺序击中即可收局",
      "decision": "分辨下一颗正确铃，不盲目追最近一颗",
      "practicedSkill": "连续命中 4 次并学会提前转向",
      "discovery": "最后一颗铃带有不同音色",
      "targetDurationSec": [
        45,
        140
      ],
      "requiredFeatures": [
        "stage_bell_sequence"
      ],
      "content": {
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
    },
    {
      "id": "snowbells-C02",
      "stageNumber": 2,
      "title": "左右对唱",
      "difficulty": 2,
      "goalStatement": "按左右交替的音序 A→E",
      "decision": "错误路径仍可救回，但会丢失完美连击",
      "practicedSkill": "先预判下一跳的横向跨度",
      "discovery": "正确音序投射在背景星线",
      "targetDurationSec": [
        45,
        140
      ],
      "requiredFeatures": [
        "stage_bell_sequence"
      ],
      "content": {
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
    },
    {
      "id": "snowbells-C03",
      "stageNumber": 3,
      "title": "休止与连奏",
      "difficulty": 3,
      "goalStatement": "经过两个休止铃后完成 3 音连奏",
      "decision": "休止铃负责反弹但不计入连击；绕开会掉落",
      "practicedSkill": "理解节奏中的非计分落点",
      "discovery": "休止铃声音更轻且形状有空心标记",
      "targetDurationSec": [
        45,
        140
      ],
      "requiredFeatures": [
        "stage_bell_sequence"
      ],
      "content": {
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
    },
    {
      "id": "snowbells-C04",
      "stageNumber": 4,
      "title": "双线谱",
      "difficulty": 4,
      "goalStatement": "主音六连击通关，右侧两枚彩铃为可选高分路线",
      "decision": "选择主线稳连或切入彩铃再汇合",
      "practicedSkill": "同一次反弹规划连续两个目标",
      "discovery": "彩铃路线有肉眼可辨的渐亮轨迹",
      "targetDurationSec": [
        45,
        140
      ],
      "requiredFeatures": [
        "stage_bell_sequence"
      ],
      "content": {
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
    },
    {
      "id": "snowbells-C05",
      "stageNumber": 5,
      "title": "冷暖和声",
      "difficulty": 5,
      "goalStatement": "按蓝红交替序列完成六铃",
      "decision": "选错颜色不立刻死，但本关完美评价失败",
      "practicedSkill": "观察颜色同时依赖形状文字标志识别",
      "discovery": "颜色与图形同时编码，不能只靠颜色",
      "targetDurationSec": [
        45,
        140
      ],
      "requiredFeatures": [
        "stage_bell_sequence"
      ],
      "content": {
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
    },
    {
      "id": "snowbells-C06",
      "stageNumber": 6,
      "title": "雪夜终曲",
      "difficulty": 6,
      "goalStatement": "在一次演奏里完成七节点序列并收尾",
      "decision": "彩铃捷径与稳妥七连，高手争取无断连",
      "practicedSkill": "综合颜色辨认、休止衔接、落点控制",
      "discovery": "终曲完美连击触发仅视觉性的隐藏雪花乐谱",
      "targetDurationSec": [
        45,
        140
      ],
      "requiredFeatures": [
        "stage_bell_sequence"
      ],
      "content": {
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
    }
  ]
};
