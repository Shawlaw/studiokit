/* 生成物：由 tools/arcade_09_data.mjs 从 docs/arcade/0.9/levels/gold-miner.json 生成；不要手改。 */
window.ArcadeChallengeData = window.ArcadeChallengeData || {};
window.ArcadeChallengeData['gold-miner'] = {
  "schemaVersion": "1.0.0",
  "gameId": "gold-miner",
  "gameName": "黄金矿工",
  "packVersion": "0.9.0-design-v1",
  "stages": [
    {
      "id": "gold-miner-C01",
      "stageNumber": 1,
      "title": "轻金快取",
      "difficulty": 1,
      "goalStatement": "在倒计时内取得至少$550",
      "decision": "选择短钩低价/长钩高价和炸药风险",
      "practicedSkill": "精准地选择三条不重合角度",
      "discovery": "分辨深处重金与近处轻金的回收时间",
      "targetDurationSec": [
        30,
        60
      ],
      "requiredFeatures": [
        "fixed_item_layout",
        "hook_time_simulator"
      ],
      "content": {
        "coordinates": "420×740；钩爪轴(210,104)；item.xy为逻辑像素；角度为 atan2(x-210,y-104) 角度，向右为正；禁止自动随机重排",
        "timeLimitSec": 60,
        "targetMoney": 550,
        "items": [
          {
            "id": "m1",
            "type": "goldM",
            "x": 154,
            "y": 360,
            "value": 150,
            "weight": 4,
            "aimAngleDeg": -12.3
          },
          {
            "id": "m2",
            "type": "goldM",
            "x": 265,
            "y": 350,
            "value": 150,
            "weight": 4,
            "aimAngleDeg": 12.6
          },
          {
            "id": "l1",
            "type": "goldL",
            "x": 216,
            "y": 525,
            "value": 350,
            "weight": 8,
            "aimAngleDeg": 0.8
          },
          {
            "id": "s1",
            "type": "goldS",
            "x": 330,
            "y": 550,
            "value": 50,
            "weight": 2,
            "aimAngleDeg": 15.1
          },
          {
            "id": "r1",
            "type": "rockS",
            "x": 105,
            "y": 570,
            "value": 15,
            "weight": 9,
            "aimAngleDeg": -12.7
          }
        ],
        "referenceCatchOrder": [
          "m1",
          "m2",
          "l1"
        ],
        "initialTools": {
          "aim": 0,
          "winch": 0,
          "time": 0
        },
        "hook": {
          "pivot": [
            210,
            104
          ],
          "extendSpeedPxSec": 560,
          "baseRetractSpeed": "inherit engine",
          "swing": "inherit engine but use deterministic phase at stage start"
        },
        "complete": "达标即可选择立即结算，不要求抓光",
        "fail": "倒计时归零且未达标",
        "hazards": "TNT碰到立即销毁本次抓取收益，损失时间；不直接结束全局游戏"
      }
    },
    {
      "id": "gold-miner-C02",
      "stageNumber": 2,
      "title": "钻石的代价",
      "difficulty": 2,
      "goalStatement": "在倒计时内取得至少$750",
      "decision": "选择短钩低价/长钩高价和炸药风险",
      "practicedSkill": "先拿远钻石还是先拿近金块",
      "discovery": "比较价值和钩爪占用时间",
      "targetDurationSec": [
        30,
        58
      ],
      "requiredFeatures": [
        "fixed_item_layout",
        "hook_time_simulator"
      ],
      "content": {
        "coordinates": "420×740；钩爪轴(210,104)；item.xy为逻辑像素；角度为 atan2(x-210,y-104) 角度，向右为正；禁止自动随机重排",
        "timeLimitSec": 58,
        "targetMoney": 750,
        "items": [
          {
            "id": "d1",
            "type": "diamond",
            "x": 340,
            "y": 470,
            "value": 600,
            "weight": 1.5,
            "aimAngleDeg": 19.6
          },
          {
            "id": "m1",
            "type": "goldM",
            "x": 98,
            "y": 450,
            "value": 150,
            "weight": 4,
            "aimAngleDeg": -17.9
          },
          {
            "id": "m2",
            "type": "goldM",
            "x": 215,
            "y": 400,
            "value": 150,
            "weight": 4,
            "aimAngleDeg": 1
          },
          {
            "id": "r1",
            "type": "rockL",
            "x": 290,
            "y": 590,
            "value": 20,
            "weight": 14,
            "aimAngleDeg": 9.3
          },
          {
            "id": "s1",
            "type": "goldS",
            "x": 145,
            "y": 580,
            "value": 50,
            "weight": 2,
            "aimAngleDeg": -7.8
          }
        ],
        "referenceCatchOrder": [
          "d1",
          "m1"
        ],
        "initialTools": {
          "aim": 0,
          "winch": 0,
          "time": 0
        },
        "hook": {
          "pivot": [
            210,
            104
          ],
          "extendSpeedPxSec": 560,
          "baseRetractSpeed": "inherit engine",
          "swing": "inherit engine but use deterministic phase at stage start"
        },
        "complete": "达标即可选择立即结算，不要求抓光",
        "fail": "倒计时归零且未达标",
        "hazards": "TNT碰到立即销毁本次抓取收益，损失时间；不直接结束全局游戏"
      }
    },
    {
      "id": "gold-miner-C03",
      "stageNumber": 3,
      "title": "第一颗炸药",
      "difficulty": 3,
      "goalStatement": "在倒计时内取得至少$900",
      "decision": "选择短钩低价/长钩高价和炸药风险",
      "practicedSkill": "避开中央炸药的优先路径",
      "discovery": "炸药对摆角构成可预判禁止区域",
      "targetDurationSec": [
        30,
        58
      ],
      "requiredFeatures": [
        "fixed_item_layout",
        "hook_time_simulator"
      ],
      "content": {
        "coordinates": "420×740；钩爪轴(210,104)；item.xy为逻辑像素；角度为 atan2(x-210,y-104) 角度，向右为正；禁止自动随机重排",
        "timeLimitSec": 58,
        "targetMoney": 900,
        "items": [
          {
            "id": "l1",
            "type": "goldL",
            "x": 110,
            "y": 520,
            "value": 350,
            "weight": 8,
            "aimAngleDeg": -13.5
          },
          {
            "id": "d1",
            "type": "diamond",
            "x": 310,
            "y": 450,
            "value": 600,
            "weight": 1.5,
            "aimAngleDeg": 16.1
          },
          {
            "id": "t1",
            "type": "tnt",
            "x": 245,
            "y": 415,
            "value": 0,
            "weight": 0,
            "aimAngleDeg": 6.4
          },
          {
            "id": "r1",
            "type": "rockS",
            "x": 174,
            "y": 370,
            "value": 15,
            "weight": 9,
            "aimAngleDeg": -7.7
          },
          {
            "id": "m1",
            "type": "goldM",
            "x": 360,
            "y": 590,
            "value": 150,
            "weight": 4,
            "aimAngleDeg": 17.2
          }
        ],
        "referenceCatchOrder": [
          "l1",
          "d1"
        ],
        "initialTools": {
          "aim": 0,
          "winch": 0,
          "time": 0
        },
        "hook": {
          "pivot": [
            210,
            104
          ],
          "extendSpeedPxSec": 560,
          "baseRetractSpeed": "inherit engine",
          "swing": "inherit engine but use deterministic phase at stage start"
        },
        "complete": "达标即可选择立即结算，不要求抓光",
        "fail": "倒计时归零且未达标",
        "hazards": "TNT碰到立即销毁本次抓取收益，损失时间；不直接结束全局游戏"
      }
    },
    {
      "id": "gold-miner-C04",
      "stageNumber": 4,
      "title": "双钻矿脉",
      "difficulty": 4,
      "goalStatement": "在倒计时内取得至少$1200",
      "decision": "选择短钩低价/长钩高价和炸药风险",
      "practicedSkill": "两钻足够达标，但经过空角度需要等待摆动",
      "discovery": "不要贪近处低价值石块",
      "targetDurationSec": [
        30,
        55
      ],
      "requiredFeatures": [
        "fixed_item_layout",
        "hook_time_simulator"
      ],
      "content": {
        "coordinates": "420×740；钩爪轴(210,104)；item.xy为逻辑像素；角度为 atan2(x-210,y-104) 角度，向右为正；禁止自动随机重排",
        "timeLimitSec": 55,
        "targetMoney": 1200,
        "items": [
          {
            "id": "d1",
            "type": "diamond",
            "x": 104,
            "y": 440,
            "value": 600,
            "weight": 1.5,
            "aimAngleDeg": -17.5
          },
          {
            "id": "d2",
            "type": "diamond",
            "x": 318,
            "y": 475,
            "value": 600,
            "weight": 1.5,
            "aimAngleDeg": 16.2
          },
          {
            "id": "t1",
            "type": "tnt",
            "x": 225,
            "y": 340,
            "value": 0,
            "weight": 0,
            "aimAngleDeg": 3.6
          },
          {
            "id": "r1",
            "type": "rockL",
            "x": 290,
            "y": 560,
            "value": 20,
            "weight": 14,
            "aimAngleDeg": 10
          },
          {
            "id": "m1",
            "type": "goldM",
            "x": 145,
            "y": 600,
            "value": 150,
            "weight": 4,
            "aimAngleDeg": -7.5
          }
        ],
        "referenceCatchOrder": [
          "d1",
          "d2"
        ],
        "initialTools": {
          "aim": 0,
          "winch": 0,
          "time": 0
        },
        "hook": {
          "pivot": [
            210,
            104
          ],
          "extendSpeedPxSec": 560,
          "baseRetractSpeed": "inherit engine",
          "swing": "inherit engine but use deterministic phase at stage start"
        },
        "complete": "达标即可选择立即结算，不要求抓光",
        "fail": "倒计时归零且未达标",
        "hazards": "TNT碰到立即销毁本次抓取收益，损失时间；不直接结束全局游戏"
      }
    },
    {
      "id": "gold-miner-C05",
      "stageNumber": 5,
      "title": "限时三钩",
      "difficulty": 5,
      "goalStatement": "在倒计时内取得至少$1000",
      "decision": "选择短钩低价/长钩高价和炸药风险",
      "practicedSkill": "规划三次抓取路线",
      "discovery": "抢近件还是等高值件的摆动相位",
      "targetDurationSec": [
        30,
        52
      ],
      "requiredFeatures": [
        "fixed_item_layout",
        "hook_time_simulator"
      ],
      "content": {
        "coordinates": "420×740；钩爪轴(210,104)；item.xy为逻辑像素；角度为 atan2(x-210,y-104) 角度，向右为正；禁止自动随机重排",
        "timeLimitSec": 52,
        "targetMoney": 1000,
        "items": [
          {
            "id": "d1",
            "type": "diamond",
            "x": 331,
            "y": 523,
            "value": 600,
            "weight": 1.5,
            "aimAngleDeg": 16.1
          },
          {
            "id": "l1",
            "type": "goldL",
            "x": 100,
            "y": 578,
            "value": 350,
            "weight": 8,
            "aimAngleDeg": -13.1
          },
          {
            "id": "m1",
            "type": "goldM",
            "x": 214,
            "y": 360,
            "value": 150,
            "weight": 4,
            "aimAngleDeg": 0.9
          },
          {
            "id": "t1",
            "type": "tnt",
            "x": 338,
            "y": 350,
            "value": 0,
            "weight": 0,
            "aimAngleDeg": 27.5
          },
          {
            "id": "r1",
            "type": "rockS",
            "x": 260,
            "y": 430,
            "value": 15,
            "weight": 9,
            "aimAngleDeg": 8.7
          }
        ],
        "referenceCatchOrder": [
          "d1",
          "l1",
          "m1"
        ],
        "initialTools": {
          "aim": 0,
          "winch": 0,
          "time": 0
        },
        "hook": {
          "pivot": [
            210,
            104
          ],
          "extendSpeedPxSec": 560,
          "baseRetractSpeed": "inherit engine",
          "swing": "inherit engine but use deterministic phase at stage start"
        },
        "complete": "达标即可选择立即结算，不要求抓光",
        "fail": "倒计时归零且未达标",
        "hazards": "TNT碰到立即销毁本次抓取收益，损失时间；不直接结束全局游戏"
      }
    },
    {
      "id": "gold-miner-C06",
      "stageNumber": 6,
      "title": "矿工毕业考",
      "difficulty": 6,
      "goalStatement": "在倒计时内取得至少$1300",
      "decision": "选择短钩低价/长钩高价和炸药风险",
      "practicedSkill": "三次主抓在有限时间完成，炸药与石头是视觉干扰",
      "discovery": "综合重量、伸缩时间和角度等待",
      "targetDurationSec": [
        30,
        52
      ],
      "requiredFeatures": [
        "fixed_item_layout",
        "hook_time_simulator"
      ],
      "content": {
        "coordinates": "420×740；钩爪轴(210,104)；item.xy为逻辑像素；角度为 atan2(x-210,y-104) 角度，向右为正；禁止自动随机重排",
        "timeLimitSec": 52,
        "targetMoney": 1300,
        "items": [
          {
            "id": "d1",
            "type": "diamond",
            "x": 115,
            "y": 600,
            "value": 600,
            "weight": 1.5,
            "aimAngleDeg": -10.8
          },
          {
            "id": "d2",
            "type": "diamond",
            "x": 318,
            "y": 600,
            "value": 600,
            "weight": 1.5,
            "aimAngleDeg": 12.3
          },
          {
            "id": "l1",
            "type": "goldL",
            "x": 210,
            "y": 476,
            "value": 350,
            "weight": 8,
            "aimAngleDeg": 0
          },
          {
            "id": "t1",
            "type": "tnt",
            "x": 346,
            "y": 350,
            "value": 0,
            "weight": 0,
            "aimAngleDeg": 28.9
          },
          {
            "id": "m1",
            "type": "goldM",
            "x": 75,
            "y": 425,
            "value": 150,
            "weight": 4,
            "aimAngleDeg": -22.8
          },
          {
            "id": "r1",
            "type": "rockL",
            "x": 340,
            "y": 450,
            "value": 20,
            "weight": 14,
            "aimAngleDeg": 20.6
          }
        ],
        "referenceCatchOrder": [
          "d1",
          "d2",
          "l1"
        ],
        "initialTools": {
          "aim": 0,
          "winch": 0,
          "time": 0
        },
        "hook": {
          "pivot": [
            210,
            104
          ],
          "extendSpeedPxSec": 560,
          "baseRetractSpeed": "inherit engine",
          "swing": "inherit engine but use deterministic phase at stage start"
        },
        "complete": "达标即可选择立即结算，不要求抓光",
        "fail": "倒计时归零且未达标",
        "hazards": "TNT碰到立即销毁本次抓取收益，损失时间；不直接结束全局游戏"
      }
    }
  ]
};
