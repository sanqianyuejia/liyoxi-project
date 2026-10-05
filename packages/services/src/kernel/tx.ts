// 事务单元（W0-07）：开事务的唯一入口、带品牌的事务句柄、有限重试与错误映射、保存点、“在事务中”标记。
// 依据：01 第 5 节调用规则 2、3，第 7.1 节；ADR-005、ADR-012；D7 第 2.3 节第 4、5 条，第 8.3 节。
//
//   1. 全仓只有这里调 prisma.$transaction（lint 规则拦别处）。改库的服务函数第一个参数写 tx: Tx；
//      Tx 带品牌，普通 Prisma 客户端传不进去；类型上去掉了 $transaction（Prisma 自带的嵌套事务不让用）。
//      只有用例函数调 run；run 里再 run 即抛错。
//   2. 死锁（40P01）、序列化失败（40001）、锁等待超时（55P03）各重试 TX_RETRIES 次，耗尽报 BUSY（出在提交那一刻的也一样）；
//      事务超时（Prisma P2028）不重试，报 BUSY；语句超时（57014）不重试，报 UPSTREAM_TIMEOUT。
//      重试是把用例函数体整个再跑一遍：函数体里不得有事务外的副作用（发请求、改内存里的共享状态、入队）。
//   3. 提交前探一句 SELECT 1：数据库错误被接住又没回滚到保存点时，PostgreSQL 会把 COMMIT 悄悄当成 ROLLBACK，
//      Prisma 照样报成功。探这一句让它在这里报错，不让用例以为写进去了。
//   4. 事务内不调外部服务：run 用 AsyncLocalStorage 标记“在事务中”，Provider 的入口调 assertNotInTransaction。
//   5. 幂等（W0-13）：run 的选项里给了 required 的幂等上下文，就在同一个事务里先登记幂等行、提交前写回结果；
//      同键重放不执行 fn。不给，或给的是 natural、none 的上下文，行为与原来一样。细则见 idempotency.ts。
import { AsyncLocalStorage } from "node:async_hooks";

import type { PrismaClient } from "@liyoxi/db";

import type { AppEnv } from "./env.js";
import { AppError } from "./errors.js";
import {
  claimIdempotency,
  enterIdempotency,
  settleIdempotency,
  storeIdempotentResult,
} from "./idempotency.js";
import type { IdempotencyContext } from "./idempotency.js";

declare const TX_BRAND: unique symbol;
type Branded = { readonly [TX_BRAND]: true };
/** 借自参考工程 identity.service.ts 的写法：从 $transaction 的回调参数取事务客户端的类型 */
type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
/**
 * 事务句柄。只有 run 给得出来；品牌只在类型上，运行时就是 Prisma 的事务客户端。
 * 类型上去掉了 $transaction：Prisma 7.9.1 的事务客户端自带它（类型上公开；运行时发 SAVEPOINT prisma_sp_N，是保存点式的嵌套事务）。
 * 用了它，内核不知道有这层保存点（锁序记录不跟着退），“开事务只有一个入口”也落空。局部回滚一律走 savepoint。
 * 运行时对象上它还在：硬转成 any 去调拦不住，靠类型、lint 与复审。
 */
export type Tx = Omit<TxClient, "$transaction"> & Branded;

/** D7 第 8.3 节：事务超时 10 秒、等连接 3 秒；批处理声明自己的上限，至多 60 秒（只许在 worker 用） */
export const TX_TIMEOUT_MS = 10_000;
export const TX_MAX_WAIT_MS = 3_000;
export const TX_TIMEOUT_MAX_MS = 60_000;
/** 可重试的错误重试几次（任务书 第 11 节第 1 项） */
export const TX_RETRIES = 1;

export type KernelViolationKind =
  | "nested_transaction"
  | "external_call_in_transaction"
  | "lock_order"
  | "idempotency_context_reused"
  | "idempotency_unused";

/** 违反内核的规矩：嵌套开事务、事务内调外部服务、不按顺序加锁、幂等上下文用了两次或没用 */
export class KernelViolation extends Error {
  readonly kind: KernelViolationKind;

  constructor(kind: KernelViolationKind, message: string) {
    super(message);
    this.name = "KernelViolation";
    this.kind = kind;
  }
}

export interface HeldLock {
  readonly table: string;
  readonly key: string;
  /** 锁的强度，lockRows 记下。自己写加锁 SQL、只调了 assertLockOrder 的不知道强度，不填：按排他算 */
  mode?: "update" | "share";
}

/** 一个事务的运行时状态：挂在句柄上，也放在 AsyncLocalStorage 里 */
export interface TxState {
  /** 用例函数体还在跑；跑完（不论成败）即为 false */
  open: boolean;
  /** 已发出的保存点个数，用来取名 */
  savepoints: number;
  /** 已加的行锁，按加锁先后；锁序断言读写它 */
  readonly held: HeldLock[];
  /** 报一条违规：local、test 抛错；stg、prod 上报后继续（D7 第 2.3 节第 5 条） */
  readonly violate: (violation: KernelViolation) => void;
}

