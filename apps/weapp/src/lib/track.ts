// 埋点封装（D7 第 4.12 节；m08 第 2.11、3.26 节）。
// 端上只报契约登记为 client 的事件（7 个纯行为事件加 3 个扩展事件）；事件名与属性的类型取自
// @liyoxi/contract/analytics/events，写错了类型检查过不去。身份类的公共属性由服务端填，端上不传。
//   track()：进内存队列；满 10 条，或距第一条入队 5 秒，或小程序切到后台，就上报。
//   flush()：每批至多 50 条。回包成功，这批全部移除（被拒收的也移除，重试没有意义）；
//           网络失败或 5xx，放回队列并落本地（至多 200 条，超出丢最旧的），5 秒内不再试，下次启动先补报；
//           其余错误（限流、开关已关、入参不合）丢弃这一批。
// 开关 analytics.ingest.enabled 关着，或上报函数没接上：不发请求，事件留在内存队列里（同样至多 200 条）。
import type { ClientEventName, ClientEventProps } from "@liyoxi/contract/analytics/events";

import type { ClientPlatform, Clock, KeyValueStorage } from "./platform";
import { StorageKey } from "./storage";

export const TRACK_FLUSH_COUNT = 10;
export const TRACK_FLUSH_INTERVAL_MS = 5000;
export const TRACK_BATCH_MAX = 50;
export const TRACK_QUEUE_MAX = 200;

/** 队列里的一条，也是请求体 events 的一项（m08 的 ClientAnalyticsEvent） */
export interface QueuedEvent {
  eventId: string;
  name: ClientEventName;
  /** 端上时刻，ISO 8601 */
  occurredAt: string;
  storeId?: string;
  props: object;
}

/** m.analyticsEvent.batchCreate 的请求体（m08 的 AnalyticsEventBatch） */
export interface AnalyticsEventBatch {
  sentAt: string;
  anonymousId: string;
  sessionId: string;
  clientVersion: string;
  platform: ClientPlatform;
  scene?: number;
  events: QueuedEvent[];
}

/** 上报的结局：ok 已收下；retry 网络失败或 5xx，放回去等下次；drop 这一批不要了 */
export type SendOutcome = "ok" | "retry" | "drop";

export interface TrackDeps {
  storage: KeyValueStorage;
  clock: Clock;
  uuid: () => string;
  /** 开关 analytics.ingest.enabled 此刻的值 */
  enabled(): boolean;
  /** 上报函数；没接上时返回 undefined */
  sender(): ((batch: AnalyticsEventBatch) => Promise<SendOutcome>) | undefined;
  /** 批次头里随会话变的部分 */
  client(): { version: string; platform: ClientPlatform; scene?: number };
  getStoreId(): string | null;
  /** 定时器：返回取消函数 */
  schedule(run: () => void, delayMs: number): () => void;
}

export function createTracker(deps: TrackDeps) {
  // 上次没报上去的先放回来，下次上报时先补报
  const restored = deps.storage.get<QueuedEvent[]>(StorageKey.trackQueue);
  let queue: QueuedEvent[] = Array.isArray(restored) ? restored.slice(-TRACK_QUEUE_MAX) : [];
  let cancelTimer: (() => void) | null = null;
  let flushing: Promise<void> | null = null;
  let again = false;
  /** 上一次没报成：这个时刻之前不再试，免得断网时每记一条就发一次 */
  let holdUntil = 0;
  const sessionId = deps.uuid();

  function anonymousId(): string {
    const saved = deps.storage.get<string>(StorageKey.anonymousId);
    if (typeof saved === "string" && saved !== "") return saved;
    const created = deps.uuid();
    deps.storage.set(StorageKey.anonymousId, created);
    return created;
  }

  function cap(): void {
    if (queue.length > TRACK_QUEUE_MAX) queue = queue.slice(queue.length - TRACK_QUEUE_MAX);
  }

  function armTimer(): void {
    if (cancelTimer || queue.length === 0) return;
    cancelTimer = deps.schedule(() => {
      cancelTimer = null;
      void flush();
    }, TRACK_FLUSH_INTERVAL_MS);
  }

  function track<N extends ClientEventName>(name: N, props: ClientEventProps[N]): void {
    const storeId = deps.getStoreId();
    queue.push({
      eventId: deps.uuid(),
      name,
      occurredAt: new Date(deps.clock.now()).toISOString(),
      ...(storeId ? { storeId } : {}),
      props,
    });
    cap();
    if (queue.length >= TRACK_FLUSH_COUNT) void flush();
    else armTimer();
  }

  async function sendOnce(): Promise<boolean> {
    const send = deps.sender();
    if (!send || !deps.enabled() || queue.length === 0) return false;
    if (deps.clock.now() < holdUntil) return false;
    const batch = queue.slice(0, TRACK_BATCH_MAX);
    queue = queue.slice(batch.length);
    const client = deps.client();
    let outcome: SendOutcome;
    try {
      outcome = await send({
        sentAt: new Date(deps.clock.now()).toISOString(),
        anonymousId: anonymousId(),
        sessionId,
        clientVersion: client.version,
        platform: client.platform,
        ...(client.scene === undefined ? {} : { scene: client.scene }),
        events: batch,
      });
    } catch {
      outcome = "retry";
    }
    if (outcome === "retry") {
      holdUntil = deps.clock.now() + TRACK_FLUSH_INTERVAL_MS;
      queue = [...batch, ...queue];
      cap();
      deps.storage.set(StorageKey.trackQueue, queue);
      return false;
    }
    // 收下了或不要了：本地存的那份跟着更新，免得下次启动重复补报
    if (deps.storage.get(StorageKey.trackQueue) !== null) {
      if (queue.length === 0) deps.storage.remove(StorageKey.trackQueue);
      else deps.storage.set(StorageKey.trackQueue, queue);
    }
    return outcome === "ok";
  }

  /**
   * 把队列报上去。同一时刻只有一趟在跑：一趟里连着报，直到剩下的不足 10 条或没报成；
   * 跑着的时候又有人要报，这一趟结束前再补一轮（那时开关、上报函数可能已经变了）。
   */
  function flush(): Promise<void> {
    if (flushing) {
      again = true;
      return flushing;
    }
    cancelTimer?.();
    cancelTimer = null;
    flushing = (async () => {
      do {
        again = false;
        while ((await sendOnce()) && queue.length >= TRACK_FLUSH_COUNT) {
          // 接着报下一批
        }
      } while (again);
    })().finally(() => {
      flushing = null;
      armTimer();
    });
    return flushing;
  }

  return { track, flush, pending: () => queue.length };
}
