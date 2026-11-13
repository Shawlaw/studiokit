# Arcade 0.9 挑战模式（13 游戏 × 6 关）独立评审（T057）

> **评审人**：独立 Reviewer Agent（不参与实现；不改 `apps/`/`tools/`/设计源/版本号；不做 git 写操作；不运行 `build_site.py`）
> **评审日期**：2026-11-13
> **分支**：`feat/arcade-0.8-gameplay`（本地；评审完成时 HEAD `fe79b0f`。0.9 提交链：`1b530e4` 设计包导入 → `0e9a156` 平台地基 → `c0e2315` 影跃迁移 → `456ed97` 其余 12 款 → `fe79b0f` 测试聚合器；评审末期测试工具/文档收口改动未提交）
> **评审对象**：0.9 设计包集成——13 个运行时数据文件、13 个游戏页挑战模式、`A.Challenge` 平台、13 个确定性场景模块、13 份实现记录、数据生成器与测试聚合器
> **评审类型**：设计源逐字段核对 + 冻结树全门禁复跑 + **原生 CDP 键鼠输入**独立实玩 + 源码审查；**不含**真机/真人试玩。
> **冻结快照**：评审开始与每批测试前后记录 sha256；全部测试期间 **202 个关键文件未变化**（`test-artifacts/reviewer-09-hashes-before.txt` 与结束快照逐字节一致）。

---

## 0. 结论

| 项目 | 结论 |
| --- | --- |
| 技术评审结论 | **APPROVE-WITH-NOTES** |
| Blocker | **0** |
| Major | **5**（全部为「设计意图 ↔ 实现/数据」偏差或需 Owner 批准的设计差量，**不是**功能阻塞：数据/记录/经典回归/构建门禁全部通过） |
| Minor | **6 项未解决 + 1 项已 resolved（m7 文档收口）** |
| UNVERIFIED | **10 类**（真机/真人/性能/部分关卡真实输入等，不得当作已确认） |
| 数据一致性 | **PASS**：13 游戏 × 6 关 = 78 关，设计源 ↔ 运行时 ↔ 测试夹具逐字段 deep-equal；78 个 stage id 唯一；运行时不含 `referencePlan`/`acceptance` 等剧透字段 |
| 全量门禁 | **PASS**：`arcade_gameplay_test --suite=all --repeat=2` **208/208**；`arcade_smoke.mjs` **85/85**；`validate_site.py`、`node --check`（44 处）、数据生成幂等、设计包校验 1088 断言、`git diff --check` 全 PASS |
| 证据等级 | **如实**：13 个模块的参考通关场景**均未使用** `forceStageClear`；`ui-only` 仅用于记录/UI/解锁断言；engine-replay 在 impl 文档如实标注（1 条 Minor 口径见 §6-m1） |
| **Owner 两轮试玩** | **未获得**；0.9 发布门槛**未通过**（Agent 不可代签）；未 push / 未合并 main / 未打 Tag / 未发布 |

**一句话**：0.9 的工程集成质量达到可进入 Owner 试玩的标准——数据、记录、存档兼容、经典回归、布局与全量门禁均通过独立复核；剩余风险集中在**需要 Owner 裁决的设计差量**（影跃捷径/时长、砖块 K/G、星海 Boss 弱点、重力窗口、全局目标时长）与**真机/真人验证**。

---

## 1. 冻结指纹（评审对象快照）

### 1.1 平台与测试工具

| 文件 | sha256 | 大小 |
| --- | --- | --- |
| `apps/arcade/engine.js` | `2E9B82024C9855E221B79F6D3922A95C5CCA9028B5406AB5219ED06C32D2A413` | 100902 B |
| `apps/arcade/sw.js` | `5386CC2779070527CF3B7262B82156165F4CC2014A7650259E0842469EA586D1` | 7463 B |
| `apps/arcade/arcade.css` | `EF3D677F4DE28233A89A92B08AC44CB7D0BD2C5C223A083888CFAB1CF3006BF6` | 48874 B |
| `tools/validate_site.py` | `B6CDF82D01B75281AF76182B00136264EEDE647E575B8CCCB6A9E5BAB46F20AD` | 15048 B |
| `tools/arcade_09_data.mjs` | `134EF5B73944AC8B1A944C8EA494A0DEEFC72473F66EF54B650A8FD1CA0D790C` | 26994 B |
| `tools/arcade_gameplay_test.mjs` | `F294215158EF869258907A198884533CBB553DCCB96E14C21725E1FD664AF95B` | 120198 B（最终 runner；早版 `6293C2F1…` 见 §1.3） |
| `tools/lib/arcade_cdp.mjs` | `1C3BB40A4AA8BE5645104670D5316595797336140F49A1F523EFDB632478D0E9` | 16521 B |
| `tools/arcade_smoke.mjs` | `E5A55B274AA995AFE2BEEBE2EE8C4D80C7021943E0CFF5559BE79947817479B1` | 139792 B |
| `docs/arcade/0.9/INTEGRATION-CONTRACT.md` | `6CC7299C74F8BA5A7C7A05E4AECF15DF693C2F514E4042F0184C766E87F8C482` | 11648 B |
| `docs/arcade/0.9/TESTING.md` | `09988CBD5813E026E7C4E22B37BF5C9D8F4871D881C23FF58A654ACD4F66FDF4` | 33915 B（最终版，§10 已回填） |
| `docs/arcade/0.9/DATA-INTEGRATION-REPORT.md` | `438F2535F48B29D876F8F6EEF62202780276A3AB9534F6104F0760C8805BF1BB` | 7957 B |

分组摘要（按文件名升序拼接后 sha256）：13 个运行时数据 = `7E95E3C15CDD43027974D0F780ECD467F8FD081360275AC13CCD0D0F8EFE26E1`；13 个场景模块 = `6CA1E1508E3DE1ACC2E55BC5D6CDCA33CBDEB5DB8984EC259ABA764F4DAFA1BF`；13 个测试夹具 = `FC6B757E0F2FBB43D3E8A959E4422B29BE5DF907DE8024BF1108946E30FBA420`；13 份设计源 `levels/*.json` = `C2DA97BE924E028DB0A9C76F623069DB38EE901B55AFE7C7613044382B60454F`；13 份 `impl/*.md` = `64CEC596EE73D50F3D650E3B31A2BE4F9867FEB11FC89D9330F0969C4E239421`。

