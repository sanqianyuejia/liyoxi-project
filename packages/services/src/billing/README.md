# billing：账本内核

每个主体的积分账本：只增流水、按批次存放、账户行是唯一的锁（W1-10）。这一份交的是“账户与批次”：进入（锁、时钟、推进）、月度发放、加购入账、读函数、每分钟扫描、七条不变量。冻结单一族（`hold`、`capture`、`release`、`refund`、`adjust`）与取整规则在本包的第二个 PR。依据：[07 分组](../../../../docs/data-model/07-billing-ledger.md)；[03](../../../../docs/03-key-designs.md) 第 2 节；D1 第 6.2、7.1、8 节；x01 第 3.7、4.3、5.8 节；任务书 `docs/plan/tasks/W1-10.md`。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `ledger/context.ts` | 账户锁（等锁 3 秒，`ACCOUNT_BUSY`）、账本时钟、`ensureAccount` |
| `ledger/operation.ts` | 一次账本操作的登记与落库：按写入顺序写批次、操作行、流水、账户缓存。账本的写只有这一个出口 |
| `ledger/advance.ts` | 时间推进：到点的发放、期末清零、预约周期接续、过期后加购积分停用 |
| `ledger/self-check.ts` | 写入时自检 |
| `ledger/index.ts` | `createLedger`：对外的账本函数 |
| `pricing/` | 读侧：`paramsAt`（计费参数）、`priceAt`（剧目积分价） |
| `read/` | `getEntitlements`、`getWalletView`、`listOperationsByHold` |
| `sweep.ts` | 每分钟扫描的用例函数 `advanceDueAccounts`（循环 `billing_advance`） |
| `invariants.ts`、`register.ts` | `billing.I1`、`I2`、`I3`、`I6`、`I7`、`I8`、`I16` 的检查与登记 |
| `seed.ts`、`seed-data.ts` | 套餐、价目、参数的种子（W0-21） |
| `subscription/`、`ports.ts` | 付清后的履约（建周期与发放计划、发首月）、`billing.I9`、`I10`、`I12`、两个端口的实现（W1-11a），见 [subscription/README.md](subscription/README.md) |

## 2. 用账本

```ts
const ledger = createLedger({ clock, events }); // 进程装配时建一次；任务进程里 buildWorkerServices 已建

await tx.run(async (handle) => {
  // 先锁本事务要改的已有业务行（付款单、订单项……），最后才进账本：账户锁是全事务最后一把
  const { now } = await ledger.lockAccount(handle, entityId); // 拿锁、取账本时钟、推进
  // …同一事务里写的时间敏感字段（提交时间、同意时间）用这个 now…
  await ledger.purchase(handle, { entityId, billingOrderId, points, payFen, ctx });
});
```

- 账本函数第一个参数是事务句柄，自己不开事务，不写审计（由调用它的用例写）。
- 每个操作同一个骨架：拿账户锁 → 账本时钟 → `advance` → 按操作键查，已登记即返回第一次的结果（`replayed: true`）→ 守卫 → 落库 → 自检 → 发事件。
- **账户锁**：一个事务只锁一个主体的账户，锁第二个即抛 `LedgerError("one_account_per_tx")`。等锁至多 3 秒（只对拿锁那一句设 `lock_timeout`），等不到抛 `AppError("ACCOUNT_BUSY")`（503，可重试），不进 `tx.run` 的重试。
- **账本时钟**：拿到锁之后取注入的时钟，与该主体上一次操作的时刻取较大者；同一事务再次进入用同一个值。流水的 `occurred_at`、`biz_date` 用它；到点类操作用逻辑时间（发放 = 应发时刻，清零 = 周期止点、业务日 = 止日）。
- 没有计费账户行的主体，进入时会补建；正常情况下主体创建时由 tenant 经端口建（端口实现由 W1-11a 登记，调 `ledger.ensureAccount`）。
- 账本的内部错误是 `LedgerError`（`reason`：`guard`、`op_key_conflict`、`term_chain`、`self_check`、`one_account_per_tx`），都是代码缺陷或数据异常，按 500 处理；业务上的拒绝是 `AppError`。

| 函数 | 做什么 | 操作键 |
| --- | --- | --- |
| `lockAccount(tx, entityId)` | 拿锁、取时钟、推进；返回 `{ entityId, now, today }` | — |
| `advance(tx, entityId, { wait? })` | 推进到现在；`wait: "skip"` 而账户被占着时返回 `null` | — |
| `grant(tx, { grantScheduleId, ctx? })` | 月度发放。到点的发放 `advance` 会自己做；履约建好周期后发首月调它，`ctx` 把这一笔记在入账的操作人名下 | `grant:grant_schedule:{id}` |
| `purchase(tx, { entityId, billingOrderId, points, payFen, ctx })` | 加购入账：新建长期有效的加购批次，成本 = 实付。套餐已过期也照常入账（停用） | `purchase:billing_order:{id}` |
| `refreshNextDue(tx, entityId)` | 重算 `next_due_at`。建周期、改发放计划的一方在自己的写入之后调（`grant` 已含） | — |
| `ensureAccount(tx, entityId)` | 没有才建账户行 | — |

推进里发生的操作：期末清零 `expire:subscription_term:{id}:{止日}`、过期停用 `suspend:subscription_term:{id}:{止日}`。

## 3. 时间推进

到点的事只在 `advance` 里发生，按逻辑时间的先后一件一件做，幂等、可追赶：

