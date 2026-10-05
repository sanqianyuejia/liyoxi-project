# kernel：事务单元

写操作的地基（W0-07）：开事务的唯一入口、保存点、加锁顺序、时钟、主键、操作人。幂等、审计、事件、状态迁移、定时器都建在它上面。依据：[01](../../../../docs/01-architecture.md) 第 5、7.1 节；[06](../../../../docs/06-data-model.md) 第 3.1–3.3、5 节；ADR-005、ADR-011、ADR-012；保存点的结论见 [ADR](../../../../docs/adr/0046-事务内局部回滚用原生保存点-履约留在入账事务内.md)。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `tx.ts` | `createTxRunner`（`run`）、事务句柄 `Tx`、`savepoint`、`assertNotInTransaction`、`isInTransaction`、`sqlStateOf`、`dbErrorCause`、`isRetryableDbError`、`KernelViolation` |
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

- 全仓只有 `tx.ts` 调 `prisma.$transaction`，别处出现即 lint 失败。`Tx` 带品牌，普通 Prisma 客户端传不进要 `Tx` 的函数。`Tx` 的类型去掉了 `$transaction`：Prisma 7 的事务客户端自带它（保存点式的嵌套事务），在句柄上调它编译不过，局部回滚只走 `savepoint`（[ADR-046](../../../../docs/adr/0046-事务内局部回滚用原生保存点-履约留在入账事务内.md)“放弃的备选”）。
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

错误出在提交那一刻（延迟到提交时检查的约束、可串行化事务提交时才判出的序列化失败、提交时的死锁）也按上表办。这时 Prisma 抛出来的是驱动适配器的 `DriverAdapterError` 本身，不是包过一层的 Prisma 错误（没有 `code`、`meta`）：读 SQLSTATE 一律用 `sqlStateOf(error)`，读数据库的原始报错用 `dbErrorCause(error)?.originalMessage`，不要自己去翻 `error.meta`。两种形状由 `tx.commit.concurrency.test.ts` 连真库钉住。

## 3. 保存点

```ts
const fulfilled = await savepoint(handle, () => fulfil(handle, order)).catch((error) => {
  if (!(error instanceof FulfilBlocked)) throw error; // 只接业务错误
  return null;
});
```

`fn` 抛错只回滚 `fn` 里的写入，之前的写入与已持有的行锁都还在。死锁、锁等待超时要让它继续往外抛，由 `run` 整个重试。保存点期间不并发地用同一个 `tx`。

接错误之前想清楚接的是什么：保存点里出了死锁、序列化失败、锁等待超时，被调用方接住的话，事务照常提交、不重试，内核不兜。失败有业务含义的（付款履约）只接自己的业务错误，或先问 `isRetryableDbError(error)`、是就接着抛；失败不该带累业务事务的（埋点直记）可以全接。

## 4. 事务内不调外部服务

Provider 的入口调 `assertNotInTransaction("wechatPay.createOrder")`（接线在 W0-19、W0-20）。在事务里调到它：`local`、`test` 抛 `KernelViolation`；`stg`、`prod` 记 error 并上报（`createTxRunner` 的 `report`，不给即 `console.error`），不抛。必须同步的外部调用写成“先调外部、再开事务”。

## 5. 加锁

