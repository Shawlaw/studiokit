# StudioKit Task Queue

机器可读队列：[`tasks/queue.json`](tasks/queue.json)。状态变更可使用 `python tools/agentctl.py`。

| ID | 类型 | 任务 | 状态 | 依赖 | 备注 |
|---|---|---|---|---|---|
| T001 | agent | 审计启动包、仓库结构与路径约定 | DONE | — | 结构符合 AGENTS.md；Badge Studio 2.2.0 / Schema v3 / autosave key 不变均已核实 |
| T002 | agent | 执行校验/构建/脚手架测试并修复问题 | DONE | T001 | validate/build/node --check 全部通过；脚手架在临时副本验证，主工作树未污染 |
| T003 | review | 独立发布前审查 | DONE | T002 | 独立 Reviewer Agent：APPROVE-WITH-NOTES（0 Blocker / 0 Major / 2 Minor）；两个 Minor 已修复并回归 |
| T004 | agent | 准备首个提交并核验提交内容 | DONE | T003 | 提交 `5fc840b`（分支 `flash/bootstrap-baseline`，37 文件）；diff --check 干净；仅本地，未推送 |
| T005 | agent | 首次 GitHub Pages 发布与线上验证 | READY | T004 | 需要仓库 URL、可见性及 Owner 发布授权（缺项见交付报告） |
| T006 | agent | 替换默认徽章示例文字为中性项目内容并升版 2.2.1 | DONE | T004 | Owner 指令；默认内容改为 STUDIOKIT/BADGE STUDIO/◎；原始个人示例不出现在任何提交历史；版本全链同步；浏览器验证通过 |
| T007 | agent | 全仓库个人信息泄漏审计与处置 | DONE | T006 | 内容层零泄漏（邮箱/手机/身份证/用户名/路径/base64/注释全查）；Git 提交身份经 Owner 决定保持现状；BASELINE.md 溯源段按 Owner 决定整体删除 |

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