### 1.2 逐游戏冻结指纹（游戏页 / 运行时数据 / 确定性场景模块）

| gameId | `apps/arcade/games/*.html` | `apps/arcade/challenge/*.js` | `tools/challenge/*.mjs` |
| --- | --- | --- | --- |
| shadow-leap | `391FA8F8225B043B54FBE287D0CC8B7D18D379D152AAAFB1D8E593E4BB13EC05` | `838FCA8DBD98497A7E46499DEC6828901EA68EA825838304D95779072F5B44F0` | `96D9F42522F9E5A440B0677FE74DC4946BA44EB638A45BC7580CF18BE0BA89A9` |
| snowbells | `1F93F3C584103BEED62D31B439EFD78FC66FAC190B1FC41C7B02DCF211630537` | `3BAA6529175830EB8E1FE733C0708D2B1CB9FD3420CC7D72CB38B29252DFE946` | `1C22D4FD0B68FE224BC4899ED2EBD2C1904DD3D1E6DFE28AE68325A272440F65` |
| star-raid | `699C8FF733984A9E7EDD78CA302EC67588E5ECF9604E1581866E59D296C4F5AD` | `CB44D2F7D35D60E3A1F96A3A8A03361B8155F65E8DA292FE7983A49A387AF384` | `98FD7D689BF9BB767D210C192BE7196979971F0AEE1D3C5B1FB3E01C2149FE04` |
| pendulum-tower | `C3ACD9E618BA756DFF65CC08D8455CA1B79FA3115F334E6F36F2CEA5DAEA6CC3` | `1280A30A51FCFD6630E59DF3638694E12B2AD83D00D9B549D48C3E648994AA8C` | `7A4B719FA8892102DAC50CD3E37BD5B0A47454D6967ACBFA6695C5F98B2DC64B` |
| block-drop | `1D1E251A052EA14588C1930DF4CEC310E2C6515BEB60AF8B2DD9E6A4395BA9AC` | `AE9E10169E6A4F45509A0EA28FFB5C14C8B5825FB749168F2713632A7CDF1390` | `2DAEA1C398F78D897B4DABD3F5C29B22B947F033EFDE4719231DF215A1C480C4` |
| road-rush | `19D220E06558C4E9EDCB56711CE85E9E66791FDF699188914003AB45CC24623C` | `104594DC30118D3BDA56E4714C07D31383E9D9534E56EAE3CEAD13B0BBF2A401` | `3BC9A13D15F3E8E21B179CCDA1F5D7B6374D84D1DC84A596C48170BEE6302005` |
| gold-miner | `5858E6FDA3F2EAD121534140152328C8C696AFC37B39EBD9CC53B42A6969AADD` | `439781A8F0995418F0C95E8E0077FC9A148BF32E8FC5633385E649BAF0DC0F46` | `DF3DA98D2EBB4DE5E1E4F4A4644B025FA264AECF270263879C281F763210DD4D` |
| brick-breaker | `6BD9C45E4E824821FEE90C80D0508136619E9A81BADD133A51287080FD82227A` | `844CEF11CC5E82A3E7F5943E5A13B286B3724AEA13027371E1679433F2B5A635` | `BAFC0A6854106AAD5805D974A419006FF2FD3D368069AE0A9A866782C52B91CD` |
| gravity-flip | `D09F27C3EA23C858A830B427A747ABC1D3B787E152DA7E924144D8CEECD48B45` | `A45223CA8DE1EF67900345E4D633B4D94C27203CE88FBDE95029BA0A9A35EA40` | `26FBEAF47DA26248E2F61530654EF5F49113485A59159963B261CC6D528E922F` |
| snake-run | `2B46F258BE761BC65419704CE4D70DBAEFCF82AD62494A54DB2E1FA6BB2C50B2` | `3450976F88D0D6055AB641E297339D89F85B402CB68CA98BDC2B1E7EAD051E83` | `787C2393BC11CBEF71EC3D860BCFC3B1E777CD7A9828AAFD93B96429C536CAD1` |
| mole-whack | `BDD378AA13DC858EB8B28D5EC43572ED0589C9B05D6A65B56DB31C2F996ACBF8` | `4E26E0AA53A35C3416BCE909CD1AADD9194738A96F79DD252E38F5972A8E22D9` | `D8192129F460BD1A157266173DE4630FBC53A7778629F27ECF23E55611F88073` |
| memory-flip | `92B36A0973960CD5290A6BB585E68EC6D982BD7D9245B97798024E405F0C6B92` | `7ED1C588618063458632F6BEE6423EA84B6840A6747850B7783D1335211BBA4B` | `9DF43129F08EED37F64D326FEB249DC5810C9AA49CA57CDD034361BDAF7EEAAF` |
| merge-2048 | `D23EA5EFBABC669BD9DEC5D1B92AC31A6B30678AF08BF4E05C592614CFF7A297` | `6F3D2FDAA6196E5873B986DD078A9139E3ADCE767321F9FD0887D7DF1250B6DE` | `AFA6F529926C775DE22ED2E0E3E706C7C3B96FD92B27B419B194BBFD2BF3C90B` |

### 1.3 评审期间的树变化（透明记录）

| 时间 | 事件 | 影响 |
| --- | --- | --- |
| 评审开始（11:50 快照） | HEAD `6a7b246` + 未提交 0.9 工作树 | Reviewer 在此之前完成冻结快照 |
| 评审期间 | Lead 提交 0.9（`1b530e4`…`fe79b0f`，共 5 个提交） | 文件内容与快照一致（Reviewer 逐文件对比：202 个关键文件在全部测试期间未变化） |
| 12:09:17 | `tools/arcade_gameplay_test.mjs` 由 `6293C2F1…` 收口为 `F2942151…`（SC-SL-009/SC-SL-002 的 rAF 轮询加固 + 208/208 记录） | **被测产品代码未变**；聚合器门禁已用最终版复跑：**208/208，798.4s，exit 0**（见 §2.2） |
| 12:10–12:24 | `docs/arcade/0.9/TESTING.md` 更新并回填 §10 证据等级汇总表（最终 `09988CBD…`，33915 B） | 仅测试文档；m7 收口项已 resolved |

