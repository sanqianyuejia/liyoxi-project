// 任务进程的单活租约（W0-23）：续约、抢占与让出。依据：15 分组 第 2.2 节（续约写法）；D7 第 7.6 节。
// 谁持有 worker_lease 的那一行谁干活。租约只为减少重复劳动、保持并发上限准确，不是正确性的前提。
//
//   1. 时间一律用数据库的 clock_timestamp()：两台机器的钟不一致时仍然只有一个口径。
//   2. 续约用专用连接（一条，statement_timeout 3 秒），不进业务连接池：业务查询把池占满时续约照样发得出去。
//      续约挂起、失败都不在这里判断“还是不是主”：那由任务进程的看门狗按本机单调时钟判断。
//   3. 行由第一次续约插入，不靠迁移播种；行不可删，交出租约只走“让出”（把心跳改成很早的时间）。
import { createPrismaClient } from "@liyoxi/db";

/** 每隔多久续约一次，毫秒 */
export const LEASE_RENEW_MS = 10_000;
/** 持有者超过这么久没续约，别的实例可以接任，秒 */
export const LEASE_TAKEOVER_SEC = 30;
/** 超过这么久没续约，/health 报 worker = down，秒（W0-22 读） */
export const LEASE_DOWN_SEC = 60;
/** 专用连接的语句超时，毫秒 */
const LEASE_STATEMENT_TIMEOUT_MS = 3_000;

export interface WorkerLeaseOptions {
  /** 连接串：这里另建一条专用连接 */
  readonly connectionString: string;
  /** 持有者：<节点名>:<进程启动时生成的 uuid> */
  readonly holder: string;
  /** 持有者运行的镜像标签 */
  readonly version: string;
  /** 只给用例：把“可接任”的时限调短。缺省 LEASE_TAKEOVER_SEC */
  readonly takeoverAfterSec?: number;
}

export interface WorkerLease {
  readonly holder: string;
  /** 续约或抢租约。true 即本实例持有（新插入、续上或接任）；false 即别人持有 */
  renew(): Promise<boolean>;
  /** 主动让出：把自己的心跳改成很早的时间，别的实例下一次续约即可接任。不是自己持有时什么都不做 */
  release(): Promise<boolean>;
  close(): Promise<void>;
}

export function createWorkerLease(options: WorkerLeaseOptions): WorkerLease {
  const { holder, version } = options;
  const takeoverAfterSec = options.takeoverAfterSec ?? LEASE_TAKEOVER_SEC;
  const db = createPrismaClient({
    connectionString: options.connectionString,
    max: 1,
    statementTimeoutMs: LEASE_STATEMENT_TIMEOUT_MS,
  });
  return {
    holder,
    async renew() {
      const rows = await db.$executeRawUnsafe(
        `INSERT INTO worker_lease (name, holder, holder_version, acquired_at, heartbeat_at)
         VALUES ('primary', $1::text, $2::text, clock_timestamp(), clock_timestamp())
         ON CONFLICT (name) DO UPDATE
            SET holder = $1::text, holder_version = $2::text, heartbeat_at = clock_timestamp(),
                acquired_at = CASE WHEN worker_lease.holder = $1::text THEN worker_lease.acquired_at
                                   ELSE clock_timestamp() END,
                updated_at = now()
          WHERE worker_lease.holder = $1::text
             OR worker_lease.heartbeat_at < clock_timestamp() - $3::int * interval '1 second'`,
        holder,
        version,
        takeoverAfterSec,
      );
      return rows === 1;
    },
    async release() {
      const rows = await db.$executeRawUnsafe(
        `UPDATE worker_lease SET heartbeat_at = 'epoch'::timestamptz, updated_at = now()
          WHERE name = 'primary' AND holder = $1::text`,
        holder,
      );
      return rows === 1;
    },
    close: () => db.$disconnect(),
  };
}