- 一个事务锁多行，只用 `lockRows(tx, 表, 主键列表, "update" | "share")`。表限定在加锁顺序表之内（类型限定，运行时再核对一遍，表外的名字不会拼进 SQL）；同一张表的多行它自己按主键升序排。返回实际锁到的主键。
- 加锁之前过锁序断言：次序从小到大；同一张表后锁的主键更大；计费账户最后锁，一个事务只锁一个主体的。违规在 `local`、`test` 抛错，`stg`、`prod` 上报后照常加锁。已持有的行再锁一遍不算违规；把共享锁升级成排他锁除外，它是一次新的等锁，按新加的锁再查一遍：之后锁过次序更大的表、或同一张表里主键更大的行，即违规。要改的行一开始就用 `update` 锁。
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
- 锁的强度只有 `lockRows` 记。自己写加锁 SQL、只调了 `assertLockOrder` 的行不知道强度，按排他算。两个事务都持有同一行的共享锁、又都要升级，会互相等死，这与加锁次序无关，断言管不了：数据库判死锁后由 `run` 重试。
- 在句柄上硬转去调 Prisma 自带的 `$transaction`（运行时对象上它还在），那层保存点内核不知道：它回滚时锁序记录不跟着退，之后的加锁会被误报。
- 重试是把函数体整个再跑一遍：事务外的副作用会做两遍（内存里的计数；`stg`、`prod` 下没被拦住的外呼会发两次、上报两次）。Provider 入口接线时留意（W0-19、W0-20）。
- 批处理的 60 秒上限“只许在 worker 用”（D7 第 8.3 节）：`run` 不知道自己在哪个进程，只查 `timeoutMs` 不超过 60 秒、`maxWaitMs` 大于 0。谁可以传大于 10 秒的值，归 api、worker 的装配（W0-22、W0-23）与复审把关。
- “在事务中”的标记跟着异步调用链走。事务里把活儿交给事务外早就建好的队列或定时器回调，标记带不过去。
- `stg`、`prod` 下两个断言只上报、不拦：靠本地与 CI 的用例把违规拦在合并之前。
- 品牌、去掉的 `$transaction` 都只在类型上。挡得住的：直接传普通客户端或 Prisma 给 `$transaction` 回调的那个事务客户端、把这两样 `as Tx` 单步强转、手拼一个对象传进去、在句柄上写 `$transaction`。挡不住的：`as unknown as Tx`、`any`、`{} as Tx`。强转出来的句柄调 `lockRows`、`savepoint` 会抛 `TypeError`，但直接走模型接口写是“写进去了、没有事务”。事务结束后留着的旧句柄：内核函数抛 `TypeError`，直接写被 Prisma 以 `P2028` 拒绝。改库的函数不要句柄、直接拿普通客户端写，类型与 lint 都不拦。这几条靠复审。
- lint 规则拦的是顺手写出来的 `$transaction`（成员访问、方括号、解构、字符串与模板字面量当键）；字符串拼接、`Reflect` 加拼出来的键、裸发 `BEGIN` 拦不住。别的包给某些路径另配一条 `no-restricted-syntax` 会把它整条盖掉：要把 `txEntryRestrictedSyntax` 拼进去（`packages/config/eslint/tx.js`）。
- `Tx` 的品牌只在类型上；运行时靠“是不是 `run` 给出的那个对象”认，`txState` 认不出即抛错。

## 9. 幂等（W0-13）

依据：[约定](../../../../docs/api/00-conventions.md) 第 7 节 C47–C50；[01 分组](../../../../docs/data-model/01-kernel-flow.md) 第 2.1、4 节。文件：`request-hash.ts`（键的格式、请求哈希）、`idempotency.ts`（上下文、登记与重放、结果脱敏）、`idempotency-tools.ts`（防漏用、过期清理、唯一冲突识别）。

```ts
// 路由层（W0-22 的中间件）按路由元数据建上下文，一次请求一个
const idem = createIdempotencyContext({
  mode: route["x-idempotent"], // required / natural / none
  scope: route.operationId,
  actor, // 下载页的请求给授权它的商家用户
  key: header("Idempotency-Key"),
  request: { method, pathParams, body, storeId }, // 商家端给 storeId（X-Store-Id）
  redact: route["x-redact-on-replay"],
});

// 用例函数：把上下文交给 tx.run
const result = await tx.run((handle) => placeOrder(handle, input), { idem });
// idem.replayed：这次是不是重放（中间件据此回 Idempotent-Replayed 头）

// 处理器成功返回之后（中间件里）
assertIdempotencyUsed(idem, { appEnv: env.APP_ENV, report });
```

