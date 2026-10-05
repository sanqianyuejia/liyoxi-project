// ops 的运行时绑定（W0-24）：周期任务的处理器与上报端口的实现登记在 register.ts 里，那里是静态的，
// 拿不到数据库连接、时钟与装配结果。进程装配时（createRuntime、buildWorkerServices）建好这些之后调 bindOps 绑上。
// 一个进程一份：后绑的顶掉先绑的。没绑时处理器抛错、上报端口只记日志（kernel 的外壳吞掉）。
import type { Assembly, Clock, TxRunner } from "../kernel/index.js";

/** 能直接发一条语句的东西：Prisma 客户端（自动提交）或事务句柄 */
export interface SqlRunner {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

export interface OpsBinding {
  /** 连接池：上报端口用它直接发一条语句，不加入调用方的事务（15 分组 第 5.2 节） */
  readonly db: SqlRunner;
  readonly tx: TxRunner;
  readonly clock: Clock;
  readonly assembly: Assembly;
}

let current: OpsBinding | undefined;

/** 绑上；返回解绑函数（只解自己绑的那一份） */
export function bindOps(binding: OpsBinding): () => void {
  current = binding;
  return () => {
    if (current === binding) current = undefined;
  };
}

export const boundOps = (): OpsBinding | undefined => current;

/** 取绑定；没绑即抛错 */
export function requireOps(what: string): OpsBinding {
  if (current === undefined) {
    throw new Error(`${what}：ops 还没有绑定运行时（进程装配时调 bindOps）`);
  }
  return current;
}
