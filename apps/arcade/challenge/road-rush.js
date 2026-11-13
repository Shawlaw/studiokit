/* 生成物：由 tools/arcade_09_data.mjs 从 docs/arcade/0.9/levels/road-rush.json 生成；不要手改。 */
window.ArcadeChallengeData = window.ArcadeChallengeData || {};
window.ArcadeChallengeData['road-rush'] = {
  "schemaVersion": "1.0.0",
  "gameId": "road-rush",
  "gameName": "极速车道",
  "packVersion": "0.9.0-design-v1",
  "stages": [
    {
      "id": "road-rush-C01",
      "stageNumber": 1,
      "title": "入门超车",
      "difficulty": 1,
      "goalStatement": "识别阻挡车道并提前改变车道",
      "decision": "避让是硬目标，近距超车只增加评价",
      "practicedSkill": "慢车停留的车道一段时间保持不变",
      "discovery": "分数奖励安全超车而不是随机变道",
      "targetDurationSec": [
        20,
        75
      ],
      "requiredFeatures": [
        "fixed_traffic_timeline",
        "time_expanded_lane_validator"
      ],
      "content": {
        "laneCount": 4,
        "slotDurationSec": 1.15,
        "laneChangeTimeSec": 0.22,
        "startLane": 1,
        "timeline": [
          {
            "slot": 1,
            "atSec": 0,
            "occupiedLanes": [
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          },
          {
            "slot": 2,
            "atSec": 1.15,
            "occupiedLanes": [
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          },
          {
            "slot": 3,
            "atSec": 2.3,
            "occupiedLanes": [
              1
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 4,
            "atSec": 3.45,
            "occupiedLanes": [
              1
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 5,
            "atSec": 4.6,
            "occupiedLanes": [
              0
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1
            ]
          },
          {
            "slot": 6,
            "atSec": 5.75,
            "occupiedLanes": [
              0
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1
            ]
          },
          {
            "slot": 7,
            "atSec": 6.9,
            "occupiedLanes": [
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              2
            ]
          },
          {
            "slot": 8,
            "atSec": 8.05,
            "occupiedLanes": [
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              2
            ]
          },
          {
            "slot": 9,
            "atSec": 9.2,
            "occupiedLanes": [
              1
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 10,
            "atSec": 10.35,
            "occupiedLanes": [
              1
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 11,
            "atSec": 11.5,
            "occupiedLanes": [
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          },
          {
            "slot": 12,
            "atSec": 12.65,
            "occupiedLanes": [
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          }
        ],
        "goal": {
          "type": "survive-all-slots",
          "minDistanceMeters": 540
        },
        "scoreRules": {
          "passBonus": 10,
          "nearPassBonus": 5,
          "noDamageGold": true
        },
        "spawnerPolicy": "challenge only; disable classic random spawn while timeline active",
        "pathProofModel": "at each slot lane must not be occupied, consecutive lane indices differ ≤1; physics transitions must also be tested"
      }
    },
    {
      "id": "road-rush-C02",
      "stageNumber": 2,
      "title": "左右交替",
      "difficulty": 2,
      "goalStatement": "交错车流中识别下一秒的安全区域",
      "decision": "避让是硬目标，近距超车只增加评价",
      "practicedSkill": "贴近拥堵时可以选择暂留安全车道",
      "discovery": "看预告比最后时刻换道更好",
      "targetDurationSec": [
        20,
        75
      ],
      "requiredFeatures": [
        "fixed_traffic_timeline",
        "time_expanded_lane_validator"
      ],
      "content": {
        "laneCount": 4,
        "slotDurationSec": 1.15,
        "laneChangeTimeSec": 0.22,
        "startLane": 1,
        "timeline": [
          {
            "slot": 1,
            "atSec": 0,
            "occupiedLanes": [
              1
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 2,
            "atSec": 1.15,
            "occupiedLanes": [
              1,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              3
            ]
          },
          {
            "slot": 3,
            "atSec": 2.3,
            "occupiedLanes": [
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          },
          {
            "slot": 4,
            "atSec": 3.45,
            "occupiedLanes": [
              2,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1
            ]
          },
          {
            "slot": 5,
            "atSec": 4.6,
            "occupiedLanes": [
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              2
            ]
          },
          {
            "slot": 6,
            "atSec": 5.75,
            "occupiedLanes": [
              0
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1
            ]
          },
          {
            "slot": 7,
            "atSec": 6.9,
            "occupiedLanes": [
              0,
              1
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              2
            ]
          },
          {
            "slot": 8,
            "atSec": 8.05,
            "occupiedLanes": [
              1
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 9,
            "atSec": 9.2,
            "occupiedLanes": [
              1,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              3
            ]
          },
          {
            "slot": 10,
            "atSec": 10.35,
            "occupiedLanes": [
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          },
          {
            "slot": 11,
            "atSec": 11.5,
            "occupiedLanes": [
              1,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              3
            ]
          },
          {
            "slot": 12,
            "atSec": 12.65,
            "occupiedLanes": [
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              2
            ]
          }
        ],
        "goal": {
          "type": "survive-all-slots",
          "minDistanceMeters": 680
        },
        "scoreRules": {
          "passBonus": 10,
          "nearPassBonus": 5,
          "noDamageGold": true
        },
        "spawnerPolicy": "challenge only; disable classic random spawn while timeline active",
        "pathProofModel": "at each slot lane must not be occupied, consecutive lane indices differ ≤1; physics transitions must also be tested"
      }
    },
    {
      "id": "road-rush-C03",
      "stageNumber": 3,
      "title": "施工收窄",
      "difficulty": 3,
      "goalStatement": "提前避开占据两个车道的施工路段",
      "decision": "避让是硬目标，近距超车只增加评价",
      "practicedSkill": "中途选择左绕还是右绕",
      "discovery": "施工障碍不应瞬间刷新",
      "targetDurationSec": [
        20,
        75
      ],
      "requiredFeatures": [
        "fixed_traffic_timeline",
        "time_expanded_lane_validator"
      ],
      "content": {
        "laneCount": 4,
        "slotDurationSec": 1.15,
        "laneChangeTimeSec": 0.22,
        "startLane": 1,
        "timeline": [
          {
            "slot": 1,
            "atSec": 0,
            "occupiedLanes": [
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              2
            ]
          },
          {
            "slot": 2,
            "atSec": 1.15,
            "occupiedLanes": [
              2,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1
            ]
          },
          {
            "slot": 3,
            "atSec": 2.3,
            "occupiedLanes": [
              2,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1
            ]
          },
          {
            "slot": 4,
            "atSec": 3.45,
            "occupiedLanes": [
              1,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 5,
            "atSec": 4.6,
            "occupiedLanes": [
              1,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              3
            ]
          },
          {
            "slot": 6,
            "atSec": 5.75,
            "occupiedLanes": [
              1,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              3
            ]
          },
          {
            "slot": 7,
            "atSec": 6.9,
            "occupiedLanes": [
              0,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          },
          {
            "slot": 8,
            "atSec": 8.05,
            "occupiedLanes": [
              0,
              1
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              2
            ]
          },
          {
            "slot": 9,
            "atSec": 9.2,
            "occupiedLanes": [
              0,
              1
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              2
            ]
          },
          {
            "slot": 10,
            "atSec": 10.35,
            "occupiedLanes": [
              0
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1
            ]
          },
          {
            "slot": 11,
            "atSec": 11.5,
            "occupiedLanes": [
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              2
            ]
          },
          {
            "slot": 12,
            "atSec": 12.65,
            "occupiedLanes": [
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              2
            ]
          }
        ],
        "goal": {
          "type": "survive-all-slots",
          "minDistanceMeters": 820
        },
        "scoreRules": {
          "passBonus": 10,
          "nearPassBonus": 5,
          "noDamageGold": true
        },
        "spawnerPolicy": "challenge only; disable classic random spawn while timeline active",
        "pathProofModel": "at each slot lane must not be occupied, consecutive lane indices differ ≤1; physics transitions must also be tested"
      }
    },
    {
      "id": "road-rush-C04",
      "stageNumber": 4,
      "title": "车队夹缝",
      "difficulty": 4,
      "goalStatement": "以两车道内的安全空间连续变道",
      "decision": "避让是硬目标，近距超车只增加评价",
      "practicedSkill": "放弃贴身超车奖励或挑战高分",
      "discovery": "优先看未来两个位置而不是当前空挡",
      "targetDurationSec": [
        20,
        75
      ],
      "requiredFeatures": [
        "fixed_traffic_timeline",
        "time_expanded_lane_validator"
      ],
      "content": {
        "laneCount": 4,
        "slotDurationSec": 1.05,
        "laneChangeTimeSec": 0.22,
        "startLane": 1,
        "timeline": [
          {
            "slot": 1,
            "atSec": 0,
            "occupiedLanes": [
              0,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              2
            ]
          },
          {
            "slot": 2,
            "atSec": 1.05,
            "occupiedLanes": [
              0,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              2
            ]
          },
          {
            "slot": 3,
            "atSec": 2.1,
            "occupiedLanes": [
              1,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 4,
            "atSec": 3.15,
            "occupiedLanes": [
              1,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 5,
            "atSec": 4.2,
            "occupiedLanes": [
              0,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          },
          {
            "slot": 6,
            "atSec": 5.25,
            "occupiedLanes": [
              0,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          },
          {
            "slot": 7,
            "atSec": 6.3,
            "occupiedLanes": [
              0,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              2
            ]
          },
          {
            "slot": 8,
            "atSec": 7.35,
            "occupiedLanes": [
              1,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 9,
            "atSec": 8.4,
            "occupiedLanes": [
              1,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 10,
            "atSec": 9.45,
            "occupiedLanes": [
              2,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1
            ]
          },
          {
            "slot": 11,
            "atSec": 10.5,
            "occupiedLanes": [
              2,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1
            ]
          },
          {
            "slot": 12,
            "atSec": 11.55,
            "occupiedLanes": [
              0,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              2
            ]
          }
        ],
        "goal": {
          "type": "survive-all-slots",
          "minDistanceMeters": 960
        },
        "scoreRules": {
          "passBonus": 10,
          "nearPassBonus": 5,
          "noDamageGold": true
        },
        "spawnerPolicy": "challenge only; disable classic random spawn while timeline active",
        "pathProofModel": "at each slot lane must not be occupied, consecutive lane indices differ ≤1; physics transitions must also be tested"
      }
    },
    {
      "id": "road-rush-C05",
      "stageNumber": 5,
      "title": "近距奖励",
      "difficulty": 5,
      "goalStatement": "在保命路线之外选择近车道超车积分",
      "decision": "避让是硬目标，近距超车只增加评价",
      "practicedSkill": "拥堵车道额外加分但不强迫冒险",
      "discovery": "看懂奖励门牌并在恰当时刻避开",
      "targetDurationSec": [
        20,
        75
      ],
      "requiredFeatures": [
        "fixed_traffic_timeline",
        "time_expanded_lane_validator"
      ],
      "content": {
        "laneCount": 4,
        "slotDurationSec": 1.05,
        "laneChangeTimeSec": 0.22,
        "startLane": 1,
        "timeline": [
          {
            "slot": 1,
            "atSec": 0,
            "occupiedLanes": [
              0
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1
            ]
          },
          {
            "slot": 2,
            "atSec": 1.05,
            "occupiedLanes": [
              0,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          },
          {
            "slot": 3,
            "atSec": 2.1,
            "occupiedLanes": [
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          },
          {
            "slot": 4,
            "atSec": 3.15,
            "occupiedLanes": [
              1,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              3
            ]
          },
          {
            "slot": 5,
            "atSec": 4.2,
            "occupiedLanes": [
              1
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 6,
            "atSec": 5.25,
            "occupiedLanes": [
              1,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 7,
            "atSec": 6.3,
            "occupiedLanes": [
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              2
            ]
          },
          {
            "slot": 8,
            "atSec": 7.35,
            "occupiedLanes": [
              2,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1
            ]
          },
          {
            "slot": 9,
            "atSec": 8.4,
            "occupiedLanes": [
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          },
          {
            "slot": 10,
            "atSec": 9.45,
            "occupiedLanes": [
              0,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          },
          {
            "slot": 11,
            "atSec": 10.5,
            "occupiedLanes": [
              0
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1
            ]
          },
          {
            "slot": 12,
            "atSec": 11.55,
            "occupiedLanes": [
              0,
              1
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              2
            ]
          }
        ],
        "goal": {
          "type": "survive-all-slots",
          "minDistanceMeters": 1100
        },
        "scoreRules": {
          "passBonus": 10,
          "nearPassBonus": 5,
          "noDamageGold": true
        },
        "spawnerPolicy": "challenge only; disable classic random spawn while timeline active",
        "pathProofModel": "at each slot lane must not be occupied, consecutive lane indices differ ≤1; physics transitions must also be tested"
      }
    },
    {
      "id": "road-rush-C06",
      "stageNumber": 6,
      "title": "最终路书",
      "difficulty": 6,
      "goalStatement": "持续读出拥堵变化，抵达最后路标",
      "decision": "避让是硬目标，近距超车只增加评价",
      "practicedSkill": "先作安全变道规划，再考虑高分贴近车流",
      "discovery": "将前五关的选择合并为连续动作",
      "targetDurationSec": [
        20,
        75
      ],
      "requiredFeatures": [
        "fixed_traffic_timeline",
        "time_expanded_lane_validator"
      ],
      "content": {
        "laneCount": 4,
        "slotDurationSec": 1.05,
        "laneChangeTimeSec": 0.22,
        "startLane": 1,
        "timeline": [
          {
            "slot": 1,
            "atSec": 0,
            "occupiedLanes": [
              0,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              2
            ]
          },
          {
            "slot": 2,
            "atSec": 1.05,
            "occupiedLanes": [
              0,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              2
            ]
          },
          {
            "slot": 3,
            "atSec": 2.1,
            "occupiedLanes": [
              1,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 4,
            "atSec": 3.15,
            "occupiedLanes": [
              1,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              3
            ]
          },
          {
            "slot": 5,
            "atSec": 4.2,
            "occupiedLanes": [
              0,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          },
          {
            "slot": 6,
            "atSec": 5.25,
            "occupiedLanes": [
              0,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          },
          {
            "slot": 7,
            "atSec": 6.3,
            "occupiedLanes": [
              1,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 8,
            "atSec": 7.35,
            "occupiedLanes": [
              1,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 9,
            "atSec": 8.4,
            "occupiedLanes": [
              0,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          },
          {
            "slot": 10,
            "atSec": 9.45,
            "occupiedLanes": [
              0,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          },
          {
            "slot": 11,
            "atSec": 10.5,
            "occupiedLanes": [
              1,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 12,
            "atSec": 11.55,
            "occupiedLanes": [
              1,
              3
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              0,
              2
            ]
          },
          {
            "slot": 13,
            "atSec": 12.6,
            "occupiedLanes": [
              0,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          },
          {
            "slot": 14,
            "atSec": 13.65,
            "occupiedLanes": [
              0,
              2
            ],
            "telegraphLeadSec": 1.5,
            "optionalNearPassBonusLanes": [
              1,
              3
            ]
          }
        ],
        "goal": {
          "type": "survive-all-slots",
          "minDistanceMeters": 1240
        },
        "scoreRules": {
          "passBonus": 10,
          "nearPassBonus": 5,
          "noDamageGold": true
        },
        "spawnerPolicy": "challenge only; disable classic random spawn while timeline active",
        "pathProofModel": "at each slot lane must not be occupied, consecutive lane indices differ ≤1; physics transitions must also be tested"
      }
    }
  ]
};
