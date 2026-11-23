# Arcade Life 0.18.0 设计、叙事图与回滚（星塔回响，本地未发布）

- 分支：`feat/arcade-life-015`；基线 0.17.0（G17 PASS）；目标 0.18.0
- 契约：[ADR-interfaces.md](../../docs/arcade-life/ADR-interfaces.md) §20；试玩：[PLAYTEST-018.md](../../docs/arcade-life/PLAYTEST-018.md)；集成：`INTEGRATION-0.18.md`
- 证据：仓库外 `qa/evidence/D18-*.md`；G18 摘要 `docs/arcade-life/G18-EVIDENCE.md`（G18 后落盘）

## 1. 目标

补完 C0–C5 六章、三条并列终局与后日常，让任意 16 起源都能走到任一终局，同时经典/挑战/禅/割草与旧机库零改动、无顶层生涯 CTA。

## 2. 叙事状态机

- 旗标链：`C0.port_seen` → `C1.signal_fragment` → `C2.research_complete` → `C3.truth_found` → `C4.city_power_restored` → `C5.star_tower_resolved` + `ending.{combat|research|rescue}`。
- `campaign-core` 只推导/补齐 C0/C1；C2–C4 由 `story-evidence` 多路径授予；C5 由 `ending-reducer` 一次性汇合。
- 六章内容：`campaign.json` + `chapter-00..05.json`（C1 复用 0.16 origins 文件并补 body）；每章 ≥2 条替代（C0 序章 1 条）；C5 为三终局。
- NPC：E-7/阿砾/黎序 按章回信；侧故事 5 家族，仅真实触发来源后可选阅读，不提供唯一必需资源。

## 3. 终局

- 三份 `ending-*.json` 转成独立 commission 行，复用 commission-core 的 ticket/claim/幂等；不进入 96 告示板。
- C4 后可选；同一生涯只能有一个 C5 首次通关；重复结算返回原收据、零新增；失败/放弃不写 C5、可重试。
- 经济等价：ending 工钱 0、无材料；结局差异只体现在后日谈文本/港口状态，不影响自由职业收益。

## 4. UI 与入口

- 信箱「旧港来信 · 章节」打开 `ui/world-state.js`：六章卡片（状态/路线提示/mustKnow/正文）、NPC 回信、支线、C4 后三终局、后日谈、港口灯光。
- 中心页仅在真实有 `C0.port_seen` 后显示一行「旧港来信」小字入口（`?story=1` 自动打开章节），不是生涯模式 CTA。
- 面板只读、不写经典 5 键/画布；320–430、Esc 顶层、焦点返回、reduced-motion 静态回退。

## 5. 关键修复（0.18 收口）

- `openMailbox` 现在真实补 `C0.port_seen`（此前 promise 链断裂，章节永远停在 pre）。
- 终局 run 跨页事件缓冲：`commission-core.adoptRun` + `ending.attach`；bridge 在终局 run 激活时接管 ticket，事件同时进 ending 实例与主缓冲，结算/重放一致。
- 路线完成展示：章节完成时所有路线标记完成，避免「展示路线零产证」；C1 代办旗标接入路线。
- `mustKnow`/章节正文/NPC 回信现在真实渲染；回信可跳过、可回看。

## 6. 测试

- campaign-core 53/53、ending-reducer 34/34、graph **48/48 路径、死锁 0**、world-state 109/109。
- `career_campaign_e2e_test` **701/701**：3 条不同路线 C0→C5、三终局真实结算、备份恢复 24/24、经典 5 键逐字节；T4–T6/终局受控旗标已标注。
- 20 分钟/真机/读屏器/PWA 安装态：UNVERIFIED。

## 7. 风险

- 刷新清空本页事件缓冲（既有架构）；终局跨页已用 attach 补齐，未结算进度仍需重打。
- 章节完成反馈仅有面板/收据侧更新，尚无全局 toast（PLAYTEST I4 收口建议）。
- 路线产证与展示仍有内容层差异（I3），E2E 用受控种子覆盖；真实人类节奏未标定。
- 中心页回流入口仅 C0 后出现，首次入口仍依赖新线索 chip。

## 8. 回滚

1. 回退 0.18 批次提交（内容/核心/UI/测试/版本链）；2. 版本链归 0.17.0（engine/sw/index/registry/模块常量/validate/verify_deploy）；3. 删 SW `studiokit-arcade-0.18.0-*`；4. IDB v1/11 stores 未变，0.18 新增 quest 行（story:* / ending.*）可忽略，旧档可读；5. 16 游戏页与 0.17 一致，可整页回退；6. 终局/章节内容为纯静态资源，回退不影响经典。
