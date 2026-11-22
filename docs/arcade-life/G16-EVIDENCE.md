# G16 门禁摘要（Arcade Life 0.16.0 — First Flight）

- 分支：`feat/arcade-life-015`（本地，未推送、未发布）；基线 `afc5fd4`（0.14.0）；目标 0.16.0
- 独立审计：G16 Reviewer，只读仓库；完整原始证据（命令输出/复跑日志/探针）在仓库外 `qa/evidence/G16-EVIDENCE.md`
- 结论：**PASS**（HEAD `b494ee1`；工作树干净；远端 `main` 仍为 `afc5fd4`；无 tag；无发布授权）

## 门禁摘要

| 项 | 结果 |
|---|---|
| 16 起源 → first flight 可达 | PASS（`career_first_flight_test` 192/192，GAPS 0；8 个不同起源真实进入告示板） |
| 真实经济闭环 | PASS（T1 70 / T2 120 / 星海 T1 90；旧翼 260、云雀 480+合金 1 真实购买；`purchase.costItems` 同事务；流水守恒、无负余额、purchaseId 幂等） |
| 恢复/幂等/旧档隔离 | PASS（`career_run_resume_test` 45/45；经典 `runs:v1` 逐字节不变；刷新/SW 重注册/ignoreCache 后钱包/claims 不重复） |
| 16 起源内容与防剧透 | PASS（16 origins ↔ registry；`chapter-01/clues` 只有戏内信件；外部检查系统词/剧透词 0） |
| 游戏回归/前置修复 | PASS（smoke 113/113、review 5/5（46 回看金样）、zen 14/14、calm 17/17、tower 23/23、interaction 5/5、immersive 32/32、pwa_update 9/9；GameMeta 读-合并-写、classicLike、serialize 门禁已核） |
| 数据壳/契约 | PASS（db 38/38、backup 34/34、PWA 离线 17/17、a11y 75/75、reachability 165/165；IDB v1 11 stores 未变；sessionStorage 仅 ticket/rental） |
| 移动端/UI/产品边界 | PASS（`career_mobile_016_test` 318/318；中心页 career 引用 0；仅 LOCAL 信件入口；目标行 320/375 两行内；Esc 只关最上层；按钮 ≥44px） |
| 防剧透 | PASS（提交信息/公开文档/仓库树/dist 无结局、谜底、阈值答案、外部策划包；career 目录仅运行时/UI/内容） |
| 发布授权 | **none**（远端 `main` 未动、无 push/tag/部署；无 `OWNER_AUTHORIZATION: PUBLISH_TO_MAIN`） |

## 审计备注

- 首次并行复跑 `career_run_resume_test` 曾因 4 个 Chrome 并发出现 1 项 9s 超时（43/45）；隔离复跑 45/45，历史多次亦全绿。门禁脚本应串行运行（`arcade_run_all_gates.py` 已串行）。
- 外部 `D16-12.md`/`D16-13.md` 保留修复前 FAIL 记录；最终复跑 192/192、318/318 以本文件与外部 G16 证据为准。
- `validate_site.py` 曾重复列出 `DESIGN-0.16.0.md`（已修）；`arcade_review_test` 结束横幅版本文案已同步 0.16.0。

## 未验证项（UNVERIFIED）

真机 iPhone/Android 触控与全屏安全区、VoiceOver/TalkBack 实际播报、PWA 安装/更新提示时机、Safari/Firefox 与旧版 Chrome、真实断电/杀进程恢复、真实手指接单/购买/租机、首局委托节奏体感。需 Owner 或持真机 Reviewer 复测。
