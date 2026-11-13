/* 生成物：由 tools/arcade_09_data.mjs 从 docs/arcade/0.9/levels/snake-run.json 生成；不要手改。 */
window.ArcadeChallengeData = window.ArcadeChallengeData || {};
window.ArcadeChallengeData['snake-run'] = {
  "schemaVersion": "1.0.0",
  "gameId": "snake-run",
  "gameName": "贪吃蛇",
  "packVersion": "0.9.0-design-v1",
  "stages": [
    {
      "id": "snake-run-C01",
      "stageNumber": 1,
      "title": "果园初识",
      "difficulty": 1,
      "goalStatement": "读懂长度、转弯和正向移动",
      "decision": "绕路更安全还是尝试短路节省步数",
      "practicedSkill": "保持出路，不要向自身尾部硬反转",
      "discovery": "安全区有明显回环空间",
      "targetDurationSec": [
        40,
        180
      ],
      "requiredFeatures": [
        "fixed_snake_map",
        "scripted_fruit_queue",
        "direction_queue"
      ],
      "content": {
        "grid": {
          "cols": 18,
          "rows": 18,
          "coords": "左上(0,0)，x向右，y向下"
        },
        "initialSnake": [
          [
            3,
            3
          ],
          [
            2,
            3
          ],
          [
            1,
            3
          ]
        ],
        "initialDirection": "R",
        "walls": [
          [
            3,
            11
          ],
          [
            4,
            11
          ],
          [
            5,
            11
          ],
          [
            6,
            11
          ],
          [
            7,
            11
          ],
          [
            9,
            11
          ],
          [
            10,
            11
          ],
          [
            11,
            11
          ],
          [
            12,
            11
          ],
          [
            13,
            11
          ],
          [
            14,
            11
          ]
        ],
        "fruitQueue": [
          [
            7,
            3
          ],
          [
            9,
            6
          ],
          [
            8,
            10
          ]
        ],
        "fruitSpawnMode": "scripted-once, only next fruit visible; never random",
        "stepIntervalMs": 230,
        "win": {
          "type": "collect-in-order",
          "fruitCount": 3
        },
        "lose": {
          "type": "wall-or-body",
          "lives": 1
        },
        "turnBuffer": "最大队列2方向，按蛇每一逻辑步出队，拒绝反向180度",
        "bonus": "在不碰任何障碍前提下减少总步数"
      }
    },
    {
      "id": "snake-run-C02",
      "stageNumber": 2,
      "title": "中央小门",
      "difficulty": 2,
      "goalStatement": "选择跨墙缺口，而不是贴墙盲走",
      "decision": "绕路更安全还是尝试短路节省步数",
      "practicedSkill": "提前把蛇头朝向门口",
      "discovery": "找到中央唯一可通过缺口",
      "targetDurationSec": [
        40,
        180
      ],
      "requiredFeatures": [
        "fixed_snake_map",
        "scripted_fruit_queue",
        "direction_queue"
      ],
      "content": {
        "grid": {
          "cols": 18,
          "rows": 18,
          "coords": "左上(0,0)，x向右，y向下"
        },
        "initialSnake": [
          [
            3,
            3
          ],
          [
            2,
            3
          ],
          [
            1,
            3
          ]
        ],
        "initialDirection": "R",
        "walls": [
          [
            8,
            2
          ],
          [
            8,
            3
          ],
          [
            8,
            4
          ],
          [
            8,
            5
          ],
          [
            8,
            6
          ],
          [
            8,
            8
          ],
          [
            8,
            9
          ],
          [
            8,
            10
          ],
          [
            8,
            11
          ],
          [
            8,
            12
          ],
          [
            8,
            13
          ]
        ],
        "fruitQueue": [
          [
            6,
            5
          ],
          [
            10,
            7
          ],
          [
            12,
            11
          ],
          [
            4,
            13
          ]
        ],
        "fruitSpawnMode": "scripted-once, only next fruit visible; never random",
        "stepIntervalMs": 230,
        "win": {
          "type": "collect-in-order",
          "fruitCount": 4
        },
        "lose": {
          "type": "wall-or-body",
          "lives": 1
        },
        "turnBuffer": "最大队列2方向，按蛇每一逻辑步出队，拒绝反向180度",
        "bonus": "在不碰任何障碍前提下减少总步数"
      }
    },
    {
      "id": "snake-run-C03",
      "stageNumber": 3,
      "title": "双柱回廊",
      "difficulty": 3,
      "goalStatement": "先观察柱子的出入口",
      "decision": "绕路更安全还是尝试短路节省步数",
      "practicedSkill": "用转向序列穿过狭窄走廊",
      "discovery": "上门/下门构成不同路线",
      "targetDurationSec": [
        40,
        180
      ],
      "requiredFeatures": [
        "fixed_snake_map",
        "scripted_fruit_queue",
        "direction_queue"
      ],
      "content": {
        "grid": {
          "cols": 18,
          "rows": 18,
          "coords": "左上(0,0)，x向右，y向下"
        },
        "initialSnake": [
          [
            3,
            3
          ],
          [
            2,
            3
          ],
          [
            1,
            3
          ]
        ],
        "initialDirection": "R",
        "walls": [
          [
            6,
            3
          ],
          [
            6,
            4
          ],
          [
            6,
            5
          ],
          [
            6,
            7
          ],
          [
            6,
            8
          ],
          [
            6,
            9
          ],
          [
            6,
            11
          ],
          [
            6,
            12
          ],
          [
            11,
            3
          ],
          [
            11,
            4
          ],
          [
            11,
            5
          ],
          [
            11,
            7
          ],
          [
            11,
            8
          ],
          [
            11,
            9
          ],
          [
            11,
            11
          ],
          [
            11,
            12
          ]
        ],
        "fruitQueue": [
          [
            4,
            6
          ],
          [
            8,
            6
          ],
          [
            13,
            10
          ],
          [
            14,
            13
          ]
        ],
        "fruitSpawnMode": "scripted-once, only next fruit visible; never random",
        "stepIntervalMs": 230,
        "win": {
          "type": "collect-in-order",
          "fruitCount": 4
        },
        "lose": {
          "type": "wall-or-body",
          "lives": 1
        },
        "turnBuffer": "最大队列2方向，按蛇每一逻辑步出队，拒绝反向180度",
        "bonus": "在不碰任何障碍前提下减少总步数"
      }
    },
    {
      "id": "snake-run-C04",
      "stageNumber": 4,
      "title": "环形果园",
      "difficulty": 4,
      "goalStatement": "从两个门往返内外环",
      "decision": "绕路更安全还是尝试短路节省步数",
      "practicedSkill": "绕行不等于坏选择，保护回头空间",
      "discovery": "门分布构成内外两种通道",
      "targetDurationSec": [
        40,
        180
      ],
      "requiredFeatures": [
        "fixed_snake_map",
        "scripted_fruit_queue",
        "direction_queue"
      ],
      "content": {
        "grid": {
          "cols": 18,
          "rows": 18,
          "coords": "左上(0,0)，x向右，y向下"
        },
        "initialSnake": [
          [
            3,
            3
          ],
          [
            2,
            3
          ],
          [
            1,
            3
          ]
        ],
        "initialDirection": "R",
        "walls": [
          [
            4,
            4
          ],
          [
            5,
            4
          ],
          [
            6,
            4
          ],
          [
            7,
            4
          ],
          [
            9,
            4
          ],
          [
            10,
            4
          ],
          [
            11,
            4
          ],
          [
            12,
            4
          ],
          [
            13,
            4
          ],
          [
            4,
            13
          ],
          [
            5,
            13
          ],
          [
            6,
            13
          ],
          [
            7,
            13
          ],
          [
            8,
            13
          ],
          [
            9,
            13
          ],
          [
            10,
            13
          ],
          [
            11,
            13
          ],
          [
            12,
            13
          ],
          [
            13,
            13
          ],
          [
            4,
            5
          ],
          [
            4,
            6
          ],
          [
            4,
            7
          ],
          [
            4,
            8
          ],
          [
            4,
            9
          ],
          [
            4,
            10
          ],
          [
            4,
            11
          ],
          [
            4,
            12
          ],
          [
            13,
            5
          ],
          [
            13,
            6
          ],
          [
            13,
            7
          ],
          [
            13,
            8
          ],
          [
            13,
            10
          ],
          [
            13,
            11
          ],
          [
            13,
            12
          ]
        ],
        "fruitQueue": [
          [
            7,
            3
          ],
          [
            10,
            7
          ],
          [
            15,
            9
          ],
          [
            8,
            15
          ]
        ],
        "fruitSpawnMode": "scripted-once, only next fruit visible; never random",
        "stepIntervalMs": 200,
        "win": {
          "type": "collect-in-order",
          "fruitCount": 4
        },
        "lose": {
          "type": "wall-or-body",
          "lives": 1
        },
        "turnBuffer": "最大队列2方向，按蛇每一逻辑步出队，拒绝反向180度",
        "bonus": "在不碰任何障碍前提下减少总步数"
      }
    },
    {
      "id": "snake-run-C05",
      "stageNumber": 5,
      "title": "折叠花田",
      "difficulty": 5,
      "goalStatement": "S形通道让简单贪心失效",
      "decision": "绕路更安全还是尝试短路节省步数",
      "practicedSkill": "每次取果前规划一个出口",
      "discovery": "不同缺口可以避免被封死",
      "targetDurationSec": [
        40,
        180
      ],
      "requiredFeatures": [
        "fixed_snake_map",
        "scripted_fruit_queue",
        "direction_queue"
      ],
      "content": {
        "grid": {
          "cols": 18,
          "rows": 18,
          "coords": "左上(0,0)，x向右，y向下"
        },
        "initialSnake": [
          [
            3,
            3
          ],
          [
            2,
            3
          ],
          [
            1,
            3
          ]
        ],
        "initialDirection": "R",
        "walls": [
          [
            2,
            6
          ],
          [
            3,
            6
          ],
          [
            5,
            6
          ],
          [
            6,
            6
          ],
          [
            7,
            6
          ],
          [
            8,
            6
          ],
          [
            9,
            6
          ],
          [
            10,
            6
          ],
          [
            11,
            6
          ],
          [
            12,
            6
          ],
          [
            13,
            6
          ],
          [
            14,
            6
          ],
          [
            2,
            10
          ],
          [
            3,
            10
          ],
          [
            4,
            10
          ],
          [
            5,
            10
          ],
          [
            6,
            10
          ],
          [
            7,
            10
          ],
          [
            8,
            10
          ],
          [
            9,
            10
          ],
          [
            10,
            10
          ],
          [
            11,
            10
          ],
          [
            12,
            10
          ],
          [
            14,
            10
          ],
          [
            2,
            14
          ],
          [
            3,
            14
          ],
          [
            4,
            14
          ],
          [
            6,
            14
          ],
          [
            7,
            14
          ],
          [
            8,
            14
          ],
          [
            9,
            14
          ],
          [
            10,
            14
          ],
          [
            11,
            14
          ],
          [
            12,
            14
          ],
          [
            13,
            14
          ],
          [
            14,
            14
          ]
        ],
        "fruitQueue": [
          [
            2,
            4
          ],
          [
            6,
            8
          ],
          [
            14,
            12
          ],
          [
            8,
            16
          ]
        ],
        "fruitSpawnMode": "scripted-once, only next fruit visible; never random",
        "stepIntervalMs": 200,
        "win": {
          "type": "collect-in-order",
          "fruitCount": 4
        },
        "lose": {
          "type": "wall-or-body",
          "lives": 1
        },
        "turnBuffer": "最大队列2方向，按蛇每一逻辑步出队，拒绝反向180度",
        "bonus": "在不碰任何障碍前提下减少总步数"
      }
    },
    {
      "id": "snake-run-C06",
      "stageNumber": 6,
      "title": "迷阵终局",
      "difficulty": 6,
      "goalStatement": "在多门迷宫中兼顾蛇身变长",
      "decision": "绕路更安全还是尝试短路节省步数",
      "practicedSkill": "长蛇完成后几次转弯的安全距离",
      "discovery": "记住门的位置减少无效绕行",
      "targetDurationSec": [
        40,
        180
      ],
      "requiredFeatures": [
        "fixed_snake_map",
        "scripted_fruit_queue",
        "direction_queue"
      ],
      "content": {
        "grid": {
          "cols": 18,
          "rows": 18,
          "coords": "左上(0,0)，x向右，y向下"
        },
        "initialSnake": [
          [
            3,
            3
          ],
          [
            2,
            3
          ],
          [
            1,
            3
          ]
        ],
        "initialDirection": "R",
        "walls": [
          [
            5,
            3
          ],
          [
            5,
            4
          ],
          [
            5,
            5
          ],
          [
            5,
            7
          ],
          [
            5,
            8
          ],
          [
            5,
            9
          ],
          [
            5,
            10
          ],
          [
            5,
            11
          ],
          [
            5,
            12
          ],
          [
            5,
            13
          ],
          [
            5,
            14
          ],
          [
            5,
            15
          ],
          [
            9,
            2
          ],
          [
            9,
            3
          ],
          [
            9,
            4
          ],
          [
            9,
            5
          ],
          [
            9,
            6
          ],
          [
            9,
            7
          ],
          [
            9,
            8
          ],
          [
            9,
            9
          ],
          [
            9,
            10
          ],
          [
            9,
            12
          ],
          [
            9,
            13
          ],
          [
            9,
            14
          ],
          [
            13,
            3
          ],
          [
            13,
            4
          ],
          [
            13,
            5
          ],
          [
            13,
            6
          ],
          [
            13,
            7
          ],
          [
            13,
            9
          ],
          [
            13,
            10
          ],
          [
            13,
            11
          ],
          [
            13,
            12
          ],
          [
            13,
            13
          ],
          [
            13,
            14
          ],
          [
            13,
            15
          ]
        ],
        "fruitQueue": [
          [
            4,
            5
          ],
          [
            8,
            6
          ],
          [
            12,
            11
          ],
          [
            15,
            14
          ],
          [
            3,
            15
          ]
        ],
        "fruitSpawnMode": "scripted-once, only next fruit visible; never random",
        "stepIntervalMs": 200,
        "win": {
          "type": "collect-in-order",
          "fruitCount": 5
        },
        "lose": {
          "type": "wall-or-body",
          "lives": 1
        },
        "turnBuffer": "最大队列2方向，按蛇每一逻辑步出队，拒绝反向180度",
        "bonus": "在不碰任何障碍前提下减少总步数"
      }
    }
  ]
};
