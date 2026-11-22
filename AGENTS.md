# Agent Operating Contract

本文件适用于所有自动化 Agent（Flash / Codex / 其他 Worker）。遇到冲突时，优先级为：Owner 当前明确指令 > 本文件 > 任务卡 > 其他文档。

## 1. 项目事实

- StudioKit 是静态多工具 Monorepo，不是单一 SPA。
- 每个工具独立放在 `apps/<tool-id>/`，默认入口为 `index.html`。
- 首页工具清单唯一来源为 `shared/tool-registry.json`。
- 共享运行时仅限 `shared/site.css` 与 `shared/site-shell.js`；不要引入大型框架。
- 当前 Badge Studio 版本为 2.2.1，配置 Schema 为 v3，基线见 `docs/BASELINE.md`。
- 当前 Arcade 版本为 0.14.0（功能分支 `feat/arcade-star-raid-mow` 本地开发，未合并未发布；main 为 0.13.2 本地修复；线上已发布 0.13.1，上一版 0.13.0 同日发布）：16 款竖屏小游戏（13 款带 78 关挑战模式 + 二十一点/五子棋/纸牌接龙三款平和棋牌）+ 俄罗斯方块禅模式 + 积分记录表 + 棋盘优先画布 + 极速车道转向灯换道/连超/加速带/维修箱；结算「再来一局」重新打开模式选择，贪吃蛇触屏为相对蛇头方向的左右双按钮；0.11.2 新增 PWA 更新检测（中心页「检查更新」+ SW 版本握手），0.11.3 移除 `viewport-fit=cover` + 半透明状态栏 meta；0.11.4 真机定位「被模糊」对象是中心页共享 shellbar（`StudioKit / 街机厅 Arcade / 源码 ↗`），修复为 standalone 下 shellbar `position: sticky; top: 0` 贴顶；0.11.5 本地修复移动端双击误触放大（17 页 viewport + dblclick 拦截）与五子棋全屏落子按钮文字重影及预览取消出口；0.12.0 全屏底部按钮抬升（`--ac-thumb-lift`）+ 层塔持久重心物理模型（偏置堆叠会塌）+ 层塔全览（按钮/快捷键 3）+ 工地集装箱皮肤与 4 种真实生效属性；0.12.1 修复层塔物理一致性与全览：站立塔不再整体旋转（所见即所判）、倾斜改为支撑面/重心可视化、经典模式吊臂小车跟随塔顶（挑战仍按关卡固定 pivotX）、完美吸附力矩改用吸附后偏移、全览真正 zoom-to-fit（几十层也一屏装下）、落点投影常显；0.12.2 给释放的集装箱补上真实水平速度（`L·cosθ·θ̇ × 0.45`，可见抛物线，落点预测同源）；0.12.3 去掉全览的缩放下限（200/1000 层也能一屏看全塔）；0.12.4 修复 LOD 误按层数触发导致近景集装箱退化成色块的回归（LOD 只看缩放 + 视口裁剪）；0.12.5 层塔难度两段式曲线（约 157 层封顶）+ 升速时振幅归一（层数越高越快、摆幅不再塌缩）；0.12.6 PWA 独立窗口也套用拇指抬升并收起重复 hint 行（底部按钮与全屏同高、画布 +34px）；0.12.7 层塔难度按人类计时能力重标定（封顶完美窗口 28→56.5ms、可落 178→335ms，挑战零改动）；0.13.0 星海突击「星域远征」加入机库永久改装与星币（星币 = `floor(score / 16)` + 整备「军费补给 +40」，只由游玩得分产生，无内购/签到/广告）、局内火力等级 1–5、能量与枯竭（基础 1.2/s、枯竭被动 2.2/s 回能到 25 解除）、临时编队、核弹级大杀器（核弹/轨道炮/时空锚）、6 星区主题轮转（带分数补偿）、CLEAR 三选一整备（卡池 8 种）与动画反馈；机库存于引擎新增的通用游戏数据 key `studiokit:arcade:meta:v1`（`A.GameMeta.get/set/clear`，路径 `games['star-raid'].hangar`，机库 `formula: 1` 锁公式版本；`bay` 满级 1、大杀器槽 2→3；初始生命 `3+hull`、上限 `5+hull`），备份字段为 `gameMeta`；Boss 血量改为 `480 + (level-1)×280` 再乘主题 `bossHp`；挑战 6 关数据与判定零改动；0.13.1 修复 Owner 真机反馈：大杀器并入主道具行（iPhone 非全屏 PWA 也可见）、核弹改为追踪弹命中后爆炸（无 Boss 飞向画面中央）、机动强化（engine id 不变）改为受击无敌 +0.12s/级与拾取吸附 +6%/级（触屏有效）、机库浏览不再计入有效游玩时长；其运行时 `apps/arcade/engine.js` 是工具内共享，不要提升为全站 shared；0.13.2 修复 PWA「检查更新」显示已安装版本的 bug：engine `checkForUpdate()` 改为读取线上 `sw.js` 的 VERSION 并与页面/SW 版本对比（旧实现返回页面自身 ARCADE_VERSION = 已安装版本）、`version` 返回线上最新版本、SW `activate` 改用旧缓存证据判断升级接管并真正广播 `arcade-sw-update-ready`（旧 `firstActivation` 标志恒为 false，广播从未发出）、中心页横幅与提示同时显示最新/当前版本、读不到线上版本时提示失败而不谎报「已是最新」；游玩时长在 iOS 主屏 PWA 永久停摆：`Playtime` 旧实现要求 window `focus`（iOS 主屏 PWA 可能整段生命周期只给 `blur`、回前台只给 `visibilitychange`），漏一次 `focus` 后这一页永久不计时，而积分记录 `scores:v1` 仍照常写入；现改为只认「页面可见 + 弹层关闭」并新增 `syncSegment()` 在可见性/`pageshow`/用户点按按键/15 秒 tick 上自愈、`recordRound()` 结算后续开时间片；复现与设计见 `apps/arcade/DESIGN-0.13.2.md`；0.14.0 星海突击：同种弹种再次拾取改为叠加有效时长（`BUFF_STACK_CAP = 180s`，不再重置）；新增引擎可选第 4 弹层按钮 + 「星海割草」无尽演武（`mode = 'mow'`）：四种弹种常驻、火力 MAX、大杀器 3 槽满载且无限次、脉冲/星盾/编队无限（均消耗能量）、同屏 32 敌 + 密集掉落、Boss 四套专属弹幕与光晕警戒环；受击只扣能量不掉命，能量是唯一瓶颈；`serialize()` 在割草返回 null，不记分/不给星币/不参与最高分与积分记录、不写局内档，挑战 6 关数据与判定零改动；设计与回滚见 `apps/arcade/DESIGN-0.14.0.md`；旧版设计与回滚见 `apps/arcade/DESIGN-0.13.1.md`（0.13.0 见 `DESIGN-0.13.0.md`；0.12.7 见 `DESIGN-0.12.7.md`；历史版本按 `DESIGN-0.4.0` … `DESIGN-0.12.x` 逐版保留）与 `apps/arcade/DESIGN-block-controls.md`。
- Arcade 的离线能力仅限同源缓存：`apps/arcade/sw.js` 作用域为 `apps/arcade/`，可缓存 `shared/site.css` 与 `shared/site-shell.js`；不得借此引入远程资源、分析或后端。
- Venue Compare（`restaurant-compare`）当前 0.2.0 / `available`：餐厅考察对比、地图标注与外部链接 / 备注（仅 http/https）；IndexedDB 命名空间为 `studiokit:restaurant-compare`，导出为自包含只读 HTML；2026-11-16 双端发布。
- Rounded Image 尚未实现，不得假设旧功能、控件或参数。

