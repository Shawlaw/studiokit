# Arcade 回归门禁分层说明（0.21）

本说明对应 `tools/arcade_run_all_gates.py` 的 `--profile` 与 `.github/workflows/deploy.yml`
的 L0 静态 job。目标是让「发布回归」可分层、可计时、口径唯一，不把「没跑」说成「通过」。

## 1. 三层 profile

| profile | 内容 | Chrome | 串行要求 | 结论口径 |
| --- | --- | --- | --- | --- |
| `static` | 校验、构建、全部纯 Node 门禁、`career_96_missions --static`、`career_flow_e2e --static-only` | 不启动 | 静态项可有限并行（默认 3，上限 4） | `static passed` |
| `release` | `static` + 关键 Chrome 集：smoke、isolation、gameplay base、mobile、PWA、完整首航 flow、受影响 96 游戏 E2E | 启动 | Chrome 严格串行；静态先跑完 | `release passed (not full)` |
| `full` | 历史全量门禁，顺序与 0.20 及以前一致 | 启动 | 全量严格串行 | `full passed` / `ALL GATES PASSED` |

关键边界：

- `release` 通过 **不等于** `full` 通过。JSON 汇总里 `verdict` 明确写成
  `release passed (not full)`，`fully_passed` 只在 `full` 且全绿时为 `true`。
- 默认不传 `--profile` 等价于 `--profile full`，保持向后兼容；旧命令
  `py -3 tools/arcade_run_all_gates.py` 行为不变（仍逐项串行，最后打印 `ALL GATES PASSED`）。

## 2. 命令

```bash
# 全量（默认，向后兼容）
py -3 tools/arcade_run_all_gates.py

# 三层显式调用
py -3 tools/arcade_run_all_gates.py --profile static
py -3 tools/arcade_run_all_gates.py --profile release
py -3 tools/arcade_run_all_gates.py --profile full

# 静态项并行度（仅 static/release 有效；Chrome 永远串行）
py -3 tools/arcade_run_all_gates.py --profile static --workers 2
```

退出码：`0` = 本 profile 全绿；`1` = 至少一项失败/环境错误。任何一项失败都会让整个
profile 失败，但聚合脚本会跑完所有启用项再汇总（不再首错即停），便于一次看到全部失败项。

## 3. 结果口径与计时

每次运行结束打印 `PROFILE SUMMARY` + JSON，字段包括：

- `profile`：`static` / `release` / `full`
- `verdict`：区分 `static passed`、`release passed (not full)`、`full passed`
- `fully_passed`：仅 `full` 且全绿为 `true`
- `totals.items` / `passed` / `failed` / `failed_labels` / `duration_s`：真实墙钟总耗时
- `results[]`：每项 `label`、`status`（`pass`/`fail`/`error`）、`exit`、`attempts`、
  `duration_s`（真实计时）、`started_at`、`error`

原则：

- 耗时来自 `time.monotonic()` 实测，不写死、不估算、不伪造。
- 只有 exit 0 且无环境异常才记 `pass`；子进程启动失败记 `error`；重试仍失败记 `fail`。
- 日志保留 `RETRY <label> ...` 行；`attempts` 记录真实尝试次数。
- 环境错误（Chrome 起不来、端口占用、spawn 失败）与「跳过」绝不计为 PASS。

## 4. 96 委托的 --skip-static 优化

0.17 的 `career_96_missions_test.mjs` 在 E2E 阶段会为 16 款游戏各起一个
`career_mission_fixture_runner --run=<game>` 子进程；旧实现每个子进程都会重复执行
content schema 校验和 16 个 fixture 的导入/形状校验。

新增：

- `career_96_missions_test.mjs --skip-static`：只在 E2E/抽样阶段有效，透传给子进程。
- `career_mission_fixture_runner.mjs --skip-static`：仅可与 `--run` 同用；信任父进程
  已通过 96 static，跳过重复的 schema/形状校验，但**仍真实读取内容与 fixture、
  仍跑全部 tier 的 Chrome E2E、收据幂等与隔离证据**，并打印 `SKIP-STATIC` 标记。
  `--validate` / `--list` / `--self-test` 传该参数会报用法错误（exit 2）。
- 退出码语义保持 `0=PASS / 1=FAIL / 2=环境或用法错误`；`--games` / `--samples`
  定向重跑不变；真实 E2E 与 isolation 不跳过。

release profile 的 96 项调用为 `career_96_missions_test.mjs --e2e --skip-static`；
full profile 仍用无参数全量调用。

## 5. CI 边界

`.github/workflows/deploy.yml` 新增 `static-gates`（L0）job：

- `runs-on: ubuntu-latest`，只跑 `python tools/arcade_run_all_gates.py --profile static --workers 3`。
- 普通 ubuntu runner **不启动 Chrome**；release/full 的 Chrome 集只在本地有 Chrome 的环境串行执行。
- `deploy-pages` 与 `deploy-cloudflare` 的 `needs` 同时包含 `build` 与 `static-gates`；
  `verify` 经两个 deploy job 间接依赖 L0。
- 静态层失败即阻断双端部署，不需要等 Chrome 长跑。

## 6. 优化原理与风险

优化只发生在「可安全去重」的地方：

1. 纯 Node/Python 静态项之间互不共享状态，可有限并行（2–4 worker）缩短墙钟时间；
   Chrome 项共享本机 CDP/端口与 profile，必须严格串行。
2. 96 父进程 static 已验证过内容与 fixture，子进程只需目标游戏的 fixture 与真实 E2E，
   跳过重复 schema/形状导入可显著减少 16 个子进程的启动开销。
3. `release` 只跑关键 Chrome 集，把完整 Chrome 集留给单独执行的 `full`，两者口径分离。

风险与边界：

- 并行静态项只保证「独立、无端口冲突」；若将来某静态门禁改为占用固定端口或共享临时目录，
  必须改回 `--workers 1` 或标记其为 Chrome/串行项。
- `--skip-static` 的信任前提是父进程确实通过了 96 static；孤立地手工调用
  `--run=... --skip-static` 会跳过静态校验，不应作为发布证据。release profile 保证顺序。
- 本次只实现与静态自测（py_compile、`--help`、static profile），未运行 Chrome；
  release/full 的真机结果需在本地有 Chrome 的环境另行串行执行并如实记录。
