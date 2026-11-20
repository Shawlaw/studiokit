# Arcade 0.10.0 设计：棋牌规则修复、挑战深度与关卡数据管线

- 版本：Arcade `0.10.0`（2026-11-20 已双端发布）
- 日期：2026-11-20
- 范围：三款棋牌的规则/交互修复；13 款挑战的语义与内容优化；设计源、生成器、派生数据和测试链路升级。
- 不变项：所有 localStorage key 与 Schema 版本（progress/runs/prefs/playtime/challenge/scores 均为 v1）；三款新棋牌之外不新增发布文件；无网络/CDN/框架。
- 发布证据：提交 `fc37d2b` 推送 `main`；Actions run `44681529684` 四 job 全成功；双端 `verify_deploy.py` 41/41 一致；双端线上无头 Chrome 各 26/26；SW 缓存键 `studiokit-arcade-0.10.0-v1`。

## 1. 为什么做这一版

0.9.0 发布后复核表明，工程门禁很绿，但存在三类实际问题：

1. **真实规则错误**：二十一点庄家 natural 不立即结算，普通 21 同点给错分；接龙提示谎报死局并推荐无进展移动。
2. **关卡文案与判定不一致**：层塔 C05/C06 的目标没进入判定，2048 C06 文案与步数上限不一致，方块挑战写着无时间压力但仍有自然重力。
3. **参考解链路不够可信**：设计最终事实源是 `build_pack.py`，但部分测试复制手写答案；`acceptance` 只检查非空；运行时防剧透只过滤两个字段名。

本版以“修复真实问题 + 让数据链路可复验”为目标，不重写全部 78 关。

## 2. 三款棋牌修复

### 2.1 二十一点

- 初发四张后若任一方 natural（两张 21）立即结算；庄家 natural 玩家非 natural 记 0，双方 natural 按 push +25。
- 同点 push 判断先于普通 21 奖励；双方三张 21 为 push +25，不误给 +150。
- `swap` 仅在玩家回合可用，已结算手/庄家 natural 手不可救援；`finishHand()` 增加幂等保护。
- `selftest()` / `regression()` 新增状态化反例（seed39、双方三张 21、重复结算）。

### 2.2 五子棋

- AI 文案统一为“启发式推荐”，明确不代表最优解；AI 仍只做一层棋形评分，轻松陪练定位。
- `playToEnd()` 异常退出不再强制记和棋/写记录，防止把卡死伪装成正常结算。
- 320/375 增加 DOM 确认按钮 `[data-place-confirm]`，实测 320 下 81×44 CSS px、375 下 108×44，无页面溢出；两步预览确认保持。

### 2.3 纸牌接龙

- `collectHintMoves()`：选中牌无合法目标时回退全局提示；过滤“整列 K 从空列移到另一空列”的状态等价移动；翻牌/揭暗牌优先级提前。
- `serialize/restore` 可选恢复撤销栈、提示着法和剩余秒数；坏字段安全清空附加项，不丢牌局与道具。
- 结算与暂停弹层增加“重发一局”入口，降低随机不可解局与后段重复劳动的挫败。
- 随机发牌仍不保证可解，不宣称每局必胜；完整随机局胜率仍 UNVERIFIED。

## 3. 挑战实现修复

### 3.1 层塔

- 运行时消费 `win.minConsecutiveWithinTolerance` 与 `win.maxFinalTopCenterOffsetPx`；C05 无连续三层容差内不得通关，C06 检查塔顶中心偏移 ≤15px。
- 结算/HUD 展示连续达标数与塔顶偏差，失败原因可归因。
- 旧档/旧关缺字段不启用新门禁，保持 0.9.0 记录可比。

### 3.2 俄罗斯方块

- 挑战支持 `content.gravityModel='place-by-place'`：无自然重力，软降/硬降仍生效；缺省保持原自然重力。
- C04 上下井错开形成两个不同落点；C05 改 O+T 双孔真实摆法空间；C06 新增合法但失败落点说明。
- 挑战换块仍同步固定队列；失败建议保留。

### 3.3 2048

- 目标文案统一为“最多 N 步，参考 M 步”，M 从 `content.win.referenceSteps` 动态读取；旧档缺字段只显示“最多 N 步”。
- C05 换盘要求横向整理；C06 最短 4 步、上限 5 步，文案与数据一致。

### 3.4 星海突击

- 运行时支持可选 `content.splits`：以 `replaces` 指向原事件并拆成两个安全短段，形成有预告的二次换位。
- 不随机塞弹，不删除安全走廊；C03/C04 的设计数据已同步 `splits`。

### 3.5 极速车道

