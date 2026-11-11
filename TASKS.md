# StudioKit Task Queue

机器可读队列：[`tasks/queue.json`](tasks/queue.json)。状态变更可使用 `python tools/agentctl.py`。

| ID | 类型 | 任务 | 状态 | 依赖 | 备注 |
|---|---|---|---|---|---|
| T001 | agent | 审计启动包、仓库结构与路径约定 | DONE | — | 结构符合 AGENTS.md；Badge Studio 2.2.0 / Schema v3 / autosave key 不变均已核实 |
| T002 | agent | 执行校验/构建/脚手架测试并修复问题 | DONE | T001 | validate/build/node --check 全部通过；脚手架在临时副本验证，主工作树未污染 |
| T003 | review | 独立发布前审查 | DONE | T002 | 独立 Reviewer Agent：APPROVE-WITH-NOTES（0 Blocker / 0 Major / 2 Minor）；两个 Minor 已修复并回归 |
| T004 | agent | 准备首个提交并核验提交内容 | DONE | T003 | 提交 `5fc840b`（分支 `flash/bootstrap-baseline`，37 文件）；diff --check 干净；仅本地，未推送 |
| T005 | agent | 首次 GitHub Pages 发布与线上验证 | DONE | T004 | Owner 提供 remote 并授权 PUBLISH_TO_MAIN；提交 `16b750e`；Actions run `41262967540` 成功；线上 https://shawlaw.github.io/StudioKit/ 验证通过 |
| T006 | agent | 替换默认徽章示例文字为中性项目内容并升版 2.2.1 | DONE | T004 | Owner 指令；默认内容改为 STUDIOKIT/BADGE STUDIO/◎；原始个人示例不出现在任何提交历史；版本全链同步；浏览器验证通过 |
| T007 | agent | 全仓库个人信息泄漏审计与处置 | DONE | T006 | 内容层零泄漏（邮箱/手机/身份证/用户名/路径/base64/注释全查）；Git 提交身份经 Owner 决定保持现状；BASELINE.md 溯源段按 Owner 决定整体删除 |
| T008 | agent | 小写 URL /studiokit 可访问（仓库改名） | DONE | T005 | 仓库改名 Shawlaw/StudioKit→studiokit；https://shawlaw.github.io/studiokit 301→200；浏览器级验证通过；旧混合大小写 URL 不被 Pages 重定向（已记录，无外部链接影响） |
| T009 | agent | 门户去冗余文案（let UI speak for itself） | DONE | T008 | 提交 `65e63b8`；hero/关于/导航/英文标语移除，页脚压缩为单行；run `41265543819` 成功；线上复测零冗余零溢出零 404 |
| T010 | agent | 街机厅 Arcade：竖屏物理小游戏合集 | DONE | T009 | 本地分支 `feat/arcade-hall` 9 提交；中心页 + engine.js + 4 游戏（星海突击/影跃/层塔/雪铃）+ 自研物理与合成音效；registry `draft` v0.1.0 待 Owner 验收；validate/build/node 全过；浏览器实测可玩与窄屏通过；仅本地未推送 |
| T011 | agent | 街机厅增补 GBA 经典三连 + 移动端触控适配 | DONE | T010 | 俄罗斯方块/极速车道/黄金矿工接入，升版 0.2.0；全部游戏 PC+触摸双输入、viewport/滚动/选中触控加固；8 页面 375px 无溢出；浏览器实测三游戏（128 分/287m/$865 超标）通过 |
| T012 | agent | 街机厅 0.3.0：13 款竖屏游戏、局内进度恢复、搜索筛选与人工反馈修复 | DONE | T011 | 新增 6 游戏；RunSave 局内档；搜索/筛选/续玩；雪铃可达、矿工/层塔摆速、星海 4 Buff、方块触屏面板；validate/build/34 项 CDP 冒烟全过 |
| T013 | agent | 街机厅 0.3.0 发布：推送 main 并验证 GitHub Pages | DONE | T012 | 推送 `aba11a9`；Actions run `42501786872` 成功；线上 13 卡/v0.3.0/registry available；13 游戏页 200 |
| T014 | agent | 街机厅 0.3.1：按游戏性评审包优化公平性、输入与移动端布局 | DONE | T013 | 输入多指/取消、雪铃去重、影跃可达、星海波次、赛车安全走廊、矿工关卡、44px 暂停；49/49 CDP；真机/大规模种子 UNVERIFIED |
| T015 | agent | 街机厅 0.3.1 发布：独立审核后 fast-forward 合入 main 并验证 Pages | DONE | T014 | Reviewer A/B/C/D 复核无 Blocker/Major；`793a6fd` ff 合入 main；Actions `42565028915` 成功；线上 0.3.1/13 卡/子路径 shell 正确 |
| T016 | agent | 街机厅 0.3.2：修复矿工夹取显示与记忆翻牌难度曲线 | DONE | T015 | 夹中物仅随钩爪绘制；记忆 6 关 6→24 张、预览 3.2→1.8s；51/51 CDP；提交 `2df2dbd` 已发布 |
| T017 | agent | 街机厅 0.3.2 发布：fast-forward 合入 main 并验证 Pages | DONE | T016 | `2df2dbd` ff 合入 main；Actions `42625773149` 成功；线上 0.3.2/13 卡，无头 Chrome 9/9 通过 |
| T018 | agent | 街机厅 0.4.0：全屏沉浸游玩 + 黄金矿工摆速与限量道具 | DONE | T017 | 全屏/CSS 降级/偏好记忆；矿工摆速 300 起、道具 2/1/1、指哪打哪/加时/绞盘；57/57 CDP、validate/build 全过；仅本地未发布 |
| T019 | agent | 街机厅 0.4.0 发布：提交并推送 main，验证 GitHub Pages | DONE | T018 | `49bc1aa` ff 合入 main；Actions `42846474565` 成功；线上 0.4.0/13 卡/全屏与道具可用；57/57 CDP |
| T020 | agent | 根目录文档同步 Arcade 0.4.0 与当前发布状态 | DONE | T019 | README/CHANGELOG/START-HERE/AGENTS/CONTRIBUTING + docs；链接/validate/build/node 全过；docs-only；Owner 已授权推送 |
| T021 | agent | 街机厅 0.5.0：游玩统计、分享、PWA 安装与离线预载 | DONE | T020 | playtime:v1 独立 Schema；统计/分享/预载 UI；manifest+SW+图标；62/62 CDP（含断网）；validate/build/node 全过；后续随 T023 发布 |
| T022 | agent | 黄金矿工连续使用指哪打哪后钩爪停摆修复 | DONE | T021 | 根因：正下方目标摆角/角速度归零；修复：最小角速度 + 收钩/旧档恢复兜底；连续 3 轮回归；63/63 CDP；commit `c8c049d` |
| T023 | agent | Arcade 0.5.0 发布：推送 main 并验证 GitHub Pages | DONE | T022 | Owner 明确指令“都可以直接提交发布上线”；`b8abe41`+`c8c049d` ff 合入 main；Actions `42974993445` 成功；线上 0.5.0/13 卡/PWA/预载 24-24/矿工连续瞄准通过 |

## 任务命令

```powershell
python tools/agentctl.py list
python tools/agentctl.py next
python tools/agentctl.py claim T001
python tools/agentctl.py done T001 --evidence "validate_site.py passed; baseline inspected"
```

T005 必须额外提供授权标志：

```powershell
python tools/agentctl.py claim T005 --owner-authorized
```

`--owner-authorized` 只是队列状态门槛，不替代 Owner 在当前任务中对目标仓库和发布行为的明确授权。
