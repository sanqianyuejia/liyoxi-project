# apps/worker：任务进程

出站事件的中继与派发、定时器扫描、周期任务补登记、两个队列的消费（W0-23）。依据：[x01](../../docs/api/x01-events-jobs.md) 第 4.3、4.4 节；[01](../../docs/01-architecture.md) 第 7.3、7.4 节；D7 第 7.6 节。

这里只有调度：循环、租约与看门狗、队列装配、信号处理。认领、执行、失败处理都在 `@liyoxi/services`（`events`、`timers`、`ops`、`kernel/queue`）。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `src/index.ts` | 入口：装配 → 自检 → 抢租约；`--check` 只做装配与自检 |
| `src/runtime.ts` | 四个循环、两个队列的消费者、成为主与降级、关停的顺序。节奏与并发是这里的常量 |
| `src/lease.ts` | 续约循环与看门狗 |
| `src/loop.ts` | 进程内循环：一轮一轮地跑，上一轮没完不起下一轮 |
| `src/recurring.ts` | 周期任务的汇总入口：把本环境生效的汇成一张表。任务登记在各模块的 `register.ts` |
| `src/log.ts` | 一行一条 JSON 的日志口 |
| `src/cli/redis-compat.ts` | 托管 Redis 与队列库的兼容脚本（验证项 V1） |
| `scripts/build.mjs` | 构建：esbuild 把工作区的包与第三方依赖打成 `dist/index.js`、`dist/redis-compat.js`，只留 `bullmq`、`ioredis` 在外 |

## 2. 怎么跑

```sh
pnpm --filter @liyoxi/worker build
node apps/worker/dist/index.js --check   # 只做装配与自检，通过即 0 退出；缺必填变量非 0 退出
node apps/worker/dist/index.js           # 起任务进程
```

环境变量只经 `loadEnv` 读（`APP_ENV`、`DATABASE_URL`、`REDIS_URL`、`LOG_LEVEL`，取值见 `CLAUDE.md` 第 9 节）。自检要连一个跑过迁移的库：本地用 `lyx_migrate_check`（只读它的系统目录）。

| 循环 | 节奏 | 队列 | 并发 |
| --- | --- | --- | --- |
| 出站中继 `outbox_relay` | 每秒 | 出站投递 `outbox_delivery` | 4 |
| 出站派发 `outbox_dispatch` | 每秒 | 定时器执行 `timer_run` | 4 |
| 定时器扫描 `timer_scan` | 每 20 秒 | | |
| 周期补登记 `ensure_recurring` | 每 60 秒 | | |

- 一主一热备：谁持有 `worker_lease` 那一行谁干活。每 10 秒续约（专用连接）；持有者 30 秒没续约可被接任。
- 看门狗每秒看一眼，只读本地变量：续约超过 20 秒没成功即降级（停循环、消费者不再领新任务）；自己晚到 10 秒以上、或某个循环连续两个周期没有进展（不少于 60 秒）即退出进程，由外面拉起。
- 收到 SIGTERM：停循环 → 收在途任务（至多 30 秒）→ 让出租约 → 退出。
- Redis 不可用时循环照跑：关键类在进程内执行，非关键类放回去，连续不可用满 60 秒后也在进程内执行。
- 租约只是减少重复劳动：两个实例同时干活也不出错（认领用 `SKIP LOCKED`，消费按派发序号认）。

## 3. 跑用例

```sh
pnpm --filter @liyoxi/worker test                                             # 全部
pnpm --filter @liyoxi/worker exec vitest run test/fault/redis-flush.test.ts   # 单个
```

要本地的 PostgreSQL 与 Redis（`pnpm infra:up`）与连接参数。用例走测试支架：自己建 `lyx_test_worker_` 开头的库，Redis 只用自己的键前缀，“清空 Redis”只清这个前缀，“Redis 不可用”在客户端一侧造。

| 文件 | 验什么 |
| --- | --- |
| `test/fault/redelivery.test.ts` | 重复投递：租约过期重派、队列重复送达，副作用 1 次 |
| `test/fault/crash.test.ts` | 进程中断：认领并入队后被 SIGKILL，租约到期后由另一个实例完成 |
| `test/fault/redis-flush.test.ts` | 清空 Redis：worker 不重启，在途任务在租约到期后继续，下一格周期任务照常 |
| `test/fault/dual-worker.test.ts` | 两个实例绕过租约同时跑：不重不漏 |
| `test/fault/redis-down.test.ts` | Redis 不可用时的三条出路 |
| `test/lease.test.ts` | 抢租约、接任、自行降级、让出；看门狗的三条规则 |
| `test/recurring.test.ts` | 补登记循环；只在预发登记的任务在生产配置下不存在 |

## 4. 兼容脚本

`REDIS_COMPAT_URL=<连接串> pnpm redis:compat`。参数与七项内容见 [src/cli/redis-compat.ts](src/cli/redis-compat.ts) 开头的注释；业主怎么跑、结果记到哪见 [v01-managed-redis.md](../../docs/plan/external-verification/v01-managed-redis.md)。

## 5. 已知的限度

- 日志口是最小实现（不带采样、不带脱敏规则），日志库随 api 骨架定了再换。
- 降级时消费者只是不再领新任务：已经在等任务的那一下可能还会领到一条，照常处理，不影响正确性。
- 进程内执行的长任务（`mode: "job"`）不占着扫描循环，关停时也不等它：没跑完的由租约到期后重新认领。
- 启动自检与 api 是同一份清单（`packages/services/src/ops/startup.ts`）：连库、字段加密的密钥环、审计 `target_type`、聚合类型、状态机的表与列，问题一次列全。密钥没配时预发、生产起不来，`local`、`test` 放行并记一条告警。