结论：`apps/arcade/**`（含 13 游戏页、13 运行时数据）、`tools/challenge/**`、`tools/lib/**`、设计源与夹具在 Reviewer 全部数据审计/实玩/API/布局测试期间**哈希未变**，因此这些结论对最终树有效；聚合器 208/208 已在最终 runner 上复跑（§2.2）。

### 1.4 构建产物（Lead 执行 `build_site.py`，Reviewer 只读比对）

- `dist/apps/arcade/games/*.html`、`dist/apps/arcade/challenge/*.js`（13 个）、`dist/apps/arcade/engine.js` 与源码 sha256 一致（抽样 shadow-leap / block-drop challenge / engine 全部匹配；`dist/` 不含 `tools/`、`docs/`）。
- 版本策略：`ARCADE_VERSION = 0.7.0`、`sw.js VERSION = 0.7.0`、注册表 `arcade.version = 0.7.0`，均未升版（0.8/0.9 均未发布）。

---

## 2. 评审方法与独立证据

### 2.1 Reviewer 自写独立验证（`test-artifacts/`，已 gitignored，不入库）

| 脚本 | 内容 | 结果 |
| --- | --- | --- |
| `reviewer-09-data-audit.mjs` | 13 游戏 × 6 关：设计源 ↔ `apps/arcade/challenge/<game>.js` ↔ `tools/testdata/challenge/<game>.json` 逐字段 deep-equal（id/stageNumber/title/difficulty/goalStatement/decision/practicedSkill/discovery/targetDurationSec/content/requiredFeatures）；运行时不得泄漏 `referencePlan/acceptance/integration/designerNotes`；78 个 stage id 唯一 | **PASS**（91 项断言 + 78 id 唯一） |
| `reviewer-09-play.mjs` | **原生 CDP 输入**（`Input.dispatchKeyEvent` / `dispatchMouseEvent`）：影跃 C01–C03 真实键盘通关、2048 C01–C03 真实方向键通关（盘面与设计 `resultBoard` 逐格一致）、贪吃蛇 C01–C02 真实方向键通关、打地鼠 C01 真实指针实时点击通关；暂停→刷新→续玩；旧 0.8 `mode:'trial'` 存档升级；导出/导入；13 游戏 320/390 选关布局；网络/异常 | **47/47 PASS，exit 0，70.3s** |
| `reviewer-09-api-probe.mjs` | `A.Challenge` 记录/解锁/最佳/assisted 规则、损坏存储 fail closed 不删原值、导入非法 fail closed、不写 `progress:v1`、`resetGame` | **13/13 PASS，exit 0** |

> Reviewer 的“可玩”证据只用**真实浏览器输入 + 真实引擎**；`forceStageClear/forceStageFail` 仅用于记录/UI 断言（本报告明确标注）。开发者模块的 `real-input-replay` 使用页面内 `dispatchEvent` 合成事件（见 §6-m1），Reviewer 的 4 款实玩用原生输入复验通过。

### 2.2 全门禁复跑（冻结树；每批前后记 sha256）

| 命令 | 结果 | 耗时 | exit |
| --- | --- | --- | --- |
| `py -3 tools/validate_site.py` | PASS | 0.37s | 0 |
| `node --check`：`engine.js`、`sw.js`、`tools/arcade_09_data.mjs`、`tools/arcade_gameplay_test.mjs`、`tools/lib/arcade_cdp.mjs`、13 个 challenge 数据、13 个场景模块、13 页内联脚本抽取（共 44 处；`arcade_smoke.mjs` 自 0.8 冻结后未改，smoke 85/85 已覆盖） | 全部通过 | <10s | 0 |
| `py -3 docs/arcade/0.9/scripts/validate_levels.py`（cwd=`docs/arcade/0.9`） | PASS，1088 断言（design-contract 234 / exact-simulation 454 / geometry 220 / inventory 117 / ray-clearance 51 / timeline 12） | ~1s | 0 |
| `node tools/arcade_09_data.mjs` | PASS：13 游戏/78 关，自检 2128 断言 + 设计包校验 1088；生成 13 运行时数据 + 14 夹具；**重复运行字节一致** | 0.3s | 0 |
| Reviewer 独立数据审计（§2.1） | PASS | <1s | 0 |
| `ARCADE_GAMEPLAY_PORT=8820 ARCADE_GAMEPLAY_CDP_PORT=9420 node tools/arcade_gameplay_test.mjs --suite=all --repeat=2`（**最终 runner `F2942151…`**） | **208/208 scenario runs passed**（104 场景 ×2；13/13 模块被自动发现；`CH-DATA-001` games=13/stages=78/designChecks=2256/runtimeChecks=1281；`CH-CLASSIC-001` 13/13 经典启动、无挑战入口占用主按钮） | **798.4s** | 0 |
| 同上（早版 runner `6293C2F1…`，收口前） | 208/208（同一套产品代码；两版结果一致） | 802.3s | 0 |
| `ARCADE_SMOKE_PORT=8815 ARCADE_CDP_PORT=9415 node tools/arcade_smoke.mjs` | **85/85 checks passed** | 232.6s | 0 |
| Reviewer 独立实玩（§2.1） | **47/47 PASS** | 70.3s | 0 |
| Reviewer `A.Challenge` API 探针 | **13/13 PASS** | ~10s | 0 |
| `git diff --check` | 干净 | — | 0 |
| `py -3 tools/build_site.py` | **由 Lead 执行**（Reviewer 按边界不运行）；Reviewer 只读比对 `dist/` 与源码哈希一致 | — | — |

端口全部用 env 覆盖（8815/9415、8816/9416、8817/9417、8818/9418、8819/9419），未与 challenge-test-infra 的 8796/9396 冲突。

---

## 3. 逐游戏核对（13/13）

图例：数据 = 设计源 ↔ 运行时 ↔ 夹具（Reviewer 独立审计 PASS）；「参考通关」= 模块中“参考通关/回放”场景声明的证据等级（`real-input-replay` / `engine-replay`）；「Reviewer 实玩」= 原生 CDP 输入独立复核。

