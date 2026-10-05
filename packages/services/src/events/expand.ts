// 展开（W0-15）：把未展开的事件按订阅者各建一行投递行，再把 published_at 从空写一次。
// 依据：01 分组 第 2.3、2.4 节（状态机第一行“中继展开”）；D3 第 20.2 节（ORDER BY id 已改为 ORDER BY seq）。
// 纯数据库事务，不碰 Redis；时间用数据库时间。中继循环（W0-23）只调这里，不重写。
// FOR UPDATE SKIP LOCKED：几个中继实例同时跑，各拿各的一批，不重复、不互等。
// 没有订阅者的事件同样写 published_at，否则 events.I8 会把它当成没人展开（任务书 第 11 节第 4 项）。
import type { Tx } from "../kernel/index.js";
import { insertDeliveries, lockUnpublished, markPublished } from "./repo.js";
import type { SubscriberTable } from "./subscribers.js";

/** 一次展开至多取多少条事件（D3 第 20.2 节） */
export const EXPAND_BATCH_SIZE = 200;

export interface ExpandResult {
  /** 本次展开的事件数；小于批量即暂时没有更多 */
  readonly events: number;
  /** 本次新建的投递行数 */
  readonly deliveries: number;
}

/** 在调用方的事务里展开一批。limit 是 1 到 EXPAND_BATCH_SIZE 的整数 */
export async function expandPending(
  tx: Tx,
  subscribers: SubscriberTable,
  limit: number = EXPAND_BATCH_SIZE,
): Promise<ExpandResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > EXPAND_BATCH_SIZE) {
    throw new RangeError(`展开的批量要是 1 到 ${EXPAND_BATCH_SIZE} 的整数`);
  }
  const events = await lockUnpublished(tx, limit);
  if (events.length === 0) return { events: 0, deliveries: 0 };
  const pairs = events.flatMap((event) =>
    subscribers
      .forEvent(event.eventType)
      .map((subscriber) => ({ eventId: event.id, subscriber: subscriber.name })),
  );
  const deliveries = pairs.length === 0 ? 0 : await insertDeliveries(tx, pairs);
  const published = await markPublished(
    tx,
    events.map((event) => event.id),
  );
  if (published !== events.length) {
    // 这些行刚被本事务锁住且 published_at 为空：写不满只可能是代码缺陷，整个事务回滚
    throw new Error(`展开：锁住 ${events.length} 条事件，只写到 ${published} 条 published_at`);
  }
  return { events: events.length, deliveries };
}
