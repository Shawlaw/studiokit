# 街机厅 Arcade

**应用版本：0.2.0｜进度 Schema：v1**

竖屏街机小游戏合集：网页加载后纯本地游玩，自带自研轻量物理引擎（重力、AABB/圆碰撞、单向平台、单摆积分、塔体倾斜力矩）。

## 游戏清单

| 游戏 | 文件 | 玩法 | 核心物理 |
| --- | --- | --- | --- |
| 🚀 星海突击 | `games/star-raid.html` | 雷电式纵版弹幕射击，自动开火 | 弹道、圆-AABB 碰撞、正弦敌机 |
| 🥷 影跃 | `games/shadow-leap.html` | 忍者无尽上跳（Doodle Jump 式） | 重力、单向平台着陆、触墙反弹 |
| 🏗 层塔 | `games/pendulum-tower.html` | 钟摆叠箱子，偏心会晃塔 | 单摆积分、自由落体、偏心力矩、倒塌刚体 |
| 🐰 雪铃 | `games/snowbells.html` | 兔子踩铃铛向上连跳 | 圆-圆弹性碰撞、连击音阶 |
| 🧱 俄罗斯方块 | `games/block-drop.html` | 经典落块消除（Bag-7、踢墙旋转、幽灵块） | 网格碰撞、锁定延迟、DAS 输入 |
| 🏎 极速车道 | `games/road-rush.html` | n 路赛车避障竞速 | 伪 3D 透视车道、相对速度、AABB 碰撞 |
| ⛏ 黄金矿工 | `games/gold-miner.html` | 摆钩挖金，限时达标过关 | 单摆钩爪、抓取判定、重量决定拉回速度 |

游戏清单的唯一来源是 `engine.js` 顶部的 `GAMES` 数组，中心页卡片与各游戏 id 均以此为准；新增游戏时在 `games/` 下加页面并登记到该数组。

## 文件结构

- `index.html` — 街机厅中心页：游戏卡片、最高分/游玩次数展示、进度管理（导出/导入 JSON、清除记录）。
- `engine.js` — 自研共享运行时：固定步长游戏循环、物理辅助、粒子系统、WebAudio 合成音效、进度存储、游戏清单。
- `arcade.css` — 街机厅内部共享样式（深色街机主题、竖屏舞台布局、卡片网格）。
- `games/*.html` — 各游戏独立单页，互不影响；一个游戏出错不影响其他游戏。

## 在 StudioKit 中的位置

- 注册表条目：`shared/tool-registry.json` 中 `id: "arcade"`，入口 `./apps/arcade/`。
- 状态：`draft`（Owner 试玩验收后改为 `available`）。
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
  - `studiokit:arcade:progress:v1` — 全部游戏的 `{ high, plays, lastAt }`（Schema v1）。
  - `studiokit:arcade:prefs:v1` — 偏好（当前仅 `muted` 静音）。
- 中心页支持导出/导入 JSON 备份（`format: studiokit-arcade-progress`，含 `schemaVersion` / `appVersion` / `exportedAt`）。
- `engine.js` 顶部的 `ARCADE_VERSION` 需与注册表 version 保持同步。

## 已知边界

- 无排行榜/云存档（离线优先约束，无后端）。
- 星海突击暂无 Boss 战；层塔 miss（完全落空）直接结束。
- 画布逻辑分辨率固定 420×740，靠 CSS 等比缩放适配竖屏；横屏桌面以竖窗呈现。