| 游戏 | 数据 | 参考通关证据（模块声明） | 6 关覆盖 | 经典回归 | 记录/解锁/assisted/收集 | Reviewer 独立实玩 | 结论 / UNVERIFIED |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 影跃 | ✅ | CH-SL-002 C01 `real-input-replay`；CH-SL-006 C03 影冲必要性（无影冲不可达/有影冲可过）；CH-SL-008 **C01–C06 连续** `real-input-replay`（2.5/2.9/1.9/2.9/2.9/4.5s） | 6/6 | ✅ smoke + CH-SL-005 | ✅ CH-SL-001/002/007；旧 trial 档升级 C02（Reviewer 复核） | **✅ 原生键盘 C01–C03**（2.47/3.28/1.85s；C03 dash=1）；暂停刷新恢复 | C04–C06 仅模块 DOM 输入，原生输入未复核 → UNVERIFIED；真机 |
| 俄罗斯方块 | ✅ | CH-BD-002 C01 `real-input-replay`；CH-BD-003 **C01–C06** `real-input-replay`（清行 1/2/4/2/2/4 与设计一致） | 6/6 | ✅ CH-BD-006 | ✅ CH-BD-008 assisted=true | 未逐一实玩（模块全量 16/16） | 证据等级如实；真人难度 UNVERIFIED |
| 2048 | ✅ | CH-MG-002 C01 `real-input-replay`；CH-MG-003 **C01–C06** `real-input-replay`（逐关盘面=设计 resultBoard） | 6/6 | ✅ CH-MG-007 | ✅ CH-MG-006 撤销→assisted | **✅ 原生方向键 C01–C03 通关，盘面逐格一致** | 其余关卡模块覆盖 |
| 记忆翻牌 | ✅ | CH-MF-002 C01 `real-input-replay`（配对表真实点击） | C01 real；C02–C06 未逐关回放 | ✅ CH-MF-006 | ✅ CH-MF-005 assisted | 未实玩 | C02–C06 真人可完成性 UNVERIFIED |
| 贪吃蛇 | ✅ | CH-SN-002 C01 `real-input-replay`（movesRLE 14 步） | C01 real；C02–C06 未逐关回放 | ✅ CH-SN-006 | ✅ CH-SN-004 assisted | **✅ 原生方向键 C01（3.2s/14 步）、C02（6.7s/29 步）通关** | C03–C06 UNVERIFIED |
| 打地鼠 | ✅ | CH-MW-002 C01 `real-input-replay`（实时点击 8/8）；CH-MW-008 C01–C06 `engine-replay`（时钟辅助真实指针，57 命中，已如实标注） | 6/6（C02–C06 时钟辅助） | ✅ CH-MW-005 | ✅ CH-MW-006 | **✅ 原生鼠标实时点击 C01 通关**（30s，8/8，0 误击） | C02–C06 人类节奏 UNVERIFIED；双指真机 UNVERIFIED |
| 极速车道 | ✅ | CH-RR-002 C01 `real-input-replay`（7 次变道）；CH-RR-007 **C01–C06** `real-input-replay`（38 次变道，距离 540–1240m） | 6/6 | ✅ CH-RR-005 | ✅ CH-RR-006 assisted | 未实玩 | 车流视觉一致性需试玩 |
| 重力翻转 | ✅ | CH-GF-002 C01 `real-input-replay`（3 次翻转/0 碰撞）；CH-GF-007 C02–C06 `engine-replay`（8.0–9.3s，0 碰撞） | 6/6 | ✅ CH-GF-006 | ✅ CH-GF-005 assisted | 未实玩 | **推荐窗口晚半段不安全（见 §5-M5）** |
| 砖块计划 | ✅ | CH-BB-002 C01 `engine-replay`（含真实指针发球 sanity）；CH-BB-007 **C01–C06** `engine-replay` 清场（53.3–101s，0 丢命，3 次空转恢复） | 6/6（engine-replay） | ✅ CH-BB-006 | ✅ CH-BB-005 assisted | 未实玩（无法以简单脚本复现真实弹道） | **K/G 最小修正需 Owner 批准（见 §5-M3）**；真人可完成性 UNVERIFIED |
| 雪铃 | ✅ | CH-SB-002 C01 `real-input-replay`（4 铃 2.7s） | C01 real；C02–C06 未逐关回放 | ✅ CH-SB-006 | ✅ CH-SB-005 assisted | 未实玩 | C02–C06 UNVERIFIED |
| 层塔 | ✅ | CH-PT-002 C01 `engine-replay`（4 层/金牌/5s，真实摆动物理+对齐释放钩子） | C01 engine；C02–C06 未逐关回放 | ✅ CH-PT-006 | ✅ CH-PT-005 assisted | 未实玩 | C02–C06 真实释放序列 UNVERIFIED |
| 星海突击 | ✅ | CH-SR-002 C01、CH-SR-007 C02–C04、CH-SR-003 C05/C06 全部 `engine-replay`（35/42/46/48/56.3/69.6s，0 伤害，安全走廊可观测） | 6/6（engine-replay） | ✅ CH-SR-006 | ✅ CH-SR-004/005 | 未实玩 | **Boss 几何弱点改时间窗需 Owner 决策（见 §5-M4）**；真人读招 UNVERIFIED |
| 黄金矿工 | ✅ | CH-GM-002 C01、CH-GM-007 C02–C06 全部 `engine-replay`（参考抓取金额 650/750/950/1200/1100/1550，剩余 46–56s） | 6/6（engine-replay） | ✅ CH-GM-006 | ✅ CH-GM-002 assisted 管线 | 未实玩 | 真人摆钩时机 UNVERIFIED；挑战禁用道具口径（Minor） |

