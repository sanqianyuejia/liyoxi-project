// 健康检查的取数（W0-22）：/health 的聚合，两条内网探活的框架。路由在 apps/api，是薄壳。
// 依据：h01 第 2.5、3.13–3.15 节；约定 C1；15 分组 第 2.2 节（worker_lease）；D7 第 9.5 节。
//
//   1. 各项探测 1.5 秒超时，超时或出错按 down（flow 按 degraded）算；结果在进程内缓存 5 秒。
//   2. worker 与探针的新鲜度用数据库时间比：租约是基础设施，续约写的是 clock_timestamp()。
//      flow 的几项比的是业务时间（事件发生、定时器到点），用注入的时钟。
//   3. flow 只做 P1 判定（四项）。明细数值与 P2 在 /internal/health/flow，那一条现在只有框架。
//   4. 两条内网探活只出框架：结构照 h01 第 2.5 节，各指标一律 null 并计入 breaches，status 为 degraded。
//      回补：finance 在 M4，flow 在 M7（docs/plan/stubs/）。
// 探活不进 OpenAPI，契约里没有这几个结构，类型写在这里。
import { TIMERS } from "@liyoxi/contract/registry";
import type { PrismaClient } from "@liyoxi/db";

import type { Clock } from "../kernel/index.js";

/** 每项探测的时限 */
export const HEALTH_PROBE_TIMEOUT_MS = 1_500;
/** /health 的结果在进程内缓存多久 */
export const HEALTH_CACHE_MS = 5_000;
/** 租约的心跳在这么多秒之内，worker 算活着 */
export const WORKER_HEARTBEAT_MAX_AGE_SEC = 60;
/** 探针最近一次跑完超过这么多秒（或从未跑过）即 degraded */
export const PROBE_MAX_AGE_SEC = 180;
/** flow 的 P1 阈值（h01 第 3.13 节；部署配置的初值） */
export const FLOW_P1 = {
  unpublishedEventAgeSec: 300,
  dueDeliveryAgeSec: 900,
  timerLagSec: 600,
  criticalTimerAttempts: 6,
} as const;

export type UpDown = "ok" | "down";
export type OkDegraded = "ok" | "degraded";

/** GET /health（h01 第 2.5 节 HealthSummary） */
export interface HealthSummary {
  status: OkDegraded;
  version: string;
  time: string;
  db: UpDown;
  redis: UpDown;
  worker: UpDown;
  probeAgeSec: number | null;
  flow: OkDegraded;
}

/** GET /internal/health/finance（h01 第 2.5 节 FinanceHealth）。框架：各项恒为 null */
export interface FinanceHealth {
  status: OkDegraded;
  time: string;
  breaches: string[];
  unappliedReceipt: null;
  workerHeartbeatAgeSec: null;
  timerLagSec: null;
  webhookBacklog: null;
  certificates: null;
  billing: {
    sweepLagSec: null;
    invariantRunAgeSec: null;
    openViolationCount: null;
    valuationAgeSec: null;
    oldestBlockedFulfillmentSec: null;
  };
}

/** GET /internal/health/flow（h01 第 2.5 节 FlowHealth）。框架：各项恒为 null */
export interface FlowHealth {
  status: OkDegraded;
  time: string;
  breaches: string[];
  warnings: string[];
  oldestUnpublishedEventAgeSec: null;
  oldestDueDeliveryAgeSec: null;
  deadDeliveryCount: null;
  timerLagSec: null;
  failedTimerCount: null;
  criticalTimerFailingCount: null;
  stuckTicketCount: null;
}

const FINANCE_METRICS = [
  "unappliedReceipt",
  "workerHeartbeatAgeSec",
  "timerLagSec",
  "webhookBacklog",
  "certificates",
] as const;
const BILLING_METRICS = [
  "sweepLagSec",
  "invariantRunAgeSec",
  "openViolationCount",
  "valuationAgeSec",
  "oldestBlockedFulfillmentSec",
] as const;
const FLOW_METRICS = [
  "oldestUnpublishedEventAgeSec",
  "oldestDueDeliveryAgeSec",
  "deadDeliveryCount",
  "timerLagSec",
  "failedTimerCount",
  "criticalTimerFailingCount",
  "stuckTicketCount",
] as const;

/** 关键类定时器的 kind：取契约的登记，不读表（h01 第 3.15 节） */
const CRITICAL_TIMER_KINDS: readonly string[] = [
  ...new Set(TIMERS.filter((timer) => timer.critical).map((timer) => timer.kind)),
].sort();

export interface HealthOptions {
  /** 只读的库句柄：进程装配时传 Prisma 客户端 */
  db: Pick<PrismaClient, "$queryRaw">;
  /** 只用 PING */
  redis: { ping(): Promise<unknown> };
  clock: Clock;
  /** api 镜像标签 */
  version: string;
  /** /health 的结果缓存多久，缺省 HEALTH_CACHE_MS；用例里给 0 */
  cacheMs?: number;
}

export interface Health {
  /** /health：聚合状态。status 为 degraded 时路由回 503，响应体不变 */
  summary(): Promise<HealthSummary>;
  /** /internal/health/finance：框架 */
  finance(): FinanceHealth;
  /** /internal/health/flow：框架 */
  flow(): FlowHealth;
}