const scope = new AsyncLocalStorage<TxState>();
const states = new WeakMap<object, TxState>();

/** 取句柄上的状态。句柄不是 run 给的（硬转出来的），或事务已经结束，即抛错 */
export function txState(tx: Tx): TxState {
  const state = states.get(tx);
  if (!state?.open) throw new TypeError("这个事务句柄不是 tx.run 给的，或它的事务已经结束");
  return state;
}

/** 当前这段异步调用链是不是在事务里 */
export const isInTransaction = (): boolean => scope.getStore()?.open === true;

/**
 * 外呼断言：Provider 的入口调它（接线在 W0-19、W0-20）。在事务里即违规。
 * @param what 要调的是什么，如 "wechatPay.createOrder"，写进报错
 */
export function assertNotInTransaction(what: string): void {
  const state = scope.getStore();
  if (!state?.open) return;
  state.violate(
    new KernelViolation(
      "external_call_in_transaction",
      `事务内不调外部服务：${what}。必须同步的外部调用写成“先调外部、再开事务”（01 第 5 节调用规则 3）`,
    ),
  );
}

/** 驱动适配器给的数据库错误原因：SQLSTATE 与数据库的原始报错 */
export interface DbErrorCause {
  readonly originalCode?: unknown;
  readonly originalMessage?: unknown;
}

interface DriverAdapterErrorLike {
  readonly name?: unknown;
  readonly cause?: DbErrorCause;
}

/**
 * 取数据库错误的原因。Prisma 7.9.1 加 pg 适配器，连真库查实有两种形状（用例 tx.commit.concurrency.test.ts 钉住）：
 *   - 语句执行时出的错（原生 SQL 与模型查询）：Prisma 包成自己的错误，适配器的错误挂在 meta.driverAdapterError 上；
 *   - 提交那一刻出的错（延迟约束、提交时才判出来的序列化失败与死锁）：COMMIT 由事务管理器直接发给适配器，没有人包，
 *     $transaction 抛出来的就是适配器的 DriverAdapterError 本身（name 是 "DriverAdapterError"，没有 code、meta）。
 * 第二种只认名字对得上的：别的错误碰巧有个带 originalCode 的 cause，不当成数据库错误。
 */
export function dbErrorCause(error: unknown): DbErrorCause | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const wrapped = (error as { meta?: { driverAdapterError?: DriverAdapterErrorLike } }).meta
    ?.driverAdapterError;
  if (wrapped?.cause) return wrapped.cause;
  const bare = error as DriverAdapterErrorLike;
  return bare.name === "DriverAdapterError" ? bare.cause : undefined;
}

/** PostgreSQL 的 SQLSTATE。语句执行时与提交时出的数据库错误都认得出，形状见 dbErrorCause */
export function sqlStateOf(error: unknown): string | undefined {
  const code = dbErrorCause(error)?.originalCode;
  return typeof code === "string" ? code : undefined;
}

const RETRYABLE = new Set(["40P01", "40001", "55P03"]);

/**
 * 是不是 run 会整个重试的数据库错误：死锁、序列化失败、锁等待超时。
 * 保存点里接错误的地方用它把这几种放过去：接住了它们，事务会照常提交、不重试，“请重试”就成了“业务失败”。
 */
export const isRetryableDbError = (error: unknown): boolean =>
  RETRYABLE.has(sqlStateOf(error) ?? "");

/** 归类一条从事务里出来的错误：重试、映射成哪个错误码，或原样抛出 */
function classify(error: unknown): "retry" | "BUSY" | "UPSTREAM_TIMEOUT" | "aborted" | undefined {
  const state = sqlStateOf(error);
  if (isRetryableDbError(error)) return "retry";
  if (state === "57014") return "UPSTREAM_TIMEOUT";
  if (state === "25P02") return "aborted";
  return (error as { code?: unknown })?.code === "P2028" ? "BUSY" : undefined;
}

export interface TxRunnerOptions {
  prisma: PrismaClient;
  /** local、test 下违规即抛错；stg、prod 下上报后继续 */
  appEnv: AppEnv;
  /** stg、prod 下违规往哪报；不给即 console.error。装配方（W0-22、W0-23）接上日志与错误监控 */
  report?: (violation: KernelViolation) => void;
}

export interface TxRunOptions {
  /** 事务超时，毫秒；缺省 TX_TIMEOUT_MS，至多 TX_TIMEOUT_MAX_MS */
  timeoutMs?: number;
  /** 等连接的上限，毫秒；缺省 TX_MAX_WAIT_MS */
  maxWaitMs?: number;
  /**
   * 幂等上下文（W0-13）：路由层按路由元数据建好交进来，一个上下文只给一次 run。
   * required：同事务登记幂等行；同键重放不执行 fn，返回存下的结果，上下文的 replayed 为真。natural、none：只记“用过”。
   */
  idem?: IdempotencyContext;
}