**证据等级核查结论**：
1. **无证据等级虚报**：13 个模块中所有“参考通关/回放”场景的运行体均**未调用** `forceStageClear`（逐模块代码扫描），`forceStageClear(true/false)` 只出现在记录/UI/解锁类场景；`ui-only` 场景标题均标明用途，未作为通关证据。
2. **如实降级**：砖块计划/星海突击/黄金矿工/层塔（C02–C06）明确标为 `engine-replay` 并写明与真人输入的差距；打地鼠 C02–C06 明确标“时钟辅助真实指针”；贪吃蛇/雪铃/记忆翻牌只把 C01 标 `real-input-replay`，未把其余关说成真实输入。
3. **口径差量（Minor-m1）**：所有 `real-input-replay` 实际使用页面内 `dispatchEvent(new KeyboardEvent/PointerEvent)`（`tools/lib/arcade_cdp.mjs` 的 `CDP.key/pointer/tap`），而不是浏览器原生输入管线；Reviewer 用原生 `Input.dispatch*` 独立复核 4 款游戏通过。

---

## 4. 设计差异裁定（13 游戏）

> 裁定类别：**可接受**（实现细节，不影响设计意图）/ **需 Owner 决策**（设计意图与实现取舍，需人决定）/ **需回改设计**（设计数据缺陷）/ **Blocker**（不修不可接受）。设计源 `docs/arcade/0.9/levels/**` 未被修改（Reviewer 已核对哈希与数据审计）。

| # | 游戏 | 差异（原设计 → 实现/实测） | 裁定 | 依据/建议 |
| --- | --- | --- | --- | --- |
| 1 | 影跃 | 影门 `radius=38` 导致可从比设计末台低 1–3 层触门（C01 从 p3 即清关、C02/C04 提前一层） | **需 Owner 决策** | impl §8.3；Reviewer 实测 C01 2.47s 通关、dash=0、landings=4。<br>建议：接受“捷径=技巧”或把半径降到 ~20/抬高影门/加长主路线（三选一，均需改设计） |
| 2 | 影跃 | `targetDurationSec=[45,155]`，真实参考通关 1.9–4.5s（0.9 每关 6–10 块平台、自动起跳） | **需 Owner 决策** | impl §8.4；Reviewer 实测 C01–C03 2.47/3.28/1.85s。建议与 #12 一并处理 |
| 3 | 影跃 | `requiredAbility:'dash'`（C03–C06）未做硬门禁，C04–C06 可 0 影冲完成 | **可接受**（建议 Owner 明确是否加强） | impl §8.6；设计无“不用影冲即失败”的胜负条件，加门禁会改变语义 |
| 4 | 影跃 | 失败检查点=最近着陆平台（设计只写“最近房间检查点”） | **可接受** | impl §8.8；数据无检查点字段，按最近平台实现 |
| 5 | 影跃 | C06 双路线判定退化为「自由路线/混合」（两条路线独占平台为空） | **可接受** | impl §8.9；不虚构路线标签 |
| 6 | 俄罗斯方块 | 无倒计时/队列耗尽或 `maxPlacedPieces` 用尽判失败/朝向名映射到经典旋转系统 | **可接受** | impl §4 D1–D5；保持经典规则唯一来源 |
| 7 | 2048 | 挑战禁随机新块；撤销不退还步数并记 `assisted`；`targetDurationSec` 仅展示 | **可接受**（撤销语义请 Owner 确认） | impl §4 D1–D6；设计未给出字段级撤销规则 |
| 8 | 记忆翻牌 | `layoutTransforms` 三种变换已实现但挑战固定 `identity`（重玩镜像变体未启用） | **可接受**（设计意图部分未落地） | impl §4；镜像需同步线索与夹具，建议放入后续迭代 |
| 9 | 贪吃蛇 | 固定步间隔（不随吃果加速）/1 命/无金果实随机障碍/道具可用记 assisted | **可接受** | impl §4；固定间隔是参考路线可复现前提 |
| 10 | 打地鼠 | 挑战禁用「金鼠三连/安心锤」；炸弹/假目标 `score:0` 回落到 scoring；整关结束统一判定；页内第二指针路径支持双指 | **可接受**（道具口径见 Minor-m3） | impl §4；固定时间轴需要可复现评分；共享输入层未改 |
| 11 | 极速车道 | 碰撞判定固定在 `passAt` 且包含 0.22s 变道过渡；车流仅视觉；挑战禁用道具；分数不写入记录 | **可接受**（视觉一致性需试玩） | impl §4/§6；视觉提前量约一个车身，需 Owner 确认可读性 |
| 12 | 重力翻转 | `distanceToFinish` 2200–2530px / 260px/s → 8–9.3s，与 `targetDurationSec=45–115` 不一致；碰撞后不回退继续滚动 | **需 Owner 决策（时长口径）** | impl §4-1；其余为可接受实现细节（生命容错/不回退） |
| 13 | 重力翻转 | `recommendedFlipWindows` 容差 ±70px 的**晚半段**（xCenter+50..70）在 C01/C02/C04 会来不及完成竖向转移而碰撞 | **需回改设计** | impl §4-2（离线物理扫描 + engine-replay 佐证）。建议 xCenter 前移或改为“早 70 / 晚 10”，或 UI 只显示安全半段 |
| 14 | 砖块计划 | K 钥匙砖在“G 硬墙”字面语义下不可达（C03 剩 13 砖、C06 剩 5 砖）；实现改为“撞未解锁 G 时伤正上方 K” | **需 Owner 决策**（若不批准该修正，则 C03/C06 不可解 = Blocker） | impl §4.1；修正后 CH-BB-007 六关 engine-replay 可清场（C03 101s/C06 81.3s） |
| 15 | 雪铃 | 世界原点 y=620、下一目标常驻提示、落空=失败（设计写可恢复）、彩铃只记收集 | **可接受**（失败语义请 Owner 确认） | impl §4；常驻提示更适配 AFK；挑战需要可归因失败与 1 次重试 |
| 16 | 层塔 | 确定性初始角速度 2.05×speedFactor（设计只给起始角 0）；无自动吸附；倾斜上限用 maxTowerLeanAbs；结算等倾斜稳定 | **可接受** | impl §4；静止钟摆无法完成 ±8/±12px 目标偏置，初速是必要的确定性工程决策 |
| 17 | 星海突击 | Boss 几何左右弱点 → 安全走廊正上方悬停 + **时间窗暴露**（C05 2s/1s/2s；C06 1.4s/2.2s）；弹道以走廊外危险列等效；Boss HP 自定 | **需 Owner 决策** | impl §5-1/2；几何弱点与固定安全走廊互斥，时间窗是保留“露弱点再进攻”决策的最小修正 |
| 18 | 黄金矿工 | 挑战禁用 4 道具（含瞄准线）；TNT 不连锁；固定摆角/摆速；达标需点「结算通关」 | **可接受**（道具口径见 Minor-m3） | impl §5；TNT 连锁会使固定矿图不可完成 |
| 19 | 全部 13 款 | `targetDurationSec` 与引擎实测时长普遍偏差：影跃 1.9–4.5s、2048 0.3s 级、方块 1–2s、贪吃蛇 3.2s、雪铃 2.7s、记忆 2.4s、重力 8–9.3s、赛车 13.8s；星海 35–70s、砖块 53–101s、打地鼠 30–38s、层塔 5s+ 较接近 | **需 Owner 决策** | 数据/模块证据汇总；建议统一“目标时长=真人首次体验参考”口径，或补内容使参考解接近 45–155s |
| 20 | 多款 | 挑战内 0.7 道具：打地鼠/黄金矿工/极速车道/重力翻转禁用；2048/方块/贪吃蛇/记忆/影跃可用并记 `assisted` | **可接受但口径不统一**（Minor-m3） | 建议统一并写进挑战 HUD/说明 |
| 21 | 全部 | 挑战记录 Schema 只有 `timeSec/assisted/collectibles`；矿工金额/赛车分/打地鼠分/层塔评价不持久化 | **可接受** | 契约 §3 只定义这三类；若 Owner 要跨局比分需平台加字段（ADR） |

