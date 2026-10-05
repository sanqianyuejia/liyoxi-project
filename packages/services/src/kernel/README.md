# kernel：事务单元

写操作的地基（W0-07）：开事务的唯一入口、保存点、加锁顺序、时钟、主键、操作人。幂等、审计、事件、状态迁移、定时器都建在它上面。依据：[01](../../../../docs/01-architecture.md) 第 5、7.1 节；[06](../../../../docs/06-data-model.md) 第 3.1–3.3、5 节；ADR-005、ADR-011、ADR-012；保存点的结论见 [ADR](../../../../docs/adr/draft-W0-07-事务内局部回滚用原生保存点-履约留在入账事务内.md)。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `tx.ts` | `createTxRunner`（`run`）、事务句柄 `Tx`、`savepoint`、`assertNotInTransaction`、`isInTransaction`、`sqlStateOf`、`KernelViolation` |
| `errors.ts` | `AppError`：服务层的业务错误，只带契约里的错误符号名 |
| `lock-order.ts` | 加锁顺序常量 `LOCK_ORDER`（照 06 第 5 节逐行写）、锁序断言 `assertLockOrder`。门禁文件 |
| `lock.ts` | 加锁函数 `lockRows` |
| `clock.ts` | `Clock` 接口、`systemClock` |
| `ids.ts` | `uuidv7`、`isUuid` |
| `actor.ts` | 操作人 `Actor`、身份上下文 `IdentityContext` 与两个构造函数，`actorKey`、`actorColumns` |
| `env.ts` | 环境变量的唯一入口（W0-03） |

## 2. 开事务

```ts
const tx = createTxRunner({ prisma, appEnv: env.APP_ENV }); // 装配时建一次

// 用例函数：被路由或任务处理器直接调用的那一层
export async function submitOrder(input: Input) {
  return tx.run(async (handle) => {
    await lockRows(handle, "store", [input.storeId], "share");
    return placeOrder(handle, input); // 改库的服务函数第一个参数是 tx: Tx
  });
}
```

- 全仓只有 `tx.ts` 调 `prisma.$transaction`，别处出现即 lint 失败。`Tx` 带品牌，普通 Prisma 客户端传不进要 `Tx` 的函数。
- 只有用例函数调 `run`。`run` 里再 `run` 抛 `KernelViolation`（任何环境都抛）。
- 超时显式设置：事务 10 秒、等连接 3 秒。批处理在调用处写自己的上限 `run(fn, { timeoutMs })`，至多 60 秒，只许在 worker 用。
- 重试会把函数体整个再跑一遍：函数体里不得有事务外的副作用（发请求、入队、改内存里的共享状态）。
- 提交前探一句 `SELECT 1`：接住了数据库错误又没回滚到保存点时，在这里报“事务已被数据库中止”，不让 `COMMIT` 被悄悄当成 `ROLLBACK`。

从事务里出来的错误：

| 出了什么 | 怎么处理 | 调用方拿到 |
| --- | --- | --- |
| 死锁 `40P01`、序列化失败 `40001`、锁等待超时 `55P03` | 短的随机退避后重试 1 次 | 仍失败：`AppError("BUSY")`，原始错误在 `cause` |
| 事务超时、等不到连接（Prisma `P2028`） | 不重试 | `AppError("BUSY")` |
| 语句超时 `57014` | 不重试 | `AppError("UPSTREAM_TIMEOUT")` |
| 事务已被中止 `25P02` | 不重试 | 普通 `Error`，是代码缺陷：接数据库错误要用保存点 |
| 其余（业务错误、唯一约束冲突等） | 不重试 | 原样抛出 |

## 3. 保存点

```ts
const fulfilled = await savepoint(handle, () => fulfil(handle, order)).catch((error) => {
  if (!(error instanceof FulfilBlocked)) throw error; // 只接业务错误
  return null;
});
```

`fn` 抛错只回滚 `fn` 里的写入，之前的写入与已持有的行锁都还在。死锁、锁等待超时要让它继续往外抛，由 `run` 整个重试。保存点期间不并发地用同一个 `tx`。

## 4. 事务内不调外部服务

Provider 的入口调 `assertNotInTransaction("wechatPay.createOrder")`（接线在 W0-19、W0-20）。在事务里调到它：`local`、`test` 抛 `KernelViolation`；`stg`、`prod` 记 error 并上报（`createTxRunner` 的 `report`，不给即 `console.error`），不抛。必须同步的外部调用写成“先调外部、再开事务”。

## 5. 加锁

- 一个事务锁多行，只用 `lockRows(tx, 表, 主键列表, "update" | "share")`。表限定在加锁顺序表之内；同一张表的多行它自己按主键升序排。返回实际锁到的主键。
- 加锁之前过锁序断言：次序从小到大；同一张表后锁的主键更大；计费账户最后锁，一个事务只锁一个主体的。违规在 `local`、`test` 抛错，`stg`、`prod` 上报后照常加锁。已持有的行再锁一遍不算违规。
- `assignment_cursor` 是复合主键，`lockRows` 不管：取号的地方自己写 SQL，先调 `assertLockOrder(tx, "assignment_cursor", [键])`。
- 新增一张要排序的表：同一个 PR 改 06 第 5 节与 `lock-order.ts`（加一行，属只增）；主键列不叫 `id` 的另在 `lock.ts` 的 `KEY_COLUMN` 加一项。改、删已有的行只在单独的 `gate-change` PR 里做。

## 6. 时钟、主键、操作人

- 业务时间只取注入的 `Clock`；测试里注入 `@liyoxi/services/testing` 的 `createClock()`，它实现 `Clock`。
- 主键用 `uuidv7()`：时间戳取系统时钟（主键不是业务时间），同一进程里严格递增。
- 操作人用 `createActor`，身份上下文用 `createIdentityContext`：不合法的组合构造时即抛 `TypeError`。写普通表的三列用 `actorColumns`（`cli` 只进审计日志，别的表写空），幂等键里的 `actor_key` 用 `actorKey`。

## 7. 跑用例

```sh
pnpm --filter @liyoxi/services exec vitest run src/kernel/                # 全部
pnpm --filter @liyoxi/services exec vitest run src/kernel/tx.savepoint.test.ts
LYX_FC_RUNS=5000 LYX_FC_SEED=42 pnpm --filter @liyoxi/services exec vitest run src/kernel/ids.property.test.ts
```

- 连库的几份（`tx.*`、`external-guard`、`lock-order`、`actor`）走测试支架：要本地的 PostgreSQL 与 `DATABASE_URL`（`CLAUDE.md` 第 9 节）。写的是 `biz_sequence`、`merchant_user`、`outbox_event`、`idempotency_record`，用支架给的缺省身份，不要求超级用户。
- `tx.retry.concurrency.test.ts` 造死锁 20 轮：登录账号是超级用户时把死锁检测调到 20 毫秒，一轮不到 0.1 秒；不是时退回服务器的缺省值 1 秒，照样通过，只是慢 20 秒左右。

## 8. 已知的限度

- 锁序断言只看得到经 `lockRows`、`assertLockOrder` 加的锁。直接 `UPDATE` 拿到的行锁它不知道：多行加锁先 `lockRows` 再改。
- “在事务中”的标记跟着异步调用链走。事务里把活儿交给事务外早就建好的队列或定时器回调，标记带不过去。
- `stg`、`prod` 下两个断言只上报、不拦：靠本地与 CI 的用例把违规拦在合并之前。
- `Tx` 的品牌只在类型上；运行时靠“是不是 `run` 给出的那个对象”认，`txState` 认不出即抛错。
