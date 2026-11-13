/* 生成物：由 tools/arcade_09_data.mjs 从 docs/arcade/0.9/levels/brick-breaker.json 生成；不要手改。 */
window.ArcadeChallengeData = window.ArcadeChallengeData || {};
window.ArcadeChallengeData['brick-breaker'] = {
  "schemaVersion": "1.0.0",
  "gameId": "brick-breaker",
  "gameName": "砖块计划",
  "packVersion": "0.9.0-design-v1",
  "stages": [
    {
      "id": "brick-breaker-C01",
      "stageNumber": 1,
      "title": "中路开门",
      "difficulty": 1,
      "goalStatement": "使球从中央缺口穿入顶部，消除所有砖",
      "decision": "球正中打挡板 vs 偏心打挡板",
      "practicedSkill": "掌握击球位置对角度的影响",
      "discovery": "观察中间两列形成天然反弹通路",
      "targetDurationSec": [
        75,
        180
      ],
      "requiredFeatures": [
        "fixed_brick_layout"
      ],
      "content": {
        "coordinates": "8列×5行，左上为(0,0)，砖坐标 x=20+col*48, y=128+row*24；.为空",
        "brickRows": [
          "..1111..",
          ".111111.",
          "111..111",
          "111..111",
          "........"
        ],
        "tokenLegend": {
          "1": "1HP",
          "2": "2HP",
          "3": "3HP",
          ".": "empty",
          "K": "1HP trigger brick",
          "G": "locked gate brick; initially invulnerable"
        },
        "mechanics": {},
        "ball": {
          "speed": 285,
          "startingPaddleX": 210,
          "paddleWidth": 88,
          "lives": 3
        },
        "win": {
          "type": "destroy_all_breakable_including_unlocked_gates"
        },
        "stuckBallRecovery": {
          "ifNoBrickContactSec": 12,
          "action": "给反弹方向微调且展示提示，不扣命；首次试图只提示"
        }
      }
    },
    {
      "id": "brick-breaker-C02",
      "stageNumber": 2,
      "title": "左右回廊",
      "difficulty": 2,
      "goalStatement": "清空护城左右两组砖",
      "decision": "先左边开槽或右边开槽",
      "practicedSkill": "连续接球后设定斜入侧翼角",
      "discovery": "开口让球沿侧墙循环敲砖",
      "targetDurationSec": [
        75,
        180
      ],
      "requiredFeatures": [
        "fixed_brick_layout"
      ],
      "content": {
        "coordinates": "8列×5行，左上为(0,0)，砖坐标 x=20+col*48, y=128+row*24；.为空",
        "brickRows": [
          "11....11",
          "11....11",
          "11....11",
          "11111111",
          "........"
        ],
        "tokenLegend": {
          "1": "1HP",
          "2": "2HP",
          "3": "3HP",
          ".": "empty",
          "K": "1HP trigger brick",
          "G": "locked gate brick; initially invulnerable"
        },
        "mechanics": {},
        "ball": {
          "speed": 293,
          "startingPaddleX": 210,
          "paddleWidth": 88,
          "lives": 3
        },
        "win": {
          "type": "destroy_all_breakable_including_unlocked_gates"
        },
        "stuckBallRecovery": {
          "ifNoBrickContactSec": 12,
          "action": "给反弹方向微调且展示提示，不扣命；首次试图只提示"
        }
      }
    },
    {
      "id": "brick-breaker-C03",
      "stageNumber": 3,
      "title": "双钥匙门",
      "difficulty": 3,
      "goalStatement": "击毁两把钥匙砖 K，才能打破门砖 G",
      "decision": "先击左钥匙或右钥匙",
      "practicedSkill": "反弹角度定向瞄准",
      "discovery": "钥匙变亮预告关联门的开启",
      "targetDurationSec": [
        75,
        180
      ],
      "requiredFeatures": [
        "fixed_brick_layout",
        "gate_brick"
      ],
      "content": {
        "coordinates": "8列×5行，左上为(0,0)，砖坐标 x=20+col*48, y=128+row*24；.为空",
        "brickRows": [
          "..1KK1..",
          ".11GG11.",
          "111GG111",
          "........",
          "........"
        ],
        "tokenLegend": {
          "1": "1HP",
          "2": "2HP",
          "3": "3HP",
          ".": "empty",
          "K": "1HP trigger brick",
          "G": "locked gate brick; initially invulnerable"
        },
        "mechanics": {
          "K": "全部 K 击毁后所有 G 从不可破坏障碍变为普通1HP砖"
        },
        "ball": {
          "speed": 301,
          "startingPaddleX": 210,
          "paddleWidth": 88,
          "lives": 3
        },
        "win": {
          "type": "destroy_all_breakable_including_unlocked_gates"
        },
        "stuckBallRecovery": {
          "ifNoBrickContactSec": 12,
          "action": "给反弹方向微调且展示提示，不扣命；首次试图只提示"
        }
      }
    },
    {
      "id": "brick-breaker-C04",
      "stageNumber": 4,
      "title": "镜像迷阵",
      "difficulty": 4,
      "goalStatement": "通过墙面回弹清理两侧高 HP 砖",
      "decision": "正面多次弹击或寻找侧边撞击角",
      "practicedSkill": "预测至少一次墙体反弹",
      "discovery": "发现外侧两条球路回弹会先打侧砖",
      "targetDurationSec": [
        75,
        180
      ],
      "requiredFeatures": [
        "fixed_brick_layout"
      ],
      "content": {
        "coordinates": "8列×5行，左上为(0,0)，砖坐标 x=20+col*48, y=128+row*24；.为空",
        "brickRows": [
          "111..111",
          "1.2..2.1",
          "1.1..1.1",
          "..1111..",
          "........"
        ],
        "tokenLegend": {
          "1": "1HP",
          "2": "2HP",
          "3": "3HP",
          ".": "empty",
          "K": "1HP trigger brick",
          "G": "locked gate brick; initially invulnerable"
        },
        "mechanics": {},
        "ball": {
          "speed": 309,
          "startingPaddleX": 210,
          "paddleWidth": 82,
          "lives": 3
        },
        "win": {
          "type": "destroy_all_breakable_including_unlocked_gates"
        },
        "stuckBallRecovery": {
          "ifNoBrickContactSec": 12,
          "action": "给反弹方向微调且展示提示，不扣命；首次试图只提示"
        }
      }
    },
    {
      "id": "brick-breaker-C05",
      "stageNumber": 5,
      "title": "薄壁防线",
      "difficulty": 5,
      "goalStatement": "穿透低层薄壁，再清顶部重砖",
      "decision": "先打通正中还是清两边",
      "practicedSkill": "利用上方连续反弹提高每次控球收益",
      "discovery": "高层 HP=3 的可见裂纹演变",
      "targetDurationSec": [
        75,
        180
      ],
      "requiredFeatures": [
        "fixed_brick_layout"
      ],
      "content": {
        "coordinates": "8列×5行，左上为(0,0)，砖坐标 x=20+col*48, y=128+row*24；.为空",
        "brickRows": [
          "..3333..",
          "..1111..",
          ".11..11.",
          "11....11",
          "........"
        ],
        "tokenLegend": {
          "1": "1HP",
          "2": "2HP",
          "3": "3HP",
          ".": "empty",
          "K": "1HP trigger brick",
          "G": "locked gate brick; initially invulnerable"
        },
        "mechanics": {},
        "ball": {
          "speed": 317,
          "startingPaddleX": 210,
          "paddleWidth": 82,
          "lives": 3
        },
        "win": {
          "type": "destroy_all_breakable_including_unlocked_gates"
        },
        "stuckBallRecovery": {
          "ifNoBrickContactSec": 12,
          "action": "给反弹方向微调且展示提示，不扣命；首次试图只提示"
        }
      }
    },
    {
      "id": "brick-breaker-C06",
      "stageNumber": 6,
      "title": "研究所终试",
      "difficulty": 6,
      "goalStatement": "先点亮两把钥匙、开启两侧门并清理所有可破坏砖",
      "decision": "两钥匙顺序可互换，求最少击球次数",
      "practicedSkill": "综合侧墙、挡板偏心与多击砖",
      "discovery": "左右两侧都可成为加速清场入口",
      "targetDurationSec": [
        75,
        180
      ],
      "requiredFeatures": [
        "fixed_brick_layout",
        "gate_brick"
      ],
      "content": {
        "coordinates": "8列×5行，左上为(0,0)，砖坐标 x=20+col*48, y=128+row*24；.为空",
        "brickRows": [
          "K.2..2.K",
          "GG1..1GG",
          ".11..11.",
          "11111111",
          "........"
        ],
        "tokenLegend": {
          "1": "1HP",
          "2": "2HP",
          "3": "3HP",
          ".": "empty",
          "K": "1HP trigger brick",
          "G": "locked gate brick; initially invulnerable"
        },
        "mechanics": {
          "K": "两把钥匙都击毁后开启全部 G；此前 G 只作硬墙不计待消除"
        },
        "ball": {
          "speed": 325,
          "startingPaddleX": 210,
          "paddleWidth": 82,
          "lives": 3
        },
        "win": {
          "type": "destroy_all_breakable_including_unlocked_gates"
        },
        "stuckBallRecovery": {
          "ifNoBrickContactSec": 12,
          "action": "给反弹方向微调且展示提示，不扣命；首次试图只提示"
        }
      }
    }
  ]
};
