/* 生成物：由 tools/arcade_09_data.mjs 从 docs/arcade/0.9/levels/merge-2048.json 生成；不要手改。 */
window.ArcadeChallengeData = window.ArcadeChallengeData || {};
window.ArcadeChallengeData['merge-2048'] = {
  "schemaVersion": "1.0.0",
  "gameId": "merge-2048",
  "gameName": "2048 合成",
  "packVersion": "0.9.0-design-v1",
  "stages": [
    {
      "id": "merge-2048-C01",
      "stageNumber": 1,
      "title": "第一次合并",
      "difficulty": 1,
      "goalStatement": "把两枚2合成4",
      "decision": "每一步选择朝向并预判合并次序",
      "practicedSkill": "方向一次选择，合并后的格子位置会改变",
      "discovery": "可用向左也可用向右，方案多于一种",
      "targetDurationSec": [
        15,
        95
      ],
      "requiredFeatures": [
        "fixed_2048_board",
        "challenge_no_spawn",
        "target_tile"
      ],
      "content": {
        "grid": {
          "rows": 4,
          "cols": 4
        },
        "initialBoard": [
          [
            2,
            2,
            0,
            0
          ],
          [
            0,
            0,
            0,
            0
          ],
          [
            0,
            0,
            0,
            0
          ],
          [
            0,
            0,
            0,
            0
          ]
        ],
        "challengeSpawnPolicy": "none (no new random or scripted tile after move)",
        "maxValidMoves": 2,
        "undoAllowed": true,
        "undoDoesNotRefundMoveOnRankedAttempt": true,
        "win": {
          "anyTileAtLeast": 4
        },
        "lose": "valid moves used up without target or no legal move",
        "scorePolicy": "挑战按有效步数、辅助使用分层统计；经典分数保持不变",
        "controls": "四方向滑动；仅有效改变盘面的滑动计步"
      }
    },
    {
      "id": "merge-2048-C02",
      "stageNumber": 2,
      "title": "双排规划",
      "difficulty": 2,
      "goalStatement": "形成一枚8",
      "decision": "每一步选择朝向并预判合并次序",
      "practicedSkill": "同一滑动可能发生两次不同合并",
      "discovery": "观察合并是“每一格每回合最多合并一次”",
      "targetDurationSec": [
        15,
        95
      ],
      "requiredFeatures": [
        "fixed_2048_board",
        "challenge_no_spawn",
        "target_tile"
      ],
      "content": {
        "grid": {
          "rows": 4,
          "cols": 4
        },
        "initialBoard": [
          [
            2,
            2,
            4,
            4
          ],
          [
            0,
            0,
            0,
            0
          ],
          [
            0,
            0,
            0,
            0
          ],
          [
            0,
            0,
            0,
            0
          ]
        ],
        "challengeSpawnPolicy": "none (no new random or scripted tile after move)",
        "maxValidMoves": 2,
        "undoAllowed": true,
        "undoDoesNotRefundMoveOnRankedAttempt": true,
        "win": {
          "anyTileAtLeast": 8
        },
        "lose": "valid moves used up without target or no legal move",
        "scorePolicy": "挑战按有效步数、辅助使用分层统计；经典分数保持不变",
        "controls": "四方向滑动；仅有效改变盘面的滑动计步"
      }
    },
    {
      "id": "merge-2048-C03",
      "stageNumber": 3,
      "title": "先八后十六",
      "difficulty": 3,
      "goalStatement": "三步内得到16",
      "decision": "每一步选择朝向并预判合并次序",
      "practicedSkill": "先把两枚4合成8，再用两个8合16",
      "discovery": "第二次同向移动仍然可能有效",
      "targetDurationSec": [
        15,
        95
      ],
      "requiredFeatures": [
        "fixed_2048_board",
        "challenge_no_spawn",
        "target_tile"
      ],
      "content": {
        "grid": {
          "rows": 4,
          "cols": 4
        },
        "initialBoard": [
          [
            4,
            4,
            8,
            0
          ],
          [
            0,
            0,
            0,
            0
          ],
          [
            0,
            0,
            0,
            0
          ],
          [
            0,
            0,
            0,
            0
          ]
        ],
        "challengeSpawnPolicy": "none (no new random or scripted tile after move)",
        "maxValidMoves": 3,
        "undoAllowed": true,
        "undoDoesNotRefundMoveOnRankedAttempt": true,
        "win": {
          "anyTileAtLeast": 16
        },
        "lose": "valid moves used up without target or no legal move",
        "scorePolicy": "挑战按有效步数、辅助使用分层统计；经典分数保持不变",
        "controls": "四方向滑动；仅有效改变盘面的滑动计步"
      }
    },
    {
      "id": "merge-2048-C04",
      "stageNumber": 4,
      "title": "纵向接力",
      "difficulty": 4,
      "goalStatement": "最多三步得到8",
      "decision": "每一步选择朝向并预判合并次序",
      "practicedSkill": "先横向再纵向组合两排",
      "discovery": "合并顺序会影响最终位置",
      "targetDurationSec": [
        15,
        95
      ],
      "requiredFeatures": [
        "fixed_2048_board",
        "challenge_no_spawn",
        "target_tile"
      ],
      "content": {
        "grid": {
          "rows": 4,
          "cols": 4
        },
        "initialBoard": [
          [
            2,
            2,
            0,
            0
          ],
          [
            2,
            2,
            0,
            0
          ],
          [
            0,
            0,
            0,
            0
          ],
          [
            0,
            0,
            0,
            0
          ]
        ],
        "challengeSpawnPolicy": "none (no new random or scripted tile after move)",
        "maxValidMoves": 3,
        "undoAllowed": true,
        "undoDoesNotRefundMoveOnRankedAttempt": true,
        "win": {
          "anyTileAtLeast": 8
        },
        "lose": "valid moves used up without target or no legal move",
        "scorePolicy": "挑战按有效步数、辅助使用分层统计；经典分数保持不变",
        "controls": "四方向滑动；仅有效改变盘面的滑动计步"
      }
    },
    {
      "id": "merge-2048-C05",
      "stageNumber": 5,
      "title": "双列八进位",
      "difficulty": 5,
      "goalStatement": "四步内获得16",
      "decision": "每一步选择朝向并预判合并次序",
      "practicedSkill": "先合并列再观察8如何重合",
      "discovery": "棋盘上下移动可改变相邻关系",
      "targetDurationSec": [
        15,
        95
      ],
      "requiredFeatures": [
        "fixed_2048_board",
        "challenge_no_spawn",
        "target_tile"
      ],
      "content": {
        "grid": {
          "rows": 4,
          "cols": 4
        },
        "initialBoard": [
          [
            2,
            4,
            2,
            0
          ],
          [
            2,
            4,
            2,
            0
          ],
          [
            4,
            8,
            4,
            0
          ],
          [
            0,
            0,
            0,
            0
          ]
        ],
        "challengeSpawnPolicy": "none (no new random or scripted tile after move)",
        "maxValidMoves": 4,
        "undoAllowed": true,
        "undoDoesNotRefundMoveOnRankedAttempt": true,
        "win": {
          "anyTileAtLeast": 16
        },
        "lose": "valid moves used up without target or no legal move",
        "scorePolicy": "挑战按有效步数、辅助使用分层统计；经典分数保持不变",
        "controls": "四方向滑动；仅有效改变盘面的滑动计步"
      }
    },
    {
      "id": "merge-2048-C06",
      "stageNumber": 6,
      "title": "终极转位",
      "difficulty": 6,
      "goalStatement": "六步内获得32",
      "decision": "每一步选择朝向并预判合并次序",
      "practicedSkill": "允许暂时远离目标，先安排大数对位",
      "discovery": "分辨合并不能直接跨越不同数值",
      "targetDurationSec": [
        15,
        95
      ],
      "requiredFeatures": [
        "fixed_2048_board",
        "challenge_no_spawn",
        "target_tile"
      ],
      "content": {
        "grid": {
          "rows": 4,
          "cols": 4
        },
        "initialBoard": [
          [
            4,
            0,
            0,
            0
          ],
          [
            16,
            2,
            8,
            2
          ],
          [
            4,
            0,
            4,
            0
          ],
          [
            0,
            2,
            8,
            0
          ]
        ],
        "challengeSpawnPolicy": "none (no new random or scripted tile after move)",
        "maxValidMoves": 5,
        "undoAllowed": true,
        "undoDoesNotRefundMoveOnRankedAttempt": true,
        "win": {
          "anyTileAtLeast": 32
        },
        "lose": "valid moves used up without target or no legal move",
        "scorePolicy": "挑战按有效步数、辅助使用分层统计；经典分数保持不变",
        "controls": "四方向滑动；仅有效改变盘面的滑动计步"
      }
    }
  ]
};
