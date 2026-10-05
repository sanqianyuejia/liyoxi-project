# events：出站事件

业务事务里发事件，事件按已登记的订阅者展开成投递行（W0-15）。做到投递行落库（`pending`）为止；中继循环、派发、消费、退避、死信在 W0-23。依据：[x01](../../../../docs/api/x01-events-jobs.md) 第 2 节；[01 分组](../../../../docs/data-model/01-kernel-flow.md) 第 2.3、2.4 节；D3 第 20.2 节。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `runtime.ts` | `createEvents`：本模块的装配入口，给出 `emit`、`expand`、`expandPending`、`subscribers` |
| `catalog.ts` | 事件目录：契约的事件登记加载荷 schema；测试装配可追加 `lyxtest.` 前缀的样例事件 |
| `emit.ts` | 校验事件名、聚合、载荷，从身份上下文填信封，带去重插入 |
| `subscribers.ts` | 订阅者表：装配结果里的订阅者对照契约校验后按事件名索引 |
| `expand.ts` | 展开一批：`FOR UPDATE SKIP LOCKED` 取未展开的事件，按订阅者各插一行，写 `published_at` |
| `invariants.ts`、`register.ts` | `events.I8` 的查询与登记 |
| `aggregates.ts` | 聚合类型自检：契约登记的聚合类型都是库里存在的表 |
| `repo.ts` | 本模块全部的原生 SQL |

## 2. 装配

```ts
const assembly = assembleServices({ entry: "worker", appEnv: env.APP_ENV });
const events = createEvents({ assembly, clock: systemClock, tx }); // api、worker 启动时各一次
await assertAggregateTables(prisma); // 启动自检，由 W0-22、W0-23 接
```

`createEvents` 在构造时对照契约校验订阅者的登记，对不上即抛 `SubscriberRegistryError`（进程启动失败，问题一次列全）：

| 查什么 | 口径 |
| --- | --- |
| 名字 | 订阅者名要在契约的订阅者登记里（`@liyoxi/contract/registry` 的 `SUBSCRIBERS`） |
| 重名 | 同名重复（`assembleServices` 已先查一遍） |
| 事件 | 订阅的事件要在事件目录里 |
| 关键类 | 登记里写了 `critical` 的，要与契约一致；不写即以契约为准 |
| 所属模块 | 登记它的模块要与契约里的模块相同 |

## 3. 发事件

```ts
await tx.run(async (handle) => {
  // …业务写…
  await events.emit(handle, ctx, {
    type: "calendar.imported",
    payload: { v: 1, calendarVersion, year, changedDays },
    dedupeKey: `calendar.imported:${calendarVersion}`,
  });
});
```

- 第一个参数是事务句柄：事件与业务写同一事务。
- 信封列由 `emit` 填：操作人几列、角色快照、归属、请求号取身份上下文，发生时间取注入的时钟。归属与操作人的不同时（员工替商家操作）在入参里另给 `entityId`、`storeId`。客户端平台与版本：上下文对象上带了 `clientPlatform`、`clientVersion` 就写，系统动作一律写空。
- 事件名要在契约的事件目录里且状态是“发出”；聚合类型要在这个事件登记的聚合之内，不带聚合的事件不写 `aggregate`。
- 载荷按契约里这个事件的 schema 校验。**没交 schema 的事件发不出去**：先在 `packages/contract/src/events/` 交 schema，再发。交了 schema 的事件，`payload` 有类型。
- 去重键冲突即该事实已发过：不插、不报错，返回 `{ emitted: false, id: null }`，业务事务照常提交。取法见 x01 第 2.3 节；`tmr:{定时器去重键}` 只用于一次执行只发一条事件的处理器。
- 校验不过抛 `EventEmitError`（`reason` 说明是哪一种），是代码缺陷，不是用户输入的问题。载荷里不得出现的内容（x01 第 2.3 节 P5）这里不扫，由各域 schema 的评审把关。