const nullsOf = <K extends string>(keys: readonly K[]): Record<K, null> =>
  Object.fromEntries(keys.map((key) => [key, null])) as Record<K, null>;

/** 给一项探测套上时限：到点没回即失败。探测本身不取消，由连接上的语句超时兜住 */
async function within<T>(probe: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("探测超时")), HEALTH_PROBE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([probe, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const ageSec = (now: Date, at: Date | null): number =>
  at === null ? 0 : Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000));

export function createHealth(options: HealthOptions): Health {
  const { db, redis, clock, version, cacheMs = HEALTH_CACHE_MS } = options;
  let cached: { at: number; value: Promise<HealthSummary> } | undefined;

  const probeDb = async (): Promise<UpDown> => {
    await within(db.$queryRaw`SELECT 1`);
    return "ok";
  };
  const probeRedis = async (): Promise<UpDown> => {
    await within(redis.ping());
    return "ok";
  };
  const probeLease = async (): Promise<{ worker: UpDown; probeAgeSec: number | null }> => {
    const rows = await within(
      db.$queryRaw<{ heartbeat_age: number; probe_age: number | null }[]>`
        SELECT floor(extract(epoch FROM clock_timestamp() - heartbeat_at))::int AS heartbeat_age,
               floor(extract(epoch FROM clock_timestamp() - probe_at))::int AS probe_age
        FROM worker_lease WHERE name = 'primary'`,
    );
    const lease = rows[0];
    if (lease === undefined) return { worker: "down", probeAgeSec: null };
    return {
      worker: lease.heartbeat_age <= WORKER_HEARTBEAT_MAX_AGE_SEC ? "ok" : "down",
      probeAgeSec: lease.probe_age === null ? null : Math.max(0, lease.probe_age),
    };
  };
  /** flow 的 P1 判定：四项任一越限即 degraded。/internal/health/flow 回补时与这里用同一段 */
  const probeFlow = async (): Promise<OkDegraded> => {
    const now = clock.now();
    const rows = await within(
      db.$queryRaw<
        {
          oldest_event: Date | null;
          oldest_delivery: Date | null;
          oldest_timer: Date | null;
          critical_failing: number;
        }[]
      >`
        SELECT
          (SELECT min(occurred_at) FROM outbox_event WHERE published_at IS NULL) AS oldest_event,
          (SELECT min(next_attempt_at) FROM outbox_delivery
            WHERE status IN ('pending', 'retry', 'leased') AND next_attempt_at <= ${now}) AS oldest_delivery,
          (SELECT min(COALESCE(retry_at, fire_at)) FROM timer
            WHERE status = 'scheduled' AND COALESCE(retry_at, fire_at) <= ${now}) AS oldest_timer,
          (SELECT count(*)::int FROM timer
            WHERE status IN ('scheduled', 'dispatched')
              AND attempts >= ${FLOW_P1.criticalTimerAttempts}
              AND kind = ANY(${CRITICAL_TIMER_KINDS}::text[])) AS critical_failing`,
    );
    const row = rows[0];
    if (row === undefined) return "degraded";
    const breached =
      ageSec(now, row.oldest_event) > FLOW_P1.unpublishedEventAgeSec ||
      ageSec(now, row.oldest_delivery) > FLOW_P1.dueDeliveryAgeSec ||
      ageSec(now, row.oldest_timer) > FLOW_P1.timerLagSec ||
      row.critical_failing > 0;
    return breached ? "degraded" : "ok";
  };

  const compute = async (): Promise<HealthSummary> => {
    const [dbState, redisState, lease, flow] = await Promise.all([
      probeDb().catch((): UpDown => "down"),
      probeRedis().catch((): UpDown => "down"),
      probeLease().catch(() => ({ worker: "down" as UpDown, probeAgeSec: null })),
      probeFlow().catch((): OkDegraded => "degraded"),
    ]);
    const healthy =
      dbState === "ok" &&
      redisState === "ok" &&
      lease.worker === "ok" &&
      lease.probeAgeSec !== null &&
      lease.probeAgeSec < PROBE_MAX_AGE_SEC &&
      flow === "ok";
    return {
      status: healthy ? "ok" : "degraded",
      version,
      time: clock.now().toISOString(),
      db: dbState,
      redis: redisState,
      worker: lease.worker,
      probeAgeSec: lease.probeAgeSec,
      flow,
    };
  };

  return {
    summary() {
      // 缓存按进程的单调时间算，不看业务时钟：用例里拨时钟不该让缓存永不过期
      const at = performance.now();
      if (cached === undefined || at - cached.at >= cacheMs) {
        cached = { at, value: compute() };
      }
      return cached.value;
    },
    finance() {
      return {
        status: "degraded",
        time: clock.now().toISOString(),
        breaches: [...FINANCE_METRICS, ...BILLING_METRICS.map((key) => `billing.${key}`)],
        ...nullsOf(FINANCE_METRICS),
        billing: nullsOf(BILLING_METRICS),
      };
    },
    flow() {
      return {
        status: "degraded",
        time: clock.now().toISOString(),
        breaches: [...FLOW_METRICS],
        warnings: [],
        ...nullsOf(FLOW_METRICS),
      };
    },
  };
}
