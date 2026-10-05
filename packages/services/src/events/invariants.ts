// events.I8（W0-15）：没有超过 5 分钟未展开的事件；没有超过 15 分钟仍待派发且不在退避中的投递行。
// 依据：01 分组 第 2.3、2.4 节“不变量”；15 分组 第 2.4、5.2 节。P2，只在 full 运行里查，不自愈。
// 调度与落库在 W0-24；这里只给查询函数，并在 register.ts 登记。
import type { InvariantViolation, Tx } from "../kernel/index.js";
import { databaseNow, selectStaleDeliveries, selectStaleEvents } from "./repo.js";

export const I8_EVENT_MAX_AGE_MS = 5 * 60_000;
export const I8_DELIVERY_MAX_OVERDUE_MS = 15 * 60_000;
/** 每一段至多报多少条：中继停摆时积压可以很大，报最老的这些就够定位，不把整张表搬出来 */
export const I8_MAX_VIOLATIONS = 500;

export interface I8Options {
  /** “现在”。不给即取数据库时间：投递行的到期时间本来就是数据库时间 */
  readonly now?: Date;
}

export async function findI8Violations(
  tx: Tx,
  options: I8Options = {},
): Promise<InvariantViolation[]> {
  const now = (options.now ?? (await databaseNow(tx))).getTime();
  const events = await selectStaleEvents(
    tx,
    new Date(now - I8_EVENT_MAX_AGE_MS),
    I8_MAX_VIOLATIONS,
  );
  const deliveries = await selectStaleDeliveries(
    tx,
    new Date(now - I8_DELIVERY_MAX_OVERDUE_MS),
    I8_MAX_VIOLATIONS,
  );
  return [
    ...events.map((event) => ({
      subject: { type: "outbox_event", id: event.id },
      ...(event.entityId === null ? {} : { entityId: event.entityId }),
      detail: {
        problem: "unexpanded",
        eventType: event.eventType,
        occurredAt: event.occurredAt.toISOString(),
      },
    })),
    ...deliveries.map((delivery) => ({
      subject: { type: "outbox_delivery", key: `${delivery.eventId}:${delivery.subscriber}` },
      ...(delivery.entityId === null ? {} : { entityId: delivery.entityId }),
      detail: {
        problem: "undispatched",
        eventType: delivery.eventType,
        status: delivery.status,
        attempts: delivery.attempts,
        nextAttemptAt: delivery.nextAttemptAt.toISOString(),
      },
    })),
  ];
}
