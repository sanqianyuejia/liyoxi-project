// 出站投递的派发、消费与失败处理（W0-23）。依据：01 分组 第 2.4 节状态机（9 行）；D3 第 20.2、20.3 节；x01 第 2.4 节 E4、E7。
// 展开在 expand.ts（W0-15），这里从 pending 的投递行接着往下做。本文件的原生 SQL 只在这里（repo.ts 是 W0-15 的，不动）。
//
//   1. 投递行是真相：谁该处理、处理到哪、失败几次。队列只负责把它送到 consume；重试由行上的时间驱动。
//   2. 租约、退避、到期都用数据库时间（now()）：两台机器的钟不一致时仍然只有一个口径。
//   3. 每次派发 dispatch_no + 1。consume 在行锁下比对它：对不上即已被新一次派发接管，这一次不落结果。
//      订阅者的业务写与“已消费”同事务，所以同一行被送达多少次，业务副作用都只有一次。
//   4. 租约过期且上一次已入队（处理器失联）记一次失败；入队失败不记。失败满 10 次进死信并告警，不再自动重试。
//   5. 多个实例同时派发：FOR UPDATE SKIP LOCKED，各拿各的，不重复、不互等。
import type { Alerts, QueueChannel, Tx, TxRunner } from "../kernel/index.js";
import { REDIS_DOWN_FALLBACK_MS } from "../kernel/index.js";
import type { SubscriberTable } from "./subscribers.js";

/** 出站投递的队列名（契约登记的标识符） */
export const OUTBOX_QUEUE = "outbox_delivery";
/** 一轮派发至多认领多少行（D3 第 20.2 节） */
export const DISPATCH_BATCH_SIZE = 200;
/** 派发租约，秒 */
export const DELIVERY_LEASE_SEC = 120;
/** 失败满这么多次进死信 */
export const DELIVERY_MAX_ATTEMPTS = 10;
/** 第 n 次失败后的退避，秒：5 秒、15 秒、1 分、5 分、15 分、30 分，之后每小时 */
export const DELIVERY_BACKOFF_SEC = [5, 15, 60, 300, 900, 1800, 3600] as const;
/** 订阅者不认识事件类型：延后这么久再试，不计次数 */
export const UNKNOWN_EVENT_DELAY_SEC = 300;
/** 不认识的状态持续这么久之后按失败处理 */
export const UNKNOWN_EVENT_GIVE_UP_SEC = 24 * 3600;
const LAST_ERROR_MAX = 500;

export interface DeliveryRef {
  readonly eventId: string;
  readonly subscriber: string;
  /** 这一次派发的序号 */
  readonly dispatchNo: number;
}

export interface ClaimedDelivery extends DeliveryRef {
  readonly eventType: string;
}

export interface ClaimResult {
  /** 认领到、要交给执行通道的行 */
  readonly claimed: ClaimedDelivery[];
  /** 处理器失联把次数耗尽、这一轮直接进了死信的行 */
  readonly dead: ClaimedDelivery[];
}

export interface DispatchDeps {
  readonly tx: TxRunner;
  readonly subscribers: SubscriberTable;
  readonly channel: Pick<QueueChannel, "enqueue" | "downForMs">;
  readonly alerts: Alerts;
}

/** done 已消费；stale 已被接管或已处理过，没落结果；deferred 不认识的事件类型，延后；retry 失败待重试；dead 进死信 */
export type ConsumeOutcome = "done" | "stale" | "deferred" | "retry" | "dead";

export interface DispatchOptions {
  readonly limit?: number;
  /** 每处理完一行调一次：循环的看门狗据此知道它还在动 */
  readonly beat?: () => void;
}

export interface DispatchResult {
  readonly claimed: number;
  readonly enqueued: number;
  /** 入队失败后在进程内直接执行的 */
  readonly inProcess: number;
  /** 入队失败后放回 pending 的 */
  readonly released: number;
  readonly dead: number;
}

/** 任务号：每次派发都是新的，不会被同名的历史任务吞掉；不含冒号 */
export const deliveryJobId = (ref: DeliveryRef): string =>
  `evt-${ref.eventId}-${ref.subscriber}-${ref.dispatchNo}`;