export interface TxRunner {
  /** 开事务跑用例函数体。可重试的错误会让 fn 整个再跑一遍 */
  run<T>(fn: (tx: Tx) => Promise<T>, options?: TxRunOptions): Promise<T>;
}

const backoff = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 60));

export function createTxRunner({ prisma, appEnv, report }: TxRunnerOptions): TxRunner {
  const strict = appEnv === "local" || appEnv === "test";
  const violate = (violation: KernelViolation): void => {
    if (strict) throw violation;
    if (report) report(violation);
    else console.error(violation);
  };

  return {
    async run(fn, options = {}) {
      if (isInTransaction()) {
        throw new KernelViolation(
          "nested_transaction",
          "事务里不能再开事务：只有用例函数调 tx.run，往下传 tx；要局部回滚用 savepoint",
        );
      }
      const timeout = options.timeoutMs ?? TX_TIMEOUT_MS;
      const maxWait = options.maxWaitMs ?? TX_MAX_WAIT_MS;
      if (!(timeout > 0 && timeout <= TX_TIMEOUT_MAX_MS) || !(maxWait > 0)) {
        throw new RangeError(
          `事务超时要在 1 到 ${TX_TIMEOUT_MAX_MS} 毫秒之间，等连接的上限要大于 0`,
        );
      }
      const { idem } = options;
      if (idem && !enterIdempotency(idem)) {
        throw new KernelViolation(
          "idempotency_context_reused",
          "一个幂等上下文只给一次 tx.run：第二个事务会读到第一个事务存下的结果。多事务的用例走三段式",
        );
      }
      const keyed = idem?.mode === "required" ? idem : undefined;
      for (let attempt = 0; ; attempt += 1) {
        try {
          let replayed = false;
          const value = await prisma.$transaction(
            async (client) => {
              const state: TxState = { open: true, savepoints: 0, held: [], violate };
              states.set(client, state);
              try {
                // 品牌只在这里贴：先收窄成带品牌的事务客户端，再当成去掉 $transaction 的句柄给出去
                const handle: Tx = client as TxClient & Branded;
                const result = await scope.run(state, async () => {
                  if (!keyed) return fn(handle);
                  const stored = await claimIdempotency(client, keyed).catch((error: unknown) => {
                    // 等同键的另一个事务超过 3 秒：直接报 BUSY，不进下面的重试（重试会把等待拉长到 3 秒的倍数）
                    if (sqlStateOf(error) !== "55P03") throw error;
                    throw new AppError("BUSY", { cause: error });
                  });
                  replayed = stored !== undefined;
                  if (stored) return stored.result as Awaited<ReturnType<typeof fn>>;
                  const fresh = await fn(handle);
                  await storeIdempotentResult(client, keyed, fresh);
                  return fresh;
                });
                await client.$queryRawUnsafe("SELECT 1");
                return result;
              } finally {
                state.open = false;
              }
            },
            { timeout, maxWait },
          );
          if (idem) settleIdempotency(idem, replayed);
          return value;
        } catch (error) {
          const kind = classify(error);
          if (kind === undefined) throw error;
          if (kind === "retry" && attempt < TX_RETRIES) {
            await backoff();
            continue;
          }
          if (kind === "aborted") {
            throw new Error(
              "事务已被数据库中止：有数据库错误被接住之后没有回滚。要接住数据库错误并接着写，用 savepoint 包住那一段",
              { cause: error },
            );
          }
          throw new AppError(kind === "retry" ? "BUSY" : kind, { cause: error });
        }
      }
    },
  };
}

/**
 * 保存点：fn 抛错时只回滚 fn 里的写入，错误照样抛给调用方；之前的写入、已持有的行锁都还在，事务可以接着用。
 * 发的是原生 SAVEPOINT、ROLLBACK TO SAVEPOINT、RELEASE SAVEPOINT，走事务的同一条连接（V4 的结论见 ADR）。
 * 调用方接住错误时只接业务错误：死锁、锁等待超时这类要让它继续往外抛，由 run 整个重试
 * （拿不准接住的是什么，先问 isRetryableDbError，是就接着抛）。
 * 同一个事务里的语句要一句一句发：保存点期间不要并发地用同一个 tx。
 */
export async function savepoint<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  const state = txState(tx);
  state.savepoints += 1;
  const name = `lyx_sp_${state.savepoints}`;
  const heldBefore = state.held.length;
  await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
  let result: T;
  try {
    result = await fn();
  } catch (error) {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
    // 保存点之后加的行锁随回滚释放，锁序断言的记录跟着退回去
    state.held.length = heldBefore;
    throw error;
  }
  await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
  return result;
}