## 4. 订阅者与展开

- 订阅者由各模块在自己的 `register.ts` 里登记（`subscribers: [{ name, events, handle }]`，见 [kernel/assembly](../kernel/assembly/README.md)）；名字先进契约。本模块没有集中的订阅者文件。
- 展开只按当前装配里登记了处理器的订阅者：契约里有名字、处理器还没落地的，不建投递行。没有订阅者的事件同样写 `published_at`。
- `events.expand()` 自己开事务展开一批（至多 200 条），返回 `{ events, deliveries }`；`events` 小于批量即暂时没有更多。中继循环（W0-23）反复调它。要并进别的事务用 `events.expandPending(tx)`。
- 几个实例同时展开互不重复、互不等待。消费时按名取订阅者：`events.subscribers.get(name)`；关键类看它的 `critical`。

## 5. 测试里怎么用

```ts
import { createSampleEvents, sampleSystemContext } from "@liyoxi/services/testing";

const sample = createSampleEvents(prisma); // 测试装配 + 样例事件 + 三个样例订阅者 + 可拨时钟
await sample.tx.run((tx) => sample.events.emit(tx, sampleSystemContext(), { type: "lyxtest.pinged", payload: { v: 1, n: 1 } }));
```

测试专用的事件与订阅者名字用 `lyxtest.` 前缀，经 `createEvents` 的 `testEvents` 追加，不进契约的正式目录；生产装配不传 `testEvents`，那时 `lyxtest.` 的订阅者按“名字不在契约里”报错。

```sh
pnpm --filter @liyoxi/services exec vitest run src/events/
```

都连库：要本地的 PostgreSQL 与 `DATABASE_URL`（`CLAUDE.md` 第 9 节）。性质测试的轮次与种子用 `LYX_FC_RUNS`、`LYX_FC_SEED`。

## 6. 已知的限度

- `events.I8` 拿事件的发生时间（应用时钟）与数据库时间比；两边的钟差得多时会误报或漏报。每一段至多报最老的 500 条。
- `outbox_event` 的行不可改、不可删（触发器；应用角色连权限都没有），只有 `published_at` 能从空写一次。
- 载荷 schema 管结构，不管 P5 的禁止内容。

## 7. 派发、消费与死信（W0-23）

`dispatch.ts`。循环在 `apps/worker`，这里是它调的用例函数；状态机见 01 分组 第 2.4 节。

| 函数 | 做什么 |
| --- | --- |
| `dispatchDue(deps, { limit?, beat? })` | 派发一轮：认领到期的行（`pending`、`retry` 到点的，`leased` 租约过期的），逐行入队。入队失败时关键类订阅者、或 Redis 已连续不可用满 60 秒的，在进程内直接消费；其余放回 `pending`，不计次数 |
| `consumeDelivery(deps, ref)` | 队列的处理器与进程内执行共用。行锁下比对派发序号，对不上返回 `stale`、不落结果；订阅者的业务写与“已消费”同事务 |
| `claimDeliveries(tx, limit?)` | 只认领，在调用方的事务里 |

- 租约 2 分钟。租约过期且上一次已入队（处理器失联）记一次失败，没入队的不记。
- 失败退避 5 秒、15 秒、1 分、5 分、15 分、30 分，之后每小时；第 10 次进 `dead`，调一次 `alerts.raise`（规则 `outbox.exhausted`，维度 `{事件名}:{订阅者}`，P1），之后不再自动重试。
- 订阅者不认识事件类型（当前装配里没有这个订阅者，或它没订阅这个事件）：延后 5 分钟、不计次数；持续 24 小时后按失败处理。
- 订阅者自己不用做幂等以外的事：同一行被送达多少次，处理函数的写入只提交一次。处理函数里不要有事务外的副作用。
- 任务号 `evt-{事件 id}-{订阅者}-{派发序号}`。

```sh
pnpm --filter @liyoxi/services exec vitest run src/events/dispatch.test.ts
```