**Blocker 0**；**需 Owner 决策 5 项（#1、#2、#12、#14、#17）**、**需回改设计 1 项（#13）**、其余为可接受实现细节。

---

## 5. Blocker / Major / Minor

### Blocker

**0**

> 条件性提示：若 Owner **拒绝** §4-#14 的“撞 G 伤 K”最小修正，则砖块计划 C03/C06 在字面设计语义下不可解，将升级为 Blocker；当前实现下六关 engine-replay 全部可清场。

### Major（均为设计/产品决策项，不是工程阻塞；已在 impl 文档登记，需 Owner 裁决）

| ID | 问题 | 证据 | 建议 |
| --- | --- | --- | --- |
| **M1** | **影跃影门半径导致捷径**：C01 可从 p3 触门（设计末台 p5）、C02/C04 提前一层；实测通关 1.9–4.5s（设计目标 45–155s） | `docs/arcade/0.9/impl/shadow-leap.md` §8.3/§8.4；`docs/arcade/0.9/levels/shadow-leap.json` C01 `goal.radius=38`；Reviewer 原生输入 C01 2.47s/dash=0 | Owner 决定：接受捷径（作为技巧）或回改设计（半径 ~20 / 抬高影门 / 加长主路线），改后需重跑数据生成与全量场景 |
| **M2** | **关键过关时长与设计目标普遍不符**（影跃、2048、方块、贪吃蛇、雪铃、记忆、重力、极速车道等；见 §4-#19） | 各 impl 文档 + 全量场景证据；Reviewer 实测 4 款 | Owner 决定：把 `targetDurationSec` 改为“真人首次体验”参考值，或补内容/加长路线；不阻塞当前技术验收 |
| **M3** | **砖块 K/G “撞门震钥匙”最小修正**（球撞未解锁 G 时伤害正上方 K）改变字面机制语义；不修正则 C03/C06 不可解 | `docs/arcade/0.9/impl/brick-breaker.md` §4.1；CH-BB-007 六关 engine-replay（C03 101s/C06 81.3s，0 丢命） | Owner 批准该交互，或回改设计（把 K 移到可直击位置/门上方留缺口）；修改设计后必须重跑生成器 + 全量场景 |
| **M4** | **星海 Boss 弱点从“几何左右侧翼”改为“时间窗暴露”**（Boss 悬停走廊上方，weakSide 只在窗口可伤害） | `docs/arcade/0.9/impl/star-raid.md` §5-1；CH-SR-003（C05 暴露 14.1s/C06 17.3s） | Owner 决定接受时间窗语义，或回改设计（允许离开走廊接近侧翼并给安全区）；需试玩确认可读性 |
| **M5** | **重力翻转推荐翻转窗口晚半段不安全**：`tolerancePx=±70` 的 xCenter+50..70 在 C01/C02/C04 会碰撞（设计可见窗口与安全窗口不一致，存在“按提示操作仍被撞”的公平性风险） | `docs/arcade/0.9/impl/gravity-flip.md` §4-2；实现/机器人只用窗口早沿 | 建议回改设计（xCenter 前移或容差“早 70/晚 10”）或 UI 只画安全早半段；否则 Owner 试玩需重点确认 |

### Minor

