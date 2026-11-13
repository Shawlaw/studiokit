/* 生成物：由 tools/arcade_09_data.mjs 从 docs/arcade/0.9/levels/shadow-leap.json 生成；不要手改。 */
window.ArcadeChallengeData = window.ArcadeChallengeData || {};
window.ArcadeChallengeData['shadow-leap'] = {
  "schemaVersion": "1.0.0",
  "gameId": "shadow-leap",
  "gameName": "影跃",
  "packVersion": "0.9.0-design-v1",
  "stages": [
    {
      "id": "shadow-leap-C01",
      "stageNumber": 1,
      "title": "初入影林",
      "difficulty": 1,
      "goalStatement": "抵达高度402的影门",
      "decision": "走中路稳妥通关或偏右获取卷轴",
      "practicedSkill": "观察惯性并提前对准落点",
      "discovery": "右侧银树标记提示有可选卷轴",
      "targetDurationSec": [
        45,
        155
      ],
      "requiredFeatures": [
        "challenge_mode",
        "stage_gate"
      ],
      "content": {
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
    },
    {
      "id": "shadow-leap-C02",
      "stageNumber": 2,
      "title": "月下断桥",
      "difficulty": 2,
      "goalStatement": "通过移动桥与易碎桥后抵达影门",
      "decision": "移动桥短路 vs 宽静态平台绕行",
      "practicedSkill": "等待移动相位，易碎平台起跳前预留方向",
      "discovery": "两条路径不同步且都能到终点",
      "targetDurationSec": [
        45,
        155
      ],
      "requiredFeatures": [
        "challenge_mode",
        "stage_gate"
      ],
      "content": {
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
            "periodSec": 3,
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
    },
    {
      "id": "shadow-leap-C03",
      "stageNumber": 3,
      "title": "影冲试炼",
      "difficulty": 3,
      "goalStatement": "用至少一次影冲越过月蚀裂隙",
      "decision": "保留影冲以越过横向大缺口；卷轴奖励需额外精度",
      "practicedSkill": "起跳后蓄势，空中定向影冲，落地刷新",
      "discovery": "左端石碑明确标示冲刺仅落地恢复",
      "targetDurationSec": [
        45,
        155
      ],
      "requiredFeatures": [
        "challenge_mode",
        "stage_gate",
        "air_dash"
      ],
      "content": {
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
    },
    {
      "id": "shadow-leap-C04",
      "stageNumber": 4,
      "title": "风之回廊",
      "difficulty": 4,
      "goalStatement": "在两段风口中抵达高门",
      "decision": "逆风短路要精确影冲，背风外圈更稳定",
      "practicedSkill": "提前看风向旗、对冲时机作选择",
      "discovery": "壁画揭示风向每次固定，不做随机风",
      "targetDurationSec": [
        45,
        155
      ],
      "requiredFeatures": [
        "challenge_mode",
        "stage_gate",
        "air_dash"
      ],
      "content": {
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
    },
    {
      "id": "shadow-leap-C05",
      "stageNumber": 5,
      "title": "双影岔路",
      "difficulty": 5,
      "goalStatement": "任选一条主路线抵达分岔山门",
      "decision": "右侧影冲捷径节省两跳；左侧宽平台收集线索",
      "practicedSkill": "读地图构图决定风险与步数",
      "discovery": "在左下角的发光纹样发现门钥匙线索",
      "targetDurationSec": [
        45,
        155
      ],
      "requiredFeatures": [
        "challenge_mode",
        "stage_gate",
        "air_dash"
      ],
      "content": {
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
    },
    {
      "id": "shadow-leap-C06",
      "stageNumber": 6,
      "title": "月门守卫",
      "difficulty": 6,
      "goalStatement": "集齐两座房间开关后抵达最终影门",
      "decision": "先左开关还是右开关自由，回中央安全平台调整",
      "practicedSkill": "连续预判相位、冲刺与保留检查点",
      "discovery": "两个半月雕像需要被亲自触碰，不能隔空触发",
      "targetDurationSec": [
        45,
        155
      ],
      "requiredFeatures": [
        "challenge_mode",
        "stage_gate",
        "air_dash"
      ],
      "content": {
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
    }
  ]
};