| 情形 | 结果 |
| --- | --- |
| `required` 缺键或键的格式不对 | 建上下文时抛 `IDEMPOTENCY_KEY_REQUIRED` |
| 第一次 | 同事务先插幂等行（`state = 'done'`），执行 `fn`，提交前写回 `result` |
| `fn` 抛错 | 事务回滚，行不留；同一个键可以直接重试，改了输入也行 |
| 同键重放 | 不执行 `fn`，返回存下的结果；`idem.replayed` 为真 |
| 同键、请求哈希不同（内容或门店变了） | `IDEMPOTENCY_KEY_REUSED` |
| 同键并发 | 后到者阻塞在主键上，前者提交后读到同一份结果；前者回滚，后到者接着正常执行 |
| 等同键的事务超过 3 秒 | `BUSY`，不进 `run` 的重试 |
| 读到 `in_progress` 的行（三段式，W0-20） | `IDEMPOTENCY_IN_PROGRESS` |
| `natural`、`none` | 不读写幂等表，只记“用过” |

- 一个 `required` 的上下文只给一次 `run`，第二次抛 `KernelViolation`。一个用例要开两个事务的，走三段式（W0-20）。
- 存的是 `fn` 的返回值（角色裁剪之前的 DTO），要能 JSON 序列化：重放拿到的是它经 JSON 往返之后的样子（`Date` 变成字符串）。没有返回值就不存，重放得到 `undefined`。密文、验证码这类不该留库的内容不要放进返回值。
- 结果脱敏：`redact` 里的路径（`payParams`、`items[].posterUrl`、`bankAccount.accountNo` 这几种写法）在写入之前置为 `null`，首次的返回值不动；重放的结果里这些字段是 `null`，另带 `replayed: true`。字段不在就不动，不凭空添键。没登记脱敏路径的路由，重放的结果不加 `replayed`。
- 请求哈希：`sha256` 算在 `[方法（大写）, 路径参数, 请求体, storeId]` 规范化之后的 JSON 上。规范化 = 对象的键排序、去掉值为 `undefined` 的键、数组顺序不变。
- 等锁的 3 秒只对登记那一句设（`SET LOCAL`），之后恢复连接原来的 `lock_timeout`。
- 行过了 `expires_at` 而还没被清理删掉时，仍按有效的记录重放。
- 过期清理：`purgeExpiredIdempotencyRecords(tx, limit)` 只删 `expires_at` 已过的行，单轮缺省至多 1,000 行，返回删了几行。已登记成清理项 `kernel.idempotency_record`（`register.ts`），由 `ops.retention` 每小时调一轮（W0-24）。
- `natural` 的路由自己按约束名处理：`isUniqueViolation(error, ["uq_…"])` 认出“撞的是我声明的那个唯一约束”。唯一冲突会让事务中止，那一句要包在 `savepoint` 里。

## 10. 业务单号（W0-13）

依据：[01 分组](../../../../docs/data-model/01-kernel-flow.md) 第 2.2 节。文件：`biz-no.ts`。

```ts
const bizNo = createBizNoIssuer({ clock, appEnv: env.APP_ENV }); // 装配时建一次

// 改库的服务函数里，在自己的事务里取号
const orderNo = await bizNo.next(tx, "LYX"); // LYX2026010500001
```

- 单号 = 前缀 + `yyyyMMdd` + 流水。业务日按北京时间取注入的时钟；流水按“前缀 + 业务日”从 1 起。
- 11 种前缀与最少流水位数：`LYX`、`FK` 5 位；`GG`、`KF`、`TK`、`TZ`、`YQ`、`ZH`、`KP`、`CY`、`DC` 3 位。不足补 0，超出自动扩位。类型 `BizNoPrefix` 只收这 11 个。
- 预发环境（`APP_ENV=stg`）的单号最前面加 `T`；`biz_sequence.prefix` 存不带 `T` 的前缀。
- 取号与业务写同事务：回滚不留空号。取号的行锁持有到提交，同前缀同日的取号因此串行，取号放在事务里靠后的位置。`biz_sequence` 不参与锁排序。
- `JF`、`SQ` 由订购单号派生，`RZ` 由数据库序列生成，都不经这里。只要拼格式用 `formatBizNo`。