1. 当前周期里已到应发时刻的发放计划 → 发放（新建套餐批次，到期 = 周期止点，成本 = 该月分摊的套餐款）。
2. 周期到了止点 → 清零（“可用”移到“已清零”，冻结留在原批次），周期置为已到期。
3. 有预约周期 → 接续生效（下一轮发它的首月）；没有 → 订阅过期，写 `addon_suspend`，加购积分停用（闸门关上，批次数量不动）。

调用点两个：每个账本写操作的开头；任务进程的循环 `billing_advance` 每分钟扫 `next_due_at` 已到的主体（`FOR UPDATE SKIP LOCKED`，被占着的跳过；一个主体出错不影响别的，经告警端口报 `billing.advance_failed`，它的 `next_due_at` 不前进，下一轮再试）。

发的事件：`billing.points.granted`（去重键 `billing.points.granted:{发放计划 id}`）、`billing.points.purchased`、`billing.points.expired`（`billing.points.expired:{周期 id}`，清零数为 0 不发）、`billing.subscription.rolled_over`、`billing.subscription.expired`。

## 4. 读函数

都不拿账户锁、不推进、不写库；时刻由调用方给（注入时钟的现在）。

| 函数 | 给什么 |
| --- | --- |
| `getEntitlements(db, entityId, at)` | 订阅状态（按周期起止现算，不读 `sub_status`）、是否退款处理中、生效周期与权益快照 |
| `getWalletView(db, entityId, at)` | m07 第 2.7 节 `Wallet` 的 `subscription`、`points` 两段。积分从批次现算：到点还没推进时，该清零的不显示成可用 |
| `listOperationsByHold(db, pointHoldId)` | 一张冻结单的账本操作，按写入先后 |
| `paramsAt(db, at)` | 时刻 `at` 生效的十二个计费参数（值的结构在契约 `BILLING_PARAM_VALUES`） |
| `priceAt(db, dramaIds, at)` | 剧目积分价：单剧修订优先，否则取该剧热度等级的模板价；取不到时给原因（`no_tier`、`no_template`、`not_found`） |

## 5. 自检与不变量

- 每个账本操作提交前，对当前主体从批次重算：七个桶、账户缓存、冻结中的冻结单合计、操作行上的“操作后可花、操作后冻结”。不一致抛 `LedgerError("self_check")` 回滚，不上报、不自愈。
- 工厂直接插的冻结单（`make.pointHold`、`make.orderItem`）不动账本：对这样的主体调账本函数会被自检拦下。要自洽的数据，积分一律经账本函数入账。
- 七条不变量由 ops 的 `invariant.full` 每日跑，`heal: "none"`。`I4`、`I5` 随冻结一族；`I9`–`I13`、`I15`、`I17` 随履约与 M4。

## 6. 测试里怎么用

```ts
import { createLedgerHarness, dumpLedger, openTerm, topUp, useSeededDatabase } from "@liyoxi/services/testing";

const db = useSeededDatabase("services");
const h = createLedgerHarness(await db.prisma()); // 账本 + 真实的事件目录 + 可拨时钟 + 工厂
const { entity } = await h.make.merchant({ verified: true });
const { term } = await openTerm(h, { entityId: entity.id, months: 3 }); // 生效的一期，首月已发
await openTerm(h, { entityId: entity.id, after: term }); // 接在后面的预约周期
await topUp(h, { entityId: entity.id, points: 1000 }); // 加购入账
h.clock.set(term.endsAt);
await h.tx.run((tx) => h.ledger.advance(tx, entity.id));
expect((await dumpLedger(h.prisma, entity.id)).account.planAvailableQty).toBe(0);
```

夹具在 `packages/services/src/testing/billing.ts`（依赖规则只许模块之间引入口文件，所以不放在本目录）。建周期与发放计划是履约的事（W1-11a）；它合并之前用 `openTerm` 造。`joinLedger` 另开一条独立连接，并发用例里一条连接算一方；`createLedgerHarness` 的 `onStep` 在每个写步骤之后调一次（故障注入）。

```sh
pnpm --filter @liyoxi/services exec vitest run src/billing/
pnpm --filter @liyoxi/worker exec vitest run test/billing-advance.test.ts
```

都连库（带种子的库），要本地的 PostgreSQL 与 `DATABASE_URL`；任务进程的那一份另要 Redis（`CLAUDE.md` 第 9 节）。

甲类的用例：`ledger/account-lock.concurrency.test.ts`（等锁 3 秒）、`ledger/advance.concurrency.test.ts`（两个扫描并行、跨零点等锁）、`ledger/fault.test.ts`（逐步故障注入）、`ledger/advance.property.test.ts`（性质测试：任取开通日、周期、预约周期、加购与推进的时刻，余额等于按周期起止算出的参考值，多推进多少次结果都一样，七条不变量 0 违规）。性质测试连库，缺省 10 轮、固定种子，要多跑：

```sh
LYX_FC_RUNS=200 LYX_FC_SEED=42 pnpm --filter @liyoxi/services exec vitest run src/billing/ledger/advance.property.test.ts
```

## 7. 已知的限度

- `billing.points.expired` 的去重键照 x01 写成按周期的：周期被延长复活后再次到期（M4）会被当成已发过。做延长的包（G4-A）要把它改成带止日的。
- 清零数为 0 时仍写清零操作（幂等登记、账户上记“最近一次清零 0”），但不发 `billing.points.expired`。
- 读函数给的是“到点之后的样子”，不是推进之后的结果：到点还没推进的那一分钟里，新一期的首月发放还看不到。
- `advance` 一次至多做 500 件事（防数据异常时空转）；超过即抛错，这个主体的账本操作都会失败，要人工看。
- 预约周期没有接在上一期的止点上（`term_chain`）时不接续、直接抛错：宁可拒绝服务，也不带着对不上的周期继续记账。
