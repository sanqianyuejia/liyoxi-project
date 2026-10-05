// 事务单元（W0-07）：开事务的唯一入口、带品牌的事务句柄、保存点、“在事务中”标记。
// 依据：01 第 5 节调用规则 2、3，第 7.1 节；ADR-005、ADR-012；D7 第 2.3 节第 4、5 条，第 8.3 节。
//
//   1. 全仓只有这里调 prisma.$transaction（lint 规则拦别处）。改库的服务函数第一个参数写 tx: Tx；
//      Tx 带品牌，普通 Prisma 客户端传不进去。只有用例函数调 run；run 里再 run 即抛错。
//   2. 提交前探一句 SELECT 1：数据库错误被接住又没回滚到保存点时，PostgreSQL 会把 COMMIT 悄悄当成 ROLLBACK，
//      Prisma 照样报成功。探这一句让它在这里报错，不让用例以为写进去了。
import { AsyncLocalStorage } from "node:async_hooks";

import type { PrismaClient } from "@liyoxi/db";

import type { AppEnv } from "./env.js";

declare const TX_BRAND: unique symbol;
/** 借自参考工程 identity.service.ts 的写法：从 $transaction 的回调参数取事务客户端的类型 */
type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
/** 事务句柄。只有 run 给得出来；品牌只在类型上，运行时就是 Prisma 的事务客户端 */
export type Tx = TxClient & { readonly [TX_BRAND]: true };

/** D7 第 8.3 节：事务超时 10 秒、等连接 3 秒；批处理声明自己的上限，至多 60 秒（只许在 worker 用） */
export const TX_TIMEOUT_MS = 10_000;
export const TX_MAX_WAIT_MS = 3_000;
export const TX_TIMEOUT_MAX_MS = 60_000;

export type KernelViolationKind =
  "nested_transaction" | "external_call_in_transaction" | "lock_order";

/** 违反内核的规矩：嵌套开事务、事务内调外部服务、不按顺序加锁 */
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
}

export interface TxRunner {
  /** 开事务跑用例函数体 */
  run<T>(fn: (tx: Tx) => Promise<T>, options?: TxRunOptions): Promise<T>;
}

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
      return prisma.$transaction(
        async (client) => {
          const state: TxState = { open: true, savepoints: 0, held: [], violate };
          states.set(client, state);
          try {
            const result = await scope.run(state, () => fn(client as Tx));
            await client.$queryRawUnsafe("SELECT 1");
            return result;
          } finally {
            state.open = false;
          }
        },
        { timeout, maxWait },
      );
    },
  };
}

/**
 * 保存点：fn 抛错时只回滚 fn 里的写入，错误照样抛给调用方；之前的写入、已持有的行锁都还在，事务可以接着用。
 * 发的是原生 SAVEPOINT、ROLLBACK TO SAVEPOINT、RELEASE SAVEPOINT，走事务的同一条连接（V4 的结论见 ADR）。
 * 调用方接住错误时只接业务错误：死锁、锁等待超时这类要让它继续往外抛，由 run 整个重试。
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