## 11. 三段式用例（W0-20）

依据：[约定](../../../../docs/api/00-conventions.md) 第 7 节 C51；[01 分组](../../../../docs/data-model/01-kernel-flow.md) 第 2.1 节的状态机；D7 第 3.1 节。文件：`three-phase/three-phase.ts`；幂等行的占用、抢占、写回、释放在 `idempotency.ts` 末尾。事务外必须调外部服务的用例都这样写：

```ts
const threePhase = createThreePhaseRunner({ tx, clock }); // 装配时建一次

// 用例函数：不在事务里调
const result = await threePhase.run(
  {
    claim: (handle, { resumed }) => getOrCreateAttempt(handle, input), // 事务一：记业务意图
    external: (attempt) => prepay(providers.wechatPay, attempt.outTradeNo), // 事务外：调外部
    settle: (handle, outcome, attempt) => saveResult(handle, attempt, outcome), // 末个事务：落结果
    compensate: (handle, attempt, { error, phase }) => closeAttempt(handle, attempt), // 业务失败时
  },
  { idem }, // 与 tx.run 的 idem 是同一个上下文，一个上下文只给一次
);
```

| 情形 | 结果 |
| --- | --- |
| 第一次 | 事务一：占用（`in_progress`，`locked_until` = 注入的时钟 + 30 秒）与 `claim` 一起提交 → 事务外 `external` → 末个事务：占用改 `done`、`settle`、存结果 |
| 同键、请求哈希不同 | `IDEMPOTENCY_KEY_REUSED`，不占用、不外呼（占用过期了也一样） |
| 同键、已完成 | 重放存下的结果，三段都不执行；`idem.replayed` 为真，脱敏与 `replayed: true` 同第 9 节 |
| 同键、占用未过期 | `IDEMPOTENCY_IN_PROGRESS`（可重试；端上 1 秒后重试、至多 5 次是请求层的事） |
| 同键、占用已过期 | 条件更新抢占，同时到的只有一个抢到；`claim` 再执行一遍（`resumed` 为真），然后照常外呼、落结果 |
| 用例在 `external`、`settle` 里抛 `AppError`（业务失败） | 另开事务删掉占用、执行 `compensate`，错误原样抛出；同一个键可以直接重试 |
| 其余的错误（进程中断、程序错误、事务机制报的 `BUSY` 与超时） | 什么都不收拾，原样抛出；占用留到过期，由重复请求续做 |
| `claim` 抛错 | 事务一回滚，意图与占用都不留 |
| 幂等为 `none`、`natural`，或不给 `idem` | 同一条流水，不读写幂等记录：没有占用、续做与重放 |

写用例时要守的几条：

- 写成可续做。`external` 用业务侧稳定的外部幂等号（商户单号、退款单号），工具不替用例生成；`claim` 写成“取得或新建”；需要先查再呼的，在 `external` 里自己查。
- “外部明确没办成”才抛 `AppError`；不知道对方办没办成（超时、连接断开）要么原样抛出等续做，要么确认外部侧同号幂等之后再包成业务失败。
- `external` 自己的超时要明显短于 30 秒。占用过期被别的请求接手之后，原来那一方就写不回、也补偿不了：接手的一方已写完时它拿到同一份结果，还没写完时它得到 `IDEMPOTENCY_IN_PROGRESS`。
- 三种形态（约定 C51）只是用法不同。先调外部：不写 `claim`。先落库：`claim` 落本地行，`compensate` 删行或标失败。多事务：`claim` 落的技术状态在业务失败时不回滚，要标记写在 `compensate` 里。
- `threePhase.run` 在事务里调即抛 `KernelViolation`；`claim`、`settle`、`compensate` 里不许调 Provider。
- 外呼前钩子：进程装配与测试装配把 `guardProviderCall` 交给 Provider 工厂，`createProviders({ …, beforeCall: guardProviderCall })`、`createFakeProviders({ beforeCall: guardProviderCall })`。在事务里调任何 Provider 方法，`local`、`test` 下抛错且请求发不出去，`stg`、`prod` 上报后照常调（第 4 节）。
- 同键的另一个占用还没提交时，后到者等它；等多久由连接自己的 `lock_timeout` 管，超时按第 2 节的表处理。

