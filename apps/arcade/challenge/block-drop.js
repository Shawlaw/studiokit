/* 生成物：由 tools/arcade_09_data.mjs 从 docs/arcade/0.9/levels/block-drop.json 生成；不要手改。 */
window.ArcadeChallengeData = window.ArcadeChallengeData || {};
window.ArcadeChallengeData['block-drop'] = {
  "schemaVersion": "1.0.0",
  "gameId": "block-drop",
  "gameName": "俄罗斯方块",
  "packVersion": "0.9.0-design-v1",
  "supportedFeatures": [
    "puzzle_board_preset",
    "puzzle_piece_queue",
    "clear_line_goal",
    "place_by_place_gravity"
  ],
  "stages": [
    {
      "id": "block-drop-C01",
      "stageNumber": 1,
      "title": "第一道横井",
      "difficulty": 1,
      "goalStatement": "用横向 I 填平一行",
      "decision": "选择摆放方向和顺序（挑战模式固定出块）",
      "practicedSkill": "横向 I 一次清行；不要空场堆叠",
      "discovery": "横井的宽度等于4格",
      "targetDurationSec": [
        25,
        110
      ],
      "requiredFeatures": [
        "puzzle_board_preset",
        "puzzle_piece_queue",
        "clear_line_goal"
      ],
      "content": {
        "boardWidth": 10,
        "boardHeight": 20,
        "boardTopToBottom": [
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "###....###"
        ],
        "pieceQueue": [
          "I"
        ],
        "holdEnabled": false,
        "gravityMode": "place-by-place with no time pressure, hard drop + rotate",
        "spawnPolicy": "only fixed pieceQueue; no bag-7 randomness",
        "initialActivePiece": "I",
        "win": {
          "type": "clear-lines",
          "count": 1,
          "maxPlacedPieces": 1
        },
        "lose": {
          "type": "queue-exhausted-or-top-out",
          "ifGoalUnmet": true
        },
        "pieceDefinitions": {
          "I-H": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              2,
              0
            ],
            [
              3,
              0
            ]
          ],
          "I-V": [
            [
              0,
              0
            ],
            [
              0,
              1
            ],
            [
              0,
              2
            ],
            [
              0,
              3
            ]
          ],
          "O-N": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              0,
              1
            ],
            [
              1,
              1
            ]
          ],
          "T-STEM-DOWN": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              2,
              0
            ],
            [
              1,
              1
            ]
          ]
        },
        "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping.",
        "gravityModel": "place-by-place"
      },
      "contentRevision": "block-drop-C01@0.9.0-design-v1@bdc9009f7e02"
    },
    {
      "id": "block-drop-C02",
      "stageNumber": 2,
      "title": "双行方井",
      "difficulty": 2,
      "goalStatement": "用 O 一次清两行",
      "decision": "选择摆放方向和顺序（挑战模式固定出块）",
      "practicedSkill": "精确移动到中央两格",
      "discovery": "理解O方块落在连续2×2空间",
      "targetDurationSec": [
        25,
        110
      ],
      "requiredFeatures": [
        "puzzle_board_preset",
        "puzzle_piece_queue",
        "clear_line_goal"
      ],
      "content": {
        "boardWidth": 10,
        "boardHeight": 20,
        "boardTopToBottom": [
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "####..####",
          "####..####"
        ],
        "pieceQueue": [
          "O"
        ],
        "holdEnabled": false,
        "gravityMode": "place-by-place with no time pressure, hard drop + rotate",
        "spawnPolicy": "only fixed pieceQueue; no bag-7 randomness",
        "initialActivePiece": "O",
        "win": {
          "type": "clear-lines",
          "count": 2,
          "maxPlacedPieces": 1
        },
        "lose": {
          "type": "queue-exhausted-or-top-out",
          "ifGoalUnmet": true
        },
        "pieceDefinitions": {
          "I-H": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              2,
              0
            ],
            [
              3,
              0
            ]
          ],
          "I-V": [
            [
              0,
              0
            ],
            [
              0,
              1
            ],
            [
              0,
              2
            ],
            [
              0,
              3
            ]
          ],
          "O-N": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              0,
              1
            ],
            [
              1,
              1
            ]
          ],
          "T-STEM-DOWN": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              2,
              0
            ],
            [
              1,
              1
            ]
          ]
        },
        "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping.",
        "gravityModel": "place-by-place"
      },
      "contentRevision": "block-drop-C02@0.9.0-design-v1@2bf369d93c00"
    },
    {
      "id": "block-drop-C03",
      "stageNumber": 3,
      "title": "纵井四消",
      "difficulty": 3,
      "goalStatement": "用竖直 I 清四行",
      "decision": "选择摆放方向和顺序（挑战模式固定出块）",
      "practicedSkill": "需要旋转 I 而非横放",
      "discovery": "知道Tetris四消的井的开法",
      "targetDurationSec": [
        25,
        110
      ],
      "requiredFeatures": [
        "puzzle_board_preset",
        "puzzle_piece_queue",
        "clear_line_goal"
      ],
      "content": {
        "boardWidth": 10,
        "boardHeight": 20,
        "boardTopToBottom": [
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "#####.####",
          "#####.####",
          "#####.####",
          "#####.####"
        ],
        "pieceQueue": [
          "I"
        ],
        "holdEnabled": false,
        "gravityMode": "place-by-place with no time pressure, hard drop + rotate",
        "spawnPolicy": "only fixed pieceQueue; no bag-7 randomness",
        "initialActivePiece": "I",
        "win": {
          "type": "clear-lines",
          "count": 4,
          "maxPlacedPieces": 1
        },
        "lose": {
          "type": "queue-exhausted-or-top-out",
          "ifGoalUnmet": true
        },
        "pieceDefinitions": {
          "I-H": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              2,
              0
            ],
            [
              3,
              0
            ]
          ],
          "I-V": [
            [
              0,
              0
            ],
            [
              0,
              1
            ],
            [
              0,
              2
            ],
            [
              0,
              3
            ]
          ],
          "O-N": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              0,
              1
            ],
            [
              1,
              1
            ]
          ],
          "T-STEM-DOWN": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              2,
              0
            ],
            [
              1,
              1
            ]
          ]
        },
        "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping.",
        "gravityModel": "place-by-place"
      },
      "contentRevision": "block-drop-C03@0.9.0-design-v1@d914a1025a8d"
    },
    {
      "id": "block-drop-C04",
      "stageNumber": 4,
      "title": "两次横修",
      "difficulty": 4,
      "goalStatement": "两个 I 分别落入错开的不同横井",
      "decision": "选择摆放方向和顺序（挑战模式固定出块）",
      "practicedSkill": "先放上层右侧井(列3-6)清一行，再放下层左侧井(列1-4)",
      "discovery": "上层清除后下层井才从上方可达，两 I 落点不同",
      "targetDurationSec": [
        25,
        110
      ],
      "requiredFeatures": [
        "puzzle_board_preset",
        "puzzle_piece_queue",
        "clear_line_goal"
      ],
      "content": {
        "boardWidth": 10,
        "boardHeight": 20,
        "boardTopToBottom": [
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "###....###",
          "#....#####"
        ],
        "pieceQueue": [
          "I",
          "I"
        ],
        "holdEnabled": false,
        "gravityMode": "place-by-place with no time pressure, hard drop + rotate",
        "spawnPolicy": "only fixed pieceQueue; no bag-7 randomness",
        "initialActivePiece": "I",
        "win": {
          "type": "clear-lines",
          "count": 2,
          "maxPlacedPieces": 2
        },
        "lose": {
          "type": "queue-exhausted-or-top-out",
          "ifGoalUnmet": true
        },
        "pieceDefinitions": {
          "I-H": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              2,
              0
            ],
            [
              3,
              0
            ]
          ],
          "I-V": [
            [
              0,
              0
            ],
            [
              0,
              1
            ],
            [
              0,
              2
            ],
            [
              0,
              3
            ]
          ],
          "O-N": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              0,
              1
            ],
            [
              1,
              1
            ]
          ],
          "T-STEM-DOWN": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              2,
              0
            ],
            [
              1,
              1
            ]
          ]
        },
        "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping.",
        "gravityModel": "place-by-place"
      },
      "contentRevision": "block-drop-C04@0.9.0-design-v1@4a036ee7312a"
    },
    {
      "id": "block-drop-C05",
      "stageNumber": 5,
      "title": "T形锁孔",
      "difficulty": 5,
      "goalStatement": "先 O 填上方方井，再以 T 锁下方异形孔",
      "decision": "选择摆放方向和顺序（挑战模式固定出块）",
      "practicedSkill": "两个落点都可试放，但只有 O 先上、T 后下能清四行",
      "discovery": "旋转与顺序共同决定成败，直落任意一孔会留残砖",
      "targetDurationSec": [
        25,
        110
      ],
      "requiredFeatures": [
        "puzzle_board_preset",
        "puzzle_piece_queue",
        "clear_line_goal"
      ],
      "content": {
        "boardWidth": 10,
        "boardHeight": 20,
        "boardTopToBottom": [
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "###..#####",
          "###..#####",
          "####...###",
          "#####.####"
        ],
        "pieceQueue": [
          "O",
          "T"
        ],
        "holdEnabled": false,
        "gravityMode": "place-by-place with no time pressure, hard drop + rotate",
        "spawnPolicy": "only fixed pieceQueue; no bag-7 randomness",
        "initialActivePiece": "O",
        "win": {
          "type": "clear-lines",
          "count": 4,
          "maxPlacedPieces": 2
        },
        "lose": {
          "type": "queue-exhausted-or-top-out",
          "ifGoalUnmet": true
        },
        "pieceDefinitions": {
          "I-H": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              2,
              0
            ],
            [
              3,
              0
            ]
          ],
          "I-V": [
            [
              0,
              0
            ],
            [
              0,
              1
            ],
            [
              0,
              2
            ],
            [
              0,
              3
            ]
          ],
          "O-N": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              0,
              1
            ],
            [
              1,
              1
            ]
          ],
          "T-STEM-DOWN": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              2,
              0
            ],
            [
              1,
              1
            ]
          ]
        },
        "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping.",
        "gravityModel": "place-by-place",
        "placementSpace": {
          "description": "每块存在多个可硬降落点，只有特定朝向/列组合能完成目标；参考解是众多合法落点中的一种",
          "legalButLosingExamples": [
            {
              "piece": "O",
              "orientation": "N",
              "leftCol": 1,
              "result": "偏离方井，无法配合 T 清四行"
            },
            {
              "piece": "T",
              "orientation": "STEM-DOWN",
              "leftCol": 4,
              "result": "无 O 垫底，T 落入异形孔仍剩残砖"
            }
          ],
          "winningPlacementCount": 1
        }
      },
      "contentRevision": "block-drop-C05@0.9.0-design-v1@c1a477056fbb"
    },
    {
      "id": "block-drop-C06",
      "stageNumber": 6,
      "title": "复合工坊",
      "difficulty": 6,
      "goalStatement": "先 O 后 T，完成连续四行清除",
      "decision": "选择摆放方向和顺序（挑战模式固定出块）",
      "practicedSkill": "若先考虑下方T，会被上方方井阻挡",
      "discovery": "清除顺序就是核心解题空间",
      "targetDurationSec": [
        25,
        110
      ],
      "requiredFeatures": [
        "puzzle_board_preset",
        "puzzle_piece_queue",
        "clear_line_goal"
      ],
      "content": {
        "boardWidth": 10,
        "boardHeight": 20,
        "boardTopToBottom": [
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          "#..#######",
          "#..#######",
          "####...###",
          "#####.####"
        ],
        "pieceQueue": [
          "O",
          "T"
        ],
        "holdEnabled": false,
        "gravityMode": "place-by-place with no time pressure, hard drop + rotate",
        "spawnPolicy": "only fixed pieceQueue; no bag-7 randomness",
        "initialActivePiece": "O",
        "win": {
          "type": "clear-lines",
          "count": 4,
          "maxPlacedPieces": 2
        },
        "lose": {
          "type": "queue-exhausted-or-top-out",
          "ifGoalUnmet": true
        },
        "pieceDefinitions": {
          "I-H": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              2,
              0
            ],
            [
              3,
              0
            ]
          ],
          "I-V": [
            [
              0,
              0
            ],
            [
              0,
              1
            ],
            [
              0,
              2
            ],
            [
              0,
              3
            ]
          ],
          "O-N": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              0,
              1
            ],
            [
              1,
              1
            ]
          ],
          "T-STEM-DOWN": [
            [
              0,
              0
            ],
            [
              1,
              0
            ],
            [
              2,
              0
            ],
            [
              1,
              1
            ]
          ]
        },
        "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping.",
        "gravityModel": "place-by-place",
        "placementSpace": {
          "description": "每块存在多个可硬降落点，只有特定朝向/列组合能完成目标；参考解是众多合法落点中的一种",
          "legalButLosingExamples": [
            {
              "piece": "O",
              "orientation": "N",
              "leftCol": 0,
              "result": "无法落入方井，停在顶端"
            },
            {
              "piece": "T",
              "orientation": "STEM-UP",
              "leftCol": 4,
              "result": "只清1行"
            }
          ],
          "winningPlacementCount": 1
        }
      },
      "contentRevision": "block-drop-C06@0.9.0-design-v1@bdc3c4429963"
    }
  ]
};
