// events 的装配入口（W0-15）：api 与 worker 启动时各调一次 createEvents，拿到 emit 与展开。
// 构造时对照契约校验订阅者登记，对不上即抛 SubscriberRegistryError：要用 emit 就绕不开这道校验。
import type { Assembly, Clock, Tx, TxRunner } from "../kernel/index.js";
import { createEventCatalog } from "./catalog.js";
import type { TestEventDefinition } from "./catalog.js";
import { emitEvent } from "./emit.js";
import type { EmitContext, EmitInput, EmitResult } from "./emit.js";
import { expandPending } from "./expand.js";
import type { ExpandResult } from "./expand.js";
import { subscriberTableOf } from "./subscribers.js";
import type { SubscriberTable } from "./subscribers.js";

export interface EventsOptions {
  /** 装配结果（assembleServices 给的）：订阅者从这里取 */
  readonly assembly: Pick<Assembly, "subscribers">;
  /** 业务时钟：事件的发生时间取它 */
  readonly clock: Clock;
  /** 开事务的入口：展开的用例入口用它 */
  readonly tx: TxRunner;
  /** 只给测试装配：追加 lyxtest. 前缀的样例事件。生产装配不传 */
  readonly testEvents?: readonly TestEventDefinition[];
}

export interface Events {
  /** 已对照契约校验过的订阅者表；中继展开、消费时按名取订阅者（W0-23）都用它 */
  readonly subscribers: SubscriberTable;
  /** 在业务事务里发一条事件。返回是否真的写入（去重键已发过即 false） */
  emit<const N extends string>(tx: Tx, ctx: EmitContext, input: EmitInput<N>): Promise<EmitResult>;
  /** 展开一批，在调用方的事务里 */
  expandPending(tx: Tx, limit?: number): Promise<ExpandResult>;
  /** 展开一批，自己开事务：中继循环调它，返回的 events 小于批量即暂时没有更多 */
  expand(limit?: number): Promise<ExpandResult>;
}

export function createEvents(options: EventsOptions): Events {
  const catalog = createEventCatalog(options.testEvents);
  const subscribers = subscriberTableOf(options.assembly, catalog);
  const deps = { clock: options.clock, catalog };
  return {
    subscribers,
    emit: (tx, ctx, input) => emitEvent(tx, deps, ctx, input),
    expandPending: (tx, limit) => expandPending(tx, subscribers, limit),
    expand: (limit) => options.tx.run((tx) => expandPending(tx, subscribers, limit)),
  };
}
