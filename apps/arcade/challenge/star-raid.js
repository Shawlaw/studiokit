/* 生成物：由 tools/arcade_09_data.mjs 从 docs/arcade/0.9/levels/star-raid.json 生成；不要手改。 */
window.ArcadeChallengeData = window.ArcadeChallengeData || {};
window.ArcadeChallengeData['star-raid'] = {
  "schemaVersion": "1.0.0",
  "gameId": "star-raid",
  "gameName": "星海突击",
  "packVersion": "0.9.0-design-v1",
  "stages": [
    {
      "id": "star-raid-C01",
      "stageNumber": 1,
      "title": "护航第一课",
      "difficulty": 1,
      "goalStatement": "击落全部目标/撑到结束标记",
      "decision": "继续待在安全带还是穿越危险区取武器",
      "practicedSkill": "观察三发扇弹留下的通道",
      "discovery": "安全走位和清怪都能达成任务",
      "targetDurationSec": [
        35,
        70
      ],
      "requiredFeatures": [
        "fixed_wave_timeline"
      ],
      "content": {
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
    },
    {
      "id": "star-raid-C02",
      "stageNumber": 2,
      "title": "扫射之门",
      "difficulty": 2,
      "goalStatement": "通过五段标记扫射",
      "decision": "继续待在安全带还是穿越危险区取武器",
      "practicedSkill": "认清连续扫射方向并先移动到安全侧",
      "discovery": "拿激光需穿越中央区域，非必需",
      "targetDurationSec": [
        42,
        77
      ],
      "requiredFeatures": [
        "fixed_wave_timeline"
      ],
      "content": {
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
    },
    {
      "id": "star-raid-C03",
      "stageNumber": 3,
      "title": "冲锋预警",
      "difficulty": 3,
      "goalStatement": "无碰撞完成冲锋训练",
      "decision": "继续待在安全带还是穿越危险区取武器",
      "practicedSkill": "先观察冲锋目标线，预警结束才移动",
      "discovery": "冲锋失败时要知道自己是否在预警区域",
      "targetDurationSec": [
        46,
        81
      ],
      "requiredFeatures": [
        "fixed_wave_timeline"
      ],
      "content": {
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
    },
    {
      "id": "star-raid-C04",
      "stageNumber": 4,
      "title": "拾取抉择",
      "difficulty": 4,
      "goalStatement": "无道具存活并通过结束门",
      "decision": "继续待在安全带还是穿越危险区取武器",
      "practicedSkill": "危险边缘的拾取物与安全通路形成不同收益",
      "discovery": "不拾取也可完成，拾取可提高局内评价",
      "targetDurationSec": [
        48,
        83
      ],
      "requiredFeatures": [
        "fixed_wave_timeline"
      ],
      "content": {
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
    },
    {
      "id": "star-raid-C05",
      "stageNumber": 5,
      "title": "护盾与弱点",
      "difficulty": 5,
      "goalStatement": "击败双弱点 Boss",
      "decision": "继续待在安全带还是穿越危险区取武器",
      "practicedSkill": "Boss 左右暴露弱点，阶段间有喘息",
      "discovery": "判断是否先清小敌还是抢 Boss 输出窗口",
      "targetDurationSec": [
        55,
        90
      ],
      "requiredFeatures": [
        "fixed_wave_timeline",
        "boss_phase_script"
      ],
      "content": {
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
    },
    {
      "id": "star-raid-C06",
      "stageNumber": 6,
      "title": "星域毕业战",
      "difficulty": 6,
      "goalStatement": "击败两阶段 Boss",
      "decision": "继续待在安全带还是穿越危险区取武器",
      "practicedSkill": "先躲确定性弹幕再利用核心暴露窗口",
      "discovery": "Boss 第二阶段发射扇弹时安全带移动",
      "targetDurationSec": [
        65,
        100
      ],
      "requiredFeatures": [
        "fixed_wave_timeline",
        "boss_phase_script"
      ],
      "content": {
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
    }
  ]
};
