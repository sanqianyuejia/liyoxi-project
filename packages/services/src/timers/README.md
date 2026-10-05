# timers：定时器的登记、取消、改期与周期任务补登记

会改状态的时限，一行一个到期时间；周期任务的每一期也是一行（W0-17）。扫描认领、执行、失败退避在 W0-23。依据：[01 分组](../../../../docs/data-model/01-kernel-flow.md) 第 2.5 节；[x01](../../../../docs/api/x01-events-jobs.md) 第 4.1、4.2 节；D3 第 21.2–21.4 节；D7 第 7.6 节。

## 1. 用法

```ts
const timers = createTimers({ assembly }); // 进程启动时建一次，api 与 worker 都建

// 业务事务里，已持有主体业务行的锁
await timers.arm(tx, {
  kind: "takedown.overdue",
  subject: { type: "takedown_task", id },
  key: timerKey("takedown.overdue", { type: "takedown_task", id }, dueDate),
  fireAt, // 按注入的时钟算
  payload,
});
await timers.cancel(tx, { subject, keyPrefix: timerKeyPrefix("takedown.overdue", subject) });

// worker 的补登记循环（W0-23），每 60 秒
await runner.run((tx) => timers.ensureRecurring(tx, clock.now()));
```

- `kind` 与主体的表名以契约的登记为准（`@liyoxi/contract/registry` 的 `TIMERS`、`JOBS`）：不在登记里的 `arm` 直接抛错。
- 去重键的形状是 `{kind}:{subject_type}:{id}[:后缀]`，用 `timerKey` 拼；后缀放什么照 x01 第 4.1 节。
- 改期没有单独的接口：同键再 `arm` 一次，改 `fire_at` 与 `payload`。到期时间变了的，失败重试一并重来（`retry_at` 置空、`attempts` 归零：不清的话扫描仍按旧的重试时刻认领）；到期时间没变的不动重试进度。目标日期变了是新键，旧键按 `keyPrefix` 取消。
- 同键已有未取消的行时：`scheduled` 改期；`dispatched`、`fired`、`skipped` 不动；`failed` 复活；处理器声明了 `rearmAfterSkip` 的，`skipped` 也复活。返回值的 `outcome` 说明走了哪一条。
- `cancel` 只取消 `scheduled`、`dispatched` 的行，并跳过正在执行的这一条：执行处理器时用 `runAsCurrentTimer(timer.id, …)` 包住（W0-23 的 `runTimer` 做）。
- `arm`、`cancel` 自己不锁业务行；`timer` 不在加锁顺序表里。

## 2. 登记处理器与周期任务

写在各模块的 `register.ts`（见 [kernel/assembly](../kernel/assembly/README.md)）。本包给这两类登记项加了可选字段：

```ts
timerHandlers: [{ kind: "order.start", critical: true, rearmAfterSkip: true, handle }],
recurringJobs: [
  { kind: "ops.retention", schedule: { every: "hour" }, mode: "tx", missSeverity: "P3", run },
  { kind: "bill.download", schedule: { every: "day", at: "10:30" }, mode: "job", leaseSec: 300, maxAttempts: 5, deadlineMin: 210, missSeverity: "P1", run },
],
```

- 节奏 `schedule`（都按北京时间）：`{ every: "minutes", minutes }`、`{ every: "hour", minute? }`、`{ every: "day", at }`、`{ every: "week", weekday, at }`、`{ every: "month", day, at }`；`day` 只到 28。不用 cron 库。
- `createTimers` 对照契约查一遍，对不上即抛 `TimerRegistryError`（问题一次列全）：名字不在契约里；`critical` 与契约不一致；周期任务没写节奏或写错；`mode`、`missSeverity`、几个数值不合法。同名重复由 kernel 的装配报。
- 周期任务的键是 `{kind}:{栅格时刻}`，栅格时刻写成 UTC 的 ISO 8601、秒精度；`payload.scheduledFor` 是栅格时刻。
- 补登记：每一项登记下一期；声明了 `catchUp` 的再补最近已到的一期（只补这一格，立即到点）。同键的行不论什么状态都算已登记。只属于别的环境的任务（`envs`）不登记。

