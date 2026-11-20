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
| 运行时数据文件 | 13 个，合计 229556 字节 |
| 测试夹具文件 | 13 个（323406 字节）+ index.json（7425 字节） |
| 生成器自检 | PASS（3020 条断言） |
| 设计包校验 | PASS（1090 条断言：design-contract 234 / exact-simulation 456 / geometry 220 / inventory 117 / ray-clearance 51 / timeline 12） |
| 幂等性 | 脚本不使用时间戳/随机数；同一输入重复运行输出字节一致 |

## 2. 源文件与生成字节

| gameId | 游戏 | 源文件 | 源 SHA-256 | 关数 | 运行时字节 | 夹具字节 | stage ids |
| --- | --- | --- | --- | --- | --- | --- | --- |
| shadow-leap | 影跃 | docs/arcade/0.9/levels/shadow-leap.json | `d58b291cdeb7d3b388f209af4ce7a0fcedffcbfa42f372bf8295e6b841c6e386` | 6 | 19338 | 27257 | shadow-leap-C01, shadow-leap-C02, shadow-leap-C03, shadow-leap-C04, shadow-leap-C05, shadow-leap-C06 |
| snowbells | 雪铃 | docs/arcade/0.9/levels/snowbells.json | `b037e9e8c70483efd7dde498d1e1ebbdd73080a57731f8e6628c2511b8edc476` | 6 | 16987 | 23167 | snowbells-C01, snowbells-C02, snowbells-C03, snowbells-C04, snowbells-C05, snowbells-C06 |
| star-raid | 星海突击 | docs/arcade/0.9/levels/star-raid.json | `858b194a1c5c6528d62c4c007807f0643152dee7da73048ed02a3e20ef1940b8` | 6 | 26011 | 31736 | star-raid-C01, star-raid-C02, star-raid-C03, star-raid-C04, star-raid-C05, star-raid-C06 |
| pendulum-tower | 层塔 | docs/arcade/0.9/levels/pendulum-tower.json | `946b8fa0fdf61f92a45c1fde8ff396471eefdb81808356df458137f273c30440` | 6 | 15184 | 21365 | pendulum-tower-C01, pendulum-tower-C02, pendulum-tower-C03, pendulum-tower-C04, pendulum-tower-C05, pendulum-tower-C06 |
| block-drop | 俄罗斯方块 | docs/arcade/0.9/levels/block-drop.json | `7dbc6770d45ef33ce717e0182f46319ab0c24e257f9981d0f9084c3763270c5d` | 6 | 20468 | 26209 | block-drop-C01, block-drop-C02, block-drop-C03, block-drop-C04, block-drop-C05, block-drop-C06 |
| road-rush | 极速车道 | docs/arcade/0.9/levels/road-rush.json | `5816604b9ae3f54c293e90031e5d019ca2ef1159019e9a97b99052f44c8b25dc` | 6 | 28612 | 35735 | road-rush-C01, road-rush-C02, road-rush-C03, road-rush-C04, road-rush-C05, road-rush-C06 |
| gold-miner | 黄金矿工 | docs/arcade/0.9/levels/gold-miner.json | `0500e1af734a438a3aeeaeb10e37c06be70ed47a37a0d63f58e3478c612f9b1d` | 6 | 16081 | 23577 | gold-miner-C01, gold-miner-C02, gold-miner-C03, gold-miner-C04, gold-miner-C05, gold-miner-C06 |
| brick-breaker | 砖块计划 | docs/arcade/0.9/levels/brick-breaker.json | `5e3499cfc7126513472960a907d9260fd8f8ab83bca807c98b9200a2f8ae8b9b` | 6 | 9716 | 15460 | brick-breaker-C01, brick-breaker-C02, brick-breaker-C03, brick-breaker-C04, brick-breaker-C05, brick-breaker-C06 |
| gravity-flip | 重力翻转 | docs/arcade/0.9/levels/gravity-flip.json | `4f0762efeb9bf1c5fee758fc182d4b30b1f209a9bcc8d2e8b1ecf9f6033d41b4` | 6 | 15247 | 22484 | gravity-flip-C01, gravity-flip-C02, gravity-flip-C03, gravity-flip-C04, gravity-flip-C05, gravity-flip-C06 |
| snake-run | 贪吃蛇 | docs/arcade/0.9/levels/snake-run.json | `31675ce5f14471cb5576efa7654d733a1dab0fe03e7e802ad5c96f661cda767b` | 6 | 18809 | 25329 | snake-run-C01, snake-run-C02, snake-run-C03, snake-run-C04, snake-run-C05, snake-run-C06 |
| mole-whack | 打地鼠 | docs/arcade/0.9/levels/mole-whack.json | `25559c82f6501fdc0a03382fce42cf2d8d1d7a6e51eecc8077bdea07601e2fae` | 6 | 22162 | 28178 | mole-whack-C01, mole-whack-C02, mole-whack-C03, mole-whack-C04, mole-whack-C05, mole-whack-C06 |
| memory-flip | 记忆翻牌 | docs/arcade/0.9/levels/memory-flip.json | `cc2c34a2bfd150ac980ff85f8a6883468d48758211ecc2667163f8e91ec397e2` | 6 | 10656 | 25357 | memory-flip-C01, memory-flip-C02, memory-flip-C03, memory-flip-C04, memory-flip-C05, memory-flip-C06 |
| merge-2048 | 2048 合成 | docs/arcade/0.9/levels/merge-2048.json | `eab28fd4fe9f817b5fde6856f6b1219783e031326644d733ea0f178e4ad91752` | 6 | 10285 | 17552 | merge-2048-C01, merge-2048-C02, merge-2048-C03, merge-2048-C04, merge-2048-C05, merge-2048-C06 |