- 预告期对近距奖励车道绘制 `+5` 门牌，HUD 显示“普通 10 / 近距 15”。
- C01–C06 目标时长按实际时隙跨度校准（约 13–25 秒），不再强套 20–75 秒。

### 3.6 雪铃

- 彩铃命中产生本局可见 +25，不写经典最高分；C06 零错序通关显示纯视觉“雪花乐谱”，不持久化。
- C04/C06 设计数据新增真实彩铃支路；挑战安可仍禁用，避免无效消耗。

### 3.7 影跃

- 影门半径统一 20，高度高于末台；C04–C06 `goal.requireDash=true`，未用影冲不得触门，长路线保留。
- 影冲内容与门禁完全由数据驱动；运行时保留 retry 跨尝试累计时间。

### 3.8 重力翻转

- C01/C02/C04 推荐窗口收窄至已验证安全早段（左移 40、容差 35）。
- 运行时新增窗口判定测试钩子，验证早沿/中心/晚沿/端外；不改物理。

### 3.9 黄金矿工

- C03 调整 m1 价值和 r1 位置形成两条抓取路线；C05 限时 30 秒并给两条可达标顺序。
- 保留“时间到等待最后一钩收回”的 resolving 机制；运行时移除参考抓取顺序投影。

## 4. 数据与生成器升级

### 4.1 事实源与派生链

```text
build_pack.py（最终 authoring 源）
  → levels/<game>.json
    → render_docs.py → 单关 JSON / 蓝图 / 索引 / 建议队列
    → render_atlas.py → LEVEL-ATLAS.html
    → arcade_09_data.mjs → 运行时 challenge JS / 测试夹具 / 报告 / SHA256SUMS
```

修改任何关卡数值必须从 `build_pack.py` 开始，重跑全链路；不允许手改派生物作为最终答案。

### 4.2 新增数据字段

- 层塔 `win.minConsecutiveWithinTolerance` / `win.maxFinalTopCenterOffsetPx`
- 方块 `content.gravityModel`
- 2048 `win.referenceSteps`
- 星海 `content.splits`
- 车道 `content.bonusPreview`
- 雪铃 `content.bonusRoutes`
- 影跃 `goal.requireDash`
- 矿工 C05 `content.alternativeCatchOrders`
- 每关 `contentRevision = stageId@packVersion@contentHash12`

所有字段在 `arcade_09_data.mjs` 中按游戏建立白名单；未知字段默认 FAIL，`requiredFeatures` 必须是当前适配器支持能力的子集。

### 4.3 防剧透与哈希

- 运行时数据删除 `referenceCatchOrder`；测试夹具保留完整参考解。
- 记忆牌面、铃序、安全走廊等引擎必需字段仍会存在于客户端静态数据中；本版只承诺“运行时最小化、普通 UI 不主动展示答案”，不声称源码级保密。
- `SHA256SUMS.txt` 采用递归排序键的 canonical JSON + UTF-8 + LF，避免 CRLF/LF 造成跨平台漂移。
- `tools/arcade_design_check.py` 在临时目录重跑生成器并比对 143 个派生文件。

### 4.4 测试驱动改造

- `tools/lib/arcade_fixture.mjs` 统一加载夹具、解析 movesRLE、计算 canonical hash。
- 贪吃蛇方向序列、雪铃顺序、层塔释放偏置、影跃标题由硬编码改为夹具读取。
- `tools/arcade_stage_coverage.mjs` 生成 78 关证据覆盖矩阵；`forceStageClear` 不计入可玩性覆盖。
- `tools/arcade_run_all_gates.py` 顺序执行生成一致性、静态校验、构建、内联脚本、覆盖矩阵、smoke、zen、棋牌、全量玩法与基础回归。

## 5. 兼容与回滚

- 不新增/改名 localStorage key；不升 Schema 版本。
- `challenge:v1` 的 best 可选记录 `contentRevision` 与 `evaluation`，旧档缺失按旧版本处理，不删除记录。
- 旧关缺 `gravityModel` / `requireDash` / `minConsecutiveWithinTolerance` / `maxFinalTopCenterOffsetPx` / `referenceSteps` / `splits` 时均保持 0.9.0 行为。
- 回滚时恢复各游戏页与 `build_pack.py`，再重跑全链路生成；不要单独回滚派生 JSON 或 challenge JS。
- 真机 iOS/Android、低端机帧率、五子棋 AI 实战强度、随机接龙可解率仍为 UNVERIFIED。

## 6. 验收

见 `README.md`、`CHANGELOG.md`、`docs/BASELINE.md`、`docs/ROADMAP.md` 与任务队列；实际命令输出以本地提交前的门禁记录为准。