## 2. 不可破坏的约束

1. **先读再改：** 开始任务前阅读本文件、`TASKS.md`、相关 ADR 和目标工具 README。
2. **保护既有工具：** 未经任务明确授权，不重写 Badge Studio 绘制算法、配置 Schema、撤销/重做、导入导出或自动保存行为。
3. **保护用户数据：** 不随意修改 localStorage key、配置字段或 Schema。若必须修改，提供兼容迁移、回滚方案和测试。
4. **默认离线优先：** 不新增 CDN、远程字体、分析 SDK、埋点、后端请求、第三方 API 或远程图片依赖，除非 Owner 明确授权。
5. **路径兼容：** 必须同时兼容 GitHub Pages 项目站点子路径与 Cloudflare Pages 根路径，禁止 `/assets/...` 这类从域名根目录解析的绝对路径。
6. **工具隔离：** 不共享业务状态；localStorage key 必须带工具 ID 命名空间。既有工具的历史 key 为兼容性保留，不得擅自改名。
7. **无构建依赖：** 默认不引入 npm、打包器或运行时框架。确有必要时先提交 ADR 和成本说明。
8. **小步提交：** 使用 Conventional Commits；一个提交聚焦一个意图；不 squash/rebase/force-push 用户未授权的分支。
9. **不伪造结果：** 没有实际执行的测试不能声称通过；没有看到 GitHub Actions 成功和线上页面可访问，不能声称发布成功。
10. **不提交秘密：** 不把 Token、Cookie、个人配置、字体授权文件、私密图片或本地数据写入仓库。

