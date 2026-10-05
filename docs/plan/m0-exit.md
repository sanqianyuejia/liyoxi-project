# M0 退出核对表

| 项 | 内容 |
| --- | --- |
| 作用 | 把[开发计划](../08-development-plan.md) 第 6.3 节 M0 的退出条件逐条列出：自动化项对到用例与命令，演示项写清业主怎么看 |
| 交付 | 工作包 W0-30（[任务书](tasks/W0-30.md)）。写于本包提交时；之后有变化改本表 |
| 怎么核对 | 自动化项都在 PR 必过检查 `required` 里：看 main 上合并本包之后那次 CI 运行（链接由调度会话填在本行）。写本表时 main 上最近一次是[运行 37344860491](https://github.com/byfire-dev/liyoxi-project/actions/runs/37344860491)（提交 `5378fa2`，全绿） |
| 本表自己 | `infra/ci/test/m0-exit.test.ts` 核对：第 1 节九项每一项都点到了用例或命令，本表点到的文件都在仓库里、根脚本都在 `package.json` 里 |

## 1. 自动化项

“在哪跑”写的是 `.github/workflows/ci.yml` 里的任务；各任务跑哪些命令由 `infra/ci/test/workflows.test.ts` 钉住。

| # | 退出条件（计划原文摘要） | 用例与命令 | 在哪跑 |
| --- | --- | --- | --- |
| ① | 计划 第 5.5 节“M0 起”的检查全部在 main 上为绿 | 六个必过任务与汇总任务：`.github/workflows/ci.yml`；汇总判定 `infra/ci/ci-required.mjs`（用例 `infra/ci/test/ci-required.test.ts`）。其中“启动时声明即挂载”是 `apps/api/test/mount.test.ts` 与任务进程的 `--check`；“种子后全量不变量 0 违规”见第 ⑥ 项 | 全部任务；`required` |
| ② | 空库跑全部迁移后与底稿参照库比对系统目录 0 差异；数量两组口径并列核对；结构快照 0 差异；分区断言成立 | `pnpm db:catalog-diff`（用例 `infra/ci/test/db-catalog-diff.test.ts`）；`pnpm db:snapshot:check`、`pnpm db:constraints:check`、`pnpm db:partitions:assert`（用例 `infra/ci/test/db-structure.test.ts`） | `test` |
| ③ | `contract:docs-check` 0 差异；待落地清单 610 条（根路径探活 3 条已落地，两条内网探活在留桩清单） | `pnpm contract:docs-check`；`node infra/ci/landed.mjs --check --report`（用例 `infra/ci/test/routes-gates.test.ts`）；探活落地 `apps/api/test/probes.test.ts`；留桩 `docs/plan/stubs/m4-ops-probe-finance.md`、`docs/plan/stubs/m7-ops-probe-flow.md`。现在待落地 610、已落地 3；基线文件里还是 613，没有降（第 6 节第 1 项） | `verify`；`test` |
| ④ | `pnpm gates:selftest` 为绿：越层引用、成环、删一个部分索引、改一列类型、改一条路由的权限点，逐个让对应的检查失败 | `pnpm gates:selftest`。五个反例：`infra/ci/selftest/cases/layers-cross-layer.mjs`、`infra/ci/selftest/cases/layers-circular.mjs`、`infra/ci/selftest/cases/db-snapshot-dropped-partial-index.mjs`、`infra/ci/selftest/cases/db-snapshot-column-type.mjs`、`infra/ci/selftest/cases/docs-check-wrong-permission.mjs`；框架自己的用例 `infra/ci/test/selftest.test.ts` | `gates` |
| ⑤ | PRD 2.9 七个计费示例与锚定日用例通过 | `pnpm --filter @liyoxi/shared test`：`packages/shared/src/pricing/prd-2-9.test.ts`、`packages/shared/src/period/period.test.ts` | `test` |
| ⑥ | 空库加种子，全量不变量校验 0 违规；人为造一条违规能被发现且不重复登记 | `packages/services/src/ops/invariants/run.db.test.ts`（“真实装配：空库加种子”一组）；种子自己的断言 `packages/services/src/seed.db.test.ts`；样例链路走完后再跑一遍全量 `packages/services/src/testing/m0-chain.db.test.ts` | `test` |
| ⑦ | 故障注入通过：重复投递、进程中断、清空 Redis 后周期任务照常触发、两个 worker 不重复执行 | `apps/worker/test/fault/redelivery.test.ts`、`apps/worker/test/fault/crash.test.ts`、`apps/worker/test/fault/redis-flush.test.ts`、`apps/worker/test/fault/dual-worker.test.ts`；整套见第 4 节，一条命令 `pnpm test:fault` | `test` |
| ⑧ | 测试隔离：4 个 Vitest worker 并行通过；两个会话同时跑全量测试都绿 | `packages/db/src/testing/parallel.test.ts`；`pnpm test:isolation`（脚本 `packages/services/src/testing/isolation.mjs`，用例 `packages/services/src/testing/isolation.test.ts`）。CI 里跑的是 `--scope connected`（只跑连库的测试项目，业主 2026-10-05 定，`docs/plan/status/W0-05b.md` 偏差 12）；两个会话跑全量在本机出 | `test`；`test-isolation` |
| ⑨ | PR 必过检查合计 ≤15 分钟 | `required` 任务“汇总判定与时长统计”一步的摘要与产物 `ci-duration.json`（`infra/ci/ci-required.mjs`：比预算的是跨度，超了只标出、不失败）。上面那次运行的跨度约 10 分钟（最长的是 `test-isolation`） | `required` |

## 2. 演示项

| 项 | 业主怎么看 | 看什么算过 | 现状 |
| --- | --- | --- | --- |
| 样例用例重放 | 本机起着依赖（`pnpm infra:up`），给出 `CLAUDE.md` 第 9 节的三个连接参数，跑 `pnpm demo:m0`（约一两分钟，多数花在建库与跑迁移上） | 以 0 退出。逐步打印七步；末尾“演示核对”四行都是 ✓：写请求重放返回同一结果；状态历史、审计、出站事件各 1 条；订阅者与定时器各执行 1 次；全量不变量 0 违规。再往下是四个计数 | 本机跑通；同一条链路的用例在 `pnpm test` 里，命令本身每晚任务重放一遍 |
| 两端观感（看样页） | 照 [sample-review/W0-29.md](sample-review/W0-29.md) 第 1 节打开后台与小程序的陈列页，逐组对规范 | 该清单第 2、3、4 节各项填了结论 | 都还没有结论（第 3 节） |
| 小程序真机 | 同一份清单第 1 节“小程序（真机）”：开发者工具预览，iOS、安卓各扫一次（E16、E7） | 该清单第 5 节 iOS、安卓两栏都填了 | 都还没看 |

## 3. 看样清单的结论

照 [sample-review/W0-29.md](sample-review/W0-29.md) 的现状列，不替业主填。

| 清单的节 | 项 | 项数 | 已有结论 |
| --- | --- | --- | --- |
| 第 2 节 后台：逐组看 | A1–A17 | 17 | 0 |
| 第 3 节 小程序：逐组看 | M1–M14 | 14 | 0 |
| 第 4.1 节 留给看样定的（小程序） | D1–D15 | 15 | 0 |
| 第 4.2 节 留给看样定的（后台） | D21–D32 | 12 | 0 |
| 第 5 节 只能在真机上确认的 | P1–P13 | 13 | 0（iOS、安卓都没填） |
| 第 6 节 看样记录 | — | — | 没有记录 |

71 项都没有结论。第 4 节的事项不填就照“现在的做法”；看样先合并、后看、意见另开 PR（[README.md](README.md) 第 3.5 节第 6 项），所以不挡 M0 的代码合流，但“业主在看样页上确认两端观感、真机各看一次”这一条退出条件还开着。

## 4. 故障注入套件

一条命令：`pnpm test:fault`（要本地的 PostgreSQL 与 Redis，连接参数同 `pnpm test`）。它按文件名圈用例，不列名单：`*.concurrency.test.ts`、`*.property.test.ts`、名字是 `fault` 的目录与文件（`fault/` 下的、`fault-*.test.ts`、`fault.test.ts`）、幂等与租约的用例（文件名带 `idempotency`、`lease.test`）。以后的包照这个约定起名就自动进来。这些用例本来就在 `pnpm test` 里，这条命令只是单拎出来跑。性质测试的轮次与种子用 `LYX_FC_RUNS`、`LYX_FC_SEED` 调。

| 造什么 | 看什么 | 用例 |
| --- | --- | --- |
| 事务撞上死锁、锁等待超时 | `tx.run` 的重试与错误映射 | `packages/services/src/kernel/tx.retry.concurrency.test.ts` |
| 同一个幂等键重放、并发提交、换入参 | 用例函数只执行一次，后到的拿到同一份结果 | `packages/services/src/kernel/idempotency.test.ts`、`packages/services/src/kernel/idempotency.concurrency.test.ts`、`apps/api/test/idempotency.test.ts` |
| 三段式在外部调用之前、之中、之后中断；占用被接管 | 同键再来时续做，三段各自的结果对得上 | `packages/services/src/kernel/three-phase/fault-before.test.ts`、`packages/services/src/kernel/three-phase/fault-during.test.ts`、`packages/services/src/kernel/three-phase/fault-after.test.ts`、`packages/services/src/kernel/three-phase/takeover.concurrency.test.ts`、`packages/services/src/kernel/three-phase/three-phase.property.test.ts` |
| 两条连接同时展开出站事件 | 投递行不重不漏 | `packages/services/src/events/expand.concurrency.test.ts` |
| 重复投递：租约过期重派、队列重复送达 | 业务副作用 1 次 | `apps/worker/test/fault/redelivery.test.ts` |
| 进程中断：认领后被杀 | 没提交的回滚，租约到期后由另一个实例完成 | `apps/worker/test/fault/crash.test.ts` |
| 清空 Redis | 在途任务重新派发，周期任务照常触发 | `apps/worker/test/fault/redis-flush.test.ts` |
| Redis 不可用 | 关键类进程内执行，恢复后照常走队列 | `apps/worker/test/fault/redis-down.test.ts` |
| 两个任务进程同时干活 | 不重不漏 | `apps/worker/test/fault/dual-worker.test.ts` |
| 持有租约的实例停顿、续约挂起 | 另一个实例接任，原主自行降级；看门狗只读本地变量 | `apps/worker/test/lease.test.ts` |
| 同一行上并发迁移；随机迁移序列 | 一个成功一个被拒，`flow.I12` 0 违规 | `packages/services/src/flow/transition.concurrency.test.ts`、`packages/services/src/flow/transition.property.test.ts` |
| 同键并发登记定时器；并发取业务单号 | 只有一行未取消；单号不重 | `packages/services/src/timers/arm.concurrency.test.ts`、`packages/services/src/kernel/biz-no.concurrency.test.ts` |
| 四种故障注入工具自己 | 工具造得出它说的故障 | `packages/services/src/testing/fault.test.ts` |

## 5. 四个计数与归属

`pnpm counts:report` 现出（脚本 `infra/ci/four-counts.mjs`，口径在它开头的注释里）；CI 的 `test` 任务末尾带 `--require M0` 跑：M0 的接口、留桩、页面、x01 条目有一样退回去即失败。写本表时：

| 计数 | 数 |
| --- | --- |
| 已落地接口数 | 3（根路径探活） |
| 待落地数 | 610 |
| 留桩数 | 2（两条内网探活，回补在 M4、M7） |
| 未实现页面数 | 122（M0 没有应实现的页面） |

归 M0 的 x01 条目 9 项（三个周期任务、四个循环、两个队列）都有处理器与测试。留桩、计划变更、外部验证三张汇总用 `pnpm plan:summaries` 现生成，不入库。

## 6. 还开着的

| # | 事 | 谁办 |
| --- | --- | --- |
| 1 | 待落地基线从 613 降到 610。已挂载清单不入库，`test-infra` 在全新检出里拿不到，直接降会让 `infra/ci/test/routes-gates.test.ts` 红：属门禁改动，要先让清单在全新检出里拿得到 | 调度会话另开 PR |
| 2 | 启动自检四项只接了一项（聚合类型对表名单）；加解密与盲索引、审计对象类型、状态机的表与列三项没接（`docs/plan/tasks/README.md` 第 5 节移交表第 1 行） | 调度会话另派的内核小修补 |
| 3 | 看样与真机（第 3 节） | 业主 |
| 4 | 在合并提交上打 `m0-done` | 业主或调度会话 |