样例用例在 `@liyoxi/services/testing` 的 `samplePrepay`（探针表 `lyx_sample_prepay` 上的“预下单尝试”，外部是假微信支付）：三种形态各一条，只给测试用。用例在 `three-phase/`：外呼前、中、后中断三份，形态、并发抢占、事务内外呼各一份，另有一份性质测试（连库，缺省 40 轮，`LYX_FC_RUNS`、`LYX_FC_SEED` 可改）。

## 12. 乐观锁（W0-20）

依据：[约定](../../../../docs/api/00-conventions.md) 第 7 节 C52、C53；[06](../../../../docs/06-data-model.md) 第 3.3 节。文件：`optimistic-lock/lock-version.ts`。内容编辑先过版本关，再改内容：

```ts
return tx.run(async (handle) => {
  const lockVersion = await bumpLockVersion(handle, {
    table: "point_pack",
    id: input.id,
    expected: input.lockVersion, // 读详情时拿到的版本
  });
  await handle.pointPack.update({ where: { id: input.id }, data: { priceFen: input.priceFen } });
  return { id: input.id, lockVersion };
});
```

- 版本关是一条带版本条件的更新：相符则版本加 1 并拿住这一行，返回新版本；不相符抛 `VERSION_CONFLICT`，`details` 是 `{ lockVersion: 最新值 }`；行不存在抛 `NOT_FOUND`。两个事务拿同一个版本来改，只过得去一个。
- 可指定的三样：`column`（锁列，缺省 `lock_version`；`delivery_plan` 的第二把锁写 `draft_lock_version`）、`key`（主键列与类型，缺省 `{ column: "id", type: "uuid" }`；自然主键写 `type: "text"`）、`field`（`details` 里的字段名，缺省由列名转小驼峰；比对父剧目版本时写 `dramaLockVersion`）。
- 只管内容编辑。状态迁移用行锁加状态守卫（`flow.transition()`），不走这里；`param_value` 的逐项修订号比的是“每个键最新一行”，由领域自己写。
- 表名、列名只写代码里的常量（会再过一遍小写蛇形的校验）；请求里的版本先由路由的 Zod 结构把关，传进来不是非负整数即抛 `TypeError`。

## 13. 队列（W0-23）

`queue/` 是全仓唯一引 BullMQ 的地方（兼容脚本除外）。BullMQ 只是执行通道：任务一律 `attempts: 1`，重试、到期、租约都在数据库行上。

```ts
const channel = createQueueChannel({ redisUrl: env.REDIS_URL, prefix: bullPrefix(env.APP_ENV) }); // 键前缀 lyx:{env}:bull
await channel.enqueue("outbox_delivery", jobId, { eventId, subscriber, dispatchNo }); // 提交之后调；事务里调即违规
const consumer = channel.consume<DeliveryRef>("outbox_delivery", 4, (ref) => consume(ref));
consumer.start();
```

- 队列名取契约的登记（`@liyoxi/contract/registry` 的 `QUEUES`）。
- 入队快速失败：连接没就绪、命令超过 500 毫秒、总共超过 2 秒，都立刻抛错，不排队等。入队报错不等于任务没进去，所以消费的一方必须按派发序号认（`events`、`timers` 都是）。
- `channel.downForMs()`：Redis 已连续不可用多久。满 `REDIS_DOWN_FALLBACK_MS`（60 秒）后非关键类也在进程内执行。
- 连接参数（重试次数、超时）写死在 `channel.ts`，是降级设计的一部分，不做成配置。
- 用例：`pnpm --filter @liyoxi/services exec vitest run src/kernel/queue/`，要本地的 Redis 与 PostgreSQL。
