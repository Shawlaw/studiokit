/* 生成物：由 tools/arcade_09_data.mjs 从 docs/arcade/0.9/levels/gravity-flip.json 生成；不要手改。 */
window.ArcadeChallengeData = window.ArcadeChallengeData || {};
window.ArcadeChallengeData['gravity-flip'] = {
  "schemaVersion": "1.0.0",
  "gameId": "gravity-flip",
  "gameName": "重力翻转",
  "packVersion": "0.9.0-design-v1",
  "stages": [
    {
      "id": "gravity-flip-C01",
      "stageNumber": 1,
      "title": "第一次翻转",
      "difficulty": 1,
      "goalStatement": "从起点通过全部固定尖刺并抵达终点",
      "decision": "先保持当前安全侧还是提前翻转",
      "practicedSkill": "认识两次翻转动作的竖向抵达时间",
      "discovery": "至少提前350逻辑距离看到下一障碍",
      "targetDurationSec": [
        45,
        115
      ],
      "requiredFeatures": [
        "fixed_obstacle_sequence"
      ],
      "content": {
        "coordinates": "世界 x 单位 px，player固定屏幕 x=112，障碍的世界x是首次进入场景的路标，不是生成时相机x；场景需换算 cameraOffset",
        "distanceToFinish": 2200,
        "scrollSpeedPxSec": 260,
        "gravity": 2100,
        "obstacles": [
          {
            "id": "o1",
            "x": 520,
            "side": "floor",
            "height": 145,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o2",
            "x": 1050,
            "side": "ceiling",
            "height": 145,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o3",
            "x": 1570,
            "side": "floor",
            "height": 145,
            "width": 42,
            "telegraphLeadPx": 360
          }
        ],
        "recommendedFlipWindows": [
          {
            "xCenter": 250,
            "toward": "ceiling",
            "tolerancePx": 70
          },
          {
            "xCenter": 790,
            "toward": "floor",
            "tolerancePx": 70
          },
          {
            "xCenter": 1310,
            "toward": "ceiling",
            "tolerancePx": 70
          }
        ],
        "bonusStars": [],
        "startGravity": "floor",
        "win": "pass finish marker alive",
        "collision": "lives=2; collision respawn at most recent safe segment, no auto-use shield"
      }
    },
    {
      "id": "gravity-flip-C02",
      "stageNumber": 2,
      "title": "双连拍",
      "difficulty": 2,
      "goalStatement": "从起点通过全部固定尖刺并抵达终点",
      "decision": "先保持当前安全侧还是提前翻转",
      "practicedSkill": "连续同侧障碍不应机械连续翻转",
      "discovery": "空中停留在安全天花板也是策略",
      "targetDurationSec": [
        45,
        115
      ],
      "requiredFeatures": [
        "fixed_obstacle_sequence"
      ],
      "content": {
        "coordinates": "世界 x 单位 px，player固定屏幕 x=112，障碍的世界x是首次进入场景的路标，不是生成时相机x；场景需换算 cameraOffset",
        "distanceToFinish": 2200,
        "scrollSpeedPxSec": 260,
        "gravity": 2100,
        "obstacles": [
          {
            "id": "o1",
            "x": 480,
            "side": "floor",
            "height": 160,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o2",
            "x": 890,
            "side": "floor",
            "height": 160,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o3",
            "x": 1430,
            "side": "ceiling",
            "height": 165,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o4",
            "x": 1880,
            "side": "ceiling",
            "height": 165,
            "width": 42,
            "telegraphLeadPx": 360
          }
        ],
        "recommendedFlipWindows": [
          {
            "xCenter": 220,
            "toward": "ceiling",
            "tolerancePx": 70
          },
          {
            "xCenter": 1100,
            "toward": "floor",
            "tolerancePx": 70
          }
        ],
        "bonusStars": [
          {
            "x": 1200,
            "y": 210,
            "required": false
          }
        ],
        "startGravity": "floor",
        "win": "pass finish marker alive",
        "collision": "lives=2; collision respawn at most recent safe segment, no auto-use shield"
      }
    },
    {
      "id": "gravity-flip-C03",
      "stageNumber": 3,
      "title": "上下合奏",
      "difficulty": 3,
      "goalStatement": "从起点通过全部固定尖刺并抵达终点",
      "decision": "先保持当前安全侧还是提前翻转",
      "practicedSkill": "逐个观察交错障碍决定切换时间",
      "discovery": "提前把路线留在另一侧而非临门一脚",
      "targetDurationSec": [
        45,
        115
      ],
      "requiredFeatures": [
        "fixed_obstacle_sequence"
      ],
      "content": {
        "coordinates": "世界 x 单位 px，player固定屏幕 x=112，障碍的世界x是首次进入场景的路标，不是生成时相机x；场景需换算 cameraOffset",
        "distanceToFinish": 2400,
        "scrollSpeedPxSec": 260,
        "gravity": 2100,
        "obstacles": [
          {
            "id": "o1",
            "x": 520,
            "side": "floor",
            "height": 162,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o2",
            "x": 1050,
            "side": "ceiling",
            "height": 162,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o3",
            "x": 1590,
            "side": "floor",
            "height": 170,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o4",
            "x": 2130,
            "side": "ceiling",
            "height": 170,
            "width": 42,
            "telegraphLeadPx": 360
          }
        ],
        "recommendedFlipWindows": [
          {
            "xCenter": 230,
            "toward": "ceiling",
            "tolerancePx": 70
          },
          {
            "xCenter": 740,
            "toward": "floor",
            "tolerancePx": 70
          },
          {
            "xCenter": 1280,
            "toward": "ceiling",
            "tolerancePx": 70
          },
          {
            "xCenter": 1830,
            "toward": "floor",
            "tolerancePx": 70
          }
        ],
        "bonusStars": [
          {
            "x": 1380,
            "y": 180,
            "required": false
          }
        ],
        "startGravity": "floor",
        "win": "pass finish marker alive",
        "collision": "lives=2; collision respawn at most recent safe segment, no auto-use shield"
      }
    },
    {
      "id": "gravity-flip-C04",
      "stageNumber": 4,
      "title": "星之岔路",
      "difficulty": 4,
      "goalStatement": "从起点通过全部固定尖刺并抵达终点",
      "decision": "先保持当前安全侧还是提前翻转",
      "practicedSkill": "两颗星在中层，需要短暂翻转后再回归安全路线",
      "discovery": "奖励是冒险而非必经",
      "targetDurationSec": [
        45,
        115
      ],
      "requiredFeatures": [
        "fixed_obstacle_sequence"
      ],
      "content": {
        "coordinates": "世界 x 单位 px，player固定屏幕 x=112，障碍的世界x是首次进入场景的路标，不是生成时相机x；场景需换算 cameraOffset",
        "distanceToFinish": 2340,
        "scrollSpeedPxSec": 260,
        "gravity": 2100,
        "obstacles": [
          {
            "id": "o1",
            "x": 500,
            "side": "floor",
            "height": 170,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o2",
            "x": 1030,
            "side": "ceiling",
            "height": 170,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o3",
            "x": 1550,
            "side": "floor",
            "height": 170,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o4",
            "x": 2070,
            "side": "ceiling",
            "height": 175,
            "width": 42,
            "telegraphLeadPx": 360
          }
        ],
        "recommendedFlipWindows": [
          {
            "xCenter": 220,
            "toward": "ceiling",
            "tolerancePx": 70
          },
          {
            "xCenter": 730,
            "toward": "floor",
            "tolerancePx": 70
          },
          {
            "xCenter": 1260,
            "toward": "ceiling",
            "tolerancePx": 70
          },
          {
            "xCenter": 1800,
            "toward": "floor",
            "tolerancePx": 70
          }
        ],
        "bonusStars": [
          {
            "x": 850,
            "y": 245,
            "required": false
          },
          {
            "x": 1390,
            "y": 410,
            "required": false
          }
        ],
        "startGravity": "floor",
        "win": "pass finish marker alive",
        "collision": "lives=2; collision respawn at most recent safe segment, no auto-use shield"
      }
    },
    {
      "id": "gravity-flip-C05",
      "stageNumber": 5,
      "title": "双窄门",
      "difficulty": 5,
      "goalStatement": "从起点通过全部固定尖刺并抵达终点",
      "decision": "先保持当前安全侧还是提前翻转",
      "practicedSkill": "障碍高度明显增加但预告更早",
      "discovery": "练习观察到行动的稳定延迟",
      "targetDurationSec": [
        45,
        115
      ],
      "requiredFeatures": [
        "fixed_obstacle_sequence"
      ],
      "content": {
        "coordinates": "世界 x 单位 px，player固定屏幕 x=112，障碍的世界x是首次进入场景的路标，不是生成时相机x；场景需换算 cameraOffset",
        "distanceToFinish": 2320,
        "scrollSpeedPxSec": 260,
        "gravity": 2100,
        "obstacles": [
          {
            "id": "o1",
            "x": 490,
            "side": "floor",
            "height": 190,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o2",
            "x": 990,
            "side": "ceiling",
            "height": 190,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o3",
            "x": 1510,
            "side": "floor",
            "height": 205,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o4",
            "x": 2050,
            "side": "ceiling",
            "height": 205,
            "width": 42,
            "telegraphLeadPx": 360
          }
        ],
        "recommendedFlipWindows": [
          {
            "xCenter": 210,
            "toward": "ceiling",
            "tolerancePx": 70
          },
          {
            "xCenter": 690,
            "toward": "floor",
            "tolerancePx": 70
          },
          {
            "xCenter": 1220,
            "toward": "ceiling",
            "tolerancePx": 70
          },
          {
            "xCenter": 1740,
            "toward": "floor",
            "tolerancePx": 70
          }
        ],
        "bonusStars": [],
        "startGravity": "floor",
        "win": "pass finish marker alive",
        "collision": "lives=2; collision respawn at most recent safe segment, no auto-use shield"
      }
    },
    {
      "id": "gravity-flip-C06",
      "stageNumber": 6,
      "title": "重力终章",
      "difficulty": 6,
      "goalStatement": "从起点通过全部固定尖刺并抵达终点",
      "decision": "先保持当前安全侧还是提前翻转",
      "practicedSkill": "交错障碍+一次中间奖励路线选择",
      "discovery": "目标是完成清晰的动作序列，不靠纯随机",
      "targetDurationSec": [
        45,
        115
      ],
      "requiredFeatures": [
        "fixed_obstacle_sequence"
      ],
      "content": {
        "coordinates": "世界 x 单位 px，player固定屏幕 x=112，障碍的世界x是首次进入场景的路标，不是生成时相机x；场景需换算 cameraOffset",
        "distanceToFinish": 2530,
        "scrollSpeedPxSec": 260,
        "gravity": 2100,
        "obstacles": [
          {
            "id": "o1",
            "x": 500,
            "side": "floor",
            "height": 155,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o2",
            "x": 940,
            "side": "ceiling",
            "height": 165,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o3",
            "x": 1370,
            "side": "floor",
            "height": 165,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o4",
            "x": 1810,
            "side": "ceiling",
            "height": 185,
            "width": 42,
            "telegraphLeadPx": 360
          },
          {
            "id": "o5",
            "x": 2260,
            "side": "floor",
            "height": 195,
            "width": 42,
            "telegraphLeadPx": 360
          }
        ],
        "recommendedFlipWindows": [
          {
            "xCenter": 210,
            "toward": "ceiling",
            "tolerancePx": 70
          },
          {
            "xCenter": 650,
            "toward": "floor",
            "tolerancePx": 70
          },
          {
            "xCenter": 1090,
            "toward": "ceiling",
            "tolerancePx": 70
          },
          {
            "xCenter": 1520,
            "toward": "floor",
            "tolerancePx": 70
          },
          {
            "xCenter": 1960,
            "toward": "ceiling",
            "tolerancePx": 70
          }
        ],
        "bonusStars": [
          {
            "x": 730,
            "y": 270,
            "required": false
          },
          {
            "x": 1600,
            "y": 380,
            "required": false
          }
        ],
        "startGravity": "floor",
        "win": "pass finish marker alive",
        "collision": "lives=2; collision respawn at most recent safe segment, no auto-use shield"
      }
    }
  ]
};
