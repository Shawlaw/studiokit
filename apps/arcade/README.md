# 街机厅 Arcade

**应用版本：0.3.2｜进度 Schema：v1｜局内存档 Schema：v1**

竖屏街机小游戏合集：网页加载后纯本地游玩，自带自研轻量物理引擎（重力、AABB/圆碰撞、单向平台、单摆积分、塔体倾斜力矩）。所有游戏由简到难、随时可暂停，并会把未完成的局内进度自动保存在本机。

## 游戏清单（默认按难度由简到难）

| 游戏 | 文件 | 难度 | 玩法 | 核心机制 |
| --- | --- | --- | --- | --- |
| 🃏 记忆翻牌 | `games/memory-flip.html` | 轻松 | 翻牌配对，6 关由少到多 | 关卡递进、预览时间递减 |
| 🔢 2048 合成 | `games/merge-2048.html` | 轻松 | 滑动数字合成 2048 | 合并、动画、一步撤销 |
| 🐰 雪铃 | `games/snowbells.html` | 适中 | 兔子踩铃铛向上连跳 | 圆-圆碰撞、可达性受控的铃铛生成 |
| 🧱 砖块计划 | `games/brick-breaker.html` | 适中 | 挡板反弹打碎砖墙 | 球体反弹、砖块 HP、道具 |
| 🌀 重力翻转 | `games/gravity-flip.html` | 适中 | 一键翻转重力躲尖刺 | 重力翻转、视差障碍、星星 |
| 🐍 贪吃蛇 | `games/snake-run.html` | 适中 | 吃果实变长 | 网格移动、加速、障碍、3 生命 |
| 🔨 打地鼠 | `games/mole-whack.html` | 适中 | 45 秒连击敲地鼠 | 刷新节奏、连击、炸弹/金鼠 |
| 🧊 俄罗斯方块 | `games/block-drop.html` | 挑战 | 经典落块消除 | Bag-7、踢墙旋转、DAS、幽灵块、触屏按钮面板 |
| 🚀 星海突击 | `games/star-raid.html` | 挑战 | 雷电式纵版弹幕射击 | 四类敌机、散射/激光/追踪/速射 Buff |
| 🏎 极速车道 | `games/road-rush.html` | 挑战 | 四车道赛车避障 | 伪 3D 透视、速度递增、生命 |
| 🥷 影跃 | `games/shadow-leap.html` | 硬核 | 忍者无尽上跳 | 单向平台、移动/易碎平台、落点受控 |
| 🏗 层塔 | `games/pendulum-tower.html` | 硬核 | 钟摆叠箱子 | 单摆逐层加速、偏心力矩、倒塌 |
| ⛏ 黄金矿工 | `games/gold-miner.html` | 硬核 | 摆钩挖金，限时达标 | 单摆逐关加速、重量拉回、炸药 |

游戏清单的唯一来源是 `engine.js` 顶部的 `GAMES` 数组；中心页卡片、搜索/筛选、难度与续玩入口均以此为准。新增游戏时在 `games/` 下加页面并登记到该数组。

## 统一体验

- **由简到难**：每款游戏内部都有渐进难度（关卡、速度、障碍、敌机密度等）；中心页默认按难度排序，也支持按类型筛选和关键词搜索。
- **随时暂停**：每个游戏顶栏都有暂停按钮，键盘 `P` / `Esc` 也可暂停；页面失焦或切到后台会自动暂停。
- **触屏友好**：俄罗斯方块提供独立的左移 / 旋转 / 右移 / 软降 / 硬降按钮面板（按住连续操作）；极速车道提供左右变道按钮，一次点击只移动一条车道；其余游戏使用拖动、半屏触摸或滑动。
- **公平性与节奏**：星海突击按 4 阶段波次推进并设敌机/敌弹上限；雪铃同一铃铛一局只计一次分；影跃只生成可达平台并延迟引入移动/易碎机制；极速车道生成时保留可达安全走廊；层塔前 3 层显示落点投影；黄金矿工前 5 关有不同物品池/炸药/摆速，并支持达标提前结算。
- **小屏适配**：暂停按钮 44×44 CSS px，支持 320×568 / 375×667 / 390×844 / 430×932，使用 safe-area 内边距与动态视口高度；不再全页禁用缩放。
- **局内进度本地可恢复**：每 3–4 秒自动保存一次，暂停/离开页面时立即保存；重新打开游戏会询问「继续上次 / 重新开始」。中心页「继续上次」区域会列出所有未完成进度。
- **中心页管理**：搜索、类型筛选、只看玩过、排序（推荐 / 难度 / 最近 / 最高分 / 名称）、单游戏清除、全部清除、JSON 导出/导入（含局内进度）。

