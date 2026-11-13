# Arcade 0.9 关卡数据集成报告（生成物）

> 本文件由 `tools/arcade_09_data.mjs` 自动生成，请重跑脚本更新，不要手改。
> 设计源 `docs/arcade/0.9/levels/*.json` 只读未修改；运行时数据写入 `apps/arcade/challenge/*.js`；测试夹具写入 `tools/testdata/challenge/`。

## 1. 概览

| 项目 | 值 |
| --- | --- |
| 设计包版本 | 0.9.0-design-v1 |
| 运行时数据 Schema | 1.0.0 |
| 游戏数 | 13 |
| 关卡数 | 78 |
| 运行时数据文件 | 13 个，合计 215312 字节 |
| 测试夹具文件 | 13 个（308255 字节）+ index.json（7425 字节） |
| 生成器自检 | PASS（2128 条断言） |
| 设计包校验 | PASS（1088 条断言：design-contract 234 / exact-simulation 454 / geometry 220 / inventory 117 / ray-clearance 51 / timeline 12） |
| 幂等性 | 脚本不使用时间戳/随机数；同一输入重复运行输出字节一致 |

## 2. 源文件与生成字节

| gameId | 游戏 | 源文件 | 源 SHA-256 | 关数 | 运行时字节 | 夹具字节 | stage ids |
| --- | --- | --- | --- | --- | --- | --- | --- |
| shadow-leap | 影跃 | docs/arcade/0.9/levels/shadow-leap.json | `88f943f3bb306e7a168f41067c118a0ae2aed28e15018109e6463525e920fe84` | 6 | 17942 | 25595 | shadow-leap-C01, shadow-leap-C02, shadow-leap-C03, shadow-leap-C04, shadow-leap-C05, shadow-leap-C06 |
| snowbells | 雪铃 | docs/arcade/0.9/levels/snowbells.json | `76b468e321248b6f0305f8f04e1a95556574feb71c7a4b382fbf300d64bf2d12` | 6 | 14470 | 20650 | snowbells-C01, snowbells-C02, snowbells-C03, snowbells-C04, snowbells-C05, snowbells-C06 |
| star-raid | 星海突击 | docs/arcade/0.9/levels/star-raid.json | `5abad25ec4a5c8510dd9e1e4cef9b1ac8efdf2c40b1d02cc12ab5eb987bceead` | 6 | 23592 | 29317 | star-raid-C01, star-raid-C02, star-raid-C03, star-raid-C04, star-raid-C05, star-raid-C06 |
| pendulum-tower | 层塔 | docs/arcade/0.9/levels/pendulum-tower.json | `d4fed7f20807be0727b9c961052ea29fbc8ff1cb692ac243704be04345997f35` | 6 | 14502 | 20683 | pendulum-tower-C01, pendulum-tower-C02, pendulum-tower-C03, pendulum-tower-C04, pendulum-tower-C05, pendulum-tower-C06 |
| block-drop | 俄罗斯方块 | docs/arcade/0.9/levels/block-drop.json | `8cfd98b0d508aef5940aff62dce7f294835e8a70477287e9e4e821029c905f40` | 6 | 18203 | 23801 | block-drop-C01, block-drop-C02, block-drop-C03, block-drop-C04, block-drop-C05, block-drop-C06 |
| road-rush | 极速车道 | docs/arcade/0.9/levels/road-rush.json | `3c1942e1faf764a177697bb4495a390b9caf0fca5189051ba9d362698551b148` | 6 | 27565 | 34688 | road-rush-C01, road-rush-C02, road-rush-C03, road-rush-C04, road-rush-C05, road-rush-C06 |
| gold-miner | 黄金矿工 | docs/arcade/0.9/levels/gold-miner.json | `ad3e4a4116aa435ede87cb0169a00c917b559ae8f91a5e70a275f8c4b9886db4` | 6 | 15579 | 22577 | gold-miner-C01, gold-miner-C02, gold-miner-C03, gold-miner-C04, gold-miner-C05, gold-miner-C06 |
| brick-breaker | 砖块计划 | docs/arcade/0.9/levels/brick-breaker.json | `5e3499cfc7126513472960a907d9260fd8f8ab83bca807c98b9200a2f8ae8b9b` | 6 | 9193 | 14937 | brick-breaker-C01, brick-breaker-C02, brick-breaker-C03, brick-breaker-C04, brick-breaker-C05, brick-breaker-C06 |
| gravity-flip | 重力翻转 | docs/arcade/0.9/levels/gravity-flip.json | `d097bba5ba0802968d52da0beb029deb9e48cfd0c91882a2b156668d5049a496` | 6 | 14716 | 21953 | gravity-flip-C01, gravity-flip-C02, gravity-flip-C03, gravity-flip-C04, gravity-flip-C05, gravity-flip-C06 |
| snake-run | 贪吃蛇 | docs/arcade/0.9/levels/snake-run.json | `31675ce5f14471cb5576efa7654d733a1dab0fe03e7e802ad5c96f661cda767b` | 6 | 18280 | 24800 | snake-run-C01, snake-run-C02, snake-run-C03, snake-run-C04, snake-run-C05, snake-run-C06 |
| mole-whack | 打地鼠 | docs/arcade/0.9/levels/mole-whack.json | `25559c82f6501fdc0a03382fce42cf2d8d1d7a6e51eecc8077bdea07601e2fae` | 6 | 21674 | 27690 | mole-whack-C01, mole-whack-C02, mole-whack-C03, mole-whack-C04, mole-whack-C05, mole-whack-C06 |
| memory-flip | 记忆翻牌 | docs/arcade/0.9/levels/memory-flip.json | `cc2c34a2bfd150ac980ff85f8a6883468d48758211ecc2667163f8e91ec397e2` | 6 | 10136 | 24837 | memory-flip-C01, memory-flip-C02, memory-flip-C03, memory-flip-C04, memory-flip-C05, memory-flip-C06 |
| merge-2048 | 2048 合成 | docs/arcade/0.9/levels/merge-2048.json | `e451af94504b64ece8d603653c9dd7660de1bfb68d6a706c18d5b67c26ae5578` | 6 | 9460 | 16727 | merge-2048-C01, merge-2048-C02, merge-2048-C03, merge-2048-C04, merge-2048-C05, merge-2048-C06 |