| ID | 问题 | 证据 | 建议 |
| --- | --- | --- | --- |
| m1 | **`real-input-replay` 的证据口径**：测试库 `CDP.key/pointer/tap` 用页面内 `dispatchEvent(new KeyboardEvent/PointerEvent)`，不是浏览器原生输入管线（`Input.dispatch*`）；impl 文档未注明 | `tools/lib/arcade_cdp.mjs:339-371`；13 个模块全部依赖该 helper | 建议测试库改用原生 `Input.dispatchKeyEvent/MouseEvent`，或在 TESTING/impl 文档把该等级注为“DOM-event replay（经真实引擎输入层）”；Reviewer 已用原生输入独立复验 4 款游戏 |
| m2 | **SW 缓存版本仍为 0.7.0**：13 个 challenge 数据已加入 shell 预缓存，但 `CACHE_NAME` 仍是 `0.7.0-v1`；发布后老 Service Worker 用户可能拿不到 0.9 新数据 | `apps/arcade/sw.js:10`；`docs/arcade/0.9/DATA-INTEGRATION-REPORT.md` §6 已登记 | **发布前必须升 `VERSION`（及 `ARCADE_VERSION`/注册表）**；当前未发布，不阻塞本地验收 |
| m3 | **挑战道具口径不统一**：打地鼠/黄金矿工/极速车道/重力翻转禁用 0.7 道具；2048/方块/贪吃蛇/记忆/影跃可用并记 assisted | 各 impl §4；`A.Challenge.markCleared` assisted 管线已通过探针 | 统一“挑战是否允许道具”并在选关/关卡 HUD 说明；若允许需补 assisted 视觉提示 |
| m4 | **部分游戏 C02–C06 未逐关真实回放**：贪吃蛇/雪铃/层塔/记忆翻牌仅 C01 real-input（其余靠同源数据/同代码 + 全局数据门禁）；打地鼠 C02–C06 为时钟辅助 | `tools/challenge/<game>.mjs` 场景表；各 impl UNVERIFIED 段 | 已如实登记，不阻塞；Owner 试玩应优先覆盖这些关；后续可补逐关回放 |
| m5 | **挑战分数类结果不持久化**：矿工金额、赛车分、打地鼠分、层塔评价只在本局 UI/observable，`challenge:v1` 仅时间/辅助/收集物 | `A.Challenge` Schema；mole/road impl §4 | 若 Owner 期望“第二局超越分数”，需平台 Schema 新增字段（ADR + 迁移测试） |
| m6 | **0.8 `mode:'trial'` 旧档只映射到 C01–C03 的关起点**（S2→C02），不保留玩家位置/计时；有提示、不静默删档 | Reviewer 实测 B3/B4/B5 + `CH-SL-004` | 属安全降级；发布说明需告知“旧试炼进度升级后从本关起点开始” |
| ~~m7~~ | ~~文档收口未完成：TESTING §10 待填~~ | 已于 12:24 由 test-infra 回填（`09988CBD…`，33915 B，`待填` 计数 0） | **已 resolved**（不计入未解决 Minor；impl 文档的 Reviewer 结论占位由本 REVIEW 覆盖） |

---

## 6. 兼容 / 隐私 / 依赖 / 版本

| 项 | 结论 | 证据 |
| --- | --- | --- |
| 经典模式零回归 | **PASS** | smoke **85/85**；全量场景 `CH-CLASSIC-001` 13/13（主按钮仍「开始游戏」、挑战入口不占主按钮）；Reviewer 13 游戏布局循环逐一确认主按钮文案 |
| 旧 0.8 trial 存档降级 | **PASS** | Reviewer 实测：构造 `mode:'trial', stageIndex=1` 档 → 显示「试炼数据已升级」→ 继续映射为 `shadow-leap-C02`；`challenge:v1` 前后不变（不静默删档）；`CH-SL-004` 同向验证 |
| 旧经典档兼容 | **PASS** | smoke 13 游戏旧档/续玩；`CH-CLASSIC-001`；`SC-SL-006` 旧经典档仍 classic |
| 新增 localStorage key | 仅 `studiokit:arcade:challenge:v1` | Reviewer 实测 A9；`engine.js` `CHALLENGE_KEY`；全库无其它新 key |
| challenge:v1 Schema/导出导入 | **PASS** | Reviewer API 探针 13/13：key/schema、C01 解锁链、best 只保留更快成绩（较慢 assisted 不覆盖、同时间无辅助优先）、损坏数据 fail closed 且不删除原值、非法导入 fail closed、`resetGame`；Reviewer 实测 `Progress.exportText` 含 challenge、旧备份（无 challenge）导入保留当前记录、新备份往返一致 |
| 挑战不写经典最高分/Playtime 轮次 | **PASS** | API 探针：只写 challenge key；`progress:v1` 保持 null；`Progress.recordPlay` 仍只在经典结算调用 |
| 暂停/刷新/恢复 | **PASS（无头级）** | Reviewer 影跃 C02 暂停→刷新→继续（同关/同模式/计时接近）；全量场景各游戏均有 pause/refresh 断言；≥5 分钟真机 AFK = UNVERIFIED |
| 320/390 布局 | **PASS（无头模拟）** | Reviewer 对 13 游戏挑战选关：320/390 `scrollWidth == innerWidth`、6 个关卡按钮、按钮最小 131–166×53px（≥44）；真机 UNVERIFIED |
| 无新依赖/无外部请求 | **PASS** | 无 `package.json`/`node_modules`；Reviewer 实玩期间 Network 请求全部同源（0 外部 URL）；challenge 数据用 `<script>` 同步加载，无 fetch |
| 无新构建步骤 | **PASS** | `tools/build_site.py` allowlist 未改；`dist/` 只读比对含 13 个 challenge 数据且哈希一致；`tools/`、`docs/` 不入发布 |
| 版本号 | **未升** | `ARCADE_VERSION=0.7.0`、`sw VERSION=0.7.0`、注册表 0.7.0（0.8/0.9 均未发布） |
| 设计源零修改 | **PASS** | 设计包 `0.9/levels/**`、`docs/**`、`scripts/**` 未被实现改动；`validate_levels.py` PASS 1088 断言；Reviewer 数据审计与生成幂等一致 |
| 仓库卫生 | **PASS** | 26 条变更均为预期文件（13 游戏、engine/css/sw/validate、tools 新增、docs/arcade/0.9）；`git diff --check` 干净；`test-artifacts/` gitignored |

---

## 7. UNVERIFIED（明确未验证，不得当作已确认）

1. **真机 iOS / Android**：13 游戏挑战模式的触摸命中/拖动/双手操作、pointercancel、刘海与底部手势栏遮挡、系统手势冲突（无头 Chrome 仅 320/390 视口模拟）。
2. **真机性能**：目标 60fps（低端机允许 30fps）；弹幕/车流/物理/砖块长时间帧率未测。
3. **真人首次体验时长与难度曲线**：自动化参考解 0.3–101s 区间差异大；`targetDurationSec` 与本报告 §4-#19 的偏差需真人验证后定稿。
4. **仅 engine-replay 证据的关卡真实可玩性**：星海突击全部 6 关、黄金矿工全部 6 关、砖块计划全部 6 关、层塔 C02–C06、贪吃蛇/雪铃/记忆 C02–C06、打地鼠 C02–C06（时钟辅助）；Reviewer 只对影跃 C01–C03、2048 C01–C03、贪吃蛇 C01–C02、打地鼠 C01 做了原生输入复核。
5. **影跃 C04–C06 原生输入**：模块用页面 DOM 事件回放通过；Reviewer 原生输入只到 C03。
6. **≥5 分钟挂机/锁屏恢复**：已测 700ms–1.3s 级暂停/失焦；真机后台回收、长时间 AFK 未测。
7. **断网/PWA 升级路径**：challenge 数据已进 shell 预缓存，但 SW 版本未升；老用户升级后能否取到新数据未验证（见 Minor-m2）。
8. **Owner 两轮试玩结论**：未获得；见 `docs/arcade/0.9/PLAYTEST.md`。**Agent 不可代签。**
9. **无障碍**：屏幕阅读器、色弱/对比度、纯键盘完成所有挑战（部分游戏需指针/键盘混合）未系统验证。
10. **跨设备导出/导入**：仅无头浏览器内验证 `exportText/importText` 往返；真实换机/配额边界未测。