export const errorSummary = (error: unknown): string =>
  (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(
    0,
    LAST_ERROR_MAX,
  );

/** 认领到期的投递行（pending、retry 到点的，leased 租约过期的），在调用方的事务里 */
export async function claimDeliveries(
  tx: Tx,
  limit: number = DISPATCH_BATCH_SIZE,
): Promise<ClaimResult> {
  const rows = await tx.$queryRawUnsafe<Array<ClaimedDelivery & { status: string }>>(
    `WITH due AS (
       SELECT outbox_event_id, subscriber, (status = 'leased' AND is_enqueued)::int AS lost
         FROM outbox_delivery
        WHERE (status IN ('pending', 'retry') AND next_attempt_at <= now())
           OR (status = 'leased' AND lease_until < now())
        ORDER BY outbox_event_id, subscriber
        LIMIT $1::int FOR UPDATE SKIP LOCKED
     ), moved AS (
       UPDATE outbox_delivery d
          SET attempts = d.attempts + due.lost, dispatch_no = d.dispatch_no + 1, is_enqueued = false,
              status = CASE WHEN d.attempts + due.lost >= $2::int THEN 'dead' ELSE 'leased' END,
              lease_until = CASE WHEN d.attempts + due.lost >= $2::int THEN NULL
                                 ELSE now() + $3::int * interval '1 second' END,
              last_error = CASE WHEN due.lost = 1 THEN '处理器失联：租约到期仍未消费' ELSE d.last_error END,
              updated_at = now()
         FROM due
        WHERE d.outbox_event_id = due.outbox_event_id AND d.subscriber = due.subscriber
       RETURNING d.outbox_event_id, d.subscriber, d.dispatch_no, d.status
     )
     SELECT moved.outbox_event_id::text AS "eventId", moved.subscriber, moved.dispatch_no::int AS "dispatchNo",
            moved.status, e.event_type AS "eventType"
       FROM moved JOIN outbox_event e ON e.id = moved.outbox_event_id
      ORDER BY moved.outbox_event_id, moved.subscriber`,
    limit,
    DELIVERY_MAX_ATTEMPTS,
    DELIVERY_LEASE_SEC,
  );
  const strip = ({ status: _status, ...ref }: ClaimedDelivery & { status: string }) => ref;
  return {
    claimed: rows.filter((row) => row.status === "leased").map(strip),
    dead: rows.filter((row) => row.status === "dead").map(strip),
  };
}

/** 按 (事件, 订阅者, 派发序号) 批量改仍在本次派发手里的行；返回改到的行数 */
function updateLeased(tx: Tx, refs: readonly DeliveryRef[], set: string): Promise<number> {
  return tx.$executeRawUnsafe(
    `UPDATE outbox_delivery d SET ${set}, updated_at = now()
       FROM unnest($1::uuid[], $2::text[], $3::int[]) AS ref(event_id, subscriber, dispatch_no)
      WHERE d.outbox_event_id = ref.event_id AND d.subscriber = ref.subscriber
        AND d.dispatch_no = ref.dispatch_no AND d.status = 'leased'`,
    refs.map((ref) => ref.eventId),
    refs.map((ref) => ref.subscriber),
    refs.map((ref) => ref.dispatchNo),
  );
}

const raiseExhausted = (alerts: Alerts, row: ClaimedDelivery, lastError: string): Promise<void> =>
  alerts.raise({
    rule: "outbox.exhausted",
    dimension: `${row.eventType}:${row.subscriber}`,
    severity: "P1",
    detail: { eventId: row.eventId, subscriber: row.subscriber, lastError },
  });

/** 失败短事务：次数加一，没耗尽即退避后重试，耗尽即进死信。行已被接管时不动 */
async function recordFailure(
  deps: Pick<DispatchDeps, "tx" | "alerts">,
  ref: DeliveryRef,
  error: unknown,
): Promise<ConsumeOutcome> {
  const lastError = errorSummary(error);
  const [row] = await deps.tx.run((tx) =>
    tx.$queryRawUnsafe<Array<{ status: "retry" | "dead"; eventType: string }>>(
      `UPDATE outbox_delivery d
          SET attempts = d.attempts + 1, last_error = $4::text, lease_until = NULL, updated_at = now(),
              status = CASE WHEN d.attempts + 1 >= $5::int THEN 'dead' ELSE 'retry' END,
              next_attempt_at = now() + ($6::int[])[LEAST(d.attempts + 1, $7::int)] * interval '1 second'
        WHERE d.outbox_event_id = $1::uuid AND d.subscriber = $2::text
          AND d.dispatch_no = $3::int AND d.status = 'leased'
       RETURNING d.status, (SELECT event_type FROM outbox_event WHERE id = d.outbox_event_id) AS "eventType"`,
      ref.eventId,
      ref.subscriber,
      ref.dispatchNo,
      lastError,
      DELIVERY_MAX_ATTEMPTS,
      [...DELIVERY_BACKOFF_SEC],
      DELIVERY_BACKOFF_SEC.length,
    ),
  );
  if (row === undefined) return "stale";
  if (row.status === "dead") await raiseExhausted(deps.alerts, { ...ref, ...row }, lastError);
  return row.status;
}

/**
 * 消费一次派发：队列的处理器与派发循环的进程内执行走同一个函数。
 * 订阅者抛错不往外抛：记一次失败后返回 retry 或 dead。只有数据库本身出问题才抛（那时由租约到期兜底）。
 */
export async function consumeDelivery(
  deps: Pick<DispatchDeps, "tx" | "subscribers" | "alerts">,
  ref: DeliveryRef,
): Promise<ConsumeOutcome> {
  try {
    return await deps.tx.run(async (tx): Promise<ConsumeOutcome> => {
      const [row] = await tx.$queryRawUnsafe<Array<{ status: string; dispatchNo: number }>>(
        `SELECT status, dispatch_no::int AS "dispatchNo" FROM outbox_delivery
          WHERE outbox_event_id = $1::uuid AND subscriber = $2::text FOR UPDATE`,
        ref.eventId,
        ref.subscriber,
      );
      if (row?.status !== "leased" || row.dispatchNo !== ref.dispatchNo) return "stale";
      const [event] = await tx.$queryRawUnsafe<
        Array<{ type: string; payload: Readonly<Record<string, unknown>> }>
      >(`SELECT event_type AS type, payload FROM outbox_event WHERE id = $1::uuid`, ref.eventId);
      if (event === undefined) throw new Error(`投递行指向的事件 ${ref.eventId} 不存在`);

      const subscriber = deps.subscribers.get(ref.subscriber);
      if (subscriber === undefined || !subscriber.events.includes(event.type)) {
        // 只会出现在回滚到旧版本、或登记被改掉时：不丢、不标完成、不计次数，延后再试；持续 24 小时后按失败处理
        const deferred = await tx.$executeRawUnsafe(
          `UPDATE outbox_delivery
              SET status = 'retry', lease_until = NULL, updated_at = now(),
                  next_attempt_at = now() + $3::int * interval '1 second',
                  last_error = '订阅者不认识这个事件类型，延后再试'
            WHERE outbox_event_id = $1::uuid AND subscriber = $2::text
              AND created_at > now() - $4::int * interval '1 second'`,
          ref.eventId,
          ref.subscriber,
          UNKNOWN_EVENT_DELAY_SEC,
          UNKNOWN_EVENT_GIVE_UP_SEC,
        );
        if (deferred === 1) return "deferred";
        throw new Error(`订阅者 ${ref.subscriber} 不认识事件类型 ${event.type}，已持续 24 小时`);
      }

      await subscriber.handle(tx, { id: ref.eventId, type: event.type, payload: event.payload });
      await updateLeased(tx, [ref], "status = 'done', consumed_at = now(), lease_until = NULL");
      return "done";
    });
  } catch (error) {
    return recordFailure(deps, ref, error);
  }
}

/**
 * 派发一轮：认领到期的行，逐行交给队列。入队失败（Redis 不可用）时，关键类订阅者、或 Redis 已连续不可用
 * 满 60 秒的，在进程内直接执行；其余放回 pending，不计失败次数。
 */
export async function dispatchDue(
  deps: DispatchDeps,
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  const { claimed, dead } = await deps.tx.run((tx) => claimDeliveries(tx, options.limit));
  for (const row of dead) await raiseExhausted(deps.alerts, row, "处理器失联：租约到期仍未消费");

  const enqueued: DeliveryRef[] = [];
  const released: DeliveryRef[] = [];
  let inProcess = 0;
  for (const row of claimed) {
    const { eventId, subscriber, dispatchNo } = row;
    try {
      await deps.channel.enqueue(OUTBOX_QUEUE, deliveryJobId(row), {
        eventId,
        subscriber,
        dispatchNo,
      });
      enqueued.push(row);
    } catch {
      const critical = deps.subscribers.get(subscriber)?.critical === true;
      if (critical || deps.channel.downForMs() >= REDIS_DOWN_FALLBACK_MS) {
        await consumeDelivery(deps, row);
        inProcess += 1;
      } else {
        released.push(row);
      }
    }
    options.beat?.();
  }
  if (enqueued.length > 0) {
    await deps.tx.run((tx) => updateLeased(tx, enqueued, "is_enqueued = true"));
  }
  if (released.length > 0) {
    await deps.tx.run((tx) => updateLeased(tx, released, "status = 'pending', lease_until = NULL"));
  }
  return {
    claimed: claimed.length,
    enqueued: enqueued.length,
    inProcess,
    released: released.length,
    dead: dead.length,
  };
}