## 3. 字段取舍（防剧透）

运行时数据 `apps/arcade/challenge/<gameId>.js` 的结构：

```js
window.ArcadeChallengeData = window.ArcadeChallengeData || {};
window.ArcadeChallengeData['<gameId>'] = {
  schemaVersion: '1.0.0', gameId, gameName, packVersion: '0.9.0-design-v1',
  stages: [{ id, stageNumber, title, difficulty, goalStatement, decision,
             practicedSkill, discovery, targetDurationSec, requiredFeatures, content }]
};
```

- **保留**：`id` / `stageNumber` / `title` / `difficulty` / `goalStatement` / `decision` / `practicedSkill` / `discovery` / `targetDurationSec` / `requiredFeatures`（由 `integration.requiredFeatures` 拍平）/ `content`（设计源原样，含坐标语义、固定盘面、时间轴、棋子队列等权威规则）。
- **不进入运行时**：`referencePlan`（设计者参考路线/答案）、`acceptance`（验收脚本与自动回放）、`integration` 对象本体、`chapter` / `designerNotes`（设计备注）。目的：防剧透 + 运行时最小化；测试所需信息在夹具文件中。
- **测试夹具** `tools/testdata/challenge/<gameId>.json` 保留完整 stage（含 `referencePlan` / `acceptance` / `integration`），仅供测试与 Reviewer 使用，不随静态站点发布。
- `content` 内的设计字段不做改名/裁剪（例如黄金矿工的 `referenceCatchOrder` 属于设计 content，测试可用；游戏实现只按 `content` 构建关卡，不按屏幕坐标硬编码）。
- 数据由页面 `<script src="../challenge/<gameId>.js">` 同步加载：无 fetch、无网络、无构建步骤；缺失或不足 6 关时 `A.Challenge` fail closed 返回空。

## 4. 校验输出摘要

生成器自检：PASS（2128 条断言，覆盖 13 个源文件/78 关结构、id/编号、必填字段、content、requiredFeatures、mode、路线引用、胜负条件、生成物语法与防剧透检查）。

设计包自带校验 `py -3 docs/arcade/0.9/scripts/validate_levels.py`（cwd=`docs/arcade/0.9`）：

```text
Content pack: 13 games, 78 stages
  design-contract: 234 assertions
  exact-simulation: 454 assertions
  geometry: 220 assertions
  inventory: 117 assertions
  ray-clearance: 51 assertions
  timeline: 12 assertions
PASS: content contract and reference checks. NOT an original-engine physics or mobile playtest.
```

## 5. 如何重跑

```powershell
node tools/arcade_09_data.mjs
```

- 前置：Node ≥ 22（仅用内置模块，零 npm 依赖）、`py -3`（Python 3）可运行设计包校验脚本。
- 行为：读设计源 → 结构校验（fail closed，非 0 退出且不写文件）→ 复跑设计包校验（要求 1088 断言 PASS）→ 生成 13 个运行时数据、13 个测试夹具、`index.json` 与本报告。
- 校验生成物语法：`node --check apps/arcade/challenge/shadow-leap.js`（13 个文件均应通过）。
- 幂等：重复运行输出字节一致；如需核对可用 `Get-FileHash` / `sha256sum`。

## 6. 已知事项 / 发布前处理

- `apps/arcade/sw.js` 的 shell 预缓存已加入这 13 个数据文件，但缓存 `VERSION` 仍是 `0.7.0`；**发布前必须升缓存版本**，否则老用户离线态可能拿不到新数据。
- `ARCADE_VERSION` 保持 `0.7.0`（0.8/0.9 均未发布），不存在构建步骤；生成物入库供静态站点直接加载。
- 设计包校验只证明设计数据存在参考解，不代表真实引擎物理/移动端可玩；后者由各游戏 `impl/<gameId>.md` 与测试证据补齐。