## 3. 清理

`register.ts` 登记了清理项 `timers.recurring_fired`：周期任务行里 `fired`、`fire_at` 早于 90 天的物理删除，每日一次；业务定时器行不删。调度在 `ops.retention`（W0-24）。

## 4. 跑用例

```sh
pnpm --filter @liyoxi/services exec vitest run src/timers/
LYX_FC_RUNS=200 LYX_FC_SEED=42 pnpm --filter @liyoxi/services exec vitest run src/timers/arm.test.ts
```

`schedule.test.ts`、`registry.test.ts` 不连库，其余要本地的 PostgreSQL 与 `DATABASE_URL`。用例里的样例 kind（`lyxtest.*`）不在契约里：建 `timers` 时把 `@liyoxi/services/testing` 的 `SAMPLE_TIMER_CATALOG` 传给 `catalog`；要加自己的样例用 `extendTimerCatalog`。

## 5. 已知的限度

- “调用方已持有主体业务行锁”这里查不了（主体表不都在加锁顺序表里，直接 `UPDATE` 拿到的行锁也看不到）：靠调用方守。没锁时并发的同键登记仍然只留一行（部分唯一索引兜底，有并发用例）。
- 清理项按契约里的周期任务名删；样例 kind 的行不在其内。
- `timers.I7`（未完成的时限都有对应的定时器）由登记定时器的各域提供检查项，不在本包。

## 6. 扫描、执行与长任务（W0-23）

循环在 `apps/worker`，这里是它调的用例函数；状态机见 01 分组 第 2.5 节。

| 文件 | 内容 |
| --- | --- |
| `scan.ts` | `claimTimers(tx, registry, now, limit?)`：认领到期的行；另放执行那几份共用的类型、常量与读写一行的小函数 |
| `dispatch.ts` | `scanDue(deps, { limit?, beat? })`：扫描一轮，认领后逐行入队；入队失败时关键类、或 Redis 已连续不可用满 60 秒的在进程内执行，其余放回 `scheduled`，不计次数 |
| `run.ts` | `runTimer(deps, ref)`：队列的处理器与进程内执行共用。定时器处理器、`tx` 模式的周期任务走这里 |
| `job-mode.ts` | `runJobTimer`：`mode: "job"` 的周期任务，认领确认后在事务外执行，按租期的三分之一续租 |

- 认领租约 5 分钟；每次认领 `dispatch_no + 1`。`runTimer` 先做不加锁的预检，状态不是 `dispatched` 或序号对不上即结束。
- **处理器要自己守住“只做一次”**：在主体业务行的锁下重新校验状态，或用事件去重键。`runTimer` 最后才更新定时器行，影响 0 行（并发被取消或被接管）时照常提交，所以同一次认领被重复触发时，挡住第二次的是处理器的守卫，不是定时器行。
- 失败退避 1、2、5、15、30 分钟（写 `retry_at`）。非关键类第 6 次置 `failed` 并告警（规则 `timer.failed`，维度是 kind，P2）；关键类不进终态，每 30 分钟重试，从第 6 次起每次升级告警（`timer.critical_retrying`，P1）。两个规则键是本包定的。
- 处理器声明了 `maxLateMinutes` 的：触发时已晚于上限即 `skipped`，不调处理器。“晚了多久”按注入的业务时钟算；到期、租约、重试时间按数据库时间。
- 周期任务：认领本期时登记下一期，下一期是业务时钟“现在”之后的第一格，停机期间漏掉的格不逐个补跑。`tx` 模式的处理器从 `ctx.tx` 拿事务；`job` 模式拿到 `ctx.signal`（续租发现已被接管时中止）与 `ctx.runTx`（自己开小事务）。
- 长任务抛错：行保持 `dispatched`，租约按 1、5、15、30、60 分钟后移，到点由扫描重新认领；失败达到登记的 `maxAttempts`（缺省 6）置 `failed`。
- 任务号 `tmr-{id}-{认领序号}`。

```sh
pnpm --filter @liyoxi/services exec vitest run src/timers/run.test.ts src/timers/job-mode.test.ts
```
