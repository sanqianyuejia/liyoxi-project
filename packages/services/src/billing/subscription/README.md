# billing/subscription：付清后的履约

一张已支付的套餐付款单变成“生效或预约的周期 + 月度发放计划 + 首月积分”（W1-11a 的账本侧）。依据：[03](../../../../../docs/03-key-designs.md) 第 1.3、2.3 节；[07 分组](../../../../../docs/data-model/07-billing-ledger.md) 第 2.8–2.11、4.8、5.6 节；D1 第 6.4 节；[ADR-0046](../../../../../docs/adr/0046-事务内局部回滚用原生保存点-履约留在入账事务内.md)；任务书 `docs/plan/tasks/W1-11a.md`。入账函数 `applyPayment`、差异单在本包的第二个 PR（`billing/payment/`）。

## 1. 这里有什么

| 文件 | 内容 |
| --- | --- |
| `fulfill.ts` | `createFulfillment({ clock, events })`：履约的骨架（锁、操作键、保存点、事件） |
| `terms.ts` | 建周期与发放计划，周期不重叠的服务层校验 |
| `blocked.ts` | 保存点里的错怎么归成受阻的原因码；哪些错不算受阻、原样抛出 |
| `invariants.ts` | `billing.I9`、`I10`、`I12` |
| `../ports.ts` | 两个端口的实现：tenant 的计费账户端口、商家读侧事实端口的 `billing` 键（登记在 `../register.ts`） |

## 2. 怎么用

```ts
const fulfillment = createFulfillment({ clock, events }); // 进程装配时建一次，与 createLedger 并排

await tx.run(async (handle) => {
  // 入账函数：先锁付款单（290）、收款交易（300），把付款单置为已支付……
  const { result, replayed } = await fulfillment.fulfill(handle, { billingOrderId, ctx });
  // ……再按 result 写回 fulfillment_status、fulfillment_result、fulfilled_at；blocked 时开差异单
});
```

- 付款单须已是已支付。`fulfill` 自己不改付款单，不写审计。
- 步骤：锁付款单并重读 → 拿账户锁、取账本时钟（这里不推进）→ 操作键 `fulfill:billing_order:{id}` 已登记即返回第一次的结果（`replayed: true`）→ 保存点内：推进 → 核对实收 = 快照应付 → 建周期与发放计划 → 写 `fulfill` 操作行、自检 → 发事件。
- **没有生效周期**：建 `active` 周期，起点 = 账本时钟（不取建单时刻、渠道的支付时间），锚定日 = 当天几号，`origin` 取 `new` 或 `resume`；账户置为生效；首月当场发放，记在入账的操作人名下；过期后重新开通另记一条 `addon_resume`。
- **已有生效周期**：建 `scheduled` 周期接在链尾，起点 = 链尾的止点，锚定日沿用，`origin = renew`，不发首月；到点由 `advance` 接续。结果带 `queuedBehindActive`，`effectiveAt` 是它的起点。
- 发放计划 N 行：分摊 = 实付 ÷ 月数向下取整，尾差在末行；首月批次的成本 = 首行分摊。
- 只读付款单的内容快照（契约的 `billingOrderContentSchema`）与快照指向的价目修订行，不回查现价。
- 订阅事件：开通（含过期后重新开通）记 `activated`，排在后面的记 `renewal_scheduled`，换成档次更低的版本记 `downgrade_scheduled`。出站事件：`billing.subscription.activated`（去重键按周期）或 `billing.subscription.renewal_scheduled`，加 `billing.order_fulfilled`（`ledger:fulfill:billing_order:{id}`）；首月的 `billing.points.granted` 由账本发。

## 3. 受阻与不算受阻

保存点里抛的错回滚到保存点，返回 `{ status: "blocked", reasonCode, detail }`：入账事务照常提交，账本没有残留，账户锁还在手里；修好之后用同一入参再调（操作键没登记过）得到 `done`。

| `reasonCode` | 何时 |
| --- | --- |
| `AMOUNT_MISMATCH` | 付款单的实收 ≠ 快照的应付 |
| `CONSTRAINT_VIOLATION` | 新周期与同主体预约、生效、已到期的周期相交（`detail.problem = term_overlap`，带两个周期）；没有生效周期却挂着预约周期（`scheduled_without_active`）；数据库报完整性约束冲突（`detail.sqlState`） |
| `ADVANCE_FAILED` | 履约开头的推进出错 |
| `SELF_CHECK_FAILED` | 写入时自检不一致 |
| `UNEXPECTED` | 其余：快照不合结构、修订不属于那个套餐、链尾被延长过算不出起止（`term_dates`）、升级与加购的内容（留桩，M4） |

不算受阻、原样抛出、整个入账事务回滚的：死锁、序列化失败、锁等待超时（`tx.run` 会整个重试）；等账户锁超过 3 秒的 `ACCOUNT_BUSY`；连接断开、语句被取消、事务超时；内核的违规断言。付款单没付清即调是代码缺陷，抛 `LedgerError("guard")`。

周期不重叠在建周期前由服务层查，不靠库里的排他约束：它延迟到提交时才检查，等它报出来入账事务已经回滚。约束在不在结果都一样（`overlap.test.ts`）；`billing.I10` 是每日的第二道。

## 4. 测试里怎么用

```ts
import { createFulfillHarness, fulfillOrder, paidPlanOrder, useSeededDatabase } from "@liyoxi/services/testing";

const db = useSeededDatabase("services");
const h = createFulfillHarness(await db.prisma()); // 账本夹具加履约；onStep 在每个写步骤之后调一次
const { entity } = await h.make.merchant({ verified: true });
const order = await paidPlanOrder(h, { entityId: entity.id, months: 3 }); // 已支付、还没履约的套餐付款单
const { result } = await fulfillOrder(h, order); // 自己开一个事务
```

```sh
pnpm --filter @liyoxi/services exec vitest run src/billing/subscription/ src/billing/ports.test.ts
LYX_FC_RUNS=200 LYX_FC_SEED=42 pnpm --filter @liyoxi/services exec vitest run src/billing/subscription/schedule.property.test.ts
```

都连库（带种子的库）。甲类的用例：`fulfill.fault.test.ts`（逐步故障注入、唯一冲突、自检失败、可重试错误、账户锁被占）、`fulfill.concurrency.test.ts`（同一张单四条连接、同主体两张单、与推进交错）、`schedule.property.test.ts`（分摊的性质不连库 200 轮；履约的性质连库，缺省 10 轮、固定种子）。

## 5. 已知的限度

- 升级、加购两种内容不履约，返回 `blocked`（留桩 `docs/plan/stubs/m4-billing-fulfill-upgrade-topup.md`）。
- 链尾被补偿延长过之后再续费：止日的次日不在锚定日上，起止算不出来，按受阻处理；M1 没有延长，做延长时定规则。
- 重放时的结果是照库里的事实还原的（周期、首月批次、优惠占用），不读付款单上存的那一份。
- `billing.I12` 只查套餐与加购两种付款单；升级付款单、已退款付款单的两句随 M4。受阻的付款单有没有未决差异单归付款一侧的 `payment.I4`。
- 计费账户端口的实现拿不到注入的时钟：账户行的时间取主体行的 `created_at`（同一事务里 tenant 按注入的时钟写的）。