---

## 8. 截图与日志（`test-artifacts/`，gitignored，不入库）

| 文件 | 内容 |
| --- | --- |
| `reviewer-09-data-audit.log` | 13×6 数据一致性审计（PASS，91 断言 + 78 id） |
| `reviewer-09-play2.log` | Reviewer 47/47 原生输入实玩（影跃 C01–C03、2048 C01–C03、贪吃蛇 C01–C02、打地鼠 C01、旧 trial 升级、导出导入、13 游戏 320/390、网络） |
| `reviewer-09-api-probe.log` | `A.Challenge` 记录/解锁/最佳/assisted/导入容错 13/13 |
| `reviewer-09-gameplay-all.log` | 全量 `--suite=all --repeat=2`：208/208（含 CH-DATA-001、CH-CLASSIC-001、13 模块） |
| `reviewer-09-smoke.log` | `arcade_smoke` 85/85 |
| `reviewer09-shadow-c01-clear.png` / `-c02-clear.png` / `-c03-clear.png` | 影跃真实键盘通关结算（C03 含影冲） |
| `reviewer09-shadow-c02-resumed.png` | 影跃 C02 暂停→刷新→继续恢复 |
| `reviewer09-mole-c01-clear.png` | 打地鼠 C01 真实实时点击通关（8/8 有效、0 炸弹） |
| `gameplay-CH-*.png`（185 张） | 全量场景逐场景截图（含 13 模块证据） |
| `challenge-classic-*.png`（13 张） | 13 游戏经典入口回归截图 |

---

## 9. 复现命令

```powershell
# 0) 冻结校验（评审时）
git status --short --branch
Get-FileHash apps/arcade/engine.js, apps/arcade/games/shadow-leap.html -Algorithm SHA256

# 1) 静态门禁
py -3 tools/validate_site.py
node --check apps/arcade/engine.js
node --check apps/arcade/sw.js
node --check tools/arcade_09_data.mjs
node --check tools/arcade_gameplay_test.mjs
node --check tools/lib/arcade_cdp.mjs
Get-ChildItem apps/arcade/challenge/*.js | ForEach-Object { node --check $_.FullName }
Get-ChildItem tools/challenge/*.mjs | ForEach-Object { node --check $_.FullName }
#   13 页内联脚本：逐页抽取 <script> 块后 node --check（Reviewer 已全部通过）

# 2) 数据校验/生成（幂等）
py -3 docs/arcade/0.9/scripts/validate_levels.py    # 在 docs/arcade/0.9 下运行
node tools/arcade_09_data.mjs                        # 13×78，自检 2128；重复运行字节一致

# 3) 确定性场景全量（约 13–14 分钟；104 场景 ×2）
$env:ARCADE_GAMEPLAY_PORT='8816'; $env:ARCADE_GAMEPLAY_CDP_PORT='9416'
node tools/arcade_gameplay_test.mjs --suite=all --repeat=2

# 4) 全链路经典回归（必须 85/85，约 4 分钟）
$env:ARCADE_SMOKE_PORT='8815'; $env:ARCADE_CDP_PORT='9415'
node tools/arcade_smoke.mjs

# 5) Reviewer 独立验证（test-artifacts/ 下评审脚本，gitignored）
node test-artifacts/reviewer-09-data-audit.mjs
$env:REVIEWER_PORT='8819'; $env:REVIEWER_CDP_PORT='9419'; node test-artifacts/reviewer-09-api-probe.mjs
$env:REVIEWER_PORT='8818'; $env:REVIEWER_CDP_PORT='9418'; node test-artifacts/reviewer-09-play.mjs

# 6) 构建（Lead 执行；Reviewer 未运行）
py -3 tools/build_site.py
Get-ChildItem dist/apps/arcade/challenge -Name    # 13 个；与 apps/arcade/challenge 哈希一致
```

---

## 10. 给 Owner 的结论与发布建议

1. **技术侧可进入 Owner 试玩**：0 Blocker；数据/记录/存档/经典/布局/构建门禁全部通过；13 款游戏均可从「挑战 6 关」入口进入，记录/解锁/最佳/assisted/收集物写入 `challenge:v1`，经典模式零回归。
2. **0.9 发布门槛未通过**：
   - Owner 两轮试玩尚未进行（`docs/arcade/0.9/PLAYTEST.md`）；Agent 不能代签；
   - 5 个 Major 设计差量需 Owner 裁决（影跃捷径/时长、砖块 K/G、星海 Boss 时间窗、重力窗口、全局目标时长）；
   - 发布前必须：升 `ARCADE_VERSION` / SW 缓存版本 / 注册表 / 文档，重跑 `validate_site`+`build_site`，并再次全量回归。
3. 建议 Owner 试玩优先级：**影跃 C01–C03**（验证影冲与捷径手感）→ **2048/方块**（残局快速反馈）→ **打地鼠/赛车**（时间轴可读性）→ **星海/矿工/砖块**（engine-replay 证据最弱、最需真人确认）→ **重力翻转**（重点验证推荐窗口晚半段是否被撞）。
4. 若 Owner 否决 §4-#14 砖块修正，请让设计/实现重新对齐，否则 C03/C06 不可解；其余 Major 即使暂不修改也不影响“能玩”，但会影响“是否达到 0.9 设计目标”的判断。





