/* 生成物：由 tools/arcade_09_data.mjs 从 docs/arcade/0.9/levels/block-drop.json 生成；不要手改。 */
window.ArcadeChallengeData = window.ArcadeChallengeData || {};
window.ArcadeChallengeData['block-drop'] = {
  "schemaVersion": "1.0.0",
  "gameId": "block-drop",
  "gameName": "俄罗斯方块",
  "packVersion": "0.9.0-design-v1",
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
        "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping."
      }
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
        "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping."
      }
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
        "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping."
      }
    },
    {
      "id": "block-drop-C04",
      "stageNumber": 4,
      "title": "两次横修",
      "difficulty": 4,
      "goalStatement": "两个 I 逐层修复横井",
      "decision": "选择摆放方向和顺序（挑战模式固定出块）",
      "practicedSkill": "先放下层，再补新掉落的一层",
      "discovery": "消行后重力会让上层自然下落",
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
          "###....###"
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
        "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping."
      }
    },
    {
      "id": "block-drop-C05",
      "stageNumber": 5,
      "title": "T形锁孔",
      "difficulty": 5,
      "goalStatement": "T形正确方向放入非矩形锁孔",
      "decision": "选择摆放方向和顺序（挑战模式固定出块）",
      "practicedSkill": "左右平移与旋转要配合",
      "discovery": "读懂不规则凹槽而非盲目直落",
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
          "####...###",
          "#####.####"
        ],
        "pieceQueue": [
          "T"
        ],
        "holdEnabled": false,
        "gravityMode": "place-by-place with no time pressure, hard drop + rotate",
        "spawnPolicy": "only fixed pieceQueue; no bag-7 randomness",
        "initialActivePiece": "T",
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
        "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping."
      }
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
        "coordinates": "reference placements give top-left bounding-box column. Rotation system in game must support these orientations without clipping."
      }
    }
  ]
};