## 3. 字段取舍（防剧透）

运行时数据 `apps/arcade/challenge/<gameId>.js` 的结构：

```js
window.ArcadeChallengeData = window.ArcadeChallengeData || {};
window.ArcadeChallengeData['<gameId>'] = {
  schemaVersion: '1.0.0', gameId, gameName, packVersion: '0.9.0-design-v1',
  supportedFeatures: [...], // 每游戏声明的运行时特性白名单
  stages: [{ id, stageNumber, title, difficulty, goalStatement, decision,
             practicedSkill, discovery, targetDurationSec, requiredFeatures, content,
             contentRevision }] // contentRevision = stageId@packVersion@contentHash12
};
```

- **保留**：`id` / `stageNumber` / `title` / `difficulty` / `goalStatement` / `decision` / `practicedSkill` / `discovery` / `targetDurationSec` / `requiredFeatures`（由 `integration.requiredFeatures` 拍平）/ `content`（按每游戏白名单校验后原样保留）/ `contentRevision`（packVersion + stage id + content canonical hash）。
- **不进入运行时**：`referencePlan`（设计者参考路线/答案）、`acceptance`（验收脚本与自动回放）、`integration` 对象本体、`chapter` / `designerNotes`（设计备注）。目的：防剧透 + 运行时最小化；测试所需信息在夹具文件中。
- **0.10.0 防剧透收敛**：`content.referenceCatchOrder` 从运行时投影删除（黄金矿工运行时不再拿到抓序答案）；测试夹具仍完整保留该字段。运行时最小化旨在避免误用，不声称源码保密。
- **测试夹具** `tools/testdata/challenge/<gameId>.json` 保留完整 stage（含 `referencePlan` / `acceptance` / `integration` / `referenceCatchOrder` / `contentRevision`），仅供测试与 Reviewer 使用，不随静态站点发布。
- **0.10.0 content 字段白名单**：每游戏 `CONTENT_WHITELIST` 列出允许的 content 顶层字段；未知字段默认 FAIL（fail closed），防止未评审字段进入运行时。`integration.requiredFeatures` 必须是 `SUPPORTED_FEATURES[gameId]` 子集，否则 FAIL。
- 数据由页面 `<script src="../challenge/<gameId>.js">` 同步加载：无 fetch、无网络、无构建步骤；缺失或不足 6 关时 `A.Challenge` fail closed 返回空。

## 4. 校验输出摘要

生成器自检：PASS（3020 条断言，覆盖 13 个源文件/78 关结构、id/编号、必填字段、content、requiredFeatures、mode、路线引用、胜负条件、生成物语法与防剧透检查）。

设计包自带校验 `py -3 docs/arcade/0.9/scripts/validate_levels.py`（cwd=`docs/arcade/0.9`）：

```text
Content pack: 13 games, 78 stages
  design-contract: 234 assertions
  exact-simulation: 456 assertions
  geometry: 220 assertions
  inventory: 117 assertions
  ray-clearance: 51 assertions
  timeline: 12 assertions
PASS: content contract and reference checks. NOT an original-engine physics or mobile playtest.
```

## 5. 如何重跑

```powershell
node tools/arcade_09_data.mjs            # 生成并写入全部派生文件
node tools/arcade_09_data.mjs --check    # 仅内存生成，逐字节对比入库文件，不写文件
```

- 前置：Node ≥ 22（仅用内置模块，零 npm 依赖）、`py -3`（Python 3）可运行设计包校验脚本。
- 行为：读设计源 → 结构校验（含 content 白名单 / supportedFeatures，fail closed，非 0 退出且不写文件）→ 复跑设计包校验（要求 1090 断言 PASS）→ 内存生成 13 个运行时数据、13 个测试夹具、index.json、本报告与 SHA256SUMS.txt → 写入或 --check 对比。
- 校验生成物语法：`node --check apps/arcade/challenge/shadow-leap.js`（13 个文件均应通过）。
- 幂等：重复运行输出字节一致；`--check` 会用 canonical JSON（递归排序 key、UTF-8、LF）重算 SHA256SUMS.txt 并与入库文件逐字节比较，任一漂移即 FAIL。
- SHA256SUMS.txt 采用 canonical JSON + UTF-8 + LF 口径，不能用 `sha256sum -c` 直接按原始字节校验；请用 `--check`。

## 6. 已知事项 / 发布前处理

- `apps/arcade/sw.js` 的 shell 预缓存包含这 13 个数据文件；缓存版本由 Lead 在 0.10.0 版本链中统一处理。
- 版本目标为 Arcade 0.10.0；`ARCADE_VERSION` / manifest / README 等版本链由 Lead 统一同步，本生成器只负责数据派生。
- 设计包校验只证明设计数据存在参考解，不代表真实引擎物理/移动端可玩；后者由各游戏 `impl/<gameId>.md` 与测试证据补齐。
