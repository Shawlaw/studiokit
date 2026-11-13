# StudioKit Arcade 0.9.0 · 首批 78 关策划交付包

> **这是设计候选包（Design v1），不是正在开发的 0.8.0 补丁、运行版游戏或可直接部署的 Release。**
>
> 为避免覆盖正在进行的 0.8.0 开发，所有关卡均以 `challenge` 独立模式声明，保留经典/无尽玩法和现有存档。实施前必须读取 **本地 HEAD 和 0.8.0 最终实现**；不得使用本包的数据去覆盖 `tasks/queue.json`，不得自动 Push/Tag/发布。

## 一、交付清单

- `PACK-MANIFEST.json`：版本/数量/数据源清单。
- `LEVEL-ATLAS.html`：无需联网/无CDN的交互式78关静态布局图谱，双击本地浏览器即可逐关看关卡草图（非游戏运行截图）。
- `QA-REPORT.md`：校验输出、发现并修正的设计缺陷、尚待实际物理验证的风险。
- `levels/<game>.json`（13 个）：机器可读、每款 **6 关**；玩家目标、学习技巧、探索奖励、地图/棋盘/事件脚本、具体通关参考、失败/移动端/AFK 验收。
- `levels/stages/<game>-Cxx.json`（78 个）：独立任务卡引用的**单关原子数据**。
- `docs/LEVEL-INDEX.md`：78 关总览；`docs/<game>.md`（13 个）为逐关完整人类可读设计。
- `docs/01-PRODUCT-AND-LEARNING.md`：游戏性的统一方法与关卡组合原则。
- `docs/02-INTEGRATION-AND-SCHEMA.md`：坐标、模式、状态迁移、适配接口与校验范围。
- `docs/03-MOBILE-AFK-ACCESSIBILITY.md`：触摸、暂停与中断、可访问性细则。
- `docs/04-PLAYTEST-QUALITY-GATES.md`：自动/人工验收分类、发布准入与证据模板。
- `docs/05-0.8-TO-0.9-MIGRATION.md`：并行开发安全边界与差异核对步骤。
- `docs/06-BALANCE-AND-REVIEW.md`：实际调参与失败反馈、Owner 试玩阶段。
- `tasks/PROPOSED-QUEUE-NOT-IMPORTED.json`：84 张**仅建议**任务卡，含 78 关、基础、审查与发布门禁。
- `FLASH-START.md`：适合低成本 Flash Agent 的完整执行 Prompt。
- `scripts/validate_levels.py`：可独立运行的内容校验/简化解答复放；零外部依赖。
- `scripts/render_docs.py`：根据 JSON 生成蓝图、单关文件与候选任务清单（注意只在本交付包内写文件）。
- `scripts/render_atlas.py`：根据最新关卡数据重新生成离线 `LEVEL-ATLAS.html`。
- `scripts/build_pack.py`：设计数据源/生成器；**改设计时先改这里，并重跑 build→render→validate**，不要只改衍生 JSON。

## 二、先阅读顺序（给 Owner 和 Agent）

1. 本 README 和 `docs/05-0.8-TO-0.9-MIGRATION.md`，确认现在不碰正在开发的 0.8.0。
2. `docs/LEVEL-INDEX.md` 浏览 78 关主题、技巧和探索差异。
3. 读目标游戏的 `docs/<game>.md` 和 `levels/stages/<game>-Cxx.json`。
4. 读 `docs/02-INTEGRATION-AND-SCHEMA.md` 与 `docs/03-MOBILE-AFK-ACCESSIBILITY.md`。
5. 运行 `py -3 scripts/validate_levels.py`（Linux/macOS：`python3`）。
6. 使用 `FLASH-START.md` 给 Flash Agent 的第一个任务；**只发一个阶段任务**。先完成《影跃》C01–C03 后 Owner 试玩，再铺剩余关卡。

## 三、现在证明了什么、没有证明什么

**已可机械验证**：78 关数量、基础结构、世界坐标界限、地图与参考答案存在、方块参考落点清行、2048 合并结果、贪吃蛇包含真实蛇身的路径、四车道离散转移序列、记忆配对完备性、矿工价值及直线先触达障碍、关卡事件时间序列约束。

**尚未得到真实游戏运行证据**：《影跃》的惯性与影冲实际跳跃、《雪铃》的实时碰撞与镜头、《极速车道》的变道过渡动画碰撞、《黄金矿工》的摆钩等待及回收时间、《层塔》的倾斜物理、《重力翻转》的纵向加速度与障碍相交、《砖块计划》的弹道可达、星海弹幕可走廊。Flash Agent **必须在相应引擎中用确定性回放**通过后才能判关卡 DONE，必要时记录与策划稿偏差。

**设计布局 ≠ 已经完成关卡开发。** 刚好适用于让 Flash 做工程落地、让 Reviewer 检查公平性、让 Owner 检查是否好玩。

## 四、风格约束

**不沉迷设计**：无签到、无日常登录、无失效奖励、无体力、无排行榜必须在线、无跨局战力压迫。每关可随时暂停、刷新和恢复，不玩没有损失。难度来自选择与技巧，不是偷袭、纯 RNG、对触屏不友好。

## 五、源代码基线（截至 2026-11-13）

审核公共主干：`https://github.com/Shawlaw/studiokit`，公开 README 显示 Arcade 0.7.0 / 13 游戏。Owner 已明确 0.8.0 **在开发中**，因此本包**不声称审查了 0.8.0 未合并分支**，也不声称 0.9.0 已存在。所有“需要实现的新机制”先与 0.8 的实际差异对照。

## 六、仅供核验的命令

```powershell
# 解压目录内（无需联网，无需第三方 Python 包）
py -3 scripts\validate_levels.py

# 需要重新生成衍生JSON/MD时（请先修改 scripts/build_pack.py 的源策划数据）
py -3 scripts\build_pack.py
py -3 scripts\render_docs.py
py -3 scripts\render_atlas.py
py -3 scripts\validate_levels.py
```

**没有安装/导入 tasks 的命令**：这份包故意不修改用户进行中的工作队列。