## 3. 标准执行流程

1. `git status --short --branch`，确认工作树与分支；不覆盖未知改动。
2. 阅读 `TASKS.md`，用 `python tools/agentctl.py next` 获取任务。Windows 本机若 `python` 指向 2.x，统一改用 `py -3`。
3. 先复现，再修改；新增行为必须有可验证的验收条件。
4. 执行：
   - `python tools/validate_site.py`
   - `python tools/build_site.py`
   - `node --check shared/home.js`（若 Node 可用）
   - `node --check shared/site-shell.js`（若 Node 可用）
   - Arcade 改动：`node --check apps/arcade/engine.js` + `node --check apps/arcade/sw.js` + `node tools/arcade_smoke.mjs`（需要本机 Chrome）
5. 检查 `git diff --check`、`git diff --stat`、完整 diff。
6. 任务完成后更新 `tasks/queue.json` 与 `TASKS.md`，记录证据和未解决项。
7. 提交前确认没有 `dist/`、`.wrangler/`、缓存、私密数据或无关文件。

## 4. Git 与发布授权

- 默认在任务分支工作；不得擅自向 `main` 推送、合并、打 Tag 或发布 GitHub Release。
- Agent 可以创建本地分支、提交本地 commit；远程 push / PR 操作必须有可用认证和明确目标仓库。
- StudioKit 正式发布是双目标：GitHub Pages 项目站点 + Cloudflare Pages 项目 `studiokit`。一次 `PUBLISH_TO_MAIN` 授权覆盖两端，不允许只发一端后声称发布完成。
- 首次 Pages 发布需要 Owner 确认：GitHub 仓库 URL、仓库可见性、Pages 已选择 GitHub Actions，以及是否授权部署到 `main`。Cloudflare 侧需要项目已存在、Production branch 为 `main`，并已配置 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` Secrets 与 `CF_PAGES_URL` Variable。
- 只有当前任务明确包含 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN` 时，才可将通过验证的提交推送/合并到 `main` 并触发双端部署。
- Owner 的一般性目标描述不等于允许 Agent 创建公开仓库、改变仓库可见性、修改组织权限或使用未授权凭证。
- Cloudflare Token 只能存 GitHub Secrets；不得写入仓库、日志、截图或提交说明。发布后必须检查 Actions 的 `Validate and build`、`Deploy GitHub Pages`、`Deploy Cloudflare Pages`、`Verify both deployments` 均为成功，并用 `tools/verify_deploy.py` 对两个最终 URL 做逐文件校验；失败时报告失败，不得重复盲目推送。

## 5. 新工具接入

- 优先运行 `python tools/new_tool.py --id <slug> --name "..." --description "..."`（Windows 用 `py -3`）。
- ID 使用小写 kebab-case，创建后不得随意改名（会改变 URL）。
- 将工具完整 HTML 放入 `apps/<id>/index.html`；共享 shell 只负责返回门户，不侵入工具业务 UI。
- 首页注册表状态按 `draft` → `available` 变化；未验收工具不得标为 `available`。
- 每个工具有自己的 README、CHANGELOG、版本和必要的测试说明。
- 详细规范见 `docs/ADD-A-TOOL.md`。

## 6. 完成定义（DoD）

- 任务验收条件逐项通过。
- 静态校验与构建成功。
- 受影响工具在桌面与窄屏布局检查通过。
- Arcade 改动通过 `arcade_smoke.mjs`（或明确记录为何无法运行）与 320/375/390/430px 布局检查。
- 发布任务通过 `tools/verify_deploy.py` 校验 GitHub Pages 与 Cloudflare Pages 内容和版本一致。
- 导入/导出、自动保存和配置兼容性无回归（适用时）。
- 文档、注册表、版本和任务状态同步。
- Diff 干净；提交信息清晰；没有未经授权的发布动作。
