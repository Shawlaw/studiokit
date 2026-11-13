/* 生成物：由 tools/arcade_09_data.mjs 从 docs/arcade/0.9/levels/memory-flip.json 生成；不要手改。 */
window.ArcadeChallengeData = window.ArcadeChallengeData || {};
window.ArcadeChallengeData['memory-flip'] = {
  "schemaVersion": "1.0.0",
  "gameId": "memory-flip",
  "gameName": "记忆翻牌",
  "packVersion": "0.9.0-design-v1",
  "stages": [
    {
      "id": "memory-flip-C01",
      "stageNumber": 1,
      "title": "分区第一步",
      "difficulty": 1,
      "goalStatement": "仅看一次预览配对三组",
      "decision": "记忆策略或推理顺序决定翻牌效率",
      "practicedSkill": "按列建立位置记忆",
      "discovery": "观察相同符号不一定相邻",
      "targetDurationSec": [
        35,
        140
      ],
      "requiredFeatures": [
        "fixed_memory_board",
        "cognitive_clue_mode"
      ],
      "content": {
        "grid": {
          "rows": 2,
          "cols": 3
        },
        "faces": [
          [
            "A",
            "B",
            "C"
          ],
          [
            "A",
            "C",
            "B"
          ]
        ],
        "previewSeconds": 4.5,
        "maxMismatches": 4,
        "turnRules": {
          "flipTwo": "matching pair stay faceup; mismatch waits 0.7s and flips back",
          "pauseDuringMismatchedFlip": true,
          "matchedCardsCannotFlipAgain": true
        },
        "goal": {
          "type": "match-all",
          "pairs": 3
        },
        "clues": {},
        "layoutTransforms": [
          "identity"
        ],
        "transformsApplyToEntireBoard": true,
        "progressPersist": "matched ids + mismatches + active two flips + preview timer"
      }
    },
    {
      "id": "memory-flip-C02",
      "stageNumber": 2,
      "title": "两段扫描",
      "difficulty": 2,
      "goalStatement": "在4次错误以内配对四组",
      "decision": "记忆策略或推理顺序决定翻牌效率",
      "practicedSkill": "左半→右半顺序扫描降低遗忘",
      "discovery": "发现所有符号恰好一次分布在每行",
      "targetDurationSec": [
        35,
        140
      ],
      "requiredFeatures": [
        "fixed_memory_board",
        "cognitive_clue_mode"
      ],
      "content": {
        "grid": {
          "rows": 2,
          "cols": 4
        },
        "faces": [
          [
            "A",
            "B",
            "C",
            "D"
          ],
          [
            "C",
            "A",
            "D",
            "B"
          ]
        ],
        "previewSeconds": 3.8,
        "maxMismatches": 4,
        "turnRules": {
          "flipTwo": "matching pair stay faceup; mismatch waits 0.7s and flips back",
          "pauseDuringMismatchedFlip": true,
          "matchedCardsCannotFlipAgain": true
        },
        "goal": {
          "type": "match-all",
          "pairs": 4
        },
        "clues": {
          "hintText": "每种图案在上下两行各出现一次"
        },
        "layoutTransforms": [
          "identity"
        ],
        "transformsApplyToEntireBoard": true,
        "progressPersist": "matched ids + mismatches + active two flips + preview timer"
      }
    },
    {
      "id": "memory-flip-C03",
      "stageNumber": 3,
      "title": "位置线索",
      "difficulty": 3,
      "goalStatement": "用分区预览与位置线索完成六对",
      "decision": "记忆策略或推理顺序决定翻牌效率",
      "practicedSkill": "先记每一行再用排除法",
      "discovery": "每对首张与末张的位置可以组成手势记忆",
      "targetDurationSec": [
        35,
        140
      ],
      "requiredFeatures": [
        "fixed_memory_board",
        "cognitive_clue_mode"
      ],
      "content": {
        "grid": {
          "rows": 3,
          "cols": 4
        },
        "faces": [
          [
            "A",
            "B",
            "C",
            "D"
          ],
          [
            "E",
            "F",
            "A",
            "B"
          ],
          [
            "F",
            "E",
            "D",
            "C"
          ]
        ],
        "previewSeconds": 4,
        "maxMismatches": 5,
        "turnRules": {
          "flipTwo": "matching pair stay faceup; mismatch waits 0.7s and flips back",
          "pauseDuringMismatchedFlip": true,
          "matchedCardsCannotFlipAgain": true
        },
        "goal": {
          "type": "match-all",
          "pairs": 6
        },
        "clues": {
          "previewMode": "row-by-row",
          "previewEachRowSec": 1.5
        },
        "layoutTransforms": [
          "identity",
          "mirror-horizontal",
          "mirror-vertical"
        ],
        "transformsApplyToEntireBoard": true,
        "progressPersist": "matched ids + mismatches + active two flips + preview timer"
      }
    },
    {
      "id": "memory-flip-C04",
      "stageNumber": 4,
      "title": "镜像试验",
      "difficulty": 4,
      "goalStatement": "识别上下两区域镜像配对规律",
      "decision": "记忆策略或推理顺序决定翻牌效率",
      "practicedSkill": "主动先观察规律，再翻牌",
      "discovery": "上下行是镜像排列",
      "targetDurationSec": [
        35,
        140
      ],
      "requiredFeatures": [
        "fixed_memory_board",
        "cognitive_clue_mode"
      ],
      "content": {
        "grid": {
          "rows": 4,
          "cols": 4
        },
        "faces": [
          [
            "A",
            "B",
            "C",
            "D"
          ],
          [
            "E",
            "F",
            "G",
            "H"
          ],
          [
            "D",
            "C",
            "B",
            "A"
          ],
          [
            "H",
            "G",
            "F",
            "E"
          ]
        ],
        "previewSeconds": 3,
        "maxMismatches": 6,
        "turnRules": {
          "flipTwo": "matching pair stay faceup; mismatch waits 0.7s and flips back",
          "pauseDuringMismatchedFlip": true,
          "matchedCardsCannotFlipAgain": true
        },
        "goal": {
          "type": "match-all",
          "pairs": 8
        },
        "clues": {
          "hintText": "上半区与下半区存在镜像关系"
        },
        "layoutTransforms": [
          "identity",
          "mirror-horizontal",
          "mirror-vertical"
        ],
        "transformsApplyToEntireBoard": true,
        "progressPersist": "matched ids + mismatches + active two flips + preview timer"
      }
    },
    {
      "id": "memory-flip-C05",
      "stageNumber": 5,
      "title": "左右互换",
      "difficulty": 5,
      "goalStatement": "找出两层错位关系并完成八对",
      "decision": "记忆策略或推理顺序决定翻牌效率",
      "practicedSkill": "用象限编码而非死记整个棋盘",
      "discovery": "每对图案分散于上下两个半区",
      "targetDurationSec": [
        35,
        140
      ],
      "requiredFeatures": [
        "fixed_memory_board",
        "cognitive_clue_mode"
      ],
      "content": {
        "grid": {
          "rows": 4,
          "cols": 4
        },
        "faces": [
          [
            "A",
            "B",
            "C",
            "D"
          ],
          [
            "E",
            "F",
            "G",
            "H"
          ],
          [
            "E",
            "G",
            "F",
            "H"
          ],
          [
            "B",
            "D",
            "A",
            "C"
          ]
        ],
        "previewSeconds": 3,
        "maxMismatches": 5,
        "turnRules": {
          "flipTwo": "matching pair stay faceup; mismatch waits 0.7s and flips back",
          "pauseDuringMismatchedFlip": true,
          "matchedCardsCannotFlipAgain": true
        },
        "goal": {
          "type": "match-all",
          "pairs": 8
        },
        "clues": {
          "previewMode": "quadrants",
          "previewEachQuadrantSec": 1.4
        },
        "layoutTransforms": [
          "identity",
          "mirror-horizontal",
          "mirror-vertical"
        ],
        "transformsApplyToEntireBoard": true,
        "progressPersist": "matched ids + mismatches + active two flips + preview timer"
      }
    },
    {
      "id": "memory-flip-C06",
      "stageNumber": 6,
      "title": "终局推理",
      "difficulty": 6,
      "goalStatement": "在更少的翻错次数内完成8对",
      "decision": "记忆策略或推理顺序决定翻牌效率",
      "practicedSkill": "建立逻辑笔记与优先检查顺序",
      "discovery": "有规律但不完全镜像，可选给出一对线索",
      "targetDurationSec": [
        35,
        140
      ],
      "requiredFeatures": [
        "fixed_memory_board",
        "cognitive_clue_mode"
      ],
      "content": {
        "grid": {
          "rows": 4,
          "cols": 4
        },
        "faces": [
          [
            "A",
            "B",
            "C",
            "D"
          ],
          [
            "E",
            "F",
            "G",
            "H"
          ],
          [
            "H",
            "A",
            "F",
            "C"
          ],
          [
            "D",
            "G",
            "B",
            "E"
          ]
        ],
        "previewSeconds": 2.8,
        "maxMismatches": 4,
        "turnRules": {
          "flipTwo": "matching pair stay faceup; mismatch waits 0.7s and flips back",
          "pauseDuringMismatchedFlip": true,
          "matchedCardsCannotFlipAgain": true
        },
        "goal": {
          "type": "match-all",
          "pairs": 8
        },
        "clues": {
          "hintText": "四个角不是同一种图案；右下角能与第二行图案配对"
        },
        "layoutTransforms": [
          "identity",
          "mirror-horizontal",
          "mirror-vertical"
        ],
        "transformsApplyToEntireBoard": true,
        "progressPersist": "matched ids + mismatches + active two flips + preview timer"
      }
    }
  ]
};
