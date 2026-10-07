import type { Tx, TxRunner } from "../kernel/index.js";
export async function withProbeTimeout<T>(
  work: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let abort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("探针预算耗尽")), ms);
    abort = () => reject(new Error("探针已中止"));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    if (abort !== undefined) signal?.removeEventListener("abort", abort);
  }
}
/** 租约写入放在同一短事务，并持 SHARE 锁：检查后到写入前无法被接任。 */
export async function withPrimaryLease<T>(
  tx: TxRunner,
  holder: string,
  fn: (handle: Tx) => Promise<T>,
): Promise<T | undefined> {
  return tx.run(async (handle) => {
    const held = await handle.$queryRawUnsafe<{ holder: string }[]>(
      `SELECT holder FROM worker_lease WHERE name='primary' AND holder=$1 AND heartbeat_at >= clock_timestamp()-interval '30 second' FOR SHARE`,
      holder,
    );
    if (held.length === 0) return undefined;
    return (await fn(handle)) as T;
  });
}
