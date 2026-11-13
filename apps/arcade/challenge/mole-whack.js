/* 生成物：由 tools/arcade_09_data.mjs 从 docs/arcade/0.9/levels/mole-whack.json 生成；不要手改。 */
window.ArcadeChallengeData = window.ArcadeChallengeData || {};
window.ArcadeChallengeData['mole-whack'] = {
  "schemaVersion": "1.0.0",
  "gameId": "mole-whack",
  "gameName": "打地鼠",
  "packVersion": "0.9.0-design-v1",
  "stages": [
    {
      "id": "mole-whack-C01",
      "stageNumber": 1,
      "title": "看准再敲",
      "difficulty": 1,
      "goalStatement": "连续六次准确点击",
      "decision": "敲有效目标或主动忽略炸弹/假目标",
      "practicedSkill": "观察鼠出现的窗口，而不是狂点屏幕",
      "discovery": "洞口闪动是可预测前摇",
      "targetDurationSec": [
        30,
        40
      ],
      "requiredFeatures": [
        "scripted_spawn_wave"
      ],
      "content": {
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
    },
    {
      "id": "mole-whack-C02",
      "stageNumber": 2,
      "title": "金鼠优先",
      "difficulty": 2,
      "goalStatement": "至少点中两只金鼠与五个普通目标",
      "decision": "敲有效目标或主动忽略炸弹/假目标",
      "practicedSkill": "选择稀有高分目标优先",
      "discovery": "金鼠图案有星形边框而不只颜色不同",
      "targetDurationSec": [
        31,
        41
      ],
      "requiredFeatures": [
        "scripted_spawn_wave"
      ],
      "content": {
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
    },
    {
      "id": "mole-whack-C03",
      "stageNumber": 3,
      "title": "识别炸弹",
      "difficulty": 3,
      "goalStatement": "至少七次正确敲击并避开所有炸弹",
      "decision": "敲有效目标或主动忽略炸弹/假目标",
      "practicedSkill": "停止点击比击中目标同样重要",
      "discovery": "爆炸物有不同轮廓和出现前警告",
      "targetDurationSec": [
        32,
        42
      ],
      "requiredFeatures": [
        "scripted_spawn_wave"
      ],
      "content": {
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
    },
    {
      "id": "mole-whack-C04",
      "stageNumber": 4,
      "title": "双目标节奏",
      "difficulty": 4,
      "goalStatement": "同时出现两只时优先点金鼠",
      "decision": "敲有效目标或主动忽略炸弹/假目标",
      "practicedSkill": "两指各点击不同洞可节约时间",
      "discovery": "同一时刻多洞出现不构成无法完成的操作窗",
      "targetDurationSec": [
        34,
        44
      ],
      "requiredFeatures": [
        "scripted_spawn_wave"
      ],
      "content": {
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
    },
    {
      "id": "mole-whack-C05",
      "stageNumber": 5,
      "title": "假象训练",
      "difficulty": 5,
      "goalStatement": "识别假目标，并在有限窗口稳定得分",
      "decision": "敲有效目标或主动忽略炸弹/假目标",
      "practicedSkill": "放弃疑似陷阱，保留命中率",
      "discovery": "假目标不提供分数且打中扣一次评价",
      "targetDurationSec": [
        34,
        44
      ],
      "requiredFeatures": [
        "scripted_spawn_wave"
      ],
      "content": {
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
    },
    {
      "id": "mole-whack-C06",
      "stageNumber": 6,
      "title": "洞口终考",
      "difficulty": 6,
      "goalStatement": "命中10个有效目标，其中金鼠≥3且零炸弹",
      "decision": "敲有效目标或主动忽略炸弹/假目标",
      "practicedSkill": "分清优先级，比高频无脑点击更有效",
      "discovery": "终局综合金鼠、炸弹和假目标规律",
      "targetDurationSec": [
        38,
        48
      ],
      "requiredFeatures": [
        "scripted_spawn_wave"
      ],
      "content": {
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
    }
  ]
};