## 文件结构

- `index.html` — 街机厅中心页：搜索/筛选/排序、继续上次、游戏卡片、最高分/游玩次数、进度管理。
- `engine.js` — 自研共享运行时：固定步长游戏循环、物理辅助、粒子系统、WebAudio 合成音效、进度与局内存档、暂停/续玩 UI 辅助、游戏清单。
- `arcade.css` — 街机厅内部共享样式（深色街机主题、竖屏舞台布局、卡片网格、筛选栏）。
- `games/*.html` — 各游戏独立单页，互不影响；一个游戏出错不影响其他游戏。

## 在 StudioKit 中的位置

- 注册表条目：`shared/tool-registry.json` 中 `id: "arcade"`，入口 `./apps/arcade/`，状态 `available`。
- 共享 shell：中心页引用 `../../shared/site.css` 与 `site-shell.js`；游戏子页位于 `games/` 深层，shell 返回链接由脚本自身 URL 推导站点根，任意深度可用。

## 本地运行

```
python -m http.server 8000
# 打开 http://localhost:8000/apps/arcade/
```

直接双击 `apps/arcade/index.html`（file://）也可游玩：游戏清单内联在 `engine.js` 中，无 fetch 依赖。

## 数据与隐私

- 无任何网络请求、埋点或第三方资源；音效由 WebAudio 实时合成。
- localStorage 键（均带 `studiokit:arcade:` 命名空间）：
  - `studiokit:arcade:progress:v1` — 全部游戏的 `{ high, plays, lastAt, lastScore }`（Schema v1；`lastScore` 为兼容扩展字段）。
  - `studiokit:arcade:runs:v1` — 未完成的局内进度快照（Schema v1，每款游戏一条，含 `savedAt` / `score` / `summary` / `data`）。
  - `studiokit:arcade:prefs:v1` — 偏好（当前仅 `muted` 静音）。
- 中心页支持导出/导入 JSON 备份（`format: studiokit-arcade-progress`，含 `schemaVersion` / `appVersion` / `exportedAt` / `state` / `runs`）。旧备份没有 `runs` 字段时仍可导入，并保留当前局内进度。
- `engine.js` 顶部的 `ARCADE_VERSION` 需与注册表 version 保持同步（`validate_site.py` 会检查）。

## 测试

```
py -3 tools/validate_site.py
py -3 tools/build_site.py
node tools/arcade_smoke.mjs   # 需要本机 Chrome；自动启动本地静态服务器与无头浏览器
```

## 已知边界

- 无排行榜/云存档（离线优先约束，无后端）。
- 本轮自动化覆盖 320/375/390/430 模拟视口与 51 项 CDP 检查；未执行 iOS/Android 真机试玩与 5000/10000 次种子穷举，相关生成器结论为结构约束 + 采样验证，真机表现保留为 UNVERIFIED。
- 局内进度只保存在当前浏览器 localStorage；清除站点数据会丢失（请使用导出备份）。
- 画布逻辑分辨率固定 420×740，靠 CSS 等比缩放适配竖屏；横屏桌面以竖窗呈现。
