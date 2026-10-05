// 幂等的三样周边（W0-13）：防漏用、过期清理、natural 路由用的唯一冲突识别。
// 依据：D7 第 3.1 节“防漏用”；01 分组 第 2.1 节；15 分组 第 5.3 节；约定 第 7 节 C47。
import type { AppEnv } from "./env.js";
import type { IdempotencyContext } from "./idempotency.js";
import { dbErrorCause, KernelViolation, sqlStateOf } from "./tx.js";
import type { Tx } from "./tx.js";

export interface IdempotencyGuardOptions {
  /** local、test 下漏用即抛错；stg、prod 下上报后继续 */
  appEnv: AppEnv;
  /** stg、prod 下往哪报；不给即 console.error。与 createTxRunner 的 report 接同一个出口 */
  report?: (violation: KernelViolation) => void;
}

/**
 * 防漏用：required 的路由，处理器成功返回之后调它（接线在 W0-22 的幂等上下文中间件）。
 * 上下文没进过 tx.run，说明用例没有经幂等入口开事务：这次写没有被幂等保护。
 */
export function assertIdempotencyUsed(
  ctx: IdempotencyContext,
  { appEnv, report }: IdempotencyGuardOptions,
): void {
  if (ctx.mode !== "required" || ctx.used) return;
  const violation = new KernelViolation(
    "idempotency_unused",
    `路由 ${ctx.scope} 声明了 x-idempotent: required，处理器却没有把幂等上下文交给 tx.run（写成 tx.run(fn, { idem })）`,
  );
  if (appEnv === "local" || appEnv === "test") throw violation;
  if (report) report(violation);
  else console.error(violation);
}

/** 过期清理单轮删多少行的缺省上限。调度与分批在 ops.retention（15 分组 第 5.3 节） */
export const IDEMPOTENCY_PURGE_LIMIT = 1_000;

/**
 * 删过期的幂等行：只删 expires_at 已过的，按过期先后，单轮不超过 limit；正被别的事务锁着的跳过。返回删了几行。
 * 用数据库时间比（基础设施表，01 分组 第 2 节）。属主模块是 kernel：登记在 register.ts（清理项 kernel.idempotency_record），由 ops.retention 每小时跑。
 */
export async function purgeExpiredIdempotencyRecords(
  tx: Tx,
  limit: number = IDEMPOTENCY_PURGE_LIMIT,
): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("单轮上限要是正整数");
  return tx.$executeRaw`
    DELETE FROM idempotency_record
    WHERE (scope, actor_key, key) IN (
      SELECT scope, actor_key, key FROM idempotency_record
      WHERE expires_at < now()
      ORDER BY expires_at
      LIMIT ${limit}::int
      FOR UPDATE SKIP LOCKED)`;
}

/**
 * 这条错误是不是违反了 constraints 里的某个唯一约束（SQLSTATE 23505）。
 * natural 的路由靠它认“这是重复请求”：只认自己在 x-idempotent-by 里声明的约束名，别的唯一冲突照常抛。
 * 唯一冲突会让事务中止：要接住它接着写，把那一句包在 savepoint 里。
 */
export function isUniqueViolation(error: unknown, constraints: readonly string[]): boolean {
  if (sqlStateOf(error) !== "23505") return false;
  // 驱动适配器不单给约束名，它在数据库的原始报错里。按“一整个标识符”找，不看引号：引号的写法随库的语言设置变。
  // 原因从哪取随错误出在语句执行时还是提交时（延迟的唯一约束）而不同，统一走 dbErrorCause
  const words = String(dbErrorCause(error)?.originalMessage).split(/[^A-Za-z0-9_]+/);
  return constraints.some((name) => words.includes(name));
}
