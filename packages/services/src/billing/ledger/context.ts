// 账户锁与账本时钟（W1-10）。依据：07 分组 第 1 节“时间”“加锁”两行、第 2.8 节；D1 第 3.1、7.1 节；硬性规则 10、15。
//
//   1. 账户锁是全事务最后一把锁，一个事务只锁一个主体的。等锁至多 3 秒：只对拿锁那一句设 lock_timeout，
//      等不到抛 ACCOUNT_BUSY（503，可重试），不进 tx.run 的重试（它只重试数据库错误）。
//   2. 账本时钟 = 拿到锁之后取的注入时钟，与该主体上一次操作的时刻取较大者；同一事务再次进入用同一个值。
//   3. 每次进入都真的发一句 FOR UPDATE（已持有时立刻返回）：锁若随保存点回滚丢了，这里会重新拿——
//      同样至多等 3 秒、等不到抛 ACCOUNT_BUSY；时钟再与库里的 last_op_at 比一次，不会倒退。
import { calendarDate } from "@liyoxi/shared/time";
import type { LocalDate } from "@liyoxi/shared/time";

import { AppError, assertLockOrder, lockRows, sqlStateOf } from "../../kernel/index.js";
import type { Clock, Tx } from "../../kernel/index.js";
import { LedgerError } from "./types.js";

/** 等账户锁的上限（03 第 2.8 节） */
export const ACCOUNT_LOCK_WAIT_MS = 3_000;

export interface LedgerClock {
  readonly entityId: string;
  /** 账本时钟：这个事务里对这个主体的全部账本操作共用 */
  readonly now: Date;
  /** now 的北京时间日期 */
  readonly today: LocalDate;
}

export interface AcquireOptions {
  /** timeout（缺省）：等锁至多 3 秒，等不到抛 ACCOUNT_BUSY；skip：被别人占着就不等，返回 null（每分钟扫描用） */
  readonly wait?: "timeout" | "skip";
}

const clocks = new WeakMap<Tx, LedgerClock>();

/** 库里的 date 列与“哪一天”互转：Prisma 把 date 读成 UTC 零点的 Date */
export const toDateColumn = (date: LocalDate): Date => new Date(`${date}T00:00:00.000Z`);
export const fromDateColumn = (value: Date): LocalDate => value.toISOString().slice(0, 10);

/** 没有才建计费账户行。主体创建时由 tenant 经端口调（登记在 W1-11a）；账本进入时发现没有也补一次 */
export async function ensureAccount(tx: Tx, clock: Clock, entityId: string): Promise<void> {
  const now = clock.now();
  await tx.billingAccount.createMany({
    data: [{ entityId, createdAt: now, updatedAt: now }],
    skipDuplicates: true,
  });
}

/** 只对拿账户锁这一句把 lock_timeout 设成 3 秒，之后恢复连接原来的值 */
async function lockWithin(tx: Tx, entityId: string): Promise<string[]> {
  const wait = `${String(ACCOUNT_LOCK_WAIT_MS)}ms`;
  const [timeouts] = await tx.$queryRaw<{ before: string; after: string }[]>`
    SELECT p.before, set_config('lock_timeout', ${wait}, true) AS after
    FROM (SELECT current_setting('lock_timeout') AS before OFFSET 0) p`;
  let locked: string[];
  try {
    locked = await lockRows(tx, "billing_account", [entityId]);
  } catch (error) {
    if (sqlStateOf(error) === "55P03") throw new AppError("ACCOUNT_BUSY", { cause: error });
    throw error;
  }
  if (timeouts && timeouts.before !== timeouts.after) {
    await tx.$queryRaw`SELECT set_config('lock_timeout', ${timeouts.before}, true)`;
  }
  return locked;
}

/**
 * 拿账户锁并取账本时钟。同一事务里换一个主体即抛错（任何环境都抛；local、test 下内核的锁序断言也会拦）。
 * wait: "skip" 而锁被占着（或账户不存在）时返回 null，什么都没锁。
 */
export async function acquireAccount(
  tx: Tx,
  clock: Clock,
  entityId: string,
  options: AcquireOptions = {},
): Promise<LedgerClock | null> {
  const entered = clocks.get(tx);
  if (entered !== undefined && entered.entityId !== entityId) {
    throw new LedgerError("one_account_per_tx", "一个事务只锁一个主体的计费账户", {
      held: entered.entityId,
      wanted: entityId,
    });
  }
  let locked: string[];
  if (options.wait === "skip" || entered !== undefined) {
    // 不等的拿法：没人占着（或本事务已经持有）就拿到；别的事务占着则一行都不返回
    assertLockOrder(tx, "billing_account", [entityId]);
    const free = await tx.$queryRaw<{ id: string }[]>`
      SELECT entity_id::text AS id FROM billing_account
      WHERE entity_id = ${entityId}::uuid FOR UPDATE SKIP LOCKED`;
    if (free.length === 0 && options.wait === "skip") return null;
    // 已经进入过而没拿到：锁随保存点回滚丢了，又被别的事务占着（或账户行是在那个保存点里建的）。
    // 重新拿与第一次一样等至多 3 秒，等不到抛 ACCOUNT_BUSY
    locked = free.length > 0 ? [entityId] : await lockWithin(tx, entityId);
  } else {
    locked = await lockWithin(tx, entityId);
  }
  if (locked.length === 0) {
    // 账户行还没有：补建。刚插入的行别的事务看不见，再锁一遍只为让内核记下这把锁
    await ensureAccount(tx, clock, entityId);
    await lockRows(tx, "billing_account", [entityId]);
  }
  const { lastOpAt } = await tx.billingAccount.findUniqueOrThrow({
    where: { entityId },
    select: { lastOpAt: true },
  });
  const candidates = [entered?.now ?? clock.now(), lastOpAt].filter((at) => at instanceof Date);
  const now = new Date(Math.max(...candidates.map((at) => at.getTime())));
  const ledgerClock: LedgerClock = { entityId, now, today: calendarDate(now) };
  clocks.set(tx, ledgerClock);
  return ledgerClock;
}
