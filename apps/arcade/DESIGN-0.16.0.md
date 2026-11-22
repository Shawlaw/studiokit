# Arcade 0.16.0 — First Flight（首航）设计与回滚

- 发布日期：未发布（本地分支 `feat/arcade-life-015`，等待 Owner 发布授权）
- 基线：0.15.0；关联：`docs/arcade-life/ADR-interfaces.md` §18（0.16 增补契约）、`INTEGRATION-0.16.md`
- 证据：仓库外 `qa/evidence/D16-*.md`、`G16-EVIDENCE.md`

## 1. 目标与边界

0.16 把“被动线索”推进到**显式玩家动作**，但只在玩家自己走到告示板之后发生：

1. 玩家从线索信（LOCAL）按地址进入旧港告示板，接一份委托，去对应游戏里用真实玩法完成，回执结算工钱。
2. 两条首航路线：接施工/护航委托（工作路线）、或免费租用码头旧机直接出击（不打工路线）；零信用点也能开始首巡航。
3. 第一次完整闭环：工钱 → 机库登记飞船 → 星海生涯出击 → 战利品与收据。
4. 经典、挑战、禅、星海割草、旧星币/旧机库/旧局内档（`studiokit:arcade:runs:v1`）继续零改动；职业委托不写旧档、不写旧机库、不写经典积分与最高分。
5. 仍无顶层“生涯模式”入口；中心页不新增 CTA；所有面板只从信件/告示板自然打开。

## 2. 新增运行时

| 文件 | 职责 |
|---|---|
| `career/commission-core.js` | 委托目录、ticket、事件缓冲、目标判定、奖励计划、结算/恢复/放弃 |
| `career/star-combat-config.js` | 机体参数提纯：经典只读旧机库 formula 1；生涯只读装备（formula 2） |
| `career/rental.js` | 免费租机凭证（sessionStorage，不落 DB、不改变拥有） |
| `career/alternatives.js` | 非战斗代办：明码标价、只扣费、只写 alternative/story 行 |
| `career/ui/town.js` | 港口告示板：委托列表、接单、机库/钱包入口 |
| `career/ui/hangar.js` | 飞船商店：价格/材料门槛、购买、切换、租用入口 |
| `career/ui/receipt.js` | 钱包、原收据、最近流水；结算后无遮罩收据卡 |
| `content/commissions.json` | 0.16 的 4 条 T1/T2（层塔施工、星海护航） |
| `content/items.json` | 4 艘飞船、4 个模块、2 种材料 |
| `content/chapter-01.json` | C0/C1 戏内信件：16 起源差异、3 条可达路径 |

bridge 变更：新增 commission 模式（`?career=<ticketId>` 激活）、观察事件路由、结算路由、`openTown/openHangar/openReceipt`、`getCommissionLoadout`；新增模块全部按需装载，普通游戏页（含 `#test`）零额外请求。

## 3. 委托生命周期

```
告示板接单（commission.start）
  → DB createRun(status=issued) + ticket（ticketId === runId）
  → sessionStorage ticket + 跳转 ../games/<gameId>.html?career=<ticketId>
  → bridge 激活：validateTicket → commissionRun + observe 进委托缓冲
  → 玩家真实游玩（经典事件流；职业 run 内 serialize()=null）
  → finish：目标判定 → 首次发 reward / 重复发 repeatSalaryCredits
  → DB settleAndClaim（claims 唯一 + 单事务）→ 收据/钱包/任务旗标
  → 清除 ticket/rental marker；同页再结算回到经典发现
```

- 失败（目标不足）：不发奖，run 标记 `failed`，返回可归因戏内文本；重开需重新接单。
- 刷新/暂停：同 ticket 可恢复；结算幂等（重复结算返回原收据/零增量）。
- 租机：只写会话 marker，bridge 激活时合入 `startParams.rentalShipId`；不改拥有/装备、不扣费。

## 4. 经济规则（内容可覆盖，`career-core.RULESET` 封顶）

- 初始生涯 80 信用点；T1/T2 首发奖励 70/110（施工）、90/130+objectiveBonus（护航）；重复有效局只发 repeatSalary。
- 飞船价格：旧翼 260、云雀 480（合金 1）、盾鲸 520（合金 2）、棱镜 540（合金 2+棱晶 1）。
- 购买：`purchase({cost, costItems})` 在同一事务内扣信用点+材料，任一不足整笔失败、零写入；`purchaseId` 幂等。
- 切换/租用：`writeEquipment`/会话 marker，零成本、不入账本。
- 代办：120 信用点（跑腿）或 90+合金 1（档案）；只写 `alternative/story` 行，不发钱、不给战斗旗标。

## 5. 游戏页改动（仅层塔、星海）

- 层塔：`?career=` 时开局弹层显示戏内目标；挑战入口隐藏；`serialize()` 与 autosave 四出口全部断开旧局内档（整页粘性锁定）；稳定层仍由真实物理提交点产生。
- 星海：`startParams.startLevel/themeId` 决定起始关/主题；职业 run `classicLike`（经典掉落/能量/机体配置），但跳过星币入账、旧机库读写、Progress/Scores/RunSave；Boss 事件带真实 level/theme；0.16 前置修复：`GameMeta.set` 读-合并-写、`serialize` 门禁、旧机库 formula 1 不变。
- 经典回归：无 `?career=` 时两页与 0.15 逐字节等价（除必要初始化分支）。

## 6. 数据与兼容

- 复用 0.15 的 IDB `studiokit:arcade:career` v1（11 stores），不新增 store、不改既有 Schema。
- 新增 DB 只读/装备 API：`getEquipment/writeEquipment/readLedger`（单事务、扁平装备键、`careerId/updatedAt` 不可写）。
- 无 localStorage 新增/改名；sessionStorage 仅 ticket/rental 两个带命名空间的会话键。
- 旧 `studiokit:arcade:runs:v1`、`progress/scores/playtime/challenge/meta` 在职业 run 全程逐字节不变（测试断言）。

## 7. 已知风险

- 职业 run 事件缓冲上限 400/局；超长局（0.17 深塔/长星区）需要分段或提高上限。
- 租机 marker 是会话级；刷新保留，关标签页丢失（符合“本次出击免费”）。
- `star-combat-config` 的 items 语义（lives/energy 绝对值，firepower/speed/magnet 为加成）与内容绑定；改 items 需同步测试守卫。
- `chapter-01.json` 为运行时内容；0.17 需要把 `C1.signal` 与 devkit 章节 token 映射一次。
- `tools/arcade_smoke.mjs` 的核弹用例曾因固定槽位在随机整备后偶发失败，已改为按实际槽位取核弹（本次修复，非产品回归）。

## 8. 回滚

1. 代码：`git revert` 0.16 批次或从 0.15 提交重拉；本版未推送远端。
2. 版本链：engine/sw/registry/index/validate 断言、7+ 测试脚本版本断言、`verify_deploy.py` career PATHS、SW CORE_PATHS 同步回退。
3. 数据：0.16 不改 Schema；已产生的生涯 IDB 可保留（0.15 忽略）或由设置/控制台清除；经典 7 个 localStorage 键与旧局内档不受影响。
4. 临时关闭：移除 16 页 bridge 标签可回到 0.14/0.15 经典；或设置面板关闭线索提示（职业入口不会出现）。
